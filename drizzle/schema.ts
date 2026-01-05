import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Amazon Advertising Accounts
 */
export const adAccounts = mysqlTable("ad_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: varchar("accountId", { length: 64 }).notNull(),
  accountName: varchar("accountName", { length: 255 }).notNull(),
  marketplace: varchar("marketplace", { length: 32 }).notNull(), // US, DE, UK, JP, etc.
  profileId: varchar("profileId", { length: 64 }),
  // Account-level optimization settings
  conversionValueType: mysqlEnum("conversionValueType", ["sales", "units", "custom"]).default("sales"),
  conversionValueSource: mysqlEnum("conversionValueSource", ["platform", "custom"]).default("platform"),
  intradayBiddingEnabled: boolean("intradayBiddingEnabled").default(true),
  defaultMaxBid: decimal("defaultMaxBid", { precision: 10, scale: 2 }).default("2.00"),
  status: mysqlEnum("status", ["active", "paused", "archived"]).default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdAccount = typeof adAccounts.$inferSelect;
export type InsertAdAccount = typeof adAccounts.$inferInsert;

/**
 * Performance Groups - Group campaigns for unified optimization
 */
export const performanceGroups = mysqlTable("performance_groups", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Optimization target settings
  optimizationGoal: mysqlEnum("optimizationGoal", [
    "maximize_sales",      // 销售最大化
    "target_acos",         // 目标ACoS
    "target_roas",         // 目标ROAS
    "daily_spend_limit",   // 每日花费上限
    "daily_cost"           // 天成本
  ]).default("maximize_sales"),
  targetAcos: decimal("targetAcos", { precision: 5, scale: 2 }),      // e.g., 25.00%
  targetRoas: decimal("targetRoas", { precision: 10, scale: 2 }),     // e.g., 4.00
  dailySpendLimit: decimal("dailySpendLimit", { precision: 10, scale: 2 }),
  dailyCostTarget: decimal("dailyCostTarget", { precision: 10, scale: 2 }),
  // Performance metrics (cached)
  currentAcos: decimal("currentAcos", { precision: 5, scale: 2 }),
  currentRoas: decimal("currentRoas", { precision: 10, scale: 2 }),
  currentDailySpend: decimal("currentDailySpend", { precision: 10, scale: 2 }),
  currentDailySales: decimal("currentDailySales", { precision: 10, scale: 2 }),
  conversionsPerDay: decimal("conversionsPerDay", { precision: 10, scale: 2 }),
  status: mysqlEnum("status", ["active", "paused", "archived"]).default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PerformanceGroup = typeof performanceGroups.$inferSelect;
export type InsertPerformanceGroup = typeof performanceGroups.$inferInsert;

/**
 * Campaigns - Amazon advertising campaigns
 */
export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  performanceGroupId: int("performanceGroupId"),
  campaignId: varchar("campaignId", { length: 64 }).notNull(),
  campaignName: varchar("campaignName", { length: 500 }).notNull(),
  campaignType: mysqlEnum("campaignType", [
    "sp_auto",    // Sponsored Products Auto
    "sp_manual",  // Sponsored Products Manual
    "sb",         // Sponsored Brands
    "sd"          // Sponsored Display
  ]).notNull(),
  targetingType: mysqlEnum("targetingType", ["auto", "manual"]).default("manual"),
  // Campaign-level settings
  maxBid: decimal("maxBid", { precision: 10, scale: 2 }),
  intradayBiddingEnabled: boolean("intradayBiddingEnabled"),
  conversionValueType: mysqlEnum("campaignConversionValueType", ["sales", "units", "custom", "inherit"]).default("inherit"),
  conversionValueSource: mysqlEnum("campaignConversionValueSource", ["platform", "custom", "inherit"]).default("inherit"),
  // Placement bid adjustments
  placementTopSearchBidAdjustment: int("placementTopSearchBidAdjustment").default(0), // percentage
  placementProductPageBidAdjustment: int("placementProductPageBidAdjustment").default(0),
  placementRestBidAdjustment: int("placementRestBidAdjustment").default(0),
  // Performance metrics (cached)
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  spend: decimal("spend", { precision: 10, scale: 2 }).default("0.00"),
  sales: decimal("sales", { precision: 10, scale: 2 }).default("0.00"),
  orders: int("orders").default(0),
  acos: decimal("acos", { precision: 5, scale: 2 }),
  roas: decimal("roas", { precision: 10, scale: 2 }),
  ctr: decimal("ctr", { precision: 5, scale: 4 }),
  cvr: decimal("cvr", { precision: 5, scale: 4 }),
  cpc: decimal("cpc", { precision: 10, scale: 2 }),
  status: mysqlEnum("campaignStatus", ["enabled", "paused", "archived"]).default("enabled"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;

/**
 * Ad Groups
 */
export const adGroups = mysqlTable("ad_groups", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  adGroupId: varchar("adGroupId", { length: 64 }).notNull(),
  adGroupName: varchar("adGroupName", { length: 500 }).notNull(),
  defaultBid: decimal("defaultBid", { precision: 10, scale: 2 }),
  // Performance metrics
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  spend: decimal("spend", { precision: 10, scale: 2 }).default("0.00"),
  sales: decimal("sales", { precision: 10, scale: 2 }).default("0.00"),
  orders: int("orders").default(0),
  status: mysqlEnum("adGroupStatus", ["enabled", "paused", "archived"]).default("enabled"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdGroup = typeof adGroups.$inferSelect;
export type InsertAdGroup = typeof adGroups.$inferInsert;

/**
 * Keywords - Keyword targeting for manual campaigns
 */
export const keywords = mysqlTable("keywords", {
  id: int("id").autoincrement().primaryKey(),
  adGroupId: int("adGroupId").notNull(),
  keywordId: varchar("keywordId", { length: 64 }),
  keywordText: varchar("keywordText", { length: 500 }).notNull(),
  matchType: mysqlEnum("matchType", ["broad", "phrase", "exact"]).notNull(),
  bid: decimal("bid", { precision: 10, scale: 2 }).notNull(),
  suggestedBid: decimal("suggestedBid", { precision: 10, scale: 2 }),
  // Performance metrics
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  spend: decimal("spend", { precision: 10, scale: 2 }).default("0.00"),
  sales: decimal("sales", { precision: 10, scale: 2 }).default("0.00"),
  orders: int("orders").default(0),
  acos: decimal("keywordAcos", { precision: 5, scale: 2 }),
  ctr: decimal("keywordCtr", { precision: 5, scale: 4 }),
  cvr: decimal("keywordCvr", { precision: 5, scale: 4 }),
  // Market curve modeling data
  estimatedTraffic: int("estimatedTraffic"),
  trafficCeiling: int("trafficCeiling"),
  optimalBid: decimal("optimalBid", { precision: 10, scale: 2 }),
  marginalRevenue: decimal("marginalRevenue", { precision: 10, scale: 2 }),
  marginalCost: decimal("marginalCost", { precision: 10, scale: 2 }),
  status: mysqlEnum("keywordStatus", ["enabled", "paused", "archived"]).default("enabled"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Keyword = typeof keywords.$inferSelect;
export type InsertKeyword = typeof keywords.$inferInsert;

/**
 * Product Targets - ASIN targeting
 */
export const productTargets = mysqlTable("product_targets", {
  id: int("id").autoincrement().primaryKey(),
  adGroupId: int("adGroupId").notNull(),
  targetId: varchar("targetId", { length: 64 }),
  targetType: mysqlEnum("targetType", ["asin", "category"]).notNull(),
  targetValue: varchar("targetValue", { length: 64 }).notNull(), // ASIN or category ID
  targetExpression: text("targetExpression"), // Full targeting expression
  bid: decimal("bid", { precision: 10, scale: 2 }).notNull(),
  suggestedBid: decimal("suggestedBid", { precision: 10, scale: 2 }),
  // Performance metrics
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  spend: decimal("spend", { precision: 10, scale: 2 }).default("0.00"),
  sales: decimal("sales", { precision: 10, scale: 2 }).default("0.00"),
  orders: int("orders").default(0),
  acos: decimal("targetAcos", { precision: 5, scale: 2 }),
  // Market curve modeling
  optimalBid: decimal("targetOptimalBid", { precision: 10, scale: 2 }),
  status: mysqlEnum("targetStatus", ["enabled", "paused", "archived"]).default("enabled"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductTarget = typeof productTargets.$inferSelect;
export type InsertProductTarget = typeof productTargets.$inferInsert;

/**
 * Bidding Logs - Record all bid adjustments
 */
export const biddingLogs = mysqlTable("bidding_logs", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  campaignId: int("campaignId").notNull(),
  adGroupId: int("adGroupId"),
  // Target reference (keyword or product target)
  targetType: mysqlEnum("logTargetType", ["keyword", "product_target", "placement"]).notNull(),
  targetId: int("targetId").notNull(),
  targetName: varchar("targetName", { length: 500 }),
  matchType: varchar("logMatchType", { length: 32 }),
  // Bid change details
  actionType: mysqlEnum("actionType", ["increase", "decrease", "set"]).notNull(),
  previousBid: decimal("previousBid", { precision: 10, scale: 2 }).notNull(),
  newBid: decimal("newBid", { precision: 10, scale: 2 }).notNull(),
  bidChangePercent: decimal("bidChangePercent", { precision: 5, scale: 2 }),
  // Reason and context
  reason: text("reason"),
  algorithmVersion: varchar("algorithmVersion", { length: 32 }),
  performanceData: json("performanceData"), // Snapshot of metrics at time of change
  isIntradayAdjustment: boolean("isIntradayAdjustment").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BiddingLog = typeof biddingLogs.$inferSelect;
export type InsertBiddingLog = typeof biddingLogs.$inferInsert;

/**
 * Daily Performance Snapshots - For trend analysis
 */
export const dailyPerformance = mysqlTable("daily_performance", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  campaignId: int("campaignId"),
  performanceGroupId: int("performanceGroupId"),
  date: timestamp("date").notNull(),
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  spend: decimal("spend", { precision: 10, scale: 2 }).default("0.00"),
  sales: decimal("sales", { precision: 10, scale: 2 }).default("0.00"),
  orders: int("orders").default(0),
  acos: decimal("dailyAcos", { precision: 5, scale: 2 }),
  roas: decimal("dailyRoas", { precision: 10, scale: 2 }),
  conversions: int("conversions").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DailyPerformance = typeof dailyPerformance.$inferSelect;
export type InsertDailyPerformance = typeof dailyPerformance.$inferInsert;

/**
 * Market Curve Data - For bid optimization modeling
 */
export const marketCurveData = mysqlTable("market_curve_data", {
  id: int("id").autoincrement().primaryKey(),
  targetType: mysqlEnum("curveTargetType", ["keyword", "product_target"]).notNull(),
  targetId: int("curveTargetId").notNull(),
  // Bid-Traffic-Conversion relationship data points
  bidLevel: decimal("bidLevel", { precision: 10, scale: 2 }).notNull(),
  estimatedImpressions: int("estimatedImpressions"),
  estimatedClicks: int("estimatedClicks"),
  estimatedConversions: decimal("estimatedConversions", { precision: 10, scale: 2 }),
  estimatedSpend: decimal("estimatedSpend", { precision: 10, scale: 2 }),
  estimatedSales: decimal("estimatedSales", { precision: 10, scale: 2 }),
  // Marginal analysis
  marginalRevenue: decimal("curveMarginalRevenue", { precision: 10, scale: 2 }),
  marginalCost: decimal("curveMarginalCost", { precision: 10, scale: 2 }),
  marginalProfit: decimal("marginalProfit", { precision: 10, scale: 2 }),
  // Curve characteristics
  trafficCeiling: int("curveTrafficCeiling"),
  optimalBidPoint: decimal("optimalBidPoint", { precision: 10, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MarketCurveData = typeof marketCurveData.$inferSelect;
export type InsertMarketCurveData = typeof marketCurveData.$inferInsert;

/**
 * Data Import Jobs - Track CSV/Excel imports
 */
export const importJobs = mysqlTable("import_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 1000 }),
  fileType: mysqlEnum("fileType", ["csv", "excel"]).notNull(),
  reportType: varchar("reportType", { length: 64 }), // campaign, keyword, search_term, etc.
  status: mysqlEnum("importStatus", ["pending", "processing", "completed", "failed"]).default("pending"),
  totalRows: int("totalRows"),
  processedRows: int("processedRows").default(0),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type ImportJob = typeof importJobs.$inferSelect;
export type InsertImportJob = typeof importJobs.$inferInsert;
