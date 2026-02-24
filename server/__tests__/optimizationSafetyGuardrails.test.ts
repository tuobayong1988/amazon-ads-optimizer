/**
 * 优化安全护栏模块 - 单元测试
 * 
 * 测试竞价、预算、位置调整的安全护栏逻辑，
 * 确保所有极端情况都能被正确拦截。
 */
import { describe, it, expect } from 'vitest';
import {
  applyBidGuardrail,
  applyBudgetGuardrail,
  applyPlacementGuardrail,
  SAFETY_LIMITS,
} from '../optimizationSafetyGuardrails';

// ============================================================
// 竞价安全护栏测试
// ============================================================

describe('applyBidGuardrail', () => {
  it('should pass through bid within safe range', () => {
    const result = applyBidGuardrail(1.00, 1.10);
    expect(result.safeBid).toBe(1.10);
    expect(result.wasLimited).toBe(false);
    expect(result.limitReason).toBeNull();
  });

  it('should limit bid increase to maxSingleChangePercent (20%)', () => {
    const result = applyBidGuardrail(1.00, 1.50); // 50% increase
    expect(result.safeBid).toBe(1.20); // limited to 20%
    expect(result.wasLimited).toBe(true);
    expect(result.limitReason).toContain('提价幅度');
  });

  it('should limit bid decrease to maxSingleChangePercent (20%)', () => {
    const result = applyBidGuardrail(1.00, 0.50); // 50% decrease
    expect(result.safeBid).toBe(0.80); // limited to 20%
    expect(result.wasLimited).toBe(true);
    expect(result.limitReason).toContain('降价幅度');
  });

  it('should enforce minimum bid of $0.02', () => {
    const result = applyBidGuardrail(0.05, 0.01);
    expect(result.safeBid).toBeGreaterThanOrEqual(SAFETY_LIMITS.bid.minBid);
  });

  it('should enforce maximum bid of $100', () => {
    const result = applyBidGuardrail(90, 150);
    expect(result.safeBid).toBeLessThanOrEqual(SAFETY_LIMITS.bid.maxBid);
    expect(result.wasLimited).toBe(true);
  });

  it('should respect user-defined maxBid when lower than system max', () => {
    const result = applyBidGuardrail(5.00, 6.00, 5.50);
    expect(result.safeBid).toBe(5.50);
    expect(result.wasLimited).toBe(true);
    expect(result.limitReason).toContain('最高出价限制');
  });

  it('should apply slowdown factor after consecutive same-direction adjustments', () => {
    // Without consecutive: 20% max change
    const normal = applyBidGuardrail(1.00, 1.50, null, 0);
    expect(normal.safeBid).toBe(1.20);

    // With 3+ consecutive: 10% max change (20% * 0.5 slowdown)
    const slowed = applyBidGuardrail(1.00, 1.50, null, 3);
    expect(slowed.safeBid).toBe(1.10);
    expect(slowed.wasLimited).toBe(true);
  });

  it('should round bid to 2 decimal places', () => {
    const result = applyBidGuardrail(1.00, 1.155);
    expect(result.safeBid).toBe(1.16); // rounded
    expect(result.safeBid.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
  });

  it('should handle zero current bid gracefully', () => {
    // 当 currentBid=0 时，maxIncrease=0*(1+0.2)=0，所以任何正值都会被限制到0
    // 实际业务中不应出现 currentBid=0 的情况
    const result = applyBidGuardrail(0, 0.50);
    expect(result.wasLimited).toBe(true);
  });

  it('should handle negative proposed bid', () => {
    const result = applyBidGuardrail(1.00, -0.50);
    expect(result.safeBid).toBeGreaterThanOrEqual(SAFETY_LIMITS.bid.minBid);
  });

  it('should handle same bid (no change)', () => {
    const result = applyBidGuardrail(1.00, 1.00);
    expect(result.safeBid).toBe(1.00);
    expect(result.wasLimited).toBe(false);
  });
});

// ============================================================
// 预算安全护栏测试
// ============================================================

describe('applyBudgetGuardrail', () => {
  it('should pass through budget within safe range', () => {
    const result = applyBudgetGuardrail(100, 110);
    expect(result.safeBudget).toBe(110);
    expect(result.wasLimited).toBe(false);
  });

  it('should limit budget increase to maxSingleChangePercent (25%)', () => {
    const result = applyBudgetGuardrail(100, 200); // 100% increase
    expect(result.safeBudget).toBe(125); // limited to 25%
    expect(result.wasLimited).toBe(true);
    expect(result.limitReason).toContain('预算增加幅度');
  });

  it('should limit budget decrease to maxSingleChangePercent (25%)', () => {
    const result = applyBudgetGuardrail(100, 50); // 50% decrease
    expect(result.safeBudget).toBe(75); // limited to 25%
    expect(result.wasLimited).toBe(true);
    expect(result.limitReason).toContain('预算减少幅度');
  });

  it('should enforce minimum daily budget of $1', () => {
    const result = applyBudgetGuardrail(5, 0.50);
    expect(result.safeBudget).toBeGreaterThanOrEqual(SAFETY_LIMITS.budget.minDailyBudget);
  });

  it('should enforce maximum daily budget of $50,000', () => {
    const result = applyBudgetGuardrail(45000, 60000);
    expect(result.safeBudget).toBeLessThanOrEqual(SAFETY_LIMITS.budget.maxDailyBudget);
    expect(result.wasLimited).toBe(true);
  });

  it('should respect user-defined budget limit', () => {
    const result = applyBudgetGuardrail(100, 120, 110);
    expect(result.safeBudget).toBe(110);
    expect(result.wasLimited).toBe(true);
  });

  it('should handle zero current budget gracefully', () => {
    const result = applyBudgetGuardrail(0, 50);
    expect(result.safeBudget).toBeGreaterThanOrEqual(SAFETY_LIMITS.budget.minDailyBudget);
  });

  it('should round budget to 2 decimal places', () => {
    const result = applyBudgetGuardrail(100, 105.555);
    expect(result.safeBudget.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
  });
});

// ============================================================
// 位置调整安全护栏测试
// ============================================================

describe('applyPlacementGuardrail', () => {
  it('should pass through adjustment within safe range', () => {
    const result = applyPlacementGuardrail(50, 60);
    expect(result.safeAdjustment).toBe(60);
    expect(result.wasLimited).toBe(false);
  });

  it('should limit single change to maxSingleChangePct (25 percentage points)', () => {
    const result = applyPlacementGuardrail(50, 100); // 50pp change
    expect(result.safeAdjustment).toBe(75); // limited to 25pp
    expect(result.wasLimited).toBe(true);
    expect(result.limitReason).toContain('单次位置调整幅度');
  });

  it('should limit downward change to maxSingleChangePct', () => {
    const result = applyPlacementGuardrail(100, 50); // -50pp change
    expect(result.safeAdjustment).toBe(75); // limited to -25pp
    expect(result.wasLimited).toBe(true);
  });

  it('should enforce maximum total adjustment of 200%', () => {
    const result = applyPlacementGuardrail(190, 250);
    expect(result.safeAdjustment).toBeLessThanOrEqual(SAFETY_LIMITS.placement.maxTotalAdjustment);
    expect(result.wasLimited).toBe(true);
  });

  it('should enforce minimum total adjustment of -50%', () => {
    const result = applyPlacementGuardrail(-30, -80);
    expect(result.safeAdjustment).toBeGreaterThanOrEqual(SAFETY_LIMITS.placement.minTotalAdjustment);
    expect(result.wasLimited).toBe(true);
  });

  it('should round adjustment to integer', () => {
    const result = applyPlacementGuardrail(50, 55.7);
    expect(Number.isInteger(result.safeAdjustment)).toBe(true);
  });

  it('should handle zero to positive adjustment', () => {
    const result = applyPlacementGuardrail(0, 20);
    expect(result.safeAdjustment).toBe(20);
    expect(result.wasLimited).toBe(false);
  });

  it('should handle same adjustment (no change)', () => {
    const result = applyPlacementGuardrail(50, 50);
    expect(result.safeAdjustment).toBe(50);
    expect(result.wasLimited).toBe(false);
  });
});
