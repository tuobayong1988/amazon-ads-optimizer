-- Migration 0005: 智能否定引擎V2 - 添加campaignType和negativeScope字段
-- 日期: 2026-03-06
-- 描述: 为negative_keywords表添加campaignTypeNeg和negativeScope字段，
--       以支持基于广告活动类型的精确否定决策

-- 1. 添加 campaignTypeNeg 字段（记录来源广告活动类型）
ALTER TABLE negative_keywords 
ADD COLUMN campaignTypeNeg ENUM('sp','sb','sd') DEFAULT 'sp' AFTER adGroupId;

-- 2. 添加 negativeScope 字段（明确否定层级）
ALTER TABLE negative_keywords 
ADD COLUMN negativeScope ENUM('campaign','ad_group') DEFAULT 'campaign' AFTER campaignTypeNeg;

-- 3. 扩展 negativeSource 枚举值，添加 'smart_negation'
ALTER TABLE negative_keywords 
MODIFY COLUMN negativeSource ENUM('manual','ngram_analysis','traffic_conflict','funnel_migration','search_term_harvest','auto_optimization','smart_negation') DEFAULT 'manual';

-- 4. 回填现有数据：根据 negativeLevel 字段设置 negativeScope
UPDATE negative_keywords SET negativeScope = negativeLevel WHERE negativeScope IS NULL OR negativeScope = '';

-- 5. 回填现有数据：默认设置为 'sp'（因为现有系统只处理SP广告）
UPDATE negative_keywords SET campaignTypeNeg = 'sp' WHERE campaignTypeNeg IS NULL OR campaignTypeNeg = '';
