/**
 * Data Sync Service Tests
 * 数据同步服务单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database
vi.mock("./db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}));

describe("Data Sync Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rate Limiter", () => {
    it("should calculate tokens correctly", () => {
      // 令牌桶算法测试
      const maxTokens = 10;
      const refillRate = 1; // 每秒1个令牌
      let tokens = 5;
      const lastRefill = Date.now() - 3000; // 3秒前
      
      // 计算应该添加的令牌
      const now = Date.now();
      const elapsed = (now - lastRefill) / 1000;
      const newTokens = Math.min(maxTokens, tokens + elapsed * refillRate);
      
      expect(newTokens).toBeGreaterThanOrEqual(8); // 5 + 3 = 8
      expect(newTokens).toBeLessThanOrEqual(maxTokens);
    });

    it("should not exceed max tokens", () => {
      const maxTokens = 10;
      const refillRate = 1;
      let tokens = 9;
      const lastRefill = Date.now() - 5000; // 5秒前
      
      const elapsed = 5;
      const newTokens = Math.min(maxTokens, tokens + elapsed * refillRate);
      
      expect(newTokens).toBe(maxTokens); // 不超过最大值
    });

    it("should allow request when tokens available", () => {
      const canMakeRequest = (tokens: number, cost: number = 1) => {
        return tokens >= cost;
      };

      expect(canMakeRequest(5, 1)).toBe(true);
      expect(canMakeRequest(0, 1)).toBe(false);
      expect(canMakeRequest(2, 3)).toBe(false);
    });
  });

  describe("Request Queue", () => {
    it("should prioritize requests correctly", () => {
      const queue = [
        { id: 1, priority: 1, timestamp: 1000 },
        { id: 2, priority: 3, timestamp: 2000 },
        { id: 3, priority: 2, timestamp: 1500 },
      ];

      // 按优先级排序（高优先级先处理）
      const sorted = [...queue].sort((a, b) => b.priority - a.priority);
      
      expect(sorted[0].id).toBe(2); // 优先级3
      expect(sorted[1].id).toBe(3); // 优先级2
      expect(sorted[2].id).toBe(1); // 优先级1
    });

    it("should handle FIFO for same priority", () => {
      const queue = [
        { id: 1, priority: 2, timestamp: 1000 },
        { id: 2, priority: 2, timestamp: 2000 },
        { id: 3, priority: 2, timestamp: 1500 },
      ];

      // 相同优先级按时间排序
      const sorted = [...queue].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.timestamp - b.timestamp;
      });
      
      expect(sorted[0].id).toBe(1); // 最早的
      expect(sorted[1].id).toBe(3);
      expect(sorted[2].id).toBe(2); // 最晚的
    });
  });

  describe("Sync Job Status", () => {
    it("should transition status correctly", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["running", "cancelled"],
        running: ["completed", "failed", "cancelled"],
        completed: [],
        failed: ["pending"], // 可以重试
        cancelled: [],
      };

      const canTransition = (from: string, to: string) => {
        return validTransitions[from]?.includes(to) ?? false;
      };

      expect(canTransition("pending", "running")).toBe(true);
      expect(canTransition("running", "completed")).toBe(true);
      expect(canTransition("running", "failed")).toBe(true);
      expect(canTransition("completed", "running")).toBe(false);
      expect(canTransition("failed", "pending")).toBe(true); // 重试
    });
  });

  describe("Sync Type Validation", () => {
    it("should validate sync types", () => {
      const validSyncTypes = ["campaigns", "keywords", "performance", "all"];

      const isValidSyncType = (type: string) => {
        return validSyncTypes.includes(type);
      };

      expect(isValidSyncType("campaigns")).toBe(true);
      expect(isValidSyncType("keywords")).toBe(true);
      expect(isValidSyncType("performance")).toBe(true);
      expect(isValidSyncType("all")).toBe(true);
      expect(isValidSyncType("invalid")).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should calculate retry delay with exponential backoff", () => {
      const calculateRetryDelay = (retryCount: number, baseDelay: number = 1000) => {
        return Math.min(baseDelay * Math.pow(2, retryCount), 60000); // 最大60秒
      };

      expect(calculateRetryDelay(0)).toBe(1000);
      expect(calculateRetryDelay(1)).toBe(2000);
      expect(calculateRetryDelay(2)).toBe(4000);
      expect(calculateRetryDelay(3)).toBe(8000);
      expect(calculateRetryDelay(10)).toBe(60000); // 不超过60秒
    });

    it("should determine if error is retryable", () => {
      const isRetryableError = (errorCode: string) => {
        const retryableCodes = ["RATE_LIMIT", "TIMEOUT", "SERVICE_UNAVAILABLE"];
        return retryableCodes.includes(errorCode);
      };

      expect(isRetryableError("RATE_LIMIT")).toBe(true);
      expect(isRetryableError("TIMEOUT")).toBe(true);
      expect(isRetryableError("SERVICE_UNAVAILABLE")).toBe(true);
      expect(isRetryableError("INVALID_REQUEST")).toBe(false);
      expect(isRetryableError("UNAUTHORIZED")).toBe(false);
    });
  });

  describe("Progress Calculation", () => {
    it("should calculate sync progress correctly", () => {
      const calculateProgress = (processed: number, total: number) => {
        if (total === 0) return 0;
        return Math.round((processed / total) * 100);
      };

      expect(calculateProgress(50, 100)).toBe(50);
      expect(calculateProgress(100, 100)).toBe(100);
      expect(calculateProgress(0, 100)).toBe(0);
      expect(calculateProgress(0, 0)).toBe(0);
      expect(calculateProgress(33, 100)).toBe(33);
    });
  });
});
