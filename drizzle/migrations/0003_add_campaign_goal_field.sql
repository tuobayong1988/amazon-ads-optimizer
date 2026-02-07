-- Migration: 0003_add_campaign_goal_field
-- Description: 为campaigns表添加campaignGoal字段，用于存储SB/SD广告的广告目标（决定CPC/vCPM计费方式）
-- Date: 2026-02-07

-- 添加campaignGoal字段（SB: DRIVE_PAGE_VISITS/GROW_BRAND_IMPRESSION_SHARE, SD: reach/pageVisits/conversions）
ALTER TABLE `campaigns` ADD COLUMN `campaign_goal` VARCHAR(100) DEFAULT NULL;

-- 为已有SB广告回填campaignGoal：根据costType推断
-- costType='cpc' → DRIVE_PAGE_VISITS（驱动页面访问）
-- costType='vcpm' → GROW_BRAND_IMPRESSION_SHARE（增长品牌展示份额）
UPDATE `campaigns`
SET `campaign_goal` = CASE
  WHEN `cost_type` = 'vcpm' AND `campaign_type` IN ('sb_keyword', 'sb_product', 'sb_video') THEN 'GROW_BRAND_IMPRESSION_SHARE'
  WHEN `cost_type` = 'cpc' AND `campaign_type` IN ('sb_keyword', 'sb_product', 'sb_video') THEN 'DRIVE_PAGE_VISITS'
  ELSE `campaign_goal`
END
WHERE `campaign_goal` IS NULL 
  AND `campaign_type` IN ('sb_keyword', 'sb_product', 'sb_video');

-- 为已有SD广告回填campaignGoal：根据bidOptimization推断
UPDATE `campaigns`
SET `campaign_goal` = CASE
  WHEN `bid_optimization` = 'reach' THEN 'reach'
  WHEN `bid_optimization` = 'pageVisits' THEN 'pageVisits'
  WHEN `bid_optimization` = 'conversions' THEN 'conversions'
  ELSE `campaign_goal`
END
WHERE `campaign_goal` IS NULL 
  AND `campaign_type` IN ('sd_product', 'sd_audience');
