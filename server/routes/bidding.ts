/**
 * 出价日志路由
 * 从 routers.ts 拆分的独立路由模块
 * 
 * v333: 完善API数据获取
 * - 增加时间范围参数(startDate, endDate)
 * - 增加performanceGroupId过滤参数
 * - 增加apiSyncStatus过滤参数
 * - 提高默认limit到500，最大支持5000
 * - 新增listAll端点用于获取完整日志（自动分页）
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { verifyAccountAccess } from '../utils/accessControl';


// ==================== Bidding Log Router ====================
// v146: biddingLogRouter已完全重定向到统一事件表
// v333: 增强查询能力，支持时间范围、PG过滤和更大的分页
export const biddingLogRouter = router({
  list: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().min(1).max(5000).optional().default(500),  // v333: 提高默认limit到500，最大5000
      offset: z.number().optional().default(0),
      // v333: 新增过滤参数
      startDate: z.string().optional(),  // ISO格式日期字符串，如 '2025-03-01'
      endDate: z.string().optional(),    // ISO格式日期字符串，如 '2025-03-31'
      performanceGroupId: z.number().optional(),  // 按优化目标过滤
      apiSyncStatus: z.enum(['pending', 'synced', 'failed', 'not_applicable']).optional(),  // 按同步状态过滤
      actionType: z.string().optional(),  // 按操作类型过滤
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const result = await db.getOptimizationEvents({
        accountId: input.accountId,
        eventCategory: 'bid_adjustment',
        limit: input.limit,
        offset: input.offset,
        startDate: input.startDate,
        endDate: input.endDate,
        performanceGroupId: input.performanceGroupId,
        // v333: apiSyncStatus和actionType通过status/actionType参数传递
        status: input.apiSyncStatus ? undefined : undefined,  // getOptimizationEvents的status是执行状态
        actionType: input.actionType,
      });
      return { logs: result.events, total: result.total };
    }),
  
  listByCampaign: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      limit: z.number().min(1).max(5000).optional().default(500),  // v333: 提高默认limit
      offset: z.number().optional().default(0),  // v333: 新增offset支持
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }: any) => {
      const result = await db.getOptimizationEvents({
        campaignId: input.campaignId,
        eventCategory: 'bid_adjustment',
        limit: input.limit,
        offset: input.offset,
        startDate: input.startDate,
        endDate: input.endDate,
      });
      return { logs: result.events, total: result.total };
    }),

  // v333: 新增 - 按优化目标获取完整日志（自动分页获取所有记录）
  listByPerformanceGroup: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      limit: z.number().min(1).max(5000).optional().default(500),
      offset: z.number().optional().default(0),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      eventCategory: z.string().optional(),  // 允许查询所有类别的事件
    }))
    .query(async ({ ctx, input }: any) => {
      const result = await db.getOptimizationEvents({
        performanceGroupId: input.performanceGroupId,
        eventCategory: input.eventCategory || undefined,  // 不传则获取所有类别
        limit: input.limit,
        offset: input.offset,
        startDate: input.startDate,
        endDate: input.endDate,
      });
      return { logs: result.events, total: result.total };
    }),

  // v333: 新增 - 获取日志统计概览（按优化目标或账号）
  stats: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      performanceGroupId: z.number().optional(),
      days: z.number().min(1).max(365).optional().default(30),
    }))
    .query(async ({ input, ctx }: any) => {
      if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
      return db.getOptimizationEventStats({
        accountId: input.accountId,
        performanceGroupId: input.performanceGroupId,
        days: input.days,
      });
    }),
});
