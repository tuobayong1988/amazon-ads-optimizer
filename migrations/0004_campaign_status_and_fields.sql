-- 0004: 增强campaigns表字段完整性
-- 1. 扩展campaignStatus枚举，添加draft(草稿)状态
-- 2. 添加amazonCreatedDate字段存储Amazon侧的广告活动创建日期
-- 3. 确保budgetType字段在SB/SD同步时正确写入

-- 扩展campaignStatus枚举，添加draft状态
ALTER TABLE campaigns MODIFY COLUMN campaign_status ENUM('enabled','paused','archived','draft') DEFAULT 'enabled';

-- 添加Amazon原始创建日期字段（区别于系统入库时间createdAt）
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS amazon_created_date VARCHAR(10) DEFAULT NULL COMMENT 'Amazon侧广告活动创建日期(YYYY-MM-DD)';

-- 添加servingStatus字段存储Amazon的投放状态（如CAMPAIGN_STATUS_ENABLED, CAMPAIGN_PAUSED, BUDGET_EXCEEDED等）
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS serving_status VARCHAR(100) DEFAULT NULL COMMENT 'Amazon投放状态(CAMPAIGN_STATUS_ENABLED等)';
