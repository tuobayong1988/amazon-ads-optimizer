/**
 * v362: 优化目标引擎 - statusChangeExecutor
 * 从 optimizationTargetEngine.ts 拆分
 * 
 * 包含函数: executeKeywordStatusChanges, executeCampaignStatusChanges, executeAdGroupStatusChanges
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
import { recordAudit, auditBidChange } from '../services/auditLogService';
import { generateNegativeKeywordSuggestions, executeNegativeKeywords as executeNgramNegativeKeywords } from '../analytics/ngramAnalysis';

const log = createModuleLogger('TargetEngine');

// 缓存账号站点信息，避免重复查询
import type { OptimizationExecutionResult, OptimizationTargetConfig } from './types';

export async function executeKeywordStatusChanges(
  config: OptimizationTargetConfig,
  campaigns: unknown[],
  dryRun: boolean
): Promise<{ executed: boolean; pausedCount: number; enabledCount: number; details: Record<string, unknown>[] }> {
  const details: Record<string, unknown>[] = [];
  let pausedCount = 0;
  let enabledCount = 0;
  
  // v122g: 策略感知的动态暂停阈值
  // 不同策略对“高花费无转化”的容忍度不同
  // v170: 优先使用策略模板名称来决定暂停阈值
  const goal = config.strategyTemplateId || config.optimizationGoal || 'balanced';
  let pauseSpendThreshold = 50;  // 默认花费阈值
  let pauseClickThreshold = 20;  // 默认点击阈值
  let maxAcosThreshold = (config.targetAcos || 30) * 2.5; // 默认ACoS上限为目标的2.5倍
  
  if (['aggressive-growth', 'seasonal-boost', 'market-expansion'].includes(goal)) {
    // 激进策略：更高的容忍度，允许更多试错成本
    pauseSpendThreshold = 100;
    pauseClickThreshold = 40;
    maxAcosThreshold = (config.targetAcos || 30) * 3.5;
  } else if (['profit-focused', 'brand-defense', 'decline-management'].includes(goal)) {
    // 保守策略：更低的容忍度，但也不能太激进
    pauseSpendThreshold = 35;
    pauseClickThreshold = 15;
    maxAcosThreshold = (config.targetAcos || 30) * 2;
  } else if (['inventory-clearance', 'competitor-attack'].includes(goal)) {
    // 特殊策略：中等容忍度
    pauseSpendThreshold = 70;
    pauseClickThreshold = 30;
    maxAcosThreshold = (config.targetAcos || 30) * 3;
  }
  
  // v122g: 计算组平均AOV，用于动态调整花费阈值
  let totalSalesForAov = 0, totalOrdersForAov = 0;
  for (const c of (campaigns as unknown[])) {
    totalSalesForAov += parseFloat(c.sales || '0');
    totalOrdersForAov += (c.orders || 0);
  }
  const groupAov = totalOrdersForAov > 0 ? totalSalesForAov / totalOrdersForAov : 30;
  // 花费阈值至少为1.5倍AOV，确保有足够数据判断
  pauseSpendThreshold = Math.max(pauseSpendThreshold, groupAov * 1.5);
  
  for (const campaign of (campaigns as unknown[])) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // v163: 获取campaign级别的90天时间衰减加权数据，用于修正投放词状态决策
      let campaignTWMetrics: timeDecayService.TimeWeightedMetrics | null = null;
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const rawDailyData = await db.getDailyPerformanceByDateRange(config.accountId, startDate, endDate, campaignAmazonId);
        const dailyDataForWeighting: timeDecayService.DailyRawData[] = rawDailyData.map(d => ({
          date: typeof d.date === 'string' ? d.date : new Date(d.date).toISOString(),
          impressions: d.impressions || 0,
          clicks: d.clicks || 0,
          spend: parseFloat(String(d.spend || '0')),
          sales: parseFloat(String(d.sales || '0')),
          orders: d.orders || 0,
        }));
        if (dailyDataForWeighting.length > 0) {
          campaignTWMetrics = timeDecayService.calculateTimeWeightedMetrics(dailyDataForWeighting);
        }
      } catch (e: unknown) {
        log.warn(`[KeywordStatus] v163: Campaign ${campaignLocalId} 时间衰减数据获取失败: ${(e as Error).message}`);
      }
      
      // 获取广告活动下的所有关键词
      const keywords = await db.getKeywordsByCampaignId(campaignAmazonId);
      
      for (const keyword of keywords) {
        const spend = parseFloat(keyword.spend || '0');
        const sales = parseFloat(keyword.sales || '0');
        const clicks = keyword.clicks || 0;
        const conversions = keyword.orders || 0;
        const impressions = keyword.impressions || 0;
        const acos = sales > 0 ? (spend / sales * 100) : 0;
        
        // v163: 使用时间衰减加权修正投放词数据
        // 如果campaign整体趋势向好，提高暂停阈值（更保守）
        // 如果campaign整体趋势向差，降低暂停阈值（更积极清理）
        let trendAdjustedPauseSpendThreshold = pauseSpendThreshold;
        let trendAdjustedMaxAcosThreshold = maxAcosThreshold;
        if (campaignTWMetrics) {
          if (campaignTWMetrics.trendSignal.direction === 'improving') {
            trendAdjustedPauseSpendThreshold *= 1.3; // 趋势向好，更宽容
            trendAdjustedMaxAcosThreshold *= 1.2;
          } else if (campaignTWMetrics.trendSignal.direction === 'declining') {
            trendAdjustedPauseSpendThreshold *= 0.8; // 趋势向差，更严格
            trendAdjustedMaxAcosThreshold *= 0.85;
          }
        }
        
        // v122g: 多维度暂停判断（替代原来的粗暴硬编码阈值）
        let shouldPause = false;
        let pauseReason = '';
        
        if (keyword.keywordStatus === 'enabled') {
          // v163: 使用趋势修正后的阈值进行判断
          // 条件1：高花费零转化（使用趋势修正动态阈值）
          if (spend > trendAdjustedPauseSpendThreshold && conversions === 0 && clicks > pauseClickThreshold) {
            shouldPause = true;
            pauseReason = `高花费零转化: 花费$${spend.toFixed(2)}(>阈值$${trendAdjustedPauseSpendThreshold.toFixed(0)}), 点击${clicks}(>阈值${pauseClickThreshold}), 转化${conversions}`;
          }
          // 条件2：ACoS远超目标且数据充足
          else if (acos > trendAdjustedMaxAcosThreshold && clicks > pauseClickThreshold && conversions > 0) {
            shouldPause = true;
            pauseReason = `ACoS远超目标: ACoS ${acos.toFixed(1)}%(>阈值${trendAdjustedMaxAcosThreshold.toFixed(0)}%), 点击${clicks}, 转化${conversions}`;
          }
          
          // v122h: 探索期保护 - 新关键词在7天探索期内不执行暂停
          if (shouldPause && keyword.createdAt) {
            const keywordCreatedAt = new Date(keyword.createdAt);
            const isNew = isNewKeyword(keywordCreatedAt, clicks, impressions, 7);
            if (isNew) {
              shouldPause = false;
              const explorationInfo = getExplorationStrategy(keywordCreatedAt, clicks, impressions, parseFloat(keyword.bid || '0'));
              details.push({
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                campaignName: campaign.campaignName,
                keywordId: keyword.id,
                keywordText: keyword.keywordText,
                action: 'exploration_protect',
                algorithmUsed: 'keyword_status_manager', // v335
                reason: `[探索期保护] 关键词在探索期内(剩余${explorationInfo.explorationDaysRemaining}天)，策略:${explorationInfo.strategy}，不执行暂停`,
                currentStatus: keyword.keywordStatus,
              });
              continue;
            }
          }
          
          // v122h: 品牌词保护 - 品牌词不自动暂停，仅记录警告
          if (shouldPause) {
            const account = await db.getAdAccountById(config.accountId);
            const brandTerms = account?.storeName ? [account.storeName] : [];
            if (brandTerms.length > 0 && isProtectedKeyword(keyword.keywordText, brandTerms)) {
              shouldPause = false;
              details.push({
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                campaignName: campaign.campaignName,
                keywordId: keyword.id,
                keywordText: keyword.keywordText,
                action: 'brand_protect',
                algorithmUsed: 'keyword_status_manager', // v335
                reason: `[品牌词保护] 品牌关键词"${keyword.keywordText}"不自动暂停，建议人工评估`,
                currentStatus: keyword.keywordStatus,
              });
              continue;
            }
          }
          
          // v122g+h: 低数据量保护 - 如果数据量太少，不执行暂停，给予更多观察时间
          if (shouldPause && clicks < 10 && spend < groupAov) {
            shouldPause = false;
            details.push({
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              keywordId: keyword.id,
              keywordText: keyword.keywordText,
              action: 'observe',
              algorithmUsed: 'keyword_status_manager', // v335
              reason: `[观察期] 数据量不足(点击${clicks},花费$${spend.toFixed(2)})，继续观察而非直接暂停`,
              currentStatus: keyword.keywordStatus,
            });
            continue;
          }
        }
        
        // v122g: 更智能的启用判断
        let shouldEnable = false;
        let enableReason = '';
        
        if (keyword.keywordStatus === 'paused') {
          // 条件1：有转化且ACoS在目标范围内
          if (acos > 0 && acos < (config.targetAcos || 30)) {
            shouldEnable = true;
            enableReason = `表现改善: ACoS ${acos.toFixed(2)}%(目标${config.targetAcos || 30}%)`;
          }
          // v122g 条件2：历史CVR尚可，可以尝试重新探索
          else if (conversions > 0 && clicks > 5) {
            const cvr = conversions / clicks;
            if (cvr > 0.02) { // CVR > 2%说明有转化潜力
              shouldEnable = true;
              enableReason = `[探索模式重启] 历史CVR ${(cvr * 100).toFixed(1)}%尚可，尝试以探索性出价重新启用`;
            }
          }
        }
        
        if (shouldPause) {
          const action: Record<string, unknown> = {
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: 'pause',
            reason: pauseReason,
            currentStatus: keyword.keywordStatus,
            newStatus: 'paused',
            algorithmUsed: 'keyword_status_manager', // v335
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          
          details.push(action);
          
          if (!dryRun) {
            // v148: 先调Amazon API确认成功，再更新本地数据库（先API后DB原则）
            try {
              const syncResult: unknown = await amazonApiHelper.syncKeywordStatusToAmazon(
                config.accountId,
                [{
                  keywordId: keyword.id,
                  newStatus: 'paused',
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
                  reason: pauseReason,
                  isProductTarget: false,
                }]
              );
              if (syncResult.success > 0) {
                // API成功后才更新本地DB
                await db.updateKeyword(keyword.id, { keywordStatus: 'paused' });
                pausedCount++;
                action.apiSyncStatus = 'synced';
                // v166: 注册状态变更验证任务
                try {
                  postOptVerifier.scheduleKeywordStatusVerification(
                    config.accountId,
                    [{ localKeywordId: keyword.id, amazonKeywordId: keyword.keywordId || String(keyword.id), expectedState: 'paused', adGroupId: keyword.internalAdGroupId || undefined }]  // v421: 使用internalAdGroupId(int)
                  );
                // @ts-expect-error - error message access
                } catch (ve: unknown) { log.warn(`[KeywordStatusChange] v166: 验证任务注册失败: ${ve.message}`); }
              } else {
                // API失败，不更新本地DB
                action.apiSyncStatus = 'failed';
                if (syncResult.errors.length > 0) {
                  action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
                }
                log.warn(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${keyword.keywordText})`);
              }
            } catch (apiError: unknown) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
              log.warn(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${keyword.keywordText}):`, (apiError as Error).message);
            }
          }
        } else if (shouldEnable) {
          const action: Record<string, unknown> = {
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: 'enable',
            reason: enableReason,
            currentStatus: keyword.keywordStatus,
            newStatus: 'enabled',
            algorithmUsed: 'keyword_status_manager', // v335
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          
          details.push(action);
          
          if (!dryRun) {
            // v148: 先调Amazon API确认成功，再更新本地数据库（先API后DB原则）
            try {
              const syncResult: unknown = await amazonApiHelper.syncKeywordStatusToAmazon(
                config.accountId,
                [{
                  keywordId: keyword.id,
                  newStatus: 'enabled',
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
                  reason: enableReason,
                  isProductTarget: false,
                }]
              );
              if (syncResult.success > 0) {
                // API成功后才更新本地DB
                await db.updateKeyword(keyword.id, { keywordStatus: 'enabled' });
                enabledCount++;
                action.apiSyncStatus = 'synced';
                // v166: 注册状态变更验证任务
                try {
                  postOptVerifier.scheduleKeywordStatusVerification(
                    config.accountId,
                    [{ localKeywordId: keyword.id, amazonKeywordId: keyword.keywordId || String(keyword.id), expectedState: 'enabled', adGroupId: keyword.internalAdGroupId || undefined }]  // v421: 使用internalAdGroupId(int)
                  );
                // @ts-expect-error - error message access
                } catch (ve: unknown) { log.warn(`[KeywordStatusChange] v166: 验证任务注册失败: ${ve.message}`); }
              } else {
                // API失败，不更新本地DB
                action.apiSyncStatus = 'failed';
                if (syncResult.errors.length > 0) {
                  action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
                }
                log.warn(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (启用 ${keyword.keywordText})`);
              }
            } catch (apiError: unknown) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
              log.warn(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (启用 ${keyword.keywordText}):`, (apiError as Error).message);
            }
          }
        }
      }
    } catch (error: unknown) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        campaignName: campaign.campaignName,
        error: (error as Error).message,
      });
    }
  }
  
  return { executed: true, pausedCount, enabledCount, details };
}

/**
 * v135: 执行广告活动状态变更
 * 自动判断广告活动是否应该暂停或启用，并同步到Amazon
 */
export async function executeCampaignStatusChanges(
  config: OptimizationTargetConfig,
  campaigns: unknown[],
  dryRun: boolean
): Promise<{ executed: boolean; pausedCount: number; enabledCount: number; details: Record<string, unknown>[] }> {
  const details: Record<string, unknown>[] = [];
  let pausedCount = 0;
  let enabledCount = 0;
  
  // v170: 优先使用策略模板名称来决定广告活动暂停阈值
  const goal = config.strategyTemplateId || config.optimizationGoal || 'balanced';
  const targetAcos = config.targetAcos || 30;
  
  // 广告活动暂停阈值（比关键词更保守，因为影响范围更大）
  let campaignPauseSpendThreshold = 200;
  let campaignPauseClickThreshold = 100;
  let campaignMaxAcosThreshold = targetAcos * 3;
  
  if (['profit-focused', 'brand-defense', 'decline-management'].includes(goal)) {
    campaignPauseSpendThreshold = 150;
    campaignPauseClickThreshold = 80;
    campaignMaxAcosThreshold = targetAcos * 2.5;
  }
  
  for (const campaign of (campaigns as unknown[])) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // v163: 获取campaign级别时间衰减加权数据
      let campaignTWMetrics: timeDecayService.TimeWeightedMetrics | null = null;
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const rawDailyData = await db.getDailyPerformanceByDateRange(config.accountId, startDate, endDate, campaignAmazonId);
        const dailyDataForWeighting: timeDecayService.DailyRawData[] = rawDailyData.map(d => ({
          date: typeof d.date === 'string' ? d.date : new Date(d.date).toISOString(),
          impressions: d.impressions || 0,
          clicks: d.clicks || 0,
          spend: parseFloat(String(d.spend || '0')),
          sales: parseFloat(String(d.sales || '0')),
          orders: d.orders || 0,
        }));
        if (dailyDataForWeighting.length > 0) {
          campaignTWMetrics = timeDecayService.calculateTimeWeightedMetrics(dailyDataForWeighting);
        }
      } catch (e: unknown) {
        log.warn(`[CampaignStatus] v163: Campaign ${campaignLocalId} 时间衰减数据获取失败: ${(e as Error).message}`);
      }
      
      // v163: 优先使用时间衰减加权数据，而非简单汇总
      const spend = campaignTWMetrics ? campaignTWMetrics.weightedDailySpend * 30 : parseFloat(campaign.spend || '0');
      const sales = campaignTWMetrics ? campaignTWMetrics.weightedDailySales * 30 : parseFloat(campaign.sales || '0');
      const clicks = campaign.clicks || 0;
      const conversions = campaignTWMetrics ? Math.round(campaignTWMetrics.weightedDailyOrders * 30) : (campaign.orders || 0);
      const acos = campaignTWMetrics ? campaignTWMetrics.weightedAcos : (sales > 0 ? (spend / sales * 100) : 0);
      const campaignStatus = campaign.campaignStatus || 'enabled';
      
      // v163: 根据趋势修正广告活动暂停阈值
      let adjustedPauseSpendThreshold = campaignPauseSpendThreshold;
      let adjustedMaxAcosThreshold = campaignMaxAcosThreshold;
      if (campaignTWMetrics) {
        if (campaignTWMetrics.trendSignal.direction === 'improving') {
          adjustedPauseSpendThreshold *= 1.3;
          adjustedMaxAcosThreshold *= 1.2;
        } else if (campaignTWMetrics.trendSignal.direction === 'declining') {
          adjustedPauseSpendThreshold *= 0.8;
          adjustedMaxAcosThreshold *= 0.85;
        }
      }
      
      let shouldPause = false;
      let pauseReason = '';
      let shouldEnable = false;
      let enableReason = '';
      
      if (campaignStatus === 'enabled') {
        // v163: 使用趋势修正后的阈值
        // 条件1：高花费零转化
        if (spend > adjustedPauseSpendThreshold && conversions === 0 && clicks > campaignPauseClickThreshold) {
          shouldPause = true;
          pauseReason = `广告活动高花费零转化: 加权花费$${spend.toFixed(2)}(>阈值$${adjustedPauseSpendThreshold.toFixed(0)}), 加权点击${clicks}(>阈值${campaignPauseClickThreshold}), 加权转化${conversions}`;
        }
        // 条件2：ACoS远超目标
        else if (acos > adjustedMaxAcosThreshold && clicks > campaignPauseClickThreshold && conversions > 0) {
          shouldPause = true;
          pauseReason = `广告活动ACoS远超目标: 加权ACoS ${acos.toFixed(1)}%(>阈值${adjustedMaxAcosThreshold.toFixed(0)}%), 加权点击${clicks}, 加权转化${conversions}`;
        }
      } else if (campaignStatus === 'paused') {
        // v163: 使用时间衰减加权ACoS判断是否应启用
        if (acos > 0 && acos < targetAcos * 0.8) {
          shouldEnable = true;
          enableReason = `广告活动表现改善: 加权ACoS ${acos.toFixed(1)}%(目标${targetAcos}%), 建议重新启用`;
        }
      }
      
      if (shouldPause) {
        const action: Record<string, unknown> = {
          accountId: config.accountId,
          entityType: 'campaign',
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          campaignName: campaign.campaignName,
          action: 'pause',
          reason: pauseReason,
          currentStatus: campaignStatus,
          newStatus: 'paused',
          spend: spend,
          sales: sales,
          clicks: clicks,
          conversions: conversions,
          acos: acos,
          algorithmUsed: 'campaign_status_manager', // v335
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        details.push(action);
        
        if (!dryRun) {
          // v148: 先调Amazon API确认成功，再更新本地数据库（先API后DB原则）
          try {
            const syncResult: unknown = await amazonApiHelper.syncCampaignStatusToAmazon(
              config.accountId,
              [{
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                newStatus: 'paused',
                campaignName: campaign.campaignName || '',
                reason: pauseReason,
              }]
            );
            if (syncResult.success > 0) {
              await db.updateCampaign(campaignLocalId, { campaignStatus: 'paused' });
              pausedCount++;
              action.apiSyncStatus = 'synced';
            } else {
              action.apiSyncStatus = 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
              log.warn(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${campaign.campaignName})`);
            }
          } catch (apiError: unknown) {
            action.apiSyncStatus = 'failed';
            action.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
            log.warn(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${campaign.campaignName}):`, (apiError as Error).message);
          }
        }
      } else if (shouldEnable) {
        const action: Record<string, unknown> = {
          accountId: config.accountId,
          entityType: 'campaign',
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          campaignName: campaign.campaignName,
          action: 'enable',
          reason: enableReason,
          currentStatus: campaignStatus,
          newStatus: 'enabled',
          spend: spend,
          sales: sales,
          clicks: clicks,
          conversions: conversions,
          acos: acos,
          algorithmUsed: 'campaign_status_manager', // v335
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        details.push(action);
        
        if (!dryRun) {
          // v148: 先调Amazon API确认成功，再更新本地数据库（先API后DB原则）
          try {
            const syncResult: unknown = await amazonApiHelper.syncCampaignStatusToAmazon(
              config.accountId,
              [{
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                newStatus: 'enabled',
                campaignName: campaign.campaignName || '',
                reason: enableReason,
              }]
            );
            if (syncResult.success > 0) {
              await db.updateCampaign(campaignLocalId, { campaignStatus: 'enabled' });
              enabledCount++;
              action.apiSyncStatus = 'synced';
            } else {
              action.apiSyncStatus = 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
              log.warn(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (启用 ${campaign.campaignName})`);
            }
          } catch (apiError: unknown) {
            action.apiSyncStatus = 'failed';
            action.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
            log.warn(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (启用 ${campaign.campaignName}):`, (apiError as Error).message);
          }
        }
      }
    } catch (error: unknown) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        campaignName: campaign.campaignName,
        entityType: 'campaign',
        error: (error as Error).message,
      });
    }
  }
  
  return { executed: true, pausedCount, enabledCount, details };
}

/**
 * v135: 执行广告组状态变更
 * 自动判断广告组是否应该暂停或启用，并同步到Amazon
 */
export async function executeAdGroupStatusChanges(
  config: OptimizationTargetConfig,
  campaigns: unknown[],
  dryRun: boolean
): Promise<{ executed: boolean; pausedCount: number; enabledCount: number; details: Record<string, unknown>[] }> {
  const details: Record<string, unknown>[] = [];
  let pausedCount = 0;
  let enabledCount = 0;
  
  const targetAcos = config.targetAcos || 30;
  
  // 广告组暂停阈值（介于广告活动和关键词之间）
  let adGroupPauseSpendThreshold = 100;
  let adGroupPauseClickThreshold = 50;
  let adGroupMaxAcosThreshold = targetAcos * 2.8;
  
  for (const campaign of (campaigns as unknown[])) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      const adGroups = await db.getAdGroupsByCampaignId(campaignAmazonId);
      
      for (const adGroup of adGroups) {
        const spend = parseFloat(adGroup.spend || '0');
        const sales = parseFloat(adGroup.sales || '0');
        const clicks = adGroup.clicks || 0;
        const conversions = adGroup.orders || 0;
        const acos = sales > 0 ? (spend / sales * 100) : 0;
        const adGroupStatus = adGroup.adGroupStatus || 'enabled';
        
        let shouldPause = false;
        let pauseReason = '';
        let shouldEnable = false;
        let enableReason = '';
        
        if (adGroupStatus === 'enabled') {
          if (spend > adGroupPauseSpendThreshold && conversions === 0 && clicks > adGroupPauseClickThreshold) {
            shouldPause = true;
            pauseReason = `广告组高花费零转化: 花费$${spend.toFixed(2)}(>阈值$${adGroupPauseSpendThreshold}), 点击${clicks}(>阈值${adGroupPauseClickThreshold}), 转化${conversions}`;
          } else if (acos > adGroupMaxAcosThreshold && clicks > adGroupPauseClickThreshold && conversions > 0) {
            shouldPause = true;
            pauseReason = `广告组ACoS远超目标: ACoS ${acos.toFixed(1)}%(>阈值${adGroupMaxAcosThreshold.toFixed(0)}%), 点击${clicks}, 转化${conversions}`;
          }
        } else if (adGroupStatus === 'paused') {
          if (acos > 0 && acos < targetAcos * 0.8) {
            shouldEnable = true;
            enableReason = `广告组表现改善: ACoS ${acos.toFixed(1)}%(目标${targetAcos}%), 建议重新启用`;
          }
        }
        
        if (shouldPause) {
          // v328: 连续失败保护 — 如果同一个adGroup已连续失败3次以上，跳过避免无限重试
          try {
            const dbInstance = await db.getDb();
            if (dbInstance) {
              const { sql: sqlTag } = await import('drizzle-orm');
              const failHistory = await dbInstance.execute(sqlTag`
                SELECT COUNT(*) as fail_count FROM optimization_logs
                WHERE action_type = 'adgroup_pause'
                  AND JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.adGroupId')) = ${String(adGroup.id)}
                  AND api_sync_status = 'failed'
                  AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
              `);
              // @ts-expect-error - type assertion
              const failCount = ((failHistory as Record<string, unknown>)[0]?.[0]?.fail_count) || 0;
              if (failCount >= 3) {
                log.warn(`[AdGroupStatus] v328: 跳过广告组"${adGroup.adGroupName}" — 已连续失败${failCount}次，等待人工处理`);
                continue;
              }
            }
          } catch (failCheckErr: unknown) {
            log.warn(`[AdGroupStatus] v328: 失败历史检查异常: ${(failCheckErr as Error).message}`);
          }
          
          const action: Record<string, unknown> = {
            accountId: config.accountId,
            entityType: 'adGroup',
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            adGroupId: adGroup.id,
            adGroupName: adGroup.adGroupName,
            amazonAdGroupId: adGroup.adGroupId,
            action: 'pause',
            reason: pauseReason,
            currentStatus: adGroupStatus,
            newStatus: 'paused',
            spend: spend,
            sales: sales,
            clicks: clicks,
            conversions: conversions,
            acos: acos,
            algorithmUsed: 'adgroup_status_manager', // v335
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          details.push(action);
          
          if (!dryRun) {
            await db.updateAdGroupStatus(adGroup.id, 'paused');
            pausedCount++;
            
            try {
              const syncResult: unknown = await amazonApiHelper.syncAdGroupStatusToAmazon(
                config.accountId,
                [{
                  adGroupId: adGroup.id,
                  amazonAdGroupId: String(adGroup.adGroupId || ''),
                  newStatus: 'paused',
                  adGroupName: adGroup.adGroupName || '',
                  campaignName: campaign.campaignName || '',
                  reason: pauseReason,
                  campaignType: (campaign as Record<string, unknown>).campaignType || '', // v310-fix: 传递广告类型以选择正确的API端点
                }]
              );
              action.apiSyncStatus = syncResult.success > 0 ? 'synced' : 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
            } catch (apiError: unknown) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
            }
          }
        } else if (shouldEnable) {
          const action: Record<string, unknown> = {
            accountId: config.accountId,
            entityType: 'adGroup',
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            adGroupId: adGroup.id,
            adGroupName: adGroup.adGroupName,
            amazonAdGroupId: adGroup.adGroupId,
            action: 'enable',
            reason: enableReason,
            currentStatus: adGroupStatus,
            newStatus: 'enabled',
            spend: spend,
            sales: sales,
            clicks: clicks,
            conversions: conversions,
            acos: acos,
            algorithmUsed: 'adgroup_status_manager', // v335
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          details.push(action);
          
          if (!dryRun) {
            await db.updateAdGroupStatus(adGroup.id, 'enabled');
            enabledCount++;
            
            try {
              const syncResult: unknown = await amazonApiHelper.syncAdGroupStatusToAmazon(
                config.accountId,
                [{
                  adGroupId: adGroup.id,
                  amazonAdGroupId: String(adGroup.adGroupId || ''),
                  newStatus: 'enabled',
                  adGroupName: adGroup.adGroupName || '',
                  campaignName: campaign.campaignName || '',
                  reason: enableReason,
                  campaignType: (campaign as Record<string, unknown>).campaignType || '', // v310-fix: 传递广告类型以选择正确的API端点
                }]
              );
              action.apiSyncStatus = syncResult.success > 0 ? 'synced' : 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
            } catch (apiError: unknown) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
            }
          }
        }
      }
    } catch (error: unknown) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        campaignName: campaign.campaignName,
        entityType: 'adGroup',
        error: (error as Error).message,
      });
    }
  }
  
  return { executed: true, pausedCount, enabledCount, details };
}

/**
 * 执行中央竞价协调
 * 收集bidOptimizer、daypartingService、placementService的建议
 * 计算理论最高CPC并实施熔断机制
 */
