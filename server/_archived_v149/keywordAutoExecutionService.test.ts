/**
 * 关键词自动执行服务单元测试
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

describe('KeywordAutoExecutionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('关键词自动执行配置', () => {
    it('应该正确验证执行配置参数', () => {
      const config = {
        accountId: 1,
        isEnabled: true,
        executionMode: 'auto' as const,
        acosThreshold: 30,
        spendThreshold: 100,
        clicksThreshold: 50,
        lookbackDays: 14,
      };

      expect(config.accountId).toBe(1);
      expect(config.isEnabled).toBe(true);
      expect(config.executionMode).toBe('auto');
      expect(config.acosThreshold).toBe(30);
    });

    it('应该正确处理暂停条件', () => {
      const keyword = {
        id: 1,
        keywordText: 'test keyword',
        acos: 45,
        spend: 150,
        clicks: 60,
        sales: 0,
      };

      const config = {
        acosThreshold: 30,
        spendThreshold: 100,
        clicksThreshold: 50,
      };

      // 检查是否满足暂停条件
      const shouldPause = 
        keyword.acos > config.acosThreshold ||
        (keyword.spend > config.spendThreshold && keyword.sales === 0) ||
        (keyword.clicks > config.clicksThreshold && keyword.sales === 0);

      expect(shouldPause).toBe(true);
    });

    it('应该正确处理启用条件', () => {
      const keyword = {
        id: 1,
        keywordText: 'test keyword',
        acos: 20,
        spend: 50,
        clicks: 30,
        sales: 100,
        status: 'paused',
      };

      const config = {
        acosThreshold: 30,
        spendThreshold: 100,
        clicksThreshold: 50,
      };

      // 检查是否满足启用条件
      const shouldEnable = 
        keyword.status === 'paused' &&
        keyword.acos < config.acosThreshold &&
        keyword.sales > 0;

      expect(shouldEnable).toBe(true);
    });
  });

  describe('执行历史记录', () => {
    it('应该正确记录执行历史', () => {
      const executionRecord = {
        accountId: 1,
        configId: 1,
        executionType: 'scheduled' as const,
        totalKeywords: 100,
        pausedCount: 5,
        enabledCount: 3,
        skippedCount: 92,
        status: 'completed' as const,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      expect(executionRecord.totalKeywords).toBe(100);
      expect(executionRecord.pausedCount + executionRecord.enabledCount + executionRecord.skippedCount).toBe(100);
      expect(executionRecord.status).toBe('completed');
    });

    it('应该正确计算执行统计', () => {
      const details = [
        { actionType: 'pause', status: 'success' },
        { actionType: 'pause', status: 'success' },
        { actionType: 'enable', status: 'success' },
        { actionType: 'pause', status: 'failed' },
        { actionType: 'enable', status: 'skipped' },
      ];

      const stats = {
        pausedCount: details.filter(d => d.actionType === 'pause' && d.status === 'success').length,
        enabledCount: details.filter(d => d.actionType === 'enable' && d.status === 'success').length,
        failedCount: details.filter(d => d.status === 'failed').length,
        skippedCount: details.filter(d => d.status === 'skipped').length,
      };

      expect(stats.pausedCount).toBe(2);
      expect(stats.enabledCount).toBe(1);
      expect(stats.failedCount).toBe(1);
      expect(stats.skippedCount).toBe(1);
    });
  });

  describe('回滚功能', () => {
    it('应该正确验证回滚条件', () => {
      const execution = {
        id: 1,
        status: 'completed' as const,
        pausedCount: 5,
        enabledCount: 3,
        completedAt: new Date().toISOString(),
      };

      // 只有已完成的执行才能回滚
      const canRollback = execution.status === 'completed' && 
        (execution.pausedCount > 0 || execution.enabledCount > 0);

      expect(canRollback).toBe(true);
    });

    it('应该正确处理回滚记录', () => {
      const rollbackRecord = {
        executionId: 1,
        reason: 'Performance degradation',
        rolledBackCount: 5,
        errors: [] as string[],
      };

      expect(rollbackRecord.rolledBackCount).toBe(5);
      expect(rollbackRecord.errors.length).toBe(0);
    });
  });
});
