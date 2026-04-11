// Extracted from production dist/index.js
// Original module: server/routes/dashboardRecommendation.ts
// Lines: 262

var log198, dashboardRecommendationRouter;
var init_dashboardRecommendation = __esm({
  "server/routes/dashboardRecommendation.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    init_connection();
    init_drizzle_orm();
    init_dashboardRecommendationEngine();
    init_accessControl();
    init_logger();
    log198 = createModuleLogger("Route_dashboardRecommendation");
    dashboardRecommendationRouter = router({
      /**
       * 扫描数据概览三类建议
       */
      scan: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return await scanDashboardRecommendations(input.accountId);
      }),
      /**
       * 执行紧急止血 - 添加否定词或降低零转化投放竞价
       */
      executeEmergencyBleeding: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        itemIds: external_exports.array(external_exports.string()),
        items: external_exports.array(external_exports.object({
          id: external_exports.string(),
          entityType: external_exports.enum(["search_term", "product_target"]),
          entityId: external_exports.number(),
          amazonEntityId: external_exports.string(),
          entityText: external_exports.string(),
          campaignId: external_exports.string(),
          campaignName: external_exports.string(),
          campaignDbId: external_exports.number(),
          adGroupId: external_exports.number(),
          adGroupName: external_exports.string(),
          spend: external_exports.number(),
          clicks: external_exports.number(),
          impressions: external_exports.number(),
          orders: external_exports.number(),
          currentBid: external_exports.number(),
          suggestedAction: external_exports.enum(["add_negative_exact", "reduce_bid_90"]),
          actionLabel: external_exports.string()
        }))
        // @ts-ignore
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        log198.info(`[\u7D27\u6025\u6B62\u8840] \u7528\u6237 #${ctx.user.id} \u6267\u884C ${input.itemIds.length} \u9879\u4F18\u5316`);
        return await executeEmergencyBleeding(input.accountId, input.itemIds, input.items);
      }),
      /**
       * 执行高ACOS抑制 - 降低高ACOS关键词和商品投放的竞价
       */
      executeHighAcosSuppression: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        itemIds: external_exports.array(external_exports.string()),
        items: external_exports.array(external_exports.object({
          id: external_exports.string(),
          entityType: external_exports.enum(["keyword", "product_target"]),
          entityId: external_exports.number(),
          amazonEntityId: external_exports.string(),
          entityText: external_exports.string(),
          matchType: external_exports.string(),
          campaignId: external_exports.string(),
          campaignName: external_exports.string(),
          campaignDbId: external_exports.number(),
          adGroupId: external_exports.number(),
          adGroupName: external_exports.string(),
          spend: external_exports.number(),
          sales: external_exports.number(),
          orders: external_exports.number(),
          acos: external_exports.number(),
          currentBid: external_exports.number(),
          suggestedBid: external_exports.number(),
          reductionPercent: external_exports.number(),
          suggestedAction: external_exports.enum(["reduce_bid"]),
          actionLabel: external_exports.string()
          // @ts-ignore
        }))
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        log198.info(`[\u9AD8ACOS\u6291\u5236] \u7528\u6237 #${ctx.user.id} \u6267\u884C ${input.itemIds.length} \u9879\u4F18\u5316`);
        return await executeHighAcosSuppression(input.accountId, input.itemIds, input.items);
      }),
      /**
       * 执行优化目标调整 - 将广告活动分配到绩效组
       */
      executeGoalAdjustment: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        // @ts-ignore
        campaignDbIds: external_exports.array(external_exports.number()),
        performanceGroupId: external_exports.number()
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        log198.info(`[\u4F18\u5316\u76EE\u6807\u8C03\u6574] \u7528\u6237 #${ctx.user.id} \u5C06 ${input.campaignDbIds.length} \u4E2A\u5E7F\u544A\u6D3B\u52A8\u5206\u914D\u5230\u7EE9\u6548\u7EC4 #${input.performanceGroupId}`);
        return await executeGoalAdjustment(input.accountId, input.campaignDbIds, input.performanceGroupId);
      }),
      /**
       * 临时数据提取端点 - 用于广告投产排查
       */
      adDataExtract: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        queryType: external_exports.enum(["daily_overview", "by_campaign_type", "by_campaign", "by_keyword", "by_search_term", "campaign_details"]),
        startDate: external_exports.string().default("2026-02-01"),
        // @ts-ignore
        endDate: external_exports.string().default("2026-03-24"),
        campaignId: external_exports.string().optional(),
        limit: external_exports.number().default(500)
      })).query(async ({ input }) => {
        const db_ = await getDb();
        const { accountId, queryType, startDate, endDate, limit } = input;
        try {
          if (queryType === "daily_overview") {
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
            return { data: result[0] };
          }
          if (queryType === "by_campaign_type") {
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
            return { data: result[0] };
          }
          if (queryType === "by_campaign") {
            const result = await db_.execute(sql`
 SELECT 
 dp.campaignId,
 c.campaignName as campaign_name,
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
 GROUP BY dp.campaignId, c.campaignName, c.campaignType, c.campaignStatus, c.targetingType
 ORDER BY SUM(dp.spend) DESC
 LIMIT ${limit}
 `);
            return { data: result[0] };
          }
          if (queryType === "campaign_details") {
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
            return { data: result[0] };
          }
          if (queryType === "by_keyword") {
            const result = await db_.execute(sql`
 SELECT 
 k.id as keyword_id,
 k.keywordId as amazon_keyword_id,
 k.keywordText as keyword_text,
 k.matchType as match_type,
 k.bid as current_bid,
 k.keywordStatus as keyword_status,
 c.campaignName as campaign_name,
 c.campaignType as campaign_type,
 k.spend as total_spend,
 k.sales as total_sales,
 k.orders as total_orders,
 k.clicks as total_clicks,
 k.impressions as total_impressions,
 CASE WHEN k.sales > 0 THEN ROUND(k.spend/k.sales*100, 2) ELSE NULL END as acos
 FROM keywords k
 JOIN campaigns c ON k.campaignId = c.campaignId AND c.accountId = ${accountId}
 WHERE k.accountId = ${accountId}
 AND k.keywordStatus != 'amazon_deleted'
 ORDER BY k.spend DESC
 LIMIT ${limit}
 `);
            return { data: result[0] };
          }
          if (queryType === "by_search_term") {
            const result = await db_.execute(sql`
            SELECT 
              st.searchTerm as search_term,
              st.campaignId,
              c.campaignName as campaign_name,
              c.campaignType as campaign_type,
              SUM(st.searchTermImpressions) as impressions,
              SUM(st.searchTermClicks) as clicks,
              SUM(st.searchTermSpend) as spend,
              SUM(st.searchTermSales) as sales,
              SUM(st.searchTermOrders) as orders,
              CASE WHEN SUM(st.searchTermSales) > 0 THEN ROUND(SUM(st.searchTermSpend)/SUM(st.searchTermSales)*100, 2) ELSE NULL END as acos,
              CASE WHEN SUM(st.searchTermClicks) > 0 THEN ROUND(SUM(st.searchTermSpend)/SUM(st.searchTermClicks), 2) ELSE NULL END as cpc
            FROM search_terms st
            LEFT JOIN campaigns c ON st.campaignId = c.campaignId AND c.accountId = ${accountId}
            WHERE st.accountId = ${accountId}
              AND st.reportStartDate >= ${startDate}
              AND st.reportStartDate < DATE_ADD(${endDate}, INTERVAL 1 DAY)
            GROUP BY st.searchTerm, st.campaignId, c.campaignName, c.campaignType
            ORDER BY SUM(st.searchTermSpend) DESC
            LIMIT ${limit}
          `);
            return { data: result[0] };
          }
          return { data: [], error: "Unknown queryType" };
        } catch (e) {
          const errMsg = e.message || String(e);
          const sqlInfo = e.sql || "";
          return { data: [], error: `Failed query: ${sqlInfo}
params: ${accountId},${startDate},${endDate},${limit}` };
        }
      })
    });
  }
});

