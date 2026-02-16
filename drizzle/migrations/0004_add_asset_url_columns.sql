-- Add asset URL columns to ad_groups table for storing resolved video/image URLs
-- These URLs are fetched from Amazon Creative Asset Library API using the assetId fields

ALTER TABLE `ad_groups` ADD COLUMN IF NOT EXISTS `video_url` VARCHAR(1024) DEFAULT NULL;
ALTER TABLE `ad_groups` ADD COLUMN IF NOT EXISTS `video_thumbnail_url` VARCHAR(1024) DEFAULT NULL;
ALTER TABLE `ad_groups` ADD COLUMN IF NOT EXISTS `brand_logo_url` VARCHAR(1024) DEFAULT NULL;
ALTER TABLE `ad_groups` ADD COLUMN IF NOT EXISTS `custom_image_url` VARCHAR(1024) DEFAULT NULL;
ALTER TABLE `ad_groups` ADD COLUMN IF NOT EXISTS `landing_page_url` VARCHAR(1024) DEFAULT NULL;
