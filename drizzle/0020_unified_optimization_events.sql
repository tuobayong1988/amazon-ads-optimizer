-- v145: 创建统一优化事件表 optimization_events
-- 合并 bidding_logs, bid_adjustment_history, optimization_logs 三张表的数据
CREATE TABLE IF NOT EXISTS `optimization_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  
  -- 基础信息
  `performance_group_id` int DEFAULT NULL,
  `performance_group_name` varchar(255) DEFAULT NULL,
  `account_id` int NOT NULL,
  `account_name` varchar(255) DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `user_name` varchar(255) DEFAULT NULL,
  
  -- 事件分类
  `event_category` enum('bid_adjustment','placement_adjustment','budget_adjustment','search_term_action','keyword_action','campaign_action','adgroup_action','target_management','settings_change') NOT NULL,
  
  -- 操作类型
  `action_type` enum('bid_increase','bid_decrease','bid_set','bid_auto_adjust','dayparting_bid','budget_increase','budget_decrease','budget_set','budget_adjustment','placement_adjust','placement_enable','placement_disable','search_term_harvest','negative_keyword_add','negative_keyword_remove','keyword_create','target_pause','target_enable','campaign_pause','campaign_enable','adgroup_pause','adgroup_enable','create_target','update_target','delete_target','pause_target','resume_target','add_campaign','remove_campaign','settings_update','strategy_change','schedule_update') NOT NULL,
  
  -- 策略模板信息
  `strategy_template_id` int DEFAULT NULL,
  `strategy_template_name` varchar(255) DEFAULT NULL,
  
  -- 广告活动/广告组信息
  `campaign_id` int DEFAULT NULL,
  `campaign_name` varchar(500) DEFAULT NULL,
  `ad_group_id` int DEFAULT NULL,
  `ad_group_name` varchar(500) DEFAULT NULL,
  
  -- 关键词/投放目标信息
  `keyword_id` int DEFAULT NULL,
  `keyword_text` varchar(500) DEFAULT NULL,
  `match_type` varchar(32) DEFAULT NULL,
  `target_id` int DEFAULT NULL,
  `target_name` varchar(500) DEFAULT NULL,
  
  -- 出价调整详情
  `previous_bid` decimal(10,2) DEFAULT NULL,
  `new_bid` decimal(10,2) DEFAULT NULL,
  `bid_change_percent` decimal(10,2) DEFAULT NULL,
  
  -- 通用变更详情
  `previous_value` varchar(500) DEFAULT NULL,
  `new_value` varchar(500) DEFAULT NULL,
  `change_reason` text DEFAULT NULL,
  `action_detail` text DEFAULT NULL,
  
  -- 算法信息
  `algorithm_version` varchar(32) DEFAULT NULL,
  `optimization_score` int DEFAULT NULL,
  `expected_profit_increase` decimal(10,2) DEFAULT NULL,
  `performance_data` json DEFAULT NULL,
  `adjustment_type` varchar(64) DEFAULT NULL,
  
  -- 执行状态
  `status` enum('pending','success','failed','rolled_back','skipped') DEFAULT 'pending',
  `error_message` text DEFAULT NULL,
  
  -- Amazon API 同步状态
  `api_sync_status` enum('pending','synced','failed','not_applicable') DEFAULT 'pending',
  `api_sync_detail` text DEFAULT NULL,
  `api_response_id` varchar(128) DEFAULT NULL,
  `api_synced_at` datetime DEFAULT NULL,
  
  -- 效果追踪字段
  `actual_profit_7d` decimal(10,2) DEFAULT NULL,
  `actual_profit_14d` decimal(10,2) DEFAULT NULL,
  `actual_profit_30d` decimal(10,2) DEFAULT NULL,
  `actual_impressions_7d` int DEFAULT NULL,
  `actual_clicks_7d` int DEFAULT NULL,
  `actual_conversions_7d` int DEFAULT NULL,
  `actual_spend_7d` decimal(10,2) DEFAULT NULL,
  `actual_revenue_7d` decimal(10,2) DEFAULT NULL,
  `tracking_updated_at` datetime DEFAULT NULL,
  
  -- 回滚信息
  `rolled_back_at` datetime DEFAULT NULL,
  `rolled_back_by` varchar(255) DEFAULT NULL,
  
  -- 来源追溯（用于数据迁移后溯源）
  `source_table` varchar(64) DEFAULT NULL,
  `source_id` int DEFAULT NULL,
  
  -- 时间戳
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `executed_at` datetime DEFAULT NULL,
  
  PRIMARY KEY (`id`),
  KEY `idx_oe_performance_group` (`performance_group_id`),
  KEY `idx_oe_account` (`account_id`),
  KEY `idx_oe_user` (`user_id`),
  KEY `idx_oe_event_category` (`event_category`),
  KEY `idx_oe_action_type` (`action_type`),
  KEY `idx_oe_campaign` (`campaign_id`),
  KEY `idx_oe_keyword` (`keyword_id`),
  KEY `idx_oe_status` (`status`),
  KEY `idx_oe_api_sync_status` (`api_sync_status`),
  KEY `idx_oe_created_at` (`created_at`),
  KEY `idx_oe_pg_category_created` (`performance_group_id`, `event_category`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
