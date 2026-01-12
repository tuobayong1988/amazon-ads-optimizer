/**
 * 位置竞价协同策略测试
 * 测试防止双重加价螺旋的实现
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeBaseBid,
  calculateCoordinatedAdjustment,
  checkEffectiveCpcSafety,
} from './placementOptimizationServiceV2';

describe('竞价归一化', () => {
  it('应正确计算归一化出价', () => {
    // 实际CPC $1.5，位置溢价50%
    const result = normalizeBaseBid(1.5, 50);
    
    expect(result.normalizedBid).toBe(1.0);
    expect(result.effectiveBid).toBe(1.5);
    expect(result.placementMultiplier).toBe(1.5);
  });

  it('无位置溢价时归一化出价等于实际CPC', () => {
    const result = normalizeBaseBid(1.0, 0);
    
    expect(result.normalizedBid).toBe(1.0);
    expect(result.placementMultiplier).toBe(1);
  });

  it('应正确处理高位置溢价', () => {
    // 实际CPC $3，位置溢价200%
    const result = normalizeBaseBid(3.0, 200);
    
    expect(result.normalizedBid).toBe(1.0);
    expect(result.placementMultiplier).toBe(3);
  });
});

describe('协同调整计算', () => {
  it('位置溢价增加超过目标时应建议降低基础出价', () => {
    const result = calculateCoordinatedAdjustment(
      1.0, // 当前基础出价
      { topOfSearch: 50, productPage: 20, restOfSearch: 0 }, // 当前位置调整
      { topOfSearch: 100, productPage: 30, restOfSearch: 0 }, // 建议位置调整
      30 // 目标最大CPC增幅30%
    );
    
    // 位置溢价从50%增加到100%，CPC增幅约33%，超过目标30%
    expect(result.baseBidAdjustment).toBeLessThan(0);
    expect(result.warning).toBeDefined();
  });

  it('位置溢价变化在目标范围内时不调整基础出价', () => {
    const result = calculateCoordinatedAdjustment(
      1.0,
      { topOfSearch: 50, productPage: 20, restOfSearch: 0 },
      { topOfSearch: 60, productPage: 25, restOfSearch: 0 },
      30
    );
    
    // 位置溢价从50%增加到60%，CPC增幅约6.7%，在目标范围内
    expect(result.baseBidAdjustment).toBe(0);
    expect(result.warning).toBeUndefined();
  });

  it('应正确计算总有效CPC变化', () => {
    const result = calculateCoordinatedAdjustment(
      1.0,
      { topOfSearch: 0, productPage: 0, restOfSearch: 0 },
      { topOfSearch: 50, productPage: 0, restOfSearch: 0 },
      30
    );
    
    // 位置溢价从0%增加到50%，CPC增幅50%，超过目标
    // 系统应该建议降低基础出价以控制总CPC
    expect(result.totalEffectiveCpcChange).toBeLessThanOrEqual(30);
  });
});

describe('有效CPC安全检查', () => {
  it('固定竞价策略下CPC在安全范围内', () => {
    const result = checkEffectiveCpcSafety(1.0, 50, 'fixed', 10);
    
    // 有效CPC = 1.0 * 1.5 = $1.5，安全
    expect(result.isSafe).toBe(true);
    expect(result.effectiveCpc).toBe(1.5);
    expect(result.maxPossibleCpc).toBe(1.5);
  });

  it('动态竞价策略下应考虑最大可能CPC', () => {
    const result = checkEffectiveCpcSafety(3.0, 100, 'up_and_down', 10);
    
    // 有效CPC = 3.0 * 2 = $6
    // 最大可能CPC = $6 * 2 = $12（动态竞价可能翻倍）
    expect(result.isSafe).toBe(false);
    expect(result.maxPossibleCpc).toBe(12);
    expect(result.warning).toBeDefined();
  });

  it('仅降低策略下最大CPC等于有效CPC', () => {
    const result = checkEffectiveCpcSafety(3.0, 100, 'down_only', 10);
    
    // 有效CPC = 3.0 * 2 = $6
    // 最大可能CPC = $6（仅降低不会增加）
    expect(result.isSafe).toBe(true);
    expect(result.maxPossibleCpc).toBe(6);
  });
});
