// Extracted from production dist/index.js
// Original module: server/algorithm/metaLearningSelector.ts
// Lines: 488

async function getDbInstance7() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
function gammaSample(shape) {
  if (shape < 1) {
    return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      const u1 = Math.random();
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function betaSample(alpha, beta) {
  const a = Math.max(0.01, alpha);
  const b = Math.max(0.01, beta);
  const x = gammaSample(a);
  const y = gammaSample(b);
  if (x + y === 0) return a / (a + b);
  return x / (x + y);
}
async function getAlgorithmStats(accountId) {
  const db = await getDbInstance7();
  const stats4 = /* @__PURE__ */ new Map();
  const algorithms = ["rule_based", "ucb", "linucb", "sigmoid_curve", "cql", "ensemble"];
  for (const alg of algorithms) {
    stats4.set(alg, {
      algorithm: alg,
      totalTrials: 0,
      totalReward: 0,
      avgReward: 0,
      alphaParam: 1,
      // 先验
      betaParam: 1
    });
  }
  const logs = await db.select({
    selectedAlgorithm: algorithmSelectionLogs.selectedAlgorithm,
    resultReward: algorithmSelectionLogs.resultReward
  }).from(algorithmSelectionLogs).where(and(
    eq(algorithmSelectionLogs.accountId, accountId),
    isNotNull(algorithmSelectionLogs.resultFilledAt)
  )).limit(1e3);
  for (const selLog of logs) {
    const alg = selLog.selectedAlgorithm;
    const stat = stats4.get(alg);
    if (!stat) continue;
    const reward = Number(selLog.resultReward) || 0;
    stat.totalTrials++;
    stat.totalReward += reward;
    stat.avgReward = stat.totalReward / stat.totalTrials;
    if (reward > 0) {
      stat.alphaParam += 1;
    } else {
      stat.betaParam += 1;
    }
  }
  return stats4;
}
async function evaluateAlgorithms(accountId, keywordId, targetId, campaignId, currentBid, strategyTemplateId) {
  const db = await getDbInstance7();
  const scores = [];
  const hoursAgo24 = new Date(Date.now() - 24 * 36e5).toISOString();
  const [rlLogCount, featureCount, stats4, totalRLLogsIncPending, historyEventCount, recentDataCount] = await Promise.all([
    // 获取已回填RL日志数
    db.select({ count: sql`COUNT(*)` }).from(rlTrainingLogs).where(and(eq(rlTrainingLogs.accountId, accountId), isNotNull(rlTrainingLogs.rewardFilledAt))),
    // 获取特征缓存状态
    db.select({ count: sql`COUNT(*)` }).from(contextualFeatures).where(eq(contextualFeatures.accountId, accountId)),
    // 获取Thompson Sampling统计
    getAlgorithmStats(accountId),
    // v258: 统计未回填的RL日志（包含已记录但未回填reward的）
    db.select({ count: sql`COUNT(*)` }).from(rlTrainingLogs).where(eq(rlTrainingLogs.accountId, accountId)),
    // v380: 从 optimization_events + optimization_logs 双源统计历史优化事件作为虚拟RL数据
    // 同时查询两个表，取较大值，确保充分利用已有数据加速冷启动
    Promise.all([
      db.select({ count: sql`COUNT(*)` }).from(sql`optimization_events`).where(and(
        sql`account_id = ${accountId}`,
        sql`event_category = 'bid_adjustment'`,
        sql`status = 'success'`,
        sql`created_at > DATE_SUB(NOW(), INTERVAL 14 DAY)`
      )).catch(() => [{ count: 0 }]),
      db.select({ count: sql`COUNT(*)` }).from(sql`optimization_logs`).where(and(
        sql`account_id = ${accountId}`,
        sql`action_type = 'bid_adjustment'`,
        sql`created_at > DATE_SUB(NOW(), INTERVAL 14 DAY)`
      )).catch(() => [{ count: 0 }])
    ]).then(([evtResult, logResult]) => {
      const evtCount = Number(evtResult[0]?.count) || 0;
      const logCount = Number(logResult[0]?.count) || 0;
      return [{ count: Math.max(evtCount, logCount) }];
    }),
    // v332: 数据新鲜度检测（原为独立查询，现合并到并行执行）
    db.select({ count: sql`COUNT(*)` }).from(rlTrainingLogs).where(and(eq(rlTrainingLogs.accountId, accountId), gte(rlTrainingLogs.createdAt, hoursAgo24)))
  ]);
  const totalRLLogs = Number(rlLogCount[0]?.count) || 0;
  const hasFeatures = Number(featureCount[0]?.count) > 0;
  const pendingRLLogs = Number(totalRLLogsIncPending[0]?.count) || 0;
  const totalHistoryEvents = Number(historyEventCount[0]?.count) || 0;
  const syntheticDataCount = totalRLLogs + Math.floor(totalHistoryEvents * 0.5);
  const syntheticPendingCount = pendingRLLogs + Math.floor(totalHistoryEvents * 0.5);
  log48.debug(`[MetaLearning] v259\u7B97\u6CD5\u8BC4\u4F30: \u8D26\u6237${accountId}, RL\u65E5\u5FD7(\u5DF2\u56DE\u586B)=${totalRLLogs}, RL\u65E5\u5FD7(\u542B\u5F85\u56DE\u586B)=${pendingRLLogs}, \u5386\u53F2\u4E8B\u4EF6=${totalHistoryEvents}, \u5408\u6210\u6570\u636E\u91CF=${syntheticDataCount}, \u7279\u5F81\u7F13\u5B58=${hasFeatures}`);
  const hourOfDay = (/* @__PURE__ */ new Date()).getHours();
  const dayOfWeek = (/* @__PURE__ */ new Date()).getDay();
  const getConsecutiveFailures = /* @__PURE__ */ __name((stat) => {
    if (stat.totalTrials < 3) return 0;
    const failRate = stat.betaParam / (stat.alphaParam + stat.betaParam);
    return failRate > 0.75 ? 0.2 : failRate > 0.6 ? 0.1 : 0;
  }, "getConsecutiveFailures");
  const hasRecentData = Number(recentDataCount[0]?.count) > 0;
  const { explorationRate, detail: explorationDetail, dataMaturity } = calculateStrategyExplorationRate(
    strategyTemplateId || null,
    syntheticDataCount,
    hasRecentData
  );
  const halfHourSlot = Math.floor(Date.now() / (30 * 60 * 1e3));
  const algorithmRotation = halfHourSlot % 6;
  const isExplorationSlot = Math.random() < explorationRate;
  const explorationBoost = isExplorationSlot ? 0.25 : 0;
  const getPerformanceMultiplier = /* @__PURE__ */ __name((stat) => {
    const successRate = stat.alphaParam / (stat.alphaParam + stat.betaParam);
    const decay = getConsecutiveFailures(stat);
    return Math.max(0.7, 1 + Math.max(0, successRate - 0.5) * 0.3 - decay);
  }, "getPerformanceMultiplier");
  log48.info(`[MetaLearning] v272\u7B56\u7565\u7EA7\u63A2\u7D22\u81EA\u9002\u5E94: ${explorationDetail}`);
  const rbStat = stats4.get("rule_based");
  const rbPenalty = isExplorationSlot ? 0.45 : 0.6;
  scores.push({
    algorithm: "rule_based",
    score: betaSample(rbStat.alphaParam, rbStat.betaParam) * rbPenalty,
    eligible: true,
    reason: "\u57FA\u4E8E\u89C4\u5219\u7684\u51FA\u4EF7\u7B56\u7565\uFF08\u5146\u5E95\uFF09"
  });
  const ucbStat = stats4.get("ucb");
  scores.push({
    algorithm: "ucb",
    score: betaSample(ucbStat.alphaParam, ucbStat.betaParam) * 1.3 * getPerformanceMultiplier(ucbStat),
    eligible: true,
    reason: "UCB\u63A2\u7D22-\u5229\u7528\u7B56\u7565(\u5F3A\u5236\u4F18\u5148)"
  });
  const linucbStat = stats4.get("linucb");
  const linucbEligible = hasFeatures || syntheticPendingCount >= 1 || totalHistoryEvents >= 1;
  const linucbRotationBoost = algorithmRotation === 0 || algorithmRotation === 3 ? 0.15 : 0;
  scores.push({
    algorithm: "linucb",
    score: linucbEligible ? betaSample(linucbStat.alphaParam, linucbStat.betaParam) * (1.5 + explorationBoost + linucbRotationBoost) * getPerformanceMultiplier(linucbStat) : 0,
    // v268: 从1.40提升到1.50
    eligible: linucbEligible,
    reason: linucbEligible ? `LinUCB\u4E0A\u4E0B\u6587\u8D4C\u535A\u673A(\u5408\u6210\u6570\u636E=${syntheticPendingCount})` : `\u6570\u636E\u4E0D\u8DB3(\u5408\u6210=${syntheticPendingCount}/1)`
  });
  const sigmoidStat = stats4.get("sigmoid_curve");
  const sigmoidEligible = syntheticPendingCount >= 1;
  const sigmoidRotationBoost = algorithmRotation === 1 || algorithmRotation === 4 ? 0.1 : 0;
  scores.push({
    algorithm: "sigmoid_curve",
    score: sigmoidEligible ? betaSample(sigmoidStat.alphaParam, sigmoidStat.betaParam) * (1.3 + explorationBoost + sigmoidRotationBoost) * getPerformanceMultiplier(sigmoidStat) : 0,
    eligible: sigmoidEligible,
    reason: sigmoidEligible ? `Sigmoid\u66F2\u7EBF\u5229\u6DA6\u6700\u5927\u5316(\u5408\u6210\u6570\u636E=${syntheticPendingCount})` : `\u6570\u636E\u4E0D\u8DB3(\u5408\u6210=${syntheticPendingCount}/2)`
  });
  const cqlStat = stats4.get("cql");
  const cqlEligible = syntheticPendingCount >= 1;
  const cqlRotationBoost = algorithmRotation === 2 || algorithmRotation === 5 ? 0.1 : 0;
  scores.push({
    algorithm: "cql",
    score: cqlEligible ? betaSample(cqlStat.alphaParam, cqlStat.betaParam) * (1.35 + explorationBoost + cqlRotationBoost) * getPerformanceMultiplier(cqlStat) : 0,
    eligible: cqlEligible,
    reason: cqlEligible ? `\u79BB\u7EBF\u5F3A\u5316\u5B66\u4E60CQL(\u5408\u6210\u6570\u636E=${syntheticPendingCount})` : `\u6570\u636E\u4E0D\u8DB3(\u5408\u6210=${syntheticPendingCount}/2)`
  });
  const eligibleCount = scores.filter((s) => s.eligible).length;
  const ensembleStat = stats4.get("ensemble");
  scores.push({
    algorithm: "ensemble",
    score: eligibleCount >= 2 ? betaSample(ensembleStat.alphaParam, ensembleStat.betaParam) * (1.65 + explorationBoost) * getPerformanceMultiplier(ensembleStat) : 0,
    // v268: 从1.50提升到1.65
    eligible: eligibleCount >= 2,
    reason: eligibleCount >= 2 ? `\u591A\u7B97\u6CD5\u878D\u5408(\u53EF\u7528${eligibleCount}\u4E2A)` : `\u53EF\u7528\u7B97\u6CD5\u4E0D\u8DB3(${eligibleCount}/2)`
  });
  log48.debug(`[MetaLearning] v268\u7B97\u6CD5\u8BC4\u4F30: \u63A2\u7D22\u7387=${(explorationRate * 100).toFixed(0)}%, \u6570\u636E\u6210\u719F\u5EA6=${(dataMaturity * 100).toFixed(0)}%, \u8F6E\u8F6C\u69FD=${algorithmRotation}, \u63A2\u7D22\u69FD=${isExplorationSlot}`);
  log48.debug(`[MetaLearning] v268\u7B97\u6CD5\u5F97\u5206: ${scores.map((s) => `${s.algorithm}=${s.score.toFixed(3)}`).join(", ")}`);
  log48.debug(`[MetaLearning] v259\u7B97\u6CD5\u8D44\u683C: ${scores.filter((s) => s.eligible).map((s) => s.algorithm).join(", ")} (\u5171${eligibleCount}\u4E2A\u53EF\u7528)`);
  return scores;
}
async function executeAlgorithm(algorithm, accountId, keywordId, targetId, campaignId, currentBid) {
  let bid = currentBid || 0;
  let conf = 0;
  let linucb;
  let cql;
  let sigmoid2;
  switch (algorithm) {
    case "linucb":
      linucb = await makeLinUCBBidDecision(accountId, keywordId, targetId, campaignId, currentBid) || void 0;
      if (linucb) {
        bid = linucb.recommendedBid;
        conf = linucb.confidence;
      }
      break;
    case "cql": {
      const context = await extractFeatureVector(accountId, keywordId, targetId, campaignId);
      const cqlDec = await makeCQLBidDecision(accountId, context, currentBid || 0) || void 0;
      if (cqlDec) {
        bid = cqlDec.recommendedBid;
        conf = cqlDec.confidence;
        cql = cqlDec;
      }
      break;
    }
    case "sigmoid_curve":
      if (keywordId || targetId) {
        const entityType = keywordId ? "keyword" : "target";
        const entityId = keywordId || targetId || 0;
        const params = await fitAndCacheSigmoidForEntity(accountId, entityType, entityId, campaignId || "");
        if (params && params.r2 > 0.3) {
          sigmoid2 = calculateSigmoidOptimalBid(params, 0.01, 0.05, 30);
          bid = sigmoid2.optimalBid;
          conf = sigmoid2.confidence;
        }
      }
      break;
    case "ensemble": {
      const bids = [];
      const linDec = await makeLinUCBBidDecision(accountId, keywordId, targetId, campaignId, currentBid);
      if (linDec) {
        bids.push({ bid: linDec.recommendedBid, weight: linDec.confidence });
        linucb = linDec;
      }
      const ctx = await extractFeatureVector(accountId, keywordId, targetId, campaignId);
      const cqlD = await makeCQLBidDecision(accountId, ctx, currentBid || 0);
      if (cqlD) {
        bids.push({ bid: cqlD.recommendedBid, weight: cqlD.confidence });
        cql = cqlD;
      }
      try {
        const { fitAndCacheSigmoidForEntity: fitSig, calculateSigmoidOptimalBid: calcSig } = await Promise.resolve().then(() => (init_sigmoidCurveFitter(), sigmoidCurveFitter_exports));
        const eId = keywordId || targetId || 0;
        const eType = keywordId ? "keyword" : "target";
        const sigP = await fitSig(accountId, eType, eId, String(campaignId));
        if (sigP && sigP.r2 > 0.5) {
          const avgCtr = Number(ctx?.avgCtr7d || 0.02);
          const avgCvr = Number(ctx?.avgCvr7d || 0.05);
          const aov = avgCvr > 0 ? Number(ctx?.weightedRoas14d || 3) * Number(ctx?.avgCpc7d || 1) / avgCvr : 25;
          const sigR = calcSig(sigP, avgCtr, avgCvr, aov, 0.7);
          if (sigR.optimalBid > 0) {
            const sigConf = Math.min(0.9, sigP.r2);
            bids.push({ bid: sigR.optimalBid, weight: sigConf });
            sigmoid2 = { recommendedBid: sigR.optimalBid, confidence: sigConf };
          }
        }
      } catch {
      }
      if (bids.length > 0) {
        const tw = bids.reduce((s, b) => s + b.weight, 0);
        bid = bids.reduce((s, b) => s + b.bid * b.weight, 0) / tw;
        conf = tw / bids.length;
      }
      break;
    }
    case "ucb": {
      const ucbBid = currentBid || 0;
      const epsilon = 0.2;
      const entitySeed = (keywordId || 0) * 31 + (targetId || 0) * 37 + accountId * 41;
      const hourWindow = Math.floor(Date.now() / (4 * 36e5));
      const hashVal = (entitySeed * 2654435761 + hourWindow >>> 0) % 1e4 / 1e4;
      if (hashVal < epsilon) {
        const explorationDirection = hashVal < epsilon * 0.6 ? 1 : -1;
        const explorationMagnitude = 0.05 + hashVal / epsilon * 0.1;
        bid = ucbBid * (1 + explorationDirection * explorationMagnitude);
        bid = Math.max(0.02, Math.round(bid * 100) / 100);
        conf = 0.45;
      } else {
        bid = ucbBid;
        conf = 0.5;
      }
      break;
    }
    case "rule_based":
    default:
      bid = currentBid || 0;
      conf = 0.5;
      break;
  }
  return { bid, confidence: conf, linucb, cql, sigmoid: sigmoid2 };
}
async function selectBestAlgorithm(accountId, keywordId, targetId, campaignId, currentBid, strategyTemplateId) {
  const scores = await evaluateAlgorithms(accountId, keywordId, targetId, campaignId, currentBid, strategyTemplateId);
  const eligibleScores = scores.filter((s) => s.eligible);
  eligibleScores.sort((a, b) => b.score - a.score);
  const top1 = eligibleScores[0] || scores.find((s) => s.algorithm === "rule_based");
  const top2 = eligibleScores[1];
  let recommendedBid = currentBid || 0;
  let confidence = 0;
  let linucbDecision;
  let cqlDecision;
  let sigmoidDecision;
  let fusionMode = "single";
  let fusionDetail = "";
  let selectedAlgorithmName = top1.algorithm;
  const cascadeConfig = getCascadeConfig(strategyTemplateId);
  let FUSION_THRESHOLD = cascadeConfig.fusionThreshold;
  let cascadeEnabled = cascadeConfig.enabled;
  let forceAlgorithmMode = null;
  if (campaignId) {
    try {
      const experimentConfig = await getExperimentConfigForCampaign(accountId, campaignId);
      if (experimentConfig) {
        const { variantType, config: config2, testId } = experimentConfig;
        log48.info(`[MetaLearning] v271 A/B\u5B9E\u9A8C: campaign=${campaignId} \u5728\u5B9E\u9A8C${testId}\u7684${variantType}\u7EC4`);
        if (config2.fusionThreshold !== void 0) {
          FUSION_THRESHOLD = config2.fusionThreshold;
          log48.info(`[MetaLearning] v271 A/B\u5B9E\u9A8C: \u878D\u5408\u9608\u503C\u8986\u76D6\u4E3A ${(FUSION_THRESHOLD * 100).toFixed(0)}%`);
        }
        if (config2.algorithmMode) {
          forceAlgorithmMode = config2.algorithmMode;
          log48.info(`[MetaLearning] v271 A/B\u5B9E\u9A8C: \u5F3A\u5236\u7B97\u6CD5\u6A21\u5F0F\u4E3A ${forceAlgorithmMode}`);
        }
      }
    } catch (expError) {
      log48.warn(`[MetaLearning] v271 A/B\u5B9E\u9A8C\u914D\u7F6E\u67E5\u8BE2\u5931\u8D25\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u914D\u7F6E:`, expError);
    }
  }
  const shouldFuse = (forceAlgorithmMode === "cascade_ensemble" || // v271: A/B实验强制融合
  cascadeEnabled && // v271: 策略模板级别的cascade开关
  forceAlgorithmMode !== "single" && // v271: A/B实验强制单一模式时不融合
  top2 && top1.score > 0 && (top1.score - top2.score) / top1.score < FUSION_THRESHOLD && top2.algorithm !== "rule_based") && top2 !== void 0;
  try {
    if (shouldFuse) {
      fusionMode = "cascade_ensemble";
      log48.info(`[MetaLearning] v270 Cascade Ensemble: ${top1.algorithm}(${top1.score.toFixed(3)}) + ${top2.algorithm}(${top2.score.toFixed(3)}), \u5206\u5DEE=${((top1.score - top2.score) / top1.score * 100).toFixed(1)}%`);
      const [result1, result2] = await Promise.all([
        executeAlgorithm(top1.algorithm, accountId, keywordId, targetId, campaignId, currentBid),
        executeAlgorithm(top2.algorithm, accountId, keywordId, targetId, campaignId, currentBid)
      ]);
      const fusionBids = [];
      if (result1.bid > 0 && result1.confidence > 0) {
        fusionBids.push({ bid: result1.bid, confidence: result1.confidence, algorithm: top1.algorithm });
      }
      if (result2.bid > 0 && result2.confidence > 0) {
        fusionBids.push({ bid: result2.bid, confidence: result2.confidence, algorithm: top2.algorithm });
      }
      linucbDecision = result1.linucb || result2.linucb;
      cqlDecision = result1.cql || result2.cql;
      sigmoidDecision = result1.sigmoid || result2.sigmoid;
      if (fusionBids.length >= 2) {
        const totalConf = fusionBids.reduce((s, b) => s + b.confidence, 0);
        recommendedBid = fusionBids.reduce((s, b) => s + b.bid * b.confidence, 0) / totalConf;
        const bidDivergence = Math.abs(fusionBids[0].bid - fusionBids[1].bid) / Math.max(fusionBids[0].bid, fusionBids[1].bid, 0.01);
        const { consensusBonus: cbConfig } = cascadeConfig;
        const consensusBonus = bidDivergence < cbConfig.highThreshold ? cbConfig.highBonus : bidDivergence < cbConfig.mediumThreshold ? cbConfig.mediumBonus : 0;
        confidence = Math.min(0.95, totalConf / fusionBids.length + consensusBonus);
        selectedAlgorithmName = "ensemble";
        fusionDetail = `Cascade\u878D\u5408: ${fusionBids.map((b) => `${b.algorithm}($${b.bid.toFixed(2)},conf=${b.confidence.toFixed(2)})`).join(" + ")} \u2192 $${recommendedBid.toFixed(2)}, \u5206\u6B67\u5EA6=${(bidDivergence * 100).toFixed(1)}%, \u5171\u8BC6\u5956\u52B1=${(consensusBonus * 100).toFixed(0)}%`;
        log48.info(`[MetaLearning] v270 ${fusionDetail}`);
      } else if (fusionBids.length === 1) {
        recommendedBid = fusionBids[0].bid;
        confidence = fusionBids[0].confidence;
        fusionMode = "single";
        fusionDetail = `Cascade\u964D\u7EA7: \u4EC5${fusionBids[0].algorithm}\u8FD4\u56DE\u6709\u6548\u7ED3\u679C`;
        selectedAlgorithmName = fusionBids[0].algorithm;
      } else {
        recommendedBid = currentBid || 0;
        confidence = 0.3;
        fusionMode = "single";
        fusionDetail = "Cascade\u5931\u8D25: \u4E24\u4E2A\u7B97\u6CD5\u5747\u672A\u8FD4\u56DE\u6709\u6548\u7ED3\u679C\uFF0C\u964D\u7EA7rule_based";
        selectedAlgorithmName = "rule_based";
      }
    } else {
      const result = await executeAlgorithm(top1.algorithm, accountId, keywordId, targetId, campaignId, currentBid);
      recommendedBid = result.bid;
      confidence = result.confidence;
      linucbDecision = result.linucb;
      cqlDecision = result.cql;
      sigmoidDecision = result.sigmoid;
      fusionDetail = `Single\u6A21\u5F0F: ${top1.algorithm}(\u5F97\u5206=${top1.score.toFixed(3)})`;
      if (top2) {
        fusionDetail += `, \u6B21\u9009${top2.algorithm}(\u5206\u5DEE=${((top1.score - top2.score) / top1.score * 100).toFixed(1)}% > ${(FUSION_THRESHOLD * 100).toFixed(0)}%\u9608\u503C)`;
      }
    }
  } catch (error48) {
    log48.warn(`Error executing algorithm(s):`, error48);
    recommendedBid = currentBid || 0;
    confidence = 0.3;
    fusionMode = "single";
    fusionDetail = `\u6267\u884C\u5F02\u5E38\uFF0C\u964D\u7EA7rule_based: ${error48}`;
    selectedAlgorithmName = "rule_based";
  }
  recommendedBid = Math.max(0.02, Math.round(recommendedBid * 100) / 100);
  const decision = {
    selectedAlgorithm: selectedAlgorithmName,
    recommendedBid,
    confidence,
    algorithmScores: scores,
    reasoning: fusionMode === "cascade_ensemble" ? `v270 Cascade Ensemble\u878D\u5408: ${fusionDetail}` : `\u9009\u62E9${selectedAlgorithmName}: ${top1.reason} (\u5F97\u5206=${top1.score.toFixed(4)})`,
    fusionMode,
    fusionDetail,
    linucbDecision,
    cqlDecision,
    sigmoidDecision
  };
  const db = await getDbInstance7();
  await db.insert(algorithmSelectionLogs).values({
    accountId,
    keywordId: keywordId || null,
    targetId: targetId || null,
    campaignId: campaignId || null,
    selectedAlgorithm: selectedAlgorithmName,
    algorithmScores: scores,
    selectionReason: decision.reasoning,
    executedBid: String(recommendedBid)
  });
  return decision;
}
async function backfillAlgorithmResults(accountId) {
  const db = await getDbInstance7();
  let filledCount = 0;
  const hoursAgo48 = new Date(Date.now() - 48 * 36e5).toISOString();
  const hoursAgo24 = new Date(Date.now() - 24 * 36e5).toISOString();
  const pendingLogs = await db.select({
    id: algorithmSelectionLogs.id,
    keywordId: algorithmSelectionLogs.keywordId,
    targetId: algorithmSelectionLogs.targetId,
    campaignId: algorithmSelectionLogs.campaignId,
    executedBid: algorithmSelectionLogs.executedBid
  }).from(algorithmSelectionLogs).where(and(
    eq(algorithmSelectionLogs.accountId, accountId),
    sql`result_filled_at IS NULL`,
    gte(algorithmSelectionLogs.createdAt, hoursAgo48),
    sql`created_at <= ${hoursAgo24}`
  )).limit(200);
  for (const pendLog of pendingLogs) {
    try {
      const rlLog2 = await db.select({
        reward: rlTrainingLogs.reward
      }).from(rlTrainingLogs).where(and(
        eq(rlTrainingLogs.accountId, accountId),
        pendLog.keywordId ? eq(rlTrainingLogs.keywordId, pendLog.keywordId) : sql`1=1`,
        pendLog.targetId ? eq(rlTrainingLogs.targetId, pendLog.targetId) : sql`1=1`,
        isNotNull(rlTrainingLogs.reward),
        gte(rlTrainingLogs.createdAt, hoursAgo48)
      )).orderBy(desc(rlTrainingLogs.createdAt)).limit(1);
      if (rlLog2.length > 0) {
        await db.update(algorithmSelectionLogs).set({
          resultReward: rlLog2[0].reward,
          resultFilledAt: (/* @__PURE__ */ new Date()).toISOString()
        }).where(eq(algorithmSelectionLogs.id, pendLog.id));
        filledCount++;
      }
    } catch (e) {
    }
  }
  log48.debug(`Backfilled ${filledCount} algorithm results`);
  return filledCount;
}
var log48;
var init_metaLearningSelector = __esm({
  "server/algorithm/metaLearningSelector.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_contextualFeatureService();
    init_contextualBanditService();
    init_offlineRLService();
    init_sigmoidCurveFitter();
    init_logger();
    init_abTestIntegration();
    init_algorithmConfigService();
    log48 = createModuleLogger("MetaLearning");
    __name(getDbInstance7, "getDbInstance");
    __name(gammaSample, "gammaSample");
    __name(betaSample, "betaSample");
    __name(getAlgorithmStats, "getAlgorithmStats");
    __name(evaluateAlgorithms, "evaluateAlgorithms");
    __name(executeAlgorithm, "executeAlgorithm");
    __name(selectBestAlgorithm, "selectBestAlgorithm");
    __name(backfillAlgorithmResults, "backfillAlgorithmResults");
  }
});

