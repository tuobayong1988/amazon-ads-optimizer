import { mysqlTable, mysqlSchema, AnyMySqlColumn, index, int, datetime, date, decimal, varchar, text, mysqlEnum, timestamp, json, time, foreignKey, tinyint } from "drizzle-orm/mysql-core"
import { sql } from "drizzle-orm"

export const abTestCampaignAssignments = mysqlTable("ab_test_campaign_assignments", {
	id: int().autoincrement().notNull(),
	testId: int().notNull(),
	variantId: int().notNull(),
	campaignId: int().notNull(),
	assignedAt: datetime({ mode: 'string'}).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_ab_test_campaign_assignments_testId").on(table.testId),
	index("idx_ab_test_campaign_assignments_variantId").on(table.variantId),
	index("idx_ab_test_campaign_assignments_campaignId").on(table.campaignId),
]);

export const abTestDailyMetrics = mysqlTable("ab_test_daily_metrics", {
	id: int().autoincrement().notNull(),
	testId: int().notNull(),
	variantId: int().notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	date: date({ mode: 'string' }).notNull(),
	impressions: int().default(0).notNull(),
	clicks: int().default(0).notNull(),
	spend: decimal({ precision: 10, scale: 2 }).default('0.00').notNull(),
	sales: decimal({ precision: 10, scale: 2 }).default('0.00').notNull(),
	orders: int().default(0).notNull(),
	acos: decimal({ precision: 10, scale: 2 }),
	roas: decimal({ precision: 10, scale: 2 }),
	ctr: decimal({ precision: 10, scale: 4 }),
	cvr: decimal({ precision: 10, scale: 4 }),
	createdAt: datetime({ mode: 'string'}).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_ab_test_daily_metrics_unique").on(table.testId, table.variantId, table.date),
	index("idx_ab_test_daily_metrics_testId").on(table.testId),
	index("idx_ab_test_daily_metrics_variantId").on(table.variantId),
]);

export const abTestResults = mysqlTable("ab_test_results", {
	id: int().autoincrement().notNull(),
	testId: int().notNull(),
	variantId: int().notNull(),
	metricName: varchar({ length: 50 }).notNull(),
	controlValue: decimal({ precision: 10, scale: 4 }),
	treatmentValue: decimal({ precision: 10, scale: 4 }),
	absoluteDiff: decimal({ precision: 10, scale: 4 }),
	relativeDiff: decimal({ precision: 10, scale: 4 }),
	pValue: decimal({ precision: 10, scale: 6 }),
	confidenceInterval: varchar({ length: 100 }),
	isSignificant: tinyint().default(0),
	calculatedAt: datetime({ mode: 'string'}).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_ab_test_results_testId").on(table.testId),
	index("idx_ab_test_results_variantId").on(table.variantId),
]);

export const abTestVariants = mysqlTable("ab_test_variants", {
	id: int().autoincrement().notNull(),
	testId: int().notNull(),
	variantName: varchar({ length: 255 }).notNull(),
	variantType: varchar({ length: 50 }).default('control').notNull(),
	description: text(),
	bidMultiplier: decimal({ precision: 5, scale: 2 }).default('1.00'),
	trafficAllocation: decimal({ precision: 5, scale: 2 }).default('50.00'),
	configJson: text("config_json"),
	createdAt: datetime({ mode: 'string'}).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_ab_test_variants_testId").on(table.testId),
]);

export const abTests = mysqlTable("ab_tests", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	performanceGroupId: int(),
	testName: varchar({ length: 255 }).notNull(),
	testDescription: text(),
	testType: varchar({ length: 50 }).default('bid_optimization').notNull(),
	status: varchar({ length: 50 }).default('draft').notNull(),
	startDate: datetime({ mode: 'string'}),
	endDate: datetime({ mode: 'string'}),
	targetMetric: varchar({ length: 50 }).default('acos').notNull(),
	minSampleSize: int().default(100).notNull(),
	confidenceLevel: decimal({ precision: 5, scale: 2 }).default('0.95').notNull(),
	createdAt: datetime({ mode: 'string'}).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: datetime({ mode: 'string'}).default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	createdBy: int(),
},
(table) => [
	index("idx_ab_tests_accountId").on(table.accountId),
	index("idx_ab_tests_status").on(table.status),
]);

export const accountPermissions = mysqlTable("account_permissions", {
	id: int().autoincrement().notNull(),
	teamMemberId: int().notNull(),
	accountId: int().notNull(),
	permissionLevel: mysqlEnum(['full','edit','view']).default('view').notNull(),
	canExport: tinyint().default(1),
	canManageCampaigns: tinyint().default(0),
	canAdjustBids: tinyint().default(0),
	canManageNegatives: tinyint().default(0),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const adAccounts = mysqlTable("ad_accounts", {
	id: int().autoincrement().notNull(),
	organizationId: int("organization_id").default(1),
	userId: int().notNull(),
	accountId: varchar({ length: 64 }).notNull(),
	accountName: varchar({ length: 255 }).notNull(),
	marketplace: varchar({ length: 32 }).notNull(),
	profileId: varchar({ length: 64 }),
	conversionValueType: mysqlEnum(['sales','units','custom']).default('sales'),
	conversionValueSource: mysqlEnum(['platform','custom']).default('platform'),
	intradayBiddingEnabled: tinyint().default(1),
	defaultMaxBid: decimal({ precision: 10, scale: 2 }).default('2.00'),
	status: mysqlEnum(['active','paused','archived']).default('active'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	storeName: varchar({ length: 255 }),
	storeDescription: text(),
	storeColor: varchar({ length: 7 }),
	marketplaceId: varchar({ length: 32 }),
	sellerId: varchar({ length: 64 }),
	connectionStatus: mysqlEnum(['connected','disconnected','error','pending']).default('pending'),
	lastConnectionCheck: timestamp({ mode: 'string' }),
	connectionErrorMessage: text(),
	isDefault: tinyint().default(0),
	sortOrder: int().default(0),
	// 初始化状态字段
	initializationStatus: varchar("initialization_status", { length: 20 }).default('pending'),
	initializationStartedAt: timestamp("initialization_started_at", { mode: 'string' }),
	initializationCompletedAt: timestamp("initialization_completed_at", { mode: 'string' }),
	initializationProgress: int("initialization_progress").default(0),
	initializationError: text("initialization_error"),
},
(table) => [
	index("idx_ad_organization").on(table.organizationId),
]);

export const adGroups = mysqlTable("ad_groups", {
	id: int().autoincrement().notNull(),
	campaignId: int().notNull(),
	adGroupId: varchar({ length: 64 }).notNull(),
	adGroupName: varchar({ length: 500 }).notNull(),
	defaultBid: decimal({ precision: 10, scale: 2 }),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 10, scale: 2 }).default('0.00'),
	sales: decimal({ precision: 10, scale: 2 }).default('0.00'),
	orders: int().default(0),
	adGroupStatus: mysqlEnum(['enabled','paused','archived']).default('enabled'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	tactic: varchar({ length: 20 }),
	headline: varchar({ length: 500 }),
	creativeType: varchar("creative_type", { length: 50 }),
	brandLogoAssetId: varchar("brand_logo_asset_id", { length: 64 }),
	customImageAssetId: varchar("custom_image_asset_id", { length: 64 }),
	videoAssetId: varchar("video_asset_id", { length: 64 }),
	ctr: decimal({ precision: 5, scale: 4 }),
	cvr: decimal({ precision: 5, scale: 4 }),
	acos: decimal({ precision: 5, scale: 2 }),
	roas: decimal({ precision: 10, scale: 2 }),
	cpc: decimal({ precision: 10, scale: 2 }),
	dpv: int().default(0),
	ntbOrders: int("ntb_orders").default(0),
	ntbSales: decimal("ntb_sales", { precision: 15, scale: 2 }).default('0'),
	viewAttributedSales: decimal("view_attributed_sales", { precision: 15, scale: 2 }).default('0'),
	viewAttributedOrders: int("view_attributed_orders").default(0),
});

export const aiOptimizationActions = mysqlTable("ai_optimization_actions", {
	id: int().autoincrement().notNull(),
	executionId: int().notNull(),
	aiActionType: mysqlEnum(['bid_increase','bid_decrease','bid_set','enable_target','pause_target','add_negative_phrase','add_negative_exact']).notNull(),
	aiTargetType: mysqlEnum(['keyword','product_target','search_term']).notNull(),
	aiTargetId: int(),
	aiTargetText: varchar({ length: 500 }),
	previousValue: varchar({ length: 100 }),
	newValue: varchar({ length: 100 }),
	changeReason: text(),
	aiActionStatus: mysqlEnum(['pending','success','failed']).default('pending'),
	aiActionError: text(),
	aiActionExecutedAt: timestamp({ mode: 'string' }),
	aiActionCreatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const aiOptimizationExecutions = mysqlTable("ai_optimization_executions", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int().notNull(),
	campaignId: int().notNull(),
	executionName: varchar({ length: 255 }),
	aiExecType: mysqlEnum(['bid_adjustment','status_change','negative_keyword','mixed']).notNull(),
	aiExecStatus: mysqlEnum(['pending','executing','completed','failed','partially_completed']).default('pending'),
	totalActions: int().default(0),
	successfulActions: int().default(0),
	failedActions: int().default(0),
	aiAnalysisSummary: text(),
	baselineSpend: decimal({ precision: 12, scale: 2 }),
	baselineSales: decimal({ precision: 12, scale: 2 }),
	baselineAcos: decimal({ precision: 5, scale: 2 }),
	baselineRoas: decimal({ precision: 10, scale: 2 }),
	baselineClicks: int(),
	baselineImpressions: int(),
	baselineOrders: int(),
	executedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	completedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const aiOptimizationPredictions = mysqlTable("ai_optimization_predictions", {
	id: int().autoincrement().notNull(),
	executionId: int().notNull(),
	predictionPeriod: mysqlEnum(['7_days','14_days','30_days']).notNull(),
	predictedSpend: decimal({ precision: 12, scale: 2 }),
	predictedSales: decimal({ precision: 12, scale: 2 }),
	predictedAcos: decimal({ precision: 5, scale: 2 }),
	predictedRoas: decimal({ precision: 10, scale: 2 }),
	predictedClicks: int(),
	predictedImpressions: int(),
	predictedOrders: int(),
	spendChangePercent: decimal({ precision: 5, scale: 2 }),
	salesChangePercent: decimal({ precision: 5, scale: 2 }),
	acosChangePercent: decimal({ precision: 5, scale: 2 }),
	roasChangePercent: decimal({ precision: 5, scale: 2 }),
	confidenceLevel: decimal({ precision: 3, scale: 2 }),
	predictionRationale: text(),
	predictionCreatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const aiOptimizationReviews = mysqlTable("ai_optimization_reviews", {
	id: int().autoincrement().notNull(),
	executionId: int().notNull(),
	predictionId: int().notNull(),
	reviewPeriod: mysqlEnum(['7_days','14_days','30_days']).notNull(),
	actualSpend: decimal({ precision: 12, scale: 2 }),
	actualSales: decimal({ precision: 12, scale: 2 }),
	actualAcos: decimal({ precision: 5, scale: 2 }),
	actualRoas: decimal({ precision: 10, scale: 2 }),
	actualClicks: int(),
	actualImpressions: int(),
	actualOrders: int(),
	actualSpendChange: decimal({ precision: 5, scale: 2 }),
	actualSalesChange: decimal({ precision: 5, scale: 2 }),
	actualAcosChange: decimal({ precision: 5, scale: 2 }),
	actualRoasChange: decimal({ precision: 5, scale: 2 }),
	spendAccuracy: decimal({ precision: 5, scale: 2 }),
	salesAccuracy: decimal({ precision: 5, scale: 2 }),
	acosAccuracy: decimal({ precision: 5, scale: 2 }),
	roasAccuracy: decimal({ precision: 5, scale: 2 }),
	overallAccuracy: decimal({ precision: 5, scale: 2 }),
	reviewStatus: mysqlEnum(['pending','completed','skipped']).default('pending'),
	reviewSummary: text(),
	lessonsLearned: text(),
	scheduledAt: timestamp({ mode: 'string' }).notNull(),
	reviewedAt: timestamp({ mode: 'string' }),
	reviewCreatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const amazonApiCredentials = mysqlTable("amazon_api_credentials", {
	id: int().autoincrement().notNull(),
	organizationId: int("organization_id").default(1),
	accountId: int().notNull(),
	clientId: varchar({ length: 255 }).notNull(),
	clientSecret: varchar({ length: 255 }).notNull(),
	refreshToken: text().notNull(),
	accessToken: text(),
	tokenExpiresAt: timestamp({ mode: 'string' }),
	profileId: varchar({ length: 64 }).notNull(),
	region: mysqlEnum(['NA','EU','FE']).default('NA').notNull(),
	lastSyncAt: timestamp({ mode: 'string' }),
	syncStatus: mysqlEnum(['idle','syncing','error']).default('idle'),
	syncErrorMessage: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	timezone: varchar({ length: 64 }),
	currencyCode: varchar("currency_code", { length: 10 }),
},
(table) => [
	index("amazon_api_credentials_accountId_unique").on(table.accountId),
	index("idx_api_organization").on(table.organizationId),
]);

export const amsConsumerStatus = mysqlTable("ams_consumer_status", {
	id: int().autoincrement().notNull(),
	consumerId: varchar("consumer_id", { length: 64 }).notNull(),
	queueUrl: varchar("queue_url", { length: 512 }).notNull(),
	status: mysqlEnum(['running','stopped','error']).default('stopped'),
	lastHeartbeat: timestamp("last_heartbeat", { mode: 'string' }),
	messagesProcessed: int("messages_processed").default(0),
	messagesErrored: int("messages_errored").default(0),
	lastError: text("last_error"),
	startedAt: timestamp("started_at", { mode: 'string' }),
	stoppedAt: timestamp("stopped_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("ams_consumer_id").on(table.consumerId),
	index("ams_consumer_status_idx").on(table.status),
]);

export const amsMessages = mysqlTable("ams_messages", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	subscriptionId: varchar({ length: 255 }),
	messageId: varchar({ length: 255 }).notNull(),
	dataSetId: varchar({ length: 100 }),
	profileId: varchar({ length: 100 }),
	marketplace: varchar({ length: 50 }),
	messageType: varchar({ length: 100 }),
	eventTime: datetime({ mode: 'string'}),
	rawPayload: json(),
	processStatus: varchar({ length: 50 }).default('pending'),
	processError: text(),
	processedAt: datetime({ mode: 'string'}),
	campaignId: varchar({ length: 100 }),
	adGroupId: varchar({ length: 100 }),
	keywordId: varchar({ length: 100 }),
	impressions: int(),
	clicks: int(),
	spend: decimal({ precision: 10, scale: 2 }),
	sales: decimal({ precision: 10, scale: 2 }),
	orders: int(),
	receivedAt: datetime({ mode: 'string'}).default('CURRENT_TIMESTAMP'),
	createdAt: datetime({ mode: 'string'}).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("idx_account_received").on(table.accountId, table.receivedAt),
	index("idx_message_id").on(table.messageId),
	index("idx_process_status").on(table.processStatus),
	index("messageId").on(table.messageId),
]);

export const amsPerformanceBuffer = mysqlTable("ams_performance_buffer", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: int(),
	amazonCampaignId: varchar({ length: 64 }).notNull(),
	date: varchar({ length: 10 }).notNull(),
	adType: mysqlEnum(['SP','SB','SD']).notNull(),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 12, scale: 4 }).default('0.0000'),
	sales: decimal({ precision: 12, scale: 4 }).default('0.0000'),
	orders: int().default(0),
	messageCount: int().default(0),
	firstMessageAt: timestamp({ mode: 'string' }),
	lastMessageAt: timestamp({ mode: 'string' }),
	lastEventTime: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("ams_perf_account_date").on(table.accountId, table.date),
	index("ams_perf_campaign_date").on(table.amazonCampaignId, table.date),
]);

export const amsPerformanceData = mysqlTable("ams_performance_data", {
	id: int().autoincrement().notNull(),
	accountId: int("account_id").notNull(),
	campaignId: varchar("campaign_id", { length: 64 }).notNull(),
	adGroupId: varchar("ad_group_id", { length: 64 }),
	keywordId: varchar("keyword_id", { length: 64 }),
	targetId: varchar("target_id", { length: 64 }),
	dataSetId: varchar("data_set_id", { length: 64 }).notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	reportDate: date("report_date", { mode: 'string' }).notNull(),
	reportHour: int("report_hour"),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 12, scale: 4 }).default('0.0000'),
	sales: decimal({ precision: 12, scale: 2 }).default('0.00'),
	orders: int().default(0),
	units: int().default(0),
	dataSource: mysqlEnum("data_source", ['ams','api','merged']).default('ams'),
	lastUpdatedFromAms: timestamp("last_updated_from_ams", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("ams_perf_account_date").on(table.accountId, table.reportDate),
	index("ams_perf_campaign").on(table.campaignId),
	index("ams_perf_dataset").on(table.dataSetId),
]);

export const amsSubscriptions = mysqlTable("ams_subscriptions", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	subscriptionId: varchar({ length: 255 }).notNull(),
	dataSetId: varchar({ length: 100 }).notNull(),
	name: varchar({ length: 255 }),
	sqsArn: varchar({ length: 500 }),
	status: varchar({ length: 50 }).default('PENDING'),
	profileId: varchar({ length: 100 }),
	marketplace: varchar({ length: 50 }),
	errorMessage: text(),
	lastMessageAt: datetime({ mode: 'string'}),
	messageCount: int().default(0),
	createdAt: datetime({ mode: 'string'}).default('CURRENT_TIMESTAMP'),
	updatedAt: datetime({ mode: 'string'}).default(sql`(CURRENT_TIMESTAMP)`),
},
(table) => [
	index("idx_account").on(table.accountId),
	index("idx_status").on(table.status),
	index("subscriptionId").on(table.subscriptionId),
]);

export const anomalyAlertLogs = mysqlTable("anomaly_alert_logs", {
	id: int().autoincrement().notNull(),
	ruleId: int().notNull(),
	userId: int().notNull(),
	accountId: int(),
	anomalyType: mysqlEnum(['bid_spike','bid_drop','batch_size','budget_change','acos_spike','spend_velocity','click_anomaly','conversion_drop']).notNull(),
	detectedValue: decimal({ precision: 10, scale: 2 }).notNull(),
	thresholdValue: decimal({ precision: 10, scale: 2 }).notNull(),
	deviationPercent: decimal({ precision: 5, scale: 2 }),
	affectedTargetType: varchar({ length: 50 }),
	affectedTargetId: int(),
	affectedTargetName: varchar({ length: 500 }),
	operationLogId: int(),
	actionTaken: mysqlEnum(['none','alerted','paused','rolled_back','blocked']).default('alerted').notNull(),
	notificationSent: tinyint().default(0).notNull(),
	notificationSentAt: timestamp({ mode: 'string' }),
	acknowledged: tinyint().default(0).notNull(),
	acknowledgedBy: int(),
	acknowledgedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const anomalyDetectionRules = mysqlTable("anomaly_detection_rules", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	ruleName: varchar({ length: 200 }).notNull(),
	ruleDescription: text(),
	anomalyType: mysqlEnum(['bid_spike','bid_drop','batch_size','budget_change','acos_spike','spend_velocity','click_anomaly','conversion_drop']).notNull(),
	detectionMethod: mysqlEnum(['threshold','percentage_change','absolute_change','rate_limit','statistical']).notNull(),
	thresholdValue: decimal({ precision: 10, scale: 2 }),
	percentageThreshold: decimal({ precision: 5, scale: 2 }),
	absoluteThreshold: decimal({ precision: 10, scale: 2 }),
	timeWindowMinutes: int().default(60),
	minDataPoints: int().default(5),
	actionType: mysqlEnum(['alert_only','pause_and_alert','rollback_and_alert','block_operation']).default('alert_only').notNull(),
	isEnabled: tinyint().default(1).notNull(),
	priority: int().default(0),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const apiCallLogs = mysqlTable("api_call_logs", {
	id: int().autoincrement().notNull(),
	userId: int(),
	accountId: int().notNull(),
	apiType: varchar({ length: 50 }).notNull(),
	endpoint: varchar({ length: 255 }).notNull(),
	method: varchar({ length: 10 }).notNull(),
	statusCode: int(),
	responseTime: int(),
	isError: tinyint().default(0),
	errorCode: varchar({ length: 50 }),
	errorMessage: text(),
	retryCount: int().default(0),
	isRetry: tinyint().default(0),
	originalRequestId: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const apiOperationLogs = mysqlTable("api_operation_logs", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	operationType: mysqlEnum(['bid_adjustment','budget_change','campaign_status','keyword_status','negative_keyword','target_status','batch_operation','api_sync','auto_optimization','manual_operation','other']).notNull(),
	targetType: mysqlEnum(['campaign','ad_group','keyword','product_target','search_term','account','multiple']).notNull(),
	targetId: int(),
	targetName: varchar({ length: 500 }),
	actionDescription: text().notNull(),
	previousValue: text(),
	newValue: text(),
	changeAmount: decimal({ precision: 10, scale: 2 }),
	changePercent: decimal({ precision: 5, scale: 2 }),
	affectedCount: int().default(1),
	batchOperationId: int(),
	status: mysqlEnum(['success','failed','pending','rolled_back']).default('success').notNull(),
	errorMessage: text(),
	source: mysqlEnum(['manual','auto_optimization','scheduled_task','api_callback','batch_operation']).default('manual').notNull(),
	ipAddress: varchar({ length: 45 }),
	userAgent: text(),
	riskLevel: mysqlEnum(['low','medium','high','critical']).default('low').notNull(),
	requiresReview: tinyint().default(0),
	reviewedBy: int(),
	reviewedAt: timestamp({ mode: 'string' }),
	executedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const apiRateLimits = mysqlTable("api_rate_limits", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	apiType: mysqlEnum(['campaigns','ad_groups','keywords','reports','bidding','bulk_operations']).notNull(),
	maxRequestsPerSecond: int().default(10),
	maxRequestsPerMinute: int().default(100),
	maxRequestsPerDay: int().default(10000),
	currentSecondCount: int().default(0),
	currentMinuteCount: int().default(0),
	currentDayCount: int().default(0),
	secondResetAt: timestamp({ mode: 'string' }),
	minuteResetAt: timestamp({ mode: 'string' }),
	dayResetAt: timestamp({ mode: 'string' }),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const apiRequestQueue = mysqlTable("api_request_queue", {
	id: int().autoincrement().notNull(),
	userId: int(),
	accountId: int().notNull(),
	apiType: varchar({ length: 50 }).notNull(),
	endpoint: varchar({ length: 255 }).notNull(),
	method: varchar({ length: 10 }).notNull(),
	requestBody: json(),
	priority: mysqlEnum(['low','normal','high','critical']).default('normal'),
	status: mysqlEnum(['pending','processing','completed','failed','cancelled']).default('pending'),
	maxRetries: int().default(3),
	retryCount: int().default(0),
	retryAfter: timestamp({ mode: 'string' }),
	responseData: json(),
	errorMessage: text(),
	scheduledAt: timestamp({ mode: 'string' }),
	startedAt: timestamp({ mode: 'string' }),
	completedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const attributionCorrectionRecords = mysqlTable("attribution_correction_records", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int().notNull(),
	biddingLogId: int().notNull(),
	campaignId: int().notNull(),
	correctionTargetType: mysqlEnum(['keyword','product_target']).notNull(),
	targetId: int().notNull(),
	targetName: varchar({ length: 500 }),
	originalAdjustmentDate: timestamp({ mode: 'string' }).notNull(),
	originalBid: decimal({ precision: 10, scale: 2 }).notNull(),
	adjustedBid: decimal({ precision: 10, scale: 2 }).notNull(),
	adjustmentReason: varchar({ length: 255 }),
	metricsAtAdjustment: text(),
	metricsAfterAttribution: text(),
	wasIncorrect: tinyint().default(0),
	correctionType: mysqlEnum(['over_decreased','over_increased','correct']),
	suggestedBid: decimal({ precision: 10, scale: 2 }),
	confidenceScore: decimal({ precision: 3, scale: 2 }),
	correctionStatus: mysqlEnum(['pending_review','approved','applied','dismissed']).default('pending_review'),
	appliedAt: timestamp({ mode: 'string' }),
	appliedBy: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const auditLogs = mysqlTable("audit_logs", {
	organizationId: int("organization_id"),
	userId: int("user_id"),
	userName: varchar("user_name", { length: 255 }),
	id: int().autoincrement().notNull(),
	userEmail: varchar({ length: 255 }),
	actionType: mysqlEnum(['account_create','account_update','account_delete','account_connect','account_disconnect','campaign_create','campaign_update','campaign_delete','campaign_pause','campaign_enable','bid_adjust_single','bid_adjust_batch','bid_rollback','negative_add_single','negative_add_batch','negative_remove','performance_group_create','performance_group_update','performance_group_delete','automation_enable','automation_disable','automation_config_update','scheduler_task_create','scheduler_task_update','scheduler_task_delete','scheduler_task_run','team_member_invite','team_member_update','team_member_remove','team_permission_update','data_import','data_export','settings_update','notification_config_update','other']).notNull(),
	targetType: mysqlEnum(['account','campaign','ad_group','keyword','product_target','performance_group','negative_keyword','bid','automation','scheduler','team_member','permission','settings','data','other']),
	targetId: varchar({ length: 255 }),
	targetName: varchar({ length: 500 }),
	description: text(),
	previousValue: json(),
	newValue: json(),
	metadata: json(),
	accountId: int(),
	accountName: varchar({ length: 255 }),
	ipAddress: varchar({ length: 45 }),
	userAgent: text(),
	requestId: varchar({ length: 64 }),
	status: mysqlEnum(['success','failed','partial']).default('success'),
	errorMessage: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const autoPauseRecords = mysqlTable("auto_pause_records", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int().notNull(),
	pauseReason: mysqlEnum(['spend_limit','anomaly_detected','manual_trigger','scheduled','api_error']).notNull(),
	triggerSource: varchar({ length: 100 }).notNull(),
	triggerRuleId: int(),
	affectedCampaigns: int().default(0),
	affectedAdGroups: int().default(0),
	affectedKeywords: int().default(0),
	previousState: text(),
	isPaused: tinyint().default(1).notNull(),
	pausedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	resumedAt: timestamp({ mode: 'string' }),
	resumedBy: int(),
	resumeReason: text(),
	isResumed: tinyint().default(0).notNull(),
	autoResumeEnabled: tinyint().default(0).notNull(),
	autoResumeAt: timestamp({ mode: 'string' }),
	notificationSent: tinyint().default(0).notNull(),
	notificationSentAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const autoTargetingPerformance = mysqlTable("auto_targeting_performance", {
	id: int().autoincrement().notNull(),
	campaignId: varchar("campaign_id", { length: 50 }).notNull(),
	adGroupId: varchar("ad_group_id", { length: 50 }).notNull(),
	targetingType: mysqlEnum("targeting_type", ['close_match','loose_match','substitutes','complements']).notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	date: date({ mode: 'string' }).notNull(),
	impressions: int().default(0),
	clicks: int().default(0),
	cost: decimal({ precision: 10, scale: 2 }).default('0'),
	sales: decimal({ precision: 10, scale: 2 }).default('0'),
	orders: int().default(0),
	units: int().default(0),
	acos: decimal({ precision: 10, scale: 4 }),
	roas: decimal({ precision: 10, scale: 4 }),
	ctr: decimal({ precision: 10, scale: 6 }),
	cvr: decimal({ precision: 10, scale: 6 }),
	cpc: decimal({ precision: 10, scale: 4 }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("unique_perf").on(table.campaignId, table.adGroupId, table.targetingType, table.date),
]);

export const autoTargetingSettings = mysqlTable("auto_targeting_settings", {
	id: int().autoincrement().notNull(),
	campaignId: varchar("campaign_id", { length: 50 }).notNull(),
	adGroupId: varchar("ad_group_id", { length: 50 }).notNull(),
	targetingType: mysqlEnum("targeting_type", ['close_match','loose_match','substitutes','complements']).notNull(),
	targetingStatus: mysqlEnum("targeting_status", ['enabled','paused']).default('enabled'),
	bid: decimal({ precision: 10, scale: 2 }),
	suggestedBid: decimal("suggested_bid", { precision: 10, scale: 2 }),
	bidRangeLow: decimal("bid_range_low", { precision: 10, scale: 2 }),
	bidRangeHigh: decimal("bid_range_high", { precision: 10, scale: 2 }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("unique_targeting").on(table.campaignId, table.adGroupId, table.targetingType),
]);

export const batchMarginalBenefitAnalysis = mysqlTable("batch_marginal_benefit_analysis", {
	id: int().autoincrement().notNull(),
	accountId: int("account_id").notNull(),
	userId: int("user_id").notNull(),
	analysisName: varchar("analysis_name", { length: 255 }),
	campaignIds: json("campaign_ids"),
	campaignCount: int("campaign_count").default(0),
	optimizationGoal: mysqlEnum("optimization_goal", ['maximize_roas','minimize_acos','maximize_sales','balanced']).notNull(),
	analysisStatus: mysqlEnum("analysis_status", ['pending','running','completed','failed']).default('pending'),
	totalCurrentSpend: decimal("total_current_spend", { precision: 15, scale: 2 }),
	totalCurrentSales: decimal("total_current_sales", { precision: 15, scale: 2 }),
	totalExpectedSpend: decimal("total_expected_spend", { precision: 15, scale: 2 }),
	totalExpectedSales: decimal("total_expected_sales", { precision: 15, scale: 2 }),
	overallRoasChange: decimal("overall_roas_change", { precision: 10, scale: 4 }),
	overallAcosChange: decimal("overall_acos_change", { precision: 10, scale: 4 }),
	avgConfidence: decimal("avg_confidence", { precision: 5, scale: 4 }),
	analysisResults: json("analysis_results"),
	recommendations: json(),
	errorMessage: text("error_message"),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("batch_mb_account").on(table.accountId),
	index("batch_mb_status").on(table.analysisStatus),
]);

export const batchOperationItems = mysqlTable("batch_operation_items", {
	id: int().autoincrement().notNull(),
	batchId: int().notNull(),
	entityType: mysqlEnum(['keyword','product_target','campaign','ad_group']).notNull(),
	entityId: int().notNull(),
	entityName: varchar({ length: 500 }),
	negativeKeyword: varchar({ length: 500 }),
	negativeMatchType: mysqlEnum(['negative_phrase','negative_exact']),
	negativeLevel: mysqlEnum(['ad_group','campaign']).default('ad_group'),
	currentBid: decimal({ precision: 10, scale: 2 }),
	newBid: decimal({ precision: 10, scale: 2 }),
	bidChangePercent: decimal({ precision: 5, scale: 2 }),
	bidChangeReason: varchar({ length: 255 }),
	itemStatus: mysqlEnum(['pending','success','failed','skipped','rolled_back']).default('pending'),
	errorMessage: text(),
	previousValue: text(),
	itemExecutedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const batchOperations = mysqlTable("batch_operations", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	operationType: mysqlEnum(['negative_keyword','bid_adjustment','keyword_migration','campaign_status']).notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	batchStatus: mysqlEnum(['pending','approved','executing','completed','failed','cancelled','rolled_back']).default('pending'),
	totalItems: int().default(0),
	processedItems: int().default(0),
	successItems: int().default(0),
	failedItems: int().default(0),
	requiresApproval: tinyint().default(1),
	approvedBy: int(),
	approvedAt: timestamp({ mode: 'string' }),
	executedBy: int(),
	executedAt: timestamp({ mode: 'string' }),
	completedAt: timestamp({ mode: 'string' }),
	canRollback: tinyint().default(1),
	rolledBackAt: timestamp({ mode: 'string' }),
	rolledBackBy: int(),
	sourceType: varchar({ length: 64 }),
	sourceTaskId: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const bidAdjustmentHistory = mysqlTable("bid_adjustment_history", {
	id: int().autoincrement().notNull(),
	accountId: int("account_id").notNull(),
	campaignId: int("campaign_id"),
	campaignName: varchar("campaign_name", { length: 500 }),
	performanceGroupId: int("performance_group_id"),
	performanceGroupName: varchar("performance_group_name", { length: 255 }),
	keywordId: int("keyword_id"),
	keywordText: varchar("keyword_text", { length: 500 }),
	matchType: varchar("match_type", { length: 32 }),
	previousBid: decimal("previous_bid", { precision: 10, scale: 2 }).notNull(),
	newBid: decimal("new_bid", { precision: 10, scale: 2 }).notNull(),
	bidChangePercent: decimal("bid_change_percent", { precision: 10, scale: 2 }),
	adjustmentType: mysqlEnum("adjustment_type", ['manual','auto_optimal','auto_dayparting','auto_placement','batch_campaign','batch_group']).default('manual'),
	adjustmentReason: text("adjustment_reason"),
	expectedProfitIncrease: decimal("expected_profit_increase", { precision: 10, scale: 2 }),
	optimizationScore: int("optimization_score"),
	appliedBy: varchar("applied_by", { length: 255 }),
	appliedAt: timestamp("applied_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	status: mysqlEnum(['applied','pending','failed','rolled_back']).default('applied'),
	errorMessage: text("error_message"),
	actualProfit7D: decimal("actual_profit_7d", { precision: 10, scale: 2 }),
	actualProfit14D: decimal("actual_profit_14d", { precision: 10, scale: 2 }),
	actualProfit30D: decimal("actual_profit_30d", { precision: 10, scale: 2 }),
	actualImpressions7D: int("actual_impressions_7d"),
	actualClicks7D: int("actual_clicks_7d"),
	actualConversions7D: int("actual_conversions_7d"),
	actualSpend7D: decimal("actual_spend_7d", { precision: 10, scale: 2 }),
	actualRevenue7D: decimal("actual_revenue_7d", { precision: 10, scale: 2 }),
	trackingUpdatedAt: timestamp("tracking_updated_at", { mode: 'string' }),
	rolledBackAt: timestamp("rolled_back_at", { mode: 'string' }),
	rolledBackBy: varchar("rolled_back_by", { length: 255 }),
},
(table) => [
	index("idx_account_id").on(table.accountId),
	index("idx_campaign_id").on(table.campaignId),
	index("idx_performance_group_id").on(table.performanceGroupId),
	index("idx_applied_at").on(table.appliedAt),
	index("idx_adjustment_type").on(table.adjustmentType),
]);

export const bidObjectProfitEstimates = mysqlTable("bid_object_profit_estimates", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: varchar({ length: 50 }).notNull(),
	bidObjectType: mysqlEnum(['keyword','asin']).notNull(),
	bidObjectId: varchar({ length: 100 }).notNull(),
	baseBid: decimal({ precision: 10, scale: 4 }),
	recommendedBaseBid: decimal({ precision: 10, scale: 4 }),
	topOfSearchAdjustment: int().default(0),
	productPageAdjustment: int().default(0),
	recommendedTopAdjustment: int(),
	recommendedProductAdjustment: int(),
	effectiveBidTop: decimal({ precision: 10, scale: 4 }),
	effectiveBidProduct: decimal({ precision: 10, scale: 4 }),
	effectiveBidRest: decimal({ precision: 10, scale: 4 }),
	estimatedProfitTop: decimal({ precision: 12, scale: 2 }),
	estimatedProfitProduct: decimal({ precision: 12, scale: 2 }),
	estimatedProfitRest: decimal({ precision: 12, scale: 2 }),
	totalEstimatedProfit: decimal({ precision: 12, scale: 2 }),
	estimatedClicksTop: int(),
	estimatedClicksProduct: int(),
	estimatedClicksRest: int(),
	estimatedSpendTop: decimal({ precision: 12, scale: 2 }),
	estimatedSpendProduct: decimal({ precision: 12, scale: 2 }),
	estimatedSpendRest: decimal({ precision: 12, scale: 2 }),
	totalEstimatedSpend: decimal({ precision: 12, scale: 2 }),
	estimatedRevenueTop: decimal({ precision: 12, scale: 2 }),
	estimatedRevenueProduct: decimal({ precision: 12, scale: 2 }),
	estimatedRevenueRest: decimal({ precision: 12, scale: 2 }),
	totalEstimatedRevenue: decimal({ precision: 12, scale: 2 }),
	estimatedRoas: decimal({ precision: 10, scale: 4 }),
	estimatedAcoS: decimal({ precision: 8, scale: 4 }),
	profitImprovementPotential: decimal({ precision: 12, scale: 2 }),
	profitImprovementPercent: decimal({ precision: 8, scale: 4 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow(),
});

export const bidPerformanceHistory = mysqlTable("bid_performance_history", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: varchar({ length: 50 }).notNull(),
	bidObjectType: mysqlEnum(['keyword','asin']).notNull(),
	bidObjectId: varchar({ length: 100 }).notNull(),
	bid: decimal({ precision: 10, scale: 4 }).notNull(),
	effectiveCpc: decimal({ precision: 10, scale: 4 }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	date: date({ mode: 'string' }).notNull(),
	timeSlot: int(),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 12, scale: 2 }).default('0'),
	sales: decimal({ precision: 12, scale: 2 }).default('0'),
	orders: int().default(0),
	ctr: decimal({ precision: 8, scale: 6 }),
	cvr: decimal({ precision: 8, scale: 6 }),
	acos: decimal({ precision: 8, scale: 4 }),
	roas: decimal({ precision: 10, scale: 4 }),
	revenue: decimal({ precision: 12, scale: 2 }),
	profit: decimal({ precision: 12, scale: 2 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP'),
});

export const biddingLogs = mysqlTable("bidding_logs", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: int().notNull(),
	adGroupId: int(),
	logTargetType: mysqlEnum(['keyword','product_target','placement']).notNull(),
	targetId: int().notNull(),
	targetName: varchar({ length: 500 }),
	logMatchType: varchar({ length: 32 }),
	actionType: mysqlEnum(['increase','decrease','set']).notNull(),
	previousBid: decimal({ precision: 10, scale: 2 }).notNull(),
	newBid: decimal({ precision: 10, scale: 2 }).notNull(),
	bidChangePercent: decimal({ precision: 5, scale: 2 }),
	reason: text(),
	algorithmVersion: varchar({ length: 32 }),
	performanceData: json(),
	isIntradayAdjustment: tinyint().default(0),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const budgetAlertSettings = mysqlTable("budget_alert_settings", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	overspendingThreshold: decimal({ precision: 5, scale: 2 }).default('120'),
	underspendingThreshold: decimal({ precision: 5, scale: 2 }).default('50'),
	nearDepletionThreshold: decimal({ precision: 5, scale: 2 }).default('90'),
	checkFrequency: mysqlEnum(['hourly','every_4_hours','daily']).default('every_4_hours'),
	enableNotifications: tinyint().default(1),
	notifyOnOverspending: tinyint().default(1),
	notifyOnUnderspending: tinyint().default(1),
	notifyOnDepletion: tinyint().default(1),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const budgetAllocationConfigs = mysqlTable("budget_allocation_configs", {
	id: int().autoincrement().notNull(),
	accountId: int("account_id").notNull(),
	performanceGroupId: int("performance_group_id"),
	totalDailyBudget: decimal("total_daily_budget", { precision: 15, scale: 2 }).notNull(),
	minCampaignBudget: decimal("min_campaign_budget", { precision: 10, scale: 2 }).default('5.00'),
	maxCampaignBudgetPercent: decimal("max_campaign_budget_percent", { precision: 5, scale: 2 }).default('50.00'),
	reallocationFrequency: mysqlEnum("reallocation_frequency", ['daily','weekly','bi_weekly']).default('daily'),
	optimizationGoal: mysqlEnum("optimization_goal", ['maximize_sales','target_acos','target_roas','balanced']).default('balanced'),
	targetAcos: decimal("target_acos", { precision: 5, scale: 2 }),
	targetRoas: decimal("target_roas", { precision: 10, scale: 2 }),
	riskTolerance: mysqlEnum("risk_tolerance", ['low','medium','high']).default('medium'),
	conversionEfficiencyWeight: decimal("conversion_efficiency_weight", { precision: 5, scale: 2 }).default('0.30'),
	growthPotentialWeight: decimal("growth_potential_weight", { precision: 5, scale: 2 }).default('0.25'),
	maxAdjustmentPercent: decimal("max_adjustment_percent", { precision: 5, scale: 2 }).default('30.00'),
	minDailyBudget: decimal("min_daily_budget", { precision: 10, scale: 2 }).default('5.00'),
	cooldownDays: int("cooldown_days").default(3),
	newCampaignProtectionDays: int("new_campaign_protection_days").default(14),
	isActive: tinyint("is_active").default(1),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("idx_account_id").on(table.accountId),
	index("idx_performance_group_id").on(table.performanceGroupId),
]);

export const budgetAllocationHistory = mysqlTable("budget_allocation_history", {
	id: int().autoincrement().notNull(),
	configId: int("config_id").notNull(),
	campaignId: int("campaign_id").notNull(),
	previousBudget: decimal("previous_budget", { precision: 10, scale: 2 }).notNull(),
	newBudget: decimal("new_budget", { precision: 10, scale: 2 }).notNull(),
	changeReason: text("change_reason"),
	appliedBy: int("applied_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("idx_config_id").on(table.configId),
	index("idx_campaign_id").on(table.campaignId),
]);

export const budgetAllocationItems = mysqlTable("budget_allocation_items", {
	id: int().autoincrement().notNull(),
	allocationId: int().notNull(),
	campaignId: int().notNull(),
	currentBudget: decimal({ precision: 10, scale: 2 }).notNull(),
	recommendedBudget: decimal({ precision: 10, scale: 2 }).notNull(),
	budgetChange: decimal({ precision: 10, scale: 2 }).notNull(),
	changePercent: decimal({ precision: 10, scale: 2 }).notNull(),
	historicalSpend: decimal({ precision: 15, scale: 2 }),
	historicalSales: decimal({ precision: 15, scale: 2 }),
	historicalRoas: decimal({ precision: 10, scale: 2 }),
	historicalAcos: decimal({ precision: 10, scale: 2 }),
	historicalCtr: decimal({ precision: 10, scale: 4 }),
	historicalCvr: decimal({ precision: 10, scale: 4 }),
	predictedSpend: decimal({ precision: 15, scale: 2 }),
	predictedSales: decimal({ precision: 15, scale: 2 }),
	predictedRoas: decimal({ precision: 10, scale: 2 }),
	predictedAcos: decimal({ precision: 10, scale: 2 }),
	allocationReason: mysqlEnum(['high_roas','low_acos','high_conversion','growth_potential','new_product','seasonal_boost','low_roas','high_acos','low_conversion','budget_limit','maintain','rebalance']),
	reasonDetail: text(),
	priorityScore: decimal({ precision: 5, scale: 2 }),
	status: mysqlEnum(['pending','applied','skipped']).default('pending'),
	appliedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const budgetAllocationSuggestions = mysqlTable("budget_allocation_suggestions", {
	id: int().autoincrement().notNull(),
	configId: int("config_id").notNull(),
	campaignId: int("campaign_id").notNull(),
	currentBudget: decimal("current_budget", { precision: 10, scale: 2 }).notNull(),
	suggestedBudget: decimal("suggested_budget", { precision: 10, scale: 2 }).notNull(),
	budgetChange: decimal("budget_change", { precision: 10, scale: 2 }).notNull(),
	budgetChangePercent: decimal("budget_change_percent", { precision: 5, scale: 2 }).notNull(),
	reason: text(),
	confidenceScore: decimal("confidence_score", { precision: 3, scale: 2 }),
	expectedImpact: text("expected_impact"),
	status: mysqlEnum(['pending','approved','rejected','applied']).default('pending'),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	appliedAt: timestamp("applied_at", { mode: 'string' }),
},
(table) => [
	index("idx_config_id").on(table.configId),
	index("idx_campaign_id").on(table.campaignId),
	index("idx_status").on(table.status),
]);

export const budgetAllocationTracking = mysqlTable("budget_allocation_tracking", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	allocationId: int().notNull(),
	trackingPeriod: mysqlEnum(['7_days','14_days','30_days']).default('7_days'),
	startDate: timestamp({ mode: 'string' }).notNull(),
	endDate: timestamp({ mode: 'string' }),
	baselineStartDate: timestamp({ mode: 'string' }).notNull(),
	baselineEndDate: timestamp({ mode: 'string' }).notNull(),
	baselineSpend: decimal({ precision: 15, scale: 2 }),
	baselineSales: decimal({ precision: 15, scale: 2 }),
	baselineRoas: decimal({ precision: 10, scale: 2 }),
	baselineAcos: decimal({ precision: 10, scale: 2 }),
	baselineConversions: int(),
	baselineCtr: decimal({ precision: 10, scale: 4 }),
	baselineCpc: decimal({ precision: 10, scale: 2 }),
	currentSpend: decimal({ precision: 15, scale: 2 }),
	currentSales: decimal({ precision: 15, scale: 2 }),
	currentRoas: decimal({ precision: 10, scale: 2 }),
	currentAcos: decimal({ precision: 10, scale: 2 }),
	currentConversions: int(),
	currentCtr: decimal({ precision: 10, scale: 4 }),
	currentCpc: decimal({ precision: 10, scale: 2 }),
	roasChange: decimal({ precision: 10, scale: 2 }),
	acosChange: decimal({ precision: 10, scale: 2 }),
	salesChange: decimal({ precision: 15, scale: 2 }),
	spendChange: decimal({ precision: 15, scale: 2 }),
	effectRating: mysqlEnum(['excellent','good','neutral','poor','very_poor']),
	effectSummary: text(),
	status: mysqlEnum(['tracking','completed','cancelled']).default('tracking'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const budgetAllocations = mysqlTable("budget_allocations", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	goalId: int(),
	allocationName: varchar({ length: 255 }).notNull(),
	description: text(),
	totalBudget: decimal({ precision: 15, scale: 2 }).notNull(),
	allocatedBudget: decimal({ precision: 15, scale: 2 }).notNull(),
	predictedSales: decimal({ precision: 15, scale: 2 }),
	predictedRoas: decimal({ precision: 10, scale: 2 }),
	predictedAcos: decimal({ precision: 10, scale: 2 }),
	confidenceScore: decimal({ precision: 5, scale: 2 }),
	status: mysqlEnum(['draft','pending','approved','applied','rejected']).default('draft'),
	appliedAt: timestamp({ mode: 'string' }),
	appliedBy: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const budgetAutoExecutionConfigs = mysqlTable("budget_auto_execution_configs", {
	id: int().autoincrement().notNull(),
	accountId: int("account_id").notNull(),
	performanceGroupId: int("performance_group_id"),
	configName: varchar("config_name", { length: 255 }),
	isEnabled: tinyint("is_enabled").default(0),
	executionFrequency: mysqlEnum("execution_frequency", ['daily', 'weekly', 'biweekly', 'monthly']).default('daily'),
	executionTime: time("execution_time").default('06:00:00'),
	executionDayOfWeek: int("execution_day_of_week"),
	executionDayOfMonth: int("execution_day_of_month"),
	minDataDays: int("min_data_days").default(7),
	minConfidenceScore: decimal("min_confidence_score", { precision: 3, scale: 2 }).default('0.70'),
	maxBudgetChangePercent: decimal("max_budget_change_percent", { precision: 5, scale: 2 }).default('30.00'),
	maxAdjustmentPercent: decimal("max_adjustment_percent", { precision: 5, scale: 2 }).default('15.00'),
	minBudget: decimal("min_budget", { precision: 10, scale: 2 }).default('5.00'),
	requireApproval: tinyint("require_approval").default(0),
	requireApprovalAbove: decimal("require_approval_above", { precision: 10, scale: 2 }).default('100.00'),
	notifyOnExecution: tinyint("notify_on_execution").default(1),
	notifyOnError: tinyint("notify_on_error").default(1),
	notificationEmail: varchar("notification_email", { length: 255 }),
	nextExecutionAt: datetime("next_execution_at", { mode: 'string' }),
	lastExecutionAt: datetime("last_execution_at", { mode: 'string' }),
	createdBy: int("created_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("idx_account_id").on(table.accountId),
	index("idx_performance_group_id").on(table.performanceGroupId),
]);

export const budgetAutoExecutionDetails = mysqlTable("budget_auto_execution_details", {
	id: int().autoincrement().notNull(),
	executionId: int("execution_id"),
	historyId: int("history_id").notNull(),
	campaignId: int("campaign_id").notNull(),
	campaignName: varchar("campaign_name", { length: 500 }),
	previousBudget: decimal("previous_budget", { precision: 10, scale: 2 }).notNull(),
	newBudget: decimal("new_budget", { precision: 10, scale: 2 }).notNull(),
	budgetBefore: decimal("budget_before", { precision: 10, scale: 2 }),
	budgetAfter: decimal("budget_after", { precision: 10, scale: 2 }),
	budgetChange: decimal("budget_change", { precision: 10, scale: 2 }).notNull(),
	adjustmentPercent: decimal("adjustment_percent", { precision: 10, scale: 2 }),
	adjustmentReason: text("adjustment_reason"),
	compositeScore: decimal("composite_score", { precision: 10, scale: 4 }),
	riskLevel: varchar("risk_level", { length: 50 }),
	changeReason: text("change_reason"),
	status: mysqlEnum("status", ['success','failed','skipped','applied','error']).default('success'),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("idx_execution_id").on(table.executionId),
	index("idx_history_id").on(table.historyId),
	index("idx_campaign_id").on(table.campaignId),
]);

export const budgetAutoExecutionHistory = mysqlTable("budget_auto_execution_history", {
	id: int().autoincrement().notNull(),
	configId: int("config_id").notNull(),
	accountId: int("account_id"),
	executionTime: timestamp("execution_time", { mode: 'string' }),
	executionStartAt: datetime("execution_start_at", { mode: 'string' }),
	executionEndAt: datetime("execution_end_at", { mode: 'string' }),
	totalCampaigns: int("total_campaigns").default(0),
	campaignsAdjusted: int("campaigns_adjusted").default(0),
	skippedCampaigns: int("skipped_campaigns").default(0),
	errorCampaigns: int("error_campaigns").default(0),
	totalBudgetBefore: decimal("total_budget_before", { precision: 12, scale: 2 }).default('0'),
	totalBudgetAfter: decimal("total_budget_after", { precision: 12, scale: 2 }).default('0'),
	totalBudgetIncrease: decimal("total_budget_increase", { precision: 10, scale: 2 }).default('0'),
	totalBudgetDecrease: decimal("total_budget_decrease", { precision: 10, scale: 2 }).default('0'),
	status: mysqlEnum("status", ['running','completed','failed','cancelled','pending_approval','success','partial','skipped']).default('running'),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("idx_config_id").on(table.configId),
	index("idx_account_id").on(table.accountId),
	index("idx_execution_time").on(table.executionTime),
]);

export const budgetAutoExecutionLogs = mysqlTable("budget_auto_execution_logs", {
	id: int().autoincrement().notNull(),
	configId: int("config_id").notNull(),
	executionTime: timestamp("execution_time", { mode: 'string' }).notNull(),
	totalCampaigns: int("total_campaigns").default(0),
	campaignsAdjusted: int("campaigns_adjusted").default(0),
	totalBudgetChange: decimal("total_budget_change", { precision: 10, scale: 2 }).default('0'),
	status: mysqlEnum(['success','partial','failed']).default('success'),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("idx_config_id").on(table.configId),
	index("idx_execution_time").on(table.executionTime),
]);

// 投放词自动执行配置表
export const keywordAutoExecutionConfigs = mysqlTable("keyword_auto_execution_configs", {
	id: int().autoincrement().notNull(),
	accountId: int("account_id").notNull(),
	name: varchar({ length: 255 }).notNull(),
	isEnabled: tinyint("is_enabled").default(0),
	autoPauseEnabled: tinyint("auto_pause_enabled").default(1),
	pauseMinSpend: decimal("pause_min_spend", { precision: 10, scale: 2 }).default('50.00'),
	pauseMinClicks: int("pause_min_clicks").default(20),
	pauseMaxAcos: decimal("pause_max_acos", { precision: 5, scale: 2 }).default('100.00'),
	pauseMinDays: int("pause_min_days").default(14),
	pauseZeroConversions: tinyint("pause_zero_conversions").default(1),
	autoEnableEnabled: tinyint("auto_enable_enabled").default(0),
	enableMinConversions: int("enable_min_conversions").default(3),
	enableMinRoas: decimal("enable_min_roas", { precision: 10, scale: 2 }).default('2.00'),
	enableCooldownDays: int("enable_cooldown_days").default(30),
	maxDailyPauses: int("max_daily_pauses").default(50),
	maxDailyEnables: int("max_daily_enables").default(20),
	excludeTopPerformers: tinyint("exclude_top_performers").default(1),
	topPerformerThreshold: decimal("top_performer_threshold", { precision: 5, scale: 2 }).default('10.00'),
	enableRollback: tinyint("enable_rollback").default(1),
	rollbackWindowHours: int("rollback_window_hours").default(48),
	rollbackTriggerSpendDrop: decimal("rollback_trigger_spend_drop", { precision: 5, scale: 2 }).default('30.00'),
	notifyOnExecution: tinyint("notify_on_execution").default(1),
	notifyOnRollback: tinyint("notify_on_rollback").default(1),
	requireApproval: tinyint("require_approval").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("idx_account_id").on(table.accountId),
]);

// 投放词自动执行历史表
export const keywordAutoExecutionHistory = mysqlTable("keyword_auto_execution_history", {
	id: int().autoincrement().notNull(),
	configId: int("config_id").notNull(),
	accountId: int("account_id"),
	executionTime: datetime("execution_time", { mode: 'string' }),
	keywordsPaused: int("keywords_paused").default(0),
	keywordsEnabled: int("keywords_enabled").default(0),
	keywordsSkipped: int("keywords_skipped").default(0),
	keywordsError: int("keywords_error").default(0),
	estimatedSpendSaved: decimal("estimated_spend_saved", { precision: 12, scale: 2 }).default('0'),
	status: mysqlEnum("status", ['running','completed','failed','cancelled']).default('running'),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("idx_config_id").on(table.configId),
	index("idx_account_id").on(table.accountId),
]);

// 投放词自动执行详情表
export const keywordAutoExecutionDetails = mysqlTable("keyword_auto_execution_details", {
	id: int().autoincrement().notNull(),
	executionId: int("execution_id").notNull(),
	keywordId: int("keyword_id").notNull(),
	keywordText: varchar("keyword_text", { length: 500 }),
	actionType: mysqlEnum("action_type", ['pause','enable','rollback']).notNull(),
	statusBefore: varchar("status_before", { length: 50 }),
	statusAfter: varchar("status_after", { length: 50 }),
	triggerReason: text("trigger_reason"),
	spend: decimal({ precision: 10, scale: 2 }),
	sales: decimal({ precision: 10, scale: 2 }),
	acos: decimal({ precision: 10, scale: 2 }),
	roas: decimal({ precision: 10, scale: 2 }),
	clicks: int(),
	impression: int(),
	orders: int(),
	status: mysqlEnum("status", ['success','failed','skipped','applied']).default('success'),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("idx_execution_id").on(table.executionId),
	index("idx_keyword_id").on(table.keywordId),
]);

export const budgetConsumptionAlerts = mysqlTable("budget_consumption_alerts", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	campaignId: int().notNull(),
	alertType: mysqlEnum(['overspending','underspending','budget_depleted','near_depletion']).notNull(),
	severity: mysqlEnum(['low','medium','high','critical']).default('medium'),
	dailyBudget: decimal({ precision: 10, scale: 2 }).notNull(),
	currentSpend: decimal({ precision: 10, scale: 2 }).notNull(),
	expectedSpend: decimal({ precision: 10, scale: 2 }),
	spendRate: decimal({ precision: 10, scale: 4 }),
	projectedDailySpend: decimal({ precision: 10, scale: 2 }),
	deviationPercent: decimal({ precision: 10, scale: 2 }),
	recommendation: text(),
	status: mysqlEnum(['active','acknowledged','resolved']).default('active'),
	acknowledgedAt: timestamp({ mode: 'string' }),
	resolvedAt: timestamp({ mode: 'string' }),
	notificationSent: tinyint().default(0),
	notificationSentAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const budgetGoals = mysqlTable("budget_goals", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	goalType: mysqlEnum(['sales_target','roas_target','acos_target','profit_target','market_share']).notNull(),
	targetValue: decimal({ precision: 15, scale: 2 }).notNull(),
	periodType: mysqlEnum(['daily','weekly','monthly','quarterly']).default('monthly'),
	startDate: timestamp({ mode: 'string' }),
	endDate: timestamp({ mode: 'string' }),
	totalBudget: decimal({ precision: 15, scale: 2 }),
	minCampaignBudget: decimal({ precision: 10, scale: 2 }).default('10.00'),
	maxCampaignBudget: decimal({ precision: 10, scale: 2 }),
	prioritizeHighRoas: tinyint().default(1),
	prioritizeNewProducts: tinyint().default(0),
	status: mysqlEnum(['active','paused','completed','expired']).default('active'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const budgetHistory = mysqlTable("budget_history", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	campaignId: int().notNull(),
	allocationId: int(),
	previousBudget: decimal({ precision: 10, scale: 2 }).notNull(),
	newBudget: decimal({ precision: 10, scale: 2 }).notNull(),
	changeAmount: decimal({ precision: 10, scale: 2 }).notNull(),
	changePercent: decimal({ precision: 10, scale: 2 }).notNull(),
	source: mysqlEnum(['manual','auto_allocation','scheduled','rule_based','api_sync']).notNull(),
	reason: text(),
	snapshotRoas: decimal({ precision: 10, scale: 2 }),
	snapshotAcos: decimal({ precision: 10, scale: 2 }),
	snapshotSpend: decimal({ precision: 15, scale: 2 }),
	snapshotSales: decimal({ precision: 15, scale: 2 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const campaignPerformanceSnapshots = mysqlTable("campaign_performance_snapshots", {
	id: int().autoincrement().notNull(),
	campaignId: int("campaign_id").notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	snapshotDate: date("snapshot_date", { mode: 'string' }).notNull(),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 10, scale: 2 }).default('0'),
	sales: decimal({ precision: 10, scale: 2 }).default('0'),
	orders: int().default(0),
	acos: decimal({ precision: 5, scale: 2 }),
	roas: decimal({ precision: 10, scale: 2 }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("uk_campaign_date").on(table.campaignId, table.snapshotDate),
	index("idx_campaign_id").on(table.campaignId),
	index("idx_snapshot_date").on(table.snapshotDate),
]);

export const campaigns = mysqlTable("campaigns", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	performanceGroupId: int(),
	campaignId: varchar({ length: 64 }).notNull(),
	campaignName: varchar({ length: 500 }).notNull(),
	campaignType: mysqlEnum(['sp_auto','sp_manual','sb','sd']).notNull(),
	targetingType: mysqlEnum(['auto','manual']).default('manual'),
	maxBid: decimal({ precision: 10, scale: 2 }),
	intradayBiddingEnabled: tinyint(),
	campaignConversionValueType: mysqlEnum(['sales','units','custom','inherit']).default('inherit'),
	campaignConversionValueSource: mysqlEnum(['platform','custom','inherit']).default('inherit'),
	placementTopSearchBidAdjustment: int().default(0),
	placementProductPageBidAdjustment: int().default(0),
	placementRestBidAdjustment: int().default(0),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 10, scale: 2 }).default('0.00'),
	sales: decimal({ precision: 10, scale: 2 }).default('0.00'),
	orders: int().default(0),
	acos: decimal({ precision: 5, scale: 2 }),
	roas: decimal({ precision: 10, scale: 2 }),
	ctr: decimal({ precision: 5, scale: 4 }),
	cvr: decimal({ precision: 5, scale: 4 }),
	cpc: decimal({ precision: 10, scale: 2 }),
	campaignStatus: mysqlEnum(['enabled','paused','archived']).default('enabled'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	dailyBudget: decimal({ precision: 10, scale: 2 }),
	optimizationStatus: mysqlEnum(['managed','unmanaged']).default('unmanaged'),
	unitsOrdered: int("units_ordered").default(0),
	averageOrderValue: decimal("average_order_value", { precision: 10, scale: 2 }),
	sales7D: decimal("sales_7d", { precision: 10, scale: 2 }).default('0'),
	orders7D: int("orders_7d").default(0),
	unitsOrdered7D: int("units_ordered_7d").default(0),
	sales30D: decimal("sales_30d", { precision: 10, scale: 2 }).default('0'),
	orders30D: int("orders_30d").default(0),
	unitsOrdered30D: int("units_ordered_30d").default(0),
	ntbOrders: int("ntb_orders").default(0),
	ntbSales: decimal("ntb_sales", { precision: 10, scale: 2 }).default('0'),
	ntbUnitsOrdered: int("ntb_units_ordered").default(0),
	ntbOrdersPercent: decimal("ntb_orders_percent", { precision: 5, scale: 2 }),
	ntbSalesPercent: decimal("ntb_sales_percent", { precision: 5, scale: 2 }),
	topOfSearchImpressions: int("top_of_search_impressions").default(0),
	topOfSearchClicks: int("top_of_search_clicks").default(0),
	topOfSearchSpend: decimal("top_of_search_spend", { precision: 10, scale: 2 }).default('0'),
	topOfSearchSales: decimal("top_of_search_sales", { precision: 10, scale: 2 }).default('0'),
	productPageImpressions: int("product_page_impressions").default(0),
	productPageClicks: int("product_page_clicks").default(0),
	productPageSpend: decimal("product_page_spend", { precision: 10, scale: 2 }).default('0'),
	productPageSales: decimal("product_page_sales", { precision: 10, scale: 2 }).default('0'),
	restOfSearchImpressions: int("rest_of_search_impressions").default(0),
	restOfSearchClicks: int("rest_of_search_clicks").default(0),
	restOfSearchSpend: decimal("rest_of_search_spend", { precision: 10, scale: 2 }).default('0'),
	restOfSearchSales: decimal("rest_of_search_sales", { precision: 10, scale: 2 }).default('0'),
	brandedSearches: int("branded_searches").default(0),
	brandedSearchesClicks: int("branded_searches_clicks").default(0),
	videoViews: int("video_views").default(0),
	videoViewRate: decimal("video_view_rate", { precision: 5, scale: 4 }),
	videoFirstQuartileViews: int("video_first_quartile_views").default(0),
	videoMidpointViews: int("video_midpoint_views").default(0),
	videoThirdQuartileViews: int("video_third_quartile_views").default(0),
	videoCompleteViews: int("video_complete_views").default(0),
	viewableImpressions: int("viewable_impressions").default(0),
	viewThroughConversions: int("view_through_conversions").default(0),
	viewThroughSales: decimal("view_through_sales", { precision: 10, scale: 2 }).default('0'),
	biddingStrategy: mysqlEnum("bidding_strategy", ['legacyForSales','autoForSales','manual','ruleBasedBidding']).default('legacyForSales'),
	budgetType: mysqlEnum("budget_type", ['daily','lifetime']).default('daily'),
	lifetimeBudget: decimal("lifetime_budget", { precision: 10, scale: 2 }),
	budgetUsagePercent: decimal("budget_usage_percent", { precision: 5, scale: 2 }),
	startDate: varchar("start_date", { length: 10 }),
	endDate: varchar("end_date", { length: 10 }),
	negativeKeywordsCount: int("negative_keywords_count").default(0),
	negativeTargetsCount: int("negative_targets_count").default(0),
	state: varchar({ length: 20 }).default('enabled'),
	country: varchar({ length: 50 }),
	retailer: varchar({ length: 100 }),
	portfolio: varchar({ length: 255 }),
	avgTimeInBudget: decimal({ precision: 5, scale: 2 }),
	budgetConverted: decimal({ precision: 10, scale: 2 }),
	costType: varchar({ length: 20 }),
	topOfSearchImpressionShare: decimal({ precision: 5, scale: 2 }),
	spendConverted: decimal({ precision: 10, scale: 2 }),
	cpcConverted: decimal({ precision: 10, scale: 2 }),
	detailPageViews: int().default(0),
	brandStorePageViews: int().default(0),
	salesConverted: decimal({ precision: 10, scale: 2 }),
	ntbSalesConverted: decimal({ precision: 10, scale: 2 }),
	longTermSalesConverted: decimal({ precision: 10, scale: 2 }),
	longTermSales: decimal({ precision: 10, scale: 2 }),
	longTermRoas: decimal({ precision: 10, scale: 2 }),
	cumulativeReach: int().default(0),
	householdReach: int().default(0),
	cpmConverted: decimal({ precision: 10, scale: 2 }),
	cpm: decimal({ precision: 10, scale: 2 }),
	vcpmConverted: decimal({ precision: 10, scale: 2 }),
	vcpm: decimal({ precision: 10, scale: 2 }),
	videoFirstQuartile: int().default(0),
	videoMidpoint: int().default(0),
	videoThirdQuartile: int().default(0),
	videoComplete: int().default(0),
	videoUnmute: int().default(0),
	vtr: decimal({ precision: 5, scale: 4 }),
	vctr: decimal({ precision: 5, scale: 4 }),
	topOfSearchBidAdjustment: decimal({ precision: 5, scale: 2 }),
	countryCode: varchar({ length: 10 }),
	portfolioId: varchar({ length: 64 }),
	portfolioName: varchar({ length: 255 }),
	adFormat: mysqlEnum("ad_format", ['productCollection','video','storeSpotlight','brandVideo']),
	landingPageType: mysqlEnum("landing_page_type", ['store','productList','customUrl']),
	landingPageUrl: varchar("landing_page_url", { length: 1000 }),
	storePageId: varchar("store_page_id", { length: 64 }),
	brandEntityId: varchar("brand_entity_id", { length: 64 }),
	headline: varchar({ length: 500 }),
	bidOptimization: mysqlEnum("bid_optimization", ['reach','pageVisits','conversions']),
	tactic: varchar({ length: 20 }),
	viewAttributedSales: decimal("view_attributed_sales", { precision: 15, scale: 2 }).default('0'),
	viewAttributedOrders: int("view_attributed_orders").default(0),
	viewAttributedUnits: int("view_attributed_units").default(0),
	viewAttributedDpv: int("view_attributed_dpv").default(0),
	viewAttributedNtbSales: decimal("view_attributed_ntb_sales", { precision: 15, scale: 2 }).default('0'),
	viewAttributedNtbOrders: int("view_attributed_ntb_orders").default(0),
});

export const collaborationNotificationRules = mysqlTable("collaboration_notification_rules", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	triggerActions: json(),
	triggerAccountIds: json(),
	notifyChannels: json(),
	notifyRecipients: json(),
	notificationTemplate: text(),
	includeDetails: tinyint().default(1),
	isActive: tinyint().default(1),
	priority: mysqlEnum(['low','medium','high','critical']).default('medium'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const collaborationNotifications = mysqlTable("collaboration_notifications", {
	id: int().autoincrement().notNull(),
	ruleId: int(),
	auditLogId: int(),
	title: varchar({ length: 500 }).notNull(),
	content: text().notNull(),
	actionType: varchar({ length: 100 }),
	actionUserId: int(),
	actionUserName: varchar({ length: 255 }),
	targetType: varchar({ length: 100 }),
	targetId: varchar({ length: 255 }),
	targetName: varchar({ length: 500 }),
	accountId: int(),
	accountName: varchar({ length: 255 }),
	channel: mysqlEnum(['app','email']).notNull(),
	recipientUserId: int().notNull(),
	recipientEmail: varchar({ length: 255 }),
	status: mysqlEnum(['pending','sent','read','failed']).default('pending'),
	readAt: timestamp({ mode: 'string' }),
	sentAt: timestamp({ mode: 'string' }),
	errorMessage: text(),
	priority: mysqlEnum(['low','medium','high','critical']).default('medium'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const correctionReviewSessions = mysqlTable("correction_review_sessions", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int().notNull(),
	periodStart: timestamp({ mode: 'string' }).notNull(),
	periodEnd: timestamp({ mode: 'string' }).notNull(),
	totalAdjustmentsReviewed: int().default(0),
	incorrectAdjustments: int().default(0),
	overDecreasedCount: int().default(0),
	overIncreasedCount: int().default(0),
	correctCount: int().default(0),
	estimatedLostRevenue: decimal({ precision: 10, scale: 2 }),
	estimatedWastedSpend: decimal({ precision: 10, scale: 2 }),
	potentialRecovery: decimal({ precision: 10, scale: 2 }),
	sessionStatus: mysqlEnum(['analyzing','ready_for_review','reviewed','corrections_applied']).default('analyzing'),
	reviewedAt: timestamp({ mode: 'string' }),
	reviewedBy: int(),
	correctionBatchId: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const dailyPerformance = mysqlTable("daily_performance", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: int(),
	performanceGroupId: int(),
	date: timestamp({ mode: 'string' }).notNull(),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 10, scale: 2 }).default('0.00'),
	sales: decimal({ precision: 10, scale: 2 }).default('0.00'),
	orders: int().default(0),
	dailyAcos: decimal({ precision: 5, scale: 2 }),
	dailyRoas: decimal({ precision: 10, scale: 2 }),
	conversions: int().default(0),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow(),
	unitsOrdered: int("units_ordered").default(0),
	averageOrderValue: decimal("average_order_value", { precision: 10, scale: 2 }),
	ctr: decimal({ precision: 5, scale: 4 }),
	cvr: decimal({ precision: 5, scale: 4 }),
	cpc: decimal({ precision: 10, scale: 2 }),
	sales7D: decimal("sales_7d", { precision: 10, scale: 2 }).default('0'),
	orders7D: int("orders_7d").default(0),
	unitsOrdered7D: int("units_ordered_7d").default(0),
	sales30D: decimal("sales_30d", { precision: 10, scale: 2 }).default('0'),
	orders30D: int("orders_30d").default(0),
	unitsOrdered30D: int("units_ordered_30d").default(0),
	ntbOrders: int("ntb_orders").default(0),
	ntbSales: decimal("ntb_sales", { precision: 10, scale: 2 }).default('0'),
	ntbUnitsOrdered: int("ntb_units_ordered").default(0),
	topOfSearchImpressions: int("top_of_search_impressions").default(0),
	topOfSearchClicks: int("top_of_search_clicks").default(0),
	topOfSearchSpend: decimal("top_of_search_spend", { precision: 10, scale: 2 }).default('0'),
	topOfSearchSales: decimal("top_of_search_sales", { precision: 10, scale: 2 }).default('0'),
	productPageImpressions: int("product_page_impressions").default(0),
	productPageClicks: int("product_page_clicks").default(0),
	productPageSpend: decimal("product_page_spend", { precision: 10, scale: 2 }).default('0'),
	productPageSales: decimal("product_page_sales", { precision: 10, scale: 2 }).default('0'),
	restOfSearchImpressions: int("rest_of_search_impressions").default(0),
	restOfSearchClicks: int("rest_of_search_clicks").default(0),
	restOfSearchSpend: decimal("rest_of_search_spend", { precision: 10, scale: 2 }).default('0'),
	restOfSearchSales: decimal("rest_of_search_sales", { precision: 10, scale: 2 }).default('0'),
	brandedSearches: int("branded_searches").default(0),
	brandedSearchesClicks: int("branded_searches_clicks").default(0),
	videoViews: int("video_views").default(0),
	videoViewRate: decimal("video_view_rate", { precision: 5, scale: 4 }),
	videoFirstQuartileViews: int("video_first_quartile_views").default(0),
	videoMidpointViews: int("video_midpoint_views").default(0),
	videoThirdQuartileViews: int("video_third_quartile_views").default(0),
	videoCompleteViews: int("video_complete_views").default(0),
	viewableImpressions: int("viewable_impressions").default(0),
	viewThroughConversions: int("view_through_conversions").default(0),
	viewThroughSales: decimal("view_through_sales", { precision: 10, scale: 2 }).default('0'),
	dataSource: mysqlEnum("data_source", ['api','ams']).default('api'),
	isFinalized: tinyint("is_finalized").default(0),
});

export const dataConsistencyChecks = mysqlTable("data_consistency_checks", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	checkTime: datetime({ mode: 'string'}).default('CURRENT_TIMESTAMP'),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	dateRangeStart: date({ mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	dateRangeEnd: date({ mode: 'string' }),
	apiRecords: int().default(0),
	amsRecords: int().default(0),
	matchedRecords: int().default(0),
	overallConsistency: decimal({ precision: 5, scale: 2 }),
	checkStatus: varchar({ length: 50 }).default('completed'),
	deviationDetails: json(),
	createdAt: datetime({ mode: 'string'}).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("idx_account_time").on(table.accountId, table.checkTime),
]);

export const dataSyncJobs = mysqlTable("data_sync_jobs", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int().notNull(),
	syncType: mysqlEnum(['campaigns','keywords','performance','all']).default('all'),
	status: mysqlEnum(['pending','running','completed','failed','cancelled']).default('pending'),
	recordsSynced: int().default(0),
	errorMessage: text(),
	startedAt: timestamp({ mode: 'string' }),
	completedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	isIncremental: tinyint("is_incremental").default(0),
	spCampaignsSynced: int("sp_campaigns_synced").default(0),
	sbCampaignsSynced: int("sb_campaigns_synced").default(0),
	sdCampaignsSynced: int("sd_campaigns_synced").default(0),
	adGroupsSynced: int("ad_groups_synced").default(0),
	keywordsSynced: int("keywords_synced").default(0),
	targetsSynced: int("targets_synced").default(0),
	performanceSynced: int("performance_synced").default(0),
	retryCount: int("retry_count").default(0),
	maxRetries: int("max_retries").default(3),
	lastRetryAt: timestamp("last_retry_at", { mode: 'string' }),
	durationMs: int("duration_ms"),
	recordsSkipped: int("records_skipped").default(0),
	spCampaigns: int("sp_campaigns").default(0),
	sbCampaigns: int("sb_campaigns").default(0),
	sdCampaigns: int("sd_campaigns").default(0),
	currentStep: varchar("current_step", { length: 100 }),
	totalSteps: int("total_steps").default(0),
	currentStepIndex: int("current_step_index").default(0),
	progressPercent: int("progress_percent").default(0),
	siteProgress: json("site_progress"),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
});

export const dataSyncLogs = mysqlTable("data_sync_logs", {
	id: int().autoincrement().notNull(),
	jobId: int().notNull(),
	operation: varchar({ length: 100 }).notNull(),
	status: mysqlEnum(['success','error','warning']).default('success'),
	message: text(),
	details: json(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const dataSyncSchedules = mysqlTable("data_sync_schedules", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int().notNull(),
	syncType: mysqlEnum(['campaigns','ad_groups','keywords','product_targets','search_terms','performance_daily','performance_hourly','full_sync']).notNull(),
	frequency: mysqlEnum(['hourly','every_2_hours','every_4_hours','every_6_hours','every_12_hours','daily','weekly']).default('daily'),
	preferredTime: varchar({ length: 5 }),
	preferredDayOfWeek: int(),
	isEnabled: tinyint().default(1),
	lastRunAt: timestamp({ mode: 'string' }),
	nextRunAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const dataSyncTasks = mysqlTable("data_sync_tasks", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int().notNull(),
	syncType: mysqlEnum(['campaigns','ad_groups','keywords','product_targets','search_terms','performance_daily','performance_hourly','full_sync']).notNull(),
	startDate: timestamp({ mode: 'string' }),
	endDate: timestamp({ mode: 'string' }),
	status: mysqlEnum(['pending','running','completed','failed','cancelled']).default('pending'),
	totalItems: int(),
	processedItems: int().default(0),
	failedItems: int().default(0),
	resultSummary: json(),
	errorMessage: text(),
	startedAt: timestamp({ mode: 'string' }),
	completedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const daypartingBidRules = mysqlTable("dayparting_bid_rules", {
	id: int().autoincrement().notNull(),
	campaignId: varchar("campaign_id", { length: 50 }).notNull(),
	ruleName: varchar("rule_name", { length: 100 }).notNull(),
	dayOfWeek: tinyint("day_of_week").notNull(),
	startHour: tinyint("start_hour").notNull(),
	endHour: tinyint("end_hour").notNull(),
	bidMultiplier: decimal("bid_multiplier", { precision: 5, scale: 2 }).default('1.00'),
	budgetMultiplier: decimal("budget_multiplier", { precision: 5, scale: 2 }).default('1.00'),
	ruleEnabled: tinyint("rule_enabled").default(1),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
});

export const daypartingBudgetRules = mysqlTable("dayparting_budget_rules", {
	id: int().autoincrement().notNull(),
	strategyId: int().notNull(),
	dayOfWeek: int().notNull(),
	budgetMultiplier: decimal({ precision: 3, scale: 2 }).default('1.00'),
	budgetPercentage: decimal({ precision: 5, scale: 2 }),
	avgSpend: decimal({ precision: 10, scale: 2 }),
	avgSales: decimal({ precision: 10, scale: 2 }),
	avgAcos: decimal({ precision: 5, scale: 2 }),
	avgRoas: decimal({ precision: 10, scale: 2 }),
	dataPoints: int().default(0),
	isEnabled: tinyint().default(1),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const daypartingExecutionLogs = mysqlTable("dayparting_execution_logs", {
	id: int().autoincrement().notNull(),
	strategyId: int().notNull(),
	executionType: mysqlEnum(['budget_adjustment','bid_adjustment','analysis']).notNull(),
	dpTargetType: mysqlEnum(['campaign','adgroup','keyword']),
	dpTargetId: int(),
	dpTargetName: varchar({ length: 500 }),
	previousValue: decimal({ precision: 10, scale: 2 }),
	newValue: decimal({ precision: 10, scale: 2 }),
	multiplierApplied: decimal({ precision: 3, scale: 2 }),
	triggerDayOfWeek: int(),
	triggerHour: int(),
	dpExecStatus: mysqlEnum(['success','failed','skipped']).default('success'),
	dpErrorMessage: text(),
	executedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const daypartingStrategies = mysqlTable("dayparting_strategies", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: int(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	strategyType: mysqlEnum(['budget','bidding','both']).default('both'),
	daypartingOptGoal: mysqlEnum(['maximize_sales','target_acos','target_roas','minimize_acos']).default('maximize_sales'),
	daypartingTargetAcos: decimal({ precision: 5, scale: 2 }),
	daypartingTargetRoas: decimal({ precision: 10, scale: 2 }),
	analysisLookbackDays: int().default(30),
	minDataPoints: int().default(10),
	maxBudgetMultiplier: decimal({ precision: 3, scale: 2 }).default('2.00'),
	minBudgetMultiplier: decimal({ precision: 3, scale: 2 }).default('0.20'),
	maxBidMultiplier: decimal({ precision: 3, scale: 2 }).default('2.00'),
	minBidMultiplier: decimal({ precision: 3, scale: 2 }).default('0.20'),
	daypartingStatus: mysqlEnum(['active','paused','draft']).default('draft'),
	lastAnalyzedAt: timestamp({ mode: 'string' }),
	lastAppliedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const decisionTreeModels = mysqlTable("decision_tree_models", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	modelType: mysqlEnum(['cr_prediction','cv_prediction']).notNull(),
	treeStructure: json(),
	totalSamples: int(),
	treeDepth: int(),
	leafCount: int(),
	avgLeafSamples: decimal({ precision: 10, scale: 2 }),
	trainingR2: decimal({ precision: 5, scale: 4 }),
	validationR2: decimal({ precision: 5, scale: 4 }),
	meanAbsoluteError: decimal({ precision: 10, scale: 6 }),
	featureImportance: json(),
	version: int().default(1),
	isActive: tinyint().default(1),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow(),
});

export const emailReportSubscriptions = mysqlTable("email_report_subscriptions", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	reportType: mysqlEnum(['cross_account_summary','account_performance','campaign_performance','keyword_performance','health_alert','optimization_summary']).notNull(),
	frequency: mysqlEnum(['daily','weekly','monthly']).default('weekly').notNull(),
	sendTime: varchar({ length: 5 }).default('09:00'),
	sendDayOfWeek: int(),
	sendDayOfMonth: int(),
	timezone: varchar({ length: 64 }).default('Asia/Shanghai'),
	recipients: json(),
	ccRecipients: json(),
	accountIds: json(),
	includeCharts: tinyint().default(1),
	includeDetails: tinyint().default(1),
	dateRange: mysqlEnum(['last_7_days','last_14_days','last_30_days','last_month','custom']).default('last_7_days'),
	isActive: tinyint().default(1),
	lastSentAt: timestamp({ mode: 'string' }),
	nextSendAt: timestamp({ mode: 'string' }),
	sendCount: int().default(0),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const emailSendLogs = mysqlTable("email_send_logs", {
	id: int().autoincrement().notNull(),
	subscriptionId: int().notNull(),
	sentAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	recipients: json(),
	status: mysqlEnum(['sent','failed','partial']).notNull(),
	errorMessage: text(),
	reportData: json(),
	emailSubject: varchar({ length: 500 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const hourlyPerformance = mysqlTable("hourly_performance", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: int().notNull(),
	adGroupId: int(),
	keywordId: int(),
	date: timestamp({ mode: 'string' }).notNull(),
	hour: int().notNull(),
	dayOfWeek: int().notNull(),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 10, scale: 2 }).default('0.00'),
	sales: decimal({ precision: 10, scale: 2 }).default('0.00'),
	orders: int().default(0),
	hourlyAcos: decimal({ precision: 5, scale: 2 }),
	hourlyRoas: decimal({ precision: 10, scale: 2 }),
	hourlyCtr: decimal({ precision: 5, scale: 4 }),
	hourlyCvr: decimal({ precision: 5, scale: 4 }),
	hourlyCpc: decimal({ precision: 10, scale: 2 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const hourpartingBidRules = mysqlTable("hourparting_bid_rules", {
	id: int().autoincrement().notNull(),
	strategyId: int().notNull(),
	dayOfWeek: int().notNull(),
	hour: int().notNull(),
	bidMultiplier: decimal({ precision: 3, scale: 2 }).default('1.00'),
	avgClicks: decimal({ precision: 10, scale: 2 }),
	hourAvgSpend: decimal({ precision: 10, scale: 2 }),
	hourAvgSales: decimal({ precision: 10, scale: 2 }),
	hourAvgCvr: decimal({ precision: 5, scale: 4 }),
	hourAvgCpc: decimal({ precision: 10, scale: 2 }),
	hourAvgAcos: decimal({ precision: 5, scale: 2 }),
	hourDataPoints: int().default(0),
	hourIsEnabled: tinyint().default(1),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const importJobs = mysqlTable("import_jobs", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	fileName: varchar({ length: 255 }).notNull(),
	fileUrl: varchar({ length: 1000 }),
	fileType: mysqlEnum(['csv','excel']).notNull(),
	reportType: varchar({ length: 64 }),
	importStatus: mysqlEnum(['pending','processing','completed','failed']).default('pending'),
	totalRows: int(),
	processedRows: int().default(0),
	errorMessage: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	completedAt: timestamp({ mode: 'string' }),
});

export const inviteCodeUsages = mysqlTable("invite_code_usages", {
	id: int().autoincrement().notNull(),
	inviteCodeId: int("invite_code_id").notNull().references(() => inviteCodes.id, { onDelete: "cascade" } ),
	userId: int("user_id").notNull().references(() => users.id, { onDelete: "set null" } ),
	usedAt: timestamp("used_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	ipAddress: varchar("ip_address", { length: 45 }),
	userAgent: text("user_agent"),
	organizationId: int("organization_id"),
},
(table) => [
	index("idx_invite_code").on(table.inviteCodeId),
	index("idx_user").on(table.userId),
]);

export const inviteCodes = mysqlTable("invite_codes", {
	id: int().autoincrement().notNull(),
	code: varchar({ length: 32 }).notNull(),
	createdBy: int("created_by").notNull().references(() => users.id, { onDelete: "cascade" } ),
	organizationId: int("organization_id"),
	inviteType: mysqlEnum("invite_type", ['team_member','external_user']).default('external_user'),
	maxUses: int("max_uses").default(1),
	usedCount: int("used_count").default(0),
	usedBy: int("used_by").references(() => users.id, { onDelete: "set null" } ),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	isActive: tinyint("is_active").default(1),
	note: varchar({ length: 255 }),
	usedAt: timestamp("used_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("idx_code").on(table.code),
	index("code").on(table.code),
]);

export const keywordPredictions = mysqlTable("keyword_predictions", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	keywordId: int().notNull(),
	predictedCr: decimal({ precision: 8, scale: 6 }),
	predictedCv: decimal({ precision: 12, scale: 2 }),
	crLow: decimal({ precision: 8, scale: 6 }),
	crHigh: decimal({ precision: 8, scale: 6 }),
	cvLow: decimal({ precision: 12, scale: 2 }),
	cvHigh: decimal({ precision: 12, scale: 2 }),
	predictionSource: mysqlEnum(['historical','decision_tree','bayesian_update']).default('decision_tree'),
	confidence: decimal({ precision: 5, scale: 4 }),
	sampleCount: int(),
	matchType: mysqlEnum(['broad','phrase','exact']),
	wordCount: int(),
	keywordType: mysqlEnum(['brand','competitor','generic','product']),
	actualCr: decimal({ precision: 8, scale: 6 }),
	actualCv: decimal({ precision: 12, scale: 2 }),
	predictionError: decimal({ precision: 8, scale: 6 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow(),
});

export const keywords = mysqlTable("keywords", {
	id: int().autoincrement().notNull(),
	adGroupId: int().notNull(),
	keywordId: varchar({ length: 64 }),
	keywordText: varchar({ length: 500 }).notNull(),
	matchType: mysqlEnum(['broad','phrase','exact']).notNull(),
	bid: decimal({ precision: 10, scale: 2 }).notNull(),
	suggestedBid: decimal({ precision: 10, scale: 2 }),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 10, scale: 2 }).default('0.00'),
	sales: decimal({ precision: 10, scale: 2 }).default('0.00'),
	orders: int().default(0),
	keywordAcos: decimal({ precision: 5, scale: 2 }),
	keywordCtr: decimal({ precision: 5, scale: 4 }),
	keywordCvr: decimal({ precision: 5, scale: 4 }),
	estimatedTraffic: int(),
	trafficCeiling: int(),
	optimalBid: decimal({ precision: 10, scale: 2 }),
	marginalRevenue: decimal({ precision: 10, scale: 2 }),
	marginalCost: decimal({ precision: 10, scale: 2 }),
	keywordStatus: mysqlEnum(['enabled','paused','archived']).default('enabled'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const localUsers = mysqlTable("local_users", {
	id: int().autoincrement().notNull(),
	userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" } ),
	username: varchar({ length: 64 }).notNull(),
	passwordHash: varchar("password_hash", { length: 256 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("idx_username").on(table.username),
	index("user_id").on(table.userId),
	index("username").on(table.username),
]);

export const marginalBenefitApplications = mysqlTable("marginal_benefit_applications", {
	id: int().autoincrement().notNull(),
	accountId: int("account_id").notNull(),
	campaignId: varchar("campaign_id", { length: 64 }).notNull(),
	userId: int("user_id").notNull(),
	optimizationGoal: mysqlEnum("optimization_goal", ['maximize_roas','minimize_acos','maximize_sales','balanced']).notNull(),
	applicationStatus: mysqlEnum("application_status", ['pending','applied','failed','rolled_back']).default('pending'),
	beforeTopOfSearch: int("before_top_of_search"),
	beforeProductPage: int("before_product_page"),
	afterTopOfSearch: int("after_top_of_search"),
	afterProductPage: int("after_product_page"),
	expectedSalesChange: decimal("expected_sales_change", { precision: 12, scale: 2 }),
	expectedSpendChange: decimal("expected_spend_change", { precision: 12, scale: 2 }),
	expectedRoasChange: decimal("expected_roas_change", { precision: 10, scale: 4 }),
	expectedAcosChange: decimal("expected_acos_change", { precision: 10, scale: 4 }),
	actualSalesChange: decimal("actual_sales_change", { precision: 12, scale: 2 }),
	actualSpendChange: decimal("actual_spend_change", { precision: 12, scale: 2 }),
	actualRoasChange: decimal("actual_roas_change", { precision: 10, scale: 4 }),
	actualAcosChange: decimal("actual_acos_change", { precision: 10, scale: 4 }),
	evaluatedAt: timestamp("evaluated_at", { mode: 'string' }),
	applicationNote: text("application_note"),
	errorMessage: text("error_message"),
	appliedAt: timestamp("applied_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("mb_app_account_campaign").on(table.accountId, table.campaignId),
	index("mb_app_status").on(table.applicationStatus),
]);

export const marginalBenefitHistory = mysqlTable("marginal_benefit_history", {
	id: int().autoincrement().notNull(),
	accountId: int("account_id").notNull(),
	campaignId: varchar("campaign_id", { length: 64 }).notNull(),
	placementType: mysqlEnum("placement_type", ['top_of_search','product_page','rest_of_search']).notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	analysisDate: date("analysis_date", { mode: 'string' }).notNull(),
	currentAdjustment: int("current_adjustment").default(0),
	marginalRoas: decimal("marginal_roas", { precision: 10, scale: 4 }),
	marginalAcos: decimal("marginal_acos", { precision: 10, scale: 4 }),
	marginalSales: decimal("marginal_sales", { precision: 12, scale: 2 }),
	marginalSpend: decimal("marginal_spend", { precision: 12, scale: 2 }),
	elasticity: decimal({ precision: 10, scale: 4 }),
	diminishingPoint: int("diminishing_point"),
	optimalRangeMin: int("optimal_range_min"),
	optimalRangeMax: int("optimal_range_max"),
	confidence: decimal({ precision: 5, scale: 4 }),
	dataPoints: int("data_points"),
	totalImpressions: int("total_impressions"),
	totalClicks: int("total_clicks"),
	totalSpend: decimal("total_spend", { precision: 12, scale: 2 }),
	totalSales: decimal("total_sales", { precision: 12, scale: 2 }),
	totalOrders: int("total_orders"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
},
(table) => [
	index("mb_history_account_campaign").on(table.accountId, table.campaignId),
	index("mb_history_date").on(table.analysisDate),
]);

export const marketCurveData = mysqlTable("market_curve_data", {
	id: int().autoincrement().notNull(),
	curveTargetType: mysqlEnum(['keyword','product_target']).notNull(),
	curveTargetId: int().notNull(),
	bidLevel: decimal({ precision: 10, scale: 2 }).notNull(),
	estimatedImpressions: int(),
	estimatedClicks: int(),
	estimatedConversions: decimal({ precision: 10, scale: 2 }),
	estimatedSpend: decimal({ precision: 10, scale: 2 }),
	estimatedSales: decimal({ precision: 10, scale: 2 }),
	curveMarginalRevenue: decimal({ precision: 10, scale: 2 }),
	curveMarginalCost: decimal({ precision: 10, scale: 2 }),
	marginalProfit: decimal({ precision: 10, scale: 2 }),
	curveTrafficCeiling: int(),
	optimalBidPoint: decimal({ precision: 10, scale: 2 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const marketCurveModels = mysqlTable("market_curve_models", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: varchar({ length: 50 }).notNull(),
	bidObjectType: mysqlEnum(['keyword','asin','audience']).notNull(),
	bidObjectId: varchar({ length: 100 }).notNull(),
	bidObjectText: varchar({ length: 500 }),
	impressionCurveA: decimal({ precision: 15, scale: 6 }),
	impressionCurveB: decimal({ precision: 15, scale: 6 }),
	impressionCurveC: decimal({ precision: 15, scale: 6 }),
	impressionCurveR2: decimal({ precision: 5, scale: 4 }),
	baseCtr: decimal({ precision: 8, scale: 6 }),
	positionBonus: decimal({ precision: 8, scale: 6 }),
	topSearchCtrBonus: decimal({ precision: 8, scale: 6 }),
	cvr: decimal({ precision: 8, scale: 6 }),
	aov: decimal({ precision: 12, scale: 2 }),
	conversionDelayDays: int().default(7),
	cvrSource: mysqlEnum(['historical','decision_tree','bayesian']).default('historical'),
	optimalBid: decimal({ precision: 10, scale: 4 }),
	maxProfit: decimal({ precision: 12, scale: 2 }),
	profitMargin: decimal({ precision: 5, scale: 4 }),
	breakEvenCpc: decimal({ precision: 10, scale: 4 }),
	currentBid: decimal({ precision: 10, scale: 4 }),
	bidGap: decimal({ precision: 10, scale: 4 }),
	bidGapPercent: decimal({ precision: 8, scale: 4 }),
	dataPoints: int().default(0),
	confidence: decimal({ precision: 5, scale: 4 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow(),
});

export const negativeKeywords = mysqlTable("negative_keywords", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: int().notNull(),
	adGroupId: int(),
	negativeLevel: mysqlEnum(['campaign','ad_group']).notNull(),
	negativeType: mysqlEnum(['keyword','product']).notNull(),
	negativeText: varchar({ length: 500 }).notNull(),
	negativeMatchType: mysqlEnum(['negative_exact','negative_phrase']).notNull(),
	negativeSource: mysqlEnum(['manual','ngram_analysis','traffic_conflict','funnel_migration']).default('manual'),
	sourceReason: text(),
	negativeStatus: mysqlEnum(['active','pending','removed']).default('active'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const notificationHistory = mysqlTable("notification_history", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	type: mysqlEnum(['alert','report','system']).notNull(),
	severity: mysqlEnum(['info','warning','critical']).default('info'),
	title: varchar({ length: 255 }).notNull(),
	message: text().notNull(),
	channel: mysqlEnum(['email','in_app','both']).default('in_app'),
	status: mysqlEnum(['pending','sent','failed','read']).default('pending'),
	relatedEntityType: varchar({ length: 64 }),
	relatedEntityId: int(),
	sentAt: timestamp({ mode: 'string' }),
	readAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const notificationSettings = mysqlTable("notification_settings", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	emailEnabled: tinyint().default(1),
	inAppEnabled: tinyint().default(1),
	acosThreshold: decimal({ precision: 5, scale: 2 }).default('50.00'),
	ctrDropThreshold: decimal({ precision: 5, scale: 2 }).default('30.00'),
	conversionDropThreshold: decimal({ precision: 5, scale: 2 }).default('30.00'),
	spendSpikeThreshold: decimal({ precision: 5, scale: 2 }).default('50.00'),
	frequency: mysqlEnum(['immediate','hourly','daily','weekly']).default('daily'),
	quietHoursStart: int().default(22),
	quietHoursEnd: int().default(8),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const optimizationRecommendations = mysqlTable("optimization_recommendations", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: varchar({ length: 50 }),
	bidObjectType: mysqlEnum(['keyword','asin','campaign','placement']),
	bidObjectId: varchar({ length: 100 }),
	recommendationType: mysqlEnum(['bid_adjustment','placement_adjustment','budget_reallocation','keyword_optimization','data_collection']).notNull(),
	priority: mysqlEnum(['critical','high','medium','low']).default('medium'),
	title: varchar({ length: 255 }),
	description: text(),
	expectedImpact: text(),
	currentValue: json(),
	recommendedValue: json(),
	expectedProfitChange: decimal({ precision: 12, scale: 2 }),
	expectedProfitChangePercent: decimal({ precision: 8, scale: 4 }),
	expectedAcosChange: decimal({ precision: 8, scale: 4 }),
	expectedRoasChange: decimal({ precision: 10, scale: 4 }),
	status: mysqlEnum(['pending','applied','rejected','expired']).default('pending'),
	appliedAt: timestamp({ mode: 'string' }),
	appliedBy: int(),
	actualProfitChange: decimal({ precision: 12, scale: 2 }),
	actualAcosChange: decimal({ precision: 8, scale: 4 }),
	actualRoasChange: decimal({ precision: 10, scale: 4 }),
	reviewedAt: timestamp({ mode: 'string' }),
	expiresAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow(),
});

export const organizations = mysqlTable("organizations", {
	id: int().autoincrement().notNull(),
	name: varchar({ length: 255 }).notNull(),
	type: mysqlEnum(['internal','external']).default('external'),
	ownerId: int("owner_id"),
	status: mysqlEnum(['active','suspended','deleted']).default('active'),
	maxUsers: int("max_users").default(10),
	maxAccounts: int("max_accounts").default(5),
	features: json(),
	settings: json(),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("idx_owner").on(table.ownerId),
	index("idx_status").on(table.status),
	index("idx_type").on(table.type),
]);

export const performanceGroups = mysqlTable("performance_groups", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int().notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	optimizationGoal: mysqlEnum(['maximize_sales','target_acos','target_roas','daily_spend_limit','daily_cost']).default('maximize_sales'),
	targetAcos: decimal({ precision: 5, scale: 2 }),
	targetRoas: decimal({ precision: 10, scale: 2 }),
	dailySpendLimit: decimal({ precision: 10, scale: 2 }),
	dailyCostTarget: decimal({ precision: 10, scale: 2 }),
	currentAcos: decimal({ precision: 5, scale: 2 }),
	currentRoas: decimal({ precision: 10, scale: 2 }),
	currentDailySpend: decimal({ precision: 10, scale: 2 }),
	currentDailySales: decimal({ precision: 10, scale: 2 }),
	conversionsPerDay: decimal({ precision: 10, scale: 2 }),
	status: mysqlEnum(['active','paused','archived']).default('active'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	daypartingEnabled: tinyint().default(1),
	daypartingStrategy: mysqlEnum(['performance_based','equal','custom']).default('performance_based'),
	daypartingAutoAdjust: tinyint().default(1),
	daypartingMinBudgetPercent: int().default(50),
	daypartingMaxBudgetPercent: int().default(150),
	daypartingReserveBudget: decimal({ precision: 10, scale: 2 }).default('0'),
	daypartingLastAnalysis: timestamp({ mode: 'string' }),
	daypartingLastExecution: timestamp({ mode: 'string' }),
	keywordAutoEnabled: tinyint().default(1),
	keywordAutoPauseEnabled: tinyint().default(1),
	keywordAutoEnableEnabled: tinyint().default(0),
	keywordPauseMinSpend: decimal({ precision: 10, scale: 2 }).default('10'),
	keywordPauseMaxAcos: decimal({ precision: 5, scale: 2 }).default('50'),
	keywordLastAutoExecution: timestamp({ mode: 'string' }),
	dailyBudget: decimal("daily_budget", { precision: 10, scale: 2 }),
	maxBid: decimal("max_bid", { precision: 10, scale: 2 }),
});

export const placementBidSettings = mysqlTable("placement_bid_settings", {
	id: int().autoincrement().notNull(),
	campaignId: varchar("campaign_id", { length: 50 }).notNull(),
	placementType: mysqlEnum("placement_type", ['top_of_search','product_page','rest_of_search']).notNull(),
	bidAdjustmentPercent: decimal("bid_adjustment_percent", { precision: 5, scale: 2 }).default('0'),
	autoOptimize: tinyint("auto_optimize").default(0),
	targetAcos: decimal("target_acos", { precision: 10, scale: 4 }),
	minAdjustment: decimal("min_adjustment", { precision: 5, scale: 2 }).default('-99'),
	maxAdjustment: decimal("max_adjustment", { precision: 5, scale: 2 }).default('900'),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("unique_placement").on(table.campaignId, table.placementType),
]);

export const placementPerformance = mysqlTable("placement_performance", {
	id: int().autoincrement().notNull(),
	campaignId: varchar({ length: 50 }).notNull(),
	accountId: int().notNull(),
	placement: mysqlEnum(['top_of_search','product_page','rest_of_search']).notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	date: date({ mode: 'string' }).notNull(),
	timeSlot: int(),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 12, scale: 2 }).default('0'),
	sales: decimal({ precision: 12, scale: 2 }).default('0'),
	orders: int().default(0),
	ctr: decimal({ precision: 8, scale: 6 }),
	cpc: decimal({ precision: 10, scale: 2 }),
	cvr: decimal({ precision: 8, scale: 6 }),
	acos: decimal({ precision: 8, scale: 4 }),
	roas: decimal({ precision: 10, scale: 2 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const placementSettings = mysqlTable("placement_settings", {
	id: int().autoincrement().notNull(),
	campaignId: varchar({ length: 50 }).notNull(),
	accountId: int().notNull(),
	topOfSearchAdjustment: int().default(0),
	productPageAdjustment: int().default(0),
	autoOptimize: tinyint().default(1),
	optimizationGoal: mysqlEnum(['roas','acos','sales','profit']).default('roas'),
	targetAcos: decimal({ precision: 5, scale: 2 }).default('30.00'),
	targetRoas: decimal({ precision: 5, scale: 2 }).default('3.00'),
	minAdjustment: int().default(0),
	maxAdjustment: int().default(200),
	adjustmentStep: int().default(10),
	adjustmentFrequency: mysqlEnum(['every_2_hours','every_4_hours','every_6_hours','daily']).default('every_2_hours'),
	minClicksForDecision: int().default(50),
	minSpendForDecision: decimal({ precision: 10, scale: 2 }).default('20.00'),
	lastAdjustedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("campaignId").on(table.campaignId),
]);

export const productTargets = mysqlTable("product_targets", {
	id: int().autoincrement().notNull(),
	adGroupId: int().notNull(),
	targetId: varchar({ length: 64 }),
	targetType: mysqlEnum(['asin','category']).notNull(),
	targetValue: varchar({ length: 64 }).notNull(),
	targetExpression: text(),
	bid: decimal({ precision: 10, scale: 2 }).notNull(),
	suggestedBid: decimal({ precision: 10, scale: 2 }),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 10, scale: 2 }).default('0.00'),
	sales: decimal({ precision: 10, scale: 2 }).default('0.00'),
	orders: int().default(0),
	targetAcos: decimal({ precision: 5, scale: 2 }),
	targetOptimalBid: decimal({ precision: 10, scale: 2 }),
	targetStatus: mysqlEnum(['enabled','paused','archived']).default('enabled'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const promotionalEvents = mysqlTable("promotional_events", {
	id: int().autoincrement().notNull(),
	eventName: varchar({ length: 100 }).notNull(),
	eventType: mysqlEnum(['prime_day','black_friday','cyber_monday','christmas','new_year','valentines','mothers_day','fathers_day','back_to_school','halloween','custom']).notNull(),
	marketplace: varchar({ length: 20 }),
	startDate: timestamp({ mode: 'string' }).notNull(),
	endDate: timestamp({ mode: 'string' }).notNull(),
	warmupStartDate: timestamp({ mode: 'string' }),
	warmupEndDate: timestamp({ mode: 'string' }),
	recommendedBudgetMultiplier: decimal({ precision: 5, scale: 2 }).default('1.5'),
	warmupBudgetMultiplier: decimal({ precision: 5, scale: 2 }).default('1.2'),
	description: text(),
	isActive: tinyint().default(1),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const sbCampaignSettings = mysqlTable("sb_campaign_settings", {
	id: int().autoincrement().notNull(),
	campaignId: varchar("campaign_id", { length: 50 }).notNull(),
	accountId: varchar("account_id", { length: 50 }).notNull(),
	campaignName: varchar("campaign_name", { length: 255 }),
	campaignType: mysqlEnum("campaign_type", ['video','store_spotlight','product_collection']).default('product_collection'),
	landingPageType: mysqlEnum("landing_page_type", ['store','product_list','custom_url']).default('store'),
	brandEntityId: varchar("brand_entity_id", { length: 50 }),
	autoOptimizeKeywords: tinyint("auto_optimize_keywords").default(0),
	autoOptimizeBids: tinyint("auto_optimize_bids").default(0),
	targetAcos: decimal("target_acos", { precision: 10, scale: 4 }),
	minBid: decimal("min_bid", { precision: 10, scale: 2 }),
	maxBid: decimal("max_bid", { precision: 10, scale: 2 }),
	creativeOptimizationEnabled: tinyint("creative_optimization_enabled").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("campaign_id").on(table.campaignId),
]);

export const scheduledTasks = mysqlTable("scheduled_tasks", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	taskType: mysqlEnum(['ngram_analysis','funnel_migration','traffic_conflict','smart_bidding','health_check','data_sync','traffic_isolation_full']).notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	enabled: tinyint().default(1),
	schedule: mysqlEnum(['hourly','daily','weekly','monthly']).default('daily'),
	runTime: varchar({ length: 8 }).default('06:00'),
	dayOfWeek: int(),
	dayOfMonth: int(),
	parameters: text(),
	lastRunAt: timestamp({ mode: 'string' }),
	lastRunStatus: mysqlEnum(['success','failed','running','skipped']),
	lastRunResult: text(),
	nextRunAt: timestamp({ mode: 'string' }),
	autoApply: tinyint().default(0),
	requireApproval: tinyint().default(1),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const sdAudienceTargeting = mysqlTable("sd_audience_targeting", {
	id: int().autoincrement().notNull(),
	campaignId: varchar("campaign_id", { length: 50 }).notNull(),
	adGroupId: varchar("ad_group_id", { length: 50 }).notNull(),
	audienceType: mysqlEnum("audience_type", ['views','purchases','similar_products','categories','audiences']).notNull(),
	audienceId: varchar("audience_id", { length: 100 }),
	audienceName: varchar("audience_name", { length: 255 }),
	lookbackWindow: int("lookback_window"),
	bid: decimal({ precision: 10, scale: 2 }),
	targetingStatus: mysqlEnum("targeting_status", ['enabled','paused']).default('enabled'),
	impressions: int().default(0),
	clicks: int().default(0),
	cost: decimal({ precision: 10, scale: 2 }).default('0'),
	sales: decimal({ precision: 10, scale: 2 }).default('0'),
	orders: int().default(0),
	acos: decimal({ precision: 10, scale: 4 }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("idx_campaign").on(table.campaignId),
	index("idx_audience_type").on(table.audienceType),
]);

export const sdAudiences = mysqlTable("sd_audiences", {
	id: int().autoincrement().notNull(),
	accountId: int("account_id").notNull(),
	adGroupId: int("ad_group_id").notNull(),
	audienceId: varchar("audience_id", { length: 64 }).notNull(),
	audienceName: varchar("audience_name", { length: 500 }),
	audienceType: mysqlEnum("audience_type", ['views','purchases','inMarket','lifestyle','custom']).notNull(),
	lookbackDays: int("lookback_days").default(30),
	bid: decimal({ precision: 10, scale: 2 }),
	state: mysqlEnum(['enabled','paused','archived']).default('enabled'),
	impressions: int().default(0),
	viewableImpressions: int("viewable_impressions").default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 10, scale: 2 }).default('0'),
	sales: decimal({ precision: 10, scale: 2 }).default('0'),
	orders: int().default(0),
	dpv: int().default(0),
	viewAttributedSales: decimal("view_attributed_sales", { precision: 15, scale: 2 }).default('0'),
	viewAttributedOrders: int("view_attributed_orders").default(0),
	ntbOrders: int("ntb_orders").default(0),
	ntbSales: decimal("ntb_sales", { precision: 15, scale: 2 }).default('0'),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("idx_ad_group_id").on(table.adGroupId),
	index("idx_audience_type").on(table.audienceType),
	index("idx_state").on(table.state),
]);

export const sdCampaignSettings = mysqlTable("sd_campaign_settings", {
	id: int().autoincrement().notNull(),
	campaignId: varchar("campaign_id", { length: 50 }).notNull(),
	accountId: varchar("account_id", { length: 50 }).notNull(),
	campaignName: varchar("campaign_name", { length: 255 }),
	tactic: mysqlEnum(['T00020','T00030','remarketing','contextual']).default('contextual'),
	costType: mysqlEnum("cost_type", ['cpc','vcpm']).default('cpc'),
	optimizationGoal: mysqlEnum("optimization_goal", ['reach','page_visits','conversions']).default('conversions'),
	autoOptimizeAudiences: tinyint("auto_optimize_audiences").default(0),
	autoOptimizeBids: tinyint("auto_optimize_bids").default(0),
	targetAcos: decimal("target_acos", { precision: 10, scale: 4 }),
	targetRoas: decimal("target_roas", { precision: 10, scale: 4 }),
	minBid: decimal("min_bid", { precision: 10, scale: 2 }),
	maxBid: decimal("max_bid", { precision: 10, scale: 2 }),
	audienceBidOptimization: tinyint("audience_bid_optimization").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("campaign_id").on(table.campaignId),
]);

export const searchTermAnalysis = mysqlTable("search_term_analysis", {
	id: int().autoincrement().notNull(),
	accountId: varchar("account_id", { length: 50 }).notNull(),
	campaignId: varchar("campaign_id", { length: 50 }).notNull(),
	adGroupId: varchar("ad_group_id", { length: 50 }).notNull(),
	searchTerm: varchar("search_term", { length: 500 }).notNull(),
	keywordId: varchar("keyword_id", { length: 50 }),
	matchType: varchar("match_type", { length: 20 }),
	classification: mysqlEnum(['high_performer','potential','low_performer','negative_candidate']).default('potential'),
	impressions: int().default(0),
	clicks: int().default(0),
	cost: decimal({ precision: 10, scale: 2 }).default('0'),
	sales: decimal({ precision: 10, scale: 2 }).default('0'),
	orders: int().default(0),
	acos: decimal({ precision: 10, scale: 4 }),
	cvr: decimal({ precision: 10, scale: 6 }),
	recommendationType: mysqlEnum("recommendation_type", ['add_as_keyword','add_as_negative','increase_bid','decrease_bid','monitor']).default('monitor'),
	recommendationReason: text("recommendation_reason"),
	isProcessed: tinyint("is_processed").default(0),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	firstSeenDate: date("first_seen_date", { mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	lastSeenDate: date("last_seen_date", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow(),
},
(table) => [
	index("idx_campaign").on(table.campaignId),
	index("idx_classification").on(table.classification),
	index("idx_recommendation").on(table.recommendationType),
]);

export const searchTerms = mysqlTable("search_terms", {
	id: int().autoincrement().notNull(),
	accountId: int().notNull(),
	campaignId: int().notNull(),
	adGroupId: int().notNull(),
	searchTerm: varchar({ length: 500 }).notNull(),
	searchTermTargetType: mysqlEnum(['keyword','product_target']).notNull(),
	searchTermTargetId: int(),
	targetText: varchar({ length: 500 }),
	searchTermMatchType: varchar({ length: 32 }),
	searchTermImpressions: int().default(0),
	searchTermClicks: int().default(0),
	searchTermSpend: decimal({ precision: 10, scale: 2 }).default('0.00'),
	searchTermSales: decimal({ precision: 10, scale: 2 }).default('0.00'),
	searchTermOrders: int().default(0),
	searchTermAcos: decimal({ precision: 5, scale: 2 }),
	searchTermRoas: decimal({ precision: 10, scale: 2 }),
	searchTermCtr: decimal({ precision: 5, scale: 4 }),
	searchTermCvr: decimal({ precision: 5, scale: 4 }),
	searchTermCpc: decimal({ precision: 10, scale: 2 }),
	reportStartDate: timestamp({ mode: 'string' }),
	reportEndDate: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const seasonalBudgetRecommendations = mysqlTable("seasonal_budget_recommendations", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	campaignId: int(),
	eventId: int(),
	recommendationType: mysqlEnum(['event_increase','event_warmup','seasonal_increase','seasonal_decrease','trend_based']).notNull(),
	currentBudget: decimal({ precision: 10, scale: 2 }).notNull(),
	recommendedBudget: decimal({ precision: 10, scale: 2 }).notNull(),
	budgetMultiplier: decimal({ precision: 5, scale: 2 }),
	effectiveStartDate: timestamp({ mode: 'string' }).notNull(),
	effectiveEndDate: timestamp({ mode: 'string' }).notNull(),
	expectedSalesIncrease: decimal({ precision: 10, scale: 2 }),
	expectedRoasChange: decimal({ precision: 10, scale: 2 }),
	reasoning: text(),
	confidenceScore: decimal({ precision: 5, scale: 2 }),
	status: mysqlEnum(['pending','applied','skipped','expired']).default('pending'),
	appliedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const seasonalTrends = mysqlTable("seasonal_trends", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int(),
	year: int().notNull(),
	month: int().notNull(),
	weekOfYear: int(),
	avgDailySpend: decimal({ precision: 15, scale: 2 }),
	avgDailySales: decimal({ precision: 15, scale: 2 }),
	avgRoas: decimal({ precision: 10, scale: 2 }),
	avgAcos: decimal({ precision: 10, scale: 2 }),
	avgConversions: decimal({ precision: 10, scale: 2 }),
	yoySpendChange: decimal({ precision: 10, scale: 2 }),
	yoySalesChange: decimal({ precision: 10, scale: 2 }),
	seasonalIndex: decimal({ precision: 10, scale: 4 }).default('1.0'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const spendAlertLogs = mysqlTable("spend_alert_logs", {
	id: int().autoincrement().notNull(),
	configId: int().notNull(),
	userId: int().notNull(),
	accountId: int().notNull(),
	alertType: mysqlEnum(['warning_50','warning_80','critical_95','limit_reached','auto_stopped']).notNull(),
	alertLevel: mysqlEnum(['info','warning','critical']).notNull(),
	currentSpend: decimal({ precision: 12, scale: 2 }).notNull(),
	dailyLimit: decimal({ precision: 12, scale: 2 }).notNull(),
	spendPercent: decimal({ precision: 5, scale: 2 }).notNull(),
	notificationSent: tinyint().default(0).notNull(),
	notificationSentAt: timestamp({ mode: 'string' }),
	notificationError: text(),
	acknowledged: tinyint().default(0).notNull(),
	acknowledgedBy: int(),
	acknowledgedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const spendLimitConfigs = mysqlTable("spend_limit_configs", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	accountId: int().notNull(),
	dailySpendLimit: decimal({ precision: 12, scale: 2 }).notNull(),
	warningThreshold1: decimal({ precision: 5, scale: 2 }).default('50.00').notNull(),
	warningThreshold2: decimal({ precision: 5, scale: 2 }).default('80.00').notNull(),
	criticalThreshold: decimal({ precision: 5, scale: 2 }).default('95.00').notNull(),
	autoStopEnabled: tinyint().default(0).notNull(),
	autoStopThreshold: decimal({ precision: 5, scale: 2 }).default('100.00'),
	notifyOnWarning1: tinyint().default(1).notNull(),
	notifyOnWarning2: tinyint().default(1).notNull(),
	notifyOnCritical: tinyint().default(1).notNull(),
	notifyOnAutoStop: tinyint().default(1).notNull(),
	isEnabled: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const syncChangeRecords = mysqlTable("sync_change_records", {
	id: int().autoincrement().notNull(),
	syncJobId: int("sync_job_id").notNull(),
	accountId: int("account_id").notNull(),
	userId: int("user_id").notNull(),
	entityType: mysqlEnum("entity_type", ['campaign','ad_group','keyword','product_target']).notNull(),
	changeType: mysqlEnum("change_type", ['created','updated','deleted']).notNull(),
	entityId: varchar("entity_id", { length: 64 }).notNull(),
	entityName: varchar("entity_name", { length: 500 }),
	previousData: json("previous_data"),
	newData: json("new_data"),
	changedFields: json("changed_fields"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_sync_job").on(table.syncJobId),
	index("idx_account").on(table.accountId),
	index("idx_entity_type").on(table.entityType),
	index("idx_change_type").on(table.changeType),
]);

export const syncChangeSummary = mysqlTable("sync_change_summary", {
	id: int().autoincrement().notNull(),
	syncJobId: int("sync_job_id").notNull(),
	accountId: int("account_id").notNull(),
	userId: int("user_id").notNull(),
	campaignsCreated: int("campaigns_created").default(0),
	campaignsUpdated: int("campaigns_updated").default(0),
	campaignsDeleted: int("campaigns_deleted").default(0),
	adGroupsCreated: int("ad_groups_created").default(0),
	adGroupsUpdated: int("ad_groups_updated").default(0),
	adGroupsDeleted: int("ad_groups_deleted").default(0),
	keywordsCreated: int("keywords_created").default(0),
	keywordsUpdated: int("keywords_updated").default(0),
	keywordsDeleted: int("keywords_deleted").default(0),
	targetsCreated: int("targets_created").default(0),
	targetsUpdated: int("targets_updated").default(0),
	targetsDeleted: int("targets_deleted").default(0),
	conflictsDetected: int("conflicts_detected").default(0),
	conflictsResolved: int("conflicts_resolved").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_sync_job").on(table.syncJobId),
	index("idx_account").on(table.accountId),
]);

export const syncConflicts = mysqlTable("sync_conflicts", {
	id: int().autoincrement().notNull(),
	syncJobId: int("sync_job_id").notNull(),
	accountId: int("account_id").notNull(),
	userId: int("user_id").notNull(),
	entityType: mysqlEnum("entity_type", ['campaign','ad_group','keyword','product_target']).notNull(),
	entityId: varchar("entity_id", { length: 64 }).notNull(),
	entityName: varchar("entity_name", { length: 500 }),
	conflictType: mysqlEnum("conflict_type", ['data_mismatch','missing_local','missing_remote','status_conflict']).notNull(),
	localData: json("local_data"),
	remoteData: json("remote_data"),
	conflictFields: json("conflict_fields"),
	suggestedResolution: mysqlEnum("suggested_resolution", ['use_local','use_remote','merge','manual']).default('use_remote'),
	resolutionStatus: mysqlEnum("resolution_status", ['pending','resolved','ignored']).default('pending'),
	resolvedAt: timestamp("resolved_at", { mode: 'string' }),
	resolvedBy: int("resolved_by"),
	resolutionNotes: text("resolution_notes"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_sync_job").on(table.syncJobId),
	index("idx_account").on(table.accountId),
	index("idx_resolution_status").on(table.resolutionStatus),
]);

export const syncSchedules = mysqlTable("sync_schedules", {
	id: int().autoincrement().notNull(),
	userId: int("user_id").notNull(),
	accountId: int("account_id").notNull(),
	syncType: mysqlEnum("sync_type", ['campaigns','keywords','performance','all']).default('all'),
	frequency: mysqlEnum(['hourly','daily','weekly','monthly']).notNull(),
	hour: int().default(0),
	dayOfWeek: int("day_of_week"),
	dayOfMonth: int("day_of_month"),
	isEnabled: tinyint("is_enabled").default(1),
	lastRunAt: timestamp("last_run_at", { mode: 'string' }),
	nextRunAt: timestamp("next_run_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const syncTaskQueue = mysqlTable("sync_task_queue", {
	id: int().autoincrement().notNull(),
	userId: int("user_id").notNull(),
	accountId: int("account_id").notNull(),
	accountName: varchar("account_name", { length: 255 }),
	syncType: mysqlEnum("sync_type", ['campaigns','ad_groups','keywords','product_targets','performance','full']).default('full'),
	priority: int().default(0),
	status: mysqlEnum(['queued','running','completed','failed','cancelled']).default('queued'),
	progress: int().default(0),
	currentStep: varchar("current_step", { length: 100 }),
	totalSteps: int("total_steps").default(6),
	completedSteps: int("completed_steps").default(0),
	estimatedTimeMs: int("estimated_time_ms"),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	errorMessage: text("error_message"),
	resultSummary: json("result_summary"),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_user").on(table.userId),
	index("idx_account").on(table.accountId),
	index("idx_status").on(table.status),
	index("idx_priority").on(table.priority),
]);

export const taskExecutionLog = mysqlTable("task_execution_log", {
	id: int().autoincrement().notNull(),
	taskId: int().notNull(),
	userId: int().notNull(),
	accountId: int(),
	taskType: varchar({ length: 64 }).notNull(),
	status: mysqlEnum(['running','success','failed','cancelled']).notNull(),
	startedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	completedAt: timestamp({ mode: 'string' }),
	duration: int(),
	itemsProcessed: int().default(0),
	suggestionsGenerated: int().default(0),
	suggestionsApplied: int().default(0),
	errorMessage: text(),
	resultSummary: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const teamMembers = mysqlTable("team_members", {
	id: int().autoincrement().notNull(),
	organizationId: int("organization_id").default(1),
	username: varchar({ length: 100 }),
	passwordHash: varchar("password_hash", { length: 255 }),
	ownerId: int().notNull(),
	memberId: int(),
	email: varchar({ length: 320 }).notNull(),
	name: varchar({ length: 255 }),
	role: mysqlEnum(['admin','editor','viewer']).default('viewer').notNull(),
	status: mysqlEnum(['pending','active','inactive','revoked']).default('pending').notNull(),
	inviteToken: varchar({ length: 64 }),
	inviteExpiresAt: timestamp({ mode: 'string' }),
	acceptedAt: timestamp({ mode: 'string' }),
	lastActiveAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	lastLoginAt: timestamp("last_login_at", { mode: 'string' }),
},
(table) => [
	index("idx_team_organization").on(table.organizationId),
	index("idx_username").on(table.username),
]);

export const userNotificationPreferences = mysqlTable("user_notification_preferences", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	enableAppNotifications: tinyint().default(1),
	enableEmailNotifications: tinyint().default(1),
	bidAdjustNotify: tinyint().default(1),
	negativeKeywordNotify: tinyint().default(1),
	campaignChangeNotify: tinyint().default(1),
	automationNotify: tinyint().default(1),
	teamChangeNotify: tinyint().default(1),
	dataImportExportNotify: tinyint().default(0),
	notifyOnLow: tinyint().default(0),
	notifyOnMedium: tinyint().default(1),
	notifyOnHigh: tinyint().default(1),
	notifyOnCritical: tinyint().default(1),
	quietHoursEnabled: tinyint().default(0),
	quietHoursStart: varchar({ length: 5 }),
	quietHoursEnd: varchar({ length: 5 }),
	timezone: varchar({ length: 64 }).default('Asia/Shanghai'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const users = mysqlTable("users", {
	id: int().autoincrement().notNull(),
	organizationId: int("organization_id").default(1),
	openId: varchar({ length: 64 }).notNull(),
	name: text(),
	email: varchar({ length: 320 }),
	loginMethod: varchar({ length: 64 }),
	role: mysqlEnum(['user','admin']).default('user').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	lastSignedIn: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("users_openId_unique").on(table.openId),
	index("idx_organization").on(table.organizationId),
]);


// 报告任务表 - 用于异步报告处理
export const reportJobs = mysqlTable("report_jobs", {
	id: int().autoincrement().primaryKey().notNull(),
	accountId: int().notNull(),
	profileId: varchar({ length: 64 }).notNull(),
	reportType: varchar({ length: 64 }).notNull(), // spCampaigns, sbCampaigns, sdCampaigns, etc.
	adProduct: varchar({ length: 32 }).notNull(), // SPONSORED_PRODUCTS, SPONSORED_BRANDS, SPONSORED_DISPLAY
	reportId: varchar({ length: 128 }), // Amazon报告ID
	status: mysqlEnum(['pending', 'submitted', 'processing', 'completed', 'failed', 'expired']).default('pending').notNull(),
	startDate: varchar({ length: 10 }).notNull(), // YYYY-MM-DD
	endDate: varchar({ length: 10 }).notNull(), // YYYY-MM-DD
	requestPayload: json(), // 报告请求的完整配置
	downloadUrl: text(), // 报告下载URL
	recordsProcessed: int().default(0), // 处理的记录数
	errorMessage: text(), // 错误信息
	retryCount: int().default(0), // 重试次数
	maxRetries: int().default(3), // 最大重试次数
	priority: mysqlEnum(['critical', 'high', 'medium', 'low']).default('medium'), // 任务优先级
	metadata: json(), // 任务元数据（分层信息、进度追踪等）
	submittedAt: timestamp({ mode: 'string' }), // 提交时间
	completedAt: timestamp({ mode: 'string' }), // 完成时间
	processedAt: timestamp({ mode: 'string' }), // 数据处理时间
	expiresAt: timestamp({ mode: 'string' }), // 报告过期时间
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_report_jobs_account").on(table.accountId),
	index("idx_report_jobs_status").on(table.status),
	index("idx_report_jobs_report_id").on(table.reportId),
	index("idx_report_jobs_profile").on(table.profileId),
]);


// 账号初始化进度表 - 追踪新店铺数据初始化进度
export const accountInitializationProgress = mysqlTable("account_initialization_progress", {
	id: int().autoincrement().primaryKey().notNull(),
	accountId: int().notNull(),
	phase: varchar({ length: 50 }).notNull(), // hot_data, cold_data, structure_data
	phaseStatus: varchar({ length: 20 }).default('pending').notNull(), // pending, in_progress, completed, failed
	totalTasks: int().default(0).notNull(),
	completedTasks: int().default(0).notNull(),
	failedTasks: int().default(0).notNull(),
	startedAt: timestamp({ mode: 'string' }),
	completedAt: timestamp({ mode: 'string' }),
	errorMessage: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_account_phase").on(table.accountId, table.phase),
]);

// ==================== 类型导出 ====================
import { InferSelectModel, InferInsertModel } from "drizzle-orm";

// 竞价日志相关类型
export type BiddingLog = InferSelectModel<typeof biddingLogs>;
export type InsertBiddingLog = InferInsertModel<typeof biddingLogs>;

// 每日表现相关类型
export type DailyPerformance = InferSelectModel<typeof dailyPerformance>;
export type InsertDailyPerformance = InferInsertModel<typeof dailyPerformance>;

// 市场曲线数据相关类型
export type MarketCurveData = InferSelectModel<typeof marketCurveData>;
export type InsertMarketCurveData = InferInsertModel<typeof marketCurveData>;

// 导入任务相关类型
export type ImportJob = InferSelectModel<typeof importJobs>;
export type InsertImportJob = InferInsertModel<typeof importJobs>;

// 通知设置相关类型
export type NotificationSetting = InferSelectModel<typeof notificationSettings>;
export type InsertNotificationSetting = InferInsertModel<typeof notificationSettings>;

// 通知历史相关类型
export type NotificationHistoryRecord = InferSelectModel<typeof notificationHistory>;
export type InsertNotificationHistory = InferInsertModel<typeof notificationHistory>;

// 计划任务相关类型
export type ScheduledTask = InferSelectModel<typeof scheduledTasks>;
export type InsertScheduledTask = InferInsertModel<typeof scheduledTasks>;

// 任务执行日志相关类型
export type TaskExecutionLogRecord = InferSelectModel<typeof taskExecutionLog>;
export type InsertTaskExecutionLog = InferInsertModel<typeof taskExecutionLog>;

// 批量操作相关类型
export type BatchOperation = InferSelectModel<typeof batchOperations>;
export type InsertBatchOperation = InferInsertModel<typeof batchOperations>;
export type BatchOperationItem = InferSelectModel<typeof batchOperationItems>;
export type InsertBatchOperationItem = InferInsertModel<typeof batchOperationItems>;

// 归因校正相关类型
export type AttributionCorrectionRecord = InferSelectModel<typeof attributionCorrectionRecords>;
export type InsertAttributionCorrectionRecord = InferInsertModel<typeof attributionCorrectionRecords>;

// 校正审核会话相关类型
export type CorrectionReviewSession = InferSelectModel<typeof correctionReviewSessions>;
export type InsertCorrectionReviewSession = InferInsertModel<typeof correctionReviewSessions>;

// 账号权限相关类型
export type AccountPermission = InferSelectModel<typeof accountPermissions>;
export type InsertAccountPermission = InferInsertModel<typeof accountPermissions>;

// 邮件报告订阅相关类型
export type EmailReportSubscription = InferSelectModel<typeof emailReportSubscriptions>;
export type InsertEmailReportSubscription = InferInsertModel<typeof emailReportSubscriptions>;

// 邮件发送日志相关类型
export type EmailSendLog = InferSelectModel<typeof emailSendLogs>;
export type InsertEmailSendLog = InferInsertModel<typeof emailSendLogs>;

// AI优化执行相关类型
export type AiOptimizationExecution = InferSelectModel<typeof aiOptimizationExecutions>;
export type InsertAiOptimizationExecution = InferInsertModel<typeof aiOptimizationExecutions>;

// 出价调整历史相关类型
export type BidAdjustmentHistory = InferSelectModel<typeof bidAdjustmentHistory>;
export type InsertBidAdjustmentHistory = InferInsertModel<typeof bidAdjustmentHistory>;

// 位置表现相关类型
export type PlacementPerformance = InferSelectModel<typeof placementPerformance>;
export type InsertPlacementPerformance = InferInsertModel<typeof placementPerformance>;

// 位置设置相关类型
export type PlacementSetting = InferSelectModel<typeof placementSettings>;
export type InsertPlacementSetting = InferInsertModel<typeof placementSettings>;

// 每小时表现相关类型
export type HourlyPerformance = InferSelectModel<typeof hourlyPerformance>;
export type InsertHourlyPerformance = InferInsertModel<typeof hourlyPerformance>;

// 分时策略相关类型
export type DaypartingStrategy = InferSelectModel<typeof daypartingStrategies>;
export type InsertDaypartingStrategy = InferInsertModel<typeof daypartingStrategies>;

// 分时预算规则相关类型
export type DaypartingBudgetRule = InferSelectModel<typeof daypartingBudgetRules>;
export type InsertDaypartingBudgetRule = InferInsertModel<typeof daypartingBudgetRules>;

// 分时竞价规则相关类型
export type HourpartingBidRule = InferSelectModel<typeof hourpartingBidRules>;
export type InsertHourpartingBidRule = InferInsertModel<typeof hourpartingBidRules>;

// 分时执行日志相关类型
export type DaypartingExecutionLog = InferSelectModel<typeof daypartingExecutionLogs>;
export type InsertDaypartingExecutionLog = InferInsertModel<typeof daypartingExecutionLogs>;

// 预算分配相关类型
export type BudgetAllocationConfig = InferSelectModel<typeof budgetAllocationConfigs>;
export type InsertBudgetAllocationConfig = InferInsertModel<typeof budgetAllocationConfigs>;
export type BudgetAllocationSuggestion = InferSelectModel<typeof budgetAllocationSuggestions>;
export type InsertBudgetAllocationSuggestion = InferInsertModel<typeof budgetAllocationSuggestions>;
export type BudgetAllocationHistory = InferSelectModel<typeof budgetAllocationHistory>;
export type InsertBudgetAllocationHistory = InferInsertModel<typeof budgetAllocationHistory>;

// 广告活动表现快照相关类型
export type CampaignPerformanceSnapshot = InferSelectModel<typeof campaignPerformanceSnapshots>;
export type InsertCampaignPerformanceSnapshot = InferInsertModel<typeof campaignPerformanceSnapshots>;

// ==================== 补充缺失的类型导出 ====================

// 广告账户相关类型
export type AdAccount = InferSelectModel<typeof adAccounts>;
export type InsertAdAccount = InferInsertModel<typeof adAccounts>;

// 广告活动相关类型
export type Campaign = InferSelectModel<typeof campaigns>;
export type InsertCampaign = InferInsertModel<typeof campaigns>;

// 广告组相关类型
export type AdGroup = InferSelectModel<typeof adGroups>;
export type InsertAdGroup = InferInsertModel<typeof adGroups>;

// 关键词相关类型
export type Keyword = InferSelectModel<typeof keywords>;
export type InsertKeyword = InferInsertModel<typeof keywords>;

// 产品定向相关类型
export type ProductTarget = InferSelectModel<typeof productTargets>;
export type InsertProductTarget = InferInsertModel<typeof productTargets>;

// 效果组相关类型
export type PerformanceGroup = InferSelectModel<typeof performanceGroups>;
export type InsertPerformanceGroup = InferInsertModel<typeof performanceGroups>;

// 否定关键词相关类型
export type NegativeKeyword = InferSelectModel<typeof negativeKeywords>;
export type InsertNegativeKeyword = InferInsertModel<typeof negativeKeywords>;

// 团队成员相关类型
export type TeamMember = InferSelectModel<typeof teamMembers>;
export type InsertTeamMember = InferInsertModel<typeof teamMembers>;

// 搜索词相关类型
export type SearchTerm = InferSelectModel<typeof searchTerms>;
export type InsertSearchTerm = InferInsertModel<typeof searchTerms>;

// AI优化动作相关类型
export type AiOptimizationAction = InferSelectModel<typeof aiOptimizationActions>;
export type InsertAiOptimizationAction = InferInsertModel<typeof aiOptimizationActions>;

// AI优化预测相关类型
export type AiOptimizationPrediction = InferSelectModel<typeof aiOptimizationPredictions>;
export type InsertAiOptimizationPrediction = InferInsertModel<typeof aiOptimizationPredictions>;

// A/B测试相关类型
export type ABTest = InferSelectModel<typeof abTests>;
export type InsertABTest = InferInsertModel<typeof abTests>;
export type ABTestVariant = InferSelectModel<typeof abTestVariants>;
export type InsertABTestVariant = InferInsertModel<typeof abTestVariants>;
export type ABTestResult = InferSelectModel<typeof abTestResults>;
export type InsertABTestResult = InferInsertModel<typeof abTestResults>;
export type ABTestDailyMetric = InferSelectModel<typeof abTestDailyMetrics>;
export type InsertABTestDailyMetric = InferInsertModel<typeof abTestDailyMetrics>;
export type ABTestCampaignAssignment = InferSelectModel<typeof abTestCampaignAssignments>;
export type InsertABTestCampaignAssignment = InferInsertModel<typeof abTestCampaignAssignments>;

// 预算自动执行相关类型
export type BudgetAutoExecutionConfig = InferSelectModel<typeof budgetAutoExecutionConfigs>;
export type InsertBudgetAutoExecutionConfig = InferInsertModel<typeof budgetAutoExecutionConfigs>;
export type BudgetAutoExecutionHistory = InferSelectModel<typeof budgetAutoExecutionHistory>;
export type InsertBudgetAutoExecutionHistory = InferInsertModel<typeof budgetAutoExecutionHistory>;
export type BudgetAutoExecutionDetail = InferSelectModel<typeof budgetAutoExecutionDetails>;
export type InsertBudgetAutoExecutionDetail = InferInsertModel<typeof budgetAutoExecutionDetails>;
export type BudgetAutoExecutionLog = InferSelectModel<typeof budgetAutoExecutionLogs>;
export type InsertBudgetAutoExecutionLog = InferInsertModel<typeof budgetAutoExecutionLogs>;

// 同步变更记录相关类型
export type SyncChangeRecord = InferSelectModel<typeof syncChangeRecords>;
export type InsertSyncChangeRecord = InferInsertModel<typeof syncChangeRecords>;
export type SyncConflict = InferSelectModel<typeof syncConflicts>;
export type InsertSyncConflict = InferInsertModel<typeof syncConflicts>;

// 季节性预算推荐相关类型
export type SeasonalBudgetRecommendation = InferSelectModel<typeof seasonalBudgetRecommendations>;
export type InsertSeasonalBudgetRecommendation = InferInsertModel<typeof seasonalBudgetRecommendations>;

// 促销活动相关类型
export type PromotionalEvent = InferSelectModel<typeof promotionalEvents>;
export type InsertPromotionalEvent = InferInsertModel<typeof promotionalEvents>;

// 季节性趋势相关类型
export type SeasonalTrend = InferSelectModel<typeof seasonalTrends>;
export type InsertSeasonalTrend = InferInsertModel<typeof seasonalTrends>;

// 智能分配相关类型
export type BudgetAllocation = InferSelectModel<typeof budgetAllocations>;
export type InsertBudgetAllocation = InferInsertModel<typeof budgetAllocations>;
export type BudgetAllocationItem = InferSelectModel<typeof budgetAllocationItems>;
export type InsertBudgetAllocationItem = InferInsertModel<typeof budgetAllocationItems>;
export type BudgetAllocationTracking = InferSelectModel<typeof budgetAllocationTracking>;
export type InsertBudgetAllocationTracking = InferInsertModel<typeof budgetAllocationTracking>;

// 决策树模型相关类型
export type DecisionTreeModel = InferSelectModel<typeof decisionTreeModels>;
export type InsertDecisionTreeModel = InferInsertModel<typeof decisionTreeModels>;

// 边际效益相关类型
export type MarginalBenefitHistory = InferSelectModel<typeof marginalBenefitHistory>;
export type InsertMarginalBenefitHistory = InferInsertModel<typeof marginalBenefitHistory>;
export type MarginalBenefitApplication = InferSelectModel<typeof marginalBenefitApplications>;
export type InsertMarginalBenefitApplication = InferInsertModel<typeof marginalBenefitApplications>;
export type BatchMarginalBenefitAnalysis = InferSelectModel<typeof batchMarginalBenefitAnalysis>;
export type InsertBatchMarginalBenefitAnalysis = InferInsertModel<typeof batchMarginalBenefitAnalysis>;

// 预算目标相关类型
export type BudgetGoal = InferSelectModel<typeof budgetGoals>;
export type InsertBudgetGoal = InferInsertModel<typeof budgetGoals>;

// 预算历史相关类型
export type BudgetHistory = InferSelectModel<typeof budgetHistory>;
export type InsertBudgetHistory = InferInsertModel<typeof budgetHistory>;

// 数据同步相关类型
export type DataSyncJob = InferSelectModel<typeof dataSyncJobs>;
export type InsertDataSyncJob = InferInsertModel<typeof dataSyncJobs>;
export type DataSyncLog = InferSelectModel<typeof dataSyncLogs>;
export type InsertDataSyncLog = InferInsertModel<typeof dataSyncLogs>;
export type DataSyncSchedule = InferSelectModel<typeof dataSyncSchedules>;
export type InsertDataSyncSchedule = InferInsertModel<typeof dataSyncSchedules>;
export type DataSyncTask = InferSelectModel<typeof dataSyncTasks>;
export type InsertDataSyncTask = InferInsertModel<typeof dataSyncTasks>;

// 用户相关类型
export type User = InferSelectModel<typeof users>;
export type InsertUser = InferInsertModel<typeof users>;

// 组织相关类型
export type Organization = InferSelectModel<typeof organizations>;
export type InsertOrganization = InferInsertModel<typeof organizations>;

// 本地用户相关类型
export type LocalUser = InferSelectModel<typeof localUsers>;
export type InsertLocalUser = InferInsertModel<typeof localUsers>;

// 邀请码相关类型
export type InviteCode = InferSelectModel<typeof inviteCodes>;
export type InsertInviteCode = InferInsertModel<typeof inviteCodes>;
export type InviteCodeUsage = InferSelectModel<typeof inviteCodeUsages>;
export type InsertInviteCodeUsage = InferInsertModel<typeof inviteCodeUsages>;

// 审计日志相关类型
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type InsertAuditLog = InferInsertModel<typeof auditLogs>;

// 协作通知相关类型
export type CollaborationNotification = InferSelectModel<typeof collaborationNotifications>;
export type InsertCollaborationNotification = InferInsertModel<typeof collaborationNotifications>;
export type CollaborationNotificationRule = InferSelectModel<typeof collaborationNotificationRules>;
export type InsertCollaborationNotificationRule = InferInsertModel<typeof collaborationNotificationRules>;

// 报告任务相关类型
export type ReportJob = InferSelectModel<typeof reportJobs>;
export type InsertReportJob = InferInsertModel<typeof reportJobs>;

// 账号初始化进度相关类型
export type AccountInitializationProgress = InferSelectModel<typeof accountInitializationProgress>;
export type InsertAccountInitializationProgress = InferInsertModel<typeof accountInitializationProgress>;

// 搜索词分析相关类型
export type SearchTermAnalysis = InferSelectModel<typeof searchTermAnalysis>;
export type InsertSearchTermAnalysis = InferInsertModel<typeof searchTermAnalysis>;

// 关键词预测相关类型
export type KeywordPrediction = InferSelectModel<typeof keywordPredictions>;
export type InsertKeywordPrediction = InferInsertModel<typeof keywordPredictions>;

// 优化建议相关类型
export type OptimizationRecommendation = InferSelectModel<typeof optimizationRecommendations>;
export type InsertOptimizationRecommendation = InferInsertModel<typeof optimizationRecommendations>;

// 异常检测规则相关类型
export type AnomalyDetectionRule = InferSelectModel<typeof anomalyDetectionRules>;
export type InsertAnomalyDetectionRule = InferInsertModel<typeof anomalyDetectionRules>;
export type AnomalyAlertLog = InferSelectModel<typeof anomalyAlertLogs>;
export type InsertAnomalyAlertLog = InferInsertModel<typeof anomalyAlertLogs>;

// 花费限制相关类型
export type SpendLimitConfig = InferSelectModel<typeof spendLimitConfigs>;
export type InsertSpendLimitConfig = InferInsertModel<typeof spendLimitConfigs>;
export type SpendAlertLog = InferSelectModel<typeof spendAlertLogs>;
export type InsertSpendAlertLog = InferInsertModel<typeof spendAlertLogs>;

// 预算消耗告警相关类型
export type BudgetConsumptionAlert = InferSelectModel<typeof budgetConsumptionAlerts>;
export type InsertBudgetConsumptionAlert = InferInsertModel<typeof budgetConsumptionAlerts>;

// 预算告警设置相关类型
export type BudgetAlertSetting = InferSelectModel<typeof budgetAlertSettings>;
export type InsertBudgetAlertSetting = InferInsertModel<typeof budgetAlertSettings>;

// API相关类型
export type ApiCallLog = InferSelectModel<typeof apiCallLogs>;
export type InsertApiCallLog = InferInsertModel<typeof apiCallLogs>;
export type ApiOperationLog = InferSelectModel<typeof apiOperationLogs>;
export type InsertApiOperationLog = InferInsertModel<typeof apiOperationLogs>;
export type ApiRateLimit = InferSelectModel<typeof apiRateLimits>;
export type InsertApiRateLimit = InferInsertModel<typeof apiRateLimits>;
export type ApiRequestQueue = InferSelectModel<typeof apiRequestQueue>;
export type InsertApiRequestQueue = InferInsertModel<typeof apiRequestQueue>;

// Amazon API凭证相关类型
export type AmazonApiCredential = InferSelectModel<typeof amazonApiCredentials>;
export type InsertAmazonApiCredential = InferInsertModel<typeof amazonApiCredentials>;

// AMS相关类型
export type AmsSubscription = InferSelectModel<typeof amsSubscriptions>;
export type InsertAmsSubscription = InferInsertModel<typeof amsSubscriptions>;
export type AmsMessage = InferSelectModel<typeof amsMessages>;
export type InsertAmsMessage = InferInsertModel<typeof amsMessages>;
export type AmsPerformanceData = InferSelectModel<typeof amsPerformanceData>;
export type InsertAmsPerformanceData = InferInsertModel<typeof amsPerformanceData>;
export type AmsPerformanceBuffer = InferSelectModel<typeof amsPerformanceBuffer>;
export type InsertAmsPerformanceBuffer = InferInsertModel<typeof amsPerformanceBuffer>;
export type AmsConsumerStatus = InferSelectModel<typeof amsConsumerStatus>;
export type InsertAmsConsumerStatus = InferInsertModel<typeof amsConsumerStatus>;

// 自动暂停记录相关类型
export type AutoPauseRecord = InferSelectModel<typeof autoPauseRecords>;
export type InsertAutoPauseRecord = InferInsertModel<typeof autoPauseRecords>;

// 自动定向相关类型
export type AutoTargetingSetting = InferSelectModel<typeof autoTargetingSettings>;
export type InsertAutoTargetingSetting = InferInsertModel<typeof autoTargetingSettings>;
export type AutoTargetingPerformance = InferSelectModel<typeof autoTargetingPerformance>;
export type InsertAutoTargetingPerformance = InferInsertModel<typeof autoTargetingPerformance>;

// 出价对象利润估算相关类型
export type BidObjectProfitEstimate = InferSelectModel<typeof bidObjectProfitEstimates>;
export type InsertBidObjectProfitEstimate = InferInsertModel<typeof bidObjectProfitEstimates>;

// 出价表现历史相关类型
export type BidPerformanceHistory = InferSelectModel<typeof bidPerformanceHistory>;
export type InsertBidPerformanceHistory = InferInsertModel<typeof bidPerformanceHistory>;

// 分时竞价规则相关类型
export type DaypartingBidRule = InferSelectModel<typeof daypartingBidRules>;
export type InsertDaypartingBidRule = InferInsertModel<typeof daypartingBidRules>;

// 市场曲线模型相关类型
export type MarketCurveModel = InferSelectModel<typeof marketCurveModels>;
export type InsertMarketCurveModel = InferInsertModel<typeof marketCurveModels>;

// 位置出价设置相关类型
export type PlacementBidSetting = InferSelectModel<typeof placementBidSettings>;
export type InsertPlacementBidSetting = InferInsertModel<typeof placementBidSettings>;

// SB广告活动设置相关类型
export type SbCampaignSetting = InferSelectModel<typeof sbCampaignSettings>;
export type InsertSbCampaignSetting = InferInsertModel<typeof sbCampaignSettings>;

// SD广告活动设置相关类型
export type SdCampaignSetting = InferSelectModel<typeof sdCampaignSettings>;
export type InsertSdCampaignSetting = InferInsertModel<typeof sdCampaignSettings>;
export type SdAudience = InferSelectModel<typeof sdAudiences>;
export type InsertSdAudience = InferInsertModel<typeof sdAudiences>;
export type SdAudienceTargeting = InferSelectModel<typeof sdAudienceTargeting>;
export type InsertSdAudienceTargeting = InferInsertModel<typeof sdAudienceTargeting>;

// 同步相关类型
export type SyncSchedule = InferSelectModel<typeof syncSchedules>;
export type InsertSyncSchedule = InferInsertModel<typeof syncSchedules>;
export type SyncTaskQueue = InferSelectModel<typeof syncTaskQueue>;
export type InsertSyncTaskQueue = InferInsertModel<typeof syncTaskQueue>;
export type SyncChangeSummary = InferSelectModel<typeof syncChangeSummary>;
export type InsertSyncChangeSummary = InferInsertModel<typeof syncChangeSummary>;
export type DataConsistencyCheck = InferSelectModel<typeof dataConsistencyChecks>;
export type InsertDataConsistencyCheck = InferInsertModel<typeof dataConsistencyChecks>;

// 用户通知偏好相关类型
export type UserNotificationPreference = InferSelectModel<typeof userNotificationPreferences>;
export type InsertUserNotificationPreference = InferInsertModel<typeof userNotificationPreferences>;

// AI优化审核相关类型
export type AiOptimizationReview = InferSelectModel<typeof aiOptimizationReviews>;
export type InsertAiOptimizationReview = InferInsertModel<typeof aiOptimizationReviews>;
