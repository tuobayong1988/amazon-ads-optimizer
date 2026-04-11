// Extracted from production dist/index.js
// Original module: server/routes/adGroup.ts
// Lines: 189

var adGroupRouter;
var init_adGroup = __esm({
  "server/routes/adGroup.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_db2();
    init_drizzle_orm();
    adGroupRouter = router({
      // 获取广告活动下的所有广告组
      listByCampaign: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) return [];
        const { verifyAccountAccess: verifyAccountAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAccountAccess2(ctx.user.id, campaign.accountId);
        return getAdGroupsByCampaignId(campaign.campaignId);
      }),
      // v370.4: 数据隔离 - 获取广告组详情
      // @ts-ignore
      get: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyAdGroupAccess: verifyAdGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAdGroupAccess2(ctx.user.id, input.id);
        return getAdGroupById(input.id);
      }),
      // v370.4: 数据隔离 - 获取广告组及其关键词统计
      getWithKeywordStats: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyAdGroupAccess: verifyAdGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAdGroupAccess2(ctx.user.id, input.id);
        const adGroup = await getAdGroupById(input.id);
        if (!adGroup) return null;
        const keywords10 = await getKeywordsByAdGroupId(input.id);
        const productTargets5 = await getProductTargetsByAdGroupId(input.id);
        return {
          ...adGroup,
          keywordCount: keywords10.length,
          productTargetCount: productTargets5.length,
          keywords: keywords10.slice(0, 10),
          // 返回前10个关键词
          productTargets: productTargets5.slice(0, 10)
          // 返回前10个商品定位
        };
      }),
      // v370.4: 数据隔离 - 更新广告组默认出价
      updateDefaultBid: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        defaultBid: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        const { verifyAdGroupAccess: verifyAdGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAdGroupAccess2(ctx.user.id, input.id);
        const adGroup = await getAdGroupById(input.id);
        const previousBid = adGroup?.defaultBid || "0";
        await updateAdGroupDefaultBid(input.id, input.defaultBid);
        const { logAudit: logAudit2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        await logAudit2({
          userId: ctx.user.id,
          userName: ctx.user.name || void 0,
          userEmail: ctx.user.email || void 0,
          actionType: "bid_adjust_single",
          targetType: "ad_group",
          targetId: String(input.id),
          targetName: adGroup?.adGroupName || void 0,
          description: `\u8C03\u6574\u5E7F\u544A\u7EC4\u9ED8\u8BA4\u51FA\u4EF7\u4ECE$${previousBid}\u5230$${input.defaultBid}`,
          previousValue: { defaultBid: previousBid },
          newValue: { defaultBid: input.defaultBid },
          status: "success"
        });
        return { success: true };
      }),
      // v381: 获取广告组所属的广告活动信息（通过adGroupId获取campaign，解决ID类型不匹配问题）
      getCampaign: protectedProcedure.input(external_exports.object({ adGroupId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyAdGroupAccess: verifyAdGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAdGroupAccess2(ctx.user.id, input.adGroupId);
        const adGroup = await getAdGroupById(input.adGroupId);
        if (!adGroup) return null;
        return getCampaignByAmazonCampaignId(adGroup.campaignId);
      }),
      // v420: 获取广告组的搜索词列表（Ad Group级别的Search terms tab）
      // P0修复: searchTerms.internalAdGroupId存储的是内部自增ID，直接用input.adGroupId查询
      getSearchTerms: protectedProcedure.input(external_exports.object({ adGroupId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyAdGroupAccess: verifyAdGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAdGroupAccess2(ctx.user.id, input.adGroupId);
        return getSearchTermsByAdGroupId(input.adGroupId);
      }),
      // v420: 获取广告组的否定定向列表（Ad Group级别的Negative targeting tab）
      // P0修复: negativeKeywords.internalAdGroupId存储的是内部自增ID，直接用input.adGroupId查询
      getNegativeTargeting: protectedProcedure.input(external_exports.object({ adGroupId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyAdGroupAccess: verifyAdGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAdGroupAccess2(ctx.user.id, input.adGroupId);
        return getNegativeKeywordsByAdGroupId(input.adGroupId);
      }),
      // v370.4: 数据隔离 - 更新广告组状态
      updateStatus: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        status: external_exports.enum(["enabled", "paused", "archived"])
      })).mutation(async ({ ctx, input }) => {
        const { verifyAdGroupAccess: verifyAdGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAdGroupAccess2(ctx.user.id, input.id);
        const adGroup = await getAdGroupById(input.id);
        const previousStatus = adGroup?.adGroupStatus || "enabled";
        await updateAdGroupStatus(input.id, input.status);
        const { logAudit: logAudit2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        await logAudit2({
          userId: ctx.user.id,
          userName: ctx.user.name || void 0,
          userEmail: ctx.user.email || void 0,
          actionType: "campaign_pause",
          targetType: "ad_group",
          targetId: String(input.id),
          targetName: adGroup?.adGroupName || void 0,
          description: `\u66F4\u65B0\u5E7F\u544A\u7EC4\u72B6\u6001\u4ECE${previousStatus}\u5230${input.status}`,
          previousValue: { status: previousStatus },
          newValue: { status: input.status },
          status: "success"
        });
        return { success: true };
      }),
      // v381: 获取广告组变更历史（对应Amazon后台的History tab）
      getChangeHistory: protectedProcedure.input(external_exports.object({
        adGroupId: external_exports.number(),
        page: external_exports.number().optional().default(1),
        pageSize: external_exports.number().optional().default(50)
      })).query(async ({ ctx, input }) => {
        try {
          const { verifyAdGroupAccess: verifyAdGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
          await verifyAdGroupAccess2(ctx.user.id, input.adGroupId);
          const adGroup = await getAdGroupById(input.adGroupId);
          if (!adGroup) {
            return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
          }
          const keywords10 = await getKeywordsByAdGroupId(input.adGroupId);
          const keywordIds = keywords10.map((k) => k.id);
          if (keywordIds.length === 0) {
            return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
          }
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
          const { bidAdjustmentHistory: bidAdjustmentHistory3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
          const { inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const dbConn = await getDb3();
          if (!dbConn) {
            return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
          }
          const bidRecords = await dbConn.select().from(bidAdjustmentHistory3).where(inArray13(bidAdjustmentHistory3.keywordId, keywordIds)).orderBy(desc(bidAdjustmentHistory3.appliedAt)).limit(input.pageSize);
          const allRecords = bidRecords.map((record2) => ({
            // @ts-ignore
            id: `bid_${record2.id}`,
            // @ts-ignore
            type: "bid_adjustment",
            // @ts-ignore
            typeLabel: "\u51FA\u4EF7\u8C03\u6574",
            // @ts-ignore
            target: record2.keywordText || `Keyword #${record2.keywordId}`,
            // @ts-ignore
            matchType: record2.matchType,
            // @ts-ignore
            previousValue: `$${record2.previousBid}`,
            // @ts-ignore
            newValue: `$${record2.newBid}`,
            // @ts-ignore
            changePercent: record2.bidChangePercent ? `${record2.bidChangePercent}%` : null,
            // @ts-ignore
            reason: record2.adjustmentReason,
            // @ts-ignore
            source: record2.adjustmentType,
            // @ts-ignore
            status: record2.status,
            // @ts-ignore
            appliedBy: record2.appliedBy,
            // @ts-ignore
            timestamp: record2.appliedAt
          }));
          return {
            records: allRecords,
            total: allRecords.length,
            page: input.page,
            pageSize: input.pageSize
          };
        } catch (error48) {
          console.error("Failed to get ad group change history:", error48);
          return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
        }
      })
    });
  }
});

