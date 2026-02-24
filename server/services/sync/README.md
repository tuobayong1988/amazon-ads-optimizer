# amazonSyncService.ts 拆分计划

## 原始文件: 6,506 行

## 拆分模块:

### 1. syncCampaigns.ts (~800行)
- syncSpCampaigns
- syncSbCampaigns
- syncSdCampaigns
- syncCampaignsOnly

### 2. syncAdGroups.ts (~500行)
- syncSpAdGroups
- syncSbAdGroups
- syncSdAdGroups
- syncAdGroupsAndTargeting

### 3. syncKeywords.ts (~600行)
- syncSpKeywords
- syncSbKeywords
- syncSpNegativeKeywords
- syncSbNegativeKeywords

### 4. syncTargets.ts (~600行)
- syncSpProductTargets
- syncSbProductTargets
- syncSdProductTargets
- syncSpNegativeProductTargets
- syncSbNegativeTargets

### 5. syncPerformance.ts (~1200行)
- syncPerformanceData
- syncKeywordPerformanceData
- syncProductTargetPerformanceData
- syncAdGroupPerformanceData
- syncPlacementPerformance
- syncSbPlacementPerformance
- updateCampaignPerformanceSummary
- syncPerformanceOnly
- generateMockPerformanceData
- generateHourlyFromDaily

### 6. syncSearchTerms.ts (~400行)
- syncSearchTerms
- syncSbSearchTerms
- syncAutoTargeting
- syncSdTargeting
- syncSbTargeting

### 7. syncBidOperations.ts (~300行)
- applyBidAdjustment
- applyBatchBidAdjustments

### 8. syncMisc.ts (~300行)
- syncSbAds
- syncSbNegativeTargets
- syncAssetUrls
- syncAllAdData

### 9. index.ts (主文件 ~300行)
- AmazonSyncService 类定义
- 构造函数和 createFromCredentials
- syncAll 方法（委托给各子模块）
- 辅助函数和类型定义

### 10. autoBidOptimization.ts (~1200行)
- runAutoBidOptimization（独立函数）
- syncInitialHistoricalData（独立函数）
