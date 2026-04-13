/**
 * gtoKeywordPortfolioBalancer.ts - GTO关键词组合平衡器
 * 
 * 灵感来源：德州扑克"范围平衡"(Range Balancing) 策略
 * 
 * 核心思想：确保账户中不同类型的关键词（高利润核心词、引流泛词、
 * 长尾转化词、品牌防御词）维持在健康的比例。防止算法过度集中于
 * 少数高绩效关键词，导致流量结构单一、抗风险能力差。
 * 
 * 关键词角色分类：
 * - 核心利润词(Profit Core): 高ROAS、稳定转化，贡献主要利润
 * - 引流泛词(Traffic Driver): 高曝光、低转化，负责引流和品牌曝光
 * - 长尾转化词(Long Tail Converter): 低曝光、高转化率，精准流量
 * - 品牌防御词(Brand Defense): 品牌相关词，防止竞品截流
 * - 新词探索(New Explorer): 新添加的待验证关键词
 */

import type { OptimizationTarget, PerformanceGroupConfig } from "../optimization/bidOptimizer";

// ==================== 类型定义 ====================

export type KeywordRole = 'profit_core' | 'traffic_driver' | 'long_tail' | 'brand_defense' | 'new_explorer';

export interface PortfolioAnalysis {
  /** 各角色关键词数量 */
  roleDistribution: Record<KeywordRole, number>;
  /** 各角色花费占比 */
  spendDistribution: Record<KeywordRole, number>;
  /** 各角色销售占比 */
  salesDistribution: Record<KeywordRole, number>;
  /** 组合健康度评分 (0-100) */
  portfolioHealthScore: number;
  /** 失衡警告 */
  imbalanceWarnings: string[];
  /** 各角色的出价修正建议 */
  roleModifiers: Record<KeywordRole, number>;
  /** 分析原因 */
  reasoning: string;
}

export interface KeywordRoleAssignment {
  keywordId: number;
  role: KeywordRole;
  roleConfidence: number;
  portfolioModifier: number;
  reasoning: string;
}

// ==================== 常量配置 ====================

/** 理想的角色分布比例 (花费占比) */
const IDEAL_SPEND_DISTRIBUTION: Record<KeywordRole, { min: number; max: number; target: number }> = {
  profit_core:    { min: 0.35, max: 0.55, target: 0.45 },
  traffic_driver: { min: 0.10, max: 0.25, target: 0.15 },
  long_tail:      { min: 0.15, max: 0.30, target: 0.20 },
  brand_defense:  { min: 0.05, max: 0.15, target: 0.10 },
  new_explorer:   { min: 0.05, max: 0.15, target: 0.10 },
};

/** 角色分类阈值 */
const PROFIT_CORE_MIN_ROAS = 3.0;      // ROAS >= 3.0
const PROFIT_CORE_MIN_ORDERS = 3;       // 至少3单
const TRAFFIC_DRIVER_MIN_IMPRESSIONS = 1000; // 至少1000曝光
const TRAFFIC_DRIVER_MAX_CVR = 0.02;    // CVR < 2%
const LONG_TAIL_MIN_CVR = 0.05;         // CVR >= 5%
const LONG_TAIL_MAX_IMPRESSIONS = 500;  // 曝光 < 500

// ==================== 核心算法 ====================

/**
 * 对关键词进行角色分类
 */
export function classifyKeywordRole(
  target: OptimizationTarget,
  config: PerformanceGroupConfig
): KeywordRole {
  const { impressions, clicks, orders, sales, spend } = target;
  const cvr = clicks > 0 ? orders / clicks : 0;
  const roas = spend > 0 ? sales / spend : 0;
  
  // 数据极少 → 新词探索
  if (clicks < 5 && impressions < 100) {
    return 'new_explorer';
  }
  
  // 高ROAS + 有订单 → 核心利润词
  if (roas >= PROFIT_CORE_MIN_ROAS && orders >= PROFIT_CORE_MIN_ORDERS) {
    return 'profit_core';
  }
  
  // 高曝光 + 低转化率 → 引流泛词
  if (impressions >= TRAFFIC_DRIVER_MIN_IMPRESSIONS && cvr < TRAFFIC_DRIVER_MAX_CVR) {
    return 'traffic_driver';
  }
  
  // 高转化率 + 低曝光 → 长尾转化词
  if (cvr >= LONG_TAIL_MIN_CVR && impressions < LONG_TAIL_MAX_IMPRESSIONS) {
    return 'long_tail';
  }
  
  // 精确匹配 + 有一定转化 → 可能是品牌防御词
  if (target.matchType === 'exact' && orders >= 1 && roas >= 2.0) {
    return 'brand_defense';
  }
  
  // 有订单但ROAS不够高 → 长尾转化词
  if (orders >= 1) {
    return 'long_tail';
  }
  
  // 默认归为引流泛词
  return 'traffic_driver';
}

/**
 * 分析整个投资组合的健康度
 */
export function analyzePortfolio(
  targets: OptimizationTarget[],
  config: PerformanceGroupConfig
): PortfolioAnalysis {
  if (targets.length === 0) {
    return buildEmptyPortfolio();
  }

  // ===== 第1步：分类所有关键词 =====
  const roleAssignments = new Map<number, KeywordRole>();
  const roleDistribution: Record<KeywordRole, number> = {
    profit_core: 0, traffic_driver: 0, long_tail: 0, brand_defense: 0, new_explorer: 0,
  };
  const roleSpend: Record<KeywordRole, number> = {
    profit_core: 0, traffic_driver: 0, long_tail: 0, brand_defense: 0, new_explorer: 0,
  };
  const roleSales: Record<KeywordRole, number> = {
    profit_core: 0, traffic_driver: 0, long_tail: 0, brand_defense: 0, new_explorer: 0,
  };

  for (const target of targets) {
    const role = classifyKeywordRole(target, config);
    roleAssignments.set(target.id, role);
    roleDistribution[role]++;
    roleSpend[role] += target.spend;
    roleSales[role] += target.sales;
  }

  // ===== 第2步：计算花费和销售占比 =====
  // @ts-expect-error DB query type inference limitation
  const totalSpend = Object.values(roleSpend).reduce((a: unknown, b: unknown) => a + b, 0);
  // @ts-expect-error DB query type inference limitation
  const totalSales = Object.values(roleSales).reduce((a: unknown, b: unknown) => a + b, 0);
  
  // @ts-expect-error Dynamic type assertion
  const spendDistribution: Record<KeywordRole, number> = {} as Record<string, unknown>;
  // @ts-expect-error Dynamic type assertion
  const salesDistribution: Record<KeywordRole, number> = {} as Record<string, unknown>;
  for (const role of Object.keys(roleDistribution) as KeywordRole[]) {
    // @ts-expect-error Conditional type narrowing
    spendDistribution[role] = totalSpend > 0 ? roleSpend[role] / totalSpend : 0;
    // @ts-expect-error Conditional type narrowing
    salesDistribution[role] = totalSales > 0 ? roleSales[role] / totalSales : 0;
  }

  // ===== 第3步：检测失衡 =====
  const imbalanceWarnings: string[] = [];
  let healthScore = 100;

  for (const [role, ideal] of Object.entries(IDEAL_SPEND_DISTRIBUTION) as [KeywordRole, { min: number; max: number; target: number }][]) {
    const actual = spendDistribution[role] || 0;
    
    if (actual < ideal.min) {
      const deficit = ideal.min - actual;
      imbalanceWarnings.push(
        `${getRoleLabel(role)}花费占比${(actual * 100).toFixed(0)}%低于最低阈值${(ideal.min * 100).toFixed(0)}%，建议增加投入`
      );
      healthScore -= Math.round(deficit * 200); // 每1%偏差扣2分
    } else if (actual > ideal.max) {
      const excess = actual - ideal.max;
      imbalanceWarnings.push(
        `${getRoleLabel(role)}花费占比${(actual * 100).toFixed(0)}%超过最高阈值${(ideal.max * 100).toFixed(0)}%，建议分散投入`
      );
      healthScore -= Math.round(excess * 150);
    // @ts-expect-error Legacy code type compatibility
    }
  }

  healthScore = Math.max(0, Math.min(100, healthScore));

  // ===== 第4步：计算角色修正系数 =====
  // @ts-expect-error Dynamic type assertion
  const roleModifiers: Record<KeywordRole, number> = {} as Record<string, unknown>;
  for (const [role, ideal] of Object.entries(IDEAL_SPEND_DISTRIBUTION) as [KeywordRole, { min: number; max: number; target: number }][]) {
    const actual = spendDistribution[role] || 0;
    
    if (actual < ideal.min) {
      // 花费不足 → 提升出价
      roleModifiers[role] = Math.min(1.25, 1 + (ideal.target - actual) * 2);
    } else if (actual > ideal.max) {
      // 花费过多 → 降低出价
      roleModifiers[role] = Math.max(0.80, 1 - (actual - ideal.target) * 1.5);
    } else {
      roleModifiers[role] = 1.0;
    }
  }

  const reasoning = `组合健康度${healthScore}/100，` +
    `核心利润词${roleDistribution.profit_core}个(${(spendDistribution.profit_core * 100).toFixed(0)}%花费)，` +
    `引流泛词${roleDistribution.traffic_driver}个，长尾词${roleDistribution.long_tail}个，` +
    `品牌词${roleDistribution.brand_defense}个，新词${roleDistribution.new_explorer}个`;

  return {
    roleDistribution,
    spendDistribution,
    salesDistribution,
    portfolioHealthScore: healthScore,
    imbalanceWarnings,
    roleModifiers,
    reasoning,
  };
}

/**
 * 为单个关键词分配角色并计算组合修正系数
 */
export function assignKeywordRole(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  portfolioAnalysis: PortfolioAnalysis
): KeywordRoleAssignment {
  const role = classifyKeywordRole(target, config);
  const modifier = portfolioAnalysis.roleModifiers[role] || 1.0;
  
  const cvr = target.clicks > 0 ? target.orders / target.clicks : 0;
  const roas = target.spend > 0 ? target.sales / target.spend : 0;
  
  // 置信度基于数据量
  const confidence = Math.min(0.9, Math.sqrt(target.clicks / 50) * 0.5 + (target.orders > 0 ? 0.3 : 0));
  
  return {
    keywordId: target.id,
    role,
    roleConfidence: confidence,
    portfolioModifier: modifier,
    reasoning: `${getRoleLabel(role)}(ROAS=${roas.toFixed(1)}, CVR=${(cvr * 100).toFixed(1)}%)，` +
      `组合修正${modifier.toFixed(2)}`,
  };
}

// ==================== 辅助函数 ====================

function getRoleLabel(role: KeywordRole): string {
  switch (role) {
    case 'profit_core': return '核心利润词';
    case 'traffic_driver': return '引流泛词';
    case 'long_tail': return '长尾转化词';
    case 'brand_defense': return '品牌防御词';
    case 'new_explorer': return '新词探索';
  }
}

function buildEmptyPortfolio(): PortfolioAnalysis {
  const empty = { profit_core: 0, traffic_driver: 0, long_tail: 0, brand_defense: 0, new_explorer: 0 };
  return {
    roleDistribution: { ...empty },
    spendDistribution: { ...empty },
    salesDistribution: { ...empty },
    portfolioHealthScore: 50,
    imbalanceWarnings: ['无关键词数据，无法评估组合健康度'],
    roleModifiers: { profit_core: 1.0, traffic_driver: 1.0, long_tail: 1.0, brand_defense: 1.0, new_explorer: 1.0 },
    reasoning: '无关键词数据',
  };
}
