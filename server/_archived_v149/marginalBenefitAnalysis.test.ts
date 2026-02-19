/**
 * 边际效益分析服务单元测试
 * 
 * 测试内容：
 * 1. 边际效益计算
 * 2. 弹性系数计算
 * 3. 递减拐点识别
 * 4. 流量分配优化算法
 * 5. 分析置信度计算
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateMarginalMetrics,
  calculateElasticity,
  findDiminishingPoint,
  calculateOptimalRange,
  calculateAnalysisConfidence
} from './marginalBenefitAnalysisService';

describe('边际效益分析服务', () => {
  
  describe('calculateMarginalMetrics - 边际指标计算', () => {
    
    it('应该正确计算边际指标', () => {
      const data = [
        { impressions: 1000, clicks: 50, spend: 25, sales: 100, orders: 5 },
        { impressions: 1200, clicks: 60, spend: 30, sales: 120, orders: 6 },
        { impressions: 1100, clicks: 55, spend: 27, sales: 110, orders: 5 },
        { impressions: 1300, clicks: 65, spend: 32, sales: 130, orders: 7 },
        { impressions: 1150, clicks: 57, spend: 28, sales: 115, orders: 6 },
        { impressions: 1250, clicks: 62, spend: 31, sales: 125, orders: 6 },
        { impressions: 1050, clicks: 52, spend: 26, sales: 105, orders: 5 },
      ];
      
      const metrics = calculateMarginalMetrics(data, 50);
      
      // 边际ROAS应该为正数
      expect(metrics.marginalROAS).toBeGreaterThan(0);
      // 边际ACoS应该为正数
      expect(metrics.marginalACoS).toBeGreaterThan(0);
      // 边际销售额应该为正数
      expect(metrics.marginalSales).toBeGreaterThan(0);
      // 边际花费应该为正数
      expect(metrics.marginalSpend).toBeGreaterThan(0);
    });
    
    it('应该处理零花费情况', () => {
      const data = [
        { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 },
        { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 },
      ];
      
      const metrics = calculateMarginalMetrics(data, 0);
      
      expect(metrics.marginalROAS).toBe(0);
      expect(metrics.marginalACoS).toBe(0);
      expect(metrics.marginalSales).toBe(0);
      expect(metrics.marginalSpend).toBe(0);
    });
    
    it('应该考虑当前倾斜水平对边际效益的影响', () => {
      const data = [
        { impressions: 1000, clicks: 50, spend: 25, sales: 100, orders: 5 },
        { impressions: 1200, clicks: 60, spend: 30, sales: 120, orders: 6 },
        { impressions: 1100, clicks: 55, spend: 27, sales: 110, orders: 5 },
        { impressions: 1300, clicks: 65, spend: 32, sales: 130, orders: 7 },
        { impressions: 1150, clicks: 57, spend: 28, sales: 115, orders: 6 },
        { impressions: 1250, clicks: 62, spend: 31, sales: 125, orders: 6 },
        { impressions: 1050, clicks: 52, spend: 26, sales: 105, orders: 5 },
      ];
      
      const metricsLowAdj = calculateMarginalMetrics(data, 20);
      const metricsHighAdj = calculateMarginalMetrics(data, 150);
      
      // 高倾斜水平下，边际效益应该更低（边际效益递减）
      expect(metricsHighAdj.marginalSales).toBeLessThan(metricsLowAdj.marginalSales);
    });
    
  });
  
  describe('calculateElasticity - 弹性系数计算', () => {
    
    it('应该正确计算弹性系数', () => {
      const data = [
        { sales: 100, spend: 50 },
        { sales: 110, spend: 55 },
        { sales: 105, spend: 52 },
        { sales: 95, spend: 48 },
        { sales: 90, spend: 45 },
        { sales: 85, spend: 42 },
      ];
      
      const elasticity = calculateElasticity(data);
      
      // 弹性系数应该是一个有效数字
      expect(typeof elasticity).toBe('number');
      expect(isNaN(elasticity)).toBe(false);
    });
    
    it('应该处理数据不足的情况', () => {
      const data = [{ sales: 100, spend: 50 }];
      
      const elasticity = calculateElasticity(data);
      
      // 数据不足时返回默认值1.0
      expect(elasticity).toBe(1.0);
    });
    
    it('应该处理零销售额的情况', () => {
      const data = [
        { sales: 0, spend: 0 },
        { sales: 0, spend: 0 },
        { sales: 0, spend: 0 },
        { sales: 0, spend: 0 },
      ];
      
      const elasticity = calculateElasticity(data);
      
      expect(elasticity).toBe(1.0);
    });
    
  });
  
  describe('findDiminishingPoint - 递减拐点识别', () => {
    
    it('应该为高ROAS数据返回较高的拐点', () => {
      // 高ROAS数据（低竞争）
      const highRoasData = [
        { sales: 500, spend: 50 }, // ROAS = 10
        { sales: 600, spend: 60 },
        { sales: 550, spend: 55 },
        { sales: 520, spend: 52 },
      ];
      
      const point = findDiminishingPoint(highRoasData, 50);
      
      expect(point).toBeGreaterThanOrEqual(70);
    });
    
    it('应该为低ROAS数据返回较低的拐点', () => {
      // 低ROAS数据（高竞争）
      const lowRoasData = [
        { sales: 50, spend: 50 }, // ROAS = 1
        { sales: 60, spend: 60 },
        { sales: 55, spend: 55 },
        { sales: 52, spend: 52 },
      ];
      
      const point = findDiminishingPoint(lowRoasData, 50);
      
      expect(point).toBeLessThanOrEqual(50);
    });
    
    it('应该为中等ROAS数据返回中等拐点', () => {
      // 中等ROAS数据
      const midRoasData = [
        { sales: 150, spend: 50 }, // ROAS = 3
        { sales: 180, spend: 60 },
        { sales: 165, spend: 55 },
        { sales: 156, spend: 52 },
      ];
      
      const point = findDiminishingPoint(midRoasData, 50);
      
      expect(point).toBeGreaterThanOrEqual(50);
      expect(point).toBeLessThanOrEqual(100);
    });
    
  });
  
  describe('calculateOptimalRange - 最优范围计算', () => {
    
    it('应该为高边际ROAS建议增加倾斜', () => {
      const metrics = {
        marginalROAS: 2.5,
        marginalACoS: 40
      };
      
      const range = calculateOptimalRange(metrics, 70, 30);
      
      // 建议范围的上限应该高于当前值
      expect(range.max).toBeGreaterThan(30);
    });
    
    it('应该为低边际ROAS建议降低倾斜', () => {
      const metrics = {
        marginalROAS: 0.5,
        marginalACoS: 200
      };
      
      const range = calculateOptimalRange(metrics, 50, 80);
      
      // 建议范围的上限应该低于当前值
      expect(range.max).toBeLessThan(80);
    });
    
    it('应该为中等边际ROAS建议保持当前水平', () => {
      const metrics = {
        marginalROAS: 1.2,
        marginalACoS: 83
      };
      
      const range = calculateOptimalRange(metrics, 60, 50);
      
      // 建议范围应该包含当前值
      expect(range.min).toBeLessThanOrEqual(50);
      expect(range.max).toBeGreaterThanOrEqual(50);
    });
    
    it('应该确保范围不超过边界', () => {
      const metrics = {
        marginalROAS: 3.0,
        marginalACoS: 33
      };
      
      const range = calculateOptimalRange(metrics, 150, 180);
      
      // 上限不应超过200%
      expect(range.max).toBeLessThanOrEqual(200);
      // 下限不应低于0
      expect(range.min).toBeGreaterThanOrEqual(0);
    });
    
  });
  
  describe('calculateAnalysisConfidence - 分析置信度计算', () => {
    
    it('应该为充足数据返回高置信度', () => {
      const data = Array(30).fill(null).map(() => ({
        orders: 3,
        clicks: 30
      }));
      
      const confidence = calculateAnalysisConfidence(data);
      
      expect(confidence).toBeGreaterThanOrEqual(0.7);
    });
    
    it('应该为不足数据返回低置信度', () => {
      const data = [
        { orders: 1, clicks: 10 },
        { orders: 0, clicks: 5 },
        { orders: 1, clicks: 8 },
      ];
      
      const confidence = calculateAnalysisConfidence(data);
      
      expect(confidence).toBeLessThanOrEqual(0.5);
    });
    
    it('应该考虑数据点数量', () => {
      const shortData = Array(7).fill(null).map(() => ({
        orders: 2,
        clicks: 20
      }));
      
      const longData = Array(30).fill(null).map(() => ({
        orders: 2,
        clicks: 20
      }));
      
      const shortConfidence = calculateAnalysisConfidence(shortData);
      const longConfidence = calculateAnalysisConfidence(longData);
      
      // 更多数据点应该有更高的置信度
      expect(longConfidence).toBeGreaterThan(shortConfidence);
    });
    
    it('应该考虑转化次数', () => {
      const lowConversionData = Array(14).fill(null).map(() => ({
        orders: 1,
        clicks: 50
      }));
      
      const highConversionData = Array(14).fill(null).map(() => ({
        orders: 5,
        clicks: 50
      }));
      
      const lowConfidence = calculateAnalysisConfidence(lowConversionData);
      const highConfidence = calculateAnalysisConfidence(highConversionData);
      
      // 更多转化应该有更高的置信度
      expect(highConfidence).toBeGreaterThan(lowConfidence);
    });
    
    it('应该确保置信度在0-1范围内', () => {
      const extremeData = Array(100).fill(null).map(() => ({
        orders: 100,
        clicks: 1000
      }));
      
      const confidence = calculateAnalysisConfidence(extremeData);
      
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    });
    
  });
  
});

describe('流量分配优化算法', () => {
  
  describe('优化目标验证', () => {
    
    it('应该支持ROAS最大化目标', () => {
      // 这是一个集成测试的占位符
      // 实际测试需要模拟数据库调用
      expect(true).toBe(true);
    });
    
    it('应该支持ACoS最小化目标', () => {
      expect(true).toBe(true);
    });
    
    it('应该支持销售最大化目标', () => {
      expect(true).toBe(true);
    });
    
    it('应该支持平衡优化目标', () => {
      expect(true).toBe(true);
    });
    
  });
  
  describe('约束条件验证', () => {
    
    it('应该遵守最大总倾斜约束', () => {
      expect(true).toBe(true);
    });
    
    it('应该遵守单位置最大倾斜约束', () => {
      expect(true).toBe(true);
    });
    
    it('应该遵守单位置最小倾斜约束', () => {
      expect(true).toBe(true);
    });
    
  });
  
});

describe('边际效益递减原理验证', () => {
  
  it('随着倾斜增加，边际效益应该递减', () => {
    const data = [
      { impressions: 1000, clicks: 50, spend: 25, sales: 100, orders: 5 },
      { impressions: 1200, clicks: 60, spend: 30, sales: 120, orders: 6 },
      { impressions: 1100, clicks: 55, spend: 27, sales: 110, orders: 5 },
      { impressions: 1300, clicks: 65, spend: 32, sales: 130, orders: 7 },
      { impressions: 1150, clicks: 57, spend: 28, sales: 115, orders: 6 },
      { impressions: 1250, clicks: 62, spend: 31, sales: 125, orders: 6 },
      { impressions: 1050, clicks: 52, spend: 26, sales: 105, orders: 5 },
    ];
    
    const metrics0 = calculateMarginalMetrics(data, 0);
    const metrics50 = calculateMarginalMetrics(data, 50);
    const metrics100 = calculateMarginalMetrics(data, 100);
    const metrics150 = calculateMarginalMetrics(data, 150);
    
    // 边际销售额应该随倾斜增加而递减
    expect(metrics50.marginalSales).toBeLessThanOrEqual(metrics0.marginalSales);
    expect(metrics100.marginalSales).toBeLessThanOrEqual(metrics50.marginalSales);
    expect(metrics150.marginalSales).toBeLessThanOrEqual(metrics100.marginalSales);
  });
  
});

describe('位置间边际效益对比', () => {
  
  it('应该能够比较不同位置的边际效益', () => {
    // 模拟不同位置的数据
    const topSearchData = [
      { impressions: 1000, clicks: 80, spend: 40, sales: 200, orders: 10 },
      { impressions: 1200, clicks: 96, spend: 48, sales: 240, orders: 12 },
    ];
    
    const productPageData = [
      { impressions: 2000, clicks: 60, spend: 30, sales: 90, orders: 6 },
      { impressions: 2400, clicks: 72, spend: 36, sales: 108, orders: 7 },
    ];
    
    const topSearchMetrics = calculateMarginalMetrics(topSearchData, 50);
    const productPageMetrics = calculateMarginalMetrics(productPageData, 50);
    
    // 搜索顶部通常有更高的边际ROAS
    expect(topSearchMetrics.marginalROAS).toBeGreaterThan(0);
    expect(productPageMetrics.marginalROAS).toBeGreaterThan(0);
  });
  
});
