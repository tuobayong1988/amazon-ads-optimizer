-- ============================================================
-- M1 知识图谱升级迁移脚本
-- 版本: v4.0 关系型词库
-- 日期: 2026-03-06
-- 
-- 本迁移实现以下变更：
-- 1. 扩展 prelaunch_keywords 表：新增四维画像字段
-- 2. 扩展 prelaunch_keyword_clusters 表：新增场景绑定和广告组映射字段
-- 3. 扩展 prelaunch_keyword_relations 表：升级为六种语义关系类型
-- 4. 扩展 prelaunch_cosmo_triples 表：新增因果链元数据
-- 5. 新增 prelaunch_keyword_scene_weights 表：关键词场景权重
-- 6. 新增 prelaunch_graph_snapshots 表：图谱版本快照
-- ============================================================

-- ============================================================
-- 1. 扩展 prelaunch_keywords 表：四维画像字段
-- ============================================================

-- 第一维：商业价值 (Commercial Value)
ALTER TABLE `prelaunch_keywords`
  ADD COLUMN `commercial_value` ENUM('core_traffic', 'core_conversion', 'precision_longtail', 'broad_traffic', 'low_value') NULL AFTER `raw_data`,
  ADD COLUMN `commercial_score` DECIMAL(8,4) NULL AFTER `commercial_value`,
  ADD COLUMN `click_concentration` DECIMAL(8,4) NULL AFTER `commercial_score`,
  ADD COLUMN `ppc_bid_estimate` DECIMAL(10,2) NULL AFTER `click_concentration`,
  ADD COLUMN `purchase_rate` DECIMAL(8,4) NULL AFTER `ppc_bid_estimate`;

-- 第二维：用户意图 (User Intent)
ALTER TABLE `prelaunch_keywords`
  ADD COLUMN `user_intent` ENUM('informational', 'navigational', 'commercial_investigation', 'transactional') NULL AFTER `purchase_rate`,
  ADD COLUMN `intent_confidence` DECIMAL(8,4) NULL AFTER `user_intent`;

-- 第三维：购买阶段 (Purchase Stage)
ALTER TABLE `prelaunch_keywords`
  ADD COLUMN `purchase_stage` ENUM('awareness', 'interest', 'consideration', 'purchase', 'loyalty') NULL AFTER `intent_confidence`,
  ADD COLUMN `purchase_stage_confidence` DECIMAL(8,4) NULL AFTER `purchase_stage`;

-- 第四维：产品属性标签 (Product Attributes)
ALTER TABLE `prelaunch_keywords`
  ADD COLUMN `product_attributes` JSON NULL AFTER `purchase_stage_confidence`;

-- 场景分布画像
ALTER TABLE `prelaunch_keywords`
  ADD COLUMN `scene_distribution` JSON NULL AFTER `product_attributes`;

-- 蓝海验证
ALTER TABLE `prelaunch_keywords`
  ADD COLUMN `blue_ocean_verified` TINYINT DEFAULT 0 AFTER `scene_distribution`,
  ADD COLUMN `blue_ocean_evidence` TEXT NULL AFTER `blue_ocean_verified`;

-- 更新时间戳
ALTER TABLE `prelaunch_keywords`
  ADD COLUMN `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;

-- 新增索引
ALTER TABLE `prelaunch_keywords`
  ADD INDEX `idx_plkw_commercial` (`commercial_value`),
  ADD INDEX `idx_plkw_intent` (`user_intent`),
  ADD INDEX `idx_plkw_stage` (`purchase_stage`),
  ADD INDEX `idx_plkw_cluster` (`cluster_id`);


-- ============================================================
-- 2. 扩展 prelaunch_keyword_clusters 表
-- ============================================================

ALTER TABLE `prelaunch_keyword_clusters`
  ADD COLUMN `scenario_tags` JSON NULL AFTER `top_scenario`,
  ADD COLUMN `dominant_intent` VARCHAR(50) NULL AFTER `scenario_tags`,
  ADD COLUMN `dominant_purchase_stage` VARCHAR(50) NULL AFTER `dominant_intent`,
  ADD COLUMN `ad_group_mapping` VARCHAR(200) NULL AFTER `dominant_purchase_stage`,
  ADD COLUMN `cluster_strength` DECIMAL(8,4) NULL AFTER `ad_group_mapping`;


-- ============================================================
-- 3. 升级 prelaunch_keyword_relations 表
-- ============================================================

-- 新增冗余关键词文本字段（避免频繁JOIN）
ALTER TABLE `prelaunch_keyword_relations`
  ADD COLUMN `source_keyword` VARCHAR(500) NULL AFTER `target_keyword_id`,
  ADD COLUMN `target_keyword` VARCHAR(500) NULL AFTER `source_keyword`;

-- 修改关系类型为ENUM（六种语义关系）
ALTER TABLE `prelaunch_keyword_relations`
  MODIFY COLUMN `relation_type` ENUM('hypernym', 'hyponym', 'synonym', 'related', 'alternative', 'complementary') NOT NULL;

-- 新增检测方法和分析字段
ALTER TABLE `prelaunch_keyword_relations`
  ADD COLUMN `detection_method` VARCHAR(50) NULL AFTER `evidence`,
  ADD COLUMN `co_occurrence_score` DECIMAL(8,4) NULL AFTER `detection_method`,
  ADD COLUMN `serp_overlap` DECIMAL(8,4) NULL AFTER `co_occurrence_score`;

-- 新增索引
ALTER TABLE `prelaunch_keyword_relations`
  ADD INDEX `idx_plkr_target` (`target_keyword_id`),
  ADD INDEX `idx_plkr_type` (`relation_type`);


-- ============================================================
-- 4. 扩展 prelaunch_cosmo_triples 表
-- ============================================================

ALTER TABLE `prelaunch_cosmo_triples`
  ADD COLUMN `source_type` VARCHAR(50) NULL AFTER `source_keyword_ids`,
  ADD COLUMN `scenario_code` VARCHAR(10) NULL AFTER `source_type`,
  ADD COLUMN `pain_point_category` VARCHAR(100) NULL AFTER `scenario_code`,
  ADD COLUMN `solution_category` VARCHAR(100) NULL AFTER `pain_point_category`,
  ADD COLUMN `value_proposition` TEXT NULL AFTER `solution_category`,
  ADD COLUMN `related_competitor_ids` JSON NULL AFTER `value_proposition`;

ALTER TABLE `prelaunch_cosmo_triples`
  ADD INDEX `idx_plct_scenario` (`scenario_code`);


-- ============================================================
-- 5. 新增 prelaunch_keyword_scene_weights 表
-- ============================================================

CREATE TABLE IF NOT EXISTS `prelaunch_keyword_scene_weights` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `project_id` INT NOT NULL,
  `keyword_id` INT NOT NULL,
  `scenario_code` VARCHAR(10) NOT NULL,
  `scenario_label` VARCHAR(100) NULL,
  `weight` DECIMAL(8,4) NOT NULL,
  `confidence` DECIMAL(8,4) NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_plksw_project` (`project_id`),
  INDEX `idx_plksw_keyword` (`keyword_id`),
  INDEX `idx_plksw_scenario` (`scenario_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 6. 新增 prelaunch_graph_snapshots 表
-- ============================================================

CREATE TABLE IF NOT EXISTS `prelaunch_graph_snapshots` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `project_id` INT NOT NULL,
  `version` INT DEFAULT 1,
  `total_nodes` INT DEFAULT 0,
  `total_edges` INT DEFAULT 0,
  `total_clusters` INT DEFAULT 0,
  `total_cosmo_triples` INT DEFAULT 0,
  `graph_metrics` JSON NULL,
  `pipeline_log` JSON NULL,
  `snapshot_status` ENUM('building', 'completed', 'failed') DEFAULT 'building',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_plgs_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 迁移完成标记
-- ============================================================
-- 本迁移新增了以下数据库对象：
-- - prelaunch_keywords: 13个新字段（四维画像 + 场景分布 + 蓝海验证）
-- - prelaunch_keyword_clusters: 5个新字段（场景绑定 + 广告组映射）
-- - prelaunch_keyword_relations: 5个新字段（六种语义关系 + 检测方法）
-- - prelaunch_cosmo_triples: 6个新字段（因果链元数据）
-- - prelaunch_keyword_scene_weights: 新表（关键词场景权重）
-- - prelaunch_graph_snapshots: 新表（图谱版本快照）
