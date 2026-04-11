// Extracted from production dist/index.js
// Original module: server/algorithm/decisionTreeService.ts
// Lines: 473

async function getDbInstance12() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
function calculateVariance(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum2, v) => sum2 + Math.pow(v - mean, 2), 0) / values.length;
}
function calculateMean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function calculateInformationGain(parentValues, leftValues, rightValues) {
  const parentVariance = calculateVariance(parentValues);
  const leftWeight = leftValues.length / parentValues.length;
  const rightWeight = rightValues.length / parentValues.length;
  const weightedChildVariance = leftWeight * calculateVariance(leftValues) + rightWeight * calculateVariance(rightValues);
  return parentVariance - weightedChildVariance;
}
function findBestNumericSplit(data, feature, target) {
  const values = data.map((d) => ({ value: d.features[feature], target: d[target] })).filter((v) => typeof v.value === "number").sort((a, b) => a.value - b.value);
  if (values.length < 2) return null;
  let bestGain = 0;
  let bestThreshold = 0;
  const allTargets = values.map((v) => v.target);
  for (let i = 0; i < values.length - 1; i++) {
    const threshold = (values[i].value + values[i + 1].value) / 2;
    const leftTargets = values.slice(0, i + 1).map((v) => v.target);
    const rightTargets = values.slice(i + 1).map((v) => v.target);
    const gain = calculateInformationGain(allTargets, leftTargets, rightTargets);
    if (gain > bestGain) {
      bestGain = gain;
      bestThreshold = threshold;
    }
  }
  return bestGain > 0 ? { threshold: bestThreshold, gain: bestGain } : null;
}
function findBestCategoricalSplit(data, feature, target) {
  const categories = /* @__PURE__ */ new Map();
  for (const d of data) {
    const value = String(d.features[feature]);
    if (!categories.has(value)) {
      categories.set(value, []);
    }
    categories.get(value).push(d[target]);
  }
  if (categories.size < 2) return null;
  const allTargets = data.map((d) => d[target]);
  let bestGain = 0;
  let bestValues = [];
  const categoryList = Array.from(categories.keys());
  for (const cat of categoryList) {
    const leftTargets = categories.get(cat);
    const rightTargets = data.filter((d) => String(d.features[feature]) !== cat).map((d) => d[target]);
    if (leftTargets.length === 0 || rightTargets.length === 0) continue;
    const gain = calculateInformationGain(allTargets, leftTargets, rightTargets);
    if (gain > bestGain) {
      bestGain = gain;
      bestValues = [cat];
    }
  }
  return bestGain > 0 ? { values: bestValues, gain: bestGain } : null;
}
function buildTreeNode(data, target, depth, config2, nodeId) {
  const id = nodeId.current++;
  const targetValues = data.map((d) => d[target]);
  if (depth >= config2.maxDepth || data.length < config2.minSamplesSplit || calculateVariance(targetValues) < 1e-4) {
    return {
      id,
      isLeaf: true,
      prediction: calculateMean(targetValues),
      samples: data.length,
      variance: calculateVariance(targetValues)
    };
  }
  const numericFeatures = ["wordCount", "avgBid"];
  const categoricalFeatures = ["matchType", "keywordType", "priceRange", "competitionLevel"];
  let bestFeature = null;
  let bestSplit = null;
  let bestGain = 0;
  for (const feature of numericFeatures) {
    const split = findBestNumericSplit(data, feature, target);
    if (split && split.gain > bestGain) {
      bestGain = split.gain;
      bestFeature = feature;
      bestSplit = { threshold: split.threshold, operator: "<=" };
    }
  }
  for (const feature of categoricalFeatures) {
    const split = findBestCategoricalSplit(data, feature, target);
    if (split && split.gain > bestGain) {
      bestGain = split.gain;
      bestFeature = feature;
      bestSplit = { values: split.values, operator: "in" };
    }
  }
  if (!bestFeature || !bestSplit) {
    return {
      id,
      isLeaf: true,
      prediction: calculateMean(targetValues),
      samples: data.length,
      variance: calculateVariance(targetValues)
    };
  }
  let leftData;
  let rightData;
  if (bestSplit.threshold !== void 0) {
    leftData = data.filter((d) => d.features[bestFeature] <= bestSplit.threshold);
    rightData = data.filter((d) => d.features[bestFeature] > bestSplit.threshold);
  } else {
    leftData = data.filter((d) => bestSplit.values.includes(String(d.features[bestFeature])));
    rightData = data.filter((d) => !bestSplit.values.includes(String(d.features[bestFeature])));
  }
  if (leftData.length < config2.minSamplesLeaf || rightData.length < config2.minSamplesLeaf) {
    return {
      id,
      isLeaf: true,
      prediction: calculateMean(targetValues),
      samples: data.length,
      variance: calculateVariance(targetValues)
    };
  }
  return {
    id,
    feature: bestFeature,
    threshold: bestSplit.threshold,
    operator: bestSplit.operator,
    values: bestSplit.values,
    left: buildTreeNode(leftData, target, depth + 1, config2, nodeId),
    right: buildTreeNode(rightData, target, depth + 1, config2, nodeId),
    isLeaf: false,
    samples: data.length
  };
}
function predictWithTree(node, features) {
  if (node.isLeaf) {
    return {
      prediction: node.prediction || 0,
      samples: node.samples || 0,
      variance: node.variance || 0
    };
  }
  let goLeft = false;
  if (node.threshold !== void 0 && node.feature) {
    const value = features[node.feature];
    goLeft = value <= node.threshold;
  } else if (node.values && node.feature) {
    const value = String(features[node.feature]);
    goLeft = node.values.includes(value);
  }
  if (goLeft && node.left) {
    return predictWithTree(node.left, features);
  } else if (node.right) {
    return predictWithTree(node.right, features);
  }
  return { prediction: 0, samples: 0, variance: 0 };
}
function getTreeDepth(node) {
  if (node.isLeaf) return 1;
  const leftDepth = node.left ? getTreeDepth(node.left) : 0;
  const rightDepth = node.right ? getTreeDepth(node.right) : 0;
  return 1 + Math.max(leftDepth, rightDepth);
}
function countLeaves(node) {
  if (node.isLeaf) return 1;
  const leftLeaves = node.left ? countLeaves(node.left) : 0;
  const rightLeaves = node.right ? countLeaves(node.right) : 0;
  return leftLeaves + rightLeaves;
}
function calculateFeatureImportance(node, importance, totalSamples) {
  if (node.isLeaf || !node.feature) return;
  const currentImportance = importance.get(node.feature) || 0;
  const sampleRatio = (node.samples || 0) / totalSamples;
  importance.set(node.feature, currentImportance + sampleRatio);
  if (node.left) calculateFeatureImportance(node.left, importance, totalSamples);
  if (node.right) calculateFeatureImportance(node.right, importance, totalSamples);
}
async function trainDecisionTreeModel(accountId, modelType, config2 = {
  maxDepth: 6,
  minSamplesSplit: 10,
  minSamplesLeaf: 5
}) {
  const db = await getDbInstance12();
  const keywordData = await db.select().from(keywords).where(eq(keywords.keywordStatus, "enabled")).limit(5e3);
  const trainingData = keywordData.filter((k) => (k.clicks || 0) > 0).map((k) => {
    const wordCount = k.keywordText.split(" ").length;
    const avgBid = Number(k.bid) || 1;
    let keywordType = "generic";
    const text2 = k.keywordText.toLowerCase();
    if (text2.includes("brand") || text2.includes("official")) {
      keywordType = "brand";
    } else if (text2.includes("vs") || text2.includes("alternative")) {
      keywordType = "competitor";
    } else if (wordCount >= 4) {
      keywordType = "product";
    }
    return {
      features: {
        matchType: k.matchType || "broad",
        wordCount,
        keywordType,
        avgBid
      },
      cr: Number(k.keywordCvr) || 0,
      cv: (k.orders || 0) > 0 ? Number(k.sales) / (k.orders || 1) : 0
    };
  });
  if (trainingData.length < 20) {
    throw new Error("\u8BAD\u7EC3\u6570\u636E\u4E0D\u8DB3\uFF0C\u81F3\u5C11\u9700\u898120\u4E2A\u6709\u6548\u5173\u952E\u8BCD");
  }
  const target = modelType === "cr_prediction" ? "cr" : "cv";
  const nodeId = { current: 1 };
  const tree = buildTreeNode(trainingData, target, 0, config2, nodeId);
  const depth = getTreeDepth(tree);
  const leafCount = countLeaves(tree);
  const importance = /* @__PURE__ */ new Map();
  calculateFeatureImportance(tree, importance, trainingData.length);
  const featureImportance = {};
  importance.forEach((value, key) => {
    featureImportance[key] = Math.round(value * 1e3) / 1e3;
  });
  const predictions = trainingData.map((d) => predictWithTree(tree, d.features).prediction);
  const actuals = trainingData.map((d) => d[target]);
  const meanActual = calculateMean(actuals);
  const ssTotal = actuals.reduce((sum2, a) => sum2 + Math.pow(a - meanActual, 2), 0);
  const ssResidual = actuals.reduce((sum2, a, i) => sum2 + Math.pow(a - predictions[i], 2), 0);
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
async function saveDecisionTreeModel(accountId, modelType, modelResult) {
  const db = await getDbInstance12();
  await db.update(decisionTreeModels).set({ isActive: 0 }).where(
    and(
      eq(decisionTreeModels.accountId, accountId),
      eq(decisionTreeModels.modelType, modelType)
    )
  );
  const latestModel = await db.select({ id: decisionTreeModels.id }).from(decisionTreeModels).where(
    and(
      eq(decisionTreeModels.accountId, accountId),
      eq(decisionTreeModels.modelType, modelType)
    )
  ).orderBy(desc(decisionTreeModels.id)).limit(1);
  const newVersion = latestModel.length > 0 ? latestModel[0].id + 1 : 1;
  const result = await db.insert(decisionTreeModels).values({
    accountId,
    modelType,
    treeStructure: JSON.stringify(modelResult.tree),
    totalSamples: modelResult.totalSamples,
    treeDepth: modelResult.depth,
    leafCount: modelResult.leafCount,
    trainingR2: String(modelResult.trainingR2),
    featureImportance: JSON.stringify(modelResult.featureImportance),
    isActive: 1
  });
  return newVersion;
}
async function getActiveDecisionTreeModel(accountId, modelType) {
  const db = await getDbInstance12();
  const models = await db.select().from(decisionTreeModels).where(
    and(
      eq(decisionTreeModels.accountId, accountId),
      eq(decisionTreeModels.modelType, modelType),
      eq(decisionTreeModels.isActive, 1)
    )
  ).limit(1);
  if (models.length === 0) {
    return null;
  }
  const treeData = models[0].treeStructure;
  if (!treeData) return null;
  return typeof treeData === "string" ? JSON.parse(treeData) : treeData;
}
async function predictKeywordPerformance(accountId, features) {
  const crTree = await getActiveDecisionTreeModel(accountId, "cr_prediction");
  const cvTree = await getActiveDecisionTreeModel(accountId, "cv_prediction");
  let predictedCr = 0.05;
  let predictedCv = 30;
  let crSamples = 0;
  let cvSamples = 0;
  let crVariance = 0;
  let cvVariance = 0;
  let predictionSource = "historical";
  if (crTree) {
    const crResult = predictWithTree(crTree, features);
    predictedCr = crResult.prediction;
    crSamples = crResult.samples;
    crVariance = crResult.variance;
    predictionSource = "decision_tree";
  }
  if (cvTree) {
    const cvResult = predictWithTree(cvTree, features);
    predictedCv = cvResult.prediction;
    cvSamples = cvResult.samples;
    cvVariance = cvResult.variance;
  }
  const crStdDev = Math.sqrt(crVariance);
  const cvStdDev = Math.sqrt(cvVariance);
  const sampleCount = Math.min(crSamples, cvSamples);
  const confidence = Math.min(1, sampleCount / 100) * (1 - Math.min(crVariance, 1));
  return {
    predictedCr: Math.max(0, predictedCr),
    predictedCv: Math.max(0, predictedCv),
    crLow: Math.max(0, predictedCr - 1.96 * crStdDev),
    crHigh: predictedCr + 1.96 * crStdDev,
    cvLow: Math.max(0, predictedCv - 1.96 * cvStdDev),
    cvHigh: predictedCv + 1.96 * cvStdDev,
    confidence,
    sampleCount,
    predictionSource
  };
}
async function batchPredictAndSaveKeywords(accountId) {
  const db = await getDbInstance12();
  const result = { predicted: 0, failed: 0 };
  const allKeywords = await db.select().from(keywords).where(eq(keywords.keywordStatus, "enabled")).limit(5e3);
  for (const kw of allKeywords) {
    try {
      const wordCount = kw.keywordText.split(" ").length;
      let keywordType = "generic";
      const text2 = kw.keywordText.toLowerCase();
      if (text2.includes("brand") || text2.includes("official")) {
        keywordType = "brand";
      } else if (text2.includes("vs") || text2.includes("alternative")) {
        keywordType = "competitor";
      } else if (wordCount >= 4) {
        keywordType = "product";
      }
      const features = {
        // @ts-ignore
        matchType: kw.matchType || "broad",
        wordCount,
        keywordType,
        // @ts-ignore
        avgBid: Number(kw.bid) || 1
      };
      const prediction = await predictKeywordPerformance(accountId, features);
      const existing = await db.select().from(keywordPredictions).where(
        and(
          eq(keywordPredictions.accountId, accountId),
          // @ts-ignore
          eq(keywordPredictions.keywordId, kw.id)
        )
      ).limit(1);
      const predictionData = {
        accountId,
        // @ts-ignore
        keywordId: kw.id,
        // @ts-ignore
        keywordText: kw.keywordText,
        predictedCr: String(prediction.predictedCr),
        predictedCv: String(prediction.predictedCv),
        predictionSource: prediction.predictionSource === "historical" ? "default" : prediction.predictionSource,
        confidence: String(prediction.confidence),
        matchType: features.matchType,
        wordCount: features.wordCount,
        keywordType: features.keywordType,
        // @ts-ignore
        actualCr: String(Number(kw.keywordCvr) || 0),
        // @ts-ignore
        actualCV: String((kw.orders || 0) > 0 ? Number(kw.sales) / (kw.orders || 1) : 0)
      };
      if (existing.length > 0) {
        await db.update(keywordPredictions).set(predictionData).where(eq(keywordPredictions.id, existing[0].id));
      } else {
        await db.insert(keywordPredictions).values(predictionData);
      }
      result.predicted++;
    } catch (error48) {
      result.failed++;
    }
  }
  return result;
}
async function getKeywordPredictionSummary(accountId) {
  const db = await getDbInstance12();
  const predictions = await db.select().from(keywordPredictions).where(eq(keywordPredictions.accountId, accountId));
  if (predictions.length === 0) {
    return {
      totalPredictions: 0,
      avgConfidence: 0,
      avgPredictedCR: 0,
      avgPredictedCV: 0,
      predictionAccuracy: 0,
      // @ts-ignore
      byMatchType: {},
      byKeywordType: {}
    };
  }
  const totalPredictions = predictions.length;
  const avgConfidence = predictions.reduce((sum2, p) => sum2 + Number(p.confidence), 0) / totalPredictions;
  const avgPredictedCR = predictions.reduce((sum2, p) => sum2 + Number(p.predictedCr), 0) / totalPredictions;
  const avgPredictedCV = predictions.reduce((sum2, p) => sum2 + Number(p.predictedCv), 0) / totalPredictions;
  const validPredictions = predictions.filter((p) => Number(p.actualCr) > 0);
  let predictionAccuracy = 0;
  if (validPredictions.length > 0) {
    const errors = validPredictions.map(
      (p) => Math.abs(Number(p.predictedCr) - Number(p.actualCr)) / Math.max(Number(p.actualCr), 1e-3)
    );
    predictionAccuracy = 1 - errors.reduce((a, b) => a + b, 0) / errors.length;
  }
  const byMatchType = {};
  const byKeywordType = {};
  for (const p of predictions) {
    const mt = p.matchType || "unknown";
    const kt = p.keywordType || "unknown";
    if (!byMatchType[mt]) {
      byMatchType[mt] = { count: 0, avgCR: 0, avgCV: 0 };
    }
    byMatchType[mt].count++;
    byMatchType[mt].avgCR += Number(p.predictedCr);
    byMatchType[mt].avgCV += Number(p.predictedCv);
    if (!byKeywordType[kt]) {
      byKeywordType[kt] = { count: 0, avgCR: 0, avgCV: 0 };
    }
    byKeywordType[kt].count++;
    byKeywordType[kt].avgCR += Number(p.predictedCr);
    byKeywordType[kt].avgCV += Number(p.predictedCv);
  }
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
var init_decisionTreeService = __esm({
  "server/algorithm/decisionTreeService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    __name(getDbInstance12, "getDbInstance");
    __name(calculateVariance, "calculateVariance");
    __name(calculateMean, "calculateMean");
    __name(calculateInformationGain, "calculateInformationGain");
    __name(findBestNumericSplit, "findBestNumericSplit");
    __name(findBestCategoricalSplit, "findBestCategoricalSplit");
    __name(buildTreeNode, "buildTreeNode");
    __name(predictWithTree, "predictWithTree");
    __name(getTreeDepth, "getTreeDepth");
    __name(countLeaves, "countLeaves");
    __name(calculateFeatureImportance, "calculateFeatureImportance");
    __name(trainDecisionTreeModel, "trainDecisionTreeModel");
    __name(saveDecisionTreeModel, "saveDecisionTreeModel");
    __name(getActiveDecisionTreeModel, "getActiveDecisionTreeModel");
    __name(predictKeywordPerformance, "predictKeywordPerformance");
    __name(batchPredictAndSaveKeywords, "batchPredictAndSaveKeywords");
    __name(getKeywordPredictionSummary, "getKeywordPredictionSummary");
  }
});

