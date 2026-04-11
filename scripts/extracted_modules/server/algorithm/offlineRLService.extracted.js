// Extracted from production dist/index.js
// Original module: server/algorithm/offlineRLService.ts
// Lines: 395

async function getDbInstance6() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
function bidDeltaToAction(bidBefore, bidAfter) {
  if (bidBefore <= 0) return 3;
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
  return bestIdx;
}
function buildStateVector(context, currentBid) {
  const contextVec = context ? featureVectorToArray(context) : Array(FEATURE_DIM).fill(0);
  return [...contextVec, Math.min(1, currentBid / 10)];
}
function computeQ(weights, state) {
  return state.reduce((sum2, val, i) => sum2 + val * (weights[i] || 0), 0);
}
function softmax(values, temperature = 1) {
  const maxVal = Math.max(...values);
  const exps = values.map((v) => Math.exp((v - maxVal) / temperature));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExps);
}
function initCQLModel() {
  const scale = Math.sqrt(2 / STATE_DIM);
  const weights = Array.from(
    { length: NUM_ACTIONS },
    () => Array.from({ length: STATE_DIM }, () => (Math.random() - 0.5) * scale)
  );
  return {
    weights,
    trainingEpisodes: 0,
    trainingSteps: 0,
    avgLoss: 0,
    lastTrainedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function trainCQL(accountId, model = null, config2 = {}) {
  const db = await getDbInstance6();
  const {
    learningRate = 1e-3,
    gamma = 0.95,
    cqlAlpha = 0.5,
    epochs = 10,
    batchSize = 64
  } = config2;
  if (!model) {
    model = initCQLModel();
  }
  const trainingData = await db.select({
    stateBid: rlTrainingLogs.stateBid,
    stateContext: rlTrainingLogs.stateContext,
    actionBidBefore: rlTrainingLogs.actionBidBefore,
    actionBidAfter: rlTrainingLogs.actionBidAfter,
    reward: rlTrainingLogs.reward,
    episodeId: rlTrainingLogs.episodeId,
    stepIndex: rlTrainingLogs.stepIndex,
    isTerminal: rlTrainingLogs.isTerminal
  }).from(rlTrainingLogs).where(and(
    eq(rlTrainingLogs.accountId, accountId),
    isNotNull(rlTrainingLogs.reward),
    isNotNull(rlTrainingLogs.rewardFilledAt)
  )).orderBy(sql`episode_id ASC, step_index ASC`).limit(1e4);
  if (trainingData.length < 20) {
    log45.info(`[CQL] Insufficient training data (${trainingData.length}), skipping`);
    return model;
  }
  const validData = trainingData.filter((d) => {
    const reward = Number(d.reward) || 0;
    const bidBefore = Number(d.actionBidBefore) || 0;
    const bidAfter = Number(d.actionBidAfter) || 0;
    if (Math.abs(reward) > 100) return false;
    if (bidBefore <= 0 || bidAfter <= 0) return false;
    if (bidBefore > 0 && Math.abs(bidAfter - bidBefore) / bidBefore > 1) return false;
    return true;
  });
  const filteredCount = trainingData.length - validData.length;
  if (filteredCount > 0) {
    log45.info(`[CQL] v274: \u6570\u636E\u8D28\u91CF\u8FC7\u6EE4: ${filteredCount}/${trainingData.length}\u6761\u5F02\u5E38\u6837\u672C\u88AB\u79FB\u9664`);
  }
  if (validData.length < 20) {
    log45.info(`[CQL] v274: \u8FC7\u6EE4\u540E\u6570\u636E\u4E0D\u8DB3(${validData.length}), skipping`);
    return model;
  }
  const rewards = validData.map((d) => Number(d.reward) || 0);
  const rewardMean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
  const rewardStd = Math.sqrt(rewards.reduce((sum2, r) => sum2 + (r - rewardMean) ** 2, 0) / rewards.length) || 1;
  const processedData = validData;
  const samples = [];
  for (let i = 0; i < processedData.length; i++) {
    const d = processedData[i];
    const context = d.stateContext;
    const state = buildStateVector(context, Number(d.stateBid) || 0);
    const action = bidDeltaToAction(Number(d.actionBidBefore) || 0, Number(d.actionBidAfter) || 0);
    const rawReward = Number(d.reward) || 0;
    const reward = (rawReward - rewardMean) / rewardStd;
    let nextState = null;
    if (d.isTerminal !== 1 && i + 1 < processedData.length) {
      const nextD = processedData[i + 1];
      if (nextD.episodeId === d.episodeId && (nextD.stepIndex || 0) > (d.stepIndex || 0)) {
        const nextContext = nextD.stateContext;
        nextState = buildStateVector(nextContext, Number(nextD.stateBid) || 0);
      }
    }
    if (!nextState) {
      nextState = buildStateVector(context, Number(d.actionBidAfter) || Number(d.stateBid) || 0);
    }
    samples.push({ state, action, reward, nextState });
  }
  const actionCounts = Array(NUM_ACTIONS).fill(0);
  const actionQSums = Array(NUM_ACTIONS).fill(0);
  for (const sample of samples) {
    actionCounts[sample.action]++;
    actionQSums[sample.action] += computeQ(model.weights[sample.action], sample.state);
  }
  const dataAvgQ = actionQSums.map((sum2, i) => actionCounts[i] > 0 ? sum2 / actionCounts[i] : 0);
  let totalLoss = 0;
  let totalSteps = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const shuffled = [...samples].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i += batchSize) {
      const batch = shuffled.slice(i, i + batchSize);
      for (const sample of batch) {
        const { state, action, reward } = sample;
        const currentQ = computeQ(model.weights[action], state);
        const nextS = sample.nextState || state;
        const nextQValues = model.weights.map((w) => computeQ(w, nextS));
        const maxNextQ = sample.nextState ? Math.max(...nextQValues) : 0;
        const tdTarget = reward + gamma * maxNextQ;
        const tdError = tdTarget - currentQ;
        const policyQ = computeQ(model.weights[action], state);
        const cqlPenalty = policyQ - dataAvgQ[action];
        for (let j = 0; j < STATE_DIM; j++) {
          model.weights[action][j] += learningRate * tdError * state[j];
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
  model.lastTrainedAt = (/* @__PURE__ */ new Date()).toISOString();
  model.qualityMetrics = evaluateModelQuality(model, samples);
  log45.info(`[CQL] v274 Training complete: ${samples.length} samples(filtered ${filteredCount}), ${epochs} epochs, avgLoss=${model.avgLoss.toFixed(6)}, quality=${model.qualityMetrics.overallScore.toFixed(3)}`);
  return model;
}
function evaluateModelQuality(model, samples) {
  const qValues = [];
  for (const sample of samples.slice(0, 200)) {
    for (let a = 0; a < NUM_ACTIONS; a++) {
      qValues.push(computeQ(model.weights[a], sample.state));
    }
  }
  const qMean = qValues.reduce((a, b) => a + b, 0) / qValues.length;
  const qStd = Math.sqrt(qValues.reduce((sum2, q) => sum2 + (q - qMean) ** 2, 0) / qValues.length);
  const qValueStability = Math.max(0, Math.min(1, 1 - Math.abs(qStd - 0.5) / 2));
  let consistentPairs = 0;
  let totalPairs = 0;
  const sampleSubset = samples.slice(0, 100);
  for (let i = 0; i < sampleSubset.length; i++) {
    for (let j = i + 1; j < Math.min(i + 5, sampleSubset.length); j++) {
      const stateDistSq = sampleSubset[i].state.reduce((sum2, v, k) => sum2 + (v - sampleSubset[j].state[k]) ** 2, 0);
      if (stateDistSq < 0.5) {
        const q1 = model.weights.map((w) => computeQ(w, sampleSubset[i].state));
        const q2 = model.weights.map((w) => computeQ(w, sampleSubset[j].state));
        const bestA1 = q1.indexOf(Math.max(...q1));
        const bestA2 = q2.indexOf(Math.max(...q2));
        if (bestA1 === bestA2) consistentPairs++;
        totalPairs++;
      }
    }
  }
  const policyConsistency = totalPairs > 0 ? consistentPairs / totalPairs : 0.5;
  const predictedQ = [];
  const actualRewards = [];
  for (const sample of sampleSubset) {
    predictedQ.push(computeQ(model.weights[sample.action], sample.state));
    actualRewards.push(sample.reward);
  }
  const rewardCorrelation = Math.max(0, Math.min(1, Math.abs(pearsonCorrelation(predictedQ, actualRewards))));
  const actionCounts = Array(NUM_ACTIONS).fill(0);
  for (const sample of samples.slice(0, 500)) {
    const qVals = model.weights.map((w) => computeQ(w, sample.state));
    const bestAction = qVals.indexOf(Math.max(...qVals));
    actionCounts[bestAction]++;
  }
  const totalActions = actionCounts.reduce((a, b) => a + b, 0);
  const maxActionPct = totalActions > 0 ? Math.max(...actionCounts) / totalActions : 1;
  const actionDiversity = 1 - maxActionPct;
  const dataQualityScore = Math.min(1, samples.length / 500);
  const overallScore = qValueStability * 0.2 + policyConsistency * 0.25 + rewardCorrelation * 0.25 + actionDiversity * 0.15 + dataQualityScore * 0.15;
  return {
    qValueStability,
    policyConsistency,
    rewardCorrelation,
    actionDiversity,
    dataQualityScore,
    overallScore,
    evaluatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const xMean = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const yMean = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den > 0 ? num / den : 0;
}
function cqlDecide(model, context, currentBid, temperature = 0.5) {
  const state = buildStateVector(context, currentBid);
  const qValues = model.weights.map((w) => computeQ(w, state));
  const probs = softmax(qValues, temperature);
  let bestAction = 3;
  let bestQ = -Infinity;
  for (let i = 0; i < NUM_ACTIONS; i++) {
    if (qValues[i] > bestQ) {
      bestQ = qValues[i];
      bestAction = i;
    }
  }
  const bidMultiplier = 1 + ACTIONS[bestAction];
  const recommendedBid = Math.max(0.02, Math.round(currentBid * bidMultiplier * 100) / 100);
  const safeBid = Math.max(
    currentBid * 0.7,
    // 最多降30%
    Math.min(currentBid * 1.3, recommendedBid)
    // 最多加30%
  );
  const confidence = probs[bestAction];
  const isConservative = confidence < 0.3;
  return {
    actionIndex: bestAction,
    bidMultiplier,
    recommendedBid: Math.round(safeBid * 100) / 100,
    qValues,
    confidence,
    isConservative
  };
}
async function loadModelFromDb(accountId) {
  try {
    const db = await getDbInstance6();
    const { cqlModels: cqlModels2 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const rows = await db.select().from(cqlModels2).where(eq(cqlModels2.accountId, accountId)).orderBy(sql`model_version DESC`).limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    const weights = JSON.parse(row.weights);
    if (!Array.isArray(weights) || weights.length !== NUM_ACTIONS) {
      log45.warn(`[CQL] v230: Invalid model weights dimensions for account ${accountId}`);
      return null;
    }
    return {
      weights,
      // @ts-ignore
      trainingEpisodes: row.trainingEpisodes || 0,
      // @ts-ignore
      trainingSteps: row.trainingSteps || 0,
      // @ts-ignore
      avgLoss: Number(row.avgLoss) || 0,
      // @ts-ignore
      lastTrainedAt: row.lastTrainedAt || (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (error48) {
    log45.warn(`[CQL] v230: Failed to load model from DB:`, error48);
    return null;
  }
}
async function saveModelToDb(accountId, model) {
  try {
    const db = await getDbInstance6();
    const { cqlModels: cqlModels2 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const weightsJson = JSON.stringify(model.weights);
    const existing = await db.select({ id: cqlModels2.id, modelVersion: cqlModels2.modelVersion }).from(cqlModels2).where(eq(cqlModels2.accountId, accountId)).limit(1);
    if (existing.length > 0) {
      await db.update(cqlModels2).set({
        weights: weightsJson,
        trainingEpisodes: model.trainingEpisodes,
        trainingSteps: model.trainingSteps,
        avgLoss: String(model.avgLoss),
        lastTrainedAt: model.lastTrainedAt,
        modelVersion: (existing[0].modelVersion || 1) + 1
      }).where(eq(cqlModels2.id, existing[0].id));
    } else {
      await db.insert(cqlModels2).values({
        accountId,
        weights: weightsJson,
        trainingEpisodes: model.trainingEpisodes,
        trainingSteps: model.trainingSteps,
        avgLoss: String(model.avgLoss),
        lastTrainedAt: model.lastTrainedAt,
        modelVersion: 1
      });
    }
    log45.info(`[CQL] v230: Model saved to DB for account ${accountId}, episodes=${model.trainingEpisodes}`);
  } catch (error48) {
    log45.warn(`[CQL] v230: Failed to save model to DB:`, error48);
  }
}
async function getOrTrainCQLModel(accountId) {
  const cached2 = modelCache.get(accountId);
  if (cached2) {
    const age = Date.now() - new Date(cached2.lastTrainedAt).getTime();
    if (age < 6 * 36e5) return cached2;
  }
  const dbModel = await loadModelFromDb(accountId);
  if (dbModel) {
    const age = Date.now() - new Date(dbModel.lastTrainedAt).getTime();
    if (age < 6 * 36e5) {
      modelCache.set(accountId, dbModel);
      log45.info(`[CQL] v230: Model loaded from DB for account ${accountId}`);
      return dbModel;
    }
    const model2 = await trainCQL(accountId, dbModel);
    modelCache.set(accountId, model2);
    await saveModelToDb(accountId, model2);
    return model2;
  }
  const model = await trainCQL(accountId, cached2 || null);
  if (modelCache.size >= MAX_MODEL_CACHE_SIZE && !modelCache.has(accountId)) {
    const firstKey = modelCache.keys().next().value;
    if (firstKey !== void 0) modelCache.delete(firstKey);
  }
  modelCache.set(accountId, model);
  await saveModelToDb(accountId, model);
  return model;
}
async function makeCQLBidDecision(accountId, context, currentBid) {
  try {
    const model = await getOrTrainCQLModel(accountId);
    if (model.trainingEpisodes < 5) {
      return null;
    }
    const decision = cqlDecide(model, context, currentBid);
    if (decision && decision.confidence < 0.35 && model.trainingEpisodes >= 5) {
      decision.confidence = Math.max(0.35, decision.confidence);
    }
    return decision;
  } catch (error48) {
    log45.warn(`[CQL] Error making decision:`, error48);
    return null;
  }
}
var log45, ACTIONS, NUM_ACTIONS, STATE_DIM, modelCache, MAX_MODEL_CACHE_SIZE;
var init_offlineRLService = __esm({
  "server/algorithm/offlineRLService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_contextualFeatureService();
    log45 = createModuleLogger("OfflineRLService");
    ACTIONS = [-0.3, -0.15, -0.05, 0, 0.05, 0.15, 0.3];
    NUM_ACTIONS = ACTIONS.length;
    STATE_DIM = FEATURE_DIM + 1;
    __name(getDbInstance6, "getDbInstance");
    __name(bidDeltaToAction, "bidDeltaToAction");
    __name(buildStateVector, "buildStateVector");
    __name(computeQ, "computeQ");
    __name(softmax, "softmax");
    __name(initCQLModel, "initCQLModel");
    __name(trainCQL, "trainCQL");
    __name(evaluateModelQuality, "evaluateModelQuality");
    __name(pearsonCorrelation, "pearsonCorrelation");
    __name(cqlDecide, "cqlDecide");
    modelCache = /* @__PURE__ */ new Map();
    MAX_MODEL_CACHE_SIZE = 10;
    __name(loadModelFromDb, "loadModelFromDb");
    __name(saveModelToDb, "saveModelToDb");
    __name(getOrTrainCQLModel, "getOrTrainCQLModel");
    __name(makeCQLBidDecision, "makeCQLBidDecision");
  }
});

