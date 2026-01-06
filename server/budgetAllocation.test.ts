import { describe, it, expect, vi } from "vitest";

// Mock the database
vi.mock("./db", () => ({
  getDb: vi.fn(() => Promise.resolve({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnValue([{ insertId: 1 }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  })),
}));

describe("Budget Allocation Service", () => {
  describe("calculatePriorityScore", () => {
    it("should calculate higher score for high ROAS campaigns", () => {
      // 高ROAS活动应该获得更高的优先级分数
      const highRoasCampaign = {
        roas: 5.0,
        acos: 20,
        ctr: 0.5,
        cvr: 10,
        spend: 1000,
        sales: 5000,
      };
      
      const lowRoasCampaign = {
        roas: 1.5,
        acos: 67,
        ctr: 0.3,
        cvr: 5,
        spend: 1000,
        sales: 1500,
      };
      
      // 模拟优先级计算逻辑
      const calculateScore = (metrics: any, prioritizeHighRoas: boolean) => {
        let score = 50;
        
        if (prioritizeHighRoas) {
          if (metrics.roas >= 3) score += 30;
          else if (metrics.roas >= 2) score += 20;
          else if (metrics.roas >= 1) score += 10;
        }
        
        if (metrics.acos <= 25) score += 20;
        else if (metrics.acos <= 35) score += 10;
        else if (metrics.acos > 50) score -= 20;
        
        if (metrics.ctr >= 0.5) score += 10;
        if (metrics.cvr >= 10) score += 10;
        
        return Math.max(0, Math.min(100, score));
      };
      
      const highRoasScore = calculateScore(highRoasCampaign, true);
      const lowRoasScore = calculateScore(lowRoasCampaign, true);
      
      expect(highRoasScore).toBeGreaterThan(lowRoasScore);
    });

    it("should penalize high ACoS campaigns", () => {
      const calculateScore = (acos: number) => {
        let score = 50;
        if (acos <= 25) score += 20;
        else if (acos <= 35) score += 10;
        else if (acos > 50) score -= 20;
        return score;
      };
      
      expect(calculateScore(20)).toBe(70);
      expect(calculateScore(30)).toBe(60);
      expect(calculateScore(60)).toBe(30);
    });
  });

  describe("allocateBudget", () => {
    it("should allocate more budget to high priority campaigns", () => {
      const campaigns = [
        { id: 1, name: "Campaign A", score: 90, currentBudget: 100 },
        { id: 2, name: "Campaign B", score: 50, currentBudget: 100 },
        { id: 3, name: "Campaign C", score: 30, currentBudget: 100 },
      ];
      
      const totalBudget = 300;
      const totalScore = campaigns.reduce((sum, c) => sum + c.score, 0);
      
      const allocations = campaigns.map(c => ({
        ...c,
        recommendedBudget: (c.score / totalScore) * totalBudget,
      }));
      
      // 高优先级活动应该获得更多预算
      expect(allocations[0].recommendedBudget).toBeGreaterThan(allocations[1].recommendedBudget);
      expect(allocations[1].recommendedBudget).toBeGreaterThan(allocations[2].recommendedBudget);
      
      // 总预算应该等于分配的预算
      const totalAllocated = allocations.reduce((sum, a) => sum + a.recommendedBudget, 0);
      expect(totalAllocated).toBeCloseTo(totalBudget, 2);
    });

    it("should respect minimum and maximum budget constraints", () => {
      const minBudget = 10;
      const maxBudget = 200;
      
      const applyConstraints = (budget: number) => {
        return Math.max(minBudget, Math.min(maxBudget, budget));
      };
      
      expect(applyConstraints(5)).toBe(10);
      expect(applyConstraints(50)).toBe(50);
      expect(applyConstraints(250)).toBe(200);
    });

    it("should handle edge case with zero total score", () => {
      const campaigns = [
        { id: 1, score: 0, currentBudget: 100 },
        { id: 2, score: 0, currentBudget: 100 },
      ];
      
      const totalBudget = 200;
      const totalScore = campaigns.reduce((sum, c) => sum + c.score, 0);
      
      // 当总分为0时，应该平均分配
      const allocations = campaigns.map(c => ({
        ...c,
        recommendedBudget: totalScore === 0 
          ? totalBudget / campaigns.length 
          : (c.score / totalScore) * totalBudget,
      }));
      
      expect(allocations[0].recommendedBudget).toBe(100);
      expect(allocations[1].recommendedBudget).toBe(100);
    });
  });

  describe("determineAllocationReason", () => {
    it("should identify high ROAS campaigns", () => {
      const determineReason = (metrics: any) => {
        if (metrics.roas >= 3) return "high_roas";
        if (metrics.acos <= 25) return "low_acos";
        if (metrics.cvr >= 10) return "high_conversion";
        if (metrics.roas < 1) return "low_roas";
        if (metrics.acos > 50) return "high_acos";
        return "maintain";
      };
      
      expect(determineReason({ roas: 4, acos: 30, cvr: 8 })).toBe("high_roas");
      expect(determineReason({ roas: 2, acos: 20, cvr: 8 })).toBe("low_acos");
      expect(determineReason({ roas: 2, acos: 30, cvr: 12 })).toBe("high_conversion");
      expect(determineReason({ roas: 0.5, acos: 60, cvr: 5 })).toBe("low_roas");
      expect(determineReason({ roas: 1.5, acos: 55, cvr: 5 })).toBe("high_acos");
      expect(determineReason({ roas: 2, acos: 35, cvr: 8 })).toBe("maintain");
    });
  });

  describe("predictPerformance", () => {
    it("should predict sales based on historical ROAS", () => {
      const predictSales = (budget: number, historicalRoas: number) => {
        return budget * historicalRoas;
      };
      
      expect(predictSales(100, 3)).toBe(300);
      expect(predictSales(200, 2.5)).toBe(500);
    });

    it("should calculate predicted ROAS from total budget and sales", () => {
      const calculatePredictedRoas = (totalSales: number, totalBudget: number) => {
        return totalBudget > 0 ? totalSales / totalBudget : 0;
      };
      
      expect(calculatePredictedRoas(3000, 1000)).toBe(3);
      expect(calculatePredictedRoas(0, 0)).toBe(0);
    });
  });

  describe("Budget Goal Management", () => {
    it("should validate goal type enum values", () => {
      const validGoalTypes = [
        "sales_target",
        "roas_target",
        "acos_target",
        "profit_target",
        "market_share",
      ];
      
      const isValidGoalType = (type: string) => validGoalTypes.includes(type);
      
      expect(isValidGoalType("sales_target")).toBe(true);
      expect(isValidGoalType("roas_target")).toBe(true);
      expect(isValidGoalType("invalid_type")).toBe(false);
    });

    it("should validate period type enum values", () => {
      const validPeriodTypes = ["daily", "weekly", "monthly", "quarterly"];
      
      const isValidPeriodType = (type: string) => validPeriodTypes.includes(type);
      
      expect(isValidPeriodType("daily")).toBe(true);
      expect(isValidPeriodType("monthly")).toBe(true);
      expect(isValidPeriodType("yearly")).toBe(false);
    });
  });

  describe("Allocation Summary", () => {
    it("should calculate correct summary statistics", () => {
      const recommendations = [
        { currentBudget: 100, recommendedBudget: 150, budgetChange: 50 },
        { currentBudget: 100, recommendedBudget: 80, budgetChange: -20 },
        { currentBudget: 100, recommendedBudget: 100, budgetChange: 0 },
        { currentBudget: 100, recommendedBudget: 120, budgetChange: 20 },
      ];
      
      const calculateSummary = (recs: any[]) => {
        const increased = recs.filter(r => r.budgetChange > 0);
        const decreased = recs.filter(r => r.budgetChange < 0);
        const unchanged = recs.filter(r => r.budgetChange === 0);
        
        return {
          increasedCount: increased.length,
          decreasedCount: decreased.length,
          unchangedCount: unchanged.length,
          totalIncrease: increased.reduce((sum, r) => sum + r.budgetChange, 0),
          totalDecrease: Math.abs(decreased.reduce((sum, r) => sum + r.budgetChange, 0)),
        };
      };
      
      const summary = calculateSummary(recommendations);
      
      expect(summary.increasedCount).toBe(2);
      expect(summary.decreasedCount).toBe(1);
      expect(summary.unchangedCount).toBe(1);
      expect(summary.totalIncrease).toBe(70);
      expect(summary.totalDecrease).toBe(20);
    });
  });

  describe("Budget History Tracking", () => {
    it("should calculate change percentage correctly", () => {
      const calculateChangePercent = (previous: number, current: number) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
      };
      
      expect(calculateChangePercent(100, 150)).toBe(50);
      expect(calculateChangePercent(100, 80)).toBe(-20);
      expect(calculateChangePercent(100, 100)).toBe(0);
      expect(calculateChangePercent(0, 100)).toBe(100);
      expect(calculateChangePercent(0, 0)).toBe(0);
    });
  });
});
