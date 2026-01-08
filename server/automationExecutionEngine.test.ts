/**
 * 自动化执行引擎单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as automationEngine from './automationExecutionEngine';

describe('自动化执行引擎', () => {
  beforeEach(() => {
    // 重置配置
    vi.clearAllMocks();
  });

  describe('getAccountAutomationConfig', () => {
    it('应返回默认配置', () => {
      const config = automationEngine.getAccountAutomationConfig(999);
      
      expect(config.accountId).toBe(999);
      expect(config.enabled).toBe(true);
      expect(config.mode).toBe('full_auto');
      expect(config.safetyBoundary.maxBidChangePercent).toBe(30);
      expect(config.safetyBoundary.maxBudgetChangePercent).toBe(50);
      expect(config.safetyBoundary.autoExecuteConfidence).toBe(80);
    });

    it('应返回相同账号的相同配置', () => {
      const config1 = automationEngine.getAccountAutomationConfig(888);
      const config2 = automationEngine.getAccountAutomationConfig(888);
      
      expect(config1).toBe(config2);
    });
  });

  describe('updateAccountAutomationConfig', () => {
    it('应正确更新配置', () => {
      const accountId = 777;
      
      const updated = automationEngine.updateAccountAutomationConfig(accountId, {
        enabled: false,
        mode: 'approval',
      });
      
      expect(updated.enabled).toBe(false);
      expect(updated.mode).toBe('approval');
      expect(updated.accountId).toBe(accountId);
    });

    it('应正确更新安全边界', () => {
      const accountId = 776;
      
      const updated = automationEngine.updateAccountAutomationConfig(accountId, {
        safetyBoundary: {
          maxBidChangePercent: 20,
          autoExecuteConfidence: 90,
        },
      });
      
      expect(updated.safetyBoundary.maxBidChangePercent).toBe(20);
      expect(updated.safetyBoundary.autoExecuteConfidence).toBe(90);
      // 其他值应保持默认
      expect(updated.safetyBoundary.maxBudgetChangePercent).toBe(50);
    });
  });

  describe('executeOptimization', () => {
    it('应在自动化禁用时阻止执行', async () => {
      const accountId = 666;
      automationEngine.updateAccountAutomationConfig(accountId, {
        enabled: false,
      });
      
      const result = await automationEngine.executeOptimization(
        accountId,
        'bid_adjustment',
        'keyword',
        1,
        'test keyword',
        1.0,
        1.2,
        85,
        '测试原因'
      );
      
      expect(result.status).toBe('blocked');
      expect(result.reason).toContain('禁用');
    });

    it('应在执行类型未启用时阻止执行', async () => {
      const accountId = 665;
      automationEngine.updateAccountAutomationConfig(accountId, {
        enabled: true,
        enabledTypes: ['budget_adjustment'], // 不包含bid_adjustment
      });
      
      const result = await automationEngine.executeOptimization(
        accountId,
        'bid_adjustment',
        'keyword',
        1,
        'test keyword',
        1.0,
        1.2,
        85,
        '测试原因'
      );
      
      expect(result.status).toBe('blocked');
      expect(result.reason).toContain('未启用');
    });

    it('应在调整幅度超过安全边界时阻止执行', async () => {
      const accountId = 664;
      automationEngine.updateAccountAutomationConfig(accountId, {
        enabled: true,
        safetyBoundary: {
          maxBidChangePercent: 10, // 最大10%
        },
      });
      
      const result = await automationEngine.executeOptimization(
        accountId,
        'bid_adjustment',
        'keyword',
        1,
        'test keyword',
        1.0,
        1.5, // 50%增幅，超过10%限制
        85,
        '测试原因'
      );
      
      expect(result.status).toBe('blocked');
      expect(result.reason).toContain('安全边界');
    });

    it('应在置信度不足时跳过执行', async () => {
      const accountId = 663;
      automationEngine.updateAccountAutomationConfig(accountId, {
        enabled: true,
        mode: 'full_auto',
        safetyBoundary: {
          autoExecuteConfidence: 90,
          supervisedConfidence: 70,
        },
      });
      
      const result = await automationEngine.executeOptimization(
        accountId,
        'bid_adjustment',
        'keyword',
        1,
        'test keyword',
        1.0,
        1.1,
        50, // 置信度50%，低于70%阈值
        '测试原因'
      );
      
      expect(result.status).toBe('skipped');
      expect(result.reason).toContain('置信度');
    });
  });

  describe('batchExecuteOptimizations', () => {
    it('应正确批量执行并返回汇总', async () => {
      const accountId = 555;
      automationEngine.updateAccountAutomationConfig(accountId, {
        enabled: true,
        mode: 'full_auto',
      });
      
      const optimizations = [
        {
          type: 'bid_adjustment' as const,
          targetType: 'keyword' as const,
          targetId: 1,
          targetName: 'keyword1',
          currentValue: 1.0,
          newValue: 1.1,
          confidence: 85,
          reason: '测试1',
        },
        {
          type: 'bid_adjustment' as const,
          targetType: 'keyword' as const,
          targetId: 2,
          targetName: 'keyword2',
          currentValue: 1.0,
          newValue: 1.1,
          confidence: 85,
          reason: '测试2',
        },
      ];
      
      const batch = await automationEngine.batchExecuteOptimizations(accountId, optimizations);
      
      expect(batch.accountId).toBe(accountId);
      expect(batch.totalItems).toBe(2);
      expect(batch.results.length).toBe(2);
    });
  });

  describe('getDailyExecutionStats', () => {
    it('应返回每日执行统计', () => {
      const accountId = 444;
      
      const stats = automationEngine.getDailyExecutionStats(accountId);
      
      expect(stats.date).toBeDefined();
      expect(stats.bidAdjustments).toBeGreaterThanOrEqual(0);
      expect(stats.budgetAdjustments).toBeGreaterThanOrEqual(0);
      expect(stats.remaining).toBeDefined();
    });
  });

  describe('emergencyStop', () => {
    it('应正确停止自动化', () => {
      const accountId = 333;
      automationEngine.updateAccountAutomationConfig(accountId, {
        enabled: true,
      });
      
      automationEngine.emergencyStop(accountId, '测试紧急停止');
      
      const config = automationEngine.getAccountAutomationConfig(accountId);
      expect(config.enabled).toBe(false);
    });
  });

  describe('resumeAutomation', () => {
    it('应正确恢复自动化', () => {
      const accountId = 222;
      automationEngine.updateAccountAutomationConfig(accountId, {
        enabled: false,
      });
      
      automationEngine.resumeAutomation(accountId);
      
      const config = automationEngine.getAccountAutomationConfig(accountId);
      expect(config.enabled).toBe(true);
    });
  });

  describe('安全边界检查', () => {
    it('应正确计算调整幅度', async () => {
      const accountId = 111;
      automationEngine.updateAccountAutomationConfig(accountId, {
        enabled: true,
        safetyBoundary: {
          maxBidChangePercent: 25,
        },
      });
      
      // 20%增幅，应该通过
      const result1 = await automationEngine.executeOptimization(
        accountId,
        'bid_adjustment',
        'keyword',
        1,
        'test',
        1.0,
        1.2, // 20%增幅
        85,
        '测试'
      );
      expect(result1.status).not.toBe('blocked');
      
      // 30%增幅，应该被阻止
      const result2 = await automationEngine.executeOptimization(
        accountId,
        'bid_adjustment',
        'keyword',
        2,
        'test2',
        1.0,
        1.3, // 30%增幅
        85,
        '测试'
      );
      expect(result2.status).toBe('blocked');
    });
  });

  describe('置信度阈值检查', () => {
    it('应根据置信度选择执行模式', async () => {
      const accountId = 100;
      automationEngine.updateAccountAutomationConfig(accountId, {
        enabled: true,
        mode: 'full_auto',
        safetyBoundary: {
          autoExecuteConfidence: 80,
          supervisedConfidence: 60,
        },
      });
      
      // 高置信度应自动执行
      const result1 = await automationEngine.executeOptimization(
        accountId,
        'bid_adjustment',
        'keyword',
        1,
        'test',
        1.0,
        1.1,
        85, // 高于80%
        '测试'
      );
      expect(result1.reason).toContain('自动执行');
      
      // 中等置信度应监督执行
      const result2 = await automationEngine.executeOptimization(
        accountId,
        'bid_adjustment',
        'keyword',
        2,
        'test2',
        1.0,
        1.1,
        70, // 60%-80%之间
        '测试'
      );
      expect(result2.reason).toContain('监督执行');
    });
  });
});

describe('默认配置', () => {
  it('DEFAULT_SAFETY_BOUNDARY应有合理的默认值', () => {
    const boundary = automationEngine.DEFAULT_SAFETY_BOUNDARY;
    
    expect(boundary.maxBidChangePercent).toBe(30);
    expect(boundary.maxBudgetChangePercent).toBe(50);
    expect(boundary.maxPlacementChangePercent).toBe(20);
    expect(boundary.maxDailyBidAdjustments).toBe(100);
    expect(boundary.maxDailyBudgetAdjustments).toBe(10);
    expect(boundary.maxDailyTotalAdjustments).toBe(150);
    expect(boundary.autoExecuteConfidence).toBe(80);
    expect(boundary.supervisedConfidence).toBe(60);
    expect(boundary.acosIncreaseThreshold).toBe(50);
    expect(boundary.spendOverrunThreshold).toBe(200);
    expect(boundary.conversionDropThreshold).toBe(70);
    expect(boundary.apiFailureThreshold).toBe(3);
  });

  it('DEFAULT_AUTOMATION_CONFIG应有合理的默认值', () => {
    const config = automationEngine.DEFAULT_AUTOMATION_CONFIG;
    
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('full_auto');
    expect(config.enabledTypes).toContain('bid_adjustment');
    expect(config.enabledTypes).toContain('budget_adjustment');
    expect(config.enabledTypes).toContain('auto_rollback');
    expect(config.scheduleConfig.syncTime).toBe('05:00');
    expect(config.notificationConfig.dailySummary).toBe(true);
  });
});
