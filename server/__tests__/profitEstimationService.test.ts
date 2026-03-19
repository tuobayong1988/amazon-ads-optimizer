/**
 * profitEstimationService (v272 修正版) 测试
 * 
 * 验证广告投放效率评估模型完全基于广告原生指标，
 * 不涉及任何商品成本(COGS)或利润率假设。
 */

import { describe, it, expect } from 'vitest';
import {
  calculateAdEfficiencyMetrics,
  calculateProfitMetrics,
  calculateProfitConstrainedMaxBid,
  isBidProfitable,
  recordProfitSnapshot,
  getProfitTrend,
  type ProfitConfig,
} from '../budget/profitEstimationService';

describe('profitEstimationService v272 修正版', () => {
  
  describe('设计原则验证', () => {
    it('ProfitConfig类型不应包含有效的costOfGoods字段', () => {
      const config: ProfitConfig = {
        profitMarginPercent: 25,
        costOfGoods: null,
        averageSellingPrice: null,
        mode: 'ad_efficiency',
        dataSource: 'target_config',
        dataConfidence: 0.95,
      };
      expect(config.costOfGoods).toBeNull();
      expect(config.averageSellingPrice).toBeNull();
    });

    it('模块不应导出任何COGS相关函数', async () => {
      // 确保模块不再导出getRealProfitDataForAccount或getProfitMarginFromMarketCurve
      const moduleExports = await import('../profitEstimationService');
      expect((moduleExports as any).getRealProfitDataForAccount).toBeUndefined();
      expect((moduleExports as any).getProfitMarginFromMarketCurve).toBeUndefined();
    });
  });

  describe('calculateAdEfficiencyMetrics - 核心广告效率评估', () => {
    it('应该对优秀的广告表现给出高分', () => {
      // ACOS=10%, ROAS=10x, 高转化
      const result = calculateAdEfficiencyMetrics(
        10000,  // totalSales
        1000,   // totalSpend
        25,     // targetAcos
        100000, // impressions
        2000,   // clicks
        200,    // orders
      );
      
      expect(result.overallEfficiencyScore).toBeGreaterThanOrEqual(70);
      expect(result.acosHealthScore).toBeGreaterThanOrEqual(80);
      expect(result.roasHealthScore).toBeGreaterThanOrEqual(90);
      expect(result.insights.length).toBeGreaterThan(0);
    });

    it('应该对差的广告表现给出低分', () => {
      // ACOS=80%, ROAS=1.25x
      const result = calculateAdEfficiencyMetrics(
        1250,   // totalSales
        1000,   // totalSpend
        25,     // targetAcos
        50000,  // impressions
        500,    // clicks
        5,      // orders
      );
      
      expect(result.overallEfficiencyScore).toBeLessThan(40);
      expect(result.acosHealthScore).toBeLessThan(20);
    });

    it('应该正确处理零花费的情况', () => {
      const result = calculateAdEfficiencyMetrics(0, 0, 25);
      expect(result.overallEfficiencyScore).toBe(0);
    });

    it('ACOS达标时应给出合理的ACOS健康度评分', () => {
      // ACOS=20% vs 目标25% → 达标
      const result = calculateAdEfficiencyMetrics(
        5000, 1000, 25, 50000, 1000, 50
      );
      expect(result.acosHealthScore).toBeGreaterThanOrEqual(60);
    });

    it('ACOS严重超标时应给出低分', () => {
      // ACOS=60% vs 目标25% → 严重超标
      const result = calculateAdEfficiencyMetrics(
        1667, 1000, 25, 50000, 1000, 20
      );
      expect(result.acosHealthScore).toBeLessThan(20);
    });

    it('应该生成有价值的洞察', () => {
      const result = calculateAdEfficiencyMetrics(
        5000, 1000, 25, 100000, 2000, 100
      );
      expect(result.insights.length).toBeGreaterThan(0);
      // 洞察应该提到ACOS或ROAS
      const hasRelevantInsight = result.insights.some(
        i => i.includes('ACOS') || i.includes('ROAS')
      );
      expect(hasRelevantInsight).toBe(true);
    });

    it('数据量不足时应提示', () => {
      const result = calculateAdEfficiencyMetrics(
        50, 5, 25, 1000, 10, 1
      );
      const hasDataWarning = result.insights.some(i => i.includes('数据量不足') || i.includes('花费较少'));
      expect(hasDataWarning).toBe(true);
    });

    it('应该正确判断效率趋势', () => {
      // ROAS从2.0提升到3.0 → improving
      const result = calculateAdEfficiencyMetrics(
        3000, 1000, 25, 50000, 1000, 50, 2.0
      );
      expect(result.efficiencyTrend).toBe('improving');
    });

    it('应该正确判断效率下降趋势', () => {
      // ROAS从5.0下降到2.0 → declining
      const result = calculateAdEfficiencyMetrics(
        2000, 1000, 25, 50000, 1000, 50, 5.0
      );
      expect(result.efficiencyTrend).toBe('declining');
    });
  });

  describe('calculateProfitMetrics - 兼容旧接口', () => {
    it('应该基于广告指标返回合理的评分', () => {
      const config: ProfitConfig = {
        profitMarginPercent: 25,
        costOfGoods: null,
        averageSellingPrice: null,
        mode: 'ad_efficiency',
        dataSource: 'target_config',
        dataConfidence: 0.95,
      };
      
      const result = calculateProfitMetrics(5000, 1000, config);
      
      expect(result.profitRoas).toBe(5.0); // ROAS = 5000/1000
      expect(result.adProfit).toBe(4000); // 投产净值 = 5000-1000
      expect(result.profitHealthScore).toBeGreaterThan(0);
      expect(result.profitHealthScore).toBeLessThanOrEqual(100);
      expect(result.detail).toContain('ACOS');
      expect(result.detail).toContain('ROAS');
      // 不应包含COGS或利润率假设
      expect(result.detail).not.toContain('COGS');
      expect(result.detail).not.toContain('利润率');
    });

    it('应该正确处理零销售的情况', () => {
      const config: ProfitConfig = {
        profitMarginPercent: 25,
        costOfGoods: null,
        averageSellingPrice: null,
        mode: 'ad_efficiency',
        dataSource: 'industry_benchmark',
        dataConfidence: 0.4,
      };
      
      const result = calculateProfitMetrics(0, 100, config);
      expect(result.profitRoas).toBe(0);
      expect(result.adProfit).toBe(-100);
    });
  });

  describe('calculateProfitConstrainedMaxBid - 基于ACOS的出价约束', () => {
    it('应该基于AOV、目标ACOS比率和CVR计算最大出价', () => {
      // AOV=$50, targetAcosRatio=0.25 (25% ACOS), CVR=10%
      const maxBid = calculateProfitConstrainedMaxBid(50, 0.25, 0.10);
      // 理论最大出价 = 50 × 0.25 × 0.10 = $1.25, 安全系数0.8 → $1.00
      expect(maxBid).toBe(1.00);
    });

    it('应该在无效输入时返回0', () => {
      expect(calculateProfitConstrainedMaxBid(0, 0.25, 0.10)).toBe(0);
      expect(calculateProfitConstrainedMaxBid(50, 0, 0.10)).toBe(0);
      expect(calculateProfitConstrainedMaxBid(50, 0.25, 0)).toBe(0);
    });
  });

  describe('isBidProfitable - 出价安全性判断', () => {
    it('应该正确判断出价是否在ACOS目标范围内', () => {
      // AOV=$50, targetAcosRatio=0.25, CVR=10%
      // maxCostPerClick = 50 × 0.10 × 0.25 = $1.25
      const result = isBidProfitable(0.80, 50, 0.25, 0.10);
      expect(result.isProfitable).toBe(true);
      expect(result.profitPerClick).toBeGreaterThan(0);
    });

    it('出价过高时应判断为不安全', () => {
      const result = isBidProfitable(5.00, 50, 0.25, 0.10);
      expect(result.isProfitable).toBe(false);
      expect(result.profitPerClick).toBeLessThan(0);
    });
  });

  describe('趋势追踪', () => {
    it('应该正确记录和获取效率趋势', () => {
      const targetId = 99999;
      
      // 记录一系列ROAS递增的快照
      recordProfitSnapshot(targetId, 2.0, 100);
      recordProfitSnapshot(targetId, 2.2, 120);
      recordProfitSnapshot(targetId, 2.5, 150);
      recordProfitSnapshot(targetId, 3.0, 200);
      
      const trend = getProfitTrend(targetId);
      expect(trend.trend).toBe('improving');
      expect(trend.entries).toBeGreaterThanOrEqual(2);
      expect(trend.avgProfitRoas).toBeGreaterThan(0);
    });

    it('数据不足时应返回unknown趋势', () => {
      const trend = getProfitTrend(88888);
      expect(trend.trend).toBe('unknown');
      expect(trend.entries).toBe(0);
    });
  });

  describe('ROAS评分基准验证', () => {
    it('ROAS=7x应该获得90+的ROAS健康度评分', () => {
      const result = calculateAdEfficiencyMetrics(7000, 1000, 25);
      expect(result.roasHealthScore).toBeGreaterThanOrEqual(90);
    });

    it('ROAS=4x应该获得70+的ROAS健康度评分', () => {
      const result = calculateAdEfficiencyMetrics(4000, 1000, 25);
      expect(result.roasHealthScore).toBeGreaterThanOrEqual(70);
    });

    it('ROAS=2.5x应该获得50+的ROAS健康度评分', () => {
      const result = calculateAdEfficiencyMetrics(2500, 1000, 25);
      expect(result.roasHealthScore).toBeGreaterThanOrEqual(50);
    });

    it('ROAS=0.5x应该获得较低的ROAS健康度评分', () => {
      const result = calculateAdEfficiencyMetrics(500, 1000, 25);
      expect(result.roasHealthScore).toBeLessThan(15);
    });
  });
});
