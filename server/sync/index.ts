/**
 * Amazon Sync Service 子模块索引
 * 统一导出所有同步子模块
 */
export type { SyncContext } from './campaignSync';
export { syncSbCampaigns, syncSdCampaigns, syncSpCampaigns, syncCampaignsOnly } from './campaignSync';
export { syncSpAdGroups, syncSbAdGroups, syncSdAdGroups, syncAdGroupsAndTargeting, syncAdGroupPerformanceData } from './adGroupSync';
export { syncSbKeywords, syncSpKeywords, syncKeywordPerformanceData } from './keywordSync';
export { syncSbProductTargets, syncSdProductTargets, syncSpNegativeProductTargets, syncSpProductTargets, syncProductTargetPerformanceData } from './productTargetSync';
export { syncSpNegativeKeywords, syncSbNegativeKeywords, syncSbNegativeTargets } from './negativeKeywordSync';
export { syncSbSearchTerms, syncSearchTerms } from './searchTermSync';
export { syncPerformanceData, generateMockPerformanceData, generateHourlyFromDaily, syncPlacementPerformance, updateCampaignPerformanceSummary, syncPerformanceOnly, syncSbPlacementPerformance } from './performanceSync';
export { applyBidAdjustment, applyBatchBidAdjustments } from './bidOperations';
export { syncAutoTargeting, syncSdTargeting, syncSbTargeting } from './targetingSync';
export { syncSbAds, syncAssetUrls } from './sbAdsSync';

// v417: 从 services/sync/ 整合的模块
export { runAutoBidOptimization } from './autoBidOptimization';
export {
  SYNC_PROTECTION_CONFIG,
  hasRecentSyncedOptimization,
  getRecentlyOptimizedKeywordIds,
  getRecentlyOptimizedCampaignIds,
  detectConflict,
} from './syncHelpers';

// v417: 从 services/ 整合的调度模块
export { asyncReportService } from './scheduling/asyncReportService';
export { tieredSyncService } from './scheduling/tieredSyncService';
export { smartSyncService } from './scheduling/smartSyncService';
