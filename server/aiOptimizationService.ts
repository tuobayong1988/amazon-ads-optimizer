/**
 * AI优化服务模块
 * 提供一键执行优化建议、效果预估、复盘分析等功能
 */

import * as db from "./db";
import { invokeLLM } from "./_core/llm";

// 优化建议类型
export interface OptimizationSuggestion {
  type: "bid_adjustment" | "status_change" | "negative_keyword";
  targetType: "keyword" | "product_target" | "search_term";
  targetId?: number;
  targetText: string;
  action: "bid_increase" | "bid_decrease" | "bid_set" | "enable" | "pause" | "negate_phrase" | "negate_exact";
  currentValue?: string;
  suggestedValue?: string;
  reason: string;
  priority: "high" | "medium" | "low";
  expectedImpact?: {
    spendChange?: number;
    salesChange?: number;
    acosChange?: number;
    roasChange?: number;
  };
}

// AI分析结果（包含可执行建议）
export interface AIAnalysisResult {
  summary: string;
  metrics: {
    spend: number;
    sales: number;
    acos: number;
    roas: number;
    ctr: number;
    cvr: number;
    impressions: number;
    clicks: number;
    orders: number;
  };
  suggestions: OptimizationSuggestion[];
  predictions: {
    period: "7_days" | "14_days" | "30_days";
    predictedSpend: number;
    predictedSales: number;
    predictedAcos: number;
    predictedRoas: number;
    spendChangePercent: number;
    salesChangePercent: number;
    acosChangePercent: number;
    roasChangePercent: number;
    confidence: number;
    rationale: string;
  }[];
}

/**
 * 生成AI分析和优化建议
 */
export async function generateAIAnalysisWithSuggestions(campaignId: number): Promise<AIAnalysisResult> {
  // 获取广告活动详情
  const campaign = await db.getCampaignById(campaignId);
  if (!campaign) {
    throw new Error("广告活动不存在");
  }
  
  // 获取广告组和投放词数据
  const adGroups = await db.getAdGroupsByCampaignId(campaignId);
  let allKeywords: any[] = [];
  let allProductTargets: any[] = [];
  
  for (const adGroup of adGroups) {
    const keywords = await db.getKeywordsByAdGroupId(adGroup.id);
    const productTargets = await db.getProductTargetsByAdGroupId(adGroup.id);
    allKeywords.push(...keywords.map(k => ({ ...k, adGroupName: adGroup.adGroupName })));
    allProductTargets.push(...productTargets.map(pt => ({ ...pt, adGroupName: adGroup.adGroupName })));
  }
  
  // 获取搜索词数据
  const searchTerms = await db.getSearchTermsByCampaignId(campaignId);
  
  // 计算核心指标
  const spend = parseFloat(campaign.spend || "0");
  const sales = parseFloat(campaign.sales || "0");
  const acos = sales > 0 ? (spend / sales * 100) : 0;
  const roas = spend > 0 ? (sales / spend) : 0;
  const clicks = campaign.clicks || 0;
  const impressions = campaign.impressions || 0;
  const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
  const orders = campaign.orders || 0;
  const cvr = clicks > 0 ? (orders / clicks * 100) : 0;
  
  // 分析投放词表现，生成优化建议
  const suggestions: OptimizationSuggestion[] = [];
  
  // 分析关键词
  for (const keyword of allKeywords) {
    const kSpend = parseFloat(keyword.spend || "0");
    const kSales = parseFloat(keyword.sales || "0");
    const kClicks = keyword.clicks || 0;
    const kOrders = keyword.orders || 0;
    const kAcos = kSales > 0 ? (kSpend / kSales * 100) : 999;
    const kCvr = kClicks > 0 ? (kOrders / kClicks * 100) : 0;
    const kCpc = kClicks > 0 ? (kSpend / kClicks) : 0;
    const currentBid = parseFloat(keyword.bid || "0");
    
    // 高花费低转化 - 建议降低出价或暂停
    if (kSpend > 10 && kOrders === 0) {
      suggestions.push({
        type: "bid_adjustment",
        targetType: "keyword",
        targetId: keyword.id,
        targetText: keyword.keywordText,
        action: kSpend > 50 ? "pause" : "bid_decrease",
        currentValue: `$${currentBid.toFixed(2)}`,
        suggestedValue: kSpend > 50 ? "暂停" : `$${(currentBid * 0.7).toFixed(2)}`,
        reason: `花费$${kSpend.toFixed(2)}但无转化，建议${kSpend > 50 ? "暂停" : "降低出价30%"}`,
        priority: kSpend > 50 ? "high" : "medium",
        expectedImpact: {
          spendChange: kSpend > 50 ? -kSpend : -kSpend * 0.3,
          acosChange: kSpend > 50 ? -5 : -2
        }
      });
    }
    // ACoS过高 - 建议降低出价
    else if (kAcos > 50 && kOrders > 0) {
      const targetBid = kCpc * (30 / kAcos); // 目标ACoS 30%
      suggestions.push({
        type: "bid_adjustment",
        targetType: "keyword",
        targetId: keyword.id,
        targetText: keyword.keywordText,
        action: "bid_decrease",
        currentValue: `$${currentBid.toFixed(2)}`,
        suggestedValue: `$${Math.max(0.1, targetBid).toFixed(2)}`,
        reason: `ACoS ${kAcos.toFixed(1)}%过高，建议降低出价至$${Math.max(0.1, targetBid).toFixed(2)}`,
        priority: kAcos > 80 ? "high" : "medium",
        expectedImpact: {
          acosChange: -(kAcos - 30) * 0.5
        }
      });
    }
    // 高转化低出价 - 建议提高出价
    else if (kCvr > 15 && kAcos < 20 && kClicks > 5) {
      suggestions.push({
        type: "bid_adjustment",
        targetType: "keyword",
        targetId: keyword.id,
        targetText: keyword.keywordText,
        action: "bid_increase",
        currentValue: `$${currentBid.toFixed(2)}`,
        suggestedValue: `$${(currentBid * 1.3).toFixed(2)}`,
        reason: `转化率${kCvr.toFixed(1)}%优秀，ACoS仅${kAcos.toFixed(1)}%，建议提高出价30%争取更多流量`,
        priority: "high",
        expectedImpact: {
          salesChange: kSales * 0.3,
          spendChange: kSpend * 0.3
        }
      });
    }
    // 暂停的高价值词 - 建议启用
    else if (keyword.status === "paused" && kSales > 50 && kAcos < 30) {
      suggestions.push({
        type: "status_change",
        targetType: "keyword",
        targetId: keyword.id,
        targetText: keyword.keywordText,
        action: "enable",
        currentValue: "暂停",
        suggestedValue: "启用",
        reason: `历史销售额$${kSales.toFixed(2)}，ACoS ${kAcos.toFixed(1)}%，建议重新启用`,
        priority: "medium",
        expectedImpact: {
          salesChange: kSales * 0.5
        }
      });
    }
  }
  
  // 分析搜索词
  for (const searchTerm of searchTerms) {
    const stSpend = parseFloat(searchTerm.spend || "0");
    const stSales = parseFloat(searchTerm.sales || "0");
    const stClicks = searchTerm.clicks || 0;
    const stOrders = searchTerm.orders || 0;
    const stAcos = stSales > 0 ? (stSpend / stSales * 100) : 999;
    
    // 高花费无转化搜索词 - 建议否定
    if (stSpend > 15 && stOrders === 0 && stClicks > 10) {
      suggestions.push({
        type: "negative_keyword",
        targetType: "search_term",
        targetText: searchTerm.searchTerm,
        action: stClicks > 30 ? "negate_exact" : "negate_phrase",
        currentValue: "无",
        suggestedValue: stClicks > 30 ? "精准否定" : "词组否定",
        reason: `花费$${stSpend.toFixed(2)}，${stClicks}次点击无转化，建议添加为否定词`,
        priority: stSpend > 30 ? "high" : "medium",
        expectedImpact: {
          spendChange: -stSpend * 0.8
        }
      });
    }
    // ACoS极高的搜索词 - 建议否定
    else if (stAcos > 100 && stSpend > 10) {
      suggestions.push({
        type: "negative_keyword",
        targetType: "search_term",
        targetText: searchTerm.searchTerm,
        action: "negate_phrase",
        currentValue: "无",
        suggestedValue: "词组否定",
        reason: `ACoS ${stAcos.toFixed(1)}%过高，建议添加为否定词`,
        priority: "medium",
        expectedImpact: {
          spendChange: -stSpend * 0.7,
          acosChange: -2
        }
      });
    }
  }
  
  // 按优先级排序
  suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
  
  // 限制建议数量
  const topSuggestions = suggestions.slice(0, 20);
  
  // 生成效果预测
  const predictions = generatePredictions(spend, sales, acos, roas, topSuggestions);
  
  // 使用LLM生成摘要
  const summary = await generateSummaryWithLLM(campaign, { spend, sales, acos, roas, ctr, cvr, impressions, clicks, orders }, topSuggestions);
  
  return {
    summary,
    metrics: { spend, sales, acos, roas, ctr, cvr, impressions, clicks, orders },
    suggestions: topSuggestions,
    predictions
  };
}

/**
 * 生成效果预测
 */
function generatePredictions(
  currentSpend: number,
  currentSales: number,
  currentAcos: number,
  currentRoas: number,
  suggestions: OptimizationSuggestion[]
): AIAnalysisResult["predictions"] {
  // 计算预期影响
  let totalSpendChange = 0;
  let totalSalesChange = 0;
  
  for (const suggestion of suggestions) {
    if (suggestion.expectedImpact) {
      totalSpendChange += suggestion.expectedImpact.spendChange || 0;
      totalSalesChange += suggestion.expectedImpact.salesChange || 0;
    }
  }
  
  // 基于建议数量和类型计算置信度
  const confidence = Math.min(0.85, 0.5 + suggestions.length * 0.02);
  
  // 生成不同时间段的预测
  const periods: ("7_days" | "14_days" | "30_days")[] = ["7_days", "14_days", "30_days"];
  const multipliers = { "7_days": 0.3, "14_days": 0.6, "30_days": 1.0 };
  
  return periods.map(period => {
    const mult = multipliers[period];
    const predictedSpendChange = totalSpendChange * mult;
    const predictedSalesChange = totalSalesChange * mult;
    
    const predictedSpend = Math.max(0, currentSpend + predictedSpendChange);
    const predictedSales = Math.max(0, currentSales + predictedSalesChange);
    const predictedAcos = predictedSales > 0 ? (predictedSpend / predictedSales * 100) : currentAcos;
    const predictedRoas = predictedSpend > 0 ? (predictedSales / predictedSpend) : currentRoas;
    
    return {
      period,
      predictedSpend,
      predictedSales,
      predictedAcos,
      predictedRoas,
      spendChangePercent: currentSpend > 0 ? (predictedSpendChange / currentSpend * 100) : 0,
      salesChangePercent: currentSales > 0 ? (predictedSalesChange / currentSales * 100) : 0,
      acosChangePercent: currentAcos > 0 ? ((predictedAcos - currentAcos) / currentAcos * 100) : 0,
      roasChangePercent: currentRoas > 0 ? ((predictedRoas - currentRoas) / currentRoas * 100) : 0,
      confidence: confidence * mult,
      rationale: `基于${suggestions.length}条优化建议，预计${period === "7_days" ? "7天" : period === "14_days" ? "14天" : "30天"}后效果逐步显现`
    };
  });
}

/**
 * 使用LLM生成摘要
 */
async function generateSummaryWithLLM(
  campaign: any,
  metrics: any,
  suggestions: OptimizationSuggestion[]
): Promise<string> {
  const suggestionsSummary = suggestions.slice(0, 5).map((s, i) => 
    `${i + 1}. [${s.priority === "high" ? "高优先级" : s.priority === "medium" ? "中优先级" : "低优先级"}] ${s.reason}`
  ).join("\n");
  
  const prompt = `你是一个专业的亚马逊广告优化专家。请根据以下广告活动数据和AI生成的优化建议，生成一份简洁的中文分析摘要。

广告活动: ${campaign.campaignName}
核心指标:
- 花费: $${metrics.spend.toFixed(2)}
- 销售额: $${metrics.sales.toFixed(2)}
- ACoS: ${metrics.acos.toFixed(2)}%
- ROAS: ${metrics.roas.toFixed(2)}
- 点击率: ${metrics.ctr.toFixed(2)}%
- 转化率: ${metrics.cvr.toFixed(2)}%

AI识别的优化建议 (共${suggestions.length}条):
${suggestionsSummary}

请提供:
1. 整体表现评价（一句话）
2. 主要问题诊断（2-3点）
3. 优化建议概述（说明执行这些建议的预期效果）

请用简洁的中文回复，使用Markdown格式。`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "你是一个专业的亚马逊广告优化顾问，擅长分析广告数据并提供可执行的优化建议。" },
        { role: "user", content: prompt }
      ]
    });
    
    const content = response.choices[0]?.message?.content;
    return typeof content === "string" ? content : "无法生成摘要";
  } catch (error) {
    console.error("LLM摘要生成失败:", error);
    return `## 广告活动分析\n\n当前ACoS为${metrics.acos.toFixed(1)}%，ROAS为${metrics.roas.toFixed(2)}。\n\n系统已识别${suggestions.length}条优化建议，建议执行以改善广告表现。`;
  }
}

/**
 * 执行优化建议
 */
export async function executeOptimizationSuggestions(
  userId: number,
  accountId: number,
  campaignId: number,
  suggestions: OptimizationSuggestion[],
  predictions: AIAnalysisResult["predictions"],
  aiSummary: string
): Promise<{ executionId: number; results: { success: number; failed: number } }> {
  // 获取广告活动当前数据作为基准
  const campaign = await db.getCampaignById(campaignId);
  if (!campaign) {
    throw new Error("广告活动不存在");
  }
  
  const spend = parseFloat(campaign.spend || "0");
  const sales = parseFloat(campaign.sales || "0");
  const acos = sales > 0 ? (spend / sales * 100) : 0;
  const roas = spend > 0 ? (sales / spend) : 0;
  
  // 确定执行类型
  const types = new Set(suggestions.map(s => s.type));
  let executionType: "bid_adjustment" | "status_change" | "negative_keyword" | "mixed" = "mixed";
  if (types.size === 1) {
    const firstType = types.values().next().value;
    if (firstType === "bid_adjustment" || firstType === "status_change" || firstType === "negative_keyword") {
      executionType = firstType;
    }
  }
  
  // 创建执行记录
  const executionId = await db.createAiOptimizationExecution({
    userId,
    accountId,
    campaignId,
    executionName: `AI优化执行 - ${new Date().toLocaleDateString("zh-CN")}`,
    executionType,
    totalActions: suggestions.length,
    aiAnalysisSummary: aiSummary,
    baselineSpend: spend.toString(),
    baselineSales: sales.toString(),
    baselineAcos: acos.toString(),
    baselineRoas: roas.toString(),
    baselineClicks: campaign.clicks || 0,
    baselineImpressions: campaign.impressions || 0,
    baselineOrders: campaign.orders || 0
  });
  
  // 创建操作记录
  const actions = suggestions.map(s => ({
    executionId,
    actionType: mapActionType(s.action),
    targetType: s.targetType,
    targetId: s.targetId,
    targetText: s.targetText,
    previousValue: s.currentValue,
    newValue: s.suggestedValue,
    changeReason: s.reason
  }));
  
  await db.createAiOptimizationActions(actions as any);
  
  // 创建预测记录
  const predictionRecords = predictions.map(p => ({
    executionId,
    predictionPeriod: p.period,
    predictedSpend: p.predictedSpend.toString(),
    predictedSales: p.predictedSales.toString(),
    predictedAcos: p.predictedAcos.toString(),
    predictedRoas: p.predictedRoas.toString(),
    spendChangePercent: p.spendChangePercent.toString(),
    salesChangePercent: p.salesChangePercent.toString(),
    acosChangePercent: p.acosChangePercent.toString(),
    roasChangePercent: p.roasChangePercent.toString(),
    confidenceLevel: p.confidence.toString(),
    predictionRationale: p.rationale
  }));
  
  await db.createAiOptimizationPredictions(predictionRecords as any);
  
  // 创建复盘计划
  const now = new Date();
  for (const prediction of predictions) {
    const daysToAdd = prediction.period === "7_days" ? 7 : prediction.period === "14_days" ? 14 : 30;
    const scheduledAt = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    
    // 获取预测记录ID
    const predictionRecords = await db.getAiOptimizationPredictionsByExecution(executionId);
    const predictionRecord = predictionRecords.find(p => p.predictionPeriod === prediction.period);
    
    if (predictionRecord) {
      await db.createAiOptimizationReview({
        executionId,
        predictionId: predictionRecord.id,
        reviewPeriod: prediction.period,
        scheduledAt
      });
    }
  }
  
  // 执行实际操作
  let successCount = 0;
  let failedCount = 0;
  
  // 更新执行状态为执行中
  await db.updateAiOptimizationExecution(executionId, { status: "executing" });
  
  // 获取所有操作记录
  const actionRecords = await db.getAiOptimizationActionsByExecution(executionId);
  
  for (const action of actionRecords) {
    try {
      await executeAction(action);
      await db.updateAiOptimizationAction(action.id, { 
        status: "success",
        executedAt: new Date()
      });
      successCount++;
    } catch (error: any) {
      await db.updateAiOptimizationAction(action.id, { 
        status: "failed",
        errorMessage: error.message,
        executedAt: new Date()
      });
      failedCount++;
    }
  }
  
  // 更新执行状态
  const finalStatus = failedCount === 0 ? "completed" : 
                      successCount === 0 ? "failed" : "partially_completed";
  
  await db.updateAiOptimizationExecution(executionId, {
    status: finalStatus,
    successfulActions: successCount,
    failedActions: failedCount,
    completedAt: new Date()
  });
  
  return {
    executionId,
    results: { success: successCount, failed: failedCount }
  };
}

/**
 * 映射操作类型
 */
function mapActionType(action: string): "bid_increase" | "bid_decrease" | "bid_set" | "enable_target" | "pause_target" | "add_negative_phrase" | "add_negative_exact" {
  const mapping: Record<string, any> = {
    "bid_increase": "bid_increase",
    "bid_decrease": "bid_decrease",
    "bid_set": "bid_set",
    "enable": "enable_target",
    "pause": "pause_target",
    "negate_phrase": "add_negative_phrase",
    "negate_exact": "add_negative_exact"
  };
  return mapping[action] || "bid_set";
}

/**
 * 执行单个操作
 */
async function executeAction(action: any): Promise<void> {
  switch (action.actionType) {
    case "bid_increase":
    case "bid_decrease":
    case "bid_set":
      if (action.targetType === "keyword" && action.targetId) {
        const newBid = parseFloat(action.newValue?.replace("$", "") || "0");
        if (newBid > 0) {
          await db.updateKeywordBid(action.targetId, newBid.toFixed(2));
        }
      } else if (action.targetType === "product_target" && action.targetId) {
        const newBid = parseFloat(action.newValue?.replace("$", "") || "0");
        if (newBid > 0) {
          await db.updateProductTargetBid(action.targetId, newBid.toFixed(2));
        }
      }
      break;
      
    case "enable_target":
      if (action.targetType === "keyword" && action.targetId) {
        await db.updateKeyword(action.targetId, { status: "enabled" });
      } else if (action.targetType === "product_target" && action.targetId) {
        await db.updateProductTarget(action.targetId, { status: "enabled" });
      }
      break;
      
    case "pause_target":
      if (action.targetType === "keyword" && action.targetId) {
        await db.updateKeyword(action.targetId, { status: "paused" });
      } else if (action.targetType === "product_target" && action.targetId) {
        await db.updateProductTarget(action.targetId, { status: "paused" });
      }
      break;
      
    case "add_negative_phrase":
    case "add_negative_exact":
      // 否定词添加需要知道广告组ID，这里简化处理
      // 实际应用中需要根据搜索词找到对应的广告组
      console.log(`添加否定词: ${action.targetText} (${action.actionType})`);
      break;
      
    default:
      throw new Error(`未知操作类型: ${action.actionType}`);
  }
}

/**
 * 执行复盘分析
 */
export async function executeReviewAnalysis(reviewId: number): Promise<void> {
  const db_instance = await db.getDb();
  if (!db_instance) return;
  
  // 获取复盘记录
  const reviews = await db.getAiOptimizationReviewsByExecution(0); // 需要通过reviewId获取
  // 这里简化处理，实际需要根据reviewId查询
  
  // TODO: 实现复盘逻辑
  // 1. 获取执行记录
  // 2. 获取当前广告活动数据
  // 3. 计算实际变化
  // 4. 与预测对比计算达成率
  // 5. 生成复盘总结
}
