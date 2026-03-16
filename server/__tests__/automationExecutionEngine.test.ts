/**
 * v272 P0-2: automationExecutionEngine 核心模块单元测试
 * 
 * 测试覆盖：
 * 1. getAccountAutomationConfig — 账号自动化配置管理
 * 2. updateAccountAutomationConfig — 配置更新
 * 3. getDailyExecutionStats — 每日执行统计
 * 4. emergencyStop / resumeAutomation — 紧急停止和恢复
 * 5. DEFAULT_SAFETY_BOUNDARY — 默认安全边界验证
 * 6. DEFAULT_AUTOMATION_CONFIG — 默认自动化配置验证
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock依赖
vi.mock('../db', () => ({
  getDb: vi.fn().mockReturnValue(null),
  getAdAccountById: vi.fn().mockResolvedValue({ marketplace: 'US' }),
}));

vi.mock('../notificationService', () => ({
  sendNotification: vi.fn().mockResolvedValue(true),
  isQuietHours: vi.fn().mockReturnValue(false),
  defaultNotificationConfig: {},
  analyzeHealthMetrics: vi.fn(),
  sendBatchAlerts: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../optimizationTargetEngine', () => ({
  executeOptimizationTarget: vi.fn(),
  getOptimizationTargetConfig: vi.fn(),
}));

vi.mock('../services/trafficIsolationService', () => ({
  analyzeNGrams: vi.fn(),
  analyzeFunnelStages: vi.fn(),
  analyzeKeywordMigration: vi.fn(),
}));

vi.mock('../services/searchTermHarvestService', () => ({
  harvestSearchTerms: vi.fn(),
}));

vi.mock('../services/funnelMigrationService', () => ({
  analyzeFunnelMigration: vi.fn(),
}));

vi.mock('../optimizationSafetyGuardrails', () => ({
  preOptimizationSafetyCheck: vi.fn().mockReturnValue({ safe: true }),
  SAFETY_LIMITS: { maxBidChangePercent: 30 },
}));

import {
  getAccountAutomationConfig,
  updateAccountAutomationConfig,
  getDailyExecutionStats,
  emergencyStop,
  resumeAutomation,
  DEFAULT_SAFETY_BOUNDARY,
  DEFAULT_AUTOMATION_CONFIG,
} from '../automation/automationExecutionEngine';

describe('AutomationExecutionEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DEFAULT_SAFETY_BOUNDARY', () => {
    it('应有合理的单次调整限制', () => {
      expect(DEFAULT_SAFETY_BOUNDARY.maxBidChangePercent).toBe(30);
      expect(DEFAULT_SAFETY_BOUNDARY.maxBudgetChangePercent).toBe(50);
      expect(DEFAULT_SAFETY_BOUNDARY.maxPlacementChangePercent).toBe(20);
    });

    it('应有合理的每日调整限制', () => {
      expect(DEFAULT_SAFETY_BOUNDARY.maxDailyBidAdjustments).toBe(100);
      expect(DEFAULT_SAFETY_BOUNDARY.maxDailyBudgetAdjustments).toBe(10);
      expect(DEFAULT_SAFETY_BOUNDARY.maxDailyTotalAdjustments).toBe(150);
    });

    it('应有合理的置信度阈值', () => {
      expect(DEFAULT_SAFETY_BOUNDARY.autoExecuteConfidence).toBe(80);
      expect(DEFAULT_SAFETY_BOUNDARY.supervisedConfidence).toBe(60);
      expect(DEFAULT_SAFETY_BOUNDARY.autoExecuteConfidence).toBeGreaterThan(DEFAULT_SAFETY_BOUNDARY.supervisedConfidence);
    });

    it('应有合理的紧急停止条件', () => {
      expect(DEFAULT_SAFETY_BOUNDARY.acosIncreaseThreshold).toBe(50);
      expect(DEFAULT_SAFETY_BOUNDARY.spendOverrunThreshold).toBe(200);
      expect(DEFAULT_SAFETY_BOUNDARY.conversionDropThreshold).toBe(70);
      expect(DEFAULT_SAFETY_BOUNDARY.apiFailureThreshold).toBe(3);
    });
  });

  describe('DEFAULT_AUTOMATION_CONFIG', () => {
    it('应默认启用自动化', () => {
      expect(DEFAULT_AUTOMATION_CONFIG.enabled).toBe(true);
    });

    it('应默认为全自动模式', () => {
      expect(DEFAULT_AUTOMATION_CONFIG.mode).toBe('full_auto');
    });

    it('应包含所有核心执行类型', () => {
      expect(DEFAULT_AUTOMATION_CONFIG.enabledTypes).toContain('bid_adjustment');
      expect(DEFAULT_AUTOMATION_CONFIG.enabledTypes).toContain('budget_adjustment');
      expect(DEFAULT_AUTOMATION_CONFIG.enabledTypes).toContain('placement_tilt');
      expect(DEFAULT_AUTOMATION_CONFIG.enabledTypes).toContain('negative_keyword');
      expect(DEFAULT_AUTOMATION_CONFIG.enabledTypes).toContain('dayparting');
    });

    it('应包含v272新增的dayparting执行类型', () => {
      expect(DEFAULT_AUTOMATION_CONFIG.enabledTypes).toContain('dayparting');
    });
  });

  describe('getAccountAutomationConfig', () => {
    it('应为新账号返回默认配置', () => {
      const config = getAccountAutomationConfig(99999);
      
      expect(config.accountId).toBe(99999);
      expect(config.enabled).toBe(true);
      expect(config.mode).toBe('full_auto');
      expect(config.safetyBoundary).toBeDefined();
      expect(config.safetyBoundary.maxBidChangePercent).toBe(30);
    });

    it('应缓存并返回相同的配置实例', () => {
      const config1 = getAccountAutomationConfig(88888);
      const config2 = getAccountAutomationConfig(88888);
      
      expect(config1).toBe(config2);
    });

    it('不同账号应有独立的配置', () => {
      const config1 = getAccountAutomationConfig(77777);
      const config2 = getAccountAutomationConfig(66666);
      
      expect(config1.accountId).toBe(77777);
      expect(config2.accountId).toBe(66666);
      expect(config1).not.toBe(config2);
    });
  });

  describe('updateAccountAutomationConfig', () => {
    it('应正确更新配置', () => {
      const updated = updateAccountAutomationConfig(55555, {
        enabled: false,
        mode: 'supervised',
      });
      
      expect(updated.accountId).toBe(55555);
      expect(updated.enabled).toBe(false);
      expect(updated.mode).toBe('supervised');
    });

    it('应保留未更新的字段', () => {
      getAccountAutomationConfig(44444); // 初始化
      const updated = updateAccountAutomationConfig(44444, {
        enabled: false,
      });
      
      expect(updated.enabled).toBe(false);
      expect(updated.mode).toBe('full_auto'); // 未更新的字段保持默认
      expect(updated.safetyBoundary.maxBidChangePercent).toBe(30);
    });

    it('应支持部分更新安全边界', () => {
      const updated = updateAccountAutomationConfig(33333, {
        safetyBoundary: {
          maxBidChangePercent: 15,
        } as any,
      });
      
      expect(updated.safetyBoundary.maxBidChangePercent).toBe(15);
      expect(updated.safetyBoundary.maxDailyBidAdjustments).toBe(100); // 其他字段保持
    });

    it('更新后再次获取应返回更新后的配置', () => {
      updateAccountAutomationConfig(22222, { enabled: false });
      const config = getAccountAutomationConfig(22222);
      
      expect(config.enabled).toBe(false);
    });
  });

  describe('getDailyExecutionStats', () => {
    it('应返回正确的统计结构', () => {
      const stats = getDailyExecutionStats(11111);
      
      expect(stats).toHaveProperty('date');
      expect(stats).toHaveProperty('bidAdjustments');
      expect(stats).toHaveProperty('budgetAdjustments');
      expect(stats).toHaveProperty('totalAdjustments');
      expect(stats).toHaveProperty('remaining');
      expect(stats.remaining).toHaveProperty('bidAdjustments');
      expect(stats.remaining).toHaveProperty('budgetAdjustments');
      expect(stats.remaining).toHaveProperty('totalAdjustments');
    });

    it('新账号应有零执行计数', () => {
      const stats = getDailyExecutionStats(10001);
      
      expect(stats.bidAdjustments).toBe(0);
      expect(stats.budgetAdjustments).toBe(0);
      expect(stats.totalAdjustments).toBe(0);
    });

    it('新账号应有满额剩余配额', () => {
      const stats = getDailyExecutionStats(10002);
      
      expect(stats.remaining.bidAdjustments).toBe(100);
      expect(stats.remaining.budgetAdjustments).toBe(10);
      expect(stats.remaining.totalAdjustments).toBe(150);
    });

    it('应支持指定日期查询', () => {
      const date = new Date('2026-01-15');
      const stats = getDailyExecutionStats(10003, date);
      
      expect(stats.date).toBe('2026-01-15');
    });
  });

  describe('emergencyStop / resumeAutomation', () => {
    it('emergencyStop应禁用账号自动化', () => {
      getAccountAutomationConfig(9001); // 初始化
      emergencyStop(9001, '测试紧急停止');
      
      const config = getAccountAutomationConfig(9001);
      expect(config.enabled).toBe(false);
    });

    it('resumeAutomation应重新启用账号自动化', () => {
      emergencyStop(9002, '测试');
      expect(getAccountAutomationConfig(9002).enabled).toBe(false);
      
      resumeAutomation(9002);
      expect(getAccountAutomationConfig(9002).enabled).toBe(true);
    });

    it('emergencyStop应禁用账号并可恢复', () => {
      // emergencyStop内部调用notificationService但由于import *方式的mock限制
      // 我们验证核心功能：禁用后可恢复
      emergencyStop(9003, '测试通知');
      expect(getAccountAutomationConfig(9003).enabled).toBe(false);
      
      resumeAutomation(9003);
      expect(getAccountAutomationConfig(9003).enabled).toBe(true);
    });
  });
});
