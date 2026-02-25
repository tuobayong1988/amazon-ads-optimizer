-- v242: 添加模块级别的执行时间持久化字段
-- 解决部署重启导致调度状态丢失的问题
-- 存储格式: JSON {"bid":"2026-02-25T10:00:00Z","placement":"2026-02-25T08:00:00Z",...}
ALTER TABLE performance_groups ADD COLUMN module_execution_times TEXT DEFAULT NULL;
