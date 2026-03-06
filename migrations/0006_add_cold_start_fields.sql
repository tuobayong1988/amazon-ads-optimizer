-- Migration: 0006_add_cold_start_fields.sql
-- Description: v338 智能冷启动机制 - 添加冷启动状态追踪字段
-- Date: 2026-03-06
-- Version: v338

-- 1. 在 amazon_api_credentials 表中添加冷启动追踪字段
ALTER TABLE amazon_api_credentials
  ADD COLUMN IF NOT EXISTS last_cold_start_at DATETIME NULL DEFAULT NULL COMMENT '上次冷启动完成时间',
  ADD COLUMN IF NOT EXISTS last_cold_start_version INT NULL DEFAULT NULL COMMENT '上次冷启动时的系统版本号',
  ADD COLUMN IF NOT EXISTS cold_start_status ENUM('idle', 'running', 'completed', 'failed') DEFAULT 'idle' COMMENT '冷启动状态';

-- 2. 创建冷启动执行日志表，用于追踪每次冷启动的详细执行情况
CREATE TABLE IF NOT EXISTS cold_start_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL COMMENT '账户ID',
  trigger_reason ENUM('new_account', 'credential_refresh', 'new_marketplace', 'version_upgrade', 'manual') NOT NULL COMMENT '触发原因',
  system_version INT NOT NULL COMMENT '执行时的系统版本号',
  status ENUM('started', 'syncing', 'optimizing_historical', 'optimizing_recent', 'completed', 'failed') NOT NULL DEFAULT 'started' COMMENT '执行状态',
  
  -- 数据同步阶段统计
  sync_campaigns INT DEFAULT 0 COMMENT '同步的广告活动数',
  sync_keywords INT DEFAULT 0 COMMENT '同步的关键词数',
  sync_search_terms INT DEFAULT 0 COMMENT '同步的搜索词数',
  sync_targets INT DEFAULT 0 COMMENT '同步的定向数',
  sync_duration_ms INT DEFAULT 0 COMMENT '同步耗时(毫秒)',
  
  -- 历史数据优化阶段统计
  historical_targets_processed INT DEFAULT 0 COMMENT '历史数据优化处理的优化目标数',
  historical_negatives_added INT DEFAULT 0 COMMENT '历史数据优化添加的否定词/ASIN数',
  historical_keywords_harvested INT DEFAULT 0 COMMENT '历史数据优化收割的关键词数',
  historical_ngram_negatives INT DEFAULT 0 COMMENT '历史数据Ngram否定数',
  historical_duration_ms INT DEFAULT 0 COMMENT '历史数据优化耗时(毫秒)',
  
  -- 近期数据优化阶段统计
  recent_targets_processed INT DEFAULT 0 COMMENT '近期数据优化处理的优化目标数',
  recent_optimizations_triggered INT DEFAULT 0 COMMENT '近期数据触发的常规优化次数',
  recent_duration_ms INT DEFAULT 0 COMMENT '近期数据优化耗时(毫秒)',
  
  -- 总计
  total_duration_ms INT DEFAULT 0 COMMENT '总耗时(毫秒)',
  error_message TEXT NULL COMMENT '错误信息',
  detail JSON NULL COMMENT '详细执行日志(JSON)',
  
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL DEFAULT NULL,
  
  INDEX idx_cold_start_account (account_id),
  INDEX idx_cold_start_status (status),
  INDEX idx_cold_start_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='冷启动执行日志表';
