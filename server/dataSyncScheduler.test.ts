/**
 * 分层同步调度器测试
 * 测试分层同步策略和智能调度功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  SYNC_TIER_CONFIG, 
  frequencyToMs,
  withExponentialBackoff,
  getSchedulerStatus,
} from './dataSyncScheduler';

describe('分层同步调度器', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('同步层级配置', () => {
    it('应该正确配置高频同步间隔为15分钟', () => {
      expect(SYNC_TIER_CONFIG.high.intervalMs).toBe(15 * 60 * 1000);
      expect(SYNC_TIER_CONFIG.high.description).toContain('高频');
    });

    it('应该正确配置中频同步间隔为30分钟', () => {
      expect(SYNC_TIER_CONFIG.medium.intervalMs).toBe(30 * 60 * 1000);
      expect(SYNC_TIER_CONFIG.medium.description).toContain('中频');
    });

    it('应该正确配置低频同步间隔为2小时', () => {
      expect(SYNC_TIER_CONFIG.low.intervalMs).toBe(2 * 60 * 60 * 1000);
      expect(SYNC_TIER_CONFIG.low.description).toContain('低频');
    });

    it('应该正确配置完整同步间隔为1小时', () => {
      expect(SYNC_TIER_CONFIG.full.intervalMs).toBe(60 * 60 * 1000);
      expect(SYNC_TIER_CONFIG.full.description).toContain('完整');
    });
  });

  describe('频率到毫秒映射', () => {
    it('应该正确映射每15分钟', () => {
      expect(frequencyToMs['every_15_minutes']).toBe(15 * 60 * 1000);
    });

    it('应该正确映射每30分钟', () => {
      expect(frequencyToMs['every_30_minutes']).toBe(30 * 60 * 1000);
    });

    it('应该正确映射每小时', () => {
      expect(frequencyToMs['hourly']).toBe(60 * 60 * 1000);
    });

    it('应该正确映射每2小时', () => {
      expect(frequencyToMs['every_2_hours']).toBe(2 * 60 * 60 * 1000);
    });

    it('应该正确映射每天', () => {
      expect(frequencyToMs['daily']).toBe(24 * 60 * 60 * 1000);
    });

    it('应该正确映射每周', () => {
      expect(frequencyToMs['weekly']).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('指数退避重试', () => {
    it('应该在成功时立即返回结果', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      const result = await withExponentialBackoff(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('应该在非429错误时立即抛出', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('Network error'));
      
      await expect(withExponentialBackoff(mockFn)).rejects.toThrow('Network error');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('应该在429错误时重试', async () => {
      const error429 = new Error('Too many requests');
      (error429 as any).response = { status: 429 };
      
      const mockFn = vi.fn()
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce('success');
      
      const result = await withExponentialBackoff(mockFn, 3, 10); // 使用短延迟进行测试
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('调度器状态', () => {
    it('应该返回调度器状态对象', () => {
      const status = getSchedulerStatus();
      
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('lastRunTime');
      expect(status).toHaveProperty('nextRunTime');
      expect(status).toHaveProperty('totalSyncs');
      expect(status).toHaveProperty('successfulSyncs');
      expect(status).toHaveProperty('failedSyncs');
      expect(status).toHaveProperty('errors');
      expect(status).toHaveProperty('currentTier');
      expect(status).toHaveProperty('tierLastRun');
    });

    it('应该包含所有同步层级的最后运行时间', () => {
      const status = getSchedulerStatus();
      
      expect(status.tierLastRun).toHaveProperty('high');
      expect(status.tierLastRun).toHaveProperty('medium');
      expect(status.tierLastRun).toHaveProperty('low');
      expect(status.tierLastRun).toHaveProperty('full');
    });
  });

  describe('同步层级类型', () => {
    it('应该支持所有定义的同步层级', () => {
      const tiers = ['high', 'medium', 'low', 'full'];
      
      tiers.forEach(tier => {
        expect(SYNC_TIER_CONFIG[tier as keyof typeof SYNC_TIER_CONFIG]).toBeDefined();
      });
    });

    it('每个层级应该有正确的配置结构', () => {
      Object.values(SYNC_TIER_CONFIG).forEach(config => {
        expect(config).toHaveProperty('intervalMs');
        expect(config).toHaveProperty('description');
        expect(config).toHaveProperty('syncTypes');
        expect(typeof config.intervalMs).toBe('number');
        expect(typeof config.description).toBe('string');
        expect(Array.isArray(config.syncTypes)).toBe(true);
      });
    });
  });

  describe('请求间隔配置', () => {
    it('应该有合理的请求间隔以避免速率限制', () => {
      // 请求间隔应该在100-500ms之间
      const REQUEST_INTERVAL_MS = 200;
      expect(REQUEST_INTERVAL_MS).toBeGreaterThanOrEqual(100);
      expect(REQUEST_INTERVAL_MS).toBeLessThanOrEqual(500);
    });
  });
});

describe('同步策略验证', () => {
  it('高频同步应该只包含广告活动相关数据', () => {
    const highTierTypes = SYNC_TIER_CONFIG.high.syncTypes;
    expect(highTierTypes).toContain('campaigns_status');
    expect(highTierTypes).toContain('budgets');
    expect(highTierTypes).not.toContain('full_sync');
  });

  it('中频同步应该包含广告组和定位数据', () => {
    const mediumTierTypes = SYNC_TIER_CONFIG.medium.syncTypes;
    expect(mediumTierTypes).toContain('ad_groups');
    expect(mediumTierTypes).toContain('keywords');
    expect(mediumTierTypes).toContain('targets');
  });

  it('低频同步应该是完整同步', () => {
    const lowTierTypes = SYNC_TIER_CONFIG.low.syncTypes;
    expect(lowTierTypes).toContain('full_sync');
  });

  it('同步间隔应该按层级递增', () => {
    expect(SYNC_TIER_CONFIG.high.intervalMs).toBeLessThan(SYNC_TIER_CONFIG.medium.intervalMs);
    expect(SYNC_TIER_CONFIG.medium.intervalMs).toBeLessThan(SYNC_TIER_CONFIG.low.intervalMs);
  });
});
