-- 数据库迁移: 移除计算字段
-- 日期: 2026-02-15
-- 原因: 计算字段应该在运行时计算,而不是存储在数据库中
-- 影响表: campaigns, ad_groups, keywords, product_targets, placement_performance

-- 1. campaigns表 - 移除计算字段
ALTER TABLE campaigns 
  DROP COLUMN IF EXISTS acos,
  DROP COLUMN IF EXISTS roas,
  DROP COLUMN IF EXISTS ctr,
  DROP COLUMN IF EXISTS cvr,
  DROP COLUMN IF EXISTS cpc;

-- 2. ad_groups表 - 移除计算字段
ALTER TABLE ad_groups 
  DROP COLUMN IF EXISTS acos,
  DROP COLUMN IF EXISTS roas,
  DROP COLUMN IF EXISTS ctr,
  DROP COLUMN IF EXISTS cvr,
  DROP COLUMN IF EXISTS cpc;

-- 3. keywords表 - 移除计算字段
ALTER TABLE keywords 
  DROP COLUMN IF EXISTS acos,
  DROP COLUMN IF EXISTS roas,
  DROP COLUMN IF EXISTS ctr,
  DROP COLUMN IF EXISTS cvr,
  DROP COLUMN IF EXISTS cpc;

-- 4. product_targets表 - 移除计算字段
ALTER TABLE product_targets 
  DROP COLUMN IF EXISTS acos,
  DROP COLUMN IF EXISTS roas,
  DROP COLUMN IF EXISTS ctr,
  DROP COLUMN IF EXISTS cvr,
  DROP COLUMN IF EXISTS cpc;

-- 5. placement_performance表 - 移除计算字段
ALTER TABLE placement_performance 
  DROP COLUMN IF EXISTS acos,
  DROP COLUMN IF EXISTS roas,
  DROP COLUMN IF EXISTS ctr,
  DROP COLUMN IF EXISTS cvr,
  DROP COLUMN IF EXISTS cpc;

-- 验证: 查看修改后的表结构
-- SHOW COLUMNS FROM campaigns;
-- SHOW COLUMNS FROM ad_groups;
-- SHOW COLUMNS FROM keywords;
-- SHOW COLUMNS FROM product_targets;
-- SHOW COLUMNS FROM placement_performance;
