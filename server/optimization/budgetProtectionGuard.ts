/**
 * 预算保护守卫 (Budget Protection Guard)
 * 
 * 核心职责：保护租户的广告预算不被系统不完善的优化逻辑快速消耗。
 * 
 * 保护层级：
 * 1. 日预算消耗速率监控 — 检测当日花费是否超速
 * 2. 7天滚动花费上限 — 防止花费持续攀升
 * 3. ACoS恶化自动降速 — ACoS快速恶化时自动收紧
 * 4. 新实体保护期 — 新接入的广告活动更保守
 * 5. 租户级花费异常检测 — 整体花费异常时告警
 * 
 * 设计原则：
 * - 宁可少花钱也不多花钱（保守优先）
 * - 所有保护动作都有日志记录
 * - 保护机制不会阻止正常优化，只会限制幅度
 */

// ============================================================
// 类型定义
// ============================================================

export interface SpendingData {
  accountId: number;
  campaignId?: string;
  todaySpend: number;
  todayHoursElapsed: number;
  dailyBudget: number;
  last7DaysSpend: number[];     // 过去7天每天的花费
  last14DaysAvgDailySpend: number;
  last30DaysAvgDailySpend: number;
}

export interface AcosData {
  accountId: number;
  campaignId?: string;
  last3DaysAcos: number;
  last7DaysAcos: number;
  last14DaysAcos: number;
  last30DaysAcos: number;
}

export interface ProtectionAction {
  type: "bid_reduction" | "budget_cap" | "pause_low_performers" | "throttle_increases" | "alert";
  severity: "warning" | "critical" | "emergency";
  description: string;
  bidReductionPercent?: number;     // 竞价降低百分比
  maxBidIncreasePercent?: number;   // 最大允许提价百分比
  maxBudgetIncreasePercent?: number; // 最大允许预算提升百分比
  affectedCampaignIds?: string[];
}

export interface ProtectionCheckResult {
  isProtected: boolean;
  protectionLevel: "none" | "mild" | "moderate" | "severe" | "emergency";
  actions: ProtectionAction[];
  summary: string;
  // 优化参数调整
  effectiveMaxBidIncrease: number;   // 有效最大竞价提升%
  effectiveMaxBidDecrease: number;   // 有效最大竞价降低%
  effectiveMaxBudgetIncrease: number; // 有效最大预算提升%
  blockAllIncreases: boolean;         // 是否阻止所有提价
}

// ============================================================
// 配置常量
// ============================================================

const PROTECTION_CONFIG = {
  // 日预算消耗速率阈值
  dailyBurnRate: {
    warning: 1.2,    // 预计日花费 > 预算120% 时警告
    critical: 1.5,   // 预计日花费 > 预算150% 时紧急
    emergency: 2.0,  // 预计日花费 > 预算200% 时紧急停止
  },

  // 7天滚动花费上限
  rollingSpendLimit: {
    maxDailyIncrease: 1.25,  // 今日花费不超过7天均值的125%
    maxWeeklyIncrease: 1.30, // 本周花费不超过上周的130%
  },

  // ACoS恶化阈值
  acosDeterioration: {
    mild: 1.15,      // 近3天ACoS > 近14天ACoS * 1.15 → 轻度恶化
    moderate: 1.30,  // 近3天ACoS > 近14天ACoS * 1.30 → 中度恶化
    severe: 1.50,    // 近3天ACoS > 近14天ACoS * 1.50 → 严重恶化
    extreme: 2.00,   // 近3天ACoS > 近14天ACoS * 2.00 → 极端恶化
  },

  // 新实体保护期
  newEntityProtection: {
    protectionDays: 7,            // 保护期天数
    maxBidChangePercent: 0.05,    // 保护期内最大竞价调整5%
    maxBudgetChangePercent: 0.15, // 保护期内最大预算调整15%
    blockExploration: true,       // 保护期内禁止探索性提价
  },

  // 租户级花费异常检测
  tenantLevelAlert: {
    dailySpendMultiplier: 2.0,  // 今日花费 > 30天均值 * 2 时告警
    weeklySpendMultiplier: 1.5, // 本周花费 > 4周均值 * 1.5 时告警
  },

  // 默认安全参数
  defaults: {
    maxBidIncrease: 0.10,     // 默认最大竞价提升10%
    maxBidDecrease: 0.10,     // 默认最大竞价降低10%
    maxBudgetIncrease: 0.25,  // 默认最大预算提升25%
  },
};

// ============================================================
// 核心保护函数
// ============================================================

/**
 * 检查日预算消耗速率
 */
function checkDailyBurnRate(data: SpendingData): ProtectionAction[] {
  const actions: ProtectionAction[] = [];

  if (data.todayHoursElapsed < 2) {
    // 不到2小时的数据不够判断
    return actions;
  }

  const hourlyRate = data.todaySpend / data.todayHoursElapsed;
  const projectedDailySpend = hourlyRate * 24;
  const burnRatio = projectedDailySpend / data.dailyBudget;

  if (burnRatio >= PROTECTION_CONFIG.dailyBurnRate.emergency) {
    actions.push({
      type: "bid_reduction",
      severity: "emergency",
      description: `紧急预算保护: 预计日花费 $${projectedDailySpend.toFixed(2)} 是日预算 $${data.dailyBudget.toFixed(2)} 的 ${burnRatio.toFixed(1)}倍`,
      bidReductionPercent: 8,
      maxBidIncreasePercent: 0,
    });
  } else if (burnRatio >= PROTECTION_CONFIG.dailyBurnRate.critical) {
    actions.push({
      type: "throttle_increases",
      severity: "critical",
      description: `预算超速警告: 预计日花费 $${projectedDailySpend.toFixed(2)} 是日预算 $${data.dailyBudget.toFixed(2)} 的 ${burnRatio.toFixed(1)}倍`,
      bidReductionPercent: 5,
      maxBidIncreasePercent: 2,
    });
  } else if (burnRatio >= PROTECTION_CONFIG.dailyBurnRate.warning) {
    actions.push({
      type: "throttle_increases",
      severity: "warning",
      description: `预算消耗偏快: 预计日花费 $${projectedDailySpend.toFixed(2)} 是日预算 $${data.dailyBudget.toFixed(2)} 的 ${burnRatio.toFixed(1)}倍`,
      maxBidIncreasePercent: 5,
    });
  }

  return actions;
}

/**
 * 检查7天滚动花费趋势
 */
function checkRollingSpendTrend(data: SpendingData): ProtectionAction[] {
  const actions: ProtectionAction[] = [];

  if (data.last7DaysSpend.length < 5) {
    return actions; // 数据不足
  }

  const avg7DaySpend = data.last7DaysSpend.reduce((a, b) => a + b, 0) / data.last7DaysSpend.length;
  const maxAllowedDaily = avg7DaySpend * PROTECTION_CONFIG.rollingSpendLimit.maxDailyIncrease;

  // 检查今日花费趋势是否超过7天均值的125%
  if (data.todayHoursElapsed >= 4) {
    const projectedToday = (data.todaySpend / data.todayHoursElapsed) * 24;
    if (projectedToday > maxAllowedDaily) {
      const ratio = projectedToday / avg7DaySpend;
      actions.push({
        type: "throttle_increases",
        severity: ratio > 1.5 ? "critical" : "warning",
        description: `7天滚动花费超限: 预计今日 $${projectedToday.toFixed(2)} 超过7天均值 $${avg7DaySpend.toFixed(2)} 的 ${((ratio - 1) * 100).toFixed(0)}%`,
        maxBidIncreasePercent: ratio > 1.5 ? 0 : 3,
      });
    }
  }

  // 检查花费是否连续3天上升
  if (data.last7DaysSpend.length >= 3) {
    const recent3 = data.last7DaysSpend.slice(-3);
    const isConsecutiveIncrease = recent3[1] > recent3[0] * 1.1 && recent3[2] > recent3[1] * 1.1;
    if (isConsecutiveIncrease) {
      const totalIncrease = recent3[2] / recent3[0];
      if (totalIncrease > 1.3) {
        actions.push({
          type: "throttle_increases",
          severity: "warning",
          description: `花费连续3天上升: 从 $${recent3[0].toFixed(2)} 升至 $${recent3[2].toFixed(2)} (+${((totalIncrease - 1) * 100).toFixed(0)}%)`,
          maxBidIncreasePercent: 5,
          maxBudgetIncreasePercent: 10,
        });
      }
    }
  }

  return actions;
}

/**
 * 检查ACoS恶化趋势
 */
function checkAcosDeterioration(data: AcosData): ProtectionAction[] {
  const actions: ProtectionAction[] = [];

  if (data.last3DaysAcos <= 0 || data.last14DaysAcos <= 0) {
    return actions;
  }

  const deteriorationRatio = data.last3DaysAcos / data.last14DaysAcos;

  if (deteriorationRatio >= PROTECTION_CONFIG.acosDeterioration.extreme) {
    actions.push({
      type: "bid_reduction",
      severity: "emergency",
      description: `ACoS极端恶化: 近3天 ${data.last3DaysAcos.toFixed(1)}% vs 近14天 ${data.last14DaysAcos.toFixed(1)}% (恶化${((deteriorationRatio - 1) * 100).toFixed(0)}%)`,
      bidReductionPercent: 8,
      maxBidIncreasePercent: 0,
    });
  } else if (deteriorationRatio >= PROTECTION_CONFIG.acosDeterioration.severe) {
    actions.push({
      type: "throttle_increases",
      severity: "critical",
      description: `ACoS严重恶化: 近3天 ${data.last3DaysAcos.toFixed(1)}% vs 近14天 ${data.last14DaysAcos.toFixed(1)}% (恶化${((deteriorationRatio - 1) * 100).toFixed(0)}%)`,
      maxBidIncreasePercent: 0,
    });
  } else if (deteriorationRatio >= PROTECTION_CONFIG.acosDeterioration.moderate) {
    actions.push({
      type: "throttle_increases",
      severity: "warning",
      description: `ACoS中度恶化: 近3天 ${data.last3DaysAcos.toFixed(1)}% vs 近14天 ${data.last14DaysAcos.toFixed(1)}% (恶化${((deteriorationRatio - 1) * 100).toFixed(0)}%)`,
      maxBidIncreasePercent: 3,
    });
  } else if (deteriorationRatio >= PROTECTION_CONFIG.acosDeterioration.mild) {
    actions.push({
      type: "throttle_increases",
      severity: "warning",
      description: `ACoS轻度恶化: 近3天 ${data.last3DaysAcos.toFixed(1)}% vs 近14天 ${data.last14DaysAcos.toFixed(1)}% (恶化${((deteriorationRatio - 1) * 100).toFixed(0)}%)`,
      maxBidIncreasePercent: 7,
    });
  }

  return actions;
}

/**
 * 综合执行所有保护检查，返回最终的保护结果
 */
export function runProtectionChecks(
  spendingData: SpendingData | null,
  acosData: AcosData | null,
  isNewEntity: boolean = false,
  entityAgeDays: number = 999,
): ProtectionCheckResult {
  const allActions: ProtectionAction[] = [];

  // 1. 日预算消耗速率检查
  if (spendingData) {
    allActions.push(...checkDailyBurnRate(spendingData));
    allActions.push(...checkRollingSpendTrend(spendingData));
  }

  // 2. ACoS恶化检查
  if (acosData) {
    allActions.push(...checkAcosDeterioration(acosData));
  }

  // 3. 新实体保护期
  if (isNewEntity || entityAgeDays < PROTECTION_CONFIG.newEntityProtection.protectionDays) {
    allActions.push({
      type: "throttle_increases",
      severity: "warning",
      description: `新实体保护期: 接入仅${entityAgeDays}天，限制调整幅度`,
      maxBidIncreasePercent: PROTECTION_CONFIG.newEntityProtection.maxBidChangePercent * 100,
      maxBudgetIncreasePercent: PROTECTION_CONFIG.newEntityProtection.maxBudgetChangePercent * 100,
    });
  }

  // 如果没有任何保护动作
  if (allActions.length === 0) {
    return {
      isProtected: false,
      protectionLevel: "none",
      actions: [],
      summary: "无需保护，所有指标正常",
      effectiveMaxBidIncrease: PROTECTION_CONFIG.defaults.maxBidIncrease * 100,
      effectiveMaxBidDecrease: PROTECTION_CONFIG.defaults.maxBidDecrease * 100,
      effectiveMaxBudgetIncrease: PROTECTION_CONFIG.defaults.maxBudgetIncrease * 100,
      blockAllIncreases: false,
    };
  }

  // 计算最严格的保护参数
  let effectiveMaxBidIncrease = PROTECTION_CONFIG.defaults.maxBidIncrease * 100; // 10%
  let effectiveMaxBidDecrease = PROTECTION_CONFIG.defaults.maxBidDecrease * 100; // 10%
  let effectiveMaxBudgetIncrease = PROTECTION_CONFIG.defaults.maxBudgetIncrease * 100; // 25%
  let blockAllIncreases = false;
  let totalBidReduction = 0;

  for (const action of allActions) {
    if (action.maxBidIncreasePercent !== undefined) {
      effectiveMaxBidIncrease = Math.min(effectiveMaxBidIncrease, action.maxBidIncreasePercent);
    }
    if (action.maxBudgetIncreasePercent !== undefined) {
      effectiveMaxBudgetIncrease = Math.min(effectiveMaxBudgetIncrease, action.maxBudgetIncreasePercent);
    }
    if (action.bidReductionPercent) {
      totalBidReduction = Math.max(totalBidReduction, action.bidReductionPercent);
    }
    if (action.maxBidIncreasePercent === 0) {
      blockAllIncreases = true;
    }
  }

  // 确定保护级别
  const hasEmergency = allActions.some(a => a.severity === "emergency");
  const hasCritical = allActions.some(a => a.severity === "critical");
  const warningCount = allActions.filter(a => a.severity === "warning").length;

  let protectionLevel: ProtectionCheckResult["protectionLevel"];
  if (hasEmergency) {
    protectionLevel = "emergency";
  } else if (hasCritical) {
    protectionLevel = "severe";
  } else if (warningCount >= 2) {
    protectionLevel = "moderate";
  } else {
    protectionLevel = "mild";
  }

  // 生成摘要
  const summaryParts = allActions.map(a => a.description);
  const summary = `保护级别: ${protectionLevel} | ${summaryParts.join("; ")}`;

  return {
    isProtected: true,
    protectionLevel,
    actions: allActions,
    summary,
    effectiveMaxBidIncrease,
    effectiveMaxBidDecrease: Math.min(effectiveMaxBidDecrease, effectiveMaxBidDecrease + totalBidReduction),
    effectiveMaxBudgetIncrease,
    blockAllIncreases,
  };
}

/**
 * 应用保护结果到竞价调整
 * 
 * @param proposedChangePercent 规则引擎建议的调整百分比（正数=提价，负数=降价）
 * @param protection 保护检查结果
 * @returns 保护后的调整百分比
 */
export function applyProtectionToBidChange(
  proposedChangePercent: number,
  protection: ProtectionCheckResult,
): { adjustedChangePercent: number; wasProtected: boolean; protectionReason: string } {
  if (!protection.isProtected) {
    // 即使无保护，也要遵守基本限制
    const capped = Math.max(-10, Math.min(10, proposedChangePercent));
    return {
      adjustedChangePercent: capped,
      wasProtected: capped !== proposedChangePercent,
      protectionReason: capped !== proposedChangePercent ? "基本10%限制" : "",
    };
  }

  // 提价受限
  if (proposedChangePercent > 0) {
    if (protection.blockAllIncreases) {
      return {
        adjustedChangePercent: 0,
        wasProtected: true,
        protectionReason: `提价被阻止: ${protection.summary}`,
      };
    }

    const maxIncrease = protection.effectiveMaxBidIncrease;
    if (proposedChangePercent > maxIncrease) {
      return {
        adjustedChangePercent: maxIncrease,
        wasProtected: true,
        protectionReason: `提价从${proposedChangePercent.toFixed(1)}%限制到${maxIncrease.toFixed(1)}%: ${protection.protectionLevel}`,
      };
    }
  }

  // 降价不受限（降价是保护预算的行为）
  if (proposedChangePercent < 0) {
    const maxDecrease = -protection.effectiveMaxBidDecrease;
    if (proposedChangePercent < maxDecrease) {
      return {
        adjustedChangePercent: maxDecrease,
        wasProtected: true,
        protectionReason: `降价从${proposedChangePercent.toFixed(1)}%限制到${maxDecrease.toFixed(1)}%`,
      };
    }
  }

  return {
    adjustedChangePercent: proposedChangePercent,
    wasProtected: false,
    protectionReason: "",
  };
}

/**
 * 应用保护结果到预算调整
 */
export function applyProtectionToBudgetChange(
  proposedChangePercent: number,
  protection: ProtectionCheckResult,
): { adjustedChangePercent: number; wasProtected: boolean; protectionReason: string } {
  if (!protection.isProtected) {
    const capped = Math.max(-25, Math.min(25, proposedChangePercent));
    return {
      adjustedChangePercent: capped,
      wasProtected: capped !== proposedChangePercent,
      protectionReason: capped !== proposedChangePercent ? "基本25%限制" : "",
    };
  }

  // 预算提升受限
  if (proposedChangePercent > 0) {
    if (protection.blockAllIncreases) {
      return {
        adjustedChangePercent: 0,
        wasProtected: true,
        protectionReason: `预算提升被阻止: ${protection.summary}`,
      };
    }

    const maxIncrease = protection.effectiveMaxBudgetIncrease;
    if (proposedChangePercent > maxIncrease) {
      return {
        adjustedChangePercent: maxIncrease,
        wasProtected: true,
        protectionReason: `预算提升从${proposedChangePercent.toFixed(1)}%限制到${maxIncrease.toFixed(1)}%`,
      };
    }
  }

  // 预算降低不受限
  if (proposedChangePercent < 0) {
    const capped = Math.max(-25, proposedChangePercent);
    return {
      adjustedChangePercent: capped,
      wasProtected: false,
      protectionReason: "",
    };
  }

  return {
    adjustedChangePercent: proposedChangePercent,
    wasProtected: false,
    protectionReason: "",
  };
}

// ============================================================
// 导出
// ============================================================

export const budgetProtectionGuard = {
  runProtectionChecks,
  applyProtectionToBidChange,
  applyProtectionToBudgetChange,
  PROTECTION_CONFIG,
};
