/**
 * v210: 运维诊断API路由 (Operations Diagnostics API)
 * 
 * 提供规范化的HTTP接口，替代低效的 `eb logs | grep` 日志搜索方式。
 * 所有端点返回结构化JSON，支持过滤、分页、关键词搜索。
 * 
 * 端点列表：
 * GET /api/ops/status          — 系统状态总览（版本/运行时间/健康度/内存）
 * GET /api/ops/summary         — 运维日志摘要（各分类计数+最新条目）
 * GET /api/ops/logs            — 统一日志查询（支持分类/级别/模块/关键词过滤）
 * GET /api/ops/logs/migration  — 数据迁移日志
 * GET /api/ops/logs/id-guard   — ID守卫拦截日志
 * GET /api/ops/logs/optimization — 优化执行日志
 * GET /api/ops/logs/sync       — 数据同步日志
 * GET /api/ops/logs/errors     — 错误日志
 * GET /api/ops/logs/system     — 系统事件日志
 * GET /api/ops/data-integrity  — 数据完整性检查（ID格式验证）
 * GET /api/ops/db-logs         — 数据库持久化日志查询（system_logs表）
 * 
 * 安全说明：
 * 生产环境中应通过API密钥或IP白名单保护这些端点。
 * 当前使用 OPS_API_KEY 环境变量进行简单认证。
 */

import { Router, Request, Response } from 'express';
import { opsCollector, OpsCategory, OpsQuery } from '../utils/opsLogger';
import { logger } from '../utils/logger';
import { getSystemInfo } from '../deployLifecycleManager';
import { SYSTEM_VERSION } from '../postDeployOptimizer';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

const router = Router();

// ============================================================
// 认证中间件
// ============================================================

function opsAuth(req: Request, res: Response, next: Function): void {
  const apiKey = process.env.OPS_API_KEY;
  
  // 如果未配置API密钥，允许所有访问（开发环境）
  if (!apiKey) {
    next();
    return;
  }
  
  // 检查 Authorization header 或 query parameter
  const providedKey = 
    req.headers['x-ops-key'] as string ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query.key as string;
  
  if (providedKey !== apiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: '需要有效的运维API密钥。通过 X-Ops-Key header 或 ?key= 参数提供。',
    });
    return;
  }
  
  next();
}

router.use(opsAuth);

// ============================================================
// 1. GET /api/ops/status — 系统状态总览
// ============================================================

router.get('/status', async (req: Request, res: Response) => {
  try {
    const sysInfo = getSystemInfo();
    const memUsage = process.memoryUsage();
    
    // 数据库连接检查
    let dbStatus = 'unknown';
    let dbLatencyMs = -1;
    try {
      const dbStart = Date.now();
      const db = await getDb();
      if (db) {
        await db.execute(sql.raw('SELECT 1'));
        dbLatencyMs = Date.now() - dbStart;
        dbStatus = 'connected';
      } else {
        dbStatus = 'not_configured';
      }
    } catch (e: any) {
      dbStatus = `error: ${e.message}`;
    }
    
    // Logger状态
    const loggerStatus = logger.getStatus();
    
    res.json({
      system: {
        version: `v${SYSTEM_VERSION}`,
        versionNumber: SYSTEM_VERSION,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptime: Math.round(sysInfo.uptime),
        uptimeFormatted: formatUptime(sysInfo.uptime),
        isShuttingDown: sysInfo.isShuttingDown,
        activeTasks: sysInfo.activeTasks,
      },
      memory: {
        rss: formatBytes(memUsage.rss),
        heapUsed: formatBytes(memUsage.heapUsed),
        heapTotal: formatBytes(memUsage.heapTotal),
        external: formatBytes(memUsage.external),
        rssRaw: memUsage.rss,
        heapUsedRaw: memUsage.heapUsed,
      },
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
      },
      logger: {
        bufferUsage: `${loggerStatus.bufferSize}/${loggerStatus.bufferCapacity}`,
        recentRate: `${loggerStatus.recentRate} logs/min`,
        suppressedTotal: loggerStatus.suppressedTotal,
        dbBufferPending: loggerStatus.dbBufferSize,
      },
      opsLogger: opsCollector.getSummary(),
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 2. GET /api/ops/summary — 运维日志摘要
// ============================================================

router.get('/summary', (req: Request, res: Response) => {
  try {
    const summary = opsCollector.getSummary();
    res.json({
      ...summary,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 3. GET /api/ops/logs — 统一日志查询
// ============================================================

router.get('/logs', (req: Request, res: Response) => {
  try {
    const query = parseOpsQuery(req);
    const entries = opsCollector.query(query);
    res.json({
      query,
      count: entries.length,
      entries,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 4. GET /api/ops/logs/:category — 分类日志快捷查询
// ============================================================

const VALID_CATEGORIES: OpsCategory[] = ['migration', 'id-guard', 'optimization', 'sync', 'error', 'system'];

router.get('/logs/:category', (req: Request, res: Response) => {
  try {
    const category = req.params.category as OpsCategory;
    
    // 兼容 "errors" → "error"
    const normalizedCategory = category === 'errors' ? 'error' : category;
    
    if (!VALID_CATEGORIES.includes(normalizedCategory as OpsCategory)) {
      res.status(400).json({
        error: `无效的日志分类: ${category}`,
        validCategories: VALID_CATEGORIES,
      });
      return;
    }
    
    const query = parseOpsQuery(req);
    query.category = normalizedCategory as OpsCategory;
    
    const entries = opsCollector.query(query);
    res.json({
      category: normalizedCategory,
      query,
      count: entries.length,
      entries,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 5. GET /api/ops/data-integrity — 数据完整性检查
// ============================================================

router.get('/data-integrity', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: '数据库不可用' });
      return;
    }
    
    const checks: Record<string, any> = {};
    
    // 检查1: campaigns表中campaignId格式
    try {
      const [totalResult] = await db.execute(sql.raw(
        `SELECT COUNT(*) as total FROM campaigns`
      ));
      const [invalidResult] = await db.execute(sql.raw(
        `SELECT COUNT(*) as cnt FROM campaigns WHERE LENGTH(campaignId) <= 5`
      ));
      checks.campaigns = {
        status: 'checked',
        total: extractCount(totalResult),
        suspectedLocalIds: extractCount(invalidResult),
        verdict: extractCount(invalidResult) === 0 ? 'PASS' : 'WARN',
      };
    } catch (e: any) {
      checks.campaigns = { status: 'error', message: e.message };
    }
    
    // 检查2: 各FK表的campaignId格式
    const fkTables = ['negative_keywords', 'bidding_logs', 'daily_performance', 'search_terms', 'ad_groups', 'placement_performance'];
    
    for (const table of fkTables) {
      try {
        const [totalResult] = await db.execute(sql.raw(
          `SELECT COUNT(*) as total FROM \`${table}\` WHERE campaignId IS NOT NULL AND campaignId != ''`
        ));
        const [localIdResult] = await db.execute(sql.raw(
          `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$'`
        ));
        const [orphanResult] = await db.execute(sql.raw(
          `SELECT COUNT(*) as cnt FROM \`${table}\` t 
           LEFT JOIN campaigns c ON t.campaignId = c.campaignId 
           WHERE t.campaignId IS NOT NULL AND t.campaignId != '' AND c.id IS NULL`
        ));
        
        const total = extractCount(totalResult);
        const localIds = extractCount(localIdResult);
        const orphans = extractCount(orphanResult);
        
        checks[table] = {
          status: 'checked',
          total,
          suspectedLocalIds: localIds,
          orphanedRecords: orphans,
          verdict: localIds === 0 && orphans === 0 ? 'PASS' : (localIds > 0 ? 'FAIL' : 'WARN'),
        };
      } catch (e: any) {
        checks[table] = { status: 'error', message: e.message };
      }
    }
    
    // 检查3: adGroups.campaignId 与 campaigns.campaignId 的JOIN一致性
    try {
      const [joinResult] = await db.execute(sql.raw(
        `SELECT COUNT(*) as cnt FROM ad_groups ag 
         INNER JOIN campaigns c ON ag.campaignId = c.campaignId`
      ));
      const [totalAgResult] = await db.execute(sql.raw(
        `SELECT COUNT(*) as total FROM ad_groups WHERE campaignId IS NOT NULL AND campaignId != ''`
      ));
      const joinCount = extractCount(joinResult);
      const totalAg = extractCount(totalAgResult);
      
      checks.joinIntegrity = {
        status: 'checked',
        adGroupsTotal: totalAg,
        successfulJoins: joinCount,
        orphanedAdGroups: totalAg - joinCount,
        verdict: totalAg === joinCount ? 'PASS' : 'WARN',
        note: 'adGroups.campaignId → campaigns.campaignId (Amazon ID对Amazon ID)',
      };
    } catch (e: any) {
      checks.joinIntegrity = { status: 'error', message: e.message };
    }
    
    // 总体判定
    const allChecks = Object.values(checks);
    const hasFailure = allChecks.some((c: any) => c.verdict === 'FAIL');
    const hasWarning = allChecks.some((c: any) => c.verdict === 'WARN');
    const hasError = allChecks.some((c: any) => c.status === 'error');
    
    res.json({
      overallStatus: hasFailure ? 'FAIL' : hasError ? 'ERROR' : hasWarning ? 'WARN' : 'PASS',
      description: 'ID系统数据完整性检查 — 验证所有表的campaignId是否为Amazon ID格式',
      checks,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 6. GET /api/ops/db-logs — 数据库持久化日志查询
// ============================================================

router.get('/db-logs', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: '数据库不可用' });
      return;
    }
    
    const level = req.query.level as string || '';
    const module = req.query.module as string || '';
    const keyword = req.query.keyword as string || '';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const hours = parseInt(req.query.hours as string) || 24;
    
    let whereClause = `WHERE timestamp >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)`;
    if (level) whereClause += ` AND level = '${level.toUpperCase()}'`;
    if (module) whereClause += ` AND module LIKE '%${module}%'`;
    if (keyword) whereClause += ` AND message LIKE '%${keyword}%'`;
    
    const [rows] = await db.execute(sql.raw(
      `SELECT id, timestamp, level, module, message, metadata 
       FROM system_logs 
       ${whereClause}
       ORDER BY id DESC 
       LIMIT ${limit}`
    ));
    
    // 统计
    const [statsRows] = await db.execute(sql.raw(
      `SELECT level, COUNT(*) as cnt 
       FROM system_logs 
       WHERE timestamp >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
       GROUP BY level`
    ));
    
    res.json({
      query: { level, module, keyword, limit, hours },
      count: Array.isArray(rows) ? rows.length : 0,
      entries: rows,
      stats: statsRows,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    // system_logs表可能不存在
    if (e.message?.includes('ER_NO_SUCH_TABLE') || e.message?.includes("doesn't exist")) {
      res.json({
        query: req.query,
        count: 0,
        entries: [],
        stats: [],
        note: 'system_logs表尚未创建，数据库日志持久化未启用',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// ============================================================
// 7. GET /api/ops/optimization-events — 优化事件查询
// ============================================================

router.get('/optimization-events', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: '数据库不可用' });
      return;
    }
    
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const hours = parseInt(req.query.hours as string) || 24;
    const category = req.query.category as string || '';
    const status = req.query.status as string || '';
    
    let whereClause = `WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)`;
    if (category) whereClause += ` AND event_category = '${category}'`;
    if (status) whereClause += ` AND execution_status = '${status}'`;
    
    const [rows] = await db.execute(sql.raw(
      `SELECT id, event_category, action_type, execution_status, 
              campaign_name, change_reason, algorithm_version,
              old_value, new_value, created_at
       FROM optimization_events 
       ${whereClause}
       ORDER BY id DESC 
       LIMIT ${limit}`
    ));
    
    // 统计
    const [statsRows] = await db.execute(sql.raw(
      `SELECT event_category, execution_status, COUNT(*) as cnt 
       FROM optimization_events 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
       GROUP BY event_category, execution_status`
    ));
    
    res.json({
      query: { limit, hours, category, status },
      count: Array.isArray(rows) ? rows.length : 0,
      entries: rows,
      stats: statsRows,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    if (e.message?.includes("doesn't exist")) {
      res.json({
        count: 0, entries: [], stats: [],
        note: 'optimization_events表不存在',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// ============================================================
// 8. GET /api/ops/id-audit — ID系统审计快照
// ============================================================

router.get('/id-audit', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: '数据库不可用' });
      return;
    }
    
    // 获取campaigns表的ID分布
    const [campaignStats] = await db.execute(sql.raw(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN LENGTH(campaignId) > 8 THEN 1 ELSE 0 END) as amazonIdCount,
        SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) as localIdCount,
        MIN(id) as minLocalId,
        MAX(id) as maxLocalId,
        MIN(LENGTH(campaignId)) as minCampaignIdLen,
        MAX(LENGTH(campaignId)) as maxCampaignIdLen
      FROM campaigns
    `));
    
    // 获取各表的campaignId样本
    const tableSamples: Record<string, any> = {};
    const tables = ['negative_keywords', 'bidding_logs', 'ad_groups'];
    
    for (const table of tables) {
      try {
        const [sample] = await db.execute(sql.raw(`
          SELECT campaignId, LENGTH(campaignId) as idLen, COUNT(*) as cnt
          FROM \`${table}\`
          WHERE campaignId IS NOT NULL AND campaignId != ''
          GROUP BY campaignId
          ORDER BY cnt DESC
          LIMIT 10
        `));
        tableSamples[table] = sample;
      } catch {
        tableSamples[table] = 'table_not_found';
      }
    }
    
    res.json({
      description: 'ID系统审计快照 — campaigns表ID分布 + 各FK表campaignId样本',
      campaignIdDistribution: campaignStats,
      tableSamples,
      rules: {
        'campaigns.id': '本地自增int主键，仅用于本地DB操作',
        'campaigns.campaignId': 'Amazon Campaign ID (varchar)，用于所有FK关联和API调用',
        'adGroups.campaignId': '→ campaigns.campaignId (Amazon ID对Amazon ID)',
        'negativeKeywords.campaignId': '→ campaigns.campaignId (Amazon ID)',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 9. GET /api/ops/logger-stats — Logger系统统计
// ============================================================

router.get('/logger-stats', (req: Request, res: Response) => {
  try {
    const stats = logger.getStats();
    const status = logger.getStatus();
    
    res.json({
      stats,
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 10. GET /api/ops/logger-query — Logger缓冲区查询
// ============================================================

router.get('/logger-query', (req: Request, res: Response) => {
  try {
    const level = req.query.level ? parseInt(req.query.level as string) : undefined;
    const module = req.query.module as string;
    const search = req.query.search as string || req.query.keyword as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    
    const result = logger.query({ level, module, search, limit });
    
    res.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 辅助函数
// ============================================================

function parseOpsQuery(req: Request): OpsQuery {
  return {
    category: req.query.category as OpsCategory | undefined,
    level: req.query.level as any,
    module: req.query.module as string | undefined,
    keyword: req.query.keyword as string || req.query.search as string || undefined,
    since: req.query.since as string | undefined,
    until: req.query.until as string | undefined,
    limit: parseInt(req.query.limit as string) || 50,
    afterSeq: req.query.afterSeq ? parseInt(req.query.afterSeq as string) : undefined,
  };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0) parts.push(`${m}分钟`);
  parts.push(`${s}秒`);
  return parts.join('');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function extractCount(result: any): number {
  if (!result) return 0;
  // Drizzle ORM 返回格式可能是 [{cnt: N}] 或 [[{cnt: N}]] 或 {cnt: N}
  if (Array.isArray(result)) {
    const first = result[0];
    if (first) {
      return first.cnt ?? first.total ?? first.count ?? 0;
    }
    return 0;
  }
  return result.cnt ?? result.total ?? result.count ?? 0;
}

export default router;
