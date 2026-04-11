// Extracted from production dist/index.js
// Original module: server/db/campaigns.ts
// Lines: 619

async function createCampaign(campaign) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(campaigns).values(campaign);
  return result[0].insertId;
}
async function getCampaignsByAccountId(accountId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(campaigns).where(eq(campaigns.accountId, accountId));
}
async function getCampaignsWithPerformance(accountId, startDate, endDate, todayDate) {
  const db = await getDb();
  if (!db) return [];
  const campaignList = await db.select().from(campaigns).where(eq(campaigns.accountId, accountId));
  const perfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`${dailyPerformance.date} >= ${startDate}`,
    sql`${dailyPerformance.date} < DATE_ADD(${endDate}, INTERVAL 1 DAY)`
  )).groupBy(dailyPerformance.campaignId);
  const effectiveTodayDate = todayDate || endDate;
  const todayPerfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    todayImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    todayClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    todaySpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    todaySales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    todayOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`${dailyPerformance.date} >= ${effectiveTodayDate}`,
    sql`${dailyPerformance.date} < DATE_ADD(${effectiveTodayDate}, INTERVAL 1 DAY)`
  )).groupBy(dailyPerformance.campaignId);
  const perfMap = /* @__PURE__ */ new Map();
  for (const p of perfData) {
    if (p.campaignId) {
      perfMap.set(p.campaignId, p);
    }
  }
  const todayPerfMap = /* @__PURE__ */ new Map();
  for (const p of todayPerfData) {
    if (p.campaignId) {
      todayPerfMap.set(p.campaignId, p);
    }
  }
  const accountGroupIds = [...new Set(campaignList.map((c) => c.performanceGroupId).filter(Boolean))];
  let groupMap = /* @__PURE__ */ new Map();
  if (accountGroupIds.length > 0) {
    const relevantGroups = await db.select({
      id: performanceGroups.id,
      name: performanceGroups.name,
      strategyTemplateId: performanceGroups.strategyTemplateId,
      strategyTemplateName: performanceGroups.strategyTemplateName
    }).from(performanceGroups).where(inArray(performanceGroups.id, accountGroupIds));
    for (const g of relevantGroups) {
      groupMap.set(g.id, g);
    }
  }
  return campaignList.map((campaign) => {
    const perf = perfMap.get(campaign.campaignId);
    const impressions = perf?.totalImpressions || 0;
    const clicks = perf?.totalClicks || 0;
    const spend = parseFloat(perf?.totalSpend || "0");
    const sales = parseFloat(perf?.totalSales || "0");
    const orders = perf?.totalOrders || 0;
    const group = campaign.performanceGroupId ? groupMap.get(campaign.performanceGroupId) : null;
    const todayPerf = todayPerfMap.get(campaign.campaignId);
    const dailySpend = parseFloat(todayPerf?.todaySpend || "0");
    const dailySales = parseFloat(todayPerf?.todaySales || "0");
    const dailyImpressions = todayPerf?.todayImpressions || 0;
    const dailyClicks = todayPerf?.todayClicks || 0;
    const dailyOrders = todayPerf?.todayOrders || 0;
    return {
      ...campaign,
      impressions,
      clicks,
      spend: spend.toFixed(2),
      sales: sales.toFixed(2),
      orders,
      acos: sales > 0 ? (spend / sales * 100).toFixed(2) : null,
      roas: spend > 0 ? (sales / spend).toFixed(2) : null,
      ctr: impressions > 0 ? (clicks / impressions * 100).toFixed(4) : null,
      cvr: clicks > 0 ? (orders / clicks * 100).toFixed(4) : null,
      cpc: clicks > 0 ? (spend / clicks).toFixed(2) : null,
      // v122h: 今日数据（站点本地时间）
      dailySpend: dailySpend.toFixed(2),
      dailySales: dailySales.toFixed(2),
      dailyImpressions,
      dailyClicks,
      dailyOrders,
      // 优化目标组信息
      performanceGroupName: group?.name || null,
      performanceGroupStrategyTemplate: group?.strategyTemplateName || null,
      // 策略模板推荐信息（已存储在campaigns表中）
      recommendedStrategyTemplateId: campaign.recommendedStrategyTemplateId || null,
      recommendedStrategyTemplateName: campaign.recommendedStrategyTemplateName || null,
      recommendationReason: campaign.recommendationReason || null
    };
  });
}
async function getCampaignsWithPerformancePaginated(params) {
  const db = await getDb();
  if (!db) return { data: [], total: 0, filteredTotal: 0, page: 1, pageSize: 25, totalPages: 0, statusCounts: { enabled: 0, paused: 0, archived: 0, managed: 0, unmanaged: 0 }, typeCounts: {} };
  const {
    accountId,
    startDate,
    endDate,
    todayDate,
    page = 1,
    pageSize = 25,
    sortField,
    sortDirection = "desc",
    search,
    campaignType,
    campaignStatus,
    optimizationStatus,
    serverPagination = true
  } = params;
  const whereConditions = [eq(campaigns.accountId, accountId)];
  if (search && search.trim()) {
    whereConditions.push(sql`${campaigns.campaignName} LIKE ${"%" + search.trim() + "%"}`);
  }
  if (campaignType && campaignType !== "all") {
    whereConditions.push(eq(campaigns.campaignType, campaignType));
  }
  if (campaignStatus && campaignStatus !== "all") {
    whereConditions.push(eq(campaigns.campaignStatus, campaignStatus));
  }
  if (optimizationStatus && optimizationStatus !== "all") {
    if (optimizationStatus === "managed") {
      whereConditions.push(sql`${campaigns.performanceGroupId} IS NOT NULL`);
    } else if (optimizationStatus === "unmanaged") {
      whereConditions.push(sql`${campaigns.performanceGroupId} IS NULL`);
    } else {
      whereConditions.push(eq(campaigns.optimizationStatus, optimizationStatus));
    }
  }
  const whereClause = and(...whereConditions);
  const [totalCountResult] = await db.select({
    total: sql`COUNT(*)`,
    enabled: sql`SUM(CASE WHEN ${campaigns.campaignStatus} = 'enabled' THEN 1 ELSE 0 END)`,
    paused: sql`SUM(CASE WHEN ${campaigns.campaignStatus} = 'paused' THEN 1 ELSE 0 END)`,
    archived: sql`SUM(CASE WHEN ${campaigns.campaignStatus} = 'archived' THEN 1 ELSE 0 END)`,
    managed: sql`SUM(CASE WHEN ${campaigns.performanceGroupId} IS NOT NULL THEN 1 ELSE 0 END)`,
    unmanaged: sql`SUM(CASE WHEN ${campaigns.performanceGroupId} IS NULL THEN 1 ELSE 0 END)`
  }).from(campaigns).where(eq(campaigns.accountId, accountId));
  const total = totalCountResult?.total || 0;
  const statusCounts = {
    enabled: totalCountResult?.enabled || 0,
    paused: totalCountResult?.paused || 0,
    archived: totalCountResult?.archived || 0,
    managed: totalCountResult?.managed || 0,
    unmanaged: totalCountResult?.unmanaged || 0
  };
  const typeCountsResult = await db.select({
    campaignType: campaigns.campaignType,
    count: sql`COUNT(*)`
  }).from(campaigns).where(eq(campaigns.accountId, accountId)).groupBy(campaigns.campaignType);
  const typeCounts = {};
  for (const tc of typeCountsResult) {
    if (tc.campaignType) typeCounts[tc.campaignType] = tc.count;
  }
  const [filteredCountResult] = await db.select({
    count: sql`COUNT(*)`
  }).from(campaigns).where(whereClause);
  const filteredTotal = filteredCountResult?.count || 0;
  const sortFieldMap = {
    campaignName: campaigns.campaignName,
    campaignType: campaigns.campaignType,
    status: campaigns.campaignStatus,
    dailyBudget: campaigns.dailyBudget,
    startDate: campaigns.startDate,
    costType: campaigns.costType,
    campaignGoal: campaigns.campaignGoal,
    adFormat: campaigns.adFormat
  };
  const perfSortFields = ["impressions", "clicks", "totalSpend", "totalSales", "acos", "roas", "ctr", "cvr", "cpc", "dailySpend", "dailySales"];
  const isPerfSort = sortField && perfSortFields.includes(sortField);
  let campaignList;
  if (serverPagination && !isPerfSort) {
    let query = db.select().from(campaigns).where(whereClause);
    if (sortField && sortFieldMap[sortField]) {
      const col2 = sortFieldMap[sortField];
      query = query.orderBy(sortDirection === "asc" ? sql`${col2} ASC` : sql`${col2} DESC`);
    } else {
      query = query.orderBy(sql`${campaigns.id} DESC`);
    }
    const offset = (page - 1) * pageSize;
    query = query.limit(pageSize).offset(offset);
    campaignList = await query;
  } else {
    campaignList = await db.select().from(campaigns).where(whereClause);
  }
  const perfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`${dailyPerformance.date} >= ${startDate}`,
    sql`${dailyPerformance.date} < DATE_ADD(${endDate}, INTERVAL 1 DAY)`
  )).groupBy(dailyPerformance.campaignId);
  const effectiveTodayDate = todayDate || endDate;
  const todayPerfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    todayImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    todayClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    todaySpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    todaySales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    todayOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`${dailyPerformance.date} >= ${effectiveTodayDate}`,
    sql`${dailyPerformance.date} < DATE_ADD(${effectiveTodayDate}, INTERVAL 1 DAY)`
  )).groupBy(dailyPerformance.campaignId);
  const perfMap = /* @__PURE__ */ new Map();
  for (const p of perfData) {
    if (p.campaignId) perfMap.set(p.campaignId, p);
  }
  const todayPerfMap = /* @__PURE__ */ new Map();
  for (const p of todayPerfData) {
    if (p.campaignId) todayPerfMap.set(p.campaignId, p);
  }
  const accountGroupIds = [...new Set(campaignList.map((c) => c.performanceGroupId).filter(Boolean))];
  let groupMap = /* @__PURE__ */ new Map();
  if (accountGroupIds.length > 0) {
    const relevantGroups = await db.select({
      id: performanceGroups.id,
      name: performanceGroups.name,
      strategyTemplateId: performanceGroups.strategyTemplateId,
      strategyTemplateName: performanceGroups.strategyTemplateName
    }).from(performanceGroups).where(inArray(performanceGroups.id, accountGroupIds));
    for (const g of relevantGroups) groupMap.set(g.id, g);
  }
  let mergedData = campaignList.map((campaign) => {
    const perf = perfMap.get(campaign.campaignId);
    const impressions = perf?.totalImpressions || 0;
    const clicks = perf?.totalClicks || 0;
    const spend = parseFloat(perf?.totalSpend || "0");
    const sales = parseFloat(perf?.totalSales || "0");
    const orders = perf?.totalOrders || 0;
    const group = campaign.performanceGroupId ? groupMap.get(campaign.performanceGroupId) : null;
    const todayPerf = todayPerfMap.get(campaign.campaignId);
    const dailySpend = parseFloat(todayPerf?.todaySpend || "0");
    const dailySales = parseFloat(todayPerf?.todaySales || "0");
    const dailyImpressions = todayPerf?.todayImpressions || 0;
    const dailyClicks = todayPerf?.todayClicks || 0;
    const dailyOrders = todayPerf?.todayOrders || 0;
    return {
      // @ts-ignore
      ...campaign,
      // v577: 确保关键字段不为null/undefined
      campaignName: campaign.campaignName || campaign.name || "",
      dailyBudget: campaign.dailyBudget || "0.00",
      campaignType: campaign.campaignType || "unknown",
      campaignStatus: campaign.campaignStatus || "unknown",
      targetingType: campaign.targetingType || "",
      biddingStrategy: campaign.biddingStrategy || "",
      startDate: campaign.startDate || null,
      endDate: campaign.endDate || null,
      // @ts-ignore
      impressions,
      clicks,
      spend: spend.toFixed(2),
      sales: sales.toFixed(2),
      orders,
      acos: sales > 0 ? (spend / sales * 100).toFixed(2) : null,
      roas: spend > 0 ? (sales / spend).toFixed(2) : null,
      ctr: impressions > 0 ? (clicks / impressions * 100).toFixed(4) : null,
      cvr: clicks > 0 ? (orders / clicks * 100).toFixed(4) : null,
      cpc: clicks > 0 ? (spend / clicks).toFixed(2) : null,
      // @ts-ignore
      dailySpend: dailySpend.toFixed(2),
      // @ts-ignore
      dailySales: dailySales.toFixed(2),
      // @ts-ignore
      dailyImpressions,
      dailyClicks,
      dailyOrders,
      // @ts-ignore
      performanceGroupName: group?.name || null,
      // @ts-ignore
      performanceGroupStrategyTemplate: group?.strategyTemplateName || null,
      // @ts-ignore
      recommendedStrategyTemplateId: campaign.recommendedStrategyTemplateId || null,
      // @ts-ignore
      recommendedStrategyTemplateName: campaign.recommendedStrategyTemplateName || null,
      // @ts-ignore
      recommendationReason: campaign.recommendationReason || null
    };
  });
  if (isPerfSort && sortField) {
    mergedData.sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        // @ts-ignore
        case "impressions":
          aVal = a.impressions || 0;
          bVal = b.impressions || 0;
          break;
        // @ts-ignore
        case "clicks":
          aVal = a.clicks || 0;
          bVal = b.clicks || 0;
          break;
        // @ts-ignore
        case "totalSpend":
          aVal = parseFloat(a.spend || "0");
          bVal = parseFloat(b.spend || "0");
          break;
        // @ts-ignore
        case "totalSales":
          aVal = parseFloat(a.sales || "0");
          bVal = parseFloat(b.sales || "0");
          break;
        // @ts-ignore
        case "acos":
          aVal = parseFloat(a.acos || "0");
          bVal = parseFloat(b.acos || "0");
          break;
        // @ts-ignore
        case "roas":
          aVal = parseFloat(a.roas || "0");
          bVal = parseFloat(b.roas || "0");
          break;
        // @ts-ignore
        case "ctr":
          aVal = parseFloat(a.ctr || "0");
          bVal = parseFloat(b.ctr || "0");
          break;
        // @ts-ignore
        case "cvr":
          aVal = parseFloat(a.cvr || "0");
          bVal = parseFloat(b.cvr || "0");
          break;
        // @ts-ignore
        case "cpc":
          aVal = parseFloat(a.cpc || "0");
          bVal = parseFloat(b.cpc || "0");
          break;
        // @ts-ignore
        case "dailySpend":
          aVal = parseFloat(a.dailySpend || "0");
          bVal = parseFloat(b.dailySpend || "0");
          break;
        // @ts-ignore
        case "dailySales":
          aVal = parseFloat(a.dailySales || "0");
          bVal = parseFloat(b.dailySales || "0");
          break;
        default:
          return 0;
      }
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
  }
  let resultData = mergedData;
  let resultFilteredTotal = filteredTotal;
  if (!serverPagination || isPerfSort) {
    resultFilteredTotal = mergedData.length;
    const offset = (page - 1) * pageSize;
    resultData = mergedData.slice(offset, offset + pageSize);
  }
  const totalPages = Math.ceil(resultFilteredTotal / pageSize);
  return {
    data: resultData,
    total,
    filteredTotal: resultFilteredTotal,
    page,
    pageSize,
    totalPages,
    statusCounts,
    typeCounts
  };
}
async function getAllCampaigns() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(campaigns);
}
async function getCampaignsByPerformanceGroupId(performanceGroupId2, expectedAccountId) {
  const db = await getDb();
  if (!db) return [];
  if (expectedAccountId) {
    return db.select().from(campaigns).where(
      and(
        eq(campaigns.performanceGroupId, performanceGroupId2),
        eq(campaigns.accountId, expectedAccountId)
      )
    );
  }
  return db.select().from(campaigns).where(eq(campaigns.performanceGroupId, performanceGroupId2));
}
async function getUnassignedCampaigns(accountId) {
  const db = await getDb();
  if (!db) return [];
  if (accountId) {
    return db.select().from(campaigns).where(
      and(
        eq(campaigns.accountId, accountId),
        isNull(campaigns.performanceGroupId)
      )
    );
  }
  return db.select().from(campaigns).where(isNull(campaigns.performanceGroupId));
}
async function getCampaignById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return result[0];
}
async function getCampaignByAmazonId(accountId, amazonCampaignId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(campaigns).where(
    and(
      eq(campaigns.accountId, accountId),
      eq(campaigns.campaignId, amazonCampaignId)
    )
  ).limit(1);
  return result[0];
}
async function getCampaignByAmazonCampaignId(amazonCampaignId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(campaigns).where(eq(campaigns.campaignId, amazonCampaignId)).limit(1);
  return result[0];
}
async function updateCampaign(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(campaigns).set(data).where(eq(campaigns.id, id));
}
async function assignCampaignToPerformanceGroup(campaignId, performanceGroupId2) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(campaigns).set({ performanceGroupId: performanceGroupId2 }).where(eq(campaigns.id, campaignId));
}
async function batchAssignCampaignsToPerformanceGroup(campaignIds, performanceGroupId2) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(campaigns).set({
    performanceGroupId: performanceGroupId2,
    optimizationStatus: "managed"
  }).where(inArray(campaigns.id, campaignIds));
}
async function getCampaignNamesOnly(accountId) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: campaigns.id,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    campaignType: campaigns.campaignType,
    campaignStatus: campaigns.campaignStatus,
    optimizationStatus: campaigns.optimizationStatus,
    performanceGroupId: campaigns.performanceGroupId
  }).from(campaigns).where(eq(campaigns.accountId, accountId));
}
async function getCampaignStatusCounts(accountId) {
  const db = await getDb();
  if (!db) return { total: 0, enabled: 0, paused: 0, archived: 0, managed: 0, unmanaged: 0 };
  const rows = await db.select({
    campaignStatus: campaigns.campaignStatus,
    optimizationStatus: campaigns.optimizationStatus,
    cnt: sql`COUNT(*)`
  }).from(campaigns).where(eq(campaigns.accountId, accountId)).groupBy(campaigns.campaignStatus, campaigns.optimizationStatus);
  let total = 0, enabled = 0, paused = 0, archived = 0, managed = 0, unmanaged = 0;
  for (const row of rows) {
    const count11 = Number(row.cnt);
    total += count11;
    if (row.campaignStatus === "enabled") enabled += count11;
    if (row.campaignStatus === "paused") paused += count11;
    if (row.campaignStatus === "archived") archived += count11;
    if (row.optimizationStatus === "managed") managed += count11;
    else unmanaged += count11;
  }
  return { total, enabled, paused, archived, managed, unmanaged };
}
async function getCampaignsByPerformanceGroupIdWithPerformance(performanceGroupId2, startDate, endDate) {
  const db = await getDb();
  if (!db) return [];
  const campaignList = await db.select().from(campaigns).where(
    eq(campaigns.performanceGroupId, performanceGroupId2)
  );
  if (campaignList.length === 0) return [];
  const accountIds = [...new Set(campaignList.map((c) => c.accountId).filter(Boolean))];
  if (accountIds.length === 0) return campaignList;
  const campaignIds = campaignList.map((c) => c.campaignId).filter(Boolean);
  if (campaignIds.length === 0) return campaignList;
  const perfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(
    inArray(dailyPerformance.accountId, accountIds),
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`${dailyPerformance.date} >= ${startDate}`,
    sql`${dailyPerformance.date} < DATE_ADD(${endDate}, INTERVAL 1 DAY)`
  )).groupBy(dailyPerformance.campaignId);
  const perfMap = /* @__PURE__ */ new Map();
  for (const p of perfData) {
    if (p.campaignId) perfMap.set(p.campaignId, p);
  }
  return campaignList.map((campaign) => {
    const perf = perfMap.get(campaign.campaignId);
    const impressions = perf?.totalImpressions || 0;
    const clicks = perf?.totalClicks || 0;
    const spend = parseFloat(perf?.totalSpend || "0");
    const sales = parseFloat(perf?.totalSales || "0");
    const orders = perf?.totalOrders || 0;
    return {
      ...campaign,
      impressions,
      clicks,
      spend: spend.toFixed(2),
      sales: sales.toFixed(2),
      orders,
      acos: sales > 0 ? (spend / sales * 100).toFixed(2) : null,
      roas: spend > 0 ? (sales / spend).toFixed(2) : null,
      ctr: impressions > 0 ? (clicks / impressions * 100).toFixed(4) : null,
      cvr: clicks > 0 ? (orders / clicks * 100).toFixed(4) : null,
      cpc: clicks > 0 ? (spend / clicks).toFixed(2) : null
    };
  });
}
async function getUnassignedCampaignsWithPerformance(accountId, startDate, endDate) {
  const db = await getDb();
  if (!db) return [];
  const campaignList = await db.select().from(campaigns).where(
    and(
      eq(campaigns.accountId, accountId),
      isNull(campaigns.performanceGroupId)
    )
  );
  if (campaignList.length === 0) return [];
  const perfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`${dailyPerformance.date} >= ${startDate}`,
    sql`${dailyPerformance.date} < DATE_ADD(${endDate}, INTERVAL 1 DAY)`
  )).groupBy(dailyPerformance.campaignId);
  const perfMap = /* @__PURE__ */ new Map();
  for (const p of perfData) {
    if (p.campaignId) perfMap.set(p.campaignId, p);
  }
  return campaignList.map((campaign) => {
    const perf = perfMap.get(campaign.campaignId);
    const impressions = perf?.totalImpressions || 0;
    const clicks = perf?.totalClicks || 0;
    const spend = parseFloat(perf?.totalSpend || "0");
    const sales = parseFloat(perf?.totalSales || "0");
    const orders = perf?.totalOrders || 0;
    return {
      ...campaign,
      impressions,
      clicks,
      spend: spend.toFixed(2),
      sales: sales.toFixed(2),
      orders,
      acos: sales > 0 ? (spend / sales * 100).toFixed(2) : null,
      roas: spend > 0 ? (sales / spend).toFixed(2) : null,
      ctr: impressions > 0 ? (clicks / impressions * 100).toFixed(4) : null,
      cvr: clicks > 0 ? (orders / clicks * 100).toFixed(4) : null,
      cpc: clicks > 0 ? (spend / clicks).toFixed(2) : null
    };
  });
}
var init_campaigns = __esm({
  "server/db/campaigns.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(createCampaign, "createCampaign");
    __name(getCampaignsByAccountId, "getCampaignsByAccountId");
    __name(getCampaignsWithPerformance, "getCampaignsWithPerformance");
    __name(getCampaignsWithPerformancePaginated, "getCampaignsWithPerformancePaginated");
    __name(getAllCampaigns, "getAllCampaigns");
    __name(getCampaignsByPerformanceGroupId, "getCampaignsByPerformanceGroupId");
    __name(getUnassignedCampaigns, "getUnassignedCampaigns");
    __name(getCampaignById, "getCampaignById");
    __name(getCampaignByAmazonId, "getCampaignByAmazonId");
    __name(getCampaignByAmazonCampaignId, "getCampaignByAmazonCampaignId");
    __name(updateCampaign, "updateCampaign");
    __name(assignCampaignToPerformanceGroup, "assignCampaignToPerformanceGroup");
    __name(batchAssignCampaignsToPerformanceGroup, "batchAssignCampaignsToPerformanceGroup");
    __name(getCampaignNamesOnly, "getCampaignNamesOnly");
    __name(getCampaignStatusCounts, "getCampaignStatusCounts");
    __name(getCampaignsByPerformanceGroupIdWithPerformance, "getCampaignsByPerformanceGroupIdWithPerformance");
    __name(getUnassignedCampaignsWithPerformance, "getUnassignedCampaignsWithPerformance");
  }
});

