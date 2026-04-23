/**
 * Campaign Lifecycle Service - 广告活动生命周期判断服务
 * 
 * v143: 根据广告活动的数据积累状况，将其分为"启动期"和"成熟期"，
 * 并为不同阶段提供差异化的优化频率、数据阈值和调整幅度配置。
 * 
 * v719: 扩展为5阶段生命周期模型 + 趋势感知能力
 * - launch (新品冷启动期): 数据极度不足，保守探索
 * - scaling (冲刺期): 数据积累中且趋势上升，积极但受控
 * - stable (平稳期): 数据充足且表现稳定，精细化优化
 * - declining (衰退期): 表现下滑趋势，防御性优化
 * - growth (成长期): 兼容旧逻辑，介于launch和stable之间
 * 
 * 核心设计原则：
 * - 新广告活动（低竞价、低预算起步）→ 高频检查 + 宽松阈值 + 小幅调整 → 快速迭代探索
 * - 冲刺期（趋势上升）→ 中高频 + 适度放宽 + 受控提价 → 抓住增长窗口
 * - 平稳期（数据充足）→ 中频 + 严格阈值 + 小幅微调 → 维持最优状态
 * - 衰退期（趋势下降）→ 中频 + 保守阈值 + 降本优先 → 控制亏损
 * - 成长期（过渡阶段）→ 中频 + 标准阈值 + 标准调整 → 稳步积累
 */

import * as db from '../db';

// ==================== 生命周期阶段定义 ====================

// v719: 扩展为5阶段，保持向后兼容（旧代码中的'mature'映射到'stable'）
export type LifecycleStage = 'launch' | 'growth' | 'scaling' | 'stable' | 'declining' | 'mature';

export interface CampaignLifecycleInfo {
  campaignId: number;
  campaignName: string;
  campaignType: string;  // sp_auto, sp_manual, sb, sd
  stage: LifecycleStage;
  reason: string;        // 判断依据说明
  daysSinceCreation: number;
  totalClicks: number;
  totalOrders: number;
  totalImpressions: number;
  // v719: 趋势指标
  trendDirection?: 'rising' | 'flat' | 'falling';
  trendStrength?: number; // 0-1, 趋势强度
}

// ==================== 趋势感知配置 ====================

/**
 * v719: 趋势判断参数
 * 通过比较近期表现与历史基线来判断趋势方向
 */
const TREND_CONFIG = {
  // 近期窗口 vs 基线窗口
  recentDays: 7,       // 近7天作为"近期"
  baselineDays: 21,    // 前21天作为"基线"（总共看28天数据）
  
  // 趋势判断阈值
  risingThreshold: 0.15,   // 近期比基线高15%以上 → 上升趋势
  fallingThreshold: -0.15, // 近期比基线低15%以上 → 下降趋势
  
  // ACoS趋势判断（ACoS上升是负面的）
  acosRisingThreshold: 0.20,  // ACoS近期比基线高20%以上 → 效率恶化
  acosFallingThreshold: -0.10, // ACoS近期比基线低10%以上 → 效率改善
};

// ==================== 阶段切换标准 ====================

/**
 * 生命周期阶段判断标准
 * 
 * 启动期 (Launch): 新创建的、数据极度不足的广告活动
 *   - 创建时间 < 14天，或
 *   - 累计点击 < 50次，或
 *   - 累计转化 < 5次
 * 
 * 成长期 (Growth): 有一定数据但尚未稳定（默认过渡阶段）
 *   - 创建时间 14-30天，且
 *   - 累计点击 50-200次，且
 *   - 累计转化 5-20次
 * 
 * 冲刺期 (Scaling): 数据充足 + 上升趋势（从growth或stable升级）
 *   - 满足growth或stable的数据条件，且
 *   - 销售/订单趋势上升，且
 *   - ACoS趋势稳定或改善
 * 
 * 平稳期 (Stable): 数据充足，表现稳定
 *   - 创建时间 ≥ 30天，且
 *   - 累计点击 ≥ 200次，且
 *   - 累计转化 ≥ 20次，且
 *   - 趋势平稳
 * 
 * 衰退期 (Declining): 数据充足但表现下滑
 *   - 满足stable的数据条件，且
 *   - 销售/订单趋势下降，或
 *   - ACoS趋势恶化
 */
const LIFECYCLE_THRESHOLDS = {
  launch: {
    maxDays: 14,
    maxClicks: 50,
    maxOrders: 5,
  },
  growth: {
    maxDays: 30,
    maxClicks: 200,
    maxOrders: 20,
  },
  // stable/scaling/declining: 超过growth的数据标准 + 趋势判断
};

// ==================== 各阶段优化参数配置 ====================

export interface LifecycleOptimizationConfig {
  stage: LifecycleStage;
  
  // 出价优化参数
  bid: {
    intervalHours: number;       // 执行间隔（小时）
    lookbackDays: number;        // 数据回看天数
    minClicksForAction: number;  // 最小点击数才执行调整
    maxAdjustmentPercent: number; // 单次最大调整幅度 (%)
    maxDailyAdjustmentPercent: number; // 24小时最大累计调整幅度 (%)
  };
  
  // 否定搜索词参数
  negativeKeyword: {
    intervalHours: number;
    minClicksToNegate: number;   // 否定所需最小点击数（0转化时）
    minSpendToNegate: number;    // 否定所需最小花费（美元）
  };
  
  // 搜索词迁移参数
  searchTermHarvest: {
    intervalHours: number;
    minConversionsToHarvest: number; // 迁移所需最小转化数
  };
  
  // 位置倾斜参数
  placement: {
    intervalHours: number;
    minClicksForDecision: number;
  };
  
  // 预算分配参数
  budget: {
    intervalHours: number;
  };
  
  // 分时调整参数
  dayparting: {
    intervalHours: number;
  };
  
  // v719: 风险控制参数（阶段差异化）
  riskControl: {
    maxBidIncreasePercent: number;   // 单次最大提价幅度
    maxBidDecreasePercent: number;   // 单次最大降价幅度
    maxBudgetChangePercent: number;  // 单次最大预算调整幅度
    consecutiveSlowdownThreshold: number; // 连续同方向调整N次后降速
    emergencySalesDropThreshold: number;  // 销售下降触发紧急制动的阈值
  };
}

/**
 * v719: 各生命周期阶段的优化参数配置（5阶段）
 * 
 * 设计理念：
 * - launch: 保守探索，小步快跑，避免数据不足时的错误决策
 * - scaling: 抓住增长窗口，适度放宽提价空间，但严控降价
 * - stable: 精细化微调，维持最优状态，高频小幅
 * - declining: 防御性优化，优先降本，严控提价
 * - growth: 标准过渡阶段，介于launch和stable之间
 */
export const LIFECYCLE_CONFIGS: Record<LifecycleStage, LifecycleOptimizationConfig> = {
  
  // ==================== 启动期：高频探索，小步快跑 ====================
  launch: {
    stage: 'launch',
    bid: {
      intervalHours: 2,           // v242f: 每2小时检查一次，快速迭代
      lookbackDays: 3,            // 只看近3天数据，快速响应
      minClicksForAction: 5,     // 5次点击就可以做初步判断
      maxAdjustmentPercent: 5,   // v719: 单次最多5%，冷启动期极度保守
      maxDailyAdjustmentPercent: 10, // v719: 24小时最多10%
    },
    negativeKeyword: {
      intervalHours: 12,          // v337.4: 启动期也需要及时否定高花费零转化词
      minClicksToNegate: 15,     // 需要15次点击且0转化才否定
      minSpendToNegate: 10,      // 或花费超过$10且0转化
    },
    searchTermHarvest: {
      intervalHours: 24,          // v337.4: 加速高转化词的收割
      minConversionsToHarvest: 3, // 至少3次转化才迁移
    },
    placement: {
      intervalHours: 24,          // 每天一次，数据太少不宜频繁调整位置
      minClicksForDecision: 30,  // 位置层级需要更多数据
    },
    budget: {
      intervalHours: 4,           // 每4小时，监控低预算的消耗情况
    },
    dayparting: {
      intervalHours: 1,           // 每小时，分时策略按小时执行
    },
    riskControl: {
      maxBidIncreasePercent: 5,   // v719: 冷启动期提价极度保守
      maxBidDecreasePercent: 5,   // v719: 降价也保守，避免过早放弃
      maxBudgetChangePercent: 15, // v719: 预算调整适度
      consecutiveSlowdownThreshold: 2, // v719: 连续2次同方向就降速
      emergencySalesDropThreshold: 0.30, // v719: 30%下降就触发紧急制动（更敏感）
    },
  },
  
  // ==================== 成长期：中频调整，稳步积累 ====================
  growth: {
    stage: 'growth',
    bid: {
      intervalHours: 4,           // v719: 每4小时，比launch低频但仍积极
      lookbackDays: 7,            // 看7天数据
      minClicksForAction: 10,    // 10次点击才调整
      maxAdjustmentPercent: 8,   // v719: 单次最多8%
      maxDailyAdjustmentPercent: 15, // v719: 24小时最多15%
    },
    negativeKeyword: {
      intervalHours: 8,           // v337.4: 成长期每8小时检查一次否定
      minClicksToNegate: 12,     // 12次点击且0转化
      minSpendToNegate: 8,
    },
    searchTermHarvest: {
      intervalHours: 12,          // v337.4: 成长期每12小时收割一次
      minConversionsToHarvest: 2, // 2次转化即可迁移
    },
    placement: {
      intervalHours: 12,          // 每12小时
      minClicksForDecision: 50,
    },
    budget: {
      intervalHours: 4,
    },
    dayparting: {
      intervalHours: 1,
    },
    riskControl: {
      maxBidIncreasePercent: 8,   // v719: 标准提价
      maxBidDecreasePercent: 8,   // v719: 标准降价
      maxBudgetChangePercent: 20, // v719: 预算调整标准
      consecutiveSlowdownThreshold: 3, // v719: 连续3次同方向降速
      emergencySalesDropThreshold: 0.35, // v719: 35%下降触发紧急制动
    },
  },
  
  // ==================== 冲刺期：抓住增长窗口，受控激进 ====================
  scaling: {
    stage: 'scaling',
    bid: {
      intervalHours: 2,           // v719: 高频，抓住增长窗口
      lookbackDays: 7,            // 看7天数据
      minClicksForAction: 10,    // 10次点击才调整
      maxAdjustmentPercent: 10,  // v719: 单次最多10%，冲刺期允许最大幅度
      maxDailyAdjustmentPercent: 15, // v719: 24小时最多15%
    },
    negativeKeyword: {
      intervalHours: 8,           // 每8小时检查
      minClicksToNegate: 12,
      minSpendToNegate: 8,
    },
    searchTermHarvest: {
      intervalHours: 8,           // v719: 冲刺期加速收割，每8小时
      minConversionsToHarvest: 2,
    },
    placement: {
      intervalHours: 8,           // v719: 冲刺期更频繁调整位置
      minClicksForDecision: 40,
    },
    budget: {
      intervalHours: 2,           // v719: 冲刺期高频监控预算
    },
    dayparting: {
      intervalHours: 1,
    },
    riskControl: {
      maxBidIncreasePercent: 10,  // v719: 冲刺期允许最大提价空间
      maxBidDecreasePercent: 6,   // v719: 但降价保守，避免打断增长势头
      maxBudgetChangePercent: 25, // v719: 预算可以更积极
      consecutiveSlowdownThreshold: 4, // v719: 冲刺期允许更多连续同方向调整
      emergencySalesDropThreshold: 0.30, // v719: 但紧急制动更敏感
    },
  },
  
  // ==================== 平稳期：精细化微调，维持最优 ====================
  stable: {
    stage: 'stable',
    bid: {
      intervalHours: 4,           // v719: 每4小时，保持适度频率
      lookbackDays: 7,            // SP看7天（SB/SD会在执行时扩展到14天）
      minClicksForAction: 20,    // 20次点击才调整，确保统计显著性
      maxAdjustmentPercent: 6,   // v719: 单次最多6%，平稳期精细化微调
      maxDailyAdjustmentPercent: 10, // v719: 24小时最多10%
    },
    negativeKeyword: {
      intervalHours: 8,           // v337.4: 每8小时检查一次否定
      minClicksToNegate: 10,     // 10次点击且0转化即否定
      minSpendToNegate: 5,
    },
    searchTermHarvest: {
      intervalHours: 12,          // v337.4: 每12小时收割一次
      minConversionsToHarvest: 2,
    },
    placement: {
      intervalHours: 12,          // 每12小时
      minClicksForDecision: 50,
    },
    budget: {
      intervalHours: 4,
    },
    dayparting: {
      intervalHours: 1,
    },
    riskControl: {
      maxBidIncreasePercent: 6,   // v719: 平稳期提价保守
      maxBidDecreasePercent: 6,   // v719: 降价也保守
      maxBudgetChangePercent: 20, // v719: 预算调整标准
      consecutiveSlowdownThreshold: 3,
      emergencySalesDropThreshold: 0.40, // v719: 平稳期允许更大波动（数据充足，短期波动正常）
    },
  },
  
  // ==================== 衰退期：防御性优化，降本优先 ====================
  declining: {
    stage: 'declining',
    bid: {
      intervalHours: 4,           // v719: 中频，需要持续关注
      lookbackDays: 14,           // v719: 看14天数据，避免短期波动误判
      minClicksForAction: 15,    // 15次点击才调整
      maxAdjustmentPercent: 8,   // v719: 单次最多8%
      maxDailyAdjustmentPercent: 12, // v719: 24小时最多12%
    },
    negativeKeyword: {
      intervalHours: 6,           // v719: 衰退期更频繁否定，加速止损
      minClicksToNegate: 8,      // v719: 降低否定门槛
      minSpendToNegate: 4,
    },
    searchTermHarvest: {
      intervalHours: 12,
      minConversionsToHarvest: 2,
    },
    placement: {
      intervalHours: 8,           // v719: 衰退期更频繁调整位置，寻找效率更高的位置
      minClicksForDecision: 40,
    },
    budget: {
      intervalHours: 2,           // v719: 衰退期高频监控预算，防止浪费
    },
    dayparting: {
      intervalHours: 1,
    },
    riskControl: {
      maxBidIncreasePercent: 4,   // v719: 衰退期严控提价
      maxBidDecreasePercent: 10,  // v719: 但允许更大幅度降价以止损
      maxBudgetChangePercent: 25, // v719: 预算可以较大幅度下调
      consecutiveSlowdownThreshold: 2, // v719: 连续2次提价就降速
      emergencySalesDropThreshold: 0.25, // v719: 衰退期紧急制动更敏感
    },
  },
  
  // ==================== 向后兼容：mature 映射到 stable ====================
  mature: {
    stage: 'mature',
    bid: {
      intervalHours: 4,
      lookbackDays: 7,
      minClicksForAction: 20,
      maxAdjustmentPercent: 6,
      maxDailyAdjustmentPercent: 10,
    },
    negativeKeyword: {
      intervalHours: 8,
      minClicksToNegate: 10,
      minSpendToNegate: 5,
    },
    searchTermHarvest: {
      intervalHours: 12,
      minConversionsToHarvest: 2,
    },
    placement: {
      intervalHours: 12,
      minClicksForDecision: 50,
    },
    budget: {
      intervalHours: 4,
    },
    dayparting: {
      intervalHours: 1,
    },
    riskControl: {
      maxBidIncreasePercent: 6,
      maxBidDecreasePercent: 6,
      maxBudgetChangePercent: 20,
      consecutiveSlowdownThreshold: 3,
      emergencySalesDropThreshold: 0.40,
    },
  },
};

// ==================== 趋势计算逻辑 ====================

/**
 * v719: 计算趋势方向和强度
 * 比较近期表现与历史基线
 */
export function calculateTrend(
  recentMetric: number,
  baselineMetric: number
): { direction: 'rising' | 'flat' | 'falling'; strength: number; changeRate: number } {
  if (baselineMetric <= 0) {
    // 基线为0时，如果近期有数据则视为上升
    if (recentMetric > 0) {
      return { direction: 'rising', strength: 1.0, changeRate: 1.0 };
    }
    return { direction: 'flat', strength: 0, changeRate: 0 };
  }
  
  const changeRate = (recentMetric - baselineMetric) / baselineMetric;
  
  let direction: 'rising' | 'flat' | 'falling';
  if (changeRate >= TREND_CONFIG.risingThreshold) {
    direction = 'rising';
  } else if (changeRate <= TREND_CONFIG.fallingThreshold) {
    direction = 'falling';
  } else {
    direction = 'flat';
  }
  
  // 强度：变化率的绝对值，归一化到0-1
  const strength = Math.min(Math.abs(changeRate), 1.0);
  
  return { direction, strength, changeRate };
}

// ==================== 生命周期判断逻辑 ====================

/**
 * 判断单个广告活动的生命周期阶段
 * v719: 增加趋势感知，支持5阶段判断
 */
export function determineCampaignLifecycle(
  campaign: Record<string, unknown>,
  trendData?: {
    recentOrders?: number;
    baselineOrders?: number;
    recentAcos?: number;
    baselineAcos?: number;
    recentSales?: number;
    baselineSales?: number;
  }
): CampaignLifecycleInfo {
  const now = new Date();
  // @ts-expect-error Amazon API response type flexibility
  const createdAt = campaign.createdAt ? new Date(campaign.createdAt) : now;
  const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  
  // @ts-expect-error Amazon API response type flexibility
  const totalClicks = parseInt(campaign.clicks) || 0;
  // @ts-expect-error Amazon API response type flexibility
  const totalOrders = parseInt(campaign.orders) || 0;
  // @ts-expect-error Amazon API response type flexibility
  const totalImpressions = parseInt(campaign.impressions) || 0;
  
  let stage: LifecycleStage;
  let reason: string;
  let trendDirection: 'rising' | 'flat' | 'falling' = 'flat';
  let trendStrength = 0;
  
  // 计算趋势（如果有趋势数据）
  if (trendData) {
    const ordersTrend = calculateTrend(
      trendData.recentOrders || 0,
      trendData.baselineOrders || 0
    );
    const salesTrend = calculateTrend(
      trendData.recentSales || 0,
      trendData.baselineSales || 0
    );
    
    // 综合趋势：订单和销售额的加权平均
    const combinedChangeRate = (ordersTrend.changeRate * 0.6 + salesTrend.changeRate * 0.4);
    if (combinedChangeRate >= TREND_CONFIG.risingThreshold) {
      trendDirection = 'rising';
    } else if (combinedChangeRate <= TREND_CONFIG.fallingThreshold) {
      trendDirection = 'falling';
    } else {
      trendDirection = 'flat';
    }
    trendStrength = Math.min(Math.abs(combinedChangeRate), 1.0);
    
    // ACoS趋势检查（ACoS上升是负面信号）
    if (trendData.recentAcos !== undefined && trendData.baselineAcos !== undefined && trendData.baselineAcos > 0) {
      const acosChangeRate = (trendData.recentAcos - trendData.baselineAcos) / trendData.baselineAcos;
      if (acosChangeRate >= TREND_CONFIG.acosRisingThreshold) {
        // ACoS恶化：即使订单上升，也不应该判定为冲刺期
        if (trendDirection === 'rising') {
          trendDirection = 'flat'; // 降级为平稳
          reason = `ACoS恶化(+${(acosChangeRate * 100).toFixed(0)}%)抵消了订单增长`;
        }
      }
    }
  }
  
  // 阶段1: 判断是否为启动期（数据量不足）
  // v242f: 仅当创建时间<14天时才判定为启动期
  if (
    daysSinceCreation < LIFECYCLE_THRESHOLDS.launch.maxDays &&
    (totalClicks < LIFECYCLE_THRESHOLDS.launch.maxClicks ||
     totalOrders < LIFECYCLE_THRESHOLDS.launch.maxOrders)
  ) {
    stage = 'launch';
    const reasons: string[] = [];
    reasons.push(`创建仅${daysSinceCreation}天(<${LIFECYCLE_THRESHOLDS.launch.maxDays}天)`);
    if (totalClicks < LIFECYCLE_THRESHOLDS.launch.maxClicks) {
      reasons.push(`累计点击${totalClicks}次(<${LIFECYCLE_THRESHOLDS.launch.maxClicks}次)`);
    }
    if (totalOrders < LIFECYCLE_THRESHOLDS.launch.maxOrders) {
      reasons.push(`累计转化${totalOrders}次(<${LIFECYCLE_THRESHOLDS.launch.maxOrders}次)`);
    }
    reason = `启动期: ${reasons.join(', ')}`;
  }
  // 阶段2: 数据充足（超过growth标准），根据趋势判断具体阶段
  else if (
    daysSinceCreation >= LIFECYCLE_THRESHOLDS.growth.maxDays &&
    totalClicks >= LIFECYCLE_THRESHOLDS.growth.maxClicks &&
    totalOrders >= LIFECYCLE_THRESHOLDS.growth.maxOrders
  ) {
    // v719: 根据趋势方向细分为 scaling / stable / declining
    if (trendDirection === 'rising' && trendStrength >= 0.10) {
      stage = 'scaling';
      reason = `冲刺期: 运行${daysSinceCreation}天, ${totalClicks}次点击, ${totalOrders}次转化, 趋势上升(强度${(trendStrength * 100).toFixed(0)}%)`;
    } else if (trendDirection === 'falling' && trendStrength >= 0.10) {
      stage = 'declining';
      reason = `衰退期: 运行${daysSinceCreation}天, ${totalClicks}次点击, ${totalOrders}次转化, 趋势下降(强度${(trendStrength * 100).toFixed(0)}%)`;
    } else {
      stage = 'stable';
      reason = `平稳期: 运行${daysSinceCreation}天, ${totalClicks}次点击, ${totalOrders}次转化, 趋势平稳`;
    }
  }
  // 阶段3: 介于两者之间为成长期
  else {
    // v719: 成长期也可以根据趋势细分
    if (trendDirection === 'rising' && trendStrength >= 0.20 && totalClicks >= 100) {
      // 数据虽未完全充足，但趋势强劲上升，提前进入冲刺期
      stage = 'scaling';
      reason = `冲刺期(提前): 运行${daysSinceCreation}天, ${totalClicks}次点击, 强劲上升趋势(${(trendStrength * 100).toFixed(0)}%)`;
    } else {
      stage = 'growth';
      reason = `成长期: 运行${daysSinceCreation}天, ${totalClicks}次点击, ${totalOrders}次转化`;
    }
  }
  
  return {
    // @ts-expect-error Amazon API response type flexibility
    campaignId: campaign.campaignId,
    // @ts-expect-error Amazon API response type flexibility
    campaignName: campaign.campaignName || '',
    // @ts-expect-error Amazon API response type flexibility
    campaignType: campaign.campaignType || 'sp_manual',
    stage,
    reason,
    daysSinceCreation,
    totalClicks,
    totalOrders,
    totalImpressions,
    trendDirection,
    trendStrength,
  };
}

/**
 * 批量判断优化目标下所有广告活动的生命周期阶段
 * 返回该优化目标的"综合生命周期阶段"
 * 
 * v719: 综合判断逻辑升级
 * - 如果有任何launch阶段的campaign → 整体为launch
 * - 否则按多数投票 + 趋势加权决定
 */
export async function getTargetLifecycleStage(targetId: number): Promise<{
  overallStage: LifecycleStage;
  campaigns: CampaignLifecycleInfo[];
  config: LifecycleOptimizationConfig;
  summary: string;
}> {
  const campaigns = await db.getCampaignsByPerformanceGroupId(targetId);
  
  if (campaigns.length === 0) {
    return {
      overallStage: 'launch',
      campaigns: [],
      config: LIFECYCLE_CONFIGS.launch,
      summary: '无广告活动',
    };
  }
  
  // v719: 尝试获取趋势数据（如果数据库支持）
  // 目前使用无趋势数据的判断（向后兼容），趋势数据将在后续版本通过报告数据注入
  const lifecycleInfos = campaigns.map(c => determineCampaignLifecycle(c));
  
  // 综合判断
  let overallStage: LifecycleStage = 'stable';
  
  const launchCount = lifecycleInfos.filter(l => l.stage === 'launch').length;
  const growthCount = lifecycleInfos.filter(l => l.stage === 'growth').length;
  const scalingCount = lifecycleInfos.filter(l => l.stage === 'scaling').length;
  const stableCount = lifecycleInfos.filter(l => l.stage === 'stable' || l.stage === 'mature').length;
  const decliningCount = lifecycleInfos.filter(l => l.stage === 'declining').length;
  
  if (launchCount > 0) {
    // 有任何launch阶段的campaign → 整体保守
    overallStage = 'launch';
  } else if (scalingCount > growthCount && scalingCount > stableCount && scalingCount > decliningCount) {
    overallStage = 'scaling';
  } else if (decliningCount > growthCount && decliningCount > stableCount && decliningCount > scalingCount) {
    overallStage = 'declining';
  } else if (growthCount > stableCount) {
    overallStage = 'growth';
  } else {
    overallStage = 'stable';
  }
  
  const summary = `${campaigns.length}个广告活动: 启动=${launchCount}, 成长=${growthCount}, 冲刺=${scalingCount}, 平稳=${stableCount}, 衰退=${decliningCount} → 综合: ${overallStage}`;
  
  return {
    overallStage,
    campaigns: lifecycleInfos,
    config: LIFECYCLE_CONFIGS[overallStage],
    summary,
  };
}

/**
 * 获取特定广告活动的生命周期优化配置
 * 用于在执行优化时，根据单个广告活动的阶段获取对应参数
 */
export function getLifecycleConfig(stage: LifecycleStage): LifecycleOptimizationConfig {
  return LIFECYCLE_CONFIGS[stage];
}

/**
 * 根据广告类型调整回看窗口
 * SP: 使用配置的lookbackDays
 * SB/SD: 归因窗口14天，回看窗口至少14天
 */
export function getAdjustedLookbackDays(baseLookbackDays: number, campaignType: string): number {
  if (campaignType === 'sb' || campaignType === 'sd') {
    return Math.max(baseLookbackDays, 14);
  }
  return baseLookbackDays;
}

/**
 * 检查某个优化模块是否应该在当前时间执行
 * 基于上次执行时间和该阶段的执行间隔
 */
export function shouldExecuteModule(
  moduleName: 'bid' | 'negativeKeyword' | 'searchTermHarvest' | 'placement' | 'budget' | 'dayparting',
  lastExecutedAt: Date | null,
  stage: LifecycleStage
): { shouldExecute: boolean; reason: string; nextExecuteAt: Date | null } {
  const config = LIFECYCLE_CONFIGS[stage];
  
  let intervalHours: number;
  switch (moduleName) {
    case 'bid': intervalHours = config.bid.intervalHours; break;
    case 'negativeKeyword': intervalHours = config.negativeKeyword.intervalHours; break;
    case 'searchTermHarvest': intervalHours = config.searchTermHarvest.intervalHours; break;
    case 'placement': intervalHours = config.placement.intervalHours; break;
    case 'budget': intervalHours = config.budget.intervalHours; break;
    case 'dayparting': intervalHours = config.dayparting.intervalHours; break;
    default: intervalHours = 12;
  }
  
  if (!lastExecutedAt) {
    return {
      shouldExecute: true,
      reason: `首次执行 (${moduleName}, ${stage}阶段, 间隔${intervalHours}小时)`,
      nextExecuteAt: new Date(Date.now() + intervalHours * 60 * 60 * 1000),
    };
  }
  
  const now = new Date();
  const elapsedMs = now.getTime() - lastExecutedAt.getTime();
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  if (elapsedMs >= intervalMs) {
    return {
      shouldExecute: true,
      reason: `已过${Math.round(elapsedMs / (60 * 60 * 1000))}小时 >= ${intervalHours}小时间隔 (${stage}阶段)`,
      nextExecuteAt: new Date(now.getTime() + intervalMs),
    };
  }
  
  const nextExecuteAt = new Date(lastExecutedAt.getTime() + intervalMs);
  const remainingHours = Math.round((intervalMs - elapsedMs) / (60 * 60 * 1000) * 10) / 10;
  
  return {
    shouldExecute: false,
    reason: `距上次执行仅${Math.round(elapsedMs / (60 * 60 * 1000))}小时, 需等待${remainingHours}小时 (${stage}阶段, 间隔${intervalHours}小时)`,
    nextExecuteAt,
  };
}

/**
 * v719: 根据生命周期阶段获取风险控制参数
 * 供安全护栏和规则引擎使用
 */
export function getStageRiskControl(stage: LifecycleStage): LifecycleOptimizationConfig['riskControl'] {
  return LIFECYCLE_CONFIGS[stage].riskControl;
}

/**
 * v719: 根据生命周期阶段获取推荐的策略模板
 * 当用户未手动选择策略模板时，系统根据产品阶段自动推荐
 */
export function getRecommendedStrategyTemplate(stage: LifecycleStage): string {
  switch (stage) {
    case 'launch': return 'aggressive-growth';     // 新品推广，积极获取流量
    case 'scaling': return 'market-expansion';      // 冲刺期，市场扩张
    case 'growth': return 'balanced';               // 成长期，平衡策略
    case 'stable':
    case 'mature': return 'profit-focused';         // 平稳期，利润优先
    case 'declining': return 'decline-management';  // 衰退期，下滑管理
    default: return 'balanced';
  }
}

/**
 * 获取所有优化目标的生命周期概览（用于前端展示和调试）
 */
export async function getAllTargetsLifecycleOverview(accountId?: number): Promise<{
  targets: Array<{
    targetId: number;
    targetName: string;
    overallStage: LifecycleStage;
    campaignCount: number;
    launchCount: number;
    growthCount: number;
    scalingCount: number;
    stableCount: number;
    decliningCount: number;
    summary: string;
  }>;
}> {
  const groups = accountId
    ? await db.getPerformanceGroupsByAccountId(accountId)
    : await db.getPerformanceGroupsByAccountId(0);
  
  const targets: unknown[] = [];
  
  for (const group of groups) {
    if (group.status !== 'active') continue;
    
    const lifecycle = await getTargetLifecycleStage(group.id);
    targets.push({
      targetId: group.id,
      targetName: group.name,
      overallStage: lifecycle.overallStage,
      campaignCount: lifecycle.campaigns.length,
      // @ts-expect-error Dynamic property access
      launchCount: lifecycle.campaigns.filter(c => c.stage === 'launch').length,
      growthCount: lifecycle.campaigns.filter(c => c.stage === 'growth').length,
      scalingCount: lifecycle.campaigns.filter(c => c.stage === 'scaling').length,
      stableCount: lifecycle.campaigns.filter(c => c.stage === 'stable' || c.stage === 'mature').length,
      decliningCount: lifecycle.campaigns.filter(c => c.stage === 'declining').length,
      summary: lifecycle.summary,
    });
  }
  
  // @ts-expect-error Return type compatibility
  return { targets };
}
