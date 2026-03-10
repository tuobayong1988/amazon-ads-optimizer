/**
 * 分析与报表路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as advancedAnalyticsService from '../advancedAnalyticsService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { verifyAccountAccess } from '../utils/accessControl';

// ==================== 趋势数据辅助函数 ====================
// 生成模拟的趋势数据（当没有真实历史数据时使用）
function generateSimulatedTrendData(target: Record<string, any>, days: number) {
  const data = [];
  const now = new Date();
  
  // 基础数据
  const baseImpressions = target.impressions || 1000;
  const baseClicks = target.clicks || 50;
  const baseSpend = parseFloat(target.spend || "10");
  const baseSales = parseFloat(target.sales || "30");
  const baseOrders = target.orders || 3;
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    // 添加随机波动（±30%）
    const variation = 0.7 + Math.random() * 0.6;
    const weekdayFactor = date.getDay() === 0 || date.getDay() === 6 ? 0.8 : 1.1;
    
    const impressions = Math.round((baseImpressions / days) * variation * weekdayFactor);
    const clicks = Math.round((baseClicks / days) * variation * weekdayFactor);
    const spend = Math.round((baseSpend / days) * variation * weekdayFactor * 100) / 100;
    const sales = Math.round((baseSales / days) * variation * weekdayFactor * 100) / 100;
    const orders = Math.round((baseOrders / days) * variation * weekdayFactor);
    
    const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
    const cvr = clicks > 0 ? (orders / clicks * 100) : 0;
    const acos = sales > 0 ? (spend / sales * 100) : 0;
    const roas = spend > 0 ? (sales / spend) : 0;
    const cpc = clicks > 0 ? (spend / clicks) : 0;
    
    data.push({
      date: date.toISOString().split('T')[0],
      impressions,
      clicks,
      spend,
      sales,
      orders,
      ctr: Math.round(ctr * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      acos: Math.round(acos * 100) / 100,
      roas: Math.round(roas * 100) / 100,
      cpc: Math.round(cpc * 100) / 100,
    });
  }
  
  return data;
}

// 计算趋势摘要数据
function calculateTrendSummary(data: any[]) {
  if (!data || data.length === 0) {
    return {
      totalImpressions: 0,
      totalClicks: 0,
      totalSpend: 0,
      totalSales: 0,
      totalOrders: 0,
      avgCtr: 0,
      avgCvr: 0,
      avgAcos: 0,
      avgRoas: 0,
      avgCpc: 0,
      trend: {
        impressions: 'stable',
        clicks: 'stable',
        spend: 'stable',
        sales: 'stable',
        acos: 'stable',
        roas: 'stable',
      },
    };
  }
  
  const totalImpressions = data.reduce((sum: any, d: any) => sum + d.impressions, 0);
  const totalClicks = data.reduce((sum: any, d: any) => sum + d.clicks, 0);
  const totalSpend = data.reduce((sum: any, d: any) => sum + d.spend, 0);
  const totalSales = data.reduce((sum: any, d: any) => sum + d.sales, 0);
  const totalOrders = data.reduce((sum: any, d: any) => sum + d.orders, 0);
  
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
  const avgCvr = totalClicks > 0 ? (totalOrders / totalClicks * 100) : 0;
  const avgAcos = totalSales > 0 ? (totalSpend / totalSales * 100) : 0;
  const avgRoas = totalSpend > 0 ? (totalSales / totalSpend) : 0;
  const avgCpc = totalClicks > 0 ? (totalSpend / totalClicks) : 0;
  
  // 计算趋势（对比前半段和后半段）
  const midPoint = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, midPoint);
  const secondHalf = data.slice(midPoint);
  
  const calcTrend = (metric: string) => {
    const firstAvg = firstHalf.reduce((sum: any, d: any) => sum + (d[metric] || 0), 0) / (firstHalf.length || 1);
    const secondAvg = secondHalf.reduce((sum: any, d: any) => sum + (d[metric] || 0), 0) / (secondHalf.length || 1);
    const change = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg * 100) : 0;
    
    if (change > 10) return 'up';
    if (change < -10) return 'down';
    return 'stable';
  };
  
  return {
    totalImpressions,
    totalClicks,
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalSales: Math.round(totalSales * 100) / 100,
    totalOrders,
    avgCtr: Math.round(avgCtr * 100) / 100,
    avgCvr: Math.round(avgCvr * 100) / 100,
    avgAcos: Math.round(avgAcos * 100) / 100,
    avgRoas: Math.round(avgRoas * 100) / 100,
    avgCpc: Math.round(avgCpc * 100) / 100,
    trend: {
      impressions: calcTrend('impressions'),
      clicks: calcTrend('clicks'),
      spend: calcTrend('spend'),
      sales: calcTrend('sales'),
      acos: calcTrend('acos'),
      roas: calcTrend('roas'),
    },
  };
}



// ==================== Analytics Router ====================
export const analyticsRouter = router({
  getDailyPerformance: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
      campaignId: z.number().optional(),
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return db.getDailyPerformanceByDateRange(
        input.accountId,
        new Date(input.startDate),
        new Date(input.endDate),
        input.campaignId
      );
    }),
  
  getSummary: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return db.getPerformanceSummary(
        input.accountId,
        new Date(input.startDate),
        new Date(input.endDate)
      );
    }),
  
  // 获取趋势数据（真实数据）
  getTrendData: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      days: z.number().optional().default(30),
      startDate: z.string().optional(),  // YYYY-MM-DD
      endDate: z.string().optional(),    // YYYY-MM-DD
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      // ✅ 支持自定义日期范围，默认近N天
      const endDate = input.endDate ? new Date(input.endDate) : new Date();
      const startDate = input.startDate ? new Date(input.startDate) : (() => {
        const d = new Date();
        d.setDate(d.getDate() - input.days);
        return d;
      })();
      
      // ✅ 使用按天聚合的查询，确保每天只有一条汇总记录
      const dailyAggregated = await db.getDailyPerformanceAggregatedByDate(
        input.accountId,
        startDate,
        endDate
      );
      
      if (!dailyAggregated || dailyAggregated.length === 0) {
        return [];
      }
      
      return dailyAggregated.map(day => {
        const sales = parseFloat(day.totalSales || '0');
        const spend = parseFloat(day.totalSpend || '0');
        const impressions = Number(day.totalImpressions) || 0;
        const clicks = Number(day.totalClicks) || 0;
        const orders = Number(day.totalOrders) || 0;
        
        return {
          date: day.date ? new Date(day.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : 'N/A',
          fullDate: day.date || new Date().toISOString().split('T')[0],
          sales,
          spend,
          impressions,
          clicks,
          orders,
          // ✅ 加权计算派生指标
          acos: sales > 0 ? (spend / sales) * 100 : 0,
          roas: spend > 0 ? sales / spend : 0,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
          cvr: clicks > 0 ? (orders / clicks) * 100 : 0,
          cpc: clicks > 0 ? spend / clicks : 0,
        };
      });
    }),
  
  // 获取周对比数据（真实数据）
  getWeeklyComparison: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0=周日, 1=周一, ...
      
      // 计算本周开始日期（周一）
      const thisWeekStart = new Date(today);
      thisWeekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      thisWeekStart.setHours(0, 0, 0, 0);
      
      // 计算上周开始日期
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      
      const lastWeekEnd = new Date(thisWeekStart);
      lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
      lastWeekEnd.setHours(23, 59, 59, 999);
      
      // ✅ 使用按天聚合的查询，避免同一天多条记录导致数据翻倍
      const [thisWeekData, lastWeekData] = await Promise.all([
        db.getDailyPerformanceAggregatedByDate(input.accountId, thisWeekStart, today),
        db.getDailyPerformanceAggregatedByDate(input.accountId, lastWeekStart, lastWeekEnd),
      ]);
      
      const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      
      // 按周几分组数据
      const result = weekDays.map((name: any, index: any) => {
        const thisWeekDay = thisWeekData?.find(d => {
          const date = new Date(d.date);
          const dow = date.getDay();
          return (dow === 0 ? 6 : dow - 1) === index;
        });
        
        const lastWeekDay = lastWeekData?.find(d => {
          const date = new Date(d.date);
          const dow = date.getDay();
          return (dow === 0 ? 6 : dow - 1) === index;
        });
        
        return {
          name,
          thisWeek: parseFloat(thisWeekDay?.totalSales || '0'),
          lastWeek: parseFloat(lastWeekDay?.totalSales || '0'),
        };
      });
      
      return result;
    }),

  getKPIs: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      startDate: z.string().optional(),  // YYYY-MM-DD
      endDate: z.string().optional(),    // YYYY-MM-DD
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      // ✅ 支持前端传入日期范围，默认近30天
      const endDate = input.endDate ? new Date(input.endDate) : new Date();
      const startDate = input.startDate ? new Date(input.startDate) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      // 计算实际天数（用于日均计算）
      const diffMs = endDate.getTime() - startDate.getTime();
      const days = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)) + 1); // +1包含开始日
      
      const summary = await db.getPerformanceSummary(input.accountId, startDate, endDate);
      
      // v230: 从数据库读取账户的真实货币代码，而非硬编码USD
      let accountCurrency = 'USD';
      try {
        const dbInstance = await db.getDb();
        if (dbInstance) {
          const { amazonApiCredentials } = await import('../../drizzle/schema');
          const [cred] = await dbInstance.select({ currencyCode: amazonApiCredentials.currencyCode })
            .from(amazonApiCredentials)
            .where(eq(amazonApiCredentials.accountId, input.accountId))
            .limit(1);
          if (cred?.currencyCode) {
            accountCurrency = cred.currencyCode;
          }
        }
      } catch (e) {
        // 查询失败时使用默认USD
      }
      
      const emptyResult = {
        conversionsPerDay: 0,
        roas: 0,
        totalSales: 0,
        acos: 0,
        revenuePerDay: 0,
        totalSpend: 0,
        totalOrders: 0,
        totalClicks: 0,
        totalImpressions: 0,
        ctr: 0,
        cvr: 0,
        cpc: 0,
        days,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        currency: accountCurrency,
        dataMaturity: null as null | { sp: string; sb: string; sd: string; overall: string; message: string },
      };
      
      if (!summary) {
        return emptyResult;
      }
      
      const totalSpend = parseFloat(summary.totalSpend || "0");
      const totalSales = parseFloat(summary.totalSales || "0");
      const totalClicks = summary.totalClicks || 0;
      const totalImpressions = summary.totalImpressions || 0;
      const totalOrders = summary.totalOrders || 0;
      
      // ✅ 计算归因期数据成熟度
      // SP归因期=7天, SB/SD归因期=14天
      const now = new Date();
      const daysSinceEnd = Math.ceil((now.getTime() - endDate.getTime()) / (24 * 60 * 60 * 1000));
      const spDataMaturity = daysSinceEnd >= 7 ? 'finalized' : 'pending'; // SP 7天归因
      const sbSdDataMaturity = daysSinceEnd >= 14 ? 'finalized' : 'pending'; // SB/SD 14天归因
      
      return {
        conversionsPerDay: totalOrders / days,
        // ✅ 加权计算派生指标，而非简单平均
        roas: totalSpend > 0 ? totalSales / totalSpend : 0,
        totalSales,
        acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
        revenuePerDay: totalSales / days,
        totalSpend,
        totalOrders,
        totalClicks,
        totalImpressions,
        // ✅ 新增派生指标
        ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
        cvr: totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0,
        cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
        days,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        currency: accountCurrency,
        // ✅ 归因期数据成熟度标注
        dataMaturity: {
          sp: spDataMaturity,
          sb: sbSdDataMaturity,
          sd: sbSdDataMaturity,
          overall: spDataMaturity === 'finalized' && sbSdDataMaturity === 'finalized' ? 'finalized' : 'pending',
          message: spDataMaturity === 'finalized' && sbSdDataMaturity === 'finalized' 
            ? '所有广告类型的归因数据已稳定' 
            : daysSinceEnd < 7 
              ? `近${daysSinceEnd}天数据尚在归因窗口内（SP:7天, SB/SD:14天），转化数据可能不完整`
              : `SB/SD广告的近${14 - daysSinceEnd}天数据尚在归因窗口内，转化数据可能不完整`,
        },
      };
    }),
  
  // 区域级别数据对比
  getRegionComparison: protectedProcedure
    .input(z.object({ 
      userId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }: any) => {
      // 定义区域映射
      const REGIONS: Record<string, { name: string; flag: string; marketplaces: string[] }> = {
        NA: { name: '北美区域', flag: '🇺🇸', marketplaces: ['US', 'CA', 'MX', 'BR'] },
        EU: { name: '欧洲区域', flag: '🇪🇺', marketplaces: ['UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'AE', 'SA', 'IN'] },
        FE: { name: '远东区域', flag: '🌏', marketplaces: ['JP', 'AU', 'SG'] },
      };
      
      // 获取用户所有账号
      const accounts = await db.getAdAccountsByUserId(input.userId);
      
      // 计算日期范围（默认最近30天，支持自定义）
      const endDate = input.endDate ? new Date(input.endDate) : new Date();
      const startDate = input.startDate ? new Date(input.startDate) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      // 按区域汇总数据
      const regionData: Record<string, {
        region: string;
        regionName: string;
        flag: string;
        accountCount: number;
        totalSales: number;
        totalSpend: number;
        totalOrders: number;
        totalClicks: number;
        totalImpressions: number;
        acos: number;
        roas: number;
        ctr: number;
        cvr: number;
        marketplaces: string[];
      }> = {};
      
      // 初始化区域数据
      for (const [regionId, regionInfo] of Object.entries(REGIONS)) {
        regionData[regionId] = {
          region: regionId,
          regionName: regionInfo.name,
          flag: regionInfo.flag,
          accountCount: 0,
          totalSales: 0,
          totalSpend: 0,
          totalOrders: 0,
          totalClicks: 0,
          totalImpressions: 0,
          acos: 0,
          roas: 0,
          ctr: 0,
          cvr: 0,
          marketplaces: [],
        };
      }
      
      // 汇总每个账号的数据到对应区域
      for (const account of (accounts as any[])) {
        // 确定账号所属区域
        let accountRegion = 'NA'; // 默认北美
        for (const [regionId, regionInfo] of Object.entries(REGIONS)) {
          if (regionInfo.marketplaces.includes(account.marketplace)) {
            accountRegion = regionId;
            break;
          }
        }
        
        // 获取账号的性能数据
        const summary = await db.getPerformanceSummary(account.id, startDate, endDate);
        
        if (summary) {
          const sales = parseFloat(summary.totalSales || '0');
          const spend = parseFloat(summary.totalSpend || '0');
          const orders = summary.totalOrders || 0;
          const clicks = summary.totalClicks || 0;
          const impressions = summary.totalImpressions || 0;
          
          regionData[accountRegion].accountCount++;
          regionData[accountRegion].totalSales += sales;
          regionData[accountRegion].totalSpend += spend;
          regionData[accountRegion].totalOrders += orders;
          regionData[accountRegion].totalClicks += clicks;
          regionData[accountRegion].totalImpressions += impressions;
          
          // 添加站点到列表（去重）
          if (!regionData[accountRegion].marketplaces.includes(account.marketplace)) {
            regionData[accountRegion].marketplaces.push(account.marketplace);
          }
        }
      }
      
      // 计算派生指标
      for (const regionId of Object.keys(regionData)) {
        const data = regionData[regionId];
        data.acos = data.totalSales > 0 ? (data.totalSpend / data.totalSales) * 100 : 0;
        data.roas = data.totalSpend > 0 ? data.totalSales / data.totalSpend : 0;
        data.ctr = data.totalImpressions > 0 ? (data.totalClicks / data.totalImpressions) * 100 : 0;
        data.cvr = data.totalClicks > 0 ? (data.totalOrders / data.totalClicks) * 100 : 0;
      }
      
      // 返回有数据的区域
      return Object.values(regionData).filter(r => r.accountCount > 0);
    }),
});


// ==================== Advanced Analytics Router ====================
export const advancedAnalyticsRouter = router({
  // 获取高级分析仪表盘汇总
  getSummary: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      performanceGroupId: z.number().optional(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ ctx, input }: any) => {
      return advancedAnalyticsService.getAdvancedAnalyticsSummary(input);
    }),
  
  // 获取归因分析结果
  getAttribution: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      performanceGroupId: z.number().optional(),
      days: z.number().optional().default(30),
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
      eventCategory: z.string().optional(),
    }))
    .query(async ({ ctx, input }: any) => {
      return advancedAnalyticsService.getAttributionAnalysis(input);
    }),
  
  // 获取趋势分析
  getTrendAnalysis: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      performanceGroupId: z.number().optional(),
      days: z.number().optional().default(30),
      metrics: z.array(z.string()).optional(),
    }))
    .query(async ({ ctx, input }: any) => {
      return advancedAnalyticsService.getTrendAnalysis(input);
    }),
  
  // 获取异常检测结果
  getAnomalies: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      performanceGroupId: z.number().optional(),
      days: z.number().optional().default(30),
      sensitivity: z.number().optional().default(2),
    }))
    .query(async ({ ctx, input }: any) => {
      return advancedAnalyticsService.detectAnomalies(input);
    }),
  
  // 获取策略ROI对比
  getStrategyROI: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      performanceGroupId: z.number().optional(),
      days: z.number().optional().default(30),
      groupBy: z.enum(['strategy', 'actionType', 'eventCategory']).optional().default('strategy'),
    }))
    .query(async ({ ctx, input }: any) => {
      return advancedAnalyticsService.getStrategyROIComparison(input);
    }),
  
  // 手动触发效果追踪任务
  triggerEffectTracking: protectedProcedure
    .mutation(async () => {
      const results = await advancedAnalyticsService.runAllUnifiedTrackingTasks();
      return { success: true, message: '效果追踪任务执行完成', results };
    }),
});
