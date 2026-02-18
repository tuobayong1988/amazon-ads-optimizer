-- 添加bidding_logs表缺失的列
-- execution_status, api_response_id, error_message

ALTER TABLE `bidding_logs` 
  ADD COLUMN IF NOT EXISTS `execution_status` enum('pending','success','failed','skipped') DEFAULT 'pending' AFTER `is_intraday_adjustment`,
  ADD COLUMN IF NOT EXISTS `api_response_id` varchar(128) DEFAULT NULL AFTER `execution_status`,
  ADD COLUMN IF NOT EXISTS `error_message` text DEFAULT NULL AFTER `api_response_id`;
