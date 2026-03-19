/**
 * v360: 位置倾斜ROI差异分析服务
 * 
 * 分析不同广告位置（Top of Search / Rest of Search / Product Page）的ROI差异，
 * 为位置倾斜调整提供数据驱动的决策依据。
 * 
 * 核心功能：
 * 1. 按位置计算ACoS、CVR、ROAS指标
 * 2. 识别高ROI位置和低ROI位置
 * 3. 生成位置倾斜调整建议
 */

import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db';
import { dailyPerformance, campaigns } from '../../drizzle/schema';
import { eq, and, gte, sql, inArray } from 'drizzle-orm';

const log = createModuleLogger('PlacementROI');

/** 位置类型 */
export type PlacementType = 'top_of_search' | 'rest_of_search' | 'product_page';

/** 单个位置的ROI分析结果 */
export interface PlacementRoiResult {
  placement: PlacementType;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
  cvr: number;
  roas: number;
  ctr: number;
  cpc: number;
  /** 相对于账户平均的ROI倍数 */
  roiMultiplier: number;
  /** 建议的倾斜调整方向 */
  adjustmentDirection: 'increase' | 'decrease' | 'maintain';
  /** 建议的倾斜幅度（百分比） */
  suggestedMultiplierChange: number;
}

/** 位置ROI分析报告 */
export interface PlacementRoiReport {
  accountId: number;
  performanceGroupId: number;
  analysisDate: string;
  lookbackDays: number;
  placements: PlacementRoiResult[];
  /** 最佳位置 */
  bestPlacement: PlacementType | null;
  /** 最差位置 */
  worstPlacement: PlacementType | null;
  /** ROI差异系数（最佳/最差的ROAS比值） */
  roiDivergenceRatio: number;
  /** 是否建议调整位置倾斜 */
  shouldAdjust: boolean;
  /** 调整建议摘要 */
  summary: string;
}

/**
 * 分析指定优化目标的位置ROI差异
 */
export async function analyzePlacementRoi(
  performanceGroupId: number,
  accountId: number,
  lookbackDays: number = 14
): Promise<PlacementRoiReport> {
  const db = await getDb();
  const analysisDate = new Date().toISOString().split('T')[0];
  
  const emptyReport: PlacementRoiReport = {
    accountId,
    performanceGroupId,
    analysisDate,
    lookbackDays,
    placements: [],
    bestPlacement: null,
    worstPlacement: null,
    roiDivergenceRatio: 1,
    shouldAdjust: false,
    summary: '数据不足，无法进行位置ROI分析',
  };
  
  if (!db) return emptyReport;
  
  try {
    // 获取该优化目标下的广告活动
    const groupCampaigns = await db.select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.performanceGroupId, performanceGroupId));
    
    if (groupCampaigns.length === 0) return emptyReport;
    
    const campaignIds = groupCampaigns.map(c => String(c.id));
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    // 查询带位置信息的绩效数据
    // 注意: daily_performance表中placement字段存储位置信息
    const placementData = await db.select({
      placement: sql<string>`COALESCE(daily_performance.placement, 'unknown')`,
      impressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
      clicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      spend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      sales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      orders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      gte(dailyPerformance.date, cutoffStr),
    ))
    .groupBy(sql`COALESCE(daily_performance.placement, 'unknown')`);
    
    if (placementData.length === 0) return emptyReport;
    
    // 计算总体指标
    const totalSpend = placementData.reduce((sum: number, p: Record<string, unknown>) => sum + Number(p.spend), 0);
    const totalSales = placementData.reduce((sum: number, p: Record<string, unknown>) => sum + Number(p.sales), 0);
    const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    
    // 计算每个位置的ROI指标
    const placements: PlacementRoiResult[] = placementData
      .filter(p => String(p.placement) !== 'unknown')
      .map(p => {
        const spend = Number(p.spend);
        const sales = Number(p.sales);
        const clicks = Number(p.clicks);
        const impressions = Number(p.impressions);
        const orders = Number(p.orders);
        
        const acos = sales > 0 ? (spend / sales) * 100 : 999;
        const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
        const roas = spend > 0 ? sales / spend : 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const cpc = clicks > 0 ? spend / clicks : 0;
        const roiMultiplier = avgRoas > 0 ? roas / avgRoas : 1;
        
        // 根据ROI倍数确定调整方向
        let adjustmentDirection: 'increase' | 'decrease' | 'maintain' = 'maintain';
        let suggestedMultiplierChange = 0;
        
        if (roiMultiplier > 1.3 && clicks >= 20) {
          adjustmentDirection = 'increase';
          suggestedMultiplierChange = Math.min(30, Math.round((roiMultiplier - 1) * 20));
        } else if (roiMultiplier < 0.7 && clicks >= 20) {
          adjustmentDirection = 'decrease';
          suggestedMultiplierChange = Math.min(30, Math.round((1 - roiMultiplier) * 20));
        }
        
        return {
          placement: normalizePlacement(String(p.placement)),
          impressions,
          clicks,
          spend,
          sales,
          orders,
          acos,
          cvr,
          roas,
          ctr,
          cpc,
          roiMultiplier,
          adjustmentDirection,
          suggestedMultiplierChange,
        };
      });
    
    if (placements.length === 0) return emptyReport;
    
    // 找出最佳和最差位置
    const sortedByRoas = [...placements].sort((a: unknown, b: unknown) => b.roas - a.roas);
    const bestPlacement = sortedByRoas[0]?.placement || null;
    const worstPlacement = sortedByRoas[sortedByRoas.length - 1]?.placement || null;
    
    const bestRoas = sortedByRoas[0]?.roas || 0;
    const worstRoas = sortedByRoas[sortedByRoas.length - 1]?.roas || 0;
    const roiDivergenceRatio = worstRoas > 0 ? bestRoas / worstRoas : 999;
    
    // 判断是否需要调整
    const shouldAdjust = roiDivergenceRatio > 1.5 && placements.some(p => p.clicks >= 20);
    
    // 生成摘要
    const summary = shouldAdjust
      ? `位置ROI差异显著(${roiDivergenceRatio.toFixed(1)}x): ${bestPlacement}表现最佳(ROAS=${bestRoas.toFixed(2)}), ${worstPlacement}表现最差(ROAS=${worstRoas.toFixed(2)}), 建议调整位置倾斜`
      : `位置ROI差异较小(${roiDivergenceRatio.toFixed(1)}x), 当前位置倾斜策略合理`;
    
    log.info(`[PlacementROI] 分析完成: group=${performanceGroupId}, 位置数=${placements.length}, 差异=${roiDivergenceRatio.toFixed(1)}x, 建议调整=${shouldAdjust}`);
    
    return {
      accountId,
      performanceGroupId,
      analysisDate,
      lookbackDays,
      placements,
      bestPlacement,
      worstPlacement,
      roiDivergenceRatio,
      shouldAdjust,
      summary,
    };
  } catch (error) {
    log.warn(`[PlacementROI] 分析失败: ${(error as Error).message}`);
    return emptyReport;
  }
}

/**
 * 标准化位置名称
 */
function normalizePlacement(raw: string): PlacementType {
  const lower = raw.toLowerCase();
  if (lower.includes('top') && lower.includes('search')) return 'top_of_search';
  if (lower.includes('product') || lower.includes('detail')) return 'product_page';
  return 'rest_of_search';
}

/**
 * 获取指定位置的ROI数据（供gradualOptimizationEngine使用）
 */
export async function getPlacementRoiData(
  performanceGroupId: number,
  accountId: number,
  placement: string
): Promise<{ acos: number; cvr: number; roas: number } | undefined> {
  try {
    const report = await analyzePlacementRoi(performanceGroupId, accountId, 14);
    const normalizedPlacement = normalizePlacement(placement);
    const placementResult = report.placements.find(p => p.placement === normalizedPlacement);
    
    if (placementResult && placementResult.clicks >= 10) {
      return {
        acos: placementResult.acos,
        cvr: placementResult.cvr,
        roas: placementResult.roas,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
