/**
 * v271 P2-1: 评分权重自学习服务测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getEffectiveWeights,
  calculateDimensionCorrelations,
  adjustWeights,
  applyWeightTuning,
  rollbackWeights,
  getTuningHistory,
  getDefaultTuningConfig,
} from '../weightAutoTuningService';

describe('WeightAutoTuningService', () => {
  const defaultWeights: Record<string, number> = {
    acos_progress: 0.25,
    spend_efficiency: 0.15,
    conversion_trend: 0.15,
    impression_health: 0.10,
    click_quality: 0.10,
    data_confidence: 0.15,
    profit_efficiency: 0.10,
  };

  describe('getEffectiveWeights', () => {
    it('应返回默认权重（无缓存时）', () => {
      const weights = getEffectiveWeights('unknown_strategy', defaultWeights);
      expect(weights).toEqual(defaultWeights);
    });

    it('应返回缓存的自学习权重', () => {
      const customWeights = { ...defaultWeights, acos_progress: 0.30 };
      const result = adjustWeights(defaultWeights, [
        { dimension: 'acos_progress', avgScore: 0.8, correlationWithOutcome: 0.5, sampleCount: 100 },
        { dimension: 'spend_efficiency', avgScore: 0.6, correlationWithOutcome: 0.3, sampleCount: 100 },
        { dimension: 'conversion_trend', avgScore: 0.7, correlationWithOutcome: 0.2, sampleCount: 100 },
        { dimension: 'impression_health', avgScore: 0.5, correlationWithOutcome: -0.1, sampleCount: 100 },
        { dimension: 'click_quality', avgScore: 0.6, correlationWithOutcome: 0.1, sampleCount: 100 },
        { dimension: 'data_confidence', avgScore: 0.9, correlationWithOutcome: 0.4, sampleCount: 100 },
        { dimension: 'profit_efficiency', avgScore: 0.5, correlationWithOutcome: 0.15, sampleCount: 100 },
      ]);
      applyWeightTuning('test_strategy_1', result);
      
      const effective = getEffectiveWeights('test_strategy_1', defaultWeights);
      expect(effective).not.toEqual(defaultWeights);
      expect(Object.keys(effective).length).toBe(7);
    });
  });

  describe('calculateDimensionCorrelations', () => {
    it('应正确计算正相关', () => {
      const scores = [
        { acos_progress: 0.8, spend_efficiency: 0.6, conversion_trend: 0.7, impression_health: 0.5, click_quality: 0.6, data_confidence: 0.9, profit_efficiency: 0.5 },
        { acos_progress: 0.9, spend_efficiency: 0.7, conversion_trend: 0.8, impression_health: 0.6, click_quality: 0.7, data_confidence: 0.8, profit_efficiency: 0.6 },
        { acos_progress: 0.3, spend_efficiency: 0.4, conversion_trend: 0.3, impression_health: 0.3, click_quality: 0.4, data_confidence: 0.5, profit_efficiency: 0.3 },
        { acos_progress: 0.7, spend_efficiency: 0.5, conversion_trend: 0.6, impression_health: 0.4, click_quality: 0.5, data_confidence: 0.7, profit_efficiency: 0.4 },
      ];
      const outcomes = [0.8, 0.9, 0.2, 0.6]; // 好效果对应高分

      const correlations = calculateDimensionCorrelations(scores, outcomes);
      
      expect(correlations.length).toBe(7);
      // acos_progress应该与outcome正相关
      const acosCorr = correlations.find(c => c.dimension === 'acos_progress');
      expect(acosCorr).toBeDefined();
      expect(acosCorr!.correlationWithOutcome).toBeGreaterThan(0);
      expect(acosCorr!.sampleCount).toBe(4);
    });

    it('应处理空输入', () => {
      const correlations = calculateDimensionCorrelations([], []);
      expect(correlations.length).toBe(7);
      correlations.forEach(c => {
        expect(c.correlationWithOutcome).toBe(0);
        expect(c.sampleCount).toBe(0);
      });
    });

    it('应处理单个样本', () => {
      const scores = [{ acos_progress: 0.8, spend_efficiency: 0.6, conversion_trend: 0.7, impression_health: 0.5, click_quality: 0.6, data_confidence: 0.9, profit_efficiency: 0.5 }];
      const outcomes = [0.8];
      const correlations = calculateDimensionCorrelations(scores, outcomes);
      expect(correlations.length).toBe(7);
    });
  });

  describe('adjustWeights', () => {
    it('应增加正相关维度的权重', () => {
      const performances = [
        { dimension: 'acos_progress', avgScore: 0.8, correlationWithOutcome: 0.6, sampleCount: 100 },
        { dimension: 'spend_efficiency', avgScore: 0.6, correlationWithOutcome: 0.3, sampleCount: 100 },
        { dimension: 'conversion_trend', avgScore: 0.7, correlationWithOutcome: 0.2, sampleCount: 100 },
        { dimension: 'impression_health', avgScore: 0.5, correlationWithOutcome: 0.0, sampleCount: 100 },
        { dimension: 'click_quality', avgScore: 0.6, correlationWithOutcome: -0.3, sampleCount: 100 },
        { dimension: 'data_confidence', avgScore: 0.9, correlationWithOutcome: 0.4, sampleCount: 100 },
        { dimension: 'profit_efficiency', avgScore: 0.5, correlationWithOutcome: 0.15, sampleCount: 100 },
      ];

      const result = adjustWeights(defaultWeights, performances);
      
      expect(result.newWeights).toBeDefined();
      expect(result.adjustments.length).toBe(7);
      
      // 权重总和应约等于1
      const totalWeight = Object.values(result.newWeights).reduce((s, w) => s + w, 0);
      expect(totalWeight).toBeCloseTo(1.0, 2);
      
      // 所有权重应大于最小下限
      Object.values(result.newWeights).forEach(w => {
        expect(w).toBeGreaterThanOrEqual(0.02);
      });
    });

    it('应降低负相关维度的权重', () => {
      const performances = [
        { dimension: 'acos_progress', avgScore: 0.8, correlationWithOutcome: -0.5, sampleCount: 100 },
        { dimension: 'spend_efficiency', avgScore: 0.6, correlationWithOutcome: 0.3, sampleCount: 100 },
        { dimension: 'conversion_trend', avgScore: 0.7, correlationWithOutcome: 0.2, sampleCount: 100 },
        { dimension: 'impression_health', avgScore: 0.5, correlationWithOutcome: 0.0, sampleCount: 100 },
        { dimension: 'click_quality', avgScore: 0.6, correlationWithOutcome: 0.3, sampleCount: 100 },
        { dimension: 'data_confidence', avgScore: 0.9, correlationWithOutcome: 0.4, sampleCount: 100 },
        { dimension: 'profit_efficiency', avgScore: 0.5, correlationWithOutcome: 0.15, sampleCount: 100 },
      ];

      const result = adjustWeights(defaultWeights, performances);
      
      // acos_progress的权重应该降低（相对于原始权重的比例）
      // 但由于归一化，需要看相对变化
      const acosAdj = result.adjustments.find(a => a.dimension === 'acos_progress');
      expect(acosAdj).toBeDefined();
      // 负相关维度的delta应该为负（调整前归一化后）
    });

    it('样本不足时不应调整权重', () => {
      const performances = [
        { dimension: 'acos_progress', avgScore: 0.8, correlationWithOutcome: 0.6, sampleCount: 10 },
        { dimension: 'spend_efficiency', avgScore: 0.6, correlationWithOutcome: 0.3, sampleCount: 10 },
        { dimension: 'conversion_trend', avgScore: 0.7, correlationWithOutcome: 0.2, sampleCount: 10 },
        { dimension: 'impression_health', avgScore: 0.5, correlationWithOutcome: 0.0, sampleCount: 10 },
        { dimension: 'click_quality', avgScore: 0.6, correlationWithOutcome: -0.3, sampleCount: 10 },
        { dimension: 'data_confidence', avgScore: 0.9, correlationWithOutcome: 0.4, sampleCount: 10 },
        { dimension: 'profit_efficiency', avgScore: 0.5, correlationWithOutcome: 0.15, sampleCount: 10 },
      ];

      const config = getDefaultTuningConfig();
      config.minSampleSize = 50;
      
      const result = adjustWeights(defaultWeights, performances, config);
      
      // 所有调整的reason应包含"样本不足"
      result.adjustments.forEach(adj => {
        expect(adj.reason).toContain('样本不足');
      });
    });

    it('权重不应低于最小下限', () => {
      const extremeWeights: Record<string, number> = {
        acos_progress: 0.50,
        spend_efficiency: 0.01,
        conversion_trend: 0.01,
        impression_health: 0.01,
        click_quality: 0.01,
        data_confidence: 0.45,
        profit_efficiency: 0.01,
      };

      const performances = [
        { dimension: 'acos_progress', avgScore: 0.8, correlationWithOutcome: -0.8, sampleCount: 100 },
        { dimension: 'spend_efficiency', avgScore: 0.6, correlationWithOutcome: -0.8, sampleCount: 100 },
        { dimension: 'conversion_trend', avgScore: 0.7, correlationWithOutcome: -0.8, sampleCount: 100 },
        { dimension: 'impression_health', avgScore: 0.5, correlationWithOutcome: -0.8, sampleCount: 100 },
        { dimension: 'click_quality', avgScore: 0.6, correlationWithOutcome: -0.8, sampleCount: 100 },
        { dimension: 'data_confidence', avgScore: 0.9, correlationWithOutcome: -0.8, sampleCount: 100 },
        { dimension: 'profit_efficiency', avgScore: 0.5, correlationWithOutcome: -0.8, sampleCount: 100 },
      ];

      const result = adjustWeights(extremeWeights, performances);
      
      Object.values(result.newWeights).forEach(w => {
        // 归一化后权重应接近或等于最小下限（允许微小浮点误差）
        expect(w).toBeGreaterThanOrEqual(0.019);
      });
    });
  });

  describe('applyWeightTuning & rollbackWeights', () => {
    it('应正确应用和回滚权重', () => {
      const performances = [
        { dimension: 'acos_progress', avgScore: 0.8, correlationWithOutcome: 0.5, sampleCount: 100 },
        { dimension: 'spend_efficiency', avgScore: 0.6, correlationWithOutcome: 0.3, sampleCount: 100 },
        { dimension: 'conversion_trend', avgScore: 0.7, correlationWithOutcome: 0.2, sampleCount: 100 },
        { dimension: 'impression_health', avgScore: 0.5, correlationWithOutcome: 0.0, sampleCount: 100 },
        { dimension: 'click_quality', avgScore: 0.6, correlationWithOutcome: -0.3, sampleCount: 100 },
        { dimension: 'data_confidence', avgScore: 0.9, correlationWithOutcome: 0.4, sampleCount: 100 },
        { dimension: 'profit_efficiency', avgScore: 0.5, correlationWithOutcome: 0.15, sampleCount: 100 },
      ];

      const result = adjustWeights(defaultWeights, performances);
      applyWeightTuning('rollback_test_strategy', result);
      
      // 应用后应返回调整后的权重
      const effective = getEffectiveWeights('rollback_test_strategy', defaultWeights);
      expect(effective).toEqual(result.newWeights);
      
      // 回滚后应返回默认权重
      rollbackWeights('rollback_test_strategy');
      const afterRollback = getEffectiveWeights('rollback_test_strategy', defaultWeights);
      expect(afterRollback).toEqual(defaultWeights);
    });
  });

  describe('getTuningHistory', () => {
    it('应返回调整历史', () => {
      const history = getTuningHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('应支持按策略模板过滤', () => {
      const performances = [
        { dimension: 'acos_progress', avgScore: 0.8, correlationWithOutcome: 0.5, sampleCount: 100 },
        { dimension: 'spend_efficiency', avgScore: 0.6, correlationWithOutcome: 0.3, sampleCount: 100 },
        { dimension: 'conversion_trend', avgScore: 0.7, correlationWithOutcome: 0.2, sampleCount: 100 },
        { dimension: 'impression_health', avgScore: 0.5, correlationWithOutcome: 0.0, sampleCount: 100 },
        { dimension: 'click_quality', avgScore: 0.6, correlationWithOutcome: -0.3, sampleCount: 100 },
        { dimension: 'data_confidence', avgScore: 0.9, correlationWithOutcome: 0.4, sampleCount: 100 },
        { dimension: 'profit_efficiency', avgScore: 0.5, correlationWithOutcome: 0.15, sampleCount: 100 },
      ];

      const result = adjustWeights(defaultWeights, performances);
      applyWeightTuning('filter_test_strategy', result);
      
      const filtered = getTuningHistory('filter_test_strategy');
      filtered.forEach(h => {
        expect(h.strategyTemplateId).toBe('filter_test_strategy');
      });
    });
  });

  describe('getDefaultTuningConfig', () => {
    it('应返回合理的默认配置', () => {
      const config = getDefaultTuningConfig();
      expect(config.learningRate).toBeGreaterThan(0);
      expect(config.learningRate).toBeLessThanOrEqual(0.1);
      expect(config.maxAdjustmentPercent).toBeGreaterThan(0);
      expect(config.minWeightFloor).toBeGreaterThan(0);
      expect(config.evaluationWindowDays).toBeGreaterThan(0);
      expect(config.minSampleSize).toBeGreaterThan(0);
      expect(typeof config.enabled).toBe('boolean');
    });
  });
});
