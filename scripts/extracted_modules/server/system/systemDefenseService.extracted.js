// Extracted from production dist/index.js
// Original module: server/system/systemDefenseService.ts
// Lines: 626

var systemDefenseService_exports = {};
__export(systemDefenseService_exports, {
  checkAlgorithmHealth: () => checkAlgorithmHealth,
  cleanupSyncFailures: () => cleanupSyncFailures,
  detectAndIntervenDeathSpiral: () => detectAndIntervenDeathSpiral,
  executeRealEmergencyOptimization: () => executeRealEmergencyOptimization,
  isAccountBidIncreaseBlocked: () => isAccountBidIncreaseBlocked,
  isAlgorithmCircuitBroken: () => isAlgorithmCircuitBroken,
  runSystemDefenseScan: () => runSystemDefenseScan
});
async function ensureSystemConfigTable() {
  if (systemConfigTableEnsured) return;
  try {
    const dbInstance = await getDb();
    if (!dbInstance) return;
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    await dbInstance.execute(sql15`
      CREATE TABLE IF NOT EXISTS system_config (
        \`key\` VARCHAR(255) NOT NULL PRIMARY KEY,
        \`value\` TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    systemConfigTableEnsured = true;
    log100.info("[SystemDefense] system_config\u8868\u5DF2\u786E\u8BA4\u5B58\u5728");
  } catch (err) {
    const errMsg = err.message || "";
    if (errMsg.includes("already exists")) {
      systemConfigTableEnsured = true;
    } else {
      log100.warn(`[SystemDefense] \u521B\u5EFAsystem_config\u8868\u5931\u8D25: ${errMsg}`);
    }
  }
}
async function cleanupSyncFailures() {
  const result = {
    module: "sync_cleanup",
    actionsCount: 0,
    successCount: 0,
    failedCount: 0,
    details: [],
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const dbInstance = await getDb();
  if (!dbInstance) {
    result.details.push("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
    return result;
  }
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const [deletedCleanup] = await dbInstance.execute(sql15`
      UPDATE optimization_events 
      SET api_sync_status = 'not_applicable',
          change_reason = CONCAT(COALESCE(change_reason, ''), ' [v505: 目标实体已在Amazon删除/归档，标记为不适用]')
      WHERE api_sync_status = 'failed'
        AND (
          action_detail LIKE '%amazon_deleted%' 
          OR action_detail LIKE '%archived%'
          OR action_detail LIKE '%跳过同步%'
        )
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
    const deletedCount = deletedCleanup?.affectedRows || 0;
    if (deletedCount > 0) {
      result.actionsCount += deletedCount;
      result.successCount += deletedCount;
      result.details.push(`\u6E05\u7406${deletedCount}\u6761amazon_deleted/archived\u5B9E\u4F53\u7684\u540C\u6B65\u5931\u8D25\u8BB0\u5F55`);
    }
    const [missingIdCleanup] = await dbInstance.execute(sql15`
      UPDATE optimization_events 
      SET api_sync_status = 'not_applicable',
          change_reason = CONCAT(COALESCE(change_reason, ''), ' [v505: Amazon ID长期未解析，标记为不适用]')
      WHERE api_sync_status = 'failed'
        AND (
          action_detail LIKE '%缺少Amazon ID%'
          OR action_detail LIKE '%missing amazon id%'
        )
        AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    const missingIdCount = missingIdCleanup?.affectedRows || 0;
    if (missingIdCount > 0) {
      result.actionsCount += missingIdCount;
      result.successCount += missingIdCount;
      result.details.push(`\u6E05\u7406${missingIdCount}\u6761\u957F\u671F\u7F3A\u5C11Amazon ID\u7684\u540C\u6B65\u5931\u8D25\u8BB0\u5F55`);
    }
    const [remainingFailed] = await dbInstance.execute(sql15`
      SELECT COUNT(*) as cnt FROM optimization_events 
      WHERE api_sync_status = 'failed'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
    const remainingCount = Number(remainingFailed?.[0]?.cnt) || 0;
    result.details.push(`\u5269\u4F59\u53EF\u91CD\u8BD5\u7684\u540C\u6B65\u5931\u8D25\u8BB0\u5F55: ${remainingCount}\u6761`);
    logOptimization("SystemDefense", `\u540C\u6B65\u6E05\u7406\u5B8C\u6210: \u6E05\u7406${deletedCount + missingIdCount}\u6761, \u5269\u4F59${remainingCount}\u6761`);
  } catch (error48) {
    result.failedCount++;
    result.details.push(`\u540C\u6B65\u6E05\u7406\u5F02\u5E38: ${error48.message}`);
    logOptimizationWarn("SystemDefense", `\u540C\u6B65\u6E05\u7406\u5F02\u5E38: ${error48.message}`);
  }
  return result;
}
async function checkAlgorithmHealth() {
  const result = {
    module: "algorithm_circuit_breaker",
    actionsCount: 0,
    successCount: 0,
    failedCount: 0,
    details: [],
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const dbInstance = await getDb();
  if (!dbInstance) {
    result.details.push("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
    return result;
  }
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const [algorithmStats] = await dbInstance.execute(sql15`
      SELECT 
        CASE 
          WHEN action_detail LIKE '%cascade%' OR action_detail LIKE '%Cascade%' THEN 'cascade'
          WHEN action_detail LIKE '%linucb%' OR action_detail LIKE '%LinUCB%' THEN 'linucb'
          WHEN action_detail LIKE '%cql%' OR action_detail LIKE '%CQL%' THEN 'cql'
          WHEN action_detail LIKE '%sigmoid%' OR action_detail LIKE '%Sigmoid%' THEN 'sigmoid'
          WHEN action_detail LIKE '%rule%' OR action_detail LIKE '%规则%' THEN 'rule_engine'
          WHEN action_detail LIKE '%guardrail%' OR action_detail LIKE '%护栏%' THEN 'guardrail'
          WHEN action_detail LIKE '%campaign_status%' THEN 'campaign_status_manager'
          ELSE 'unknown'
        END as algorithm,
        COUNT(*) as total_ops,
        SUM(CASE 
          WHEN action_type = 'bid_decrease' AND JSON_EXTRACT(action_detail, '$.acos') > 40 THEN 1
          WHEN action_type = 'bid_increase' AND JSON_EXTRACT(action_detail, '$.acos') < 25 AND JSON_EXTRACT(action_detail, '$.acos') > 0 THEN 1
          WHEN action_type = 'bid_decrease' AND bid_change_percent BETWEEN -15 AND -1 THEN 1
          ELSE 0
        END) as positive_ops,
        SUM(CASE 
          WHEN action_type = 'bid_increase' AND (JSON_EXTRACT(action_detail, '$.acos') > 50 OR JSON_EXTRACT(action_detail, '$.acos') IS NULL) THEN 1
          WHEN ABS(bid_change_percent) > 25 THEN 1
          ELSE 0
        END) as negative_ops
      FROM optimization_events
      WHERE event_category = 'bid_adjustment'
        AND action_type IN ('bid_increase', 'bid_decrease', 'bid_auto_adjust')
        AND api_sync_status != 'not_applicable'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      GROUP BY algorithm
      HAVING total_ops >= 10
    `);
    const algorithms = [];
    const statsRows = algorithmStats;
    for (const row of statsRows) {
      const algorithm = row.algorithm;
      const totalOps = Number(row.total_ops) || 0;
      const positiveOps = Number(row.positive_ops) || 0;
      const negativeOps = Number(row.negative_ops) || 0;
      const positiveRate = totalOps > 0 ? Math.round(positiveOps / totalOps * 100) : 0;
      let shouldDisable = false;
      let reason = "";
      if (positiveRate < 15 && totalOps >= 50) {
        shouldDisable = true;
        reason = `\u6B63\u5411\u7387${positiveRate}%\u6781\u4F4E(\u9608\u503C15%)\uFF0C\u64CD\u4F5C${totalOps}\u6B21\uFF0C\u5DF2\u89E6\u53D1\u7194\u65AD`;
      } else if (negativeOps > positiveOps * 2 && totalOps >= 30) {
        shouldDisable = true;
        reason = `\u8D1F\u5411\u64CD\u4F5C(${negativeOps})\u8FDC\u8D85\u6B63\u5411(${positiveOps})\uFF0C\u5DF2\u89E6\u53D1\u7194\u65AD`;
      }
      algorithms.push({ algorithm, positiveRate, totalOps, shouldDisable, reason });
      if (shouldDisable) {
        result.actionsCount++;
        try {
          await dbInstance.execute(sql15`
            INSERT INTO system_config (\`key\`, \`value\`, updatedAt)
            VALUES (
              ${`algorithm_circuit_breaker_${algorithm}`},
              ${JSON.stringify({ disabled: true, reason, disabledAt: (/* @__PURE__ */ new Date()).toISOString(), positiveRate, totalOps })},
              NOW()
            )
            ON DUPLICATE KEY UPDATE 
              \`value\` = VALUES(\`value\`),
              updatedAt = NOW()
          `);
          result.successCount++;
          result.details.push(`\u7B97\u6CD5 ${algorithm} \u5DF2\u7194\u65AD: ${reason}`);
          logOptimizationWarn("SystemDefense", `\u7B97\u6CD5\u7194\u65AD: ${algorithm} - ${reason}`);
        } catch (writeErr) {
          result.failedCount++;
          result.details.push(`\u7B97\u6CD5 ${algorithm} \u7194\u65AD\u5199\u5165\u5931\u8D25: ${writeErr.message}`);
        }
      } else {
        try {
          await dbInstance.execute(sql15`
            INSERT INTO system_config (\`key\`, \`value\`, updatedAt)
            VALUES (
              ${`algorithm_circuit_breaker_${algorithm}`},
              ${JSON.stringify({ disabled: false, positiveRate, totalOps, lastChecked: (/* @__PURE__ */ new Date()).toISOString() })},
              NOW()
            )
            ON DUPLICATE KEY UPDATE 
              \`value\` = VALUES(\`value\`),
              updatedAt = NOW()
          `);
        } catch {
        }
      }
    }
    const disabledCount = algorithms.filter((a) => a.shouldDisable).length;
    const healthySummary = algorithms.map((a) => `${a.algorithm}:${a.positiveRate}%${a.shouldDisable ? "(\u7194\u65AD)" : ""}`).join(", ");
    result.details.push(`\u7B97\u6CD5\u5065\u5EB7\u68C0\u67E5: ${algorithms.length}\u4E2A\u7B97\u6CD5, ${disabledCount}\u4E2A\u7194\u65AD. ${healthySummary}`);
    logOptimization("SystemDefense", `\u7B97\u6CD5\u5065\u5EB7\u68C0\u67E5\u5B8C\u6210: ${disabledCount}/${algorithms.length}\u4E2A\u7194\u65AD`);
  } catch (error48) {
    result.failedCount++;
    result.details.push(`\u7B97\u6CD5\u5065\u5EB7\u68C0\u67E5\u5F02\u5E38: ${error48.message}`);
    logOptimizationWarn("SystemDefense", `\u7B97\u6CD5\u5065\u5EB7\u68C0\u67E5\u5F02\u5E38: ${error48.message}`);
  }
  return result;
}
async function isAlgorithmCircuitBroken(algorithm) {
  await ensureSystemConfigTable();
  const dbInstance = await getDb();
  if (!dbInstance) return false;
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const [rows] = await dbInstance.execute(sql15`
      SELECT \`value\` FROM system_config 
      WHERE \`key\` = ${`algorithm_circuit_breaker_${algorithm}`}
      LIMIT 1
    `);
    const row = rows?.[0];
    if (row) {
      const config2 = JSON.parse(row.value);
      return config2.disabled === true;
    }
    return false;
  } catch {
    return false;
  }
}
async function detectAndIntervenDeathSpiral() {
  const result = {
    module: "death_spiral_intervention",
    actionsCount: 0,
    successCount: 0,
    failedCount: 0,
    details: [],
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const dbInstance = await getDb();
  if (!dbInstance) {
    result.details.push("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
    return result;
  }
  try {
    const { sql: sql15, eq: eq12, and: and14, gte: gte28, inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const { campaigns: campaigns6, dailyPerformance: dailyPerformance12 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const accounts = await getAdAccounts();
    for (const account of accounts) {
      if (!account.marketplace || account.marketplace === "") continue;
      const [recentResult] = await dbInstance.execute(sql15`
        SELECT SUM(spend) as total_spend, SUM(sales) as total_sales
        FROM daily_performance
        WHERE accountId = ${account.id}
          AND date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
      `);
      const [week1Result] = await dbInstance.execute(sql15`
        SELECT SUM(spend) as total_spend, SUM(sales) as total_sales
        FROM daily_performance
        WHERE accountId = ${account.id}
          AND date >= DATE_SUB(CURDATE(), INTERVAL 10 DAY)
          AND date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      `);
      const [week2Result] = await dbInstance.execute(sql15`
        SELECT SUM(spend) as total_spend, SUM(sales) as total_sales
        FROM daily_performance
        WHERE accountId = ${account.id}
          AND date >= DATE_SUB(CURDATE(), INTERVAL 17 DAY)
          AND date < DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      `);
      const recentRow = recentResult?.[0];
      const week1Row = week1Result?.[0];
      const week2Row = week2Result?.[0];
      const currentAcos = Number(recentRow?.total_sales) > 0 ? Number(recentRow?.total_spend) / Number(recentRow?.total_sales) * 100 : 0;
      const acos7dAgo = Number(week1Row?.total_sales) > 0 ? Number(week1Row?.total_spend) / Number(week1Row?.total_sales) * 100 : 0;
      const acos14dAgo = Number(week2Row?.total_sales) > 0 ? Number(week2Row?.total_spend) / Number(week2Row?.total_sales) * 100 : 0;
      const isDeathSpiral = currentAcos > 50 && currentAcos > acos7dAgo && acos7dAgo > acos14dAgo;
      if (!isDeathSpiral) continue;
      log100.warn(`[SystemDefense] \u8D26\u6237${account.id}(${account.storeName || account.accountName} ${account.marketplace})\u68C0\u6D4B\u5230\u6B7B\u4EA1\u87BA\u65CB: ACoS ${currentAcos.toFixed(1)}% \u2192 ${acos7dAgo.toFixed(1)}% \u2192 ${acos14dAgo.toFixed(1)}%`);
      result.details.push(`\u8D26\u6237${account.storeName || account.accountName} ${account.marketplace}: \u6B7B\u4EA1\u87BA\u65CB\u786E\u8BA4 (ACoS: ${acos14dAgo.toFixed(1)}%\u2192${acos7dAgo.toFixed(1)}%\u2192${currentAcos.toFixed(1)}%)`);
      const [highAcosCampaigns] = await dbInstance.execute(sql15`
        SELECT c.id, c.campaignId, c.campaignName, 
               SUM(dp.spend) as total_spend, SUM(dp.sales) as total_sales,
               CASE WHEN SUM(dp.sales) > 0 THEN (SUM(dp.spend) / SUM(dp.sales)) * 100 ELSE 999 END as acos
        FROM campaigns c
        JOIN daily_performance dp ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
        WHERE c.accountId = ${account.id}
          AND c.campaignStatus = 'enabled'
          AND dp.date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        GROUP BY c.id, c.campaignId, c.campaignName
        HAVING total_spend > 50 AND total_sales = 0
        ORDER BY acos DESC
      `);
      const highAcosRows = highAcosCampaigns;
      if (highAcosRows.length > 0) {
        // === v620-fix11: P0 Hard Limit for SystemDefense death spiral pauses ===
        const _v620_deathSpiralMaxPauses = Math.max(5, Math.floor(highAcosRows.length * 0.5)); // Max 50% of candidates
        let _v620_deathSpiralPauseCount = 0;
        log100.warn(`[v620-CampaignGuard] SystemDefense: ${highAcosRows.length} candidates, max ${_v620_deathSpiralMaxPauses} pauses allowed`);
        // Sort by spend ascending - pause lowest value campaigns first, protect high-value ones
        highAcosRows.sort((a, b) => parseFloat(String(a.total_sales || 0)) - parseFloat(String(b.total_sales || 0)));
        // === end v620-fix11 ===
        for (const camp of highAcosRows) {
          // === v620-fix11: Check death spiral pause limit ===
          if (_v620_deathSpiralPauseCount >= _v620_deathSpiralMaxPauses) {
            log100.warn(`[v620-CampaignGuard] SystemDefense hard limit reached (${_v620_deathSpiralPauseCount}/${_v620_deathSpiralMaxPauses}), skipping remaining ${highAcosRows.length - _v620_deathSpiralPauseCount} campaigns`);
            result.details.push(`  [v620-Guard] Hard limit reached, ${highAcosRows.length - _v620_deathSpiralPauseCount} campaigns protected from pause`);
            break;
          }
          // High-value campaign protection: campaigns with sales > $200 go to review instead
          if (parseFloat(String(camp.total_sales || 0)) > 200) {
            log100.warn(`[v620-CampaignGuard] SystemDefense: High-value campaign "${camp.campaignName}" (sales=$${parseFloat(String(camp.total_sales||0)).toFixed(0)}) - SKIPPED, requires manual review`);
            result.details.push(`  [v620-Guard] Skipped high-value campaign: ${camp.campaignName} (sales=$${parseFloat(String(camp.total_sales||0)).toFixed(0)})`);
            continue;
          }
          _v620_deathSpiralPauseCount++;
          // === end v620-fix11 ===
          try {
            await dbInstance.execute(sql15`
              UPDATE campaigns SET campaignStatus = 'paused' WHERE id = ${camp.id}
            `);
            result.actionsCount++;
            result.successCount++;
            result.details.push(`  \u6682\u505CCampaign: ${camp.campaignName} (ACoS: ${Number(camp.acos).toFixed(1)}%, \u82B1\u8D39: $${Number(camp.total_spend).toFixed(0)})`);
          } catch (pauseErr) {
            result.failedCount++;
            result.details.push(`  \u6682\u505CCampaign\u5931\u8D25: ${camp.campaignName} - ${pauseErr.message}`);
          }
        }
        try {
          const { syncCampaignStatusToAmazon: syncCampaignStatusToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
          const statusChanges = highAcosRows.map((c) => ({
            amazonCampaignId: String(c.campaignId),
            newStatus: "paused",
            campaignName: String(c.campaignName || ""),
            reason: `[SystemDefense] \u6B7B\u4EA1\u87BA\u65CB\u5E72\u9884: ACoS=${Number(c.acos).toFixed(1)}%`
          }));
          await syncCampaignStatusToAmazon2(account.id, statusChanges);
          result.details.push(`  \u5DF2\u540C\u6B65${statusChanges.length}\u4E2ACampaign\u6682\u505C\u72B6\u6001\u5230Amazon`);
        } catch (syncErr) {
          result.details.push(`  \u540C\u6B65\u6682\u505C\u72B6\u6001\u5230Amazon\u5931\u8D25: ${syncErr.message}`);
        }
      }
      try {
        await dbInstance.execute(sql15`
          INSERT INTO system_config (\`key\`, \`value\`, updatedAt)
          VALUES (
            ${`death_spiral_no_increase_${account.id}`},
            ${JSON.stringify({
          enabled: true,
          accountId: account.id,
          reason: `\u6B7B\u4EA1\u87BA\u65CB\u5E72\u9884: ACoS ${currentAcos.toFixed(1)}%\uFF0C\u7981\u6B62\u52A0\u4EF7\u76F4\u81F3ACoS\u56DE\u843D\u81F350%\u4EE5\u4E0B`,
          activatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          currentAcos
        })},
            NOW()
          )
          ON DUPLICATE KEY UPDATE 
            \`value\` = VALUES(\`value\`),
            updatedAt = NOW()
        `);
        result.actionsCount++;
        result.successCount++;
        result.details.push(`  \u8D26\u6237${account.id}\u5DF2\u7981\u6B62\u52A0\u4EF7\u64CD\u4F5C`);
      } catch (configErr) {
        result.failedCount++;
        result.details.push(`  \u5199\u5165\u7981\u6B62\u52A0\u4EF7\u914D\u7F6E\u5931\u8D25: ${configErr.message}`);
      }
      logOptimizationWarn("SystemDefense", `\u6B7B\u4EA1\u87BA\u65CB\u5E72\u9884: \u8D26\u6237${account.storeName || account.accountName} ${account.marketplace}, ACoS=${currentAcos.toFixed(1)}%, \u6682\u505C${highAcosRows.length}\u4E2ACampaign, \u7981\u6B62\u52A0\u4EF7`);
    }
    if (result.actionsCount === 0) {
      result.details.push("\u672A\u68C0\u6D4B\u5230\u6B7B\u4EA1\u87BA\u65CB\uFF0C\u65E0\u9700\u5E72\u9884");
    }
  } catch (error48) {
    result.failedCount++;
    result.details.push(`\u6B7B\u4EA1\u87BA\u65CB\u68C0\u6D4B\u5F02\u5E38: ${error48.message}`);
    logOptimizationWarn("SystemDefense", `\u6B7B\u4EA1\u87BA\u65CB\u68C0\u6D4B\u5F02\u5E38: ${error48.message}`);
  }
  return result;
}
async function isAccountBidIncreaseBlocked(accountId) {
  await ensureSystemConfigTable();
  const dbInstance = await getDb();
  if (!dbInstance) return { blocked: false };
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const keysToCheck = [
      `death_spiral_no_increase_${accountId}`,
      `emergency_no_increase_${accountId}`
    ];
    const [rows] = await dbInstance.execute(sql15`
      SELECT \`key\`, \`value\` FROM system_config 
      WHERE \`key\` IN (${sql15.raw(keysToCheck.map((k) => `'${k}'`).join(","))})
    `);
    const allRows = Array.isArray(rows) ? rows : rows ? [rows] : [];
    for (const row of allRows) {
      try {
        const config2 = JSON.parse(row.value);
        if (config2.enabled) {
          const source = String(row.key).startsWith("emergency_") ? "\u7D27\u6025\u4F18\u5316\u7194\u65AD" : "\u6B7B\u4EA1\u87BA\u65CB\u7194\u65AD";
          return { blocked: true, reason: `[${source}] ${config2.reason || "\u8D26\u6237ACoS\u5F02\u5E38\uFF0C\u7981\u6B62\u52A0\u4EF7"}` };
        }
      } catch {
      }
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}
async function executeRealEmergencyOptimization() {
  const result = {
    module: "real_emergency_optimization",
    actionsCount: 0,
    successCount: 0,
    failedCount: 0,
    details: [],
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const dbInstance = await getDb();
  if (!dbInstance) {
    result.details.push("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
    return result;
  }
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const accounts = await getAdAccounts();
    for (const account of accounts) {
      if (!account.marketplace || account.marketplace === "") continue;
      const [perfResult] = await dbInstance.execute(sql15`
        SELECT SUM(spend) as total_spend, SUM(sales) as total_sales, SUM(orders) as total_orders
        FROM daily_performance
        WHERE accountId = ${account.id}
          AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      `);
      const perfRow = perfResult?.[0];
      const spend = Number(perfRow?.total_spend) || 0;
      const sales = Number(perfRow?.total_sales) || 0;
      const acos = sales > 0 ? spend / sales * 100 : 0;
      if (spend < 10) continue;
      if (acos > 100) {
        result.details.push(`
[CRITICAL] \u8D26\u6237${account.storeName || account.accountName} ${account.marketplace}: ACoS=${acos.toFixed(1)}%`);
        const [extremeCampaigns] = await dbInstance.execute(sql15`
 SELECT c.id, c.campaignId, c.campaignName,
 SUM(dp.spend) as total_spend, SUM(dp.sales) as total_sales
 FROM campaigns c
 JOIN daily_performance dp ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
 WHERE c.accountId = ${account.id}
 AND c.campaignStatus = 'enabled'
 AND dp.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
 GROUP BY c.id, c.campaignId, c.campaignName
 HAVING total_spend > 10 AND (total_sales = 0 OR (total_spend / total_sales) > 2)
 ORDER BY total_spend DESC
 LIMIT 20
 `);
        const extremeRows = extremeCampaigns;
        for (const camp of extremeRows) {
          try {
            await dbInstance.execute(sql15`
              UPDATE campaigns SET campaignStatus = 'paused' WHERE id = ${camp.id}
            `);
            result.actionsCount++;
            result.successCount++;
            const campAcos = Number(camp.total_sales) > 0 ? (Number(camp.total_spend) / Number(camp.total_sales) * 100).toFixed(1) : "\u221E";
            result.details.push(`  \u6682\u505C: ${camp.campaignName} (ACoS: ${campAcos}%, \u82B1\u8D39: $${Number(camp.total_spend).toFixed(0)})`);
          } catch (err) {
            result.failedCount++;
          }
        }
        if (extremeRows.length > 0) {
          try {
            const { syncCampaignStatusToAmazon: syncCampaignStatusToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
            const statusChanges = extremeRows.map((c) => ({
              amazonCampaignId: String(c.campaignId),
              newStatus: "paused",
              campaignName: String(c.campaignName || ""),
              reason: `[SystemDefense] \u7D27\u6025\u4F18\u5316: ACoS>200%`
            }));
            await syncCampaignStatusToAmazon2(account.id, statusChanges);
            result.details.push(`  \u5DF2\u540C\u6B65${extremeRows.length}\u4E2ACampaign\u6682\u505C\u5230Amazon`);
          } catch (syncErr) {
            result.details.push(`  \u540C\u6B65\u5931\u8D25: ${syncErr.message}`);
          }
        }
        try {
          await dbInstance.execute(sql15`
            INSERT INTO system_config (\`key\`, \`value\`, updatedAt)
            VALUES (
              ${`emergency_no_increase_${account.id}`},
              ${JSON.stringify({
            enabled: true,
            reason: `\u7D27\u6025\u4F18\u5316: ACoS ${acos.toFixed(1)}%>100%, \u7981\u6B62\u6240\u6709\u52A0\u4EF7\u64CD\u4F5C`,
            activatedAt: (/* @__PURE__ */ new Date()).toISOString()
          })},
              NOW()
            )
            ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updatedAt = NOW()
          `);
          result.details.push(`  \u5DF2\u7981\u6B62\u52A0\u4EF7\u64CD\u4F5C`);
        } catch {
        }
        logOptimizationWarn("SystemDefense", `\u7D27\u6025\u4F18\u5316(CRITICAL): ${account.storeName || account.accountName} ${account.marketplace} ACoS=${acos.toFixed(1)}%, \u6682\u505C${extremeRows.length}\u4E2ACampaign`);
      } else if (acos > 50) {
        result.details.push(`
[WARNING] \u8D26\u6237${account.storeName || account.accountName} ${account.marketplace}: ACoS=${acos.toFixed(1)}%`);
        const [zeroConvCampaigns] = await dbInstance.execute(sql15`
 SELECT c.id, c.campaignId, c.campaignName, SUM(dp.spend) as total_spend
 FROM campaigns c
 JOIN daily_performance dp ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
 WHERE c.accountId = ${account.id}
 AND c.campaignStatus = 'enabled'
 AND dp.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
 GROUP BY c.id, c.campaignId, c.campaignName
 HAVING total_spend > 50 AND SUM(dp.orders) = 0
 ORDER BY total_spend DESC
 LIMIT 10
 `);
        const zeroConvRows = zeroConvCampaigns;
        for (const camp of zeroConvRows) {
          try {
            await dbInstance.execute(sql15`
              UPDATE campaigns SET campaignStatus = 'paused' WHERE id = ${camp.id}
            `);
            result.actionsCount++;
            result.successCount++;
            result.details.push(`  \u6682\u505C\u96F6\u8F6C\u5316: ${camp.campaignName} (\u82B1\u8D39: $${Number(camp.total_spend).toFixed(0)}, 0\u5355)`);
          } catch {
            result.failedCount++;
          }
        }
        if (zeroConvRows.length > 0) {
          try {
            const { syncCampaignStatusToAmazon: syncCampaignStatusToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
            const statusChanges = zeroConvRows.map((c) => ({
              amazonCampaignId: String(c.campaignId),
              newStatus: "paused",
              campaignName: String(c.campaignName || ""),
              reason: `[SystemDefense] \u7D27\u6025\u4F18\u5316: \u96F6\u8F6C\u5316\u9AD8\u82B1\u8D39`
            }));
            await syncCampaignStatusToAmazon2(account.id, statusChanges);
          } catch {
          }
        }
        logOptimization("SystemDefense", `\u7D27\u6025\u4F18\u5316(WARNING): ${account.storeName || account.accountName} ${account.marketplace} ACoS=${acos.toFixed(1)}%, \u6682\u505C${zeroConvRows.length}\u4E2A\u96F6\u8F6C\u5316Campaign`);
      }
    }
    if (result.actionsCount === 0) {
      result.details.push("\u6240\u6709\u8D26\u6237ACoS\u5728\u53EF\u63A7\u8303\u56F4\u5185\uFF0C\u65E0\u9700\u7D27\u6025\u5E72\u9884");
    }
  } catch (error48) {
    result.failedCount++;
    result.details.push(`\u7D27\u6025\u4F18\u5316\u5F02\u5E38: ${error48.message}`);
    logOptimizationWarn("SystemDefense", `\u7D27\u6025\u4F18\u5316\u5F02\u5E38: ${error48.message}`);
  }
  return result;
}
async function runSystemDefenseScan() {
  const startTime = Date.now();
  log100.info("[SystemDefense] ========== \u7CFB\u7EDF\u9632\u7EBF\u5168\u91CF\u626B\u63CF\u5F00\u59CB ==========");
  await ensureSystemConfigTable();
  const modules = [];
  try {
    const syncResult = await cleanupSyncFailures();
    modules.push(syncResult);
  } catch (err) {
    modules.push({ module: "sync_cleanup", actionsCount: 0, successCount: 0, failedCount: 1, details: [`\u6A21\u5757\u5F02\u5E38: ${err.message}`], timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
  try {
    const algoResult = await checkAlgorithmHealth();
    modules.push(algoResult);
  } catch (err) {
    modules.push({ module: "algorithm_circuit_breaker", actionsCount: 0, successCount: 0, failedCount: 1, details: [`\u6A21\u5757\u5F02\u5E38: ${err.message}`], timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
  try {
    const spiralResult = await detectAndIntervenDeathSpiral();
    modules.push(spiralResult);
  } catch (err) {
    modules.push({ module: "death_spiral_intervention", actionsCount: 0, successCount: 0, failedCount: 1, details: [`\u6A21\u5757\u5F02\u5E38: ${err.message}`], timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
  try {
    const emergencyResult = await executeRealEmergencyOptimization();
    modules.push(emergencyResult);
  } catch (err) {
    modules.push({ module: "real_emergency_optimization", actionsCount: 0, successCount: 0, failedCount: 1, details: [`\u6A21\u5757\u5F02\u5E38: ${err.message}`], timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
  const totalActions = modules.reduce((sum2, m) => sum2 + m.actionsCount, 0);
  const totalSuccess = modules.reduce((sum2, m) => sum2 + m.successCount, 0);
  const totalFailed = modules.reduce((sum2, m) => sum2 + m.failedCount, 0);
  const elapsed = Date.now() - startTime;
  const summary = `\u7CFB\u7EDF\u9632\u7EBF\u626B\u63CF\u5B8C\u6210: ${totalActions}\u4E2A\u64CD\u4F5C(${totalSuccess}\u6210\u529F/${totalFailed}\u5931\u8D25), \u8017\u65F6${elapsed}ms`;
  log100.info(`[SystemDefense] ${summary}`);
  logOptimization("SystemDefense", summary);
  return {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    modules,
    summary
  };
}
var log100, systemConfigTableEnsured;
var init_systemDefenseService = __esm({
  "server/system/systemDefenseService.ts"() {
    "use strict";
    init_db2();
    init_db2();
    init_logger();
    init_opsLogger();
    log100 = createModuleLogger("SystemDefense");
    systemConfigTableEnsured = false;
    __name(ensureSystemConfigTable, "ensureSystemConfigTable");
    __name(cleanupSyncFailures, "cleanupSyncFailures");
    __name(checkAlgorithmHealth, "checkAlgorithmHealth");
    __name(isAlgorithmCircuitBroken, "isAlgorithmCircuitBroken");
    __name(detectAndIntervenDeathSpiral, "detectAndIntervenDeathSpiral");
    __name(isAccountBidIncreaseBlocked, "isAccountBidIncreaseBlocked");
    __name(executeRealEmergencyOptimization, "executeRealEmergencyOptimization");
    __name(runSystemDefenseScan, "runSystemDefenseScan");
  }
});

