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

// 告警阈值配置
// v222: V8引擎会动态收缩heapTotal，导致heapUsed/heapTotal比率常态在80-95%
// 因此提高百分比阈值，并新增绝对值阈值作为更可靠的内存监控指标
const ALERT_THRESHOLDS = {
  memory: {
    rssWarningMB: 500,       // RSS内存警告阈值（MB）- 2048MB堆下适当提高
    rssCriticalMB: 800,      // RSS内存严重阈值（MB）
    heapWarningPct: 90,      // 堆内存使用率警告阈值（%）- V8常态80-90%是正常的
    heapCriticalPct: 96,     // 堆内存使用率严重阈值（%）- 只有接近OOM才告警
    heapUsedWarningMB: 512,  // 堆内存绝对值警告阈值（MB）
    heapUsedCriticalMB: 1024, // 堆内存绝对值严重阈值（MB）
  },
  database: {
    latencyWarningMs: 500,   // DB延迟警告阈值（ms）
    latencyCriticalMs: 2000, // DB延迟严重阈值（ms）
  },
  logger: {
    errorRateWarning: 50,    // v222: 错误日志数量警告阈值（近期）
    errorRateCritical: 200,  // v222: 错误日志数量严重阈值（近期）
    bufferUsagePct: 80,      // 日志缓冲区使用率警告阈值（%）
  },
  uptime: {
    recentRestartSec: 300,   // 最近重启判定阈值（5分钟内）
  },
};

type AlertLevel = 'ok' | 'warning' | 'critical';

interface AlertItem {
  metric: string;
  level: AlertLevel;
  message: string;
  value: number | string;
  threshold: number | string;
}

function evaluateAlerts(
  memUsage: NodeJS.MemoryUsage,
  dbStatus: string,
  dbLatencyMs: number,
  loggerStatus: any,
  opsSummary: any,
  uptimeSec: number,
): { overallLevel: AlertLevel; alerts: AlertItem[] } {
  const alerts: AlertItem[] = [];
  
  // 1. 内存检查 — RSS
  const rssMB = memUsage.rss / (1024 * 1024);
  if (rssMB >= ALERT_THRESHOLDS.memory.rssCriticalMB) {
    alerts.push({
      metric: 'memory.rss', level: 'critical',
      message: `RSS内存 ${rssMB.toFixed(0)}MB 超过严重阈值 ${ALERT_THRESHOLDS.memory.rssCriticalMB}MB`,
      value: `${rssMB.toFixed(0)}MB`, threshold: `${ALERT_THRESHOLDS.memory.rssCriticalMB}MB`,
    });
  } else if (rssMB >= ALERT_THRESHOLDS.memory.rssWarningMB) {
    alerts.push({
      metric: 'memory.rss', level: 'warning',
      message: `RSS内存 ${rssMB.toFixed(0)}MB 超过警告阈值 ${ALERT_THRESHOLDS.memory.rssWarningMB}MB`,
      value: `${rssMB.toFixed(0)}MB`, threshold: `${ALERT_THRESHOLDS.memory.rssWarningMB}MB`,
    });
  }
  
  // 2. 内存检查 — 堆使用率（百分比）
  // v222: V8会动态收缩heapTotal，导致heapUsed/heapTotal常态在80-97%
  // 只有当heapUsed绝对值也超过安全线时，百分比告警才有意义
  const heapPct = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  const heapUsedMB = memUsage.heapUsed / (1024 * 1024);
  const heapAbsoluteSafe = heapUsedMB < ALERT_THRESHOLDS.memory.heapUsedWarningMB; // 绝对值在安全范围内
  
  if (!heapAbsoluteSafe && heapPct >= ALERT_THRESHOLDS.memory.heapCriticalPct) {
    alerts.push({
      metric: 'memory.heapUsage', level: 'critical',
      message: `堆内存使用率 ${heapPct.toFixed(1)}% 超过严重阈值 ${ALERT_THRESHOLDS.memory.heapCriticalPct}% (绝对值: ${heapUsedMB.toFixed(0)}MB)`,
      value: `${heapPct.toFixed(1)}%`, threshold: `${ALERT_THRESHOLDS.memory.heapCriticalPct}%`,
    });
  } else if (!heapAbsoluteSafe && heapPct >= ALERT_THRESHOLDS.memory.heapWarningPct) {
    alerts.push({
      metric: 'memory.heapUsage', level: 'warning',
      message: `堆内存使用率 ${heapPct.toFixed(1)}% 超过警告阈值 ${ALERT_THRESHOLDS.memory.heapWarningPct}% (绝对值: ${heapUsedMB.toFixed(0)}MB)`,
      value: `${heapPct.toFixed(1)}%`, threshold: `${ALERT_THRESHOLDS.memory.heapWarningPct}%`,
    });
  }
  
  // 2b. v222: 内存检查 — 堆使用绝对值（更可靠的指标）
  // heapUsedMB 已在上方计算
  if (heapUsedMB >= ALERT_THRESHOLDS.memory.heapUsedCriticalMB) {
    alerts.push({
      metric: 'memory.heapUsedAbsolute', level: 'critical',
      message: `堆内存使用 ${heapUsedMB.toFixed(0)}MB 超过严重阈值 ${ALERT_THRESHOLDS.memory.heapUsedCriticalMB}MB`,
      value: `${heapUsedMB.toFixed(0)}MB`, threshold: `${ALERT_THRESHOLDS.memory.heapUsedCriticalMB}MB`,
    });
  } else if (heapUsedMB >= ALERT_THRESHOLDS.memory.heapUsedWarningMB) {
    alerts.push({
      metric: 'memory.heapUsedAbsolute', level: 'warning',
      message: `堆内存使用 ${heapUsedMB.toFixed(0)}MB 超过警告阈值 ${ALERT_THRESHOLDS.memory.heapUsedWarningMB}MB`,
      value: `${heapUsedMB.toFixed(0)}MB`, threshold: `${ALERT_THRESHOLDS.memory.heapUsedWarningMB}MB`,
    });
  }
  
  // 3. 数据库检查
  if (dbStatus.startsWith('error')) {
    alerts.push({
      metric: 'database.connection', level: 'critical',
      message: `数据库连接异常: ${dbStatus}`,
      value: dbStatus, threshold: 'connected',
    });
  } else if (dbLatencyMs >= ALERT_THRESHOLDS.database.latencyCriticalMs) {
    alerts.push({
      metric: 'database.latency', level: 'critical',
      message: `数据库延迟 ${dbLatencyMs}ms 超过严重阈值 ${ALERT_THRESHOLDS.database.latencyCriticalMs}ms`,
      value: dbLatencyMs, threshold: ALERT_THRESHOLDS.database.latencyCriticalMs,
    });
  } else if (dbLatencyMs >= ALERT_THRESHOLDS.database.latencyWarningMs) {
    alerts.push({
      metric: 'database.latency', level: 'warning',
      message: `数据库延迟 ${dbLatencyMs}ms 超过警告阈值 ${ALERT_THRESHOLDS.database.latencyWarningMs}ms`,
      value: dbLatencyMs, threshold: ALERT_THRESHOLDS.database.latencyWarningMs,
    });
  }
  
  // 4. 错误率检查
  const errorCount = opsSummary?.levelCounts?.error || 0;
  if (errorCount >= ALERT_THRESHOLDS.logger.errorRateCritical) {
    alerts.push({
      metric: 'logger.errorCount', level: 'critical',
      message: `累计错误日志 ${errorCount} 条超过严重阈值 ${ALERT_THRESHOLDS.logger.errorRateCritical}`,
      value: errorCount, threshold: ALERT_THRESHOLDS.logger.errorRateCritical,
    });
  } else if (errorCount >= ALERT_THRESHOLDS.logger.errorRateWarning) {
    alerts.push({
      metric: 'logger.errorCount', level: 'warning',
      message: `累计错误日志 ${errorCount} 条超过警告阈值 ${ALERT_THRESHOLDS.logger.errorRateWarning}`,
      value: errorCount, threshold: ALERT_THRESHOLDS.logger.errorRateWarning,
    });
  }
  
  // 5. 日志缓冲区使用率
  if (loggerStatus.bufferCapacity > 0) {
    const bufPct = (loggerStatus.bufferSize / loggerStatus.bufferCapacity) * 100;
    if (bufPct >= ALERT_THRESHOLDS.logger.bufferUsagePct) {
      alerts.push({
        metric: 'logger.bufferUsage', level: 'warning',
        message: `日志缓冲区使用率 ${bufPct.toFixed(1)}% 超过阈值 ${ALERT_THRESHOLDS.logger.bufferUsagePct}%`,
        value: `${bufPct.toFixed(1)}%`, threshold: `${ALERT_THRESHOLDS.logger.bufferUsagePct}%`,
      });
    }
  }
  
  // 6. 最近重启检查
  if (uptimeSec < ALERT_THRESHOLDS.uptime.recentRestartSec) {
    alerts.push({
      metric: 'system.uptime', level: 'warning',
      message: `系统在 ${Math.round(uptimeSec)} 秒前刚重启，可能存在异常重启`,
      value: `${Math.round(uptimeSec)}s`, threshold: `${ALERT_THRESHOLDS.uptime.recentRestartSec}s`,
    });
  }
  
  // 总体判定
  const hasCritical = alerts.some(a => a.level === 'critical');
  const hasWarning = alerts.some(a => a.level === 'warning');
  const overallLevel: AlertLevel = hasCritical ? 'critical' : hasWarning ? 'warning' : 'ok';
  
  return { overallLevel, alerts };
}

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
    const opsSummary = opsCollector.getSummary();
    
    // v211: 告警阈值评估
    const alertResult = evaluateAlerts(
      memUsage, dbStatus, dbLatencyMs, loggerStatus, opsSummary, sysInfo.uptime
    );
    
    res.json({
      // v211: 告警系统
      health: {
        level: alertResult.overallLevel,
        alertCount: alertResult.alerts.length,
        alerts: alertResult.alerts,
        thresholds: ALERT_THRESHOLDS,
      },
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
        heapUsagePct: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1) + '%',
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
      opsLogger: opsSummary,
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
    // execution_status列可能不存在，使用event_category过滤即可
    
    const [rows] = await db.execute(sql.raw(
      `SELECT id, event_category, action_type, 
              campaign_name, change_reason, algorithm_version,
              previous_value, new_value, created_at
       FROM optimization_events 
       ${whereClause}
       ORDER BY id DESC 
       LIMIT ${limit}`
    ));
    
    // 统计
    const [statsRows] = await db.execute(sql.raw(
      `SELECT event_category, COUNT(*) as cnt 
       FROM optimization_events 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
       GROUP BY event_category`
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
// 11. GET /api/ops/sync-health — 同步健康状态
// ============================================================

router.get('/sync-health', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    // 获取各账户最近的同步记录
    const recentSyncs = await db.execute(sql.raw(`
      SELECT 
        sl.accountId,
        sl.syncType,
        sl.status,
        sl.startedAt,
        sl.completedAt,
        sl.recordsSynced,
        sl.errorMessage,
        sl.current_step as currentStep,
        sl.progress_percent as progressPercent,
        sl.sp_campaigns_synced as spCampaigns,
        sl.sb_campaigns_synced as sbCampaigns,
        sl.sd_campaigns_synced as sdCampaigns,
        sl.duration_ms as durationMs,
        TIMESTAMPDIFF(SECOND, sl.startedAt, COALESCE(sl.completedAt, NOW())) as durationSec
      FROM data_sync_jobs sl
      INNER JOIN (
        SELECT accountId, MAX(startedAt) as maxStart
        FROM data_sync_jobs
        GROUP BY accountId
      ) latest ON sl.accountId = latest.accountId 
        AND sl.startedAt = latest.maxStart
      ORDER BY sl.startedAt DESC
      LIMIT 50
    `));

    // 获取过去24小时的同步统计
    const syncStats24h = await db.execute(sql.raw(`
      SELECT 
        status,
        COUNT(*) as count,
        AVG(TIMESTAMPDIFF(SECOND, startedAt, COALESCE(completedAt, NOW()))) as avgDurationSec
      FROM data_sync_jobs
      WHERE startedAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY status
    `));

    // 获取数据新鲜度（各表最新更新时间）
    const freshness: Record<string, string> = {};
    const tables = ['campaigns', 'ad_groups', 'keywords', 'negative_keywords'];
    for (const table of tables) {
      try {
        const result = await db.execute(sql.raw(
          `SELECT MAX(updatedAt) as lastUpdate FROM \`${table}\``
        ));
        const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
        freshness[table] = rows[0]?.lastUpdate || 'no_data';
      } catch {
        freshness[table] = 'table_error';
      }
    }

    res.json({
      description: '同步健康状态 — 最近同步记录、24h统计、数据新鲜度',
      recentSyncs: Array.isArray(recentSyncs) ? (Array.isArray(recentSyncs[0]) ? recentSyncs[0] : recentSyncs) : [],
      stats24h: Array.isArray(syncStats24h) ? (Array.isArray(syncStats24h[0]) ? syncStats24h[0] : syncStats24h) : [],
      dataFreshness: freshness,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 12. GET /api/ops/sync-diagnosis — 同步诊断
// ============================================================

router.get('/sync-diagnosis', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    // 获取各账户的数据完整性概览
    const accountOverview = await db.execute(sql.raw(`
      SELECT 
        a.id as accountId,
        a.accountName,
        a.marketplace,
        a.status,
        (SELECT COUNT(*) FROM campaigns c WHERE c.accountId = a.id) as campaignCount,
        (SELECT COUNT(*) FROM ad_groups ag WHERE ag.accountId = a.id) as adGroupCount,
        (SELECT COUNT(*) FROM keywords k WHERE k.accountId = a.id) as keywordCount,
        (SELECT COUNT(*) FROM negative_keywords nk WHERE nk.accountId = a.id) as negKeywordCount,
        (SELECT COALESCE(SUM(spend), 0) FROM campaigns c WHERE c.accountId = a.id) as totalSpend
      FROM ad_accounts a
      WHERE a.status = 'active'
    `));

    // 获取最近的同步错误
    const recentErrors = await db.execute(sql.raw(`
      SELECT 
        accountId, syncType, status, errorMessage, startedAt
      FROM data_sync_jobs
      WHERE status = 'failed' AND startedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY startedAt DESC
      LIMIT 20
    `));

    // 获取同步日志中的ops记录
    const opsLogs = opsCollector.query({
      category: 'sync' as OpsCategory,
      limit: 30,
    });

    res.json({
      description: '同步诊断 — 账户数据概览、最近错误、同步日志',
      accountOverview: Array.isArray(accountOverview) ? (Array.isArray(accountOverview[0]) ? accountOverview[0] : accountOverview) : [],
      recentErrors: Array.isArray(recentErrors) ? (Array.isArray(recentErrors[0]) ? recentErrors[0] : recentErrors) : [],
      opsLogs: opsLogs,
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
