/**
 * v361: 算法常量集中管理
 * 
 * 所有优化算法中使用的阈值、系数和配置参数的集中定义。
 * 每个常量都附带业务背景说明，便于理解和调整。
 * 
 * 使用方式：
 * import { BID_CONSTANTS, PERFORMANCE_THRESHOLDS } from './algorithmConstants';
 */

// ==================== 竞价算法常量 ====================

export const BID_CONSTANTS = {
  /** 默认CPC最高出价限制 ($) */
  DEFAULT_MAX_BID: 2.00,
  
  /** 默认最低出价限制 ($) */
  DEFAULT_MIN_BID: 0.02,
  
  /** 单次出价调整最大变动百分比 (25%) - 防止剧烈波动 */
  MAX_CHANGE_PERCENT: 0.25,
  
  /** 探索上限绝对值 ($) */
  EXPLORATION_CEILING: 3.00,
  
  /** CPC到出价的估算系数 */
  CPC_BID_RATIO: 0.7,
  
  /** 稀疏数据默认调整幅度 (20%) */
  SPARSE_DATA_CHANGE_PERCENT: 0.20,
  
  /** 高置信度稀疏数据调整幅度 (30%) */
  HIGH_CONFIDENCE_SPARSE_CHANGE_PERCENT: 0.30,
  
  /** 探测模式提价百分比 (10%) */
  PROBING_INCREMENT_PERCENT: 0.10,
  
  /** 探测模式提价固定金额 ($) */
  PROBING_INCREMENT_FIXED: 0.05,
  
  /** 探索模式最大提价百分比 (15%) */
  EXPLORATION_MAX_PERCENT: 0.15,
  
  /** 降价保底系数 - 不低于当前出价的此比例 */
  DECREASE_FLOOR_RATIO: 0.80,
  
  /** 温和降价系数 (5%) */
  MILD_DECREASE_RATIO: 0.95,
  
  /** 标准降价系数 (10%) */
  STANDARD_DECREASE_RATIO: 0.90,
} as const;

// ==================== 性能指标阈值 ====================

export const PERFORMANCE_THRESHOLDS = {
  /** 默认组平均CVR (5%) - 无数据时的回退值 */
  DEFAULT_GROUP_CVR: 0.05,
  
  /** 默认组平均AOV ($30) */
  DEFAULT_GROUP_AOV: 30,
  
  /** 默认组平均CPC ($0.75) */
  DEFAULT_GROUP_CPC: 0.75,
  
  /** ACOS健康阈值 - 低于此值认为表现良好 */
  ACOS_HEALTHY: 0.30,
  
  /** ACOS警告阈值 - 高于此值需要关注 */
  ACOS_WARNING: 0.50,
  
  /** ACOS危险阈值 - 高于此值需要立即干预 */
  ACOS_CRITICAL: 0.80,
  
  /** 最低曝光量阈值 - 低于此值认为数据不足 */
  MIN_IMPRESSIONS_FOR_DECISION: 100,
  
  /** 最低点击量阈值 - 低于此值认为数据稀疏 */
  MIN_CLICKS_FOR_DECISION: 10,
  
  /** 统计显著性最低样本量 */
  MIN_SAMPLE_SIZE: 30,
} as const;

// ==================== 同步与调度常量 ====================

export const SYNC_CONSTANTS = {
  /** API速率限制 - 每秒最大请求数 */
  MAX_REQUESTS_PER_SECOND: 10,
  
  /** API速率限制 - 每分钟最大请求数 */
  MAX_REQUESTS_PER_MINUTE: 100,
  
  /** 同步重试最大次数 */
  MAX_RETRY_COUNT: 3,
  
  /** 重试间隔基数 (ms) - 指数退避 */
  RETRY_BASE_DELAY_MS: 1000,
  
  /** 同步超时时间 (ms) */
  SYNC_TIMEOUT_MS: 300000, // 5分钟
  
  /** 批量操作大小 */
  BATCH_SIZE: 500,
  
  /** 并发同步账户数 */
  MAX_CONCURRENT_ACCOUNTS: 3,
} as const;

// ==================== 预算分配常量 ====================

export const BUDGET_CONSTANTS = {
  /** 最小日预算 ($) */
  MIN_DAILY_BUDGET: 1.00,
  
  /** 预算调整最大变动百分比 (30%) */
  MAX_BUDGET_CHANGE_PERCENT: 0.30,
  
  /** 预算利用率警告阈值 (90%) */
  UTILIZATION_WARNING: 0.90,
  
  /** 预算利用率低效阈值 (50%) */
  UTILIZATION_LOW: 0.50,
  
  /** 预算池分配 - 核心广告活动占比 */
  CORE_CAMPAIGN_RATIO: 0.60,
  
  /** 预算池分配 - 增长广告活动占比 */
  GROWTH_CAMPAIGN_RATIO: 0.25,
  
  /** 预算池分配 - 探索广告活动占比 */
  EXPLORATION_CAMPAIGN_RATIO: 0.15,
} as const;

// ==================== 系统配置常量 ====================

export const SYSTEM_CONSTANTS = {
  /** 数据库连接池最大连接数 */
  DB_POOL_MAX: 20,
  
  /** 数据库连接池最小连接数 */
  DB_POOL_MIN: 5,
  
  /** 数据库查询超时 (ms) */
  DB_QUERY_TIMEOUT_MS: 30000,
  
  /** 日志保留天数 */
  LOG_RETENTION_DAYS: 30,
  
  /** 审计日志保留天数 */
  AUDIT_LOG_RETENTION_DAYS: 90,
  
  /** 性能数据保留天数 */
  PERFORMANCE_DATA_RETENTION_DAYS: 365,
  
  /** 内存环形缓冲区大小 */
  LOG_BUFFER_SIZE: 5000,
} as const;
