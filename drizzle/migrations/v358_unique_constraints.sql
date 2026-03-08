-- v358: 修复数据库设计缺陷 - 添加唯一约束防止数据累积
-- 
-- 问题: daily_performance表缺少唯一约束，导致同一天同一campaign的数据可能被重复插入
-- 解决: 添加(account_id, campaign_id, date, ad_type)唯一索引
--
-- 执行前注意:
-- 1. 先执行去重操作（保留最新记录）
-- 2. 然后添加唯一约束
-- 3. 建议在低峰期执行

-- Step 1: 去重（保留每组中id最大的记录）
-- 注意：此操作可能需要较长时间，取决于数据量
DELETE dp1 FROM daily_performance dp1
INNER JOIN daily_performance dp2
ON dp1.account_id = dp2.account_id
AND dp1.campaign_id = dp2.campaign_id
AND DATE(dp1.date) = DATE(dp2.date)
AND COALESCE(dp1.ad_type, '') = COALESCE(dp2.ad_type, '')
AND dp1.id < dp2.id;

-- Step 2: 添加唯一约束
-- 使用 ad_type 区分 SP/SB/SD 的同一campaign同一天的数据
ALTER TABLE daily_performance 
ADD UNIQUE INDEX uq_daily_perf_account_campaign_date_type (account_id, campaign_id, date, ad_type);

-- Step 3: 为placement_performance添加唯一约束
-- 防止同一campaign同一天同一placement的数据重复
ALTER TABLE placement_performance
ADD UNIQUE INDEX uq_placement_perf_account_campaign_date_placement (account_id, campaign_id, date, placement);

-- Step 4: 为sync_tasks_v2添加索引优化查询性能
CREATE INDEX idx_sync_tasks_status ON sync_tasks_v2(status, tier);
CREATE INDEX idx_sync_tasks_created ON sync_tasks_v2(created_at);

-- Step 5: 为sync_shards添加索引优化查询性能
CREATE INDEX idx_sync_shards_task ON sync_shards(task_id, status);
CREATE INDEX idx_sync_shards_account ON sync_shards(account_id, status);
CREATE INDEX idx_sync_shards_retry ON sync_shards(status, next_retry_at);
