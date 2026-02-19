/**
 * 算法工具函数测试
 */
import { describe, it, expect } from 'vitest';
import {
  calculateDynamicElasticity,
  convertToLocalTime,
  MARKETPLACE_TIMEZONES,
  estimateCPC,
  calculateUCB,
  calculateMinExplorationBudget,
  isNewKeyword,
  getExplorationStrategy,
  needsReEvaluation,
  type BidChangeRecord,
} from './algorithmUtils';

describe('动态弹性系数计算', () => {
  it('应该正确计算基于历史数据的弹性系数', () => {
    const historicalData: BidChangeRecord[] = [
      { oldBid: 1.0, newBid: 1.2, oldClicks: 100, newClicks: 130, timestamp: new Date() },
      { oldBid: 1.2, newBid: 1.1, oldClicks: 130, newClicks: 115, timestamp: new Date() },
      { oldBid: 1.1, newBid: 1.3, oldClicks: 115, newClicks: 145, timestamp: new Date() },
      { oldBid: 1.3, newBid: 1.0, oldClicks: 145, newClicks: 95, timestamp: new Date() },
      { oldBid: 1.0, newBid: 1.15, oldClicks: 95, newClicks: 110, timestamp: new Date() },
      { oldBid: 1.15, newBid: 1.25, oldClicks: 110, newClicks: 125, timestamp: new Date() },
    ];
    const result = calculateDynamicElasticity(historicalData);
    expect(result.elasticity).toBeGreaterThan(0.3);
    expect(result.elasticity).toBeLessThan(2.0);
    expect(result.method).toBe('historical');
  });
  
  it('应该在数据不足时返回默认弹性系数', () => {
    const historicalData: BidChangeRecord[] = [{ oldBid: 1.0, newBid: 1.2, oldClicks: 100, newClicks: 120, timestamp: new Date() }];
    const result = calculateDynamicElasticity(historicalData);
    expect(result.elasticity).toBe(0.8);
    expect(result.method).toBe('global_default');
  });
  
  it('应该根据品类调整弹性系数', () => {
    const historicalData: BidChangeRecord[] = [{ oldBid: 1.0, newBid: 1.2, oldClicks: 100, newClicks: 120, timestamp: new Date() }];
    const electronicsResult = calculateDynamicElasticity(historicalData, 'electronics');
    expect(electronicsResult.elasticity).toBe(1.2);
  });
});

describe('时区转换', () => {
  it('应该正确获取各站点的时区', () => {
    expect(MARKETPLACE_TIMEZONES['US']).toBe('America/Los_Angeles');
    expect(MARKETPLACE_TIMEZONES['UK']).toBe('Europe/London');
    expect(MARKETPLACE_TIMEZONES['JP']).toBe('Asia/Tokyo');
  });
  
  it('应该正确转换UTC时间到站点本地时间', () => {
    const utcDate = new Date('2026-01-09T08:00:00Z');
    const usLocalTime = convertToLocalTime(utcDate, 'US');
    expect(usLocalTime).toBeInstanceOf(Date);
  });
});

describe('CPC估算', () => {
  it('应该基于历史数据估算CPC', () => {
    const historicalData = [
      { bid: 1.0, cpc: 0.85, clicks: 100 },
      { bid: 1.2, cpc: 0.95, clicks: 120 },
      { bid: 0.9, cpc: 0.75, clicks: 80 },
    ];
    const estimate = estimateCPC(historicalData, 1.1);
    expect(estimate.estimatedCpc).toBeGreaterThan(0);
    expect(estimate.estimatedCpc).toBeLessThanOrEqual(1.1);
  });
  
  it('应该考虑广告位因素', () => {
    const topSearchData = [
      { bid: 1.0, cpc: 0.95, clicks: 100, placement: 'top_search' as const },
      { bid: 1.1, cpc: 1.00, clicks: 90, placement: 'top_search' as const },
      { bid: 0.9, cpc: 0.85, clicks: 80, placement: 'top_search' as const },
    ];
    const productPageData = [
      { bid: 1.0, cpc: 0.65, clicks: 80, placement: 'product_page' as const },
      { bid: 1.1, cpc: 0.70, clicks: 70, placement: 'product_page' as const },
      { bid: 0.9, cpc: 0.60, clicks: 60, placement: 'product_page' as const },
    ];
    const topOfSearchEstimate = estimateCPC(topSearchData, 1.2, 'top_search');
    const productPageEstimate = estimateCPC(productPageData, 1.2, 'product_page');
    expect(topOfSearchEstimate.estimatedCpc).toBeGreaterThan(productPageEstimate.estimatedCpc);
  });
});

describe('UCB探索-利用平衡', () => {
  it('应该正确计算UCB得分', () => {
    const ucbScore = calculateUCB(2.0, 1000, 100, 2);
    expect(ucbScore).toBeGreaterThan(2.0);
  });
  
  it('应该对尝试次数少的广告给予更高的探索奖励', () => {
    const lowTrialsUCB = calculateUCB(2.0, 1000, 10, 2);
    const highTrialsUCB = calculateUCB(2.0, 1000, 500, 2);
    expect(lowTrialsUCB).toBeGreaterThan(highTrialsUCB);
  });
});

describe('最小探索预算', () => {
  it('应该正确计算最小探索预算', () => {
    const minBudget = calculateMinExplorationBudget(1000, 10, 0.1);
    expect(minBudget).toBe(10);
  });
  
  it('应该确保最小预算不低于绝对最小值', () => {
    const minBudget = calculateMinExplorationBudget(10, 100, 0.1);
    expect(minBudget).toBeGreaterThanOrEqual(0.01);
  });
});

describe('新关键词识别', () => {
  it('应该正确识别新关键词', () => {
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(isNewKeyword(createdAt, 5, 100)).toBe(true);
  });
  
  it('应该正确识别非新关键词', () => {
    const createdAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect(isNewKeyword(createdAt, 100, 5000)).toBe(false);
  });
});

describe('探索策略', () => {
  it('应该对新关键词给予探索策略', () => {
    const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const strategy = getExplorationStrategy(createdAt, 5, 100, 1.0);
    expect(strategy.strategy).toBe('explore');
    expect(strategy.isNewKeyword).toBe(true);
    expect(strategy.suggestedBid).toBeGreaterThan(1.0);
  });
  
  it('应该对老关键词给予利用策略', () => {
    const createdAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const strategy = getExplorationStrategy(createdAt, 100, 5000, 1.0);
    expect(strategy.strategy).toBe('exploit');
    expect(strategy.isNewKeyword).toBe(false);
    expect(strategy.suggestedBid).toBe(1.0);
  });
});

describe('重新评估判断', () => {
  it('应该识别需要重新评估的广告活动', () => {
    const lastEvaluationDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    expect(needsReEvaluation(lastEvaluationDate, 1.5, 2.0)).toBe(true);
  });
  
  it('应该识别不需要重新评估的广告活动', () => {
    const lastEvaluationDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(needsReEvaluation(lastEvaluationDate, 2.0, 2.0)).toBe(false);
  });
});
