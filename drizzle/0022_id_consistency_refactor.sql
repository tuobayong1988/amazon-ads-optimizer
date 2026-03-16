-- v418: ID体系一致性重构
-- 将所有子表中存储内部adGroup自增ID的ad_group_id字段重命名为internal_ad_group_id
-- 并统一类型为INT，明确区分内部ID和Amazon ID

-- ============================================================
-- Phase 1: 核心子表 - 重命名并转换类型（varchar → int）
-- ============================================================

-- Step 1: keywords表 - 从varchar(64)改为int
ALTER TABLE `keywords` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NULL;

-- Step 2: product_targets表 - 从varchar(64)改为int
ALTER TABLE `product_targets` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NULL;

-- Step 3: search_terms表 - 从varchar(64)改为int
ALTER TABLE `search_terms` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NOT NULL;

-- Step 4: negative_keywords表 - 从varchar(64)改为int
ALTER TABLE `negative_keywords` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NULL;

-- ============================================================
-- Phase 2: 辅助表 - 重命名（类型已经是int，仅重命名）
-- ============================================================

-- Step 5: bidding_logs表
ALTER TABLE `bidding_logs` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NULL;

-- Step 6: hourly_performance表
ALTER TABLE `hourly_performance` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NULL;

-- Step 7: sd_audiences表
ALTER TABLE `sd_audiences` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NOT NULL;

-- Step 8: optimization_events表
ALTER TABLE `optimization_events` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NULL;

-- Step 9: keyword_placement_hourly_performance表
ALTER TABLE `keyword_placement_hourly_performance` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NULL;

-- Step 10: contextual_features表
ALTER TABLE `contextual_features` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NULL;

-- Step 11: rl_training_logs表
ALTER TABLE `rl_training_logs` 
  CHANGE COLUMN `ad_group_id` `internal_ad_group_id` INT NULL;

-- ============================================================
-- Phase 3: 更新索引
-- ============================================================

-- 删除旧索引（如果存在）
ALTER TABLE `keywords` DROP INDEX IF EXISTS `idx_keywords_adGroupId`;
ALTER TABLE `search_terms` DROP INDEX IF EXISTS `idx_searchTerms_adGroupId`;
ALTER TABLE `sd_audiences` DROP INDEX IF EXISTS `idx_ad_group_id`;

-- 创建新索引
ALTER TABLE `keywords` ADD INDEX `idx_keywords_internal_ad_group_id` (`internal_ad_group_id`);
ALTER TABLE `product_targets` ADD INDEX `idx_product_targets_internal_ad_group_id` (`internal_ad_group_id`);
ALTER TABLE `search_terms` ADD INDEX `idx_search_terms_internal_ad_group_id` (`internal_ad_group_id`);
ALTER TABLE `negative_keywords` ADD INDEX `idx_negative_keywords_internal_ad_group_id` (`internal_ad_group_id`);
ALTER TABLE `sd_audiences` ADD INDEX `idx_internal_ad_group_id` (`internal_ad_group_id`);

-- 更新search_terms唯一约束（如果存在旧约束）
ALTER TABLE `search_terms` DROP INDEX IF EXISTS `uk_search_term`;
ALTER TABLE `search_terms` ADD UNIQUE INDEX `uk_search_term` (`account_id`, `campaign_id`, `internal_ad_group_id`, `search_term`(191), `report_start_date`);
