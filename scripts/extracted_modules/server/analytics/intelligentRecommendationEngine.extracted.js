// Extracted from production dist/index.js
// Original module: server/analytics/intelligentRecommendationEngine.ts
// Lines: 437

function calculateHealthScore2(campaign) {
  let score = 0;
  const reasons = [];
  if (campaign.recent7dSpend > 0 && campaign.recent7dSales > 0) {
    const currentAcos = campaign.recent7dAcos;
    const prevAcos = campaign.prev7dAcos;
    if (prevAcos > 0 && currentAcos > prevAcos) {
      const acosIncrease = (currentAcos - prevAcos) / prevAcos * 100;
      if (acosIncrease > 100) {
        score -= 40;
        reasons.push(`ACoS\u98D9\u5347${acosIncrease.toFixed(0)}%\uFF08${prevAcos.toFixed(1)}%\u2192${currentAcos.toFixed(1)}%\uFF09`);
      } else if (acosIncrease > 50) {
        score -= 25;
        reasons.push(`ACoS\u5927\u5E45\u4E0A\u5347${acosIncrease.toFixed(0)}%`);
      } else if (acosIncrease > 20) {
        score -= 15;
        reasons.push(`ACoS\u4E0A\u5347${acosIncrease.toFixed(0)}%`);
      }
    }
    if (currentAcos > 80) {
      score -= 30;
      reasons.push(`ACoS\u6781\u9AD8(${currentAcos.toFixed(1)}%)`);
    } else if (currentAcos > 50) {
      score -= 15;
      reasons.push(`ACoS\u504F\u9AD8(${currentAcos.toFixed(1)}%)`);
    }
  }
  if (campaign.prev7dSpend > 0) {
    const spendChange = (campaign.recent7dSpend - campaign.prev7dSpend) / campaign.prev7dSpend * 100;
    if (spendChange > 100) {
      score -= 20;
      reasons.push(`\u82B1\u8D39\u6FC0\u589E${spendChange.toFixed(0)}%`);
    } else if (spendChange > 50) {
      score -= 10;
      reasons.push(`\u82B1\u8D39\u5927\u5E45\u589E\u52A0${spendChange.toFixed(0)}%`);
    }
  }
  if (campaign.prev7dSales > 0) {
    const salesChange = (campaign.recent7dSales - campaign.prev7dSales) / campaign.prev7dSales * 100;
    if (salesChange < -50) {
      score -= 25;
      reasons.push(`\u9500\u552E\u989D\u66B4\u8DCC${Math.abs(salesChange).toFixed(0)}%`);
    } else if (salesChange < -20) {
      score -= 15;
      reasons.push(`\u9500\u552E\u989D\u4E0B\u964D${Math.abs(salesChange).toFixed(0)}%`);
    }
  }
  if (campaign.recent7dSpend > 5 && campaign.recent7dOrders === 0) {
    score -= 30;
    reasons.push(`\u82B1\u8D39$${campaign.recent7dSpend.toFixed(0)}\u4F46\u96F6\u8F6C\u5316`);
  }
  if (campaign.recent7dImpressions > 1e3 && campaign.recent7dClicks > 0) {
    const ctr = campaign.recent7dClicks / campaign.recent7dImpressions * 100;
    if (ctr < 0.1) {
      score -= 10;
      reasons.push(`\u70B9\u51FB\u7387\u6781\u4F4E(${ctr.toFixed(2)}%)`);
    }
  }
  campaign.healthScore = score;
  campaign.deteriorationReasons = reasons;
  return score;
}
function matchStrategy(campaignList) {
  if (campaignList.length === 0) return null;
  const totalSpend = campaignList.reduce((sum2, c) => sum2 + c.recent7dSpend, 0);
  const totalSales = campaignList.reduce((sum2, c) => sum2 + c.recent7dSales, 0);
  const avgAcos = totalSales > 0 ? totalSpend / totalSales * 100 : 999;
  const zeroCvCampaigns = campaignList.filter((c) => c.recent7dSpend > 5 && c.recent7dOrders === 0);
  if (zeroCvCampaigns.length > campaignList.length * 0.5) {
    return STRATEGY_TEMPLATES.find((t2) => t2.id === "emergency-response") || STRATEGY_TEMPLATES[0];
  }
  if (avgAcos > 80) return STRATEGY_TEMPLATES.find((t2) => t2.id === "decline-management") || STRATEGY_TEMPLATES[2];
  if (avgAcos > 40) return STRATEGY_TEMPLATES.find((t2) => t2.id === "profit-focused") || STRATEGY_TEMPLATES[2];
  if (avgAcos > 25) return STRATEGY_TEMPLATES.find((t2) => t2.id === "balanced") || STRATEGY_TEMPLATES[1];
  return STRATEGY_TEMPLATES.find((t2) => t2.id === "aggressive-growth") || STRATEGY_TEMPLATES[0];
}
async function executeAutoOptimizationForTarget(targetId, targetName, deterioratingCampaigns) {
  const actions = [];
  try {
    const optimizationTargetEngine = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
    const maxSeverity = Math.min(...deterioratingCampaigns.map((c) => c.healthScore));
    let specificModules;
    if (maxSeverity <= -40) {
      specificModules = ["bid", "searchterm", "keyword", "budget", "placement", "dayparting"];
    } else if (maxSeverity <= -25) {
      specificModules = ["bid", "searchterm", "keyword", "budget"];
    } else {
      specificModules = ["bid", "searchterm"];
    }
    log195.info(`[\u667A\u80FD\u63A8\u8350] \u5BF9\u4F18\u5316\u76EE\u6807\u300C${targetName}\u300D(#${targetId})\u6267\u884C\u8865\u5145\u4F18\u5316\uFF0C\u6A21\u5757: ${specificModules.join(", ")}, \u6076\u5316\u4E25\u91CD\u5EA6: ${maxSeverity}`);
    const result = await optimizationTargetEngine.executeOptimizationTarget(targetId, {
      dryRun: false,
      forceExecution: true,
      specificModules
    });
    if (result.bidOptimization.executed) {
      actions.push({
        type: "bid_adjustment",
        description: "\u7ADE\u4EF7\u8C03\u6574",
        count: result.bidOptimization.adjustmentsCount,
        status: result.bidOptimization.adjustmentsCount > 0 ? "executed" : "skipped",
        details: result.bidOptimization.adjustmentsCount > 0 ? `\u5DF2\u5BF9${result.bidOptimization.adjustmentsCount}\u4E2A\u6295\u653E\u8BCD\u8FDB\u884C\u7ADE\u4EF7\u8C03\u6574` : "\u5F53\u524D\u7ADE\u4EF7\u5728\u5408\u7406\u8303\u56F4\u5185\uFF0C\u65E0\u9700\u8C03\u6574"
      });
    }
    if (result.placementOptimization.executed) {
      actions.push({
        type: "placement_tilt",
        description: "\u4F4D\u7F6E\u503E\u659C\u4F18\u5316",
        count: result.placementOptimization.adjustmentsCount,
        status: result.placementOptimization.adjustmentsCount > 0 ? "executed" : "skipped",
        details: result.placementOptimization.adjustmentsCount > 0 ? `\u5DF2\u8C03\u6574${result.placementOptimization.adjustmentsCount}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u7684\u4F4D\u7F6E\u503E\u659C\u6BD4\u4F8B` : "\u4F4D\u7F6E\u503E\u659C\u6BD4\u4F8B\u65E0\u9700\u8C03\u6574"
      });
    }
    if (result.daypartingOptimization.executed) {
      actions.push({
        type: "dayparting",
        description: "\u5206\u65F6\u7B56\u7565\u4F18\u5316",
        count: result.daypartingOptimization.adjustmentsCount,
        status: result.daypartingOptimization.adjustmentsCount > 0 ? "executed" : "skipped",
        details: result.daypartingOptimization.adjustmentsCount > 0 ? `\u5DF2\u8C03\u6574${result.daypartingOptimization.adjustmentsCount}\u4E2A\u65F6\u6BB5\u7684\u7ADE\u4EF7/\u9884\u7B97` : "\u5206\u65F6\u7B56\u7565\u65E0\u9700\u8C03\u6574"
      });
    }
    if (result.searchTermAnalysis.executed) {
      const negCount = result.searchTermAnalysis.negativeKeywordsAdded;
      const newCount = result.searchTermAnalysis.newKeywordsAdded;
      if (negCount > 0 || newCount > 0) {
        actions.push({
          type: "negative_keyword",
          description: "\u641C\u7D22\u8BCD\u4F18\u5316",
          count: negCount + newCount,
          status: "executed",
          details: `\u5426\u5B9A${negCount}\u4E2A\u4F4E\u6548\u641C\u7D22\u8BCD\uFF0C\u8FC1\u79FB${newCount}\u4E2A\u9AD8\u6548\u641C\u7D22\u8BCD`
        });
      }
    }
    if (result.budgetAllocation.executed) {
      actions.push({
        type: "budget_allocation",
        description: "\u9884\u7B97\u5206\u914D\u4F18\u5316",
        count: result.budgetAllocation.adjustmentsCount,
        status: result.budgetAllocation.adjustmentsCount > 0 ? "executed" : "skipped",
        details: result.budgetAllocation.adjustmentsCount > 0 ? `\u5DF2\u8C03\u6574${result.budgetAllocation.adjustmentsCount}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u7684\u9884\u7B97\u5206\u914D` : "\u9884\u7B97\u5206\u914D\u65E0\u9700\u8C03\u6574"
      });
    }
    if (result.keywordStatusChanges.executed) {
      const paused = result.keywordStatusChanges.pausedCount;
      const enabled = result.keywordStatusChanges.enabledCount;
      if (paused > 0 || enabled > 0) {
        actions.push({
          type: "keyword_status",
          description: "\u5173\u952E\u8BCD\u72B6\u6001\u8C03\u6574",
          count: paused + enabled,
          status: "executed",
          details: `\u6682\u505C${paused}\u4E2A\u4F4E\u6548\u5173\u952E\u8BCD\uFF0C\u542F\u7528${enabled}\u4E2A\u6F5C\u529B\u5173\u952E\u8BCD`
        });
      }
    }
    const executedActions = actions.filter((a) => a.status === "executed");
    const totalAdjustments = executedActions.reduce((sum2, a) => sum2 + a.count, 0);
    const summary = totalAdjustments > 0 ? `\u7CFB\u7EDF\u5DF2\u81EA\u52A8\u6267\u884C${executedActions.length}\u7C7B\u4F18\u5316\u52A8\u4F5C\uFF0C\u5171${totalAdjustments}\u9879\u8C03\u6574` : "\u7CFB\u7EDF\u5DF2\u5B8C\u6210\u5206\u6790\uFF0C\u5F53\u524D\u4F18\u5316\u7B56\u7565\u4ECD\u5728\u6267\u884C\u4E2D\uFF0C\u6682\u65E0\u9700\u989D\u5916\u8C03\u6574";
    return { status: result.status, actions, summary };
  } catch (error48) {
    log195.warn(`[\u667A\u80FD\u63A8\u8350] \u5BF9\u4F18\u5316\u76EE\u6807\u300C${targetName}\u300D\u6267\u884C\u81EA\u52A8\u4F18\u5316\u5931\u8D25: ${error48?.message || String(error48)}`);
    return {
      status: "error",
      actions: [{
        type: "bid_adjustment",
        description: "\u81EA\u52A8\u4F18\u5316\u6267\u884C",
        count: 0,
        status: "skipped",
        details: `\u6267\u884C\u5931\u8D25: ${error48.message}`
      }],
      summary: `\u81EA\u52A8\u4F18\u5316\u6267\u884C\u9047\u5230\u95EE\u9898: ${error48.message}`
    };
  }
}
async function scanAccountHealth(accountId) {
  const db = await getDb();
  if (!db) {
    return {
      accountId,
      scanTime: (/* @__PURE__ */ new Date()).toISOString(),
      totalCampaignsScanned: 0,
      activeCampaignsScanned: 0,
      deterioratingCampaigns: 0,
      unmanagedDeteriorating: 0,
      managedDeteriorating: 0,
      totalPotentialSavings: 0,
      autoOptimizationTriggered: false,
      autoOptimizationResults: [],
      recommendations: []
    };
  }
  const allCampaigns = await db.select({
    id: campaigns.id,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    campaignType: campaigns.campaignType,
    campaignStatus: campaigns.campaignStatus,
    performanceGroupId: campaigns.performanceGroupId
  }).from(campaigns).where(and(
    eq(campaigns.accountId, accountId),
    eq(campaigns.campaignStatus, "enabled")
  ));
  const totalCampaigns = allCampaigns.length;
  if (totalCampaigns === 0) {
    return {
      accountId,
      scanTime: (/* @__PURE__ */ new Date()).toISOString(),
      totalCampaignsScanned: 0,
      activeCampaignsScanned: 0,
      deterioratingCampaigns: 0,
      unmanagedDeteriorating: 0,
      managedDeteriorating: 0,
      totalPotentialSavings: 0,
      autoOptimizationTriggered: false,
      autoOptimizationResults: [],
      recommendations: []
    };
  }
  const pgIds = [...new Set(allCampaigns.filter((c) => c.performanceGroupId).map((c) => c.performanceGroupId))];
  const pgMap = /* @__PURE__ */ new Map();
  if (pgIds.length > 0) {
    const pgs = await db.select({ id: performanceGroups.id, name: performanceGroups.name }).from(performanceGroups).where(sql`${performanceGroups.id} IN (${sql.join(pgIds.map((id) => sql`${id}`), sql`, `)})`);
    pgs.forEach((pg) => pgMap.set(pg.id, pg.name));
  }
  const now = /* @__PURE__ */ new Date();
  const recent7dEnd = new Date(now);
  recent7dEnd.setDate(recent7dEnd.getDate() - 1);
  const recent7dStart = new Date(recent7dEnd);
  recent7dStart.setDate(recent7dStart.getDate() - 6);
  const prev7dEnd = new Date(recent7dStart);
  prev7dEnd.setDate(prev7dEnd.getDate() - 1);
  const prev7dStart = new Date(prev7dEnd);
  prev7dStart.setDate(prev7dStart.getDate() - 6);
  const fmt = /* @__PURE__ */ __name((d) => d.toISOString().split("T")[0], "fmt");
  const recent7dPerf = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`DATE(${dailyPerformance.date}) >= ${fmt(recent7dStart)}`,
    sql`DATE(${dailyPerformance.date}) <= ${fmt(recent7dEnd)}`
  )).groupBy(dailyPerformance.campaignId);
  const prev7dPerf = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`DATE(${dailyPerformance.date}) >= ${fmt(prev7dStart)}`,
    sql`DATE(${dailyPerformance.date}) <= ${fmt(prev7dEnd)}`
  )).groupBy(dailyPerformance.campaignId);
  const recentMap = /* @__PURE__ */ new Map();
  recent7dPerf.forEach((p) => {
    if (p.campaignId) recentMap.set(p.campaignId, p);
  });
  const prevMap = /* @__PURE__ */ new Map();
  prev7dPerf.forEach((p) => {
    if (p.campaignId) prevMap.set(p.campaignId, p);
  });
  const healthDataList = allCampaigns.map((c) => {
    const recent = recentMap.get(c.campaignId);
    const prev = prevMap.get(c.campaignId);
    const rSpend = parseFloat(recent?.totalSpend || "0");
    const rSales = parseFloat(recent?.totalSales || "0");
    const pSpend = parseFloat(prev?.totalSpend || "0");
    const pSales = parseFloat(prev?.totalSales || "0");
    const data = {
      campaignDbId: c.id,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      campaignType: c.campaignType,
      campaignStatus: c.campaignStatus || "enabled",
      performanceGroupId: c.performanceGroupId,
      performanceGroupName: c.performanceGroupId ? pgMap.get(c.performanceGroupId) || null : null,
      recent7dSpend: rSpend,
      recent7dSales: rSales,
      recent7dAcos: rSales > 0 ? rSpend / rSales * 100 : rSpend > 0 ? 999 : 0,
      recent7dImpressions: recent?.totalImpressions || 0,
      recent7dClicks: recent?.totalClicks || 0,
      recent7dOrders: recent?.totalOrders || 0,
      prev7dSpend: pSpend,
      prev7dSales: pSales,
      prev7dAcos: pSales > 0 ? pSpend / pSales * 100 : pSpend > 0 ? 999 : 0,
      prev7dImpressions: prev?.totalImpressions || 0,
      prev7dClicks: prev?.totalClicks || 0,
      prev7dOrders: prev?.totalOrders || 0,
      healthScore: 0,
      deteriorationReasons: []
    };
    calculateHealthScore2(data);
    return data;
  });
  const deteriorating = healthDataList.filter((c) => c.healthScore <= -15);
  const unmanagedDet = deteriorating.filter((c) => !c.performanceGroupId);
  const managedDet = deteriorating.filter((c) => !!c.performanceGroupId);
  const recommendations = [];
  const autoOptResults = [];
  let autoOptTriggered = false;
  if (managedDet.length > 0) {
    const byGroup = /* @__PURE__ */ new Map();
    managedDet.forEach((c) => {
      const gid = c.performanceGroupId;
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push(c);
    });
    for (const [groupId, groupCampaigns] of byGroup) {
      const groupName = groupCampaigns[0].performanceGroupName || `\u4F18\u5316\u76EE\u6807#${groupId}`;
      const autoOptResult = await executeAutoOptimizationForTarget(groupId, groupName, groupCampaigns);
      autoOptTriggered = true;
      autoOptResults.push({
        targetId: groupId,
        targetName: groupName,
        // @ts-ignore
        status: autoOptResult.status,
        // @ts-ignore
        actions: autoOptResult.actions
      });
      const totalWasted = groupCampaigns.reduce((sum2, c) => {
        if (c.recent7dAcos > 30 && c.recent7dSales > 0) return sum2 + Math.max(0, c.recent7dSpend - c.recent7dSales * 0.3);
        return sum2 + (c.recent7dOrders === 0 ? c.recent7dSpend : 0);
      }, 0);
      const executedActions = autoOptResult.actions.filter((a) => a.status === "executed");
      recommendations.push({
        id: `managed-${groupId}-${Date.now()}`,
        // @ts-ignore
        priority: groupCampaigns.some((c) => c.healthScore <= -40) ? "high" : "medium",
        // @ts-ignore
        type: "managed_deteriorating",
        title: `\u300C${groupName}\u300D\u4E2D${groupCampaigns.length}\u4E2A\u5E7F\u544A\u6076\u5316\uFF0C\u7CFB\u7EDF\u5DF2\u81EA\u52A8\u6267\u884C\u8865\u5145\u4F18\u5316`,
        description: autoOptResult.summary,
        campaigns: groupCampaigns.slice(0, 10),
        suggestedStrategy: null,
        estimatedImpact: {
          // @ts-ignore
          potentialSavings: Math.round(totalWasted * 100) / 100,
          // @ts-ignore
          acosReduction: `\u9884\u8BA1\u53EF\u964D${Math.min(50, Math.round(totalWasted / (groupCampaigns.reduce((s, c) => s + c.recent7dSpend, 0) || 1) * 100))}%`,
          description: autoOptResult.summary
        },
        autoOptimizationActions: autoOptResult.actions,
        autoOptimizationSummary: autoOptResult.summary,
        action: {
          type: "auto_optimized",
          // @ts-ignore
          label: executedActions.length > 0 ? `\u5DF2\u81EA\u52A8\u6267\u884C${executedActions.length}\u7C7B\u4F18\u5316` : "\u5206\u6790\u5B8C\u6210\uFF0C\u6301\u7EED\u76D1\u63A7\u4E2D",
          goalId: groupId
        }
        // @ts-ignore
      });
    }
  }
  if (unmanagedDet.length > 0) {
    unmanagedDet.sort((a, b) => a.healthScore - b.healthScore);
    const strategy = matchStrategy(unmanagedDet);
    const totalWasted = unmanagedDet.reduce((sum2, c) => {
      if (c.recent7dAcos > 30 && c.recent7dSales > 0) return sum2 + Math.max(0, c.recent7dSpend - c.recent7dSales * 0.3);
      return sum2 + (c.recent7dOrders === 0 ? c.recent7dSpend : 0);
    }, 0);
    recommendations.push({
      id: `unmanaged-${accountId}-${Date.now()}`,
      priority: unmanagedDet.some((c) => c.healthScore <= -40) ? "critical" : "high",
      type: "unmanaged_deteriorating",
      title: `${unmanagedDet.length}\u4E2A\u672A\u7EB3\u7BA1\u5E7F\u544A\u6D3B\u52A8\u8868\u73B0\u6076\u5316\uFF0C\u5EFA\u8BAE\u4F7F\u7528\u300C${strategy?.name || "\u5E73\u8861\u589E\u957F"}\u300D\u7B56\u7565\u7ACB\u5373\u4F18\u5316`,
      description: `\u53D1\u73B0${unmanagedDet.length}\u4E2A\u672A\u7EB3\u5165\u4EFB\u4F55\u4F18\u5316\u76EE\u6807\u7684\u6D3B\u8DC3\u5E7F\u544A\u6D3B\u52A8\u8FD17\u5929\u8868\u73B0\u660E\u663E\u6076\u5316\u3002\u4E00\u952E\u521B\u5EFA\u4F18\u5316\u76EE\u6807\u540E\uFF0C\u7CFB\u7EDF\u5C06\u7ACB\u5373\u6267\u884C\u7ADE\u4EF7\u8C03\u6574\u3001\u641C\u7D22\u8BCD\u4F18\u5316\u3001\u9884\u7B97\u5206\u914D\u7B49\u5168\u5957\u81EA\u52A8\u4F18\u5316\u3002`,
      campaigns: unmanagedDet.slice(0, 10),
      suggestedStrategy: strategy ? { id: strategy.id, name: strategy.name, description: strategy.description, targetAcos: strategy.targetAcos } : null,
      estimatedImpact: {
        // @ts-ignore
        potentialSavings: Math.round(totalWasted * 100) / 100,
        acosReduction: strategy ? `ACoS\u76EE\u6807\u964D\u81F3${strategy.targetAcos}%` : "ACoS\u76EE\u6807\u964D\u81F330%",
        // @ts-ignore
        description: `\u521B\u5EFA\u4F18\u5316\u76EE\u6807\u540E\uFF0C\u7CFB\u7EDF\u5C06\u7ACB\u5373\u542F\u52A8\u81EA\u52A8\u4F18\u5316\uFF0C\u9884\u8BA1\u6BCF\u5468\u53EF\u8282\u7701$${totalWasted.toFixed(0)}\u5E7F\u544A\u82B1\u8D39\u3002`
      },
      autoOptimizationActions: [],
      autoOptimizationSummary: "\u521B\u5EFA\u4F18\u5316\u76EE\u6807\u540E\u5C06\u7ACB\u5373\u89E6\u53D1\u9996\u6B21\u5168\u5957\u81EA\u52A8\u4F18\u5316",
      action: {
        type: "create_goal",
        label: "\u4E00\u952E\u521B\u5EFA\u4F18\u5316\u76EE\u6807\u5E76\u7ACB\u5373\u4F18\u5316",
        prefillData: {
          name: `\u667A\u80FD\u63A8\u8350-${strategy?.name || "\u5E73\u8861\u589E\u957F"}-${(/* @__PURE__ */ new Date()).toLocaleDateString("zh-CN")}`,
          description: `\u7531\u667A\u80FD\u63A8\u8350\u7CFB\u7EDF\u81EA\u52A8\u521B\u5EFA\u3002\u5305\u542B${unmanagedDet.length}\u4E2A\u8868\u73B0\u6076\u5316\u7684\u5E7F\u544A\u6D3B\u52A8\uFF0C\u4F7F\u7528\u300C${strategy?.name || "\u5E73\u8861\u589E\u957F"}\u300D\u7B56\u7565\u8FDB\u884C\u81EA\u52A8\u4F18\u5316\u3002`,
          optimizationGoal: "target_acos",
          targetAcos: strategy?.targetAcos || 30,
          targetRoas: strategy ? Math.round(100 / strategy.targetAcos * 100) / 100 : 3.33,
          strategyTemplateId: strategy?.id || "balanced",
          strategyTemplateName: strategy?.name || "\u5E73\u8861\u589E\u957F",
          campaignIds: unmanagedDet.map((c) => c.campaignDbId)
        }
        // @ts-ignore
      }
    });
  }
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  return {
    accountId,
    scanTime: (/* @__PURE__ */ new Date()).toISOString(),
    totalCampaignsScanned: totalCampaigns,
    activeCampaignsScanned: totalCampaigns,
    deterioratingCampaigns: deteriorating.length,
    unmanagedDeteriorating: unmanagedDet.length,
    managedDeteriorating: managedDet.length,
    // @ts-ignore
    totalPotentialSavings: Math.round(recommendations.reduce((s, r) => s + r.estimatedImpact.potentialSavings, 0) * 100) / 100,
    autoOptimizationTriggered: autoOptTriggered,
    autoOptimizationResults: autoOptResults,
    recommendations
  };
}
var log195;
var init_intelligentRecommendationEngine = __esm({
  "server/analytics/intelligentRecommendationEngine.ts"() {
    "use strict";
    init_logger();
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_strategyRecommendationService();
    log195 = createModuleLogger("IntelligentRecommendationEngine");
    __name(calculateHealthScore2, "calculateHealthScore");
    __name(matchStrategy, "matchStrategy");
    __name(executeAutoOptimizationForTarget, "executeAutoOptimizationForTarget");
    __name(scanAccountHealth, "scanAccountHealth");
  }
});

