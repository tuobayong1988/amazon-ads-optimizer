/**
 * 边际效益历史趋势服务
 * 
 * 功能：
 * 1. 记录每日边际效益分析结果
 * 2. 查询历史趋势数据
 * 3. 识别季节性规律
 * 4. 支持不同时间段对比
 */

import { getDb } from "./db";
import { sql, eq, and, gte, lte, desc, asc } from "drizzle-orm";
import { 
  calculateMarginalBenefitSimple, 
  optimizeTrafficAllocationSimple,
  OptimizationGoal 
} from "./marginalBenefitAnalysisService";
import { PlacementType } from "./placementOptimizationService";

// ==================== 类型定义 ====================

export interface MarginalBenefitHistoryRecord {
  id: number;
  accountId: number;
  campaignId: string;
  placementType: PlacementType;
  analysisDate: string;
  currentAdjustment: number;
  marginalROAS: number;
  marginalACoS: number;
  marginalSales: number;
  marginalSpend: number;
  elasticity: number;
  diminishingPoint: number;
  optimalRangeMin: number;
  optimalRangeMax: number;
  confidence: number;
  dataPoints: number;
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
}

export interface HistoryTrendData {
  dates: string[];
  topOfSearch: TrendMetrics;
  productPage: TrendMetrics;
  restOfSearch: TrendMetrics;
}

export interface TrendMetrics {
  marginalROAS: number[];
  marginalACoS: number[];
  marginalSales: number[];
  elasticity: number[];
  diminishingPoint: number[];
  confidence: number[];
}

export interface SeasonalPattern {
  period: 'weekly' | 'monthly' | 'quarterly';
  patterns: {
    label: string;
    avgMarginalROAS: number;
    avgMarginalSales: number;
    avgElasticity: number;
    dataPoints: number;
  }[];
  insights: string[];
}

export interface PeriodComparison {
  period1: {
    startDate: string;
    endDate: string;
    label: string;
  };
  period2: {
    startDate: string;
    endDate: string;
    label: string;
  };
  comparison: {
    placementType: PlacementType;
    period1Avg: {
      marginalROAS: number;
      marginalSales: number;
      elasticity: number;
    };
    period2Avg: {
      marginalROAS: number;
      marginalSales: number;
      elasticity: number;
    };
    change: {
      marginalROAS: number;
      marginalSales: number;
      elasticity: number;
    };
    changePercent: {
      marginalROAS: number;
      marginalSales: number;
      elasticity: number;
    };
  }[];
}

// ==================== 历史记录管理 ====================

/**
 * 保存边际效益分析结果到历史记录
 */
export async function saveMarginalBenefitHistory(
  accountId: number,
  campaignId: string,
  placementType: PlacementType,
  analysisResult: {
    currentAdjustment: number;
    marginalROAS: number;
    marginalACoS: number;
    marginalSales: number;
    marginalSpend: number;
    elasticity: number;
    diminishingPoint: number;
    optimalRange: { min: number; max: number };
    confidence: number;
    dataPoints: number;
  },
  performanceData: {
    totalImpressions: number;
    totalClicks: number;
    totalSpend: number;
    totalSales: number;
    totalOrders: number;
  }
): Promise<number> {
  const db = await getDb();
  if (!db) {
    throw new Error("数据库连接失败");
  }

  const today = new Date().toISOString().split('T')[0];

  // 检查今天是否已有记录
  const existing = await db.execute(sql`
    SELECT id FROM marginal_benefit_history 
    WHERE account_id = ${accountId} 
    AND campaign_id = ${campaignId}
    AND placement_type = ${placementType}
    AND analysis_date = ${today}
  `);

  if ((existing as any)[0] && ((existing as any)[0] as any[]).length > 0) {
    // 更新现有记录
    await db.execute(sql`
      UPDATE marginal_benefit_history SET
        current_adjustment = ${analysisResult.currentAdjustment},
        marginal_roas = ${analysisResult.marginalROAS},
        marginal_acos = ${analysisResult.marginalACoS},
        marginal_sales = ${analysisResult.marginalSales},
        marginal_spend = ${analysisResult.marginalSpend},
        elasticity = ${analysisResult.elasticity},
        diminishing_point = ${analysisResult.diminishingPoint},
        optimal_range_min = ${analysisResult.optimalRange.min},
        optimal_range_max = ${analysisResult.optimalRange.max},
        confidence = ${analysisResult.confidence},
        data_points = ${analysisResult.dataPoints},
        total_impressions = ${performanceData.totalImpressions},
        total_clicks = ${performanceData.totalClicks},
        total_spend = ${performanceData.totalSpend},
        total_sales = ${performanceData.totalSales},
        total_orders = ${performanceData.totalOrders}
      WHERE account_id = ${accountId} 
      AND campaign_id = ${campaignId}
      AND placement_type = ${placementType}
      AND analysis_date = ${today}
    `);
    return ((existing as any)[0] as any[])[0].id;
  }

  // 插入新记录
  const result = await db.execute(sql`
    INSERT INTO marginal_benefit_history (
      account_id, campaign_id, placement_type, analysis_date,
      current_adjustment, marginal_roas, marginal_acos, marginal_sales, marginal_spend,
      elasticity, diminishing_point, optimal_range_min, optimal_range_max,
      confidence, data_points, total_impressions, total_clicks, total_spend, total_sales, total_orders
    ) VALUES (
      ${accountId}, ${campaignId}, ${placementType}, ${today},
      ${analysisResult.currentAdjustment}, ${analysisResult.marginalROAS}, 
      ${analysisResult.marginalACoS}, ${analysisResult.marginalSales}, ${analysisResult.marginalSpend},
      ${analysisResult.elasticity}, ${analysisResult.diminishingPoint},
      ${analysisResult.optimalRange.min}, ${analysisResult.optimalRange.max},
      ${analysisResult.confidence}, ${analysisResult.dataPoints},
      ${performanceData.totalImpressions}, ${performanceData.totalClicks},
      ${performanceData.totalSpend}, ${performanceData.totalSales}, ${performanceData.totalOrders}
    )
  `);

  return (result[0] as any).insertId;
}

/**
 * 获取历史趋势数据
 */
export async function getHistoryTrend(
  accountId: number,
  campaignId: string,
  days: number = 30
): Promise<HistoryTrendData> {
  const db = await getDb();
  if (!db) {
    return createEmptyTrendData();
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const records = await db.execute(sql`
    SELECT * FROM marginal_benefit_history
    WHERE account_id = ${accountId}
    AND campaign_id = ${campaignId}
    AND analysis_date >= ${startDate.toISOString().split('T')[0]}
    AND analysis_date <= ${endDate.toISOString().split('T')[0]}
    ORDER BY analysis_date ASC
  `);

  const data = ((records as any)[0] as any[]) || [];
  
  // 按日期分组
  const dateMap = new Map<string, any[]>();
  for (const record of data) {
    const date = record.analysis_date;
    if (!dateMap.has(date)) {
      dateMap.set(date, []);
    }
    dateMap.get(date)!.push(record);
  }

  const dates = Array.from(dateMap.keys()).sort();
  const topOfSearch: TrendMetrics = createEmptyTrendMetrics(dates.length);
  const productPage: TrendMetrics = createEmptyTrendMetrics(dates.length);
  const restOfSearch: TrendMetrics = createEmptyTrendMetrics(dates.length);

  dates.forEach((date, index) => {
    const dayRecords = dateMap.get(date) || [];
    for (const record of dayRecords) {
      const metrics = record.placement_type === 'top_of_search' ? topOfSearch :
                     record.placement_type === 'product_page' ? productPage : restOfSearch;
      
      metrics.marginalROAS[index] = Number(record.marginal_roas) || 0;
      metrics.marginalACoS[index] = Number(record.marginal_acos) || 0;
      metrics.marginalSales[index] = Number(record.marginal_sales) || 0;
      metrics.elasticity[index] = Number(record.elasticity) || 0;
      metrics.diminishingPoint[index] = Number(record.diminishing_point) || 0;
      metrics.confidence[index] = Number(record.confidence) || 0;
    }
  });

  return { dates, topOfSearch, productPage, restOfSearch };
}

/**
 * 识别季节性规律
 */
export async function analyzeSeasonalPatterns(
  accountId: number,
  campaignId: string,
  period: 'weekly' | 'monthly' | 'quarterly' = 'weekly'
): Promise<SeasonalPattern> {
  const db = await getDb();
  if (!db) {
    return { period, patterns: [], insights: [] };
  }

  // 获取过去90天的数据用于季节性分析
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  const records = await db.execute(sql`
    SELECT * FROM marginal_benefit_history
    WHERE account_id = ${accountId}
    AND campaign_id = ${campaignId}
    AND analysis_date >= ${startDate.toISOString().split('T')[0]}
    ORDER BY analysis_date ASC
  `);

  const data = ((records as any)[0] as any[]) || [];
  
  if (data.length < 14) {
    return { 
      period, 
      patterns: [], 
      insights: ['数据不足，需要至少14天的历史数据才能进行季节性分析'] 
    };
  }

  const patterns: SeasonalPattern['patterns'] = [];
  const insights: string[] = [];

  if (period === 'weekly') {
    // 按星期几分组
    const weekdayGroups: Map<number, any[]> = new Map();
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    for (const record of data) {
      const date = new Date(record.analysis_date);
      const weekday = date.getDay();
      if (!weekdayGroups.has(weekday)) {
        weekdayGroups.set(weekday, []);
      }
      weekdayGroups.get(weekday)!.push(record);
    }

    for (let i = 0; i < 7; i++) {
      const records = weekdayGroups.get(i) || [];
      if (records.length > 0) {
        const avgMarginalROAS = records.reduce((sum, r) => sum + Number(r.marginal_roas || 0), 0) / records.length;
        const avgMarginalSales = records.reduce((sum, r) => sum + Number(r.marginal_sales || 0), 0) / records.length;
        const avgElasticity = records.reduce((sum, r) => sum + Number(r.elasticity || 0), 0) / records.length;
        
        patterns.push({
          label: weekdayNames[i],
          avgMarginalROAS,
          avgMarginalSales,
          avgElasticity,
          dataPoints: records.length
        });
      }
    }

    // 生成洞察
    if (patterns.length >= 5) {
      const sortedByROAS = [...patterns].sort((a, b) => b.avgMarginalROAS - a.avgMarginalROAS);
      const bestDay = sortedByROAS[0];
      const worstDay = sortedByROAS[sortedByROAS.length - 1];
      
      if (bestDay.avgMarginalROAS > worstDay.avgMarginalROAS * 1.2) {
        insights.push(`${bestDay.label}的边际ROAS最高（${bestDay.avgMarginalROAS.toFixed(2)}），建议在该日增加位置倾斜`);
        insights.push(`${worstDay.label}的边际ROAS最低（${worstDay.avgMarginalROAS.toFixed(2)}），建议在该日降低位置倾斜`);
      }
    }
  } else if (period === 'monthly') {
    // 按月份周期分组（月初、月中、月末）
    const periodGroups: Map<string, any[]> = new Map([
      ['月初(1-10日)', []],
      ['月中(11-20日)', []],
      ['月末(21-31日)', []]
    ]);

    for (const record of data) {
      const date = new Date(record.analysis_date);
      const day = date.getDate();
      const periodKey = day <= 10 ? '月初(1-10日)' : day <= 20 ? '月中(11-20日)' : '月末(21-31日)';
      periodGroups.get(periodKey)!.push(record);
    }

    for (const [label, records] of Array.from(periodGroups.entries())) {
      if (records.length > 0) {
        patterns.push({
          label,
          avgMarginalROAS: records.reduce((sum: number, r: any) => sum + Number(r.marginal_roas || 0), 0) / records.length,
          avgMarginalSales: records.reduce((sum: number, r: any) => sum + Number(r.marginal_sales || 0), 0) / records.length,
          avgElasticity: records.reduce((sum: number, r: any) => sum + Number(r.elasticity || 0), 0) / records.length,
          dataPoints: records.length
        });
      }
    }
  }

  return { period, patterns, insights };
}

/**
 * 时间段对比分析
 */
export async function comparePeriods(
  accountId: number,
  campaignId: string,
  period1Start: string,
  period1End: string,
  period2Start: string,
  period2End: string
): Promise<PeriodComparison> {
  const db = await getDb();
  
  const period1Label = `${period1Start} ~ ${period1End}`;
  const period2Label = `${period2Start} ~ ${period2End}`;

  if (!db) {
    return {
      period1: { startDate: period1Start, endDate: period1End, label: period1Label },
      period2: { startDate: period2Start, endDate: period2End, label: period2Label },
      comparison: []
    };
  }

  // 获取两个时间段的数据
  const [period1Data, period2Data] = await Promise.all([
    db.execute(sql`
      SELECT placement_type, 
        AVG(marginal_roas) as avg_marginal_roas,
        AVG(marginal_sales) as avg_marginal_sales,
        AVG(elasticity) as avg_elasticity
      FROM marginal_benefit_history
      WHERE account_id = ${accountId}
      AND campaign_id = ${campaignId}
      AND analysis_date >= ${period1Start}
      AND analysis_date <= ${period1End}
      GROUP BY placement_type
    `),
    db.execute(sql`
      SELECT placement_type,
        AVG(marginal_roas) as avg_marginal_roas,
        AVG(marginal_sales) as avg_marginal_sales,
        AVG(elasticity) as avg_elasticity
      FROM marginal_benefit_history
      WHERE account_id = ${accountId}
      AND campaign_id = ${campaignId}
      AND analysis_date >= ${period2Start}
      AND analysis_date <= ${period2End}
      GROUP BY placement_type
    `)
  ]);

  const p1Map = new Map(((period1Data as any)[0] as any[] || []).map(r => [r.placement_type, r]));
  const p2Map = new Map(((period2Data as any)[0] as any[] || []).map(r => [r.placement_type, r]));

  const placements: PlacementType[] = ['top_of_search', 'product_page', 'rest_of_search'];
  const comparison = placements.map(placementType => {
    const p1 = p1Map.get(placementType) || { avg_marginal_roas: 0, avg_marginal_sales: 0, avg_elasticity: 0 };
    const p2 = p2Map.get(placementType) || { avg_marginal_roas: 0, avg_marginal_sales: 0, avg_elasticity: 0 };

    const period1Avg = {
      marginalROAS: Number(p1.avg_marginal_roas) || 0,
      marginalSales: Number(p1.avg_marginal_sales) || 0,
      elasticity: Number(p1.avg_elasticity) || 0
    };

    const period2Avg = {
      marginalROAS: Number(p2.avg_marginal_roas) || 0,
      marginalSales: Number(p2.avg_marginal_sales) || 0,
      elasticity: Number(p2.avg_elasticity) || 0
    };

    return {
      placementType,
      period1Avg,
      period2Avg,
      change: {
        marginalROAS: period2Avg.marginalROAS - period1Avg.marginalROAS,
        marginalSales: period2Avg.marginalSales - period1Avg.marginalSales,
        elasticity: period2Avg.elasticity - period1Avg.elasticity
      },
      changePercent: {
        marginalROAS: period1Avg.marginalROAS ? ((period2Avg.marginalROAS - period1Avg.marginalROAS) / period1Avg.marginalROAS) * 100 : 0,
        marginalSales: period1Avg.marginalSales ? ((period2Avg.marginalSales - period1Avg.marginalSales) / period1Avg.marginalSales) * 100 : 0,
        elasticity: period1Avg.elasticity ? ((period2Avg.elasticity - period1Avg.elasticity) / period1Avg.elasticity) * 100 : 0
      }
    };
  });

  return {
    period1: { startDate: period1Start, endDate: period1End, label: period1Label },
    period2: { startDate: period2Start, endDate: period2End, label: period2Label },
    comparison
  };
}

// ==================== 辅助函数 ====================

function createEmptyTrendData(): HistoryTrendData {
  return {
    dates: [],
    topOfSearch: createEmptyTrendMetrics(0),
    productPage: createEmptyTrendMetrics(0),
    restOfSearch: createEmptyTrendMetrics(0)
  };
}

function createEmptyTrendMetrics(length: number): TrendMetrics {
  return {
    marginalROAS: new Array(length).fill(0),
    marginalACoS: new Array(length).fill(0),
    marginalSales: new Array(length).fill(0),
    elasticity: new Array(length).fill(0),
    diminishingPoint: new Array(length).fill(0),
    confidence: new Array(length).fill(0)
  };
}
