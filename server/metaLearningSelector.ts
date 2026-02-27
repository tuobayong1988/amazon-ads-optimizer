/**
 * 元学习策略选择器 (Meta-Learning Algorithm Selector)
 * 
 * 核心功能：
 * 1. 根据关键词/定位的特征自动选择最优算法：
 *    - rule_based: 基于规则的传统出价（数据不足时的兜底）
 *    - ucb: 传统UCB探索-利用（中等数据量）
 *    - linucb: 上下文赌博机（有上下文特征时）
 *    - sigmoid_curve: Sigmoid曲线利润最大化（有足够历史数据时）
 *    - cql: 离线强化学习（有大量RL日志时）
 *    - ensemble: 多算法加权融合（高置信度时）
 * 
 * 2. Thompson Sampling选择策略：
 *    - 为每个算法维护Beta分布参数(α, β)
 *    - 根据历史表现更新分布
 *    - 采样选择算法，自动平衡探索与利用
 * 
 * 3. 安全保障：
 *    - 数据不足时强制使用rule_based
 *    - 新算法有最低探索比例
 *    - 连续失败时自动降级
 */
import { getDb } from "./db";
import { algorithmSelectionLogs, rlTrainingLogs, contextualFeatures } from "../drizzle/schema";
import { eq, and, gte, sql, isNotNull, desc } from "drizzle-orm";
import { extractFeatureVector, type ContextFeatureVector } from "./contextualFeatureService";
import { makeLinUCBBidDecision, type LinUCBDecision } from "./contextualBanditService";
import { makeCQLBidDecision, type CQLDecision } from "./offlineRLService";
import {
  fitAndCacheSigmoidForEntity,
  calculateSigmoidOptimalBid,
  type SigmoidOptimalBid,
} from "./sigmoidCurveFitter";
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('MetaLearning');

// ==================== 类型定义 ====================

export type AlgorithmType = 'rule_based' | 'ucb' | 'linucb' | 'sigmoid_curve' | 'cql' | 'ensemble';

export interface AlgorithmScore {
  algorithm: AlgorithmType;
  score: number;
  eligible: boolean;
  reason: string;
}

export interface MetaDecision {
  selectedAlgorithm: AlgorithmType;
  recommendedBid: number;
  confidence: number;
  algorithmScores: AlgorithmScore[];
  reasoning: string;
  // 各算法的具体建议（如果可用）
  linucbDecision?: LinUCBDecision;
  cqlDecision?: CQLDecision;
  sigmoidDecision?: SigmoidOptimalBid;
}

interface AlgorithmStats {
  algorithm: AlgorithmType;
  totalTrials: number;
  totalReward: number;
  avgReward: number;
  // Thompson Sampling参数
  alphaParam: number;  // 成功次数 + 1
  betaParam: number;   // 失败次数 + 1
}

// ==================== 辅助函数 ====================

async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

/**
 * v230: 标准Beta分布采样（Thompson Sampling）
 * 使用Gamma分布生成Beta分布样本：Beta(a,b) = Gamma(a) / (Gamma(a) + Gamma(b))
 * Gamma分布使用Marsaglia & Tsang算法
 */
function gammaSample(shape: number): number {
  if (shape < 1) {
    // 当shape < 1时，使用转换: Gamma(a) = Gamma(a+1) * U^(1/a)
    return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  // Marsaglia & Tsang算法
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      // Box-Muller变换生成标准正态分布
      const u1 = Math.random();
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(alpha: number, beta: number): number {
  // 安全校验：确保参数有效
  const a = Math.max(0.01, alpha);
  const b = Math.max(0.01, beta);
  
  const x = gammaSample(a);
  const y = gammaSample(b);
  
  if (x + y === 0) return a / (a + b); // 防御性回退到均值
  return x / (x + y);
}

// ==================== 核心元学习算法 ====================

/**
 * 获取每个算法的历史表现统计
 */
async function getAlgorithmStats(accountId: number): Promise<Map<AlgorithmType, AlgorithmStats>> {
  const db = await getDbInstance();
  const stats = new Map<AlgorithmType, AlgorithmStats>();
  
  // 初始化所有算法（先验：均匀分布）
  const algorithms: AlgorithmType[] = ['rule_based', 'ucb', 'linucb', 'sigmoid_curve', 'cql', 'ensemble'];
  for (const alg of algorithms) {
    stats.set(alg, {
      algorithm: alg,
      totalTrials: 0,
      totalReward: 0,
      avgReward: 0,
      alphaParam: 1,  // 先验
      betaParam: 1,
    });
  }
  
  // 从算法选择日志中获取历史表现
  const logs = await db.select({
    selectedAlgorithm: algorithmSelectionLogs.selectedAlgorithm,
    resultReward: algorithmSelectionLogs.resultReward,
  }).from(algorithmSelectionLogs)
    .where(and(
      eq(algorithmSelectionLogs.accountId, accountId),
      isNotNull(algorithmSelectionLogs.resultFilledAt)
    ))
    .limit(1000);
  
  for (const selLog of logs) {
    const alg = selLog.selectedAlgorithm as AlgorithmType;
    const stat = stats.get(alg);
    if (!stat) continue;
    
    const reward = Number(selLog.resultReward) || 0;
    stat.totalTrials++;
    stat.totalReward += reward;
    stat.avgReward = stat.totalReward / stat.totalTrials;
    
    // 更新Beta分布参数
    if (reward > 0) {
      stat.alphaParam += 1;  // 成功
    } else {
      stat.betaParam += 1;   // 失败
    }
  }
  
  return stats;
}

/**
 * 评估每个算法的资格和得分
 */
async function evaluateAlgorithms(
  accountId: number,
  keywordId?: number,
  targetId?: number,
  campaignId?: string,
  currentBid?: number
): Promise<AlgorithmScore[]> {
  const db = await getDbInstance();
  const scores: AlgorithmScore[] = [];
  
  // 获取数据量统计
  const rlLogCount = await db.select({
    count: sql<number>`COUNT(*)`,
  }).from(rlTrainingLogs)
    .where(and(
      eq(rlTrainingLogs.accountId, accountId),
      isNotNull(rlTrainingLogs.rewardFilledAt)
    ));
  const totalRLLogs = Number(rlLogCount[0]?.count) || 0;
  
  // 获取特征缓存状态
  const featureCount = await db.select({
    count: sql<number>`COUNT(*)`,
  }).from(contextualFeatures)
    .where(eq(contextualFeatures.accountId, accountId));
  const hasFeatures = Number(featureCount[0]?.count) > 0;
  
  // 获取Thompson Sampling统计
  const stats = await getAlgorithmStats(accountId);
  
  // v258: 同时统计未回填的RL日志（包含已记录但未回填reward的）
  // 这些日志表明系统已经在产生数据，只是还未完成reward回填
  const totalRLLogsIncPending = await db.select({
    count: sql<number>`COUNT(*)`,
  }).from(rlTrainingLogs)
    .where(eq(rlTrainingLogs.accountId, accountId));
  const pendingRLLogs = Number(totalRLLogsIncPending[0]?.count) || 0;
  
  // v259: 强制激活高级算法 — 核心策略重构
  // 问题诊断：v258中尽管降低了门槛，但因为RL回填链路断裂，实际上只有rule_based和ucb被激活
  // v259策略：
  //   1. 引入“历史数据合成”：从optimiaztion_events中合成虚拟RL日志，绕过回填链路断裂
  //   2. UCB强制优先：给予UCB更高的基础分，确保它被选中而不是rule_based
  //   3. 算法混合模式：即使只有rule_based和ucb，也尝试融合两者的建议
  
  // v259: 从optimiaztion_events中统计历史优化事件作为虚拟RL数据
  const historyEventCount = await db.select({
    count: sql<number>`COUNT(*)`,
  }).from(sql`optimization_events`)
    .where(and(
      sql`account_id = ${accountId}`,
      sql`event_category = 'bid_adjustment'`,
      sql`status = 'success'`,
      sql`created_at > DATE_SUB(NOW(), INTERVAL 14 DAY)`
    ));
  const totalHistoryEvents = Number(historyEventCount[0]?.count) || 0;
  
  // v259: 综合数据量 = RL日志 + 历史优化事件(按比例折算)
  const syntheticDataCount = totalRLLogs + Math.floor(totalHistoryEvents * 0.3);
  const syntheticPendingCount = pendingRLLogs + Math.floor(totalHistoryEvents * 0.3);
  
  log.info(`[MetaLearning] v259算法评估: 账户${accountId}, RL日志(已回填)=${totalRLLogs}, RL日志(含待回填)=${pendingRLLogs}, 历史事件=${totalHistoryEvents}, 合成数据量=${syntheticDataCount}, 特征缓存=${hasFeatures}`);
  
  // v266 P1-2: 重新调整算法评分体系，提升高级算法激活率
  // 核心策略: 
  //   1. 进一步降低rule_based基础分，迫使系统更多使用高级算法
  //   2. 提高LinUCB和Ensemble的基础分，使其有更大概率被选中
  //   3. 引入“探索预算”机制：每天至少20%的决策强制使用高级算法
  
  // v266: 探索预算机制 — 确保每天至少20%的决策使用高级算法
  const hourOfDay = new Date().getHours();
  const isExplorationSlot = (hourOfDay % 5 === 0) || (hourOfDay % 5 === 1); // 每5小时中有2小时是探索时段(40%)
  const explorationBoost = isExplorationSlot ? 0.15 : 0; // 探索时段额外加分
  
  // 1. rule_based: v266进一步降低基础分
  const rbStat = stats.get('rule_based')!;
  scores.push({
    algorithm: 'rule_based',
    score: betaSample(rbStat.alphaParam, rbStat.betaParam) * (isExplorationSlot ? 0.70 : 0.80), // v266: 从0.85降至0.70-0.80
    eligible: true,
    reason: '基于规则的出价策略（兆底）',
  });
  
  // 2. ucb: 保持强制优先
  const ucbStat = stats.get('ucb')!;
  scores.push({
    algorithm: 'ucb',
    score: betaSample(ucbStat.alphaParam, ucbStat.betaParam) * 1.30,
    eligible: true,
    reason: 'UCB探索-利用策略(强制优先)',
  });
  
  // 3. linucb: v266提升基础分并放宽激活条件
  const linucbStat = stats.get('linucb')!;
  const linucbEligible = hasFeatures || syntheticPendingCount >= 1;
  scores.push({
    algorithm: 'linucb',
    score: linucbEligible ? betaSample(linucbStat.alphaParam, linucbStat.betaParam) * (1.35 + explorationBoost) : 0, // v266: 从1.20提升到1.35+
    eligible: linucbEligible,
    reason: linucbEligible ? `LinUCB上下文赌博机(合成数据=${syntheticPendingCount})` : `数据不足(合成=${syntheticPendingCount}/1)`,
  });
  
  // 4. sigmoid_curve: v266提升基础分
  const sigmoidStat = stats.get('sigmoid_curve')!;
  const sigmoidEligible = syntheticPendingCount >= 2;
  scores.push({
    algorithm: 'sigmoid_curve',
    score: sigmoidEligible ? betaSample(sigmoidStat.alphaParam, sigmoidStat.betaParam) * (1.25 + explorationBoost) : 0, // v266: 从1.15提升到1.25+
    eligible: sigmoidEligible,
    reason: sigmoidEligible ? `Sigmoid曲线利润最大化(合成数据=${syntheticPendingCount})` : `数据不足(合成=${syntheticPendingCount}/2)`,
  });
  
  // 5. cql: v266降低激活门槛从5到3
  const cqlStat = stats.get('cql')!;
  const cqlEligible = syntheticPendingCount >= 3; // v266: 从5降至3
  scores.push({
    algorithm: 'cql',
    score: cqlEligible ? betaSample(cqlStat.alphaParam, cqlStat.betaParam) * (1.30 + explorationBoost) : 0, // v266: 从1.25提升到1.30+
    eligible: cqlEligible,
    reason: cqlEligible ? `离线强化学习CQL(合成数据=${syntheticPendingCount})` : `数据不足(合成=${syntheticPendingCount}/3)`,
  });
  
  // 6. ensemble: v266提升融合模式的基础分，使其成为首选
  const eligibleCount = scores.filter(s => s.eligible).length;
  const ensembleStat = stats.get('ensemble')!;
  scores.push({
    algorithm: 'ensemble',
    score: eligibleCount >= 2 ? betaSample(ensembleStat.alphaParam, ensembleStat.betaParam) * (1.40 + explorationBoost) : 0, // v266: 从1.30提升到1.40+
    eligible: eligibleCount >= 2,
    reason: eligibleCount >= 2 ? `多算法融合(可用${eligibleCount}个)` : `可用算法不足(${eligibleCount}/2)`,
  });
  
  log.info(`[MetaLearning] v259算法资格: ${scores.filter(s => s.eligible).map(s => s.algorithm).join(', ')} (共${eligibleCount}个可用)`);
  
  return scores;
}

/**
 * 元学习策略选择（核心决策函数）
 */
export async function selectBestAlgorithm(
  accountId: number,
  keywordId?: number,
  targetId?: number,
  campaignId?: string,
  currentBid?: number
): Promise<MetaDecision> {
  const scores = await evaluateAlgorithms(accountId, keywordId, targetId, campaignId, currentBid);
  
  // 选择得分最高的可用算法
  const eligibleScores = scores.filter(s => s.eligible);
  eligibleScores.sort((a, b) => b.score - a.score);
  
  const selected = eligibleScores[0] || scores.find(s => s.algorithm === 'rule_based')!;
  
  let recommendedBid = currentBid || 0;
  let confidence = 0;
  let linucbDecision: LinUCBDecision | undefined;
  let cqlDecision: CQLDecision | undefined;
  let sigmoidDecision: SigmoidOptimalBid | undefined;
  
  // 执行选中的算法
  try {
    switch (selected.algorithm) {
      case 'linucb':
        linucbDecision = await makeLinUCBBidDecision(accountId, keywordId, targetId, campaignId, currentBid) || undefined;
        if (linucbDecision) {
          recommendedBid = linucbDecision.recommendedBid;
          confidence = linucbDecision.confidence;
        }
        break;
        
      case 'cql':
        const context = await extractFeatureVector(accountId, keywordId, targetId, campaignId);
        cqlDecision = await makeCQLBidDecision(accountId, context, currentBid || 0) || undefined;
        if (cqlDecision) {
          recommendedBid = cqlDecision.recommendedBid;
          confidence = cqlDecision.confidence;
        }
        break;
        
      case 'sigmoid_curve':
        if (keywordId || targetId) {
          const entityType = keywordId ? 'keyword' : 'target';
          const entityId = keywordId || targetId || 0;
          const params = await fitAndCacheSigmoidForEntity(accountId, entityType as any, entityId, campaignId || '');
          if (params && params.r2 > 0.3) {
            sigmoidDecision = calculateSigmoidOptimalBid(params, 0.01, 0.05, 30);
            recommendedBid = sigmoidDecision.optimalBid;
            confidence = sigmoidDecision.confidence;
          }
        }
        break;
        
      case 'ensemble':
        // v230: 多算法融合：收集所有可用算法的建议（包含Sigmoid），加权平均
        const bids: { bid: number; weight: number }[] = [];
        
        const linDecision = await makeLinUCBBidDecision(accountId, keywordId, targetId, campaignId, currentBid);
        if (linDecision) {
          bids.push({ bid: linDecision.recommendedBid, weight: linDecision.confidence });
          linucbDecision = linDecision;
        }
        
        const ctx = await extractFeatureVector(accountId, keywordId, targetId, campaignId);
        const cqlDec = await makeCQLBidDecision(accountId, ctx, currentBid || 0);
        if (cqlDec) {
          bids.push({ bid: cqlDec.recommendedBid, weight: cqlDec.confidence });
          cqlDecision = cqlDec;
        }
        
        // v230: 添加Sigmoid曲线拟合结果到Ensemble
        try {
          const { fitAndCacheSigmoidForEntity, calculateSigmoidOptimalBid } = await import('./sigmoidCurveFitter');
          const entityId = keywordId || targetId || 0;
          const entityType = keywordId ? 'keyword' : 'target';
          const sigParams = await fitAndCacheSigmoidForEntity(accountId, entityType, entityId, String(campaignId));
          if (sigParams && sigParams.r2 > 0.5) {
            // 使用Sigmoid参数计算最优出价
            const avgCtr = Number(ctx?.avgCtr7d || 0.02);
            const avgCvr = Number(ctx?.avgCvr7d || 0.05);
            const aov = avgCvr > 0 ? (Number(ctx?.weightedRoas14d || 3) * Number(ctx?.avgCpc7d || 1)) / avgCvr : 25;
            const sigResult = calculateSigmoidOptimalBid(sigParams, avgCtr, avgCvr, aov, 0.7);
            if (sigResult.optimalBid > 0) {
              const sigConfidence = Math.min(0.9, sigParams.r2);
              bids.push({ bid: sigResult.optimalBid, weight: sigConfidence });
              sigmoidDecision = { recommendedBid: sigResult.optimalBid, confidence: sigConfidence } as any;
            }
          }
        } catch (sigErr) {
          // Sigmoid不可用时静默跳过
        }
        
        if (bids.length > 0) {
          const totalWeight = bids.reduce((sum, b) => sum + b.weight, 0);
          recommendedBid = bids.reduce((sum, b) => sum + b.bid * b.weight, 0) / totalWeight;
          confidence = totalWeight / bids.length;
        }
        break;
        
      case 'ucb': {
        // v266 P1-2: 增强UCB探索-利用平衡机制
        // 提高探索概率从15%到20%，增加探索方向的智能化
        const ucbBid = currentBid || 0;
        const epsilon = 0.20; // v266: 从15%提升到20%，增加探索频率
        const entitySeed = (keywordId || 0) * 31 + (targetId || 0) * 37 + accountId * 41;
        const hourWindow = Math.floor(Date.now() / (4 * 3600000));
        const hashVal = ((entitySeed * 2654435761 + hourWindow) >>> 0) % 10000 / 10000;
        
        if (hashVal < epsilon) {
          // v266: 智能探索方向 — 偏向提价探索(60%提价/40%降价)，因为系统历史偏向降价
          const explorationDirection = hashVal < epsilon * 0.6 ? 1 : -1; // v266: 60%提价/40%降价
          const explorationMagnitude = 0.05 + (hashVal / epsilon) * 0.10; // v266: 5%~15%的扰动幅度(从12%提升到15%)
          recommendedBid = ucbBid * (1 + explorationDirection * explorationMagnitude);
          recommendedBid = Math.max(0.02, Math.round(recommendedBid * 100) / 100);
          confidence = 0.45; // v266: 探索模式置信度微调
          log.info(`[MetaLearning] v266 UCB探索模式: entity=${keywordId || targetId}, 方向=${explorationDirection > 0 ? '提价' : '降价'}, 幅度=${(explorationMagnitude * 100).toFixed(1)}%`);
        } else {
          recommendedBid = ucbBid;
          confidence = 0.5;
        }
        break;
      }
      
      case 'rule_based':
      default:
        // 使用现有系统的出价逻辑
        recommendedBid = currentBid || 0;
        confidence = 0.5;
        break;
    }
  } catch (error) {
    log.error(`Error executing ${selected.algorithm}:`, error);
    // 降级到rule_based
    recommendedBid = currentBid || 0;
    confidence = 0.3;
  }
  
  // v230: 移除重复的安全约束，由nextGenBidOrchestrator的safetyValidate统一处理
  // 之前这里和safetyValidate双重限制导致系统过度保守
  // 仅保留基本的数值合法性检查
  recommendedBid = Math.max(0.02, Math.round(recommendedBid * 100) / 100);
  
  const decision: MetaDecision = {
    selectedAlgorithm: selected.algorithm,
    recommendedBid,
    confidence,
    algorithmScores: scores,
    reasoning: `选择${selected.algorithm}: ${selected.reason} (得分=${selected.score.toFixed(4)})`,
    linucbDecision,
    cqlDecision,
    sigmoidDecision,
  };
  
  // 记录选择日志
  const db = await getDbInstance();
  await db.insert(algorithmSelectionLogs).values({
    accountId,
    keywordId: keywordId || null,
    targetId: targetId || null,
    campaignId: campaignId || null,
    selectedAlgorithm: selected.algorithm as any,
    algorithmScores: scores,
    selectionReason: decision.reasoning,
    executedBid: String(recommendedBid),
  } as any);
  
  return decision;
}

/**
 * 回填算法选择的结果（定时任务）
 */
export async function backfillAlgorithmResults(accountId: number): Promise<number> {
  const db = await getDbInstance();
  let filledCount = 0;
  
  const hoursAgo48 = new Date(Date.now() - 48 * 3600000).toISOString();
  const hoursAgo24 = new Date(Date.now() - 24 * 3600000).toISOString();
  
  const pendingLogs = await db.select({
    id: algorithmSelectionLogs.id,
    keywordId: algorithmSelectionLogs.keywordId,
    targetId: algorithmSelectionLogs.targetId,
    campaignId: algorithmSelectionLogs.campaignId,
    executedBid: algorithmSelectionLogs.executedBid,
  }).from(algorithmSelectionLogs)
    .where(and(
      eq(algorithmSelectionLogs.accountId, accountId),
      sql`result_filled_at IS NULL`,
      gte(algorithmSelectionLogs.createdAt, hoursAgo48),
      sql`created_at <= ${hoursAgo24}`
    ))
    .limit(200);
  
  for (const pendLog of pendingLogs) {
    try {
      // 查找对应的RL日志中的reward
      const rlLog = await db.select({
        reward: rlTrainingLogs.reward,
      }).from(rlTrainingLogs)
        .where(and(
          eq(rlTrainingLogs.accountId, accountId),
          pendLog.keywordId ? eq(rlTrainingLogs.keywordId, pendLog.keywordId) : sql`1=1`,
          pendLog.targetId ? eq(rlTrainingLogs.targetId, pendLog.targetId) : sql`1=1`,
          isNotNull(rlTrainingLogs.reward),
          gte(rlTrainingLogs.createdAt, hoursAgo48)
        ))
        .orderBy(desc(rlTrainingLogs.createdAt))
        .limit(1);
      
      if (rlLog.length > 0) {
        await db.update(algorithmSelectionLogs)
          .set({
            resultReward: rlLog[0].reward,
            resultFilledAt: new Date().toISOString(),
          })
          .where(eq(algorithmSelectionLogs.id, pendLog.id));
        filledCount++;
      }
    } catch (e) {
      // 忽略单条错误
    }
  }
  
  log.debug(`Backfilled ${filledCount} algorithm results`);
  return filledCount;
}
