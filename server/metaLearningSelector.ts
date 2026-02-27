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
import { getExperimentConfigForCampaign } from './abTestIntegration';
import { getCascadeConfig, calculateStrategyExplorationRate, getExplorationConfig } from './algorithmConfigService';

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
  // v270 P0: Cascade Ensemble融合模式
  fusionMode: 'single' | 'cascade_ensemble';  // v270: 记录决策模式
  fusionDetail?: string;  // v270: 融合详情
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
  currentBid?: number,
  strategyTemplateId?: string | null  // v272: 策略级别化探索率
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
  
  // v268 P1-1: 高级算法强制激活 — 目标激活率>40%
  // 核心策略升级:
  //   1. 探索率从30-50%提升到40-60%，加速数据积累
  //   2. 强制激活模式: 当数据量超过1条时，所有高级算法自动解锁
  //   3. rule_based惩罚系数进一步降低，迫使系统向高级算法迁移
  //   4. 算法轮转周期缩短到30分钟，增加多样性
  //   5. ensemble融合模式优先级提升至1.65
  
  const hourOfDay = new Date().getHours();
  const dayOfWeek = new Date().getDay();
  
  // v272 P1-2: 探索-利用自适应机制 — 策略级别化完整集成
  // v270: 引入自适应探索率
  // v271: 创建calculateStrategyExplorationRate但未集成到evaluateAlgorithms
  // v272: 完成集成，用策略级别的探索率替换全局硬编码值
  
  // v270: 算法表现衰减因子 — 连续失败的算法降低其探索概率
  const getConsecutiveFailures = (stat: AlgorithmStats): number => {
    if (stat.totalTrials < 3) return 0;
    const failRate = stat.betaParam / (stat.alphaParam + stat.betaParam);
    return failRate > 0.75 ? 0.20 : failRate > 0.60 ? 0.10 : 0;
  };
  
  // v272: 数据新鲜度检测
  const hoursAgo24 = new Date(Date.now() - 24 * 3600000).toISOString();
  const recentDataCount = await db.select({ count: sql<number>`COUNT(*)` })
    .from(rlTrainingLogs)
    .where(and(eq(rlTrainingLogs.accountId, accountId), gte(rlTrainingLogs.createdAt, hoursAgo24)));
  const hasRecentData = Number(recentDataCount[0]?.count) > 0;
  
  // v272: 使用策略级别化探索率计算（替代v270的全局硬编码）
  const { explorationRate, detail: explorationDetail } = calculateStrategyExplorationRate(
    strategyTemplateId || null,
    syntheticDataCount,
    hasRecentData
  );
  
  // v268: 算法轮转机制 — 缩短轮转周期到30分钟
  const halfHourSlot = Math.floor(Date.now() / (30 * 60 * 1000));
  const algorithmRotation = halfHourSlot % 6; // 0-5循环
  const isExplorationSlot = Math.random() < explorationRate;
  const explorationBoost = isExplorationSlot ? 0.25 : 0;
  
  // v270 P1-1: 算法表现反馈乘数 — 融合Thompson Sampling + 衰减因子
  const getPerformanceMultiplier = (stat: AlgorithmStats) => {
    const successRate = stat.alphaParam / (stat.alphaParam + stat.betaParam);
    const decay = getConsecutiveFailures(stat);
    // 表现好的算法获得加成，表现差的算法被衰减
    return Math.max(0.70, (1 + Math.max(0, (successRate - 0.5)) * 0.30) - decay);
  };
  
  log.info(`[MetaLearning] v272策略级探索自适应: ${explorationDetail}`);
  
  // 1. rule_based: v268进一步降低基础分，强制系统向高级算法迁移
  const rbStat = stats.get('rule_based')!;
  const rbPenalty = isExplorationSlot ? 0.45 : 0.60; // v268: 从0.60-0.75降至0.45-0.60
  scores.push({
    algorithm: 'rule_based',
    score: betaSample(rbStat.alphaParam, rbStat.betaParam) * rbPenalty,
    eligible: true,
    reason: '基于规则的出价策略（兆底）',
  });
  
  // 2. ucb: v267增加表现反馈
  const ucbStat = stats.get('ucb')!;
  scores.push({
    algorithm: 'ucb',
    score: betaSample(ucbStat.alphaParam, ucbStat.betaParam) * 1.30 * getPerformanceMultiplier(ucbStat),
    eligible: true,
    reason: 'UCB探索-利用策略(强制优先)',
  });
  
  // 3. linucb: v268强制激活 — 只要有任何数据就解锁
  const linucbStat = stats.get('linucb')!;
  const linucbEligible = hasFeatures || syntheticPendingCount >= 1 || totalHistoryEvents >= 1; // v268: 有历史事件就解锁
  const linucbRotationBoost = algorithmRotation === 0 || algorithmRotation === 3 ? 0.15 : 0; // v268: 轮转加成从0.10提升到0.15
  scores.push({
    algorithm: 'linucb',
    score: linucbEligible ? betaSample(linucbStat.alphaParam, linucbStat.betaParam) * (1.50 + explorationBoost + linucbRotationBoost) * getPerformanceMultiplier(linucbStat) : 0, // v268: 从1.40提升到1.50
    eligible: linucbEligible,
    reason: linucbEligible ? `LinUCB上下文赌博机(合成数据=${syntheticPendingCount})` : `数据不足(合成=${syntheticPendingCount}/1)`,
  });
  
  // 4. sigmoid_curve: v268降低激活门槛到1
  const sigmoidStat = stats.get('sigmoid_curve')!;
  const sigmoidEligible = syntheticPendingCount >= 1; // v268: 从2降至1
  const sigmoidRotationBoost = algorithmRotation === 1 || algorithmRotation === 4 ? 0.10 : 0;
  scores.push({
    algorithm: 'sigmoid_curve',
    score: sigmoidEligible ? betaSample(sigmoidStat.alphaParam, sigmoidStat.betaParam) * (1.30 + explorationBoost + sigmoidRotationBoost) * getPerformanceMultiplier(sigmoidStat) : 0,
    eligible: sigmoidEligible,
    reason: sigmoidEligible ? `Sigmoid曲线利润最大化(合成数据=${syntheticPendingCount})` : `数据不足(合成=${syntheticPendingCount}/2)`,
  });
  
  // 5. cql: v268降低激活门槛到1，添加轮转加成
  const cqlStat = stats.get('cql')!;
  const cqlEligible = syntheticPendingCount >= 1; // v268: 从2降至1
  const cqlRotationBoost = algorithmRotation === 2 || algorithmRotation === 5 ? 0.10 : 0;
  scores.push({
    algorithm: 'cql',
    score: cqlEligible ? betaSample(cqlStat.alphaParam, cqlStat.betaParam) * (1.35 + explorationBoost + cqlRotationBoost) * getPerformanceMultiplier(cqlStat) : 0,
    eligible: cqlEligible,
    reason: cqlEligible ? `离线强化学习CQL(合成数据=${syntheticPendingCount})` : `数据不足(合成=${syntheticPendingCount}/2)`,
  });
  
  // 6. ensemble: v268提升融合模式优先级到1.65
  const eligibleCount = scores.filter(s => s.eligible).length;
  const ensembleStat = stats.get('ensemble')!;
  scores.push({
    algorithm: 'ensemble',
    score: eligibleCount >= 2 ? betaSample(ensembleStat.alphaParam, ensembleStat.betaParam) * (1.65 + explorationBoost) * getPerformanceMultiplier(ensembleStat) : 0, // v268: 从1.50提升到1.65
    eligible: eligibleCount >= 2,
    reason: eligibleCount >= 2 ? `多算法融合(可用${eligibleCount}个)` : `可用算法不足(${eligibleCount}/2)`,
  });
  
  log.info(`[MetaLearning] v268算法评估: 探索率=${(explorationRate*100).toFixed(0)}%, 数据成熟度=${(dataMaturity*100).toFixed(0)}%, 轮转槽=${algorithmRotation}, 探索槽=${isExplorationSlot}`);
  log.info(`[MetaLearning] v268算法得分: ${scores.map(s => `${s.algorithm}=${s.score.toFixed(3)}`).join(', ')}`);
  
  log.info(`[MetaLearning] v259算法资格: ${scores.filter(s => s.eligible).map(s => s.algorithm).join(', ')} (共${eligibleCount}个可用)`);
  
  return scores;
}

/**
 * v270 P0: 执行单个算法并返回出价建议和置信度
 * 抽取为独立函数，供Cascade Ensemble复用
 */
async function executeAlgorithm(
  algorithm: AlgorithmType,
  accountId: number,
  keywordId?: number,
  targetId?: number,
  campaignId?: string,
  currentBid?: number
): Promise<{ bid: number; confidence: number; linucb?: LinUCBDecision; cql?: CQLDecision; sigmoid?: SigmoidOptimalBid }> {
  let bid = currentBid || 0;
  let conf = 0;
  let linucb: LinUCBDecision | undefined;
  let cql: CQLDecision | undefined;
  let sigmoid: SigmoidOptimalBid | undefined;

  switch (algorithm) {
    case 'linucb':
      linucb = await makeLinUCBBidDecision(accountId, keywordId, targetId, campaignId, currentBid) || undefined;
      if (linucb) { bid = linucb.recommendedBid; conf = linucb.confidence; }
      break;

    case 'cql': {
      const context = await extractFeatureVector(accountId, keywordId, targetId, campaignId);
      const cqlDec = await makeCQLBidDecision(accountId, context, currentBid || 0) || undefined;
      if (cqlDec) { bid = cqlDec.recommendedBid; conf = cqlDec.confidence; cql = cqlDec; }
      break;
    }

    case 'sigmoid_curve':
      if (keywordId || targetId) {
        const entityType = keywordId ? 'keyword' : 'target';
        const entityId = keywordId || targetId || 0;
        const params = await fitAndCacheSigmoidForEntity(accountId, entityType as any, entityId, campaignId || '');
        if (params && params.r2 > 0.3) {
          sigmoid = calculateSigmoidOptimalBid(params, 0.01, 0.05, 30);
          bid = sigmoid.optimalBid; conf = sigmoid.confidence;
        }
      }
      break;

    case 'ensemble': {
      // v230: 多算法融合
      const bids: { bid: number; weight: number }[] = [];
      const linDec = await makeLinUCBBidDecision(accountId, keywordId, targetId, campaignId, currentBid);
      if (linDec) { bids.push({ bid: linDec.recommendedBid, weight: linDec.confidence }); linucb = linDec; }
      const ctx = await extractFeatureVector(accountId, keywordId, targetId, campaignId);
      const cqlD = await makeCQLBidDecision(accountId, ctx, currentBid || 0);
      if (cqlD) { bids.push({ bid: cqlD.recommendedBid, weight: cqlD.confidence }); cql = cqlD; }
      try {
        const { fitAndCacheSigmoidForEntity: fitSig, calculateSigmoidOptimalBid: calcSig } = await import('./sigmoidCurveFitter');
        const eId = keywordId || targetId || 0;
        const eType = keywordId ? 'keyword' : 'target';
        const sigP = await fitSig(accountId, eType, eId, String(campaignId));
        if (sigP && sigP.r2 > 0.5) {
          const avgCtr = Number(ctx?.avgCtr7d || 0.02);
          const avgCvr = Number(ctx?.avgCvr7d || 0.05);
          const aov = avgCvr > 0 ? (Number(ctx?.weightedRoas14d || 3) * Number(ctx?.avgCpc7d || 1)) / avgCvr : 25;
          const sigR = calcSig(sigP, avgCtr, avgCvr, aov, 0.7);
          if (sigR.optimalBid > 0) {
            const sigConf = Math.min(0.9, sigP.r2);
            bids.push({ bid: sigR.optimalBid, weight: sigConf });
            sigmoid = { recommendedBid: sigR.optimalBid, confidence: sigConf } as any;
          }
        }
      } catch { /* Sigmoid不可用时静默跳过 */ }
      if (bids.length > 0) {
        const tw = bids.reduce((s, b) => s + b.weight, 0);
        bid = bids.reduce((s, b) => s + b.bid * b.weight, 0) / tw;
        conf = tw / bids.length;
      }
      break;
    }

    case 'ucb': {
      const ucbBid = currentBid || 0;
      const epsilon = 0.20;
      const entitySeed = (keywordId || 0) * 31 + (targetId || 0) * 37 + accountId * 41;
      const hourWindow = Math.floor(Date.now() / (4 * 3600000));
      const hashVal = ((entitySeed * 2654435761 + hourWindow) >>> 0) % 10000 / 10000;
      if (hashVal < epsilon) {
        const explorationDirection = hashVal < epsilon * 0.6 ? 1 : -1;
        const explorationMagnitude = 0.05 + (hashVal / epsilon) * 0.10;
        bid = ucbBid * (1 + explorationDirection * explorationMagnitude);
        bid = Math.max(0.02, Math.round(bid * 100) / 100);
        conf = 0.45;
      } else {
        bid = ucbBid; conf = 0.5;
      }
      break;
    }

    case 'rule_based':
    default:
      bid = currentBid || 0; conf = 0.5;
      break;
  }

  return { bid, confidence: conf, linucb, cql, sigmoid };
}

/**
 * v270 P0: 元学习策略选择（核心决策函数）
 * 
 * 重构：从"取最高分"改为"Cascade Ensemble置信度融合"
 * - 当top2算法分差 < 15% 时，同时执行两个算法，按置信度加权融合出价
 * - 当分差 >= 15% 时，直接使用最高分算法（single模式）
 * - 融合时使用各算法返回的confidence作为权重
 */
export async function selectBestAlgorithm(
  accountId: number,
  keywordId?: number,
  targetId?: number,
  campaignId?: string,
  currentBid?: number,
  strategyTemplateId?: string | null  // v271 P1-2: 策略模板级别的算法配置
): Promise<MetaDecision> {
  const scores = await evaluateAlgorithms(accountId, keywordId, targetId, campaignId, currentBid, strategyTemplateId);
  
  // 选择得分最高的可用算法
  const eligibleScores = scores.filter(s => s.eligible);
  eligibleScores.sort((a, b) => b.score - a.score);
  
  const top1 = eligibleScores[0] || scores.find(s => s.algorithm === 'rule_based')!;
  const top2 = eligibleScores[1];
  
  let recommendedBid = currentBid || 0;
  let confidence = 0;
  let linucbDecision: LinUCBDecision | undefined;
  let cqlDecision: CQLDecision | undefined;
  let sigmoidDecision: SigmoidOptimalBid | undefined;
  let fusionMode: 'single' | 'cascade_ensemble' = 'single';
  let fusionDetail = '';
  let selectedAlgorithmName = top1.algorithm;
  
  // v270 P0: Cascade Ensemble判定
  // 当top2存在且与top1分差 < FUSION_THRESHOLD时，执行两个算法并按置信度加权融合
  // v271 P1-2: 融合阈值参数化，支持策略模板级别配置 + A/B测试实验覆盖
  // 优先级: A/B实验 > 策略模板配置 > 全局默认
  const cascadeConfig = getCascadeConfig(strategyTemplateId);
  let FUSION_THRESHOLD = cascadeConfig.fusionThreshold; // v271: 从策略模板配置获取
  let cascadeEnabled = cascadeConfig.enabled;
  let forceAlgorithmMode: 'single' | 'cascade_ensemble' | null = null;
  
  // v271: 检查该campaign是否在A/B测试实验中
  if (campaignId) {
    try {
      const experimentConfig = await getExperimentConfigForCampaign(accountId, campaignId);
      if (experimentConfig) {
        const { variantType, config, testId } = experimentConfig;
        log.info(`[MetaLearning] v271 A/B实验: campaign=${campaignId} 在实验${testId}的${variantType}组`);
        
        // 覆盖融合阈值
        if (config.fusionThreshold !== undefined) {
          FUSION_THRESHOLD = config.fusionThreshold;
          log.info(`[MetaLearning] v271 A/B实验: 融合阈值覆盖为 ${(FUSION_THRESHOLD * 100).toFixed(0)}%`);
        }
        
        // 强制算法模式
        if (config.algorithmMode) {
          forceAlgorithmMode = config.algorithmMode;
          log.info(`[MetaLearning] v271 A/B实验: 强制算法模式为 ${forceAlgorithmMode}`);
        }
      }
    } catch (expError) {
      log.warn(`[MetaLearning] v271 A/B实验配置查询失败，使用默认配置:`, expError);
    }
  }
  
  // v271 P1-2: shouldFuse判定加入cascadeEnabled检查
  const shouldFuse = (
    forceAlgorithmMode === 'cascade_ensemble' || // v271: A/B实验强制融合
    (cascadeEnabled && // v271: 策略模板级别的cascade开关
     forceAlgorithmMode !== 'single' && // v271: A/B实验强制单一模式时不融合
     top2 && top1.score > 0 && 
     ((top1.score - top2.score) / top1.score) < FUSION_THRESHOLD &&
     top2.algorithm !== 'rule_based')
  ) && top2 !== undefined; // 确保top2存在
  
  try {
    if (shouldFuse) {
      // === Cascade Ensemble模式 ===
      fusionMode = 'cascade_ensemble';
      log.info(`[MetaLearning] v270 Cascade Ensemble: ${top1.algorithm}(${top1.score.toFixed(3)}) + ${top2.algorithm}(${top2.score.toFixed(3)}), 分差=${((top1.score - top2.score) / top1.score * 100).toFixed(1)}%`);
      
      // 并行执行两个算法
      const [result1, result2] = await Promise.all([
        executeAlgorithm(top1.algorithm, accountId, keywordId, targetId, campaignId, currentBid),
        executeAlgorithm(top2.algorithm, accountId, keywordId, targetId, campaignId, currentBid),
      ]);
      
      // 收集有效结果
      const fusionBids: { bid: number; confidence: number; algorithm: string }[] = [];
      if (result1.bid > 0 && result1.confidence > 0) {
        fusionBids.push({ bid: result1.bid, confidence: result1.confidence, algorithm: top1.algorithm });
      }
      if (result2.bid > 0 && result2.confidence > 0) {
        fusionBids.push({ bid: result2.bid, confidence: result2.confidence, algorithm: top2.algorithm });
      }
      
      // 合并各算法的决策详情
      linucbDecision = result1.linucb || result2.linucb;
      cqlDecision = result1.cql || result2.cql;
      sigmoidDecision = result1.sigmoid || result2.sigmoid;
      
      if (fusionBids.length >= 2) {
        // 按置信度加权融合
        const totalConf = fusionBids.reduce((s, b) => s + b.confidence, 0);
        recommendedBid = fusionBids.reduce((s, b) => s + b.bid * b.confidence, 0) / totalConf;
        // 融合后的置信度取加权平均，并给予融合奖励（多算法一致性提升置信度）
        const bidDivergence = Math.abs(fusionBids[0].bid - fusionBids[1].bid) / Math.max(fusionBids[0].bid, fusionBids[1].bid, 0.01);
        // v271 P1-2: 共识奖励阈值从策略模板配置获取
        const { consensusBonus: cbConfig } = cascadeConfig;
        const consensusBonus = bidDivergence < cbConfig.highThreshold ? cbConfig.highBonus : bidDivergence < cbConfig.mediumThreshold ? cbConfig.mediumBonus : 0;
        confidence = Math.min(0.95, (totalConf / fusionBids.length) + consensusBonus);
        selectedAlgorithmName = 'ensemble' as AlgorithmType; // 融合模式记录为ensemble
        fusionDetail = `Cascade融合: ${fusionBids.map(b => `${b.algorithm}($${b.bid.toFixed(2)},conf=${b.confidence.toFixed(2)})`).join(' + ')} → $${recommendedBid.toFixed(2)}, 分歧度=${(bidDivergence*100).toFixed(1)}%, 共识奖励=${(consensusBonus*100).toFixed(0)}%`;
        log.info(`[MetaLearning] v270 ${fusionDetail}`);
      } else if (fusionBids.length === 1) {
        // 只有一个算法返回有效结果，降级为single模式
        recommendedBid = fusionBids[0].bid;
        confidence = fusionBids[0].confidence;
        fusionMode = 'single';
        fusionDetail = `Cascade降级: 仅${fusionBids[0].algorithm}返回有效结果`;
        selectedAlgorithmName = fusionBids[0].algorithm as AlgorithmType;
      } else {
        // 两个都失败，降级到rule_based
        recommendedBid = currentBid || 0;
        confidence = 0.3;
        fusionMode = 'single';
        fusionDetail = 'Cascade失败: 两个算法均未返回有效结果，降级rule_based';
        selectedAlgorithmName = 'rule_based';
      }
    } else {
      // === Single模式（原逻辑）===
      const result = await executeAlgorithm(top1.algorithm, accountId, keywordId, targetId, campaignId, currentBid);
      recommendedBid = result.bid;
      confidence = result.confidence;
      linucbDecision = result.linucb;
      cqlDecision = result.cql;
      sigmoidDecision = result.sigmoid;
      fusionDetail = `Single模式: ${top1.algorithm}(得分=${top1.score.toFixed(3)})`;
      if (top2) {
        fusionDetail += `, 次选${top2.algorithm}(分差=${((top1.score - top2.score) / top1.score * 100).toFixed(1)}% > ${(FUSION_THRESHOLD * 100).toFixed(0)}%阈值)`;
      }
    }
  } catch (error) {
    log.error(`Error executing algorithm(s):`, error);
    recommendedBid = currentBid || 0;
    confidence = 0.3;
    fusionMode = 'single';
    fusionDetail = `执行异常，降级rule_based: ${error}`;
    selectedAlgorithmName = 'rule_based';
  }
  
  // 基本数值合法性检查
  recommendedBid = Math.max(0.02, Math.round(recommendedBid * 100) / 100);
  
  const decision: MetaDecision = {
    selectedAlgorithm: selectedAlgorithmName as AlgorithmType,
    recommendedBid,
    confidence,
    algorithmScores: scores,
    reasoning: fusionMode === 'cascade_ensemble' 
      ? `v270 Cascade Ensemble融合: ${fusionDetail}`
      : `选择${selectedAlgorithmName}: ${top1.reason} (得分=${top1.score.toFixed(4)})`,
    fusionMode,
    fusionDetail,
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
    selectedAlgorithm: selectedAlgorithmName as any,
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
