# 多租户SaaS架构设计

## 概述

本系统采用**共享数据库、共享Schema**的多租户架构模式,通过`organizationId`和`userId`字段实现租户隔离。

## 核心概念

### 1. 组织(Organization)
- 代表一个租户(公司/团队)
- 拥有独立的配置、用户、广告账户
- 支持订阅计划和配额管理

### 2. 用户(User)
- 属于某个组织
- 可以有不同的角色和权限
- 支持跨组织访问(通过邀请)

### 3. 数据隔离
- 所有业务表包含`organizationId`字段
- API层自动过滤数据
- 防止跨租户数据泄露

## 数据库Schema

### 组织表(organizations)

```sql
CREATE TABLE organizations (
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
);
```

### 用户表(users) - 扩展

```sql
ALTER TABLE users ADD COLUMN organization_id INT NOT NULL;
ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'member';
ALTER TABLE users ADD INDEX idx_organization_id (organization_id);
```

### 组织成员表(organization_members)

```sql
CREATE TABLE organization_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('owner', 'admin', 'member', 'viewer') DEFAULT 'member',
  permissions JSON,
  invited_by INT,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_org_user (organization_id, user_id),
  INDEX idx_organization_id (organization_id),
  INDEX idx_user_id (user_id)
);
```

### 订阅计划表(subscription_plans)

```sql
CREATE TABLE subscription_plans (
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 使用统计表(usage_stats)

```sql
CREATE TABLE usage_stats (
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
  INDEX idx_date (date)
);
```

## 数据隔离策略

### 1. 查询级隔离

所有查询自动添加`organizationId`过滤:

```typescript
// 错误示例 - 可能泄露数据
const campaigns = await db.select().from(campaigns);

// 正确示例 - 租户隔离
const campaigns = await db
  .select()
  .from(campaigns)
  .where(eq(campaigns.organizationId, ctx.user.organizationId));
```

### 2. 中间件保护

```typescript
// 租户上下文中间件
export const tenantMiddleware = async (ctx, next) => {
  if (!ctx.user) {
    throw new Error('Unauthorized');
  }
  
  // 注入租户上下文
  ctx.organizationId = ctx.user.organizationId;
  ctx.organization = await getOrganization(ctx.organizationId);
  
  // 检查组织状态
  if (ctx.organization.status === 'suspended') {
    throw new Error('Organization suspended');
  }
  
  await next();
};
```

### 3. 配额检查

```typescript
// 配额检查中间件
export const quotaMiddleware = async (ctx, next) => {
  const usage = await getUsageStats(ctx.organizationId);
  const plan = ctx.organization.subscriptionPlan;
  
  // 检查API调用配额
  if (usage.apiCallsToday >= plan.maxApiCallsPerDay) {
    throw new Error('API quota exceeded');
  }
  
  // 记录使用
  await incrementApiCalls(ctx.organizationId);
  
  await next();
};
```

## 权限管理

### 角色定义

| 角色 | 权限 |
|------|------|
| owner | 完全控制,包括删除组织 |
| admin | 管理用户、配置、广告账户 |
| member | 查看和编辑广告数据 |
| viewer | 只读访问 |

### 权限检查

```typescript
export function checkPermission(
  user: User,
  resource: string,
  action: 'read' | 'write' | 'delete'
): boolean {
  const role = user.role;
  
  // Owner有所有权限
  if (role === 'owner') return true;
  
  // Admin可以读写,但不能删除组织
  if (role === 'admin') {
    return action !== 'delete' || resource !== 'organization';
  }
  
  // Member只能读写数据
  if (role === 'member') {
    return action !== 'delete' && resource !== 'organization';
  }
  
  // Viewer只读
  if (role === 'viewer') {
    return action === 'read';
  }
  
  return false;
}
```

## 订阅管理

### 计划类型

1. **Free** - 免费版
   - 1个用户
   - 1个广告账户
   - 10个广告活动
   - 1000次API调用/天

2. **Starter** - $29/月
   - 3个用户
   - 3个广告账户
   - 50个广告活动
   - 10,000次API调用/天

3. **Professional** - $99/月
   - 10个用户
   - 10个广告账户
   - 200个广告活动
   - 50,000次API调用/天
   - ML优化功能

4. **Enterprise** - 定制
   - 无限用户
   - 无限广告账户
   - 无限广告活动
   - 无限API调用
   - 所有高级功能

### 试用期管理

```typescript
export async function checkTrialStatus(organizationId: number) {
  const org = await getOrganization(organizationId);
  
  if (org.status === 'trial') {
    const now = new Date();
    const trialEnd = new Date(org.trialEndsAt);
    
    if (now > trialEnd) {
      // 试用期结束,降级到免费版
      await updateOrganization(organizationId, {
        status: 'active',
        subscriptionPlan: 'free',
      });
      
      // 发送通知
      await sendTrialExpiredEmail(org);
    }
  }
}
```

## 迁移路径

### 从单租户到多租户

1. **添加organizationId字段**
   ```sql
   ALTER TABLE campaigns ADD COLUMN organization_id INT;
   ALTER TABLE ad_accounts ADD COLUMN organization_id INT;
   -- ... 其他表
   ```

2. **创建默认组织**
   ```sql
   INSERT INTO organizations (name, slug, status) 
   VALUES ('Default Organization', 'default', 'active');
   ```

3. **迁移现有数据**
   ```sql
   UPDATE campaigns SET organization_id = 1;
   UPDATE ad_accounts SET organization_id = 1;
   -- ... 其他表
   ```

4. **添加约束**
   ```sql
   ALTER TABLE campaigns MODIFY organization_id INT NOT NULL;
   ALTER TABLE campaigns ADD INDEX idx_organization_id (organization_id);
   ```

## 安全考虑

1. **防止租户跳跃**
   - 所有API必须验证organizationId
   - 不允许用户指定organizationId

2. **数据备份隔离**
   - 每个租户独立备份
   - 支持单租户恢复

3. **审计日志**
   - 记录所有跨租户操作
   - 监控异常访问模式

4. **速率限制**
   - 按租户限制API调用
   - 防止单个租户影响系统

## 监控指标

- 活跃组织数
- 每个组织的用户数
- API调用量(按组织)
- 存储使用量(按组织)
- 订阅转化率
- 流失率

## 最佳实践

1. **始终使用租户上下文**
   ```typescript
   const ctx = { organizationId: user.organizationId };
   ```

2. **测试数据隔离**
   - 创建多个测试组织
   - 验证无法访问其他组织数据

3. **性能优化**
   - 在organizationId上建立索引
   - 使用分区表(大规模场景)

4. **文档化租户限制**
   - 清晰说明各计划的限制
   - 提供升级路径
