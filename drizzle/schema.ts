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
 * 支持多账号管理，每个用户可以添加多个亚马逊卖家店铺账号
 */
export const adAccounts = mysqlTable("ad_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // 基本信息
  accountId: varchar("accountId", { length: 64 }).notNull(), // Amazon广告账号ID
  accountName: varchar("accountName", { length: 255 }).notNull(), // 系统名称
  // 店铺自定义信息
  storeName: varchar("storeName", { length: 255 }), // 用户自定义店铺名称
  storeDescription: text("storeDescription"), // 店铺描述/备注
  storeColor: varchar("storeColor", { length: 7 }), // 店铺标识颜色 (#RRGGBB)
  // 市场信息
  marketplace: varchar("marketplace", { length: 32 }).notNull(), // US, DE, UK, JP, CA, MX, etc.
  marketplaceId: varchar("marketplaceId", { length: 32 }), // Amazon市场ID
  profileId: varchar("profileId", { length: 64 }), // Amazon广告Profile ID
  sellerId: varchar("sellerId", { length: 64 }), // Amazon卖家ID
  // 账号连接状态
  connectionStatus: mysqlEnum("connectionStatus", ["connected", "disconnected", "error", "pending"]).default("pending"),
  lastConnectionCheck: timestamp("lastConnectionCheck"),
  connectionErrorMessage: text("connectionErrorMessage"),
  // Account-level optimization settings
  conversionValueType: mysqlEnum("conversionValueType", ["sales", "units", "custom"]).default("sales"),
  conversionValueSource: mysqlEnum("conversionValueSource", ["platform", "custom"]).default("platform"),
  intradayBiddingEnabled: boolean("intradayBiddingEnabled").default(true),
  defaultMaxBid: decimal("defaultMaxBid", { precision: 10, scale: 2 }).default("2.00"),
  // 账号状态
  status: mysqlEnum("status", ["active", "paused", "archived"]).default("active"),
  isDefault: boolean("isDefault").default(false), // 是否为默认账号
  sortOrder: int("sortOrder").default(0), // 排序顺序
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


/**
 * Amazon API Credentials - Store OAuth tokens and API credentials
 */
export const amazonApiCredentials = mysqlTable("amazon_api_credentials", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull().unique(),
  clientId: varchar("clientId", { length: 255 }).notNull(),
  clientSecret: varchar("clientSecret", { length: 255 }).notNull(),
  refreshToken: text("refreshToken").notNull(),
  accessToken: text("accessToken"),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  profileId: varchar("profileId", { length: 64 }).notNull(),
  region: mysqlEnum("region", ["NA", "EU", "FE"]).default("NA").notNull(),
  lastSyncAt: timestamp("lastSyncAt"),
  syncStatus: mysqlEnum("syncStatus", ["idle", "syncing", "error"]).default("idle"),
  syncErrorMessage: text("syncErrorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AmazonApiCredential = typeof amazonApiCredentials.$inferSelect;
export type InsertAmazonApiCredential = typeof amazonApiCredentials.$inferInsert;


/**
 * Negative Keywords - 否定关键词
 * 支持广告组层级（关键词广告）和活动层级（产品定位广告）
 */
export const negativeKeywords = mysqlTable("negative_keywords", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  campaignId: int("campaignId").notNull(),
  adGroupId: int("adGroupId"), // null表示活动层级否定
  // 否定层级：campaign = 活动层级，ad_group = 广告组层级
  negativeLevel: mysqlEnum("negativeLevel", ["campaign", "ad_group"]).notNull(),
  // 否定类型
  negativeType: mysqlEnum("negativeType", ["keyword", "product"]).notNull(),
  // 否定词/ASIN
  negativeText: varchar("negativeText", { length: 500 }).notNull(),
  matchType: mysqlEnum("negativeMatchType", ["negative_exact", "negative_phrase"]).notNull(),
  // 来源信息
  source: mysqlEnum("negativeSource", ["manual", "ngram_analysis", "traffic_conflict", "funnel_migration"]).default("manual"),
  sourceReason: text("sourceReason"), // 自动生成的原因说明
  // 状态
  status: mysqlEnum("negativeStatus", ["active", "pending", "removed"]).default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NegativeKeyword = typeof negativeKeywords.$inferSelect;
export type InsertNegativeKeyword = typeof negativeKeywords.$inferInsert;

/**
 * Search Terms - 搜索词报告数据
 * 用于N-Gram分析、漏斗迁移和流量冲突检测
 */
export const searchTerms = mysqlTable("search_terms", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  campaignId: int("campaignId").notNull(),
  adGroupId: int("adGroupId").notNull(),
  // 搜索词信息
  searchTerm: varchar("searchTerm", { length: 500 }).notNull(),
  // 关联的投放词（关键词或ASIN）
  targetType: mysqlEnum("searchTermTargetType", ["keyword", "product_target"]).notNull(),
  targetId: int("searchTermTargetId"),
  targetText: varchar("targetText", { length: 500 }),
  matchType: varchar("searchTermMatchType", { length: 32 }),
  // 绩效数据
  impressions: int("searchTermImpressions").default(0),
  clicks: int("searchTermClicks").default(0),
  spend: decimal("searchTermSpend", { precision: 10, scale: 2 }).default("0.00"),
  sales: decimal("searchTermSales", { precision: 10, scale: 2 }).default("0.00"),
  orders: int("searchTermOrders").default(0),
  // 计算指标
  acos: decimal("searchTermAcos", { precision: 5, scale: 2 }),
  roas: decimal("searchTermRoas", { precision: 10, scale: 2 }),
  ctr: decimal("searchTermCtr", { precision: 5, scale: 4 }),
  cvr: decimal("searchTermCvr", { precision: 5, scale: 4 }),
  cpc: decimal("searchTermCpc", { precision: 10, scale: 2 }),
  // 报告日期范围
  reportStartDate: timestamp("reportStartDate"),
  reportEndDate: timestamp("reportEndDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SearchTerm = typeof searchTerms.$inferSelect;
export type InsertSearchTerm = typeof searchTerms.$inferInsert;


/**
 * Notification Settings - Configure alert thresholds and channels
 */
export const notificationSettings = mysqlTable("notification_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  // Notification channels
  emailEnabled: boolean("emailEnabled").default(true),
  inAppEnabled: boolean("inAppEnabled").default(true),
  // Alert thresholds
  acosThreshold: decimal("acosThreshold", { precision: 5, scale: 2 }).default("50.00"), // Alert when ACoS exceeds this
  ctrDropThreshold: decimal("ctrDropThreshold", { precision: 5, scale: 2 }).default("30.00"), // Alert when CTR drops by this %
  conversionDropThreshold: decimal("conversionDropThreshold", { precision: 5, scale: 2 }).default("30.00"), // Alert when conversion drops by this %
  spendSpikeThreshold: decimal("spendSpikeThreshold", { precision: 5, scale: 2 }).default("50.00"), // Alert when spend spikes by this %
  // Notification frequency
  frequency: mysqlEnum("frequency", ["immediate", "hourly", "daily", "weekly"]).default("daily"),
  quietHoursStart: int("quietHoursStart").default(22), // 10 PM
  quietHoursEnd: int("quietHoursEnd").default(8), // 8 AM
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NotificationSetting = typeof notificationSettings.$inferSelect;
export type InsertNotificationSetting = typeof notificationSettings.$inferInsert;

/**
 * Notification History - Log of sent notifications
 */
export const notificationHistory = mysqlTable("notification_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  type: mysqlEnum("type", ["alert", "report", "system"]).notNull(),
  severity: mysqlEnum("severity", ["info", "warning", "critical"]).default("info"),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  channel: mysqlEnum("channel", ["email", "in_app", "both"]).default("in_app"),
  status: mysqlEnum("status", ["pending", "sent", "failed", "read"]).default("pending"),
  relatedEntityType: varchar("relatedEntityType", { length: 64 }), // campaign, keyword, etc.
  relatedEntityId: int("relatedEntityId"),
  sentAt: timestamp("sentAt"),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type NotificationHistoryRecord = typeof notificationHistory.$inferSelect;
export type InsertNotificationHistory = typeof notificationHistory.$inferInsert;

/**
 * Scheduled Tasks - Configure automated optimization tasks
 */
export const scheduledTasks = mysqlTable("scheduled_tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  taskType: mysqlEnum("taskType", [
    "ngram_analysis",
    "funnel_migration",
    "traffic_conflict",
    "smart_bidding",
    "health_check",
    "data_sync"
  ]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Schedule configuration
  enabled: boolean("enabled").default(true),
  schedule: mysqlEnum("schedule", ["hourly", "daily", "weekly", "monthly"]).default("daily"),
  runTime: varchar("runTime", { length: 8 }).default("06:00"), // HH:MM format
  dayOfWeek: int("dayOfWeek"), // 0-6 for weekly tasks
  dayOfMonth: int("dayOfMonth"), // 1-31 for monthly tasks
  // Task parameters (JSON)
  parameters: text("parameters"), // JSON string with task-specific params
  // Execution tracking
  lastRunAt: timestamp("lastRunAt"),
  lastRunStatus: mysqlEnum("lastRunStatus", ["success", "failed", "running", "skipped"]),
  lastRunResult: text("lastRunResult"), // JSON string with results
  nextRunAt: timestamp("nextRunAt"),
  // Auto-apply settings
  autoApply: boolean("autoApply").default(false), // Automatically apply suggestions
  requireApproval: boolean("requireApproval").default(true), // Require user approval before applying
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type InsertScheduledTask = typeof scheduledTasks.$inferInsert;

/**
 * Task Execution Log - History of automated task runs
 */
export const taskExecutionLog = mysqlTable("task_execution_log", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  taskType: varchar("taskType", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["running", "success", "failed", "cancelled"]).notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  duration: int("duration"), // in seconds
  // Results
  itemsProcessed: int("itemsProcessed").default(0),
  suggestionsGenerated: int("suggestionsGenerated").default(0),
  suggestionsApplied: int("suggestionsApplied").default(0),
  errorMessage: text("errorMessage"),
  resultSummary: text("resultSummary"), // JSON string
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskExecutionLogRecord = typeof taskExecutionLog.$inferSelect;
export type InsertTaskExecutionLog = typeof taskExecutionLog.$inferInsert;


/**
 * Batch Operations - Track bulk operations for negative keywords and bid adjustments
 */
export const batchOperations = mysqlTable("batch_operations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  operationType: mysqlEnum("operationType", [
    "negative_keyword",
    "bid_adjustment",
    "keyword_migration",
    "campaign_status"
  ]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Operation status
  status: mysqlEnum("batchStatus", ["pending", "approved", "executing", "completed", "failed", "cancelled", "rolled_back"]).default("pending"),
  // Counts
  totalItems: int("totalItems").default(0),
  processedItems: int("processedItems").default(0),
  successItems: int("successItems").default(0),
  failedItems: int("failedItems").default(0),
  // Approval workflow
  requiresApproval: boolean("requiresApproval").default(true),
  approvedBy: int("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  // Execution tracking
  executedBy: int("executedBy"),
  executedAt: timestamp("executedAt"),
  completedAt: timestamp("completedAt"),
  // Rollback support
  canRollback: boolean("canRollback").default(true),
  rolledBackAt: timestamp("rolledBackAt"),
  rolledBackBy: int("rolledBackBy"),
  // Source info
  sourceType: varchar("sourceType", { length: 64 }), // ngram_analysis, funnel_migration, etc.
  sourceTaskId: int("sourceTaskId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BatchOperation = typeof batchOperations.$inferSelect;
export type InsertBatchOperation = typeof batchOperations.$inferInsert;

/**
 * Batch Operation Items - Individual items within a batch operation
 */
export const batchOperationItems = mysqlTable("batch_operation_items", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batchId").notNull(),
  // Target entity
  entityType: mysqlEnum("entityType", ["keyword", "product_target", "campaign", "ad_group"]).notNull(),
  entityId: int("entityId").notNull(),
  entityName: varchar("entityName", { length: 500 }),
  // For negative keywords
  negativeKeyword: varchar("negativeKeyword", { length: 500 }),
  negativeMatchType: mysqlEnum("negativeMatchType", ["negative_phrase", "negative_exact"]),
  negativeLevel: mysqlEnum("negativeLevel", ["ad_group", "campaign"]).default("ad_group"),
  // For bid adjustments
  currentBid: decimal("currentBid", { precision: 10, scale: 2 }),
  newBid: decimal("newBid", { precision: 10, scale: 2 }),
  bidChangePercent: decimal("bidChangePercent", { precision: 5, scale: 2 }),
  bidChangeReason: varchar("bidChangeReason", { length: 255 }),
  // Item status
  status: mysqlEnum("itemStatus", ["pending", "success", "failed", "skipped", "rolled_back"]).default("pending"),
  errorMessage: text("errorMessage"),
  // Rollback data
  previousValue: text("previousValue"), // JSON with original state
  executedAt: timestamp("itemExecutedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BatchOperationItem = typeof batchOperationItems.$inferSelect;
export type InsertBatchOperationItem = typeof batchOperationItems.$inferInsert;

/**
 * Attribution Correction Records - Track bid adjustments that may need correction due to attribution delay
 */
export const attributionCorrectionRecords = mysqlTable("attribution_correction_records", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId").notNull(),
  // Original bid adjustment reference
  biddingLogId: int("biddingLogId").notNull(),
  campaignId: int("campaignId").notNull(),
  targetType: mysqlEnum("correctionTargetType", ["keyword", "product_target"]).notNull(),
  targetId: int("targetId").notNull(),
  targetName: varchar("targetName", { length: 500 }),
  // Original adjustment details
  originalAdjustmentDate: timestamp("originalAdjustmentDate").notNull(),
  originalBid: decimal("originalBid", { precision: 10, scale: 2 }).notNull(),
  adjustedBid: decimal("adjustedBid", { precision: 10, scale: 2 }).notNull(),
  adjustmentReason: varchar("adjustmentReason", { length: 255 }),
  // Metrics at time of adjustment
  metricsAtAdjustment: text("metricsAtAdjustment"), // JSON: {acos, ctr, cvr, spend, sales}
  // Metrics after attribution window (14 days)
  metricsAfterAttribution: text("metricsAfterAttribution"), // JSON: {acos, ctr, cvr, spend, sales}
  // Correction analysis
  wasIncorrect: boolean("wasIncorrect").default(false),
  correctionType: mysqlEnum("correctionType", ["over_decreased", "over_increased", "correct"]),
  suggestedBid: decimal("suggestedBid", { precision: 10, scale: 2 }),
  confidenceScore: decimal("confidenceScore", { precision: 3, scale: 2 }), // 0.00 to 1.00
  // Correction status
  status: mysqlEnum("correctionStatus", ["pending_review", "approved", "applied", "dismissed"]).default("pending_review"),
  appliedAt: timestamp("appliedAt"),
  appliedBy: int("appliedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AttributionCorrectionRecord = typeof attributionCorrectionRecords.$inferSelect;
export type InsertAttributionCorrectionRecord = typeof attributionCorrectionRecords.$inferInsert;

/**
 * Correction Review Sessions - Group correction records for review
 */
export const correctionReviewSessions = mysqlTable("correction_review_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId").notNull(),
  // Review period
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  // Summary statistics
  totalAdjustmentsReviewed: int("totalAdjustmentsReviewed").default(0),
  incorrectAdjustments: int("incorrectAdjustments").default(0),
  overDecreasedCount: int("overDecreasedCount").default(0),
  overIncreasedCount: int("overIncreasedCount").default(0),
  correctCount: int("correctCount").default(0),
  // Impact analysis
  estimatedLostRevenue: decimal("estimatedLostRevenue", { precision: 10, scale: 2 }),
  estimatedWastedSpend: decimal("estimatedWastedSpend", { precision: 10, scale: 2 }),
  potentialRecovery: decimal("potentialRecovery", { precision: 10, scale: 2 }),
  // Session status
  status: mysqlEnum("sessionStatus", ["analyzing", "ready_for_review", "reviewed", "corrections_applied"]).default("analyzing"),
  reviewedAt: timestamp("reviewedAt"),
  reviewedBy: int("reviewedBy"),
  // Batch operation reference (if corrections were applied)
  correctionBatchId: int("correctionBatchId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CorrectionReviewSession = typeof correctionReviewSessions.$inferSelect;
export type InsertCorrectionReviewSession = typeof correctionReviewSessions.$inferInsert;


/**
 * Team Members - 团队成员管理
 * 支持邀请其他用户加入团队，共同管理广告账号
 */
export const teamMembers = mysqlTable("team_members", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(), // 团队所有者（邀请人）的用户ID
  memberId: int("memberId"), // 被邀请成员的用户ID（接受邀请后填充）
  email: varchar("email", { length: 320 }).notNull(), // 被邀请人邮箱
  name: varchar("name", { length: 255 }), // 成员名称
  role: mysqlEnum("role", ["admin", "editor", "viewer"]).default("viewer").notNull(),
  // admin: 可以管理所有设置和成员
  // editor: 可以编辑广告设置和数据
  // viewer: 只能查看数据
  status: mysqlEnum("status", ["pending", "active", "inactive", "revoked"]).default("pending").notNull(),
  inviteToken: varchar("inviteToken", { length: 64 }), // 邀请令牌
  inviteExpiresAt: timestamp("inviteExpiresAt"), // 邀请过期时间
  acceptedAt: timestamp("acceptedAt"), // 接受邀请时间
  lastActiveAt: timestamp("lastActiveAt"), // 最后活跃时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = typeof teamMembers.$inferInsert;

/**
 * Account Permissions - 账号访问权限
 * 定义团队成员对特定广告账号的访问权限
 */
export const accountPermissions = mysqlTable("account_permissions", {
  id: int("id").autoincrement().primaryKey(),
  teamMemberId: int("teamMemberId").notNull(), // 关联的团队成员
  accountId: int("accountId").notNull(), // 关联的广告账号
  permissionLevel: mysqlEnum("permissionLevel", ["full", "edit", "view"]).default("view").notNull(),
  // full: 完全控制（包括删除）
  // edit: 可以编辑设置和数据
  // view: 只能查看
  canExport: boolean("canExport").default(true), // 是否可以导出数据
  canManageCampaigns: boolean("canManageCampaigns").default(false), // 是否可以管理广告活动
  canAdjustBids: boolean("canAdjustBids").default(false), // 是否可以调整出价
  canManageNegatives: boolean("canManageNegatives").default(false), // 是否可以管理否定词
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AccountPermission = typeof accountPermissions.$inferSelect;
export type InsertAccountPermission = typeof accountPermissions.$inferInsert;

/**
 * Email Report Subscriptions - 邮件报表订阅
 * 配置定期发送的报表邮件
 */
export const emailReportSubscriptions = mysqlTable("email_report_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // 创建订阅的用户
  name: varchar("name", { length: 255 }).notNull(), // 订阅名称
  description: text("description"), // 订阅描述
  // 报表类型
  reportType: mysqlEnum("reportType", [
    "cross_account_summary",  // 跨账号汇总报表
    "account_performance",    // 单账号表现报表
    "campaign_performance",   // 广告活动表现报表
    "keyword_performance",    // 关键词表现报表
    "health_alert",           // 健康度告警报表
    "optimization_summary"    // 优化汇总报表
  ]).notNull(),
  // 推送频率
  frequency: mysqlEnum("frequency", ["daily", "weekly", "monthly"]).default("weekly").notNull(),
  // 推送时间设置
  sendTime: varchar("sendTime", { length: 5 }).default("09:00"), // HH:MM格式
  sendDayOfWeek: int("sendDayOfWeek"), // 0-6, 0=周日, 用于weekly
  sendDayOfMonth: int("sendDayOfMonth"), // 1-31, 用于monthly
  timezone: varchar("timezone", { length: 64 }).default("Asia/Shanghai"),
  // 收件人设置
  recipients: json("recipients").$type<string[]>(), // 收件人邮箱列表
  ccRecipients: json("ccRecipients").$type<string[]>(), // 抄送邮箱列表
  // 报表内容设置
  accountIds: json("accountIds").$type<number[]>(), // 包含的账号ID列表，空表示全部
  includeCharts: boolean("includeCharts").default(true), // 是否包含图表
  includeDetails: boolean("includeDetails").default(true), // 是否包含详细数据
  dateRange: mysqlEnum("dateRange", ["last_7_days", "last_14_days", "last_30_days", "last_month", "custom"]).default("last_7_days"),
  // 状态
  isActive: boolean("isActive").default(true),
  lastSentAt: timestamp("lastSentAt"), // 上次发送时间
  nextSendAt: timestamp("nextSendAt"), // 下次发送时间
  sendCount: int("sendCount").default(0), // 发送次数
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmailReportSubscription = typeof emailReportSubscriptions.$inferSelect;
export type InsertEmailReportSubscription = typeof emailReportSubscriptions.$inferInsert;

/**
 * Email Send Logs - 邮件发送日志
 * 记录每次邮件发送的详细信息
 */
export const emailSendLogs = mysqlTable("email_send_logs", {
  id: int("id").autoincrement().primaryKey(),
  subscriptionId: int("subscriptionId").notNull(), // 关联的订阅
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  recipients: json("recipients").$type<string[]>(), // 实际发送的收件人
  status: mysqlEnum("status", ["sent", "failed", "partial"]).notNull(),
  errorMessage: text("errorMessage"), // 错误信息
  reportData: json("reportData"), // 报表数据快照
  emailSubject: varchar("emailSubject", { length: 500 }), // 邮件主题
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmailSendLog = typeof emailSendLogs.$inferSelect;
export type InsertEmailSendLog = typeof emailSendLogs.$inferInsert;


/**
 * Audit Logs - 操作审计日志
 * 记录所有团队成员的操作行为，便于追溯和合规管理
 */
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // 操作用户ID
  userEmail: varchar("userEmail", { length: 255 }), // 操作用户邮箱
  userName: varchar("userName", { length: 255 }), // 操作用户名称
  // 操作类型
  actionType: mysqlEnum("actionType", [
    // 账号管理
    "account_create",
    "account_update",
    "account_delete",
    "account_connect",
    "account_disconnect",
    // 广告活动管理
    "campaign_create",
    "campaign_update",
    "campaign_delete",
    "campaign_pause",
    "campaign_enable",
    // 出价调整
    "bid_adjust_single",
    "bid_adjust_batch",
    "bid_rollback",
    // 否定词管理
    "negative_add_single",
    "negative_add_batch",
    "negative_remove",
    // 绩效组管理
    "performance_group_create",
    "performance_group_update",
    "performance_group_delete",
    // 自动化设置
    "automation_enable",
    "automation_disable",
    "automation_config_update",
    // 定时任务
    "scheduler_task_create",
    "scheduler_task_update",
    "scheduler_task_delete",
    "scheduler_task_run",
    // 团队管理
    "team_member_invite",
    "team_member_update",
    "team_member_remove",
    "team_permission_update",
    // 数据导入导出
    "data_import",
    "data_export",
    // 系统设置
    "settings_update",
    "notification_config_update",
    // 其他
    "other"
  ]).notNull(),
  // 操作目标
  targetType: mysqlEnum("targetType", [
    "account",
    "campaign",
    "ad_group",
    "keyword",
    "product_target",
    "performance_group",
    "negative_keyword",
    "bid",
    "automation",
    "scheduler",
    "team_member",
    "permission",
    "settings",
    "data",
    "other"
  ]),
  targetId: varchar("targetId", { length: 255 }), // 目标对象ID
  targetName: varchar("targetName", { length: 500 }), // 目标对象名称
  // 操作详情
  description: text("description"), // 操作描述
  previousValue: json("previousValue"), // 操作前的值
  newValue: json("newValue"), // 操作后的值
  metadata: json("metadata"), // 额外元数据
  // 关联信息
  accountId: int("accountId"), // 关联的广告账号ID
  accountName: varchar("accountName", { length: 255 }), // 关联的广告账号名称
  // 请求信息
  ipAddress: varchar("ipAddress", { length: 45 }), // IP地址
  userAgent: text("userAgent"), // 用户代理
  requestId: varchar("requestId", { length: 64 }), // 请求ID
  // 结果
  status: mysqlEnum("status", ["success", "failed", "partial"]).default("success"),
  errorMessage: text("errorMessage"), // 错误信息
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Collaboration Notification Rules - 协作通知规则
 * 定义什么操作需要通知哪些团队成员
 */
export const collaborationNotificationRules = mysqlTable("collaboration_notification_rules", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // 规则所有者（通常是管理员）
  name: varchar("name", { length: 255 }).notNull(), // 规则名称
  description: text("description"), // 规则描述
  // 触发条件
  triggerActions: json("triggerActions").$type<string[]>(), // 触发的操作类型列表
  triggerAccountIds: json("triggerAccountIds").$type<number[]>(), // 限定的账号ID，空表示全部
  // 通知设置
  notifyChannels: json("notifyChannels").$type<("app" | "email")[]>(), // 通知渠道
  notifyRecipients: json("notifyRecipients").$type<{
    type: "all_team" | "specific_members" | "account_admins" | "owner";
    memberIds?: number[];
  }>(), // 通知接收者
  // 通知内容
  notificationTemplate: text("notificationTemplate"), // 通知模板
  includeDetails: boolean("includeDetails").default(true), // 是否包含操作详情
  // 状态
  isActive: boolean("isActive").default(true),
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"]).default("medium"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CollaborationNotificationRule = typeof collaborationNotificationRules.$inferSelect;
export type InsertCollaborationNotificationRule = typeof collaborationNotificationRules.$inferInsert;

/**
 * Collaboration Notifications - 协作通知记录
 * 记录发送给团队成员的协作通知
 */
export const collaborationNotifications = mysqlTable("collaboration_notifications", {
  id: int("id").autoincrement().primaryKey(),
  ruleId: int("ruleId"), // 关联的规则ID
  auditLogId: int("auditLogId"), // 关联的审计日志ID
  // 通知内容
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  // 操作信息
  actionType: varchar("actionType", { length: 100 }),
  actionUserId: int("actionUserId"), // 执行操作的用户
  actionUserName: varchar("actionUserName", { length: 255 }),
  // 目标信息
  targetType: varchar("targetType", { length: 100 }),
  targetId: varchar("targetId", { length: 255 }),
  targetName: varchar("targetName", { length: 500 }),
  accountId: int("accountId"),
  accountName: varchar("accountName", { length: 255 }),
  // 通知渠道和状态
  channel: mysqlEnum("channel", ["app", "email"]).notNull(),
  recipientUserId: int("recipientUserId").notNull(), // 接收者用户ID
  recipientEmail: varchar("recipientEmail", { length: 255 }), // 接收者邮箱
  // 状态
  status: mysqlEnum("status", ["pending", "sent", "read", "failed"]).default("pending"),
  readAt: timestamp("readAt"), // 阅读时间
  sentAt: timestamp("sentAt"), // 发送时间
  errorMessage: text("errorMessage"),
  // 优先级
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"]).default("medium"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CollaborationNotification = typeof collaborationNotifications.$inferSelect;
export type InsertCollaborationNotification = typeof collaborationNotifications.$inferInsert;

/**
 * User Notification Preferences - 用户通知偏好设置
 * 每个用户可以自定义接收哪些类型的协作通知
 */
export const userNotificationPreferences = mysqlTable("user_notification_preferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // 通知渠道偏好
  enableAppNotifications: boolean("enableAppNotifications").default(true),
  enableEmailNotifications: boolean("enableEmailNotifications").default(true),
  // 按操作类型的偏好
  bidAdjustNotify: boolean("bidAdjustNotify").default(true), // 出价调整
  negativeKeywordNotify: boolean("negativeKeywordNotify").default(true), // 否定词操作
  campaignChangeNotify: boolean("campaignChangeNotify").default(true), // 广告活动变更
  automationNotify: boolean("automationNotify").default(true), // 自动化操作
  teamChangeNotify: boolean("teamChangeNotify").default(true), // 团队变更
  dataImportExportNotify: boolean("dataImportExportNotify").default(false), // 数据导入导出
  // 按优先级的偏好
  notifyOnLow: boolean("notifyOnLow").default(false),
  notifyOnMedium: boolean("notifyOnMedium").default(true),
  notifyOnHigh: boolean("notifyOnHigh").default(true),
  notifyOnCritical: boolean("notifyOnCritical").default(true),
  // 免打扰设置
  quietHoursEnabled: boolean("quietHoursEnabled").default(false),
  quietHoursStart: varchar("quietHoursStart", { length: 5 }), // HH:MM
  quietHoursEnd: varchar("quietHoursEnd", { length: 5 }), // HH:MM
  timezone: varchar("timezone", { length: 64 }).default("Asia/Shanghai"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserNotificationPreference = typeof userNotificationPreferences.$inferSelect;
export type InsertUserNotificationPreference = typeof userNotificationPreferences.$inferInsert;


/**
 * Budget Goals - 预算目标设置
 * 用户设置的销售目标和预算约束
 */
export const budgetGoals = mysqlTable("budget_goals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"), // 关联的广告账号，null表示全局目标
  // 目标类型
  goalType: mysqlEnum("goalType", [
    "sales_target",      // 销售目标
    "roas_target",       // ROAS目标
    "acos_target",       // ACoS目标
    "profit_target",     // 利润目标
    "market_share"       // 市场份额目标
  ]).notNull(),
  // 目标值
  targetValue: decimal("targetValue", { precision: 15, scale: 2 }).notNull(),
  // 时间范围
  periodType: mysqlEnum("periodType", ["daily", "weekly", "monthly", "quarterly"]).default("monthly"),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  // 预算约束
  totalBudget: decimal("totalBudget", { precision: 15, scale: 2 }), // 总预算上限
  minCampaignBudget: decimal("minCampaignBudget", { precision: 10, scale: 2 }).default("10.00"), // 单个活动最小预算
  maxCampaignBudget: decimal("maxCampaignBudget", { precision: 10, scale: 2 }), // 单个活动最大预算
  // 优先级设置
  prioritizeHighRoas: boolean("prioritizeHighRoas").default(true), // 优先高ROAS活动
  prioritizeNewProducts: boolean("prioritizeNewProducts").default(false), // 优先新品推广
  // 状态
  status: mysqlEnum("status", ["active", "paused", "completed", "expired"]).default("active"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BudgetGoal = typeof budgetGoals.$inferSelect;
export type InsertBudgetGoal = typeof budgetGoals.$inferInsert;

/**
 * Budget Allocations - 预算分配记录
 * 系统生成的预算分配建议和实际应用记录
 */
export const budgetAllocations = mysqlTable("budget_allocations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  goalId: int("goalId"), // 关联的预算目标
  // 分配信息
  allocationName: varchar("allocationName", { length: 255 }).notNull(),
  description: text("description"),
  // 总预算
  totalBudget: decimal("totalBudget", { precision: 15, scale: 2 }).notNull(),
  allocatedBudget: decimal("allocatedBudget", { precision: 15, scale: 2 }).notNull(), // 已分配预算
  // 预测效果
  predictedSales: decimal("predictedSales", { precision: 15, scale: 2 }),
  predictedRoas: decimal("predictedRoas", { precision: 10, scale: 2 }),
  predictedAcos: decimal("predictedAcos", { precision: 10, scale: 2 }),
  confidenceScore: decimal("confidenceScore", { precision: 5, scale: 2 }), // 预测置信度 0-100
  // 状态
  status: mysqlEnum("status", ["draft", "pending", "approved", "applied", "rejected"]).default("draft"),
  appliedAt: timestamp("appliedAt"),
  appliedBy: int("appliedBy"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BudgetAllocation = typeof budgetAllocations.$inferSelect;
export type InsertBudgetAllocation = typeof budgetAllocations.$inferInsert;

/**
 * Budget Allocation Items - 预算分配明细
 * 每个广告活动的具体预算分配
 */
export const budgetAllocationItems = mysqlTable("budget_allocation_items", {
  id: int("id").autoincrement().primaryKey(),
  allocationId: int("allocationId").notNull(), // 关联的分配记录
  campaignId: int("campaignId").notNull(), // 广告活动ID
  // 预算信息
  currentBudget: decimal("currentBudget", { precision: 10, scale: 2 }).notNull(), // 当前预算
  recommendedBudget: decimal("recommendedBudget", { precision: 10, scale: 2 }).notNull(), // 建议预算
  budgetChange: decimal("budgetChange", { precision: 10, scale: 2 }).notNull(), // 变化金额
  changePercent: decimal("changePercent", { precision: 10, scale: 2 }).notNull(), // 变化百分比
  // 历史表现指标
  historicalSpend: decimal("historicalSpend", { precision: 15, scale: 2 }), // 历史花费
  historicalSales: decimal("historicalSales", { precision: 15, scale: 2 }), // 历史销售
  historicalRoas: decimal("historicalRoas", { precision: 10, scale: 2 }), // 历史ROAS
  historicalAcos: decimal("historicalAcos", { precision: 10, scale: 2 }), // 历史ACoS
  historicalCtr: decimal("historicalCtr", { precision: 10, scale: 4 }), // 历史点击率
  historicalCvr: decimal("historicalCvr", { precision: 10, scale: 4 }), // 历史转化率
  // 预测效果
  predictedSpend: decimal("predictedSpend", { precision: 15, scale: 2 }),
  predictedSales: decimal("predictedSales", { precision: 15, scale: 2 }),
  predictedRoas: decimal("predictedRoas", { precision: 10, scale: 2 }),
  predictedAcos: decimal("predictedAcos", { precision: 10, scale: 2 }),
  // 分配原因
  allocationReason: mysqlEnum("allocationReason", [
    "high_roas",           // 高ROAS，增加预算
    "low_acos",            // 低ACoS，增加预算
    "high_conversion",     // 高转化率，增加预算
    "growth_potential",    // 增长潜力，增加预算
    "new_product",         // 新品推广，增加预算
    "seasonal_boost",      // 季节性提升
    "low_roas",            // 低ROAS，减少预算
    "high_acos",           // 高ACoS，减少预算
    "low_conversion",      // 低转化率，减少预算
    "budget_limit",        // 预算限制
    "maintain",            // 保持现状
    "rebalance"            // 重新平衡
  ]),
  reasonDetail: text("reasonDetail"), // 详细原因说明
  // 优先级评分
  priorityScore: decimal("priorityScore", { precision: 5, scale: 2 }), // 0-100
  // 状态
  status: mysqlEnum("status", ["pending", "applied", "skipped"]).default("pending"),
  appliedAt: timestamp("appliedAt"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BudgetAllocationItem = typeof budgetAllocationItems.$inferSelect;
export type InsertBudgetAllocationItem = typeof budgetAllocationItems.$inferInsert;

/**
 * Budget History - 预算调整历史
 * 记录每次预算调整的详细信息
 */
export const budgetHistory = mysqlTable("budget_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  campaignId: int("campaignId").notNull(),
  allocationId: int("allocationId"), // 关联的分配记录（如果是通过分配应用的）
  // 预算变化
  previousBudget: decimal("previousBudget", { precision: 10, scale: 2 }).notNull(),
  newBudget: decimal("newBudget", { precision: 10, scale: 2 }).notNull(),
  changeAmount: decimal("changeAmount", { precision: 10, scale: 2 }).notNull(),
  changePercent: decimal("changePercent", { precision: 10, scale: 2 }).notNull(),
  // 调整来源
  source: mysqlEnum("source", [
    "manual",              // 手动调整
    "auto_allocation",     // 自动分配
    "scheduled",           // 定时调整
    "rule_based",          // 规则触发
    "api_sync"             // API同步
  ]).notNull(),
  // 调整原因
  reason: text("reason"),
  // 调整时的表现指标快照
  snapshotRoas: decimal("snapshotRoas", { precision: 10, scale: 2 }),
  snapshotAcos: decimal("snapshotAcos", { precision: 10, scale: 2 }),
  snapshotSpend: decimal("snapshotSpend", { precision: 15, scale: 2 }),
  snapshotSales: decimal("snapshotSales", { precision: 15, scale: 2 }),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BudgetHistoryRecord = typeof budgetHistory.$inferSelect;
export type InsertBudgetHistory = typeof budgetHistory.$inferInsert;


/**
 * Budget Consumption Alerts - 预算消耗预警
 * 监控广告活动预算消耗速度，发送异常预警
 */
export const budgetConsumptionAlerts = mysqlTable("budget_consumption_alerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  campaignId: int("campaignId").notNull(),
  // 预警类型
  alertType: mysqlEnum("alertType", [
    "overspending",      // 消耗过快
    "underspending",     // 消耗过慢
    "budget_depleted",   // 预算耗尽
    "near_depletion"     // 即将耗尽
  ]).notNull(),
  // 预警级别
  severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).default("medium"),
  // 消耗数据
  dailyBudget: decimal("dailyBudget", { precision: 10, scale: 2 }).notNull(),
  currentSpend: decimal("currentSpend", { precision: 10, scale: 2 }).notNull(),
  expectedSpend: decimal("expectedSpend", { precision: 10, scale: 2 }), // 预期消耗
  spendRate: decimal("spendRate", { precision: 10, scale: 4 }), // 消耗速率（每小时）
  projectedDailySpend: decimal("projectedDailySpend", { precision: 10, scale: 2 }), // 预计日消耗
  // 偏差
  deviationPercent: decimal("deviationPercent", { precision: 10, scale: 2 }), // 偏差百分比
  // 建议
  recommendation: text("recommendation"),
  // 状态
  status: mysqlEnum("status", ["active", "acknowledged", "resolved"]).default("active"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  resolvedAt: timestamp("resolvedAt"),
  // 通知
  notificationSent: boolean("notificationSent").default(false),
  notificationSentAt: timestamp("notificationSentAt"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BudgetConsumptionAlert = typeof budgetConsumptionAlerts.$inferSelect;
export type InsertBudgetConsumptionAlert = typeof budgetConsumptionAlerts.$inferInsert;

/**
 * Budget Alert Settings - 预算预警设置
 * 用户自定义预警阈值
 */
export const budgetAlertSettings = mysqlTable("budget_alert_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  // 预警阈值
  overspendingThreshold: decimal("overspendingThreshold", { precision: 5, scale: 2 }).default("120"), // 超支阈值（百分比）
  underspendingThreshold: decimal("underspendingThreshold", { precision: 5, scale: 2 }).default("50"), // 欠支阈值（百分比）
  nearDepletionThreshold: decimal("nearDepletionThreshold", { precision: 5, scale: 2 }).default("90"), // 即将耗尽阈值
  // 检查频率
  checkFrequency: mysqlEnum("checkFrequency", ["hourly", "every_4_hours", "daily"]).default("every_4_hours"),
  // 通知设置
  enableNotifications: boolean("enableNotifications").default(true),
  notifyOnOverspending: boolean("notifyOnOverspending").default(true),
  notifyOnUnderspending: boolean("notifyOnUnderspending").default(true),
  notifyOnDepletion: boolean("notifyOnDepletion").default(true),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type BudgetAlertSetting = typeof budgetAlertSettings.$inferSelect;
export type InsertBudgetAlertSetting = typeof budgetAlertSettings.$inferInsert;

/**
 * Budget Allocation Effect Tracking - 预算分配效果追踪
 * 追踪预算分配方案应用后的效果
 */
export const budgetAllocationTracking = mysqlTable("budget_allocation_tracking", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  allocationId: int("allocationId").notNull(), // 关联的分配记录
  // 追踪周期
  trackingPeriod: mysqlEnum("trackingPeriod", ["7_days", "14_days", "30_days"]).default("7_days"),
  startDate: timestamp("startDate").notNull(),
  endDate: timestamp("endDate"),
  // 分配前指标（基准期）
  baselineStartDate: timestamp("baselineStartDate").notNull(),
  baselineEndDate: timestamp("baselineEndDate").notNull(),
  baselineSpend: decimal("baselineSpend", { precision: 15, scale: 2 }),
  baselineSales: decimal("baselineSales", { precision: 15, scale: 2 }),
  baselineRoas: decimal("baselineRoas", { precision: 10, scale: 2 }),
  baselineAcos: decimal("baselineAcos", { precision: 10, scale: 2 }),
  baselineConversions: int("baselineConversions"),
  baselineCtr: decimal("baselineCtr", { precision: 10, scale: 4 }),
  baselineCpc: decimal("baselineCpc", { precision: 10, scale: 2 }),
  // 分配后指标
  currentSpend: decimal("currentSpend", { precision: 15, scale: 2 }),
  currentSales: decimal("currentSales", { precision: 15, scale: 2 }),
  currentRoas: decimal("currentRoas", { precision: 10, scale: 2 }),
  currentAcos: decimal("currentAcos", { precision: 10, scale: 2 }),
  currentConversions: int("currentConversions"),
  currentCtr: decimal("currentCtr", { precision: 10, scale: 4 }),
  currentCpc: decimal("currentCpc", { precision: 10, scale: 2 }),
  // 变化
  roasChange: decimal("roasChange", { precision: 10, scale: 2 }),
  acosChange: decimal("acosChange", { precision: 10, scale: 2 }),
  salesChange: decimal("salesChange", { precision: 15, scale: 2 }),
  spendChange: decimal("spendChange", { precision: 15, scale: 2 }),
  // 效果评估
  effectRating: mysqlEnum("effectRating", ["excellent", "good", "neutral", "poor", "very_poor"]),
  effectSummary: text("effectSummary"),
  // 状态
  status: mysqlEnum("status", ["tracking", "completed", "cancelled"]).default("tracking"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type BudgetAllocationTracking = typeof budgetAllocationTracking.$inferSelect;
export type InsertBudgetAllocationTracking = typeof budgetAllocationTracking.$inferInsert;

/**
 * Seasonal Trends - 季节性趋势
 * 存储历史数据的季节性分析结果
 */
export const seasonalTrends = mysqlTable("seasonal_trends", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  // 时间范围
  year: int("year").notNull(),
  month: int("month").notNull(), // 1-12
  weekOfYear: int("weekOfYear"), // 1-53
  // 历史指标
  avgDailySpend: decimal("avgDailySpend", { precision: 15, scale: 2 }),
  avgDailySales: decimal("avgDailySales", { precision: 15, scale: 2 }),
  avgRoas: decimal("avgRoas", { precision: 10, scale: 2 }),
  avgAcos: decimal("avgAcos", { precision: 10, scale: 2 }),
  avgConversions: decimal("avgConversions", { precision: 10, scale: 2 }),
  // 同比变化
  yoySpendChange: decimal("yoySpendChange", { precision: 10, scale: 2 }),
  yoySalesChange: decimal("yoySalesChange", { precision: 10, scale: 2 }),
  // 季节性指数（相对于年平均）
  seasonalIndex: decimal("seasonalIndex", { precision: 10, scale: 4 }).default("1.0"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type SeasonalTrend = typeof seasonalTrends.$inferSelect;
export type InsertSeasonalTrend = typeof seasonalTrends.$inferInsert;

/**
 * Promotional Events - 大促活动
 * 定义大促期间的时间和预算建议
 */
export const promotionalEvents = mysqlTable("promotional_events", {
  id: int("id").autoincrement().primaryKey(),
  // 活动信息
  eventName: varchar("eventName", { length: 100 }).notNull(),
  eventType: mysqlEnum("eventType", [
    "prime_day",
    "black_friday",
    "cyber_monday",
    "christmas",
    "new_year",
    "valentines",
    "mothers_day",
    "fathers_day",
    "back_to_school",
    "halloween",
    "custom"
  ]).notNull(),
  // 适用市场
  marketplace: varchar("marketplace", { length: 20 }),
  // 时间
  startDate: timestamp("startDate").notNull(),
  endDate: timestamp("endDate").notNull(),
  // 预热期
  warmupStartDate: timestamp("warmupStartDate"),
  warmupEndDate: timestamp("warmupEndDate"),
  // 建议预算调整
  recommendedBudgetMultiplier: decimal("recommendedBudgetMultiplier", { precision: 5, scale: 2 }).default("1.5"),
  warmupBudgetMultiplier: decimal("warmupBudgetMultiplier", { precision: 5, scale: 2 }).default("1.2"),
  // 描述
  description: text("description"),
  // 状态
  isActive: boolean("isActive").default(true),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PromotionalEvent = typeof promotionalEvents.$inferSelect;
export type InsertPromotionalEvent = typeof promotionalEvents.$inferInsert;

/**
 * Seasonal Budget Recommendations - 季节性预算建议
 * 基于季节性趋势生成的预算调整建议
 */
export const seasonalBudgetRecommendations = mysqlTable("seasonal_budget_recommendations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId"),
  campaignId: int("campaignId"),
  // 关联的大促活动
  eventId: int("eventId"),
  // 建议类型
  recommendationType: mysqlEnum("recommendationType", [
    "event_increase",      // 大促期间增加
    "event_warmup",        // 大促预热
    "seasonal_increase",   // 季节性增加
    "seasonal_decrease",   // 季节性减少
    "trend_based"          // 趋势驱动
  ]).notNull(),
  // 当前预算
  currentBudget: decimal("currentBudget", { precision: 10, scale: 2 }).notNull(),
  // 建议预算
  recommendedBudget: decimal("recommendedBudget", { precision: 10, scale: 2 }).notNull(),
  budgetMultiplier: decimal("budgetMultiplier", { precision: 5, scale: 2 }),
  // 建议时间范围
  effectiveStartDate: timestamp("effectiveStartDate").notNull(),
  effectiveEndDate: timestamp("effectiveEndDate").notNull(),
  // 预期效果
  expectedSalesIncrease: decimal("expectedSalesIncrease", { precision: 10, scale: 2 }),
  expectedRoasChange: decimal("expectedRoasChange", { precision: 10, scale: 2 }),
  // 建议理由
  reasoning: text("reasoning"),
  confidenceScore: decimal("confidenceScore", { precision: 5, scale: 2 }), // 0-100
  // 状态
  status: mysqlEnum("status", ["pending", "applied", "skipped", "expired"]).default("pending"),
  appliedAt: timestamp("appliedAt"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SeasonalBudgetRecommendation = typeof seasonalBudgetRecommendations.$inferSelect;
export type InsertSeasonalBudgetRecommendation = typeof seasonalBudgetRecommendations.$inferInsert;

/**
 * Data Sync Tasks - 数据同步任务
 * 管理从Amazon API拉取数据的任务
 */
export const dataSyncTasks = mysqlTable("data_sync_tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId").notNull(),
  // 同步类型
  syncType: mysqlEnum("syncType", [
    "campaigns",           // 广告活动
    "ad_groups",           // 广告组
    "keywords",            // 关键词
    "product_targets",     // 商品定位
    "search_terms",        // 搜索词报告
    "performance_daily",   // 每日绩效
    "performance_hourly",  // 每小时绩效
    "full_sync"            // 全量同步
  ]).notNull(),
  // 同步范围
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  // 状态
  status: mysqlEnum("status", [
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled"
  ]).default("pending"),
  // 进度
  totalItems: int("totalItems"),
  processedItems: int("processedItems").default(0),
  failedItems: int("failedItems").default(0),
  // 结果
  resultSummary: json("resultSummary"),
  errorMessage: text("errorMessage"),
  // 时间
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DataSyncTask = typeof dataSyncTasks.$inferSelect;
export type InsertDataSyncTask = typeof dataSyncTasks.$inferInsert;

/**
 * Data Sync Schedules - 数据同步调度
 * 定时同步配置
 */
export const dataSyncSchedules = mysqlTable("data_sync_schedules", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId").notNull(),
  // 同步类型
  syncType: mysqlEnum("syncType", [
    "campaigns",
    "ad_groups",
    "keywords",
    "product_targets",
    "search_terms",
    "performance_daily",
    "performance_hourly",
    "full_sync"
  ]).notNull(),
  // 调度设置
  frequency: mysqlEnum("frequency", [
    "hourly",
    "every_4_hours",
    "every_6_hours",
    "every_12_hours",
    "daily",
    "weekly"
  ]).default("daily"),
  preferredTime: varchar("preferredTime", { length: 5 }), // HH:MM 格式
  preferredDayOfWeek: int("preferredDayOfWeek"), // 0-6, 仅周调度使用
  // 状态
  isEnabled: boolean("isEnabled").default(true),
  lastRunAt: timestamp("lastRunAt"),
  nextRunAt: timestamp("nextRunAt"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type DataSyncSchedule = typeof dataSyncSchedules.$inferSelect;
export type InsertDataSyncSchedule = typeof dataSyncSchedules.$inferInsert;

/**
 * API Rate Limits - API调用限制
 * 记录API调用配额和使用情况
 */
export const apiRateLimits = mysqlTable("api_rate_limits", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  // API类型
  apiType: mysqlEnum("apiType", [
    "campaigns",
    "ad_groups",
    "keywords",
    "reports",
    "bidding",
    "bulk_operations"
  ]).notNull(),
  // 限制配置
  maxRequestsPerSecond: int("maxRequestsPerSecond").default(10),
  maxRequestsPerMinute: int("maxRequestsPerMinute").default(100),
  maxRequestsPerDay: int("maxRequestsPerDay").default(10000),
  // 当前使用
  currentSecondCount: int("currentSecondCount").default(0),
  currentMinuteCount: int("currentMinuteCount").default(0),
  currentDayCount: int("currentDayCount").default(0),
  // 重置时间
  secondResetAt: timestamp("secondResetAt"),
  minuteResetAt: timestamp("minuteResetAt"),
  dayResetAt: timestamp("dayResetAt"),
  // 时间
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ApiRateLimit = typeof apiRateLimits.$inferSelect;
export type InsertApiRateLimit = typeof apiRateLimits.$inferInsert;

/**
 * API Call Logs - API调用日志
 * 记录所有API调用详情
 */
export const apiCallLogs = mysqlTable("api_call_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  accountId: int("accountId").notNull(),
  // 请求信息
  apiType: varchar("apiType", { length: 50 }).notNull(),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  // 响应信息
  statusCode: int("statusCode"),
  responseTime: int("responseTime"), // 毫秒
  // 错误信息
  isError: boolean("isError").default(false),
  errorCode: varchar("errorCode", { length: 50 }),
  errorMessage: text("errorMessage"),
  // 重试信息
  retryCount: int("retryCount").default(0),
  isRetry: boolean("isRetry").default(false),
  originalRequestId: int("originalRequestId"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ApiCallLog = typeof apiCallLogs.$inferSelect;
export type InsertApiCallLog = typeof apiCallLogs.$inferInsert;

/**
 * API Request Queue - API请求队列
 * 管理待执行的API请求
 */
export const apiRequestQueue = mysqlTable("api_request_queue", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  accountId: int("accountId").notNull(),
  // 请求信息
  apiType: varchar("apiType", { length: 50 }).notNull(),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  requestBody: json("requestBody"),
  // 优先级
  priority: mysqlEnum("priority", ["low", "normal", "high", "critical"]).default("normal"),
  // 状态
  status: mysqlEnum("status", [
    "pending",
    "processing",
    "completed",
    "failed",
    "cancelled"
  ]).default("pending"),
  // 重试配置
  maxRetries: int("maxRetries").default(3),
  retryCount: int("retryCount").default(0),
  retryAfter: timestamp("retryAfter"),
  // 结果
  responseData: json("responseData"),
  errorMessage: text("errorMessage"),
  // 时间
  scheduledAt: timestamp("scheduledAt"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ApiRequestQueueItem = typeof apiRequestQueue.$inferSelect;
export type InsertApiRequestQueueItem = typeof apiRequestQueue.$inferInsert;


/**
 * Data Sync Jobs - 数据同步任务
 * 管理广告数据同步任务
 */
export const dataSyncJobs = mysqlTable("data_sync_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: int("accountId").notNull(),
  // 同步类型
  syncType: mysqlEnum("syncType", [
    "campaigns",
    "keywords",
    "performance",
    "all"
  ]).default("all"),
  // 状态
  status: mysqlEnum("status", [
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled"
  ]).default("pending"),
  // 进度
  recordsSynced: int("recordsSynced").default(0),
  errorMessage: text("errorMessage"),
  // 时间
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DataSyncJob = typeof dataSyncJobs.$inferSelect;
export type InsertDataSyncJob = typeof dataSyncJobs.$inferInsert;

/**
 * Data Sync Logs - 数据同步日志
 * 记录同步过程的详细日志
 */
export const dataSyncLogs = mysqlTable("data_sync_logs", {
  id: int("id").autoincrement().primaryKey(),
  jobId: int("jobId").notNull(),
  // 操作信息
  operation: varchar("operation", { length: 100 }).notNull(),
  status: mysqlEnum("status", ["success", "error", "warning"]).default("success"),
  message: text("message"),
  details: json("details"),
  // 时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DataSyncLog = typeof dataSyncLogs.$inferSelect;
export type InsertDataSyncLog = typeof dataSyncLogs.$inferInsert;

