// Extracted from production dist/index.js
// Original module: server/analytics/dashboardRecommendationEngine.ts
// Lines: 596

async function scanEmergencyBleeding(accountId) {
  const db_ = await getDb();
  if (!db_) return { items: [], totalCount: 0, totalWastedSpend: 0 };
  const items = [];
  try {
    const existingNegatives = await db_.select({
      negativeText: negativeKeywords.negativeText,
      campaignId: negativeKeywords.campaignId
    }).from(negativeKeywords).where(and(
      eq(negativeKeywords.accountId, accountId),
      eq(negativeKeywords.negativeType, "keyword"),
      sql`${negativeKeywords.negativeStatus} != 'removed'`
    ));
    const negatedSearchTermSet = new Set(
      existingNegatives.map((n) => `${n.campaignId}||${(n.negativeText || "").toLowerCase()}`)
      // v529: 修复negativeText空值Bug，防止null.toLowerCase()运行时错误
    );
    log197.info(`[\u7D27\u6025\u6B62\u8840\u626B\u63CF] \u5DF2\u6709 ${negatedSearchTermSet.size} \u4E2A\u5426\u5B9A\u5173\u952E\u8BCD\uFF0C\u5C06\u6392\u9664\u5DF2\u5904\u7406\u9879`);
    const existingBidTasks = await db_.execute(
      sql`SELECT target_entity_id FROM optimization_tasks 
          WHERE account_id = ${accountId} 
          AND task_type = 'bid_adjustment' 
          AND target_entity_type = 'product_target'
          AND action = 'adjust_bid'
          AND algorithm_used = 'dashboard_emergency_bleeding'
          AND status IN ('pending', 'processing', 'synced')`
    );
    const bidTaskRows = existingBidTasks[0] || [];
    const processedPtIds = new Set(
      bidTaskRows.map((r) => r.target_entity_id)
    );
    log197.info(`[\u7D27\u6025\u6B62\u8840\u626B\u63CF] \u5DF2\u6709 ${processedPtIds.size} \u4E2A\u5546\u54C1\u6295\u653E\u7ADE\u4EF7\u8C03\u6574\u4EFB\u52A1\uFF0C\u5C06\u6392\u9664\u5DF2\u5904\u7406\u9879`);
    const zeroConvSearchTerms = await db_.select({
      id: searchTerms.id,
      searchTerm: searchTerms.searchTerm,
      campaignId: searchTerms.campaignId,
      internalAdGroupId: searchTerms.internalAdGroupId,
      spend: searchTerms.searchTermSpend,
      clicks: searchTerms.searchTermClicks,
      impressions: searchTerms.searchTermImpressions,
      orders: searchTerms.searchTermOrders
    }).from(searchTerms).where(and(
      eq(searchTerms.accountId, accountId),
      sql`CAST(${searchTerms.searchTermSpend} AS DECIMAL(10,2)) > 10`,
      sql`${searchTerms.searchTermOrders} = 0`
    )).orderBy(sql`CAST(${searchTerms.searchTermSpend} AS DECIMAL(10,2)) DESC`);
    for (const st of zeroConvSearchTerms) {
      const negKey = `${st.campaignId}||${st.searchTerm.toLowerCase()}`;
      if (negatedSearchTermSet.has(negKey)) {
        continue;
      }
      const campaignInfo = await db_.select({
        id: campaigns.id,
        campaignName: campaigns.campaignName
      }).from(campaigns).where(and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignId, st.campaignId)
      )).limit(1);
      const adGroupInfo = st.internalAdGroupId ? await db_.select({
        adGroupName: adGroups.adGroupName
      }).from(adGroups).where(eq(adGroups.id, st.internalAdGroupId)).limit(1) : [];
      const spend = parseFloat(String(st.spend || "0"));
      items.push({
        id: `st-${st.id}`,
        entityType: "search_term",
        entityId: st.id,
        amazonEntityId: "",
        entityText: st.searchTerm,
        campaignId: st.campaignId,
        campaignName: campaignInfo[0]?.campaignName || "\u672A\u77E5\u5E7F\u544A\u6D3B\u52A8",
        campaignDbId: campaignInfo[0]?.id || 0,
        adGroupId: st.internalAdGroupId || 0,
        adGroupName: adGroupInfo[0]?.adGroupName || "\u672A\u77E5\u5E7F\u544A\u7EC4",
        spend,
        clicks: st.clicks || 0,
        impressions: st.impressions || 0,
        orders: 0,
        currentBid: 0,
        suggestedAction: "add_negative_exact",
        actionLabel: `\u6DFB\u52A0\u7CBE\u51C6\u5426\u5B9A\u300C${st.searchTerm}\u300D`
      });
    }
    const zeroConvTargets = await db_.select({
      id: productTargets.id,
      targetId: productTargets.targetId,
      targetValue: productTargets.targetValue,
      targetType: productTargets.targetType,
      campaignId: productTargets.campaignId,
      internalAdGroupId: productTargets.internalAdGroupId,
      bid: productTargets.bid,
      spend: productTargets.spend,
      clicks: productTargets.clicks,
      impressions: productTargets.impressions,
      orders: productTargets.orders
    }).from(productTargets).where(and(
      eq(productTargets.accountId, accountId),
      eq(productTargets.targetStatus, "enabled"),
      sql`CAST(${productTargets.spend} AS DECIMAL(10,2)) > 10`,
      sql`${productTargets.orders} = 0`
    )).orderBy(sql`CAST(${productTargets.spend} AS DECIMAL(10,2)) DESC`);
    for (const pt of zeroConvTargets) {
      if (processedPtIds.has(pt.id)) {
        continue;
      }
      const campaignInfo = await db_.select({
        id: campaigns.id,
        campaignName: campaigns.campaignName
      }).from(campaigns).where(and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignId, pt.campaignId || "")
      )).limit(1);
      const adGroupInfo = pt.internalAdGroupId ? await db_.select({
        adGroupName: adGroups.adGroupName
      }).from(adGroups).where(eq(adGroups.id, pt.internalAdGroupId)).limit(1) : [];
      const spend = parseFloat(String(pt.spend || "0"));
      const currentBid = parseFloat(String(pt.bid || "0"));
      items.push({
        id: `pt-${pt.id}`,
        entityType: "product_target",
        entityId: pt.id,
        amazonEntityId: pt.targetId || "",
        entityText: pt.targetValue,
        campaignId: pt.campaignId || "",
        campaignName: campaignInfo[0]?.campaignName || "\u672A\u77E5\u5E7F\u544A\u6D3B\u52A8",
        campaignDbId: campaignInfo[0]?.id || 0,
        adGroupId: pt.internalAdGroupId || 0,
        adGroupName: adGroupInfo[0]?.adGroupName || "\u672A\u77E5\u5E7F\u544A\u7EC4",
        spend,
        clicks: pt.clicks || 0,
        impressions: pt.impressions || 0,
        orders: 0,
        currentBid,
        suggestedAction: "reduce_bid_90",
        actionLabel: `\u964D\u4F4E\u7ADE\u4EF790%\uFF08$${currentBid.toFixed(2)} \u2192 $${(currentBid * 0.1).toFixed(2)}\uFF09`
      });
    }
    items.sort((a, b) => b.spend - a.spend);
    const totalWasted = items.reduce((sum2, item) => sum2 + item.spend, 0);
    return {
      items,
      totalCount: items.length,
      totalWastedSpend: Math.round(totalWasted * 100) / 100
    };
  } catch (error48) {
    log197.warn(`[\u7D27\u6025\u6B62\u8840\u626B\u63CF] \u5931\u8D25: ${error48.message}`);
    return { items: [], totalCount: 0, totalWastedSpend: 0 };
  }
}
async function scanHighAcos(accountId) {
  const db_ = await getDb();
  if (!db_) return { items: [], totalCount: 0, totalExcessSpend: 0 };
  const items = [];
  try {
    const existingKwBidTasks = await db_.execute(
      sql`SELECT target_entity_id, target_entity_type FROM optimization_tasks 
          WHERE account_id = ${accountId} 
          AND task_type = 'bid_adjustment' 
          AND algorithm_used = 'dashboard_high_acos_suppression'
          AND status IN ('pending', 'processing', 'synced')`
    );
    const processedKwIds = /* @__PURE__ */ new Set();
    const processedPtAcosIds = /* @__PURE__ */ new Set();
    const taskRows = existingKwBidTasks[0] || [];
    for (const r of taskRows) {
      if (r.target_entity_type === "keyword") processedKwIds.add(r.target_entity_id);
      if (r.target_entity_type === "product_target") processedPtAcosIds.add(r.target_entity_id);
    }
    log197.info(`[\u9AD8ACOS\u626B\u63CF] \u5DF2\u6709 ${processedKwIds.size} \u4E2A\u5173\u952E\u8BCD\u548C ${processedPtAcosIds.size} \u4E2A\u5546\u54C1\u6295\u653E\u7ADE\u4EF7\u8C03\u6574\u4EFB\u52A1\uFF0C\u5C06\u6392\u9664\u5DF2\u5904\u7406\u9879`);
    const highAcosKeywords = await db_.select({
      id: keywords.id,
      keywordId: keywords.keywordId,
      keywordText: keywords.keywordText,
      matchType: keywords.matchType,
      campaignId: keywords.campaignId,
      internalAdGroupId: keywords.internalAdGroupId,
      bid: keywords.bid,
      spend: keywords.spend,
      sales: keywords.sales,
      orders: keywords.orders,
      keywordAcos: keywords.keywordAcos
    }).from(keywords).where(and(
      eq(keywords.accountId, accountId),
      eq(keywords.keywordStatus, "enabled"),
      sql`CAST(${keywords.spend} AS DECIMAL(10,2)) > 5`,
      sql`CAST(${keywords.sales} AS DECIMAL(10,2)) > 0`,
      sql`CAST(${keywords.keywordAcos} AS DECIMAL(5,2)) > 100`
    )).orderBy(sql`CAST(${keywords.keywordAcos} AS DECIMAL(5,2)) DESC`);
    for (const kw of highAcosKeywords) {
      if (processedKwIds.has(kw.id)) {
        continue;
      }
      const campaignInfo = await db_.select({
        id: campaigns.id,
        campaignName: campaigns.campaignName
      }).from(campaigns).where(and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignId, kw.campaignId || "")
      )).limit(1);
      const adGroupInfo = kw.internalAdGroupId ? await db_.select({
        adGroupName: adGroups.adGroupName
      }).from(adGroups).where(eq(adGroups.id, kw.internalAdGroupId)).limit(1) : [];
      const spend = parseFloat(String(kw.spend || "0"));
      const sales = parseFloat(String(kw.sales || "0"));
      const acos = parseFloat(String(kw.keywordAcos || "0"));
      const currentBid = parseFloat(String(kw.bid || "0"));
      const suggestedBid = currentBid > 0 && acos > 0 ? Math.max(0.1, currentBid * (30 / acos)) : 0.1;
      const reductionPercent = currentBid > 0 ? Math.min(99, Math.max(0, Math.round((1 - suggestedBid / currentBid) * 100))) : 100;
      items.push({
        id: `kw-${kw.id}`,
        entityType: "keyword",
        entityId: kw.id,
        amazonEntityId: kw.keywordId || "",
        entityText: kw.keywordText,
        matchType: kw.matchType,
        campaignId: kw.campaignId || "",
        campaignName: campaignInfo[0]?.campaignName || "\u672A\u77E5\u5E7F\u544A\u6D3B\u52A8",
        campaignDbId: campaignInfo[0]?.id || 0,
        adGroupId: kw.internalAdGroupId || 0,
        adGroupName: adGroupInfo[0]?.adGroupName || "\u672A\u77E5\u5E7F\u544A\u7EC4",
        spend,
        sales,
        orders: kw.orders || 0,
        acos,
        currentBid,
        suggestedBid: Math.round(suggestedBid * 100) / 100,
        reductionPercent,
        suggestedAction: "reduce_bid",
        actionLabel: `\u964D\u4F4E\u7ADE\u4EF7${reductionPercent}%\uFF08$${currentBid.toFixed(2)} \u2192 $${suggestedBid.toFixed(2)}\uFF09`
      });
    }
    const highAcosTargets = await db_.select({
      id: productTargets.id,
      targetId: productTargets.targetId,
      targetValue: productTargets.targetValue,
      targetType: productTargets.targetType,
      campaignId: productTargets.campaignId,
      internalAdGroupId: productTargets.internalAdGroupId,
      bid: productTargets.bid,
      spend: productTargets.spend,
      sales: productTargets.sales,
      orders: productTargets.orders,
      targetAcos: productTargets.targetAcos
    }).from(productTargets).where(and(
      eq(productTargets.accountId, accountId),
      eq(productTargets.targetStatus, "enabled"),
      sql`CAST(${productTargets.spend} AS DECIMAL(10,2)) > 5`,
      sql`CAST(${productTargets.sales} AS DECIMAL(10,2)) > 0`,
      sql`CAST(${productTargets.targetAcos} AS DECIMAL(5,2)) > 100`
    )).orderBy(sql`CAST(${productTargets.targetAcos} AS DECIMAL(5,2)) DESC`);
    for (const pt of highAcosTargets) {
      if (processedPtAcosIds.has(pt.id)) {
        continue;
      }
      const campaignInfo = await db_.select({
        id: campaigns.id,
        campaignName: campaigns.campaignName
      }).from(campaigns).where(and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignId, pt.campaignId || "")
      )).limit(1);
      const adGroupInfo = pt.internalAdGroupId ? await db_.select({
        adGroupName: adGroups.adGroupName
      }).from(adGroups).where(eq(adGroups.id, pt.internalAdGroupId)).limit(1) : [];
      const spend = parseFloat(String(pt.spend || "0"));
      const sales = parseFloat(String(pt.sales || "0"));
      const acos = parseFloat(String(pt.targetAcos || "0"));
      const currentBid = parseFloat(String(pt.bid || "0"));
      const suggestedBid = currentBid > 0 && acos > 0 ? Math.max(0.1, currentBid * (30 / acos)) : 0.1;
      const reductionPercent = currentBid > 0 ? Math.min(99, Math.max(0, Math.round((1 - suggestedBid / currentBid) * 100))) : 100;
      items.push({
        id: `pt-${pt.id}`,
        entityType: "product_target",
        entityId: pt.id,
        amazonEntityId: pt.targetId || "",
        entityText: pt.targetValue,
        matchType: pt.targetType,
        campaignId: pt.campaignId || "",
        campaignName: campaignInfo[0]?.campaignName || "\u672A\u77E5\u5E7F\u544A\u6D3B\u52A8",
        campaignDbId: campaignInfo[0]?.id || 0,
        adGroupId: pt.internalAdGroupId || 0,
        adGroupName: adGroupInfo[0]?.adGroupName || "\u672A\u77E5\u5E7F\u544A\u7EC4",
        spend,
        sales,
        orders: pt.orders || 0,
        acos,
        currentBid,
        suggestedBid: Math.round(suggestedBid * 100) / 100,
        reductionPercent,
        suggestedAction: "reduce_bid",
        actionLabel: `\u964D\u4F4E\u7ADE\u4EF7${reductionPercent}%\uFF08$${currentBid.toFixed(2)} \u2192 $${suggestedBid.toFixed(2)}\uFF09`
      });
    }
    items.sort((a, b) => b.acos - a.acos);
    const totalExcess = items.reduce((sum2, item) => sum2 + Math.max(0, item.spend - item.sales * 0.3), 0);
    return {
      items,
      totalCount: items.length,
      totalExcessSpend: Math.round(totalExcess * 100) / 100
    };
  } catch (error48) {
    log197.warn(`[\u9AD8ACOS\u626B\u63CF] \u5931\u8D25: ${error48.message}`);
    return { items: [], totalCount: 0, totalExcessSpend: 0 };
  }
}
async function scanGoalAdjustment(accountId) {
  const db_ = await getDb();
  if (!db_) return { items: [], totalCount: 0, totalUnmanagedSpend: 0 };
  try {
    const unmanagedCampaigns = await db_.select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      campaignType: campaigns.campaignType,
      performanceGroupId: campaigns.performanceGroupId
    }).from(campaigns).where(and(
      eq(campaigns.accountId, accountId),
      eq(campaigns.campaignStatus, "enabled"),
      isNull(campaigns.performanceGroupId)
    ));
    if (unmanagedCampaigns.length === 0) {
      return { items: [], totalCount: 0, totalUnmanagedSpend: 0 };
    }
    const now = /* @__PURE__ */ new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    const fmt = /* @__PURE__ */ __name((d) => d.toISOString().split("T")[0], "fmt");
    const items = unmanagedCampaigns.map((c) => {
      return {
        id: `camp-${c.id}`,
        campaignDbId: c.id,
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        campaignType: c.campaignType,
        recent7dSpend: 0,
        recent7dSales: 0,
        recent7dAcos: 0,
        recent7dOrders: 0,
        suggestedGoalName: "\u5EFA\u8BAE\u521B\u5EFA\u65B0\u4F18\u5316\u76EE\u6807"
      };
    });
    items.sort((a, b) => b.recent7dSpend - a.recent7dSpend);
    const totalUnmanagedSpend = items.reduce((sum2, item) => sum2 + item.recent7dSpend, 0);
    return {
      items,
      // v501.1: 返回所有项目
      totalCount: items.length,
      totalUnmanagedSpend: Math.round(totalUnmanagedSpend * 100) / 100
    };
  } catch (error48) {
    log197.warn(`[\u4F18\u5316\u76EE\u6807\u8C03\u6574\u626B\u63CF] \u5931\u8D25: ${error48.message}`);
    return { items: [], totalCount: 0, totalUnmanagedSpend: 0 };
  }
}
async function scanDashboardRecommendations(accountId) {
  log197.info(`[\u6570\u636E\u6982\u89C8\u5EFA\u8BAE] \u5F00\u59CB\u626B\u63CF\u8D26\u53F7 #${accountId}`);
  const [emergencyBleeding, highAcosSuppression, goalAdjustment] = await Promise.all([
    scanEmergencyBleeding(accountId),
    scanHighAcos(accountId),
    scanGoalAdjustment(accountId)
  ]);
  log197.info(`[\u6570\u636E\u6982\u89C8\u5EFA\u8BAE] \u626B\u63CF\u5B8C\u6210 - \u7D27\u6025\u6B62\u8840:${emergencyBleeding.totalCount}\u9879, \u9AD8ACOS:${highAcosSuppression.totalCount}\u9879, \u76EE\u6807\u8C03\u6574:${goalAdjustment.totalCount}\u9879`);
  return {
    accountId,
    scanTime: (/* @__PURE__ */ new Date()).toISOString(),
    emergencyBleeding,
    highAcosSuppression,
    goalAdjustment
  };
}
async function executeEmergencyBleeding(accountId, itemIds, allItems) {
  const db_ = await getDb();
  if (!db_) throw new Error("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
  const selectedItems = allItems.filter((item) => itemIds.includes(item.id));
  let successCount = 0;
  let failCount = 0;
  const details = [];
  const syncTasks = [];
  const { randomUUID: randomUUID6 } = await import("crypto");
  const batchId = randomUUID6();
  for (const item of selectedItems) {
    try {
      if (item.entityType === "search_term" && item.suggestedAction === "add_negative_exact") {
        await db_.insert(negativeKeywords).values({
          accountId,
          campaignId: item.campaignId,
          internalAdGroupId: item.adGroupId,
          negativeLevel: "campaign",
          negativeType: "keyword",
          negativeText: item.entityText,
          negativeMatchType: "negative_exact",
          negativeSource: "auto_optimization",
          sourceReason: "\u7D27\u6025\u6B62\u8840-\u96F6\u8F6C\u5316\u9AD8\u82B1\u8D39\u641C\u7D22\u8BCD",
          negativeStatus: "active"
        });
        log197.info(`[\u7D27\u6025\u6B62\u8840] \u5DF2\u63D2\u5165\u5426\u5B9A\u5173\u952E\u8BCD: campaignId=${item.campaignId}, text=${item.entityText}`);
        syncTasks.push({
          batchId,
          optimizationTargetId: 0,
          // 0 = 系统自动优化（非绩效组触发）
          accountId,
          taskType: "negative_keyword",
          targetEntityType: "campaign",
          // 否定关键词添加到campaign级别
          targetEntityId: item.campaignDbId,
          // 使用campaign的数据库内部ID
          amazonEntityId: item.campaignId,
          // Amazon campaignId
          targetEntityName: item.entityText,
          action: "create_negative_exact",
          newValue: item.entityText,
          changeReason: "\u7D27\u6025\u6B62\u8840-\u96F6\u8F6C\u5316\u9AD8\u82B1\u8D39\u641C\u7D22\u8BCD",
          algorithmUsed: "dashboard_emergency_bleeding",
          priority: 0,
          // P0最高优先级
          campaignId: item.campaignDbId,
          campaignName: item.campaignName,
          adGroupId: item.adGroupId
        });
        details.push(`\u2705 \u5DF2\u6DFB\u52A0\u5426\u5B9A\u8BCD\u300C${item.entityText}\u300D(\u82B1\u8D39$${item.spend.toFixed(2)})`);
        successCount++;
      } else if (item.entityType === "product_target" && item.suggestedAction === "reduce_bid_90") {
        const newBid = Math.max(0.02, item.currentBid * 0.1);
        await db_.update(productTargets).set({ bid: String(newBid) }).where(eq(productTargets.id, item.entityId));
        syncTasks.push({
          batchId,
          optimizationTargetId: 0,
          // 0 = 系统自动优化
          accountId,
          taskType: "bid_adjustment",
          // v501.1: 修正为bid_adjustment（同步引擎通过target_entity_type区分）
          targetEntityType: "product_target",
          targetEntityId: item.entityId,
          amazonEntityId: item.amazonEntityId,
          targetEntityName: item.entityText,
          action: "adjust_bid",
          oldValue: String(item.currentBid),
          newValue: String(Math.round(newBid * 100) / 100),
          changeReason: "\u7D27\u6025\u6B62\u8840-\u96F6\u8F6C\u5316\u5546\u54C1\u6295\u653E\u964D\u4EF790%",
          algorithmUsed: "dashboard_emergency_bleeding",
          priority: 0,
          campaignId: item.campaignDbId,
          campaignName: item.campaignName,
          adGroupId: item.adGroupId
        });
        details.push(`\u2705 \u5DF2\u964D\u4F4E\u300C${item.entityText}\u300D\u7ADE\u4EF790%($${item.currentBid.toFixed(2)}\u2192$${newBid.toFixed(2)})`);
        successCount++;
      }
    } catch (error48) {
      failCount++;
      details.push(`\u274C \u5904\u7406\u300C${item.entityText}\u300D\u5931\u8D25: ${error48.message}`);
    }
  }
  if (syncTasks.length > 0) {
    try {
      log197.info(`[\u7D27\u6025\u6B62\u8840] \u51C6\u5907\u5165\u961F ${syncTasks.length} \u4E2A\u540C\u6B65\u4EFB\u52A1, batchId=${batchId}`);
      const { enqueueTasks: enqueueTasks2 } = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
      const resultBatchId = await enqueueTasks2(syncTasks);
      log197.info(`[\u7D27\u6025\u6B62\u8840] \u2705 \u540C\u6B65\u4EFB\u52A1\u5165\u961F\u6210\u529F: batchId=${resultBatchId}, ${syncTasks.length}\u6761\u4EFB\u52A1`);
    } catch (err) {
      log197.error(`[\u7D27\u6025\u6B62\u8840] \u274C \u540C\u6B65\u4EFB\u52A1\u5165\u961F\u5931\u8D25: ${err.message}`, err);
    }
  }
  log197.info(`[\u7D27\u6025\u6B62\u8840] \u6267\u884C\u5B8C\u6210: \u6210\u529F=${successCount}, \u5931\u8D25=${failCount}`);
  return { successCount, failCount, details };
}
async function executeHighAcosSuppression(accountId, itemIds, allItems) {
  const db_ = await getDb();
  if (!db_) throw new Error("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
  const selectedItems = allItems.filter((item) => itemIds.includes(item.id));
  let successCount = 0;
  let failCount = 0;
  const details = [];
  const syncTasks = [];
  const { randomUUID: randomUUID6 } = await import("crypto");
  const batchId = randomUUID6();
  for (const item of selectedItems) {
    try {
      if (item.entityType === "keyword") {
        await db_.update(keywords).set({ bid: String(item.suggestedBid) }).where(eq(keywords.id, item.entityId));
        syncTasks.push({
          batchId,
          optimizationTargetId: 0,
          // 0 = 系统自动优化
          accountId,
          taskType: "bid_adjustment",
          targetEntityType: "keyword",
          targetEntityId: item.entityId,
          amazonEntityId: item.amazonEntityId,
          targetEntityName: item.entityText,
          action: "adjust_bid",
          oldValue: String(item.currentBid),
          newValue: String(item.suggestedBid),
          changeReason: `\u9AD8ACOS\u6291\u5236-ACoS ${item.acos.toFixed(0)}%\u964D\u4EF7${item.reductionPercent}%`,
          algorithmUsed: "dashboard_high_acos_suppression",
          priority: 1,
          // P1高优先级
          campaignId: item.campaignDbId,
          campaignName: item.campaignName,
          adGroupId: item.adGroupId
        });
        details.push(`\u2705 \u300C${item.entityText}\u300D\u7ADE\u4EF7\u964D${item.reductionPercent}%($${item.currentBid.toFixed(2)}\u2192$${item.suggestedBid.toFixed(2)}, ACoS:${item.acos.toFixed(0)}%)`);
        successCount++;
      } else if (item.entityType === "product_target") {
        await db_.update(productTargets).set({ bid: String(item.suggestedBid) }).where(eq(productTargets.id, item.entityId));
        syncTasks.push({
          batchId,
          optimizationTargetId: 0,
          // 0 = 系统自动优化
          accountId,
          taskType: "bid_adjustment",
          // v501.1: 修正为bid_adjustment（同步引擎通过target_entity_type区分）
          targetEntityType: "product_target",
          targetEntityId: item.entityId,
          amazonEntityId: item.amazonEntityId,
          targetEntityName: item.entityText,
          action: "adjust_bid",
          oldValue: String(item.currentBid),
          newValue: String(item.suggestedBid),
          changeReason: `\u9AD8ACOS\u6291\u5236-ACoS ${item.acos.toFixed(0)}%\u964D\u4EF7${item.reductionPercent}%`,
          algorithmUsed: "dashboard_high_acos_suppression",
          priority: 1,
          campaignId: item.campaignDbId,
          campaignName: item.campaignName,
          adGroupId: item.adGroupId
        });
        details.push(`\u2705 \u300C${item.entityText}\u300D\u7ADE\u4EF7\u964D${item.reductionPercent}%($${item.currentBid.toFixed(2)}\u2192$${item.suggestedBid.toFixed(2)}, ACoS:${item.acos.toFixed(0)}%)`);
        successCount++;
      }
    } catch (error48) {
      failCount++;
      details.push(`\u274C \u5904\u7406\u300C${item.entityText}\u300D\u5931\u8D25: ${error48.message}`);
    }
  }
  if (syncTasks.length > 0) {
    try {
      log197.info(`[\u9AD8ACOS\u6291\u5236] \u51C6\u5907\u5165\u961F ${syncTasks.length} \u4E2A\u540C\u6B65\u4EFB\u52A1, batchId=${batchId}`);
      const { enqueueTasks: enqueueTasks2 } = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
      const resultBatchId = await enqueueTasks2(syncTasks);
      log197.info(`[\u9AD8ACOS\u6291\u5236] \u2705 \u540C\u6B65\u4EFB\u52A1\u5165\u961F\u6210\u529F: batchId=${resultBatchId}, ${syncTasks.length}\u6761\u4EFB\u52A1`);
    } catch (err) {
      log197.error(`[\u9AD8ACOS\u6291\u5236] \u274C \u540C\u6B65\u4EFB\u52A1\u5165\u961F\u5931\u8D25: ${err.message}`, err);
    }
  }
  log197.info(`[\u9AD8ACOS\u6291\u5236] \u6267\u884C\u5B8C\u6210: \u6210\u529F=${successCount}, \u5931\u8D25=${failCount}`);
  return { successCount, failCount, details };
}
async function executeGoalAdjustment(accountId, campaignDbIds, performanceGroupId2) {
  const db_ = await getDb();
  if (!db_) throw new Error("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
  let successCount = 0;
  let failCount = 0;
  const details = [];
  const pgInfo = await db_.select({
    id: performanceGroups.id,
    name: performanceGroups.name
  }).from(performanceGroups).where(eq(performanceGroups.id, performanceGroupId2)).limit(1);
  if (pgInfo.length === 0) {
    throw new Error(`\u7EE9\u6548\u7EC4 #${performanceGroupId2} \u4E0D\u5B58\u5728`);
  }
  for (const campDbId of campaignDbIds) {
    try {
      await db_.update(campaigns).set({ performanceGroupId: performanceGroupId2 }).where(and(
        eq(campaigns.id, campDbId),
        eq(campaigns.accountId, accountId)
      ));
      const campInfo = await db_.select({ campaignName: campaigns.campaignName }).from(campaigns).where(eq(campaigns.id, campDbId)).limit(1);
      details.push(`\u2705 \u300C${campInfo[0]?.campaignName || `#${campDbId}`}\u300D\u5DF2\u5206\u914D\u5230\u300C${pgInfo[0].name}\u300D`);
      successCount++;
    } catch (error48) {
      failCount++;
      details.push(`\u274C \u5206\u914D\u5E7F\u544A\u6D3B\u52A8 #${campDbId} \u5931\u8D25: ${error48.message}`);
    }
  }
  return { successCount, failCount, details };
}
var log197;
var init_dashboardRecommendationEngine = __esm({
  "server/analytics/dashboardRecommendationEngine.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_logger();
    log197 = createModuleLogger("DashboardRecommendationEngine");
    __name(scanEmergencyBleeding, "scanEmergencyBleeding");
    __name(scanHighAcos, "scanHighAcos");
    __name(scanGoalAdjustment, "scanGoalAdjustment");
    __name(scanDashboardRecommendations, "scanDashboardRecommendations");
    __name(executeEmergencyBleeding, "executeEmergencyBleeding");
    __name(executeHighAcosSuppression, "executeHighAcosSuppression");
    __name(executeGoalAdjustment, "executeGoalAdjustment");
  }
});

