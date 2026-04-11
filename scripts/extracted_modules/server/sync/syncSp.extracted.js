// Extracted from production dist/index.js
// Original module: server/sync/syncSp.ts
// Lines: 1168

async function batchInArrayQuery(queryFn, allIds) {
  if (allIds.length <= SEGMENTED_QUERY_BATCH_SIZE) {
    return allIds.length > 0 ? queryFn(allIds) : [];
  }
  const results = [];
  for (let i = 0; i < allIds.length; i += SEGMENTED_QUERY_BATCH_SIZE) {
    const batch = allIds.slice(i, i + SEGMENTED_QUERY_BATCH_SIZE);
    const batchResults = await queryFn(batch);
    results.push(...batchResults);
  }
  log208.info(`v529: \u5206\u6BB5\u6279\u91CF\u67E5\u8BE2\u5B8C\u6210, \u603BID\u6570=${allIds.length}, \u5206${Math.ceil(allIds.length / SEGMENTED_QUERY_BATCH_SIZE)}\u6279, \u7ED3\u679C\u6570=${results.length}`);
  return results;
}
var log208, SEGMENTED_QUERY_BATCH_SIZE;
var init_syncSp = __esm({
  "server/sync/syncSp.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_logger();
    init_amazonSyncService();
    init_localBidRecommendationEngine();
    init_syncHelpers();
    log208 = createModuleLogger("syncSp");
    SEGMENTED_QUERY_BATCH_SIZE = 5e3;
    __name(batchInArrayQuery, "batchInArrayQuery");
    AmazonSyncService.prototype.syncSpCampaigns = async function(lastSyncTime) {
      log208.info("[\u540C\u6B65] ========== \u5F00\u59CB\u540C\u6B65SP\u5E7F\u544A\u6D3B\u52A8 ==========");
      log208.info("[\u540C\u6B65] \u53C2\u6570:", { accountId: this.accountId, lastSyncTime, marketplace: this.marketplace });
      const db = await getDb();
      if (!db) {
        log208.warn("[\u540C\u6B65] \u274C \u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25 - getDb()\u8FD4\u56DEnull");
        return { synced: 0, skipped: 0 };
      }
      log208.info("[\u540C\u6B65] \u2705 \u6570\u636E\u5E93\u8FDE\u63A5\u6210\u529F");
      try {
        log208.info("[\u540C\u6B65] \u6B63\u5728\u8C03\u7528Amazon API: listSpCampaigns()...");
        const apiCampaigns = await this.client.listSpCampaigns();
        log208.info(`[\u540C\u6B65] \u2705 API\u8C03\u7528\u6210\u529F,\u8FD4\u56DE ${apiCampaigns.length} \u4E2ASP\u5E7F\u544A\u6D3B\u52A8`);
        let synced = 0;
        let skipped = 0;
        if (apiCampaigns.length > 0) {
          log208.debug("SP\u5E7F\u544A\u6D3B\u52A8API\u8FD4\u56DE\u7ED3\u6784\u793A\u4F8B:", JSON.stringify(apiCampaigns[0], null, 2));
        }
        log208.debug(`\u83B7\u53D6\u5230 ${apiCampaigns.length} \u4E2ASP\u5E7F\u544A\u6D3B\u52A8`);
        if (apiCampaigns.length > 0) {
          log208.debug("[SP Sync Debug] \u7B2C\u4E00\u4E2A\u5E7F\u544A\u6D3B\u52A8\u7684\u5B8C\u6574\u7ED3\u6784:", JSON.stringify(apiCampaigns[0], null, 2));
          log208.debug("[SP Sync Debug] startDate\u5B57\u6BB5:", apiCampaigns[0].startDate);
          log208.debug("[SP Sync Debug] endDate\u5B57\u6BB5:", apiCampaigns[0].endDate);
        }
        log208.info(`syncSpCampaigns: \u5F00\u59CB\u5904\u7406 ${apiCampaigns.length} \u4E2A\u5E7F\u544A\u6D3B\u52A8`);
        const apiCampaignIds = apiCampaigns.map((ac) => String(ac.campaignId));
        const existingCampaignRows = await batchInArrayQuery(
          (ids) => db.select({ id: campaigns.id, campaignId: campaigns.campaignId }).from(campaigns).where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, ids))),
          apiCampaignIds
        );
        const existingCampaignMap = new Map(existingCampaignRows.map((r) => [r.campaignId, r.id]));
        const allExistingCampaignIds = existingCampaignRows.map((r) => r.id);
        const protectedCampaignIds = await getRecentlyOptimizedCampaignIds(allExistingCampaignIds, SYNC_PROTECTION_CONFIG.BUDGET_PROTECTION_HOURS);
        const protectionStats = createSyncProtectionStats();
        log208.info(`syncSpCampaigns: \u6279\u91CF\u67E5\u8BE2\u5B8C\u6210, ${apiCampaigns.length}\u4E2AAPI\u5E7F\u544A\u6D3B\u52A8, ${existingCampaignRows.length}\u4E2A\u5DF2\u5B58\u5728, ${protectedCampaignIds.size}\u4E2A\u6709\u8FD1\u671F\u9884\u7B97\u4F18\u5316\u4E8B\u4EF6`);
        const existingCampaignFullRows = await batchInArrayQuery(
          (ids) => db.select({
            id: campaigns.id,
            campaignId: campaigns.campaignId,
            campaignName: campaigns.campaignName,
            dailyBudget: campaigns.dailyBudget,
            placementTopSearchBidAdjustment: campaigns.placementTopSearchBidAdjustment,
            placementProductPageBidAdjustment: campaigns.placementProductPageBidAdjustment
          }).from(campaigns).where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, ids))),
          apiCampaignIds
        );
        const existingCampaignFullMap = new Map(existingCampaignFullRows.map((r) => [r.campaignId, r]));
        for (const apiCampaign of apiCampaigns) {
          const existing = existingCampaignFullMap.get(String(apiCampaign.campaignId)) || null;
          if (lastSyncTime && existing) {
          }
          const normalizedTargetingType = (apiCampaign.targetingType || "manual").toLowerCase();
          const campaignType = normalizedTargetingType === "auto" ? "sp_auto" : "sp_manual";
          let dailyBudgetValue = 0;
          const budgetField = apiCampaign.budget;
          if (budgetField !== void 0 && budgetField !== null) {
            if (typeof budgetField === "number") {
              dailyBudgetValue = budgetField;
            } else if (typeof budgetField === "object") {
              dailyBudgetValue = budgetField.budget || budgetField.dailyBudget || budgetField.amount || 0;
            }
          }
          if (dailyBudgetValue === 0 && apiCampaign.dailyBudget) {
            dailyBudgetValue = Number(apiCampaign.dailyBudget) || 0;
          }
          if (dailyBudgetValue === 0) {
            log208.warn(`v168: SP\u5E7F\u544A ${apiCampaign.name} budget\u89E3\u6790\u4E3A0, \u539F\u59CBbudget\u5B57\u6BB5: ${JSON.stringify(budgetField)} dailyBudget: ${apiCampaign.dailyBudget}`);
          }
          if (synced === 0 && skipped === 0) {
            log208.debug("[SP Sync Debug] \u7B2C\u4E00\u4E2A\u5E7F\u544A\u6D3B\u52A8\u7684\u5B8C\u6574\u7ED3\u6784:");
            log208.debug(JSON.stringify(apiCampaign, null, 2));
            log208.debug("[SP Sync Debug] startDate\u5B57\u6BB5:", apiCampaign.startDate);
            log208.debug("[SP Sync Debug] endDate\u5B57\u6BB5:", apiCampaign.endDate);
          }
          let startDateValue = null;
          if (apiCampaign.startDate) {
            const dateStr = String(apiCampaign.startDate);
            if (dateStr.includes("-")) {
              startDateValue = dateStr;
            } else if (dateStr.length === 8) {
              startDateValue = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
            }
          }
          let endDateValue = null;
          if (apiCampaign.endDate) {
            const dateStr = String(apiCampaign.endDate);
            if (dateStr.includes("-")) {
              endDateValue = dateStr;
            } else if (dateStr.length === 8) {
              endDateValue = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
            }
          }
          const rawStrategy = apiCampaign.dynamicBidding?.strategy || // @ts-ignore
          apiCampaign.bidding?.strategy || "LEGACY_FOR_SALES";
          const strategyMap = {
            // @ts-ignore
            "MANUAL": "manual",
            "LEGACY_FOR_SALES": "legacyForSales",
            "AUTO_FOR_SALES": "autoForSales",
            "RULE_BASED": "ruleBasedBidding",
            "manual": "manual",
            "legacyForSales": "legacyForSales",
            "autoForSales": "autoForSales",
            "ruleBasedBidding": "ruleBasedBidding"
          };
          const biddingStrategy = strategyMap[rawStrategy] || "legacyForSales";
          const portfolioId = apiCampaign.portfolioId ? String(apiCampaign.portfolioId) : null;
          const campaignData = {
            accountId: this.accountId,
            campaignId: String(apiCampaign.campaignId),
            campaignName: apiCampaign.name,
            // @ts-ignore
            campaignType,
            // @ts-ignore
            targetingType: normalizedTargetingType,
            // @ts-ignore
            dailyBudget: String(dailyBudgetValue),
            campaignStatus: apiCampaign.state?.toLowerCase() || "enabled",
            state: apiCampaign.state?.toLowerCase() || "enabled",
            startDate: startDateValue,
            endDate: endDateValue,
            // @ts-ignore
            placementTopSearchBidAdjustment: this.getPlacementMultiplier(apiCampaign, "placementTop"),
            // @ts-ignore
            placementProductPageBidAdjustment: this.getPlacementMultiplier(apiCampaign, "placementProductPage"),
            // @ts-ignore
            placementRestBidAdjustment: this.getPlacementMultiplier(apiCampaign, "placementRestOfSearch"),
            biddingStrategy,
            portfolioId,
            costType: "cpc",
            // SP广告都是CPC
            // v577: 增强字段落库 - 确保budget相关字段完整
            budgetType: (apiCampaign.budget?.budgetType || apiCampaign.budgetType || "daily").toLowerCase() === "lifetime" ? "lifetime" : "daily",
            // @ts-ignore
            amazonCreatedDate: startDateValue,
            // 使用广告活动的startDate作为Amazon侧创建日期
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            const localBudget = parseFloat(existing.dailyBudget || "0");
            const apiBudget = parseFloat(String(dailyBudgetValue || "0"));
            if (apiBudget === 0 && localBudget > 0) {
              log208.warn(`v168: \u96F6\u503C\u9884\u7B97\u9632\u62A4\u751F\u6548 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}, \u4FDD\u7559\u672C\u5730\u9884\u7B97`);
              delete campaignData.dailyBudget;
            }
            if (Math.abs(localBudget - apiBudget) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBudget > 0) {
              const hasRecentOpt = protectedCampaignIds.has(existing.id);
              if (hasRecentOpt) {
                log208.debug(`v150: \u9884\u7B97\u4FDD\u62A4\u751F\u6548 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}, \u4FDD\u7559\u672C\u5730\u4F18\u5316\u9884\u7B97`);
                delete campaignData.dailyBudget;
                protectionStats.budgetProtected++;
                protectionStats.protectedEntities.push(`camp:${existing.campaignName}`);
              } else {
                log208.debug(`v150: \u9884\u7B97\u5DEE\u5F02 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}, \u4EE5API\u4E3A\u51C6`);
                protectionStats.budgetOverwritten++;
              }
            }
            const localTopPlacement1 = existing.placementTopSearchBidAdjustment || 0;
            const apiTopPlacement1 = campaignData.placementTopSearchBidAdjustment || 0;
            const localProductPlacement1 = existing.placementProductPageBidAdjustment || 0;
            const apiProductPlacement1 = campaignData.placementProductPageBidAdjustment || 0;
            const localRestPlacement1 = existing.placementRestBidAdjustment || 0;
            const apiRestPlacement1 = campaignData.placementRestBidAdjustment || 0;
            const hasPlacementDiff1 = localTopPlacement1 !== apiTopPlacement1 || localProductPlacement1 !== apiProductPlacement1 || localRestPlacement1 !== apiRestPlacement1;
            if (hasPlacementDiff1 && protectedCampaignIds.has(existing.id)) {
              log208.debug(`v165: \u4F4D\u7F6E\u503E\u659C\u4FDD\u62A4\u751F\u6548 - campaign=${existing.campaignName}, localTop=${localTopPlacement1}%, apiTop=${apiTopPlacement1}%, localProduct=${localProductPlacement1}%, apiProduct=${apiProductPlacement1}%, localRest=${localRestPlacement1}%, apiRest=${apiRestPlacement1}%`);
              delete campaignData.placementTopSearchBidAdjustment;
              delete campaignData.placementProductPageBidAdjustment;
              delete campaignData.placementRestBidAdjustment;
              protectionStats.protectedEntities.push(`placement:${existing.campaignName}`);
            }
            await db.update(campaigns).set(campaignData).where(eq(campaigns.id, existing.id));
          } else {
            await db.insert(campaigns).values({
              ...campaignData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
          }
          synced++;
          if (synced === 1 || synced % 10 === 0) {
            log208.info(`[\u540C\u6B65] \u8FDB\u5EA6: \u5DF2\u540C\u6B65 ${synced}/${apiCampaigns.length} \u4E2A\u5E7F\u544A\u6D3B\u52A8`);
          }
        }
        log208.info(`[\u540C\u6B65] ========== SP\u5E7F\u544A\u6D3B\u52A8\u540C\u6B65\u5B8C\u6210 ==========`);
        log208.info(`[\u540C\u6B65] \u7ED3\u679C: \u540C\u6B65 ${synced} \u4E2A, \u8DF3\u8FC7 ${skipped} \u4E2A`);
        logSyncProtectionSummary("syncSpCampaigns", protectionStats);
        // v577: 记录同步完成事件到system_logs
        try {
          const { getDb: getDb7 } = await Promise.resolve().then(() => (init_db2(), db_exports));
          const db7 = await getDb7();
          if (db7) {
            const { sql: sql19 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
            await db7.execute(sql19`
              INSERT INTO system_logs (level, module, message, metadata, createdAt)
              VALUES ('info', 'syncSpCampaigns', ${`SP广告活动同步完成: synced=${synced}, skipped=${skipped}, protected=${protectionStats.budgetProtected}`}, 
              ${JSON.stringify({ accountId: this.accountId, synced, skipped, protectionStats: { budgetProtected: protectionStats.budgetProtected, budgetOverwritten: protectionStats.budgetOverwritten } })},
              NOW())
            `);
          }
        } catch (logErr) {
          log208.debug(`[同步] v577: system_logs写入失败: ${logErr.message}`);
        }
        return { synced, skipped };
      } catch (error48) {
        log208.warn("[\u540C\u6B65] \u274C SP\u5E7F\u544A\u6D3B\u52A8\u540C\u6B65\u5931\u8D25");
        log208.warn("[\u540C\u6B65] \u9519\u8BEF\u7C7B\u578B:", error48.constructor.name);
        log208.warn("[\u540C\u6B65] \u9519\u8BEF\u6D88\u606F:", error48.message);
        log208.warn("[\u540C\u6B65] \u9519\u8BEF\u5806\u6808:", error48.stack);
        if (error48.response) {
          log208.warn("[\u540C\u6B65] API\u54CD\u5E94\u72B6\u6001:", error48.response.status);
          log208.warn("[\u540C\u6B65] API\u54CD\u5E94\u6570\u636E:", JSON.stringify(error48.response.data, null, 2));
        }
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSpAdGroups = async function(lastSyncTime) {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiAdGroups = await this.client.listSpAdGroups();
        let synced = 0;
        let skipped = 0;
        for (const apiAdGroup of apiAdGroups) {
          const [campaign] = await db.select().from(campaigns).where(
            and(
              eq(campaigns.accountId, this.accountId),
              eq(campaigns.campaignId, String(apiAdGroup.campaignId))
            )
          ).limit(1);
          if (!campaign) continue;
          const [existing] = await db.select().from(adGroups).where(
            and(
              eq(adGroups.accountId, this.accountId),
              eq(adGroups.campaignId, String(campaign.campaignId)),
              eq(adGroups.adGroupId, String(apiAdGroup.adGroupId))
            )
          ).limit(1);
          const normalizedState = (apiAdGroup.state || "enabled").toLowerCase();
          const adGroupData = {
            campaignId: campaign.campaignId,
            accountId: this.accountId,
            adGroupId: String(apiAdGroup.adGroupId),
            adGroupName: apiAdGroup.name,
            adGroupStatus: normalizedState,
            defaultBid: String(apiAdGroup.defaultBid || 0),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            await db.update(adGroups).set(adGroupData).where(eq(adGroups.id, existing.id));
          } else {
            await db.insert(adGroups).values({
              ...adGroupData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            }).onDuplicateKeyUpdate({
              set: {
                adGroupName: sql`VALUES(adGroupName)`,
                adGroupStatus: sql`VALUES(adGroupStatus)`,
                defaultBid: sql`VALUES(defaultBid)`,
                updatedAt: sql`VALUES(updatedAt)`
              }
            });
          }
          synced++;
        }
        return { synced, skipped };
      } catch (error48) {
        {
          const _cause = error48?.cause;
          const _mysqlCause = _cause?.cause;
          const _mysqlErr = _mysqlCause || _cause;
          const _mysqlInfo = _mysqlErr ? `code=${_mysqlErr.code || _mysqlErr.errno || "?"}, msg=${String(_mysqlErr.message || _mysqlErr.sqlMessage || "").slice(0, 200)}` : "no-mysql-cause";
          log208.warn(`Error syncing SP ad groups: ${error48.message?.slice(0, 200)} | MySQL: ${_mysqlInfo}`);
        }
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSpKeywords = async function(lastSyncTime) {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiKeywords = await this.client.listSpKeywords();
        let synced = 0;
        let skipped = 0;
        log208.info(`syncSpKeywords: \u5F00\u59CB\u5904\u7406 ${apiKeywords.length} \u4E2A\u5173\u952E\u8BCD`);
        const apiKeywordAdGroupIds = [...new Set(apiKeywords.map((ak) => String(ak.internal_ad_group_id)))];
        const adGroupRows = await batchInArrayQuery(
          (ids) => db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId, campaignId: adGroups.campaignId }).from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, ids))),
          apiKeywordAdGroupIds
        );
        const adGroupIdMap = new Map(adGroupRows.map((r) => [r.adGroupId, r.id]));
        const adGroupFullMap = new Map(adGroupRows.map((r) => [r.adGroupId, { id: r.id, campaignId: r.campaignId }]));
        const apiKeywordIds = apiKeywords.map((ak) => String(ak.keywordId));
        const existingKeywordRows = await batchInArrayQuery(
          (ids) => db.select({ id: keywords.id, keywordId: keywords.keywordId, adGroupId: keywords.internalAdGroupId, bid: keywords.bid, keywordText: keywords.keywordText }).from(keywords).where(and(eq(keywords.accountId, this.accountId), inArray(keywords.keywordId, ids))),
          apiKeywordIds
        );
        const existingKeywordMap = new Map(existingKeywordRows.map((r) => [`${r.adGroupId}:${r.keywordId}`, r]));
        const allExistingKeywordIds = existingKeywordRows.map((r) => r.id);
        const protectedKeywordIds = await getRecentlyOptimizedKeywordIds(allExistingKeywordIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
        const protectionStats = createSyncProtectionStats();
        log208.info(`syncSpKeywords: \u6279\u91CF\u67E5\u8BE2\u5B8C\u6210, ${apiKeywords.length}\u4E2AAPI\u5173\u952E\u8BCD, ${existingKeywordRows.length}\u4E2A\u5DF2\u5B58\u5728, ${protectedKeywordIds.size}\u4E2A\u6709\u8FD1\u671F\u51FA\u4EF7\u4F18\u5316\u4E8B\u4EF6`);
        for (const apiKeyword of apiKeywords) {
          const adGroupInfo = adGroupFullMap.get(String(apiKeyword.adGroupId));
          if (!adGroupInfo) continue;
          const adGroup = adGroupInfo;
          const existing = existingKeywordMap.get(`${adGroup.id}:${String(apiKeyword.keywordId)}`) || null;
          const keywordData = {
            internalAdGroupId: adGroup.id,
            // v418: ID体系重构
            accountId: this.accountId,
            campaignId: adGroup.campaignId || "",
            // v357
            keywordId: String(apiKeyword.keywordId),
            keywordText: apiKeyword.keywordText,
            matchType: (apiKeyword.matchType || "broad").toLowerCase(),
            keywordStatus: (apiKeyword.state || "enabled").toLowerCase(),
            bid: String(apiKeyword.bid),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            const normalizedApiState = (apiKeyword.state || "enabled").toLowerCase();
            if (existing.keywordStatus === "amazon_deleted" && normalizedApiState !== "archived") {
              log208.debug(`v523.2: \u4FDD\u62A4SP(syncSp) keyword amazon_deleted\u72B6\u6001 - keyword=${existing.keywordText}(id=${existing.id})`);
              delete keywordData.keywordStatus;
            }
            const localBid = parseFloat(existing.bid || "0");
            const apiBid = parseFloat(String(apiKeyword.bid || "0"));
            if (Math.abs(localBid - apiBid) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBid > 0) {
              const hasRecentOpt = protectedKeywordIds.has(existing.id);
              if (hasRecentOpt) {
                log208.debug(`v150: \u51FA\u4EF7\u4FDD\u62A4\u751F\u6548 - keyword=${existing.keywordText}, local=$${localBid}, api=$${apiBid}, \u4FDD\u7559\u672C\u5730\u4F18\u5316\u51FA\u4EF7`);
                delete keywordData.bid;
                protectionStats.bidProtected++;
                protectionStats.protectedEntities.push(`kw:${existing.keywordText}`);
              } else {
                log208.debug(`v150: \u51FA\u4EF7\u5DEE\u5F02 - keyword=${existing.keywordText}, local=$${localBid}, api=$${apiBid}, \u4EE5API\u4E3A\u51C6`);
                protectionStats.bidOverwritten++;
              }
            }
            await db.update(keywords).set(keywordData).where(eq(keywords.id, existing.id));
          } else {
            await db.insert(keywords).values({
              ...keywordData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            }).onDuplicateKeyUpdate({
              set: {
                bid: sql`VALUES(bid)`,
                keywordStatus: sql`VALUES(keywordStatus)`,
                updatedAt: sql`VALUES(updatedAt)`
              }
            });
          }
          synced++;
        }
        logSyncProtectionSummary("syncSpKeywords", protectionStats);
        return { synced, skipped };
      } catch (error48) {
        const _cause = error48?.cause;
        const _mysqlCause = _cause?.cause;
        const _mysqlErr = _mysqlCause || _cause;
        const _mysqlInfo = _mysqlErr ? `code=${_mysqlErr.code || _mysqlErr.errno || "?"}, msg=${String(_mysqlErr.message || _mysqlErr.sqlMessage || "").slice(0, 200)}` : "no-mysql-cause";
        log208.warn(`Error syncing SP keywords: ${error48.message?.slice(0, 200)} | MySQL: ${_mysqlInfo}`);
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSpProductTargets = async function(lastSyncTime) {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiTargets = await this.client.listSpProductTargets();
        let synced = 0;
        let skipped = 0;
        log208.info(`syncSpProductTargets: \u5F00\u59CB\u5904\u7406 ${apiTargets.length} \u4E2A\u4EA7\u54C1\u5B9A\u5411`);
        const apiTargetAdGroupIds = [...new Set(apiTargets.map((at) => String(at.adGroupId)))];
        const targetAdGroupRows = await batchInArrayQuery(
          (ids) => db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId, campaignId: adGroups.campaignId }).from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, ids))),
          apiTargetAdGroupIds
        );
        const targetAdGroupIdMap = new Map(targetAdGroupRows.map((r) => [r.adGroupId, r.id]));
        const targetAdGroupFullMap = new Map(targetAdGroupRows.map((r) => [r.adGroupId, { id: r.id, campaignId: r.campaignId }]));
        const apiTargetIds = apiTargets.map((at) => String(at.targetId));
        const existingTargetRows = await batchInArrayQuery(
          (ids) => db.select({ id: productTargets.id, targetId: productTargets.targetId, adGroupId: productTargets.internalAdGroupId, bid: productTargets.bid, targetValue: productTargets.targetValue }).from(productTargets).where(and(eq(productTargets.accountId, this.accountId), inArray(productTargets.targetId, ids))),
          apiTargetIds
        );
        const existingTargetMap = new Map(existingTargetRows.map((r) => [`${r.adGroupId}:${r.targetId}`, r]));
        const allExistingTargetIds = existingTargetRows.map((r) => r.id);
        const protectedTargetIds = await getRecentlyOptimizedKeywordIds(allExistingTargetIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
        const protectionStats = createSyncProtectionStats();
        log208.info(`syncSpProductTargets: \u6279\u91CF\u67E5\u8BE2\u5B8C\u6210, ${apiTargets.length}\u4E2AAPI\u5B9A\u5411, ${existingTargetRows.length}\u4E2A\u5DF2\u5B58\u5728, ${protectedTargetIds.size}\u4E2A\u6709\u8FD1\u671F\u51FA\u4EF7\u4F18\u5316\u4E8B\u4EF6`);
        for (const apiTarget of apiTargets) {
          const targetAdGroupInfo = targetAdGroupFullMap.get(String(apiTarget.adGroupId));
          if (!targetAdGroupInfo) continue;
          const adGroup = targetAdGroupInfo;
          let targetType = "asin";
          let targetValue = "";
          let targetMatchType = "exact";
          let categoryName = null;
          let categoryRefinements = null;
          const refinements = {};
          for (const expr of apiTarget.expression || []) {
            const et = (expr.type || "").toLowerCase();
            if (et.includes("categorysame") || et === "asincategorysameAs" || et === "asincategorysame") {
              targetType = "category";
              targetValue = expr.value || "";
              targetMatchType = "category_exact";
            } else if (et.includes("brandsame") || et === "asinbrandsameAs" || et === "asinbrandsame") {
              targetType = "category";
              targetValue = expr.value || "";
              targetMatchType = "brand_exact";
            } else if (et.includes("pricebetween") || et.includes("price")) {
              refinements.priceRange = expr.value;
            } else if (et.includes("reviewrating") || et.includes("star") || et.includes("rating")) {
              refinements.starRating = expr.value;
            } else if (et.includes("isprime")) {
              refinements.isPrime = expr.value;
            } else if (et.includes("expanded") || et.includes("expandedfrom")) {
              targetType = "asin";
              targetValue = expr.value || "";
              targetMatchType = "expanded";
            } else if (et.includes("substitute")) {
              targetType = "asin";
              targetValue = expr.value || "AUTO_SUBSTITUTES";
              targetMatchType = "substitute";
            } else if (et.includes("accessory") || et.includes("complement")) {
              targetType = "asin";
              targetValue = expr.value || "AUTO_COMPLEMENTS";
              targetMatchType = "accessory";
            } else if (et.includes("broadrel") || et.includes("broad_rel") || et.includes("loose")) {
              targetValue = expr.value || "AUTO_LOOSE";
              targetMatchType = "loose";
            } else if (et.includes("highrel") || et.includes("high_rel") || et.includes("close")) {
              targetValue = expr.value || "AUTO_CLOSE";
              targetMatchType = "close";
            } else if (et.includes("asin") && et.includes("same")) {
              targetType = "asin";
              targetValue = expr.value || "";
              targetMatchType = "exact";
            } else if (expr.value && !targetValue) {
              targetValue = expr.value;
            }
          }
          if (!targetValue && apiTarget.resolvedExpression) {
            const resolved = apiTarget.resolvedExpression;
            if (Array.isArray(resolved)) {
              for (const re of resolved) {
                const ret = (re.type || "").toLowerCase();
                if (ret.includes("category")) {
                  targetType = "category";
                  targetValue = re.value || "";
                  targetMatchType = "category_exact";
                  categoryName = re.name || null;
                } else if (re.value) {
                  targetValue = re.value;
                }
              }
            }
          }
          if (Object.keys(refinements).length > 0) {
            categoryRefinements = JSON.stringify(refinements);
          }
          if (!targetValue) {
            const exprTypes = (apiTarget.expression || []).map((e) => e.type || "").join(",");
            targetValue = exprTypes || `AUTO_${String(apiTarget.targetId)}`;
            log208.debug(`v474: targetValue\u4E3A\u7A7A\uFF0C\u4F7F\u7528\u56DE\u9000\u503C: ${targetValue}`);
          }
          const normalizedState = (apiTarget.state || "enabled").toLowerCase();
          const [existing] = await db.select().from(productTargets).where(
            and(
              eq(productTargets.accountId, this.accountId),
              eq(productTargets.internalAdGroupId, adGroup.id),
              // v420: 修复 - internalAdGroupId是int类型
              eq(productTargets.targetId, String(apiTarget.targetId))
            )
          ).limit(1);
          const targetData = {
            accountId: this.accountId,
            internalAdGroupId: adGroup.id,
            // v418: ID体系重构
            campaignId: adGroup.campaignId || "",
            // v357
            targetId: String(apiTarget.targetId),
            targetType,
            targetValue,
            targetExpression: JSON.stringify(apiTarget.expression),
            targetMatchType,
            // @ts-ignore
            targetStatus: normalizedState,
            bid: String(typeof apiTarget.bid === "object" && apiTarget.bid !== null ? apiTarget.bid.amount || 0 : apiTarget.bid || 0),
            categoryName,
            categoryRefinements,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (synced === 0) {
            log208.debug(`SP\u4EA7\u54C1\u5B9A\u5411\u793A\u4F8B: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
          }
          if (existing) {
            if (existing.targetStatus === "amazon_deleted" && normalizedState !== "archived") {
              log208.debug(`v523.2: \u4FDD\u62A4SP(syncSp) target amazon_deleted\u72B6\u6001 - target=${existing.targetValue}(id=${existing.id})`);
              delete targetData.targetStatus;
            }
            const localBid = parseFloat(existing.bid || "0");
            const apiBid = parseFloat(String(apiTarget.bid || "0"));
            if (Math.abs(localBid - apiBid) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBid > 0) {
              const hasRecentOpt = protectedTargetIds.has(existing.id);
              if (hasRecentOpt) {
                log208.debug(`v150: \u51FA\u4EF7\u4FDD\u62A4\u751F\u6548 - target=${existing.targetValue}, local=$${localBid}, api=$${apiBid}, \u4FDD\u7559\u672C\u5730\u4F18\u5316\u51FA\u4EF7`);
                delete targetData.bid;
                protectionStats.bidProtected++;
                protectionStats.protectedEntities.push(`tgt:${existing.targetValue}`);
              } else {
                log208.debug(`v150: \u51FA\u4EF7\u5DEE\u5F02 - target=${existing.targetValue}, local=$${localBid}, api=$${apiBid}, \u4EE5API\u4E3A\u51C6`);
                protectionStats.bidOverwritten++;
              }
            }
            await db.update(productTargets).set(targetData).where(eq(productTargets.id, existing.id));
          } else {
            await db.insert(productTargets).values({
              ...targetData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
              // @ts-ignore
            }).onDuplicateKeyUpdate({
              set: {
                bid: sql`VALUES(bid)`,
                targetStatus: sql`VALUES(targetStatus)`,
                updatedAt: sql`VALUES(updatedAt)`
              }
            });
          }
          synced++;
        }
        log208.info(`SP\u4EA7\u54C1\u5B9A\u5411\u540C\u6B65\u5B8C\u6210: synced=${synced}, skipped=${skipped}`);
        logSyncProtectionSummary("syncSpProductTargets", protectionStats);
        return { synced, skipped };
      } catch (error48) {
        {
          const _cause = error48?.cause;
          const _mysqlCause = _cause?.cause;
          const _mysqlErr = _mysqlCause || _cause;
          const _mysqlInfo = _mysqlErr ? `code=${_mysqlErr.code || _mysqlErr.errno || "?"}, msg=${String(_mysqlErr.message || _mysqlErr.sqlMessage || "").slice(0, 200)}` : "no-mysql-cause";
          log208.warn(`Error syncing SP product targets: ${error48.message?.slice(0, 200)} | MySQL: ${_mysqlInfo}`);
        }
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSpNegativeKeywords = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, updated: 0 };
      try {
        let synced = 0;
        let updated = 0;
        log208.info(`\u5F00\u59CB\u540C\u6B65SP\u6D3B\u52A8\u7EA7\u522B\u5426\u5B9A\u5173\u952E\u8BCD...`);
        const campaignNegatives = await this.client.listSpCampaignNegativeKeywords();
        log208.debug(`\u83B7\u53D6\u5230 ${campaignNegatives.length} \u4E2A\u6D3B\u52A8\u7EA7\u522B\u5426\u5B9A\u5173\u952E\u8BCD`);
        for (const neg of campaignNegatives) {
          const [campaign] = await db.select().from(campaigns).where(
            and(
              eq(campaigns.accountId, this.accountId),
              eq(campaigns.campaignId, String(neg.campaignId))
            )
          ).limit(1);
          if (!campaign) continue;
          const negState = (neg.state || "enabled").toLowerCase();
          if (negState === "archived") continue;
          const matchType = (neg.matchType || "").toLowerCase().includes("phrase") ? "negative_phrase" : "negative_exact";
          const amazonKeywordId = String(neg.keywordId || neg.campaignNegativeKeywordId || "");
          const [existing] = await db.select().from(negativeKeywords).where(
            and(
              eq(negativeKeywords.accountId, this.accountId),
              eq(negativeKeywords.campaignId, String(campaign.campaignId)),
              eq(negativeKeywords.negativeLevel, "campaign"),
              // @ts-ignore
              eq(negativeKeywords.negativeText, neg.keywordText || "")
            )
          ).limit(1);
          if (existing) {
            await db.update(negativeKeywords).set({ negativeMatchType: matchType, amazonNegativeKeywordId: amazonKeywordId || null, negativeStatus: "active" }).where(eq(negativeKeywords.id, existing.id));
            updated++;
          } else {
            await db.insert(negativeKeywords).values({
              accountId: this.accountId,
              campaignId: String(campaign.campaignId),
              negativeLevel: "campaign",
              negativeType: "keyword",
              negativeText: neg.keywordText || "",
              // @ts-ignore
              negativeMatchType: matchType,
              amazonNegativeKeywordId: amazonKeywordId || null,
              negativeSource: "manual",
              negativeStatus: "active"
            }).onDuplicateKeyUpdate({
              set: { negativeStatus: sql`VALUES(negativeStatus)`, amazonNegativeKeywordId: sql`VALUES(amazon_negative_keyword_id)` }
            });
            synced++;
          }
        }
        log208.info(`\u5F00\u59CB\u540C\u6B65SP\u5E7F\u544A\u7EC4\u7EA7\u522B\u5426\u5B9A\u5173\u952E\u8BCD...`);
        const adGroupNegatives = await this.client.listSpNegativeKeywords();
        log208.debug(`\u83B7\u53D6\u5230 ${adGroupNegatives.length} \u4E2A\u5E7F\u544A\u7EC4\u7EA7\u522B\u5426\u5B9A\u5173\u952E\u8BCD`);
        for (const neg of adGroupNegatives) {
          const negState = (neg.state || "enabled").toLowerCase();
          if (negState === "archived") continue;
          const [adGroup] = await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), eq(adGroups.adGroupId, String(neg.adGroupId)))).limit(1);
          if (!adGroup) continue;
          const [campaign] = await db.select().from(campaigns).where(eq(campaigns.campaignId, adGroup.campaignId)).limit(1);
          if (!campaign) continue;
          const matchType = (neg.matchType || "").toLowerCase().includes("phrase") ? "negative_phrase" : "negative_exact";
          const amazonKeywordId = String(neg.keywordId || neg.negativeKeywordId || "");
          const [existing] = await db.select().from(negativeKeywords).where(
            and(
              eq(negativeKeywords.accountId, this.accountId),
              eq(negativeKeywords.campaignId, String(campaign.campaignId)),
              eq(negativeKeywords.internalAdGroupId, adGroup.id),
              // v420: 修复 - internalAdGroupId是int类型
              eq(negativeKeywords.negativeLevel, "ad_group"),
              // @ts-ignore
              eq(negativeKeywords.negativeText, neg.keywordText || "")
            )
          ).limit(1);
          if (existing) {
            await db.update(negativeKeywords).set({ negativeMatchType: matchType, amazonNegativeKeywordId: amazonKeywordId || null, negativeStatus: "active" }).where(eq(negativeKeywords.id, existing.id));
            updated++;
          } else {
            await db.insert(negativeKeywords).values({
              // @ts-ignore
              accountId: this.accountId,
              campaignId: String(campaign.campaignId),
              internalAdGroupId: adGroup.id,
              // v418: ID体系重构
              negativeLevel: "ad_group",
              negativeType: "keyword",
              negativeText: neg.keywordText || "",
              negativeMatchType: matchType,
              amazonNegativeKeywordId: amazonKeywordId || null,
              negativeSource: "manual",
              negativeStatus: "active"
            }).onDuplicateKeyUpdate({
              set: { negativeStatus: sql`VALUES(negativeStatus)`, amazonNegativeKeywordId: sql`VALUES(amazon_negative_keyword_id)` }
            });
            synced++;
          }
        }
        log208.info(`SP\u5426\u5B9A\u5173\u952E\u8BCD\u540C\u6B65\u5B8C\u6210: ${synced} \u6761\u65B0\u8BB0\u5F55, ${updated} \u6761\u66F4\u65B0`);
        return { synced, updated };
      } catch (error48) {
        {
          const _cause = error48?.cause;
          const _mysqlCause = _cause?.cause;
          const _mysqlErr = _mysqlCause || _cause;
          const _mysqlInfo = _mysqlErr ? `code=${_mysqlErr.code || _mysqlErr.errno || "?"}, msg=${String(_mysqlErr.message || _mysqlErr.sqlMessage || "").slice(0, 200)}` : "no-mysql-cause";
          log208.warn(`Error syncing SP negative keywords: ${error48.message?.slice(0, 200)} | MySQL: ${_mysqlInfo}`);
        }
        return { synced: 0, updated: 0 };
      }
    };
    AmazonSyncService.prototype.syncSpNegativeProductTargets = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, updated: 0 };
      try {
        let synced = 0;
        let updated = 0;
        log208.info(`\u5F00\u59CB\u540C\u6B65SP\u6D3B\u52A8\u7EA7\u522B\u5426\u5B9A\u5546\u54C1\u5B9A\u5411...`);
        const campaignNegTargets = await this.client.listSpCampaignNegativeTargets();
        log208.debug(`\u83B7\u53D6\u5230 ${campaignNegTargets.length} \u4E2A\u6D3B\u52A8\u7EA7\u522B\u5426\u5B9A\u5546\u54C1\u5B9A\u5411`);
        for (const neg of campaignNegTargets) {
          const [campaign] = await db.select().from(campaigns).where(
            and(
              eq(campaigns.accountId, this.accountId),
              eq(campaigns.campaignId, String(neg.campaignId))
            )
          ).limit(1);
          if (!campaign) continue;
          const negState = (neg.state || "enabled").toLowerCase();
          if (negState === "archived") continue;
          const expression = neg.expression || [];
          const asinExpr = expression.find((e) => e.type?.toLowerCase().includes("asin"));
          const negativeText = asinExpr?.value || JSON.stringify(expression);
          const amazonTargetId = String(neg.targetId || "");
          const [existing] = await db.select().from(negativeKeywords).where(
            and(
              eq(negativeKeywords.accountId, this.accountId),
              eq(negativeKeywords.campaignId, String(campaign.campaignId)),
              eq(negativeKeywords.negativeLevel, "campaign"),
              eq(negativeKeywords.negativeType, "product"),
              eq(negativeKeywords.negativeText, negativeText)
            )
          ).limit(1);
          if (existing) {
            await db.update(negativeKeywords).set({ amazonNegativeKeywordId: amazonTargetId || null, negativeStatus: "active" }).where(eq(negativeKeywords.id, existing.id));
            updated++;
          } else {
            await db.insert(negativeKeywords).values({
              accountId: this.accountId,
              campaignId: String(campaign.campaignId),
              negativeLevel: "campaign",
              negativeType: "product",
              negativeText,
              negativeMatchType: "negative_exact",
              amazonNegativeKeywordId: amazonTargetId || null,
              negativeSource: "manual",
              negativeStatus: "active"
            }).onDuplicateKeyUpdate({
              set: { negativeStatus: sql`VALUES(negativeStatus)`, amazonNegativeKeywordId: sql`VALUES(amazon_negative_keyword_id)` }
            });
            synced++;
          }
        }
        log208.info(`\u5F00\u59CB\u540C\u6B65SP\u5E7F\u544A\u7EC4\u7EA7\u522B\u5426\u5B9A\u5546\u54C1\u5B9A\u5411...`);
        const adGroupNegTargets = await this.client.listSpNegativeTargets();
        log208.debug(`\u83B7\u53D6\u5230 ${adGroupNegTargets.length} \u4E2A\u5E7F\u544A\u7EC4\u7EA7\u522B\u5426\u5B9A\u5546\u54C1\u5B9A\u5411`);
        for (const neg of adGroupNegTargets) {
          const negState = (neg.state || "enabled").toLowerCase();
          if (negState === "archived") continue;
          const [adGroup] = await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), eq(adGroups.adGroupId, String(neg.adGroupId)))).limit(1);
          if (!adGroup) continue;
          const [campaign] = await db.select().from(campaigns).where(eq(campaigns.campaignId, adGroup.campaignId)).limit(1);
          if (!campaign) continue;
          const expression = neg.expression || [];
          const asinExpr = expression.find((e) => e.type?.toLowerCase().includes("asin"));
          const negativeText = asinExpr?.value || JSON.stringify(expression);
          const amazonTargetId = String(neg.targetId || "");
          const [existing] = await db.select().from(negativeKeywords).where(
            and(
              eq(negativeKeywords.accountId, this.accountId),
              eq(negativeKeywords.campaignId, String(campaign.campaignId)),
              eq(negativeKeywords.internalAdGroupId, adGroup.id),
              // v420: 修复 - internalAdGroupId是int类型
              eq(negativeKeywords.negativeLevel, "ad_group"),
              eq(negativeKeywords.negativeType, "product"),
              eq(negativeKeywords.negativeText, negativeText)
            )
          ).limit(1);
          if (existing) {
            await db.update(negativeKeywords).set({ amazonNegativeKeywordId: amazonTargetId || null, negativeStatus: "active" }).where(eq(negativeKeywords.id, existing.id));
            updated++;
          } else {
            await db.insert(negativeKeywords).values({
              accountId: this.accountId,
              campaignId: String(campaign.campaignId),
              internalAdGroupId: adGroup.id,
              // v418: ID体系重构
              negativeLevel: "ad_group",
              // @ts-ignore
              negativeType: "product",
              negativeText,
              negativeMatchType: "negative_exact",
              amazonNegativeKeywordId: amazonTargetId || null,
              negativeSource: "manual",
              negativeStatus: "active"
            }).onDuplicateKeyUpdate({
              set: { negativeStatus: sql`VALUES(negativeStatus)`, amazonNegativeKeywordId: sql`VALUES(amazon_negative_keyword_id)` }
            });
            synced++;
          }
        }
        log208.info(`SP\u5426\u5B9A\u5546\u54C1\u5B9A\u5411\u540C\u6B65\u5B8C\u6210: ${synced} \u6761\u65B0\u8BB0\u5F55, ${updated} \u6761\u66F4\u65B0`);
        return { synced, updated };
      } catch (error48) {
        {
          const _cause = error48?.cause;
          const _mysqlCause = _cause?.cause;
          const _mysqlErr = _mysqlCause || _cause;
          const _mysqlInfo = _mysqlErr ? `code=${_mysqlErr.code || _mysqlErr.errno || "?"}, msg=${String(_mysqlErr.message || _mysqlErr.sqlMessage || "").slice(0, 200)}` : "no-mysql-cause";
          log208.warn(`Error syncing SP negative product targets: ${error48.message?.slice(0, 200)} | MySQL: ${_mysqlInfo}`);
        }
        return { synced: 0, updated: 0 };
      }
    };
    AmazonSyncService.prototype.syncSpBidRecommendations = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      let keywordBidsUpdated = 0;
      let targetBidsUpdated = 0;
      let errors = 0;
      try {
        log208.info("[v414] ========== \u5F00\u59CB\u540C\u6B65SP\u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7 ==========");
        const spKeywordRows = await db.select({
          id: keywords.id,
          adGroupId: keywords.internalAdGroupId,
          keywordText: keywords.keywordText,
          matchType: keywords.matchType,
          campaignId: campaigns.campaignId
          // v437: 添加campaignId用于Theme-Based API
        }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(and(
          eq(keywords.accountId, this.accountId),
          // v422: 修复 - campaignType枚举值是'sp_auto'/'sp_manual'，不是'sponsoredProducts'
          sql`${campaigns.campaignType} IN ('sp_auto', 'sp_manual')`,
          eq(keywords.keywordStatus, "enabled")
        ));
        log208.info(`[v414] \u67E5\u8BE2\u5230 ${spKeywordRows.length} \u4E2ASP\u5173\u952E\u8BCD\u9700\u8981\u83B7\u53D6\u5EFA\u8BAE\u7ADE\u4EF7`);
        const kwByAdGroup = /* @__PURE__ */ new Map();
        for (const row of spKeywordRows) {
          const agId = Number(row.adGroupId) || 0;
          if (agId === 0) continue;
          if (!kwByAdGroup.has(agId)) kwByAdGroup.set(agId, []);
          kwByAdGroup.get(agId).push({ id: row.id, keywordText: row.keywordText, matchType: row.matchType, campaignId: row.campaignId });
        }
        const internalAdGroupIds = [...kwByAdGroup.keys()];
        const adGroupMappingRows = internalAdGroupIds.length > 0 ? await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.id, internalAdGroupIds))) : [];
        const internalToAmazonAdGroupId = new Map(adGroupMappingRows.map((r) => [r.id, r.adGroupId]));
        let adGroupIndex = 0;
        for (const [internalAgId, kwList] of kwByAdGroup) {
          const amazonAgId = internalToAmazonAdGroupId.get(internalAgId);
          if (!amazonAgId) {
            log208.debug(`[v414] adGroup ${internalAgId} \u65E0Amazon adGroupId\u6620\u5C04\uFF0C\u8DF3\u8FC7`);
            continue;
          }
          if (adGroupIndex > 0) {
            await new Promise((resolve) => setTimeout(resolve, 5e3));
          }
          adGroupIndex++;
          try {
            const batchSize = 100;
            for (let i = 0; i < kwList.length; i += batchSize) {
              const batch = kwList.slice(i, i + batchSize);
              const apiKeywords = batch.map((kw) => ({
                keyword: kw.keywordText,
                matchType: kw.matchType.toUpperCase()
              }));
              const batchCampaignId = batch[0]?.campaignId || "";
              const recommendations = await this.client.getKeywordBidRecommendations(amazonAgId, apiKeywords, batchCampaignId);
              if (recommendations && recommendations.length > 0) {
                const recMap = /* @__PURE__ */ new Map();
                for (const rec of recommendations) {
                  if (rec.keyword && rec.suggestedBid) {
                    const bidData = {
                      suggestedBid: rec.suggestedBid,
                      rangeLow: rec.rangeStart || 0,
                      rangeHigh: rec.rangeEnd || 0
                    };
                    recMap.set(`${rec.keyword.toLowerCase()}:${rec.matchType?.toLowerCase() || ""}`, bidData);
                    recMap.set(rec.keyword.toLowerCase(), bidData);
                  }
                }
                for (const kw of batch) {
                  const bidData = recMap.get(`${kw.keywordText.toLowerCase()}:${kw.matchType.toLowerCase()}`) || recMap.get(kw.keywordText.toLowerCase());
                  if (bidData && bidData.suggestedBid > 0) {
                    await db.update(keywords).set({
                      suggestedBid: String(bidData.suggestedBid),
                      suggestedBidLow: bidData.rangeLow > 0 ? String(bidData.rangeLow) : null,
                      suggestedBidHigh: bidData.rangeHigh > 0 ? String(bidData.rangeHigh) : null
                    }).where(eq(keywords.id, kw.id));
                    keywordBidsUpdated++;
                  }
                }
              } else {
                log208.debug(`[v436] adGroup ${internalAgId} API\u8FD4\u56DE\u7A7A\u5EFA\u8BAE\u7ADE\u4EF7 (batch=${batch.length})`);
              }
            }
          } catch (err) {
            errors++;
            const errMsg = err.message || "unknown";
            log208.warn(`[v414] adGroup ${internalAgId} \u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7\u83B7\u53D6\u5931\u8D25: ${errMsg}`);
            try {
              const localRec = await getLocalKeywordBidRecommendation(
                this.accountId,
                amazonAgId,
                kwList[0]?.campaignId || "",
                "sponsoredProducts",
                0.3
              );
              if (localRec.source !== "minimum_default" && localRec.suggestedBid > 0) {
                for (const kw of kwList) {
                  await db.update(keywords).set({
                    suggestedBid: String(localRec.suggestedBid),
                    suggestedBidLow: String(localRec.rangeStart),
                    suggestedBidHigh: String(localRec.rangeEnd)
                  }).where(eq(keywords.id, kw.id));
                  keywordBidsUpdated++;
                }
                log208.info(`[v457] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u4E3AadGroup ${internalAgId} \u7684 ${kwList.length} \u4E2A\u5173\u952E\u8BCD\u63D0\u4F9B\u5EFA\u8BAE\u7ADE\u4EF7 $${localRec.suggestedBid.toFixed(2)} (${localRec.source})`);
              }
            } catch (localErr) {
              log208.debug(`[v457] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u5F02\u5E38: ${localErr.message}`);
            }
          }
        }
        log208.info(`[v414] SP\u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65\u5B8C\u6210: ${keywordBidsUpdated} \u4E2A\u5173\u952E\u8BCD\u5DF2\u66F4\u65B0`);
        log208.info("[v414] ========== \u5F00\u59CB\u540C\u6B65SP\u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7 ==========");
        const spTargetRows = await db.select({
          id: productTargets.id,
          adGroupId: productTargets.internalAdGroupId,
          targetExpression: productTargets.targetExpression,
          targetType: productTargets.targetType,
          targetValue: productTargets.targetValue,
          campaignId: campaigns.campaignId
          // v437: 添加campaignId用于Theme-Based API
        }).from(productTargets).innerJoin(adGroups, eq(productTargets.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(and(
          eq(productTargets.accountId, this.accountId),
          // v422: 修复 - campaignType枚举值是'sp_auto'/'sp_manual'，不是'sponsoredProducts'
          sql`${campaigns.campaignType} IN ('sp_auto', 'sp_manual')`,
          eq(productTargets.targetStatus, "enabled")
        ));
        log208.info(`[v414] \u67E5\u8BE2\u5230 ${spTargetRows.length} \u4E2ASP\u5546\u54C1\u5B9A\u4F4D\u9700\u8981\u83B7\u53D6\u5EFA\u8BAE\u7ADE\u4EF7`);
        const tgtByAdGroup = /* @__PURE__ */ new Map();
        for (const row of spTargetRows) {
          const agId = Number(row.adGroupId) || 0;
          if (agId === 0) continue;
          if (!tgtByAdGroup.has(agId)) tgtByAdGroup.set(agId, []);
          tgtByAdGroup.get(agId).push({
            id: row.id,
            targetExpression: row.targetExpression,
            targetType: row.targetType,
            targetValue: row.targetValue,
            campaignId: row.campaignId
          });
        }
        let tgtAdGroupIndex = 0;
        let tgtApiDelay = 2e3;
        let tgtConsecutiveSuccess = 0;
        for (const [internalAgId, tgtList] of tgtByAdGroup) {
          const amazonAgId = internalToAmazonAdGroupId.get(internalAgId);
          if (!amazonAgId) continue;
          if (tgtAdGroupIndex > 0) {
            await new Promise((resolve) => setTimeout(resolve, tgtApiDelay));
          }
          tgtAdGroupIndex++;
          try {
            const batchSize = 100;
            for (let i = 0; i < tgtList.length; i += batchSize) {
              const batch = tgtList.slice(i, i + batchSize);
              const expressions = [];
              const exprToTargetMap = /* @__PURE__ */ new Map();
              for (let j = 0; j < batch.length; j++) {
                const tgt = batch[j];
                let expr = [];
                if (tgt.targetExpression) {
                  try {
                    expr = JSON.parse(tgt.targetExpression);
                  } catch {
                    if (tgt.targetType === "asin") {
                      expr = [{ type: "asinSameAs", value: tgt.targetValue }];
                    } else {
                      expr = [{ type: "asinCategorySameAs", value: tgt.targetValue }];
                    }
                  }
                } else {
                  if (tgt.targetType === "asin") {
                    expr = [{ type: "asinSameAs", value: tgt.targetValue }];
                  } else {
                    expr = [{ type: "asinCategorySameAs", value: tgt.targetValue }];
                  }
                }
                if (expr.length > 0) {
                  expressions.push(...expr);
                  exprToTargetMap.set(expressions.length - 1, tgt);
                }
              }
              if (expressions.length === 0) continue;
              const batchCampaignId = batch[0]?.campaignId || "";
              const recommendations = await this.client.getTargetBidRecommendations(amazonAgId, expressions, batchCampaignId);
              if (recommendations && recommendations.length > 0) {
                for (let j = 0; j < Math.min(recommendations.length, batch.length); j++) {
                  const rec = recommendations[j];
                  if (rec && rec.suggestedBid && rec.suggestedBid > 0) {
                    await db.update(productTargets).set({
                      suggestedBid: String(rec.suggestedBid),
                      // @ts-ignore
                      suggestedBidLow: rec.rangeLow > 0 ? String(rec.rangeLow) : null,
                      // @ts-ignore
                      suggestedBidHigh: rec.rangeHigh > 0 ? String(rec.rangeHigh) : null
                    }).where(eq(productTargets.id, batch[j].id));
                    targetBidsUpdated++;
                  }
                }
              } else {
                log208.debug(`[v436] adGroup ${internalAgId} \u5546\u54C1\u5B9A\u4F4DAPI\u8FD4\u56DE\u7A7A\u5EFA\u8BAE\u7ADE\u4EF7 (batch=${batch.length})`);
              }
            }
            tgtConsecutiveSuccess++;
            if (tgtConsecutiveSuccess >= 5 && tgtApiDelay > 1e3) {
              tgtApiDelay = Math.max(1e3, tgtApiDelay - 500);
              tgtConsecutiveSuccess = 0;
              log208.debug(`[v522] Target\u5EFA\u8BAE\u7ADE\u4EF7\u8282\u6D41\u7F29\u51CF\u81F3 ${tgtApiDelay}ms`);
            }
          } catch (err) {
            errors++;
            const errMsg = err.message || "unknown";
            if (errMsg.includes("429") || errMsg.includes("Too Many") || errMsg.includes("HTML\u54CD\u5E94")) {
              tgtApiDelay = Math.min(8e3, tgtApiDelay * 2);
              tgtConsecutiveSuccess = 0;
              log208.warn(`[v522] Target\u5EFA\u8BAE\u7ADE\u4EF7429\u9650\u6D41\uFF0C\u5EF6\u8FDF\u52A0\u500D\u81F3 ${tgtApiDelay}ms`);
            }
            log208.warn(`[v414] adGroup ${internalAgId} \u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7\u83B7\u53D6\u5931\u8D25: ${errMsg}`);
            try {
              const localRec = await getLocalTargetBidRecommendation(
                this.accountId,
                amazonAgId,
                tgtList[0]?.campaignId || "",
                "sponsoredProducts",
                0.3
              );
              if (localRec.source !== "minimum_default" && localRec.suggestedBid > 0) {
                for (const tgt of tgtList) {
                  await db.update(productTargets).set({
                    suggestedBid: String(localRec.suggestedBid),
                    suggestedBidLow: String(localRec.rangeStart),
                    suggestedBidHigh: String(localRec.rangeEnd)
                  }).where(eq(productTargets.id, tgt.id));
                  targetBidsUpdated++;
                }
                log208.info(`[v457] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u4E3AadGroup ${internalAgId} \u7684 ${tgtList.length} \u4E2A\u5B9A\u4F4D\u63D0\u4F9B\u5EFA\u8BAE\u7ADE\u4EF7 $${localRec.suggestedBid.toFixed(2)} (${localRec.source})`);
              }
            } catch (localErr) {
              log208.debug(`[v457] Target\u672C\u5730\u63A8\u8350\u5F15\u64CE\u5F02\u5E38: ${localErr.message}`);
            }
          }
        }
        log208.info(`[v414] SP\u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65\u5B8C\u6210: ${targetBidsUpdated} \u4E2A\u5B9A\u4F4D\u5DF2\u66F4\u65B0`);
        log208.info(`[v414] ========== \u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65\u603B\u7ED3: \u5173\u952E\u8BCD=${keywordBidsUpdated}, \u5B9A\u4F4D=${targetBidsUpdated}, \u9519\u8BEF=${errors} ==========`);
        return { synced: keywordBidsUpdated + targetBidsUpdated, skipped: errors };
      } catch (error48) {
        log208.warn(`[v414] Error syncing SP bid recommendations: ${error48.message || JSON.stringify(error48)}`);
        return { synced: keywordBidsUpdated + targetBidsUpdated, skipped: errors };
      }
    };
    AmazonSyncService.prototype.syncSpBudgetRules = async function() {
      const db = await getDb();
      if (!db) return 0;
      let totalRulesSynced = 0;
      try {
        log208.info("[v424] ========== \u5F00\u59CB\u540C\u6B65SP Budget Rules ==========");
        const spCampaigns = await db.select({
          id: campaigns.id,
          campaignId: campaigns.campaignId
        }).from(campaigns).where(and(
          eq(campaigns.accountId, this.accountId),
          sql`${campaigns.campaignType} IN ('sp_auto', 'sp_manual')`,
          eq(campaigns.campaignStatus, "enabled")
        ));
        log208.info(`[v424] \u67E5\u8BE2\u5230 ${spCampaigns.length} \u4E2A\u542F\u7528\u7684SP campaigns\u9700\u8981\u83B7\u53D6budget rules`);
        if (spCampaigns.length === 0) {
          return 0;
        }
        const campaignIds = spCampaigns.map((c) => String(c.campaignId));
        const budgetRulesMap = await this.apiClient.listSpCampaignsBudgetRules(
          campaignIds,
          // @ts-ignore
          (completed, total) => {
            if (completed % 50 === 0 || completed === total) {
              log208.info(`[v424] Budget rules\u83B7\u53D6\u8FDB\u5EA6: ${completed}/${total}`);
            }
          }
        );
        const allRules = [];
        for (const [campaignId, rules] of budgetRulesMap.entries()) {
          if (rules.length > 0) {
            allRules.push({ campaignId, rules });
          }
        }
        log208.info(`[v424] \u5171 ${allRules.length} \u4E2Acampaigns\u6709budget rules`);
        for (const { campaignId, rules } of allRules) {
          for (const rule of rules) {
            try {
              const ruleId = rule.ruleId || rule.budgetRuleId || "";
              if (!ruleId) continue;
              const ruleData = {
                accountId: this.accountId,
                // @ts-ignore
                ruleId: String(ruleId),
                ruleName: rule.name || rule.ruleName || null,
                ruleType: rule.ruleType || "SCHEDULE",
                ruleStatus: rule.ruleState || rule.ruleStatus || "ACTIVE",
                adType: "sp",
                rawData: JSON.stringify(rule)
              };
              if (rule.budget) {
                ruleData.budgetIncreaseType = rule.budget.budgetIncreaseType || "PERCENT";
                ruleData.budgetIncreaseValue = rule.budget.budgetIncreaseValue || null;
              }
              if (rule.recurrence) {
                ruleData.recurrenceType = rule.recurrence.type || null;
                ruleData.recurrenceDaysOfWeek = rule.recurrence.daysOfWeek ? JSON.stringify(rule.recurrence.daysOfWeek) : null;
              }
              if (rule.duration) {
                ruleData.durationStartDate = rule.duration.dateRange?.startDate || null;
                ruleData.durationEndDate = rule.duration.dateRange?.endDate || null;
                ruleData.eventId = rule.duration.eventTypeFilter?.eventId || null;
                ruleData.eventName = rule.duration.eventTypeFilter?.eventName || null;
              }
              if (rule.performanceMeasureCondition) {
                ruleData.performanceMetricName = rule.performanceMeasureCondition.metricName || null;
                ruleData.performanceComparisonOperator = rule.performanceMeasureCondition.comparisonOperator || null;
                ruleData.performanceThreshold = rule.performanceMeasureCondition.threshold || null;
              }
              ruleData.associatedCampaignIds = JSON.stringify([campaignId]);
              ruleData.amazonCreatedDate = rule.createdDate || null;
              ruleData.amazonLastUpdatedDate = rule.lastUpdatedDate || null;
              await db.insert(campaignBudgetRules).values(ruleData).onDuplicateKeyUpdate({
                set: {
                  ruleName: sql`VALUES(rule_name)`,
                  ruleStatus: sql`VALUES(rule_status)`,
                  budgetIncreaseType: sql`VALUES(budget_increase_type)`,
                  budgetIncreaseValue: sql`VALUES(budget_increase_value)`,
                  recurrenceType: sql`VALUES(recurrence_type)`,
                  recurrenceDaysOfWeek: sql`VALUES(recurrence_days_of_week)`,
                  durationStartDate: sql`VALUES(duration_start_date)`,
                  durationEndDate: sql`VALUES(duration_end_date)`,
                  eventId: sql`VALUES(event_id)`,
                  eventName: sql`VALUES(event_name)`,
                  performanceMetricName: sql`VALUES(performance_metric_name)`,
                  performanceComparisonOperator: sql`VALUES(performance_comparison_operator)`,
                  performanceThreshold: sql`VALUES(performance_threshold)`,
                  associatedCampaignIds: sql`VALUES(associated_campaign_ids)`,
                  amazonLastUpdatedDate: sql`VALUES(amazon_last_updated_date)`,
                  rawData: sql`VALUES(raw_data)`
                }
              });
              totalRulesSynced++;
            } catch (err) {
              log208.warn(`[v424] Budget rule\u5199\u5165\u5931\u8D25: ${err.message}`);
            }
          }
        }
        log208.info("[v424] \u66F4\u65B0campaigns\u8868\u7684budget rules\u5B57\u6BB5...");
        await db.update(campaigns).set({
          hasBudgetRules: 0,
          budgetRulesCount: 0
        }).where(and(
          eq(campaigns.accountId, this.accountId),
          sql`${campaigns.campaignType} IN ('sp_auto', 'sp_manual')`
        ));
        for (const { campaignId, rules } of allRules) {
          await db.update(campaigns).set({
            hasBudgetRules: 1,
            budgetRulesCount: rules.length
          }).where(and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, campaignId)
          ));
        }
        log208.info(`[v424] ========== SP Budget Rules\u540C\u6B65\u5B8C\u6210: ${totalRulesSynced} \u6761\u89C4\u5219, ${allRules.length} \u4E2Acampaigns\u6709\u89C4\u5219 ==========`);
        return totalRulesSynced;
      } catch (error48) {
        log208.warn(`[v424] Error syncing SP budget rules: ${error48.message || JSON.stringify(error48)}`);
        return totalRulesSynced;
      }
    };
  }
});

