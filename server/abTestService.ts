/**
 * A/B测试服务
 * 用于对比不同预算分配策略的实际效果，持续优化算法参数
 */

import { getDb } from './db';
import {
  abTests,
  abTestVariants,
  abTestCampaignAssignments,
  abTestDailyMetrics,
  abTestResults,
  campaigns,
  InsertABTest,
  InsertABTestVariant,
  ABTest,
  ABTestVariant,
} from '../drizzle/schema';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';

// A/B测试配置接口
export interface ABTestConfig {
  accountId: number;
  performanceGroupId?: number;
  testName: string;
  testDescription?: string;
  testType: 'budget_allocation' | 'bid_strategy' | 'targeting';
  targetMetric: 'roas' | 'acos' | 'conversions' | 'revenue' | 'profit';
  minSampleSize?: number;
  confidenceLevel?: number;
  durationDays?: number;
  controlConfig: Record<string, unknown>;
  treatmentConfig: Record<string, unknown>;
  trafficSplit?: number; // 0-1，treatment组的流量比例
}

// 创建A/B测试
export async function createABTest(config: ABTestConfig, userId?: number): Promise<{
  testId: number;
  controlVariantId: number;
  treatmentVariantId: number;
}> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // 创建测试
  const testData: InsertABTest = {
    accountId: config.accountId,
    performanceGroupId: config.performanceGroupId,
    testName: config.testName,
    testDescription: config.testDescription,
    testType: config.testType,
    targetMetric: config.targetMetric,
    minSampleSize: config.minSampleSize || 100,
    confidenceLevel: String(config.confidenceLevel || 0.95),
    status: 'draft',
    createdBy: userId,
  };

  const testResult = await db.insert(abTests).values(testData);
  const testId = testResult[0].insertId;

  // 创建对照组变体
  const controlVariantData: InsertABTestVariant = {
    testId,
    variantName: '对照组',
    variantType: 'control',
    description: '使用当前的预算分配策略',
    configJson: JSON.stringify(config.controlConfig),
    trafficAllocation: String(1 - (config.trafficSplit || 0.5)),
  };

  const controlResult = await db.insert(abTestVariants).values(controlVariantData);
  const controlVariantId = controlResult[0].insertId;

  // 创建实验组变体
  const treatmentVariantData: InsertABTestVariant = {
    testId,
    variantName: '实验组',
    variantType: 'treatment',
    description: '使用新的预算分配策略',
    configJson: JSON.stringify(config.treatmentConfig),
    trafficAllocation: String(config.trafficSplit || 0.5),
  };

  const treatmentResult = await db.insert(abTestVariants).values(treatmentVariantData);
  const treatmentVariantId = treatmentResult[0].insertId;

  return { testId, controlVariantId, treatmentVariantId };
}

// 分配广告活动到测试组
export async function assignCampaignsToTest(
  testId: number,
  campaignIds: number[],
  splitMethod: 'random' | 'stratified' | 'manual' = 'random'
): Promise<{
  controlCampaigns: number[];
  treatmentCampaigns: number[];
}> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // 获取变体
  const variants = await db.select().from(abTestVariants).where(eq(abTestVariants.testId, testId));
  const controlVariant = variants.find(v => v.variantType === 'control');
  const treatmentVariant = variants.find(v => v.variantType === 'treatment');

  if (!controlVariant || !treatmentVariant) {
    throw new Error('测试变体不完整');
  }

  const trafficSplit = parseFloat(treatmentVariant.trafficAllocation || '0.5');
  const controlCampaigns: number[] = [];
  const treatmentCampaigns: number[] = [];

  if (splitMethod === 'random') {
    // 随机分配
    const shuffled = [...campaignIds].sort(() => Math.random() - 0.5);
    const splitIndex = Math.floor(shuffled.length * (1 - trafficSplit));
    
    for (let i = 0; i < shuffled.length; i++) {
      if (i < splitIndex) {
        controlCampaigns.push(shuffled[i]);
      } else {
        treatmentCampaigns.push(shuffled[i]);
      }
    }
  } else if (splitMethod === 'stratified') {
    // 分层抽样（基于广告活动的花费或表现）
    // 简化实现：按ID奇偶分配
    for (const campaignId of campaignIds) {
      if (campaignId % 2 === 0) {
        controlCampaigns.push(campaignId);
      } else {
        treatmentCampaigns.push(campaignId);
      }
    }
  }

  // 保存分配结果
  const assignments = [
    ...controlCampaigns.map(campaignId => ({
      testId,
      variantId: controlVariant.id,
      campaignId,
    })),
    ...treatmentCampaigns.map(campaignId => ({
      testId,
      variantId: treatmentVariant.id,
      campaignId,
    })),
  ];

  if (assignments.length > 0) {
    await db.insert(abTestCampaignAssignments).values(assignments);
  }

  return { controlCampaigns, treatmentCampaigns };
}

// 启动A/B测试
export async function startABTest(testId: number, durationDays: number = 14): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + durationDays);

  await db.update(abTests)
    .set({
      status: 'running',
      startDate: startDate.toISOString().slice(0, 19).replace('T', ' '),
      endDate: endDate.toISOString().slice(0, 19).replace('T', ' '),
    })
    .where(eq(abTests.id, testId));
}

// 暂停A/B测试
export async function pauseABTest(testId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db.update(abTests)
    .set({ status: 'paused' })
    .where(eq(abTests.id, testId));
}

// 结束A/B测试
export async function completeABTest(testId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db.update(abTests)
    .set({ status: 'completed' })
    .where(eq(abTests.id, testId));
}

// 记录每日指标
export async function recordDailyMetrics(
  testId: number,
  variantId: number,
  metrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    conversions: number;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const roas = metrics.spend > 0 ? metrics.sales / metrics.spend : 0;
  const acos = metrics.sales > 0 ? metrics.spend / metrics.sales : 0;
  const ctr = metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0;
  const cvr = metrics.clicks > 0 ? metrics.conversions / metrics.clicks : 0;
  const cpc = metrics.clicks > 0 ? metrics.spend / metrics.clicks : 0;

  await db.insert(abTestDailyMetrics).values({
    testId,
    variantId,
    metricDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    spend: String(metrics.spend),
    sales: String(metrics.sales),
    conversions: metrics.conversions,
    roas: String(roas),
    acos: String(acos),
    ctr: String(ctr),
    cvr: String(cvr),
    cpc: String(cpc),
  });
}

// 计算统计显著性（简化的t检验）
function calculateStatisticalSignificance(
  controlValues: number[],
  treatmentValues: number[],
  confidenceLevel: number = 0.95
): {
  pValue: number;
  isSignificant: boolean;
  confidenceInterval: [number, number];
} {
  if (controlValues.length < 2 || treatmentValues.length < 2) {
    return { pValue: 1, isSignificant: false, confidenceInterval: [0, 0] };
  }

  // 计算均值
  const controlMean = controlValues.reduce((a, b) => a + b, 0) / controlValues.length;
  const treatmentMean = treatmentValues.reduce((a, b) => a + b, 0) / treatmentValues.length;

  // 计算标准差
  const controlStd = Math.sqrt(
    controlValues.reduce((sum, val) => sum + Math.pow(val - controlMean, 2), 0) / (controlValues.length - 1)
  );
  const treatmentStd = Math.sqrt(
    treatmentValues.reduce((sum, val) => sum + Math.pow(val - treatmentMean, 2), 0) / (treatmentValues.length - 1)
  );

  // 计算标准误差
  const pooledSE = Math.sqrt(
    Math.pow(controlStd, 2) / controlValues.length +
    Math.pow(treatmentStd, 2) / treatmentValues.length
  );

  // 计算t统计量
  const tStat = pooledSE > 0 ? (treatmentMean - controlMean) / pooledSE : 0;

  // 简化的p值计算（使用正态分布近似）
  const pValue = 2 * (1 - normalCDF(Math.abs(tStat)));

  // 计算置信区间
  const zScore = confidenceLevel === 0.95 ? 1.96 : (confidenceLevel === 0.99 ? 2.576 : 1.645);
  const marginOfError = zScore * pooledSE;
  const difference = treatmentMean - controlMean;
  const confidenceInterval: [number, number] = [
    difference - marginOfError,
    difference + marginOfError,
  ];

  return {
    pValue,
    isSignificant: pValue < (1 - confidenceLevel),
    confidenceInterval,
  };
}

// 正态分布累积分布函数
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// 分析A/B测试结果
export async function analyzeABTestResults(testId: number): Promise<{
  testInfo: ABTest;
  variants: ABTestVariant[];
  metrics: {
    metricName: string;
    controlValue: number;
    treatmentValue: number;
    absoluteDifference: number;
    relativeDifference: number;
    pValue: number;
    isSignificant: boolean;
    confidenceInterval: [number, number];
    winner: 'control' | 'treatment' | 'inconclusive';
  }[];
  overallWinner: 'control' | 'treatment' | 'inconclusive';
  recommendation: string;
}> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // 获取测试信息
  const testResults = await db.select().from(abTests).where(eq(abTests.id, testId)).limit(1);
  if (testResults.length === 0) {
    throw new Error('测试不存在');
  }
  const testInfo = testResults[0];

  // 获取变体
  const variants = await db.select().from(abTestVariants).where(eq(abTestVariants.testId, testId));
  const controlVariant = variants.find(v => v.variantType === 'control');
  const treatmentVariant = variants.find(v => v.variantType === 'treatment');

  if (!controlVariant || !treatmentVariant) {
    throw new Error('测试变体不完整');
  }

  // 获取每日指标
  const controlMetrics = await db.select()
    .from(abTestDailyMetrics)
    .where(and(
      eq(abTestDailyMetrics.testId, testId),
      eq(abTestDailyMetrics.variantId, controlVariant.id)
    ));

  const treatmentMetrics = await db.select()
    .from(abTestDailyMetrics)
    .where(and(
      eq(abTestDailyMetrics.testId, testId),
      eq(abTestDailyMetrics.variantId, treatmentVariant.id)
    ));

  // 分析各指标
  const metricsToAnalyze = ['roas', 'acos', 'ctr', 'cvr', 'cpc'];
  const confidenceLevel = parseFloat(testInfo.confidenceLevel || '0.95');
  
  const analysisResults = metricsToAnalyze.map(metricName => {
    const controlValues = controlMetrics.map(m => parseFloat((m as Record<string, string>)[metricName] || '0'));
    const treatmentValues = treatmentMetrics.map(m => parseFloat((m as Record<string, string>)[metricName] || '0'));

    const controlMean = controlValues.length > 0 
      ? controlValues.reduce((a, b) => a + b, 0) / controlValues.length 
      : 0;
    const treatmentMean = treatmentValues.length > 0 
      ? treatmentValues.reduce((a, b) => a + b, 0) / treatmentValues.length 
      : 0;

    const { pValue, isSignificant, confidenceInterval } = calculateStatisticalSignificance(
      controlValues,
      treatmentValues,
      confidenceLevel
    );

    const absoluteDifference = treatmentMean - controlMean;
    const relativeDifference = controlMean !== 0 ? (absoluteDifference / controlMean) * 100 : 0;

    // 判断赢家（对于ACoS和CPC，越低越好）
    let winner: 'control' | 'treatment' | 'inconclusive' = 'inconclusive';
    if (isSignificant) {
      if (metricName === 'acos' || metricName === 'cpc') {
        winner = absoluteDifference < 0 ? 'treatment' : 'control';
      } else {
        winner = absoluteDifference > 0 ? 'treatment' : 'control';
      }
    }

    return {
      metricName,
      controlValue: controlMean,
      treatmentValue: treatmentMean,
      absoluteDifference,
      relativeDifference,
      pValue,
      isSignificant,
      confidenceInterval,
      winner,
    };
  });

  // 确定总体赢家
  const targetMetric = testInfo.targetMetric;
  const targetResult = analysisResults.find(r => r.metricName === targetMetric);
  const overallWinner = targetResult?.winner || 'inconclusive';

  // 生成建议
  let recommendation = '';
  if (overallWinner === 'treatment') {
    recommendation = `实验组在目标指标(${targetMetric})上表现更好，建议采用新的预算分配策略。`;
  } else if (overallWinner === 'control') {
    recommendation = `对照组在目标指标(${targetMetric})上表现更好，建议保持当前的预算分配策略。`;
  } else {
    recommendation = `目前数据不足以得出结论，建议继续运行测试以收集更多数据。`;
  }

  // 保存分析结果
  for (const result of analysisResults) {
    await db.insert(abTestResults).values({
      testId,
      analysisDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
      controlVariantId: controlVariant.id,
      treatmentVariantId: treatmentVariant.id,
      metricName: result.metricName,
      controlValue: String(result.controlValue),
      treatmentValue: String(result.treatmentValue),
      absoluteDifference: String(result.absoluteDifference),
      relativeDifference: String(result.relativeDifference),
      pValue: String(result.pValue),
      confidenceInterval: JSON.stringify(result.confidenceInterval),
      isStatisticallySignificant: result.isSignificant ? 1 : 0,
      winningVariant: result.winner,
    });
  }

  return {
    testInfo,
    variants,
    metrics: analysisResults,
    overallWinner,
    recommendation,
  };
}

// 获取测试列表
export async function getABTests(accountId: number): Promise<ABTest[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select()
    .from(abTests)
    .where(eq(abTests.accountId, accountId))
    .orderBy(desc(abTests.createdAt));
}

// 获取测试详情
export async function getABTestById(testId: number): Promise<{
  test: ABTest;
  variants: ABTestVariant[];
  campaignCount: { control: number; treatment: number };
} | null> {
  const db = await getDb();
  if (!db) return null;

  const testResults = await db.select().from(abTests).where(eq(abTests.id, testId)).limit(1);
  if (testResults.length === 0) return null;

  const variants = await db.select().from(abTestVariants).where(eq(abTestVariants.testId, testId));
  
  const controlVariant = variants.find(v => v.variantType === 'control');
  const treatmentVariant = variants.find(v => v.variantType === 'treatment');

  let controlCount = 0;
  let treatmentCount = 0;

  if (controlVariant) {
    const controlAssignments = await db.select()
      .from(abTestCampaignAssignments)
      .where(eq(abTestCampaignAssignments.variantId, controlVariant.id));
    controlCount = controlAssignments.length;
  }

  if (treatmentVariant) {
    const treatmentAssignments = await db.select()
      .from(abTestCampaignAssignments)
      .where(eq(abTestCampaignAssignments.variantId, treatmentVariant.id));
    treatmentCount = treatmentAssignments.length;
  }

  return {
    test: testResults[0],
    variants,
    campaignCount: { control: controlCount, treatment: treatmentCount },
  };
}

// 删除A/B测试
export async function deleteABTest(testId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // 删除相关数据
  await db.delete(abTestResults).where(eq(abTestResults.testId, testId));
  await db.delete(abTestDailyMetrics).where(eq(abTestDailyMetrics.testId, testId));
  await db.delete(abTestCampaignAssignments).where(eq(abTestCampaignAssignments.testId, testId));
  await db.delete(abTestVariants).where(eq(abTestVariants.testId, testId));
  await db.delete(abTests).where(eq(abTests.id, testId));
}


// ==================== 辅助函数（用于单元测试） ====================

/**
 * 计算所需样本量
 * 使用二项分布的样本量公式
 */
export function calculateSampleSize(
  baselineRate: number,
  mde: number, // 最小可检测效应（相对变化）
  alpha: number = 0.05,
  power: number = 0.8
): number {
  // Z值
  const zAlpha = 1.96; // 95%置信度
  const zBeta = 0.84; // 80%统计功效
  
  const p1 = baselineRate;
  const p2 = baselineRate * (1 + mde);
  const pBar = (p1 + p2) / 2;
  
  // 样本量公式
  const numerator = Math.pow(zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + 
                            zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2);
  const denominator = Math.pow(p2 - p1, 2);
  
  return Math.ceil(numerator / denominator);
}

/**
 * 计算统计显著性（导出版本，用于单元测试）
 */
export function calculateStatisticalSignificanceExported(
  controlData: { conversions: number; impressions: number; clicks: number; spend: number; revenue: number },
  treatmentData: { conversions: number; impressions: number; clicks: number; spend: number; revenue: number },
  metric: string
): {
  pValue: number;
  isSignificant: boolean;
  confidenceInterval: [number, number];
} {
  let controlValue: number;
  let treatmentValue: number;
  let controlN: number;
  let treatmentN: number;
  
  switch (metric) {
    case 'conversions':
      controlValue = controlData.conversions / controlData.clicks;
      treatmentValue = treatmentData.conversions / treatmentData.clicks;
      controlN = controlData.clicks;
      treatmentN = treatmentData.clicks;
      break;
    case 'roas':
      controlValue = controlData.revenue / controlData.spend;
      treatmentValue = treatmentData.revenue / treatmentData.spend;
      controlN = controlData.impressions;
      treatmentN = treatmentData.impressions;
      break;
    default:
      controlValue = controlData.conversions / controlData.clicks;
      treatmentValue = treatmentData.conversions / treatmentData.clicks;
      controlN = controlData.clicks;
      treatmentN = treatmentData.clicks;
  }
  
  // 计算标准误差
  const pooledP = (controlValue * controlN + treatmentValue * treatmentN) / (controlN + treatmentN);
  const se = Math.sqrt(pooledP * (1 - pooledP) * (1/controlN + 1/treatmentN));
  
  // 计算z值
  const z = se > 0 ? (treatmentValue - controlValue) / se : 0;
  
  // 计算p值（双尾检验）
  const pValue = 2 * (1 - normalCDFExported(Math.abs(z)));
  
  // 置信区间
  const marginOfError = 1.96 * se;
  const diff = treatmentValue - controlValue;
  
  return {
    pValue,
    isSignificant: pValue < 0.05,
    confidenceInterval: [diff - marginOfError, diff + marginOfError],
  };
}

/**
 * 标准正态分布CDF（导出版本）
 */
function normalCDFExported(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return 0.5 * (1.0 + sign * y);
}

/**
 * 将广告活动分配到测试组
 */
export function splitCampaignsIntoGroups(
  campaigns: Array<{ id: number; spend: number }>,
  trafficSplit: number,
  method: 'random' | 'stratified' | 'manual' = 'stratified'
): {
  control: Array<{ id: number; spend: number }>;
  treatment: Array<{ id: number; spend: number }>;
} {
  if (method === 'random') {
    // 随机分配
    const shuffled = [...campaigns].sort(() => Math.random() - 0.5);
    const splitIndex = Math.floor(campaigns.length * (1 - trafficSplit));
    return {
      control: shuffled.slice(0, splitIndex),
      treatment: shuffled.slice(splitIndex),
    };
  } else {
    // 分层分配：按花费排序后交替分配，确保两组花费相近
    const sorted = [...campaigns].sort((a, b) => b.spend - a.spend);
    const control: Array<{ id: number; spend: number }> = [];
    const treatment: Array<{ id: number; spend: number }> = [];
    
    let controlSpend = 0;
    let treatmentSpend = 0;
    
    for (const campaign of sorted) {
      // 根据当前累计花费决定分配
      const targetTreatmentRatio = trafficSplit;
      const currentTreatmentRatio = treatmentSpend / (controlSpend + treatmentSpend + 0.001);
      
      if (currentTreatmentRatio < targetTreatmentRatio) {
        treatment.push(campaign);
        treatmentSpend += campaign.spend;
      } else {
        control.push(campaign);
        controlSpend += campaign.spend;
      }
    }
    
    return { control, treatment };
  }
}

/**
 * 判断获胜方
 */
export function determineWinner(
  metrics: Array<{
    metricName: string;
    controlValue: number;
    treatmentValue: number;
    pValue: number;
    isSignificant: boolean;
  }>,
  targetMetric: string
): 'control' | 'treatment' | 'inconclusive' {
  const targetResult = metrics.find(m => m.metricName === targetMetric);
  
  if (!targetResult || !targetResult.isSignificant) {
    return 'inconclusive';
  }
  
  return targetResult.treatmentValue > targetResult.controlValue ? 'treatment' : 'control';
}
