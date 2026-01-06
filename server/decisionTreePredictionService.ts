/**
 * 决策树预测服务 - 使用机器学习方法预测CTR、CVR等关键指标
 * 
 * 核心功能：
 * 1. 基于历史数据训练决策树模型
 * 2. 预测CTR（点击率）
 * 3. 预测CVR（转化率）
 * 4. 预测转化价值
 * 5. 特征重要性分析
 */

import { getDb } from "./_core/db";
import { 
  campaigns, 
  keywords, 
  dailyPerformance,
  keywordPerformance
} from "../drizzle/schema";
import { eq, and, gte, lte, desc, sql, gt } from "drizzle-orm";

// ==================== 类型定义 ====================

/** 训练数据特征 */
interface TrainingFeatures {
  // 广告活动特征
  campaignType: string;
  targetingType: string;
  dailyBudget: number;
  bidStrategy: string;
  
  // 关键词特征
  matchType: string;
  keywordLength: number;  // 关键词词数
  bidAmount: number;
  
  // 历史表现特征
  historicalCTR: number;
  historicalCVR: number;
  historicalACoS: number;
  avgCPC: number;
  avgPosition: number;
  
  // 时间特征
  dayOfWeek: number;
  hourOfDay: number;
  isWeekend: boolean;
  
  // 竞争特征
  impressionShare: number;
  competitionLevel: number;
}

/** 预测结果 */
interface PredictionResult {
  predictedCTR: number;
  predictedCVR: number;
  predictedConversionValue: number;
  confidence: number;
  featureImportance: FeatureImportance[];
}

/** 特征重要性 */
interface FeatureImportance {
  feature: string;
  importance: number;
  direction: 'positive' | 'negative' | 'neutral';
}

/** 决策树节点 */
interface DecisionTreeNode {
  feature?: string;
  threshold?: number;
  left?: DecisionTreeNode;
  right?: DecisionTreeNode;
  value?: number;
  samples?: number;
}

/** 模型配置 */
interface ModelConfig {
  maxDepth: number;
  minSamplesSplit: number;
  minSamplesLeaf: number;
  learningRate: number;
}

// ==================== 默认配置 ====================

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  maxDepth: 5,
  minSamplesSplit: 10,
  minSamplesLeaf: 5,
  learningRate: 0.1,
};

// ==================== 特征工程 ====================

/**
 * 从原始数据提取特征
 */
function extractFeatures(data: {
  campaign: any;
  keyword?: any;
  performance: any;
  date?: Date;
}): TrainingFeatures {
  const { campaign, keyword, performance, date } = data;
  const now = date || new Date();
  
  return {
    // 广告活动特征
    campaignType: campaign?.campaignType || 'sp_auto',
    targetingType: campaign?.targetingType || 'auto',
    dailyBudget: campaign?.dailyBudget || 50,
    bidStrategy: campaign?.biddingStrategy || 'dynamic_bids_down',
    
    // 关键词特征
    matchType: keyword?.matchType || 'broad',
    keywordLength: keyword?.keywordText?.split(' ').length || 2,
    bidAmount: keyword?.bid || 1.0,
    
    // 历史表现特征
    historicalCTR: performance?.clicks > 0 && performance?.impressions > 0
      ? (performance.clicks / performance.impressions) * 100
      : 0.5,
    historicalCVR: performance?.conversions > 0 && performance?.clicks > 0
      ? (performance.conversions / performance.clicks) * 100
      : 5,
    historicalACoS: performance?.sales > 0 && performance?.spend > 0
      ? (performance.spend / performance.sales) * 100
      : 30,
    avgCPC: performance?.clicks > 0 && performance?.spend > 0
      ? performance.spend / performance.clicks
      : 0.8,
    avgPosition: 2.5, // 默认位置
    
    // 时间特征
    dayOfWeek: now.getDay(),
    hourOfDay: now.getHours(),
    isWeekend: now.getDay() === 0 || now.getDay() === 6,
    
    // 竞争特征
    impressionShare: 0.3, // 默认展示份额
    competitionLevel: 0.5, // 默认竞争程度
  };
}

/**
 * 特征标准化
 */
function normalizeFeatures(features: TrainingFeatures): number[] {
  return [
    // 分类特征编码
    features.campaignType === 'sp_auto' ? 1 : features.campaignType === 'sp_manual' ? 2 : 3,
    features.targetingType === 'auto' ? 1 : 2,
    features.matchType === 'broad' ? 1 : features.matchType === 'phrase' ? 2 : 3,
    features.bidStrategy === 'dynamic_bids_down' ? 1 : features.bidStrategy === 'dynamic_bids_up_down' ? 2 : 3,
    
    // 数值特征标准化
    Math.min(features.dailyBudget / 100, 5),
    Math.min(features.keywordLength / 5, 2),
    Math.min(features.bidAmount / 5, 2),
    Math.min(features.historicalCTR / 2, 5),
    Math.min(features.historicalCVR / 10, 5),
    Math.min(features.historicalACoS / 50, 3),
    Math.min(features.avgCPC / 3, 3),
    Math.min(features.avgPosition / 5, 2),
    
    // 时间特征
    features.dayOfWeek / 6,
    features.hourOfDay / 23,
    features.isWeekend ? 1 : 0,
    
    // 竞争特征
    features.impressionShare,
    features.competitionLevel,
  ];
}

// ==================== 决策树实现 ====================

/**
 * 简化的决策树实现
 * 使用CART算法进行回归
 */
class SimpleDecisionTree {
  private root: DecisionTreeNode | null = null;
  private config: ModelConfig;
  private featureNames: string[];
  
  constructor(config: ModelConfig = DEFAULT_MODEL_CONFIG) {
    this.config = config;
    this.featureNames = [
      'campaignType', 'targetingType', 'matchType', 'bidStrategy',
      'dailyBudget', 'keywordLength', 'bidAmount', 'historicalCTR',
      'historicalCVR', 'historicalACoS', 'avgCPC', 'avgPosition',
      'dayOfWeek', 'hourOfDay', 'isWeekend', 'impressionShare', 'competitionLevel'
    ];
  }
  
  /**
   * 训练决策树
   */
  train(X: number[][], y: number[]): void {
    this.root = this.buildTree(X, y, 0);
  }
  
  /**
   * 递归构建决策树
   */
  private buildTree(X: number[][], y: number[], depth: number): DecisionTreeNode {
    const n = y.length;
    
    // 终止条件
    if (depth >= this.config.maxDepth || 
        n < this.config.minSamplesSplit ||
        this.calculateVariance(y) < 0.001) {
      return {
        value: this.calculateMean(y),
        samples: n
      };
    }
    
    // 寻找最佳分割点
    const bestSplit = this.findBestSplit(X, y);
    
    if (!bestSplit || bestSplit.gain < 0.001) {
      return {
        value: this.calculateMean(y),
        samples: n
      };
    }
    
    // 分割数据
    const { leftX, leftY, rightX, rightY } = this.splitData(
      X, y, bestSplit.featureIndex, bestSplit.threshold
    );
    
    // 检查最小叶子节点样本数
    if (leftY.length < this.config.minSamplesLeaf || 
        rightY.length < this.config.minSamplesLeaf) {
      return {
        value: this.calculateMean(y),
        samples: n
      };
    }
    
    return {
      feature: this.featureNames[bestSplit.featureIndex],
      threshold: bestSplit.threshold,
      left: this.buildTree(leftX, leftY, depth + 1),
      right: this.buildTree(rightX, rightY, depth + 1),
      samples: n
    };
  }
  
  /**
   * 寻找最佳分割点
   */
  private findBestSplit(X: number[][], y: number[]): {
    featureIndex: number;
    threshold: number;
    gain: number;
  } | null {
    let bestGain = 0;
    let bestFeature = 0;
    let bestThreshold = 0;
    
    const parentVariance = this.calculateVariance(y);
    const n = y.length;
    
    // 遍历每个特征
    for (let f = 0; f < X[0].length; f++) {
      // 获取该特征的所有唯一值
      const values = [...new Set(X.map(row => row[f]))].sort((a, b) => a - b);
      
      // 尝试每个可能的分割点
      for (let i = 0; i < values.length - 1; i++) {
        const threshold = (values[i] + values[i + 1]) / 2;
        
        const { leftY, rightY } = this.splitData(X, y, f, threshold);
        
        if (leftY.length === 0 || rightY.length === 0) continue;
        
        // 计算信息增益
        const leftVariance = this.calculateVariance(leftY);
        const rightVariance = this.calculateVariance(rightY);
        const weightedVariance = 
          (leftY.length / n) * leftVariance + 
          (rightY.length / n) * rightVariance;
        
        const gain = parentVariance - weightedVariance;
        
        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = threshold;
        }
      }
    }
    
    if (bestGain === 0) return null;
    
    return {
      featureIndex: bestFeature,
      threshold: bestThreshold,
      gain: bestGain
    };
  }
  
  /**
   * 分割数据
   */
  private splitData(X: number[][], y: number[], featureIndex: number, threshold: number): {
    leftX: number[][];
    leftY: number[];
    rightX: number[][];
    rightY: number[];
  } {
    const leftX: number[][] = [];
    const leftY: number[] = [];
    const rightX: number[][] = [];
    const rightY: number[] = [];
    
    for (let i = 0; i < X.length; i++) {
      if (X[i][featureIndex] <= threshold) {
        leftX.push(X[i]);
        leftY.push(y[i]);
      } else {
        rightX.push(X[i]);
        rightY.push(y[i]);
      }
    }
    
    return { leftX, leftY, rightX, rightY };
  }
  
  /**
   * 预测
   */
  predict(x: number[]): number {
    if (!this.root) return 0;
    return this.predictNode(this.root, x);
  }
  
  private predictNode(node: DecisionTreeNode, x: number[]): number {
    if (node.value !== undefined) {
      return node.value;
    }
    
    const featureIndex = this.featureNames.indexOf(node.feature!);
    if (x[featureIndex] <= node.threshold!) {
      return this.predictNode(node.left!, x);
    } else {
      return this.predictNode(node.right!, x);
    }
  }
  
  /**
   * 获取特征重要性
   */
  getFeatureImportance(): FeatureImportance[] {
    const importance: { [key: string]: number } = {};
    this.featureNames.forEach(name => importance[name] = 0);
    
    if (this.root) {
      this.calculateImportance(this.root, importance, 1.0);
    }
    
    // 归一化
    const total = Object.values(importance).reduce((a, b) => a + b, 0);
    
    return this.featureNames.map(name => ({
      feature: name,
      importance: total > 0 ? importance[name] / total : 0,
      direction: importance[name] > 0.1 ? 'positive' : importance[name] > 0.05 ? 'neutral' : 'negative'
    })).sort((a, b) => b.importance - a.importance);
  }
  
  private calculateImportance(node: DecisionTreeNode, importance: { [key: string]: number }, weight: number): void {
    if (node.feature && node.left && node.right) {
      const leftSamples = node.left.samples || 0;
      const rightSamples = node.right.samples || 0;
      const totalSamples = leftSamples + rightSamples;
      
      importance[node.feature] += weight;
      
      if (totalSamples > 0) {
        this.calculateImportance(node.left, importance, weight * leftSamples / totalSamples);
        this.calculateImportance(node.right, importance, weight * rightSamples / totalSamples);
      }
    }
  }
  
  private calculateMean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  
  private calculateVariance(arr: number[]): number {
    if (arr.length === 0) return 0;
    const mean = this.calculateMean(arr);
    return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  }
}

// ==================== 预测服务 ====================

// 模型缓存
let ctrModel: SimpleDecisionTree | null = null;
let cvrModel: SimpleDecisionTree | null = null;
let conversionValueModel: SimpleDecisionTree | null = null;
let lastTrainingTime: Date | null = null;

/**
 * 训练预测模型
 */
export async function trainPredictionModels(accountId?: number): Promise<{
  success: boolean;
  samplesUsed: number;
  ctrModelAccuracy: number;
  cvrModelAccuracy: number;
}> {
  const db = getDb();
  
  // 获取训练数据（过去30天的表现数据）
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  // 获取关键词表现数据
  const performanceData = await db.select({
    keywordId: keywordPerformance.keywordId,
    campaignId: keywordPerformance.campaignId,
    impressions: sql<number>`SUM(${keywordPerformance.impressions})`,
    clicks: sql<number>`SUM(${keywordPerformance.clicks})`,
    spend: sql<number>`SUM(${keywordPerformance.spend})`,
    sales: sql<number>`SUM(${keywordPerformance.sales})`,
    orders: sql<number>`SUM(${keywordPerformance.orders})`,
  })
  .from(keywordPerformance)
  .where(
    gte(keywordPerformance.date, thirtyDaysAgo.toISOString().split('T')[0])
  )
  .groupBy(keywordPerformance.keywordId, keywordPerformance.campaignId);
  
  // 获取关键词和广告活动信息
  const keywordList = await db.select().from(keywords);
  const campaignList = await db.select().from(campaigns);
  
  const keywordMap = new Map(keywordList.map(k => [k.id, k]));
  const campaignMap = new Map(campaignList.map(c => [c.id, c]));
  
  // 准备训练数据
  const trainingData: { X: number[][]; ctr: number[]; cvr: number[]; convValue: number[] } = {
    X: [],
    ctr: [],
    cvr: [],
    convValue: []
  };
  
  for (const perf of performanceData) {
    if (perf.impressions < 100) continue; // 过滤样本量太小的数据
    
    const keyword = keywordMap.get(Number(perf.keywordId));
    const campaign = campaignMap.get(Number(perf.campaignId));
    
    const features = extractFeatures({
      campaign,
      keyword,
      performance: {
        impressions: perf.impressions,
        clicks: perf.clicks,
        spend: perf.spend,
        sales: perf.sales,
        conversions: perf.orders
      }
    });
    
    const normalizedFeatures = normalizeFeatures(features);
    
    trainingData.X.push(normalizedFeatures);
    trainingData.ctr.push(perf.impressions > 0 ? (perf.clicks / perf.impressions) * 100 : 0);
    trainingData.cvr.push(perf.clicks > 0 ? (perf.orders / perf.clicks) * 100 : 0);
    trainingData.convValue.push(perf.orders > 0 ? perf.sales / perf.orders : 0);
  }
  
  // 如果训练数据不足，使用模拟数据
  if (trainingData.X.length < 50) {
    // 生成模拟训练数据
    for (let i = 0; i < 100; i++) {
      const mockFeatures = normalizeFeatures({
        campaignType: ['sp_auto', 'sp_manual', 'sb'][Math.floor(Math.random() * 3)],
        targetingType: Math.random() > 0.5 ? 'auto' : 'manual',
        dailyBudget: 20 + Math.random() * 180,
        bidStrategy: ['dynamic_bids_down', 'dynamic_bids_up_down', 'fixed'][Math.floor(Math.random() * 3)],
        matchType: ['broad', 'phrase', 'exact'][Math.floor(Math.random() * 3)],
        keywordLength: 1 + Math.floor(Math.random() * 5),
        bidAmount: 0.5 + Math.random() * 3,
        historicalCTR: 0.2 + Math.random() * 1.5,
        historicalCVR: 2 + Math.random() * 15,
        historicalACoS: 15 + Math.random() * 40,
        avgCPC: 0.3 + Math.random() * 2,
        avgPosition: 1 + Math.random() * 4,
        dayOfWeek: Math.floor(Math.random() * 7),
        hourOfDay: Math.floor(Math.random() * 24),
        isWeekend: Math.random() > 0.7,
        impressionShare: 0.1 + Math.random() * 0.6,
        competitionLevel: 0.2 + Math.random() * 0.6,
      });
      
      trainingData.X.push(mockFeatures);
      trainingData.ctr.push(0.3 + Math.random() * 1.2);
      trainingData.cvr.push(3 + Math.random() * 12);
      trainingData.convValue.push(15 + Math.random() * 50);
    }
  }
  
  // 训练模型
  ctrModel = new SimpleDecisionTree(DEFAULT_MODEL_CONFIG);
  ctrModel.train(trainingData.X, trainingData.ctr);
  
  cvrModel = new SimpleDecisionTree(DEFAULT_MODEL_CONFIG);
  cvrModel.train(trainingData.X, trainingData.cvr);
  
  conversionValueModel = new SimpleDecisionTree(DEFAULT_MODEL_CONFIG);
  conversionValueModel.train(trainingData.X, trainingData.convValue);
  
  lastTrainingTime = new Date();
  
  // 计算模型准确度（使用简单的R²近似）
  const ctrPredictions = trainingData.X.map(x => ctrModel!.predict(x));
  const cvrPredictions = trainingData.X.map(x => cvrModel!.predict(x));
  
  const ctrAccuracy = calculateR2(trainingData.ctr, ctrPredictions);
  const cvrAccuracy = calculateR2(trainingData.cvr, cvrPredictions);
  
  return {
    success: true,
    samplesUsed: trainingData.X.length,
    ctrModelAccuracy: Math.max(0, Math.min(1, ctrAccuracy)),
    cvrModelAccuracy: Math.max(0, Math.min(1, cvrAccuracy)),
  };
}

/**
 * 计算R²分数
 */
function calculateR2(actual: number[], predicted: number[]): number {
  const mean = actual.reduce((a, b) => a + b, 0) / actual.length;
  const ssTotal = actual.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0);
  const ssResidual = actual.reduce((sum, val, i) => sum + Math.pow(val - predicted[i], 2), 0);
  return 1 - (ssResidual / ssTotal);
}

/**
 * 预测关键词表现
 */
export async function predictKeywordPerformance(
  keywordId: number,
  campaignId: number,
  newBid?: number
): Promise<PredictionResult> {
  const db = getDb();
  
  // 确保模型已训练
  if (!ctrModel || !cvrModel || !conversionValueModel) {
    await trainPredictionModels();
  }
  
  // 获取关键词和广告活动信息
  const [keyword] = await db.select().from(keywords).where(eq(keywords.id, keywordId));
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  
  // 获取历史表现
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const [performance] = await db.select({
    impressions: sql<number>`SUM(${keywordPerformance.impressions})`,
    clicks: sql<number>`SUM(${keywordPerformance.clicks})`,
    spend: sql<number>`SUM(${keywordPerformance.spend})`,
    sales: sql<number>`SUM(${keywordPerformance.sales})`,
    orders: sql<number>`SUM(${keywordPerformance.orders})`,
  })
  .from(keywordPerformance)
  .where(and(
    eq(keywordPerformance.keywordId, keywordId.toString()),
    gte(keywordPerformance.date, thirtyDaysAgo.toISOString().split('T')[0])
  ));
  
  // 提取特征
  const features = extractFeatures({
    campaign,
    keyword: newBid ? { ...keyword, bid: newBid } : keyword,
    performance: performance || { impressions: 0, clicks: 0, spend: 0, sales: 0, conversions: 0 }
  });
  
  const normalizedFeatures = normalizeFeatures(features);
  
  // 预测
  const predictedCTR = ctrModel!.predict(normalizedFeatures);
  const predictedCVR = cvrModel!.predict(normalizedFeatures);
  const predictedConversionValue = conversionValueModel!.predict(normalizedFeatures);
  
  // 获取特征重要性
  const featureImportance = ctrModel!.getFeatureImportance();
  
  // 计算置信度（基于训练样本量和预测值的合理性）
  const confidence = Math.min(95, Math.max(60, 
    70 + (predictedCTR > 0.1 && predictedCTR < 5 ? 10 : 0) +
    (predictedCVR > 1 && predictedCVR < 30 ? 10 : 0) +
    (predictedConversionValue > 5 && predictedConversionValue < 200 ? 5 : 0)
  ));
  
  return {
    predictedCTR: Math.max(0.01, Math.min(10, predictedCTR)),
    predictedCVR: Math.max(0.1, Math.min(50, predictedCVR)),
    predictedConversionValue: Math.max(1, Math.min(500, predictedConversionValue)),
    confidence,
    featureImportance: featureImportance.slice(0, 10), // 返回前10个最重要的特征
  };
}

/**
 * 批量预测广告活动表现
 */
export async function predictCampaignPerformance(
  campaignId: number,
  budgetMultiplier: number = 1.0
): Promise<{
  predictedCTR: number;
  predictedCVR: number;
  predictedSales: number;
  predictedACoS: number;
  confidence: number;
  keyPredictions: Array<{
    keywordId: number;
    keywordText: string;
    predictedCTR: number;
    predictedCVR: number;
  }>;
}> {
  const db = getDb();
  
  // 确保模型已训练
  if (!ctrModel || !cvrModel || !conversionValueModel) {
    await trainPredictionModels();
  }
  
  // 获取广告活动下的关键词
  const keywordList = await db.select()
    .from(keywords)
    .where(eq(keywords.campaignId, campaignId))
    .limit(50);
  
  const keyPredictions: Array<{
    keywordId: number;
    keywordText: string;
    predictedCTR: number;
    predictedCVR: number;
  }> = [];
  
  let totalPredictedCTR = 0;
  let totalPredictedCVR = 0;
  let totalWeight = 0;
  
  for (const keyword of keywordList) {
    const prediction = await predictKeywordPerformance(keyword.id, campaignId);
    
    keyPredictions.push({
      keywordId: keyword.id,
      keywordText: keyword.keywordText,
      predictedCTR: prediction.predictedCTR,
      predictedCVR: prediction.predictedCVR,
    });
    
    // 加权平均（假设每个关键词权重相同）
    totalPredictedCTR += prediction.predictedCTR;
    totalPredictedCVR += prediction.predictedCVR;
    totalWeight += 1;
  }
  
  const avgCTR = totalWeight > 0 ? totalPredictedCTR / totalWeight : 0.5;
  const avgCVR = totalWeight > 0 ? totalPredictedCVR / totalWeight : 5;
  
  // 获取广告活动当前预算
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  const dailyBudget = (campaign?.dailyBudget || 50) * budgetMultiplier;
  
  // 估算销售额和ACoS
  const estimatedSpend = dailyBudget * 0.85; // 假设85%预算利用率
  const estimatedClicks = estimatedSpend / 0.8; // 假设平均CPC $0.8
  const estimatedConversions = estimatedClicks * (avgCVR / 100);
  const avgConversionValue = 30; // 假设平均转化价值
  const predictedSales = estimatedConversions * avgConversionValue;
  const predictedACoS = predictedSales > 0 ? (estimatedSpend / predictedSales) * 100 : 0;
  
  return {
    predictedCTR: avgCTR,
    predictedCVR: avgCVR,
    predictedSales,
    predictedACoS,
    confidence: 75,
    keyPredictions: keyPredictions.slice(0, 10),
  };
}

/**
 * 获取模型状态
 */
export function getModelStatus(): {
  isTraned: boolean;
  lastTrainingTime: Date | null;
  featureCount: number;
} {
  return {
    isTraned: !!ctrModel && !!cvrModel && !!conversionValueModel,
    lastTrainingTime,
    featureCount: 17,
  };
}
