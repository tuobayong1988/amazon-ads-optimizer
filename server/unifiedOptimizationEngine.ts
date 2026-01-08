/**
 * 统一自动优化引擎
 * 
 * 核心理念：算法决策执行，人只做监督
 * 
 * 整合以下功能：
 * 1. 广告自动化（N-Gram分析、漏斗迁移、流量隔离）
 * 2. 位置倾斜优化（基于智能优化算法）
 * 3. 分时策略（Dayparting）
 * 4. 智能竞价调整
 * 5. 纠错复盘
 * 6. 预算自动分配
 */

import { getDb } from "./db";
import { 
  campaigns, 
  performanceGroups, 
  keywords
} from "../drizzle/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

// 获取db实例
async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

// ==================== 类型定义 ====================

export type OptimizationType = 
  | 'bid_adjustment'      // 竞价调整
  | 'placement_tilt'      // 位置倾斜
  | 'dayparting'          // 分时策略
  | 'negative_keyword'    // 否定词
  | 'funnel_migration'    // 漏斗迁移
  | 'budget_reallocation' // 预算重分配
  | 'correction'          // 纠错复盘
  | 'traffic_isolation';  // 流量隔离

export type OptimizationStatus = 
  | 'pending'    // 待执行
  | 'approved'   // 已批准
  | 'executed'   // 已执行
  | 'rejected'   // 已拒绝
  | 'failed';    // 执行失败

export type AutoExecutionMode = 
  | 'full_auto'      // 全自动：算法决策并自动执行
  | 'semi_auto'      // 半自动：算法决策，人工确认后执行
  | 'manual'         // 手动：仅生成建议，不自动执行
  | 'disabled';      // 禁用

export interface OptimizationDecision {
  id: string;
  type: OptimizationType;
  targetType: 'campaign' | 'ad_group' | 'keyword' | 'asin' | 'performance_group';
  targetId: number;
  targetName: string;
  currentValue: string | number;
  suggestedValue: string | number;
  expectedImpact: {
    metric: string;
    currentValue: number;
    expectedValue: number;
    changePercent: number;
  };
  confidence: number;
  reasoning: string;
  status: OptimizationStatus;
  createdAt: Date;
  executedAt?: Date;
  executedBy?: 'auto' | 'manual';
}

export interface CampaignOptimizationState {
  campaignId: number;
  campaignName: string;
  autoOptimizationEnabled: boolean;
  executionMode: AutoExecutionMode;
  lastOptimizationAt?: Date;
  pendingDecisions: number;
  executedToday: number;
  performanceScore: number;
  optimizationTypes: {
    bidAdjustment: boolean;
    placementTilt: boolean;
    dayparting: boolean;
    negativeKeyword: boolean;
  };
}

export interface PerformanceGroupOptimizationState {
  groupId: number;
  groupName: string;
  autoOptimizationEnabled: boolean;
  executionMode: AutoExecutionMode;
  targetAcos?: number;
  targetRoas?: number;
  campaignCount: number;
  optimizedCampaigns: number;
  totalPendingDecisions: number;
  totalExecutedToday: number;
  overallPerformanceScore: number;
}

export interface OptimizationSummary {
  totalDecisions: number;
  pendingDecisions: number;
  executedToday: number;
  successRate: number;
  byType: Record<OptimizationType, {
    total: number;
    pending: number;
    executed: number;
    avgConfidence: number;
  }>;
  recentDecisions: OptimizationDecision[];
}

// ==================== 核心引擎 ====================

/**
 * 获取广告活动的优化状态
 */
export async function getCampaignOptimizationState(
  campaignId: number
): Promise<CampaignOptimizationState | null> {
  const db = await getDbInstance();
  
  const campaign = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  
  if (campaign.length === 0) return null;
  
  const c = campaign[0];
  
  // 获取今日执行的优化数量
  const executedToday = 0; // TODO: 从优化日志表获取
  
  // 计算绩效得分（基于ACoS和ROAS）
  const acos = c.spend && c.sales 
    ? (Number(c.spend) / Number(c.sales)) * 100 
    : 0;
  const roas = c.spend && c.sales 
    ? Number(c.sales) / Number(c.spend) 
    : 0;
  
  // 绩效得分：ROAS越高越好，ACoS越低越好
  const performanceScore = Math.min(100, Math.max(0, 
    (roas * 20) + (100 - acos)
  ));
  
  return {
    campaignId: c.id,
    campaignName: c.campaignName,
    autoOptimizationEnabled: true, // 默认启用
    executionMode: 'semi_auto', // 默认半自动
    lastOptimizationAt: undefined, // TODO: 从日志获取
    pendingDecisions: 0, // TODO: 从决策表获取
    executedToday,
    performanceScore,
    optimizationTypes: {
      bidAdjustment: true,
      placementTilt: true,
      dayparting: true,
      negativeKeyword: true
    }
  };
}

/**
 * 获取绩效组的优化状态
 */
export async function getPerformanceGroupOptimizationState(
  groupId: number
): Promise<PerformanceGroupOptimizationState | null> {
  const db = await getDbInstance();
  
  const group = await db
    .select()
    .from(performanceGroups)
    .where(eq(performanceGroups.id, groupId))
    .limit(1);
  
  if (group.length === 0) return null;
  
  const g = group[0];
  
  // 获取组内广告活动
  const groupCampaigns = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.performanceGroupId, groupId));
  
  // 计算整体绩效得分
  let totalSpend = 0;
  let totalSales = 0;
  for (const c of groupCampaigns) {
    totalSpend += Number(c.spend) || 0;
    totalSales += Number(c.sales) || 0;
  }
  
  const overallRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const overallAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
  const overallPerformanceScore = Math.min(100, Math.max(0, 
    (overallRoas * 20) + (100 - overallAcos)
  ));
  
  return {
    groupId: g.id,
    groupName: g.name,
    autoOptimizationEnabled: true,
    executionMode: 'semi_auto',
    targetAcos: g.targetAcos ? Number(g.targetAcos) : undefined,
    targetRoas: g.targetRoas ? Number(g.targetRoas) : undefined,
    campaignCount: groupCampaigns.length,
    optimizedCampaigns: groupCampaigns.length, // TODO: 统计实际优化的数量
    totalPendingDecisions: 0,
    totalExecutedToday: 0,
    overallPerformanceScore
  };
}

/**
 * 运行统一优化分析
 * 这是核心函数，整合所有优化算法
 */
export async function runUnifiedOptimizationAnalysis(
  accountId: number,
  options: {
    campaignIds?: number[];
    performanceGroupIds?: number[];
    optimizationTypes?: OptimizationType[];
  } = {}
): Promise<OptimizationDecision[]> {
  const db = await getDbInstance();
  const decisions: OptimizationDecision[] = [];
  
  // 获取需要分析的广告活动
  let targetCampaigns;
  if (options.campaignIds && options.campaignIds.length > 0) {
    targetCampaigns = await db
      .select()
      .from(campaigns)
      .where(sql`${campaigns.id} IN (${options.campaignIds.join(',')})`);
  } else if (options.performanceGroupIds && options.performanceGroupIds.length > 0) {
    targetCampaigns = await db
      .select()
      .from(campaigns)
      .where(sql`${campaigns.performanceGroupId} IN (${options.performanceGroupIds.join(',')})`);
  } else {
    targetCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.campaignStatus, 'enabled'))
      .limit(100);
  }
  
  const types = options.optimizationTypes || [
    'bid_adjustment',
    'placement_tilt',
    'dayparting',
    'negative_keyword'
  ];
  
  for (const campaign of targetCampaigns) {
    // 1. 竞价调整分析
    if (types.includes('bid_adjustment')) {
      const bidDecisions = await analyzeBidAdjustments(campaign);
      decisions.push(...bidDecisions);
    }
    
    // 2. 位置倾斜分析
    if (types.includes('placement_tilt')) {
      const placementDecisions = await analyzePlacementTilt(campaign);
      decisions.push(...placementDecisions);
    }
    
    // 3. 分时策略分析
    if (types.includes('dayparting')) {
      const daypartingDecisions = await analyzeDayparting(campaign);
      decisions.push(...daypartingDecisions);
    }
    
    // 4. 否定词分析
    if (types.includes('negative_keyword')) {
      const negativeDecisions = await analyzeNegativeKeywords(campaign);
      decisions.push(...negativeDecisions);
    }
  }
  
  return decisions;
}

/**
 * 分析竞价调整
 */
async function analyzeBidAdjustments(campaign: any): Promise<OptimizationDecision[]> {
  const db = await getDbInstance();
  const decisions: OptimizationDecision[] = [];
  
  // 获取广告活动的关键词
  const campaignKeywords = await db
    .select()
    .from(keywords)
    .where(sql`${keywords.adGroupId} IN (SELECT id FROM ad_groups WHERE campaign_id = ${campaign.id})`);
  
  for (const kw of campaignKeywords) {
    const clicks = Number(kw.clicks) || 0;
    const orders = Number(kw.orders) || 0;
    const spend = Number(kw.spend) || 0;
    const sales = Number(kw.sales) || 0;
    const currentBid = Number(kw.bid) || 0;
    
    if (clicks < 10) continue; // 数据不足
    
    const cvr = clicks > 0 ? orders / clicks : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : 999;
    const cpc = clicks > 0 ? spend / clicks : 0;
    
    // 计算建议出价（基于利润最大化公式）
    const aov = orders > 0 ? sales / orders : 30; // 默认AOV
    const targetAcos = 30; // 目标ACoS
    const optimalBid = cvr * aov * (targetAcos / 100);
    
    // 如果建议出价与当前出价差异超过10%，生成决策
    const bidDiff = Math.abs(optimalBid - currentBid) / currentBid;
    if (bidDiff > 0.1 && optimalBid > 0.1) {
      const expectedAcos = optimalBid > 0 ? (optimalBid / (cvr * aov)) * 100 : acos;
      
      decisions.push({
        id: `bid_${campaign.id}_${kw.id}_${Date.now()}`,
        type: 'bid_adjustment',
        targetType: 'keyword',
        targetId: kw.id,
        targetName: kw.keywordText || `关键词 ${kw.id}`,
        currentValue: currentBid,
        suggestedValue: Math.round(optimalBid * 100) / 100,
        expectedImpact: {
          metric: 'ACoS',
          currentValue: acos,
          expectedValue: expectedAcos,
          changePercent: ((expectedAcos - acos) / acos) * 100
        },
        confidence: Math.min(0.95, 0.5 + (clicks / 100) * 0.45),
        reasoning: `基于利润最大化公式计算：CVR=${(cvr*100).toFixed(2)}%, AOV=$${aov.toFixed(2)}, 目标ACoS=${targetAcos}%`,
        status: 'pending',
        createdAt: new Date()
      });
    }
  }
  
  return decisions;
}

/**
 * 分析位置倾斜
 */
async function analyzePlacementTilt(campaign: any): Promise<OptimizationDecision[]> {
  const decisions: OptimizationDecision[] = [];
  
  // 获取当前位置调整设置
  const currentTopSearch = Number(campaign.topOfSearchBidAdjustment) || 0;
  const currentProductPage = Number(campaign.productPageBidAdjustment) || 0;
  
  // 基于智能优化策略：设置较低的位置调整，让基础出价更精确控制
  // 建议范围：0-50%
  const suggestedTopSearch = Math.min(50, Math.max(0, currentTopSearch));
  const suggestedProductPage = Math.min(50, Math.max(0, currentProductPage));
  
  // 如果当前设置过高，建议降低
  if (currentTopSearch > 50) {
    decisions.push({
      id: `placement_top_${campaign.id}_${Date.now()}`,
      type: 'placement_tilt',
      targetType: 'campaign',
      targetId: campaign.id,
      targetName: campaign.campaignName,
      currentValue: currentTopSearch,
      suggestedValue: suggestedTopSearch,
      expectedImpact: {
        metric: '位置调整',
        currentValue: currentTopSearch,
        expectedValue: suggestedTopSearch,
        changePercent: ((suggestedTopSearch - currentTopSearch) / currentTopSearch) * 100
      },
      confidence: 0.85,
      reasoning: '智能优化策略：设置较低的位置调整（0-50%），让基础出价更精确控制竞价对象',
      status: 'pending',
      createdAt: new Date()
    });
  }
  
  if (currentProductPage > 50) {
    decisions.push({
      id: `placement_product_${campaign.id}_${Date.now()}`,
      type: 'placement_tilt',
      targetType: 'campaign',
      targetId: campaign.id,
      targetName: campaign.campaignName,
      currentValue: currentProductPage,
      suggestedValue: suggestedProductPage,
      expectedImpact: {
        metric: '位置调整',
        currentValue: currentProductPage,
        expectedValue: suggestedProductPage,
        changePercent: ((suggestedProductPage - currentProductPage) / currentProductPage) * 100
      },
      confidence: 0.85,
      reasoning: '智能优化策略：设置较低的位置调整（0-50%），让基础出价更精确控制竞价对象',
      status: 'pending',
      createdAt: new Date()
    });
  }
  
  return decisions;
}

/**
 * 分析分时策略
 */
async function analyzeDayparting(campaign: any): Promise<OptimizationDecision[]> {
  const decisions: OptimizationDecision[] = [];
  
  // 分时策略分析需要历史时段数据
  // 这里简化处理，实际应该分析2小时时段的表现数据
  
  // 示例：如果某时段表现差，建议降低出价
  const poorPerformingHours = [2, 3, 4, 5]; // 凌晨时段通常表现较差
  
  decisions.push({
    id: `daypart_${campaign.id}_${Date.now()}`,
    type: 'dayparting',
    targetType: 'campaign',
    targetId: campaign.id,
    targetName: campaign.campaignName,
    currentValue: '无分时策略',
    suggestedValue: '凌晨2-6点降低50%出价',
    expectedImpact: {
      metric: 'ACoS',
      currentValue: 0,
      expectedValue: -10,
      changePercent: -10
    },
    confidence: 0.75,
    reasoning: `凌晨${poorPerformingHours.join(',')}点通常转化率较低，建议降低出价以减少浪费`,
    status: 'pending',
    createdAt: new Date()
  });
  
  return decisions;
}

/**
 * 分析否定词
 */
async function analyzeNegativeKeywords(campaign: any): Promise<OptimizationDecision[]> {
  const db = await getDbInstance();
  const decisions: OptimizationDecision[] = [];
  
  // 获取表现差的关键词（高花费低转化）
  const poorKeywords = await db
    .select()
    .from(keywords)
    .where(and(
      sql`${keywords.adGroupId} IN (SELECT id FROM ad_groups WHERE campaign_id = ${campaign.id})`,
      sql`${keywords.clicks} > 20`,
      sql`${keywords.orders} = 0`
    ))
    .limit(10);
  
  for (const kw of poorKeywords) {
    decisions.push({
      id: `negative_${campaign.id}_${kw.id}_${Date.now()}`,
      type: 'negative_keyword',
      targetType: 'keyword',
      targetId: kw.id,
      targetName: kw.keywordText || `关键词 ${kw.id}`,
      currentValue: '正常投放',
      suggestedValue: '添加为否定词',
      expectedImpact: {
        metric: '花费',
        currentValue: Number(kw.spend) || 0,
        expectedValue: 0,
        changePercent: -100
      },
      confidence: 0.9,
      reasoning: `该关键词已获得${kw.clicks}次点击但0转化，花费$${kw.spend}，建议添加为否定词`,
      status: 'pending',
      createdAt: new Date()
    });
  }
  
  return decisions;
}

/**
 * 执行优化决策
 */
export async function executeOptimizationDecision(
  decisionId: string,
  executedBy: 'auto' | 'manual' = 'manual'
): Promise<{ success: boolean; message: string }> {
  // TODO: 实现实际的执行逻辑
  // 1. 根据决策类型调用相应的API
  // 2. 记录执行日志
  // 3. 更新决策状态
  
  return {
    success: true,
    message: `决策 ${decisionId} 已${executedBy === 'auto' ? '自动' : '手动'}执行`
  };
}

/**
 * 批量执行优化决策
 */
export async function batchExecuteOptimizationDecisions(
  decisionIds: string[],
  executedBy: 'auto' | 'manual' = 'manual'
): Promise<{ success: number; failed: number; results: Array<{ id: string; success: boolean; message: string }> }> {
  const results: Array<{ id: string; success: boolean; message: string }> = [];
  let success = 0;
  let failed = 0;
  
  for (const id of decisionIds) {
    const result = await executeOptimizationDecision(id, executedBy);
    results.push({ id, ...result });
    if (result.success) {
      success++;
    } else {
      failed++;
    }
  }
  
  return { success, failed, results };
}

/**
 * 获取优化摘要
 */
export async function getOptimizationSummary(
  accountId: number,
  options: {
    campaignId?: number;
    performanceGroupId?: number;
    dateRange?: { start: Date; end: Date };
  } = {}
): Promise<OptimizationSummary> {
  // TODO: 从数据库获取实际数据
  
  return {
    totalDecisions: 0,
    pendingDecisions: 0,
    executedToday: 0,
    successRate: 0,
    byType: {
      bid_adjustment: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      placement_tilt: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      dayparting: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      negative_keyword: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      funnel_migration: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      budget_reallocation: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      correction: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      traffic_isolation: { total: 0, pending: 0, executed: 0, avgConfidence: 0 }
    },
    recentDecisions: []
  };
}

/**
 * 更新广告活动的自动优化设置
 */
export async function updateCampaignOptimizationSettings(
  campaignId: number,
  settings: {
    autoOptimizationEnabled?: boolean;
    executionMode?: AutoExecutionMode;
    optimizationTypes?: {
      bidAdjustment?: boolean;
      placementTilt?: boolean;
      dayparting?: boolean;
      negativeKeyword?: boolean;
    };
  }
): Promise<{ success: boolean }> {
  // TODO: 保存设置到数据库
  return { success: true };
}

/**
 * 更新绩效组的自动优化设置
 */
export async function updatePerformanceGroupOptimizationSettings(
  groupId: number,
  settings: {
    autoOptimizationEnabled?: boolean;
    executionMode?: AutoExecutionMode;
    targetAcos?: number;
    targetRoas?: number;
  }
): Promise<{ success: boolean }> {
  // TODO: 保存设置到数据库
  return { success: true };
}
