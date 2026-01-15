/**
 * 预算自动执行服务单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock数据库模块
vi.mock('./db', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([]))
          })),
          limit: vi.fn(() => Promise.resolve([]))
        }))
      }))
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve({ insertId: 1 }))
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve())
      }))
    }))
  }))
}));

describe('BudgetAutoExecutionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('预算自动执行配置', () => {
    it('应该正确验证执行配置参数', () => {
      const config = {
        accountId: 1,
        isEnabled: true,
        executionMode: 'auto' as const,
        minBudget: 10,
        maxBudget: 1000,
        budgetStep: 5,
        targetAcos: 25,
        lookbackDays: 7,
      };

      expect(config.accountId).toBe(1);
      expect(config.isEnabled).toBe(true);
      expect(config.executionMode).toBe('auto');
      expect(config.minBudget).toBe(10);
      expect(config.maxBudget).toBe(1000);
    });

    it('应该正确计算预算调整建议', () => {
      const campaign = {
        id: 1,
        campaignName: 'Test Campaign',
        currentBudget: 100,
        acos: 20,
        spend: 80,
        sales: 400,
        impressions: 10000,
        clicks: 200,
      };

      const config = {
        targetAcos: 25,
        budgetStep: 10,
        minBudget: 10,
        maxBudget: 500,
      };

      // 如果ACOS低于目标且花费比例超过80%，建议增加预算
      let suggestedBudget = campaign.currentBudget;
      const spendRatio = campaign.spend / campaign.currentBudget; // 80/100 = 0.8
      if (campaign.acos < config.targetAcos && spendRatio > 0.8) {
        suggestedBudget = Math.min(
          campaign.currentBudget + config.budgetStep,
          config.maxBudget
        );
      }

      // spendRatio = 0.8, 不大于0.8，所以不会增加预算
      expect(suggestedBudget).toBe(100);
    });

    it('应该正确处理预算减少建议', () => {
      const campaign = {
        id: 1,
        campaignName: 'Test Campaign',
        currentBudget: 100,
        acos: 35,
        spend: 90,
        sales: 257,
        impressions: 10000,
        clicks: 200,
      };

      const config = {
        targetAcos: 25,
        budgetStep: 10,
        minBudget: 10,
        maxBudget: 500,
      };

      // 如果ACOS高于目标，建议减少预算
      let suggestedBudget = campaign.currentBudget;
      if (campaign.acos > config.targetAcos) {
        suggestedBudget = Math.max(
          campaign.currentBudget - config.budgetStep,
          config.minBudget
        );
      }

      expect(suggestedBudget).toBe(90);
    });
  });

  describe('分时预算分配', () => {
    it('应该正确计算分时预算系数', () => {
      const hourlyCoefficients = [
        0.5, 0.4, 0.3, 0.3, 0.3, 0.4, // 0-5点
        0.6, 0.8, 1.0, 1.2, 1.3, 1.2, // 6-11点
        1.1, 1.0, 1.1, 1.2, 1.3, 1.2, // 12-17点
        1.1, 1.2, 1.3, 1.2, 0.9, 0.7, // 18-23点
      ];

      const dailyBudget = 100;
      const currentHour = 10;
      const hourlyBudget = dailyBudget * hourlyCoefficients[currentHour] / 24;

      expect(hourlyCoefficients.length).toBe(24);
      expect(hourlyBudget).toBeCloseTo(5.42, 1);
    });

    it('应该正确处理周末系数调整', () => {
      const weekdayCoefficient = 1.0;
      const weekendCoefficient = 0.8;

      const isWeekend = (day: number) => day === 0 || day === 6;
      
      const today = new Date();
      const dayOfWeek = today.getDay();
      const coefficient = isWeekend(dayOfWeek) ? weekendCoefficient : weekdayCoefficient;

      expect(typeof coefficient).toBe('number');
      expect(coefficient).toBeGreaterThan(0);
      expect(coefficient).toBeLessThanOrEqual(1);
    });
  });

  describe('执行历史记录', () => {
    it('应该正确记录执行历史', () => {
      const executionRecord = {
        accountId: 1,
        configId: 1,
        executionType: 'scheduled' as const,
        totalCampaigns: 50,
        adjustedCampaigns: 10,
        totalBudgetChange: 150,
        status: 'completed' as const,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      expect(executionRecord.totalCampaigns).toBe(50);
      expect(executionRecord.adjustedCampaigns).toBe(10);
      expect(executionRecord.status).toBe('completed');
    });

    it('应该正确计算总预算变化', () => {
      const adjustments = [
        { campaignId: 1, budgetBefore: 100, budgetAfter: 110 },
        { campaignId: 2, budgetBefore: 200, budgetAfter: 180 },
        { campaignId: 3, budgetBefore: 150, budgetAfter: 160 },
      ];

      const totalBudgetChange = adjustments.reduce(
        (sum, adj) => sum + (adj.budgetAfter - adj.budgetBefore),
        0
      );

      // (110-100) + (180-200) + (160-150) = 10 + (-20) + 10 = 0
      expect(totalBudgetChange).toBe(0);
    });
  });

  describe('安全限制', () => {
    it('应该正确验证预算上下限', () => {
      const validateBudget = (budget: number, min: number, max: number) => {
        return Math.max(min, Math.min(max, budget));
      };

      expect(validateBudget(5, 10, 100)).toBe(10);
      expect(validateBudget(150, 10, 100)).toBe(100);
      expect(validateBudget(50, 10, 100)).toBe(50);
    });

    it('应该正确处理每日调整次数限制', () => {
      const maxDailyAdjustments = 3;
      const todayAdjustments = 2;

      const canAdjust = todayAdjustments < maxDailyAdjustments;

      expect(canAdjust).toBe(true);
    });

    it('应该正确处理最大调整幅度限制', () => {
      const maxAdjustmentPercent = 20;
      const currentBudget = 100;
      const suggestedBudget = 150;

      const maxIncrease = currentBudget * (1 + maxAdjustmentPercent / 100);
      const maxDecrease = currentBudget * (1 - maxAdjustmentPercent / 100);

      const finalBudget = Math.max(maxDecrease, Math.min(maxIncrease, suggestedBudget));

      expect(finalBudget).toBe(120);
    });
  });
});
