// Extracted from production dist/index.js
// Original module: server/routes/systemLog.ts
// Lines: 100

var systemLogRouter;
var init_systemLog = __esm({
  "server/routes/systemLog.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_db2();
    init_logger();
    systemLogRouter = router({
      // v371: 系统日志仅管理员可访问，防止普通用户查看服务器内部日志
      // 查询内存缓冲区日志（实时，最近5000条）
      query: adminProcedure.input(external_exports.object({
        level: external_exports.number().min(0).max(4).optional(),
        module: external_exports.string().optional(),
        search: external_exports.string().optional(),
        startTime: external_exports.string().optional(),
        endTime: external_exports.string().optional(),
        limit: external_exports.number().min(1).max(100).optional().default(50),
        cursor: external_exports.number().optional(),
        direction: external_exports.enum(["newer", "older"]).optional().default("older")
      })).query(async ({ ctx, input }) => {
        return logger.query(input);
      }),
      // 获取最新N条日志
      getLatest: adminProcedure.input(external_exports.object({ limit: external_exports.number().min(1).max(100).optional().default(50) })).query(async ({ ctx, input }) => {
        return logger.getLatest(input.limit);
      }),
      // 获取错误和警告日志
      // @ts-ignore
      getAlerts: adminProcedure.input(external_exports.object({ limit: external_exports.number().min(1).max(100).optional().default(50) })).query(async ({ ctx, input }) => {
        return logger.getAlerts(input.limit);
      }),
      // 获取特定模块的日志
      getModuleLogs: adminProcedure.input(external_exports.object({
        // @ts-ignore
        module: external_exports.string(),
        limit: external_exports.number().min(1).max(100).optional().default(50)
      })).query(async ({ ctx, input }) => {
        return logger.getModuleLogs(input.module, input.limit);
      }),
      // 获取日志统计信息
      getStats: adminProcedure.query(async () => {
        return logger.getStats();
      }),
      // 获取日志系统运行状态
      getStatus: adminProcedure.query(async () => {
        return logger.getStatus();
      }),
      // 查询数据库持久化日志（历史，WARN及以上）
      queryPersisted: adminProcedure.input(external_exports.object({
        level: external_exports.string().optional(),
        module: external_exports.string().optional(),
        search: external_exports.string().optional(),
        startTime: external_exports.string().optional(),
        // @ts-ignore
        endTime: external_exports.string().optional(),
        limit: external_exports.number().min(1).max(100).optional().default(50),
        offset: external_exports.number().min(0).optional().default(0)
      })).query(async ({ ctx, input }) => {
        const dbInstance = await getDb();
        if (!dbInstance) return { logs: [], total: 0 };
        try {
          const conditions = [];
          if (input.level) conditions.push(`level = '${input.level}'`);
          if (input.module) conditions.push(`module LIKE '%${input.module.replace(/'/g, "''")}%'`);
          if (input.search) conditions.push(`message LIKE '%${input.search.replace(/'/g, "''")}%'`);
          if (input.startTime) conditions.push(`timestamp >= '${input.startTime}'`);
          if (input.endTime) conditions.push(`timestamp <= '${input.endTime}'`);
          const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
          const [rows] = await dbInstance.execute();
          const [countResult] = await dbInstance.execute(
            `SELECT COUNT(*) as total FROM system_logs ${whereClause}`
          );
          return {
            logs: rows || [],
            total: countResult?.[0]?.total || 0
          };
        } catch (err) {
          if (err?.code === "ER_NO_SUCH_TABLE") {
            return { logs: [], total: 0, message: "system_logs\u8868\u5C1A\u672A\u521B\u5EFA\uFF0C\u5C06\u5728\u4E0B\u6B21\u90E8\u7F72\u8FC1\u79FB\u65F6\u81EA\u52A8\u521B\u5EFA" };
          }
          throw err;
        }
      }),
      // 更新日志级别（运行时动态调整）
      // @ts-ignore
      updateLevel: adminProcedure.input(external_exports.object({
        consoleLevel: external_exports.number().min(0).max(4).optional(),
        dbLevel: external_exports.number().min(0).max(4).optional()
      })).mutation(async ({ ctx, input }) => {
        const updates = {};
        if (input.consoleLevel !== void 0) updates.consoleLevel = input.consoleLevel;
        if (input.dbLevel !== void 0) updates.dbLevel = input.dbLevel;
        logger.updateConfig(updates);
        return { success: true, message: "\u65E5\u5FD7\u7EA7\u522B\u5DF2\u66F4\u65B0", updates };
      })
    });
  }
});

