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
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      // v383: 强制数据隔离 - 验证campaign归属权
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) return [];
      // v383: 通过campaign的accountId验证用户访问权限
      // @ts-expect-error Async operation type inference
      const { verifyAccountAccess } = await import('../utils/accessControl');
      // @ts-expect-error Express request/response type assertion
      await verifyAccountAccess(ctx.user.id, (campaign as Record<string, unknown>).accountId);
      return db.getAdGroupsByCampaignId(campaign.campaignId);
    }),
  
  // v370.4: 数据隔离 - 获取广告组详情
  // @ts-expect-error Legacy code type compatibility
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.id);
      return db.getAdGroupById(input.id);
    }),
  
  // v370.4: 数据隔离 - 获取广告组及其关键词统计
  getWithKeywordStats: protectedProcedure
    .input(z.object({ id: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
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
      const { logAudit } = await import("../system/auditService");
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
  
  // v381: 获取广告组所属的广告活动信息（通过adGroupId获取campaign，解决ID类型不匹配问题）
  getCampaign: protectedProcedure
    .input(z.object({ adGroupId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.adGroupId);
      
      const adGroup = await db.getAdGroupById(input.adGroupId);
      if (!adGroup) return null;
      
      // adGroup.campaignId是Amazon campaignId (varchar)，用它查找本地campaign记录
      return db.getCampaignByAmazonCampaignId(adGroup.campaignId);
    }),
  
  // v420: 获取广告组的搜索词列表（Ad Group级别的Search terms tab）
  // P0修复: searchTerms.internalAdGroupId存储的是内部自增ID，直接用input.adGroupId查询
  getSearchTerms: protectedProcedure
    .input(z.object({ adGroupId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.adGroupId);
      
      // v420: searchTerms.internalAdGroupId存储的是adGroups.id（内部自增ID）
      // 前端传入的input.adGroupId就是内部自增ID，直接使用即可
      return db.getSearchTermsByAdGroupId(input.adGroupId);
    // @ts-expect-error Legacy code type compatibility
    }),
  
  // v420: 获取广告组的否定定向列表（Ad Group级别的Negative targeting tab）
  // P0修复: negativeKeywords.internalAdGroupId存储的是内部自增ID，直接用input.adGroupId查询
  getNegativeTargeting: protectedProcedure
    .input(z.object({ adGroupId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.adGroupId);
      
      // v420: negativeKeywords.internalAdGroupId存储的是adGroups.id（内部自增ID）
      // 前端传入的input.adGroupId就是内部自增ID，直接使用即可
      return db.getNegativeKeywordsByAdGroupId(input.adGroupId);
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
      const { logAudit } = await import("../system/auditService");
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

  // v381: 获取广告组变更历史（对应Amazon后台的History tab）
  getChangeHistory: protectedProcedure
    .input(z.object({
      adGroupId: z.number(),
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(50),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      try {
        // v383: 强制数据隔离
        const { verifyAdGroupAccess } = await import('../utils/accessControl');
        // @ts-expect-error Express request/response type assertion
        await verifyAdGroupAccess(ctx.user.id, input.adGroupId);
        const adGroup = await db.getAdGroupById(input.adGroupId);
        if (!adGroup) {
          return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
        }
        
        // 获取该广告组下的所有关键词ID
        const keywords = await db.getKeywordsByAdGroupId(input.adGroupId);
        // @ts-expect-error Type inference limitation
        const keywordIds = keywords.map((k: unknown) => k.id);
        
        if (keywordIds.length === 0) {
          return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
        }
        
        // 通过keywordId查询出价调整历史
        const { getDb } = await import('../db/connection');
        const { bidAdjustmentHistory } = await import('../../drizzle/schema');
        const { inArray } = await import('drizzle-orm');
        const dbConn = await getDb();
        
        if (!dbConn) {
          return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
        // @ts-expect-error Legacy code type compatibility
        }
        
        const bidRecords = await dbConn.select()
          // @ts-expect-error DB query type inference limitation
          .from(bidAdjustmentHistory)
          // @ts-expect-error DB query type inference limitation
          .where(inArray(bidAdjustmentHistory.keywordId, keywordIds))
          // @ts-expect-error Amazon API response type flexibility
          .orderBy(desc(bidAdjustmentHistory.appliedAt))
          // @ts-expect-error Legacy code type compatibility
          .limit(input.pageSize);
        
        // @ts-expect-error Amazon API response type flexibility
        const allRecords = bidRecords.map((record: unknown) => ({
          // @ts-expect-error Amazon API response type flexibility
          id: `bid_${record.id}`,
          // @ts-expect-error Amazon API response type flexibility
          type: 'bid_adjustment',
          // @ts-expect-error Legacy code type compatibility
          typeLabel: '出价调整',
          // @ts-expect-error Legacy code type compatibility
          target: record.keywordText || `Keyword #${record.keywordId}`,
          // @ts-expect-error Legacy code type compatibility
          matchType: record.matchType,
          // @ts-expect-error Legacy code type compatibility
          previousValue: `$${record.previousBid}`,
          // @ts-expect-error Legacy code type compatibility
          newValue: `$${record.newBid}`,
          // @ts-expect-error Amazon API response type flexibility
          changePercent: record.bidChangePercent ? `${record.bidChangePercent}%` : null,
          // @ts-expect-error Legacy code type compatibility
          reason: record.adjustmentReason,
          // @ts-expect-error Legacy code type compatibility
          source: record.adjustmentType,
          // @ts-expect-error Legacy code type compatibility
          status: record.status,
          // @ts-expect-error Legacy code type compatibility
          appliedBy: record.appliedBy,
          // @ts-expect-error Legacy code type compatibility
          timestamp: record.appliedAt,
        }));
        
        return {
          records: allRecords,
          total: allRecords.length,
          page: input.page,
          pageSize: input.pageSize,
        };
      } catch (error: unknown) {
        console.error('Failed to get ad group change history:', error);
        return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
      }
    }),
});
