/**
 * 出价日志路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";


// ==================== Bidding Log Router ====================
// v146: biddingLogRouter已完全重定向到统一事件表
export const biddingLogRouter = router({
  list: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().optional().default(100),
      offset: z.number().optional().default(0),
    }))
    .query(async ({ input }) => {
      const result = await db.getOptimizationEvents({
        accountId: input.accountId,
        eventCategory: 'bid_adjustment',
        limit: input.limit,
        offset: input.offset,
      });
      return { logs: result.events, total: result.total };
    }),
  
  listByCampaign: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      limit: z.number().optional().default(100),
    }))
    .query(async ({ input }) => {
      const result = await db.getOptimizationEvents({
        campaignId: input.campaignId,
        eventCategory: 'bid_adjustment',
        limit: input.limit,
      });
      return result.events;
    }),
});
