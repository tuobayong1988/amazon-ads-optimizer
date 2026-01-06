/**
 * 决策树预测服务
 * 基于Adspert的决策树算法，预测关键词的转化率和转化价值
 * 特别适合长尾关键词的预测
 */

import { getDb } from "./db";
import { 
  decisionTreeModels, 
  keywordPredictions,
  keywords 
} from "../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

// 获取db实例的辅助函数
async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

// ==================== 类型定义 ====================

export interface KeywordFeatures {
  matchType: 'broad' | 'phrase' | 'exact';
  wordCount: number;
  keywordType: 'brand' | 'competitor' | 'generic' | 'product';
  avgBid: number;
  categoryId?: string;
  priceRange?: 'low' | 'medium' | 'high';
  competitionLevel?: 'low' | 'medium' | 'high';
}

export interface TreeNode {
  id: number;
  feature?: string;
  threshold?: number;
  operator?: '<=' | '>' | '==' | 'in';
  values?: string[]; // 用于分类特征
  left?: TreeNode;
  right?: TreeNode;
  isLeaf: boolean;
  prediction?: number;
  samples?: number;
  variance?: number;
}

export interface DecisionTreeConfig {
  maxDepth: number;
  minSamplesSplit: number;
  minSamplesLeaf: number;
  maxFeatures?: number;
}

export interface PredictionResult {
  predictedCR: number;
  predictedCV: number;
  crLow: number;
  crHigh: number;
  cvLow: number;
  cvHigh: number;
  confidence: number;
  sampleCount: number;
  predictionSource: 'historical' | 'decision_tree' | 'bayesian_update';
}

export interface TrainingData {
  features: KeywordFeatures;
  cr: number;
  cv: number;
}

// ==================== 决策树实现 ====================

/**
 * 计算方差
 */
function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
}

/**
 * 计算均值
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 计算标准差
 */
function calculateStdDev(values: number[]): number {
  return Math.sqrt(calculateVariance(values));
}

/**
 * 计算信息增益（用于分类特征）
 */
function calculateInformationGain(
  parentValues: number[],
  leftValues: number[],
  rightValues: number[]
): number {
  const parentVariance = calculateVariance(parentValues);
  const leftWeight = leftValues.length / parentValues.length;
  const rightWeight = rightValues.length / parentValues.length;
  
  const weightedChildVariance = 
    leftWeight * calculateVariance(leftValues) + 
    rightWeight * calculateVariance(rightValues);
  
  return parentVariance - weightedChildVariance;
}

/**
 * 找到最佳分割点（数值特征）
 */
function findBestNumericSplit(
  data: TrainingData[],
  feature: keyof KeywordFeatures,
  target: 'cr' | 'cv'
): { threshold: number; gain: number } | null {
  const values = data
    .map(d => ({ value: d.features[feature] as number, target: d[target] }))
    .filter(v => typeof v.value === 'number')
    .sort((a, b) => a.value - b.value);
  
  if (values.length < 2) return null;
  
  let bestGain = 0;
  let bestThreshold = 0;
  
  const allTargets = values.map(v => v.target);
  
  for (let i = 0; i < values.length - 1; i++) {
    const threshold = (values[i].value + values[i + 1].value) / 2;
    const leftTargets = values.slice(0, i + 1).map(v => v.target);
    const rightTargets = values.slice(i + 1).map(v => v.target);
    
    const gain = calculateInformationGain(allTargets, leftTargets, rightTargets);
    
    if (gain > bestGain) {
      bestGain = gain;
      bestThreshold = threshold;
    }
  }
  
  return bestGain > 0 ? { threshold: bestThreshold, gain: bestGain } : null;
}

/**
 * 找到最佳分割点（分类特征）
 */
function findBestCategoricalSplit(
  data: TrainingData[],
  feature: keyof KeywordFeatures,
  target: 'cr' | 'cv'
): { values: string[]; gain: number } | null {
  const categories = new Map<string, number[]>();
  
  for (const d of data) {
    const value = String(d.features[feature]);
    if (!categories.has(value)) {
      categories.set(value, []);
    }
    categories.get(value)!.push(d[target]);
  }
  
  if (categories.size < 2) return null;
  
  // 简化：选择表现最好的类别作为分割
  const allTargets = data.map(d => d[target]);
  let bestGain = 0;
  let bestValues: string[] = [];
  
  const categoryList = Array.from(categories.keys());
  
  // 尝试每个类别作为分割点
  for (const cat of categoryList) {
    const leftTargets = categories.get(cat)!;
    const rightTargets = data.filter(d => String(d.features[feature]) !== cat).map(d => d[target]);
    
    if (leftTargets.length === 0 || rightTargets.length === 0) continue;
    
    const gain = calculateInformationGain(allTargets, leftTargets, rightTargets);
    
    if (gain > bestGain) {
      bestGain = gain;
      bestValues = [cat];
    }
  }
  
  return bestGain > 0 ? { values: bestValues, gain: bestGain } : null;
}

/**
 * 构建决策树节点
 */
function buildTreeNode(
  data: TrainingData[],
  target: 'cr' | 'cv',
  depth: number,
  config: DecisionTreeConfig,
  nodeId: { current: number }
): TreeNode {
  const id = nodeId.current++;
  const targetValues = data.map(d => d[target]);
  
  // 终止条件
  if (
    depth >= config.maxDepth ||
    data.length < config.minSamplesSplit ||
    calculateVariance(targetValues) < 0.0001
  ) {
    return {
      id,
      isLeaf: true,
      prediction: calculateMean(targetValues),
      samples: data.length,
      variance: calculateVariance(targetValues)
    };
  }
  
  // 尝试所有特征找最佳分割
  const numericFeatures: (keyof KeywordFeatures)[] = ['wordCount', 'avgBid'];
  const categoricalFeatures: (keyof KeywordFeatures)[] = ['matchType', 'keywordType', 'priceRange', 'competitionLevel'];
  
  let bestFeature: keyof KeywordFeatures | null = null;
  let bestSplit: { threshold?: number; values?: string[]; operator: '<=' | '>' | '==' | 'in' } | null = null;
  let bestGain = 0;
  
  // 数值特征
  for (const feature of numericFeatures) {
    const split = findBestNumericSplit(data, feature, target);
    if (split && split.gain > bestGain) {
      bestGain = split.gain;
      bestFeature = feature;
      bestSplit = { threshold: split.threshold, operator: '<=' };
    }
  }
  
  // 分类特征
  for (const feature of categoricalFeatures) {
    const split = findBestCategoricalSplit(data, feature, target);
    if (split && split.gain > bestGain) {
      bestGain = split.gain;
      bestFeature = feature;
      bestSplit = { values: split.values, operator: 'in' };
    }
  }
  
  // 没有找到好的分割
  if (!bestFeature || !bestSplit) {
    return {
      id,
      isLeaf: true,
      prediction: calculateMean(targetValues),
      samples: data.length,
      variance: calculateVariance(targetValues)
    };
  }
  
  // 分割数据
  let leftData: TrainingData[];
  let rightData: TrainingData[];
  
  if (bestSplit.threshold !== undefined) {
    leftData = data.filter(d => (d.features[bestFeature!] as number) <= bestSplit!.threshold!);
    rightData = data.filter(d => (d.features[bestFeature!] as number) > bestSplit!.threshold!);
  } else {
    leftData = data.filter(d => bestSplit!.values!.includes(String(d.features[bestFeature!])));
    rightData = data.filter(d => !bestSplit!.values!.includes(String(d.features[bestFeature!])));
  }
  
  // 检查最小叶子节点样本数
  if (leftData.length < config.minSamplesLeaf || rightData.length < config.minSamplesLeaf) {
    return {
      id,
      isLeaf: true,
      prediction: calculateMean(targetValues),
      samples: data.length,
      variance: calculateVariance(targetValues)
    };
  }
  
  // 递归构建子树
  return {
    id,
    feature: bestFeature,
    threshold: bestSplit.threshold,
    operator: bestSplit.operator,
    values: bestSplit.values,
    left: buildTreeNode(leftData, target, depth + 1, config, nodeId),
    right: buildTreeNode(rightData, target, depth + 1, config, nodeId),
    isLeaf: false,
    samples: data.length
  };
}

/**
 * 使用决策树进行预测
 */
function predictWithTree(node: TreeNode, features: KeywordFeatures): { prediction: number; samples: number; variance: number } {
  if (node.isLeaf) {
    return {
      prediction: node.prediction || 0,
      samples: node.samples || 0,
      variance: node.variance || 0
    };
  }
  
  let goLeft = false;
  
  if (node.threshold !== undefined && node.feature) {
    const value = features[node.feature as keyof KeywordFeatures] as number;
    goLeft = value <= node.threshold;
  } else if (node.values && node.feature) {
    const value = String(features[node.feature as keyof KeywordFeatures]);
    goLeft = node.values.includes(value);
  }
  
  if (goLeft && node.left) {
    return predictWithTree(node.left, features);
  } else if (node.right) {
    return predictWithTree(node.right, features);
  }
  
  return { prediction: 0, samples: 0, variance: 0 };
}

/**
 * 计算树的深度
 */
function getTreeDepth(node: TreeNode): number {
  if (node.isLeaf) return 1;
  const leftDepth = node.left ? getTreeDepth(node.left) : 0;
  const rightDepth = node.right ? getTreeDepth(node.right) : 0;
  return 1 + Math.max(leftDepth, rightDepth);
}

/**
 * 计算叶子节点数量
 */
function countLeaves(node: TreeNode): number {
  if (node.isLeaf) return 1;
  const leftLeaves = node.left ? countLeaves(node.left) : 0;
  const rightLeaves = node.right ? countLeaves(node.right) : 0;
  return leftLeaves + rightLeaves;
}

/**
 * 计算特征重要性
 */
function calculateFeatureImportance(node: TreeNode, importance: Map<string, number>, totalSamples: number): void {
  if (node.isLeaf || !node.feature) return;
  
  const currentImportance = importance.get(node.feature) || 0;
  const sampleRatio = (node.samples || 0) / totalSamples;
  
  // 简化的重要性计算：基于分割的样本比例
  importance.set(node.feature, currentImportance + sampleRatio);
  
  if (node.left) calculateFeatureImportance(node.left, importance, totalSamples);
  if (node.right) calculateFeatureImportance(node.right, importance, totalSamples);
}

// ==================== 服务函数 ====================

/**
 * 训练决策树模型
 */
export async function trainDecisionTreeModel(
  accountId: number,
  modelType: 'cr_prediction' | 'cv_prediction',
  config: DecisionTreeConfig = {
    maxDepth: 6,
    minSamplesSplit: 10,
    minSamplesLeaf: 5
  }
): Promise<{
  tree: TreeNode;
  depth: number;
  leafCount: number;
  featureImportance: Record<string, number>;
  trainingR2: number;
  totalSamples: number;
}> {
  const db = await getDbInstance();
  // 获取训练数据
  const keywordData = await db
    .select()
    .from(keywords)
    .where(eq(keywords.keywordStatus, 'enabled'))
    .limit(5000);
  
  // 转换为训练数据格式
  const trainingData: TrainingData[] = keywordData
    .filter(k => (k.clicks || 0) > 0) // 只使用有点击数据的关键词
    .map(k => {
      const wordCount = k.keywordText.split(' ').length;
      const avgBid = Number(k.bid) || 1;
      
      // 简单的关键词类型分类
      let keywordType: 'brand' | 'competitor' | 'generic' | 'product' = 'generic';
      const text = k.keywordText.toLowerCase();
      if (text.includes('brand') || text.includes('official')) {
        keywordType = 'brand';
      } else if (text.includes('vs') || text.includes('alternative')) {
        keywordType = 'competitor';
      } else if (wordCount >= 4) {
        keywordType = 'product';
      }
      
      return {
        features: {
          matchType: (k.matchType || 'broad') as 'broad' | 'phrase' | 'exact',
          wordCount,
          keywordType,
          avgBid
        },
        cr: Number(k.keywordCvr) || 0,
        cv: (k.orders || 0) > 0 ? Number(k.sales) / (k.orders || 1) : 0
      };
    });
  
  if (trainingData.length < 20) {
    throw new Error('训练数据不足，至少需要20个有效关键词');
  }
  
  // 构建决策树
  const target = modelType === 'cr_prediction' ? 'cr' : 'cv';
  const nodeId = { current: 1 };
  const tree = buildTreeNode(trainingData, target, 0, config, nodeId);
  
  // 计算模型统计
  const depth = getTreeDepth(tree);
  const leafCount = countLeaves(tree);
  
  // 计算特征重要性
  const importance = new Map<string, number>();
  calculateFeatureImportance(tree, importance, trainingData.length);
  const featureImportance: Record<string, number> = {};
  importance.forEach((value, key) => {
    featureImportance[key] = Math.round(value * 1000) / 1000;
  });
  
  // 计算训练R²
  const predictions = trainingData.map(d => predictWithTree(tree, d.features).prediction);
  const actuals = trainingData.map(d => d[target]);
  const meanActual = calculateMean(actuals);
  const ssTotal = actuals.reduce((sum, a) => sum + Math.pow(a - meanActual, 2), 0);
  const ssResidual = actuals.reduce((sum, a, i) => sum + Math.pow(a - predictions[i], 2), 0);
  const trainingR2 = 1 - ssResidual / ssTotal;
  
  return {
    tree,
    depth,
    leafCount,
    featureImportance,
    trainingR2: Math.max(0, trainingR2),
    totalSamples: trainingData.length
  };
}

/**
 * 保存决策树模型
 */
export async function saveDecisionTreeModel(
  accountId: number,
  modelType: 'cr_prediction' | 'cv_prediction',
  modelResult: {
    tree: TreeNode;
    depth: number;
    leafCount: number;
    featureImportance: Record<string, number>;
    trainingR2: number;
    totalSamples: number;
  }
): Promise<number> {
  const db = await getDbInstance();
  // 将旧模型标记为非活跃
  await db
    .update(decisionTreeModels)
    .set({ isActive: 0 })
    .where(
      and(
        eq(decisionTreeModels.accountId, accountId),
        eq(decisionTreeModels.modelType, modelType)
      )
    );
  
  // 获取最新版本号
  const latestModel = await db
    .select({ id: decisionTreeModels.id })
    .from(decisionTreeModels)
    .where(
      and(
        eq(decisionTreeModels.accountId, accountId),
        eq(decisionTreeModels.modelType, modelType)
      )
    )
    .orderBy(desc(decisionTreeModels.id))
    .limit(1);
  
  const newVersion = latestModel.length > 0 ? latestModel[0].id + 1 : 1;
  
  // 插入新模型
  const result = await db.insert(decisionTreeModels).values({
    accountId,
    modelType,
    treeStructure: JSON.stringify(modelResult.tree),
    totalSamples: modelResult.totalSamples,
    depth: modelResult.depth,
    leafCount: modelResult.leafCount,
    trainingR2: String(modelResult.trainingR2),
    featureImportance: JSON.stringify(modelResult.featureImportance),
    isActive: 1
  });
  
  return newVersion;
}

/**
 * 获取活跃的决策树模型
 */
export async function getActiveDecisionTreeModel(
  accountId: number,
  modelType: 'cr_prediction' | 'cv_prediction'
): Promise<TreeNode | null> {
  const db = await getDbInstance();
  const models = await db
    .select()
    .from(decisionTreeModels)
    .where(
      and(
        eq(decisionTreeModels.accountId, accountId),
        eq(decisionTreeModels.modelType, modelType),
        eq(decisionTreeModels.isActive, 1)
      )
    )
    .limit(1);
  
  if (models.length === 0) {
    return null;
  }
  
  const treeData = models[0].treeStructure;
  if (!treeData) return null;
  return typeof treeData === 'string' ? JSON.parse(treeData) as TreeNode : treeData as unknown as TreeNode;
}

/**
 * 预测关键词的转化率和转化价值
 */
export async function predictKeywordPerformance(
  accountId: number,
  features: KeywordFeatures
): Promise<PredictionResult> {
  // 获取CR预测模型
  const crTree = await getActiveDecisionTreeModel(accountId, 'cr_prediction');
  // 获取CV预测模型
  const cvTree = await getActiveDecisionTreeModel(accountId, 'cv_prediction');
  
  let predictedCR = 0.05; // 默认值
  let predictedCV = 30; // 默认值
  let crSamples = 0;
  let cvSamples = 0;
  let crVariance = 0;
  let cvVariance = 0;
  let predictionSource: 'historical' | 'decision_tree' | 'bayesian_update' = 'historical';
  
  if (crTree) {
    const crResult = predictWithTree(crTree, features);
    predictedCR = crResult.prediction;
    crSamples = crResult.samples;
    crVariance = crResult.variance;
    predictionSource = 'decision_tree';
  }
  
  if (cvTree) {
    const cvResult = predictWithTree(cvTree, features);
    predictedCV = cvResult.prediction;
    cvSamples = cvResult.samples;
    cvVariance = cvResult.variance;
  }
  
  // 计算置信区间
  const crStdDev = Math.sqrt(crVariance);
  const cvStdDev = Math.sqrt(cvVariance);
  
  // 计算置信度
  const sampleCount = Math.min(crSamples, cvSamples);
  const confidence = Math.min(1, sampleCount / 100) * (1 - Math.min(crVariance, 1));
  
  return {
    predictedCR: Math.max(0, predictedCR),
    predictedCV: Math.max(0, predictedCV),
    crLow: Math.max(0, predictedCR - 1.96 * crStdDev),
    crHigh: predictedCR + 1.96 * crStdDev,
    cvLow: Math.max(0, predictedCV - 1.96 * cvStdDev),
    cvHigh: predictedCV + 1.96 * cvStdDev,
    confidence,
    sampleCount,
    predictionSource
  };
}

/**
 * 批量预测并保存关键词预测结果
 */
export async function batchPredictAndSaveKeywords(accountId: number): Promise<{
  predicted: number;
  failed: number;
}> {
  const db = await getDbInstance();
  const result = { predicted: 0, failed: 0 };
  
  // 获取所有关键词
  const allKeywords = await db
    .select()
    .from(keywords)
    .where(eq(keywords.keywordStatus, 'enabled'))
    .limit(5000);
  
  for (const kw of allKeywords) {
    try {
      const wordCount = kw.keywordText.split(' ').length;
      
      // 简单的关键词类型分类
      let keywordType: 'brand' | 'competitor' | 'generic' | 'product' = 'generic';
      const text = kw.keywordText.toLowerCase();
      if (text.includes('brand') || text.includes('official')) {
        keywordType = 'brand';
      } else if (text.includes('vs') || text.includes('alternative')) {
        keywordType = 'competitor';
      } else if (wordCount >= 4) {
        keywordType = 'product';
      }
      
      const features: KeywordFeatures = {
        matchType: (kw.matchType || 'broad') as 'broad' | 'phrase' | 'exact',
        wordCount,
        keywordType,
        avgBid: Number(kw.bid) || 1
      };
      
      const prediction = await predictKeywordPerformance(accountId, features);
      
      // 保存预测结果
      const existing = await db
        .select()
        .from(keywordPredictions)
        .where(
          and(
            eq(keywordPredictions.accountId, accountId),
            eq(keywordPredictions.keywordId, kw.id)
          )
        )
        .limit(1);
      
      const predictionData = {
        accountId,
        keywordId: kw.id,
        keywordText: kw.keywordText,
        predictedCR: String(prediction.predictedCR),
        predictedCV: String(prediction.predictedCV),
        predictionSource: prediction.predictionSource === 'historical' ? 'default' as const : prediction.predictionSource as 'decision_tree' | 'bayesian',
        confidence: String(prediction.confidence),
        matchType: features.matchType,
        wordCount: features.wordCount,
        keywordType: features.keywordType,
        actualCR: String(Number(kw.keywordCvr) || 0),
        actualCV: String((kw.orders || 0) > 0 ? Number(kw.sales) / (kw.orders || 1) : 0)
      };
      
      if (existing.length > 0) {
        await db
          .update(keywordPredictions)
          .set(predictionData)
          .where(eq(keywordPredictions.id, existing[0].id));
      } else {
        await db.insert(keywordPredictions).values(predictionData);
      }
      
      result.predicted++;
    } catch (error) {
      result.failed++;
    }
  }
  
  return result;
}

/**
 * 使用贝叶斯更新调整预测
 * 当有新的实际数据时，更新预测值
 */
export function bayesianUpdate(
  priorCR: number,
  priorVariance: number,
  observedCR: number,
  observedSamples: number
): { posteriorCR: number; posteriorVariance: number } {
  // 简化的贝叶斯更新
  // 假设先验和观测都是正态分布
  
  const priorPrecision = 1 / Math.max(priorVariance, 0.0001);
  const observedPrecision = observedSamples; // 样本数作为精度的代理
  
  const posteriorPrecision = priorPrecision + observedPrecision;
  const posteriorCR = (priorPrecision * priorCR + observedPrecision * observedCR) / posteriorPrecision;
  const posteriorVariance = 1 / posteriorPrecision;
  
  return {
    posteriorCR,
    posteriorVariance
  };
}

/**
 * 获取关键词预测摘要
 */
export async function getKeywordPredictionSummary(accountId: number): Promise<{
  totalPredictions: number;
  avgConfidence: number;
  avgPredictedCR: number;
  avgPredictedCV: number;
  predictionAccuracy: number;
  byMatchType: Record<string, { count: number; avgCR: number; avgCV: number }>;
  byKeywordType: Record<string, { count: number; avgCR: number; avgCV: number }>;
}> {
  const db = await getDbInstance();
  const predictions = await db
    .select()
    .from(keywordPredictions)
    .where(eq(keywordPredictions.accountId, accountId));
  
  if (predictions.length === 0) {
    return {
      totalPredictions: 0,
      avgConfidence: 0,
      avgPredictedCR: 0,
      avgPredictedCV: 0,
      predictionAccuracy: 0,
      byMatchType: {},
      byKeywordType: {}
    };
  }
  
  const totalPredictions = predictions.length;
  const avgConfidence = predictions.reduce((sum, p) => sum + Number(p.confidence), 0) / totalPredictions;
  const avgPredictedCR = predictions.reduce((sum, p) => sum + Number(p.predictedCR), 0) / totalPredictions;
  const avgPredictedCV = predictions.reduce((sum, p) => sum + Number(p.predictedCV), 0) / totalPredictions;
  
  // 计算预测准确率
  const validPredictions = predictions.filter(p => Number(p.actualCR) > 0);
  let predictionAccuracy = 0;
  if (validPredictions.length > 0) {
    const errors = validPredictions.map(p => 
      Math.abs(Number(p.predictedCR) - Number(p.actualCR)) / Math.max(Number(p.actualCR), 0.001)
    );
    predictionAccuracy = 1 - (errors.reduce((a, b) => a + b, 0) / errors.length);
  }
  
  // 按匹配类型分组
  const byMatchType: Record<string, { count: number; avgCR: number; avgCV: number }> = {};
  const byKeywordType: Record<string, { count: number; avgCR: number; avgCV: number }> = {};
  
  for (const p of predictions) {
    const mt = p.matchType || 'unknown';
    const kt = p.keywordType || 'unknown';
    
    if (!byMatchType[mt]) {
      byMatchType[mt] = { count: 0, avgCR: 0, avgCV: 0 };
    }
    byMatchType[mt].count++;
    byMatchType[mt].avgCR += Number(p.predictedCR);
    byMatchType[mt].avgCV += Number(p.predictedCV);
    
    if (!byKeywordType[kt]) {
      byKeywordType[kt] = { count: 0, avgCR: 0, avgCV: 0 };
    }
    byKeywordType[kt].count++;
    byKeywordType[kt].avgCR += Number(p.predictedCR);
    byKeywordType[kt].avgCV += Number(p.predictedCV);
  }
  
  // 计算平均值
  for (const mt of Object.keys(byMatchType)) {
    byMatchType[mt].avgCR /= byMatchType[mt].count;
    byMatchType[mt].avgCV /= byMatchType[mt].count;
  }
  for (const kt of Object.keys(byKeywordType)) {
    byKeywordType[kt].avgCR /= byKeywordType[kt].count;
    byKeywordType[kt].avgCV /= byKeywordType[kt].count;
  }
  
  return {
    totalPredictions,
    avgConfidence,
    avgPredictedCR,
    avgPredictedCV,
    predictionAccuracy: Math.max(0, predictionAccuracy),
    byMatchType,
    byKeywordType
  };
}
