/**
 * v361: db.ts 代理层
 * 
 * 所有函数实现已按业务领域拆分到 server/db/ 子模块中。
 * 此文件保留为兼容层，re-export所有子模块的函数，
 * 确保现有的 import { xxx } from './db' 不需要修改。
 * 
 * 新代码建议直接从子模块导入：
 * import { getDb } from './db/connection'
 * import { getCampaignById } from './db/campaigns'
 * 
 * 子模块列表：
 *   - db/connection: 数据库连接管理
 *   - db/users: 用户管理
 *   - db/accounts: 账户与绩效组管理
 *   - db/campaigns: 广告活动管理
 *   - db/adGroups: 广告组管理
 *   - db/keywords: 关键词管理
 *   - db/productTargets: 商品投放管理
 *   - db/biddingLogs: 竞价日志管理
 *   - db/performance: 绩效数据管理
 *   - db/importJobs: 导入任务管理
 *   - db/bulkOperations: 批量操作
 *   - db/credentials: API凭证管理
 *   - db/searchTerms: 搜索词与否定词管理
 *   - db/notifications: 通知管理
 *   - db/scheduledTasks: 定时任务管理
 *   - db/batchOps: 批量操作审批
 *   - db/corrections: 归因纠错管理
 *   - db/team: 团队与权限管理
 *   - db/emailSubscriptions: 邮件订阅管理
 *   - db/campaignDetail: 广告活动详情
 *   - db/aiOptimization: AI优化执行管理
 *   - db/bidAdjustment: 竞价调整历史
 *   - db/syncJobs: 数据同步任务管理
 *   - db/analytics: 分析与统计
 *   - db/optimizationEvents: 优化事件管理
 *   - db/goalProgress: 目标进度分析
 */

export * from './db/connection';
export * from './db/users';
export * from './db/accounts';
export * from './db/campaigns';
export * from './db/adGroups';
export * from './db/keywords';
export * from './db/productTargets';
export * from './db/biddingLogs';
export * from './db/performance';
export * from './db/importJobs';
export * from './db/bulkOperations';
export * from './db/credentials';
export * from './db/searchTerms';
export * from './db/notifications';
export * from './db/scheduledTasks';
export * from './db/batchOps';
export * from './db/corrections';
export * from './db/team';
export * from './db/emailSubscriptions';
export * from './db/campaignDetail';
export * from './db/aiOptimization';
export * from './db/bidAdjustment';
export * from './db/syncJobs';
export * from './db/analytics';
export * from './db/optimizationEvents';
export * from './db/goalProgress';
export * from './db/sdAudiences';
