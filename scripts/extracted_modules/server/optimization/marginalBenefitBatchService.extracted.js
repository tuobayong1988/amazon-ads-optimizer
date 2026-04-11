// Extracted from production dist/index.js
// Original module: server/optimization/marginalBenefitBatchService.ts
// Lines: 526

var marginalBenefitBatchService_exports = {};
__export(marginalBenefitBatchService_exports, {
  applyOptimization: () => applyOptimization,
  batchApplyOptimization: () => batchApplyOptimization,
  createBatchAnalysis: () => createBatchAnalysis,
  executeBatchAnalysis: () => executeBatchAnalysis,
  getApplicationHistory: () => getApplicationHistory,
  getBatchAnalysisDetail: () => getBatchAnalysisDetail,
  getBatchAnalysisHistory: () => getBatchAnalysisHistory,
  rollbackApplication: () => rollbackApplication
});
async function createBatchAnalysis(request) {
  const db = await getDb();
  if (!db) {
    throw new Error("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
  }
  const analysisName = request.analysisName || `\u6279\u91CF\u5206\u6790 ${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")}`;
  const result = await db.execute(sql`
    INSERT INTO batch_marginal_benefit_analysis (
      account_id, user_id, analysis_name, campaign_ids, campaign_count,
      optimization_goal, analysis_status, started_at
    ) VALUES (
      ${request.accountId}, ${request.userId}, ${analysisName},
      ${JSON.stringify(request.campaignIds)}, ${request.campaignIds.length},
      ${request.optimizationGoal}, 'running', NOW()
    )
  `);
  return result[0].insertId;
}
async function executeBatchAnalysis(analysisId, request) {
  const db = await getDb();
  if (!db) {
    throw new Error("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
  }
  const campaignResults = [];
  let totalCurrentSpend = 0;
  let totalCurrentSales = 0;
  let totalExpectedSpend = 0;
  let totalExpectedSales = 0;
  let totalConfidence = 0;
  let successCount = 0;
  const campaigns6 = await db.execute(sql`
    SELECT id, campaignId, campaignName, spend, sales
    FROM campaigns
    WHERE accountId = ${request.accountId}
    AND campaignId IN (${safeStringInClause(request.campaignIds)})
  `);
  const campaignMap = new Map(
    // @ts-expect-error - any type assertion
    campaigns6[0].map((c) => [c.campaignId, c])
  );
  for (const campaignId of request.campaignIds) {
    const campaign = campaignMap.get(campaignId);
    const campaignName = campaign?.campaignName || campaignId;
    const currentSpend = Number(campaign?.spend) || 0;
    const currentSales = Number(campaign?.sales) || 0;
    const currentOrders = Number(campaign?.orders) || 0;
    try {
      const metrics = {
        impressions: 1e4,
        clicks: 500,
        spend: currentSpend,
        sales: currentSales,
        orders: currentOrders,
        ctr: 0.05,
        cvr: currentOrders > 0 ? currentOrders / 500 : 0.02,
        cpc: currentSpend / 500,
        acos: currentSales > 0 ? currentSpend / currentSales * 100 : 30,
        roas: currentSpend > 0 ? currentSales / currentSpend : 3
      };
      const topOfSearch = calculateMarginalBenefitSimple(metrics, 0);
      const productPage = calculateMarginalBenefitSimple(metrics, 0);
      const restOfSearch = calculateMarginalBenefitSimple(metrics, 0);
      const marginalBenefits = {
        top_of_search: topOfSearch,
        product_page: productPage,
        rest_of_search: restOfSearch
      };
      const currentAdjustments = {
        top_of_search: 0,
        product_page: 0,
        rest_of_search: 0
      };
      const optimization = optimizeTrafficAllocationSimple(
        marginalBenefits,
        currentAdjustments,
        request.optimizationGoal
      );
      const confidence = (topOfSearch.confidence + productPage.confidence + restOfSearch.confidence) / 3;
      const placements = ["top_of_search", "product_page", "rest_of_search"];
      const results = [topOfSearch, productPage, restOfSearch];
      for (let i = 0; i < placements.length; i++) {
        await saveMarginalBenefitHistory(
          request.accountId,
          campaignId,
          placements[i],
          {
            currentAdjustment: 0,
            ...results[i],
            dataPoints: 30
          },
          {
            totalImpressions: 0,
            totalClicks: 0,
            totalSpend: currentSpend,
            totalSales: currentSales,
            totalOrders: 0
          }
        );
      }
      campaignResults.push({
        campaignId,
        campaignName,
        currentSpend,
        currentSales,
        currentROAS: currentSpend > 0 ? currentSales / currentSpend : 0,
        currentACoS: currentSales > 0 ? currentSpend / currentSales * 100 : 0,
        marginalBenefits: { topOfSearch, productPage, restOfSearch },
        optimization,
        confidence,
        status: confidence >= 0.3 ? "success" : "insufficient_data"
      });
      totalCurrentSpend += currentSpend;
      totalCurrentSales += currentSales;
      totalExpectedSpend += optimization.expectedSpendChange + currentSpend;
      totalExpectedSales += optimization.expectedSalesIncrease + currentSales;
      totalConfidence += confidence;
      successCount++;
    } catch (error48) {
      campaignResults.push({
        campaignId,
        campaignName,
        currentSpend,
        currentSales,
        currentROAS: currentSpend > 0 ? currentSales / currentSpend : 0,
        currentACoS: currentSales > 0 ? currentSpend / currentSales * 100 : 0,
        marginalBenefits: { topOfSearch: null, productPage: null, restOfSearch: null },
        optimization: null,
        confidence: 0,
        status: "failed",
        error: error48 instanceof Error ? error48.message : "\u5206\u6790\u5931\u8D25"
      });
    }
  }
  const currentROAS = totalCurrentSpend > 0 ? totalCurrentSales / totalCurrentSpend : 0;
  const expectedROAS = totalExpectedSpend > 0 ? totalExpectedSales / totalExpectedSpend : 0;
  const currentACoS = totalCurrentSales > 0 ? totalCurrentSpend / totalCurrentSales * 100 : 0;
  const expectedACoS = totalExpectedSales > 0 ? totalExpectedSpend / totalExpectedSales * 100 : 0;
  const summary = {
    totalCurrentSpend,
    totalCurrentSales,
    totalExpectedSpend,
    totalExpectedSales,
    overallROASChange: expectedROAS - currentROAS,
    overallACoSChange: expectedACoS - currentACoS,
    avgConfidence: successCount > 0 ? totalConfidence / successCount : 0
  };
  const recommendations = generateBatchRecommendations(campaignResults, summary);
  await db.execute(sql`
    UPDATE batch_marginal_benefit_analysis SET
      analysis_status = 'completed',
      total_current_spend = ${summary.totalCurrentSpend},
      total_current_sales = ${summary.totalCurrentSales},
      total_expected_spend = ${summary.totalExpectedSpend},
      total_expected_sales = ${summary.totalExpectedSales},
      overall_roas_change = ${summary.overallROASChange},
      overall_acos_change = ${summary.overallACoSChange},
      avg_confidence = ${summary.avgConfidence},
      analysis_results = ${JSON.stringify(campaignResults)},
      recommendations = ${JSON.stringify(recommendations)},
      completed_at = NOW()
    WHERE id = ${analysisId}
  `);
  return {
    id: analysisId,
    accountId: request.accountId,
    userId: request.userId,
    analysisName: request.analysisName || `\u6279\u91CF\u5206\u6790 ${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")}`,
    campaignCount: request.campaignIds.length,
    optimizationGoal: request.optimizationGoal,
    status: "completed",
    summary,
    campaignResults,
    recommendations
  };
}
function generateBatchRecommendations(results, summary) {
  const recommendations = [];
  const successCount = results.filter((r) => r.status === "success").length;
  const insufficientCount = results.filter((r) => r.status === "insufficient_data").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  if (insufficientCount > 0) {
    recommendations.push(`${insufficientCount}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u6570\u636E\u4E0D\u8DB3\uFF0C\u5EFA\u8BAE\u7B49\u5F85\u66F4\u591A\u6570\u636E\u79EF\u7D2F\u540E\u518D\u8FDB\u884C\u5206\u6790`);
  }
  if (failedCount > 0) {
    recommendations.push(`${failedCount}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u5206\u6790\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6570\u636E\u5B8C\u6574\u6027`);
  }
  if (summary.overallROASChange > 0.1) {
    recommendations.push(`\u5E94\u7528\u4F18\u5316\u5EFA\u8BAE\u540E\uFF0C\u9884\u8BA1\u6574\u4F53ROAS\u53EF\u63D0\u5347${summary.overallROASChange.toFixed(2)}\uFF0C\u5EFA\u8BAE\u6267\u884C\u4F18\u5316`);
  } else if (summary.overallROASChange < -0.1) {
    recommendations.push(`\u5F53\u524D\u4F4D\u7F6E\u503E\u659C\u8BBE\u7F6E\u5DF2\u63A5\u8FD1\u6700\u4F18\uFF0C\u7EE7\u7EED\u4F18\u5316\u53EF\u80FD\u5BFC\u81F4ROAS\u4E0B\u964D`);
  }
  if (summary.overallACoSChange < -2) {
    recommendations.push(`\u9884\u8BA1\u6574\u4F53ACoS\u53EF\u964D\u4F4E${Math.abs(summary.overallACoSChange).toFixed(1)}%\uFF0C\u5E7F\u544A\u6548\u7387\u5C06\u663E\u8457\u63D0\u5347`);
  }
  const highPotential = results.filter((r) => r.optimization && r.optimization.expectedSalesIncrease / (r.currentSales || 1) * 100 > 10).sort((a, b) => {
    const aPercent = a.optimization ? a.optimization.expectedSalesIncrease / (a.currentSales || 1) * 100 : 0;
    const bPercent = b.optimization ? b.optimization.expectedSalesIncrease / (b.currentSales || 1) * 100 : 0;
    return bPercent - aPercent;
  }).slice(0, 3);
  if (highPotential.length > 0) {
    recommendations.push(`\u9AD8\u4F18\u5316\u6F5C\u529B\u5E7F\u544A\u6D3B\u52A8\uFF1A${highPotential.map((r) => r.campaignName).join("\u3001")}\uFF0C\u5EFA\u8BAE\u4F18\u5148\u4F18\u5316`);
  }
  const lowConfidence = results.filter((r) => r.confidence < 0.5 && r.status === "success");
  if (lowConfidence.length > 0) {
    recommendations.push(`${lowConfidence.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u5206\u6790\u7F6E\u4FE1\u5EA6\u8F83\u4F4E\uFF0C\u5EFA\u8BAE\u8C28\u614E\u5E94\u7528\u4F18\u5316\u5EFA\u8BAE`);
  }
  return recommendations;
}
async function applyOptimization(request) {
  const db = await getDb();
  if (!db) {
    throw new Error("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
  }
  const currentSettings = await db.execute(sql`
    SELECT top_of_search_adjustment, product_page_adjustment
    FROM placement_settings
    WHERE campaign_id = ${request.campaignId}
    AND account_id = ${request.accountId}
  `);
  const current = currentSettings[0][0] || {
    top_of_search_adjustment: 0,
    product_page_adjustment: 0
  };
  const beforeTopOfSearch = Number(current.top_of_search_adjustment) || 0;
  const beforeProductPage = Number(current.product_page_adjustment) || 0;
  const insertResult = await db.execute(sql`
 INSERT INTO marginal_benefit_applications (
 account_id, campaign_id, user_id, optimization_goal,
 application_status, before_top_of_search, before_product_page,
 after_top_of_search, after_product_page,
 expected_sales_change, expected_spend_change,
 expected_roas_change, expected_acos_change,
 application_note
 ) VALUES (
 ${request.accountId}, ${request.campaignId}, ${request.userId},
 ${request.optimizationGoal}, 'pending',
 ${beforeTopOfSearch}, ${beforeProductPage},
 ${request.suggestedTopOfSearch}, ${request.suggestedProductPage},
 ${request.expectedSalesChange}, ${request.expectedSpendChange},
 ${request.expectedROASChange}, ${request.expectedACoSChange},
 ${request.note || null}
 )
 `);
  const applicationId = insertResult[0].insertId;
  try {
    const adjustments = [
      {
        placementType: "top_of_search",
        currentAdjustment: beforeTopOfSearch,
        suggestedAdjustment: request.suggestedTopOfSearch,
        adjustmentDelta: request.suggestedTopOfSearch - beforeTopOfSearch,
        efficiencyScore: 0,
        confidence: 1,
        isReliable: true,
        reason: "\u8FB9\u9645\u6548\u76CA\u5206\u6790\u5EFA\u8BAE"
      },
      {
        placementType: "product_page",
        currentAdjustment: beforeProductPage,
        suggestedAdjustment: request.suggestedProductPage,
        adjustmentDelta: request.suggestedProductPage - beforeProductPage,
        efficiencyScore: 0,
        confidence: 1,
        isReliable: true,
        reason: "\u8FB9\u9645\u6548\u76CA\u5206\u6790\u5EFA\u8BAE"
      }
    ];
    await updatePlacementSettings(
      request.campaignId,
      request.accountId,
      adjustments
    );
    await db.execute(sql`
      UPDATE marginal_benefit_applications SET
        application_status = 'applied',
        applied_at = NOW()
      WHERE id = ${applicationId}
    `);
    return {
      // @ts-ignore
      id: applicationId,
      success: true,
      beforeTopOfSearch,
      beforeProductPage,
      afterTopOfSearch: request.suggestedTopOfSearch,
      afterProductPage: request.suggestedProductPage
    };
  } catch (error48) {
    const errorMessage = error48 instanceof Error ? error48.message : "\u5E94\u7528\u5931\u8D25";
    await db.execute(sql`
      UPDATE marginal_benefit_applications SET
        application_status = 'failed',
        error_message = ${errorMessage}
      WHERE id = ${applicationId}
    `);
    return {
      // @ts-ignore
      id: applicationId,
      success: false,
      beforeTopOfSearch,
      beforeProductPage,
      afterTopOfSearch: beforeTopOfSearch,
      afterProductPage: beforeProductPage,
      error: errorMessage
    };
  }
}
async function batchApplyOptimization(accountId, userId, applications) {
  const results = [];
  let successCount = 0;
  let failedCount = 0;
  for (const app of applications) {
    const result = await applyOptimization({
      accountId,
      userId,
      ...app
    });
    results.push(result);
    if (result.success) {
      successCount++;
    } else {
      failedCount++;
    }
  }
  return {
    totalCount: applications.length,
    successCount,
    failedCount,
    results
  };
}
async function rollbackApplication(applicationId) {
  const db = await getDb();
  if (!db) {
    return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  }
  const records = await db.execute(sql`
    SELECT * FROM marginal_benefit_applications
    WHERE id = ${applicationId}
  `);
  const record2 = records[0][0];
  if (!record2) {
    return { success: false, error: "\u627E\u4E0D\u5230\u5E94\u7528\u8BB0\u5F55" };
  }
  if (record2.application_status !== "applied") {
    return { success: false, error: "\u53EA\u80FD\u56DE\u6EDA\u5DF2\u5E94\u7528\u7684\u4F18\u5316" };
  }
  try {
    const rollbackAdjustments = [
      // @ts-ignore
      {
        // @ts-ignore
        placementType: "top_of_search",
        // @ts-ignore
        currentAdjustment: record2.after_top_of_search,
        // @ts-ignore
        suggestedAdjustment: record2.before_top_of_search,
        // @ts-ignore
        adjustmentDelta: record2.before_top_of_search - record2.after_top_of_search,
        efficiencyScore: 0,
        confidence: 1,
        // @ts-ignore
        isReliable: true,
        // @ts-ignore
        reason: "\u56DE\u6EDA\u5230\u4E4B\u524D\u7684\u8BBE\u7F6E"
      },
      {
        placementType: "product_page",
        // @ts-ignore
        currentAdjustment: record2.after_product_page,
        // @ts-ignore
        suggestedAdjustment: record2.before_product_page,
        // @ts-ignore
        adjustmentDelta: record2.before_product_page - record2.after_product_page,
        efficiencyScore: 0,
        confidence: 1,
        isReliable: true,
        reason: "\u56DE\u6EDA\u5230\u4E4B\u524D\u7684\u8BBE\u7F6E"
      }
    ];
    await updatePlacementSettings(
      // @ts-ignore
      record2.campaign_id,
      // @ts-ignore
      record2.account_id,
      rollbackAdjustments
    );
    await db.execute(sql`
      UPDATE marginal_benefit_applications SET
        application_status = 'rolled_back'
      WHERE id = ${applicationId}
    `);
    return { success: true };
  } catch (error48) {
    return {
      success: false,
      error: error48 instanceof Error ? error48.message : "\u56DE\u6EDA\u5931\u8D25"
    };
  }
}
async function getApplicationHistory(accountId, campaignId, limit = 20) {
  const db = await getDb();
  if (!db) {
    return [];
  }
  let query;
  if (campaignId) {
    query = sql`
      SELECT * FROM marginal_benefit_applications
      WHERE account_id = ${accountId}
      AND campaign_id = ${campaignId}
      ORDER BY created_at DESC
      LIMIT ${sql.raw(String(limit))}
    `;
  } else {
    query = sql`
      SELECT * FROM marginal_benefit_applications
      WHERE account_id = ${accountId}
      ORDER BY created_at DESC
      LIMIT ${sql.raw(String(limit))}
    `;
  }
  const result = await db.execute(query);
  return result[0] || [];
}
async function getBatchAnalysisHistory(accountId, limit = 10) {
  const db = await getDb();
  if (!db) {
    return [];
  }
  const result = await db.execute(sql`
 SELECT * FROM batch_marginal_benefit_analysis
 WHERE account_id = ${accountId}
 ORDER BY created_at DESC
 LIMIT ${sql.raw(String(limit))}
 `);
  return result[0] || [];
}
async function getBatchAnalysisDetail(analysisId) {
  const db = await getDb();
  if (!db) {
    return null;
  }
  const result = await db.execute(sql`
 SELECT * FROM batch_marginal_benefit_analysis
 WHERE id = ${analysisId}
 `);
  const record2 = result[0][0];
  if (!record2) {
    return null;
  }
  return {
    // @ts-ignore
    id: record2.id,
    // @ts-ignore
    accountId: record2.account_id,
    // @ts-ignore
    userId: record2.user_id,
    // @ts-ignore
    analysisName: record2.analysis_name,
    // @ts-ignore
    campaignCount: record2.campaign_count,
    // @ts-ignore
    optimizationGoal: record2.optimization_goal,
    // @ts-ignore
    status: record2.analysis_status,
    summary: {
      // @ts-ignore
      totalCurrentSpend: Number(record2.total_current_spend) || 0,
      // @ts-ignore
      totalCurrentSales: Number(record2.total_current_sales) || 0,
      // @ts-ignore
      totalExpectedSpend: Number(record2.total_expected_spend) || 0,
      // @ts-ignore
      totalExpectedSales: Number(record2.total_expected_sales) || 0,
      // @ts-ignore
      overallROASChange: Number(record2.overall_roas_change) || 0,
      // @ts-ignore
      overallACoSChange: Number(record2.overall_acos_change) || 0,
      // @ts-ignore
      avgConfidence: Number(record2.avg_confidence) || 0
    },
    // @ts-ignore
    campaignResults: record2.analysis_results ? JSON.parse(record2.analysis_results) : [],
    // @ts-ignore
    recommendations: record2.recommendations ? JSON.parse(record2.recommendations) : [],
    // @ts-ignore
    error: record2.error_message,
    // @ts-ignore
    startedAt: record2.started_at,
    // @ts-ignore
    completedAt: record2.completed_at
  };
}
var init_marginalBenefitBatchService = __esm({
  "server/optimization/marginalBenefitBatchService.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_safeSql();
    init_marginalBenefitAnalysisService();
    init_placementOptimizationService();
    init_marginalBenefitHistoryService();
    __name(createBatchAnalysis, "createBatchAnalysis");
    __name(executeBatchAnalysis, "executeBatchAnalysis");
    __name(generateBatchRecommendations, "generateBatchRecommendations");
    __name(applyOptimization, "applyOptimization");
    __name(batchApplyOptimization, "batchApplyOptimization");
    __name(rollbackApplication, "rollbackApplication");
    __name(getApplicationHistory, "getApplicationHistory");
    __name(getBatchAnalysisHistory, "getBatchAnalysisHistory");
    __name(getBatchAnalysisDetail, "getBatchAnalysisDetail");
  }
});

