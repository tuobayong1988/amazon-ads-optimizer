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
import { getDb } from "./db";
import { rlTrainingLogs } from "../drizzle/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { featureVectorToArray, FEATURE_DIM, type ContextFeatureVector } from "./contextualFeatureService";

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
  const sumExps = exps.reduce((a, b) => a + b, 0);
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
  
  // 加载训练数据
  const trainingData = await db.select({
    stateBid: rlTrainingLogs.stateBid,
    stateContext: rlTrainingLogs.stateContext,
    actionBidBefore: rlTrainingLogs.actionBidBefore,
    actionBidAfter: rlTrainingLogs.actionBidAfter,
    reward: rlTrainingLogs.reward,
  }).from(rlTrainingLogs)
    .where(and(
      eq(rlTrainingLogs.accountId, accountId),
      isNotNull(rlTrainingLogs.reward),
      isNotNull(rlTrainingLogs.rewardFilledAt)
    ))
    .orderBy(sql`created_at DESC`)
    .limit(10000);
  
  if (trainingData.length < 20) {
    console.log(`[CQL] Insufficient training data (${trainingData.length}), skipping`);
    return model;
  }
  
  // 转换为训练样本
  const samples = trainingData.map(d => {
    const context = d.stateContext as ContextFeatureVector | null;
    const state = buildStateVector(context, Number(d.stateBid) || 0);
    const action = bidDeltaToAction(Number(d.actionBidBefore) || 0, Number(d.actionBidAfter) || 0);
    const reward = Number(d.reward) || 0;
    return { state, action, reward };
  });
  
  // 计算数据集中每个动作的平均Q值（用于CQL正则化）
  const actionCounts = Array(NUM_ACTIONS).fill(0);
  const actionQSums = Array(NUM_ACTIONS).fill(0);
  for (const sample of samples) {
    actionCounts[sample.action]++;
    actionQSums[sample.action] += computeQ(model.weights[sample.action], sample.state);
  }
  const dataAvgQ = actionQSums.map((sum, i) => actionCounts[i] > 0 ? sum / actionCounts[i] : 0);
  
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
        
        // 下一状态的最大Q值（简化：使用当前状态作为下一状态的近似）
        const nextQValues = model.weights.map(w => computeQ(w, state));
        const maxNextQ = Math.max(...nextQValues);
        
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
  
  console.log(`[CQL] Training complete: ${samples.length} samples, ${epochs} epochs, avgLoss=${model.avgLoss.toFixed(6)}`);
  return model;
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

// ==================== 模型持久化 ====================

// 内存缓存
const modelCache = new Map<number, CQLModel>();

/**
 * 获取或训练CQL模型
 */
export async function getOrTrainCQLModel(accountId: number): Promise<CQLModel> {
  // 检查缓存
  const cached = modelCache.get(accountId);
  if (cached) {
    // 如果模型不超过6小时，直接使用
    const age = Date.now() - new Date(cached.lastTrainedAt).getTime();
    if (age < 6 * 3600000) return cached;
  }
  
  // 训练新模型
  const model = await trainCQL(accountId, cached);
  modelCache.set(accountId, model);
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
    
    if (model.trainingEpisodes < 20) {
      return null; // 训练数据不足
    }
    
    return cqlDecide(model, context, currentBid);
  } catch (error) {
    console.error(`[CQL] Error making decision:`, error);
    return null;
  }
}
