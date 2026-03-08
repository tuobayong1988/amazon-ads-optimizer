/**
 * v258 数据库迁移: 增强优化日志可读性
 * 
 * 添加字段:
 * - reason_details (JSON): 结构化的调整归因详情
 * - guardrail_info (JSON): 护栏机制介入信息
 * - related_event_id (INT): 关联的原始优化事件ID
 */

import { getDb } from '../db';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Migration-v258');

export async function runV258Migration(): Promise<void> {
  const db = await getDb();
  if (!db) {
    log.error('v258迁移: 数据库连接失败');
    return;
  }

  try {
    log.info('v258迁移: 开始添加优化日志增强字段...');

    // 检查字段是否已存在
    // @ts-ignore
    const [columns] = await (db as Record<string, Function>).execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'optimization_events' 
      AND COLUMN_NAME IN ('reason_details', 'guardrail_info', 'related_event_id')
    `);

    const existingColumns = new Set(
      (Array.isArray(columns) ? columns : []).map((c: Record<string, any>) => c.COLUMN_NAME)
    );

    if (!existingColumns.has('reason_details')) {
      // @ts-ignore
      await (db as Record<string, Function>).execute(`
        ALTER TABLE optimization_events 
        ADD COLUMN reason_details JSON DEFAULT NULL 
        COMMENT 'v258: 结构化调整归因详情(触发规则/核心数据/算法选择)'
      `);
      log.info('v258迁移: 已添加 reason_details 字段');
    }

    if (!existingColumns.has('guardrail_info')) {
      // @ts-ignore
      await (db as Record<string, Function>).execute(`
        ALTER TABLE optimization_events 
        ADD COLUMN guardrail_info JSON DEFAULT NULL 
        COMMENT 'v258: 护栏机制介入信息(冷却/熔断/仲裁状态)'
      `);
      log.info('v258迁移: 已添加 guardrail_info 字段');
    }

    if (!existingColumns.has('related_event_id')) {
      // @ts-ignore
      await (db as Record<string, Function>).execute(`
        ALTER TABLE optimization_events 
        ADD COLUMN related_event_id INT DEFAULT NULL 
        COMMENT 'v258: 关联的原始优化事件ID'
      `);
      // 添加索引以加速关联查询
      // @ts-ignore
      await (db as Record<string, Function>).execute(`
        ALTER TABLE optimization_events 
        ADD INDEX idx_oe_related_event (related_event_id)
      `).catch(() => {
        log.warn('v258迁移: related_event_id索引已存在或创建失败');
      });
      log.info('v258迁移: 已添加 related_event_id 字段和索引');
    }

    log.info('v258迁移: 优化日志增强字段添加完成');
  } catch (error: unknown) {
    log.error(`v258迁移失败: ${(error as Error).message}`);
  }
}
