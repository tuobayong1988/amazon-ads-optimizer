/**
 * 数据概览智能建议 tRPC 路由 v502.1
 * 
 * 提供三类建议的扫描查询和一键优化执行接口：
 * 1. scan - 扫描全部三类建议
 * 2. executeEmergencyBleeding - 执行紧急止血
 * 3. executeHighAcosSuppression - 执行高ACOS抑制
 * 4. executeGoalAdjustment - 执行优化目标调整
 */
import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { getDb } from '../db/connection';
import { sql } from 'drizzle-orm';
import {
  scanDashboardRecommendations,
  executeEmergencyBleeding,
  executeHighAcosSuppression,
  executeGoalAdjustment,
} from '../analytics/dashboardRecommendationEngine';
import { verifyAccountAccess } from '../utils/accessControl';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Route_dashboardRecommendation');

export const dashboardRecommendationRouter = router({
  /**
   * 扫描数据概览三类建议
   */
  scan: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return await scanDashboardRecommendations(input.accountId);
    }),

  /**
   * 执行紧急止血 - 添加否定词或降低零转化投放竞价
   */
  executeEmergencyBleeding: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      itemIds: z.array(z.string()),
      items: z.array(z.object({
        id: z.string(),
        entityType: z.enum(['search_term', 'product_target']),
        entityId: z.number(),
        amazonEntityId: z.string(),
        entityText: z.string(),
        campaignId: z.string(),
        campaignName: z.string(),
        campaignDbId: z.number(),
        adGroupId: z.number(),
        adGroupName: z.string(),
        spend: z.number(),
        clicks: z.number(),
        impressions: z.number(),
        orders: z.number(),
        currentBid: z.number(),
        suggestedAction: z.enum(['add_negative_exact', 'reduce_bid_90']),
        actionLabel: z.string(),
      })),
    }))
    .mutation(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      log.info(`[紧急止血] 用户 #${ctx.user.id} 执行 ${input.itemIds.length} 项优化`);
      return await executeEmergencyBleeding(input.accountId, input.itemIds, input.items);
    }),

  /**
   * 执行高ACOS抑制 - 降低高ACOS关键词和商品投放的竞价
   */
  executeHighAcosSuppression: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      itemIds: z.array(z.string()),
      items: z.array(z.object({
        id: z.string(),
        entityType: z.enum(['keyword', 'product_target']),
        entityId: z.number(),
        amazonEntityId: z.string(),
        entityText: z.string(),
        matchType: z.string(),
        campaignId: z.string(),
        campaignName: z.string(),
        campaignDbId: z.number(),
        adGroupId: z.number(),
        adGroupName: z.string(),
        spend: z.number(),
        sales: z.number(),
        orders: z.number(),
        acos: z.number(),
        currentBid: z.number(),
        suggestedBid: z.number(),
        reductionPercent: z.number(),
        suggestedAction: z.enum(['reduce_bid']),
        actionLabel: z.string(),
      })),
    }))
    .mutation(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      log.info(`[高ACOS抑制] 用户 #${ctx.user.id} 执行 ${input.itemIds.length} 项优化`);
      return await executeHighAcosSuppression(input.accountId, input.itemIds, input.items);
    }),

  /**
   * 执行优化目标调整 - 将广告活动分配到绩效组
   */
  executeGoalAdjustment: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignDbIds: z.array(z.number()),
      performanceGroupId: z.number(),
    }))
    .mutation(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      log.info(`[优化目标调整] 用户 #${ctx.user.id} 将 ${input.campaignDbIds.length} 个广告活动分配到绩效组 #${input.performanceGroupId}`);
      return await executeGoalAdjustment(input.accountId, input.campaignDbIds, input.performanceGroupId);
    }),

  /**
   * 临时数据提取端点 - 用于广告投产排查
   */
  adDataExtract: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      queryType: z.enum(['daily_overview', 'by_campaign_type', 'by_campaign', 'by_keyword', 'by_search_term', 'campaign_details']),
      startDate: z.string().default('2026-02-01'),
      endDate: z.string().default('2026-03-24'),
      campaignId: z.string().optional(),
      limit: z.number().default(500),
    }))
    .query(async ({ input }: unknown) => {
      const db_ = await getDb();
      const { accountId, queryType, startDate, endDate, limit } = input;
      try {
        if (queryType === 'daily_overview') {
          // 逐天整体广告表现
          const result = await db_.execute(sql`
            SELECT 
              DATE(date) as report_date,
              SUM(impressions) as impressions,
              SUM(clicks) as clicks,
              SUM(spend) as spend,
              SUM(sales) as sales,
              SUM(orders) as orders,
              CASE WHEN SUM(sales) > 0 THEN ROUND(SUM(spend)/SUM(sales)*100, 2) ELSE NULL END as acos,
              CASE WHEN SUM(clicks) > 0 THEN ROUND(SUM(spend)/SUM(clicks), 2) ELSE NULL END as cpc,
              CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(clicks)/SUM(impressions)*100, 4) ELSE NULL END as ctr,
              CASE WHEN SUM(clicks) > 0 THEN ROUND(SUM(orders)/SUM(clicks)*100, 4) ELSE NULL END as cvr
            FROM daily_performance
            WHERE accountId = ${accountId}
              AND date >= ${startDate}
              AND date < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            GROUP BY DATE(date)
            ORDER BY report_date
          `);
          return { data: (result as unknown[][])[0] };
        }
        if (queryType === 'by_campaign_type') {
          // 按广告类型(SP/SB/SD)逐天分解
          const result = await db_.execute(sql`
            SELECT 
              DATE(dp.date) as report_date,
              COALESCE(dp.ad_type, c.campaignType) as campaign_type,
              SUM(dp.impressions) as impressions,
              SUM(dp.clicks) as clicks,
              SUM(dp.spend) as spend,
              SUM(dp.sales) as sales,
              SUM(dp.orders) as orders,
              CASE WHEN SUM(dp.sales) > 0 THEN ROUND(SUM(dp.spend)/SUM(dp.sales)*100, 2) ELSE NULL END as acos
            FROM daily_performance dp
            LEFT JOIN campaigns c ON dp.campaignId = c.campaignId AND c.accountId = ${accountId}
            WHERE dp.accountId = ${accountId}
              AND dp.date >= ${startDate}
              AND dp.date < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            GROUP BY DATE(dp.date), COALESCE(dp.ad_type, c.campaignType)
            ORDER BY report_date, campaign_type
          `);
          return { data: (result as unknown[][])[0] };
        }
        if (queryType === 'by_campaign') {
          // 按广告活动汇总（整个时间段）
          const result = await db_.execute(sql`
            SELECT 
              dp.campaignId,
              c.name as campaign_name,
              c.campaignType as campaign_type,
              c.campaignStatus as campaign_status,
              c.targetingType as targeting_type,
              SUM(dp.impressions) as impressions,
              SUM(dp.clicks) as clicks,
              SUM(dp.spend) as spend,
              SUM(dp.sales) as sales,
              SUM(dp.orders) as orders,
              CASE WHEN SUM(dp.sales) > 0 THEN ROUND(SUM(dp.spend)/SUM(dp.sales)*100, 2) ELSE NULL END as acos,
              CASE WHEN SUM(dp.clicks) > 0 THEN ROUND(SUM(dp.spend)/SUM(dp.clicks), 2) ELSE NULL END as cpc,
              COUNT(DISTINCT DATE(dp.date)) as active_days
            FROM daily_performance dp
            LEFT JOIN campaigns c ON dp.campaignId = c.campaignId AND c.accountId = ${accountId}
            WHERE dp.accountId = ${accountId}
              AND dp.date >= ${startDate}
              AND dp.date < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            GROUP BY dp.campaignId, c.name, c.campaignType, c.campaignStatus, c.targetingType
            ORDER BY SUM(dp.spend) DESC
            LIMIT ${limit}
          `);
          return { data: (result as unknown[][])[0] };
        }
        if (queryType === 'campaign_details') {
          // 单个广告活动的逐天表现
          const result = await db_.execute(sql`
            SELECT 
              DATE(date) as report_date,
              impressions, clicks, spend, sales, orders,
              CASE WHEN sales > 0 THEN ROUND(spend/sales*100, 2) ELSE NULL END as acos,
              CASE WHEN clicks > 0 THEN ROUND(spend/clicks, 2) ELSE NULL END as cpc
            FROM daily_performance
            WHERE accountId = ${accountId}
              AND campaignId = ${input.campaignId}
              AND date >= ${startDate}
              AND date < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            ORDER BY report_date
          `);
          return { data: (result as unknown[][])[0] };
        }
        if (queryType === 'by_keyword') {
          // 按投放词汇总 - 花费最高的投放词
          const result = await db_.execute(sql`
            SELECT 
              k.id as keyword_id,
              k.keywordId as amazon_keyword_id,
              k.keywordText as keyword_text,
              k.matchType as match_type,
              k.bid as current_bid,
              k.keywordStatus as keyword_status,
              c.name as campaign_name,
              c.campaignType as campaign_type,
              ag.name as ad_group_name,
              COALESCE(perf.total_spend, 0) as total_spend,
              COALESCE(perf.total_sales, 0) as total_sales,
              COALESCE(perf.total_orders, 0) as total_orders,
              COALESCE(perf.total_clicks, 0) as total_clicks,
              COALESCE(perf.total_impressions, 0) as total_impressions,
              CASE WHEN COALESCE(perf.total_sales, 0) > 0 THEN ROUND(perf.total_spend/perf.total_sales*100, 2) ELSE NULL END as acos
            FROM keywords k
            JOIN campaigns c ON k.campaignId = c.campaignId AND c.accountId = ${accountId}
            JOIN ad_groups ag ON k.adGroupId = ag.adGroupId AND ag.accountId = ${accountId}
            LEFT JOIN (
              SELECT 
                keywordId,
                SUM(spend) as total_spend,
                SUM(sales) as total_sales,
                SUM(orders) as total_orders,
                SUM(clicks) as total_clicks,
                SUM(impressions) as total_impressions
              FROM keyword_daily_metrics
              WHERE accountId = ${accountId}
                AND date >= ${startDate}
                AND date < DATE_ADD(${endDate}, INTERVAL 1 DAY)
              GROUP BY keywordId
            ) perf ON k.keywordId = perf.keywordId
            WHERE k.accountId = ${accountId}
            ORDER BY COALESCE(perf.total_spend, 0) DESC
            LIMIT ${limit}
          `);
          return { data: (result as unknown[][])[0] };
        }
        if (queryType === 'by_search_term') {
          // 按搜索词汇总 - 花费最高的搜索词
          const result = await db_.execute(sql`
            SELECT 
              st.searchTerm as search_term,
              st.campaignId,
              c.name as campaign_name,
              c.campaignType as campaign_type,
              SUM(st.impressions) as impressions,
              SUM(st.clicks) as clicks,
              SUM(st.spend) as spend,
              SUM(st.sales) as sales,
              SUM(st.orders) as orders,
              CASE WHEN SUM(st.sales) > 0 THEN ROUND(SUM(st.spend)/SUM(st.sales)*100, 2) ELSE NULL END as acos,
              CASE WHEN SUM(st.clicks) > 0 THEN ROUND(SUM(st.spend)/SUM(st.clicks), 2) ELSE NULL END as cpc
            FROM search_terms st
            LEFT JOIN campaigns c ON st.campaignId = c.campaignId AND c.accountId = ${accountId}
            WHERE st.accountId = ${accountId}
              AND st.date >= ${startDate}
              AND st.date < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            GROUP BY st.searchTerm, st.campaignId, c.name, c.campaignType
            ORDER BY SUM(st.spend) DESC
            LIMIT ${limit}
          `);
          return { data: (result as unknown[][])[0] };
        }
        return { data: [], error: 'Unknown queryType' };
      } catch (e: unknown) {
        return { data: [], error: (e as Error).message };
      }
    }),
});
