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
