/**
 * v361: 安全SQL工具函数
 * 
 * 提供安全的SQL构建方法，替代直接使用sql.raw()拼接用户输入。
 * 所有动态SQL构建都应通过此模块的函数来完成。
 */

import { sql, SQL } from "drizzle-orm";

/**
 * 安全的IN子句构建器（数字ID列表）
 * 将数字数组转换为参数化的IN子句，防止SQL注入。
 * 
 * @example
 * // 替代: sql.raw(ids.join(','))
 * // 使用: safeInClause(ids)
 * db.execute(sql`SELECT * FROM table WHERE id IN (${safeInClause(ids)})`)
 */
export function safeInClause(ids: (number | string)[]): SQL {
  // 强制转换为数字并过滤无效值
  const safeIds = ids.map(Number).filter(n => !isNaN(n) && isFinite(n));
  
  if (safeIds.length === 0) {
    // 返回一个永远不匹配的条件，避免空IN子句的SQL语法错误
    return sql`-1`;
  }
  
  // 使用sql.join构建参数化的IN列表
  return sql.join(safeIds.map(id => sql`${id}`), sql`, `);
}

/**
 * 安全的IN子句构建器（字符串列表）
 * 将字符串数组转换为参数化的IN子句。
 */
export function safeStringInClause(values: string[]): SQL {
  if (values.length === 0) {
    return sql`''`;
  }
  return sql.join(values.map(v => sql`${v}`), sql`, `);
}

/**
 * 安全的动态列名引用
 * 仅允许白名单中的列名，防止通过列名注入。
 * 
 * @param columnName 动态列名
 * @param allowedColumns 允许的列名白名单
 */
export function safeColumnRef(columnName: string, allowedColumns: string[]): SQL {
  if (!allowedColumns.includes(columnName)) {
    throw new Error(`[SafeSQL] 不允许的列名: "${columnName}"。允许的列名: ${allowedColumns.join(', ')}`);
  }
  // 列名已通过白名单验证，可以安全使用sql.raw
  return sql.raw(columnName);
}

/**
 * 安全的动态SET子句构建器
 * 将key-value对转换为参数化的SET子句。
 * 
 * @param updates 要更新的字段和值
 * @param allowedColumns 允许更新的列名白名单
 */
export function safeDynamicSet(
  updates: Record<string, unknown>,
  allowedColumns: string[]
): SQL {
  const setClauses: SQL[] = [];
  
  for (const [column, value] of Object.entries(updates)) {
    if (!allowedColumns.includes(column)) {
      throw new Error(`[SafeSQL] 不允许更新的列名: "${column}"`);
    }
    setClauses.push(sql`${sql.raw(column)} = ${value}`);
  }
  
  if (setClauses.length === 0) {
    throw new Error('[SafeSQL] 没有有效的更新字段');
  }
  
  return sql.join(setClauses, sql`, `);
}

// 利润追踪字段白名单
export const PROFIT_TRACKING_COLUMNS = [
  'actual_profit_7d',
  'actual_profit_14d', 
  'actual_profit_30d',
] as const;

// sync_schedules允许更新的字段白名单
export const SYNC_SCHEDULE_UPDATE_COLUMNS = [
  'status',
  'last_sync_at',
  'next_sync_at',
  'error_count',
  'last_error',
  'sync_interval_ms',
  'priority',
] as const;
