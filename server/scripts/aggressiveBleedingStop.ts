/**
 * aggressiveBleedingStop.ts — v721
 * 
 * 两阶段纠正策略 - 第一阶段：激进止血
 * 
 * 将所有严重偏离健康基线的实体一次性拉回安全范围，
 * 然后由v720的渐进式优化模式接管后续微调。
 * 
 * 覆盖四个维度：
 * 1. 投放词/ASIN竞价 → 回归到建议竞价/锚点竞价范围
 * 2. 分时竞价乘数 → 回归到 0.80~1.20
 * 3. 分时预算乘数 → 回归到 0.70~1.30
 * 4. 位置倾斜 → 回归到 0%~50%
 */

import { getDb } from '../db';
import {
  productTargets,
  campaigns,
  bidAnchorAnalysis,
  daypartingBudgetRules,
  hourpartingBidRules,
} from '../../drizzle/schema';
import { eq, and, gt, lt, or, isNotNull, inArray, sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('AggressiveBleedingStop');

// ============================================================
// 健康基线配置
// ============================================================
const HEALTH = {
  bid: {
    // 偏离 >200% → 一次性降到基线 × 1.20
    criticalOverBuffer: 1.20,
    // 偏离 100-200% → 一次性降到基线 × 1.30
    severeOverBuffer: 1.30,
    // 偏离 50-100% → 第一步降到基线 × 1.50（第二步由v720接管）
    moderateOverFirstStep: 1.50,
    // 竞价过低 <-50% → 一次性提到基线 × 0.80
    criticalUnderBuffer: 0.80,
    // 竞价过低 -50%~-30% → 一次性提到基线 × 0.85
    moderateUnderBuffer: 0.85,
    // 绝对边界
    absoluteMin: 0.02,
    absoluteMax: 10.00,
  },
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
  details: CorrectionDetail[];
}

interface CorrectionDetail {
  entityType: string;
  entityId: string | number;
  dimension: string;
  oldValue: number;
  newValue: number;
  changePct: number;
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

  log.info(`激进止血 ${dryRun ? "[DRY RUN]" : "[LIVE]"}  维度: ${dims.join(",")}`);

  const db = await getDb();
  if (!db) throw new Error("数据库连接失败");

  const bidResult = dims.includes("bid")
    ? await fixBids(db, dryRun, options.accountIds)
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
    executionTimeMs: ms,
    isDryRun: dryRun,
  };

  log.info(`止血完成 ${ms}ms  纠正=${summary.totalCorrected}  失败=${summary.totalFailed}`);

  return {
    bidResult,
    hourpartingResult: hpResult,
    daypartingResult: dpResult,
    placementResult: plResult,
    overallSummary: summary,
  };
}

// ============================================================
// 维度 1 — 竞价纠正
// ============================================================
async function fixBids(db: any, dryRun: boolean, accountIds?: number[]): Promise<PhaseResult> {
  log.info("--- 维度1: 竞价纠正 ---");
  const res = emptyResult("bid");

  // ---- A. 从 bid_anchor_analysis 获取有锚点的 pending 实体 ----
  const anchorRows = await db
    .select({
      id: bidAnchorAnalysis.id,
      entityType: bidAnchorAnalysis.entityType,
      targetId: bidAnchorAnalysis.targetId,
      keywordId: bidAnchorAnalysis.keywordId,
      accountId: bidAnchorAnalysis.accountId,
      currentBid: bidAnchorAnalysis.currentBid,
      anchorBid: bidAnchorAnalysis.anchorBid,
      suggestedBid: bidAnchorAnalysis.suggestedBid,
      correctionAction: bidAnchorAnalysis.correctionAction,
      dataConfidence: bidAnchorAnalysis.dataConfidence,
    })
    .from(bidAnchorAnalysis)
    .where(eq(bidAnchorAnalysis.correctionStatus, "pending"));

  log.info(`  锚点 pending: ${anchorRows.length}`);

  // ---- B. 从 product_targets 获取有建议竞价的活跃实体 ----
  const ptRows = await db
    .select({
      id: productTargets.id,
      targetId: productTargets.targetId,
      accountId: productTargets.accountId,
      bid: productTargets.bid,
      suggestedBid: productTargets.suggestedBid,
      suggestedBidHigh: productTargets.suggestedBidHigh,
      suggestedBidLow: productTargets.suggestedBidLow,
    })
    .from(productTargets)
    .where(
      and(
        eq(productTargets.targetStatus, "enabled"),
        isNotNull(productTargets.suggestedBid),
        gt(productTargets.bid, sql`0`)
      )
    );

  log.info(`  活跃产品目标(有建议竞价): ${ptRows.length}`);

  // ---- 合并：锚点优先 ----
  const anchorEntitySet = new Set(
    anchorRows.map((r: any) => `${r.entityType}_${r.targetId ?? r.keywordId}`)
  );

  // 处理锚点实体
  for (const row of anchorRows) {
    const cur = Number(row.currentBid) || 0;
    const anchor = Number(row.anchorBid) || 0;
    const suggested = Number(row.suggestedBid) || 0;
    const baseline = anchor > 0 ? anchor : suggested;
    if (baseline <= 0 || cur <= 0) {
      res.skipped++;
      continue;
    }
    const drift = ((cur - baseline) / baseline) * 100;
    const correction = calcBidCorrection(cur, baseline, drift);
    if (!correction) {
      res.skipped++;
      continue;
    }
    res.analyzed++;
    res.details.push({
      entityType: row.entityType ?? "unknown",
      entityId: row.targetId ?? row.keywordId ?? row.id,
      dimension: "bid",
      oldValue: cur,
      newValue: correction.target,
      changePct: correction.changePct,
      reason: correction.reason,
    });

    if (!dryRun) {
      try {
        await db
          .update(bidAnchorAnalysis)
          .set({
            correctionStatus: "applied",
            appliedAt: sql`NOW()`,
          })
          .where(eq(bidAnchorAnalysis.id, row.id));

        if (row.entityType === "product_target" && row.targetId) {
          await db
            .update(productTargets)
            .set({ bid: correction.target.toFixed(2) })
            .where(eq(productTargets.targetId, String(row.targetId)));
        }
        res.corrected++;
      } catch (e: any) {
        log.error(`竞价纠正失败: ${e.message}`);
        res.failed++;
      }
    } else {
      res.corrected++;
    }
  }

  // 处理没有锚点数据的产品目标
  for (const row of ptRows) {
    const key = `product_target_${row.targetId}`;
    if (anchorEntitySet.has(key)) continue;

    const cur = Number(row.bid) || 0;
    const sugHigh = Number(row.suggestedBidHigh) || 0;
    const sugLow = Number(row.suggestedBidLow) || 0;
    const sugMid = Number(row.suggestedBid) || 0;
    // 使用建议竞价中位数作为基线
    const baseline = sugMid > 0 ? sugMid : (sugHigh + sugLow) / 2;
    if (baseline <= 0 || cur <= 0) {
      res.skipped++;
      continue;
    }
    const drift = ((cur - baseline) / baseline) * 100;
    const correction = calcBidCorrection(cur, baseline, drift);
    if (!correction) {
      res.skipped++;
      continue;
    }
    res.analyzed++;
    res.details.push({
      entityType: "product_target",
      entityId: row.targetId ?? row.id,
      dimension: "bid",
      oldValue: cur,
      newValue: correction.target,
      changePct: correction.changePct,
      reason: correction.reason,
    });

    if (!dryRun) {
      try {
        await db
          .update(productTargets)
          .set({ bid: correction.target.toFixed(2) })
          .where(eq(productTargets.id, row.id));
        res.corrected++;
      } catch (e: any) {
        log.error(`产品目标竞价纠正失败: ${e.message}`);
        res.failed++;
      }
    } else {
      res.corrected++;
    }
  }

  logResult("竞价纠正", res);
  return res;
}

function calcBidCorrection(
  current: number,
  baseline: number,
  driftPct: number
): { target: number; changePct: number; reason: string } | null {
  let target: number;
  let reason: string;

  if (driftPct > 200) {
    target = baseline * HEALTH.bid.criticalOverBuffer;
    reason = `极端过高(+${driftPct.toFixed(0)}%), 回归→基线×1.20`;
  } else if (driftPct > 100) {
    target = baseline * HEALTH.bid.severeOverBuffer;
    reason = `严重过高(+${driftPct.toFixed(0)}%), 回归→基线×1.30`;
  } else if (driftPct > 50) {
    target = baseline * HEALTH.bid.moderateOverFirstStep;
    reason = `中度过高(+${driftPct.toFixed(0)}%), 第一步→基线×1.50`;
  } else if (driftPct < -50) {
    target = baseline * HEALTH.bid.criticalUnderBuffer;
    reason = `严重过低(${driftPct.toFixed(0)}%), 回归→基线×0.80`;
  } else if (driftPct < -30) {
    target = baseline * HEALTH.bid.moderateUnderBuffer;
    reason = `中度过低(${driftPct.toFixed(0)}%), 回归→基线×0.85`;
  } else {
    return null; // ±30%以内，留给v720渐进优化
  }

  target = Math.max(HEALTH.bid.absoluteMin, Math.min(HEALTH.bid.absoluteMax, target));
  target = Math.round(target * 100) / 100;

  return {
    target,
    changePct: ((target - current) / current) * 100,
    reason,
  };
}

// ============================================================
// 维度 2 — 分时竞价乘数纠正
// ============================================================
async function fixHourpartingMultipliers(db: any, dryRun: boolean): Promise<PhaseResult> {
  log.info("--- 维度2: 分时竞价乘数纠正 ---");
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
    const ids = highRows.map((r: any) => r.id);
    if (!dryRun) {
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
    const ids = lowRows.map((r: any) => r.id);
    if (!dryRun) {
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
// 维度 3 — 分时预算乘数纠正
// ============================================================
async function fixDaypartingMultipliers(db: any, dryRun: boolean): Promise<PhaseResult> {
  log.info("--- 维度3: 分时预算乘数纠正 ---");
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
    const ids = highRows.map((r: any) => r.id);
    if (!dryRun) {
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
    const ids = lowRows.map((r: any) => r.id);
    if (!dryRun) {
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
// 维度 4 — 位置倾斜纠正
// ============================================================
async function fixPlacements(db: any, dryRun: boolean): Promise<PhaseResult> {
  log.info("--- 维度4: 位置倾斜纠正 ---");
  const res = emptyResult("placement");
  const cap = HEALTH.placement.maxHealthy;

  const rows = await db
    .select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      topAdj: campaigns.placementTopSearchBidAdjustment,
      ppAdj: campaigns.placementProductPageBidAdjustment,
      restAdj: campaigns.placementRestBidAdjustment,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.campaignStatus, "enabled"),
        or(
          gt(campaigns.placementTopSearchBidAdjustment, cap),
          gt(campaigns.placementProductPageBidAdjustment, cap),
          gt(campaigns.placementRestBidAdjustment, cap)
        )
      )
    );

  res.analyzed = rows.length;
  log.info(`  位置倾斜>50%的活动: ${rows.length}`);

  for (const row of rows) {
    const top = Number(row.topAdj) || 0;
    const pp = Number(row.ppAdj) || 0;
    const rest = Number(row.restAdj) || 0;
    const updates: Record<string, number> = {};

    if (top > cap) {
      updates.placementTopSearchBidAdjustment = cap;
      res.details.push({
        entityType: "campaign",
        entityId: row.campaignId,
        dimension: "top_of_search",
        oldValue: top,
        newValue: cap,
        changePct: ((cap - top) / Math.max(top, 1)) * 100,
        reason: `搜索顶部${top}%→${cap}%`,
      });
    }
    if (pp > cap) {
      updates.placementProductPageBidAdjustment = cap;
      res.details.push({
        entityType: "campaign",
        entityId: row.campaignId,
        dimension: "product_page",
        oldValue: pp,
        newValue: cap,
        changePct: ((cap - pp) / Math.max(pp, 1)) * 100,
        reason: `商品页面${pp}%→${cap}%`,
      });
    }
    if (rest > cap) {
      updates.placementRestBidAdjustment = cap;
      res.details.push({
        entityType: "campaign",
        entityId: row.campaignId,
        dimension: "rest_of_search",
        oldValue: rest,
        newValue: cap,
        changePct: ((cap - rest) / Math.max(rest, 1)) * 100,
        reason: `其他搜索${rest}%→${cap}%`,
      });
    }

    if (Object.keys(updates).length > 0) {
      if (!dryRun) {
        try {
          await db
            .update(campaigns)
            .set(updates as any)
            .where(eq(campaigns.id, row.id));
          res.corrected++;
        } catch (e: any) {
          log.error(`位置倾斜纠正失败: ${e.message}`);
          res.failed++;
        }
      } else {
        res.corrected++;
      }
    }
  }

  logResult("位置倾斜纠正", res);
  return res;
}

// ============================================================
// 工具
// ============================================================
function emptyResult(phase: string): PhaseResult {
  return { phase, analyzed: 0, corrected: 0, skipped: 0, failed: 0, details: [] };
}

function logResult(name: string, r: PhaseResult) {
  log.info(`  ${name}: 分析=${r.analyzed} 纠正=${r.corrected} 跳过=${r.skipped} 失败=${r.failed}`);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default executeAggressiveBleedingStop;
