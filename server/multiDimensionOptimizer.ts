import { createModuleLogger } from './utils/logger';
const log = createModuleLogger('MultiDimensionOptimizer');
/**
 * 多维度智能优化引擎 (Multi-Dimension Optimizer)
 * 
 * 核心理念：在高投产的时间段、位置、投放词上加大广告投入
 * 
 * 三维联动优化：
 * 1. 时间维度：一周中哪天、一天中哪个时段投产最高
 * 2. 位置维度：搜索顶部、商品页面、其他位置哪个投产最高
 * 3. 投放词维度：哪些投放词投产最高，哪些需要保护
 * 
 * 决策原则：
 * - 高投产组合：加大投入（提高竞价、增加位置倾斜、分配更多预算）
 * - 低投产组合：减少投入（降低竞价、减少位置倾斜）
 * - 数据不足：保护性策略（维持或小幅调整，避免误杀）
 * - 渐进式调整：避免短时间内大幅变动
 */

import { getDb } from './db';
import * as dbFunctions from './db';
import { hourlyPerformance, placementPerformance, dailyPerformance } from '../drizzle/schema';
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import * as daypartingService from './daypartingService';

// ==================== 类型定义 ====================

export interface MultiDimAnalysis {
  campaignId: string | number;
  campaignName: string;
  
  // 时间维度分析
  timeAnalysis: {
    bestDays: DayPerformance[];
    worstDays: DayPerformance[];
    bestHours: HourPerformance[];
    worstHours: HourPerformance[];
    peakWindows: TimeWindow[];  // 高投产时间窗口
    offPeakWindows: TimeWindow[];  // 低投产时间窗口
  };
  
  // 位置维度分析
  placementAnalysis: {
    placements: PlacementPerformanceData[];
    bestPlacement: string;
    worstPlacement: string;
  };
  
  // 投放词维度分析
  keywordAnalysis: {
    highPerformers: KeywordPerformanceData[];  // 高投产投放词
    lowPerformers: KeywordPerformanceData[];   // 低投产投放词
    protectedKeywords: KeywordPerformanceData[]; // 数据不足需保护的投放词
  };
  
  // 综合评分
  overallScore: number;
  dataConfidence: 'high' | 'medium' | 'low';
}

export interface DayPerformance {
  dayOfWeek: number;
  dayLabel: string;
  roas: number;
  acos: number;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  score: number;
}

export interface HourPerformance {
  hour: number;
  roas: number;
  acos: number;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  cvr: number;
  score: number;
}

export interface TimeWindow {
  startHour: number;
  endHour: number;
  avgRoas: number;
  avgAcos: number;
  totalSales: number;
  totalSpend: number;
  bidMultiplier: number;
  reason: string;
}

export interface PlacementPerformanceData {
  placement: string;
  placementLabel: string;
  roas: number;
  acos: number;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  cvr: number;
  suggestedAdjustment: number; // -90% to +900%
  reason: string;
}

export interface KeywordPerformanceData {
  keywordId: number;
  keywordText: string;
  matchType: string;
  currentBid: number;
  roas: number;
  acos: number;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  category: 'high_performer' | 'low_performer' | 'protected' | 'new';
  suggestedBidMultiplier: number;
  reason: string;
  dataPoints: number;
}

export interface MultiDimOptimizationPlan {
  campaignId: string | number;
  
  // 分时竞价规则
  hourlyBidRules: {
    dayOfWeek: number;
    hour: number;
    bidMultiplier: number;
    reason: string;
  }[];
  
  // 位置倾斜建议
  placementAdjustments: {
    placement: string;
    adjustmentPercent: number;
    reason: string;
  }[];
  
  // 投放词级别竞价调整
  keywordBidAdjustments: {
    keywordId: number;
    keywordText: string;
    currentBid: number;
    suggestedBid: number;
    reason: string;
  }[];
  
  // 预算建议
  budgetSuggestion: {
    currentBudget: number;
    suggestedBudget: number;
    reason: string;
  };
}

// ==================== 常量 ====================

const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 数据充分性阈值
const DATA_THRESHOLDS = {
  MIN_CLICKS_FOR_CONFIDENCE: 20,     // 至少20次点击才有统计意义
  MIN_ORDERS_FOR_TREND: 3,           // 至少3个订单才能判断趋势
  MIN_IMPRESSIONS_FOR_ANALYSIS: 100, // 至少100次曝光才分析
  MIN_DAYS_FOR_HOURLY: 7,            // 至少7天数据才做分时分析
  ATTRIBUTION_DELAY_DAYS: 3,         // 排除最近3天（归因延迟）
};

// 调整幅度限制（渐进式）
const ADJUSTMENT_LIMITS = {
  MAX_BID_INCREASE_PERCENT: 0.30,    // 单次最大提价30%
  MAX_BID_DECREASE_PERCENT: 0.20,    // 单次最大降价20%
  MAX_PLACEMENT_CHANGE: 50,          // 位置倾斜单次最大变化50%
  MAX_BUDGET_CHANGE_PERCENT: 0.25,   // 预算单次最大变化25%
  MIN_BID: 0.02,                     // 最低出价
};

// ==================== 核心分析函数 ====================

/**
 * 分析广告活动的多维度表现
 * 这是整个引擎的核心分析函数
 */
export async function analyzeMultiDimensionPerformance(
  campaignId: string | number,
  accountId: number,
  lookbackDays: number = 30,
  targetAcos?: number,
  amazonCampaignId?: string | number  // v222: Amazon campaignId用于查询关键词（hourly/placement表用本地ID，keywords表用Amazon ID）
): Promise<MultiDimAnalysis | null> {
  const db = await getDb();
  if (!db) return null;
  
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - DATA_THRESHOLDS.ATTRIBUTION_DELAY_DAYS);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays - DATA_THRESHOLDS.ATTRIBUTION_DELAY_DAYS);
  
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];
  
  // ===== 1. 时间维度分析 =====
  
  // 1a. 按星期分析
  const weeklyData = await db
    .select({
      dayOfWeek: hourlyPerformance.dayOfWeek,
      impressions: sql<number>`SUM(${hourlyPerformance.impressions})`,
      clicks: sql<number>`SUM(${hourlyPerformance.clicks})`,
      spend: sql<string>`SUM(${hourlyPerformance.spend})`,
      sales: sql<string>`SUM(${hourlyPerformance.sales})`,
      orders: sql<number>`SUM(${hourlyPerformance.orders})`,
      dataPoints: sql<number>`COUNT(DISTINCT ${hourlyPerformance.date})`,
    })
    .from(hourlyPerformance)
    .where(
      and(
        eq(hourlyPerformance.campaignId, String(campaignId)),
        sql`${hourlyPerformance.date} >= ${startStr}`,
        sql`${hourlyPerformance.date} <= ${endStr}`
      )
    )
    .groupBy(hourlyPerformance.dayOfWeek);
  
  // 1b. 按小时分析
  const hourlyData = await db
    .select({
      hour: hourlyPerformance.hour,
      impressions: sql<number>`SUM(${hourlyPerformance.impressions})`,
      clicks: sql<number>`SUM(${hourlyPerformance.clicks})`,
      spend: sql<string>`SUM(${hourlyPerformance.spend})`,
      sales: sql<string>`SUM(${hourlyPerformance.sales})`,
      orders: sql<number>`SUM(${hourlyPerformance.orders})`,
      dataPoints: sql<number>`COUNT(DISTINCT ${hourlyPerformance.date})`,
    })
    .from(hourlyPerformance)
    .where(
      and(
        eq(hourlyPerformance.campaignId, String(campaignId)),
        sql`${hourlyPerformance.date} >= ${startStr}`,
        sql`${hourlyPerformance.date} <= ${endStr}`
      )
    )
    .groupBy(hourlyPerformance.hour);
  
  // ===== 2. 位置维度分析 =====
  const placementData = await db
    .select({
      placement: placementPerformance.placement,
      impressions: sql<number>`SUM(${placementPerformance.impressions})`,
      clicks: sql<number>`SUM(${placementPerformance.clicks})`,
      spend: sql<string>`SUM(${placementPerformance.spend})`,
      sales: sql<string>`SUM(${placementPerformance.sales})`,
      orders: sql<number>`SUM(${placementPerformance.orders})`,
    })
    .from(placementPerformance)
    .where(
      and(
        eq(placementPerformance.campaignId, String(campaignId)),
        eq(placementPerformance.accountId, accountId),
        gte(placementPerformance.date, startStr),
        lte(placementPerformance.date, endStr)
      )
    )
    .groupBy(placementPerformance.placement);
  
  // ===== 3. 投放词维度分析 =====
  // v222修复: keywords表使用Amazon campaignId查询，而非本地ID
  // hourly_performance和placement_performance表存储本地ID，但keywords表关联的是Amazon campaignId
  const keywordQueryId = amazonCampaignId || campaignId;
  const allKeywords = await dbFunctions.getKeywordsByCampaignId(Number(keywordQueryId));
  const keywordData = allKeywords.filter(kw => kw.keywordStatus === 'enabled');
  
  // ===== 处理时间维度 =====
  const dayPerformances: DayPerformance[] = weeklyData.map(d => {
    const spend = parseFloat(d.spend || '0');
    const sales = parseFloat(d.sales || '0');
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : (spend > 0 ? 999 : 0);
    
    return {
      dayOfWeek: d.dayOfWeek,
      dayLabel: DAY_LABELS[d.dayOfWeek] || `Day${d.dayOfWeek}`,
      roas,
      acos,
      spend,
      sales,
      orders: d.orders || 0,
      clicks: d.clicks || 0,
      impressions: d.impressions || 0,
      score: calculatePerformanceScore(roas, acos, d.clicks || 0, d.orders || 0, targetAcos),
    };
  });
  
  const hourPerformances: HourPerformance[] = hourlyData.map(h => {
    const spend = parseFloat(h.spend || '0');
    const sales = parseFloat(h.sales || '0');
    const clicks = h.clicks || 0;
    const orders = h.orders || 0;
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : (spend > 0 ? 999 : 0);
    const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
    
    return {
      hour: h.hour,
      roas,
      acos,
      spend,
      sales,
      orders,
      clicks,
      impressions: h.impressions || 0,
      cvr,
      score: calculatePerformanceScore(roas, acos, clicks, orders, targetAcos),
    };
  });
  
  // 排序找出最佳和最差
  const sortedDays = [...dayPerformances].sort((a: any, b: any) => b.score - a.score);
  const sortedHours = [...hourPerformances].sort((a: any, b: any) => b.score - a.score);
  
  // 识别高投产时间窗口（连续的高分时段）
  const peakWindows = identifyTimeWindows(hourPerformances, 'peak', targetAcos);
  const offPeakWindows = identifyTimeWindows(hourPerformances, 'offpeak', targetAcos);
  
  // ===== 处理位置维度 =====
  const placementLabels: Record<string, string> = {
    top_of_search: '搜索结果顶部',
    product_page: '商品页面',
    rest_of_search: '搜索结果其他位置',
  };
  
  const placementPerfs: PlacementPerformanceData[] = placementData.map(p => {
    const spend = parseFloat(p.spend || '0');
    const sales = parseFloat(p.sales || '0');
    const clicks = p.clicks || 0;
    const orders = p.orders || 0;
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : (spend > 0 ? 999 : 0);
    const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
    
    // 计算建议调整
    const { adjustment, reason } = calculatePlacementSuggestion(roas, acos, cvr, clicks, orders, targetAcos);
    
    return {
      placement: p.placement,
      placementLabel: placementLabels[p.placement] || p.placement,
      roas,
      acos,
      spend,
      sales,
      orders,
      clicks,
      impressions: p.impressions || 0,
      cvr,
      suggestedAdjustment: adjustment,
      reason,
    };
  });
  
  // 按ROAS排序找最佳位置
  const sortedPlacements = [...placementPerfs].sort((a: any, b: any) => b.roas - a.roas);
  
  // ===== 处理投放词维度 =====
  const keywordPerfs: KeywordPerformanceData[] = keywordData.map(kw => {
    const spend = parseFloat(kw.spend || '0');
    const sales = parseFloat(kw.sales || '0');
    const clicks = kw.clicks || 0;
    const orders = kw.orders || 0;
    const impressions = kw.impressions || 0;
    const currentBid = parseFloat(kw.bid || '0');
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : (spend > 0 ? 999 : 0);
    
    // 分类投放词
    const { category, multiplier, reason } = classifyKeyword(
      clicks, orders, impressions, spend, sales, roas, acos, targetAcos
    );
    
    return {
      keywordId: kw.id,
      keywordText: kw.keywordText || '',
      matchType: kw.matchType || 'broad',
      currentBid,
      roas,
      acos,
      spend,
      sales,
      orders,
      clicks,
      impressions,
      category,
      suggestedBidMultiplier: multiplier,
      reason,
      dataPoints: clicks, // 用点击数作为数据充分性指标
    };
  });
  
  const highPerformers = keywordPerfs.filter(k => k.category === 'high_performer');
  const lowPerformers = keywordPerfs.filter(k => k.category === 'low_performer');
  const protectedKeywords = keywordPerfs.filter(k => k.category === 'protected' || k.category === 'new');
  
  // 计算数据置信度
  const totalClicks = hourPerformances.reduce((s: any, h: any) => s + h.clicks, 0);
  const totalOrders = hourPerformances.reduce((s: any, h: any) => s + h.orders, 0);
  const dataConfidence: 'high' | 'medium' | 'low' = 
    totalClicks >= 100 && totalOrders >= 10 ? 'high' :
    totalClicks >= 30 && totalOrders >= 3 ? 'medium' : 'low';
  
  // 综合评分
  const avgRoas = hourPerformances.reduce((s: any, h: any) => s + h.roas, 0) / Math.max(hourPerformances.length, 1);
  const overallScore = Math.min(100, avgRoas * 25);
  
  return {
    campaignId,
    campaignName: '', // 由调用方填充
    timeAnalysis: {
      bestDays: sortedDays.slice(0, 3),
      worstDays: sortedDays.slice(-3).reverse(),
      bestHours: sortedHours.slice(0, 6),
      worstHours: sortedHours.slice(-6).reverse(),
      peakWindows,
      offPeakWindows,
    },
    placementAnalysis: {
      placements: placementPerfs,
      bestPlacement: sortedPlacements[0]?.placement || 'top_of_search',
      worstPlacement: sortedPlacements[sortedPlacements.length - 1]?.placement || 'rest_of_search',
    },
    keywordAnalysis: {
      highPerformers,
      lowPerformers,
      protectedKeywords,
    },
    overallScore,
    dataConfidence,
  };
}

// ==================== 优化计划生成 ====================

/**
 * 基于多维度分析生成优化计划
 * 核心：在高投产的时间+位置+投放词上加大投入
 */
export function generateOptimizationPlan(
  analysis: MultiDimAnalysis,
  config: {
    targetAcos?: number;
    targetRoas?: number;
    maxBid?: number;
    dailyBudget?: number;
    optimizationGoal?: string;
  }
): MultiDimOptimizationPlan {
  const targetAcos = config.targetAcos || 30;
  const targetRoas = config.targetRoas || (100 / targetAcos);
  const maxBid = config.maxBid || 2.00;
  
  // ===== 1. 生成分时竞价规则 =====
  const hourlyBidRules = generateHourlyBidRules(analysis, targetAcos, targetRoas);
  
  // ===== 2. 生成位置倾斜建议 =====
  const placementAdjustments = generatePlacementAdjustments(analysis, targetAcos);
  
  // ===== 3. 生成投放词竞价调整 =====
  const keywordBidAdjustments = generateKeywordBidAdjustments(
    analysis, targetAcos, maxBid
  );
  
  // ===== 4. 生成预算建议 =====
  const budgetSuggestion = generateBudgetSuggestion(analysis, config.dailyBudget || 0);
  
  return {
    campaignId: analysis.campaignId,
    hourlyBidRules,
    placementAdjustments,
    keywordBidAdjustments,
    budgetSuggestion,
  };
}

/**
 * 生成分时竞价规则
 * 高投产时段提高竞价，低投产时段降低竞价
 */
function generateHourlyBidRules(
  analysis: MultiDimAnalysis,
  targetAcos: number,
  targetRoas: number
): MultiDimOptimizationPlan['hourlyBidRules'] {
  const rules: MultiDimOptimizationPlan['hourlyBidRules'] = [];
  
  // 计算所有时段的平均ROAS作为基准
  const allHours = [...analysis.timeAnalysis.bestHours, ...analysis.timeAnalysis.worstHours];
  const avgRoas = allHours.reduce((s: any, h: any) => s + h.roas, 0) / Math.max(allHours.length, 1);
  
  // 为每天每小时生成规则
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    // 找到该天的表现
    const dayPerf = analysis.timeAnalysis.bestDays.find(d => d.dayOfWeek === dayOfWeek) ||
                    analysis.timeAnalysis.worstDays.find(d => d.dayOfWeek === dayOfWeek);
    const dayMultiplier = dayPerf ? calculateDayMultiplier(dayPerf, targetRoas) : 1.0;
    
    for (let hour = 0; hour < 24; hour++) {
      // 找到该小时的表现
      const hourPerf = analysis.timeAnalysis.bestHours.find(h => h.hour === hour) ||
                       analysis.timeAnalysis.worstHours.find(h => h.hour === hour);
      
      let hourMultiplier = 1.0;
      let reason = '标准时段';
      
      if (hourPerf) {
        // 基于ROAS计算小时倍数
        if (avgRoas > 0) {
          hourMultiplier = hourPerf.roas / avgRoas;
        }
        
        // 数据不足时保守处理
        if (hourPerf.clicks < DATA_THRESHOLDS.MIN_CLICKS_FOR_CONFIDENCE) {
          // 数据不足，将倍数拉向1.0
          const confidence = hourPerf.clicks / DATA_THRESHOLDS.MIN_CLICKS_FOR_CONFIDENCE;
          hourMultiplier = 1.0 + (hourMultiplier - 1.0) * confidence;
          reason = `数据不足(${hourPerf.clicks}次点击)，保守调整`;
        } else if (hourPerf.roas > targetRoas * 1.5) {
          reason = `高投产时段(ROAS ${hourPerf.roas.toFixed(1)}x)，加大投入`;
        } else if (hourPerf.roas > targetRoas) {
          reason = `达标时段(ROAS ${hourPerf.roas.toFixed(1)}x)，适度增加`;
        } else if (hourPerf.roas > 0 && hourPerf.roas < targetRoas * 0.5) {
          reason = `低投产时段(ROAS ${hourPerf.roas.toFixed(1)}x)，减少投入`;
        } else if (hourPerf.spend > 0 && hourPerf.sales === 0) {
          reason = `零转化时段，大幅减少投入`;
          hourMultiplier = Math.max(0.3, hourMultiplier);
        } else {
          reason = `一般时段(ROAS ${hourPerf.roas.toFixed(1)}x)`;
        }
      }
      
      // 综合日级别和小时级别的倍数
      let finalMultiplier = dayMultiplier * hourMultiplier;
      
      // 限制调整幅度
      finalMultiplier = Math.max(0.20, Math.min(2.50, finalMultiplier));
      finalMultiplier = Math.round(finalMultiplier * 100) / 100;
      
      rules.push({
        dayOfWeek,
        hour,
        bidMultiplier: finalMultiplier,
        reason: `${DAY_LABELS[dayOfWeek]} ${hour}:00 - ${reason} (日倍数${dayMultiplier.toFixed(2)}x × 时倍数${hourMultiplier.toFixed(2)}x)`,
      });
    }
  }
  
  return rules;
}

/**
 * 生成位置倾斜建议
 */
function generatePlacementAdjustments(
  analysis: MultiDimAnalysis,
  targetAcos: number
): MultiDimOptimizationPlan['placementAdjustments'] {
  return analysis.placementAnalysis.placements.map(p => {
    let adjustmentPercent = p.suggestedAdjustment;
    
    // 渐进式限制
    adjustmentPercent = Math.max(-90, Math.min(900, adjustmentPercent));
    
    return {
      placement: p.placement,
      adjustmentPercent: Math.round(adjustmentPercent),
      reason: p.reason,
    };
  });
}

/**
 * 生成投放词级别的竞价调整
 * 核心：高投产词提价，低投产词降价，数据不足词保护
 */
function generateKeywordBidAdjustments(
  analysis: MultiDimAnalysis,
  targetAcos: number,
  maxBid: number
): MultiDimOptimizationPlan['keywordBidAdjustments'] {
  const adjustments: MultiDimOptimizationPlan['keywordBidAdjustments'] = [];
  
  const allKeywords = [
    ...analysis.keywordAnalysis.highPerformers,
    ...analysis.keywordAnalysis.lowPerformers,
    ...analysis.keywordAnalysis.protectedKeywords,
  ];
  
  for (const kw of (allKeywords as any[])) {
    const currentBid = kw.currentBid;
    if (currentBid <= 0) continue;
    
    let suggestedBid = currentBid * kw.suggestedBidMultiplier;
    
    // 应用限制
    suggestedBid = Math.max(ADJUSTMENT_LIMITS.MIN_BID, suggestedBid);
    suggestedBid = Math.min(maxBid, suggestedBid);
    suggestedBid = Math.round(suggestedBid * 100) / 100;
    
    // 只在有意义的变化时才建议调整
    if (Math.abs(suggestedBid - currentBid) >= 0.01) {
      adjustments.push({
        keywordId: kw.keywordId,
        keywordText: kw.keywordText,
        currentBid,
        suggestedBid,
        reason: kw.reason,
      });
    }
  }
  
  return adjustments;
}

/**
 * 生成预算建议
 */
function generateBudgetSuggestion(
  analysis: MultiDimAnalysis,
  currentBudget: number
): MultiDimOptimizationPlan['budgetSuggestion'] {
  if (currentBudget <= 0) {
    return { currentBudget: 0, suggestedBudget: 0, reason: '未设置预算' };
  }
  
  // 基于整体投产表现调整预算
  const avgRoas = analysis.overallScore / 25; // 反推ROAS
  let budgetMultiplier = 1.0;
  let reason = '';
  
  if (avgRoas > 4) {
    budgetMultiplier = 1.20; // ROAS>4，增加20%预算
    reason = `高投产(ROAS ${avgRoas.toFixed(1)}x)，建议增加预算获取更多高投产订单`;
  } else if (avgRoas > 2.5) {
    budgetMultiplier = 1.10; // ROAS>2.5，增加10%
    reason = `投产良好(ROAS ${avgRoas.toFixed(1)}x)，适度增加预算`;
  } else if (avgRoas > 1.5) {
    budgetMultiplier = 1.0; // 维持
    reason = `投产一般(ROAS ${avgRoas.toFixed(1)}x)，维持当前预算`;
  } else if (avgRoas > 0) {
    budgetMultiplier = 0.90; // 降低10%
    reason = `投产较低(ROAS ${avgRoas.toFixed(1)}x)，适度减少预算`;
  }
  
  // 渐进式限制
  budgetMultiplier = Math.max(
    1 - ADJUSTMENT_LIMITS.MAX_BUDGET_CHANGE_PERCENT,
    Math.min(1 + ADJUSTMENT_LIMITS.MAX_BUDGET_CHANGE_PERCENT, budgetMultiplier)
  );
  
  const suggestedBudget = Math.round(currentBudget * budgetMultiplier * 100) / 100;
  
  return { currentBudget, suggestedBudget, reason };
}

// ==================== 执行函数 ====================

/**
 * 执行多维度优化：将优化计划应用到分时策略
 * 这是将分析结果转化为实际分时竞价规则的关键函数
 */
export async function applyHourlyBidRulesToStrategy(
  campaignId: string | number,
  accountId: number,
  rules: MultiDimOptimizationPlan['hourlyBidRules']
): Promise<{ success: boolean; strategyId: number; rulesApplied: number }> {
  // 获取或创建分时策略
  let strategy = await daypartingService.getDaypartingStrategyByCampaignId(campaignId);
  if (!strategy) {
    // @ts-ignore
    strategy = await daypartingService.ensureDaypartingStrategy(
      accountId,
      campaignId,
      `Campaign ${campaignId}`,
      {}
    );
  }
  
  if (!strategy) {
    return { success: false, strategyId: 0, rulesApplied: 0 };
  }
  
  // 获取现有规则
  const existingRules = await daypartingService.getBidRules(strategy.id);
  
  // 渐进式更新：新规则与现有规则混合
  const updatedRules = rules.map(newRule => {
    const existing = existingRules.find(
      // @ts-ignore
      (e: Error) => e.dayOfWeek === newRule.dayOfWeek && e.hour === newRule.hour
    );
    
    let finalMultiplier = newRule.bidMultiplier;
    
    if (existing) {
      const existingMultiplier = parseFloat(existing.bidMultiplier || '1.00');
      // 渐进式：新值 = 旧值 * 0.3 + 新值 * 0.7（偏向新分析结果，但保留部分历史）
      finalMultiplier = existingMultiplier * 0.3 + newRule.bidMultiplier * 0.7;
      finalMultiplier = Math.round(finalMultiplier * 100) / 100;
    }
    
    return {
      strategyId: strategy.id,
      dayOfWeek: newRule.dayOfWeek,
      hour: newRule.hour,
      bidMultiplier: finalMultiplier.toFixed(2),
      hourDataPoints: 0,
      hourIsEnabled: 1,
    };
  });
  
  // 保存规则
  await daypartingService.saveBidRules(strategy.id, updatedRules);
  
  // 确保策略为active状态
  if (strategy.daypartingStatus !== 'active') {
    await daypartingService.updateDaypartingStrategy(strategy.id, {
      daypartingStatus: 'active',
      lastAnalyzedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
  }
  
  return { success: true, strategyId: strategy.id, rulesApplied: updatedRules.length };
}

/**
 * v179: 将分时预算规则应用到策略
 * 基于每周每天的表现数据，生成预算倍数规则并保存
 */
export async function applyDailyBudgetRulesToStrategy(
  campaignId: string | number,
  accountId: number,
  dayPerformances: DayPerformance[],
  config: {
    targetAcos?: number;
    targetRoas?: number;
    optimizationGoal?: string;
  }
): Promise<{ success: boolean; strategyId: number; rulesApplied: number }> {
  // 获取或创建分时策略
  let strategy = await daypartingService.getDaypartingStrategyByCampaignId(campaignId);
  if (!strategy) {
    // @ts-ignore
    strategy = await daypartingService.ensureDaypartingStrategy(
      accountId,
      campaignId,
      `Campaign ${campaignId}`,
      {}
    );
  }
  
  if (!strategy) {
    return { success: false, strategyId: 0, rulesApplied: 0 };
  }
  
  // 获取现有预算规则
  const existingRules = await daypartingService.getBudgetRules(strategy.id);
  
  // 计算每天的预算倍数
  const targetRoas = config.targetRoas || (config.targetAcos ? 100 / config.targetAcos : 3.33);
  const allScores = dayPerformances.map(d => d.score);
  const avgScore = allScores.reduce((s: any, v: any) => s + v, 0) / Math.max(allScores.length, 1) || 1;
  
  const budgetRules = [];
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    const dayPerf = dayPerformances.find(d => d.dayOfWeek === dayOfWeek);
    
    let multiplier = 1.0;
    if (dayPerf && avgScore > 0) {
      multiplier = dayPerf.score / avgScore;
      // 限制调整幅度
      multiplier = Math.max(0.50, Math.min(1.80, multiplier));
    }
    
    // 渐进式更新：与现有规则混合
    const existing = existingRules.find((e: Record<string, any>) => e.dayOfWeek === dayOfWeek);
    if (existing) {
      const existingMultiplier = parseFloat(existing.budgetMultiplier || '1.00');
      // 新值 = 旧值 * 0.3 + 新值 * 0.7
      multiplier = existingMultiplier * 0.3 + multiplier * 0.7;
    }
    
    multiplier = Math.round(multiplier * 100) / 100;
    const budgetPercentage = Math.round((multiplier / 7) * 100 * 100) / 100;
    
    budgetRules.push({
      dayOfWeek,
      budgetMultiplier: multiplier.toFixed(2),
      budgetPercentage: budgetPercentage.toFixed(2),
      avgSpend: dayPerf?.spend?.toFixed(2),
      avgSales: dayPerf?.sales?.toFixed(2),
      avgAcos: dayPerf?.acos?.toFixed(2),
      avgRoas: dayPerf?.roas?.toFixed(2),
      dataPoints: dayPerf ? Math.round(dayPerf.clicks / 10) : 0, // 估算数据点
      isEnabled: 1,
    });
  }
  
  // 保存规则
  await daypartingService.saveBudgetRules(strategy.id, budgetRules);
  
  // 确保策略为active状态
  if (strategy.daypartingStatus !== 'active') {
    await daypartingService.updateDaypartingStrategy(strategy.id, {
      daypartingStatus: 'active',
      lastAnalyzedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
  }
  
  return { success: true, strategyId: strategy.id, rulesApplied: budgetRules.length };
}

/**
 * 为优化目标下的所有campaign执行多维度分析和优化
 * 这是被optimizationTargetEngine调用的主入口
 */
export async function executeMultiDimensionOptimization(
  targetId: number,
  accountId: number,
  campaigns: any[],
  config: {
    targetAcos?: number;
    targetRoas?: number;
    maxBid?: number;
    dailyBudget?: number;
    optimizationGoal?: string;
    lookbackDays?: number;
  },
  dryRun: boolean = false
): Promise<{
  executed: boolean;
  campaignsAnalyzed: number;
  rulesGenerated: number;
  details: Record<string, any>[];
}> {
  const details: Record<string, any>[] = [];
  let totalRulesGenerated = 0;
  let campaignsAnalyzed = 0;
  
  const lookbackDays = config.lookbackDays || 30;
  
  for (const campaign of (campaigns as any[])) {
    try {
      // v186: 修复campaignId MISMATCH - hourly_performance和placement_performance表存储的是本地ID(campaigns.id)
      // 之前错误地使用campaign.campaignId(Amazon ID)导致查不到任何数据，分时竞价/预算完全失效
      const campaignLocalId = campaign.id;
      
      // 1. 多维度分析
      // v222修复: 传入两个ID - 本地ID用于hourly/placement查询，Amazon ID用于keywords查询
      const analysis = await analyzeMultiDimensionPerformance(
        campaignLocalId, accountId, lookbackDays, config.targetAcos, campaign.campaignId
      );
      
      if (!analysis) {
        details.push({
          campaignId: campaign.campaignId,
          campaignName: campaign.campaignName,
          status: 'skipped',
          reason: '无法获取分析数据',
        });
        continue;
      }
      
      analysis.campaignName = campaign.campaignName;
      campaignsAnalyzed++;
      
      // 2. 生成优化计划
      const plan = generateOptimizationPlan(analysis, config);
      
      // 3. 应用分时竞价规则
      if (!dryRun && plan.hourlyBidRules.length > 0) {
        const applyResult = await applyHourlyBidRulesToStrategy(
          campaign.id, accountId, plan.hourlyBidRules
        );
        totalRulesGenerated += applyResult.rulesApplied;
      }
      
      // 3.5 v179: 应用分时预算规则（基于每周每天的表现数据）
      const allDayPerfs = [
        ...analysis.timeAnalysis.bestDays,
        ...analysis.timeAnalysis.worstDays,
      ];
      // 去重（bestDays和worstDays可能重叠）
      const uniqueDayPerfs = allDayPerfs.filter(
        (d, i, arr) => arr.findIndex(x => x.dayOfWeek === d.dayOfWeek) === i
      );
      if (!dryRun && uniqueDayPerfs.length > 0) {
        try {
          const budgetApplyResult = await applyDailyBudgetRulesToStrategy(
            campaign.id, accountId, uniqueDayPerfs, config
          );
          if (budgetApplyResult.success) {
            log.info(`[MultiDimOptimizer] v179: Campaign ${campaign.campaignName} 分时预算规则已保存: ${budgetApplyResult.rulesApplied}条`);
          }
        } catch (budgetErr: unknown) {
          log.warn(`[MultiDimOptimizer] v179: 分时预算规则保存失败: ${(budgetErr as Error).message}`);
        }
      }
      
      details.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        status: 'analyzed',
        dataConfidence: analysis.dataConfidence,
        overallScore: analysis.overallScore,
        peakWindows: analysis.timeAnalysis.peakWindows.length,
        bestPlacement: analysis.placementAnalysis.bestPlacement,
        highPerformKeywords: analysis.keywordAnalysis.highPerformers.length,
        protectedKeywords: analysis.keywordAnalysis.protectedKeywords.length,
        hourlyRulesGenerated: plan.hourlyBidRules.length,
        placementAdjustments: plan.placementAdjustments.length,
        keywordAdjustments: plan.keywordBidAdjustments.length,
        budgetSuggestion: plan.budgetSuggestion,
      });
      
    } catch (error: unknown) {
      details.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        status: 'error',
        error: (error as Error).message,
      });
    }
  }
  
  return {
    executed: true,
    campaignsAnalyzed,
    rulesGenerated: totalRulesGenerated,
    details,
  };
}

// ==================== 辅助函数 ====================

/**
 * 计算综合表现评分
 * 综合考虑ROAS、ACoS、点击量、订单量
 */
function calculatePerformanceScore(
  roas: number,
  acos: number,
  clicks: number,
  orders: number,
  targetAcos?: number
): number {
  const target = targetAcos || 30;
  
  // ROAS得分（0-50分）
  const roasScore = Math.min(50, roas * 12.5);
  
  // ACoS达标得分（0-30分）
  let acosScore = 0;
  if (acos > 0 && acos <= target) {
    acosScore = 30; // 达标满分
  } else if (acos > 0 && acos <= target * 1.5) {
    acosScore = 30 * (1 - (acos - target) / (target * 0.5));
  }
  
  // 数据量得分（0-20分）
  const dataScore = Math.min(20, (clicks / 50) * 10 + (orders / 5) * 10);
  
  return Math.min(100, roasScore + acosScore + dataScore);
}

/**
 * 识别高投产/低投产时间窗口
 */
function identifyTimeWindows(
  hourPerformances: HourPerformance[],
  type: 'peak' | 'offpeak',
  targetAcos?: number
): TimeWindow[] {
  const windows: TimeWindow[] = [];
  const targetRoas = targetAcos ? 100 / targetAcos : 3.33;
  
  // 按小时排序
  const sorted = [...hourPerformances].sort((a: any, b: any) => a.hour - b.hour);
  
  let windowStart = -1;
  let windowHours: HourPerformance[] = [];
  
  for (const hour of sorted) {
    const isGood = type === 'peak' ? hour.roas > targetRoas : hour.roas < targetRoas * 0.5;
    
    if (isGood) {
      if (windowStart === -1) windowStart = hour.hour;
      windowHours.push(hour);
    } else {
      if (windowHours.length >= 2) {
        // 至少2小时连续才算窗口
        const totalSales = windowHours.reduce((s: any, h: any) => s + h.sales, 0);
        const totalSpend = windowHours.reduce((s: any, h: any) => s + h.spend, 0);
        const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
        const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
        
        let bidMultiplier = 1.0;
        if (type === 'peak') {
          bidMultiplier = Math.min(2.0, 1.0 + (avgRoas / targetRoas - 1) * 0.5);
        } else {
          bidMultiplier = Math.max(0.3, avgRoas / targetRoas);
        }
        
        windows.push({
          startHour: windowStart,
          endHour: windowHours[windowHours.length - 1].hour,
          avgRoas,
          avgAcos,
          totalSales,
          totalSpend,
          bidMultiplier: Math.round(bidMultiplier * 100) / 100,
          reason: type === 'peak' 
            ? `高投产窗口 ${windowStart}:00-${windowHours[windowHours.length - 1].hour + 1}:00 (ROAS ${avgRoas.toFixed(1)}x)`
            : `低投产窗口 ${windowStart}:00-${windowHours[windowHours.length - 1].hour + 1}:00 (ROAS ${avgRoas.toFixed(1)}x)`,
        });
      }
      windowStart = -1;
      windowHours = [];
    }
  }
  
  // 处理最后一个窗口
  if (windowHours.length >= 2) {
    const totalSales = windowHours.reduce((s: any, h: any) => s + h.sales, 0);
    const totalSpend = windowHours.reduce((s: any, h: any) => s + h.spend, 0);
    const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
    
    let bidMultiplier = type === 'peak' 
      ? Math.min(2.0, 1.0 + (avgRoas / (targetAcos ? 100 / targetAcos : 3.33) - 1) * 0.5)
      : Math.max(0.3, avgRoas / (targetAcos ? 100 / targetAcos : 3.33));
    
    windows.push({
      startHour: windowStart,
      endHour: windowHours[windowHours.length - 1].hour,
      avgRoas,
      avgAcos,
      totalSales,
      totalSpend,
      bidMultiplier: Math.round(bidMultiplier * 100) / 100,
      reason: type === 'peak'
        ? `高投产窗口 ${windowStart}:00-${windowHours[windowHours.length - 1].hour + 1}:00 (ROAS ${avgRoas.toFixed(1)}x)`
        : `低投产窗口 ${windowStart}:00-${windowHours[windowHours.length - 1].hour + 1}:00 (ROAS ${avgRoas.toFixed(1)}x)`,
    });
  }
  
  return windows;
}

/**
 * 计算日级别的竞价倍数
 */
function calculateDayMultiplier(dayPerf: DayPerformance, targetRoas: number): number {
  if (dayPerf.clicks < 5) return 1.0; // 数据不足
  
  let multiplier = 1.0;
  
  if (dayPerf.roas > targetRoas * 1.5) {
    // 高投产日：提高15-30%
    multiplier = 1.0 + Math.min(0.30, (dayPerf.roas / targetRoas - 1) * 0.2);
  } else if (dayPerf.roas > targetRoas) {
    // 达标日：小幅提高5-15%
    multiplier = 1.0 + Math.min(0.15, (dayPerf.roas / targetRoas - 1) * 0.15);
  } else if (dayPerf.roas > 0 && dayPerf.roas < targetRoas * 0.5) {
    // 低投产日：降低10-20%
    multiplier = Math.max(0.80, dayPerf.roas / targetRoas);
  }
  
  return Math.round(multiplier * 100) / 100;
}

/**
 * 计算位置倾斜建议
 */
function calculatePlacementSuggestion(
  roas: number,
  acos: number,
  cvr: number,
  clicks: number,
  orders: number,
  targetAcos?: number
): { adjustment: number; reason: string } {
  const target = targetAcos || 30;
  const targetRoas = 100 / target;
  
  // 数据不足时保守处理
  if (clicks < DATA_THRESHOLDS.MIN_CLICKS_FOR_CONFIDENCE) {
    return { adjustment: 0, reason: `数据不足(${clicks}次点击)，维持当前设置` };
  }
  
  if (roas > targetRoas * 2) {
    // 非常高投产：大幅提高位置倾斜
    const adj = Math.min(200, Math.round((roas / targetRoas - 1) * 100));
    return { adjustment: adj, reason: `高投产位置(ROAS ${roas.toFixed(1)}x)，大幅提高位置出价` };
  } else if (roas > targetRoas) {
    // 达标：适度提高
    const adj = Math.min(100, Math.round((roas / targetRoas - 1) * 50));
    return { adjustment: adj, reason: `达标位置(ROAS ${roas.toFixed(1)}x)，适度提高位置出价` };
  } else if (roas > 0 && roas < targetRoas * 0.5) {
    // 低投产：降低
    const adj = Math.max(-50, Math.round((roas / targetRoas - 1) * 50));
    return { adjustment: adj, reason: `低投产位置(ROAS ${roas.toFixed(1)}x)，降低位置出价` };
  }
  
  return { adjustment: 0, reason: `一般表现(ROAS ${roas.toFixed(1)}x)，维持当前设置` };
}

/**
 * 分类投放词并计算建议竞价倍数
 * 核心保护机制：数据不足的投放词不会被错误降价
 */
function classifyKeyword(
  clicks: number,
  orders: number,
  impressions: number,
  spend: number,
  sales: number,
  roas: number,
  acos: number,
  targetAcos?: number
): { category: KeywordPerformanceData['category']; multiplier: number; reason: string } {
  const target = targetAcos || 30;
  const targetRoas = 100 / target;
  
  // ===== 保护性分类 =====
  
  // 新词/零数据词：完全保护
  if (impressions < DATA_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS) {
    return {
      category: 'new',
      multiplier: 1.0,
      reason: `新投放词(曝光${impressions})，保护性维持当前出价，等待数据积累`,
    };
  }
  
  // 有曝光但点击不足：保护
  if (clicks < DATA_THRESHOLDS.MIN_CLICKS_FOR_CONFIDENCE) {
    // 如果有少量点击但没有转化，可能只是数据不足
    if (clicks > 0 && clicks < 10) {
      return {
        category: 'protected',
        multiplier: 1.0,
        reason: `数据不足(${clicks}次点击)，保护性维持出价继续观察`,
      };
    }
    // 10-20次点击无转化：轻微降价但不大幅调整
    if (clicks >= 10 && orders === 0) {
      return {
        category: 'protected',
        multiplier: 0.95,
        reason: `${clicks}次点击零转化，数据仍不充分，仅轻微降价5%`,
      };
    }
    return {
      category: 'protected',
      multiplier: 1.0,
      reason: `数据积累中(${clicks}次点击/${orders}订单)，维持观察`,
    };
  }
  
  // ===== 数据充分的分类 =====
  
  // 高投产词：ROAS > 目标ROAS的1.5倍
  if (roas > targetRoas * 1.5 && orders >= DATA_THRESHOLDS.MIN_ORDERS_FOR_TREND) {
    const increase = Math.min(
      ADJUSTMENT_LIMITS.MAX_BID_INCREASE_PERCENT,
      (roas / targetRoas - 1) * 0.15
    );
    return {
      category: 'high_performer',
      multiplier: 1 + increase,
      reason: `高投产词(ROAS ${roas.toFixed(1)}x, ${orders}订单)，提价${Math.round(increase * 100)}%获取更多订单`,
    };
  }
  
  // 达标词：ROAS在目标附近
  if (roas >= targetRoas * 0.8 && roas <= targetRoas * 1.5) {
    return {
      category: 'high_performer',
      multiplier: 1.05,
      reason: `达标词(ROAS ${roas.toFixed(1)}x)，小幅提价5%`,
    };
  }
  
  // 低投产词：ROAS < 目标的50%，且有足够数据
  if (roas < targetRoas * 0.5 && clicks >= 30 && orders >= 1) {
    const decrease = Math.min(
      ADJUSTMENT_LIMITS.MAX_BID_DECREASE_PERCENT,
      (1 - roas / targetRoas) * 0.2
    );
    return {
      category: 'low_performer',
      multiplier: 1 - decrease,
      reason: `低投产词(ROAS ${roas.toFixed(1)}x, ACoS ${acos.toFixed(0)}%)，降价${Math.round(decrease * 100)}%`,
    };
  }
  
  // 高花费零转化词（数据充分）
  if (clicks >= 30 && orders === 0 && spend > 0) {
    return {
      category: 'low_performer',
      multiplier: 0.80,
      reason: `高花费零转化(${clicks}次点击/$${spend.toFixed(2)}花费)，降价20%`,
    };
  }
  
  // 默认：维持
  return {
    category: 'protected',
    multiplier: 1.0,
    reason: `表现一般(ROAS ${roas.toFixed(1)}x)，维持当前出价`,
  };
}
