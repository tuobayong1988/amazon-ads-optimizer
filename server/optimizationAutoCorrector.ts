/**
 * OptimizationAutoCorrector v198
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
 * 7. v178: 搜索词收割重试 — 从action_detail中提取失败的keyword_create事件信息，重新创建关键词
 * 8. v198: NextGen算法决策质量审计 — 检测旧算法遗留的不合理出价并用NextGen纠正
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
import { sanitizeAndValidateKeyword } from './utils/keywordValidator';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('AutoCorrector');

// ==================== 配置 ====================

const AUTO_CORRECTION_CONFIG = {
  // v199: 大幅提高每次纠错扫描的处理量，确保商用级数据完整性
  maxBidCorrectionsPerRun: 500,
  maxBudgetCorrectionsPerRun: 200,
  maxPlacementCorrectionsPerRun: 200,
  maxRetryPerRun: 2000,
  maxRollbackPerRun: 200,
  
  // API同步失败重试的最大次数
  maxRetryAttempts: 3,
  
  // 认为优化事件“过期”的天数（超过此天数不再重试）
  retryExpiryDays: 7,
  
  // v204: 出价容差基准值（USD）— 实际容差会根据账户货币动态计算
  bidToleranceBaseUSD: 0.01,
  
  // v204: 预算容差基准值（USD）— 实际容差会根据账户货币动态计算
  budgetToleranceBaseUSD: 2.00,
  
  // 位置倾斜不一致的容差范围（百分比）
  placementTolerancePercent: 1,
  
  // 两次纠错扫描之间的最小间隔（毫秒）
  minScanIntervalMs: 10 * 60 * 1000, // 10分钟
  
  // 定时扫描间隔（小时）
  scanIntervalHours: 1,
};

// ==================== v204: 货币转换系统 ====================

/**
 * v204: 货币汇率映射表（相对于USD的近似汇率）
 * 
 * 用于计算不同货币的容差阈值。
 * 例如: CAD 1.37 表示 1 USD ≈ 1.37 CAD，
 * 因此 USD $0.01 的容差对应 CAD $0.014 的容差。
 * 
 * 汇率不需要实时精确，只需要大致正确以避免容差误判。
 * 建议每季度更新一次。
 */
const CURRENCY_TO_USD_RATE: Record<string, number> = {
  'USD': 1.00,     // 美元
  'CAD': 1.37,     // 加拿大元
  'GBP': 0.79,     // 英鎊
  'EUR': 0.92,     // 欧元
  'JPY': 150.0,    // 日元
  'AUD': 1.55,     // 澳元
  'MXN': 17.2,     // 墨西哥比索
  'BRL': 4.95,     // 巴西雷亚尔
  'INR': 83.0,     // 印度卢比
  'SGD': 1.34,     // 新加坡元
  'AED': 3.67,     // 阿联酋迪拉姆
  'SAR': 3.75,     // 沙特里亚尔
  'SEK': 10.5,     // 瑞典克朗
  'PLN': 4.05,     // 波兰兹罗提
  'EGP': 30.9,     // 埃及鎊
  'TRY': 27.0,     // 土耳其里拉
};

/** v204: 账户货币缓存，避免每次纠错都查询数据库 */
const accountCurrencyCache = new Map<number, { currencyCode: string; fetchedAt: number }>();
const CURRENCY_CACHE_TTL_MS = 60 * 60 * 1000; // 1小时缓存

/**
 * v204: 获取账户的货币代码
 * 优先从缓存获取，缓存过期后从数据库查询
 */
async function getAccountCurrencyCode(accountId: number): Promise<string> {
  const cached = accountCurrencyCache.get(accountId);
  if (cached && (Date.now() - cached.fetchedAt) < CURRENCY_CACHE_TTL_MS) {
    return cached.currencyCode;
  }
  
  try {
    const creds = await db.getAmazonApiCredentials(accountId);
    const currencyCode = creds?.currencyCode || 'USD';
    accountCurrencyCache.set(accountId, { currencyCode, fetchedAt: Date.now() });
    return currencyCode;
  } catch (err: any) {
    log.warn(`v204: 获取账户${accountId}货币代码失败: ${err.message}，默认使用USD`);
    return 'USD';
  }
}

/**
 * v204: 根据货币类型计算出价容差
 * 将USD基准容差按汇率转换为目标货币的容差
 */
function getBidTolerance(currencyCode: string): number {
  const rate = CURRENCY_TO_USD_RATE[currencyCode] || 1.0;
  return Math.max(0.01, AUTO_CORRECTION_CONFIG.bidToleranceBaseUSD * rate);
}

/**
 * v204: 根据货币类型计算预算容差
 * 将USD基准容差按汇率转换为目标货币的容差
 */
function getBudgetTolerance(currencyCode: string): number {
  const rate = CURRENCY_TO_USD_RATE[currencyCode] || 1.0;
  return Math.max(1.0, AUTO_CORRECTION_CONFIG.budgetToleranceBaseUSD * rate);
}

/**
 * v204: 根据货币类型计算出价执行确认的比例容差
 * 对于非USD货币，使用更宽松的绝对容差和更严格的比例容差
 * 因为非USD货币的差异主要来自汇率波动，而非真正的执行失败
 */
function getBidVerifyTolerance(currencyCode: string): { absTolerance: number; relTolerance: number } {
  if (currencyCode === 'USD') {
    return { absTolerance: 0.02, relTolerance: 0.05 }; // USD: $0.02或5%
  }
  // 非USD货币: 汇率波动可能导致较大的绝对差异，使用更宽松的绝对容差
  const rate = CURRENCY_TO_USD_RATE[currencyCode] || 1.0;
  return {
    absTolerance: Math.max(0.02, 0.02 * rate), // 按汇率缩放绝对容差
    relTolerance: 0.10, // 非USD货币允许10%的比例差异（汇率波动）
  };
}

// ==================== 纠错结果类型 ====================

export interface CorrectionResult {
  type: 'bid_retry' | 'bid_mismatch' | 'budget_retry' | 'budget_mismatch' | 
        'placement_mismatch' | 'rollback_execution' | 'settings_retry' | 'max_bid_violation' | 
        'orphan_keyword_cleanup' | 'keyword_create_retry' | 'bid_execution_verify' | 'nextgen_quality_audit' | 'status_change_retry';
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
    nextgenQualityAudits: { found: number; corrected: number; failed: number };
    statusChangeRetries: { found: number; corrected: number; failed: number };
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
    log.info('v178: 纠错扫描正在进行中，跳过本次请求');
    return createEmptyScanResult('skipped_in_progress');
  }
  
  // 检查最小扫描间隔
  if (lastScanTime && (Date.now() - lastScanTime.getTime()) < AUTO_CORRECTION_CONFIG.minScanIntervalMs) {
    log.info('v178: 距离上次扫描不足10分钟，跳过');
    return createEmptyScanResult('skipped_too_frequent');
  }
  
  isScanning = true;
  const scanId = `scan_${Date.now()}`;
  const startedAt = new Date();
  const corrections: CorrectionResult[] = [];
  
  log.info(`v178: 开始自动纠错扫描 (scanId: ${scanId}, accountId: ${accountId || 'all'})`);
  
  try {
    const database = await getDb();
    if (!database) {
      log.error('v178: 无法获取数据库连接');
      return createEmptyScanResult('db_error');
    }
    
    // 0. 修复历史NULL api_sync_status记录（全局操作，只需执行一次）
    try {
      const nullFixResult = await fixNullApiSyncStatusRecords(database);
      if (nullFixResult > 0) {
        log.info(`v178: 已修复${nullFixResult}条历史NULL api_sync_status记录`);
      }
    } catch (nullFixError: any) {
      log.error(`v178: 修复NULL记录失败: ${nullFixError.message}`);
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
        
        // 12. v178: 重试历史失败的搜索词收割（从action_detail中提取信息重新创建关键词）
        const harvestRetries = await retryHistoricalFailedKeywordHarvests(database, accId);
        corrections.push(...harvestRetries);
        
        // 13. v190: 恢复permanently_failed的optimization_tasks队列任务
        const taskRescues = await rescuePermanentlyFailedTasks(accId);
        corrections.push(...taskRescues);
        
        // 14. v196: 回填缺少amazon_negative_keyword_id的否定词
        const negIdBackfills = await backfillNegativeKeywordIds(database, accId);
        corrections.push(...negIdBackfills);
        
        // 15. v196: 基于bidding_logs的出价执行确认 — 验证Amazon是否真正执行了出价调整
        const bidConfirmations = await verifyBiddingLogsExecution(database, accId);
        corrections.push(...bidConfirmations);
        
        // 16. v198: NextGen算法决策质量审计 — 检测旧算法遗留的不合理出价并用NextGen纠正
        const qualityAudits = await auditAlgorithmDecisionQuality(database, accId);
        corrections.push(...qualityAudits);
        
        // 17. v202: 重试失败的关键词/投放目标状态变更(target_enable/target_pause)
        const statusRetries = await retryFailedTargetStatusChanges(database, accId);
        corrections.push(...statusRetries);
        
      } catch (accError: any) {
        log.error(`v178: 账户 ${accId} 纠错失败: ${accError.message}`);
      }
    }
    
    const completedAt = new Date();
    const result = buildScanResult(scanId, startedAt, completedAt, accountIds.length, corrections);
    
    // 保存扫描历史（最多保留20条）
    scanHistory.unshift(result);
    if (scanHistory.length > 20) scanHistory.pop();
    
    lastScanTime = completedAt;
    
    log.info(`v204: 纠错扫描完成 - 发现${result.totalIssuesFound}个问题, 纠正${result.totalCorrected}个, 失败${result.totalFailed}个`);
    
    // v204: 同步健康度评估和告警
    await evaluateSyncHealth(database, result);
    
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
    // v199: 循环处理，确保所有NULL记录都被修复，而不是只处理前500条
    let totalAffected = 0;
    const BATCH_SIZE = 2000;
    
    // 处理 optimization_logs 表
    let batchAffected = 0;
    do {
      const updateResult = await database.execute(sql`
        UPDATE optimization_logs 
        SET api_sync_status = 'legacy_unsynced'
        WHERE api_sync_status IS NULL
        LIMIT ${BATCH_SIZE}
      `);
      batchAffected = (updateResult as any)?.[0]?.affectedRows || (updateResult as any)?.affectedRows || 0;
      totalAffected += batchAffected;
      if (batchAffected > 0) {
        log.info(`v199: 本批修复 ${batchAffected} 条 optimization_logs NULL 记录, 累计: ${totalAffected}`);
      }
    } while (batchAffected >= BATCH_SIZE);
    
    // 处理 optimization_events 表
    let batchAffected2 = 0;
    do {
      const updateResult2 = await database.execute(sql`
        UPDATE optimization_events 
        SET api_sync_status = 'legacy_unsynced'
        WHERE api_sync_status IS NULL
        LIMIT ${BATCH_SIZE}
      `);
      batchAffected2 = (updateResult2 as any)?.[0]?.affectedRows || (updateResult2 as any)?.affectedRows || 0;
      totalAffected += batchAffected2;
      if (batchAffected2 > 0) {
        log.info(`v199: 本批修复 ${batchAffected2} 条 optimization_events NULL 记录, 累计: ${totalAffected}`);
      }
    } while (batchAffected2 >= BATCH_SIZE);
    
    if (totalAffected > 0) {
      log.info(`v199: fixNullApiSyncStatusRecords 完成, 总计修复 ${totalAffected} 条记录`);
    }
    
    return totalAffected;
  } catch (error: any) {
    log.error(`v199: fixNullApiSyncStatusRecords 失败: ${error.message}`);
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
    
    log.info(`v178: 账户${accountId} 发现${failedEvents.length}条失败的出价调整需要重试`);
    
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
      log.error(`v178: 账户${accountId} 出价重试API调用失败: ${apiError.message}`);
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
    log.error(`v178: 账户${accountId} retryFailedBidAdjustments失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 2. 检测并纠正出价不一致 ====================

async function correctBidMismatches(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // v204: 获取账户货币并计算动态容差
    const currencyCode = await getAccountCurrencyCode(accountId);
    const bidTolerance = getBidTolerance(currencyCode);
    
    // v178: 查找最近成功同步的出价调整，但keyword当前bid与调整后的bid不一致
    // v178: 排除AutoCorrector自身产生的纠正事件（避免纠正循环）
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
        AND k.keywordId IS NOT NULL
        AND (oe.change_reason IS NULL OR oe.change_reason NOT LIKE '%AutoCorrector%')
        AND ABS(CAST(k.bid AS DECIMAL(10,2)) - CAST(oe.new_bid AS DECIMAL(10,2))) > ${bidTolerance}
        AND oe.id = (
          SELECT MAX(oe2.id) FROM optimization_events oe2 
          WHERE oe2.keyword_id = oe.keyword_id 
            AND oe2.event_category = 'bid_adjustment'
            AND oe2.status = 'success'
            AND oe2.api_sync_status = 'synced'
            AND (oe2.change_reason IS NULL OR oe2.change_reason NOT LIKE '%AutoCorrector%')
        )
      ORDER BY oe.created_at DESC
      LIMIT ${AUTO_CORRECTION_CONFIG.maxBidCorrectionsPerRun}
    `;
    
    const mismatches = await database.execute(mismatchQuery);
    const rows = (mismatches as any)[0] || mismatches;
    
    if (!Array.isArray(rows) || rows.length === 0) return results;
    
    log.info(`v204: 账户${accountId} (${currencyCode}) 发现${rows.length}条出价不一致需要纠正 (bidTolerance=${bidTolerance.toFixed(3)})`);
    
    // v172: 批量重新发送到Amazon - 但确保纠正值不超过max_bid红线
    const correctionItems = rows.map((row: any) => {
      let targetBid = parseFloat(String(row.expected_bid));
      const maxBid = row.max_bid ? parseFloat(String(row.max_bid)) : 0;
      
      // v172 关键修复: 如果期望出价超过max_bid，使用max_bid作为纠正值
      if (maxBid > 0 && targetBid > maxBid) {
        log.info(`v178: 出价纠正受max_bid限制: keyword=${row.keyword_id} expected=$${targetBid} -> max_bid=$${maxBid}`);
        targetBid = maxBid;
      }
      
      // v204: 使用动态货币容差检查
      const currentBid = parseFloat(String(row.current_bid));
      if (Math.abs(targetBid - currentBid) <= bidTolerance) {
        log.info(`v204: 跳过纠正(差异在${currencyCode}容差${bidTolerance.toFixed(3)}内): keyword=${row.keyword_id} target=$${targetBid} current=$${currentBid}`);
        return null;
      }
      
      return {
        keywordId: row.keyword_id,
        newBid: targetBid,
        campaignId: row.campaign_id || 0,
        reason: `[自动纠错] 出价不一致纠正: 期望$${targetBid.toFixed(2)}, 当前$${row.current_bid}${maxBid > 0 ? ` (max_bid=$${maxBid})` : ''}`,
      };
    }).filter((item: any): item is NonNullable<typeof item> => item !== null);
    
    if (correctionItems.length === 0) {
      log.info(`v178: 所有出价纠正项在max_bid限制后已无需纠正`);
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
      log.error(`v178: 账户${accountId} 出价纠正API调用失败: ${apiError.message}`);
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
    log.error(`v178: 账户${accountId} correctBidMismatches失败: ${error.message}`);
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
    
    log.warn(`v178: 账户${accountId} 发现${failedEvents.length}条失败的预算调整需要重试`);
    
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
    log.error(`v178: 账户${accountId} retryFailedBudgetAdjustments失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 4. 检测并纠正预算不一致 ====================

async function correctBudgetMismatches(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // v204: 获取账户货币并计算动态容差
    const currencyCode = await getAccountCurrencyCode(accountId);
    const budgetTolerance = getBudgetTolerance(currencyCode);
    
    // v178: 排除启用分时预算的campaigns（分时系统自行管理预算，AutoCorrector不应干预）
    // v178: 排除AutoCorrector自身产生的纠正事件（避免纠正循环）
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
      LEFT JOIN performance_groups pg ON c.performanceGroupId = pg.id
      WHERE oe.account_id = ${accountId}
        AND oe.event_category = 'budget_adjustment'
        AND oe.status = 'success'
        AND oe.api_sync_status = 'synced'
        AND oe.created_at > DATE_SUB(NOW(), INTERVAL 3 DAY)
        AND (oe.change_reason IS NULL OR oe.change_reason NOT LIKE '%AutoCorrector%')
        AND (pg.daypartingEnabled IS NULL OR pg.daypartingEnabled = 0)
        AND ABS(CAST(c.dailyBudget AS DECIMAL(10,2)) - CAST(REPLACE(REPLACE(oe.new_value, '$', ''), ',', '') AS DECIMAL(10,2))) > ${budgetTolerance}
        AND oe.id = (
          SELECT MAX(oe2.id) FROM optimization_events oe2 
          WHERE oe2.campaign_id = oe.campaign_id 
            AND oe2.event_category = 'budget_adjustment'
            AND oe2.status = 'success'
            AND oe2.api_sync_status = 'synced'
            AND (oe2.change_reason IS NULL OR oe2.change_reason NOT LIKE '%AutoCorrector%')
        )
      ORDER BY oe.created_at DESC
      LIMIT ${AUTO_CORRECTION_CONFIG.maxBudgetCorrectionsPerRun}
    `;
    
    const mismatches = await database.execute(mismatchQuery);
    const rows = (mismatches as any)[0] || mismatches;
    
    if (!Array.isArray(rows) || rows.length === 0) return results;
    
    log.info(`v204: 账户${accountId} (${currencyCode}) 发现${rows.length}条预算不一致需要纠正 (budgetTolerance=${budgetTolerance.toFixed(2)})`);
    
    for (const row of rows) {
      try {
        // v175: 移除$符号后解析预算值，并取整（Amazon API只接受整数预算）
        const rawExpected = String(row.expected_budget || '0').replace(/[^0-9.\-]/g, '');
        const expectedBudget = Math.round(parseFloat(rawExpected));
        if (isNaN(expectedBudget) || expectedBudget <= 0) {
          log.warn(`v175: 跳过无效预算值: campaign=${row.campaign_id}, raw=${row.expected_budget}`);
          continue;
        }
        
        // v204: 使用动态货币容差检查
        const currentBudgetNum = parseFloat(String(row.current_budget || '0').replace(/[^0-9.\-]/g, ''));
        if (!isNaN(currentBudgetNum) && Math.abs(expectedBudget - currentBudgetNum) <= budgetTolerance) {
          log.debug(`v204: 取整后预算差异在${currencyCode}容差${budgetTolerance.toFixed(2)}内: campaign=${row.campaign_id}, expected=$${expectedBudget}, current=$${currentBudgetNum}`);
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
    log.error(`v178: 账户${accountId} correctBudgetMismatches失败: ${error.message}`);
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
    log.error(`v178: 账户${accountId} correctPlacementMismatches失败: ${error.message}`);
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
    
    log.info(`v178: 账户${accountId} 发现${unfinishedRollbacks.length}条未执行的回滚`);
    
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
      log.error(`v178: 账户${accountId} 回滚执行API调用失败: ${apiError.message}`);
    }
  } catch (error: any) {
    log.error(`v178: 账户${accountId} executeUnfinishedRollbacks失败: ${error.message}`);
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
    
    log.warn(`v178: 账户${accountId} 发现${failedEvents.length}条失败的设置变更需要重试`);
    
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
    log.error(`v178: 账户${accountId} retryFailedSettingsChanges失败: ${error.message}`);
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
    
    log.warn(`v178: 账户${accountId} 发现${failedEvents.length}条失败/pending的关键词创建需要重试`);
    
    for (const event of failedEvents) {
      try {
        // 从 action_detail 中提取关键信息
        let detail: any = {};
        if (event.actionDetail) {
          try { detail = typeof event.actionDetail === 'string' ? JSON.parse(event.actionDetail) : event.actionDetail; } catch {}
        }
        
        const localKeywordId = event.keywordId || detail.localKeywordId;
        if (!localKeywordId) {
          log.warn(`v178: 关键词创建重试跳过 - 无本地keywordId, eventId=${event.id}`);
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
          log.warn(`v178: 关键词创建重试跳过 - 无adGroup, keywordId=${localKeywordId}`);
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
          campaignId: campRows[0].campaignId,  // v201: 保持字符串避免精度丢失
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
    log.error(`v178: 账户${accountId} retryFailedKeywordCreations失败: ${error.message}`);
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
    
    log.warn(`v178: 账户${accountId} 发现${failedEvents.length}条失败/pending的否定关键词添加需要重试`);
    
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
        
        // v201: 获取Amazon Campaign ID（增强诊断日志）
        let resolvedCampaignId = amazonCampaignId;
        if (!resolvedCampaignId && event.campaignId) {
          const campRows = await database
            .select({ campaignId: campaigns.campaignId, campaignName: campaigns.campaignName, campaignStatus: campaigns.campaignStatus })
            .from(campaigns)
            .where(eq(campaigns.id, event.campaignId))
            .limit(1);
          if (campRows.length > 0) {
            // v201: 直接使用字符串避免大数字精度丢失
            resolvedCampaignId = campRows[0].campaignId;
            log.debug(`v201: 否定词campaignId解析: localId=${event.campaignId} -> amazonId=${resolvedCampaignId} (${campRows[0].campaignName}, status=${campRows[0].campaignStatus})`);
          } else {
            log.warn(`v201: 否定词campaignId解析失败: localId=${event.campaignId} 在campaigns表中不存在`);
          }
        }
        
        if (!resolvedCampaignId) {
          log.warn(`v201: 跳过否定词事件 eventId=${event.id}: 无法解析campaignId (event.campaignId=${event.campaignId}, amazonCampaignId=${amazonCampaignId})`);
          continue;
        }
        
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
          adGroupId: amazonAdGroupId || undefined,  // v201: 保持字符串避免精度丢失
          keywordText: searchTerm,
          matchType: normalizedMatchType,
          level: amazonAdGroupId ? 'adgroup' : 'campaign',
          retryCount,
        };
        negKeywordsToSync.push(nkEntry);
      } catch (parseErr: any) {
        log.warn(`v178: 解析否定关键词事件失败: eventId=${event.id}, ${parseErr.message}`);
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
    
    // v201: 详细日志 - 记录即将同步的否定关键词信息
    log.info(`v201: 准备同步${toRetry.length}个否定关键词到Amazon:`);
    for (const nk of toRetry) {
      log.debug(`  - eventId=${nk.eventId}, campaignId=${nk.campaignId}, keyword="${nk.keywordText}", matchType=${nk.matchType}, level=${nk.level}`);
    }
    
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
    
    // v201: 详细记录同步结果
    log.warn(`v201: 否定关键词同步结果: 成功=${syncResult.success}, 失败=${syncResult.failed}, 错误数=${syncResult.errors.length}`);
    if (syncResult.errors.length > 0) {
      log.warn(`v201: 否定关键词同步错误详情:`);
      for (const err of syncResult.errors) {
        log.debug(`  - ${err}`);
      }
    }
    
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
        
        // v196: 同步成功后，回写amazon_negative_keyword_id
        const negLevel = nk.level || 'campaign';
        const mapKey = negLevel === 'campaign' 
          ? `campaign:${nk.campaignId}:${nk.keywordText.toLowerCase()}`
          : `adgroup:${nk.adGroupId}:${nk.keywordText.toLowerCase()}`;
        const amazonNegId = syncResult.keywordIdMap?.get(mapKey);
        if (amazonNegId) {
          await database.execute(sql`
            UPDATE negative_keywords 
            SET amazon_negative_keyword_id = ${amazonNegId}
            WHERE negativeText = ${nk.keywordText}
              AND campaignId = ${String(nk.campaignId)}
              AND amazon_negative_keyword_id IS NULL
            LIMIT 1
          `).catch((err: any) => {
            log.warn(`v196: 回写否定词ID失败: ${err.message}`);
          });
          log.info(`v196: 否定词同步成功并回写ID: "${nk.keywordText}" -> ${amazonNegId}`);
        } else {
          log.info(`v196: 否定词同步成功但未获取到Amazon ID: "${nk.keywordText}"`);
        }
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
        
        log.debug(`v178: 否定词Amazon永久拒绝，停止重试: "${nk.keywordText}"`);
        
        // v176: 标记negative_keywords表中的记录为removed
        await database.execute(sql`
          UPDATE negative_keywords SET negativeStatus = 'removed'
          WHERE negativeText = ${nk.keywordText}
            AND amazon_negative_keyword_id IS NULL
        `).catch((err: any) => {
          log.warn(`v178: 更新negative_keywords失败: ${err.message}`);
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
    log.error(`v178: 账户${accountId} retryFailedNegativeKeywordAdds失败: ${error.message}`);
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
    log.warn(`v178: 记录纠错事件失败: ${error.message}`);
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
      keywordCreateRetries: { found: 0, corrected: 0, failed: 0 },
      maxBidViolations: { found: 0, corrected: 0, failed: 0 },
      orphanKeywordCleanups: { found: 0, corrected: 0, failed: 0 },
      nextgenQualityAudits: { found: 0, corrected: 0, failed: 0 },
      statusChangeRetries: { found: 0, corrected: 0, failed: 0 },
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
    nextgenQualityAudits: { found: 0, corrected: 0, failed: 0 },
    statusChangeRetries: { found: 0, corrected: 0, failed: 0 },
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
      : c.type === 'nextgen_quality_audit' ? 'nextgenQualityAudits'
      : c.type === 'status_change_retry' ? 'statusChangeRetries'
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

// ==================== v204: 同步健康度评估与告警系统 ====================

/**
 * v204: 同步健康度等级
 */
export type SyncHealthLevel = 'healthy' | 'warning' | 'critical' | 'emergency';

/**
 * v204: 同步健康度报告
 */
export interface SyncHealthReport {
  level: SyncHealthLevel;
  overallSyncRate: number;       // 总体同步成功率 (0-100%)
  bidSyncRate: number;           // 出价同步成功率
  budgetSyncRate: number;        // 预算同步成功率
  negativeKeywordSyncRate: number; // 否定词同步成功率
  keywordCreateSyncRate: number; // 关键词创建成功率
  pendingCount: number;          // 待处理任务数
  failedCount: number;           // 失败任务数
  alerts: string[];              // 告警信息列表
  evaluatedAt: Date;
  correctionSuccessRate: number; // 纠错成功率
}

/** v204: 最近的健康报告缓存 */
let latestHealthReport: SyncHealthReport | null = null;

/**
 * v204: 评估同步健康度并生成告警
 * 
 * 健康度等级:
 * - healthy: 同步率 >= 95%, 无异常
 * - warning: 同步率 80-95%, 或待处理任务 > 50
 * - critical: 同步率 60-80%, 或失败任务 > 100
 * - emergency: 同步率 < 60%, 或纠错失败率 > 50%
 */
async function evaluateSyncHealth(database: any, scanResult: CorrectionScanResult): Promise<void> {
  try {
    // 1. 查询最近7天的同步状态统计
    const [syncStats] = await database.execute(sql`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
        SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN api_sync_status IN ('pending', 'not_applicable') THEN 1 ELSE 0 END) as pending
      FROM optimization_events 
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND api_sync_status NOT IN ('legacy_unsynced', 'invalid_legacy')
    `) as any;
    
    // 2. 按操作类型统计同步率
    const [typeStats] = await database.execute(sql`
      SELECT 
        action_type,
        COUNT(*) as total,
        SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced
      FROM optimization_events 
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND api_sync_status NOT IN ('legacy_unsynced', 'invalid_legacy')
      GROUP BY action_type
    `) as any;
    
    const stats = Array.isArray(syncStats) ? syncStats[0] : syncStats;
    const total = parseInt(String(stats?.total || '0'));
    const synced = parseInt(String(stats?.synced || '0'));
    const failed = parseInt(String(stats?.failed || '0'));
    const pending = parseInt(String(stats?.pending || '0'));
    
    // 3. 计算各类同步率
    const overallSyncRate = total > 0 ? (synced / total) * 100 : 100;
    
    const typeStatsArray = Array.isArray(typeStats) ? typeStats : [];
    const getTypeSyncRate = (actionType: string): number => {
      const typeStat = typeStatsArray.find((t: any) => t.action_type === actionType);
      if (!typeStat || parseInt(String(typeStat.total)) === 0) return 100;
      return (parseInt(String(typeStat.synced)) / parseInt(String(typeStat.total))) * 100;
    };
    
    const bidSyncRate = getTypeSyncRate('bid_adjustment');
    const budgetSyncRate = getTypeSyncRate('budget_adjustment');
    const negativeKeywordSyncRate = getTypeSyncRate('negative_keyword_add');
    const keywordCreateSyncRate = getTypeSyncRate('keyword_create');
    
    // 4. 计算纠错成功率
    const correctionSuccessRate = scanResult.totalIssuesFound > 0 
      ? (scanResult.totalCorrected / scanResult.totalIssuesFound) * 100 
      : 100;
    
    // 5. 生成告警信息
    const alerts: string[] = [];
    
    if (bidSyncRate < 80) {
      alerts.push(`⚠️ 出价同步率低于80%: ${bidSyncRate.toFixed(1)}%`);
    }
    if (budgetSyncRate < 80) {
      alerts.push(`⚠️ 预算同步率低于80%: ${budgetSyncRate.toFixed(1)}%`);
    }
    if (negativeKeywordSyncRate < 70) {
      alerts.push(`⚠️ 否定词同步率低于70%: ${negativeKeywordSyncRate.toFixed(1)}%`);
    }
    if (keywordCreateSyncRate < 70) {
      alerts.push(`⚠️ 关键词创建同步率低于70%: ${keywordCreateSyncRate.toFixed(1)}%`);
    }
    if (pending > 100) {
      alerts.push(`🚨 待处理任务积压: ${pending}个任务等待处理`);
    }
    if (failed > 50) {
      alerts.push(`🚨 失败任务过多: ${failed}个任务失败`);
    }
    if (correctionSuccessRate < 50 && scanResult.totalIssuesFound > 10) {
      alerts.push(`❗ 纠错成功率低于50%: ${correctionSuccessRate.toFixed(1)}% (${scanResult.totalCorrected}/${scanResult.totalIssuesFound})`);
    }
    
    // 6. 确定健康度等级
    let level: SyncHealthLevel = 'healthy';
    if (overallSyncRate < 60 || (correctionSuccessRate < 50 && scanResult.totalIssuesFound > 10)) {
      level = 'emergency';
    } else if (overallSyncRate < 80 || failed > 100) {
      level = 'critical';
    } else if (overallSyncRate < 95 || pending > 50 || alerts.length > 0) {
      level = 'warning';
    }
    
    // 7. 生成健康报告
    const report: SyncHealthReport = {
      level,
      overallSyncRate,
      bidSyncRate,
      budgetSyncRate,
      negativeKeywordSyncRate,
      keywordCreateSyncRate,
      pendingCount: pending,
      failedCount: failed,
      alerts,
      evaluatedAt: new Date(),
      correctionSuccessRate,
    };
    
    latestHealthReport = report;
    
    // 8. 输出健康报告日志
    const levelEmoji = level === 'healthy' ? '✅' : level === 'warning' ? '⚠️' : level === 'critical' ? '🚨' : '🔴';
    log.info(`[SyncHealth] v204: ${levelEmoji} 同步健康度: ${level.toUpperCase()}`);
    log.info(`[SyncHealth] v204: 总体同步率=${overallSyncRate.toFixed(1)}% | 出价=${bidSyncRate.toFixed(1)}% | 预算=${budgetSyncRate.toFixed(1)}% | 否定词=${negativeKeywordSyncRate.toFixed(1)}% | 关键词创建=${keywordCreateSyncRate.toFixed(1)}%`);
    log.warn(`[SyncHealth] v204: 待处理=${pending} | 失败=${failed} | 纠错成功率=${correctionSuccessRate.toFixed(1)}%`);
    
    if (alerts.length > 0) {
      log.debug(`[SyncHealth] v204: === 告警信息 (${alerts.length}条) ===`);
      for (const alert of alerts) {
        log.debug(`[SyncHealth] v204: ${alert}`);
      }
    }
    
    // 9. 如果是紧急状态，输出详细诊断信息
    if (level === 'emergency' || level === 'critical') {
      log.error(`[SyncHealth] v204: ❗❗❗ 系统同步健康度异常 (${level}) ❗❗❗`);
      log.error(`[SyncHealth] v204: 请检查: 1) Amazon API凭证是否过期 2) API速率限制 3) 网络连接 4) 数据库状态`);
      
      // 输出最近失败事件的典型错误模式
      try {
        const [recentErrors] = await database.execute(sql`
          SELECT action_type, error_message, COUNT(*) as count
          FROM optimization_events 
          WHERE api_sync_status = 'failed'
            AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
          GROUP BY action_type, SUBSTRING(error_message, 1, 100)
          ORDER BY count DESC
          LIMIT 5
        `) as any;
        
        if (Array.isArray(recentErrors) && recentErrors.length > 0) {
          log.error(`[SyncHealth] v204: 最近24小时失败模式:`);
          for (const err of recentErrors) {
            log.error(`[SyncHealth] v204:   ${err.action_type}: "${String(err.error_message || '').slice(0, 80)}" (${err.count}次)`);
          }
        }
      } catch (diagErr: any) {
        log.error(`[SyncHealth] v204: 诊断信息获取失败: ${diagErr.message}`);
      }
    }
    
  } catch (error: any) {
    log.error(`[SyncHealth] v204: 健康度评估失败: ${error.message}`);
  }
}

/**
 * v204: 获取最新的同步健康报告
 */
export function getLatestHealthReport(): SyncHealthReport | null {
  return latestHealthReport;
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
    
    log.info(`v178: 账户${accountId} 发现${rows.length}个关键词出价超出max_bid`);
    
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
        log.warn(`v178: 账户${accountId} max_bid纠正同步到Amazon: 成功${syncResult.success}, 失败${syncResult.failed}`);
      } catch (syncError: any) {
        log.error(`v178: 账户${accountId} max_bid纠正同步失败: ${syncError.message}`);
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
      log.info(`v178: 账户${accountId} 发现${ptRows.length}个商品定向出价超出max_bid`);
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
    log.error(`v178: 账户${accountId} correctMaxBidViolations失败: ${error.message}`);
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
    
    log.info(`v178: 账户${accountId} 发现${rows.length}个缺少Amazon ID的孤儿关键词，标记为paused`);
    
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
    log.error(`v178: 账户${accountId} cleanupOrphanKeywords失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 12. v178: 重试历史失败的搜索词收割（关键词创建） ====================

/**
 * v178: 重试历史失败的keyword_create事件
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
    // v202: 查找历史失败的 keyword_create 事件
    // 扩展条件: 包含 not_applicable, failed, pending 状态 (覆盖所有需要重试的类型)
    const failedEvents = await database.execute(sql`
      SELECT id, account_id, campaign_id, campaign_name, keyword_id, keyword_text,
             action_detail, api_sync_status, api_sync_detail, created_at
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND action_type IN ('keyword_create', 'search_term_harvest')
        AND api_sync_status IN ('not_applicable', 'failed', 'pending')
        AND keyword_id IS NULL
        AND action_detail IS NOT NULL
        AND action_detail != ''
      ORDER BY created_at DESC
      LIMIT ${MAX_PER_RUN}
    `);
    
    const events = (failedEvents as any)[0] || failedEvents;
    if (!events || events.length === 0) return results;
    
    log.warn(`v178: 账户${accountId} 发现${events.length}条历史失败的搜索词收割需要重试`);
    
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
            api_sync_detail = ${JSON.stringify({ reason: 'v178: 无法提取searchTerm或campaignId', fixedAt: new Date().toISOString() })}
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
                api_sync_detail = ${JSON.stringify({ reason: 'v178: campaign不存在', fixedAt: new Date().toISOString() })}
              WHERE id = ${kw.eventId}
            `).catch(() => {});
            results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'campaign', previousValue: '', correctedValue: kw.searchTerm, reason: `Campaign不存在，放弃重试: ${kw.searchTerm}`, success: false, errorMessage: 'campaign_not_found' });
          }
          continue;
        }
        
        const amazonCampaignId = campRows[0].campaignId;  // v201: 保持字符串避免精度丢失
        
        // 获取第一个活跃的 adGroup
        const agRows = await database
          .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
          .from(adGroups)
          .where(and(
            eq(adGroups.campaignId, String(localCampaignId)),
            eq(adGroups.adGroupStatus, 'enabled')
          ))
          .limit(1);
        
        if (agRows.length === 0) {
          for (const kw of kwEvents) {
            await database.execute(sql`
              UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
                api_sync_detail = ${JSON.stringify({ reason: 'v178: 无活跃adGroup', fixedAt: new Date().toISOString() })}
              WHERE id = ${kw.eventId}
            `).catch(() => {});
            results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'campaign', previousValue: '', correctedValue: kw.searchTerm, reason: `无活跃adGroup，放弃重试: ${kw.searchTerm}`, success: false, errorMessage: 'no_active_adgroup' });
          }
          continue;
        }
        
        const localAdGroupId = agRows[0].id;
        const amazonAdGroupId = agRows[0].adGroupId;  // v202: 保持字符串避免精度丢失
        
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
                api_sync_detail = ${JSON.stringify({ reason: 'v178: 关键词已存在于目标广告组', fixedAt: new Date().toISOString() })}
              WHERE id = ${kw.eventId}
            `).catch(() => {});
            results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'campaign', previousValue: '', correctedValue: kw.searchTerm, reason: `关键词已存在，标记为synced: ${kw.searchTerm}`, success: true });
          } else {
            toCreate.push(kw);
          }
        }
        
        if (toCreate.length === 0) continue;
        
        // 批量创建关键词
        log.debug(`v178: Campaign ${localCampaignId} 需要创建 ${toCreate.length} 个关键词`);
        
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
            // v204: 关键词预验证 — 在重试前清洗特殊字符并检查Amazon限制
            const kwValidation = sanitizeAndValidateKeyword(kw.searchTerm, 'positive');
            if (!kwValidation.isValid) {
              log.warn(`v204: 关键词预验证失败，标记为invalid_legacy: "${kw.searchTerm}" → ${kwValidation.reasonMessage}`);
              await database.execute(sql`
                UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
                  api_sync_detail = ${JSON.stringify({ reason: `v204: 关键词预验证失败: ${kwValidation.reasonMessage}`, fixedAt: new Date().toISOString() })}
                WHERE id = ${kw.eventId}
              `).catch(() => {});
              results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'keyword', previousValue: '', correctedValue: kw.searchTerm, reason: `预验证失败: ${kwValidation.reasonMessage}`, success: false, errorMessage: kwValidation.reasonCode || 'VALIDATION_FAILED' });
              continue;
            }
            // v204: 使用清洗后的文本
            const cleanedSearchTerm = kwValidation.sanitizedText;
            
            const normalizedMatchType = (kw.matchType === 'exact' || kw.matchType === 'phrase' || kw.matchType === 'broad') 
              ? kw.matchType as 'exact' | 'phrase' | 'broad'
              : 'phrase'; // 默认为 phrase
            
            // 在本地数据库创建关键词记录 (v204: 使用清洗后的文本)
            const insertResult = await database.execute(sql`
              INSERT INTO keywords (adGroupId, keywordText, matchType, bid, keywordStatus, createdAt, updatedAt)
              VALUES (${localAdGroupId}, ${cleanedSearchTerm}, ${normalizedMatchType}, '0.50', 'enabled', NOW(), NOW())
            `);
            const localKeywordId = (insertResult as any)[0]?.insertId || (insertResult as any)?.insertId;
            
            keywordsToSync.push({
              eventId: kw.eventId,
              localKeywordId,
              adGroupId: amazonAdGroupId,
              campaignId: amazonCampaignId,
              keywordText: cleanedSearchTerm,
              matchType: normalizedMatchType,
              bid: 0.50,
            });
          } catch (insertErr: any) {
            log.warn(`v178: 本地创建关键词失败: "${kw.searchTerm}" - ${insertErr.message}`);
            // 可能是重复插入，标记为 invalid_legacy
            await database.execute(sql`
              UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
                api_sync_detail = ${JSON.stringify({ reason: `v178: 本地创建失败: ${insertErr.message}`, fixedAt: new Date().toISOString() })}
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
                  correctedBy: 'AutoCorrector-v178-harvest-retry',
                  fixedAt: new Date().toISOString(),
                  localKeywordId: kw.localKeywordId,
                  isDuplicate,
                })},
                api_synced_at = NOW()
              WHERE id = ${kw.eventId}
            `).catch(() => {});
            
            results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'keyword', previousValue: '', correctedValue: kw.keywordText, reason: isDuplicate ? `关键词Amazon已存在: ${kw.keywordText}` : `重试创建关键词成功: ${kw.keywordText}`, success: true });
            log.info(`v178: ✅ 关键词创建成功: "${kw.keywordText}" (campaign=${localCampaignId}${isDuplicate ? ', 已存在' : ''})`);
          } else {
            // 失败 - 标记为 invalid_legacy（不再重试）
            await database.execute(sql`
              UPDATE optimization_events SET api_sync_status = 'invalid_legacy',
                api_sync_detail = ${JSON.stringify({ 
                  reason: `v178: Amazon拒绝创建关键词`,
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
            log.warn(`v178: ❌ 关键词创建失败: "${kw.keywordText}" (code=${errorCode || 'UNKNOWN'})`);
          }
        }
        
        // 批次间延迟，避免触发限流
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (campError: any) {
        log.error(`v178: Campaign ${localCampaignId} 关键词收割重试失败: ${campError.message}`);
        for (const kw of kwEvents) {
          results.push({ type: 'keyword_create_retry', accountId, targetId: localCampaignId, targetType: 'campaign', previousValue: '', correctedValue: kw.searchTerm, reason: `Campaign处理异常: ${kw.searchTerm}`, success: false, errorMessage: campError.message });
        }
      }
    }
    
    log.warn(`v178: 账户${accountId} 搜索词收割重试完成: 成功=${results.filter(r => r.success).length}, 失败=${results.filter(r => !r.success).length}`);
    
  } catch (error: any) {
    log.error(`v178: 账户${accountId} retryHistoricalFailedKeywordHarvests失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 13. v190: 恢复permanently_failed的optimization_tasks队列任务 ====================

/**
 * 恢复permanently_failed的optimization_tasks队列任务
 * 
 * 对于超过最大重试次数但仍未成功的任务，在等待一段时间后重置为retry状态，
 * 给它们再次机会。这是确保100%成功率的最后兆底。
 * 
 * 策略：
 * - 只恢复超过2小时但不超过7天的permanently_failed任务
 * - 重置retry_count为0，给予完整的重试机会
 * - 每次最多恢复50条，避免API限流
 * - 对于缺少Amazon ID的任务，先尝试回填ID
 */
async function rescuePermanentlyFailedTasks(accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    const mysql2 = await import('mysql2/promise');
    const conn = await mysql2.createConnection({
      host: process.env.DATABASE_HOST || 'amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com',
      user: process.env.DATABASE_USER || 'admin',
      password: process.env.DATABASE_PASSWORD || 'Mucers2025',
      database: process.env.DATABASE_NAME || 'amazon_ads_optimizer',
    });
    
    try {
      // 查找超过2小时但不超过7天的permanently_failed任务
      const [rows] = await conn.execute(
        `SELECT id, task_type, target_entity_type, target_entity_id, amazon_entity_id, 
                action, old_value, new_value, change_reason, error_message, retry_count,
                campaign_id, ad_group_id
         FROM optimization_tasks 
         WHERE account_id = ? 
           AND status = 'permanently_failed'
           AND completed_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)
           AND completed_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
         ORDER BY completed_at DESC
         LIMIT 50`,
        [accountId]
      ) as any[];
      
      if (rows.length === 0) return results;
      
      log.warn(`v190: 账户${accountId} 发现${rows.length}条permanently_failed任务需要恢复`);
      
      // 对于缺少Amazon ID的任务，先尝试回填
      for (const task of rows) {
        if (!task.amazon_entity_id && task.target_entity_id) {
          try {
            if (task.target_entity_type === 'keyword') {
              const [kwRows] = await conn.execute(
                'SELECT keywordId FROM keywords WHERE id = ? AND keywordId IS NOT NULL LIMIT 1',
                [task.target_entity_id]
              ) as any[];
              if (kwRows[0]?.keywordId) {
                task.amazon_entity_id = kwRows[0].keywordId;
                await conn.execute(
                  'UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?',
                  [task.amazon_entity_id, task.id]
                );
                log.debug(`v190: 回填Amazon ID: keyword ${task.target_entity_id} -> ${task.amazon_entity_id}`);
              }
            } else if (task.target_entity_type === 'product_target') {
              const [ptRows] = await conn.execute(
                'SELECT targetId FROM product_targets WHERE id = ? AND targetId IS NOT NULL LIMIT 1',
                [task.target_entity_id]
              ) as any[];
              if (ptRows[0]?.targetId) {
                task.amazon_entity_id = ptRows[0].targetId;
                await conn.execute(
                  'UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?',
                  [task.amazon_entity_id, task.id]
                );
                log.debug(`v190: 回填Amazon ID: product_target ${task.target_entity_id} -> ${task.amazon_entity_id}`);
              }
            } else if (task.target_entity_type === 'campaign') {
              const [cRows] = await conn.execute(
                'SELECT campaignId FROM campaigns WHERE id = ? AND campaignId IS NOT NULL LIMIT 1',
                [task.target_entity_id]
              ) as any[];
              if (cRows[0]?.campaignId) {
                task.amazon_entity_id = cRows[0].campaignId;
                await conn.execute(
                  'UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?',
                  [task.amazon_entity_id, task.id]
                );
                log.debug(`v190: 回填Amazon ID: campaign ${task.target_entity_id} -> ${task.amazon_entity_id}`);
              }
            }
          } catch (resolveErr: any) {
            log.warn(`v190: ID回填失败: ${resolveErr.message}`);
          }
        }
      }
      
      // 重置为retry状态，给予完整的重试机会
      const taskIds = rows.map((r: any) => r.id);
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      
      await conn.execute(
        `UPDATE optimization_tasks 
         SET status = 'retry', 
             retry_count = 0, 
             error_message = CONCAT('[AutoCorrector v190 恢复] ', IFNULL(error_message, '')),
             next_retry_at = ?
         WHERE id IN (${taskIds.join(',')})`,
        [now]
      );
      
      log.warn(`v190: 已恢复${taskIds.length}条permanently_failed任务为retry状态`);
      
      for (const task of rows) {
        results.push({
          type: 'keyword_create_retry', // 复用现有类型
          accountId,
          targetId: task.target_entity_id,
          targetType: task.target_entity_type || 'unknown',
          previousValue: task.old_value || '',
          correctedValue: task.new_value || '',
          reason: `[v190] 恢复permanently_failed任务: ${task.task_type}/${task.action} (retry_count已重置)`,
          success: true,
        });
      }
    } finally {
      await conn.end();
    }
  } catch (error: any) {
    log.error(`v190: 账户${accountId} rescuePermanentlyFailedTasks失败: ${error.message}`);
  }
  
  return results;
}

// ==================== 定时纠错调度 ====================
let correctionInterval: ReturnType<typeof setInterval> | null = null;

/**
 * 启动自动纠错定时服务（每4小时运行一次）
 */
// ==================== 14. v196: 回填缺少Amazon ID的否定词 ====================

async function backfillNegativeKeywordIds(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // 查找缺少amazon_negative_keyword_id的活跃否定词
    const [missingIdRows] = await database.execute(sql`
      SELECT id, campaignId, adGroupId, negativeText, negativeMatchType, negativeLevel
      FROM negative_keywords
      WHERE accountId = ${accountId}
        AND amazon_negative_keyword_id IS NULL
        AND negativeStatus = 'active'
      LIMIT 50
    `);
    
    if (!missingIdRows || missingIdRows.length === 0) return results;
    
    log.info(`v196: 账户${accountId} 发现${missingIdRows.length}个缺少Amazon ID的否定词，尝试回填...`);
    
    // 按campaign分组，从Amazon API查询已有的否定词
    const syncService = await amazonApiHelper.getAmazonSyncService(accountId);
    if (!syncService) {
      log.warn(`v196: 无法获取账户${accountId}的API服务`);
      return results;
    }
    
    // 收集所有涉及的campaignId，并建立本地ID到Amazon ID的映射
    const localCampaignIds = [...new Set(missingIdRows.map((r: any) => r.campaignId).filter(Boolean))];
    const localToAmazonCampaignIdMap = new Map<number, string>(); // localId -> amazonCampaignId
    for (const rawId of localCampaignIds) {
      const localId = Number(rawId);
      if (isNaN(localId)) continue;
      const campRows = await database
        .select({ campaignId: campaigns.campaignId })
        .from(campaigns)
        .where(eq(campaigns.id, localId))
        .limit(1);
      if (campRows.length > 0 && campRows[0].campaignId) {
        localToAmazonCampaignIdMap.set(localId, String(campRows[0].campaignId));
        log.debug(`v203: 否定词回填campaignId解析: localId=${localId} -> amazonId=${campRows[0].campaignId}`);
      } else {
        log.warn(`v203: 否定词回填campaignId解析失败: localId=${localId} 在campaigns表中不存在或无Amazon ID`);
      }
    }
    
    // 从Amazon查询每个campaign的否定词列表
    const amazonNegMap = new Map<string, string>(); // key: amazonCampaignId:text:matchType -> amazonId
    for (const [localId, amazonCampaignId] of localToAmazonCampaignIdMap.entries()) {
      try {
        const existing = await syncService.client.listSpCampaignNegativeKeywords(amazonCampaignId);
        for (const neg of existing) {
          const key = `${amazonCampaignId}:${(neg.keywordText || '').toLowerCase()}:${(neg.matchType || '').toLowerCase()}`;
          if (neg.keywordId) {
            amazonNegMap.set(key, String(neg.keywordId));
          }
        }
      } catch (listErr: any) {
          log.warn(`v203: 查询campaign localId=${localId} amazonId=${amazonCampaignId} 否定词失败: ${listErr.message}`);
      }
    }
    
    // 匹配并回填
    for (const row of missingIdRows) {
      const amazonCampaignId = localToAmazonCampaignIdMap.get(row.campaignId);
      if (!amazonCampaignId) {
        log.warn(`v203: 跳过否定词回填: id=${row.id}, localCampaignId=${row.campaignId} 无法解析Amazon ID`);
        continue;
      }
      const matchType = (row.negativeMatchType || '').replace('negative_', 'negative').toLowerCase();
      const key = `${amazonCampaignId}:${(row.negativeText || '').toLowerCase()}:${matchType}`;
      const amazonId = amazonNegMap.get(key);
      
      if (amazonId) {
        await database.execute(sql`
          UPDATE negative_keywords SET amazon_negative_keyword_id = ${amazonId} WHERE id = ${row.id}
        `);
        results.push({
          type: 'settings_retry',
          accountId,
          targetId: row.id,
          targetType: 'negative_keyword',
          previousValue: 'null',
          correctedValue: amazonId,
          reason: `v196: 回填否定词 Amazon ID: "${row.negativeText}"`,
          success: true,
        });
        log.debug(`v196: ✅ 回填否定词ID: "${row.negativeText}" -> ${amazonId}`);
      } else {
        // Amazon上不存在，重新创建（使用Amazon campaignId）
        try {
          // v204: 否定词预验证 — 在重新创建前清洗特殊字符
          const negMode = matchType.includes('exact') ? 'negative_exact' as const : 'negative_phrase' as const;
          let negValidation = sanitizeAndValidateKeyword(row.negativeText, negMode);
          let cleanedNegText = negValidation.sanitizedText || row.negativeText;
          let finalMatchType: 'negativeExact' | 'negativePhrase' = matchType.includes('exact') ? 'negativeExact' : 'negativePhrase';
          
          // v204: 如果negative_phrase超过4词，自动升级为negative_exact
          if (!negValidation.isValid && negMode === 'negative_phrase' && negValidation.reasonCode === 'EXCEEDS_MAX_WORDS_NEG_PHRASE') {
            negValidation = sanitizeAndValidateKeyword(row.negativeText, 'negative_exact');
            if (negValidation.isValid) {
              cleanedNegText = negValidation.sanitizedText;
              finalMatchType = 'negativeExact';
              log.debug(`v204: 否定词回填"${row.negativeText}"超过4词限制，自动升级为negativeExact`);
            }
          }
          
          if (!negValidation.isValid) {
            log.warn(`v204: 否定词回填预验证失败，跳过重新创建: "${row.negativeText}" → ${negValidation.reasonMessage}`);
            continue;
          }
          
          const syncResult = await amazonApiHelper.syncNegativeKeywordsToAmazon(accountId, [{
            campaignId: amazonCampaignId,  // v203: 使用Amazon campaignId而非本地ID
            keywordText: cleanedNegText,
            matchType: finalMatchType,
            level: (row.negativeLevel || 'campaign') as 'campaign' | 'adgroup',
          }]);
          
          const mapKey = `campaign:${amazonCampaignId}:${(cleanedNegText || '').toLowerCase()}`;
          const newId = syncResult.keywordIdMap?.get(mapKey);
          if (newId) {
            await database.execute(sql`
              UPDATE negative_keywords SET amazon_negative_keyword_id = ${newId} WHERE id = ${row.id}
            `);
            results.push({
              type: 'settings_retry',
              accountId,
              targetId: row.id,
              targetType: 'negative_keyword',
              previousValue: 'null',
              correctedValue: newId,
              reason: `v196: 重新创建并回填否定词 Amazon ID: "${row.negativeText}"`,
              success: true,
            });
          }
        } catch (createErr: any) {
          log.warn(`v196: 重新创建否定词失败: ${createErr.message}`);
        }
      }
    }
    
    log.info(`v196: 否定词ID回填完成: 成功${results.length}/${missingIdRows.length}`);
  } catch (err: any) {
    log.error(`v196: 否定词ID回填异常: ${err.message}`);
  }
  
  return results;
}

/**
 * v196: 基于bidding_logs的出价执行确认
 * 查询最近24小时内execution_status='success'的bidding_logs
 * 对比new_bid与keywords/product_targets表中的当前bid
 * 如果不一致，说明Amazon可能未正确执行，触发重新同步
 */
async function verifyBiddingLogsExecution(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // v204: 获取账户货币用于动态容差计算
    const currencyCode = await getAccountCurrencyCode(accountId);
    
    // v200: 使用列名自动检测，兼容camelCase和snake_case两种列名
    // bidding_logs表无显式映射的列在DB中为camelCase（drizzle-kit push不会重命名已有列）
    // 显式映射的列为snake_case: execution_status, api_response_id, error_message
    let recentBidLogs: any;
    try {
      // 首选camelCase列名（旧表实际列名），显式映射的列用snake_case
      recentBidLogs = await database.execute(sql`
        SELECT bl.id, bl.logTargetType as log_target_type, bl.targetId as target_id, bl.targetName as target_name,
               bl.previousBid as previous_bid, bl.newBid as new_bid, bl.createdAt as created_at,
               bl.campaignId as campaign_id, bl.adGroupId as ad_group_id
        FROM bidding_logs bl
        INNER JOIN (
          SELECT targetId, logTargetType, MAX(id) as max_id
          FROM bidding_logs
          WHERE accountId = ${accountId}
            AND execution_status = 'success'
            AND createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
          GROUP BY targetId, logTargetType
        ) latest ON bl.id = latest.max_id
        LIMIT 200
      `);
    } catch (camelErr: any) {
      log.warn(`v200: camelCase查询失败，尝试snake_case列名: ${camelErr.message?.substring(0, 100)}`);
      // 回退到snake_case列名（如果表在casing配置后被重建）
      recentBidLogs = await database.execute(sql`
        SELECT bl.id, bl.log_target_type, bl.target_id, bl.target_name,
               bl.previous_bid, bl.new_bid, bl.created_at,
               bl.campaign_id, bl.ad_group_id
        FROM bidding_logs bl
        INNER JOIN (
          SELECT target_id, log_target_type, MAX(id) as max_id
          FROM bidding_logs
          WHERE account_id = ${accountId}
            AND execution_status = 'success'
            AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
          GROUP BY target_id, log_target_type
        ) latest ON bl.id = latest.max_id
        LIMIT 200
      `);
    }
    
    const rows = (recentBidLogs as any)?.[0] || recentBidLogs;
    if (!Array.isArray(rows) || rows.length === 0) {
      log.info(`v196: 账户${accountId} 最近24小时无成功的出价调整日志`);
      return results;
    }
    
    let verified = 0;
    let mismatched = 0;
    let corrected = 0;
    
    for (const log of rows) {
      const expectedBid = parseFloat(String(log.new_bid));
      const targetId = log.target_id;
      const targetType = log.log_target_type;
      
      // 根据类型查询当前实际bid
      let currentBid: number | null = null;
      
      if (targetType === 'keyword') {
        const [kw] = await database
          .select({ bid: keywords.bid })
          .from(keywords)
          .where(eq(keywords.id, targetId))
          .limit(1);
        if (kw) currentBid = parseFloat(String(kw.bid || '0'));
      } else if (targetType === 'product_target') {
        const [pt] = await database
          .select({ bid: productTargets.bid })
          .from(productTargets)
          .where(eq(productTargets.id, targetId))
          .limit(1);
        if (pt) currentBid = parseFloat(String(pt.bid || '0'));
      }
      
      if (currentBid === null) continue;
      
      // v204: 使用基于货币的动态容差，替代固定20%比例容差
      // 这样可以更精确地区分货币转换差异和真正的执行失败
      const absDiff = Math.abs(currentBid - expectedBid);
      const relDiff = expectedBid > 0 ? absDiff / expectedBid : 0;
      const { absTolerance: verifyAbsTol, relTolerance: verifyRelTol } = getBidVerifyTolerance(currencyCode);
      
      if (absDiff <= verifyAbsTol || relDiff <= verifyRelTol) {
        verified++;
        if (absDiff > 0.01) {
          // v204: 记录有差异但在货币容差范围内的情况
          log.debug(`v204: 出价确认(${currencyCode}容差内): ${targetType} id=${targetId} expected=$${expectedBid.toFixed(2)} actual=$${currentBid.toFixed(2)} diff=${(relDiff*100).toFixed(1)}%`);
        }
        continue;
      }
      
      // 发现不一致（超出容差范围）— 记录并尝试纠正
      mismatched++;
      log.warn(`v204: 出价执行确认失败(${currencyCode}): ${targetType} id=${targetId} expected=$${expectedBid.toFixed(2)} actual=$${currentBid.toFixed(2)} diff=${(relDiff*100).toFixed(1)}% (absTol=${verifyAbsTol.toFixed(3)}, relTol=${(verifyRelTol*100).toFixed(0)}%)`);
      
      // 将本地DB更新为最新的成功出价（因为API已经成功，本地可能被同步覆盖了）
      try {
        if (targetType === 'keyword') {
          await database
            .update(keywords)
            .set({ bid: String(expectedBid) })
            .where(eq(keywords.id, targetId));
        } else if (targetType === 'product_target') {
          await database
            .update(productTargets)
            .set({ bid: String(expectedBid) })
            .where(eq(productTargets.id, targetId));
        }
        corrected++;
        
        results.push({
          type: 'bid_execution_verify',
          accountId,
          targetId,
          targetType,
          previousValue: String(currentBid),
          correctedValue: String(expectedBid),
          reason: `[v196执行确认] bidding_logs记录成功但本地bid不一致: 期望$${expectedBid.toFixed(2)}, 实际$${currentBid.toFixed(2)}`,
          success: true,
        });
      } catch (corrErr: any) {
        log.error(`v196: 出价执行确认纠正失败: ${corrErr.message}`);
        results.push({
          type: 'bid_execution_verify',
          accountId,
          targetId,
          targetType,
          previousValue: String(currentBid),
          correctedValue: String(expectedBid),
          reason: `[v196执行确认] 纠正失败: ${corrErr.message}`,
          success: false,
        });
      }
    }
    
    log.info(`v196: 账户${accountId} 出价执行确认完成: 检查=${rows.length}, 确认=${verified}, 不一致=${mismatched}, 纠正=${corrected}`);
    
  } catch (err: any) {
    log.error(`v199: 出价执行确认异常: ${err.message}`);
    if (err.cause) log.error(`v199: MySQL错误详情: ${JSON.stringify(err.cause).substring(0, 500)}`);
    if (err.sql) log.error(`v199: 失败SQL: ${err.sql?.substring(0, 200)}`);
  }
  
  return results;
}

// ==================== 16. v198: NextGen算法决策质量审计 ====================

/**
 * v198: NextGen算法决策质量审计
 * 
 * 核心逻辑：
 * 1. 查询最近7天内由旧算法（algorithm_version < v197）做出的出价决策
 * 2. 对每个关键词/商品定向调用NextGen算法获取建议出价
 * 3. 如果NextGen建议与当前出价差异超过阈值（15%），标记为"算法质量问题"
 * 4. 自动纠正：将出价调整为NextGen建议值，并同步到Amazon API
 * 5. 所有纠正操作记录到optimization_events表，确保完全可追溯
 * 
 * 安全护栏：
 * - 每次最多审计100个关键词/商品定向
 * - 单次出价调整幅度不超过±25%
 * - 仅审计有足够数据（impressions > 0 或 spend > 0）的目标
 * - 审计间隔：每次纠错扫描只审计一次，避免重复
 */
const QUALITY_AUDIT_CONFIG = {
  maxAuditsPerRun: 100,
  bidDeviationThreshold: 0.15, // 15%偏差阈值
  maxSingleAdjustmentPercent: 0.25, // 单次最大调整25%
  lookbackDays: 7, // 审计最近7天的决策
  minDataForAudit: true, // 要求有最低数据量
};

async function auditAlgorithmDecisionQuality(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    // v200: 修复SQL查询 - keywords表没有accountId/campaignId列
    // 正确的JOIN链: keywords → ad_groups → campaigns → performance_groups
    // 列名规则: 旧表列名为camelCase（drizzle-kit push不会重命名已有列）
    // 显式映射的列为snake_case（如 max_bid, daily_budget, execution_status）
    // optimization_events表所有列都有显式映射，为snake_case
    const auditCandidates = await database.execute(sql`
      SELECT 
        k.id as keyword_id,
        k.keywordText as keyword_text,
        k.bid as current_bid,
        k.matchType as match_type,
        k.impressions,
        k.clicks,
        k.spend,
        k.sales,
        k.orders,
        k.keywordStatus as keyword_status,
        ag.campaignId as amazon_campaign_id,
        c.id as campaign_db_id,
        c.campaignName as campaign_name,
        c.campaignStatus as campaign_status,
        pg.id as perf_group_id,
        pg.targetAcos as target_acos,
        pg.max_bid,
        pg.optimizationGoal as optimization_goal,
        pg.daily_budget,
        oe.algorithm_version as last_algo_version,
        oe.created_at as last_optimized_at
      FROM keywords k
      INNER JOIN ad_groups ag ON k.adGroupId = ag.id
      INNER JOIN campaigns c ON ag.campaignId = c.id AND c.accountId = ${accountId}
      INNER JOIN performance_groups pg ON c.performanceGroupId = pg.id
      LEFT JOIN (
        SELECT keyword_id, algorithm_version, created_at,
               ROW_NUMBER() OVER (PARTITION BY keyword_id ORDER BY created_at DESC) as rn
        FROM optimization_events
        WHERE account_id = ${accountId}
          AND event_category = 'bid_adjustment'
          AND status = 'success'
          AND created_at > DATE_SUB(NOW(), INTERVAL ${QUALITY_AUDIT_CONFIG.lookbackDays} DAY)
      ) oe ON oe.keyword_id = k.id AND oe.rn = 1
      WHERE k.keywordStatus = 'enabled'
        AND c.campaignStatus = 'enabled'
        AND pg.status = 'active'
        AND CAST(k.bid AS DECIMAL(10,2)) > 0
        AND (k.impressions > 0 OR CAST(k.spend AS DECIMAL(10,2)) > 0)
        AND (
          oe.algorithm_version IS NULL
          OR (
            oe.algorithm_version NOT LIKE '%v197%'
            AND oe.algorithm_version NOT LIKE '%v198%'
            AND oe.algorithm_version NOT LIKE '%v199%'
            AND oe.algorithm_version NOT LIKE '%v200%'
            AND oe.algorithm_version NOT LIKE '%v201%'
            AND oe.algorithm_version NOT LIKE '%v202%'
            AND oe.algorithm_version NOT LIKE '%v203%'
            AND oe.algorithm_version NOT LIKE '%v204%'
            AND oe.algorithm_version NOT LIKE '%NextGen%'
            AND oe.algorithm_version NOT LIKE '%nextgen%'
            AND oe.algorithm_version NOT LIKE '%AutoCorrector%'
          )
        )
      ORDER BY CAST(k.spend AS DECIMAL(10,2)) DESC
      LIMIT ${QUALITY_AUDIT_CONFIG.maxAuditsPerRun}
    `);
    
    const rows = (auditCandidates as any)?.[0] || auditCandidates;
    if (!Array.isArray(rows) || rows.length === 0) {
      log.debug(`v198: 账户${accountId} 无需NextGen质量审计（所有活跃关键词已由NextGen优化）`);
      return results;
    }
    
    log.info(`v198: 账户${accountId} 发现${rows.length}个关键词需要NextGen质量审计`);
    
    // 动态导入NextGen编排器
    const { calculateNextGenBid } = await import('./nextGenBidOrchestrator');
    
    // 按performance_group分组，构建bidConfig
    const groupConfigs = new Map<number, any>();
    for (const row of rows) {
      if (!groupConfigs.has(row.perf_group_id)) {
        groupConfigs.set(row.perf_group_id, {
          optimizationGoal: row.optimization_goal || 'balanced',
          targetAcos: row.target_acos ? parseFloat(String(row.target_acos)) : undefined,
          dailyBudget: row.daily_budget ? parseFloat(String(row.daily_budget)) : undefined,
          maxBid: row.max_bid ? parseFloat(String(row.max_bid)) : undefined,
        });
      }
    }
    
    let audited = 0;
    let deviationsFound = 0;
    let corrected = 0;
    
    // 收集需要API同步的出价调整
    const bidAdjustments: Array<{ keywordId: number; newBid: number; campaignId: number; reason: string; isProductTarget: boolean }> = [];
    
    for (const row of rows) {
      try {
        const currentBid = parseFloat(String(row.current_bid || '0'));
        if (currentBid <= 0) continue;
        
        const bidConfig = groupConfigs.get(row.perf_group_id);
        if (!bidConfig) continue;
        
        const maxBidLimit = row.max_bid ? parseFloat(String(row.max_bid)) : 2.00;
        
        // 构建OptimizationTarget
        const target = {
          id: row.keyword_id,
          type: 'keyword' as const,
          currentBid,
          impressions: row.impressions || 0,
          clicks: row.clicks || 0,
          spend: parseFloat(String(row.spend || '0')),
          sales: parseFloat(String(row.sales || '0')),
          orders: row.orders || 0,
          matchType: row.match_type,
        };
        
        // 调用NextGen获取建议出价
        const nextGenResult = await calculateNextGenBid(accountId, target, bidConfig, maxBidLimit);
        audited++;
        
        // 计算偏差
        const deviation = Math.abs(nextGenResult.newBid - currentBid) / currentBid;
        
        if (deviation >= QUALITY_AUDIT_CONFIG.bidDeviationThreshold && nextGenResult.actionType !== 'hold') {
          deviationsFound++;
          
          // 安全限制：单次调整不超过maxSingleAdjustmentPercent
          let adjustedBid = nextGenResult.newBid;
          const maxChange = currentBid * QUALITY_AUDIT_CONFIG.maxSingleAdjustmentPercent;
          if (adjustedBid > currentBid + maxChange) {
            adjustedBid = Math.round((currentBid + maxChange) * 100) / 100;
          } else if (adjustedBid < currentBid - maxChange) {
            adjustedBid = Math.round((currentBid - maxChange) * 100) / 100;
          }
          adjustedBid = Math.max(adjustedBid, 0.02);
          adjustedBid = Math.min(adjustedBid, maxBidLimit);
          adjustedBid = Math.round(adjustedBid * 100) / 100;
          
          // 再次确认调整后的偏差仍然有意义（>$0.01）
          if (Math.abs(adjustedBid - currentBid) > 0.01) {
            bidAdjustments.push({
              keywordId: row.keyword_id,
              newBid: adjustedBid,
              campaignId: row.campaign_id,
              reason: `[v198质量审计] NextGen建议$${nextGenResult.newBid.toFixed(2)}(${nextGenResult.algorithmUsed}), 旧出价$${currentBid.toFixed(2)}, 偏差${(deviation * 100).toFixed(1)}%, 安全调整到$${adjustedBid.toFixed(2)}`,
              isProductTarget: false,
            });
            
            results.push({
              type: 'nextgen_quality_audit',
              accountId,
              targetId: row.keyword_id,
              targetType: 'keyword',
              previousValue: String(currentBid),
              correctedValue: String(adjustedBid),
              reason: `[v198质量审计] "${row.keyword_text}" 旧算法出价$${currentBid.toFixed(2)} → NextGen建议$${adjustedBid.toFixed(2)} (${nextGenResult.algorithmUsed}, 偏差${(deviation * 100).toFixed(1)}%)`,
              success: true, // 暂标记为true，API同步后更新
            });
          }
        }
      } catch (kwErr: any) {
        log.warn(`v198: 关键词${row.keyword_id}质量审计失败: ${kwErr.message}`);
      }
    }
    
    // 批量同步出价调整到Amazon API
    if (bidAdjustments.length > 0) {
      try {
        const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(accountId, bidAdjustments);
        corrected = syncResult.success;
        
        // 更新本地DB中的出价
        for (const adj of bidAdjustments) {
          const itemResult = syncResult.itemResults?.get(adj.keywordId);
          const synced = itemResult?.status === 'synced';
          
          if (synced) {
            await database
              .update(keywords)
              .set({ bid: String(adj.newBid) })
              .where(eq(keywords.id, adj.keywordId));
          }
          
          // 记录审计事件到optimization_events
          await logCorrectionEvent(database, {
            accountId,
            eventCategory: 'bid_adjustment',
            actionType: 'nextgen_quality_audit',
            keywordId: adj.keywordId,
            campaignId: adj.campaignId,
            previousBid: results.find(r => r.targetId === adj.keywordId)?.previousValue,
            newBid: String(adj.newBid),
            changeReason: adj.reason,
          });
          
          // 更新results中的success状态
          const resultItem = results.find(r => r.targetId === adj.keywordId);
          if (resultItem && !synced) {
            resultItem.success = false;
            resultItem.errorMessage = itemResult?.error || 'API sync failed';
          }
        }
        
        log.warn(`v198: 账户${accountId} NextGen质量审计API同步完成: 成功=${syncResult.success}, 失败=${syncResult.failed}`);
      } catch (apiErr: any) {
        log.error(`v198: 账户${accountId} NextGen质量审计API同步失败: ${apiErr.message}`);
        // 标记所有结果为失败
        for (const r of results) {
          if (r.type === 'nextgen_quality_audit') {
            r.success = false;
            r.errorMessage = apiErr.message;
          }
        }
      }
    }
    
    log.info(`v198: 账户${accountId} NextGen质量审计完成: 审计=${audited}, 偏差=${deviationsFound}, 纠正=${corrected}`);
    
  } catch (err: any) {
    log.error(`v199: 账户${accountId} NextGen质量审计异常: ${err.message}`);
    if (err.cause) log.error(`v199: MySQL错误详情: ${JSON.stringify(err.cause).substring(0, 500)}`);
    if (err.sql) log.error(`v199: 失败SQL: ${err.sql?.substring(0, 200)}`);
  }
  
  return results;
}

// ==================== 16b. v198: 商品定向NextGen质量审计 ====================
// 注：商品定向的审计逻辑已集成在auditAlgorithmDecisionQuality中
// 未来可扩展为独立函数处理product_target的特殊场景

export function startAutoCorrector(): void {
  if (correctionInterval) {
    log.debug('定时纠错服务已在运行中');
    return;
  }
  const intervalMs = (AUTO_CORRECTION_CONFIG as any).scanIntervalHours 
    ? (AUTO_CORRECTION_CONFIG as any).scanIntervalHours * 60 * 60 * 1000 
    : 4 * 60 * 60 * 1000;
  correctionInterval = setInterval(async () => {
    try {
      log.info('定时纠错扫描开始...');
      const result = await runAutoCorrection();
      log.warn(`定时纠错扫描完成: 发现${result.totalIssuesFound}个问题, 纠正${result.totalCorrected}个, 失败${result.totalFailed}个`);
    } catch (err: any) {
      log.error('定时纠错扫描失败:', err.message);
    }
  }, intervalMs);
  log.info(`定时纠错服务已启动，每${(AUTO_CORRECTION_CONFIG as any).scanIntervalHours || 4}小时运行一次`);
}

/**
 * 停止自动纠错定时服务
 */
export function stopAutoCorrector(): void {
  if (correctionInterval) {
    clearInterval(correctionInterval);
    correctionInterval = null;
    log.debug('定时纠错服务已停止');
  }
}


// ==================== 17. v202: 重试失败的关键词/投放目标状态变更 ====================

/**
 * v202: 重试失败的 target_enable/target_pause 事件
 * 
 * 这些事件来自搜索词分析中的关键词状态变更（暂停低效词、启用高效词）
 * 失败原因通常是缺少 Amazon keywordId 或 API 临时错误
 * 
 * 处理流程:
 * 1. 查找 failed/pending 的 target_enable/target_pause 事件
 * 2. 从 action_detail 中提取 keywordId 和目标状态
 * 3. 调用 syncKeywordStatusToAmazon 重新同步
 * 4. 更新事件状态
 */
async function retryFailedTargetStatusChanges(database: any, accountId: number): Promise<CorrectionResult[]> {
  const results: CorrectionResult[] = [];
  
  try {
    const expiryDateStr = new Date(Date.now() - AUTO_CORRECTION_CONFIG.retryExpiryDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    
    const failedEvents = await database
      .select({
        id: optimizationEvents.id,
        campaignId: optimizationEvents.campaignId,
        campaignName: optimizationEvents.campaignName,
        keywordId: optimizationEvents.keywordId,
        keywordText: optimizationEvents.keywordText,
        actionType: optimizationEvents.actionType,
        actionDetail: optimizationEvents.actionDetail,
        newValue: optimizationEvents.newValue,
        apiSyncDetail: optimizationEvents.apiSyncDetail,
        createdAt: optimizationEvents.createdAt,
      })
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.accountId, accountId),
          or(
            eq(optimizationEvents.actionType, 'target_enable'),
            eq(optimizationEvents.actionType, 'target_pause')
          ),
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
    
    log.warn(`v202: 账户${accountId} 发现${failedEvents.length}条失败的关键词状态变更需要重试`);
    
    // 收集需要重试的状态变更
    const statusChanges: Array<{
      eventId: number;
      keywordId: number;
      newStatus: 'enabled' | 'paused' | 'archived';
      campaignId: number;
      reason: string;
      isProductTarget: boolean;
    }> = [];
    
    for (const event of failedEvents) {
      try {
        let detail: any = {};
        if (event.actionDetail) {
          try { detail = typeof event.actionDetail === 'string' ? JSON.parse(event.actionDetail) : event.actionDetail; } catch {}
        }
        
        // 从action_detail中提取本地keywordId
        const localKeywordId = detail.keywordId || event.keywordId;
        if (!localKeywordId) {
          // 无法确定关键词，标记为invalid_legacy
          await database.update(optimizationEvents).set({
            apiSyncStatus: 'invalid_legacy',
            apiSyncDetail: JSON.stringify({ reason: 'v202: 无法确定keywordId', fixedAt: new Date().toISOString() }),
          }).where(eq(optimizationEvents.id, event.id));
          continue;
        }
        
        // 确定目标状态
        const newStatus = event.actionType === 'target_enable' ? 'enabled' : 'paused';
        const isProductTarget = detail.isProductTarget || detail.targetType === 'product' || false;
        
        // 检查重试次数
        let retryCount = 0;
        if (event.apiSyncDetail) {
          try {
            const syncDetail = typeof event.apiSyncDetail === 'string' ? JSON.parse(event.apiSyncDetail) : event.apiSyncDetail;
            retryCount = syncDetail.retryCount || 0;
          } catch {}
        }
        
        if (retryCount >= AUTO_CORRECTION_CONFIG.maxRetryAttempts) {
          await database.update(optimizationEvents).set({
            apiSyncStatus: 'not_applicable',
            apiSyncDetail: JSON.stringify({ 
              reason: `超过最大重试次数(${AUTO_CORRECTION_CONFIG.maxRetryAttempts})`,
              retryCount,
              lastRetryAt: new Date().toISOString()
            }),
          }).where(eq(optimizationEvents.id, event.id));
          
          results.push({
            type: 'status_change_retry',
            accountId,
            targetId: localKeywordId,
            targetType: 'keyword',
            previousValue: '',
            correctedValue: newStatus,
            reason: `关键词状态变更超过最大重试次数: ${event.keywordText || localKeywordId}`,
            success: false,
            errorMessage: `超过最大重试次数(${AUTO_CORRECTION_CONFIG.maxRetryAttempts})`,
          });
          continue;
        }
        
        statusChanges.push({
          eventId: event.id,
          keywordId: localKeywordId,
          newStatus: newStatus as 'enabled' | 'paused',
          campaignId: event.campaignId || 0,
          reason: `[AutoCorrector v202] 重试关键词状态变更`,
          isProductTarget,
        });
      } catch (parseErr: any) {
        log.warn(`v202: 解析状态变更事件失败: eventId=${event.id}, ${parseErr.message}`);
      }
    }
    
    if (statusChanges.length === 0) return results;
    
    log.info(`v202: 准备重试${statusChanges.length}个关键词状态变更`);
    
    // 调用Amazon API批量同步
    const syncResult = await amazonApiHelper.syncKeywordStatusToAmazon(
      accountId,
      statusChanges.map(sc => ({
        keywordId: sc.keywordId,
        newStatus: sc.newStatus,
        campaignId: sc.campaignId,
        reason: sc.reason,
        isProductTarget: sc.isProductTarget,
      }))
    );
    
    log.warn(`v202: 关键词状态变更同步结果: 成功=${syncResult.success}, 失败=${syncResult.failed}`);
    
    // 更新事件状态
    const failedKeywordIds = new Set<number>();
    for (const err of syncResult.errors) {
      const match = err.match(/关键词\s*(\d+)/);
      if (match) failedKeywordIds.add(Number(match[1]));
    }
    
    for (const sc of statusChanges) {
      const success = !failedKeywordIds.has(sc.keywordId) && syncResult.success > 0;
      
      if (success) {
        await database.update(optimizationEvents).set({
          apiSyncStatus: 'synced',
          apiSyncDetail: JSON.stringify({ correctedBy: 'AutoCorrector v202', correctedAt: new Date().toISOString() }),
          apiSyncedAt: new Date(),
        }).where(eq(optimizationEvents.id, sc.eventId));
        
        // 同步更新optimization_logs
        await database.execute(sql`
          UPDATE optimization_logs SET api_sync_status = 'synced'
          WHERE id = (SELECT source_id FROM optimization_events WHERE id = ${sc.eventId} AND source_table = 'optimization_logs')
        `).catch(() => {});
      } else {
        // 记录重试次数
        let retryCount = 0;
        try {
          const event = failedEvents.find((e: any) => e.id === sc.eventId);
          if (event?.apiSyncDetail) {
            const syncDetail = typeof event.apiSyncDetail === 'string' ? JSON.parse(event.apiSyncDetail) : event.apiSyncDetail;
            retryCount = (syncDetail.retryCount || 0) + 1;
          } else {
            retryCount = 1;
          }
        } catch {}
        
        await database.update(optimizationEvents).set({
          apiSyncDetail: JSON.stringify({ 
            retryCount,
            lastRetryAt: new Date().toISOString(),
            lastError: syncResult.errors.join('; ').substring(0, 200)
          }),
        }).where(eq(optimizationEvents.id, sc.eventId));
      }
      
      results.push({
        type: 'status_change_retry',
        accountId,
        targetId: sc.keywordId,
        targetType: 'keyword',
        previousValue: '',
        correctedValue: sc.newStatus,
        reason: `重试关键词状态变更(${sc.newStatus}): keywordId=${sc.keywordId}`,
        success,
        errorMessage: success ? undefined : syncResult.errors.join('; '),
      });
    }
  } catch (error: any) {
    log.error(`v202: 账户${accountId} retryFailedTargetStatusChanges失败: ${error.message}`);
  }
  
  return results;
}
