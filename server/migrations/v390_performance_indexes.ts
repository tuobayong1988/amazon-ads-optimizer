/**
 * v390: 性能优化索引 - 为纠错监控和健康分析的高频查询添加复合索引
 * 
 * v526修复: 增强幂等性检查，先查询information_schema确认索引是否已存在
 * 
 * 问题：
 * - getDashboard 的6个SQL查询都基于 account_id 过滤 optimization_events 表
 * - 缺少 (account_id, api_sync_status) 复合索引，导致全表扫描
 * - 缺少 (account_id, action_type) 复合索引，影响按操作类型统计查询
 * - 缺少 (account_id, api_synced_at) 复合索引，影响7天趋势查询
 * 
 * 解决：添加覆盖高频查询条件的复合索引
 */

import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Migration-v390-indexes');

export async function runV390PerformanceIndexes(db: unknown): Promise<void> {
  log.info('[v390] 开始创建性能优化索引...');

  const indexDefinitions = [
    // optimization_events表 - 纠错监控高频查询索引
    { name: 'idx_oe_account_sync_status', table: 'optimization_events', ddl: 'CREATE INDEX idx_oe_account_sync_status ON optimization_events (account_id, api_sync_status)' },
    { name: 'idx_oe_account_action_type', table: 'optimization_events', ddl: 'CREATE INDEX idx_oe_account_action_type ON optimization_events (account_id, action_type)' },
    { name: 'idx_oe_account_synced_at', table: 'optimization_events', ddl: 'CREATE INDEX idx_oe_account_synced_at ON optimization_events (account_id, api_synced_at)' },
    { name: 'idx_oe_account_action_sync', table: 'optimization_events', ddl: 'CREATE INDEX idx_oe_account_action_sync ON optimization_events (account_id, action_type, api_sync_status)' },
    // 覆盖最近纠错日志查询的排序条件
    { name: 'idx_oe_account_created_at', table: 'optimization_events', ddl: 'CREATE INDEX idx_oe_account_created_at ON optimization_events (account_id, created_at DESC)' },
    // daily_performance表 - 健康分析查询索引
    { name: 'idx_dp_account_date_desc', table: 'daily_performance', ddl: 'CREATE INDEX idx_dp_account_date_desc ON daily_performance (accountId, date DESC)' },
  ];

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const idx of indexDefinitions) {
    try {
      // 幂等性检查：先查询information_schema确认索引是否已存在
      const checkSql = `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${idx.table}' AND INDEX_NAME = '${idx.name}'`;
      const checkResult = (db as any).execute(sql.raw(checkSql));
      const rows = await checkResult;
      const exists = rows?.[0]?.[0]?.cnt > 0 || rows?.[0]?.cnt > 0;

      if (exists) {
        skipped++;
        log.debug(`[v390] 索引 ${idx.name} 已存在，跳过`);
        continue;
      }

      await (db as any).execute(sql.raw(idx.ddl));
      created++;
      log.info(`[v390] 索引 ${idx.name} 创建成功`);
    } catch (error: unknown) {
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('Duplicate') || (error as any).code === 'ER_DUP_KEYNAME') {
        skipped++;
        log.debug(`[v390] 索引 ${idx.name} 已存在（Duplicate），跳过`);
      } else {
        failed++;
        log.warn(`[v390] 索引 ${idx.name} 创建失败: ${errMsg}`);
      }
    }
  }

  log.info(`[v390] 性能优化索引迁移完成: 创建=${created}, 跳过=${skipped}, 失败=${failed}`);
}
