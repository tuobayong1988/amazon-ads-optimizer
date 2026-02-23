import "dotenv/config";
import express from "express";
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
import { SYSTEM_VERSION } from '../postDeployOptimizer';
import { orchestrateStartup, getSystemInfo, isShuttingDown } from '../deployLifecycleManager';
import { ensureNextGenTables } from '../nextGenMigration';
import { migrateCampaignIdsToAmazonIds } from '../utils/migrateCampaignIds';
import { logger } from '../utils/logger';
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
    }).catch(err => {
      console.error('[AutoMigration] v208 campaignId迁移异常:', err.message);
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
