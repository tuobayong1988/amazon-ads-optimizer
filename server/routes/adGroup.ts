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
      // v381: 修复ID混淆 — 前端传入本地自增ID，需要先查campaign获取Amazon campaignId
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) return [];
      return db.getAdGroupsByCampaignId(campaign.campaignId);
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
  
  // v381: 获取广告组所属的广告活动信息（通过adGroupId获取campaign，解决ID类型不匹配问题）
  getCampaign: protectedProcedure
    .input(z.object({ adGroupId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.adGroupId);
      
      const adGroup = await db.getAdGroupById(input.adGroupId);
      if (!adGroup) return null;
      
      // adGroup.campaignId是Amazon campaignId (varchar)，用它查找本地campaign记录
      return db.getCampaignByAmazonCampaignId(adGroup.campaignId);
    }),
  
  // v381: 获取广告组的搜索词列表（Ad Group级别的Search terms tab）
  getSearchTerms: protectedProcedure
    .input(z.object({ adGroupId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.adGroupId);
      
      // 获取广告组信息，用其Amazon adGroupId查询搜索词
      const adGroup = await db.getAdGroupById(input.adGroupId);
      if (!adGroup) return [];
      
      // searchTerms表的adGroupId存储的是Amazon adGroupId (varchar)
      return db.getSearchTermsByAdGroupId(adGroup.adGroupId);
    }),
  
  // v381: 获取广告组的否定定向列表（Ad Group级别的Negative targeting tab）
  getNegativeTargeting: protectedProcedure
    .input(z.object({ adGroupId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      const { verifyAdGroupAccess } = await import('../utils/accessControl');
      await verifyAdGroupAccess(ctx.user.id, input.adGroupId);
      
      // 获取广告组信息，用其Amazon adGroupId查询否定词
      const adGroup = await db.getAdGroupById(input.adGroupId);
      if (!adGroup) return [];
      
      // negativeKeywords表的adGroupId存储的是Amazon adGroupId (varchar)
      return db.getNegativeKeywordsByAdGroupId(adGroup.adGroupId);
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

  // v381: 获取广告组变更历史（对应Amazon后台的History tab）
  getChangeHistory: protectedProcedure
    .input(z.object({
      adGroupId: z.number(),
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(50),
    }))
    .query(async ({ ctx, input }: any) => {
      try {
        const adGroup = await db.getAdGroupById(input.adGroupId);
        if (!adGroup) {
          return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
        }
        
        // 获取该广告组下的所有关键词ID
        const keywords = await db.getKeywordsByAdGroupId(input.adGroupId);
        const keywordIds = keywords.map((k: any) => k.id);
        
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
        }
        
        const bidRecords = await dbConn.select()
          .from(bidAdjustmentHistory)
          .where(inArray(bidAdjustmentHistory.keywordId, keywordIds))
          .orderBy(desc(bidAdjustmentHistory.appliedAt))
          .limit(input.pageSize);
        
        const allRecords = bidRecords.map((record: any) => ({
          id: `bid_${record.id}`,
          type: 'bid_adjustment',
          typeLabel: '出价调整',
          target: record.keywordText || `Keyword #${record.keywordId}`,
          matchType: record.matchType,
          previousValue: `$${record.previousBid}`,
          newValue: `$${record.newBid}`,
          changePercent: record.bidChangePercent ? `${record.bidChangePercent}%` : null,
          reason: record.adjustmentReason,
          source: record.adjustmentType,
          status: record.status,
          appliedBy: record.appliedBy,
          timestamp: record.appliedAt,
        }));
        
        return {
          records: allRecords,
          total: allRecords.length,
          page: input.page,
          pageSize: input.pageSize,
        };
      } catch (error: any) {
        console.error('Failed to get ad group change history:', error);
        return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
      }
    }),
});
