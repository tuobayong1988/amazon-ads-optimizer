// Extracted from production dist/index.js
// Original module: server/targetEngine/searchTermExecutor.ts
// Lines: 1183

async function executeSearchTermAnalysis(config2, campaigns6, dryRun) {
  const details = [];
  let negativeKeywordsAdded = 0;
  let newKeywordsAdded = 0;
  const recentlyProcessedSearchTerms = /* @__PURE__ */ new Set();
  try {
    const dbInstance = await getDb();
    if (dbInstance && config2.performanceGroupId) {
      const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
      const recentLogs = await dbInstance.execute(sql15`
        SELECT DISTINCT LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm')))) as search_term,
               JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.amazonCampaignId')) as campaign_id
        FROM optimization_logs 
        WHERE performance_group_id = ${config2.performanceGroupId}
          AND action_type IN ('keyword_create', 'negative_keyword_add', 'negative_product_target_add', 'search_term_harvest', 'search_term_brand_protect', 'search_term_exploration_protect', 'search_term_permanent_fail_skip', 'search_term_validation_fail', 'product_target_create')
          AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND api_sync_status IN ('synced', 'already_exists', 'failed', 'permanently_failed', 'skipped_pt_adgroup', 'pending', 'not_applicable', 'timeout_failed')
          AND action_detail IS NOT NULL AND JSON_VALID(action_detail)
      `);
      for (const row of recentLogs[0] || []) {
        if (row.search_term && row.campaign_id) {
          recentlyProcessedSearchTerms.add(`${row.campaign_id}::${row.search_term}`);
        }
      }
      log103.info(`[SearchTermAnalysis] v353: \u9884\u52A0\u8F7D${recentlyProcessedSearchTerms.size}\u4E2A\u5DF2\u5904\u7406\u641C\u7D22\u8BCD\u7528\u4E8E\u53BB\u91CD(30\u5929\u7A97\u53E3)`);
    }
  } catch (dedupErr) {
    log103.warn(`[SearchTermAnalysis] v328: \u53BB\u91CD\u9884\u52A0\u8F7D\u5931\u8D25(\u4E0D\u5F71\u54CD\u4E3B\u6D41\u7A0B): ${dedupErr.message}`, dedupErr.stack?.slice(0, 300));
  }
  const permanentlyFailedKeywords = /* @__PURE__ */ new Set();
  try {
    const dbInstance = await getDb();
    if (dbInstance && config2.performanceGroupId) {
      const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
      const failedLogs = await dbInstance.execute(sql15`
        SELECT search_term, MAX(fail_count) as fail_count FROM (
          SELECT LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm')))) as search_term,
                 COUNT(*) as fail_count
          FROM optimization_logs 
          WHERE performance_group_id = ${config2.performanceGroupId}
            AND action_type = 'keyword_create'
            AND api_sync_status = 'permanently_failed'
            AND action_detail IS NOT NULL AND JSON_VALID(action_detail)
          GROUP BY LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm'))))
          UNION ALL
          SELECT LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm')))) as search_term,
                 COUNT(*) as fail_count
          FROM optimization_logs 
          WHERE performance_group_id = ${config2.performanceGroupId}
            AND action_type = 'keyword_create'
            AND api_sync_status = 'failed'
            AND action_detail IS NOT NULL AND JSON_VALID(action_detail)
          GROUP BY LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm'))))
          HAVING COUNT(*) >= 3
        ) combined
        GROUP BY search_term
      `);
      for (const row of failedLogs[0] || []) {
        if (row.search_term) {
          permanentlyFailedKeywords.add(row.search_term);
        }
      }
      if (permanentlyFailedKeywords.size > 0) {
        log103.warn(`[SearchTermAnalysis] v310: \u53D1\u73B0${permanentlyFailedKeywords.size}\u4E2A\u6C38\u4E45\u5931\u8D25\u5173\u952E\u8BCD\u5C06\u88AB\u8DF3\u8FC7: ${[...permanentlyFailedKeywords].slice(0, 5).join(", ")}`);
      }
    }
  } catch (failErr) {
    log103.warn(`[SearchTermAnalysis] v310: \u6C38\u4E45\u5931\u8D25\u5173\u952E\u8BCD\u9884\u52A0\u8F7D\u5931\u8D25: ${failErr.message}`, failErr.stack?.slice(0, 300));
  }
  try {
    const dbInstance = await getDb();
    if (dbInstance && config2.performanceGroupId) {
      const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
      const pendingKeywords = await dbInstance.execute(sql15`
        SELECT ol.id, ol.action_detail, ol.account_id, ol.performance_group_id, ol.campaign_id,
               c.campaignType AS campaign_type
        FROM optimization_logs ol
        LEFT JOIN campaigns c ON c.id = ol.campaign_id
        WHERE ol.performance_group_id = ${config2.performanceGroupId}
          AND ol.action_type = 'keyword_create'
          AND ol.api_sync_status = 'pending'
        ORDER BY ol.created_at ASC
        LIMIT 50
      `);
      const pendingKwRows = pendingKeywords[0] || [];
      if (pendingKwRows.length > 0) {
        log103.info(`[SearchTermAnalysis] v310: \u53D1\u73B0${pendingKwRows.length}\u6761pending\u7684keyword_create\uFF0C\u5C1D\u8BD5\u91CD\u65B0\u540C\u6B65`);
        let retrySuccess = 0;
        let retryFailed = 0;
        for (const row of pendingKwRows) {
          try {
            const rowCampaignType = row.campaign_type;
            if (rowCampaignType === "sb" || rowCampaignType === "sd") {
              await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'skipped_unsupported_campaign_type',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.skip_reason', ${`v354: ${rowCampaignType.toUpperCase()}\u5E7F\u544A\u6D3B\u52A8\u4E0D\u652F\u6301\u901A\u8FC7API\u521B\u5EFA\u5173\u952E\u8BCD`})
 WHERE id = ${row.id}
 `);
              retryFailed++;
              log103.debug(`[SearchTermAnalysis] v354-enhanced: SB/SD pending keyword_create skipped: id=${row.id}, type=${rowCampaignType}`);
              continue;
            }
            const detail = typeof row.action_detail === "string" ? JSON.parse(row.action_detail) : row.action_detail;
            const searchTerm = detail?.searchTerm;
            const matchType = detail?.matchType || "phrase";
            const bid = detail?.suggestedBid || 0.5;
            const amazonCampaignIdStr = detail?.amazonCampaignId;
            if (searchTerm && permanentlyFailedKeywords.has(searchTerm.toLowerCase().trim())) {
              await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'permanently_failed',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_skip_reason', 'v310: 关键词在永久失败名单中')
 WHERE id = ${row.id}
 `);
              retryFailed++;
              continue;
            }
            if (!amazonCampaignIdStr || !searchTerm) {
              const localCampaignId = detail?.localCampaignId || detail?.campaignId;
              if (localCampaignId) {
                const campaignLookup = await dbInstance.execute(sql15`
 SELECT campaignId FROM campaigns WHERE id = ${localCampaignId} LIMIT 1
 `);
                const lookupRows = campaignLookup[0] || [];
                if (lookupRows.length > 0 && lookupRows[0].campaignId) {
                  const foundAmazonCampaignId = lookupRows[0].campaignId;
                  const adGroups6 = await getAdGroupsByCampaignId(foundAmazonCampaignId);
                  if (adGroups6.length > 0 && searchTerm) {
                    const adGroup = adGroups6[0];
                    const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                    if (amazonAdGroupId > 0) {
                      try {
                        const apiResult = await syncNewKeywordsToAmazon(
                          config2.accountId,
                          [{ adGroupId: amazonAdGroupId, campaignId: foundAmazonCampaignId, keywordText: searchTerm, matchType, bid }]
                        );
                        if (apiResult.success > 0) {
                          await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'synced',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_synced', 'v310: pending重试成功')
 WHERE id = ${row.id}
 `);
                          retrySuccess++;
                        } else {
                          await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'failed',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_error', ${apiResult.errors.join("; ")})
 WHERE id = ${row.id}
 `);
                          retryFailed++;
                        }
                      } catch (retryApiErr) {
                        await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'failed',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_error', ${retryApiErr.message})
 WHERE id = ${row.id}
 `);
                        retryFailed++;
                      }
                      continue;
                    }
                  }
                }
              }
              await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'timeout_failed',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.timeout_reason', 'v310: 无法解析Amazon ID')
 WHERE id = ${row.id}
 `);
              retryFailed++;
            } else {
              const adGroups6 = await getAdGroupsByCampaignId(amazonCampaignIdStr);
              if (adGroups6.length > 0) {
                const adGroup = adGroups6[0];
                const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                if (amazonAdGroupId > 0) {
                  try {
                    const apiResult = await syncNewKeywordsToAmazon(
                      config2.accountId,
                      [{ adGroupId: amazonAdGroupId, campaignId: amazonCampaignIdStr, keywordText: searchTerm, matchType, bid }]
                    );
                    if (apiResult.success > 0) {
                      await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'synced',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_synced', 'v310: pending重试成功')
 WHERE id = ${row.id}
 `);
                      retrySuccess++;
                    } else {
                      await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'failed',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_error', ${apiResult.errors.join("; ")})
 WHERE id = ${row.id}
 `);
                      retryFailed++;
                    }
                  } catch (retryApiErr) {
                    await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'failed',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.retry_error', ${retryApiErr.message})
 WHERE id = ${row.id}
 `);
                    retryFailed++;
                  }
                } else {
                  await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'timeout_failed',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.timeout_reason', 'v310: adGroupId无效')
 WHERE id = ${row.id}
 `);
                  retryFailed++;
                }
              } else {
                await dbInstance.execute(sql15`
 UPDATE optimization_logs SET api_sync_status = 'timeout_failed',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.timeout_reason', 'v310: 找不到广告组')
 WHERE id = ${row.id}
 `);
                retryFailed++;
              }
            }
          } catch (rowErr) {
            log103.warn(`[SearchTermAnalysis] v310: pending\u91CD\u8BD5\u5355\u6761\u5931\u8D25 id=${row.id}: ${rowErr.message}`);
            retryFailed++;
          }
        }
        log103.warn(`[SearchTermAnalysis] v310: pending keyword_create\u91CD\u8BD5\u5B8C\u6210: \u6210\u529F=${retrySuccess}, \u5931\u8D25=${retryFailed}, \u603B\u8BA1=${pendingKwRows.length}`);
      }
      const timeoutResult = await dbInstance.execute(sql15`
 UPDATE optimization_logs 
 SET api_sync_status = 'timeout_failed',
 api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.timeout_reason', 'v310: pending超过72小时未同步')
 WHERE performance_group_id = ${config2.performanceGroupId}
 AND api_sync_status = 'pending'
 AND created_at < DATE_SUB(NOW(), INTERVAL 72 HOUR)
 `);
      const timeoutCount = timeoutResult[0]?.affectedRows || 0;
      if (timeoutCount > 0) {
        log103.warn(`[SearchTermAnalysis] v310: \u6807\u8BB0${timeoutCount}\u6761\u8D85\u8FC772\u5C0F\u65F6\u7684pending\u8BB0\u5F55\u4E3Atimeout_failed`);
      }
    }
  } catch (timeoutErr) {
    log103.warn(`[SearchTermAnalysis] v310: pending\u91CD\u8BD5\u5904\u7406\u5931\u8D25: ${timeoutErr.message}`, timeoutErr.stack?.slice(0, 300));
  }
  let stCampaignIndex = 0;
  for (const campaign of campaigns6) {
    if (stCampaignIndex > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5e3));
    }
    stCampaignIndex++;
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      const campaignNameStr = campaign.campaignName || "";
      const isProductTargetingCamp = isProductTargetingCampaign(campaignNameStr);
      let campaignHasProductTargetAdGroup = false;
      try {
        const campaignAdGroups = await getAdGroupsByCampaignId(campaignAmazonId);
        if (campaignAdGroups.length > 0) {
          campaignHasProductTargetAdGroup = await adGroupHasProductTargets(campaignAdGroups[0].id);
        }
      } catch (ptPreCheckErr) {
        log103.debug(`[SearchTermAnalysis] v353: \u9884\u68C0\u67E5PT\u5E7F\u544A\u7EC4\u5931\u8D25(\u7EE7\u7EED\u5904\u7406): ${ptPreCheckErr.message}`);
      }
      if (isProductTargetingCamp) {
        log103.info(`[SearchTermAnalysis] v2: Product Targeting campaign: "${campaignNameStr}" (id=${campaignAmazonId})\uFF0C\u4EC5\u5141\u8BB8\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u64CD\u4F5C`);
      }
      const searchTerms8 = await getSearchTermsByCampaignId(campaignAmazonId);
      const campaignTargetingType = campaign.targetingType || (campaign.campaignType === "sp_auto" ? "auto" : "manual");
      const targetAcos = config2.targetAcos || 30;
      const rawCampaignType = campaign.campaignType || "sp_auto";
      const v2CampaignType = (() => {
        if (rawCampaignType === "sponsoredProducts" || rawCampaignType === "sp") {
          return campaignTargetingType === "auto" ? "sp_auto" : "sp_manual";
        }
        if (rawCampaignType === "sponsoredBrands" || rawCampaignType === "sb") return "sb";
        if (rawCampaignType === "sponsoredDisplay" || rawCampaignType === "sd") return "sd";
        return campaignTargetingType === "auto" ? "sp_auto" : "sp_manual";
      })();
      const searchTermPerformanceList = searchTerms8.map((st) => ({
        searchTerm: st.searchTerm,
        clicks: Number(st.searchTermClicks || 0),
        impressions: Number(st.searchTermImpressions || 0),
        orders: Number(st.searchTermOrders || 0),
        spend: Number(st.searchTermSpend || 0),
        sales: Number(st.searchTermSales || 0),
        campaignTargetingType,
        campaignType: v2CampaignType,
        // v2: 新增广告活动类型
        targetAcos
      }));
      log103.debug(`[SearchTermAnalysis] v191: Campaign "${campaign.campaignName}" (${campaignTargetingType}): ${searchTermPerformanceList.length}\u4E2A\u641C\u7D22\u8BCD\u5F85\u5206\u6790`);
      const account = await getAdAccountById(config2.accountId);
      const brandTerms = account?.storeName ? [account.storeName] : [];
      for (const stPerf of searchTermPerformanceList) {
        const decision = decideTargeting(stPerf);
        if (decision.action === "SKIP" || decision.action === "MONITOR") {
          continue;
        }
        const dedupKey = `${campaignAmazonId}::${stPerf.searchTerm.toLowerCase().trim()}`;
        if (recentlyProcessedSearchTerms.has(dedupKey)) {
          log103.debug(`[SearchTermAnalysis] v328: \u8DF3\u8FC7\u5DF2\u5904\u7406\u641C\u7D22\u8BCD: "${stPerf.searchTerm}" (campaign=${campaignAmazonId})`);
          continue;
        }
        if (decision.action === "CREATE_KEYWORD" && permanentlyFailedKeywords.has(stPerf.searchTerm.toLowerCase().trim())) {
          log103.info(`[SearchTermAnalysis] v310: \u8DF3\u8FC7\u6C38\u4E45\u5931\u8D25\u5173\u952E\u8BCD: "${stPerf.searchTerm}"`);
          details.push({
            accountId: config2.accountId,
            // @ts-ignore
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            searchTerm: stPerf.searchTerm,
            action: "keyword_permanently_failed_skip",
            reason: `v310: \u5173\u952E\u8BCD\u5DF2\u8FDE\u7EED\u5931\u8D25\u22653\u6B21\uFF0C\u6807\u8BB0\u4E3A\u6C38\u4E45\u5931\u8D25\uFF0C\u4E0D\u518D\u91CD\u8BD5`,
            algorithmUsed: "search_term_analyzer",
            // v335
            // @ts-ignore
            apiSyncStatus: "permanently_failed"
          });
          continue;
        }
        if (decision.action === "CREATE_NEGATIVE_KEYWORD") {
          if (brandTerms.length > 0 && isProtectedKeyword(stPerf.searchTerm, brandTerms)) {
            details.push({
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // @ts-ignore
              campaignName: campaign.campaignName,
              searchTerm: stPerf.searchTerm,
              action: "brand_protect_skip",
              reason: `[\u54C1\u724C\u8BCD\u4FDD\u62A4] \u641C\u7D22\u8BCD"${stPerf.searchTerm}"\u542B\u6709\u54C1\u724C\u8BCD\uFF0C\u8DF3\u8FC7\u5426\u5B9A`,
              algorithmUsed: "search_term_analyzer"
              // v335
            });
            continue;
          }
          const matchingKeywords = await getKeywordsByCampaignId(campaignAmazonId);
          const matchingKw = matchingKeywords.find(
            (kw) => (
              // @ts-ignore
              kw.keywordText?.toLowerCase() === stPerf.searchTerm.toLowerCase()
            )
          );
          if (matchingKw?.createdAt) {
            const kwCreatedAt = new Date(matchingKw.createdAt);
            if (isNewKeyword(kwCreatedAt, matchingKw.clicks || 0, matchingKw.impressions || 0, 7)) {
              details.push({
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                // @ts-ignore
                campaignName: campaign.campaignName,
                searchTerm: stPerf.searchTerm,
                action: "exploration_protect_skip",
                reason: `[\u63A2\u7D22\u671F\u4FDD\u62A4] \u5BF9\u5E94\u6295\u653E\u8BCD\u5728\u63A2\u7D22\u671F\u5185\uFF0C\u8DF3\u8FC7\u5426\u5B9A\uFF0C\u7ED9\u4E88\u5145\u5206\u7684\u6570\u636E\u79EF\u7D2F\u65F6\u95F4`,
                algorithmUsed: "search_term_analyzer"
                // v335
              });
              continue;
            }
          }
          let negMatchType = decision.negativeMatchType === "negative_exact" ? "negative_exact" : "negative_phrase";
          const negValidation = sanitizeAndValidateKeyword(decision.targetValue, negMatchType);
          let cleanedNegText = negValidation.sanitizedText || decision.targetValue;
          if (!negValidation.isValid) {
            if (negMatchType === "negative_phrase" && negValidation.reasonCode === "EXCEEDS_MAX_WORDS_NEG_PHRASE") {
              const exactValidation = sanitizeAndValidateKeyword(decision.targetValue, "negative_exact");
              if (exactValidation.isValid) {
                negMatchType = "negative_exact";
                cleanedNegText = exactValidation.sanitizedText;
                log103.debug(`[SearchTermAnalysis] v204: \u5426\u5B9A\u77ED\u8BED"${decision.targetValue}"\u8D85\u8FC74\u8BCD\u9650\u5236\uFF0C\u81EA\u52A8\u5347\u7EA7\u4E3Anegative_exact`);
              } else {
                log103.warn(`[SearchTermAnalysis] v204: \u5426\u5B9A\u8BCD\u9884\u9A8C\u8BC1\u5931\u8D25(\u5347\u7EA7\u540E\u4ECD\u65E0\u6548): "${decision.targetValue}" \u2192 ${exactValidation.reasonMessage}`);
                details.push({
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
                  // @ts-ignore
                  campaignName: campaign.campaignName,
                  searchTerm: decision.targetValue,
                  action: "negative_validation_failed",
                  // @ts-ignore
                  reason: `v204\u9884\u9A8C\u8BC1\u5931\u8D25: ${exactValidation.reasonMessage}`,
                  algorithmUsed: "search_term_analyzer"
                  // v335
                });
                continue;
              }
            } else {
              log103.warn(`[SearchTermAnalysis] v204: \u5426\u5B9A\u8BCD\u9884\u9A8C\u8BC1\u5931\u8D25: "${decision.targetValue}" \u2192 ${negValidation.reasonMessage}`);
              details.push({
                localCampaignId: campaignLocalId,
                // @ts-ignore
                amazonCampaignId: campaignAmazonId,
                // @ts-ignore
                campaignName: campaign.campaignName,
                searchTerm: decision.targetValue,
                action: "negative_validation_failed",
                reason: `v204\u9884\u9A8C\u8BC1\u5931\u8D25: ${negValidation.reasonMessage}`,
                algorithmUsed: "search_term_analyzer"
                // v335
              });
              continue;
            }
          }
          let negativeAlreadyExists = false;
          if (!dryRun) {
            const dbInstance = await getDb();
            if (dbInstance) {
              const { negativeKeywords: negKwTable } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
              const { eq: eqOp, and: andOp } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
              const existingNeg = await dbInstance.select({ id: negKwTable.id, amazonNegativeKeywordId: negKwTable.amazonNegativeKeywordId }).from(negKwTable).where(andOp(
                eqOp(negKwTable.campaignId, campaignAmazonId),
                eqOp(negKwTable.negativeText, cleanedNegText)
              )).limit(1);
              if (existingNeg.length > 0) {
                negativeAlreadyExists = true;
                log103.info(`[SearchTermAnalysis] v170: \u5426\u5B9A\u5173\u952E\u8BCD\u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7: "${cleanedNegText}" campaignId=${campaign.campaignId}`);
              }
            }
          }
          const negativeKeyword = {
            accountId: config2.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            searchTerm: cleanedNegText,
            matchType: negMatchType,
            action: "add_negative",
            reason: `v204\u667A\u80FD\u5426\u5B9A: ${decision.reason}`,
            algorithmUsed: "search_term_analyzer",
            // v335
            apiSyncStatus: negativeAlreadyExists ? "already_exists" : "pending",
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
            // v478: 新增campaignType，用于API路由到正确的SP/SB/SD API
            campaignType: decision.campaignType || "sp",
            negativeScope: decision.negativeScope || "campaign"
          };
          details.push(negativeKeyword);
          if (!dryRun && !negativeAlreadyExists) {
            const matchType = negMatchType === "negative_exact" ? "exact" : "phrase";
            negativeKeyword._pendingDbInsert = {
              // @ts-ignore
              accountId: campaign.accountId || 0,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              negativeLevel: decision.negativeScope || "campaign",
              // v2: 使用算法决策的层级
              // @ts-ignore
              negativeType: "keyword",
              negativeText: cleanedNegText,
              negativeMatchType: negMatchType,
              negativeSource: decision.negativeType === "keyword" ? "smart_negation" : "auto_optimization",
              // v2
              campaignType: decision.campaignType || "sp",
              // v2: 新增
              negativeScope: (decision.campaignType === "sb") ? "adGroup" : (decision.negativeScope || "campaign"),
              // v2: 新增
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            };
            negativeKeywordsAdded++;
          }
        } else if (decision.action === "CREATE_NEGATIVE_PRODUCT_TARGET") {
          let negProdAlreadyExists = false;
          if (!dryRun) {
            const dbInstance = await getDb();
            if (dbInstance) {
              const { negativeKeywords: negKwTable } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
              const { eq: eqOp, and: andOp } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
              const existingNeg = await dbInstance.select({ id: negKwTable.id }).from(negKwTable).where(andOp(
                eqOp(negKwTable.campaignId, campaignAmazonId),
                eqOp(negKwTable.negativeText, decision.targetValue),
                eqOp(negKwTable.negativeType, "product")
              )).limit(1);
              if (existingNeg.length > 0) {
                negProdAlreadyExists = true;
                log103.info(`[SearchTermAnalysis] v2: \u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7: "${decision.targetValue}" campaignId=${campaign.campaignId}`);
              }
            }
          }
          const negativeProduct = {
            accountId: config2.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            searchTerm: decision.targetValue,
            matchType: "negative_product_target",
            action: "add_negative_product_target",
            reason: `v2\u667A\u80FD\u5426\u5B9A: ${decision.reason}`,
            // @ts-ignore
            algorithmUsed: "search_term_analyzer",
            apiSyncStatus: negProdAlreadyExists ? "already_exists" : "pending",
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
            // v2: 新增字段
            negativeType: decision.negativeType || "product",
            negativeScope: decision.negativeScope || "campaign",
            campaignType: decision.campaignType || "sp"
          };
          details.push(negativeProduct);
          if (!dryRun && !negProdAlreadyExists) {
            negativeProduct._pendingDbInsert = {
              // @ts-ignore
              accountId: campaign.accountId || 0,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              negativeLevel: decision.negativeScope || "campaign",
              negativeType: "product",
              negativeText: decision.targetValue,
              negativeMatchType: "negative_exact",
              negativeSource: "smart_negation",
              campaignType: decision.campaignType || "sp",
              negativeScope: decision.negativeScope || "campaign",
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            };
            negativeKeywordsAdded++;
          }
        } else if (decision.action === "CREATE_KEYWORD") {
          if (v2CampaignType === "sb" || v2CampaignType === "sd") {
            log103.info(`[SearchTermAnalysis] v351: ${v2CampaignType.toUpperCase()}\u5E7F\u544A\u6D3B\u52A8\u4E0D\u652F\u6301\u901A\u8FC7API\u521B\u5EFA\u5173\u952E\u8BCD\uFF0C\u8DF3\u8FC7: "${decision.targetValue}" (campaign="${campaignNameStr}")`);
            details.push({
              accountId: config2.accountId,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // @ts-ignore
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              action: "keyword_create",
              reason: `v354: ${v2CampaignType.toUpperCase()}\u5E7F\u544A\u6D3B\u52A8\u4E0D\u652F\u6301\u901A\u8FC7API\u521B\u5EFA\u5173\u952E\u8BCD\uFF0C\u8DF3\u8FC7`,
              algorithmUsed: "search_term_analyzer",
              apiSyncStatus: "skipped_unsupported_campaign_type"
            });
            continue;
          }
          if (isProductTargetingCamp) {
            log103.info(`[SearchTermAnalysis] v2: PT campaign\u4E0D\u652F\u6301\u6B63\u9762\u5173\u952E\u8BCD\uFF0C\u8DF3\u8FC7: "${decision.targetValue}" (campaign="${campaignNameStr}")`);
            continue;
          }
          if (!canAddPositiveKeyword(campaignTargetingType, campaignNameStr)) {
            log103.info(`[SearchTermAnalysis] v311: campaign\u4E0D\u652F\u6301\u6DFB\u52A0\u6B63\u9762\u5173\u952E\u8BCD\uFF0C\u8DF3\u8FC7: "${decision.targetValue}" (campaign="${campaignNameStr}", type=${campaignTargetingType})`);
            continue;
          }
          if (brandTerms.length > 0 && isProtectedKeyword(decision.targetValue, brandTerms)) {
            log103.info(`[SearchTermAnalysis] v353: \u54C1\u724C\u8BCD\u524D\u7F6E\u8FC7\u6EE4: "${decision.targetValue}" \u542B\u54C1\u724C\u8BCD\uFF0C\u8DF3\u8FC7\u6B63\u9762\u5173\u952E\u8BCD\u521B\u5EFA`);
            details.push({
              accountId: config2.accountId,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // @ts-ignore
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              action: "brand_protect_skip",
              reason: `v353: \u54C1\u724C\u8BCD\u524D\u7F6E\u8FC7\u6EE4 - "${decision.targetValue}"\u542B\u54C1\u724C\u8BCD\uFF0C\u4E0D\u521B\u5EFA\u6B63\u9762\u5173\u952E\u8BCD`,
              algorithmUsed: "search_term_analyzer"
            });
            continue;
          }
          if (campaignHasProductTargetAdGroup) {
            log103.info(`[SearchTermAnalysis] v353: \u5E7F\u544A\u7EC4\u5DF2\u6709product targets\uFF0C\u524D\u7F6E\u8DF3\u8FC7keyword\u521B\u5EFA: "${decision.targetValue}" (campaign="${campaignNameStr}")`);
            details.push({
              accountId: config2.accountId,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // @ts-ignore
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              action: "keyword_validation_failed",
              reason: `v353: \u5E7F\u544A\u7EC4\u5DF2\u6709product targets\uFF0C\u4E0D\u652F\u6301\u6DFB\u52A0keyword`,
              algorithmUsed: "search_term_analyzer",
              apiSyncStatus: "skipped_pt_adgroup"
            });
            continue;
          }
          if (isAsinSearchTerm(decision.targetValue)) {
            log103.debug(`[SearchTermAnalysis] v194: ASIN\u641C\u7D22\u8BCD"${decision.targetValue}"\u91CD\u5B9A\u5411\u4E3Aproduct target`);
            const ptBid = decision.suggestedBid || 0.5;
            details.push({
              accountId: config2.accountId,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // @ts-ignore
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              matchType: "product_target_exact",
              action: "add_product_target",
              reason: `v194: ASIN\u641C\u7D22\u8BCD\u81EA\u52A8\u91CD\u5B9A\u5411\u4E3Aproduct target: ${decision.reason}`,
              suggestedBid: ptBid,
              algorithmUsed: "search_term_analyzer",
              // v335
              apiSyncStatus: "pending",
              confidence: decision.confidence,
              dataMaturityLevel: decision.dataMaturityLevel,
              valueLevel: decision.valueLevel
            });
            continue;
          }
          const posValidation = sanitizeAndValidateKeyword(decision.targetValue, "positive");
          if (!posValidation.isValid) {
            log103.warn(`[SearchTermAnalysis] v204: \u6B63\u9762\u5173\u952E\u8BCD\u9884\u9A8C\u8BC1\u5931\u8D25: "${decision.targetValue}" \u2192 ${posValidation.reasonMessage}`);
            details.push({
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              // @ts-ignore
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              action: "keyword_validation_failed",
              reason: `v204\u9884\u9A8C\u8BC1\u5931\u8D25: ${posValidation.reasonMessage}`,
              algorithmUsed: "search_term_analyzer"
              // v335
            });
            continue;
          }
          const cleanedPosText = posValidation.sanitizedText;
          const matchType = decision.matchType || "phrase";
          const bid = decision.suggestedBid || 0.5;
          const newKeyword = {
            accountId: config2.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            searchTerm: cleanedPosText,
            matchType,
            action: "add_keyword",
            reason: `v204\u667A\u80FD\u6295\u653E: ${decision.reason}`,
            suggestedBid: bid,
            algorithmUsed: "search_term_analyzer",
            // v335
            apiSyncStatus: dryRun ? "pending" : "pending",
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
            valueLevel: decision.valueLevel
          };
          details.push(newKeyword);
          if (!dryRun) {
            const dbInstance = await getDb();
            if (dbInstance) {
              const adGroups6 = await getAdGroupsByCampaignId(campaignAmazonId);
              if (adGroups6.length > 0) {
                const adGroup = adGroups6[0];
                const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                const amazonCampaignId = campaignAmazonId;
                try {
                  const hasProductTargets = await adGroupHasProductTargets(adGroup.id);
                  if (hasProductTargets) {
                    log103.info(`[SearchTermAnalysis] v194: \u5E7F\u544A\u7EC4\u5DF2\u6709product targets\uFF0C\u4E0D\u80FD\u6DFB\u52A0keyword\uFF0C\u8DF3\u8FC7: "${decision.targetValue}"`);
                    newKeyword.apiSyncStatus = "skipped_pt_adgroup";
                    continue;
                  }
                } catch (ptCheckErr) {
                  log103.warn(`[SearchTermAnalysis] v194: \u68C0\u67E5product targets\u5931\u8D25: ${ptCheckErr.message}`);
                }
                const { keywords: keywords10 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
                const { eq: eqOp, and: andOp } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
                const existingKeywords = await dbInstance.select({ id: keywords10.id, keywordId: keywords10.keywordId, matchType: keywords10.matchType }).from(keywords10).where(andOp(
                  // @ts-ignore
                  eqOp(keywords10.accountId, config2.accountId),
                  // @ts-ignore
                  eqOp(keywords10.internalAdGroupId, adGroup.id),
                  // v420: 修复 - internalAdGroupId是int类型
                  eqOp(keywords10.keywordText, decision.targetValue)
                )).limit(10);
                if (existingKeywords.length > 0) {
                  if (existingKeywords.length > 1) {
                    const withId = existingKeywords.filter((k) => k.keywordId !== null);
                    const withoutId = existingKeywords.filter((k) => k.keywordId === null);
                    const toDelete = withId.length > 0 ? withoutId : withoutId.slice(1);
                    for (const dup of toDelete) {
                      try {
                        await dbInstance.delete(keywords10).where(eqOp(keywords10.id, dup.id));
                        log103.debug(`[SearchTermAnalysis] \u6E05\u7406\u91CD\u590D\u5173\u952E\u8BCD: id=${dup.id} "${decision.targetValue}"`);
                      } catch (delErr) {
                        log103.warn(`[SearchTermAnalysis] \u6E05\u7406\u91CD\u590D\u5173\u952E\u8BCD\u5931\u8D25: id=${dup.id}: ${delErr.message}`);
                      }
                    }
                  }
                  const existingMatchTypes = existingKeywords.map((k) => k.matchType || "unknown").join(",");
                  newKeyword.apiSyncStatus = "already_exists";
                  newKeyword.apiSyncDetail = JSON.stringify({ existingId: existingKeywords[0].id, existingKeywordId: existingKeywords[0].keywordId, existingMatchTypes });
                  log103.info(`[SearchTermAnalysis] v168: \u5173\u952E\u8BCD\u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7: "${decision.targetValue}" (\u8BF7\u6C42=${matchType}, \u5DF2\u5B58\u5728=${existingMatchTypes})`);
                } else {
                  let localKeywordId;
                  let isDuplicateInsert = false;
                  try {
                    const { sql: sqlTag } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
                    const insertResult = await dbInstance.insert(keywords10).values({
                      // @ts-ignore
                      internalAdGroupId: adGroup.id,
                      // v418: ID体系重构
                      keywordText: decision.targetValue,
                      matchType,
                      bid: String(bid),
                      // @ts-ignore
                      keywordStatus: "enabled",
                      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
                      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
                    }).onDuplicateKeyUpdate({
                      set: {
                        bid: sqlTag`VALUES(bid)`,
                        keywordStatus: sqlTag`VALUES(keyword_status)`,
                        updatedAt: sqlTag`NOW()`
                      }
                    });
                    localKeywordId = insertResult[0]?.insertId;
                    if (!localKeywordId || localKeywordId === 0) {
                      isDuplicateInsert = true;
                      log103.info(`[SearchTermAnalysis] v600: \u5173\u952E\u8BCDINSERT\u89E6\u53D1UPSERT\uFF08\u5E76\u53D1\u53BB\u91CD\uFF09: "${decision.targetValue}" [${matchType}]`);
                      newKeyword.apiSyncStatus = "already_exists";
                      newKeyword.apiSyncDetail = JSON.stringify({ reason: "v600_concurrent_dedup_upsert" });
                    }
                  } catch (insertErr) {
                    const errCode = insertErr.code;
                    const errMsg = insertErr.message || "";
                    if (errCode === "ER_DUP_ENTRY" || errMsg.includes("Duplicate entry")) {
                      isDuplicateInsert = true;
                      log103.info(`[SearchTermAnalysis] v600: \u5173\u952E\u8BCDINSERT\u91CD\u590D\u952E\u51B2\u7A81\uFF08\u5E76\u53D1\u7ADE\u6001\uFF09: "${decision.targetValue}" [${matchType}]`);
                      newKeyword.apiSyncStatus = "already_exists";
                      newKeyword.apiSyncDetail = JSON.stringify({ reason: "v600_dup_key_race_condition" });
                    } else {
                      throw insertErr;
                    }
                  }
                  if (isDuplicateInsert) {
                    continue;
                  }
                  if (Number(amazonAdGroupId) > 0 && Number(amazonCampaignId) > 0) {
                    try {
                      const apiResult = await syncNewKeywordsToAmazon(
                        config2.accountId,
                        [{
                          // @ts-ignore
                          localKeywordId: localKeywordId || void 0,
                          adGroupId: amazonAdGroupId,
                          campaignId: amazonCampaignId,
                          keywordText: decision.targetValue,
                          matchType,
                          bid
                        }]
                      );
                      if (apiResult.success > 0) {
                        newKeyword.apiSyncStatus = "synced";
                        log103.info(`[SearchTermAnalysis] v191: \u65B0\u5173\u952E\u8BCD[${matchType}]\u5DF2\u540C\u6B65: "${decision.targetValue}" bid=$${bid}`);
                      } else {
                        newKeyword.apiSyncStatus = "failed";
                        newKeyword.apiSyncDetail = JSON.stringify({ errors: apiResult.errors });
                        log103.warn(`[SearchTermAnalysis] \u65B0\u5173\u952E\u8BCD\u540C\u6B65\u5931\u8D25: "${decision.targetValue}" - ${apiResult.errors.join("; ")}`);
                      }
                    } catch (apiError) {
                      newKeyword.apiSyncStatus = "failed";
                      newKeyword.apiSyncDetail = JSON.stringify({ error: apiError.message });
                      log103.warn(`[SearchTermAnalysis] \u65B0\u5173\u952E\u8BCDAPI\u5F02\u5E38: "${decision.targetValue}" -`, apiError.message);
                    }
                  } else {
                    log103.warn(`[SearchTermAnalysis] \u7F3A\u5C11Amazon ID\uFF0C\u65E0\u6CD5\u540C\u6B65: adGroupId=${amazonAdGroupId}, campaignId=${amazonCampaignId}`);
                  }
                }
              }
            }
            if (newKeyword.apiSyncStatus !== "already_exists") {
              newKeywordsAdded++;
            }
          }
        } else if (decision.action === "CREATE_PRODUCT_TARGET") {
          const ptType = decision.productTargetingType || "exact";
          const bid = decision.suggestedBid || 0.5;
          const newTarget = {
            accountId: config2.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            // @ts-ignore
            campaignName: campaign.campaignName,
            searchTerm: decision.targetValue,
            matchType: `product_target_${ptType}`,
            action: "add_product_target",
            reason: `v191\u667A\u80FDASIN\u5B9A\u5411: ${decision.reason}`,
            suggestedBid: bid,
            algorithmUsed: "search_term_analyzer",
            // v335
            apiSyncStatus: dryRun ? "pending" : "pending",
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
            valueLevel: decision.valueLevel
          };
          details.push(newTarget);
          if (!dryRun) {
            const dbInstance = await getDb();
            if (dbInstance) {
              const adGroups6 = await getAdGroupsByCampaignId(campaignAmazonId);
              if (adGroups6.length > 0) {
                const adGroup = adGroups6[0];
                const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                const amazonCampaignId = campaignAmazonId;
                const { productTargets: productTargets5 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
                const { eq: eqOp, and: andOp } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
                const existingTargets = await dbInstance.select({ id: productTargets5.id, targetId: productTargets5.targetId }).from(productTargets5).where(andOp(
                  // @ts-ignore
                  eqOp(productTargets5.internalAdGroupId, adGroup.id),
                  // v420: 修复 - internalAdGroupId是int类型
                  eqOp(productTargets5.targetValue, decision.targetValue)
                )).limit(5);
                if (existingTargets.length > 0) {
                  newTarget.apiSyncStatus = "already_exists";
                  newTarget.apiSyncDetail = JSON.stringify({ existingId: existingTargets[0].id, existingTargetId: existingTargets[0].targetId });
                  log103.info(`[SearchTermAnalysis] v310: ASIN\u5B9A\u5411\u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7: "${decision.targetValue}"`);
                } else if (Number(amazonAdGroupId) > 0 && Number(amazonCampaignId) > 0) {
                  try {
                    const insertResult = await dbInstance.insert(productTargets5).values({
                      // @ts-ignore
                      internalAdGroupId: adGroup.id,
                      // v418: ID体系重构
                      targetType: "asin",
                      targetValue: decision.targetValue,
                      bid: String(bid),
                      targetStatus: "enabled",
                      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
                      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
                    });
                    const localTargetId = insertResult[0]?.insertId;
                    try {
                      const ptSyncResult = await syncNewProductTargetsToAmazon(
                        config2.accountId,
                        [{
                          // @ts-ignore
                          localTargetId: localTargetId || void 0,
                          adGroupId: amazonAdGroupId,
                          campaignId: amazonCampaignId,
                          asin: decision.targetValue,
                          targetingType: ptType,
                          // @ts-ignore
                          bid
                        }]
                      );
                      if (ptSyncResult.success > 0) {
                        newTarget.apiSyncStatus = "synced";
                        const mapKey = `${amazonAdGroupId}:${decision.targetValue}`;
                        const amazonTargetId = ptSyncResult.targetIdMap.get(mapKey);
                        if (amazonTargetId && localTargetId) {
                          await dbInstance.execute(sql`
                            UPDATE product_targets SET target_id = ${String(amazonTargetId)} WHERE id = ${localTargetId}
                          `);
                        }
                        log103.info(`[SearchTermAnalysis] v310: ASIN\u5B9A\u5411\u5DF2\u540C\u6B65: "${decision.targetValue}" bid=$${bid}`);
                      } else {
                        newTarget.apiSyncStatus = "failed";
                        newTarget.apiSyncDetail = JSON.stringify({ errors: ptSyncResult.errors });
                        log103.warn(`[SearchTermAnalysis] v310: ASIN\u5B9A\u5411\u540C\u6B65\u5931\u8D25: "${decision.targetValue}" - ${ptSyncResult.errors.join("; ")}`);
                      }
                    } catch (apiError) {
                      newTarget.apiSyncStatus = "failed";
                      newTarget.apiSyncDetail = JSON.stringify({ error: apiError.message });
                      log103.warn(`[SearchTermAnalysis] v310: ASIN\u5B9A\u5411API\u5F02\u5E38: "${decision.targetValue}" -`, apiError.message);
                    }
                  } catch (dbErr) {
                    newTarget.apiSyncStatus = "failed";
                    newTarget.apiSyncDetail = JSON.stringify({ error: `DB insert failed: ${dbErr.message}` });
                    log103.warn(`[SearchTermAnalysis] v310: ASIN\u5B9A\u5411DB\u5199\u5165\u5931\u8D25: "${decision.targetValue}" - ${dbErr.message}`);
                  }
                } else {
                  log103.warn(`[SearchTermAnalysis] v310: \u7F3A\u5C11Amazon ID\uFF0C\u65E0\u6CD5\u540C\u6B65ASIN\u5B9A\u5411: adGroupId=${amazonAdGroupId}, campaignId=${amazonCampaignId}`);
                }
              }
            }
          }
          log103.debug(`[SearchTermAnalysis] v310: ASIN\u5B9A\u5411\u51B3\u7B56[${ptType}]: "${decision.targetValue}" bid=$${bid} status=${newTarget.apiSyncStatus} (${decision.reason})`);
        }
      }
      if (!dryRun) {
        const negProdDetails = details.filter((d) => d.action === "add_negative_product_target" && d.localCampaignId === campaignLocalId);
        if (negProdDetails.length > 0) {
          try {
            const amazonCampaignIdStr = campaignAmazonId;
            const negProdCampaignType = negProdDetails[0]?.campaignType || "sp";
            const negProdScope = negProdDetails[0]?.negativeScope || "campaign";
            log103.info(`[SearchTermAnalysis] v2: \u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u540C\u6B65: ${negProdDetails.length}\u4E2A, \u7C7B\u578B=${negProdCampaignType}, \u5C42\u7EA7=${negProdScope}`);
            const negProdSyncResult = await syncNegativeProductTargetsToAmazon(
              config2.accountId,
              // @ts-ignore
              negProdDetails.map((d) => ({
                campaignId: amazonCampaignIdStr,
                // @ts-ignore
                adGroupId: d.adGroupId || "",
                asin: d.searchTerm,
                campaignType: d.campaignType || "sp",
                negativeScope: d.negativeScope || "campaign"
              }))
            );
            const negProdSyncStatus = negProdSyncResult.failed === 0 && negProdSyncResult.success > 0 ? "synced" : negProdSyncResult.success === 0 ? "failed" : "partial";
            for (const d of negProdDetails) {
              d.apiSyncStatus = negProdSyncStatus;
              if (negProdSyncResult.errors.length > 0) {
                d.apiSyncDetail = JSON.stringify({ errors: negProdSyncResult.errors });
              }
            }
            log103.info(`[SearchTermAnalysis] v2: \u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411API\u540C\u6B65: ${negProdDetails.length}\u4E2A, \u72B6\u6001=${negProdSyncStatus}`);
            if (negProdSyncStatus === "synced" || negProdSyncStatus === "partial") {
              const dbInstance = await getDb();
              if (dbInstance) {
                const { negativeKeywords: negativeKeywords8 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
                for (const d of negProdDetails) {
                  if (d._pendingDbInsert && d.apiSyncStatus !== "failed") {
                    try {
                      await dbInstance.insert(negativeKeywords8).values(d._pendingDbInsert);
                      log103.info(`[SearchTermAnalysis] v2: \u5426\u5B9A\u4EA7\u54C1DB\u5199\u5165\u6210\u529F: "${d.searchTerm}"`);
                    } catch (dbErr) {
                      log103.warn(`[SearchTermAnalysis] v2: \u5426\u5B9A\u4EA7\u54C1DB\u5199\u5165\u5931\u8D25: "${d.searchTerm}" - ${dbErr.message}`);
                    }
                  }
                }
              }
            }
          } catch (apiError) {
            for (const d of negProdDetails) {
              d.apiSyncStatus = "failed";
              d.apiSyncDetail = JSON.stringify({ error: apiError.message });
            }
            log103.warn(`[SearchTermAnalysis] v2: \u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411API\u540C\u6B65\u5931\u8D25:`, apiError.message);
          }
        }
        const negativeDetails = details.filter((d) => d.action === "add_negative" && d.localCampaignId === campaignLocalId);
        if (negativeDetails.length > 0) {
          try {
            const amazonCampaignId = campaignAmazonId;
            const negCampaignType = negativeDetails[0]?.campaignType || "sp";
            const normalizedNegType = negCampaignType === "sb" || negCampaignType === "sd" ? negCampaignType : "sp";
            if (normalizedNegType === "sb" || normalizedNegType === "sd") {
              log103.warn(`[SearchTermAnalysis] v478: ${normalizedNegType.toUpperCase()}\u5E7F\u544A\u6D3B\u52A8\u5426\u5B9A\u5173\u952E\u8BCD\u9700\u8981\u4E13\u7528API\uFF0C\u5F53\u524D\u8DF3\u8FC7 (Campaign ${campaign.campaignName})`);
              for (const d of negativeDetails) {
                d.apiSyncStatus = "skipped_unsupported_campaign_type";
                d.apiSyncDetail = JSON.stringify({ reason: `v478: ${normalizedNegType.toUpperCase()}\u5E7F\u544A\u6D3B\u52A8\u5426\u5B9A\u5173\u952E\u8BCD\u9700\u8981\u4E13\u7528API` });
              }
            }
            const negSyncResult = normalizedNegType === "sp" ? await syncNegativeKeywordsToAmazon(
              // @ts-ignore
              config2.accountId,
              // @ts-ignore
              negativeDetails.map((d) => ({
                // @ts-ignore
                campaignId: amazonCampaignId,
                keywordText: d.searchTerm,
                matchType: d.matchType === "negative_exact" ? "negativeExact" : "negativePhrase",
                level: d.negativeScope === "ad_group" ? "adgroup" : "campaign",
                adGroupId: d.adGroupId || void 0
              }))
            ) : { success: 0, failed: 0, errors: [], keywordIdMap: /* @__PURE__ */ new Map() };
            if (normalizedNegType === "sp") {
              const negSyncStatus = negSyncResult.failed === 0 && negSyncResult.success > 0 ? "synced" : negSyncResult.success === 0 ? "failed" : "partial";
              for (const d of negativeDetails) {
                d.apiSyncStatus = negSyncStatus;
                if (negSyncResult.errors.length > 0) {
                  d.apiSyncDetail = JSON.stringify({ errors: negSyncResult.errors });
                }
              }
              log103.info(`[SearchTermAnalysis] Amazon API\u540C\u6B65: ${negativeDetails.length}\u4E2A\u5426\u5B9A\u8BCD, \u72B6\u6001=${negSyncStatus} (Campaign ${campaign.campaignName})`);
              if (negSyncStatus === "synced" || negSyncStatus === "partial") {
                const dbInstance = await getDb();
                if (dbInstance) {
                  const { negativeKeywords: negativeKeywords8 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
                  for (const d of negativeDetails) {
                    if (d._pendingDbInsert && d.apiSyncStatus !== "failed") {
                      try {
                        await dbInstance.insert(negativeKeywords8).values(d._pendingDbInsert);
                        const mapKey = `campaign:${amazonCampaignId}:${d.searchTerm.toLowerCase()}`;
                        const amazonNegId = negSyncResult.keywordIdMap?.get(mapKey);
                        if (amazonNegId) {
                          await dbInstance.execute(sql`
 UPDATE negative_keywords 
 SET amazon_negative_keyword_id = ${amazonNegId}
 WHERE negativeText = ${d.searchTerm}
 AND campaignId = ${campaign.campaignId}
 AND amazon_negative_keyword_id IS NULL
 LIMIT 1
 `);
                          log103.info(`[SearchTermAnalysis] v195: \u5426\u8BCDID\u56DE\u5199\u6210\u529F: "${d.searchTerm}" -> ${amazonNegId}`);
                        }
                        log103.info(`[SearchTermAnalysis] v165: \u5426\u8BCDDB\u5199\u5165\u6210\u529F: "${d.searchTerm}"`);
                      } catch (dbErr) {
                        log103.warn(`[SearchTermAnalysis] v165: \u5426\u8BCDDB\u5199\u5165\u5931\u8D25: "${d.searchTerm}" - ${dbErr.message}`);
                      }
                    }
                  }
                }
                try {
                  const successNegDetails = negativeDetails.filter((d) => d.apiSyncStatus !== "failed");
                  if (successNegDetails.length > 0) {
                    scheduleNegativeKeywordVerification(
                      config2.accountId,
                      // @ts-ignore
                      successNegDetails.map((d) => ({
                        // @ts-ignore
                        localId: d._pendingDbInsert?.id || 0,
                        keywordText: d.searchTerm,
                        // @ts-ignore
                        matchType: d.matchType === "negative_exact" ? "negativeExact" : "negativePhrase",
                        // @ts-ignore
                        localCampaignId: campaignLocalId,
                        amazonCampaignId: campaignAmazonId
                      }))
                    );
                  }
                } catch (verifyErr) {
                  log103.warn(`[SearchTermAnalysis] v166: \u6CE8\u518C\u9A8C\u8BC1\u4EFB\u52A1\u5931\u8D25(\u4E0D\u5F71\u54CD\u4E3B\u6D41\u7A0B): ${verifyErr.message}`);
                }
              } else {
                log103.warn(`[SearchTermAnalysis] v165: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7\u672C\u5730DB\u5199\u5165 (Campaign ${campaign.campaignName})`);
              }
            }
          } catch (apiError) {
            for (const d of negativeDetails) {
              d.apiSyncStatus = "failed";
              d.apiSyncDetail = JSON.stringify({ error: apiError.message });
            }
            log103.warn(`[SearchTermAnalysis] Amazon API\u540C\u6B65\u5931\u8D25\uFF0C\u672A\u5199\u5165\u672C\u5730DB (Campaign ${campaign.campaignName}):`, apiError.message);
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
  return { executed: true, negativeKeywordsAdded, newKeywordsAdded, details };
}
async function executeAutoNgramNegation(config2, campaigns6, dryRun) {
  const details = [];
  let negativeKeywordsAdded = 0;
  if (!config2.accountId || campaigns6.length === 0) {
    return { executed: false, negativeKeywordsAdded: 0, details: [{ reason: "\u65E0\u8D26\u53F7\u6216\u65E0\u5E7F\u544A\u6D3B\u52A8" }] };
  }
  const campaignIds = campaigns6.map((c) => c.id);
  const globalSuggestions = await generateNegativeKeywordSuggestions(
    // @ts-ignore
    config2.accountId,
    campaignIds,
    30
    // 30天数据窗口
    // @ts-ignore
  );
  const autoExecuteSuggestions = globalSuggestions.filter((s) => s.priority === "high");
  if (autoExecuteSuggestions.length === 0) {
    log103.info(`[NgramAutoNegation] v337.3: \u8D26\u53F7${config2.accountId}\u65E0\u9AD8\u4F18\u5148\u7EA7Ngram\u5426\u5B9A\u5EFA\u8BAE`);
    return { executed: true, negativeKeywordsAdded: 0, details: [{ reason: "\u65E0\u9AD8\u4F18\u5148\u7EA7Ngram\u5426\u5B9A\u5EFA\u8BAE" }] };
  }
  log103.info(`[NgramAutoNegation] v337.3: \u53D1\u73B0${autoExecuteSuggestions.length}\u4E2A\u9AD8\u4F18\u5148\u7EA7Ngram\u5426\u5B9A\u5EFA\u8BAE\uFF0C\u5F00\u59CB\u5168\u5C40/\u5C40\u90E8\u5206\u6790`);
  const dbInstance = await getDb();
  if (!dbInstance) {
    return { executed: false, negativeKeywordsAdded: 0, details: [{ error: "Database not available" }] };
  }
  for (const suggestion of autoExecuteSuggestions) {
    try {
      const startDate = /* @__PURE__ */ new Date();
      startDate.setDate(startDate.getDate() - 30);
      const startDateStr = startDate.toISOString().split("T")[0];
      const campaignPerformance = await dbInstance.execute(sql`
 SELECT 
 campaign_id,
 SUM(search_term_spend) as spend,
 SUM(search_term_sales) as sales,
 SUM(search_term_orders) as orders,
 SUM(search_term_clicks) as clicks
 FROM search_terms
 WHERE account_id = ${config2.accountId}
 AND report_start_date >= ${startDateStr}
 AND search_term LIKE ${`%${suggestion.ngram}%`}
 AND campaign_id IN (${safeInClause(campaignIds)})
 GROUP BY campaign_id
 `);
      const perfRows = campaignPerformance[0] || [];
      let badCampaigns = [];
      let goodCampaigns = [];
      for (const row of perfRows) {
        const spend = Number(row.spend) || 0;
        const sales = Number(row.sales) || 0;
        const orders = Number(row.orders) || 0;
        const acos = sales > 0 ? spend / sales * 100 : Infinity;
        if (orders === 0 || acos > 100) {
          badCampaigns.push(Number(row.campaign_id));
        } else {
          goodCampaigns.push(Number(row.campaign_id));
        }
      }
      const isGlobalNegation = goodCampaigns.length === 0;
      const targetCampaigns = isGlobalNegation ? campaignIds : badCampaigns;
      const negationScope = isGlobalNegation ? "global" : "local";
      if (targetCampaigns.length === 0) {
        continue;
      }
      log103.info(`[NgramAutoNegation] v337.3: Ngram "${suggestion.ngram}" \u2192 ${negationScope}\u5426\u5B9A (${targetCampaigns.length}\u4E2Acampaign)`);
      if (dryRun) {
        details.push({
          // @ts-ignore
          ngram: suggestion.ngram,
          // @ts-ignore
          matchType: suggestion.matchType,
          negationScope,
          targetCampaignCount: targetCampaigns.length,
          // @ts-ignore
          reason: suggestion.reason,
          dryRun: true
        });
        negativeKeywordsAdded += targetCampaigns.length;
        continue;
      }
      for (const campaignId of targetCampaigns) {
        try {
          const execResult = await executeNegativeKeywords(
            // @ts-ignore
            config2.accountId,
            campaignId,
            null,
            // campaign级否定
            // @ts-ignore
            [{ keyword: suggestion.ngram, matchType: suggestion.matchType }]
          );
          if (execResult.addedCount > 0) {
            negativeKeywordsAdded += execResult.addedCount;
          }
          details.push({
            // @ts-ignore
            ngram: suggestion.ngram,
            // @ts-ignore
            matchType: suggestion.matchType,
            campaignId,
            negationScope,
            success: execResult.success,
            addedCount: execResult.addedCount,
            // @ts-ignore
            reason: suggestion.reason
          });
        } catch (execError) {
          details.push({
            // @ts-ignore
            ngram: suggestion.ngram,
            campaignId,
            error: execError.message
          });
        }
      }
    } catch (error48) {
      details.push({
        // @ts-ignore
        ngram: suggestion.ngram,
        error: `\u5206\u6790\u5931\u8D25: ${error48.message}`
      });
    }
  }
  const pendingSuggestions = globalSuggestions.filter((s) => s.priority !== "high");
  if (pendingSuggestions.length > 0) {
    details.push({
      pendingReviewCount: pendingSuggestions.length,
      message: `${pendingSuggestions.length}\u4E2A\u4E2D/\u4F4E\u4F18\u5148\u7EA7Ngram\u5426\u5B9A\u5EFA\u8BAE\u5F85\u7528\u6237\u5BA1\u6838`
    });
  }
  return { executed: true, negativeKeywordsAdded, details };
}
var log103;
var init_searchTermExecutor = __esm({
  "server/targetEngine/searchTermExecutor.ts"() {
    "use strict";
    init_db2();
    init_db2();
    init_drizzle_orm();
    init_safeSql();
    init_amazonApiHelper();
    init_algorithmUtils();
    init_postOptimizationVerifier();
    init_targetingAlgorithm();
    init_keywordValidator();
    init_logger();
    init_idTypes();
    init_ngramAnalysis();
    log103 = createModuleLogger("TargetEngine");
    __name(executeSearchTermAnalysis, "executeSearchTermAnalysis");
    __name(executeAutoNgramNegation, "executeAutoNgramNegation");
  }
});

