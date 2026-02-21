/**
 * OptimizationAutoCorrector v177
 * 
 * 自动纠错服务 — 检测并修复过往所有错误优化
 * 
 * 纠错范围:
 * 1. API同步失败重试 — 对failed/pending状态的优化事件自动重试发送到Amazon
 * 2. 出价不一致检测与纠正 — 检测keyword当前bid与最近成功优化bid不一致的情况
 * 3. 预算不一致检测与纠正 — 检测campaign当前budget与最近成功优化budget不一致
 * 4. 位置倾斜不一致检测与纠正
 * 5. 回滚真正执行 — 将标记为rolled_back但未真正执行的回滚指令发送到Amazon
 * 6. 否词验证 — 确认添加的否词是否在Amazon端生效
 * 7. v177: 搜索词收割重试 — 从action_detail中提取失败的keyword_create事件信息，重新创建关键词
 * 
 * 触发方式:
 * - 系统启动时自动运行一次全量纠错扫描
 * - 每次数据同步完成后自动运行增量纠错扫描
 * - 可通过API手动触发
 * 
 * 设计原则:
 * - 多租户安全: 每次纠错操作都绑定accountId
 * - 幂等性: 同一个纠错操作不会重复执行
 * - 渐进式: 每次最多纠正一定数量的错误，避免API限流
 * - 日志完整: 每次纠错操作都记录到optimization_events
 */

import { getDb } from './db';
import * as db from './db';
import { optimizationEvents, keywords, campaigns, adGroups, negativeKeywords, performanceGroups, productTargets } from '../drizzle/schema';
import { eq, and, or, sql, inArray, isNull, desc, lt, gt, gte, lte } from 'drizzle-orm';
import * as amazonApiHelper from './services/amazonApiHelper';

// ==================== 配置 ====================

const AUTO_CORRECTION_CONFIG = {
  // 每次纠错扫描最大处理数量（避免API限流）
  maxBidCorrectionsPerRun: 50,
  maxBudgetCorrectionsPerRun: 20,
  maxPlacementCorrectionsPerRun: 20,
  maxRetryPerRun: 30,
  maxRollbackPerRun: 20,
  
  // API同步失败重试的最大次数
  maxRetryAttempts: 3,
  
  // 认为优化事件"过期"的天数（超过此天数不再重试）
  retryExpiryDays: 7,
  
  // 出价不一致的容差范围（美元）
  bidToleranceDollar: 0.01,
  
  // 预算不一致的容差范围（美元） - v175: 提高到$2避免纠正舍入差异
  budgetToleranceDollar: 2.00,
  
  // 位置倾斜不一致的容差范围（百分比）
  placementTolerancePercent: 1,
  
  // 两次纠错扫描之间的最小间隔（毫秒）
  minScanIntervalMs: 10 * 60 * 1000, // 10分钟
  
  // 定时扫描间隔（小时）
  scanIntervalHours: 1,
};

// ==================== 纠错结果类型 ====================

export interface CorrectionResult {
  type: 'bid_retry' | 'bid_mismatch' | 'budget_retry' | 'budget_mismatch' | 
        'placement_mismatch' | 'rollback_execution' | 'settings_retry' | 'max_bid_violation' | 'orphan_keyword_cleanup' | 'keyword_create_retry';
  accountId: number;
  targetId: number;
  targetType: string;
  previousValue: string;
  correctedValue: string;
  reason: string;
  success: boolean;
  errorMessage?: string;
}

export interface CorrectionScanResult {
  scanId: string;
  startedAt: Date;
  completedAt: Date;
  accountsScanned: number;
  totalIssuesFound: number;
  totalCorrected: number;
  totalFailed: number;
  details: {
    bidRetries: { found: number; corrected: number; failed: number };
    bidMismatches: { found: number; corrected: number; failed: number };
    budgetRetries: { found: number; corrected: number; failed: number };
    budgetMismatches: { found: number; corrected: number; failed: number };
    placementMismatches: { found: number; corrected: number; failed: number };
    rollbackExecutions: { found: number; corrected: number; failed: number };
    settingsRetries: { found: number; corrected: number; failed: number };
    keywordCreateRetries: { found: number; corrected: number; failed: number };
    maxBidViolations: { found: number; corrected: number; failed: number };
    orphanKeywordCleanups: { found: number; corrected: number; failed: number };
  };
  corrections: CorrectionResult[];
}

// ==================== 状态追踪 ====================

let lastScanTime: Date | null = null;
let isScanning = false;
const scanHistory: CorrectionScanResult[] = [];

// ==================== 主入口 ====================

/**
 * 运行完整的自动纠错扫描
 * @param accountId 可选，指定账户ID时只扫描该账户
 */
export async function runAutoCorrection(accountId?: number): Promise<CorrectionScanResult> {
  if (isScanning) {
    console.log('[AutoCorrector] v177: 纠错扫描正在进行中，跳过本次请求');
    return createEmptyScanResult('skipped_in_progress');
  }
  
  // 检查最小扫描间隔
  if (lastScanTime && (Date.now() - lastScanTime.getTime()) < AUTO_CORRECTION_CONFIG.minScanIntervalMs) {
    console.log('[AutoCorrector] v177: 距离上次扫描不足10分钟，跳过');
    return createEmptyScanResult('skipped_too_frequent');
  }
  
  isScanning = true;
  const scanId = `scan_${Date.now()}`;
  const startedAt = new Date();
  const corrections: CorrectionResult[] = [];
  
  console.log(`[AutoCorrector] v177: 开始自动纠错扫描 (scanId: ${scanId}, accountId: ${accountId || 'all'})`);
  
  try {
    const database = await getDb();
    if (!database) {
      console.error('[AutoCorrector] v177: 无法获取数据库连接');
      return createEmptyScanResult('db_error');
    }
    
    // 0. 修复历史NULL api_sync_status记录（全局操作，只需执行一次）
    try {
      const nullFixResult = await fixNullApiSyncStatusRecords(database);
      if (nullFixResult > 0) {
        console.log(`[AutoCorrector] v177: 已修复${nullFixResult}条历史NULL api_sync_status记录`);
      }
    } catch (nullFixError: any) {
      console.error(`[AutoCorrector] v177: 修复NULL记录失败: ${nullFixError.message}`);
    }
    
    // 获取需要扫描的账户列表
    const accountIds = accountId ? [accountId] : await getActiveAccountIds(database);
    
    for (const accId of accountIds) {
      try {
        // 1. 重试API同步失败的出价调整
        const bidRetries = await retryFailedBidAdjustments(database, accId);
        corrections.push(...bidRetries);
        
        // 2. 检测并纠正出价不一致
        const bidMismatches = await correctBidMismatches(database, accId);
        corrections.push(...bidMismatches);
        
        // 3. 重试API同步失败的预算调整
        const budgetRetries = await retryFailedBudgetAdjustments(database, accId);
        corrections.push(...budgetRetries);
        
        // 4. 检测并纠正预算不一致
        const budgetMismatches = await correctBudgetMismatches(database, accId);
        corrections.push(...budgetMismatches);
        
        // 5. 检测并纠正位置倾斜不一致
        const placementMismatches = await correctPlacementMismatches(database, accId);
        corrections.push(...placementMismatches);
        
        // 6. 执行未真正执行的回滚
        const rollbacks = await executeUnfinishedRollbacks(database, accId);
        corrections.push(...rollbacks);
        
        // 7. 重试失败的设置变更
        const settingsRetries = await retryFailedSettingsChanges(database, accId);
        corrections.push(...settingsRetries);
        
        // 8. 重试失败/pending的关键词创建
        const keywordCreateRetries = await retryFailedKeywordCreations(database, accId);
        corrections.push(...keywordCreateRetries);
        
        // 9. 重试失败/pending的否定关键词添加
        const negKeywordRetries = await retryFailedNegativeKeywordAdds(database, accId);
        corrections.push(...negKeywordRetries);
        
        // 10. v172: 检测并纠正超出max_bid的关键词出价
        const maxBidViolations = await correctMaxBidViolations(database, accId);
        corrections.push(...maxBidViolations);
        
        // 11. v172: 清理缺少Amazon ID的孤儿关键词（标记为invalid_legacy）
        const orphanCleanups = await cleanupOrphanKeywords(database, accId);
        corrections.push(...orphanCleanups);
        
        // 12. v177: 重试历史失败的搜索词收割（从action_detail中提取信息重新创建关键词）
        const harvestRetries = await retryHistoricalFailedKeywordHarvests(database, accId);
        corrections.push(...harvestRetries);
        
      } catch (accError: any) {
        console.error(`[AutoCorrector] v177: 账户 ${accId} 纠错失败: ${accError.message}`);
      }
    }
    
    const completedAt = new Date();
    const result = buildScanResult(scanId, startedAt, completedAt, accountIds.length, corrections);
    
    // 保存扫描历史（最多保留20条）
    scanHistory.unshift(result);
    if (scanHistory.length > 20) scanHistory.pop();
    
    lastScanTime = completedAt;
    
    console.log(`[AutoCorrector] v177: 纠错扫描完成 - 发现${result.totalIssuesFound}个问题, 纠正${result.totalCorrected}个, 失败${result.totalFailed}个`);
    
    return result;
  } finally {
    isScanning = false;
  }
}

// ==================== 0. 修复历史NULL api_sync_status记录 ====================

/**
 * 修复 optimization_logs 表中 api_sync_status 为 NULL 的历史记录
 * 这些记录是 v165 之前的旧版本代码产生的，当时没有 API 同步机制
 * 将它们标记为 'legacy_unsynced' 以区分新版本的正常记录
 */
async function fixNullApiSyncStatusRecords(database: any): Promise<number> {
  try {
    // 更新 optimization_logs 表中 api_sync_status 为 NULL 的记录
    const updateResult = await database.execute(sql`
      UPDATE optimization_logs 
      SET api_sync_status = 'legacy_unsynced'
      WHERE api_sync_status IS NULL
      LIMIT 500
    `);
    
    const affectedRows = (updateResult as any)?.[0]?.affectedRows || (updateResult as any)?.affectedRows || 0;
    
    if (affectedRows > 0) {
      console.log(`[AutoCorrector] v177: 已将 ${affectedRows} 条 optimization_logs NULL 记录标记为 legacy_unsynced`);
    }
    
    // 同样处理 optimization_events 表
    const updateResult2 = await database.execute(sql`
      UPDATE optimization_events 
      SET api_sync_status = 'legacy_unsynced'
      WHERE api_sync_status IS NULL
      LIMIT 500
    `);
    
    const affectedRows2 = (updateResult2 as any)?.[0]?.affectedRows || (updateResult2 as any)?.affectedRows || 0;
    
    if (affectedRows2 > 0) {
      console.log(`[AutoCorrector] v177: 已将 ${affectedRows2} 条 optimization_events NULL 记录标记为 legacy_unsynced`);
    }
    
    return affectedRows + affectedRows2;
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: fixNullApiSyncStatusRecords 失败: ${error.message}`);
    return 0;
  }
}

// ==================== 1. 重试失败的出价调整 ====================

async function retryFailedBidAdjustments(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // 查找最近7天内API同步失败的出价调整事件
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    
    const failedEvents = await database
      .select({
        id: optimizationEvents.id,
        keywordId: optimizationEvents.keywordId,
        keywordText: optimizationEvents.keywordText,
        campaignId: optimizationEvents.campaignId,
        campaignName: optimizationEvents.campaignName,
        previousBid: optimizationEvents.previousBid,
        newBid: optimizationEvents.newBid,
        actionDetail: optimizationEvents.actionDetail,
        errorMessage: optimizationEvents.errorMessage,
        createdAt: optimizationEvents.createdAt,
      })
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.accountId, accountId),
          eq(optimizationEvents.eventCategory, 'bid_adjustment'),
          eq(optimizationEvents.status, 'success'),
          or(
            eq(optimizationEvents.apiSyncStatus, 'failed'),
            eq(optimizationEvents.apiSyncStatus, 'pending')
          ),
          gte(optimizationEvents.createdAt, expiryDateStr)
        )
      )
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    
    if (failedEvents.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${failedEvents.length}条失败的出价调整需要重试`);
    
    // 按keyword分组，只保留每个keyword最新的一条
    const latestByKeyword = new Map<number, typeof failedEvents[0]>();
    for (const event of failedEvents) {
      if (event.keywordId && !latestByKeyword.has(event.keywordId)) {
        latestByKeyword.set(event.keywordId, event);
      }
    }
    
    // 批量重试
    const retryItems = Array.from(latestByKeyword.values())
      .filter(e => e.keywordId && e.newBid)
      .map(e => ({
        keywordId: e.keywordId!,
        newBid: parseFloat(String(e.newBid)),
        campaignId: e.campaignId || 0,
        reason: `[自动纠错] 重试之前失败的出价调整 (原事件ID: ${e.id})`,
      }));
    
    if (retryItems.length === 0) return results;
    
    try {
      const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
        accountId,
        retryItems
      );
      
      // 更新成功的事件状态
      for (const item of retryItems) {
        const event = Array.from(latestByKeyword.values()).find(e => e.keywordId === item.keywordId);
        if (!event) continue;
        
        const success = syncResult.success > 0;
        
        results.push({
          type: 'bid_retry',
          accountId,
          targetId: item.keywordId,
          targetType: 'keyword',
          previousValue: String(event.previousBid || ''),
          correctedValue: String(item.newBid),
          reason: `重试失败的出价调整 (原事件: ${event.id})`,
          success,
          errorMessage: success ? undefined : '重试仍然失败',
        });
        
        // 更新optimization_events的api_sync_status
        if (success) {
          await database
            .update(optimizationEvents)
            .set({ 
              apiSyncStatus: 'synced',
              apiSyncDetail: JSON.stringify({ correctedBy: 'AutoCorrector', correctedAt: new Date().toISOString() }),
              apiSyncedAt: new Date(),
            })
            .where(eq(optimizationEvents.id, event.id));
          
          // 同时更新keywords表的bid
          await database
            .update(keywords)
            .set({ bid: String(item.newBid) })
            .where(eq(keywords.id, item.keywordId));
        }
      }
    } catch (apiError: any) {
      console.error(`[AutoCorrector] v177: 账户${accountId} 出价重试API调用失败: ${apiError.message}`);
      for (const item of retryItems) {
        results.push({
          type: 'bid_retry',
          accountId,
          targetId: item.keywordId,
          targetType: 'keyword',
          previousValue: '',
          correctedValue: String(item.newBid),
          reason: `重试失败的出价调整`,
          success: false,
          errorMessage: apiError.message,
        });
      }
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} retryFailedBidAdjustments失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 2. 检测并纠正出价不一致 ====================

async function correctBidMismatches(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // v172: 查找最近成功同步的出价调整，但keyword当前bid与调整后的bid不一致
    // 同时JOIN performance_groups获取max_bid，确保纠正值不超过max_bid红线
    const mismatchQuery = sql`
      SELECT 
        oe.id as event_id,
        oe.keyword_id,
        oe.keyword_text,
        oe.campaign_id,
        oe.campaign_name,
        oe.new_bid as expected_bid,
        oe.previous_bid,
        k.bid as current_bid,
        oe.created_at as optimized_at,
        pg.max_bid as max_bid
      FROM optimization_events oe
      JOIN keywords k ON oe.keyword_id = k.id
      JOIN ad_groups ag ON k.adGroupId = ag.id
      JOIN campaigns c ON ag.campaignId = c.id
      LEFT JOIN performance_groups pg ON c.performanceGroupId = pg.id
      WHERE oe.account_id = ${accountId}
        AND oe.event_category = 'bid_adjustment'
        AND oe.status = 'success'
        AND oe.api_sync_status = 'synced'
        AND oe.created_at > DATE_SUB(NOW(), INTERVAL 3 DAY)
        AND ABS(CAST(k.bid AS DECIMAL(10,2)) - CAST(oe.new_bid AS DECIMAL(10,2))) > ${AUTO_CORRECTION_CONFIG.bidToleranceDollar}
        AND oe.id = (
          SELECT MAX(oe2.id) FROM optimization_events oe2 
          WHERE oe2.keyword_id = oe.keyword_id 
            AND oe2.event_category = 'bid_adjustment'
            AND oe2.status = 'success'
            AND oe2.api_sync_status = 'synced'
        )
      ORDER BY oe.created_at DESC
      LIMIT ${AUTO_CORRECTION_CONFIG.maxBidCorrectionsPerRun}
    `;
    
    const mismatches = await database.execute(mismatchQuery);
    const rows = (mismatches as any)[0] || mismatches;
    
    if (!Array.isArray(rows) || rows.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${rows.length}条出价不一致需要纠正`);
    
    // v172: 批量重新发送到Amazon - 但确保纠正值不超过max_bid红线
    const correctionItems = rows.map((row: any) => {
      let targetBid = parseFloat(String(row.expected_bid));
      const maxBid = row.max_bid ? parseFloat(String(row.max_bid)) : 0;
      
      // v172 关键修复: 如果期望出价超过max_bid，使用max_bid作为纠正值
      if (maxBid > 0 && targetBid > maxBid) {
        console.log(`[AutoCorrector] v177: 出价纠正受max_bid限制: keyword=${row.keyword_id} expected=$${targetBid} -> max_bid=$${maxBid}`);
        targetBid = maxBid;
      }
      
      // v172: 如果纠正后的出价与当前出价差异在容忍范围内，跳过
      const currentBid = parseFloat(String(row.current_bid));
      if (Math.abs(targetBid - currentBid) <= AUTO_CORRECTION_CONFIG.bidToleranceDollar) {
        console.log(`[AutoCorrector] v177: 跳过纠正(差异在容忍范围内): keyword=${row.keyword_id} target=$${targetBid} current=$${currentBid}`);
        return null;
      }
      
      return {
        keywordId: row.keyword_id,
        newBid: targetBid,
        campaignId: row.campaign_id || 0,
        reason: `[自动纠错] 出价不一致纠正: 期望$${targetBid.toFixed(2)}, 当前$${row.current_bid}${maxBid > 0 ? ` (max_bid=$${maxBid})` : ''}`,
      };
    }).filter((item: any) => item !== null);
    
    if (correctionItems.length === 0) {
      console.log(`[AutoCorrector] v177: 所有出价纠正项在max_bid限制后已无需纠正`);
      return results;
    }
    
    try {
      const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
        accountId,
        correctionItems
      );
      
      // v172: 使用correctionItems中的实际纠正值（已受max_bid限制）
      const correctionMap = new Map(correctionItems.map((item: any) => [item.keywordId, item.newBid]));
      
      for (const row of rows) {
        const actualTargetBid = correctionMap.get(row.keyword_id);
        if (actualTargetBid === undefined) continue; // 该关键词已被过滤（max_bid限制后无需纠正）
        
        const success = syncResult.success > 0;
        
        results.push({
          type: 'bid_mismatch',
          accountId,
          targetId: row.keyword_id,
          targetType: 'keyword',
          previousValue: String(row.current_bid),
          correctedValue: String(actualTargetBid),
          reason: `出价不一致: 纠正到$${actualTargetBid.toFixed(2)}, 当前$${row.current_bid}`,
          success,
        });
        
        if (success) {
          // v172: 更新keywords表的bid为受max_bid限制后的纠正值
          await database
            .update(keywords)
            .set({ bid: String(actualTargetBid) })
            .where(eq(keywords.id, row.keyword_id));
          
          // 记录纠错事件
          await logCorrectionEvent(database, {
            accountId,
            eventCategory: 'bid_adjustment',
            actionType: 'auto_correction',
            keywordId: row.keyword_id,
            keywordText: row.keyword_text,
            campaignId: row.campaign_id,
            campaignName: row.campaign_name,
            previousBid: String(row.current_bid),
            newBid: String(actualTargetBid),
            changeReason: `[AutoCorrector] 出价不一致纠正: 纠正到$${actualTargetBid.toFixed(2)}, 当前$${row.current_bid}${row.max_bid ? ` (max_bid=$${row.max_bid})` : ''}`,
          });
        }
      }
    } catch (apiError: any) {
      console.error(`[AutoCorrector] v177: 账户${accountId} 出价纠正API调用失败: ${apiError.message}`);
      for (const row of rows) {
        results.push({
          type: 'bid_mismatch',
          accountId,
          targetId: row.keyword_id,
          targetType: 'keyword',
          previousValue: String(row.current_bid),
          correctedValue: String(row.expected_bid),
          reason: `出价不一致纠正失败`,
          success: false,
          errorMessage: apiError.message,
        });
      }
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} correctBidMismatches失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 3. 重试失败的预算调整 ====================

async function retryFailedBudgetAdjustments(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    
    const failedEvents = await database
      .select({
        id: optimizationEvents.id,
        campaignId: optimizationEvents.campaignId,
        campaignName: optimizationEvents.campaignName,
        previousValue: optimizationEvents.previousValue,
        newValue: optimizationEvents.newValue,
        actionDetail: optimizationEvents.actionDetail,
        createdAt: optimizationEvents.createdAt,
      })
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.accountId, accountId),
          eq(optimizationEvents.eventCategory, 'budget_adjustment'),
          eq(optimizationEvents.status, 'success'),
          or(
            eq(optimizationEvents.apiSyncStatus, 'failed'),
            eq(optimizationEvents.apiSyncStatus, 'pending')
          ),
          gte(optimizationEvents.createdAt, expiryDateStr)
        )
      )
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    
    if (failedEvents.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${failedEvents.length}条失败的预算调整需要重试`);
    
    // 按campaign分组，只保留最新的一条
    const latestByCampaign = new Map<number, typeof failedEvents[0]>();
    for (const event of failedEvents) {
      if (event.campaignId && !latestByCampaign.has(event.campaignId)) {
        latestByCampaign.set(event.campaignId, event);
      }
    }
    
    for (const [campId, event] of latestByCampaign) {
      try {
        // v175: 移除$符号后解析预算值，并取整
        const rawBudget = String(event.newValue || '0').replace(/[^0-9.\-]/g, '');
        const newBudget = Math.round(parseFloat(rawBudget));
        if (isNaN(newBudget) || newBudget <= 0) continue;
        
        // 获取campaign的Amazon ID
        const campRows = await database
          .select({ campaignId: campaigns.campaignId })
          .from(campaigns)
          .where(eq(campaigns.id, campId))
          .limit(1);
        
        if (campRows.length === 0) continue;
        const amazonCampaignId = campRows[0].campaignId;
        
        const syncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
          accountId,
          String(amazonCampaignId),
          newBudget,
          `[自动纠错] 重试失败的预算调整 (原事件ID: ${event.id})`
        );
        
        const success = !!syncResult;
        
        results.push({
          type: 'budget_retry',
          accountId,
          targetId: campId,
          targetType: 'campaign',
          previousValue: String(event.previousValue || ''),
          correctedValue: String(newBudget),
          reason: `重试失败的预算调整 (原事件: ${event.id})`,
          success,
        });
        
        if (success) {
          await database
            .update(optimizationEvents)
            .set({ 
              apiSyncStatus: 'synced',
              apiSyncDetail: JSON.stringify({ correctedBy: 'AutoCorrector', correctedAt: new Date().toISOString() }),
              apiSyncedAt: new Date(),
            })
            .where(eq(optimizationEvents.id, event.id));
          
          // 更新campaigns表的dailyBudget
          await database
            .update(campaigns)
            .set({ dailyBudget: String(newBudget) })
            .where(eq(campaigns.id, campId));
        }
      } catch (apiError: any) {
        results.push({
          type: 'budget_retry',
          accountId,
          targetId: campId,
          targetType: 'campaign',
          previousValue: String(event.previousValue || ''),
          correctedValue: String(event.newValue || ''),
          reason: `重试失败的预算调整`,
          success: false,
          errorMessage: apiError.message,
        });
      }
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} retryFailedBudgetAdjustments失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 4. 检测并纠正预算不一致 ====================

async function correctBudgetMismatches(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    const mismatchQuery = sql`
      SELECT 
        oe.id as event_id,
        oe.campaign_id,
        oe.campaign_name,
        oe.new_value as expected_budget,
        oe.previous_value as previous_budget,
        c.dailyBudget as current_budget,
        c.campaignId as amazon_campaign_id,
        oe.created_at as optimized_at
      FROM optimization_events oe
      JOIN campaigns c ON oe.campaign_id = c.id
      WHERE oe.account_id = ${accountId}
        AND oe.event_category = 'budget_adjustment'
        AND oe.status = 'success'
        AND oe.api_sync_status = 'synced'
        AND oe.created_at > DATE_SUB(NOW(), INTERVAL 3 DAY)
        AND ABS(CAST(c.dailyBudget AS DECIMAL(10,2)) - CAST(REPLACE(REPLACE(oe.new_value, '$', ''), ',', '') AS DECIMAL(10,2))) > ${AUTO_CORRECTION_CONFIG.budgetToleranceDollar}
        AND oe.id = (
          SELECT MAX(oe2.id) FROM optimization_events oe2 
          WHERE oe2.campaign_id = oe.campaign_id 
            AND oe2.event_category = 'budget_adjustment'
            AND oe2.status = 'success'
            AND oe2.api_sync_status = 'synced'
        )
      ORDER BY oe.created_at DESC
      LIMIT ${AUTO_CORRECTION_CONFIG.maxBudgetCorrectionsPerRun}
    `;
    
    const mismatches = await database.execute(mismatchQuery);
    const rows = (mismatches as any)[0] || mismatches;
    
    if (!Array.isArray(rows) || rows.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${rows.length}条预算不一致需要纠正`);
    
    for (const row of rows) {
      try {
        // v175: 移除$符号后解析预算值，并取整（Amazon API只接受整数预算）
        const rawExpected = String(row.expected_budget || '0').replace(/[^0-9.\-]/g, '');
        const expectedBudget = Math.round(parseFloat(rawExpected));
        if (isNaN(expectedBudget) || expectedBudget <= 0) {
          console.warn(`[AutoCorrector] v175: 跳过无效预算值: campaign=${row.campaign_id}, raw=${row.expected_budget}`);
          continue;
        }
        
        // v175: 取整后重新检查是否仍然超过容忍度
        const currentBudgetNum = parseFloat(String(row.current_budget || '0').replace(/[^0-9.\-]/g, ''));
        if (!isNaN(currentBudgetNum) && Math.abs(expectedBudget - currentBudgetNum) <= AUTO_CORRECTION_CONFIG.budgetToleranceDollar) {
          console.log(`[AutoCorrector] v175: 取整后预算差异在容忍范围内: campaign=${row.campaign_id}, expected=$${expectedBudget}, current=$${currentBudgetNum}`);
          continue;
        }
        
        const syncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
          accountId,
          String(row.amazon_campaign_id),
          expectedBudget,
          `[自动纠错] 预算不一致纠正: 期望$${row.expected_budget}, 当前$${row.current_budget}`
        );
        
        const success = !!syncResult;
        
        results.push({
          type: 'budget_mismatch',
          accountId,
          targetId: row.campaign_id,
          targetType: 'campaign',
          previousValue: String(row.current_budget),
          correctedValue: String(row.expected_budget),
          reason: `预算不一致: 期望$${row.expected_budget}, 当前$${row.current_budget}`,
          success,
        });
        
        if (success) {
          await database
            .update(campaigns)
            .set({ dailyBudget: String(expectedBudget) })
            .where(eq(campaigns.id, row.campaign_id));
          
          await logCorrectionEvent(database, {
            accountId,
            eventCategory: 'budget_adjustment',
            actionType: 'auto_correction',
            campaignId: row.campaign_id,
            campaignName: row.campaign_name,
            previousValue: String(row.current_budget),
            newValue: String(row.expected_budget),
            changeReason: `[AutoCorrector] 预算不一致纠正`,
          });
        }
      } catch (apiError: any) {
        results.push({
          type: 'budget_mismatch',
          accountId,
          targetId: row.campaign_id,
          targetType: 'campaign',
          previousValue: String(row.current_budget),
          correctedValue: String(row.expected_budget),
          reason: `预算不一致纠正失败`,
          success: false,
          errorMessage: apiError.message,
        });
      }
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} correctBudgetMismatches失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 5. 检测并纠正位置倾斜不一致 ====================

async function correctPlacementMismatches(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    const mismatchQuery = sql`
      SELECT 
        oe.id as event_id,
        oe.campaign_id,
        oe.campaign_name,
        oe.action_detail,
        c.placementTopSearchBidAdjustment as current_top,
        c.placementProductPageBidAdjustment as current_product,
        c.campaignId as amazon_campaign_id,
        oe.created_at as optimized_at
      FROM optimization_events oe
      JOIN campaigns c ON oe.campaign_id = c.id
      WHERE oe.account_id = ${accountId}
        AND oe.event_category = 'placement_adjustment'
        AND oe.status = 'success'
        AND oe.api_sync_status IN ('synced', 'pending')
        AND oe.created_at > DATE_SUB(NOW(), INTERVAL 3 DAY)
        AND oe.id = (
          SELECT MAX(oe2.id) FROM optimization_events oe2 
          WHERE oe2.campaign_id = oe.campaign_id 
            AND oe2.event_category = 'placement_adjustment'
            AND oe2.status = 'success'
        )
      ORDER BY oe.created_at DESC
      LIMIT ${AUTO_CORRECTION_CONFIG.maxPlacementCorrectionsPerRun}
    `;
    
    const mismatches = await database.execute(mismatchQuery);
    const rows = (mismatches as any)[0] || mismatches;
    
    if (!Array.isArray(rows) || rows.length === 0) return results;
    
    for (const row of rows) {
      try {
        // 从action_detail中解析期望的位置倾斜值
        let expectedTop: number | null = null;
        let expectedProduct: number | null = null;
        
        if (row.action_detail) {
          try {
            const detail = typeof row.action_detail === 'string' ? JSON.parse(row.action_detail) : row.action_detail;
            expectedTop = detail.newTopOfSearch ?? detail.suggestedTopMultiplier ?? null;
            expectedProduct = detail.newProductPage ?? detail.suggestedProductMultiplier ?? null;
          } catch {}
        }
        
        if (expectedTop === null && expectedProduct === null) continue;
        
        const currentTop = parseFloat(String(row.current_top || '0'));
        const currentProduct = parseFloat(String(row.current_product || '0'));
        
        const topMismatch = expectedTop !== null && Math.abs(currentTop - expectedTop) > AUTO_CORRECTION_CONFIG.placementTolerancePercent;
        const productMismatch = expectedProduct !== null && Math.abs(currentProduct - expectedProduct) > AUTO_CORRECTION_CONFIG.placementTolerancePercent;
        
        if (!topMismatch && !productMismatch) continue;
        
        const syncResult = await amazonApiHelper.syncPlacementAdjustmentToAmazon(
          accountId,
          String(row.amazon_campaign_id),
          expectedTop ?? currentTop,
          expectedProduct ?? currentProduct,
          `[自动纠错] 位置倾斜不一致纠正`
        );
        
        const success = !!syncResult;
        
        results.push({
          type: 'placement_mismatch',
          accountId,
          targetId: row.campaign_id,
          targetType: 'campaign',
          previousValue: `Top:${currentTop}%, Product:${currentProduct}%`,
          correctedValue: `Top:${expectedTop ?? currentTop}%, Product:${expectedProduct ?? currentProduct}%`,
          reason: `位置倾斜不一致纠正`,
          success,
        });
        
        if (success) {
          // 更新campaigns表
          const updateData: any = {};
          if (expectedTop !== null) updateData.placementTopSearchBidAdjustment = String(expectedTop);
          if (expectedProduct !== null) updateData.placementProductPageBidAdjustment = String(expectedProduct);
          
          await database
            .update(campaigns)
            .set(updateData)
            .where(eq(campaigns.id, row.campaign_id));
        }
      } catch (apiError: any) {
        results.push({
          type: 'placement_mismatch',
          accountId,
          targetId: row.campaign_id,
          targetType: 'campaign',
          previousValue: '',
          correctedValue: '',
          reason: `位置倾斜纠正失败`,
          success: false,
          errorMessage: apiError.message,
        });
      }
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} correctPlacementMismatches失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 6. 执行未完成的回滚 ====================

async function executeUnfinishedRollbacks(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // 查找标记为rolled_back但rolled_back_at为NULL的记录（回滚未真正执行）
    const unfinishedRollbacks = await database
      .select({
        id: optimizationEvents.id,
        keywordId: optimizationEvents.keywordId,
        keywordText: optimizationEvents.keywordText,
        campaignId: optimizationEvents.campaignId,
        campaignName: optimizationEvents.campaignName,
        previousBid: optimizationEvents.previousBid,
        newBid: optimizationEvents.newBid,
        createdAt: optimizationEvents.createdAt,
      })
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.accountId, accountId),
          eq(optimizationEvents.eventCategory, 'bid_adjustment'),
          eq(optimizationEvents.status, 'rolled_back'),
          isNull(optimizationEvents.rolledBackAt)
        )
      )
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(AUTO_CORRECTION_CONFIG.maxRollbackPerRun);
    
    if (unfinishedRollbacks.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${unfinishedRollbacks.length}条未执行的回滚`);
    
    // 按keyword分组，只保留最新的一条
    const latestByKeyword = new Map<number, typeof unfinishedRollbacks[0]>();
    for (const event of unfinishedRollbacks) {
      if (event.keywordId && !latestByKeyword.has(event.keywordId)) {
        latestByKeyword.set(event.keywordId, event);
      }
    }
    
    // 回滚 = 将bid恢复为previousBid
    const rollbackItems = Array.from(latestByKeyword.values())
      .filter(e => e.keywordId && e.previousBid)
      .map(e => ({
        keywordId: e.keywordId!,
        newBid: parseFloat(String(e.previousBid)),
        campaignId: e.campaignId || 0,
        reason: `[自动纠错] 执行回滚: 恢复出价从$${e.newBid}到$${e.previousBid}`,
      }));
    
    if (rollbackItems.length === 0) return results;
    
    try {
      const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
        accountId,
        rollbackItems
      );
      
      const success = syncResult.success > 0;
      
      for (const [kwId, event] of latestByKeyword) {
        results.push({
          type: 'rollback_execution',
          accountId,
          targetId: kwId,
          targetType: 'keyword',
          previousValue: String(event.newBid || ''),
          correctedValue: String(event.previousBid || ''),
          reason: `执行回滚: $${event.newBid} → $${event.previousBid}`,
          success,
        });
        
        if (success) {
          // 更新optimization_events的rolled_back_at
          await database
            .update(optimizationEvents)
            .set({ 
              rolledBackAt: new Date(),
              rolledBackBy: 'AutoCorrector',
              apiSyncStatus: 'synced',
              apiSyncDetail: JSON.stringify({ rolledBackBy: 'AutoCorrector', rolledBackAt: new Date().toISOString() }),
            })
            .where(eq(optimizationEvents.id, event.id));
          
          // 更新keywords表的bid为previousBid
          await database
            .update(keywords)
            .set({ bid: String(event.previousBid) })
            .where(eq(keywords.id, kwId));
        }
      }
    } catch (apiError: any) {
      console.error(`[AutoCorrector] v177: 账户${accountId} 回滚执行API调用失败: ${apiError.message}`);
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} executeUnfinishedRollbacks失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 7. 重试失败的设置变更 ====================

async function retryFailedSettingsChanges(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    
    const failedEvents = await database
      .select({
        id: optimizationEvents.id,
        campaignId: optimizationEvents.campaignId,
        campaignName: optimizationEvents.campaignName,
        actionType: optimizationEvents.actionType,
        actionDetail: optimizationEvents.actionDetail,
        previousValue: optimizationEvents.previousValue,
        newValue: optimizationEvents.newValue,
        createdAt: optimizationEvents.createdAt,
      })
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.accountId, accountId),
          eq(optimizationEvents.eventCategory, 'settings_change'),
          eq(optimizationEvents.apiSyncStatus, 'failed'),
          gte(optimizationEvents.createdAt, expiryDateStr)
        )
      )
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    
    if (failedEvents.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${failedEvents.length}条失败的设置变更需要重试`);
    
    // 设置变更类型多样，需要根据actionType分别处理
    for (const event of failedEvents) {
      try {
        let success = false;
        const actionType = event.actionType || '';
        
        // 根据actionType决定重试方式
        if (actionType.includes('budget') && event.campaignId && event.newValue) {
          const campRows = await database
            .select({ campaignId: campaigns.campaignId })
            .from(campaigns)
            .where(eq(campaigns.id, event.campaignId))
            .limit(1);
          
          if (campRows.length > 0) {
            const syncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
              accountId,
              String(campRows[0].campaignId),
              // v175: 移除$符号后解析预算值
              Math.round(parseFloat(String(event.newValue || '0').replace(/[^0-9.\-]/g, ''))),
              `[自动纠错] 重试设置变更`
            );
            success = !!syncResult;
          }
        }
        // 其他设置变更类型可以在这里扩展
        
        results.push({
          type: 'settings_retry',
          accountId,
          targetId: event.campaignId || 0,
          targetType: 'campaign',
          previousValue: String(event.previousValue || ''),
          correctedValue: String(event.newValue || ''),
          reason: `重试失败的设置变更 (${actionType})`,
          success,
        });
        
        if (success) {
          await database
            .update(optimizationEvents)
            .set({ 
              apiSyncStatus: 'synced',
              apiSyncDetail: JSON.stringify({ correctedBy: 'AutoCorrector', correctedAt: new Date().toISOString() }),
              apiSyncedAt: new Date(),
            })
            .where(eq(optimizationEvents.id, event.id));
        }
      } catch (retryError: any) {
        results.push({
          type: 'settings_retry',
          accountId,
          targetId: event.campaignId || 0,
          targetType: 'campaign',
          previousValue: '',
          correctedValue: '',
          reason: `设置变更重试失败`,
          success: false,
          errorMessage: retryError.message,
        });
      }
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} retryFailedSettingsChanges失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 8. 重试失败/pending的关键词创建 ====================

async function retryFailedKeywordCreations(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    
    // 查找失败/pending的keyword_create事件
    const failedEvents = await database
      .select({
        id: optimizationEvents.id,
        keywordId: optimizationEvents.keywordId,
        keywordText: optimizationEvents.keywordText,
        campaignId: optimizationEvents.campaignId,
        campaignName: optimizationEvents.campaignName,
        actionDetail: optimizationEvents.actionDetail,
        createdAt: optimizationEvents.createdAt,
      })
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.accountId, accountId),
          eq(optimizationEvents.actionType, 'keyword_create'),
          or(
            eq(optimizationEvents.apiSyncStatus, 'failed'),
            eq(optimizationEvents.apiSyncStatus, 'pending')
          ),
          gte(optimizationEvents.createdAt, expiryDateStr)
        )
      )
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    
    if (failedEvents.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${failedEvents.length}条失败/pending的关键词创建需要重试`);
    
    for (const event of failedEvents) {
      try {
        // 从 action_detail 中提取关键信息
        let detail: any = {};
        if (event.actionDetail) {
          try { detail = typeof event.actionDetail === 'string' ? JSON.parse(event.actionDetail) : event.actionDetail; } catch {}
        }
        
        const localKeywordId = event.keywordId || detail.localKeywordId;
        if (!localKeywordId) {
          console.warn(`[AutoCorrector] v177: 关键词创建重试跳过 - 无本地keywordId, eventId=${event.id}`);
          continue;
        }
        
        // 检查本地关键词是否已有Amazon keywordId（可能已通过其他方式创建成功）
        const kwRows = await database
          .select({ id: keywords.id, keywordId: keywords.keywordId, adGroupId: keywords.adGroupId, keywordText: keywords.keywordText, matchType: keywords.matchType, bid: keywords.bid })
          .from(keywords)
          .where(eq(keywords.id, localKeywordId))
          .limit(1);
        
        if (kwRows.length === 0) {
          // 关键词已被删除，标记为not_applicable
          await database.update(optimizationEvents).set({ apiSyncStatus: 'not_applicable', apiSyncDetail: JSON.stringify({ reason: 'keyword_deleted' }) }).where(eq(optimizationEvents.id, event.id));
          continue;
        }
        
        const kw = kwRows[0];
        
        if (kw.keywordId) {
          // 已有Amazon ID，直接标记为synced
          await database.update(optimizationEvents).set({ apiSyncStatus: 'synced', apiSyncDetail: JSON.stringify({ amazonKeywordId: kw.keywordId, correctedBy: 'AutoCorrector' }) }).where(eq(optimizationEvents.id, event.id));
          results.push({ type: 'keyword_create_retry' as any, accountId, targetId: localKeywordId, targetType: 'keyword', previousValue: '', correctedValue: kw.keywordId, reason: '关键词已存在Amazon ID，直接标记为synced', success: true });
          continue;
        }
        
        // 获取adGroup的Amazon adGroupId和campaignId
        const agRows = await database
          .select({ adGroupId: adGroups.adGroupId, campaignId: adGroups.campaignId })
          .from(adGroups)
          .where(eq(adGroups.id, kw.adGroupId))
          .limit(1);
        
        if (agRows.length === 0) {
          console.warn(`[AutoCorrector] v177: 关键词创建重试跳过 - 无adGroup, keywordId=${localKeywordId}`);
          continue;
        }
        
        const ag = agRows[0];
        
        // 获取campaign的Amazon campaignId
        const campRows = await database
          .select({ campaignId: campaigns.campaignId })
          .from(campaigns)
          .where(eq(campaigns.id, ag.campaignId))
          .limit(1);
        
        if (campRows.length === 0) continue;
        
        // 调用Amazon API创建关键词
        const syncResult = await amazonApiHelper.syncNewKeywordsToAmazon(accountId, [{
          localKeywordId: localKeywordId,
          adGroupId: Number(ag.adGroupId),
          campaignId: Number(campRows[0].campaignId),
          keywordText: kw.keywordText,
          matchType: kw.matchType as 'exact' | 'phrase' | 'broad',
          bid: parseFloat(String(kw.bid)) || 0.75,
        }]);
        
        const success = syncResult.success > 0;
        
        if (success) {
          await database.update(optimizationEvents).set({
            apiSyncStatus: 'synced',
            apiSyncDetail: JSON.stringify({ correctedBy: 'AutoCorrector', amazonKeywordId: syncResult.createdKeywords[0]?.amazonKeywordId }),
            apiSyncedAt: new Date(),
          }).where(eq(optimizationEvents.id, event.id));
          
          // 同步更新optimization_logs
          if (event.id) {
            await database.execute(sql`
              UPDATE optimization_logs SET api_sync_status = 'synced' 
              WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${event.id} AND source_table = 'optimization_logs')
            `).catch(() => {});
          }
        } else {
          await database.update(optimizationEvents).set({
            apiSyncStatus: 'failed',
            apiSyncDetail: JSON.stringify({ error: syncResult.errors.join('; '), retryBy: 'AutoCorrector' }),
          }).where(eq(optimizationEvents.id, event.id));
        }
        
        results.push({
          type: 'keyword_create_retry' as any,
          accountId,
          targetId: localKeywordId,
          targetType: 'keyword',
          previousValue: '',
          correctedValue: kw.keywordText,
          reason: `重试创建关键词: ${kw.keywordText}`,
          success,
          errorMessage: success ? undefined : syncResult.errors.join('; '),
        });
      } catch (retryError: any) {
        results.push({ type: 'keyword_create_retry' as any, accountId, targetId: event.keywordId || 0, targetType: 'keyword', previousValue: '', correctedValue: '', reason: '关键词创建重试失败', success: false, errorMessage: retryError.message });
      }
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} retryFailedKeywordCreations失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 9. 重试失败/pending的否定关键词添加 ====================

async function retryFailedNegativeKeywordAdds(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    
    const failedEvents = await database
      .select({
        id: optimizationEvents.id,
        campaignId: optimizationEvents.campaignId,
        campaignName: optimizationEvents.campaignName,
        keywordText: optimizationEvents.keywordText,
        actionDetail: optimizationEvents.actionDetail,
        apiSyncDetail: optimizationEvents.apiSyncDetail,
        createdAt: optimizationEvents.createdAt,
      })
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.accountId, accountId),
          eq(optimizationEvents.actionType, 'negative_keyword_add'),
          or(
            eq(optimizationEvents.apiSyncStatus, 'failed'),
            eq(optimizationEvents.apiSyncStatus, 'pending')
          ),
          gte(optimizationEvents.createdAt, expiryDateStr)
        )
      )
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(AUTO_CORRECTION_CONFIG.maxRetryPerRun);
    
    if (failedEvents.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${failedEvents.length}条失败/pending的否定关键词添加需要重试`);
    
    // 批量收集否定关键词信息
    const negKeywordsToSync: Array<{
      eventId: number;
      campaignId: number;
      adGroupId?: number;
      keywordText: string;
      matchType: 'negativeExact' | 'negativePhrase';
      level: 'campaign' | 'adgroup';
    }> = [];
    
    for (const event of failedEvents) {
      try {
        let detail: any = {};
        if (event.actionDetail) {
          try { detail = typeof event.actionDetail === 'string' ? JSON.parse(event.actionDetail) : event.actionDetail; } catch {}
        }
        
        const searchTerm = detail.searchTerm || event.keywordText;
        const matchType = detail.matchType || 'negative_phrase';
        const amazonCampaignId = detail.amazonCampaignId;
        const amazonAdGroupId = detail.amazonAdGroupId;
        
        if (!searchTerm) continue;
        
        // 获取Amazon Campaign ID
        let resolvedCampaignId = amazonCampaignId;
        if (!resolvedCampaignId && event.campaignId) {
          const campRows = await database
            .select({ campaignId: campaigns.campaignId })
            .from(campaigns)
            .where(eq(campaigns.id, event.campaignId))
            .limit(1);
          if (campRows.length > 0) resolvedCampaignId = Number(campRows[0].campaignId);
        }
        
        if (!resolvedCampaignId) continue;
        
        const normalizedMatchType = matchType.includes('exact') ? 'negativeExact' as const : 'negativePhrase' as const;
        
        // v174: 读取apiSyncDetail中的重试次数
        let retryCount = 0;
        if (event.apiSyncDetail) {
          try {
            const syncDetail = typeof event.apiSyncDetail === 'string' ? JSON.parse(event.apiSyncDetail) : event.apiSyncDetail;
            retryCount = syncDetail.retryCount || 0;
          } catch {}
        }
        
        const nkEntry: any = {
          eventId: event.id,
          campaignId: resolvedCampaignId,
          adGroupId: amazonAdGroupId ? Number(amazonAdGroupId) : undefined,
          keywordText: searchTerm,
          matchType: normalizedMatchType,
          level: amazonAdGroupId ? 'adgroup' : 'campaign',
          retryCount,
        };
        negKeywordsToSync.push(nkEntry);
      } catch (parseErr: any) {
        console.warn(`[AutoCorrector] v177: 解析否定关键词事件失败: eventId=${event.id}, ${parseErr.message}`);
      }
    }
    
    if (negKeywordsToSync.length === 0) return results;
    
    // v174: 检查重试次数，超过3次的标记为permanently_failed
    const maxRetries = AUTO_CORRECTION_CONFIG.maxRetryAttempts;
    const toRetry: typeof negKeywordsToSync = [];
    const toPermanentlyFail: typeof negKeywordsToSync = [];
    
    for (const nk of negKeywordsToSync) {
      if ((nk as any).retryCount >= maxRetries) {
        toPermanentlyFail.push(nk);
      } else {
        toRetry.push(nk);
      }
    }
    
    // 标记超过重试次数的事件为not_applicable
    for (const nk of toPermanentlyFail) {
      await database.update(optimizationEvents).set({
        apiSyncStatus: 'not_applicable',
        apiSyncDetail: JSON.stringify({ 
          reason: `超过最大重试次数(${maxRetries})，放弃重试`,
          retryCount: (nk as any).retryCount,
          lastRetryAt: new Date().toISOString()
        }),
      }).where(eq(optimizationEvents.id, nk.eventId));
      
      await database.execute(sql`
        UPDATE optimization_logs SET api_sync_status = 'not_applicable'
        WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${nk.eventId} AND source_table = 'optimization_logs')
      `).catch(() => {});
      
      results.push({
        type: 'settings_retry',
        accountId,
        targetId: nk.campaignId,
        targetType: 'campaign',
        previousValue: '',
        correctedValue: nk.keywordText,
        reason: `否定关键词超过最大重试次数，放弃: ${nk.keywordText}`,
        success: false,
        errorMessage: `超过最大重试次数(${maxRetries})`,
      });
    }
    
    if (toRetry.length === 0) return results;
    
    // 批量调用Amazon API
    const syncResult = await amazonApiHelper.syncNegativeKeywordsToAmazon(
      accountId,
      toRetry.map(nk => ({
        campaignId: nk.campaignId,
        adGroupId: nk.adGroupId,
        keywordText: nk.keywordText,
        matchType: nk.matchType,
        level: nk.level,
      }))
    );
    
    // v175b: 正确处理部分成功 - 根据每个关键词的实际结果更新状态
    // syncResult.errors 现在包含具体的关键词信息，格式: "Campaign否定词失败[keyword]: error"
    const failedKeywords = new Set<string>();
    for (const err of syncResult.errors) {
      // 从错误信息中提取失败的关键词文本
      const match = err.match(/\[(.+?)\]/);
      if (match) failedKeywords.add(match[1].toLowerCase());
    }
    
    for (const nk of toRetry) {
      const keywordFailed = failedKeywords.has(nk.keywordText.toLowerCase());
      const success = !keywordFailed && syncResult.success > 0;
      const newRetryCount = ((nk as any).retryCount || 0) + 1;
      
      // v175b: 如果Amazon拒绝了关键词(PATTERN_NOT_MATCHED等)，直接标记为永久失败
      const isPermanentError = keywordFailed && syncResult.errors.some(e => 
        e.toLowerCase().includes(nk.keywordText.toLowerCase()) && 
        (e.includes('PATTERN_NOT_MATCHED') || e.includes('Keyword is invalid') || e.includes('malformedValueError'))
      );
      
      if (success) {
        await database.update(optimizationEvents).set({
          apiSyncStatus: 'synced',
          apiSyncDetail: JSON.stringify({ correctedBy: 'AutoCorrector', correctedAt: new Date().toISOString(), retryCount: newRetryCount }),
          apiSyncedAt: new Date(),
        }).where(eq(optimizationEvents.id, nk.eventId));
        
        await database.execute(sql`
          UPDATE optimization_logs SET api_sync_status = 'synced' 
          WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${nk.eventId} AND source_table = 'optimization_logs')
        `).catch(() => {});
        
        // v176: 同步成功后，更新negative_keywords表的amazon_negative_keyword_id
        // 注意：syncResult本身不返回keywordId，但幂等性检查已确认Amazon上存在
        console.log(`[AutoCorrector] v177: 否定词同步成功: "${nk.keywordText}" (campaign=${nk.campaignId})`);
      } else if (isPermanentError) {
        // v175b: Amazon拒绝的无效关键词，直接标记为not_applicable，不再重试
        await database.update(optimizationEvents).set({
          apiSyncStatus: 'not_applicable',
          apiSyncDetail: JSON.stringify({ 
            reason: `Amazon拒绝关键词: ${nk.keywordText}`,
            retryCount: newRetryCount,
            lastRetryAt: new Date().toISOString(),
            permanentError: true,
          }),
        }).where(eq(optimizationEvents.id, nk.eventId));
        
        await database.execute(sql`
          UPDATE optimization_logs SET api_sync_status = 'not_applicable'
          WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${nk.eventId} AND source_table = 'optimization_logs')
        `).catch(() => {});
        
        console.log(`[AutoCorrector] v177: 否定词Amazon永久拒绝，停止重试: "${nk.keywordText}"`);
        
        // v176: 标记negative_keywords表中的记录为removed
        await database.execute(sql`
          UPDATE negative_keywords SET negativeStatus = 'removed'
          WHERE negativeText = ${nk.keywordText}
            AND amazon_negative_keyword_id IS NULL
        `).catch((err: any) => {
          console.warn(`[AutoCorrector] v177: 更新negative_keywords失败: ${err.message}`);
        });
      } else {
        // 临时失败，记录重试次数
        await database.update(optimizationEvents).set({
          apiSyncDetail: JSON.stringify({ 
            retryCount: newRetryCount,
            lastRetryAt: new Date().toISOString(),
            lastError: syncResult.errors.join('; ').substring(0, 200)
          }),
        }).where(eq(optimizationEvents.id, nk.eventId));
      }
      
      results.push({
        type: 'settings_retry',
        accountId,
        targetId: nk.campaignId,
        targetType: 'campaign',
        previousValue: '',
        correctedValue: nk.keywordText,
        reason: isPermanentError 
          ? `否定关键词Amazon永久拒绝: ${nk.keywordText}`
          : `重试添加否定关键词(${newRetryCount}/${maxRetries}): ${nk.keywordText}`,
        success,
        errorMessage: success ? undefined : syncResult.errors.join('; '),
      });
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} retryFailedNegativeKeywordAdds失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 辅助函数 ====================

async function getActiveAccountIds(database: any): Promise<number[]> {
  try {
    const result = await database.execute(sql`
      SELECT DISTINCT account_id FROM optimization_events 
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) 
        AND account_id IS NOT NULL
    `);
    const rows = (result as any)[0] || result;
    return Array.isArray(rows) ? rows.map((r: any) => r.account_id).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function logCorrectionEvent(database: any, data: {
  accountId: number;
  eventCategory: string;
  actionType: string;
  keywordId?: number;
  keywordText?: string;
  campaignId?: number;
  campaignName?: string;
  previousBid?: string;
  newBid?: string;
  previousValue?: string;
  newValue?: string;
  changeReason: string;
}): Promise<void> {
  try {
    await database.insert(optimizationEvents).values({
      accountId: data.accountId,
      eventCategory: data.eventCategory,
      actionType: data.actionType,
      keywordId: data.keywordId,
      keywordText: data.keywordText,
      campaignId: data.campaignId,
      campaignName: data.campaignName,
      previousBid: data.previousBid,
      newBid: data.newBid,
      previousValue: data.previousValue,
      newValue: data.newValue,
      changeReason: data.changeReason,
      status: 'success',
      apiSyncStatus: 'synced',
      apiSyncedAt: new Date(),
      algorithmVersion: 'AutoCorrector_v167',
      createdAt: new Date(),
    });
  } catch (error: any) {
    console.warn(`[AutoCorrector] v177: 记录纠错事件失败: ${error.message}`);
  }
}

function createEmptyScanResult(reason: string): CorrectionScanResult {
  return {
    scanId: `scan_${reason}_${Date.now()}`,
    startedAt: new Date(),
    completedAt: new Date(),
    accountsScanned: 0,
    totalIssuesFound: 0,
    totalCorrected: 0,
    totalFailed: 0,
    details: {
      bidRetries: { found: 0, corrected: 0, failed: 0 },
      bidMismatches: { found: 0, corrected: 0, failed: 0 },
      budgetRetries: { found: 0, corrected: 0, failed: 0 },
      budgetMismatches: { found: 0, corrected: 0, failed: 0 },
      placementMismatches: { found: 0, corrected: 0, failed: 0 },
      rollbackExecutions: { found: 0, corrected: 0, failed: 0 },
      settingsRetries: { found: 0, corrected: 0, failed: 0 },
      maxBidViolations: { found: 0, corrected: 0, failed: 0 },
      orphanKeywordCleanups: { found: 0, corrected: 0, failed: 0 },
    },
    corrections: [],
  };
}

function buildScanResult(
  scanId: string,
  startedAt: Date,
  completedAt: Date,
  accountsScanned: number,
  corrections: CorrectionResult[]
): CorrectionScanResult {
  const details = {
    bidRetries: { found: 0, corrected: 0, failed: 0 },
    bidMismatches: { found: 0, corrected: 0, failed: 0 },
    budgetRetries: { found: 0, corrected: 0, failed: 0 },
    budgetMismatches: { found: 0, corrected: 0, failed: 0 },
    placementMismatches: { found: 0, corrected: 0, failed: 0 },
    rollbackExecutions: { found: 0, corrected: 0, failed: 0 },
    settingsRetries: { found: 0, corrected: 0, failed: 0 },
    keywordCreateRetries: { found: 0, corrected: 0, failed: 0 },
    maxBidViolations: { found: 0, corrected: 0, failed: 0 },
    orphanKeywordCleanups: { found: 0, corrected: 0, failed: 0 },
  };
  
  for (const c of corrections) {
    const key = c.type === 'bid_retry' ? 'bidRetries'
      : c.type === 'bid_mismatch' ? 'bidMismatches'
      : c.type === 'budget_retry' ? 'budgetRetries'
      : c.type === 'budget_mismatch' ? 'budgetMismatches'
      : c.type === 'placement_mismatch' ? 'placementMismatches'
      : c.type === 'rollback_execution' ? 'rollbackExecutions'
      : c.type === 'keyword_create_retry' ? 'keywordCreateRetries'
      : c.type === 'max_bid_violation' ? 'maxBidViolations'
      : c.type === 'orphan_keyword_cleanup' ? 'orphanKeywordCleanups'
      : 'settingsRetries';
    
    details[key].found++;
    if (c.success) details[key].corrected++;
    else details[key].failed++;
  }
  
  return {
    scanId,
    startedAt,
    completedAt,
    accountsScanned,
    totalIssuesFound: corrections.length,
    totalCorrected: corrections.filter(c => c.success).length,
    totalFailed: corrections.filter(c => !c.success).length,
    details,
    corrections,
  };
}

// ==================== 公开API ====================

/**
 * 获取扫描历史
 */
export function getScanHistory(): CorrectionScanResult[] {
  return [...scanHistory];
}

/**
 * 获取最近一次扫描结果
 */
export function getLastScanResult(): CorrectionScanResult | null {
  return scanHistory[0] || null;
}

/**
 * 获取当前扫描状态
 */
export function getScanStatus(): { isScanning: boolean; lastScanTime: Date | null; historyCount: number } {
  return { isScanning, lastScanTime, historyCount: scanHistory.length };
}

/**
 * 获取纠错配置
 */
export function getConfig(): typeof AUTO_CORRECTION_CONFIG {
  return { ...AUTO_CORRECTION_CONFIG };
}


// ==================== 10. v172: 纠正超出max_bid的关键词出价 ====================

async function correctMaxBidViolations(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // 查找当前出价超过优化目标max_bid的enabled关键词
    const violationQuery = sql`
      SELECT 
        k.id as keyword_id,
        k.keywordText as keyword_text,
        k.keywordId as amazon_keyword_id,
        CAST(k.bid AS DECIMAL(10,2)) as current_bid,
        pg.max_bid,
        pg.id as pg_id,
        pg.name as pg_name,
        c.id as campaign_id,
        c.campaignName as campaign_name
      FROM keywords k
      JOIN ad_groups ag ON k.adGroupId = ag.id
      JOIN campaigns c ON ag.campaignId = c.id
      JOIN performance_groups pg ON c.performanceGroupId = pg.id
      WHERE c.accountId = ${accountId}
        AND k.keywordStatus = 'enabled'
        AND pg.max_bid IS NOT NULL AND pg.max_bid > 0
        AND CAST(k.bid AS DECIMAL(10,2)) > pg.max_bid
      ORDER BY CAST(k.bid AS DECIMAL(10,2)) - pg.max_bid DESC
      LIMIT 100
    `;
    
    const violations = await database.execute(violationQuery);
    const rows = (violations as any)[0] || violations;
    
    if (!Array.isArray(rows) || rows.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${rows.length}个关键词出价超出max_bid`);
    
    // 批量修正：将出价回退到max_bid
    const correctionItems: any[] = [];
    for (const row of rows) {
      const maxBid = parseFloat(String(row.max_bid));
      if (row.amazon_keyword_id) {
        correctionItems.push({
          keywordId: row.keyword_id,
          newBid: maxBid,
          campaignId: row.campaign_id,
          reason: `[AutoCorrector v172] 出价$${row.current_bid}超出max_bid$${maxBid}，回退到max_bid`,
        });
      }
      
      // 无论是否有Amazon ID，都先更新本地数据库
      await database
        .update(keywords)
        .set({ bid: String(maxBid) })
        .where(eq(keywords.id, row.keyword_id));
      
      results.push({
        type: 'max_bid_violation',
        accountId,
        targetId: row.keyword_id,
        targetType: 'keyword',
        previousValue: String(row.current_bid),
        correctedValue: String(maxBid),
        reason: `出价$${row.current_bid}超出max_bid$${maxBid} (优化目标: ${row.pg_name})`,
        success: true,
      });
    }
    
    // 批量同步到Amazon
    if (correctionItems.length > 0) {
      try {
        const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(accountId, correctionItems);
        console.log(`[AutoCorrector] v177: 账户${accountId} max_bid纠正同步到Amazon: 成功${syncResult.success}, 失败${syncResult.failed}`);
      } catch (syncError: any) {
        console.error(`[AutoCorrector] v177: 账户${accountId} max_bid纠正同步失败: ${syncError.message}`);
      }
    }
    
    // 同样检查product_targets
    const ptViolationQuery = sql`
      SELECT 
        pt.id as target_id,
        pt.targetText as target_text,
        pt.targetId as amazon_target_id,
        CAST(pt.bid AS DECIMAL(10,2)) as current_bid,
        pg.max_bid,
        pg.id as pg_id,
        pg.name as pg_name,
        c.id as campaign_id
      FROM product_targets pt
      JOIN ad_groups ag ON pt.adGroupId = ag.id
      JOIN campaigns c ON ag.campaignId = c.id
      JOIN performance_groups pg ON c.performanceGroupId = pg.id
      WHERE c.accountId = ${accountId}
        AND pt.targetStatus = 'enabled'
        AND pg.max_bid IS NOT NULL AND pg.max_bid > 0
        AND CAST(pt.bid AS DECIMAL(10,2)) > pg.max_bid
      ORDER BY CAST(pt.bid AS DECIMAL(10,2)) - pg.max_bid DESC
      LIMIT 50
    `;
    
    const ptViolations = await database.execute(ptViolationQuery);
    const ptRows = (ptViolations as any)[0] || ptViolations;
    
    if (Array.isArray(ptRows) && ptRows.length > 0) {
      console.log(`[AutoCorrector] v177: 账户${accountId} 发现${ptRows.length}个商品定向出价超出max_bid`);
      for (const row of ptRows) {
        const maxBid = parseFloat(String(row.max_bid));
        await database
          .update(productTargets)
          .set({ bid: String(maxBid) })
          .where(eq(productTargets.id, row.target_id));
        
        results.push({
          type: 'max_bid_violation',
          accountId,
          targetId: row.target_id,
          targetType: 'product_target',
          previousValue: String(row.current_bid),
          correctedValue: String(maxBid),
          reason: `商品定向出价$${row.current_bid}超出max_bid$${maxBid} (优化目标: ${row.pg_name})`,
          success: true,
        });
      }
    }
    
    // 记录纠错事件
    if (results.length > 0) {
      await logCorrectionEvent(database, {
        accountId,
        eventCategory: 'auto_correction',
        actionType: 'auto_correction',
        changeReason: `[AutoCorrector v172] 纠正${results.length}个超出max_bid的出价`,
      });
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} correctMaxBidViolations失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 11. v172: 清理缺少Amazon ID的孤儿关键词 ====================

async function cleanupOrphanKeywords(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // 查找缺少Amazon ID且创建超过24小时的enabled关键词
    // 这些关键词无法同步到Amazon，应该标记为paused以避免干扰优化算法
    const orphanQuery = sql`
      SELECT 
        k.id as keyword_id,
        k.keywordText as keyword_text,
        k.bid,
        k.createdAt,
        c.id as campaign_id,
        c.campaignName as campaign_name,
        pg.name as pg_name
      FROM keywords k
      JOIN ad_groups ag ON k.adGroupId = ag.id
      JOIN campaigns c ON ag.campaignId = c.id
      LEFT JOIN performance_groups pg ON c.performanceGroupId = pg.id
      WHERE c.accountId = ${accountId}
        AND k.keywordStatus = 'enabled'
        AND k.keywordId IS NULL
        AND k.createdAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY k.createdAt ASC
      LIMIT 200
    `;
    
    const orphans = await database.execute(orphanQuery);
    const rows = (orphans as any)[0] || orphans;
    
    if (!Array.isArray(rows) || rows.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${rows.length}个缺少Amazon ID的孤儿关键词，标记为paused`);
    
    // 检查关键词文本是否包含特殊字符（导致Amazon API创建失败的根因）
    for (const row of rows) {
      const keywordText = String(row.keyword_text || '');
      const hasSpecialChars = /[\uFFFC\uFFFD\u0000-\u001F]/.test(keywordText) || keywordText.length > 200;
      
      // 标记为paused，避免干扰优化算法
      await database
        .update(keywords)
        .set({ keywordStatus: 'paused' })
        .where(eq(keywords.id, row.keyword_id));
      
      results.push({
        type: 'orphan_keyword_cleanup',
        accountId,
        targetId: row.keyword_id,
        targetType: 'keyword',
        previousValue: `enabled (no Amazon ID${hasSpecialChars ? ', has special chars' : ''})`,
        correctedValue: 'paused',
        reason: `孤儿关键词清理: "${keywordText.substring(0, 50)}..." 缺少Amazon ID${hasSpecialChars ? '，包含特殊字符' : ''} (优化目标: ${row.pg_name || 'N/A'})`,
        success: true,
      });
    }
    
    // 记录纠错事件
    if (results.length > 0) {
      await logCorrectionEvent(database, {
        accountId,
        eventCategory: 'auto_correction',
        actionType: 'auto_correction',
        changeReason: `[AutoCorrector v172] 清理${results.length}个缺少Amazon ID的孤儿关键词`,
      });
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} cleanupOrphanKeywords失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 12. v177: 重试历史失败的搜索词收割（关键词创建） ====================

/**
 * v177: 重试历史失败的keyword_create事件
 * 
 * 这些事件的特点:
 * - api_sync_status = 'not_applicable' (被旧版本标记为放弃)
 * - action_detail 中包含 'code=ERROR' (真正的API失败，而非永久失败)
 * - keyword_id 为 NULL (本地数据库中未创建记录)
 * - action_detail JSON 中有完整的 searchTerm, campaignId, matchType 等信息
 * 
 * 处理流程:
 * 1. 从 action_detail 中提取搜索词、campaign、matchType
 * 2. 查找对应的 adGroup 和 Amazon ID
 * 3. 检查关键词是否已存在于目标广告组（幂等性检查）
 * 4. 在本地 keywords 表创建记录
 * 5. 调用 Amazon API 创建关键词
 * 6. 成功后更新事件状态为 synced
 * 7. 永久失败则标记为 invalid_legacy
 * 
 * 每次扫描最多处理 20 个事件，避免 API 限流
 */
async function retryHistoricalFailedKeywordHarvests(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  const MAX_PER_RUN = 20; // 每次扫描最多处理的数量
  
  try {
    // 查找历史失败的 keyword_create 事件
    // 条件: not_applicable + action_detail包含code=ERROR + keyword_id为NULL
    const failedEvents = await database.execute(sql`
      SELECT id, account_id, campaign_id, campaign_name, keyword_id, keyword_text,
             action_detail, api_sync_status, api_sync_detail, created_at
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND action_type = 'keyword_create'
        AND api_sync_status = 'not_applicable'
        AND action_detail LIKE '%code=ERROR%'
        AND keyword_id IS NULL
      ORDER BY created_at DESC
      LIMIT ${MAX_PER_RUN}
    `);
    
    const events = (failedEvents as any)[0] || failedEvents;
    if (!events || events.length === 0) return results;
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 发现${events.length}条历史失败的搜索词收割需要重试`);
    
    // 按 campaign 分组，减少重复查询
    const byCampaign = new Map<number, Array<{ eventId: number; searchTerm: string; matchType: string; campaignName: string }>>();
    
    for (const event of events) {
      let detail: any = {};
      try {
        const raw = event.action_detail || event.actionDetail;
        if (raw) detail = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {}
      
      const searchTerm = detail.searchTerm || event.keyword_text || event.keywordText;
      const matchType = detail.matchType || 'phrase';
      const campaignId = event.campaign_id || event.campaignId;
      const campaignName = detail.campaignName || event.campaign_name || event.campaignName || '';
      const eventId = event.id;
      
      if (!searchTerm || !campaignId) {
        // 无法提取关键信息，标记为 invalid_legacy
        await database.execute(sql`
          UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
            api_sync_detail = ${JSON.stringify({ reason: 'v177: 无法提取searchTerm或campaignId', fixedAt: new Date().toISOString() })}
          WHERE id = ${eventId}
        `).catch(() => {});
        continue;
      }
      
      if (!byCampaign.has(campaignId)) byCampaign.set(campaignId, []);
      byCampaign.get(campaignId)!.push({ eventId, searchTerm, matchType, campaignName });
    }
    
    // 逐个 campaign 处理
    for (const [localCampaignId, kwEvents] of byCampaign) {
      try {
        // 获取 campaign 的 Amazon ID
        const campRows = await database
          .select({ campaignId: campaigns.campaignId, accountId: campaigns.accountId })
          .from(campaigns)
          .where(eq(campaigns.id, localCampaignId))
          .limit(1);
        
        if (campRows.length === 0) {
          // Campaign 不存在，标记所有事件为 invalid_legacy
          for (const kw of kwEvents) {
            await database.execute(sql`
              UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
                api_sync_detail = ${JSON.stringify({ reason: 'v177: campaign不存在', fixedAt: new Date().toISOString() })}
              WHERE id = ${kw.eventId}
            `).catch(() => {});
            results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'campaign', previousValue: '', correctedValue: kw.searchTerm, reason: `Campaign不存在，放弃重试: ${kw.searchTerm}`, success: false, errorMessage: 'campaign_not_found' });
          }
          continue;
        }
        
        const amazonCampaignId = Number(campRows[0].campaignId);
        
        // 获取第一个活跃的 adGroup
        const agRows = await database
          .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
          .from(adGroups)
          .where(and(
            eq(adGroups.campaignId, localCampaignId),
            eq(adGroups.adGroupStatus, 'enabled')
          ))
          .limit(1);
        
        if (agRows.length === 0) {
          for (const kw of kwEvents) {
            await database.execute(sql`
              UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
                api_sync_detail = ${JSON.stringify({ reason: 'v177: 无活跃adGroup', fixedAt: new Date().toISOString() })}
              WHERE id = ${kw.eventId}
            `).catch(() => {});
            results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'campaign', previousValue: '', correctedValue: kw.searchTerm, reason: `无活跃adGroup，放弃重试: ${kw.searchTerm}`, success: false, errorMessage: 'no_active_adgroup' });
          }
          continue;
        }
        
        const localAdGroupId = agRows[0].id;
        const amazonAdGroupId = Number(agRows[0].adGroupId);
        
        // 获取该 adGroup 中已有的关键词（用于幂等性去重）
        const existingKws = await database
          .select({ keywordText: keywords.keywordText, keywordId: keywords.keywordId, matchType: keywords.matchType })
          .from(keywords)
          .where(eq(keywords.adGroupId, localAdGroupId));
        
        const existingSet = new Set(existingKws.map((k: any) => k.keywordText?.toLowerCase()));
        
        // 过滤已存在的关键词
        const toCreate: typeof kwEvents = [];
        for (const kw of kwEvents) {
          if (existingSet.has(kw.searchTerm.toLowerCase())) {
            // 已存在，直接标记为 synced
            await database.execute(sql`
              UPDATE optimization_events SET api_sync_status = 'synced',
                api_sync_detail = ${JSON.stringify({ reason: 'v177: 关键词已存在于目标广告组', fixedAt: new Date().toISOString() })}
              WHERE id = ${kw.eventId}
            `).catch(() => {});
            results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'campaign', previousValue: '', correctedValue: kw.searchTerm, reason: `关键词已存在，标记为synced: ${kw.searchTerm}`, success: true });
          } else {
            toCreate.push(kw);
          }
        }
        
        if (toCreate.length === 0) continue;
        
        // 批量创建关键词
        console.log(`[AutoCorrector] v177: Campaign ${localCampaignId} 需要创建 ${toCreate.length} 个关键词`);
        
        // 先在本地 keywords 表创建记录
        const keywordsToSync: Array<{
          eventId: number;
          localKeywordId?: number;
          adGroupId: number;
          campaignId: number;
          keywordText: string;
          matchType: 'exact' | 'phrase' | 'broad';
          bid: number;
        }> = [];
        
        for (const kw of toCreate) {
          try {
            const normalizedMatchType = (kw.matchType === 'exact' || kw.matchType === 'phrase' || kw.matchType === 'broad') 
              ? kw.matchType as 'exact' | 'phrase' | 'broad'
              : 'phrase'; // 默认为 phrase
            
            // 在本地数据库创建关键词记录
            const insertResult = await database.execute(sql`
              INSERT INTO keywords (adGroupId, keywordText, matchType, bid, keywordStatus, createdAt, updatedAt)
              VALUES (${localAdGroupId}, ${kw.searchTerm}, ${normalizedMatchType}, '0.50', 'enabled', NOW(), NOW())
            `);
            const localKeywordId = (insertResult as any)[0]?.insertId || (insertResult as any)?.insertId;
            
            keywordsToSync.push({
              eventId: kw.eventId,
              localKeywordId,
              adGroupId: amazonAdGroupId,
              campaignId: amazonCampaignId,
              keywordText: kw.searchTerm,
              matchType: normalizedMatchType,
              bid: 0.50,
            });
          } catch (insertErr: any) {
            console.warn(`[AutoCorrector] v177: 本地创建关键词失败: "${kw.searchTerm}" - ${insertErr.message}`);
            // 可能是重复插入，标记为 invalid_legacy
            await database.execute(sql`
              UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
                api_sync_detail = ${JSON.stringify({ reason: `v177: 本地创建失败: ${insertErr.message}`, fixedAt: new Date().toISOString() })}
              WHERE id = ${kw.eventId}
            `).catch(() => {});
            results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'campaign', previousValue: '', correctedValue: kw.searchTerm, reason: `本地创建失败: ${kw.searchTerm}`, success: false, errorMessage: insertErr.message });
          }
        }
        
        if (keywordsToSync.length === 0) continue;
        
        // 调用 Amazon API 批量创建关键词
        const syncResult = await amazonApiHelper.syncNewKeywordsToAmazon(
          accountId,
          keywordsToSync.map(k => ({
            localKeywordId: k.localKeywordId,
            adGroupId: k.adGroupId,
            campaignId: k.campaignId,
            keywordText: k.keywordText,
            matchType: k.matchType,
            bid: k.bid,
          }))
        );
        
        // 根据结果更新每个事件的状态
        // syncResult.createdKeywords 包含成功创建的关键词
        const successKeywords = new Set(
          syncResult.createdKeywords.map((k: any) => k.keywordText?.toLowerCase())
        );
        
        // 从错误信息中提取失败的关键词
        const failedKeywordErrors = new Map<string, string>();
        for (const err of syncResult.errors) {
          // 错误格式: "关键词创建失败: \"keyword_text\" - code=XXX"
          const match = err.match(/关键词创建失败: "(.+?)"\s*-\s*code=(\S+)/);
          if (match) {
            failedKeywordErrors.set(match[1].toLowerCase(), match[2]);
          }
        }
        
        for (const kw of keywordsToSync) {
          const isSuccess = successKeywords.has(kw.keywordText.toLowerCase());
          const errorCode = failedKeywordErrors.get(kw.keywordText.toLowerCase());
          
          // 检查是否是永久性错误（DUPLICATE表示Amazon上已存在，也算成功）
          const isDuplicate = errorCode === 'DUPLICATE_VALUE' || errorCode === 'DUPLICATE';
          
          if (isSuccess || isDuplicate) {
            await database.execute(sql`
              UPDATE optimization_events SET api_sync_status = 'synced',
                api_sync_detail = ${JSON.stringify({ 
                  correctedBy: 'AutoCorrector-v177-harvest-retry',
                  fixedAt: new Date().toISOString(),
                  localKeywordId: kw.localKeywordId,
                  isDuplicate,
                })},
                api_synced_at = NOW()
              WHERE id = ${kw.eventId}
            `).catch(() => {});
            
            results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'keyword', previousValue: '', correctedValue: kw.keywordText, reason: isDuplicate ? `关键词Amazon已存在: ${kw.keywordText}` : `重试创建关键词成功: ${kw.keywordText}`, success: true });
            console.log(`[AutoCorrector] v177: ✅ 关键词创建成功: "${kw.keywordText}" (campaign=${localCampaignId}${isDuplicate ? ', 已存在' : ''})`);
          } else {
            // 失败 - 标记为 invalid_legacy（不再重试）
            await database.execute(sql`
              UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
                api_sync_detail = ${JSON.stringify({ 
                  reason: `v177: Amazon拒绝创建关键词`,
                  errorCode: errorCode || 'UNKNOWN',
                  fixedAt: new Date().toISOString(),
                  localKeywordId: kw.localKeywordId,
                })}
              WHERE id = ${kw.eventId}
            `).catch(() => {});
            
            // 删除本地创建的无效关键词记录
            if (kw.localKeywordId) {
              await database.execute(sql`
                DELETE FROM keywords WHERE id = ${kw.localKeywordId} AND keywordId IS NULL
              `).catch(() => {});
            }
            
            results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'keyword', previousValue: '', correctedValue: kw.keywordText, reason: `关键词Amazon拒绝创建: ${kw.keywordText} (code=${errorCode || 'UNKNOWN'})`, success: false, errorMessage: errorCode || syncResult.errors.join('; ') });
            console.log(`[AutoCorrector] v177: ❌ 关键词创建失败: "${kw.keywordText}" (code=${errorCode || 'UNKNOWN'})`);
          }
        }
        
        // 批次间延迟，避免触发限流
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (campError: any) {
        console.error(`[AutoCorrector] v177: Campaign ${localCampaignId} 关键词收割重试失败: ${campError.message}`);
        for (const kw of kwEvents) {
          results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'campaign', previousValue: '', correctedValue: kw.searchTerm, reason: `Campaign处理异常: ${kw.searchTerm}`, success: false, errorMessage: campError.message });
        }
      }
    }
    
    console.log(`[AutoCorrector] v177: 账户${accountId} 搜索词收割重试完成: 成功=${results.filter(r => r.success).length}, 失败=${results.filter(r => !r.success).length}`);
    
  } catch (error: any) {
    console.error(`[AutoCorrector] v177: 账户${accountId} retryHistoricalFailedKeywordHarvests失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 定时纠错调度 ====================
let correctionInterval: ReturnType<typeof setInterval> | null = null;

/**
 * 启动自动纠错定时服务（每4小时运行一次）
 */
export function startAutoCorrector(): void {
  if (correctionInterval) {
    console.log('[AutoCorrector] 定时纠错服务已在运行中');
    return;
  }
  const intervalMs = (AUTO_CORRECTION_CONFIG as any).scanIntervalHours 
    ? (AUTO_CORRECTION_CONFIG as any).scanIntervalHours * 60 * 60 * 1000 
    : 4 * 60 * 60 * 1000;
  correctionInterval = setInterval(async () => {
    try {
      console.log('[AutoCorrector] 定时纠错扫描开始...');
      const result = await runAutoCorrection();
      console.log(`[AutoCorrector] 定时纠错扫描完成: 发现${result.totalIssuesFound}个问题, 纠正${result.totalCorrected}个, 失败${result.totalFailed}个`);
    } catch (err: any) {
      console.error('[AutoCorrector] 定时纠错扫描失败:', err.message);
    }
  }, intervalMs);
  console.log(`[AutoCorrector] 定时纠错服务已启动，每${(AUTO_CORRECTION_CONFIG as any).scanIntervalHours || 4}小时运行一次`);
}

/**
 * 停止自动纠错定时服务
 */
export function stopAutoCorrector(): void {
  if (correctionInterval) {
    clearInterval(correctionInterval);
    correctionInterval = null;
    console.log('[AutoCorrector] 定时纠错服务已停止');
  }
}
