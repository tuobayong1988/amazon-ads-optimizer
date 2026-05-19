-- v785: 性能巡检优化 - 同步历史分页过滤复合索引
-- 目的：支持 SyncLogs 服务端分页、状态筛选和日期范围过滤，避免 account 维度历史日志全量扫描。
-- 注意：如生产库已存在同名索引，请跳过本迁移或先确认索引定义一致。

CREATE INDEX idx_dsj_account_created_status
ON data_sync_jobs (accountId, createdAt, status);
