/**
 * 广告组管理路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// ==================== Ad Group Router ====================
export const adGroupRouter = router({
  // 获取广告活动下的所有广告组
  listByCampaign: protectedProcedure
    .input(z.object({ 
      campaignId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }: any) => {
      return db.getAdGroupsByCampaignId(input.campaignId);
    }),
  
  // v370.4: 数据隔离 - 获取广告组详情
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }: any) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.id);
      return db.getAdGroupById(input.id);
    }),
  
  // v370.4: 数据隔离 - 获取广告组及其关键词统计
  getWithKeywordStats: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }: any) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.id);
      const adGroup = await db.getAdGroupById(input.id);
      if (!adGroup) return null;
      
      const keywords = await db.getKeywordsByAdGroupId(input.id);
      const productTargets = await db.getProductTargetsByAdGroupId(input.id);
      
      return {
        ...adGroup,
        keywordCount: keywords.length,
        productTargetCount: productTargets.length,
        keywords: keywords.slice(0, 10), // 返回前10个关键词
        productTargets: productTargets.slice(0, 10), // 返回前10个商品定位
      };
    }),
  
  // v370.4: 数据隔离 - 更新广告组默认出价
  updateDefaultBid: protectedProcedure
    .input(z.object({
      id: z.number(),
      defaultBid: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.id);
      const adGroup = await db.getAdGroupById(input.id);
      const previousBid = adGroup?.defaultBid || '0';
      
      await db.updateAdGroupDefaultBid(input.id, input.defaultBid);
      
      // 记录审计日志
      const { logAudit } = await import("../auditService");
      await logAudit({
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        userEmail: ctx.user.email || undefined,
        actionType: 'bid_adjust_single',
        targetType: 'ad_group',
        targetId: String(input.id),
        targetName: adGroup?.adGroupName || undefined,
        description: `调整广告组默认出价从$${previousBid}到$${input.defaultBid}`,
        previousValue: { defaultBid: previousBid },
        newValue: { defaultBid: input.defaultBid },
        status: 'success',
      });
      
      return { success: true };
    }),
  
  // v370.4: 数据隔离 - 更新广告组状态
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(['enabled', 'paused', 'archived']),
    }))
    .mutation(async ({ ctx, input }) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.id);
      const adGroup = await db.getAdGroupById(input.id);
      const previousStatus = adGroup?.adGroupStatus || 'enabled';
      
      await db.updateAdGroupStatus(input.id, input.status);
      
      // 记录审计日志
      const { logAudit } = await import("../auditService");
      await logAudit({
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        userEmail: ctx.user.email || undefined,
        actionType: 'campaign_pause',
        targetType: 'ad_group',
        targetId: String(input.id),
        targetName: adGroup?.adGroupName || undefined,
        description: `更新广告组状态从${previousStatus}到${input.status}`,
        previousValue: { status: previousStatus },
        newValue: { status: input.status },
        status: 'success',
      });
      
      return { success: true };
    }),
});
