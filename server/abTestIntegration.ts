/**
 * v271 P0-2: A/B测试框架与核心优化链路集成模块
 * 
 * 核心功能：
 * 1. 将A/B测试框架与metaLearningSelector集成，支持算法策略的在线对比实验
 * 2. 将A/B测试框架与optimizationTargetEngine集成，支持优化参数的对比实验
 * 3. 自动记录实验指标，支持统计显著性分析
 * 4. 提供实验生命周期管理（创建→分配→运行→分析→应用）
 * 
 * 支持的实验类型：
 * - algorithm_strategy: 对比不同算法选择策略（如Cascade Ensemble vs Single模式）
 * - fusion_threshold: 对比不同融合阈值（如10% vs 15% vs 20%）
 * - exploration_rate: 对比不同探索率策略
 * - bid_strategy: 对比不同出价策略参数
 */

import { getDb } from "./db";
import { abTests, abTestVariants, abTestCampaignAssignments, abTestDailyMetrics } from "../drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { createModuleLogger } from './utils/logger';
import * as abTestService from './abTestService';

const log = createModuleLogger('ABTestIntegration');

// ==================== 类型定义 ====================

export interface AlgorithmExperimentConfig {
  /** 实验名称 */
  name: string;
  /** 实验描述 */
  description?: string;
  /** 账户ID */
  accountId: number;
  /** 优化目标ID（可选，限定实验范围） */
  performanceGroupId?: number;
  /** 实验类型 */
  experimentType: 'algorithm_strategy' | 'fusion_threshold' | 'exploration_rate' | 'bid_strategy';
  /** 控制组配置 */
  controlConfig: ExperimentVariantConfig;
  /** 实验组配置 */
  treatmentConfig: ExperimentVariantConfig;
  /** 目标指标 */
  targetMetric: 'roas' | 'acos' | 'conversions' | 'revenue' | 'profit';
  /** 实验持续天数 */
  durationDays?: number;
  /** 流量分配比例（实验组占比，默认0.5） */
  trafficSplit?: number;
}

export interface ExperimentVariantConfig {
  /** 算法选择模式 */
  algorithmMode?: 'single' | 'cascade_ensemble';
  /** 融合阈值 */
  fusionThreshold?: number;
  /** 基础探索率 */
  baseExplorationRate?: number;
  /** 探索率范围 */
  explorationRange?: { min: number; max: number };
  /** 出价调整幅度 */
  bidAdjustmentFactor?: number;
  /** 其他自定义参数 */
  customParams?: Record<string, unknown>;
}

export interface ActiveExperiment {
  testId: number;
  experimentType: string;
  controlConfig: ExperimentVariantConfig;
  treatmentConfig: ExperimentVariantConfig;
  /** 控制组campaign IDs */
  controlCampaignIds: string[];
  /** 实验组campaign IDs */
  treatmentCampaignIds: string[];
}

// ==================== 内存缓存 ====================

/** 活跃实验缓存（避免每次出价决策都查数据库） */
let activeExperimentsCache: Map<number, ActiveExperiment[]> = new Map();
let cacheLastRefresh = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

// ==================== 核心集成函数 ====================

/**
 * 创建算法对比实验
 * 封装abTestService.createABTest，增加算法实验特定的配置
 */
export async function createAlgorithmExperiment(
  config: AlgorithmExperimentConfig,
  userId?: number
): Promise<{ testId: number; controlVariantId: number; treatmentVariantId: number }> {
  log.info(`[ABTestIntegration] 创建算法实验: ${config.name}, 类型: ${config.experimentType}`);
  
  const result = await abTestService.createABTest({
    accountId: config.accountId,
    performanceGroupId: config.performanceGroupId,
    testName: `[${config.experimentType}] ${config.name}`,
    testDescription: config.description || `v271 算法对比实验: ${config.experimentType}`,
    testType: 'bid_strategy',
    targetMetric: config.targetMetric,
    durationDays: config.durationDays || 14,
    controlConfig: config.controlConfig as Record<string, unknown>,
    treatmentConfig: config.treatmentConfig as Record<string, unknown>,
    trafficSplit: config.trafficSplit || 0.5,
  }, userId);

  // 清除缓存以加载新实验
  invalidateCache(config.accountId);
  
  log.info(`[ABTestIntegration] 实验创建成功: testId=${result.testId}`);
  return result;
}

/**
 * 获取campaign所属的实验组配置
 * 在出价决策时调用，判断该campaign应使用控制组还是实验组的算法配置
 * 
 * @returns 如果campaign在实验中，返回对应的配置；否则返回null（使用默认配置）
 */
export async function getExperimentConfigForCampaign(
  accountId: number,
  campaignId: string
): Promise<{ variantType: 'control' | 'treatment'; config: ExperimentVariantConfig; testId: number } | null> {
  const experiments = await getActiveExperiments(accountId);
  
  if (experiments.length === 0) return null;
  
  for (const exp of experiments) {
    if (exp.controlCampaignIds.includes(campaignId)) {
      return { variantType: 'control', config: exp.controlConfig, testId: exp.testId };
    }
    if (exp.treatmentCampaignIds.includes(campaignId)) {
      return { variantType: 'treatment', config: exp.treatmentConfig, testId: exp.testId };
    }
  }
  
  return null;
}

/**
 * 获取账户的活跃实验列表（带缓存）
 */
async function getActiveExperiments(accountId: number): Promise<ActiveExperiment[]> {
  const now = Date.now();
  
  // 检查缓存有效性
  if (activeExperimentsCache.has(accountId) && (now - cacheLastRefresh) < CACHE_TTL) {
    return activeExperimentsCache.get(accountId) || [];
  }
  
  // 从数据库加载
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    const tests = await db.select().from(abTests)
      .where(and(
        eq(abTests.accountId, accountId),
        eq(abTests.status, 'running')
      ));
    
    const experiments: ActiveExperiment[] = [];
    
    for (const test of tests) {
      // 获取变体配置
      const variants = await db.select().from(abTestVariants)
        .where(eq(abTestVariants.testId, test.id));
      
      const controlVariant = variants.find((v: Record<string, unknown>) => v.variantType === 'control');
      const treatmentVariant = variants.find((v: Record<string, unknown>) => v.variantType === 'treatment');
      
      if (!controlVariant || !treatmentVariant) continue;
      
      // 获取campaign分配
      const assignments = await db.select().from(abTestCampaignAssignments)
        .where(eq(abTestCampaignAssignments.testId, test.id));
      
      const controlCampaignIds = assignments
        .filter(a => a.variantId === controlVariant.id)
        .map(a => String(a.campaignId));
      const treatmentCampaignIds = assignments
        .filter(a => a.variantId === treatmentVariant.id)
        .map(a => String(a.campaignId));
      
      experiments.push({
        testId: test.id,
        experimentType: test.testType || 'bid_strategy',
        controlConfig: ((controlVariant as unknown).config as ExperimentVariantConfig) || {},
        treatmentConfig: ((treatmentVariant as unknown).config as ExperimentVariantConfig) || {},
        controlCampaignIds,
        treatmentCampaignIds,
      });
    }
    
    activeExperimentsCache.set(accountId, experiments);
    cacheLastRefresh = now;
    
    return experiments;
  } catch (error) {
    log.error(`[ABTestIntegration] 加载活跃实验失败:`, error);
    return [];
  }
}

/**
 * 记录实验组的每日指标
 * 由调度器在每日数据同步后调用
 */
export async function recordExperimentDailyMetrics(accountId: number): Promise<void> {
  const experiments = await getActiveExperiments(accountId);
  
  for (const exp of experiments) {
    try {
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      
      // 获取变体信息
      const variants = await db.select().from(abTestVariants)
        .where(eq(abTestVariants.testId, exp.testId));
      
      for (const variant of variants) {
        const campaignIds = variant.variantType === 'control' 
          ? exp.controlCampaignIds 
          : exp.treatmentCampaignIds;
        
        if (campaignIds.length === 0) continue;
        
        // 聚合该变体下所有campaign的当日表现
        const metricsQuery = await db.execute(sql`
          SELECT 
            COALESCE(SUM(impressions), 0) as impressions,
            COALESCE(SUM(clicks), 0) as clicks,
            COALESCE(SUM(spend), 0) as spend,
            COALESCE(SUM(sales), 0) as sales,
            COALESCE(SUM(orders), 0) as orders
          FROM daily_performance 
          WHERE campaign_id IN (${sql.join(campaignIds.map(id => sql`${id}`), sql`, `)})
            AND DATE(date) = CURDATE()
            AND account_id = ${accountId}
        `);
        
        const metrics = (metricsQuery as unknown)[0]?.[0] || { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
        
        await abTestService.recordDailyMetrics(
          exp.testId,
          variant.id,
          {
            impressions: Number(metrics.impressions),
            clicks: Number(metrics.clicks),
            spend: Number(metrics.spend),
            sales: Number(metrics.sales),
            conversions: Number(metrics.orders),
          }
        );
      }
      
      log.info(`[ABTestIntegration] 实验 ${exp.testId} 每日指标记录完成`);
    } catch (error) {
      log.error(`[ABTestIntegration] 实验 ${exp.testId} 指标记录失败:`, error);
    }
  }
}

/**
 * 检查并自动完成到期的实验
 * 由调度器定期调用
 */
export async function checkAndCompleteExpiredExperiments(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    const runningTests = await db.select().from(abTests)
      .where(eq(abTests.status, 'running'));
    
    let completedCount = 0;
    
    for (const test of runningTests) {
      if (test.endDate && new Date(test.endDate) <= new Date()) {
        await abTestService.completeABTest(test.id);
        
        // 自动分析结果
        try {
          const analysis = await abTestService.analyzeABTestResults(test.id);
          log.info(`[ABTestIntegration] 实验 ${test.id} (${test.testName}) 自动完成并分析: winner=${JSON.stringify(analysis)}`);
        } catch (analysisError) {
          log.warn(`[ABTestIntegration] 实验 ${test.id} 分析失败:`, analysisError);
        }
        
        completedCount++;
        invalidateCache(test.accountId);
      }
    }
    
    return completedCount;
  } catch (error) {
    log.error(`[ABTestIntegration] 检查到期实验失败:`, error);
    return 0;
  }
}

/**
 * 清除指定账户的实验缓存
 */
function invalidateCache(accountId: number): void {
  activeExperimentsCache.delete(accountId);
}

/**
 * 清除所有实验缓存
 */
export function invalidateAllCache(): void {
  activeExperimentsCache.clear();
  cacheLastRefresh = 0;
}

// ==================== 预置实验模板 ====================

/**
 * 快速创建 Cascade Ensemble vs Single 模式对比实验
 */
export async function createCascadeVsSingleExperiment(
  accountId: number,
  performanceGroupId?: number,
  userId?: number
): Promise<{ testId: number }> {
  const result = await createAlgorithmExperiment({
    name: 'Cascade Ensemble vs Single Mode',
    description: 'v271: 对比Cascade Ensemble融合模式与传统Single模式的ROAS/ACoS表现',
    accountId,
    performanceGroupId,
    experimentType: 'algorithm_strategy',
    controlConfig: {
      algorithmMode: 'single',
    },
    treatmentConfig: {
      algorithmMode: 'cascade_ensemble',
      fusionThreshold: 0.15,
    },
    targetMetric: 'roas',
    durationDays: 14,
    trafficSplit: 0.5,
  }, userId);
  
  return { testId: result.testId };
}

/**
 * 快速创建融合阈值对比实验
 */
export async function createFusionThresholdExperiment(
  accountId: number,
  controlThreshold: number,
  treatmentThreshold: number,
  performanceGroupId?: number,
  userId?: number
): Promise<{ testId: number }> {
  const result = await createAlgorithmExperiment({
    name: `Fusion Threshold ${controlThreshold * 100}% vs ${treatmentThreshold * 100}%`,
    description: `v271: 对比不同Cascade Ensemble融合阈值的效果`,
    accountId,
    performanceGroupId,
    experimentType: 'fusion_threshold',
    controlConfig: {
      algorithmMode: 'cascade_ensemble',
      fusionThreshold: controlThreshold,
    },
    treatmentConfig: {
      algorithmMode: 'cascade_ensemble',
      fusionThreshold: treatmentThreshold,
    },
    targetMetric: 'roas',
    durationDays: 14,
    trafficSplit: 0.5,
  }, userId);
  
  return { testId: result.testId };
}

/**
 * 快速创建探索率对比实验
 */
export async function createExplorationRateExperiment(
  accountId: number,
  controlRange: { min: number; max: number },
  treatmentRange: { min: number; max: number },
  performanceGroupId?: number,
  userId?: number
): Promise<{ testId: number }> {
  const result = await createAlgorithmExperiment({
    name: `Exploration Rate [${controlRange.min}-${controlRange.max}] vs [${treatmentRange.min}-${treatmentRange.max}]`,
    description: `v271: 对比不同探索率范围对算法学习效率的影响`,
    accountId,
    performanceGroupId,
    experimentType: 'exploration_rate',
    controlConfig: {
      explorationRange: controlRange,
    },
    treatmentConfig: {
      explorationRange: treatmentRange,
    },
    targetMetric: 'roas',
    durationDays: 21,
    trafficSplit: 0.5,
  }, userId);
  
  return { testId: result.testId };
}
