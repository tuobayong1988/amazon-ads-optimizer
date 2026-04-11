// Extracted from production dist/index.js
// Original module: server/automation/searchTermHarvester.ts
// Lines: 671

var searchTermHarvester_exports = {};
__export(searchTermHarvester_exports, {
  batchHarvestSearchTerms: () => batchHarvestSearchTerms,
  harvestSearchTermAtomic: () => harvestSearchTermAtomic,
  identifyHarvestCandidates: () => identifyHarvestCandidates
});
async function identifyHarvestCandidates(accountId, config2 = {}) {
  const cfg = { ...DEFAULT_HARVEST_CONFIG, ...config2 };
  const candidates = [];
  try {
    const allCampaigns = await getCampaignsByAccountId(accountId);
    if (!allCampaigns || allCampaigns.length === 0) {
      log34.debug(`\u8D26\u53F7 ${accountId} \u65E0\u5E7F\u544A\u6D3B\u52A8`);
      return [];
    }
    // v620-fix14: 扩展SB/SD搜索词收割 - SP auto + SB + SD campaigns都作为源
    const spAutoCampaigns = allCampaigns.filter(
      (c) => c.campaignStatus === "enabled" && (c.campaignType === "sp_auto" || c.targetingType === "auto")
    );
    const sbCampaigns = allCampaigns.filter(
      (c) => c.campaignStatus === "enabled" && c.campaignType === "sb"
    );
    const sdCampaigns = allCampaigns.filter(
      (c) => c.campaignStatus === "enabled" && c.campaignType === "sd"
    );
    const sourceCampaigns = [
      ...spAutoCampaigns.map(c => ({ ...c, _sourceType: 'sp_auto' })),
      ...sbCampaigns.map(c => ({ ...c, _sourceType: 'sb' })),
      ...sdCampaigns.map(c => ({ ...c, _sourceType: 'sd' }))
    ];
    const manualCampaigns = allCampaigns.filter(
      (c) => c.campaignStatus === "enabled" && c.campaignType === "sp_manual" && c.targetingType === "manual"
    );
    if (sourceCampaigns.length === 0) {
      log34.info(`\u8D26\u53F7 ${accountId} \u65E0\u53EF\u6536\u5272\u6E90Campaign(SP auto/SB/SD)\uFF0C\u8DF3\u8FC7\u6536\u5272`);
      return [];
    }
    log34.info(`v620-fix14: \u8D26\u53F7 ${accountId} \u6536\u5272\u6E90: SP_auto=${spAutoCampaigns.length}, SB=${sbCampaigns.length}, SD=${sdCampaigns.length}, \u76EE\u6807SP_manual=${manualCampaigns.length}`);
    for (const sourceCampaign of sourceCampaigns) {
      const searchTermsList = await getSearchTermsByCampaignId(String(sourceCampaign.campaignId));
      for (const st of searchTermsList) {
        const clicks = Number(st.searchTermClicks) || 0;
        const orders = Number(st.searchTermOrders) || 0;
        const spend = parseFloat(String(st.searchTermSpend || "0"));
        const sales = parseFloat(String(st.searchTermSales || "0"));
        if (clicks < cfg.minClicks || orders < cfg.minOrders) continue;
        const acos = sales > 0 ? spend / sales * 100 : 999;
        const roas = spend > 0 ? sales / spend : 0;
        const cvr = clicks > 0 ? orders / clicks * 100 : 0;
        if (acos > cfg.maxAcos && roas < cfg.minRoas) continue;
        // v620-fix14: ASIN搜索词 → PT收割（任务6）
        if (isAsinSearchTerm(st.searchTerm)) {
          // 查找PT目标广告组
          const ptTargetInfo = await findTargetPTAdGroup(st.searchTerm, allCampaigns);
          if (!ptTargetInfo) {
            log34.info(`v620-fix14: ASIN搜索词 "${st.searchTerm}" 无可用PT广告组，跳过`);
            continue;
          }
          // 检查是否已存在相同的product target
          const existingPTs = await getProductTargetsByAdGroupId(ptTargetInfo.adGroupId);
          const asinUpper = st.searchTerm.trim().toUpperCase();
          const alreadyExistsPT = existingPTs.some(
            (pt) => pt.expressionValue?.toUpperCase() === asinUpper || pt.resolvedAsin?.toUpperCase() === asinUpper
          );
          if (alreadyExistsPT) continue;
          const suggestedBid = calculateHarvestBid({ clicks, orders, spend, sales }, cfg);
          const sourceAdGroup = st.internalAdGroupId ? await getAdGroupById(st.internalAdGroupId) : null;
          if (!sourceAdGroup) continue;
          candidates.push({
            searchTerm: st.searchTerm,
            sourceAdGroupId: st.internalAdGroupId,
            sourceCampaignId: sourceCampaign.id,
            sourceAmazonAdGroupId: sourceAdGroup.adGroupId,
            sourceAmazonCampaignId: sourceCampaign.campaignId,
            targetAdGroupId: ptTargetInfo.adGroupId,
            targetCampaignId: ptTargetInfo.campaignId,
            targetAmazonAdGroupId: ptTargetInfo.amazonAdGroupId,
            targetAmazonCampaignId: ptTargetInfo.amazonCampaignId,
            suggestedBid,
            performance: { clicks, orders, spend, sales, acos, roas, cvr },
            reason: `[PT收割] ASIN高绩效: ${orders}单, ACoS=${acos.toFixed(1)}%, ROAS=${roas.toFixed(2)}`,
            harvestType: 'product_target',
            sourceCampaignType: sourceCampaign._sourceType || 'sp_auto'
          });
          continue;
        }
        const validation = sanitizeAndValidateKeyword(st.searchTerm);
        if (!validation.isValid) {
          log34.warn(`v194: 搜索词校验失败 "${st.searchTerm}": ${validation.reasonMessage || validation.reasonCode || "invalid"}`);
          continue;
        }
        const targetInfo = await findTargetAdGroup(
          st.searchTerm,
          manualCampaigns,
          sourceCampaign
        );
        if (!targetInfo) continue;
        const existingKeywords = await getKeywordsByAdGroupId(targetInfo.adGroupId);
        const alreadyExists = existingKeywords.some(
          (k) => k.keywordText?.toLowerCase() === st.searchTerm.toLowerCase() && k.matchType === "exact"
        );
        if (alreadyExists) continue;
        const suggestedBid = calculateHarvestBid(
          { clicks, orders, spend, sales },
          cfg
        );
        const sourceAdGroup = st.internalAdGroupId ? await getAdGroupById(st.internalAdGroupId) : null;
        if (!sourceAdGroup) continue;
        candidates.push({
          searchTerm: st.searchTerm,
          sourceAdGroupId: st.internalAdGroupId,
          sourceCampaignId: sourceCampaign.id,
          sourceAmazonAdGroupId: sourceAdGroup.adGroupId,
          sourceAmazonCampaignId: sourceCampaign.campaignId,
          targetAdGroupId: targetInfo.adGroupId,
          targetCampaignId: targetInfo.campaignId,
          targetAmazonAdGroupId: targetInfo.amazonAdGroupId,
          targetAmazonCampaignId: targetInfo.amazonCampaignId,
          suggestedBid,
          performance: { clicks, orders, spend, sales, acos, roas, cvr },
          reason: `高绩效搜索词: ${orders}单, ACoS=${acos.toFixed(1)}%, ROAS=${roas.toFixed(2)}, CVR=${cvr.toFixed(1)}%`,
          harvestType: 'keyword',
          sourceCampaignType: sourceCampaign._sourceType || 'sp_auto'
        });
      }
    }
    log34.debug(`\u8D26\u53F7 ${accountId} \u8BC6\u522B\u5230 ${candidates.length} \u4E2A\u6536\u5272\u5019\u9009\u9879`);
    return candidates;
  } catch (error48) {
    log34.warn(`\u8BC6\u522B\u5019\u9009\u9879\u5931\u8D25:`, error48.message);
    return [];
  }
}
async function harvestSearchTermAtomic(candidate, apiClient, accountId) {
  const result = {
    searchTerm: candidate.searchTerm,
    success: false,
    stage: "failed"
  };
  const isPTHarvest = candidate.harvestType === 'product_target';
  const sourceCampaignType = candidate.sourceCampaignType || 'sp_auto';
  log34.info(`v620-fix14: 开始原子收割: "${candidate.searchTerm}" (${candidate.reason}) type=${isPTHarvest ? 'PT' : 'keyword'} source=${sourceCampaignType}`);

  // ========== Step1: 创建正向关键词或Product Target ==========
  if (isPTHarvest) {
    // PT收割: 创建product target
    try {
      const asinValue = candidate.searchTerm.trim().toUpperCase();
      log34.info(`v620-fix14c: Step1 PT创建参数: adGroupId=${candidate.targetAmazonAdGroupId}, campaignId=${candidate.targetAmazonCampaignId}, asin=${asinValue}, bid=${candidate.suggestedBid}`);
      const createResult = await apiClient.createSpProductTargets([{
        adGroupId: String(candidate.targetAmazonAdGroupId),
        campaignId: String(candidate.targetAmazonCampaignId),
        expression: [{ type: "asinSameAs", value: asinValue }],
        expressionType: "manual",
        bid: candidate.suggestedBid,
        state: "enabled"
      }]);
      if (!createResult.success || createResult.createdTargets.length === 0 || !createResult.createdTargets[0].targetId) {
        const errorMsg = createResult.errors.length > 0 ? (() => { try { return JSON.stringify(createResult.errors); } catch(_emErr) { return createResult.errors.map(e => { try { return typeof e === "object" ? JSON.stringify(e) : String(e); } catch(_) { return "[unserializable]"; } }).join(", "); } })() : "未知错误"; // fix24-P3-1b
        const isDuplicate = createResult.errors.some(
          (e) => String(e.code || e).includes("DUPLICATE") || String(e.details || e).includes("already exists")
        );
        if (isDuplicate) {
          log34.info(`v620-fix14: PT已存在，跳过: "${candidate.searchTerm}"`);
          result.error = "Product Target已存在于目标广告组";
          return result;
        }
        result.error = `Step1 创建PT失败: ${errorMsg}`;
        log34.warn(`${result.error}`);
        return result;
      }
      result.createdTargetId = createResult.createdTargets[0].targetId;
      result.stage = "pt_created";
      log34.info(`v620-fix14: Step1 完成: 创建PT targetId=${result.createdTargetId}`);
    } catch (error48) {
      result.error = `Step1 PT异常: ${error48.message}`;
      log34.warn(`${result.error}`);
      return result;
    }
  } else {
    // 关键词收割: 创建SP keyword
    try {
      log34.info(`v620-fix14c: Step1 keyword创建参数: adGroupId=${candidate.targetAmazonAdGroupId}, campaignId=${candidate.targetAmazonCampaignId}, bid=${candidate.suggestedBid}`);
      const createResult = await apiClient.createSpKeywords([{
        internal_ad_group_id: String(candidate.targetAmazonAdGroupId),
        campaignId: String(candidate.targetAmazonCampaignId),
        keywordText: candidate.searchTerm,
        matchType: "exact",
        bid: candidate.suggestedBid,
        state: "enabled"
      }]);
      if (!createResult.success || createResult.createdKeywords.length === 0) {
        const errorMsg = createResult.errors.length > 0 ? (() => { try { return JSON.stringify(createResult.errors); } catch(_emErr) { return createResult.errors.map(e => { try { return typeof e === "object" ? JSON.stringify(e) : String(e); } catch(_) { return "[unserializable]"; } }).join(", "); } })() : "未知错误"; // fix24-P3-1b
        const isDuplicate = createResult.errors.some(
          (e) => { try { const s = typeof e === 'object' ? JSON.stringify(e) : String(e); return s.includes("DUPLICATE") || s.includes("already exists"); } catch(_) { return false; } }
        );
        // v620-fix14g-P3: fix24-P3-1 修复String(e)对API错误对象的TypeError
        if (isDuplicate) {
          log34.info(`关键词已存在，跳过: "${candidate.searchTerm}"`);
          result.error = "关键词已存在于目标广告组";
          return result;
        }
        result.error = `Step1 创建关键词失败: ${errorMsg}`;
        log34.warn(`${result.error}`);
        return result;
      }
      result.createdKeywordId = createResult.createdKeywords[0].keywordId;
      result.stage = "keyword_created";
      log34.info(`Step1 完成: 创建关键词 ID=${result.createdKeywordId}`);
    } catch (error48) {
      result.error = `Step1 异常: ${error48.message}`;
      log34.warn(`${result.error}`);
      return result;
    }
  }

  // ========== Step2: 在源广告组添加否定 - 根据源campaign类型选择不同API ==========
  const searchTermWords = candidate.searchTerm.trim().split(/\s+/);
  const negativeMatchType = searchTermWords.length <= 2 ? "negativePhrase" : "negativeExact";
  try {
    if (isPTHarvest) {
      // ASIN搜索词: 添加否定product target
      log34.info(`v620-fix14: ASIN否定 - 添加否定product target到源广告组`);
      const asinValue = candidate.searchTerm.trim().toUpperCase();
      await apiClient.createSpNegativeTargets([{
        adGroupId: String(candidate.sourceAmazonAdGroupId),
        campaignId: String(candidate.sourceAmazonCampaignId),
        expression: [{ type: "asinSameAs", value: asinValue }],
        expressionType: "manual",
        state: "enabled"
      }]);
      result.stage = "negative_added";
      log34.info(`v620-fix14: Step2 完成: 添加否定PT`);
    } else if (sourceCampaignType === 'sb') {
      // SB源: 使用SB否定关键词API
      log34.info(`v620-fix14: SB源否定 - 使用createSbNegativeKeywords`);
      await apiClient.createSbNegativeKeywords([{
        campaignId: String(candidate.sourceAmazonCampaignId),
        adGroupId: String(candidate.sourceAmazonAdGroupId),
        keywordText: candidate.searchTerm,
        matchType: negativeMatchType === "negativePhrase" ? "NEGATIVE_PHRASE" : "NEGATIVE_EXACT",
        state: "ENABLED"
      }]);
      result.stage = "negative_added";
      log34.info(`v620-fix14: Step2 完成: SB否定关键词已添加`);
    } else if (sourceCampaignType === 'sd') {
      // SD源: SD不支持关键词否定，只能跳过否定步骤
      log34.info(`v620-fix14: SD源 - SD不支持关键词否定，跳过Step2`);
      result.stage = "negative_skipped";
    } else {
      // SP源: 使用原有SP否定关键词API
      log34.info(`v230: 搜索词"${candidate.searchTerm}"包含${searchTermWords.length}个词，使用${negativeMatchType}否定类型`);
      const negativeResult = await apiClient.createSpNegativeKeywords([{
        adGroupId: String(candidate.sourceAmazonAdGroupId),
        campaignId: String(candidate.sourceAmazonCampaignId),
        keywordText: candidate.searchTerm,
        matchType: negativeMatchType,
        state: "enabled"
      }]);
      const negativeErrors = negativeResult.filter((r) => r.code && r.code !== "SUCCESS");
      if (negativeErrors.length > 0) {
        const isDuplicate = negativeErrors.some(
          (e) => String(e.code).includes("DUPLICATE") || String(e.details).includes("already exists")
        );
        if (!isDuplicate) {
          log34.warn(`Step2 失败，开始回滚 Step1...`);
          if (!isPTHarvest) await rollbackKeywordCreation(apiClient, result.createdKeywordId);
          result.stage = "rolled_back";
          result.error = `Step2 否定词创建失败: ${JSON.stringify(negativeErrors)}`;
          result.rollbackInfo = `已回滚: 删除关键词 ID=${result.createdKeywordId}`;
          return result;
        }
      }
      const successNeg = negativeResult.find((r) => !r.code || r.code === "SUCCESS");
      if (successNeg) {
        result.createdNegativeKeywordId = successNeg.keywordId;
      }
      result.stage = "negative_added";
      log34.info(`Step2 完成: 添加否定词 ID=${result.createdNegativeKeywordId}`);
    }
  } catch (error48) {
    if (sourceCampaignType === 'sb' || sourceCampaignType === 'sd') {
      // SB/SD否定失败不回滚，继续执行
      log34.warn(`v620-fix14: ${sourceCampaignType.toUpperCase()}否定失败(${error48.message})，继续执行Step3`);
      result.stage = "negative_skipped";
    } else {
      log34.warn(`Step2 异常: ${error48.message}，开始回滚 Step1...`);
      if (!isPTHarvest) await rollbackKeywordCreation(apiClient, result.createdKeywordId);
      result.stage = "rolled_back";
      result.error = `Step2 异常: ${error48.message}`;
      result.rollbackInfo = isPTHarvest ? `PT已创建但否定失败` : `已回滚: 删除关键词 ID=${result.createdKeywordId}`;
      return result;
    }
  }

  // ========== Step3: 本地DB记录 ==========
  try {
    if (isPTHarvest) {
      // PT收割: 写入product_targets表
      const amazonTargetId = String(result.createdTargetId || "");
      if (!amazonTargetId || amazonTargetId === "undefined" || amazonTargetId === "null" || amazonTargetId === "0") {
        log34.warn(`v620-fix14: Step3 中止 - Amazon targetId无效: "${amazonTargetId}"`);
        result.success = true;
        result.stage = "negative_added";
        return result;
      }
      const asinValue = candidate.searchTerm.trim().toUpperCase();
      const localPTId = await createProductTarget({
        accountId,
        campaignId: String(candidate.targetAmazonCampaignId),
        internalAdGroupId: candidate.targetAdGroupId,
        targetId: amazonTargetId,
        targetType: "asin",
        targetValue: asinValue,
        targetExpression: JSON.stringify([{ type: "asinSameAs", value: asinValue }]),
        bid: candidate.suggestedBid.toFixed(2),
        targetStatus: "enabled"
      });
      result.localTargetId = localPTId;
      log34.info(`v620-fix14: 本地PT已创建: localId=${localPTId}, amazonTargetId=${amazonTargetId}`);
      // 记录optimization_event
      try {
        await insertOptimizationEvent({
          accountId,
          eventCategory: "search_term_action",
          actionType: "product_target_create",
          campaignId: candidate.targetCampaignId,
          keywordText: candidate.searchTerm,
          matchType: "asinSameAs",
          previousBid: "0.00",
          newBid: candidate.suggestedBid.toFixed(2),
          changeReason: `[PT收割] ${candidate.reason} | amazonTargetId=${amazonTargetId} | source=${sourceCampaignType}`,
          status: "success",
          apiSyncStatus: "synced",
          apiSyncDetail: JSON.stringify({ syncedBy: "searchTermHarvester-v620-fix14", amazonTargetId, syncMethod: "direct_api_call" }),
          sourceTable: "search_term_harvester"
        });
      } catch (eventErr) {
        log34.warn(`v620-fix14: 记录PT optimization_event失败: ${eventErr.message}`);
      }
    } else {
      // 关键词收割: 原有逻辑
      const amazonKeywordId = String(result.createdKeywordId || "");
      if (!amazonKeywordId || amazonKeywordId === "undefined" || amazonKeywordId === "null" || amazonKeywordId === "0") {
        log34.warn(`v357: Step3 中止 - Amazon keywordId无效: "${amazonKeywordId}"`);
        result.success = true;
        result.stage = "negative_added";
        return result;
      }
      const localKeywordId = await createKeyword({
        accountId,
        campaignId: String(candidate.targetAmazonCampaignId),
        internalAdGroupId: candidate.targetAdGroupId,
        keywordId: amazonKeywordId,
        keywordText: candidate.searchTerm,
        matchType: "exact",
        bid: candidate.suggestedBid.toFixed(2),
        keywordStatus: "enabled"
      });
      result.localKeywordId = localKeywordId;
      log34.info(`v357: 本地keyword已创建: localId=${localKeywordId}, amazonKeywordId=${amazonKeywordId}`);
      await addNegativeKeyword({
        campaignId: candidate.sourceCampaignId,
        adGroupId: candidate.sourceAdGroupId,
        keyword: candidate.searchTerm,
        matchType: negativeMatchType === "negativePhrase" ? "phrase" : "exact",
        level: "ad_group"
      });
      await createBiddingLog({
        accountId,
        campaignId: String(candidate.targetAmazonCampaignId),
        internalAdGroupId: candidate.targetAdGroupId,
        logTargetType: "keyword",
        targetId: localKeywordId,
        targetName: candidate.searchTerm,
        logMatchType: "exact",
        actionType: "set",
        previousBid: "0.00",
        newBid: candidate.suggestedBid.toFixed(2),
        bidChangePercent: "100.00",
        reason: `[搜索词收割] ${candidate.reason} | 源=${sourceCampaignType} Campaign=${candidate.sourceAmazonCampaignId} → 目标Campaign=${candidate.targetAmazonCampaignId} | amazonKeywordId=${amazonKeywordId}`,
        algorithmVersion: "2.0.0-harvest-v620-fix14",
        isIntradayAdjustment: 0
      });
      try {
        const syncDetail = JSON.stringify({
          syncedBy: "searchTermHarvester-v620-fix14",
          amazonKeywordId,
          amazonCampaignId: candidate.targetAmazonCampaignId,
          amazonAdGroupId: candidate.targetAmazonAdGroupId,
          sourceCampaignType,
          syncedAt: new Date().toISOString(),
          syncMethod: "direct_api_call"
        });
        await insertOptimizationEvent({
          accountId,
          eventCategory: "search_term_action",
          actionType: "search_term_harvest",
          campaignId: candidate.targetCampaignId,
          keywordId: localKeywordId,
          keywordText: candidate.searchTerm,
          matchType: "exact",
          previousBid: "0.00",
          newBid: candidate.suggestedBid.toFixed(2),
          changeReason: `[搜索词收割] ${candidate.reason} | source=${sourceCampaignType} | amazonKeywordId=${amazonKeywordId}`,
          status: "success",
          apiSyncStatus: "synced",
          apiSyncDetail: syncDetail,
          sourceTable: "search_term_harvester"
        });
        const negSyncDetail = JSON.stringify({
          syncedBy: "searchTermHarvester-v620-fix14",
          amazonNegKeywordId: result.createdNegativeKeywordId || null,
          amazonCampaignId: candidate.sourceAmazonCampaignId,
          sourceCampaignType,
          syncedAt: new Date().toISOString(),
          syncMethod: "direct_api_call"
        });
        await insertOptimizationEvent({
          accountId,
          eventCategory: "search_term_action",
          actionType: "negative_keyword_add",
          campaignId: candidate.sourceCampaignId,
          keywordText: candidate.searchTerm,
          matchType: "exact",
          changeReason: `[搜索词收割-否定] source=${sourceCampaignType} | amazonNegKeywordId=${result.createdNegativeKeywordId || "N/A"}`,
          status: "success",
          apiSyncStatus: "synced",
          apiSyncDetail: negSyncDetail,
          sourceTable: "search_term_harvester"
        });
      } catch (eventErr) {
        log34.warn(`v620-fix14: 记录optimization_events失败: ${eventErr.message}`);
      }
    }
    result.stage = "db_logged";
    result.success = true;
    log34.info(`Step3 完成: 本地数据库已更新`);
  } catch (error48) {
    log34.warn(`Step3 本地DB记录失败: ${error48.message}，API操作已生效`);
    result.error = `Step3 本地DB失败(API已生效): ${error48.message}`;
    result.success = true;
    result.stage = "negative_added";
  }
  return result;
}
async function batchHarvestSearchTerms(accountId, config2 = {}) {
  const cfg = { ...DEFAULT_HARVEST_CONFIG, ...config2 };
  const candidates = await identifyHarvestCandidates(accountId, cfg);
  if (candidates.length === 0) {
    return {
      candidates: [],
      results: [],
      summary: { total: 0, success: 0, failed: 0, rolledBack: 0, skipped: 0 }
    };
  }
  if (cfg.dryRun) {
    log34.info(`Dry Run: \u53D1\u73B0 ${candidates.length} \u4E2A\u5019\u9009\u9879\uFF0C\u4E0D\u6267\u884C`);
    return {
      candidates,
      results: [],
      summary: { total: candidates.length, success: 0, failed: 0, rolledBack: 0, skipped: candidates.length }
    };
  }
  const credentials = await getAmazonApiCredentials(accountId);
  if (!credentials) {
    log34.warn(`\u8D26\u53F7 ${accountId} \u65E0API\u51ED\u8BC1\uFF0C\u65E0\u6CD5\u6267\u884C\u6536\u5272`);
    return {
      candidates,
      results: [],
      summary: { total: candidates.length, success: 0, failed: candidates.length, rolledBack: 0, skipped: 0 }
    };
  }
  const apiClient = createAmazonAdsClient({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken: typeof credentials.refreshToken === "string" ? credentials.refreshToken : "",
    profileId: credentials.profileId,
    region: credentials.region
  });
  const results = [];
  let success2 = 0, failed = 0, rolledBack = 0;
  for (const candidate of candidates) {
    try {
      const result = await harvestSearchTermAtomic(candidate, apiClient, accountId);
      results.push(result);
      if (result.success) {
        success2++;
      } else if (result.stage === "rolled_back") {
        rolledBack++;
      } else {
        failed++;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error48) {
      log34.warn(`\u6536\u5272\u5F02\u5E38: "${candidate.searchTerm}" - ${error48.message}`);
      results.push({
        searchTerm: candidate.searchTerm,
        success: false,
        stage: "failed",
        error: error48.message
      });
      failed++;
    }
  }
  log34.warn(`\u6279\u91CF\u6536\u5272\u5B8C\u6210: \u6210\u529F=${success2}, \u5931\u8D25=${failed}, \u56DE\u6EDA=${rolledBack}`);
  return {
    candidates,
    results,
    summary: {
      total: candidates.length,
      success: success2,
      failed,
      rolledBack,
      skipped: 0
    }
  };
}
async function findTargetAdGroup(searchTerm, manualCampaigns, sourceCampaign) {
  const nonPTCampaigns = manualCampaigns.filter(
    (c) => (
      // @ts-expect-error - runtime type mismatch
      !isProductTargetingCampaign(c.campaignName || "")
    )
  );
  const exactCampaigns = nonPTCampaigns.filter(
    (c) => (
      // @ts-expect-error - runtime type mismatch
      c.campaignName?.toLowerCase().includes("exact") || // @ts-expect-error - runtime type mismatch
      c.campaignName?.includes("\u7CBE\u786E")
    )
  );
  for (const campaign of exactCampaigns) {
    const adGroupsList = await getAdGroupsByCampaignId(campaign.campaignId);
    const enabledAdGroups = adGroupsList.filter((ag) => ag.adGroupStatus === "enabled");
    for (const ag of enabledAdGroups) {
      const hasPT = await adGroupHasProductTargets(ag.id);
      if (hasPT) {
        log34.info(`v194: \u8DF3\u8FC7product target\u5E7F\u544A\u7EC4 id=${ag.id}`);
        continue;
      }
      return {
        adGroupId: ag.id,
        // @ts-ignore
        campaignId: campaign.campaignId,
        amazonAdGroupId: ag.adGroupId,
        // @ts-ignore
        amazonCampaignId: campaign.campaignId
      };
    }
  }
  for (const campaign of nonPTCampaigns) {
    const adGroupsList = await getAdGroupsByCampaignId(campaign.campaignId);
    const enabledAdGroups = adGroupsList.filter((ag) => ag.adGroupStatus === "enabled");
    for (const ag of enabledAdGroups) {
      const hasPT = await adGroupHasProductTargets(ag.id);
      if (hasPT) continue;
      return {
        adGroupId: ag.id,
        // @ts-ignore
        campaignId: campaign.campaignId,
        amazonAdGroupId: ag.adGroupId,
        // @ts-ignore
        amazonCampaignId: campaign.campaignId
      };
    }
  }
  return null;
}
// v620-fix14: 查找PT目标广告组 - 用于ASIN搜索词收割到product target
async function findTargetPTAdGroup(asinSearchTerm, allCampaigns) {
  // 优先查找PT类型的SP manual campaigns
  const ptCampaigns = allCampaigns.filter(
    (c) => c.campaignStatus === "enabled" && 
           c.campaignType === "sp_manual" && 
           isProductTargetingCampaign(c.campaignName || "")
  );
  for (const campaign of ptCampaigns) {
    const adGroupsList = await getAdGroupsByCampaignId(campaign.campaignId);
    const enabledAdGroups = adGroupsList.filter((ag) => ag.adGroupStatus === "enabled");
    for (const ag of enabledAdGroups) {
      const hasPT = await adGroupHasProductTargets(ag.id);
      if (hasPT) {
        return {
          adGroupId: ag.id,
          campaignId: campaign.campaignId,
          amazonAdGroupId: ag.adGroupId,
          amazonCampaignId: campaign.campaignId
        };
      }
    }
  }
  // 回退：查找任何SP manual campaign中有PT的广告组
  const manualCampaigns = allCampaigns.filter(
    (c) => c.campaignStatus === "enabled" && c.campaignType === "sp_manual"
  );
  for (const campaign of manualCampaigns) {
    const adGroupsList = await getAdGroupsByCampaignId(campaign.campaignId);
    const enabledAdGroups = adGroupsList.filter((ag) => ag.adGroupStatus === "enabled");
    for (const ag of enabledAdGroups) {
      const hasPT = await adGroupHasProductTargets(ag.id);
      if (hasPT) {
        return {
          adGroupId: ag.id,
          campaignId: campaign.campaignId,
          amazonAdGroupId: ag.adGroupId,
          amazonCampaignId: campaign.campaignId
        };
      }
    }
  }
  return null;
}
function calculateHarvestBid(performance, config2) {
  const { clicks, orders, spend, sales } = performance;
  if (config2.bidStrategy === "cvr_aov_based" && orders > 0) {
    const cvr = orders / clicks;
    const aov = sales / orders;
    const targetAcosRate = 0.3;
    const theoreticalBid = cvr * aov * targetAcosRate * config2.bidDiscountFactor;
    return Math.round(Math.max(0.1, Math.min(theoreticalBid, 5)) * 100) / 100;
  }
  if (clicks > 0) {
    const historicalCpc = spend / clicks;
    const bid = historicalCpc * config2.bidDiscountFactor;
    return Math.round(Math.max(0.1, Math.min(bid, 5)) * 100) / 100;
  }
  return 0.5;
}
async function rollbackKeywordCreation(apiClient, keywordId) {
  try {
    await apiClient.updateKeywordBids([{
      keywordId: String(keywordId),
      // v356: 统一使用String类型传递Amazon ID
      bid: 0.02
      // 设置最低出价
    }]);
    log34.info(`\u56DE\u6EDA\u6210\u529F: \u5173\u952E\u8BCD ${keywordId} \u5DF2\u8BBE\u7F6E\u6700\u4F4E\u51FA\u4EF7`);
  } catch (error48) {
    log34.warn(`\u56DE\u6EDA\u5931\u8D25: \u5173\u952E\u8BCD ${keywordId} - ${error48.message}`);
  }
}
var log34, DEFAULT_HARVEST_CONFIG;
var init_searchTermHarvester = __esm({
  "server/automation/searchTermHarvester.ts"() {
    "use strict";
    init_db2();
    init_amazonAdsApi();
    init_keywordValidator();
    init_logger();
    log34 = createModuleLogger("SearchTermHarvester");
    DEFAULT_HARVEST_CONFIG = {
      minOrders: 2,
      maxAcos: 50,
      minClicks: 10,
      minRoas: 2,
      bidStrategy: "cvr_aov_based",
      bidDiscountFactor: 0.85,
      // 精确匹配出价为宽泛/短语的85%
      dryRun: false
    };
    __name(identifyHarvestCandidates, "identifyHarvestCandidates");
    __name(harvestSearchTermAtomic, "harvestSearchTermAtomic");
    __name(batchHarvestSearchTerms, "batchHarvestSearchTerms");
    __name(findTargetAdGroup, "findTargetAdGroup");
    __name(findTargetPTAdGroup, "findTargetPTAdGroup");
    __name(calculateHarvestBid, "calculateHarvestBid");
    __name(rollbackKeywordCreation, "rollbackKeywordCreation");
  }
});

