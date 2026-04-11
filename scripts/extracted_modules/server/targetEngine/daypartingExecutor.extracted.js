// Extracted from production dist/index.js
// Original module: server/targetEngine/daypartingExecutor.ts
// Lines: 580

async function executeDaypartingOptimization(config2, campaigns6, dryRun) {
  const details = [];
  let adjustmentsCount = 0;
  const marketplace = config2.marketplace || "US";
  const now = /* @__PURE__ */ new Date();
  const currentHour = getLocalHour(now, marketplace);
  const currentDayOfWeek = getLocalDayOfWeek(now, marketplace);
  let comboAnalysisMap = /* @__PURE__ */ new Map();
  try {
    const dbConn = await getDb();
    if (dbConn) {
      const comboResults = await getComboAnalysisForAccount(dbConn, config2.accountId);
      for (const combo of comboResults) {
        if (combo.keywordId) {
          comboAnalysisMap.set(combo.keywordId, combo);
        }
      }
      log104.info(`[DaypartingOptimization] v183: \u52A0\u8F7D${comboAnalysisMap.size}\u4E2A\u6295\u653E\u8BCD\u7684\u591A\u7EF4\u5EA6\u7EC4\u5408\u5206\u6790\u7ED3\u679C`);
    }
  } catch (comboErr) {
    log104.warn(`[DaypartingOptimization] v183: \u52A0\u8F7D\u7EC4\u5408\u5206\u6790\u7ED3\u679C\u5931\u8D25\uFF0C\u4F7F\u7528\u7EDF\u4E00\u4E58\u6570: ${comboErr.message}`);
  }
  const maxBidLimit = config2.maxBid || 2;
  try {
    const dbConn2 = await getDb();
    if (dbConn2 && config2.performanceGroupId) {
      const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
      const pendingDayparting = await dbConn2.execute(sql15`
        SELECT ol.id, ol.action_detail, ol.created_at,
               JSON_UNQUOTE(JSON_EXTRACT(ol.action_detail, '$.keywordId')) as kw_id,
               JSON_UNQUOTE(JSON_EXTRACT(ol.action_detail, '$.newBid')) as new_bid,
               JSON_UNQUOTE(JSON_EXTRACT(ol.action_detail, '$.baseBid')) as base_bid
        FROM optimization_logs ol
        WHERE ol.performance_group_id = ${config2.performanceGroupId}
          AND ol.action_type = 'dayparting_bid'
          AND ol.api_sync_status = 'pending'
        ORDER BY ol.created_at DESC
        LIMIT 50
      `);
      const pendingRows = pendingDayparting[0] || [];
      if (pendingRows.length > 0) {
        log104.info(`[DaypartingOptimization] v310: \u53D1\u73B0${pendingRows.length}\u6761pending\u7684dayparting_bid\uFF0C\u5F00\u59CB\u5904\u7406`);
        let retried = 0, superseded = 0, timedOut = 0;
        const latestByKeyword = /* @__PURE__ */ new Map();
        const olderIds = [];
        for (const row of pendingRows) {
          const kwId = row.kw_id;
          if (!kwId) continue;
          if (latestByKeyword.has(kwId)) {
            olderIds.push(row.id);
          } else {
            latestByKeyword.set(kwId, row);
          }
        }
        if (olderIds.length > 0) {
          await dbConn2.execute(sql15`
            UPDATE optimization_logs SET api_sync_status = 'superseded',
              api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.superseded_reason', 'v310: 同一keyword已有更新的分时竞价指令')
            WHERE id IN (${safeInClause(olderIds)})
          `);
          superseded = olderIds.length;
        }
        for (const [kwId, row] of latestByKeyword) {
          try {
            const detail = typeof row.action_detail === "string" ? JSON.parse(row.action_detail) : row.action_detail;
            const newBid = parseFloat(detail?.newBid || detail?.adjustedBid || "0");
            const localCampaignId = detail?.localCampaignId;
            const amazonCampaignId = detail?.amazonCampaignId;
            const createdAt = new Date(row.created_at);
            const ageHours = (Date.now() - createdAt.getTime()) / (1e3 * 60 * 60);
            if (ageHours > 72) {
              await dbConn2.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'superseded',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.superseded_reason', 'v310: 分时竞价超过72小时已过时')
 WHERE id = ${row.id}
 `);
              timedOut++;
              continue;
            }
            if (newBid > 0 && Number(kwId) > 0) {
              // v620-fix13: Extract isProductTarget from actionDetail
              const isPT_pending = detail?.isProductTarget === true || detail?.targetType === 'product' || detail?.bidObjectType === 'asin' || false;
              if (isPT_pending) log104.info(`[v620-fix13] Pending dayparting_bid retry: kwId=${kwId} is ProductTarget`);
              const syncResult = await syncBidAdjustmentsToAmazon(
                config2.accountId,
                [{
                  // @ts-ignore
                  keywordId: Number(kwId),
                  newBid,
                  localCampaignId,
                  amazonCampaignId,
                  // @ts-ignore
                  reason: "v310: pending dayparting_bid\u91CD\u8BD5",
                  isProductTarget: isPT_pending,
                  productTargetId: isPT_pending ? Number(kwId) : undefined
                }]
              );
              if (syncResult.success > 0) {
                await dbConn2.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'synced',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_synced', 'v310: dayparting_bid重试成功')
 WHERE id = ${row.id}
 `);
                retried++;
              } else {
                await dbConn2.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'failed',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_error', ${syncResult.errors.join("; ")})
 WHERE id = ${row.id}
 `);
              }
            }
          } catch (retryErr) {
            log104.warn(`[DaypartingOptimization] v310: dayparting_bid\u91CD\u8BD5\u5931\u8D25 kwId=${kwId}: ${retryErr.message}`);
          }
        }
        log104.warn(`[DaypartingOptimization] v310: pending dayparting_bid\u5904\u7406\u5B8C\u6210: \u91CD\u8BD5\u6210\u529F=${retried}, \u5DF2\u8FC7\u65F6=${timedOut}, \u5DF2\u8986\u76D6=${superseded}`);
      }
    }
  } catch (pendingErr) {
    log104.warn(`[DaypartingOptimization] v310: pending dayparting_bid\u5904\u7406\u5931\u8D25: ${pendingErr.message}`);
  }
  let dpDiag = { total: 0, noStrategy: 0, draftInsufficient: 0, draftUpgraded: 0, draftUpgradeFailed: 0, noHourlyRule: 0, noKeywords: 0, bidUnchanged: 0, adjusted: 0 };
  log104.info(`[DaypartingOptimization] v349: \u5F00\u59CB\u5206\u65F6\u7ADE\u4EF7\u6267\u884C, campaigns=${campaigns6.length}, hour=${currentHour}, dayOfWeek=${currentDayOfWeek}, marketplace=${marketplace}`);
  let dpCampaignIndex = 0;
  for (const campaign of campaigns6) {
    if (dpCampaignIndex > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5e3));
    }
    dpCampaignIndex++;
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    dpDiag.total++;
    try {
      let strategy = await getDaypartingStrategyByCampaignId(campaignAmazonId);
      if (!strategy) {
        strategy = await ensureDaypartingStrategy(
          config2.accountId,
          campaignAmazonId,
          // @ts-ignore
          campaign.campaignName,
          {
            optimizationGoal: config2.optimizationGoal,
            // @ts-ignore
            targetAcos: config2.targetAcos,
            targetRoas: config2.targetRoas
          }
        );
      }
      if (strategy && strategy.daypartingStatus === "draft") {
        try {
          const dataValidation = await validateDaypartingDataSufficiency(Number(campaignAmazonId), 30);
          if (!dataValidation.isValid) {
            dpDiag.draftInsufficient++;
            log104.info(`[DaypartingOptimization] v510: \u5E7F\u544A\u6D3B\u52A8 ${campaign.campaignName} \u6570\u636E\u4E0D\u8DB3\uFF0C\u4FDD\u6301draft | ${dataValidation.failedChecks.join("; ")} | ${dataValidation.recommendation}`);
          }
          const weeklyData = await analyzeWeeklyPerformance(Number(campaignAmazonId), 30);
          const totalDataPoints = weeklyData.reduce((sum2, d) => sum2 + d.dataPoints, 0);
          if (dataValidation.isValid && totalDataPoints >= 7) {
            const hourlyData = await analyzeHourlyPerformance(Number(campaignAmazonId), 30);
            if (hourlyData.length > 0) {
              const bidAdjustments = calculateOptimalBidAdjustments(hourlyData, {
                // @ts-ignore
                optimizationGoal: config2.optimizationGoal,
                targetAcos: config2.targetAcos,
                // @ts-ignore
                targetRoas: config2.targetRoas
              });
              await saveBidRules(strategy.id, bidAdjustments.map((rule) => ({
                dayOfWeek: rule.dayOfWeek,
                hour: rule.hour,
                bidMultiplier: rule.bidMultiplier.toString(),
                avgClicks: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgClicks?.toString(),
                avgSpend: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSpend?.toString(),
                avgSales: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSales?.toString(),
                avgCvr: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCvr?.toString(),
                avgCpc: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCpc?.toString(),
                avgAcos: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgAcos?.toString(),
                dataPoints: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.dataPoints || 0,
                isEnabled: 1
              })));
              const budgetAllocation = calculateOptimalBudgetAllocation(weeklyData, {
                // @ts-ignore
                optimizationGoal: config2.optimizationGoal,
                targetAcos: config2.targetAcos,
                targetRoas: config2.targetRoas
              });
              await saveBudgetRules(strategy.id, budgetAllocation.map((rule) => ({
                dayOfWeek: rule.dayOfWeek,
                // @ts-ignore
                budgetMultiplier: rule.budgetMultiplier.toString(),
                budgetPercentage: rule.budgetPercentage.toString(),
                avgSpend: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgSpend?.toString(),
                avgSales: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgSales?.toString(),
                avgAcos: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgAcos?.toString(),
                avgRoas: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgRoas?.toString(),
                dataPoints: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.dataPoints || 0,
                isEnabled: 1
              })));
              await updateDaypartingStrategy(strategy.id, { daypartingStatus: "active" });
              strategy.daypartingStatus = "active";
              log104.info(`[DaypartingOptimization] v337: \u81EA\u52A8\u5347\u7EA7\u5206\u65F6\u7B56\u7565 strategyId=${strategy.id} \u4ECEdraft\u2192active\uFF0C\u6570\u636E\u70B9=${totalDataPoints}\uFF0C\u5C0F\u65F6\u6570\u636E=${hourlyData.length}\u6761`);
            }
          } else if (!dataValidation.isValid) {
          } else {
            log104.info(`[DaypartingOptimization] v510: \u5E7F\u544A\u6D3B\u52A8 ${campaign.campaignName} \u6570\u636E\u70B9\u4E0D\u8DB3(${totalDataPoints}<7)\uFF0C\u4FDD\u6301draft\u72B6\u6001`);
          }
        } catch (upgradeErr) {
          dpDiag.draftUpgradeFailed++;
          log104.warn(`[DaypartingOptimization] v337: \u81EA\u52A8\u5347\u7EA7\u5206\u65F6\u7B56\u7565\u5931\u8D25: ${upgradeErr.message}`);
        }
      }
      if (!strategy || strategy.daypartingStatus !== "active") {
        dpDiag.noStrategy++;
        continue;
      }
      try {
        const lastAnalyzed = strategy.lastAnalyzedAt ? new Date(strategy.lastAnalyzedAt).getTime() : 0;
        const hoursSinceLastAnalysis = (Date.now() - lastAnalyzed) / (1e3 * 60 * 60);
        if (hoursSinceLastAnalysis >= 24) {
          const hourlyData = await analyzeHourlyPerformance(Number(campaignAmazonId), 30);
          if (hourlyData.length > 0) {
            const bidAdjustments = calculateOptimalBidAdjustments(hourlyData, {
              // @ts-ignore
              optimizationGoal: config2.optimizationGoal,
              targetAcos: config2.targetAcos,
              targetRoas: config2.targetRoas
            });
            await saveBidRules(strategy.id, bidAdjustments.map((rule) => ({
              dayOfWeek: rule.dayOfWeek,
              hour: rule.hour,
              bidMultiplier: rule.bidMultiplier.toString(),
              avgClicks: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgClicks?.toString(),
              avgSpend: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSpend?.toString(),
              avgSales: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSales?.toString(),
              avgCvr: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCvr?.toString(),
              avgCpc: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCpc?.toString(),
              avgAcos: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgAcos?.toString(),
              dataPoints: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.dataPoints || 0,
              isEnabled: 1
            })));
            await updateDaypartingStrategy(strategy.id, { lastAnalyzedAt: (/* @__PURE__ */ new Date()).toISOString() });
            log104.info(`[DaypartingOptimization] v351: \u91CD\u65B0\u8BA1\u7B97\u5206\u65F6\u89C4\u5219 strategyId=${strategy.id}, \u4E0A\u6B21\u5206\u6790=${hoursSinceLastAnalysis.toFixed(0)}h\u524D`);
          }
        }
      } catch (recalcErr) {
        log104.warn(`[DaypartingOptimization] v351: \u91CD\u65B0\u8BA1\u7B97\u5206\u65F6\u89C4\u5219\u5931\u8D25: ${recalcErr.message}`);
      }
      const hourlyRule = await getHourlyRule(strategy.id, currentDayOfWeek, currentHour);
      if (!hourlyRule) {
        dpDiag.noHourlyRule++;
        continue;
      }
      const baseDaypartingMultiplier = parseFloat(hourlyRule.bidMultiplier || "1.00");
      const keywords10 = await getKeywordsByCampaignId(campaignAmazonId);
      for (const keyword of keywords10) {
        if (keyword.keywordStatus !== "enabled") continue;
        const baseBid = parseFloat(keyword.bid || "0");
        if (baseBid <= 0) continue;
        let comboTimeMultiplier = 1;
        let comboBidMultiplier = 1;
        let comboCategory = "standard";
        let comboConfidence = "insufficient";
        const comboAnalysis = comboAnalysisMap.get(keyword.id);
        if (comboAnalysis) {
          comboCategory = comboAnalysis.comboCategory || "standard";
          comboConfidence = comboAnalysis.confidenceLevel || "insufficient";
          if (comboConfidence !== "insufficient") {
            comboBidMultiplier = parseFloat(comboAnalysis.suggestedBidMultiplier || "1.000");
            comboTimeMultiplier = parseFloat(comboAnalysis.suggestedTimeMultiplier || "1.000");
            const bestWindows = comboAnalysis.bestTimeWindows || [];
            const worstWindows = comboAnalysis.worstTimeWindows || [];
            const isInBestWindow = bestWindows.some(
              (w) => (
                // @ts-ignore
                w.dayOfWeek === currentDayOfWeek && currentHour >= w.startHour && currentHour <= w.endHour
              )
            );
            const isInWorstWindow = worstWindows.some(
              (w) => (
                // @ts-ignore
                w.dayOfWeek === currentDayOfWeek && currentHour >= w.startHour && currentHour <= w.endHour
              )
            );
            if (isInBestWindow) {
              comboTimeMultiplier = Math.min(comboTimeMultiplier * 1.15, 1.3);
            } else if (isInWorstWindow) {
              comboTimeMultiplier = Math.max(comboTimeMultiplier * 0.85, 0.7);
            }
          }
        }
        const finalMultiplier = baseDaypartingMultiplier * comboBidMultiplier * comboTimeMultiplier;
        let adjustedBid = baseBid * finalMultiplier;
        const maxAdjustedBid = baseBid * DAYPARTING_DATA_THRESHOLDS.maxBidMultiplierUp;
        const minAdjustedBid = baseBid * DAYPARTING_DATA_THRESHOLDS.maxBidMultiplierDown;
        adjustedBid = Math.min(adjustedBid, maxAdjustedBid);
        adjustedBid = Math.max(adjustedBid, minAdjustedBid);
        adjustedBid = Math.min(adjustedBid, maxBidLimit);
        adjustedBid = Math.max(adjustedBid, 0.02);
        adjustedBid = Math.round(adjustedBid * 100) / 100;
        const reasonParts = [];
        reasonParts.push(`\u5206\u65F6${baseDaypartingMultiplier.toFixed(2)}x`);
        if (comboBidMultiplier !== 1) reasonParts.push(`\u6295\u653E\u8BCD${comboBidMultiplier.toFixed(3)}x`);
        if (comboTimeMultiplier !== 1) reasonParts.push(`\u65F6\u6BB5${comboTimeMultiplier.toFixed(3)}x`);
        if (comboCategory !== "standard") reasonParts.push(`[${comboCategory}]`);
        const adjustment = {
          accountId: config2.accountId,
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          // @ts-ignore
          campaignName: campaign.campaignName,
          keywordId: keyword.id,
          keywordText: keyword.keywordText,
          hour: currentHour,
          dayOfWeek: currentDayOfWeek,
          baseBid,
          bidMultiplier: finalMultiplier,
          baseDaypartingMultiplier,
          comboBidMultiplier,
          comboTimeMultiplier,
          comboCategory,
          comboConfidence,
          adjustedBid,
          // @ts-ignore
          currentBid: baseBid,
          newBid: adjustedBid,
          reason: `v183\u5206\u65F6\u7ADE\u4EF7: ${currentHour}:00 ${reasonParts.join(" \xD7 ")} = ${finalMultiplier.toFixed(3)}x, $${baseBid.toFixed(2)} \u2192 $${adjustedBid.toFixed(2)}`,
          algorithmUsed: "dayparting_engine",
          // v335: 添加算法标识
          apiSyncStatus: dryRun ? "pending" : "pending"
          // @ts-ignore
        };
        const bidDiff = Math.abs(adjustedBid - baseBid);
        const bidDiffPct = baseBid > 0 ? bidDiff / baseBid : 0;
        if (bidDiff < 5e-3 && bidDiffPct < 0.02) {
          continue;
        }
        details.push(adjustment);
        if (!dryRun) {
          try {
            const syncResult = await syncBidAdjustmentsToAmazon(
              config2.accountId,
              [{
                keywordId: keyword.id,
                newBid: adjustedBid,
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                reason: `v183\u5206\u65F6\u7ADE\u4EF7: ${reasonParts.join(" \xD7 ")}`,
                isProductTarget: false
              }]
            );
            if (syncResult.success > 0) {
              adjustmentsCount++;
              adjustment.apiSyncStatus = "synced";
            } else {
              adjustment.apiSyncStatus = "failed";
              adjustment.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
            }
          } catch (apiError) {
            try {
              await new Promise((r) => setTimeout(r, 2e3));
              const retryResult = await syncBidAdjustmentsToAmazon(
                config2.accountId,
                [{
                  keywordId: keyword.id,
                  newBid: adjustedBid,
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
                  reason: `v267\u5206\u65F6\u7ADE\u4EF7\u91CD\u8BD5: ${reasonParts.join(" \xD7 ")}`,
                  isProductTarget: false
                }]
              );
              if (retryResult.success > 0) {
                adjustmentsCount++;
                adjustment.apiSyncStatus = "synced";
                log104.info(`[DaypartingOptimization] v267 \u91CD\u8BD5\u6210\u529F (kw ${keyword.keywordText})`);
              } else {
                adjustment.apiSyncStatus = "failed";
                adjustment.apiSyncDetail = JSON.stringify({ error: apiError.message, retryFailed: true });
              }
            } catch (retryError) {
              adjustment.apiSyncStatus = "failed";
              adjustment.apiSyncDetail = JSON.stringify({ error: apiError.message, retryError: retryError.message });
              log104.warn(`[DaypartingOptimization] v267 \u91CD\u8BD5\u4E5F\u5931\u8D25 (kw ${keyword.keywordText}):`, retryError.message);
            }
          }
        }
      }
    } catch (error48) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        error: error48.message
      });
    }
  }
  log104.info(`[DaypartingOptimization] v349: \u5206\u65F6\u7ADE\u4EF7\u6267\u884C\u5B8C\u6210 - \u603B\u8BA1=${dpDiag.total}, \u65E0\u7B56\u7565/\u975Edraft=${dpDiag.noStrategy}, \u65E0\u5C0F\u65F6\u89C4\u5219=${dpDiag.noHourlyRule}, \u8C03\u6574=${adjustmentsCount}, \u8BE6\u60C5=${details.length}\u6761`);
  return { executed: true, adjustmentsCount, details };
}
async function executeDaypartingBudgetOptimization(config2, campaigns6, dryRun) {
  const details = [];
  let adjustmentsCount = 0;
  const marketplace = config2.marketplace || "US";
  const now = /* @__PURE__ */ new Date();
  const currentDayOfWeek = getLocalDayOfWeek(now, marketplace);
  let dpBudgetCampaignIndex = 0;
  for (const campaign of campaigns6) {
    if (dpBudgetCampaignIndex > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5e3));
    }
    dpBudgetCampaignIndex++;
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      let strategy = await getDaypartingStrategyByCampaignId(campaignAmazonId);
      if (!strategy || strategy.daypartingStatus !== "active") continue;
      const budgetRules = await getBudgetRules(strategy.id);
      const todayRule = budgetRules.find((r) => r.dayOfWeek === currentDayOfWeek);
      if (!todayRule) continue;
      let budgetMultiplier = parseFloat(todayRule.budgetMultiplier || "1.00");
      let comboBudgetMultiplier = 1;
      try {
        const dbConn = await getDb();
        if (!dbConn) throw new Error("Database not available");
        comboBudgetMultiplier = await getCampaignBudgetMultiplier(
          dbConn,
          config2.accountId,
          campaignLocalId
        );
        if (Math.abs(comboBudgetMultiplier - 1) > 1e-3) {
          log104.debug(`[DaypartingBudget] v183.1: Campaign ${campaign.campaignName} \u7EC4\u5408\u5206\u6790\u9884\u7B97\u4E58\u6570: ${comboBudgetMultiplier.toFixed(3)}`);
          budgetMultiplier = budgetMultiplier * comboBudgetMultiplier;
          budgetMultiplier = Math.max(0.8, Math.min(1.2, budgetMultiplier)); // v608c: 统一±20%限制
        }
      } catch (comboErr) {
        log104.warn(`[DaypartingBudget] v183.1: \u83B7\u53D6\u7EC4\u5408\u5206\u6790\u9884\u7B97\u4E58\u6570\u5931\u8D25: ${comboErr.message}`);
      }
      // v608c: 全局±20%限制 - 无论用户设置什么倍数，最终预算调整不超过±20%
      budgetMultiplier = Math.max(0.8, Math.min(1.2, budgetMultiplier));
      if (Math.abs(budgetMultiplier - 1) < 0.05) continue;
      const currentBudget = parseFloat(campaign.dailyBudget || "0");
      if (currentBudget <= 0) continue;
      const baseBudget = parseFloat(campaign.originalDailyBudget || campaign.dailyBudget || "0");
      const adjustedBudget = Math.round(baseBudget * budgetMultiplier * 100) / 100;
      const adjustment = {
        accountId: config2.accountId,
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        dayOfWeek: currentDayOfWeek,
        budgetMultiplier,
        // @ts-ignore
        baseBudget,
        currentBudget,
        adjustedBudget,
        changeAmount: adjustedBudget - currentBudget,
        changePercent: currentBudget > 0 ? ((adjustedBudget - currentBudget) / currentBudget * 100).toFixed(2) : "0",
        comboBudgetMultiplier,
        reason: `\u5206\u65F6\u9884\u7B97: \u661F\u671F${["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"][currentDayOfWeek]} \u500D\u6570${budgetMultiplier.toFixed(2)}x${comboBudgetMultiplier !== 1 ? ` (\u542B\u7EC4\u5408\u5206\u6790${comboBudgetMultiplier.toFixed(3)}x)` : ""}, $${currentBudget.toFixed(2)} \u2192 $${adjustedBudget.toFixed(2)}`,
        algorithmUsed: "dayparting_budget",
        // v335: 添加算法标识
        apiSyncStatus: "pending"
      };
      details.push(adjustment);
      if (!dryRun && Math.abs(adjustedBudget - currentBudget) > 0.5) {
        const dpCampaignType = (campaign.campaignType || "sp_manual").toLowerCase();
        if (dpCampaignType.startsWith("sp")) {
          try {
            let dpApiClient;
            try {
              const dpSyncService = await getAmazonSyncService2(config2.accountId);
              if (dpSyncService?.client?.listSpCampaignBudgetRules) dpApiClient = dpSyncService.client;
            } catch {
            }
            const dpBrAnalysis = await analyzeBudgetRules(config2.accountId, String(campaignAmazonId), dpApiClient);
            if (dpBrAnalysis.shouldSkipBudgetAdjustment) {
              adjustment.apiSyncStatus = "skipped_budget_rules";
              adjustment.apiSyncDetail = JSON.stringify({ reason: dpBrAnalysis.skipReason, activeRules: dpBrAnalysis.activeRuleCount });
              log104.info(`[DaypartingBudget] v614i-fix22: Campaign ${campaign.campaignName} Budget Rules\u667A\u80FD\u534F\u540C: \u8DF3\u8FC7 \u2014 ${dpBrAnalysis.skipReason}`);
              continue;
            }
          } catch (dpBrErr) {
            log104.warn(`[DaypartingBudget] v614i-fix22: Budget Rules\u5206\u6790\u5931\u8D25: ${dpBrErr.message}\uFF0C\u7EE7\u7EED\u6267\u884C\u5206\u65F6\u9884\u7B97\u8C03\u6574`);
          }
        }
        try {
          const amazonCampaignId = campaignAmazonId;
          const budgetSyncResult = await syncBudgetAdjustmentToAmazon(
            config2.accountId,
            amazonCampaignId,
            // @ts-ignore
            adjustedBudget,
            `v179\u5206\u65F6\u9884\u7B97: \u661F\u671F${currentDayOfWeek} \u500D\u6570${budgetMultiplier}x`
          );
          if (budgetSyncResult) {
            await updateCampaign(campaignLocalId, {
              dailyBudget: adjustedBudget.toFixed(2),
              // @ts-ignore
              lastOptimizedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
            adjustmentsCount++;
            adjustment.apiSyncStatus = "synced";
            try {
              await logStrategyExecution({
                strategyId: strategy.id,
                executionType: "budget_adjustment",
                dpTargetType: "campaign",
                dpTargetId: campaignLocalId,
                // @ts-ignore
                dpTargetName: campaign.campaignName,
                previousValue: currentBudget.toFixed(2),
                newValue: adjustedBudget.toFixed(2),
                multiplierApplied: budgetMultiplier.toFixed(2),
                triggerDayOfWeek: currentDayOfWeek,
                triggerHour: getLocalHour(now, marketplace),
                dpExecStatus: "success"
              });
            } catch (logErr) {
              log104.warn(`[DaypartingBudget] \u65E5\u5FD7\u8BB0\u5F55\u5931\u8D25: ${logErr.message}`);
            }
            log104.debug(`[DaypartingBudget] v179: ${campaign.campaignName} \u9884\u7B97\u8C03\u6574 $${currentBudget.toFixed(2)} \u2192 $${adjustedBudget.toFixed(2)} (\u661F\u671F${currentDayOfWeek}, \u500D\u6570${budgetMultiplier}x)`);
          } else {
            adjustment.apiSyncStatus = "failed";
            log104.warn(`[DaypartingBudget] v179: API\u540C\u6B65\u5931\u8D25 (Campaign ${campaign.campaignName})`);
          }
        } catch (apiError) {
          adjustment.apiSyncStatus = "failed";
          adjustment.apiSyncDetail = JSON.stringify({ error: apiError.message });
          log104.warn(`[DaypartingBudget] v179: API\u540C\u6B65\u5F02\u5E38 (Campaign ${campaign.campaignName}):`, apiError.message);
        }
      }
    } catch (error48) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        error: error48.message
      });
    }
  }
  if (adjustmentsCount > 0) {
    try {
      const strategies = await getDaypartingStrategies(config2.accountId);
      for (const s of strategies) {
        if (s.daypartingStatus === "active") {
          await updateDaypartingStrategy(s.id, {
            lastAppliedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          });
        }
      }
    } catch (updateErr) {
      log104.warn(`[DaypartingBudget] \u66F4\u65B0lastAppliedAt\u5931\u8D25: ${updateErr.message}`);
    }
  }
  return { executed: true, adjustmentsCount, details };
}
var log104;
var init_daypartingExecutor = __esm({
  "server/targetEngine/daypartingExecutor.ts"() {
    "use strict";
    init_db2();
    init_db2();
    init_budgetRulesCoordinator();
    init_safeSql();
    init_daypartingService();
    init_amazonApiHelper();
    init_algorithmUtils();
    init_multiDimComboAnalyzer();
    init_logger();
    init_idTypes();
    log104 = createModuleLogger("TargetEngine");
    __name(executeDaypartingOptimization, "executeDaypartingOptimization");
    __name(executeDaypartingBudgetOptimization, "executeDaypartingBudgetOptimization");
  }
});

