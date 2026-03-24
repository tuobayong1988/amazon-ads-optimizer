import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('OfflineRLService');
/**
 * 离线强化学习服务 (Offline RL - Conservative Q-Learning)
 * 
 * 核心算法：CQL (Conservative Q-Learning) 的简化TypeScript实现
 * 
 * 创新点：
 * 1. 从历史出价日志中学习最优策略，无需在线试错
 * 2. 保守估计：对未见过的动作给予惩罚，避免过度乐观
 * 3. 状态空间：17维上下文特征 + 当前出价
 * 4. 动作空间：离散化的出价调整幅度 [-30%, -15%, -5%, 0%, +5%, +15%, +30%]
 * 5. 奖励：增量利润（来自RL训练日志的延迟回填）
 * 
 * 实现方式：
 * - 使用线性函数近似Q值: Q(s,a) = w_a^T × φ(s)
 * - CQL正则化: min_Q E_data[Q] + α × (E_policy[Q] - E_data[Q])
 * - 批量离线训练，定期更新策略
 */
import { getDb } from "../db";
import { rlTrainingLogs } from "../../drizzle/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { featureVectorToArray, FEATURE_DIM, type ContextFeatureVector } from "../analytics/contextualFeatureService";

// ==================== 类型定义 ====================

// 离散动作空间
export const ACTIONS = [-0.30, -0.15, -0.05, 0, 0.05, 0.15, 0.30] as const;
export type ActionIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const NUM_ACTIONS = ACTIONS.length;

// 状态维度 = 上下文特征(17) + 当前出价(1) = 18
export const STATE_DIM = FEATURE_DIM + 1;

export interface CQLModel {
  // 每个动作的权重向量 w_a (STATE_DIM维)
  weights: number[][];  // NUM_ACTIONS × STATE_DIM
  // 训练元数据
  trainingEpisodes: number;
  trainingSteps: number;
  avgLoss: number;
  lastTrainedAt: string;
  // v274: 模型质量评估指标
  qualityMetrics?: CQLQualityMetrics;
}

// v274: CQL模型质量评估指标
export interface CQLQualityMetrics {
  qValueStability: number;      // Q值稳定性 (0-1, 越高越稳定)
  policyConsistency: number;    // 策略一致性 (0-1, 越高越一致)
  rewardCorrelation: number;    // 奖励相关性 (0-1, Q值与实际奖励的相关度)
  actionDiversity: number;      // 动作多样性 (0-1, 避免退化到单一动作)
  dataQualityScore: number;     // 数据质量评分 (0-1)
  overallScore: number;         // 综合质量评分 (0-1)
  evaluatedAt: string;
}

export interface CQLDecision {
  actionIndex: ActionIndex;
  bidMultiplier: number;
  recommendedBid: number;
  qValues: number[];
  confidence: number;
  isConservative: boolean;
}

// ==================== 辅助函数 ====================

async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

/**
 * 将出价变化率映射到最近的离散动作
 */
function bidDeltaToAction(bidBefore: number, bidAfter: number): ActionIndex {
  if (bidBefore <= 0) return 3; // hold
  const ratio = (bidAfter - bidBefore) / bidBefore;
  
  let bestIdx = 3;
  let bestDist = Infinity;
  for (let i = 0; i < ACTIONS.length; i++) {
    const dist = Math.abs(ratio - ACTIONS[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx as ActionIndex;
}

/**
 * 构建状态向量
 */
function buildStateVector(context: ContextFeatureVector | null, currentBid: number): number[] {
  const contextVec = context ? featureVectorToArray(context) : Array(FEATURE_DIM).fill(0);
  return [...contextVec, Math.min(1, currentBid / 10)]; // 出价归一化到[0,1]
}

/**
 * 计算Q值: Q(s,a) = w_a^T × s
 */
function computeQ(weights: number[], state: number[]): number {
  return state.reduce((sum, val, i) => sum + val * (weights[i] || 0), 0);
}

/**
 * Softmax概率
 */
function softmax(values: number[], temperature: number = 1.0): number[] {
  const maxVal = Math.max(...values);
  const exps = values.map(v => Math.exp((v - maxVal) / temperature));
  // @ts-ignore
  const sumExps = exps.reduce((a: unknown, b: unknown) => a + b, 0);
  // @ts-ignore
  return exps.map(e => e / sumExps);
}

// ==================== CQL训练算法 ====================

/**
 * 初始化CQL模型
 */
export function initCQLModel(): CQLModel {
  // Xavier初始化
  const scale = Math.sqrt(2 / STATE_DIM);
  const weights = Array.from({ length: NUM_ACTIONS }, () =>
    Array.from({ length: STATE_DIM }, () => (Math.random() - 0.5) * scale)
  );
  
  return {
    weights,
    trainingEpisodes: 0,
    trainingSteps: 0,
    avgLoss: 0,
    lastTrainedAt: new Date().toISOString(),
  };
}

/**
 * CQL离线训练（核心算法）
 * 
 * 对每个(s, a, r, s')样本：
 * 1. 标准TD更新: w_a += lr × (r + γ × max_a' Q(s', a') - Q(s, a)) × s
 * 2. CQL正则化: w_a -= cql_alpha × (Q(s, a) - E_data[Q(s, a)]) × s
 */
export async function trainCQL(
  accountId: number,
  model: CQLModel | null = null,
  config: {
    learningRate?: number;
    gamma?: number;       // 折扣因子
    cqlAlpha?: number;    // CQL保守系数
    epochs?: number;
    batchSize?: number;
  } = {}
): Promise<CQLModel> {
  const db = await getDbInstance();
  const {
    learningRate = 0.001,
    gamma = 0.95,
    cqlAlpha = 0.5,
    epochs = 10,
    batchSize = 64,
  } = config;
  
  if (!model) {
    model = initCQLModel();
  }
  
  // v230: 加载训练数据，包含episodeId和stepIndex以构建next state
  const trainingData = await db.select({
    stateBid: rlTrainingLogs.stateBid,
    stateContext: rlTrainingLogs.stateContext,
    actionBidBefore: rlTrainingLogs.actionBidBefore,
    actionBidAfter: rlTrainingLogs.actionBidAfter,
    reward: rlTrainingLogs.reward,
    episodeId: rlTrainingLogs.episodeId,
    stepIndex: rlTrainingLogs.stepIndex,
    isTerminal: rlTrainingLogs.isTerminal,
  }).from(rlTrainingLogs)
    .where(and(
      eq(rlTrainingLogs.accountId, accountId),
      isNotNull(rlTrainingLogs.reward),
      isNotNull(rlTrainingLogs.rewardFilledAt)
    ))
    .orderBy(sql`episode_id ASC, step_index ASC`)
    .limit(10000);
  
  if (trainingData.length < 20) {
    log.info(`[CQL] Insufficient training data (${trainingData.length}), skipping`);
    return model;
  }
  
  // v274: 数据质量验证 — 过滤异常值和无效样本
  const validData = trainingData.filter(d => {
    const reward = Number(d.reward) || 0;
    const bidBefore = Number(d.actionBidBefore) || 0;
    const bidAfter = Number(d.actionBidAfter) || 0;
    // 过滤极端奖励（超过3个标准差的异常值）
    if (Math.abs(reward) > 100) return false;
    // 过滤无效出价
    if (bidBefore <= 0 || bidAfter <= 0) return false;
    // 过滤出价变化超过100%的异常记录
    if (bidBefore > 0 && Math.abs(bidAfter - bidBefore) / bidBefore > 1.0) return false;
    return true;
  });
  
  const filteredCount = trainingData.length - validData.length;
  if (filteredCount > 0) {
    log.info(`[CQL] v274: 数据质量过滤: ${filteredCount}/${trainingData.length}条异常样本被移除`);
  }
  
  if (validData.length < 20) {
    log.info(`[CQL] v274: 过滤后数据不足(${validData.length}), skipping`);
    return model;
  }
  
  // v274: 奖励归一化 — 防止极端奖励主导训练
  // @ts-ignore
  const rewards = validData.map(d => Number(d.reward) || 0);
  // @ts-ignore
  const rewardMean = rewards.reduce((a: unknown, b: unknown) => a + b, 0) / rewards.length;
  // @ts-ignore
  const rewardStd = Math.sqrt(rewards.reduce((sum: number, r: Record<string, unknown>) => sum + (r - rewardMean) ** 2, 0) / rewards.length) || 1;
  
  // 使用validData替代trainingData进行后续处理
  const processedData = validData;
  
  // v230: 构建(s, a, r, s')序列 - 使用同一episode的下一步作为next state
  interface TrainingSample {
    state: number[];
    action: ActionIndex;
    reward: number;
    nextState: number[] | null;  // null表示终止状态
  }
  
  const samples: TrainingSample[] = [];
  for (let i = 0; i < processedData.length; i++) {
    const d = processedData[i];
    const context = d.stateContext as ContextFeatureVector | null;
    const state = buildStateVector(context, Number(d.stateBid) || 0);
    const action = bidDeltaToAction(Number(d.actionBidBefore) || 0, Number(d.actionBidAfter) || 0);
    // v274: 使用归一化奖励
    const rawReward = Number(d.reward) || 0;
    const reward = (rawReward - rewardMean) / rewardStd;
    
    // v230: 查找同一episode的下一步作为next state
    let nextState: number[] | null = null;
    if (d.isTerminal !== 1 && i + 1 < processedData.length) {
      const nextD = processedData[i + 1];
      if (nextD.episodeId === d.episodeId && (nextD.stepIndex || 0) > (d.stepIndex || 0)) {
        const nextContext = nextD.stateContext as ContextFeatureVector | null;
        nextState = buildStateVector(nextContext, Number(nextD.stateBid) || 0);
      }
    }
    // 如果找不到同一episode的next state，使用出价调整后的状态作为近似
    if (!nextState) {
      nextState = buildStateVector(context, Number(d.actionBidAfter) || Number(d.stateBid) || 0);
    }
    
    samples.push({ state, action, reward, nextState });
  }
  
  // 计算数据集中每个动作的平均Q值（用于CQL正则化）
  const actionCounts = Array(NUM_ACTIONS).fill(0);
  const actionQSums = Array(NUM_ACTIONS).fill(0);
  // @ts-ignore
  for (const sample of samples) {
    actionCounts[sample.action]++;
    actionQSums[sample.action] += computeQ(model.weights[sample.action], sample.state);
  }
  // @ts-ignore
  const dataAvgQ = actionQSums.map((sum: unknown, i: unknown) => actionCounts[i] > 0 ? sum / actionCounts[i] : 0);
  
  let totalLoss = 0;
  let totalSteps = 0;
  
  for (let epoch = 0; epoch < epochs; epoch++) {
    // 随机打乱
    const shuffled = [...samples].sort(() => Math.random() - 0.5);
    
    for (let i = 0; i < shuffled.length; i += batchSize) {
      const batch = shuffled.slice(i, i + batchSize);
      
      for (const sample of batch) {
        const { state, action, reward } = sample;
        
        // 当前Q值
        const currentQ = computeQ(model.weights[action], state);
        
        // v230: 使用真实的next state计算下一状态的最大Q值
        const nextS = sample.nextState || state; // 终止状态回退到当前状态
        const nextQValues = model.weights.map(w => computeQ(w, nextS));
        const maxNextQ = sample.nextState ? Math.max(...nextQValues) : 0; // 终止状态Q=0
        
        // TD目标
        const tdTarget = reward + gamma * maxNextQ;
        const tdError = tdTarget - currentQ;
        
        // CQL正则化项
        // 惩罚当前策略的Q值高于数据分布的Q值
        const policyQ = computeQ(model.weights[action], state);
        const cqlPenalty = policyQ - dataAvgQ[action];
        
        // 梯度更新
        for (let j = 0; j < STATE_DIM; j++) {
          // TD更新
          model.weights[action][j] += learningRate * tdError * state[j];
          // CQL正则化
          model.weights[action][j] -= learningRate * cqlAlpha * cqlPenalty * state[j];
        }
        
        totalLoss += tdError * tdError;
        totalSteps++;
      }
    }
  }
  
  model.trainingEpisodes += samples.length;
  model.trainingSteps += totalSteps;
  model.avgLoss = totalSteps > 0 ? totalLoss / totalSteps : 0;
  model.lastTrainedAt = new Date().toISOString();
  
  // v274: 模型质量评估
  model.qualityMetrics = evaluateModelQuality(model, samples);
  
  log.info(`[CQL] v274 Training complete: ${samples.length} samples(filtered ${filteredCount}), ${epochs} epochs, ` +
    `avgLoss=${model.avgLoss.toFixed(6)}, quality=${model.qualityMetrics.overallScore.toFixed(3)}`);
  return model;
}

/**
 * v274: 评估CQL模型质量
 */
function evaluateModelQuality(model: CQLModel, samples: { state: number[]; action: number; reward: number; nextState: number[] | null }[]): CQLQualityMetrics {
  // 1. Q值稳定性：检查Q值的方差是否在合理范围
  const qValues: number[] = [];
  // @ts-ignore
  for (const sample of samples.slice(0, 200)) {
    // @ts-ignore
    for (let a = 0; a < NUM_ACTIONS; a++) {
      qValues.push(computeQ(model.weights[a], sample.state));
    }
  }
  // @ts-ignore
  const qMean = qValues.reduce((a: unknown, b: unknown) => a + b, 0) / qValues.length;
  // @ts-ignore
  const qStd = Math.sqrt(qValues.reduce((sum: number, q: Record<string, unknown>) => sum + (q - qMean) ** 2, 0) / qValues.length);
  // Q值标准差在0.1-2.0之间为健康，过大或过小都不好
  const qValueStability = Math.max(0, Math.min(1, 1 - Math.abs(qStd - 0.5) / 2));
  
  // 2. 策略一致性：对相似状态是否给出相似决策
  let consistentPairs = 0;
  let totalPairs = 0;
  const sampleSubset = samples.slice(0, 100);
  for (let i = 0; i < sampleSubset.length; i++) {
    for (let j = i + 1; j < Math.min(i + 5, sampleSubset.length); j++) {
      const stateDistSq = sampleSubset[i].state.reduce((sum, v, k) => sum + (v - sampleSubset[j].state[k]) ** 2, 0);
      if (stateDistSq < 0.5) { // 相似状态
        const q1 = model.weights.map(w => computeQ(w, sampleSubset[i].state));
        const q2 = model.weights.map(w => computeQ(w, sampleSubset[j].state));
        const bestA1 = q1.indexOf(Math.max(...q1));
        const bestA2 = q2.indexOf(Math.max(...q2));
        if (bestA1 === bestA2) consistentPairs++;
        totalPairs++;
      }
    }
  }
  const policyConsistency = totalPairs > 0 ? consistentPairs / totalPairs : 0.5;
  
  // 3. 奖励相关性：Q值与实际奖励的相关度
  const predictedQ: number[] = [];
  const actualRewards: number[] = [];
  for (const sample of sampleSubset) {
    predictedQ.push(computeQ(model.weights[sample.action], sample.state));
    actualRewards.push(sample.reward);
  }
  const rewardCorrelation = Math.max(0, Math.min(1, Math.abs(pearsonCorrelation(predictedQ, actualRewards))));
  
  // 4. 动作多样性：避免退化到单一动作
  const actionCounts = Array(NUM_ACTIONS).fill(0);
  for (const sample of samples.slice(0, 500)) {
    const qVals = model.weights.map(w => computeQ(w, sample.state));
    const bestAction = qVals.indexOf(Math.max(...qVals));
    actionCounts[bestAction]++;
  }
  // @ts-ignore
  const totalActions = actionCounts.reduce((a: unknown, b: unknown) => a + b, 0);
  const maxActionPct = totalActions > 0 ? Math.max(...actionCounts) / totalActions : 1;
  const actionDiversity = 1 - maxActionPct; // 如果全选同一个动作，多样性为0
  
  // 5. 数据质量评分
  const dataQualityScore = Math.min(1, samples.length / 500); // 500条以上满分
  
  // 综合评分
  const overallScore = (
    qValueStability * 0.2 +
    policyConsistency * 0.25 +
    rewardCorrelation * 0.25 +
    actionDiversity * 0.15 +
    dataQualityScore * 0.15
  );
  
  return {
    qValueStability,
    policyConsistency,
    rewardCorrelation,
    actionDiversity,
    dataQualityScore,
    overallScore,
    evaluatedAt: new Date().toISOString(),
  };
// @ts-ignore
}

/**
 * v274: 皮尔逊相关系数
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  // @ts-ignore
  const xMean = x.slice(0, n).reduce((a: unknown, b: unknown) => a + b, 0) / n;
  // @ts-ignore
  const yMean = y.slice(0, n).reduce((a: unknown, b: unknown) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den > 0 ? num / den : 0;
}

// ==================== CQL决策 ====================

/**
 * 使用CQL模型做出出价决策
 */
export function cqlDecide(
  model: CQLModel,
  context: ContextFeatureVector | null,
  currentBid: number,
  temperature: number = 0.5
): CQLDecision {
  const state = buildStateVector(context, currentBid);
  
  // 计算每个动作的Q值
  const qValues = model.weights.map(w => computeQ(w, state));
  
  // 使用softmax策略（带温度参数）
  const probs = softmax(qValues, temperature);
  
  // 选择最高Q值的动作（利用模式）
  let bestAction = 3 as ActionIndex; // 默认hold
  let bestQ = -Infinity;
  for (let i = 0; i < NUM_ACTIONS; i++) {
    if (qValues[i] > bestQ) {
      bestQ = qValues[i];
      bestAction = i as ActionIndex;
    }
  }
  
  const bidMultiplier = 1 + ACTIONS[bestAction];
  const recommendedBid = Math.max(0.02, Math.round(currentBid * bidMultiplier * 100) / 100);
  
  // 安全约束
  const safeBid = Math.max(
    currentBid * 0.70,  // 最多降30%
    Math.min(currentBid * 1.30, recommendedBid)  // 最多加30%
  );
  
  // 置信度 = 最优动作的概率
  const confidence = probs[bestAction];
  
  // 如果最优动作概率不够高（<0.3），标记为保守
  const isConservative = confidence < 0.3;
  
  return {
    actionIndex: bestAction,
    bidMultiplier,
    recommendedBid: Math.round(safeBid * 100) / 100,
    qValues,
    confidence,
    isConservative,
  };
}

// ==================== v230: 模型持久化（内存缓存 + 数据库双层存储） ====================

// 内存缓存
// v329: 添加大小限制，最多缓存10个账户的模型，超出时删除最早的缓存
const modelCache = new Map<number, CQLModel>();
const MAX_MODEL_CACHE_SIZE = 10;

/**
 * v230: 从数据库加载CQL模型
 */
async function loadModelFromDb(accountId: number): Promise<CQLModel | null> {
  try {
    const db = await getDbInstance();
    // @ts-ignore
    const { cqlModels } = await import('../../drizzle/schema');
    
    const rows = await db.select().from(cqlModels)
      .where(eq(cqlModels.accountId, accountId))
      .orderBy(sql`model_version DESC`)
      .limit(1);
    
    if (rows.length === 0) return null;
    
    const row = rows[0] as unknown;
    // @ts-ignore
    const weights = JSON.parse(row.weights as string);
    
    // 验证权重矩阵维度
    if (!Array.isArray(weights) || weights.length !== NUM_ACTIONS) {
      log.warn(`[CQL] v230: Invalid model weights dimensions for account ${accountId}`);
      return null;
    }
    
    return {
      weights,
      // @ts-ignore
      trainingEpisodes: row.trainingEpisodes || 0,
      // @ts-ignore
      trainingSteps: row.trainingSteps || 0,
      // @ts-ignore
      avgLoss: Number(row.avgLoss) || 0,
      // @ts-ignore
      lastTrainedAt: row.lastTrainedAt || new Date().toISOString(),
    };
  } catch (error: any) {
    log.warn(`[CQL] v230: Failed to load model from DB:`, error);
    return null;
  }
}

/**
 * v230: 将CQL模型保存到数据库
 */
async function saveModelToDb(accountId: number, model: CQLModel): Promise<void> {
  try {
    const db = await getDbInstance();
    const { cqlModels } = await import('../../drizzle/schema');
    
    const weightsJson = JSON.stringify(model.weights);
    
    // 检查是否已存在
    const existing = await db.select({ id: cqlModels.id, modelVersion: cqlModels.modelVersion })
      .from(cqlModels)
      .where(eq(cqlModels.accountId, accountId))
      .limit(1);
    
    if (existing.length > 0) {
      // 更新现有模型
      await db.update(cqlModels)
        .set({
          weights: weightsJson,
          trainingEpisodes: model.trainingEpisodes,
          trainingSteps: model.trainingSteps,
          avgLoss: String(model.avgLoss),
          lastTrainedAt: model.lastTrainedAt,
          modelVersion: (existing[0].modelVersion || 1) + 1,
        } as Record<string, unknown>)
        .where(eq(cqlModels.id, existing[0].id));
    } else {
      // 插入新模型
      // @ts-expect-error - Drizzle query builder type
      await db.insert(cqlModels).values({
        accountId,
        weights: weightsJson,
        trainingEpisodes: model.trainingEpisodes,
        trainingSteps: model.trainingSteps,
        avgLoss: String(model.avgLoss),
        lastTrainedAt: model.lastTrainedAt,
        modelVersion: 1,
      } as Record<string, unknown>);
    }
    
    log.info(`[CQL] v230: Model saved to DB for account ${accountId}, episodes=${model.trainingEpisodes}`);
  } catch (error: any) {
    log.warn(`[CQL] v230: Failed to save model to DB:`, error);
  }
}

/**
 * v230: 获取或训练CQL模型（内存缓存 → 数据库 → 新训练）
 */
export async function getOrTrainCQLModel(accountId: number): Promise<CQLModel> {
  // 第1层：检查内存缓存
  const cached = modelCache.get(accountId);
  if (cached) {
    const age = Date.now() - new Date(cached.lastTrainedAt).getTime();
    if (age < 6 * 3600000) return cached;
  }
  
  // 第2层：从数据库加载
  const dbModel = await loadModelFromDb(accountId);
  if (dbModel) {
    const age = Date.now() - new Date(dbModel.lastTrainedAt).getTime();
    if (age < 6 * 3600000) {
      modelCache.set(accountId, dbModel);
      log.info(`[CQL] v230: Model loaded from DB for account ${accountId}`);
      return dbModel;
    }
    // 数据库模型过时，基于它继续训练
    const model = await trainCQL(accountId, dbModel);
    modelCache.set(accountId, model);
    await saveModelToDb(accountId, model);
    return model;
  }
  
  // 第3层：新训练
  const model = await trainCQL(accountId, cached || null);
  // v329: 缓存大小限制
  if (modelCache.size >= MAX_MODEL_CACHE_SIZE && !modelCache.has(accountId)) {
    const firstKey = modelCache.keys().next().value;
    if (firstKey !== undefined) modelCache.delete(firstKey);
  }
  modelCache.set(accountId, model);
  await saveModelToDb(accountId, model);
  return model;
}

/**
 * 使用CQL做出出价决策（高层接口）
 */
export async function makeCQLBidDecision(
  accountId: number,
  context: ContextFeatureVector | null,
  currentBid: number
): Promise<CQLDecision | null> {
  try {
    const model = await getOrTrainCQLModel(accountId);
    
    // v263: 降低CQL训练门槛从20到5，配合合成数据量让CQL更快可用
    if (model.trainingEpisodes < 5) {
      return null; // 训练数据不足
    }
    
    const decision = cqlDecide(model, context, currentBid);
    // v263: 修复CQL冷启动confidence过低问题
    // 当trainingEpisodes在5-50区间时，保证最低0.35的置信度
    if (decision && decision.confidence < 0.35 && model.trainingEpisodes >= 5) {
      decision.confidence = Math.max(0.35, decision.confidence);
    }
    return decision;
  } catch (error: any) {
    log.warn(`[CQL] Error making decision:`, error);
    return null;
  }
}
