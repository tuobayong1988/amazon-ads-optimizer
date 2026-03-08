/**
 * Campaign Lifecycle Service - 广告活动生命周期判断服务
 * 
 * v143: 根据广告活动的数据积累状况，将其分为"启动期"和"成熟期"，
 * 并为不同阶段提供差异化的优化频率、数据阈值和调整幅度配置。
 * 
 * 核心设计原则：
 * - 新广告活动（低竞价、低预算起步）→ 高频检查 + 宽松阈值 + 小幅调整 → 快速迭代探索
 * - 成熟广告活动（数据充足）→ 低频检查 + 严格阈值 + 正常调整幅度 → 稳定高效优化
 */

import * as db from '../db';

// ==================== 生命周期阶段定义 ====================

export type LifecycleStage = 'launch' | 'growth' | 'mature';

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
}

// ==================== 阶段切换标准 ====================

/**
 * 生命周期阶段判断标准
 * 
 * 启动期 (Launch): 新创建的、数据极度不足的广告活动
 *   - 创建时间 < 14天，或
 *   - 累计点击 < 50次，或
 *   - 累计转化 < 5次
 * 
 * 成长期 (Growth): 有一定数据但尚未稳定
 *   - 创建时间 14-30天，且
 *   - 累计点击 50-200次，且
 *   - 累计转化 5-20次
 * 
 * 成熟期 (Mature): 数据充足，可以做精细化优化
 *   - 创建时间 ≥ 30天，且
 *   - 累计点击 ≥ 200次，且
 *   - 累计转化 ≥ 20次
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
  // mature: 超过growth的所有标准
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
}

/**
 * 各生命周期阶段的优化参数配置
 */
export const LIFECYCLE_CONFIGS: Record<LifecycleStage, LifecycleOptimizationConfig> = {
  
  // ==================== 启动期：高频探索，小步快跑 ====================
  launch: {
    stage: 'launch',
    bid: {
      intervalHours: 2,           // v242f: 每2小时检查一次（与调度器频率一致），避免部署重启导致跳过
      lookbackDays: 3,            // 只看近3天数据，快速迭代
      minClicksForAction: 5,     // 5次点击就可以做初步判断
      maxAdjustmentPercent: 10,   // 单次最多调整10%，小步快跑
      maxDailyAdjustmentPercent: 20, // 24小时最多累计调整20%
    },
    negativeKeyword: {
      intervalHours: 12,          // v337.4: 48h→12h，启动期也需要及时否定高花费零转化词
      minClicksToNegate: 15,     // 需要15次点击且0转化才否定
      minSpendToNegate: 10,      // 或花费超过$10且0转化
    },
    searchTermHarvest: {
      intervalHours: 24,          // v337.4: 72h→24h，加速高转化词的收割
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
  },
  
  // ==================== 成长期：中频调整，逐步收紧 ====================
  growth: {
    stage: 'growth',
    bid: {
      intervalHours: 6,           // 每6小时，数据开始积累
      lookbackDays: 7,            // 看7天数据
      minClicksForAction: 10,    // 10次点击才调整
      maxAdjustmentPercent: 15,   // 单次最多15%
      maxDailyAdjustmentPercent: 25,
    },
    negativeKeyword: {
      intervalHours: 8,           // v337.4: 24h→8h，成长期每8小时检查一次否定
      minClicksToNegate: 12,     // 12次点击且0转化
      minSpendToNegate: 8,
    },
    searchTermHarvest: {
      intervalHours: 12,          // v337.4: 48h→12h，成长期每12小时收割一次
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
  },
  
  // ==================== 成熟期：低频稳优，精细化调整 ====================
  mature: {
    stage: 'mature',
    bid: {
      intervalHours: 12,          // 每12小时，数据稳定无需频繁干预
      lookbackDays: 7,            // SP看7天（SB/SD会在执行时扩展到14天）
      minClicksForAction: 20,    // 20次点击才调整，确保统计显著性
      maxAdjustmentPercent: 20,   // 单次最多20%，基于稳定数据可以大胆调整
      maxDailyAdjustmentPercent: 30,
    },
    negativeKeyword: {
      intervalHours: 8,           // v337.4: 24h→8h，成熟期每8小时检查一次否定
      minClicksToNegate: 10,     // 10次点击且0转化即否定
      minSpendToNegate: 5,
    },
    searchTermHarvest: {
      intervalHours: 12,          // v337.4: 24h→12h，成熟期每12小时收割一次
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
  },
};

// ==================== 生命周期判断逻辑 ====================

/**
 * 判断单个广告活动的生命周期阶段
 */
export function determineCampaignLifecycle(campaign: Record<string, unknown>): CampaignLifecycleInfo {
  const now = new Date();
  const createdAt = campaign.createdAt ? new Date(campaign.createdAt) : now;
  const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  
  const totalClicks = parseInt(campaign.clicks) || 0;
  const totalOrders = parseInt(campaign.orders) || 0;
  const totalImpressions = parseInt(campaign.impressions) || 0;
  
  let stage: LifecycleStage;
  let reason: string;
  
  // v242f: 判断逻辑优化 - 仅当创建时间<14天时才判定为启动期
  // 之前使用OR逻辑，导致转化次数不足的老广告也被判定为launch，受到4小时间隔限制
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
  // 判断是否为成熟期：所有条件都超过growth标准
  else if (
    daysSinceCreation >= LIFECYCLE_THRESHOLDS.growth.maxDays &&
    totalClicks >= LIFECYCLE_THRESHOLDS.growth.maxClicks &&
    totalOrders >= LIFECYCLE_THRESHOLDS.growth.maxOrders
  ) {
    stage = 'mature';
    reason = `成熟期: 运行${daysSinceCreation}天, ${totalClicks}次点击, ${totalOrders}次转化`;
  }
  // 介于两者之间为成长期
  else {
    stage = 'growth';
    reason = `成长期: 运行${daysSinceCreation}天, ${totalClicks}次点击, ${totalOrders}次转化`;
  }
  
  return {
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName || '',
    campaignType: campaign.campaignType || 'sp_manual',
    stage,
    reason,
    daysSinceCreation,
    totalClicks,
    totalOrders,
    totalImpressions,
  };
}

/**
 * 批量判断优化目标下所有广告活动的生命周期阶段
 * 返回该优化目标的"综合生命周期阶段"（取最保守的阶段）
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
  
  const lifecycleInfos = campaigns.map(c => determineCampaignLifecycle(c));
  
  // 综合判断：如果有任何一个广告活动处于启动期，整个目标按启动期处理
  // 这确保新广告活动不会因为同组的成熟广告活动而被忽略
  let overallStage: LifecycleStage = 'mature';
  
  const launchCount = lifecycleInfos.filter(l => l.stage === 'launch').length;
  const growthCount = lifecycleInfos.filter(l => l.stage === 'growth').length;
  const matureCount = lifecycleInfos.filter(l => l.stage === 'mature').length;
  
  if (launchCount > 0) {
    overallStage = 'launch';
  } else if (growthCount > 0) {
    overallStage = 'growth';
  }
  
  const summary = `${campaigns.length}个广告活动: 启动期=${launchCount}, 成长期=${growthCount}, 成熟期=${matureCount} → 综合阶段: ${overallStage}`;
  
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
    matureCount: number;
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
      launchCount: lifecycle.campaigns.filter(c => c.stage === 'launch').length,
      growthCount: lifecycle.campaigns.filter(c => c.stage === 'growth').length,
      matureCount: lifecycle.campaigns.filter(c => c.stage === 'mature').length,
      summary: lifecycle.summary,
    });
  }
  
  return { targets };
}
