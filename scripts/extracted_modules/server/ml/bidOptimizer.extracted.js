// Extracted from production dist/index.js
// Original module: server/ml/bidOptimizer.ts
// Lines: 389

var LinearRegressionModel, BidOptimizer, BudgetAllocator;
var init_bidOptimizer2 = __esm({
  "server/ml/bidOptimizer.ts"() {
    "use strict";
    LinearRegressionModel = class {
      static {
        __name(this, "LinearRegressionModel");
      }
      weights = [];
      bias = 0;
      learningRate = 0.01;
      iterations = 1e3;
      /**
       * 训练模型
       * @param X 特征矩阵 [n_samples, n_features]
       * @param y 目标值 [n_samples]
       */
      train(X, y) {
        const nSamples = X.length;
        const nFeatures = X[0].length;
        this.weights = Array(nFeatures).fill(0);
        this.bias = 0;
        for (let iter = 0; iter < this.iterations; iter++) {
          const predictions = X.map((x) => this.predict(x));
          const dWeights = Array(nFeatures).fill(0);
          let dBias = 0;
          for (let i = 0; i < nSamples; i++) {
            const error48 = predictions[i] - y[i];
            dBias += error48;
            for (let j = 0; j < nFeatures; j++) {
              dWeights[j] += error48 * X[i][j];
            }
          }
          this.bias -= this.learningRate * dBias / nSamples;
          for (let j = 0; j < nFeatures; j++) {
            this.weights[j] -= this.learningRate * dWeights[j] / nSamples;
          }
        }
      }
      /**
       * 预测
       */
      predict(x) {
        let result = this.bias;
        for (let i = 0; i < x.length; i++) {
          result += this.weights[i] * x[i];
        }
        return result;
      }
      /**
       * 计算R²分数
       */
      // @ts-ignore
      score(X, y) {
        const predictions = X.map((x) => this.predict(x));
        const mean = y.reduce((sum2, val) => sum2 + val, 0) / y.length;
        const ssRes = y.reduce(
          // @ts-ignore
          (sum2, val, i) => sum2 + Math.pow(val - predictions[i], 2),
          0
        );
        const ssTot = y.reduce((sum2, val) => sum2 + Math.pow(val - mean, 2), 0);
        return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
      }
    };
    BidOptimizer = class {
      static {
        __name(this, "BidOptimizer");
      }
      salesModel;
      spendModel;
      clicksModel;
      conversionsModel;
      constructor() {
        this.salesModel = new LinearRegressionModel();
        this.spendModel = new LinearRegressionModel();
        this.clicksModel = new LinearRegressionModel();
        this.conversionsModel = new LinearRegressionModel();
      }
      /**
       * 训练模型
       */
      train(historicalData) {
        if (historicalData.length < 10) {
          throw new Error("Insufficient historical data for training (minimum 10 records)");
        }
        const features = historicalData.map((d) => [
          // @ts-ignore
          d.bid,
          // @ts-ignore
          d.impressions,
          // @ts-ignore
          d.clicks,
          // @ts-ignore
          Math.log(d.bid + 1)
          // 对数变换
        ]);
        const salesTargets = historicalData.map((d) => d.sales);
        const spendTargets = historicalData.map((d) => d.spend);
        const clicksTargets = historicalData.map((d) => d.clicks);
        const conversionsTargets = historicalData.map((d) => d.conversions);
        this.salesModel.train(features, salesTargets);
        this.spendModel.train(features, spendTargets);
        this.clicksModel.train(features, clicksTargets);
        this.conversionsModel.train(features, conversionsTargets);
      }
      /**
       * 推荐最优出价
       */
      recommendBid(currentData, target) {
        const { currentBid, avgImpressions, avgClicks } = currentData;
        const bidRange = this.generateBidRange(currentBid);
        let bestBid = currentBid;
        let bestScore = -Infinity;
        let bestPredictions = {
          sales: 0,
          spend: 0,
          clicks: 0,
          conversions: 0
        };
        for (const testBid of bidRange) {
          const features = [
            testBid,
            avgImpressions,
            avgClicks,
            Math.log(testBid + 1)
          ];
          const predictedSales = this.salesModel.predict(features);
          const predictedSpend = this.spendModel.predict(features);
          const predictedClicks = this.clicksModel.predict(features);
          const predictedConversions = this.conversionsModel.predict(features);
          if (predictedSales < 0 || predictedSpend < 0 || predictedClicks < 0 || predictedConversions < 0) {
            continue;
          }
          const predictedACoS = predictedSales === 0 ? 999 : predictedSpend / predictedSales * 100;
          const predictedROAS = predictedSpend === 0 ? 0 : predictedSales / predictedSpend;
          let score = 0;
          switch (target.type) {
            case "maximize_sales":
              score = predictedSales;
              if (target.maxBudget && predictedSpend > target.maxBudget) {
                score = 0;
              }
              break;
            case "target_acos":
              if (target.targetValue) {
                const acosDeviation = Math.abs(predictedACoS - target.targetValue);
                score = predictedSales / (1 + acosDeviation);
              }
              break;
            case "target_roas":
              if (target.targetValue) {
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
              conversions: predictedConversions
            };
          }
        }
        const expectedACoS = bestPredictions.sales === 0 ? 999 : bestPredictions.spend / bestPredictions.sales * 100;
        const expectedROAS = bestPredictions.spend === 0 ? 0 : bestPredictions.sales / bestPredictions.spend;
        const bidChangeRatio = Math.abs(bestBid - currentBid) / currentBid;
        const confidence = Math.max(0.5, 1 - bidChangeRatio);
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
          reasoning
        };
      }
      /**
       * 生成出价范围
       */
      generateBidRange(currentBid) {
        const range = [];
        const minBid = Math.max(0.02, currentBid * 0.5);
        const maxBid = currentBid * 2;
        const step = (maxBid - minBid) / 50;
        for (let bid = minBid; bid <= maxBid; bid += step) {
          range.push(bid);
        }
        return range;
      }
      /**
       * 生成推理说明
       */
      generateReasoning(currentBid, recommendedBid, target, expectedACoS, expectedROAS) {
        const bidChange = (recommendedBid - currentBid) / currentBid * 100;
        const direction = bidChange > 0 ? "\u63D0\u9AD8" : "\u964D\u4F4E";
        const changeAbs = Math.abs(bidChange);
        let reasoning = `\u5EFA\u8BAE${direction}\u51FA\u4EF7 ${changeAbs.toFixed(1)}%`;
        switch (target.type) {
          case "maximize_sales":
            reasoning += `,\u4EE5\u6700\u5927\u5316\u9500\u552E\u989D\u3002\u9884\u671FACoS\u4E3A ${expectedACoS.toFixed(1)}%`;
            break;
          case "target_acos":
            reasoning += `,\u4EE5\u8FBE\u5230\u76EE\u6807ACoS ${target.targetValue}%\u3002\u9884\u671FACoS\u4E3A ${expectedACoS.toFixed(1)}%`;
            break;
          case "target_roas":
            reasoning += `,\u4EE5\u8FBE\u5230\u76EE\u6807ROAS ${target.targetValue}\u3002\u9884\u671FROAS\u4E3A ${expectedROAS.toFixed(2)}`;
            break;
        }
        if (changeAbs > 30) {
          reasoning += "\u3002\u5EFA\u8BAE\u5206\u6B65\u8C03\u6574,\u907F\u514D\u5267\u70C8\u6CE2\u52A8\u3002";
        }
        return reasoning;
      }
      /**
       * 评估模型性能
       */
      evaluateModel(testData) {
        const features = testData.map((d) => [
          // @ts-ignore
          d.bid,
          // @ts-ignore
          d.impressions,
          // @ts-ignore
          d.clicks,
          // @ts-ignore
          Math.log(d.bid + 1)
          // @ts-ignore
        ]);
        const salesR2 = this.salesModel.score(
          features,
          // @ts-ignore
          testData.map((d) => d.sales)
        );
        const spendR2 = this.spendModel.score(
          features,
          // @ts-ignore
          testData.map((d) => d.spend)
        );
        const clicksR2 = this.clicksModel.score(
          features,
          // @ts-ignore
          testData.map((d) => d.clicks)
        );
        const conversionsR2 = this.conversionsModel.score(
          features,
          // @ts-ignore
          testData.map((d) => d.conversions)
        );
        return {
          salesR2,
          spendR2,
          clicksR2,
          conversionsR2,
          averageR2: (salesR2 + spendR2 + clicksR2 + conversionsR2) / 4
        };
      }
    };
    BudgetAllocator = class {
      static {
        __name(this, "BudgetAllocator");
      }
      /**
       * 使用边际效益分析分配预算
       * @param campaigns 广告活动列表
       * @param totalBudget 总预算
       */
      // @ts-ignore
      allocateBudget(campaigns6, totalBudget) {
        const marginalReturns = campaigns6.map((campaign) => {
          const optimizer = new BidOptimizer();
          try {
            optimizer.train(campaign.historicalData);
            const currentAvg = this.calculateAverages(campaign.historicalData);
            const testBudget = campaign.currentBudget * 1.2;
            const recommendation = optimizer.recommendBid(
              // @ts-ignore
              {
                // @ts-ignore
                currentBid: currentAvg.avgBid,
                avgImpressions: currentAvg.avgImpressions,
                avgClicks: currentAvg.avgClicks
              },
              { type: "maximize_sales", maxBudget: testBudget }
            );
            const marginalReturn = (
              // @ts-ignore
              (recommendation.expectedSales - currentAvg.avgSales) / // @ts-ignore
              (testBudget - campaign.currentBudget)
            );
            return {
              campaignId: campaign.campaignId,
              marginalReturn: marginalReturn > 0 ? marginalReturn : 0,
              // @ts-ignore
              currentBudget: campaign.currentBudget,
              optimizer,
              currentAvg
            };
          } catch (error48) {
            return {
              // @ts-ignore
              campaignId: campaign.campaignId,
              // @ts-ignore
              marginalReturn: campaign.currentROAS,
              // @ts-ignore
              currentBudget: campaign.currentBudget,
              optimizer: null,
              currentAvg: null
            };
          }
        });
        marginalReturns.sort((a, b) => b.marginalReturn - a.marginalReturn);
        const allocations = [];
        let remainingBudget = totalBudget;
        for (const mr of marginalReturns) {
          if (remainingBudget <= 0) {
            allocations.push({
              // @ts-ignore
              campaignId: mr.campaignId,
              allocatedBudget: 0,
              expectedSales: 0,
              expectedROAS: 0
            });
            continue;
          }
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
                avgClicks: mr.currentAvg.avgClicks
              },
              { type: "maximize_sales", maxBudget: allocatedBudget }
            );
            expectedSales = recommendation.expectedSales;
            expectedROAS = recommendation.expectedROAS;
          }
          allocations.push({
            // @ts-ignore
            campaignId: mr.campaignId,
            allocatedBudget: Math.round(allocatedBudget * 100) / 100,
            expectedSales: Math.round(expectedSales * 100) / 100,
            expectedROAS: Math.round(expectedROAS * 100) / 100
          });
          remainingBudget -= allocatedBudget;
        }
        return allocations;
      }
      /**
       * 计算历史数据平均值
       */
      calculateAverages(data) {
        const n = data.length;
        return {
          // @ts-ignore
          avgBid: data.reduce((sum2, d) => sum2 + d.bid, 0) / n,
          // @ts-ignore
          avgImpressions: data.reduce((sum2, d) => sum2 + d.impressions, 0) / n,
          // @ts-ignore
          avgClicks: data.reduce((sum2, d) => sum2 + d.clicks, 0) / n,
          // @ts-ignore
          avgSales: data.reduce((sum2, d) => sum2 + d.sales, 0) / n
        };
      }
    };
  }
});

