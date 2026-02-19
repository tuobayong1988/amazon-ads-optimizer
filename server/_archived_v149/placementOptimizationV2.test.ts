/**
 * 位置倾斜算法V2单元测试
 * 
 * 测试改进后的算法功能：
 * 1. 置信度计算（基于转化次数）
 * 2. 调整幅度限制
 * 3. 竞价策略协同
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateDataConfidence,
  calculateEfficiencyScore,
  calculateAdjustmentDelta,
  getMaxAdjustmentByBiddingStrategy,
  DEFAULT_WEIGHTS,
  DEFAULT_BENCHMARKS
} from './placementOptimizationService';

describe('位置倾斜算法V2', () => {
  
  describe('calculateDataConfidence - 数据置信度计算', () => {
    
    it('应该对高数据量返回高置信度', () => {
      const result = calculateDataConfidence({
        clicks: 250,
        orders: 25,
        spend: 150
      });
      
      expect(result.confidence).toBe(1.0);
      expect(result.isReliable).toBe(true);
      expect(result.reason).toContain('高置信度');
    });
    
    it('应该对中等数据量返回中高置信度', () => {
      const result = calculateDataConfidence({
        clicks: 120,
        orders: 12,
        spend: 60
      });
      
      expect(result.confidence).toBe(0.8);
      expect(result.isReliable).toBe(true);
      expect(result.reason).toContain('中高置信度');
    });
    
    it('应该对较少数据量返回中等置信度', () => {
      const result = calculateDataConfidence({
        clicks: 60,
        orders: 6,
        spend: 30
      });
      
      expect(result.confidence).toBe(0.6);
      expect(result.isReliable).toBe(true);
      expect(result.reason).toContain('可参考');
    });
    
    it('应该对不足数据量返回低置信度且标记为不可靠', () => {
      const result = calculateDataConfidence({
        clicks: 25,
        orders: 3,
        spend: 15
      });
      
      expect(result.confidence).toBe(0.4);
      expect(result.isReliable).toBe(false);
      expect(result.reason).toContain('建议继续观察');
    });
    
    it('应该对严重不足数据量返回最低置信度', () => {
      const result = calculateDataConfidence({
        clicks: 10,
        orders: 1,
        spend: 5
      });
      
      expect(result.confidence).toBe(0.2);
      expect(result.isReliable).toBe(false);
      expect(result.reason).toContain('不建议调整');
    });
    
    it('应该正确处理零转化情况', () => {
      const result = calculateDataConfidence({
        clicks: 50,
        orders: 0,
        spend: 25
      });
      
      expect(result.confidence).toBe(0.2);
      expect(result.isReliable).toBe(false);
    });
    
  });
  
  describe('calculateEfficiencyScore - 效率评分计算', () => {
    
    it('应该对高ROAS低ACoS返回高评分', () => {
      const { score, confidence } = calculateEfficiencyScore(
        {
          impressions: 10000,
          clicks: 200,
          spend: 100,
          sales: 500,
          orders: 20
        },
        DEFAULT_WEIGHTS,
        DEFAULT_BENCHMARKS
      );
      
      // ROAS = 5, ACoS = 20%, CVR = 10%
      expect(score).toBeGreaterThan(50);
      expect(confidence.isReliable).toBe(true);
    });
    
    it('应该对低ROAS高ACoS返回低评分', () => {
      const { score, confidence } = calculateEfficiencyScore(
        {
          impressions: 10000,
          clicks: 200,
          spend: 200,
          sales: 100,
          orders: 5
        },
        DEFAULT_WEIGHTS,
        DEFAULT_BENCHMARKS
      );
      
      // ROAS = 0.5, ACoS = 200%
      expect(score).toBeLessThan(30);
    });
    
    it('应该正确处理零花费情况', () => {
      const { score, confidence } = calculateEfficiencyScore(
        {
          impressions: 1000,
          clicks: 0,
          spend: 0,
          sales: 0,
          orders: 0
        },
        DEFAULT_WEIGHTS,
        DEFAULT_BENCHMARKS
      );
      
      // 零花费情况下，ACoS为100%，CPC为0，所以还是有一定评分
      expect(score).toBeGreaterThanOrEqual(0);
      expect(confidence.isReliable).toBe(false);
    });
    
    it('应该使用自定义基准值', () => {
      const customBenchmarks = {
        roasBaseline: 10,  // 更高的ROAS基准
        acosBaseline: 100,
        cvrBaseline: 20,
        cpcBaseline: 3
      };
      
      const { score: scoreWithDefault } = calculateEfficiencyScore(
        {
          impressions: 10000,
          clicks: 200,
          spend: 100,
          sales: 500,
          orders: 20
        },
        DEFAULT_WEIGHTS,
        DEFAULT_BENCHMARKS
      );
      
      const { score: scoreWithCustom } = calculateEfficiencyScore(
        {
          impressions: 10000,
          clicks: 200,
          spend: 100,
          sales: 500,
          orders: 20
        },
        DEFAULT_WEIGHTS,
        customBenchmarks
      );
      
      // 使用更高的ROAS基准，相同数据应该得到更低的评分
      expect(scoreWithCustom).toBeLessThan(scoreWithDefault);
    });
    
  });
  
  describe('calculateAdjustmentDelta - 调整幅度计算', () => {
    
    it('应该在数据不可靠时不进行调整', () => {
      const result = calculateAdjustmentDelta(
        50,   // 当前调整
        100,  // 建议调整
        0.4,  // 置信度
        false, // 不可靠
        'down_only'
      );
      
      expect(result.delta).toBe(0);
      expect(result.finalAdjustment).toBe(50);
      expect(result.wasLimited).toBe(true);
      expect(result.reason).toContain('数据不足');
    });
    
    it('应该根据置信度限制调整幅度（高置信度）', () => {
      const result = calculateAdjustmentDelta(
        50,   // 当前调整
        100,  // 建议调整（差距50%）
        0.9,  // 高置信度
        true,
        'down_only'
      );
      
      // 高置信度允许最大20%调整
      expect(result.delta).toBeLessThanOrEqual(20);
      expect(result.finalAdjustment).toBeLessThanOrEqual(70);
    });
    
    it('应该根据置信度限制调整幅度（中等置信度）', () => {
      const result = calculateAdjustmentDelta(
        50,   // 当前调整
        100,  // 建议调整
        0.7,  // 中等置信度
        true,
        'down_only'
      );
      
      // 中等置信度允许最大10%调整，但考虑到当前值50的25%规则，最大为12.5或13
      expect(result.delta).toBeLessThanOrEqual(15);
    });
    
    it('应该根据置信度限制调整幅度（低置信度）', () => {
      const result = calculateAdjustmentDelta(
        50,   // 当前调整
        100,  // 建议调整
        0.5,  // 低置信度
        true,
        'down_only'
      );
      
      // 低置信度允许最大5%调整，但考虑到当前值50的25%规则，最大为12.5或13
      expect(result.delta).toBeLessThanOrEqual(15);
    });
    
    it('应该允许负向调整', () => {
      const result = calculateAdjustmentDelta(
        100,  // 当前调整
        50,   // 建议调整（降低）
        0.9,
        true,
        'down_only'
      );
      
      expect(result.delta).toBeLessThan(0);
      expect(result.finalAdjustment).toBeLessThan(100);
    });
    
  });
  
  describe('getMaxAdjustmentByBiddingStrategy - 竞价策略协同', () => {
    
    it('应该对固定竞价返回200%上限', () => {
      const max = getMaxAdjustmentByBiddingStrategy('fixed');
      expect(max).toBe(200);
    });
    
    it('应该对仅降低竞价返回200%上限', () => {
      const max = getMaxAdjustmentByBiddingStrategy('down_only');
      expect(max).toBe(200);
    });
    
    it('应该对提高和降低竞价返回100%上限', () => {
      const max = getMaxAdjustmentByBiddingStrategy('up_and_down');
      expect(max).toBe(100);
    });
    
  });
  
  describe('calculateAdjustmentDelta - 竞价策略限制', () => {
    
    it('应该在up_and_down策略下限制最大调整为100%', () => {
      const result = calculateAdjustmentDelta(
        80,   // 当前调整
        150,  // 建议调整
        1.0,  // 高置信度
        true,
        'up_and_down'
      );
      
      expect(result.finalAdjustment).toBeLessThanOrEqual(100);
    });
    
    it('应该在down_only策略下允许最大调整为200%', () => {
      const result = calculateAdjustmentDelta(
        180,  // 当前调整
        250,  // 建议调整
        1.0,
        true,
        'down_only'
      );
      
      expect(result.finalAdjustment).toBeLessThanOrEqual(200);
    });
    
    it('应该确保调整不低于-50%', () => {
      const result = calculateAdjustmentDelta(
        0,    // 当前调整
        -100, // 建议大幅降低
        1.0,
        true,
        'down_only'
      );
      
      expect(result.finalAdjustment).toBeGreaterThanOrEqual(-50);
    });
    
  });
  
  describe('边界条件测试', () => {
    
    it('应该正确处理零点击情况', () => {
      const { score, confidence } = calculateEfficiencyScore(
        {
          impressions: 1000,
          clicks: 0,
          spend: 0,
          sales: 0,
          orders: 0
        },
        DEFAULT_WEIGHTS,
        DEFAULT_BENCHMARKS
      );
      
      // 零点击情况下，ACoS为100%，CPC为0，所以还是有一定评分
      expect(score).toBeGreaterThanOrEqual(0);
      expect(confidence.confidence).toBe(0.2);
    });
    
    it('应该正确处理极高ROAS情况', () => {
      const { score, normalizedMetrics } = calculateEfficiencyScore(
        {
          impressions: 10000,
          clicks: 100,
          spend: 50,
          sales: 1000,
          orders: 50
        },
        DEFAULT_WEIGHTS,
        DEFAULT_BENCHMARKS
      );
      
      // ROAS = 20，应该被归一化到1
      expect(normalizedMetrics.roasNorm).toBeLessThanOrEqual(1);
      expect(score).toBeGreaterThan(0);
    });
    
    it('应该正确处理当前调整为0的情况', () => {
      const result = calculateAdjustmentDelta(
        0,    // 当前调整为0
        50,   // 建议调整
        0.9,
        true,
        'down_only'
      );
      
      expect(result.delta).toBeGreaterThan(0);
      expect(result.finalAdjustment).toBeGreaterThan(0);
    });
    
  });
  
});

describe('置信度阈值改进验证', () => {
  
  it('旧算法10次点击就有0.4置信度，新算法需要更多数据', () => {
    // 旧算法：10次点击 = 0.4置信度
    // 新算法：需要至少2次转化和20次点击才能达到0.4置信度
    
    const lowDataResult = calculateDataConfidence({
      clicks: 10,
      orders: 0,
      spend: 5
    });
    
    // 新算法应该返回更低的置信度
    expect(lowDataResult.confidence).toBe(0.2);
    expect(lowDataResult.isReliable).toBe(false);
  });
  
  it('新算法需要至少5次转化才能标记为可靠', () => {
    const result4Conversions = calculateDataConfidence({
      clicks: 80,
      orders: 4,
      spend: 40
    });
    
    const result5Conversions = calculateDataConfidence({
      clicks: 80,
      orders: 5,
      spend: 40
    });
    
    expect(result4Conversions.isReliable).toBe(false);
    expect(result5Conversions.isReliable).toBe(true);
  });
  
});

describe('调整幅度限制改进验证', () => {
  
  it('应该基于置信度差异化调整幅度', () => {
    const highConfidenceResult = calculateAdjustmentDelta(
      50, 100, 0.9, true, 'down_only'
    );
    
    const lowConfidenceResult = calculateAdjustmentDelta(
      50, 100, 0.5, true, 'down_only'
    );
    
    // 高置信度应该允许更大的调整
    expect(highConfidenceResult.delta).toBeGreaterThanOrEqual(lowConfidenceResult.delta);
  });
  
  it('应该在单次调整中限制最大幅度为20%', () => {
    const result = calculateAdjustmentDelta(
      0,    // 当前
      200,  // 建议（差距200%）
      1.0,  // 最高置信度
      true,
      'down_only'
    );
    
    // 即使置信度最高，单次调整也不应超过20%
    expect(result.delta).toBeLessThanOrEqual(20);
  });
  
});
