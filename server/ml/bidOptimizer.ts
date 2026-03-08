/**
 * 机器学习出价优化算法
 * 使用历史数据训练模型,预测最优出价和预算分配
 */

export interface HistoricalData {
  date: string;
  bid: number;
  spend: number;
  sales: number;
  impressions: number;
  clicks: number;
  conversions: number;
  acos: number;
  roas: number;
}

export interface OptimizationTarget {
  type: 'maximize_sales' | 'target_acos' | 'target_roas';
  targetValue?: number; // For target_acos or target_roas
  maxBudget?: number;
}

export interface BidRecommendation {
  recommendedBid: number;
  confidence: number; // 0-1
  expectedSpend: number;
  expectedSales: number;
  expectedACoS: number;
  expectedROAS: number;
  reasoning: string;
}

/**
 * 线性回归模型
 * 用于预测出价与表现之间的关系
 */
class LinearRegressionModel {
  private weights: number[] = [];
  private bias: number = 0;
  private learningRate: number = 0.01;
  private iterations: number = 1000;

  /**
   * 训练模型
   * @param X 特征矩阵 [n_samples, n_features]
   * @param y 目标值 [n_samples]
   */
  train(X: number[][], y: number[]): void {
    const nSamples = X.length;
    const nFeatures = X[0].length;

    // 初始化权重
    this.weights = Array(nFeatures).fill(0);
    this.bias = 0;

    // 梯度下降
    for (let iter = 0; iter < this.iterations; iter++) {
      // 计算预测值
      const predictions = X.map((x: any) => this.predict(x));

      // 计算梯度
      const dWeights = Array(nFeatures).fill(0);
      let dBias = 0;

      for (let i = 0; i < nSamples; i++) {
        const error = predictions[i] - y[i];
        dBias += error;
        for (let j = 0; j < nFeatures; j++) {
          dWeights[j] += error * X[i][j];
        }
      }

      // 更新参数
      this.bias -= (this.learningRate * dBias) / nSamples;
      for (let j = 0; j < nFeatures; j++) {
        this.weights[j] -= (this.learningRate * dWeights[j]) / nSamples;
      }
    }
  }

  /**
   * 预测
   */
  predict(x: number[]): number {
    let result = this.bias;
    for (let i = 0; i < x.length; i++) {
      result += this.weights[i] * x[i];
    }
    return result;
  }

  /**
   * 计算R²分数
   */
  score(X: number[][], y: number[]): number {
    const predictions = X.map((x: any) => this.predict(x));
    const mean = y.reduce((sum: any, val: any) => sum + val, 0) / y.length;

    const ssRes = y.reduce(
      (sum, val, i) => sum + Math.pow(val - predictions[i], 2),
      0
    );
    const ssTot = y.reduce((sum: any, val: any) => sum + Math.pow(val - mean, 2), 0);

    return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  }
}

/**
 * 出价优化器
 */
export class BidOptimizer {
  private salesModel: LinearRegressionModel;
  private spendModel: LinearRegressionModel;
  private clicksModel: LinearRegressionModel;
  private conversionsModel: LinearRegressionModel;

  constructor() {
    this.salesModel = new LinearRegressionModel();
    this.spendModel = new LinearRegressionModel();
    this.clicksModel = new LinearRegressionModel();
    this.conversionsModel = new LinearRegressionModel();
  }

  /**
   * 训练模型
   */
  train(historicalData: HistoricalData[]): void {
    if (historicalData.length < 10) {
      throw new Error('Insufficient historical data for training (minimum 10 records)');
    }

    // 准备特征和目标
    const features = historicalData.map((d: any) => [
      d.bid,
      d.impressions,
      d.clicks,
      Math.log(d.bid + 1), // 对数变换
    ]);

    const salesTargets = historicalData.map((d: any) => d.sales);
    const spendTargets = historicalData.map((d: any) => d.spend);
    const clicksTargets = historicalData.map((d: any) => d.clicks);
    const conversionsTargets = historicalData.map((d: any) => d.conversions);

    // 训练各个模型
    this.salesModel.train(features, salesTargets);
    this.spendModel.train(features, spendTargets);
    this.clicksModel.train(features, clicksTargets);
    this.conversionsModel.train(features, conversionsTargets);
  }

  /**
   * 推荐最优出价
   */
  recommendBid(
    currentData: {
      currentBid: number;
      avgImpressions: number;
      avgClicks: number;
    },
    target: OptimizationTarget
  ): BidRecommendation {
    const { currentBid, avgImpressions, avgClicks } = currentData;

    // 搜索最优出价(网格搜索)
    const bidRange = this.generateBidRange(currentBid);
    let bestBid = currentBid;
    let bestScore = -Infinity;
    let bestPredictions = {
      sales: 0,
      spend: 0,
      clicks: 0,
      conversions: 0,
    };

    for (const testBid of bidRange) {
      const features = [
        testBid,
        avgImpressions,
        avgClicks,
        Math.log(testBid + 1),
      ];

      const predictedSales = this.salesModel.predict(features);
      const predictedSpend = this.spendModel.predict(features);
      const predictedClicks = this.clicksModel.predict(features);
      const predictedConversions = this.conversionsModel.predict(features);

      // 确保预测值合理
      if (
        predictedSales < 0 ||
        predictedSpend < 0 ||
        predictedClicks < 0 ||
        predictedConversions < 0
      ) {
        continue;
      }

      const predictedACoS =
        predictedSales === 0 ? 999 : (predictedSpend / predictedSales) * 100;
      const predictedROAS =
        predictedSpend === 0 ? 0 : predictedSales / predictedSpend;

      // 根据目标计算得分
      let score = 0;
      switch (target.type) {
        case 'maximize_sales':
          score = predictedSales;
          // 考虑预算约束
          if (target.maxBudget && predictedSpend > target.maxBudget) {
            score = 0;
          }
          break;

        case 'target_acos':
          if (target.targetValue) {
            // 越接近目标ACoS越好,同时尽可能提高销售额
            const acosDeviation = Math.abs(predictedACoS - target.targetValue);
            score = predictedSales / (1 + acosDeviation);
          }
          break;

        case 'target_roas':
          if (target.targetValue) {
            // 越接近目标ROAS越好,同时尽可能提高销售额
            const roasDeviation = Math.abs(predictedROAS - target.targetValue);
            score = predictedSales / (1 + roasDeviation);
          }
          break;
      }

      if (score > bestScore) {
        bestScore = score;
        bestBid = testBid;
        bestPredictions = {
          sales: predictedSales,
          spend: predictedSpend,
          clicks: predictedClicks,
          conversions: predictedConversions,
        };
      }
    }

    const expectedACoS =
      bestPredictions.sales === 0
        ? 999
        : (bestPredictions.spend / bestPredictions.sales) * 100;
    const expectedROAS =
      bestPredictions.spend === 0
        ? 0
        : bestPredictions.sales / bestPredictions.spend;

    // 计算置信度(基于出价变化幅度)
    const bidChangeRatio = Math.abs(bestBid - currentBid) / currentBid;
    const confidence = Math.max(0.5, 1 - bidChangeRatio);

    // 生成推理说明
    const reasoning = this.generateReasoning(
      currentBid,
      bestBid,
      target,
      expectedACoS,
      expectedROAS
    );

    return {
      recommendedBid: Math.round(bestBid * 100) / 100,
      confidence,
      expectedSpend: Math.round(bestPredictions.spend * 100) / 100,
      expectedSales: Math.round(bestPredictions.sales * 100) / 100,
      expectedACoS: Math.round(expectedACoS * 100) / 100,
      expectedROAS: Math.round(expectedROAS * 100) / 100,
      reasoning,
    };
  }

  /**
   * 生成出价范围
   */
  private generateBidRange(currentBid: number): number[] {
    const range: number[] = [];
    const minBid = Math.max(0.02, currentBid * 0.5); // 最低降50%
    const maxBid = currentBid * 2; // 最高涨100%
    const step = (maxBid - minBid) / 50; // 50个测试点

    for (let bid = minBid; bid <= maxBid; bid += step) {
      range.push(bid);
    }

    return range;
  }

  /**
   * 生成推理说明
   */
  private generateReasoning(
    currentBid: number,
    recommendedBid: number,
    target: OptimizationTarget,
    expectedACoS: number,
    expectedROAS: number
  ): string {
    const bidChange = ((recommendedBid - currentBid) / currentBid) * 100;
    const direction = bidChange > 0 ? '提高' : '降低';
    const changeAbs = Math.abs(bidChange);

    let reasoning = `建议${direction}出价 ${changeAbs.toFixed(1)}%`;

    switch (target.type) {
      case 'maximize_sales':
        reasoning += `,以最大化销售额。预期ACoS为 ${expectedACoS.toFixed(1)}%`;
        break;
      case 'target_acos':
        reasoning += `,以达到目标ACoS ${target.targetValue}%。预期ACoS为 ${expectedACoS.toFixed(1)}%`;
        break;
      case 'target_roas':
        reasoning += `,以达到目标ROAS ${target.targetValue}。预期ROAS为 ${expectedROAS.toFixed(2)}`;
        break;
    }

    if (changeAbs > 30) {
      reasoning += '。建议分步调整,避免剧烈波动。';
    }

    return reasoning;
  }

  /**
   * 评估模型性能
   */
  evaluateModel(testData: HistoricalData[]): {
    salesR2: number;
    spendR2: number;
    clicksR2: number;
    conversionsR2: number;
    averageR2: number;
  } {
    const features = testData.map((d: any) => [
      d.bid,
      d.impressions,
      d.clicks,
      Math.log(d.bid + 1),
    ]);

    const salesR2 = this.salesModel.score(
      features,
      testData.map((d: any) => d.sales)
    );
    const spendR2 = this.spendModel.score(
      features,
      testData.map((d: any) => d.spend)
    );
    const clicksR2 = this.clicksModel.score(
      features,
      testData.map((d: any) => d.clicks)
    );
    const conversionsR2 = this.conversionsModel.score(
      features,
      testData.map((d: any) => d.conversions)
    );

    return {
      salesR2,
      spendR2,
      clicksR2,
      conversionsR2,
      averageR2: (salesR2 + spendR2 + clicksR2 + conversionsR2) / 4,
    };
  }
}

/**
 * 预算分配优化器
 */
export class BudgetAllocator {
  /**
   * 使用边际效益分析分配预算
   * @param campaigns 广告活动列表
   * @param totalBudget 总预算
   */
  allocateBudget(
    campaigns: Array<{
      id: string;
      name: string;
      currentBudget: number;
      currentROAS: number;
      historicalData: HistoricalData[];
    }>,
    totalBudget: number
  ): Array<{
    campaignId: string;
    allocatedBudget: number;
    expectedSales: number;
    expectedROAS: number;
  }> {
    // 计算每个活动的边际效益
    const marginalReturns = campaigns.map((campaign: any) => {
      const optimizer = new BidOptimizer();
      
      try {
        optimizer.train(campaign.historicalData);
        
        // 测试增加预算的效果
        const currentAvg = this.calculateAverages(campaign.historicalData);
        const testBudget = campaign.currentBudget * 1.2; // 测试增加20%预算
        
        const recommendation = optimizer.recommendBid(
          {
            currentBid: currentAvg.avgBid,
            avgImpressions: currentAvg.avgImpressions,
            avgClicks: currentAvg.avgClicks,
          },
          { type: 'maximize_sales', maxBudget: testBudget }
        );

        const marginalReturn =
          (recommendation.expectedSales - currentAvg.avgSales) /
          (testBudget - campaign.currentBudget);

        return {
          campaignId: (campaign as Record<string, any>).campaignId,
          marginalReturn: marginalReturn > 0 ? marginalReturn : 0,
          currentBudget: campaign.currentBudget,
          optimizer,
          currentAvg,
        };
      } catch (error) {
        // 数据不足,使用当前ROAS作为边际回报
        return {
          campaignId: (campaign as Record<string, any>).campaignId,
          marginalReturn: campaign.currentROAS,
          currentBudget: campaign.currentBudget,
          optimizer: null,
          currentAvg: null,
        };
      }
    });

    // 按边际效益排序
    marginalReturns.sort((a: any, b: any) => b.marginalReturn - a.marginalReturn);

    // 分配预算
    const allocations: Array<{
      campaignId: string;
      allocatedBudget: number;
      expectedSales: number;
      expectedROAS: number;
    }> = [];

    let remainingBudget = totalBudget;

    for (const mr of marginalReturns) {
      if (remainingBudget <= 0) {
        allocations.push({
          campaignId: mr.campaignId,
          allocatedBudget: 0,
          expectedSales: 0,
          expectedROAS: 0,
        });
        continue;
      }

      // 分配预算(至少保留最小预算,最多分配剩余预算的50%)
      const minBudget = mr.currentBudget * 0.5;
      const maxBudget = Math.min(
        mr.currentBudget * 2,
        remainingBudget,
        totalBudget * 0.5
      );
      const allocatedBudget = Math.max(minBudget, maxBudget);

      let expectedSales = 0;
      let expectedROAS = 0;

      if (mr.optimizer && mr.currentAvg) {
        const recommendation = mr.optimizer.recommendBid(
          {
            currentBid: mr.currentAvg.avgBid,
            avgImpressions: mr.currentAvg.avgImpressions,
            avgClicks: mr.currentAvg.avgClicks,
          },
          { type: 'maximize_sales', maxBudget: allocatedBudget }
        );

        expectedSales = recommendation.expectedSales;
        expectedROAS = recommendation.expectedROAS;
      }

      allocations.push({
        campaignId: mr.campaignId,
        allocatedBudget: Math.round(allocatedBudget * 100) / 100,
        expectedSales: Math.round(expectedSales * 100) / 100,
        expectedROAS: Math.round(expectedROAS * 100) / 100,
      });

      remainingBudget -= allocatedBudget;
    }

    return allocations;
  }

  /**
   * 计算历史数据平均值
   */
  private calculateAverages(data: HistoricalData[]): {
    avgBid: number;
    avgImpressions: number;
    avgClicks: number;
    avgSales: number;
  } {
    const n = data.length;
    return {
      avgBid: data.reduce((sum: any, d: any) => sum + d.bid, 0) / n,
      avgImpressions: data.reduce((sum: any, d: any) => sum + d.impressions, 0) / n,
      avgClicks: data.reduce((sum: any, d: any) => sum + d.clicks, 0) / n,
      avgSales: data.reduce((sum: any, d: any) => sum + d.sales, 0) / n,
    };
  }
}
