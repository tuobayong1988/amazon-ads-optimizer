/**
 * 利润最大化出价点计算测试
 */

import { describe, it, expect } from 'vitest';
import {
  calculateOptimalBid,
  calculateProfit,
  calculateImpressions,
  calculateCTR,
  calculateConversionParams,
} from './marketCurveService';

describe('利润最大化出价点计算', () => {
  describe('calculateOptimalBid - 计算最优出价点', () => {
    it('应该返回有效的最优出价点', () => {
      const impressionCurve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const ctrCurve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const conversion = { cvr: 0.05, aov: 30, conversionDelayDays: 7 };

      const result = calculateOptimalBid(impressionCurve, ctrCurve, conversion);

      expect(result.optimalBid).toBeGreaterThan(0);
      expect(result.optimalBid).toBeLessThan(10);
      expect(result.maxProfit).toBeDefined();
      expect(result.breakEvenCpc).toBeCloseTo(1.5, 1); // CVR * AOV = 0.05 * 30 = 1.5
    });

    it('最优出价应该小于盈亏平衡点', () => {
      const impressionCurve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const ctrCurve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const conversion = { cvr: 0.08, aov: 25, conversionDelayDays: 7 };

      const result = calculateOptimalBid(impressionCurve, ctrCurve, conversion);
      const breakEven = conversion.cvr * conversion.aov;

      expect(result.optimalBid).toBeLessThanOrEqual(breakEven);
    });

    it('应该生成利润曲线数据点', () => {
      const impressionCurve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const ctrCurve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const conversion = { cvr: 0.05, aov: 30, conversionDelayDays: 7 };

      const result = calculateOptimalBid(impressionCurve, ctrCurve, conversion);

      expect(result.profitCurve).toBeDefined();
      expect(result.profitCurve.length).toBeGreaterThan(0);
      expect(result.profitCurve[0]).toHaveProperty('cpc');
      expect(result.profitCurve[0]).toHaveProperty('profit');
    });

    it('利润率应该在0到1之间', () => {
      const impressionCurve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const ctrCurve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const conversion = { cvr: 0.05, aov: 30, conversionDelayDays: 7 };

      const result = calculateOptimalBid(impressionCurve, ctrCurve, conversion);

      expect(result.profitMargin).toBeGreaterThanOrEqual(0);
      expect(result.profitMargin).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateProfit - 利润计算公式', () => {
    it('应该正确计算利润 (Profit = Clicks × (CVR × AOV - CPC))', () => {
      const impressionCurve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const ctrCurve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const conversion = { cvr: 0.05, aov: 30, conversionDelayDays: 7 };
      const cpc = 1.0;

      const profit = calculateProfit(cpc, impressionCurve, ctrCurve, conversion);

      // 利润应该是正数（因为 CVR * AOV = 1.5 > CPC = 1.0）
      expect(profit).toBeGreaterThan(0);
    });

    it('当CPC等于盈亏平衡点时利润应该接近0', () => {
      const impressionCurve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const ctrCurve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const conversion = { cvr: 0.05, aov: 30, conversionDelayDays: 7 };
      const breakEvenCpc = conversion.cvr * conversion.aov; // 1.5

      const profit = calculateProfit(breakEvenCpc, impressionCurve, ctrCurve, conversion);

      // 在盈亏平衡点，利润应该接近0
      expect(Math.abs(profit)).toBeLessThan(1);
    });

    it('当CPC高于盈亏平衡点时利润应该为负', () => {
      const impressionCurve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const ctrCurve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const conversion = { cvr: 0.05, aov: 30, conversionDelayDays: 7 };
      const highCPC = 2.0; // 高于盈亏平衡点 1.5

      const profit = calculateProfit(highCPC, impressionCurve, ctrCurve, conversion);

      expect(profit).toBeLessThan(0);
    });
  });

  describe('calculateImpressions - 展现量计算', () => {
    it('应该返回正数展现量', () => {
      const curve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const impressions = calculateImpressions(1.0, curve);

      expect(impressions).toBeGreaterThan(0);
    });

    it('CPC越高展现量应该越多', () => {
      const curve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const lowCPCImpressions = calculateImpressions(0.5, curve);
      const highCPCImpressions = calculateImpressions(2.0, curve);

      expect(highCPCImpressions).toBeGreaterThan(lowCPCImpressions);
    });
  });

  describe('calculateCTR - 点击率计算', () => {
    it('应该返回有效的CTR值', () => {
      const curve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const ctr = calculateCTR(1.0, curve);

      expect(ctr).toBeGreaterThan(0);
      expect(ctr).toBeLessThan(1);
    });

    it('CPC越高CTR应该越高（位置越好）', () => {
      const curve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const lowCPCCTR = calculateCTR(0.5, curve);
      const highCPCCTR = calculateCTR(2.0, curve);

      expect(highCPCCTR).toBeGreaterThan(lowCPCCTR);
    });
  });

  

  describe('calculateConversionParams - 转化参数计算', () => {
    it('应该计算出有效的转化参数', () => {
      const dataPoints = [
        { bid: 0.5, effectiveCpc: 0.4, impressions: 800, clicks: 100, spend: 40, sales: 150, orders: 5, ctr: 0.125, cvr: 0.05 },
        { bid: 1.0, effectiveCpc: 0.8, impressions: 1200, clicks: 150, spend: 120, sales: 250, orders: 8, ctr: 0.125, cvr: 0.053 },
      ];

      const params = calculateConversionParams(dataPoints);

      expect(params.cvr).toBeGreaterThan(0);
      expect(params.cvr).toBeLessThan(1);
      expect(params.aov).toBeGreaterThan(0);
    });

    it('数据点不足时应该返回默认参数', () => {
      const dataPoints = [
        { bid: 0.5, effectiveCpc: 0.4, impressions: 800, clicks: 0, spend: 0, sales: 0, orders: 0, ctr: 0, cvr: 0 },
      ];

      const params = calculateConversionParams(dataPoints);

      expect(params.cvr).toBe(0.05);
      expect(params.aov).toBe(30);
    });
  });

  describe('出价建议逻辑', () => {
    it('当前出价低于最优出价时应该建议提高', () => {
      const impressionCurve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const ctrCurve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const conversion = { cvr: 0.05, aov: 30, conversionDelayDays: 7 };

      const result = calculateOptimalBid(impressionCurve, ctrCurve, conversion);
      const currentBid = 0.3; // 假设当前出价很低

      const recommendation = result.optimalBid > currentBid ? 'increase' : 
                            result.optimalBid < currentBid ? 'decrease' : 'maintain';

      expect(recommendation).toBe('increase');
    });

    it('当前出价高于最优出价时应该建议降低', () => {
      const impressionCurve = { a: 1000, b: 0.5, c: 500, r2: 0.85 };
      const ctrCurve = { baseCtr: 0.02, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const conversion = { cvr: 0.05, aov: 30, conversionDelayDays: 7 };

      const result = calculateOptimalBid(impressionCurve, ctrCurve, conversion);
      const currentBid = result.optimalBid + 0.5; // 假设当前出价高于最优

      const recommendation = result.optimalBid > currentBid ? 'increase' : 
                            result.optimalBid < currentBid ? 'decrease' : 'maintain';

      expect(recommendation).toBe('decrease');
    });
  });
});
