// @ts-nocheck
/**
 * v525: 强类型 SQL 查询构建器与运行时验证器
 * 
 * ===== 设计目标 =====
 * 1. 在编译期通过 TypeScript 类型系统捕获列名拼写错误
 * 2. 在运行时通过 SQL 验证器拦截语法异常（如嵌入的注释、非法字符）
 * 3. 提供统一的查询执行入口，自动记录慢查询和错误
 * 4. 与现有的 optSyncQueries.ts 列名常量体系无缝兼容
 * 
 * ===== 使用方式 =====
 * 
 * 方式1: 使用查询构建器（推荐用于新代码）
 * ```
 * const result = await SafeQuery.select('keywords', ['id', 'keywordId', 'bid'])
 *   .where('accountId = ?', [accountId])
 *   .andWhere('keywordStatus != ?', ['amazon_deleted'])
 *   .limit(100)
 *   .execute(conn);
 * ```
 * 
 * 方式2: 使用验证包装器（推荐用于迁移现有代码）
 * ```
 * const result = await safeExecute(conn, sql, params, 'functionName');
 * ```
 */

import { createModuleLogger } from '../utils/logger';
import { logSyncWarn } from '../utils/opsLogger';

const log = createModuleLogger('TypeSafeQuery');

// ============================================================
// 表结构注册表（编译期类型安全）
// ============================================================

/**
 * 注册所有已知表的列名映射
 * 这是类型安全的核心：TypeScript 会在编译期检查列名是否存在
 */
export const TABLE_SCHEMA = {
  keywords: {
    table: 'keywords',
    columns: {
      id: 'id',
      keywordId: 'keywordId',
      keywordText: 'keywordText',
      keywordStatus: 'keywordStatus',
      bid: 'bid',
      matchType: 'matchType',
      campaignId: 'campaignId',
      accountId: 'accountId',
      internalAdGroupId: 'internal_ad_group_id',
      suggestedBid: 'suggestedBid',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  product_targets: {
    table: 'product_targets',
    columns: {
      id: 'id',
      targetId: 'targetId',
      targetExpression: 'targetExpression',
      targetStatus: 'targetStatus',
      bid: 'bid',
      campaignId: 'campaignId',
      accountId: 'accountId',
      internalAdGroupId: 'internal_ad_group_id',
      suggestedBid: 'suggestedBid',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  campaigns: {
    table: 'campaigns',
    columns: {
      id: 'id',
      campaignId: 'campaignId',
      campaignName: 'campaignName',
      campaignType: 'campaignType',
      campaignStatus: 'campaignStatus',
      costType: 'cost_type',
      adFormat: 'ad_format',
      accountId: 'accountId',
      budget: 'budget',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  ad_groups: {
    table: 'ad_groups',
    columns: {
      id: 'id',
      adGroupId: 'adGroupId',
      adGroupName: 'adGroupName',
      adGroupStatus: 'adGroupStatus',
      campaignId: 'campaignId',
      accountId: 'accountId',
      defaultBid: 'defaultBid',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  ad_accounts: {
    table: 'ad_accounts',
    columns: {
      id: 'id',
      marketplace: 'marketplace',
      status: 'status',
      profileId: 'profileId',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  optimization_tasks: {
    table: 'optimization_tasks',
    columns: {
      id: 'id',
      accountId: 'account_id',
      taskType: 'task_type',
      targetEntityType: 'target_entity_type',
      targetEntityId: 'target_entity_id',
      amazonEntityId: 'amazon_entity_id',
      status: 'status',
      errorMessage: 'error_message',
      retryCount: 'retry_count',
      batchId: 'batch_id',
      createdAt: 'created_at',
      completedAt: 'completed_at',
      processingStartedAt: 'processing_started_at',
      nextRetryAt: 'next_retry_at',
    },
  },
  optimization_events: {
    table: 'optimization_events',
    columns: {
      id: 'id',
      accountId: 'account_id',
      eventCategory: 'event_category',
      actionType: 'action_type',
      actionDetail: 'action_detail',
      changeReason: 'change_reason',
      algorithmVersion: 'algorithm_version',
      status: 'status',
      apiSyncStatus: 'api_sync_status',
      createdAt: 'created_at',
    },
  },
  search_terms: {
    table: 'search_terms',
    columns: {
      id: 'id',
      accountId: 'account_id',
      campaignId: 'campaign_id',
      adGroupId: 'ad_group_id',
      internalAdGroupId: 'internal_ad_group_id',
      searchTerm: 'search_term',
      keywordId: 'keyword_id',
      targetId: 'target_id',
      impressions: 'impressions',
      clicks: 'clicks',
      spend: 'spend',
      sales: 'sales',
      orders: 'orders',
      acos: 'acos',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  system_logs: {
    table: 'system_logs',
    columns: {
      id: 'id',
      level: 'level',
      module: 'module',
      message: 'message',
      details: 'details',
      timestamp: 'timestamp',
    },
  },
} as const;

// 类型推导
export type TableName = keyof typeof TABLE_SCHEMA;
export type ColumnName<T extends TableName> = keyof typeof TABLE_SCHEMA[T]['columns'];
export type ActualColumnName<T extends TableName, C extends ColumnName<T>> = typeof TABLE_SCHEMA[T]['columns'][C];

/**
 * 类型安全地获取列名
 * 编译期会检查表名和列名是否存在
 */
export function col<T extends TableName, C extends ColumnName<T>>(table: T, column: C): string {
  return TABLE_SCHEMA[table].columns[column] as string;
}

/**
 * 类型安全地获取带表前缀的列名
 */
export function tcol<T extends TableName, C extends ColumnName<T>>(table: T, column: C, alias?: string): string {
  const prefix = alias || TABLE_SCHEMA[table].table;
  return `${prefix}.${TABLE_SCHEMA[table].columns[column] as string}`;
}

// ============================================================
// SQL 运行时验证器
// ============================================================

/**
 * SQL 注入和语法异常检测模式
 */
const SQL_ANOMALY_PATTERNS: Array<{ pattern: RegExp; description: string; severity: 'error' | 'warn' }> = [
  { pattern: /\/\/\s*@ts-ignore/g, description: 'TypeScript注释嵌入SQL', severity: 'error' },
  { pattern: /\/\/\s*eslint/g, description: 'ESLint注释嵌入SQL', severity: 'error' },
  { pattern: /\/\*\s*@ts/g, description: 'TypeScript块注释嵌入SQL', severity: 'error' },
  { pattern: /console\.(log|warn|error)/g, description: 'console语句嵌入SQL', severity: 'error' },
  { pattern: /\bfunction\s*\(/g, description: 'JavaScript函数定义嵌入SQL', severity: 'error' },
  { pattern: /\bconst\s+\w+\s*=/g, description: 'JavaScript变量声明嵌入SQL', severity: 'error' },
  { pattern: /\blet\s+\w+\s*=/g, description: 'JavaScript变量声明嵌入SQL', severity: 'error' },
  { pattern: /\bvar\s+\w+\s*=/g, description: 'JavaScript变量声明嵌入SQL', severity: 'error' },
  { pattern: /\bimport\s+\{/g, description: 'JavaScript import嵌入SQL', severity: 'error' },
  { pattern: /\brequire\s*\(/g, description: 'JavaScript require嵌入SQL', severity: 'error' },
  { pattern: /;\s*DROP\s+TABLE/gi, description: '潜在SQL注入: DROP TABLE', severity: 'error' },
  { pattern: /;\s*DELETE\s+FROM/gi, description: '潜在SQL注入: DELETE FROM', severity: 'warn' },
  { pattern: /UNION\s+ALL\s+SELECT/gi, description: '潜在SQL注入: UNION SELECT', severity: 'warn' },
];

/**
 * 验证 SQL 查询字符串，检测异常模式
 * 
 * @returns null 表示通过验证，否则返回错误描述
 */
export function validateSql(sql: string, context?: string): string | null {
  for (const { pattern, description, severity } of SQL_ANOMALY_PATTERNS) {
    // 重置 lastIndex（全局正则需要重置）
    pattern.lastIndex = 0;
    if (pattern.test(sql)) {
      const msg = `[v525] SQL验证失败 [${severity}]: ${description}` +
        (context ? ` (来源: ${context})` : '') +
        ` | SQL片段: ${sql.substring(0, 200)}`;
      
      if (severity === 'error') {
        log.warn(msg);
        logSyncWarn('TypeSafeQuery', `SQL验证拦截: ${description}`, { context });
        return description;
      } else {
        log.warn(msg);
      }
    }
  }
  return null;
}

// ============================================================
// 安全执行包装器
// ============================================================

/** 慢查询阈值（毫秒） */
const SLOW_QUERY_THRESHOLD_MS = 5000;

/** 查询执行统计 */
interface QueryStats {
  totalQueries: number;
  totalErrors: number;
  totalSlowQueries: number;
  validationRejections: number;
  avgDurationMs: number;
  recentSlowQueries: Array<{ sql: string; durationMs: number; timestamp: Date }>;
}

const stats: QueryStats = {
  totalQueries: 0,
  totalErrors: 0,
  totalSlowQueries: 0,
  validationRejections: 0,
  avgDurationMs: 0,
  recentSlowQueries: [],
};

/**
 * 安全执行 SQL 查询
 * 
 * 功能:
 * 1. 运行前验证 SQL 语法（拦截嵌入的注释、JS代码等）
 * 2. 记录执行耗时，标记慢查询
 * 3. 统一错误处理和日志记录
 * 
 * @param conn - 数据库连接
 * @param sqlStr - SQL 查询字符串
 * @param params - 查询参数
 * @param context - 调用上下文（函数名等）
 * @returns 查询结果
 */
export async function safeExecute(
  conn: Record<string, Function>,
  sqlStr: string,
  params: unknown[] = [],
  context: string = 'unknown'
): Promise<unknown[]> {
  // Step 1: SQL 验证
  const validationError = validateSql(sqlStr, context);
  if (validationError) {
    stats.validationRejections++;
    throw new Error(`[v525] SQL验证拦截: ${validationError} (来源: ${context})`);
  }

  // Step 2: 执行查询
  const startTime = Date.now();
  stats.totalQueries++;

  try {
    const result = await conn.execute(sqlStr, params);
    
    // Step 3: 记录耗时
    const durationMs = Date.now() - startTime;
    updateAvgDuration(durationMs);
    
    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      stats.totalSlowQueries++;
      stats.recentSlowQueries.push({
        sql: sqlStr.substring(0, 500),
        durationMs,
        timestamp: new Date(),
      });
      // 保留最近 20 条慢查询
      if (stats.recentSlowQueries.length > 20) {
        stats.recentSlowQueries.shift();
      }
      log.warn(`[v525] 慢查询检测: ${durationMs}ms | ${context} | ${sqlStr.substring(0, 200)}`);
    }

    return result as unknown[];
  } catch (err: unknown) {
    stats.totalErrors++;
    const errMsg = (err as Error).message;
    log.warn(`[v525] SQL执行失败: ${context} | ${errMsg} | SQL: ${sqlStr.substring(0, 300)}`);
    throw err;
  }
}

function updateAvgDuration(durationMs: number): void {
  if (stats.totalQueries <= 1) {
    stats.avgDurationMs = durationMs;
  } else {
    // 指数移动平均
    stats.avgDurationMs = stats.avgDurationMs * 0.95 + durationMs * 0.05;
  }
}

/**
 * 获取查询统计信息
 */
export function getQueryStats(): QueryStats {
  return { ...stats };
}

/**
 * 重置查询统计
 */
export function resetQueryStats(): void {
  stats.totalQueries = 0;
  stats.totalErrors = 0;
  stats.totalSlowQueries = 0;
  stats.validationRejections = 0;
  stats.avgDurationMs = 0;
  stats.recentSlowQueries = [];
}

// ============================================================
// 查询构建器（用于新代码）
// ============================================================

/**
 * 类型安全的 SELECT 查询构建器
 */
export class SelectBuilder<T extends TableName> {
  private tableName: T;
  private selectedColumns: string[];
  private conditions: string[] = [];
  private params: unknown[] = [];
  private joinClauses: string[] = [];
  private orderByClause: string = '';
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private groupByClause: string = '';
  private context: string = '';

  constructor(table: T, columns: ColumnName<T>[]) {
    this.tableName = table;
    this.selectedColumns = columns.map(c => TABLE_SCHEMA[table].columns[c as string] as string);
    this.context = `SelectBuilder(${table})`;
  }

  /**
   * 添加 WHERE 条件
   * @param condition - SQL 条件表达式（使用 ? 作为参数占位符）
   * @param condParams - 条件参数
   */
  where(condition: string, condParams: unknown[] = []): this {
    this.conditions.push(condition);
    this.params.push(...condParams);
    return this;
  }

  /**
   * 添加 AND WHERE 条件（语义等同于 where，用于链式调用可读性）
   */
  andWhere(condition: string, condParams: unknown[] = []): this {
    return this.where(condition, condParams);
  }

  /**
   * 添加 JOIN 子句
   */
  join(joinSql: string): this {
    this.joinClauses.push(joinSql);
    return this;
  }

  /**
   * 添加 ORDER BY
   */
  orderBy(clause: string): this {
    this.orderByClause = clause;
    return this;
  }

  /**
   * 添加 GROUP BY
   */
  groupBy(clause: string): this {
    this.groupByClause = clause;
    return this;
  }

  /**
   * 设置 LIMIT
   */
  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  /**
   * 设置 OFFSET
   */
  offset(n: number): this {
    this.offsetValue = n;
    return this;
  }

  /**
   * 构建 SQL 字符串
   */
  build(): { sql: string; params: unknown[] } {
    let sql = `SELECT ${this.selectedColumns.join(', ')} FROM ${TABLE_SCHEMA[this.tableName].table}`;
    
    if (this.joinClauses.length > 0) {
      sql += ' ' + this.joinClauses.join(' ');
    }
    
    if (this.conditions.length > 0) {
      sql += ' WHERE ' + this.conditions.join(' AND ');
    }
    
    if (this.groupByClause) {
      sql += ' GROUP BY ' + this.groupByClause;
    }
    
    if (this.orderByClause) {
      sql += ' ORDER BY ' + this.orderByClause;
    }
    
    if (this.limitValue !== null) {
      sql += ` LIMIT ${this.limitValue}`;
    }
    
    if (this.offsetValue !== null) {
      sql += ` OFFSET ${this.offsetValue}`;
    }

    return { sql, params: this.params };
  }

  /**
   * 构建并执行查询
   */
  async execute(conn: Record<string, Function>): Promise<unknown[]> {
    const { sql, params } = this.build();
    return safeExecute(conn, sql, params, this.context);
  }
}

/**
 * 类型安全的 UPDATE 查询构建器
 */
export class UpdateBuilder<T extends TableName> {
  private tableName: T;
  private setClauses: string[] = [];
  private conditions: string[] = [];
  private params: unknown[] = [];
  private setParams: unknown[] = [];
  private context: string = '';

  constructor(table: T) {
    this.tableName = table;
    this.context = `UpdateBuilder(${table})`;
  }

  /**
   * 设置列值
   */
  set<C extends ColumnName<T>>(column: C, value: unknown): this {
    const colName = TABLE_SCHEMA[this.tableName].columns[column as string] as string;
    this.setClauses.push(`${colName} = ?`);
    this.setParams.push(value);
    return this;
  }

  /**
   * 设置列为 SQL 表达式（如 NOW()）
   */
  setRaw<C extends ColumnName<T>>(column: C, expression: string): this {
    const colName = TABLE_SCHEMA[this.tableName].columns[column as string] as string;
    this.setClauses.push(`${colName} = ${expression}`);
    return this;
  }

  /**
   * 添加 WHERE 条件
   */
  where(condition: string, condParams: unknown[] = []): this {
    this.conditions.push(condition);
    this.params.push(...condParams);
    return this;
  }

  /**
   * 添加 AND WHERE 条件
   */
  andWhere(condition: string, condParams: unknown[] = []): this {
    return this.where(condition, condParams);
  }

  /**
   * 构建 SQL 字符串
   */
  build(): { sql: string; params: unknown[] } {
    if (this.setClauses.length === 0) {
      throw new Error(`[v525] UpdateBuilder: 没有设置任何列值`);
    }

    let sql = `UPDATE ${TABLE_SCHEMA[this.tableName].table} SET ${this.setClauses.join(', ')}`;
    
    if (this.conditions.length > 0) {
      sql += ' WHERE ' + this.conditions.join(' AND ');
    }

    // SET 参数在前，WHERE 参数在后
    return { sql, params: [...this.setParams, ...this.params] };
  }

  /**
   * 构建并执行查询
   */
  async execute(conn: Record<string, Function>): Promise<unknown[]> {
    const { sql, params } = this.build();
    return safeExecute(conn, sql, params, this.context);
  }
}

// ============================================================
// 便捷工厂方法
// ============================================================

/**
 * 创建类型安全的 SELECT 查询
 * 
 * @example
 * ```
 * const rows = await SafeQuery.select('keywords', ['id', 'keywordId', 'bid'])
 *   .where('accountId = ?', [accountId])
 *   .limit(100)
 *   .execute(conn);
 * ```
 */
export const SafeQuery = {
  select<T extends TableName>(table: T, columns: ColumnName<T>[]): SelectBuilder<T> {
    return new SelectBuilder(table, columns);
  },

  update<T extends TableName>(table: T): UpdateBuilder<T> {
    return new UpdateBuilder(table);
  },
};
