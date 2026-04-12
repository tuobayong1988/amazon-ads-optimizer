/**
 * v362: 优化目标引擎 - bidOptimizationExecutor
 * 从 optimizationTargetEngine.ts 拆分
 * 
 * 包含函数: executeBidOptimization
 */

/**
 * 优化目标自动执行引擎
 * 
 * 核心理念：优化目标作为所有优化算法的统一执行入口
 * 当优化目标启用后，自动对其下的广告活动执行所有优化策略
 * 
 * 优化策略包括：
 * 1. 广告活动位置百分比调整
 * 2. 投放词分时竞价
 * 3. 客户搜索词分析和处理
 * 4. 预算分配优化
 * 5. 投放词暂停/启用决策
 */

import * as db from "../db";
import { getDb } from "../db";
import { keywords as keywordsTable, productTargets as productTargetsTable, campaigns as campaignsTable, sdAudiences as sdAudiencesTable } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { safeInClause } from '../utils/safeSql';
import * as bidOptimizer from "../optimization/bidOptimizer";
import * as daypartingService from "../budget/daypartingService";
import * as placementOptimizationService from "../optimization/placementOptimizationService";
import { preOptimizationSafetyCheck, applyBidGuardrail, applyBudgetGuardrail, applyPlacementGuardrail, SAFETY_LIMITS } from '../optimization/optimizationSafetyGuardrails';
import * as adAutomation from "../automation/adAutomation";
import * as intelligentBudgetAllocationService from "../budget/intelligentBudgetAllocationService";
import { optimizeBudgetPortfolio } from "../budget/budgetPortfolioOptimizer";
import * as bidCoordinator from "../services/bidCoordinator";
import * as nextGenOrchestrator from "../optimization/nextGenBidOrchestrator";
import * as amazonApiHelper from "../services/amazonApiHelper";
import { acquireAccountOptimizationLock, releaseAccountOptimizationLock, getModuleLockGroup } from "../utils/lockManager";
import * as amazonIdResolver from "../services/amazonIdResolver";
import { getLocalHour, getLocalDayOfWeek, isNewKeyword, getExplorationStrategy, isProtectedKeyword } from "../algorithm/algorithmUtils";
import * as campaignLifecycleService from "../services/campaignLifecycleService";
import * as timeDecayService from "../analytics/timeDecayWeightedDataService";
import * as gradualEngine from "../optimization/gradualOptimizationEngine";
import * as selfEvolution from "../algorithm/selfEvolutionEngine";
import * as multiDimOptimizer from "../optimization/multiDimensionOptimizer";
import * as multiDimComboAnalyzer from "../optimization/multiDimComboAnalyzer";
import * as postOptVerifier from "../optimization/postOptimizationVerifier";
import { registerActiveTask, unregisterActiveTask, isShuttingDown } from "../utils/taskLifecycle";
import { decideTargeting, type SearchTermPerformance, type TargetingDecision } from "../services/targetingAlgorithm";
import { sanitizeAndValidateKeyword, canAddPositiveKeyword, isAsinSearchTerm, adGroupHasProductTargets, isProductTargetingCampaign } from "../utils/keywordValidator";
import { createModuleLogger } from '../utils/logger';
import { getCampaignAmazonId, getCampaignLocalId } from '../utils/idTypes';
import { clampBidToConstraint, getBidConstraint } from '../utils/amazonBidConstraints';
import { recordAudit, auditBidChange } from '../services/auditLogService';
import { generateNegativeKeywordSuggestions, executeNegativeKeywords as executeNgramNegativeKeywords } from '../analytics/ngramAnalysis';
import { getLocalKeywordBidRecommendation, getLocalTargetBidRecommendation } from '../optimization/localBidRecommendationEngine';

const log = createModuleLogger('TargetEngine');

// 缓存账号站点信息，避免重复查询
import type { OptimizationExecutionResult, OptimizationTargetConfig } from './types';

export async function executeBidOptimization(
  config: OptimizationTargetConfig,
  campaigns: unknown[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: Record<string, unknown>[]; apiSyncResult?: unknown; apiSyncStatus?: string; emergencyPause?: boolean; emergencyReason?: string }> {
  const details: Record<string, unknown>[] = [];
  let adjustmentsCount = 0;
  let safetyPausedCampaignCount = 0; // v244: 记录安全检查触发暂停的campaign数量
  
  // v122h: 计算广告组平均CVR、CPC、AOV作为贝叶斯先验数据
  let totalClicks = 0, totalOrders = 0, totalSpend = 0, totalSales = 0;
  for (const c of (campaigns as unknown[])) {
    // @ts-ignore
    totalClicks += (c.clicks || 0);
    // @ts-ignore
    totalOrders += (c.orders || 0);
    // @ts-ignore
    totalSpend += parseFloat(c.spend || '0');
    // @ts-ignore
    totalSales += parseFloat(c.sales || '0');
  }
  
  // v330: 冷启动出价优化 R-02 — 重构CVR估算体系（三级回退机制）
  // 当优化目标内部无点击数据时，不再使用硬编码0.05，而是依次回退：
  // Level 1: 品类CVR基准表 → Level 2: 账户级别平均CVR → Level 3: 跨活动品类CVR → 最终兜底0.05
  let groupAvgCvr: number;
  let groupAvgCpc: number;
  let groupAvgAov: number;
  let cvrSource = 'group_actual'; // 记录CVR来源用于日志
  
  if (totalClicks > 0) {
    // 有实际数据，直接使用
    groupAvgCvr = totalOrders / totalClicks;
    groupAvgCpc = totalSpend / totalClicks;
    groupAvgAov = totalOrders > 0 ? totalSales / totalOrders : 30;
  } else {
    // 冷启动：无点击数据，启用三级回退机制
    groupAvgCpc = 0.80;
    groupAvgAov = 30;
    groupAvgCvr = 0.05; // 最终兜底值
    cvrSource = 'hardcoded_fallback';
    
    try {
      // === Level 1: 品类CVR基准表 ===
      // 从campaign名称推断品类后，查询CATEGORY_CVR_BENCHMARK表
      const CATEGORY_CVR_BENCHMARK: Record<string, number> = {
        'electronics': 0.10, 'computers': 0.09, 'cell_phones': 0.08, 'video_games': 0.12,
        'home_kitchen': 0.07, 'sports_outdoors': 0.06, 'toys_games': 0.10, 'clothing': 0.04,
        'beauty': 0.08, 'health': 0.07, 'baby': 0.09, 'pet_supplies': 0.08,
        'grocery': 0.18, 'luxury': 0.03, 'default': 0.08,
      };
      // 先做品类推断（后面会重复推断，这里提前做一次用于CVR回退）
      const nameHintsForCvr = (config.name || '').toLowerCase();
      const categoryKeywordsForCvr: Record<string, string[]> = {
        'electronics': ['electronic', 'gadget', 'device', 'tech', 'phone', 'tablet', 'laptop', 'computer', 'camera', 'headphone', 'speaker', 'charger', 'cable', 'adapter'],
        'clothing': ['clothing', 'apparel', 'fashion', 'shirt', 'dress', 'pants', 'jacket', 'shoes', 'sneaker', 'boot', 'sock', 'underwear', 'hat', 'scarf'],
        'beauty': ['beauty', 'skincare', 'makeup', 'cosmetic', 'serum', 'cream', 'lotion', 'shampoo', 'conditioner', 'perfume', 'fragrance'],
        'health': ['health', 'supplement', 'vitamin', 'protein', 'fitness', 'wellness', 'medical', 'mask', 'sanitizer'],
        'home_kitchen': ['home', 'kitchen', 'furniture', 'decor', 'appliance', 'cookware', 'bedding', 'towel', 'curtain', 'rug', 'mat', 'storage', 'organizer'],
        'sports_outdoors': ['sport', 'outdoor', 'camping', 'hiking', 'fishing', 'yoga', 'gym', 'exercise', 'bike', 'golf', 'running'],
        'toys_games': ['toy', 'game', 'puzzle', 'lego', 'doll', 'action figure', 'board game', 'card game', 'kids'],
        'baby': ['baby', 'infant', 'toddler', 'diaper', 'stroller', 'crib', 'pacifier', 'bottle', 'nursing'],
        'pet_supplies': ['pet', 'dog', 'cat', 'fish', 'bird', 'aquarium', 'leash', 'collar', 'treat', 'food pet'],
        'grocery': ['grocery', 'food', 'snack', 'beverage', 'coffee', 'tea', 'organic', 'gluten', 'vegan'],
        'luxury': ['luxury', 'premium', 'designer', 'gold', 'silver', 'diamond', 'jewelry', 'watch', 'handbag'],
      };
      let earlyCategory = 'default';
      for (const [cat, kws] of Object.entries(categoryKeywordsForCvr)) {
        if (kws.some(kw => nameHintsForCvr.includes(kw))) {
          earlyCategory = cat;
          break;
        // @ts-ignore
        }
      }
      if (earlyCategory === 'default') {
        for (const campaign of (campaigns as unknown[])) {
          // @ts-ignore
          const campName = (campaign.campaignName || '').toLowerCase();
          for (const [cat, kws] of Object.entries(categoryKeywordsForCvr)) {
            if (kws.some(kw => campName.includes(kw))) {
              earlyCategory = cat;
              break;
            }
          }
          if (earlyCategory !== 'default') break;
        }
      }
      
      if (earlyCategory !== 'default' && CATEGORY_CVR_BENCHMARK[earlyCategory]) {
        groupAvgCvr = CATEGORY_CVR_BENCHMARK[earlyCategory];
        cvrSource = `category_benchmark_${earlyCategory}`;
        log.info(`[BidOptimization] v330 冷启动CVR回退Level1: 使用品类基准 ${earlyCategory}=${(groupAvgCvr * 100).toFixed(1)}%`);
      } else {
        // === Level 2: 账户级别平均CVR ===
        const accountMetrics = await db.getAccountLevelMetrics(config.accountId);
        if (accountMetrics && accountMetrics.accountAvgCvr > 0) {
          groupAvgCvr = accountMetrics.accountAvgCvr;
          groupAvgCpc = accountMetrics.accountAvgCpc || groupAvgCpc;
          groupAvgAov = accountMetrics.accountAvgAov || groupAvgAov;
          cvrSource = 'account_level_30d';
          log.info(`[BidOptimization] v330 冷启动CVR回退Level2: 使用账户级别30天CVR=${(groupAvgCvr * 100).toFixed(2)}% (clicks=${accountMetrics.totalClicks}, orders=${accountMetrics.totalOrders})`);
        } else {
          // === Level 3: 跨活动品类平均CVR (R-03) ===
          const crossMetrics = await db.getCrossCampaignCategoryMetrics(config.accountId, config.performanceGroupId);
          if (crossMetrics && crossMetrics.crossCampaignCvr > 0) {
            groupAvgCvr = crossMetrics.crossCampaignCvr;
            cvrSource = 'cross_campaign_30d';
            log.info(`[BidOptimization] v330 冷启动CVR回退Level3: 使用跨活动CVR=${(groupAvgCvr * 100).toFixed(2)}% (clicks=${crossMetrics.totalClicks}, orders=${crossMetrics.totalOrders})`);
          } else {
            // 使用默认品类基准作为最终兜底
            groupAvgCvr = CATEGORY_CVR_BENCHMARK['default'];
            cvrSource = 'category_benchmark_default';
            log.info(`[BidOptimization] v330 冷启动CVR回退: 所有回退均无数据，使用默认品类基准=${(groupAvgCvr * 100).toFixed(1)}%`);
          }
        }
      }
    } catch (fallbackErr: unknown) {
      log.warn(`[BidOptimization] v330 冷启动CVR回退异常: ${(fallbackErr as Error).message}，使用默认值0.08`);
      groupAvgCvr = 0.08;
      cvrSource = 'error_fallback';
    }
  }
  log.info(`[BidOptimization] v330 CVR估算: groupAvgCvr=${(groupAvgCvr * 100).toFixed(2)}%, source=${cvrSource}, totalClicks=${totalClicks}`);
  
  // v491: 建议出价获取 — 遍历所有campaigns/adGroups/keywords/targets，收集所有有效建议竞价取中位数
  let suggestedBidData: { suggestedBid?: number; rangeStart?: number; rangeEnd?: number } | null = null;
  
  // v491: 策略一 — 从数据库读取已同步的建议竞价（遍历所有实体，取中位数）
  try {
    const allBids: { bid: number; low: number; high: number }[] = [];
    for (const campaign of (campaigns as unknown[])) {
      const camp = campaign as Record<string, unknown>;
      const adGroups = camp.adGroups as Array<Record<string, unknown>> | undefined;
      if (!adGroups) continue;
      for (const adGroup of adGroups) {
        // 收集keywords的建议竞价
        const kws = adGroup.keywords as Array<Record<string, unknown>> | undefined;
        if (kws) {
          for (const kw of kws) {
            const sb = Number(kw.suggestedBid);
            if (sb > 0) {
              allBids.push({
                bid: sb,
                low: Number(kw.suggestedBidLow) || 0,
                high: Number(kw.suggestedBidHigh) || 0,
              });
            }
          }
        }
        // 收集targets的建议竞价
        const tgts = adGroup.targets as Array<Record<string, unknown>> | undefined;
        if (tgts) {
          for (const tgt of tgts) {
            const sb = Number(tgt.suggestedBid);
            if (sb > 0) {
              allBids.push({
                bid: sb,
                low: Number(tgt.suggestedBidLow) || 0,
                high: Number(tgt.suggestedBidHigh) || 0,
              });
            }
          }
        }
      }
    }
    if (allBids.length > 0) {
      // 取中位数作为代表性建议竞价
      allBids.sort((a, b) => a.bid - b.bid);
      const medianIdx = Math.floor(allBids.length / 2);
      const median = allBids.length % 2 === 1
        ? allBids[medianIdx]
        : { bid: (allBids[medianIdx - 1].bid + allBids[medianIdx].bid) / 2,
            low: (allBids[medianIdx - 1].low + allBids[medianIdx].low) / 2,
            high: (allBids[medianIdx - 1].high + allBids[medianIdx].high) / 2 };
      suggestedBidData = {
        suggestedBid: Math.round(median.bid * 100) / 100,
        rangeStart: Math.round(median.low * 100) / 100,
        rangeEnd: Math.round(median.high * 100) / 100,
      };
      log.info(`[BidOptimization] v491: 从${allBids.length}个实体的建议竞价中取中位数 suggestedBid=$${suggestedBidData.suggestedBid}, range=[$${suggestedBidData.rangeStart}-$${suggestedBidData.rangeEnd}]`);
    } else {
      log.info(`[BidOptimization] v491: 所有campaigns/adGroups中未找到有效的建议竞价数据`);
    }
  } catch (dbBidErr: unknown) {
    log.debug(`[BidOptimization] v491: 从数据库读取建议竞价失败: ${(dbBidErr as Error).message}`);
  }
  
  // v436: 策略二 — 如果数据库无数据且零点击，回退到实时API调用
  // @ts-ignore
  if (!suggestedBidData && totalClicks === 0) {
    // @ts-ignore
    try {
      const syncService = await amazonApiHelper.getAmazonSyncService(config.accountId);
      if (syncService && (syncService as unknown as Record<string, unknown>).client) {
        // @ts-ignore
        const firstCampaign = campaigns[0] as unknown;
        // @ts-ignore
        if (firstCampaign && firstCampaign.adGroups && firstCampaign.adGroups.length > 0) {
          // @ts-ignore
          const adGroupId = String(firstCampaign.adGroups[0].amazonAdGroupId || firstCampaign.adGroups[0].adGroupId);
          if (adGroupId) {
            try {
              // @ts-ignore
              const keywordRecs = await (syncService as unknown as Record<string, unknown>).client.getKeywordBidRecommendations(
                // @ts-ignore
                adGroupId,
                [{ keyword: config.name || 'product', matchType: 'BROAD' }]
              // @ts-ignore
              );
              if (keywordRecs && keywordRecs.length > 0) {
                const rec = keywordRecs[0] as unknown;
                suggestedBidData = {
                  // @ts-ignore
                  suggestedBid: rec.suggestedBid,
                  // @ts-ignore
                  rangeStart: rec.rangeStart,
                  // @ts-ignore
                  rangeEnd: rec.rangeEnd,
                };
                // @ts-ignore
                log.info(`[BidOptimization] v436 R-01: API获取到建议出价 suggestedBid=$${rec.suggestedBid}, range=[$${rec.rangeStart}-$${rec.rangeEnd}]`);
              }
            } catch (kwBidErr: unknown) {
              log.debug(`[BidOptimization] v436 R-01: 关键词建议出价获取失败: ${(kwBidErr as Error).message}`);
              // v457: Amazon API失败(含422)时，使用本地历史数据推荐引擎
              try {
                // @ts-ignore
                const campaignId = String(firstCampaign.amazonCampaignId || firstCampaign.campaignId || '');
                const localRec = await getLocalKeywordBidRecommendation(
                  config.accountId,
                  adGroupId,
                  campaignId,
                  'sponsoredProducts',
                  config.targetAcos || 0.30,
                );
                if (localRec.source !== 'minimum_default') {
                  suggestedBidData = {
                    suggestedBid: localRec.suggestedBid,
                    rangeStart: localRec.rangeStart,
                    rangeEnd: localRec.rangeEnd,
                  };
                  log.info(`[BidOptimization] v457: 本地推荐引擎提供建议出价 $${localRec.suggestedBid.toFixed(2)} (${localRec.source}, confidence=${localRec.confidence.toFixed(2)}, samples=${localRec.sampleSize})`);
                }
              } catch (localRecErr: unknown) {
                log.debug(`[BidOptimization] v457: 本地推荐引擎异常: ${(localRecErr as Error).message}`);
              }
            }
          }
        }
      }
    } catch (suggestedBidErr: unknown) {
      log.debug(`[BidOptimization] v436 R-01: 建议出价API调用异常: ${(suggestedBidErr as Error).message}`);
    }
  }
  
  // v267 P3-3: 多品类自适应 — 从campaign名称和产品定向中推断品类
  // 品类信息会影响ruleEngineDecision中的提价/降价幅度和metaLearningSelector中的算法选择
  let inferredCategory = 'default';
  try {
    // 从campaign名称和优化目标名称推断品类
    const nameHints = (config.name || '').toLowerCase();
    const categoryKeywords: Record<string, string[]> = {
      'electronics': ['electronic', 'gadget', 'device', 'tech', 'phone', 'tablet', 'laptop', 'computer', 'camera', 'headphone', 'speaker', 'charger', 'cable', 'adapter'],
      'clothing': ['clothing', 'apparel', 'fashion', 'shirt', 'dress', 'pants', 'jacket', 'shoes', 'sneaker', 'boot', 'sock', 'underwear', 'hat', 'scarf'],
      'beauty': ['beauty', 'skincare', 'makeup', 'cosmetic', 'serum', 'cream', 'lotion', 'shampoo', 'conditioner', 'perfume', 'fragrance'],
      'health': ['health', 'supplement', 'vitamin', 'protein', 'fitness', 'wellness', 'medical', 'mask', 'sanitizer'],
      'home_kitchen': ['home', 'kitchen', 'furniture', 'decor', 'appliance', 'cookware', 'bedding', 'towel', 'curtain', 'rug', 'mat', 'storage', 'organizer'],
      'sports_outdoors': ['sport', 'outdoor', 'camping', 'hiking', 'fishing', 'yoga', 'gym', 'exercise', 'bike', 'golf', 'running'],
      'toys_games': ['toy', 'game', 'puzzle', 'lego', 'doll', 'action figure', 'board game', 'card game', 'kids'],
      'baby': ['baby', 'infant', 'toddler', 'diaper', 'stroller', 'crib', 'pacifier', 'bottle', 'nursing'],
      // @ts-ignore
      'pet_supplies': ['pet', 'dog', 'cat', 'fish', 'bird', 'aquarium', 'leash', 'collar', 'treat', 'food pet'],
      'grocery': ['grocery', 'food', 'snack', 'beverage', 'coffee', 'tea', 'organic', 'gluten', 'vegan'],
      'luxury': ['luxury', 'premium', 'designer', 'gold', 'silver', 'diamond', 'jewelry', 'watch', 'handbag'],
    };
    for (const [cat, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(kw => nameHints.includes(kw))) {
        inferredCategory = cat;
        break;
      }
    }
    if (inferredCategory === 'default') {
      // 尝试从Campaign名称中推断
      for (const campaign of (campaigns as unknown[])) {
        // @ts-ignore
        const campName = (campaign.campaignName || '').toLowerCase();
        for (const [cat, keywords] of Object.entries(categoryKeywords)) {
          if (keywords.some(kw => campName.includes(kw))) {
            inferredCategory = cat;
            break;
          }
        }
        if (inferredCategory !== 'default') break;
      }
    }
    log.info(`[BidOptimization] v267 P3-3: 品类推断结果=${inferredCategory} (优化目标: ${config.name})`);
  } catch (catErr: unknown) {
    log.warn(`[BidOptimization] v267 P3-3: 品类推断失败: ${(catErr as Error).message}`);
  }

  const bidConfig: bidOptimizer.PerformanceGroupConfig = {
    optimizationGoal: config.optimizationGoal,
    // v170: 传入策略模板名称，用于策略感知的参数差异化
    strategyTemplate: config.strategyTemplateId,
    targetAcos: config.targetAcos,
    targetRoas: config.targetRoas,
    dailyBudget: config.dailyBudget,
    maxBid: config.maxBid,
    groupAvgCvr,
    groupAvgCpc,
    groupAvgAov,
    // v267 P3-3: 多品类自适应
    productCategory: inferredCategory,
  };
  // v330: 将建议出价数据和CVR来源注入到bidConfig中，供nextGenBidOrchestrator使用
  if (suggestedBidData) {
    bidConfig._suggestedBid = suggestedBidData.suggestedBid;
    bidConfig._suggestedBidRangeStart = suggestedBidData.rangeStart;
    bidConfig._suggestedBidRangeEnd = suggestedBidData.rangeEnd;
  }
  bidConfig._cvrSource = cvrSource;
  
  // v164: 从自我进化引擎获取自适应参数，注入到bidConfig中
  try {
    // 优先使用v164自我进化的自适应参数
    const evoParams = await selfEvolution.getAdaptiveOptimizationParams(config.id, config.strategyTemplateId);
    bidConfig._evolvedMaxChangePercent = evoParams.maxBidIncrease;
    bidConfig._evolvedMaxDecreasePercent = evoParams.maxBidDecrease;
    bidConfig._confidenceMultiplier = evoParams.confidenceMultiplier;
    log.info(`[BidOptimization] v164: 自适应参数已注入 - 最大提升${Math.round(evoParams.maxBidIncrease * 100)}%, 最大降低${Math.round(evoParams.maxBidDecrease * 100)}%, 成功率${Math.round(evoParams.recentSuccessRate * 100)}%`);
  } catch (e: unknown) {
    log.warn(`[BidOptimization] v164: 自适应参数获取失败，使用默认值: ${(e as Error).message}`);
  }
  
  const currentDate = new Date();
  // v165: maxBidLimit严格使用用户配置的max_bid为绝对红线
  // CPC广告默认上限$2.00，VCPM广告默认上限$15.00
  // @ts-ignore
  const cpcMaxBidLimit = config.maxBid || 2.00;
  // @ts-ignore
  const vcpmMaxBidLimit = config.maxBid ? config.maxBid * 5 : 15.00; // VCPM出价单位是每千次展示，通常是CPC的3-10倍
  log.info(`[BidOptimization] v165: CPC最高出价=$${cpcMaxBidLimit} | VCPM最高出价=$${vcpmMaxBidLimit} (用户设置max_bid=${config.maxBid || '未设置'})`);
  log.debug(`[BidOptimization] v165: 日预算=${config.dailyBudget || '未设置'}, 目标ACoS=${config.targetAcos || '未设置'}`);
  
  let bidCampaignIndex = 0;
  for (const campaign of (campaigns as unknown[])) {
    // v476: 广告活动间节流 — 每个广告活动的出价优化间隔5秒，优先保证100%成功率
    if (bidCampaignIndex > 0) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    bidCampaignIndex++;

    // v206: 统一ID提取 — 在循环开头一次性提取，后续代码统一使用
    // @ts-ignore
    const campaignLocalId = getCampaignLocalId(campaign);   // int PK，用于本地DB更新
    // @ts-ignore
    const campaignAmazonId = getCampaignAmazonId(campaign); // varchar，用于查询和API调用
    
    // v163: 获取campaign级别的90天历史每日数据，用于时间衰减加权分析
    let campaignDailyData: Array<{ date: Date; spend: number; sales: number; clicks: number; orders: number }> = [];
    let campaignTimeWeightedMetrics: timeDecayService.TimeWeightedMetrics | null = null;
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90); // v163: 从14天扩展到90天
      const rawDailyData = await db.getDailyPerformanceByDateRange(config.accountId, startDate, endDate, campaignAmazonId);
      campaignDailyData = rawDailyData.map(d => ({
        date: new Date(d.date),
        spend: parseFloat(String(d.spend || '0')),
        sales: parseFloat(String(d.sales || '0')),
        clicks: d.clicks || 0,
        orders: d.orders || 0,
      }));
      // v163: 计算时间衰减加权指标
      const dailyDataForWeighting: timeDecayService.DailyRawData[] = rawDailyData.map(d => ({
        date: typeof d.date === 'string' ? d.date : new Date(d.date).toISOString(),
        impressions: d.impressions || 0,
        clicks: d.clicks || 0,
        spend: parseFloat(String(d.spend || '0')),
        sales: parseFloat(String(d.sales || '0')),
        orders: d.orders || 0,
      }));
      // v491: 使用悬崖感知的时间衰减加权（自动检测数据悬崖并调整窗口权重）
      const cliffAwareMetrics = timeDecayService.calculateCliffAwareTimeWeightedMetrics(dailyDataForWeighting);
      campaignTimeWeightedMetrics = cliffAwareMetrics;
      // @ts-ignore
      if (cliffAwareMetrics.cliffDetection.cliffDetected) {
        log.warn(`[BidOptimization] v491: Campaign ${campaignLocalId} ${cliffAwareMetrics.cliffDetection.diagnosis}`);
      }
      log.debug(`[BidOptimization] v163: Campaign ${campaignLocalId} 时间衰减加权 - 加权ACoS=${campaignTimeWeightedMetrics.weightedAcos.toFixed(1)}%, 加权ROAS=${campaignTimeWeightedMetrics.weightedRoas.toFixed(2)}, 置信度=${campaignTimeWeightedMetrics.dataQuality.confidenceLevel}, 趋势=${campaignTimeWeightedMetrics.trendSignal.direction}`);
    } catch (e: unknown) {
      log.warn(`[BidOptimization] 获取campaign ${campaignLocalId} 历史数据失败: ${(e as Error).message}`);
    }
    
    // v163: 安全检查 - 检测异常信号
    if (campaignTimeWeightedMetrics) {
      const safetyCheck = gradualEngine.performSafetyCheck(campaignTimeWeightedMetrics);
            if (safetyCheck.shouldPause) {
        // @ts-ignore
        log.warn(`[BidOptimization] v163: Campaign ${campaignLocalId} 安全检查触发暂停: ${safetyCheck.reason}`);
        details.push({
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          // @ts-ignore
          campaignName: campaign.campaignName,
          action: 'safety_pause',
          algorithmUsed: 'safety_guard', // v335
          reason: `[安全检查] ${safetyCheck.warnings.join('；')}`,
        });

        // v244: 修复v232过度激进的紧急止损逻辑
        // 原v232行为：单个campaign安全检查触发 → 暂停整个优化目标(autoOptimize=0)
        // 问题：单个campaign的正常波动（如季节性变化、新campaign冷启动）会导致整个优化目标被关闭
        // 修复：跳过该campaign的出价优化，但不暂停整个优化目标，让其他campaign继续正常优化
        // 只有当超过50%的campaign都触发安全暂停时，才记录严重警告（但仍不自动关闭）
        safetyPausedCampaignCount++;
        // @ts-ignore
        log.warn(`[BidOptimization] v244: Campaign ${campaignLocalId} (${campaign.campaignName}) 安全检查触发，跳过该campaign的出价优化（不暂停整个优化目标）`);

        continue; // 跳过该campaign的竞价优化
      }
      if (safetyCheck.warnings.length > 0) {
        log.info(`[BidOptimization] v163: Campaign ${campaignLocalId} 安全警告: ${safetyCheck.warnings.join('；')}`);
      }
    }
    
    // v165: 根据campaign的costType动态设置maxBidLimit（CPC vs VCPM）
    const isVcpmCampaign = (campaign as unknown as Record<string, unknown>).costType === 'vcpm';
    // @ts-ignore
    const maxBidLimit = isVcpmCampaign ? vcpmMaxBidLimit : cpcMaxBidLimit;
    if (isVcpmCampaign) {
      log.info(`[BidOptimization] v165: Campaign ${campaignLocalId} 识别为VCPM广告，使用VCPM最高出价$${maxBidLimit}`);
    }
    
    // v122h: 收集该campaign下所有关键词，构建EnhancedOptimizationTarget
    const keywords = await db.getKeywordsByCampaignId(campaignAmazonId);
    const keywordTargets: bidOptimizer.EnhancedOptimizationTarget[] = [];
    
    for (const keyword of keywords) {
      // v454: 跳过Amazon端已不存在的关键词，避免无效同步
      if (keyword.keywordStatus === 'amazon_deleted') continue;
      if (keyword.keywordStatus !== 'enabled') continue;
      const currentBid = parseFloat(keyword.bid || '0');
      if (currentBid <= 0) continue;
      
      // v166: 关键词级别冷却期检查 - 避免重复优化
      // 如果该keyword在过去24小时内已被优化，且出价同步状态仍为pending_confirmation，则跳过
      // @ts-ignore
      const kwLastOptimized = (keyword as unknown as Record<string, unknown>).lastOptimizedAt ? new Date((keyword as unknown as Record<string, unknown>).lastOptimizedAt) : null;
      // @ts-ignore
      const kwBidSyncStatus = (keyword as unknown as Record<string, unknown>).bidSyncStatus || 'synced';
      // @ts-ignore
      if (kwLastOptimized && kwBidSyncStatus === 'pending_confirmation') {
        const hoursSinceOptimized = (Date.now() - kwLastOptimized.getTime()) / (1000 * 60 * 60);
        if (hoursSinceOptimized < 24) {
          log.info(`[BidOptimization] v166: 跳过关键词 ${keyword.id} "${keyword.keywordText}" - 冷却期内(${hoursSinceOptimized.toFixed(1)}h), 出价待确认 pending=$${(keyword as unknown as Record<string, unknown>).pendingBid}`);
          continue;
        }
      }
      
      keywordTargets.push({
        id: keyword.id,
        type: 'keyword',
        currentBid,
        impressions: keyword.impressions || 0,
        clicks: keyword.clicks || 0,
        spend: parseFloat(keyword.spend || '0'),
        sales: parseFloat(keyword.sales || '0'),
        orders: keyword.orders || 0,
        matchType: keyword.matchType,
        // @ts-ignore
        campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : undefined,
        // @ts-ignore
        historicalAvgImpressions: campaign.impressions ? Math.round(campaign.impressions / 30) : undefined, // v163: 基于30天估算
        // v163: 传入campaign级别的90天每日数据用于时间衰减加权分析
        dailyData: campaignDailyData.length > 0 ? campaignDailyData : undefined,
        marketplace: config.marketplace,
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // v491: 传入每个keyword自身的suggestedBid/Low/High，供Nash引擎和冷启动引擎使用
        // @ts-ignore
        suggestedBid: keyword.suggestedBid ? parseFloat(String(keyword.suggestedBid)) : undefined,
        // @ts-ignore
        suggestedBidRangeStart: keyword.suggestedBidLow ? parseFloat(String(keyword.suggestedBidLow)) : undefined,
        suggestedBidRangeEnd: keyword.suggestedBidHigh ? parseFloat(String(keyword.suggestedBidHigh)) : undefined,
        keywordText: keyword.keywordText,
        // v515: 传入internalAdGroupId供RLDataRecorder和冷启动引擎使用
        internalAdGroupId: keyword.internalAdGroupId,
      });
    }
    
    // v198: NextGen统一出价引擎 — 100%使用NextGen算法，内部自动降级，无需回退到旧算法
    if (keywordTargets.length > 0) {
      const nextGenResults = await nextGenOrchestrator.batchCalculateNextGenBids(
        config.accountId, keywordTargets, bidConfig, maxBidLimit
      );
      
      for (const nextGenResult of nextGenResults) {
        // NextGen保证每个target都有结果，无需null检查
        let finalBid = nextGenResult.newBid;
        
        // v434: 绝对红线校验 — 使用bid constraints模块动态获取最低/最高竞价
        // 根据campaign类型(SP/SB/SD)、计费方式(CPC/vCPM)、广告格式(Standard/Video)和市场确定正确约束
        const campType = (campaign as unknown as Record<string, unknown>).campaignType || 'sp_manual';
        const campCostType = (campaign as unknown as Record<string, unknown>).costType || 'cpc';
        const campAdFormat = (campaign as unknown as Record<string, unknown>).ad_format || (campaign as unknown as Record<string, unknown>).adFormat || null;
        const campMarketplace = config.marketplace || 'US';
        // @ts-ignore
        const { clampedBid: kwClampedBid, wasAdjusted: kwWasAdjusted, constraint: kwConstraint, adTypeKey: kwAdTypeKey } = clampBidToConstraint(finalBid, campType, campMarketplace, campCostType, campAdFormat);
        finalBid = Math.min(kwClampedBid, maxBidLimit);
        finalBid = Math.round(finalBid * 100) / 100;
        if (kwWasAdjusted) {
          log.info(`[BidOptimization] v434: keyword ${nextGenResult.targetId} bid $${nextGenResult.newBid.toFixed(2)} 超出${kwAdTypeKey}约束[$${kwConstraint.minBid}~$${kwConstraint.maxBid}]，调整为$${finalBid} (marketplace=${campMarketplace})`);
        }
        
        // v504: 系统防线检查 — 阻止死亡螺旋/紧急模式下的加价操作，阻止被熔断算法的操作
        if (nextGenResult.actionType !== 'hold' && Math.abs(finalBid - nextGenResult.previousBid) > 0.01) {
          // v504: 如果是加价操作，检查是否被系统防线阻止
          if (finalBid > nextGenResult.previousBid) {
            try {
              const { isAccountBidIncreaseBlocked } = await import('../system/systemDefenseService');
              const blockCheck = await isAccountBidIncreaseBlocked(config.accountId);
              if (blockCheck.blocked) {
                log.info(`[BidOptimization] v504: 系统防线阻止加价 - keyword ${nextGenResult.targetId} $${nextGenResult.previousBid}→$${finalBid} 被阻止. 原因: ${blockCheck.reason}`);
                continue; // 跳过此加价操作
              }
            } catch (defenseErr: any) {
              // 防线检查失败不阻塞正常流程
              log.warn(`[BidOptimization] v504: 系统防线检查异常: ${(defenseErr as Error).message}`);
            // @ts-ignore
            }
          }
          // v504: 检查算法是否被熔断
          if (nextGenResult.algorithmUsed) {
            try {
              const { isAlgorithmCircuitBroken } = await import('../system/systemDefenseService');
              const isBroken = await isAlgorithmCircuitBroken(nextGenResult.algorithmUsed);
              if (isBroken) {
                log.info(`[BidOptimization] v504: 算法${nextGenResult.algorithmUsed}已熔断，跳过其出价建议 - keyword ${nextGenResult.targetId}`);
                continue; // 跳过被熔断算法的操作
              }
            } catch (algoErr: any) {
              log.warn(`[BidOptimization] v504: 算法熔断检查异常: ${(algoErr as Error).message}`);
            }
          }
          const keyword = keywords.find(k => k.id === nextGenResult.targetId);
          
          // v646: 检测keywords表中混入的targeting表达式（ASIN/类目定位）
          // 这些记录的keywordId是文本表达式而非数字ID，需要重定向到product target API路径
          const kwId = keyword?.keywordId || '';
          const isTargetingExpression = kwId !== '' && !/^\d+$/.test(kwId.trim());
          if (isTargetingExpression) {
            log.info(`[BidOptimization] v646: 检测到keywords表中的targeting表达式 - keyword ${nextGenResult.targetId} keywordId="${kwId}"，标记为isProductTarget`);
          }
          
          details.push({
            keywordId: nextGenResult.targetId,
            // v646: 如果是targeting表达式，需要通过productTargetId传递，使其走product target路径
            ...(isTargetingExpression ? { productTargetId: nextGenResult.targetId } : {}),
            amazonKeywordId: keyword?.keywordId || '', // v255: 传入真正的Amazon keyword ID，修复PostOptVerifier验证失败
            adGroupId: keyword?.internalAdGroupId, // v421: 使用internalAdGroupId(int)用于PostOptVerifier精确回查
            keywordText: keyword?.keywordText || `关键词 ${nextGenResult.targetId}`,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            currentBid: nextGenResult.previousBid,
            newBid: finalBid,
            changePercent: ((finalBid - nextGenResult.previousBid) / nextGenResult.previousBid * 100).toFixed(2),
            reason: isTargetingExpression ? `商品定向(keywords表) - ${nextGenResult.reason}` : nextGenResult.reason,
            // v646: targeting表达式标记为isProductTarget，走正确的API路径
            // @ts-ignore
            isProductTarget: isTargetingExpression ? true : undefined,
            algorithmUsed: nextGenResult.algorithmUsed,
            confidenceScore: nextGenResult.confidence,
            algorithmTier: nextGenResult.algorithmTier,
            // v258: 传递结构化归因和护栏信息
            reasonDetails: nextGenResult.reasonDetails,
            guardrailInfo: nextGenResult.guardrailInfo,
            // v337: 传递修正层标记和Meta-Learning决策详情
            correctionLayers: nextGenResult.correctionLayers,
            metaLearningDetail: nextGenResult.metaLearningDetail,
            gtoModifier: nextGenResult.gtoModifier,
            causalAdjustment: nextGenResult.causalAdjustment,
            // v512: 传递campaignType用于SB/SD验证路由
            campaignType: (campaign as unknown as Record<string, unknown>).campaignType || 'sp',
          });
          if (!dryRun) adjustmentsCount++;
        }
      }
    }
    
    // v122h: 商品定向也使用UCB增强版算法
    const adGroupsList = await db.getAdGroupsByCampaignId(campaignAmazonId);
    const productTargets: bidOptimizer.EnhancedOptimizationTarget[] = [];
    const allTargets: unknown[] = [];
    
    // v345: 优化N+1查询 — 批量获取所有广告组的商品定向
    const adGroupIds = adGroupsList.map(ag => ag.id);
    const allTargetsFromDb = await db.getProductTargetsByAdGroupIds(adGroupIds);
    
    for (const target of allTargetsFromDb) {
      if (target.targetStatus !== 'enabled') continue;
      let currentBid = parseFloat(target.bid || '0');
      
      // v512: 对于bid=0的记录，检查是否是自动广告匹配对象或SB/SD投放对象
      // 这些记录的bid可能因同步层未获取到真实值而为0
      const AUTO_TARGET_VALUES = ['CLOSE_MATCH', 'LOOSE_MATCH', 'SUBSTITUTES', 'COMPLEMENTS'];
      const isAutoTarget = AUTO_TARGET_VALUES.includes(target.targetValue || '');
      
      if (currentBid <= 0) {
        if (isAutoTarget) {
          // v512: 自动广告匹配对象bid未知，使用广告组默认出价作为基础
          const parentAdGroup = adGroupsList.find(ag => ag.id === target.internalAdGroupId);
          const defaultBid = parseFloat(parentAdGroup?.defaultBid || '0');
          // @ts-ignore
          if (defaultBid > 0) {
            // @ts-ignore
            currentBid = defaultBid;
            log.info(`[v512] 自动广告匹配对象 ${target.targetValue} (target ${target.id}) bid=0，使用广告组默认出价 $${defaultBid}`);
          } else {
            // 广告组默认出价也为0，跳过
            log.debug(`[v512] 自动广告匹配对象 ${target.targetValue} (target ${target.id}) bid=0且广告组默认出价也为0，跳过`);
            continue;
          // @ts-ignore
          }
        } else {
          continue;
        }
      }
      
      allTargets.push(target);
      productTargets.push({
        id: target.id,
        type: 'product_target',
        currentBid,
        impressions: target.impressions || 0,
        clicks: target.clicks || 0,
        spend: parseFloat(target.spend || '0'),
        sales: parseFloat(target.sales || '0'),
        orders: target.orders || 0,
        matchType: target.targetMatchType || 'exact',
        // @ts-ignore
        campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : undefined,
        // @ts-ignore
        historicalAvgImpressions: campaign.impressions ? Math.round(campaign.impressions / 30) : undefined, // v163
        dailyData: campaignDailyData.length > 0 ? campaignDailyData : undefined,
        marketplace: config.marketplace,
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // v491: 传入每个target自身的suggestedBid/Low/High，供Nash引擎和冷启动引擎使用
        // @ts-ignore
        suggestedBid: target.suggestedBid ? parseFloat(String(target.suggestedBid)) : undefined,
        suggestedBidRangeStart: target.suggestedBidLow ? parseFloat(String(target.suggestedBidLow)) : undefined,
        suggestedBidRangeEnd: target.suggestedBidHigh ? parseFloat(String(target.suggestedBidHigh)) : undefined,
        // v515: 传入internalAdGroupId供RLDataRecorder和冷启动引擎使用
        internalAdGroupId: target.internalAdGroupId,
      });
    }
    
    // v512: SD受众定向优化 — 查询SD受众并加入优化流程
    const sdAudienceTargets: bidOptimizer.EnhancedOptimizationTarget[] = [];
    const allSdAudiences: unknown[] = [];
    
    // v512: 检查campaign类型是否为SD，只有SD campaign才有受众定向
    const campTypeStr = String((campaign as unknown as Record<string, unknown>).campaignType || '').toLowerCase();
    if (campTypeStr.includes('sd')) {
      try {
        const { getSdAudiencesByAdGroupIds } = await import('../db/sdAudiences');
        const sdAudiencesFromDb = await getSdAudiencesByAdGroupIds(adGroupIds);
        
        for (const audience of sdAudiencesFromDb) {
          if (audience.state !== 'enabled') continue;
          const currentBid = parseFloat(audience.bid || '0');
          if (currentBid <= 0) {
            // v512: SD受众bid为0时使用广告组默认出价
            const parentAdGroup = adGroupsList.find(ag => ag.id === audience.internalAdGroupId);
            const defaultBid = parseFloat(parentAdGroup?.defaultBid || '0');
            if (defaultBid <= 0) continue;
            log.info(`[v512] SD受众 ${audience.audienceType} (id=${audience.id}) bid=0，使用广告组默认出价 $${defaultBid}`);
            allSdAudiences.push(audience);
            sdAudienceTargets.push({
              // @ts-ignore
              id: audience.id,
              type: 'product_target', // 复用product_target类型，因为SD受众在Amazon API中也是target
              currentBid: defaultBid,
              impressions: audience.impressions || 0,
              clicks: audience.clicks || 0,
              spend: parseFloat(audience.spend || '0'),
              sales: parseFloat(audience.sales || '0'),
              orders: audience.orders || 0,
              matchType: 'exact',
              // @ts-ignore
              campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : undefined,
              dailyData: campaignDailyData.length > 0 ? campaignDailyData : undefined,
              marketplace: config.marketplace,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // v515: 传入internalAdGroupId供RLDataRecorder使用
              internalAdGroupId: audience.internalAdGroupId,
            });
          } else {
            allSdAudiences.push(audience);
            sdAudienceTargets.push({
              id: audience.id,
              type: 'product_target',
              currentBid,
              impressions: audience.impressions || 0,
              clicks: audience.clicks || 0,
              spend: parseFloat(audience.spend || '0'),
              sales: parseFloat(audience.sales || '0'),
              orders: audience.orders || 0,
              matchType: 'exact',
              // @ts-ignore
              campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : undefined,
              dailyData: campaignDailyData.length > 0 ? campaignDailyData : undefined,
              // @ts-ignore
              marketplace: config.marketplace,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // v515: 传入internalAdGroupId供RLDataRecorder使用
              internalAdGroupId: audience.internalAdGroupId,
            });
          }
        }
        
        if (sdAudienceTargets.length > 0) {
          log.info(`[v512] SD campaign ${campaignLocalId} 发现 ${sdAudienceTargets.length} 个受众定向待优化`);
        }
      } catch (sdAudErr: unknown) {
        log.warn(`[v512] SD受众查询失败(不阻塞主流程): ${(sdAudErr as Error).message}`);
      }
    }
    
    // v512: SD受众定向使用NextGen统一出价引擎
    if (sdAudienceTargets.length > 0) {
      const nextGenSdAudResults = await nextGenOrchestrator.batchCalculateNextGenBids(
        config.accountId, sdAudienceTargets, bidConfig, maxBidLimit
      );
      
      for (const nextGenResult of nextGenSdAudResults) {
        let finalBid = nextGenResult.newBid;
        
        // v512: SD受众也使用bid constraints
        const sdCampType = 'sd';
        const sdCostType = (campaign as unknown as Record<string, unknown>).costType || 'cpc';
        const sdAdFormat = (campaign as unknown as Record<string, unknown>).ad_format || (campaign as unknown as Record<string, unknown>).adFormat || null;
        // @ts-ignore
        const sdMarketplace = config.marketplace || 'US';
        // @ts-ignore
        const { clampedBid: sdClampedBid, wasAdjusted: sdWasAdjusted, constraint: sdConstraint, adTypeKey: sdAdTypeKey } = clampBidToConstraint(finalBid, sdCampType, sdMarketplace, sdCostType, sdAdFormat);
        finalBid = Math.min(sdClampedBid, maxBidLimit);
        // @ts-ignore
        finalBid = Math.round(finalBid * 100) / 100;
        // @ts-ignore
        if (sdWasAdjusted) {
          // @ts-ignore
          log.info(`[v512] SD受众 ${nextGenResult.targetId} bid $${nextGenResult.newBid.toFixed(2)} 超出${sdAdTypeKey}约束[$${sdConstraint.minBid}~$${sdConstraint.maxBid}]，调整为$${finalBid}`);
        }
        
        // @ts-ignore
        if (nextGenResult.actionType !== 'hold' && Math.abs(finalBid - nextGenResult.previousBid) > 0.01) {
          // v512: 系统防线检查
          if (finalBid > nextGenResult.previousBid) {
            try {
              const { isAccountBidIncreaseBlocked } = await import('../system/systemDefenseService');
              const blockCheck = await isAccountBidIncreaseBlocked(config.accountId);
              if (blockCheck.blocked) {
                log.info(`[v512] 系统防线阻止SD受众加价 - audience ${nextGenResult.targetId} 被阻止`);
                continue;
              }
            } catch { /* 防线检查失败不阻塞 */ }
          }
          if (nextGenResult.algorithmUsed) {
            try {
              const { isAlgorithmCircuitBroken } = await import('../system/systemDefenseService');
              if (await isAlgorithmCircuitBroken(nextGenResult.algorithmUsed)) {
                log.info(`[v512] 算法${nextGenResult.algorithmUsed}已熔断，跳过SD受众 - audience ${nextGenResult.targetId}`);
                continue;
              }
            } catch { /* 熔断检查失败不阻塞 */ }
          }
          // @ts-ignore
          const audience = allSdAudiences.find(a => a.id === nextGenResult.targetId);
          details.push({
            keywordId: nextGenResult.targetId,
            productTargetId: nextGenResult.targetId,
            // @ts-ignore
            amazonKeywordId: audience?.audienceId || String(nextGenResult.targetId), // audienceId实际上是Amazon的targetId
            // @ts-ignore
            adGroupId: audience?.internalAdGroupId,
            // @ts-ignore
            keywordText: audience?.audienceName || `SD受众 ${audience?.audienceType || ''} ${nextGenResult.targetId}`,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            currentBid: nextGenResult.previousBid,
            // @ts-ignore
            newBid: finalBid,
            changePercent: ((finalBid - nextGenResult.previousBid) / nextGenResult.previousBid * 100).toFixed(2),
            reason: `SD受众定向 - ${nextGenResult.reason}`,
            isProductTarget: true,
            isSdAudience: true, // v512: 标记为SD受众，用于API同步和DB更新路由
            campaignType: 'sd', // v512: SD受众始终属于SD campaign
            algorithmUsed: nextGenResult.algorithmUsed,
            confidenceScore: nextGenResult.confidence,
            algorithmTier: nextGenResult.algorithmTier,
            reasonDetails: nextGenResult.reasonDetails,
            guardrailInfo: nextGenResult.guardrailInfo,
            correctionLayers: nextGenResult.correctionLayers,
            metaLearningDetail: nextGenResult.metaLearningDetail,
            gtoModifier: nextGenResult.gtoModifier,
            causalAdjustment: nextGenResult.causalAdjustment,
          });
          if (!dryRun) adjustmentsCount++;
        }
      }
    }
    
    // v198: 商品定向也使用NextGen统一出价引擎 — 100%覆盖，无回退
    if (productTargets.length > 0) {
      const nextGenPtResults = await nextGenOrchestrator.batchCalculateNextGenBids(
        config.accountId, productTargets, bidConfig, maxBidLimit
      );
      
      for (const nextGenResult of nextGenPtResults) {
        // @ts-ignore
        let finalBid = nextGenResult.newBid;
        
        // v434: 绝对红线校验 — 商品定向也使用bid constraints模块
        const ptCampType = (campaign as unknown as Record<string, unknown>).campaignType || 'sp_manual';
        // @ts-ignore
        const ptCostType = (campaign as unknown as Record<string, unknown>).costType || 'cpc';
        // @ts-ignore
        const ptAdFormat = (campaign as unknown as Record<string, unknown>).ad_format || (campaign as unknown as Record<string, unknown>).adFormat || null;
        // @ts-ignore
        const ptMarketplace = config.marketplace || 'US';
        // @ts-ignore
        const { clampedBid: ptClampedBid, wasAdjusted: ptWasAdjusted, constraint: ptConstraint, adTypeKey: ptAdTypeKey } = clampBidToConstraint(finalBid, ptCampType, ptMarketplace, ptCostType, ptAdFormat);
        // @ts-ignore
        finalBid = Math.min(ptClampedBid, maxBidLimit);
        finalBid = Math.round(finalBid * 100) / 100;
        if (ptWasAdjusted) {
          log.info(`[BidOptimization] v434: product target ${nextGenResult.targetId} bid $${nextGenResult.newBid.toFixed(2)} 超出${ptAdTypeKey}约束[$${ptConstraint.minBid}~$${ptConstraint.maxBid}]，调整为$${finalBid} (marketplace=${ptMarketplace})`);
        }
        
        if (nextGenResult.actionType !== 'hold' && Math.abs(finalBid - nextGenResult.previousBid) > 0.01) {
          // v504: 系统防线检查 — 商品定向加价也需要检查
          if (finalBid > nextGenResult.previousBid) {
            try {
              const { isAccountBidIncreaseBlocked } = await import('../system/systemDefenseService');
              const blockCheck = await isAccountBidIncreaseBlocked(config.accountId);
              if (blockCheck.blocked) {
                log.info(`[BidOptimization] v504: 系统防线阻止商品定向加价 - target ${nextGenResult.targetId} 被阻止`);
                continue;
              }
            } catch { /* 防线检查失败不阻塞 */ }
          }
          if (nextGenResult.algorithmUsed) {
            try {
              const { isAlgorithmCircuitBroken } = await import('../system/systemDefenseService');
              if (await isAlgorithmCircuitBroken(nextGenResult.algorithmUsed)) {
                log.info(`[BidOptimization] v504: 算法${nextGenResult.algorithmUsed}已熔断，跳过商品定向 - target ${nextGenResult.targetId}`);
                continue;
              }
            } catch { /* 熔断检查失败不阻塞 */ }
          }
          // @ts-ignore
          const target = allTargets.find(t => t.id === nextGenResult.targetId);
          details.push({
            keywordId: nextGenResult.targetId, // v230: 保持向后兼容，商品定向也用keywordId字段传递本地ID
            productTargetId: nextGenResult.targetId, // v230: 新增显式的productTargetId字段
            // @ts-ignore
            amazonKeywordId: target?.targetId || '', // v255: 传入真正的Amazon target ID，修复PostOptVerifier验证失败
            // @ts-ignore
            adGroupId: target?.adGroupId, // v255: 传入adGroupId用于PostOptVerifier精确回查
            // @ts-ignore
            keywordText: target?.targetText || target?.targetValue || `商品定向 ${nextGenResult.targetId}`,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            currentBid: nextGenResult.previousBid,
            newBid: finalBid,
            changePercent: ((finalBid - nextGenResult.previousBid) / nextGenResult.previousBid * 100).toFixed(2),
            reason: `商品定向 - ${nextGenResult.reason}`,
            // @ts-ignore
            isProductTarget: true,
            // @ts-ignore
            algorithmUsed: nextGenResult.algorithmUsed,
            confidenceScore: nextGenResult.confidence,
            algorithmTier: nextGenResult.algorithmTier,
            // v258: 传递结构化归因和护栏信息
            reasonDetails: nextGenResult.reasonDetails,
            guardrailInfo: nextGenResult.guardrailInfo,
            // v337: 传递修正层标记和Meta-Learning决策详情
            correctionLayers: nextGenResult.correctionLayers,
            metaLearningDetail: nextGenResult.metaLearningDetail,
            gtoModifier: nextGenResult.gtoModifier,
            causalAdjustment: nextGenResult.causalAdjustment,
            // v512: 传递campaignType用于SB/SD验证路由
            campaignType: (campaign as unknown as Record<string, unknown>).campaignType || 'sp',
          });
          if (!dryRun) adjustmentsCount++;
        }
      }
    }
  }
  
  // v148+v123: 先批量同步出价调整到 Amazon API，确认成功后再更新本地DB
  // v333: 更新类型定义以包含apiResponseId
  let apiSyncResult: { success: number; failed: number; errors: string[]; itemResults?: Map<number, { status: 'synced' | 'failed'; error?: string; apiResponseId?: string }> } = { success: 0, failed: 0, errors: [] };
  let apiSyncStatus: 'pending' | 'synced' | 'failed' | 'partial' = 'pending';
  
  if (!dryRun && details.length > 0) {
    try {
      const accountId = config.accountId;
      
      // v141: 补偿同步已移至统一的Pre-Sync ID Resolution层 (amazonIdResolver.ts)
      // 在executeOptimizationTarget入口处统一执行，所有优化模块共享
      // 旧的v130/v138补偿同步代码已在v141中删除
      
      // v224: 过滤掉safety_pause等非出价调整记录，它们没有keywordId和newBid字段
      const syncableDetails = details.filter(d => d.keywordId && d.newBid !== undefined && d.action !== 'safety_pause');
      const nonSyncableDetails = details.filter(d => !d.keywordId || d.newBid === undefined || d.action === 'safety_pause');
      
      // @ts-ignore
      if (nonSyncableDetails.length > 0) {
        log.info(`[BidOptimization] v224: ${nonSyncableDetails.length}条非出价调整记录(safety_pause等)已跳过API同步`);
        for (const d of (nonSyncableDetails as unknown[])) {
          // @ts-ignore
          d.apiSyncStatus = 'not_applicable';
          // @ts-ignore
          d.apiSyncDetail = JSON.stringify({ status: 'not_applicable', error: null, reason: '非出价调整记录(safety_pause)' });
        }
      }
      
      apiSyncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
        accountId,
        // @ts-ignore
        syncableDetails.map(d => ({
          // @ts-ignore
          keywordId: d.keywordId,
          newBid: d.newBid,
          campaignId: d.amazonCampaignId,
          reason: d.reason,
          // @ts-ignore
          isProductTarget: d.isProductTarget || false,
          algorithmUsed: d.algorithmUsed, // v334: 传递算法标识到biddingLogs
        }))
      );
      
      if (apiSyncResult.failed === 0 && apiSyncResult.success > 0) {
        apiSyncStatus = 'synced';
      } else if (apiSyncResult.success === 0) {
        apiSyncStatus = 'failed';
      } else {
        // @ts-ignore
        apiSyncStatus = 'partial';
      }
      
      log.warn(`[BidOptimization] Amazon API同步: 成功=${apiSyncResult.success}, 失败=${apiSyncResult.failed}, 状态=${apiSyncStatus}`);
      if (apiSyncResult.errors.length > 0) {
        log.warn(`[BidOptimization] Amazon API同步错误:`, apiSyncResult.errors.join('; '));
      }
      
      // v148: API调用成功后，才更新本地数据库（先API后DB原则）
      // v148: 使用事务保护批量DB更新，确保原子性
      // v224: 只从可同步的details中过滤，避免safety_pause等非出价调整记录干扰
      const syncedDetails = syncableDetails.filter(d => {
        // @ts-ignore
        const itemResult = apiSyncResult.itemResults?.get(d.keywordId);
        return itemResult?.status === 'synced';
      });
      const skippedDetails = syncableDetails.filter(d => {
        // @ts-ignore
        const itemResult = apiSyncResult.itemResults?.get(d.keywordId);
        // @ts-ignore
        return itemResult?.status !== 'synced';
      });
      
      if (syncedDetails.length > 0) {
        const dbConn = await getDb();
        if (dbConn) {
          try {
            await dbConn.transaction(async (tx) => {
              for (const detail of syncedDetails) {
                if (detail.isSdAudience) {
                  // v512: SD受众出价更新到sd_audiences表
                  await tx.update(sdAudiencesTable)
                    .set({ bid: (typeof detail.newBid === 'number' ? detail.newBid : 0).toFixed(2) })
                    // @ts-ignore
                    .where(eq(sdAudiencesTable.id, detail.keywordId));
                } else if (detail.isProductTarget) {
                  await tx.update(productTargetsTable)
                    .set({ bid: (typeof detail.newBid === 'number' ? detail.newBid : 0).toFixed(2) })
                    // @ts-ignore
                    .where(eq(productTargetsTable.id, detail.keywordId));
                } else {
                  // v166: 更新bid的同时，标记pending状态和优化时间
                  await tx.update(keywordsTable)
                    .set({
                      bid: (typeof detail.newBid === 'number' ? detail.newBid : 0).toFixed(2),
                      lastOptimizedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
                      pendingBid: (typeof detail.newBid === 'number' ? detail.newBid : 0).toFixed(2),
                      bidSyncStatus: 'pending_confirmation',
                    } as Record<string, unknown>)
                    // @ts-ignore
                    .where(eq(keywordsTable.id, detail.keywordId));
                }
              }
              // v178/v206: 更新所有受影响的campaigns的last_optimized_at（使用本地int ID）
              const affectedCampaignIds = [...new Set(syncedDetails.map(d => d.localCampaignId))];
              const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
              for (const cid of affectedCampaignIds) {
                await tx.update(campaignsTable)
                  .set({ lastOptimizedAt: nowStr } as Record<string, unknown>)
                  // @ts-ignore
                  .where(eq(campaignsTable.id, cid));
              }
            });
            log.info(`[BidOptimization] v178: 事务批量DB更新成功: ${syncedDetails.length}条出价 + campaigns.last_optimized_at已更新`);
            
            // v361: 记录出价调整审计日志
            for (const detail of syncedDetails) {
              auditBidChange(
                0, // system user
                accountId,
                // @ts-ignore
                detail.keywordId,
                detail.keywordText || '',
                typeof detail.previousBid === 'number' ? detail.previousBid : 0,
                typeof detail.newBid === 'number' ? detail.newBid : 0,
                'system'
              );
            }
            
            // v230: 记录出价-绩效历史数据到 bidPerformanceHistory 表，为Sigmoid曲线拟合提供训练数据
            try {
              const { batchRecordBidPerformanceHistory } = await import('../algorithm/rlDataRecorder');
              const bidPerfRecords = syncedDetails.map(d => ({
                accountId: config.accountId,
                campaignId: String(d.amazonCampaignId || d.localCampaignId),
                bidObjectType: (d.isSdAudience ? 'audience' : d.isProductTarget ? 'asin' : 'keyword') as 'keyword' | 'asin' | 'audience',
                bidObjectId: d.keywordId,
                bid: typeof d.newBid === 'number' ? d.newBid : 0,
              }));
              // @ts-ignore
              const bphResult = await batchRecordBidPerformanceHistory(bidPerfRecords);
              // @ts-ignore
              log.info(`[BidOptimization] v230: bidPerformanceHistory写入: recorded=${bphResult.recorded}, failed=${bphResult.failed}`);
            } catch (bphErr: unknown) {
              log.warn(`[BidOptimization] v230: bidPerformanceHistory写入失败(不阻塞主流程): ${(bphErr as Error).message}`);
            }
          } catch (txErr: unknown) {
            log.warn(`[BidOptimization] v178: 事务DB更新失败(已回滚): ${(txErr as Error).message}`);
            // 事务失败时，所有DB更新自动回滚，保持数据一致性
          }
        }
      }
      
      for (const detail of skippedDetails) {
        log.warn(`[BidOptimization] v148: API同步失败，跳过DB更新: targetId=${detail.keywordId}`);
      }
      
      // v166: 注册优化后验证任务 - 延迟45秒后从 Amazon 回查确认
      if (syncedDetails.length > 0) {
        try {
          postOptVerifier.scheduleBidVerification(
            config.accountId,
            // @ts-ignore
            syncedDetails.map(d => ({
              localKeywordId: d.keywordId,
              amazonKeywordId: d.amazonKeywordId || String(d.keywordId),
              expectedBid: d.newBid,
              campaignId: d.amazonCampaignId,
              adGroupId: d.adGroupId,
              isProductTarget: d.isProductTarget || false,
              // v512: 传递campaignType和isSdAudience用于SB/SD/SD受众验证路由
              campaignType: d.campaignType || '',
              isSdAudience: d.isSdAudience || false,
            }))
          );
          log.info(`[BidOptimization] v166: 已注册${syncedDetails.length}个出价验证任务`);
        } catch (verifyErr: unknown) {
          log.warn(`[BidOptimization] v166: 注册验证任务失败(不影响主流程): ${(verifyErr as Error).message}`);
        }
      }
    } catch (apiError: unknown) {
      apiSyncStatus = 'failed';
      apiSyncResult.errors.push((apiError as Error).message);
      log.warn(`[BidOptimization] Amazon API同步异常:`, (apiError as Error).message);
      // v148: API整体异常，不更新任何本地DB记录
      log.warn(`[BidOptimization] v148: API整体异常，所有本地DB更新已跳过`);
    }
  } else if (dryRun) {
    apiSyncStatus = 'pending'; // 模拟模式不同步
  }
  
  // v140: 将每条调整的独立同步状态附加到详情中（而非批量状态）
  // v224: 跳过已在前面设置了apiSyncStatus的非出价调整记录(safety_pause等)
  for (const detail of details) {
    if (detail.apiSyncStatus === 'not_applicable') continue; // v224: safety_pause等已处理
    // @ts-ignore
    const itemResult = apiSyncResult.itemResults?.get(detail.keywordId);
    if (itemResult) {
      // 使用该条目自身的同步状态
      detail.apiSyncStatus = itemResult.status; // 'synced' | 'failed'
      // v333: 将apiResponseId传递到detail中，供后续日志记录使用
      detail.apiResponseId = itemResult.apiResponseId || null;
      detail.apiSyncDetail = JSON.stringify({
        status: itemResult.status,
        error: itemResult.error || null,
        apiResponseId: itemResult.apiResponseId || null,
      });
    } else if (dryRun) {
      detail.apiSyncStatus = 'pending';
      detail.apiSyncDetail = JSON.stringify({ status: 'pending', error: null });
    } else {
      // 未在itemResults中找到（理论上不应发生），使用批量状态作为降级
      detail.apiSyncStatus = apiSyncStatus;
      detail.apiSyncDetail = JSON.stringify({
        status: apiSyncStatus,
        error: '未获取到单条同步状态',
      });
    }
  }
  
  // v244: 汇总安全检查结果
  if (safetyPausedCampaignCount > 0) {
    const totalCampaigns = campaigns.length;
    const pauseRatio = safetyPausedCampaignCount / totalCampaigns;
    const summaryMsg = `v244: 优化目标"${config.name}" 安全检查汇总 - ${safetyPausedCampaignCount}/${totalCampaigns}个campaign触发安全暂停(${(pauseRatio * 100).toFixed(0)}%)，已跳过这些campaign的出价优化`;
    if (pauseRatio > 0.5) {
      log.warn(`[BidOptimization] ${summaryMsg} - 超过50%campaign触发安全暂停，建议人工检查`);
    } else {
      log.warn(`[BidOptimization] ${summaryMsg}`);
    }
    details.push({ action: 'safety_summary', algorithmUsed: 'safety_guard', reason: summaryMsg, safetyPausedCount: safetyPausedCampaignCount, totalCampaigns, pauseRatio });
  }

  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details, apiSyncResult, apiSyncStatus };
}

/**
 * 执行位置优化
 */
