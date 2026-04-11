// Extracted from production dist/index.js
// Original module: server/routes/bidding.ts
// Lines: 101

var biddingLogRouter;
var init_bidding = __esm({
  "server/routes/bidding.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_db2();
    init_accessControl();
    biddingLogRouter = router({
      list: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        limit: external_exports.number().min(1).max(5e3).optional().default(500),
        // v333: 提高默认limit到500，最大5000
        offset: external_exports.number().optional().default(0),
        // v333: 新增过滤参数
        startDate: external_exports.string().optional(),
        // ISO格式日期字符串，如 '2025-03-01'
        endDate: external_exports.string().optional(),
        // ISO格式日期字符串，如 '2025-03-31'
        performanceGroupId: external_exports.number().optional(),
        // 按优化目标过滤
        apiSyncStatus: external_exports.enum(["pending", "synced", "failed", "not_applicable"]).optional(),
        // 按同步状态过滤
        actionType: external_exports.string().optional()
        // 按操作类型过滤
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const result = await getOptimizationEvents({
          accountId: input.accountId,
          eventCategory: "bid_adjustment",
          limit: input.limit,
          offset: input.offset,
          startDate: input.startDate,
          endDate: input.endDate,
          performanceGroupId: input.performanceGroupId,
          // fix24 P0-#3: 修复apiSyncStatus过滤Bug，正确传递apiSyncStatus参数
          apiSyncStatus: input.apiSyncStatus,
          actionType: input.actionType
        });
        return { logs: result.events, total: result.total };
      }),
      listByCampaign: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        limit: external_exports.number().min(1).max(5e3).optional().default(500),
        // v333: 提高默认limit
        offset: external_exports.number().optional().default(0),
        // v333: 新增offset支持
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional()
        // @ts-ignore
      })).query(async ({ ctx, input }) => {
        const result = await getOptimizationEvents({
          campaignId: input.campaignId,
          eventCategory: "bid_adjustment",
          limit: input.limit,
          offset: input.offset,
          startDate: input.startDate,
          endDate: input.endDate
        });
        return { logs: result.events, total: result.total };
      }),
      // v333: 新增 - 按优化目标获取完整日志（自动分页获取所有记录）
      listByPerformanceGroup: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        limit: external_exports.number().min(1).max(5e3).optional().default(500),
        offset: external_exports.number().optional().default(0),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        // @ts-ignore
        eventCategory: external_exports.string().optional()
        // 允许查询所有类别的事件
      })).query(async ({ ctx, input }) => {
        const result = await getOptimizationEvents({
          performanceGroupId: input.performanceGroupId,
          eventCategory: input.eventCategory || void 0,
          // 不传则获取所有类别
          limit: input.limit,
          offset: input.offset,
          startDate: input.startDate,
          endDate: input.endDate
        });
        return { logs: result.events, total: result.total };
      }),
      // v333: 新增 - 获取日志统计概览（按优化目标或账号）
      stats: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        // @ts-ignore
        performanceGroupId: external_exports.number().optional(),
        days: external_exports.number().min(1).max(365).optional().default(30)
      })).query(async ({ input, ctx }) => {
        if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
        return getOptimizationEventStats({
          accountId: input.accountId,
          performanceGroupId: input.performanceGroupId,
          days: input.days
        });
      })
    });
  }
});

