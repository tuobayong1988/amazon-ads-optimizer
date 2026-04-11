// Extracted from production dist/index.js
// Original module: server/sync/syncSd.ts
// Lines: 874

var log210;
var init_syncSd = __esm({
  "server/sync/syncSd.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_logger();
    init_timezone();
    init_amazonSyncService();
    init_localBidRecommendationEngine();
    log210 = createModuleLogger("syncSd");
    AmazonSyncService.prototype.syncSdCampaigns = async function(lastSyncTime) {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiCampaigns = await this.client.listSdCampaigns();
        let synced = 0;
        let skipped = 0;
        if (apiCampaigns.length > 0) {
          log210.debug("SD\u5E7F\u544A\u6D3B\u52A8API\u8FD4\u56DE\u7ED3\u6784\u793A\u4F8B:", JSON.stringify(apiCampaigns[0], null, 2));
        }
        log210.debug(`\u83B7\u53D6\u5230 ${apiCampaigns.length} \u4E2ASD\u5E7F\u544A\u6D3B\u52A8`);
        const sdCampaignIds = apiCampaigns.map((c) => String(c.campaignId));
        const existingSdCampaignRows = sdCampaignIds.length > 0 ? await db.select().from(campaigns).where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sdCampaignIds))) : [];
        const existingSdCampaignMap = new Map(existingSdCampaignRows.map((r) => [r.campaignId, r]));
        for (const apiCampaign of apiCampaigns) {
          const existing = existingSdCampaignMap.get(String(apiCampaign.campaignId)) || null;
          let dailyBudget = 0;
          let budgetType = "daily";
          if (apiCampaign.budget) {
            if (typeof apiCampaign.budget === "number") {
              dailyBudget = apiCampaign.budget;
            } else if (typeof apiCampaign.budget === "object") {
              dailyBudget = apiCampaign.budget.budget || apiCampaign.budget.dailyBudget || 0;
              budgetType = apiCampaign.budget.budgetType || "daily";
            }
          } else if (apiCampaign.dailyBudget) {
            dailyBudget = apiCampaign.dailyBudget;
          }
          const campaignState = apiCampaign.state || apiCampaign.status || "enabled";
          const validStates = ["enabled", "paused", "archived"];
          const normalizedState = validStates.includes(campaignState.toLowerCase()) ? campaignState.toLowerCase() : "enabled";
          let sdStartDate = null;
          if (apiCampaign.startDate) {
            const dateStr = String(apiCampaign.startDate);
            if (dateStr.includes("-")) {
              sdStartDate = dateStr;
            } else if (dateStr.length === 8) {
              sdStartDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
            }
          }
          let sdEndDate = null;
          if (apiCampaign.endDate) {
            const dateStr = String(apiCampaign.endDate);
            if (dateStr.includes("-")) {
              sdEndDate = dateStr;
            } else if (dateStr.length === 8) {
              sdEndDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
            }
          }
          const sdCostType = apiCampaign.costType?.toLowerCase() || "cpc";
          const validCostTypes = ["cpc", "vcpm", "cpm"];
          const normalizedCostType = validCostTypes.includes(sdCostType) ? sdCostType : "cpc";
          const sdPortfolioId = apiCampaign.portfolioId ? String(apiCampaign.portfolioId) : null;
          const sdGoal = apiCampaign.goal || apiCampaign.optimizationGoal || apiCampaign.bidOptimization || "";
          const sdTactic = apiCampaign.tactic || null;
          let finalCostType = normalizedCostType;
          if (sdGoal === "reach" && normalizedCostType === "cpc") {
            log210.debug(`SD\u5E7F\u544A ${apiCampaign.name}: goal=reach \u4F46 costType=cpc\uFF0C\u4EE5API\u8FD4\u56DE\u4E3A\u51C6`);
          }
          const sdBidOptimization = apiCampaign.bidOptimization || null;
          const validBidOpts = ["reach", "pageVisits", "conversions", "leads"];
          const normalizedBidOpt = validBidOpts.includes(sdBidOptimization) ? sdBidOptimization : null;
          const sdOptimizationStrategy = String(sdGoal || sdBidOptimization || "conversions").toLowerCase();
          log210.debug(`SD\u5E7F\u544A ${apiCampaign.name}: goal=${sdGoal}, costType=${finalCostType}, tactic=${sdTactic}, strategy=${sdOptimizationStrategy}`);
          const campaignData = {
            accountId: this.accountId,
            campaignId: String(apiCampaign.campaignId),
            campaignName: apiCampaign.name,
            campaignType: "sd",
            targetingType: "manual",
            dailyBudget: String(dailyBudget),
            campaignStatus: normalizedState,
            state: normalizedState,
            startDate: sdStartDate,
            endDate: sdEndDate,
            costType: finalCostType,
            campaignGoal: sdGoal || null,
            // ✅ 存储SD广告目标
            bidOptimization: normalizedBidOpt,
            // ✅ 存储竞价优化目标
            tactic: sdTactic,
            // ✅ 存储定向策略
            portfolioId: sdPortfolioId,
            // @ts-ignore
            amazonCreatedDate: sdStartDate,
            // Amazon侧创建日期
            // v500: SD优化策略
            sdOptimizationStrategy,
            // @ts-ignore
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            await db.update(campaigns).set(campaignData).where(eq(campaigns.id, existing.id));
          } else {
            await db.insert(campaigns).values({
              ...campaignData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
          }
          synced++;
        }
        return { synced, skipped };
      } catch (error48) {
        log210.warn(`Error syncing SD campaigns: [${error48.code || error48.errno || "UNKNOWN"}] ${error48.message || JSON.stringify(error48)}`);
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSdAdGroups = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiAdGroups = await this.client.listSdAdGroups();
        let synced = 0;
        let skipped = 0;
        log210.debug(`\u83B7\u53D6\u5230 ${apiAdGroups.length} \u4E2ASD\u5E7F\u544A\u7EC4`);
        const sdAdGroupCampaignIds = [...new Set(apiAdGroups.map((ag) => String(ag.campaignId)))];
        const sdCampaignRows = sdAdGroupCampaignIds.length > 0 ? await db.select().from(campaigns).where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sdAdGroupCampaignIds))) : [];
        const sdCampaignMap = new Map(sdCampaignRows.map((r) => [r.campaignId, r]));
        const sdAdGroupIds = apiAdGroups.map((ag) => String(ag.adGroupId));
        const existingSdAdGroupRows = sdAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sdAdGroupIds))) : [];
        const existingSdAdGroupMap = new Map(existingSdAdGroupRows.map((r) => [`${r.campaignId}:${r.adGroupId}`, r]));
        for (const apiAdGroup of apiAdGroups) {
          const campaign = sdCampaignMap.get(String(apiAdGroup.campaignId));
          if (!campaign) continue;
          const existing = existingSdAdGroupMap.get(`${campaign.campaignId}:${String(apiAdGroup.adGroupId)}`) || null;
          const normalizedState = (apiAdGroup.state || "enabled").toLowerCase();
          const tactic = apiAdGroup.tactic || null;
          const adGroupData = {
            // @ts-ignore
            campaignId: campaign.campaignId,
            accountId: this.accountId,
            adGroupId: String(apiAdGroup.adGroupId),
            // @ts-ignore
            adGroupName: apiAdGroup.name || apiAdGroup.adGroupName || "SD Ad Group",
            adGroupStatus: normalizedState,
            defaultBid: String(apiAdGroup.defaultBid || apiAdGroup.bid || 0),
            tactic,
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
        log210.info(`SD\u5E7F\u544A\u7EC4\u540C\u6B65\u5B8C\u6210: synced=${synced}, skipped=${skipped}`);
        return { synced, skipped };
      } catch (error48) {
        log210.warn(`Error syncing SD ad groups: ${error48.message || JSON.stringify(error48)}`);
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSdProductTargets = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiTargets = await this.client.listSdTargets();
        let synced = 0;
        let skipped = 0;
        log210.debug(`\u83B7\u53D6\u5230 ${apiTargets.length} \u4E2ASD\u5546\u54C1\u5B9A\u4F4D`);
        const sdTgtAdGroupIds = [...new Set(apiTargets.map((t2) => String(t2.adGroupId)))];
        const sdTgtAdGroupRows = sdTgtAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sdTgtAdGroupIds))) : [];
        const sdTgtAdGroupMap = new Map(sdTgtAdGroupRows.map((r) => [r.adGroupId, r]));
        const sdTgtIds = apiTargets.map((t2) => String(t2.targetId));
        const existingSdTgtRows = sdTgtIds.length > 0 ? await db.select().from(productTargets).where(and(eq(productTargets.accountId, this.accountId), inArray(productTargets.targetId, sdTgtIds))) : [];
        const existingSdTgtMap = new Map(existingSdTgtRows.map((r) => [`${r.internalAdGroupId}:${r.targetId}`, r]));
        for (const apiTarget of apiTargets) {
          const adGroup = sdTgtAdGroupMap.get(String(apiTarget.adGroupId));
          if (!adGroup) continue;
          let targetType = "category";
          let targetValue = "";
          let targetExpression = "";
          let targetMatchType = "exact";
          let categoryName = null;
          let categoryRefinements = null;
          const refinements = {};
          const exprArray = apiTarget.expression || [];
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
          } else if (apiTarget.expressionType) {
            targetExpression = apiTarget.expressionType;
            if (apiTarget.expressionType === "auto") {
              targetValue = "AUTO";
              targetMatchType = "loose";
            }
          }
          if (!targetValue) {
            const exprTypes = Array.isArray(apiTarget.expression) ? apiTarget.expression.map((e) => e.type || "").join(",") : "";
            targetValue = exprTypes || `AUTO_${String(apiTarget.targetId)}`;
          }
          const existing = existingSdTgtMap.get(`${String(adGroup.id)}:${String(apiTarget.targetId)}`) || null;
          const normalizedState = (apiTarget.state || "enabled").toLowerCase();
          const rawBid = apiTarget.bid;
          const bidValue = typeof rawBid === "object" && rawBid !== null ? rawBid.amount || 0 : rawBid || 0;
          const targetData = {
            accountId: this.accountId,
            internalAdGroupId: adGroup.id,
            // v418: ID体系重构
            campaignId: adGroup.campaignId || "",
            // v3577
            targetId: String(apiTarget.targetId),
            targetType,
            targetValue,
            targetExpression,
            targetMatchType,
            bid: String(bidValue),
            targetStatus: normalizedState,
            categoryName,
            categoryRefinements,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (synced === 0) {
            log210.debug(`SD\u4EA7\u54C1\u5B9A\u5411\u793A\u4F8B: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
            ;
          }
          if (existing) {
            await db.update(productTargets).set(targetData).where(eq(productTargets.id, existing.id));
          } else {
            await db.insert(productTargets).values({
              ...targetData,
              // @ts-ignore
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
          }
          synced++;
        }
        log210.info(`SD\u5546\u54C1\u5B9A\u4F4D\u540C\u6B65\u5B8C\u6210: synced=${synced}, skipped=${skipped}`);
        return { synced, skipped };
      } catch (error48) {
        log210.warn(`Error syncing SD product targets: ${error48.message || JSON.stringify(error48)}`);
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSdTargeting = async function(days = 14) {
      const db = await getDb();
      if (!db) throw new Error("DATABASE_UNAVAILABLE: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
      try {
        const MAX_DAYS_PER_REQUEST = 31;
        const totalDays = Math.min(days, 90);
        const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
        const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
        log210.info(`v339: \u5F00\u59CB\u540C\u6B65SD\u5B9A\u5411\u6570\u636E: \u5171${totalDays}\u5929\uFF0C\u5206${batches}\u6279\u8BF7\u6C42 (\u7AD9\u70B9: ${this.marketplace})`);
        let allReportData = [];
        if (batches === 1) {
          try {
            const reportId = await this.client.requestSdTargetingReport(rangeStartDate, rangeEndDate);
            const data = await this.client.waitAndDownloadReport(reportId, 3e5);
            if (data && data.length > 0) allReportData = data;
          } catch (e) {
            log210.warn(`v413: SD\u5B9A\u5411\u62A5\u544A\u8BF7\u6C42\u5931\u8D25:`, e.message);
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
              name: `SD\u5B9A\u5411\u7B2C${batch + 1}/${batches}\u6279(${bStart}~${bEnd})`,
              requestFn: /* @__PURE__ */ __name(() => this.client.requestSdTargetingReport(bStart, bEnd), "requestFn")
            });
          }
          log210.info(`[v413] SD\u5B9A\u5411: ${batches}\u6279\u6B21\u6279\u91CF\u63D0\u4EA4\u5F00\u59CB`);
          const results = await this.client.submitAndWaitMultipleReports(batchRequests, 12e5, 3e3);
          for (const result of results) {
            if (result.data && result.data.length > 0) {
              allReportData = allReportData.concat(result.data);
            } else if (result.error) {
              log210.warn(`[v413] ${result.name}\u5931\u8D25: ${result.error}`);
            }
          }
        }
        const reportData = allReportData;
        if (!reportData || reportData.length === 0) {
          log210.debug("v339: \u6240\u6709\u6279\u6B21SD\u5B9A\u5411\u62A5\u544A\u6570\u636E\u4E3A\u7A7A");
          return 0;
        }
        log210.info(`v339: \u5171\u83B7\u53D6\u5230 ${reportData.length} \u6761SD\u5B9A\u5411\u6570\u636E\uFF08${batches}\u6279\u5408\u5E76\uFF09`);
        let synced = 0;
        const sdRptAdGroupIds = [...new Set(reportData.map((r) => String(r.adGroupId)))];
        const sdRptAdGroupRows = sdRptAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sdRptAdGroupIds))) : [];
        const sdRptAdGroupMap = new Map(sdRptAdGroupRows.map((r) => [r.adGroupId, r]));
        const sdRptInternalAgIds = sdRptAdGroupRows.map((r) => r.id);
        const existingSdRptTgtRows = sdRptInternalAgIds.length > 0 ? await db.select().from(productTargets).where(and(
          eq(productTargets.accountId, this.accountId),
          // @ts-ignore
          inArray(productTargets.internalAdGroupId, sdRptInternalAgIds)
        )) : [];
        const existingSdRptTgtByExpr = /* @__PURE__ */ new Map();
        const existingSdRptTgtByValue = /* @__PURE__ */ new Map();
        for (const r of existingSdRptTgtRows) {
          if (r.targetExpression) {
            existingSdRptTgtByExpr.set(`${r.internalAdGroupId}:${r.targetExpression}`, r);
          }
          if (r.targetValue) {
            existingSdRptTgtByValue.set(`${r.internalAdGroupId}:${r.targetValue}`, r);
          }
        }
        for (const row of reportData) {
          const adGroup = sdRptAdGroupMap.get(String(row.adGroupId));
          if (!adGroup) continue;
          const clickSales = row.salesClicks || 0;
          const viewSales = 0;
          const clickOrders = row.purchasesClicks || 0;
          const viewOrders = 0;
          const cost = row.cost || 0;
          const sales = clickSales + viewSales;
          const orders = clickOrders + viewOrders;
          const clicks = row.clicks || 0;
          const impressions = row.impressions || 0;
          const targetingText = row.targetingText || "";
          let targetType = "category";
          let targetValue = targetingText;
          if (targetingText.includes("asin")) {
            targetType = "asin";
            const asinMatch = targetingText.match(/asin="([^"]+)"/);
            if (asinMatch) targetValue = asinMatch[1];
          }
          const existing = existingSdRptTgtByExpr.get(`${adGroup.id}:${targetingText}`) || existingSdRptTgtByValue.get(`${adGroup.id}:${targetValue}`) || null;
          if (!targetingText && !existing) {
            log210.debug(`v428: SD\u5B9A\u5411\u62A5\u544A\u8DF3\u8FC7\u7A7AtargetingText\u8BB0\u5F55: adGroupId=${row.adGroupId}`);
            continue;
          }
          const targetData = {
            // @ts-ignore
            internalAdGroupId: adGroup.id,
            campaignId: adGroup.campaignId || "",
            // v422: 如果匹配到已有记录，保留其targetId；否则用targetingText作为临时标识
            // v428: 确保targetId永远不为空字符串
            targetId: existing?.targetId || (targetingText ? `text:${targetingText}` : `unknown:${adGroup.id}:${Date.now()}`),
            targetType,
            targetValue,
            targetExpression: targetingText,
            bid: existing?.bid || "0.00",
            // 保留已有的bid
            impressions,
            clicks,
            spend: String(cost),
            sales: String(sales),
            orders,
            targetAcos: sales > 0 ? String((cost / sales * 100).toFixed(2)) : null,
            targetRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
            targetCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
            targetCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
            targetCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
            targetStatus: "enabled",
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            await db.update(productTargets).set(targetData).where(eq(productTargets.id, existing.id));
          } else {
            await db.insert(productTargets).values({
              ...targetData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
          }
          synced++;
        }
        log210.info(`SD\u5B9A\u5411\u540C\u6B65\u5B8C\u6210: ${synced} \u6761\u8BB0\u5F55`);
        return synced;
      } catch (error48) {
        log210.warn(`\u540C\u6B65SD\u5B9A\u5411\u5931\u8D25: ${error48.message || JSON.stringify(error48)}`);
        throw error48;
      }
    };
    AmazonSyncService.prototype.syncSdNegativeTargets = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, updated: 0 };
      try {
        let synced = 0;
        let updated = 0;
        const sdNegTargets = await this.client.listSdNegativeTargets();
        log210.debug(`\u83B7\u53D6\u5230 ${sdNegTargets.length} \u4E2ASD\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411`);
        if (sdNegTargets.length === 0) {
          return { synced: 0, updated: 0 };
        }
        const sdNegCampaignIds = [...new Set(sdNegTargets.map((n) => String(n.campaignId)))];
        const sdNegCampaignRows = sdNegCampaignIds.length > 0 ? await db.select().from(campaigns).where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sdNegCampaignIds))) : [];
        const sdNegCampaignMap = new Map(sdNegCampaignRows.map((r) => [r.campaignId, r]));
        const sdNegAdGroupIds = [...new Set(sdNegTargets.filter((n) => n.adGroupId).map((n) => String(n.adGroupId)))];
        const sdNegAdGroupRows = sdNegAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sdNegAdGroupIds))) : [];
        const sdNegAdGroupMap = new Map(sdNegAdGroupRows.map((r) => [r.adGroupId, r]));
        for (const neg of sdNegTargets) {
          const negState = (neg.state || "enabled").toLowerCase();
          if (negState === "archived") continue;
          const campaign = sdNegCampaignMap.get(String(neg.campaignId));
          if (!campaign) continue;
          let internalAdGroupId = null;
          if (neg.adGroupId) {
            const adGroup = sdNegAdGroupMap.get(String(neg.adGroupId));
            if (adGroup) internalAdGroupId = adGroup.id;
          }
          const expression = neg.expression || [];
          const asinExpr = expression.find(
            (e) => (
              // @ts-ignore
              e.type?.toLowerCase().includes("asin") || e.type?.toLowerCase().includes("brand")
            )
          );
          const negativeText = asinExpr?.value || JSON.stringify(expression);
          const amazonTargetId = String(neg.targetId || "");
          const negLevel = "ad_group";
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
            await db.update(negativeKeywords).set({
              amazonNegativeKeywordId: amazonTargetId || null,
              negativeStatus: negState === "enabled" ? "active" : "removed",
              campaignType: "sd",
              negativeScope: "ad_group"
            }).where(eq(negativeKeywords.id, existing.id));
            updated++;
          } else {
            await db.insert(negativeKeywords).values({
              // @ts-ignore
              accountId: this.accountId,
              campaignId: String(campaign.campaignId),
              internalAdGroupId,
              campaignType: "sd",
              negativeScope: "ad_group",
              negativeLevel: negLevel,
              negativeType: "product",
              negativeText,
              negativeMatchType: "negative_exact",
              amazonNegativeKeywordId: amazonTargetId || null,
              negativeSource: "manual",
              negativeStatus: negState === "enabled" ? "active" : "removed"
            }).onDuplicateKeyUpdate({
              set: { negativeStatus: sql`VALUES(negativeStatus)`, amazonNegativeKeywordId: sql`VALUES(amazon_negative_keyword_id)` }
            });
            synced++;
          }
        }
        log210.info(`SD\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u540C\u6B65\u5B8C\u6210: ${synced}\u6761\u65B0\u589E, ${updated}\u6761\u66F4\u65B0`);
        return { synced, updated };
      } catch (error48) {
        log210.warn("SD\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u540C\u6B65\u5931\u8D25:", error48.message);
        return { synced: 0, updated: 0 };
      }
    };
    AmazonSyncService.prototype.syncSdBidRecommendations = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      let targetBidsUpdated = 0;
      let localEngineBidsUpdated = 0;
      let errors = 0;
      try {
        log210.info("[v519] ========== \u5F00\u59CB\u540C\u6B65SD\u6295\u653E\u5BF9\u8C61\u5EFA\u8BAE\u7ADE\u4EF7 ==========");
        const sdTargetRows = await db.select({
          id: productTargets.id,
          targetId: productTargets.targetId,
          adGroupId: productTargets.internalAdGroupId,
          amazonAdGroupId: adGroups.adGroupId,
          campaignId: productTargets.campaignId
        }).from(productTargets).innerJoin(adGroups, eq(productTargets.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(and(
          eq(productTargets.accountId, this.accountId),
          eq(campaigns.campaignType, "sd"),
          eq(productTargets.targetStatus, "enabled")
        ));
        log210.info(`[v519] \u67E5\u8BE2\u5230 ${sdTargetRows.length} \u4E2ASD\u6295\u653E\u5BF9\u8C61\u9700\u8981\u83B7\u53D6\u5EFA\u8BAE\u7ADE\u4EF7`);
        if (sdTargetRows.length === 0) {
          return { synced: 0, skipped: 0 };
        }
        const internalAdGroupIds = [...new Set(sdTargetRows.map((r) => Number(r.adGroupId) || 0).filter((id) => id > 0))];
        const adGroupMappingRows = internalAdGroupIds.length > 0 ? await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.id, internalAdGroupIds))) : [];
        const internalToAmazonAdGroupId = new Map(adGroupMappingRows.map((r) => [r.id, r.adGroupId]));
        const targetsByAdGroup = /* @__PURE__ */ new Map();
        for (const row of sdTargetRows) {
          const agId = Number(row.adGroupId) || 0;
          if (!targetsByAdGroup.has(agId)) targetsByAdGroup.set(agId, []);
          targetsByAdGroup.get(agId).push(row);
        }
        let apiSucceeded = false;
        const batchSize = 100;
        for (let i = 0; i < sdTargetRows.length; i += batchSize) {
          const batch = sdTargetRows.slice(i, i + batchSize);
          try {
            const targetingClauses = [];
            const clauseToTarget = /* @__PURE__ */ new Map();
            for (const tgt of batch) {
              if (!tgt.targetId) continue;
              const amazonAdGroupId = internalToAmazonAdGroupId.get(Number(tgt.adGroupId) || 0);
              if (!amazonAdGroupId) continue;
              clauseToTarget.set(targetingClauses.length, tgt);
              targetingClauses.push({
                targetId: tgt.targetId,
                adGroupId: amazonAdGroupId
              });
            }
            if (targetingClauses.length === 0) continue;
            const recommendations = await this.client.getSdTargetBidRecommendations(targetingClauses);
            log210.info(`[v519] SD\u5EFA\u8BAE\u7ADE\u4EF7API\u8FD4\u56DE: \u8BF7\u6C42=${targetingClauses.length}, \u8FD4\u56DE=${recommendations?.length || 0}`);
            if (recommendations && recommendations.length > 0) {
              const recByTargetId = /* @__PURE__ */ new Map();
              for (const rec of recommendations) {
                if (rec.targetId && rec.suggestedBid && rec.suggestedBid > 0) {
                  recByTargetId.set(rec.targetId, {
                    suggestedBid: rec.suggestedBid,
                    bidRangeLow: rec.bidRangeLow || 0,
                    bidRangeHigh: rec.bidRangeHigh || 0
                  });
                }
              }
              let batchUpdated = 0;
              for (const tgt of batch) {
                if (!tgt.targetId) continue;
                const bidData = recByTargetId.get(tgt.targetId);
                if (bidData && bidData.suggestedBid > 0) {
                  await db.update(productTargets).set({
                    suggestedBid: String(bidData.suggestedBid),
                    suggestedBidLow: bidData.bidRangeLow > 0 ? String(bidData.bidRangeLow) : null,
                    suggestedBidHigh: bidData.bidRangeHigh > 0 ? String(bidData.bidRangeHigh) : null
                  }).where(eq(productTargets.id, tgt.id));
                  targetBidsUpdated++;
                  batchUpdated++;
                }
              }
              if (batchUpdated === 0 && recommendations.length > 0) {
                const orderedTargets = [...clauseToTarget.entries()].sort((a, b) => a[0] - b[0]);
                for (let j = 0; j < Math.min(recommendations.length, orderedTargets.length); j++) {
                  const rec = recommendations[j];
                  const tgt = orderedTargets[j][1];
                  if (rec && rec.suggestedBid && rec.suggestedBid > 0) {
                    await db.update(productTargets).set({
                      suggestedBid: String(rec.suggestedBid),
                      suggestedBidLow: rec.bidRangeLow > 0 ? String(rec.bidRangeLow) : null,
                      suggestedBidHigh: rec.bidRangeHigh > 0 ? String(rec.bidRangeHigh) : null
                    }).where(eq(productTargets.id, tgt.id));
                    targetBidsUpdated++;
                    batchUpdated++;
                  }
                }
              }
              if (batchUpdated > 0) apiSucceeded = true;
            }
          } catch (err) {
            errors++;
            log210.warn(`[v519] SD\u6295\u653E\u5BF9\u8C61\u5EFA\u8BAE\u7ADE\u4EF7\u6279\u6B21\u83B7\u53D6\u5931\u8D25: ${err.message}`);
          }
        }
        if (!apiSucceeded && sdTargetRows.length > 0) {
          log210.info(`[v519] SD API\u672A\u8FD4\u56DE\u6709\u6548\u5EFA\u8BAE\u7ADE\u4EF7\uFF0C\u542F\u52A8\u672C\u5730\u63A8\u8350\u5F15\u64CE\u56DE\u9000 (${targetsByAdGroup.size}\u4E2A\u5E7F\u544A\u7EC4)`);
          for (const [internalAgId, targets] of targetsByAdGroup) {
            try {
              const amazonAdGroupId = internalToAmazonAdGroupId.get(internalAgId);
              if (!amazonAdGroupId) continue;
              const refCampaignId = targets[0]?.campaignId || "";
              const localRec = await getLocalTargetBidRecommendation(
                this.accountId,
                amazonAdGroupId,
                refCampaignId,
                "sd",
                0.3
              );
              if (localRec.source !== "minimum_default" && localRec.suggestedBid > 0) {
                for (const tgt of targets) {
                  await db.update(productTargets).set({
                    suggestedBid: String(localRec.suggestedBid),
                    suggestedBidLow: String(localRec.rangeStart),
                    suggestedBidHigh: String(localRec.rangeEnd)
                  }).where(eq(productTargets.id, tgt.id));
                  localEngineBidsUpdated++;
                }
                log210.info(`[v519] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u4E3ASD adGroup ${amazonAdGroupId} \u7684 ${targets.length} \u4E2A\u5B9A\u4F4D\u63D0\u4F9B\u5EFA\u8BAE\u7ADE\u4EF7 $${localRec.suggestedBid.toFixed(2)} (${localRec.source})`);
              } else {
                log210.debug(`[v519] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u5BF9SD adGroup ${amazonAdGroupId} \u65E0\u8DB3\u591F\u6570\u636E (source=${localRec.source})`);
              }
            } catch (localErr) {
              log210.debug(`[v519] SD\u5B9A\u4F4D\u672C\u5730\u63A8\u8350\u5F15\u64CE\u5F02\u5E38: ${localErr.message}`);
            }
          }
        }
        const totalUpdated = targetBidsUpdated + localEngineBidsUpdated;
        log210.info(`[v519] ========== SD\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65\u603B\u7ED3: API=${targetBidsUpdated}, \u672C\u5730\u5F15\u64CE=${localEngineBidsUpdated}, \u603B\u8BA1=${totalUpdated}, \u9519\u8BEF=${errors} ==========`);
        return { synced: totalUpdated, skipped: errors };
      } catch (error48) {
        log210.warn(`[v519] Error syncing SD bid recommendations: ${error48.message || JSON.stringify(error48)}`);
        return { synced: targetBidsUpdated + localEngineBidsUpdated, skipped: errors };
      }
    };
    AmazonSyncService.prototype.syncSdAudiences = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      try {
        const apiTargets = await this.client.listSdTargets();
        let synced = 0;
        let skipped = 0;
        log210.debug(`[v500] \u83B7\u53D6\u5230 ${apiTargets.length} \u4E2ASD targets\uFF0C\u5F00\u59CB\u7B5B\u9009\u53D7\u4F17\u5B9A\u5411`);
        const sdAudAdGroupIds = [...new Set(apiTargets.map((t2) => String(t2.adGroupId)))];
        const sdAudAdGroupRows = sdAudAdGroupIds.length > 0 ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sdAudAdGroupIds))) : [];
        const sdAudAdGroupMap = new Map(sdAudAdGroupRows.map((r) => [r.adGroupId, r]));
        const sdAudInternalAgIds = sdAudAdGroupRows.map((r) => r.id);
        const existingSdAudRows = sdAudInternalAgIds.length > 0 ? await db.select().from(sdAudiences).where(and(
          eq(sdAudiences.accountId, this.accountId),
          inArray(sdAudiences.internalAdGroupId, sdAudInternalAgIds)
        )) : [];
        const existingSdAudMap = new Map(existingSdAudRows.map((r) => [`${r.internalAdGroupId}:${r.audienceId}`, r]));
        const AUDIENCE_EXPRESSION_TYPES = [
          "views",
          "purchases",
          "audience",
          "audiences",
          "similar",
          "similarproduct",
          "lookback",
          "inmarket",
          "in-market",
          "in_market",
          "lifestyle",
          "interest",
          "custom"
        ];
        for (const apiTarget of apiTargets) {
          const exprArray = apiTarget.expression || apiTarget.expressions || [];
          if (!Array.isArray(exprArray) || exprArray.length === 0) {
            continue;
          }
          let isAudienceTarget = false;
          let audienceType = "views";
          let audienceCategory = "";
          let audienceSubCategory = "";
          let amazonAudienceId = null;
          for (const expr of exprArray) {
            const et = String(expr.type || "").toLowerCase();
            if (AUDIENCE_EXPRESSION_TYPES.some((aud) => et.includes(aud))) {
              isAudienceTarget = true;
              if (et.includes("views") || et.includes("view")) {
                audienceType = "views";
                audienceCategory = "remarketing";
                audienceSubCategory = "Product Views";
              } else if (et.includes("purchases") || et.includes("purchase")) {
                audienceType = "purchases";
                audienceCategory = "remarketing";
                audienceSubCategory = "Product Purchases";
              } else if (et.includes("similar")) {
                audienceType = "similarProducts";
                audienceCategory = "remarketing";
                audienceSubCategory = "Similar Products";
              } else if (et.includes("lookback")) {
                audienceType = "lookback";
                audienceCategory = "remarketing";
                audienceSubCategory = `Lookback ${expr.value || "30"} days`;
              } else if (et.includes("inmarket") || et.includes("in-market") || et.includes("in_market")) {
                audienceType = "inMarket";
                audienceCategory = "in_market";
                audienceSubCategory = expr.value || "In-Market Audience";
              } else if (et.includes("lifestyle") || et.includes("interest")) {
                audienceType = "lifestyle";
                audienceCategory = "lifestyle";
                audienceSubCategory = expr.value || "Lifestyle Audience";
              } else if (et.includes("audience")) {
                audienceType = "custom";
                audienceCategory = "custom";
                audienceSubCategory = expr.value || "Custom Audience";
                amazonAudienceId = expr.value || null;
              } else if (et.includes("custom")) {
                audienceType = "custom";
                audienceCategory = "custom";
                audienceSubCategory = expr.value || "Custom Audience";
              }
              break;
            }
          }
          if (!isAudienceTarget) {
            continue;
          }
          const adGroup = sdAudAdGroupMap.get(String(apiTarget.adGroupId));
          if (!adGroup) {
            skipped++;
            continue;
          }
          const targetId = String(apiTarget.targetId);
          const existing = existingSdAudMap.get(`${adGroup.id}:${targetId}`) || null;
          const normalizedState = (apiTarget.state || "enabled").toLowerCase();
          let lookbackDays = 30;
          for (const expr of exprArray) {
            if (expr.lookbackDays || expr.lookback) {
              lookbackDays = Number(expr.lookbackDays || expr.lookback) || 30;
              break;
            }
          }
          const audienceData = {
            accountId: this.accountId,
            internalAdGroupId: adGroup.id,
            audienceId: targetId,
            audienceName: apiTarget.name || `${audienceCategory} - ${audienceSubCategory}`,
            audienceType,
            lookbackDays,
            audienceCategory,
            audienceSubCategory,
            audienceExpression: JSON.stringify(exprArray),
            amazonAudienceId,
            bid: String(typeof apiTarget.bid === "object" && apiTarget.bid !== null ? apiTarget.bid.amount || 0 : apiTarget.bid || 0),
            state: normalizedState,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (synced === 0) {
            log210.debug(`[v500] SD\u53D7\u4F17\u5B9A\u5411\u793A\u4F8B: type=${audienceType}, category=${audienceCategory}, sub=${audienceSubCategory}, bid=${audienceData.bid}`);
          }
          if (existing) {
            await db.update(sdAudiences).set(audienceData).where(eq(sdAudiences.id, existing.id));
          } else {
            await db.insert(sdAudiences).values({
              ...audienceData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
          }
          synced++;
        }
        log210.info(`[v500] SD\u53D7\u4F17\u5B9A\u5411\u540C\u6B65\u5B8C\u6210: synced=${synced}, skipped=${skipped}`);
        return { synced, skipped };
      } catch (error48) {
        const statusCode = error48?.response?.status || "unknown";
        const errorMsg = error48?.response?.data?.message || error48?.message || "unknown error";
        log210.warn(`[v500] Error syncing SD audiences: HTTP ${statusCode} - ${errorMsg}`);
        if (statusCode === 403) {
          log210.warn("[v500] SD audiences API\u8FD4\u56DE403\uFF0CProfile\u7F3A\u5C11SD\u6743\u9650\uFF0C\u8DF3\u8FC7");
        }
        return { synced: 0, skipped: 0 };
      }
    };
    AmazonSyncService.prototype.syncSdAudienceBidRecommendations = async function() {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0 };
      let audienceBidsUpdated = 0;
      let errors = 0;
      try {
        log210.info("[v519] ========== \u5F00\u59CB\u540C\u6B65SD\u53D7\u4F17\u5B9A\u5411\u5EFA\u8BAE\u7ADE\u4EF7 ==========");
        const sdAudienceRows = await db.select({
          id: sdAudiences.id,
          internalAdGroupId: sdAudiences.internalAdGroupId,
          audienceId: sdAudiences.audienceId,
          audienceType: sdAudiences.audienceType,
          bid: sdAudiences.bid,
          amazonAdGroupId: adGroups.adGroupId,
          campaignId: adGroups.campaignId
        }).from(sdAudiences).innerJoin(adGroups, eq(sdAudiences.internalAdGroupId, adGroups.id)).where(and(
          eq(sdAudiences.accountId, this.accountId),
          eq(sdAudiences.state, "enabled")
        ));
        log210.info(`[v519] \u67E5\u8BE2\u5230 ${sdAudienceRows.length} \u4E2ASD\u53D7\u4F17\u5B9A\u5411\u9700\u8981\u83B7\u53D6\u5EFA\u8BAE\u7ADE\u4EF7`);
        if (sdAudienceRows.length === 0) {
          return { synced: 0, skipped: 0 };
        }
        const audiencesByAdGroup = /* @__PURE__ */ new Map();
        for (const row of sdAudienceRows) {
          const agId = row.amazonAdGroupId || "";
          if (!audiencesByAdGroup.has(agId)) audiencesByAdGroup.set(agId, []);
          audiencesByAdGroup.get(agId).push(row);
        }
        for (const [amazonAdGroupId, audiences] of audiencesByAdGroup) {
          if (!amazonAdGroupId) continue;
          try {
            const refCampaignId = audiences[0]?.campaignId || "";
            const localRec = await getLocalTargetBidRecommendation(
              this.accountId,
              amazonAdGroupId,
              refCampaignId,
              "sd",
              0.3
            );
            if (localRec.source !== "minimum_default" && localRec.suggestedBid > 0) {
              for (const aud of audiences) {
                await db.update(sdAudiences).set({
                  suggestedBid: String(localRec.suggestedBid),
                  suggestedBidLow: String(localRec.rangeStart),
                  suggestedBidHigh: String(localRec.rangeEnd)
                }).where(eq(sdAudiences.id, aud.id));
                audienceBidsUpdated++;
              }
              log210.info(`[v519] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u4E3ASD adGroup ${amazonAdGroupId} \u7684 ${audiences.length} \u4E2A\u53D7\u4F17\u63D0\u4F9B\u5EFA\u8BAE\u7ADE\u4EF7 $${localRec.suggestedBid.toFixed(2)} (${localRec.source}, confidence=${localRec.confidence.toFixed(2)})`);
            } else {
              const refAudience = audiences[0];
              if (refAudience && refAudience.bid && Number(refAudience.bid) > 0) {
                const baseBid = Number(refAudience.bid);
                const sugBid = Math.max(baseBid, 0.1);
                for (const aud of audiences) {
                  await db.update(sdAudiences).set({
                    suggestedBid: String(sugBid.toFixed(2)),
                    suggestedBidLow: String(Math.max(sugBid * 0.5, 0.05).toFixed(2)),
                    suggestedBidHigh: String((sugBid * 2).toFixed(2))
                  }).where(eq(sdAudiences.id, aud.id));
                  audienceBidsUpdated++;
                }
                log210.info(`[v522] SD adGroup ${amazonAdGroupId} \u4F7F\u7528\u5F53\u524D\u51FA\u4EF7$${sugBid.toFixed(2)}\u4F5C\u4E3A\u5EFA\u8BAE\u7ADE\u4EF7\u57FA\u7EBF (${audiences.length}\u4E2A\u53D7\u4F17)`);
              } else {
                log210.debug(`[v519] \u672C\u5730\u63A8\u8350\u5F15\u64CE\u5BF9SD adGroup ${amazonAdGroupId} \u65E0\u8DB3\u591F\u6570\u636E (source=${localRec.source})`);
              }
            }
          } catch (localErr) {
            errors++;
            log210.debug(`[v519] SD\u53D7\u4F17\u672C\u5730\u63A8\u8350\u5F15\u64CE\u5F02\u5E38: ${localErr.message}`);
          }
        }
        log210.info(`[v519] ========== SD\u53D7\u4F17\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65\u603B\u7ED3: \u66F4\u65B0=${audienceBidsUpdated}, \u9519\u8BEF=${errors} ==========`);
        return { synced: audienceBidsUpdated, skipped: errors };
      } catch (error48) {
        log210.warn(`[v519] Error syncing SD audience bid recommendations: ${error48.message || JSON.stringify(error48)}`);
        return { synced: audienceBidsUpdated, skipped: errors };
      }
    };
  }
});

