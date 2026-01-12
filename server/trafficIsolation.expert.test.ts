/**
 * 软隔离策略测试
 * 测试流量隔离的软策略实现
 */

import { describe, it, expect } from 'vitest';
import {
  isExactGroupStable,
  calculateSoftIsolationBid,
  TRAFFIC_ISOLATION_CONFIG,
} from './trafficIsolationService';

describe('软隔离策略配置', () => {
  it('默认不建议添加否定词', () => {
    expect(TRAFFIC_ISOLATION_CONFIG.softIsolation.suggestAddNegative).toBe(false);
  });

  it('Exact组出价倍数为1.5', () => {
    expect(TRAFFIC_ISOLATION_CONFIG.softIsolation.exactToBroadBidMultiplier).toBe(1.5);
  });

  it('Exact组稳定阈值为50点击', () => {
    expect(TRAFFIC_ISOLATION_CONFIG.softIsolation.exactGroupStabilityThreshold).toBe(50);
  });

  it('Exact组稳定最小转化数为5', () => {
    expect(TRAFFIC_ISOLATION_CONFIG.softIsolation.exactGroupMinConversions).toBe(5);
  });
});

describe('Exact组流量稳定性评估', () => {
  it('点击和转化都达标时返回稳定', () => {
    const result = isExactGroupStable(60, 8);
    expect(result).toBe(true);
  });

  it('点击不足时返回不稳定', () => {
    const result = isExactGroupStable(30, 8);
    expect(result).toBe(false);
  });

  it('转化不足时返回不稳定', () => {
    const result = isExactGroupStable(60, 2);
    expect(result).toBe(false);
  });

  it('点击和转化都不足时返回不稳定', () => {
    const result = isExactGroupStable(20, 1);
    expect(result).toBe(false);
  });

  it('刚好达到阈值时返回稳定', () => {
    const result = isExactGroupStable(50, 5);
    expect(result).toBe(true);
  });
});

describe('软隔离出价计算', () => {
  it('Exact组出价应为Broad组的1.5倍', () => {
    const broadBid = 1.0;
    const exactBid = calculateSoftIsolationBid(broadBid);
    expect(exactBid).toBe(1.5);
  });

  it('应正确处理小数', () => {
    const broadBid = 0.75;
    const exactBid = calculateSoftIsolationBid(broadBid);
    expect(exactBid).toBe(1.13); // 0.75 * 1.5 = 1.125, 四舍五入到1.13
  });

  it('应正确处理较大数值', () => {
    const broadBid = 5.0;
    const exactBid = calculateSoftIsolationBid(broadBid);
    expect(exactBid).toBe(7.5);
  });
});
