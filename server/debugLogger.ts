import { getDb } from './db';

export interface DebugLogEntry {
  log_type: 'sync_start' | 'api_call' | 'db_write' | 'sync_end' | 'error' | 'info';
  account_id?: number;
  marketplace?: string;
  sync_job_id?: number;
  message: string;
  data?: any;
}

/**
 * 记录调试日志到数据库
 */
export async function logDebug(entry: DebugLogEntry): Promise<void> {
  try {
    const db = getDb();
    if (!db) {
      console.error('[DebugLogger] 数据库连接失败');
      return;
    }

    // 确保debug_logs表存在
    await db.execute(`
      CREATE TABLE IF NOT EXISTS debug_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        log_type VARCHAR(50) NOT NULL,
        account_id INT,
        marketplace VARCHAR(10),
        sync_job_id INT,
        message TEXT NOT NULL,
        data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sync_job (sync_job_id),
        INDEX idx_account (account_id),
        INDEX idx_created (created_at),
        INDEX idx_type (log_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // 插入日志记录
    await db.execute(
      `INSERT INTO debug_logs (log_type, account_id, marketplace, sync_job_id, message, data) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.log_type,
        entry.account_id || null,
        entry.marketplace || null,
        entry.sync_job_id || null,
        entry.message,
        entry.data ? JSON.stringify(entry.data) : null,
      ]
    );

    // 同时输出到console
    console.log(`[DebugLog:${entry.log_type}] ${entry.message}`, entry.data || '');
  } catch (error) {
    console.error('[DebugLogger] 写入日志失败:', error);
  }
}

/**
 * 清理旧日志(保留最近7天)
 */
export async function cleanOldLogs(): Promise<void> {
  try {
    const db = getDb();
    if (!db) return;

    await db.execute(
      `DELETE FROM debug_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
  } catch (error) {
    console.error('[DebugLogger] 清理旧日志失败:', error);
  }
}
