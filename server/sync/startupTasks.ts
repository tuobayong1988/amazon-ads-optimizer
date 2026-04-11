/**
 * server/sync/startupTasks.ts
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */

import { campaigns, keywords } from '../../drizzle/schema';

async function zombieCleanup() {
  try {
    const conn = await getDirectConnection(3e4);
    try {
      let totalZombies = 0;
      for (let batch = 0; batch < 10; batch++) {
        const [r] = await conn.execute(
          "UPDATE data_sync_jobs SET status='failed', errorMessage=CONCAT(COALESCE(errorMessage,''),' [v614i-fix9] zombie cleanup: stale >2h') WHERE status='running' AND startedAt < DATE_SUB(NOW(), INTERVAL 2 HOUR) LIMIT 50"
        );
        const affected = r.affectedRows;
        totalZombies += affected;
        if (affected === 0) break;
      }
      if (totalZombies > 0) {
        log214.info(`Zombie cleanup: ${totalZombies} running tasks marked failed (batched)`);
      }
    } finally {
      conn.release();
    }
    const conn2 = await getDirectConnection(3e4);
    try {
      let totalBackfilled = 0;
      for (let batch = 0; batch < 10; batch++) {
        const [r] = await conn2.execute(
          "UPDATE optimization_events SET previous_value=CONCAT('$',previous_bid), new_value=CONCAT('$',new_bid) WHERE (previous_value IS NULL OR new_value IS NULL) AND previous_bid IS NOT NULL AND new_bid IS NOT NULL AND event_category='bid_adjustment' AND created_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY) LIMIT 200"
        );
        const affected = r.affectedRows;
        totalBackfilled += affected;
        if (affected === 0) break;
      }
      if (totalBackfilled > 0) {
        log214.info(`Backfill: ${totalBackfilled} events updated with bid values (batched)`);
      }
    } finally {
      conn2.release();
    }
  } catch (e) {
    log214.warn(`Zombie cleanup error: ${e.message}`);
  }
}
async function reconcile() {
  try {
    const conn = await getDirectConnection(3e4);
    try {
      let kwMatched = 0, kwMismatched = 0, kwTimeout = 0;
      let ptMatched = 0, ptMismatched = 0;
      let campReconciled = 0;
      const [kwRows] = await conn.execute(
        "SELECT k.id, k.bid, k.amazonBid, k.bid_sync_status FROM keywords k WHERE k.bid_sync_status='pending_confirmation' ORDER BY k.updatedAt ASC LIMIT 500"
      );
      const kwMatchedIds = [];
      const kwMismatchedIds = [];
      for (const kw of kwRows) {
        if (kw.bid !== null && kw.amazonBid !== null) {
          const bidMatch = Math.abs(parseFloat(kw.bid) - parseFloat(kw.amazonBid)) < 1e-3;
          if (bidMatch) {
            kwMatchedIds.push(kw.id);
          } else {
            kwMismatchedIds.push(kw.id);
          }
        }
      }
      if (kwMatchedIds.length > 0) {
        const placeholders = kwMatchedIds.map(() => "?").join(",");
        await conn.execute(`UPDATE keywords SET bid_sync_status='synced' WHERE id IN (${placeholders})`, kwMatchedIds);
        kwMatched = kwMatchedIds.length;
      }
      if (kwMismatchedIds.length > 0) {
        const placeholders = kwMismatchedIds.map(() => "?").join(",");
        await conn.execute(`UPDATE keywords SET bid_sync_status='retry_pending' WHERE id IN (${placeholders})`, kwMismatchedIds);
        kwMismatched = kwMismatchedIds.length;
      }
      const [staleKw] = await conn.execute(
        "UPDATE keywords SET bid_sync_status='retry_pending' WHERE bid_sync_status='pending_confirmation' AND updatedAt < DATE_SUB(NOW(), INTERVAL 1 HOUR) LIMIT 200"
      );
      kwTimeout = staleKw.affectedRows;
      const [ptRows] = await conn.execute(
        "SELECT pt.id, pt.bid, pt.amazonBid, pt.bid_sync_status FROM product_targets pt WHERE pt.bid_sync_status='pending_confirmation' ORDER BY pt.updatedAt ASC LIMIT 500"
      );
      const ptMatchedIds = [];
      const ptMismatchedIds = [];
      for (const pt of ptRows) {
        if (pt.bid !== null && pt.amazonBid !== null) {
          const bidMatch = Math.abs(parseFloat(pt.bid) - parseFloat(pt.amazonBid)) < 1e-3;
          if (bidMatch) {
            ptMatchedIds.push(pt.id);
          } else {
            ptMismatchedIds.push(pt.id);
          }
        }
      }
      if (ptMatchedIds.length > 0) {
        const placeholders = ptMatchedIds.map(() => "?").join(",");
        await conn.execute(`UPDATE product_targets SET bid_sync_status='synced' WHERE id IN (${placeholders})`, ptMatchedIds);
        ptMatched = ptMatchedIds.length;
      }
      if (ptMismatchedIds.length > 0) {
        const placeholders = ptMismatchedIds.map(() => "?").join(",");
        await conn.execute(`UPDATE product_targets SET bid_sync_status='retry_pending' WHERE id IN (${placeholders})`, ptMismatchedIds);
        ptMismatched = ptMismatchedIds.length;
      }
      const [campRows] = await conn.execute(
        "UPDATE campaigns SET budget_sync_status='synced' WHERE budget_sync_status='pending_confirmation' AND updatedAt < DATE_SUB(NOW(), INTERVAL 30 MINUTE) LIMIT 100"
      );
      campReconciled = campRows.affectedRows;
      const total = kwMatched + kwMismatched + kwTimeout + ptMatched + ptMismatched + campReconciled;
      if (total > 0) {
        log214.info(`Reconcile: kw(matched=${kwMatched},mismatch=${kwMismatched},timeout=${kwTimeout}) pt(matched=${ptMatched},mismatch=${ptMismatched}) camp=${campReconciled}`);
      }
    } finally {
      conn.release();
    }
  } catch (e) {
    log214.warn(`Reconcile error: ${e.message}`);
  }
}
async function deepReconcile() {
  try {
    const conn = await getDirectConnection(3e4);
    try {
      const [r] = await conn.execute(
        "UPDATE keywords SET bid_sync_status='retry_pending' WHERE bid_sync_status='pending_confirmation' AND updatedAt < DATE_SUB(NOW(), INTERVAL 6 HOUR) LIMIT 1000"
      );
      if (r.affectedRows > 0) {
        log214.info(`Deep reconcile: ${r.affectedRows} stale keywords reset`);
      }
      const [rPt] = await conn.execute(
        "UPDATE product_targets SET bid_sync_status='retry_pending' WHERE bid_sync_status='pending_confirmation' AND updatedAt < DATE_SUB(NOW(), INTERVAL 6 HOUR) LIMIT 1000"
      );
      if (rPt.affectedRows > 0) {
        log214.info(`Deep reconcile: ${rPt.affectedRows} stale targets reset`);
      }
    } finally {
      conn.release();
    }
  } catch (e) {
    log214.warn(`Deep reconcile error: ${e.message}`);
  }
}
async function autoArchiveTasks() {
  try {
    const conn = await getDirectConnection(3e4);
    try {
      const [r1] = await conn.execute(
        "UPDATE optimization_tasks SET status='failed', error_message=CONCAT(COALESCE(error_message,''),' [v602c] permanent failure') WHERE status='failed' AND retry_count>=3 AND created_at<DATE_SUB(NOW(),INTERVAL 48 HOUR) LIMIT 200"
      );
      const [r2] = await conn.execute(
        "UPDATE optimization_tasks SET status='failed', error_message=CONCAT(COALESCE(error_message,''),' [v602c] abandoned') WHERE status IN ('pending','queued') AND created_at<DATE_SUB(NOW(),INTERVAL 72 HOUR) LIMIT 200"
      );
      const [r3] = await conn.execute(
        "UPDATE optimization_tasks SET status='failed', error_message=CONCAT(COALESCE(error_message,''),' [v607] stuck processing') WHERE status='processing' AND created_at<DATE_SUB(NOW(),INTERVAL 24 HOUR) LIMIT 100"
      );
      const [r4] = await conn.execute(
        "UPDATE data_sync_jobs SET status='failed', errorMessage=CONCAT(COALESCE(errorMessage,''),' [v607] stuck running'), completedAt=NOW() WHERE status='running' AND startedAt<DATE_SUB(NOW(),INTERVAL 2 HOUR) LIMIT 50"
      );
      const [r5] = await conn.execute(
        "UPDATE optimization_events SET status='failed' WHERE status='processing' AND created_at<DATE_SUB(NOW(),INTERVAL 24 HOUR) LIMIT 100"
      );
      const total = r1.affectedRows + r2.affectedRows + r3.affectedRows + r4.affectedRows + r5.affectedRows;
      if (total > 0) {
        log214.info(`Auto-archive: tasks(perm=${r1.affectedRows},failed=${r2.affectedRows},stuck=${r3.affectedRows}) sync(stuck=${r4.affectedRows}) events(stuck=${r5.affectedRows})`);
      }
    } finally {
      conn.release();
    }
  } catch (e) {
    log214.warn(`Auto-archive error: ${e.message}`);
  }
}
async function accountHealthManager() {
  try {
    const conn = await getDirectConnection(3e4);
    try {
      const [orphanRows] = await conn.execute(`
        UPDATE data_sync_jobs j
        LEFT JOIN ad_accounts a ON j.accountId = a.id
        SET j.status='failed', j.errorMessage='v546: \u8D26\u6237\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664', j.completedAt=UTC_TIMESTAMP()
        WHERE j.status IN ('running','queued') AND a.id IS NULL
      `);
      if (orphanRows.affectedRows > 0) {
        log214.info(`Orphan cleanup: ${orphanRows.affectedRows} jobs cleaned`);
      }
      const [pausedAccounts] = await conn.execute(
        "SELECT id, accountName FROM ad_accounts WHERE sync_status='paused'"
      );
      for (const row of pausedAccounts) {
        await conn.execute("UPDATE ad_accounts SET sync_status='active' WHERE id=?", [row.id]);
        log214.info(`Auto-recover: account ${row.id} (${row.accountName}) reactivated from paused`);
      }
      try {
        const [stuckAccounts] = await conn.execute(
          "SELECT id, accountName, initialization_status FROM ad_accounts WHERE initialization_status IN ('syncing','pending') AND id IN (SELECT DISTINCT accountId FROM data_sync_jobs WHERE status='completed' AND completedAt > DATE_SUB(NOW(), INTERVAL 7 DAY))"
        );
        for (const acct of stuckAccounts) {
          await conn.execute("UPDATE ad_accounts SET initialization_status='completed' WHERE id=?", [acct.id]);
          log214.info(`Auto-fixed stuck initialization_status for account ${acct.id} (${acct.accountName}): ${acct.initialization_status} -> completed`);
        }
      } catch (initFixErr) {
        log214.warn(`initialization_status auto-fix error: ${initFixErr.message}`);
      }
      try {
        const [failedAccounts] = await conn.execute(`
          SELECT a.id, a.accountName, COUNT(j.id) as recentFailures,
            MAX(CASE WHEN j.status='completed' THEN j.completedAt END) as lastSuccess
          FROM ad_accounts a
          JOIN data_sync_jobs j ON j.accountId = a.id AND j.createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
          WHERE j.status = 'failed'
          GROUP BY a.id, a.accountName
          HAVING recentFailures >= 3
        `);
        for (const acct of failedAccounts) {
          log214.warn(`SYNC_ALERT: Account ${acct.id} (${acct.accountName}) has ${acct.recentFailures} failed syncs in 24h, last success: ${acct.lastSuccess || "never"}`);
        }
      } catch (syncAlertErr) {
        log214.warn(`Sync failure detection error: ${syncAlertErr.message}`);
      }
    } finally {
      conn.release();
    }
  } catch (e) {
    log214.warn(`Account health error: ${e.message}`);
  }
}
async function checkWeeklyReset() {
  try {
    const now = /* @__PURE__ */ new Date();
    const pstHour = (now.getUTCHours() - 8 + 24) % 24;
    const pstDay = now.getUTCDay();
    if (pstDay === 0 && pstHour === 1 && now.getUTCMinutes() < 5) {
      const conn = await getDirectConnection(1e4);
      try {
        const [r] = await conn.execute(
          "UPDATE ad_accounts SET lastEntitySyncAt=NULL WHERE sync_status='active' AND lastEntitySyncAt IS NOT NULL"
        );
        if (r.affectedRows > 0) {
          log214.info(`Weekly reset: ${r.affectedRows} accounts lastEntitySyncAt cleared`);
        }
      } finally {
        conn.release();
      }
    }
  } catch (e) {
    log214.warn(`Weekly reset check failed: ${e.message}`);
  }
}
async function ensureAdAccountFields() {
  try {
    const conn = await getDirectConnection(3e4);
    try {
      const fields = [
        { name: "lastEntitySyncAt", sql: "ALTER TABLE ad_accounts ADD COLUMN lastEntitySyncAt TIMESTAMP NULL" },
        { name: "lastFullSyncAt", sql: "ALTER TABLE ad_accounts ADD COLUMN lastFullSyncAt TIMESTAMP NULL" },
        { name: "totalKeywords", sql: "ALTER TABLE ad_accounts ADD COLUMN totalKeywords INT DEFAULT 0" },
        { name: "syncMode", sql: "ALTER TABLE ad_accounts ADD COLUMN syncMode VARCHAR(20) DEFAULT 'standard'" },
        // v614i-fix23: P1-2 SB/SD权限智能探测 - 持久化字段
        { name: "sbCapability", sql: "ALTER TABLE ad_accounts ADD COLUMN sbCapability TINYINT DEFAULT NULL COMMENT 'SB\u5E7F\u544A\u6743\u9650: NULL=\u672A\u63A2\u6D4B, 0=\u65E0\u6743\u9650, 1=\u6709\u6743\u9650'" },
        { name: "sdCapability", sql: "ALTER TABLE ad_accounts ADD COLUMN sdCapability TINYINT DEFAULT NULL COMMENT 'SD\u5E7F\u544A\u6743\u9650: NULL=\u672A\u63A2\u6D4B, 0=\u65E0\u6743\u9650, 1=\u6709\u6743\u9650'" },
        { name: "sbCapabilityCheckedAt", sql: "ALTER TABLE ad_accounts ADD COLUMN sbCapabilityCheckedAt TIMESTAMP NULL" },
        { name: "sdCapabilityCheckedAt", sql: "ALTER TABLE ad_accounts ADD COLUMN sdCapabilityCheckedAt TIMESTAMP NULL" }
      ];
      for (const field of fields) {
        try {
          await conn.execute(field.sql);
          log214.info(`Added ${field.name} field`);
        } catch (e) {
          if (!e.message.includes("Duplicate")) {
            log214.info(`${field.name}: ${e.message}`);
          }
        }
      }
      await conn.execute(`
        UPDATE ad_accounts SET syncMode = CASE
          WHEN (SELECT COUNT(*) FROM campaigns WHERE campaigns.accountId = ad_accounts.id) > 3000 THEN 'super_xl'
          WHEN (SELECT COUNT(*) FROM campaigns WHERE campaigns.accountId = ad_accounts.id) > 1000 THEN 'xl'
          WHEN (SELECT COUNT(*) FROM campaigns WHERE campaigns.accountId = ad_accounts.id) > 500 THEN 'large'
          ELSE 'standard'
        END WHERE syncMode = 'standard' OR syncMode IS NULL
      `);
      log214.info("syncMode auto-classification completed");
    } finally {
      conn.release();
    }
  } catch (e) {
    log214.warn(`Ad accounts field extension failed: ${e.message}`);
  }
}
async function healthCheckAndCleanup() {
  try {
    const conn = await getDirectConnection(3e4);
    try {
      const [r1] = await conn.execute(
        "UPDATE ad_accounts SET sync_status='idle' WHERE sync_status='error' AND updatedAt < DATE_SUB(NOW(), INTERVAL 1 HOUR)"
      );
      if (r1.affectedRows > 0) {
        log214.info(`Health-check: reset ${r1.affectedRows} stale error accounts to idle`);
      }
      const [runningJobs] = await conn.execute(
        "SELECT id, accountId, startedAt, lastHeartbeat, progress, stepDetails FROM data_sync_jobs WHERE status='running' ORDER BY startedAt ASC"
      );
      for (const job of runningJobs) {
        const runMin = Math.round((Date.now() - new Date(job.startedAt).getTime()) / 6e4);
        const hbAge = job.lastHeartbeat ? Math.round((Date.now() - new Date(job.lastHeartbeat).getTime()) / 1e3) : 9999;
        const progress = job.progress || 0;
        let activityScore = 0;
        if (hbAge < 60) activityScore += 40;
        else if (hbAge < 300) activityScore += 20;
        if (progress > 0) activityScore += 20;
        if (job.stepDetails) {
          try {
            const details = typeof job.stepDetails === "string" ? JSON.parse(job.stepDetails) : job.stepDetails;
            if (details.lastStepAt && Date.now() - new Date(details.lastStepAt).getTime() < 3e5) activityScore += 20;
          } catch {
          }
        }
        if (activityScore >= 40) {
          if (runMin > 30) {
            log214.info(`Health-check: Job#${job.id} (account ${job.accountId}) running ${runMin}min, heartbeat ${hbAge}s ago, progress ${progress}%, activity=${activityScore} \u2192 normal long processing`);
          }
        } else if (activityScore >= 20) {
          log214.warn(`Health-check: \u26A0 Job#${job.id} (account ${job.accountId}) running ${runMin}min, heartbeat ${hbAge}s ago, progress ${progress}%, activity=${activityScore} \u2192 possibly stalled`);
        } else {
          log214.warn(`Health-check: \u274C Job#${job.id} (account ${job.accountId}) running ${runMin}min, heartbeat ${hbAge}s ago, progress ${progress}%, activity=${activityScore} \u2192 confirmed stuck, marking failed`);
          await conn.execute(
            "UPDATE data_sync_jobs SET status='failed', errorMessage=CONCAT(COALESCE(errorMessage,''),' [v608] health-check: heartbeat timeout >30min, activity='+?) WHERE id=?",
            [String(activityScore), job.id]
          );
        }
      }
      const [ultraLong] = await conn.execute(
        "UPDATE data_sync_jobs SET status='failed', errorMessage=CONCAT(COALESCE(errorMessage,''),' [v608] hard-limit: exceeded 6h maximum') WHERE status='running' AND startedAt < DATE_SUB(NOW(), INTERVAL 6 HOUR)"
      );
      if (ultraLong.affectedRows > 0) {
        log214.warn(`Health-check: force-killed ${ultraLong.affectedRows} jobs exceeding 6h hard limit`);
      }
      await cleanupStuckTasks();
      // v619: Removed duplicate consumer from health-check loop.
      // All Redis queue consumption is now handled exclusively by syncTaskConsumer
      // to prevent race conditions and double-processing.
      try {
        const qStatus = await getQueueStatus();
        const total = qStatus.high + qStatus.medium + qStatus.low;
        if (total > 0 || qStatus.processing > 0) {
          log214.info(`[v619] Redis queue status: high=${qStatus.high} medium=${qStatus.medium} low=${qStatus.low} nightly=${qStatus.nightly} processing=${qStatus.processing}`);
        }
      } catch (v619qErr) {
        log214.debug(`[v619] Redis queue status check error: ${v619qErr.message}`);
      }
      try {
        const [queuedTasks] = await conn.execute(
          "SELECT * FROM sync_task_queue WHERE status='queued' ORDER BY priority DESC, createdAt ASC LIMIT 3"
        );
        if (queuedTasks.length > 0) {
          log214.info(`Queue consume: found ${queuedTasks.length} pending tasks`);
          for (const task of queuedTasks) {
            await conn.execute(
              "UPDATE sync_task_queue SET status='processing', startedAt=NOW(), lockedBy=? WHERE id=? AND status='queued'",
              [process.pid.toString(), task.id]
            );
            (async () => {
              try {
                const { syncAccount: syncAccount2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
                await syncAccount2({ id: task.accountId }, task.syncType);
                await conn.execute("UPDATE sync_task_queue SET status='completed', completedAt=NOW() WHERE id=?", [task.id]);
                log214.info(`Queue consume: task#${task.id} completed`);
                // v620-fix10: Event-driven healthSignal precompute
                _hsPrecomputeForAccount(task.accountId).catch(() => {});
              } catch (taskErr) {
                log214.warn(`Queue consume: task#${task.id} failed: ${taskErr.message?.substring(0, 100)}`);
                await conn.execute(
                  "UPDATE sync_task_queue SET status='failed', lastError=?, retryCount=retryCount+1 WHERE id=?",
                  [taskErr.message?.substring(0, 500), task.id]
                ).catch(() => {
                });
              }
            })();
          }
        }
      } catch (queueErr) {
        log214.warn(`Queue consume error: ${queueErr.message}`);
      }
    } finally {
      conn.release();
    }
  } catch (e) {
    log214.warn(`Health-check error: ${e.message}`);
  }
}
async function ensureTables() {
  try {
    const conn = await getDirectConnection(3e4);
    try {
      await conn.execute(`CREATE TABLE IF NOT EXISTS sync_task_queue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        accountId INT NOT NULL,
        syncType VARCHAR(50) NOT NULL DEFAULT 'nightly',
        priority INT NOT NULL DEFAULT 5,
        status ENUM('queued','processing','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
        triggerSource VARCHAR(50) DEFAULT 'auto',
        payload JSON,
        maxRetries INT DEFAULT 3,
        retryCount INT DEFAULT 0,
        lastError TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        startedAt TIMESTAMP NULL,
        completedAt TIMESTAMP NULL,
        lockedBy VARCHAR(100) NULL,
        lockedAt TIMESTAMP NULL,
        INDEX idx_status_priority (status, priority DESC),
        INDEX idx_account (accountId),
        INDEX idx_locked (lockedBy, lockedAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      log214.info("sync_task_queue table ready");
      await conn.execute(`CREATE TABLE IF NOT EXISTS sync_performance_baselines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        job_id INT NOT NULL,
        account_id INT NOT NULL,
        system_version INT NOT NULL,
        sync_type VARCHAR(50),
        trigger_source VARCHAR(50),
        total_steps INT DEFAULT 0,
        completed_steps INT DEFAULT 0,
        failed_steps INT DEFAULT 0,
        total_synced INT DEFAULT 0,
        total_duration_sec INT DEFAULT 0,
        step_timings JSON,
        campaign_count INT DEFAULT 0,
        marketplace VARCHAR(10),
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_account_version (account_id, system_version),
        INDEX idx_version_created (system_version, created_at),
        INDEX idx_sync_type (sync_type, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      log214.info("sync_performance_baselines table ready");
    } finally {
      conn.release();
    }
  } catch (e) {
    log214.warn(`Ensure tables error: ${e.message}`);
  }
}
async function initStartupTasks() {
  log214.info("Initializing startup tasks (P5: Async Reports + Microservice Split)...");
  log214.info(`[P5] Worker mode: ${process.env.P5_WORKER_ENABLED === "true" ? "ENABLED (background tasks in worker)" : "DISABLED (all-in-one)"}, isWorker=${!!process.env.P5_IS_WORKER}, asyncReports=${process.env.P5_ASYNC_REPORTS !== "false" ? "ENABLED" : "DISABLED"}`);
  setTimeout(async () => {
    try {
      await zombieCleanup();
      await reconcile();
      setInterval(reconcile, 5 * 60 * 1e3);
      setTimeout(deepReconcile, 5 * 60 * 1e3);
      setInterval(deepReconcile, 60 * 60 * 1e3);
      setTimeout(autoArchiveTasks, 10 * 60 * 1e3);
      setInterval(autoArchiveTasks, 4 * 60 * 60 * 1e3);
      setTimeout(accountHealthManager, 3 * 60 * 1e3);
      setInterval(accountHealthManager, 6 * 60 * 60 * 1e3);
      setInterval(checkWeeklyReset, 5 * 60 * 1e3);
      log214.info("Weekly reset timer started");
      setTimeout(healthCheckAndCleanup, 5 * 60 * 1e3);
      setInterval(healthCheckAndCleanup, 15 * 60 * 1e3);
      const clearedLocks = await clearStaleAccountLocks();
      if (clearedLocks > 0) {
        log214.info(`[v614i] \u542F\u52A8\u65F6\u6E05\u7406\u4E86 ${clearedLocks} \u4E2A\u65E7\u8D26\u6237\u9501`);
      }
      await startWorkerLifecycle();
      process.on("SIGTERM", async () => {
        log214.info("[v614i] SIGTERM received, releasing all locks...");
        await releaseAllMyLocks();
      });
      log214.info("All startup tasks initialized successfully");
    } catch (e) {
      log214.warn(`Startup tasks init error: ${e.message}`);
    }
  }, 15e3);
  setTimeout(async () => {
    await ensureTables();
    await ensureAdAccountFields();
  }, 2e4);
}
var log214;
