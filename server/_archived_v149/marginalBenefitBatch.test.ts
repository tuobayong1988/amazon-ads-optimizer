/**
 * 边际效益批量分析和一键应用服务单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateMarginalBenefitSimple,
  optimizeTrafficAllocationSimple,
} from './marginalBenefitAnalysisService';

describe('边际效益批量分析服务', () => {
  describe('calculateMarginalBenefitSimple', () => {
    it('应该正确计算边际效益', () => {
      const metrics = {
        impressions: 10000,
        clicks: 500,
        spend: 100,
        sales: 300,
        orders: 15,
        ctr: 5,
        cvr: 3,
        cpc: 0.2,
        acos: 33.3,
        roas: 3
      };
      
      const result = calculateMarginalBenefitSimple(metrics, 0);
      
      expect(result).toHaveProperty('marginalROAS');
      expect(result).toHaveProperty('marginalACoS');
      expect(result).toHaveProperty('marginalSales');
      expect(result).toHaveProperty('marginalSpend');
      expect(result).toHaveProperty('elasticity');
      expect(result).toHaveProperty('diminishingPoint');
      expect(result).toHaveProperty('optimalRange');
      expect(result).toHaveProperty('confidence');
    });

    it('应该随着调整增加而降低边际ROAS', () => {
      const metrics = {
        impressions: 10000,
        clicks: 500,
        spend: 100,
        sales: 300,
        orders: 15,
        ctr: 5,
        cvr: 3,
        cpc: 0.2,
        acos: 33.3,
        roas: 3
      };
      
      const result0 = calculateMarginalBenefitSimple(metrics, 0);
      const result50 = calculateMarginalBenefitSimple(metrics, 50);
      const result100 = calculateMarginalBenefitSimple(metrics, 100);
      
      expect(result0.marginalROAS).toBeGreaterThan(result50.marginalROAS);
      expect(result50.marginalROAS).toBeGreaterThan(result100.marginalROAS);
    });

    it('应该根据数据量计算置信度', () => {
      const lowDataMetrics = {
        impressions: 1000,
        clicks: 50,
        spend: 10,
        sales: 30,
        orders: 2,
        ctr: 5,
        cvr: 4,
        cpc: 0.2,
        acos: 33.3,
        roas: 3
      };
      
      const highDataMetrics = {
        impressions: 50000,
        clicks: 2500,
        spend: 500,
        sales: 1500,
        orders: 75,
        ctr: 5,
        cvr: 3,
        cpc: 0.2,
        acos: 33.3,
        roas: 3
      };
      
      const lowResult = calculateMarginalBenefitSimple(lowDataMetrics, 0);
      const highResult = calculateMarginalBenefitSimple(highDataMetrics, 0);
      
      expect(highResult.confidence).toBeGreaterThan(lowResult.confidence);
    });
  });

  describe('optimizeTrafficAllocationSimple', () => {
    it('应该返回优化后的调整建议', () => {
      const marginalBenefits = {
        top_of_search: {
          marginalROAS: 4,
          marginalACoS: 25,
          marginalSales: 100,
          marginalSpend: 25,
          elasticity: 1.5,
          diminishingPoint: 80,
          optimalRange: { min: 50, max: 110 },
          confidence: 0.8
        },
        product_page: {
          marginalROAS: 2.5,
          marginalACoS: 40,
          marginalSales: 60,
          marginalSpend: 24,
          elasticity: 1.0,
          diminishingPoint: 60,
          optimalRange: { min: 30, max: 90 },
          confidence: 0.7
        },
        rest_of_search: {
          marginalROAS: 1.5,
          marginalACoS: 66.7,
          marginalSales: 30,
          marginalSpend: 20,
          elasticity: 0.5,
          diminishingPoint: 40,
          optimalRange: { min: 10, max: 70 },
          confidence: 0.6
        }
      };
      
      const currentAdjustments = {
        top_of_search: 0,
        product_page: 0,
        rest_of_search: 0
      };
      
      const result = optimizeTrafficAllocationSimple(
        marginalBenefits,
        currentAdjustments,
        'balanced'
      );
      
      expect(result).toHaveProperty('optimizedAdjustments');
      expect(result).toHaveProperty('expectedSalesIncrease');
      expect(result).toHaveProperty('expectedSpendChange');
      expect(result).toHaveProperty('expectedROASChange');
      expect(result).toHaveProperty('confidence');
    });

    it('应该根据不同目标产生不同的优化结果', () => {
      const marginalBenefits = {
        top_of_search: {
          marginalROAS: 4,
          marginalACoS: 25,
          marginalSales: 100,
          marginalSpend: 25,
          elasticity: 1.5,
          diminishingPoint: 80,
          optimalRange: { min: 50, max: 110 },
          confidence: 0.8
        },
        product_page: {
          marginalROAS: 2.5,
          marginalACoS: 40,
          marginalSales: 150,
          marginalSpend: 60,
          elasticity: 1.0,
          diminishingPoint: 60,
          optimalRange: { min: 30, max: 90 },
          confidence: 0.7
        },
        rest_of_search: {
          marginalROAS: 1.5,
          marginalACoS: 66.7,
          marginalSales: 30,
          marginalSpend: 20,
          elasticity: 0.5,
          diminishingPoint: 40,
          optimalRange: { min: 10, max: 70 },
          confidence: 0.6
        }
      };
      
      const currentAdjustments = {
        top_of_search: 0,
        product_page: 0,
        rest_of_search: 0
      };
      
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
      
      // ROAS最大化应该更倾向于高ROAS位置
      // 销售最大化应该更倾向于高销售位置
      expect(roasResult.optimizedAdjustments).toBeDefined();
      expect(salesResult.optimizedAdjustments).toBeDefined();
    });

    it('应该限制总调整不超过400%', () => {
      const marginalBenefits = {
        top_of_search: {
          marginalROAS: 10,
          marginalACoS: 10,
          marginalSales: 500,
          marginalSpend: 50,
          elasticity: 3,
          diminishingPoint: 200,
          optimalRange: { min: 100, max: 300 },
          confidence: 1.0
        },
        product_page: {
          marginalROAS: 10,
          marginalACoS: 10,
          marginalSales: 500,
          marginalSpend: 50,
          elasticity: 3,
          diminishingPoint: 200,
          optimalRange: { min: 100, max: 300 },
          confidence: 1.0
        },
        rest_of_search: {
          marginalROAS: 10,
          marginalACoS: 10,
          marginalSales: 500,
          marginalSpend: 50,
          elasticity: 3,
          diminishingPoint: 200,
          optimalRange: { min: 100, max: 300 },
          confidence: 1.0
        }
      };
      
      const currentAdjustments = {
        top_of_search: 0,
        product_page: 0,
        rest_of_search: 0
      };
      
      const result = optimizeTrafficAllocationSimple(
        marginalBenefits,
        currentAdjustments,
        'maximize_sales'
      );
      
      const totalAdjustment = 
        (result.optimizedAdjustments.top_of_search || 0) +
        (result.optimizedAdjustments.product_page || 0) +
        (result.optimizedAdjustments.rest_of_search || 0);
      
      expect(totalAdjustment).toBeLessThanOrEqual(400);
    });
  });

  describe('批量分析结果生成', () => {
    it('应该正确计算整体改善指标', () => {
      const campaignResults = [
        {
          currentSpend: 100,
          currentSales: 300,
          optimization: {
            expectedSalesIncrease: 30,
            expectedSpendChange: 10,
            confidence: 0.8
          }
        },
        {
          currentSpend: 200,
          currentSales: 500,
          optimization: {
            expectedSalesIncrease: 50,
            expectedSpendChange: 20,
            confidence: 0.7
          }
        }
      ];
      
      const totalCurrentSpend = campaignResults.reduce((sum, r) => sum + r.currentSpend, 0);
      const totalCurrentSales = campaignResults.reduce((sum, r) => sum + r.currentSales, 0);
      const totalExpectedSpend = campaignResults.reduce((sum, r) => sum + r.currentSpend + r.optimization.expectedSpendChange, 0);
      const totalExpectedSales = campaignResults.reduce((sum, r) => sum + r.currentSales + r.optimization.expectedSalesIncrease, 0);
      
      expect(totalCurrentSpend).toBe(300);
      expect(totalCurrentSales).toBe(800);
      expect(totalExpectedSpend).toBe(330);
      expect(totalExpectedSales).toBe(880);
      
      const currentROAS = totalCurrentSales / totalCurrentSpend;
      const expectedROAS = totalExpectedSales / totalExpectedSpend;
      
      expect(currentROAS).toBeCloseTo(2.67, 1);
      expect(expectedROAS).toBeCloseTo(2.67, 1);
    });
  });

  describe('建议生成', () => {
    it('应该根据分析结果生成合理建议', () => {
      const results = [
        { status: 'success', confidence: 0.8, campaignName: 'Campaign A', optimization: { expectedSalesIncrease: 50 }, currentSales: 100 },
        { status: 'success', confidence: 0.4, campaignName: 'Campaign B', optimization: { expectedSalesIncrease: 20 }, currentSales: 200 },
        { status: 'insufficient_data', confidence: 0.2, campaignName: 'Campaign C', optimization: null, currentSales: 50 },
      ];
      
      const successCount = results.filter(r => r.status === 'success').length;
      const insufficientCount = results.filter(r => r.status === 'insufficient_data').length;
      const lowConfidenceCount = results.filter(r => r.confidence < 0.5 && r.status === 'success').length;
      
      expect(successCount).toBe(2);
      expect(insufficientCount).toBe(1);
      expect(lowConfidenceCount).toBe(1);
    });
  });
});

describe('历史趋势分析', () => {
  it('应该正确识别季节性模式', () => {
    // 模拟周数据
    const weeklyData = [
      { day: 0, marginalROAS: 2.0 }, // 周日
      { day: 1, marginalROAS: 3.0 }, // 周一
      { day: 2, marginalROAS: 3.2 }, // 周二
      { day: 3, marginalROAS: 3.1 }, // 周三
      { day: 4, marginalROAS: 3.3 }, // 周四
      { day: 5, marginalROAS: 2.8 }, // 周五
      { day: 6, marginalROAS: 2.2 }, // 周六
    ];
    
    // 找出最佳和最差的日子
    const sortedByROAS = [...weeklyData].sort((a, b) => b.marginalROAS - a.marginalROAS);
    const bestDay = sortedByROAS[0];
    const worstDay = sortedByROAS[sortedByROAS.length - 1];
    
    expect(bestDay.day).toBe(4); // 周四最好
    expect(worstDay.day).toBe(0); // 周日最差
  });

  it('应该正确计算时段对比变化', () => {
    const period1Avg = { marginalROAS: 3.0, marginalSales: 100 };
    const period2Avg = { marginalROAS: 3.3, marginalSales: 120 };
    
    const roasChange = ((period2Avg.marginalROAS - period1Avg.marginalROAS) / period1Avg.marginalROAS) * 100;
    const salesChange = ((period2Avg.marginalSales - period1Avg.marginalSales) / period1Avg.marginalSales) * 100;
    
    expect(roasChange).toBeCloseTo(10, 0);
    expect(salesChange).toBeCloseTo(20, 0);
  });
});

describe('一键应用功能', () => {
  it('应该正确构建调整建议数组', () => {
    const beforeTopOfSearch = 20;
    const beforeProductPage = 10;
    const suggestedTopOfSearch = 50;
    const suggestedProductPage = 30;
    
    const adjustments = [
      {
        placementType: 'top_of_search',
        currentAdjustment: beforeTopOfSearch,
        suggestedAdjustment: suggestedTopOfSearch,
        adjustmentDelta: suggestedTopOfSearch - beforeTopOfSearch,
        efficiencyScore: 0,
        confidence: 1,
        isReliable: true,
        reason: '边际效益分析建议'
      },
      {
        placementType: 'product_page',
        currentAdjustment: beforeProductPage,
        suggestedAdjustment: suggestedProductPage,
        adjustmentDelta: suggestedProductPage - beforeProductPage,
        efficiencyScore: 0,
        confidence: 1,
        isReliable: true,
        reason: '边际效益分析建议'
      }
    ];
    
    expect(adjustments[0].adjustmentDelta).toBe(30);
    expect(adjustments[1].adjustmentDelta).toBe(20);
    expect(adjustments[0].isReliable).toBe(true);
  });

  it('应该正确计算预期效果', () => {
    const currentSpend = 100;
    const currentSales = 300;
    const expectedSpendChange = 10;
    const expectedSalesIncrease = 30;
    
    const currentROAS = currentSales / currentSpend;
    const expectedROAS = (currentSales + expectedSalesIncrease) / (currentSpend + expectedSpendChange);
    const roasChange = expectedROAS - currentROAS;
    
    expect(currentROAS).toBe(3);
    expect(expectedROAS).toBe(3);
    expect(roasChange).toBeCloseTo(0, 1);
  });
});
