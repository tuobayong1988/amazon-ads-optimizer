// Extracted from production dist/index.js
// Original module: server/sync/syncSb.ts
// Lines: 1297

var log209;
var init_syncSb = __esm({
  "server/sync/syncSb.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_logger();
    init_timezone();
    init_amazonSyncService();
    init_localBidRecommendationEngine();
    log209 = createModuleLogger("syncSb");
    AmazonSyncService.prototype.syncSbCampaigns = async function(lastSyncTime) {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiCampaigns = await this.client.listSbCampaigns();
        let synced = 0;
        let skipped = 0;
        if (apiCampaigns.length > 0) {
          log209.debug("SB\u5E7F\u544A\u6D3B\u52A8API\u8FD4\u56DE\u7ED3\u6784\u793A\u4F8B:", JSON.stringify(apiCampaigns[0], null, 2));
        }
        log209.debug(`\u83B7\u53D6\u5230 ${apiCampaigns.length} \u4E2ASB\u5E7F\u544A\u6D3B\u52A8`);
        const sbCampaignIds = apiCampaigns.map((c) => String(c.campaignId));
        const existingSbCampaignRows = sbCampaignIds.length > 0 ? await db.select().from(campaigns).where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sbCampaignIds))) : [];
        const existingSbCampaignMap = new Map(existingSbCampaignRows.map((r) => [r.campaignId, r]));
        for (const apiCampaign of apiCampaigns) {
          const existing = existingSbCampaignMap.get(String(apiCampaign.campaignId)) || null;
          let dailyBudget = 0;
          if (typeof apiCampaign.budget === "number") {
            dailyBudget = apiCampaign.budget;
          } else if (apiCampaign.budget && typeof apiCampaign.budget === "object") {
            dailyBudget = apiCampaign.budget.budget || apiCampaign.budget.dailyBudget || 0;
          } else if (apiCampaign.dailyBudget) {
            dailyBudget = apiCampaign.dailyBudget;
          }
          const budgetType = (apiCampaign.budgetType || "DAILY").toLowerCase();
          const campaignState = apiCampaign.state || apiCampaign.status || "enabled";
          const validStates = ["enabled", "paused", "archived"];
          const normalizedState = validStates.includes(campaignState.toLowerCase()) ? campaignState.toLowerCase() : "enabled";
          let sbStartDate = null;
          if (apiCampaign.startDate) {
            const dateStr = String(apiCampaign.startDate);
            if (dateStr.includes("-")) {
              sbStartDate = dateStr;
            } else if (dateStr.length === 8) {
              sbStartDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
            }
          }
          let sbEndDate = null;
          if (apiCampaign.endDate) {
            const dateStr = String(apiCampaign.endDate);
            if (dateStr.includes("-")) {
              sbEndDate = dateStr;
            } else if (dateStr.length === 8) {
              sbEndDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
            }
          }
          const sbPortfolioId = apiCampaign.portfolioId ? String(apiCampaign.portfolioId) : null;
          const sbBiddingStrategy = apiCampaign.bidding?.strategy || apiCampaign.biddingStrategy || "legacyForSales";
          const sbGoal = apiCampaign.goal || apiCampaign.campaignGoal || "";
          let sbCostType = "cpc";
          if (sbGoal === "GROW_BRAND_IMPRESSION_SHARE" || sbGoal === "growBrandImpressionShare") {
            sbCostType = "vcpm";
          }
          if (sbGoal === "RESERVE_SHARE_OF_VOICE" || sbGoal === "reserveShareOfVoice") {
            sbCostType = "vcpm";
          }
          if (apiCampaign.costType) {
            const apiCostType = String(apiCampaign.costType).toLowerCase();
            if (apiCostType === "vcpm" || apiCostType === "cpm") {
              sbCostType = apiCostType;
            }
          }
          const rawAdFormat = apiCampaign.adFormat || apiCampaign.creative?.adFormat || apiCampaign.creativeType || apiCampaign.creative?.type || apiCampaign.format || null;
          const validAdFormats = ["productCollection", "video", "storeSpotlight", "brandVideo"];
          let normalizedAdFormat = validAdFormats.includes(rawAdFormat) ? rawAdFormat : null;
          if (!normalizedAdFormat && apiCampaign.name) {
            const campNameUpper = apiCampaign.name.toUpperCase();
            if (campNameUpper.includes("SBV") || campNameUpper.includes("VIDEO") || campNameUpper.includes("BRAND VIDEO")) {
              normalizedAdFormat = "video";
              log209.debug(`v436: \u4ECEcampaign\u540D\u79F0\u63A8\u65AD adFormat=video: ${apiCampaign.name}`);
            } else if (campNameUpper.includes("STORE SPOTLIGHT") || campNameUpper.includes("SPOTLIGHT")) {
              normalizedAdFormat = "storeSpotlight";
            }
          }
          log209.debug(`v436: SB campaign ${apiCampaign.name} adFormat: raw=${rawAdFormat}, normalized=${normalizedAdFormat}`);
          const sbBidOptimization = apiCampaign.bidOptimization || null;
          const validBidOpts = ["reach", "pageVisits", "conversions"];
          const normalizedBidOpt = validBidOpts.includes(sbBidOptimization) ? sbBidOptimization : null;
          const sbLandingPageType = apiCampaign.landingPage?.pageType || apiCampaign.landingPageType || null;
          const sbLandingPageUrl = apiCampaign.landingPage?.url || apiCampaign.landingPageUrl || null;
          const sbBrandEntityId = apiCampaign.brandEntityId || null;
          const biddingObj = apiCampaign.bidding;
          const bidAdjustments = biddingObj?.adjustments || [];
          let sbPlacementTopAdj = 0;
          let sbPlacementProductAdj = 0;
          let sbPlacementRestAdj = 0;
          let sbAudienceBidAdj = 0;
          for (const adj of bidAdjustments) {
            const pred = (adj.predicate || "").toLowerCase();
            const pct = adj.percentage || 0;
            if (pred.includes("top") || pred === "placementtop") {
              sbPlacementTopAdj = pct;
            } else if (pred.includes("product") || pred === "placementproductpage") {
              sbPlacementProductAdj = pct;
            } else if (pred.includes("rest") || pred === "placementrestofsearch") {
              sbPlacementRestAdj = pct;
            } else if (pred.includes("audience") || pred === "audiences") {
              sbAudienceBidAdj = pct;
            }
          }
          if (sbPlacementTopAdj === 0 && biddingObj?.placementTop) {
            sbPlacementTopAdj = Number(biddingObj.placementTop) || 0;
          }
          if (sbAudienceBidAdj === 0 && biddingObj?.audienceBidAdjustment) {
            sbAudienceBidAdj = Number(biddingObj.audienceBidAdjustment) || 0;
          }
          let sbReserveSovBudget = null;
          let sbCampaignDurationDays = null;
          if (sbGoal === "RESERVE_SHARE_OF_VOICE" || sbGoal === "reserveShareOfVoice") {
            const sovBudget = apiCampaign.reservedBudget || apiCampaign.fixedBudget || null;
            if (sovBudget) sbReserveSovBudget = String(sovBudget);
            if (sbStartDate && sbEndDate) {
              const start = new Date(sbStartDate);
              const end = new Date(sbEndDate);
              sbCampaignDurationDays = Math.ceil((end.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24));
            }
          }
          log209.debug(`SB\u5E7F\u544A ${apiCampaign.name}: goal=${sbGoal}, costType=${sbCostType}, adFormat=${normalizedAdFormat}, placementTop=${sbPlacementTopAdj}%, audienceAdj=${sbAudienceBidAdj}%`);
          const campaignData = {
            accountId: this.accountId,
            campaignId: String(apiCampaign.campaignId),
            campaignName: apiCampaign.name,
            campaignType: "sb",
            targetingType: "manual",
            dailyBudget: String(dailyBudget),
            campaignStatus: normalizedState,
            state: normalizedState,
            startDate: sbStartDate,
            endDate: sbEndDate,
            costType: sbCostType,
            // ✅ 根据Goal动态设置，而非硬编码CPC
            campaignGoal: sbGoal || null,
            // ✅ 存储原始Goal值
            adFormat: normalizedAdFormat,
            // ✅ 存储广告格式
            bidOptimization: normalizedBidOpt,
            // ✅ 存储竞价优化目标
            landingPageType: sbLandingPageType,
            landingPageUrl: sbLandingPageUrl,
            brandEntityId: sbBrandEntityId,
            portfolioId: sbPortfolioId,
            biddingStrategy: sbBiddingStrategy,
            amazonCreatedDate: sbStartDate,
            // Amazon侧创建日期
            // v500: SB版位竞价调整
            placementTopSearchBidAdjustment: sbPlacementTopAdj,
            placementProductPageBidAdjustment: sbPlacementProductAdj,
            placementRestBidAdjustment: sbPlacementRestAdj,
            // v500: SB受众竞价调整
            sbAudienceBidAdjustment: sbAudienceBidAdj,
            // @ts-ignore
            sbPlacementTopMultiplier: sbPlacementTopAdj > 0 ? String(1 + sbPlacementTopAdj / 100) : null,
            sbPlacementProductMultiplier: sbPlacementProductAdj > 0 ? String(1 + sbPlacementProductAdj / 100) : null,
            sbPlacementRestMultiplier: sbPlacementRestAdj > 0 ? String(1 + sbPlacementRestAdj / 100) : null,
            // v500: Reserve SOV特有字段
            // @ts-ignore
            sbReserveSovBudget,
            sbCampaignDurationDays,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            // @ts-ignore
          };
          Object.keys(campaignData).forEach(function(_k){ if(campaignData[_k] === undefined) delete campaignData[_k]; }); // P3v11: filter undefined in syncSbCampaigns
          try { // P3v8: per-campaign try-catch
          if (existing) {
            const localBudgetSb = parseFloat(existing.dailyBudget || "0");
            if (dailyBudget === 0 && localBudgetSb > 0) {
              log209.warn(`v168: SB\u96F6\u503C\u9884\u7B97\u9632\u62A4\u751F\u6548 - campaign=${existing.campaignName}, local=$${localBudgetSb}, api=$${dailyBudget}, \u4FDD\u7559\u672C\u5730\u9884\u7B97`);
              delete campaignData.dailyBudget;
            }
            await db.update(campaigns).set(campaignData).where(eq(campaigns.id, existing.id));
          } else {
            await db.insert(campaigns).values({
              ...campaignData,
              // @ts-ignore
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
          }
          synced++;
          } catch (_sbCampErr) {
            const _isLockTimeout = (_sbCampErr.cause?.message || _sbCampErr.message || '').includes('Lock wait timeout');
            if (_isLockTimeout) {
              log209.warn(`P3v12: SB campaign ${apiCampaign.campaignId} lock timeout, retrying in 2s...`);
              await new Promise(r => setTimeout(r, 2000));
              try {
                if (existing) {
                  await db.update(campaigns).set(campaignData).where(eq(campaigns.id, existing.id));
                } else {
                  await db.insert(campaigns).values({ ...campaignData, createdAt: (new Date()).toISOString().slice(0, 19).replace('T', ' ') });
                }
                synced++;
                log209.info(`P3v12: SB campaign ${apiCampaign.campaignId} retry succeeded`);
              } catch (_retryErr) {
                log209.warn(`P3v12: SB campaign ${apiCampaign.campaignId} retry also failed: ${_retryErr.cause?.message || _retryErr.message}`);
              }
            } else {
              log209.warn(`P3v12: SB campaign ${apiCampaign.campaignId} FAIL: ${_sbCampErr.cause?.message || _sbCampErr.message}`);
            }
          }
        }
        return { synced, skipped };
      } catch (error48) {
        log209.warn(`Error syncing SB campaigns: code=${error48.code||""} errno=${error48.errno||""} sqlState=${error48.sqlState||""} msg=${error48.message?.substring(0, 500)} sqlMsg=${error48.sqlMessage?.substring(0, 500)}`);
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSbAdGroups = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiAdGroups = await this.client.listSbAdGroups();
        let synced = 0;
        let skipped = 0;
        log209.debug(`\u83B7\u53D6\u5230 ${apiAdGroups.length} \u4E2ASB\u5E7F\u544A\u7EC4`);
        const sbAdGroupCampaignIds = [...new Set(apiAdGroups.map((ag) => String(ag.campaignId)))];
        const sbCampaignRows = sbAdGroupCampaignIds.length > 0 ? await db.select().from(campaigns).where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sbAdGroupCampaignIds))) : [];
        const sbCampaignMap = new Map(sbCampaignRows.map((r) => [r.campaignId, r]));
        const sbAdGroupIds = apiAdGroups.map((ag) => String(ag.adGroupId));
        const existingSbAdGroupRows = sbAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbAdGroupIds))) : [];
        const existingSbAdGroupMap = new Map(existingSbAdGroupRows.map((r) => [`${r.campaignId}:${r.adGroupId}`, r]));
        for (const apiAdGroup of apiAdGroups) {
          const campaign = sbCampaignMap.get(String(apiAdGroup.campaignId));
          if (!campaign) continue;
          const existing = existingSbAdGroupMap.get(`${campaign.campaignId}:${String(apiAdGroup.adGroupId)}`) || null;
          const normalizedState = (apiAdGroup.state || "enabled").toLowerCase();
          const adGroupData = {
            campaignId: campaign.campaignId,
            accountId: this.accountId,
            adGroupId: String(apiAdGroup.adGroupId),
            adGroupName: apiAdGroup.name || apiAdGroup.adGroupName || "SB Ad Group",
            adGroupStatus: normalizedState,
            defaultBid: String(apiAdGroup.bid || apiAdGroup.defaultBid || 0),
            creativeType: apiAdGroup.creativeType || null,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            await db.update(adGroups).set(adGroupData).where(eq(adGroups.id, existing.id));
          } else {
            await db.insert(adGroups).values({
              ...adGroupData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
          }
          synced++;
        }
        log209.info(`SB\u5E7F\u544A\u7EC4\u540C\u6B65\u5B8C\u6210: synced=${synced}, skipped=${skipped}`);
        return { synced, skipped };
      } catch (error48) {
        log209.warn(`Error syncing SB ad groups: ${error48.message || JSON.stringify(error48)}`);
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSbKeywords = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiKeywords = await this.client.listSbKeywords();
        let synced = 0;
        let skipped = 0;
        log209.debug(`\u83B7\u53D6\u5230 ${apiKeywords.length} \u4E2ASB\u5173\u952E\u8BCD`);
        const sbKwAdGroupIds = [...new Set(apiKeywords.map((k) => String(k.internal_ad_group_id)))];
        const sbKwAdGroupRows = sbKwAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbKwAdGroupIds))) : [];
        const sbKwAdGroupMap = new Map(sbKwAdGroupRows.map((r) => [r.adGroupId, r]));
        const sbKwIds = apiKeywords.map((k) => String(k.keywordId));
        const existingSbKwRows = sbKwIds.length > 0 ? await db.select().from(keywords).where(and(eq(keywords.accountId, this.accountId), inArray(keywords.keywordId, sbKwIds))) : [];
        const existingSbKwMap = new Map(existingSbKwRows.map((r) => [`${r.internalAdGroupId}:${r.keywordId}`, r]));
        for (const apiKeyword of apiKeywords) {
          const adGroup = sbKwAdGroupMap.get(String(apiKeyword.adGroupId));
          if (!adGroup) continue;
          const existing = existingSbKwMap.get(`${String(adGroup.id)}:${String(apiKeyword.keywordId)}`) || null;
          const normalizedMatchType = (apiKeyword.matchType || "broad").toLowerCase();
          const normalizedState = (apiKeyword.state || "enabled").toLowerCase();
          const keywordData = {
            internalAdGroupId: adGroup.id,
            // v418: ID体系重构
            accountId: this.accountId,
            campaignId: adGroup.campaignId || "",
            // v357
            keywordId: String(apiKeyword.keywordId),
            keywordText: apiKeyword.keywordText || apiKeyword.keyword || "",
            matchType: normalizedMatchType,
            bid: String(apiKeyword.bid || 0),
            keywordStatus: normalizedState,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            if (existing.keywordStatus === "amazon_deleted" && normalizedState !== "archived") {
              log209.debug(`v523.2: \u4FDD\u62A4SB(syncSb) keyword amazon_deleted\u72B6\u6001 - keyword=${existing.keywordText}(id=${existing.id})`);
              delete keywordData.keywordStatus;
            }
            await db.update(keywords).set(keywordData).where(eq(keywords.id, existing.id));
          } else {
            await db.insert(keywords).values({
              ...keywordData,
              // @ts-ignore
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            }).onDuplicateKeyUpdate({
              set: {
                bid: sql`VALUES(bid)`,
                keywordStatus: sql`VALUES(keyword_status)`,
                keywordId: sql`VALUES(keyword_id)`,
                updatedAt: sql`NOW()`
              }
            });
          }
          synced++;
        }
        log209.info(`SB\u5173\u952E\u8BCD\u540C\u6B65\u5B8C\u6210: synced=${synced}, skipped=${skipped}`);
        return { synced, skipped };
      } catch (error48) {
        const statusCode = error48?.response?.status || "unknown";
        const errorMsg = error48?.response?.data?.message || error48?.message || "unknown error";
        log209.warn(`Error syncing SB keywords: HTTP ${statusCode} - ${errorMsg}`);
        if (statusCode === 404) {
          log209.warn("[SB Sync] v332: SB keywords API\u8FD4\u56DE404\uFF0C\u8BE5\u8D26\u6237\u53EF\u80FD\u672A\u5F00\u901ASB\u5173\u952E\u8BCD\u5B9A\u5411\u6216API\u7AEF\u70B9\u5DF2\u53D8\u66F4");
        }
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSbProductTargets = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiTargets = await this.client.listSbTargets();
        let synced = 0;
        let skipped = 0;
        log209.debug(`\u83B7\u53D6\u5230 ${apiTargets.length} \u4E2ASB\u5546\u54C1\u5B9A\u4F4D`);
        const sbTgtAdGroupIds = [...new Set(apiTargets.map((t2) => String(t2.adGroupId)))];
        const sbTgtAdGroupRows = sbTgtAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbTgtAdGroupIds))) : [];
        const sbTgtAdGroupMap = new Map(sbTgtAdGroupRows.map((r) => [r.adGroupId, r]));
        const sbTgtIds = apiTargets.map((t2) => String(t2.targetId));
        const existingSbTgtRows = sbTgtIds.length > 0 ? await db.select().from(productTargets).where(and(eq(productTargets.accountId, this.accountId), inArray(productTargets.targetId, sbTgtIds))) : [];
        const existingSbTgtMap = new Map(existingSbTgtRows.map((r) => [`${r.internalAdGroupId}:${r.targetId}`, r]));
        for (const apiTarget of apiTargets) {
          const adGroup = sbTgtAdGroupMap.get(String(apiTarget.adGroupId));
          if (!adGroup) continue;
          let targetType = "category";
          let targetValue = "";
          let targetExpression = "";
          let targetMatchType = "exact";
          let categoryName = null;
          let categoryRefinements = null;
          const refinements = {};
          const exprArray = apiTarget.expression || apiTarget.expressions || [];
          if (Array.isArray(exprArray) && exprArray.length > 0) {
            targetExpression = JSON.stringify(exprArray);
            for (const expr of exprArray) {
              const et = (expr.type || "").toLowerCase();
              if (et.includes("categorysame") || et.includes("category")) {
                targetType = "category";
                targetValue = expr.value || "";
                targetMatchType = "category_exact";
              } else if (et.includes("brandsame")) {
                targetType = "category";
                targetValue = expr.value || "";
                targetMatchType = "brand_exact";
              } else if (et.includes("pricebetween") || et.includes("price")) {
                refinements.priceRange = expr.value;
              } else if (et.includes("reviewrating") || et.includes("star") || et.includes("rating")) {
                refinements.starRating = expr.value;
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
              } else if (et.includes("asin") && et.includes("same")) {
                targetType = "asin";
                targetValue = expr.value || "";
                targetMatchType = "exact";
              } else if (et.includes("broadrel") || et.includes("broad_rel") || et.includes("loose")) {
                targetValue = expr.value || "AUTO_LOOSE";
                targetMatchType = "loose";
              } else if (et.includes("highrel") || et.includes("high_rel") || et.includes("close")) {
                targetValue = expr.value || "AUTO_CLOSE";
                targetMatchType = "close";
              } else if (expr.value && !targetValue) {
                targetValue = expr.value;
              }
            }
            if (Object.keys(refinements).length > 0) {
              categoryRefinements = JSON.stringify(refinements);
            }
          } else if (typeof exprArray === "string") {
            targetExpression = exprArray;
          }
          const existing = existingSbTgtMap.get(`${String(adGroup.id)}:${String(apiTarget.targetId)}`) || null;
          const normalizedState = (apiTarget.state || "enabled").toLowerCase();
          if (!targetValue) {
            const exprTypes = Array.isArray(exprArray) ? exprArray.map((e) => e.type || "").join(",") : "";
            targetValue = exprTypes || `AUTO_${String(apiTarget.targetId)}`;
          }
          const targetData = {
            accountId: this.accountId,
            internalAdGroupId: adGroup.id,
            // v418: ID体系重构
            campaignId: adGroup.campaignId || "",
            // v357
            targetId: String(apiTarget.targetId),
            targetType,
            targetValue,
            targetExpression,
            targetMatchType,
            bid: String(typeof apiTarget.bid === "object" && apiTarget.bid !== null ? apiTarget.bid.amount || 0 : apiTarget.bid || 0),
            targetStatus: normalizedState,
            categoryName,
            categoryRefinements,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (synced === 0) {
            log209.debug(`SB\u4EA7\u54C1\u5B9A\u5411\u793A\u4F8B: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
          }
          if (existing) {
            if (existing.targetStatus === "amazon_deleted" && normalizedState !== "archived") {
              log209.debug(`v523.2: \u4FDD\u62A4SB(syncSb) target amazon_deleted\u72B6\u6001 - target=${existing.targetValue}(id=${existing.id})`);
              delete targetData.targetStatus;
            }
            await db.update(productTargets).set(targetData).where(eq(productTargets.id, existing.id));
          } else {
            await db.insert(productTargets).values({
              ...targetData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
          }
          synced++;
        }
        log209.info(`SB\u5546\u54C1\u5B9A\u4F4D\u540C\u6B65\u5B8C\u6210: synced=${synced}, skipped=${skipped}`);
        return { synced, skipped };
      } catch (error48) {
        const statusCode = error48?.response?.status || "unknown";
        const errorMsg = error48?.response?.data?.message || error48?.message || "unknown error";
        log209.warn(`Error syncing SB product targets: HTTP ${statusCode} - ${errorMsg}`);
        if (statusCode === 404) {
          log209.warn("[SB Sync] v332: SB targets API\u8FD4\u56DE404\uFF0C\u8BE5\u8D26\u6237\u53EF\u80FD\u672A\u5F00\u901ASB\u5546\u54C1\u5B9A\u5411\u6216API\u7AEF\u70B9\u5DF2\u53D8\u66F4");
        }
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSbSearchTerms = async function(days = 14) {
      const db = await getDb();
      if (!db) throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
      try {
        const MAX_DAYS_PER_REQUEST = 31;
        const totalDays = Math.min(days, 60);
        const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
        const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
        log209.info(`v339: \u5F00\u59CB\u540C\u6B65SB\u641C\u7D22\u8BCD\u6570\u636E: \u5171${totalDays}\u5929\uFF0C\u5206${batches}\u6279\u8BF7\u6C42 (\u7AD9\u70B9: ${this.marketplace})`);
        let allReportData = [];
        if (batches === 1) {
          try {
            const reportId = await this.client.requestSbSearchTermReport(rangeStartDate, rangeEndDate);
            const data = await this.client.waitAndDownloadReport(reportId, 6e5);
            if (data && data.length > 0) allReportData = data;
          } catch (e) {
            log209.warn(`v449: SB\u641C\u7D22\u8BCD\u62A5\u544A\u8BF7\u6C42\u5931\u8D25:`, e.message);
          }
        } else {
          const batchRequests = [];
          for (let batch = 0; batch < batches; batch++) {
            const endDateObj = new Date(rangeEndDate);
            endDateObj.setDate(endDateObj.getDate() - batch * MAX_DAYS_PER_REQUEST);
            const startDateObj = new Date(endDateObj);
            const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - batch * MAX_DAYS_PER_REQUEST);
            startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
            const bStart = startDateObj.toISOString().split("T")[0];
            const bEnd = endDateObj.toISOString().split("T")[0];
            batchRequests.push({
              name: `SB\u641C\u7D22\u8BCD\u7B2C${batch + 1}/${batches}\u6279(${bStart}~${bEnd})`,
              requestFn: /* @__PURE__ */ __name(() => this.client.requestSbSearchTermReport(bStart, bEnd), "requestFn")
              // @ts-ignore
            });
          }
          log209.info(`[v413] SB\u641C\u7D22\u8BCD: ${batches}\u6279\u6B21\u6279\u91CF\u63D0\u4EA4\u5F00\u59CB`);
          const results = await this.client.submitAndWaitMultipleReports(batchRequests, 12e5, 2e3);
          for (const result of results) {
            if (result.data && result.data.length > 0) {
              allReportData = allReportData.concat(result.data);
            } else if (result.error) {
              log209.warn(`[v413] ${result.name}\u5931\u8D25: ${result.error}`);
            }
          }
        }
        const startDate = rangeStartDate;
        const endDate = rangeEndDate;
        const reportData = allReportData;
        if (!reportData || reportData.length === 0) {
          log209.debug("v339: \u6240\u6709\u6279\u6B21SB\u641C\u7D22\u8BCD\u62A5\u544A\u6570\u636E\u4E3A\u7A7A");
          return 0;
        }
        log209.info(`v339: \u5171\u83B7\u53D6\u5230 ${reportData.length} \u6761SB\u641C\u7D22\u8BCD\u6570\u636E\uFF08${batches}\u6279\u5408\u5E76\uFF09`);
        const allCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId }).from(campaigns).where(eq(campaigns.accountId, this.accountId));
        const campaignMap = /* @__PURE__ */ new Map();
        for (const c of allCampaigns) {
          campaignMap.set(String(c.campaignId), { id: c.id, campaignId: c.campaignId });
        }
        const allAdGroups = await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups).where(eq(adGroups.accountId, this.accountId));
        const adGroupMap = /* @__PURE__ */ new Map();
        for (const ag of allAdGroups) {
          adGroupMap.set(String(ag.adGroupId), { id: ag.id });
        }
        const allKeywords = await db.select({ id: keywords.id, adGroupId: keywords.internalAdGroupId, keywordText: keywords.keywordText, matchType: keywords.matchType }).from(keywords).where(eq(keywords.accountId, this.accountId));
        const keywordMap = /* @__PURE__ */ new Map();
        for (const kw of allKeywords) {
          const key = `${kw.adGroupId}:${(kw.keywordText || "").toLowerCase()}`;
          keywordMap.set(key, { id: kw.id, matchType: kw.matchType });
        }
        const allTargets = await db.select({ id: productTargets.id, adGroupId: productTargets.internalAdGroupId, targetValue: productTargets.targetValue, targetMatchType: productTargets.targetMatchType }).from(productTargets).where(eq(productTargets.accountId, this.accountId));
        const targetMap = /* @__PURE__ */ new Map();
        for (const t2 of allTargets) {
          const key = `${t2.adGroupId}:${(t2.targetValue || "").toLowerCase()}`;
          targetMap.set(key, { id: t2.id, targetMatchType: t2.targetMatchType });
        }
        log209.info(`[v395] SB\u641C\u7D22\u8BCD\u9884\u52A0\u8F7D\u5B8C\u6210: campaigns=${allCampaigns.length}, adGroups=${allAdGroups.length}, keywords=${allKeywords.length}, targets=${allTargets.length}`);
        let synced = 0;
        let skipped = 0;
        const BATCH_SIZE = 500;
        let upsertBatch = [];
        const nowStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
        for (const row of reportData) {
          const campaign = campaignMap.get(String(row.campaignId));
          if (!campaign) {
            skipped++;
            continue;
          }
          const adGroup = adGroupMap.get(String(row.adGroupId));
          if (!adGroup) {
            skipped++;
            continue;
          }
          const cost = row.cost || 0;
          const sales = row.sales || row.salesClicks || 0;
          const clicks = row.clicks || 0;
          const impressions = row.impressions || 0;
          const orders = row.purchases || row.purchasesClicks || 0;
          const targetingText = row.keywordText || row.targeting || "";
          const matchType = (row.matchType || "").toLowerCase();
          const isProductTarget = matchType === "targeting";
          let searchTermTargetId = null;
          let resolvedMatchType = matchType;
          if (!isProductTarget) {
            const kwKey = `${adGroup.id}:${targetingText.toLowerCase()}`;
            const matchedKeyword = keywordMap.get(kwKey);
            if (matchedKeyword) {
              searchTermTargetId = matchedKeyword.id;
              resolvedMatchType = matchedKeyword.matchType || matchType;
            }
          } else {
            const tKey = `${adGroup.id}:${targetingText.toLowerCase()}`;
            const matchedTarget = targetMap.get(tKey);
            if (matchedTarget) {
              searchTermTargetId = matchedTarget.id;
              resolvedMatchType = matchedTarget.targetMatchType || "targeting";
            }
          }
          const searchTermText = row.searchTerm || "";
          const isAsinSearchTerm2 = /^[Bb]0[A-Za-z0-9]{8,}$/.test(searchTermText.trim());
          const searchTermType = isAsinSearchTerm2 ? "asin" : "keyword";
          const sourceMatchType = resolvedMatchType;
          const sourceTargetType = isProductTarget ? "product_target" : "keyword";
          const unitsOrdered = row.unitsSold7d || row.unitsSold14d || row.unitsSold || row.unitsSoldClicks || 0;
          const rowDate = row.date || startDate;
          upsertBatch.push({
            accountId: this.accountId,
            campaignId: campaign.campaignId,
            internalAdGroupId: adGroup.id,
            // v418: ID体系重构
            searchTerm: searchTermText,
            searchTermTargetType: isProductTarget ? "product_target" : "keyword",
            searchTermTargetId,
            targetText: targetingText,
            searchTermMatchType: resolvedMatchType,
            searchTermImpressions: impressions,
            searchTermClicks: clicks,
            // @ts-ignore
            searchTermSpend: String(cost),
            searchTermSales: String(sales),
            searchTermOrders: orders,
            searchTermAcos: sales > 0 ? String(cost / sales * 100) : null,
            searchTermRoas: cost > 0 ? String(sales / cost) : null,
            searchTermCtr: impressions > 0 ? String(clicks / impressions) : null,
            searchTermCvr: clicks > 0 ? String(orders / clicks) : null,
            searchTermCpc: clicks > 0 ? String(cost / clicks) : null,
            reportStartDate: rowDate,
            reportEndDate: rowDate,
            sourceMatchType,
            sourceTargetType,
            searchTermType,
            searchTermUnitsOrdered: unitsOrdered,
            // v614: 写入campaign_type字段
            campaignType: "sb",
            createdAt: nowStr,
            updatedAt: nowStr
          });
          if (upsertBatch.length >= BATCH_SIZE) {
            await flushSearchTermBatch(db, upsertBatch);
            synced += upsertBatch.length;
            upsertBatch = [];
          }
        }
        if (upsertBatch.length > 0) {
          await flushSearchTermBatch(db, upsertBatch);
          synced += upsertBatch.length;
          upsertBatch = [];
        }
        log209.info(`[v395] SB\u641C\u7D22\u8BCD\u540C\u6B65\u5B8C\u6210: \u540C\u6B65=${synced}, \u8DF3\u8FC7=${skipped}`);
        return synced;
      } catch (error48) {
        log209.warn(`\u540C\u6B65SB\u641C\u7D22\u8BCD\u5931\u8D25: ${error48.message || JSON.stringify(error48)}`);
        throw error48;
      }
    };
    AmazonSyncService.prototype.syncSbTargeting = async function(days = 14) {
      const db = await getDb();
      if (!db) throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
      try {
        const MAX_DAYS_PER_REQUEST = 31;
        const totalDays = Math.min(days, 60);
        const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
        const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
        log209.info(`v339: \u5F00\u59CB\u540C\u6B65SB\u5B9A\u5411\u6570\u636E: \u5171${totalDays}\u5929\uFF0C\u5206${batches}\u6279\u8BF7\u6C42 (\u7AD9\u70B9: ${this.marketplace})`);
        let allReportData = [];
        if (batches === 1) {
          try {
            const reportId = await this.client.requestSbTargetingReport(rangeStartDate, rangeEndDate);
            const data = await this.client.waitAndDownloadReport(reportId, 6e5);
            if (data && data.length > 0) allReportData = data;
          } catch (e) {
            log209.warn(`v449: SB\u5B9A\u5411\u62A5\u544A\u8BF7\u6C42\u5931\u8D25:`, e.message);
          }
        } else {
          const batchRequests = [];
          for (let batch = 0; batch < batches; batch++) {
            const endDateObj = new Date(rangeEndDate);
            endDateObj.setDate(endDateObj.getDate() - batch * MAX_DAYS_PER_REQUEST);
            const startDateObj = new Date(endDateObj);
            const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - batch * MAX_DAYS_PER_REQUEST);
            startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
            const bStart = startDateObj.toISOString().split("T")[0];
            const bEnd = endDateObj.toISOString().split("T")[0];
            batchRequests.push({
              name: `SB\u5B9A\u5411\u7B2C${batch + 1}/${batches}\u6279(${bStart}~${bEnd})`,
              requestFn: /* @__PURE__ */ __name(() => this.client.requestSbTargetingReport(bStart, bEnd), "requestFn")
            });
          }
          log209.info(`[v413] SB\u5B9A\u5411: ${batches}\u6279\u6B21\u6279\u91CF\u63D0\u4EA4\u5F00\u59CB`);
          const results = await this.client.submitAndWaitMultipleReports(batchRequests, 12e5, 2e3);
          for (const result of results) {
            if (result.data && result.data.length > 0) {
              allReportData = allReportData.concat(result.data);
            } else if (result.error) {
              log209.warn(`[v413] ${result.name}\u5931\u8D25: ${result.error}`);
            }
          }
        }
        const reportData = allReportData;
        if (!reportData || reportData.length === 0) {
          log209.debug("v339: \u6240\u6709\u6279\u6B21SB\u5B9A\u5411\u62A5\u544A\u6570\u636E\u4E3A\u7A7A");
          return 0;
        }
        log209.info(`v339: \u5171\u83B7\u53D6\u5230 ${reportData.length} \u6761SB\u5B9A\u5411\u6570\u636E\uFF08${batches}\u6279\u5408\u5E76\uFF09`);
        let synced = 0;
        const sbRptAdGroupIds = [...new Set(reportData.map((r) => String(r.adGroupId)))];
        const sbRptAdGroupRows = sbRptAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbRptAdGroupIds))) : [];
        const sbRptAdGroupMap = new Map(sbRptAdGroupRows.map((r) => [r.adGroupId, r]));
        const sbRptInternalAgIds = sbRptAdGroupRows.map((r) => r.id);
        const existingSbKwRows = sbRptInternalAgIds.length > 0 ? await db.select().from(keywords).where(and(
          eq(keywords.accountId, this.accountId),
          inArray(keywords.internalAdGroupId, sbRptInternalAgIds)
        )) : [];
        const existingSbKwByTextMatch = /* @__PURE__ */ new Map();
        const existingSbKwByText = /* @__PURE__ */ new Map();
        for (const r of existingSbKwRows) {
          if (r.keywordText && r.matchType) {
            existingSbKwByTextMatch.set(`${r.internalAdGroupId}:${r.keywordText.toLowerCase()}:${r.matchType.toLowerCase()}`, r);
          }
          if (r.keywordText) {
            existingSbKwByText.set(`${r.internalAdGroupId}:${r.keywordText.toLowerCase()}`, r);
          }
        }
        for (const row of reportData) {
          const adGroup = sbRptAdGroupMap.get(String(row.adGroupId));
          if (!adGroup) continue;
          const targetingText = row.targetingText || "";
          const matchType = (row.matchType || "broad").toLowerCase();
          if (!targetingText) continue;
          const existing = existingSbKwByTextMatch.get(`${adGroup.id}:${targetingText.toLowerCase()}:${matchType}`) || existingSbKwByText.get(`${adGroup.id}:${targetingText.toLowerCase()}`) || null;
          const cost = row.cost || 0;
          const sales = row.salesClicks || 0;
          const clicks = row.clicks || 0;
          const impressions = row.impressions || 0;
          const orders = row.purchasesClicks || 0;
          const keywordData = {
            internalAdGroupId: adGroup.id,
            accountId: this.accountId,
            campaignId: adGroup.campaignId || "",
            // v422: 如果匹配到已有记录，保留其keywordId；否则用targetingText作为临时标识
            keywordId: existing?.keywordId || `text:${targetingText}`,
            keywordText: targetingText,
            matchType,
            bid: existing?.bid || "0.00",
            // 保留已有的bid
            impressions,
            clicks,
            spend: String(cost),
            sales: String(sales),
            orders,
            keywordAcos: sales > 0 ? String((cost / sales * 100).toFixed(2)) : null,
            keywordCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
            keywordCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
            keywordCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
            keywordRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
            keywordStatus: "enabled",
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            if (existing.keywordStatus === "amazon_deleted") {
              log209.debug(`v523.2: \u4FDD\u62A4SB\u7EE9\u6548\u540C\u6B65 keyword amazon_deleted\u72B6\u6001 - id=${existing.id}`);
              delete keywordData.keywordStatus;
            }
            await db.update(keywords).set(keywordData).where(eq(keywords.id, existing.id));
          } else {
            await db.insert(keywords).values({
              // @ts-ignore
              ...keywordData,
              // @ts-ignore
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
              // @ts-ignore
            }).onDuplicateKeyUpdate({
              set: {
                bid: sql`VALUES(bid)`,
                keywordStatus: sql`VALUES(keyword_status)`,
                keywordId: sql`VALUES(keyword_id)`,
                updatedAt: sql`NOW()`
              }
            });
          }
          synced++;
        }
        log209.info(`SB\u5B9A\u5411\u540C\u6B65\u5B8C\u6210: ${synced} \u6761\u8BB0\u5F55`);
        return synced;
      } catch (error48) {
        log209.warn(`\u540C\u6B65SB\u5B9A\u5411\u5931\u8D25: ${error48.message || JSON.stringify(error48)}`);
        throw error48;
      }
    };
    AmazonSyncService.prototype.syncSbAds = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiAds = await this.client.listSbAds();
        let synced = 0;
        let skipped = 0;
        log209.debug(`\u83B7\u53D6\u5230 ${apiAds.length} \u4E2ASB\u5E7F\u544A\u7D20\u6750`);
        if (apiAds.length > 0) {
          log209.debug("SB\u5E7F\u544A\u7D20\u6750API\u8FD4\u56DE\u7ED3\u6784\u793A\u4F8B:", JSON.stringify(apiAds[0], null, 2));
        }
        const sbAdAdGroupIds = [...new Set(apiAds.map((a) => String(a.adGroupId)))];
        const sbAdAdGroupRows = sbAdAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbAdAdGroupIds))) : [];
        const sbAdAdGroupMap = new Map(sbAdAdGroupRows.map((r) => [r.adGroupId, r]));
        for (const ad of apiAds) {
          const adGroupIdStr = String(ad.adGroupId);
          const adGroup = sbAdAdGroupMap.get(adGroupIdStr) || null;
          if (!adGroup) {
            skipped++;
            continue;
          }
          const creative = ad.creative || ad;
          const headline = creative.headline || ad.headline || null;
          const brandLogoAssetId = creative.brandLogoAssetID || creative.brandLogoAssetId || // @ts-ignore
          creative.brandLogo?.assetId || null;
          const customImageAssetId = creative.customImageAssetID || creative.customImageAssetId || // @ts-ignore
          creative.customImage?.assetId || null;
          const videoAssetId = creative.video?.assetId || creative.videoAssetId || null;
          const creativeType = ad.creativeType || creative.type || null;
          const updateData = {
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (headline) updateData.headline = headline;
          if (brandLogoAssetId) updateData.brandLogoAssetId = brandLogoAssetId;
          if (customImageAssetId) updateData.customImageAssetId = customImageAssetId;
          if (videoAssetId) updateData.videoAssetId = videoAssetId;
          if (creativeType) updateData.creativeType = creativeType;
          await db.update(adGroups).set(updateData).where(eq(adGroups.id, adGroup.id));
          synced++;
        }
        log209.info(`SB\u5E7F\u544A\u7D20\u6750\u540C\u6B65\u5B8C\u6210: synced=${synced}, skipped=${skipped}`);
        return { synced, skipped };
      } catch (error48) {
        log209.warn("SB\u5E7F\u544A\u7D20\u6750\u540C\u6B65\u5931\u8D25:", error48.message);
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSbNegativeKeywords = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, updated: 0 };
      try {
        let synced = 0;
        let updated = 0;
        const sbNegatives = await this.client.listSbNegativeKeywords();
        log209.debug(`\u83B7\u53D6\u5230 ${sbNegatives.length} \u4E2ASB\u5426\u5B9A\u5173\u952E\u8BCD`);
        const sbNegCampaignIds = [...new Set(sbNegatives.map((n) => String(n.campaignId)))];
        const sbNegCampaignRows = sbNegCampaignIds.length > 0 ? await db.select().from(campaigns).where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sbNegCampaignIds))) : [];
        const sbNegCampaignMap = new Map(sbNegCampaignRows.map((r) => [r.campaignId, r]));
        const sbNegAdGroupIds = [...new Set(sbNegatives.filter((n) => n.adGroupId).map((n) => String(n.adGroupId)))];
        const sbNegAdGroupRows = sbNegAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbNegAdGroupIds))) : [];
        const sbNegAdGroupMap = new Map(sbNegAdGroupRows.map((r) => [r.adGroupId, r]));
        for (const neg of sbNegatives) {
          const negState = (neg.state || "enabled").toLowerCase();
          if (negState === "archived") continue;
          const campaign = sbNegCampaignMap.get(String(neg.campaignId));
          if (!campaign) continue;
          let internalAdGroupId = null;
          if (neg.adGroupId) {
            const adGroup = sbNegAdGroupMap.get(String(neg.adGroupId));
            if (adGroup) internalAdGroupId = adGroup.id;
          }
          const matchType = (neg.matchType || "").toLowerCase().includes("phrase") ? "negative_phrase" : "negative_exact";
          const amazonKeywordId = String(neg.keywordId || neg.negativeKeywordId || "");
          const negLevel = internalAdGroupId ? "ad_group" : "campaign";
          const [existing] = await db.select().from(negativeKeywords).where(
            and(
              // @ts-ignore
              eq(negativeKeywords.accountId, this.accountId),
              eq(negativeKeywords.campaignId, String(campaign.campaignId)),
              eq(negativeKeywords.negativeLevel, negLevel),
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
              internalAdGroupId,
              negativeLevel: negLevel,
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
        log209.info(`SB\u5426\u5B9A\u5173\u952E\u8BCD\u540C\u6B65\u5B8C\u6210: ${synced}\u6761\u65B0\u589E, ${updated}\u6761\u66F4\u65B0`);
        return { synced, updated };
      } catch (error48) {
        log209.warn("SB\u5426\u5B9A\u5173\u952E\u8BCD\u540C\u6B65\u5931\u8D25:", error48.message);
        return { synced: 0, updated: 0 };
      }
    };
    AmazonSyncService.prototype.syncSbNegativeTargets = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, updated: 0 };
      try {
        let synced = 0;
        let updated = 0;
        const sbNegTargets = await this.client.listSbNegativeTargets();
        log209.debug(`\u83B7\u53D6\u5230 ${sbNegTargets.length} \u4E2ASB\u5426\u5B9A\u5546\u54C1\u5B9A\u5411`);
        const sbNegTgtCampaignIds = [...new Set(sbNegTargets.map((n) => String(n.campaignId)))];
        const sbNegTgtCampaignRows = sbNegTgtCampaignIds.length > 0 ? await db.select().from(campaigns).where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sbNegTgtCampaignIds))) : [];
        const sbNegTgtCampaignMap = new Map(sbNegTgtCampaignRows.map((r) => [r.campaignId, r]));
        const sbNegTgtAdGroupIds = [...new Set(sbNegTargets.filter((n) => n.adGroupId).map((n) => String(n.adGroupId)))];
        const sbNegTgtAdGroupRows = sbNegTgtAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbNegTgtAdGroupIds))) : [];
        const sbNegTgtAdGroupMap = new Map(sbNegTgtAdGroupRows.map((r) => [r.adGroupId, r]));
        for (const neg of sbNegTargets) {
          const negState = (neg.state || "enabled").toLowerCase();
          if (negState === "archived") continue;
          const campaign = sbNegTgtCampaignMap.get(String(neg.campaignId));
          if (!campaign) continue;
          let internalAdGroupId = null;
          if (neg.adGroupId) {
            const adGroup = sbNegTgtAdGroupMap.get(String(neg.adGroupId));
            if (adGroup) internalAdGroupId = adGroup.id;
          }
          const expression = neg.expression || [];
          const asinExpr = expression.find((e) => e.type?.toLowerCase().includes("asin"));
          const negativeText = asinExpr?.value || JSON.stringify(expression);
          const amazonTargetId = String(neg.targetId || "");
          const negLevel = internalAdGroupId ? "ad_group" : "campaign";
          const [existing] = await db.select().from(negativeKeywords).where(
            and(
              eq(negativeKeywords.accountId, this.accountId),
              eq(negativeKeywords.campaignId, String(campaign.campaignId)),
              eq(negativeKeywords.negativeLevel, negLevel),
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
              internalAdGroupId,
              negativeLevel: negLevel,
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
        log209.info(`SB\u5426\u5B9A\u5546\u54C1\u5B9A\u5411\u540C\u6B65\u5B8C\u6210: ${synced}\u6761\u65B0\u589E, ${updated}\u6761\u66F4\u65B0`);
        return { synced, updated };
      } catch (error48) {
        log209.warn("SB\u5426\u5B9A\u5546\u54C1\u5B9A\u5411\u540C\u6B65\u5931\u8D25:", error48.message);
        return { synced: 0, updated: 0 };
      }
    };
    AmazonSyncService.prototype.syncSbPlacementPerformance = async function(days = 14) {
      const db = await getDb();
      if (!db) throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
      let synced = 0;
      try {
        const MAX_DAYS_PER_REQUEST = 31;
        const totalDays = Math.min(days, 60);
        const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
        const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
        log209.info(`v339: \u5F00\u59CB\u540C\u6B65SB\u5E7F\u544A\u4F4D\u7EE9\u6548: \u5171${totalDays}\u5929\uFF0C\u5206${batches}\u6279\u8BF7\u6C42 (\u7AD9\u70B9: ${this.marketplace})`);
        let allReportData = [];
        if (batches === 1) {
          try {
            const reportId = await this.client.requestSbCampaignPlacementReport(rangeStartDate, rangeEndDate);
            const data = await this.client.waitAndDownloadReport(reportId);
            if (data && data.length > 0) allReportData = data;
          } catch (e) {
            log209.warn(`v413: SB\u5E7F\u544A\u4F4D\u62A5\u544A\u8BF7\u6C42\u5931\u8D25:`, e.message);
          }
        } else {
          const batchRequests = [];
          for (let batch = 0; batch < batches; batch++) {
            const endDateObj = new Date(rangeEndDate);
            endDateObj.setDate(endDateObj.getDate() - batch * MAX_DAYS_PER_REQUEST);
            const startDateObj = new Date(endDateObj);
            const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - batch * MAX_DAYS_PER_REQUEST);
            startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
            const bStart = startDateObj.toISOString().split("T")[0];
            const bEnd = endDateObj.toISOString().split("T")[0];
            batchRequests.push({
              name: `SB\u5E7F\u544A\u4F4D\u7B2C${batch + 1}/${batches}\u6279(${bStart}~${bEnd})`,
              requestFn: /* @__PURE__ */ __name(() => this.client.requestSbCampaignPlacementReport(bStart, bEnd), "requestFn")
            });
          }
          log209.info(`[v413] SB\u5E7F\u544A\u4F4D: ${batches}\u6279\u6B21\u6279\u91CF\u63D0\u4EA4\u5F00\u59CB`);
          const results = await this.client.submitAndWaitMultipleReports(batchRequests, 12e5, 2e3);
          for (const result of results) {
            if (result.data && result.data.length > 0) {
              allReportData = allReportData.concat(result.data);
            } else if (result.error) {
              log209.warn(`[v413] ${result.name}\u5931\u8D25: ${result.error}`);
            }
          }
        }
        const reportData = allReportData;
        if (!reportData || reportData.length === 0) {
          log209.debug("v339: \u6240\u6709\u6279\u6B21SB\u5E7F\u544A\u4F4D\u62A5\u544A\u6570\u636E\u4E3A\u7A7A");
          return 0;
        }
        log209.info(`v339: \u5171\u83B7\u53D6\u5230 ${reportData.length} \u6761SB\u5E7F\u544A\u4F4D\u6570\u636E\uFF08${batches}\u6279\u5408\u5E76\uFF09`);
        for (const row of reportData) {
          const campaignIdStr = String(row.campaignId);
          const [campaign] = await db.select().from(campaigns).where(
            and(
              eq(campaigns.accountId, this.accountId),
              eq(campaigns.campaignId, campaignIdStr)
            )
          ).limit(1);
          if (!campaign) continue;
          const dateStr = row.date || rangeStartDate;
          const rawPlacement = row.placementClassification || row.placement || "OTHER";
          const placementMap = {
            "TOP_OF_SEARCH": "top_of_search",
            "DETAIL_PAGE": "product_page",
            "OTHER": "rest_of_search"
          };
          const placement = placementMap[rawPlacement] || "rest_of_search";
          const localCampaignId2 = String(campaign.campaignId);
          const [existing] = await db.select().from(placementPerformance).where(
            // @ts-ignore
            and(
              eq(placementPerformance.campaignId, localCampaignId2),
              eq(placementPerformance.accountId, this.accountId),
              eq(placementPerformance.placement, placement),
              eq(placementPerformance.date, dateStr)
            )
          ).limit(1);
          const cost = parseFloat(row.cost || row.spend || "0");
          const sales = parseFloat(row.sales || row.attributedSales14d || "0");
          const clicks = parseInt(row.clicks || "0");
          const impressions = parseInt(row.impressions || "0");
          const orders = parseInt(row.orders || row.attributedConversions14d || "0");
          const perfData = {
            campaignId: localCampaignId2,
            accountId: this.accountId,
            placement,
            date: dateStr,
            impressions,
            clicks,
            spend: String(cost),
            sales: String(sales),
            orders,
            ctr: impressions > 0 ? String(clicks / impressions) : null,
            cpc: clicks > 0 ? String(cost / clicks) : null,
            cvr: clicks > 0 ? String(orders / clicks) : null,
            acos: sales > 0 ? String(cost / sales * 100) : null,
            roas: cost > 0 ? String(sales / cost) : null,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          await db.insert(placementPerformance).values({
            ...perfData,
            createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          }).onDuplicateKeyUpdate({
            set: {
              impressions: perfData.impressions,
              clicks: perfData.clicks,
              spend: perfData.spend,
              sales: perfData.sales,
              orders: perfData.orders,
              ctr: perfData.ctr,
              cpc: perfData.cpc,
              cvr: perfData.cvr,
              acos: perfData.acos,
              roas: perfData.roas,
              updatedAt: perfData.updatedAt
            }
          });
          synced++;
        }
        log209.info(`SB\u5E7F\u544A\u4F4D\u7EE9\u6548\u540C\u6B65\u5B8C\u6210: ${synced}\u6761`);
      } catch (error48) {
        log209.warn("SB\u5E7F\u544A\u4F4D\u7EE9\u6548\u540C\u6B65\u5931\u8D25:", error48.message);
      }
      return synced;
    };
    AmazonSyncService.prototype.syncSbBidRecommendations = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      let keywordBidsUpdated = 0;
      let targetBidsUpdated = 0;
      let errors = 0;
      try {
        log209.info("[v417] ========== \u5F00\u59CB\u540C\u6B65SB\u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7 ==========");
        const sbKeywordRows = await db.select({
          id: keywords.id,
          campaignId: keywords.campaignId,
          internalAdGroupId: keywords.internalAdGroupId,
          amazonAdGroupId: adGroups.adGroupId,
          keywordText: keywords.keywordText,
          matchType: keywords.matchType
        }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(and(
          eq(keywords.accountId, this.accountId),
          eq(campaigns.campaignType, "sb"),
          eq(keywords.keywordStatus, "enabled")
        ));
        log209.info(`[v515] \u67E5\u8BE2\u5230 ${sbKeywordRows.length} \u4E2ASB\u5173\u952E\u8BCD\u9700\u8981\u83B7\u53D6\u5EFA\u8BAE\u7ADE\u4EF7`);
        const kwByCampaign = /* @__PURE__ */ new Map();
        for (const row of sbKeywordRows) {
          const cId = row.campaignId || "";
          if (!kwByCampaign.has(cId)) kwByCampaign.set(cId, []);
          kwByCampaign.get(cId).push({ id: row.id, keywordText: row.keywordText, matchType: row.matchType, amazonAdGroupId: row.amazonAdGroupId || "" });
        }
        const internalCampaignIds = [...kwByCampaign.keys()];
        const campaignMappingRows = internalCampaignIds.length > 0 ? await db.select({ id: campaigns.id, campaignId: campaigns.campaignId }).from(campaigns).where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, internalCampaignIds))) : [];
        const campaignIdMap = new Map(campaignMappingRows.map((r) => [r.campaignId, r.campaignId]));
        for (const [campaignId, kwList] of kwByCampaign) {
          const amazonCampaignId = campaignIdMap.get(campaignId);
          if (!amazonCampaignId) {
            log209.debug(`[v515] campaign ${campaignId} \u65E0\u6620\u5C04\uFF0C\u8DF3\u8FC7`);
            continue;
          }
          let apiSucceeded = false;
          try {
            const batchSize = 100;
            for (let i = 0; i < kwList.length; i += batchSize) {
              const batch = kwList.slice(i, i + batchSize);
              const apiKeywords = batch.map((kw) => ({
                keyword: kw.keywordText,
                matchType: kw.matchType.toUpperCase()
              }));
              const recommendations = await this.client.getSbBidRecommendations(amazonCampaignId, apiKeywords);
              log209.info(`[v515] SB\u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7API\u8FD4\u56DE: campaignId=${amazonCampaignId}, \u8BF7\u6C42=${batch.length}, \u8FD4\u56DE=${recommendations?.length || 0}`);
              if (recommendations && recommendations.length > 0) {
                apiSucceeded = true;
                const recMap = /* @__PURE__ */ new Map();
                for (const rec of recommendations) {
                  if (rec.keyword && rec.suggestedBid) {
                    const bidData = {
                      suggestedBid: rec.suggestedBid,
                      rangeLow: rec.rangeStart || 0,
                      rangeHigh: rec.rangeEnd || 0
                    };
                    recMap.set(`${rec.keyword.toLowerCase()}:${(rec.matchType || "").toLowerCase()}`, bidData);
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
              }
            }
          } catch (err) {
            errors++;
            const errMsg = err.message || JSON.stringify(err);
            log209.warn(`[v515] campaign ${campaignId} SB\u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7API\u83B7\u53D6\u5931\u8D25: ${errMsg}`);
          }
          if (!apiSucceeded && kwList.length > 0) {
            try {
              const refAdGroupId = kwList[0].amazonAdGroupId;
              if (refAdGroupId) {
                const localRec = await getLocalKeywordBidRecommendation(
                  this.accountId,
                  refAdGroupId,
                  amazonCampaignId,
                  "sb",
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
                  log209.info(`[v515] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u4E3ASB campaign ${campaignId} \u7684 ${kwList.length} \u4E2A\u5173\u952E\u8BCD\u63D0\u4F9B\u5EFA\u8BAE\u7ADE\u4EF7 $${localRec.suggestedBid.toFixed(2)} (${localRec.source})`);
                } else {
                  log209.warn(`[v515] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u5BF9SB campaign ${campaignId} \u65E0\u8DB3\u591F\u6570\u636E\uFF0C${kwList.length}\u4E2A\u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7\u672A\u66F4\u65B0`);
                }
              }
            } catch (localErr) {
              log209.debug(`[v515] SB\u5173\u952E\u8BCD\u672C\u5730\u63A8\u8350\u5F15\u64CE\u5F02\u5E38: ${localErr.message}`);
            }
          }
        }
        log209.info(`[v417] SB\u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65\u5B8C\u6210: ${keywordBidsUpdated} \u4E2A\u5173\u952E\u8BCD\u5DF2\u66F4\u65B0`);
        log209.info("[v417] ========== \u5F00\u59CB\u540C\u6B65SB\u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7 ==========");
        const sbTargetRows = await db.select({
          id: productTargets.id,
          campaignId: productTargets.campaignId,
          internalAdGroupId: productTargets.internalAdGroupId,
          amazonAdGroupId: adGroups.adGroupId,
          targetExpression: productTargets.targetExpression,
          targetType: productTargets.targetType,
          targetValue: productTargets.targetValue
        }).from(productTargets).innerJoin(adGroups, eq(productTargets.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(and(
          eq(productTargets.accountId, this.accountId),
          eq(campaigns.campaignType, "sb"),
          eq(productTargets.targetStatus, "enabled")
        ));
        log209.info(`[v515] \u67E5\u8BE2\u5230 ${sbTargetRows.length} \u4E2ASB\u5546\u54C1\u5B9A\u4F4D\u9700\u8981\u83B7\u53D6\u5EFA\u8BAE\u7ADE\u4EF7`);
        const tgtByCampaign = /* @__PURE__ */ new Map();
        for (const row of sbTargetRows) {
          const cId = row.campaignId || "";
          if (!tgtByCampaign.has(cId)) tgtByCampaign.set(cId, []);
          tgtByCampaign.get(cId).push({
            id: row.id,
            targetExpression: row.targetExpression,
            targetType: row.targetType,
            targetValue: row.targetValue,
            amazonAdGroupId: row.amazonAdGroupId || ""
          });
        }
        for (const [campaignId, tgtList] of tgtByCampaign) {
          const amazonCampaignId = campaignIdMap.get(campaignId);
          if (!amazonCampaignId) continue;
          let tgtApiSucceeded = false;
          try {
            const batchSize = 100;
            for (let i = 0; i < tgtList.length; i += batchSize) {
              const batch = tgtList.slice(i, i + batchSize);
              const targets = [];
              for (const tgt of batch) {
                if (tgt.targetExpression) {
                  try {
                    const expr = JSON.parse(tgt.targetExpression);
                    if (Array.isArray(expr) && expr.length > 0) {
                      targets.push(expr[0]);
                    }
                  } catch {
                    if (tgt.targetType === "asin") {
                      targets.push({ type: "asinSameAs", value: tgt.targetValue });
                    } else {
                      targets.push({ type: "asinCategorySameAs", value: tgt.targetValue });
                    }
                  }
                } else {
                  if (tgt.targetType === "asin") {
                    targets.push({ type: "asinSameAs", value: tgt.targetValue });
                  } else {
                    targets.push({ type: "asinCategorySameAs", value: tgt.targetValue });
                  }
                }
              }
              if (targets.length === 0) continue;
              const recommendations = await this.client.getSbTargetBidRecommendations(amazonCampaignId, targets);
              log209.info(`[v515] SB\u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7API\u8FD4\u56DE: campaignId=${amazonCampaignId}, \u8BF7\u6C42=${targets.length}, \u8FD4\u56DE=${recommendations?.length || 0}`);
              if (recommendations && recommendations.length > 0) {
                tgtApiSucceeded = true;
                for (let j = 0; j < Math.min(recommendations.length, batch.length); j++) {
                  const rec = recommendations[j];
                  if (rec && rec.suggestedBid && rec.suggestedBid > 0) {
                    await db.update(productTargets).set({
                      suggestedBid: String(rec.suggestedBid),
                      suggestedBidLow: rec.rangeStart > 0 ? String(rec.rangeStart) : null,
                      suggestedBidHigh: rec.rangeEnd > 0 ? String(rec.rangeEnd) : null
                    }).where(eq(productTargets.id, batch[j].id));
                    targetBidsUpdated++;
                  }
                }
              }
            }
          } catch (err) {
            errors++;
            const errMsg = err.message || JSON.stringify(err);
            log209.warn(`[v515] campaign ${campaignId} SB\u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7API\u83B7\u53D6\u5931\u8D25: ${errMsg}`);
          }
          if (!tgtApiSucceeded && tgtList.length > 0) {
            try {
              const refAdGroupId = tgtList[0].amazonAdGroupId;
              if (refAdGroupId) {
                const localRec = await getLocalTargetBidRecommendation(
                  this.accountId,
                  refAdGroupId,
                  amazonCampaignId,
                  "sb",
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
                  log209.info(`[v515] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u4E3ASB campaign ${campaignId} \u7684 ${tgtList.length} \u4E2A\u5546\u54C1\u5B9A\u4F4D\u63D0\u4F9B\u5EFA\u8BAE\u7ADE\u4EF7 $${localRec.suggestedBid.toFixed(2)} (${localRec.source})`);
                } else {
                  log209.warn(`[v515] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u5BF9SB campaign ${campaignId} \u65E0\u8DB3\u591F\u6570\u636E\uFF0C${tgtList.length}\u4E2A\u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7\u672A\u66F4\u65B0`);
                }
              }
            } catch (localErr) {
              log209.debug(`[v515] SB\u5546\u54C1\u5B9A\u4F4D\u672C\u5730\u63A8\u8350\u5F15\u64CE\u5F02\u5E38: ${localErr.message}`);
            }
          }
        }
        log209.info(`[v515] SB\u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65\u5B8C\u6210: ${targetBidsUpdated} \u4E2A\u5B9A\u4F4D\u5DF2\u66F4\u65B0`);
        log209.info(`[v515] ========== SB\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65\u603B\u7ED3: \u5173\u952E\u8BCD=${keywordBidsUpdated}, \u5B9A\u4F4D=${targetBidsUpdated}, \u9519\u8BEF=${errors} ==========`);
        return { synced: keywordBidsUpdated + targetBidsUpdated, skipped: errors };
      } catch (error48) {
        log209.warn(`[v417] Error syncing SB bid recommendations: ${error48.message || JSON.stringify(error48)}`);
        return { synced: keywordBidsUpdated + targetBidsUpdated, skipped: errors };
      }
    };
  }
});

