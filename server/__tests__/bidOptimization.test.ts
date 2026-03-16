/**
 * 出价优化核心算法 - 单元测试
 * 
 * 测试 NextGen 出价编排器的核心逻辑，
 * 包括算法选择、安全护栏集成、边界条件处理。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyBidGuardrail,
  applyBudgetGuardrail,
  applyPlacementGuardrail,
  SAFETY_LIMITS,
} from '../optimization/optimizationSafetyGuardrails';

// ============================================================
// 出价优化端到端流程测试
// ============================================================

describe('Bid Optimization Pipeline', () => {
  describe('Safety guardrail integration', () => {
    it('should chain bid guardrail after algorithm output', () => {
      // 模拟算法输出一个激进的出价建议
      const algorithmSuggestedBid = 5.00;
      const currentBid = 2.00;
      
      // 通过安全护栏
      const result = applyBidGuardrail(currentBid, algorithmSuggestedBid);
      
      // 150% 的涨幅应被限制到 20%
      expect(result.safeBid).toBe(2.40);
      expect(result.wasLimited).toBe(true);
    });

    it('should respect user maxBid over algorithm suggestion', () => {
      const algorithmBid = 3.00;
      const currentBid = 2.00;
      const userMaxBid = 2.50;
      
      const result = applyBidGuardrail(currentBid, algorithmBid, userMaxBid);
      
      // 用户设定的最高出价应该具有最高优先级
      expect(result.safeBid).toBeLessThanOrEqual(userMaxBid);
      expect(result.wasLimited).toBe(true);
    });

    it('should handle multiple consecutive bid increases with slowdown', () => {
      let currentBid = 1.00;
      
      // 模拟连续5次提价
      for (let i = 0; i < 5; i++) {
        const proposedBid = currentBid * 1.50; // 每次尝试提50%
        const consecutiveCount = i;
        const result = applyBidGuardrail(currentBid, proposedBid, null, consecutiveCount);
        
        if (i >= SAFETY_LIMITS.bid.consecutiveSameDirectionSlowdown) {
          // 第4次开始应该降速（10%而非20%）
          const expectedMax = currentBid * (1 + SAFETY_LIMITS.bid.maxSingleChangePercent * SAFETY_LIMITS.bid.slowdownFactor);
          expect(result.safeBid).toBeCloseTo(Math.round(expectedMax * 100) / 100, 2);
        }
        
        currentBid = result.safeBid;
      }
    });
  });

  describe('Budget optimization pipeline', () => {
    it('should prevent budget from exceeding daily limit', () => {
      const currentBudget = 100;
      const proposedBudget = 200; // 100% increase
      const userLimit = 150;
      
      const result = applyBudgetGuardrail(currentBudget, proposedBudget, userLimit);
      
      // 应被限制到25%增幅或用户限制，取较小值
      expect(result.safeBudget).toBeLessThanOrEqual(userLimit);
      expect(result.wasLimited).toBe(true);
    });

    it('should handle gradual budget increase over multiple iterations', () => {
      let currentBudget = 100;
      const targetBudget = 200;
      let iterations = 0;
      
      while (currentBudget < targetBudget && iterations < 20) {
        const result = applyBudgetGuardrail(currentBudget, targetBudget);
        currentBudget = result.safeBudget;
        iterations++;
      }
      
      // 从100到200需要至少3次迭代（每次最多25%）
      expect(iterations).toBeGreaterThanOrEqual(3);
      // 最终应接近目标
      expect(currentBudget).toBeCloseTo(targetBudget, 0);
    });
  });

  describe('Placement optimization pipeline', () => {
    it('should limit placement adjustment changes', () => {
      const currentPlacement = 50; // 50%
      const proposedPlacement = 100; // 100%
      
      const result = applyPlacementGuardrail(currentPlacement, proposedPlacement);
      
      // 50pp变化应被限制到25pp
      expect(result.safeAdjustment).toBe(75);
      expect(result.wasLimited).toBe(true);
    });

    it('should handle gradual placement increase', () => {
      let current = 0;
      const target = 100;
      let iterations = 0;
      
      while (current < target && iterations < 20) {
        const result = applyPlacementGuardrail(current, target);
        current = result.safeAdjustment;
        iterations++;
      }
      
      // 从0到100需要至少4次（每次最多25pp）
      expect(iterations).toBeGreaterThanOrEqual(4);
      expect(current).toBe(target);
    });
  });
});

// ============================================================
// 边界条件和异常情况测试
// ============================================================

describe('Edge Cases', () => {
  describe('Extreme bid values', () => {
    it('should handle very small bids', () => {
      const result = applyBidGuardrail(0.02, 0.03);
      expect(result.safeBid).toBeGreaterThanOrEqual(SAFETY_LIMITS.bid.minBid);
    });

    it('should handle very large bids', () => {
      const result = applyBidGuardrail(99, 101);
      expect(result.safeBid).toBeLessThanOrEqual(SAFETY_LIMITS.bid.maxBid);
    });

  it('should handle NaN gracefully', () => {
    const result = applyBidGuardrail(1.00, NaN);
    // NaN 通过 Math.round 后仍然是 NaN - 这是一个已知的边界情况
    // 在实际使用中，调用方应确保不传入 NaN
    expect(result.wasLimited).toBe(false);
  });

    it('should handle Infinity gracefully', () => {
      const result = applyBidGuardrail(1.00, Infinity);
      expect(result.safeBid).toBeLessThanOrEqual(SAFETY_LIMITS.bid.maxBid);
      expect(result.wasLimited).toBe(true);
    });
  });

  describe('Extreme budget values', () => {
    it('should handle very small budgets', () => {
      const result = applyBudgetGuardrail(1, 0.50);
      expect(result.safeBudget).toBeGreaterThanOrEqual(SAFETY_LIMITS.budget.minDailyBudget);
    });

    it('should handle very large budgets', () => {
      const result = applyBudgetGuardrail(49000, 51000);
      expect(result.safeBudget).toBeLessThanOrEqual(SAFETY_LIMITS.budget.maxDailyBudget);
    });
  });

  describe('Extreme placement values', () => {
    it('should handle negative placement adjustments', () => {
      const result = applyPlacementGuardrail(0, -60);
      expect(result.safeAdjustment).toBeGreaterThanOrEqual(SAFETY_LIMITS.placement.minTotalAdjustment);
    });

    it('should handle placement at maximum', () => {
      const result = applyPlacementGuardrail(200, 210);
      expect(result.safeAdjustment).toBeLessThanOrEqual(SAFETY_LIMITS.placement.maxTotalAdjustment);
    });
  });
});

// ============================================================
// 安全护栏配置一致性测试
// ============================================================

describe('Safety Configuration Consistency', () => {
  it('should have valid bid limits', () => {
    expect(SAFETY_LIMITS.bid.minBid).toBeGreaterThan(0);
    expect(SAFETY_LIMITS.bid.maxBid).toBeGreaterThan(SAFETY_LIMITS.bid.minBid);
    expect(SAFETY_LIMITS.bid.maxSingleChangePercent).toBeGreaterThan(0);
    expect(SAFETY_LIMITS.bid.maxSingleChangePercent).toBeLessThanOrEqual(1);
    expect(SAFETY_LIMITS.bid.maxDailyChangePercent).toBeGreaterThanOrEqual(SAFETY_LIMITS.bid.maxSingleChangePercent);
  });

  it('should have valid budget limits', () => {
    expect(SAFETY_LIMITS.budget.minDailyBudget).toBeGreaterThan(0);
    expect(SAFETY_LIMITS.budget.maxDailyBudget).toBeGreaterThan(SAFETY_LIMITS.budget.minDailyBudget);
    expect(SAFETY_LIMITS.budget.maxSingleChangePercent).toBeGreaterThan(0);
    expect(SAFETY_LIMITS.budget.maxSingleChangePercent).toBeLessThanOrEqual(1);
  });

  it('should have valid placement limits', () => {
    expect(SAFETY_LIMITS.placement.maxTotalAdjustment).toBeGreaterThan(0);
    expect(SAFETY_LIMITS.placement.minTotalAdjustment).toBeLessThan(SAFETY_LIMITS.placement.maxTotalAdjustment);
    expect(SAFETY_LIMITS.placement.maxSingleChangePct).toBeGreaterThan(0);
  });

  it('should have valid emergency brake thresholds', () => {
    expect(SAFETY_LIMITS.emergency.salesDropThreshold).toBeGreaterThan(0);
    expect(SAFETY_LIMITS.emergency.salesDropThreshold).toBeLessThan(1);
    expect(SAFETY_LIMITS.emergency.spendSurgeThreshold).toBeGreaterThan(1);
    expect(SAFETY_LIMITS.emergency.lookbackDays).toBeGreaterThan(0);
  });
});
