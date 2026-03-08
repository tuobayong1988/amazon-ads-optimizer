/**
 * v359: 数据库模块索引
 * 
 * 将原始的db.ts(6338行)按领域拆分为子模块，通过此索引文件re-export
 * 保持向后兼容：所有从 '../db' 或 './db' 的导入仍然有效
 * 
 * 领域划分：
 * - connection: 数据库连接和池管理
 * - users: 用户相关操作
 * - accounts: 广告账户管理
 * - campaigns: 广告活动CRUD
 * - adGroups: 广告组操作
 * - keywords: 关键词操作
 * - targets: 投放目标操作
 * - performance: 绩效数据
 * - sync: 同步任务和日志
 * - optimization: 优化事件和日志
 * - bidding: 出价调整记录
 * - team: 团队和权限管理
 * - notifications: 通知和邮件
 * - searchTerms: 搜索词分析
 * - ai: AI优化执行记录
 * - batch: 批量操作
 * - migration: 数据迁移
 * 
 * 新代码应直接从子模块导入，例如：
 * import { getCampaignById } from './db/campaigns';
 * 
 * 旧代码可继续从此索引导入：
 * import { getCampaignById } from './db';
 */

// 所有导出都来自原始db.ts，保持完全兼容
export * from '../db';

// v360: 子模块代理re-export（新代码应直接从子模块导入）
// 示例: import { getDb } from './db/connection';
// 示例: import { getCampaignById } from './db/campaigns';
export * from './connection';
export * from './accounts';
export * from './campaigns';
export * from './performance';
