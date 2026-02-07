-- Migration: 0002_add_daily_performance_fields
-- Description: 为daily_performance表补充缺失的报告API v3字段和归因期标记字段
-- Date: 2026-02-07

-- 添加报告API v3新增字段
ALTER TABLE `daily_performance` ADD COLUMN `dpv` INT DEFAULT 0;
ALTER TABLE `daily_performance` ADD COLUMN `add_to_cart` INT DEFAULT 0;
ALTER TABLE `daily_performance` ADD COLUMN `units_sold` INT DEFAULT 0;

-- 添加广告类型标记（用于区分不同归因期：SP=7天, SB=14天, SD=14天）
ALTER TABLE `daily_performance` ADD COLUMN `ad_type` ENUM('SP','SB','SD') DEFAULT NULL;

-- 添加归因窗口天数（SP=7, SB=14, SD=14）
ALTER TABLE `daily_performance` ADD COLUMN `attribution_window` INT DEFAULT NULL;

-- 为已有数据回填ad_type：根据campaign的campaignType推断
UPDATE `daily_performance` dp
INNER JOIN `campaigns` c ON dp.campaign_id = c.id
SET dp.ad_type = CASE
  WHEN c.campaign_type IN ('sp_auto', 'sp_manual') THEN 'SP'
  WHEN c.campaign_type IN ('sb_keyword', 'sb_product', 'sb_video') THEN 'SB'
  WHEN c.campaign_type IN ('sd_product', 'sd_audience') THEN 'SD'
  ELSE NULL
END
WHERE dp.ad_type IS NULL;

-- 回填attribution_window
UPDATE `daily_performance`
SET `attribution_window` = CASE
  WHEN `ad_type` = 'SP' THEN 7
  WHEN `ad_type` IN ('SB', 'SD') THEN 14
  ELSE NULL
END
WHERE `attribution_window` IS NULL AND `ad_type` IS NOT NULL;
