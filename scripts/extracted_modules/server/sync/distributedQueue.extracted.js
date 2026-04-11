// Extracted from production dist/index.js
// Original module: server/sync/distributedQueue.ts
// Lines: 773

async function enqueueTask(task) {
  const redis = getRedis();
  const dedupKey = `${task.accountId}:${task.tier}`;
  if (redis && isRedisAvailable()) {
    try {
      const isDuplicate = await redis.sismember(QUEUE_KEYS.dedup, dedupKey);
      if (isDuplicate) {
        log79.debug(`[v580] \u8DF3\u8FC7\u91CD\u590D\u4EFB\u52A1: account=${task.accountId}, tier=${task.tier}`);
        return false;
      }
      const taskJson = JSON.stringify({
        ...task,
        createdAt: task.createdAt || (/* @__PURE__ */ new Date()).toISOString()
      });
      const queueKey = QUEUE_KEYS[task.priority] || QUEUE_KEYS.medium;
      const pipeline = redis.pipeline();
      pipeline.lpush(queueKey, taskJson);
      pipeline.sadd(QUEUE_KEYS.dedup, dedupKey);
      pipeline.expire(QUEUE_KEYS.dedup, 4 * 60 * 60);
      await pipeline.exec();
      log79.info(`[v619] \u4EFB\u52A1\u5DF2\u5165\u961FRedis: id=${task.id}, account=${task.accountId}, tier=${task.tier}, priority=${task.priority}`);
      return true;  // v619: Redis enqueue succeeded, skip MySQL dual-write
    } catch (e) {
      log79.warn(`[v619] Redis\u5165\u961F\u5931\u8D25\uFF0C\u964D\u7EA7\u5230MySQL: ${e.message}`);
    }
  }
  // v619: Only reach MySQL fallback if Redis is unavailable or enqueue failed
  try {
    const conn = await getDirectConnection(1e4);
    try {
      await conn.execute(
        `INSERT INTO sync_task_queue (accountId, syncType, priority, status, triggerSource, payload, maxRetries, createdAt)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE status='queued', updatedAt=NOW()`,
        [
          task.accountId,
          task.syncType || task.tier,
          task.priority === "high" ? 10 : task.priority === "medium" ? 5 : 1,
          task.triggerSource || "auto",
          JSON.stringify(task.payload || {}),
          task.maxRetries || 3
        ]
      );
      log79.info(`[v619] \u4EFB\u52A1\u5DF2\u5165\u961FMySQL(\u964D\u7EA7): account=${task.accountId}, tier=${task.tier}`);
    } finally {
      conn.release();
    }
  } catch (e) {
    log79.warn(`[v619] MySQL\u964D\u7EA7\u5165\u961F\u4E5F\u5931\u8D25: ${e.message}`);
    return false;
  }
  return true;
}
async function enqueueBatch(tasks) {
  let enqueued = 0;
  let skipped = 0;
  for (const task of tasks) {
    const result = await enqueueTask(task);
    if (result) {
      enqueued++;
    } else {
      skipped++;
    }
  }
  if (enqueued > 0) {
    log79.info(`[v580] \u6279\u91CF\u5165\u961F\u5B8C\u6210: ${enqueued}\u4E2A\u5165\u961F, ${skipped}\u4E2A\u8DF3\u8FC7(\u53BB\u91CD)`);
  }
  return { enqueued, skipped };
}
async function dequeueTask() {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) {
    return dequeueMySQLFallback();
  }
  try {
    const priorityOrder = [QUEUE_KEYS.high, QUEUE_KEYS.medium, QUEUE_KEYS.low, QUEUE_KEYS.nightly];
    for (const queueKey of priorityOrder) {
      const taskJson = await redis.rpop(queueKey);
      if (taskJson) {
        const task = JSON.parse(taskJson);
        // v619: Check account lock before processing to prevent concurrent sync of same account
        const lockKey = ACCOUNT_LOCK_PREFIX + task.accountId;
        const existingLock = await redis.get(lockKey);
        if (existingLock && existingLock !== WORKER_ID) {
          // Another worker is processing this account, re-queue with delay
          await redis.lpush(queueKey, taskJson);
          log79.info(`[v619] \u8D26\u6237${task.accountId}\u5DF2\u88AB\u5176\u4ED6Worker\u9501\u5B9A\uFF0C\u91CD\u65B0\u5165\u961F`);
          continue;
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const processingData = {
          ...task,
          startedAt: now,
          status: "processing",
          workerId: WORKER_ID
        };
        await redis.hset(QUEUE_KEYS.processing, task.id, JSON.stringify(processingData));
        // v619: Acquire account lock
        await redis.set(lockKey, WORKER_ID, "EX", ACCOUNT_LOCK_TTL);
        log79.info(`[v619] \u4EFB\u52A1\u5DF2\u51FA\u961F: id=${task.id}, account=${task.accountId}, tier=${task.tier}, priority=${task.priority}, worker=${WORKER_ID}`);
        return task;
      }
    }
  } catch (e) {
    log79.warn(`[v580] Redis\u51FA\u961F\u5931\u8D25: ${e.message}`);
    return dequeueMySQLFallback();
  }
  return null;
}
async function dequeueMySQLFallback() {
  try {
    const conn = await getDirectConnection(1e4);
    try {
      const [rows] = await conn.execute(
        "SELECT * FROM sync_task_queue WHERE status='queued' ORDER BY priority DESC, createdAt ASC LIMIT 1"
      );
      const tasks = rows;
      if (tasks.length === 0) return null;
      const row = tasks[0];
      await conn.execute(
        "UPDATE sync_task_queue SET status='processing', startedAt=NOW(), lockedBy=? WHERE id=? AND status='queued'",
        [WORKER_ID, row.id]
      );
      return {
        id: `mysql-${row.id}`,
        accountId: row.accountId,
        syncType: row.syncType,
        priority: row.priority >= 10 ? "high" : row.priority >= 5 ? "medium" : "low",
        tier: row.syncType,
        triggerSource: row.triggerSource || "auto",
        retryCount: row.retryCount || 0,
        createdAt: row.createdAt?.toISOString()
      };
    } finally {
      conn.release();
    }
  } catch (e) {
    log79.warn(`[v580] MySQL\u964D\u7EA7\u51FA\u961F\u5931\u8D25: ${e.message}`);
    return null;
  }
}
async function completeTask(taskId, accountId, tier2) {
  const redis = getRedis();
  if (redis && isRedisAvailable()) {
    try {
      const pipeline = redis.pipeline();
      pipeline.hdel(QUEUE_KEYS.processing, taskId);
      pipeline.hdel(QUEUE_KEYS.checkpoints, taskId);
      if (accountId && tier2) {
        pipeline.srem(QUEUE_KEYS.dedup, `${accountId}:${tier2}`);
      }
      // v619: Release account lock on task completion
      if (accountId) {
        pipeline.del(ACCOUNT_LOCK_PREFIX + accountId);
      }
      await pipeline.exec();
      if (accountId) {
        log79.info(`[v619] \u4EFB\u52A1\u5B8C\u6210\u5E76\u91CA\u653E\u8D26\u6237\u9501: task=${taskId}, account=${accountId}`);
      }
    } catch (e) {
      log79.warn(`[v619] Redis\u5B8C\u6210\u4EFB\u52A1\u6E05\u7406\u5931\u8D25: ${e.message}`);
    }
  }
  if (taskId.startsWith("mysql-")) {
    try {
      const mysqlId = taskId.replace("mysql-", "");
      const conn = await getDirectConnection(1e4);
      try {
        await conn.execute(
          "UPDATE sync_task_queue SET status='completed', completedAt=NOW() WHERE id=?",
          [mysqlId]
        );
      } finally {
        conn.release();
      }
    } catch (e) {
    }
  }
}
async function failTask(taskId, error48, task) {
  const redis = getRedis();
  if (redis && isRedisAvailable()) {
    try {
      await redis.hdel(QUEUE_KEYS.processing, taskId);
      if (task) {
        const retryCount = (task.retryCount || 0) + 1;
        const maxRetries = task.maxRetries || 3;
        if (retryCount < maxRetries) {
          const retryTask = {
            ...task,
            retryCount,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          const retryQueueKey = QUEUE_KEYS.low;
          await redis.lpush(retryQueueKey, JSON.stringify(retryTask));
          log79.info(`[v580] \u4EFB\u52A1\u91CD\u8BD5\u5165\u961F: id=${taskId}, retry=${retryCount}/${maxRetries}`);
        } else {
          await redis.srem(QUEUE_KEYS.dedup, `${task.accountId}:${task.tier}`);
          await redis.hdel(QUEUE_KEYS.checkpoints, taskId);
          // v619: Release account lock on final failure
          await redis.del(ACCOUNT_LOCK_PREFIX + task.accountId);
          log79.warn(`[v619] \u4EFB\u52A1\u8D85\u8FC7\u6700\u5927\u91CD\u8BD5\u6B21\u6570\u5E76\u91CA\u653E\u8D26\u6237\u9501: id=${taskId}, retries=${retryCount}, account=${task.accountId}`);
        }
      }
    } catch (e) {
      log79.warn(`[v580] Redis\u5931\u8D25\u4EFB\u52A1\u5904\u7406\u5F02\u5E38: ${e.message}`);
    }
  }
  if (taskId.startsWith("mysql-")) {
    try {
      const mysqlId = taskId.replace("mysql-", "");
      const conn = await getDirectConnection(1e4);
      try {
        await conn.execute(
          "UPDATE sync_task_queue SET status='failed', lastError=?, retryCount=retryCount+1 WHERE id=?",
          [error48.substring(0, 500), mysqlId]
        );
      } finally {
        conn.release();
      }
    } catch (e) {
    }
  }
}
async function saveTaskCheckpoint(checkpoint) {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return false;
  try {
    const checkpointJson = JSON.stringify({
      ...checkpoint,
      savedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const pipeline = redis.pipeline();
    pipeline.hset(QUEUE_KEYS.checkpoints, checkpoint.taskId, checkpointJson);
    pipeline.expire(QUEUE_KEYS.checkpoints, 24 * 60 * 60);
    await pipeline.exec();
    log79.debug(`[v580] \u68C0\u67E5\u70B9\u5DF2\u4FDD\u5B58: task=${checkpoint.taskId}, step=${checkpoint.currentStepIndex}/${checkpoint.totalSteps}, synced=${checkpoint.totalSynced}`);
    return true;
  } catch (e) {
    log79.warn(`[v580] \u4FDD\u5B58\u68C0\u67E5\u70B9\u5931\u8D25: ${e.message}`);
    return false;
  }
}
async function loadTaskCheckpoint(taskId) {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return null;
  try {
    const checkpointJson = await redis.hget(QUEUE_KEYS.checkpoints, taskId);
    if (!checkpointJson) return null;
    const checkpoint = JSON.parse(checkpointJson);
    const savedAt = new Date(checkpoint.savedAt).getTime();
    if (Date.now() - savedAt > 4 * 60 * 60 * 1e3) {
      log79.info(`[v580] \u68C0\u67E5\u70B9\u5DF2\u8FC7\u671F(>4h): task=${taskId}`);
      await redis.hdel(QUEUE_KEYS.checkpoints, taskId);
      return null;
    }
    log79.info(`[v580] \u68C0\u67E5\u70B9\u5DF2\u52A0\u8F7D: task=${taskId}, completedSteps=${checkpoint.completedStepIds.length}, step=${checkpoint.currentStepIndex}/${checkpoint.totalSteps}`);
    return checkpoint;
  } catch (e) {
    log79.warn(`[v580] \u52A0\u8F7D\u68C0\u67E5\u70B9\u5931\u8D25: ${e.message}`);
    return null;
  }
}
async function getQueueStatus() {
  const status = { high: 0, medium: 0, low: 0, nightly: 0, processing: 0, checkpoints: 0, dedup: 0 };
  const redis = getRedis();
  if (redis && isRedisAvailable()) {
    try {
      const pipeline = redis.pipeline();
      pipeline.llen(QUEUE_KEYS.high);
      pipeline.llen(QUEUE_KEYS.medium);
      pipeline.llen(QUEUE_KEYS.low);
      pipeline.llen(QUEUE_KEYS.nightly);
      pipeline.hlen(QUEUE_KEYS.processing);
      pipeline.hlen(QUEUE_KEYS.checkpoints);
      pipeline.scard(QUEUE_KEYS.dedup);
      const results = await pipeline.exec();
      if (results) {
        status.high = results[0]?.[1] || 0;
        status.medium = results[1]?.[1] || 0;
        status.low = results[2]?.[1] || 0;
        status.nightly = results[3]?.[1] || 0;
        status.processing = results[4]?.[1] || 0;
        status.checkpoints = results[5]?.[1] || 0;
        status.dedup = results[6]?.[1] || 0;
      }
    } catch (e) {
    }
  }
  return status;
}
async function recoverInterruptedTasks(maxAgeMs = 3 * 60 * 1e3) {  // v619: reduced from 5min to 3min for faster recovery
  const result = { recovered: 0, withCheckpoint: 0, expired: 0, details: [] };
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return result;
  try {
    const all3 = await redis.hgetall(QUEUE_KEYS.processing);
    const now = Date.now();
    for (const [taskId, taskJson] of Object.entries(all3)) {
      try {
        const task = JSON.parse(taskJson);
        const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : 0;
        const age = now - startedAt;
        if (age < maxAgeMs) {
          continue;
        }
        const checkpoint = await loadTaskCheckpoint(taskId);
        const hasCheckpoint = checkpoint !== null && checkpoint.completedStepIds.length > 0;
        const retryCount = (task.retryCount || 0) + 1;
        const maxRetries = task.maxRetries || 3;
        if (retryCount > maxRetries) {
          await redis.hdel(QUEUE_KEYS.processing, taskId);
          await redis.hdel(QUEUE_KEYS.checkpoints, taskId);
          await redis.srem(QUEUE_KEYS.dedup, `${task.accountId}:${task.tier}`);
          result.expired++;
          result.details.push(`Task ${taskId} (account=${task.accountId}) \u8D85\u8FC7\u6700\u5927\u91CD\u8BD5${maxRetries}\u6B21\uFF0C\u5DF2\u653E\u5F03`);
          continue;
        }
        const recoveryTask = {
          ...task,
          retryCount,
          triggerSource: "recovery",
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await redis.lpush(QUEUE_KEYS.high, JSON.stringify(recoveryTask));
        await redis.hdel(QUEUE_KEYS.processing, taskId);
        result.recovered++;
        if (hasCheckpoint) {
          result.withCheckpoint++;
          result.details.push(
            `Task ${taskId} (account=${task.accountId}, tier=${task.tier}) \u5DF2\u6062\u590D(retry=${retryCount}), \u68C0\u67E5\u70B9: ${checkpoint.completedStepIds.length}/${checkpoint.totalSteps}\u6B65\u5DF2\u5B8C\u6210`
          );
        } else {
          result.details.push(
            `Task ${taskId} (account=${task.accountId}, tier=${task.tier}) \u5DF2\u6062\u590D(retry=${retryCount}), \u65E0\u68C0\u67E5\u70B9\u5C06\u4ECE\u5934\u6267\u884C`
          );
        }
      } catch (parseErr) {
        await redis.hdel(QUEUE_KEYS.processing, taskId);
        result.details.push(`Task ${taskId} \u6570\u636E\u635F\u574F\u5DF2\u6E05\u7406: ${parseErr.message}`);
      }
    }
    if (result.recovered > 0 || result.expired > 0) {
      log79.info(
        `[v580] \u4E2D\u65AD\u4EFB\u52A1\u6062\u590D\u5B8C\u6210: ${result.recovered}\u4E2A\u5DF2\u6062\u590D(${result.withCheckpoint}\u4E2A\u6709\u68C0\u67E5\u70B9), ${result.expired}\u4E2A\u5DF2\u653E\u5F03`
      );
    }
  } catch (e) {
    log79.warn(`[v580] \u4E2D\u65AD\u4EFB\u52A1\u6062\u590D\u5931\u8D25: ${e.message}`);
  }
  return result;
}
async function cleanupStuckTasks(maxAgeMs = 20 * 60 * 1e3) {  // v619: reduced from 30min to 20min
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return 0;
  try {
    const all3 = await redis.hgetall(QUEUE_KEYS.processing);
    let cleaned = 0;
    for (const [taskId, taskJson] of Object.entries(all3)) {
      try {
        const task = JSON.parse(taskJson);
        const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : 0;
        if (Date.now() - startedAt > maxAgeMs) {
          const retryCount = (task.retryCount || 0) + 1;
          if (retryCount <= (task.maxRetries || 3)) {
            await redis.lpush(QUEUE_KEYS.low, JSON.stringify({
              ...task,
              retryCount,
              triggerSource: "recovery",
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            }));
          } else {
            await redis.srem(QUEUE_KEYS.dedup, `${task.accountId}:${task.tier}`);
            await redis.hdel(QUEUE_KEYS.checkpoints, taskId);
          }
          await redis.hdel(QUEUE_KEYS.processing, taskId);
          cleaned++;
        }
      } catch {
        await redis.hdel(QUEUE_KEYS.processing, taskId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log79.info(`[v580] \u6E05\u7406\u4E86 ${cleaned} \u4E2A\u5361\u4F4F\u7684\u4EFB\u52A1`);
    }
    return cleaned;
  } catch (e) {
    log79.warn(`[v580] \u6E05\u7406\u5361\u4F4F\u4EFB\u52A1\u5931\u8D25: ${e.message}`);
    return 0;
  }
}
async function updateTaskHeartbeat(taskId, update) {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return;
  try {
    const existing = await redis.hget(QUEUE_KEYS.processing, taskId);
    if (existing) {
      const task = JSON.parse(existing);
      const updated = {
        ...task,
        ...update,
        lastHeartbeat: (/* @__PURE__ */ new Date()).toISOString()
      };
      await redis.hset(QUEUE_KEYS.processing, taskId, JSON.stringify(updated));
    }
  } catch (e) {
  }
}
async function persistProcessingTasks() {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return 0;
  try {
    const all3 = await redis.hgetall(QUEUE_KEYS.processing);
    let persisted = 0;
    for (const [taskId, taskJson] of Object.entries(all3)) {
      try {
        const task = JSON.parse(taskJson);
        task.interruptedAt = (/* @__PURE__ */ new Date()).toISOString();
        task.interruptReason = "shutdown";
        await redis.hset(QUEUE_KEYS.processing, taskId, JSON.stringify(task));
        persisted++;
      } catch {
      }
    }
    if (persisted > 0) {
      log79.info(`[v580] SIGTERM: \u5DF2\u6301\u4E45\u5316 ${persisted} \u4E2A\u5904\u7406\u4E2D\u4EFB\u52A1\u7684\u72B6\u6001`);
    }
    return persisted;
  } catch (e) {
    log79.warn(`[v580] \u6301\u4E45\u5316\u5904\u7406\u4E2D\u4EFB\u52A1\u5931\u8D25: ${e.message}`);
    return 0;
  }
}
async function createShards(taskId, totalRecords, shardSize = 5e3) {
  const shards = [];
  for (let i = 0; i < totalRecords; i += shardSize) {
    shards.push({
      shardId: `${taskId}_shard_${Math.floor(i / shardSize)}`,
      taskId,
      startIndex: i,
      endIndex: Math.min(i + shardSize, totalRecords),
      status: "pending",
      processedCount: 0,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  const redis = getRedis();
  if (redis && isRedisAvailable()) {
    try {
      const pipeline = redis.pipeline();
      for (const shard of shards) {
        pipeline.hset(SHARD_PREFIX + taskId, shard.shardId, JSON.stringify(shard));
      }
      pipeline.expire(SHARD_PREFIX + taskId, 24 * 60 * 60);
      await pipeline.exec();
    } catch (e) {
      log79.warn(`Redis shard creation failed: ${e.message}`);
    }
  }
  try {
    const conn = await getDirectConnection(1e4);
    try {
      for (const shard of shards) {
        await conn.execute(
          `INSERT INTO sync_shards (shard_id, task_id, start_index, end_index, status, processed_count, updated_at)
           VALUES (?, ?, ?, ?, 'pending', 0, NOW())
           ON DUPLICATE KEY UPDATE status='pending', processed_count=0, updated_at=NOW()`,
          [shard.shardId, shard.taskId, shard.startIndex, shard.endIndex]
        );
      }
    } finally {
      conn.release();
    }
  } catch (e) {
    log79.warn(`MySQL shard creation failed: ${e.message}`);
  }
  return shards;
}
async function updateShardStatus(taskId, shardId, status, processedCount) {
  const redis = getRedis();
  if (redis && isRedisAvailable()) {
    try {
      const existing = await redis.hget(SHARD_PREFIX + taskId, shardId);
      if (existing) {
        const shard = JSON.parse(existing);
        shard.status = status;
        shard.processedCount = processedCount;
        shard.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await redis.hset(SHARD_PREFIX + taskId, shardId, JSON.stringify(shard));
      }
    } catch (e) {
    }
  }
  try {
    const conn = await getDirectConnection(1e4);
    try {
      await conn.execute(
        `UPDATE sync_shards SET status=?, processed_count=?, updated_at=NOW() WHERE shard_id=? AND task_id=?`,
        [status, processedCount, shardId, taskId]
      );
    } finally {
      conn.release();
    }
  } catch (e) {
  }
}
async function getCompletedShards(taskId) {
  const completed = /* @__PURE__ */ new Set();
  const redis = getRedis();
  if (redis && isRedisAvailable()) {
    try {
      const all3 = await redis.hgetall(SHARD_PREFIX + taskId);
      for (const [shardId, json3] of Object.entries(all3)) {
        const shard = JSON.parse(json3);
        if (shard.status === "completed") {
          completed.add(shardId);
        }
      }
      if (completed.size > 0) return completed;
    } catch (e) {
    }
  }
  try {
    const conn = await getDirectConnection(1e4);
    try {
      const [rows] = await conn.execute(
        `SELECT shard_id FROM sync_shards WHERE task_id=? AND status='completed'`,
        [taskId]
      );
      for (const row of rows) {
        completed.add(row.shard_id);
      }
    } finally {
      conn.release();
    }
  } catch (e) {
  }
  return completed;
}
function getWorkerId() {
  return WORKER_ID;
}
async function registerWorker() {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return;
  try {
    const info = {
      workerId: WORKER_ID,
      hostname: import_os.default.hostname(),
      pid: process.pid,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    };
    await redis.setex(WORKER_PREFIX + WORKER_ID, WORKER_TTL, JSON.stringify(info));
    log79.info(`Worker registered: ${WORKER_ID}`);
  } catch (e) {
    log79.warn(`Worker registration failed: ${e.message}`);
  }
}
async function heartbeat() {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return;
  try {
    const key = WORKER_PREFIX + WORKER_ID;
    const existing = await redis.get(key);
    if (existing) {
      const info = JSON.parse(existing);
      info.lastHeartbeat = (/* @__PURE__ */ new Date()).toISOString();
      info.memoryMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      await redis.setex(key, WORKER_TTL, JSON.stringify(info));
    }
  } catch (e) {
  }
}
async function getActiveWorkers() {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) {
    return [{ workerId: WORKER_ID, isSelf: true }];
  }
  try {
    const keys = await redis.keys(WORKER_PREFIX + "*");
    const workers = [];
    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const info = JSON.parse(data);
        workers.push({ workerId: info.workerId, isSelf: info.workerId === WORKER_ID });
      }
    }
    return workers;
  } catch (e) {
    return [{ workerId: WORKER_ID, isSelf: true }];
  }
}
async function acquireAccountLock(accountId) {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return { acquired: true };
  try {
    const key = ACCOUNT_LOCK_PREFIX + accountId;
    const result = await redis.set(key, WORKER_ID, "EX", ACCOUNT_LOCK_TTL, "NX");
    if (result === "OK") {
      return { acquired: true };
    }
    const holder = await redis.get(key) || "unknown";
    return { acquired: false, holder };
  } catch (e) {
    return { acquired: true };
  }
}
async function releaseAccountLock(accountId) {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return;
  try {
    const key = ACCOUNT_LOCK_PREFIX + accountId;
    const holder = await redis.get(key);
    if (holder === WORKER_ID) {
      await redis.del(key);
    }
  } catch (e) {
  }
}
async function renewAccountLock(accountId) {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return false;
  try {
    const key = ACCOUNT_LOCK_PREFIX + accountId;
    const holder = await redis.get(key);
    if (holder !== WORKER_ID) {
      return false;
    }
    await redis.expire(key, ACCOUNT_LOCK_TTL);
    return true;
  } catch (e) {
    return false;
  }
}
async function startWorkerLifecycle() {
  await registerWorker();
  heartbeatTimer2 = setInterval(() => {
    heartbeat().catch(() => {
    });
  }, 3e4);
  metricsTimer = setInterval(async () => {
    try {
      const status = await getQueueStatus();
      const total = status.high + status.medium + status.low + status.nightly;
      if (total > 0 || status.processing > 0) {
        log79.info(`[v580] Queue: high=${status.high} medium=${status.medium} low=${status.low} nightly=${status.nightly} processing=${status.processing} checkpoints=${status.checkpoints}`);
      }
    } catch (e) {
    }
  }, 6e4);
  log79.info(`[v580] Worker lifecycle started: ${WORKER_ID}`);
}
function stopWorkerLifecycle() {
  if (heartbeatTimer2) {
    clearInterval(heartbeatTimer2);
    heartbeatTimer2 = null;
  }
  if (metricsTimer) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }
}
async function clearStaleAccountLocks() {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return 0;
  try {
    const pattern = ACCOUNT_LOCK_PREFIX + "*";
    let cursor = "0";
    let cleared = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      for (const key of keys) {
        const holder = await redis.get(key);
        if (holder) {
          await redis.del(key);
          cleared++;
        }
      }
    } while (cursor !== "0");
    if (cleared > 0) {
      log79.info(`[v580] \u542F\u52A8\u65F6\u6E05\u7406\u4E86 ${cleared} \u4E2A\u65E7\u8D26\u6237\u9501`);
    }
    return cleared;
  } catch (e) {
    log79.warn(`[v580] \u6E05\u7406\u65E7\u9501\u5931\u8D25: ${e.message}`);
    return 0;
  }
}
async function releaseAllMyLocks() {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return;
  try {
    const pattern = ACCOUNT_LOCK_PREFIX + "*";
    let cursor = "0";
    let released = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      for (const key of keys) {
        const holder = await redis.get(key);
        if (holder === WORKER_ID) {
          await redis.del(key);
          released++;
        }
      }
    } while (cursor !== "0");
    if (released > 0) {
      log79.info(`[v580] SIGTERM: \u91CA\u653E\u4E86 ${released} \u4E2A\u8D26\u6237\u9501`);
    }
  } catch (e) {
  }
}
var import_os, log79, QUEUE_KEYS, SHARD_PREFIX, WORKER_PREFIX, ACCOUNT_LOCK_PREFIX, WORKER_TTL, ACCOUNT_LOCK_TTL, WORKER_ID, heartbeatTimer2, metricsTimer;
var init_distributedQueue = __esm({
  "server/sync/distributedQueue.ts"() {
    "use strict";
    init_redisClient();
    init_connection();
    init_logger();
    import_os = __toESM(require("os"));
    log79 = createModuleLogger("DistributedQueue");
    QUEUE_KEYS = {
      high: "sync:queue:high",
      medium: "sync:queue:medium",
      low: "sync:queue:low",
      nightly: "sync:queue:nightly",
      processing: "sync:processing",
      checkpoints: "sync:checkpoints",
      dedup: "sync:dedup",
      metrics: "sync:metrics"
    };
    SHARD_PREFIX = "sync:shards:";
    WORKER_PREFIX = "sync:worker:";
    ACCOUNT_LOCK_PREFIX = "sync:account:lock:";
    WORKER_TTL = 120;
    ACCOUNT_LOCK_TTL = 300;
    __name(enqueueTask, "enqueueTask");
    __name(enqueueBatch, "enqueueBatch");
    __name(dequeueTask, "dequeueTask");
    __name(dequeueMySQLFallback, "dequeueMySQLFallback");
    __name(completeTask, "completeTask");
    __name(failTask, "failTask");
    __name(saveTaskCheckpoint, "saveTaskCheckpoint");
    __name(loadTaskCheckpoint, "loadTaskCheckpoint");
    __name(getQueueStatus, "getQueueStatus");
    __name(recoverInterruptedTasks, "recoverInterruptedTasks");
    __name(cleanupStuckTasks, "cleanupStuckTasks");
    __name(updateTaskHeartbeat, "updateTaskHeartbeat");
    __name(persistProcessingTasks, "persistProcessingTasks");
    __name(createShards, "createShards");
    __name(updateShardStatus, "updateShardStatus");
    __name(getCompletedShards, "getCompletedShards");
    WORKER_ID = `worker-${import_os.default.hostname()}-${process.pid}-${Date.now().toString(36)}`;
    __name(getWorkerId, "getWorkerId");
    __name(registerWorker, "registerWorker");
    __name(heartbeat, "heartbeat");
    __name(getActiveWorkers, "getActiveWorkers");
    __name(acquireAccountLock, "acquireAccountLock");
    __name(releaseAccountLock, "releaseAccountLock");
    __name(renewAccountLock, "renewAccountLock");
    heartbeatTimer2 = null;
    metricsTimer = null;
    __name(startWorkerLifecycle, "startWorkerLifecycle");
    __name(stopWorkerLifecycle, "stopWorkerLifecycle");
    __name(clearStaleAccountLocks, "clearStaleAccountLocks");
    __name(releaseAllMyLocks, "releaseAllMyLocks");
  }
});

