import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('SigmoidCurveFitter');
/**
 * Sigmoid曲线拟合引擎 (Sigmoid Curve Fitter)
 * 
 * 核心创新：
 * 1. 用四参数Sigmoid替代对数模型拟合展现曲线: I(bid) = L / (1 + exp(-k*(bid - x0))) + b
 *    - L: 展现量上限（市场天花板）
 *    - k: 增长斜率（竞争敏感度）
 *    - x0: 拐点出价（竞争中位数）
 *    - b: 基础展现量（品牌自然流量）
 * 2. 基于Sigmoid曲线的利润最大化出价计算（解析解 + 数值优化）
 * 3. 支持增量利润边际分析（每增加$0.01出价的边际利润）
 * 4. 与因果推断模块集成，使用增量CVR替代历史CVR
 * 
 * 相比对数模型的优势：
 * - 对数模型: I = a*ln(bid) + c → 无上限，高出价区域严重高估
 * - Sigmoid模型: I = L/(1+exp(-k*(bid-x0))) + b → 有上限，更符合真实市场
 */
import { getDb } from "../db";
import { contextualFeatures, dailyPerformance, bidPerformanceHistory } from "../../drizzle/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

// ==================== 类型定义 ====================

export interface SigmoidParams {
  L: number;   // 展现量上限
  k: number;   // 增长斜率
  x0: number;  // 拐点出价
  b: number;   // 基础展现量
  r2: number;  // 拟合优度
}

export interface MarginalAnalysis {
  bid: number;
  impressions: number;
  marginalImpressions: number;  // 每增加$0.01的边际展现
  clicks: number;
  marginalClicks: number;
  revenue: number;
  cost: number;
  profit: number;
  marginalProfit: number;       // 每增加$0.01的边际利润
  roas: number;
  acos: number;
}

export interface SigmoidOptimalBid {
  optimalBid: number;
  maxProfit: number;
  marginalProfitAtOptimal: number;
  impressionCeiling: number;    // 展现量天花板
  competitionMidpoint: number;  // 竞争中位数（拐点）
  profitCurve: MarginalAnalysis[];
  confidence: number;
}

// ==================== Sigmoid拟合核心算法 ====================

/**
 * 四参数Sigmoid函数
 */
export function sigmoid(bid: number, params: SigmoidParams): number {
  return params.L / (1 + Math.exp(-params.k * (bid - params.x0))) + params.b;
}

/**
 * Sigmoid函数的一阶导数（边际展现量）
 */
export function sigmoidDerivative(bid: number, params: SigmoidParams): number {
  const expTerm = Math.exp(-params.k * (bid - params.x0));
  return params.L * params.k * expTerm / Math.pow(1 + expTerm, 2);
}

/**
 * Levenberg-Marquardt算法拟合Sigmoid曲线
 * 输入：(bid, impressions) 数据点对
 * 输出：最优Sigmoid参数
 */
export function fitSigmoidCurve(
  bids: number[],
  impressions: number[]
): SigmoidParams {
  const n = bids.length;
  
  if (n < 4) {
    // 数据不足，返回保守默认值
    const maxImp = impressions.length > 0 ? Math.max(...impressions) : 1000;
    const avgBid = bids.length > 0 ? bids.reduce((a: any, b: any) => a + b, 0) / bids.length : 1;
    return {
      L: maxImp * 2,
      k: 2,
      x0: avgBid,
      b: 0,
      r2: 0,
    };
  }
  
  // 初始参数估计
  const sortedByBid = bids.map((b: any, i: any) => ({ bid: b, imp: impressions[i] }))
    .sort((a: any, b: any) => a.bid - b.bid);
  
  const maxImp = Math.max(...impressions);
  const minImp = Math.min(...impressions);
  const medianBid = sortedByBid[Math.floor(n / 2)].bid;
  
  let L = (maxImp - minImp) * 1.5;
  let k = 3;
  let x0 = medianBid;
  let b = minImp * 0.5;
  
  // Levenberg-Marquardt迭代
  let lambda = 0.01;
  const maxIter = 200;
  const tolerance = 1e-8;
  
  for (let iter = 0; iter < maxIter; iter++) {
    // 计算残差和雅可比矩阵
    const residuals: number[] = [];
    const J: number[][] = [];  // 雅可比矩阵 n×4
    
    for (let i = 0; i < n; i++) {
      const bid = bids[i];
      const expTerm = Math.exp(-k * (bid - x0));
      const denom = 1 + expTerm;
      const predicted = L / denom + b;
      residuals.push(impressions[i] - predicted);
      
      // 偏导数
      const dL = 1 / denom;
      const dk = L * (bid - x0) * expTerm / (denom * denom);
      const dx0 = -L * k * expTerm / (denom * denom);
      const db = 1;
      
      J.push([dL, dk, dx0, db]);
    }
    
    // J^T * J
    const JTJ = Array.from({ length: 4 }, () => Array(4).fill(0));
    const JTr = Array(4).fill(0);
    
    for (let i = 0; i < n; i++) {
      for (let p = 0; p < 4; p++) {
        JTr[p] += J[i][p] * residuals[i];
        for (let q = 0; q < 4; q++) {
          JTJ[p][q] += J[i][p] * J[i][q];
        }
      }
    }
    
    // 添加阻尼项: (J^T*J + λ*diag(J^T*J)) * δ = J^T*r
    for (let p = 0; p < 4; p++) {
      JTJ[p][p] *= (1 + lambda);
    }
    
    // 解4×4线性方程组（高斯消元）
    const delta = solveLinearSystem(JTJ, JTr);
    if (!delta) break;
    
    // 更新参数
    const newL = L + delta[0];
    const newK = k + delta[1];
    const newX0 = x0 + delta[2];
    const newB = b + delta[3];
    
    // 计算新残差
    let oldSSR = 0, newSSR = 0;
    for (let i = 0; i < n; i++) {
      oldSSR += residuals[i] * residuals[i];
      const newPred = newL / (1 + Math.exp(-newK * (bids[i] - newX0))) + newB;
      newSSR += (impressions[i] - newPred) ** 2;
    }
    
    if (newSSR < oldSSR) {
      // 接受更新
      L = Math.max(newL, maxImp * 0.5);  // L不能太小
      k = Math.max(newK, 0.1);           // k必须为正
      x0 = newX0;
      b = Math.max(newB, 0);             // b不能为负
      lambda *= 0.5;
      
      if (Math.abs(oldSSR - newSSR) / Math.max(oldSSR, 1) < tolerance) break;
    } else {
      lambda *= 2;
    }
  }
  
  // 计算R²
  const meanImp = impressions.reduce((a: any, b: any) => a + b, 0) / n;
  let ssTotal = 0, ssResidual = 0;
  for (let i = 0; i < n; i++) {
    ssTotal += (impressions[i] - meanImp) ** 2;
    const predicted = L / (1 + Math.exp(-k * (bids[i] - x0))) + b;
    ssResidual += (impressions[i] - predicted) ** 2;
  }
  const r2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;
  
  return {
    L: Math.round(L * 100) / 100,
    k: Math.round(k * 10000) / 10000,
    x0: Math.round(x0 * 10000) / 10000,
    b: Math.round(b * 100) / 100,
    r2: Math.max(0, Math.min(1, r2)),
  };
}

/**
 * 高斯消元法解线性方程组 Ax = b
 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const aug = A.map((row: any, i: any) => [...row, b[i]]);
  
  for (let col = 0; col < n; col++) {
    // 选主元
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    
    if (Math.abs(aug[col][col]) < 1e-12) return null;
    
    // 消元
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }
  
  // 回代
  const x = Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    x[row] = aug[row][n];
    for (let col = row + 1; col < n; col++) {
      x[row] -= aug[row][col] * x[col];
    }
    x[row] /= aug[row][row];
  }
  
  return x;
}

// ==================== 利润最大化出价计算 ====================

/**
 * 基于Sigmoid曲线的利润最大化出价计算
 * 
 * 利润函数: Profit(bid) = Impressions(bid) × CTR × CVR × AOV - Impressions(bid) × CTR × CPC(bid)
 * 简化: Profit(bid) = I(bid) × CTR × (CVR × AOV - CPC(bid))
 * 
 * 其中 CPC(bid) ≈ bid × cpcRatio (CPC通常是bid的某个比例)
 */
export function calculateSigmoidOptimalBid(
  sigmoidParams: SigmoidParams,
  ctr: number,
  cvr: number,
  aov: number,
  cpcRatio: number = 0.7,  // CPC/bid比率
  bidRange: [number, number] = [0.02, 10]
): SigmoidOptimalBid {
  const [minBid, maxBid] = bidRange;
  const step = 0.01;
  
  let bestBid = minBid;
  let maxProfit = -Infinity;
  const profitCurve: MarginalAnalysis[] = [];
  
  let prevProfit = 0;
  let prevImpressions = 0;
  let prevClicks = 0;
  
  for (let bid = minBid; bid <= maxBid; bid += step) {
    const impressions = sigmoid(bid, sigmoidParams);
    const cpc = bid * cpcRatio;
    const clicks = impressions * ctr;
    const orders = clicks * cvr;
    const revenue = orders * aov;
    const cost = clicks * cpc;
    const profit = revenue - cost;
    
    const marginalImpressions = (impressions - prevImpressions) / step;
    const marginalClicks = (clicks - prevClicks) / step;
    const marginalProfit = (profit - prevProfit) / step;
    
    // 每$0.10记录一个数据点（减少数据量）
    if (Math.round(bid * 100) % 10 === 0) {
      profitCurve.push({
        bid: Math.round(bid * 100) / 100,
        impressions: Math.round(impressions),
        marginalImpressions: Math.round(marginalImpressions),
        clicks: Math.round(clicks * 10) / 10,
        marginalClicks: Math.round(marginalClicks * 100) / 100,
        revenue: Math.round(revenue * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        marginalProfit: Math.round(marginalProfit * 100) / 100,
        roas: cost > 0 ? Math.round(revenue / cost * 100) / 100 : 0,
        acos: revenue > 0 ? Math.round(cost / revenue * 10000) / 10000 : 0,
      });
    }
    
    if (profit > maxProfit) {
      maxProfit = profit;
      bestBid = bid;
    }
    
    prevProfit = profit;
    prevImpressions = impressions;
    prevClicks = clicks;
  }
  
  // 精确搜索（黄金分割法）
  const optimalBid = goldenSectionSearchMax(
    (bid) => {
      const imp = sigmoid(bid, sigmoidParams);
      const clicks = imp * ctr;
      return clicks * (cvr * aov - bid * cpcRatio);
    },
    Math.max(minBid, bestBid - 0.1),
    Math.min(maxBid, bestBid + 0.1)
  );
  
  const optImp = sigmoid(optimalBid, sigmoidParams);
  const optClicks = optImp * ctr;
  const optProfit = optClicks * (cvr * aov - optimalBid * cpcRatio);
  
  // 在最优点的边际利润
  const eps = 0.001;
  const profitPlus = (() => {
    const imp = sigmoid(optimalBid + eps, sigmoidParams);
    const clicks = imp * ctr;
    return clicks * (cvr * aov - (optimalBid + eps) * cpcRatio);
  })();
  const marginalProfitAtOptimal = (profitPlus - optProfit) / eps;
  
  return {
    optimalBid: Math.round(optimalBid * 100) / 100,
    maxProfit: Math.round(optProfit * 100) / 100,
    marginalProfitAtOptimal: Math.round(marginalProfitAtOptimal * 100) / 100,
    impressionCeiling: Math.round(sigmoidParams.L + sigmoidParams.b),
    competitionMidpoint: Math.round(sigmoidParams.x0 * 100) / 100,
    profitCurve,
    confidence: sigmoidParams.r2,
  };
}

/**
 * 黄金分割法搜索最大值
 */
function goldenSectionSearchMax(
  f: (x: number) => number,
  a: number,
  b: number,
  tolerance: number = 0.001
): number {
  const phi = (1 + Math.sqrt(5)) / 2;
  const resphi = 2 - phi;
  
  let x1 = a + resphi * (b - a);
  let x2 = b - resphi * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  
  let iterations = 0;
  while (Math.abs(b - a) > tolerance && iterations < 100) {
    if (f1 < f2) {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = b - resphi * (b - a);
      f2 = f(x2);
    } else {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = a + resphi * (b - a);
      f1 = f(x1);
    }
    iterations++;
  }
  
  return (a + b) / 2;
}

// ==================== 数据库集成 ====================

async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

/**
 * 为关键词/定位拟合Sigmoid曲线并缓存到contextual_features表
 */
export async function fitAndCacheSigmoidForEntity(
  accountId: number,
  entityType: 'keyword' | 'target',
  entityId: number,
  campaignId: string,
  daysBack: number = 30
): Promise<SigmoidParams | null> {
  const db = await getDbInstance();
  const startDate = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];
  
  // 从bid_performance_history获取历史出价-展现数据
  const historyData = await db.select({
    bid: bidPerformanceHistory.bid,
    impressions: bidPerformanceHistory.impressions,
  }).from(bidPerformanceHistory)
    .where(and(
      eq(bidPerformanceHistory.accountId, accountId),
      eq(bidPerformanceHistory.bidObjectType, entityType === 'target' ? 'asin' : entityType),
      eq(bidPerformanceHistory.bidObjectId, String(entityId)),
      gte(bidPerformanceHistory.date, startDate)
    ));
  
  if (historyData.length < 4) {
    return null;
  }
  
  const bids = historyData.map(h => Number(h.bid));
  const impressions = historyData.map(h => Number(h.impressions));
  
  const params = fitSigmoidCurve(bids, impressions);
  
  // 缓存到contextual_features表
  const today = new Date().toISOString().split('T')[0];
  try {
    await db.update(contextualFeatures)
      .set({
        sigmoidL: String(params.L),
        sigmoidK: String(params.k),
        sigmoidX0: String(params.x0),
        sigmoidB: String(params.b),
        curveFitR2: String(params.r2),
        curveUpdatedAt: new Date().toISOString(),
      })
      .where(and(
        eq(contextualFeatures.accountId, accountId),
        entityType === 'keyword'
          ? eq(contextualFeatures.keywordId, entityId)
          : eq(contextualFeatures.targetId, entityId),
        eq(contextualFeatures.snapshotDate, today)
      ));
  } catch (e) {
    log.error(`[SigmoidCurveFitter] Failed to cache sigmoid params:`, e);
  }
  
  return params;
}

/**
 * 批量拟合所有活跃实体的Sigmoid曲线
 */
export async function batchFitSigmoidCurves(accountId: number): Promise<{
  fitted: number;
  skipped: number;
  errors: number;
}> {
  const db = await getDbInstance();
  const result = { fitted: 0, skipped: 0, errors: 0 };
  
  // 获取有足够历史数据的实体
  const entities = await db.select({
    bidObjectType: bidPerformanceHistory.bidObjectType,
    bidObjectId: bidPerformanceHistory.bidObjectId,
    dataPoints: sql<number>`COUNT(*)`,
  }).from(bidPerformanceHistory)
    .where(eq(bidPerformanceHistory.accountId, accountId))
    .groupBy(bidPerformanceHistory.bidObjectType, bidPerformanceHistory.bidObjectId)
    .having(sql`COUNT(*) >= 4`);
  
  for (const entity of entities) {
    try {
      const entityType = entity.bidObjectType as 'keyword' | 'target';
      const entityId = Number(entity.bidObjectId);
      
      const params = await fitAndCacheSigmoidForEntity(
        accountId, entityType, entityId, ''
      );
      
      if (params && params.r2 > 0.3) {
        result.fitted++;
      } else {
        result.skipped++;
      }
    } catch (e) {
      result.errors++;
    }
  }
  
  log.info(`[SigmoidCurveFitter] Batch fit: ${result.fitted} fitted, ${result.skipped} skipped, ${result.errors} errors`);
  return result;
}
