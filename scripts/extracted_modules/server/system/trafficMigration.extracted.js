// Extracted from production dist/index.js
// Original module: server/system/trafficMigration.ts
// Lines: 292

async function analyzeSearchTermPerformance(accountId, campaignIds, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split("T")[0];
  let query = `
    SELECT 
      st.search_term,
      st.campaign_id,
      c.campaign_name,
      st.internal_ad_group_id,
      st.search_term_match_type as match_type,
      SUM(st.search_term_impressions) as impressions,
      SUM(st.search_term_clicks) as clicks,
      SUM(st.search_term_spend) as spend,
      SUM(st.search_term_sales) as sales,
      SUM(st.search_term_orders) as orders
    FROM search_terms st
    JOIN campaigns c ON st.campaign_id = c.id
    WHERE st.account_id = ?
    AND st.report_start_date >= ?
  `;
  const params = [accountId, startDateStr];
  if (campaignIds && campaignIds.length > 0) {
    query += ` AND st.campaign_id IN (${campaignIds.map(() => "?").join(",")})`;
    params.push(...campaignIds);
  }
  query += ` GROUP BY st.search_term, st.campaign_id, c.campaign_name, st.internal_ad_group_id, st.search_term_match_type`;
  const result = await db.execute(sql.raw(query));
  const rows = result[0] || [];
  return rows.map((t2) => {
    const impressions = Number(t2.impressions) || 0;
    const clicks = Number(t2.clicks) || 0;
    const spend = Number(t2.spend) || 0;
    const sales = Number(t2.sales) || 0;
    const orders = Number(t2.orders) || 0;
    const ctr = impressions > 0 ? clicks / impressions * 100 : 0;
    const cvr = clicks > 0 ? orders / clicks * 100 : 0;
    const acos = sales > 0 ? spend / sales * 100 : Infinity;
    const roas = spend > 0 ? sales / spend : 0;
    return {
      searchTerm: t2.search_term,
      campaignId: t2.campaign_id,
      campaignName: t2.campaign_name,
      adGroupId: t2.internal_ad_group_id,
      matchType: t2.match_type || "unknown",
      impressions,
      clicks,
      spend,
      sales,
      orders,
      ctr,
      cvr,
      acos,
      roas
    };
  });
}
async function generateMigrationSuggestions(accountId, campaignIds, days = 30, targetRoas = 3) {
  const termPerformance = await analyzeSearchTermPerformance(accountId, campaignIds, days);
  const suggestions = [];
  const triggers = MIGRATION_CONFIG.MIGRATION_TRIGGERS;
  for (const term of termPerformance) {
    if (term.matchType === "exact") continue;
    const meetsClickThreshold = term.clicks >= triggers.MIN_CLICKS;
    const meetsOrderThreshold = term.orders >= triggers.MIN_ORDERS;
    const meetsCvrThreshold = term.cvr >= triggers.MIN_CVR;
    const meetsAcosThreshold = term.acos <= triggers.MAX_ACOS;
    const meetsRoasThreshold = term.roas >= targetRoas;
    if (meetsClickThreshold && meetsOrderThreshold && meetsCvrThreshold && meetsRoasThreshold) {
      const targetTier = term.matchType === "broad" ? "phrase" : "exact";
      suggestions.push({
        searchTerm: term.searchTerm,
        sourceCampaign: {
          id: term.campaignId,
          name: term.campaignName,
          matchType: term.matchType
        },
        targetTier,
        performance: {
          clicks: term.clicks,
          orders: term.orders,
          cvr: term.cvr,
          acos: term.acos,
          roas: term.roas
        },
        reason: `\u9AD8\u8868\u73B0\u8BCD (ROAS ${term.roas.toFixed(2)}, CVR ${term.cvr.toFixed(1)}%)`,
        priority: "high",
        action: targetTier === "exact" ? "migrate_to_exact" : "migrate_to_phrase"
      });
    } else if (meetsClickThreshold && meetsOrderThreshold && (meetsCvrThreshold || meetsRoasThreshold)) {
      const targetTier = term.matchType === "broad" ? "phrase" : "exact";
      suggestions.push({
        searchTerm: term.searchTerm,
        sourceCampaign: {
          id: term.campaignId,
          name: term.campaignName,
          matchType: term.matchType
        },
        targetTier,
        performance: {
          clicks: term.clicks,
          orders: term.orders,
          cvr: term.cvr,
          acos: term.acos,
          roas: term.roas
        },
        reason: `\u6F5C\u529B\u8BCD (${term.orders}\u8BA2\u5355, CVR ${term.cvr.toFixed(1)}%)`,
        priority: "medium",
        action: targetTier === "exact" ? "migrate_to_exact" : "migrate_to_phrase"
      });
    }
  }
  suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.performance.roas - a.performance.roas;
  });
  return suggestions;
}
async function detectTrafficConflicts3(accountId, campaignIds, days = 30) {
  const termPerformance = await analyzeSearchTermPerformance(accountId, campaignIds, days);
  const termGroups = /* @__PURE__ */ new Map();
  for (const term of termPerformance) {
    const existing = termGroups.get(term.searchTerm) || [];
    existing.push(term);
    termGroups.set(term.searchTerm, existing);
  }
  const conflicts = [];
  for (const [searchTerm, terms] of Array.from(termGroups.entries())) {
    const uniqueCampaigns = /* @__PURE__ */ new Map();
    for (const term of terms) {
      const existing = uniqueCampaigns.get(term.campaignId);
      if (!existing || term.clicks > existing.clicks) {
        uniqueCampaigns.set(term.campaignId, term);
      }
    }
    if (uniqueCampaigns.size <= 1) continue;
    const campaignList = Array.from(uniqueCampaigns.values()).map((t2) => ({
      campaignId: t2.campaignId,
      campaignName: t2.campaignName,
      matchType: t2.matchType,
      clicks: t2.clicks,
      orders: t2.orders,
      cvr: t2.cvr,
      acos: t2.acos,
      roas: t2.roas
      // @ts-ignore
    }));
    const sortedByRoas = [...campaignList].sort((a, b) => b.roas - a.roas);
    const winner = sortedByRoas[0];
    const losers = sortedByRoas.slice(1);
    const totalClicks = campaignList.reduce((sum2, c) => sum2 + c.clicks, 0);
    let severity = "low";
    if (totalClicks >= 50 || campaignList.length >= 3) {
      severity = "high";
    } else if (totalClicks >= 20 || campaignList.length >= 2) {
      severity = "medium";
    }
    conflicts.push({
      // @ts-ignore
      searchTerm,
      campaigns: campaignList,
      winner: {
        // @ts-ignore
        campaignId: winner.campaignId,
        // @ts-ignore
        campaignName: winner.campaignName,
        // @ts-ignore
        reason: `\u6700\u9AD8ROAS (${winner.roas.toFixed(2)})`
      },
      losers: losers.map((l) => ({
        campaignId: l.campaignId,
        campaignName: l.campaignName
      })),
      severity
    });
  }
  conflicts.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
  return conflicts;
}
async function executeTrafficIsolation(accountId, isolations) {
  const db = await getDb();
  if (!db) return { success: false, addedCount: 0, errors: ["Database not available"] };
  const errors = [];
  let addedCount = 0;
  for (const isolation of isolations) {
    try {
      await db.insert(negativeKeywords).values({
        accountId,
        campaignId: isolation.campaignId,
        internalAdGroupId: isolation.adGroupId || null,
        negativeLevel: isolation.adGroupId ? "ad_group" : "campaign",
        negativeType: "keyword",
        negativeText: isolation.searchTerm,
        negativeMatchType: "negative_exact",
        negativeSource: "traffic_conflict",
        negativeStatus: "active"
      });
      addedCount++;
    } catch (error48) {
      if (!error48.message?.includes("Duplicate")) {
        errors.push(`\u6DFB\u52A0\u5426\u5B9A\u8BCD "${isolation.searchTerm}" \u5230Campaign ${isolation.campaignId} \u5931\u8D25: ${error48.message}`);
      }
    }
  }
  return {
    success: errors.length === 0,
    addedCount,
    errors
  };
}
async function getMigrationSummary(accountId, campaignIds, days = 30) {
  const suggestions = await generateMigrationSuggestions(accountId, campaignIds, days);
  const conflicts = await detectTrafficConflicts3(accountId, campaignIds, days);
  const termPerformance = await analyzeSearchTermPerformance(accountId, campaignIds, days);
  const uniqueTerms = new Set(termPerformance.map((t2) => t2.searchTerm));
  const highPriority = suggestions.filter((s) => s.priority === "high").length;
  const mediumPriority = suggestions.filter((s) => s.priority === "medium").length;
  let potentialSavings = 0;
  for (const conflict of conflicts) {
    const loserSpend = conflict.losers.reduce((sum2, l) => {
      const loserData = conflict.campaigns.find((c) => c.campaignId === l.campaignId);
      return sum2 + (loserData?.clicks || 0) * 0.5;
    }, 0);
    potentialSavings += loserSpend;
  }
  return {
    totalSearchTerms: uniqueTerms.size,
    migrationCandidates: suggestions.length,
    highPriority,
    mediumPriority,
    conflictCount: conflicts.length,
    estimatedImpact: {
      potentialSavings,
      potentialRoasImprovement: suggestions.length > 0 ? 0.15 : 0
      // 预估15%ROAS提升
    }
  };
}
var MIGRATION_CONFIG;
var init_trafficMigration = __esm({
  "server/system/trafficMigration.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    MIGRATION_CONFIG = {
      // 迁移触发条件
      MIGRATION_TRIGGERS: {
        MIN_CLICKS: 5,
        // 最小点击数
        MIN_ORDERS: 2,
        // 最小订单数
        MIN_CVR: 5,
        // 最小转化率(%)
        MAX_ACOS: 30,
        // 最大ACoS(%)
        MIN_ROAS: 3
        // 最小ROAS
      },
      // 冲突消解配置
      CONFLICT_RESOLUTION: {
        MIN_PERFORMANCE_DIFF: 20,
        // 最小表现差异(%)
        WINNER_SELECTION: "roas"
        // 胜者选择标准: 'roas' | 'cvr' | 'acos'
      },
      // 层级过滤配置
      TIER_ARCHITECTURE: {
        TIER1: "exact",
        // 第一层：精准匹配
        TIER2: "phrase",
        // 第二层：短语匹配
        TIER3: "broad"
        // 第三层：广泛匹配
      }
    };
    __name(analyzeSearchTermPerformance, "analyzeSearchTermPerformance");
    __name(generateMigrationSuggestions, "generateMigrationSuggestions");
    __name(detectTrafficConflicts3, "detectTrafficConflicts");
    __name(executeTrafficIsolation, "executeTrafficIsolation");
    __name(getMigrationSummary, "getMigrationSummary");
  }
});

