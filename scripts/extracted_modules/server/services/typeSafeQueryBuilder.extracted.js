// Extracted from production dist/index.js
// Original module: server/services/typeSafeQueryBuilder.ts
// Lines: 446

var typeSafeQueryBuilder_exports = {};
__export(typeSafeQueryBuilder_exports, {
  SafeQuery: () => SafeQuery,
  SelectBuilder: () => SelectBuilder,
  TABLE_SCHEMA: () => TABLE_SCHEMA,
  UpdateBuilder: () => UpdateBuilder,
  col: () => col,
  getQueryStats: () => getQueryStats,
  resetQueryStats: () => resetQueryStats,
  safeExecute: () => safeExecute,
  tcol: () => tcol,
  validateSql: () => validateSql
});
function col(table, column) {
  return TABLE_SCHEMA[table].columns[column];
}
function tcol(table, column, alias) {
  const prefix = alias || TABLE_SCHEMA[table].table;
  return `${prefix}.${TABLE_SCHEMA[table].columns[column]}`;
}
function validateSql(sql15, context) {
  for (const { pattern, description, severity } of SQL_ANOMALY_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(sql15)) {
      const msg = `[v525] SQL\u9A8C\u8BC1\u5931\u8D25 [${severity}]: ${description}` + (context ? ` (\u6765\u6E90: ${context})` : "") + ` | SQL\u7247\u6BB5: ${sql15.substring(0, 200)}`;
      if (severity === "error") {
        log86.warn(msg);
        logSyncWarn("TypeSafeQuery", `SQL\u9A8C\u8BC1\u62E6\u622A: ${description}`, { context });
        return description;
      } else {
        log86.warn(msg);
      }
    }
  }
  return null;
}
async function safeExecute(conn, sqlStr, params = [], context = "unknown") {
  const validationError = validateSql(sqlStr, context);
  if (validationError) {
    stats3.validationRejections++;
    throw new Error(`[v525] SQL\u9A8C\u8BC1\u62E6\u622A: ${validationError} (\u6765\u6E90: ${context})`);
  }
  const startTime = Date.now();
  stats3.totalQueries++;
  try {
    const result = await conn.execute(sqlStr, params);
    const durationMs = Date.now() - startTime;
    updateAvgDuration(durationMs);
    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      stats3.totalSlowQueries++;
      stats3.recentSlowQueries.push({
        sql: sqlStr.substring(0, 500),
        durationMs,
        timestamp: /* @__PURE__ */ new Date()
      });
      if (stats3.recentSlowQueries.length > 20) {
        stats3.recentSlowQueries.shift();
      }
      log86.warn(`[v525] \u6162\u67E5\u8BE2\u68C0\u6D4B: ${durationMs}ms | ${context} | ${sqlStr.substring(0, 200)}`);
    }
    return result;
  } catch (err) {
    stats3.totalErrors++;
    const errMsg = err.message;
    log86.warn(`[v525] SQL\u6267\u884C\u5931\u8D25: ${context} | ${errMsg} | SQL: ${sqlStr.substring(0, 300)}`);
    throw err;
  }
}
function updateAvgDuration(durationMs) {
  if (stats3.totalQueries <= 1) {
    stats3.avgDurationMs = durationMs;
  } else {
    stats3.avgDurationMs = stats3.avgDurationMs * 0.95 + durationMs * 0.05;
  }
}
function getQueryStats() {
  return { ...stats3 };
}
function resetQueryStats() {
  stats3.totalQueries = 0;
  stats3.totalErrors = 0;
  stats3.totalSlowQueries = 0;
  stats3.validationRejections = 0;
  stats3.avgDurationMs = 0;
  stats3.recentSlowQueries = [];
}
var log86, TABLE_SCHEMA, SQL_ANOMALY_PATTERNS, SLOW_QUERY_THRESHOLD_MS, stats3, SelectBuilder, UpdateBuilder, SafeQuery;
var init_typeSafeQueryBuilder = __esm({
  "server/services/typeSafeQueryBuilder.ts"() {
    "use strict";
    init_logger();
    init_opsLogger();
    log86 = createModuleLogger("TypeSafeQuery");
    TABLE_SCHEMA = {
      keywords: {
        table: "keywords",
        columns: {
          id: "id",
          keywordId: "keywordId",
          keywordText: "keywordText",
          keywordStatus: "keywordStatus",
          bid: "bid",
          matchType: "matchType",
          campaignId: "campaignId",
          accountId: "accountId",
          internalAdGroupId: "internal_ad_group_id",
          suggestedBid: "suggestedBid",
          createdAt: "createdAt",
          updatedAt: "updatedAt"
        }
      },
      product_targets: {
        table: "product_targets",
        columns: {
          id: "id",
          targetId: "targetId",
          targetExpression: "targetExpression",
          targetStatus: "targetStatus",
          bid: "bid",
          campaignId: "campaignId",
          accountId: "accountId",
          internalAdGroupId: "internal_ad_group_id",
          suggestedBid: "suggestedBid",
          createdAt: "createdAt",
          updatedAt: "updatedAt"
        }
      },
      campaigns: {
        table: "campaigns",
        columns: {
          id: "id",
          campaignId: "campaignId",
          campaignName: "campaignName",
          campaignType: "campaignType",
          campaignStatus: "campaignStatus",
          costType: "cost_type",
          adFormat: "ad_format",
          accountId: "accountId",
          budget: "budget",
          createdAt: "createdAt",
          updatedAt: "updatedAt"
        }
      },
      ad_groups: {
        table: "ad_groups",
        columns: {
          id: "id",
          adGroupId: "adGroupId",
          adGroupName: "adGroupName",
          adGroupStatus: "adGroupStatus",
          campaignId: "campaignId",
          accountId: "accountId",
          defaultBid: "defaultBid",
          createdAt: "createdAt",
          updatedAt: "updatedAt"
        }
      },
      ad_accounts: {
        table: "ad_accounts",
        columns: {
          id: "id",
          marketplace: "marketplace",
          status: "status",
          profileId: "profileId",
          createdAt: "createdAt",
          updatedAt: "updatedAt"
        }
      },
      optimization_tasks: {
        table: "optimization_tasks",
        columns: {
          id: "id",
          accountId: "account_id",
          taskType: "task_type",
          targetEntityType: "target_entity_type",
          targetEntityId: "target_entity_id",
          amazonEntityId: "amazon_entity_id",
          status: "status",
          errorMessage: "error_message",
          retryCount: "retry_count",
          batchId: "batch_id",
          createdAt: "created_at",
          completedAt: "completed_at",
          processingStartedAt: "processing_started_at",
          nextRetryAt: "next_retry_at"
        }
      },
      optimization_events: {
        table: "optimization_events",
        columns: {
          id: "id",
          accountId: "account_id",
          eventCategory: "event_category",
          actionType: "action_type",
          actionDetail: "action_detail",
          changeReason: "change_reason",
          algorithmVersion: "algorithm_version",
          status: "status",
          apiSyncStatus: "api_sync_status",
          createdAt: "created_at"
        }
      },
      search_terms: {
        table: "search_terms",
        columns: {
          id: "id",
          accountId: "account_id",
          campaignId: "campaign_id",
          adGroupId: "ad_group_id",
          internalAdGroupId: "internal_ad_group_id",
          searchTerm: "search_term",
          keywordId: "keyword_id",
          targetId: "target_id",
          impressions: "impressions",
          clicks: "clicks",
          spend: "spend",
          sales: "sales",
          orders: "orders",
          acos: "acos",
          createdAt: "created_at",
          updatedAt: "updated_at"
        }
      },
      system_logs: {
        table: "system_logs",
        columns: {
          id: "id",
          level: "level",
          module: "module",
          message: "message",
          details: "details",
          timestamp: "timestamp"
        }
      }
    };
    __name(col, "col");
    __name(tcol, "tcol");
    SQL_ANOMALY_PATTERNS = [
      { pattern: /\/\/\s*@ts-ignore/g, description: "TypeScript\u6CE8\u91CA\u5D4C\u5165SQL", severity: "error" },
      { pattern: /\/\/\s*eslint/g, description: "ESLint\u6CE8\u91CA\u5D4C\u5165SQL", severity: "error" },
      { pattern: /\/\*\s*@ts/g, description: "TypeScript\u5757\u6CE8\u91CA\u5D4C\u5165SQL", severity: "error" },
      { pattern: /console\.(log|warn|error)/g, description: "console\u8BED\u53E5\u5D4C\u5165SQL", severity: "error" },
      { pattern: /\bfunction\s*\(/g, description: "JavaScript\u51FD\u6570\u5B9A\u4E49\u5D4C\u5165SQL", severity: "error" },
      { pattern: /\bconst\s+\w+\s*=/g, description: "JavaScript\u53D8\u91CF\u58F0\u660E\u5D4C\u5165SQL", severity: "error" },
      { pattern: /\blet\s+\w+\s*=/g, description: "JavaScript\u53D8\u91CF\u58F0\u660E\u5D4C\u5165SQL", severity: "error" },
      { pattern: /\bvar\s+\w+\s*=/g, description: "JavaScript\u53D8\u91CF\u58F0\u660E\u5D4C\u5165SQL", severity: "error" },
      { pattern: /\bimport\s+\{/g, description: "JavaScript import\u5D4C\u5165SQL", severity: "error" },
      { pattern: /\brequire\s*\(/g, description: "JavaScript require\u5D4C\u5165SQL", severity: "error" },
      { pattern: /;\s*DROP\s+TABLE/gi, description: "\u6F5C\u5728SQL\u6CE8\u5165: DROP TABLE", severity: "error" },
      { pattern: /;\s*DELETE\s+FROM/gi, description: "\u6F5C\u5728SQL\u6CE8\u5165: DELETE FROM", severity: "warn" },
      { pattern: /UNION\s+ALL\s+SELECT/gi, description: "\u6F5C\u5728SQL\u6CE8\u5165: UNION SELECT", severity: "warn" }
    ];
    __name(validateSql, "validateSql");
    SLOW_QUERY_THRESHOLD_MS = 5e3;
    stats3 = {
      totalQueries: 0,
      totalErrors: 0,
      totalSlowQueries: 0,
      validationRejections: 0,
      avgDurationMs: 0,
      recentSlowQueries: []
    };
    __name(safeExecute, "safeExecute");
    __name(updateAvgDuration, "updateAvgDuration");
    __name(getQueryStats, "getQueryStats");
    __name(resetQueryStats, "resetQueryStats");
    SelectBuilder = class {
      static {
        __name(this, "SelectBuilder");
      }
      tableName;
      selectedColumns;
      conditions = [];
      params = [];
      joinClauses = [];
      orderByClause = "";
      limitValue = null;
      offsetValue = null;
      groupByClause = "";
      context = "";
      constructor(table, columns) {
        this.tableName = table;
        this.selectedColumns = columns.map((c) => TABLE_SCHEMA[table].columns[c]);
        this.context = `SelectBuilder(${table})`;
      }
      /**
       * 添加 WHERE 条件
       * @param condition - SQL 条件表达式（使用 ? 作为参数占位符）
       * @param condParams - 条件参数
       */
      where(condition, condParams = []) {
        this.conditions.push(condition);
        this.params.push(...condParams);
        return this;
      }
      /**
       * 添加 AND WHERE 条件（语义等同于 where，用于链式调用可读性）
       */
      andWhere(condition, condParams = []) {
        return this.where(condition, condParams);
      }
      /**
       * 添加 JOIN 子句
       */
      join(joinSql) {
        this.joinClauses.push(joinSql);
        return this;
      }
      /**
       * 添加 ORDER BY
       */
      orderBy(clause) {
        this.orderByClause = clause;
        return this;
      }
      /**
       * 添加 GROUP BY
       */
      groupBy(clause) {
        this.groupByClause = clause;
        return this;
      }
      /**
       * 设置 LIMIT
       */
      limit(n) {
        this.limitValue = n;
        return this;
      }
      /**
       * 设置 OFFSET
       */
      offset(n) {
        this.offsetValue = n;
        return this;
      }
      /**
       * 构建 SQL 字符串
       */
      build() {
        let sql15 = `SELECT ${this.selectedColumns.join(", ")} FROM ${TABLE_SCHEMA[this.tableName].table}`;
        if (this.joinClauses.length > 0) {
          sql15 += " " + this.joinClauses.join(" ");
        }
        if (this.conditions.length > 0) {
          sql15 += " WHERE " + this.conditions.join(" AND ");
        }
        if (this.groupByClause) {
          sql15 += " GROUP BY " + this.groupByClause;
        }
        if (this.orderByClause) {
          sql15 += " ORDER BY " + this.orderByClause;
        }
        if (this.limitValue !== null) {
          sql15 += ` LIMIT ${this.limitValue}`;
        }
        if (this.offsetValue !== null) {
          sql15 += ` OFFSET ${this.offsetValue}`;
        }
        return { sql: sql15, params: this.params };
      }
      /**
       * 构建并执行查询
       */
      async execute(conn) {
        const { sql: sql15, params } = this.build();
        return safeExecute(conn, sql15, params, this.context);
      }
    };
    UpdateBuilder = class {
      static {
        __name(this, "UpdateBuilder");
      }
      tableName;
      setClauses = [];
      conditions = [];
      params = [];
      setParams = [];
      context = "";
      constructor(table) {
        this.tableName = table;
        this.context = `UpdateBuilder(${table})`;
      }
      /**
       * 设置列值
       */
      set(column, value) {
        const colName = TABLE_SCHEMA[this.tableName].columns[column];
        this.setClauses.push(`${colName} = ?`);
        this.setParams.push(value);
        return this;
      }
      /**
       * 设置列为 SQL 表达式（如 NOW()）
       */
      setRaw(column, expression) {
        const colName = TABLE_SCHEMA[this.tableName].columns[column];
        this.setClauses.push(`${colName} = ${expression}`);
        return this;
      }
      /**
       * 添加 WHERE 条件
       */
      where(condition, condParams = []) {
        this.conditions.push(condition);
        this.params.push(...condParams);
        return this;
      }
      /**
       * 添加 AND WHERE 条件
       */
      andWhere(condition, condParams = []) {
        return this.where(condition, condParams);
      }
      /**
       * 构建 SQL 字符串
       */
      build() {
        if (this.setClauses.length === 0) {
          throw new Error(`[v525] UpdateBuilder: \u6CA1\u6709\u8BBE\u7F6E\u4EFB\u4F55\u5217\u503C`);
        }
        let sql15 = `UPDATE ${TABLE_SCHEMA[this.tableName].table} SET ${this.setClauses.join(", ")}`;
        if (this.conditions.length > 0) {
          sql15 += " WHERE " + this.conditions.join(" AND ");
        }
        return { sql: sql15, params: [...this.setParams, ...this.params] };
      }
      /**
       * 构建并执行查询
       */
      async execute(conn) {
        const { sql: sql15, params } = this.build();
        return safeExecute(conn, sql15, params, this.context);
      }
    };
    SafeQuery = {
      select(table, columns) {
        return new SelectBuilder(table, columns);
      },
      update(table) {
        return new UpdateBuilder(table);
      }
    };
  }
});

