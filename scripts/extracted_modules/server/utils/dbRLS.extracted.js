// Extracted from production dist/index.js
// Original module: server/utils/dbRLS.ts
// Lines: 364

var dbRLS_exports = {};
__export(dbRLS_exports, {
  getRLSAuditLog: () => getRLSAuditLog,
  getRLSStatus: () => getRLSStatus,
  initializeRLS: () => initializeRLS,
  setRLSContext: () => setRLSContext,
  verifyRLSAccess: () => verifyRLSAccess
});
async function initializeRLS() {
  if (rlsInitialized) {
    return { success: true, viewsCreated: 0, errors: [] };
  }
  const errors = [];
  let viewsCreated = 0;
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const db = await getDb3();
    if (!db) {
      return { success: false, viewsCreated: 0, errors: ["\u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528"] };
    }
    log191.info("[RLS] \u5F00\u59CB\u521D\u59CB\u5316\u6570\u636E\u5E93\u7EA7\u884C\u7EA7\u5B89\u5168...");
    // fix24-P3v2-6: 确保RLS存储函数存在（MySQL不允许视图中使用用户变量，需要通过函数包装）
    try {
      await db.execute(sql.raw("CREATE FUNCTION IF NOT EXISTS rls_get_user_id() RETURNS INT DETERMINISTIC NO SQL RETURN @rls_user_id"));
    } catch(fnErr1) {
      try { await db.execute(sql.raw("DROP FUNCTION IF EXISTS rls_get_user_id")); await db.execute(sql.raw("CREATE FUNCTION rls_get_user_id() RETURNS INT DETERMINISTIC NO SQL RETURN @rls_user_id")); } catch(e) { log191.warn("[RLS] fix24-P3v2-6: rls_get_user_id创建失败: " + e.message); }
    }
    try {
      await db.execute(sql.raw("CREATE FUNCTION IF NOT EXISTS rls_get_org_id() RETURNS INT DETERMINISTIC NO SQL RETURN @rls_org_id"));
    } catch(fnErr2) {
      try { await db.execute(sql.raw("DROP FUNCTION IF EXISTS rls_get_org_id")); await db.execute(sql.raw("CREATE FUNCTION rls_get_org_id() RETURNS INT DETERMINISTIC NO SQL RETURN @rls_org_id")); } catch(e) { log191.warn("[RLS] fix24-P3v2-6: rls_get_org_id创建失败: " + e.message); }
    }
    try {
      await db.execute(sql.raw("CREATE FUNCTION IF NOT EXISTS rls_is_admin() RETURNS TINYINT DETERMINISTIC NO SQL RETURN @rls_is_system_admin"));
    } catch(fnErr3) {
      try { await db.execute(sql.raw("DROP FUNCTION IF EXISTS rls_is_admin")); await db.execute(sql.raw("CREATE FUNCTION rls_is_admin() RETURNS TINYINT DETERMINISTIC NO SQL RETURN @rls_is_system_admin")); } catch(e) { log191.warn("[RLS] fix24-P3v2-6: rls_is_admin创建失败: " + e.message); }
    }
    log191.info("[RLS] fix24-P3v2-6: RLS存储函数已就绪");
    for (const view of RLS_VIEWS) {
      try {
        try {
          const [tableCheck] = await db.execute(sql.raw(
            `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${view.sourceTable}'`
          ));
          const tableExists = tableCheck?.[0]?.cnt > 0 || tableCheck?.cnt > 0;
          if (!tableExists) {
            log191.info(`[RLS] v579: \u8DF3\u8FC7\u89C6\u56FE ${view.viewName} - \u6E90\u8868 ${view.sourceTable} \u5C1A\u672A\u521B\u5EFA`);
            continue;
          }
        } catch {
        }
        let viewSQL;
        if (view.filterType === "userId") {
          viewSQL = `
            CREATE OR REPLACE VIEW \`${view.viewName}\` AS
            SELECT t.* FROM \`${view.sourceTable}\` t
            WHERE t.userId = rls_get_user_id()
               OR rls_get_user_id() IS NULL
               OR rls_is_admin() = 1
          `; // fix24-P3v2-3: 使用存储函数替代用户变量
        } else if (view.filterType === "accountId") {
          const colName = ["ams_performance_data", "bid_adjustment_history", "batch_marginal_benefit_analysis", "budget_allocation_configs"].includes(view.sourceTable) ? "account_id" : "accountId";
          viewSQL = `
            CREATE OR REPLACE VIEW \`${view.viewName}\` AS
            SELECT t.* FROM \`${view.sourceTable}\` t
            WHERE t.\`${colName}\` IN (
              SELECT id FROM ad_accounts WHERE userId = rls_get_user_id()
            )
               OR rls_get_user_id() IS NULL
               OR rls_is_admin() = 1
          `; // fix24-P3v2-3: 使用存储函数替代用户变量
        } else if (view.filterType === "organizationId") {
          viewSQL = `
            CREATE OR REPLACE VIEW \`${view.viewName}\` AS
            SELECT t.* FROM \`${view.sourceTable}\` t
            WHERE t.organization_id = rls_get_org_id()
               OR rls_get_org_id() IS NULL
               OR rls_is_admin() = 1
          `; // fix24-P3v2-3: 使用存储函数替代用户变量
        } else {
          continue;
        }
        await db.execute(sql.raw(viewSQL));
        viewsCreated++;
        log191.info(`[RLS] \u521B\u5EFA\u5B89\u5168\u89C6\u56FE: ${view.viewName} (${view.description})`);
      } catch (err) {
        const errMsg = `\u89C6\u56FE ${view.viewName} \u521B\u5EFA\u5931\u8D25: ${err?.message || String(err)}`;
        errors.push(errMsg);
        log191.warn(`[RLS] ${errMsg}`);
      }
    }
    try {
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS rls_audit_log (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          organization_id INT,
          attempted_table VARCHAR(100) NOT NULL,
          attempted_record_id INT,
          attempted_account_id INT,
          action_type ENUM('SELECT', 'INSERT', 'UPDATE', 'DELETE') DEFAULT 'SELECT',
          blocked BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_rls_audit_user (user_id),
          INDEX idx_rls_audit_time (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `));
      log191.info("[RLS] RLS \u5BA1\u8BA1\u65E5\u5FD7\u8868\u5DF2\u5C31\u7EEA");
    } catch (err) {
      errors.push(`RLS\u5BA1\u8BA1\u8868\u521B\u5EFA\u5931\u8D25: ${err?.message || ""}`);
    }
    try {
      await db.execute(sql.raw(`DROP PROCEDURE IF EXISTS set_rls_context`));
      await db.execute(sql.raw(`
        CREATE PROCEDURE set_rls_context(
          IN p_user_id INT,
          IN p_org_id INT,
          IN p_is_system_admin BOOLEAN
        )
        BEGIN
          SET @rls_user_id = p_user_id;
          SET @rls_org_id = p_org_id;
          SET @rls_is_system_admin = p_is_system_admin;
        END
      `));
      log191.info("[RLS] RLS \u4E0A\u4E0B\u6587\u8BBE\u7F6E\u5B58\u50A8\u8FC7\u7A0B\u5DF2\u521B\u5EFA");
    } catch (err) {
      errors.push(`\u5B58\u50A8\u8FC7\u7A0B\u521B\u5EFA\u5931\u8D25: ${err?.message || ""}`);
    }
    try {
      await db.execute(sql.raw(`DROP PROCEDURE IF EXISTS verify_rls_access`));
      await db.execute(sql.raw(`
        CREATE PROCEDURE verify_rls_access(
          IN p_user_id INT,
          IN p_account_id INT,
          IN p_table_name VARCHAR(100),
          OUT p_allowed BOOLEAN
        )
        BEGIN
          DECLARE v_count INT DEFAULT 0;
          
          -- \u68C0\u67E5 account_id \u662F\u5426\u5C5E\u4E8E\u8BE5\u7528\u6237
          SELECT COUNT(*) INTO v_count 
          FROM ad_accounts 
          WHERE id = p_account_id AND userId = p_user_id;
          
          SET p_allowed = (v_count > 0);
          
          -- \u5982\u679C\u88AB\u62D2\u7EDD\uFF0C\u8BB0\u5F55\u5230\u5BA1\u8BA1\u65E5\u5FD7
          IF NOT p_allowed THEN
            INSERT INTO rls_audit_log (user_id, attempted_table, attempted_account_id, blocked)
            VALUES (p_user_id, p_table_name, p_account_id, TRUE);
          END IF;
        END
      // @ts-ignore
      `));
      log191.info("[RLS] RLS \u8BBF\u95EE\u9A8C\u8BC1\u5B58\u50A8\u8FC7\u7A0B\u5DF2\u521B\u5EFA");
    } catch (err) {
      errors.push(`\u9A8C\u8BC1\u5B58\u50A8\u8FC7\u7A0B\u521B\u5EFA\u5931\u8D25: ${err?.message || ""}`);
    }
    rlsInitialized = true;
    log191.info(`[RLS] \u521D\u59CB\u5316\u5B8C\u6210: ${viewsCreated} \u4E2A\u89C6\u56FE\u521B\u5EFA\u6210\u529F, ${errors.length} \u4E2A\u9519\u8BEF`);
    if (errors.length > 0) {
      setTimeout(async () => {
        log191.info(`[v580] \u5EF6\u8FDF60\u79D2\u540E\u91CD\u8BD5\u521B\u5EFA${errors.length}\u4E2A\u5931\u8D25\u7684RLS\u89C6\u56FE...`);
        try {
          const retryDb = await getDb3();
          if (!retryDb) return;
          let retrySuccess = 0;
          for (const view of RLS_VIEWS) {
            try {
              const [viewCheck] = await retryDb.execute(sql.raw(
                `SELECT COUNT(*) as cnt FROM information_schema.views WHERE table_schema = DATABASE() AND table_name = '${view.viewName}'`
              ));
              if (viewCheck?.[0]?.cnt > 0 || viewCheck?.cnt > 0) continue;
              const [tableCheck] = await retryDb.execute(sql.raw(
                `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${view.sourceTable}'`
              ));
              if (!(tableCheck?.[0]?.cnt > 0 || tableCheck?.cnt > 0)) continue;
              const colName = ["ams_performance_data", "bid_adjustment_history", "batch_marginal_benefit_analysis", "budget_allocation_configs"].includes(view.sourceTable) ? "account_id" : "accountId";
              let retrySQL;
              if (view.filterType === "userId") {
                retrySQL = `CREATE OR REPLACE VIEW \`${view.viewName}\` AS SELECT t.* FROM \`${view.sourceTable}\` t WHERE t.userId = rls_get_user_id() OR rls_get_user_id() IS NULL OR rls_is_admin() = 1`; // fix24-P3v2-4
              } else if (view.filterType === "accountId") {
                retrySQL = `CREATE OR REPLACE VIEW \`${view.viewName}\` AS SELECT t.* FROM \`${view.sourceTable}\` t WHERE t.\`${colName}\` IN (SELECT id FROM ad_accounts WHERE userId = rls_get_user_id()) OR rls_get_user_id() IS NULL OR rls_is_admin() = 1`; // fix24-P3v2-4
              } else if (view.filterType === "organizationId") {
                retrySQL = `CREATE OR REPLACE VIEW \`${view.viewName}\` AS SELECT t.* FROM \`${view.sourceTable}\` t WHERE t.organization_id = rls_get_org_id() OR rls_get_org_id() IS NULL OR rls_is_admin() = 1`; // fix24-P3v2-4
              } else {
                continue;
              }
              await retryDb.execute(sql.raw(retrySQL));
              retrySuccess++;
              log191.info(`[v580] \u5EF6\u8FDF\u91CD\u8BD5\u6210\u529F: \u89C6\u56FE ${view.viewName} \u5DF2\u521B\u5EFA`);
            } catch (retryErr) {
              log191.warn(`[v580] \u5EF6\u8FDF\u91CD\u8BD5\u5931\u8D25: \u89C6\u56FE ${view.viewName}: ${retryErr.message}`);
            }
          }
          log191.info(`[v580] RLS\u89C6\u56FE\u5EF6\u8FDF\u91CD\u8BD5\u5B8C\u6210: ${retrySuccess}\u4E2A\u6210\u529F`);
          // v620-fix14g-P3: fix24-P3-5 增加第二轮重试(120秒后)
          if (retrySuccess < errors.length) {
            setTimeout(async () => {
              log191.info(`[fix24-P3-5] 第二轮RLS视图重试(120秒后)...`);
              try {
                const retryDb2 = await getDb3();
                if (!retryDb2) return;
                let retry2Success = 0;
                for (const view of RLS_VIEWS) {
                  try {
                    const [vc2] = await retryDb2.execute(sql.raw(`SELECT COUNT(*) as cnt FROM information_schema.views WHERE table_schema = DATABASE() AND table_name = '${view.viewName}'`));
                    if (vc2?.[0]?.cnt > 0 || vc2?.cnt > 0) continue;
                    const [tc2] = await retryDb2.execute(sql.raw(`SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${view.sourceTable}'`));
                    if (!(tc2?.[0]?.cnt > 0 || tc2?.cnt > 0)) continue;
                    const colName2 = ["ams_performance_data", "bid_adjustment_history", "batch_marginal_benefit_analysis", "budget_allocation_configs"].includes(view.sourceTable) ? "account_id" : "accountId";
                    let retrySQL2;
                    if (view.filterType === "userId") retrySQL2 = `CREATE OR REPLACE VIEW \`${view.viewName}\` AS SELECT t.* FROM \`${view.sourceTable}\` t WHERE t.userId = rls_get_user_id() OR rls_get_user_id() IS NULL OR rls_is_admin() = 1`; // fix24-P3v2-5
                    else if (view.filterType === "accountId") retrySQL2 = `CREATE OR REPLACE VIEW \`${view.viewName}\` AS SELECT t.* FROM \`${view.sourceTable}\` t WHERE t.\`${colName2}\` IN (SELECT id FROM ad_accounts WHERE userId = rls_get_user_id()) OR rls_get_user_id() IS NULL OR rls_is_admin() = 1`; // fix24-P3v2-5
                    else if (view.filterType === "organizationId") retrySQL2 = `CREATE OR REPLACE VIEW \`${view.viewName}\` AS SELECT t.* FROM \`${view.sourceTable}\` t WHERE t.organization_id = rls_get_org_id() OR rls_get_org_id() IS NULL OR rls_is_admin() = 1`; // fix24-P3v2-5
                    else continue;
                    await retryDb2.execute(sql.raw(retrySQL2));
                    retry2Success++;
                    log191.info(`[fix24-P3-5] 第二轮重试成功: 视图 ${view.viewName}`);
                  } catch (r2Err) {
                    log191.warn(`[fix24-P3-5] 第二轮重试失败: 视图 ${view.viewName}: ${r2Err.message}`);
                  }
                }
                log191.info(`[fix24-P3-5] 第二轮RLS视图重试完成: ${retry2Success}个成功`);
              } catch (e2) {
                log191.warn(`[fix24-P3-5] 第二轮RLS视图重试异常: ${e2.message}`);
              }
            }, 12e4); // 120秒后第二轮重试
          }
        } catch (e) {
          log191.warn(`[v580] RLS\u89C6\u56FE\u5EF6\u8FDF\u91CD\u8BD5\u5F02\u5E38: ${e.message}`);
        }
      }, 6e4);
    }
    return { success: errors.length === 0, viewsCreated, errors };
  } catch (err) {
    log191.warn(`[RLS] \u521D\u59CB\u5316\u5931\u8D25: ${err?.message || ""}`);
    return { success: false, viewsCreated, errors: [...errors, `\u521D\u59CB\u5316\u5F02\u5E38: ${err?.message || ""}`] };
  }
}
async function setRLSContext(db, userId, organizationId, isSystemAdmin) {
  try {
    await db.execute(sql.raw(
      `SET @rls_user_id = ${Number(userId)}, @rls_org_id = ${organizationId ? Number(organizationId) : "NULL"}, @rls_is_system_admin = ${isSystemAdmin ? 1 : 0}`
    ));
  } catch (err) {
    log191.warn(`[RLS] \u8BBE\u7F6E RLS \u4E0A\u4E0B\u6587\u5931\u8D25: ${err?.message || ""}`);
  }
}
async function verifyRLSAccess(userId, accountId, tableName) {
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const db = await getDb3();
    if (!db) return false;
    const result = await db.execute(sql.raw(
      `SELECT COUNT(*) as cnt FROM ad_accounts WHERE id = ${Number(accountId)} AND userId = ${Number(userId)}`
    ));
    const rows = result[0];
    const allowed = rows && rows[0] && rows[0].cnt > 0;
    if (!allowed) {
      try {
        await db.execute(sql.raw(
          // @ts-ignore
          `INSERT INTO rls_audit_log (user_id, attempted_table, attempted_account_id, blocked) VALUES (${Number(userId)}, '${tableName.replace(/'/g, "''")}', ${Number(accountId)}, TRUE)`
        ));
      } catch {
      }
      log191.warn(`[RLS] \u6570\u636E\u5E93\u7EA7\u62E6\u622A: userId=${userId} \u8BD5\u56FE\u8BBF\u95EE ${tableName} (accountId=${accountId})`);
    }
    return allowed;
  } catch (err) {
    log191.warn(`[RLS] \u9A8C\u8BC1\u5931\u8D25: ${err?.message || ""}`);
    return false;
  }
}
async function getRLSAuditLog(options) {
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const db = await getDb3();
    if (!db) return [];
    let query = `SELECT * FROM rls_audit_log WHERE 1=1`;
    if (options.userId) {
      query += ` AND user_id = ${Number(options.userId)}`;
    }
    if (options.since) {
      query += ` AND created_at >= '${options.since.toISOString().slice(0, 19).replace("T", " ")}'`;
    }
    query += ` ORDER BY created_at DESC LIMIT ${options.limit || 100}`;
    const result = await db.execute(sql.raw(query));
    return result[0] || [];
  } catch {
    return [];
  }
}
async function getRLSStatus() {
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const db = await getDb3();
    if (!db) return { initialized: rlsInitialized, viewCount: 0, auditLogCount: 0, recentViolations: 0 };
    const viewResult = await db.execute(sql.raw(
      `SELECT COUNT(*) as cnt FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'rls_%'`
    ));
    const viewCount = viewResult[0]?.[0]?.cnt || 0;
    let auditLogCount = 0;
    let recentViolations = 0;
    try {
      const auditResult = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM rls_audit_log`));
      auditLogCount = auditResult[0]?.[0]?.cnt || 0;
      const recentResult = await db.execute(sql.raw(
        `SELECT COUNT(*) as cnt FROM rls_audit_log WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND blocked = TRUE`
      ));
      recentViolations = recentResult[0]?.[0]?.cnt || 0;
    } catch {
    }
    return { initialized: rlsInitialized, viewCount, auditLogCount, recentViolations };
  } catch {
    return { initialized: rlsInitialized, viewCount: 0, auditLogCount: 0, recentViolations: 0 };
  }
}
var log191, RLS_VIEWS, rlsInitialized;
var init_dbRLS = __esm({
  "server/utils/dbRLS.ts"() {
    "use strict";
    init_drizzle_orm();
    init_logger();
    log191 = createModuleLogger("DB:RLS");
    RLS_VIEWS = [
      // 第一层：直接通过 userId 过滤的表
      { viewName: "rls_ad_accounts", sourceTable: "ad_accounts", filterType: "userId", description: "\u5E7F\u544A\u8D26\u6237" },
      { viewName: "rls_scheduled_tasks", sourceTable: "scheduled_tasks", filterType: "userId", description: "\u5B9A\u65F6\u4EFB\u52A1" },
      { viewName: "rls_performance_groups", sourceTable: "performance_groups", filterType: "userId", description: "\u4F18\u5316\u76EE\u6807" },
      { viewName: "rls_batch_operations", sourceTable: "batch_operations", filterType: "userId", description: "\u6279\u91CF\u64CD\u4F5C" },
      { viewName: "rls_budget_allocations", sourceTable: "budget_allocations", filterType: "userId", description: "\u9884\u7B97\u5206\u914D" },
      { viewName: "rls_anomaly_detection_rules", sourceTable: "anomaly_detection_rules", filterType: "userId", description: "\u5F02\u5E38\u68C0\u6D4B\u89C4\u5219" },
      { viewName: "rls_anomaly_alert_logs", sourceTable: "anomaly_alert_logs", filterType: "userId", description: "\u5F02\u5E38\u544A\u8B66\u65E5\u5FD7" },
      // 第二层：通过 accountId 过滤的表（accountId 必须属于当前用户）
      { viewName: "rls_campaigns", sourceTable: "campaigns", filterType: "accountId", description: "\u5E7F\u544A\u6D3B\u52A8" },
      { viewName: "rls_ad_groups", sourceTable: "ad_groups", filterType: "accountId", description: "\u5E7F\u544A\u7EC4" },
      { viewName: "rls_keywords", sourceTable: "keywords", filterType: "accountId", description: "\u5173\u952E\u8BCD" },
      { viewName: "rls_search_terms", sourceTable: "search_terms", filterType: "accountId", description: "\u641C\u7D22\u8BCD" },
      { viewName: "rls_negative_keywords", sourceTable: "negative_keywords", filterType: "accountId", description: "\u5426\u5B9A\u5173\u952E\u8BCD" },
      { viewName: "rls_daily_performance", sourceTable: "daily_performance", filterType: "accountId", description: "\u6BCF\u65E5\u8868\u73B0" },
      { viewName: "rls_hourly_performance", sourceTable: "hourly_performance", filterType: "accountId", description: "\u6BCF\u5C0F\u65F6\u8868\u73B0" },
      { viewName: "rls_placement_performance", sourceTable: "placement_performance", filterType: "accountId", description: "\u5E7F\u544A\u4F4D\u8868\u73B0" },
      { viewName: "rls_bid_adjustment_history", sourceTable: "bid_adjustment_history", filterType: "accountId", description: "\u7ADE\u4EF7\u8C03\u6574\u5386\u53F2" },
      { viewName: "rls_bidding_logs", sourceTable: "bidding_logs", filterType: "accountId", description: "\u7ADE\u4EF7\u65E5\u5FD7" },
      { viewName: "rls_optimization_recommendations", sourceTable: "optimization_recommendations", filterType: "accountId", description: "\u4F18\u5316\u5EFA\u8BAE" },
      { viewName: "rls_attribution_correction_records", sourceTable: "attribution_correction_records", filterType: "accountId", description: "\u5F52\u56E0\u4FEE\u6B63\u8BB0\u5F55" },
      { viewName: "rls_audit_logs", sourceTable: "audit_logs", filterType: "accountId", description: "\u5BA1\u8BA1\u65E5\u5FD7" },
      // 第三层：通过 organizationId 过滤的表
      { viewName: "rls_team_members", sourceTable: "team_members", filterType: "organizationId", description: "\u56E2\u961F\u6210\u5458" },
      { viewName: "rls_invite_codes", sourceTable: "invite_codes", filterType: "organizationId", description: "\u9080\u8BF7\u7801" }
    ];
    rlsInitialized = false;
    __name(initializeRLS, "initializeRLS");
    __name(setRLSContext, "setRLSContext");
    __name(verifyRLSAccess, "verifyRLSAccess");
    __name(getRLSAuditLog, "getRLSAuditLog");
    __name(getRLSStatus, "getRLSStatus");
  }
});

