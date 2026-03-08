-- v358: 引入sync_shards任务分片表
-- 实现持久化任务状态机，支持断点续传和失败重试

-- 同步任务主表（每次syncAll调用创建一条记录）
CREATE TABLE IF NOT EXISTS sync_tasks_v2 (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- 任务标识
  task_id VARCHAR(64) NOT NULL COMMENT '全局唯一任务ID (UUID)',
  tier ENUM('high', 'medium', 'full', 'confirmation') NOT NULL COMMENT '同步层级',
  
  -- 任务状态
  status ENUM('pending', 'running', 'partial_success', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  
  -- 进度追踪
  total_shards INT NOT NULL DEFAULT 0 COMMENT '总分片数',
  completed_shards INT NOT NULL DEFAULT 0 COMMENT '已完成分片数',
  failed_shards INT NOT NULL DEFAULT 0 COMMENT '失败分片数',
  total_records_synced INT NOT NULL DEFAULT 0 COMMENT '总同步记录数',
  
  -- 时间追踪
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- 元数据
  trigger_source VARCHAR(50) COMMENT '触发来源: scheduler/manual/cold_start/retry',
  error_summary TEXT COMMENT '错误摘要',
  
  -- 索引
  UNIQUE KEY uk_task_id (task_id),
  INDEX idx_status (status),
  INDEX idx_tier_status (tier, status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 同步分片表（每个account+step组合是一个分片）
CREATE TABLE IF NOT EXISTS sync_shards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- 关联任务
  task_id VARCHAR(64) NOT NULL COMMENT '关联的sync_tasks_v2.task_id',
  shard_id VARCHAR(128) NOT NULL COMMENT '分片唯一标识: {task_id}:{account_id}:{step_id}',
  
  -- 分片标识
  account_id INT NOT NULL COMMENT '账户ID',
  step_id VARCHAR(50) NOT NULL COMMENT '同步步骤ID (如sp_campaigns, performance_90d)',
  step_name VARCHAR(100) NOT NULL COMMENT '步骤名称',
  tier ENUM('high', 'medium', 'full') NOT NULL COMMENT '步骤所属层级',
  
  -- 分片状态（状态机）
  -- pending -> running -> completed/failed
  -- failed -> running (重试)
  status ENUM('pending', 'running', 'completed', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
  
  -- 执行结果
  records_synced INT NOT NULL DEFAULT 0 COMMENT '同步记录数',
  error_message TEXT COMMENT '错误信息',
  error_code VARCHAR(50) COMMENT '错误码: DATABASE_UNAVAILABLE, PARTIAL_SYNC_FAILURE, API_TIMEOUT等',
  
  -- 重试机制
  retry_count INT NOT NULL DEFAULT 0 COMMENT '已重试次数',
  max_retries INT NOT NULL DEFAULT 3 COMMENT '最大重试次数',
  next_retry_at TIMESTAMP NULL COMMENT '下次重试时间（指数退避）',
  
  -- 时间追踪
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  duration_ms INT COMMENT '执行耗时(毫秒)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- 索引
  UNIQUE KEY uk_shard_id (shard_id),
  INDEX idx_task_id (task_id),
  INDEX idx_account_step (account_id, step_id),
  INDEX idx_status (status),
  INDEX idx_status_retry (status, next_retry_at),
  INDEX idx_task_status (task_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 分布式锁表（替代内存锁）
CREATE TABLE IF NOT EXISTS sync_locks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lock_key VARCHAR(128) NOT NULL COMMENT '锁标识: sync:{account_id}:{tier}',
  holder_id VARCHAR(64) NOT NULL COMMENT '持有者ID (进程/实例标识)',
  acquired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL COMMENT '锁过期时间（防止死锁）',
  
  UNIQUE KEY uk_lock_key (lock_key),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
