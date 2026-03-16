/**
 * v361: db模块统一入口 - 代理层
 * 
 * 所有函数实现已按业务领域拆分到子模块中。
 * 此文件作为兼容层，re-export所有子模块的函数，
 * 确保现有的 import { xxx } from '.' 不需要修改。
 * 
 * 新代码建议直接从子模块导入：
 * import { getDb } from './connection'
 * import { getCampaignById } from './campaigns'
 */

export * from './connection';
export * from './users';
export * from './accounts';
export * from './campaigns';
export * from './adGroups';
export * from './keywords';
export * from './productTargets';
export * from './biddingLogs';
export * from './performance';
export * from './importJobs';
export * from './bulkOperations';
export * from './credentials';
export * from './searchTerms';
export * from './notifications';
export * from './scheduledTasks';
export * from './batchOps';
export * from './corrections';
export * from './team';
export * from './emailSubscriptions';
export * from './campaignDetail';
export * from './aiOptimization';
export * from './bidAdjustment';
export * from './syncJobs';
export * from './analytics';
export * from './optimizationEvents';
export * from './goalProgress';
