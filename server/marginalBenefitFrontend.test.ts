import { describe, it, expect, vi } from 'vitest';
import {
  calculateMarginalBenefitSimple,
  optimizeTrafficAllocationSimple,
  batchAnalyzeMarginalBenefitsSimple
} from './marginalBenefitAnalysisService';

describe('边际效益分析前端集成', () => {
  describe('边际效益报告生成', () => {
    it('应该为各位置生成完整的边际效益数据', () => {
      const metrics = {
        impressions: 10000,
        clicks: 200,
        spend: 100,
        sales: 300,
        orders: 15,
        ctr: 2,
        cvr: 7.5,
        cpc: 0.5,
        acos: 33.3,
        roas: 3,
      };
      
      const result = calculateMarginalBenefitSimple(metrics, 50);
      
      // 验证返回的数据结构完整
      expect(result).toHaveProperty('marginalROAS');
      expect(result).toHaveProperty('marginalACoS');
      expect(result).toHaveProperty('marginalSales');
      expect(result).toHaveProperty('marginalSpend');
      expect(result).toHaveProperty('elasticity');
      expect(result).toHaveProperty('diminishingPoint');
      expect(result).toHaveProperty('optimalRange');
      expect(result).toHaveProperty('confidence');
    });

    it('应该正确计算不同倾斜水平的边际效益', () => {
      const metrics = {
        impressions: 5000,
        clicks: 100,
        spend: 50,
        sales: 200,
        orders: 10,
        ctr: 2,
        cvr: 10,
        cpc: 0.5,
        acos: 25,
        roas: 4,
      };
      
      // 低倾斜水平
      const lowTilt = calculateMarginalBenefitSimple(metrics, 20);
      // 高倾斜水平
      const highTilt = calculateMarginalBenefitSimple(metrics, 150);
      
      // 高倾斜水平的边际ROAS应该更低（边际效益递减）
      expect(highTilt.marginalROAS).toBeLessThan(lowTilt.marginalROAS);
    });

    it('应该识别递减拐点', () => {
      const metrics = {
        impressions: 8000,
        clicks: 160,
        spend: 80,
        sales: 240,
        orders: 12,
        ctr: 2,
        cvr: 7.5,
        cpc: 0.5,
        acos: 33.3,
        roas: 3,
      };
      
      const result = calculateMarginalBenefitSimple(metrics, 50);
      
      // 递减拐点应该在合理范围内
      expect(result.diminishingPoint).toBeGreaterThan(0);
      expect(result.diminishingPoint).toBeLessThanOrEqual(200);
    });
  });

  describe('流量分配优化', () => {
    it('应该根据边际效益优化流量分配', () => {
      const marginalBenefits = {
        top_of_search: {
          marginalROAS: 4,
          marginalACoS: 25,
          marginalSales: 100,
          marginalSpend: 25,
          elasticity: 1.2,
          diminishingPoint: 80,
          optimalRange: { min: 30, max: 100 },
          confidence: 0.8,
        },
        product_page: {
          marginalROAS: 2.5,
          marginalACoS: 40,
          marginalSales: 50,
          marginalSpend: 20,
          elasticity: 0.8,
          diminishingPoint: 60,
          optimalRange: { min: 20, max: 80 },
          confidence: 0.7,
        },
        rest_of_search: {
          marginalROAS: 2,
          marginalACoS: 50,
          marginalSales: 30,
          marginalSpend: 15,
          elasticity: 0.5,
          diminishingPoint: 50,
          optimalRange: { min: 0, max: 50 },
          confidence: 0.6,
        },
      };
      
      const currentAdjustments = {
        top_of_search: 30,
        product_page: 20,
        rest_of_search: 0,
      };
      
      const result = optimizeTrafficAllocationSimple(
        marginalBenefits,
        currentAdjustments,
        'maximize_roas'
      );
      
      // 验证返回结构
      expect(result).toHaveProperty('optimizedAdjustments');
      expect(result).toHaveProperty('expectedSalesIncrease');
      expect(result).toHaveProperty('expectedSpendChange');
      expect(result).toHaveProperty('expectedROASChange');
      expect(result).toHaveProperty('confidence');
      
      // 高边际ROAS的位置应该获得更多倾斜
      expect(result.optimizedAdjustments.top_of_search).toBeGreaterThanOrEqual(currentAdjustments.top_of_search);
    });

    it('应该支持不同的优化目标', () => {
      const marginalBenefits = {
        top_of_search: {
          marginalROAS: 3,
          marginalACoS: 33,
          marginalSales: 80,
          marginalSpend: 27,
          elasticity: 1.0,
          diminishingPoint: 70,
          optimalRange: { min: 20, max: 90 },
          confidence: 0.75,
        },
        product_page: {
          marginalROAS: 2,
          marginalACoS: 50,
          marginalSales: 40,
          marginalSpend: 20,
          elasticity: 0.7,
          diminishingPoint: 55,
          optimalRange: { min: 10, max: 70 },
          confidence: 0.65,
        },
        rest_of_search: {
          marginalROAS: 1.5,
          marginalACoS: 67,
          marginalSales: 20,
          marginalSpend: 13,
          elasticity: 0.4,
          diminishingPoint: 40,
          optimalRange: { min: 0, max: 50 },
          confidence: 0.5,
        },
      };
      
      const currentAdjustments = {
        top_of_search: 40,
        product_page: 30,
        rest_of_search: 0,
      };
      
      // 测试不同优化目标
      const roasResult = optimizeTrafficAllocationSimple(
        marginalBenefits,
        currentAdjustments,
        'maximize_roas'
      );
      
      const salesResult = optimizeTrafficAllocationSimple(
        marginalBenefits,
        currentAdjustments,
        'maximize_sales'
      );
      
      const acosResult = optimizeTrafficAllocationSimple(
        marginalBenefits,
        currentAdjustments,
        'minimize_acos'
      );
      
      const balancedResult = optimizeTrafficAllocationSimple(
        marginalBenefits,
        currentAdjustments,
        'balanced'
      );
      
      // 所有结果都应该有效
      expect(roasResult.confidence).toBeGreaterThan(0);
      expect(salesResult.confidence).toBeGreaterThan(0);
      expect(acosResult.confidence).toBeGreaterThan(0);
      expect(balancedResult.confidence).toBeGreaterThan(0);
    });
  });

  describe('批量分析', () => {
    it('应该支持批量分析多个广告活动', () => {
      const campaignData = [
        {
          campaignId: 'campaign1',
          placements: {
            top_of_search: {
              metrics: { impressions: 5000, clicks: 100, spend: 50, sales: 150, orders: 8, ctr: 2, cvr: 8, cpc: 0.5, acos: 33, roas: 3 },
              currentAdjustment: 30,
            },
            product_page: {
              metrics: { impressions: 3000, clicks: 60, spend: 30, sales: 60, orders: 3, ctr: 2, cvr: 5, cpc: 0.5, acos: 50, roas: 2 },
              currentAdjustment: 20,
            },
          },
        },
        {
          campaignId: 'campaign2',
          placements: {
            top_of_search: {
              metrics: { impressions: 8000, clicks: 200, spend: 100, sales: 400, orders: 20, ctr: 2.5, cvr: 10, cpc: 0.5, acos: 25, roas: 4 },
              currentAdjustment: 50,
            },
            product_page: {
              metrics: { impressions: 4000, clicks: 80, spend: 40, sales: 100, orders: 5, ctr: 2, cvr: 6.25, cpc: 0.5, acos: 40, roas: 2.5 },
              currentAdjustment: 30,
            },
          },
        },
      ];
      
      const results = batchAnalyzeMarginalBenefitsSimple(campaignData);
      
      expect(results).toHaveLength(2);
      expect(results[0].campaignId).toBe('campaign1');
      expect(results[1].campaignId).toBe('campaign2');
      
      // 每个结果都应该有边际效益数据
      results.forEach(result => {
        expect(result.marginalBenefits).toBeDefined();
        expect(result.optimizationResult).toBeDefined();
      });
    });
  });

  describe('置信度计算', () => {
    it('应该根据数据量计算合理的置信度', () => {
      // 数据量少
      const lowDataMetrics = {
        impressions: 100,
        clicks: 5,
        spend: 5,
        sales: 10,
        orders: 1,
        ctr: 5,
        cvr: 20,
        cpc: 1,
        acos: 50,
        roas: 2,
      };
      
      // 数据量多
      const highDataMetrics = {
        impressions: 50000,
        clicks: 1000,
        spend: 500,
        sales: 2000,
        orders: 100,
        ctr: 2,
        cvr: 10,
        cpc: 0.5,
        acos: 25,
        roas: 4,
      };
      
      const lowDataResult = calculateMarginalBenefitSimple(lowDataMetrics, 50);
      const highDataResult = calculateMarginalBenefitSimple(highDataMetrics, 50);
      
      // 数据量多的置信度应该更高
      expect(highDataResult.confidence).toBeGreaterThan(lowDataResult.confidence);
    });
  });

  describe('最优范围计算', () => {
    it('应该计算合理的最优倾斜范围', () => {
      const metrics = {
        impressions: 10000,
        clicks: 200,
        spend: 100,
        sales: 350,
        orders: 18,
        ctr: 2,
        cvr: 9,
        cpc: 0.5,
        acos: 28.6,
        roas: 3.5,
      };
      
      const result = calculateMarginalBenefitSimple(metrics, 60);
      
      // 最优范围应该在0-200之间
      expect(result.optimalRange.min).toBeGreaterThanOrEqual(0);
      expect(result.optimalRange.max).toBeLessThanOrEqual(200);
      expect(result.optimalRange.min).toBeLessThan(result.optimalRange.max);
    });
  });
});
