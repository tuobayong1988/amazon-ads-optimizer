// Extracted from production dist/index.js
// Original module: server/algorithm/contextualBanditService.ts
// Lines: 271

async function getDbInstance4() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
function identityMatrix(d) {
  return Array.from(
    { length: d },
    (_, i) => Array.from({ length: d }, (_2, j) => i === j ? 1 : 0)
  );
}
function zeroVector(d) {
  return Array(d).fill(0);
}
function invertMatrix(matrix) {
  const n = matrix.length;
  const aug = matrix.map((row, i) => [
    // @ts-expect-error - array method type inference
    ...row.map((v) => v),
    ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)
  ]);
  for (let col2 = 0; col2 < n; col2++) {
    let maxRow = col2;
    for (let row = col2 + 1; row < n; row++) {
      if (Math.abs(aug[row][col2]) > Math.abs(aug[maxRow][col2])) maxRow = row;
    }
    [aug[col2], aug[maxRow]] = [aug[maxRow], aug[col2]];
    const pivot = aug[col2][col2];
    if (Math.abs(pivot) < 1e-12) {
      aug[col2][col2] += 1e-3;
    }
    const pivotVal = aug[col2][col2];
    for (let j = 0; j < 2 * n; j++) aug[col2][j] /= pivotVal;
    for (let row = 0; row < n; row++) {
      if (row === col2) continue;
      const factor = aug[row][col2];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col2][j];
      }
    }
  }
  return aug.map((row) => row.slice(n));
}
function matVecMul(A2, x) {
  return A2.map((row) => row.reduce((sum2, val, j) => sum2 + val * x[j], 0));
}
function dotProduct(a, b) {
  return a.reduce((sum2, val, i) => sum2 + val * b[i], 0);
}
function outerProduct(x) {
  return x.map((xi) => x.map((xj) => xi * xj));
}
function matAdd(A2, B) {
  return A2.map((row, i) => row.map((val, j) => val + B[i][j]));
}
function vecAdd(a, b) {
  return a.map((val, i) => val + b[i]);
}
function vecScale(a, s) {
  return a.map((val) => val * s);
}
async function loadOrInitLinUCBModel(accountId) {
  const db = await getDbInstance4();
  const d = FEATURE_DIM;
  const existingModels = await db.select().from(linucbModels).where(and(
    eq(linucbModels.accountId, accountId),
    eq(linucbModels.isActive, 1)
  ));
  // v595: Fix LinUCB model duplication - use >= check and dedup
  if (existingModels.length >= ARM_CONFIGS.length) {
    // v595: If there are more models than expected, use only the latest 5
    const modelsToUse = existingModels.length > ARM_CONFIGS.length 
      ? existingModels.slice(0, ARM_CONFIGS.length) 
      : existingModels;
    return modelsToUse.map((m) => ({
      armId: m.armId,
      armType: m.armType,
      A: m.matrixA,
      b: m.vectorB,
      theta: matVecMul(invertMatrix(m.matrixA) || identityMatrix(d), m.vectorB),
      totalPulls: m.totalPulls || 0,
      totalReward: Number(m.totalReward) || 0,
      avgReward: Number(m.avgReward) || 0
    }));
  }
  // v595: Check if models already exist before inserting (prevent duplicates)
  const existingCheck = await db.select().from(linucbModels).where(
    eq(linucbModels.accountId, accountId)
  );
  if (existingCheck.length > 0) {
    // Models exist but count mismatch - deactivate old ones and create fresh
    try {
      await db.execute(sql`UPDATE linucb_models SET is_active = 0 WHERE accountId = ${accountId}`);
    } catch (e) { /* ignore cleanup errors */ }
  }
  const arms = ARM_CONFIGS.map((config2) => ({
    armId: `${accountId}_${config2.type}`,
    armType: config2.type,
    A: identityMatrix(d),
    b: zeroVector(d),
    theta: zeroVector(d),
    totalPulls: 0,
    totalReward: 0,
    avgReward: 0
  }));
  for (const arm of arms) {
    await db.insert(linucbModels).values({
      accountId,
      armId: arm.armId,
      armType: arm.armType,
      matrixA: arm.A,
      vectorB: arm.b,
      featureDim: d,
      alpha: "2.0000",
      // 初始探索系数较大
      totalPulls: 0,
      totalReward: "0",
      avgReward: "0"
    });
  }
  return arms;
}
async function selectArm(accountId, context, currentBid, alpha = 1.5) {
  const arms = await loadOrInitLinUCBModel(accountId);
  const x = featureVectorToArray(context);
  const scores = {};
  let bestArm = null;
  let bestScore = -Infinity;
  let bestExplorationBonus = 0;
  for (const arm of arms) {
    const AInv = invertMatrix(arm.A);
    if (!AInv) continue;
    const theta = matVecMul(AInv, arm.b);
    const exploitation = dotProduct(theta, x);
    const AInvX = matVecMul(AInv, x);
    const exploration = alpha * Math.sqrt(Math.max(0, dotProduct(x, AInvX)));
    const ucbScore = exploitation + exploration;
    scores[arm.armType] = Math.round(ucbScore * 1e4) / 1e4;
    if (ucbScore > bestScore) {
      bestScore = ucbScore;
      bestArm = arm;
      bestExplorationBonus = exploration;
    }
  }
  if (!bestArm) {
    bestArm = arms.find((a) => a.armType === "bid_conservative") || arms[0];
  }
  const config2 = ARM_CONFIGS.find((c) => c.type === bestArm.armType);
  const [minMul, maxMul] = config2.bidMultiplierRange;
  const normalizedScore = Math.max(0, Math.min(1, (bestScore + 1) / 2));
  const bidMultiplier = minMul + normalizedScore * (maxMul - minMul);
  const safeBidMultiplier = Math.max(0.7, Math.min(1.3, bidMultiplier));
  const recommendedBid = Math.round(currentBid * safeBidMultiplier * 100) / 100;
  const totalPulls = arms.reduce((sum2, a) => sum2 + a.totalPulls, 0);
  const confidence = Math.min(1, 0.35 + totalPulls / 150 * 0.65);
  return {
    selectedArm: bestArm.armType,
    ucbScore: bestScore,
    allScores: scores,
    bidMultiplier: safeBidMultiplier,
    recommendedBid: Math.max(0.02, recommendedBid),
    explorationBonus: bestExplorationBonus,
    confidence
  };
}
async function updateArm(accountId, armType, context, reward) {
  if (!isFinite(reward) || isNaN(reward)) {
    log43.warn(`[LinUCB] v231: updateArm skipped - invalid reward: ${reward}`);
    return;
  }
  const clampedReward = Math.max(-10, Math.min(10, reward));
  const db = await getDbInstance4();
  const x = featureVectorToArray(context);
  const models = await db.select().from(linucbModels).where(and(
    eq(linucbModels.accountId, accountId),
    eq(linucbModels.armType, armType),
    eq(linucbModels.isActive, 1)
  )).limit(1);
  if (models.length === 0) return;
  const model = models[0];
  const A2 = model.matrixA;
  const b = model.vectorB;
  const xxT = outerProduct(x);
  const newA = matAdd(A2, xxT);
  const newB = vecAdd(b, vecScale(x, clampedReward));
  const newTotalPulls = (model.totalPulls || 0) + 1;
  const newTotalReward = Number(model.totalReward || 0) + clampedReward;
  const newAvgReward = newTotalReward / newTotalPulls;
  await db.update(linucbModels).set({
    matrixA: newA,
    vectorB: newB,
    totalPulls: newTotalPulls,
    totalReward: String(newTotalReward),
    avgReward: String(newAvgReward),
    lastPulledAt: (/* @__PURE__ */ new Date()).toISOString()
  }).where(eq(linucbModels.id, model.id));
}
function calculateAdaptiveAlpha(totalPulls) {
  return 2 / Math.sqrt(1 + totalPulls / 50);
}
async function makeLinUCBBidDecision(accountId, keywordId, targetId, campaignId, currentBid) {
  try {
    const context = await extractFeatureVector(accountId, keywordId, targetId, campaignId);
    if (!currentBid || currentBid <= 0) {
      return null;
    }
    const arms = await loadOrInitLinUCBModel(accountId);
    const totalPulls = arms.reduce((sum2, a) => sum2 + a.totalPulls, 0);
    const alpha = calculateAdaptiveAlpha(totalPulls);
    const decision = await selectArm(accountId, context, currentBid, alpha);
    return decision;
  } catch (error48) {
    log43.warn(`[LinUCB] Error making bid decision:`, error48);
    return null;
  }
}
var log43, ARM_CONFIGS;
var init_contextualBanditService = __esm({
  "server/algorithm/contextualBanditService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_contextualFeatureService();
    log43 = createModuleLogger("ContextualBanditService");
    ARM_CONFIGS = [
      {
        type: "bid_aggressive",
        bidMultiplierRange: [1.15, 1.3],
        description: "\u6FC0\u8FDB\u52A0\u4EF7\uFF1A\u9002\u7528\u4E8E\u9AD8CVR\u3001\u4F4E\u7ADE\u4E89\u3001\u5C55\u73B0\u4E0D\u8DB3\u7684\u573A\u666F"
      },
      {
        type: "bid_moderate",
        bidMultiplierRange: [1.05, 1.15],
        description: "\u6E29\u548C\u52A0\u4EF7\uFF1A\u9002\u7528\u4E8E\u8868\u73B0\u826F\u597D\u3001\u6709\u589E\u957F\u7A7A\u95F4\u7684\u573A\u666F"
      },
      {
        type: "bid_conservative",
        bidMultiplierRange: [0.95, 1.05],
        description: "\u4FDD\u5B88\u5FAE\u8C03\uFF1A\u9002\u7528\u4E8E\u8868\u73B0\u7A33\u5B9A\u3001\u9700\u8981\u7EF4\u6301\u7684\u573A\u666F"
      },
      {
        type: "bid_hold",
        bidMultiplierRange: [0.9, 0.95],
        description: "\u6E29\u548C\u964D\u4EF7\uFF1A\u9002\u7528\u4E8EACOS\u504F\u9AD8\u3001\u9700\u8981\u63A7\u5236\u6210\u672C\u7684\u573A\u666F"
      },
      {
        type: "bid_decrease",
        bidMultiplierRange: [0.75, 0.9],
        description: "\u660E\u663E\u964D\u4EF7\uFF1A\u9002\u7528\u4E8E\u9AD8ACOS\u3001\u4F4ECVR\u3001\u9700\u8981\u6B62\u635F\u7684\u573A\u666F"
      }
    ];
    __name(getDbInstance4, "getDbInstance");
    __name(identityMatrix, "identityMatrix");
    __name(zeroVector, "zeroVector");
    __name(invertMatrix, "invertMatrix");
    __name(matVecMul, "matVecMul");
    __name(dotProduct, "dotProduct");
    __name(outerProduct, "outerProduct");
    __name(matAdd, "matAdd");
    __name(vecAdd, "vecAdd");
    __name(vecScale, "vecScale");
    __name(loadOrInitLinUCBModel, "loadOrInitLinUCBModel");
    __name(selectArm, "selectArm");
    __name(updateArm, "updateArm");
    __name(calculateAdaptiveAlpha, "calculateAdaptiveAlpha");
    __name(makeLinUCBBidDecision, "makeLinUCBBidDecision");
  }
});

