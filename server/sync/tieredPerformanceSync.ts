/**
 * v679: 分层绩效同步引擎 - Tiered Performance Sync
 * 
 * 核心优化：
 * 1. 基于归因窗口的冷热数据分层：
 *    - hot层：最近7天（SP归因窗口）/ 最近14天（SB/SD归因窗口）
 *    - warm层：8-30天（SP）/ 15-30天（SB/SD）
 *    - cold层：31-60天
 *    - archive层：61-95天（仅SP）
 * 
 * 2. 跨批并行报告提交：
 *    - 将所有时间切片的报告一次性提交到Amazon
 *    - 统一轮询所有报告状态
 *    - 从"N批串行等待"变为"所有报告并行提交+统一轮询"
 * 
 * 3. 新账户渐进式初始化：
 *    - 第一阶段：7天热数据（立即可用）
 *    - 第二阶段：8-30天温数据
 *    - 第三阶段：31-95天冷数据
 *    - 每阶段独立失败、独立重试
 * 
 * 性能目标：
 * - 全量同步：从2.5小时缩短至10分钟以内
 * - 增量同步：3分钟以内
 */

import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('TieredPerfSync');

// ==================== 分层配置 ====================

/** 广告类型的归因窗口天数 */
const ATTRIBUTION_WINDOWS = {
  SP: 7,   // SP广告7天归因窗口
  SB: 14,  // SB广告14天归因窗口
  SD: 14,  // SD广告14天归因窗口
} as const;

/** 数据保留期限（天） */
const RETENTION_LIMITS = {
  SP: 90,  // SP支持95天，留5天缓冲
  SB: 55,  // SB保留约60天，留5天缓冲
  SD: 58,  // SD保留约65天，留7天缓冲
} as const;

/** 同步层级定义 */
export interface SyncTier {
  name: string;
  startDay: number;
  endDay: number;
  sliceDays: number;  // 每个切片的天数
  description: string;
}

/** 分层配置 - 根据同步模式选择不同层级 */
const TIER_DEFINITIONS: Record<string, SyncTier> = {
  hot: {
    name: '热数据层',
    startDay: 0,
    endDay: 14,
    sliceDays: 7,
    description: '归因窗口内数据，每次同步必须更新',
  },
  warm: {
    name: '温数据层',
    startDay: 15,
    endDay: 30,
    sliceDays: 15,
    description: '近期历史数据，每日更新一次',
  },
  cold: {
    name: '冷数据层',
    startDay: 31,
    endDay: 60,
    sliceDays: 30,
    description: '中期历史数据，数据基本稳定',
  },
  archive: {
    name: '归档数据层',
    startDay: 61,
    endDay: 95,
    sliceDays: 35,
    description: '长期历史数据，仅SP可用',
  },
};

/** 同步模式 → 需要处理的层级 */
const SYNC_MODE_TIERS: Record<string, string[]> = {
  // 高频同步（每10分钟）：仅热数据
  high: ['hot'],
  // 中频同步（每30分钟）：热数据 + 温数据
  medium: ['hot', 'warm'],
  // 全量同步（每日/手动）：所有层级
  full: ['hot', 'warm', 'cold', 'archive'],
  // 夜间同步：所有层级
  nightly: ['hot', 'warm', 'cold', 'archive'],
};

/** 新账户初始化阶段 */
const INIT_PHASES = [
  { name: 'phase1_hot', tiers: ['hot'], description: '第一阶段：最近14天热数据' },
  { name: 'phase2_warm', tiers: ['warm'], description: '第二阶段：15-30天温数据' },
  { name: 'phase3_cold', tiers: ['cold', 'archive'], description: '第三阶段：31-95天冷数据' },
];

// ==================== 日期切片生成 ====================

interface DateSlice {
  startDate: string;
  endDate: string;
  tier: string;
  adTypes: ('SP' | 'SB' | 'SD')[];
}

/**
 * 根据同步模式和广告类型生成日期切片
 * 核心优化：自动根据各广告类型的数据保留期过滤不可用的切片
 */
export function generateDateSlices(
  syncMode: string,
  marketplace: string,
  rangeEndDate: string,
  options?: {
    customDays?: number;  // 自定义总天数（覆盖模式默认值）
    initPhase?: string;   // 初始化阶段名
  }
): DateSlice[] {
  const slices: DateSlice[] = [];
  
  // 确定要处理的层级
  let tierNames: string[];
  if (options?.initPhase) {
    const phase = INIT_PHASES.find(p => p.name === options.initPhase);
    tierNames = phase ? phase.tiers : ['hot'];
  } else {
    tierNames = SYNC_MODE_TIERS[syncMode] || SYNC_MODE_TIERS.full;
  }
  
  const endDate = new Date(rangeEndDate);
  
  for (const tierName of tierNames) {
    const tier = TIER_DEFINITIONS[tierName];
    if (!tier) continue;
    
    // 如果指定了customDays，调整endDay
    const effectiveEndDay = options?.customDays 
      ? Math.min(tier.endDay, options.customDays) 
      : tier.endDay;
    
    if (tier.startDay >= effectiveEndDay) continue;
    
    let currentDay = tier.startDay;
    while (currentDay < effectiveEndDay) {
      const sliceEndDay = Math.min(currentDay + tier.sliceDays, effectiveEndDay);
      
      // 计算日期
      const sliceStart = new Date(endDate);
      sliceStart.setDate(sliceStart.getDate() - sliceEndDay + 1);
      
      const sliceEnd = new Date(endDate);
      sliceEnd.setDate(sliceEnd.getDate() - currentDay);
      
      const startStr = sliceStart.toISOString().split('T')[0];
      const endStr = sliceEnd.toISOString().split('T')[0];
      
      // 确定哪些广告类型在此时间范围内有数据
      const adTypes: ('SP' | 'SB' | 'SD')[] = [];
      if (sliceEndDay <= RETENTION_LIMITS.SP) adTypes.push('SP');
      if (sliceEndDay <= RETENTION_LIMITS.SB) adTypes.push('SB');
      if (sliceEndDay <= RETENTION_LIMITS.SD) adTypes.push('SD');
      
      if (adTypes.length > 0 && startStr <= endStr) {
        slices.push({
          startDate: startStr,
          endDate: endStr,
          tier: tierName,
          adTypes,
        });
      }
      
      currentDay = sliceEndDay;
    }
  }
  
  return slices;
}

// ==================== 跨批并行报告提交 ====================

interface ReportRequest {
  name: string;
  requestFn: () => Promise<string>;
  slice: DateSlice;
  adType: string;
}

/**
 * v679: 跨批并行绩效同步
 * 
 * 核心改进：将所有时间切片的所有广告类型报告一次性提交到Amazon，然后统一轮询
 * 
 * 之前的流程（v678）：
 *   for each batch (14批):
 *     submit SP+SB+SD reports (3个)
 *     wait for all 3 to complete (串行等待)
 *   总耗时 = 14批 × 5-7分钟/批 = 70-100分钟
 * 
 * 优化后的流程（v679）：
 *   submit ALL reports at once (14批 × 3类型 = 42个报告)
 *   poll ALL reports simultaneously
 *   总耗时 = max(单个报告生成时间) + 轮询开销 ≈ 5-10分钟
 */
export function buildAllReportRequests(
  slices: DateSlice[],
  client: {
    requestSpCampaignReport: (start: string, end: string) => Promise<string>;
    requestSbCampaignReport: (start: string, end: string) => Promise<string>;
    requestSdCampaignReport: (start: string, end: string) => Promise<string>;
  }
): ReportRequest[] {
  const requests: ReportRequest[] = [];
  
  for (const slice of slices) {
    for (const adType of slice.adTypes) {
      let requestFn: () => Promise<string>;
      switch (adType) {
        case 'SP':
          requestFn = () => client.requestSpCampaignReport(slice.startDate, slice.endDate);
          break;
        case 'SB':
          requestFn = () => client.requestSbCampaignReport(slice.startDate, slice.endDate);
          break;
        case 'SD':
          requestFn = () => client.requestSdCampaignReport(slice.startDate, slice.endDate);
          break;
        default:
          continue;
      }
      
      requests.push({
        name: `${adType}绩效[${slice.tier}](${slice.startDate}~${slice.endDate})`,
        requestFn,
        slice,
        adType,
      });
    }
  }
  
  log.info(`[v679] 生成${requests.length}个报告请求: ${slices.length}个时间切片 × 多广告类型`);
  return requests;
}

/**
 * v679: 同样为关键词/定位/广告组绩效生成跨批并行请求
 */
export function buildKeywordReportRequests(
  slices: DateSlice[],
  client: {
    requestSpKeywordReport: (start: string, end: string) => Promise<string>;
  }
): ReportRequest[] {
  const requests: ReportRequest[] = [];
  
  // 关键词绩效只有SP
  for (const slice of slices) {
    if (!slice.adTypes.includes('SP')) continue;
    
    requests.push({
      name: `SP关键词绩效[${slice.tier}](${slice.startDate}~${slice.endDate})`,
      requestFn: () => client.requestSpKeywordReport(slice.startDate, slice.endDate),
      slice,
      adType: 'SP',
    });
  }
  
  return requests;
}

export function buildTargetReportRequests(
  slices: DateSlice[],
  client: {
    requestSpTargetReport: (start: string, end: string) => Promise<string>;
  }
): ReportRequest[] {
  const requests: ReportRequest[] = [];
  
  for (const slice of slices) {
    if (!slice.adTypes.includes('SP')) continue;
    
    requests.push({
      name: `SP定位绩效[${slice.tier}](${slice.startDate}~${slice.endDate})`,
      requestFn: () => client.requestSpTargetReport(slice.startDate, slice.endDate),
      slice,
      adType: 'SP',
    });
  }
  
  return requests;
}

// ==================== 新账户渐进式初始化 ====================

/**
 * v679: 获取初始化阶段配置
 */
export function getInitPhases() {
  return INIT_PHASES;
}

/**
 * v679: 判断是否需要初始化同步（新账户/新授权）
 */
export async function needsInitialization(accountId: number, db: unknown): Promise<boolean> {
  try {
    // @ts-ignore - dynamic db access
    const { dailyPerformance } = await import('../../drizzle/schema');
    // @ts-ignore - dynamic db access
    const result = await db.select({ count: (await import('drizzle-orm')).sql`COUNT(*)` })
      .from(dailyPerformance)
      // @ts-ignore - dynamic db access
      .where((await import('drizzle-orm')).eq(dailyPerformance.accountId, accountId));
    const count = result[0]?.count || 0;
    // 如果绩效数据少于100条，认为需要初始化
    return count < 100;
  } catch {
    return false;
  }
}

/**
 * v679: 获取同步模式的层级描述（用于日志）
 */
export function describeSyncPlan(syncMode: string, slices: DateSlice[]): string {
  const tierCounts: Record<string, number> = {};
  const adTypeCounts: Record<string, number> = {};
  
  for (const slice of slices) {
    tierCounts[slice.tier] = (tierCounts[slice.tier] || 0) + 1;
    for (const at of slice.adTypes) {
      adTypeCounts[at] = (adTypeCounts[at] || 0) + 1;
    }
  }
  
  const tierDesc = Object.entries(tierCounts).map(([t, c]) => `${t}:${c}切片`).join(', ');
  const adDesc = Object.entries(adTypeCounts).map(([t, c]) => `${t}:${c}`).join(', ');
  
  return `模式=${syncMode} | 层级=[${tierDesc}] | 广告类型=[${adDesc}] | 总切片=${slices.length}`;
}

// ==================== 导出配置常量 ====================

export {
  ATTRIBUTION_WINDOWS,
  RETENTION_LIMITS,
  TIER_DEFINITIONS,
  SYNC_MODE_TIERS,
};
