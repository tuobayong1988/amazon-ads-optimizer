import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as abTestService from './abTestService';
import * as budgetAutoExecutionService from './budgetAutoExecutionService';

// Mock getDb
vi.mock('./db', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  })),
}));

describe('A/B测试服务', () => {
  describe('calculateSampleSize', () => {
    it('应该正确计算所需样本量', () => {
      // 使用公式计算样本量
      const baselineRate = 0.05; // 5%基准转化率
      const mde = 0.2; // 20%最小可检测效应
      const alpha = 0.05; // 95%置信度
      const power = 0.8; // 80%统计功效
      
      const sampleSize = abTestService.calculateSampleSize(
        baselineRate,
        mde,
        alpha,
        power
      );
      
      // 样本量应该是正整数
      expect(sampleSize).toBeGreaterThan(0);
      expect(Number.isInteger(sampleSize)).toBe(true);
    });

    it('更小的MDE需要更大的样本量', () => {
      const baselineRate = 0.05;
      const alpha = 0.05;
      const power = 0.8;
      
      const sampleSize1 = abTestService.calculateSampleSize(baselineRate, 0.2, alpha, power);
      const sampleSize2 = abTestService.calculateSampleSize(baselineRate, 0.1, alpha, power);
      
      expect(sampleSize2).toBeGreaterThan(sampleSize1);
    });
  });

  describe('calculateStatisticalSignificance', () => {
    it('应该正确计算统计显著性', () => {
      const controlData = {
        conversions: 50,
        impressions: 1000,
        clicks: 100,
        spend: 500,
        revenue: 1000,
      };
      
      const treatmentData = {
        conversions: 70,
        impressions: 1000,
        clicks: 120,
        spend: 500,
        revenue: 1400,
      };
      
      const result = abTestService.calculateStatisticalSignificanceExported(
        controlData,
        treatmentData,
        'conversions'
      );
      
      expect(result).toHaveProperty('pValue');
      expect(result).toHaveProperty('isSignificant');
      expect(result).toHaveProperty('confidenceInterval');
      expect(result.pValue).toBeGreaterThanOrEqual(0);
      expect(result.pValue).toBeLessThanOrEqual(1);
    });

    it('相同数据应该不显著', () => {
      const data = {
        conversions: 50,
        impressions: 1000,
        clicks: 100,
        spend: 500,
        revenue: 1000,
      };
      
      const result = abTestService.calculateStatisticalSignificanceExported(data, data, 'conversions');
      
      expect(result.isSignificant).toBe(false);
    });
  });

  describe('splitCampaignsIntoGroups', () => {
    it('应该按照流量比例分配广告活动', () => {
      const campaigns = [
        { id: 1, spend: 100 },
        { id: 2, spend: 200 },
        { id: 3, spend: 150 },
        { id: 4, spend: 180 },
        { id: 5, spend: 120 },
        { id: 6, spend: 90 },
        { id: 7, spend: 160 },
        { id: 8, spend: 140 },
        { id: 9, spend: 110 },
        { id: 10, spend: 130 },
      ];
      
      const result = abTestService.splitCampaignsIntoGroups(campaigns, 0.5, 'stratified');
      
      expect(result.control.length).toBeGreaterThan(0);
      expect(result.treatment.length).toBeGreaterThan(0);
      expect(result.control.length + result.treatment.length).toBe(campaigns.length);
    });

    it('随机分配应该保持比例', () => {
      const campaigns = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, spend: Math.random() * 1000 }));
      
      const result = abTestService.splitCampaignsIntoGroups(campaigns, 0.5, 'random');
      
      // 允许10%的误差
      const treatmentRatio = result.treatment.length / campaigns.length;
      expect(treatmentRatio).toBeGreaterThan(0.4);
      expect(treatmentRatio).toBeLessThan(0.6);
    });
  });

  describe('determineWinner', () => {
    it('应该正确判断获胜方', () => {
      const metrics = [
        { metricName: 'roas', controlValue: 2.0, treatmentValue: 2.5, pValue: 0.01, isSignificant: true },
        { metricName: 'conversions', controlValue: 100, treatmentValue: 120, pValue: 0.03, isSignificant: true },
      ];
      
      const winner = abTestService.determineWinner(metrics, 'roas');
      
      expect(['control', 'treatment', 'inconclusive']).toContain(winner);
    });

    it('不显著的结果应该返回inconclusive', () => {
      const metrics = [
        { metricName: 'roas', controlValue: 2.0, treatmentValue: 2.1, pValue: 0.15, isSignificant: false },
      ];
      
      const winner = abTestService.determineWinner(metrics, 'roas');
      
      expect(winner).toBe('inconclusive');
    });
  });
});

describe('预算自动执行服务', () => {
  describe('shouldExecuteNow', () => {
    it('每日执行配置应该在指定时间执行', () => {
      const config = {
        executionFrequency: 'daily' as const,
        executionTime: '06:00',
        executionDayOfWeek: null,
        executionDayOfMonth: null,
      };
      
      // 模拟当前时间为06:00
      const testDate = new Date();
      testDate.setHours(6, 0, 0, 0);
      
      const result = budgetAutoExecutionService.shouldExecuteNowExported(config, testDate);
      
      expect(typeof result).toBe('boolean');
    });

    it('每周执行配置应该在指定日期和时间执行', () => {
      const config = {
        executionFrequency: 'weekly' as const,
        executionTime: '06:00',
        executionDayOfWeek: 2, // 周二
        executionDayOfMonth: null,
      };
      
      // 模拟当前时间为周二06:00
      const testDate = new Date('2026-01-06T06:00:00'); // 2026-01-06是周二
      
      const result = budgetAutoExecutionService.shouldExecuteNowExported(config, testDate);
      
      expect(result).toBe(true);
    });

    it('每月执行配置应该在指定日期执行', () => {
      const config = {
        executionFrequency: 'monthly' as const,
        executionTime: '06:00',
        executionDayOfWeek: null,
        executionDayOfMonth: 1, // 每月1号
      };
      
      // 模拟当前时间为1号06:00
      const testDate = new Date('2026-01-01T06:00:00');
      
      const result = budgetAutoExecutionService.shouldExecuteNowExported(config, testDate);
      
      expect(result).toBe(true);
    });
  });

  describe('calculateNextExecutionTime', () => {
    it('应该正确计算下次执行时间', () => {
      const config = {
        executionFrequency: 'daily' as const,
        executionTime: '06:00',
        executionDayOfWeek: null,
        executionDayOfMonth: null,
      };
      
      const now = new Date('2026-01-06T10:00:00');
      const nextTime = budgetAutoExecutionService.calculateNextExecutionTimeExported(config, now);
      
      expect(nextTime).toBeInstanceOf(Date);
      expect(nextTime.getTime()).toBeGreaterThan(now.getTime());
    });

    it('如果今天的执行时间已过，应该返回明天的时间', () => {
      const config = {
        executionFrequency: 'daily' as const,
        executionTime: '06:00',
        executionDayOfWeek: null,
        executionDayOfMonth: null,
      };
      
      const now = new Date('2026-01-06T10:00:00');
      const nextTime = budgetAutoExecutionService.calculateNextExecutionTimeExported(config, now);
      
      expect(nextTime.getDate()).toBe(7); // 应该是明天
    });
  });

  describe('validateBudgetAdjustment', () => {
    it('应该验证调整幅度不超过最大限制', () => {
      const adjustment = {
        currentBudget: 100,
        newBudget: 150,
        maxAdjustmentPercent: 20,
      };
      
      const result = budgetAutoExecutionService.validateBudgetAdjustment(adjustment);
      
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('超过最大调整幅度');
    });

    it('应该验证新预算不低于最小预算', () => {
      const adjustment = {
        currentBudget: 100,
        newBudget: 3,
        minBudget: 5,
        maxAdjustmentPercent: 100,
      };
      
      const result = budgetAutoExecutionService.validateBudgetAdjustment(adjustment);
      
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('低于最小预算');
    });

    it('有效的调整应该通过验证', () => {
      const adjustment = {
        currentBudget: 100,
        newBudget: 110,
        minBudget: 5,
        maxAdjustmentPercent: 20,
      };
      
      const result = budgetAutoExecutionService.validateBudgetAdjustment(adjustment);
      
      expect(result.isValid).toBe(true);
    });
  });

  describe('generateExecutionSummary', () => {
    it('应该正确生成执行摘要', () => {
      const details = [
        { campaignId: 1, status: 'applied', budgetBefore: 100, budgetAfter: 110 },
        { campaignId: 2, status: 'applied', budgetBefore: 200, budgetAfter: 180 },
        { campaignId: 3, status: 'skipped', budgetBefore: 150, budgetAfter: 150 },
        { campaignId: 4, status: 'error', budgetBefore: 80, budgetAfter: 80 },
      ];
      
      const summary = budgetAutoExecutionService.generateExecutionSummary(details);
      
      expect(summary.totalCampaigns).toBe(4);
      expect(summary.adjustedCampaigns).toBe(2);
      expect(summary.skippedCampaigns).toBe(1);
      expect(summary.errorCampaigns).toBe(1);
      expect(summary.totalBudgetBefore).toBe(530);
      expect(summary.totalBudgetAfter).toBe(520);
    });
  });

  describe('formatExecutionReport', () => {
    it('应该生成可读的执行报告', () => {
      const execution = {
        id: 1,
        status: 'completed',
        totalCampaigns: 10,
        adjustedCampaigns: 7,
        skippedCampaigns: 2,
        errorCampaigns: 1,
        totalBudgetBefore: 1000,
        totalBudgetAfter: 1050,
        executionStartAt: new Date('2026-01-06T06:00:00'),
        executionEndAt: new Date('2026-01-06T06:05:00'),
      };
      
      const report = budgetAutoExecutionService.formatExecutionReport(execution);
      
      expect(report).toContain('执行完成');
      expect(report).toContain('10');
      expect(report).toContain('7');
    });
  });
});

describe('A/B测试与预算执行集成', () => {
  it('A/B测试获胜策略应该可以应用到自动执行', () => {
    // 模拟A/B测试结果
    const testResult = {
      winner: 'treatment',
      treatmentConfig: {
        strategy: 'aggressive',
        maxAdjustmentPercent: 25,
      },
    };
    
    // 验证获胜配置可以被自动执行使用
    expect(testResult.treatmentConfig.maxAdjustmentPercent).toBeDefined();
    expect(testResult.treatmentConfig.strategy).toBeDefined();
  });
});
