/**
 * v271 P0-1: abTestService 核心模块单元测试
 * 覆盖: 统计显著性计算、样本量计算、广告活动分组、胜者判定
 */
import { describe, it, expect } from 'vitest';
import {
  calculateSampleSize,
  calculateStatisticalSignificanceExported,
  normalCDF,
  splitCampaignsIntoGroups,
  determineWinner,
} from '../analytics/abTestService';

// ==================== 1. 正态分布CDF ====================

describe('ABTestService - normalCDF', () => {
  it('should return 0.5 for z=0', () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 3);
  });

  it('should return ~0.8413 for z=1', () => {
    expect(normalCDF(1)).toBeCloseTo(0.8413, 2);
  });

  it('should return ~0.1587 for z=-1', () => {
    expect(normalCDF(-1)).toBeCloseTo(0.1587, 2);
  });

  it('should return ~0.9772 for z=2', () => {
    expect(normalCDF(2)).toBeCloseTo(0.9772, 2);
  });

  it('should return values between 0 and 1', () => {
    for (let z = -5; z <= 5; z += 0.5) {
      const result = normalCDF(z);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});

// ==================== 2. 统计显著性计算 (实际签名) ====================

describe('ABTestService - calculateStatisticalSignificance', () => {
  it('should detect significance when conversion rates differ significantly', () => {
    const result = calculateStatisticalSignificanceExported(
      { conversions: 100, impressions: 10000, clicks: 500, spend: 1000, revenue: 4000 },
      { conversions: 150, impressions: 10000, clicks: 500, spend: 1000, revenue: 6000 },
      'conversions',
    );
    // CVR: 100/500=0.20 vs 150/500=0.30 - significant difference
    expect(result.isSignificant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it('should NOT detect significance when conversion rates are similar', () => {
    const result = calculateStatisticalSignificanceExported(
      { conversions: 50, impressions: 10000, clicks: 500, spend: 1000, revenue: 4000 },
      { conversions: 52, impressions: 10000, clicks: 500, spend: 1000, revenue: 4100 },
      'conversions',
    );
    // CVR: 50/500=0.10 vs 52/500=0.104 - very small difference
    expect(result.isSignificant).toBe(false);
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it('should calculate ROAS significance correctly', () => {
    const result = calculateStatisticalSignificanceExported(
      { conversions: 50, impressions: 10000, clicks: 500, spend: 1000, revenue: 4000 },
      { conversions: 70, impressions: 10000, clicks: 500, spend: 1000, revenue: 7000 },
      'roas',
    );
    // ROAS: 4000/1000=4.0 vs 7000/1000=7.0
    expect(result.pValue).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });

  it('should return confidence interval as tuple', () => {
    const result = calculateStatisticalSignificanceExported(
      { conversions: 100, impressions: 10000, clicks: 1000, spend: 1000, revenue: 4000 },
      { conversions: 120, impressions: 10000, clicks: 1000, spend: 1000, revenue: 5000 },
      'conversions',
    );
    expect(result.confidenceInterval).toHaveLength(2);
    expect(result.confidenceInterval[0]).toBeLessThan(result.confidenceInterval[1]);
  });
});

// ==================== 3. 样本量计算 (实际签名) ====================
// calculateSampleSize(baselineRate, mde, alpha?, power?)

describe('ABTestService - calculateSampleSize', () => {
  it('should return reasonable sample size for typical parameters', () => {
    const sampleSize = calculateSampleSize(0.10, 0.20); // 10% baseline, 20% MDE
    expect(sampleSize).toBeGreaterThan(0);
    expect(sampleSize).toBeLessThan(100000);
  });

  it('should require larger sample for smaller MDE', () => {
    const largeSample = calculateSampleSize(0.10, 0.05); // 5% MDE
    const smallSample = calculateSampleSize(0.10, 0.50); // 50% MDE
    expect(largeSample).toBeGreaterThan(smallSample);
  });

  it('should return positive integer', () => {
    const sampleSize = calculateSampleSize(0.15, 0.10);
    expect(sampleSize).toBeGreaterThan(0);
    expect(Number.isInteger(sampleSize)).toBe(true);
  });

  it('should handle edge case of very small baseline rate', () => {
    const sampleSize = calculateSampleSize(0.01, 0.50);
    expect(sampleSize).toBeGreaterThan(0);
  });
});

// ==================== 4. 广告活动分组 ====================

describe('ABTestService - splitCampaignsIntoGroups', () => {
  it('should split campaigns into control and treatment groups (stratified)', () => {
    const campaigns = [
      { id: 1, spend: 100 },
      { id: 2, spend: 200 },
      { id: 3, spend: 150 },
      { id: 4, spend: 250 },
    ];
    const result = splitCampaignsIntoGroups(campaigns, 0.5, 'stratified');
    expect(result.control.length + result.treatment.length).toBe(4);
    expect(result.control.length).toBeGreaterThan(0);
    expect(result.treatment.length).toBeGreaterThan(0);
  });

  it('should split campaigns randomly', () => {
    const campaigns = [
      { id: 1, spend: 100 },
      { id: 2, spend: 200 },
      { id: 3, spend: 150 },
      { id: 4, spend: 250 },
    ];
    const result = splitCampaignsIntoGroups(campaigns, 0.5, 'random');
    expect(result.control.length + result.treatment.length).toBe(4);
  });

  it('should handle odd number of campaigns', () => {
    const campaigns = [
      { id: 1, spend: 100 },
      { id: 2, spend: 200 },
      { id: 3, spend: 150 },
    ];
    const result = splitCampaignsIntoGroups(campaigns, 0.5, 'stratified');
    expect(result.control.length + result.treatment.length).toBe(3);
  });

  it('should balance spend between groups with stratified method', () => {
    const campaigns = [
      { id: 1, spend: 1000 },
      { id: 2, spend: 900 },
      { id: 3, spend: 100 },
      { id: 4, spend: 50 },
    ];
    const result = splitCampaignsIntoGroups(campaigns, 0.5, 'stratified');
    const controlSpend = result.control.reduce((s: unknown, c: unknown) => s + c.spend, 0);
    const treatmentSpend = result.treatment.reduce((s: unknown, c: unknown) => s + c.spend, 0);
    const totalSpend = controlSpend + treatmentSpend;
    expect(Math.abs(controlSpend - treatmentSpend)).toBeLessThanOrEqual(totalSpend * 0.6);
  });

  it('should handle single campaign', () => {
    const campaigns = [{ id: 1, spend: 50 }];
    const result = splitCampaignsIntoGroups(campaigns, 0.5, 'stratified');
    expect(result.control.length + result.treatment.length).toBe(1);
  });

  it('should handle empty campaigns array', () => {
    const result = splitCampaignsIntoGroups([], 0.5, 'stratified');
    expect(result.control.length).toBe(0);
    expect(result.treatment.length).toBe(0);
  });

  it('should respect traffic split ratio', () => {
    const campaigns = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, spend: 100 }));
    const result = splitCampaignsIntoGroups(campaigns, 0.3, 'stratified');
    expect(result.treatment.length).toBeGreaterThanOrEqual(3);
    expect(result.treatment.length).toBeLessThanOrEqual(12);
  });
});

// ==================== 5. 胜者判定 ====================

describe('ABTestService - determineWinner', () => {
  it('should determine treatment as winner when it has significantly better metrics', () => {
    const metrics = [
      { metricName: 'roas', controlValue: 4.0, treatmentValue: 5.5, pValue: 0.01, isSignificant: true },
      { metricName: 'acos', controlValue: 25, treatmentValue: 18, pValue: 0.02, isSignificant: true },
    ];
    const result = determineWinner(metrics, 'roas');
    expect(result).toBe('treatment');
  });

  it('should determine control as winner when treatment is worse', () => {
    const metrics = [
      { metricName: 'roas', controlValue: 5.0, treatmentValue: 3.0, pValue: 0.01, isSignificant: true },
    ];
    const result = determineWinner(metrics, 'roas');
    expect(result).toBe('control');
  });

  it('should return inconclusive when not statistically significant', () => {
    const metrics = [
      { metricName: 'roas', controlValue: 4.0, treatmentValue: 4.2, pValue: 0.15, isSignificant: false },
    ];
    const result = determineWinner(metrics, 'roas');
    expect(result).toBe('inconclusive');
  });

  it('should return inconclusive when target metric not found', () => {
    const metrics = [
      { metricName: 'acos', controlValue: 25, treatmentValue: 20, pValue: 0.01, isSignificant: true },
    ];
    const result = determineWinner(metrics, 'roas');
    expect(result).toBe('inconclusive');
  });

  it('should return inconclusive for empty metrics array', () => {
    const result = determineWinner([], 'roas');
    expect(result).toBe('inconclusive');
  });
});
