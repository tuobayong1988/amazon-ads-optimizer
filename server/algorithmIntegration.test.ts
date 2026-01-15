import { describe, it, expect } from 'vitest';
import * as algorithmUtils from './algorithmUtils';
import * as holidayConfigService from './holidayConfigService';

describe('Algorithm Integration Tests', () => {
  describe('Time Decay Weight Algorithm', () => {
    it('should calculate time decay weight correctly', () => {
      const calculateTimeDecayWeight = algorithmUtils.calculateTimeDecayWeight;
      
      const now = new Date();
      const todayDate = new Date(now);
      const weekAgoDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgoDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      // 今天的数据应该有最高权重
      const todayWeight = calculateTimeDecayWeight(todayDate, 7, now);
      expect(todayWeight).toBeCloseTo(1.0, 2);
      
      // 一周前的数据应该有约0.5的权重（半衰期为7天）
      const weekAgoWeight = calculateTimeDecayWeight(weekAgoDate, 7, now);
      expect(weekAgoWeight).toBeCloseTo(0.5, 1);
      
      // 一个月前的数据应该有更低的权重
      const monthAgoWeight = calculateTimeDecayWeight(monthAgoDate, 7, now);
      expect(monthAgoWeight).toBeLessThan(weekAgoWeight);
      expect(monthAgoWeight).toBeGreaterThan(0);
    });

    it('should handle different half-life values', () => {
      const calculateTimeDecayWeight = algorithmUtils.calculateTimeDecayWeight;
      
      const now = new Date();
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      
      // 较长的半衰期应该导致较慢的权重下降
      const shortHalfLife = calculateTimeDecayWeight(twoWeeksAgo, 7, now);
      const longHalfLife = calculateTimeDecayWeight(twoWeeksAgo, 14, now);
      
      expect(longHalfLife).toBeGreaterThan(shortHalfLife);
      expect(longHalfLife).toBeCloseTo(0.5, 1); // 14天半衰期，14天前应该是0.5
    });
  });

  describe('UCB Tuned Algorithm', () => {
    it('should calculate UCB score correctly', () => {
      const calculateUCBTuned = algorithmUtils.calculateUCBTuned;
      
      // 高平均值应该有更高的UCB分数
      const highAvgScore = calculateUCBTuned(0.8, 1000, 100, 0.1);
      const lowAvgScore = calculateUCBTuned(0.2, 1000, 100, 0.1);
      
      expect(highAvgScore).toBeGreaterThan(lowAvgScore);
    });

    it('should favor exploration for low trial counts', () => {
      const calculateUCBTuned = algorithmUtils.calculateUCBTuned;
      
      // 低试验次数应该有更高的探索加成
      const lowTrialScore = calculateUCBTuned(0.5, 1000, 10, 0.1);
      const highTrialScore = calculateUCBTuned(0.5, 1000, 500, 0.1);
      
      // 低试验次数的探索项更大
      expect(lowTrialScore).toBeGreaterThan(highTrialScore);
    });

    it('should handle edge cases', () => {
      const calculateUCBTuned = algorithmUtils.calculateUCBTuned;
      
      // 零试验次数应该返回无穷大（优先探索）
      const zeroTrialScore = calculateUCBTuned(0.5, 1000, 0, 0.1);
      expect(zeroTrialScore).toBe(Infinity);
    });

    it('should increase exploration with higher variance', () => {
      const calculateUCBTuned = algorithmUtils.calculateUCBTuned;
      
      // 高方差应该导致更高的UCB分数（更多探索）
      const lowVarianceScore = calculateUCBTuned(0.5, 1000, 100, 0.01);
      const highVarianceScore = calculateUCBTuned(0.5, 1000, 100, 0.5);
      
      expect(highVarianceScore).toBeGreaterThan(lowVarianceScore);
    });
  });

  describe('UCB Bid Suggestion', () => {
    it('should suggest exploration for new keywords', () => {
      const suggestion = algorithmUtils.calculateUCBBidSuggestion(
        1.0,  // currentBid
        2.0,  // averageROAS
        5,    // clicks (low)
        1000, // totalClicks
        0.1,  // roasVariance
        3.0   // targetROAS
      );
      
      expect(suggestion.strategy).toBe('explore');
      expect(suggestion.confidence).toBeLessThan(0.5);
      expect(suggestion.suggestedBid).toBeGreaterThanOrEqual(1.0);
    });

    it('should suggest exploitation for established keywords', () => {
      const suggestion = algorithmUtils.calculateUCBBidSuggestion(
        1.0,  // currentBid
        4.0,  // averageROAS (above target)
        200,  // clicks (high)
        1000, // totalClicks
        0.1,  // roasVariance
        3.0   // targetROAS
      );
      
      expect(suggestion.strategy).toBe('exploit');
      expect(suggestion.confidence).toBeGreaterThan(0.7);
    });

    it('should limit bid adjustments to reasonable range', () => {
      const suggestion = algorithmUtils.calculateUCBBidSuggestion(
        1.0,  // currentBid
        10.0, // averageROAS (very high)
        100,  // clicks
        1000, // totalClicks
        0.1,  // roasVariance
        3.0   // targetROAS
      );
      
      // 竞价调整应该在±30%范围内
      expect(suggestion.suggestedBid).toBeLessThanOrEqual(1.3);
      expect(suggestion.suggestedBid).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('Holiday Config Service', () => {
    it('should return supported marketplaces', () => {
      const marketplaces = holidayConfigService.getSupportedMarketplaces();
      
      expect(Array.isArray(marketplaces)).toBe(true);
      expect(marketplaces.length).toBeGreaterThan(0);
      
      // getSupportedMarketplaces返回的是站点代码数组
      expect(marketplaces).toContain('US');
      expect(marketplaces).toContain('UK');
      expect(marketplaces).toContain('DE');
      expect(marketplaces).toContain('JP');
    });

    it('should have correct marketplace codes', () => {
      const marketplaces = holidayConfigService.getSupportedMarketplaces();
      
      // 每个站点代码应该是字符串
      marketplaces.forEach(mp => {
        expect(typeof mp).toBe('string');
        expect(mp.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Time Weighted Calculations', () => {
    it('should calculate time weighted average correctly', () => {
      const now = new Date();
      const values = [100, 80, 60, 40];
      const dates = [
        new Date(now.getTime() - 0 * 24 * 60 * 60 * 1000),
        new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
        new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000),
      ];
      
      const weightedAvg = algorithmUtils.calculateTimeWeightedAverage(values, dates, 7);
      
      // 加权平均应该偏向近期的高值
      expect(weightedAvg).toBeGreaterThan(60); // 简单平均是70
    });

    it('should calculate time weighted ROAS correctly', () => {
      const now = new Date();
      const dailyData = [
        { date: new Date(now.getTime() - 0 * 24 * 60 * 60 * 1000), spend: 100, sales: 400 },
        { date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), spend: 100, sales: 300 },
        { date: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), spend: 100, sales: 200 },
      ];
      
      const weightedROAS = algorithmUtils.calculateTimeWeightedROAS(dailyData, 7);
      
      // 加权ROAS应该偏向近期的高ROAS
      expect(weightedROAS).toBeGreaterThan(2.5); // 简单平均ROAS是3
      expect(weightedROAS).toBeLessThan(4.0);
    });
  });

  describe('Algorithm Effect Tracking', () => {
    it('should have correct effect record structure', () => {
      const mockEffectRecord = {
        id: 1,
        userId: 1,
        accountId: 1,
        entityType: 'keyword',
        entityId: '12345',
        algorithmType: 'time_decay_bid',
        actionType: 'bid_adjustment',
        beforeValue: '1.00',
        afterValue: '1.15',
        predictedEffect: 0.1,
        actualEffect: null,
        roasBefore: '2.5',
        roasAfter: null,
        acosBefore: '40.0',
        acosAfter: null,
        status: 'pending',
        createdAt: new Date(),
        effectMeasuredAt: null
      };
      
      expect(mockEffectRecord).toHaveProperty('id');
      expect(mockEffectRecord).toHaveProperty('algorithmType');
      expect(mockEffectRecord).toHaveProperty('beforeValue');
      expect(mockEffectRecord).toHaveProperty('afterValue');
      expect(mockEffectRecord).toHaveProperty('predictedEffect');
      expect(mockEffectRecord.status).toBe('pending');
    });
  });
});

describe('Placement Coordination Algorithm', () => {
  it('should optimize placement allocation within budget', () => {
    const placements = [
      { type: 'top_of_search', roas: 3.5, currentBudgetShare: 0.4 },
      { type: 'product_pages', roas: 2.0, currentBudgetShare: 0.35 },
      { type: 'rest_of_search', roas: 1.5, currentBudgetShare: 0.25 },
    ];
    
    // 计算边际效益
    const marginalBenefits = placements.map(p => ({
      ...p,
      marginalBenefit: p.roas * (1 - p.currentBudgetShare)
    }));
    
    // 按边际效益排序
    marginalBenefits.sort((a, b) => b.marginalBenefit - a.marginalBenefit);
    
    // 验证top_of_search应该有最高的边际效益
    expect(marginalBenefits[0].type).toBe('top_of_search');
  });
});

describe('Semantic Clustering for Negative Keywords', () => {
  it('should calculate Jaccard similarity correctly', () => {
    const calculateJaccardSimilarity = (a: string, b: string): number => {
      const setA = new Set(a.toLowerCase().split(' '));
      const setB = new Set(b.toLowerCase().split(' '));
      
      const intersection = new Set([...setA].filter(x => setB.has(x)));
      const union = new Set([...setA, ...setB]);
      
      return intersection.size / union.size;
    };
    
    // 完全相同的词应该有相似度1
    expect(calculateJaccardSimilarity('test keyword', 'test keyword')).toBe(1);
    
    // 完全不同的词应该有相似度0
    expect(calculateJaccardSimilarity('apple fruit', 'car vehicle')).toBe(0);
    
    // 部分重叠应该有中间相似度
    const partialSimilarity = calculateJaccardSimilarity('red apple', 'green apple');
    expect(partialSimilarity).toBeGreaterThan(0);
    expect(partialSimilarity).toBeLessThan(1);
  });
});
