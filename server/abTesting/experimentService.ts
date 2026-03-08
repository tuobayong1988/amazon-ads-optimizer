/**
 * A/B测试实验服务
 * 
 * 支持对优化策略进行A/B测试,科学评估效果
 */

import { getDb } from '../db';
import { campaigns, dailyPerformance } from '../../drizzle/schema';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';

// 实验状态
export enum ExperimentStatus {
  DRAFT = 'draft',           // 草稿
  RUNNING = 'running',       // 运行中
  PAUSED = 'paused',         // 已暂停
  COMPLETED = 'completed',   // 已完成
  CANCELLED = 'cancelled',   // 已取消
}

// 实验组类型
export enum GroupType {
  CONTROL = 'control',       // 对照组
  TREATMENT = 'treatment',   // 实验组
}

// 实验配置
export interface Experiment {
  id: string;
  name: string;
  description: string;
  accountId: number;
  status: ExperimentStatus;
  startDate: Date;
  endDate?: Date;
  minSampleSize: number;      // 最小样本量
  confidenceLevel: number;    // 置信水平(0.90, 0.95, 0.99)
  primaryMetric: string;      // 主要评估指标
  groups: ExperimentGroup[];
  createdAt: Date;
  updatedAt: Date;
}

// 实验组
export interface ExperimentGroup {
  id: string;
  experimentId: string;
  name: string;
  type: GroupType;
  strategyConfig: unknown;        // 策略配置
  campaignIds: number[];      // 分配的广告活动ID
  allocation: number;         // 流量分配比例(0-1)
}

// 实验结果
export interface ExperimentResult {
  experimentId: string;
  groups: {
    groupId: string;
    groupName: string;
    type: GroupType;
    metrics: {
      impressions: number;
      clicks: number;
      orders: number;
      spend: number;
      sales: number;
      acos: number;
      roas: number;
      ctr: number;
      cvr: number;
    };
    sampleSize: number;
  }[];
  comparison: {
    metric: string;
    controlValue: number;
    treatmentValue: number;
    absoluteDifference: number;
    relativeDifference: number;  // 百分比
    pValue: number;              // p值
    isSignificant: boolean;      // 是否显著
    confidenceInterval: [number, number];
  }[];
  recommendation: string;
  winner?: string;  // 获胜组ID
}

/**
 * 创建A/B测试实验
 */
export async function createExperiment(
  accountId: number,
  config: {
    name: string;
    description: string;
    startDate: Date;
    duration: number; // 天数
    controlStrategy: unknown;
    treatmentStrategy: unknown;
    campaignIds: number[];
    primaryMetric: string;
    confidenceLevel?: number;
  }
): Promise<Experiment> {
  const experimentId = `exp-${Date.now()}`;
  
  // 随机分配广告活动到对照组和实验组
  const shuffled = [...config.campaignIds].sort(() => Math.random() - 0.5);
  const splitIndex = Math.floor(shuffled.length / 2);
  const controlCampaigns = shuffled.slice(0, splitIndex);
  const treatmentCampaigns = shuffled.slice(splitIndex);

  const experiment: Experiment = {
    id: experimentId,
    name: config.name,
    description: config.description,
    accountId,
    status: ExperimentStatus.DRAFT,
    startDate: config.startDate,
    endDate: new Date(config.startDate.getTime() + config.duration * 24 * 60 * 60 * 1000),
    minSampleSize: 100, // 最小100个订单
    confidenceLevel: config.confidenceLevel || 0.95,
    primaryMetric: config.primaryMetric,
    groups: [
      {
        id: `${experimentId}-control`,
        experimentId,
        name: '对照组',
        type: GroupType.CONTROL,
        strategyConfig: config.controlStrategy,
        campaignIds: controlCampaigns,
        allocation: 0.5,
      },
      {
        id: `${experimentId}-treatment`,
        experimentId,
        name: '实验组',
        type: GroupType.TREATMENT,
        strategyConfig: config.treatmentStrategy,
        campaignIds: treatmentCampaigns,
        allocation: 0.5,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // TODO: 保存到数据库
  return experiment;
}

/**
 * 启动实验
 */
export async function startExperiment(experimentId: string): Promise<void> {
  // TODO: 更新实验状态为RUNNING
  // TODO: 应用策略到各组广告活动
}

/**
 * 暂停实验
 */
export async function pauseExperiment(experimentId: string): Promise<void> {
  // TODO: 更新实验状态为PAUSED
}

/**
 * 完成实验
 */
export async function completeExperiment(experimentId: string): Promise<void> {
  // TODO: 更新实验状态为COMPLETED
}

/**
 * 获取实验结果
 */
export async function getExperimentResult(experimentId: string): Promise<ExperimentResult> {
  // TODO: 从数据库获取实验配置
  const experiment: Experiment = {} as Record<string, unknown>; // 临时

  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const results: ExperimentResult = {
    experimentId,
    groups: [],
    comparison: [],
    recommendation: '',
  };

  // 收集各组数据
  for (const group of experiment.groups) {
    if (group.campaignIds.length === 0) continue;

    // 查询该组广告活动的表现数据
    const performanceData = await db
      .select({
        impressions: sql<number>`SUM(${dailyPerformance.impressions})`,
        clicks: sql<number>`SUM(${dailyPerformance.clicks})`,
        orders: sql<number>`SUM(${dailyPerformance.orders})`,
        spend: sql<number>`SUM(${dailyPerformance.spend})`,
        sales: sql<number>`SUM(${dailyPerformance.sales})`,
      })
      .from(dailyPerformance)
      .where(
        and(
          inArray(dailyPerformance.campaignId, group.campaignIds.map(String)),
          sql`${dailyPerformance.date} >= ${experiment.startDate.toISOString().split('T')[0]}`,
          experiment.endDate ? sql`${dailyPerformance.date} <= ${experiment.endDate.toISOString().split('T')[0]}` : sql`1=1`
        )
      );

    if (performanceData.length === 0) continue;

    const data = performanceData[0];
    const impressions = Number(data.impressions) || 0;
    const clicks = Number(data.clicks) || 0;
    const orders = Number(data.orders) || 0;
    const spend = Number(data.spend) || 0;
    const sales = Number(data.sales) || 0;

    results.groups.push({
      groupId: group.id,
      groupName: group.name,
      type: group.type,
      metrics: {
        impressions,
        clicks,
        orders,
        spend,
        sales,
        acos: sales > 0 ? (spend / sales) * 100 : 0,
        roas: spend > 0 ? sales / spend : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cvr: clicks > 0 ? (orders / clicks) * 100 : 0,
      },
      sampleSize: orders,
    });
  }

  // 统计检验
  if (results.groups.length === 2) {
    const control = results.groups.find(g => g.type === GroupType.CONTROL);
    const treatment = results.groups.find(g => g.type === GroupType.TREATMENT);

    if (control && treatment) {
      // 对主要指标进行t检验
      const metrics = ['acos', 'roas', 'ctr', 'cvr'] as const;
      
      for (const metric of metrics) {
        const controlValue = control.metrics[metric];
        const treatmentValue = treatment.metrics[metric];
        const absoluteDiff = treatmentValue - controlValue;
        const relativeDiff = controlValue !== 0 ? (absoluteDiff / controlValue) * 100 : 0;

        // 简化的显著性检验(实际应使用完整的t检验)
        const pooledStdDev = Math.sqrt((controlValue + treatmentValue) / 2);
        const tStat = absoluteDiff / (pooledStdDev / Math.sqrt(Math.min(control.sampleSize, treatment.sampleSize)));
        const pValue = 2 * (1 - normalCDF(Math.abs(tStat)));
        const isSignificant = pValue < (1 - experiment.confidenceLevel);

        // 置信区间(简化计算)
        const marginOfError = 1.96 * pooledStdDev / Math.sqrt(Math.min(control.sampleSize, treatment.sampleSize));
        const confidenceInterval: [number, number] = [
          absoluteDiff - marginOfError,
          absoluteDiff + marginOfError,
        ];

        results.comparison.push({
          metric,
          controlValue,
          treatmentValue,
          absoluteDifference: absoluteDiff,
          relativeDifference: relativeDiff,
          pValue,
          isSignificant,
          confidenceInterval,
        });
      }

      // 生成建议
      const primaryComparison = results.comparison.find(c => c.metric === experiment.primaryMetric);
      if (primaryComparison) {
        if (primaryComparison.isSignificant) {
          if (primaryComparison.relativeDifference > 0) {
            results.winner = treatment.groupId;
            results.recommendation = `实验组在${experiment.primaryMetric}上显著优于对照组(${primaryComparison.relativeDifference.toFixed(1)}%),建议采用实验组策略。`;
          } else {
            results.winner = control.groupId;
            results.recommendation = `对照组在${experiment.primaryMetric}上显著优于实验组(${Math.abs(primaryComparison.relativeDifference).toFixed(1)}%),建议保持当前策略。`;
          }
        } else {
          results.recommendation = `两组在${experiment.primaryMetric}上无显著差异(p=${primaryComparison.pValue.toFixed(3)}),建议继续观察或增加样本量。`;
        }
      }
    }
  }

  return results;
}

/**
 * 正态分布累积分布函数(CDF)
 * 简化实现,用于计算p值
 */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

/**
 * 计算所需样本量
 */
export function calculateRequiredSampleSize(
  baselineConversion: number,  // 基线转化率
  minDetectableEffect: number, // 最小可检测效应(相对变化百分比)
  confidenceLevel: number = 0.95,
  power: number = 0.80
): number {
  // 简化的样本量计算公式
  const z_alpha = 1.96; // 95%置信水平
  const z_beta = 0.84;  // 80%统计功效
  
  const p1 = baselineConversion;
  const p2 = baselineConversion * (1 + minDetectableEffect / 100);
  const p_avg = (p1 + p2) / 2;
  
  const n = Math.pow(z_alpha + z_beta, 2) * 2 * p_avg * (1 - p_avg) / Math.pow(p2 - p1, 2);
  
  return Math.ceil(n);
}
