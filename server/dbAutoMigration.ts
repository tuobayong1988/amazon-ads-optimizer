/**
 * v248: 数据库自动迁移模块 (Database Auto-Migration)
 * 
 * 在系统启动时自动检查并创建v245+所需的数据库表和列。
 * 使用 CREATE TABLE IF NOT EXISTS 和 ALTER TABLE ... ADD COLUMN 确保幂等性。
 * 
 * 修复的问题：
 * - anomaly_alert_logs 表：v245引入但从未自动创建
 * - emergency_optimization_queue 表：v245引入但从未自动创建
 * - module_execution_times 列：v242 drizzle迁移未执行，导致调度状态丢失
 * 
 * 注意：riskActionEngine.ts 中的 anomaly_alert_logs 使用 snake_case 列名
 *       （account_id, alert_type, severity, message, created_at），
 *       而 drizzle schema 使用 camelCase。此处使用 riskActionEngine 实际使用的列名。
 */

import { getDb } from './db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('AutoDbMigration');

/**
 * 检查MySQL错误是否为"已存在"类型（表/列已存在），可安全忽略
 */
function isAlreadyExistsError(err: any): boolean {
  const message = String(err?.message || '');
  const causeMessage = String(err?.cause?.message || err?.cause || '');
  const combined = message + ' ' + causeMessage;
  
  // MySQL错误码：1060=Duplicate column name, 1050=Table already exists
  return combined.includes('Duplicate column') ||
         combined.includes('already exists') ||
         combined.includes('1060') ||
         combined.includes('1050');
}

export async function runAutoDbMigration(): Promise<{ success: boolean; results: string[] }> {
  const results: string[] = [];
  
  try {
    const database = await getDb();
    if (!database) {
      log.warn('数据库不可用，跳过自动迁移');
      return { success: false, results: ['数据库不可用'] };
    }

    log.info('v248: 开始数据库自动迁移检查...');

    // 1. 创建 anomaly_alert_logs 表（v245 riskActionEngine 使用 snake_case 列名）
    try {
      await database.execute(sql`
        CREATE TABLE IF NOT EXISTS anomaly_alert_logs (
          id INT NOT NULL AUTO_INCREMENT,
          account_id INT,
          alert_type VARCHAR(100),
          severity VARCHAR(50),
          message TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_aal_account (account_id),
          INDEX idx_aal_type (alert_type),
          INDEX idx_aal_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      results.push('anomaly_alert_logs: 表已就绪');
      log.info('anomaly_alert_logs 表已就绪');
    } catch (err: any) {
      if (isAlreadyExistsError(err)) {
        results.push('anomaly_alert_logs: 表已存在（跳过）');
      } else {
        results.push(`anomaly_alert_logs: 创建失败 - ${err.message}`);
        log.error(`anomaly_alert_logs 创建失败: ${err.message}`);
      }
    }

    // 2. 创建 emergency_optimization_queue 表（v245 riskActionEngine 使用 camelCase 列名）
    try {
      await database.execute(sql`
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
      `);
      results.push('emergency_optimization_queue: 表已就绪');
      log.info('emergency_optimization_queue 表已就绪');
    } catch (err: any) {
      if (isAlreadyExistsError(err)) {
        results.push('emergency_optimization_queue: 表已存在（跳过）');
      } else {
        results.push(`emergency_optimization_queue: 创建失败 - ${err.message}`);
        log.error(`emergency_optimization_queue 创建失败: ${err.message}`);
      }
    }

    // 3. 添加 module_execution_times 列到 performance_groups 表
    try {
      await database.execute(sql`
        ALTER TABLE performance_groups ADD COLUMN module_execution_times TEXT DEFAULT NULL
      `);
      results.push('module_execution_times: 列已添加到 performance_groups');
      log.info('module_execution_times 列已添加到 performance_groups');
    } catch (err: any) {
      if (isAlreadyExistsError(err)) {
        results.push('module_execution_times: 列已存在（跳过）');
      } else {
        results.push(`module_execution_times: 添加失败 - ${err.message}`);
        log.error(`module_execution_times 添加失败: ${err.message}`);
      }
    }

    log.info(`v248: 数据库自动迁移完成, 结果: ${results.join('; ')}`);
    return { success: true, results };

  } catch (error: any) {
    log.error(`v248: 数据库自动迁移异常: ${error.message}`);
    return { success: false, results: [`迁移异常: ${error.message}`] };
  }
}
