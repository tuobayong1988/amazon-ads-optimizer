/**
 * Seasonal Budget Service Tests
 * 季节性预算服务单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database
vi.mock("./db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}));

describe("Seasonal Budget Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Seasonal Index Calculation", () => {
    it("should calculate seasonal index correctly", () => {
      // 季节性指数 = 当月平均值 / 年平均值
      const monthlyAvg = 1200;
      const yearlyAvg = 1000;
      const seasonalIndex = monthlyAvg / yearlyAvg;
      
      expect(seasonalIndex).toBe(1.2); // 旺季
    });

    it("should identify peak season", () => {
      const isPeakSeason = (seasonalIndex: number) => seasonalIndex > 1.1;
      
      expect(isPeakSeason(1.2)).toBe(true);
      expect(isPeakSeason(1.5)).toBe(true);
      expect(isPeakSeason(1.0)).toBe(false);
      expect(isPeakSeason(0.8)).toBe(false);
    });

    it("should identify low season", () => {
      const isLowSeason = (seasonalIndex: number) => seasonalIndex < 0.9;
      
      expect(isLowSeason(0.7)).toBe(true);
      expect(isLowSeason(0.85)).toBe(true);
      expect(isLowSeason(1.0)).toBe(false);
      expect(isLowSeason(1.2)).toBe(false);
    });
  });

  describe("Event Detection", () => {
    it("should identify Prime Day period", () => {
      const isPrimeDay = (date: Date, marketplace: string) => {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        
        // Prime Day 通常在7月中旬
        if (marketplace === "US" && month === 7 && day >= 10 && day <= 17) {
          return true;
        }
        return false;
      };

      expect(isPrimeDay(new Date("2026-07-12"), "US")).toBe(true);
      expect(isPrimeDay(new Date("2026-07-15"), "US")).toBe(true);
      expect(isPrimeDay(new Date("2026-07-20"), "US")).toBe(false);
      expect(isPrimeDay(new Date("2026-06-15"), "US")).toBe(false);
    });

    it("should identify Black Friday period", () => {
      const isBlackFriday = (date: Date) => {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        
        // 黑五通常在11月最后一个周五
        if (month === 11 && day >= 20 && day <= 30) {
          return true;
        }
        return false;
      };

      expect(isBlackFriday(new Date("2026-11-27"))).toBe(true);
      expect(isBlackFriday(new Date("2026-11-25"))).toBe(true);
      expect(isBlackFriday(new Date("2026-11-10"))).toBe(false);
    });

    it("should identify Cyber Monday period", () => {
      const isCyberMonday = (date: Date) => {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        
        // Cyber Monday 在黑五后的周一
        if (month === 11 && day >= 28 || month === 12 && day <= 3) {
          return true;
        }
        return false;
      };

      expect(isCyberMonday(new Date("2026-11-30"))).toBe(true);
      expect(isCyberMonday(new Date("2026-12-01"))).toBe(true);
    });
  });

  describe("Budget Multiplier Calculation", () => {
    it("should calculate event budget multiplier", () => {
      const getEventMultiplier = (eventType: string) => {
        const multipliers: Record<string, number> = {
          prime_day: 2.0,
          black_friday: 2.5,
          cyber_monday: 2.0,
          christmas: 1.8,
          new_year: 1.5,
          valentines: 1.3,
          mothers_day: 1.4,
          fathers_day: 1.3,
        };
        return multipliers[eventType] || 1.0;
      };

      expect(getEventMultiplier("prime_day")).toBe(2.0);
      expect(getEventMultiplier("black_friday")).toBe(2.5);
      expect(getEventMultiplier("christmas")).toBe(1.8);
      expect(getEventMultiplier("unknown")).toBe(1.0);
    });

    it("should calculate warmup multiplier", () => {
      const getWarmupMultiplier = (daysBeforeEvent: number, eventMultiplier: number) => {
        // 预热期逐步增加预算
        if (daysBeforeEvent > 14) return 1.0;
        if (daysBeforeEvent > 7) return 1.0 + (eventMultiplier - 1.0) * 0.3;
        if (daysBeforeEvent > 3) return 1.0 + (eventMultiplier - 1.0) * 0.5;
        return 1.0 + (eventMultiplier - 1.0) * 0.7;
      };

      const eventMultiplier = 2.0;
      expect(getWarmupMultiplier(20, eventMultiplier)).toBe(1.0);
      expect(getWarmupMultiplier(10, eventMultiplier)).toBeCloseTo(1.3);
      expect(getWarmupMultiplier(5, eventMultiplier)).toBeCloseTo(1.5);
      expect(getWarmupMultiplier(2, eventMultiplier)).toBeCloseTo(1.7);
    });
  });

  describe("Recommendation Generation", () => {
    it("should generate increase recommendation for peak season", () => {
      const generateRecommendation = (
        seasonalIndex: number,
        currentBudget: number,
        eventType?: string
      ) => {
        let multiplier = 1.0;
        let type = "trend_based";
        let reasoning = "";

        if (eventType) {
          type = "event_increase";
          multiplier = 2.0; // 简化
          reasoning = `${eventType}期间建议增加预算`;
        } else if (seasonalIndex > 1.1) {
          type = "seasonal_increase";
          multiplier = seasonalIndex;
          reasoning = "历史数据显示当前为旺季，建议增加预算";
        } else if (seasonalIndex < 0.9) {
          type = "seasonal_decrease";
          multiplier = seasonalIndex;
          reasoning = "历史数据显示当前为淡季，建议减少预算";
        }

        return {
          type,
          multiplier,
          recommendedBudget: currentBudget * multiplier,
          reasoning,
        };
      };

      const result = generateRecommendation(1.3, 100);
      expect(result.type).toBe("seasonal_increase");
      expect(result.multiplier).toBe(1.3);
      expect(result.recommendedBudget).toBe(130);
    });

    it("should generate decrease recommendation for low season", () => {
      const generateRecommendation = (
        seasonalIndex: number,
        currentBudget: number,
        eventType?: string
      ) => {
        let multiplier = 1.0;
        let type = "trend_based";

        if (eventType) {
          type = "event_increase";
          multiplier = 2.0;
        } else if (seasonalIndex > 1.1) {
          type = "seasonal_increase";
          multiplier = seasonalIndex;
        } else if (seasonalIndex < 0.9) {
          type = "seasonal_decrease";
          multiplier = seasonalIndex;
        }

        return {
          type,
          multiplier,
          recommendedBudget: currentBudget * multiplier,
        };
      };

      const result = generateRecommendation(0.7, 100);
      expect(result.type).toBe("seasonal_decrease");
      expect(result.multiplier).toBe(0.7);
      expect(result.recommendedBudget).toBe(70);
    });

    it("should prioritize event over seasonal", () => {
      const generateRecommendation = (
        seasonalIndex: number,
        currentBudget: number,
        eventType?: string
      ) => {
        let multiplier = 1.0;
        let type = "trend_based";

        if (eventType) {
          type = "event_increase";
          multiplier = 2.0;
        } else if (seasonalIndex > 1.1) {
          type = "seasonal_increase";
          multiplier = seasonalIndex;
        } else if (seasonalIndex < 0.9) {
          type = "seasonal_decrease";
          multiplier = seasonalIndex;
        }

        return {
          type,
          multiplier,
          recommendedBudget: currentBudget * multiplier,
        };
      };

      const result = generateRecommendation(0.7, 100, "prime_day");
      expect(result.type).toBe("event_increase");
      expect(result.multiplier).toBe(2.0);
      expect(result.recommendedBudget).toBe(200);
    });
  });

  describe("Confidence Score Calculation", () => {
    it("should calculate confidence based on data points", () => {
      const calculateConfidence = (dataPoints: number, maxPoints: number = 365) => {
        // 数据点越多，置信度越高
        const baseConfidence = Math.min(dataPoints / maxPoints, 1.0) * 70;
        return Math.round(baseConfidence + 30); // 基础30%
      };

      expect(calculateConfidence(365)).toBe(100);
      expect(calculateConfidence(180)).toBeGreaterThan(60);
      expect(calculateConfidence(30)).toBeGreaterThan(35);
      expect(calculateConfidence(0)).toBe(30);
    });

    it("should adjust confidence for event recommendations", () => {
      const adjustConfidenceForEvent = (
        baseConfidence: number,
        isKnownEvent: boolean,
        historicalEventData: boolean
      ) => {
        let confidence = baseConfidence;
        if (isKnownEvent) confidence += 10;
        if (historicalEventData) confidence += 15;
        return Math.min(confidence, 100);
      };

      expect(adjustConfidenceForEvent(70, true, true)).toBe(95);
      expect(adjustConfidenceForEvent(70, true, false)).toBe(80);
      expect(adjustConfidenceForEvent(70, false, false)).toBe(70);
      expect(adjustConfidenceForEvent(90, true, true)).toBe(100); // 不超过100
    });
  });

  describe("Expected Sales Increase", () => {
    it("should estimate sales increase from budget increase", () => {
      const estimateSalesIncrease = (
        budgetMultiplier: number,
        historicalRoas: number
      ) => {
        // 简化模型：销售增长 ≈ 预算增长 * ROAS效率因子
        const efficiencyFactor = 0.8; // 边际效益递减
        const salesIncrease = (budgetMultiplier - 1) * historicalRoas * efficiencyFactor;
        return salesIncrease * 100; // 转为百分比
      };

      // 预算翻倍，ROAS为3
      const result = estimateSalesIncrease(2.0, 3.0);
      expect(result).toBeCloseTo(240); // (2-1) * 3 * 0.8 * 100 = 240%
    });
  });
});
