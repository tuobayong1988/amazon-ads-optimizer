/**
 * Data Sync Schedule Service Tests - 数据同步定时调度服务测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateNextRunTime,
  type SyncScheduleConfig,
} from "./dataSyncService";

describe("DataSyncSchedule Service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe("calculateNextRunTime", () => {
    it("should calculate next run time for hourly schedule", () => {
      // 设置当前时间为 2026-01-06 10:30:00
      vi.setSystemTime(new Date(2026, 0, 6, 10, 30, 0));

      const config: SyncScheduleConfig = {
        userId: 1,
        accountId: 1,
        syncType: "all",
        frequency: "hourly",
        isEnabled: true,
      };

      const nextRun = calculateNextRunTime(config);
      
      // 下次执行应该是 11:00:00
      expect(nextRun.getHours()).toBe(11);
      expect(nextRun.getMinutes()).toBe(0);
      expect(nextRun.getSeconds()).toBe(0);
    });

    it("should calculate next run time for daily schedule", () => {
      // 设置当前时间为 2026-01-06 10:30:00
      vi.setSystemTime(new Date(2026, 0, 6, 10, 30, 0));

      const config: SyncScheduleConfig = {
        userId: 1,
        accountId: 1,
        syncType: "all",
        frequency: "daily",
        hour: 2, // 凌晨2点执行
        isEnabled: true,
      };

      const nextRun = calculateNextRunTime(config);
      
      // 因为当前是10:30，已经过了2点，所以下次执行应该是明天2点
      expect(nextRun.getDate()).toBe(7);
      expect(nextRun.getHours()).toBe(2);
      expect(nextRun.getMinutes()).toBe(0);
    });

    it("should calculate next run time for daily schedule when hour is later today", () => {
      // 设置当前时间为 2026-01-06 10:30:00
      vi.setSystemTime(new Date(2026, 0, 6, 10, 30, 0));

      const config: SyncScheduleConfig = {
        userId: 1,
        accountId: 1,
        syncType: "all",
        frequency: "daily",
        hour: 14, // 下午2点执行
        isEnabled: true,
      };

      const nextRun = calculateNextRunTime(config);
      
      // 因为当前是10:30，还没到14点，所以下次执行应该是今天14点
      expect(nextRun.getDate()).toBe(6);
      expect(nextRun.getHours()).toBe(14);
    });

    it("should calculate next run time for weekly schedule", () => {
      // 设置当前时间为 2026-01-06 (周二) 10:30:00
      vi.setSystemTime(new Date(2026, 0, 6, 10, 30, 0));

      const config: SyncScheduleConfig = {
        userId: 1,
        accountId: 1,
        syncType: "all",
        frequency: "weekly",
        hour: 2,
        dayOfWeek: 5, // 周五
        isEnabled: true,
      };

      const nextRun = calculateNextRunTime(config);
      
      // 当前是周二，下次执行应该是周五
      expect(nextRun.getDay()).toBe(5);
      expect(nextRun.getHours()).toBe(2);
    });

    it("should calculate next run time for monthly schedule", () => {
      // 设置当前时间为 2026-01-06 10:30:00
      vi.setSystemTime(new Date(2026, 0, 6, 10, 30, 0));

      const config: SyncScheduleConfig = {
        userId: 1,
        accountId: 1,
        syncType: "all",
        frequency: "monthly",
        hour: 2,
        dayOfMonth: 15, // 每月15号
        isEnabled: true,
      };

      const nextRun = calculateNextRunTime(config);
      
      // 当前是6号，下次执行应该是本月15号
      expect(nextRun.getDate()).toBe(15);
      expect(nextRun.getMonth()).toBe(0); // 1月
      expect(nextRun.getHours()).toBe(2);
    });

    it("should calculate next run time for monthly schedule when day has passed", () => {
      // 设置当前时间为 2026-01-20 10:30:00
      vi.setSystemTime(new Date(2026, 0, 20, 10, 30, 0));

      const config: SyncScheduleConfig = {
        userId: 1,
        accountId: 1,
        syncType: "all",
        frequency: "monthly",
        hour: 2,
        dayOfMonth: 15, // 每月15号
        isEnabled: true,
      };

      const nextRun = calculateNextRunTime(config);
      
      // 当前是20号，已经过了15号，所以下次执行应该是下个月15号
      expect(nextRun.getDate()).toBe(15);
      expect(nextRun.getMonth()).toBe(1); // 2月
    });
  });

  describe("Schedule Configuration Validation", () => {
    it("should use default hour 0 when not specified for daily schedule", () => {
      vi.setSystemTime(new Date(2026, 0, 6, 10, 30, 0));

      const config: SyncScheduleConfig = {
        userId: 1,
        accountId: 1,
        syncType: "all",
        frequency: "daily",
        isEnabled: true,
        // hour not specified
      };

      const nextRun = calculateNextRunTime(config);
      
      // 应该使用默认的0点
      expect(nextRun.getHours()).toBe(0);
    });

    it("should handle all sync types", () => {
      const syncTypes: Array<"campaigns" | "keywords" | "performance" | "all"> = [
        "campaigns",
        "keywords",
        "performance",
        "all",
      ];

      syncTypes.forEach((syncType) => {
        const config: SyncScheduleConfig = {
          userId: 1,
          accountId: 1,
          syncType,
          frequency: "daily",
          hour: 2,
          isEnabled: true,
        };

        // 应该不会抛出错误
        expect(() => calculateNextRunTime(config)).not.toThrow();
      });
    });

    it("should handle all frequency types", () => {
      const frequencies: Array<"hourly" | "daily" | "weekly" | "monthly"> = [
        "hourly",
        "daily",
        "weekly",
        "monthly",
      ];

      vi.setSystemTime(new Date(2026, 0, 6, 10, 30, 0));

      frequencies.forEach((frequency) => {
        const config: SyncScheduleConfig = {
          userId: 1,
          accountId: 1,
          syncType: "all",
          frequency,
          hour: 2,
          dayOfWeek: 1,
          dayOfMonth: 15,
          isEnabled: true,
        };

        const nextRun = calculateNextRunTime(config);
        
        // 应该返回有效的Date对象
        expect(nextRun).toBeInstanceOf(Date);
        expect(nextRun.getTime()).toBeGreaterThan(Date.now());
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle end of month correctly for monthly schedule", () => {
      // 设置当前时间为 2026-01-31 10:30:00
      vi.setSystemTime(new Date(2026, 0, 31, 10, 30, 0));

      const config: SyncScheduleConfig = {
        userId: 1,
        accountId: 1,
        syncType: "all",
        frequency: "monthly",
        hour: 2,
        dayOfMonth: 15,
        isEnabled: true,
      };

      const nextRun = calculateNextRunTime(config);
      
      // 应该是下个月15号
      expect(nextRun.getMonth()).toBe(1); // 2月
      expect(nextRun.getDate()).toBe(15);
    });

    it("should handle year boundary correctly", () => {
      // 设置当前时间为 2025-12-31 23:30:00
      vi.setSystemTime(new Date(2025, 11, 31, 23, 30, 0));

      const config: SyncScheduleConfig = {
        userId: 1,
        accountId: 1,
        syncType: "all",
        frequency: "hourly",
        isEnabled: true,
      };

      const nextRun = calculateNextRunTime(config);
      
      // 应该是2026年1月1日0点
      expect(nextRun.getFullYear()).toBe(2026);
      expect(nextRun.getMonth()).toBe(0);
      expect(nextRun.getDate()).toBe(1);
      expect(nextRun.getHours()).toBe(0);
    });

    it("should handle weekly schedule at week boundary", () => {
      // 设置当前时间为 2026-01-04 (周日) 10:30:00
      vi.setSystemTime(new Date(2026, 0, 4, 10, 30, 0));

      const config: SyncScheduleConfig = {
        userId: 1,
        accountId: 1,
        syncType: "all",
        frequency: "weekly",
        hour: 2,
        dayOfWeek: 0, // 周日
        isEnabled: true,
      };

      const nextRun = calculateNextRunTime(config);
      
      // 当前是周日10:30，已经过了2点，所以下次应该是下周日
      expect(nextRun.getDay()).toBe(0);
      expect(nextRun.getDate()).toBe(11); // 下周日
    });
  });
});
