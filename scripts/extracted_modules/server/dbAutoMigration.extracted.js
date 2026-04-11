// Extracted from production dist/index.js
// Original module: server/dbAutoMigration.ts
// Lines: 1013

function isAlreadyExistsError(err) {
  const message2 = String(err?.message || "");
  const causeMessage = String(err?.cause?.message || err?.cause || "");
  const combined = message2 + " " + causeMessage;
  return combined.includes("Duplicate column") || combined.includes("already exists") || combined.includes("Unknown column") || combined.includes("1060") || combined.includes("1050") || combined.includes("1054");
}
async function safeDDL(database, ddlSql, tableName, results) {
  try {
    await database.execute(ddlSql);
    results.push(`${tableName}: \u5DF2\u5C31\u7EEA`);
    log205.info(`${tableName} \u5DF2\u5C31\u7EEA`);
    return true;
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      results.push(`${tableName}: \u5DF2\u5B58\u5728\uFF08\u8DF3\u8FC7\uFF09`);
      return true;
    } else {
      results.push(`${tableName}: \u5931\u8D25 - ${err.message}`);
      log205.warn(`${tableName} \u64CD\u4F5C\u5931\u8D25 (\u53EF\u80FD\u5DF2\u5E94\u7528): ${err.message}`);
      return false;
    }
  }
}
async function runAutoDbMigration() {
  const results = [];
  try {
    const database = await getDb();
    if (!database) {
      log205.warn("\u6570\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C\u8DF3\u8FC7\u81EA\u52A8\u8FC1\u79FB");
      return { success: false, results: ["\u6570\u636E\u5E93\u4E0D\u53EF\u7528"] };
    }
    log205.info("v347: \u5F00\u59CB\u6570\u636E\u5E93\u81EA\u52A8\u8FC1\u79FB\u68C0\u67E5...");
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS anomaly_alert_logs (
        id INT NOT NULL AUTO_INCREMENT,
        rule_id INT NOT NULL DEFAULT 0,
        user_id INT NOT NULL DEFAULT 0,
        account_id INT,
        trigger_value DECIMAL(10,2) NOT NULL DEFAULT 0,
        threshold_value DECIMAL(10,2) NOT NULL DEFAULT 0,
        trigger_description TEXT,
        action_taken ENUM('alert_sent','operation_paused','operation_rolled_back','operation_blocked') NOT NULL DEFAULT 'alert_sent',
        notification_sent TINYINT NOT NULL DEFAULT 0,
        notification_sent_at TIMESTAMP NULL,
        status ENUM('active','acknowledged','resolved','false_positive') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_aal_account (account_id),
        INDEX idx_aal_rule (rule_id),
        INDEX idx_aal_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "anomaly_alert_logs", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS emergency_optimization_queue (
        id INT NOT NULL AUTO_INCREMENT,
        accountId INT NOT NULL,
        actionType VARCHAR(100) NOT NULL,
        priority VARCHAR(50) DEFAULT 'normal',
        sourceModule VARCHAR(100),
        detail TEXT,
        processed TINYINT DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processedAt TIMESTAMP NULL,
        PRIMARY KEY (id),
        INDEX idx_eoq_account (accountId),
        INDEX idx_eoq_processed (processed),
        INDEX idx_eoq_created (createdAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "emergency_optimization_queue", results);
    await safeDDL(database, sql`
      ALTER TABLE performance_groups ADD COLUMN module_execution_times TEXT DEFAULT NULL
    `, "performance_groups.module_execution_times", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS keyword_placement_hourly_performance (
        id INT NOT NULL AUTO_INCREMENT,
        account_id INT NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        internal_ad_group_id INT,
        keyword_id INT,
        target_id INT,
        placement ENUM('top_of_search', 'product_page', 'rest_of_search') NOT NULL,
        date DATE NOT NULL,
        hour INT NOT NULL,
        day_of_week INT NOT NULL,
        impressions INT DEFAULT 0,
        clicks INT DEFAULT 0,
        spend DECIMAL(12, 4) DEFAULT 0.0000,
        sales DECIMAL(12, 2) DEFAULT 0.00,
        orders INT DEFAULT 0,
        units_sold INT DEFAULT 0,
        acos DECIMAL(8, 4),
        roas DECIMAL(10, 2),
        ctr DECIMAL(8, 6),
        cvr DECIMAL(8, 6),
        cpc DECIMAL(10, 4),
        data_source ENUM('ams', 'report_api', 'simulated') DEFAULT 'ams',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_kph_account_campaign_date (account_id, campaign_id, date),
        INDEX idx_kph_keyword_placement (keyword_id, placement, date),
        INDEX idx_kph_target_placement (target_id, placement, date),
        INDEX idx_kph_day_hour (day_of_week, hour),
        INDEX idx_kph_placement_date (placement, date),
        INDEX idx_kph_unique_combo (account_id, campaign_id, keyword_id, target_id, placement, date, hour)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "keyword_placement_hourly_performance", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS multi_dim_combo_analysis (
        id INT NOT NULL AUTO_INCREMENT,
        account_id INT NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        keyword_id INT,
        target_id INT,
        keyword_text VARCHAR(500),
        combo_category ENUM('golden', 'leaden', 'potential', 'standard') NOT NULL,
        best_placement ENUM('top_of_search', 'product_page', 'rest_of_search'),
        worst_placement ENUM('top_of_search', 'product_page', 'rest_of_search'),
        best_time_windows JSON,
        worst_time_windows JSON,
        top_of_search_roas DECIMAL(10, 2),
        top_of_search_acos DECIMAL(8, 4),
        top_of_search_spend DECIMAL(12, 2),
        top_of_search_sales DECIMAL(12, 2),
        product_page_roas DECIMAL(10, 2),
        product_page_acos DECIMAL(8, 4),
        product_page_spend DECIMAL(12, 2),
        product_page_sales DECIMAL(12, 2),
        rest_of_search_roas DECIMAL(10, 2),
        rest_of_search_acos DECIMAL(8, 4),
        rest_of_search_spend DECIMAL(12, 2),
        rest_of_search_sales DECIMAL(12, 2),
        suggested_bid_multiplier DECIMAL(5, 3) DEFAULT 1.000,
        suggested_placement_multiplier DECIMAL(5, 3) DEFAULT 1.000,
        suggested_time_multiplier DECIMAL(5, 3) DEFAULT 1.000,
        total_clicks INT DEFAULT 0,
        total_orders INT DEFAULT 0,
        data_points INT DEFAULT 0,
        confidence_level ENUM('high', 'medium', 'low', 'insufficient') DEFAULT 'insufficient',
        analysis_start_date DATE,
        analysis_end_date DATE,
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_mdca_account_campaign (account_id, campaign_id),
        INDEX idx_mdca_keyword (keyword_id),
        INDEX idx_mdca_target (target_id),
        INDEX idx_mdca_category (combo_category),
        INDEX idx_mdca_confidence (confidence_level)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "multi_dim_combo_analysis", results);
    await safeDDL(database, sql`
      ALTER TABLE cold_start_logs ADD COLUMN historical_targets_processed INT DEFAULT 0
    `, "cold_start_logs.historical_targets_processed", results);
    await safeDDL(database, sql`
      ALTER TABLE cold_start_logs ADD COLUMN historical_negatives_processed INT DEFAULT 0
    `, "cold_start_logs.historical_negatives_processed", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS report_jobs (
        id INT NOT NULL AUTO_INCREMENT,
        accountId INT NOT NULL,
        profileId VARCHAR(64) NOT NULL,
        reportType VARCHAR(64) NOT NULL,
        adProduct VARCHAR(32) NOT NULL,
        reportId VARCHAR(128),
        status ENUM('pending', 'submitted', 'processing', 'completed', 'failed', 'expired') NOT NULL DEFAULT 'pending',
        startDate VARCHAR(10) NOT NULL,
        endDate VARCHAR(10) NOT NULL,
        requestPayload JSON,
        downloadUrl TEXT,
        recordsProcessed INT DEFAULT 0,
        errorMessage TEXT,
        retryCount INT DEFAULT 0,
        maxRetries INT DEFAULT 3,
        priority ENUM('critical', 'high', 'medium', 'low') DEFAULT 'medium',
        metadata JSON,
        submittedAt TIMESTAMP NULL,
        completedAt TIMESTAMP NULL,
        processedAt TIMESTAMP NULL,
        expiresAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_report_jobs_account (accountId),
        INDEX idx_report_jobs_status (status),
        INDEX idx_report_jobs_report_id (reportId),
        INDEX idx_report_jobs_profile (profileId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "report_jobs", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS budget_auto_execution_configs (
        id INT NOT NULL AUTO_INCREMENT,
        account_id INT NOT NULL,
        performance_group_id INT,
        config_name VARCHAR(255),
        is_enabled TINYINT DEFAULT 0,
        execution_frequency ENUM('daily', 'weekly', 'biweekly', 'monthly') DEFAULT 'daily',
        execution_time TIME DEFAULT '06:00:00',
        execution_day_of_week INT,
        execution_day_of_month INT,
        min_data_days INT DEFAULT 7,
        min_confidence_score DECIMAL(3,2) DEFAULT 0.70,
        max_budget_change_percent DECIMAL(5,2) DEFAULT 30.00,
        max_adjustment_percent DECIMAL(5,2) DEFAULT 15.00,
        min_budget DECIMAL(10,2) DEFAULT 5.00,
        require_approval TINYINT DEFAULT 0,
        require_approval_above DECIMAL(10,2) DEFAULT 100.00,
        notify_on_execution TINYINT DEFAULT 1,
        notify_on_error TINYINT DEFAULT 1,
        notification_email VARCHAR(255),
        next_execution_at DATETIME,
        last_execution_at DATETIME,
        created_by INT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_account_id (account_id),
        INDEX idx_performance_group_id (performance_group_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "budget_auto_execution_configs", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS budget_auto_execution_history (
        id INT NOT NULL AUTO_INCREMENT,
        config_id INT NOT NULL,
        account_id INT NOT NULL,
        performance_group_id INT,
        execution_type ENUM('scheduled', 'manual', 'emergency') DEFAULT 'scheduled',
        status ENUM('pending', 'running', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
        campaigns_analyzed INT DEFAULT 0,
        campaigns_adjusted INT DEFAULT 0,
        total_budget_before DECIMAL(12,2),
        total_budget_after DECIMAL(12,2),
        total_budget_change DECIMAL(12,2),
        confidence_score DECIMAL(3,2),
        data_days_used INT,
        error_message TEXT,
        execution_details JSON,
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_config_id (config_id),
        INDEX idx_account_id (account_id),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "budget_auto_execution_history", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS budget_auto_execution_details (
        id INT NOT NULL AUTO_INCREMENT,
        execution_id INT,
        history_id INT NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        campaign_name VARCHAR(500),
        previous_budget DECIMAL(10,2) NOT NULL,
        new_budget DECIMAL(10,2) NOT NULL,
        budget_before DECIMAL(10,2),
        budget_after DECIMAL(10,2),
        budget_change DECIMAL(10,2) NOT NULL,
        change_percent DECIMAL(8,2),
        change_reason TEXT,
        performance_score DECIMAL(5,2),
        confidence DECIMAL(3,2),
        api_sync_status ENUM('pending', 'synced', 'failed') DEFAULT 'pending',
        api_sync_detail TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_history_id (history_id),
        INDEX idx_campaign_id (campaign_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "budget_auto_execution_details", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS budget_auto_execution_logs (
        id INT NOT NULL AUTO_INCREMENT,
        execution_id INT,
        history_id INT,
        log_level ENUM('info', 'warn', 'error') DEFAULT 'info',
        message TEXT,
        metadata JSON,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_execution_id (execution_id),
        INDEX idx_history_id (history_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "budget_auto_execution_logs", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS keyword_auto_execution_configs (
        id INT NOT NULL AUTO_INCREMENT,
        account_id INT NOT NULL,
        performance_group_id INT,
        config_name VARCHAR(255),
        is_enabled TINYINT DEFAULT 0,
        execution_frequency ENUM('daily', 'weekly', 'biweekly', 'monthly') DEFAULT 'daily',
        execution_time TIME DEFAULT '06:00:00',
        min_data_days INT DEFAULT 14,
        min_impressions INT DEFAULT 100,
        min_clicks INT DEFAULT 10,
        max_acos_threshold DECIMAL(5,2) DEFAULT 50.00,
        auto_negate_enabled TINYINT DEFAULT 1,
        auto_harvest_enabled TINYINT DEFAULT 1,
        auto_pause_enabled TINYINT DEFAULT 0,
        require_approval TINYINT DEFAULT 0,
        notify_on_execution TINYINT DEFAULT 1,
        next_execution_at DATETIME,
        last_execution_at DATETIME,
        created_by INT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_account_id (account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "keyword_auto_execution_configs", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS keyword_auto_execution_history (
        id INT NOT NULL AUTO_INCREMENT,
        config_id INT NOT NULL,
        account_id INT,
        execution_time DATETIME,
        keywords_paused INT DEFAULT 0,
        keywords_enabled INT DEFAULT 0,
        keywords_skipped INT DEFAULT 0,
        keywords_error INT DEFAULT 0,
        estimated_spend_saved DECIMAL(12,2) DEFAULT 0,
        status ENUM('running','completed','failed','cancelled') DEFAULT 'running',
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_config_id (config_id),
        INDEX idx_account_id (account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, "keyword_auto_execution_history", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS keyword_auto_execution_details (
        id INT NOT NULL AUTO_INCREMENT,
        execution_id INT NOT NULL,
        keyword_id INT NOT NULL,
        keyword_text VARCHAR(500),
        action_type ENUM('pause','enable','rollback') NOT NULL,
        status_before VARCHAR(50),
        status_after VARCHAR(50),
        trigger_reason TEXT,
        spend DECIMAL(10,2),
        sales DECIMAL(10,2),
        acos DECIMAL(10,2),
        roas DECIMAL(10,2),
        clicks INT,
        impression INT,
        orders INT,
        status ENUM('success','failed','skipped','applied') DEFAULT 'success',
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_execution_id (execution_id),
        INDEX idx_keyword_id (keyword_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
     `, "keyword_auto_execution_details", results);
    await safeDDL(database, sql.raw(`
      CREATE TABLE IF NOT EXISTS cql_models (
        id INT AUTO_INCREMENT NOT NULL PRIMARY KEY,
        account_id INT NOT NULL,
        model_version INT DEFAULT 1,
        weights TEXT NOT NULL,
        training_episodes INT DEFAULT 0,
        training_steps INT DEFAULT 0,
        avg_loss DECIMAL(12,8),
        last_trained_at DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_cql_account (account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `), "cql_models", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN time_slot_index INT NULL AFTER change_reason
    `), "optimization_logs.time_slot_index", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN time_slot_label VARCHAR(20) NULL AFTER time_slot_index
    `), "optimization_logs.time_slot_label", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN placement_reason TEXT NULL AFTER time_slot_label
    `), "optimization_logs.placement_reason", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN api_sync_status ENUM('pending','synced','failed','skipped') DEFAULT 'pending' AFTER status
    `), "optimization_logs.api_sync_status", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN api_sync_detail TEXT NULL AFTER api_sync_status
    `), "optimization_logs.api_sync_detail", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN api_synced_at DATETIME NULL AFTER api_sync_detail
    `), "optimization_logs.api_synced_at", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs MODIFY COLUMN log_category ENUM(
        'performance_target', 'bid_adjustment', 'placement_adjustment',
        'budget_adjustment', 'dayparting', 'negative_keyword',
        'optimization_settings'
      ) NOT NULL
    `), "optimization_logs.log_category_expand", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs MODIFY COLUMN action_type ENUM(
        'create_target', 'update_target', 'delete_target', 'pause_target', 'resume_target',
        'add_campaign', 'remove_campaign',
        'bid_increase', 'bid_decrease', 'bid_set', 'bid_auto_adjust',
        'dayparting_bid',
        'budget_adjustment',
        'placement_adjust', 'placement_enable', 'placement_disable',
        'negative_add', 'negative_remove',
        'harvest_keyword', 'harvest_asin',
        'settings_update', 'strategy_change', 'schedule_update'
      ) NOT NULL
    `), "optimization_logs.action_type_expand", results);
    const v418Tables = [
      "keywords",
      "product_targets",
      "search_terms",
      "negative_keywords",
      "bidding_logs",
      "hourly_performance",
      "sd_audiences",
      "optimization_events",
      "keyword_placement_hourly_performance",
      "contextual_features",
      "rl_training_logs"
    ];
    for (const tableName of v418Tables) {
      const changed = await safeDDL(database, sql.raw(`
        ALTER TABLE \`${tableName}\` CHANGE COLUMN \`ad_group_id\` \`internal_ad_group_id\` INT NULL
      `), `${tableName}.ad_group_id\u2192internal_ad_group_id`, results);
      if (!changed) {
        await safeDDL(database, sql.raw(`
          ALTER TABLE \`${tableName}\` ADD COLUMN \`internal_ad_group_id\` INT NULL
        `), `${tableName}.add_internal_ad_group_id`, results);
      }
    }
    await safeDDL(database, sql.raw(`
      ALTER TABLE \`keywords\` MODIFY COLUMN \`keywordStatus\` ENUM('enabled','paused','archived','amazon_deleted') DEFAULT 'enabled'
    `), "keywords.keywordStatus_add_amazon_deleted", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE \`product_targets\` MODIFY COLUMN \`targetStatus\` ENUM('enabled','paused','archived','amazon_deleted') DEFAULT 'enabled'
    `), "product_targets.targetStatus_add_amazon_deleted", results);
    log205.info("v446: \u5F00\u59CB\u6DFB\u52A0\u6027\u80FD\u4F18\u5316\u7D22\u5F15...");
    const v446Indexes = [
      // Tier 1 - 每次同步/优化周期都会查询的核心表
      ["data_sync_jobs", "idx_dsj_accountId", "accountId"],
      ["data_sync_jobs", "idx_dsj_status", "status"],
      ["data_sync_jobs", "idx_dsj_userId", "userId"],
      ["data_sync_jobs", "idx_dsj_account_status", "accountId, status"],
      ["data_sync_jobs", "idx_dsj_startedAt", "startedAt"],
      ["data_sync_logs", "idx_dsl_jobId", "jobId"],
      ["data_sync_logs", "idx_dsl_status", "status"],
      ["hourly_performance", "idx_hp_accountId", "accountId"],
      ["hourly_performance", "idx_hp_campaignId", "campaignId"],
      ["hourly_performance", "idx_hp_date", "date"],
      ["hourly_performance", "idx_hp_account_campaign", "accountId, campaignId"],
      ["placement_performance", "idx_pp_accountId", "accountId"],
      ["placement_performance", "idx_pp_campaignId", "campaignId"],
      ["placement_performance", "idx_pp_date", "date"],
      ["placement_performance", "idx_pp_account_campaign", "accountId, campaignId"],
      ["bid_performance_history", "idx_bph_accountId", "accountId"],
      ["bid_performance_history", "idx_bph_bidObjectId", "bidObjectId"],
      ["bid_performance_history", "idx_bph_account_object", "accountId, bidObjectType, bidObjectId"],
      ["bid_performance_history", "idx_bph_campaignId", "campaignId"],
      ["bid_performance_history", "idx_bph_createdAt", "createdAt"],
      ["bidding_logs", "idx_bl_accountId", "accountId"],
      ["bidding_logs", "idx_bl_campaignId", "campaignId"],
      ["bidding_logs", "idx_bl_targetId", "targetId"],
      ["bidding_logs", "idx_bl_createdAt", "createdAt"],
      ["bidding_logs", "idx_bl_actionType", "actionType"],
      ["performance_groups", "idx_pg_accountId", "accountId"],
      ["performance_groups", "idx_pg_userId", "userId"],
      ["performance_groups", "idx_pg_status", "status"],
      ["performance_groups", "idx_pg_account_status", "accountId, status"],
      ["budget_history", "idx_bh_accountId", "accountId"],
      ["budget_history", "idx_bh_userId", "userId"],
      ["budget_history", "idx_bh_campaignId", "campaignId"],
      ["budget_history", "idx_bh_createdAt", "createdAt"],
      ["audit_logs", "idx_al_accountId", "accountId"],
      ["audit_logs", "idx_al_userId", "userId"],
      ["audit_logs", "idx_al_actionType", "actionType"],
      ["audit_logs", "idx_al_createdAt", "createdAt"],
      ["audit_logs", "idx_al_account_action", "accountId, actionType"],
      ["api_call_logs", "idx_acl_accountId", "accountId"],
      ["api_call_logs", "idx_acl_userId", "userId"],
      ["api_call_logs", "idx_acl_apiType", "apiType"],
      ["api_call_logs", "idx_acl_createdAt", "createdAt"],
      ["api_call_logs", "idx_acl_statusCode", "statusCode"],
      ["api_operation_logs", "idx_aol_accountId", "accountId"],
      ["api_operation_logs", "idx_aol_userId", "userId"],
      ["api_operation_logs", "idx_aol_operationType", "operationType"],
      ["api_operation_logs", "idx_aol_status", "status"],
      ["api_operation_logs", "idx_aol_createdAt", "createdAt"],
      ["api_request_queue", "idx_arq_accountId", "accountId"],
      ["api_request_queue", "idx_arq_status", "status"],
      ["api_request_queue", "idx_arq_priority_status", "priority, status"],
      ["api_request_queue", "idx_arq_scheduledAt", "scheduledAt"],
      ["optimization_recommendations", "idx_or_accountId", "accountId"],
      ["optimization_recommendations", "idx_or_campaignId", "campaignId"],
      ["optimization_recommendations", "idx_or_status", "status"],
      ["optimization_recommendations", "idx_or_priority", "priority"],
      ["optimization_recommendations", "idx_or_account_status", "accountId, status"],
      ["notification_history", "idx_nh_userId", "userId"],
      ["notification_history", "idx_nh_accountId", "accountId"],
      ["notification_history", "idx_nh_status", "status"],
      ["notification_history", "idx_nh_createdAt", "createdAt"],
      ["task_execution_log", "idx_tel_accountId", "accountId"],
      ["task_execution_log", "idx_tel_userId", "userId"],
      ["task_execution_log", "idx_tel_taskType", "taskType"],
      ["task_execution_log", "idx_tel_status", "status"],
      ["task_execution_log", "idx_tel_createdAt", "createdAt"],
      ["batch_operations", "idx_bo_userId", "userId"],
      ["batch_operations", "idx_bo_accountId", "accountId"],
      ["batch_operations", "idx_bo_batchStatus", "batchStatus"],
      ["batch_operations", "idx_bo_createdAt", "createdAt"],
      ["batch_operation_items", "idx_boi_batchId", "batchId"],
      ["batch_operation_items", "idx_boi_itemStatus", "itemStatus"],
      ["dayparting_strategies", "idx_ds_accountId", "accountId"],
      ["dayparting_strategies", "idx_ds_campaignId", "campaignId"],
      ["dayparting_strategies", "idx_ds_account_campaign", "accountId, campaignId"],
      ["auto_pause_records", "idx_apr_accountId", "accountId"],
      ["auto_pause_records", "idx_apr_userId", "userId"],
      ["auto_pause_records", "idx_apr_pausedAt", "pausedAt"],
      ["ad_groups", "idx_adGroups_adGroupId", "adGroupId"],
      ["keywords", "idx_keywords_keywordStatus", "keywordStatus"],
      ["negative_keywords", "idx_negKw_internalAdGroupId", "internal_ad_group_id"],
      ["negative_keywords", "idx_negKw_negativeLevel", "negativeLevel"],
      ["product_targets", "idx_prodTargets_internalAdGroupId", "internal_ad_group_id"],
      ["product_targets", "idx_prodTargets_targetStatus", "targetStatus"]
    ];
    let indexSuccess = 0;
    let indexSkipped = 0;
    for (const [table, idxName, columns] of v446Indexes) {
      try {
        const wrappedCols = columns.split(",").map((c) => {
          const trimmed = c.trim();
          return trimmed.startsWith("`") ? trimmed : `\`${trimmed}\``;
        }).join(", ");
        await database.execute(sql.raw(
          `CREATE INDEX \`${idxName}\` ON \`${table}\` (${wrappedCols})`
        ));
        indexSuccess++;
      } catch (err) {
        const msg = String(err?.message || "");
        const causeMsg = String(err?.cause?.message || err?.cause || "");
        const fullMsg = msg + " | cause: " + causeMsg;
        if (fullMsg.includes("Duplicate key name") || fullMsg.includes("already exists")) {
          indexSkipped++;
        } else {
          log205.warn(`v446: \u7D22\u5F15 ${idxName} \u521B\u5EFA\u5931\u8D25: ${fullMsg}`);
        }
      }
    }
    log205.info(`v446: \u7D22\u5F15\u4F18\u5316\u5B8C\u6210 - \u65B0\u5EFA${indexSuccess}\u4E2A, \u5DF2\u5B58\u5728${indexSkipped}\u4E2A, \u5171${v446Indexes.length}\u4E2A`);
    results.push(`v446\u7D22\u5F15: \u65B0\u5EFA${indexSuccess}, \u5DF2\u5B58\u5728${indexSkipped}, \u5171${v446Indexes.length}`);
    const v450Indexes = [
      // campaigns 表 - 最高频查询表
      ["campaigns", "idx_campaigns_accountId", "accountId"],
      ["campaigns", "idx_campaigns_campaignId", "campaignId"],
      ["campaigns", "idx_campaigns_account_campaign", "accountId, campaignId"],
      ["campaigns", "idx_campaigns_account_status", "accountId, campaignStatus"],
      ["campaigns", "idx_campaigns_account_type", "accountId, campaignType"],
      ["campaigns", "idx_campaigns_perfGroupId", "performanceGroupId"],
      // ad_groups 表
      ["ad_groups", "idx_adGroups_accountId", "accountId"],
      ["ad_groups", "idx_adGroups_campaignId", "campaignId"],
      ["ad_groups", "idx_adGroups_account_campaign", "accountId, campaignId"],
      // daily_performance 表 - 分析查询核心
      ["daily_performance", "idx_dp_accountId", "accountId"],
      ["daily_performance", "idx_dp_account_date", "accountId, date"],
      ["daily_performance", "idx_dp_account_campaign_date", "accountId, campaignId, date"],
      ["daily_performance", "idx_dp_campaignId", "campaignId"],
      // keywords 表 - 补充高频查询索引
      ["keywords", "idx_keywords_accountId", "accountId"],
      ["keywords", "idx_keywords_account_adgroup", "accountId, internalAdGroupId"],
      // optimization_events 表 - 同步率查询 (v460: 修正列名为snake_case)
      ["optimization_events", "idx_oe_account_id", "account_id"],
      ["optimization_events", "idx_oe_account_status", "account_id, api_sync_status"],
      ["optimization_events", "idx_oe_created_at", "created_at"]
    ];
    let v450IndexSuccess = 0;
    let v450IndexSkipped = 0;
    for (const [table, idxName, columns] of v450Indexes) {
      try {
        const wrappedCols = columns.split(",").map((c) => {
          const trimmed = c.trim();
          return trimmed.startsWith("`") ? trimmed : `\`${trimmed}\``;
        }).join(", ");
        await database.execute(sql.raw(
          `CREATE INDEX \`${idxName}\` ON \`${table}\` (${wrappedCols})`
        ));
        v450IndexSuccess++;
      } catch (err) {
        const msg = String(err?.message || "");
        const causeMsg = String(err?.cause?.message || err?.cause || "");
        const fullMsg = msg + " | cause: " + causeMsg;
        if (fullMsg.includes("Duplicate key name") || fullMsg.includes("already exists")) {
          v450IndexSkipped++;
        } else {
          log205.warn(`v450: \u7D22\u5F15 ${idxName} \u521B\u5EFA\u5931\u8D25: ${fullMsg}`);
        }
      }
    }
    log205.info(`v450: \u6838\u5FC3\u8868\u7D22\u5F15\u4F18\u5316\u5B8C\u6210 - \u65B0\u5EFA${v450IndexSuccess}\u4E2A, \u5DF2\u5B58\u5728${v450IndexSkipped}\u4E2A, \u5171${v450Indexes.length}\u4E2A`);
    results.push(`v450\u7D22\u5F15: \u65B0\u5EFA${v450IndexSuccess}, \u5DF2\u5B58\u5728${v450IndexSkipped}, \u5171${v450Indexes.length}`);
    log205.info("v452: \u5F00\u59CB\u591A\u79DF\u6237\u57FA\u7840\u8868\u8FC1\u79FB...");
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS organizations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100),
        type VARCHAR(50) DEFAULT 'external',
        status ENUM('active', 'suspended', 'trial') DEFAULT 'trial',
        subscription_plan VARCHAR(50) DEFAULT 'free',
        subscription_status VARCHAR(50) DEFAULT 'active',
        trial_ends_at DATETIME,
        subscription_ends_at DATETIME,
        owner_id INT,
        max_users INT DEFAULT 5,
        max_accounts INT DEFAULT 3,
        max_ad_accounts INT DEFAULT 3,
        max_campaigns INT DEFAULT 50,
        max_api_calls_per_day INT DEFAULT 10000,
        features JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_slug (slug),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `, "organizations", results);
    try {
      await database.execute(sql`
        INSERT IGNORE INTO organizations (id, name, slug, type, status, subscription_plan, max_users, max_accounts, max_ad_accounts, max_campaigns, max_api_calls_per_day, features)
        VALUES (1, 'Default Organization', 'default', 'internal', 'active', 'enterprise', 9999, 9999, 9999, 9999, 999999, '{"ml_optimization": true, "smart_campaign": true, "advanced_analytics": true, "api_access": true}')
      `);
      results.push("organizations: \u9ED8\u8BA4\u7EC4\u7EC7\u5DF2\u5C31\u7EEA");
    } catch (e) {
    }
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS invite_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(32) NOT NULL,
        created_by INT NOT NULL,
        organization_id INT,
        invite_type ENUM('team_member', 'external_user') DEFAULT 'external_user',
        max_uses INT DEFAULT 1,
        used_count INT DEFAULT 0,
        used_by INT,
        expires_at TIMESTAMP NULL,
        is_active TINYINT DEFAULT 1,
        note VARCHAR(255),
        used_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_code (code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `, "invite_codes", results);
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS invite_code_usages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invite_code_id INT NOT NULL,
        user_id INT NOT NULL,
        organization_id INT,
        used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT,
        INDEX idx_invite_code (invite_code_id),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `, "invite_code_usages", results);
    try {
      await database.execute(sql.raw("ALTER TABLE team_members ADD COLUMN organization_id INT DEFAULT 1"));
      results.push("team_members: \u6DFB\u52A0 organization_id \u5217");
    } catch (e) {
      if (!isAlreadyExistsError(e)) log205.warn("team_members.organization_id: " + e.message);
    }
    try {
      await database.execute(sql.raw("ALTER TABLE team_members ADD COLUMN username VARCHAR(255)"));
      results.push("team_members: \u6DFB\u52A0 username \u5217");
    } catch (e) {
      if (!isAlreadyExistsError(e)) log205.warn("team_members.username: " + e.message);
    }
    try {
      await database.execute(sql.raw("ALTER TABLE team_members ADD COLUMN password_hash VARCHAR(255)"));
      results.push("team_members: \u6DFB\u52A0 password_hash \u5217");
    } catch (e) {
      if (!isAlreadyExistsError(e)) log205.warn("team_members.password_hash: " + e.message);
    }
    try {
      await database.execute(sql.raw("ALTER TABLE team_members ADD COLUMN last_login_at TIMESTAMP NULL"));
      results.push("team_members: \u6DFB\u52A0 last_login_at \u5217");
    } catch (e) {
      if (!isAlreadyExistsError(e)) log205.warn("team_members.last_login_at: " + e.message);
    }
    log205.info(`v452: \u591A\u79DF\u6237\u57FA\u7840\u8868\u8FC1\u79FB\u5B8C\u6210`);
    log205.info("v508: \u5F00\u59CB\u4FEE\u590D optimization_events.api_sync_status \u5217\u7C7B\u578B...");
    try {
      await database.execute(sql.raw(`
        ALTER TABLE optimization_events 
        MODIFY COLUMN api_sync_status VARCHAR(32) DEFAULT 'pending'
      `));
      results.push("optimization_events: api_sync_status \u5DF2\u4ECE ENUM \u6539\u4E3A VARCHAR(32)");
      log205.info("v508: optimization_events.api_sync_status \u5DF2\u6539\u4E3A VARCHAR(32)");
    } catch (e) {
      const msg = e.message;
      if (!msg.includes("already") && !msg.includes("Duplicate")) {
        log205.warn("v508: ALTER TABLE optimization_events \u5931\u8D25: " + msg);
      }
      results.push("optimization_events: api_sync_status \u7C7B\u578B\u53D8\u66F4\u8DF3\u8FC7 - " + msg);
    }
    try {
      await database.execute(sql.raw(`
        ALTER TABLE optimization_logs 
        MODIFY COLUMN api_sync_status VARCHAR(32) DEFAULT 'pending'
      `));
      results.push("optimization_logs: api_sync_status \u5DF2\u4ECE ENUM \u6539\u4E3A VARCHAR(32)");
      log205.info("v508: optimization_logs.api_sync_status \u5DF2\u6539\u4E3A VARCHAR(32)");
    } catch (e) {
      log205.warn("v508: ALTER TABLE optimization_logs \u5931\u8D25: " + e.message);
    }
    try {
      const [supersededResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'superseded'
        WHERE (api_sync_status = '' OR api_sync_status IS NULL)
          AND (error_message LIKE '%superseded%' OR error_message LIKE '%\u8FC7\u65F6%')
      `));
      const supersededCount = supersededResult.affectedRows || 0;
      log205.info(`v508: \u56DE\u586B superseded \u72B6\u6001: ${supersededCount} \u6761`);
      const [permFailResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed'
        WHERE (api_sync_status = '' OR api_sync_status IS NULL)
          AND (error_message LIKE '%permanently_failed%' OR error_message LIKE '%\u6C38\u4E45%')
      `));
      const permFailCount = permFailResult.affectedRows || 0;
      log205.info(`v508: \u56DE\u586B permanently_failed \u72B6\u6001: ${permFailCount} \u6761`);
      const [daypartResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'superseded',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: \u5206\u65F6\u7ADE\u4EF7\u5386\u53F2\u8BB0\u5F55\uFF0C\u6807\u8BB0\u4E3Asuperseded')
        WHERE (api_sync_status = '' OR api_sync_status IS NULL)
          AND action_type = 'dayparting_bid'
          AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `));
      const daypartCount = daypartResult.affectedRows || 0;
      log205.info(`v508: \u56DE\u586B dayparting_bid superseded: ${daypartCount} \u6761`);
      const [remainResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: \u5386\u53F2\u9057\u7559\u7A7A\u72B6\u6001\uFF0C\u6807\u8BB0\u4E3Apermanently_failed')
        WHERE api_sync_status = '' OR api_sync_status IS NULL
      `));
      const remainCount = remainResult.affectedRows || 0;
      log205.info(`v508: \u56DE\u586B\u5269\u4F59\u7A7A\u72B6\u6001: ${remainCount} \u6761`);
      results.push(`v508: \u7A7A\u5B57\u7B26\u4E32\u56DE\u586B\u5B8C\u6210 - superseded=${supersededCount + daypartCount}, permanently_failed=${permFailCount + remainCount}`);
    } catch (e) {
      log205.warn("v508: \u7A7A\u5B57\u7B26\u4E32\u56DE\u586B\u5931\u8D25: " + e.message);
    }
    try {
      const [cleanupResult] = await database.execute(sql.raw(`
        UPDATE optimization_events oe
        LEFT JOIN keywords k ON oe.keyword_id = k.id
        SET oe.api_sync_status = 'permanently_failed',
            oe.error_message = CONCAT(COALESCE(oe.error_message, ''), ' | v508: \u5173\u952E\u8BCD\u5DF2\u4E0D\u5B58\u5728\u6216\u5DF2\u5F52\u6863')
        WHERE oe.api_sync_status = 'failed'
          AND oe.action_type IN ('bid_increase', 'bid_decrease', 'dayparting_bid')
          AND oe.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND (k.id IS NULL OR k.status IN ('archived', 'deleted', 'paused'))
      `));
      const cleanupCount = cleanupResult.affectedRows || 0;
      log205.info(`v508: \u6E05\u7406\u8FC7\u671F\u5931\u8D25\u8BB0\u5F55: ${cleanupCount} \u6761 (\u5173\u952E\u8BCD\u5DF2\u4E0D\u5B58\u5728\u6216\u5DF2\u5F52\u6863)`);
      results.push(`v508: \u6E05\u7406\u8FC7\u671F\u5931\u8D25\u8BB0\u5F55: ${cleanupCount} \u6761`);
    } catch (e) {
      log205.warn("v508: \u6E05\u7406\u8FC7\u671F\u5931\u8D25\u8BB0\u5F55\u5931\u8D25: " + e.message);
    }
    try {
      const [syncedBackfill] = await database.execute(sql.raw(`
        UPDATE optimization_events oe
        INNER JOIN optimization_tasks ot 
          ON oe.keyword_id = ot.target_entity_id 
          AND ot.task_type = 'bid_adjustment'
          AND ot.status = 'synced'
          AND ABS(TIMESTAMPDIFF(MINUTE, oe.created_at, ot.created_at)) < 60
        SET oe.api_sync_status = 'synced',
            oe.error_message = CONCAT(COALESCE(oe.error_message, ''), ' | v508: \u901A\u8FC7optimization_tasks\u56DE\u5199synced')
        WHERE oe.api_sync_status = 'not_applicable'
          AND oe.action_type IN ('bid_increase', 'bid_decrease')
          AND oe.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      `));
      const syncedBackfillCount = syncedBackfill.affectedRows || 0;
      log205.info(`v508: \u56DE\u5199 not_applicable \u2192 synced: ${syncedBackfillCount} \u6761`);
      const [oldNaResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: \u5386\u53F2\u9057\u7559not_applicable\uFF0C\u65E0\u6CD5\u8FFD\u6EAF\u540C\u6B65\u72B6\u6001')
        WHERE api_sync_status = 'not_applicable'
          AND action_type IN ('bid_increase', 'bid_decrease')
          AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
      `));
      const oldNaCount = oldNaResult.affectedRows || 0;
      log205.info(`v508: \u56DE\u5199 old not_applicable \u2192 permanently_failed: ${oldNaCount} \u6761`);
      const [recentNaResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'pending',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: \u91CD\u7F6E\u4E3Apending\u7B49\u5F85\u91CD\u65B0\u540C\u6B65')
        WHERE api_sync_status = 'not_applicable'
          AND action_type IN ('bid_increase', 'bid_decrease')
          AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `));
      const recentNaCount = recentNaResult.affectedRows || 0;
      log205.info(`v508: \u56DE\u5199 recent not_applicable \u2192 pending: ${recentNaCount} \u6761`);
      const [legacyResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: invalid_legacy\u5386\u53F2\u6570\u636E\u5F52\u6863')
        WHERE api_sync_status = 'invalid_legacy'
      `));
      const legacyCount = legacyResult.affectedRows || 0;
      log205.info(`v508: \u56DE\u5199 invalid_legacy \u2192 permanently_failed: ${legacyCount} \u6761`);
      const [otherNaResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: \u975E\u51FA\u4EF7\u7C7B\u578B\u5386\u53F2not_applicable\u5F52\u6863')
        WHERE api_sync_status = 'not_applicable'
          AND action_type NOT IN ('bid_increase', 'bid_decrease', 'safety_summary', 'safety_pause', 'auto_correction')
          AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
      `));
      const otherNaCount = otherNaResult.affectedRows || 0;
      log205.info(`v508: \u56DE\u5199 other not_applicable \u2192 permanently_failed: ${otherNaCount} \u6761`);
      results.push(`v508: not_applicable\u56DE\u5199\u5B8C\u6210 - synced=${syncedBackfillCount}, permanently_failed=${oldNaCount + legacyCount + otherNaCount}, pending=${recentNaCount}`);
    } catch (e) {
      log205.warn("v508: not_applicable\u56DE\u5199\u5931\u8D25: " + e.message);
    }
    log205.info(`v508: \u6570\u636E\u5E93\u81EA\u52A8\u8FC1\u79FB\u5B8C\u6210, \u7ED3\u679C: ${results.join("; ")}`);
    log205.info("v509: \u5F00\u59CB\u6DFB\u52A0 optimization_tasks.event_id \u5916\u952E\u5217...");
    try {
      await database.execute(sql.raw(`
        ALTER TABLE optimization_tasks 
        ADD COLUMN event_id INT NULL DEFAULT NULL COMMENT 'v509: optimization_events.id \u5916\u952E'
      `));
      results.push("optimization_tasks: \u6DFB\u52A0 event_id \u5217");
      log205.info("v509: optimization_tasks.event_id \u5217\u5DF2\u6DFB\u52A0");
    } catch (e) {
      const msg = e.message;
      if (msg.includes("Duplicate column")) {
        log205.info("v509: optimization_tasks.event_id \u5217\u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7");
      } else {
        log205.warn("v509: \u6DFB\u52A0 event_id \u5217\u5931\u8D25: " + msg);
      }
    }
    try {
      await database.execute(sql.raw(`
        ALTER TABLE optimization_tasks 
        ADD INDEX idx_event_id (event_id)
      `));
      results.push("optimization_tasks: \u6DFB\u52A0 idx_event_id \u7D22\u5F15");
      log205.info("v509: idx_event_id \u7D22\u5F15\u5DF2\u6DFB\u52A0");
    } catch (e) {
      const msg = e.message;
      if (msg.includes("Duplicate key name") || msg.includes("already exists")) {
        log205.info("v509: idx_event_id \u7D22\u5F15\u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7");
      } else {
        log205.warn("v509: \u6DFB\u52A0 idx_event_id \u7D22\u5F15\u5931\u8D25: " + msg);
      }
    }
    try {
      const [backfillResult] = await database.execute(sql.raw(`
        UPDATE optimization_tasks ot
        INNER JOIN optimization_events oe 
          ON oe.keyword_id = ot.target_entity_id 
          AND oe.account_id = ot.account_id
          AND ot.task_type = 'bid_adjustment'
          AND oe.action_type IN ('bid_increase', 'bid_decrease')
          AND ABS(TIMESTAMPDIFF(MINUTE, oe.created_at, ot.created_at)) < 30
        SET ot.event_id = oe.id
        WHERE ot.event_id IS NULL
          AND ot.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      `));
      const backfillCount = backfillResult.affectedRows || 0;
      log205.info(`v509: \u56DE\u586B event_id: ${backfillCount} \u6761\u4EFB\u52A1\u5DF2\u5173\u8054`);
      results.push(`v509: event_id\u56DE\u586B ${backfillCount} \u6761`);
    } catch (e) {
      log205.warn("v509: event_id\u56DE\u586B\u5931\u8D25: " + e.message);
    }
    try {
      const [syncedResult] = await database.execute(sql.raw(`
        UPDATE optimization_events oe
        INNER JOIN optimization_tasks ot ON ot.event_id = oe.id
        SET oe.api_sync_status = 'synced', 
            oe.api_synced_at = ot.completed_at,
            oe.error_message = CONCAT(COALESCE(oe.error_message, ''), ' | v509: event_id\u56DE\u5199synced')
        WHERE oe.api_sync_status IN ('pending', 'failed')
          AND ot.status = 'synced'
      `));
      const syncedCount = syncedResult.affectedRows || 0;
      const [pfResult] = await database.execute(sql.raw(`
        UPDATE optimization_events oe
        INNER JOIN optimization_tasks ot ON ot.event_id = oe.id
        SET oe.api_sync_status = 'permanently_failed',
            oe.error_message = CONCAT(COALESCE(oe.error_message, ''), ' | v509: event_id\u56DE\u5199permanently_failed: ', COALESCE(ot.error_message, ''))
        WHERE oe.api_sync_status IN ('pending', 'failed')
          AND ot.status = 'permanently_failed'
      `));
      const pfCount = pfResult.affectedRows || 0;
      log205.info(`v509: event_id\u56DE\u5199\u5B8C\u6210 - synced=${syncedCount}, permanently_failed=${pfCount}`);
      results.push(`v509: event_id\u72B6\u6001\u56DE\u5199 synced=${syncedCount}, permanently_failed=${pfCount}`);
    } catch (e) {
      log205.warn("v509: event_id\u72B6\u6001\u56DE\u5199\u5931\u8D25: " + e.message);
    }
    try {
      log205.info("v513: \u5F00\u59CB\u5386\u53F2\u5185\u90E8\u4E8B\u4EF6\u91CD\u5206\u7C7B...");
      const [internalResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'internal'
        WHERE action_type IN ('settings_update', 'auto_correction', 'algorithm_config', 'strategy_update', 'system_config', 'system_deploy', 'target_reoptimized', 'system_heartbeat')
          AND api_sync_status != 'internal'
      `));
      const internalCount = internalResult.affectedRows || 0;
      log205.info(`v513: \u5386\u53F2\u5185\u90E8\u4E8B\u4EF6\u91CD\u5206\u7C7B\u5B8C\u6210: ${internalCount}\u6761\u8BB0\u5F55\u5DF2\u66F4\u65B0\u4E3A internal`);
      results.push(`v513: \u5185\u90E8\u4E8B\u4EF6\u91CD\u5206\u7C7B ${internalCount}\u6761`);
    } catch (e) {
      log205.warn("v513: \u5386\u53F2\u5185\u90E8\u4E8B\u4EF6\u91CD\u5206\u7C7B\u5931\u8D25: " + e.message);
    }
    await safeDDL(database, sql.raw(`
      ALTER TABLE ad_accounts ADD COLUMN sbCapability TINYINT NULL DEFAULT NULL COMMENT 'v614i-fix23: SB\u6743\u9650\u72B6\u6001(0=\u65E0\u6743\u9650,1=\u6709\u6743\u9650,NULL=\u672A\u68C0\u6D4B)'
    `), "v614i-fix23: ad_accounts.sbCapability", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE ad_accounts ADD COLUMN sdCapability TINYINT NULL DEFAULT NULL COMMENT 'v614i-fix23: SD\u6743\u9650\u72B6\u6001(0=\u65E0\u6743\u9650,1=\u6709\u6743\u9650,NULL=\u672A\u68C0\u6D4B)'
    `), "v614i-fix23: ad_accounts.sdCapability", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE ad_accounts ADD COLUMN sbCapabilityCheckedAt TIMESTAMP NULL DEFAULT NULL COMMENT 'v614i-fix23: SB\u6743\u9650\u6700\u540E\u68C0\u6D4B\u65F6\u95F4'
    `), "v614i-fix23: ad_accounts.sbCapabilityCheckedAt", results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE ad_accounts ADD COLUMN sdCapabilityCheckedAt TIMESTAMP NULL DEFAULT NULL COMMENT 'v614i-fix23: SD\u6743\u9650\u6700\u540E\u68C0\u6D4B\u65F6\u95F4'
    `), "v614i-fix23: ad_accounts.sdCapabilityCheckedAt", results);
    await safeDDL(database, sql.raw(`
      CREATE TABLE IF NOT EXISTS sync_tasks_v2 (
        id INT AUTO_INCREMENT PRIMARY KEY,
        task_id VARCHAR(64) NOT NULL COMMENT '\u5168\u5C40\u552F\u4E00\u4EFB\u52A1ID',
        tier ENUM('high', 'medium', 'full', 'confirmation') NOT NULL COMMENT '\u540C\u6B65\u5C42\u7EA7',
        status ENUM('pending', 'running', 'partial_success', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
        total_shards INT NOT NULL DEFAULT 0,
        completed_shards INT NOT NULL DEFAULT 0,
        failed_shards INT NOT NULL DEFAULT 0,
        total_records_synced INT NOT NULL DEFAULT 0,
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        trigger_source VARCHAR(50),
        error_summary TEXT,
        UNIQUE KEY uk_task_id (task_id),
        INDEX idx_status (status),
        INDEX idx_tier_status (tier, status),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `), "v614i: sync_tasks_v2", results);
    await safeDDL(database, sql.raw(`
      CREATE TABLE IF NOT EXISTS sync_shards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        shard_id VARCHAR(128) NOT NULL COMMENT '\u5206\u7247\u552F\u4E00\u6807\u8BC6',
        task_id VARCHAR(64) NOT NULL COMMENT '\u5173\u8054\u7684sync_tasks_v2.task_id',
        start_index INT NOT NULL DEFAULT 0,
        end_index INT NOT NULL DEFAULT 0,
        status ENUM('pending', 'running', 'completed', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
        processed_count INT NOT NULL DEFAULT 0,
        records_synced INT NOT NULL DEFAULT 0,
        error_message TEXT,
        retry_count INT NOT NULL DEFAULT 0,
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        duration_ms INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_shard_id (shard_id),
        INDEX idx_task_id (task_id),
        INDEX idx_status (status),
        INDEX idx_task_status (task_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `), "v614i: sync_shards", results);
    // v596b: Add missing amazon_negative_keyword_id column to negative_keywords table
    await safeDDL(database, sql`
      ALTER TABLE negative_keywords ADD COLUMN amazon_negative_keyword_id VARCHAR(64) DEFAULT NULL
    `, "v596b: negative_keywords.amazon_negative_keyword_id", results);
    // fix24-P3v3-4.2: 先检查索引是否已存在，避免每次重启报Failed query
    try {
      const idxCheckResult = await database.execute(sql`SELECT COUNT(*) as cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'negative_keywords' AND index_name = 'idx_neg_kw_amazon_id'`);
      const idxCount = idxCheckResult?.[0]?.[0]?.cnt ?? idxCheckResult?.rows?.[0]?.cnt ?? 0;
      if (Number(idxCount) === 0) {
        await safeDDL(database, sql`CREATE INDEX idx_neg_kw_amazon_id ON negative_keywords (amazon_negative_keyword_id)`, "v596b: idx_neg_kw_amazon_id", results);
      } else {
        results.push("v596b: idx_neg_kw_amazon_id: already exists (skip)");
      }
    } catch (idxErr42) {
      results.push("v596b: idx_neg_kw_amazon_id: check failed (" + idxErr42.message + "), skip");
    }
    log205.info(`v596b: \u6570\u636E\u5E93\u81EA\u52A8\u8FC1\u79FB\u5B8C\u6210, \u7ED3\u679C: ${results.join("; ")}`);
    return { success: true, results };
  } catch (error48) {
    log205.warn(`v418: \u6570\u636E\u5E93\u81EA\u52A8\u8FC1\u79FB\u5F02\u5E38: ${error48.message}`);
    return { success: false, results: [`\u8FC1\u79FB\u5F02\u5E38: ${error48.message}`] };
  }
}
var log205;
var init_dbAutoMigration = __esm({
  "server/dbAutoMigration.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    log205 = createModuleLogger("AutoDbMigration");
    __name(isAlreadyExistsError, "isAlreadyExistsError");
    __name(safeDDL, "safeDDL");
    __name(runAutoDbMigration, "runAutoDbMigration");
  }
});

