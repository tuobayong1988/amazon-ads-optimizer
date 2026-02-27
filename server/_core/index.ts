import "dotenv/config";
import express from "express";
import compression from "compression";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startDataSyncScheduler, startOptimizationScheduler } from "../dataSyncScheduler";
import { runAutoMigration } from "../db";
import { startOptimizationScheduler as startTargetScheduler } from "../optimizationScheduler";
import { startSQSConsumer } from "../sqsConsumerService";
import { reportJobScheduler } from "../services/reportJobScheduler";
import sitemapRouter from "../routes/sitemap";
import opsRouter from "../routes/ops";
import { SYSTEM_VERSION } from '../postDeployOptimizer';
import { orchestrateStartup, getSystemInfo } from '../deployLifecycleManager';
import { isShuttingDown } from '../utils/taskLifecycle';
import { ensureNextGenTables } from '../nextGenMigration';
import { startObservabilityService } from '../observabilityService';
import { runAutoDbMigration } from '../dbAutoMigration';
import { migrateCampaignIdsToAmazonIds } from '../utils/migrateCampaignIds';
import { logger } from '../utils/logger';
import { logSystem, logMigration } from '../utils/opsLogger';
// v224: 加载 AmazonSyncService 的 prototype 扩展子模块
import '../services/sync/init';
import { getDb } from '../db';

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  
  /**
   * v268 性能优化: HTTP响应压缩
   * 
   * 启用gzip/deflate压缩，对所有文本类型响应（JS/CSS/JSON/HTML）进行压缩
   * 预计可将传输体积减少 60-80%，显著提升页面加载速度
   * 
   * 配置说明:
   * - level: 6 (压缩级别，1-9，6为压缩率和速度的最佳平衡点)
   * - threshold: 1024 (只压缩大于1KB的响应，避免小文件压缩开销)
   * - filter: 压缩所有文本类型 + JSON + JavaScript + CSS
   */
  app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      // 对SSE流不压缩
      if (req.headers['accept'] === 'text/event-stream') {
        return false;
      }
      // 使用默认过滤器（压缩text/*, application/json, application/javascript等）
      return compression.filter(req, res);
    },
  }));
  
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // v185: 健康检查端点（供EB负载均衡器使用）
  app.get('/health', (req, res) => {
    const info = getSystemInfo();
    if (info.isShuttingDown) {
      // 关闭中返回503，让LB停止发送新请求
      res.status(503).json({ 
        status: 'shutting_down', 
        version: `v${info.version}`,
        activeTasks: info.activeTasks,
      });
    } else {
      res.status(200).json({ 
        status: 'healthy', 
        version: `v${info.version}`,
        uptime: Math.round(info.uptime),
        activeTasks: info.activeTasks,
      });
    }
  });
  
  // v185: 详细系统状态端点（供运维监控）
  app.get('/api/system/status', (req, res) => {
    const info = getSystemInfo();
    res.json({
      ...info,
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
      pid: process.pid,
    });
  });
  
  // v185: 关闭中间件 — 在关闭过程中拒绝新的API请求
  app.use('/api/trpc', (req, res, next) => {
    if (isShuttingDown()) {
      res.status(503).json({ 
        error: 'Service is shutting down for deployment. Please retry in 30 seconds.',
        retryAfter: 30,
      });
      return;
    }
    next();
  });
  
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // v210: 运维诊断API路由
  app.use("/api/ops", opsRouter);
  // Sitemap routes
  app.use("/api", sitemapRouter);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // In production (Elastic Beanstalk), we must use the PORT environment variable
  // In development, we can try to find an available port
  const preferredPort = parseInt(process.env.PORT || "3000");
  let port = preferredPort;

  if (process.env.NODE_ENV !== "production") {
    port = await findAvailablePort(preferredPort);
    if (port !== preferredPort) {
      console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
    }
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/ (v${SYSTEM_VERSION})`);
    logSystem('Startup', `系统启动完成 v${SYSTEM_VERSION}`, { port, nodeVersion: process.version, pid: process.pid });
    
    // v205: 初始化Logger数据库持久化
    logger.setDbProvider(getDb);
    getDb().then(async (db) => {
      if (db) {
        try {
          await db.execute(`CREATE TABLE IF NOT EXISTS \`system_logs\` (
            \`id\` int NOT NULL AUTO_INCREMENT,
            \`timestamp\` datetime NOT NULL,
            \`level\` varchar(8) NOT NULL,
            \`module\` varchar(128) NOT NULL,
            \`message\` text NOT NULL,
            \`metadata\` text DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            INDEX \`idx_syslog_timestamp\` (\`timestamp\`),
            INDEX \`idx_syslog_level\` (\`level\`),
            INDEX \`idx_syslog_module\` (\`module\`(64)),
            INDEX \`idx_syslog_level_timestamp\` (\`level\`, \`timestamp\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
          console.log('[Logger] system_logs表已就绪');
        } catch (e: any) {
          console.error('[Logger] system_logs表创建失败:', e.message);
        }
      }
    }).catch(() => {});

    // v198: 启动时自动创建NextGen算法所需的数据库表
    ensureNextGenTables().then(result => {
      if (result.success) {
        console.log(`[NextGen] 数据库表检查完成: ${result.tablesCreated} 个表已就绪`);
      } else {
        console.error('[NextGen] 数据库表创建失败:', result.error);
      }
    }).catch(err => {
      console.error('[NextGen] 数据库表检查异常:', err.message);
    });

    // v248: 启动时自动创建v245+所需的数据库表和列
    runAutoDbMigration().then(result => {
      if (result.success) {
        console.log(`[AutoDbMigration] v248数据库迁移完成: ${result.results.join('; ')}`);
      } else {
        console.error('[AutoDbMigration] v248数据库迁移失败:', result.results.join('; '));
      }
    }).catch(err => {
      console.error('[AutoDbMigration] v248迁移异常:', err.message);
    });

    // v146: 启动时自动执行数据迁移（旧表 → optimization_events）
    runAutoMigration().then(result => {
      if (result.success) {
        const total = Object.values(result.migrated).reduce((a, b) => a + b, 0);
        if (total > 0) {
          console.log(`[AutoMigration] v146数据迁移完成: 共迁移 ${total} 条记录`, result.migrated);
        } else {
          console.log('[AutoMigration] v146数据迁移: 无新数据需要迁移', result.skipped);
        }
      } else {
        console.error('[AutoMigration] v146数据迁移失败:', result.skipped);
      }
    }).catch(err => {
      console.error('[AutoMigration] v146迁移异常:', err.message);
    });

    // v208: 启动时自动修复历史数据中的campaignId（本地int → Amazon ID）
    migrateCampaignIdsToAmazonIds().then(() => {
      console.log('[AutoMigration] v208 campaignId标准化迁移完成');
      logMigration('CampaignIdMigration', 'v208 campaignId标准化迁移完成');
    }).catch(err => {
      console.error('[AutoMigration] v208 campaignId迁移异常:', err.message);
      logMigration('CampaignIdMigration', `v208 campaignId迁移异常: ${err.message}`);
    });

    // 启动定时同步调度器（每1小时执行一次）
    startDataSyncScheduler(60 * 60 * 1000);
    console.log('[DataSyncScheduler] 定时同步调度器已启动，间隔: 1小时');
    
    // v143: 启动生命周期感知的智能优化调度器
    startOptimizationScheduler();
    console.log('[OptimizationScheduler] v143生命周期感知智能优化调度器已启动');
    
    // v142: 禁用optimizationScheduler的daily全量执行，避免与dataSyncScheduler重复
    console.log('[TargetScheduler] v142: daily全量执行已禁用，优化调度由dataSyncScheduler统一管理');

    // 启动SQS消费者服务（AMS实时数据流）
    if (process.env.AWS_SQS_QUEUE_TRAFFIC_URL || process.env.AWS_SQS_QUEUE_CONVERSION_URL || process.env.AWS_SQS_QUEUE_BUDGET_URL) {
      startSQSConsumer().then(() => {
        console.log('[SQS Consumer] AMS实时数据流消费者已启动');
      }).catch(err => {
        console.error('[SQS Consumer] 启动失败:', err.message);
      });
    } else {
      console.log('[SQS Consumer] 未配置SQS队列URL，跳过AMS消费者启动');
    }
    
    // v267 P2-3: 启动统一可观测性服务
    startObservabilityService();
    console.log('[Observability] v267: 统一可观测性服务已启动 - 指标收集/告警/健康摘要');

    // 启动异步报告任务调度器
    reportJobScheduler.start();
    console.log('[ReportJobScheduler] 异步报告任务调度器已启动');
    
    // v185: 启动部署生命周期管理器（优雅关闭 + 心跳 + 启动诊断 + 任务恢复 + 纠错 + 重优化）
    // 替代原来的 setTimeout 30秒后运行纠错和重优化的逻辑
    orchestrateStartup(server).catch(err => {
      console.error('[LifecycleManager] 启动协调失败:', err.message);
    });
  });
}

startServer().catch(console.error);
