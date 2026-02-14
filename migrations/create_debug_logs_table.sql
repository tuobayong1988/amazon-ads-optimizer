-- 创建debug_logs表用于存储同步诊断日志
CREATE TABLE IF NOT EXISTS debug_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  log_type VARCHAR(50) NOT NULL COMMENT '日志类型: sync_start, api_call, db_write, sync_end, error',
  account_id INT COMMENT '店铺账号ID',
  marketplace VARCHAR(10) COMMENT '站点代码',
  sync_job_id INT COMMENT '同步任务ID',
  message TEXT NOT NULL COMMENT '日志消息',
  data JSON COMMENT '详细数据',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sync_job (sync_job_id),
  INDEX idx_account (account_id),
  INDEX idx_created (created_at),
  INDEX idx_type (log_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='同步诊断日志表';
