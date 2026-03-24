/**
 * v248→v347: 数据库自动迁移模块 (Database Auto-Migration)
 * 
 * 在系统启动时自动检查并创建所需的数据库表和列。
 * 使用 CREATE TABLE IF NOT EXISTS 和 ALTER TABLE ... ADD COLUMN 确保幂等性。
 * 
 * v248 修复：
 * - anomaly_alert_logs 表：v245引入但从未自动创建
 * - emergency_optimization_queue 表：v245引入但从未自动创建
 * - module_execution_times 列：v242 drizzle迁移未执行
 * 
 * v347 修复：
 * - keyword_placement_hourly_performance 表：schema中定义但从未创建（分时竞价瘫痪根因）
 * - multi_dim_combo_analysis 表：schema中定义但从未创建
 * - anomaly_alert_logs.message 列扩展为 MEDIUMTEXT（支持大JSON）
 * - cold_start_logs 缺失列补全
 * 
 * 列名规则（匹配 Drizzle ORM casing: 'camelCase' 配置）：
 * - 有显式列名映射的字段：使用指定的 snake_case 列名
 *   例如 accountId: int("account_id") → 列名 `account_id`
 * - 无显式列名的字段：使用 schema 中的驼峰字段名
 *   例如 placement: mysqlEnum(...) → 列名 `placement`
 */

import { getDb } from './db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('AutoDbMigration');

/**
 * 检查MySQL错误是否为"已存在"类型（表/列已存在），可安全忽略
 */
function isAlreadyExistsError(err: Error): boolean {
  const message = String(err?.message || '');
  // @ts-expect-error - error message access
  const causeMessage = String(err?.cause?.message || err?.cause || '');
  const combined = message + ' ' + causeMessage;
  
  // MySQL错误码：1060=Duplicate column name, 1050=Table already exists, 1054=Unknown column (CHANGE COLUMN时源列已不存在)
  return combined.includes('Duplicate column') ||
         combined.includes('already exists') ||
         combined.includes('Unknown column') ||
         combined.includes('1060') ||
         combined.includes('1050') ||
         combined.includes('1054');
}

/**
 * 安全执行DDL语句，自动处理"已存在"错误
 */
async function safeDDL(database: unknown, ddlSql: unknown, tableName: string, results: string[]): Promise<boolean> {
  try {
    await database.execute(ddlSql);
    results.push(`${tableName}: 已就绪`);
    log.info(`${tableName} 已就绪`);
    return true;
  } catch (err: unknown) {
    // @ts-expect-error - runtime type mismatch
    if (isAlreadyExistsError(err)) {
      results.push(`${tableName}: 已存在（跳过）`);
      return true;
    } else {
      results.push(`${tableName}: 失败 - ${(err as Error).message}`);
      log.warn(`${tableName} 操作失败 (可能已应用): ${(err as Error).message}`);
      return false;
    }
  }
}

export async function runAutoDbMigration(): Promise<{ success: boolean; results: string[] }> {
  const results: string[] = [];
  
  try {
    const database = await getDb();
    if (!database) {
      log.warn('数据库不可用，跳过自动迁移');
      return { success: false, results: ['数据库不可用'] };
    }

    log.info('v347: 开始数据库自动迁移检查...');

    // ============================================================
    // 1. anomaly_alert_logs 表
    // v369.6: 表已由 Drizzle migration 0019 创建，此处仅作为安全回退
    // 实际列名: rule_id, user_id, account_id, trigger_value, threshold_value,
    //   trigger_description, action_taken, notification_sent, status, created_at 等
    // ============================================================
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
    `, 'anomaly_alert_logs', results);

    // v369.6: 不再尝试ALTER TABLE修改不存在的message列

    // ============================================================
    // 2. emergency_optimization_queue 表（v245 riskActionEngine 使用 camelCase 列名）
    // ============================================================
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
    `, 'emergency_optimization_queue', results);

    // ============================================================
    // 3. module_execution_times 列 → performance_groups 表
    // ============================================================
    await safeDDL(database, sql`
      ALTER TABLE performance_groups ADD COLUMN module_execution_times TEXT DEFAULT NULL
    `, 'performance_groups.module_execution_times', results);

    // ============================================================
    // 4. v347: keyword_placement_hourly_performance 表
    //    分时竞价/位置倾斜的核心数据表，schema中定义但从未创建
    //    列名遵循 casing: 'camelCase' 规则：
    //    - 有显式映射的用 snake_case: account_id, campaign_id, ad_group_id, keyword_id,
    //      target_id, day_of_week, units_sold, data_source, created_at, updated_at
    //    - 无显式映射的用 camelCase: id, placement, date, hour, impressions, clicks,
    //      spend, sales, orders, acos, roas, ctr, cvr, cpc
    // ============================================================
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
    `, 'keyword_placement_hourly_performance', results);

    // ============================================================
    // 5. v347: multi_dim_combo_analysis 表
    //    多维度组合分析结果表，schema中定义但从未创建
    // ============================================================
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
    `, 'multi_dim_combo_analysis', results);

    // ============================================================
    // 6. v347: cold_start_logs 缺失列补全
    //    确保 historical_targets_processed 和 historical_negatives_processed 列存在
    // ============================================================
    await safeDDL(database, sql`
      ALTER TABLE cold_start_logs ADD COLUMN historical_targets_processed INT DEFAULT 0
    `, 'cold_start_logs.historical_targets_processed', results);

    await safeDDL(database, sql`
      ALTER TABLE cold_start_logs ADD COLUMN historical_negatives_processed INT DEFAULT 0
    `, 'cold_start_logs.historical_negatives_processed', results);

    // ============================================================
    // 7. v349: report_jobs 表
    //    报告任务队列表，schema中定义但从未创建，导致所有report_jobs查询失败
    // ============================================================
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
    `, 'report_jobs', results);

    // ============================================================
    // v369: budget_auto_execution_configs 表
    //    预算自动执行配置表，schema中定义但从未创建，导致预算自动执行服务全部失败
    // ============================================================
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
    `, 'budget_auto_execution_configs', results);

    // ============================================================
    // v369: budget_auto_execution_history 表
    // ============================================================
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
    `, 'budget_auto_execution_history', results);

    // ============================================================
    // v369: budget_auto_execution_details 表
    // ============================================================
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
    `, 'budget_auto_execution_details', results);

    // ============================================================
    // v369: budget_auto_execution_logs 表
    // ============================================================
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
    `, 'budget_auto_execution_logs', results);

    // ============================================================
    // v369: keyword_auto_execution_configs 表
    //    关键词自动执行配置表，schema中定义但从未创建
    // ============================================================
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
    `, 'keyword_auto_execution_configs', results);

    // ============================================================
    // v369: keyword_auto_execution_history 表
    //    关键词自动执行历史记录表
    // ============================================================
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
    `, 'keyword_auto_execution_history', results);

    // ============================================================
    // v369: keyword_auto_execution_details 表
    //    关键词自动执行详情表
    // ============================================================
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
     `, 'keyword_auto_execution_details', results);

    // v369.5: cql_models 表 - CQL离线RL模型存储
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
    `), 'cql_models', results);

    // v369.5: optimization_logs 表添加缺失的列
    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN time_slot_index INT NULL AFTER change_reason
    `), 'optimization_logs.time_slot_index', results);

    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN time_slot_label VARCHAR(20) NULL AFTER time_slot_index
    `), 'optimization_logs.time_slot_label', results);

    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN placement_reason TEXT NULL AFTER time_slot_label
    `), 'optimization_logs.placement_reason', results);

    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN api_sync_status ENUM('pending','synced','failed','skipped') DEFAULT 'pending' AFTER status
    `), 'optimization_logs.api_sync_status', results);

    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN api_sync_detail TEXT NULL AFTER api_sync_status
    `), 'optimization_logs.api_sync_detail', results);

    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs ADD COLUMN api_synced_at DATETIME NULL AFTER api_sync_detail
    `), 'optimization_logs.api_synced_at', results);

    // v369.5: optimization_logs 扩展 log_category ENUM
    await safeDDL(database, sql.raw(`
      ALTER TABLE optimization_logs MODIFY COLUMN log_category ENUM(
        'performance_target', 'bid_adjustment', 'placement_adjustment',
        'budget_adjustment', 'dayparting', 'negative_keyword',
        'optimization_settings'
      ) NOT NULL
    `), 'optimization_logs.log_category_expand', results);

    // v369.5: optimization_logs 扩展 action_type ENUM
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
    `), 'optimization_logs.action_type_expand', results);

    // ==================== v418: ID体系一致性重构 ====================
    // 将存储内部adGroup ID的varchar列重命名为internalAdGroupId(int)
    // 使用CHANGE COLUMN同时完成重命名和类型变更
    // 注意：MySQL CHANGE COLUMN是幂等安全的（如果列已经是目标名称则会报错，被safeDDL捕获）
    const v418Tables = [
      'keywords', 'product_targets', 'search_terms', 'negative_keywords',
      'bidding_logs', 'hourly_performance', 'sd_audiences',
      'optimization_events', 'keyword_placement_hourly_performance',
      'contextual_features', 'rl_training_logs'
    ];
    for (const tableName of v418Tables) {
      // 先尝试CHANGE COLUMN（从varchar ad_group_id到int internal_ad_group_id）
      const changed = await safeDDL(database, sql.raw(`
        ALTER TABLE \`${tableName}\` CHANGE COLUMN \`ad_group_id\` \`internal_ad_group_id\` INT NULL
      `), `${tableName}.ad_group_id→internal_ad_group_id`, results);
      // v458: 如果CHANGE失败（ad_group_id列不存在），尝试ADD COLUMN确保internal_ad_group_id存在
      if (!changed) {
        await safeDDL(database, sql.raw(`
          ALTER TABLE \`${tableName}\` ADD COLUMN \`internal_ad_group_id\` INT NULL
        `), `${tableName}.add_internal_ad_group_id`, results);
      }
    }

    // ==================== v458: 扩展状态枚举支持amazon_deleted ====================
    // keywords.keywordStatus和product_targets.targetStatus枚举需要包含'amazon_deleted'
    // 用于标记Amazon端已删除但本地仍存在的实体
    await safeDDL(database, sql.raw(`
      ALTER TABLE \`keywords\` MODIFY COLUMN \`keywordStatus\` ENUM('enabled','paused','archived','amazon_deleted') DEFAULT 'enabled'
    `), 'keywords.keywordStatus_add_amazon_deleted', results);
    await safeDDL(database, sql.raw(`
      ALTER TABLE \`product_targets\` MODIFY COLUMN \`targetStatus\` ENUM('enabled','paused','archived','amazon_deleted') DEFAULT 'enabled'
    `), 'product_targets.targetStatus_add_amazon_deleted', results);

    // ==================== v446: 数据库索引性能优化 ====================
    // 为19个高频查询表添加84个缺失索引，覆盖所有核心WHERE条件
    // 使用CREATE INDEX IF NOT EXISTS确保幂等性
    log.info('v446: 开始添加性能优化索引...');
    const v446Indexes: [string, string, string][] = [
      // Tier 1 - 每次同步/优化周期都会查询的核心表
      ['data_sync_jobs', 'idx_dsj_accountId', 'accountId'],
      ['data_sync_jobs', 'idx_dsj_status', 'status'],
      ['data_sync_jobs', 'idx_dsj_userId', 'userId'],
      ['data_sync_jobs', 'idx_dsj_account_status', 'accountId, status'],
      ['data_sync_jobs', 'idx_dsj_startedAt', 'startedAt'],
      ['data_sync_logs', 'idx_dsl_jobId', 'jobId'],
      ['data_sync_logs', 'idx_dsl_status', 'status'],
      ['hourly_performance', 'idx_hp_accountId', 'accountId'],
      ['hourly_performance', 'idx_hp_campaignId', 'campaignId'],
      ['hourly_performance', 'idx_hp_date', 'date'],
      ['hourly_performance', 'idx_hp_account_campaign', 'accountId, campaignId'],
      ['placement_performance', 'idx_pp_accountId', 'accountId'],
      ['placement_performance', 'idx_pp_campaignId', 'campaignId'],
      ['placement_performance', 'idx_pp_date', 'date'],
      ['placement_performance', 'idx_pp_account_campaign', 'accountId, campaignId'],
      ['bid_performance_history', 'idx_bph_accountId', 'accountId'],
      ['bid_performance_history', 'idx_bph_bidObjectId', 'bidObjectId'],
      ['bid_performance_history', 'idx_bph_account_object', 'accountId, bidObjectType, bidObjectId'],
      ['bid_performance_history', 'idx_bph_campaignId', 'campaignId'],
      ['bid_performance_history', 'idx_bph_createdAt', 'createdAt'],
      ['bidding_logs', 'idx_bl_accountId', 'accountId'],
      ['bidding_logs', 'idx_bl_campaignId', 'campaignId'],
      ['bidding_logs', 'idx_bl_targetId', 'targetId'],
      ['bidding_logs', 'idx_bl_createdAt', 'createdAt'],
      ['bidding_logs', 'idx_bl_actionType', 'actionType'],
      ['performance_groups', 'idx_pg_accountId', 'accountId'],
      ['performance_groups', 'idx_pg_userId', 'userId'],
      ['performance_groups', 'idx_pg_status', 'status'],
      ['performance_groups', 'idx_pg_account_status', 'accountId, status'],
      ['budget_history', 'idx_bh_accountId', 'accountId'],
      ['budget_history', 'idx_bh_userId', 'userId'],
      ['budget_history', 'idx_bh_campaignId', 'campaignId'],
      ['budget_history', 'idx_bh_createdAt', 'createdAt'],
      ['audit_logs', 'idx_al_accountId', 'accountId'],
      ['audit_logs', 'idx_al_userId', 'userId'],
      ['audit_logs', 'idx_al_actionType', 'actionType'],
      ['audit_logs', 'idx_al_createdAt', 'createdAt'],
      ['audit_logs', 'idx_al_account_action', 'accountId, actionType'],
      ['api_call_logs', 'idx_acl_accountId', 'accountId'],
      ['api_call_logs', 'idx_acl_userId', 'userId'],
      ['api_call_logs', 'idx_acl_apiType', 'apiType'],
      ['api_call_logs', 'idx_acl_createdAt', 'createdAt'],
      ['api_call_logs', 'idx_acl_statusCode', 'statusCode'],
      ['api_operation_logs', 'idx_aol_accountId', 'accountId'],
      ['api_operation_logs', 'idx_aol_userId', 'userId'],
      ['api_operation_logs', 'idx_aol_operationType', 'operationType'],
      ['api_operation_logs', 'idx_aol_status', 'status'],
      ['api_operation_logs', 'idx_aol_createdAt', 'createdAt'],
      ['api_request_queue', 'idx_arq_accountId', 'accountId'],
      ['api_request_queue', 'idx_arq_status', 'status'],
      ['api_request_queue', 'idx_arq_priority_status', 'priority, status'],
      ['api_request_queue', 'idx_arq_scheduledAt', 'scheduledAt'],
      ['optimization_recommendations', 'idx_or_accountId', 'accountId'],
      ['optimization_recommendations', 'idx_or_campaignId', 'campaignId'],
      ['optimization_recommendations', 'idx_or_status', 'status'],
      ['optimization_recommendations', 'idx_or_priority', 'priority'],
      ['optimization_recommendations', 'idx_or_account_status', 'accountId, status'],
      ['notification_history', 'idx_nh_userId', 'userId'],
      ['notification_history', 'idx_nh_accountId', 'accountId'],
      ['notification_history', 'idx_nh_status', 'status'],
      ['notification_history', 'idx_nh_createdAt', 'createdAt'],
      ['task_execution_log', 'idx_tel_accountId', 'accountId'],
      ['task_execution_log', 'idx_tel_userId', 'userId'],
      ['task_execution_log', 'idx_tel_taskType', 'taskType'],
      ['task_execution_log', 'idx_tel_status', 'status'],
      ['task_execution_log', 'idx_tel_createdAt', 'createdAt'],
      ['batch_operations', 'idx_bo_userId', 'userId'],
      ['batch_operations', 'idx_bo_accountId', 'accountId'],
      ['batch_operations', 'idx_bo_batchStatus', 'batchStatus'],
      ['batch_operations', 'idx_bo_createdAt', 'createdAt'],
      ['batch_operation_items', 'idx_boi_batchId', 'batchId'],
      ['batch_operation_items', 'idx_boi_itemStatus', 'itemStatus'],
      ['dayparting_strategies', 'idx_ds_accountId', 'accountId'],
      ['dayparting_strategies', 'idx_ds_campaignId', 'campaignId'],
      ['dayparting_strategies', 'idx_ds_account_campaign', 'accountId, campaignId'],
      ['auto_pause_records', 'idx_apr_accountId', 'accountId'],
      ['auto_pause_records', 'idx_apr_userId', 'userId'],
      ['auto_pause_records', 'idx_apr_pausedAt', 'pausedAt'],
      ['ad_groups', 'idx_adGroups_adGroupId', 'adGroupId'],
      ['keywords', 'idx_keywords_keywordStatus', 'keywordStatus'],
      ['negative_keywords', 'idx_negKw_internalAdGroupId', 'internal_ad_group_id'],
      ['negative_keywords', 'idx_negKw_negativeLevel', 'negativeLevel'],
      ['product_targets', 'idx_prodTargets_internalAdGroupId', 'internal_ad_group_id'],
      ['product_targets', 'idx_prodTargets_targetStatus', 'targetStatus'],
    ]
    let indexSuccess = 0;
    let indexSkipped = 0;
    for (const [table, idxName, columns] of v446Indexes) {
      try {
        // 用反引号包裹每个列名，确保兼容性
        const wrappedCols = columns.split(',').map((c: string) => {
          const trimmed = c.trim();
          return trimmed.startsWith('`') ? trimmed : `\`${trimmed}\``;
        }).join(', ');
        await database.execute(sql.raw(
          `CREATE INDEX \`${idxName}\` ON \`${table}\` (${wrappedCols})`
        ));
        indexSuccess++;
      } catch (err: unknown) {
        const msg = String((err as Error)?.message || '');
        // @ts-expect-error - accessing cause for detailed error
        const causeMsg = String(err?.cause?.message || err?.cause || '');
        const fullMsg = msg + ' | cause: ' + causeMsg;
        if (fullMsg.includes('Duplicate key name') || fullMsg.includes('already exists')) {
          indexSkipped++;
        } else {
          log.warn(`v446: 索引 ${idxName} 创建失败: ${fullMsg}`);
        }
      }
    }
    log.info(`v446: 索引优化完成 - 新建${indexSuccess}个, 已存在${indexSkipped}个, 共${v446Indexes.length}个`);
    results.push(`v446索引: 新建${indexSuccess}, 已存在${indexSkipped}, 共${v446Indexes.length}`);

    // ========== v450: 核心表索引优化 ==========
    // campaigns表: 123次查询, 0个索引（除PK）
    // ad_groups表: 68次查询, 仅adGroupId有索引
    // daily_performance表: 53+次查询, 0个索引（除PK）
    const v450Indexes: [string, string, string][] = [
      // campaigns 表 - 最高频查询表
      ['campaigns', 'idx_campaigns_accountId', 'accountId'],
      ['campaigns', 'idx_campaigns_campaignId', 'campaignId'],
      ['campaigns', 'idx_campaigns_account_campaign', 'accountId, campaignId'],
      ['campaigns', 'idx_campaigns_account_status', 'accountId, campaignStatus'],
      ['campaigns', 'idx_campaigns_account_type', 'accountId, campaignType'],
      ['campaigns', 'idx_campaigns_perfGroupId', 'performanceGroupId'],
      // ad_groups 表
      ['ad_groups', 'idx_adGroups_accountId', 'accountId'],
      ['ad_groups', 'idx_adGroups_campaignId', 'campaignId'],
      ['ad_groups', 'idx_adGroups_account_campaign', 'accountId, campaignId'],
      // daily_performance 表 - 分析查询核心
      ['daily_performance', 'idx_dp_accountId', 'accountId'],
      ['daily_performance', 'idx_dp_account_date', 'accountId, date'],
      ['daily_performance', 'idx_dp_account_campaign_date', 'accountId, campaignId, date'],
      ['daily_performance', 'idx_dp_campaignId', 'campaignId'],
      // keywords 表 - 补充高频查询索引
      ['keywords', 'idx_keywords_accountId', 'accountId'],
      ['keywords', 'idx_keywords_account_adgroup', 'accountId, internalAdGroupId'],
      // optimization_events 表 - 同步率查询 (v460: 修正列名为snake_case)
      ['optimization_events', 'idx_oe_account_id', 'account_id'],
      ['optimization_events', 'idx_oe_account_status', 'account_id, api_sync_status'],
      ['optimization_events', 'idx_oe_created_at', 'created_at'],
    ];
    let v450IndexSuccess = 0;
    let v450IndexSkipped = 0;
    for (const [table, idxName, columns] of v450Indexes) {
      try {
        const wrappedCols = columns.split(',').map((c: string) => {
          const trimmed = c.trim();
          return trimmed.startsWith('`') ? trimmed : `\`${trimmed}\``;
        }).join(', ');
        await database.execute(sql.raw(
          `CREATE INDEX \`${idxName}\` ON \`${table}\` (${wrappedCols})`
        ));
        v450IndexSuccess++;
      } catch (err: unknown) {
        const msg = String((err as Error)?.message || '');
        // @ts-expect-error - accessing cause for detailed error
        const causeMsg = String(err?.cause?.message || err?.cause || '');
        const fullMsg = msg + ' | cause: ' + causeMsg;
        if (fullMsg.includes('Duplicate key name') || fullMsg.includes('already exists')) {
          v450IndexSkipped++;
        } else {
          log.warn(`v450: 索引 ${idxName} 创建失败: ${fullMsg}`);
        }
      }
    }
    log.info(`v450: 核心表索引优化完成 - 新建${v450IndexSuccess}个, 已存在${v450IndexSkipped}个, 共${v450Indexes.length}个`);
    results.push(`v450索引: 新建${v450IndexSuccess}, 已存在${v450IndexSkipped}, 共${v450Indexes.length}`);

    // ========== v452: 多租户基础表 ==========
    // organizations, invite_codes, invite_code_usages, team_members 扩展
    // 这些表是邀请码注册和多租户数据隔离的基础
    log.info('v452: 开始多租户基础表迁移...');

    // 1. organizations 表 - 租户/组织
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
    `, 'organizations', results);

    // 插入默认组织（如果不存在）
    try {
      await database.execute(sql`
        INSERT IGNORE INTO organizations (id, name, slug, type, status, subscription_plan, max_users, max_accounts, max_ad_accounts, max_campaigns, max_api_calls_per_day, features)
        VALUES (1, 'Default Organization', 'default', 'internal', 'active', 'enterprise', 9999, 9999, 9999, 9999, 999999, '{"ml_optimization": true, "smart_campaign": true, "advanced_analytics": true, "api_access": true}')
      `);
      results.push('organizations: 默认组织已就绪');
    } catch (e: unknown) {
      // 忽略重复插入
    }

    // 2. invite_codes 表 - 邀请码
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
    `, 'invite_codes', results);

    // 3. invite_code_usages 表 - 邀请码使用记录
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
    `, 'invite_code_usages', results);

    // 4. 确保 team_members 表有 organization_id, username, password_hash 列（多租户扩展）
    try {
      await database.execute(sql.raw('ALTER TABLE team_members ADD COLUMN organization_id INT DEFAULT 1'));
      results.push('team_members: 添加 organization_id 列');
    } catch (e: unknown) { if (!isAlreadyExistsError(e as Error)) log.warn('team_members.organization_id: ' + (e as Error).message); }

    try {
      await database.execute(sql.raw('ALTER TABLE team_members ADD COLUMN username VARCHAR(255)'));
      results.push('team_members: 添加 username 列');
    } catch (e: unknown) { if (!isAlreadyExistsError(e as Error)) log.warn('team_members.username: ' + (e as Error).message); }

    try {
      await database.execute(sql.raw('ALTER TABLE team_members ADD COLUMN password_hash VARCHAR(255)'));
      results.push('team_members: 添加 password_hash 列');
    } catch (e: unknown) { if (!isAlreadyExistsError(e as Error)) log.warn('team_members.password_hash: ' + (e as Error).message); }

    try {
      await database.execute(sql.raw('ALTER TABLE team_members ADD COLUMN last_login_at TIMESTAMP NULL'));
      results.push('team_members: 添加 last_login_at 列');
    } catch (e: unknown) { if (!isAlreadyExistsError(e as Error)) log.warn('team_members.last_login_at: ' + (e as Error).message); }

    log.info(`v452: 多租户基础表迁移完成`);

    // ========== v508: 将 optimization_events.api_sync_status 从 ENUM 改为 VARCHAR(32) ==========
    // 根因: 代码中使用了 'permanently_failed', 'superseded', 'invalid_legacy' 等扩展状态值,
    // 但 ENUM 只有 4 个值 ('pending','synced','failed','not_applicable'),
    // MySQL 将非法 ENUM 值写为空字符串 '', 导致 21,067 条记录状态丢失。
    // 修复: 改为 VARCHAR(32) 以支持所有状态值, 并回填空字符串记录。
    log.info('v508: 开始修复 optimization_events.api_sync_status 列类型...');
    try {
      await database.execute(sql.raw(`
        ALTER TABLE optimization_events 
        MODIFY COLUMN api_sync_status VARCHAR(32) DEFAULT 'pending'
      `));
      results.push('optimization_events: api_sync_status 已从 ENUM 改为 VARCHAR(32)');
      log.info('v508: optimization_events.api_sync_status 已改为 VARCHAR(32)');
    } catch (e: unknown) {
      const msg = (e as Error).message;
      // 如果已经是VARCHAR则忽略
      if (!msg.includes('already') && !msg.includes('Duplicate')) {
        log.warn('v508: ALTER TABLE optimization_events 失败: ' + msg);
      }
      results.push('optimization_events: api_sync_status 类型变更跳过 - ' + msg);
    }

    // v508: 同时修复 optimization_logs.api_sync_status (也是ENUM)
    try {
      await database.execute(sql.raw(`
        ALTER TABLE optimization_logs 
        MODIFY COLUMN api_sync_status VARCHAR(32) DEFAULT 'pending'
      `));
      results.push('optimization_logs: api_sync_status 已从 ENUM 改为 VARCHAR(32)');
      log.info('v508: optimization_logs.api_sync_status 已改为 VARCHAR(32)');
    } catch (e: unknown) {
      log.warn('v508: ALTER TABLE optimization_logs 失败: ' + (e as Error).message);
    }

    // v508: 回填空字符串记录 - 根据 error_message 内容推断正确状态
    try {
      // 1. 包含 'superseded' 或 '过时' 的记录 → superseded
      const [supersededResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'superseded'
        WHERE (api_sync_status = '' OR api_sync_status IS NULL)
          AND (error_message LIKE '%superseded%' OR error_message LIKE '%过时%')
      `)) as unknown[];
      const supersededCount = (supersededResult as Record<string, unknown>).affectedRows || 0;
      log.info(`v508: 回填 superseded 状态: ${supersededCount} 条`);

      // 2. 包含 'permanently_failed' 或 '永久失败' 的记录 → permanently_failed
      const [permFailResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed'
        WHERE (api_sync_status = '' OR api_sync_status IS NULL)
          AND (error_message LIKE '%permanently_failed%' OR error_message LIKE '%永久%')
      `)) as unknown[];
      const permFailCount = (permFailResult as Record<string, unknown>).affectedRows || 0;
      log.info(`v508: 回填 permanently_failed 状态: ${permFailCount} 条`);

      // 3. action_type = 'dayparting_bid' 且超过24小时的空字符串 → superseded
      const [daypartResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'superseded',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: 分时竞价历史记录，标记为superseded')
        WHERE (api_sync_status = '' OR api_sync_status IS NULL)
          AND action_type = 'dayparting_bid'
          AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `)) as unknown[];
      const daypartCount = (daypartResult as Record<string, unknown>).affectedRows || 0;
      log.info(`v508: 回填 dayparting_bid superseded: ${daypartCount} 条`);

      // 4. 剩余的空字符串 → permanently_failed (历史遗留无法重试)
      const [remainResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: 历史遗留空状态，标记为permanently_failed')
        WHERE api_sync_status = '' OR api_sync_status IS NULL
      `)) as unknown[];
      const remainCount = (remainResult as Record<string, unknown>).affectedRows || 0;
      log.info(`v508: 回填剩余空状态: ${remainCount} 条`);

      results.push(`v508: 空字符串回填完成 - superseded=${supersededCount + daypartCount}, permanently_failed=${permFailCount + remainCount}`);
    } catch (e: unknown) {
      log.warn('v508: 空字符串回填失败: ' + (e as Error).message);
    }

    // v508: 清理超过7天的 failed 出价记录 - 检查关键词是否仍然活跃
    try {
      // 对于关键词已不存在的失败记录，标记为 permanently_failed
      const [cleanupResult] = await database.execute(sql.raw(`
        UPDATE optimization_events oe
        LEFT JOIN keywords k ON oe.keyword_id = k.id
        SET oe.api_sync_status = 'permanently_failed',
            oe.error_message = CONCAT(COALESCE(oe.error_message, ''), ' | v508: 关键词已不存在或已归档')
        WHERE oe.api_sync_status = 'failed'
          AND oe.action_type IN ('bid_increase', 'bid_decrease', 'dayparting_bid')
          AND oe.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND (k.id IS NULL OR k.status IN ('archived', 'deleted', 'paused'))
      `)) as unknown[];
      const cleanupCount = (cleanupResult as Record<string, unknown>).affectedRows || 0;
      log.info(`v508: 清理过期失败记录: ${cleanupCount} 条 (关键词已不存在或已归档)`);
      results.push(`v508: 清理过期失败记录: ${cleanupCount} 条`);
    } catch (e: unknown) {
      log.warn('v508: 清理过期失败记录失败: ' + (e as Error).message);
    }

    // v508: 回写 not_applicable 的出价事件 - 通过 optimization_tasks 匹配真实同步状态
    try {
      // 1. 30天内的 not_applicable 出价事件：通过 keyword_id 匹配 optimization_tasks 回写
      const [syncedBackfill] = await database.execute(sql.raw(`
        UPDATE optimization_events oe
        INNER JOIN optimization_tasks ot 
          ON oe.keyword_id = ot.target_entity_id 
          AND ot.task_type = 'bid_adjustment'
          AND ot.status = 'synced'
          AND ABS(TIMESTAMPDIFF(MINUTE, oe.created_at, ot.created_at)) < 60
        SET oe.api_sync_status = 'synced',
            oe.error_message = CONCAT(COALESCE(oe.error_message, ''), ' | v508: 通过optimization_tasks回写synced')
        WHERE oe.api_sync_status = 'not_applicable'
          AND oe.action_type IN ('bid_increase', 'bid_decrease')
          AND oe.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      `)) as unknown[];
      const syncedBackfillCount = (syncedBackfill as Record<string, unknown>).affectedRows || 0;
      log.info(`v508: 回写 not_applicable → synced: ${syncedBackfillCount} 条`);

      // 2. 超过30天的 not_applicable 出价事件 → permanently_failed (历史遗留)
      const [oldNaResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: 历史遗留not_applicable，无法追溯同步状态')
        WHERE api_sync_status = 'not_applicable'
          AND action_type IN ('bid_increase', 'bid_decrease')
          AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
      `)) as unknown[];
      const oldNaCount = (oldNaResult as Record<string, unknown>).affectedRows || 0;
      log.info(`v508: 回写 old not_applicable → permanently_failed: ${oldNaCount} 条`);

      // 3. 30天内仍然匹配不到 tasks 的 not_applicable 出价事件 → pending (等待下次纠错扫描)
      const [recentNaResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'pending',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: 重置为pending等待重新同步')
        WHERE api_sync_status = 'not_applicable'
          AND action_type IN ('bid_increase', 'bid_decrease')
          AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `)) as unknown[];
      const recentNaCount = (recentNaResult as Record<string, unknown>).affectedRows || 0;
      log.info(`v508: 回写 recent not_applicable → pending: ${recentNaCount} 条`);

      // 4. invalid_legacy 的 settings_update → permanently_failed (历史遗留)
      const [legacyResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: invalid_legacy历史数据归档')
        WHERE api_sync_status = 'invalid_legacy'
      `)) as unknown[];
      const legacyCount = (legacyResult as Record<string, unknown>).affectedRows || 0;
      log.info(`v508: 回写 invalid_legacy → permanently_failed: ${legacyCount} 条`);

      // 5. 非出价类型的 not_applicable 事件（如 budget_adjustment, keyword_create）
      // 这些类型的 not_applicable 可能是合理的（如纯记录型事件），但也可能是历史遗留
      // 对于超过30天的，标记为 permanently_failed
      const [otherNaResult] = await database.execute(sql.raw(`
        UPDATE optimization_events 
        SET api_sync_status = 'permanently_failed',
            error_message = CONCAT(COALESCE(error_message, ''), ' | v508: 非出价类型历史not_applicable归档')
        WHERE api_sync_status = 'not_applicable'
          AND action_type NOT IN ('bid_increase', 'bid_decrease', 'safety_summary', 'safety_pause', 'auto_correction')
          AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
      `)) as unknown[];
      const otherNaCount = (otherNaResult as Record<string, unknown>).affectedRows || 0;
      log.info(`v508: 回写 other not_applicable → permanently_failed: ${otherNaCount} 条`);

      results.push(`v508: not_applicable回写完成 - synced=${syncedBackfillCount}, permanently_failed=${oldNaCount + legacyCount + otherNaCount}, pending=${recentNaCount}`);
    } catch (e: unknown) {
      log.warn('v508: not_applicable回写失败: ' + (e as Error).message);
    }

    log.info(`v508: 数据库自动迁移完成, 结果: ${results.join('; ')}`);
    return { success: true, results };

  } catch (error: unknown) {
    log.warn(`v418: 数据库自动迁移异常: ${(error as Error).message}`);
    return { success: false, results: [`迁移异常: ${(error as Error).message}`] };
  }
}
