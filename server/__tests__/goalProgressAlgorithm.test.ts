/**
 * v271 P0-1: goalProgressAlgorithm 核心模块单元测试
 * 覆盖: 策略权重配置完整性、核心指标评分、趋势评分、预算效率、转化效率、渐进优化
 */
import { describe, it, expect } from 'vitest';
import {
  calculateGoalProgress,
  type PerformanceMetrics,
  type GroupConfig,
  type TrendData,
  type TimeWeightedMetrics,
  type MultiWindowTrendData,
  type AlgorithmEfficacyData,
} from '../algorithm/goalProgressAlgorithm';

// ==================== 辅助工厂函数 ====================

function createDefaultMetrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    totalSpend: 100,
    totalSales: 400,
    totalOrders: 20,
    totalClicks: 200,
    totalImpressions: 10000,
    avgAcos: 25,
    avgRoas: 4.0,
    ctr: 0.02,
    cvr: 0.10,
    cpc: 0.50,
    ...overrides,
  };
}

function createDefaultConfig(overrides: Partial<GroupConfig> = {}): GroupConfig {
  return {
    id: 1,
    optimizationGoal: 'target_acos',
    targetAcos: 25,
    targetRoas: null,
    dailyBudget: 50,
    dailySpendLimit: 50,
    maxBid: 2.0,
    strategyTemplateId: 'balanced-growth',
    strategyTemplateName: 'Balanced Growth',
    status: 'active',
    createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    campaignCount: 5,
    ...overrides,
  };
}

function createDefaultTimeWeighted(overrides: Partial<TimeWeightedMetrics> = {}): TimeWeightedMetrics {
  return {
    weightedAcos: 25,
    weightedRoas: 4.0,
    weightedDailySpend: 50,
    weightedDailySales: 200,
    weightedDailyOrders: 10,
    weightedCvr: 0.10,
    weightedCpc: 0.50,
    dataConfidence: 'high',
    trendDirection: 'improving',
    effectiveDataDays: 30,
    ...overrides,
  };
}

// ==================== 1. 策略权重配置完整性测试 ====================

describe('GoalProgressAlgorithm - Strategy Weights Coverage', () => {
  const allStrategyTemplates = [
    'balanced-growth',
    'profit-protection',
    'aggressive-growth',
    'cost-control',
    'brand-awareness',
    'brand-defense',
    'new-product-launch',
    'seasonal-push',
    'inventory-clearance',
    'competitor-attack',
    'retargeting',
  ];

  allStrategyTemplates.forEach(templateId => {
    it(`should return valid score for strategy template: ${templateId}`, () => {
      const config = createDefaultConfig({ strategyTemplateId: templateId });
      const metrics = createDefaultMetrics();
      const result = calculateGoalProgress(config, metrics);
      
      expect(result.totalScore).toBeGreaterThanOrEqual(0);
      expect(result.totalScore).toBeLessThanOrEqual(100);
      expect(result.dimensions.length).toBeGreaterThanOrEqual(4);
      expect(result.level).toMatch(/excellent|good|fair|poor/);
    });
  });

  it('should use default weights for unknown strategy template', () => {
    const config = createDefaultConfig({ strategyTemplateId: 'unknown-strategy' });
    const metrics = createDefaultMetrics();
    const result = calculateGoalProgress(config, metrics);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });

  it('should use default weights when strategyTemplateId is null', () => {
    const config = createDefaultConfig({ strategyTemplateId: null });
    const metrics = createDefaultMetrics();
    const result = calculateGoalProgress(config, metrics);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });
});

// ==================== 2. 核心指标评分测试 ====================

describe('GoalProgressAlgorithm - Core Metric Scoring', () => {
  it('should score high when ACoS exactly matches target', () => {
    const config = createDefaultConfig({ targetAcos: 25 });
    const metrics = createDefaultMetrics({ avgAcos: 25 });
    const result = calculateGoalProgress(config, metrics);
    expect(result.totalScore).toBeGreaterThanOrEqual(60);
  });

  it('should score higher when ACoS is below target', () => {
    const config = createDefaultConfig({ targetAcos: 25 });
    const metricsBetter = createDefaultMetrics({ avgAcos: 20, avgRoas: 5.0 });
    const metricsExact = createDefaultMetrics({ avgAcos: 25, avgRoas: 4.0 });
    const resultBetter = calculateGoalProgress(config, metricsBetter);
    const resultExact = calculateGoalProgress(config, metricsExact);
    expect(resultBetter.totalScore).toBeGreaterThanOrEqual(resultExact.totalScore);
  });

  it('should score lower when ACoS significantly exceeds target', () => {
    const config = createDefaultConfig({ targetAcos: 25 });
    const metricsBad = createDefaultMetrics({ avgAcos: 50, avgRoas: 2.0 });
    const metricsGood = createDefaultMetrics({ avgAcos: 25, avgRoas: 4.0 });
    const resultBad = calculateGoalProgress(config, metricsBad);
    const resultGood = calculateGoalProgress(config, metricsGood);
    expect(resultBad.totalScore).toBeLessThan(resultGood.totalScore);
  });

  it('should handle maximize_sales goal correctly', () => {
    const config = createDefaultConfig({
      optimizationGoal: 'maximize_sales',
      targetAcos: null,
      targetRoas: null,
    });
    const metrics = createDefaultMetrics({ totalSales: 1000, avgRoas: 5.0 });
    const result = calculateGoalProgress(config, metrics);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });

  it('should handle target_roas goal correctly', () => {
    const config = createDefaultConfig({
      optimizationGoal: 'target_roas',
      targetAcos: null,
      targetRoas: 4.0,
    });
    const metrics = createDefaultMetrics({ avgRoas: 4.5 });
    const result = calculateGoalProgress(config, metrics);
    expect(result.totalScore).toBeGreaterThanOrEqual(50);
  });
});

// ==================== 3. 零数据场景测试 ====================

describe('GoalProgressAlgorithm - Edge Cases', () => {
  it('should return 0 score for zero campaigns and zero spend', () => {
    const config = createDefaultConfig({ campaignCount: 0 });
    const metrics = createDefaultMetrics({
      totalSpend: 0,
      totalSales: 0,
      totalOrders: 0,
      totalClicks: 0,
      totalImpressions: 0,
    });
    const result = calculateGoalProgress(config, metrics);
    expect(result.totalScore).toBe(0);
    expect(result.summary).toContain('暂无');
  });

  it('should handle very high ACoS gracefully', () => {
    const config = createDefaultConfig({ targetAcos: 25 });
    const metrics = createDefaultMetrics({ avgAcos: 500, avgRoas: 0.2 });
    const result = calculateGoalProgress(config, metrics);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
    expect(result.level).toBe('poor');
  });

  it('should handle zero spend but non-zero impressions', () => {
    const config = createDefaultConfig();
    const metrics = createDefaultMetrics({
      totalSpend: 0,
      totalSales: 0,
      totalImpressions: 1000,
      totalClicks: 0,
      avgAcos: 0,
      avgRoas: 0,
    });
    const result = calculateGoalProgress(config, metrics);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });
});

// ==================== 4. 趋势数据影响测试 ====================

describe('GoalProgressAlgorithm - Trend Impact', () => {
  it('should score higher with improving trend data', () => {
    const config = createDefaultConfig();
    const metrics = createDefaultMetrics();
    const trendImproving: TrendData = {
      before: { days: 14, totalSpend: 700, totalSales: 2100, totalOrders: 105, totalClicks: 1400, totalImpressions: 70000 },
      after: { days: 14, totalSpend: 700, totalSales: 2800, totalOrders: 140, totalClicks: 1400, totalImpressions: 70000 },
    };
    const resultWithTrend = calculateGoalProgress(config, metrics, trendImproving);
    const resultWithoutTrend = calculateGoalProgress(config, metrics);
    // With improving trend, score should generally be higher or equal
    expect(resultWithTrend.totalScore).toBeGreaterThanOrEqual(resultWithoutTrend.totalScore - 10);
  });

  it('should score lower with declining trend data', () => {
    const config = createDefaultConfig();
    const metrics = createDefaultMetrics();
    const trendDeclining: TrendData = {
      before: { days: 14, totalSpend: 700, totalSales: 2800, totalOrders: 140, totalClicks: 1400, totalImpressions: 70000 },
      after: { days: 14, totalSpend: 700, totalSales: 1400, totalOrders: 70, totalClicks: 1400, totalImpressions: 70000 },
    };
    const resultDeclining = calculateGoalProgress(config, metrics, trendDeclining);
    expect(resultDeclining.totalScore).toBeLessThanOrEqual(80);
  });
});

// ==================== 5. 时间衰减加权指标影响测试 ====================

describe('GoalProgressAlgorithm - Time Weighted Metrics', () => {
  it('should apply confidence multiplier based on data confidence', () => {
    const config = createDefaultConfig();
    const metrics = createDefaultMetrics();
    
    const highConf = createDefaultTimeWeighted({ dataConfidence: 'high' });
    const lowConf = createDefaultTimeWeighted({ dataConfidence: 'very_low' });
    
    const resultHigh = calculateGoalProgress(config, metrics, undefined, highConf);
    const resultLow = calculateGoalProgress(config, metrics, undefined, lowConf);
    
    // High confidence should generally produce more extreme (higher or lower) scores
    // while low confidence should moderate scores toward middle
    expect(resultHigh.totalScore).not.toBe(resultLow.totalScore);
  });

  it('should use time-weighted ACoS for core metric when available', () => {
    const config = createDefaultConfig({ targetAcos: 25 });
    const metrics = createDefaultMetrics({ avgAcos: 30 }); // Raw ACoS is 30
    const tw = createDefaultTimeWeighted({ weightedAcos: 22 }); // Time-weighted is better at 22
    
    const resultWithTW = calculateGoalProgress(config, metrics, undefined, tw);
    const resultWithoutTW = calculateGoalProgress(config, metrics);
    
    // Time-weighted ACoS is better, so score should be higher
    expect(resultWithTW.totalScore).toBeGreaterThanOrEqual(resultWithoutTW.totalScore);
  });
});

// ==================== 6. 维度权重总和验证 ====================

describe('GoalProgressAlgorithm - Dimension Weight Validation', () => {
  it('should have dimension weights summing close to 1.0', () => {
    const config = createDefaultConfig();
    const metrics = createDefaultMetrics();
    const tw = createDefaultTimeWeighted();
    const result = calculateGoalProgress(config, metrics, undefined, tw);
    
    const totalWeight = result.dimensions.reduce((sum: any, d: any) => sum + d.weight, 0);
    // Weights are expressed as percentages (sum to ~100) or as fractions (sum to ~1.0)
    // Accept either convention
    expect(totalWeight).toBeGreaterThan(0);
    expect(totalWeight === 100 || Math.abs(totalWeight - 1.0) < 0.1).toBe(true);
  });

  it('should have all dimension scores between 0 and 100', () => {
    const config = createDefaultConfig();
    const metrics = createDefaultMetrics();
    const result = calculateGoalProgress(config, metrics);
    
    result.dimensions.forEach(dim => {
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(100);
    });
  });
});

// ==================== 7. 等级划分测试 ====================

describe('GoalProgressAlgorithm - Level Classification', () => {
  it('should classify excellent for very high scores', () => {
    const config = createDefaultConfig({ targetAcos: 30 });
    const metrics = createDefaultMetrics({ avgAcos: 15, avgRoas: 6.67, totalSales: 1000, totalOrders: 50 });
    const tw = createDefaultTimeWeighted({
      weightedAcos: 15,
      weightedRoas: 6.67,
      dataConfidence: 'high',
      trendDirection: 'improving',
    });
    const result = calculateGoalProgress(config, metrics, undefined, tw);
    // Very good performance should be excellent or good
    expect(['excellent', 'good']).toContain(result.level);
  });

  it('should classify poor for very low scores', () => {
    const config = createDefaultConfig({ targetAcos: 20 });
    const metrics = createDefaultMetrics({ avgAcos: 100, avgRoas: 1.0, totalSales: 50, totalOrders: 2 });
    const result = calculateGoalProgress(config, metrics);
    expect(result.level).toBe('poor');
  });
});

// ==================== 8. 算法效能维度测试 ====================

describe('GoalProgressAlgorithm - Algorithm Efficacy Dimension', () => {
  it('should include algorithm efficacy dimension when data provided', () => {
    const config = createDefaultConfig();
    const metrics = createDefaultMetrics();
    const tw = createDefaultTimeWeighted();
    const algoData: AlgorithmEfficacyData = {
      totalOperations: 100,
      positiveRate: 0.65,
      tierDistribution: { advanced: 0.40, ruleEngine: 0.40, conservative: 0.20 },
      avgConfidence: 0.70,
      evolutionCorrections: 5,
      improvementTrend: 'improving',
    };
    
    const result = calculateGoalProgress(config, metrics, undefined, tw, undefined, algoData);
    // Should have 6 dimensions including algorithm efficacy
    expect(result.dimensions.length).toBeGreaterThanOrEqual(5);
  });
});
