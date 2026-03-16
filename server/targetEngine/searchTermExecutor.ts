/**
 * v362: 优化目标引擎 - searchTermExecutor
 * 从 optimizationTargetEngine.ts 拆分
 * 
 * 包含函数: executeSearchTermAnalysis, executeAutoNgramNegation
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
import { decideTargeting } from "../services/targetingAlgorithm";
import type { SearchTermPerformance, TargetingDecision } from "../services/targetingAlgorithm";
import { sanitizeAndValidateKeyword, canAddPositiveKeyword, isAsinSearchTerm, adGroupHasProductTargets, isProductTargetingCampaign } from "../utils/keywordValidator";
import { createModuleLogger } from '../utils/logger';
import { getCampaignAmazonId, getCampaignLocalId } from '../utils/idTypes';
import { recordAudit, auditBidChange } from '../services/auditLogService';
import { generateNegativeKeywordSuggestions, executeNegativeKeywords as executeNgramNegativeKeywords } from '../analytics/ngramAnalysis';

const log = createModuleLogger('TargetEngine');

// 缓存账号站点信息，避免重复查询
import type { OptimizationExecutionResult, OptimizationTargetConfig } from './types';

export async function executeSearchTermAnalysis(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; negativeKeywordsAdded: number; newKeywordsAdded: number; details: Record<string, any>[] }> {
  const details: Record<string, any>[] = [];
  let negativeKeywordsAdded = 0;
  let newKeywordsAdded = 0;
  
  // v353: 预加载最近30天已处理的搜索词（含 already_exists/synced/failed/permanently_failed），
  // v328: 从24h扩展到7天; v353: 从7天扩展到30天，进一步消除already_exists重复创建（7天窗口仍有74%的already_exists）
  const recentlyProcessedSearchTerms = new Set<string>();
  try {
    const dbInstance = await db.getDb();
    if (dbInstance && config.performanceGroupId) {
      const { sql } = await import('drizzle-orm');
      const recentLogs = await dbInstance.execute(sql`
        SELECT DISTINCT LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm')))) as search_term,
               JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.amazonCampaignId')) as campaign_id
        FROM optimization_logs 
        WHERE performance_group_id = ${config.performanceGroupId}
          AND action_type IN ('keyword_create', 'negative_keyword_add', 'negative_product_target_add', 'search_term_harvest', 'search_term_brand_protect', 'search_term_exploration_protect', 'search_term_permanent_fail_skip', 'search_term_validation_fail', 'product_target_create')
          AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND api_sync_status IN ('synced', 'already_exists', 'failed', 'permanently_failed', 'skipped_pt_adgroup', 'pending', 'not_applicable', 'timeout_failed')
          AND action_detail IS NOT NULL AND JSON_VALID(action_detail)
      `);
      // @ts-ignore
      for (const row of (recentLogs as unknown)[0] || []) {
        if (row.search_term && row.campaign_id) {
          recentlyProcessedSearchTerms.add(`${row.campaign_id}::${row.search_term}`);
        }
      }
      log.info(`[SearchTermAnalysis] v353: 预加载${recentlyProcessedSearchTerms.size}个已处理搜索词用于去重(30天窗口)`);
    }
  } catch (dedupErr: unknown) {
    log.warn(`[SearchTermAnalysis] v328: 去重预加载失败(不影响主流程): ${(dedupErr as Error).message}`, (dedupErr as Error).stack?.slice(0, 300));
  }
  
  // v310-fix: 预加载永久失败的关键词列表，避免反复尝试已知会失败的关键词
  // 两类永久失败: 1）已标记为permanently_failed的 2）普通失败达到3次的
  const permanentlyFailedKeywords = new Set<string>();
  try {
    const dbInstance = await db.getDb();
    if (dbInstance && config.performanceGroupId) {
      const { sql } = await import('drizzle-orm');
      // v310-fix: 同时查询已标记permanently_failed的(哪怕只有1次)和普通失败达3次的
      const failedLogs = await dbInstance.execute(sql`
        SELECT search_term, MAX(fail_count) as fail_count FROM (
          SELECT LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm')))) as search_term,
                 COUNT(*) as fail_count
          FROM optimization_logs 
          WHERE performance_group_id = ${config.performanceGroupId}
            AND action_type = 'keyword_create'
            AND api_sync_status = 'permanently_failed'
            AND action_detail IS NOT NULL AND JSON_VALID(action_detail)
          GROUP BY LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm'))))
          UNION ALL
          SELECT LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm')))) as search_term,
                 COUNT(*) as fail_count
          FROM optimization_logs 
          WHERE performance_group_id = ${config.performanceGroupId}
            AND action_type = 'keyword_create'
            AND api_sync_status = 'failed'
            AND action_detail IS NOT NULL AND JSON_VALID(action_detail)
          GROUP BY LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm'))))
          HAVING COUNT(*) >= 3
        ) combined
        GROUP BY search_term
      `);
      // @ts-ignore
      for (const row of (failedLogs as unknown)[0] || []) {
        if (row.search_term) {
          permanentlyFailedKeywords.add(row.search_term);
        }
      }
      if (permanentlyFailedKeywords.size > 0) {
        log.warn(`[SearchTermAnalysis] v310: 发现${permanentlyFailedKeywords.size}个永久失败关键词将被跳过: ${[...permanentlyFailedKeywords].slice(0, 5).join(', ')}`);
      }
    }
  } catch (failErr: unknown) {
    log.warn(`[SearchTermAnalysis] v310: 永久失败关键词预加载失败: ${(failErr as Error).message}`, (failErr as Error).stack?.slice(0, 300));
  }
  
  // v310: 处理pending积压 - 尝试重新同步pending的keyword_create和add_product_target
  try {
    const dbInstance = await db.getDb();
    if (dbInstance && config.performanceGroupId) {
      const { sql } = await import('drizzle-orm');
      
      // 查找所有pending的keyword_create记录（最多处理50条，避免API超载）
      // v354: P2修复 — JOIN campaigns表获取campaignType，排除SB/SD广告活动的pending记录
      const pendingKeywords = await dbInstance.execute(sql`
        SELECT ol.id, ol.action_detail, ol.account_id, ol.performance_group_id, ol.campaign_id,
               c.campaignType AS campaign_type
        FROM optimization_logs ol
        LEFT JOIN campaigns c ON c.id = ol.campaign_id
        WHERE ol.performance_group_id = ${config.performanceGroupId}
          AND ol.action_type = 'keyword_create'
          AND ol.api_sync_status = 'pending'
        ORDER BY ol.created_at ASC
        LIMIT 50
      `);
      // @ts-ignore
      const pendingKwRows = (pendingKeywords as unknown)[0] || [];
      
      if (pendingKwRows.length > 0) {
        log.info(`[SearchTermAnalysis] v310: 发现${pendingKwRows.length}条pending的keyword_create，尝试重新同步`);
        let retrySuccess = 0;
        let retryFailed = 0;
        
        for (const row of (pendingKwRows as any[])) {
          try {
            // v354: P2修复 — SB/SD广告活动不支持通过API创建关键词，直接标记为skipped_unsupported_campaign_type
            // @ts-ignore
            const rowCampaignType = (row as unknown).campaign_type;
            if (rowCampaignType === 'sb' || rowCampaignType === 'sd') {
              await dbInstance.execute(sql`
                UPDATE optimization_logs SET api_sync_status = 'skipped_unsupported_campaign_type',
                  api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.skip_reason', ${`v354: ${rowCampaignType.toUpperCase()}广告活动不支持通过API创建关键词`})
                WHERE id = ${row.id}
              `);
              retryFailed++;
              continue;
            }
            
            const detail = typeof row.action_detail === 'string' ? JSON.parse(row.action_detail) : row.action_detail;
            const searchTerm = detail?.searchTerm;
            const matchType = detail?.matchType || 'phrase';
            const bid = detail?.suggestedBid || 0.50;
            const amazonCampaignIdStr = detail?.amazonCampaignId;
            
            // 跳过永久失败的关键词
            if (searchTerm && permanentlyFailedKeywords.has(searchTerm.toLowerCase().trim())) {
              await dbInstance.execute(sql`
                UPDATE optimization_logs SET api_sync_status = 'permanently_failed',
                  api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_skip_reason', 'v310: 关键词在永久失败名单中')
                WHERE id = ${row.id}
              `);
              retryFailed++;
              continue;
            }
            
            if (!amazonCampaignIdStr || !searchTerm) {
              // 缺少关键信息，尝试通过localCampaignId查找Amazon ID
              const localCampaignId = detail?.localCampaignId || detail?.campaignId;
              if (localCampaignId) {
                // v355: P0修复 — campaigns表的Amazon ID列名是campaignId（驼峰），不是campaign_id（下划线）
                const campaignLookup = await dbInstance.execute(sql`
                  SELECT campaignId FROM campaigns WHERE id = ${localCampaignId} LIMIT 1
                `);
                // @ts-ignore
                const lookupRows = (campaignLookup as unknown)[0] || [];
                if (lookupRows.length > 0 && lookupRows[0].campaignId) {
                  // 找到了Amazon Campaign ID，更新action_detail并继续
                  const foundAmazonCampaignId = lookupRows[0].campaignId;
                  const adGroups = await db.getAdGroupsByCampaignId(foundAmazonCampaignId);
                  if (adGroups.length > 0 && searchTerm) {
                    const adGroup = adGroups[0] as any;
                    const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                    if (amazonAdGroupId > 0) {
                      try {
                        const apiResult: any = await amazonApiHelper.syncNewKeywordsToAmazon(
                          config.accountId,
                          [{ adGroupId: amazonAdGroupId, campaignId: foundAmazonCampaignId, keywordText: searchTerm, matchType, bid }]
                        );
                        if (apiResult.success > 0) {
                          await dbInstance.execute(sql`
                            UPDATE optimization_logs SET api_sync_status = 'synced',
                              api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_synced', 'v310: pending重试成功')
                            WHERE id = ${row.id}
                          `);
                          retrySuccess++;
                        } else {
                          await dbInstance.execute(sql`
                            UPDATE optimization_logs SET api_sync_status = 'failed',
                              api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_error', ${apiResult.errors.join('; ')})
                            WHERE id = ${row.id}
                          `);
                          retryFailed++;
                        }
                      } catch (retryApiErr: unknown) {
                        await dbInstance.execute(sql`
                          UPDATE optimization_logs SET api_sync_status = 'failed',
                            api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_error', ${(retryApiErr as Error).message})
                          WHERE id = ${row.id}
                        `);
                        retryFailed++;
                      }
                      continue;
                    }
                  }
                }
              }
              // 无法解析Amazon ID，标记为超时失败
              await dbInstance.execute(sql`
                UPDATE optimization_logs SET api_sync_status = 'timeout_failed',
                  api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.timeout_reason', 'v310: 无法解析Amazon ID')
                WHERE id = ${row.id}
              `);
              retryFailed++;
            } else {
              // 有Amazon Campaign ID，直接重试同步
              const adGroups = await db.getAdGroupsByCampaignId(amazonCampaignIdStr);
              if (adGroups.length > 0) {
                const adGroup = adGroups[0] as any;
                const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                if (amazonAdGroupId > 0) {
                  try {
                    const apiResult: any = await amazonApiHelper.syncNewKeywordsToAmazon(
                      config.accountId,
                      [{ adGroupId: amazonAdGroupId, campaignId: amazonCampaignIdStr, keywordText: searchTerm, matchType, bid }]
                    );
                    if (apiResult.success > 0) {
                      await dbInstance.execute(sql`
                        UPDATE optimization_logs SET api_sync_status = 'synced',
                          api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_synced', 'v310: pending重试成功')
                        WHERE id = ${row.id}
                      `);
                      retrySuccess++;
                    } else {
                      await dbInstance.execute(sql`
                        UPDATE optimization_logs SET api_sync_status = 'failed',
                          api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_error', ${apiResult.errors.join('; ')})
                        WHERE id = ${row.id}
                      `);
                      retryFailed++;
                    }
                  } catch (retryApiErr: unknown) {
                    await dbInstance.execute(sql`
                      UPDATE optimization_logs SET api_sync_status = 'failed',
                        api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_error', ${(retryApiErr as Error).message})
                      WHERE id = ${row.id}
                    `);
                    retryFailed++;
                  }
                } else {
                  await dbInstance.execute(sql`
                    UPDATE optimization_logs SET api_sync_status = 'timeout_failed',
                      api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.timeout_reason', 'v310: adGroupId无效')
                    WHERE id = ${row.id}
                  `);
                  retryFailed++;
                }
              } else {
                await dbInstance.execute(sql`
                  UPDATE optimization_logs SET api_sync_status = 'timeout_failed',
                    api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.timeout_reason', 'v310: 找不到广告组')
                  WHERE id = ${row.id}
                `);
                retryFailed++;
              }
            }
          } catch (rowErr: unknown) {
            log.warn(`[SearchTermAnalysis] v310: pending重试单条失败 id=${row.id}: ${(rowErr as Error).message}`);
            retryFailed++;
          }
        }
        log.warn(`[SearchTermAnalysis] v310: pending keyword_create重试完成: 成功=${retrySuccess}, 失败=${retryFailed}, 总计=${pendingKwRows.length}`);
      }
      
      // v310: 将超过72小时仍然pending的记录标记为timeout_failed（已经重试过但仍然无法处理的）
      const timeoutResult = await dbInstance.execute(sql`
        UPDATE optimization_logs 
        SET api_sync_status = 'timeout_failed',
            api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.timeout_reason', 'v310: pending超过72小时未同步')
        WHERE performance_group_id = ${config.performanceGroupId}
          AND api_sync_status = 'pending'
          AND created_at < DATE_SUB(NOW(), INTERVAL 72 HOUR)
      `);
      const timeoutCount = (timeoutResult as Record<string, any>[])[0]?.affectedRows || 0;
      if (timeoutCount > 0) {
        log.warn(`[SearchTermAnalysis] v310: 标记${timeoutCount}条超过72小时的pending记录为timeout_failed`);
      }
    }
  } catch (timeoutErr: unknown) {
    log.warn(`[SearchTermAnalysis] v310: pending重试处理失败: ${(timeoutErr as Error).message}`, (timeoutErr as Error).stack?.slice(0, 300));
  }
  
  for (const campaign of (campaigns as any[])) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // v311+v2: Campaign级别的Product Targeting检查
      // v2修改: PT campaigns不再完全跳过，而是标记为PT类型，允许否定产品定向操作
      const campaignNameStr = (campaign as Record<string, any>).campaignName || '';
      const isProductTargetingCamp = isProductTargetingCampaign(campaignNameStr);
      
      // v353: 在campaign循环开头预加载广告组PT状态，避免在每个搜索词处理中重复查询
      // 解决skipped_pt_adgroup在API同步阶段才发现导致13%无效keyword_create的问题
      let campaignHasProductTargetAdGroup = false;
      try {
        const campaignAdGroups = await db.getAdGroupsByCampaignId(campaignAmazonId);
        if (campaignAdGroups.length > 0) {
          campaignHasProductTargetAdGroup = await adGroupHasProductTargets(campaignAdGroups[0].id);
        }
      } catch (ptPreCheckErr: unknown) {
        log.debug(`[SearchTermAnalysis] v353: 预检查PT广告组失败(继续处理): ${(ptPreCheckErr as Error).message}`);
      }
      
      if (isProductTargetingCamp) {
        log.info(`[SearchTermAnalysis] v2: Product Targeting campaign: "${campaignNameStr}" (id=${campaignAmazonId})，仅允许否定产品定向操作`);
      }
      
      // 获取搜索词数据
      // @ts-ignore
      const searchTerms = await db.getSearchTermsByCampaignId(campaignAmazonId as string);
      
      // v191: 使用智能投放决策引擎替代旧的classifySearchTerms
      // 获取campaign的定向类型（auto/manual）
      const campaignTargetingType = (campaign as Record<string, any>).targetingType || 
        ((campaign as Record<string, any>).campaignType === 'sp_auto' ? 'auto' : 'manual');
      const targetAcos = config.targetAcos || 30; // 默认30%
      
      // v191: 将搜索词数据转换为智能决策引擎所需的格式
      // v2: 新增campaignType字段，用于否定策略分发
      const rawCampaignType = (campaign as Record<string, any>).campaignType || 'sp_auto';
      const v2CampaignType = (() => {
        if (rawCampaignType === 'sponsoredProducts' || rawCampaignType === 'sp') {
          return campaignTargetingType === 'auto' ? 'sp_auto' : 'sp_manual';
        }
        if (rawCampaignType === 'sponsoredBrands' || rawCampaignType === 'sb') return 'sb';
        if (rawCampaignType === 'sponsoredDisplay' || rawCampaignType === 'sd') return 'sd';
        // 默认根据定向类型推断
        return campaignTargetingType === 'auto' ? 'sp_auto' : 'sp_manual';
      })() as 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
      
      const searchTermPerformanceList: SearchTermPerformance[] = searchTerms.map((st: Record<string, any>) => ({
        searchTerm: st.searchTerm,
        clicks: Number(st.searchTermClicks || 0),
        impressions: Number(st.searchTermImpressions || 0),
        orders: Number(st.searchTermOrders || 0),
        spend: Number(st.searchTermSpend || 0),
        sales: Number(st.searchTermSales || 0),
        campaignTargetingType: campaignTargetingType as 'auto' | 'manual',
        campaignType: v2CampaignType,  // v2: 新增广告活动类型
        targetAcos: targetAcos,
      }));
      
      log.debug(`[SearchTermAnalysis] v191: Campaign "${campaign.campaignName}" (${campaignTargetingType}): ${searchTermPerformanceList.length}个搜索词待分析`);
      
      // v122h: 获取品牌词用于保护
      const account = await db.getAdAccountById(config.accountId);
      const brandTerms = account?.storeName ? [account.storeName] : [];
      
      // v191: 对每个搜索词调用智能决策引擎
      for (const stPerf of searchTermPerformanceList) {
        const decision = decideTargeting(stPerf);
        
        // SKIP和MONITOR不需要操作
        if (decision.action === 'SKIP' || decision.action === 'MONITOR') {
          continue;
        }
        
        // v353: 搜索词级别去重 — 如果该搜索词+campaign在最近30天内已处理过，直接跳过
        const dedupKey = `${campaignAmazonId}::${stPerf.searchTerm.toLowerCase().trim()}`;
        if (recentlyProcessedSearchTerms.has(dedupKey)) {
          log.debug(`[SearchTermAnalysis] v328: 跳过已处理搜索词: "${stPerf.searchTerm}" (campaign=${campaignAmazonId})`);
          continue;
        }
        
        // v310: 永久失败关键词检查 — 如果该关键词已连续失败≥3次，跳过创建
        if (decision.action === 'CREATE_KEYWORD' && permanentlyFailedKeywords.has(stPerf.searchTerm.toLowerCase().trim())) {
          log.info(`[SearchTermAnalysis] v310: 跳过永久失败关键词: "${stPerf.searchTerm}"`);
          details.push({
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            searchTerm: stPerf.searchTerm,
            action: 'keyword_permanently_failed_skip',
            reason: `v310: 关键词已连续失败≥3次，标记为永久失败，不再重试`,
            algorithmUsed: 'search_term_analyzer', // v335
            apiSyncStatus: 'permanently_failed',
          });
          continue;
        }
        
        // ===== 否定关键词处理 =====
        if (decision.action === 'CREATE_NEGATIVE_KEYWORD') {
          // v122h: 品牌词保护 - 不否定含有品牌词的搜索词
          if (brandTerms.length > 0 && isProtectedKeyword(stPerf.searchTerm, brandTerms)) {
            details.push({
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              searchTerm: stPerf.searchTerm,
              action: 'brand_protect_skip',
              reason: `[品牌词保护] 搜索词"${stPerf.searchTerm}"含有品牌词，跳过否定`,
              algorithmUsed: 'search_term_analyzer', // v335
            });
            continue;
          }
          
          // v122h: 探索期保护 - 检查对应的投放词是否在探索期内
          const matchingKeywords = await db.getKeywordsByCampaignId(campaignAmazonId);
          const matchingKw = matchingKeywords.find((kw: Record<string, any>) => 
            kw.keywordText?.toLowerCase() === stPerf.searchTerm.toLowerCase()
          );
          if (matchingKw?.createdAt) {
            const kwCreatedAt = new Date(matchingKw.createdAt);
            if (isNewKeyword(kwCreatedAt, matchingKw.clicks || 0, matchingKw.impressions || 0, 7)) {
              details.push({
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                campaignName: campaign.campaignName,
                searchTerm: stPerf.searchTerm,
                action: 'exploration_protect_skip',
                reason: `[探索期保护] 对应投放词在探索期内，跳过否定，给予充分的数据积累时间`,
                algorithmUsed: 'search_term_analyzer', // v335
              });
              continue;
            }
          }
          
          // v204: 否定词预验证 — 在入队前清洗特殊字符并检查Amazon限制
          let negMatchType = decision.negativeMatchType === 'negative_exact' ? 'negative_exact' : 'negative_phrase';
          // @ts-ignore
          const negValidation = sanitizeAndValidateKeyword(decision.targetValue, negMatchType as unknown);
          let cleanedNegText = negValidation.sanitizedText || decision.targetValue;
          
          if (!negValidation.isValid) {
            // v204: 如果negative_phrase超过4个词，自动升级为negative_exact（最多10个词）
            if (negMatchType === 'negative_phrase' && negValidation.reasonCode === 'EXCEEDS_MAX_WORDS_NEG_PHRASE') {
              const exactValidation = sanitizeAndValidateKeyword(decision.targetValue, 'negative_exact');
              if (exactValidation.isValid) {
                negMatchType = 'negative_exact';
                cleanedNegText = exactValidation.sanitizedText;
                log.debug(`[SearchTermAnalysis] v204: 否定短语"${decision.targetValue}"超过4词限制，自动升级为negative_exact`);
              } else {
                log.warn(`[SearchTermAnalysis] v204: 否定词预验证失败(升级后仍无效): "${decision.targetValue}" → ${exactValidation.reasonMessage}`);
                details.push({
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
                  campaignName: campaign.campaignName,
                  searchTerm: decision.targetValue,
                  action: 'negative_validation_failed',
                  reason: `v204预验证失败: ${exactValidation.reasonMessage}`,
                  algorithmUsed: 'search_term_analyzer', // v335
                });
                continue;
              }
            } else {
              log.warn(`[SearchTermAnalysis] v204: 否定词预验证失败: "${decision.targetValue}" → ${negValidation.reasonMessage}`);
              details.push({
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                campaignName: campaign.campaignName,
                searchTerm: decision.targetValue,
                action: 'negative_validation_failed',
                reason: `v204预验证失败: ${negValidation.reasonMessage}`,
                algorithmUsed: 'search_term_analyzer', // v335
              });
              continue;
            }
          }
          
          // v170: 否定关键词去重检查
          let negativeAlreadyExists = false;
          if (!dryRun) {
            const dbInstance = await db.getDb();
            if (dbInstance) {
              const { negativeKeywords: negKwTable } = await import('../../drizzle/schema');
              const { eq: eqOp, and: andOp } = await import('drizzle-orm');
              const existingNeg = await dbInstance.select({ id: negKwTable.id, amazonNegativeKeywordId: negKwTable.amazonNegativeKeywordId })
                .from(negKwTable)
                .where(andOp(
                  eqOp(negKwTable.campaignId, campaignAmazonId as string),
                  eqOp(negKwTable.negativeText, cleanedNegText)
                ))
                .limit(1);
              if (existingNeg.length > 0) {
                negativeAlreadyExists = true;
                log.info(`[SearchTermAnalysis] v170: 否定关键词已存在，跳过: "${cleanedNegText}" campaignId=${campaign.campaignId}`);
              }
            }
          }

          const negativeKeyword: Record<string, any> = {
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            searchTerm: cleanedNegText,
            matchType: negMatchType,
            action: 'add_negative',
            reason: `v204智能否定: ${decision.reason}`,
            algorithmUsed: 'search_term_analyzer', // v335
            apiSyncStatus: negativeAlreadyExists ? 'already_exists' : 'pending',
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
          };
          
          details.push(negativeKeyword);
          
          if (!dryRun && !negativeAlreadyExists) {
            const matchType = negMatchType === 'negative_exact' ? 'exact' : 'phrase';
            negativeKeyword._pendingDbInsert = {
              accountId: campaign.accountId || 0,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              negativeLevel: decision.negativeScope || 'campaign',  // v2: 使用算法决策的层级
              negativeType: 'keyword',
              negativeText: cleanedNegText,
              negativeMatchType: negMatchType,
              negativeSource: decision.negativeType === 'keyword' ? 'smart_negation' : 'auto_optimization',  // v2
              campaignType: decision.campaignType || 'sp',  // v2: 新增
              negativeScope: decision.negativeScope || 'campaign',  // v2: 新增
              createdAt: new Date().toISOString(),
            };
            negativeKeywordsAdded++;
          }
        }
        
        // ===== v2: 否定产品定向处理 (ASIN否定) =====
        else if (decision.action === 'CREATE_NEGATIVE_PRODUCT_TARGET') {
          // v2: 品牌词保护不适用于ASIN否定，但仍需检查去重
          let negProdAlreadyExists = false;
          if (!dryRun) {
            const dbInstance = await db.getDb();
            if (dbInstance) {
              const { negativeKeywords: negKwTable } = await import('../../drizzle/schema');
              const { eq: eqOp, and: andOp } = await import('drizzle-orm');
              const existingNeg = await dbInstance.select({ id: negKwTable.id })
                .from(negKwTable)
                .where(andOp(
                  eqOp(negKwTable.campaignId, campaignAmazonId as string),
                  eqOp(negKwTable.negativeText, decision.targetValue),
                  eqOp(negKwTable.negativeType, 'product')
                ))
                .limit(1);
              if (existingNeg.length > 0) {
                negProdAlreadyExists = true;
                log.info(`[SearchTermAnalysis] v2: 否定产品定向已存在，跳过: "${decision.targetValue}" campaignId=${campaign.campaignId}`);
              }
            }
          }
          
          const negativeProduct: Record<string, any> = {
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            searchTerm: decision.targetValue,
            matchType: 'negative_product_target',
            action: 'add_negative_product_target',
            reason: `v2智能否定: ${decision.reason}`,
            algorithmUsed: 'search_term_analyzer',
            apiSyncStatus: negProdAlreadyExists ? 'already_exists' : 'pending',
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
            // v2: 新增字段
            negativeType: decision.negativeType || 'product',
            negativeScope: decision.negativeScope || 'campaign',
            campaignType: decision.campaignType || 'sp',
          };
          
          details.push(negativeProduct);
          
          if (!dryRun && !negProdAlreadyExists) {
            negativeProduct._pendingDbInsert = {
              accountId: campaign.accountId || 0,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              negativeLevel: decision.negativeScope || 'campaign',
              negativeType: 'product',
              negativeText: decision.targetValue,
              negativeMatchType: 'negative_exact',
              negativeSource: 'smart_negation',
              campaignType: decision.campaignType || 'sp',
              negativeScope: decision.negativeScope || 'campaign',
              createdAt: new Date().toISOString(),
            };
            negativeKeywordsAdded++;
          }
        }
        
        // ===== 正面关键词处理 =====
        else if (decision.action === 'CREATE_KEYWORD') {
          // v351: SB/SD广告活动不支持通过API创建新关键词
          // Amazon SB API只有listSbKeywords，没有createSbKeywords
          // 尝试用createSpKeywords会返回ERROR，导致大量无效重试
          if (v2CampaignType === 'sb' || v2CampaignType === 'sd') {
            log.info(`[SearchTermAnalysis] v351: ${v2CampaignType.toUpperCase()}广告活动不支持通过API创建关键词，跳过: "${decision.targetValue}" (campaign="${campaignNameStr}")`);
            // v354: P2修复 — 记录到optimization_logs，避免静默跳过无法追踪
            details.push({
              accountId: config.accountId,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              action: 'keyword_create',
              reason: `v354: ${v2CampaignType.toUpperCase()}广告活动不支持通过API创建关键词，跳过`,
              algorithmUsed: 'search_term_analyzer',
              apiSyncStatus: 'skipped_unsupported_campaign_type',
            });
            continue;
          }
          // v2: Product Targeting campaign不能添加正面关键词
          if (isProductTargetingCamp) {
            log.info(`[SearchTermAnalysis] v2: PT campaign不支持正面关键词，跳过: "${decision.targetValue}" (campaign="${campaignNameStr}")`);
            continue;
          }
          // v191+v311: 自动广告活动和Product Targeting campaign不能添加正面关键词（双重保险）
          if (!canAddPositiveKeyword(campaignTargetingType, campaignNameStr)) {
            log.info(`[SearchTermAnalysis] v311: campaign不支持添加正面关键词，跳过: "${decision.targetValue}" (campaign="${campaignNameStr}", type=${campaignTargetingType})`);
            continue;
          }
          
          // v353: 品牌词前置过滤 - 品牌词不应作为正面关键词创建
          // 品牌词通过Amazon API创建会被拒绝(code=ERROR)，导致反复重试浪费API配额
          if (brandTerms.length > 0 && isProtectedKeyword(decision.targetValue, brandTerms)) {
            log.info(`[SearchTermAnalysis] v353: 品牌词前置过滤: "${decision.targetValue}" 含品牌词，跳过正面关键词创建`);
            details.push({
              accountId: config.accountId,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              action: 'brand_protect_skip',
              reason: `v353: 品牌词前置过滤 - "${decision.targetValue}"含品牌词，不创建正面关键词`,
              algorithmUsed: 'search_term_analyzer',
            });
            continue;
          }
          
          // v353: 广告组级别PT前置检查 - 如果广告组已有product targets，不能添加keyword
          if (campaignHasProductTargetAdGroup) {
            log.info(`[SearchTermAnalysis] v353: 广告组已有product targets，前置跳过keyword创建: "${decision.targetValue}" (campaign="${campaignNameStr}")`);
            details.push({
              accountId: config.accountId,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              action: 'keyword_validation_failed',
              reason: `v353: 广告组已有product targets，不支持添加keyword`,
              algorithmUsed: 'search_term_analyzer',
              apiSyncStatus: 'skipped_pt_adgroup',
            });
            continue;
          }
          
          // v194: ASIN格式的搜索词不应该作为keyword创建，重定向到product target
          if (isAsinSearchTerm(decision.targetValue)) {
            log.debug(`[SearchTermAnalysis] v194: ASIN搜索词"${decision.targetValue}"重定向为product target`);
            const ptBid = decision.suggestedBid || 0.50;
            details.push({
              accountId: config.accountId,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              matchType: 'product_target_exact',
              action: 'add_product_target',
              reason: `v194: ASIN搜索词自动重定向为product target: ${decision.reason}`,
              suggestedBid: ptBid,
              algorithmUsed: 'search_term_analyzer', // v335
              apiSyncStatus: 'pending',
              confidence: decision.confidence,
              dataMaturityLevel: decision.dataMaturityLevel,
              valueLevel: decision.valueLevel,
            });
            continue;
          }
          
          // v204: 正面关键词预验证 — 在入队前清洗特殊字符并检查Amazon限制
          const posValidation = sanitizeAndValidateKeyword(decision.targetValue, 'positive');
          if (!posValidation.isValid) {
            log.warn(`[SearchTermAnalysis] v204: 正面关键词预验证失败: "${decision.targetValue}" → ${posValidation.reasonMessage}`);
            details.push({
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              action: 'keyword_validation_failed',
              reason: `v204预验证失败: ${posValidation.reasonMessage}`,
              algorithmUsed: 'search_term_analyzer', // v335
            });
            continue;
          }
          const cleanedPosText = posValidation.sanitizedText;
          
          // v191: 使用算法决定的匹配方式和出价
          const matchType = decision.matchType || 'phrase';
          const bid = decision.suggestedBid || 0.50;
          
          const newKeyword: Record<string, any> = {
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            searchTerm: cleanedPosText,
            matchType: matchType,
            action: 'add_keyword',
            reason: `v204智能投放: ${decision.reason}`,
            suggestedBid: bid,
            algorithmUsed: 'search_term_analyzer', // v335
            apiSyncStatus: dryRun ? 'pending' : 'pending',
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
            valueLevel: decision.valueLevel,
          };
          
          details.push(newKeyword);
          
          if (!dryRun) {
            const dbInstance = await db.getDb();
            if (dbInstance) {
              const adGroups = await db.getAdGroupsByCampaignId(campaignAmazonId);
              if (adGroups.length > 0) {
                const adGroup = adGroups[0] as any;
                const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                // v201: 直接使用字符串避免大数字精度丢失
                const amazonCampaignId = campaignAmazonId;
                
                // v194: 检查广告组是否已有product targets
                try {
                  const hasProductTargets = await adGroupHasProductTargets(adGroup.id);
                  if (hasProductTargets) {
                    log.info(`[SearchTermAnalysis] v194: 广告组已有product targets，不能添加keyword，跳过: "${decision.targetValue}"`);
                    newKeyword.apiSyncStatus = 'skipped_pt_adgroup';
                    continue;
                  }
                } catch (ptCheckErr: unknown) {
                  log.warn(`[SearchTermAnalysis] v194: 检查product targets失败: ${(ptCheckErr as Error).message}`);
                }
                
                // v168: 增强去重检查
                const { keywords } = await import('../../drizzle/schema');
                const { eq: eqOp, and: andOp } = await import('drizzle-orm');
                // v387: 添加accountId过滤确保数据隔离
                const existingKeywords = await dbInstance.select({ id: keywords.id, keywordId: keywords.keywordId, matchType: keywords.matchType })
                  .from(keywords)
                  .where(andOp(
                    eqOp(keywords.accountId, config.accountId),
                    eqOp(keywords.adGroupId, String(adGroup.id)),  // v357: adGroupId现在是varchar类型
                    eqOp(keywords.keywordText, decision.targetValue)
                  ))
                  .limit(10);
                
                if (existingKeywords.length > 0) {
                  // v139: 清理重复记录
                  if (existingKeywords.length > 1) {
                    const withId = existingKeywords.filter(k => k.keywordId !== null);
                    const withoutId = existingKeywords.filter(k => k.keywordId === null);
                    const toDelete = withId.length > 0 ? withoutId : withoutId.slice(1);
                    for (const dup of toDelete) {
                      try {
                        await dbInstance.delete(keywords).where(eqOp(keywords.id, dup.id));
                        log.debug(`[SearchTermAnalysis] 清理重复关键词: id=${dup.id} "${decision.targetValue}"`);
                      } catch (delErr: unknown) {
                        log.warn(`[SearchTermAnalysis] 清理重复关键词失败: id=${dup.id}: ${(delErr as Error).message}`);
                      }
                    }
                  }
                  const existingMatchTypes = existingKeywords.map(k => k.matchType || 'unknown').join(',');
                  newKeyword.apiSyncStatus = 'already_exists';
                  newKeyword.apiSyncDetail = JSON.stringify({ existingId: existingKeywords[0].id, existingKeywordId: existingKeywords[0].keywordId, existingMatchTypes });
                  log.info(`[SearchTermAnalysis] v168: 关键词已存在，跳过: "${decision.targetValue}" (请求=${matchType}, 已存在=${existingMatchTypes})`);
                } else {
                  // v191: 使用算法建议的出价而非固定$0.50
                  // @ts-ignore
                  const insertResult = await dbInstance.insert(keywords).values({
                    adGroupId: String(adGroup.id),  // v357: adGroupId现在是varchar类型
                    keywordText: decision.targetValue,
                    matchType: matchType as string,
                    bid: String(bid),
                    keywordStatus: 'enabled',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  });
                  const localKeywordId = (insertResult as Record<string, any>[])[0]?.insertId;
                  
                  if (Number(amazonAdGroupId) > 0 && Number(amazonCampaignId) > 0) {
                    try {
                      const apiResult: any = await amazonApiHelper.syncNewKeywordsToAmazon(
                        config.accountId,
                        [{
                          localKeywordId: localKeywordId || undefined,
                          adGroupId: amazonAdGroupId,
                          campaignId: amazonCampaignId,
                          keywordText: decision.targetValue,
                          matchType: matchType,
                          bid: bid,
                        }]
                      );
                      if (apiResult.success > 0) {
                        newKeyword.apiSyncStatus = 'synced';
                        log.info(`[SearchTermAnalysis] v191: 新关键词[${matchType}]已同步: "${decision.targetValue}" bid=$${bid}`);
                      } else {
                        newKeyword.apiSyncStatus = 'failed';
                        newKeyword.apiSyncDetail = JSON.stringify({ errors: apiResult.errors });
                        log.error(`[SearchTermAnalysis] 新关键词同步失败: "${decision.targetValue}" - ${apiResult.errors.join('; ')}`);
                      }
                    } catch (apiError: unknown) {
                      newKeyword.apiSyncStatus = 'failed';
                      newKeyword.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
                      log.error(`[SearchTermAnalysis] 新关键词API异常: "${decision.targetValue}" -`, (apiError as Error).message);
                    }
                  } else {
                    log.warn(`[SearchTermAnalysis] 缺少Amazon ID，无法同步: adGroupId=${amazonAdGroupId}, campaignId=${amazonCampaignId}`);
                  }
                }
              }
            }
            if (newKeyword.apiSyncStatus !== 'already_exists') {
              newKeywordsAdded++;
            }
          }
        }
        
        // ===== ASIN商品定向处理 =====
        else if (decision.action === 'CREATE_PRODUCT_TARGET') {
          // v191: ASIN商品定向投放 - 精确定向或扩展定向
          const ptType = decision.productTargetingType || 'exact';
          const bid = decision.suggestedBid || 0.50;
          
          const newTarget: Record<string, any> = {
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            searchTerm: decision.targetValue,
            matchType: `product_target_${ptType}`,
            action: 'add_product_target',
            reason: `v191智能ASIN定向: ${decision.reason}`,
            suggestedBid: bid,
            algorithmUsed: 'search_term_analyzer', // v335
            apiSyncStatus: dryRun ? 'pending' : 'pending',
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
            valueLevel: decision.valueLevel,
          };
          
          details.push(newTarget);
          
          // v310: 实现ASIN商品定向的Amazon API同步
          if (!dryRun) {
            const dbInstance = await db.getDb();
            if (dbInstance) {
              const adGroups = await db.getAdGroupsByCampaignId(campaignAmazonId);
              if (adGroups.length > 0) {
                const adGroup = adGroups[0] as any;
                const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                const amazonCampaignId = campaignAmazonId;
                
                // v310: 检查是否已存在相同的product target
                const { productTargets } = await import('../../drizzle/schema');
                const { eq: eqOp, and: andOp } = await import('drizzle-orm');
                const existingTargets = await dbInstance.select({ id: productTargets.id, targetId: productTargets.targetId })
                  .from(productTargets)
                  .where(andOp(
                    eqOp(productTargets.adGroupId, String(adGroup.id)),  // v357: adGroupId现在是varchar类型
                    eqOp(productTargets.targetValue, decision.targetValue)
                  ))
                  .limit(5);
                
                if (existingTargets.length > 0) {
                  newTarget.apiSyncStatus = 'already_exists';
                  newTarget.apiSyncDetail = JSON.stringify({ existingId: existingTargets[0].id, existingTargetId: existingTargets[0].targetId });
                  log.info(`[SearchTermAnalysis] v310: ASIN定向已存在，跳过: "${decision.targetValue}"`);
                } else if (Number(amazonAdGroupId) > 0 && Number(amazonCampaignId) > 0) {
                  // 先写入本地DB
                  try {
                    const insertResult = await dbInstance.insert(productTargets).values({
                      adGroupId: String(adGroup.id),  // v357: adGroupId现在是varchar类型
                      targetType: 'asin',
                      targetValue: decision.targetValue,
                      bid: String(bid),
                      targetStatus: 'enabled',
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    });
                    const localTargetId = (insertResult as Record<string, any>[])[0]?.insertId;
                    
                    // 同步到Amazon
                    try {
                      const ptSyncResult = await amazonApiHelper.syncNewProductTargetsToAmazon(
                        config.accountId,
                        [{
                          localTargetId: localTargetId || undefined,
                          adGroupId: amazonAdGroupId,
                          campaignId: amazonCampaignId,
                          asin: decision.targetValue,
                          targetingType: ptType as 'exact' | 'expanded',
                          bid: bid,
                        }]
                      );
                      if (ptSyncResult.success > 0) {
                        newTarget.apiSyncStatus = 'synced';
                        // 回写Amazon targetId
                        const mapKey = `${amazonAdGroupId}:${decision.targetValue}`;
                        const amazonTargetId = ptSyncResult.targetIdMap.get(mapKey);
                        if (amazonTargetId && localTargetId) {
                          await dbInstance.execute(sql`
                            UPDATE product_targets SET target_id = ${String(amazonTargetId)} WHERE id = ${localTargetId}
                          `);
                        }
                        log.info(`[SearchTermAnalysis] v310: ASIN定向已同步: "${decision.targetValue}" bid=$${bid}`);
                      } else {
                        newTarget.apiSyncStatus = 'failed';
                        newTarget.apiSyncDetail = JSON.stringify({ errors: ptSyncResult.errors });
                        log.error(`[SearchTermAnalysis] v310: ASIN定向同步失败: "${decision.targetValue}" - ${ptSyncResult.errors.join('; ')}`);
                      }
                    } catch (apiError: unknown) {
                      newTarget.apiSyncStatus = 'failed';
                      newTarget.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
                      log.error(`[SearchTermAnalysis] v310: ASIN定向API异常: "${decision.targetValue}" -`, (apiError as Error).message);
                    }
                  } catch (dbErr: unknown) {
                    newTarget.apiSyncStatus = 'failed';
                    newTarget.apiSyncDetail = JSON.stringify({ error: `DB insert failed: ${(dbErr as Error).message}` });
                    log.error(`[SearchTermAnalysis] v310: ASIN定向DB写入失败: "${decision.targetValue}" - ${(dbErr as Error).message}`);
                  }
                } else {
                  log.warn(`[SearchTermAnalysis] v310: 缺少Amazon ID，无法同步ASIN定向: adGroupId=${amazonAdGroupId}, campaignId=${amazonCampaignId}`);
                }
              }
            }
          }
          log.debug(`[SearchTermAnalysis] v310: ASIN定向决策[${ptType}]: "${decision.targetValue}" bid=$${bid} status=${newTarget.apiSyncStatus} (${decision.reason})`);
        }
      }
      // v134: 同步否定关键词到 Amazon API，并记录同步状态
      // v2: 同时处理否定产品定向
      if (!dryRun) {
        // v2: 否定产品定向同步
        const negProdDetails = details.filter(d => d.action === 'add_negative_product_target' && d.localCampaignId === campaignLocalId);
        if (negProdDetails.length > 0) {
          try {
            const amazonCampaignIdStr = campaignAmazonId;
            const negProdCampaignType = negProdDetails[0]?.campaignType || 'sp';
            const negProdScope = negProdDetails[0]?.negativeScope || 'campaign';
            
            log.info(`[SearchTermAnalysis] v2: 否定产品定向同步: ${negProdDetails.length}个, 类型=${negProdCampaignType}, 层级=${negProdScope}`);
            
            // v2: 根据campaignType和negativeScope调用不同的API
            const negProdSyncResult = await amazonApiHelper.syncNegativeProductTargetsToAmazon(
              config.accountId,
              negProdDetails.map(d => ({
                campaignId: amazonCampaignIdStr,
                adGroupId: d.adGroupId || '',
                asin: d.searchTerm,
                campaignType: d.campaignType || 'sp',
                negativeScope: d.negativeScope || 'campaign',
              }))
            );
            
            const negProdSyncStatus = negProdSyncResult.failed === 0 && negProdSyncResult.success > 0 ? 'synced' : 
                                      negProdSyncResult.success === 0 ? 'failed' : 'partial';
            for (const d of (negProdDetails as any[])) {
              d.apiSyncStatus = negProdSyncStatus;
            }
            log.info(`[SearchTermAnalysis] v2: 否定产品定向API同步: ${negProdDetails.length}个, 状态=${negProdSyncStatus}`);
            
            // v2: API成功后写入本地DB
            if (negProdSyncStatus === 'synced' || negProdSyncStatus === 'partial') {
              const dbInstance = await db.getDb();
              if (dbInstance) {
                const { negativeKeywords } = await import('../../drizzle/schema');
                for (const d of (negProdDetails as any[])) {
                  if (d._pendingDbInsert && d.apiSyncStatus !== 'failed') {
                    try {
                      await dbInstance.insert(negativeKeywords).values(d._pendingDbInsert);
                      log.info(`[SearchTermAnalysis] v2: 否定产品DB写入成功: "${d.searchTerm}"`);
                    } catch (dbErr: unknown) {
                      log.error(`[SearchTermAnalysis] v2: 否定产品DB写入失败: "${d.searchTerm}" - ${(dbErr as Error).message}`);
                    }
                  }
                }
              }
            }
          } catch (apiError: unknown) {
            for (const d of (negProdDetails as any[])) {
              d.apiSyncStatus = 'failed';
              d.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
            }
            log.error(`[SearchTermAnalysis] v2: 否定产品定向API同步失败:`, (apiError as Error).message);
          }
        }
        
        const negativeDetails = details.filter(d => d.action === 'add_negative' && d.localCampaignId === campaignLocalId);
        if (negativeDetails.length > 0) {
          try {
            // v201: 直接使用字符串避免大数字精度丢失
            const amazonCampaignId = campaignAmazonId;
            // v2: 使用算法决策的negativeScope来确定否定层级
            const negSyncResult = await amazonApiHelper.syncNegativeKeywordsToAmazon(
              config.accountId,
              negativeDetails.map(d => ({
                campaignId: amazonCampaignId,
                keywordText: d.searchTerm,
                matchType: d.matchType === 'negative_exact' ? 'negativeExact' as const : 'negativePhrase' as const,
                level: (d.negativeScope === 'ad_group' ? 'adgroup' : 'campaign') as 'campaign' | 'adgroup',
                adGroupId: d.adGroupId || undefined,
              }))
            );
            // v134: 将同步状态回写到detail中
            const negSyncStatus = negSyncResult.failed === 0 && negSyncResult.success > 0 ? 'synced' : 
                                  negSyncResult.success === 0 ? 'failed' : 'partial';
            for (const d of (negativeDetails as any[])) {
              d.apiSyncStatus = negSyncStatus;
              if (negSyncResult.errors.length > 0) {
                d.apiSyncDetail = JSON.stringify({ errors: negSyncResult.errors });
              }
            }
            log.info(`[SearchTermAnalysis] Amazon API同步: ${negativeDetails.length}个否定词, 状态=${negSyncStatus} (Campaign ${campaign.campaignName})`);
            
            // v165: API成功后才写入本地DB（先API后DB原则）
            if (negSyncStatus === 'synced' || negSyncStatus === 'partial') {
              const dbInstance = await db.getDb();
              if (dbInstance) {
                const { negativeKeywords } = await import('../../drizzle/schema');
                for (const d of (negativeDetails as any[])) {
                  if (d._pendingDbInsert && d.apiSyncStatus !== 'failed') {
                    try {
                      await dbInstance.insert(negativeKeywords).values(d._pendingDbInsert);
                      
                      // v195: 回写amazon_negative_keyword_id
                      const mapKey = `campaign:${amazonCampaignId}:${d.searchTerm.toLowerCase()}`;
                      const amazonNegId = negSyncResult.keywordIdMap?.get(mapKey);
                      if (amazonNegId) {
                        await dbInstance.execute(sql`
                          UPDATE negative_keywords 
                          SET amazon_negative_keyword_id = ${amazonNegId}
                          WHERE negativeText = ${d.searchTerm}
                            AND campaignId = ${campaign.campaignId}
                            AND amazon_negative_keyword_id IS NULL
                          LIMIT 1
                        `);
                        log.info(`[SearchTermAnalysis] v195: 否词ID回写成功: "${d.searchTerm}" -> ${amazonNegId}`);
                      }
                      
                      log.info(`[SearchTermAnalysis] v165: 否词DB写入成功: "${d.searchTerm}"`);
                    } catch (dbErr: unknown) {
                      log.error(`[SearchTermAnalysis] v165: 否词DB写入失败: "${d.searchTerm}" - ${(dbErr as Error).message}`);
                    }
                  }
                }
              }
              
              // v166: 注册否词验证任务
              try {
                const successNegDetails = negativeDetails.filter(d => d.apiSyncStatus !== 'failed');
                if (successNegDetails.length > 0) {
                  postOptVerifier.scheduleNegativeKeywordVerification(
                    config.accountId,
                    successNegDetails.map(d => ({
                      localId: d._pendingDbInsert?.id || 0,
                      keywordText: d.searchTerm,
                      matchType: d.matchType === 'negative_exact' ? 'negativeExact' : 'negativePhrase',
                      localCampaignId: campaignLocalId,
                      amazonCampaignId: campaignAmazonId,
                    }))
                  );
                }
              } catch (verifyErr: unknown) {
                log.warn(`[SearchTermAnalysis] v166: 注册验证任务失败(不影响主流程): ${(verifyErr as Error).message}`);
              }
            } else {
              log.warn(`[SearchTermAnalysis] v165: API同步失败，跳过本地DB写入 (Campaign ${campaign.campaignName})`);
            }
          } catch (apiError: unknown) {
            for (const d of (negativeDetails as any[])) {
              d.apiSyncStatus = 'failed';
              d.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
            }
            log.error(`[SearchTermAnalysis] Amazon API同步失败，未写入本地DB (Campaign ${campaign.campaignName}):`, (apiError as Error).message);
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
  
  return { executed: true, negativeKeywordsAdded, newKeywordsAdded, details };
}

/**
 * 执行预算分配优化
 */
export async function executeAutoNgramNegation(
  config: Record<string, any>,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; negativeKeywordsAdded: number; details: Record<string, any>[] }> {
  const details: Record<string, any>[] = [];
  let negativeKeywordsAdded = 0;
  
  if (!config.accountId || campaigns.length === 0) {
    return { executed: false, negativeKeywordsAdded: 0, details: [{ reason: '无账号或无广告活动' }] };
  }
  
  const campaignIds = campaigns.map((c: Record<string, any>) => c.id);
  
  // 1. 获取全局Ngram否定建议（跨所有campaign）
  const globalSuggestions = await generateNegativeKeywordSuggestions(
    config.accountId,
    campaignIds,
    30 // 30天数据窗口
  );
  
  // 只自动执行高优先级的否定建议
  const autoExecuteSuggestions = globalSuggestions.filter(s => s.priority === 'high');
  
  if (autoExecuteSuggestions.length === 0) {
    log.info(`[NgramAutoNegation] v337.3: 账号${config.accountId}无高优先级Ngram否定建议`);
    return { executed: true, negativeKeywordsAdded: 0, details: [{ reason: '无高优先级Ngram否定建议' }] };
  }
  
  log.info(`[NgramAutoNegation] v337.3: 发现${autoExecuteSuggestions.length}个高优先级Ngram否定建议，开始全局/局部分析`);
  
  // 2. 对每个高优先级建议，分析其在各campaign中的表现（全局 vs 局部）
  const dbInstance = await getDb();
  if (!dbInstance) {
    return { executed: false, negativeKeywordsAdded: 0, details: [{ error: 'Database not available' }] };
  }
  
  for (const suggestion of (autoExecuteSuggestions as any[])) {
    try {
      // 查询该Ngram在各campaign中的表现
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const startDateStr = startDate.toISOString().split('T')[0];
      
      const campaignPerformance = await dbInstance.execute(sql`
        SELECT 
          campaign_id,
          SUM(search_term_spend) as spend,
          SUM(search_term_sales) as sales,
          SUM(search_term_orders) as orders,
          SUM(search_term_clicks) as clicks
        FROM search_terms
        WHERE account_id = ${config.accountId}
        AND report_start_date >= ${startDateStr}
        AND search_term LIKE ${`%${suggestion.ngram}%`}
        AND campaign_id IN (${safeInClause(campaignIds)})
        GROUP BY campaign_id
      `);
      
      const perfRows = (campaignPerformance as any[])[0] || [];
      
      // 判断全局 vs 局部
      let badCampaigns: number[] = [];
      let goodCampaigns: number[] = [];
      
      for (const row of (perfRows as any[])) {
        const spend = Number(row.spend) || 0;
        const sales = Number(row.sales) || 0;
        const orders = Number(row.orders) || 0;
        const acos = sales > 0 ? (spend / sales) * 100 : Infinity;
        
        // 该Ngram在此campaign中表现差：零转化或ACoS > 100%
        if (orders === 0 || acos > 100) {
          badCampaigns.push(Number(row.campaign_id));
        } else {
          goodCampaigns.push(Number(row.campaign_id));
        }
      }
      
      // 决策：全局否定 vs 局部否定
      const isGlobalNegation = goodCampaigns.length === 0; // 在所有campaign中都表现差
      const targetCampaigns = isGlobalNegation ? campaignIds : badCampaigns;
      const negationScope = isGlobalNegation ? 'global' : 'local';
      
      if (targetCampaigns.length === 0) {
        continue; // 没有需要否定的campaign
      }
      
      log.info(`[NgramAutoNegation] v337.3: Ngram "${suggestion.ngram}" → ${negationScope}否定 (${targetCampaigns.length}个campaign)`);
      
      if (dryRun) {
        details.push({
          ngram: suggestion.ngram,
          matchType: suggestion.matchType,
          negationScope,
          targetCampaignCount: targetCampaigns.length,
          reason: suggestion.reason,
          dryRun: true,
        });
        negativeKeywordsAdded += targetCampaigns.length;
        continue;
      }
      
      // 执行否定
      for (const campaignId of targetCampaigns) {
        try {
          const execResult = await executeNgramNegativeKeywords(
            config.accountId,
            campaignId,
            null, // campaign级否定
            [{ keyword: suggestion.ngram, matchType: suggestion.matchType }]
          );
          
          if (execResult.addedCount > 0) {
            negativeKeywordsAdded += execResult.addedCount;
          }
          
          details.push({
            ngram: suggestion.ngram,
            matchType: suggestion.matchType,
            campaignId,
            negationScope,
            success: execResult.success,
            addedCount: execResult.addedCount,
            reason: suggestion.reason,
          });
        } catch (execError: unknown) {
          details.push({
            ngram: suggestion.ngram,
            campaignId,
            error: (execError as Error).message,
          });
        }
      }
    } catch (error: unknown) {
      details.push({
        ngram: suggestion.ngram,
        error: `分析失败: ${(error as Error).message}`,
      });
    }
  }
  
  // 3. 记录中/低优先级建议供用户审核
  const pendingSuggestions = globalSuggestions.filter(s => s.priority !== 'high');
  if (pendingSuggestions.length > 0) {
    details.push({
      pendingReviewCount: pendingSuggestions.length,
      message: `${pendingSuggestions.length}个中/低优先级Ngram否定建议待用户审核`,
    });
  }
  
  return { executed: true, negativeKeywordsAdded, details };
}
