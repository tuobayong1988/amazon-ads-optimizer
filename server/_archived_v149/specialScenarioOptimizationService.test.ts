/**
 * 特殊场景算法优化服务单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  adjustForAttributionDelay,
  calculateTargetCpc,
  detectOverbidding,
  getUpcomingPromotionalEvents,
  generateEventTransitionPlan,
} from './specialScenarioOptimizationService';

describe('specialScenarioOptimizationService', () => {
  describe('adjustForAttributionDelay', () => {
    const defaultModel = {
      accountId: 1,
      completionRates: {
        day1: 0.70,
        day2: 0.80,
        day3: 0.90,
        day4: 0.95,
        day5: 0.97,
        day6: 0.99,
        day7: 1.00,
      },
      campaignTypeFactors: {
        sp_auto: 1.0,
        sp_manual: 1.0,
        sb: 0.95,
        sd: 0.90,
      },
      lastCalibrated: new Date()
    };

    it('should adjust day 1 data with 70% completion rate', () => {
      const rawMetrics = {
        impressions: 1000,
        clicks: 100,
        spend: 50,
        sales: 70,
        orders: 7,
      };
      
      const dataDate = new Date();
      dataDate.setDate(dataDate.getDate() - 1);
      
      const adjusted = adjustForAttributionDelay(rawMetrics, dataDate, defaultModel, 'sp_manual');
      
      expect(adjusted.isAdjusted).toBe(true);
      expect(adjusted.completionRate).toBeCloseTo(0.70, 1);
      expect(adjusted.adjustmentFactor).toBeCloseTo(1.43, 1);
      expect(adjusted.sales).toBeGreaterThan(rawMetrics.sales);
      expect(adjusted.confidence).toBe('low');
    });

    it('should not adjust day 7+ data', () => {
      const rawMetrics = {
        impressions: 1000,
        clicks: 100,
        spend: 50,
        sales: 100,
        orders: 10,
      };
      
      const dataDate = new Date();
      dataDate.setDate(dataDate.getDate() - 8);
      
      const adjusted = adjustForAttributionDelay(rawMetrics, dataDate, defaultModel, 'sp_manual');
      
      expect(adjusted.isAdjusted).toBe(false);
      expect(adjusted.completionRate).toBe(1.0);
      expect(adjusted.adjustmentFactor).toBe(1.0);
      expect(adjusted.sales).toBe(rawMetrics.sales);
      expect(adjusted.confidence).toBe('high');
    });

    it('should apply campaign type factor for SD campaigns', () => {
      const rawMetrics = {
        impressions: 1000,
        clicks: 100,
        spend: 50,
        sales: 70,
        orders: 7,
      };
      
      const dataDate = new Date();
      dataDate.setDate(dataDate.getDate() - 3);
      
      const adjustedSP = adjustForAttributionDelay(rawMetrics, dataDate, defaultModel, 'sp_manual');
      const adjustedSD = adjustForAttributionDelay(rawMetrics, dataDate, defaultModel, 'sd');
      
      // SD campaigns have lower completion rate factor (0.90)
      expect(adjustedSD.adjustmentFactor).toBeGreaterThan(adjustedSP.adjustmentFactor);
    });

    it('should calculate correct ACoS and ROAS after adjustment', () => {
      const rawMetrics = {
        impressions: 1000,
        clicks: 100,
        spend: 50,
        sales: 100,
        orders: 10,
      };
      
      const dataDate = new Date();
      dataDate.setDate(dataDate.getDate() - 2);
      
      const adjusted = adjustForAttributionDelay(rawMetrics, dataDate, defaultModel, 'sp_manual');
      
      // Verify ACoS = spend / sales * 100
      expect(adjusted.acos).toBeCloseTo((rawMetrics.spend / adjusted.sales) * 100, 1);
      // Verify ROAS = sales / spend
      expect(adjusted.roas).toBeCloseTo(adjusted.sales / rawMetrics.spend, 1);
    });
  });

  describe('calculateTargetCpc', () => {
    it('should calculate target CPC correctly', () => {
      const result = calculateTargetCpc(0.25, 0.10, 50);
      
      // Target CPC = 0.25 * 0.10 * 50 = 1.25
      expect(result.targetCpc).toBeCloseTo(1.25, 2);
    });

    it('should calculate break-even CPC with profit margin', () => {
      const result = calculateTargetCpc(0.25, 0.10, 50, 0.30);
      
      // Break-even CPC = 0.30 * 0.10 * 50 = 1.50
      expect(result.breakEvenCpc).toBeCloseTo(1.50, 2);
    });

    it('should use default break-even when no profit margin provided', () => {
      const result = calculateTargetCpc(0.25, 0.10, 50);
      
      // Default break-even = target * 1.5 = 1.25 * 1.5 = 1.875
      expect(result.breakEvenCpc).toBeCloseTo(1.875, 2);
    });
  });

  describe('detectOverbidding', () => {
    it('should detect overbidding when bid is much higher than CPC', () => {
      const target = {
        id: 1,
        type: 'keyword' as const,
        text: 'test keyword',
        matchType: 'exact',
        bid: 3.0,
        impressions: 1000,
        clicks: 100,
        spend: 100,
        sales: 200,
        orders: 10,
      };
      
      const result = detectOverbidding(target, 0.25, 0.30);
      
      // CPC = 100/100 = 1.0, Bid = 3.0, ratio = 3.0
      expect(result.bidToCpcRatio).toBe(3.0);
      expect(result.isOverbidding).toBe(true);
      expect(result.overbiddingReasons.length).toBeGreaterThan(0);
    });

    it('should not flag efficient bidding', () => {
      const target = {
        id: 1,
        type: 'keyword' as const,
        text: 'test keyword',
        matchType: 'exact',
        bid: 1.2,
        impressions: 1000,
        clicks: 100,
        spend: 100,
        sales: 500,
        orders: 20,
      };
      
      const result = detectOverbidding(target, 0.25, 0.30);
      
      // CPC = 1.0, Bid = 1.2, ratio = 1.2 (acceptable)
      // ACoS = 100/500 = 20% (below target 25%)
      expect(result.isOverbidding).toBe(false);
      expect(result.efficiencyScore).toBeGreaterThan(50);
    });

    it('should calculate expected savings correctly', () => {
      const target = {
        id: 1,
        type: 'keyword' as const,
        text: 'test keyword',
        matchType: 'exact',
        bid: 5.0,
        impressions: 1000,
        clicks: 100,
        spend: 200,
        sales: 300,
        orders: 15,
      };
      
      const result = detectOverbidding(target, 0.25, 0.30);
      
      expect(result.isOverbidding).toBe(true);
      expect(result.suggestedBid).toBeLessThan(target.bid);
      expect(result.expectedSavings).toBeGreaterThan(0);
    });

    it('should handle zero clicks gracefully', () => {
      const target = {
        id: 1,
        type: 'keyword' as const,
        text: 'test keyword',
        matchType: 'exact',
        bid: 1.0,
        impressions: 100,
        clicks: 0,
        spend: 0,
        sales: 0,
        orders: 0,
      };
      
      const result = detectOverbidding(target, 0.25, 0.30);
      
      expect(result.actualCpc).toBe(0);
      expect(result.isOverbidding).toBe(false);
    });
  });

  describe('getUpcomingPromotionalEvents', () => {
    it('should return events within specified days', () => {
      const events = getUpcomingPromotionalEvents(365);
      
      // Should include at least some events
      expect(Array.isArray(events)).toBe(true);
    });

    it('should sort events by days until', () => {
      const events = getUpcomingPromotionalEvents(365);
      
      if (events.length > 1) {
        for (let i = 1; i < events.length; i++) {
          expect(events[i].daysUntil).toBeGreaterThanOrEqual(events[i - 1].daysUntil);
        }
      }
    });
  });

  describe('generateEventTransitionPlan', () => {
    it('should generate 11-day plan (7 pre + 1 event + 3 post)', () => {
      const plan = generateEventTransitionPlan(
        'Test Event',
        new Date('2026-07-15'),
        100,
        1.0
      );
      
      expect(plan.totalDays).toBe(11);
      expect(plan.dailyAdjustments.length).toBe(11);
    });

    it('should have highest multiplier on event day', () => {
      const plan = generateEventTransitionPlan(
        'Test Event',
        new Date('2026-07-15'),
        100,
        1.0
      );
      
      const eventDay = plan.dailyAdjustments.find(d => d.phase === 'event_day');
      const preDays = plan.dailyAdjustments.filter(d => d.phase === 'pre_event');
      const postDays = plan.dailyAdjustments.filter(d => d.phase === 'post_event');
      
      expect(eventDay).toBeDefined();
      expect(eventDay!.budgetMultiplier).toBe(2.0);
      
      // All pre-event days should have lower multiplier than event day
      preDays.forEach(day => {
        expect(day.budgetMultiplier).toBeLessThan(eventDay!.budgetMultiplier);
      });
      
      // All post-event days should have lower multiplier than event day
      postDays.forEach(day => {
        expect(day.budgetMultiplier).toBeLessThan(eventDay!.budgetMultiplier);
      });
    });

    it('should calculate estimated additional spend', () => {
      const plan = generateEventTransitionPlan(
        'Test Event',
        new Date('2026-07-15'),
        100,
        1.0
      );
      
      expect(plan.estimatedAdditionalSpend).toBeGreaterThan(0);
      expect(plan.estimatedAdditionalSales).toBeGreaterThan(0);
    });

    it('should have gradual increase in pre-event phase', () => {
      const plan = generateEventTransitionPlan(
        'Test Event',
        new Date('2026-07-15'),
        100,
        1.0
      );
      
      const preDays = plan.dailyAdjustments
        .filter(d => d.phase === 'pre_event')
        .sort((a, b) => a.daysFromEvent - b.daysFromEvent);
      
      // Multiplier should increase as we get closer to event
      for (let i = 1; i < preDays.length; i++) {
        expect(preDays[i].budgetMultiplier).toBeGreaterThanOrEqual(preDays[i - 1].budgetMultiplier);
      }
    });
  });
});
