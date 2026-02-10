-- ============================================
-- 数据库约束和数据清理机制
-- 版本: v40
-- 日期: 2026-02-10
-- ============================================

-- 1. 添加外键约束（可选，需要谨慎评估）
-- 注意：由于campaign_id现在是varchar类型，存储的是Amazon的campaignId
-- 而campaigns表中的campaignId字段可能会因为数据同步而变化
-- 因此不建议添加强制外键约束，而是使用定期清理机制

-- 如果确实需要外键约束，可以使用以下SQL（需要先确保数据一致性）：
-- ALTER TABLE strategy_template_campaigns
-- ADD CONSTRAINT fk_campaign_id
-- FOREIGN KEY (campaign_id) REFERENCES campaigns(campaignId)
-- ON DELETE CASCADE
-- ON UPDATE CASCADE;

-- 2. 添加索引以提升查询性能（如果还没有添加）
-- 检查是否已存在索引
SELECT 
    TABLE_NAME,
    INDEX_NAME,
    COLUMN_NAME
FROM 
    INFORMATION_SCHEMA.STATISTICS
WHERE 
    TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'strategy_template_campaigns'
    AND COLUMN_NAME = 'campaign_id';

-- 如果没有索引，添加索引
-- ALTER TABLE strategy_template_campaigns
-- ADD INDEX idx_campaign_id (campaign_id);

-- 3. 创建数据质量检查视图
CREATE OR REPLACE VIEW v_invalid_campaign_associations AS
SELECT 
    stc.id,
    stc.template_id,
    stc.campaign_id,
    stc.created_at,
    'Campaign not found in campaigns table' AS issue_type
FROM 
    strategy_template_campaigns stc
LEFT JOIN 
    campaigns c ON stc.campaign_id = c.campaignId
WHERE 
    c.campaignId IS NULL;

-- 4. 创建数据清理存储过程
DELIMITER //

CREATE PROCEDURE sp_cleanup_invalid_campaign_associations()
BEGIN
    DECLARE deleted_count INT DEFAULT 0;
    
    -- 开始事务
    START TRANSACTION;
    
    -- 删除无效的关联记录
    DELETE stc FROM strategy_template_campaigns stc
    LEFT JOIN campaigns c ON stc.campaign_id = c.campaignId
    WHERE c.campaignId IS NULL;
    
    -- 获取删除的记录数
    SET deleted_count = ROW_COUNT();
    
    -- 提交事务
    COMMIT;
    
    -- 返回删除的记录数
    SELECT deleted_count AS records_deleted, NOW() AS cleanup_time;
END //

DELIMITER ;

-- 5. 创建数据质量监控查询
-- 查询当前无效关联的数量
SELECT 
    COUNT(*) AS invalid_associations_count,
    NOW() AS check_time
FROM 
    v_invalid_campaign_associations;

-- 6. 创建定期清理事件（可选，需要启用事件调度器）
-- 检查事件调度器状态
SHOW VARIABLES LIKE 'event_scheduler';

-- 如果需要启用事件调度器（需要数据库管理员权限）
-- SET GLOBAL event_scheduler = ON;

-- 创建每日清理事件（每天凌晨2点执行）
-- DROP EVENT IF EXISTS evt_daily_cleanup_invalid_associations;

-- CREATE EVENT evt_daily_cleanup_invalid_associations
-- ON SCHEDULE EVERY 1 DAY
-- STARTS TIMESTAMP(CURRENT_DATE + INTERVAL 1 DAY, '02:00:00')
-- DO
-- BEGIN
--     CALL sp_cleanup_invalid_campaign_associations();
-- END;

-- 7. 添加数据完整性检查触发器（可选）
-- 在插入新记录时检查campaign_id是否存在
DELIMITER //

CREATE TRIGGER trg_check_campaign_exists_before_insert
BEFORE INSERT ON strategy_template_campaigns
FOR EACH ROW
BEGIN
    DECLARE campaign_exists INT;
    
    -- 检查campaign_id是否存在于campaigns表中
    SELECT COUNT(*) INTO campaign_exists
    FROM campaigns
    WHERE campaignId = NEW.campaign_id;
    
    -- 如果不存在，抛出错误
    IF campaign_exists = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Invalid campaign_id: Campaign does not exist in campaigns table';
    END IF;
END //

DELIMITER ;

-- 8. 添加审计日志表（可选，用于跟踪数据变更）
CREATE TABLE IF NOT EXISTS audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    table_name VARCHAR(64) NOT NULL,
    operation VARCHAR(20) NOT NULL,
    record_id INT,
    old_value TEXT,
    new_value TEXT,
    user VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_table_operation (table_name, operation),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. 创建审计触发器（可选）
DELIMITER //

CREATE TRIGGER trg_audit_campaign_association_delete
AFTER DELETE ON strategy_template_campaigns
FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, operation, record_id, old_value, user)
    VALUES (
        'strategy_template_campaigns',
        'DELETE',
        OLD.id,
        CONCAT('template_id:', OLD.template_id, ', campaign_id:', OLD.campaign_id),
        USER()
    );
END //

DELIMITER ;

-- 10. 使用说明
-- ============================================
-- 手动执行数据清理：
--     CALL sp_cleanup_invalid_campaign_associations();
--
-- 查看无效关联：
--     SELECT * FROM v_invalid_campaign_associations;
--
-- 查看审计日志：
--     SELECT * FROM audit_log WHERE table_name = 'strategy_template_campaigns' ORDER BY created_at DESC LIMIT 100;
--
-- 禁用触发器（如果需要）：
--     DROP TRIGGER IF EXISTS trg_check_campaign_exists_before_insert;
--     DROP TRIGGER IF EXISTS trg_audit_campaign_association_delete;
--
-- 删除事件（如果需要）：
--     DROP EVENT IF EXISTS evt_daily_cleanup_invalid_associations;
-- ============================================
