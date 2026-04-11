// Extracted from production dist/index.js
// Original module: server/algorithm/algorithmEfficacyService.ts
// Lines: 128

var algorithmEfficacyService_exports = {};
__export(algorithmEfficacyService_exports, {
  getAlgorithmEfficacyForTarget: () => getAlgorithmEfficacyForTarget
});
async function getAlgorithmEfficacyForTarget(targetId, days = 30) {
  const dbInstance = await getDb();
  if (!dbInstance) return void 0;
  try {
    const [bidLogs] = await dbInstance.execute(
      sql`SELECT action_detail FROM optimization_logs 
          WHERE performance_group_id = ${targetId}
            AND log_category = 'bid_adjustment'
            AND created_at >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
          ORDER BY created_at DESC
          LIMIT 500`
    );
    let totalOperations = 0;
    let advancedCount = 0;
    let ruleEngineCount = 0;
    let conservativeCount = 0;
    let totalConfidence = 0;
    let positiveCount = 0;
    if (bidLogs && bidLogs.length > 0) {
      for (const log216 of bidLogs) {
        try {
          const detail = typeof log216.action_detail === "string" ? JSON.parse(log216.action_detail) : log216.action_detail;
          if (!detail) continue;
          totalOperations++;
          const algorithmUsed = detail.algorithmUsed || detail.algorithm || "";
          const reason = detail.reason || detail.changeReason || "";
          if (reason.includes("[\u9AD8\u7EA7\u7B97\u6CD5") || ["linucb", "cql", "bayesian"].some((a) => algorithmUsed.toLowerCase().includes(a))) {
            advancedCount++;
          } else if (reason.includes("[\u89C4\u5219\u5F15\u64CE") || algorithmUsed.includes("rule")) {
            ruleEngineCount++;
          } else if (reason.includes("[\u4FDD\u5B88\u7B56\u7565") || algorithmUsed.includes("conservative")) {
            conservativeCount++;
          } else {
            ruleEngineCount++;
          }
          const confidence = detail.confidence || detail.algorithmConfidence || 0.5;
          totalConfidence += Number(confidence);
          const changePercent = detail.changePercent || detail.bidChangePercent || 0;
          const acos = detail.acos || detail.keywordAcos || 0;
          const targetAcos = detail.targetAcos || 30;
          if (changePercent < 0 && acos > targetAcos) {
            positiveCount++;
          } else if (changePercent > 0 && acos < targetAcos * 0.8) {
            positiveCount++;
          } else if (Math.abs(changePercent) < 3) {
            positiveCount++;
          }
        } catch (parseErr) {
        }
      }
    }
    let precisePositiveRate = null;
    try {
      const [effectStats] = await dbInstance.execute(
        sql`SELECT 
              COUNT(*) as total,
              SUM(CASE WHEN effect_direction = 'positive' THEN 1 ELSE 0 END) as positive,
              AVG(confidence_score) as avg_confidence
            FROM algorithm_effect_records
            WHERE performance_group_id = ${targetId}
              AND created_at >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)`
      );
      if (effectStats && effectStats[0] && effectStats[0].total > 0) {
        precisePositiveRate = effectStats[0].positive / effectStats[0].total * 100;
        if (effectStats[0].avg_confidence) {
          totalConfidence = effectStats[0].avg_confidence * totalOperations;
        }
      }
    } catch (effectErr) {
    }
    let evolutionCorrections = 0;
    let improvementTrend = "stable";
    try {
      const [evoStats] = await dbInstance.execute(
        sql`SELECT 
              COUNT(*) as total_corrections,
              SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as recent_corrections,
              SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as prev_corrections
            FROM algorithm_evolution_records
            WHERE performance_group_id = ${targetId}
              AND action_type = 'correction'
              AND created_at >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)`
      );
      if (evoStats && evoStats[0]) {
        evolutionCorrections = Number(evoStats[0].total_corrections) || 0;
        const recent = Number(evoStats[0].recent_corrections) || 0;
        const prev = Number(evoStats[0].prev_corrections) || 0;
        if (recent < prev) improvementTrend = "improving";
        else if (recent > prev * 1.5) improvementTrend = "declining";
      }
    } catch (evoErr) {
    }
    if (totalOperations === 0) return void 0;
    const total = totalOperations;
    const positiveRate = precisePositiveRate !== null ? precisePositiveRate : total > 0 ? positiveCount / total * 100 : 50;
    return {
      totalOperations: total,
      positiveRate,
      tierDistribution: {
        advanced: total > 0 ? Math.round(advancedCount / total * 100) : 0,
        ruleEngine: total > 0 ? Math.round(ruleEngineCount / total * 100) : 0,
        conservative: total > 0 ? Math.round(conservativeCount / total * 100) : 0
      },
      avgConfidence: total > 0 ? totalConfidence / total : 0.5,
      evolutionCorrections,
      improvementTrend
    };
  } catch (err) {
    log155.warn(`[algorithmEfficacyService] Error for target ${targetId}:`, err.message);
    return void 0;
  }
}
var log155;
var init_algorithmEfficacyService = __esm({
  "server/algorithm/algorithmEfficacyService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_drizzle_orm();
    log155 = createModuleLogger("AlgorithmEfficacyService");
    __name(getAlgorithmEfficacyForTarget, "getAlgorithmEfficacyForTarget");
  }
});

