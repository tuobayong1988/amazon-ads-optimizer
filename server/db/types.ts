/**
 * v657: 数据库查询结果类型辅助工具
 * 
 * 目的: 为 drizzle-orm/mysql2 的查询结果提供精确的类型定义，
 * 逐步消除全项目 726+ 个 DB/Drizzle 相关的 @ts-ignore。
 * 
 * 使用方式:
 * ```typescript
 * // 替代: // @ts-ignore v653: drizzle/mysql2 untyped query result
 * //        const result = await database.execute(sql`SELECT ...`);
 * // 使用: const result = await typedExecute<{ id: number; name: string }>(database, sql`SELECT ...`);
 * ```
 * 
 * 路线图:
 * - v657: 创建类型工具 + 在 optimizationAutoCorrector.ts 中示范使用
 * - v658+: 逐模块推广到 sync/ 和 optimization/ 的其他文件
 */

import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { SQL } from 'drizzle-orm';

// ============================================================
// 1. MySQL execute() 结果类型
// ============================================================

/**
 * mysql2 execute() 返回的原始结果类型
 * 对应 [rows, fields] 元组
 */
export type MySql2ExecuteResult = [
  MySql2ResultRow[],
  unknown // FieldPacket[]
];

/**
 * mysql2 单行结果的通用类型
 */
export type MySql2ResultRow = Record<string, unknown>;

/**
 * MySQL INSERT/UPDATE/DELETE 的结果头
 */
export interface MySql2ResultHeader {
  affectedRows: number;
  insertId: number;
  changedRows: number;
  fieldCount: number;
  info: string;
  serverStatus: number;
  warningStatus: number;
}

// ============================================================
// 2. 类型安全的查询执行器
// ============================================================

/**
 * 类型安全的 raw SQL 执行器 (SELECT 查询)
 * 
 * @example
 * const rows = await typedQuery<{ id: number; name: string }>(db, sql`SELECT id, name FROM users`);
 * // rows 的类型是 { id: number; name: string }[]
 */
export async function typedQuery<T extends Record<string, unknown>>(
  database: MySql2Database<any> | null,
  query: SQL
): Promise<T[]> {
  if (!database) return [];
  const result = await (database as any).execute(query);
  // mysql2 返回 [rows, fields] 或直接返回 rows
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as T[];
  }
  return (Array.isArray(result) ? result : []) as T[];
}

/**
 * 类型安全的 raw SQL 执行器 (INSERT/UPDATE/DELETE)
 * 
 * @example
 * const { affectedRows } = await typedExecute(db, sql`UPDATE users SET name = 'test'`);
 */
export async function typedExecute(
  database: MySql2Database<any> | null,
  query: SQL
): Promise<MySql2ResultHeader> {
  if (!database) {
    return { affectedRows: 0, insertId: 0, changedRows: 0, fieldCount: 0, info: '', serverStatus: 0, warningStatus: 0 };
  }
  const result = await (database as any).execute(query);
  // mysql2 返回 [ResultSetHeader, fields] 或直接返回 ResultSetHeader
  if (Array.isArray(result)) {
    return (result[0] || result) as MySql2ResultHeader;
  }
  return result as MySql2ResultHeader;
}

/**
 * 类型安全的 raw SQL 单行查询
 * 
 * @example
 * const user = await typedQueryOne<{ id: number; name: string }>(db, sql`SELECT * FROM users WHERE id = 1`);
 * // user 的类型是 { id: number; name: string } | null
 */
export async function typedQueryOne<T extends Record<string, unknown>>(
  database: MySql2Database<any> | null,
  query: SQL
): Promise<T | null> {
  const rows = await typedQuery<T>(database, query);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 类型安全的聚合查询（COUNT, SUM, AVG 等）
 * 
 * @example
 * const count = await typedAggregate<number>(db, sql`SELECT COUNT(*) as cnt FROM users`, 'cnt');
 */
export async function typedAggregate<T = number>(
  database: MySql2Database<any> | null,
  query: SQL,
  field: string
): Promise<T | null> {
  const row = await typedQueryOne<Record<string, unknown>>(database, query);
  if (!row) return null;
  return row[field] as T;
}

// ============================================================
// 3. Drizzle select() 结果类型辅助
// ============================================================

/**
 * 从 drizzle select 结果中提取行类型
 * 用于需要明确标注 select 结果类型的场景
 * 
 * @example
 * type CampaignRow = SelectResult<typeof campaigns, 'id' | 'name' | 'status'>;
 */
export type SelectResult<
  TTable extends Record<string, any>,
  TKeys extends keyof TTable
> = {
  [K in TKeys]: TTable[K] extends { $type: infer T } ? T : unknown;
};

/**
 * 安全地从 unknown 类型的查询结果中提取数组
 * 用于 drizzle .select().from() 链式调用的结果类型断言
 * 
 * @example
 * const result = await database.select(...).from(table).where(...);
 * const rows = asRows<{ id: number; name: string }>(result);
 */
export function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return [];
}

/**
 * 安全地从 unknown 类型的查询结果中提取单行
 */
export function asRow<T>(result: unknown): T | null {
  if (Array.isArray(result) && result.length > 0) return result[0] as T;
  return null;
}
