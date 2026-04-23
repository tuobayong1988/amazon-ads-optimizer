/**
 * aggressiveBleedingStop.ts — v727
 * 
 * 两阶段纠正策略 - 第一阶段：激进止血
 * 
 * v727 核心改动（同步锁定机制）：
 * 
 * 在止血修正竞价后，向 optimization_events 表批量插入保护记录：
 * - event_category = 'bid_adjustment'
 * - action_type = 'auto_correction'
 * - api_sync_status = 'synced'
 * 
 * 这样现有的同步保护机制（keywordSync.ts / syncSp.ts / productTargetSync.ts）
 * 会在24小时内自动保护这些实体的bid不被Amazon数据同步覆盖。
 * 
 * 同样为位置倾斜修正插入 placement_adjustment 保护记录。
 * 
 * 保留v726所有修复：
 * 1. 基于bid_anchor_analysis的anchor_bid进行竞价纠正
 * 2. API返回值用errors数组判断
 * 3. DB批量CASE WHEN更新
 * 4. 修正后更新bid_anchor_analysis状态为applied
 * 
 * 覆盖四个维度：
 * 1. 投放词/ASIN竞价 → 基于bid_anchor_analysis的suggested_bid（通过Amazon API推送）
 * 2. 分时竞价乘数 → 回归到 0.80~1.20（系统内部调度表，数据库修改即可）
 * 3. 分时预算乘数 → 回归到 0.70~1.30（系统内部调度表，数据库修改即可）
 * 4. 位置倾斜 → 回归到 0%~50%（通过Amazon API推送）
 */
import { getDb } from '../db';
import {
  productTargets,
  keywords,
  campaigns,
  bidAnchorAnalysis,
  daypartingBudgetRules,
  hourpartingBidRules,
  optimizationEvents,
} from '../../drizzle/schema';
import { eq, and, gt, lt, or, isNotNull, inArray, sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';
import { getAmazonSyncService } from '../services/amazonApiHelper';
const log = createModuleLogger('AggressiveBleedingStop');
// ============================================================
// 健康基线配置
// ============================================================
const HEALTH = {
  hourparting: {
    healthyMin: 0.80,
    healthyMax: 1.20,
    extremeHighTarget: 1.20,
    extremeLowTarget: 0.80,
  },
  dayparting: {
    healthyMin: 0.70,
    healthyMax: 1.30,
    extremeHighTarget: 1.30,
    extremeLowTarget: 0.70,
  },
  placement: {
    maxHealthy: 50,
  },
  bid: {
    absoluteMin: 0.02,
    absoluteMax: 10.00,
  },
};
const API_CONFIG = {
  batchSize: 1000,       // Amazon API每批最多1000条
  batchDelayMs: 500,     // 批间延迟500ms防止限流
  dbBatchSize: 500,      // DB批量更新每批500条
  apiRetries: 3,         // API调用重试次数
  apiRetryDelayMs: 3000, // API重试间隔
  protectionBatchSize: 200, // optimization_events批量插入每批200条
};
// ============================================================
// 类型
// ============================================================
interface PhaseResult {
  phase: string;
  analyzed: number;
  corrected: number;
  skipped: number;
  failed: number;
  apiPushed: number;
  apiFailed: number;
  protectionRecords: number;  // v727: 插入的保护记录数
  details: CorrectionDetail[];
  apiErrors: string[];
}
interface CorrectionDetail {
  entityType: string;
  entityId: string | number;
  accountId?: number;
  amazonId?: string;
  dimension: string;
  oldValue: number;
  newValue: number;
  changePct: number;
  reason: string;
}
interface AnchorBidUpdate {
  analysisId: number;        // bid_anchor_analysis.id
  internalId: number;        // keywords.id 或 product_targets.id
  amazonId: string;          // Amazon keywordId 或 targetId
  accountId: number;
  entityType: 'product_target' | 'keyword';
  currentBid: number;        // 当前实际bid
  targetBid: number;         // 目标bid（suggested_bid或anchor_bid）
  anchorBid: number;
  driftPercent: number;
  correctionAction: string;
  reason: string;
}
// ============================================================
// 主入口
// ============================================================
export async function executeAggressiveBleedingStop(options: {
  dryRun?: boolean;
  accountIds?: number[];
  dimensions?: ("bid" | "hourparting" | "dayparting" | "placement")[];
}) {
  const t0 = Date.now();
  const dryRun = options.dryRun ?? true;
  const dims = options.dimensions ?? ["bid", "hourparting", "dayparting", "placement"];
  log.info(`[v727] 激进止血 ${dryRun ? "[DRY RUN]" : "[LIVE]"}  维度: ${dims.join(",")}`);
  const db = await getDb();
  if (!db) throw new Error("数据库连接失败");
  const bidResult = dims.includes("bid")
    ? await fixBidsFromAnchorAnalysis(db, dryRun, options.accountIds)
    : emptyResult("bid");
  const hpResult = dims.includes("hourparting")
    ? await fixHourpartingMultipliers(db, dryRun)
    : emptyResult("hourparting");
  const dpResult = dims.includes("dayparting")
    ? await fixDaypartingMultipliers(db, dryRun)
    : emptyResult("dayparting");
  const plResult = dims.includes("placement")
    ? await fixPlacements(db, dryRun)
    : emptyResult("placement");
  const ms = Date.now() - t0;
  const summary = {
    totalCorrected:
      bidResult.corrected + hpResult.corrected + dpResult.corrected + plResult.corrected,
    totalFailed:
      bidResult.failed + hpResult.failed + dpResult.failed + plResult.failed,
    totalApiPushed:
      bidResult.apiPushed + plResult.apiPushed,
    totalApiFailed:
      bidResult.apiFailed + plResult.apiFailed,
    totalProtectionRecords:
      bidResult.protectionRecords + plResult.protectionRecords,
    executionTimeMs: ms,
    isDryRun: dryRun,
  };
  log.info(`[v727] 止血完成 ${ms}ms  纠正=${summary.totalCorrected}  API推送=${summary.totalApiPushed}  API失败=${summary.totalApiFailed}  保护记录=${summary.totalProtectionRecords}  失败=${summary.totalFailed}`);
  return {
    bidResult,
    hourpartingResult: hpResult,
    daypartingResult: dpResult,
    placementResult: plResult,
    overallSummary: summary,
  };
}
// ============================================================
// 带重试的API调用包装器
// ============================================================
async function callApiWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= API_CONFIG.apiRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isThrottle = err?.response?.status === 429 || err?.message?.includes('Too Many Requests');
      const isServerError = err?.response?.status >= 500;
      if (attempt < API_CONFIG.apiRetries && (isThrottle || isServerError)) {
        const delay = API_CONFIG.apiRetryDelayMs * (attempt + 1);
        log.warn(`    [API] ${label} 第${attempt + 1}次重试（${isThrottle ? '限流' : '服务器错误'}），等待${delay}ms`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error(`${label}: 所有重试均失败`);
}
// ============================================================
// v727: 批量插入同步保护记录到 optimization_events
// ============================================================
async function insertProtectionRecords(
  db: any,
  updates: AnchorBidUpdate[],
  dryRun: boolean,
): Promise<number> {
  if (dryRun || updates.length === 0) return 0;

  let inserted = 0;

  // v728: 双策略插入 — 主路径用Drizzle ORM(@ts-expect-error)，降级用原始SQL
  for (const batch of chunk(updates, API_CONFIG.protectionBatchSize)) {
    try {
      // 策略A: 使用Drizzle ORM insert（与bidAdjustment.ts一致的已验证方式）
      const values = batch.map(u => ({
        accountId: u.accountId,
        eventCategory: 'bid_adjustment',
        actionType: 'auto_correction',
        keywordId: u.entityType === 'keyword' ? String(u.internalId) : null,
        targetId: u.entityType === 'product_target' ? String(u.internalId) : null,
        previousBid: String(u.currentBid),
        newBid: String(u.targetBid),
        bidChangePercent: String(
          u.currentBid > 0
            ? Math.round(((u.targetBid - u.currentBid) / u.currentBid) * 10000) / 100
            : 0
        ),
        changeReason: `[v728止血] ${u.reason}`,
        algorithmVersion: 'v728-bleeding-stop',
        status: 'success',
        apiSyncStatus: 'synced',
      }));

      // @ts-expect-error - Drizzle ENUM类型验证与实际DB字符串值不匹配，但插入可正常工作
      await db.insert(optimizationEvents).values(values);
      inserted += batch.length;
      log.info(`  [v728] 保护记录批次插入成功(Drizzle): ${batch.length}条`);
    } catch (err: any) {
      log.warn(`  [v728] Drizzle批量插入失败(${batch.length}条): ${err.message}`);
      // 策略B降级: 逐条使用原始SQL插入
      for (const u of batch) {
        try {
          const kwId = u.entityType === 'keyword' ? String(u.internalId) : null;
          const tgtId = u.entityType === 'product_target' ? String(u.internalId) : null;
          const pct = u.currentBid > 0
            ? String(Math.round(((u.targetBid - u.currentBid) / u.currentBid) * 10000) / 100)
            : '0';
          const reason = `[v728止血] ${u.reason}`;
          await db.execute(
            sql`INSERT INTO optimization_events 
              (account_id, event_category, action_type, keyword_id, target_id,
               previous_bid, new_bid, bid_change_percent, change_reason,
               algorithm_version, api_sync_status, status, created_at, executed_at)
              VALUES (${u.accountId}, 'bid_adjustment', 'auto_correction', 
                ${kwId}, ${tgtId}, ${String(u.currentBid)}, ${String(u.targetBid)},
                ${pct}, ${reason}, 'v728-bleeding-stop', 'synced', 'success',
                NOW(), NOW())`
          );
          inserted++;
        } catch (singleErr: any) {
          log.warn(`  [v728] 单条原始SQL插入失败(${u.entityType}=${u.internalId}): ${singleErr.message}`);
        }
      }
    }
  }

  log.info(`  [v728] 同步保护记录插入完成: ${inserted}/${updates.length}`);
  return inserted;
}

/**
 * v727: 为位置倾斜修正插入保护记录
 */
async function insertPlacementProtectionRecord(
  db: any,
  accountId: number,
  campaignId: string,
  campaignName: string,
  previousValue: string,
  newValue: string,
): Promise<boolean> {
  try {
    // v728: 使用原始SQL插入，绕过Drizzle的ENUM验证
    await db.execute(
      sql`INSERT INTO optimization_events 
        (account_id, event_category, action_type, campaign_id, campaign_name,
         previous_value, new_value, change_reason, algorithm_version,
         api_sync_status, status, created_at, executed_at)
        VALUES (${accountId}, 'placement_adjustment', 'placement_adjust',
          ${String(campaignId)}, ${campaignName}, ${previousValue}, ${newValue},
          '[v728止血] 位置倾斜修正', 'v728-bleeding-stop', 'synced', 'success',
          NOW(), NOW())`
    );
    return true;
  } catch (err: any) {
    log.warn(`  [v728] 位置倾斜保护记录插入失败(campaign=${campaignId}): ${err.message}`);
    return false;
  }
}

// ============================================================
// 维度 1 — 基于bid_anchor_analysis的竞价纠正（含Amazon API推送 + 同步保护）
// ============================================================
async function fixBidsFromAnchorAnalysis(db: any, dryRun: boolean, accountIds?: number[]): Promise<PhaseResult> {
  log.info("[v727] --- 维度1: 基于bid_anchor_analysis的竞价纠正 ---");
  const res = emptyResult("bid");

  // ---- A. 查询所有pending记录 ----
  const pendingRows = await db
    .select({
      id: bidAnchorAnalysis.id,
      accountId: bidAnchorAnalysis.accountId,
      entityType: bidAnchorAnalysis.entityType,
      keywordId: bidAnchorAnalysis.keywordId,
      targetId: bidAnchorAnalysis.targetId,
      currentBid: bidAnchorAnalysis.currentBid,
      anchorBid: bidAnchorAnalysis.anchorBid,
      suggestedBid: bidAnchorAnalysis.suggestedBid,
      bidDriftPercent: bidAnchorAnalysis.bidDriftPercent,
      correctionAction: bidAnchorAnalysis.correctionAction,
    })
    .from(bidAnchorAnalysis)
    .where(eq(bidAnchorAnalysis.correctionStatus, 'pending'));

  log.info(`  pending记录总数: ${pendingRows.length}`);

  // ---- B. 分离keyword和product_target记录 ----
  const kwPending = pendingRows.filter((r: any) => r.entityType === 'keyword' && r.keywordId);
  const ptPending = pendingRows.filter((r: any) => r.entityType === 'product_target' && r.targetId);
  log.info(`  keyword pending: ${kwPending.length}, product_target pending: ${ptPending.length}`);

  // ---- C. 批量查询Amazon ID映射 ----
  const kwInternalIds = kwPending.map((r: any) => r.keywordId).filter(Boolean);
  const ptInternalIds = ptPending.map((r: any) => r.targetId).filter(Boolean);

  // 查询keywords表获取Amazon keywordId和当前实际bid
  const kwIdMap: Record<number, { amazonId: string; actualBid: number }> = {};
  if (kwInternalIds.length > 0) {
    for (const idBatch of chunk(kwInternalIds, 1000)) {
      const rows = await db
        .select({ id: keywords.id, keywordId: keywords.keywordId, bid: keywords.bid })
        .from(keywords)
        .where(inArray(keywords.id, idBatch));
      for (const r of rows) {
        kwIdMap[r.id] = {
          amazonId: r.keywordId || '',
          actualBid: parseFloat(r.bid || '0'),
        };
      }
    }
  }

  // 查询product_targets表获取Amazon targetId和当前实际bid
  const ptIdMap: Record<number, { amazonId: string; actualBid: number }> = {};
  if (ptInternalIds.length > 0) {
    for (const idBatch of chunk(ptInternalIds, 1000)) {
      const rows = await db
        .select({ id: productTargets.id, targetId: productTargets.targetId, bid: productTargets.bid })
        .from(productTargets)
        .where(inArray(productTargets.id, idBatch));
      for (const r of rows) {
        ptIdMap[r.id] = {
          amazonId: r.targetId || '',
          actualBid: parseFloat(r.bid || '0'),
        };
      }
    }
  }

  log.info(`  Amazon ID映射: KW=${Object.keys(kwIdMap).length}, PT=${Object.keys(ptIdMap).length}`);

  // ---- D. 构建需要修正的列表 ----
  const bidUpdates: AnchorBidUpdate[] = [];

  for (const row of kwPending) {
    if (accountIds && accountIds.length > 0 && !accountIds.includes(row.accountId)) continue;
    const kwInfo = kwIdMap[row.keywordId];
    if (!kwInfo || !kwInfo.amazonId) {
      res.skipped++;
      continue;
    }
    const suggested = Number(row.suggestedBid) || 0;
    const anchor = Number(row.anchorBid) || 0;
    const targetBid = suggested > 0 ? suggested : anchor;
    if (targetBid <= 0) {
      res.skipped++;
      continue;
    }
    const actualBid = kwInfo.actualBid;
    const drift = Number(row.bidDriftPercent) || 0;
    if (Math.abs(actualBid - targetBid) < 0.01) {
      res.skipped++;
      continue;
    }
    const clampedTarget = Math.max(HEALTH.bid.absoluteMin, Math.min(HEALTH.bid.absoluteMax, targetBid));
    const finalTarget = Math.round(clampedTarget * 100) / 100;
    res.analyzed++;
    bidUpdates.push({
      analysisId: row.id,
      internalId: row.keywordId,
      amazonId: kwInfo.amazonId,
      accountId: row.accountId,
      entityType: 'keyword',
      currentBid: actualBid,
      targetBid: finalTarget,
      anchorBid: anchor,
      driftPercent: drift,
      correctionAction: row.correctionAction || 'gradual_restore',
      reason: `anchor=${anchor.toFixed(4)} drift=${drift.toFixed(1)}% → target=${finalTarget.toFixed(2)}`,
    });
  }

  for (const row of ptPending) {
    if (accountIds && accountIds.length > 0 && !accountIds.includes(row.accountId)) continue;
    const ptInfo = ptIdMap[row.targetId];
    if (!ptInfo || !ptInfo.amazonId) {
      res.skipped++;
      continue;
    }
    const suggested = Number(row.suggestedBid) || 0;
    const anchor = Number(row.anchorBid) || 0;
    const targetBid = suggested > 0 ? suggested : anchor;
    if (targetBid <= 0) {
      res.skipped++;
      continue;
    }
    const actualBid = ptInfo.actualBid;
    const drift = Number(row.bidDriftPercent) || 0;
    if (Math.abs(actualBid - targetBid) < 0.01) {
      res.skipped++;
      continue;
    }
    const clampedTarget = Math.max(HEALTH.bid.absoluteMin, Math.min(HEALTH.bid.absoluteMax, targetBid));
    const finalTarget = Math.round(clampedTarget * 100) / 100;
    res.analyzed++;
    bidUpdates.push({
      analysisId: row.id,
      internalId: row.targetId,
      amazonId: ptInfo.amazonId,
      accountId: row.accountId,
      entityType: 'product_target',
      currentBid: actualBid,
      targetBid: finalTarget,
      anchorBid: anchor,
      driftPercent: drift,
      correctionAction: row.correctionAction || 'gradual_restore',
      reason: `anchor=${anchor.toFixed(4)} drift=${drift.toFixed(1)}% → target=${finalTarget.toFixed(2)}`,
    });
  }

  const ptCount = bidUpdates.filter(u => u.entityType === 'product_target').length;
  const kwCount = bidUpdates.filter(u => u.entityType === 'keyword').length;
  log.info(`  需修正竞价总数: ${bidUpdates.length} (PT: ${ptCount}, KW: ${kwCount})`);

  if (dryRun) {
    res.corrected = bidUpdates.length;
    logResult("竞价纠正(anchor) [DRY RUN]", res);
    return res;
  }

  // ---- E. LIVE模式：按accountId分组，推送Amazon API + 批量更新本地数据库 ----
  const byAccount = groupBy(bidUpdates, u => u.accountId);
  log.info(`  涉及账号数: ${Object.keys(byAccount).length}`);

  // 收集所有成功修正的updates，用于最后批量插入保护记录
  const successfulUpdates: AnchorBidUpdate[] = [];

  for (const [accountIdStr, updates] of Object.entries(byAccount)) {
    const accountId = Number(accountIdStr);
    const ptUpdates = updates.filter(u => u.entityType === 'product_target');
    const kwUpdates = updates.filter(u => u.entityType === 'keyword');
    log.info(`  [账号${accountId}] PT=${ptUpdates.length}, KW=${kwUpdates.length}`);

    // Step 1: 获取Amazon API客户端
    let syncService: any = null;
    try {
      syncService = await getAmazonSyncService(accountId);
      if (!syncService || !syncService.client) {
        log.warn(`  [账号${accountId}] API客户端不可用，仅更新本地数据库`);
        res.apiErrors.push(`账号${accountId}: API客户端不可用`);
        syncService = null;
      } else {
        log.info(`  [账号${accountId}] API客户端初始化成功`);
      }
    } catch (err: any) {
      log.warn(`  [账号${accountId}] 获取API客户端失败: ${err.message}`);
      res.apiErrors.push(`账号${accountId}: ${err.message}`);
      syncService = null;
    }

    // Step 2: 推送 Product Target 竞价到 Amazon API
    if (ptUpdates.length > 0) {
      for (const batch of chunk(ptUpdates, API_CONFIG.batchSize)) {
        if (syncService) {
          try {
            const apiPayload = batch.map(u => ({
              targetId: u.amazonId,
              bid: u.targetBid,
            }));
            const result: any = await callApiWithRetry(
              () => syncService.client.updateProductTargetBids(apiPayload),
              `账号${accountId} PT竞价(anchor) ${batch.length}条`
            );
            const errorCount = result?.errors?.length || 0;
            const batchSuccess = batch.length - errorCount;
            res.apiPushed += batchSuccess;
            if (errorCount > 0) {
              res.apiFailed += errorCount;
              log.warn(`    [API] PT竞价批次: 成功=${batchSuccess}, 失败=${errorCount}`);
            } else {
              log.info(`    [API] PT竞价批次推送成功: ${batchSuccess}/${batch.length}`);
            }
          } catch (apiErr: any) {
            res.apiFailed += batch.length;
            const errMsg = `账号${accountId} PT API失败: ${apiErr.message}`;
            log.warn(`    [API] ${errMsg}`);
            res.apiErrors.push(errMsg);
          }
          await sleep(API_CONFIG.batchDelayMs);
        }
      }
      // 批量SQL更新本地数据库
      try {
        await batchUpdateBids(db, 'product_targets', ptUpdates);
        res.corrected += ptUpdates.length;
        successfulUpdates.push(...ptUpdates);  // v727: 记录成功修正
        log.info(`    [DB] PT本地批量更新成功: ${ptUpdates.length}条`);
      } catch (dbErr: any) {
        log.error(`    [DB] PT本地批量更新失败: ${dbErr.message}`);
        res.failed += ptUpdates.length;
      }
    }

    // Step 3: 推送 Keyword 竞价到 Amazon API
    if (kwUpdates.length > 0) {
      for (const batch of chunk(kwUpdates, API_CONFIG.batchSize)) {
        if (syncService) {
          try {
            const apiPayload = batch.map(u => ({
              keywordId: u.amazonId,
              bid: u.targetBid,
            }));
            const result: any = await callApiWithRetry(
              () => syncService.client.updateKeywordBids(apiPayload),
              `账号${accountId} KW竞价(anchor) ${batch.length}条`
            );
            const errorCount = result?.errors?.length || 0;
            const batchSuccess = batch.length - errorCount;
            res.apiPushed += batchSuccess;
            if (errorCount > 0) {
              res.apiFailed += errorCount;
              log.warn(`    [API] KW竞价批次: 成功=${batchSuccess}, 失败=${errorCount}`);
            } else {
              log.info(`    [API] KW竞价批次推送成功: ${batchSuccess}/${batch.length}`);
            }
          } catch (apiErr: any) {
            res.apiFailed += batch.length;
            const errMsg = `账号${accountId} KW API失败: ${apiErr.message}`;
            log.warn(`    [API] ${errMsg}`);
            res.apiErrors.push(errMsg);
          }
          await sleep(API_CONFIG.batchDelayMs);
        }
      }
      // 批量SQL更新本地数据库
      try {
        await batchUpdateBids(db, 'keywords', kwUpdates);
        res.corrected += kwUpdates.length;
        successfulUpdates.push(...kwUpdates);  // v727: 记录成功修正
        log.info(`    [DB] KW本地批量更新成功: ${kwUpdates.length}条`);
      } catch (dbErr: any) {
        log.error(`    [DB] KW本地批量更新失败: ${dbErr.message}`);
        res.failed += kwUpdates.length;
      }
    }

    // Step 4: 更新 bid_anchor_analysis 中对应记录的状态为 applied
    try {
      const allAnalysisIds = updates.map(u => u.analysisId);
      for (const idBatch of chunk(allAnalysisIds, 500)) {
        await db
          .update(bidAnchorAnalysis)
          .set({
            correctionStatus: "applied" as const,
            appliedAt: sql`NOW()`,
          })
          .where(
            inArray(bidAnchorAnalysis.id, idBatch)
          );
      }
      log.info(`    [DB] bid_anchor_analysis状态更新: ${allAnalysisIds.length}条 → applied`);
    } catch (e: any) {
      log.warn(`  [账号${accountId}] 更新bid_anchor_analysis状态失败: ${e.message}`);
    }
  }

  // ---- F. v727: 批量插入同步保护记录 ----
  if (successfulUpdates.length > 0) {
    log.info(`  [v727] 开始插入同步保护记录: ${successfulUpdates.length}条`);
    const protectionCount = await insertProtectionRecords(db, successfulUpdates, dryRun);
    res.protectionRecords = protectionCount;
    log.info(`  [v727] 同步保护记录插入完成: ${protectionCount}/${successfulUpdates.length}`);
  }

  // ---- G. 将不可操作的pending记录标记为skipped ----
  const notActionableRows = pendingRows.filter((r: any) => {
    const suggested = Number(r.suggestedBid) || 0;
    const anchor = Number(r.anchorBid) || 0;
    return suggested <= 0 && anchor <= 0;
  });
  if (notActionableRows.length > 0) {
    try {
      const notActionableIds = notActionableRows.map((r: any) => r.id);
      for (const idBatch of chunk(notActionableIds, 500)) {
        await db
          .update(bidAnchorAnalysis)
          .set({
            correctionStatus: "skipped" as const,
            correctionReason: "anchor_bid和suggested_bid均为0，无法纠正",
          })
          .where(
            inArray(bidAnchorAnalysis.id, idBatch)
          );
      }
      log.info(`    [DB] 不可操作记录标记为skipped: ${notActionableIds.length}条`);
    } catch (e: any) {
      log.warn(`  标记不可操作记录失败: ${e.message}`);
    }
  }

  logResult("竞价纠正(anchor) [LIVE]", res);
  return res;
}

/**
 * v725.1修复: 批量SQL更新bid — 使用原生SQL CASE WHEN批量更新
 * 去掉updated_at = NOW()，因为DB列名是updatedAt且有ON UPDATE CURRENT_TIMESTAMP
 */
async function batchUpdateBids(db: any, tableName: 'product_targets' | 'keywords', updates: AnchorBidUpdate[]) {
  for (const batch of chunk(updates, API_CONFIG.dbBatchSize)) {
    const caseWhen = batch.map(u => `WHEN ${u.internalId} THEN ${u.targetBid.toFixed(2)}`).join(' ');
    const ids = batch.map(u => u.internalId).join(',');
    
    await db.execute(sql.raw(
      `UPDATE ${tableName} SET bid = CASE id ${caseWhen} END WHERE id IN (${ids})`
    ));
  }
}

// ============================================================
// 维度 2 — 分时竞价乘数纠正（系统内部调度表，数据库修改即可）
// ============================================================
async function fixHourpartingMultipliers(db: any, dryRun: boolean): Promise<PhaseResult> {
  log.info("[v727] --- 维度2: 分时竞价乘数纠正 ---");
  const res = emptyResult("hourparting");
  const { extremeHighTarget, extremeLowTarget } = HEALTH.hourparting;
  const highRows = await db
    .select({ id: hourpartingBidRules.id, bidMultiplier: hourpartingBidRules.bidMultiplier })
    .from(hourpartingBidRules)
    .where(gt(hourpartingBidRules.bidMultiplier, sql`1.50`));
  const lowRows = await db
    .select({ id: hourpartingBidRules.id, bidMultiplier: hourpartingBidRules.bidMultiplier })
    .from(hourpartingBidRules)
    .where(lt(hourpartingBidRules.bidMultiplier, sql`0.50`));
  res.analyzed = highRows.length + lowRows.length;
  log.info(`  极端高(>1.50): ${highRows.length}  极端低(<0.50): ${lowRows.length}`);
  if (highRows.length > 0) {
    if (!dryRun) {
      const ids = highRows.map((r: any) => r.id);
      for (const batch of chunk(ids, 500)) {
        await db
          .update(hourpartingBidRules)
          .set({ bidMultiplier: extremeHighTarget.toFixed(2) })
          .where(inArray(hourpartingBidRules.id, batch));
      }
    }
    for (const r of highRows) {
      res.details.push({
        entityType: "hourparting_rule",
        entityId: r.id,
        dimension: "bid_multiplier",
        oldValue: Number(r.bidMultiplier),
        newValue: extremeHighTarget,
        changePct: ((extremeHighTarget - Number(r.bidMultiplier)) / Number(r.bidMultiplier)) * 100,
        reason: `乘数${r.bidMultiplier}x→${extremeHighTarget}x`,
      });
    }
    res.corrected += highRows.length;
  }
  if (lowRows.length > 0) {
    if (!dryRun) {
      const ids = lowRows.map((r: any) => r.id);
      for (const batch of chunk(ids, 500)) {
        await db
          .update(hourpartingBidRules)
          .set({ bidMultiplier: extremeLowTarget.toFixed(2) })
          .where(inArray(hourpartingBidRules.id, batch));
      }
    }
    for (const r of lowRows) {
      res.details.push({
        entityType: "hourparting_rule",
        entityId: r.id,
        dimension: "bid_multiplier",
        oldValue: Number(r.bidMultiplier),
        newValue: extremeLowTarget,
        changePct: ((extremeLowTarget - Number(r.bidMultiplier)) / Number(r.bidMultiplier)) * 100,
        reason: `乘数${r.bidMultiplier}x→${extremeLowTarget}x`,
      });
    }
    res.corrected += lowRows.length;
  }
  logResult("分时竞价乘数纠正", res);
  return res;
}

// ============================================================
// 维度 3 — 分时预算乘数纠正（系统内部调度表，数据库修改即可）
// ============================================================
async function fixDaypartingMultipliers(db: any, dryRun: boolean): Promise<PhaseResult> {
  log.info("[v727] --- 维度3: 分时预算乘数纠正 ---");
  const res = emptyResult("dayparting");
  const { extremeHighTarget, extremeLowTarget } = HEALTH.dayparting;
  const highRows = await db
    .select({ id: daypartingBudgetRules.id, budgetMultiplier: daypartingBudgetRules.budgetMultiplier })
    .from(daypartingBudgetRules)
    .where(gt(daypartingBudgetRules.budgetMultiplier, sql`1.50`));
  const lowRows = await db
    .select({ id: daypartingBudgetRules.id, budgetMultiplier: daypartingBudgetRules.budgetMultiplier })
    .from(daypartingBudgetRules)
    .where(lt(daypartingBudgetRules.budgetMultiplier, sql`0.50`));
  res.analyzed = highRows.length + lowRows.length;
  log.info(`  极端高(>1.50): ${highRows.length}  极端低(<0.50): ${lowRows.length}`);
  if (highRows.length > 0) {
    if (!dryRun) {
      const ids = highRows.map((r: any) => r.id);
      for (const batch of chunk(ids, 500)) {
        await db
          .update(daypartingBudgetRules)
          .set({ budgetMultiplier: extremeHighTarget.toFixed(2) })
          .where(inArray(daypartingBudgetRules.id, batch));
      }
    }
    for (const r of highRows) {
      res.details.push({
        entityType: "dayparting_budget_rule",
        entityId: r.id,
        dimension: "budget_multiplier",
        oldValue: Number(r.budgetMultiplier),
        newValue: extremeHighTarget,
        changePct: ((extremeHighTarget - Number(r.budgetMultiplier)) / Number(r.budgetMultiplier)) * 100,
        reason: `预算乘数${r.budgetMultiplier}x→${extremeHighTarget}x`,
      });
    }
    res.corrected += highRows.length;
  }
  if (lowRows.length > 0) {
    if (!dryRun) {
      const ids = lowRows.map((r: any) => r.id);
      for (const batch of chunk(ids, 500)) {
        await db
          .update(daypartingBudgetRules)
          .set({ budgetMultiplier: extremeLowTarget.toFixed(2) })
          .where(inArray(daypartingBudgetRules.id, batch));
      }
    }
    for (const r of lowRows) {
      res.details.push({
        entityType: "dayparting_budget_rule",
        entityId: r.id,
        dimension: "budget_multiplier",
        oldValue: Number(r.budgetMultiplier),
        newValue: extremeLowTarget,
        changePct: ((extremeLowTarget - Number(r.budgetMultiplier)) / Number(r.budgetMultiplier)) * 100,
        reason: `预算乘数${r.budgetMultiplier}x→${extremeLowTarget}x`,
      });
    }
    res.corrected += lowRows.length;
  }
  logResult("分时预算乘数纠正", res);
  return res;
}

// ============================================================
// 维度 4 — 位置倾斜纠正（含Amazon API推送 + 同步保护）
// ============================================================
async function fixPlacements(db: any, dryRun: boolean): Promise<PhaseResult> {
  log.info("[v727] --- 维度4: 位置倾斜纠正 ---");
  const res = emptyResult("placement");
  const cap = HEALTH.placement.maxHealthy;

  const rows = await db
    .select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      campaignType: campaigns.campaignType,
      accountId: campaigns.accountId,
      topAdj: campaigns.placementTopSearchBidAdjustment,
      ppAdj: campaigns.placementProductPageBidAdjustment,
      restAdj: campaigns.placementRestBidAdjustment,
    })
    .from(campaigns)
    .where(
      or(
        gt(campaigns.placementTopSearchBidAdjustment, cap),
        gt(campaigns.placementProductPageBidAdjustment, cap),
        gt(campaigns.placementRestBidAdjustment, cap),
      )
    );

  res.analyzed = rows.length;
  log.info(`  位置倾斜>50%的campaign数: ${rows.length}`);

  if (dryRun) {
    for (const row of rows) {
      collectPlacementDetails(res, row, cap);
    }
    res.corrected = rows.length;
    logResult("位置倾斜纠正 [DRY RUN]", res);
    return res;
  }

  // LIVE模式：按accountId分组
  const byAccount = groupBy(rows, (r: any) => r.accountId);

  for (const [accountIdStr, accountRows] of Object.entries(byAccount)) {
    const accountId = Number(accountIdStr);
    let syncService: any = null;
    try {
      syncService = await getAmazonSyncService(accountId);
      if (!syncService || !syncService.client) {
        log.warn(`  [账号${accountId}] 位置倾斜API客户端不可用，仅更新本地DB`);
        res.apiErrors.push(`账号${accountId}: API客户端不可用`);
        syncService = null;
      } else {
        log.info(`  [账号${accountId}] 位置倾斜API客户端初始化成功`);
      }
    } catch (err: any) {
      log.warn(`  [账号${accountId}] 获取API客户端失败: ${err.message}`);
      res.apiErrors.push(`账号${accountId}: ${err.message}`);
      syncService = null;
    }

    for (const row of accountRows as any[]) {
      const top = Number(row.topAdj) || 0;
      const pp = Number(row.ppAdj) || 0;
      const rest = Number(row.restAdj) || 0;
      const dbUpdates: Record<string, number> = {};
      const newTop = top > cap ? cap : top;
      const newPp = pp > cap ? cap : pp;
      const newRest = rest > cap ? cap : rest;
      let needsUpdate = false;
      if (top > cap) { dbUpdates.placementTopSearchBidAdjustment = cap; needsUpdate = true; }
      if (pp > cap) { dbUpdates.placementProductPageBidAdjustment = cap; needsUpdate = true; }
      if (rest > cap) { dbUpdates.placementRestBidAdjustment = cap; needsUpdate = true; }
      if (!needsUpdate) continue;
      collectPlacementDetails(res, row, cap);

      // 推送到 Amazon API（仅SP广告支持位置倾斜）
      if (syncService && (row.campaignType === 'sp_auto' || row.campaignType === 'sp_manual')) {
        try {
          const placementBidding: Array<{ placement: string; percentage: number }> = [];
          if (newTop > 0) {
            placementBidding.push({ placement: 'PLACEMENT_TOP', percentage: Math.round(newTop) });
          }
          if (newPp > 0) {
            placementBidding.push({ placement: 'PLACEMENT_PRODUCT_PAGE', percentage: Math.round(newPp) });
          }
          await callApiWithRetry(
            () => syncService.client.updateSpCampaign(String(row.campaignId), {
              dynamicBidding: {
                placementBidding,
              },
            }),
            `Campaign ${row.campaignId} 位置倾斜`
          );
          res.apiPushed++;
          log.info(`    [API] Campaign ${row.campaignId} (${row.campaignName}) 位置倾斜推送成功: Top=${top}%→${newTop}%, PP=${pp}%→${newPp}%`);
        } catch (apiErr: any) {
          res.apiFailed++;
          const errMsg = `Campaign ${row.campaignId} 位置倾斜API失败: ${apiErr.message}`;
          log.warn(`    [API] ${errMsg}`);
          res.apiErrors.push(errMsg);
        }
        await sleep(API_CONFIG.batchDelayMs);
      } else if (!syncService) {
        log.warn(`    [API] Campaign ${row.campaignId} 跳过API推送（无客户端），仅更新本地DB`);
      }

      // 更新本地数据库
      try {
        await db
          .update(campaigns)
          .set(dbUpdates as any)
          .where(eq(campaigns.id, row.id));
        res.corrected++;
        log.info(`    [DB] Campaign ${row.campaignId} 本地更新成功`);

        // v727: 插入位置倾斜保护记录
        const prevStr = `Top=${top}%, PP=${pp}%, Rest=${rest}%`;
        const newStr = `Top=${newTop}%, PP=${newPp}%, Rest=${newRest}%`;
        const inserted = await insertPlacementProtectionRecord(
          db, accountId, String(row.campaignId), row.campaignName || '', prevStr, newStr
        );
        if (inserted) res.protectionRecords++;
      } catch (e: any) {
        log.error(`    [DB] Campaign ${row.campaignId} 本地更新失败: ${e.message}`);
        res.failed++;
      }
    }
  }

  logResult("位置倾斜纠正 [LIVE]", res);
  return res;
}

function collectPlacementDetails(res: PhaseResult, row: any, cap: number) {
  const top = Number(row.topAdj) || 0;
  const pp = Number(row.ppAdj) || 0;
  const rest = Number(row.restAdj) || 0;
  if (top > cap) {
    res.details.push({
      entityType: "campaign", entityId: row.campaignId, accountId: row.accountId,
      dimension: "top_of_search", oldValue: top, newValue: cap,
      changePct: ((cap - top) / Math.max(top, 1)) * 100,
      reason: `搜索顶部${top}%→${cap}%`,
    });
  }
  if (pp > cap) {
    res.details.push({
      entityType: "campaign", entityId: row.campaignId, accountId: row.accountId,
      dimension: "product_page", oldValue: pp, newValue: cap,
      changePct: ((cap - pp) / Math.max(pp, 1)) * 100,
      reason: `商品页面${pp}%→${cap}%`,
    });
  }
  if (rest > cap) {
    res.details.push({
      entityType: "campaign", entityId: row.campaignId, accountId: row.accountId,
      dimension: "rest_of_search", oldValue: rest, newValue: cap,
      changePct: ((cap - rest) / Math.max(rest, 1)) * 100,
      reason: `其他搜索${rest}%→${cap}%`,
    });
  }
}

// ============================================================
// 工具函数
// ============================================================
function emptyResult(phase: string): PhaseResult {
  return { phase, analyzed: 0, corrected: 0, skipped: 0, failed: 0, apiPushed: 0, apiFailed: 0, protectionRecords: 0, details: [], apiErrors: [] };
}
function logResult(name: string, r: PhaseResult) {
  log.info(`  ${name}: 分析=${r.analyzed} 纠正=${r.corrected} 跳过=${r.skipped} 失败=${r.failed} API推送=${r.apiPushed} API失败=${r.apiFailed} 保护=${r.protectionRecords}`);
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function groupBy<T>(arr: T[], keyFn: (item: T) => string | number): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const item of arr) {
    const key = String(keyFn(item));
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  return map;
}
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
export default executeAggressiveBleedingStop;
