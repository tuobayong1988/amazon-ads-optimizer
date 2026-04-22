-- v717: 多时间窗口出价修正 - 新增keyword级别每日表现数据表
-- 用于支持5个时间窗口(90-60天/60-30天/30-14天/14-7天/7-3天)的出价锚点分析

CREATE TABLE IF NOT EXISTS `keyword_daily_performance` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `account_id` INT NOT NULL,
  `campaign_id` VARCHAR(64) NOT NULL,
  `internal_ad_group_id` INT DEFAULT NULL,
  `keyword_id` INT DEFAULT NULL COMMENT 'keywords表的内部ID',
  `target_id` INT DEFAULT NULL COMMENT 'product_targets表的内部ID',
  `entity_type` ENUM('keyword', 'product_target') NOT NULL,
  `date` DATE NOT NULL,
  `impressions` INT DEFAULT 0,
  `clicks` INT DEFAULT 0,
  `spend` DECIMAL(12, 4) DEFAULT 0.0000,
  `sales` DECIMAL(12, 2) DEFAULT 0.00,
  `orders` INT DEFAULT 0,
  `units_sold` INT DEFAULT 0,
  `cpc` DECIMAL(10, 4) DEFAULT NULL,
  `acos` DECIMAL(8, 4) DEFAULT NULL,
  `roas` DECIMAL(10, 2) DEFAULT NULL,
  `ctr` DECIMAL(8, 6) DEFAULT NULL,
  `cvr` DECIMAL(8, 6) DEFAULT NULL,
  `data_source` ENUM('api_report', 'ams_stream', 'calculated') DEFAULT 'api_report',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  UNIQUE KEY `uk_kdp_entity_date` (`account_id`, `keyword_id`, `target_id`, `date`),
  INDEX `idx_kdp_account_date` (`account_id`, `date`),
  INDEX `idx_kdp_keyword_date` (`keyword_id`, `date`),
  INDEX `idx_kdp_target_date` (`target_id`, `date`),
  INDEX `idx_kdp_campaign_date` (`campaign_id`, `date`),
  INDEX `idx_kdp_entity_type` (`entity_type`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='v717: keyword/target级别每日表现数据，支持多时间窗口出价锚点分析';

-- 新增bid_anchor_analysis表 - 存储每个投放词/ASIN的锚点分析结果
CREATE TABLE IF NOT EXISTS `bid_anchor_analysis` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `account_id` INT NOT NULL,
  `campaign_id` VARCHAR(64) NOT NULL,
  `keyword_id` INT DEFAULT NULL,
  `target_id` INT DEFAULT NULL,
  `entity_type` ENUM('keyword', 'product_target') NOT NULL,
  
  -- 最佳窗口信息
  `best_window` ENUM('W1_90_60', 'W2_60_30', 'W3_30_14', 'W4_14_7', 'W5_7_3') DEFAULT NULL,
  `best_window_roas` DECIMAL(10, 2) DEFAULT NULL,
  `best_window_acos` DECIMAL(8, 4) DEFAULT NULL,
  `best_window_cpc` DECIMAL(10, 4) DEFAULT NULL,
  `best_window_clicks` INT DEFAULT 0,
  `best_window_orders` INT DEFAULT 0,
  
  -- 锚定出价
  `anchor_bid` DECIMAL(10, 4) NOT NULL COMMENT '基于最佳窗口CPC的锚定出价',
  `current_bid` DECIMAL(10, 4) DEFAULT NULL COMMENT '分析时的当前出价',
  `bid_drift_percent` DECIMAL(8, 4) DEFAULT NULL COMMENT '当前出价相对锚点的偏移百分比',
  
  -- 恶化检测
  `degradation_level` ENUM('none', 'mild', 'severe', 'critical') DEFAULT 'none',
  `degradation_detail` JSON DEFAULT NULL COMMENT '各窗口对比详情',
  
  -- 修正建议
  `correction_action` ENUM('maintain', 'gradual_restore', 'restore_to_anchor', 'update_anchor', 'emergency_restore') DEFAULT 'maintain',
  `suggested_bid` DECIMAL(10, 4) DEFAULT NULL,
  `correction_reason` TEXT DEFAULT NULL,
  
  -- 5个窗口的汇总指标(JSON)
  `window_metrics` JSON DEFAULT NULL COMMENT '5个时间窗口的完整指标数据',
  
  -- 数据置信度
  `data_confidence` ENUM('high', 'medium', 'low', 'insufficient') DEFAULT 'insufficient',
  `total_data_points` INT DEFAULT 0,
  
  -- 执行状态
  `correction_status` ENUM('pending', 'applied', 'skipped', 'failed') DEFAULT 'pending',
  `applied_at` TIMESTAMP NULL DEFAULT NULL,
  `api_response_id` VARCHAR(128) DEFAULT NULL,
  
  `analyzed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  UNIQUE KEY `uk_baa_entity` (`account_id`, `keyword_id`, `target_id`),
  INDEX `idx_baa_account` (`account_id`),
  INDEX `idx_baa_campaign` (`campaign_id`),
  INDEX `idx_baa_degradation` (`degradation_level`),
  INDEX `idx_baa_correction` (`correction_action`, `correction_status`),
  INDEX `idx_baa_analyzed` (`analyzed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='v717: 多时间窗口出价锚点分析结果表';
