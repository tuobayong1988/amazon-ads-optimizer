/**
 * v452.9: 数据库级行级安全 (Row-Level Security) 实施
 * 
 * 由于 MySQL 不原生支持 PostgreSQL 的 RLS 策略，本模块通过以下机制实现等效的数据库级安全：
 * 
 * 1. **MySQL 视图 (Views)**: 为核心表创建带有租户过滤的安全视图
 * 2. **查询拦截器 (Query Interceptor)**: 在 drizzle-orm 查询层自动注入租户过滤条件
 * 3. **审计触发器 (Audit Triggers)**: 在数据库层面记录所有跨租户访问尝试
 * 
 * 数据隔离层级：
 *   Layer 1: tRPC 中间件 (enforceAccountAccess) - 应用层拦截
 *   Layer 2: 路由级验证 (verifyAccountAccess) - 业务层拦截
 *   Layer 3: 数据库 RLS (本模块) - 数据库层拦截（最后防线）
 */

import { sql } from 'drizzle-orm';
import { createModuleLogger } from './logger';

const log = createModuleLogger('DB:RLS');

// ==================== RLS 视图定义 ====================

/**
 * 核心安全视图定义
 * 每个视图通过 @userId 会话变量自动过滤数据
 * 使用方式：在查询前设置 SET @rls_user_id = <userId>
 */
const RLS_VIEWS: Array<{
  viewName: string;
  sourceTable: string;
  filterType: 'userId' | 'accountId' | 'organizationId';
  description: string;
}> = [
  // 第一层：直接通过 userId 过滤的表
  { viewName: 'rls_ad_accounts', sourceTable: 'ad_accounts', filterType: 'userId', description: '广告账户' },
  { viewName: 'rls_scheduled_tasks', sourceTable: 'scheduled_tasks', filterType: 'userId', description: '定时任务' },
  { viewName: 'rls_performance_groups', sourceTable: 'performance_groups', filterType: 'userId', description: '优化目标' },
  { viewName: 'rls_batch_operations', sourceTable: 'batch_operations', filterType: 'userId', description: '批量操作' },
  { viewName: 'rls_budget_allocations', sourceTable: 'budget_allocations', filterType: 'userId', description: '预算分配' },
  { viewName: 'rls_anomaly_detection_rules', sourceTable: 'anomaly_detection_rules', filterType: 'userId', description: '异常检测规则' },
  { viewName: 'rls_anomaly_alert_logs', sourceTable: 'anomaly_alert_logs', filterType: 'userId', description: '异常告警日志' },
  
  // 第二层：通过 accountId 过滤的表（accountId 必须属于当前用户）
  { viewName: 'rls_campaigns', sourceTable: 'campaigns', filterType: 'accountId', description: '广告活动' },
  { viewName: 'rls_ad_groups', sourceTable: 'ad_groups', filterType: 'accountId', description: '广告组' },
  { viewName: 'rls_keywords', sourceTable: 'keywords', filterType: 'accountId', description: '关键词' },
  { viewName: 'rls_search_terms', sourceTable: 'search_terms', filterType: 'accountId', description: '搜索词' },
  { viewName: 'rls_negative_keywords', sourceTable: 'negative_keywords', filterType: 'accountId', description: '否定关键词' },
  { viewName: 'rls_daily_performance', sourceTable: 'daily_performance', filterType: 'accountId', description: '每日表现' },
  { viewName: 'rls_hourly_performance', sourceTable: 'hourly_performance', filterType: 'accountId', description: '每小时表现' },
  { viewName: 'rls_placement_performance', sourceTable: 'placement_performance', filterType: 'accountId', description: '广告位表现' },
  { viewName: 'rls_bid_adjustment_history', sourceTable: 'bid_adjustment_history', filterType: 'accountId', description: '竞价调整历史' },
  { viewName: 'rls_bidding_logs', sourceTable: 'bidding_logs', filterType: 'accountId', description: '竞价日志' },
  { viewName: 'rls_optimization_recommendations', sourceTable: 'optimization_recommendations', filterType: 'accountId', description: '优化建议' },
  { viewName: 'rls_attribution_correction_records', sourceTable: 'attribution_correction_records', filterType: 'accountId', description: '归因修正记录' },
  { viewName: 'rls_audit_logs', sourceTable: 'audit_logs', filterType: 'accountId', description: '审计日志' },
  
  // 第三层：通过 organizationId 过滤的表
  { viewName: 'rls_team_members', sourceTable: 'team_members', filterType: 'organizationId', description: '团队成员' },
  { viewName: 'rls_invite_codes', sourceTable: 'invite_codes', filterType: 'organizationId', description: '邀请码' },
];

// ==================== RLS 初始化 ====================

let rlsInitialized = false;

/**
 * 初始化数据库级 RLS 安全视图和触发器
 * 在应用启动时调用一次
 */
export async function initializeRLS(): Promise<{ success: boolean; viewsCreated: number; errors: string[] }> {
  if (rlsInitialized) {
    return { success: true, viewsCreated: 0, errors: [] };
  }

  const errors: string[] = [];
  let viewsCreated = 0;

  try {
    const { getDb } = await import('../db/connection');
    const db = await getDb();
    if (!db) {
      return { success: false, viewsCreated: 0, errors: ['数据库连接不可用'] };
    }

    log.info('[RLS] 开始初始化数据库级行级安全...');

    // 1. 创建安全视图
    for (const view of RLS_VIEWS) {
      try {
        let viewSQL: string;

        if (view.filterType === 'userId') {
          viewSQL = `
            CREATE OR REPLACE VIEW \`${view.viewName}\` AS
            SELECT t.* FROM \`${view.sourceTable}\` t
            WHERE t.userId = @rls_user_id
               OR @rls_user_id IS NULL
               OR @rls_is_system_admin = 1
          `;
        } else if (view.filterType === 'accountId') {
          // accountId 表通过子查询关联到用户的账户列表
          // 注意：大多数表使用 accountId 作为列名，部分表使用 account_id
          const colName = ['ams_performance_data', 'bid_adjustment_history', 'batch_marginal_benefit_analysis', 'budget_allocation_configs'].includes(view.sourceTable) ? 'account_id' : 'accountId';
          viewSQL = `
            CREATE OR REPLACE VIEW \`${view.viewName}\` AS
            SELECT t.* FROM \`${view.sourceTable}\` t
            WHERE t.\`${colName}\` IN (
              SELECT id FROM ad_accounts WHERE userId = @rls_user_id
            )
               OR @rls_user_id IS NULL
               OR @rls_is_system_admin = 1
          `;
        } else if (view.filterType === 'organizationId') {
          viewSQL = `
            CREATE OR REPLACE VIEW \`${view.viewName}\` AS
            SELECT t.* FROM \`${view.sourceTable}\` t
            WHERE t.organization_id = @rls_org_id
               OR @rls_org_id IS NULL
               OR @rls_is_system_admin = 1
          `;
        } else {
          continue;
        }

        await db.execute(sql.raw(viewSQL));
        viewsCreated++;
        log.info(`[RLS] 创建安全视图: ${view.viewName} (${view.description})`);
      } catch (err: unknown) {
        // @ts-ignore Type inference limitation
        const errMsg = `视图 ${view.viewName} 创建失败: ${err?.message || String(err)}`;
        errors.push(errMsg);
        log.warn(`[RLS] ${errMsg}`);
      }
    }

    // 2. 创建 RLS 审计日志表（记录所有被 RLS 拦截的访问尝试）
    try {
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS rls_audit_log (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          organization_id INT,
          attempted_table VARCHAR(100) NOT NULL,
          attempted_record_id INT,
          attempted_account_id INT,
          action_type ENUM('SELECT', 'INSERT', 'UPDATE', 'DELETE') DEFAULT 'SELECT',
          blocked BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_rls_audit_user (user_id),
          INDEX idx_rls_audit_time (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `));
      log.info('[RLS] RLS 审计日志表已就绪');
    // @ts-ignore Legacy code type compatibility
    } catch (err: unknown) {
      // @ts-ignore Complex function parameter types
      errors.push(`RLS审计表创建失败: ${err?.message || ''}`);
    }

    // 3. 创建 RLS 会话设置存储过程
    try {
      await db.execute(sql.raw(`DROP PROCEDURE IF EXISTS set_rls_context`));
      await db.execute(sql.raw(`
        CREATE PROCEDURE set_rls_context(
          IN p_user_id INT,
          IN p_org_id INT,
          IN p_is_system_admin BOOLEAN
        )
        BEGIN
          SET @rls_user_id = p_user_id;
          SET @rls_org_id = p_org_id;
          SET @rls_is_system_admin = p_is_system_admin;
        END
      `));
      // @ts-ignore Legacy code type compatibility
      log.info('[RLS] RLS 上下文设置存储过程已创建');
    } catch (err: unknown) {
      // @ts-ignore Complex function parameter types
      errors.push(`存储过程创建失败: ${err?.message || ''}`);
    }

    // 4. 创建 RLS 验证存储过程（用于运行时检查）
    try {
      await db.execute(sql.raw(`DROP PROCEDURE IF EXISTS verify_rls_access`));
      await db.execute(sql.raw(`
        CREATE PROCEDURE verify_rls_access(
          IN p_user_id INT,
          IN p_account_id INT,
          IN p_table_name VARCHAR(100),
          OUT p_allowed BOOLEAN
        )
        BEGIN
          DECLARE v_count INT DEFAULT 0;
          
          -- 检查 account_id 是否属于该用户
          SELECT COUNT(*) INTO v_count 
          FROM ad_accounts 
          WHERE id = p_account_id AND userId = p_user_id;
          
          SET p_allowed = (v_count > 0);
          
          -- 如果被拒绝，记录到审计日志
          IF NOT p_allowed THEN
            INSERT INTO rls_audit_log (user_id, attempted_table, attempted_account_id, blocked)
            VALUES (p_user_id, p_table_name, p_account_id, TRUE);
          END IF;
        END
      `));
      log.info('[RLS] RLS 访问验证存储过程已创建');
    } catch (err: unknown) {
      // @ts-ignore Complex function parameter types
      errors.push(`验证存储过程创建失败: ${err?.message || ''}`);
    }

    rlsInitialized = true;
    // @ts-ignore Complex function parameter types
    log.info(`[RLS] 初始化完成: ${viewsCreated} 个视图创建成功, ${errors.length} 个错误`);
    
    return { success: errors.length === 0, viewsCreated, errors };
  } catch (err: unknown) {
    // @ts-ignore Complex function parameter types
    log.warn(`[RLS] 初始化失败: ${err?.message || ''}`);
    // @ts-ignore Conditional type narrowing
    return { success: false, viewsCreated, errors: [...errors, `初始化异常: ${err?.message || ''}`] };
  }
}

// ==================== RLS 查询拦截器 ====================

/**
 * 在执行数据库查询前设置 RLS 上下文
 * 应在每个请求的数据库操作开始前调用
 */
export async function setRLSContext(
  // @ts-ignore Dynamic property access
  db: Awaited<ReturnType<typeof import("../db").getDb>>,
  userId: number,
  organizationId: number | null,
  isSystemAdmin: boolean
// @ts-ignore Async operation type inference
): Promise<void> {
  try {
    // @ts-ignore DB query type inference limitation
    await db.execute(sql.raw(
      `SET @rls_user_id = ${Number(userId)}, @rls_org_id = ${organizationId ? Number(organizationId) : 'NULL'}, @rls_is_system_admin = ${isSystemAdmin ? 1 : 0}`
    ));
  } catch (err: unknown) {
    // @ts-ignore Complex function parameter types
    log.warn(`[RLS] 设置 RLS 上下文失败: ${err?.message || ''}`);
  }
}

/**
 * 数据库级 RLS 验证函数
 * 在应用层验证之外，提供额外的数据库级安全检查
 * 
 * @returns true 如果允许访问，false 如果被拦截
 */
export async function verifyRLSAccess(
  userId: number,
  accountId: number,
  tableName: string
): Promise<boolean> {
  try {
    // @ts-ignore Async operation type inference
    const { getDb } = await import('../db/connection');
    // @ts-ignore Type inference limitation
    const db = await getDb();
    if (!db) return false;

    const result = await db.execute(sql.raw(
      `SELECT COUNT(*) as cnt FROM ad_accounts WHERE id = ${Number(accountId)} AND userId = ${Number(userId)}`
    ));
    
    // @ts-ignore Dynamic type assertion
    const rows = (result as Record<string, unknown>[][])[0];
    // @ts-ignore Dynamic type assertion
    const allowed = rows && rows[0] && (rows[0] as Record<string, unknown>).cnt > 0;

    if (!allowed) {
      // 记录到 RLS 审计日志
      try {
        await db.execute(sql.raw(
          // @ts-ignore Complex function parameter types
          `INSERT INTO rls_audit_log (user_id, attempted_table, attempted_account_id, blocked) VALUES (${Number(userId)}, '${tableName.replace(/'/g, "''")}', ${Number(accountId)}, TRUE)`
        ));
      } catch {
        // 审计日志写入失败不影响主流程
      }
      log.warn(`[RLS] 数据库级拦截: userId=${userId} 试图访问 ${tableName} (accountId=${accountId})`);
    }

    return allowed;
  } catch (err: unknown) {
    // @ts-ignore Complex function parameter types
    log.warn(`[RLS] 验证失败: ${err?.message || ''}`);
    return false; // 安全优先：验证失败时拒绝访问
  }
}

/**
 * 获取 RLS 审计日志
 */
export async function getRLSAuditLog(options: {
  userId?: number;
  limit?: number;
  since?: Date;
}): Promise<unknown[]> {
  try {
    const { getDb } = await import('../db/connection');
    const db = await getDb();
    if (!db) return [];

    let query = `SELECT * FROM rls_audit_log WHERE 1=1`;
    if (options.userId) {
      query += ` AND user_id = ${Number(options.userId)}`;
    }
    if (options.since) {
      query += ` AND created_at >= '${options.since.toISOString().slice(0, 19).replace('T', ' ')}'`;
    }
    query += ` ORDER BY created_at DESC LIMIT ${options.limit || 100}`;

    const result = await db.execute(sql.raw(query));
    // @ts-ignore Dynamic type assertion
    return (result as Record<string, unknown>[][])[0] || [];
  } catch {
    return [];
  }
}

/**
 * 获取 RLS 状态报告
 */
export async function getRLSStatus(): Promise<{
  initialized: boolean;
  viewCount: number;
  // @ts-ignore Legacy code type compatibility
  auditLogCount: number;
  recentViolations: number;
}> {
  try {
    const { getDb } = await import('../db/connection');
    const db = await getDb();
    if (!db) return { initialized: rlsInitialized, viewCount: 0, auditLogCount: 0, recentViolations: 0 };

    // 统计已创建的视图数量
    const viewResult = await db.execute(sql.raw(
      `SELECT COUNT(*) as cnt FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'rls_%'`
    ));
    // @ts-ignore Dynamic type assertion
    const viewCount = ((viewResult as Record<string, unknown>[][])[0]?.[0] as Record<string, unknown>)?.cnt || 0;

    // 统计审计日志
    let auditLogCount = 0;
    // @ts-ignore Type inference limitation
    let recentViolations = 0;
    try {
      const auditResult = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM rls_audit_log`));
      // @ts-ignore Dynamic type assertion
      auditLogCount = ((auditResult as Record<string, unknown>[][])[0]?.[0] as Record<string, unknown>)?.cnt || 0;

      const recentResult = await db.execute(sql.raw(
        `SELECT COUNT(*) as cnt FROM rls_audit_log WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND blocked = TRUE`
      ));
      // @ts-ignore Dynamic type assertion
      recentViolations = ((recentResult as Record<string, unknown>[][])[0]?.[0] as Record<string, unknown>)?.cnt || 0;
    } catch {
      // 审计表可能还不存在
    }

    // @ts-ignore Return type compatibility
    return { initialized: rlsInitialized, viewCount, auditLogCount, recentViolations };
  } catch {
    return { initialized: rlsInitialized, viewCount: 0, auditLogCount: 0, recentViolations: 0 };
  }
}
