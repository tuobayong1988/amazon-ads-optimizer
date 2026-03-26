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

/**
 * v522: 安全的 inArray 包装器
 * 解决 drizzle-orm 的 inArray() 在接收到包含 undefined/null 的数组时
 * 导致 mysql2 的 sqlstring.escape() 抛出 "val.toString is not a function" 同步错误。
 * 
 * 该错误无法被 try/catch 捕获，会直接触发 uncaughtException 导致进程崩溃。
 * 
 * @param column drizzle 列引用
 * @param values 待过滤的值数组
 * @returns 安全的 SQL 条件，或当数组为空时返回 sql`1=0`
 * 
 * @example
 * // 替代: inArray(keywords.id, keywordIds)
 * // 使用: safeInArray(keywords.id, keywordIds)
 * db.select().from(keywords).where(safeInArray(keywords.id, keywordIds))
 */
export function safeInArray<T>(column: any, values: (T | undefined | null)[]): SQL {
  // 过滤掉 undefined 和 null
  const safeValues = values.filter((v): v is T => v !== undefined && v !== null);
  
  if (safeValues.length === 0) {
    // 返回永远不匹配的条件，避免空数组导致的SQL语法错误
    return sql`1=0`;
  }
  
  // 对每个值再做一层安全检查：确保每个元素都有 toString 方法
  const validValues = safeValues.filter(v => {
    if (typeof v === 'object' && v !== null && typeof (v as any).toString !== 'function') {
      return false;
    }
    return true;
  });
  
  if (validValues.length === 0) {
    return sql`1=0`;
  }
  
  // 使用 drizzle 的 inArray
  const { inArray } = require('drizzle-orm');
  return inArray(column, validValues);
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
