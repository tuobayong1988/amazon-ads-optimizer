// Extracted from production dist/index.js
// Original module: server/sync/optimizationSyncEngine.ts
// Lines: 1848

var optimizationSyncEngine_exports = {};
__export(optimizationSyncEngine_exports, {
  enqueueTasks: () => enqueueTasks,
  executeBatchSync: () => executeBatchSync,
  getBatchStatus: () => getBatchStatus,
  processRetryTasks: () => processRetryTasks
});
async function enqueueTasks(tasks) {
  if (tasks.length === 0) return "";
  const batchId = tasks[0].batchId || (0, import_crypto4.randomUUID)();
  let filteredTasks = tasks;
  try {
    const { filterDeletedEntities: filterDeletedEntities2 } = await Promise.resolve().then(() => (init_entityStateAlignment(), entityStateAlignment_exports));
    const keywordIds = [];
    const targetIds = [];
    for (const t2 of tasks) {
      const task = t2;
      if (task.targetEntityType === "keyword" && task.targetEntityId) {
        keywordIds.push(Number(task.targetEntityId));
      } else if (task.targetEntityType === "product_target" && task.targetEntityId) {
        targetIds.push(Number(task.targetEntityId));
      }
    }
    const deletedKeywords = keywordIds.length > 0 ? await filterDeletedEntities2("keyword", keywordIds) : /* @__PURE__ */ new Set();
    const deletedTargets = targetIds.length > 0 ? await filterDeletedEntities2("product_target", targetIds) : /* @__PURE__ */ new Set();
    if (deletedKeywords.size > 0 || deletedTargets.size > 0) {
      filteredTasks = tasks.filter((t2) => {
        const task = t2;
        if (task.targetEntityType === "keyword" && deletedKeywords.has(Number(task.targetEntityId))) return false;
        if (task.targetEntityType === "product_target" && deletedTargets.has(Number(task.targetEntityId))) return false;
        return true;
      });
      const removed = tasks.length - filteredTasks.length;
      if (removed > 0) {
        log92.warn(`[SyncEngine] v523.2: \u9884\u8FC7\u6EE4\u79FB\u9664 ${removed} \u4E2A\u5F15\u7528\u5DF2\u5220\u9664\u5B9E\u4F53\u7684\u4EFB\u52A1 (kw=${deletedKeywords.size}, tgt=${deletedTargets.size})`);
      }
    }
  } catch (filterErr) {
    log92.debug(`[SyncEngine] v523.2: \u9884\u8FC7\u6EE4\u5931\u8D25\uFF0C\u7EE7\u7EED\u4F7F\u7528\u539F\u59CB\u4EFB\u52A1\u5217\u8868: ${filterErr.message}`);
  }
  if (filteredTasks.length === 0) {
    log92.info(`[SyncEngine] v523.2: \u6240\u6709\u4EFB\u52A1\u5747\u5F15\u7528\u5DF2\u5220\u9664\u5B9E\u4F53\uFF0C\u8DF3\u8FC7\u5165\u961F`);
    return "";
  }
  log92.debug(`[SyncEngine] \u5165\u961F\u4EFB\u52A1: batchId=${batchId}, \u603B\u8BA1=${filteredTasks.length}\u6761${filteredTasks.length < tasks.length ? ` (\u539F\u59CB${tasks.length}\u6761, \u8FC7\u6EE4${tasks.length - filteredTasks.length}\u6761)` : ""}`);
  const conn = await getDirectConnection();
  try {
    await insertTasks(conn, batchId, filteredTasks);
    log92.info(`[SyncEngine] \u2705 \u5165\u961F\u5B8C\u6210: batchId=${batchId}, ${filteredTasks.length}\u6761\u4EFB\u52A1`);
  } finally {
    conn.release();
  }
  return batchId;
}
async function executeBatchSync(options) {
  const startTime = Date.now();
  const result = {
    batchId: options?.batchId || "all",
    totalTasks: 0,
    synced: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    duration: 0
  };
  if (isShuttingDown()) {
    log92.info("[SyncEngine] \u7CFB\u7EDF\u6B63\u5728\u5173\u95ED\uFF0C\u8DF3\u8FC7\u6279\u91CF\u540C\u6B65");
    result.duration = Date.now() - startTime;
    return result;
  }
  log92.info(`[SyncEngine] ========== \u5F00\u59CB\u6279\u91CF\u540C\u6B65 ==========`);
  // v577: Redis队列集成 - 尝试从Redis获取高优先级任务
  try {
    const { getRedisClient: getRedisClient2 } = await Promise.resolve().then(() => (init_redis(), redis_exports));
    const redisClient = await getRedisClient2();
    if (redisClient) {
      const emergencyTasks = await redisClient.lrange("ppcopt:emergency_sync_queue", 0, -1);
      if (emergencyTasks.length > 0) {
        log92.warn(`[SyncEngine] v577: Redis紧急队列中有 ${emergencyTasks.length} 个任务, 优先处理`);
        // 清空已读取的紧急任务
        await redisClient.del("ppcopt:emergency_sync_queue");
      }
    }
  } catch (redisErr) {
    log92.debug(`[SyncEngine] v577: Redis不可用, 使用数据库队列: ${redisErr.message}`);
  }
  log92.debug(`[SyncEngine] \u53C2\u6570: batchId=${options?.batchId || "all"}, accountId=${options?.accountId || "all"}, maxTasks=${options?.maxTasks || "unlimited"}`);
  const conn = await getDirectConnection(6e4);
  try {
    const zombieCount = await cleanupZombieTasks(conn);
    if (zombieCount > 0) {
      log92.warn(`[SyncEngine] v457: \u6E05\u7406${zombieCount}\u4E2A\u50F5\u5C38\u4EFB\u52A1(processing\u8D85\u8FC715\u5206\u949F)`);
    }
  } catch (zombieErr) {
    log92.warn(`[SyncEngine] v457: \u50F5\u5C38\u4EFB\u52A1\u6E05\u7406\u5931\u8D25: ${zombieErr.message}`);
  }
  try {
    const kwCleanCount = await cleanupDeletedKeywordTasks(conn);
    if (kwCleanCount > 0) {
      log92.warn(`[SyncEngine] v457: \u6E05\u7406${kwCleanCount}\u4E2A\u5F15\u7528\u5DF2\u5220\u9664keyword\u7684\u4EFB\u52A1`);
    }
    const ptCleanCount = await cleanupDeletedProductTargetTasks(conn);
    if (ptCleanCount > 0) {
      log92.warn(`[SyncEngine] v457: \u6E05\u7406${ptCleanCount}\u4E2A\u5F15\u7528\u5DF2\u5220\u9664product_target\u7684\u4EFB\u52A1`);
    }
  } catch (cleanErr) {
    log92.warn(`[SyncEngine] v429: \u5931\u6548\u5F15\u7528\u6E05\u7406\u5931\u8D25: ${cleanErr.message}`);
  }
  const accountGroups = /* @__PURE__ */ new Map();
  try {
    const rows = await getPendingTasks(conn, {
      batchId: options?.batchId,
      accountId: options?.accountId,
      maxTasks: options?.maxTasks
    });
    result.totalTasks = rows.length;
    if (rows.length === 0) {
      log92.info(`[SyncEngine] \u6CA1\u6709\u5F85\u5904\u7406\u7684\u540C\u6B65\u4EFB\u52A1`);
      result.duration = Date.now() - startTime;
      return result;
    }
    log92.info(`[SyncEngine] \u8BFB\u53D6\u5230 ${rows.length} \u6761\u5F85\u540C\u6B65\u4EFB\u52A1`);
    for (const row of rows) {
      const accId = row.account_id;
      if (!accountGroups.has(accId)) accountGroups.set(accId, []);
      accountGroups.get(accId).push(row);
    }
    log92.debug(`[SyncEngine] \u5206\u4E3A ${accountGroups.size} \u4E2A\u8D26\u53F7\u7EC4`);
    const ACCOUNT_SYNC_DELAY_MS = 3e3;
    const TYPE_SYNC_DELAY_MS = 1e3;
    // v577: 风险控制增强 - 对账户按优先级排序，critical风险账户优先处理
    let sortedAccountGroups;
    try {
      const { getDb: getDb6 } = await Promise.resolve().then(() => (init_db2(), db_exports));
      const db6 = await getDb6();
      if (db6) {
        const { sql: sql18 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        const accountIds = Array.from(accountGroups.keys());
        const emergencyAccounts = await db6.execute(sql18`
          SELECT DISTINCT accountId FROM emergency_optimization_queue 
          WHERE processed = 0 AND accountId IN (${sql18.join(accountIds.map(id => sql18`${id}`), sql18`,`)})
        `);
        const emergencyAccountIds = new Set((emergencyAccounts || []).map(r => r.accountId));
        // 将有紧急任务的账户排在前面
        const entries = Array.from(accountGroups.entries());
        sortedAccountGroups = entries.sort((a, b) => {
          const aEmergency = emergencyAccountIds.has(a[0]) ? 0 : 1;
          const bEmergency = emergencyAccountIds.has(b[0]) ? 0 : 1;
          return aEmergency - bEmergency;
        });
        if (emergencyAccountIds.size > 0) {
          log92.warn(`[SyncEngine] v577: ${emergencyAccountIds.size} 个账户有紧急任务, 优先处理: ${Array.from(emergencyAccountIds).join(',')}`);
        }
      } else {
        sortedAccountGroups = Array.from(accountGroups.entries());
      }
    } catch (priorityErr) {
      log92.debug(`[SyncEngine] v577: 优先级排序失败, 使用默认顺序: ${priorityErr.message}`);
      sortedAccountGroups = Array.from(accountGroups.entries());
    }
    let accountIndex = 0;
    const totalAccountGroups = accountGroups.size;
    for (const [accountId, accountTasks] of sortedAccountGroups) {
      accountIndex++;
      log92.info(`[SyncEngine] [v352] --- \u5904\u7406\u8D26\u53F7 [${accountIndex}/${totalAccountGroups}] ${accountId}: ${accountTasks.length} \u6761\u4EFB\u52A1 ---`);
      const typeGroups = /* @__PURE__ */ new Map();
      for (const task of accountTasks) {
        const type = task.task_type;
        if (!typeGroups.has(type)) typeGroups.set(type, []);
        typeGroups.get(type).push(task);
      }
      let typeIndex = 0;
      const totalTypes = typeGroups.size;
      for (const [taskType, typeTasks] of typeGroups) {
        typeIndex++;
        log92.info(`[SyncEngine] [v352] \u5904\u7406 ${taskType} [${typeIndex}/${totalTypes}]: ${typeTasks.length} \u6761`);
        try {
          const typeResult = await syncTasksByType(conn, accountId, taskType, typeTasks, options?.dryRun);
          result.synced += typeResult.synced;
          result.failed += typeResult.failed;
          result.skipped += typeResult.skipped;
          if (typeResult.errors.length > 0) {
            result.errors.push(...typeResult.errors.slice(0, 5));
          }
        } catch (err) {
          log92.warn(`[SyncEngine] ${taskType} \u5904\u7406\u5F02\u5E38: ${err.message}`);
          result.errors.push(`${taskType}: ${err.message}`);
          const taskIds = typeTasks.map((t2) => t2.id);
          await markTasksFailed2(conn, taskIds, err.message);
          result.failed += typeTasks.length;
        }
        if (typeIndex < totalTypes) {
          log92.debug(`[SyncEngine] [v352] \u4EFB\u52A1\u7C7B\u578B\u95F4\u5EF6\u8FDF ${TYPE_SYNC_DELAY_MS}ms`);
          await new Promise((resolve) => setTimeout(resolve, TYPE_SYNC_DELAY_MS));
        }
      }
      if (accountIndex < totalAccountGroups) {
        log92.info(`[SyncEngine] [v352] \u8D26\u53F7\u95F4\u5EF6\u8FDF ${ACCOUNT_SYNC_DELAY_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, ACCOUNT_SYNC_DELAY_MS));
      }
    }
    if (options?.batchId) {
      await updateLogsSyncStatus2(conn, options.batchId);
    }
  } finally {
    conn.release();
  }
  result.duration = Date.now() - startTime;
  log92.info(`[SyncEngine] ========== \u6279\u91CF\u540C\u6B65\u5B8C\u6210 ==========`);
  log92.warn(`[SyncEngine] \u603B\u8BA1=${result.totalTasks}, \u6210\u529F=${result.synced}, \u5931\u8D25=${result.failed}, \u8DF3\u8FC7=${result.skipped}, \u8017\u65F6=${result.duration}ms`);
  if (result.synced > 0) {
    try {
      const { logAudit: logAudit2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
      for (const [accountId, accountTasks] of accountGroups) {
        const bidTasks = accountTasks.filter((t2) => t2.task_type === "bid_adjustment");
        const statusTasks = accountTasks.filter((t2) => t2.task_type === "campaign_status" || t2.task_type === "keyword_status");
        const budgetTasks = accountTasks.filter((t2) => t2.task_type === "budget_adjustment");
        const negKeywordTasks = accountTasks.filter((t2) => t2.task_type === "negative_keyword");
        const newKeywordTasks = accountTasks.filter((t2) => t2.task_type === "new_keyword");
        const placementTasks = accountTasks.filter((t2) => t2.task_type === "placement_adjustment");
        const daypartingTasks = accountTasks.filter((t2) => t2.task_type === "dayparting_adjustment");
        if (bidTasks.length > 0) {
          await logAudit2({
            userId: 0,
            userName: "\u7CFB\u7EDF\u81EA\u52A8\u4F18\u5316",
            // v375: 修复审计日志显示"未知用户"问题
            actionType: "bid_adjust_batch",
            targetType: "keyword",
            targetId: String(accountId),
            description: `\u81EA\u52A8\u4F18\u5316: \u6279\u91CF\u8C03\u6574 ${bidTasks.length} \u4E2A\u6295\u653E\u8BCD\u51FA\u4EF7`,
            accountId
          });
        }
        if (statusTasks.length > 0) {
          await logAudit2({
            userId: 0,
            userName: "\u7CFB\u7EDF\u81EA\u52A8\u4F18\u5316",
            actionType: "campaign_update",
            targetType: "campaign",
            targetId: String(accountId),
            description: `\u81EA\u52A8\u4F18\u5316: \u6279\u91CF\u53D8\u66F4 ${statusTasks.length} \u4E2A\u5E7F\u544A\u6D3B\u52A8/\u5173\u952E\u8BCD\u72B6\u6001`,
            accountId
          });
        }
        if (budgetTasks.length > 0) {
          await logAudit2({
            userId: 0,
            userName: "\u7CFB\u7EDF\u81EA\u52A8\u4F18\u5316",
            actionType: "campaign_update",
            targetType: "campaign",
            targetId: String(accountId),
            description: `\u81EA\u52A8\u4F18\u5316: \u6279\u91CF\u8C03\u6574 ${budgetTasks.length} \u4E2A\u5E7F\u544A\u6D3B\u52A8\u9884\u7B97`,
            accountId
          });
        }
        if (negKeywordTasks.length > 0) {
          await logAudit2({
            userId: 0,
            userName: "\u7CFB\u7EDF\u81EA\u52A8\u4F18\u5316",
            actionType: "campaign_update",
            targetType: "keyword",
            targetId: String(accountId),
            description: `\u81EA\u52A8\u4F18\u5316: \u6279\u91CF\u6DFB\u52A0 ${negKeywordTasks.length} \u4E2A\u5426\u5B9A\u5173\u952E\u8BCD`,
            accountId
          });
        }
        if (newKeywordTasks.length > 0) {
          await logAudit2({
            userId: 0,
            userName: "\u7CFB\u7EDF\u81EA\u52A8\u4F18\u5316",
            actionType: "campaign_update",
            targetType: "keyword",
            targetId: String(accountId),
            description: `\u81EA\u52A8\u4F18\u5316: \u641C\u7D22\u8BCD\u6536\u5272 - \u65B0\u589E ${newKeywordTasks.length} \u4E2A\u6295\u653E\u5173\u952E\u8BCD`,
            accountId
          });
        }
        if (placementTasks.length > 0) {
          await logAudit2({
            userId: 0,
            userName: "\u7CFB\u7EDF\u81EA\u52A8\u4F18\u5316",
            actionType: "campaign_update",
            targetType: "campaign",
            targetId: String(accountId),
            description: `\u81EA\u52A8\u4F18\u5316: \u8C03\u6574 ${placementTasks.length} \u4E2A\u5E7F\u544A\u6D3B\u52A8\u4F4D\u7F6E\u503E\u659C`,
            accountId
          });
        }
        if (daypartingTasks.length > 0) {
          await logAudit2({
            userId: 0,
            userName: "\u7CFB\u7EDF\u81EA\u52A8\u4F18\u5316",
            actionType: "campaign_update",
            targetType: "campaign",
            targetId: String(accountId),
            description: `\u81EA\u52A8\u4F18\u5316: \u5206\u65F6\u8C03\u6574 ${daypartingTasks.length} \u4E2A\u5E7F\u544A\u6D3B\u52A8`,
            accountId
          });
        }
      }
    } catch (auditErr) {
      log92.warn(`[SyncEngine] v221: \u8BB0\u5F55\u5BA1\u8BA1\u65E5\u5FD7\u5931\u8D25: ${auditErr.message}`);
    }
  }
  if (result.synced > 0) {
    try {
      const { confirmationSync: confirmationSync2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
      const affectedAccounts = /* @__PURE__ */ new Map();
      for (const [accountId, accountTasks] of accountGroups) {
        const entities = /* @__PURE__ */ new Set();
        for (const task of accountTasks) {
          if (task.task_type === "bid_adjustment") {
            if (task.target_entity_type === "keyword") entities.add("keywords");
            if (task.target_entity_type === "product_target") entities.add("targets");
          } else if (task.task_type === "campaign_status") {
            entities.add("campaigns");
          } else if (task.task_type === "budget_adjustment") {
            entities.add("budgets");
          } else if (task.task_type === "keyword_status") {
            entities.add("keywords");
          }
        }
        if (entities.size > 0) {
          affectedAccounts.set(accountId, entities);
        }
      }
      const { submitReliableConfirmation: submitReliableConfirmation2 } = await Promise.resolve().then(() => (init_commandConfirmationService(), commandConfirmationService_exports));
      for (const [accountId, entities] of affectedAccounts) {
        const entityArray = Array.from(entities);
        const hasKeywords = entityArray.includes("keywords");
        const hasBudgets = entityArray.includes("budgets");
        const hasCampaigns = entityArray.includes("campaigns");
        const opType = hasKeywords ? "bid_change" : hasBudgets ? "budget_change" : hasCampaigns ? "status_change" : "general";
        const requestId = submitReliableConfirmation2(accountId, entityArray, "optimizationSyncEngine", opType);
        log92.info(`[SyncEngine] v359: \u63D0\u4EA4\u53EF\u9760\u786E\u8BA4\u8BF7\u6C42 - \u8D26\u6237${accountId}: ${requestId}`);
      }
    } catch (confirmErr) {
      log92.warn(`[SyncEngine] v219: \u89E6\u53D1\u786E\u8BA4\u540C\u6B65\u5F02\u5E38: ${confirmErr.message}`);
    }
  }
  return result;
}
async function syncTasksByType(conn, accountId, taskType, tasks, dryRun) {
  const result = { synced: 0, failed: 0, skipped: 0, errors: [] };
  const config2 = BATCH_CONFIG[taskType] || { maxBatchSize: 100, delayMs: 500 };
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) {
    const msg = `\u8D26\u53F7 ${accountId} \u65E0\u6CD5\u83B7\u53D6API\u670D\u52A1`;
    result.errors.push(msg);
    result.failed = tasks.length;
    await markTasksFailed2(conn, tasks.map((t2) => t2.id), msg);
    return result;
  }
  const taskIds = tasks.map((t2) => t2.id);
  if (taskIds.length > 0) {
    await markTasksProcessing(conn, taskIds);
  }
  if (dryRun) {
    log92.info(`[SyncEngine] [DryRun] \u8DF3\u8FC7 ${tasks.length} \u6761 ${taskType} \u4EFB\u52A1`);
    result.skipped = tasks.length;
    return result;
  }
  for (let i = 0; i < tasks.length; i += config2.maxBatchSize) {
    const batch = tasks.slice(i, i + config2.maxBatchSize);
    try {
      const batchResult = await executeBatchByType(conn, syncService, taskType, batch);
      result.synced += batchResult.synced;
      result.failed += batchResult.failed;
      result.errors.push(...batchResult.errors);
    } catch (err) {
      log92.warn(`[SyncEngine] \u6279\u6B21 ${i / config2.maxBatchSize + 1} \u5F02\u5E38: ${err.message}`);
      result.errors.push(err.message);
      await markTasksFailed2(conn, batch.map((t2) => t2.id), err.message);
      result.failed += batch.length;
    }
    if (i + config2.maxBatchSize < tasks.length) {
      await new Promise((resolve) => setTimeout(resolve, config2.delayMs));
    }
  }
  return result;
}
async function executeBatchByType(conn, syncService, taskType, batch) {
  const result = { synced: 0, failed: 0, skipped: 0, errors: [] };
  switch (taskType) {
    // @ts-ignore
    case "bid_adjustment": {
      for (const t2 of batch) {
        if (!t2.amazon_entity_id && t2.target_entity_id) {
          try {
            if (t2.target_entity_type === "keyword") {
              const kwAmazonId = await getKeywordAmazonId2(conn, t2.target_entity_id);
              if (kwAmazonId) {
                t2.amazon_entity_id = kwAmazonId;
                await updateTaskAmazonEntityId(conn, t2.id, kwAmazonId);
                log92.debug(`[SyncEngine] v457: \u81EA\u52A8\u67E5\u627E\u5230keyword Amazon ID: local=${t2.target_entity_id} -> amazon=${t2.amazon_entity_id}`);
              }
            } else if (t2.target_entity_type === "product_target") {
              const ptAmazonId = await getProductTargetAmazonId(conn, t2.target_entity_id);
              if (ptAmazonId) {
                t2.amazon_entity_id = ptAmazonId;
                await updateTaskAmazonEntityId(conn, t2.id, ptAmazonId);
                log92.debug(`[SyncEngine] v457: \u81EA\u52A8\u67E5\u627E\u5230product_target Amazon ID: local=${t2.target_entity_id} -> amazon=${t2.amazon_entity_id}`);
              }
            }
          } catch (lookupErr) {
            log92.warn(`[SyncEngine] v138: \u67E5\u627EAmazon ID\u5931\u8D25: ${lookupErr.message}`);
          }
        }
      }
      const validatedBatch = [];
      for (const t2 of batch) {
        if (t2.target_entity_id) {
          try {
            const checkTable = t2.target_entity_type === "keyword" ? "keywords" : "product_targets";
            const exists2 = await entityExists(conn, checkTable, t2.target_entity_id);
            if (!exists2) {
              await markTaskFailed2(conn, t2.id, `v428: \u76EE\u6807\u5B9E\u4F53\u5DF2\u4E0D\u5B58\u5728 (${checkTable}.id=${t2.target_entity_id})`);
              result.failed++;
              continue;
            }
          } catch {
          }
        }
        validatedBatch.push(t2);
      }
      const kwTasks = validatedBatch.filter((t2) => t2.target_entity_type === "keyword" && t2.amazon_entity_id);
      const ptTasks = validatedBatch.filter((t2) => t2.target_entity_type === "product_target" && t2.amazon_entity_id);
      const noIdTasks = validatedBatch.filter((t2) => !t2.amazon_entity_id);
      if (noIdTasks.length > 0) {
        log92.debug(`[SyncEngine] v429: ${noIdTasks.length}\u6761\u4EFB\u52A1\u7F3A\u5C11Amazon ID\uFF0C\u4F7F\u7528entityIdResolver\u6279\u91CF\u89E3\u6790...`);
        try {
          const { batchResolveKeywordIds: batchResolveKeywordIds2, batchResolveProductTargetIds: batchResolveProductTargetIds2 } = await Promise.resolve().then(() => (init_entityIdResolver(), entityIdResolver_exports));
          const noIdKwTasks = noIdTasks.filter((t2) => t2.target_entity_type === "keyword");
          const noIdPtTasks = noIdTasks.filter((t2) => t2.target_entity_type === "product_target");
          if (noIdKwTasks.length > 0) {
            const kwIds = noIdKwTasks.map((t2) => t2.target_entity_id);
            const kwResult = await batchResolveKeywordIds2(kwIds);
            for (const t2 of noIdKwTasks) {
              const resolved = kwResult.resolved.get(t2.target_entity_id);
              if (resolved) {
                t2.amazon_entity_id = resolved.amazonId;
                await updateTaskAmazonEntityId(conn, t2.id, resolved.amazonId);
                kwTasks.push(t2);
                log92.debug(`[SyncEngine] v457: \u2705 \u6279\u91CF\u89E3\u6790keyword: id=${t2.target_entity_id} -> ${resolved.amazonId}`);
              } else {
                try {
                  const { resolveKeywordIdOnDemand: resolveKeywordIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
                  const resolvedId = await resolveKeywordIdOnDemand2(t2.account_id, t2.target_entity_id);
                  if (resolvedId) {
                    t2.amazon_entity_id = resolvedId;
                    await updateTaskAmazonEntityId(conn, t2.id, resolvedId);
                    kwTasks.push(t2);
                    log92.info(`[SyncEngine] v457: \u2705 \u56DE\u9000\u5373\u65F6\u56DE\u586B\u6210\u529F: keyword id=${t2.target_entity_id} -> ${resolvedId}`);
                  } else {
                    await markTaskFailed2(conn, t2.id, "\u7F3A\u5C11Amazon ID\uFF08entityIdResolver+\u5373\u65F6\u56DE\u586B\u5747\u5931\u8D25\uFF09");
                    result.failed++;
                  }
                } catch (fallbackErr) {
                  await markTaskFailed2(conn, t2.id, `ID\u89E3\u6790\u5931\u8D25: ${fallbackErr.message}`);
                  result.failed++;
                }
              }
            }
          }
          if (noIdPtTasks.length > 0) {
            const ptIds = noIdPtTasks.map((t2) => t2.target_entity_id);
            const ptResult = await batchResolveProductTargetIds2(ptIds);
            for (const t2 of noIdPtTasks) {
              const resolved = ptResult.resolved.get(t2.target_entity_id);
              if (resolved) {
                t2.amazon_entity_id = resolved.amazonId;
                await updateTaskAmazonEntityId(conn, t2.id, resolved.amazonId);
                ptTasks.push(t2);
                log92.debug(`[SyncEngine] v457: \u2705 \u6279\u91CF\u89E3\u6790product_target: id=${t2.target_entity_id} -> ${resolved.amazonId}`);
              } else {
                try {
                  const { resolveProductTargetIdOnDemand: resolveProductTargetIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
                  const resolvedId = await resolveProductTargetIdOnDemand2(t2.account_id, t2.target_entity_id);
                  if (resolvedId) {
                    t2.amazon_entity_id = resolvedId;
                    await updateTaskAmazonEntityId(conn, t2.id, resolvedId);
                    ptTasks.push(t2);
                    log92.info(`[SyncEngine] v457: \u2705 \u56DE\u9000\u5373\u65F6\u56DE\u586B\u6210\u529F: product_target id=${t2.target_entity_id} -> ${resolvedId}`);
                  } else {
                    await markTaskFailed2(conn, t2.id, "\u7F3A\u5C11Amazon ID\uFF08entityIdResolver+\u5373\u65F6\u56DE\u586B\u5747\u5931\u8D25\uFF09");
                    result.failed++;
                  }
                } catch (fallbackErr) {
                  await markTaskFailed2(conn, t2.id, `ID\u89E3\u6790\u5931\u8D25: ${fallbackErr.message}`);
                  result.failed++;
                }
              }
            }
          }
        } catch (resolverErr) {
          log92.warn(`[SyncEngine] v429: entityIdResolver\u4E0D\u53EF\u7528\uFF0C\u56DE\u9000\u5230amazonIdResolver: ${resolverErr.message}`);
          try {
            const { resolveKeywordIdOnDemand: resolveKeywordIdOnDemand2, resolveProductTargetIdOnDemand: resolveProductTargetIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
            for (const t2 of noIdTasks) {
              try {
                let resolvedId = null;
                if (t2.target_entity_type === "keyword") {
                  resolvedId = await resolveKeywordIdOnDemand2(t2.account_id, t2.target_entity_id);
                } else if (t2.target_entity_type === "product_target") {
                  resolvedId = await resolveProductTargetIdOnDemand2(t2.account_id, t2.target_entity_id);
                }
                if (resolvedId) {
                  t2.amazon_entity_id = resolvedId;
                  await updateTaskAmazonEntityId(conn, t2.id, resolvedId);
                  if (t2.target_entity_type === "keyword") kwTasks.push(t2);
                  else ptTasks.push(t2);
                } else {
                  await markTaskFailed2(conn, t2.id, "\u7F3A\u5C11Amazon ID\uFF08\u5DF2\u5C1D\u8BD5\u5373\u65F6\u56DE\u586B\uFF09");
                  result.failed++;
                }
              } catch (resolveErr) {
                await markTaskFailed2(conn, t2.id, `\u5373\u65F6\u56DE\u586B\u5F02\u5E38: ${resolveErr.message}`);
                result.failed++;
              }
            }
          } catch (importErr) {
            await markTasksFailed2(conn, noIdTasks.map((t2) => t2.id), "\u7F3A\u5C11Amazon ID\uFF08\u6240\u6709\u89E3\u6790\u5668\u5747\u4E0D\u53EF\u7528\uFF09");
            result.failed += noIdTasks.length;
          }
        }
      }
      if (kwTasks.length > 0) {
        const spKwTasks = [];
        const sbKwTasks = [];
        for (const t2 of kwTasks) {
          try {
            let campaignType = "sp_manual";
            let kwMarketplace = "US";
            let kwCostType = "cpc";
            if (t2.campaign_id) {
              const campInfo = await getCampaignTypeById(conn, t2.campaign_id);
              if (campInfo) {
                campaignType = campInfo.campaignType;
                kwMarketplace = campInfo.marketplace;
                kwCostType = campInfo.costType;
              }
            } else if (t2.target_entity_id) {
              const kwCampInfo = await getCampaignTypeByKeywordId(conn, t2.target_entity_id);
              if (kwCampInfo) {
                campaignType = kwCampInfo.campaignType;
                kwMarketplace = kwCampInfo.marketplace;
                kwCostType = kwCampInfo.costType;
              }
            }
            t2._marketplace = kwMarketplace;
            t2._costType = kwCostType;
            if (campaignType === "sb") {
              sbKwTasks.push(t2);
            } else {
              spKwTasks.push(t2);
            }
          } catch (typeErr) {
            log92.warn(`[SyncEngine] v224: \u67E5\u8BE2campaign\u7C7B\u578B\u5931\u8D25: ${typeErr.message}, \u9ED8\u8BA4\u4F7F\u7528SP API`);
            spKwTasks.push(t2);
          }
        }
        if (sbKwTasks.length > 0) {
          log92.info(`[SyncEngine] v224: \u68C0\u6D4B\u5230${sbKwTasks.length}\u4E2ASB\u5173\u952E\u8BCD\uFF0C\u4F7F\u7528SB API\u540C\u6B65\u51FA\u4EF7`);
        }
        if (spKwTasks.length > 0) {
          try {
            const spBidUpdates = spKwTasks.map((t2) => {
              const rawBid = Number(parseFloat(t2.new_value).toFixed(2));
              const spMarketplace = t2._marketplace || "US";
              const { clampedBid, wasAdjusted, constraint, adTypeKey } = clampBidToConstraint(rawBid, "sp_manual", spMarketplace, "cpc");
              if (wasAdjusted) {
                log92.info(`[SyncEngine] v434: SP keyword ${t2.amazon_entity_id} bid $${rawBid} \u8D85\u51FA${adTypeKey}\u7EA6\u675F[$${constraint.minBid}~$${constraint.maxBid}]\uFF0C\u8C03\u6574\u4E3A$${clampedBid}`);
              }
              return {
                keywordId: String(t2.amazon_entity_id),
                bid: clampedBid
                // @ts-ignore
              };
            });
            const apiResult = await syncService.client.updateKeywordBids(spBidUpdates);
            const failedIds = /* @__PURE__ */ new Map();
            if (apiResult.errors && apiResult.errors.length > 0) {
              for (const err of apiResult.errors) {
                const errDetail = err.details || err.code || JSON.stringify(err).substring(0, 200) || "API_ERROR";
                failedIds.set(String(err.keywordId), errDetail);
              }
            }
            for (const t2 of spKwTasks) {
              const spFailReason = failedIds.get(String(t2.amazon_entity_id));
              if (spFailReason) {
                if (spFailReason === "DUPLICATE" || spFailReason.includes("DUPLICATE")) {
                  log92.info(`[SyncEngine] v431: SP keyword ${t2.amazon_entity_id} DUPLICATE\u89C6\u4E3A\u6210\u529F`);
                  await markTaskSynced2(conn, t2.id);
                  await updateLocalBid(conn, "keyword", t2.target_entity_id, t2.new_value);
                  result.synced++;
                } else {
                  const { classifyError: classifyError2, shouldMarkEntityDeleted: shouldMarkEntityDeleted2 } = await Promise.resolve().then(() => (init_amazonApiErrorMapper(), amazonApiErrorMapper_exports));
                  const spErrorMapping = classifyError2(spFailReason);
                  if (shouldMarkEntityDeleted2(spFailReason)) {
                    await markTaskFailed2(conn, t2.id, `[v509-${spErrorMapping.code}] ${spFailReason}`);
                    try {
                      if (spErrorMapping.code === "KEYWORD_AD_GROUP_NOT_FOUND") {
                        await markKeywordAndAdGroupDeleted(conn, t2.target_entity_id, String(t2.amazon_entity_id));
                        log92.warn(`[SyncEngine] v529: SP Keyword ${t2.amazon_entity_id} \u5E7F\u544A\u7EC4\u4E0D\u5B58\u5728\uFF0C\u5DF2\u6807\u8BB0Keyword+AdGroup\u4E3Aamazon_deleted`);
                      } else {
                        await markKeywordDeleted(conn, t2.target_entity_id, String(t2.amazon_entity_id));
                        log92.warn(`[SyncEngine] v509: SP Keyword ${t2.amazon_entity_id} \u9519\u8BEF\u7801=${spErrorMapping.code}, \u5DF2\u6807\u8BB0\u4E3Aamazon_deleted`);
                      }
                    } catch (markErr) {
                      log92.warn(`[SyncEngine] v509: \u6807\u8BB0Keyword deleted\u5931\u8D25: ${markErr.message}`);
                    }
                  } else {
                    await markTaskForRetry2(conn, t2.id, t2.retry_count, spFailReason);
                  }
                  result.failed++;
                }
              } else {
                await markTaskSynced2(conn, t2.id);
                await updateLocalBid(conn, "keyword", t2.target_entity_id, t2.new_value);
                result.synced++;
              }
            }
            log92.warn(`[SyncEngine] SP\u5173\u952E\u8BCD\u51FA\u4EF7\u6279\u91CF\u540C\u6B65: \u53D1\u9001=${spKwTasks.length}, \u6210\u529F=${spKwTasks.length - failedIds.size}, \u5931\u8D25=${failedIds.size}`);
            // [fix24-P2-12] Error logging enhancement - write detailed error to optimization_events
            if (failedIds.size > 0) {
              try {
                for (const t2 of spKwTasks) {
                  const spFailDetail = failedIds.get(String(t2.amazon_entity_id));
                  if (spFailDetail && t2.event_id) {
                    await conn.execute(
                      `UPDATE optimization_events SET error_message = CONCAT(COALESCE(error_message, ''), ' | [P2-12] SP bid sync failed: ', ?, ' at ', NOW()) WHERE id = ? AND api_sync_status != 'synced'`,
                      [String(spFailDetail).substring(0, 200), t2.event_id]
                    );
                  }
                }
              } catch (errLogErr) {
                log92.debug(`[SyncEngine] [fix24-P2-12] 错误日志增强写入失败: ${errLogErr.message}`);
              }
            }
          } catch (err) {
            log92.warn(`[SyncEngine] SP\u5173\u952E\u8BCD\u51FA\u4EF7\u6279\u91CFAPI\u8C03\u7528\u5931\u8D25: ${err.message}`);
            for (const t2 of spKwTasks) {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
            }
            result.failed += spKwTasks.length;
            result.errors.push(`SP\u5173\u952E\u8BCD\u51FA\u4EF7API\u5931\u8D25: ${err.message}`);
          }
        }
        if (sbKwTasks.length > 0) {
          try {
            const sbUpdates = [];
            const sbSkippedTasks = [];
            for (const t2 of sbKwTasks) {
              try {
                const kwDetail = await getKeywordDetailById(conn, t2.target_entity_id);
                if (kwDetail && kwDetail.amazonAdGroupId && kwDetail.amazonCampaignId) {
                  let sbBid = Number(parseFloat(t2.new_value).toFixed(2));
                  let sbAdFormat = null;
                  let sbMarketplace = "US";
                  const campDetail = await getCampaignDetailByAmazonId(conn, kwDetail.amazonCampaignId);
                  if (campDetail) {
                    sbAdFormat = campDetail.adFormat;
                    sbMarketplace = campDetail.marketplace;
                    if (!sbAdFormat && campDetail.campaignName) {
                      const campName = campDetail.campaignName.toUpperCase();
                      if (campName.includes("SBV") || campName.includes("VIDEO")) {
                        sbAdFormat = "video";
                        log92.info(`[SyncEngine] v436: \u4ECEcampaign\u540D\u79F0\u63A8\u65ADSBV: ${campDetail.campaignName}`);
                      }
                    }
                  }
                  if (!sbAdFormat && t2.campaign_name) {
                    const taskCampName = String(t2.campaign_name).toUpperCase();
                    if (taskCampName.includes("SBV") || taskCampName.includes("VIDEO")) {
                      sbAdFormat = "video";
                    }
                  }
                  const { clampedBid: clampedSbBid, wasAdjusted: sbWasAdjusted, constraint: sbConstraint, adTypeKey: sbAdTypeKey } = clampBidToConstraint(sbBid, "sb", sbMarketplace, "cpc", sbAdFormat);
                  if (sbWasAdjusted) {
                    log92.info(`[SyncEngine] v434: SB keyword bid $${sbBid} \u8D85\u51FA${sbAdTypeKey}\u7EA6\u675F[$${sbConstraint.minBid}~$${sbConstraint.maxBid}]\uFF0C\u8C03\u6574\u4E3A$${clampedSbBid} (marketplace=${sbMarketplace})`);
                  }
                  sbBid = clampedSbBid;
                  sbUpdates.push({
                    // @ts-ignore
                    keywordId: String(t2.amazon_entity_id),
                    bid: sbBid,
                    adGroupId: String(kwDetail.amazonAdGroupId),
                    // @ts-ignore
                    campaignId: String(kwDetail.amazonCampaignId)
                  });
                } else {
                  await markTaskFailed2(conn, t2.id, "v429: \u65E0\u6CD5\u83B7\u53D6SB\u5173\u952E\u8BCD\u7684adGroupId\u6216campaignId");
                  result.failed++;
                  sbSkippedTasks.push(t2);
                }
              } catch (detailErr) {
                await markTaskForRetry2(conn, t2.id, t2.retry_count, `v429: \u67E5\u8BE2SB\u5173\u952E\u8BCD\u8BE6\u60C5\u5931\u8D25: ${detailErr.message}`);
                result.failed++;
                sbSkippedTasks.push(t2);
              }
            }
            const activeSbTasks = sbKwTasks.filter((t2) => !sbSkippedTasks.includes(t2));
            if (sbUpdates.length > 0) {
              log92.info(`[SyncEngine] v429: SB\u5173\u952E\u8BCD\u51FA\u4EF7\u51C6\u5907\u5B8C\u6210: \u6709\u6548=${sbUpdates.length}, \u8DF3\u8FC7=${sbSkippedTasks.length}`);
            }
            const sbApiResult = sbUpdates.length > 0 ? await syncService.client.updateSbKeywordBids(sbUpdates) : { successes: [], errors: [] };
            const sbFailedIds = /* @__PURE__ */ new Map();
            if (sbApiResult.errors && sbApiResult.errors.length > 0) {
              for (const err of sbApiResult.errors) {
                const sbErrDetail = err.details || err.code || JSON.stringify(err).substring(0, 200) || "SB_API_ERROR";
                sbFailedIds.set(String(err.keywordId), sbErrDetail);
              }
            }
            for (const t2 of activeSbTasks) {
              const failReason = sbFailedIds.get(String(t2.amazon_entity_id));
              if (failReason) {
                if (failReason === "DUPLICATE" || failReason.includes("DUPLICATE")) {
                  log92.info(`[SyncEngine] v431: SB keyword ${t2.amazon_entity_id} DUPLICATE\u89C6\u4E3A\u6210\u529F\uFF08bid\u5DF2\u662F\u76EE\u6807\u503C\uFF09`);
                  await markTaskSynced2(conn, t2.id);
                  await updateLocalBid(conn, "keyword", t2.target_entity_id, t2.new_value);
                  result.synced++;
                } else {
                  const { classifyError: classifySbError, shouldMarkEntityDeleted: shouldMarkSbDeleted } = await Promise.resolve().then(() => (init_amazonApiErrorMapper(), amazonApiErrorMapper_exports));
                  const sbErrorMapping = classifySbError(failReason);
                  if (shouldMarkSbDeleted(failReason)) {
                    await markTaskFailed2(conn, t2.id, `[v509-${sbErrorMapping.code}] ${failReason}`);
                    try {
                      if (sbErrorMapping.code === "KEYWORD_AD_GROUP_NOT_FOUND") {
                        await markKeywordAndAdGroupDeleted(conn, t2.target_entity_id, String(t2.amazon_entity_id));
                        log92.warn(`[SyncEngine] v529: SB Keyword ${t2.amazon_entity_id} \u5E7F\u544A\u7EC4\u4E0D\u5B58\u5728\uFF0C\u5DF2\u6807\u8BB0Keyword+AdGroup\u4E3Aamazon_deleted`);
                      } else {
                        await markKeywordDeleted(conn, t2.target_entity_id, String(t2.amazon_entity_id));
                        log92.warn(`[SyncEngine] v509: SB Keyword ${t2.amazon_entity_id} \u9519\u8BEF\u7801=${sbErrorMapping.code}, \u5DF2\u6807\u8BB0\u4E3Aamazon_deleted`);
                      }
                    } catch (markErr) {
                      log92.warn(`[SyncEngine] v509: \u6807\u8BB0SB Keyword deleted\u5931\u8D25: ${markErr.message}`);
                    }
                  } else {
                    await markTaskForRetry2(conn, t2.id, t2.retry_count, failReason);
                  }
                  result.failed++;
                }
              } else {
                await markTaskSynced2(conn, t2.id);
                await updateLocalBid(conn, "keyword", t2.target_entity_id, t2.new_value);
                result.synced++;
              }
            }
            log92.warn(`[SyncEngine] v429: SB\u5173\u952E\u8BCD\u51FA\u4EF7\u6279\u91CF\u540C\u6B65: \u53D1\u9001=${sbUpdates.length}, \u6210\u529F=${sbUpdates.length - sbFailedIds.size}, \u5931\u8D25=${sbFailedIds.size}, \u8DF3\u8FC7=${sbSkippedTasks.length}`);
          } catch (err) {
            log92.warn(`[SyncEngine] v429: SB\u5173\u952E\u8BCD\u51FA\u4EF7\u6279\u91CFAPI\u8C03\u7528\u5931\u8D25: ${err.message}`);
            for (const t2 of sbKwTasks) {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
            }
            result.failed += sbKwTasks.length;
            result.errors.push(`SB\u5173\u952E\u8BCD\u51FA\u4EF7API\u5931\u8D25: ${err.message}`);
          }
        }
      }
      if (ptTasks.length > 0) {
        const spPtTasks = [];
        const sbPtTasks = [];
        const sdPtTasks = [];
        for (const t2 of ptTasks) {
          const ptCampInfo = await getCampaignTypeByProductTargetId(conn, t2.target_entity_id);
          const ptCampType = ptCampInfo?.campaignType || "sp_manual";
          t2._ptCampType = ptCampType;
          t2._ptCostType = ptCampInfo?.costType || "cpc";
          t2._ptMarketplace = ptCampInfo?.marketplace || "US";
          if (ptCampType === "sb") {
            sbPtTasks.push(t2);
          } else if (ptCampType === "sd") {
            sdPtTasks.push(t2);
          } else {
            spPtTasks.push(t2);
          }
        }
        if (sbPtTasks.length > 0 || sdPtTasks.length > 0) {
          log92.info(`[SyncEngine] v471: \u5546\u54C1\u5B9A\u5411\u6309\u7C7B\u578B\u5206\u7EC4: SP=${spPtTasks.length}, SB=${sbPtTasks.length}, SD=${sdPtTasks.length}`);
        }
        if (spPtTasks.length > 0) {
          try {
            const spPtBidUpdates = spPtTasks.map((t2) => {
              const rawBid = Number(parseFloat(t2.new_value).toFixed(2));
              const { clampedBid, wasAdjusted, constraint, adTypeKey } = clampBidToConstraint(rawBid, t2._ptCampType || "sp_manual", t2._ptMarketplace || "US", t2._ptCostType || "cpc");
              if (wasAdjusted) {
                log92.info(`[SyncEngine] v434: SP product target ${t2.amazon_entity_id} bid $${rawBid} \u8D85\u51FA${adTypeKey}\u7EA6\u675F[$${constraint.minBid}~$${constraint.maxBid}]\uFF0C\u8C03\u6574\u4E3A$${clampedBid}`);
              }
              return { targetId: String(t2.amazon_entity_id), bid: clampedBid };
            });
            const apiResult = await syncService.client.updateProductTargetBids(spPtBidUpdates);
            const failedIds = /* @__PURE__ */ new Map();
            if (apiResult.errors && apiResult.errors.length > 0) {
              for (const err of apiResult.errors) {
                const ptErrDetail = err.details || err.code || JSON.stringify(err).substring(0, 200) || "API_ERROR";
                failedIds.set(String(err.targetId), ptErrDetail);
              }
            }
            for (const t2 of spPtTasks) {
              const ptFailReason = failedIds.get(String(t2.amazon_entity_id));
              if (ptFailReason) {
                const { shouldMarkEntityDeleted: shouldMarkPtDeleted, classifyError: classifyPtError } = await Promise.resolve().then(() => (init_amazonApiErrorMapper(), amazonApiErrorMapper_exports));
                if (shouldMarkPtDeleted(ptFailReason)) {
                  const ptMapping = classifyPtError(ptFailReason);
                  await markTaskFailed2(conn, t2.id, `[v509-${ptMapping.code}] ${ptFailReason}`);
                  try {
                    await markTargetDeleted(conn, t2.target_entity_id, String(t2.amazon_entity_id));
                  } catch (_) {
                  }
                } else {
                  await markTaskForRetry2(conn, t2.id, t2.retry_count, ptFailReason);
                }
                result.failed++;
              } else {
                await markTaskSynced2(conn, t2.id);
                await updateLocalBid(conn, "product_target", t2.target_entity_id, t2.new_value);
                result.synced++;
              }
            }
            log92.warn(`[SyncEngine] v471: SP\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u540C\u6B65: \u53D1\u9001=${spPtTasks.length}, \u6210\u529F=${spPtTasks.length - failedIds.size}, \u5931\u8D25=${failedIds.size}`);
          } catch (err) {
            for (const t2 of spPtTasks) {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
            }
            result.failed += spPtTasks.length;
            result.errors.push(`SP\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7API\u5931\u8D25: ${err.message}`);
          }
        }
        if (sbPtTasks.length > 0) {
          try {
            const sbPtUpdates = [];
            const sbPtSkipped = [];
            for (const t2 of sbPtTasks) {
              const rawBid = Number(parseFloat(t2.new_value).toFixed(2));
              const { clampedBid, wasAdjusted, constraint, adTypeKey } = clampBidToConstraint(rawBid, "sb", t2._ptMarketplace || "US", t2._ptCostType || "cpc");
              if (wasAdjusted) {
                log92.info(`[SyncEngine] v471: SB product target ${t2.amazon_entity_id} bid $${rawBid} \u8D85\u51FA${adTypeKey}\u7EA6\u675F[$${constraint.minBid}~$${constraint.maxBid}]\uFF0C\u8C03\u6574\u4E3A$${clampedBid}`);
              }
              const ptDetail = await getProductTargetDetailById(conn, t2.target_entity_id);
              if (ptDetail && ptDetail.amazonAdGroupId && ptDetail.amazonCampaignId) {
                sbPtUpdates.push({
                  // @ts-ignore
                  targetId: String(t2.amazon_entity_id),
                  bid: clampedBid,
                  adGroupId: String(ptDetail.amazonAdGroupId),
                  campaignId: String(ptDetail.amazonCampaignId)
                });
              } else {
                await markTaskFailed2(conn, t2.id, "v471: \u65E0\u6CD5\u83B7\u53D6SB\u5546\u54C1\u5B9A\u5411\u7684adGroupId\u6216campaignId");
                result.failed++;
                sbPtSkipped.push(t2);
              }
            }
            const activeSbPtTasks = sbPtTasks.filter((t2) => !sbPtSkipped.includes(t2));
            if (sbPtUpdates.length > 0) {
              const sbApiResult = await syncService.client.updateSbTargetBids(sbPtUpdates);
              const sbFailedIds = /* @__PURE__ */ new Map();
              if (sbApiResult.errors && sbApiResult.errors.length > 0) {
                for (const err of sbApiResult.errors) {
                  sbFailedIds.set(String(err.targetId), err.details || err.code || "SB_API_ERROR");
                }
              }
              for (const t2 of activeSbPtTasks) {
                const failReason = sbFailedIds.get(String(t2.amazon_entity_id));
                if (failReason) {
                  const { shouldMarkEntityDeleted: shouldMarkSbPtDeleted, classifyError: classifySbPtError } = await Promise.resolve().then(() => (init_amazonApiErrorMapper(), amazonApiErrorMapper_exports));
                  if (shouldMarkSbPtDeleted(failReason)) {
                    const sbPtMapping = classifySbPtError(failReason);
                    await markTaskFailed2(conn, t2.id, `[v509-${sbPtMapping.code}] ${failReason}`);
                    try {
                      await markTargetDeleted(conn, t2.target_entity_id, String(t2.amazon_entity_id));
                    } catch (_) {
                    }
                  } else {
                    await markTaskForRetry2(conn, t2.id, t2.retry_count, failReason);
                  }
                  result.failed++;
                } else {
                  await markTaskSynced2(conn, t2.id);
                  await updateLocalBid(conn, "product_target", t2.target_entity_id, t2.new_value);
                  result.synced++;
                }
              }
              log92.warn(`[SyncEngine] v471: SB\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u540C\u6B65: \u53D1\u9001=${sbPtUpdates.length}, \u6210\u529F=${sbPtUpdates.length - sbFailedIds.size}, \u5931\u8D25=${sbFailedIds.size}, \u8DF3\u8FC7=${sbPtSkipped.length}`);
            }
          } catch (err) {
            for (const t2 of sbPtTasks) {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
            }
            result.failed += sbPtTasks.length;
            result.errors.push(`SB\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7API\u5931\u8D25: ${err.message}`);
          }
        }
        if (sdPtTasks.length > 0) {
          try {
            const sdPtBidUpdates = sdPtTasks.map((t2) => {
              const rawBid = Number(parseFloat(t2.new_value).toFixed(2));
              const { clampedBid, wasAdjusted, constraint, adTypeKey } = clampBidToConstraint(rawBid, "sd", t2._ptMarketplace || "US", t2._ptCostType || "cpc");
              if (wasAdjusted) {
                log92.info(`[SyncEngine] v471: SD product target ${t2.amazon_entity_id} bid $${rawBid} \u8D85\u51FA${adTypeKey}\u7EA6\u675F[$${constraint.minBid}~$${constraint.maxBid}]\uFF0C\u8C03\u6574\u4E3A$${clampedBid}`);
              }
              return { targetId: String(t2.amazon_entity_id), bid: clampedBid };
            });
            await syncService.client.updateSdTargetBids(sdPtBidUpdates);
            for (const t2 of sdPtTasks) {
              await markTaskSynced2(conn, t2.id);
              await updateLocalBid(conn, "product_target", t2.target_entity_id, t2.new_value);
              result.synced++;
            }
            log92.warn(`[SyncEngine] v471: SD\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u540C\u6B65: \u53D1\u9001=${sdPtTasks.length}, \u5168\u90E8\u6210\u529F`);
          } catch (err) {
            for (const t2 of sdPtTasks) {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
            }
            result.failed += sdPtTasks.length;
            result.errors.push(`SD\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7API\u5931\u8D25: ${err.message}`);
          }
        }
      }
      break;
    }
    case "keyword_status": {
      const validTasks = [];
      const noIdTasks = [];
      for (const t2 of batch) {
        if (t2.amazon_entity_id) {
          validTasks.push(t2);
        } else {
          noIdTasks.push(t2);
        }
      }
      if (noIdTasks.length > 0) {
        try {
          const { batchResolveKeywordIds: batchResolveKeywordIds2 } = await Promise.resolve().then(() => (init_entityIdResolver(), entityIdResolver_exports));
          const kwIds = noIdTasks.map((t2) => t2.target_entity_id);
          const kwResult = await batchResolveKeywordIds2(kwIds);
          for (const t2 of noIdTasks) {
            const resolved = kwResult.resolved.get(t2.target_entity_id);
            if (resolved) {
              t2.amazon_entity_id = resolved.amazonId;
              await updateTaskAmazonEntityId(conn, t2.id, resolved.amazonId);
              validTasks.push(t2);
              log92.debug(`[SyncEngine] v457: \u2705 keyword_status\u6279\u91CF\u89E3\u6790: id=${t2.target_entity_id} -> ${resolved.amazonId}`);
            } else {
              try {
                const { resolveKeywordIdOnDemand: resolveKeywordIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
                const resolvedId = await resolveKeywordIdOnDemand2(t2.account_id, t2.target_entity_id);
                if (resolvedId) {
                  t2.amazon_entity_id = resolvedId;
                  await updateTaskAmazonEntityId(conn, t2.id, resolvedId);
                  validTasks.push(t2);
                } else {
                  await markTaskFailed2(conn, t2.id, "\u7F3A\u5C11Amazon ID\uFF08entityIdResolver+\u5373\u65F6\u56DE\u586B\u5747\u5931\u8D25\uFF09");
                  result.failed++;
                }
              } catch (fallbackErr) {
                await markTaskFailed2(conn, t2.id, `ID\u89E3\u6790\u5931\u8D25: ${fallbackErr.message}`);
                result.failed++;
              }
            }
          }
        } catch (resolverErr) {
          log92.warn(`[SyncEngine] v457: entityIdResolver\u4E0D\u53EF\u7528\uFF0C\u56DE\u9000\u5230amazonIdResolver`);
          try {
            const { resolveKeywordIdOnDemand: resolveKeywordIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
            for (const t2 of noIdTasks) {
              try {
                const resolvedId = await resolveKeywordIdOnDemand2(t2.account_id, t2.target_entity_id);
                if (resolvedId) {
                  t2.amazon_entity_id = resolvedId;
                  await updateTaskAmazonEntityId(conn, t2.id, resolvedId);
                  validTasks.push(t2);
                } else {
                  await markTaskFailed2(conn, t2.id, "\u7F3A\u5C11Amazon ID\uFF08\u5DF2\u5C1D\u8BD5\u5373\u65F6\u56DE\u586B\uFF09");
                  result.failed++;
                }
              } catch (resolveErr) {
                await markTaskFailed2(conn, t2.id, `\u5373\u65F6\u56DE\u586B\u5F02\u5E38: ${resolveErr.message}`);
                result.failed++;
              }
            }
          } catch (importErr) {
            await markTasksFailed2(conn, noIdTasks.map((t2) => t2.id), "\u7F3A\u5C11Amazon ID\uFF08\u6240\u6709\u89E3\u6790\u5668\u5747\u4E0D\u53EF\u7528\uFF09");
            result.failed += noIdTasks.length;
          }
        }
      }
      if (validTasks.length > 0) {
        const spKwTasks = [];
        const sbKwTasks = [];
        for (const t2 of validTasks) {
          const kwCampInfo = await getCampaignTypeByKeywordId(conn, t2.target_entity_id);
          const kwCampType = (kwCampInfo?.campaignType || "sp_manual").toLowerCase();
          if (kwCampType === "sb") {
            sbKwTasks.push(t2);
          } else {
            spKwTasks.push(t2);
          }
        }
        if (sbKwTasks.length > 0) {
          log92.info(`[SyncEngine] v471: \u5173\u952E\u8BCD\u72B6\u6001\u6309\u7C7B\u578B\u5206\u7EC4: SP=${spKwTasks.length}, SB=${sbKwTasks.length}`);
        }
        if (spKwTasks.length > 0) {
          try {
            const apiResult = await syncService.client.updateKeywordStatus(
              // @ts-ignore
              spKwTasks.map((t2) => ({
                keywordId: String(t2.amazon_entity_id),
                // @ts-ignore
                state: t2.new_value
              }))
            );
            const failedIdMap = /* @__PURE__ */ new Map();
            if (apiResult.errors && apiResult.errors.length > 0) {
              for (const err of apiResult.errors) {
                const errDetail = err.details || err.description || err.code || err.message || "UNKNOWN_ERROR";
                failedIdMap.set(String(err.keywordId), `v431: keyword_status API\u9519\u8BEF: ${errDetail}`);
              }
            }
            for (const t2 of spKwTasks) {
              const statusFailReason = failedIdMap.get(String(t2.amazon_entity_id));
              if (statusFailReason) {
                const { shouldMarkEntityDeleted: shouldMarkKwDeleted } = await Promise.resolve().then(() => (init_amazonApiErrorMapper(), amazonApiErrorMapper_exports));
                if (shouldMarkKwDeleted(statusFailReason)) {
                  await markTaskFailed2(conn, t2.id, `[v509-entity-deleted] ${statusFailReason}`);
                  try {
                    await markKeywordDeleted(conn, t2.target_entity_id, String(t2.amazon_entity_id));
                  } catch (_) {
                  }
                } else if (t2.retry_count >= 10) {
                  await markTaskFailed2(conn, t2.id, `[v509-max-retries] ${statusFailReason}`);
                } else {
                  await markTaskForRetry2(conn, t2.id, t2.retry_count, statusFailReason);
                }
                result.failed++;
              } else {
                await markTaskSynced2(conn, t2.id);
                await updateLocalStatus(conn, "keywords", t2.target_entity_id, t2.new_value);
                result.synced++;
              }
            }
            log92.warn(`[SyncEngine] v471: SP\u5173\u952E\u8BCD\u72B6\u6001\u540C\u6B65: \u53D1\u9001=${spKwTasks.length}, \u6210\u529F=${spKwTasks.length - failedIdMap.size}, \u5931\u8D25=${failedIdMap.size}`);
          } catch (err) {
            for (const t2 of spKwTasks) {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
            }
            result.failed += spKwTasks.length;
          }
        }
        if (sbKwTasks.length > 0) {
          try {
            const sbKwUpdates = [];
            const sbKwSkipped = [];
            for (const t2 of sbKwTasks) {
              const kwDetail = await getKeywordDetailById(conn, t2.target_entity_id);
              if (kwDetail && kwDetail.amazonAdGroupId && kwDetail.amazonCampaignId) {
                sbKwUpdates.push({
                  // @ts-ignore
                  keywordId: String(t2.amazon_entity_id),
                  // @ts-ignore
                  state: t2.new_value,
                  adGroupId: String(kwDetail.amazonAdGroupId),
                  campaignId: String(kwDetail.amazonCampaignId)
                });
              } else {
                await markTaskFailed2(conn, t2.id, "v471: \u65E0\u6CD5\u83B7\u53D6SB\u5173\u952E\u8BCD\u7684adGroupId\u6216campaignId");
                result.failed++;
                sbKwSkipped.push(t2);
              }
            }
            const activeSbKwTasks = sbKwTasks.filter((t2) => !sbKwSkipped.includes(t2));
            if (sbKwUpdates.length > 0) {
              const sbApiResult = await syncService.client.updateSbKeywordStatus(sbKwUpdates);
              const sbFailedIds = /* @__PURE__ */ new Map();
              if (sbApiResult.errors && sbApiResult.errors.length > 0) {
                for (const err of sbApiResult.errors) {
                  sbFailedIds.set(String(err.keywordId), err.details || err.code || "SB_API_ERROR");
                }
              }
              for (const t2 of activeSbKwTasks) {
                const failReason = sbFailedIds.get(String(t2.amazon_entity_id));
                if (failReason) {
                  const { shouldMarkEntityDeleted: shouldMarkSbKwDeleted } = await Promise.resolve().then(() => (init_amazonApiErrorMapper(), amazonApiErrorMapper_exports));
                  if (shouldMarkSbKwDeleted(failReason)) {
                    await markTaskFailed2(conn, t2.id, `[v509-entity-deleted] ${failReason}`);
                    try {
                      await markKeywordDeleted(conn, t2.target_entity_id, String(t2.amazon_entity_id));
                    } catch (_) {
                    }
                  } else if (t2.retry_count >= 10) {
                    await markTaskFailed2(conn, t2.id, `[v509-max-retries] ${failReason}`);
                  } else {
                    await markTaskForRetry2(conn, t2.id, t2.retry_count, failReason);
                  }
                  result.failed++;
                } else {
                  await markTaskSynced2(conn, t2.id);
                  await updateLocalStatus(conn, "keywords", t2.target_entity_id, t2.new_value);
                  result.synced++;
                }
              }
              log92.warn(`[SyncEngine] v471: SB\u5173\u952E\u8BCD\u72B6\u6001\u540C\u6B65: \u53D1\u9001=${sbKwUpdates.length}, \u6210\u529F=${sbKwUpdates.length - sbFailedIds.size}, \u5931\u8D25=${sbFailedIds.size}, \u8DF3\u8FC7=${sbKwSkipped.length}`);
            }
          } catch (err) {
            for (const t2 of sbKwTasks) {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
            }
            result.failed += sbKwTasks.length;
          }
        }
      }
      break;
    }
    case "campaign_status": {
      for (const t2 of batch) {
        try {
          if (!t2.amazon_entity_id) {
            await markTaskFailed2(conn, t2.id, "\u7F3A\u5C11Amazon Campaign ID");
            result.failed++;
            continue;
          }
          const campTypeInfo = await getCampaignTypeById(conn, t2.target_entity_id);
          const campType = (campTypeInfo?.campaignType || "sp_manual").toLowerCase();
          const stateValue = t2.new_value === "enabled" ? "ENABLED" : "PAUSED";
          if (campType === "sb") {
            await syncService.client.updateSbCampaign(
              // @ts-ignore
              String(t2.amazon_entity_id),
              // @ts-ignore
              { state: stateValue }
            );
            log92.info(`[SyncEngine] v471: \u2705 SB\u5E7F\u544A\u6D3B\u52A8\u72B6\u6001\u540C\u6B65: ${t2.target_entity_name} \u2192 ${t2.new_value}`);
          } else if (campType === "sd") {
            await syncService.client.updateSdCampaign(
              // @ts-ignore
              String(t2.amazon_entity_id),
              // @ts-ignore
              { state: stateValue.toLowerCase() }
              // SD API使用小写state
              // @ts-ignore
            );
            log92.info(`[SyncEngine] v471: \u2705 SD\u5E7F\u544A\u6D3B\u52A8\u72B6\u6001\u540C\u6B65: ${t2.target_entity_name} \u2192 ${t2.new_value}`);
          } else {
            await syncService.client.updateSpCampaign(
              // @ts-ignore
              String(t2.amazon_entity_id),
              { state: stateValue }
              // @ts-ignore
            );
            log92.info(`[SyncEngine] \u2705 SP\u5E7F\u544A\u6D3B\u52A8\u72B6\u6001\u540C\u6B65: ${t2.target_entity_name} \u2192 ${t2.new_value}`);
          }
          await markTaskSynced2(conn, t2.id);
          await updateLocalStatus(conn, "campaigns", t2.target_entity_id, t2.new_value);
          result.synced++;
        } catch (err) {
          const errMsg = err.message;
          const { shouldMarkEntityDeleted: shouldMarkCampaignDeleted, classifyError: classifyCampaignError } = await Promise.resolve().then(() => (init_amazonApiErrorMapper(), amazonApiErrorMapper_exports));
          if (shouldMarkCampaignDeleted(errMsg)) {
            const campaignMapping = classifyCampaignError(errMsg);
            await markTaskFailed2(conn, t2.id, `[v509-${campaignMapping.code}] ${errMsg}`);
            try {
              await archiveCampaign(conn, t2.target_entity_id, String(t2.amazon_entity_id));
              log92.warn(`[SyncEngine] v509: Campaign ${t2.target_entity_name} (${t2.amazon_entity_id}) \u9519\u8BEF\u7801=${campaignMapping.code}, \u5DF2\u6807\u8BB0\u4E3Aarchived`);
            } catch (markErr) {
              log92.warn(`[SyncEngine] v509: \u6807\u8BB0Campaign archived\u5931\u8D25: ${markErr.message}`);
            }
          } else {
            await markTaskForRetry2(conn, t2.id, t2.retry_count, errMsg);
          }
          result.failed++;
          result.errors.push(`Campaign ${t2.target_entity_name}: ${errMsg}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      break;
    }
    case "adgroup_status": {
      const validAdGroupTasks = batch.filter((t2) => t2.amazon_entity_id);
      const invalidAdGroupTasks = batch.filter((t2) => !t2.amazon_entity_id);
      for (const t2 of invalidAdGroupTasks) {
        await markTaskFailed2(conn, t2.id, "\u7F3A\u5C11Amazon AdGroup ID");
        result.failed++;
      }
      if (validAdGroupTasks.length > 0) {
        const spAgTasks = [];
        const sdAgTasks = [];
        for (const t2 of validAdGroupTasks) {
          const agCampType = await getCampaignTypeByAdGroupInternalId(conn, t2.target_entity_id);
          if (agCampType === "sd") {
            sdAgTasks.push(t2);
          } else {
            spAgTasks.push(t2);
          }
        }
        if (sdAgTasks.length > 0) {
          log92.info(`[SyncEngine] v471: \u5E7F\u544A\u7EC4\u72B6\u6001\u6309\u7C7B\u578B\u5206\u7EC4: SP=${spAgTasks.length}, SD=${sdAgTasks.length}`);
        }
        if (spAgTasks.length > 0) {
          try {
            const agResult = await syncService.client.updateSpAdGroupStatus(
              spAgTasks.map((t2) => ({
                // @ts-ignore
                adGroupId: String(t2.amazon_entity_id),
                // @ts-ignore
                state: t2.new_value === "enabled" ? "enabled" : "paused"
                // @ts-ignore
              }))
            );
            const agFailedIds = /* @__PURE__ */ new Map();
            if (agResult.errors && agResult.errors.length > 0) {
              for (const err of agResult.errors) {
                agFailedIds.set(String(err.adGroupId), err.details || err.code || "API_ERROR");
              }
            }
            for (const t2 of spAgTasks) {
              const failReason = agFailedIds.get(String(t2.amazon_entity_id));
              if (failReason) {
                const { shouldMarkEntityDeleted: shouldMarkSpAgDeleted } = await Promise.resolve().then(() => (init_amazonApiErrorMapper(), amazonApiErrorMapper_exports));
                if (shouldMarkSpAgDeleted(failReason)) {
                  await markTaskFailed2(conn, t2.id, `[v509-entity-archived] ${failReason}`);
                  try {
                    await archiveAdGroup(conn, t2.target_entity_id, String(t2.amazon_entity_id));
                  } catch (_) {
                  }
                } else {
                  await markTaskForRetry2(conn, t2.id, t2.retry_count, `v509: SP AdGroup\u72B6\u6001\u66F4\u65B0\u5931\u8D25: ${failReason}`);
                }
                result.failed++;
              } else {
                await markTaskSynced2(conn, t2.id);
                await updateLocalStatus(conn, "ad_groups", t2.target_entity_id, t2.new_value);
                result.synced++;
                log92.info(`[SyncEngine] \u2705 SP\u5E7F\u544A\u7EC4\u72B6\u6001\u540C\u6B65: ${t2.target_entity_name} \u2192 ${t2.new_value}`);
              }
            }
            log92.warn(`[SyncEngine] v471: SP\u5E7F\u544A\u7EC4\u72B6\u6001\u540C\u6B65: \u53D1\u9001=${spAgTasks.length}, \u6210\u529F=${spAgTasks.length - agFailedIds.size}, \u5931\u8D25=${agFailedIds.size}`);
          } catch (err) {
            for (const t2 of spAgTasks) {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
            }
            result.failed += spAgTasks.length;
          }
        }
        if (sdAgTasks.length > 0) {
          try {
            const sdAgResult = await syncService.client.updateSdAdGroupStatus(
              sdAgTasks.map((t2) => ({
                // @ts-ignore
                adGroupId: String(t2.amazon_entity_id),
                // @ts-ignore
                state: t2.new_value === "enabled" ? "enabled" : "paused"
              }))
            );
            const sdAgFailedIds = /* @__PURE__ */ new Map();
            if (sdAgResult.errors && sdAgResult.errors.length > 0) {
              for (const err of sdAgResult.errors) {
                sdAgFailedIds.set(String(err.adGroupId), err.details || err.code || "API_ERROR");
              }
            }
            for (const t2 of sdAgTasks) {
              const failReason = sdAgFailedIds.get(String(t2.amazon_entity_id));
              if (failReason) {
                const { shouldMarkEntityDeleted: shouldMarkSdAgDeleted } = await Promise.resolve().then(() => (init_amazonApiErrorMapper(), amazonApiErrorMapper_exports));
                if (shouldMarkSdAgDeleted(failReason)) {
                  await markTaskFailed2(conn, t2.id, `[v509-entity-archived] ${failReason}`);
                  try {
                    await archiveAdGroup(conn, t2.target_entity_id, String(t2.amazon_entity_id));
                  } catch (_) {
                  }
                } else {
                  await markTaskForRetry2(conn, t2.id, t2.retry_count, `v509: SD AdGroup\u72B6\u6001\u66F4\u65B0\u5931\u8D25: ${failReason}`);
                }
                result.failed++;
              } else {
                await markTaskSynced2(conn, t2.id);
                await updateLocalStatus(conn, "ad_groups", t2.target_entity_id, t2.new_value);
                result.synced++;
                log92.info(`[SyncEngine] v471: \u2705 SD\u5E7F\u544A\u7EC4\u72B6\u6001\u540C\u6B65: ${t2.target_entity_name} \u2192 ${t2.new_value}`);
              }
            }
            log92.warn(`[SyncEngine] v471: SD\u5E7F\u544A\u7EC4\u72B6\u6001\u540C\u6B65: \u53D1\u9001=${sdAgTasks.length}, \u6210\u529F=${sdAgTasks.length - sdAgFailedIds.size}, \u5931\u8D25=${sdAgFailedIds.size}`);
          } catch (err) {
            for (const t2 of sdAgTasks) {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
            }
            result.failed += sdAgTasks.length;
          }
        }
      }
      break;
    }
    case "negative_keyword": {
      for (const t2 of batch) {
        if (!t2.campaign_id && t2.target_entity_id) {
          try {
            const campInfo = await getCampaignIdAndType(conn, t2.target_entity_id);
            if (campInfo && campInfo.campaignId) {
              t2.campaign_id = campInfo.campaignId;
              t2.amazon_entity_id = campInfo.campaignId;
              t2._campaignType = campInfo.campaignType || "sp_manual";
            }
          } catch (lookupErr) {
          }
        } else if (t2.campaign_id && !t2._campaignType) {
          try {
            t2._campaignType = await getCampaignTypeByAmazonOrInternalId(conn, t2.campaign_id, 0);
          } catch (lookupErr) {
          }
        }
      }
      const spTasks = batch.filter((t2) => {
        const cType = (t2._campaignType || "sp_manual").toLowerCase();
        return cType.startsWith("sp") || cType === "" || !t2._campaignType;
      });
      const nonSpTasks = batch.filter((t2) => {
        const cType = (t2._campaignType || "").toLowerCase();
        return cType === "sb" || cType === "sd";
      });
      const sbNegTasks = nonSpTasks.filter((t2) => {
        const cType = (t2._campaignType || "").toLowerCase();
        return cType === "sb";
      });
      const sdNegTasks = nonSpTasks.filter((t2) => {
        const cType = (t2._campaignType || "").toLowerCase();
        return cType === "sd";
      });
      for (const t2 of sdNegTasks) {
        await markTaskFailed2(conn, t2.id, `v428: SD\u4E0D\u652F\u6301\u5426\u5B9A\u5173\u952E\u8BCD\uFF0C\u4EC5\u652F\u6301\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411`);
        result.skipped = (result.skipped || 0) + 1;
      }
      if (sbNegTasks.length > 0) {
        const sbNegValidTasks = sbNegTasks.filter((t2) => t2.campaign_id || t2.amazon_entity_id);
        if (sbNegValidTasks.length > 0) {
          try {
            for (const t2 of sbNegValidTasks) {
              if (!t2.ad_group_id && t2.target_entity_id) {
                try {
                  const agId = await getFirstAdGroupIdByCampaignId(conn, String(t2.amazon_entity_id || t2.campaign_id));
                  if (agId) t2.ad_group_id = agId;
                } catch {
                }
              }
            }
            const sbNegApiResults = await syncService.client.createSbNegativeKeywords(
              // @ts-ignore
              sbNegValidTasks.map((t2) => ({
                campaignId: String(t2.amazon_entity_id || t2.campaign_id),
                // @ts-ignore
                adGroupId: t2.ad_group_id ? String(t2.ad_group_id) : "0",
                keywordText: t2.target_entity_name,
                // @ts-ignore
                matchType: (t2.action || "").includes("exact") || (t2.action || "").includes("Exact") ? "negativeExact" : "negativePhrase"
                // @ts-ignore
              }))
            );
            const sbNegSuccessCount = Array.isArray(sbNegApiResults) ? sbNegApiResults.filter((r) => r.code === "SUCCESS" || r.negativeKeywordId).length : 0;
            if (sbNegSuccessCount > 0 || Array.isArray(sbNegApiResults) && sbNegApiResults.length > 0) {
              for (const t2 of sbNegValidTasks) {
                await markTaskSynced2(conn, t2.id);
              }
              result.synced += sbNegValidTasks.length;
              log92.info(`[SyncEngine] v428: SB\u5426\u5B9A\u8BCD\u540C\u6B65\u6210\u529F: ${sbNegValidTasks.length}\u4E2A`);
            } else {
              for (const t2 of sbNegValidTasks) {
                await markTaskForRetry2(conn, t2.id, t2.retry_count, "SB\u5426\u5B9A\u8BCDAPI\u8FD4\u56DE\u7A7A\u7ED3\u679C");
              }
              result.failed += sbNegValidTasks.length;
            }
          } catch (sbNegErr) {
            log92.warn(`[SyncEngine] v428: SB\u5426\u5B9A\u8BCDAPI\u8C03\u7528\u5931\u8D25: ${sbNegErr.message}`);
            for (const t2 of sbNegValidTasks) {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, sbNegErr.message);
            }
            result.failed += sbNegValidTasks.length;
          }
        }
        const sbNegInvalidTasks = sbNegTasks.filter((t2) => !t2.campaign_id && !t2.amazon_entity_id);
        for (const t2 of sbNegInvalidTasks) {
          await markTaskFailed2(conn, t2.id, "v428: SB\u5426\u5B9A\u8BCD\u7F3A\u5C11Amazon Campaign ID");
          result.failed++;
        }
      }
      const validTasks = spTasks.filter((t2) => t2.campaign_id || t2.amazon_entity_id);
      const invalidTasks = spTasks.filter((t2) => !t2.campaign_id && !t2.amazon_entity_id);
      for (const t2 of invalidTasks) {
        await markTaskFailed2(conn, t2.id, "\u7F3A\u5C11Amazon Campaign ID\u4E14\u65E0\u6CD5\u56DE\u586B");
        result.failed++;
      }
      if (validTasks.length > 0) {
        try {
          const negSyncResult = await syncNegativeKeywordsToAmazon(
            // @ts-ignore
            validTasks[0].account_id,
            // @ts-ignore
            validTasks.map((t2) => ({
              campaignId: String(t2.amazon_entity_id || t2.campaign_id),
              // v356: 统一使用String类型传递Amazon ID
              keywordText: t2.target_entity_name,
              // @ts-ignore
              matchType: (t2.action || "").includes("exact") || (t2.action || "").includes("Exact") ? "negativeExact" : "negativePhrase",
              level: "campaign",
              campaignType: t2._campaignType || "" // fix24-P3v3-4.1a: 传入campaignType供v577过滤
            }))
          );
          if (negSyncResult.failed === 0 && negSyncResult.success > 0) {
            for (const t2 of validTasks) {
              await markTaskSynced2(conn, t2.id);
            }
            result.synced += validTasks.length;
          } else if (negSyncResult.success > 0) {
            for (const t2 of validTasks) {
              await markTaskSynced2(conn, t2.id);
            }
            result.synced += validTasks.length;
            log92.warn(`[SyncEngine] v189: \u5426\u5B9A\u8BCD\u90E8\u5206\u6210\u529F: \u6210\u529F=${negSyncResult.success}, \u5931\u8D25=${negSyncResult.failed}`);
          } else {
            const errorStr = negSyncResult.errors.join("; ");
            const hasDuplicate = errorStr.includes("duplicate") || errorStr.includes("DUPLICATE") || errorStr.includes("duplicates in entity name");
            const hasOnlyDuplicateAndOther = negSyncResult.errors.every(
              (e) => e.includes("duplicate") || e.includes("DUPLICATE") || e.includes("duplicates in entity name") || e.includes("otherError") || e.includes("internalServerError")
            );
            if (hasDuplicate && hasOnlyDuplicateAndOther && negSyncResult.errors.length > 0) {
              log92.info(`[SyncEngine] v431: \u5426\u5B9A\u8BCDDUPLICATE/otherError\uFF0C\u89C6\u4E3A\u6210\u529F\uFF08\u5DF2\u5B58\u5728\uFF09: ${errorStr.substring(0, 200)}`);
              for (const t2 of validTasks) {
                await markTaskSynced2(conn, t2.id);
              }
              result.synced += validTasks.length;
            } else {
              for (const t2 of validTasks) {
                await markTaskForRetry2(conn, t2.id, t2.retry_count, errorStr);
              }
              result.failed += validTasks.length;
            }
          }
        } catch (err) {
          for (const t2 of validTasks) {
            await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
          }
          result.failed += validTasks.length;
        }
      }
      break;
    }
    case "new_keyword": {
      const validTasks = batch.filter((t2) => t2.ad_group_id);
      if (validTasks.length > 0) {
        try {
          const activeNewKwTasks2 = [];
          for (const t2 of validTasks) {
            const campId = t2.campaign_id;
            const adGroupId = t2.ad_group_id;
            if (campId) {
              const [campRow] = await conn.execute(
                `SELECT campaign_status, state FROM campaigns WHERE id = ? LIMIT 1`,
                [campId]
              );
              const campStatus = (campRow?.[0]?.campaign_status || campRow?.[0]?.state || "").toLowerCase();
              if (campStatus === "archived") {
                await markTaskFailed2(conn, t2.id, `[v535-archived-skip] Campaign ${campId} \u72B6\u6001\u4E3Aarchived\uFF0C\u8DF3\u8FC7\u521B\u5EFA\u5173\u952E\u8BCD`);
                result.skipped++;
                log92.warn(`[SyncEngine] v535: \u8DF3\u8FC7new_keyword\u4EFB\u52A1 - Campaign ${campId} \u5DF2\u5F52\u6863(archived)`);
                continue;
              }
            }
            if (adGroupId) {
              const [agRow] = await conn.execute(
                `SELECT ad_group_status FROM ad_groups WHERE id = ? LIMIT 1`,
                [adGroupId]
              );
              const agStatus = (agRow?.[0]?.ad_group_status || "").toLowerCase();
              if (agStatus === "archived") {
                await markTaskFailed2(conn, t2.id, `[v535-archived-skip] AdGroup ${adGroupId} \u72B6\u6001\u4E3Aarchived\uFF0C\u8DF3\u8FC7\u521B\u5EFA\u5173\u952E\u8BCD`);
                result.skipped++;
                log92.warn(`[SyncEngine] v535: \u8DF3\u8FC7new_keyword\u4EFB\u52A1 - AdGroup ${adGroupId} \u5DF2\u5F52\u6863(archived)`);
                continue;
              }
            }
            activeNewKwTasks2.push(t2);
          }
          if (activeNewKwTasks2.length === 0) break;
          const createResult = await syncService.client.createSpKeywords(
            // @ts-ignore
            activeNewKwTasks2.map((t2) => ({
              adGroupId: Number(t2.ad_group_id),
              campaignId: Number(t2.campaign_id),
              keywordText: t2.target_entity_name,
              // @ts-ignore
              matchType: t2.action.replace("create_", "") || "broad",
              // @ts-ignore
              bid: parseFloat(t2.new_value) || 0.5,
              state: "enabled"
            }))
          );
          for (let i = 0; i < activeNewKwTasks2.length; i++) {
            const t2 = activeNewKwTasks2[i];
            const created = createResult?.createdKeywords?.[i];
            if (created && created.code === "SUCCESS" && created.keywordId) {
              await markTaskSynced2(conn, t2.id);
              if (t2.target_entity_id) {
                await updateKeywordAmazonId(conn, t2.target_entity_id, String(created.keywordId), t2.account_id, t2.campaign_id);
                log92.info(`[SyncEngine] v357: keyword\u5DF2\u540C\u6B65: localId=${t2.target_entity_id}, amazonKeywordId=${created.keywordId}`);
              }
              result.synced++;
            } else {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, created?.code || "CREATE_FAILED");
              result.failed++;
            }
          }
        } catch (err) {
          for (const t2 of activeNewKwTasks) {
            await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
          }
          result.failed += activeNewKwTasks.length;
        }
      }
      break;
    }
    case "placement_adjustment": {
      for (const t2 of batch) {
        try {
          const placementType = t2.action;
          const multiplier = parseFloat(t2.new_value) || 0;
          let amazonCampaignId = t2.amazon_entity_id;
          if (!amazonCampaignId && t2.target_entity_id) {
            try {
              const campId = await getCampaignAmazonId2(conn, t2.target_entity_id);
              if (campId) {
                amazonCampaignId = campId;
                await updateTaskAmazonEntityId(conn, t2.id, campId);
              }
            } catch (lookupErr) {
              log92.warn(`[SyncEngine] v457: \u67E5\u627EAmazon campaignId\u5931\u8D25: ${lookupErr.message}`);
            }
          }
          if (amazonCampaignId) {
            const placeCampInfo = await getCampaignTypeById(conn, t2.target_entity_id);
            const placeCampType = (placeCampInfo?.campaignType || "sp_manual").toLowerCase();
            if (placeCampType === "sb") {
              const sbPredicate = placementType === "top_of_search" ? "placementTop" : placementType === "rest_of_search" ? "placementRestOfSearch" : "placementProductPage";
              await syncService.client.updateSbCampaign(
                String(amazonCampaignId),
                {
                  bidding: {
                    bidAdjustments: [{
                      predicate: sbPredicate,
                      percentage: Math.round(multiplier * 100)
                    }]
                  }
                }
              );
              log92.info(`[SyncEngine] v471: \u2705 SB\u4F4D\u7F6E\u503E\u659C\u540C\u6B65: Campaign ${amazonCampaignId}, ${sbPredicate}=${Math.round(multiplier * 100)}%`);
            } else if (placeCampType === "sd") {
              await markTaskFailed2(conn, t2.id, "v471: SD\u5E7F\u544A\u4E0D\u652F\u6301\u4F4D\u7F6E\u503E\u659C\u8C03\u6574");
              result.failed++;
              continue;
            } else {
              const v3PlacementType = placementType === "top_of_search" ? "PLACEMENT_TOP" : placementType === "rest_of_search" ? "PLACEMENT_REST_OF_SEARCH" : "PLACEMENT_PRODUCT_PAGE";
              await syncService.client.updateSpCampaign(
                String(amazonCampaignId),
                {
                  dynamicBidding: {
                    placementBidding: [{
                      placement: v3PlacementType,
                      percentage: Math.round(multiplier * 100)
                    }]
                  }
                }
              );
              log92.info(`[SyncEngine] \u2705 SP\u4F4D\u7F6E\u503E\u659C\u540C\u6B65: Campaign ${amazonCampaignId}, ${v3PlacementType}=${Math.round(multiplier * 100)}%`);
            }
            await markTaskSynced2(conn, t2.id);
            result.synced++;
          } else {
            await markTaskFailed2(conn, t2.id, "\u7F3A\u5C11Amazon Campaign ID\u4E14\u65E0\u6CD5\u56DE\u586B");
            result.failed++;
          }
        } catch (err) {
          await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
          result.failed++;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      break;
    }
    case "negative_product_target": {
      for (const t2 of batch) {
        try {
          const asin = String(t2.target_entity_name || t2.new_value || "").trim();
          const amazonCampaignId = String(t2.amazon_entity_id || "");
          if (!asin || !amazonCampaignId) {
            await markTaskFailed2(conn, t2.id, "v523: \u7F3A\u5C11ASIN\u6216Amazon Campaign ID");
            result.failed++;
            continue;
          }
          const campTypeInfo = await getCampaignTypeById(conn, t2.target_entity_id);
          const campType = (campTypeInfo?.campaignType || "sp_manual").toLowerCase();
          const apiCampType = campType.startsWith("sb") ? "sb" : campType.startsWith("sd") ? "sd" : "sp";
          const negResult = await syncNegativeProductTargetsToAmazon(
            // @ts-ignore
            t2.account_id,
            [{
              campaignId: amazonCampaignId,
              asin,
              campaignType: apiCampType,
              negativeScope: "campaign"
            }]
          );
          if (negResult.success > 0) {
            await markTaskSynced2(conn, t2.id);
            result.synced++;
            log92.info(`[SyncEngine] v523: \u2705 \u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u540C\u6B65: Campaign ${amazonCampaignId}, ASIN=${asin}`);
          } else {
            const errMsg = negResult.errors.join("; ") || "API\u8FD4\u56DE\u5931\u8D25";
            const isDuplicate = errMsg.toLowerCase().includes("duplicate") || errMsg.toLowerCase().includes("already exists");
            if (isDuplicate) {
              await markTaskSynced2(conn, t2.id);
              result.synced++;
              log92.info(`[SyncEngine] v579: \u2705 \u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u5DF2\u5B58\u5728(DUPLICATE_VALUE)\uFF0C\u89C6\u4E3A\u6210\u529F: Campaign ${amazonCampaignId}, ASIN=${asin}`);
            } else {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, `v523: ${errMsg}`);
              result.failed++;
            }
          }
        } catch (err) {
          await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
          result.failed++;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      break;
    }
    case "budget_adjustment": {
      for (const t2 of batch) {
        try {
          let amazonCampaignId = t2.amazon_entity_id;
          let campaignType = "sp_manual";
          if (!amazonCampaignId && t2.target_entity_id) {
            try {
              const campInfo = await getCampaignIdAndType(conn, t2.target_entity_id);
              if (campInfo && campInfo.campaignId) {
                amazonCampaignId = campInfo.campaignId;
                campaignType = campInfo.campaignType || "sp_manual";
                await updateTaskAmazonEntityId(conn, t2.id, amazonCampaignId);
                log92.debug(`[SyncEngine] v457: \u56DE\u586BAmazon campaignId: local=${t2.target_entity_id} -> amazon=${amazonCampaignId}`);
              }
            } catch (lookupErr) {
              log92.warn(`[SyncEngine] v457: \u67E5\u627EAmazon campaignId\u5931\u8D25: ${lookupErr.message}`);
            }
          } else if (amazonCampaignId) {
            campaignType = await getCampaignTypeByAmazonOrInternalId(conn, String(amazonCampaignId), t2.target_entity_id || 0);
          }
          if (amazonCampaignId) {
            if (campaignType.toLowerCase().startsWith("sp")) {
              try {
                let apiClient;
                try {
                  const brSyncService = await getAmazonSyncService2(t2.account_id);
                  if (brSyncService?.client?.listSpCampaignBudgetRules) apiClient = brSyncService.client;
                } catch {
                }
                const brAnalysis = await analyzeBudgetRules(t2.account_id, String(amazonCampaignId), apiClient);
                if (brAnalysis.shouldSkipBudgetAdjustment) {
                  log92.info(`[SyncEngine] v614i-fix22: Campaign ${amazonCampaignId} Budget Rules\u667A\u80FD\u534F\u540C: \u8DF3\u8FC7 \u2014 ${brAnalysis.skipReason}`);
                  await markTaskFailed2(conn, t2.id, `Budget Rules\u534F\u540C\u8DF3\u8FC7: ${brAnalysis.skipReason}`);
                  result.failed++;
                  continue;
                }
              } catch (brErr) {
                log92.warn(`[SyncEngine] v614i-fix22: Budget Rules\u5206\u6790\u5931\u8D25: ${brErr.message}\uFF0C\u7EE7\u7EED\u6267\u884C\u9884\u7B97\u8C03\u6574`);
              }
            }
            const newBudget = parseFloat(t2.new_value) || 0;
            const budgetSyncResult = await syncBudgetAdjustmentToAmazon(
              // @ts-ignore
              t2.account_id,
              String(amazonCampaignId),
              newBudget,
              // @ts-ignore
              t2.change_reason || "\u9884\u7B97\u8C03\u6574\u91CD\u8BD5",
              campaignType
            );
            if (budgetSyncResult) {
              await markTaskSynced2(conn, t2.id);
              result.synced++;
            } else {
              await markTaskForRetry2(conn, t2.id, t2.retry_count, "API\u8FD4\u56DEfalse");
              result.failed++;
            }
          } else {
            await markTaskFailed2(conn, t2.id, "\u7F3A\u5C11Amazon Campaign ID\u4E14\u65E0\u6CD5\u56DE\u586B");
            result.failed++;
          }
        } catch (err) {
          await markTaskForRetry2(conn, t2.id, t2.retry_count, err.message);
          result.failed++;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      break;
    }
    default: {
      log92.warn(`[SyncEngine] \u672A\u77E5\u4EFB\u52A1\u7C7B\u578B: ${taskType}, \u8DF3\u8FC7 ${batch.length} \u6761`);
      result.skipped = batch.length;
    }
  }
  return result;
}
async function markTaskSynced2(conn, taskId) {
  await markTaskSynced(conn, taskId);
}
async function markTaskFailed2(conn, taskId, errorMessage) {
  await markTaskFailed(conn, taskId, errorMessage);
}
async function markTasksFailed2(conn, taskIds, errorMessage) {
  await markTasksFailed(conn, taskIds, errorMessage);
}
async function markTaskForRetry2(conn, taskId, currentRetryCount, errorMessage) {
  await markTaskForRetry(conn, taskId, currentRetryCount, errorMessage);
}
async function updateLocalBid(conn, entityType, entityId, newBid) {
  if (entityType === "keyword") {
    await updateKeywordBid2(conn, entityId, newBid);
  } else if (entityType === "product_target") {
    await updateProductTargetBid2(conn, entityId, newBid);
  }
}
async function updateLocalStatus(conn, tableName, entityId, newStatus) {
  await updateEntityStatus(conn, tableName, entityId, newStatus);
}
async function updateLogsSyncStatus2(conn, batchId) {
  try {
    const stats4 = await getBatchTaskStats(conn, batchId);
    let logSyncStatus;
    if (stats4.pending + stats4.retry > 0) {
      logSyncStatus = "syncing";
    } else if (stats4.failed === 0 && stats4.synced > 0) {
      logSyncStatus = "synced";
    } else if (stats4.synced === 0 && stats4.failed > 0) {
      logSyncStatus = "failed";
    } else {
      logSyncStatus = "partial";
    }
    await updateLogsSyncStatus(conn, batchId, logSyncStatus, stats4.synced, stats4.failed, stats4.pending, stats4.retry);
    log92.warn(`[SyncEngine] \u66F4\u65B0\u65E5\u5FD7\u540C\u6B65\u72B6\u6001: batchId=${batchId}, status=${logSyncStatus}, synced=${stats4.synced}, failed=${stats4.failed}`);
  } catch (err) {
    log92.warn(`[SyncEngine] \u66F4\u65B0\u65E5\u5FD7\u540C\u6B65\u72B6\u6001\u5931\u8D25: ${err.message}`);
  }
}
async function processRetryTasks() {
  log92.debug(`[SyncEngine] v199: \u68C0\u67E5\u91CD\u8BD5\u4EFB\u52A1...`);
  await resetRecoverableFailedTasks();
  const result = await executeBatchSync();
  log92.warn(`[SyncEngine] v199: \u91CD\u8BD5\u4EFB\u52A1\u5904\u7406\u5B8C\u6210: \u603B\u8BA1=${result.totalTasks}, \u6210\u529F=${result.synced}, \u5931\u8D25=${result.failed}`);
  return {
    processed: result.totalTasks,
    synced: result.synced,
    failed: result.failed
  };
}
async function resetRecoverableFailedTasks() {
  const conn = await getDirectConnection();
  try {
    const failedTasks = await getRecoverableFailedTasks(conn);
    if (failedTasks.length === 0) return 0;
    let recovered = 0;
    for (const task of failedTasks) {
      let amazonId = null;
      if (task.target_entity_type === "keyword") {
        amazonId = await getKeywordAmazonId2(conn, task.target_entity_id, true);
      } else if (task.target_entity_type === "product_target") {
        amazonId = await getProductTargetAmazonId(conn, task.target_entity_id);
      } else if (task.target_entity_type === "campaign") {
        amazonId = await getCampaignAmazonId2(conn, task.target_entity_id);
      }
      if (amazonId) {
        await recoverTask(conn, task.id, amazonId);
        recovered++;
      }
    }
    if (recovered > 0) {
      log92.warn(`[SyncEngine] v457: \u81EA\u52A8\u6062\u590D\u4E86${recovered}/${failedTasks.length}\u4E2A\u5931\u8D25\u4EFB\u52A1`);
    }
    return recovered;
  } catch (err) {
    log92.warn(`[SyncEngine] v457: \u91CD\u7F6E\u5931\u8D25\u4EFB\u52A1\u5F02\u5E38: ${err.message}`);
    return 0;
  } finally {
    conn.release();
  }
}
async function getBatchStatus(batchId) {
  const conn = await getDirectConnection();
  try {
    const stats4 = await getBatchTaskStats(conn, batchId);
    return {
      total: stats4.synced + stats4.failed + stats4.pending + stats4.retry + stats4.permanentlyFailed,
      synced: stats4.synced,
      failed: stats4.failed,
      pending: stats4.pending,
      retry: stats4.retry,
      permanentlyFailed: stats4.permanentlyFailed
    };
  } finally {
    conn.release();
  }
}
var import_crypto4, log92, BATCH_CONFIG;
var init_optimizationSyncEngine = __esm({
  "server/sync/optimizationSyncEngine.ts"() {
    "use strict";
    init_db2();
    init_amazonApiHelper();
    import_crypto4 = require("crypto");
    init_taskLifecycle();
    init_logger();
    init_amazonBidConstraints();
    init_optSyncQueries();
    init_budgetRulesCoordinator();
    log92 = createModuleLogger("OptSyncEngine");
    BATCH_CONFIG = {
      "bid_adjustment": { maxBatchSize: 500, delayMs: 300 },
      "keyword_status": { maxBatchSize: 500, delayMs: 300 },
      "campaign_status": { maxBatchSize: 100, delayMs: 200 },
      "adgroup_status": { maxBatchSize: 100, delayMs: 200 },
      "negative_keyword": { maxBatchSize: 100, delayMs: 500 },
      "new_keyword": { maxBatchSize: 100, delayMs: 500 },
      "placement_adjustment": { maxBatchSize: 10, delayMs: 500 },
      "budget_adjustment": { maxBatchSize: 10, delayMs: 500 },
      "dayparting_adjustment": { maxBatchSize: 300, delayMs: 300 },
      "negative_product_target": { maxBatchSize: 30, delayMs: 800 }
    };
    __name(enqueueTasks, "enqueueTasks");
    __name(executeBatchSync, "executeBatchSync");
    __name(syncTasksByType, "syncTasksByType");
    __name(executeBatchByType, "executeBatchByType");
    __name(markTaskSynced2, "markTaskSynced");
    __name(markTaskFailed2, "markTaskFailed");
    __name(markTasksFailed2, "markTasksFailed");
    __name(markTaskForRetry2, "markTaskForRetry");
    __name(updateLocalBid, "updateLocalBid");
    __name(updateLocalStatus, "updateLocalStatus");
    __name(updateLogsSyncStatus2, "updateLogsSyncStatus");
    __name(processRetryTasks, "processRetryTasks");
    __name(resetRecoverableFailedTasks, "resetRecoverableFailedTasks");
    __name(getBatchStatus, "getBatchStatus");
  }
});

