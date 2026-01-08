import { mysqlTable, mysqlSchema, AnyMySqlColumn, int, mysqlEnum, timestamp, varchar, decimal, text, index, json, date, tinyint } from "drizzle-orm/mysql-core"
import { sql } from "drizzle-orm"

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
});

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
},
(table) => [
	index("amazon_api_credentials_accountId_unique").on(table.accountId),
]);

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
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	userEmail: varchar({ length: 255 }),
	userName: varchar({ length: 255 }),
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
	optimizationStatus: mysqlEnum(['managed','unmanaged']).default('unmanaged'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	dailyBudget: decimal({ precision: 10, scale: 2 }),
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
});

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
	// 增量同步和重试相关字段
	isIncremental: tinyint().default(0),
	retryCount: int().default(0),
	maxRetries: int().default(3),
	durationMs: int(),
	recordsSkipped: int().default(0),
	spCampaigns: int().default(0),
	sbCampaigns: int().default(0),
	sdCampaigns: int().default(0),
	adGroupsSynced: int().default(0),
	keywordsSynced: int().default(0),
	targetsSynced: int().default(0),
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
	userId: int('user_id').notNull(),
	accountId: int('account_id').notNull(),
	syncType: mysqlEnum('sync_type', ['campaigns','ad_groups','keywords','product_targets','search_terms','performance_daily','performance_hourly','full_sync']).notNull(),
	frequency: mysqlEnum(['hourly','every_2_hours','every_4_hours','every_6_hours','every_12_hours','daily','weekly']).default('daily'),
	preferredTime: varchar('preferred_time', { length: 5 }),
	preferredDayOfWeek: int('preferred_day_of_week'),
	isEnabled: tinyint('is_enabled').default(1),
	lastRunAt: timestamp('last_run_at', { mode: 'string' }),
	nextRunAt: timestamp('next_run_at', { mode: 'string' }),
	createdAt: timestamp('created_at', { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp('updated_at', { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
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
	// 分时预算分配配置
	daypartingEnabled: tinyint().default(1), // 是否启用分时预算分配
	daypartingStrategy: mysqlEnum(['performance_based','equal','custom']).default('performance_based'), // 分配策略
	daypartingAutoAdjust: tinyint().default(1), // 是否自动调整
	daypartingMinBudgetPercent: decimal({ precision: 5, scale: 2 }).default('2.00'), // 最小时段预算百分比
	daypartingMaxBudgetPercent: decimal({ precision: 5, scale: 2 }).default('15.00'), // 最大时段预算百分比
	daypartingReserveBudget: decimal({ precision: 5, scale: 2 }).default('10.00'), // 预留预算百分比
	daypartingLastAnalysis: timestamp({ mode: 'string' }), // 上次分析时间
	daypartingLastExecution: timestamp({ mode: 'string' }), // 上次执行时间
	// 投放词自动执行配置
	keywordAutoEnabled: tinyint().default(1), // 是否启用投放词自动执行
	keywordAutoPauseEnabled: tinyint().default(1), // 是否启用自动暂停
	keywordAutoEnableEnabled: tinyint().default(0), // 是否启用自动启用
	keywordPauseMinSpend: decimal({ precision: 10, scale: 2 }).default('10.00'), // 暂停最低花费阈值
	keywordPauseMaxAcos: decimal({ precision: 5, scale: 2 }).default('100.00'), // 暂停最大ACoS阈值
	keywordLastAutoExecution: timestamp({ mode: 'string' }), // 上次自动执行时间
	dailyBudget: decimal('daily_budget', { precision: 10, scale: 2 }), // 每日预算
	maxBid: decimal('max_bid', { precision: 10, scale: 2 }), // 最大出价
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

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
});

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
]);


// ==================== Adspert算法相关表 ====================

// 市场曲线模型表
export const marketCurveModels = mysqlTable("market_curve_models", {
	id: int().autoincrement().notNull().primaryKey(),
	accountId: int().notNull(),
	campaignId: varchar({ length: 64 }),
	bidObjectType: mysqlEnum(['keyword', 'asin', 'audience']).notNull(),
	bidObjectId: varchar({ length: 64 }).notNull(),
	bidObjectText: varchar({ length: 500 }),
	impressionCurveA: decimal({ precision: 15, scale: 6 }),
	impressionCurveB: decimal({ precision: 15, scale: 6 }),
	impressionCurveC: decimal({ precision: 15, scale: 6 }),
	impressionCurveR2: decimal({ precision: 10, scale: 6 }),
	baseCTR: decimal({ precision: 10, scale: 6 }),
	positionBonus: decimal({ precision: 10, scale: 6 }),
	topSearchCTRBonus: decimal({ precision: 10, scale: 6 }),
	cvr: decimal({ precision: 10, scale: 6 }),
	aov: decimal({ precision: 15, scale: 2 }),
	conversionDelayDays: int().default(7),
	cvrSource: mysqlEnum(['historical', 'predicted', 'default']).default('historical'),
	optimalBid: decimal({ precision: 10, scale: 4 }),
	maxProfit: decimal({ precision: 15, scale: 2 }),
	profitMargin: decimal({ precision: 10, scale: 4 }),
	breakEvenCPC: decimal({ precision: 10, scale: 4 }),
	currentBid: decimal({ precision: 10, scale: 4 }),
	bidGap: decimal({ precision: 10, scale: 4 }),
	bidGapPercent: decimal({ precision: 10, scale: 4 }),
	dataPoints: int().default(0),
	confidence: decimal({ precision: 10, scale: 4 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 决策树模型表
export const decisionTreeModels = mysqlTable("decision_tree_models", {
	id: int().autoincrement().notNull().primaryKey(),
	accountId: int("account_id").notNull(),
	modelType: mysqlEnum("model_type", ['cr_prediction', 'cv_prediction']).notNull(),
	treeStructure: text("tree_structure"),
	featureImportance: text("feature_importance"),
	trainingR2: decimal("training_r2", { precision: 10, scale: 6 }),
	validationR2: decimal("validation_r2", { precision: 10, scale: 6 }),
	totalSamples: int("total_samples").default(0),
	depth: int().default(0),
	leafCount: int("leaf_count").default(0),
	isActive: tinyint("is_active").default(1),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 关键词预测结果表
export const keywordPredictions = mysqlTable("keyword_predictions", {
	id: int().autoincrement().notNull().primaryKey(),
	accountId: int("account_id").notNull(),
	keywordId: int("keyword_id").notNull(),
	keywordText: varchar("keyword_text", { length: 500 }),
	matchType: mysqlEnum("match_type", ['broad', 'phrase', 'exact']),
	wordCount: int("word_count"),
	keywordType: mysqlEnum("keyword_type", ['brand', 'competitor', 'generic', 'product']),
	predictedCR: decimal("predicted_cr", { precision: 10, scale: 6 }),
	predictedCV: decimal("predicted_cv", { precision: 15, scale: 2 }),
	actualCR: decimal("actual_cr", { precision: 10, scale: 6 }),
	actualCV: decimal("actual_cv", { precision: 15, scale: 2 }),
	confidence: decimal({ precision: 10, scale: 4 }),
	predictionSource: mysqlEnum("prediction_source", ['decision_tree', 'bayesian', 'default']).default('decision_tree'),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 竞价对象利润估算表
export const bidObjectProfitEstimates = mysqlTable("bid_object_profit_estimates", {
	id: int().autoincrement().notNull().primaryKey(),
	accountId: int("account_id").notNull(),
	campaignId: varchar("campaign_id", { length: 64 }),
	bidObjectType: mysqlEnum("bid_object_type", ['keyword', 'asin']).notNull(),
	bidObjectId: varchar("bid_object_id", { length: 64 }).notNull(),
	bidObjectText: varchar("bid_object_text", { length: 500 }),
	currentBaseBid: decimal("current_base_bid", { precision: 10, scale: 4 }),
	currentTopAdjustment: int("current_top_adjustment").default(0),
	currentProductAdjustment: int("current_product_adjustment").default(0),
	estimatedProfitTop: decimal("estimated_profit_top", { precision: 15, scale: 2 }),
	estimatedProfitProduct: decimal("estimated_profit_product", { precision: 15, scale: 2 }),
	estimatedProfitRest: decimal("estimated_profit_rest", { precision: 15, scale: 2 }),
	totalEstimatedProfit: decimal("total_estimated_profit", { precision: 15, scale: 2 }),
	recommendedBaseBid: decimal("recommended_base_bid", { precision: 10, scale: 4 }),
	recommendedTopAdjustment: int("recommended_top_adjustment").default(0),
	recommendedProductAdjustment: int("recommended_product_adjustment").default(0),
	profitImprovementPotential: decimal("profit_improvement_potential", { precision: 15, scale: 2 }),
	profitImprovementPercent: decimal("profit_improvement_percent", { precision: 10, scale: 4 }),
	confidence: decimal({ precision: 10, scale: 4 }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 优化建议表
export const optimizationRecommendations = mysqlTable("optimization_recommendations", {
	id: int().autoincrement().notNull().primaryKey(),
	accountId: int("account_id").notNull(),
	campaignId: varchar("campaign_id", { length: 64 }),
	recommendationType: varchar("recommendation_type", { length: 64 }).notNull(),
	priority: mysqlEnum(['critical', 'high', 'medium', 'low']).default('medium'),
	title: varchar({ length: 255 }),
	description: text(),
	expectedImpact: varchar("expected_impact", { length: 255 }),
	currentValue: json("current_value"),
	recommendedValue: json("recommended_value"),
	expectedProfitChange: decimal("expected_profit_change", { precision: 15, scale: 2 }),
	status: mysqlEnum(['pending', 'applied', 'dismissed', 'expired']).default('pending'),
	appliedAt: timestamp("applied_at", { mode: 'string' }),
	appliedBy: int("applied_by"),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 出价表现历史表
export const bidPerformanceHistory = mysqlTable("bid_performance_history", {
	id: int().autoincrement().notNull().primaryKey(),
	accountId: int("account_id").notNull(),
	campaignId: varchar("campaign_id", { length: 64 }),
	bidObjectType: mysqlEnum("bid_object_type", ['keyword', 'asin', 'audience']).notNull(),
	bidObjectId: varchar("bid_object_id", { length: 64 }).notNull(),
	date: varchar({ length: 10 }).notNull(),
	bid: decimal({ precision: 10, scale: 4 }),
	effectiveCPC: decimal("effective_cpc", { precision: 10, scale: 4 }),
	impressions: int().default(0),
	clicks: int().default(0),
	spend: decimal({ precision: 15, scale: 2 }),
	sales: decimal({ precision: 15, scale: 2 }),
	orders: int().default(0),
	ctr: decimal({ precision: 10, scale: 6 }),
	cvr: decimal({ precision: 10, scale: 6 }),
	acos: decimal({ precision: 10, scale: 4 }),
	roas: decimal({ precision: 10, scale: 4 }),
	placement: mysqlEnum(['top_of_search', 'product_page', 'rest_of_search']),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});


// 出价调整历史记录表
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
  adjustmentType: mysqlEnum("adjustment_type", ['manual', 'auto_optimal', 'auto_dayparting', 'auto_placement', 'batch_campaign', 'batch_group']).default('manual'),
  adjustmentReason: text("adjustment_reason"),
  expectedProfitIncrease: decimal("expected_profit_increase", { precision: 10, scale: 2 }),
  optimizationScore: int("optimization_score"),
  appliedBy: varchar("applied_by", { length: 255 }),
  appliedAt: timestamp("applied_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
  status: mysqlEnum("status", ['applied', 'pending', 'failed', 'rolled_back']).default('applied'),
  errorMessage: text("error_message"),
  // 效果追踪字段
  actualProfit7d: decimal("actual_profit_7d", { precision: 10, scale: 2 }),
  actualProfit14d: decimal("actual_profit_14d", { precision: 10, scale: 2 }),
  actualProfit30d: decimal("actual_profit_30d", { precision: 10, scale: 2 }),
  actualImpressions7d: int("actual_impressions_7d"),
  actualClicks7d: int("actual_clicks_7d"),
  actualConversions7d: int("actual_conversions_7d"),
  actualSpend7d: decimal("actual_spend_7d", { precision: 10, scale: 2 }),
  actualRevenue7d: decimal("actual_revenue_7d", { precision: 10, scale: 2 }),
  trackingUpdatedAt: timestamp("tracking_updated_at", { mode: 'string' }),
  // 回滚字段
  rolledBackAt: timestamp("rolled_back_at", { mode: 'string' }),
  rolledBackBy: varchar("rolled_back_by", { length: 255 }),
});


// 智能预算分配配置表
export const budgetAllocationConfigs = mysqlTable("budget_allocation_configs", {
  id: int().autoincrement().notNull(),
  performanceGroupId: int().notNull(),
  userId: int().notNull(),
  // 是否启用智能预算分配
  enabled: tinyint().default(0),
  // 分配模式: auto=全自动, semi_auto=半自动(需确认), manual=手动
  allocationMode: mysqlEnum(['auto', 'semi_auto', 'manual']).default('semi_auto'),
  // 评分权重配置
  conversionEfficiencyWeight: decimal({ precision: 3, scale: 2 }).default('0.40'),
  roasWeight: decimal({ precision: 3, scale: 2 }).default('0.35'),
  growthPotentialWeight: decimal({ precision: 3, scale: 2 }).default('0.25'),
  // 调整约束
  maxAdjustmentPercent: decimal({ precision: 5, scale: 2 }).default('10.00'),
  minDailyBudget: decimal({ precision: 10, scale: 2 }).default('5.00'),
  cooldownDays: int().default(3),
  newCampaignProtectionDays: int().default(7),
  // 数据窗口
  dataWindowDays: int().default(30),
  // 调整频率: daily=每天, weekly=每周, biweekly=每两周
  adjustmentFrequency: mysqlEnum(['daily', 'weekly', 'biweekly']).default('weekly'),
  // 上次运行时间
  lastRunAt: timestamp({ mode: 'string' }),
  nextRunAt: timestamp({ mode: 'string' }),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

// 预算分配建议表
export const budgetAllocationSuggestions = mysqlTable("budget_allocation_suggestions", {
  id: int().autoincrement().notNull(),
  performanceGroupId: int().notNull(),
  campaignId: int().notNull(),
  userId: int().notNull(),
  // 当前预算
  currentBudget: decimal({ precision: 10, scale: 2 }).notNull(),
  // 建议预算
  suggestedBudget: decimal({ precision: 10, scale: 2 }).notNull(),
  // 调整金额
  adjustmentAmount: decimal({ precision: 10, scale: 2 }).notNull(),
  // 调整百分比
  adjustmentPercent: decimal({ precision: 5, scale: 2 }).notNull(),
  // 综合得分
  compositeScore: decimal({ precision: 5, scale: 2 }).notNull(),
  // 转化效率得分
  conversionEfficiencyScore: decimal({ precision: 5, scale: 2 }),
  // ROAS得分
  roasScore: decimal({ precision: 5, scale: 2 }),
  // 增长潜力得分
  growthPotentialScore: decimal({ precision: 5, scale: 2 }),
  // 建议原因
  suggestionReason: text(),
  // 预测效果
  predictedConversions: decimal({ precision: 10, scale: 2 }),
  predictedRoas: decimal({ precision: 10, scale: 2 }),
  predictedSpend: decimal({ precision: 10, scale: 2 }),
  predictedSales: decimal({ precision: 10, scale: 2 }),
  // 状态: pending=待处理, approved=已批准, rejected=已拒绝, applied=已应用, expired=已过期
  status: mysqlEnum(['pending', 'approved', 'rejected', 'applied', 'expired']).default('pending'),
  // 处理时间
  processedAt: timestamp({ mode: 'string' }),
  processedBy: int(),
  // 过期时间
  expiresAt: timestamp({ mode: 'string' }),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

// 预算分配历史表
export const budgetAllocationHistory = mysqlTable("budget_allocation_history", {
  id: int().autoincrement().notNull(),
  suggestionId: int(),
  performanceGroupId: int().notNull(),
  campaignId: int().notNull(),
  userId: int().notNull(),
  // 调整前预算
  previousBudget: decimal({ precision: 10, scale: 2 }).notNull(),
  // 调整后预算
  newBudget: decimal({ precision: 10, scale: 2 }).notNull(),
  // 调整金额
  adjustmentAmount: decimal({ precision: 10, scale: 2 }).notNull(),
  // 调整百分比
  adjustmentPercent: decimal({ precision: 5, scale: 2 }).notNull(),
  // 调整原因
  adjustmentReason: text(),
  // 调整类型: auto=自动, manual=手动, rollback=回滚
  adjustmentType: mysqlEnum(['auto', 'manual', 'rollback']).default('auto'),
  // 调整前指标
  baselineSpend: decimal({ precision: 10, scale: 2 }),
  baselineSales: decimal({ precision: 10, scale: 2 }),
  baselineConversions: int(),
  baselineRoas: decimal({ precision: 10, scale: 2 }),
  baselineAcos: decimal({ precision: 5, scale: 2 }),
  // 调整后指标(效果追踪)
  actualSpend: decimal({ precision: 10, scale: 2 }),
  actualSales: decimal({ precision: 10, scale: 2 }),
  actualConversions: int(),
  actualRoas: decimal({ precision: 10, scale: 2 }),
  actualAcos: decimal({ precision: 5, scale: 2 }),
  // 效果追踪状态
  trackingStatus: mysqlEnum(['pending', 'tracking', 'completed']).default('pending'),
  trackingStartDate: timestamp({ mode: 'string' }),
  trackingEndDate: timestamp({ mode: 'string' }),
  // 是否已回滚
  isRolledBack: tinyint().default(0),
  rolledBackAt: timestamp({ mode: 'string' }),
  rollbackReason: text(),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

// 广告活动表现快照表(用于预算分配计算)
export const campaignPerformanceSnapshots = mysqlTable("campaign_performance_snapshots", {
  id: int().autoincrement().notNull(),
  performanceGroupId: int().notNull(),
  campaignId: int().notNull(),
  snapshotDate: date({ mode: 'string' }).notNull(),
  // 30天汇总数据
  dailyAvgSpend: decimal({ precision: 10, scale: 2 }),
  totalSpend: decimal({ precision: 12, scale: 2 }),
  totalSales: decimal({ precision: 12, scale: 2 }),
  totalConversions: int(),
  totalClicks: int(),
  totalImpressions: int(),
  // 计算指标
  roas: decimal({ precision: 10, scale: 2 }),
  acos: decimal({ precision: 5, scale: 2 }),
  ctr: decimal({ precision: 8, scale: 6 }),
  cvr: decimal({ precision: 8, scale: 6 }),
  cpc: decimal({ precision: 10, scale: 2 }),
  // 预算利用率
  budgetUtilization: decimal({ precision: 5, scale: 2 }),
  currentBudget: decimal({ precision: 10, scale: 2 }),
  // 综合得分
  compositeScore: decimal({ precision: 5, scale: 2 }),
  conversionEfficiencyScore: decimal({ precision: 5, scale: 2 }),
  roasScore: decimal({ precision: 5, scale: 2 }),
  growthPotentialScore: decimal({ precision: 5, scale: 2 }),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});


// A/B测试表
export const abTests = mysqlTable("ab_tests", {
  id: int().autoincrement().notNull().primaryKey(),
  accountId: int().notNull(),
  performanceGroupId: int(),
  testName: varchar({ length: 255 }).notNull(),
  testDescription: text(),
  testType: mysqlEnum(['budget_allocation', 'bid_strategy', 'targeting']).default('budget_allocation').notNull(),
  status: mysqlEnum(['draft', 'running', 'paused', 'completed', 'cancelled']).default('draft').notNull(),
  startDate: timestamp({ mode: 'string' }),
  endDate: timestamp({ mode: 'string' }),
  targetMetric: mysqlEnum(['roas', 'acos', 'conversions', 'revenue', 'profit']).default('roas').notNull(),
  minSampleSize: int().default(100),
  confidenceLevel: decimal({ precision: 5, scale: 2 }).default('0.95'),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
  createdBy: int(),
});

// A/B测试变体表
export const abTestVariants = mysqlTable("ab_test_variants", {
  id: int().autoincrement().notNull().primaryKey(),
  testId: int().notNull(),
  variantName: varchar({ length: 100 }).notNull(),
  variantType: mysqlEnum(['control', 'treatment']).notNull(),
  description: text(),
  configJson: text(), // 存储变体的具体配置，如预算分配策略参数
  trafficAllocation: decimal({ precision: 5, scale: 2 }).default('0.50'), // 流量分配比例
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// A/B测试广告活动分配表
export const abTestCampaignAssignments = mysqlTable("ab_test_campaign_assignments", {
  id: int().autoincrement().notNull().primaryKey(),
  testId: int().notNull(),
  variantId: int().notNull(),
  campaignId: int().notNull(),
  assignedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// A/B测试每日指标表
export const abTestDailyMetrics = mysqlTable("ab_test_daily_metrics", {
  id: int().autoincrement().notNull().primaryKey(),
  testId: int().notNull(),
  variantId: int().notNull(),
  metricDate: timestamp({ mode: 'string' }).notNull(),
  impressions: int().default(0),
  clicks: int().default(0),
  spend: decimal({ precision: 12, scale: 2 }).default('0.00'),
  sales: decimal({ precision: 12, scale: 2 }).default('0.00'),
  conversions: int().default(0),
  roas: decimal({ precision: 10, scale: 4 }),
  acos: decimal({ precision: 10, scale: 4 }),
  ctr: decimal({ precision: 10, scale: 4 }),
  cvr: decimal({ precision: 10, scale: 4 }),
  cpc: decimal({ precision: 10, scale: 4 }),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// A/B测试结果表
export const abTestResults = mysqlTable("ab_test_results", {
  id: int().autoincrement().notNull().primaryKey(),
  testId: int().notNull(),
  analysisDate: timestamp({ mode: 'string' }).notNull(),
  controlVariantId: int().notNull(),
  treatmentVariantId: int().notNull(),
  metricName: varchar({ length: 50 }).notNull(),
  controlValue: decimal({ precision: 12, scale: 4 }),
  treatmentValue: decimal({ precision: 12, scale: 4 }),
  absoluteDifference: decimal({ precision: 12, scale: 4 }),
  relativeDifference: decimal({ precision: 10, scale: 4 }), // 百分比变化
  pValue: decimal({ precision: 10, scale: 6 }),
  confidenceInterval: varchar({ length: 100 }), // 存储为JSON字符串，如 "[1.2, 1.8]"
  isStatisticallySignificant: tinyint().default(0),
  winningVariant: mysqlEnum(['control', 'treatment', 'inconclusive']),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 预算自动执行配置表
export const budgetAutoExecutionConfigs = mysqlTable("budget_auto_execution_configs", {
  id: int().autoincrement().notNull().primaryKey(),
  accountId: int().notNull(),
  performanceGroupId: int(),
  configName: varchar({ length: 255 }).notNull(),
  isEnabled: tinyint().default(0).notNull(),
  executionFrequency: mysqlEnum(['daily', 'weekly', 'biweekly', 'monthly']).default('daily').notNull(),
  executionTime: varchar({ length: 5 }).default('06:00'), // HH:MM格式
  executionDayOfWeek: int(), // 0-6，周日到周六，用于weekly
  executionDayOfMonth: int(), // 1-31，用于monthly
  minDataDays: int().default(7), // 最少需要多少天数据才执行
  maxAdjustmentPercent: decimal({ precision: 5, scale: 2 }).default('15.00'), // 单次最大调整幅度
  minBudget: decimal({ precision: 10, scale: 2 }).default('5.00'), // 最小预算
  requireApproval: tinyint().default(0), // 是否需要人工审批
  notifyOnExecution: tinyint().default(1), // 执行后是否通知
  notifyOnError: tinyint().default(1), // 错误时是否通知
  lastExecutionAt: timestamp({ mode: 'string' }),
  nextExecutionAt: timestamp({ mode: 'string' }),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
  createdBy: int(),
});

// 预算自动执行历史表
export const budgetAutoExecutionHistory = mysqlTable("budget_auto_execution_history", {
  id: int().autoincrement().notNull().primaryKey(),
  configId: int().notNull(),
  accountId: int().notNull(),
  executionStartAt: timestamp({ mode: 'string' }).notNull(),
  executionEndAt: timestamp({ mode: 'string' }),
  status: mysqlEnum(['running', 'completed', 'failed', 'cancelled', 'pending_approval']).default('running').notNull(),
  totalCampaigns: int().default(0),
  adjustedCampaigns: int().default(0),
  skippedCampaigns: int().default(0),
  errorCampaigns: int().default(0),
  totalBudgetBefore: decimal({ precision: 12, scale: 2 }),
  totalBudgetAfter: decimal({ precision: 12, scale: 2 }),
  executionSummary: text(), // JSON格式的执行摘要
  errorMessage: text(),
  approvedBy: int(),
  approvedAt: timestamp({ mode: 'string' }),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 预算自动执行明细表
export const budgetAutoExecutionDetails = mysqlTable("budget_auto_execution_details", {
  id: int().autoincrement().notNull().primaryKey(),
  executionId: int().notNull(),
  campaignId: int().notNull(),
  campaignName: varchar({ length: 500 }),
  budgetBefore: decimal({ precision: 10, scale: 2 }),
  budgetAfter: decimal({ precision: 10, scale: 2 }),
  adjustmentPercent: decimal({ precision: 10, scale: 2 }),
  adjustmentReason: text(),
  compositeScore: decimal({ precision: 10, scale: 4 }),
  riskLevel: mysqlEnum(['low', 'medium', 'high']),
  status: mysqlEnum(['applied', 'skipped', 'error', 'pending']).default('pending').notNull(),
  errorMessage: text(),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 基础表类型导出
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type AdAccount = typeof adAccounts.$inferSelect;
export type InsertAdAccount = typeof adAccounts.$inferInsert;
export type PerformanceGroup = typeof performanceGroups.$inferSelect;
export type InsertPerformanceGroup = typeof performanceGroups.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;
export type AdGroup = typeof adGroups.$inferSelect;
export type InsertAdGroup = typeof adGroups.$inferInsert;
export type Keyword = typeof keywords.$inferSelect;
export type InsertKeyword = typeof keywords.$inferInsert;
export type ProductTarget = typeof productTargets.$inferSelect;
export type InsertProductTarget = typeof productTargets.$inferInsert;
export type BiddingLog = typeof biddingLogs.$inferSelect;
export type InsertBiddingLog = typeof biddingLogs.$inferInsert;
export type DailyPerformance = typeof dailyPerformance.$inferSelect;
export type InsertDailyPerformance = typeof dailyPerformance.$inferInsert;
export type ImportJob = typeof importJobs.$inferSelect;
export type InsertImportJob = typeof importJobs.$inferInsert;
export type NegativeKeyword = typeof negativeKeywords.$inferSelect;
export type InsertNegativeKeyword = typeof negativeKeywords.$inferInsert;
export type NotificationSetting = typeof notificationSettings.$inferSelect;
export type InsertNotificationSetting = typeof notificationSettings.$inferInsert;
export type NotificationHistoryRecord = typeof notificationHistory.$inferSelect;
export type InsertNotificationHistory = typeof notificationHistory.$inferInsert;
export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type InsertScheduledTask = typeof scheduledTasks.$inferInsert;
export type TaskExecutionLogRecord = typeof taskExecutionLog.$inferSelect;
export type InsertTaskExecutionLog = typeof taskExecutionLog.$inferInsert;
export type BatchOperation = typeof batchOperations.$inferSelect;
export type InsertBatchOperation = typeof batchOperations.$inferInsert;
export type BatchOperationItem = typeof batchOperationItems.$inferSelect;
export type InsertBatchOperationItem = typeof batchOperationItems.$inferInsert;
export type AttributionCorrectionRecord = typeof attributionCorrectionRecords.$inferSelect;
export type InsertAttributionCorrectionRecord = typeof attributionCorrectionRecords.$inferInsert;
export type CorrectionReviewSession = typeof correctionReviewSessions.$inferSelect;
export type InsertCorrectionReviewSession = typeof correctionReviewSessions.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = typeof teamMembers.$inferInsert;
export type AccountPermission = typeof accountPermissions.$inferSelect;
export type InsertAccountPermission = typeof accountPermissions.$inferInsert;
export type EmailReportSubscription = typeof emailReportSubscriptions.$inferSelect;
export type InsertEmailReportSubscription = typeof emailReportSubscriptions.$inferInsert;
export type EmailSendLog = typeof emailSendLogs.$inferSelect;
export type InsertEmailSendLog = typeof emailSendLogs.$inferInsert;
export type SearchTerm = typeof searchTerms.$inferSelect;
export type InsertSearchTerm = typeof searchTerms.$inferInsert;
export type AiOptimizationExecution = typeof aiOptimizationExecutions.$inferSelect;
export type InsertAiOptimizationExecution = typeof aiOptimizationExecutions.$inferInsert;
export type AiOptimizationAction = typeof aiOptimizationActions.$inferSelect;
export type InsertAiOptimizationAction = typeof aiOptimizationActions.$inferInsert;
export type AiOptimizationPrediction = typeof aiOptimizationPredictions.$inferSelect;
export type InsertAiOptimizationPrediction = typeof aiOptimizationPredictions.$inferInsert;
export type AiOptimizationReview = typeof aiOptimizationReviews.$inferSelect;
export type InsertAiOptimizationReview = typeof aiOptimizationReviews.$inferInsert;
export type MarketCurveData = typeof marketCurveData.$inferSelect;
export type InsertMarketCurveData = typeof marketCurveData.$inferInsert;
export type BidAdjustmentHistory = typeof bidAdjustmentHistory.$inferSelect;
export type InsertBidAdjustmentHistory = typeof bidAdjustmentHistory.$inferInsert;
export type AmazonApiCredential = typeof amazonApiCredentials.$inferSelect;
export type InsertAmazonApiCredential = typeof amazonApiCredentials.$inferInsert;

// AB测试相关类型
export type ABTest = typeof abTests.$inferSelect;
export type InsertABTest = typeof abTests.$inferInsert;
export type ABTestVariant = typeof abTestVariants.$inferSelect;
export type InsertABTestVariant = typeof abTestVariants.$inferInsert;
export type ABTestCampaignAssignment = typeof abTestCampaignAssignments.$inferSelect;
export type InsertABTestCampaignAssignment = typeof abTestCampaignAssignments.$inferInsert;
export type ABTestDailyMetric = typeof abTestDailyMetrics.$inferSelect;
export type InsertABTestDailyMetric = typeof abTestDailyMetrics.$inferInsert;
export type ABTestResult = typeof abTestResults.$inferSelect;
export type InsertABTestResult = typeof abTestResults.$inferInsert;
export type BudgetAutoExecutionConfig = typeof budgetAutoExecutionConfigs.$inferSelect;
export type InsertBudgetAutoExecutionConfig = typeof budgetAutoExecutionConfigs.$inferInsert;
export type BudgetAutoExecutionHistory = typeof budgetAutoExecutionHistory.$inferSelect;
export type InsertBudgetAutoExecutionHistory = typeof budgetAutoExecutionHistory.$inferInsert;
export type BudgetAutoExecutionDetail = typeof budgetAutoExecutionDetails.$inferSelect;
export type InsertBudgetAutoExecutionDetail = typeof budgetAutoExecutionDetails.$inferInsert;


// 投放词自动执行配置表
export const keywordAutoExecutionConfigs = mysqlTable("keyword_auto_execution_configs", {
  id: int().autoincrement().notNull().primaryKey(),
  accountId: int().notNull(),
  name: varchar({ length: 255 }).notNull(),
  description: text(),
  isEnabled: tinyint().default(1).notNull(),
  
  // 自动暂停规则 - 高花费低转化
  autoPauseEnabled: tinyint().default(1),
  pauseMinSpend: decimal({ precision: 10, scale: 2 }).default('10.00'), // 最低花费阈值
  pauseMinClicks: int().default(20), // 最低点击阈值
  pauseMaxAcos: decimal({ precision: 5, scale: 2 }).default('100.00'), // 最大ACoS阈值
  pauseMinDays: int().default(7), // 最少观察天数
  pauseZeroConversions: tinyint().default(1), // 零转化是否暂停
  
  // 自动启用规则 - 潜力词恢复
  autoEnableEnabled: tinyint().default(0),
  enableMinConversions: int().default(2), // 最低转化阈值
  enableMinRoas: decimal({ precision: 10, scale: 2 }).default('2.00'), // 最低ROAS阈值
  enableCooldownDays: int().default(14), // 暂停后多少天可以重新启用
  
  // 安全阈值
  maxDailyPauses: int().default(10), // 每日最大暂停数量
  maxDailyEnables: int().default(5), // 每日最大启用数量
  excludeTopPerformers: tinyint().default(1), // 排除表现最好的词
  topPerformerThreshold: decimal({ precision: 5, scale: 2 }).default('20.00'), // 表现好的ACoS阈值
  
  // 回滚设置
  enableRollback: tinyint().default(1), // 是否启用回滚
  rollbackWindowHours: int().default(24), // 回滚窗口（小时）
  rollbackTriggerSpendDrop: decimal({ precision: 5, scale: 2 }).default('30.00'), // 花费下降多少触发回滚
  
  // 通知设置
  notifyOnExecution: tinyint().default(1),
  notifyOnRollback: tinyint().default(1),
  requireApproval: tinyint().default(0), // 是否需要人工审批
  
  // 执行调度
  executionSchedule: mysqlEnum(['hourly', 'daily', 'weekly']).default('daily'),
  executionHour: int().default(6), // 每日执行时间（小时）
  lastExecutionAt: timestamp({ mode: 'string' }),
  nextExecutionAt: timestamp({ mode: 'string' }),
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
  createdBy: int(),
});

// 投放词自动执行历史表
export const keywordAutoExecutionHistory = mysqlTable("keyword_auto_execution_history", {
  id: int().autoincrement().notNull().primaryKey(),
  configId: int().notNull(),
  accountId: int().notNull(),
  executionStartAt: timestamp({ mode: 'string' }).notNull(),
  executionEndAt: timestamp({ mode: 'string' }),
  executionType: mysqlEnum(['auto_pause', 'auto_enable', 'rollback', 'manual']).notNull(),
  status: mysqlEnum(['running', 'completed', 'failed', 'cancelled', 'pending_approval', 'rolled_back']).default('running').notNull(),
  
  // 统计
  totalKeywordsAnalyzed: int().default(0),
  keywordsPaused: int().default(0),
  keywordsEnabled: int().default(0),
  keywordsSkipped: int().default(0),
  keywordsError: int().default(0),
  
  // 影响指标
  estimatedSpendSaved: decimal({ precision: 12, scale: 2 }),
  estimatedSalesImpact: decimal({ precision: 12, scale: 2 }),
  
  executionSummary: text(), // JSON格式的执行摘要
  errorMessage: text(),
  
  // 审批
  approvedBy: int(),
  approvedAt: timestamp({ mode: 'string' }),
  
  // 回滚
  rollbackTriggeredAt: timestamp({ mode: 'string' }),
  rollbackReason: text(),
  rollbackBy: int(),
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 投放词自动执行明细表
export const keywordAutoExecutionDetails = mysqlTable("keyword_auto_execution_details", {
  id: int().autoincrement().notNull().primaryKey(),
  executionId: int().notNull(),
  keywordId: int().notNull(),
  keywordText: varchar({ length: 500 }),
  matchType: varchar({ length: 50 }),
  campaignId: int(),
  campaignName: varchar({ length: 500 }),
  adGroupId: int(),
  adGroupName: varchar({ length: 500 }),
  
  // 执行前状态
  statusBefore: mysqlEnum(['enabled', 'paused', 'archived']),
  bidBefore: decimal({ precision: 10, scale: 2 }),
  
  // 执行后状态
  statusAfter: mysqlEnum(['enabled', 'paused', 'archived']),
  bidAfter: decimal({ precision: 10, scale: 2 }),
  
  // 触发条件
  actionType: mysqlEnum(['pause', 'enable', 'rollback']).notNull(),
  triggerReason: text(), // 触发原因详情
  
  // 执行时的指标
  spend: decimal({ precision: 10, scale: 2 }),
  sales: decimal({ precision: 10, scale: 2 }),
  clicks: int(),
  impressions: int(),
  orders: int(),
  acos: decimal({ precision: 5, scale: 2 }),
  roas: decimal({ precision: 10, scale: 2 }),
  
  // 执行状态
  status: mysqlEnum(['applied', 'skipped', 'error', 'pending', 'rolled_back']).default('pending').notNull(),
  errorMessage: text(),
  
  // 回滚信息
  rolledBackAt: timestamp({ mode: 'string' }),
  rollbackReason: text(),
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 分时预算分配配置表
export const daypartingBudgetConfigs = mysqlTable("dayparting_budget_configs", {
  id: int().autoincrement().notNull().primaryKey(),
  accountId: int().notNull(),
  campaignId: int(),
  name: varchar({ length: 255 }).notNull(),
  description: text(),
  isEnabled: tinyint().default(1).notNull(),
  
  // 总预算设置
  totalDailyBudget: decimal({ precision: 10, scale: 2 }).notNull(),
  optimizationGoal: mysqlEnum(['maximize_sales', 'target_acos', 'target_roas', 'balanced']).default('balanced'),
  targetAcos: decimal({ precision: 5, scale: 2 }),
  targetRoas: decimal({ precision: 10, scale: 2 }),
  
  // 时段分配策略
  allocationStrategy: mysqlEnum(['performance_based', 'equal', 'custom']).default('performance_based'),
  
  // 安全设置
  minHourlyBudget: decimal({ precision: 10, scale: 2 }).default('1.00'),
  maxHourlyBudget: decimal({ precision: 10, scale: 2 }),
  reserveBudgetPercent: decimal({ precision: 5, scale: 2 }).default('10.00'), // 预留预算百分比
  
  // 自动调整
  autoAdjustEnabled: tinyint().default(1),
  adjustmentSensitivity: mysqlEnum(['low', 'medium', 'high']).default('medium'),
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
  createdBy: int(),
});

// 分时预算分配规则表
export const daypartingBudgetAllocations = mysqlTable("dayparting_budget_allocations", {
  id: int().autoincrement().notNull().primaryKey(),
  configId: int().notNull(),
  hour: int().notNull(), // 0-23
  dayOfWeek: int(), // 0-6, null表示所有天
  
  // 预算分配
  budgetPercent: decimal({ precision: 5, scale: 2 }).notNull(), // 该时段分配的预算百分比
  budgetAmount: decimal({ precision: 10, scale: 2 }), // 具体金额（可选）
  
  // 优先级
  priority: mysqlEnum(['low', 'normal', 'high', 'critical']).default('normal'),
  
  // 基于历史表现的调整
  historicalRoas: decimal({ precision: 10, scale: 2 }),
  historicalAcos: decimal({ precision: 5, scale: 2 }),
  historicalConversionRate: decimal({ precision: 5, scale: 2 }),
  
  isEnabled: tinyint().default(1).notNull(),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

// 分时预算执行日志表
export const daypartingBudgetLogs = mysqlTable("dayparting_budget_logs", {
  id: int().autoincrement().notNull().primaryKey(),
  configId: int().notNull(),
  campaignId: int(),
  executionTime: timestamp({ mode: 'string' }).notNull(),
  hour: int().notNull(),
  dayOfWeek: int().notNull(),
  
  // 预算变更
  budgetBefore: decimal({ precision: 10, scale: 2 }),
  budgetAfter: decimal({ precision: 10, scale: 2 }),
  budgetChange: decimal({ precision: 10, scale: 2 }),
  
  // 当时的表现指标
  currentSpend: decimal({ precision: 10, scale: 2 }),
  currentSales: decimal({ precision: 10, scale: 2 }),
  currentClicks: int(),
  currentImpressions: int(),
  currentAcos: decimal({ precision: 5, scale: 2 }),
  
  // 执行结果
  status: mysqlEnum(['success', 'failed', 'skipped']).default('success').notNull(),
  reason: text(),
  errorMessage: text(),
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export type KeywordAutoExecutionConfig = typeof keywordAutoExecutionConfigs.$inferSelect;
export type InsertKeywordAutoExecutionConfig = typeof keywordAutoExecutionConfigs.$inferInsert;
export type KeywordAutoExecutionHistory = typeof keywordAutoExecutionHistory.$inferSelect;
export type InsertKeywordAutoExecutionHistory = typeof keywordAutoExecutionHistory.$inferInsert;
export type KeywordAutoExecutionDetail = typeof keywordAutoExecutionDetails.$inferSelect;
export type InsertKeywordAutoExecutionDetail = typeof keywordAutoExecutionDetails.$inferInsert;
export type DaypartingBudgetConfig = typeof daypartingBudgetConfigs.$inferSelect;
export type InsertDaypartingBudgetConfig = typeof daypartingBudgetConfigs.$inferInsert;
export type DaypartingBudgetAllocation = typeof daypartingBudgetAllocations.$inferSelect;
export type InsertDaypartingBudgetAllocation = typeof daypartingBudgetAllocations.$inferInsert;
export type DaypartingBudgetLog = typeof daypartingBudgetLogs.$inferSelect;
export type InsertDaypartingBudgetLog = typeof daypartingBudgetLogs.$inferInsert;

// 季节性相关类型导出
export type SeasonalTrend = typeof seasonalTrends.$inferSelect;
export type InsertSeasonalTrend = typeof seasonalTrends.$inferInsert;
export type PromotionalEvent = typeof promotionalEvents.$inferSelect;
export type InsertPromotionalEvent = typeof promotionalEvents.$inferInsert;
export type SeasonalBudgetRecommendation = typeof seasonalBudgetRecommendations.$inferSelect;
export type InsertSeasonalBudgetRecommendation = typeof seasonalBudgetRecommendations.$inferInsert;


// ==================== API安全三件套 ====================

// API操作日志表 - 详细记录所有API调用
export const apiOperationLogs = mysqlTable("api_operation_logs", {
  id: int().autoincrement().notNull().primaryKey(),
  userId: int().notNull(),
  accountId: int(),
  
  // 操作信息
  operationType: mysqlEnum([
    'bid_adjustment',      // 出价调整
    'budget_change',       // 预算变更
    'campaign_status',     // 广告活动状态变更
    'keyword_status',      // 关键词状态变更
    'negative_keyword',    // 否定关键词操作
    'target_status',       // 商品定向状态变更
    'batch_operation',     // 批量操作
    'api_sync',            // API数据同步
    'auto_optimization',   // 自动优化执行
    'manual_operation',    // 手动操作
    'other'
  ]).notNull(),
  
  // 目标对象
  targetType: mysqlEnum(['campaign', 'ad_group', 'keyword', 'product_target', 'search_term', 'account', 'multiple']).notNull(),
  targetId: int(),
  targetName: varchar({ length: 500 }),
  
  // 操作详情
  actionDescription: text().notNull(),
  previousValue: text(),
  newValue: text(),
  changeAmount: decimal({ precision: 10, scale: 2 }),
  changePercent: decimal({ precision: 5, scale: 2 }),
  
  // 批量操作信息
  affectedCount: int().default(1),
  batchOperationId: int(),
  
  // 执行结果
  status: mysqlEnum(['success', 'failed', 'pending', 'rolled_back']).default('success').notNull(),
  errorMessage: text(),
  
  // 来源信息
  source: mysqlEnum(['manual', 'auto_optimization', 'scheduled_task', 'api_callback', 'batch_operation']).default('manual').notNull(),
  ipAddress: varchar({ length: 45 }),
  userAgent: text(),
  
  // 风险评估
  riskLevel: mysqlEnum(['low', 'medium', 'high', 'critical']).default('low').notNull(),
  requiresReview: tinyint().default(0),
  reviewedBy: int(),
  reviewedAt: timestamp({ mode: 'string' }),
  
  // 时间戳
  executedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 每日花费限额配置表
export const spendLimitConfigs = mysqlTable("spend_limit_configs", {
  id: int().autoincrement().notNull().primaryKey(),
  userId: int().notNull(),
  accountId: int().notNull(),
  
  // 限额设置
  dailySpendLimit: decimal({ precision: 12, scale: 2 }).notNull(),
  warningThreshold1: decimal({ precision: 5, scale: 2 }).default('50.00').notNull(), // 50%告警
  warningThreshold2: decimal({ precision: 5, scale: 2 }).default('80.00').notNull(), // 80%告警
  criticalThreshold: decimal({ precision: 5, scale: 2 }).default('95.00').notNull(), // 95%严重告警
  
  // 自动暂停设置
  autoStopEnabled: tinyint().default(0).notNull(),
  autoStopThreshold: decimal({ precision: 5, scale: 2 }).default('100.00'), // 达到100%时自动暂停
  
  // 通知设置
  notifyOnWarning1: tinyint().default(1).notNull(),
  notifyOnWarning2: tinyint().default(1).notNull(),
  notifyOnCritical: tinyint().default(1).notNull(),
  notifyOnAutoStop: tinyint().default(1).notNull(),
  
  // 状态
  isEnabled: tinyint().default(1).notNull(),
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

// 花费告警记录表
export const spendAlertLogs = mysqlTable("spend_alert_logs", {
  id: int().autoincrement().notNull().primaryKey(),
  configId: int().notNull(),
  userId: int().notNull(),
  accountId: int().notNull(),
  
  // 告警信息
  alertType: mysqlEnum(['warning_50', 'warning_80', 'critical_95', 'limit_reached', 'auto_stopped']).notNull(),
  alertLevel: mysqlEnum(['info', 'warning', 'critical']).notNull(),
  
  // 花费数据
  currentSpend: decimal({ precision: 12, scale: 2 }).notNull(),
  dailyLimit: decimal({ precision: 12, scale: 2 }).notNull(),
  spendPercent: decimal({ precision: 5, scale: 2 }).notNull(),
  
  // 通知状态
  notificationSent: tinyint().default(0).notNull(),
  notificationSentAt: timestamp({ mode: 'string' }),
  notificationError: text(),
  
  // 处理状态
  acknowledged: tinyint().default(0).notNull(),
  acknowledgedBy: int(),
  acknowledgedAt: timestamp({ mode: 'string' }),
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 异常检测规则表
export const anomalyDetectionRules = mysqlTable("anomaly_detection_rules", {
  id: int().autoincrement().notNull().primaryKey(),
  userId: int().notNull(),
  accountId: int(),
  
  // 规则信息
  ruleName: varchar({ length: 255 }).notNull(),
  ruleDescription: text(),
  ruleType: mysqlEnum([
    'bid_spike',           // 出价异常飙升
    'bid_drop',            // 出价异常下降
    'batch_size',          // 批量操作数量异常
    'frequency',           // 操作频率异常
    'budget_change',       // 预算变更异常
    'spend_velocity',      // 花费速度异常
    'conversion_drop',     // 转化率骤降
    'acos_spike',          // ACoS异常飙升
    'custom'               // 自定义规则
  ]).notNull(),
  
  // 检测条件
  conditionType: mysqlEnum(['threshold', 'percentage_change', 'absolute_change', 'rate_limit']).notNull(),
  conditionValue: decimal({ precision: 10, scale: 2 }).notNull(),
  conditionTimeWindow: int().default(60), // 时间窗口（分钟）
  
  // 触发动作
  actionOnTrigger: mysqlEnum(['alert_only', 'pause_and_alert', 'rollback_and_alert', 'block_operation']).default('alert_only').notNull(),
  
  // 通知设置
  notifyOwner: tinyint().default(1).notNull(),
  notifyTeam: tinyint().default(0).notNull(),
  
  // 状态
  isEnabled: tinyint().default(1).notNull(),
  priority: int().default(5), // 1-10，数字越大优先级越高
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

// 异常检测告警记录表
export const anomalyAlertLogs = mysqlTable("anomaly_alert_logs", {
  id: int().autoincrement().notNull().primaryKey(),
  ruleId: int().notNull(),
  userId: int().notNull(),
  accountId: int(),
  
  // 触发信息
  triggerValue: decimal({ precision: 10, scale: 2 }).notNull(),
  thresholdValue: decimal({ precision: 10, scale: 2 }).notNull(),
  triggerDescription: text().notNull(),
  
  // 关联操作
  relatedOperationId: int(),
  relatedOperationType: varchar({ length: 50 }),
  
  // 执行的动作
  actionTaken: mysqlEnum(['alert_sent', 'operation_paused', 'operation_rolled_back', 'operation_blocked']).notNull(),
  
  // 通知状态
  notificationSent: tinyint().default(0).notNull(),
  notificationSentAt: timestamp({ mode: 'string' }),
  
  // 处理状态
  status: mysqlEnum(['active', 'acknowledged', 'resolved', 'false_positive']).default('active').notNull(),
  resolvedBy: int(),
  resolvedAt: timestamp({ mode: 'string' }),
  resolutionNotes: text(),
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 自动暂停记录表
export const autoPauseRecords = mysqlTable("auto_pause_records", {
  id: int().autoincrement().notNull().primaryKey(),
  userId: int().notNull(),
  accountId: int().notNull(),
  
  // 暂停原因
  pauseReason: mysqlEnum([
    'spend_limit_reached',  // 花费限额达到
    'anomaly_detected',     // 异常检测触发
    'acos_threshold',       // ACoS超过阈值
    'manual_trigger',       // 手动触发
    'scheduled'             // 定时暂停
  ]).notNull(),
  
  // 关联信息
  relatedAlertId: int(),
  relatedRuleId: int(),
  
  // 暂停范围
  pauseScope: mysqlEnum(['account', 'campaign', 'ad_group', 'keyword', 'target']).notNull(),
  pausedEntityIds: text(), // JSON数组存储暂停的实体ID
  pausedEntityCount: int().default(1).notNull(),
  
  // 暂停前状态
  previousStates: text(), // JSON存储暂停前的状态
  
  // 通知状态
  notificationSent: tinyint().default(0).notNull(),
  notificationSentAt: timestamp({ mode: 'string' }),
  
  // 恢复信息
  isResumed: tinyint().default(0).notNull(),
  resumedBy: int(),
  resumedAt: timestamp({ mode: 'string' }),
  resumeReason: text(),
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// API安全三件套类型导出
export type ApiOperationLog = typeof apiOperationLogs.$inferSelect;
export type InsertApiOperationLog = typeof apiOperationLogs.$inferInsert;
export type SpendLimitConfig = typeof spendLimitConfigs.$inferSelect;
export type InsertSpendLimitConfig = typeof spendLimitConfigs.$inferInsert;
export type SpendAlertLog = typeof spendAlertLogs.$inferSelect;
export type InsertSpendAlertLog = typeof spendAlertLogs.$inferInsert;
export type AnomalyDetectionRule = typeof anomalyDetectionRules.$inferSelect;
export type InsertAnomalyDetectionRule = typeof anomalyDetectionRules.$inferInsert;
export type AnomalyAlertLog = typeof anomalyAlertLogs.$inferSelect;
export type InsertAnomalyAlertLog = typeof anomalyAlertLogs.$inferInsert;
export type AutoPauseRecord = typeof autoPauseRecords.$inferSelect;
export type InsertAutoPauseRecord = typeof autoPauseRecords.$inferInsert;


// 授权历史记录表
export const authorizationLogs = mysqlTable("authorization_logs", {
  id: int().autoincrement().notNull().primaryKey(),
  userId: int().notNull(),
  accountId: int().notNull(),
  
  // 授权类型
  authType: mysqlEnum(['oauth_code_exchange', 'manual_credentials', 'token_refresh']).notNull(),
  
  // 授权结果
  status: mysqlEnum(['success', 'failed', 'pending']).default('pending').notNull(),
  
  // 错误信息
  errorCode: varchar({ length: 100 }),
  errorMessage: text(),
  errorDetails: text(), // JSON格式的详细错误信息
  
  // 诊断信息
  diagnosticInfo: text(), // JSON格式的诊断信息
  suggestedFix: text(), // 建议的修复方案
  
  // 授权详情
  region: varchar({ length: 10 }), // NA, EU, FE
  profileId: varchar({ length: 64 }),
  profileCount: int(), // 检测到的Profile数量
  
  // 同步信息
  syncTriggered: tinyint().default(0),
  syncStatus: mysqlEnum(['not_started', 'in_progress', 'completed', 'failed']).default('not_started'),
  syncProgress: text(), // JSON格式的同步进度详情
  syncCampaigns: int().default(0),
  syncAdGroups: int().default(0),
  syncKeywords: int().default(0),
  syncTargets: int().default(0),
  syncPerformance: int().default(0),
  
  // 重试信息
  retryCount: int().default(0),
  lastRetryAt: timestamp({ mode: 'string' }),
  
  // IP和设备信息（用于安全审计）
  ipAddress: varchar({ length: 45 }),
  userAgent: text(),
  
  createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  completedAt: timestamp({ mode: 'string' }),
});

export type AuthorizationLog = typeof authorizationLogs.$inferSelect;
export type InsertAuthorizationLog = typeof authorizationLogs.$inferInsert;


// 同步变更记录表 - 记录每次同步的数据变化
export const syncChangeRecords = mysqlTable("sync_change_records", {
  id: int().autoincrement().notNull(),
  syncJobId: int('sync_job_id').notNull(),
  accountId: int('account_id').notNull(),
  userId: int('user_id').notNull(),
  entityType: mysqlEnum('entity_type', ['campaign', 'ad_group', 'keyword', 'product_target']).notNull(),
  changeType: mysqlEnum('change_type', ['created', 'updated', 'deleted']).notNull(),
  entityId: varchar('entity_id', { length: 64 }).notNull(),
  entityName: varchar('entity_name', { length: 500 }),
  previousData: json('previous_data'), // 变更前的数据快照
  newData: json('new_data'), // 变更后的数据快照
  changedFields: json('changed_fields'), // 变更的字段列表
  createdAt: timestamp('created_at', { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});
export type SyncChangeRecord = typeof syncChangeRecords.$inferSelect;
export type InsertSyncChangeRecord = typeof syncChangeRecords.$inferInsert;

// 同步冲突记录表 - 记录本地数据与API数据的冲突
export const syncConflicts = mysqlTable("sync_conflicts", {
  id: int().autoincrement().notNull(),
  syncJobId: int('sync_job_id').notNull(),
  accountId: int('account_id').notNull(),
  userId: int('user_id').notNull(),
  entityType: mysqlEnum('entity_type', ['campaign', 'ad_group', 'keyword', 'product_target']).notNull(),
  entityId: varchar('entity_id', { length: 64 }).notNull(),
  entityName: varchar('entity_name', { length: 500 }),
  conflictType: mysqlEnum('conflict_type', ['data_mismatch', 'missing_local', 'missing_remote', 'status_conflict']).notNull(),
  localData: json('local_data'), // 本地数据
  remoteData: json('remote_data'), // API返回的数据
  conflictFields: json('conflict_fields'), // 冲突的字段列表
  suggestedResolution: mysqlEnum('suggested_resolution', ['use_local', 'use_remote', 'merge', 'manual']).default('use_remote'),
  resolutionStatus: mysqlEnum('resolution_status', ['pending', 'resolved', 'ignored']).default('pending'),
  resolvedAt: timestamp('resolved_at', { mode: 'string' }),
  resolvedBy: int('resolved_by'),
  resolutionNotes: text('resolution_notes'),
  createdAt: timestamp('created_at', { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});
export type SyncConflict = typeof syncConflicts.$inferSelect;
export type InsertSyncConflict = typeof syncConflicts.$inferInsert;

// 同步任务队列表 - 管理多账号同步任务
export const syncTaskQueue = mysqlTable("sync_task_queue", {
  id: int().autoincrement().notNull(),
  userId: int('user_id').notNull(),
  accountId: int('account_id').notNull(),
  accountName: varchar('account_name', { length: 255 }),
  syncType: mysqlEnum('sync_type', ['campaigns', 'ad_groups', 'keywords', 'product_targets', 'performance', 'full']).default('full'),
  priority: int().default(0), // 优先级，数字越大优先级越高
  status: mysqlEnum(['queued', 'running', 'completed', 'failed', 'cancelled']).default('queued'),
  progress: int().default(0), // 0-100的进度百分比
  currentStep: varchar('current_step', { length: 100 }), // 当前执行的步骤
  totalSteps: int('total_steps').default(6), // 总步骤数
  completedSteps: int('completed_steps').default(0), // 已完成步骤数
  estimatedTimeMs: int('estimated_time_ms'), // 预计剩余时间（毫秒）
  startedAt: timestamp('started_at', { mode: 'string' }),
  completedAt: timestamp('completed_at', { mode: 'string' }),
  errorMessage: text('error_message'),
  resultSummary: json('result_summary'), // 同步结果摘要
  createdAt: timestamp('created_at', { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});
export type SyncTaskQueue = typeof syncTaskQueue.$inferSelect;
export type InsertSyncTaskQueue = typeof syncTaskQueue.$inferInsert;

// 同步变更摘要表 - 汇总每次同步的变更统计
export const syncChangeSummary = mysqlTable("sync_change_summary", {
  id: int().autoincrement().notNull(),
  syncJobId: int('sync_job_id').notNull(),
  accountId: int('account_id').notNull(),
  userId: int('user_id').notNull(),
  // 广告活动变更统计
  campaignsCreated: int('campaigns_created').default(0),
  campaignsUpdated: int('campaigns_updated').default(0),
  campaignsDeleted: int('campaigns_deleted').default(0),
  // 广告组变更统计
  adGroupsCreated: int('ad_groups_created').default(0),
  adGroupsUpdated: int('ad_groups_updated').default(0),
  adGroupsDeleted: int('ad_groups_deleted').default(0),
  // 关键词变更统计
  keywordsCreated: int('keywords_created').default(0),
  keywordsUpdated: int('keywords_updated').default(0),
  keywordsDeleted: int('keywords_deleted').default(0),
  // 商品定位变更统计
  targetsCreated: int('targets_created').default(0),
  targetsUpdated: int('targets_updated').default(0),
  targetsDeleted: int('targets_deleted').default(0),
  // 冲突统计
  conflictsDetected: int('conflicts_detected').default(0),
  conflictsResolved: int('conflicts_resolved').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});
export type SyncChangeSummary = typeof syncChangeSummary.$inferSelect;
export type InsertSyncChangeSummary = typeof syncChangeSummary.$inferInsert;


// 自动广告匹配类型配置表
export const autoTargetingSettings = mysqlTable("auto_targeting_settings", {
	id: int().autoincrement().notNull(),
	campaignId: int().notNull(),
	adGroupId: int(),
	// 四种匹配类型的启用状态和竞价
	closeMatchEnabled: tinyint().default(1),
	closeMatchBid: decimal({ precision: 10, scale: 2 }),
	closeMatchBidMultiplier: decimal({ precision: 5, scale: 2 }).default('1.00'),
	looseMatchEnabled: tinyint().default(1),
	looseMatchBid: decimal({ precision: 10, scale: 2 }),
	looseMatchBidMultiplier: decimal({ precision: 5, scale: 2 }).default('1.00'),
	substitutesEnabled: tinyint().default(1),
	substitutesBid: decimal({ precision: 10, scale: 2 }),
	substitutesBidMultiplier: decimal({ precision: 5, scale: 2 }).default('1.00'),
	complementsEnabled: tinyint().default(1),
	complementsBid: decimal({ precision: 10, scale: 2 }),
	complementsBidMultiplier: decimal({ precision: 5, scale: 2 }).default('1.00'),
	// 自动优化设置
	autoOptimizeEnabled: tinyint().default(0),
	optimizationStrategy: mysqlEnum(['maximize_sales','target_acos','target_roas','minimize_acos']).default('target_acos'),
	targetAcos: decimal({ precision: 5, scale: 2 }),
	targetRoas: decimal({ precision: 10, scale: 2 }),
	minBid: decimal({ precision: 10, scale: 2 }).default('0.10'),
	maxBid: decimal({ precision: 10, scale: 2 }).default('10.00'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

// 自动广告匹配类型绩效数据表
export const autoTargetingPerformance = mysqlTable("auto_targeting_performance", {
	id: int().autoincrement().notNull(),
	campaignId: int().notNull(),
	adGroupId: int(),
	matchType: mysqlEnum(['close_match','loose_match','substitutes','complements']).notNull(),
	reportDate: timestamp({ mode: 'string' }).notNull(),
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
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 竞价位置优化设置表
export const placementBidSettings = mysqlTable("placement_bid_settings", {
	id: int().autoincrement().notNull(),
	campaignId: int().notNull(),
	// 三种位置的竞价调整百分比（0-900%）
	topOfSearchAdjustment: int().default(0),
	productPagesAdjustment: int().default(0),
	restOfSearchAdjustment: int().default(0),
	// 自动优化设置
	autoOptimizeEnabled: tinyint().default(0),
	optimizationStrategy: mysqlEnum(['maximize_visibility','maximize_conversions','target_acos','balanced']).default('balanced'),
	targetAcos: decimal({ precision: 5, scale: 2 }),
	maxAdjustment: int().default(300),
	// 动态竞价策略
	biddingStrategy: mysqlEnum(['fixed','down_only','up_and_down']).default('down_only'),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

// 分时竞价规则表
export const daypartingBidRules = mysqlTable("dayparting_bid_rules", {
	id: int().autoincrement().notNull(),
	campaignId: int().notNull(),
	ruleName: varchar({ length: 255 }).notNull(),
	ruleDescription: text(),
	ruleEnabled: tinyint().default(1),
	// 时间设置
	dayOfWeek: json(), // [0,1,2,3,4,5,6] 0=周日
	startHour: int().notNull(), // 0-23
	endHour: int().notNull(), // 0-23
	timezone: varchar({ length: 64 }).default('America/Los_Angeles'),
	// 竞价调整
	bidAdjustmentType: mysqlEnum(['percentage','fixed']).default('percentage'),
	bidAdjustmentValue: decimal({ precision: 10, scale: 2 }).notNull(),
	// 预算调整
	budgetAdjustmentEnabled: tinyint().default(0),
	budgetAdjustmentType: mysqlEnum(['percentage','fixed']).default('percentage'),
	budgetAdjustmentValue: decimal({ precision: 10, scale: 2 }),
	// 优先级（数字越大优先级越高）
	priority: int().default(0),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

// 自动广告优化建议表
export const autoTargetingOptimizationSuggestions = mysqlTable("auto_targeting_optimization_suggestions", {
	id: int().autoincrement().notNull(),
	campaignId: int().notNull(),
	adGroupId: int(),
	matchType: mysqlEnum(['close_match','loose_match','substitutes','complements']).notNull(),
	suggestionType: mysqlEnum(['increase_bid','decrease_bid','pause','enable','adjust_multiplier']).notNull(),
	currentValue: decimal({ precision: 10, scale: 2 }),
	suggestedValue: decimal({ precision: 10, scale: 2 }),
	changePercent: decimal({ precision: 5, scale: 2 }),
	reason: text(),
	confidenceScore: decimal({ precision: 3, scale: 2 }),
	expectedImpact: text(),
	performanceData: json(),
	suggestionStatus: mysqlEnum(['pending','approved','applied','dismissed']).default('pending'),
	appliedAt: timestamp({ mode: 'string' }),
	appliedBy: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// 位置竞价优化建议表
export const placementOptimizationSuggestions = mysqlTable("placement_optimization_suggestions", {
	id: int().autoincrement().notNull(),
	campaignId: int().notNull(),
	placement: mysqlEnum(['top_of_search','product_pages','rest_of_search']).notNull(),
	suggestionType: mysqlEnum(['increase_adjustment','decrease_adjustment','set_adjustment']).notNull(),
	currentAdjustment: int(),
	suggestedAdjustment: int(),
	reason: text(),
	confidenceScore: decimal({ precision: 3, scale: 2 }),
	expectedImpact: text(),
	performanceData: json(),
	suggestionStatus: mysqlEnum(['pending','approved','applied','dismissed']).default('pending'),
	appliedAt: timestamp({ mode: 'string' }),
	appliedBy: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});
