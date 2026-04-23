/**
 * 竞价回归引擎 (Bid Regression Engine)
 * 
 * 核心职责：渐进式将偏离Amazon建议竞价范围的竞价回归到合理区间。
 * 
 * 设计原则：
 * 1. 每次优化周期（2小时）最多调整10%
 * 2. 竞价过高的实体优先降价（保护预算）
 * 3. 竞价过低的实体渐进提价（恢复曝光）
 * 4. 有转化的实体调整更保守（保护有效投放）
 * 5. 所有调整都记录日志，可追溯
 */

import { db } from "../db";

// ============================================================
// 类型定义
// ============================================================

export interface BidRegressionTarget {
  entityType: "keyword" | "productTarget";
  entityId: string;
  accountId: number;
  campaignId: string;
  currentBid: number;
  suggestedBid: number;
  suggestedBidLow: number;
  suggestedBidHigh: number;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number | null;
}

export interface BidRegressionResult {
  entityType: string;
  entityId: string;
  accountId: number;
  campaignId: string;
  currentBid: number;
  newBid: number;
  changePercent: number;
  reason: string;
  priority: "critical" | "high" | "medium" | "low";
  suggestedBidHigh: number;
  suggestedBidLow: number;
}

export interface BidRegressionSummary {
  totalAnalyzed: number;
  totalNeedCorrection: number;
  corrections: {
    overbid_critical: number;   // 竞价 > 建议高价 * 2.0
    overbid_high: number;       // 竞价 > 建议高价 * 1.5
    overbid_moderate: number;   // 竞价 > 建议高价 * 1.2
    underbid_critical: number;  // 竞价 < 建议低价 * 0.3
    underbid_high: number;      // 竞价 < 建议低价 * 0.5
    underbid_moderate: number;  // 竞价 < 建议低价 * 0.8
    in_range: number;           // 在建议范围内
  };
  results: BidRegressionResult[];
  estimatedDailySavings: number;
}

// ============================================================
// 配置常量
// ============================================================

const REGRESSION_CONFIG = {
  // 竞价过高时的降价配置
  overbid: {
    // 严重过高 (> 2.0x suggested_high): 每周期降10%
    critical: {
      threshold: 2.0,
      maxAdjustPercent: 0.10,
      regressionSpeed: 0.30,  // 向目标回归30%的差距（但受maxAdjust限制）
    },
    // 明显过高 (> 1.5x suggested_high): 每周期降8%
    high: {
      threshold: 1.5,
      maxAdjustPercent: 0.08,
      regressionSpeed: 0.25,
    },
    // 轻度过高 (> 1.2x suggested_high): 每周期降5%
    moderate: {
      threshold: 1.2,
      maxAdjustPercent: 0.05,
      regressionSpeed: 0.20,
    },
  },

  // 竞价过低时的提价配置
  underbid: {
    // 严重过低 (< 0.3x suggested_low): 每周期提8%
    critical: {
      threshold: 0.3,
      maxAdjustPercent: 0.08,
      regressionSpeed: 0.25,
    },
    // 明显过低 (< 0.5x suggested_low): 每周期提6%
    high: {
      threshold: 0.5,
      maxAdjustPercent: 0.06,
      regressionSpeed: 0.20,
    },
    // 轻度过低 (< 0.8x suggested_low): 每周期提4%
    moderate: {
      threshold: 0.8,
      maxAdjustPercent: 0.04,
      regressionSpeed: 0.15,
    },
  },

  // 有转化实体的保护系数（降低调整幅度）
  conversionProtectionFactor: 0.5,

  // 高ACoS实体的加速降价系数
  highAcosAccelerationFactor: 1.3,

  // 最低竞价保护（不低于$0.02）
  absoluteMinBid: 0.02,

  // 最高竞价保护（不高于$100）
  absoluteMaxBid: 100.0,
};

// ============================================================
// 核心函数
// ============================================================

/**
 * 分析单个实体的竞价偏离度并计算回归调整
 */
export function analyzeBidRegression(target: BidRegressionTarget): BidRegressionResult | null {
  const { currentBid, suggestedBidHigh, suggestedBidLow, suggestedBid } = target;

  // 如果没有建议竞价数据，跳过
  if (!suggestedBidHigh || !suggestedBidLow || suggestedBidHigh <= 0 || suggestedBidLow <= 0) {
    return null;
  }

  // 如果竞价在合理范围内，不需要调整
  if (currentBid >= suggestedBidLow * 0.8 && currentBid <= suggestedBidHigh * 1.2) {
    return null;
  }

  const hasConversions = target.orders > 0;
  const hasHighAcos = target.acos !== null && target.acos > 50; // ACoS > 50%

  // ---- 竞价过高 ----
  if (currentBid > suggestedBidHigh * 1.2) {
    const overbidRatio = currentBid / suggestedBidHigh;
    let config: typeof REGRESSION_CONFIG.overbid.critical;
    let priority: BidRegressionResult["priority"];
    let reason: string;

    if (overbidRatio >= REGRESSION_CONFIG.overbid.critical.threshold) {
      config = REGRESSION_CONFIG.overbid.critical;
      priority = "critical";
      reason = `竞价严重过高: $${currentBid.toFixed(2)} 是建议高价 $${suggestedBidHigh.toFixed(2)} 的 ${overbidRatio.toFixed(1)}倍`;
    } else if (overbidRatio >= REGRESSION_CONFIG.overbid.high.threshold) {
      config = REGRESSION_CONFIG.overbid.high;
      priority = "high";
      reason = `竞价明显过高: $${currentBid.toFixed(2)} 是建议高价 $${suggestedBidHigh.toFixed(2)} 的 ${overbidRatio.toFixed(1)}倍`;
    } else {
      config = REGRESSION_CONFIG.overbid.moderate;
      priority = "medium";
      reason = `竞价轻度过高: $${currentBid.toFixed(2)} 超过建议高价 $${suggestedBidHigh.toFixed(2)} ${((overbidRatio - 1) * 100).toFixed(0)}%`;
    }

    // 计算目标竞价（回归到建议高价）
    const targetBid = suggestedBidHigh;
    const gap = currentBid - targetBid;
    let adjustAmount = gap * config.regressionSpeed;
    const maxAdjust = currentBid * config.maxAdjustPercent;
    adjustAmount = Math.min(adjustAmount, maxAdjust);

    // 有转化的实体更保守
    if (hasConversions && !hasHighAcos) {
      adjustAmount *= REGRESSION_CONFIG.conversionProtectionFactor;
      reason += ` (有${target.orders}个订单，保守调整)`;
    }

    // 高ACoS加速降价
    if (hasHighAcos) {
      adjustAmount *= REGRESSION_CONFIG.highAcosAccelerationFactor;
      reason += ` (ACoS ${target.acos?.toFixed(0)}%过高，加速降价)`;
    }

    const newBid = Math.max(currentBid - adjustAmount, REGRESSION_CONFIG.absoluteMinBid);
    const changePercent = ((newBid - currentBid) / currentBid) * 100;

    // 确保不超过10%的单次调整上限
    if (Math.abs(changePercent) > 10) {
      const cappedNewBid = currentBid * 0.90;
      return {
        entityType: target.entityType,
        entityId: target.entityId,
        accountId: target.accountId,
        campaignId: target.campaignId,
        currentBid,
        newBid: Math.round(cappedNewBid * 100) / 100,
        changePercent: -10,
        reason: reason + " (触及10%上限)",
        priority,
        suggestedBidHigh,
        suggestedBidLow,
      };
    }

    return {
      entityType: target.entityType,
      entityId: target.entityId,
      accountId: target.accountId,
      campaignId: target.campaignId,
      currentBid,
      newBid: Math.round(newBid * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
      reason,
      priority,
      suggestedBidHigh,
      suggestedBidLow,
    };
  }

  // ---- 竞价过低 ----
  if (currentBid < suggestedBidLow * 0.8) {
    const underbidRatio = currentBid / suggestedBidLow;
    let config: typeof REGRESSION_CONFIG.underbid.critical;
    let priority: BidRegressionResult["priority"];
    let reason: string;

    if (underbidRatio <= REGRESSION_CONFIG.underbid.critical.threshold) {
      config = REGRESSION_CONFIG.underbid.critical;
      priority = "high";
      reason = `竞价严重过低: $${currentBid.toFixed(2)} 仅为建议低价 $${suggestedBidLow.toFixed(2)} 的 ${(underbidRatio * 100).toFixed(0)}%`;
    } else if (underbidRatio <= REGRESSION_CONFIG.underbid.high.threshold) {
      config = REGRESSION_CONFIG.underbid.high;
      priority = "medium";
      reason = `竞价明显过低: $${currentBid.toFixed(2)} 仅为建议低价 $${suggestedBidLow.toFixed(2)} 的 ${(underbidRatio * 100).toFixed(0)}%`;
    } else {
      config = REGRESSION_CONFIG.underbid.moderate;
      priority = "low";
      reason = `竞价轻度过低: $${currentBid.toFixed(2)} 低于建议低价 $${suggestedBidLow.toFixed(2)} ${((1 - underbidRatio) * 100).toFixed(0)}%`;
    }

    // 计算目标竞价（回归到建议低价）
    const targetBid = suggestedBidLow;
    const gap = targetBid - currentBid;
    let adjustAmount = gap * config.regressionSpeed;
    const maxAdjust = currentBid * config.maxAdjustPercent;
    adjustAmount = Math.min(adjustAmount, maxAdjust);

    // 确保提价不会超过建议高价
    const newBid = Math.min(currentBid + adjustAmount, suggestedBidHigh, REGRESSION_CONFIG.absoluteMaxBid);
    const changePercent = ((newBid - currentBid) / currentBid) * 100;

    // 确保不超过10%的单次调整上限
    if (changePercent > 10) {
      const cappedNewBid = currentBid * 1.10;
      return {
        entityType: target.entityType,
        entityId: target.entityId,
        accountId: target.accountId,
        campaignId: target.campaignId,
        currentBid,
        newBid: Math.round(Math.min(cappedNewBid, suggestedBidHigh) * 100) / 100,
        changePercent: 10,
        reason: reason + " (触及10%上限)",
        priority,
        suggestedBidHigh,
        suggestedBidLow,
      };
    }

    return {
      entityType: target.entityType,
      entityId: target.entityId,
      accountId: target.accountId,
      campaignId: target.campaignId,
      currentBid,
      newBid: Math.round(newBid * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
      reason,
      priority,
      suggestedBidHigh,
      suggestedBidLow,
    };
  }

  return null;
}

/**
 * 批量分析并生成回归摘要
 */
export function generateRegressionSummary(targets: BidRegressionTarget[]): BidRegressionSummary {
  const results: BidRegressionResult[] = [];
  const corrections = {
    overbid_critical: 0,
    overbid_high: 0,
    overbid_moderate: 0,
    underbid_critical: 0,
    underbid_high: 0,
    underbid_moderate: 0,
    in_range: 0,
  };

  let estimatedDailySavings = 0;

  for (const target of targets) {
    if (!target.suggestedBidHigh || !target.suggestedBidLow) {
      continue;
    }

    const ratio_high = target.currentBid / target.suggestedBidHigh;
    const ratio_low = target.currentBid / target.suggestedBidLow;

    // 分类统计
    if (ratio_high >= 2.0) {
      corrections.overbid_critical++;
    } else if (ratio_high >= 1.5) {
      corrections.overbid_high++;
    } else if (ratio_high >= 1.2) {
      corrections.overbid_moderate++;
    } else if (ratio_low <= 0.3) {
      corrections.underbid_critical++;
    } else if (ratio_low <= 0.5) {
      corrections.underbid_high++;
    } else if (ratio_low <= 0.8) {
      corrections.underbid_moderate++;
    } else {
      corrections.in_range++;
    }

    // 计算回归调整
    const result = analyzeBidRegression(target);
    if (result) {
      results.push(result);

      // 估算降价带来的日花费节省
      if (result.changePercent < 0 && target.clicks > 0) {
        const avgDailyClicks = target.clicks / 30; // 假设30天数据
        const savingPerClick = target.currentBid - result.newBid;
        estimatedDailySavings += avgDailyClicks * savingPerClick;
      }
    }
  }

  // 按优先级排序：critical > high > medium > low
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  results.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    totalAnalyzed: targets.length,
    totalNeedCorrection: results.length,
    corrections,
    results,
    estimatedDailySavings: Math.round(estimatedDailySavings * 100) / 100,
  };
}

// ============================================================
// 建议竞价锚定机制
// ============================================================

/**
 * 在规则引擎输出竞价后，应用建议竞价锚定约束
 * 确保最终竞价不会偏离建议范围太远
 * 
 * @param proposedBid 规则引擎建议的竞价
 * @param currentBid 当前竞价
 * @param suggestedBidHigh Amazon建议高价
 * @param suggestedBidLow Amazon建议低价
 * @returns 锚定后的竞价
 */
export function applySuggestedBidAnchor(
  proposedBid: number,
  currentBid: number,
  suggestedBidHigh: number | null,
  suggestedBidLow: number | null,
): { anchoredBid: number; wasAnchored: boolean; anchorReason: string } {
  // 如果没有建议竞价数据，不做锚定
  if (!suggestedBidHigh || !suggestedBidLow || suggestedBidHigh <= 0 || suggestedBidLow <= 0) {
    return { anchoredBid: proposedBid, wasAnchored: false, anchorReason: "" };
  }

  // 硬上限：不超过建议高价的1.5倍
  const hardCeiling = suggestedBidHigh * 1.5;
  if (proposedBid > hardCeiling) {
    return {
      anchoredBid: Math.round(hardCeiling * 100) / 100,
      wasAnchored: true,
      anchorReason: `竞价 $${proposedBid.toFixed(2)} 超过建议高价1.5倍上限 $${hardCeiling.toFixed(2)}，已锚定`,
    };
  }

  // 硬下限：不低于建议低价的0.5倍（但不低于$0.02）
  const hardFloor = Math.max(suggestedBidLow * 0.5, REGRESSION_CONFIG.absoluteMinBid);
  if (proposedBid < hardFloor) {
    return {
      anchoredBid: Math.round(hardFloor * 100) / 100,
      wasAnchored: true,
      anchorReason: `竞价 $${proposedBid.toFixed(2)} 低于建议低价0.5倍下限 $${hardFloor.toFixed(2)}，已锚定`,
    };
  }

  // 软约束：如果规则引擎要将竞价推离建议范围，施加阻力
  if (proposedBid > suggestedBidHigh && proposedBid > currentBid) {
    // 正在提价且已超过建议高价 — 减缓提价速度
    const excessRatio = proposedBid / suggestedBidHigh;
    if (excessRatio > 1.2) {
      // 超过建议高价20%以上时，将提价幅度减半
      const dampedBid = currentBid + (proposedBid - currentBid) * 0.5;
      return {
        anchoredBid: Math.round(dampedBid * 100) / 100,
        wasAnchored: true,
        anchorReason: `竞价已超过建议高价${((excessRatio - 1) * 100).toFixed(0)}%，提价幅度减半`,
      };
    }
  }

  if (proposedBid < suggestedBidLow && proposedBid < currentBid) {
    // 正在降价且已低于建议低价 — 减缓降价速度
    const deficitRatio = proposedBid / suggestedBidLow;
    if (deficitRatio < 0.8) {
      // 低于建议低价20%以上时，将降价幅度减半
      const dampedBid = currentBid + (proposedBid - currentBid) * 0.5;
      return {
        anchoredBid: Math.round(Math.max(dampedBid, REGRESSION_CONFIG.absoluteMinBid) * 100) / 100,
        wasAnchored: true,
        anchorReason: `竞价已低于建议低价${((1 - deficitRatio) * 100).toFixed(0)}%，降价幅度减半`,
      };
    }
  }

  return { anchoredBid: proposedBid, wasAnchored: false, anchorReason: "" };
}

// ============================================================
// 导出
// ============================================================

export const bidRegressionEngine = {
  analyzeBidRegression,
  generateRegressionSummary,
  applySuggestedBidAnchor,
  REGRESSION_CONFIG,
};
