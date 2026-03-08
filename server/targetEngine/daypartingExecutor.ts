/**
 * v362: 优化目标引擎 - daypartingExecutor
 * 从 optimizationTargetEngine.ts 拆分
 * 
 * 包含函数: executeDaypartingOptimization, executeDaypartingBudgetOptimization
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
import * as bidOptimizer from "../bidOptimizer";
import * as daypartingService from "../daypartingService";
import * as placementOptimizationService from "../placementOptimizationService";
import { preOptimizationSafetyCheck, applyBidGuardrail, applyBudgetGuardrail, applyPlacementGuardrail, SAFETY_LIMITS } from '../optimizationSafetyGuardrails';
import * as adAutomation from "../adAutomation";
import * as intelligentBudgetAllocationService from "../intelligentBudgetAllocationService";
import { optimizeBudgetPortfolio } from "../budgetPortfolioOptimizer";
import * as bidCoordinator from "../services/bidCoordinator";
import * as nextGenOrchestrator from "../nextGenBidOrchestrator";
import * as amazonApiHelper from "../services/amazonApiHelper";
import { acquireAccountOptimizationLock, releaseAccountOptimizationLock, getModuleLockGroup } from "../utils/lockManager";
import * as amazonIdResolver from "../services/amazonIdResolver";
import { getLocalHour, getLocalDayOfWeek, isNewKeyword, getExplorationStrategy, isProtectedKeyword } from "../algorithmUtils";
import * as campaignLifecycleService from "../services/campaignLifecycleService";
import * as timeDecayService from "../timeDecayWeightedDataService";
import * as gradualEngine from "../gradualOptimizationEngine";
import * as selfEvolution from "../selfEvolutionEngine";
import * as multiDimOptimizer from "../multiDimensionOptimizer";
import * as multiDimComboAnalyzer from "../multiDimComboAnalyzer";
import * as postOptVerifier from "../postOptimizationVerifier";
import { registerActiveTask, unregisterActiveTask, isShuttingDown } from "../utils/taskLifecycle";
import { decideTargeting } from "../services/targetingAlgorithm";
import type { SearchTermPerformance, TargetingDecision } from "../services/targetingAlgorithm";
import { sanitizeAndValidateKeyword, canAddPositiveKeyword, isAsinSearchTerm, adGroupHasProductTargets, isProductTargetingCampaign } from "../utils/keywordValidator";
import { createModuleLogger } from '../utils/logger';
import { getCampaignAmazonId, getCampaignLocalId } from '../utils/idTypes';
import { recordAudit, auditBidChange } from '../services/auditLogService';
import { generateNegativeKeywordSuggestions, executeNegativeKeywords as executeNgramNegativeKeywords } from '../ngramAnalysis';

const log = createModuleLogger('TargetEngine');

// 缓存账号站点信息，避免重复查询
import type { OptimizationExecutionResult, OptimizationTargetConfig } from './types';

export async function executeDaypartingOptimization(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: Record<string, any>[] }> {
  const details: Record<string, any>[] = [];
  let adjustmentsCount = 0;
  
  // v122h: 使用站点本地时间而非UTC时间
  const marketplace = config.marketplace || 'US';
  const now = new Date();
  const currentHour = getLocalHour(now, marketplace);
  const currentDayOfWeek = getLocalDayOfWeek(now, marketplace);
  
  // v183: 预加载多维度组合分析结果，用于分投放词分时竞价
  let comboAnalysisMap = new Map<number, any>(); // keywordId -> comboAnalysis
  try {
    const dbConn = await getDb();
    if (dbConn) {
      const comboResults = await multiDimComboAnalyzer.getComboAnalysisForAccount(dbConn, config.accountId);
      for (const combo of comboResults) {
        if (combo.keywordId) {
          comboAnalysisMap.set(combo.keywordId, combo);
        }
      }
      log.info(`[DaypartingOptimization] v183: 加载${comboAnalysisMap.size}个投放词的多维度组合分析结果`);
    }
  } catch (comboErr: unknown) {
    log.warn(`[DaypartingOptimization] v183: 加载组合分析结果失败，使用统一乘数: ${(comboErr as Error).message}`);
  }
  
  // v183: 最高出价红线
  const maxBidLimit = config.maxBid || 2.00;
  
  // v310: 处理pending积压的dayparting_bid记录
  try {
    const dbConn2 = await getDb();
    if (dbConn2 && config.performanceGroupId) {
      const { sql } = await import('drizzle-orm');
      
      // v324: 添加performanceGroupId空值检查防止SQL语法错误
      // 查找本优化目标下pending的dayparting_bid记录（最多50条）
      const pendingDayparting = await dbConn2.execute(sql`
        SELECT ol.id, ol.action_detail, ol.created_at,
               JSON_UNQUOTE(JSON_EXTRACT(ol.action_detail, '$.keywordId')) as kw_id,
               JSON_UNQUOTE(JSON_EXTRACT(ol.action_detail, '$.newBid')) as new_bid,
               JSON_UNQUOTE(JSON_EXTRACT(ol.action_detail, '$.baseBid')) as base_bid
        FROM optimization_logs ol
        WHERE ol.performance_group_id = ${config.performanceGroupId}
          AND ol.action_type = 'dayparting_bid'
          AND ol.api_sync_status = 'pending'
        ORDER BY ol.created_at DESC
        LIMIT 50
      `);
      // @ts-ignore
      const pendingRows = (pendingDayparting as unknown)[0] || [];
      
      if (pendingRows.length > 0) {
        log.info(`[DaypartingOptimization] v310: 发现${pendingRows.length}条pending的dayparting_bid，开始处理`);
        let retried = 0, superseded = 0, timedOut = 0;
        
        // 按keywordId分组，只保留每个keyword的最新pending记录
        const latestByKeyword = new Map<string, any>();
        const olderIds: number[] = [];
        
        for (const row of (pendingRows as any[])) {
          const kwId = row.kw_id;
          if (!kwId) continue;
          if (latestByKeyword.has(kwId)) {
            olderIds.push(row.id);
          } else {
            latestByKeyword.set(kwId, row);
          }
        }
        
        // 标记旧的重复记录为superseded
        if (olderIds.length > 0) {
          await dbConn2.execute(sql`
            UPDATE optimization_logs SET api_sync_status = 'superseded',
              api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.superseded_reason', 'v310: 同一keyword已有更新的分时竞价指令')
            WHERE id IN (${safeInClause(olderIds)})
          `);
          superseded = olderIds.length;
        }
        
        // 对每个keyword的最新pending记录尝试重新同步
        for (const [kwId, row] of latestByKeyword) {
          try {
            const detail = typeof row.action_detail === 'string' ? JSON.parse(row.action_detail) : row.action_detail;
            const newBid = parseFloat(detail?.newBid || detail?.adjustedBid || '0');
            const localCampaignId = detail?.localCampaignId;
            const amazonCampaignId = detail?.amazonCampaignId;
            
            // 检查记录是否超过72小时
            const createdAt = new Date(row.created_at);
            const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
            if (ageHours > 72) {
              // 超过72小时的分时竞价已过时，当前时段不同了
              await dbConn2.execute(sql`
                UPDATE optimization_logs SET api_sync_status = 'superseded',
                  api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.superseded_reason', 'v310: 分时竞价超过72小时已过时')
                WHERE id = ${row.id}
              `);
              timedOut++;
              continue;
            }
            
            if (newBid > 0 && Number(kwId) > 0) {
              const syncResult: any = await amazonApiHelper.syncBidAdjustmentsToAmazon(
                config.accountId,
                [{
                  keywordId: Number(kwId),
                  newBid: newBid,
                  localCampaignId: localCampaignId,
                  amazonCampaignId: amazonCampaignId,
                  reason: 'v310: pending dayparting_bid重试',
                  isProductTarget: false,
                }]
              );
              if (syncResult.success > 0) {
                await dbConn2.execute(sql`
                  UPDATE optimization_logs SET api_sync_status = 'synced',
                    api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_synced', 'v310: dayparting_bid重试成功')
                  WHERE id = ${row.id}
                `);
                retried++;
              } else {
                await dbConn2.execute(sql`
                  UPDATE optimization_logs SET api_sync_status = 'failed',
                    api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_error', ${syncResult.errors.join('; ')})
                  WHERE id = ${row.id}
                `);
              }
            }
          } catch (retryErr: unknown) {
            log.warn(`[DaypartingOptimization] v310: dayparting_bid重试失败 kwId=${kwId}: ${(retryErr as Error).message}`);
          }
        }
        log.warn(`[DaypartingOptimization] v310: pending dayparting_bid处理完成: 重试成功=${retried}, 已过时=${timedOut}, 已覆盖=${superseded}`);
      }
    }
  } catch (pendingErr: unknown) {
    log.warn(`[DaypartingOptimization] v310: pending dayparting_bid处理失败: ${(pendingErr as Error).message}`);
  }
  
  // v349: 分时竞价诊断统计
  let dpDiag = { total: 0, noStrategy: 0, draftInsufficient: 0, draftUpgraded: 0, draftUpgradeFailed: 0, noHourlyRule: 0, noKeywords: 0, bidUnchanged: 0, adjusted: 0 };
  log.info(`[DaypartingOptimization] v349: 开始分时竞价执行, campaigns=${campaigns.length}, hour=${currentHour}, dayOfWeek=${currentDayOfWeek}, marketplace=${marketplace}`);
  
  for (const campaign of (campaigns as any[])) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    dpDiag.total++;
    try {
      // v157: 修复分时策略查找 - 按campaignId查找，并自动创建缺失的策略
      let strategy = await daypartingService.getDaypartingStrategyByCampaignId(campaignAmazonId);
      if (!strategy) {
        // @ts-ignore
        strategy = await daypartingService.ensureDaypartingStrategy(
          config.accountId,
          campaignAmazonId,
          campaign.campaignName,
          {
            optimizationGoal: config.optimizationGoal,
            targetAcos: config.targetAcos,
            targetRoas: config.targetRoas,
          }
        );
      }
      
      // v337: 分时竞价全量开启 — draft状态的策略自动分析数据并升级为active
      if (strategy && strategy.daypartingStatus === 'draft') {
        try {
          // 检查广告活动是否有足够数据（至少7天的每日数据）
          const weeklyData = await daypartingService.analyzeWeeklyPerformance(Number(campaignAmazonId), 30);
          const totalDataPoints = weeklyData.reduce((sum: any, d: any) => sum + d.dataPoints, 0);
          
          if (totalDataPoints >= 7) {
            // 有足够数据，自动分析并生成有意义的分时规则
            const hourlyData = await daypartingService.analyzeHourlyPerformance(Number(campaignAmazonId), 30);
            
            if (hourlyData.length > 0) {
              // 计算最优出价调整并保存
              const bidAdjustments = daypartingService.calculateOptimalBidAdjustments(hourlyData, {
                // @ts-ignore
                optimizationGoal: config.optimizationGoal as unknown,
                targetAcos: config.targetAcos,
                targetRoas: config.targetRoas,
              });
              await daypartingService.saveBidRules(strategy.id, bidAdjustments.map(rule => ({
                dayOfWeek: rule.dayOfWeek,
                hour: rule.hour,
                bidMultiplier: rule.bidMultiplier.toString(),
                avgClicks: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgClicks?.toString(),
                avgSpend: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSpend?.toString(),
                avgSales: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSales?.toString(),
                avgCvr: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCvr?.toString(),
                avgCpc: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCpc?.toString(),
                avgAcos: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgAcos?.toString(),
                dataPoints: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.dataPoints || 0,
                isEnabled: 1,
              })));
              
              // 计算最优预算分配并保存
              const budgetAllocation = daypartingService.calculateOptimalBudgetAllocation(weeklyData, {
                // @ts-ignore
                optimizationGoal: config.optimizationGoal as unknown,
                targetAcos: config.targetAcos,
                targetRoas: config.targetRoas,
              });
              await daypartingService.saveBudgetRules(strategy.id, budgetAllocation.map(rule => ({
                dayOfWeek: rule.dayOfWeek,
                budgetMultiplier: rule.budgetMultiplier.toString(),
                budgetPercentage: rule.budgetPercentage.toString(),
                avgSpend: weeklyData.find(d => d.dayOfWeek === rule.dayOfWeek)?.avgSpend?.toString(),
                avgSales: weeklyData.find(d => d.dayOfWeek === rule.dayOfWeek)?.avgSales?.toString(),
                avgAcos: weeklyData.find(d => d.dayOfWeek === rule.dayOfWeek)?.avgAcos?.toString(),
                avgRoas: weeklyData.find(d => d.dayOfWeek === rule.dayOfWeek)?.avgRoas?.toString(),
                dataPoints: weeklyData.find(d => d.dayOfWeek === rule.dayOfWeek)?.dataPoints || 0,
                isEnabled: 1,
              })));
              
              // 升级策略状态为active
              // @ts-ignore
              await daypartingService.updateDaypartingStrategy(strategy.id, { daypartingStatus: 'active' as unknown });
              strategy.daypartingStatus = 'active';
              log.info(`[DaypartingOptimization] v337: 自动升级分时策略 strategyId=${strategy.id} 从draft→active，数据点=${totalDataPoints}，小时数据=${hourlyData.length}条`);
            }
          } else {
            log.info(`[DaypartingOptimization] v337: 广告活动 ${campaign.campaignName} 数据不足(${totalDataPoints}<7)，保持draft状态`);
          }
        } catch (upgradeErr: unknown) {
          dpDiag.draftUpgradeFailed++;
          log.warn(`[DaypartingOptimization] v337: 自动升级分时策略失败: ${(upgradeErr as Error).message}`);
        }
      }
      
      // v337: 全量开启——active策略正常执行，draft策略在数据充足后自动升级
      if (!strategy || strategy.daypartingStatus !== 'active') {
        dpDiag.noStrategy++;
        continue;
      }
      
      // v351: 定期重新计算分时规则（每24小时重算一次）
      // 解决问题: 已有的bid rules是用旧算法生成的，95.6%为1.00
      // 重算后使用v351新算法，确保规则有意义的偏差
      try {
        const lastAnalyzed = strategy.lastAnalyzedAt ? new Date(strategy.lastAnalyzedAt).getTime() : 0;
        const hoursSinceLastAnalysis = (Date.now() - lastAnalyzed) / (1000 * 60 * 60);
        
        if (hoursSinceLastAnalysis >= 24) {
          const hourlyData = await daypartingService.analyzeHourlyPerformance(Number(campaignAmazonId), 30);
          if (hourlyData.length > 0) {
            const bidAdjustments = daypartingService.calculateOptimalBidAdjustments(hourlyData, {
              // @ts-ignore
              optimizationGoal: config.optimizationGoal as unknown,
              targetAcos: config.targetAcos,
              targetRoas: config.targetRoas,
            });
            await daypartingService.saveBidRules(strategy.id, bidAdjustments.map(rule => ({
              dayOfWeek: rule.dayOfWeek,
              hour: rule.hour,
              bidMultiplier: rule.bidMultiplier.toString(),
              avgClicks: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgClicks?.toString(),
              avgSpend: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSpend?.toString(),
              avgSales: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSales?.toString(),
              avgCvr: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCvr?.toString(),
              avgCpc: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCpc?.toString(),
              avgAcos: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgAcos?.toString(),
              dataPoints: hourlyData.find(h => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.dataPoints || 0,
              isEnabled: 1,
            })));
            // @ts-ignore
            await daypartingService.updateDaypartingStrategy(strategy.id, { lastAnalyzedAt: new Date().toISOString() as unknown });
            log.info(`[DaypartingOptimization] v351: 重新计算分时规则 strategyId=${strategy.id}, 上次分析=${hoursSinceLastAnalysis.toFixed(0)}h前`);
          }
        }
      } catch (recalcErr: unknown) {
        log.warn(`[DaypartingOptimization] v351: 重新计算分时规则失败: ${(recalcErr as Error).message}`);
      }
      
      // 获取当前时段的调整规则
      const hourlyRule = await daypartingService.getHourlyRule(strategy.id, currentDayOfWeek, currentHour);
      if (!hourlyRule) {
        dpDiag.noHourlyRule++;
        continue;
      }
      
      // 基础分时乘数（广告活动级别）
      // @ts-ignore
      const baseDaypartingMultiplier = parseFloat(hourlyRule.bidMultiplier || '1.00');
      
      // 获取广告活动下的所有关键词
      const keywords = await db.getKeywordsByCampaignId(campaignAmazonId);
      
      for (const keyword of keywords) {
        if (keyword.keywordStatus !== 'enabled') continue;
        
        const baseBid = parseFloat(keyword.bid || '0');
        if (baseBid <= 0) continue;
        
        // v183: 多维度资源倾斜算法
        // 最终竞价 = 基础出价 × 分时乘数 × 投放词个性化时间乘数
        let comboTimeMultiplier = 1.0;
        let comboBidMultiplier = 1.0;
        let comboCategory = 'standard';
        let comboConfidence = 'insufficient';
        
        const comboAnalysis = comboAnalysisMap.get(keyword.id);
        if (comboAnalysis) {
          comboCategory = comboAnalysis.comboCategory || 'standard';
          comboConfidence = comboAnalysis.confidenceLevel || 'insufficient';
          
          // 只有置信度达到medium以上才应用个性化乘数
          if (comboConfidence !== 'insufficient') {
            comboBidMultiplier = parseFloat(comboAnalysis.suggestedBidMultiplier || '1.000');
            comboTimeMultiplier = parseFloat(comboAnalysis.suggestedTimeMultiplier || '1.000');
            
            // v183: 检查当前时段是否在该投放词的最佳/最差时间窗口内
            const bestWindows: unknown[] = comboAnalysis.bestTimeWindows || [];
            const worstWindows: unknown[] = comboAnalysis.worstTimeWindows || [];
            
            // @ts-ignore
            const isInBestWindow = bestWindows.some((w: Record<string, any>) => 
              w.dayOfWeek === currentDayOfWeek && currentHour >= w.startHour && currentHour <= w.endHour
            );
            // @ts-ignore
            const isInWorstWindow = worstWindows.some((w: Record<string, any>) => 
              w.dayOfWeek === currentDayOfWeek && currentHour >= w.startHour && currentHour <= w.endHour
            );
            
            if (isInBestWindow) {
              // 黄金时段: 额外提升时间乘数 (1.1x ~ 1.3x)
              comboTimeMultiplier = Math.min(comboTimeMultiplier * 1.15, 1.30);
            } else if (isInWorstWindow) {
              // 铅石时段: 降低时间乘数 (0.7x ~ 0.9x)
              comboTimeMultiplier = Math.max(comboTimeMultiplier * 0.85, 0.70);
            }
          }
        }
        
        // v183: 统一资源分配公式
        // 最终乘数 = 广告活动分时乘数 × 投放词个性化竞价乘数 × 投放词个性化时间乘数
        const finalMultiplier = baseDaypartingMultiplier * comboBidMultiplier * comboTimeMultiplier;
        let adjustedBid = baseBid * finalMultiplier;
        
        // 安全护栏: 单次调整不超过基础出价的40%
        const maxAdjustedBid = baseBid * 1.40;
        const minAdjustedBid = baseBid * 0.60;
        adjustedBid = Math.min(adjustedBid, maxAdjustedBid);
        adjustedBid = Math.max(adjustedBid, minAdjustedBid);
        
        // 绝对红线: 不超过最高出价限制
        adjustedBid = Math.min(adjustedBid, maxBidLimit);
        adjustedBid = Math.max(adjustedBid, 0.02);
        adjustedBid = Math.round(adjustedBid * 100) / 100;
        
        const reasonParts: string[] = [];
        reasonParts.push(`分时${baseDaypartingMultiplier.toFixed(2)}x`);
        if (comboBidMultiplier !== 1.0) reasonParts.push(`投放词${comboBidMultiplier.toFixed(3)}x`);
        if (comboTimeMultiplier !== 1.0) reasonParts.push(`时段${comboTimeMultiplier.toFixed(3)}x`);
        if (comboCategory !== 'standard') reasonParts.push(`[${comboCategory}]`);
        
        const adjustment: Record<string, any> = {
          accountId: config.accountId,
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          campaignName: campaign.campaignName,
          keywordId: keyword.id,
          keywordText: keyword.keywordText,
          hour: currentHour,
          dayOfWeek: currentDayOfWeek,
          baseBid,
          bidMultiplier: finalMultiplier,
          baseDaypartingMultiplier,
          comboBidMultiplier,
          comboTimeMultiplier,
          comboCategory,
          comboConfidence,
          adjustedBid,
          currentBid: baseBid,
          newBid: adjustedBid,
          reason: `v183分时竞价: ${currentHour}:00 ${reasonParts.join(' × ')} = ${finalMultiplier.toFixed(3)}x, $${baseBid.toFixed(2)} → $${adjustedBid.toFixed(2)}`,
          algorithmUsed: 'dayparting_engine', // v335: 添加算法标识
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        
        // v351: 降低分时竞价执行阈值 - 使用绝对值和百分比双重判断
        // 原来的$0.01阈值导致97.7%的调整被跳过
        const bidDiff = Math.abs(adjustedBid - baseBid);
        const bidDiffPct = baseBid > 0 ? bidDiff / baseBid : 0;
        if (bidDiff < 0.005 && bidDiffPct < 0.02) {
          continue; // 只有当绝对差异<$0.005且百分比差异<2%时才跳过
        }
        
        details.push(adjustment);
        
        if (!dryRun) {
          try {
            const syncResult: any = await amazonApiHelper.syncBidAdjustmentsToAmazon(
              config.accountId,
              [{
                keywordId: keyword.id,
                newBid: adjustedBid,
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                reason: `v183分时竞价: ${reasonParts.join(' × ')}`,
                isProductTarget: false,
              }]
            );
            if (syncResult.success > 0) {
              adjustmentsCount++;
              adjustment.apiSyncStatus = 'synced';
            } else {
              adjustment.apiSyncStatus = 'failed';
              adjustment.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
            }
          } catch (apiError: unknown) {
            // v267 P2-1: 分时竞价失败自动重试一次
            try {
              await new Promise(r => setTimeout(r, 2000)); // 等待2秒后重试
              const retryResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
                config.accountId,
                [{
                  keywordId: keyword.id,
                  newBid: adjustedBid,
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
                  reason: `v267分时竞价重试: ${reasonParts.join(' × ')}`,
                  isProductTarget: false,
                }]
              );
              if (retryResult.success > 0) {
                adjustmentsCount++;
                adjustment.apiSyncStatus = 'synced';
                log.info(`[DaypartingOptimization] v267 重试成功 (kw ${keyword.keywordText})`);
              } else {
                adjustment.apiSyncStatus = 'failed';
                adjustment.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message, retryFailed: true });
              }
            } catch (retryError: unknown) {
              adjustment.apiSyncStatus = 'failed';
              adjustment.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message, retryError: (retryError as Error).message });
              log.error(`[DaypartingOptimization] v267 重试也失败 (kw ${keyword.keywordText}):`, (retryError as Error).message);
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
  
  // v349: 分时竞价诊断日志总结
  log.info(`[DaypartingOptimization] v349: 分时竞价执行完成 - 总计=${dpDiag.total}, 无策略/非draft=${dpDiag.noStrategy}, 无小时规则=${dpDiag.noHourlyRule}, 调整=${adjustmentsCount}, 详情=${details.length}条`);
  
  return { executed: true, adjustmentsCount, details };
}

/**
 * v179: 执行分时预算优化
 * 根据星期几的表现数据，动态调整广告活动的每日预算
 * 高投产的星期几增加预算，低投产的星期几减少预算
 */
export async function executeDaypartingBudgetOptimization(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: Record<string, any>[] }> {
  const details: Record<string, any>[] = [];
  let adjustmentsCount = 0;
  
  // 获取当前星期几（站点本地时间）
  const marketplace = config.marketplace || 'US';
  const now = new Date();
  const currentDayOfWeek = getLocalDayOfWeek(now, marketplace);
  
  for (const campaign of (campaigns as any[])) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // 获取分时策略
      let strategy = await daypartingService.getDaypartingStrategyByCampaignId(campaignAmazonId);
      if (!strategy || strategy.daypartingStatus !== 'active') continue;
      
      // 获取今天的预算规则
      const budgetRules = await daypartingService.getBudgetRules(strategy.id);
      const todayRule = budgetRules.find((r: Record<string, any>) => r.dayOfWeek === currentDayOfWeek);
      
      if (!todayRule) continue;
      
      let budgetMultiplier = parseFloat(todayRule.budgetMultiplier || '1.00');
      
      // v183.1: 叠加多维度组合分析的Campaign级别预算乘数
      let comboBudgetMultiplier = 1.0;
      try {
        const dbConn = await getDb();
        if (!dbConn) throw new Error('Database not available');
        comboBudgetMultiplier = await multiDimComboAnalyzer.getCampaignBudgetMultiplier(
          dbConn, config.accountId, campaignLocalId
        );
        if (Math.abs(comboBudgetMultiplier - 1.0) > 0.001) {
          log.debug(`[DaypartingBudget] v183.1: Campaign ${campaign.campaignName} 组合分析预算乘数: ${comboBudgetMultiplier.toFixed(3)}`);
          // 叠加乘数: 分时预算乘数 × 组合分析预算乘数
          budgetMultiplier = budgetMultiplier * comboBudgetMultiplier;
          // 安全护栏: 最终乘数限制在 0.80 ~ 1.30 之间
          budgetMultiplier = Math.max(0.80, Math.min(1.30, budgetMultiplier));
        }
      } catch (comboErr: unknown) {
        log.warn(`[DaypartingBudget] v183.1: 获取组合分析预算乘数失败: ${(comboErr as Error).message}`);
      }
      
      // 如果倍数接近1.0，跳过调整
      if (Math.abs(budgetMultiplier - 1.0) < 0.05) continue;
      
      const currentBudget = parseFloat(campaign.dailyBudget || '0');
      if (currentBudget <= 0) continue;
      
      // 计算基础预算（如果之前已经调整过，需要还原到基础值）
      // 策略：使用campaign的原始预算作为基础，乘以今天的倍数
      const baseBudget = parseFloat((campaign as Record<string, any>).originalDailyBudget || campaign.dailyBudget || '0');
      const adjustedBudget = Math.round(baseBudget * budgetMultiplier * 100) / 100;
      
      const adjustment: Record<string, any> = {
        accountId: config.accountId,
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        campaignName: campaign.campaignName,
        dayOfWeek: currentDayOfWeek,
        budgetMultiplier,
        baseBudget,
        currentBudget,
        adjustedBudget,
        changeAmount: adjustedBudget - currentBudget,
        changePercent: currentBudget > 0 ? ((adjustedBudget - currentBudget) / currentBudget * 100).toFixed(2) : '0',
        comboBudgetMultiplier,
        reason: `分时预算: 星期${['\u65e5','\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d'][currentDayOfWeek]} 倍数${budgetMultiplier.toFixed(2)}x${comboBudgetMultiplier !== 1.0 ? ` (含组合分析${comboBudgetMultiplier.toFixed(3)}x)` : ''}, $${currentBudget.toFixed(2)} \u2192 $${adjustedBudget.toFixed(2)}`,
        algorithmUsed: 'dayparting_budget', // v335: 添加算法标识
        apiSyncStatus: 'pending',
      };
      
      details.push(adjustment);
      
      // 实际执行预算调整
      if (!dryRun && Math.abs(adjustedBudget - currentBudget) > 0.50) {
        try {
          const amazonCampaignId = campaignAmazonId;
          const budgetSyncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
            config.accountId,
            amazonCampaignId,
            adjustedBudget,
            `v179分时预算: 星期${currentDayOfWeek} 倍数${budgetMultiplier}x`
          );
          
          if (budgetSyncResult) {
            await db.updateCampaign(campaignLocalId, {
              dailyBudget: adjustedBudget.toFixed(2),
              lastOptimizedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            } as Record<string, any>);
            adjustmentsCount++;
            adjustment.apiSyncStatus = 'synced';
            
            // 记录执行日志
            try {
              await daypartingService.logStrategyExecution({
                strategyId: strategy.id,
                executionType: 'budget_adjustment',
                dpTargetType: 'campaign',
                dpTargetId: campaignLocalId,
                dpTargetName: campaign.campaignName,
                previousValue: currentBudget.toFixed(2),
                newValue: adjustedBudget.toFixed(2),
                multiplierApplied: budgetMultiplier.toFixed(2),
                triggerDayOfWeek: currentDayOfWeek,
                triggerHour: getLocalHour(now, marketplace),
                dpExecStatus: 'success',
              });
            } catch (logErr: unknown) {
              log.warn(`[DaypartingBudget] 日志记录失败: ${(logErr as Error).message}`);
            }
            
            log.debug(`[DaypartingBudget] v179: ${campaign.campaignName} 预算调整 $${currentBudget.toFixed(2)} \u2192 $${adjustedBudget.toFixed(2)} (星期${currentDayOfWeek}, 倍数${budgetMultiplier}x)`);
          } else {
            adjustment.apiSyncStatus = 'failed';
            log.warn(`[DaypartingBudget] v179: API同步失败 (Campaign ${campaign.campaignName})`);
          }
        } catch (apiError: unknown) {
          adjustment.apiSyncStatus = 'failed';
          adjustment.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
          log.error(`[DaypartingBudget] v179: API同步异常 (Campaign ${campaign.campaignName}):`, (apiError as Error).message);
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
  
  // 更新策略的lastAppliedAt
  if (adjustmentsCount > 0) {
    try {
      const strategies = await daypartingService.getDaypartingStrategies(config.accountId);
      for (const s of strategies) {
        if (s.daypartingStatus === 'active') {
          await daypartingService.updateDaypartingStrategy(s.id, {
            lastAppliedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          });
        }
      }
    } catch (updateErr: unknown) {
      log.warn(`[DaypartingBudget] 更新lastAppliedAt失败: ${(updateErr as Error).message}`);
    }
  }
  
  return { executed: true, adjustmentsCount, details };
}

/**
 * 执行搜索词分析
 */
