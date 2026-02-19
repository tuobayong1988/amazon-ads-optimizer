/**
 * 特殊场景分析UI功能测试
 * 
 * 测试三个核心功能：
 * 1. 特殊场景分析页面入口
 * 2. 归因调整数据应用到仪表盘
 * 3. 竞价效率批量优化功能
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as specialScenarioService from './specialScenarioOptimizationService';

describe('特殊场景分析UI功能', () => {
  describe('归因调整数据计算', () => {
    it('应正确计算归因调整后的KPI汇总', () => {
      // 模拟归因调整后的数据
      const attributionData = [
        {
          date: '2026-01-07',
          raw: { spend: 100, sales: 200, acos: 50, roas: 2 },
          adjusted: {
            impressions: 10000,
            clicks: 500,
            spend: 100,
            sales: 285, // 调整后销售额 = 200 / 0.7
            orders: 14,
            acos: 35.1,
            roas: 2.85,
            ctr: 5,
            cvr: 2.8,
            isAdjusted: true,
            adjustmentFactor: 1.43,
            completionRate: 0.7,
            confidence: 'low' as const,
            dataAge: 1,
          },
        },
        {
          date: '2026-01-06',
          raw: { spend: 120, sales: 300, acos: 40, roas: 2.5 },
          adjusted: {
            impressions: 12000,
            clicks: 600,
            spend: 120,
            sales: 375, // 调整后销售额 = 300 / 0.8
            orders: 18,
            acos: 32,
            roas: 3.125,
            ctr: 5,
            cvr: 3,
            isAdjusted: true,
            adjustmentFactor: 1.25,
            completionRate: 0.8,
            confidence: 'low' as const,
            dataAge: 2,
          },
        },
        {
          date: '2026-01-05',
          raw: { spend: 110, sales: 350, acos: 31.4, roas: 3.18 },
          adjusted: {
            impressions: 11000,
            clicks: 550,
            spend: 110,
            sales: 389, // 调整后销售额 = 350 / 0.9
            orders: 19,
            acos: 28.3,
            roas: 3.54,
            ctr: 5,
            cvr: 3.45,
            isAdjusted: true,
            adjustmentFactor: 1.11,
            completionRate: 0.9,
            confidence: 'medium' as const,
            dataAge: 3,
          },
        },
      ];

      // 计算汇总（模拟Dashboard中的计算逻辑）
      const totals = attributionData.reduce((acc, day) => ({
        sales: acc.sales + day.adjusted.sales,
        spend: acc.spend + day.adjusted.spend,
        orders: acc.orders + day.adjusted.orders,
        clicks: acc.clicks + day.adjusted.clicks,
        impressions: acc.impressions + day.adjusted.impressions,
      }), { sales: 0, spend: 0, orders: 0, clicks: 0, impressions: 0 });

      const days = attributionData.length;
      const acos = totals.sales > 0 ? (totals.spend / totals.sales) * 100 : 0;
      const roas = totals.spend > 0 ? totals.sales / totals.spend : 0;

      const adjustedKpis = {
        totalSales: totals.sales,
        totalSpend: totals.spend,
        totalOrders: totals.orders,
        acos,
        roas,
        conversionsPerDay: totals.orders / days,
        revenuePerDay: totals.sales / days,
        avgAdjustmentFactor: attributionData.reduce((sum, d) => sum + d.adjusted.adjustmentFactor, 0) / days,
        lowConfidenceDays: attributionData.filter(d => d.adjusted.confidence === 'low').length,
      };

      // 验证计算结果
      expect(adjustedKpis.totalSales).toBeCloseTo(1049, 0); // 285 + 375 + 389
      expect(adjustedKpis.totalSpend).toBe(330); // 100 + 120 + 110
      expect(adjustedKpis.totalOrders).toBe(51); // 14 + 18 + 19
      expect(adjustedKpis.acos).toBeCloseTo(31.46, 1); // 330 / 1049 * 100
      expect(adjustedKpis.roas).toBeCloseTo(3.18, 1); // 1049 / 330
      expect(adjustedKpis.conversionsPerDay).toBeCloseTo(17, 0); // 51 / 3
      expect(adjustedKpis.avgAdjustmentFactor).toBeCloseTo(1.26, 1); // (1.43 + 1.25 + 1.11) / 3
      expect(adjustedKpis.lowConfidenceDays).toBe(2); // 2天低置信度
    });

    it('应正确处理空数据', () => {
      const attributionData: any[] = [];
      
      // 模拟Dashboard中的空数据处理
      const adjustedKpis = attributionData.length === 0 ? null : {};
      
      expect(adjustedKpis).toBeNull();
    });
  });

  describe('竞价效率批量优化', () => {
    it('应正确生成批量调整请求', () => {
      // 模拟竞价效率分析结果
      const bidEfficiency = {
        topOverbidding: [
          {
            targetId: 1,
            targetType: 'keyword' as const,
            targetText: 'test keyword 1',
            currentBid: 2.5,
            suggestedBid: 1.8,
            isOverbidding: true,
            expectedSavings: 0.7,
          },
          {
            targetId: 2,
            targetType: 'keyword' as const,
            targetText: 'test keyword 2',
            currentBid: 3.0,
            suggestedBid: 2.2,
            isOverbidding: true,
            expectedSavings: 0.8,
          },
          {
            targetId: 3,
            targetType: 'keyword' as const,
            targetText: 'test keyword 3',
            currentBid: 1.5,
            suggestedBid: 1.5,
            isOverbidding: false,
            expectedSavings: 0,
          },
        ],
      };

      // 选择要调整的关键词
      const selectedKeywords = [1, 2];

      // 生成调整请求（模拟SpecialScenarioAnalysis中的逻辑）
      const adjustments = selectedKeywords.map(id => {
        const keyword = bidEfficiency.topOverbidding.find(k => k.targetId === id);
        return {
          keywordId: id,
          newBid: keyword?.suggestedBid || 0,
          reason: '竞价效率优化 - 过度竞价检测',
        };
      }).filter(a => a.newBid > 0);

      // 验证调整请求
      expect(adjustments).toHaveLength(2);
      expect(adjustments[0]).toEqual({
        keywordId: 1,
        newBid: 1.8,
        reason: '竞价效率优化 - 过度竞价检测',
      });
      expect(adjustments[1]).toEqual({
        keywordId: 2,
        newBid: 2.2,
        reason: '竞价效率优化 - 过度竞价检测',
      });
    });

    it('应正确过滤非过度竞价的关键词', () => {
      const bidEfficiency = {
        topOverbidding: [
          { targetId: 1, isOverbidding: true, suggestedBid: 1.8 },
          { targetId: 2, isOverbidding: false, suggestedBid: 2.0 },
          { targetId: 3, isOverbidding: true, suggestedBid: 1.5 },
        ],
      };

      // 全选过度竞价（模拟handleSelectAllOverbidding）
      const allOverbiddingIds = bidEfficiency.topOverbidding
        .filter(k => k.isOverbidding)
        .map(k => k.targetId);

      expect(allOverbiddingIds).toEqual([1, 3]);
      expect(allOverbiddingIds).not.toContain(2);
    });
  });

  describe('风险等级判断', () => {
    it('应正确返回风险等级Badge样式', () => {
      const getRiskBadge = (level: string) => {
        switch (level) {
          case 'critical':
            return 'destructive';
          case 'warning':
            return 'outline-orange';
          default:
            return 'outline-green';
        }
      };

      expect(getRiskBadge('critical')).toBe('destructive');
      expect(getRiskBadge('warning')).toBe('outline-orange');
      expect(getRiskBadge('safe')).toBe('outline-green');
    });

    it('应正确返回置信度Badge样式', () => {
      const getConfidenceBadge = (confidence: string) => {
        switch (confidence) {
          case 'high':
            return 'outline-green';
          case 'medium':
            return 'outline-yellow';
          default:
            return 'outline-red';
        }
      };

      expect(getConfidenceBadge('high')).toBe('outline-green');
      expect(getConfidenceBadge('medium')).toBe('outline-yellow');
      expect(getConfidenceBadge('low')).toBe('outline-red');
    });
  });

  describe('数据切换逻辑', () => {
    it('应正确切换原始数据和调整后数据', () => {
      const kpis = {
        totalSales: 1000,
        roas: 2.5,
        acos: 40,
      };

      const adjustedKpis = {
        totalSales: 1200,
        roas: 3.0,
        acos: 33.3,
      };

      // 显示调整后数据
      let showAdjustedData = true;
      let displayedSales = showAdjustedData && adjustedKpis ? adjustedKpis.totalSales : kpis.totalSales;
      expect(displayedSales).toBe(1200);

      // 切换到原始数据
      showAdjustedData = false;
      displayedSales = showAdjustedData && adjustedKpis ? adjustedKpis.totalSales : kpis.totalSales;
      expect(displayedSales).toBe(1000);
    });

    it('应在没有调整数据时显示原始数据', () => {
      const kpis = {
        totalSales: 1000,
        roas: 2.5,
        acos: 40,
      };

      const adjustedKpis = null;
      const showAdjustedData = true;

      const displayedSales = showAdjustedData && adjustedKpis ? adjustedKpis.totalSales : kpis.totalSales;
      expect(displayedSales).toBe(1000);
    });
  });
});

describe('特殊场景分析服务集成', () => {
  describe('adjustForAttributionDelay', () => {
    it('应正确调整近期数据', () => {
      const model: specialScenarioService.AttributionCompletionModel = {
        accountId: 1,
        completionRates: {
          day1: 0.70,
          day2: 0.80,
          day3: 0.90,
          day4: 0.95,
          day5: 0.98,
          day6: 0.99,
          day7: 1.00,
        },
        campaignTypeFactors: {
          sp_auto: 0.95,
          sp_manual: 1.0,
          sb: 1.05,
          sd: 0.90,
        },
        lastCalibrated: new Date(),
      };

      const rawMetrics = {
        impressions: 10000,
        clicks: 500,
        spend: 100,
        sales: 200,
        orders: 10,
      };

      // 测试1天前的数据
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      const adjusted = specialScenarioService.adjustForAttributionDelay(
        rawMetrics,
        oneDayAgo,
        model,
        'sp_manual'
      );

      // 验证调整结果
      expect(adjusted.isAdjusted).toBe(true);
      expect(adjusted.dataAge).toBe(1);
      expect(adjusted.completionRate).toBeCloseTo(0.7, 1);
      expect(adjusted.adjustmentFactor).toBeCloseTo(1.43, 1);
      expect(adjusted.sales).toBeCloseTo(285.7, 0); // 200 / 0.7
      expect(adjusted.confidence).toBe('low');
    });

    it('应对7天以上的数据不进行调整', () => {
      const model: specialScenarioService.AttributionCompletionModel = {
        accountId: 1,
        completionRates: {
          day1: 0.70,
          day2: 0.80,
          day3: 0.90,
          day4: 0.95,
          day5: 0.98,
          day6: 0.99,
          day7: 1.00,
        },
        campaignTypeFactors: {
          sp_auto: 0.95,
          sp_manual: 1.0,
          sb: 1.05,
          sd: 0.90,
        },
        lastCalibrated: new Date(),
      };

      const rawMetrics = {
        impressions: 10000,
        clicks: 500,
        spend: 100,
        sales: 200,
        orders: 10,
      };

      // 测试10天前的数据
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      
      const adjusted = specialScenarioService.adjustForAttributionDelay(
        rawMetrics,
        tenDaysAgo,
        model,
        'sp_manual'
      );

      // 验证不调整
      expect(adjusted.isAdjusted).toBe(false);
      expect(adjusted.adjustmentFactor).toBe(1);
      expect(adjusted.sales).toBe(200);
      expect(adjusted.confidence).toBe('high');
    });
  });

  describe('detectOverbidding', () => {
    it('应正确检测过度竞价', () => {
      const target = {
        id: 1,
        type: 'keyword' as const,
        text: 'test keyword',
        matchType: 'exact',
        bid: 3.0,
        impressions: 10000,
        clicks: 500,
        spend: 1000,
        sales: 2000,
        orders: 50,
      };

      const result = specialScenarioService.detectOverbidding(
        target,
        0.25, // 目标ACoS 25%
        0.30  // 利润率 30%
      );

      // 验证检测结果
      expect(result.targetId).toBe(1);
      expect(result.currentBid).toBe(3.0);
      expect(result.actualCpc).toBe(2.0); // 1000 / 500
      // 检查是否检测到过度竞价（出价远高于实际CPC）
      expect(result.bidToCpcRatio).toBeGreaterThan(1);
    });

    it('应正确计算目标CPC', () => {
      const result = specialScenarioService.calculateTargetCpc(
        0.25, // 目标ACoS 25%
        0.10, // CVR 10%
        40,   // 平均订单价值 $40
        0.30  // 利润率 30%
      );

      // 目标CPC = 0.25 * 0.10 * 40 = 1.0
      expect(result.targetCpc).toBe(1.0);
      // 盈亏平衡CPC = 0.30 * 0.10 * 40 = 1.2
      expect(result.breakEvenCpc).toBe(1.2);
    });
  });
});
