/**
 * 分层优化架构 - 策略编排器
 * 
 * 三层架构:
 * 1. 战略层 (Strategic Layer) - 产品生命周期识别和主策略选择
 * 2. 战术层 (Tactical Layer) - 次要策略和事件策略叠加
 * 3. 执行层 (Execution Layer) - 统一优化执行引擎
 */

import { getDb } from '../db';
import { campaigns, dailyPerformance } from '../../drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

// 产品生命周期阶段
export enum ProductLifecycleStage {
  NEW_LAUNCH = 'new_launch',        // 新品推广期 (0-3个月)
  GROWTH = 'growth',                 // 成长期 (3-12个月)
  MATURITY = 'maturity',             // 成熟期 (12个月+)
  DECLINE = 'decline',               // 衰退期
}

// 策略优先级
export enum StrategyPriority {
  PRIMARY = 'primary',     // 主策略
  SECONDARY = 'secondary', // 次要策略
  EVENT = 'event',         // 事件策略
}

// 策略配置
export interface StrategyConfig {
  templateId: string;
  priority: StrategyPriority;
  weight: number; // 0-1, 策略权重
  active: boolean;
  startDate?: Date;
  endDate?: Date;
}

// 综合优化目标
export interface OptimizationObjective {
  targetAcos: number;
  minAcos: number;
  maxAcos: number;
  bidMultiplier: number;
  budgetMultiplier: number;
  aggressiveness: number; // 0-1, 激进程度
}

// 生命周期识别结果
export interface LifecycleAnalysis {
  stage: ProductLifecycleStage;
  confidence: number; // 0-100
  daysInStage: number;
  metrics: {
    avgDailyImpressions: number;
    avgDailyOrders: number;
    avgAcos: number;
    totalReviews: number;
    salesTrend: 'up' | 'down' | 'stable';
  };
  recommendedPrimaryStrategy: string;
  reasoning: string[];
}

/**
 * 识别产品生命周期阶段
 */
export async function identifyProductLifecycle(
  campaignId: number,
  accountId: number
): Promise<LifecycleAnalysis> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // 获取广告活动信息
  const campaign = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.accountId, accountId)))
    .limit(1);

  if (!campaign || campaign.length === 0) {
    throw new Error('Campaign not found');
  }

  const campaignData = campaign[0] as any;
  const createdAt = campaignData.createdAt ? new Date(campaignData.createdAt) : new Date();
  const daysActive = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

  // 获取最近30天的表现数据
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const performanceData = await db
    .select()
    .from(dailyPerformance)
    .where(
      and(
        eq(dailyPerformance.campaignId, String(campaignId)),
        sql`${dailyPerformance.date} >= ${thirtyDaysAgo.toISOString().split('T')[0]}`
      )
    )
    .orderBy(desc(dailyPerformance.date));

  // 计算关键指标
  const totalImpressions = performanceData.reduce((sum: any, d: any) => sum + (d.impressions || 0), 0);
  const totalOrders = performanceData.reduce((sum: any, d: any) => sum + (d.orders || 0), 0);
  const totalSpend = performanceData.reduce((sum: any, d: any) => sum + parseFloat(String(d.spend || 0)), 0);
  const totalSales = performanceData.reduce((sum: any, d: any) => sum + parseFloat(String(d.sales || 0)), 0);

  const avgDailyImpressions = totalImpressions / Math.max(performanceData.length, 1);
  const avgDailyOrders = totalOrders / Math.max(performanceData.length, 1);
  const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 100;

  // 计算销量趋势
  const firstHalfOrders = performanceData.slice(0, 15).reduce((sum: any, d: any) => sum + (d.orders || 0), 0);
  const secondHalfOrders = performanceData.slice(15).reduce((sum: any, d: any) => sum + (d.orders || 0), 0);
  const trendChange = secondHalfOrders - firstHalfOrders;
  const salesTrend: 'up' | 'down' | 'stable' = 
    trendChange > firstHalfOrders * 0.2 ? 'up' :
    trendChange < -firstHalfOrders * 0.2 ? 'down' : 'stable';

  // 评估生命周期阶段
  const reasoning: string[] = [];
  let stage: ProductLifecycleStage;
  let confidence: number;
  let recommendedPrimaryStrategy: string;

  // 新品推广期判断
  if (daysActive < 90 || avgDailyImpressions < 1000 || avgDailyOrders < 10) {
    stage = ProductLifecycleStage.NEW_LAUNCH;
    confidence = 85;
    recommendedPrimaryStrategy = 'aggressive-growth';
    reasoning.push(`活动运行${daysActive}天,处于推广初期`);
    reasoning.push(`日均曝光${avgDailyImpressions.toFixed(0)},需要扩大曝光`);
    reasoning.push(`日均订单${avgDailyOrders.toFixed(1)},需要积累销量`);
  }
  // 衰退期判断
  else if (salesTrend === 'down' && avgAcos > 40) {
    stage = ProductLifecycleStage.DECLINE;
    confidence = 75;
    recommendedPrimaryStrategy = 'decline-management';
    reasoning.push(`销量持续下降,ACoS上升至${avgAcos.toFixed(1)}%`);
    reasoning.push(`产品可能进入衰退期,建议降低投入`);
  }
  // 成熟期判断
  else if (daysActive >= 365 && avgDailyImpressions > 10000 && avgDailyOrders > 50 && avgAcos < 25) {
    stage = ProductLifecycleStage.MATURITY;
    confidence = 90;
    recommendedPrimaryStrategy = 'profit-focused';
    reasoning.push(`活动运行${daysActive}天,已进入成熟期`);
    reasoning.push(`日均曝光${avgDailyImpressions.toFixed(0)},市场地位稳固`);
    reasoning.push(`ACoS${avgAcos.toFixed(1)}%,可以追求利润最大化`);
  }
  // 成长期判断
  else {
    stage = ProductLifecycleStage.GROWTH;
    confidence = 80;
    recommendedPrimaryStrategy = 'balanced';
    reasoning.push(`活动运行${daysActive}天,处于成长期`);
    reasoning.push(`日均曝光${avgDailyImpressions.toFixed(0)},有增长空间`);
    reasoning.push(`ACoS${avgAcos.toFixed(1)}%,需要平衡成本与增长`);
  }

  return {
    stage,
    confidence,
    daysInStage: daysActive,
    metrics: {
      avgDailyImpressions,
      avgDailyOrders,
      avgAcos,
      totalReviews: 0, // TODO: 从产品数据获取
      salesTrend,
    },
    recommendedPrimaryStrategy,
    reasoning,
  };
}

/**
 * 合并多个策略配置为综合优化目标
 */
export function mergeStrategies(
  strategies: StrategyConfig[],
  strategyTemplates: unknown[]
): OptimizationObjective {
  // 按优先级排序
  const sortedStrategies = strategies
    .filter(s => s.active)
    .sort((a: any, b: any) => {
      const priorityOrder = { primary: 0, secondary: 1, event: 2 };
      // @ts-expect-error - runtime type mismatch
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

  if (sortedStrategies.length === 0) {
    // 默认平衡策略
    return {
      targetAcos: 25,
      minAcos: 15,
      maxAcos: 35,
      bidMultiplier: 1.0,
      budgetMultiplier: 1.0,
      aggressiveness: 0.5,
    };
  }

  // 获取主策略
  const primaryStrategy = sortedStrategies.find(s => s.priority === StrategyPriority.PRIMARY);
  if (!primaryStrategy) {
    throw new Error('No primary strategy defined');
  }

  // @ts-expect-error - array method type inference
  const primaryTemplate = strategyTemplates.find(t => t.id === primaryStrategy.templateId);
  if (!primaryTemplate) {
    throw new Error(`Primary strategy template ${primaryStrategy.templateId} not found`);
  }

  // 从主策略开始
  let objective: OptimizationObjective = {
    // @ts-expect-error - runtime type mismatch
    targetAcos: primaryTemplate.targetAcos,
    // @ts-expect-error - runtime type mismatch
    minAcos: primaryTemplate.minAcos,
    // @ts-expect-error - runtime type mismatch
    maxAcos: primaryTemplate.maxAcos,
    // @ts-expect-error - runtime type mismatch
    bidMultiplier: primaryTemplate.bidMultiplier,
    // @ts-expect-error - runtime type mismatch
    budgetMultiplier: primaryTemplate.budgetMultiplier,
    aggressiveness: calculateAggressiveness(primaryTemplate),
  };

  // 叠加次要策略和事件策略
  for (const strategy of sortedStrategies.slice(1)) {
    // @ts-expect-error - array method type inference
    const template = strategyTemplates.find(t => t.id === strategy.templateId);
    if (!template) continue;

    const weight = strategy.weight;

    // 加权平均
    // @ts-expect-error - runtime type mismatch
    objective.targetAcos = objective.targetAcos * (1 - weight) + template.targetAcos * weight;
    // @ts-expect-error - runtime type mismatch
    objective.bidMultiplier = objective.bidMultiplier * (1 - weight) + template.bidMultiplier * weight;
    // @ts-expect-error - runtime type mismatch
    objective.budgetMultiplier = objective.budgetMultiplier * (1 - weight) + template.budgetMultiplier * weight;
    
    // 扩展ACoS范围
    // @ts-expect-error - runtime type mismatch
    objective.minAcos = Math.min(objective.minAcos, template.minAcos);
    // @ts-expect-error - runtime type mismatch
    objective.maxAcos = Math.max(objective.maxAcos, template.maxAcos);
  }

  return objective;
}

/**
 * 计算策略的激进程度
 */
function calculateAggressiveness(template: any): number {
  // 基于目标ACoS和出价倍数计算
  const acosScore = (template.targetAcos - 15) / 35; // 归一化到0-1
  const bidScore = (template.bidMultiplier - 0.8) / 0.7; // 归一化到0-1
  return Math.max(0, Math.min(1, (acosScore + bidScore) / 2));
}

/**
 * 检测策略冲突
 */
export function detectStrategyConflicts(strategies: StrategyConfig[]): string[] {
  const conflicts: string[] = [];
  const activeStrategies = strategies.filter(s => s.active);

  // 检查是否有多个主策略
  const primaryCount = activeStrategies.filter(s => s.priority === StrategyPriority.PRIMARY).length;
  if (primaryCount > 1) {
    conflicts.push('检测到多个主策略,请确保只有一个主策略处于激活状态');
  }
  if (primaryCount === 0) {
    conflicts.push('未检测到主策略,请至少激活一个主策略');
  }

  // 检查策略组合的合理性
  const templateIds = activeStrategies.map(s => s.templateId);
  
  // 激进增长 + 利润优先 冲突
  if (templateIds.includes('aggressive-growth') && templateIds.includes('profit-focused')) {
    conflicts.push('激进增长策略与利润优先策略存在目标冲突,建议移除其中一个');
  }

  // 品牌防御 + 竞品攻击 可能冲突
  if (templateIds.includes('brand-defense') && templateIds.includes('competitor-attack')) {
    conflicts.push('品牌防御与竞品攻击同时启用可能导致预算分配冲突,请谨慎使用');
  }

  return conflicts;
}
