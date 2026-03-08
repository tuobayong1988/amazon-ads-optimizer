/**
 * ML优化功能集成测试
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { BidOptimizer, BudgetAllocator } from '../../server/ml/bidOptimizer';

describe('ML优化集成测试', () => {
  describe('出价优化器', () => {
    it('应该能够训练模型并生成出价推荐', () => {
      const optimizer = new BidOptimizer();

      // 模拟历史数据
      const historicalData = [
        { bid: 1.0, spend: 100, sales: 300, impressions: 1000, clicks: 100 },
        { bid: 1.5, spend: 150, sales: 450, impressions: 1200, clicks: 120 },
        { bid: 2.0, spend: 200, sales: 550, impressions: 1400, clicks: 140 },
        { bid: 2.5, spend: 250, sales: 600, impressions: 1500, clicks: 150 },
        { bid: 3.0, spend: 300, sales: 630, impressions: 1600, clicks: 160 },
      ];

      // 训练模型
      optimizer.train(historicalData);

      // 获取推荐
      const recommendation = optimizer.recommend({
        currentBid: 2.0,
        optimizationGoal: 'maximize_sales',
      });

      expect(recommendation).toBeDefined();
      expect(recommendation.recommendedBid).toBeGreaterThan(0);
      expect(recommendation.expectedSales).toBeGreaterThan(0);
      expect(recommendation.confidence).toBeGreaterThan(0);
      expect(recommendation.confidence).toBeLessThanOrEqual(1);
    });

    it('应该能够达到目标ACoS', () => {
      const optimizer = new BidOptimizer();

      const historicalData = [
        { bid: 1.0, spend: 100, sales: 400, impressions: 1000, clicks: 100 },
        { bid: 1.5, spend: 150, sales: 500, impressions: 1200, clicks: 120 },
        { bid: 2.0, spend: 200, sales: 600, impressions: 1400, clicks: 140 },
      ];

      optimizer.train(historicalData);

      const recommendation = optimizer.recommend({
        currentBid: 1.5,
        optimizationGoal: 'target_acos',
        targetValue: 30, // 30% ACoS
      });

      expect(recommendation).toBeDefined();
      const expectedACoS = (recommendation.expectedSpend / recommendation.expectedSales) * 100;
      expect(Math.abs(expectedACoS - 30)).toBeLessThan(5); // 允许5%误差
    });

    it('应该能够达到目标ROAS', () => {
      const optimizer = new BidOptimizer();

      const historicalData = [
        { bid: 1.0, spend: 100, sales: 300, impressions: 1000, clicks: 100 },
        { bid: 1.5, spend: 150, sales: 450, impressions: 1200, clicks: 120 },
        { bid: 2.0, spend: 200, sales: 600, impressions: 1400, clicks: 140 },
      ];

      optimizer.train(historicalData);

      const recommendation = optimizer.recommend({
        currentBid: 1.5,
        optimizationGoal: 'target_roas',
        targetValue: 3.0, // 3.0 ROAS
      });

      expect(recommendation).toBeDefined();
      const expectedROAS = recommendation.expectedSales / recommendation.expectedSpend;
      expect(Math.abs(expectedROAS - 3.0)).toBeLessThan(0.5); // 允许0.5误差
    });

    it('应该能够评估模型性能', () => {
      const optimizer = new BidOptimizer();

      const historicalData = Array.from({ length: 20 }, (_, i) => ({
        bid: 1.0 + i * 0.1,
        spend: 100 + i * 10,
        sales: 300 + i * 30,
        impressions: 1000 + i * 100,
        clicks: 100 + i * 10,
      }));

      optimizer.train(historicalData);

      const performance = optimizer.evaluateModel(historicalData);

      expect(performance).toBeDefined();
      expect(performance.r2).toBeGreaterThan(0);
      expect(performance.rmse).toBeGreaterThan(0);
      expect(performance.mae).toBeGreaterThan(0);
    });
  });

  describe('预算分配优化器', () => {
    it('应该能够优化预算分配', () => {
      const allocator = new BudgetAllocator();

      const campaigns = [
        {
          id: 1,
          historicalData: [
            { bid: 1.0, spend: 100, sales: 400, impressions: 1000, clicks: 100 },
            { bid: 1.5, spend: 150, sales: 500, impressions: 1200, clicks: 120 },
          ],
        },
        {
          id: 2,
          historicalData: [
            { bid: 1.0, spend: 100, sales: 300, impressions: 1000, clicks: 100 },
            { bid: 1.5, spend: 150, sales: 400, impressions: 1200, clicks: 120 },
          ],
        },
      ];

      const result = allocator.optimize({
        campaigns,
        totalBudget: 500,
        optimizationGoal: 'maximize_sales',
      });

      expect(result).toBeDefined();
      expect(result.allocations).toHaveLength(2);

      // 验证预算总和
      const totalAllocated = result.allocations.reduce(
        (sum, a) => sum + a.allocatedBudget,
        0
      );
      expect(Math.abs(totalAllocated - 500)).toBeLessThan(1);

      // 验证高效活动获得更多预算
      const campaign1Budget = result.allocations.find((a: any) => a.campaignId === 1)?.allocatedBudget || 0;
      const campaign2Budget = result.allocations.find((a: any) => a.campaignId === 2)?.allocatedBudget || 0;
      expect(campaign1Budget).toBeGreaterThan(campaign2Budget);
    });

    it('应该能够计算边际效益', () => {
      const allocator = new BudgetAllocator();

      const campaigns = [
        {
          id: 1,
          historicalData: [
            { bid: 1.0, spend: 100, sales: 400, impressions: 1000, clicks: 100 },
            { bid: 1.5, spend: 150, sales: 500, impressions: 1200, clicks: 120 },
            { bid: 2.0, spend: 200, sales: 550, impressions: 1400, clicks: 140 },
          ],
        },
      ];

      const result = allocator.optimize({
        campaigns,
        totalBudget: 300,
        optimizationGoal: 'maximize_sales',
      });

      expect(result.allocations[0].marginalBenefit).toBeGreaterThan(0);
    });
  });

  describe('批量优化', () => {
    it('应该能够批量生成出价推荐', () => {
      const campaigns = [
        {
          id: 1,
          currentBid: 1.5,
          historicalData: [
            { bid: 1.0, spend: 100, sales: 300, impressions: 1000, clicks: 100 },
            { bid: 1.5, spend: 150, sales: 450, impressions: 1200, clicks: 120 },
          ],
        },
        {
          id: 2,
          currentBid: 2.0,
          historicalData: [
            { bid: 1.5, spend: 150, sales: 400, impressions: 1100, clicks: 110 },
            { bid: 2.0, spend: 200, sales: 500, impressions: 1300, clicks: 130 },
          ],
        },
      ];

      const recommendations = campaigns.map((campaign: any) => {
        const optimizer = new BidOptimizer();
        optimizer.train(campaign.historicalData);
        return optimizer.recommend({
          currentBid: campaign.currentBid,
          optimizationGoal: 'maximize_sales',
        });
      });

      expect(recommendations).toHaveLength(2);
      recommendations.forEach((rec: any) => {
        expect(rec.recommendedBid).toBeGreaterThan(0);
        expect(rec.confidence).toBeGreaterThan(0);
      });
    });
  });

  describe('边界条件测试', () => {
    it('应该处理空数据', () => {
      const optimizer = new BidOptimizer();
      expect(() => optimizer.train([])).toThrow();
    });

    it('应该处理单点数据', () => {
      const optimizer = new BidOptimizer();
      const historicalData = [
        { bid: 1.0, spend: 100, sales: 300, impressions: 1000, clicks: 100 },
      ];

      expect(() => optimizer.train(historicalData)).toThrow();
    });

    it('应该处理负数', () => {
      const optimizer = new BidOptimizer();
      const historicalData = [
        { bid: -1.0, spend: 100, sales: 300, impressions: 1000, clicks: 100 },
        { bid: 1.5, spend: 150, sales: 450, impressions: 1200, clicks: 120 },
      ];

      expect(() => optimizer.train(historicalData)).toThrow();
    });

    it('应该处理超出范围的目标值', () => {
      const optimizer = new BidOptimizer();
      const historicalData = [
        { bid: 1.0, spend: 100, sales: 300, impressions: 1000, clicks: 100 },
        { bid: 1.5, spend: 150, sales: 450, impressions: 1200, clicks: 120 },
      ];

      optimizer.train(historicalData);

      // 不可能达到的ACoS
      const recommendation = optimizer.recommend({
        currentBid: 1.5,
        optimizationGoal: 'target_acos',
        targetValue: 1, // 1% ACoS (几乎不可能)
      });

      expect(recommendation.confidence).toBeLessThan(0.5); // 低置信度
    });
  });

  describe('性能测试', () => {
    it('应该能够快速处理大量数据', () => {
      const optimizer = new BidOptimizer();

      // 生成大量历史数据
      const historicalData = Array.from({ length: 1000 }, (_, i) => ({
        bid: 1.0 + (i % 100) * 0.1,
        spend: 100 + i,
        sales: 300 + i * 3,
        impressions: 1000 + i * 10,
        clicks: 100 + i,
      }));

      const startTime = Date.now();
      optimizer.train(historicalData);
      const recommendation = optimizer.recommend({
        currentBid: 2.0,
        optimizationGoal: 'maximize_sales',
      });
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(5000); // 应该在5秒内完成
      expect(recommendation).toBeDefined();
    });
  });
});
