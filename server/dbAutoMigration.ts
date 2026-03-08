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
  const causeMessage = String(err?.cause?.message || err?.cause || '');
  const combined = message + ' ' + causeMessage;
  
  // MySQL错误码：1060=Duplicate column name, 1050=Table already exists
  return combined.includes('Duplicate column') ||
         combined.includes('already exists') ||
         combined.includes('1060') ||
         combined.includes('1050');
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
    if (isAlreadyExistsError(err)) {
      results.push(`${tableName}: 已存在（跳过）`);
      return true;
    } else {
      results.push(`${tableName}: 失败 - ${(err as Error).message}`);
      log.error(`${tableName} 操作失败: ${(err as Error).message}`);
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
    // 1. anomaly_alert_logs 表（v245 riskActionEngine 使用 snake_case 列名）
    // ============================================================
    await safeDDL(database, sql`
      CREATE TABLE IF NOT EXISTS anomaly_alert_logs (
        id INT NOT NULL AUTO_INCREMENT,
        account_id INT,
        alert_type VARCHAR(100),
        severity VARCHAR(50),
        message MEDIUMTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_aal_account (account_id),
        INDEX idx_aal_type (alert_type),
        INDEX idx_aal_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, 'anomaly_alert_logs', results);

    // v347: 确保message列为MEDIUMTEXT（旧版可能是TEXT，无法存储大JSON）
    await safeDDL(database, sql`
      ALTER TABLE anomaly_alert_logs MODIFY COLUMN message MEDIUMTEXT
    `, 'anomaly_alert_logs.message→MEDIUMTEXT', results);

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
        ad_group_id INT,
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

    log.info(`v349: 数据库自动迁移完成, 结果: ${results.join('; ')}`);
    return { success: true, results };

  } catch (error: unknown) {
    log.error(`v349: 数据库自动迁移异常: ${(error as Error).message}`);
    return { success: false, results: [`迁移异常: ${(error as Error).message}`] };
  }
}
