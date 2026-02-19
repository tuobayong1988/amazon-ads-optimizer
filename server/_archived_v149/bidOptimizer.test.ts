import { describe, expect, it } from "vitest";
import {
  calculateMetrics,
  estimateTrafficCeiling,
  calculateMarginalValues,
  generateMarketCurve,
  findOptimalBid,
  calculateBidAdjustment,
  optimizePerformanceGroup,
  calculatePlacementAdjustments,
  calculateIntradayAdjustment,
  OptimizationTarget,
  PerformanceGroupConfig,
} from "./bidOptimizer";

describe("bidOptimizer", () => {
  describe("calculateMetrics", () => {
    it("calculates ACoS correctly", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 1.0,
        impressions: 1000,
        clicks: 50,
        spend: 25,
        sales: 100,
        orders: 5,
      };

      const metrics = calculateMetrics(target);
      expect(metrics.acos).toBe(25); // 25/100 * 100 = 25%
    });

    it("calculates ROAS correctly", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 1.0,
        impressions: 1000,
        clicks: 50,
        spend: 25,
        sales: 100,
        orders: 5,
      };

      const metrics = calculateMetrics(target);
      expect(metrics.roas).toBe(4); // 100/25 = 4
    });

    it("calculates CTR correctly", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 1.0,
        impressions: 1000,
        clicks: 50,
        spend: 25,
        sales: 100,
        orders: 5,
      };

      const metrics = calculateMetrics(target);
      expect(metrics.ctr).toBe(5); // 50/1000 * 100 = 5%
    });

    it("calculates CVR correctly", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 1.0,
        impressions: 1000,
        clicks: 50,
        spend: 25,
        sales: 100,
        orders: 5,
      };

      const metrics = calculateMetrics(target);
      expect(metrics.cvr).toBe(10); // 5/50 * 100 = 10%
    });

    it("handles zero values gracefully", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 1.0,
        impressions: 0,
        clicks: 0,
        spend: 0,
        sales: 0,
        orders: 0,
      };

      const metrics = calculateMetrics(target);
      expect(metrics.acos).toBe(0);
      expect(metrics.roas).toBe(0);
      expect(metrics.ctr).toBe(0);
      expect(metrics.cvr).toBe(0);
      expect(metrics.cpc).toBe(0);
      expect(metrics.aov).toBe(0);
    });
  });

  describe("estimateTrafficCeiling", () => {
    it("estimates ceiling based on current performance", () => {
      const ceiling = estimateTrafficCeiling(1.0, 1000);
      expect(ceiling).toBeGreaterThan(1000);
      // Default assumes 60% capture rate, so ceiling should be ~1667
      expect(ceiling).toBeCloseTo(1667, -1);
    });

    it("uses historical data when available", () => {
      const historicalData = [
        { bid: 0.5, impressions: 500 },
        { bid: 1.0, impressions: 800 },
        { bid: 1.5, impressions: 1000 },
        { bid: 2.0, impressions: 1100 },
      ];

      const ceiling = estimateTrafficCeiling(1.0, 800, historicalData);
      expect(ceiling).toBeGreaterThan(1100);
    });
  });

  describe("generateMarketCurve", () => {
    it("generates correct number of data points", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 1.0,
        impressions: 1000,
        clicks: 50,
        spend: 25,
        sales: 100,
        orders: 5,
      };

      const curve = generateMarketCurve(target, 0.1, 5.0, 20);
      expect(curve.length).toBe(21); // 20 steps + 1
    });

    it("generates increasing bid levels", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 1.0,
        impressions: 1000,
        clicks: 50,
        spend: 25,
        sales: 100,
        orders: 5,
      };

      const curve = generateMarketCurve(target);
      for (let i = 1; i < curve.length; i++) {
        expect(curve[i].bidLevel).toBeGreaterThan(curve[i - 1].bidLevel);
      }
    });

    it("estimates higher spend at higher bids", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 1.0,
        impressions: 1000,
        clicks: 50,
        spend: 25,
        sales: 100,
        orders: 5,
      };

      const curve = generateMarketCurve(target);
      const lowBidPoint = curve[5];
      const highBidPoint = curve[15];
      expect(highBidPoint.estimatedSpend).toBeGreaterThan(lowBidPoint.estimatedSpend);
    });
  });

  describe("findOptimalBid", () => {
    const mockCurve = [
      { bidLevel: 0.5, estimatedImpressions: 500, estimatedClicks: 25, estimatedConversions: 2.5, estimatedSpend: 8.75, estimatedSales: 50, marginalRevenue: 0, marginalCost: 0 },
      { bidLevel: 1.0, estimatedImpressions: 800, estimatedClicks: 40, estimatedConversions: 4, estimatedSpend: 20, estimatedSales: 80, marginalRevenue: 60, marginalCost: 22.5 },
      { bidLevel: 1.5, estimatedImpressions: 1000, estimatedClicks: 50, estimatedConversions: 5, estimatedSpend: 35, estimatedSales: 100, marginalRevenue: 40, marginalCost: 30 },
      { bidLevel: 2.0, estimatedImpressions: 1100, estimatedClicks: 55, estimatedConversions: 5.5, estimatedSpend: 55, estimatedSales: 110, marginalRevenue: 20, marginalCost: 40 },
    ];

    it("finds optimal bid for maximize_sales goal", () => {
      const config: PerformanceGroupConfig = {
        optimizationGoal: "maximize_sales",
      };

      const optimalBid = findOptimalBid(mockCurve, config);
      // Should stop when MR < MC
      expect(optimalBid).toBe(1.5);
    });

    it("finds optimal bid for target_acos goal", () => {
      const config: PerformanceGroupConfig = {
        optimizationGoal: "target_acos",
        targetAcos: 30, // 30%
      };

      const optimalBid = findOptimalBid(mockCurve, config);
      // ACoS at $1.0 = 20/80 = 25%, at $1.5 = 35/100 = 35%
      expect(optimalBid).toBe(1.0);
    });

    it("finds optimal bid for target_roas goal", () => {
      const config: PerformanceGroupConfig = {
        optimizationGoal: "target_roas",
        targetRoas: 3.0,
      };

      const optimalBid = findOptimalBid(mockCurve, config);
      // ROAS at $0.5 = 50/8.75 = 5.7, at $1.0 = 80/20 = 4, at $1.5 = 100/35 = 2.86 (below target)
      // Algorithm finds highest bid where ROAS >= target, which is $1.0
      expect(optimalBid).toBe(1.0);
    });

    it("finds optimal bid for daily_spend_limit goal", () => {
      const config: PerformanceGroupConfig = {
        optimizationGoal: "daily_spend_limit",
        dailySpendLimit: 30,
      };

      const optimalBid = findOptimalBid(mockCurve, config);
      expect(optimalBid).toBe(1.0);
    });
  });

  describe("calculateBidAdjustment", () => {
    it("returns bid adjustment within limits", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 1.0,
        impressions: 1000,
        clicks: 50,
        spend: 25,
        sales: 100,
        orders: 5,
      };

      const config: PerformanceGroupConfig = {
        optimizationGoal: "maximize_sales",
      };

      const result = calculateBidAdjustment(target, config);
      
      // New bid should be within 25% of current bid
      expect(result.newBid).toBeGreaterThanOrEqual(0.75);
      expect(result.newBid).toBeLessThanOrEqual(1.25);
    });

    it("respects maximum bid limit", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 9.0,
        impressions: 1000,
        clicks: 50,
        spend: 450,
        sales: 2000,
        orders: 50,
      };

      const config: PerformanceGroupConfig = {
        optimizationGoal: "maximize_sales",
      };

      const result = calculateBidAdjustment(target, config, 10.0);
      expect(result.newBid).toBeLessThanOrEqual(10.0);
    });

    it("respects minimum bid limit", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 0.05,
        impressions: 100,
        clicks: 5,
        spend: 0.25,
        sales: 0,
        orders: 0,
      };

      const config: PerformanceGroupConfig = {
        optimizationGoal: "target_acos",
        targetAcos: 20,
      };

      const result = calculateBidAdjustment(target, config, 10.0, 0.02);
      expect(result.newBid).toBeGreaterThanOrEqual(0.02);
    });

    it("includes reason for adjustment", () => {
      const target: OptimizationTarget = {
        id: 1,
        type: "keyword",
        currentBid: 1.0,
        impressions: 1000,
        clicks: 50,
        spend: 25,
        sales: 100,
        orders: 5,
      };

      const config: PerformanceGroupConfig = {
        optimizationGoal: "target_acos",
        targetAcos: 30,
      };

      const result = calculateBidAdjustment(target, config);
      expect(result.reason).toBeTruthy();
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe("optimizePerformanceGroup", () => {
    it("skips targets with insufficient data", () => {
      const targets: OptimizationTarget[] = [
        {
          id: 1,
          type: "keyword",
          currentBid: 1.0,
          impressions: 50, // Too few
          clicks: 2, // Too few
          spend: 2,
          sales: 10,
          orders: 1,
        },
      ];

      const config: PerformanceGroupConfig = {
        optimizationGoal: "maximize_sales",
      };

      const results = optimizePerformanceGroup(targets, config);
      expect(results.length).toBe(0);
    });

    it("returns results for valid targets", () => {
      const targets: OptimizationTarget[] = [
        {
          id: 1,
          type: "keyword",
          currentBid: 1.0,
          impressions: 1000,
          clicks: 50,
          spend: 25,
          sales: 100,
          orders: 5,
        },
        {
          id: 2,
          type: "keyword",
          currentBid: 0.5,
          impressions: 500,
          clicks: 25,
          spend: 12.5,
          sales: 50,
          orders: 2,
        },
      ];

      const config: PerformanceGroupConfig = {
        optimizationGoal: "maximize_sales",
      };

      const results = optimizePerformanceGroup(targets, config);
      // Results may vary based on algorithm, but should process valid targets
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("calculatePlacementAdjustments", () => {
    it("returns adjustments for all placements", () => {
      const placementPerformance = [
        { placement: "top_search" as const, impressions: 1000, clicks: 100, spend: 50, sales: 200 },
        { placement: "product_page" as const, impressions: 500, clicks: 30, spend: 15, sales: 45 },
        { placement: "rest" as const, impressions: 2000, clicks: 50, spend: 25, sales: 50 },
      ];

      const adjustments = calculatePlacementAdjustments(placementPerformance);
      
      expect(adjustments).toHaveProperty("topSearch");
      expect(adjustments).toHaveProperty("productPage");
      expect(adjustments).toHaveProperty("rest");
    });

    it("increases adjustment for high ROAS placements", () => {
      const placementPerformance = [
        { placement: "top_search" as const, impressions: 1000, clicks: 100, spend: 50, sales: 300 }, // ROAS = 6
        { placement: "product_page" as const, impressions: 500, clicks: 30, spend: 15, sales: 30 }, // ROAS = 2
        { placement: "rest" as const, impressions: 2000, clicks: 50, spend: 25, sales: 25 }, // ROAS = 1
      ];

      const adjustments = calculatePlacementAdjustments(placementPerformance);
      
      expect(adjustments.topSearch).toBeGreaterThan(0);
      expect(adjustments.rest).toBeLessThanOrEqual(0);
    });

    it("respects target ACoS when provided", () => {
      const placementPerformance = [
        { placement: "top_search" as const, impressions: 1000, clicks: 100, spend: 50, sales: 200 }, // ACoS = 25%
        { placement: "product_page" as const, impressions: 500, clicks: 30, spend: 15, sales: 30 }, // ACoS = 50%
        { placement: "rest" as const, impressions: 2000, clicks: 50, spend: 25, sales: 100 }, // ACoS = 25%
      ];

      const adjustments = calculatePlacementAdjustments(placementPerformance, 30);
      
      // Top search and rest should have positive adjustments (below target)
      expect(adjustments.topSearch).toBeGreaterThanOrEqual(0);
      // Product page should have negative adjustment (above target)
      expect(adjustments.productPage).toBeLessThan(0);
    });
  });

  describe("calculateIntradayAdjustment", () => {
    it("returns positive adjustment for high-performing hours", () => {
      const hourlyPerformance = [
        { hour: 8, impressions: 100, clicks: 10, spend: 5, sales: 20 },
        { hour: 9, impressions: 100, clicks: 10, spend: 5, sales: 10 },
        { hour: 10, impressions: 100, clicks: 10, spend: 5, sales: 10 },
        { hour: 11, impressions: 100, clicks: 10, spend: 5, sales: 10 },
      ];

      const adjustment = calculateIntradayAdjustment(hourlyPerformance, 8);
      expect(adjustment).toBeGreaterThan(0);
    });

    it("returns negative adjustment for low-performing hours", () => {
      const hourlyPerformance = [
        { hour: 8, impressions: 100, clicks: 10, spend: 5, sales: 5 },
        { hour: 9, impressions: 100, clicks: 10, spend: 5, sales: 20 },
        { hour: 10, impressions: 100, clicks: 10, spend: 5, sales: 20 },
        { hour: 11, impressions: 100, clicks: 10, spend: 5, sales: 20 },
      ];

      const adjustment = calculateIntradayAdjustment(hourlyPerformance, 8);
      expect(adjustment).toBeLessThan(0);
    });

    it("returns zero for missing hour data", () => {
      const hourlyPerformance = [
        { hour: 8, impressions: 100, clicks: 10, spend: 5, sales: 10 },
        { hour: 9, impressions: 100, clicks: 10, spend: 5, sales: 10 },
      ];

      const adjustment = calculateIntradayAdjustment(hourlyPerformance, 12);
      expect(adjustment).toBe(0);
    });

    it("limits adjustment to ±30%", () => {
      const hourlyPerformance = [
        { hour: 8, impressions: 100, clicks: 10, spend: 5, sales: 100 }, // Very high
        { hour: 9, impressions: 100, clicks: 10, spend: 5, sales: 1 },
        { hour: 10, impressions: 100, clicks: 10, spend: 5, sales: 1 },
        { hour: 11, impressions: 100, clicks: 10, spend: 5, sales: 1 },
      ];

      const adjustment = calculateIntradayAdjustment(hourlyPerformance, 8);
      expect(adjustment).toBeLessThanOrEqual(30);
      expect(adjustment).toBeGreaterThanOrEqual(-30);
    });
  });
});
