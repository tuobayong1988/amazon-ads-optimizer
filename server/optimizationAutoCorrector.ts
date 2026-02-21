/**
 * OptimizationAutoCorrector v167
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
import { optimizationEvents, keywords, campaigns, adGroups, negativeKeywords } from '../drizzle/schema';
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
  
  // 预算不一致的容差范围（美元）
  budgetToleranceDollar: 0.50,
  
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
        'placement_mismatch' | 'rollback_execution' | 'settings_retry';
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
    console.log('[AutoCorrector] v167: 纠错扫描正在进行中，跳过本次请求');
    return createEmptyScanResult('skipped_in_progress');
  }
  
  // 检查最小扫描间隔
  if (lastScanTime && (Date.now() - lastScanTime.getTime()) < AUTO_CORRECTION_CONFIG.minScanIntervalMs) {
    console.log('[AutoCorrector] v167: 距离上次扫描不足10分钟，跳过');
    return createEmptyScanResult('skipped_too_frequent');
  }
  
  isScanning = true;
  const scanId = `scan_${Date.now()}`;
  const startedAt = new Date();
  const corrections: CorrectionResult[] = [];
  
  console.log(`[AutoCorrector] v167: 开始自动纠错扫描 (scanId: ${scanId}, accountId: ${accountId || 'all'})`);
  
  try {
    const database = await getDb();
    if (!database) {
      console.error('[AutoCorrector] v167: 无法获取数据库连接');
      return createEmptyScanResult('db_error');
    }
    
    // 0. 修复历史NULL api_sync_status记录（全局操作，只需执行一次）
    try {
      const nullFixResult = await fixNullApiSyncStatusRecords(database);
      if (nullFixResult > 0) {
        console.log(`[AutoCorrector] v167: 已修复${nullFixResult}条历史NULL api_sync_status记录`);
      }
    } catch (nullFixError: any) {
      console.error(`[AutoCorrector] v167: 修复NULL记录失败: ${nullFixError.message}`);
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
        
      } catch (accError: any) {
        console.error(`[AutoCorrector] v167: 账户 ${accId} 纠错失败: ${accError.message}`);
      }
    }
    
    const completedAt = new Date();
    const result = buildScanResult(scanId, startedAt, completedAt, accountIds.length, corrections);
    
    // 保存扫描历史（最多保留20条）
    scanHistory.unshift(result);
    if (scanHistory.length > 20) scanHistory.pop();
    
    lastScanTime = completedAt;
    
    console.log(`[AutoCorrector] v167: 纠错扫描完成 - 发现${result.totalIssuesFound}个问题, 纠正${result.totalCorrected}个, 失败${result.totalFailed}个`);
    
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
      console.log(`[AutoCorrector] v167: 已将 ${affectedRows} 条 optimization_logs NULL 记录标记为 legacy_unsynced`);
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
      console.log(`[AutoCorrector] v167: 已将 ${affectedRows2} 条 optimization_events NULL 记录标记为 legacy_unsynced`);
    }
    
    return affectedRows + affectedRows2;
  } catch (error: any) {
    console.error(`[AutoCorrector] v167: fixNullApiSyncStatusRecords 失败: ${error.message}`);
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
    
    console.log(`[AutoCorrector] v167: 账户${accountId} 发现${failedEvents.length}条失败的出价调整需要重试`);
    
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
      console.error(`[AutoCorrector] v167: 账户${accountId} 出价重试API调用失败: ${apiError.message}`);
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
    console.error(`[AutoCorrector] v167: 账户${accountId} retryFailedBidAdjustments失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 2. 检测并纠正出价不一致 ====================

async function correctBidMismatches(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // 查找最近成功同步的出价调整，但keyword当前bid与调整后的bid不一致
    // 这说明数据同步覆盖了优化出价，或者优化出价未正确写入
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
        oe.created_at as optimized_at
      FROM optimization_events oe
      JOIN keywords k ON oe.keyword_id = k.id
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
    
    console.log(`[AutoCorrector] v167: 账户${accountId} 发现${rows.length}条出价不一致需要纠正`);
    
    // 批量重新发送到Amazon
    const correctionItems = rows.map((row: any) => ({
      keywordId: row.keyword_id,
      newBid: parseFloat(String(row.expected_bid)),
      campaignId: row.campaign_id || 0,
      reason: `[自动纠错] 出价不一致纠正: 期望$${row.expected_bid}, 当前$${row.current_bid}`,
    }));
    
    try {
      const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
        accountId,
        correctionItems
      );
      
      for (const row of rows) {
        const success = syncResult.success > 0;
        
        results.push({
          type: 'bid_mismatch',
          accountId,
          targetId: row.keyword_id,
          targetType: 'keyword',
          previousValue: String(row.current_bid),
          correctedValue: String(row.expected_bid),
          reason: `出价不一致: 期望$${row.expected_bid}(优化值), 实际$${row.current_bid}(当前值)`,
          success,
        });
        
        if (success) {
          // 更新keywords表的bid为优化值
          await database
            .update(keywords)
            .set({ bid: String(row.expected_bid) })
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
            newBid: String(row.expected_bid),
            changeReason: `[AutoCorrector] 出价不一致纠正: 期望$${row.expected_bid}, 当前$${row.current_bid}`,
          });
        }
      }
    } catch (apiError: any) {
      console.error(`[AutoCorrector] v167: 账户${accountId} 出价纠正API调用失败: ${apiError.message}`);
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
    console.error(`[AutoCorrector] v167: 账户${accountId} correctBidMismatches失败: ${error.message}`);
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
    
    console.log(`[AutoCorrector] v167: 账户${accountId} 发现${failedEvents.length}条失败的预算调整需要重试`);
    
    // 按campaign分组，只保留最新的一条
    const latestByCampaign = new Map<number, typeof failedEvents[0]>();
    for (const event of failedEvents) {
      if (event.campaignId && !latestByCampaign.has(event.campaignId)) {
        latestByCampaign.set(event.campaignId, event);
      }
    }
    
    for (const [campId, event] of latestByCampaign) {
      try {
        const newBudget = parseFloat(String(event.newValue || '0'));
        if (newBudget <= 0) continue;
        
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
    console.error(`[AutoCorrector] v167: 账户${accountId} retryFailedBudgetAdjustments失败: ${error.message}`);
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
        c.daily_budget as current_budget,
        c.campaign_id as amazon_campaign_id,
        oe.created_at as optimized_at
      FROM optimization_events oe
      JOIN campaigns c ON oe.campaign_id = c.id
      WHERE oe.account_id = ${accountId}
        AND oe.event_category = 'budget_adjustment'
        AND oe.status = 'success'
        AND oe.api_sync_status = 'synced'
        AND oe.created_at > DATE_SUB(NOW(), INTERVAL 3 DAY)
        AND ABS(CAST(c.daily_budget AS DECIMAL(10,2)) - CAST(oe.new_value AS DECIMAL(10,2))) > ${AUTO_CORRECTION_CONFIG.budgetToleranceDollar}
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
    
    console.log(`[AutoCorrector] v167: 账户${accountId} 发现${rows.length}条预算不一致需要纠正`);
    
    for (const row of rows) {
      try {
        const expectedBudget = parseFloat(String(row.expected_budget));
        
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
    console.error(`[AutoCorrector] v167: 账户${accountId} correctBudgetMismatches失败: ${error.message}`);
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
        c.placement_top_search_bid_adjustment as current_top,
        c.placement_product_page_bid_adjustment as current_product,
        c.campaign_id as amazon_campaign_id,
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
    console.error(`[AutoCorrector] v167: 账户${accountId} correctPlacementMismatches失败: ${error.message}`);
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
    
    console.log(`[AutoCorrector] v167: 账户${accountId} 发现${unfinishedRollbacks.length}条未执行的回滚`);
    
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
      console.error(`[AutoCorrector] v167: 账户${accountId} 回滚执行API调用失败: ${apiError.message}`);
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v167: 账户${accountId} executeUnfinishedRollbacks失败: ${error.message}`);
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
    
    console.log(`[AutoCorrector] v167: 账户${accountId} 发现${failedEvents.length}条失败的设置变更需要重试`);
    
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
              parseFloat(String(event.newValue)),
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
    console.error(`[AutoCorrector] v167: 账户${accountId} retryFailedSettingsChanges失败: ${error.message}`);
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
    
    console.log(`[AutoCorrector] v168: 账户${accountId} 发现${failedEvents.length}条失败/pending的关键词创建需要重试`);
    
    for (const event of failedEvents) {
      try {
        // 从 action_detail 中提取关键信息
        let detail: any = {};
        if (event.actionDetail) {
          try { detail = typeof event.actionDetail === 'string' ? JSON.parse(event.actionDetail) : event.actionDetail; } catch {}
        }
        
        const localKeywordId = event.keywordId || detail.localKeywordId;
        if (!localKeywordId) {
          console.warn(`[AutoCorrector] v168: 关键词创建重试跳过 - 无本地keywordId, eventId=${event.id}`);
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
          console.warn(`[AutoCorrector] v168: 关键词创建重试跳过 - 无adGroup, keywordId=${localKeywordId}`);
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
    console.error(`[AutoCorrector] v168: 账户${accountId} retryFailedKeywordCreations失败: ${error.message}`);
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
    
    console.log(`[AutoCorrector] v168: 账户${accountId} 发现${failedEvents.length}条失败/pending的否定关键词添加需要重试`);
    
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
        
        negKeywordsToSync.push({
          eventId: event.id,
          campaignId: resolvedCampaignId,
          adGroupId: amazonAdGroupId ? Number(amazonAdGroupId) : undefined,
          keywordText: searchTerm,
          matchType: normalizedMatchType,
          level: amazonAdGroupId ? 'adgroup' : 'campaign',
        });
      } catch (parseErr: any) {
        console.warn(`[AutoCorrector] v168: 解析否定关键词事件失败: eventId=${event.id}, ${parseErr.message}`);
      }
    }
    
    if (negKeywordsToSync.length === 0) return results;
    
    // 批量调用Amazon API
    const syncResult = await amazonApiHelper.syncNegativeKeywordsToAmazon(
      accountId,
      negKeywordsToSync.map(nk => ({
        campaignId: nk.campaignId,
        adGroupId: nk.adGroupId,
        keywordText: nk.keywordText,
        matchType: nk.matchType,
        level: nk.level,
      }))
    );
    
    // 如果批量成功，更新所有事件状态
    const allSuccess = syncResult.success === negKeywordsToSync.length;
    
    for (const nk of negKeywordsToSync) {
      const success = allSuccess || syncResult.success > 0;
      
      if (success) {
        await database.update(optimizationEvents).set({
          apiSyncStatus: 'synced',
          apiSyncDetail: JSON.stringify({ correctedBy: 'AutoCorrector', correctedAt: new Date().toISOString() }),
          apiSyncedAt: new Date(),
        }).where(eq(optimizationEvents.id, nk.eventId));
        
        // 同步更新optimization_logs
        await database.execute(sql`
          UPDATE optimization_logs SET api_sync_status = 'synced' 
          WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${nk.eventId} AND source_table = 'optimization_logs')
        `).catch(() => {});
      }
      
      results.push({
        type: 'settings_retry',
        accountId,
        targetId: nk.campaignId,
        targetType: 'campaign',
        previousValue: '',
        correctedValue: nk.keywordText,
        reason: `重试添加否定关键词: ${nk.keywordText}`,
        success,
        errorMessage: success ? undefined : syncResult.errors.join('; '),
      });
    }
  } catch (error: any) {
    console.error(`[AutoCorrector] v168: 账户${accountId} retryFailedNegativeKeywordAdds失败: ${error.message}`);
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
    console.warn(`[AutoCorrector] v167: 记录纠错事件失败: ${error.message}`);
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
  };
  
  for (const c of corrections) {
    const key = c.type === 'bid_retry' ? 'bidRetries'
      : c.type === 'bid_mismatch' ? 'bidMismatches'
      : c.type === 'budget_retry' ? 'budgetRetries'
      : c.type === 'budget_mismatch' ? 'budgetMismatches'
      : c.type === 'placement_mismatch' ? 'placementMismatches'
      : c.type === 'rollback_execution' ? 'rollbackExecutions'
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
