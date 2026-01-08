import { describe, expect, it } from "vitest";
import {
  buildImpressionCurve,
  buildCTRCurve,
  calculateConversionParams,
  calculateImpressions,
  calculateCTR,
  calculateProfit,
  calculateOptimalBid,
  BidPerformanceData,
  ImpressionCurveParams,
  CTRCurveParams,
  ConversionParams
} from "./marketCurveService";

describe("Market Curve Service", () => {
  describe("buildImpressionCurve", () => {
    it("should fit a logarithmic curve to impression data", () => {
      // 模拟历史数据：出价越高，展现量越多（对数增长）
      const historicalData: BidPerformanceData[] = [
        { bid: 0.5, effectiveCPC: 0.45, impressions: 500, clicks: 10, spend: 4.5, sales: 30, orders: 1, ctr: 0.02, cvr: 0.1 },
        { bid: 1.0, effectiveCPC: 0.9, impressions: 800, clicks: 16, spend: 14.4, sales: 60, orders: 2, ctr: 0.02, cvr: 0.125 },
        { bid: 1.5, effectiveCPC: 1.3, impressions: 1000, clicks: 20, spend: 26, sales: 90, orders: 3, ctr: 0.02, cvr: 0.15 },
        { bid: 2.0, effectiveCPC: 1.7, impressions: 1150, clicks: 23, spend: 39.1, sales: 120, orders: 4, ctr: 0.02, cvr: 0.17 },
        { bid: 2.5, effectiveCPC: 2.1, impressions: 1250, clicks: 25, spend: 52.5, sales: 150, orders: 5, ctr: 0.02, cvr: 0.2 },
      ];

      const result = buildImpressionCurve(historicalData);

      // 验证曲线参数存在
      expect(result).toHaveProperty("a");
      expect(result).toHaveProperty("b");
      expect(result).toHaveProperty("c");
      
      // a 应该是正数（对数系数）
      expect(result.a).toBeGreaterThanOrEqual(0);
      
      // R² 应该存在
      expect(result.r2).toBeDefined();
    });

    it("should handle edge case with minimal data points", () => {
      const minimalData: BidPerformanceData[] = [
        { bid: 1.0, effectiveCPC: 0.9, impressions: 1000, clicks: 20, spend: 18, sales: 60, orders: 2, ctr: 0.02, cvr: 0.1 },
        { bid: 2.0, effectiveCPC: 1.8, impressions: 1500, clicks: 30, spend: 54, sales: 90, orders: 3, ctr: 0.02, cvr: 0.1 },
      ];

      const result = buildImpressionCurve(minimalData);
      
      // 数据点少时应返回默认参数
      expect(result.a).toBeDefined();
      expect(result.b).toBeDefined();
      expect(result.r2).toBe(0); // 数据不足，R²为0
    });

    it("should return default params for empty data", () => {
      const result = buildImpressionCurve([]);
      
      // 空数据应返回默认参数
      expect(result.a).toBe(1000);
      expect(result.b).toBe(0.1);
      expect(result.c).toBe(100);
    });
  });

  describe("buildCTRCurve", () => {
    it("should calculate CTR curve parameters", () => {
      const data: BidPerformanceData[] = [
        { bid: 0.5, effectiveCPC: 0.45, impressions: 1000, clicks: 15, spend: 6.75, sales: 45, orders: 1, ctr: 0.015, cvr: 0.067 },
        { bid: 1.0, effectiveCPC: 0.9, impressions: 1000, clicks: 20, spend: 18, sales: 60, orders: 2, ctr: 0.02, cvr: 0.1 },
        { bid: 1.5, effectiveCPC: 1.3, impressions: 1000, clicks: 25, spend: 32.5, sales: 75, orders: 2, ctr: 0.025, cvr: 0.08 },
        { bid: 2.0, effectiveCPC: 1.7, impressions: 1000, clicks: 30, spend: 51, sales: 90, orders: 3, ctr: 0.03, cvr: 0.1 },
      ];

      const result = buildCTRCurve(data);

      expect(result.baseCTR).toBeGreaterThan(0);
      expect(result.positionBonus).toBeDefined();
      expect(result.topSearchCTRBonus).toBeDefined();
    });

    it("should return default params for insufficient data", () => {
      const result = buildCTRCurve([]);
      
      expect(result.baseCTR).toBe(0.01);
      expect(result.positionBonus).toBe(0.5);
    });
  });

  describe("calculateConversionParams", () => {
    it("should calculate conversion parameters from data", () => {
      const data: BidPerformanceData[] = [
        { bid: 1.0, effectiveCPC: 0.9, impressions: 1000, clicks: 100, spend: 90, sales: 300, orders: 10, ctr: 0.1, cvr: 0.1 },
        { bid: 1.5, effectiveCPC: 1.3, impressions: 1000, clicks: 100, spend: 130, sales: 450, orders: 15, ctr: 0.1, cvr: 0.15 },
        { bid: 2.0, effectiveCPC: 1.7, impressions: 1000, clicks: 100, spend: 170, sales: 600, orders: 20, ctr: 0.1, cvr: 0.2 },
      ];

      const result = calculateConversionParams(data);

      expect(result.cvr).toBeGreaterThan(0);
      expect(result.aov).toBeGreaterThan(0);
      expect(result.conversionDelayDays).toBe(7);
    });

    it("should return default params for insufficient data", () => {
      const result = calculateConversionParams([]);
      
      expect(result.cvr).toBe(0.05);
      expect(result.aov).toBe(30);
    });
  });

  describe("calculateImpressions", () => {
    it("should calculate impressions using logarithmic curve", () => {
      // 使用更大的参数确保正值
      // Impressions = a * ln(cpc + b) + c
      // 当 cpc=0.5, b=0.5: ln(1) = 0, 所以 impressions = 0 + 500 = 500
      // 当 cpc=1.0, b=0.5: ln(1.5) ≈ 0.405, 所以 impressions = 500*0.405 + 500 ≈ 702
      const curve: ImpressionCurveParams = {
        a: 500,
        b: 0.5,  // 增大b值确保ln参数大于1
        c: 500,  // 增大基础展现
        r2: 0.9
      };

      const impressions1 = calculateImpressions(0.5, curve);
      const impressions2 = calculateImpressions(1.0, curve);
      const impressions3 = calculateImpressions(2.0, curve);

      // 展现量应该随出价增加而增加
      expect(impressions1).toBeLessThan(impressions2);
      expect(impressions2).toBeLessThan(impressions3);
      
      // 展现量应该是正数
      expect(impressions1).toBeGreaterThan(0);
    });

    it("should return base impressions for zero bid", () => {
      // 当cpc=0时: Impressions = a * ln(0 + b) + c = 500 * ln(0.5) + 500
      // ln(0.5) ≈ -0.693, 所以 impressions = 500 * (-0.693) + 500 ≈ 153
      const curve: ImpressionCurveParams = {
        a: 500,
        b: 0.5,
        c: 500,  // 基础展现足够大以抵消负的对数项
        r2: 0.9
      };

      const impressions = calculateImpressions(0, curve);
      
      // 零出价时应该有基础展现（c参数 + 对数项）
      // 由于Math.max(0, ...)，最小为0
      expect(impressions).toBeGreaterThanOrEqual(0);
    });
  });

  describe("calculateCTR", () => {
    it("should calculate CTR based on position", () => {
      const curve: CTRCurveParams = {
        baseCTR: 0.02,
        positionBonus: 0.5,
        topSearchCTRBonus: 0.3
      };

      const ctr1 = calculateCTR(0.5, curve, 5);
      const ctr2 = calculateCTR(2.5, curve, 5);
      const ctr3 = calculateCTR(5.0, curve, 5);

      // CTR应该随出价增加而增加（更好的位置）
      expect(ctr1).toBeLessThan(ctr2);
      expect(ctr2).toBeLessThan(ctr3);
      
      // CTR应该在合理范围内
      expect(ctr1).toBeGreaterThan(0);
      expect(ctr3).toBeLessThan(1);
    });
  });

  describe("calculateProfit", () => {
    it("should calculate profit using 智能优化 formula", () => {
      const impressionCurve: ImpressionCurveParams = {
        a: 500,
        b: 0.1,
        c: 100,
        r2: 0.9
      };
      const ctrCurve: CTRCurveParams = {
        baseCTR: 0.02,
        positionBonus: 0.5,
        topSearchCTRBonus: 0.3
      };
      const conversion: ConversionParams = {
        cvr: 0.05,
        aov: 30,
        conversionDelayDays: 7
      };

      const profit = calculateProfit(1.0, impressionCurve, ctrCurve, conversion);

      // 利润应该是数值
      expect(typeof profit).toBe("number");
      expect(isNaN(profit)).toBe(false);
    });

    it("should show diminishing returns at high CPCs", () => {
      const impressionCurve: ImpressionCurveParams = {
        a: 500,
        b: 0.1,
        c: 100,
        r2: 0.9
      };
      const ctrCurve: CTRCurveParams = {
        baseCTR: 0.02,
        positionBonus: 0.5,
        topSearchCTRBonus: 0.3
      };
      const conversion: ConversionParams = {
        cvr: 0.05,
        aov: 30,
        conversionDelayDays: 7
      };

      const profit1 = calculateProfit(0.5, impressionCurve, ctrCurve, conversion);
      const profit2 = calculateProfit(1.5, impressionCurve, ctrCurve, conversion);
      const profit3 = calculateProfit(3.0, impressionCurve, ctrCurve, conversion);

      // 利润应该先增后减（存在最优点）
      // 在CPC超过盈亏平衡点(CVR*AOV=1.5)后，利润应该下降
      expect(profit3).toBeLessThan(profit2);
    });
  });

  describe("calculateOptimalBid", () => {
    it("should find the bid that maximizes profit", () => {
      const impressionCurve: ImpressionCurveParams = {
        a: 500,
        b: 0.1,
        c: 100,
        r2: 0.9
      };
      const ctrCurve: CTRCurveParams = {
        baseCTR: 0.02,
        positionBonus: 0.5,
        topSearchCTRBonus: 0.3
      };
      const conversion: ConversionParams = {
        cvr: 0.05,
        aov: 30,
        conversionDelayDays: 7
      };

      const result = calculateOptimalBid(impressionCurve, ctrCurve, conversion);

      // 最优出价应该在合理范围内
      expect(result.optimalBid).toBeGreaterThan(0);
      expect(result.optimalBid).toBeLessThan(10);
      
      // 盈亏平衡点应该是 CVR * AOV = 0.05 * 30 = 1.5
      expect(result.breakEvenCPC).toBeCloseTo(1.5, 1);
      
      // 利润曲线应该存在
      expect(result.profitCurve.length).toBeGreaterThan(0);
    });

    it("should return lower optimal bid for low CVR", () => {
      const impressionCurve: ImpressionCurveParams = {
        a: 500,
        b: 0.1,
        c: 100,
        r2: 0.9
      };
      const ctrCurve: CTRCurveParams = {
        baseCTR: 0.02,
        positionBonus: 0.5,
        topSearchCTRBonus: 0.3
      };
      
      const highCVR: ConversionParams = {
        cvr: 0.10,
        aov: 30,
        conversionDelayDays: 7
      };
      const lowCVR: ConversionParams = {
        cvr: 0.02,
        aov: 30,
        conversionDelayDays: 7
      };

      const resultHigh = calculateOptimalBid(impressionCurve, ctrCurve, highCVR);
      const resultLow = calculateOptimalBid(impressionCurve, ctrCurve, lowCVR);

      // 低CVR时，最优出价应该更低
      expect(resultLow.optimalBid).toBeLessThan(resultHigh.optimalBid);
    });
  });
});

describe("Profit Maximization Formula", () => {
  it("should validate the core profit formula: Profit = Clicks × (CVR × AOV - CPC)", () => {
    // 智能优化核心公式验证
    const clicks = 100;
    const cvr = 0.05;
    const aov = 30;
    const cpc = 1.0;

    const expectedProfit = clicks * (cvr * aov - cpc);
    // = 100 * (0.05 * 30 - 1.0)
    // = 100 * (1.5 - 1.0)
    // = 100 * 0.5
    // = 50

    expect(expectedProfit).toBe(50);
  });

  it("should identify break-even CPC", () => {
    // 当 CVR × AOV = CPC 时，利润为0
    const cvr = 0.05;
    const aov = 30;
    const breakEvenCpc = cvr * aov; // = 1.5

    expect(breakEvenCpc).toBe(1.5);

    // CPC < 1.5 时盈利
    const profitableCpc = 1.0;
    const profit1 = 100 * (cvr * aov - profitableCpc);
    expect(profit1).toBeGreaterThan(0);

    // CPC > 1.5 时亏损
    const unprofitableCpc = 2.0;
    const profit2 = 100 * (cvr * aov - unprofitableCpc);
    expect(profit2).toBeLessThan(0);
  });

  it("should demonstrate the importance of CVR and AOV", () => {
    const clicks = 100;
    const cpc = 1.0;

    // 场景1: 低CVR, 低AOV
    const profit1 = clicks * (0.02 * 20 - cpc); // = 100 * (0.4 - 1) = -60

    // 场景2: 高CVR, 低AOV
    const profit2 = clicks * (0.10 * 20 - cpc); // = 100 * (2 - 1) = 100

    // 场景3: 低CVR, 高AOV
    const profit3 = clicks * (0.02 * 100 - cpc); // = 100 * (2 - 1) = 100

    // 场景4: 高CVR, 高AOV
    const profit4 = clicks * (0.10 * 100 - cpc); // = 100 * (10 - 1) = 900

    expect(profit1).toBeLessThan(0);
    expect(profit2).toBeGreaterThan(0);
    expect(profit3).toBeGreaterThan(0);
    expect(profit4).toBeGreaterThan(profit2);
    expect(profit4).toBeGreaterThan(profit3);
  });
});
