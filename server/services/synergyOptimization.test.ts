/**
 * 数据层与算法层协同优化测试
 * 测试专家建议的"快慢结合、分层治理"策略
 */

import { describe, it, expect } from 'vitest';

// 数据冻结区测试
import {
  DATA_FREEZING_CONFIG,
  isDataInFreezingZone,
  getRealtimeTrustedFields,
  getRealtimeUntrustedFields,
} from './dualTrackSyncService';

// 中央竞价协调器测试
import {
  COORDINATOR_CONFIG,
  createBidProposal,
  calculateSafeMaxBid,
  validateBidCombination,
} from './bidCoordinator';

// 日内调整服务测试
import {
  INTRADAY_CONFIG,
  calculateBudgetRunway,
} from './intradayPacingService';

describe('数据冻结区策略', () => {
  describe('配置验证', () => {
    it('归因延迟窗口应为48小时', () => {
      expect(DATA_FREEZING_CONFIG.attributionDelayHours).toBe(48);
    });

    it('分时策略应排除最近3天数据', () => {
      expect(DATA_FREEZING_CONFIG.daypartingExcludeDays).toBe(3);
    });

    it('竞价算法应排除最近1天数据', () => {
      expect(DATA_FREEZING_CONFIG.bidAlgorithmExcludeDays).toBe(1);
    });

    it('实时可信字段应只包含spend/clicks/impressions', () => {
      const trustedFields = getRealtimeTrustedFields();
      expect(trustedFields).toContain('spend');
      expect(trustedFields).toContain('clicks');
      expect(trustedFields).toContain('impressions');
      expect(trustedFields).not.toContain('sales');
      expect(trustedFields).not.toContain('roas');
    });

    it('实时不可信字段应包含sales/orders/roas/acos/cvr', () => {
      const untrustedFields = getRealtimeUntrustedFields();
      expect(untrustedFields).toContain('sales');
      expect(untrustedFields).toContain('orders');
      expect(untrustedFields).toContain('roas');
      expect(untrustedFields).toContain('acos');
      expect(untrustedFields).toContain('cvr');
    });
  });

  describe('冻结区检测', () => {
    it('今天的数据应在竞价算法冻结区内', () => {
      const today = new Date();
      expect(isDataInFreezingZone(today, 'bid')).toBe(true);
    });

    it('3天前的数据应不在分时策略冻结区内', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 4);
      expect(isDataInFreezingZone(threeDaysAgo, 'dayparting')).toBe(false);
    });
  });
});

describe('中央竞价协调器', () => {
  describe('配置验证', () => {
    it('最大允许CPC应为$5', () => {
      expect(COORDINATOR_CONFIG.maxAllowedCPC).toBe(5.0);
    });

    it('最大总乘数应为2.5', () => {
      expect(COORDINATOR_CONFIG.maxTotalMultiplier).toBe(2.5);
    });

    it('熔断后乘数上限应为1.5', () => {
      expect(COORDINATOR_CONFIG.circuitBreakerMultiplier).toBe(1.5);
    });
  });

  describe('安全出价计算', () => {
    it('应正确计算安全的最大Base Bid', () => {
      // 位置溢价50%，分时乘数1.5，最大CPC $5
      // 有效位置乘数 = 1 + 50/100 = 1.5
      // 安全Base Bid = 5 / (1.5 * 1.5) = 2.22
      const safeMaxBid = calculateSafeMaxBid(50, 1.5, 5);
      expect(safeMaxBid).toBeCloseTo(2.22, 1);
    });

    it('无位置溢价时安全出价更高', () => {
      const safeMaxBid = calculateSafeMaxBid(0, 1.5, 5);
      expect(safeMaxBid).toBeCloseTo(3.33, 1);
    });
  });

  describe('竞价组合验证', () => {
    it('应检测到超过CPC上限的组合', () => {
      // Base Bid $3，位置溢价100%，分时乘数1.5
      // 理论最高CPC = 3 * 1.5 * 2 = $9 > $5
      const result = validateBidCombination(3, 100, 1.5);
      expect(result.isValid).toBe(false);
      expect(result.theoreticalMaxCPC).toBe(9);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('应通过安全的竞价组合', () => {
      // Base Bid $1，位置溢价50%，分时乘数1.2
      // 理论最高CPC = 1 * 1.2 * 1.5 = $1.8 < $5
      const result = validateBidCombination(1, 50, 1.2);
      expect(result.isValid).toBe(true);
      expect(result.theoreticalMaxCPC).toBeCloseTo(1.8, 1);
    });
  });

  describe('竞价建议创建', () => {
    it('应正确创建竞价建议', () => {
      const proposal = createBidProposal(123, 'campaign', 'base_algo', {
        suggestedMultiplier: 1.2,
        confidence: 0.9,
        reason: '测试原因',
      });

      expect(proposal.targetId).toBe(123);
      expect(proposal.targetType).toBe('campaign');
      expect(proposal.source).toBe('base_algo');
      expect(proposal.suggestedMultiplier).toBe(1.2);
      expect(proposal.confidence).toBe(0.9);
      expect(proposal.reason).toBe('测试原因');
    });
  });
});

describe('日内调整服务', () => {
  describe('配置验证', () => {
    it('目标结束时间应为22点', () => {
      expect(INTRADAY_CONFIG.targetEndHour).toBe(22);
    });

    it('超支阈值应为1.5倍', () => {
      expect(INTRADAY_CONFIG.overspendingThreshold).toBe(1.5);
    });

    it('危急阈值应为2.0倍', () => {
      expect(INTRADAY_CONFIG.criticalThreshold).toBe(2.0);
    });

    it('点击欺诈阈值应为100次/小时', () => {
      expect(INTRADAY_CONFIG.clickFraudThreshold).toBe(100);
    });
  });

  describe('预算跑道计算', () => {
    it('应正确计算剩余预算可支撑时间', () => {
      const result = calculateBudgetRunway(
        100,  // 日预算$100
        50,   // 已花费$50
        12,   // 当前12点
        5     // 平均每小时$5
      );

      expect(result.remainingBudget).toBe(50);
      expect(result.hoursRemaining).toBe(10);
      expect(result.projectedEndHour).toBe(22);
      expect(result.willLastUntilTarget).toBe(true);
    });

    it('应检测到预算不足以撑到目标时间', () => {
      const result = calculateBudgetRunway(
        100,  // 日预算$100
        80,   // 已花费$80
        12,   // 当前12点
        10    // 平均每小时$10（花太快）
      );

      expect(result.remainingBudget).toBe(20);
      expect(result.hoursRemaining).toBe(2);
      expect(result.projectedEndHour).toBe(14);
      expect(result.willLastUntilTarget).toBe(false);
    });
  });
});

describe('Search Term T+1调度', () => {
  // 导入Search Term相关配置
  it('Search Term分析应配置为T+1任务', async () => {
    const { SEARCH_TERM_SCHEDULING } = await import('../trafficIsolationService');
    
    expect(SEARCH_TERM_SCHEDULING.dataSource).toBe('api_report');
    expect(SEARCH_TERM_SCHEDULING.analysisDateRange).toBe('yesterday');
    expect(SEARCH_TERM_SCHEDULING.allowRealtimeAnalysis).toBe(false);
    expect(SEARCH_TERM_SCHEDULING.recommendedHour).toBe(3);
  });
});
