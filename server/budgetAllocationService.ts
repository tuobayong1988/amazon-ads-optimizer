/**
 * Budget Allocation Service - 预算智能分配服务
 * 基于历史表现和销售目标，为广告活动推荐最佳预算分配
 */

import { getDb } from "./db";
import {
  budgetGoals,
  budgetAllocations,
  budgetAllocationItems,
  budgetHistory,
  campaigns,
  dailyPerformance,
} from "../drizzle/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

// 广告活动表现数据接口
interface CampaignPerformance {
  campaignId: number;
  campaignName: string;
  campaignType: string;
  currentBudget: number;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  roas: number;
  acos: number;
  ctr: number;
  cvr: number;
  cpc: number;
}

// 预算分配建议接口
interface BudgetRecommendation {
  campaignId: number;
  campaignName: string;
  currentBudget: number;
  recommendedBudget: number;
  budgetChange: number;
  changePercent: number;
  priorityScore: number;
  allocationReason: string;
  reasonDetail: string;
  historicalMetrics: {
    roas: number;
    acos: number;
    ctr: number;
    cvr: number;
    spend: number;
    sales: number;
  };
  predictedMetrics: {
    spend: number;
    sales: number;
    roas: number;
    acos: number;
  };
}

// 分配结果接口
interface AllocationResult {
  totalBudget: number;
  allocatedBudget: number;
  campaignCount: number;
  recommendations: BudgetRecommendation[];
  summary: {
    increasedCount: number;
    decreasedCount: number;
    unchangedCount: number;
    totalIncrease: number;
    totalDecrease: number;
    predictedSales: number;
    predictedRoas: number;
    predictedAcos: number;
  };
}

/**
 * 计算广告活动的优先级评分
 * 基于ROAS、ACoS、转化率等指标综合评估
 */
function calculatePriorityScore(performance: CampaignPerformance): number {
  let score = 50; // 基础分

  // ROAS评分 (权重30%)
  if (performance.roas >= 5) {
    score += 30;
  } else if (performance.roas >= 3) {
    score += 20;
  } else if (performance.roas >= 2) {
    score += 10;
  } else if (performance.roas < 1) {
    score -= 15;
  }

  // ACoS评分 (权重25%)
  if (performance.acos <= 15) {
    score += 25;
  } else if (performance.acos <= 25) {
    score += 15;
  } else if (performance.acos <= 35) {
    score += 5;
  } else if (performance.acos > 50) {
    score -= 20;
  }

  // 转化率评分 (权重20%)
  if (performance.cvr >= 15) {
    score += 20;
  } else if (performance.cvr >= 10) {
    score += 12;
  } else if (performance.cvr >= 5) {
    score += 5;
  } else if (performance.cvr < 2) {
    score -= 10;
  }

  // 点击率评分 (权重15%)
  if (performance.ctr >= 1) {
    score += 15;
  } else if (performance.ctr >= 0.5) {
    score += 8;
  } else if (performance.ctr >= 0.3) {
    score += 3;
  } else if (performance.ctr < 0.1) {
    score -= 8;
  }

  // 销售额贡献评分 (权重10%)
  if (performance.sales >= 1000) {
    score += 10;
  } else if (performance.sales >= 500) {
    score += 6;
  } else if (performance.sales >= 100) {
    score += 3;
  }

  // 确保分数在0-100范围内
  return Math.max(0, Math.min(100, score));
}

/**
 * 确定预算分配原因
 */
function determineAllocationReason(
  performance: CampaignPerformance,
  budgetChange: number,
  priorityScore: number
): { reason: string; detail: string } {
  if (budgetChange > 0) {
    // 增加预算的原因
    if (performance.roas >= 4) {
      return {
        reason: "high_roas",
        detail: `ROAS高达${performance.roas.toFixed(2)}，表现优异，建议增加预算以获取更多销售`,
      };
    }
    if (performance.acos <= 20) {
      return {
        reason: "low_acos",
        detail: `ACoS仅${performance.acos.toFixed(1)}%，广告效率高，建议增加预算扩大规模`,
      };
    }
    if (performance.cvr >= 12) {
      return {
        reason: "high_conversion",
        detail: `转化率达${performance.cvr.toFixed(1)}%，转化能力强，建议增加预算`,
      };
    }
    if (priorityScore >= 75) {
      return {
        reason: "growth_potential",
        detail: `综合评分${priorityScore.toFixed(0)}分，具有较大增长潜力`,
      };
    }
    return {
      reason: "rebalance",
      detail: "根据整体预算分配策略进行调整",
    };
  } else if (budgetChange < 0) {
    // 减少预算的原因
    if (performance.roas < 1.5) {
      return {
        reason: "low_roas",
        detail: `ROAS仅${performance.roas.toFixed(2)}，投入产出比低，建议减少预算`,
      };
    }
    if (performance.acos > 40) {
      return {
        reason: "high_acos",
        detail: `ACoS高达${performance.acos.toFixed(1)}%，广告成本过高，建议减少预算`,
      };
    }
    if (performance.cvr < 3) {
      return {
        reason: "low_conversion",
        detail: `转化率仅${performance.cvr.toFixed(1)}%，转化效果差，建议减少预算`,
      };
    }
    if (priorityScore < 40) {
      return {
        reason: "budget_limit",
        detail: `综合评分${priorityScore.toFixed(0)}分，表现不佳，建议将预算转移到更优活动`,
      };
    }
    return {
      reason: "rebalance",
      detail: "根据整体预算分配策略进行调整",
    };
  }

  return {
    reason: "maintain",
    detail: "当前预算配置合理，建议保持现状",
  };
}

/**
 * 预测调整后的效果
 */
function predictMetrics(
  performance: CampaignPerformance,
  newBudget: number
): { spend: number; sales: number; roas: number; acos: number } {
  const budgetRatio = newBudget / Math.max(performance.currentBudget, 1);

  // 简化的预测模型：假设边际效益递减
  let spendMultiplier = budgetRatio;
  let salesMultiplier = budgetRatio;

  // 预算增加时，边际效益递减
  if (budgetRatio > 1) {
    const increaseRatio = budgetRatio - 1;
    // 每增加100%预算，实际效果只有80%
    salesMultiplier = 1 + increaseRatio * 0.8;
    spendMultiplier = budgetRatio; // 花费按比例增加
  } else if (budgetRatio < 1) {
    // 预算减少时，效果下降略慢于预算下降
    const decreaseRatio = 1 - budgetRatio;
    salesMultiplier = 1 - decreaseRatio * 0.9;
    spendMultiplier = budgetRatio;
  }

  const predictedSpend = performance.spend * spendMultiplier;
  const predictedSales = performance.sales * salesMultiplier;
  const predictedRoas = predictedSales / Math.max(predictedSpend, 0.01);
  const predictedAcos = (predictedSpend / Math.max(predictedSales, 0.01)) * 100;

  return {
    spend: Math.round(predictedSpend * 100) / 100,
    sales: Math.round(predictedSales * 100) / 100,
    roas: Math.round(predictedRoas * 100) / 100,
    acos: Math.round(predictedAcos * 10) / 10,
  };
}

/**
 * 生成预算分配建议
 */
export async function generateBudgetAllocation(
  userId: number,
  accountId: number | null,
  totalBudget: number,
  options: {
    prioritizeHighRoas?: boolean;
    prioritizeNewProducts?: boolean;
    minCampaignBudget?: number;
    maxCampaignBudget?: number;
    targetRoas?: number;
    targetAcos?: number;
  } = {}
): Promise<AllocationResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const {
    prioritizeHighRoas = true,
    minCampaignBudget = 10,
    maxCampaignBudget = totalBudget * 0.3,
    targetRoas,
    targetAcos,
  } = options;

  // 获取广告活动及其历史表现
  const campaignQuery = accountId
    ? and(eq(campaigns.accountId, accountId), eq(campaigns.campaignStatus, "enabled"))
    : eq(campaigns.campaignStatus, "enabled");

  const campaignList: any[] = await db
    .select()
    .from(campaigns)
    .where(campaignQuery);

  if (campaignList.length === 0) {
    return {
      totalBudget,
      allocatedBudget: 0,
      campaignCount: 0,
      recommendations: [],
      summary: {
        increasedCount: 0,
        decreasedCount: 0,
        unchangedCount: 0,
        totalIncrease: 0,
        totalDecrease: 0,
        predictedSales: 0,
        predictedRoas: 0,
        predictedAcos: 0,
      },
    };
  }

  // 计算每个活动的表现数据
  const performances: CampaignPerformance[] = campaignList.map((campaign) => {
    const spend = Number(campaign.spend) || 0;
    const sales = Number(campaign.sales) || 0;
    const orders = Number(campaign.orders) || 0;
    const clicks = Number(campaign.clicks) || 0;
    const impressions = Number(campaign.impressions) || 0;

    return {
      campaignId: campaign.id,
      campaignName: campaign.campaignName,
      campaignType: campaign.campaignType,
      currentBudget: Number(campaign.dailyBudget) || 0,
      spend,
      sales,
      orders,
      clicks,
      impressions,
      roas: spend > 0 ? sales / spend : 0,
      acos: sales > 0 ? (spend / sales) * 100 : 100,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cvr: clicks > 0 ? (orders / clicks) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
    };
  });

  // 计算优先级评分
  const scoredPerformances = performances.map((p) => ({
    ...p,
    priorityScore: calculatePriorityScore(p),
  }));

  // 按优先级排序
  scoredPerformances.sort((a, b) => b.priorityScore - a.priorityScore);

  // 计算当前总预算
  const currentTotalBudget = scoredPerformances.reduce(
    (sum, p) => sum + p.currentBudget,
    0
  );

  // 预算分配算法
  const recommendations: BudgetRecommendation[] = [];
  let remainingBudget = totalBudget;
  let allocatedBudget = 0;

  // 第一轮：为高优先级活动分配预算
  const highPriorityCampaigns = scoredPerformances.filter(
    (p) => p.priorityScore >= 60
  );
  const mediumPriorityCampaigns = scoredPerformances.filter(
    (p) => p.priorityScore >= 40 && p.priorityScore < 60
  );
  const lowPriorityCampaigns = scoredPerformances.filter(
    (p) => p.priorityScore < 40
  );

  // 预算分配比例
  const highPriorityRatio = 0.6; // 60%给高优先级
  const mediumPriorityRatio = 0.3; // 30%给中优先级
  const lowPriorityRatio = 0.1; // 10%给低优先级

  const highPriorityBudget = totalBudget * highPriorityRatio;
  const mediumPriorityBudget = totalBudget * mediumPriorityRatio;
  const lowPriorityBudget = totalBudget * lowPriorityRatio;

  // 分配高优先级预算
  const allocateToCampaigns = (
    campaignList: (CampaignPerformance & { priorityScore: number })[],
    availableBudget: number
  ): BudgetRecommendation[] => {
    if (campaignList.length === 0) return [];

    const totalScore = campaignList.reduce((sum, c) => sum + c.priorityScore, 0);
    const results: BudgetRecommendation[] = [];

    for (const campaign of campaignList) {
      // 按评分比例分配预算
      const scoreRatio = campaign.priorityScore / Math.max(totalScore, 1);
      let recommendedBudget = availableBudget * scoreRatio;

      // 应用最小/最大预算限制
      recommendedBudget = Math.max(recommendedBudget, minCampaignBudget);
      recommendedBudget = Math.min(recommendedBudget, maxCampaignBudget);
      recommendedBudget = Math.round(recommendedBudget * 100) / 100;

      const budgetChange = recommendedBudget - campaign.currentBudget;
      const changePercent =
        campaign.currentBudget > 0
          ? (budgetChange / campaign.currentBudget) * 100
          : 100;

      const { reason, detail } = determineAllocationReason(
        campaign,
        budgetChange,
        campaign.priorityScore
      );

      const predicted = predictMetrics(campaign, recommendedBudget);

      results.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        currentBudget: campaign.currentBudget,
        recommendedBudget,
        budgetChange: Math.round(budgetChange * 100) / 100,
        changePercent: Math.round(changePercent * 10) / 10,
        priorityScore: campaign.priorityScore,
        allocationReason: reason,
        reasonDetail: detail,
        historicalMetrics: {
          roas: campaign.roas,
          acos: campaign.acos,
          ctr: campaign.ctr,
          cvr: campaign.cvr,
          spend: campaign.spend,
          sales: campaign.sales,
        },
        predictedMetrics: predicted,
      });
    }

    return results;
  };

  // 执行分配
  const highResults = allocateToCampaigns(highPriorityCampaigns, highPriorityBudget);
  const mediumResults = allocateToCampaigns(
    mediumPriorityCampaigns,
    mediumPriorityBudget
  );
  const lowResults = allocateToCampaigns(lowPriorityCampaigns, lowPriorityBudget);

  recommendations.push(...highResults, ...mediumResults, ...lowResults);

  // 计算汇总数据
  allocatedBudget = recommendations.reduce(
    (sum, r) => sum + r.recommendedBudget,
    0
  );

  const increasedCount = recommendations.filter((r) => r.budgetChange > 0).length;
  const decreasedCount = recommendations.filter((r) => r.budgetChange < 0).length;
  const unchangedCount = recommendations.filter(
    (r) => Math.abs(r.budgetChange) < 1
  ).length;

  const totalIncrease = recommendations
    .filter((r) => r.budgetChange > 0)
    .reduce((sum, r) => sum + r.budgetChange, 0);

  const totalDecrease = Math.abs(
    recommendations
      .filter((r) => r.budgetChange < 0)
      .reduce((sum, r) => sum + r.budgetChange, 0)
  );

  const predictedSales = recommendations.reduce(
    (sum, r) => sum + r.predictedMetrics.sales,
    0
  );
  const predictedSpend = recommendations.reduce(
    (sum, r) => sum + r.predictedMetrics.spend,
    0
  );
  const predictedRoas = predictedSpend > 0 ? predictedSales / predictedSpend : 0;
  const predictedAcos = predictedSales > 0 ? (predictedSpend / predictedSales) * 100 : 0;

  return {
    totalBudget,
    allocatedBudget: Math.round(allocatedBudget * 100) / 100,
    campaignCount: recommendations.length,
    recommendations,
    summary: {
      increasedCount,
      decreasedCount,
      unchangedCount,
      totalIncrease: Math.round(totalIncrease * 100) / 100,
      totalDecrease: Math.round(totalDecrease * 100) / 100,
      predictedSales: Math.round(predictedSales * 100) / 100,
      predictedRoas: Math.round(predictedRoas * 100) / 100,
      predictedAcos: Math.round(predictedAcos * 10) / 10,
    },
  };
}

/**
 * 保存预算分配方案
 */
export async function saveBudgetAllocation(
  userId: number,
  accountId: number | null,
  goalId: number | null,
  allocationName: string,
  description: string,
  result: AllocationResult
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 创建分配记录
  const [allocation] = await db.insert(budgetAllocations).values({
    userId,
    accountId,
    goalId,
    allocationName,
    description,
    totalBudget: result.totalBudget.toString(),
    allocatedBudget: result.allocatedBudget.toString(),
    predictedSales: result.summary.predictedSales.toString(),
    predictedRoas: result.summary.predictedRoas.toString(),
    predictedAcos: result.summary.predictedAcos.toString(),
    confidenceScore: "75.00", // 默认置信度
    status: "draft",
  });

  const allocationId = allocation.insertId;

  // 创建分配明细
  for (const rec of result.recommendations) {
    await db.insert(budgetAllocationItems).values({
      allocationId: Number(allocationId),
      campaignId: rec.campaignId,
      currentBudget: rec.currentBudget.toString(),
      recommendedBudget: rec.recommendedBudget.toString(),
      budgetChange: rec.budgetChange.toString(),
      changePercent: rec.changePercent.toString(),
      historicalSpend: rec.historicalMetrics.spend.toString(),
      historicalSales: rec.historicalMetrics.sales.toString(),
      historicalRoas: rec.historicalMetrics.roas.toString(),
      historicalAcos: rec.historicalMetrics.acos.toString(),
      historicalCtr: rec.historicalMetrics.ctr.toString(),
      historicalCvr: rec.historicalMetrics.cvr.toString(),
      predictedSpend: rec.predictedMetrics.spend.toString(),
      predictedSales: rec.predictedMetrics.sales.toString(),
      predictedRoas: rec.predictedMetrics.roas.toString(),
      predictedAcos: rec.predictedMetrics.acos.toString(),
      allocationReason: rec.allocationReason as any,
      reasonDetail: rec.reasonDetail,
      priorityScore: rec.priorityScore.toString(),
      status: "pending",
    });
  }

  return Number(allocationId);
}

/**
 * 应用预算分配方案
 */
export async function applyBudgetAllocation(
  allocationId: number,
  userId: number
): Promise<{ success: boolean; appliedCount: number; errors: string[] }> {
  const db = await getDb();
  if (!db) return { success: false, appliedCount: 0, errors: ["Database not available"] };

  // 获取分配方案
  const [allocation] = await db
    .select()
    .from(budgetAllocations)
    .where(eq(budgetAllocations.id, allocationId));

  if (!allocation) {
    return { success: false, appliedCount: 0, errors: ["分配方案不存在"] };
  }

  if (allocation.status === "applied") {
    return { success: false, appliedCount: 0, errors: ["该方案已应用"] };
  }

  // 获取分配明细
  const items = await db
    .select()
    .from(budgetAllocationItems)
    .where(eq(budgetAllocationItems.allocationId, allocationId));

  const errors: string[] = [];
  let appliedCount = 0;

  for (const item of items) {
    try {
      // 获取当前广告活动
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, item.campaignId));

      if (!campaign) {
        errors.push(`广告活动 ${item.campaignId} 不存在`);
        continue;
      }

      const previousBudget = Number(campaign.maxBid) || 0;
      const newBudget = Number(item.recommendedBudget);

      // 更新广告活动预算
      await db
        .update(campaigns)
        .set({ maxBid: newBudget.toString() })
        .where(eq(campaigns.id, item.campaignId));

      // 记录预算调整历史
      await db.insert(budgetHistory).values({
        userId,
        accountId: allocation.accountId,
        campaignId: item.campaignId,
        allocationId,
        previousBudget: previousBudget.toString(),
        newBudget: newBudget.toString(),
        changeAmount: (newBudget - previousBudget).toString(),
        changePercent:
          previousBudget > 0
            ? (((newBudget - previousBudget) / previousBudget) * 100).toString()
            : "100",
        source: "auto_allocation",
        reason: item.reasonDetail,
        snapshotRoas: item.historicalRoas,
        snapshotAcos: item.historicalAcos,
        snapshotSpend: item.historicalSpend,
        snapshotSales: item.historicalSales,
      });

      // 更新明细状态
      await db
        .update(budgetAllocationItems)
        .set({ status: "applied", appliedAt: new Date().toISOString() })
        .where(eq(budgetAllocationItems.id, item.id));

      appliedCount++;
    } catch (error) {
      errors.push(`应用广告活动 ${item.campaignId} 预算失败: ${error}`);
    }
  }

  // 更新分配方案状态
  await db
    .update(budgetAllocations)
    .set({
      status: "applied",
      appliedAt: new Date().toISOString(),
      appliedBy: userId,
    })
    .where(eq(budgetAllocations.id, allocationId));

  return {
    success: errors.length === 0,
    appliedCount,
    errors,
  };
}

/**
 * 获取预算分配历史
 */
export async function getBudgetAllocationHistory(
  userId: number,
  accountId?: number,
  limit: number = 20
) {
  const db = await getDb();
  if (!db) return [];

  const query = accountId
    ? and(
        eq(budgetAllocations.userId, userId),
        eq(budgetAllocations.accountId, accountId)
      )
    : eq(budgetAllocations.userId, userId);

  const allocations = await db
    .select()
    .from(budgetAllocations)
    .where(query)
    .orderBy(desc(budgetAllocations.createdAt))
    .limit(limit);

  return allocations;
}

/**
 * 获取预算调整历史
 */
export async function getBudgetHistory(
  userId: number,
  options: {
    accountId?: number;
    campaignId?: number;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  } = {}
) {
  const db = await getDb();
  if (!db) return [];

  const { accountId, campaignId, startDate, endDate, limit = 50 } = options;

  let query = eq(budgetHistory.userId, userId);

  if (accountId) {
    query = and(query, eq(budgetHistory.accountId, accountId)) as any;
  }

  if (campaignId) {
    query = and(query, eq(budgetHistory.campaignId, campaignId)) as any;
  }

  if (startDate) {
    query = and(query, gte(budgetHistory.createdAt, startDate.toISOString())) as any;
  }

  if (endDate) {
    query = and(query, lte(budgetHistory.createdAt, endDate.toISOString())) as any;
  }

  const history = await db
    .select()
    .from(budgetHistory)
    .where(query)
    .orderBy(desc(budgetHistory.createdAt))
    .limit(limit);

  return history;
}

/**
 * 创建预算目标
 */
export async function createBudgetGoal(
  userId: number,
  data: {
    accountId?: number;
    goalType: string;
    targetValue: number;
    periodType?: string;
    startDate?: Date;
    endDate?: Date;
    totalBudget?: number;
    minCampaignBudget?: number;
    maxCampaignBudget?: number;
    prioritizeHighRoas?: boolean;
    prioritizeNewProducts?: boolean;
  }
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(budgetGoals).values({
    userId,
    accountId: data.accountId,
    goalType: data.goalType as any,
    targetValue: data.targetValue.toString(),
    periodType: (data.periodType as any) || "monthly",
    startDate: data.startDate?.toISOString(),
    endDate: data.endDate?.toISOString(),
    totalBudget: data.totalBudget?.toString(),
    minCampaignBudget: data.minCampaignBudget?.toString() || "10.00",
    maxCampaignBudget: data.maxCampaignBudget?.toString(),
    prioritizeHighRoas: data.prioritizeHighRoas ? 1 : 0,
    prioritizeNewProducts: data.prioritizeNewProducts ? 1 : 0,
    status: "active",
  });

  return Number(result.insertId);
}

/**
 * 获取预算目标列表
 */
export async function getBudgetGoals(userId: number, accountId?: number) {
  const db = await getDb();
  if (!db) return [];

  const query = accountId
    ? and(eq(budgetGoals.userId, userId), eq(budgetGoals.accountId, accountId))
    : eq(budgetGoals.userId, userId);

  const goals = await db
    .select()
    .from(budgetGoals)
    .where(query)
    .orderBy(desc(budgetGoals.createdAt));

  return goals;
}

/**
 * 更新预算目标
 */
export async function updateBudgetGoal(
  goalId: number,
  data: Partial<{
    targetValue: number;
    totalBudget: number;
    status: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = {};
  if (data.targetValue !== undefined) {
    updateData.targetValue = data.targetValue.toString();
  }
  if (data.totalBudget !== undefined) {
    updateData.totalBudget = data.totalBudget.toString();
  }
  if (data.status !== undefined) {
    updateData.status = data.status;
  }

  await db
    .update(budgetGoals)
    .set(updateData)
    .where(eq(budgetGoals.id, goalId));
}

/**
 * 删除预算目标
 */
export async function deleteBudgetGoal(goalId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(budgetGoals).where(eq(budgetGoals.id, goalId));
}
