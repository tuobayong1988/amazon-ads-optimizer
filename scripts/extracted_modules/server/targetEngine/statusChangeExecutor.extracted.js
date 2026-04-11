// Extracted from production dist/index.js
// Original module: server/targetEngine/statusChangeExecutor.ts
// Lines: 810

async function executeKeywordStatusChanges(config2, campaigns6, dryRun) {
  const details = [];
  let pausedCount = 0;
  let enabledCount = 0;
  const goal = config2.strategyTemplateId || config2.optimizationGoal || "balanced";
  let pauseSpendThreshold = 50;
  let pauseClickThreshold = 20;
  let maxAcosThreshold = (config2.targetAcos || 30) * 2.5;
  if (["aggressive-growth", "seasonal-boost", "market-expansion"].includes(goal)) {
    pauseSpendThreshold = 100;
    pauseClickThreshold = 40;
    maxAcosThreshold = (config2.targetAcos || 30) * 3.5;
  } else if (["profit-focused", "brand-defense", "decline-management"].includes(goal)) {
    pauseSpendThreshold = 35;
    pauseClickThreshold = 15;
    maxAcosThreshold = (config2.targetAcos || 30) * 2;
  } else if (["inventory-clearance", "competitor-attack"].includes(goal)) {
    pauseSpendThreshold = 70;
    pauseClickThreshold = 30;
    maxAcosThreshold = (config2.targetAcos || 30) * 3;
  }
  let totalSalesForAov = 0, totalOrdersForAov = 0;
  for (const c of campaigns6) {
    totalSalesForAov += parseFloat(c.sales || "0");
    totalOrdersForAov += c.orders || 0;
  }
  const groupAov = totalOrdersForAov > 0 ? totalSalesForAov / totalOrdersForAov : 30;
  pauseSpendThreshold = Math.max(pauseSpendThreshold, groupAov * 1.5);
  for (const campaign of campaigns6) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      let campaignTWMetrics = null;
      try {
        const endDate = /* @__PURE__ */ new Date();
        const startDate = /* @__PURE__ */ new Date();
        startDate.setDate(startDate.getDate() - 90);
        const rawDailyData = await getDailyPerformanceByDateRange(config2.accountId, startDate, endDate, campaignAmazonId);
        const dailyDataForWeighting = rawDailyData.map((d) => ({
          date: typeof d.date === "string" ? d.date : new Date(d.date).toISOString(),
          impressions: d.impressions || 0,
          clicks: d.clicks || 0,
          spend: parseFloat(String(d.spend || "0")),
          sales: parseFloat(String(d.sales || "0")),
          orders: d.orders || 0
        }));
        if (dailyDataForWeighting.length > 0) {
          campaignTWMetrics = calculateTimeWeightedMetrics(dailyDataForWeighting);
        }
      } catch (e) {
        log105.warn(`[KeywordStatus] v163: Campaign ${campaignLocalId} \u65F6\u95F4\u8870\u51CF\u6570\u636E\u83B7\u53D6\u5931\u8D25: ${e.message}`);
      }
      const keywords10 = await getKeywordsByCampaignId(campaignAmazonId);
      for (const keyword of keywords10) {
        const spend = parseFloat(keyword.spend || "0");
        const sales = parseFloat(keyword.sales || "0");
        const clicks = keyword.clicks || 0;
        const conversions = keyword.orders || 0;
        const impressions = keyword.impressions || 0;
        const acos = sales > 0 ? spend / sales * 100 : 0;
        let trendAdjustedPauseSpendThreshold = pauseSpendThreshold;
        let trendAdjustedMaxAcosThreshold = maxAcosThreshold;
        if (campaignTWMetrics) {
          if (campaignTWMetrics.trendSignal.direction === "improving") {
            trendAdjustedPauseSpendThreshold *= 1.3;
            trendAdjustedMaxAcosThreshold *= 1.2;
          } else if (campaignTWMetrics.trendSignal.direction === "declining") {
            trendAdjustedPauseSpendThreshold *= 0.8;
            trendAdjustedMaxAcosThreshold *= 0.85;
          }
        }
        let shouldPause = false;
        let pauseReason = "";
        if (keyword.keywordStatus === "enabled") {
          if (spend > trendAdjustedPauseSpendThreshold && conversions === 0 && clicks > pauseClickThreshold) {
            shouldPause = true;
            pauseReason = `\u9AD8\u82B1\u8D39\u96F6\u8F6C\u5316: \u82B1\u8D39$${spend.toFixed(2)}(>\u9608\u503C$${trendAdjustedPauseSpendThreshold.toFixed(0)}), \u70B9\u51FB${clicks}(>\u9608\u503C${pauseClickThreshold}), \u8F6C\u5316${conversions}`;
          } else if (acos > trendAdjustedMaxAcosThreshold && clicks > pauseClickThreshold && conversions > 0) {
            shouldPause = true;
            pauseReason = `ACoS\u8FDC\u8D85\u76EE\u6807: ACoS ${acos.toFixed(1)}%(>\u9608\u503C${trendAdjustedMaxAcosThreshold.toFixed(0)}%), \u70B9\u51FB${clicks}, \u8F6C\u5316${conversions}`;
          }
          if (shouldPause && keyword.createdAt) {
            const keywordCreatedAt = new Date(keyword.createdAt);
            const isNew = isNewKeyword(keywordCreatedAt, clicks, impressions, 7);
            if (isNew) {
              shouldPause = false;
              const explorationInfo = getExplorationStrategy(keywordCreatedAt, clicks, impressions, parseFloat(keyword.bid || "0"));
              details.push({
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                // @ts-ignore
                campaignName: campaign.campaignName,
                keywordId: keyword.id,
                keywordText: keyword.keywordText,
                action: "exploration_protect",
                algorithmUsed: "keyword_status_manager",
                // v335
                reason: `[\u63A2\u7D22\u671F\u4FDD\u62A4] \u5173\u952E\u8BCD\u5728\u63A2\u7D22\u671F\u5185(\u5269\u4F59${explorationInfo.explorationDaysRemaining}\u5929)\uFF0C\u7B56\u7565:${explorationInfo.strategy}\uFF0C\u4E0D\u6267\u884C\u6682\u505C`,
                currentStatus: keyword.keywordStatus
              });
              continue;
            }
          }
          if (shouldPause) {
            const account = await getAdAccountById(config2.accountId);
            const brandTerms = account?.storeName ? [account.storeName] : [];
            if (brandTerms.length > 0 && isProtectedKeyword(keyword.keywordText, brandTerms)) {
              shouldPause = false;
              details.push({
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                // @ts-ignore
                campaignName: campaign.campaignName,
                keywordId: keyword.id,
                keywordText: keyword.keywordText,
                action: "brand_protect",
                algorithmUsed: "keyword_status_manager",
                // v335
                reason: `[\u54C1\u724C\u8BCD\u4FDD\u62A4] \u54C1\u724C\u5173\u952E\u8BCD"${keyword.keywordText}"\u4E0D\u81EA\u52A8\u6682\u505C\uFF0C\u5EFA\u8BAE\u4EBA\u5DE5\u8BC4\u4F30`,
                currentStatus: keyword.keywordStatus
              });
              continue;
            }
          }
          if (shouldPause && clicks < 10 && spend < groupAov) {
            shouldPause = false;
            details.push({
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // @ts-ignore
              campaignName: campaign.campaignName,
              keywordId: keyword.id,
              keywordText: keyword.keywordText,
              action: "observe",
              algorithmUsed: "keyword_status_manager",
              // v335
              reason: `[\u89C2\u5BDF\u671F] \u6570\u636E\u91CF\u4E0D\u8DB3(\u70B9\u51FB${clicks},\u82B1\u8D39$${spend.toFixed(2)})\uFF0C\u7EE7\u7EED\u89C2\u5BDF\u800C\u975E\u76F4\u63A5\u6682\u505C`,
              currentStatus: keyword.keywordStatus
            });
            continue;
          }
        }
        let shouldEnable = false;
        let enableReason = "";
        if (keyword.keywordStatus === "paused") {
          if (acos > 0 && acos < (config2.targetAcos || 30)) {
            shouldEnable = true;
            enableReason = `\u8868\u73B0\u6539\u5584: ACoS ${acos.toFixed(2)}%(\u76EE\u6807${config2.targetAcos || 30}%)`;
          } else if (conversions > 0 && clicks > 5) {
            const cvr = conversions / clicks;
            if (cvr > 0.02) {
              shouldEnable = true;
              enableReason = `[\u63A2\u7D22\u6A21\u5F0F\u91CD\u542F] \u5386\u53F2CVR ${(cvr * 100).toFixed(1)}%\u5C1A\u53EF\uFF0C\u5C1D\u8BD5\u4EE5\u63A2\u7D22\u6027\u51FA\u4EF7\u91CD\u65B0\u542F\u7528`;
            }
          }
        }
        if (shouldPause) {
          const action = {
            accountId: config2.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: "pause",
            reason: pauseReason,
            currentStatus: keyword.keywordStatus,
            newStatus: "paused",
            algorithmUsed: "keyword_status_manager",
            // v335
            apiSyncStatus: dryRun ? "pending" : "pending"
          };
          details.push(action);
          if (!dryRun) {
            try {
              const syncResult = await syncKeywordStatusToAmazon(
                config2.accountId,
                [{
                  // @ts-ignore
                  keywordId: keyword.id,
                  newStatus: "paused",
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
                  reason: pauseReason,
                  isProductTarget: false
                }]
              );
              if (syncResult.success > 0) {
                await updateKeyword(keyword.id, { keywordStatus: "paused" });
                pausedCount++;
                action.apiSyncStatus = "synced";
                try {
                  scheduleKeywordStatusVerification(
                    // @ts-ignore
                    config2.accountId,
                    [{ localKeywordId: keyword.id, amazonKeywordId: keyword.keywordId || String(keyword.id), expectedState: "paused", adGroupId: keyword.internalAdGroupId || void 0 }]
                    // v421: 使用internalAdGroupId(int)
                  );
                } catch (ve) {
                  log105.warn(`[KeywordStatusChange] v166: \u9A8C\u8BC1\u4EFB\u52A1\u6CE8\u518C\u5931\u8D25: ${ve.message}`);
                }
              } else {
                action.apiSyncStatus = "failed";
                if (syncResult.errors.length > 0) {
                  action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
                }
                log105.warn(`[KeywordStatusChange] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0 (\u6682\u505C ${keyword.keywordText})`);
              }
            } catch (apiError) {
              action.apiSyncStatus = "failed";
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
              log105.warn(`[KeywordStatusChange] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0 (\u6682\u505C ${keyword.keywordText}):`, apiError.message);
            }
          }
        } else if (shouldEnable) {
          const action = {
            accountId: config2.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: "enable",
            reason: enableReason,
            currentStatus: keyword.keywordStatus,
            newStatus: "enabled",
            algorithmUsed: "keyword_status_manager",
            // v335
            apiSyncStatus: dryRun ? "pending" : "pending"
          };
          details.push(action);
          if (!dryRun) {
            try {
              const syncResult = await syncKeywordStatusToAmazon(
                config2.accountId,
                [{
                  keywordId: keyword.id,
                  newStatus: "enabled",
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
                  reason: enableReason,
                  isProductTarget: false
                }]
              );
              if (syncResult.success > 0) {
                await updateKeyword(keyword.id, { keywordStatus: "enabled" });
                enabledCount++;
                action.apiSyncStatus = "synced";
                try {
                  scheduleKeywordStatusVerification(
                    config2.accountId,
                    [{ localKeywordId: keyword.id, amazonKeywordId: keyword.keywordId || String(keyword.id), expectedState: "enabled", adGroupId: keyword.internalAdGroupId || void 0 }]
                    // v421: 使用internalAdGroupId(int)
                  );
                } catch (ve) {
                  log105.warn(`[KeywordStatusChange] v166: \u9A8C\u8BC1\u4EFB\u52A1\u6CE8\u518C\u5931\u8D25: ${ve.message}`);
                }
              } else {
                action.apiSyncStatus = "failed";
                if (syncResult.errors.length > 0) {
                  action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
                }
                log105.warn(`[KeywordStatusChange] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0 (\u542F\u7528 ${keyword.keywordText})`);
              }
            } catch (apiError) {
              action.apiSyncStatus = "failed";
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
              log105.warn(`[KeywordStatusChange] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0 (\u542F\u7528 ${keyword.keywordText}):`, apiError.message);
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
  return { executed: true, pausedCount, enabledCount, details };
}
async function executeCampaignStatusChanges(config2, campaigns6, dryRun) {
  const details = [];
  let pausedCount = 0;
  let enabledCount = 0;
  const goal = config2.strategyTemplateId || config2.optimizationGoal || "balanced";
  const targetAcos = config2.targetAcos || 30;
  let campaignPauseSpendThreshold = 200;
  let campaignPauseClickThreshold = 100;
  let campaignMaxAcosThreshold = targetAcos * 3;
  if (["profit-focused", "brand-defense", "decline-management"].includes(goal)) {
    campaignPauseSpendThreshold = 150;
    campaignPauseClickThreshold = 80;
    campaignMaxAcosThreshold = targetAcos * 2.5;
  }
  // === v620-fix11: P0 Campaign Pause Hard Limit + Impact Assessment ===
  const _v620_totalEnabled = campaigns6.filter(c => (c.campaignStatus || "enabled") === "enabled").length;
  const _v620_PAUSE_HARD_LIMIT_RATIO = 0.30; // Never pause more than 30% of enabled campaigns in one run
  const _v620_maxPausesAllowed = Math.max(3, Math.floor(_v620_totalEnabled * _v620_PAUSE_HARD_LIMIT_RATIO));
  let _v620_pauseCountThisRun = 0;
  let _v620_pauseBlockedCount = 0;
  let _v620_reviewSubmittedCount = 0;
  log105.info(`[v620-CampaignGuard] Hard limit: max ${_v620_maxPausesAllowed} pauses allowed (${(_v620_PAUSE_HARD_LIMIT_RATIO*100).toFixed(0)}% of ${_v620_totalEnabled} enabled campaigns)`);
  // === end v620-fix11 preamble ===
  for (const campaign of campaigns6) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      let campaignTWMetrics = null;
      try {
        const endDate = /* @__PURE__ */ new Date();
        const startDate = /* @__PURE__ */ new Date();
        startDate.setDate(startDate.getDate() - 90);
        const rawDailyData = await getDailyPerformanceByDateRange(config2.accountId, startDate, endDate, campaignAmazonId);
        const dailyDataForWeighting = rawDailyData.map((d) => ({
          // @ts-ignore
          date: typeof d.date === "string" ? d.date : new Date(d.date).toISOString(),
          impressions: d.impressions || 0,
          // @ts-ignore
          clicks: d.clicks || 0,
          spend: parseFloat(String(d.spend || "0")),
          sales: parseFloat(String(d.sales || "0")),
          orders: d.orders || 0
        }));
        if (dailyDataForWeighting.length > 0) {
          campaignTWMetrics = calculateTimeWeightedMetrics(dailyDataForWeighting);
        }
      } catch (e) {
        log105.warn(`[CampaignStatus] v163: Campaign ${campaignLocalId} \u65F6\u95F4\u8870\u51CF\u6570\u636E\u83B7\u53D6\u5931\u8D25: ${e.message}`);
      }
      const spend = campaignTWMetrics ? campaignTWMetrics.weightedDailySpend * 30 : parseFloat(campaign.spend || "0");
      const sales = campaignTWMetrics ? campaignTWMetrics.weightedDailySales * 30 : parseFloat(campaign.sales || "0");
      const clicks = campaign.clicks || 0;
      const conversions = campaignTWMetrics ? Math.round(campaignTWMetrics.weightedDailyOrders * 30) : campaign.orders || 0;
      const acos = campaignTWMetrics ? campaignTWMetrics.weightedAcos : sales > 0 ? spend / sales * 100 : 0;
      const campaignStatus = campaign.campaignStatus || "enabled";
      let adjustedPauseSpendThreshold = campaignPauseSpendThreshold;
      let adjustedMaxAcosThreshold = campaignMaxAcosThreshold;
      if (campaignTWMetrics) {
        if (campaignTWMetrics.trendSignal.direction === "improving") {
          adjustedPauseSpendThreshold *= 1.3;
          adjustedMaxAcosThreshold *= 1.2;
        } else if (campaignTWMetrics.trendSignal.direction === "declining") {
          adjustedPauseSpendThreshold *= 0.8;
          adjustedMaxAcosThreshold *= 0.85;
        }
      }
      let shouldPause = false;
      let pauseReason = "";
      let shouldEnable = false;
      let enableReason = "";
      if (campaignStatus === "enabled") {
        if (spend > adjustedPauseSpendThreshold && conversions === 0 && clicks > campaignPauseClickThreshold) {
          shouldPause = true;
          pauseReason = `\u5E7F\u544A\u6D3B\u52A8\u9AD8\u82B1\u8D39\u96F6\u8F6C\u5316: \u52A0\u6743\u82B1\u8D39$${spend.toFixed(2)}(>\u9608\u503C$${adjustedPauseSpendThreshold.toFixed(0)}), \u52A0\u6743\u70B9\u51FB${clicks}(>\u9608\u503C${campaignPauseClickThreshold}), \u52A0\u6743\u8F6C\u5316${conversions}`;
        } else if (acos > adjustedMaxAcosThreshold && clicks > campaignPauseClickThreshold && conversions > 0) {
          shouldPause = true;
          pauseReason = `\u5E7F\u544A\u6D3B\u52A8ACoS\u8FDC\u8D85\u76EE\u6807: \u52A0\u6743ACoS ${acos.toFixed(1)}%(>\u9608\u503C${adjustedMaxAcosThreshold.toFixed(0)}%), \u52A0\u6743\u70B9\u51FB${clicks}, \u52A0\u6743\u8F6C\u5316${conversions}`;
        }
      } else if (campaignStatus === "paused") {
        if (acos > 0 && acos < targetAcos * 0.8) {
          shouldEnable = true;
          enableReason = `\u5E7F\u544A\u6D3B\u52A8\u8868\u73B0\u6539\u5584: \u52A0\u6743ACoS ${acos.toFixed(1)}%(\u76EE\u6807${targetAcos}%), \u5EFA\u8BAE\u91CD\u65B0\u542F\u7528`;
        }
      }
      if (shouldPause) {
        // === v620-fix11: P0 Hard Limit Check ===
        if (_v620_pauseCountThisRun >= _v620_maxPausesAllowed) {
          _v620_pauseBlockedCount++;
          log105.warn(`[v620-CampaignGuard] HARD LIMIT REACHED: Blocked pause of "${campaign.campaignName}" (${_v620_pauseCountThisRun}/${_v620_maxPausesAllowed} already paused this run)`);
          details.push({
            accountId: config2.accountId,
            entityType: "campaign",
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            action: "pause_blocked",
            reason: `[v620-CampaignGuard] Hard limit reached: ${_v620_pauseCountThisRun}/${_v620_maxPausesAllowed} pauses used. Original reason: ${pauseReason}`,
            currentStatus: campaignStatus,
            newStatus: campaignStatus,
            spend, sales, clicks, conversions, acos,
            algorithmUsed: "v620_hard_limit_guard",
            apiSyncStatus: "blocked"
          });
          continue;
        }

        // === v620-fix11: P0 Impact Assessment via ImpactPredictor ===
        let _v620_impactLevel = "low";
        let _v620_shouldSubmitReview = false;
        try {
          // Check if this campaign has significant historical sales contribution
          const _v620_campSales = parseFloat(String(sales || 0));
          const _v620_campSpend = parseFloat(String(spend || 0));
          // High impact: campaign has sales > $100/month or contributes >5% of total account spend
          if (_v620_campSales > 100 || (_v620_campSpend > 50 && conversions > 0)) {
            _v620_impactLevel = "high";
            _v620_shouldSubmitReview = true;
            log105.info(`[v620-ImpactPredictor] Campaign "${campaign.campaignName}" assessed as HIGH impact (sales=$${_v620_campSales.toFixed(0)}, spend=$${_v620_campSpend.toFixed(0)}, conversions=${conversions})`);
          } else if (_v620_campSales > 30 || conversions > 0) {
            _v620_impactLevel = "medium";
            _v620_shouldSubmitReview = true;
            log105.info(`[v620-ImpactPredictor] Campaign "${campaign.campaignName}" assessed as MEDIUM impact (sales=$${_v620_campSales.toFixed(0)}, conversions=${conversions})`);
          }
        } catch (_v620_impactErr) {
          log105.warn(`[v620-ImpactPredictor] Assessment failed for "${campaign.campaignName}": ${_v620_impactErr.message}, proceeding with caution`);
          // On error, treat as medium impact for safety
          if (sales > 0) { _v620_impactLevel = "medium"; _v620_shouldSubmitReview = true; }
        }

        // === v620-fix11: P0 ReviewGateway - Submit for review if high/medium impact ===
        if (_v620_shouldSubmitReview && !dryRun) {
          try {
            const _v620_reviewData = {
              accountId: config2.accountId,
              operationType: "pause_campaign",
              targetId: campaignLocalId,
              targetName: campaign.campaignName || "",
              currentValue: campaignStatus,
              proposedValue: "paused",
              reason: pauseReason,
              impactLevel: _v620_impactLevel,
              impactDetail: JSON.stringify({
                spend: spend, sales: sales, clicks: clicks,
                conversions: conversions, acos: acos,
                assessment: `Campaign contributes $${parseFloat(String(sales||0)).toFixed(0)} in sales. Impact: ${_v620_impactLevel}`
              }),
              submittedAt: new Date().toISOString()
            };
            // Store review request in optimization_events as pending_review (using v620RawQuery for scope safety)
            await v620RawQuery(
              `INSERT INTO optimization_events (accountId, campaignId, eventType, actionType, reason, previousValue, newValue, apiSyncStatus, apiSyncDetail, createdAt)
               VALUES (?, ?, 'campaign_pause_review', 'pause', ?, ?, 'pending_review', 'pending_review', ?, NOW())`,
              [config2.accountId, campaignLocalId,
               `[v620-ReviewGateway] ${_v620_impactLevel.toUpperCase()} impact pause requires review: ${pauseReason}`,
               campaignStatus, JSON.stringify(_v620_reviewData)]
            );
            _v620_reviewSubmittedCount++;
            log105.warn(`[v620-ReviewGateway] Campaign "${campaign.campaignName}" submitted for review (impact=${_v620_impactLevel}). Pause DEFERRED until approved.`);
            details.push({
              accountId: config2.accountId,
              entityType: "campaign",
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              action: "pause_pending_review",
              reason: `[v620-ReviewGateway] ${_v620_impactLevel} impact - submitted for review. Original: ${pauseReason}`,
              currentStatus: campaignStatus,
              newStatus: "pending_review",
              spend, sales, clicks, conversions, acos,
              algorithmUsed: "v620_review_gateway",
              apiSyncStatus: "pending_review",
              impactLevel: _v620_impactLevel
            });
            _v620_pauseCountThisRun++; // Count towards limit even though deferred
            continue; // Skip actual pause - wait for human review
          } catch (_v620_reviewErr) {
            log105.warn(`[v620-ReviewGateway] Failed to submit review for "${campaign.campaignName}": ${_v620_reviewErr.message}. Falling through to direct pause as safety fallback.`);
            // Fall through to direct pause if review submission fails
          }
        }
        // === end v620-fix11 P0 guards ===

        _v620_pauseCountThisRun++; // Track pause count for hard limit
        const action = {
          accountId: config2.accountId,
          entityType: "campaign",
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          // @ts-ignore
          campaignName: campaign.campaignName,
          action: "pause",
          reason: pauseReason,
          currentStatus: campaignStatus,
          // @ts-ignore
          newStatus: "paused",
          spend,
          sales,
          clicks,
          conversions,
          acos,
          // @ts-ignore
          algorithmUsed: "campaign_status_manager",
          // v335
          // @ts-ignore
          apiSyncStatus: dryRun ? "pending" : "pending"
        };
        details.push(action);
        if (!dryRun) {
          try {
            const syncResult = await syncCampaignStatusToAmazon(
              config2.accountId,
              [{
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                newStatus: "paused",
                // @ts-ignore
                campaignName: campaign.campaignName || "",
                reason: pauseReason
                // @ts-ignore
              }]
            );
            if (syncResult.success > 0) {
              await updateCampaign(campaignLocalId, { campaignStatus: "paused" });
              pausedCount++;
              action.apiSyncStatus = "synced";
            } else {
              action.apiSyncStatus = "failed";
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
              log105.warn(`[CampaignStatusChange] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0 (\u6682\u505C ${campaign.campaignName})`);
            }
          } catch (apiError) {
            action.apiSyncStatus = "failed";
            action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            log105.warn(`[CampaignStatusChange] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0 (\u6682\u505C ${campaign.campaignName}):`, apiError.message);
          }
        }
      } else if (shouldEnable) {
        const action = {
          accountId: config2.accountId,
          entityType: "campaign",
          // @ts-ignore
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          // @ts-ignore
          campaignName: campaign.campaignName,
          action: "enable",
          reason: enableReason,
          // @ts-ignore
          currentStatus: campaignStatus,
          // @ts-ignore
          newStatus: "enabled",
          spend,
          // @ts-ignore
          sales,
          clicks,
          conversions,
          acos,
          algorithmUsed: "campaign_status_manager",
          // v335
          // @ts-ignore
          apiSyncStatus: dryRun ? "pending" : "pending"
        };
        details.push(action);
        if (!dryRun) {
          try {
            const syncResult = await syncCampaignStatusToAmazon(
              // @ts-ignore
              config2.accountId,
              [{
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                newStatus: "enabled",
                // @ts-ignore
                campaignName: campaign.campaignName || "",
                reason: enableReason
              }]
            );
            if (syncResult.success > 0) {
              await updateCampaign(campaignLocalId, { campaignStatus: "enabled" });
              enabledCount++;
              action.apiSyncStatus = "synced";
            } else {
              action.apiSyncStatus = "failed";
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
              log105.warn(`[CampaignStatusChange] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0 (\u542F\u7528 ${campaign.campaignName})`);
            }
          } catch (apiError) {
            action.apiSyncStatus = "failed";
            action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            log105.warn(`[CampaignStatusChange] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0 (\u542F\u7528 ${campaign.campaignName}):`, apiError.message);
          }
        }
      }
    } catch (error48) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        entityType: "campaign",
        error: error48.message
      });
    }
  }
  // === v620-fix11: P0 Guard Summary ===
  if (_v620_pauseBlockedCount > 0 || _v620_reviewSubmittedCount > 0) {
    const guardSummary = `[v620-CampaignGuard] Summary: ${pausedCount} paused, ${_v620_reviewSubmittedCount} sent to review, ${_v620_pauseBlockedCount} blocked by hard limit (limit=${_v620_maxPausesAllowed})`;
    log105.warn(guardSummary);
    details.push({
      action: "v620_guard_summary",
      algorithmUsed: "v620_campaign_guard",
      reason: guardSummary,
      pausedCount, reviewSubmittedCount: _v620_reviewSubmittedCount, blockedCount: _v620_pauseBlockedCount,
      hardLimit: _v620_maxPausesAllowed, totalEnabled: _v620_totalEnabled
    });
  }
  // === end v620-fix11 summary ===
  return { executed: true, pausedCount, enabledCount, details, v620Guard: { reviewSubmitted: _v620_reviewSubmittedCount, blocked: _v620_pauseBlockedCount, hardLimit: _v620_maxPausesAllowed } };
}
async function executeAdGroupStatusChanges(config2, campaigns6, dryRun) {
  const details = [];
  let pausedCount = 0;
  let enabledCount = 0;
  const targetAcos = config2.targetAcos || 30;
  let adGroupPauseSpendThreshold = 100;
  let adGroupPauseClickThreshold = 50;
  let adGroupMaxAcosThreshold = targetAcos * 2.8;
  for (const campaign of campaigns6) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      const adGroups6 = await getAdGroupsByCampaignId(campaignAmazonId);
      for (const adGroup of adGroups6) {
        const spend = parseFloat(adGroup.spend || "0");
        const sales = parseFloat(adGroup.sales || "0");
        const clicks = adGroup.clicks || 0;
        const conversions = adGroup.orders || 0;
        const acos = sales > 0 ? spend / sales * 100 : 0;
        const adGroupStatus = adGroup.adGroupStatus || "enabled";
        let shouldPause = false;
        let pauseReason = "";
        let shouldEnable = false;
        let enableReason = "";
        if (adGroupStatus === "enabled") {
          if (spend > adGroupPauseSpendThreshold && conversions === 0 && clicks > adGroupPauseClickThreshold) {
            shouldPause = true;
            pauseReason = `\u5E7F\u544A\u7EC4\u9AD8\u82B1\u8D39\u96F6\u8F6C\u5316: \u82B1\u8D39$${spend.toFixed(2)}(>\u9608\u503C$${adGroupPauseSpendThreshold}), \u70B9\u51FB${clicks}(>\u9608\u503C${adGroupPauseClickThreshold}), \u8F6C\u5316${conversions}`;
          } else if (acos > adGroupMaxAcosThreshold && clicks > adGroupPauseClickThreshold && conversions > 0) {
            shouldPause = true;
            pauseReason = `\u5E7F\u544A\u7EC4ACoS\u8FDC\u8D85\u76EE\u6807: ACoS ${acos.toFixed(1)}%(>\u9608\u503C${adGroupMaxAcosThreshold.toFixed(0)}%), \u70B9\u51FB${clicks}, \u8F6C\u5316${conversions}`;
          }
        } else if (adGroupStatus === "paused") {
          if (acos > 0 && acos < targetAcos * 0.8) {
            shouldEnable = true;
            enableReason = `\u5E7F\u544A\u7EC4\u8868\u73B0\u6539\u5584: ACoS ${acos.toFixed(1)}%(\u76EE\u6807${targetAcos}%), \u5EFA\u8BAE\u91CD\u65B0\u542F\u7528`;
          }
        }
        if (shouldPause) {
          try {
            const dbInstance = await getDb();
            if (dbInstance) {
              const { sql: sqlTag } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
              const failHistory = await dbInstance.execute(sqlTag`
                SELECT COUNT(*) as fail_count FROM optimization_logs
                WHERE action_type = 'adgroup_pause'
                  AND JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.adGroupId')) = ${String(adGroup.id)}
                  AND api_sync_status = 'failed'
                  AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
              `);
              const failCount = failHistory[0]?.[0]?.fail_count || 0;
              if (failCount >= 3) {
                log105.warn(`[AdGroupStatus] v328: \u8DF3\u8FC7\u5E7F\u544A\u7EC4"${adGroup.adGroupName}" \u2014 \u5DF2\u8FDE\u7EED\u5931\u8D25${failCount}\u6B21\uFF0C\u7B49\u5F85\u4EBA\u5DE5\u5904\u7406`);
                continue;
              }
            }
          } catch (failCheckErr) {
            log105.warn(`[AdGroupStatus] v328: \u5931\u8D25\u5386\u53F2\u68C0\u67E5\u5F02\u5E38: ${failCheckErr.message}`);
          }
          const action = {
            // @ts-ignore
            accountId: config2.accountId,
            // @ts-ignore
            entityType: "adGroup",
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            adGroupId: adGroup.id,
            adGroupName: adGroup.adGroupName,
            amazonAdGroupId: adGroup.adGroupId,
            action: "pause",
            reason: pauseReason,
            currentStatus: adGroupStatus,
            newStatus: "paused",
            spend,
            // @ts-ignore
            sales,
            clicks,
            conversions,
            acos,
            algorithmUsed: "adgroup_status_manager",
            // v335
            apiSyncStatus: dryRun ? "pending" : "pending"
          };
          details.push(action);
          if (!dryRun) {
            await updateAdGroupStatus(adGroup.id, "paused");
            pausedCount++;
            try {
              const syncResult = await syncAdGroupStatusToAmazon(
                config2.accountId,
                [{
                  adGroupId: adGroup.id,
                  amazonAdGroupId: String(adGroup.adGroupId || ""),
                  newStatus: "paused",
                  adGroupName: adGroup.adGroupName || "",
                  // @ts-ignore
                  campaignName: campaign.campaignName || "",
                  reason: pauseReason,
                  // @ts-ignore
                  campaignType: campaign.campaignType || ""
                  // v310-fix: 传递广告类型以选择正确的API端点
                }]
              );
              action.apiSyncStatus = syncResult.success > 0 ? "synced" : "failed";
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
            } catch (apiError) {
              action.apiSyncStatus = "failed";
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            }
          }
        } else if (shouldEnable) {
          const action = {
            accountId: config2.accountId,
            entityType: "adGroup",
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            adGroupId: adGroup.id,
            adGroupName: adGroup.adGroupName,
            // @ts-ignore
            amazonAdGroupId: adGroup.adGroupId,
            action: "enable",
            reason: enableReason,
            currentStatus: adGroupStatus,
            newStatus: "enabled",
            spend,
            sales,
            clicks,
            conversions,
            acos,
            algorithmUsed: "adgroup_status_manager",
            // v335
            apiSyncStatus: dryRun ? "pending" : "pending"
          };
          details.push(action);
          if (!dryRun) {
            await updateAdGroupStatus(adGroup.id, "enabled");
            enabledCount++;
            try {
              const syncResult = await syncAdGroupStatusToAmazon(
                config2.accountId,
                [{
                  adGroupId: adGroup.id,
                  amazonAdGroupId: String(adGroup.adGroupId || ""),
                  newStatus: "enabled",
                  adGroupName: adGroup.adGroupName || "",
                  // @ts-ignore
                  campaignName: campaign.campaignName || "",
                  reason: enableReason,
                  // @ts-ignore
                  campaignType: campaign.campaignType || ""
                  // v310-fix: 传递广告类型以选择正确的API端点
                }]
              );
              action.apiSyncStatus = syncResult.success > 0 ? "synced" : "failed";
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
            } catch (apiError) {
              action.apiSyncStatus = "failed";
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
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
        entityType: "adGroup",
        error: error48.message
      });
    }
  }
  return { executed: true, pausedCount, enabledCount, details };
}
var log105;
var init_statusChangeExecutor = __esm({
  "server/targetEngine/statusChangeExecutor.ts"() {
    "use strict";
    init_db2();
    init_amazonApiHelper();
    init_algorithmUtils();
    init_timeDecayWeightedDataService();
    init_postOptimizationVerifier();
    init_logger();
    init_idTypes();
    log105 = createModuleLogger("TargetEngine");
    __name(executeKeywordStatusChanges, "executeKeywordStatusChanges");
    __name(executeCampaignStatusChanges, "executeCampaignStatusChanges");
    __name(executeAdGroupStatusChanges, "executeAdGroupStatusChanges");
  }
});

