import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, users, 
  adAccounts, InsertAdAccount, AdAccount,
  performanceGroups, InsertPerformanceGroup, PerformanceGroup,
  campaigns, InsertCampaign, Campaign,
  adGroups, InsertAdGroup, AdGroup,
  keywords, InsertKeyword, Keyword,
  productTargets, InsertProductTarget, ProductTarget,
  biddingLogs, InsertBiddingLog, BiddingLog,
  dailyPerformance, InsertDailyPerformance, DailyPerformance,
  marketCurveData, InsertMarketCurveData, MarketCurveData,
  importJobs, InsertImportJob, ImportJob,
  negativeKeywords, InsertNegativeKeyword, NegativeKeyword,
  notificationSettings, NotificationSetting, InsertNotificationSetting,
  notificationHistory, NotificationHistoryRecord, InsertNotificationHistory,
  scheduledTasks, ScheduledTask, InsertScheduledTask,
  taskExecutionLog, TaskExecutionLogRecord, InsertTaskExecutionLog,
  batchOperations, BatchOperation, InsertBatchOperation,
  batchOperationItems, BatchOperationItem, InsertBatchOperationItem,
  attributionCorrectionRecords, AttributionCorrectionRecord, InsertAttributionCorrectionRecord,
  correctionReviewSessions, CorrectionReviewSession, InsertCorrectionReviewSession,
  teamMembers, TeamMember, InsertTeamMember,
  accountPermissions, AccountPermission, InsertAccountPermission,
  emailReportSubscriptions, EmailReportSubscription, InsertEmailReportSubscription,
  emailSendLogs, EmailSendLog, InsertEmailSendLog,
  searchTerms, SearchTerm, InsertSearchTerm,
  aiOptimizationExecutions, AiOptimizationExecution, InsertAiOptimizationExecution,
  aiOptimizationActions, AiOptimizationAction, InsertAiOptimizationAction,
  aiOptimizationPredictions, AiOptimizationPrediction, InsertAiOptimizationPrediction,
  aiOptimizationReviews, AiOptimizationReview, InsertAiOptimizationReview
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ==================== User Functions ====================
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ==================== Ad Account Functions ====================
export async function createAdAccount(account: InsertAdAccount) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(adAccounts).values(account);
  return result[0].insertId;
}

export async function getAdAccountsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(adAccounts)
    .where(eq(adAccounts.userId, userId))
    .orderBy(adAccounts.sortOrder, adAccounts.createdAt);
}

export async function getAdAccountById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(adAccounts).where(eq(adAccounts.id, id)).limit(1);
  return result[0];
}

export async function updateAdAccount(id: number, data: Partial<InsertAdAccount>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(adAccounts).set(data).where(eq(adAccounts.id, id));
}

export async function deleteAdAccount(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(adAccounts).where(eq(adAccounts.id, id));
}

export async function setDefaultAdAccount(userId: number, accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 先取消所有默认账号
  await db.update(adAccounts)
    .set({ isDefault: false })
    .where(eq(adAccounts.userId, userId));
  
  // 设置新的默认账号
  await db.update(adAccounts)
    .set({ isDefault: true })
    .where(eq(adAccounts.id, accountId));
}

export async function getDefaultAdAccount(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(adAccounts)
    .where(and(eq(adAccounts.userId, userId), eq(adAccounts.isDefault, true)))
    .limit(1);
  return result[0];
}

export async function updateAdAccountConnectionStatus(
  id: number, 
  status: 'connected' | 'disconnected' | 'error' | 'pending',
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(adAccounts).set({
    connectionStatus: status,
    lastConnectionCheck: new Date(),
    connectionErrorMessage: errorMessage || null,
  }).where(eq(adAccounts.id, id));
}

export async function reorderAdAccounts(userId: number, accountIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 批量更新排序顺序
  for (let i = 0; i < accountIds.length; i++) {
    await db.update(adAccounts)
      .set({ sortOrder: i })
      .where(and(eq(adAccounts.id, accountIds[i]), eq(adAccounts.userId, userId)));
  }
}

// ==================== Performance Group Functions ====================
export async function createPerformanceGroup(group: InsertPerformanceGroup) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(performanceGroups).values(group);
  return result[0].insertId;
}

export async function getPerformanceGroupsByAccountId(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(performanceGroups).where(eq(performanceGroups.accountId, accountId));
}

export async function getPerformanceGroupById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(performanceGroups).where(eq(performanceGroups.id, id)).limit(1);
  return result[0];
}

export async function updatePerformanceGroup(id: number, data: Partial<InsertPerformanceGroup>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(performanceGroups).set(data).where(eq(performanceGroups.id, id));
}

export async function deletePerformanceGroup(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(performanceGroups).where(eq(performanceGroups.id, id));
}

// ==================== Campaign Functions ====================
export async function createCampaign(campaign: InsertCampaign) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(campaigns).values(campaign);
  return result[0].insertId;
}

export async function getCampaignsByAccountId(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(campaigns).where(eq(campaigns.accountId, accountId));
}

export async function getCampaignsByPerformanceGroupId(performanceGroupId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(campaigns).where(eq(campaigns.performanceGroupId, performanceGroupId));
}

export async function getCampaignById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return result[0];
}

export async function updateCampaign(id: number, data: Partial<InsertCampaign>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(campaigns).set(data).where(eq(campaigns.id, id));
}

export async function assignCampaignToPerformanceGroup(campaignId: number, performanceGroupId: number | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(campaigns).set({ performanceGroupId }).where(eq(campaigns.id, campaignId));
}

// ==================== Ad Group Functions ====================
export async function createAdGroup(adGroup: InsertAdGroup) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(adGroups).values(adGroup);
  return result[0].insertId;
}

export async function getAdGroupsByCampaignId(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(adGroups).where(eq(adGroups.campaignId, campaignId));
}

export async function getAdGroupById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(adGroups).where(eq(adGroups.id, id)).limit(1);
  return result[0];
}

// ==================== Keyword Functions ====================
export async function createKeyword(keyword: InsertKeyword) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(keywords).values(keyword);
  return result[0].insertId;
}

export async function getKeywordsByAdGroupId(adGroupId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(keywords).where(eq(keywords.adGroupId, adGroupId));
}

export async function getKeywordById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(keywords).where(eq(keywords.id, id)).limit(1);
  return result[0];
}

export async function updateKeywordBid(id: number, newBid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(keywords).set({ bid: newBid }).where(eq(keywords.id, id));
}

export async function updateKeyword(id: number, data: Partial<InsertKeyword>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(keywords).set(data).where(eq(keywords.id, id));
}

// ==================== Product Target Functions ====================
export async function createProductTarget(target: InsertProductTarget) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(productTargets).values(target);
  return result[0].insertId;
}

export async function getProductTargetsByAdGroupId(adGroupId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(productTargets).where(eq(productTargets.adGroupId, adGroupId));
}

export async function getProductTargetById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(productTargets).where(eq(productTargets.id, id)).limit(1);
  return result[0];
}

export async function updateProductTargetBid(id: number, newBid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productTargets).set({ bid: newBid }).where(eq(productTargets.id, id));
}

export async function updateProductTarget(id: number, data: Partial<InsertProductTarget>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productTargets).set(data).where(eq(productTargets.id, id));
}

// ==================== Bidding Log Functions ====================
export async function createBiddingLog(log: InsertBiddingLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(biddingLogs).values(log);
  return result[0].insertId;
}

export async function getBiddingLogsByAccountId(accountId: number, limit = 100, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId))
    .orderBy(desc(biddingLogs.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getBiddingLogsByCampaignId(campaignId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(biddingLogs)
    .where(eq(biddingLogs.campaignId, campaignId))
    .orderBy(desc(biddingLogs.createdAt))
    .limit(limit);
}

export async function getBiddingLogsCount(accountId: number) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId));
  return result[0]?.count || 0;
}

// ==================== Daily Performance Functions ====================
export async function createDailyPerformance(perf: InsertDailyPerformance) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(dailyPerformance).values(perf);
  return result[0].insertId;
}

export async function getDailyPerformanceByDateRange(
  accountId: number,
  startDate: Date,
  endDate: Date,
  campaignId?: number
) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [
    eq(dailyPerformance.accountId, accountId),
    gte(dailyPerformance.date, startDate),
    lte(dailyPerformance.date, endDate)
  ];
  
  if (campaignId) {
    conditions.push(eq(dailyPerformance.campaignId, campaignId));
  }
  
  return db.select()
    .from(dailyPerformance)
    .where(and(...conditions))
    .orderBy(dailyPerformance.date);
}

export async function getPerformanceSummary(accountId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select({
    totalImpressions: sql<number>`SUM(impressions)`,
    totalClicks: sql<number>`SUM(clicks)`,
    totalSpend: sql<string>`SUM(spend)`,
    totalSales: sql<string>`SUM(sales)`,
    totalOrders: sql<number>`SUM(orders)`,
    totalConversions: sql<number>`SUM(conversions)`,
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      gte(dailyPerformance.date, startDate),
      lte(dailyPerformance.date, endDate)
    ));
  
  return result[0];
}

// ==================== Market Curve Data Functions ====================
export async function upsertMarketCurveData(data: InsertMarketCurveData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(marketCurveData).values(data).onDuplicateKeyUpdate({
    set: {
      estimatedImpressions: data.estimatedImpressions,
      estimatedClicks: data.estimatedClicks,
      estimatedConversions: data.estimatedConversions,
      estimatedSpend: data.estimatedSpend,
      estimatedSales: data.estimatedSales,
      marginalRevenue: data.marginalRevenue,
      marginalCost: data.marginalCost,
      marginalProfit: data.marginalProfit,
      trafficCeiling: data.trafficCeiling,
      optimalBidPoint: data.optimalBidPoint,
    }
  });
}

export async function getMarketCurveData(targetType: "keyword" | "product_target", targetId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(marketCurveData)
    .where(and(
      eq(marketCurveData.targetType, targetType),
      eq(marketCurveData.targetId, targetId)
    ))
    .orderBy(marketCurveData.bidLevel);
}

// ==================== Import Job Functions ====================
export async function createImportJob(job: InsertImportJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(importJobs).values(job);
  return result[0].insertId;
}

export async function getImportJobsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(importJobs)
    .where(eq(importJobs.userId, userId))
    .orderBy(desc(importJobs.createdAt));
}

export async function updateImportJob(id: number, data: Partial<InsertImportJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(importJobs).set(data).where(eq(importJobs.id, id));
}

// ==================== Bulk Operations ====================
export async function bulkCreateCampaigns(campaignsData: InsertCampaign[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (campaignsData.length === 0) return;
  await db.insert(campaigns).values(campaignsData);
}

export async function bulkCreateAdGroups(adGroupsData: InsertAdGroup[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (adGroupsData.length === 0) return;
  await db.insert(adGroups).values(adGroupsData);
}

export async function bulkCreateKeywords(keywordsData: InsertKeyword[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (keywordsData.length === 0) return;
  await db.insert(keywords).values(keywordsData);
}

export async function bulkCreateProductTargets(targetsData: InsertProductTarget[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (targetsData.length === 0) return;
  await db.insert(productTargets).values(targetsData);
}

export async function bulkCreateDailyPerformance(perfData: InsertDailyPerformance[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (perfData.length === 0) return;
  await db.insert(dailyPerformance).values(perfData);
}


// ==================== Amazon API Credentials Functions ====================
import { amazonApiCredentials, InsertAmazonApiCredential, AmazonApiCredential } from "../drizzle/schema";

export async function saveAmazonApiCredentials(data: InsertAmazonApiCredential) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(amazonApiCredentials).values(data).onDuplicateKeyUpdate({
    set: {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      refreshToken: data.refreshToken,
      profileId: data.profileId,
      region: data.region,
      updatedAt: new Date(),
    }
  });
}

export async function getAmazonApiCredentials(accountId: number): Promise<AmazonApiCredential | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(amazonApiCredentials)
    .where(eq(amazonApiCredentials.accountId, accountId))
    .limit(1);
  
  return result[0] || null;
}

export async function updateAmazonApiCredentials(accountId: number, data: Partial<InsertAmazonApiCredential>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(amazonApiCredentials)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(amazonApiCredentials.accountId, accountId));
}

export async function deleteAmazonApiCredentials(accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(amazonApiCredentials)
    .where(eq(amazonApiCredentials.accountId, accountId));
}


// ==================== Ad Automation Functions ====================

// 获取搜索词数据用于N-Gram分析 - 使用keywords表的数据
export async function getSearchTermsForAnalysis(accountId: number, _days: number = 30) {
  const db = await getDb();
  if (!db) return [];
  
  // 使用keywords表自带的绩效数据
  const result = await db.select({
    searchTerm: keywords.keywordText,
    clicks: keywords.clicks,
    orders: keywords.orders,
    spend: keywords.spend,
    sales: keywords.sales,
    impressions: keywords.impressions,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
  .where(eq(campaigns.accountId, accountId));
  
  return result.map(r => ({
    searchTerm: r.searchTerm || '',
    clicks: Number(r.clicks) || 0,
    conversions: Number(r.orders) || 0,
    spend: parseFloat(r.spend || '0'),
    sales: parseFloat(r.sales || '0'),
    impressions: Number(r.impressions) || 0,
  }));
}

// 获取广告活动搜索词数据用于漏斗迁移和冲突检测
export async function getCampaignSearchTerms(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  // 使用keywords表自带的绩效数据
  const result = await db.select({
    searchTerm: keywords.keywordText,
    campaignId: campaigns.id,
    campaignName: campaigns.campaignName,
    matchType: keywords.matchType,
    clicks: keywords.clicks,
    spend: keywords.spend,
    sales: keywords.sales,
    orders: keywords.orders,
    bid: keywords.bid,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
  .where(eq(campaigns.accountId, accountId));
  
  return result.map(r => {
    const clicks = Number(r.clicks) || 0;
    const orders = Number(r.orders) || 0;
    const spend = parseFloat(r.spend || '0');
    const sales = parseFloat(r.sales || '0');
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    
    return {
      searchTerm: r.searchTerm || '',
      campaignId: r.campaignId,
      campaignName: r.campaignName || '',
      campaignType: 'sp_manual' as const, // 默认为SP手动广告
      targetingType: 'keyword' as const, // 关键词定位
      matchType: (r.matchType || 'broad') as 'broad' | 'phrase' | 'exact' | 'auto' | 'product',
      clicks,
      conversions: orders,
      spend,
      sales,
      roas,
      acos,
      cpc,
    };
  });
}

// 获取竞价目标数据用于智能竞价分析
export async function getBidTargets(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  // 获取关键词目标 - 使用keywords表自带的绩效数据
  const keywordTargets = await db.select({
    id: keywords.id,
    name: keywords.keywordText,
    campaignId: campaigns.id,
    campaignName: campaigns.campaignName,
    currentBid: keywords.bid,
    impressions: keywords.impressions,
    clicks: keywords.clicks,
    spend: keywords.spend,
    sales: keywords.sales,
    orders: keywords.orders,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
  .where(eq(campaigns.accountId, accountId));
  
  // 获取商品定位目标 - 使用productTargets表自带的绩效数据
  const productTargetResults = await db.select({
    id: productTargets.id,
    name: productTargets.targetValue,
    campaignId: campaigns.id,
    campaignName: campaigns.campaignName,
    currentBid: productTargets.bid,
    impressions: productTargets.impressions,
    clicks: productTargets.clicks,
    spend: productTargets.spend,
    sales: productTargets.sales,
    orders: productTargets.orders,
  })
  .from(productTargets)
  .innerJoin(adGroups, eq(productTargets.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
  .where(eq(campaigns.accountId, accountId));
  
  const results = [
    ...keywordTargets.map(r => ({
      id: r.id,
      type: 'keyword' as const,
      name: r.name || '',
      campaignId: r.campaignId,
      campaignName: r.campaignName || '',
      currentBid: parseFloat(r.currentBid || '0'),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      conversions: Number(r.orders) || 0,
      spend: parseFloat(r.spend || '0'),
      sales: parseFloat(r.sales || '0'),
    })),
    ...productTargetResults.map(r => ({
      id: r.id,
      type: 'product_target' as const,
      name: r.name || '',
      campaignId: r.campaignId,
      campaignName: r.campaignName || '',
      currentBid: parseFloat(r.currentBid || '0'),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      conversions: Number(r.orders) || 0,
      spend: parseFloat(r.spend || '0'),
      sales: parseFloat(r.sales || '0'),
    })),
  ];
  
  return results;
}

// 获取唯一搜索词列表用于分类
export async function getUniqueSearchTerms(accountId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.selectDistinct({
    searchTerm: keywords.keywordText,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
  .where(eq(campaigns.accountId, accountId));
  
  return result.map(r => r.searchTerm || '').filter(t => t.length > 0);
}

// 添加否定关键词
// addNegativeKeyword函数已移至文件末尾的批量操作扩展部分

// 记录漏斗迁移操作
export async function recordMigration(data: {
  accountId: number;
  searchTerm: string;
  fromCampaignId: number;
  toMatchType: 'phrase' | 'exact';
  suggestedBid: number;
  status: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 记录到bidding_logs
  await db.insert(biddingLogs).values({
    accountId: data.accountId,
    campaignId: data.fromCampaignId,
    targetType: 'keyword',
    targetId: 0,
    targetName: data.searchTerm,
    matchType: data.toMatchType,
    actionType: 'set',
    previousBid: '0',
    newBid: data.suggestedBid.toString(),
    reason: `漏斗迁移: 升级到${data.toMatchType}匹配`,
  });
}


// ==================== Ad Automation Functions ====================


// ==================== 半月纠错复盘 ====================

export interface BidChangeRecord {
  id: number;
  targetId: number;
  targetName: string;
  targetType: 'keyword' | 'product';
  campaignId: number;
  campaignName: string;
  oldBid: number;
  newBid: number;
  changeDate: Date;
  changeReason: string;
  performanceAfter?: {
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    roas: number;
    acos: number;
  };
}

export async function getBidChangeRecords(accountId: number, days: number): Promise<BidChangeRecord[]> {
  const db = await getDb();
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  // 从bidding_logs获取出价变更记录
  const logs = await db.select()
    .from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId))
    .orderBy(desc(biddingLogs.createdAt))
    .limit(500);
  
  // 转换为BidChangeRecord格式
  const records: BidChangeRecord[] = [];
  for (const log of logs) {
    if (log.actionType !== 'increase' && log.actionType !== 'decrease' && log.actionType !== 'set') {
      continue;
    }
    
    const oldBid = parseFloat(log.previousBid || '0');
    const newBid = parseFloat(log.newBid || '0');
    
    if (oldBid === 0 || newBid === 0) continue;
    
    // 获取变更后的绩效数据（模拟）
    const performanceAfter = {
      clicks: Math.floor(Math.random() * 50),
      conversions: Math.floor(Math.random() * 5),
      spend: Math.random() * 100,
      sales: Math.random() * 500,
      roas: 0,
      acos: 0,
    };
    performanceAfter.roas = performanceAfter.spend > 0 ? performanceAfter.sales / performanceAfter.spend : 0;
    performanceAfter.acos = performanceAfter.sales > 0 ? (performanceAfter.spend / performanceAfter.sales) * 100 : 0;
    
    records.push({
      id: log.id,
      targetId: log.targetId || 0,
      targetName: log.targetName || '',
      targetType: log.targetType as 'keyword' | 'product',
      campaignId: log.campaignId || 0,
      campaignName: '',
      oldBid,
      newBid,
      changeDate: log.createdAt || new Date(),
      changeReason: log.reason || '',
      performanceAfter,
    });
  }
  
  return records;
}

export async function recordBidChange(data: {
  accountId: number;
  targetId: number;
  targetType: 'keyword' | 'product';
  oldBid: number;
  newBid: number;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 将'product'转换为'product_target'以匹配数据库枚举值
  const dbTargetType = data.targetType === 'product' ? 'product_target' : 'keyword';
  
  await db.insert(biddingLogs).values({
    accountId: data.accountId,
    campaignId: 0, // 默认值
    targetType: dbTargetType,
    targetId: data.targetId,
    targetName: '',
    matchType: 'exact',
    actionType: data.newBid > data.oldBid ? 'increase' : 'decrease',
    previousBid: data.oldBid.toString(),
    newBid: data.newBid.toString(),
    reason: data.reason,
  });
}

// ==================== 广告活动健康度监控 ====================

export interface CampaignHealthMetrics {
  campaignId: number;
  campaignName: string;
  campaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
  currentMetrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
    cpc: number;
  };
  historicalAverage: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
    cpc: number;
  };
  changes: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
    cpc: number;
  };
}

export async function getCampaignHealthMetrics(accountId: number): Promise<CampaignHealthMetrics[]> {
  const db = await getDb();
  if (!db) return [];
  
  // 获取所有广告活动
  const campaignList = await db.select()
    .from(campaigns)
    .where(eq(campaigns.accountId, accountId));
  
  const results: CampaignHealthMetrics[] = [];
  
  for (const campaign of campaignList) {
    // 获取最近7天的绩效数据
    const recentPerf = await db.select()
      .from(dailyPerformance)
      .where(eq(dailyPerformance.campaignId, campaign.id))
      .orderBy(desc(dailyPerformance.date))
      .limit(7);
    
    // 获取历史30天的绩效数据
    const historicalPerf = await db.select()
      .from(dailyPerformance)
      .where(eq(dailyPerformance.campaignId, campaign.id))
      .orderBy(desc(dailyPerformance.date))
      .limit(30);
    
    // 计算当前指标（最近7天平均）
    const currentMetrics = calculateAverageMetrics(recentPerf);
    
    // 计算历史平均（30天）
    const historicalAverage = calculateAverageMetrics(historicalPerf);
    
    // 计算变化百分比
    const changes = calculateMetricChanges(currentMetrics, historicalAverage);
    
    results.push({
      campaignId: campaign.id,
      campaignName: campaign.campaignName,
      campaignType: campaign.campaignType as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
      currentMetrics,
      historicalAverage,
      changes,
    });
  }
  
  return results;
}

function calculateAverageMetrics(perfData: any[]): CampaignHealthMetrics['currentMetrics'] {
  if (perfData.length === 0) {
    return {
      impressions: 0,
      clicks: 0,
      spend: 0,
      sales: 0,
      orders: 0,
      ctr: 0,
      cvr: 0,
      acos: 0,
      roas: 0,
      cpc: 0,
    };
  }
  
  const totals = perfData.reduce((acc, p) => ({
    impressions: acc.impressions + (p.impressions || 0),
    clicks: acc.clicks + (p.clicks || 0),
    spend: acc.spend + parseFloat(p.spend || '0'),
    sales: acc.sales + parseFloat(p.sales || '0'),
    orders: acc.orders + (p.orders || 0),
  }), { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 });
  
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cvr = totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0;
  const acos = totals.sales > 0 ? (totals.spend / totals.sales) * 100 : 0;
  const roas = totals.spend > 0 ? totals.sales / totals.spend : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  
  return {
    impressions: Math.round(totals.impressions / perfData.length),
    clicks: Math.round(totals.clicks / perfData.length),
    spend: totals.spend / perfData.length,
    sales: totals.sales / perfData.length,
    orders: Math.round(totals.orders / perfData.length),
    ctr,
    cvr,
    acos,
    roas,
    cpc,
  };
}

function calculateMetricChanges(
  current: CampaignHealthMetrics['currentMetrics'],
  historical: CampaignHealthMetrics['historicalAverage']
): CampaignHealthMetrics['changes'] {
  const calcChange = (curr: number, hist: number) => {
    if (hist === 0) return curr > 0 ? 100 : 0;
    return ((curr - hist) / hist) * 100;
  };
  
  return {
    impressions: calcChange(current.impressions, historical.impressions),
    clicks: calcChange(current.clicks, historical.clicks),
    spend: calcChange(current.spend, historical.spend),
    sales: calcChange(current.sales, historical.sales),
    orders: calcChange(current.orders, historical.orders),
    ctr: calcChange(current.ctr, historical.ctr),
    cvr: calcChange(current.cvr, historical.cvr),
    acos: calcChange(current.acos, historical.acos),
    roas: calcChange(current.roas, historical.roas),
    cpc: calcChange(current.cpc, historical.cpc),
  };
}

// ==================== 批量操作扩展 ====================

export async function addNegativeKeyword(data: {
  campaignId: number;
  adGroupId?: number;
  keyword: string;
  matchType: 'phrase' | 'exact';
  level?: 'ad_group' | 'campaign';
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 记录到negativeKeywords表
  await db.insert(negativeKeywords).values({
    accountId: 1, // 默认账号
    campaignId: data.campaignId,
    adGroupId: data.adGroupId || null,
    negativeLevel: data.level || (data.adGroupId ? 'ad_group' : 'campaign'),
    negativeType: 'keyword',
    negativeText: data.keyword,
    matchType: data.matchType === 'phrase' ? 'negative_phrase' : 'negative_exact',
    source: 'manual',
  });
}


// ==================== Notification Functions ====================

export async function getNotificationSettingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId))
    .limit(1);
  
  return result[0] || null;
}

export async function updateNotificationSettingsByUserId(userId: number, data: {
  emailEnabled?: boolean;
  inAppEnabled?: boolean;
  acosThreshold?: number;
  ctrDropThreshold?: number;
  conversionDropThreshold?: number;
  spendSpikeThreshold?: number;
  frequency?: 'immediate' | 'hourly' | 'daily' | 'weekly';
  quietHoursStart?: number;
  quietHoursEnd?: number;
}) {
  const db = await getDb();
  if (!db) return;
  
  const existing = await getNotificationSettingsByUserId(userId);
  
  if (existing) {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.emailEnabled !== undefined) updateData.emailEnabled = data.emailEnabled;
    if (data.inAppEnabled !== undefined) updateData.inAppEnabled = data.inAppEnabled;
    if (data.acosThreshold !== undefined) updateData.acosThreshold = String(data.acosThreshold);
    if (data.ctrDropThreshold !== undefined) updateData.ctrDropThreshold = String(data.ctrDropThreshold);
    if (data.conversionDropThreshold !== undefined) updateData.conversionDropThreshold = String(data.conversionDropThreshold);
    if (data.spendSpikeThreshold !== undefined) updateData.spendSpikeThreshold = String(data.spendSpikeThreshold);
    if (data.frequency !== undefined) updateData.frequency = data.frequency;
    if (data.quietHoursStart !== undefined) updateData.quietHoursStart = data.quietHoursStart;
    if (data.quietHoursEnd !== undefined) updateData.quietHoursEnd = data.quietHoursEnd;
    
    await db.update(notificationSettings)
      .set(updateData)
      .where(eq(notificationSettings.id, existing.id));
  } else {
    await db.insert(notificationSettings).values({
      userId,
      emailEnabled: data.emailEnabled ?? true,
      inAppEnabled: data.inAppEnabled ?? true,
      acosThreshold: data.acosThreshold !== undefined ? String(data.acosThreshold) : '50.00',
      ctrDropThreshold: data.ctrDropThreshold !== undefined ? String(data.ctrDropThreshold) : '30.00',
      conversionDropThreshold: data.conversionDropThreshold !== undefined ? String(data.conversionDropThreshold) : '30.00',
      spendSpikeThreshold: data.spendSpikeThreshold !== undefined ? String(data.spendSpikeThreshold) : '50.00',
      frequency: data.frequency ?? 'daily',
      quietHoursStart: data.quietHoursStart ?? 22,
      quietHoursEnd: data.quietHoursEnd ?? 8,
    });
  }
}

export async function getNotificationHistoryByUserId(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select()
    .from(notificationHistory)
    .where(eq(notificationHistory.userId, userId))
    .orderBy(desc(notificationHistory.createdAt))
    .limit(limit);
  
  return result;
}

export async function createNotificationRecord(data: {
  userId: number;
  accountId?: number;
  type: 'alert' | 'report' | 'system';
  severity?: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  channel?: 'email' | 'in_app' | 'both';
  relatedEntityType?: string;
  relatedEntityId?: number;
}) {
  const db = await getDb();
  if (!db) return;
  
  await db.insert(notificationHistory).values({
    userId: data.userId,
    accountId: data.accountId || null,
    type: data.type,
    severity: data.severity ?? 'info',
    title: data.title,
    message: data.message,
    channel: data.channel ?? 'in_app',
    status: 'pending',
    relatedEntityType: data.relatedEntityType || null,
    relatedEntityId: data.relatedEntityId || null,
  });
}

export async function markNotificationAsRead(notificationId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(notificationHistory)
    .set({ status: 'read', readAt: new Date() })
    .where(eq(notificationHistory.id, notificationId));
}

// ==================== Scheduler Functions ====================

export async function getScheduledTasksByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.userId, userId))
    .orderBy(scheduledTasks.createdAt);
  
  return result;
}

export async function getScheduledTaskById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.id, id))
    .limit(1);
  
  return result[0] || null;
}

export async function createScheduledTask(data: {
  userId: number;
  accountId?: number;
  taskType: 'ngram_analysis' | 'funnel_migration' | 'traffic_conflict' | 'smart_bidding' | 'health_check' | 'data_sync';
  name: string;
  description?: string;
  schedule?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  runTime?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  enabled?: boolean;
  autoApply?: boolean;
  requireApproval?: boolean;
  parameters?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.insert(scheduledTasks).values({
    userId: data.userId,
    accountId: data.accountId || null,
    taskType: data.taskType,
    name: data.name,
    description: data.description || null,
    schedule: data.schedule ?? 'daily',
    runTime: data.runTime ?? '06:00',
    dayOfWeek: data.dayOfWeek || null,
    dayOfMonth: data.dayOfMonth || null,
    enabled: data.enabled ?? true,
    autoApply: data.autoApply ?? false,
    requireApproval: data.requireApproval ?? true,
    parameters: data.parameters ? JSON.stringify(data.parameters) : null,
  });
  
  return result[0]?.insertId || 0;
}

export async function updateScheduledTask(id: number, data: {
  name?: string;
  description?: string;
  schedule?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  runTime?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  enabled?: boolean;
  autoApply?: boolean;
  requireApproval?: boolean;
  parameters?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.schedule !== undefined) updateData.schedule = data.schedule;
  if (data.runTime !== undefined) updateData.runTime = data.runTime;
  if (data.dayOfWeek !== undefined) updateData.dayOfWeek = data.dayOfWeek;
  if (data.dayOfMonth !== undefined) updateData.dayOfMonth = data.dayOfMonth;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.autoApply !== undefined) updateData.autoApply = data.autoApply;
  if (data.requireApproval !== undefined) updateData.requireApproval = data.requireApproval;
  if (data.parameters !== undefined) updateData.parameters = JSON.stringify(data.parameters);
  
  await db.update(scheduledTasks)
    .set(updateData)
    .where(eq(scheduledTasks.id, id));
}

export async function deleteScheduledTask(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(scheduledTasks).where(eq(scheduledTasks.id, id));
}

export async function recordTaskExecution(data: {
  taskId: number;
  userId: number;
  accountId?: number;
  taskType: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  itemsProcessed?: number;
  suggestionsGenerated?: number;
  suggestionsApplied?: number;
  errorMessage?: string;
  resultSummary?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  
  await db.insert(taskExecutionLog).values({
    taskId: data.taskId,
    userId: data.userId,
    accountId: data.accountId || null,
    taskType: data.taskType,
    status: data.status,
    startedAt: data.startedAt,
    completedAt: data.completedAt || null,
    duration: data.duration || null,
    itemsProcessed: data.itemsProcessed ?? 0,
    suggestionsGenerated: data.suggestionsGenerated ?? 0,
    suggestionsApplied: data.suggestionsApplied ?? 0,
    errorMessage: data.errorMessage || null,
    resultSummary: data.resultSummary ? JSON.stringify(data.resultSummary) : null,
  });
  
  // Update last run time on the task
  // Map 'cancelled' to 'failed' for lastRunStatus since schema only supports success/failed/running/skipped
  const mappedStatus = data.status === 'cancelled' ? 'failed' : data.status;
  await db.update(scheduledTasks)
    .set({ 
      lastRunAt: data.startedAt, 
      lastRunStatus: mappedStatus as 'success' | 'failed' | 'running' | 'skipped',
      updatedAt: new Date() 
    })
    .where(eq(scheduledTasks.id, data.taskId));
}

export async function getTaskExecutionHistory(taskId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select()
    .from(taskExecutionLog)
    .where(eq(taskExecutionLog.taskId, taskId))
    .orderBy(desc(taskExecutionLog.startedAt))
    .limit(limit);
  
  return result;
}


// ==================== Batch Operations Functions ====================

// Create a new batch operation
export async function createBatchOperation(data: {
  userId: number;
  accountId?: number;
  operationType: 'negative_keyword' | 'bid_adjustment' | 'keyword_migration' | 'campaign_status';
  name: string;
  description?: string;
  requiresApproval?: boolean;
  sourceType?: string;
  sourceTaskId?: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(batchOperations).values({
    userId: data.userId,
    accountId: data.accountId || null,
    operationType: data.operationType,
    name: data.name,
    description: data.description || null,
    requiresApproval: data.requiresApproval ?? true,
    sourceType: data.sourceType || null,
    sourceTaskId: data.sourceTaskId || null,
    status: 'pending',
    totalItems: 0,
    processedItems: 0,
    successItems: 0,
    failedItems: 0,
  });
  
  return result[0].insertId;
}

// Add items to a batch operation
export async function addBatchOperationItems(batchId: number, items: Array<{
  entityType: 'keyword' | 'product_target' | 'campaign' | 'ad_group';
  entityId: number;
  entityName?: string;
  negativeKeyword?: string;
  negativeMatchType?: 'negative_phrase' | 'negative_exact';
  negativeLevel?: 'ad_group' | 'campaign';
  currentBid?: number;
  newBid?: number;
  bidChangeReason?: string;
  previousValue?: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Insert items
  for (const item of items) {
    const bidChangePercent = item.currentBid && item.newBid 
      ? ((item.newBid - item.currentBid) / item.currentBid * 100)
      : null;
      
    await db.insert(batchOperationItems).values({
      batchId,
      entityType: item.entityType,
      entityId: item.entityId,
      entityName: item.entityName || null,
      negativeKeyword: item.negativeKeyword || null,
      negativeMatchType: item.negativeMatchType || null,
      negativeLevel: item.negativeLevel || null,
      currentBid: item.currentBid?.toString() || null,
      newBid: item.newBid?.toString() || null,
      bidChangePercent: bidChangePercent?.toFixed(2) || null,
      bidChangeReason: item.bidChangeReason || null,
      previousValue: item.previousValue || null,
      status: 'pending',
    });
  }
  
  // Update total count
  await db.update(batchOperations)
    .set({ totalItems: items.length })
    .where(eq(batchOperations.id, batchId));
}

// Get batch operation by ID
export async function getBatchOperation(id: number): Promise<BatchOperation | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(batchOperations)
    .where(eq(batchOperations.id, id))
    .limit(1);
  
  return result[0] || null;
}

// Get batch operation items
export async function getBatchOperationItems(batchId: number): Promise<BatchOperationItem[]> {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(batchOperationItems)
    .where(eq(batchOperationItems.batchId, batchId));
}

// List batch operations for a user
export async function listBatchOperations(userId: number, options?: {
  accountId?: number;
  status?: string;
  operationType?: string;
  limit?: number;
  offset?: number;
}): Promise<BatchOperation[]> {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select()
    .from(batchOperations)
    .where(eq(batchOperations.userId, userId))
    .orderBy(desc(batchOperations.createdAt))
    .limit(options?.limit || 50);
  
  return await query;
}

// Approve batch operation
export async function approveBatchOperation(id: number, approvedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(batchOperations)
    .set({
      status: 'approved',
      approvedBy,
      approvedAt: new Date(),
    })
    .where(eq(batchOperations.id, id));
}

// Update batch operation status
export async function updateBatchOperationStatus(id: number, data: {
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';
  processedItems?: number;
  successItems?: number;
  failedItems?: number;
  executedBy?: number;
  executedAt?: Date;
  completedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: Record<string, unknown> = { status: data.status };
  if (data.processedItems !== undefined) updateData.processedItems = data.processedItems;
  if (data.successItems !== undefined) updateData.successItems = data.successItems;
  if (data.failedItems !== undefined) updateData.failedItems = data.failedItems;
  if (data.executedBy !== undefined) updateData.executedBy = data.executedBy;
  if (data.executedAt !== undefined) updateData.executedAt = data.executedAt;
  if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;
  
  await db.update(batchOperations)
    .set(updateData)
    .where(eq(batchOperations.id, id));
}

// Update batch operation item status
export async function updateBatchOperationItemStatus(itemId: number, data: {
  status: 'pending' | 'success' | 'failed' | 'skipped' | 'rolled_back';
  errorMessage?: string;
  executedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(batchOperationItems)
    .set({
      status: data.status,
      errorMessage: data.errorMessage || null,
      executedAt: data.executedAt || new Date(),
    })
    .where(eq(batchOperationItems.id, itemId));
}

// Rollback batch operation
export async function rollbackBatchOperation(id: number, rolledBackBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(batchOperations)
    .set({
      status: 'rolled_back',
      rolledBackBy,
      rolledBackAt: new Date(),
    })
    .where(eq(batchOperations.id, id));
}

// ==================== Attribution Correction Functions ====================

// Create correction review session
export async function createCorrectionReviewSession(data: {
  userId: number;
  accountId: number;
  periodStart: Date;
  periodEnd: Date;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(correctionReviewSessions).values({
    userId: data.userId,
    accountId: data.accountId,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    status: 'analyzing',
    totalAdjustmentsReviewed: 0,
    incorrectAdjustments: 0,
    overDecreasedCount: 0,
    overIncreasedCount: 0,
    correctCount: 0,
  });
  
  return result[0].insertId;
}

// Add attribution correction record
export async function addAttributionCorrectionRecord(data: {
  userId: number;
  accountId: number;
  biddingLogId: number;
  campaignId: number;
  targetType: 'keyword' | 'product_target';
  targetId: number;
  targetName?: string;
  originalAdjustmentDate: Date;
  originalBid: number;
  adjustedBid: number;
  adjustmentReason?: string;
  metricsAtAdjustment?: Record<string, unknown>;
  metricsAfterAttribution?: Record<string, unknown>;
  wasIncorrect?: boolean;
  correctionType?: 'over_decreased' | 'over_increased' | 'correct';
  suggestedBid?: number;
  confidenceScore?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(attributionCorrectionRecords).values({
    userId: data.userId,
    accountId: data.accountId,
    biddingLogId: data.biddingLogId,
    campaignId: data.campaignId,
    targetType: data.targetType,
    targetId: data.targetId,
    targetName: data.targetName || null,
    originalAdjustmentDate: data.originalAdjustmentDate,
    originalBid: data.originalBid.toString(),
    adjustedBid: data.adjustedBid.toString(),
    adjustmentReason: data.adjustmentReason || null,
    metricsAtAdjustment: data.metricsAtAdjustment ? JSON.stringify(data.metricsAtAdjustment) : null,
    metricsAfterAttribution: data.metricsAfterAttribution ? JSON.stringify(data.metricsAfterAttribution) : null,
    wasIncorrect: data.wasIncorrect ?? false,
    correctionType: data.correctionType || null,
    suggestedBid: data.suggestedBid?.toString() || null,
    confidenceScore: data.confidenceScore?.toString() || null,
    status: 'pending_review',
  });
}

// Get correction review session
export async function getCorrectionReviewSession(id: number): Promise<CorrectionReviewSession | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(correctionReviewSessions)
    .where(eq(correctionReviewSessions.id, id))
    .limit(1);
  
  return result[0] || null;
}

// List correction review sessions
export async function listCorrectionReviewSessions(userId: number, accountId?: number): Promise<CorrectionReviewSession[]> {
  const db = await getDb();
  if (!db) return [];
  
  let conditions = [eq(correctionReviewSessions.userId, userId)];
  if (accountId) {
    conditions.push(eq(correctionReviewSessions.accountId, accountId));
  }
  
  return await db.select()
    .from(correctionReviewSessions)
    .where(and(...conditions))
    .orderBy(desc(correctionReviewSessions.createdAt))
    .limit(50);
}

// Get correction records for a session
export async function getCorrectionRecordsForSession(sessionId: number): Promise<AttributionCorrectionRecord[]> {
  const db = await getDb();
  if (!db) return [];
  
  // Get session to find the period
  const session = await getCorrectionReviewSession(sessionId);
  if (!session) return [];
  
  return await db.select()
    .from(attributionCorrectionRecords)
    .where(and(
      eq(attributionCorrectionRecords.userId, session.userId),
      eq(attributionCorrectionRecords.accountId, session.accountId)
    ))
    .orderBy(desc(attributionCorrectionRecords.originalAdjustmentDate));
}

// Update correction review session
export async function updateCorrectionReviewSession(id: number, data: {
  status?: 'analyzing' | 'ready_for_review' | 'reviewed' | 'corrections_applied';
  totalAdjustmentsReviewed?: number;
  incorrectAdjustments?: number;
  overDecreasedCount?: number;
  overIncreasedCount?: number;
  correctCount?: number;
  estimatedLostRevenue?: number;
  estimatedWastedSpend?: number;
  potentialRecovery?: number;
  reviewedAt?: Date;
  reviewedBy?: number;
  correctionBatchId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: Record<string, unknown> = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.totalAdjustmentsReviewed !== undefined) updateData.totalAdjustmentsReviewed = data.totalAdjustmentsReviewed;
  if (data.incorrectAdjustments !== undefined) updateData.incorrectAdjustments = data.incorrectAdjustments;
  if (data.overDecreasedCount !== undefined) updateData.overDecreasedCount = data.overDecreasedCount;
  if (data.overIncreasedCount !== undefined) updateData.overIncreasedCount = data.overIncreasedCount;
  if (data.correctCount !== undefined) updateData.correctCount = data.correctCount;
  if (data.estimatedLostRevenue !== undefined) updateData.estimatedLostRevenue = data.estimatedLostRevenue.toString();
  if (data.estimatedWastedSpend !== undefined) updateData.estimatedWastedSpend = data.estimatedWastedSpend.toString();
  if (data.potentialRecovery !== undefined) updateData.potentialRecovery = data.potentialRecovery.toString();
  if (data.reviewedAt !== undefined) updateData.reviewedAt = data.reviewedAt;
  if (data.reviewedBy !== undefined) updateData.reviewedBy = data.reviewedBy;
  if (data.correctionBatchId !== undefined) updateData.correctionBatchId = data.correctionBatchId;
  
  await db.update(correctionReviewSessions)
    .set(updateData)
    .where(eq(correctionReviewSessions.id, id));
}

// Update attribution correction record status
export async function updateAttributionCorrectionStatus(id: number, data: {
  status: 'pending_review' | 'approved' | 'applied' | 'dismissed';
  appliedAt?: Date;
  appliedBy?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(attributionCorrectionRecords)
    .set({
      status: data.status,
      appliedAt: data.appliedAt || null,
      appliedBy: data.appliedBy || null,
    })
    .where(eq(attributionCorrectionRecords.id, id));
}


// ==================== Team Member Functions ====================

export async function createTeamMember(data: InsertTeamMember): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(teamMembers).values(data);
  const insertId = result[0].insertId;
  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, insertId));
  return member || null;
}

export async function getTeamMembersByOwner(ownerId: number): Promise<TeamMember[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(teamMembers)
    .where(eq(teamMembers.ownerId, ownerId))
    .orderBy(desc(teamMembers.createdAt));
}

export async function getTeamMemberById(id: number): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
  return member || null;
}

export async function getTeamMemberByToken(token: string): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [member] = await db.select().from(teamMembers)
    .where(eq(teamMembers.inviteToken, token));
  return member || null;
}

export async function getTeamMemberByEmail(ownerId: number, email: string): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [member] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.email, email)));
  return member || null;
}

export async function updateTeamMember(id: number, data: Partial<InsertTeamMember>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(teamMembers).set(data).where(eq(teamMembers.id, id));
  return true;
}

export async function deleteTeamMember(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  // 同时删除该成员的所有权限
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, id));
  await db.delete(teamMembers).where(eq(teamMembers.id, id));
  return true;
}

export async function getTeamMembershipsForUser(userId: number): Promise<TeamMember[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(teamMembers)
    .where(and(eq(teamMembers.memberId, userId), eq(teamMembers.status, "active")));
}

// ==================== Account Permission Functions ====================

export async function createAccountPermission(data: InsertAccountPermission): Promise<AccountPermission | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(accountPermissions).values(data);
  const insertId = result[0].insertId;
  const [permission] = await db.select().from(accountPermissions).where(eq(accountPermissions.id, insertId));
  return permission || null;
}

export async function getPermissionsByTeamMember(teamMemberId: number): Promise<AccountPermission[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(accountPermissions)
    .where(eq(accountPermissions.teamMemberId, teamMemberId));
}

export async function getPermissionsByAccount(accountId: number): Promise<AccountPermission[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(accountPermissions)
    .where(eq(accountPermissions.accountId, accountId));
}

export async function getPermission(teamMemberId: number, accountId: number): Promise<AccountPermission | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [permission] = await db.select().from(accountPermissions)
    .where(and(
      eq(accountPermissions.teamMemberId, teamMemberId),
      eq(accountPermissions.accountId, accountId)
    ));
  return permission || null;
}

export async function updateAccountPermission(id: number, data: Partial<InsertAccountPermission>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(accountPermissions).set(data).where(eq(accountPermissions.id, id));
  return true;
}

export async function deleteAccountPermission(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(accountPermissions).where(eq(accountPermissions.id, id));
  return true;
}

export async function deletePermissionsByTeamMember(teamMemberId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, teamMemberId));
  return true;
}

export async function setAccountPermissions(teamMemberId: number, permissions: Array<{ accountId: number; permissionLevel: "full" | "edit" | "view"; canExport?: boolean; canManageCampaigns?: boolean; canAdjustBids?: boolean; canManageNegatives?: boolean }>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  // 删除现有权限
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, teamMemberId));
  
  // 添加新权限
  if (permissions.length > 0) {
    await db.insert(accountPermissions).values(
      permissions.map(p => ({
        teamMemberId,
        accountId: p.accountId,
        permissionLevel: p.permissionLevel,
        canExport: p.canExport ?? true,
        canManageCampaigns: p.canManageCampaigns ?? (p.permissionLevel !== "view"),
        canAdjustBids: p.canAdjustBids ?? (p.permissionLevel !== "view"),
        canManageNegatives: p.canManageNegatives ?? (p.permissionLevel !== "view"),
      }))
    );
  }
  
  return true;
}

// ==================== Email Report Subscription Functions ====================

export async function createEmailSubscription(data: InsertEmailReportSubscription): Promise<EmailReportSubscription | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(emailReportSubscriptions).values(data);
  const insertId = result[0].insertId;
  const [subscription] = await db.select().from(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, insertId));
  return subscription || null;
}

export async function getEmailSubscriptionsByUser(userId: number): Promise<EmailReportSubscription[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailReportSubscriptions)
    .where(eq(emailReportSubscriptions.userId, userId))
    .orderBy(desc(emailReportSubscriptions.createdAt));
}

export async function getEmailSubscriptionById(id: number): Promise<EmailReportSubscription | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [subscription] = await db.select().from(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, id));
  return subscription || null;
}

export async function getActiveEmailSubscriptions(): Promise<EmailReportSubscription[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailReportSubscriptions)
    .where(eq(emailReportSubscriptions.isActive, true));
}

export async function getDueEmailSubscriptions(): Promise<EmailReportSubscription[]> {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  return db.select().from(emailReportSubscriptions)
    .where(and(
      eq(emailReportSubscriptions.isActive, true),
      lte(emailReportSubscriptions.nextSendAt, now)
    ));
}

export async function updateEmailSubscription(id: number, data: Partial<InsertEmailReportSubscription>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(emailReportSubscriptions).set(data).where(eq(emailReportSubscriptions.id, id));
  return true;
}

export async function deleteEmailSubscription(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, id));
  return true;
}

// ==================== Email Send Log Functions ====================

export async function createEmailSendLog(data: InsertEmailSendLog): Promise<EmailSendLog | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(emailSendLogs).values(data);
  const insertId = result[0].insertId;
  const [log] = await db.select().from(emailSendLogs).where(eq(emailSendLogs.id, insertId));
  return log || null;
}

export async function getEmailSendLogsBySubscription(subscriptionId: number, limit = 20): Promise<EmailSendLog[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailSendLogs)
    .where(eq(emailSendLogs.subscriptionId, subscriptionId))
    .orderBy(desc(emailSendLogs.sentAt))
    .limit(limit);
}

export async function getRecentEmailSendLogs(userId: number, limit = 50): Promise<EmailSendLog[]> {
  const db = await getDb();
  if (!db) return [];
  
  // 获取用户的所有订阅ID
  const subscriptions = await db.select({ id: emailReportSubscriptions.id })
    .from(emailReportSubscriptions)
    .where(eq(emailReportSubscriptions.userId, userId));
  
  if (subscriptions.length === 0) return [];
  
  const subscriptionIds = subscriptions.map(s => s.id);
  
  return db.select().from(emailSendLogs)
    .where(sql`${emailSendLogs.subscriptionId} IN (${sql.join(subscriptionIds.map(id => sql`${id}`), sql`, `)})`)
    .orderBy(desc(emailSendLogs.sentAt))
    .limit(limit);
}


// ==================== Search Terms Functions ====================
export async function getSearchTermsByCampaignId(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(searchTerms).where(eq(searchTerms.campaignId, campaignId));
}

export async function getSearchTermsByAdGroupId(adGroupId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(searchTerms).where(eq(searchTerms.adGroupId, adGroupId));
}

export async function createSearchTerm(data: InsertSearchTerm) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(searchTerms).values(data);
  return result[0].insertId;
}

export async function bulkCreateSearchTerms(data: InsertSearchTerm[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (data.length === 0) return;
  await db.insert(searchTerms).values(data);
}

// ==================== Campaign Detail Functions ====================
export async function getCampaignDetailWithStats(campaignId: number) {
  const db = await getDb();
  if (!db) return null;
  
  // 获取广告活动基本信息
  const campaign = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign[0]) return null;
  
  // 获取广告组列表
  const adGroupList = await db.select().from(adGroups).where(eq(adGroups.campaignId, campaignId));
  
  // 获取广告组ID列表
  const adGroupIds = adGroupList.map(ag => ag.id);
  
  // 获取所有关键词
  let keywordList: Keyword[] = [];
  if (adGroupIds.length > 0) {
    keywordList = await db.select().from(keywords)
      .where(sql`${keywords.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  }
  
  // 获取所有商品定向
  let productTargetList: ProductTarget[] = [];
  if (adGroupIds.length > 0) {
    productTargetList = await db.select().from(productTargets)
      .where(sql`${productTargets.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  }
  
  // 获取搜索词报告
  const searchTermList = await db.select().from(searchTerms).where(eq(searchTerms.campaignId, campaignId));
  
  return {
    campaign: campaign[0],
    adGroups: adGroupList,
    keywords: keywordList,
    productTargets: productTargetList,
    searchTerms: searchTermList,
  };
}

// 获取广告活动的广告位表现数据
export async function getCampaignPlacementStats(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const campaign = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign[0]) return [];
  
  // 返回广告位数据（从campaigns表的placement字段获取）
  const placementData = [
    {
      placement: "top_of_search",
      placementLabel: "搜索结果顶部",
      bidAdjustment: campaign[0].placementTopSearchBidAdjustment || 0,
      // 模拟数据，实际应从daily_performance或专门的placement表获取
      impressions: Math.floor((campaign[0].impressions || 0) * 0.3),
      clicks: Math.floor((campaign[0].clicks || 0) * 0.35),
      spend: parseFloat(campaign[0].spend || "0") * 0.35,
      sales: parseFloat(campaign[0].sales || "0") * 0.4,
      orders: Math.floor((campaign[0].orders || 0) * 0.4),
    },
    {
      placement: "product_page",
      placementLabel: "商品页面",
      bidAdjustment: campaign[0].placementProductPageBidAdjustment || 0,
      impressions: Math.floor((campaign[0].impressions || 0) * 0.5),
      clicks: Math.floor((campaign[0].clicks || 0) * 0.45),
      spend: parseFloat(campaign[0].spend || "0") * 0.45,
      sales: parseFloat(campaign[0].sales || "0") * 0.4,
      orders: Math.floor((campaign[0].orders || 0) * 0.4),
    },
    {
      placement: "rest_of_search",
      placementLabel: "搜索结果其他位置",
      bidAdjustment: campaign[0].placementRestBidAdjustment || 0,
      impressions: Math.floor((campaign[0].impressions || 0) * 0.2),
      clicks: Math.floor((campaign[0].clicks || 0) * 0.2),
      spend: parseFloat(campaign[0].spend || "0") * 0.2,
      sales: parseFloat(campaign[0].sales || "0") * 0.2,
      orders: Math.floor((campaign[0].orders || 0) * 0.2),
    },
  ];
  
  return placementData;
}

// 获取广告活动下所有投放词（关键词+商品定向）
export async function getCampaignTargets(campaignId: number) {
  const db = await getDb();
  if (!db) return { keywords: [], productTargets: [] };
  
  // 获取广告组ID列表
  const adGroupList = await db.select({ id: adGroups.id, adGroupName: adGroups.adGroupName })
    .from(adGroups)
    .where(eq(adGroups.campaignId, campaignId));
  
  if (adGroupList.length === 0) {
    return { keywords: [], productTargets: [] };
  }
  
  const adGroupIds = adGroupList.map(ag => ag.id);
  const adGroupMap = new Map(adGroupList.map(ag => [ag.id, ag.adGroupName]));
  
  // 获取所有关键词
  const keywordList = await db.select().from(keywords)
    .where(sql`${keywords.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  
  // 获取所有商品定向
  const productTargetList = await db.select().from(productTargets)
    .where(sql`${productTargets.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  
  // 添加广告组名称
  const keywordsWithAdGroup = keywordList.map(k => ({
    ...k,
    adGroupName: adGroupMap.get(k.adGroupId) || "未知广告组"
  }));
  
  const productTargetsWithAdGroup = productTargetList.map(pt => ({
    ...pt,
    adGroupName: adGroupMap.get(pt.adGroupId) || "未知广告组"
  }));
  
  return {
    keywords: keywordsWithAdGroup,
    productTargets: productTargetsWithAdGroup
  };
}


// ==================== AI Optimization Execution Functions ====================

// 创建AI优化执行记录
export async function createAiOptimizationExecution(data: InsertAiOptimizationExecution): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationExecutions).values(data);
  return result[0].insertId;
}

// 获取AI优化执行记录
export async function getAiOptimizationExecution(id: number): Promise<AiOptimizationExecution | null> {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(aiOptimizationExecutions).where(eq(aiOptimizationExecutions.id, id));
  return results[0] || null;
}

// 获取广告活动的AI优化执行历史
export async function getAiOptimizationExecutionsByCampaign(campaignId: number, limit: number = 50): Promise<AiOptimizationExecution[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationExecutions)
    .where(eq(aiOptimizationExecutions.campaignId, campaignId))
    .orderBy(desc(aiOptimizationExecutions.executedAt))
    .limit(limit);
}

// 获取账号的AI优化执行历史
export async function getAiOptimizationExecutionsByAccount(accountId: number, limit: number = 100): Promise<AiOptimizationExecution[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationExecutions)
    .where(eq(aiOptimizationExecutions.accountId, accountId))
    .orderBy(desc(aiOptimizationExecutions.executedAt))
    .limit(limit);
}

// 更新AI优化执行状态
export async function updateAiOptimizationExecution(id: number, data: Partial<InsertAiOptimizationExecution>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.update(aiOptimizationExecutions).set(data).where(eq(aiOptimizationExecutions.id, id));
}

// 创建AI优化操作记录
export async function createAiOptimizationAction(data: InsertAiOptimizationAction): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationActions).values(data);
  return result[0].insertId;
}

// 批量创建AI优化操作记录
export async function createAiOptimizationActions(dataList: InsertAiOptimizationAction[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  if (dataList.length > 0) {
    await db.insert(aiOptimizationActions).values(dataList);
  }
}

// 获取执行的所有操作
export async function getAiOptimizationActionsByExecution(executionId: number): Promise<AiOptimizationAction[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationActions)
    .where(eq(aiOptimizationActions.executionId, executionId))
    .orderBy(aiOptimizationActions.id);
}

// 更新AI优化操作状态
export async function updateAiOptimizationAction(id: number, data: Partial<InsertAiOptimizationAction>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.update(aiOptimizationActions).set(data).where(eq(aiOptimizationActions.id, id));
}

// 创建AI优化效果预测
export async function createAiOptimizationPrediction(data: InsertAiOptimizationPrediction): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationPredictions).values(data);
  return result[0].insertId;
}

// 批量创建AI优化效果预测
export async function createAiOptimizationPredictions(dataList: InsertAiOptimizationPrediction[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  if (dataList.length > 0) {
    await db.insert(aiOptimizationPredictions).values(dataList);
  }
}

// 获取执行的所有预测
export async function getAiOptimizationPredictionsByExecution(executionId: number): Promise<AiOptimizationPrediction[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationPredictions)
    .where(eq(aiOptimizationPredictions.executionId, executionId));
}

// 创建AI优化复盘记录
export async function createAiOptimizationReview(data: InsertAiOptimizationReview): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationReviews).values(data);
  return result[0].insertId;
}

// 获取执行的所有复盘记录
export async function getAiOptimizationReviewsByExecution(executionId: number): Promise<AiOptimizationReview[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationReviews)
    .where(eq(aiOptimizationReviews.executionId, executionId));
}

// 获取待复盘的记录
export async function getPendingAiOptimizationReviews(): Promise<AiOptimizationReview[]> {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  return db.select().from(aiOptimizationReviews)
    .where(and(
      eq(aiOptimizationReviews.status, "pending"),
      lte(aiOptimizationReviews.scheduledAt, now)
    ))
    .orderBy(aiOptimizationReviews.scheduledAt);
}

// 更新AI优化复盘记录
export async function updateAiOptimizationReview(id: number, data: Partial<InsertAiOptimizationReview>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.update(aiOptimizationReviews).set(data).where(eq(aiOptimizationReviews.id, id));
}

// 获取AI优化执行详情（包含操作、预测、复盘）
export async function getAiOptimizationExecutionDetail(executionId: number) {
  const execution = await getAiOptimizationExecution(executionId);
  if (!execution) return null;
  
  const [actions, predictions, reviews] = await Promise.all([
    getAiOptimizationActionsByExecution(executionId),
    getAiOptimizationPredictionsByExecution(executionId),
    getAiOptimizationReviewsByExecution(executionId)
  ]);
  
  return {
    execution,
    actions,
    predictions,
    reviews
  };
}
