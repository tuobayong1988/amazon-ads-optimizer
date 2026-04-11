// Extracted from production dist/index.js
// Original module: server/budget/budgetAllocationService.ts
// Lines: 547

var budgetAllocationService_exports = {};
__export(budgetAllocationService_exports, {
  applyBudgetAllocation: () => applyBudgetAllocation,
  createBudgetGoal: () => createBudgetGoal,
  deleteBudgetGoal: () => deleteBudgetGoal,
  generateBudgetAllocation: () => generateBudgetAllocation,
  getBudgetAllocationHistory: () => getBudgetAllocationHistory,
  getBudgetGoals: () => getBudgetGoals,
  getBudgetHistory: () => getBudgetHistory,
  saveBudgetAllocation: () => saveBudgetAllocation,
  updateBudgetGoal: () => updateBudgetGoal
});
function calculatePriorityScore2(performance) {
  let score = 50;
  if (performance.roas >= 5) {
    score += 30;
  } else if (performance.roas >= 3) {
    score += 20;
  } else if (performance.roas >= 2) {
    score += 10;
  } else if (performance.roas < 1) {
    score -= 15;
  }
  if (performance.acos <= 15) {
    score += 25;
  } else if (performance.acos <= 25) {
    score += 15;
  } else if (performance.acos <= 35) {
    score += 5;
  } else if (performance.acos > 50) {
    score -= 20;
  }
  if (performance.cvr >= 15) {
    score += 20;
  } else if (performance.cvr >= 10) {
    score += 12;
  } else if (performance.cvr >= 5) {
    score += 5;
  } else if (performance.cvr < 2) {
    score -= 10;
  }
  if (performance.ctr >= 1) {
    score += 15;
  } else if (performance.ctr >= 0.5) {
    score += 8;
  } else if (performance.ctr >= 0.3) {
    score += 3;
  } else if (performance.ctr < 0.1) {
    score -= 8;
  }
  if (performance.sales >= 1e3) {
    score += 10;
  } else if (performance.sales >= 500) {
    score += 6;
  } else if (performance.sales >= 100) {
    score += 3;
  }
  return Math.max(0, Math.min(100, score));
}
function determineAllocationReason(performance, budgetChange, priorityScore) {
  if (budgetChange > 0) {
    if (performance.roas >= 4) {
      return {
        reason: "high_roas",
        detail: `ROAS\u9AD8\u8FBE${performance.roas.toFixed(2)}\uFF0C\u8868\u73B0\u4F18\u5F02\uFF0C\u5EFA\u8BAE\u589E\u52A0\u9884\u7B97\u4EE5\u83B7\u53D6\u66F4\u591A\u9500\u552E`
      };
    }
    if (performance.acos <= 20) {
      return {
        reason: "low_acos",
        detail: `ACoS\u4EC5${performance.acos.toFixed(1)}%\uFF0C\u5E7F\u544A\u6548\u7387\u9AD8\uFF0C\u5EFA\u8BAE\u589E\u52A0\u9884\u7B97\u6269\u5927\u89C4\u6A21`
      };
    }
    if (performance.cvr >= 12) {
      return {
        reason: "high_conversion",
        detail: `\u8F6C\u5316\u7387\u8FBE${performance.cvr.toFixed(1)}%\uFF0C\u8F6C\u5316\u80FD\u529B\u5F3A\uFF0C\u5EFA\u8BAE\u589E\u52A0\u9884\u7B97`
      };
    }
    if (priorityScore >= 75) {
      return {
        reason: "growth_potential",
        detail: `\u7EFC\u5408\u8BC4\u5206${priorityScore.toFixed(0)}\u5206\uFF0C\u5177\u6709\u8F83\u5927\u589E\u957F\u6F5C\u529B`
      };
    }
    return {
      reason: "rebalance",
      detail: "\u6839\u636E\u6574\u4F53\u9884\u7B97\u5206\u914D\u7B56\u7565\u8FDB\u884C\u8C03\u6574"
    };
  } else if (budgetChange < 0) {
    if (performance.roas < 1.5) {
      return {
        reason: "low_roas",
        detail: `ROAS\u4EC5${performance.roas.toFixed(2)}\uFF0C\u6295\u5165\u4EA7\u51FA\u6BD4\u4F4E\uFF0C\u5EFA\u8BAE\u51CF\u5C11\u9884\u7B97`
      };
    }
    if (performance.acos > 40) {
      return {
        reason: "high_acos",
        detail: `ACoS\u9AD8\u8FBE${performance.acos.toFixed(1)}%\uFF0C\u5E7F\u544A\u6210\u672C\u8FC7\u9AD8\uFF0C\u5EFA\u8BAE\u51CF\u5C11\u9884\u7B97`
      };
    }
    if (performance.cvr < 3) {
      return {
        reason: "low_conversion",
        detail: `\u8F6C\u5316\u7387\u4EC5${performance.cvr.toFixed(1)}%\uFF0C\u8F6C\u5316\u6548\u679C\u5DEE\uFF0C\u5EFA\u8BAE\u51CF\u5C11\u9884\u7B97`
      };
    }
    if (priorityScore < 40) {
      return {
        reason: "budget_limit",
        detail: `\u7EFC\u5408\u8BC4\u5206${priorityScore.toFixed(0)}\u5206\uFF0C\u8868\u73B0\u4E0D\u4F73\uFF0C\u5EFA\u8BAE\u5C06\u9884\u7B97\u8F6C\u79FB\u5230\u66F4\u4F18\u6D3B\u52A8`
      };
    }
    return {
      reason: "rebalance",
      detail: "\u6839\u636E\u6574\u4F53\u9884\u7B97\u5206\u914D\u7B56\u7565\u8FDB\u884C\u8C03\u6574"
    };
  }
  return {
    reason: "maintain",
    detail: "\u5F53\u524D\u9884\u7B97\u914D\u7F6E\u5408\u7406\uFF0C\u5EFA\u8BAE\u4FDD\u6301\u73B0\u72B6"
  };
}
function predictMetrics(performance, newBudget) {
  const budgetRatio = newBudget / Math.max(performance.currentBudget, 1);
  let spendMultiplier = budgetRatio;
  let salesMultiplier = budgetRatio;
  if (budgetRatio > 1) {
    const increaseRatio = budgetRatio - 1;
    salesMultiplier = 1 + increaseRatio * 0.8;
    spendMultiplier = budgetRatio;
  } else if (budgetRatio < 1) {
    const decreaseRatio = 1 - budgetRatio;
    salesMultiplier = 1 - decreaseRatio * 0.9;
    spendMultiplier = budgetRatio;
  }
  const predictedSpend = performance.spend * spendMultiplier;
  const predictedSales = performance.sales * salesMultiplier;
  const predictedRoas = predictedSales / Math.max(predictedSpend, 0.01);
  const predictedAcos = predictedSpend / Math.max(predictedSales, 0.01) * 100;
  return {
    spend: Math.round(predictedSpend * 100) / 100,
    sales: Math.round(predictedSales * 100) / 100,
    roas: Math.round(predictedRoas * 100) / 100,
    acos: Math.round(predictedAcos * 10) / 10
  };
}
async function generateBudgetAllocation(userId, accountId, totalBudget, options = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const {
    prioritizeHighRoas = true,
    minCampaignBudget = 10,
    maxCampaignBudget = totalBudget * 0.3,
    targetRoas,
    targetAcos
  } = options;
  const campaignQuery = accountId ? and(eq(campaigns.accountId, accountId), eq(campaigns.campaignStatus, "enabled")) : eq(campaigns.campaignStatus, "enabled");
  const campaignList = await db.select().from(campaigns).where(campaignQuery);
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
        predictedAcos: 0
      }
    };
  }
  const performances = campaignList.map((campaign) => {
    const spend = Number(campaign.spend) || 0;
    const sales = Number(campaign.sales) || 0;
    const orders = Number(campaign.orders) || 0;
    const clicks = Number(campaign.clicks) || 0;
    const impressions = Number(campaign.impressions) || 0;
    return {
      // @ts-ignore
      campaignId: campaign.campaignId,
      // @ts-ignore
      campaignName: campaign.campaignName,
      // @ts-ignore
      campaignType: campaign.campaignType,
      // @ts-ignore
      currentBudget: Number(campaign.dailyBudget) || 0,
      spend,
      sales,
      orders,
      clicks,
      impressions,
      roas: spend > 0 ? sales / spend : 0,
      // @ts-ignore
      acos: sales > 0 ? spend / sales * 100 : 100,
      // @ts-ignore
      ctr: impressions > 0 ? clicks / impressions * 100 : 0,
      cvr: clicks > 0 ? orders / clicks * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0
    };
  });
  const scoredPerformances = performances.map((p) => ({
    // @ts-ignore
    ...p,
    // @ts-ignore
    priorityScore: calculatePriorityScore2(p)
  }));
  scoredPerformances.sort((a, b) => b.priorityScore - a.priorityScore);
  const currentTotalBudget = scoredPerformances.reduce(
    (sum2, p) => sum2 + p.currentBudget,
    0
  );
  const recommendations = [];
  let remainingBudget = totalBudget;
  let allocatedBudget = 0;
  const highPriorityCampaigns = scoredPerformances.filter(
    (p) => p.priorityScore >= 60
  );
  const mediumPriorityCampaigns = scoredPerformances.filter(
    (p) => p.priorityScore >= 40 && p.priorityScore < 60
  );
  const lowPriorityCampaigns = scoredPerformances.filter(
    (p) => p.priorityScore < 40
  );
  const highPriorityRatio = 0.6;
  const mediumPriorityRatio = 0.3;
  const lowPriorityRatio = 0.1;
  const highPriorityBudget = totalBudget * highPriorityRatio;
  const mediumPriorityBudget = totalBudget * mediumPriorityRatio;
  const lowPriorityBudget = totalBudget * lowPriorityRatio;
  const allocateToCampaigns = /* @__PURE__ */ __name((campaignList2, availableBudget) => {
    if (campaignList2.length === 0) return [];
    const totalScore = campaignList2.reduce((sum2, c) => sum2 + c.priorityScore, 0);
    const results = [];
    for (const campaign of campaignList2) {
      const scoreRatio = campaign.priorityScore / Math.max(totalScore, 1);
      let recommendedBudget = availableBudget * scoreRatio;
      recommendedBudget = Math.max(recommendedBudget, minCampaignBudget);
      recommendedBudget = Math.min(recommendedBudget, maxCampaignBudget);
      recommendedBudget = Math.round(recommendedBudget * 100) / 100;
      const budgetChange = recommendedBudget - campaign.currentBudget;
      const changePercent = (
        // @ts-ignore
        campaign.currentBudget > 0 ? budgetChange / campaign.currentBudget * 100 : 100
      );
      const { reason, detail } = determineAllocationReason(
        // @ts-ignore
        campaign,
        // @ts-ignore
        budgetChange,
        // @ts-ignore
        campaign.priorityScore
        // @ts-ignore
      );
      const predicted = predictMetrics(campaign, recommendedBudget);
      results.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        // @ts-ignore
        currentBudget: campaign.currentBudget,
        recommendedBudget,
        budgetChange: Math.round(budgetChange * 100) / 100,
        changePercent: Math.round(changePercent * 10) / 10,
        // @ts-ignore
        priorityScore: campaign.priorityScore,
        allocationReason: reason,
        reasonDetail: detail,
        historicalMetrics: {
          // @ts-ignore
          roas: campaign.roas,
          // @ts-ignore
          acos: campaign.acos,
          // @ts-ignore
          ctr: campaign.ctr,
          // @ts-ignore
          cvr: campaign.cvr,
          // @ts-ignore
          spend: campaign.spend,
          // @ts-ignore
          sales: campaign.sales
        },
        // @ts-ignore
        predictedMetrics: predicted
        // @ts-ignore
      });
    }
    return results;
  }, "allocateToCampaigns");
  const highResults = allocateToCampaigns(highPriorityCampaigns, highPriorityBudget);
  const mediumResults = allocateToCampaigns(
    mediumPriorityCampaigns,
    mediumPriorityBudget
  );
  const lowResults = allocateToCampaigns(lowPriorityCampaigns, lowPriorityBudget);
  recommendations.push(...highResults, ...mediumResults, ...lowResults);
  allocatedBudget = recommendations.reduce(
    (sum2, r) => sum2 + r.recommendedBudget,
    0
  );
  const increasedCount = recommendations.filter((r) => r.budgetChange > 0).length;
  const decreasedCount = recommendations.filter((r) => r.budgetChange < 0).length;
  const unchangedCount = recommendations.filter(
    (r) => Math.abs(r.budgetChange) < 1
    // @ts-ignore
  ).length;
  const totalIncrease = recommendations.filter((r) => r.budgetChange > 0).reduce((sum2, r) => sum2 + r.budgetChange, 0);
  const totalDecrease = Math.abs(
    // @ts-ignore
    recommendations.filter((r) => r.budgetChange < 0).reduce((sum2, r) => sum2 + r.budgetChange, 0)
  );
  const predictedSales = recommendations.reduce(
    (sum2, r) => sum2 + r.predictedMetrics.sales,
    0
  );
  const predictedSpend = recommendations.reduce(
    (sum2, r) => sum2 + r.predictedMetrics.spend,
    0
    // @ts-ignore
  );
  const predictedRoas = predictedSpend > 0 ? predictedSales / predictedSpend : 0;
  const predictedAcos = predictedSales > 0 ? predictedSpend / predictedSales * 100 : 0;
  return {
    totalBudget,
    allocatedBudget: Math.round(allocatedBudget * 100) / 100,
    campaignCount: recommendations.length,
    recommendations,
    summary: {
      increasedCount,
      decreasedCount,
      unchangedCount,
      // @ts-ignore
      totalIncrease: Math.round(totalIncrease * 100) / 100,
      totalDecrease: Math.round(totalDecrease * 100) / 100,
      predictedSales: Math.round(predictedSales * 100) / 100,
      predictedRoas: Math.round(predictedRoas * 100) / 100,
      predictedAcos: Math.round(predictedAcos * 10) / 10
    }
  };
}
async function saveBudgetAllocation(userId, accountId, goalId, allocationName, description, result) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
    confidenceScore: "75.00",
    // 默认置信度
    status: "draft"
  });
  const allocationId = allocation.insertId;
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
      allocationReason: rec.allocationReason,
      reasonDetail: rec.reasonDetail,
      priorityScore: rec.priorityScore.toString(),
      status: "pending"
    });
  }
  return Number(allocationId);
}
async function applyBudgetAllocation(allocationId, userId) {
  const db = await getDb();
  if (!db) return { success: false, appliedCount: 0, errors: ["Database not available"] };
  const [allocation] = await db.select().from(budgetAllocations).where(eq(budgetAllocations.id, allocationId));
  if (!allocation) {
    return { success: false, appliedCount: 0, errors: ["\u5206\u914D\u65B9\u6848\u4E0D\u5B58\u5728"] };
  }
  if (allocation.status === "applied") {
    return { success: false, appliedCount: 0, errors: ["\u8BE5\u65B9\u6848\u5DF2\u5E94\u7528"] };
  }
  const items = await db.select().from(budgetAllocationItems).where(eq(budgetAllocationItems.allocationId, allocationId));
  const errors = [];
  let appliedCount = 0;
  for (const item of items) {
    try {
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, Number(item.campaignId)));
      if (!campaign) {
        errors.push(`\u5E7F\u544A\u6D3B\u52A8 ${item.campaignId} \u4E0D\u5B58\u5728`);
        continue;
      }
      const previousBudget = Number(campaign.maxBid) || 0;
      const newBudget = Number(item.recommendedBudget);
      await db.update(campaigns).set({ maxBid: newBudget.toString() }).where(eq(campaigns.id, Number(item.campaignId)));
      await db.insert(budgetHistory).values({
        userId,
        accountId: allocation.accountId,
        campaignId: item.campaignId,
        allocationId,
        previousBudget: previousBudget.toString(),
        newBudget: newBudget.toString(),
        changeAmount: (newBudget - previousBudget).toString(),
        changePercent: previousBudget > 0 ? ((newBudget - previousBudget) / previousBudget * 100).toString() : "100",
        source: "auto_allocation",
        reason: item.reasonDetail,
        snapshotRoas: item.historicalRoas,
        snapshotAcos: item.historicalAcos,
        snapshotSpend: item.historicalSpend,
        snapshotSales: item.historicalSales
      });
      await db.update(budgetAllocationItems).set({ status: "applied", appliedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq(budgetAllocationItems.id, item.id));
      appliedCount++;
    } catch (error48) {
      errors.push(`\u5E94\u7528\u5E7F\u544A\u6D3B\u52A8 ${item.campaignId} \u9884\u7B97\u5931\u8D25: ${error48}`);
    }
  }
  await db.update(budgetAllocations).set({
    status: "applied",
    appliedAt: (/* @__PURE__ */ new Date()).toISOString(),
    appliedBy: userId
  }).where(eq(budgetAllocations.id, allocationId));
  return {
    success: errors.length === 0,
    appliedCount,
    errors
  };
}
async function getBudgetAllocationHistory(userId, accountId, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  const query = accountId ? and(
    eq(budgetAllocations.userId, userId),
    eq(budgetAllocations.accountId, accountId)
  ) : eq(budgetAllocations.userId, userId);
  const allocations = await db.select().from(budgetAllocations).where(query).orderBy(desc(budgetAllocations.createdAt)).limit(limit);
  return allocations;
}
async function getBudgetHistory(userId, options = {}) {
  const db = await getDb();
  if (!db) return [];
  const { accountId, campaignId, startDate, endDate, limit = 50 } = options;
  let query = eq(budgetHistory.userId, userId);
  if (accountId) {
    query = and(query, eq(budgetHistory.accountId, accountId));
  }
  if (campaignId) {
    query = and(query, eq(budgetHistory.campaignId, String(campaignId)));
  }
  if (startDate) {
    query = and(query, gte(budgetHistory.createdAt, startDate.toISOString()));
  }
  if (endDate) {
    query = and(query, lte(budgetHistory.createdAt, endDate.toISOString()));
  }
  const history = await db.select().from(budgetHistory).where(query).orderBy(desc(budgetHistory.createdAt)).limit(limit);
  return history;
}
async function createBudgetGoal(userId, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(budgetGoals).values({
    // @ts-expect-error - runtime type mismatch
    userId,
    accountId: data.accountId,
    goalType: data.goalType,
    targetValue: data.targetValue.toString(),
    periodType: data.periodType || "monthly",
    startDate: data.startDate?.toISOString(),
    endDate: data.endDate?.toISOString(),
    totalBudget: data.totalBudget?.toString(),
    minCampaignBudget: data.minCampaignBudget?.toString() || "10.00",
    maxCampaignBudget: data.maxCampaignBudget?.toString(),
    prioritizeHighRoas: data.prioritizeHighRoas ? 1 : 0,
    prioritizeNewProducts: data.prioritizeNewProducts ? 1 : 0,
    status: "active"
  });
  return Number(result.insertId);
}
async function getBudgetGoals(userId, accountId) {
  const db = await getDb();
  if (!db) return [];
  const query = accountId ? and(eq(budgetGoals.userId, userId), eq(budgetGoals.accountId, accountId)) : eq(budgetGoals.userId, userId);
  const goals = await db.select().from(budgetGoals).where(query).orderBy(desc(budgetGoals.createdAt));
  return goals;
}
async function updateBudgetGoal(goalId, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData = {};
  if (data.targetValue !== void 0) {
    updateData.targetValue = data.targetValue.toString();
  }
  if (data.totalBudget !== void 0) {
    updateData.totalBudget = data.totalBudget.toString();
  }
  if (data.status !== void 0) {
    updateData.status = data.status;
  }
  await db.update(budgetGoals).set(updateData).where(eq(budgetGoals.id, goalId));
}
async function deleteBudgetGoal(goalId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(budgetGoals).where(eq(budgetGoals.id, goalId));
}
var init_budgetAllocationService = __esm({
  "server/budget/budgetAllocationService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    __name(calculatePriorityScore2, "calculatePriorityScore");
    __name(determineAllocationReason, "determineAllocationReason");
    __name(predictMetrics, "predictMetrics");
    __name(generateBudgetAllocation, "generateBudgetAllocation");
    __name(saveBudgetAllocation, "saveBudgetAllocation");
    __name(applyBudgetAllocation, "applyBudgetAllocation");
    __name(getBudgetAllocationHistory, "getBudgetAllocationHistory");
    __name(getBudgetHistory, "getBudgetHistory");
    __name(createBudgetGoal, "createBudgetGoal");
    __name(getBudgetGoals, "getBudgetGoals");
    __name(updateBudgetGoal, "updateBudgetGoal");
    __name(deleteBudgetGoal, "deleteBudgetGoal");
  }
});

