-- Migration 0005: 智能否定引擎V2 - 添加campaignType和negativeScope字段
-- 日期: 2026-03-06
-- 描述: 为negative_keywords表添加campaignType和negativeScope字段，
--       以支持基于广告活动类型的精确否定决策

-- 1. 添加 campaign_type_neg 字段（记录来源广告活动类型）
ALTER TABLE negative_keywords 
ADD COLUMN campaign_type_neg ENUM('sp','sb','sd') DEFAULT 'sp' AFTER ad_group_id;

-- 2. 添加 negative_scope 字段（明确否定层级）
ALTER TABLE negative_keywords 
ADD COLUMN negative_scope ENUM('campaign','ad_group') DEFAULT 'campaign' AFTER campaign_type_neg;

-- 3. 扩展 negative_source 枚举值，添加 'smart_negation'
ALTER TABLE negative_keywords 
MODIFY COLUMN negative_source ENUM('manual','ngram_analysis','traffic_conflict','funnel_migration','search_term_harvest','auto_optimization','smart_negation') DEFAULT 'manual';

-- 4. 回填现有数据：根据 negative_level 字段设置 negative_scope
UPDATE negative_keywords SET negative_scope = negative_level WHERE negative_scope IS NULL OR negative_scope = '';

-- 5. 回填现有数据：默认设置为 'sp'（因为现有系统只处理SP广告）
UPDATE negative_keywords SET campaign_type_neg = 'sp' WHERE campaign_type_neg IS NULL OR campaign_type_neg = '';
