import { describe, it, expect } from 'vitest';
import * as batchOperationService from './batchOperationService';
import * as correctionService from './correctionService';

describe('Batch Operation Service', () => {
  describe('validateNegativeKeywordItem', () => {
    it('should validate a valid negative keyword item', () => {
      const item: batchOperationService.NegativeKeywordItem = {
        entityType: 'campaign',
        entityId: 1,
        negativeKeyword: 'cheap',
        negativeMatchType: 'negative_phrase',
        negativeLevel: 'campaign',
      };
      
      const result = batchOperationService.validateNegativeKeywordItem(item);
      expect(result.valid).toBe(true);
    });

    it('should reject empty negative keyword', () => {
      const item: batchOperationService.NegativeKeywordItem = {
        entityType: 'campaign',
        entityId: 1,
        negativeKeyword: '',
        negativeMatchType: 'negative_phrase',
        negativeLevel: 'campaign',
      };
      
      const result = batchOperationService.validateNegativeKeywordItem(item);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('不能为空');
    });

    it('should reject keyword exceeding max length', () => {
      const item: batchOperationService.NegativeKeywordItem = {
        entityType: 'campaign',
        entityId: 1,
        negativeKeyword: 'a'.repeat(501),
        negativeMatchType: 'negative_phrase',
        negativeLevel: 'campaign',
      };
      
      const result = batchOperationService.validateNegativeKeywordItem(item);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('500');
    });
  });

  describe('validateBidAdjustmentItem', () => {
    it('should validate a valid bid adjustment item', () => {
      const item: batchOperationService.BidAdjustmentItem = {
        entityType: 'keyword',
        entityId: 1,
        currentBid: 1.0,
        newBid: 1.5,
      };
      
      const result = batchOperationService.validateBidAdjustmentItem(item);
      expect(result.valid).toBe(true);
    });

    it('should reject bid below minimum', () => {
      const item: batchOperationService.BidAdjustmentItem = {
        entityType: 'keyword',
        entityId: 1,
        currentBid: 1.0,
        newBid: 0.01,
      };
      
      const result = batchOperationService.validateBidAdjustmentItem(item);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('$0.02');
    });

    it('should reject bid above maximum', () => {
      const item: batchOperationService.BidAdjustmentItem = {
        entityType: 'keyword',
        entityId: 1,
        currentBid: 1.0,
        newBid: 150,
      };
      
      const result = batchOperationService.validateBidAdjustmentItem(item, 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('$100');
    });

    it('should reject excessive bid change', () => {
      const item: batchOperationService.BidAdjustmentItem = {
        entityType: 'keyword',
        entityId: 1,
        currentBid: 1.0,
        newBid: 10.0, // 900% increase
      };
      
      const result = batchOperationService.validateBidAdjustmentItem(item);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('500%');
    });
  });

  describe('calculateBidChangePercent', () => {
    it('should calculate positive change correctly', () => {
      const result = batchOperationService.calculateBidChangePercent(1.0, 1.5);
      expect(result).toBe(50);
    });

    it('should calculate negative change correctly', () => {
      const result = batchOperationService.calculateBidChangePercent(2.0, 1.0);
      expect(result).toBe(-50);
    });

    it('should handle zero current bid', () => {
      const result = batchOperationService.calculateBidChangePercent(0, 1.0);
      expect(result).toBe(100);
    });
  });

  describe('canRollback', () => {
    it('should allow rollback for completed operations', () => {
      const result = batchOperationService.canRollback('completed', new Date());
      expect(result).toBe(true);
    });

    it('should not allow rollback for pending operations', () => {
      const result = batchOperationService.canRollback('pending');
      expect(result).toBe(false);
    });

    it('should not allow rollback after 7 days', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 8);
      const result = batchOperationService.canRollback('completed', oldDate);
      expect(result).toBe(false);
    });
  });

  describe('estimateExecutionTime', () => {
    it('should estimate time for negative keyword operations', () => {
      const result = batchOperationService.estimateExecutionTime(10, 'negative_keyword');
      expect(result).toBeGreaterThan(5); // Base time
      expect(result).toBeLessThan(20);
    });

    it('should estimate time for bid adjustment operations', () => {
      const result = batchOperationService.estimateExecutionTime(100, 'bid_adjustment');
      expect(result).toBeGreaterThan(30);
    });
  });

  describe('generateBatchSummary', () => {
    it('should generate summary for successful batch', () => {
      const result: batchOperationService.BatchOperationResult = {
        batchId: 1,
        status: 'completed',
        totalItems: 10,
        processedItems: 10,
        successItems: 10,
        failedItems: 0,
        errors: [],
      };
      
      const summary = batchOperationService.generateBatchSummary(result);
      expect(summary).toContain('100.0%');
      expect(summary).toContain('成功: 10');
    });

    it('should include errors in summary', () => {
      const result: batchOperationService.BatchOperationResult = {
        batchId: 1,
        status: 'completed',
        totalItems: 10,
        processedItems: 10,
        successItems: 8,
        failedItems: 2,
        errors: [
          { itemId: 1, error: 'Test error 1' },
          { itemId: 2, error: 'Test error 2' },
        ],
      };
      
      const summary = batchOperationService.generateBatchSummary(result);
      expect(summary).toContain('失败: 2');
      expect(summary).toContain('Test error 1');
    });
  });
});

describe('Correction Service', () => {
  describe('analyzeOverDecrease', () => {
    it('should detect over-decreased bid when ACoS improved', () => {
      const metricsAtAdjustment: correctionService.PerformanceMetrics = {
        impressions: 1000,
        clicks: 50,
        spend: 100,
        sales: 200,
        orders: 10,
        acos: 50,
        roas: 2,
        ctr: 5,
        cvr: 20,
      };
      
      const metricsAfterAttribution: correctionService.PerformanceMetrics = {
        impressions: 1000,
        clicks: 50,
        spend: 100,
        sales: 400,
        orders: 20,
        acos: 25, // Improved significantly
        roas: 4,
        ctr: 5,
        cvr: 40,
      };
      
      const result = correctionService.analyzeOverDecrease(
        metricsAtAdjustment,
        metricsAfterAttribution,
        2.0, // original bid
        1.0  // adjusted bid (decreased)
      );
      
      expect(result.wasOverDecreased).toBe(true);
      expect(result.confidenceScore).toBeGreaterThan(0);
    });

    it('should not flag when bid was not decreased', () => {
      const metrics: correctionService.PerformanceMetrics = {
        impressions: 1000,
        clicks: 50,
        spend: 100,
        sales: 200,
        orders: 10,
        acos: 50,
        roas: 2,
        ctr: 5,
        cvr: 20,
      };
      
      const result = correctionService.analyzeOverDecrease(
        metrics,
        metrics,
        1.0, // original bid
        2.0  // adjusted bid (increased)
      );
      
      expect(result.wasOverDecreased).toBe(false);
    });
  });

  describe('analyzeOverIncrease', () => {
    it('should detect over-increased bid when ACoS worsened', () => {
      const metricsAtAdjustment: correctionService.PerformanceMetrics = {
        impressions: 1000,
        clicks: 50,
        spend: 100,
        sales: 400,
        orders: 20,
        acos: 25,
        roas: 4,
        ctr: 5,
        cvr: 40,
      };
      
      const metricsAfterAttribution: correctionService.PerformanceMetrics = {
        impressions: 1000,
        clicks: 50,
        spend: 100,
        sales: 200,
        orders: 10,
        acos: 50, // Worsened significantly
        roas: 2,
        ctr: 5,
        cvr: 20,
      };
      
      const result = correctionService.analyzeOverIncrease(
        metricsAtAdjustment,
        metricsAfterAttribution,
        1.0, // original bid
        2.0  // adjusted bid (increased)
      );
      
      expect(result.wasOverIncreased).toBe(true);
      expect(result.confidenceScore).toBeGreaterThan(0);
    });
  });

  describe('calculateSuggestedBid', () => {
    it('should return adjusted bid for correct decisions', () => {
      const result = correctionService.calculateSuggestedBid(1.0, 1.5, 'correct', 0);
      expect(result).toBe(1.5);
    });

    it('should suggest higher bid for over-decreased', () => {
      const result = correctionService.calculateSuggestedBid(2.0, 1.0, 'over_decreased', 0.8);
      expect(result).toBeGreaterThan(1.0);
      expect(result).toBeLessThanOrEqual(2.0);
    });

    it('should suggest lower bid for over-increased', () => {
      const result = correctionService.calculateSuggestedBid(1.0, 2.0, 'over_increased', 0.8);
      expect(result).toBeLessThan(2.0);
      expect(result).toBeGreaterThanOrEqual(1.0);
    });
  });

  describe('generateRecommendations', () => {
    it('should generate recommendations for high error rate', () => {
      const corrections: correctionService.CorrectionAnalysis[] = Array(10).fill(null).map((_, i) => ({
        record: {
          id: i,
          targetId: i,
          targetName: `Target ${i}`,
          targetType: 'keyword' as const,
          campaignId: 1,
          campaignName: 'Campaign 1',
          originalBid: 1.0,
          adjustedBid: 0.5,
          adjustmentDate: new Date(),
          adjustmentReason: 'Test',
          metricsAtAdjustment: {} as correctionService.PerformanceMetrics,
        },
        metricsAfterAttribution: {} as correctionService.PerformanceMetrics,
        wasIncorrect: i < 5, // 50% error rate
        correctionType: i < 5 ? 'over_decreased' as const : 'correct' as const,
        suggestedBid: 0.75,
        confidenceScore: 0.8,
        impactAnalysis: {
          estimatedLostRevenue: 100,
          estimatedWastedSpend: 0,
          potentialRecovery: 50,
        },
        explanation: 'Test',
      }));
      
      const recommendations = correctionService.generateRecommendations(corrections);
      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations.some(r => r.includes('30%'))).toBe(true);
    });

    it('should return positive message for good performance', () => {
      const corrections: correctionService.CorrectionAnalysis[] = [{
        record: {
          id: 1,
          targetId: 1,
          targetName: 'Target 1',
          targetType: 'keyword',
          campaignId: 1,
          campaignName: 'Campaign 1',
          originalBid: 1.0,
          adjustedBid: 1.5,
          adjustmentDate: new Date(),
          adjustmentReason: 'Test',
          metricsAtAdjustment: {} as correctionService.PerformanceMetrics,
        },
        metricsAfterAttribution: {} as correctionService.PerformanceMetrics,
        wasIncorrect: false,
        correctionType: 'correct',
        suggestedBid: 1.5,
        confidenceScore: 0,
        impactAnalysis: {
          estimatedLostRevenue: 0,
          estimatedWastedSpend: 0,
          potentialRecovery: 0,
        },
        explanation: 'Correct',
      }];
      
      const recommendations = correctionService.generateRecommendations(corrections);
      expect(recommendations.some(r => r.includes('良好'))).toBe(true);
    });
  });

  describe('formatCorrectionType', () => {
    it('should format correction types correctly', () => {
      expect(correctionService.formatCorrectionType('over_decreased')).toBe('过度降价');
      expect(correctionService.formatCorrectionType('over_increased')).toBe('过度加价');
      expect(correctionService.formatCorrectionType('correct')).toBe('正确');
    });
  });

  describe('getSeverityLevel', () => {
    it('should return correct severity levels', () => {
      expect(correctionService.getSeverityLevel(0.8)).toBe('high');
      expect(correctionService.getSeverityLevel(0.5)).toBe('medium');
      expect(correctionService.getSeverityLevel(0.2)).toBe('low');
    });
  });
});
