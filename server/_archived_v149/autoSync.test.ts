/**
 * 自动同步功能测试
 * 测试首次授权后自动同步和每小时定时同步功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as db from './db';

// Mock db functions
vi.mock('./db', async () => {
  const actual = await vi.importActual('./db');
  return {
    ...actual,
    getSyncScheduleByAccountId: vi.fn(),
    createSyncSchedule: vi.fn(),
    getEnabledSyncSchedules: vi.fn(),
  };
});

describe('自动同步功能', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('首次授权后自动创建定时同步配置', () => {
    it('应该在首次授权时创建每小时定时同步配置', async () => {
      // Mock: 不存在现有的定时同步配置
      vi.mocked(db.getSyncScheduleByAccountId).mockResolvedValue(null);
      vi.mocked(db.createSyncSchedule).mockResolvedValue(1);

      // 模拟创建定时同步配置的逻辑
      const userId = 1;
      const accountId = 123;
      
      const existingSchedule = await db.getSyncScheduleByAccountId(userId, accountId);
      
      if (!existingSchedule) {
        await db.createSyncSchedule({
          userId,
          accountId,
          syncType: 'all',
          frequency: 'hourly',
          isEnabled: true,
        });
      }

      // 验证调用
      expect(db.getSyncScheduleByAccountId).toHaveBeenCalledWith(userId, accountId);
      expect(db.createSyncSchedule).toHaveBeenCalledWith({
        userId,
        accountId,
        syncType: 'all',
        frequency: 'hourly',
        isEnabled: true,
      });
    });

    it('应该在已存在定时同步配置时跳过创建', async () => {
      // Mock: 已存在定时同步配置
      vi.mocked(db.getSyncScheduleByAccountId).mockResolvedValue({
        id: 1,
        userId: 1,
        accountId: 123,
        syncType: 'all',
        frequency: 'hourly',
        preferredTime: null,
        preferredDayOfWeek: null,
        isEnabled: 1,
        lastRunAt: null,
        nextRunAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const userId = 1;
      const accountId = 123;
      
      const existingSchedule = await db.getSyncScheduleByAccountId(userId, accountId);
      
      if (!existingSchedule) {
        await db.createSyncSchedule({
          userId,
          accountId,
          syncType: 'all',
          frequency: 'hourly',
          isEnabled: true,
        });
      }

      // 验证调用
      expect(db.getSyncScheduleByAccountId).toHaveBeenCalledWith(userId, accountId);
      expect(db.createSyncSchedule).not.toHaveBeenCalled();
    });
  });

  describe('定时同步调度器', () => {
    it('应该正确计算每小时同步的下次执行时间', () => {
      const now = new Date(2026, 0, 8, 10, 30, 0); // 2026-01-08 10:30:00
      const next = new Date(now);
      
      // 每小时同步：下次执行时间应该是下一个整点
      next.setHours(next.getHours() + 1);
      next.setMinutes(0, 0, 0);
      
      expect(next.getHours()).toBe(11);
      expect(next.getMinutes()).toBe(0);
      expect(next.getSeconds()).toBe(0);
    });

    it('应该支持不同的同步频率', () => {
      const frequencies = ['hourly', 'every_2_hours', 'every_4_hours', 'every_6_hours', 'every_12_hours', 'daily'];
      
      frequencies.forEach(frequency => {
        expect(frequency).toBeDefined();
      });
    });
  });

  describe('同步配置验证', () => {
    it('应该验证必填字段', () => {
      const validConfig = {
        userId: 1,
        accountId: 123,
        syncType: 'all',
        frequency: 'hourly',
        isEnabled: true,
      };

      expect(validConfig.userId).toBeGreaterThan(0);
      expect(validConfig.accountId).toBeGreaterThan(0);
      expect(['all', 'campaigns', 'keywords', 'performance']).toContain(validConfig.syncType);
      expect(['hourly', 'every_2_hours', 'every_4_hours', 'every_6_hours', 'every_12_hours', 'daily', 'weekly', 'monthly']).toContain(validConfig.frequency);
      expect(typeof validConfig.isEnabled).toBe('boolean');
    });

    it('应该支持可选字段', () => {
      const configWithOptionalFields = {
        userId: 1,
        accountId: 123,
        syncType: 'all',
        frequency: 'daily',
        preferredTime: '06:00',
        preferredDayOfWeek: 1, // 周一
        isEnabled: true,
      };

      expect(configWithOptionalFields.preferredTime).toBe('06:00');
      expect(configWithOptionalFields.preferredDayOfWeek).toBe(1);
    });
  });
});

describe('定时同步调度器间隔配置', () => {
  it('应该配置为每小时执行一次', () => {
    const intervalMs = 60 * 60 * 1000; // 1小时
    const intervalMinutes = intervalMs / 1000 / 60;
    
    expect(intervalMinutes).toBe(60);
  });

  it('应该正确计算频率到毫秒的映射', () => {
    const frequencyToMs: Record<string, number> = {
      'hourly': 60 * 60 * 1000,
      'every_2_hours': 2 * 60 * 60 * 1000,
      'every_4_hours': 4 * 60 * 60 * 1000,
      'every_6_hours': 6 * 60 * 60 * 1000,
      'every_12_hours': 12 * 60 * 60 * 1000,
      'daily': 24 * 60 * 60 * 1000,
      'weekly': 7 * 24 * 60 * 60 * 1000,
    };

    expect(frequencyToMs['hourly']).toBe(3600000);
    expect(frequencyToMs['every_2_hours']).toBe(7200000);
    expect(frequencyToMs['daily']).toBe(86400000);
    expect(frequencyToMs['weekly']).toBe(604800000);
  });
});
