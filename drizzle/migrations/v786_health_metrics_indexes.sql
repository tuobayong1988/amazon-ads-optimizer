-- v786: 健康指标监控接口性能热修复 - optimization_events 复合索引
-- 目的：支撑 monitoring.getHealthMetrics 中按账号、事件类型、状态、动作和时间范围的健康指标查询，避免全局历史事件扫描。
-- 注意：如生产库已存在同名索引，请跳过本迁移或先确认索引定义一致。

CREATE INDEX idx_oe_health_account_cat_action_created
ON optimization_events (account_id, event_category, action_type, created_at);

CREATE INDEX idx_oe_health_account_cat_status_created
ON optimization_events (account_id, event_category, status, created_at);

CREATE INDEX idx_oe_health_cat_action_created
ON optimization_events (event_category, action_type, created_at);

CREATE INDEX idx_oe_health_cat_status_created
ON optimization_events (event_category, status, created_at);
