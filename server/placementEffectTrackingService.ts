/**
 * 位置调整效果追踪服务
 * 
 * 功能：
 * 1. 追踪位置调整后的效果变化
 * 2. 计算调整前后的指标对比
 * 3. 评估调整是否有效
 * 4. 支持自动回滚决策
 */

import { getDb } from "./db";
import { 
  bidAdjustmentHistory,
  placementPerformance,
  placementSettings
} from "../drizzle/schema";
import { eq, and, desc, gte, lte, sql, lt } from "drizzle-orm";

// ==================== 类型定义 ====================

export interface PlacementMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  roas: number;
  acos: number;
  cvr: number;
  cpc: number;
  ctr: number;
}

export interface EffectComparisonResult {
  adjustmentId: number;
  campaignId: string;
  placementType: string;
  adjustmentDate: Date;
  previousAdjustment: number;
  newAdjustment: number;
  
  // 调整前指标（7天）
  metricsBefore: PlacementMetrics;
  
  // 调整后指标（7天）
  metricsAfter: PlacementMetrics;
  
  // 变化分析
  changes: {
    roasChange: number;
    roasChangePercent: number;
    acosChange: number;
    acosChangePercent: number;
    spendChange: number;
    spendChangePercent: number;
    salesChange: number;
    salesChangePercent: number;
    cvrChange: number;
    cvrChangePercent: number;
  };
  
  // 效果评估
  evaluation: {
    isPositive: boolean;
    score: number;  // -100 到 100
    summary: string;
    recommendation: 'keep' | 'rollback' | 'monitor';
  };
}

export interface AdjustmentHistoryAnalysis {
  totalAdjustments: number;
  positiveAdjustments: number;
  negativeAdjustments: number;
  neutralAdjustments: number;
  averageRoasImprovement: number;
  averageAcosImprovement: number;
  successRate: number;
  recentTrend: 'improving' | 'declining' | 'stable';
  recommendations: string[];
}

// ==================== 核心函数 ====================

/**
 * 获取指定时间段的位置表现数据
 */
async function getPlacementMetricsForPeriod(
  campaignId: string,
  accountId: number,
  placementType: string,
  startDate: Date,
  endDate: Date
): Promise<PlacementMetrics | null> {
  const db = await getDb();
  if (!db) return null;
  
  try {
    const data = await db.select({
      impressions: sql<number>`SUM(impressions)`,
      clicks: sql<number>`SUM(clicks)`,
      spend: sql<number>`SUM(spend)`,
      sales: sql<number>`SUM(sales)`,
      orders: sql<number>`SUM(orders)`
    })
    .from(placementPerformance)
    .where(
      and(
        eq(placementPerformance.campaignId, campaignId),
        eq(placementPerformance.accountId, accountId),
        sql`${placementPerformance.placement} = ${placementType}`,
        gte(placementPerformance.date, startDate.toISOString()),
        lte(placementPerformance.date, endDate.toISOString())
      )
    );
    
    if (data.length === 0 || !data[0].impressions) {
      return null;
    }
    
    const metrics = data[0];
    const impressions = Number(metrics.impressions) || 0;
    const clicks = Number(metrics.clicks) || 0;
    const spend = Number(metrics.spend) || 0;
    const sales = Number(metrics.sales) || 0;
    const orders = Number(metrics.orders) || 0;
    
    return {
      impressions,
      clicks,
      spend,
      sales,
      orders,
      roas: spend > 0 ? sales / spend : 0,
      acos: sales > 0 ? (spend / sales) * 100 : 100,
      cvr: clicks > 0 ? (orders / clicks) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0
    };
  } catch (error) {
    console.error('[PlacementEffectTracking] 获取位置指标失败:', error);
    return null;
  }
}

/**
 * 计算指标变化
 */
function calculateMetricsChanges(
  before: PlacementMetrics,
  after: PlacementMetrics
): EffectComparisonResult['changes'] {
  const safePercent = (newVal: number, oldVal: number) => {
    if (oldVal === 0) return newVal > 0 ? 100 : 0;
    return ((newVal - oldVal) / oldVal) * 100;
  };
  
  return {
    roasChange: after.roas - before.roas,
    roasChangePercent: safePercent(after.roas, before.roas),
    acosChange: after.acos - before.acos,
    acosChangePercent: safePercent(after.acos, before.acos),
    spendChange: after.spend - before.spend,
    spendChangePercent: safePercent(after.spend, before.spend),
    salesChange: after.sales - before.sales,
    salesChangePercent: safePercent(after.sales, before.sales),
    cvrChange: after.cvr - before.cvr,
    cvrChangePercent: safePercent(after.cvr, before.cvr)
  };
}

/**
 * 评估调整效果
 */
function evaluateAdjustmentEffect(
  changes: EffectComparisonResult['changes'],
  metricsBefore: PlacementMetrics,
  metricsAfter: PlacementMetrics
): EffectComparisonResult['evaluation'] {
  // 计算综合评分 (-100 到 100)
  // ROAS提升是正面的，ACoS降低是正面的
  let score = 0;
  
  // ROAS变化权重40%
  if (changes.roasChangePercent > 0) {
    score += Math.min(40, changes.roasChangePercent * 2);
  } else {
    score += Math.max(-40, changes.roasChangePercent * 2);
  }
  
  // ACoS变化权重30%（降低是好的）
  if (changes.acosChangePercent < 0) {
    score += Math.min(30, Math.abs(changes.acosChangePercent) * 1.5);
  } else {
    score -= Math.min(30, changes.acosChangePercent * 1.5);
  }
  
  // CVR变化权重20%
  if (changes.cvrChangePercent > 0) {
    score += Math.min(20, changes.cvrChangePercent);
  } else {
    score += Math.max(-20, changes.cvrChangePercent);
  }
  
  // 销售额变化权重10%
  if (changes.salesChangePercent > 0) {
    score += Math.min(10, changes.salesChangePercent * 0.5);
  } else {
    score += Math.max(-10, changes.salesChangePercent * 0.5);
  }
  
  // 限制在-100到100之间
  score = Math.max(-100, Math.min(100, score));
  
  // 确定是否正面
  const isPositive = score > 0;
  
  // 生成建议
  let recommendation: 'keep' | 'rollback' | 'monitor';
  let summary: string;
  
  if (score >= 20) {
    recommendation = 'keep';
    summary = `调整效果良好，ROAS${changes.roasChange > 0 ? '提升' : '下降'}${Math.abs(changes.roasChangePercent).toFixed(1)}%，ACoS${changes.acosChange < 0 ? '降低' : '上升'}${Math.abs(changes.acosChangePercent).toFixed(1)}%`;
  } else if (score <= -20) {
    recommendation = 'rollback';
    summary = `调整效果不佳，建议回滚。ROAS${changes.roasChange > 0 ? '提升' : '下降'}${Math.abs(changes.roasChangePercent).toFixed(1)}%，ACoS${changes.acosChange < 0 ? '降低' : '上升'}${Math.abs(changes.acosChangePercent).toFixed(1)}%`;
  } else {
    recommendation = 'monitor';
    summary = `调整效果不明显，建议继续观察。ROAS变化${changes.roasChangePercent.toFixed(1)}%，ACoS变化${changes.acosChangePercent.toFixed(1)}%`;
  }
  
  return {
    isPositive,
    score: Math.round(score),
    summary,
    recommendation
  };
}

/**
 * 追踪单个位置调整的效果
 */
export async function trackAdjustmentEffect(
  adjustmentId: number,
  accountId: number
): Promise<EffectComparisonResult | null> {
  const db = await getDb();
  if (!db) return null;
  
  try {
    // 获取调整记录
    const adjustmentRecords = await db.select()
      .from(bidAdjustmentHistory)
      .where(eq(bidAdjustmentHistory.id, adjustmentId))
      .limit(1);
    
    if (adjustmentRecords.length === 0) {
      return null;
    }
    
    const adjustment = adjustmentRecords[0];
    const adjustmentDate = new Date(adjustment.appliedAt || new Date());
    
    // 计算时间段
    // 调整前7天
    const beforeEndDate = new Date(adjustmentDate);
    beforeEndDate.setDate(beforeEndDate.getDate() - 1);
    const beforeStartDate = new Date(beforeEndDate);
    beforeStartDate.setDate(beforeStartDate.getDate() - 7);
    
    // 调整后7天（需要等待足够时间）
    const afterStartDate = new Date(adjustmentDate);
    afterStartDate.setDate(afterStartDate.getDate() + 3); // 跳过归因延迟期
    const afterEndDate = new Date(afterStartDate);
    afterEndDate.setDate(afterEndDate.getDate() + 7);
    
    // 检查是否有足够的时间来评估
    const now = new Date();
    if (afterEndDate > now) {
      console.log('[PlacementEffectTracking] 调整时间太近，尚无法评估效果');
      return null;
    }
    
    // 获取调整前后的指标
    const campaignId = adjustment.campaignName || '';
    const placementType = 'top_of_search'; // 从调整记录中获取，这里简化处理
    
    const metricsBefore = await getPlacementMetricsForPeriod(
      campaignId,
      accountId,
      placementType,
      beforeStartDate,
      beforeEndDate
    );
    
    const metricsAfter = await getPlacementMetricsForPeriod(
      campaignId,
      accountId,
      placementType,
      afterStartDate,
      afterEndDate
    );
    
    if (!metricsBefore || !metricsAfter) {
      return null;
    }
    
    // 计算变化
    const changes = calculateMetricsChanges(metricsBefore, metricsAfter);
    
    // 评估效果
    const evaluation = evaluateAdjustmentEffect(changes, metricsBefore, metricsAfter);
    
    // 更新调整记录中的效果数据
    await db.update(bidAdjustmentHistory)
      .set({
        actualRevenue7d: metricsAfter.sales.toString(),
        actualSpend7d: metricsAfter.spend.toString(),
        actualClicks7d: metricsAfter.clicks,
        actualConversions7d: metricsAfter.orders,
        actualImpressions7d: metricsAfter.impressions,
        trackingUpdatedAt: new Date().toISOString()
      })
      .where(eq(bidAdjustmentHistory.id, adjustmentId));
    
    return {
      adjustmentId,
      campaignId,
      placementType,
      adjustmentDate,
      previousAdjustment: Number(adjustment.previousBid) || 0,
      newAdjustment: Number(adjustment.newBid) || 0,
      metricsBefore,
      metricsAfter,
      changes,
      evaluation
    };
  } catch (error) {
    console.error('[PlacementEffectTracking] 追踪调整效果失败:', error);
    return null;
  }
}

/**
 * 批量追踪待评估的调整效果
 */
export async function batchTrackPendingAdjustments(
  accountId: number
): Promise<{
  tracked: number;
  results: EffectComparisonResult[];
  errors: number;
}> {
  const db = await getDb();
  if (!db) return { tracked: 0, results: [], errors: 0 };
  
  try {
    // 获取10天前的调整记录（确保有足够时间评估）
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 10);
    
    const pendingAdjustments = await db.select()
      .from(bidAdjustmentHistory)
      .where(
        and(
          eq(bidAdjustmentHistory.accountId, accountId),
          eq(bidAdjustmentHistory.adjustmentType, 'auto_placement'),
          sql`${bidAdjustmentHistory.trackingUpdatedAt} IS NULL`,
          lt(bidAdjustmentHistory.appliedAt, cutoffDate.toISOString())
        )
      )
      .orderBy(desc(bidAdjustmentHistory.appliedAt))
      .limit(50);
    
    const results: EffectComparisonResult[] = [];
    let errors = 0;
    
    for (const adjustment of pendingAdjustments) {
      const result = await trackAdjustmentEffect(adjustment.id, accountId);
      if (result) {
        results.push(result);
      } else {
        errors++;
      }
    }
    
    return {
      tracked: results.length,
      results,
      errors
    };
  } catch (error) {
    console.error('[PlacementEffectTracking] 批量追踪失败:', error);
    return { tracked: 0, results: [], errors: 1 };
  }
}

/**
 * 分析历史调整效果
 */
export async function analyzeAdjustmentHistory(
  accountId: number,
  campaignId?: string,
  days: number = 90
): Promise<AdjustmentHistoryAnalysis> {
  const db = await getDb();
  if (!db) {
    return {
      totalAdjustments: 0,
      positiveAdjustments: 0,
      negativeAdjustments: 0,
      neutralAdjustments: 0,
      averageRoasImprovement: 0,
      averageAcosImprovement: 0,
      successRate: 0,
      recentTrend: 'stable',
      recommendations: ['无法连接数据库']
    };
  }
  
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // 构建查询条件
    const conditions = [
      eq(bidAdjustmentHistory.accountId, accountId),
      eq(bidAdjustmentHistory.adjustmentType, 'auto_placement'),
      gte(bidAdjustmentHistory.appliedAt, startDate.toISOString()),
      sql`${bidAdjustmentHistory.trackingUpdatedAt} IS NOT NULL`
    ];
    
    if (campaignId) {
      conditions.push(sql`${bidAdjustmentHistory.campaignName} = ${campaignId}`);
    }
    
    const adjustments = await db.select()
      .from(bidAdjustmentHistory)
      .where(and(...conditions))
      .orderBy(desc(bidAdjustmentHistory.appliedAt));
    
    if (adjustments.length === 0) {
      return {
        totalAdjustments: 0,
        positiveAdjustments: 0,
        negativeAdjustments: 0,
        neutralAdjustments: 0,
        averageRoasImprovement: 0,
        averageAcosImprovement: 0,
        successRate: 0,
        recentTrend: 'stable',
        recommendations: ['暂无足够的历史数据进行分析']
      };
    }
    
    // 分析每个调整的效果
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;
    let totalRoasImprovement = 0;
    let totalAcosImprovement = 0;
    
    for (const adj of adjustments) {
      // 简化的效果判断：基于实际收入和花费
      const revenue = Number(adj.actualRevenue7d) || 0;
      const spend = Number(adj.actualSpend7d) || 0;
      const actualRoas = spend > 0 ? revenue / spend : 0;
      
      // 假设基准ROAS为3（可以从历史数据计算）
      const baselineRoas = 3;
      
      if (actualRoas > baselineRoas * 1.1) {
        positiveCount++;
        totalRoasImprovement += (actualRoas - baselineRoas) / baselineRoas * 100;
      } else if (actualRoas < baselineRoas * 0.9) {
        negativeCount++;
        totalRoasImprovement += (actualRoas - baselineRoas) / baselineRoas * 100;
      } else {
        neutralCount++;
      }
    }
    
    const totalAdjustments = adjustments.length;
    const successRate = totalAdjustments > 0 
      ? (positiveCount / totalAdjustments) * 100 
      : 0;
    
    // 分析最近趋势（最近10次调整）
    const recentAdjustments = adjustments.slice(0, 10);
    const recentPositive = recentAdjustments.filter(adj => {
      const revenue = Number(adj.actualRevenue7d) || 0;
      const spend = Number(adj.actualSpend7d) || 0;
      return spend > 0 && (revenue / spend) > 3;
    }).length;
    
    let recentTrend: 'improving' | 'declining' | 'stable' = 'stable';
    if (recentPositive >= 7) {
      recentTrend = 'improving';
    } else if (recentPositive <= 3) {
      recentTrend = 'declining';
    }
    
    // 生成建议
    const recommendations: string[] = [];
    
    if (successRate < 50) {
      recommendations.push('调整成功率较低，建议检查置信度阈值设置');
    }
    if (negativeCount > positiveCount) {
      recommendations.push('负面调整较多，建议增加数据观察期');
    }
    if (recentTrend === 'declining') {
      recommendations.push('近期效果呈下降趋势，建议暂停自动调整并进行人工审核');
    }
    if (totalAdjustments < 10) {
      recommendations.push('历史数据较少，建议继续积累数据');
    }
    if (recommendations.length === 0) {
      recommendations.push('整体表现良好，可继续使用当前策略');
    }
    
    return {
      totalAdjustments,
      positiveAdjustments: positiveCount,
      negativeAdjustments: negativeCount,
      neutralAdjustments: neutralCount,
      averageRoasImprovement: totalAdjustments > 0 
        ? totalRoasImprovement / totalAdjustments 
        : 0,
      averageAcosImprovement: totalAdjustments > 0 
        ? totalAcosImprovement / totalAdjustments 
        : 0,
      successRate,
      recentTrend,
      recommendations
    };
  } catch (error) {
    console.error('[PlacementEffectTracking] 分析历史调整失败:', error);
    return {
      totalAdjustments: 0,
      positiveAdjustments: 0,
      negativeAdjustments: 0,
      neutralAdjustments: 0,
      averageRoasImprovement: 0,
      averageAcosImprovement: 0,
      successRate: 0,
      recentTrend: 'stable',
      recommendations: ['分析过程中发生错误']
    };
  }
}

/**
 * 检查是否需要回滚调整
 */
export async function checkForRollbackNeeded(
  accountId: number,
  campaignId: string
): Promise<{
  needsRollback: boolean;
  adjustmentId?: number;
  reason?: string;
  previousValue?: number;
}> {
  const db = await getDb();
  if (!db) return { needsRollback: false };
  
  try {
    // 获取最近的调整记录
    const recentAdjustments = await db.select()
      .from(bidAdjustmentHistory)
      .where(
        and(
          eq(bidAdjustmentHistory.accountId, accountId),
          sql`${bidAdjustmentHistory.campaignName} = ${campaignId}`,
          eq(bidAdjustmentHistory.adjustmentType, 'auto_placement'),
          sql`${bidAdjustmentHistory.trackingUpdatedAt} IS NOT NULL`
        )
      )
      .orderBy(desc(bidAdjustmentHistory.appliedAt))
      .limit(1);
    
    if (recentAdjustments.length === 0) {
      return { needsRollback: false };
    }
    
    const adjustment = recentAdjustments[0];
    const revenue = Number(adjustment.actualRevenue7d) || 0;
    const spend = Number(adjustment.actualSpend7d) || 0;
    const actualRoas = spend > 0 ? revenue / spend : 0;
    
    // 如果ROAS低于2，建议回滚
    if (actualRoas < 2 && spend > 50) {
      return {
        needsRollback: true,
        adjustmentId: adjustment.id,
        reason: `调整后ROAS仅为${actualRoas.toFixed(2)}，低于安全阈值`,
        previousValue: Number(adjustment.previousBid) || 0
      };
    }
    
    return { needsRollback: false };
  } catch (error) {
    console.error('[PlacementEffectTracking] 检查回滚需求失败:', error);
    return { needsRollback: false };
  }
}

/**
 * 执行回滚操作
 */
export async function rollbackAdjustment(
  adjustmentId: number,
  accountId: number
): Promise<{
  success: boolean;
  message: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, message: '数据库连接失败' };
  
  try {
    // 获取调整记录
    const adjustmentRecords = await db.select()
      .from(bidAdjustmentHistory)
      .where(eq(bidAdjustmentHistory.id, adjustmentId))
      .limit(1);
    
    if (adjustmentRecords.length === 0) {
      return { success: false, message: '未找到调整记录' };
    }
    
    const adjustment = adjustmentRecords[0];
    const campaignId = adjustment.campaignName || '';
    const previousValue = Number(adjustment.previousBid) || 0;
    
    // 更新位置设置
    const existingSettings = await db.select()
      .from(placementSettings)
      .where(
        and(
          eq(placementSettings.campaignId, campaignId),
          eq(placementSettings.accountId, accountId)
        )
      )
      .limit(1);
    
    if (existingSettings.length > 0) {
      await db.update(placementSettings)
        .set({
          topOfSearchAdjustment: previousValue,
          lastAdjustedAt: new Date().toISOString()
        })
        .where(eq(placementSettings.id, existingSettings[0].id));
    }
    
    // 记录回滚操作
    await db.insert(bidAdjustmentHistory).values({
      accountId,
      campaignName: campaignId,
      previousBid: adjustment.newBid,
      newBid: adjustment.previousBid,
      bidChangePercent: (-(Number(adjustment.bidChangePercent) || 0)).toString(),
      adjustmentType: 'auto_placement',
      adjustmentReason: `回滚调整 #${adjustmentId}`,
      appliedAt: new Date().toISOString(),
      status: 'applied'
    });
    
    // 更新原调整记录状态
    await db.update(bidAdjustmentHistory)
      .set({ status: 'rolled_back' })
      .where(eq(bidAdjustmentHistory.id, adjustmentId));
    
    return {
      success: true,
      message: `成功回滚到之前的设置（${previousValue}%）`
    };
  } catch (error) {
    console.error('[PlacementEffectTracking] 回滚操作失败:', error);
    return {
      success: false,
      message: `回滚失败: ${error instanceof Error ? error.message : '未知错误'}`
    };
  }
}

// ==================== 导出 ====================

export default {
  trackAdjustmentEffect,
  batchTrackPendingAdjustments,
  analyzeAdjustmentHistory,
  checkForRollbackNeeded,
  rollbackAdjustment
};
