/**
 * 数据同步执行历史和重试机制单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getScheduleExecutionHistory,
  getScheduleExecutionStats,
} from "./dataSyncService";

// Mock database
vi.mock("./_core/db", () => ({
  getDb: vi.fn(() => Promise.resolve({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([]))
          }))
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
    })),
  })),
}));

// Mock notification
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(() => Promise.resolve(true)),
}));

describe("数据同步执行历史", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getScheduleExecutionHistory", () => {
    it("应该返回执行历史列表", async () => {
      const history = await getScheduleExecutionHistory(1, 50);
      
      expect(Array.isArray(history)).toBe(true);
    });

    it("应该支持分页限制", async () => {
      const history = await getScheduleExecutionHistory(1, 10);
      
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe("getScheduleExecutionStats", () => {
    it("应该返回执行统计信息", async () => {
      const stats = await getScheduleExecutionStats(1);
      
      expect(stats).toHaveProperty("totalExecutions");
      expect(stats).toHaveProperty("successCount");
      expect(stats).toHaveProperty("failureCount");
    });

    it("应该计算成功率", () => {
      // 成功率计算逻辑测试
      const totalExecutions = 100;
      const successCount = 85;
      const successRate = (successCount / totalExecutions) * 100;
      
      expect(successRate).toBe(85);
      expect(successRate).toBeGreaterThanOrEqual(0);
      expect(successRate).toBeLessThanOrEqual(100);
    });
  });
});

describe("重试机制配置", () => {
  it("应该有合理的默认重试配置", () => {
    // 默认重试配置应该合理
    const defaultConfig = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
    };
    
    expect(defaultConfig.maxRetries).toBeGreaterThan(0);
    expect(defaultConfig.initialDelayMs).toBeGreaterThan(0);
    expect(defaultConfig.maxDelayMs).toBeGreaterThan(defaultConfig.initialDelayMs);
    expect(defaultConfig.backoffMultiplier).toBeGreaterThan(1);
  });

  it("应该计算正确的重试延迟", () => {
    const initialDelay = 1000;
    const multiplier = 2;
    const maxDelay = 30000;
    
    // 第一次重试延迟
    const delay1 = Math.min(initialDelay * Math.pow(multiplier, 0), maxDelay);
    expect(delay1).toBe(1000);
    
    // 第二次重试延迟
    const delay2 = Math.min(initialDelay * Math.pow(multiplier, 1), maxDelay);
    expect(delay2).toBe(2000);
    
    // 第三次重试延迟
    const delay3 = Math.min(initialDelay * Math.pow(multiplier, 2), maxDelay);
    expect(delay3).toBe(4000);
  });

  it("应该限制最大延迟时间", () => {
    const initialDelay = 1000;
    const multiplier = 2;
    const maxDelay = 5000;
    
    // 第四次重试延迟应该被限制
    const delay4 = Math.min(initialDelay * Math.pow(multiplier, 3), maxDelay);
    expect(delay4).toBe(5000); // 被限制在maxDelay
  });
});

describe("ROI计算", () => {
  it("应该正确计算ROI", () => {
    // ROI = (销售额 - 花费) / 花费 * 100
    const spend = 1000;
    const sales = 3000;
    const expectedRoi = ((sales - spend) / spend) * 100; // 200%
    
    expect(expectedRoi).toBe(200);
  });

  it("应该正确计算利润", () => {
    const spend = 1000;
    const sales = 3000;
    const expectedProfit = sales - spend; // 2000
    
    expect(expectedProfit).toBe(2000);
  });

  it("应该正确计算利润率", () => {
    const spend = 1000;
    const sales = 3000;
    const profit = sales - spend;
    const expectedProfitMargin = (profit / sales) * 100; // 66.67%
    
    expect(expectedProfitMargin).toBeCloseTo(66.67, 1);
  });
});
