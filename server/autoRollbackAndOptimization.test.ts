import { describe, it, expect, beforeEach } from 'vitest';
import * as autoRollbackService from './autoRollbackService';
import * as algorithmOptimizationService from './algorithmOptimizationService';

describe('自动回滚规则服务', () => {
  describe('getRollbackRules', () => {
    it('应该返回默认规则列表', () => {
      const rules = autoRollbackService.getRollbackRules();
      expect(rules).toBeDefined();
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThan(0);
    });

    it('默认规则应该包含必要字段', () => {
      const rules = autoRollbackService.getRollbackRules();
      const rule = rules[0];
      expect(rule.id).toBeDefined();
      expect(rule.name).toBeDefined();
      expect(rule.description).toBeDefined();
      expect(rule.enabled).toBeDefined();
      expect(rule.conditions).toBeDefined();
      expect(rule.actions).toBeDefined();
    });
  });

  describe('getRollbackRule', () => {
    it('应该返回指定ID的规则', () => {
      const rules = autoRollbackService.getRollbackRules();
      const rule = autoRollbackService.getRollbackRule(rules[0].id);
      expect(rule).toBeDefined();
      expect(rule?.id).toBe(rules[0].id);
    });

    it('不存在的ID应该返回undefined', () => {
      const rule = autoRollbackService.getRollbackRule('non_existent_id');
      expect(rule).toBeUndefined();
    });
  });

  describe('createRollbackRule', () => {
    it('应该创建新规则', () => {
      const newRule = autoRollbackService.createRollbackRule({
        name: '测试规则',
        description: '测试描述',
        enabled: true,
        conditions: {
          profitThresholdPercent: 40,
          minTrackingDays: 7,
          minSampleCount: 1,
          includeNegativeAdjustments: false,
        },
        actions: {
          autoRollback: false,
          sendNotification: true,
          notificationPriority: 'medium',
        },
      });

      expect(newRule.id).toBeDefined();
      expect(newRule.name).toBe('测试规则');
      expect(newRule.conditions.profitThresholdPercent).toBe(40);
    });
  });

  describe('updateRollbackRule', () => {
    it('应该更新现有规则', () => {
      const rules = autoRollbackService.getRollbackRules();
      const originalRule = rules[0];
      
      const updatedRule = autoRollbackService.updateRollbackRule(originalRule.id, {
        name: '更新后的名称',
      });

      expect(updatedRule).toBeDefined();
      expect(updatedRule?.name).toBe('更新后的名称');
    });

    it('不存在的规则应该返回null', () => {
      const result = autoRollbackService.updateRollbackRule('non_existent', { name: 'test' });
      expect(result).toBeNull();
    });
  });

  describe('evaluateAdjustment', () => {
    it('应该评估调整记录并生成建议', () => {
      const rule: autoRollbackService.RollbackRule = {
        id: 'test_rule',
        name: '测试规则',
        description: '测试',
        enabled: true,
        conditions: {
          profitThresholdPercent: 50,
          minTrackingDays: 7,
          minSampleCount: 1,
          includeNegativeAdjustments: false,
        },
        actions: {
          autoRollback: false,
          sendNotification: true,
          notificationPriority: 'high',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const record = {
        id: 1,
        keywordId: 100,
        keywordText: '测试关键词',
        campaignId: 200,
        campaignName: '测试活动',
        previousBid: 1.0,
        newBid: 1.5,
        bidChangePercent: 50,
        adjustedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        estimatedProfitChange: 100,
        actualProfit7d: 20, // 只有预估的20%
        actualProfit14d: null,
        actualProfit30d: null,
      };

      const suggestion = autoRollbackService.evaluateAdjustment(record, rule);
      expect(suggestion).toBeDefined();
      expect(suggestion?.status).toBe('pending');
      expect(suggestion?.priority).toBe('high');
    });

    it('禁用的规则不应该生成建议', () => {
      const rule: autoRollbackService.RollbackRule = {
        id: 'disabled_rule',
        name: '禁用规则',
        description: '测试',
        enabled: false,
        conditions: {
          profitThresholdPercent: 50,
          minTrackingDays: 7,
          minSampleCount: 1,
          includeNegativeAdjustments: false,
        },
        actions: {
          autoRollback: false,
          sendNotification: true,
          notificationPriority: 'high',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const record = {
        id: 1,
        keywordId: 100,
        keywordText: '测试关键词',
        campaignId: 200,
        campaignName: '测试活动',
        previousBid: 1.0,
        newBid: 1.5,
        bidChangePercent: 50,
        adjustedAt: new Date(),
        estimatedProfitChange: 100,
        actualProfit7d: 20,
        actualProfit14d: null,
        actualProfit30d: null,
      };

      const suggestion = autoRollbackService.evaluateAdjustment(record, rule);
      expect(suggestion).toBeNull();
    });

    it('效果达标的调整不应该生成建议', () => {
      const rule: autoRollbackService.RollbackRule = {
        id: 'test_rule',
        name: '测试规则',
        description: '测试',
        enabled: true,
        conditions: {
          profitThresholdPercent: 50,
          minTrackingDays: 7,
          minSampleCount: 1,
          includeNegativeAdjustments: false,
        },
        actions: {
          autoRollback: false,
          sendNotification: true,
          notificationPriority: 'high',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const record = {
        id: 1,
        keywordId: 100,
        keywordText: '测试关键词',
        campaignId: 200,
        campaignName: '测试活动',
        previousBid: 1.0,
        newBid: 1.5,
        bidChangePercent: 50,
        adjustedAt: new Date(),
        estimatedProfitChange: 100,
        actualProfit7d: 80, // 80%达标
        actualProfit14d: null,
        actualProfit30d: null,
      };

      const suggestion = autoRollbackService.evaluateAdjustment(record, rule);
      expect(suggestion).toBeNull();
    });
  });

  describe('getRollbackSuggestions', () => {
    it('应该返回建议列表', () => {
      const suggestions = autoRollbackService.getRollbackSuggestions();
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('应该支持状态过滤', () => {
      const suggestions = autoRollbackService.getRollbackSuggestions({ status: 'pending' });
      suggestions.forEach(s => {
        expect(s.status).toBe('pending');
      });
    });
  });

  describe('getRollbackSuggestionStats', () => {
    it('应该返回统计数据', () => {
      const stats = autoRollbackService.getRollbackSuggestionStats();
      expect(stats).toBeDefined();
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.pending).toBe('number');
      expect(typeof stats.approved).toBe('number');
      expect(typeof stats.rejected).toBe('number');
      expect(typeof stats.executed).toBe('number');
      expect(stats.byPriority).toBeDefined();
      expect(stats.byRule).toBeDefined();
    });
  });
});

describe('算法优化建议服务', () => {
  describe('getAlgorithmParameters', () => {
    it('应该返回算法参数', () => {
      const params = algorithmOptimizationService.getAlgorithmParameters();
      expect(params).toBeDefined();
      expect(typeof params.maxBidIncreasePercent).toBe('number');
      expect(typeof params.maxBidDecreasePercent).toBe('number');
      expect(typeof params.minBidChangePercent).toBe('number');
      expect(typeof params.profitMarginPercent).toBe('number');
    });
  });

  describe('updateAlgorithmParameters', () => {
    it('应该更新算法参数', () => {
      const originalParams = algorithmOptimizationService.getAlgorithmParameters();
      const newValue = originalParams.maxBidIncreasePercent + 5;
      
      const updatedParams = algorithmOptimizationService.updateAlgorithmParameters({
        maxBidIncreasePercent: newValue,
      });

      expect(updatedParams.maxBidIncreasePercent).toBe(newValue);
      
      // 恢复原值
      algorithmOptimizationService.updateAlgorithmParameters({
        maxBidIncreasePercent: originalParams.maxBidIncreasePercent,
      });
    });
  });

  describe('resetAlgorithmParameters', () => {
    it('应该重置为默认参数', () => {
      // 先修改参数
      algorithmOptimizationService.updateAlgorithmParameters({
        maxBidIncreasePercent: 99,
      });

      // 重置
      const resetParams = algorithmOptimizationService.resetAlgorithmParameters();
      
      expect(resetParams.maxBidIncreasePercent).toBe(
        algorithmOptimizationService.DEFAULT_ALGORITHM_PARAMETERS.maxBidIncreasePercent
      );
    });
  });

  describe('calculateAlgorithmPerformance', () => {
    it('应该返回性能指标', async () => {
      const metrics = await algorithmOptimizationService.calculateAlgorithmPerformance();
      expect(metrics).toBeDefined();
      expect(typeof metrics.totalAdjustments).toBe('number');
      expect(typeof metrics.trackedAdjustments).toBe('number');
      expect(typeof metrics.trackingRate).toBe('number');
    });
  });

  describe('analyzeByAdjustmentType', () => {
    it('应该返回按类型分析结果', async () => {
      const analysis = await algorithmOptimizationService.analyzeByAdjustmentType();
      expect(Array.isArray(analysis)).toBe(true);
    });
  });

  describe('analyzeByBidChangeRange', () => {
    it('应该返回按幅度分析结果', async () => {
      const analysis = await algorithmOptimizationService.analyzeByBidChangeRange();
      expect(Array.isArray(analysis)).toBe(true);
    });
  });

  describe('generateOptimizationSuggestions', () => {
    it('应该生成优化建议', async () => {
      const suggestions = await algorithmOptimizationService.generateOptimizationSuggestions();
      expect(Array.isArray(suggestions)).toBe(true);
      
      if (suggestions.length > 0) {
        const suggestion = suggestions[0];
        expect(suggestion.id).toBeDefined();
        expect(suggestion.category).toBeDefined();
        expect(suggestion.priority).toBeDefined();
        expect(suggestion.title).toBeDefined();
        expect(suggestion.description).toBeDefined();
      }
    });
  });

  describe('getParameterTuningSuggestions', () => {
    it('应该返回参数调优建议', () => {
      const metrics: algorithmOptimizationService.AlgorithmPerformanceMetrics = {
        totalAdjustments: 100,
        trackedAdjustments: 80,
        trackingRate: 80,
        accuracy7d: 55,
        accuracy14d: 60,
        accuracy30d: 65,
        mae7d: 25,
        mae14d: 30,
        mae30d: 35,
        rmse7d: 30,
        rmse14d: 35,
        rmse30d: 40,
        directionAccuracy7d: 60,
        directionAccuracy14d: 65,
        directionAccuracy30d: 70,
        totalEstimatedProfit: 1000,
        totalActualProfit7d: 600,
        totalActualProfit14d: 700,
        totalActualProfit30d: 800,
      };

      const byRange: algorithmOptimizationService.DimensionPerformance[] = [
        {
          dimension: 'bidChangeRange',
          value: '大幅提价 (>20%)',
          count: 20,
          accuracy: 40,
          mae: 50,
          totalEstimated: 500,
          totalActual: 200,
          recommendation: '建议降低幅度',
        },
      ];

      const suggestions = algorithmOptimizationService.getParameterTuningSuggestions(metrics, byRange);
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });
});

describe('默认回滚规则配置', () => {
  it('应该有三个默认规则', () => {
    expect(autoRollbackService.DEFAULT_ROLLBACK_RULES.length).toBe(3);
  });

  it('严重效果不佳规则配置正确', () => {
    const rule = autoRollbackService.DEFAULT_ROLLBACK_RULES.find(r => r.id === 'rule_severe_underperform');
    expect(rule).toBeDefined();
    expect(rule?.conditions.profitThresholdPercent).toBe(30);
    expect(rule?.conditions.minTrackingDays).toBe(7);
    expect(rule?.actions.notificationPriority).toBe('high');
  });

  it('中度效果不佳规则配置正确', () => {
    const rule = autoRollbackService.DEFAULT_ROLLBACK_RULES.find(r => r.id === 'rule_moderate_underperform');
    expect(rule).toBeDefined();
    expect(rule?.conditions.profitThresholdPercent).toBe(50);
    expect(rule?.conditions.minTrackingDays).toBe(14);
    expect(rule?.actions.notificationPriority).toBe('medium');
  });

  it('长期效果不佳规则配置正确', () => {
    const rule = autoRollbackService.DEFAULT_ROLLBACK_RULES.find(r => r.id === 'rule_long_term_underperform');
    expect(rule).toBeDefined();
    expect(rule?.conditions.profitThresholdPercent).toBe(40);
    expect(rule?.conditions.minTrackingDays).toBe(30);
    expect(rule?.conditions.includeNegativeAdjustments).toBe(true);
  });
});

describe('默认算法参数配置', () => {
  it('应该有合理的默认值', () => {
    const params = algorithmOptimizationService.DEFAULT_ALGORITHM_PARAMETERS;
    expect(params.maxBidIncreasePercent).toBe(30);
    expect(params.maxBidDecreasePercent).toBe(20);
    expect(params.minBidChangePercent).toBe(5);
    expect(params.profitMarginPercent).toBe(30);
    expect(params.maxDailyAdjustments).toBe(100);
    expect(params.cooldownPeriodHours).toBe(24);
    expect(params.minConfidenceThreshold).toBe(70);
    expect(params.minDataPoints).toBe(10);
  });
});
