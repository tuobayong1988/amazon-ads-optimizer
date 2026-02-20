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
import { runAutoCorrection } from "../optimizationAutoCorrector";

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
    console.log(`Server running on http://localhost:${port}/`);
    
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

    // 启动定时同步调度器（每1小时执行一次）
    startDataSyncScheduler(60 * 60 * 1000);
    console.log('[DataSyncScheduler] 定时同步调度器已启动，间隔: 1小时');
    
    // v143: 启动生命周期感知的智能优化调度器
    startOptimizationScheduler();
    console.log('[OptimizationScheduler] v143生命周期感知智能优化调度器已启动');
    
    // v142: 禁用optimizationScheduler的daily全量执行，避免与dataSyncScheduler重复
    // dataSyncScheduler已按模块频率调度（出价每2小时、分时每小时等），
    // optimizationScheduler的daily全量执行会导致重复执行所有模块。
    // 保留optimizationScheduler的triggerInitialOptimization功能（创建优化目标后首次触发）。
    // startTargetScheduler().then(result => {
    //   console.log(`[TargetScheduler] 优化目标调度器已启动: 共${result.total}个活跃目标, 已注册${result.scheduled}个, 失败${result.errors}个`);
    // }).catch(err => {
    //   console.error('[TargetScheduler] 启动失败:', err.message);
    // });
    console.log('[TargetScheduler] v142: daily全量执行已禁用，优化调度由dataSyncScheduler统一管理');
    
    // v167: 系统启动后延迟30秒运行全量纠错扫描（检测并修复过往错误优化）
    setTimeout(async () => {
      try {
        const result = await runAutoCorrection();
        console.log(`[AutoCorrector] v167: 启动纠错扫描完成: 发现${result.totalIssuesFound}个问题, 纠正${result.totalCorrected}个, 失败${result.totalFailed}个`);
      } catch (err: any) {
        console.error('[AutoCorrector] v167: 启动纠错扫描失败:', err.message);
      }
    }, 30 * 1000);
    console.log('[AutoCorrector] v167: 自动纠错服务已注册，将30秒后运行首次全量扫描');

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
  });
}

startServer().catch(console.error);
