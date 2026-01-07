-- API安全三件套数据库迁移

-- API操作日志表
CREATE TABLE IF NOT EXISTS `api_operation_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `account_id` int DEFAULT NULL,
  `operation_type` enum('bid_adjustment','budget_change','campaign_status','keyword_status','negative_keyword','target_status','batch_operation','api_sync','auto_optimization','manual_operation','other') NOT NULL,
  `target_type` enum('campaign','ad_group','keyword','product_target','search_term','account','multiple') NOT NULL,
  `target_id` int DEFAULT NULL,
  `target_name` varchar(500) DEFAULT NULL,
  `action_description` text NOT NULL,
  `previous_value` text DEFAULT NULL,
  `new_value` text DEFAULT NULL,
  `change_amount` decimal(10,2) DEFAULT NULL,
  `change_percent` decimal(5,2) DEFAULT NULL,
  `affected_count` int DEFAULT 1,
  `batch_operation_id` int DEFAULT NULL,
  `status` enum('success','failed','pending','rolled_back') NOT NULL DEFAULT 'success',
  `error_message` text DEFAULT NULL,
  `source` enum('manual','auto_optimization','scheduled_task','api_callback','batch_operation') NOT NULL DEFAULT 'manual',
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `risk_level` enum('low','medium','high','critical') NOT NULL DEFAULT 'low',
  `requires_review` tinyint DEFAULT 0,
  `reviewed_by` int DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `executed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_account_id` (`account_id`),
  KEY `idx_operation_type` (`operation_type`),
  KEY `idx_executed_at` (`executed_at`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 每日花费限额配置表
CREATE TABLE IF NOT EXISTS `spend_limit_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `account_id` int NOT NULL,
  `daily_spend_limit` decimal(12,2) NOT NULL,
  `warning_threshold_1` decimal(5,2) NOT NULL DEFAULT 50.00,
  `warning_threshold_2` decimal(5,2) NOT NULL DEFAULT 80.00,
  `critical_threshold` decimal(5,2) NOT NULL DEFAULT 95.00,
  `auto_stop_enabled` tinyint NOT NULL DEFAULT 0,
  `auto_stop_threshold` decimal(5,2) DEFAULT 100.00,
  `notify_on_warning_1` tinyint NOT NULL DEFAULT 1,
  `notify_on_warning_2` tinyint NOT NULL DEFAULT 1,
  `notify_on_critical` tinyint NOT NULL DEFAULT 1,
  `notify_on_auto_stop` tinyint NOT NULL DEFAULT 1,
  `is_enabled` tinyint NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_account` (`user_id`, `account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 花费告警记录表
CREATE TABLE IF NOT EXISTS `spend_alert_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `config_id` int NOT NULL,
  `user_id` int NOT NULL,
  `account_id` int NOT NULL,
  `alert_type` enum('warning_50','warning_80','critical_95','limit_reached','auto_stopped') NOT NULL,
  `alert_level` enum('info','warning','critical') NOT NULL,
  `current_spend` decimal(12,2) NOT NULL,
  `daily_limit` decimal(12,2) NOT NULL,
  `spend_percent` decimal(5,2) NOT NULL,
  `notification_sent` tinyint NOT NULL DEFAULT 0,
  `notification_sent_at` timestamp NULL DEFAULT NULL,
  `notification_error` text DEFAULT NULL,
  `acknowledged` tinyint NOT NULL DEFAULT 0,
  `acknowledged_by` int DEFAULT NULL,
  `acknowledged_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_config_id` (`config_id`),
  KEY `idx_user_account` (`user_id`, `account_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 异常检测规则表
CREATE TABLE IF NOT EXISTS `anomaly_detection_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `account_id` int DEFAULT NULL,
  `rule_name` varchar(255) NOT NULL,
  `rule_description` text DEFAULT NULL,
  `rule_type` enum('bid_spike','bid_drop','batch_size','frequency','budget_change','spend_velocity','conversion_drop','acos_spike','custom') NOT NULL,
  `condition_type` enum('threshold','percentage_change','absolute_change','rate_limit') NOT NULL,
  `condition_value` decimal(10,2) NOT NULL,
  `condition_time_window` int DEFAULT 60,
  `action_on_trigger` enum('alert_only','pause_and_alert','rollback_and_alert','block_operation') NOT NULL DEFAULT 'alert_only',
  `notify_owner` tinyint NOT NULL DEFAULT 1,
  `notify_team` tinyint NOT NULL DEFAULT 0,
  `is_enabled` tinyint NOT NULL DEFAULT 1,
  `priority` int DEFAULT 5,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_rule_type` (`rule_type`),
  KEY `idx_is_enabled` (`is_enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 异常检测告警记录表
CREATE TABLE IF NOT EXISTS `anomaly_alert_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `rule_id` int NOT NULL,
  `user_id` int NOT NULL,
  `account_id` int DEFAULT NULL,
  `trigger_value` decimal(10,2) NOT NULL,
  `threshold_value` decimal(10,2) NOT NULL,
  `trigger_description` text NOT NULL,
  `related_operation_id` int DEFAULT NULL,
  `related_operation_type` varchar(50) DEFAULT NULL,
  `action_taken` enum('alert_sent','operation_paused','operation_rolled_back','operation_blocked') NOT NULL,
  `notification_sent` tinyint NOT NULL DEFAULT 0,
  `notification_sent_at` timestamp NULL DEFAULT NULL,
  `status` enum('active','acknowledged','resolved','false_positive') NOT NULL DEFAULT 'active',
  `resolved_by` int DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `resolution_notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rule_id` (`rule_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 自动暂停记录表
CREATE TABLE IF NOT EXISTS `auto_pause_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `account_id` int NOT NULL,
  `pause_reason` enum('spend_limit_reached','anomaly_detected','acos_threshold','manual_trigger','scheduled') NOT NULL,
  `related_alert_id` int DEFAULT NULL,
  `related_rule_id` int DEFAULT NULL,
  `pause_scope` enum('account','campaign','ad_group','keyword','target') NOT NULL,
  `paused_entity_ids` text DEFAULT NULL,
  `paused_entity_count` int NOT NULL DEFAULT 1,
  `previous_states` text DEFAULT NULL,
  `notification_sent` tinyint NOT NULL DEFAULT 0,
  `notification_sent_at` timestamp NULL DEFAULT NULL,
  `is_resumed` tinyint NOT NULL DEFAULT 0,
  `resumed_by` int DEFAULT NULL,
  `resumed_at` timestamp NULL DEFAULT NULL,
  `resume_reason` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_account` (`user_id`, `account_id`),
  KEY `idx_pause_reason` (`pause_reason`),
  KEY `idx_is_resumed` (`is_resumed`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
