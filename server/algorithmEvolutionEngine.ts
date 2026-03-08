import { createModuleLogger } from "./utils/logger";
const log = createModuleLogger("EvolutionEngine");
/**
 * 算法自我进化引擎 (Algorithm Evolution Engine)
 * v152: 实现优化算法的自动迭代和自我改进
 * 
 * 核心职责：
 * 1. 自动效果评估：优化执行后，在7/14/30天自动追踪和评估效果
 * 2. 参数自适应调整：基于效果反馈，自动调整每个优化目标的算法参数
 * 3. 算法权重进化：根据各算法的历史表现，动态调整算法选择权重
 * 4. 策略进化调度：定期触发自我评估和参数迭代
 * 
 * 闭环流程：
 * 优化执行 → 效果追踪(7/14/30天) → 效果评估 → 参数自适应调整 → 下次优化使用新参数
 */

import { DbInstance, getDb } from './db';
import { optimizationEvents, performanceGroups } from '../drizzle/schema';
import { eq, and, gte, lte, ne, sql, desc, isNull, isNotNull } from 'drizzle-orm';

// ==================== 类型定义 ====================

/** 优化目标级别的算法参数（持久化到数据库） */
export interface TargetAlgorithmConfig {
  // 出价调整幅度限制
  maxBidIncreasePercent: number;   // 默认30，范围[10, 50]
  maxBidDecreasePercent: number;   // 默认20，范围[5, 40]
  minBidChangeThreshold: number;   // 最小变化阈值，默认0.01
  
  // 算法权重（0-1，总和为1）
  algorithmWeights: {
    time_decay: number;    // 时间衰减ROAS算法
    ucb: number;           // UCB探索-利用算法
    bayesian: number;      // 贝叶斯平滑算法
    market_curve: number;  // 市场曲线模型
  };
  
  // 风险控制
  explorationRate: number;         // UCB探索率，默认0.2，范围[0.05, 0.5]
  confidenceThreshold: number;     // 最低置信度阈值，默认0.3，范围[0.1, 0.8]
  cooldownHours: number;           // 同一目标冷却期，默认24
  
  // 进化元数据
  evolutionGeneration: number;     // 当前进化代数
  lastEvolutionAt: string | null;  // 上次进化时间
  totalEvolutionCycles: number;    // 总进化次数
  cumulativeImprovement: number;   // 累计改善率(%)
}

/** 效果评估结果 */
export interface EffectEvaluation {
  targetId: number;
  period: 7 | 14 | 30;
  evaluatedAt: string;
  
  // 统计数据
  totalEvents: number;
  successfulEvents: number;       // 产生正面效果的事件
  failedEvents: number;           // 产生负面效果的事件
  neutralEvents: number;          // 无显著变化的事件
  
  // 效果指标
  avgROASChange: number;          // 平均ROAS变化
  avgACoSChange: number;          // 平均ACoS变化
  avgProfitChange: number;        // 平均利润变化
  overallEffectScore: number;     // 综合效果分(-100到100)
  
  // 按算法分类的效果
  algorithmPerformance: {
    algorithm: string;
    count: number;
    avgEffectScore: number;
    successRate: number;
  }[];
  
  // 按调整幅度分类的效果
  rangePerformance: {
    range: string;                // 如 "0-10%", "10-20%", "20-30%"
    count: number;
    avgEffectScore: number;
    successRate: number;
  }[];
}

/** 参数调整决策 */
export interface ParameterAdjustment {
  parameter: string;
  previousValue: number;
  newValue: number;
  reason: string;
  confidence: number;
  basedOnEvents: number;
}

/** 进化周期报告 */
export interface EvolutionReport {
  targetId: number;
  targetName: string;
  generation: number;
  executedAt: string;
  
  // 评估结果
  evaluation: EffectEvaluation;
  
  // 参数调整
  adjustments: ParameterAdjustment[];
  
  // 预期改善
  expectedImprovement: number;
}

// ==================== 默认参数 ====================

export const DEFAULT_TARGET_ALGORITHM_CONFIG: TargetAlgorithmConfig = {
  maxBidIncreasePercent: 30,
  maxBidDecreasePercent: 20,
  minBidChangeThreshold: 0.01,
  algorithmWeights: {
    time_decay: 0.35,
    ucb: 0.25,
    bayesian: 0.20,
    market_curve: 0.20,
  },
  explorationRate: 0.20,
  confidenceThreshold: 0.30,
  cooldownHours: 24,
  evolutionGeneration: 0,
  lastEvolutionAt: null,
  totalEvolutionCycles: 0,
  cumulativeImprovement: 0,
};

// 参数安全边界
const PARAM_BOUNDS = {
  maxBidIncreasePercent: { min: 10, max: 50 },
  maxBidDecreasePercent: { min: 5, max: 40 },
  explorationRate: { min: 0.05, max: 0.50 },
  confidenceThreshold: { min: 0.10, max: 0.80 },
  cooldownHours: { min: 6, max: 72 },
};

// 进化学习率（控制参数调整的激进程度）
const LEARNING_RATE = 0.15;

// 最小样本量（低于此值不触发进化）
const MIN_EVENTS_FOR_EVOLUTION = 10;

// ==================== 1. 自动效果追踪 ====================

/**
 * 执行效果追踪任务
 * 查找需要追踪的优化事件，获取其后续效果数据并更新
 * 
 * 应在每次数据同步完成后自动调用
 */
export async function runEffectTracking(): Promise<{
  tracked7d: number;
  tracked14d: number;
  tracked30d: number;
}> {
  log.info('[EvolutionEngine] 开始效果追踪...');
  
  const tracked7d = await trackEffectsForPeriod(7);
  const tracked14d = await trackEffectsForPeriod(14);
  const tracked30d = await trackEffectsForPeriod(30);
  
  log.info(`[EvolutionEngine] 效果追踪完成: 7d=${tracked7d}, 14d=${tracked14d}, 30d=${tracked30d}`);
  
  return { tracked7d, tracked14d, tracked30d };
}

/**
 * 追踪指定周期的效果
 */
async function trackEffectsForPeriod(period: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const now = new Date();
  // 查找 period 天前的优化事件（已成功执行但尚未追踪该周期效果的）
  const targetDate = new Date(now.getTime() - period * 24 * 60 * 60 * 1000);
  // 给1天的缓冲期
  const bufferStart = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000);
  const bufferEnd = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  
  const startStr = bufferStart.toISOString().slice(0, 19).replace('T', ' ');
  const endStr = bufferEnd.toISOString().slice(0, 19).replace('T', ' ');
  
  // 确定追踪字段
  let trackingField: string;
  if (period === 7) trackingField = 'actual_profit_7d';
  else if (period === 14) trackingField = 'actual_profit_14d';
  else trackingField = 'actual_profit_30d';
  
  try {
    const events = await db.select()
      .from(optimizationEvents)
      .where(and(
        eq(optimizationEvents.eventCategory, 'bid_adjustment'),
        ne(optimizationEvents.status, 'rolled_back'),
        eq(optimizationEvents.apiSyncStatus, 'synced'),
        gte(optimizationEvents.createdAt, startStr),
        lte(optimizationEvents.createdAt, endStr),
        sql`${sql.raw(trackingField)} IS NULL`,
      ))
      .limit(200); // 每次最多处理200个
    
    let processed = 0;
    
    for (const event of events) {
      try {
        const eventDate = new Date(event.createdAt);
        const endDate = new Date(eventDate.getTime() + period * 24 * 60 * 60 * 1000);
        
        // 获取效果数据
        const perfData = await getEventPerformanceData(db, event, eventDate, endDate);
        if (!perfData) continue;
        
        // 计算效果分数
        const effectScore = calculateEffectScore(event, perfData, period);
        
        // 更新追踪数据
        const updateData: Record<string, any> = {
          trackingUpdatedAt: now.toISOString().slice(0, 19).replace('T', ' '),
        };
        
        if (period === 7) {
          updateData.actualProfit7D = (perfData.sales - perfData.spend).toFixed(2);
          updateData.actualSpend7D = perfData.spend.toFixed(2);
          updateData.actualRevenue7D = perfData.sales.toFixed(2);
          updateData.actualImpressions7D = perfData.impressions;
          updateData.actualClicks7D = perfData.clicks;
          updateData.actualConversions7D = perfData.orders;
        } else if (period === 14) {
          updateData.actualProfit14D = (perfData.sales - perfData.spend).toFixed(2);
        } else {
          updateData.actualProfit30D = (perfData.sales - perfData.spend).toFixed(2);
        }
        
        await db.update(optimizationEvents)
          .set(updateData)
          .where(eq(optimizationEvents.id, event.id));
        
        processed++;
      } catch (error: unknown) {
        log.error(`[EvolutionEngine] 追踪事件 ${event.id} 失败:`, (error as Error).message);
      }
    }
    
    return processed;
  } catch (error: unknown) {
    log.error(`[EvolutionEngine] ${period}天效果追踪失败:`, (error as Error).message);
    return 0;
  }
}

/**
 * 获取优化事件后续的效果数据
 */
async function getEventPerformanceData(
  db: DbInstance,
  event: Record<string, any>,
  startDate: Date,
  endDate: Date
): Promise<{ spend: number; sales: number; impressions: number; clicks: number; orders: number } | null> {
  try {
    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);
    
    // 根据事件类型获取对应的效果数据
    let result: Record<string, any>;
    
    if (event.keywordId) {
      // 关键词级别：从keywords表获取聚合数据
      const { keywords } = await import('../drizzle/schema');
      // @ts-ignore
      const kwData = await db.select()
        .from(keywords)
        .where(eq(keywords.id, event.keywordId))
        .limit(1);
      
      if (kwData.length > 0) {
        const kw = kwData[0] as any;
        result = {
          spend: parseFloat(kw.spend || '0'),
          sales: parseFloat(kw.sales || '0'),
          impressions: kw.impressions || 0,
          clicks: kw.clicks || 0,
          orders: kw.orders || 0,
        };
      }
    } else if (event.campaignId) {
      // 广告活动级别
      const { campaigns } = await import('../drizzle/schema');
      // @ts-ignore
      const campData = await db.select()
        .from(campaigns)
        .where(eq(campaigns.id, event.campaignId))
        .limit(1);
      
      if (campData.length > 0) {
        const camp = campData[0] as any;
        result = {
          spend: parseFloat(camp.spend || '0'),
          sales: parseFloat(camp.sales || '0'),
          impressions: camp.impressions || 0,
          clicks: camp.clicks || 0,
          orders: camp.orders || 0,
        };
      }
    }
    
    // @ts-ignore
    return result || null;
  } catch (error: unknown) {
    log.error(`[EvolutionEngine] 获取事件 ${event.id} 效果数据失败:`, (error as Error).message);
    return null;
  }
}

/**
 * 计算优化效果分数 (-100 到 100)
 */
function calculateEffectScore(
  event: Record<string, any>,
  perfData: { spend: number; sales: number; impressions: number; clicks: number; orders: number },
  period: number
): number {
  const previousBid = parseFloat(event.previousBid || '0');
  const newBid = parseFloat(event.newBid || '0');
  
  if (previousBid <= 0 || newBid <= 0) return 0;
  
  const bidDirection = newBid > previousBid ? 'increase' : 'decrease';
  const roas = perfData.spend > 0 ? perfData.sales / perfData.spend : 0;
  const acos = perfData.sales > 0 ? (perfData.spend / perfData.sales) * 100 : 100;
  
  let score = 0;
  
  if (bidDirection === 'increase') {
    // 提价后：期望ROAS保持或提升，曝光/点击增加
    if (roas >= 3) score += 30;
    else if (roas >= 2) score += 15;
    else if (roas >= 1) score += 0;
    else score -= 20;
    
    if (perfData.impressions > 100) score += 10;
    if (perfData.clicks > 5) score += 10;
    if (perfData.orders > 0) score += 20;
  } else {
    // 降价后：期望ACoS降低，利润率提升
    if (acos < 30) score += 30;
    else if (acos < 50) score += 15;
    else if (acos < 80) score += 0;
    else score -= 15;
    
    // 降价后仍有转化是好的
    if (perfData.orders > 0) score += 20;
    if (perfData.sales > perfData.spend) score += 20;
  }
  
  // 利润维度
  const profit = perfData.sales - perfData.spend;
  if (profit > 0) score += 10;
  else score -= 10;
  
  return Math.max(-100, Math.min(100, score));
}

// ==================== 2. 效果评估引擎 ====================

/**
 * 评估指定优化目标在指定周期内的优化效果
 */
export async function evaluateTargetPerformance(
  targetId: number,
  period: 7 | 14 | 30 = 14
): Promise<EffectEvaluation | null> {
  const db = await getDb();
  if (!db) return null;
  
  const now = new Date();
  const startDate = new Date(now.getTime() - period * 24 * 60 * 60 * 1000);
  const startStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
  
  try {
    // 获取该优化目标在周期内的所有已同步出价调整事件
    const events = await db.select()
      .from(optimizationEvents)
      .where(and(
        eq(optimizationEvents.performanceGroupId, targetId),
        eq(optimizationEvents.eventCategory, 'bid_adjustment'),
        eq(optimizationEvents.apiSyncStatus, 'synced'),
        ne(optimizationEvents.status, 'rolled_back'),
        gte(optimizationEvents.createdAt, startStr),
      ));
    
    if (events.length === 0) {
      return null;
    }
    
    // 分析每个事件的效果
    let successfulEvents = 0;
    let failedEvents = 0;
    let neutralEvents = 0;
    let totalROASChange = 0;
    let totalACoSChange = 0;
    let totalProfitChange = 0;
    let totalEffectScore = 0;
    
    const algorithmMap = new Map<string, { count: number; totalScore: number; successCount: number }>();
    const rangeMap = new Map<string, { count: number; totalScore: number; successCount: number }>();
    
    for (const event of events) {
      const previousBid = parseFloat(event.previousBid || '0');
      const newBid = parseFloat(event.newBid || '0');
      const profit7d = event.actualProfit7D ? parseFloat(event.actualProfit7D) : null;
      const expectedProfit = event.expectedProfitIncrease ? parseFloat(event.expectedProfitIncrease) : 0;
      
      // 计算效果分数
      let effectScore = 0;
      if (profit7d !== null) {
        // 有追踪数据：基于实际利润评估
        if (profit7d > 0) {
          effectScore = Math.min(100, profit7d * 10);
          successfulEvents++;
        } else if (profit7d < -5) {
          effectScore = Math.max(-100, profit7d * 5);
          failedEvents++;
        } else {
          effectScore = 0;
          neutralEvents++;
        }
        totalProfitChange += profit7d;
      } else {
        // 无追踪数据：基于事件状态判断
        if (event.status === 'success') {
          effectScore = 10;
          neutralEvents++;
        } else {
          effectScore = -10;
          failedEvents++;
        }
      }
      
      totalEffectScore += effectScore;
      
      // 按算法分类统计
      const algo = (event.performanceData as Record<string, any>)?.algorithmUsed || 'unknown';
      const algoStats = algorithmMap.get(algo) || { count: 0, totalScore: 0, successCount: 0 };
      algoStats.count++;
      algoStats.totalScore += effectScore;
      if (effectScore > 0) algoStats.successCount++;
      algorithmMap.set(algo, algoStats);
      
      // 按调整幅度分类统计
      if (previousBid > 0) {
        const changePercent = Math.abs((newBid - previousBid) / previousBid * 100);
        let range: string;
        if (changePercent < 5) range = '0-5%';
        else if (changePercent < 10) range = '5-10%';
        else if (changePercent < 20) range = '10-20%';
        else if (changePercent < 30) range = '20-30%';
        else range = '30%+';
        
        const rangeStats = rangeMap.get(range) || { count: 0, totalScore: 0, successCount: 0 };
        rangeStats.count++;
        rangeStats.totalScore += effectScore;
        if (effectScore > 0) rangeStats.successCount++;
        rangeMap.set(range, rangeStats);
      }
    }
    
    const evaluation: EffectEvaluation = {
      targetId,
      period,
      evaluatedAt: now.toISOString(),
      totalEvents: events.length,
      successfulEvents,
      failedEvents,
      neutralEvents,
      avgROASChange: totalROASChange / events.length,
      avgACoSChange: totalACoSChange / events.length,
      avgProfitChange: totalProfitChange / events.length,
      overallEffectScore: totalEffectScore / events.length,
      algorithmPerformance: Array.from(algorithmMap.entries()).map(([algo, stats]) => ({
        algorithm: algo,
        count: stats.count,
        avgEffectScore: stats.count > 0 ? stats.totalScore / stats.count : 0,
        successRate: stats.count > 0 ? (stats.successCount / stats.count) * 100 : 0,
      })),
      rangePerformance: Array.from(rangeMap.entries()).map(([range, stats]) => ({
        range,
        count: stats.count,
        avgEffectScore: stats.count > 0 ? stats.totalScore / stats.count : 0,
        successRate: stats.count > 0 ? (stats.successCount / stats.count) * 100 : 0,
      })),
    };
    
    return evaluation;
  } catch (error: unknown) {
    log.error(`[EvolutionEngine] 评估优化目标 ${targetId} 效果失败:`, (error as Error).message);
    return null;
  }
}

// ==================== 3. 参数自适应调整引擎 ====================

/**
 * 获取优化目标的算法配置（从数据库或使用默认值）
 */
export async function getTargetAlgorithmConfig(targetId: number): Promise<TargetAlgorithmConfig> {
  const db = await getDb();
  if (!db) return { ...DEFAULT_TARGET_ALGORITHM_CONFIG };
  
  try {
    const groups = await db.select()
      .from(performanceGroups)
      .where(eq(performanceGroups.id, targetId))
      .limit(1);
    
    if (groups.length > 0) {
      const group = groups[0] as any;
      // 尝试从performanceData JSON字段读取（如果有的话）
      // 目前使用默认配置，后续可以扩展到数据库持久化
      // @ts-ignore
      const storedConfig = (group as unknown).algorithmConfig;
      if (storedConfig && typeof storedConfig === 'object') {
        return { ...DEFAULT_TARGET_ALGORITHM_CONFIG, ...storedConfig };
      }
    }
  } catch (error: unknown) {
    log.error(`[EvolutionEngine] 获取目标 ${targetId} 算法配置失败:`, (error as Error).message);
  }
  
  return { ...DEFAULT_TARGET_ALGORITHM_CONFIG };
}

/**
 * 基于效果评估结果，自动调整算法参数
 * 
 * 核心进化规则：
 * 1. 出价幅度调整：如果大幅调整效果差，缩小幅度；如果小幅调整效果好，可以适度扩大
 * 2. 算法权重调整：表现好的算法增加权重，表现差的减少权重
 * 3. 探索率调整：数据充足且效果稳定时降低探索率，反之提高
 * 4. 置信度阈值：准确率低时提高阈值，减少低质量调整
 */
export function calculateParameterAdjustments(
  currentConfig: TargetAlgorithmConfig,
  evaluation: EffectEvaluation
): ParameterAdjustment[] {
  const adjustments: ParameterAdjustment[] = [];
  
  if (evaluation.totalEvents < MIN_EVENTS_FOR_EVOLUTION) {
    log.info(`[EvolutionEngine] 事件数不足(${evaluation.totalEvents}/${MIN_EVENTS_FOR_EVOLUTION})，跳过参数调整`);
    return adjustments;
  }
  
  const successRate = evaluation.totalEvents > 0
    ? (evaluation.successfulEvents / evaluation.totalEvents) * 100
    : 0;
  
  // ===== 规则1: 出价幅度调整 =====
  
  // 分析大幅调整的效果
  const largeRange = evaluation.rangePerformance.find(r => r.range === '20-30%' || r.range === '30%+');
  const smallRange = evaluation.rangePerformance.find(r => r.range === '0-5%' || r.range === '5-10%');
  
  if (largeRange && largeRange.count >= 3 && largeRange.successRate < 40) {
    // 大幅调整效果差 → 缩小最大调整幅度
    const reduction = LEARNING_RATE * (50 - largeRange.successRate) / 50;
    const newMaxIncrease = clamp(
      currentConfig.maxBidIncreasePercent * (1 - reduction),
      PARAM_BOUNDS.maxBidIncreasePercent.min,
      PARAM_BOUNDS.maxBidIncreasePercent.max
    );
    const newMaxDecrease = clamp(
      currentConfig.maxBidDecreasePercent * (1 - reduction * 0.7),
      PARAM_BOUNDS.maxBidDecreasePercent.min,
      PARAM_BOUNDS.maxBidDecreasePercent.max
    );
    
    if (Math.abs(newMaxIncrease - currentConfig.maxBidIncreasePercent) > 1) {
      adjustments.push({
        parameter: 'maxBidIncreasePercent',
        previousValue: currentConfig.maxBidIncreasePercent,
        newValue: Math.round(newMaxIncrease),
        reason: `大幅调整(${largeRange.range})成功率仅${largeRange.successRate.toFixed(0)}%，缩小提价幅度`,
        confidence: Math.min(90, largeRange.count * 10),
        basedOnEvents: largeRange.count,
      });
    }
    if (Math.abs(newMaxDecrease - currentConfig.maxBidDecreasePercent) > 1) {
      adjustments.push({
        parameter: 'maxBidDecreasePercent',
        previousValue: currentConfig.maxBidDecreasePercent,
        newValue: Math.round(newMaxDecrease),
        reason: `大幅调整效果不佳，同步缩小降价幅度`,
        confidence: Math.min(85, largeRange.count * 8),
        basedOnEvents: largeRange.count,
      });
    }
  } else if (smallRange && smallRange.count >= 5 && smallRange.successRate > 70 && successRate > 60) {
    // 小幅调整效果好且整体成功率高 → 可以适度扩大幅度
    const expansion = LEARNING_RATE * (smallRange.successRate - 70) / 100;
    const newMaxIncrease = clamp(
      currentConfig.maxBidIncreasePercent * (1 + expansion),
      PARAM_BOUNDS.maxBidIncreasePercent.min,
      PARAM_BOUNDS.maxBidIncreasePercent.max
    );
    
    if (newMaxIncrease - currentConfig.maxBidIncreasePercent > 1) {
      adjustments.push({
        parameter: 'maxBidIncreasePercent',
        previousValue: currentConfig.maxBidIncreasePercent,
        newValue: Math.round(newMaxIncrease),
        reason: `小幅调整成功率${smallRange.successRate.toFixed(0)}%，整体成功率${successRate.toFixed(0)}%，适度扩大幅度`,
        confidence: Math.min(80, smallRange.count * 5),
        basedOnEvents: smallRange.count,
      });
    }
  }
  
  // ===== 规则2: 算法权重调整 =====
  
  if (evaluation.algorithmPerformance.length >= 2) {
    const totalAlgoEvents = evaluation.algorithmPerformance.reduce((sum: any, a: any) => sum + a.count, 0);
    
    if (totalAlgoEvents >= MIN_EVENTS_FOR_EVOLUTION) {
      const newWeights = { ...currentConfig.algorithmWeights };
      let weightsChanged = false;
      
      for (const algoPerf of evaluation.algorithmPerformance) {
        const algoKey = algoPerf.algorithm as keyof typeof newWeights;
        if (!(algoKey in newWeights)) continue;
        
        const currentWeight = newWeights[algoKey];
        
        // 基于效果分数调整权重
        // 效果分 > 20 → 增加权重；效果分 < -10 → 减少权重
        if (algoPerf.avgEffectScore > 20 && algoPerf.count >= 3) {
          const increase = LEARNING_RATE * (algoPerf.avgEffectScore / 100) * 0.5;
          newWeights[algoKey] = Math.min(0.60, currentWeight + increase);
          weightsChanged = true;
        } else if (algoPerf.avgEffectScore < -10 && algoPerf.count >= 3) {
          const decrease = LEARNING_RATE * Math.abs(algoPerf.avgEffectScore / 100) * 0.5;
          newWeights[algoKey] = Math.max(0.05, currentWeight - decrease);
          weightsChanged = true;
        }
      }
      
      if (weightsChanged) {
        // 归一化权重使总和为1
        const totalWeight = Object.values(newWeights).reduce((sum: any, w: any) => sum + w, 0);
        for (const key of Object.keys(newWeights) as Array<keyof typeof newWeights>) {
          newWeights[key] = newWeights[key] / totalWeight;
        }
        
        adjustments.push({
          parameter: 'algorithmWeights',
          previousValue: 0, // 用JSON表示
          newValue: 0,
          reason: `基于${totalAlgoEvents}次优化效果，调整算法权重: ` +
            Object.entries(newWeights).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(', '),
          confidence: Math.min(85, totalAlgoEvents * 3),
          basedOnEvents: totalAlgoEvents,
        });
        
        // 存储实际的新权重值（通过特殊编码）
        // @ts-ignore
        (adjustments[adjustments.length - 1] as unknown)._newWeights = newWeights;
      }
    }
  }
  
  // ===== 规则3: 探索率调整 =====
  
  if (evaluation.totalEvents >= 20) {
    if (successRate > 65 && evaluation.overallEffectScore > 15) {
      // 效果稳定且良好 → 降低探索率，更多利用已验证的策略
      const newExplorationRate = clamp(
        currentConfig.explorationRate * (1 - LEARNING_RATE),
        PARAM_BOUNDS.explorationRate.min,
        PARAM_BOUNDS.explorationRate.max
      );
      
      if (Math.abs(newExplorationRate - currentConfig.explorationRate) > 0.01) {
        adjustments.push({
          parameter: 'explorationRate',
          previousValue: currentConfig.explorationRate,
          newValue: parseFloat(newExplorationRate.toFixed(3)),
          reason: `成功率${successRate.toFixed(0)}%，效果分${evaluation.overallEffectScore.toFixed(0)}，降低探索率以利用已验证策略`,
          confidence: 75,
          basedOnEvents: evaluation.totalEvents,
        });
      }
    } else if (successRate < 45) {
      // 效果不佳 → 提高探索率，尝试更多策略
      const newExplorationRate = clamp(
        currentConfig.explorationRate * (1 + LEARNING_RATE),
        PARAM_BOUNDS.explorationRate.min,
        PARAM_BOUNDS.explorationRate.max
      );
      
      if (Math.abs(newExplorationRate - currentConfig.explorationRate) > 0.01) {
        adjustments.push({
          parameter: 'explorationRate',
          previousValue: currentConfig.explorationRate,
          newValue: parseFloat(newExplorationRate.toFixed(3)),
          reason: `成功率仅${successRate.toFixed(0)}%，提高探索率以发现更优策略`,
          confidence: 70,
          basedOnEvents: evaluation.totalEvents,
        });
      }
    }
  }
  
  // ===== 规则4: 置信度阈值调整 =====
  
  if (evaluation.totalEvents >= 15) {
    if (successRate < 40 && evaluation.overallEffectScore < -5) {
      // 效果很差 → 提高置信度阈值，只执行高置信度的调整
      const newThreshold = clamp(
        currentConfig.confidenceThreshold + LEARNING_RATE * 0.5,
        PARAM_BOUNDS.confidenceThreshold.min,
        PARAM_BOUNDS.confidenceThreshold.max
      );
      
      if (newThreshold - currentConfig.confidenceThreshold > 0.02) {
        adjustments.push({
          parameter: 'confidenceThreshold',
          previousValue: currentConfig.confidenceThreshold,
          newValue: parseFloat(newThreshold.toFixed(2)),
          reason: `成功率${successRate.toFixed(0)}%，效果分${evaluation.overallEffectScore.toFixed(0)}，提高置信度阈值减少低质量调整`,
          confidence: 80,
          basedOnEvents: evaluation.totalEvents,
        });
      }
    } else if (successRate > 70 && currentConfig.confidenceThreshold > 0.4) {
      // 效果很好 → 可以适度降低阈值，允许更多调整
      const newThreshold = clamp(
        currentConfig.confidenceThreshold - LEARNING_RATE * 0.3,
        PARAM_BOUNDS.confidenceThreshold.min,
        PARAM_BOUNDS.confidenceThreshold.max
      );
      
      if (currentConfig.confidenceThreshold - newThreshold > 0.02) {
        adjustments.push({
          parameter: 'confidenceThreshold',
          previousValue: currentConfig.confidenceThreshold,
          newValue: parseFloat(newThreshold.toFixed(2)),
          reason: `成功率${successRate.toFixed(0)}%表现优秀，适度降低阈值允许更多优化`,
          confidence: 70,
          basedOnEvents: evaluation.totalEvents,
        });
      }
    }
  }
  
  return adjustments;
}

/**
 * 应用参数调整到优化目标配置
 */
export function applyAdjustments(
  config: TargetAlgorithmConfig,
  adjustments: ParameterAdjustment[]
): TargetAlgorithmConfig {
  const newConfig = { ...config };
  
  for (const adj of adjustments) {
    switch (adj.parameter) {
      case 'maxBidIncreasePercent':
        newConfig.maxBidIncreasePercent = adj.newValue;
        break;
      case 'maxBidDecreasePercent':
        newConfig.maxBidDecreasePercent = adj.newValue;
        break;
      case 'explorationRate':
        newConfig.explorationRate = adj.newValue;
        break;
      case 'confidenceThreshold':
        newConfig.confidenceThreshold = adj.newValue;
        break;
      case 'algorithmWeights':
        // @ts-ignore
        if ((adj as unknown)._newWeights) {
          // @ts-ignore
          newConfig.algorithmWeights = (adj as unknown)._newWeights;
        }
        break;
    }
  }
  
  // 更新进化元数据
  newConfig.evolutionGeneration++;
  newConfig.lastEvolutionAt = new Date().toISOString();
  newConfig.totalEvolutionCycles++;
  
  return newConfig;
}

// ==================== 4. 策略进化调度器 ====================

/**
 * 执行完整的进化周期
 * 
 * 对指定优化目标执行：效果评估 → 参数调整 → 配置更新 → 记录日志
 */
export async function runEvolutionCycle(targetId: number): Promise<EvolutionReport | null> {
  log.info(`[EvolutionEngine] 开始进化周期: targetId=${targetId}`);
  
  const db = await getDb();
  if (!db) return null;
  
  try {
    // 1. 获取优化目标信息
    const groups = await db.select()
      .from(performanceGroups)
      .where(eq(performanceGroups.id, targetId))
      .limit(1);
    
    if (groups.length === 0) {
      log.info(`[EvolutionEngine] 优化目标 ${targetId} 不存在`);
      return null;
    }
    
    const group = groups[0] as any;
    
    // 2. 获取当前算法配置
    const currentConfig = await getTargetAlgorithmConfig(targetId);
    
    // 3. 执行效果评估（使用14天窗口）
    const evaluation = await evaluateTargetPerformance(targetId, 14);
    
    if (!evaluation) {
      log.info(`[EvolutionEngine] 优化目标 ${targetId} 无足够数据进行评估`);
      return null;
    }
    
    // 4. 计算参数调整
    const adjustments = calculateParameterAdjustments(currentConfig, evaluation);
    
    // 5. 应用调整
    let newConfig = currentConfig;
    if (adjustments.length > 0) {
      newConfig = applyAdjustments(currentConfig, adjustments);
      
      // 6. 持久化新配置（记录到optimization_events表）
      await db.insert(optimizationEvents).values({
        performanceGroupId: targetId,
        performanceGroupName: group.name,
        accountId: group.accountId,
        eventCategory: 'settings_change',
        actionType: 'settings_update',
        changeReason: `算法进化第${newConfig.evolutionGeneration}代: ${adjustments.map(a => a.reason).join('; ')}`,
        previousValue: JSON.stringify(currentConfig),
        newValue: JSON.stringify(newConfig),
        status: 'success',
        apiSyncStatus: 'not_applicable',
        performanceData: JSON.stringify({
          type: 'algorithm_evolution',
          generation: newConfig.evolutionGeneration,
          evaluation: {
            totalEvents: evaluation.totalEvents,
            successRate: evaluation.totalEvents > 0 ? (evaluation.successfulEvents / evaluation.totalEvents * 100) : 0,
            overallEffectScore: evaluation.overallEffectScore,
          },
          adjustments: adjustments.map(a => ({
            parameter: a.parameter,
            previousValue: a.previousValue,
            newValue: a.newValue,
            reason: a.reason,
          })),
        }),
        createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
      
      log.info(`[EvolutionEngine] 优化目标 ${group.name} 完成第${newConfig.evolutionGeneration}代进化，` +
        `${adjustments.length}项参数调整`);
    } else {
      log.info(`[EvolutionEngine] 优化目标 ${group.name} 当前参数表现良好，无需调整`);
    }
    
    // 7. 生成进化报告
    const report: EvolutionReport = {
      targetId,
      targetName: group.name,
      generation: newConfig.evolutionGeneration,
      executedAt: new Date().toISOString(),
      evaluation,
      adjustments,
      expectedImprovement: adjustments.length > 0
        ? adjustments.reduce((sum: any, a: any) => sum + a.confidence, 0) / adjustments.length * 0.1
        : 0,
    };
    
    return report;
  } catch (error: unknown) {
    log.error(`[EvolutionEngine] 进化周期执行失败 (targetId=${targetId}):`, (error as Error).message);
    return null;
  }
}

/**
 * 对所有活跃优化目标执行进化周期
 * 
 * 应在每天数据同步完成后自动调用
 */
export async function runGlobalEvolution(): Promise<{
  totalTargets: number;
  evolvedTargets: number;
  skippedTargets: number;
  reports: EvolutionReport[];
}> {
  log.info('[EvolutionEngine] ========== 开始全局进化周期 ==========');
  
  const db = await getDb();
  if (!db) return { totalTargets: 0, evolvedTargets: 0, skippedTargets: 0, reports: [] };
  
  const result = {
    totalTargets: 0,
    evolvedTargets: 0,
    skippedTargets: 0,
    reports: [] as EvolutionReport[],
  };
  
  try {
    // 获取所有活跃的优化目标
    const activeTargets = await db.select({
      id: performanceGroups.id,
      name: performanceGroups.name,
    })
      .from(performanceGroups)
      .where(eq(performanceGroups.status, 'active'));
    
    result.totalTargets = activeTargets.length;
    
    for (const target of activeTargets) {
      try {
        const report = await runEvolutionCycle(target.id);
        
        if (report) {
          result.evolvedTargets++;
          result.reports.push(report);
        } else {
          result.skippedTargets++;
        }
      } catch (error: unknown) {
        log.error(`[EvolutionEngine] 目标 ${target.name} 进化失败:`, (error as Error).message);
        result.skippedTargets++;
      }
    }
    
    log.info(`[EvolutionEngine] 全局进化完成: ` +
      `总目标=${result.totalTargets}, 已进化=${result.evolvedTargets}, 跳过=${result.skippedTargets}`);
    
  } catch (error: unknown) {
    log.error('[EvolutionEngine] 全局进化失败:', (error as Error).message);
  }
  
  return result;
}

// ==================== 5. 与现有优化引擎的集成接口 ====================

/**
 * 获取优化目标的有效算法参数（供bidOptimizer使用）
 * 
 * 这是进化引擎与出价优化器的桥梁：
 * - 读取经过进化调整的参数
 * - 转换为bidOptimizer可以使用的格式
 */
export async function getEffectiveBidConfig(targetId: number): Promise<{
  maxChangePercent: number;
  explorationRate: number;
  confidenceThreshold: number;
  algorithmWeights: TargetAlgorithmConfig['algorithmWeights'];
}> {
  const config = await getTargetAlgorithmConfig(targetId);
  
  return {
    maxChangePercent: config.maxBidIncreasePercent / 100,
    explorationRate: config.explorationRate,
    confidenceThreshold: config.confidenceThreshold,
    algorithmWeights: config.algorithmWeights,
  };
}

/**
 * 在优化执行完成后记录算法使用信息（供后续效果追踪使用）
 */
export async function recordAlgorithmUsage(
  eventId: number,
  algorithmUsed: string,
  confidenceScore: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  try {
    await db.update(optimizationEvents)
      .set({
        algorithmVersion: `v152_${algorithmUsed}`,
        optimizationScore: Math.round(confidenceScore * 100),
      })
      .where(eq(optimizationEvents.id, eventId));
  } catch (error: unknown) {
    log.error(`[EvolutionEngine] 记录算法使用信息失败:`, (error as Error).message);
  }
}

// ==================== 辅助函数 ====================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
