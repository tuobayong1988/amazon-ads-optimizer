-- ============================================================================
-- 迁移 0004: 全面字段增强
-- 目的: 补充所有缺失字段，支持完整的数据同步、存储、展示和自动优化
-- ============================================================================

-- 1. campaigns表增强：添加策略模板推荐字段和Amazon原始创建日期
-- 注意: 先检查列是否存在，避免重复添加
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'recommended_strategy_template_id');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE campaigns ADD COLUMN recommended_strategy_template_id VARCHAR(50) DEFAULT NULL COMMENT ''AI推荐的策略模板ID''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'recommended_strategy_template_name');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE campaigns ADD COLUMN recommended_strategy_template_name VARCHAR(100) DEFAULT NULL COMMENT ''AI推荐的策略模板名称''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'recommendation_reason');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE campaigns ADD COLUMN recommendation_reason TEXT DEFAULT NULL COMMENT ''推荐原因说明''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'recommendation_updated_at');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE campaigns ADD COLUMN recommendation_updated_at TIMESTAMP NULL DEFAULT NULL COMMENT ''推荐更新时间''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'amazon_created_date');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE campaigns ADD COLUMN amazon_created_date VARCHAR(10) DEFAULT NULL COMMENT ''Amazon侧广告活动创建日期''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. performance_groups表增强：关联策略模板
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'performance_groups' AND COLUMN_NAME = 'strategy_template_id');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE performance_groups ADD COLUMN strategy_template_id VARCHAR(50) DEFAULT NULL COMMENT ''关联的策略模板ID''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'performance_groups' AND COLUMN_NAME = 'strategy_template_name');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE performance_groups ADD COLUMN strategy_template_name VARCHAR(100) DEFAULT NULL COMMENT ''关联的策略模板名称''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'performance_groups' AND COLUMN_NAME = 'strategy_application_id');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE performance_groups ADD COLUMN strategy_application_id INT DEFAULT NULL COMMENT ''关联的策略模板应用ID''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. product_targets表增强：增加品类名称和品类细化条件字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_targets' AND COLUMN_NAME = 'category_name');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE product_targets ADD COLUMN category_name VARCHAR(500) DEFAULT NULL COMMENT ''品类名称（当targetType=category时）''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_targets' AND COLUMN_NAME = 'category_refinements');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE product_targets ADD COLUMN category_refinements TEXT DEFAULT NULL COMMENT ''品类细化条件JSON（品牌、价格范围、星级等）''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_targets' AND COLUMN_NAME = 'asin_title');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE product_targets ADD COLUMN asin_title VARCHAR(500) DEFAULT NULL COMMENT ''ASIN商品标题（当targetType=asin时）''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. search_terms表增强：增加来源投放词的匹配类型详情
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'search_terms' AND COLUMN_NAME = 'source_match_type');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE search_terms ADD COLUMN source_match_type VARCHAR(32) DEFAULT NULL COMMENT ''来源投放词的原始匹配类型(broad/phrase/exact/targeting/close/loose等)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'search_terms' AND COLUMN_NAME = 'source_target_type');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE search_terms ADD COLUMN source_target_type VARCHAR(32) DEFAULT NULL COMMENT ''来源投放类型(keyword/asin/category/auto_close/auto_loose/auto_substitutes/auto_complements)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'search_terms' AND COLUMN_NAME = 'search_term_type');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE search_terms ADD COLUMN search_term_type VARCHAR(32) DEFAULT ''keyword'' COMMENT ''搜索词类型(keyword=搜索词, asin=搜索ASIN)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. negative_keywords表增强：增加绩效数据字段（用于追踪否定效果）
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'negative_keywords' AND COLUMN_NAME = 'blocked_impressions');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE negative_keywords ADD COLUMN blocked_impressions INT DEFAULT 0 COMMENT ''否定后被拦截的预估曝光''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'negative_keywords' AND COLUMN_NAME = 'blocked_spend');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE negative_keywords ADD COLUMN blocked_spend DECIMAL(10,2) DEFAULT 0 COMMENT ''否定后被拦截的预估花费''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'negative_keywords' AND COLUMN_NAME = 'pre_negative_acos');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE negative_keywords ADD COLUMN pre_negative_acos DECIMAL(5,2) DEFAULT NULL COMMENT ''否定前该词的ACoS''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'negative_keywords' AND COLUMN_NAME = 'pre_negative_spend');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE negative_keywords ADD COLUMN pre_negative_spend DECIMAL(10,2) DEFAULT NULL COMMENT ''否定前该词的累计花费''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. ad_groups表增强：增加更多绩效字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ad_groups' AND COLUMN_NAME = 'units_ordered');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ad_groups ADD COLUMN units_ordered INT DEFAULT 0 COMMENT ''订购件数''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ad_groups' AND COLUMN_NAME = 'ad_group_state');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ad_groups ADD COLUMN ad_group_state VARCHAR(20) DEFAULT ''enabled'' COMMENT ''Amazon原始状态''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 7. keywords表增强：增加单位订购数字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'keywords' AND COLUMN_NAME = 'units_ordered');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE keywords ADD COLUMN units_ordered INT DEFAULT 0 COMMENT ''订购件数''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 8. product_targets表增强：增加单位订购数字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_targets' AND COLUMN_NAME = 'units_ordered');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE product_targets ADD COLUMN units_ordered INT DEFAULT 0 COMMENT ''订购件数''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 9. search_terms表增强：增加单位订购数字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'search_terms' AND COLUMN_NAME = 'search_term_units_ordered');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE search_terms ADD COLUMN search_term_units_ordered INT DEFAULT 0 COMMENT ''搜索词订购件数''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 10. 创建索引优化查询性能
-- campaigns表索引
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND INDEX_NAME = 'idx_campaigns_recommended_strategy');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_campaigns_recommended_strategy ON campaigns(recommended_strategy_template_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND INDEX_NAME = 'idx_campaigns_perf_group');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_campaigns_perf_group ON campaigns(performanceGroupId)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- performance_groups表索引
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'performance_groups' AND INDEX_NAME = 'idx_pg_strategy_template');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_pg_strategy_template ON performance_groups(strategy_template_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- product_targets表索引
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_targets' AND INDEX_NAME = 'idx_pt_target_type');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_pt_target_type ON product_targets(targetType)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- search_terms表索引
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'search_terms' AND INDEX_NAME = 'idx_st_source_match_type');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_st_source_match_type ON search_terms(source_match_type)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 迁移完成
-- ============================================================================
