-- v360: 为daily_performance表添加唯一约束，防止数据重复累积
-- 执行前需要先清理已有的重复数据

-- Step 1: 清理重复数据（保留id最大的记录）
DELETE dp1 FROM daily_performance dp1
INNER JOIN daily_performance dp2
WHERE dp1.id < dp2.id
  AND dp1.accountId = dp2.accountId
  AND dp1.campaignId = dp2.campaignId
  AND DATE(dp1.date) = DATE(dp2.date)
  AND COALESCE(dp1.ad_type, '') = COALESCE(dp2.ad_type, '');

-- Step 2: 添加唯一约束
ALTER TABLE daily_performance
ADD UNIQUE INDEX uk_daily_perf (accountId, campaignId, date, ad_type);

-- Step 3: 添加查询优化索引
ALTER TABLE daily_performance
ADD INDEX idx_daily_perf_account_date (accountId, date),
ADD INDEX idx_daily_perf_campaign_date (campaignId, date);
