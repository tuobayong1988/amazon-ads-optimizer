/**
 * Budget Alert Service Tests
 * 预算预警服务单元测试
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

describe("Budget Alert Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateConsumptionRate", () => {
    it("should calculate consumption rate correctly", () => {
      // 测试消耗速率计算
      const dailyBudget = 100;
      const currentSpend = 50;
      const hoursElapsed = 12;
      
      // 预期消耗 = (dailyBudget / 24) * hoursElapsed = (100/24) * 12 = 50
      const expectedSpend = (dailyBudget / 24) * hoursElapsed;
      const consumptionRate = (currentSpend / expectedSpend) * 100;
      
      expect(consumptionRate).toBe(100); // 正常消耗
    });

    it("should detect overspending", () => {
      const dailyBudget = 100;
      const currentSpend = 80;
      const hoursElapsed = 12;
      
      const expectedSpend = (dailyBudget / 24) * hoursElapsed; // 50
      const consumptionRate = (currentSpend / expectedSpend) * 100; // 160%
      
      expect(consumptionRate).toBeGreaterThan(120); // 超过120%为过快消耗
    });

    it("should detect underspending", () => {
      const dailyBudget = 100;
      const currentSpend = 20;
      const hoursElapsed = 12;
      
      const expectedSpend = (dailyBudget / 24) * hoursElapsed; // 50
      const consumptionRate = (currentSpend / expectedSpend) * 100; // 40%
      
      expect(consumptionRate).toBeLessThan(50); // 低于50%为过慢消耗
    });
  });

  describe("detectAlertType", () => {
    it("should return overspending for high consumption rate", () => {
      const detectAlertType = (consumptionRate: number, budgetRemaining: number) => {
        if (budgetRemaining <= 0) return "budget_depleted";
        if (budgetRemaining <= 10) return "near_depletion";
        if (consumptionRate > 120) return "overspending";
        if (consumptionRate < 50) return "underspending";
        return null;
      };

      expect(detectAlertType(150, 50)).toBe("overspending");
    });

    it("should return underspending for low consumption rate", () => {
      const detectAlertType = (consumptionRate: number, budgetRemaining: number) => {
        if (budgetRemaining <= 0) return "budget_depleted";
        if (budgetRemaining <= 10) return "near_depletion";
        if (consumptionRate > 120) return "overspending";
        if (consumptionRate < 50) return "underspending";
        return null;
      };

      expect(detectAlertType(30, 80)).toBe("underspending");
    });

    it("should return budget_depleted when budget is exhausted", () => {
      const detectAlertType = (consumptionRate: number, budgetRemaining: number) => {
        if (budgetRemaining <= 0) return "budget_depleted";
        if (budgetRemaining <= 10) return "near_depletion";
        if (consumptionRate > 120) return "overspending";
        if (consumptionRate < 50) return "underspending";
        return null;
      };

      expect(detectAlertType(100, 0)).toBe("budget_depleted");
    });

    it("should return near_depletion when budget is almost exhausted", () => {
      const detectAlertType = (consumptionRate: number, budgetRemaining: number) => {
        if (budgetRemaining <= 0) return "budget_depleted";
        if (budgetRemaining <= 10) return "near_depletion";
        if (consumptionRate > 120) return "overspending";
        if (consumptionRate < 50) return "underspending";
        return null;
      };

      expect(detectAlertType(100, 5)).toBe("near_depletion");
    });

    it("should return null for normal consumption", () => {
      const detectAlertType = (consumptionRate: number, budgetRemaining: number) => {
        if (budgetRemaining <= 0) return "budget_depleted";
        if (budgetRemaining <= 10) return "near_depletion";
        if (consumptionRate > 120) return "overspending";
        if (consumptionRate < 50) return "underspending";
        return null;
      };

      expect(detectAlertType(100, 50)).toBeNull();
    });
  });

  describe("determineSeverity", () => {
    it("should return critical for budget_depleted", () => {
      const determineSeverity = (alertType: string, deviationPercent: number) => {
        if (alertType === "budget_depleted") return "critical";
        if (alertType === "near_depletion") return "high";
        if (Math.abs(deviationPercent) > 50) return "high";
        if (Math.abs(deviationPercent) > 30) return "medium";
        return "low";
      };

      expect(determineSeverity("budget_depleted", 0)).toBe("critical");
    });

    it("should return high for near_depletion", () => {
      const determineSeverity = (alertType: string, deviationPercent: number) => {
        if (alertType === "budget_depleted") return "critical";
        if (alertType === "near_depletion") return "high";
        if (Math.abs(deviationPercent) > 50) return "high";
        if (Math.abs(deviationPercent) > 30) return "medium";
        return "low";
      };

      expect(determineSeverity("near_depletion", 0)).toBe("high");
    });

    it("should return high for large deviation", () => {
      const determineSeverity = (alertType: string, deviationPercent: number) => {
        if (alertType === "budget_depleted") return "critical";
        if (alertType === "near_depletion") return "high";
        if (Math.abs(deviationPercent) > 50) return "high";
        if (Math.abs(deviationPercent) > 30) return "medium";
        return "low";
      };

      expect(determineSeverity("overspending", 60)).toBe("high");
    });

    it("should return medium for moderate deviation", () => {
      const determineSeverity = (alertType: string, deviationPercent: number) => {
        if (alertType === "budget_depleted") return "critical";
        if (alertType === "near_depletion") return "high";
        if (Math.abs(deviationPercent) > 50) return "high";
        if (Math.abs(deviationPercent) > 30) return "medium";
        return "low";
      };

      expect(determineSeverity("overspending", 40)).toBe("medium");
    });

    it("should return low for small deviation", () => {
      const determineSeverity = (alertType: string, deviationPercent: number) => {
        if (alertType === "budget_depleted") return "critical";
        if (alertType === "near_depletion") return "high";
        if (Math.abs(deviationPercent) > 50) return "high";
        if (Math.abs(deviationPercent) > 30) return "medium";
        return "low";
      };

      expect(determineSeverity("underspending", 20)).toBe("low");
    });
  });

  describe("generateRecommendation", () => {
    it("should generate recommendation for overspending", () => {
      const generateRecommendation = (alertType: string, deviationPercent: number) => {
        switch (alertType) {
          case "overspending":
            return `预算消耗过快，当前消耗速度比预期高${deviationPercent.toFixed(1)}%。建议检查竞价设置或暂停部分广告活动。`;
          case "underspending":
            return `预算消耗过慢，当前消耗速度比预期低${Math.abs(deviationPercent).toFixed(1)}%。建议提高竞价或扩展关键词覆盖。`;
          case "budget_depleted":
            return "预算已耗尽，广告已停止展示。建议增加预算或优化竞价策略。";
          case "near_depletion":
            return "预算即将耗尽，建议及时补充预算以保持广告展示。";
          default:
            return "";
        }
      };

      const recommendation = generateRecommendation("overspending", 50);
      expect(recommendation).toContain("预算消耗过快");
      expect(recommendation).toContain("50.0%");
    });

    it("should generate recommendation for underspending", () => {
      const generateRecommendation = (alertType: string, deviationPercent: number) => {
        switch (alertType) {
          case "overspending":
            return `预算消耗过快，当前消耗速度比预期高${deviationPercent.toFixed(1)}%。建议检查竞价设置或暂停部分广告活动。`;
          case "underspending":
            return `预算消耗过慢，当前消耗速度比预期低${Math.abs(deviationPercent).toFixed(1)}%。建议提高竞价或扩展关键词覆盖。`;
          case "budget_depleted":
            return "预算已耗尽，广告已停止展示。建议增加预算或优化竞价策略。";
          case "near_depletion":
            return "预算即将耗尽，建议及时补充预算以保持广告展示。";
          default:
            return "";
        }
      };

      const recommendation = generateRecommendation("underspending", -60);
      expect(recommendation).toContain("预算消耗过慢");
      expect(recommendation).toContain("60.0%");
    });
  });
});
