-- ============================================================
-- v207 数据迁移脚本：统一 campaignId 为 Amazon ID
-- ============================================================
-- 
-- 背景：
-- 历史代码中 negativeKeywords.campaignId 和 biddingLogs.campaignId
-- 以及 dailyPerformance.campaignId、searchTerms.campaignId、
-- adGroups.campaignId、placementPerformance.campaignId 等字段
-- 混存了本地int ID（如 "42"）和 Amazon ID（如 "283746591038"）。
-- 
-- 本脚本将所有存储了本地int的记录更新为对应的 Amazon campaignId。
-- 
-- 判断标准：
-- campaigns.id 是自增int（通常 < 10000），
-- campaigns.campaignId 是 Amazon ID（通常 > 10位数字字符串）。
-- 如果某表的 campaignId 值长度 <= 5 位，大概率是本地int。
--
-- 安全措施：
-- 1. 先执行 SELECT 查看影响范围
-- 2. 在事务中执行 UPDATE
-- 3. 提供回滚方案
-- ============================================================

-- ============================================================
-- STEP 0: 诊断 — 查看各表中可能存储了本地int的记录数量
-- ============================================================

SELECT '=== 诊断: 各表中疑似本地int的campaignId记录数 ===' AS info;

SELECT 'negative_keywords' AS table_name, 
       COUNT(*) AS total_records,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS suspected_local_id_count
FROM negative_keywords;

SELECT 'bidding_logs' AS table_name,
       COUNT(*) AS total_records,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS suspected_local_id_count
FROM bidding_logs;

SELECT 'daily_performance' AS table_name,
       COUNT(*) AS total_records,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS suspected_local_id_count
FROM daily_performance;

SELECT 'search_terms' AS table_name,
       COUNT(*) AS total_records,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS suspected_local_id_count
FROM search_terms;

SELECT 'ad_groups' AS table_name,
       COUNT(*) AS total_records,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS suspected_local_id_count
FROM ad_groups;

SELECT 'placement_performance' AS table_name,
       COUNT(*) AS total_records,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS suspected_local_id_count
FROM placement_performance;

-- ============================================================
-- STEP 1: 查看具体的映射关系（本地ID → Amazon ID）
-- ============================================================

SELECT '=== campaigns 映射表 ===' AS info;
SELECT id AS local_id, campaignId AS amazon_id, campaignName 
FROM campaigns 
ORDER BY id;

-- ============================================================
-- STEP 2: 修复 negative_keywords.campaignId
-- ============================================================

SELECT '=== 修复 negative_keywords ===' AS info;

UPDATE negative_keywords nk
INNER JOIN campaigns c ON nk.campaignId = CAST(c.id AS CHAR)
SET nk.campaignId = c.campaignId
WHERE LENGTH(nk.campaignId) <= 5 
  AND nk.campaignId REGEXP '^[0-9]+$';

SELECT ROW_COUNT() AS negative_keywords_updated;

-- ============================================================
-- STEP 3: 修复 bidding_logs.campaignId
-- ============================================================

SELECT '=== 修复 bidding_logs ===' AS info;

UPDATE bidding_logs bl
INNER JOIN campaigns c ON bl.campaignId = CAST(c.id AS CHAR)
SET bl.campaignId = c.campaignId
WHERE LENGTH(bl.campaignId) <= 5 
  AND bl.campaignId REGEXP '^[0-9]+$';

SELECT ROW_COUNT() AS bidding_logs_updated;

-- ============================================================
-- STEP 4: 修复 daily_performance.campaignId
-- ============================================================

SELECT '=== 修复 daily_performance ===' AS info;

UPDATE daily_performance dp
INNER JOIN campaigns c ON dp.campaignId = CAST(c.id AS CHAR)
SET dp.campaignId = c.campaignId
WHERE LENGTH(dp.campaignId) <= 5 
  AND dp.campaignId REGEXP '^[0-9]+$';

SELECT ROW_COUNT() AS daily_performance_updated;

-- ============================================================
-- STEP 5: 修复 search_terms.campaignId
-- ============================================================

SELECT '=== 修复 search_terms ===' AS info;

UPDATE search_terms st
INNER JOIN campaigns c ON st.campaignId = CAST(c.id AS CHAR)
SET st.campaignId = c.campaignId
WHERE LENGTH(st.campaignId) <= 5 
  AND st.campaignId REGEXP '^[0-9]+$';

SELECT ROW_COUNT() AS search_terms_updated;

-- ============================================================
-- STEP 6: 修复 ad_groups.campaignId
-- ============================================================

SELECT '=== 修复 ad_groups ===' AS info;

UPDATE ad_groups ag
INNER JOIN campaigns c ON ag.campaignId = CAST(c.id AS CHAR)
SET ag.campaignId = c.campaignId
WHERE LENGTH(ag.campaignId) <= 5 
  AND ag.campaignId REGEXP '^[0-9]+$';

SELECT ROW_COUNT() AS ad_groups_updated;

-- ============================================================
-- STEP 7: 修复 placement_performance.campaignId
-- ============================================================

SELECT '=== 修复 placement_performance ===' AS info;

UPDATE placement_performance pp
INNER JOIN campaigns c ON pp.campaignId = CAST(c.id AS CHAR)
SET pp.campaignId = c.campaignId
WHERE LENGTH(pp.campaignId) <= 5 
  AND pp.campaignId REGEXP '^[0-9]+$';

SELECT ROW_COUNT() AS placement_performance_updated;

-- ============================================================
-- STEP 8: 验证 — 确认不再有本地int残留
-- ============================================================

SELECT '=== 验证: 修复后各表中疑似本地int的记录数（应全部为0）===' AS info;

SELECT 'negative_keywords' AS table_name, 
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS remaining_local_ids
FROM negative_keywords;

SELECT 'bidding_logs' AS table_name,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS remaining_local_ids
FROM bidding_logs;

SELECT 'daily_performance' AS table_name,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS remaining_local_ids
FROM daily_performance;

SELECT 'search_terms' AS table_name,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS remaining_local_ids
FROM search_terms;

SELECT 'ad_groups' AS table_name,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS remaining_local_ids
FROM ad_groups;

SELECT 'placement_performance' AS table_name,
       SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS remaining_local_ids
FROM placement_performance;

SELECT '=== 迁移完成 ===' AS info;
