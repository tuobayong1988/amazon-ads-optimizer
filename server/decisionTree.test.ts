import { describe, expect, it } from "vitest";
import {
  KeywordFeatures,
  TreeNode,
  PredictionResult,
  bayesianUpdate
} from "./decisionTreeService";

describe("Decision Tree Service", () => {
  describe("KeywordFeatures type", () => {
    it("should define correct keyword feature structure", () => {
      const features: KeywordFeatures = {
        matchType: "exact",
        wordCount: 3,
        keywordType: "brand",
        avgBid: 1.5,
        categoryId: "electronics",
        priceRange: "medium",
        competitionLevel: "high"
      };

      expect(features.matchType).toBe("exact");
      expect(features.wordCount).toBe(3);
      expect(features.keywordType).toBe("brand");
      expect(features.avgBid).toBe(1.5);
    });

    it("should support all match types", () => {
      const exactFeatures: KeywordFeatures = {
        matchType: "exact",
        wordCount: 2,
        keywordType: "brand",
        avgBid: 2.0
      };

      const phraseFeatures: KeywordFeatures = {
        matchType: "phrase",
        wordCount: 3,
        keywordType: "generic",
        avgBid: 1.5
      };

      const broadFeatures: KeywordFeatures = {
        matchType: "broad",
        wordCount: 4,
        keywordType: "product",
        avgBid: 1.0
      };

      expect(exactFeatures.matchType).toBe("exact");
      expect(phraseFeatures.matchType).toBe("phrase");
      expect(broadFeatures.matchType).toBe("broad");
    });

    it("should support all keyword types", () => {
      const types: Array<KeywordFeatures["keywordType"]> = [
        "brand",
        "competitor",
        "generic",
        "product"
      ];

      types.forEach(type => {
        const features: KeywordFeatures = {
          matchType: "exact",
          wordCount: 2,
          keywordType: type,
          avgBid: 1.0
        };
        expect(features.keywordType).toBe(type);
      });
    });
  });

  describe("TreeNode structure", () => {
    it("should create a leaf node", () => {
      const leafNode: TreeNode = {
        id: 1,
        isLeaf: true,
        prediction: 0.05,
        samples: 100,
        variance: 0.001
      };

      expect(leafNode.isLeaf).toBe(true);
      expect(leafNode.prediction).toBe(0.05);
      expect(leafNode.samples).toBe(100);
    });

    it("should create a decision node", () => {
      const decisionNode: TreeNode = {
        id: 1,
        feature: "matchType",
        threshold: undefined,
        operator: "==",
        values: ["exact"],
        isLeaf: false,
        left: {
          id: 2,
          isLeaf: true,
          prediction: 0.08,
          samples: 50
        },
        right: {
          id: 3,
          isLeaf: true,
          prediction: 0.03,
          samples: 150
        }
      };

      expect(decisionNode.isLeaf).toBe(false);
      expect(decisionNode.feature).toBe("matchType");
      expect(decisionNode.left?.prediction).toBe(0.08);
      expect(decisionNode.right?.prediction).toBe(0.03);
    });

    it("should support numeric split", () => {
      const numericSplitNode: TreeNode = {
        id: 1,
        feature: "wordCount",
        threshold: 3,
        operator: "<=",
        isLeaf: false,
        left: {
          id: 2,
          isLeaf: true,
          prediction: 0.06,
          samples: 80
        },
        right: {
          id: 3,
          isLeaf: true,
          prediction: 0.02,
          samples: 120
        }
      };

      expect(numericSplitNode.threshold).toBe(3);
      expect(numericSplitNode.operator).toBe("<=");
    });
  });

  describe("bayesianUpdate", () => {
    it("should update prediction with new data", () => {
      // bayesianUpdate(priorCR, priorVariance, observedCR, observedSamples)
      const priorCR = 0.05;
      const priorVariance = 0.001;
      const observedCR = 0.08;
      const observedSamples = 20;

      const result = bayesianUpdate(priorCR, priorVariance, observedCR, observedSamples);

      // 更新后的CR应该在先验和新数据之间
      expect(result.posteriorCR).toBeGreaterThan(priorCR);
      expect(result.posteriorCR).toBeLessThan(observedCR);
      
      // 后验方差应该减小
      expect(result.posteriorVariance).toBeLessThan(priorVariance);
    });

    it("should weight by sample size", () => {
      // 先验有很高的精度（低方差）
      const strongPriorCR = 0.05;
      const strongPriorVariance = 0.0001; // 低方差 = 高精度
      
      // 新数据只有少量样本
      const observedCR = 0.10;
      const weakObservedSamples = 10;

      const result = bayesianUpdate(strongPriorCR, strongPriorVariance, observedCR, weakObservedSamples);

      // 结果应该更接近先验（因为先验精度更高）
      expect(Math.abs(result.posteriorCR - strongPriorCR)).toBeLessThan(
        Math.abs(result.posteriorCR - observedCR)
      );
    });

    it("should converge to new data with many new samples", () => {
      // 先验精度低（高方差）
      const weakPriorCR = 0.05;
      const weakPriorVariance = 0.01; // 高方差 = 低精度
      
      // 新数据有很多样本
      const observedCR = 0.10;
      const strongObservedSamples = 1000;

      const result = bayesianUpdate(weakPriorCR, weakPriorVariance, observedCR, strongObservedSamples);

      // 结果应该更接近新数据（因为新数据样本更多）
      expect(Math.abs(result.posteriorCR - observedCR)).toBeLessThan(
        Math.abs(result.posteriorCR - weakPriorCR)
      );
    });
  });

  describe("PredictionResult structure", () => {
    it("should contain all required fields", () => {
      const prediction: PredictionResult = {
        predictedCR: 0.05,
        predictedCV: 30,
        crLow: 0.03,
        crHigh: 0.07,
        cvLow: 25,
        cvHigh: 35,
        confidence: 0.85,
        sampleCount: 150,
        predictionSource: "decision_tree"
      };

      expect(prediction.predictedCR).toBe(0.05);
      expect(prediction.predictedCV).toBe(30);
      expect(prediction.confidence).toBe(0.85);
      expect(prediction.predictionSource).toBe("decision_tree");
    });

    it("should have valid confidence interval", () => {
      const prediction: PredictionResult = {
        predictedCR: 0.05,
        predictedCV: 30,
        crLow: 0.03,
        crHigh: 0.07,
        cvLow: 25,
        cvHigh: 35,
        confidence: 0.85,
        sampleCount: 150,
        predictionSource: "historical"
      };

      // 置信区间应该包含预测值
      expect(prediction.crLow).toBeLessThanOrEqual(prediction.predictedCR);
      expect(prediction.crHigh).toBeGreaterThanOrEqual(prediction.predictedCR);
      expect(prediction.cvLow).toBeLessThanOrEqual(prediction.predictedCV);
      expect(prediction.cvHigh).toBeGreaterThanOrEqual(prediction.predictedCV);
    });

    it("should support all prediction sources", () => {
      const sources: Array<PredictionResult["predictionSource"]> = [
        "historical",
        "decision_tree",
        "bayesian_update"
      ];

      sources.forEach(source => {
        const prediction: PredictionResult = {
          predictedCR: 0.05,
          predictedCV: 30,
          crLow: 0.03,
          crHigh: 0.07,
          cvLow: 25,
          cvHigh: 35,
          confidence: 0.85,
          sampleCount: 150,
          predictionSource: source
        };
        expect(prediction.predictionSource).toBe(source);
      });
    });
  });
});

describe("Long-tail Keyword Prediction Concepts", () => {
  it("should demonstrate decision tree advantage for long-tail keywords", () => {
    // Adspert的核心洞察：决策树特别适合预测长尾关键词
    // 因为可以从相似关键词群体继承数据

    // 模拟：品牌词精确匹配的平均CR远高于通用词广泛匹配
    const brandExactCR = 0.0426; // 4.26%
    const genericBroadCR = 0.0081; // 0.81%

    expect(brandExactCR).toBeGreaterThan(genericBroadCR * 5);

    // 对于新的长尾关键词，即使没有历史数据
    // 也可以根据其特征（匹配类型、关键词类型等）预测表现
    const newLongTailKeyword = {
      wordCount: 5, // 长尾关键词通常字数多
      matchType: "exact",
      keywordType: "brand",
      hasHistoricalData: false
    };

    // 根据决策树，应该预测接近品牌词精确匹配的CR
    const predictedCR = brandExactCR * 0.9; // 略低于平均值
    
    expect(predictedCR).toBeGreaterThan(genericBroadCR);
    expect(predictedCR).toBeLessThan(brandExactCR);
  });

  it("should show feature importance in prediction", () => {
    // 特征重要性排序（基于Adspert的分析）
    const featureImportance = {
      matchType: 0.35,      // 最重要
      wordCount: 0.25,
      keywordType: 0.20,
      productCategory: 0.12,
      avgBid: 0.08
    };

    // 验证特征重要性总和为1
    const total = Object.values(featureImportance).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);

    // 匹配类型应该是最重要的特征
    expect(featureImportance.matchType).toBeGreaterThan(featureImportance.wordCount);
    expect(featureImportance.matchType).toBeGreaterThan(featureImportance.keywordType);
  });

  it("should demonstrate CR variation by match type", () => {
    // 基于Adspert PPT中的数据
    const crByMatchType = {
      exact: 0.0426,   // 4.26%
      phrase: 0.0285,  // 2.85%
      broad: 0.0081    // 0.81%
    };

    // 精确匹配CR最高
    expect(crByMatchType.exact).toBeGreaterThan(crByMatchType.phrase);
    expect(crByMatchType.phrase).toBeGreaterThan(crByMatchType.broad);

    // 精确匹配CR约是广泛匹配的5倍
    const ratio = crByMatchType.exact / crByMatchType.broad;
    expect(ratio).toBeGreaterThan(4);
    expect(ratio).toBeLessThan(6);
  });

  it("should demonstrate CR variation by keyword type", () => {
    // 品牌词vs通用词的CR差异
    const crByKeywordType = {
      brand: 0.0426,    // 品牌词
      generic: 0.0150   // 通用词
    };

    // 品牌词CR显著更高
    expect(crByKeywordType.brand).toBeGreaterThan(crByKeywordType.generic * 2);
  });
});

describe("Profit Calculation with Predictions", () => {
  it("should calculate expected profit using predicted CR and CV", () => {
    // 使用决策树预测的CR和CV计算预期利润
    const prediction: PredictionResult = {
      predictedCR: 0.05,
      predictedCV: 30,
      crLow: 0.03,
      crHigh: 0.07,
      cvLow: 25,
      cvHigh: 35,
      confidence: 0.85,
      sampleCount: 150,
      predictionSource: "decision_tree"
    };

    const clicks = 100;
    const cpc = 1.0;

    // Profit = Clicks × (CVR × AOV - CPC)
    // 这里 CVR = predictedCR, AOV = predictedCV
    const expectedProfit = clicks * (prediction.predictedCR * prediction.predictedCV - cpc);
    // = 100 * (0.05 * 30 - 1.0)
    // = 100 * (1.5 - 1.0)
    // = 100 * 0.5
    // = 50

    expect(expectedProfit).toBe(50);
  });

  it("should calculate profit range using confidence intervals", () => {
    const prediction: PredictionResult = {
      predictedCR: 0.05,
      predictedCV: 30,
      crLow: 0.03,
      crHigh: 0.07,
      cvLow: 25,
      cvHigh: 35,
      confidence: 0.85,
      sampleCount: 150,
      predictionSource: "decision_tree"
    };

    const clicks = 100;
    const cpc = 1.0;

    // 最低利润估计
    const minProfit = clicks * (prediction.crLow * prediction.cvLow - cpc);
    // = 100 * (0.03 * 25 - 1.0) = 100 * (0.75 - 1.0) = -25

    // 最高利润估计
    const maxProfit = clicks * (prediction.crHigh * prediction.cvHigh - cpc);
    // = 100 * (0.07 * 35 - 1.0) = 100 * (2.45 - 1.0) = 145

    // 预期利润
    const expectedProfit = clicks * (prediction.predictedCR * prediction.predictedCV - cpc);
    // = 50

    expect(minProfit).toBeLessThan(expectedProfit);
    expect(maxProfit).toBeGreaterThan(expectedProfit);
    expect(minProfit).toBeCloseTo(-25, 0);
    expect(maxProfit).toBeCloseTo(145, 0);
  });
});
