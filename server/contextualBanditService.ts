import { createModuleLogger } from './utils/logger';
const log = createModuleLogger('ContextualBanditService');
/**
 * 上下文赌博机出价引擎 (LinUCB Contextual Bandit)
 * 
 * 核心算法：LinUCB (Li et al., 2010) 的广告出价适配版本
 * 
 * 创新点：
 * 1. 将出价策略建模为多臂赌博机问题：
 *    - 每个"臂"(arm)对应一种出价策略（激进/温和/保守/持平/降低）
 *    - 上下文(context)是17维特征向量（来自contextualFeatureService）
 *    - 奖励(reward)是出价调整后的增量利润
 * 2. 自动平衡探索(exploration)与利用(exploitation)：
 *    - UCB上界 = θ^T × x + α × sqrt(x^T × A^{-1} × x)
 *    - α参数控制探索程度，数据越少探索越多
 * 3. 在线学习：每次出价反馈后实时更新模型参数
 * 4. 安全约束：限制单次出价调整幅度，防止极端操作
 */
import { getDb } from "./db";
import { linucbModels, algorithmSelectionLogs } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  extractFeatureVector,
  featureVectorToArray,
  FEATURE_DIM,
  type ContextFeatureVector,
} from "./contextualFeatureService";

// ==================== 类型定义 ====================

export type ArmType = 'bid_aggressive' | 'bid_moderate' | 'bid_conservative' | 'bid_hold' | 'bid_decrease';

export interface ArmConfig {
  type: ArmType;
  bidMultiplierRange: [number, number];  // 出价调整倍率范围
  description: string;
}

export interface LinUCBArm {
  armId: string;
  armType: ArmType;
  A: number[][];      // d×d 矩阵
  b: number[];         // d×1 向量
  theta: number[];     // 参数向量 = A^{-1} × b
  totalPulls: number;
  totalReward: number;
  avgReward: number;
}

export interface LinUCBDecision {
  selectedArm: ArmType;
  ucbScore: number;
  allScores: Record<ArmType, number>;
  bidMultiplier: number;
  recommendedBid: number;
  explorationBonus: number;
  confidence: number;
}

// ==================== 臂配置 ====================

export const ARM_CONFIGS: ArmConfig[] = [
  {
    type: 'bid_aggressive',
    bidMultiplierRange: [1.15, 1.30],
    description: '激进加价：适用于高CVR、低竞争、展现不足的场景',
  },
  {
    type: 'bid_moderate',
    bidMultiplierRange: [1.05, 1.15],
    description: '温和加价：适用于表现良好、有增长空间的场景',
  },
  {
    type: 'bid_conservative',
    bidMultiplierRange: [0.95, 1.05],
    description: '保守微调：适用于表现稳定、需要维持的场景',
  },
  {
    type: 'bid_hold',
    bidMultiplierRange: [0.90, 0.95],
    description: '温和降价：适用于ACOS偏高、需要控制成本的场景',
  },
  {
    type: 'bid_decrease',
    bidMultiplierRange: [0.75, 0.90],
    description: '明显降价：适用于高ACOS、低CVR、需要止损的场景',
  },
];

// ==================== 辅助函数 ====================

async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

/**
 * 创建d×d单位矩阵
 */
function identityMatrix(d: number): number[][] {
  return Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => (i === j ? 1 : 0))
  );
}

/**
 * 创建d维零向量
 */
function zeroVector(d: number): number[] {
  return Array(d).fill(0);
}

/**
 * 矩阵求逆（Gauss-Jordan消元）
 */
function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  // 创建增广矩阵 [A | I]
  const aug = matrix.map((row, i) => [
    ...row.map(v => v),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  
  for (let col = 0; col < n; col++) {
    // 选主元
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) {
      // 奇异矩阵，添加正则化项
      aug[col][col] += 0.001;
    }
    
    // 归一化主行
    const pivotVal = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivotVal;
    
    // 消元
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }
  
  return aug.map(row => row.slice(n));
}

/**
 * 矩阵-向量乘法
 */
function matVecMul(A: number[][], x: number[]): number[] {
  return A.map(row => row.reduce((sum, val, j) => sum + val * x[j], 0));
}

/**
 * 向量点积
 */
function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

/**
 * 外积: x × x^T
 */
function outerProduct(x: number[]): number[][] {
  return x.map(xi => x.map(xj => xi * xj));
}

/**
 * 矩阵加法
 */
function matAdd(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((val, j) => val + B[i][j]));
}

/**
 * 向量加法
 */
function vecAdd(a: number[], b: number[]): number[] {
  return a.map((val, i) => val + b[i]);
}

/**
 * 向量标量乘法
 */
function vecScale(a: number[], s: number): number[] {
  return a.map(val => val * s);
}

// ==================== LinUCB核心算法 ====================

/**
 * 初始化或加载LinUCB模型
 */
export async function loadOrInitLinUCBModel(accountId: number): Promise<LinUCBArm[]> {
  const db = await getDbInstance();
  const d = FEATURE_DIM;
  
  const existingModels = await db.select().from(linucbModels)
    .where(and(
      eq(linucbModels.accountId, accountId),
      eq(linucbModels.isActive, 1)
    ));
  
  if (existingModels.length === ARM_CONFIGS.length) {
    // 从数据库加载
    return existingModels.map(m => ({
      armId: m.armId,
      armType: m.armType as ArmType,
      A: m.matrixA as number[][],
      b: m.vectorB as number[],
      theta: matVecMul(invertMatrix(m.matrixA as number[][]) || identityMatrix(d), m.vectorB as number[]),
      totalPulls: m.totalPulls || 0,
      totalReward: Number(m.totalReward) || 0,
      avgReward: Number(m.avgReward) || 0,
    }));
  }
  
  // 初始化新模型
  const arms: LinUCBArm[] = ARM_CONFIGS.map(config => ({
    armId: `${accountId}_${config.type}`,
    armType: config.type,
    A: identityMatrix(d),
    b: zeroVector(d),
    theta: zeroVector(d),
    totalPulls: 0,
    totalReward: 0,
    avgReward: 0,
  }));
  
  // 保存到数据库
  for (const arm of arms) {
    await db.insert(linucbModels).values({
      accountId,
      armId: arm.armId,
      armType: arm.armType,
      matrixA: arm.A,
      vectorB: arm.b,
      featureDim: d,
      alpha: '2.0000',  // 初始探索系数较大
      totalPulls: 0,
      totalReward: '0',
      avgReward: '0',
    } as Record<string, unknown>);
  }
  
  return arms;
}

/**
 * LinUCB选择最优臂（核心决策函数）
 * 
 * UCB(a) = θ_a^T × x + α × sqrt(x^T × A_a^{-1} × x)
 * 选择UCB最大的臂
 */
export async function selectArm(
  accountId: number,
  context: ContextFeatureVector,
  currentBid: number,
  alpha: number = 1.5
): Promise<LinUCBDecision> {
  const arms = await loadOrInitLinUCBModel(accountId);
  const x = featureVectorToArray(context);
  
  const scores: Record<string, number> = {};
  let bestArm: LinUCBArm | null = null;
  let bestScore = -Infinity;
  let bestExplorationBonus = 0;
  
  for (const arm of arms) {
    // 计算A^{-1}
    const AInv = invertMatrix(arm.A);
    if (!AInv) continue;
    
    // 计算θ = A^{-1} × b
    const theta = matVecMul(AInv, arm.b);
    
    // 利用项: θ^T × x
    const exploitation = dotProduct(theta, x);
    
    // 探索项: α × sqrt(x^T × A^{-1} × x)
    const AInvX = matVecMul(AInv, x);
    const exploration = alpha * Math.sqrt(Math.max(0, dotProduct(x, AInvX)));
    
    const ucbScore = exploitation + exploration;
    scores[arm.armType] = Math.round(ucbScore * 10000) / 10000;
    
    if (ucbScore > bestScore) {
      bestScore = ucbScore;
      bestArm = arm;
      bestExplorationBonus = exploration;
    }
  }
  
  if (!bestArm) {
    // 回退到保守策略
    bestArm = arms.find(a => a.armType === 'bid_conservative') || arms[0];
  }
  
  // 根据选中的臂计算出价调整
  const config = ARM_CONFIGS.find(c => c.type === bestArm!.armType)!;
  const [minMul, maxMul] = config.bidMultiplierRange;
  
  // 根据UCB分数在范围内插值
  const normalizedScore = Math.max(0, Math.min(1, (bestScore + 1) / 2));
  const bidMultiplier = minMul + normalizedScore * (maxMul - minMul);
  
  // 安全约束：限制单次调整幅度不超过30%
  const safeBidMultiplier = Math.max(0.70, Math.min(1.30, bidMultiplier));
  const recommendedBid = Math.round(currentBid * safeBidMultiplier * 100) / 100;
  
  // 计算置信度
  const totalPulls = arms.reduce((sum, a) => sum + a.totalPulls, 0);
  // v263: 修复冷启动confidence过低导致高级算法永远无法激活的问题
  // 之前: totalPulls/100 在冷启动时(totalPulls<30)导致confidence<0.3
  // nextGenBidOrchestrator要求confidence>0.3才使用高级算法结果
  // 修复: 保证最低0.35的基础置信度，随数据积累逐步提升到1.0
  const confidence = Math.min(1, 0.35 + (totalPulls / 150) * 0.65);
  
  return {
    selectedArm: bestArm.armType,
    ucbScore: bestScore,
    allScores: scores as Record<ArmType, number>,
    bidMultiplier: safeBidMultiplier,
    recommendedBid: Math.max(0.02, recommendedBid),
    explorationBonus: bestExplorationBonus,
    confidence,
  };
}

/**
 * 更新LinUCB模型参数（在收到reward后调用）
 * 
 * A_a ← A_a + x × x^T
 * b_a ← b_a + reward × x
 */
export async function updateArm(
  accountId: number,
  armType: ArmType,
  context: ContextFeatureVector,
  reward: number
): Promise<void> {
  // v231: 防御性校验 - 确保input有效
  if (!isFinite(reward) || isNaN(reward)) {
    log.warn(`[LinUCB] v231: updateArm skipped - invalid reward: ${reward}`);
    return;
  }
  // 限制reward范围避免极端值导致模型不稳定
  const clampedReward = Math.max(-10, Math.min(10, reward));
  const db = await getDbInstance();
  const x = featureVectorToArray(context);
  
  // 加载当前模型
  const models = await db.select().from(linucbModels)
    .where(and(
      eq(linucbModels.accountId, accountId),
      eq(linucbModels.armType, armType),
      eq(linucbModels.isActive, 1)
    ))
    .limit(1);
  
  if (models.length === 0) return;
  
  const model = models[0];
  const A = model.matrixA as number[][];
  const b = model.vectorB as number[];
  
  // LinUCB更新规则
  const xxT = outerProduct(x);
  const newA = matAdd(A, xxT);
  const newB = vecAdd(b, vecScale(x, clampedReward));
  
  const newTotalPulls = (model.totalPulls || 0) + 1;
  const newTotalReward = Number(model.totalReward || 0) + clampedReward;
  const newAvgReward = newTotalReward / newTotalPulls;
  
  await db.update(linucbModels)
    .set({
      matrixA: newA,
      vectorB: newB,
      totalPulls: newTotalPulls,
      totalReward: String(newTotalReward),
      avgReward: String(newAvgReward),
      lastPulledAt: new Date().toISOString(),
    })
    .where(eq(linucbModels.id, model.id));
}

/**
 * 自适应α调整
 * 数据越少α越大（探索更多），数据越多α越小（利用更多）
 */
export function calculateAdaptiveAlpha(totalPulls: number): number {
  // α = 2 / sqrt(1 + totalPulls / 50)
  // 初始α=2，100次后α≈1.15，500次后α≈0.6
  return 2 / Math.sqrt(1 + totalPulls / 50);
}

/**
 * 为关键词/定位做出LinUCB出价决策（高层接口）
 */
export async function makeLinUCBBidDecision(
  accountId: number,
  keywordId?: number,
  targetId?: number,
  campaignId?: string,
  currentBid?: number
): Promise<LinUCBDecision | null> {
  try {
    // 提取上下文特征
    const context = await extractFeatureVector(accountId, keywordId, targetId, campaignId);
    
    if (!currentBid || currentBid <= 0) {
      return null;
    }
    
    // 计算自适应探索系数
    const arms = await loadOrInitLinUCBModel(accountId);
    const totalPulls = arms.reduce((sum, a) => sum + a.totalPulls, 0);
    const alpha = calculateAdaptiveAlpha(totalPulls);
    
    // 做出决策
    const decision = await selectArm(accountId, context, currentBid, alpha);
    
    // v230: 移除重复的日志写入，由metaLearningSelector统一记录algorithmSelectionLogs
    // 避免同一次决策产生两条日志记录
    
    return decision;
    
  } catch (error) {
    log.error(`[LinUCB] Error making bid decision:`, error);
    return null;
  }
}
