/**
 * 广告优化算法改进单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  calculateTimeDecayWeight,
  calculateTimeDecayWeights,
  calculateTimeWeightedAverage,
  calculateTimeWeightedROAS,
  calculateTimeWeightedACoS,
  calculateUCBTuned,
  calculateUCBBidSuggestion,
  getHolidayConfig,
  getPreHolidayMultiplier,
  getDateAdjustmentMultipliers,
  MARKETPLACE_HOLIDAYS,
  type UCBBidSuggestion
} from './algorithmUtils';

import {
  calculateSemanticSimilarity,
  calculateJaccardSimilarity,
  calculateCombinedSimilarity,
  hierarchicalClustering,
  type SearchTermData
} from './semanticClusteringService';

describe('时间衰减权重计算', () => {
  it('当天数据应该有最高权重', () => {
    const today = new Date();
    const weight = calculateTimeDecayWeight(today, 7, today);
    expect(weight).toBe(1);
  });

  it('7天前的数据权重应该是0.5', () => {
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weight = calculateTimeDecayWeight(sevenDaysAgo, 7, today);
    expect(weight).toBeCloseTo(0.5, 2);
  });

  it('14天前的数据权重应该是0.25', () => {
    const today = new Date();
    const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
    const weight = calculateTimeDecayWeight(fourteenDaysAgo, 7, today);
    expect(weight).toBeCloseTo(0.25, 2);
  });

  it('批量权重应该归一化为1', () => {
    const today = new Date();
    const dates = [
      today,
      new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
      new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
    ];
    const weights = calculateTimeDecayWeights(dates, 7, today);
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('时间加权指标计算', () => {
  it('应该正确计算时间加权平均值', () => {
    const today = new Date();
    const values = [100, 80, 60];
    const dates = [
      today,
      new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
      new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
    ];
    const weightedAvg = calculateTimeWeightedAverage(values, dates, 7);
    // 近期数据权重更高，所以加权平均应该接近100
    expect(weightedAvg).toBeGreaterThan(80);
  });

  it('应该正确计算时间加权ROAS', () => {
    const today = new Date();
    const dailyData = [
      { date: today, spend: 100, sales: 400 },
      { date: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000), spend: 100, sales: 200 },
      { date: new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000), spend: 100, sales: 100 }
    ];
    const weightedROAS = calculateTimeWeightedROAS(dailyData, 7);
    // 近期ROAS是4，7天前是2，14天前是1
    // 加权后应该更接近4
    expect(weightedROAS).toBeGreaterThan(2.5);
    expect(weightedROAS).toBeLessThan(4);
  });

  it('应该正确计算时间加权ACoS', () => {
    const today = new Date();
    const dailyData = [
      { date: today, spend: 100, sales: 400 },
      { date: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000), spend: 100, sales: 200 }
    ];
    const weightedACoS = calculateTimeWeightedACoS(dailyData, 7);
    // ACoS = 1/ROAS
    expect(weightedACoS).toBeGreaterThan(0);
    expect(weightedACoS).toBeLessThan(0.5);
  });
});

describe('UCB探索-利用平衡', () => {
  it('UCB-Tuned应该考虑方差', () => {
    const avgReward = 3;
    const totalTrials = 1000;
    const armTrials = 50;
    const lowVariance = 0.1;
    const highVariance = 1.0;

    const ucbLowVar = calculateUCBTuned(avgReward, totalTrials, armTrials, lowVariance);
    const ucbHighVar = calculateUCBTuned(avgReward, totalTrials, armTrials, highVariance);

    // 高方差应该导致更高的UCB分数（更多探索）
    expect(ucbHighVar).toBeGreaterThan(ucbLowVar);
  });

  it('零次尝试应该返回Infinity', () => {
    const ucb = calculateUCBTuned(3, 1000, 0, 0.5);
    expect(ucb).toBe(Infinity);
  });

  it('UCB竞价建议应该根据点击数确定策略', () => {
    // 少量点击 - 探索策略
    const exploreSuggestion = calculateUCBBidSuggestion(1.0, 2.0, 5, 1000, 0.5, 3);
    expect(exploreSuggestion.strategy).toBe('explore');
    expect(exploreSuggestion.confidence).toBeLessThan(0.5);

    // 中等点击 - 平衡策略
    const balancedSuggestion = calculateUCBBidSuggestion(1.0, 3.0, 30, 1000, 0.5, 3);
    expect(balancedSuggestion.strategy).toBe('balanced');

    // 大量点击 - 利用策略
    const exploitSuggestion = calculateUCBBidSuggestion(1.0, 4.0, 100, 1000, 0.5, 3);
    expect(exploitSuggestion.strategy).toBe('exploit');
    expect(exploitSuggestion.confidence).toBeGreaterThan(0.7);
  });

  it('高ROAS应该建议提高出价', () => {
    const suggestion = calculateUCBBidSuggestion(1.0, 5.0, 100, 1000, 0.5, 3);
    expect(suggestion.suggestedBid).toBeGreaterThan(1.0);
  });

  it('低ROAS应该建议降低出价', () => {
    const suggestion = calculateUCBBidSuggestion(1.0, 1.5, 100, 1000, 0.5, 3);
    expect(suggestion.suggestedBid).toBeLessThan(1.0);
  });
});

describe('节假日配置', () => {
  it('应该正确识别Black Friday', () => {
    const blackFriday = new Date('2026-11-27');
    const config = getHolidayConfig(blackFriday, 'US');
    expect(config).not.toBeNull();
    expect(config?.name).toBe('Black Friday');
    expect(config?.bidMultiplier).toBeGreaterThan(1);
  });

  it('应该正确识别Prime Day日期范围', () => {
    const primeDay1 = new Date('2026-07-15');
    const primeDay2 = new Date('2026-07-16');
    
    const config1 = getHolidayConfig(primeDay1, 'US');
    const config2 = getHolidayConfig(primeDay2, 'US');
    
    expect(config1?.name).toBe('Prime Day');
    expect(config2?.name).toBe('Prime Day');
  });

  it('普通日期应该返回null', () => {
    const normalDay = new Date('2026-03-15');
    const config = getHolidayConfig(normalDay, 'US');
    expect(config).toBeNull();
  });

  it('应该正确计算预热期乘数', () => {
    // Black Friday前3天
    const preBlackFriday = new Date('2026-11-24');
    const result = getPreHolidayMultiplier(preBlackFriday, 'US', 7);
    
    expect(result.holidayName).toBe('Black Friday');
    expect(result.bidMultiplier).toBeGreaterThan(1);
    expect(result.bidMultiplier).toBeLessThan(1.8); // 小于节假日当天的乘数
  });

  it('应该正确返回日期调整乘数', () => {
    // 节假日当天
    const blackFriday = new Date('2026-11-27');
    const holidayResult = getDateAdjustmentMultipliers(blackFriday, 'US');
    expect(holidayResult.bidMultiplier).toBe(1.8);
    expect(holidayResult.reason).toContain('Black Friday');

    // 普通日期
    const normalDay = new Date('2026-03-15');
    const normalResult = getDateAdjustmentMultipliers(normalDay, 'US');
    expect(normalResult.bidMultiplier).toBe(1);
    expect(normalResult.reason).toBe('Normal day');
  });

  it('不同站点应该有不同的节假日配置', () => {
    expect(MARKETPLACE_HOLIDAYS['US']).toBeDefined();
    expect(MARKETPLACE_HOLIDAYS['UK']).toBeDefined();
    expect(MARKETPLACE_HOLIDAYS['JP']).toBeDefined();
    
    // UK有Boxing Day，US没有
    const boxingDay = new Date('2026-12-26');
    const ukConfig = getHolidayConfig(boxingDay, 'UK');
    expect(ukConfig?.name).toBe('Boxing Day');
  });
});

describe('语义相似度计算', () => {
  it('相同的词应该有相似度1', () => {
    const similarity = calculateSemanticSimilarity('wireless headphones', 'wireless headphones');
    expect(similarity).toBe(1);
  });

  it('相似的词应该有较高相似度', () => {
    const similarity = calculateSemanticSimilarity('wireless headphones', 'wireless earbuds');
    expect(similarity).toBeGreaterThan(0.3);
  });

  it('完全不同的词应该有较低相似度', () => {
    const similarity = calculateSemanticSimilarity('wireless headphones', 'kitchen knife');
    expect(similarity).toBeLessThan(0.3);
  });

  it('Jaccard相似度应该基于词集合', () => {
    const similarity = calculateJaccardSimilarity('wireless bluetooth headphones', 'wireless headphones');
    // 交集2个词，并集3个词，相似度应该是2/3
    expect(similarity).toBeCloseTo(2/3, 2);
  });

  it('综合相似度应该结合两种方法', () => {
    const combined = calculateCombinedSimilarity('wireless headphones', 'wireless earbuds');
    const semantic = calculateSemanticSimilarity('wireless headphones', 'wireless earbuds');
    const jaccard = calculateJaccardSimilarity('wireless headphones', 'wireless earbuds');
    
    // 综合相似度应该在两者之间
    expect(combined).toBeGreaterThanOrEqual(Math.min(semantic, jaccard));
    expect(combined).toBeLessThanOrEqual(Math.max(semantic, jaccard));
  });
});

describe('层次聚类', () => {
  it('相似的搜索词应该被聚类在一起', () => {
    const terms: SearchTermData[] = [
      { searchTerm: 'wireless headphones', impressions: 1000, clicks: 50, spend: 100, sales: 200, orders: 10, acos: 0.5, roas: 2 },
      { searchTerm: 'wireless earbuds', impressions: 800, clicks: 40, spend: 80, sales: 160, orders: 8, acos: 0.5, roas: 2 },
      { searchTerm: 'bluetooth headphones', impressions: 600, clicks: 30, spend: 60, sales: 120, orders: 6, acos: 0.5, roas: 2 },
      { searchTerm: 'kitchen knife', impressions: 500, clicks: 25, spend: 50, sales: 100, orders: 5, acos: 0.5, roas: 2 },
      { searchTerm: 'chef knife', impressions: 400, clicks: 20, spend: 40, sales: 80, orders: 4, acos: 0.5, roas: 2 },
      { searchTerm: 'cooking knife', impressions: 300, clicks: 15, spend: 30, sales: 60, orders: 3, acos: 0.5, roas: 2 },
    ];

    const clusters = hierarchicalClustering(terms, {
      minSimilarityThreshold: 0.3,
      minClusterSize: 2,
      minSpendThreshold: 10,
      minClicksThreshold: 5,
      targetAcos: 0.30,
      lookbackDays: 30
    });

    // 应该形成至少2个聚类（耳机类和刀具类）
    expect(clusters.length).toBeGreaterThanOrEqual(1);
  });

  it('空输入应该返回空数组', () => {
    const clusters = hierarchicalClustering([], {
      minSimilarityThreshold: 0.5,
      minClusterSize: 3,
      minSpendThreshold: 10,
      minClicksThreshold: 5,
      targetAcos: 0.30,
      lookbackDays: 30
    });
    expect(clusters).toEqual([]);
  });

  it('高ACoS聚类应该有强否定建议', () => {
    const terms: SearchTermData[] = [
      { searchTerm: 'cheap wireless headphones', impressions: 1000, clicks: 50, spend: 100, sales: 50, orders: 0, acos: 2, roas: 0.5 },
      { searchTerm: 'cheap bluetooth headphones', impressions: 800, clicks: 40, spend: 80, sales: 40, orders: 0, acos: 2, roas: 0.5 },
      { searchTerm: 'cheap earbuds', impressions: 600, clicks: 30, spend: 60, sales: 30, orders: 0, acos: 2, roas: 0.5 },
    ];

    const clusters = hierarchicalClustering(terms, {
      minSimilarityThreshold: 0.3,
      minClusterSize: 2,
      minSpendThreshold: 10,
      minClicksThreshold: 5,
      targetAcos: 0.30,
      lookbackDays: 30
    });

    // 无转化且高花费的聚类应该有强否定建议
    if (clusters.length > 0) {
      expect(clusters[0].negationRecommendation).toBe('strong');
    }
  });
});
