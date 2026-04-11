// Extracted from production dist/index.js
// Original module: server/automation/autoStopLossService.ts
// Lines: 670

var autoStopLossService_exports = {};
__export(autoStopLossService_exports, {
  STOP_LOSS_CONFIG: () => STOP_LOSS_CONFIG,
  executeFullStopLossScan: () => executeFullStopLossScan,
  getStopLossConfig: () => getStopLossConfig,
  scanAndNegateSearchTerms: () => scanAndNegateSearchTerms,
  scanAndPauseHighAcosCampaigns: () => scanAndPauseHighAcosCampaigns,
  scanAndRepairDataCliffs: () => scanAndRepairDataCliffs,
  scanReactivatedCampaigns: () => scanReactivatedCampaigns,
  updateStopLossConfig: () => updateStopLossConfig
});
async function scanAndPauseHighAcosCampaigns(accountId) {
  const actions = [];
  const config2 = STOP_LOSS_CONFIG.campaignAutoPause;
  try {
    const dbInstance = await getDb();
    if (!dbInstance) return actions;
    const enabledCampaigns = await dbInstance.select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      campaignType: campaigns.campaignType,
      campaignStatus: campaigns.campaignStatus
    }).from(campaigns).where(and(
      eq(campaigns.accountId, accountId),
      eq(campaigns.campaignStatus, "enabled")
    ));
    log144.info(`[AutoStopLoss] \u626B\u63CF ${enabledCampaigns.length} \u4E2A\u6D3B\u8DC3Campaign (accountId=${accountId})`);
    const endDate = /* @__PURE__ */ new Date();
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(startDate.getDate() - config2.consecutiveDays - 1);
    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];
    const historyStartDate = /* @__PURE__ */ new Date();
    historyStartDate.setDate(historyStartDate.getDate() - 90);
    const historyStartStr = historyStartDate.toISOString().split("T")[0];
    for (const campaign of enabledCampaigns) {
      try {
        const dailyData = await dbInstance.execute(sql`
          SELECT date, spend, sales, orders, clicks, impressions
          FROM daily_performance
          WHERE campaignId = ${campaign.campaignId}
            AND accountId = ${accountId}
            AND date >= ${startDateStr}
            AND date <= ${endDateStr}
          ORDER BY date DESC
          LIMIT ${config2.consecutiveDays + 1}
        `);
        const rows = Array.isArray(dailyData) ? Array.isArray(dailyData[0]) ? dailyData[0] : dailyData : [];
        if (rows.length < config2.consecutiveDays) continue;
        let consecutiveHighAcos = 0;
        let totalSpend = 0;
        let totalSales = 0;
        let totalClicks = 0;
        for (const row of rows) {
          const spend = Number(row.spend) || 0;
          const sales = Number(row.sales) || 0;
          const clicks = Number(row.clicks) || 0;
          totalSpend += spend;
          totalSales += sales;
          totalClicks += clicks;
          if (spend > 0) {
            const dailyAcos = sales > 0 ? spend / sales * 100 : 999;
            if (dailyAcos > config2.acosThreshold) {
              consecutiveHighAcos++;
            } else {
              break;
            }
          }
        }
        if (consecutiveHighAcos < config2.consecutiveDays) continue;
        if (totalSpend < config2.minSpendThreshold) continue;
        if (totalClicks < config2.minClicksThreshold) continue;
        let isHistoricalPerformer = false;
        if (config2.excludeHistoricalPerformers) {
          const historyData = await dbInstance.execute(sql`
            SELECT COALESCE(SUM(orders), 0) as totalOrders
            FROM daily_performance
            WHERE campaignId = ${campaign.campaignId}
              AND accountId = ${accountId}
              AND date >= ${historyStartStr}
          `);
          const historyRows = Array.isArray(historyData) ? Array.isArray(historyData[0]) ? historyData[0] : historyData : [];
          const totalOrders = Number(historyRows[0]?.totalOrders) || 0;
          isHistoricalPerformer = totalOrders > config2.historicalOrderThreshold;
        }
        const avgAcos = totalSales > 0 ? totalSpend / totalSales * 100 : 999;
        if (isHistoricalPerformer) {
          log144.warn(`[AutoStopLoss] Campaign "${campaign.campaignName}" \u8FDE\u7EED${consecutiveHighAcos}\u5929ACoS>${config2.acosThreshold}%\uFF08\u5747\u503C${avgAcos.toFixed(0)}%\uFF09\uFF0C\u4F46\u6709\u5386\u53F2\u51FA\u5355\u8BB0\u5F55\uFF0C\u4EC5\u53D1\u51FA\u8B66\u544A`);
          actions.push({
            actionType: "campaign_pause",
            entityType: "campaign",
            entityId: campaign.id,
            entityName: campaign.campaignName || "",
            accountId,
            reason: `\u8FDE\u7EED${consecutiveHighAcos}\u5929ACoS>${config2.acosThreshold}%\uFF08\u5747\u503C${avgAcos.toFixed(0)}%\uFF09\uFF0C\u6709\u5386\u53F2\u51FA\u5355\u8BB0\u5F55\uFF0C\u5EFA\u8BAE\u4EBA\u5DE5\u5BA1\u67E5`,
            confidence: 0.7,
            severity: "high",
            autoExecuted: false,
            details: { avgAcos, consecutiveDays: consecutiveHighAcos, totalSpend, isHistoricalPerformer: true }
          });
        } else {
          log144.warn(`[AutoStopLoss] \u81EA\u52A8\u6682\u505CCampaign "${campaign.campaignName}" - \u8FDE\u7EED${consecutiveHighAcos}\u5929ACoS>${config2.acosThreshold}%\uFF08\u5747\u503C${avgAcos.toFixed(0)}%\uFF09`);
          await dbInstance.update(campaigns).set({ campaignStatus: "paused" }).where(eq(campaigns.id, campaign.id));
          try {
            await syncCampaignStatusToAmazon(accountId, [{
              amazonCampaignId: campaign.campaignId,
              newStatus: "paused",
              campaignName: campaign.campaignName || "",
              campaignType: campaign.campaignType || void 0,
              reason: `[AutoStopLoss] \u8FDE\u7EED${consecutiveHighAcos}\u5929ACoS>${config2.acosThreshold}%`
            }]);
          } catch (apiErr) {
            log144.error(`[AutoStopLoss] Amazon API\u540C\u6B65\u5931\u8D25: ${apiErr.message}`);
          }
          recordAudit({
            action: "campaign.pause",
            accountId,
            entityType: "campaign",
            entityId: campaign.id,
            entityName: campaign.campaignName || "",
            previousValue: "enabled",
            newValue: "paused",
            source: "system",
            metadata: { reason: `[AutoStopLoss] \u8FDE\u7EED${consecutiveHighAcos}\u5929ACoS=${avgAcos.toFixed(0)}%\uFF0C\u81EA\u52A8\u6682\u505C` }
          });
          actions.push({
            actionType: "campaign_pause",
            entityType: "campaign",
            entityId: campaign.id,
            entityName: campaign.campaignName || "",
            accountId,
            reason: `\u8FDE\u7EED${consecutiveHighAcos}\u5929ACoS>${config2.acosThreshold}%\uFF08\u5747\u503C${avgAcos.toFixed(0)}%\uFF09\uFF0C\u5DF2\u81EA\u52A8\u6682\u505C`,
            previousValue: "enabled",
            newValue: "paused",
            confidence: 0.9,
            severity: "critical",
            autoExecuted: true,
            executedAt: /* @__PURE__ */ new Date(),
            details: { avgAcos, consecutiveDays: consecutiveHighAcos, totalSpend, isHistoricalPerformer: false }
          });
          logOptimization("AutoStopLoss", `Campaign\u6682\u505C: ${campaign.campaignName} (ACoS=${avgAcos.toFixed(0)}%, \u8FDE\u7EED${consecutiveHighAcos}\u5929)`);
        }
      } catch (campaignErr) {
        log144.warn(`[AutoStopLoss] Campaign ${campaign.id} \u626B\u63CF\u5F02\u5E38: ${campaignErr.message}`);
      }
    }
    log144.info(`[AutoStopLoss] Campaign\u626B\u63CF\u5B8C\u6210: ${actions.filter((a) => a.autoExecuted).length}\u4E2A\u81EA\u52A8\u6682\u505C, ${actions.filter((a) => !a.autoExecuted).length}\u4E2A\u8B66\u544A`);
  } catch (err) {
    log144.error(`[AutoStopLoss] Campaign\u626B\u63CF\u5F02\u5E38: ${err.message}`);
  }
  return actions;
}
async function scanAndNegateSearchTerms(accountId) {
  const actions = [];
  const config2 = STOP_LOSS_CONFIG.searchTermAutoNegate;
  try {
    const dbInstance = await getReadDb(); // P4: Route heavy read queries to read replica
    if (!dbInstance) return actions;
    const endDate = /* @__PURE__ */ new Date();
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(startDate.getDate() - 14);
    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];
    let searchTermData;
    // P3v12: 添加查询重试机制（2次重试+2s延迟，应对Lock wait timeout）
    for (let _retryAttempt = 0; _retryAttempt <= 2; _retryAttempt++) {
      try {
        searchTermData = await dbInstance.execute(sql`
          SELECT 
            MIN(st.id) as id,
            st.searchTerm,
            st.campaignId,
            st.internal_ad_group_id,
            c.campaignType,
            SUM(st.searchTermSpend) as totalSpend,
            SUM(st.searchTermSales) as totalSales,
            SUM(st.searchTermOrders) as totalOrders,
            SUM(st.searchTermClicks) as totalClicks,
            SUM(st.searchTermImpressions) as totalImpressions
          FROM search_terms st
          LEFT JOIN campaigns c ON st.campaignId = c.campaignId AND st.accountId = c.accountId
          WHERE st.accountId = ${accountId}
            AND st.reportStartDate >= ${startDateStr}
            AND st.reportStartDate <= ${endDateStr}
          GROUP BY st.searchTerm, st.campaignId, st.internal_ad_group_id, c.campaignType
          HAVING SUM(st.searchTermSpend) > 5
          ORDER BY SUM(st.searchTermSpend) DESC
          LIMIT 500
        `);
        break; // 成功则跳出重试循环
      } catch (_retryErr) {
        if (_retryAttempt < 2) {
          log144.warn(`[AutoStopLoss] P3v12: 搜索词查询失败(attempt ${_retryAttempt+1}/3), ${2}s后重试: ` + (_retryErr.cause?.message || _retryErr.code || _retryErr.errno || _retryErr.message?.substring(0, 200)));
          await new Promise(r => setTimeout(r, 2000));
        } else {
          throw _retryErr; // 3次都失败，抛出让外层catch处理
        }
      }
    }
    const rows = Array.isArray(searchTermData) ? Array.isArray(searchTermData[0]) ? searchTermData[0] : searchTermData : [];
    log144.info(`[AutoStopLoss] \u626B\u63CF ${rows.length} \u4E2A\u641C\u7D22\u8BCD (accountId=${accountId})`);
    const negativeKeywordsToSync = [];
    for (const row of rows) {
      const searchTerm = String(row.searchTerm || "").toLowerCase();
      const spend = Number(row.totalSpend) || 0;
      const sales = Number(row.totalSales) || 0;
      const orders = Number(row.totalOrders) || 0;
      const clicks = Number(row.totalClicks) || 0;
      const acos = sales > 0 ? spend / sales * 100 : spend > 0 ? 999 : 0;
      let shouldNegate = false;
      let reason = "";
      let severity = "medium";
      if (orders === 0 && spend >= config2.zeroConversionSpendThreshold) {
        shouldNegate = true;
        reason = `\u96F6\u8F6C\u5316\u9AD8\u82B1\u8D39: $${spend.toFixed(2)}\u82B1\u8D39, 0\u8BA2\u5355, ${clicks}\u70B9\u51FB`;
        severity = "critical";
      }
      if (!shouldNegate && acos > config2.highAcosThreshold && spend >= config2.highAcosSpendThreshold) {
        shouldNegate = true;
        reason = `\u9AD8ACoS: ${acos.toFixed(0)}%, \u82B1\u8D39$${spend.toFixed(2)}, ${orders}\u8BA2\u5355`;
        severity = "high";
      }
      if (!shouldNegate) {
        const matchedBrand = config2.competitorBrands.find((brand) => searchTerm.includes(brand));
        if (matchedBrand && spend > 5) {
          shouldNegate = true;
          reason = `\u7ADE\u54C1\u54C1\u724C\u8BCD"${matchedBrand}": \u82B1\u8D39$${spend.toFixed(2)}, ACoS=${acos.toFixed(0)}%`;
          severity = "high";
        }
      }
      if (!shouldNegate) {
        const matchedCategory = config2.irrelevantCategories.find((cat) => searchTerm.includes(cat));
        if (matchedCategory && spend > 10) {
          shouldNegate = true;
          reason = `\u4E0D\u76F8\u5173\u54C1\u7C7B\u8BCD"${matchedCategory}": \u82B1\u8D39$${spend.toFixed(2)}, ACoS=${acos.toFixed(0)}%`;
          severity = "medium";
        }
      }
      if (!shouldNegate) continue;
      const existingNeg = await dbInstance.execute(sql`
        SELECT id FROM negative_keywords
        WHERE accountId = ${accountId}
          AND negativeText = ${searchTerm}
          AND campaignId = ${row.campaignId}
        LIMIT 1
      `);
      const existingRows = Array.isArray(existingNeg) ? Array.isArray(existingNeg[0]) ? existingNeg[0] : existingNeg : [];
      if (existingRows.length > 0) continue;
      try {
        await dbInstance.insert(negativeKeywords).values({
          accountId,
          campaignId: String(row.campaignId),
          negativeLevel: "campaign",
          negativeType: "keyword",
          negativeText: searchTerm,
          negativeMatchType: "negative_exact",
          negativeSource: "auto_optimization",
          sourceReason: reason,
          negativeStatus: "active"
        });
        const rowCampaignType = String(row.campaignType || "").toLowerCase();
        if (rowCampaignType === "sb" || rowCampaignType === "sd") {
          log144.info(`[AutoStopLoss] v614i-P1: \u8DF3\u8FC7SB/SD\u5426\u5B9A\u8BCD: campaign_type=${row.campaignType}, keyword="${searchTerm}", campaignId=${row.campaignId}`);
        } else {
          negativeKeywordsToSync.push({
            campaignId: String(row.campaignId),
            keywordText: searchTerm,
            matchType: "negativeExact",
            level: "campaign"
          });
        }
        recordAudit({
          action: "negative_keyword.add",
          accountId,
          entityType: "search_term",
          entityId: String(row.id),
          entityName: searchTerm,
          source: "system",
          metadata: { reason: `[AutoStopLoss] ${reason}` }
        });
        actions.push({
          actionType: "search_term_negate",
          entityType: "search_term",
          entityId: Number(row.id) || 0,
          entityName: searchTerm,
          accountId,
          reason,
          confidence: severity === "critical" ? 0.95 : severity === "high" ? 0.85 : 0.75,
          severity,
          autoExecuted: true,
          executedAt: /* @__PURE__ */ new Date(),
          details: { spend, sales, orders, clicks, acos, campaignId: row.campaignId }
        });
      } catch (negErr) {
        log144.warn(`[AutoStopLoss] \u5426\u5B9A\u8BCD\u6DFB\u52A0\u5931\u8D25(${searchTerm}): ${negErr.message}`);
      }
    }
    if (negativeKeywordsToSync.length > 0) {
      try {
        const syncResult = await syncNegativeKeywordsToAmazon(accountId, negativeKeywordsToSync);
        log144.info(`[AutoStopLoss] \u5426\u5B9A\u8BCDAPI\u540C\u6B65: \u6210\u529F=${syncResult.success}, \u5931\u8D25=${syncResult.failed}`);
      } catch (apiErr) {
        log144.warn(`[AutoStopLoss] \u5426\u5B9A\u8BCD\u6279\u91CFAPI\u540C\u6B65\u5931\u8D25: ${apiErr.message}`);
      }
    }
    log144.info(`[AutoStopLoss] \u641C\u7D22\u8BCD\u626B\u63CF\u5B8C\u6210: ${actions.length}\u4E2A\u641C\u7D22\u8BCD\u5DF2\u5426\u5B9A`);
  } catch (err) {
    log144.error(`[AutoStopLoss] \u641C\u7D22\u8BCD\u626B\u63CF\u5F02\u5E38: [${err.code || err.errno || "UNKNOWN"}] ${err.message}`);
  }
  return actions;
}
async function scanReactivatedCampaigns(accountId) {
  const actions = [];
  const config2 = STOP_LOSS_CONFIG.reactivationGuard;
  try {
    const dbInstance = await getDb();
    if (!dbInstance) return actions;
    const checkWindowStart = /* @__PURE__ */ new Date();
    checkWindowStart.setHours(checkWindowStart.getHours() - config2.checkWindowHours);
    const reactivated = await dbInstance.execute(sql`
      SELECT c.id, c.campaignId, c.campaignName, c.campaignType, c.campaignStatus, c.updatedAt
      FROM campaigns c
      WHERE c.accountId = ${accountId}
        AND c.campaignStatus = 'enabled'
        AND c.updatedAt >= ${checkWindowStart.toISOString()}
    `);
    const rows = Array.isArray(reactivated) ? Array.isArray(reactivated[0]) ? reactivated[0] : reactivated : [];
    if (rows.length < config2.batchReactivationThreshold) {
      log144.debug(`[AutoStopLoss] \u91CD\u65B0\u6FC0\u6D3B\u68C0\u67E5: ${rows.length}\u4E2ACampaign (\u4F4E\u4E8E\u9608\u503C${config2.batchReactivationThreshold})`);
      return actions;
    }
    log144.warn(`[AutoStopLoss] \u68C0\u6D4B\u5230\u6279\u91CF\u91CD\u65B0\u6FC0\u6D3B: ${rows.length}\u4E2ACampaign\u5728${config2.checkWindowHours}\u5C0F\u65F6\u5185\u88AB\u6FC0\u6D3B`);
    const historyStartDate = /* @__PURE__ */ new Date();
    historyStartDate.setDate(historyStartDate.getDate() - 90);
    const historyStartStr = historyStartDate.toISOString().split("T")[0];
    const campaignsToRollback = [];
    for (const row of rows) {
      const historyData = await dbInstance.execute(sql`
        SELECT 
          COALESCE(SUM(spend), 0) as totalSpend,
          COALESCE(SUM(sales), 0) as totalSales,
          COALESCE(SUM(orders), 0) as totalOrders
        FROM daily_performance
        WHERE campaignId = ${row.campaignId}
          AND accountId = ${accountId}
          AND date >= ${historyStartStr}
      `);
      const historyRows = Array.isArray(historyData) ? Array.isArray(historyData[0]) ? historyData[0] : historyData : [];
      const totalSpend = Number(historyRows[0]?.totalSpend) || 0;
      const totalSales = Number(historyRows[0]?.totalSales) || 0;
      const totalOrders = Number(historyRows[0]?.totalOrders) || 0;
      const historicalAcos = totalSales > 0 ? totalSpend / totalSales * 100 : totalSpend > 0 ? 999 : 0;
      if (historicalAcos > config2.historicalAcosThreshold && totalSpend > 20) {
        if (false && config2.autoRollbackEnabled) { /* v619-fix: disabled auto-rollback permanently */
          await dbInstance.update(campaigns).set({ campaignStatus: "paused" }).where(eq(campaigns.id, Number(row.id)));
          campaignsToRollback.push({
            amazonCampaignId: String(row.campaignId),
            newStatus: "paused",
            campaignName: String(row.campaignName),
            campaignType: String(row.campaignType || ""),
            reason: `[AutoStopLoss] \u91CD\u65B0\u6FC0\u6D3B\u9632\u62A4: \u5386\u53F2ACoS=${historicalAcos.toFixed(0)}%`
          });
          recordAudit({
            action: "campaign.pause",
            accountId,
            entityType: "campaign",
            entityId: Number(row.id),
            entityName: String(row.campaignName),
            previousValue: "enabled",
            newValue: "paused",
            source: "system",
            metadata: { reason: `[AutoStopLoss] \u91CD\u65B0\u6FC0\u6D3B\u9632\u62A4\u56DE\u6EDA: \u5386\u53F2ACoS=${historicalAcos.toFixed(0)}%` }
          });
          actions.push({
            actionType: "reactivation_rollback",
            entityType: "campaign",
            entityId: Number(row.id),
            entityName: String(row.campaignName),
            accountId,
            reason: `\u6279\u91CF\u91CD\u65B0\u6FC0\u6D3B\u9632\u62A4: \u5386\u53F2ACoS=${historicalAcos.toFixed(0)}%\uFF08>${config2.historicalAcosThreshold}%\uFF09\uFF0C\u5DF2\u81EA\u52A8\u56DE\u6EDA\u4E3Apaused`,
            previousValue: "enabled",
            newValue: "paused",
            confidence: 0.85,
            severity: "high",
            autoExecuted: true,
            executedAt: /* @__PURE__ */ new Date(),
            details: { historicalAcos, totalSpend, totalSales, totalOrders }
          });
          logOptimizationWarn("AutoStopLoss", `\u91CD\u65B0\u6FC0\u6D3B\u56DE\u6EDA: ${row.campaignName} (\u5386\u53F2ACoS=${historicalAcos.toFixed(0)}%)`);
        }
      }
    }
    if (campaignsToRollback.length > 0) {
      try {
        await syncCampaignStatusToAmazon(accountId, campaignsToRollback);
      } catch (apiErr) {
        log144.warn(`[AutoStopLoss] \u56DE\u6EDAAPI\u540C\u6B65\u5931\u8D25: ${apiErr.message}`);
      }
    }
    log144.info(`[AutoStopLoss] \u91CD\u65B0\u6FC0\u6D3B\u9632\u62A4\u5B8C\u6210: ${actions.length}\u4E2ACampaign\u5DF2\u56DE\u6EDA`);
  } catch (err) {
    log144.error(`[AutoStopLoss] \u91CD\u65B0\u6FC0\u6D3B\u9632\u62A4\u5F02\u5E38: ${err.message}`);
  }
  return actions;
}
async function scanAndRepairDataCliffs(accountId) {
  const actions = [];
  const config2 = STOP_LOSS_CONFIG.dataCliffRepair;
  try {
    const dbInstance = await getDb();
    if (!dbInstance) return actions;
    const coreKeywords = await dbInstance.execute(sql`
      SELECT 
        k.id, k.keywordId, k.keywordText, k.matchType, 
        k.bid as currentBid,
        k.orders as totalOrders,
        k.clicks as totalClicks,
        k.impressions as totalImpressions,
        k.spend as totalSpend,
        k.keywordCpc as historicalCpc,
        k.campaignId,
        c.campaignName
      FROM keywords k
      JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
      WHERE k.accountId = ${accountId}
        AND k.keywordStatus = 'enabled'
        AND k.bid IS NOT NULL
        AND k.orders >= ${config2.historicalOrderThreshold}
    `);
    const kwRows = Array.isArray(coreKeywords) ? Array.isArray(coreKeywords[0]) ? coreKeywords[0] : coreKeywords : [];
    log144.info(`[AutoStopLoss] \u6570\u636E\u60AC\u5D16\u626B\u63CF: ${kwRows.length}\u4E2A\u6838\u5FC3\u5173\u952E\u8BCD(\u5386\u53F2\u8BA2\u5355>=${config2.historicalOrderThreshold}) (accountId=${accountId})`);
    const bidAdjustments = [];
    for (const kw of kwRows) {
      try {
        const currentBid = Number(kw.currentBid) || 0;
        const historicalCpc = Number(kw.historicalCpc) || 0;
        const totalOrders = Number(kw.totalOrders) || 0;
        const totalClicks = Number(kw.totalClicks) || 0;
        if (currentBid <= 0 || historicalCpc <= 0) continue;
        const bidGapPercent = (historicalCpc - currentBid) / historicalCpc * 100;
        if (bidGapPercent < 30) continue;
        const maxIncrease = currentBid * (config2.maxBidIncreasePercent / 100);
        const targetBid = historicalCpc;
        const actualIncrease = Math.min(targetBid - currentBid, maxIncrease);
        if (actualIncrease <= 0.01) continue;
        const newBid = Math.round((currentBid + actualIncrease) * 100) / 100;
        log144.warn(`[AutoStopLoss] \u6570\u636E\u60AC\u5D16\u68C0\u6D4B: "${kw.keywordText}" (${kw.matchType}) \u7ADE\u4EF7\u4FEE\u590D $${currentBid} \u2192 $${newBid} (\u5386\u53F2CPC=$${historicalCpc.toFixed(2)}, \u5386\u53F2\u8BA2\u5355=${totalOrders})`);
        await dbInstance.update(keywords).set({ bid: String(newBid) }).where(eq(keywords.id, Number(kw.id)));
        bidAdjustments.push({
          keywordId: Number(kw.id),
          newBid,
          reason: `[AutoStopLoss] \u6570\u636E\u60AC\u5D16\u4FEE\u590D: $${currentBid}\u2192$${newBid}`
        });
        recordAudit({
          action: "keyword.bid_change",
          accountId,
          entityType: "keyword",
          entityId: Number(kw.id),
          entityName: `${kw.keywordText} (${kw.matchType})`,
          previousValue: String(currentBid),
          newValue: String(newBid),
          source: "system",
          metadata: { reason: `[AutoStopLoss] \u6570\u636E\u60AC\u5D16\u4FEE\u590D: \u5386\u53F2CPC=$${historicalCpc.toFixed(2)}, \u5386\u53F2\u8BA2\u5355=${totalOrders}` }
        });
        actions.push({
          actionType: "bid_restore",
          entityType: "keyword",
          entityId: Number(kw.id),
          entityName: `${kw.keywordText} (${kw.matchType})`,
          accountId,
          reason: `\u6570\u636E\u60AC\u5D16\u4FEE\u590D: \u7ADE\u4EF7($${currentBid})\u8FDC\u4F4E\u4E8E\u5386\u53F2CPC($${historicalCpc.toFixed(2)})\uFF0C\u6062\u590D\u81F3$${newBid}`,
          previousValue: currentBid,
          newValue: newBid,
          confidence: 0.8,
          severity: "high",
          autoExecuted: true,
          executedAt: /* @__PURE__ */ new Date(),
          details: {
            bidGapPercent,
            historicalCpc,
            totalOrders,
            totalClicks,
            campaignName: kw.campaignName
          }
        });
        logOptimization("AutoStopLoss", `\u6570\u636E\u60AC\u5D16\u4FEE\u590D: ${kw.keywordText} ($${currentBid}\u2192$${newBid})`);
      } catch (kwErr) {
        log144.warn(`[AutoStopLoss] \u5173\u952E\u8BCD ${kw.id} \u60AC\u5D16\u68C0\u6D4B\u5F02\u5E38: ${kwErr.message}`);
      }
    }
    if (bidAdjustments.length > 0) {
      try {
        await syncBidAdjustmentsToAmazon(accountId, bidAdjustments.map((adj) => ({
          keywordId: adj.keywordId,
          newBid: adj.newBid,
          reason: adj.reason,
          algorithmUsed: "auto_stop_loss_cliff_repair"
        })));
      } catch (apiErr) {
        log144.warn(`[AutoStopLoss] \u7ADE\u4EF7\u4FEE\u590DAPI\u540C\u6B65\u5931\u8D25: ${apiErr.message}`);
      }
    }
    log144.info(`[AutoStopLoss] \u6570\u636E\u60AC\u5D16\u626B\u63CF\u5B8C\u6210: ${actions.length}\u4E2A\u5173\u952E\u8BCD\u7ADE\u4EF7\u5DF2\u4FEE\u590D`);
  } catch (err) {
    log144.error(`[AutoStopLoss] \u6570\u636E\u60AC\u5D16\u626B\u63CF\u5F02\u5E38: ${err.message}`);
  }
  return actions;
}
async function executeFullStopLossScan(accountId) {
  const startTime = Date.now();
  const allActions = [];
  log144.info(`[AutoStopLoss] ========== \u5F00\u59CB\u5168\u91CF\u6B62\u8840\u626B\u63CF (accountId=${accountId}) ==========`);
  try {
    const pauseActions = await scanAndPauseHighAcosCampaigns(accountId);
    allActions.push(...pauseActions);
  } catch (err) {
    log144.error(`[AutoStopLoss] Campaign\u6682\u505C\u626B\u63CF\u5931\u8D25: ${err.message}`);
  }
  try {
    const negateActions = await scanAndNegateSearchTerms(accountId);
    allActions.push(...negateActions);
  } catch (err) {
    log144.error(`[AutoStopLoss] \u641C\u7D22\u8BCD\u5426\u5B9A\u626B\u63CF\u5931\u8D25: ${err.message}`);
  }
  try {
    const reactivationActions = await scanReactivatedCampaigns(accountId);
    allActions.push(...reactivationActions);
  } catch (err) {
    log144.error(`[AutoStopLoss] \u91CD\u65B0\u6FC0\u6D3B\u9632\u62A4\u5931\u8D25: ${err.message}`);
  }
  try {
    const cliffActions = await scanAndRepairDataCliffs(accountId);
    allActions.push(...cliffActions);
  } catch (err) {
    log144.error(`[AutoStopLoss] \u6570\u636E\u60AC\u5D16\u4FEE\u590D\u5931\u8D25: ${err.message}`);
  }
  const duration3 = Date.now() - startTime;
  const result = {
    accountId,
    scanTime: /* @__PURE__ */ new Date(),
    duration: duration3,
    actions: allActions,
    summary: {
      campaignsPaused: allActions.filter((a) => a.actionType === "campaign_pause" && a.autoExecuted).length,
      searchTermsNegated: allActions.filter((a) => a.actionType === "search_term_negate").length,
      bidsRestored: allActions.filter((a) => a.actionType === "bid_restore").length,
      reactivationsRolledBack: allActions.filter((a) => a.actionType === "reactivation_rollback").length,
      budgetAlerts: allActions.filter((a) => a.actionType === "budget_alert").length
    }
  };
  log144.info(`[AutoStopLoss] ========== \u5168\u91CF\u6B62\u8840\u626B\u63CF\u5B8C\u6210 (${duration3}ms) ==========`);
  log144.info(`[AutoStopLoss] \u6C47\u603B: Campaign\u6682\u505C=${result.summary.campaignsPaused}, \u641C\u7D22\u8BCD\u5426\u5B9A=${result.summary.searchTermsNegated}, \u7ADE\u4EF7\u4FEE\u590D=${result.summary.bidsRestored}, \u91CD\u65B0\u6FC0\u6D3B\u56DE\u6EDA=${result.summary.reactivationsRolledBack}`);
  if (allActions.some((a) => a.severity === "critical")) {
    try {
      const criticalActions = allActions.filter((a) => a.severity === "critical");
      await notifyOwner({
        title: `[\u6B62\u8840\u9884\u8B66] \u81EA\u52A8\u6B62\u8840\u7CFB\u7EDF\u6267\u884C\u4E86${criticalActions.length}\u4E2A\u5173\u952E\u64CD\u4F5C`,
        content: criticalActions.map((a) => `\u2022 ${a.reason}`).join("\n")
      });
    } catch (notifyErr) {
      log144.warn(`[AutoStopLoss] \u901A\u77E5\u53D1\u9001\u5931\u8D25: ${notifyErr.message}`);
    }
  }
  return result;
}
function getStopLossConfig() {
  return { ...STOP_LOSS_CONFIG };
}
function updateStopLossConfig(updates) {
  Object.assign(STOP_LOSS_CONFIG, updates);
  log144.info(`[AutoStopLoss] \u914D\u7F6E\u5DF2\u66F4\u65B0: ${JSON.stringify(updates)}`);
}
var log144, STOP_LOSS_CONFIG;
var init_autoStopLossService = __esm({
  "server/automation/autoStopLossService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_logger();
    init_opsLogger();
    init_auditLogService2();
    init_amazonApiHelper();
    init_notification();
    log144 = createModuleLogger("AutoStopLoss");
    STOP_LOSS_CONFIG = {
      /** Campaign自动暂停规则 */
      campaignAutoPause: {
        /** 连续天数ACoS超阈值触发暂停 */
        consecutiveDays: 7,
        /** ACoS阈值（%），超过此值视为严重亏损 */
        acosThreshold: 300,
        /** 最低花费门槛（$），低于此值不触发（避免误判小额Campaign） */
        minSpendThreshold: 30,
        /** 最低点击门槛，低于此值不触发（数据量不足） */
        minClicksThreshold: 20,
        /** 是否排除有历史高转化的Campaign */
        excludeHistoricalPerformers: true,
        /** 历史高转化的定义：过去90天订单数>此值 */
        historicalOrderThreshold: 10
      },
      /** 搜索词自动否定规则 */
      searchTermAutoNegate: {
        /** 花费门槛（$），超过此值且零转化则否定 */
        zeroConversionSpendThreshold: 15,
        /** 高花费低转化的ACoS阈值（%） */
        highAcosThreshold: 200,
        /** 高花费低转化的花费门槛（$） */
        highAcosSpendThreshold: 30,
        /** 竞品品牌词列表（自动否定） */
        competitorBrands: [
          "better me",
          "betterme",
          "bala",
          "blogilates",
          "p.volve",
          "pvolve",
          "balanced body",
          "merrithew",
          "stott",
          "gaiam"
        ],
        /** 不相关品类词列表（自动否定） */
        irrelevantCategories: [
          "yoga mat",
          "yoga block",
          "resistance bands for working out",
          "dumbbells",
          "kettlebell",
          "jump rope",
          "treadmill",
          "calf stretcher",
          "slant board",
          "foam roller"
        ]
      },
      /** Campaign重新激活防护 */
      reactivationGuard: {
        /** 检查窗口（小时），在此时间内批量重新激活触发警报 */
        checkWindowHours: 24,
        /** 批量重新激活阈值，超过此数量触发警报 */
        batchReactivationThreshold: 999,
        /** 是否自动回滚无策略的批量重新激活 */
        autoRollbackEnabled: false,
        /** 历史ACoS阈值（%），超过此值的Campaign重新激活需要审批 */
        historicalAcosThreshold: 100
      },
      /** 数据悬崖自动修复 */
      dataCliffRepair: {
        /** 历史订单数门槛，超过此值的关键词触发悬崖检测 */
        historicalOrderThreshold: 4,
        /** 流量下降幅度阈值（%），超过此值视为悬崖 */
        trafficDropThreshold: 50,
        /** 修复时使用的历史CPC回溯天数 */
        historicalCpcLookbackDays: 90,
        /** 单次修复的最大竞价提升幅度（%） */
        maxBidIncreasePercent: 100
      }
    };
    __name(scanAndPauseHighAcosCampaigns, "scanAndPauseHighAcosCampaigns");
    __name(scanAndNegateSearchTerms, "scanAndNegateSearchTerms");
    __name(scanReactivatedCampaigns, "scanReactivatedCampaigns");
    __name(scanAndRepairDataCliffs, "scanAndRepairDataCliffs");
    __name(executeFullStopLossScan, "executeFullStopLossScan");
    __name(getStopLossConfig, "getStopLossConfig");
    __name(updateStopLossConfig, "updateStopLossConfig");
  }
});

