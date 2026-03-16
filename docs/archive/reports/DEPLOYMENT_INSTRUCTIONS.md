# 部署说明 - 同步问题诊断版本

## 版本信息

- **提交**: 23c7c15
- **分支**: main
- **日期**: 2026-02-14
- **目的**: 添加详细日志以诊断同步问题

## 更改内容

### 1. 增强同步日志

在 `server/amazonSyncService.ts` 中添加了详细的日志:

#### syncSpCampaigns方法
- ✅ 开始同步日志(显示accountId, lastSyncTime, marketplace)
- ✅ 数据库连接状态检查
- ✅ API调用前后日志
- ✅ 同步进度日志(每10个广告活动)
- ✅ 完成汇总日志
- ✅ 详细错误日志(类型、消息、堆栈、API响应)

#### syncSpCampaignsWithTracking方法
- ✅ 开始同步日志(显示accountId, lastSyncTime, syncJobId)
- ✅ 数据库连接状态检查
- ✅ API调用结果日志
- ✅ 空数组警告日志
- ✅ 完成汇总日志(显示synced, skipped, created, updated等)
- ✅ 详细错误日志

## 部署步骤

### 方法1: 使用EB CLI (推荐)

```bash
# 1. 确保在项目根目录
cd /path/to/amazon-ads-optimizer

# 2. 拉取最新代码
git pull origin main

# 3. 部署到生产环境
eb deploy amazon-ads-env-prod

# 4. 等待部署完成(约5-10分钟)
```

### 方法2: 使用AWS Console

1. 访问 [Elastic Beanstalk Console](https://console.aws.amazon.com/elasticbeanstalk)
2. 选择环境: `amazon-ads-env-prod`
3. 点击 "Upload and deploy"
4. 上传项目ZIP包或从GitHub部署

### 方法3: 自动部署(如果配置了CI/CD)

代码已推送到GitHub main分支,如果配置了自动部署,应该会自动触发。

## 部署后验证

### 1. 检查应用健康状态

```bash
eb health amazon-ads-env-prod
```

期望输出: `Ok` 或 `Green`

### 2. 查看应用日志

```bash
eb logs amazon-ads-env-prod --all
```

查找关键日志标记:
- `[同步] ========== 开始同步SP广告活动 ==========`
- `[同步WithTracking] ========== 开始同步SP广告活动(带跟踪) ==========`

### 3. 测试同步功能

1. 访问 https://www.ppcopt.com/amazon-api
2. 登录系统
3. 选择一个已授权的店铺账号
4. 点击"增量同步"或"全量同步"按钮
5. 观察同步进度

### 4. 查看同步日志

部署后,触发一次同步,然后查看日志:

```bash
eb logs amazon-ads-env-prod --all | grep -A 20 "同步"
```

**期望看到的日志**:

```
[同步WithTracking] ========== 开始同步SP广告活动(带跟踪) ==========
[同步WithTracking] 参数: { accountId: 10, lastSyncTime: null, syncJobId: 123 }
[同步WithTracking] ✅ 数据库连接成功
[同步WithTracking] 正在调用Amazon API: listSpCampaigns()...
[同步WithTracking] ✅ API调用成功,返回 X 个SP广告活动
[同步WithTracking] ========== SP广告活动同步完成 ==========
[同步WithTracking] 结果: { synced: X, skipped: Y, created: A, updated: B, ... }
```

**如果看到错误日志**:

```
[同步WithTracking] ❌ 数据库连接失败
```
或
```
[同步WithTracking] ❌ SP广告活动同步失败
[同步WithTracking] 错误类型: Error
[同步WithTracking] 错误消息: ...
[同步WithTracking] 错误堆栈: ...
```

## 诊断问题

根据日志输出,可以诊断以下问题:

### 问题1: 数据库连接失败
**日志**: `[同步WithTracking] ❌ 数据库连接失败`

**原因**: getDb()返回null

**解决方案**:
- 检查数据库连接配置
- 检查RDS实例状态
- 检查安全组规则

### 问题2: API返回空数组
**日志**: `[同步WithTracking] ⚠️ API返回空数组 - 没有SP广告活动`

**原因**: Amazon API没有返回广告活动数据

**解决方案**:
- 检查API凭证是否有效
- 检查refreshToken是否过期
- 检查profileId是否正确
- 尝试全量同步(不使用lastSyncTime)

### 问题3: API调用失败
**日志**: `[同步WithTracking] ❌ SP广告活动同步失败`
**日志**: `[同步WithTracking] API响应状态: 401`

**原因**: API凭证无效或过期

**解决方案**:
- 重新授权Amazon Ads API
- 更新refreshToken

### 问题4: 数据库写入失败
**日志**: 有API数据但synced=0

**原因**: 数据库写入时出错

**解决方案**:
- 检查数据库约束
- 检查字段映射
- 查看详细错误堆栈

## 回滚计划

如果部署后出现严重问题,可以回滚到上一个版本:

```bash
# 查看部署历史
eb appversion

# 回滚到上一个版本
eb deploy amazon-ads-env-prod --version <previous-version>
```

或者通过AWS Console:
1. 进入Elastic Beanstalk环境
2. 点击 "Application versions"
3. 选择上一个版本
4. 点击 "Deploy"

## 预期结果

部署成功后,同步功能应该:

1. ✅ 显示详细的同步日志
2. ✅ 能够诊断出同步失败的具体原因
3. ✅ 如果API和数据库都正常,应该能看到synced > 0

## 下一步

根据日志输出,确定问题根源后:

1. 如果是API问题 → 修复API凭证或调用逻辑
2. 如果是数据库问题 → 修复数据库连接或字段映射
3. 如果是增量同步问题 → 禁用增量同步或修复时间范围逻辑
4. 如果是超时问题 → 增加超时时间或优化同步逻辑

## 联系信息

如有问题,请联系:
- GitHub: https://github.com/tuobayong1988/amazon-ads-optimizer/issues
- 提交Issue时请附上完整的日志输出
