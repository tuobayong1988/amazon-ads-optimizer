// Extracted from production dist/index.js
// Original module: server/routes/keyword.ts
// Lines: 510

var log160, keywordRouter, productTargetRouter;
var init_keyword = __esm({
  "server/routes/keyword.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_helpers();
    init_db2();
    init_bidOptimizer();
    init_logger();
    log160 = createModuleLogger("Route_keyword");
    keywordRouter = router({
      list: protectedProcedure.input(external_exports.object({ adGroupId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyAdGroupAccess: verifyAdGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAdGroupAccess2(ctx.user.id, input.adGroupId);
        return getKeywordsByAdGroupId(input.adGroupId);
      }),
      // v370.4: 数据隔离 - 验证keyword归属
      get: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyKeywordAccess: verifyKeywordAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyKeywordAccess2(ctx.user.id, input.id);
        return getKeywordById(input.id);
      }),
      // v370.4: 数据隔离 - 验证keyword归属
      updateBid: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        bid: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        const { verifyKeywordAccess: verifyKeywordAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyKeywordAccess2(ctx.user.id, input.id);
        const keyword = await getKeywordById(input.id);
        const previousBid = keyword?.bid || "0";
        await updateKeywordBid(input.id, input.bid);
        const { logAudit: logAudit2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        await logAudit2({
          userId: ctx.user.id,
          userName: ctx.user.name || void 0,
          userEmail: ctx.user.email || void 0,
          actionType: "bid_adjust_single",
          targetType: "keyword",
          targetId: String(input.id),
          targetName: keyword?.keywordText || keyword?.keywordId || void 0,
          description: `\u8C03\u6574\u5173\u952E\u8BCD\u51FA\u4EF7\u4ECE$${previousBid}\u5230$${input.bid}`,
          previousValue: { bid: previousBid },
          newValue: { bid: input.bid },
          status: "success"
        });
        return { success: true };
      }),
      update: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        bid: external_exports.string().optional(),
        // @ts-ignore
        status: external_exports.enum(["enabled", "paused", "archived"]).optional()
      })).mutation(async ({ ctx, input }) => {
        const { verifyKeywordAccess: verifyKeywordAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyKeywordAccess2(ctx.user.id, input.id);
        const { id, ...data } = input;
        await updateKeyword(id, data);
        return { success: true };
      }),
      // 批量更新出价
      batchUpdateBid: protectedProcedure.input(external_exports.object({
        ids: external_exports.array(external_exports.number()),
        bidType: external_exports.enum(["fixed", "increase_percent", "decrease_percent", "cpc_multiplier", "cpc_increase_percent", "cpc_decrease_percent"]),
        bidValue: external_exports.number()
        // @ts-ignore
      })).mutation(async ({ ctx, input }) => {
        const { verifyBatchKeywordAccess: verifyBatchKeywordAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyBatchKeywordAccess2(ctx.user.id, input.ids);
        const allKeywords = await getKeywordsByIds(input.ids);
        const keywordMap = new Map(allKeywords.map((k) => [k.id, k]));
        const results = [];
        for (const id of input.ids) {
          const keyword = keywordMap.get(id);
          if (!keyword) continue;
          let newBid;
          const currentBid = parseFloat(keyword.bid);
          const spend = parseFloat(keyword.spend || "0");
          const clicks = keyword.clicks || 0;
          const cpc = clicks > 0 ? spend / clicks : currentBid;
          if (input.bidType === "fixed") {
            newBid = input.bidValue;
          } else if (input.bidType === "increase_percent") {
            newBid = currentBid * (1 + input.bidValue / 100);
          } else if (input.bidType === "decrease_percent") {
            newBid = currentBid * (1 - input.bidValue / 100);
          } else if (input.bidType === "cpc_multiplier") {
            newBid = cpc * input.bidValue;
          } else if (input.bidType === "cpc_increase_percent") {
            newBid = cpc * (1 + input.bidValue / 100);
          } else {
            newBid = cpc * (1 - input.bidValue / 100);
          }
          newBid = Math.max(0.02, Math.round(newBid * 100) / 100);
          await updateKeywordBid(id, newBid.toFixed(2));
          results.push({ id, oldBid: currentBid, newBid, cpc });
        }
        if (results.length > 0) {
          const { logAudit: logAudit2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
          const bidTypeDesc = {
            fixed: `\u56FA\u5B9A\u51FA\u4EF7$${input.bidValue}`,
            increase_percent: `\u63D0\u9AD8${input.bidValue}%`,
            decrease_percent: `\u964D\u4F4E${input.bidValue}%`,
            cpc_multiplier: `CPC\u7684${input.bidValue}\u500D`,
            cpc_increase_percent: `CPC\u63D0\u9AD8${input.bidValue}%`,
            cpc_decrease_percent: `CPC\u964D\u4F4E${input.bidValue}%`
          };
          await logAudit2({
            userId: ctx.user.id,
            userName: ctx.user.name || void 0,
            userEmail: ctx.user.email || void 0,
            actionType: "bid_adjust_batch",
            targetType: "keyword",
            description: `\u6279\u91CF\u8C03\u6574${results.length}\u4E2A\u5173\u952E\u8BCD\u51FA\u4EF7\uFF08${bidTypeDesc[input.bidType]}\uFF09`,
            metadata: { bidType: input.bidType, bidValue: input.bidValue, count: results.length },
            previousValue: results.map((r) => ({ id: r.id, bid: r.oldBid })),
            newValue: results.map((r) => ({ id: r.id, bid: r.newBid })),
            status: "success"
          });
        }
        if (results.length > 0) {
          try {
            const dbInstance = await getDb();
            if (dbInstance) {
              const { keywords: keywordsTable, adGroups: adGroups6, campaigns: campaigns6 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
              const { eq: eq12, inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
              const kwDetails = await dbInstance.select({
                kwId: keywordsTable.id,
                adGroupId: keywordsTable.internalAdGroupId,
                campaignId: adGroups6.campaignId,
                // @ts-ignore
                accountId: campaigns6.accountId
              }).from(keywordsTable).innerJoin(adGroups6, eq12(keywordsTable.internalAdGroupId, adGroups6.id)).innerJoin(campaigns6, eq12(adGroups6.campaignId, campaigns6.campaignId)).where(inArray13(keywordsTable.id, results.map((r) => r.id)));
              const byAccount = /* @__PURE__ */ new Map();
              for (const kw of kwDetails) {
                const r = results.find((r2) => r2.id === kw.kwId);
                if (!r) continue;
                if (!byAccount.has(kw.accountId)) byAccount.set(kw.accountId, []);
                byAccount.get(kw.accountId).push({ keywordId: kw.kwId, newBid: r.newBid, campaignId: kw.campaignId });
              }
              const { syncBidAdjustmentsToAmazon: syncBidAdjustmentsToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
              for (const [accountId, kws] of byAccount) {
                const adjustments = kws.map((kw) => ({
                  keywordId: kw.keywordId,
                  newBid: kw.newBid,
                  campaignId: kw.campaignId,
                  reason: `\u7528\u6237\u624B\u52A8\u6279\u91CF\u8C03\u6574\u5173\u952E\u8BCD\u51FA\u4EF7`
                }));
                const syncResult = await syncBidAdjustmentsToAmazon2(accountId, adjustments);
                log160.info(`[Keyword.batchUpdateBid] v159: accountId=${accountId}, \u540C\u6B65\u7ED3\u679C: \u6210\u529F=${syncResult.success}, \u5931\u8D25=${syncResult.failed}`);
                if (syncResult.success > 0) {
                  try {
                    const { submitReliableConfirmation: submitReliableConfirmation2 } = await Promise.resolve().then(() => (init_commandConfirmationService(), commandConfirmationService_exports));
                    submitReliableConfirmation2(accountId, ["keywords"], "batchUpdateBid", "bid_change");
                  } catch (e) {
                    log160.debug(`\u786E\u8BA4\u540C\u6B65\u89E6\u53D1\u5FFD\u7565: ${e instanceof Error ? e.message : e}`);
                  }
                }
              }
            }
          } catch (syncError) {
            log160.warn(`[Keyword.batchUpdateBid] v159: Amazon\u540C\u6B65\u5931\u8D25(\u672C\u5730\u5DF2\u66F4\u65B0):`, syncError.message);
          }
        }
        return { success: true, updated: results.length, results };
      }),
      // 批量更新状态
      batchUpdateStatus: protectedProcedure.input(external_exports.object({
        ids: external_exports.array(external_exports.number()),
        status: external_exports.enum(["enabled", "paused"])
      })).mutation(async ({ ctx, input }) => {
        const { verifyBatchKeywordAccess: verifyBatchKeywordAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyBatchKeywordAccess2(ctx.user.id, input.ids);
        await batchUpdateKeywordStatus(input.ids, input.status);
        const updated = input.ids.length;
        try {
          const dbInstance = await getDb();
          if (dbInstance) {
            const { keywords: keywordsTable, adGroups: adGroups6, campaigns: campaigns6 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
            const { eq: eq12, inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
            const kwDetails = await dbInstance.select({
              kwId: keywordsTable.id,
              adGroupId: keywordsTable.internalAdGroupId,
              campaignId: adGroups6.campaignId,
              accountId: campaigns6.accountId
            }).from(keywordsTable).innerJoin(adGroups6, eq12(keywordsTable.internalAdGroupId, adGroups6.id)).innerJoin(campaigns6, eq12(adGroups6.campaignId, campaigns6.campaignId)).where(inArray13(keywordsTable.id, input.ids));
            const byAccount = /* @__PURE__ */ new Map();
            for (const kw of kwDetails) {
              if (!byAccount.has(kw.accountId)) byAccount.set(kw.accountId, []);
              byAccount.get(kw.accountId).push({ keywordId: kw.kwId, campaignId: kw.campaignId });
            }
            const { syncKeywordStatusToAmazon: syncKeywordStatusToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
            for (const [accountId, kws] of byAccount) {
              const statusChanges = kws.map((kw) => ({
                keywordId: kw.keywordId,
                newStatus: input.status,
                campaignId: kw.campaignId,
                reason: `\u7528\u6237\u624B\u52A8\u6279\u91CF${input.status === "enabled" ? "\u542F\u7528" : "\u6682\u505C"}\u5173\u952E\u8BCD`
              }));
              const syncResult = await syncKeywordStatusToAmazon2(accountId, statusChanges);
              log160.info(`[Keyword.batchUpdateStatus] v159: accountId=${accountId}, \u540C\u6B65\u7ED3\u679C: \u6210\u529F=${syncResult.success}, \u5931\u8D25=${syncResult.failed}`);
              if (syncResult.success > 0) {
                try {
                  const { submitReliableConfirmation: submitReliableConfirmation2 } = await Promise.resolve().then(() => (init_commandConfirmationService(), commandConfirmationService_exports));
                  submitReliableConfirmation2(accountId, ["keywords"], "batchUpdateStatus", "status_change");
                } catch (e) {
                  log160.debug(`\u786E\u8BA4\u540C\u6B65\u89E6\u53D1\u5FFD\u7565: ${e instanceof Error ? e.message : e}`);
                }
              }
            }
          }
        } catch (syncError) {
          log160.warn(`[Keyword.batchUpdateStatus] v159: Amazon\u540C\u6B65\u5931\u8D25(\u672C\u5730\u5DF2\u66F4\u65B0):`, syncError.message);
        }
        return { success: true, updated };
      }),
      // v370.4: 数据隔离
      getMarketCurve: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyKeywordAccess: verifyKeywordAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyKeywordAccess2(ctx.user.id, input.id);
        const keyword = await getKeywordById(input.id);
        if (!keyword) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Keyword not found" });
        }
        const target = {
          id: keyword.id,
          type: "keyword",
          currentBid: parseFloat(keyword.bid),
          impressions: keyword.impressions || 0,
          clicks: keyword.clicks || 0,
          spend: parseFloat(keyword.spend || "0"),
          sales: parseFloat(keyword.sales || "0"),
          orders: keyword.orders || 0,
          matchType: keyword.matchType
        };
        return generateMarketCurve(target);
      }),
      // v370.4: 数据隔离 - 获取关键词历史趋势数据
      getHistoryTrend: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        days: external_exports.number().min(7).max(90).default(30)
      })).query(async ({ ctx, input }) => {
        const { verifyKeywordAccess: verifyKeywordAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyKeywordAccess2(ctx.user.id, input.id);
        const keyword = await getKeywordById(input.id);
        if (!keyword) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Keyword not found" });
        }
        const historyData = await getKeywordHistoryData(input.id, input.days);
        if (!historyData || historyData.length === 0) {
          const simulatedData = generateSimulatedTrendData(keyword, input.days);
          return {
            keyword: {
              id: keyword.id,
              keywordText: keyword.keywordText,
              matchType: keyword.matchType,
              bid: keyword.bid
            },
            trendData: simulatedData,
            summary: calculateTrendSummary(simulatedData)
          };
        }
        return {
          keyword: {
            id: keyword.id,
            keywordText: keyword.keywordText,
            matchType: keyword.matchType,
            bid: keyword.bid
          },
          trendData: historyData,
          summary: calculateTrendSummary(historyData)
        };
      }),
      // 批量创建关键词（从搜索词转投放词）
      batchCreate: protectedProcedure.input(external_exports.object({
        adGroupId: external_exports.number(),
        keywords: external_exports.array(external_exports.object({
          keywordText: external_exports.string(),
          matchType: external_exports.enum(["broad", "phrase", "exact"]),
          bid: external_exports.string()
        }))
      })).mutation(async ({ ctx, input }) => {
        const results = [];
        const errors = [];
        for (const kw of input.keywords) {
          try {
            const existingKeywords = await getKeywordsByAdGroupId(input.adGroupId);
            const exists2 = existingKeywords.some(
              (existing) => existing.keywordText.toLowerCase() === kw.keywordText.toLowerCase() && existing.matchType === kw.matchType
            );
            if (exists2) {
              errors.push({
                keywordText: kw.keywordText,
                matchType: kw.matchType,
                error: "\u5173\u952E\u8BCD\u5DF2\u5B58\u5728"
              });
              continue;
            }
            const id = await createKeyword({
              internalAdGroupId: input.adGroupId,
              // v357: adGroupId现在是varchar类型
              keywordText: kw.keywordText,
              matchType: kw.matchType,
              bid: kw.bid,
              keywordStatus: "enabled"
            });
            results.push({
              id,
              keywordText: kw.keywordText,
              matchType: kw.matchType,
              bid: kw.bid
              // @ts-ignore
            });
          } catch (error48) {
            errors.push({
              keywordText: kw.keywordText,
              matchType: kw.matchType,
              error: error48 instanceof Error ? error48.message : "\u521B\u5EFA\u5931\u8D25"
            });
          }
        }
        return {
          success: true,
          created: results.length,
          failed: errors.length,
          results,
          errors
        };
      })
    });
    productTargetRouter = router({
      list: protectedProcedure.input(external_exports.object({ adGroupId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getProductTargetsByAdGroupId(input.adGroupId);
      }),
      // v370.4: 数据隔离 - productTarget通过adGroup关联到用户
      get: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        return getProductTargetById(input.id);
      }),
      updateBid: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        bid: external_exports.string()
        // @ts-ignore
      })).mutation(async ({ ctx, input }) => {
        await updateProductTargetBid(input.id, input.bid);
        return { success: true };
      }),
      update: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        bid: external_exports.string().optional(),
        status: external_exports.enum(["enabled", "paused", "archived"]).optional()
      })).mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateProductTarget(id, data);
        return { success: true };
      }),
      // 批量更新出价
      batchUpdateBid: protectedProcedure.input(external_exports.object({
        ids: external_exports.array(external_exports.number()),
        bidType: external_exports.enum(["fixed", "increase_percent", "decrease_percent", "cpc_multiplier", "cpc_increase_percent", "cpc_decrease_percent"]),
        bidValue: external_exports.number()
      })).mutation(async ({ ctx, input }) => {
        const results = [];
        for (const id of input.ids) {
          const target = await getProductTargetById(id);
          if (!target) continue;
          let newBid;
          const currentBid = parseFloat(target.bid);
          const spend = parseFloat(target.spend || "0");
          const clicks = target.clicks || 0;
          const cpc = clicks > 0 ? spend / clicks : currentBid;
          if (input.bidType === "fixed") {
            newBid = input.bidValue;
          } else if (input.bidType === "increase_percent") {
            newBid = currentBid * (1 + input.bidValue / 100);
          } else if (input.bidType === "decrease_percent") {
            newBid = currentBid * (1 - input.bidValue / 100);
          } else if (input.bidType === "cpc_multiplier") {
            newBid = cpc * input.bidValue;
          } else if (input.bidType === "cpc_increase_percent") {
            newBid = cpc * (1 + input.bidValue / 100);
          } else {
            newBid = cpc * (1 - input.bidValue / 100);
          }
          newBid = Math.max(0.02, Math.round(newBid * 100) / 100);
          await updateProductTargetBid(id, newBid.toFixed(2));
          results.push({ id, oldBid: currentBid, newBid, cpc });
        }
        if (results.length > 0) {
          try {
            const dbInstance = await getDb();
            if (dbInstance) {
              const { productTargets: productTargets5, adGroups: adGroups6, campaigns: campaigns6 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
              const { eq: eq12, inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
              const ptDetails = await dbInstance.select({
                ptId: productTargets5.id,
                adGroupId: productTargets5.internalAdGroupId,
                campaignId: adGroups6.campaignId,
                accountId: campaigns6.accountId
              }).from(productTargets5).innerJoin(adGroups6, eq12(productTargets5.internalAdGroupId, adGroups6.id)).innerJoin(campaigns6, eq12(adGroups6.campaignId, campaigns6.campaignId)).where(inArray13(productTargets5.id, results.map((r) => r.id)));
              const byAccount = /* @__PURE__ */ new Map();
              for (const pt of ptDetails) {
                const r = results.find((r2) => r2.id === pt.ptId);
                if (!r) continue;
                if (!byAccount.has(pt.accountId)) byAccount.set(pt.accountId, []);
                byAccount.get(pt.accountId).push({ keywordId: pt.ptId, newBid: r.newBid, campaignId: pt.campaignId });
              }
              const { syncBidAdjustmentsToAmazon: syncBidAdjustmentsToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
              for (const [accountId, pts] of byAccount) {
                const adjustments = pts.map((pt) => ({
                  keywordId: pt.keywordId,
                  newBid: pt.newBid,
                  campaignId: pt.campaignId,
                  reason: `\u7528\u6237\u624B\u52A8\u6279\u91CF\u8C03\u6574\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7`,
                  isProductTarget: true
                }));
                const syncResult = await syncBidAdjustmentsToAmazon2(accountId, adjustments);
                log160.info(`[ProductTarget.batchUpdateBid] v159: accountId=${accountId}, \u540C\u6B65\u7ED3\u679C: \u6210\u529F=${syncResult.success}, \u5931\u8D25=${syncResult.failed}`);
              }
            }
          } catch (syncError) {
            log160.warn(`[ProductTarget.batchUpdateBid] v159: Amazon\u540C\u6B65\u5931\u8D25(\u672C\u5730\u5DF2\u66F4\u65B0):`, syncError.message);
          }
        }
        return { success: true, updated: results.length, results };
      }),
      // 批量更新状态
      batchUpdateStatus: protectedProcedure.input(external_exports.object({
        ids: external_exports.array(external_exports.number()),
        // @ts-ignore
        status: external_exports.enum(["enabled", "paused"])
      })).mutation(async ({ ctx, input }) => {
        let updated = 0;
        for (const id of input.ids) {
          await updateProductTarget(id, { targetStatus: input.status });
          updated++;
        }
        try {
          const dbInstance = await getDb();
          if (dbInstance) {
            const { productTargets: productTargets5, adGroups: adGroups6, campaigns: campaigns6 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
            const { eq: eq12, inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
            const ptDetails = await dbInstance.select({
              ptId: productTargets5.id,
              adGroupId: productTargets5.internalAdGroupId,
              campaignId: adGroups6.campaignId,
              accountId: campaigns6.accountId
            }).from(productTargets5).innerJoin(adGroups6, eq12(productTargets5.internalAdGroupId, adGroups6.id)).innerJoin(campaigns6, eq12(adGroups6.campaignId, campaigns6.campaignId)).where(inArray13(productTargets5.id, input.ids));
            const byAccount = /* @__PURE__ */ new Map();
            for (const pt of ptDetails) {
              if (!byAccount.has(pt.accountId)) byAccount.set(pt.accountId, []);
              byAccount.get(pt.accountId).push({ keywordId: pt.ptId, campaignId: pt.campaignId });
            }
            const { syncKeywordStatusToAmazon: syncKeywordStatusToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
            for (const [accountId, pts] of byAccount) {
              const statusChanges = pts.map((pt) => ({
                keywordId: pt.keywordId,
                newStatus: input.status,
                campaignId: pt.campaignId,
                reason: `\u7528\u6237\u624B\u52A8\u6279\u91CF${input.status === "enabled" ? "\u542F\u7528" : "\u6682\u505C"}\u5546\u54C1\u5B9A\u5411`,
                isProductTarget: true
              }));
              const syncResult = await syncKeywordStatusToAmazon2(accountId, statusChanges);
              log160.info(`[ProductTarget.batchUpdateStatus] v159: accountId=${accountId}, \u540C\u6B65\u7ED3\u679C: \u6210\u529F=${syncResult.success}, \u5931\u8D25=${syncResult.failed}`);
            }
          }
        } catch (syncError) {
          log160.warn(`[ProductTarget.batchUpdateStatus] v159: Amazon\u540C\u6B65\u5931\u8D25(\u672C\u5730\u5DF2\u66F4\u65B0):`, syncError.message);
        }
        return { success: true, updated };
      }),
      // 获取商品定向历史趋势数据
      getHistoryTrend: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        days: external_exports.number().min(7).max(90).default(30)
      })).query(async ({ ctx, input }) => {
        const target = await getProductTargetById(input.id);
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Product target not found" });
        }
        const historyData = await getProductTargetHistoryData(input.id, input.days);
        if (!historyData || historyData.length === 0) {
          const simulatedData = generateSimulatedTrendData(target, input.days);
          return {
            target: {
              id: target.id,
              targetExpression: target.targetExpression,
              targetType: target.targetType,
              bid: target.bid
            },
            trendData: simulatedData,
            summary: calculateTrendSummary(simulatedData)
          };
        }
        return {
          target: {
            id: target.id,
            targetExpression: target.targetExpression,
            targetType: target.targetType,
            bid: target.bid
          },
          trendData: historyData,
          summary: calculateTrendSummary(historyData)
        };
      })
    });
  }
});

