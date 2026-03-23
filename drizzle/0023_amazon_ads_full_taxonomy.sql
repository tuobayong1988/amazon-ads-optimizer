-- v500: Amazon广告完整分类体系支持
-- 补充所有缺失的枚举值、字段和表结构，确保系统能同步每个广告类型的所有数据
-- ============================================================

-- ============================================================
-- Phase 1: campaigns表 - 补充缺失的枚举值和字段
-- ============================================================

-- Step 1: campaignGoal枚举 - 增加 RESERVE_SHARE_OF_VOICE（SB Reserve SOV目标）
ALTER TABLE `campaigns` 
  MODIFY COLUMN `campaign_goal` ENUM('DRIVE_PAGE_VISITS','GROW_BRAND_IMPRESSION_SHARE','PROMOTE_PRODUCTS','RESERVE_SHARE_OF_VOICE') DEFAULT NULL;

-- Step 2: bidOptimization枚举 - 增加 leads（SD Leads优化目标）
ALTER TABLE `campaigns` 
  MODIFY COLUMN `bid_optimization` ENUM('reach','pageVisits','conversions','leads') DEFAULT NULL;

-- Step 3: 新增SB广告受众竞价调整字段（Audience Bid Adjustments）
-- 使用正确的列名 placementRestBidAdjustment（驼峰命名）
ALTER TABLE `campaigns` 
  ADD COLUMN `sb_audience_bid_adjustment` INT DEFAULT 0 COMMENT 'SB受众竞价调整百分比(0-900)' AFTER `placementRestBidAdjustment`,
  ADD COLUMN `sb_placement_top_multiplier` DECIMAL(5,2) DEFAULT NULL COMMENT 'SB Top of Search版位竞价乘数' AFTER `sb_audience_bid_adjustment`,
  ADD COLUMN `sb_placement_product_multiplier` DECIMAL(5,2) DEFAULT NULL COMMENT 'SB Product Page版位竞价乘数' AFTER `sb_placement_top_multiplier`,
  ADD COLUMN `sb_placement_rest_multiplier` DECIMAL(5,2) DEFAULT NULL COMMENT 'SB Rest of Search版位竞价乘数' AFTER `sb_placement_product_multiplier`;

-- Step 4: 新增SD广告优化策略字段
ALTER TABLE `campaigns` 
  ADD COLUMN `sd_optimization_strategy` VARCHAR(50) DEFAULT NULL COMMENT 'SD优化策略: reach/page_visits/drive_page_visits/conversions/leads' AFTER `sb_placement_rest_multiplier`;

-- Step 5: 新增SB Reserve SOV特有字段
ALTER TABLE `campaigns` 
  ADD COLUMN `sb_reserve_sov_budget` DECIMAL(15,2) DEFAULT NULL COMMENT 'Reserve SOV固定预算(非竞价模式)' AFTER `sd_optimization_strategy`,
  ADD COLUMN `sb_campaign_duration_days` INT DEFAULT NULL COMMENT 'Reserve SOV活动持续天数(30-92)' AFTER `sb_reserve_sov_budget`;

-- ============================================================
-- Phase 2: sdCampaignSettings表 - 补充缺失的枚举值
-- ============================================================

-- Step 6: optimizationGoal枚举 - 增加 leads
ALTER TABLE `sd_campaign_settings` 
  MODIFY COLUMN `optimization_goal` ENUM('reach','page_visits','conversions','leads') DEFAULT 'conversions';

-- ============================================================
-- Phase 3: sdAudiences表 - 补充缺失的受众类型枚举值
-- ============================================================

-- Step 7: audienceType枚举 - 增加 similarProducts 和 lookback 受众类型
ALTER TABLE `sd_audiences` 
  MODIFY COLUMN `audience_type` ENUM('views','purchases','inMarket','lifestyle','custom','similarProducts','lookback') NOT NULL;

-- Step 8: 新增SD受众的详细分类字段
ALTER TABLE `sd_audiences` 
  ADD COLUMN `audience_category` VARCHAR(100) DEFAULT NULL COMMENT '受众分类: remarketing/in_market/lifestyle/custom' AFTER `audience_type`,
  ADD COLUMN `audience_sub_category` VARCHAR(255) DEFAULT NULL COMMENT '受众子分类(如具体的In-market品类)' AFTER `audience_category`,
  ADD COLUMN `audience_expression` TEXT DEFAULT NULL COMMENT '受众定向表达式(JSON格式)' AFTER `audience_sub_category`,
  ADD COLUMN `amazon_audience_id` VARCHAR(64) DEFAULT NULL COMMENT 'Amazon侧受众ID' AFTER `audience_expression`;

-- ============================================================
-- Phase 4: sdAudienceTargeting表 - 补充缺失的受众类型枚举值
-- ============================================================

-- Step 9: audienceType枚举 - 扩展以覆盖所有SD受众定向类型
ALTER TABLE `sd_audience_targeting` 
  MODIFY COLUMN `audience_type` ENUM('views','purchases','similar_products','categories','audiences','inMarket','lifestyle','custom','remarketing','lookback') NOT NULL;

-- ============================================================
-- Phase 5: performanceGroups表 - 补充SB/SD广告特有的优化目标
-- ============================================================

-- Step 10: optimizationGoal枚举 - 增加 reach 和 brand_impression_share
ALTER TABLE `performance_groups` 
  MODIFY COLUMN `optimization_goal` ENUM('maximize_sales','target_acos','target_roas','daily_spend_limit','daily_cost','reach','brand_impression_share','leads') DEFAULT 'maximize_sales';

-- ============================================================
-- Phase 6: sbCampaignSettings表 - 补充SB特有字段
-- ============================================================

-- Step 11: campaignType枚举 - 增加 brand_video
ALTER TABLE `sb_campaign_settings` 
  MODIFY COLUMN `campaign_type` ENUM('video','store_spotlight','product_collection','brand_video') DEFAULT 'product_collection';

-- Step 12: 新增SB竞价调整相关字段
ALTER TABLE `sb_campaign_settings` 
  ADD COLUMN `placement_bid_top_of_search` INT DEFAULT 0 COMMENT 'Top of Search版位竞价调整%' AFTER `creative_optimization_enabled`,
  ADD COLUMN `placement_bid_product_page` INT DEFAULT 0 COMMENT 'Product Page版位竞价调整%' AFTER `placement_bid_top_of_search`,
  ADD COLUMN `placement_bid_rest_of_search` INT DEFAULT 0 COMMENT 'Rest of Search版位竞价调整%' AFTER `placement_bid_product_page`,
  ADD COLUMN `audience_bid_adjustment` INT DEFAULT 0 COMMENT '受众竞价调整%' AFTER `placement_bid_rest_of_search`,
  ADD COLUMN `campaign_goal` VARCHAR(50) DEFAULT NULL COMMENT 'SB广告目标' AFTER `audience_bid_adjustment`,
  ADD COLUMN `bid_optimization` VARCHAR(30) DEFAULT NULL COMMENT '竞价优化目标: reach/pageVisits/conversions' AFTER `campaign_goal`,
  ADD COLUMN `cost_type` VARCHAR(10) DEFAULT NULL COMMENT '计费类型: cpc/vcpm' AFTER `bid_optimization`;

-- ============================================================
-- Phase 7: 新增索引优化
-- ============================================================

-- Step 13: campaigns表新增campaignGoal索引（便于按广告目标筛选）
CREATE INDEX `idx_campaigns_goal` ON `campaigns` (`campaign_goal`);
CREATE INDEX `idx_campaigns_ad_format` ON `campaigns` (`ad_format`);

-- ============================================================
-- Phase 8: v500 数据完整性修复
-- ============================================================

-- Step 14: 修复auto_targeting_performance表的INDEX为UNIQUE约束
-- 防止重复数据插入

-- 先删除重复数据（保留id最小的记录）
DELETE t1 FROM auto_targeting_performance t1
INNER JOIN auto_targeting_performance t2
WHERE t1.id > t2.id
  AND t1.campaignId = t2.campaignId
  AND t1.adGroupId = t2.adGroupId
  AND t1.targetingType = t2.targetingType
  AND t1.date = t2.date;

-- 删除旧的普通INDEX
DROP INDEX `unique_perf` ON `auto_targeting_performance`;

-- 创建新的UNIQUE INDEX
CREATE UNIQUE INDEX `unique_perf` ON `auto_targeting_performance` (`campaignId`, `adGroupId`, `targetingType`, `date`);
