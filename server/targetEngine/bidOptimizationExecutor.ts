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
import { keywords as keywordsTable, productTargets as productTargetsTable, campaigns as campaignsTable } from "../../drizzle/schema";
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
    totalClicks += (c.clicks || 0);
    totalOrders += (c.orders || 0);
    totalSpend += parseFloat(c.spend || '0');
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
        }
      }
      if (earlyCategory === 'default') {
        for (const campaign of (campaigns as unknown[])) {
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
  
  // v436: 建议出价获取 — 优先从数据库读取已同步的建议竞价，仅在无数据时回退到实时API调用
  let suggestedBidData: { suggestedBid?: number; rangeStart?: number; rangeEnd?: number } | null = null;
  
  // v436: 策略一 — 从数据库读取已同步的建议竞价（优先）
  try {
    const firstCampaign = campaigns[0] as unknown;
    if (firstCampaign && firstCampaign.adGroups && firstCampaign.adGroups.length > 0) {
      const firstAdGroup = firstCampaign.adGroups[0];
      // 检查该adGroup下的keyword/target是否有已同步的建议竞价
      if (firstAdGroup.keywords && firstAdGroup.keywords.length > 0) {
        for (const kw of firstAdGroup.keywords) {
          if (kw.suggestedBid && Number(kw.suggestedBid) > 0) {
            suggestedBidData = {
              suggestedBid: Number(kw.suggestedBid),
              rangeStart: Number(kw.suggestedBidLow) || 0,
              rangeEnd: Number(kw.suggestedBidHigh) || 0,
            };
            log.info(`[BidOptimization] v436: 从数据库获取到建议出价 suggestedBid=$${suggestedBidData.suggestedBid}, range=[$${suggestedBidData.rangeStart}-$${suggestedBidData.rangeEnd}]`);
            break;
          }
        }
      }
      if (!suggestedBidData && firstAdGroup.targets && firstAdGroup.targets.length > 0) {
        for (const tgt of firstAdGroup.targets) {
          if (tgt.suggestedBid && Number(tgt.suggestedBid) > 0) {
            suggestedBidData = {
              suggestedBid: Number(tgt.suggestedBid),
              rangeStart: Number(tgt.suggestedBidLow) || 0,
              rangeEnd: Number(tgt.suggestedBidHigh) || 0,
            };
            log.info(`[BidOptimization] v436: 从数据库获取到target建议出价 suggestedBid=$${suggestedBidData.suggestedBid}, range=[$${suggestedBidData.rangeStart}-$${suggestedBidData.rangeEnd}]`);
            break;
          }
        }
      }
    }
  } catch (dbBidErr: unknown) {
    log.debug(`[BidOptimization] v436: 从数据库读取建议竞价失败: ${(dbBidErr as Error).message}`);
  }
  
  // v436: 策略二 — 如果数据库无数据且零点击，回退到实时API调用
  if (!suggestedBidData && totalClicks === 0) {
    try {
      const syncService = await amazonApiHelper.getAmazonSyncService(config.accountId);
      if (syncService && (syncService as Record<string, unknown>).client) {
        const firstCampaign = campaigns[0] as unknown;
        if (firstCampaign && firstCampaign.adGroups && firstCampaign.adGroups.length > 0) {
          const adGroupId = String(firstCampaign.adGroups[0].amazonAdGroupId || firstCampaign.adGroups[0].adGroupId);
          if (adGroupId) {
            try {
              const keywordRecs = await (syncService as Record<string, unknown>).client.getKeywordBidRecommendations(
                adGroupId,
                [{ keyword: config.name || 'product', matchType: 'BROAD' }]
              );
              if (keywordRecs && keywordRecs.length > 0) {
                const rec = keywordRecs[0] as unknown;
                suggestedBidData = {
                  suggestedBid: rec.suggestedBid,
                  rangeStart: rec.rangeStart,
                  rangeEnd: rec.rangeEnd,
                };
                log.info(`[BidOptimization] v436 R-01: API获取到建议出价 suggestedBid=$${rec.suggestedBid}, range=[$${rec.rangeStart}-$${rec.rangeEnd}]`);
              }
            } catch (kwBidErr: unknown) {
              log.debug(`[BidOptimization] v436 R-01: 关键词建议出价获取失败: ${(kwBidErr as Error).message}`);
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
  const cpcMaxBidLimit = config.maxBid || 2.00;
  const vcpmMaxBidLimit = config.maxBid ? config.maxBid * 5 : 15.00; // VCPM出价单位是每千次展示，通常是CPC的3-10倍
  log.info(`[BidOptimization] v165: CPC最高出价=$${cpcMaxBidLimit} | VCPM最高出价=$${vcpmMaxBidLimit} (用户设置max_bid=${config.maxBid || '未设置'})`);
  log.debug(`[BidOptimization] v165: 日预算=${config.dailyBudget || '未设置'}, 目标ACoS=${config.targetAcos || '未设置'}`);
  
  for (const campaign of (campaigns as unknown[])) {
    // v206: 统一ID提取 — 在循环开头一次性提取，后续代码统一使用
    const campaignLocalId = getCampaignLocalId(campaign);   // int PK，用于本地DB更新
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
      campaignTimeWeightedMetrics = timeDecayService.calculateTimeWeightedMetrics(dailyDataForWeighting);
      log.debug(`[BidOptimization] v163: Campaign ${campaignLocalId} 时间衰减加权 - 加权ACoS=${campaignTimeWeightedMetrics.weightedAcos.toFixed(1)}%, 加权ROAS=${campaignTimeWeightedMetrics.weightedRoas.toFixed(2)}, 置信度=${campaignTimeWeightedMetrics.dataQuality.confidenceLevel}, 趋势=${campaignTimeWeightedMetrics.trendSignal.direction}`);
    } catch (e: unknown) {
      log.warn(`[BidOptimization] 获取campaign ${campaignLocalId} 历史数据失败: ${(e as Error).message}`);
    }
    
    // v163: 安全检查 - 检测异常信号
    if (campaignTimeWeightedMetrics) {
      const safetyCheck = gradualEngine.performSafetyCheck(campaignTimeWeightedMetrics);
            if (safetyCheck.shouldPause) {
        log.warn(`[BidOptimization] v163: Campaign ${campaignLocalId} 安全检查触发暂停: ${safetyCheck.reason}`);
        details.push({
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
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
        log.warn(`[BidOptimization] v244: Campaign ${campaignLocalId} (${campaign.campaignName}) 安全检查触发，跳过该campaign的出价优化（不暂停整个优化目标）`);

        continue; // 跳过该campaign的竞价优化
      }
      if (safetyCheck.warnings.length > 0) {
        log.info(`[BidOptimization] v163: Campaign ${campaignLocalId} 安全警告: ${safetyCheck.warnings.join('；')}`);
      }
    }
    
    // v165: 根据campaign的costType动态设置maxBidLimit（CPC vs VCPM）
    const isVcpmCampaign = (campaign as Record<string, unknown>).costType === 'vcpm';
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
      const kwLastOptimized = (keyword as Record<string, unknown>).lastOptimizedAt ? new Date((keyword as Record<string, unknown>).lastOptimizedAt) : null;
      const kwBidSyncStatus = (keyword as Record<string, unknown>).bidSyncStatus || 'synced';
      if (kwLastOptimized && kwBidSyncStatus === 'pending_confirmation') {
        const hoursSinceOptimized = (Date.now() - kwLastOptimized.getTime()) / (1000 * 60 * 60);
        if (hoursSinceOptimized < 24) {
          log.info(`[BidOptimization] v166: 跳过关键词 ${keyword.id} "${keyword.keywordText}" - 冷却期内(${hoursSinceOptimized.toFixed(1)}h), 出价待确认 pending=$${(keyword as Record<string, unknown>).pendingBid}`);
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
        campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : undefined,
        historicalAvgImpressions: campaign.impressions ? Math.round(campaign.impressions / 30) : undefined, // v163: 基于30天估算
        // v163: 传入campaign级别的90天每日数据用于时间衰减加权分析
        dailyData: campaignDailyData.length > 0 ? campaignDailyData : undefined,
        marketplace: config.marketplace,
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
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
        const campType = (campaign as Record<string, unknown>).campaignType || 'sp_manual';
        const campCostType = (campaign as Record<string, unknown>).costType || 'cpc';
        const campAdFormat = (campaign as Record<string, unknown>).ad_format || (campaign as Record<string, unknown>).adFormat || null;
        const campMarketplace = config.marketplace || 'US';
        const { clampedBid: kwClampedBid, wasAdjusted: kwWasAdjusted, constraint: kwConstraint, adTypeKey: kwAdTypeKey } = clampBidToConstraint(finalBid, campType, campMarketplace, campCostType, campAdFormat);
        finalBid = Math.min(kwClampedBid, maxBidLimit);
        finalBid = Math.round(finalBid * 100) / 100;
        if (kwWasAdjusted) {
          log.info(`[BidOptimization] v434: keyword ${nextGenResult.targetId} bid $${nextGenResult.newBid.toFixed(2)} 超出${kwAdTypeKey}约束[$${kwConstraint.minBid}~$${kwConstraint.maxBid}]，调整为$${finalBid} (marketplace=${campMarketplace})`);
        }
        
        if (nextGenResult.actionType !== 'hold' && Math.abs(finalBid - nextGenResult.previousBid) > 0.01) {
          const keyword = keywords.find(k => k.id === nextGenResult.targetId);
          details.push({
            keywordId: nextGenResult.targetId,
            amazonKeywordId: keyword?.keywordId || '', // v255: 传入真正的Amazon keyword ID，修复PostOptVerifier验证失败
            adGroupId: keyword?.internalAdGroupId, // v421: 使用internalAdGroupId(int)用于PostOptVerifier精确回查
            keywordText: keyword?.keywordText || `关键词 ${nextGenResult.targetId}`,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            currentBid: nextGenResult.previousBid,
            newBid: finalBid,
            changePercent: ((finalBid - nextGenResult.previousBid) / nextGenResult.previousBid * 100).toFixed(2),
            reason: nextGenResult.reason,
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
      const currentBid = parseFloat(target.bid || '0');
      if (currentBid <= 0) continue;
      
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
        campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : undefined,
        historicalAvgImpressions: campaign.impressions ? Math.round(campaign.impressions / 30) : undefined, // v163
        dailyData: campaignDailyData.length > 0 ? campaignDailyData : undefined,
        marketplace: config.marketplace,
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
      });
    }
    
    // v198: 商品定向也使用NextGen统一出价引擎 — 100%覆盖，无回退
    if (productTargets.length > 0) {
      const nextGenPtResults = await nextGenOrchestrator.batchCalculateNextGenBids(
        config.accountId, productTargets, bidConfig, maxBidLimit
      );
      
      for (const nextGenResult of nextGenPtResults) {
        let finalBid = nextGenResult.newBid;
        
        // v434: 绝对红线校验 — 商品定向也使用bid constraints模块
        const ptCampType = (campaign as Record<string, unknown>).campaignType || 'sp_manual';
        const ptCostType = (campaign as Record<string, unknown>).costType || 'cpc';
        const ptAdFormat = (campaign as Record<string, unknown>).ad_format || (campaign as Record<string, unknown>).adFormat || null;
        const ptMarketplace = config.marketplace || 'US';
        const { clampedBid: ptClampedBid, wasAdjusted: ptWasAdjusted, constraint: ptConstraint, adTypeKey: ptAdTypeKey } = clampBidToConstraint(finalBid, ptCampType, ptMarketplace, ptCostType, ptAdFormat);
        finalBid = Math.min(ptClampedBid, maxBidLimit);
        finalBid = Math.round(finalBid * 100) / 100;
        if (ptWasAdjusted) {
          log.info(`[BidOptimization] v434: product target ${nextGenResult.targetId} bid $${nextGenResult.newBid.toFixed(2)} 超出${ptAdTypeKey}约束[$${ptConstraint.minBid}~$${ptConstraint.maxBid}]，调整为$${finalBid} (marketplace=${ptMarketplace})`);
        }
        
        if (nextGenResult.actionType !== 'hold' && Math.abs(finalBid - nextGenResult.previousBid) > 0.01) {
          const target = allTargets.find(t => t.id === nextGenResult.targetId);
          details.push({
            keywordId: nextGenResult.targetId, // v230: 保持向后兼容，商品定向也用keywordId字段传递本地ID
            productTargetId: nextGenResult.targetId, // v230: 新增显式的productTargetId字段
            amazonKeywordId: target?.targetId || '', // v255: 传入真正的Amazon target ID，修复PostOptVerifier验证失败
            adGroupId: target?.adGroupId, // v255: 传入adGroupId用于PostOptVerifier精确回查
            keywordText: target?.targetText || target?.targetValue || `商品定向 ${nextGenResult.targetId}`,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            currentBid: nextGenResult.previousBid,
            newBid: finalBid,
            changePercent: ((finalBid - nextGenResult.previousBid) / nextGenResult.previousBid * 100).toFixed(2),
            reason: `商品定向 - ${nextGenResult.reason}`,
            isProductTarget: true,
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
      
      if (nonSyncableDetails.length > 0) {
        log.info(`[BidOptimization] v224: ${nonSyncableDetails.length}条非出价调整记录(safety_pause等)已跳过API同步`);
        for (const d of (nonSyncableDetails as unknown[])) {
          d.apiSyncStatus = 'not_applicable';
          d.apiSyncDetail = JSON.stringify({ status: 'not_applicable', error: null, reason: '非出价调整记录(safety_pause)' });
        }
      }
      
      apiSyncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
        accountId,
        syncableDetails.map(d => ({
          keywordId: d.keywordId,
          newBid: d.newBid,
          campaignId: d.amazonCampaignId,
          reason: d.reason,
          isProductTarget: d.isProductTarget || false,
          algorithmUsed: d.algorithmUsed, // v334: 传递算法标识到biddingLogs
        }))
      );
      
      if (apiSyncResult.failed === 0 && apiSyncResult.success > 0) {
        apiSyncStatus = 'synced';
      } else if (apiSyncResult.success === 0) {
        apiSyncStatus = 'failed';
      } else {
        apiSyncStatus = 'partial';
      }
      
      log.warn(`[BidOptimization] Amazon API同步: 成功=${apiSyncResult.success}, 失败=${apiSyncResult.failed}, 状态=${apiSyncStatus}`);
      if (apiSyncResult.errors.length > 0) {
        log.error(`[BidOptimization] Amazon API同步错误:`, apiSyncResult.errors.join('; '));
      }
      
      // v148: API调用成功后，才更新本地数据库（先API后DB原则）
      // v148: 使用事务保护批量DB更新，确保原子性
      // v224: 只从可同步的details中过滤，避免safety_pause等非出价调整记录干扰
      const syncedDetails = syncableDetails.filter(d => {
        const itemResult = apiSyncResult.itemResults?.get(d.keywordId);
        return itemResult?.status === 'synced';
      });
      const skippedDetails = syncableDetails.filter(d => {
        const itemResult = apiSyncResult.itemResults?.get(d.keywordId);
        return itemResult?.status !== 'synced';
      });
      
      if (syncedDetails.length > 0) {
        const dbConn = await getDb();
        if (dbConn) {
          try {
            await dbConn.transaction(async (tx) => {
              for (const detail of syncedDetails) {
                if (detail.isProductTarget) {
                  await tx.update(productTargetsTable)
                    .set({ bid: (typeof detail.newBid === 'number' ? detail.newBid : 0).toFixed(2) })
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
                    .where(eq(keywordsTable.id, detail.keywordId));
                }
              }
              // v178/v206: 更新所有受影响的campaigns的last_optimized_at（使用本地int ID）
              const affectedCampaignIds = [...new Set(syncedDetails.map(d => d.localCampaignId))];
              const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
              for (const cid of affectedCampaignIds) {
                await tx.update(campaignsTable)
                  .set({ lastOptimizedAt: nowStr } as Record<string, unknown>)
                  .where(eq(campaignsTable.id, cid));
              }
            });
            log.info(`[BidOptimization] v178: 事务批量DB更新成功: ${syncedDetails.length}条出价 + campaigns.last_optimized_at已更新`);
            
            // v361: 记录出价调整审计日志
            for (const detail of syncedDetails) {
              auditBidChange(
                0, // system user
                accountId,
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
                bidObjectType: (d.isProductTarget ? 'asin' : 'keyword') as 'keyword' | 'asin',
                bidObjectId: d.keywordId,
                bid: typeof d.newBid === 'number' ? d.newBid : 0,
              }));
              const bphResult = await batchRecordBidPerformanceHistory(bidPerfRecords);
              log.info(`[BidOptimization] v230: bidPerformanceHistory写入: recorded=${bphResult.recorded}, failed=${bphResult.failed}`);
            } catch (bphErr: unknown) {
              log.warn(`[BidOptimization] v230: bidPerformanceHistory写入失败(不阻塞主流程): ${(bphErr as Error).message}`);
            }
          } catch (txErr: unknown) {
            log.error(`[BidOptimization] v178: 事务DB更新失败(已回滚): ${(txErr as Error).message}`);
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
            syncedDetails.map(d => ({
              localKeywordId: d.keywordId,
              amazonKeywordId: d.amazonKeywordId || String(d.keywordId),
              expectedBid: d.newBid,
              campaignId: d.amazonCampaignId,
              adGroupId: d.adGroupId,
              isProductTarget: d.isProductTarget || false,
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
      log.error(`[BidOptimization] Amazon API同步异常:`, (apiError as Error).message);
      // v148: API整体异常，不更新任何本地DB记录
      log.error(`[BidOptimization] v148: API整体异常，所有本地DB更新已跳过`);
    }
  } else if (dryRun) {
    apiSyncStatus = 'pending'; // 模拟模式不同步
  }
  
  // v140: 将每条调整的独立同步状态附加到详情中（而非批量状态）
  // v224: 跳过已在前面设置了apiSyncStatus的非出价调整记录(safety_pause等)
  for (const detail of details) {
    if (detail.apiSyncStatus === 'not_applicable') continue; // v224: safety_pause等已处理
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
      log.error(`[BidOptimization] ${summaryMsg} - 超过50%campaign触发安全暂停，建议人工检查`);
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
