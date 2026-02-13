-- 多租户支持数据库迁移脚本
-- 执行日期: 2024-02-13
-- 描述: 添加组织、订阅、使用统计等多租户相关表

-- ==================== 组织表 ====================
CREATE TABLE IF NOT EXISTS organizations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  status ENUM('active', 'suspended', 'trial') DEFAULT 'trial',
  
  -- 订阅信息
  subscription_plan VARCHAR(50) DEFAULT 'free',
  subscription_status VARCHAR(50) DEFAULT 'active',
  trial_ends_at DATETIME,
  subscription_ends_at DATETIME,
  
  -- 配额
  max_users INT DEFAULT 5,
  max_ad_accounts INT DEFAULT 3,
  max_campaigns INT DEFAULT 50,
  max_api_calls_per_day INT DEFAULT 10000,
  
  -- 功能开关
  features JSON,
  
  -- 元数据
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_slug (slug),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== 组织成员表 ====================
CREATE TABLE IF NOT EXISTS organization_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('owner', 'admin', 'member', 'viewer') DEFAULT 'member',
  permissions JSON,
  invited_by INT,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_org_user (organization_id, user_id),
  INDEX idx_organization_id (organization_id),
  INDEX idx_user_id (user_id),
  
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== 订阅计划表 ====================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  
  -- 定价
  price_monthly DECIMAL(10, 2),
  price_yearly DECIMAL(10, 2),
  
  -- 配额
  max_users INT,
  max_ad_accounts INT,
  max_campaigns INT,
  max_api_calls_per_day INT,
  
  -- 功能
  features JSON,
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_slug (slug),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== 使用统计表 ====================
CREATE TABLE IF NOT EXISTS usage_stats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL,
  date DATE NOT NULL,
  
  -- 使用量
  api_calls INT DEFAULT 0,
  active_campaigns INT DEFAULT 0,
  total_spend DECIMAL(10, 2) DEFAULT 0,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_org_date (organization_id, date),
  INDEX idx_organization_id (organization_id),
  INDEX idx_date (date),
  
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== API密钥表 ====================
CREATE TABLE IF NOT EXISTS api_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(20) NOT NULL,
  permissions JSON,
  created_by INT,
  last_used_at DATETIME,
  expires_at DATETIME,
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_organization_id (organization_id),
  INDEX idx_key_prefix (key_prefix),
  INDEX idx_is_active (is_active),
  
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== 邀请表 ====================
CREATE TABLE IF NOT EXISTS invitations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  role ENUM('admin', 'member', 'viewer') DEFAULT 'member',
  token VARCHAR(255) UNIQUE NOT NULL,
  invited_by INT NOT NULL,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_organization_id (organization_id),
  INDEX idx_token (token),
  INDEX idx_email (email),
  
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== 为现有表添加organization_id ====================

-- 检查users表是否存在organization_id列
SET @dbname = DATABASE();
SET @tablename = 'users';
SET @columnname = 'organization_id';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT;')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 为users表添加索引
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_organization_id (organization_id);

-- 为ad_accounts表添加organization_id
SET @tablename = 'ad_accounts';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT;')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

ALTER TABLE ad_accounts ADD INDEX IF NOT EXISTS idx_organization_id (organization_id);

-- 为campaigns表添加organization_id
SET @tablename = 'campaigns';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT;')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

ALTER TABLE campaigns ADD INDEX IF NOT EXISTS idx_organization_id (organization_id);

-- 为performance_groups表添加organization_id
SET @tablename = 'performance_groups';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT;')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

ALTER TABLE performance_groups ADD INDEX IF NOT EXISTS idx_organization_id (organization_id);

-- ==================== 插入默认数据 ====================

-- 插入默认订阅计划
INSERT IGNORE INTO subscription_plans (name, slug, description, price_monthly, price_yearly, max_users, max_ad_accounts, max_campaigns, max_api_calls_per_day, features) VALUES
('Free', 'free', '免费版,适合个人用户试用', 0, 0, 1, 1, 10, 1000, '{}'),
('Starter', 'starter', '入门版,适合小型团队', 29, 290, 3, 3, 50, 10000, '{"basic_analytics": true}'),
('Professional', 'professional', '专业版,适合中型企业', 99, 990, 10, 10, 200, 50000, '{"basic_analytics": true, "ml_optimization": true, "smart_campaign": true, "advanced_analytics": true}'),
('Enterprise', 'enterprise', '企业版,适合大型企业', 299, 2990, 9999, 9999, 9999, 999999, '{"basic_analytics": true, "ml_optimization": true, "smart_campaign": true, "advanced_analytics": true, "api_access": true, "white_label": true, "priority_support": true}');

-- 创建默认组织(如果不存在)
INSERT IGNORE INTO organizations (id, name, slug, status, subscription_plan, max_users, max_ad_accounts, max_campaigns, max_api_calls_per_day, features)
VALUES (1, 'Default Organization', 'default', 'active', 'enterprise', 9999, 9999, 9999, 999999, '{"ml_optimization": true, "smart_campaign": true, "advanced_analytics": true, "api_access": true}');

-- 将现有数据关联到默认组织
UPDATE users SET organization_id = 1 WHERE organization_id IS NULL;
UPDATE ad_accounts SET organization_id = 1 WHERE organization_id IS NULL;
UPDATE campaigns SET organization_id = 1 WHERE organization_id IS NULL;
UPDATE performance_groups SET organization_id = 1 WHERE organization_id IS NULL;

-- ==================== 完成 ====================
SELECT '多租户数据库迁移完成!' AS message;
