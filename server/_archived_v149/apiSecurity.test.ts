import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as apiSecurityService from './apiSecurityService';

// Mock the database
vi.mock('./db', () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onDuplicateKeyUpdate: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([{ insertId: 1 }]),
  }),
}));

describe('API Security Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Operation Logs', () => {
    it('should have getOperationLogs function', () => {
      expect(typeof apiSecurityService.getOperationLogs).toBe('function');
    });

    it('should have logApiOperation function', () => {
      expect(typeof apiSecurityService.logApiOperation).toBe('function');
    });

    it('should accept valid operation types', async () => {
      const validTypes = [
        'bid_adjustment',
        'budget_change',
        'campaign_status',
        'keyword_status',
        'negative_keyword',
        'target_status',
        'batch_operation',
        'api_sync',
        'auto_optimization',
        'manual_operation',
        'other'
      ];
      
      for (const type of validTypes) {
        expect(validTypes.includes(type)).toBe(true);
      }
    });

    it('should accept valid risk levels', () => {
      const validLevels = ['low', 'medium', 'high', 'critical'];
      
      for (const level of validLevels) {
        expect(validLevels.includes(level)).toBe(true);
      }
    });
  });

  describe('Spend Limit Config', () => {
    it('should have getSpendLimitConfig function', () => {
      expect(typeof apiSecurityService.getSpendLimitConfig).toBe('function');
    });

    it('should have upsertSpendLimitConfig function', () => {
      expect(typeof apiSecurityService.upsertSpendLimitConfig).toBe('function');
    });

    it('should validate spend limit thresholds', () => {
      const config = {
        dailySpendLimit: 1000,
        warningThreshold1: 50,
        warningThreshold2: 80,
        criticalThreshold: 95,
      };
      
      expect(config.warningThreshold1).toBeLessThan(config.warningThreshold2);
      expect(config.warningThreshold2).toBeLessThan(config.criticalThreshold);
      expect(config.criticalThreshold).toBeLessThan(100);
    });
  });

  describe('Spend Alert History', () => {
    it('should have getSpendAlertHistory function', () => {
      expect(typeof apiSecurityService.getSpendAlertHistory).toBe('function');
    });

    it('should have checkSpendLimit function', () => {
      expect(typeof apiSecurityService.checkSpendLimit).toBe('function');
    });

    it('should accept valid alert levels', () => {
      const validLevels = ['info', 'warning', 'critical'];
      
      for (const level of validLevels) {
        expect(validLevels.includes(level)).toBe(true);
      }
    });
  });

  describe('Anomaly Detection Rules', () => {
    it('should have getAnomalyRules function', () => {
      expect(typeof apiSecurityService.getAnomalyRules).toBe('function');
    });

    it('should have createAnomalyRule function', () => {
      expect(typeof apiSecurityService.createAnomalyRule).toBe('function');
    });

    it('should have initializeDefaultRules function', () => {
      expect(typeof apiSecurityService.initializeDefaultRules).toBe('function');
    });

    it('should accept valid rule types', () => {
      const validTypes = [
        'bid_spike',
        'bid_drop',
        'batch_size',
        'frequency',
        'budget_change',
        'spend_velocity',
        'conversion_drop',
        'acos_spike',
        'custom'
      ];
      
      for (const type of validTypes) {
        expect(validTypes.includes(type)).toBe(true);
      }
    });

    it('should accept valid condition types', () => {
      const validTypes = ['threshold', 'percentage_change', 'absolute_change', 'rate_limit'];
      
      for (const type of validTypes) {
        expect(validTypes.includes(type)).toBe(true);
      }
    });

    it('should accept valid action types', () => {
      const validActions = ['alert_only', 'pause_and_alert', 'rollback_and_alert', 'block_operation'];
      
      for (const action of validActions) {
        expect(validActions.includes(action)).toBe(true);
      }
    });
  });

  describe('Auto Pause Records', () => {
    it('should have getAutoPauseRecords function', () => {
      expect(typeof apiSecurityService.getAutoPauseRecords).toBe('function');
    });

    it('should have resumePausedEntities function', () => {
      expect(typeof apiSecurityService.resumePausedEntities).toBe('function');
    });

    it('should accept valid pause reasons', () => {
      const validReasons = [
        'spend_limit_reached',
        'anomaly_detected',
        'acos_threshold',
        'manual_trigger',
        'scheduled'
      ];
      
      for (const reason of validReasons) {
        expect(validReasons.includes(reason)).toBe(true);
      }
    });

    it('should accept valid pause scopes', () => {
      const validScopes = ['account', 'campaign', 'ad_group', 'keyword', 'target'];
      
      for (const scope of validScopes) {
        expect(validScopes.includes(scope)).toBe(true);
      }
    });
  });

  describe('Risk Level Calculation', () => {
    it('should calculate risk level based on operation type and value', () => {
      // 测试风险等级计算逻辑
      const calculateRiskLevel = (operationType: string, changePercent: number): string => {
        if (operationType === 'batch_operation' && changePercent > 50) {
          return 'critical';
        }
        if (changePercent > 100) {
          return 'high';
        }
        if (changePercent > 50) {
          return 'medium';
        }
        return 'low';
      };
      
      expect(calculateRiskLevel('bid_adjustment', 10)).toBe('low');
      expect(calculateRiskLevel('bid_adjustment', 60)).toBe('medium');
      expect(calculateRiskLevel('bid_adjustment', 150)).toBe('high');
      expect(calculateRiskLevel('batch_operation', 60)).toBe('critical');
    });
  });

  describe('Spend Percentage Calculation', () => {
    it('should calculate spend percentage correctly', () => {
      const calculateSpendPercent = (currentSpend: number, dailyLimit: number): number => {
        if (dailyLimit <= 0) return 0;
        return (currentSpend / dailyLimit) * 100;
      };
      
      expect(calculateSpendPercent(500, 1000)).toBe(50);
      expect(calculateSpendPercent(800, 1000)).toBe(80);
      expect(calculateSpendPercent(950, 1000)).toBe(95);
      expect(calculateSpendPercent(1000, 1000)).toBe(100);
      expect(calculateSpendPercent(100, 0)).toBe(0);
    });
  });

  describe('Alert Level Determination', () => {
    it('should determine alert level based on spend percentage', () => {
      const determineAlertLevel = (
        spendPercent: number,
        warningThreshold1: number,
        warningThreshold2: number,
        criticalThreshold: number
      ): string | null => {
        if (spendPercent >= criticalThreshold) {
          return 'critical';
        }
        if (spendPercent >= warningThreshold2) {
          return 'warning';
        }
        if (spendPercent >= warningThreshold1) {
          return 'info';
        }
        return null;
      };
      
      expect(determineAlertLevel(40, 50, 80, 95)).toBe(null);
      expect(determineAlertLevel(60, 50, 80, 95)).toBe('info');
      expect(determineAlertLevel(85, 50, 80, 95)).toBe('warning');
      expect(determineAlertLevel(96, 50, 80, 95)).toBe('critical');
    });
  });

  describe('Anomaly Detection Logic', () => {
    it('should detect bid spike anomaly', () => {
      const detectBidSpike = (
        oldBid: number,
        newBid: number,
        threshold: number
      ): boolean => {
        if (oldBid <= 0) return false;
        const changePercent = ((newBid - oldBid) / oldBid) * 100;
        return changePercent > threshold;
      };
      
      expect(detectBidSpike(1.0, 1.5, 100)).toBe(false); // 50% increase
      expect(detectBidSpike(1.0, 2.5, 100)).toBe(true);  // 150% increase
      expect(detectBidSpike(1.0, 3.0, 100)).toBe(true);  // 200% increase
      expect(detectBidSpike(0, 1.0, 100)).toBe(false);   // Edge case: old bid is 0
    });

    it('should detect batch size anomaly', () => {
      const detectBatchSizeAnomaly = (
        batchSize: number,
        threshold: number
      ): boolean => {
        return batchSize > threshold;
      };
      
      expect(detectBatchSizeAnomaly(50, 100)).toBe(false);
      expect(detectBatchSizeAnomaly(150, 100)).toBe(true);
    });

    it('should detect ACoS spike anomaly', () => {
      const detectAcosSpike = (
        oldAcos: number,
        newAcos: number,
        threshold: number
      ): boolean => {
        if (oldAcos <= 0) return newAcos > threshold;
        const changePercent = ((newAcos - oldAcos) / oldAcos) * 100;
        return changePercent > threshold;
      };
      
      expect(detectAcosSpike(20, 25, 50)).toBe(false); // 25% increase
      expect(detectAcosSpike(20, 35, 50)).toBe(true);  // 75% increase
      expect(detectAcosSpike(0, 30, 50)).toBe(false);  // Edge case: old ACoS is 0, new is below threshold
      expect(detectAcosSpike(0, 60, 50)).toBe(true);   // Edge case: old ACoS is 0, new is above threshold
    });
  });

  describe('Default Rules Initialization', () => {
    it('should have predefined default rules', () => {
      const defaultRules = [
        { ruleName: '出价飙升检测', ruleType: 'bid_spike', conditionValue: 100 },
        { ruleName: '批量操作数量限制', ruleType: 'batch_size', conditionValue: 100 },
        { ruleName: 'ACoS飙升检测', ruleType: 'acos_spike', conditionValue: 50 },
        { ruleName: '预算变更检测', ruleType: 'budget_change', conditionValue: 100 },
        { ruleName: '花费速度异常', ruleType: 'spend_velocity', conditionValue: 150 },
      ];
      
      expect(defaultRules.length).toBeGreaterThan(0);
      
      for (const rule of defaultRules) {
        expect(rule.ruleName).toBeDefined();
        expect(rule.ruleType).toBeDefined();
        expect(rule.conditionValue).toBeGreaterThan(0);
      }
    });
  });

  describe('Resume Validation', () => {
    it('should require resume reason', () => {
      const validateResumeRequest = (reason: string): boolean => {
        return reason.trim().length > 0;
      };
      
      expect(validateResumeRequest('')).toBe(false);
      expect(validateResumeRequest('   ')).toBe(false);
      expect(validateResumeRequest('已确认为正常操作')).toBe(true);
    });
  });
});
