/**
 * 边际效益批量分析和一键应用服务
 * 
 * 功能：
 * 1. 批量分析多个广告活动的边际效益
 * 2. 生成汇总报告
 * 3. 一键应用优化建议
 * 4. 记录应用历史
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";
import { 
  calculateMarginalBenefitSimple, 
  optimizeTrafficAllocationSimple,
  OptimizationGoal
} from "./marginalBenefitAnalysisService";
import { PlacementType, updatePlacementSettings } from "./placementOptimizationService";
import { saveMarginalBenefitHistory } from "./marginalBenefitHistoryService";

// ==================== 类型定义 ====================

export interface BatchAnalysisRequest {
  accountId: number;
  userId: number;
  campaignIds: string[];
  optimizationGoal: OptimizationGoal;
  analysisName?: string;
}

export interface BatchAnalysisResult {
  id: number;
  accountId: number;
  userId: number;
  analysisName: string;
  campaignCount: number;
  optimizationGoal: OptimizationGoal;
  status: 'pending' | 'running' | 'completed' | 'failed';
  summary: {
    totalCurrentSpend: number;
    totalCurrentSales: number;
    totalExpectedSpend: number;
    totalExpectedSales: number;
    overallROASChange: number;
    overallACoSChange: number;
    avgConfidence: number;
  };
  campaignResults: CampaignAnalysisResult[];
  recommendations: string[];
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface SimpleMarginalBenefitResult {
  marginalROAS: number;
  marginalACoS: number;
  marginalSales: number;
  marginalSpend: number;
  elasticity: number;
  diminishingPoint: number;
  optimalRange: { min: number; max: number };
  confidence: number;
}

export interface SimpleOptimizationResult {
  optimizedAdjustments: Record<string, number>;
  expectedSalesIncrease: number;
  expectedSpendChange: number;
  expectedROASChange: number;
  confidence: number;
}

export interface CampaignAnalysisResult {
  campaignId: string;
  campaignName: string;
  currentSpend: number;
  currentSales: number;
  currentROAS: number;
  currentACoS: number;
  marginalBenefits: {
    topOfSearch: SimpleMarginalBenefitResult | null;
    productPage: SimpleMarginalBenefitResult | null;
    restOfSearch: SimpleMarginalBenefitResult | null;
  };
  optimization: SimpleOptimizationResult | null;
  confidence: number;
  status: 'success' | 'failed' | 'insufficient_data';
  error?: string;
}

export interface ApplicationRequest {
  accountId: number;
  userId: number;
  campaignId: string;
  optimizationGoal: OptimizationGoal;
  suggestedTopOfSearch: number;
  suggestedProductPage: number;
  expectedSalesChange: number;
  expectedSpendChange: number;
  expectedROASChange: number;
  expectedACoSChange: number;
  note?: string;
}

export interface ApplicationResult {
  id: number;
  success: boolean;
  beforeTopOfSearch: number;
  beforeProductPage: number;
  afterTopOfSearch: number;
  afterProductPage: number;
  error?: string;
}

// ==================== 批量分析 ====================

/**
 * 创建批量分析任务
 */
export async function createBatchAnalysis(
  request: BatchAnalysisRequest
): Promise<number> {
  const db = await getDb();
  if (!db) {
    throw new Error("数据库连接失败");
  }

  const analysisName = request.analysisName || `批量分析 ${new Date().toLocaleString('zh-CN')}`;
  
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

  return (result as any)[0].insertId;
}

/**
 * 执行批量分析
 */
export async function executeBatchAnalysis(
  analysisId: number,
  request: BatchAnalysisRequest
): Promise<BatchAnalysisResult> {
  const db = await getDb();
  if (!db) {
    throw new Error("数据库连接失败");
  }

  const campaignResults: CampaignAnalysisResult[] = [];
  let totalCurrentSpend = 0;
  let totalCurrentSales = 0;
  let totalExpectedSpend = 0;
  let totalExpectedSales = 0;
  let totalConfidence = 0;
  let successCount = 0;

  // 获取广告活动信息
  const campaigns = await db.execute(sql`
    SELECT id, campaign_id, campaign_name, spend, sales
    FROM campaigns
    WHERE account_id = ${request.accountId}
    AND campaign_id IN (${sql.raw(request.campaignIds.map(id => `'${id}'`).join(','))})
  `);

  const campaignMap = new Map(
    ((campaigns as any)[0] as any[]).map(c => [c.campaign_id, c])
  );

  // 逐个分析广告活动
  for (const campaignId of request.campaignIds) {
    const campaign = campaignMap.get(campaignId);
    const campaignName = campaign?.campaign_name || campaignId;
    const currentSpend = Number(campaign?.spend) || 0;
    const currentSales = Number(campaign?.sales) || 0;
    const currentOrders = Number(campaign?.orders) || 0;

    try {
      // 构建指标数据
      const metrics = {
        impressions: 10000,
        clicks: 500,
        spend: currentSpend,
        sales: currentSales,
        orders: currentOrders,
        ctr: 0.05,
        cvr: currentOrders > 0 ? currentOrders / 500 : 0.02,
        cpc: currentSpend / 500,
        acos: currentSales > 0 ? (currentSpend / currentSales) * 100 : 30,
        roas: currentSpend > 0 ? currentSales / currentSpend : 3
      };

      // 计算各位置的边际效益
      const topOfSearch = calculateMarginalBenefitSimple(metrics, 0);
      const productPage = calculateMarginalBenefitSimple(metrics, 0);
      const restOfSearch = calculateMarginalBenefitSimple(metrics, 0);

      // 计算流量分配优化
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

      // 保存历史记录
      const placements: PlacementType[] = ['top_of_search', 'product_page', 'rest_of_search'];
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
        currentACoS: currentSales > 0 ? (currentSpend / currentSales) * 100 : 0,
        marginalBenefits: { topOfSearch, productPage, restOfSearch },
        optimization,
        confidence,
        status: confidence >= 0.3 ? 'success' : 'insufficient_data'
      });

      totalCurrentSpend += currentSpend;
      totalCurrentSales += currentSales;
      totalExpectedSpend += optimization.expectedSpendChange + currentSpend;
      totalExpectedSales += optimization.expectedSalesIncrease + currentSales;
      totalConfidence += confidence;
      successCount++;

    } catch (error) {
      campaignResults.push({
        campaignId,
        campaignName,
        currentSpend,
        currentSales,
        currentROAS: currentSpend > 0 ? currentSales / currentSpend : 0,
        currentACoS: currentSales > 0 ? (currentSpend / currentSales) * 100 : 0,
        marginalBenefits: { topOfSearch: null, productPage: null, restOfSearch: null },
        optimization: null,
        confidence: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : '分析失败'
      });
    }
  }

  // 计算汇总指标
  const currentROAS = totalCurrentSpend > 0 ? totalCurrentSales / totalCurrentSpend : 0;
  const expectedROAS = totalExpectedSpend > 0 ? totalExpectedSales / totalExpectedSpend : 0;
  const currentACoS = totalCurrentSales > 0 ? (totalCurrentSpend / totalCurrentSales) * 100 : 0;
  const expectedACoS = totalExpectedSales > 0 ? (totalExpectedSpend / totalExpectedSales) * 100 : 0;

  const summary = {
    totalCurrentSpend,
    totalCurrentSales,
    totalExpectedSpend,
    totalExpectedSales,
    overallROASChange: expectedROAS - currentROAS,
    overallACoSChange: expectedACoS - currentACoS,
    avgConfidence: successCount > 0 ? totalConfidence / successCount : 0
  };

  // 生成建议
  const recommendations = generateBatchRecommendations(campaignResults, summary);

  // 更新数据库记录
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
    analysisName: request.analysisName || `批量分析 ${new Date().toLocaleString('zh-CN')}`,
    campaignCount: request.campaignIds.length,
    optimizationGoal: request.optimizationGoal,
    status: 'completed',
    summary,
    campaignResults,
    recommendations
  };
}

/**
 * 生成批量分析建议
 */
function generateBatchRecommendations(
  results: CampaignAnalysisResult[],
  summary: BatchAnalysisResult['summary']
): string[] {
  const recommendations: string[] = [];

  // 成功率分析
  const successCount = results.filter(r => r.status === 'success').length;
  const insufficientCount = results.filter(r => r.status === 'insufficient_data').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

  if (insufficientCount > 0) {
    recommendations.push(`${insufficientCount}个广告活动数据不足，建议等待更多数据积累后再进行分析`);
  }

  if (failedCount > 0) {
    recommendations.push(`${failedCount}个广告活动分析失败，请检查数据完整性`);
  }

  // 整体效果分析
  if (summary.overallROASChange > 0.1) {
    recommendations.push(`应用优化建议后，预计整体ROAS可提升${(summary.overallROASChange).toFixed(2)}，建议执行优化`);
  } else if (summary.overallROASChange < -0.1) {
    recommendations.push(`当前位置倾斜设置已接近最优，继续优化可能导致ROAS下降`);
  }

  if (summary.overallACoSChange < -2) {
    recommendations.push(`预计整体ACoS可降低${Math.abs(summary.overallACoSChange).toFixed(1)}%，广告效率将显著提升`);
  }

  // 高潜力广告活动
  const highPotential = results
    .filter(r => r.optimization && (r.optimization.expectedSalesIncrease / (r.currentSales || 1)) * 100 > 10)
    .sort((a, b) => {
      const aPercent = a.optimization ? (a.optimization.expectedSalesIncrease / (a.currentSales || 1)) * 100 : 0;
      const bPercent = b.optimization ? (b.optimization.expectedSalesIncrease / (b.currentSales || 1)) * 100 : 0;
      return bPercent - aPercent;
    })
    .slice(0, 3);

  if (highPotential.length > 0) {
    recommendations.push(`高优化潜力广告活动：${highPotential.map(r => r.campaignName).join('、')}，建议优先优化`);
  }

  // 低置信度警告
  const lowConfidence = results.filter(r => r.confidence < 0.5 && r.status === 'success');
  if (lowConfidence.length > 0) {
    recommendations.push(`${lowConfidence.length}个广告活动分析置信度较低，建议谨慎应用优化建议`);
  }

  return recommendations;
}

// ==================== 一键应用 ====================

/**
 * 应用优化建议
 */
export async function applyOptimization(
  request: ApplicationRequest
): Promise<ApplicationResult> {
  const db = await getDb();
  if (!db) {
    throw new Error("数据库连接失败");
  }

  // 获取当前设置
  const currentSettings = await db.execute(sql`
    SELECT top_of_search_adjustment, product_page_adjustment
    FROM placement_settings
    WHERE campaign_id = ${request.campaignId}
    AND account_id = ${request.accountId}
  `);

  const current = ((currentSettings as any)[0] as any[])[0] || {
    top_of_search_adjustment: 0,
    product_page_adjustment: 0
  };

  const beforeTopOfSearch = Number(current.top_of_search_adjustment) || 0;
  const beforeProductPage = Number(current.product_page_adjustment) || 0;

  // 创建应用记录
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

  const applicationId = (insertResult as any)[0].insertId;

  try {
    // 应用新设置
    // 构建调整建议数组
    const adjustments = [
      {
        placementType: 'top_of_search' as PlacementType,
        currentAdjustment: beforeTopOfSearch,
        suggestedAdjustment: request.suggestedTopOfSearch,
        adjustmentDelta: request.suggestedTopOfSearch - beforeTopOfSearch,
        efficiencyScore: 0,
        confidence: 1,
        isReliable: true,
        reason: '边际效益分析建议'
      },
      {
        placementType: 'product_page' as PlacementType,
        currentAdjustment: beforeProductPage,
        suggestedAdjustment: request.suggestedProductPage,
        adjustmentDelta: request.suggestedProductPage - beforeProductPage,
        efficiencyScore: 0,
        confidence: 1,
        isReliable: true,
        reason: '边际效益分析建议'
      }
    ];
    
    await updatePlacementSettings(
      request.campaignId,
      request.accountId,
      adjustments
    );

    // 更新应用状态
    await db.execute(sql`
      UPDATE marginal_benefit_applications SET
        application_status = 'applied',
        applied_at = NOW()
      WHERE id = ${applicationId}
    `);

    return {
      id: applicationId,
      success: true,
      beforeTopOfSearch,
      beforeProductPage,
      afterTopOfSearch: request.suggestedTopOfSearch,
      afterProductPage: request.suggestedProductPage
    };

  } catch (error) {
    // 记录失败
    const errorMessage = error instanceof Error ? error.message : '应用失败';
    await db.execute(sql`
      UPDATE marginal_benefit_applications SET
        application_status = 'failed',
        error_message = ${errorMessage}
      WHERE id = ${applicationId}
    `);

    return {
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

/**
 * 批量应用优化建议
 */
export async function batchApplyOptimization(
  accountId: number,
  userId: number,
  applications: Array<{
    campaignId: string;
    optimizationGoal: OptimizationGoal;
    suggestedTopOfSearch: number;
    suggestedProductPage: number;
    expectedSalesChange: number;
    expectedSpendChange: number;
    expectedROASChange: number;
    expectedACoSChange: number;
  }>
): Promise<{
  totalCount: number;
  successCount: number;
  failedCount: number;
  results: ApplicationResult[];
}> {
  const results: ApplicationResult[] = [];
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

/**
 * 回滚优化应用
 */
export async function rollbackApplication(
  applicationId: number
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: "数据库连接失败" };
  }

  // 获取应用记录
  const records = await db.execute(sql`
    SELECT * FROM marginal_benefit_applications
    WHERE id = ${applicationId}
  `);

  const record = ((records as any)[0] as any[])[0];
  if (!record) {
    return { success: false, error: "找不到应用记录" };
  }

  if (record.application_status !== 'applied') {
    return { success: false, error: "只能回滚已应用的优化" };
  }

  try {
    // 恢复原设置
    // 构建回滚调整建议数组
    const rollbackAdjustments = [
      {
        placementType: 'top_of_search' as PlacementType,
        currentAdjustment: record.after_top_of_search,
        suggestedAdjustment: record.before_top_of_search,
        adjustmentDelta: record.before_top_of_search - record.after_top_of_search,
        efficiencyScore: 0,
        confidence: 1,
        isReliable: true,
        reason: '回滚到之前的设置'
      },
      {
        placementType: 'product_page' as PlacementType,
        currentAdjustment: record.after_product_page,
        suggestedAdjustment: record.before_product_page,
        adjustmentDelta: record.before_product_page - record.after_product_page,
        efficiencyScore: 0,
        confidence: 1,
        isReliable: true,
        reason: '回滚到之前的设置'
      }
    ];
    
    await updatePlacementSettings(
      record.campaign_id,
      record.account_id,
      rollbackAdjustments
    );

    // 更新状态
    await db.execute(sql`
      UPDATE marginal_benefit_applications SET
        application_status = 'rolled_back'
      WHERE id = ${applicationId}
    `);

    return { success: true };

  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : '回滚失败' 
    };
  }
}

/**
 * 获取应用历史
 */
export async function getApplicationHistory(
  accountId: number,
  campaignId?: string,
  limit: number = 20
): Promise<any[]> {
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
      LIMIT ${limit}
    `;
  } else {
    query = sql`
      SELECT * FROM marginal_benefit_applications
      WHERE account_id = ${accountId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  const result = await db.execute(query);
  return ((result as any)[0] as any[]) || [];
}

/**
 * 获取批量分析历史
 */
export async function getBatchAnalysisHistory(
  accountId: number,
  limit: number = 10
): Promise<any[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  const result = await db.execute(sql`
    SELECT * FROM batch_marginal_benefit_analysis
    WHERE account_id = ${accountId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  return ((result as any)[0] as any[]) || [];
}

/**
 * 获取批量分析详情
 */
export async function getBatchAnalysisDetail(
  analysisId: number
): Promise<BatchAnalysisResult | null> {
  const db = await getDb();
  if (!db) {
    return null;
  }

  const result = await db.execute(sql`
    SELECT * FROM batch_marginal_benefit_analysis
    WHERE id = ${analysisId}
  `);

  const record = ((result as any)[0] as any[])[0];
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    accountId: record.account_id,
    userId: record.user_id,
    analysisName: record.analysis_name,
    campaignCount: record.campaign_count,
    optimizationGoal: record.optimization_goal,
    status: record.analysis_status,
    summary: {
      totalCurrentSpend: Number(record.total_current_spend) || 0,
      totalCurrentSales: Number(record.total_current_sales) || 0,
      totalExpectedSpend: Number(record.total_expected_spend) || 0,
      totalExpectedSales: Number(record.total_expected_sales) || 0,
      overallROASChange: Number(record.overall_roas_change) || 0,
      overallACoSChange: Number(record.overall_acos_change) || 0,
      avgConfidence: Number(record.avg_confidence) || 0
    },
    campaignResults: record.analysis_results ? JSON.parse(record.analysis_results) : [],
    recommendations: record.recommendations ? JSON.parse(record.recommendations) : [],
    error: record.error_message,
    startedAt: record.started_at,
    completedAt: record.completed_at
  };
}
