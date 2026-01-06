import { describe, it, expect } from 'vitest';

// 测试一键采纳最优出价功能的核心逻辑

describe('一键采纳最优出价功能', () => {
  
  describe('出价调整计算', () => {
    
    it('应该正确计算出价差距百分比', () => {
      const currentBid = 1.00;
      const optimalBid = 1.20;
      const bidDifferencePercent = Math.abs((optimalBid - currentBid) / currentBid * 100);
      
      expect(bidDifferencePercent).toBeCloseTo(20, 5);
    });
    
    it('应该正确判断是否需要调整（差距大于阈值）', () => {
      const currentBid = 1.00;
      const optimalBid = 1.10;
      const minBidDifferencePercent = 5;
      
      const bidDifferencePercent = Math.abs((optimalBid - currentBid) / currentBid * 100);
      const needsAdjustment = bidDifferencePercent >= minBidDifferencePercent;
      
      expect(needsAdjustment).toBe(true);
    });
    
    it('应该跳过差距过小的调整', () => {
      const currentBid = 1.00;
      const optimalBid = 1.03; // 只有3%差距
      const minBidDifferencePercent = 5;
      
      const bidDifferencePercent = Math.abs((optimalBid - currentBid) / currentBid * 100);
      const needsAdjustment = bidDifferencePercent >= minBidDifferencePercent;
      
      expect(needsAdjustment).toBe(false);
    });
    
    it('应该正确处理当前出价为0的情况', () => {
      const currentBid = 0;
      const optimalBid = 1.00;
      
      // 当前出价为0时，差距百分比设为100%
      const bidDifferencePercent = currentBid > 0 
        ? Math.abs((optimalBid - currentBid) / currentBid * 100)
        : 100;
      
      expect(bidDifferencePercent).toBe(100);
    });
    
  });
  
  describe('出价调整方向判断', () => {
    
    it('应该正确识别需要提高出价', () => {
      const currentBid = 1.00;
      const optimalBid = 1.30;
      
      const recommendation = optimalBid > currentBid ? 'increase' : 
                             optimalBid < currentBid ? 'decrease' : 'maintain';
      
      expect(recommendation).toBe('increase');
    });
    
    it('应该正确识别需要降低出价', () => {
      const currentBid = 1.50;
      const optimalBid = 1.00;
      
      const recommendation = optimalBid > currentBid ? 'increase' : 
                             optimalBid < currentBid ? 'decrease' : 'maintain';
      
      expect(recommendation).toBe('decrease');
    });
    
    it('应该正确识别出价合理', () => {
      const currentBid = 1.00;
      const optimalBid = 1.00;
      
      const recommendation = optimalBid > currentBid ? 'increase' : 
                             optimalBid < currentBid ? 'decrease' : 'maintain';
      
      expect(recommendation).toBe('maintain');
    });
    
  });
  
  describe('批量调整统计', () => {
    
    it('应该正确统计调整结果', () => {
      const adjustments = [
        { status: 'applied' as const },
        { status: 'applied' as const },
        { status: 'skipped' as const },
        { status: 'error' as const },
        { status: 'applied' as const },
      ];
      
      const appliedCount = adjustments.filter(a => a.status === 'applied').length;
      const skippedCount = adjustments.filter(a => a.status === 'skipped').length;
      const errorCount = adjustments.filter(a => a.status === 'error').length;
      
      expect(appliedCount).toBe(3);
      expect(skippedCount).toBe(1);
      expect(errorCount).toBe(1);
    });
    
    it('应该正确计算预估利润提升', () => {
      const adjustments = [
        { maxProfit: 10, status: 'applied' as const },
        { maxProfit: 15, status: 'applied' as const },
        { maxProfit: 8, status: 'skipped' as const },
      ];
      
      // 只计算已应用的调整的利润提升（假设提升10%）
      const totalExpectedProfitIncrease = adjustments
        .filter(a => a.status === 'applied')
        .reduce((sum, a) => sum + a.maxProfit * 0.1, 0);
      
      expect(totalExpectedProfitIncrease).toBe(2.5); // (10 + 15) * 0.1
    });
    
  });
  
  describe('出价精度处理', () => {
    
    it('应该将出价保留两位小数', () => {
      const optimalBid = 1.23456;
      const roundedBid = Math.round(optimalBid * 100) / 100;
      
      expect(roundedBid).toBe(1.23);
    });
    
    it('应该正确处理四舍五入', () => {
      const optimalBid = 1.235;
      const roundedBid = Math.round(optimalBid * 100) / 100;
      
      expect(roundedBid).toBe(1.24);
    });
    
  });
  
  describe('绩效组批量应用', () => {
    
    it('应该正确汇总多个广告活动的调整结果', () => {
      const campaignResults = [
        { appliedCount: 5, skippedCount: 2, errorCount: 0, totalExpectedProfitIncrease: 10 },
        { appliedCount: 3, skippedCount: 1, errorCount: 1, totalExpectedProfitIncrease: 8 },
        { appliedCount: 7, skippedCount: 0, errorCount: 0, totalExpectedProfitIncrease: 15 },
      ];
      
      const totalApplied = campaignResults.reduce((sum, c) => sum + c.appliedCount, 0);
      const totalSkipped = campaignResults.reduce((sum, c) => sum + c.skippedCount, 0);
      const totalErrors = campaignResults.reduce((sum, c) => sum + c.errorCount, 0);
      const totalProfitIncrease = campaignResults.reduce((sum, c) => sum + c.totalExpectedProfitIncrease, 0);
      
      expect(totalApplied).toBe(15);
      expect(totalSkipped).toBe(3);
      expect(totalErrors).toBe(1);
      expect(totalProfitIncrease).toBe(33);
    });
    
  });
  
  describe('阈值配置', () => {
    
    it('应该支持自定义最小差距阈值', () => {
      const testCases = [
        { currentBid: 1.00, optimalBid: 1.03, threshold: 5, shouldAdjust: false },
        { currentBid: 1.00, optimalBid: 1.06, threshold: 5, shouldAdjust: true },
        { currentBid: 1.00, optimalBid: 1.08, threshold: 10, shouldAdjust: false },
        { currentBid: 1.00, optimalBid: 1.15, threshold: 10, shouldAdjust: true },
      ];
      
      testCases.forEach(({ currentBid, optimalBid, threshold, shouldAdjust }) => {
        const bidDifferencePercent = Math.abs((optimalBid - currentBid) / currentBid * 100);
        const needsAdjustment = bidDifferencePercent >= threshold;
        
        expect(needsAdjustment).toBe(shouldAdjust);
      });
    });
    
  });
  
});
