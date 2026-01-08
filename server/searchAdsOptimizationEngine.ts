/**
 * 搜索广告优化引擎
 * 
 * 适用于所有涉及客户搜索的广告类型：
 * - SP商品推广广告（自动广告、手动广告）
 * - SB品牌广告中的视频广告（单品视频广告基于搜索）
 * 
 * 核心算法组件：
 * 1. 市场曲线建模（展现曲线、点击率曲线、利润曲线）
 * 2. 边际分析算法（边际利润计算、最优竞价点搜索）
 * 3. 决策树逻辑（多条件判断、优先级排序）
 * 
 * 参考：智能优化.net 的核心优化理念
 */

import { getDb } from "./db";
import { 
  campaigns, 
  keywords, 
  bidPerformanceHistory,
  marketCurveModels
} from "../drizzle/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import {
  buildImpressionCurve,
  buildCTRCurve,
  calculateConversionParams,
  calculateOptimalBid,
  ImpressionCurveParams,
  CTRCurveParams,
  ConversionParams,
  BidPerformanceData
} from "./marketCurveService";

// ==================== 类型定义 ====================

/**
 * 搜索广告类型
 */
export type SearchAdType = 
  | 'sp_auto'           // SP自动广告
  | 'sp_manual_keyword' // SP手动广告-关键词定向
  | 'sp_manual_asin'    // SP手动广告-ASIN定向
  | 'sb_video';         // SB视频广告

/**
 * 自动广告匹配类型
 */
export type AutoTargetingType = 
  | 'close_match'   // 紧密匹配
  | 'loose_match'   // 宽泛匹配
  | 'substitutes'   // 同类商品
  | 'complements';  // 关联商品

/**
 * 关键词匹配类型
 */
export type KeywordMatchType = 'broad' | 'phrase' | 'exact';

/**
 * 广告位置
 */
export type PlacementType = 
  | 'top_of_search'    // 搜索结果顶部
  | 'product_pages'    // 商品详情页
  | 'rest_of_search';  // 搜索结果其他位置

/**
 * 搜索广告绩效数据
 */
export interface SearchAdPerformance {
  adType: SearchAdType;
  targetId: string;           // 关键词ID、ASIN ID或匹配类型
  targetName: string;         // 关键词文本、ASIN或匹配类型名称
  matchType?: KeywordMatchType | AutoTargetingType;
  currentBid: number;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  acos: number;
  roas: number;
  ctr: number;
  cvr: number;
  cpc: number;
  // 位置数据（如果有）
  placementData?: {
    topOfSearch: PlacementPerformance;
    productPages: PlacementPerformance;
    restOfSearch: PlacementPerformance;
  };
  // 分时数据（如果有）
  hourlyData?: HourlyPerformance[];
}

/**
 * 位置绩效数据
 */
export interface PlacementPerformance {
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  acos: number;
  roas: number;
  ctr: number;
  cvr: number;
}

/**
 * 分时绩效数据
 */
export interface HourlyPerformance {
  dayOfWeek: number;  // 0-6
  hour: number;       // 0-23
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
}

/**
 * 优化参数
 */
export interface SearchAdOptimizationParams {
  targetAcos: number;
  targetRoas: number;
  minBid: number;
  maxBid: number;
  maxBidAdjustmentPercent: number;
  minClicks: number;
  minImpressions: number;
  learningPeriodDays: number;
  profitMarginTarget: number;
  // 市场曲线参数
  marketCurveEnabled: boolean;
  marketCurveMinDataPoints: number;
  // 边际分析参数
  marginalAnalysisEnabled: boolean;
  marginalProfitThreshold: number;
  // 决策树参数
  decisionTreeEnabled: boolean;
  decisionTreeConfidenceThreshold: number;
}

/**
 * 默认优化参数
 */
export const DEFAULT_SEARCH_AD_PARAMS: SearchAdOptimizationParams = {
  targetAcos: 0.25,
  targetRoas: 4.0,
  minBid: 0.10,
  maxBid: 10.00,
  maxBidAdjustmentPercent: 0.50,
  minClicks: 10,
  minImpressions: 500,
  learningPeriodDays: 14,
  profitMarginTarget: 0.20,
  marketCurveEnabled: true,
  marketCurveMinDataPoints: 5,
  marginalAnalysisEnabled: true,
  marginalProfitThreshold: 0.01,
  decisionTreeEnabled: true,
  decisionTreeConfidenceThreshold: 0.7
};

/**
 * 优化建议
 */
export interface SearchAdOptimizationSuggestion {
  targetId: string;
  targetName: string;
  adType: SearchAdType;
  suggestionType: 'bid_adjustment' | 'pause' | 'enable' | 'placement_adjustment' | 'dayparting_adjustment';
  priority: 'critical' | 'high' | 'medium' | 'low';
  currentValue: number;
  suggestedValue: number;
  changePercent: number;
  reasoning: string;
  expectedImpact: {
    metric: string;
    currentValue: number;
    expectedValue: number;
    changePercent: number;
  };
  confidence: number;
  algorithmSource: 'market_curve' | 'marginal_analysis' | 'decision_tree' | 'rule_based';
  // 详细算法数据
  algorithmData?: {
    marketCurve?: {
      impressionCurve: ImpressionCurveParams;
      ctrCurve: CTRCurveParams;
      conversion: ConversionParams;
      optimalBid: number;
      maxProfit: number;
      profitMargin: number;
      breakEvenCPC: number;
    };
    marginalAnalysis?: {
      currentMarginalProfit: number;
      suggestedMarginalProfit: number;
      marginalCost: number;
      marginalRevenue: number;
    };
    decisionTree?: {
      path: string[];
      leafPrediction: number;
      leafSamples: number;
      leafVariance: number;
    };
  };
}

/**
 * 位置竞价调整建议
 */
export interface PlacementBidSuggestion {
  placement: PlacementType;
  currentMultiplier: number;
  suggestedMultiplier: number;
  reasoning: string;
  expectedImpact: {
    impressionChange: number;
    costChange: number;
    salesChange: number;
  };
}

/**
 * 分时竞价调整建议
 */
export interface DaypartingSuggestion {
  dayOfWeek: number;
  hour: number;
  currentMultiplier: number;
  suggestedMultiplier: number;
  reasoning: string;
}

// ==================== 市场曲线建模 ====================

/**
 * 为搜索广告构建市场曲线
 */
export async function buildSearchAdMarketCurve(
  accountId: number,
  adType: SearchAdType,
  targetId: string,
  daysBack: number = 30
): Promise<{
  impressionCurve: ImpressionCurveParams;
  ctrCurve: CTRCurveParams;
  conversion: ConversionParams;
  dataPoints: number;
  confidence: number;
} | null> {
  const db = await getDb();
  if (!db) return null;

  // 获取历史出价表现数据
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  try {
    const historyData = await db
      .select()
      .from(bidPerformanceHistory)
      .where(
        and(
          eq(bidPerformanceHistory.accountId, accountId),
          eq(bidPerformanceHistory.bidObjectId, targetId),
          gte(bidPerformanceHistory.date, startDate.toISOString().split('T')[0])
        )
      );

    if (historyData.length < 5) {
      return null;
    }

    // 转换为BidPerformanceData格式
    const dataPoints: BidPerformanceData[] = historyData.map(h => ({
      bid: Number(h.bid) || 0,
      effectiveCPC: Number(h.effectiveCPC) || 0,
      impressions: h.impressions || 0,
      clicks: h.clicks || 0,
      spend: Number(h.spend) || 0,
      sales: Number(h.sales) || 0,
      orders: h.orders || 0,
      ctr: h.impressions ? (h.clicks || 0) / h.impressions : 0,
      cvr: h.clicks ? (h.orders || 0) / h.clicks : 0
    }));

    // 构建曲线
    const impressionCurve = buildImpressionCurve(dataPoints);
    const ctrCurve = buildCTRCurve(dataPoints);
    const conversion = calculateConversionParams(dataPoints);

    // 计算置信度
    const confidence = calculateCurveConfidence(impressionCurve, dataPoints.length);

    return {
      impressionCurve,
      ctrCurve,
      conversion,
      dataPoints: dataPoints.length,
      confidence
    };
  } catch (error) {
    console.error('[searchAdsOptimization] Error building market curve:', error);
    return null;
  }
}

/**
 * 计算曲线置信度
 */
function calculateCurveConfidence(curve: ImpressionCurveParams, dataPoints: number): number {
  // 基于R²和数据点数量计算置信度
  const r2Score = curve.r2;
  const dataPointScore = Math.min(dataPoints / 20, 1); // 20个数据点达到满分
  
  return r2Score * 0.6 + dataPointScore * 0.4;
}

// ==================== 边际分析算法 ====================

/**
 * 边际利润分析
 */
export interface MarginalAnalysisResult {
  currentBid: number;
  optimalBid: number;
  currentMarginalProfit: number;
  optimalMarginalProfit: number;
  marginalCost: number;
  marginalRevenue: number;
  profitCurve: Array<{ bid: number; profit: number; marginalProfit: number }>;
  breakEvenBid: number;
  maxProfitBid: number;
}

/**
 * 执行边际分析
 */
export function performMarginalAnalysis(
  impressionCurve: ImpressionCurveParams,
  ctrCurve: CTRCurveParams,
  conversion: ConversionParams,
  currentBid: number,
  params: SearchAdOptimizationParams = DEFAULT_SEARCH_AD_PARAMS
): MarginalAnalysisResult {
  const { minBid, maxBid } = params;
  const { cvr, aov } = conversion;
  
  // 计算盈亏平衡点
  const breakEvenBid = cvr * aov;
  
  // 生成利润曲线和边际利润曲线
  const profitCurve: Array<{ bid: number; profit: number; marginalProfit: number }> = [];
  const step = 0.02;
  let prevProfit = 0;
  let maxProfit = -Infinity;
  let maxProfitBid = minBid;
  
  for (let bid = minBid; bid <= Math.min(maxBid, breakEvenBid * 1.5); bid += step) {
    const impressions = calculateImpressions(bid, impressionCurve);
    const ctr = calculateCTR(bid, ctrCurve);
    const clicks = impressions * ctr;
    const profit = clicks * (cvr * aov - bid);
    const marginalProfit = (profit - prevProfit) / step;
    
    profitCurve.push({ bid, profit, marginalProfit });
    
    if (profit > maxProfit) {
      maxProfit = profit;
      maxProfitBid = bid;
    }
    
    prevProfit = profit;
  }
  
  // 计算当前竞价的边际利润
  const currentIndex = profitCurve.findIndex(p => p.bid >= currentBid);
  const currentMarginalProfit = currentIndex >= 0 ? profitCurve[currentIndex].marginalProfit : 0;
  
  // 找到最优竞价点（边际利润接近0的点）
  let optimalBid = maxProfitBid;
  let optimalMarginalProfit = 0;
  
  for (const point of profitCurve) {
    if (Math.abs(point.marginalProfit) < Math.abs(optimalMarginalProfit) || optimalMarginalProfit === 0) {
      if (point.profit > 0) { // 确保利润为正
        optimalBid = point.bid;
        optimalMarginalProfit = point.marginalProfit;
      }
    }
  }
  
  // 计算边际成本和边际收入
  const marginalCost = step; // 每增加step的竞价
  const marginalRevenue = optimalMarginalProfit + step;
  
  return {
    currentBid,
    optimalBid: Math.round(optimalBid * 100) / 100,
    currentMarginalProfit,
    optimalMarginalProfit,
    marginalCost,
    marginalRevenue,
    profitCurve,
    breakEvenBid: Math.round(breakEvenBid * 100) / 100,
    maxProfitBid: Math.round(maxProfitBid * 100) / 100
  };
}

/**
 * 计算展现量（辅助函数）
 */
function calculateImpressions(bid: number, curve: ImpressionCurveParams): number {
  return Math.max(0, curve.a * Math.log(bid + curve.b) + curve.c);
}

/**
 * 计算CTR（辅助函数）
 */
function calculateCTR(bid: number, curve: CTRCurveParams, maxBid: number = 5): number {
  const positionScore = Math.min(bid / maxBid, 1);
  return curve.baseCTR * (1 + curve.positionBonus * positionScore);
}

// ==================== 决策树逻辑 ====================

/**
 * 决策树节点
 */
export interface DecisionNode {
  id: string;
  condition: DecisionCondition;
  trueChild?: DecisionNode | DecisionLeaf;
  falseChild?: DecisionNode | DecisionLeaf;
}

/**
 * 决策条件
 */
export interface DecisionCondition {
  field: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=' | 'in' | 'not_in';
  value: number | string | (number | string)[];
  description: string;
}

/**
 * 决策叶子节点
 */
export interface DecisionLeaf {
  action: 'increase_bid' | 'decrease_bid' | 'pause' | 'enable' | 'maintain' | 'use_market_curve';
  adjustmentPercent?: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reasoning: string;
  confidence: number;
}

/**
 * 搜索广告优化决策树
 */
export const SEARCH_AD_DECISION_TREE: DecisionNode = {
  id: 'root',
  condition: {
    field: 'clicks',
    operator: '>=',
    value: 10,
    description: '是否有足够的点击数据'
  },
  trueChild: {
    id: 'has_data',
    condition: {
      field: 'orders',
      operator: '>',
      value: 0,
      description: '是否有转化'
    },
    trueChild: {
      id: 'has_conversion',
      condition: {
        field: 'acos',
        operator: '<=',
        value: 0.20,
        description: 'ACoS是否低于20%（高价值）'
      },
      trueChild: {
        action: 'increase_bid',
        adjustmentPercent: 15,
        priority: 'high',
        reasoning: '高价值关键词（ACoS<20%），建议提高竞价获取更多流量',
        confidence: 0.9
      },
      falseChild: {
        id: 'check_acos_medium',
        condition: {
          field: 'acos',
          operator: '<=',
          value: 0.35,
          description: 'ACoS是否在目标范围内（20%-35%）'
        },
        trueChild: {
          action: 'use_market_curve',
          priority: 'medium',
          reasoning: 'ACoS在目标范围内，使用市场曲线模型精细优化',
          confidence: 0.85
        },
        falseChild: {
          id: 'check_acos_high',
          condition: {
            field: 'acos',
            operator: '<=',
            value: 0.50,
            description: 'ACoS是否略高（35%-50%）'
          },
          trueChild: {
            action: 'decrease_bid',
            adjustmentPercent: -15,
            priority: 'high',
            reasoning: 'ACoS略高（35%-50%），建议降低竞价优化效率',
            confidence: 0.85
          },
          falseChild: {
            action: 'decrease_bid',
            adjustmentPercent: -30,
            priority: 'critical',
            reasoning: 'ACoS过高（>50%），建议大幅降低竞价或考虑暂停',
            confidence: 0.9
          }
        }
      }
    },
    falseChild: {
      id: 'no_conversion',
      condition: {
        field: 'clicks',
        operator: '>=',
        value: 30,
        description: '是否有大量点击但无转化'
      },
      trueChild: {
        action: 'pause',
        priority: 'high',
        reasoning: '大量点击（>=30）但无转化，建议暂停以避免浪费',
        confidence: 0.85
      },
      falseChild: {
        action: 'decrease_bid',
        adjustmentPercent: -20,
        priority: 'medium',
        reasoning: '有点击但无转化，建议降低竞价继续观察',
        confidence: 0.7
      }
    }
  },
  falseChild: {
    id: 'insufficient_data',
    condition: {
      field: 'impressions',
      operator: '>=',
      value: 1000,
      description: '是否有足够的展现但点击少'
    },
    trueChild: {
      id: 'low_ctr',
      condition: {
        field: 'ctr',
        operator: '<',
        value: 0.002,
        description: 'CTR是否过低（<0.2%）'
      },
      trueChild: {
        action: 'decrease_bid',
        adjustmentPercent: -10,
        priority: 'low',
        reasoning: '展现多但CTR过低，可能关键词相关性差，建议降低竞价',
        confidence: 0.6
      },
      falseChild: {
        action: 'maintain',
        priority: 'low',
        reasoning: '数据不足，继续观察积累数据',
        confidence: 0.5
      }
    },
    falseChild: {
      action: 'maintain',
      priority: 'low',
      reasoning: '数据不足，继续观察积累数据',
      confidence: 0.5
    }
  }
};

/**
 * 执行决策树
 */
export function executeDecisionTree(
  performance: SearchAdPerformance,
  tree: DecisionNode = SEARCH_AD_DECISION_TREE
): { leaf: DecisionLeaf; path: string[] } {
  const path: string[] = [];
  let currentNode: DecisionNode | DecisionLeaf = tree;
  
  while ('condition' in currentNode) {
    path.push(currentNode.id);
    
    const conditionMet = evaluateCondition(performance, currentNode.condition);
    
    if (conditionMet) {
      if (!currentNode.trueChild) {
        throw new Error(`Decision tree node ${currentNode.id} missing trueChild`);
      }
      currentNode = currentNode.trueChild;
    } else {
      if (!currentNode.falseChild) {
        throw new Error(`Decision tree node ${currentNode.id} missing falseChild`);
      }
      currentNode = currentNode.falseChild;
    }
  }
  
  return { leaf: currentNode, path };
}

/**
 * 评估决策条件
 */
function evaluateCondition(performance: SearchAdPerformance, condition: DecisionCondition): boolean {
  const fieldValue = (performance as any)[condition.field];
  
  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }
  
  switch (condition.operator) {
    case '>':
      return fieldValue > condition.value;
    case '<':
      return fieldValue < condition.value;
    case '>=':
      return fieldValue >= condition.value;
    case '<=':
      return fieldValue <= condition.value;
    case '==':
      return fieldValue === condition.value;
    case '!=':
      return fieldValue !== condition.value;
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    case 'not_in':
      return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
    default:
      return false;
  }
}

// ==================== 综合优化引擎 ====================

/**
 * 生成搜索广告优化建议
 */
export async function generateSearchAdOptimizationSuggestion(
  accountId: number,
  performance: SearchAdPerformance,
  params: SearchAdOptimizationParams = DEFAULT_SEARCH_AD_PARAMS
): Promise<SearchAdOptimizationSuggestion | null> {
  // 1. 首先执行决策树获取基础建议
  const { leaf: decisionLeaf, path: decisionPath } = executeDecisionTree(performance);
  
  // 2. 如果决策树建议使用市场曲线，则进行市场曲线分析
  if (decisionLeaf.action === 'use_market_curve' && params.marketCurveEnabled) {
    const marketCurve = await buildSearchAdMarketCurve(
      accountId,
      performance.adType,
      performance.targetId
    );
    
    if (marketCurve && marketCurve.confidence >= params.decisionTreeConfidenceThreshold) {
      // 使用市场曲线计算最优竞价
      const optimalBidResult = calculateOptimalBid(
        marketCurve.impressionCurve,
        marketCurve.ctrCurve,
        marketCurve.conversion
      );
      
      // 执行边际分析
      const marginalAnalysis = performMarginalAnalysis(
        marketCurve.impressionCurve,
        marketCurve.ctrCurve,
        marketCurve.conversion,
        performance.currentBid,
        params
      );
      
      // 计算调整幅度
      const suggestedBid = Math.max(
        params.minBid,
        Math.min(params.maxBid, optimalBidResult.optimalBid)
      );
      const changePercent = (suggestedBid - performance.currentBid) / performance.currentBid;
      
      // 限制单次调整幅度
      const limitedChangePercent = Math.max(
        -params.maxBidAdjustmentPercent,
        Math.min(params.maxBidAdjustmentPercent, changePercent)
      );
      const finalSuggestedBid = performance.currentBid * (1 + limitedChangePercent);
      
      return {
        targetId: performance.targetId,
        targetName: performance.targetName,
        adType: performance.adType,
        suggestionType: 'bid_adjustment',
        priority: Math.abs(limitedChangePercent) > 0.2 ? 'high' : 'medium',
        currentValue: performance.currentBid,
        suggestedValue: Math.round(finalSuggestedBid * 100) / 100,
        changePercent: limitedChangePercent,
        reasoning: `基于市场曲线模型，最优竞价点为$${optimalBidResult.optimalBid}，预期利润率${(optimalBidResult.profitMargin * 100).toFixed(1)}%`,
        expectedImpact: {
          metric: 'profit',
          currentValue: performance.sales - performance.cost,
          expectedValue: optimalBidResult.maxProfit,
          changePercent: optimalBidResult.maxProfit > 0 
            ? (optimalBidResult.maxProfit - (performance.sales - performance.cost)) / Math.abs(performance.sales - performance.cost || 1)
            : 0
        },
        confidence: marketCurve.confidence,
        algorithmSource: 'market_curve',
        algorithmData: {
          marketCurve: {
            impressionCurve: marketCurve.impressionCurve,
            ctrCurve: marketCurve.ctrCurve,
            conversion: marketCurve.conversion,
            optimalBid: optimalBidResult.optimalBid,
            maxProfit: optimalBidResult.maxProfit,
            profitMargin: optimalBidResult.profitMargin,
            breakEvenCPC: optimalBidResult.breakEvenCPC
          },
          marginalAnalysis: {
            currentMarginalProfit: marginalAnalysis.currentMarginalProfit,
            suggestedMarginalProfit: marginalAnalysis.optimalMarginalProfit,
            marginalCost: marginalAnalysis.marginalCost,
            marginalRevenue: marginalAnalysis.marginalRevenue
          }
        }
      };
    }
  }
  
  // 3. 使用决策树结果生成建议
  if (decisionLeaf.action === 'maintain') {
    return null; // 不需要调整
  }
  
  let suggestionType: SearchAdOptimizationSuggestion['suggestionType'] = 'bid_adjustment';
  let suggestedValue = performance.currentBid;
  let changePercent = 0;
  
  switch (decisionLeaf.action) {
    case 'increase_bid':
      changePercent = (decisionLeaf.adjustmentPercent || 10) / 100;
      suggestedValue = performance.currentBid * (1 + changePercent);
      break;
    case 'decrease_bid':
      changePercent = (decisionLeaf.adjustmentPercent || -10) / 100;
      suggestedValue = performance.currentBid * (1 + changePercent);
      break;
    case 'pause':
      suggestionType = 'pause';
      suggestedValue = 0;
      changePercent = -1;
      break;
    case 'enable':
      suggestionType = 'enable';
      suggestedValue = performance.currentBid;
      changePercent = 0;
      break;
  }
  
  // 应用边界限制
  suggestedValue = Math.max(params.minBid, Math.min(params.maxBid, suggestedValue));
  
  return {
    targetId: performance.targetId,
    targetName: performance.targetName,
    adType: performance.adType,
    suggestionType,
    priority: decisionLeaf.priority,
    currentValue: performance.currentBid,
    suggestedValue: Math.round(suggestedValue * 100) / 100,
    changePercent,
    reasoning: decisionLeaf.reasoning,
    expectedImpact: {
      metric: 'acos',
      currentValue: performance.acos,
      expectedValue: performance.acos * (1 - changePercent * 0.5), // 简化估算
      changePercent: -changePercent * 0.5
    },
    confidence: decisionLeaf.confidence,
    algorithmSource: 'decision_tree',
    algorithmData: {
      decisionTree: {
        path: decisionPath,
        leafPrediction: changePercent,
        leafSamples: 0,
        leafVariance: 0
      }
    }
  };
}

// ==================== 位置竞价优化 ====================

/**
 * 生成位置竞价调整建议
 */
export function generatePlacementBidSuggestions(
  performance: SearchAdPerformance,
  currentMultipliers: { topOfSearch: number; productPages: number },
  params: SearchAdOptimizationParams = DEFAULT_SEARCH_AD_PARAMS
): PlacementBidSuggestion[] {
  const suggestions: PlacementBidSuggestion[] = [];
  
  if (!performance.placementData) {
    return suggestions;
  }
  
  const { topOfSearch, productPages, restOfSearch } = performance.placementData;
  
  // 计算各位置的效率得分
  const topEfficiency = calculatePlacementEfficiency(topOfSearch, params.targetAcos);
  const productEfficiency = calculatePlacementEfficiency(productPages, params.targetAcos);
  const restEfficiency = calculatePlacementEfficiency(restOfSearch, params.targetAcos);
  
  // 搜索顶部位置优化
  if (topOfSearch.clicks >= params.minClicks) {
    const suggestedMultiplier = calculateOptimalPlacementMultiplier(
      topEfficiency,
      currentMultipliers.topOfSearch,
      params
    );
    
    if (Math.abs(suggestedMultiplier - currentMultipliers.topOfSearch) > 0.05) {
      suggestions.push({
        placement: 'top_of_search',
        currentMultiplier: currentMultipliers.topOfSearch,
        suggestedMultiplier,
        reasoning: topEfficiency > 1 
          ? `搜索顶部位置效率高(${(topEfficiency * 100).toFixed(0)}%)，建议提高竞价倍数`
          : `搜索顶部位置效率低(${(topEfficiency * 100).toFixed(0)}%)，建议降低竞价倍数`,
        expectedImpact: {
          impressionChange: (suggestedMultiplier - currentMultipliers.topOfSearch) * 0.3,
          costChange: (suggestedMultiplier - currentMultipliers.topOfSearch) * topOfSearch.cost,
          salesChange: (suggestedMultiplier - currentMultipliers.topOfSearch) * topOfSearch.sales * topEfficiency
        }
      });
    }
  }
  
  // 商品详情页位置优化
  if (productPages.clicks >= params.minClicks) {
    const suggestedMultiplier = calculateOptimalPlacementMultiplier(
      productEfficiency,
      currentMultipliers.productPages,
      params
    );
    
    if (Math.abs(suggestedMultiplier - currentMultipliers.productPages) > 0.05) {
      suggestions.push({
        placement: 'product_pages',
        currentMultiplier: currentMultipliers.productPages,
        suggestedMultiplier,
        reasoning: productEfficiency > 1 
          ? `商品详情页位置效率高(${(productEfficiency * 100).toFixed(0)}%)，建议提高竞价倍数`
          : `商品详情页位置效率低(${(productEfficiency * 100).toFixed(0)}%)，建议降低竞价倍数`,
        expectedImpact: {
          impressionChange: (suggestedMultiplier - currentMultipliers.productPages) * 0.3,
          costChange: (suggestedMultiplier - currentMultipliers.productPages) * productPages.cost,
          salesChange: (suggestedMultiplier - currentMultipliers.productPages) * productPages.sales * productEfficiency
        }
      });
    }
  }
  
  return suggestions;
}

/**
 * 计算位置效率
 */
function calculatePlacementEfficiency(
  placement: PlacementPerformance,
  targetAcos: number
): number {
  if (placement.cost === 0 || placement.sales === 0) {
    return 0;
  }
  
  // 效率 = 目标ACoS / 实际ACoS
  return targetAcos / placement.acos;
}

/**
 * 计算最优位置竞价倍数
 */
function calculateOptimalPlacementMultiplier(
  efficiency: number,
  currentMultiplier: number,
  params: SearchAdOptimizationParams
): number {
  // 基于效率调整倍数
  // 效率 > 1 表示表现好于目标，可以提高倍数
  // 效率 < 1 表示表现差于目标，应该降低倍数
  
  const adjustmentFactor = Math.pow(efficiency, 0.5); // 使用平方根平滑调整
  let suggestedMultiplier = currentMultiplier * adjustmentFactor;
  
  // 限制调整幅度
  const maxChange = currentMultiplier * params.maxBidAdjustmentPercent;
  suggestedMultiplier = Math.max(
    currentMultiplier - maxChange,
    Math.min(currentMultiplier + maxChange, suggestedMultiplier)
  );
  
  // 限制在有效范围内 (0% - 900%)
  suggestedMultiplier = Math.max(0, Math.min(9, suggestedMultiplier));
  
  return Math.round(suggestedMultiplier * 100) / 100;
}

// ==================== 分时竞价优化 ====================

/**
 * 生成分时竞价调整建议
 */
export function generateDaypartingSuggestions(
  performance: SearchAdPerformance,
  currentMultipliers: number[][], // 7天 x 12时段（每2小时）
  params: SearchAdOptimizationParams = DEFAULT_SEARCH_AD_PARAMS
): DaypartingSuggestion[] {
  const suggestions: DaypartingSuggestion[] = [];
  
  if (!performance.hourlyData || performance.hourlyData.length === 0) {
    return suggestions;
  }
  
  // 按时段聚合数据
  const hourlyStats = new Map<string, {
    impressions: number;
    clicks: number;
    cost: number;
    sales: number;
    orders: number;
  }>();
  
  for (const data of performance.hourlyData) {
    const key = `${data.dayOfWeek}-${Math.floor(data.hour / 2)}`; // 每2小时一个时段
    const existing = hourlyStats.get(key) || {
      impressions: 0,
      clicks: 0,
      cost: 0,
      sales: 0,
      orders: 0
    };
    
    existing.impressions += data.impressions;
    existing.clicks += data.clicks;
    existing.cost += data.cost;
    existing.sales += data.sales;
    existing.orders += data.orders;
    
    hourlyStats.set(key, existing);
  }
  
  // 计算整体平均效率
  const totalStats = Array.from(hourlyStats.values()).reduce(
    (acc, curr) => ({
      impressions: acc.impressions + curr.impressions,
      clicks: acc.clicks + curr.clicks,
      cost: acc.cost + curr.cost,
      sales: acc.sales + curr.sales,
      orders: acc.orders + curr.orders
    }),
    { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 }
  );
  
  const avgCvr = totalStats.clicks > 0 ? totalStats.orders / totalStats.clicks : 0;
  const avgAcos = totalStats.sales > 0 ? totalStats.cost / totalStats.sales : 1;
  
  // 为每个时段生成建议
  const hourlyStatsEntries = Array.from(hourlyStats.entries());
  for (let i = 0; i < hourlyStatsEntries.length; i++) {
    const [key, stats] = hourlyStatsEntries[i];
    const [dayStr, hourSlotStr] = key.split('-');
    const dayOfWeek = parseInt(dayStr);
    const hourSlot = parseInt(hourSlotStr);
    const hour = hourSlot * 2;
    
    if (stats.clicks < 3) continue; // 数据不足
    
    const slotCvr = stats.clicks > 0 ? stats.orders / stats.clicks : 0;
    const slotAcos = stats.sales > 0 ? stats.cost / stats.sales : 1;
    
    // 计算效率比
    const efficiencyRatio = avgAcos > 0 ? avgAcos / slotAcos : 1;
    
    const currentMultiplier = currentMultipliers[dayOfWeek]?.[hourSlot] || 1;
    const suggestedMultiplier = Math.max(0.1, Math.min(3, currentMultiplier * Math.pow(efficiencyRatio, 0.5)));
    
    if (Math.abs(suggestedMultiplier - currentMultiplier) > 0.1) {
      suggestions.push({
        dayOfWeek,
        hour,
        currentMultiplier,
        suggestedMultiplier: Math.round(suggestedMultiplier * 100) / 100,
        reasoning: efficiencyRatio > 1
          ? `该时段效率高于平均(${(efficiencyRatio * 100).toFixed(0)}%)，建议提高竞价`
          : `该时段效率低于平均(${(efficiencyRatio * 100).toFixed(0)}%)，建议降低竞价`
      });
    }
  }
  
  return suggestions;
}

// ==================== SB视频广告特殊处理 ====================

/**
 * SB视频广告优化参数
 */
export interface SBVideoOptimizationParams extends SearchAdOptimizationParams {
  videoViewRateThreshold: number;      // 视频观看率阈值
  videoCompletionRateThreshold: number; // 视频完播率阈值
  newToBrandWeight: number;             // 新客户权重
}

/**
 * 默认SB视频广告优化参数
 */
export const DEFAULT_SB_VIDEO_PARAMS: SBVideoOptimizationParams = {
  ...DEFAULT_SEARCH_AD_PARAMS,
  targetAcos: 0.30, // SB广告ACoS目标通常略高
  videoViewRateThreshold: 0.50,
  videoCompletionRateThreshold: 0.25,
  newToBrandWeight: 1.5 // 新客户价值权重
};

/**
 * SB视频广告绩效数据
 */
export interface SBVideoPerformance extends SearchAdPerformance {
  videoViews: number;
  videoViewRate: number;
  videoCompletionRate: number;
  newToBrandOrders: number;
  newToBrandSales: number;
  newToBrandOrdersPercent: number;
}

/**
 * 生成SB视频广告优化建议
 */
export async function generateSBVideoOptimizationSuggestion(
  accountId: number,
  performance: SBVideoPerformance,
  params: SBVideoOptimizationParams = DEFAULT_SB_VIDEO_PARAMS
): Promise<SearchAdOptimizationSuggestion | null> {
  // 1. 首先检查视频特有指标
  if (performance.videoViewRate < params.videoViewRateThreshold && performance.impressions >= params.minImpressions) {
    // 视频观看率过低，可能需要优化创意而非竞价
    return {
      targetId: performance.targetId,
      targetName: performance.targetName,
      adType: 'sb_video',
      suggestionType: 'bid_adjustment',
      priority: 'medium',
      currentValue: performance.currentBid,
      suggestedValue: performance.currentBid * 0.9,
      changePercent: -0.1,
      reasoning: `视频观看率(${(performance.videoViewRate * 100).toFixed(1)}%)低于阈值(${(params.videoViewRateThreshold * 100).toFixed(0)}%)，建议优化视频创意，同时适当降低竞价`,
      expectedImpact: {
        metric: 'video_view_rate',
        currentValue: performance.videoViewRate,
        expectedValue: performance.videoViewRate,
        changePercent: 0
      },
      confidence: 0.7,
      algorithmSource: 'rule_based'
    };
  }
  
  // 2. 计算调整后的ACoS（考虑新客户价值）
  const adjustedSales = performance.sales + (performance.newToBrandSales * (params.newToBrandWeight - 1));
  const adjustedAcos = adjustedSales > 0 ? performance.cost / adjustedSales : performance.acos;
  
  // 3. 创建调整后的绩效数据用于决策树
  const adjustedPerformance: SearchAdPerformance = {
    ...performance,
    acos: adjustedAcos,
    sales: adjustedSales,
    roas: adjustedSales / Math.max(performance.cost, 0.01)
  };
  
  // 4. 使用搜索广告优化引擎生成建议
  const suggestion = await generateSearchAdOptimizationSuggestion(
    accountId,
    adjustedPerformance,
    params
  );
  
  if (suggestion) {
    // 更新建议的reasoning，说明考虑了新客户价值
    if (performance.newToBrandOrdersPercent > 0.3) {
      suggestion.reasoning += `（已考虑${(performance.newToBrandOrdersPercent * 100).toFixed(0)}%新客户订单的额外价值）`;
    }
  }
  
  return suggestion;
}

// ==================== 批量优化 ====================

/**
 * 批量生成搜索广告优化建议
 */
export async function batchGenerateSearchAdSuggestions(
  accountId: number,
  performances: SearchAdPerformance[],
  params: SearchAdOptimizationParams = DEFAULT_SEARCH_AD_PARAMS
): Promise<SearchAdOptimizationSuggestion[]> {
  const suggestions: SearchAdOptimizationSuggestion[] = [];
  
  for (const performance of performances) {
    try {
      const suggestion = await generateSearchAdOptimizationSuggestion(
        accountId,
        performance,
        params
      );
      
      if (suggestion) {
        suggestions.push(suggestion);
      }
    } catch (error) {
      console.error(`[searchAdsOptimization] Error generating suggestion for ${performance.targetId}:`, error);
    }
  }
  
  // 按优先级和置信度排序
  suggestions.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.confidence - a.confidence;
  });
  
  return suggestions;
}

/**
 * 导出算法常量供测试使用
 */
export const ALGORITHM_CONSTANTS = {
  DEFAULT_SEARCH_AD_PARAMS,
  DEFAULT_SB_VIDEO_PARAMS,
  SEARCH_AD_DECISION_TREE
};
