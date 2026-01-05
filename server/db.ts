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
  importJobs, InsertImportJob, ImportJob
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
  
  return db.select().from(adAccounts).where(eq(adAccounts.userId, userId));
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
