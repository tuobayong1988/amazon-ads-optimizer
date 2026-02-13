# 测试环境部署指南

## 1. 概述

本文档描述如何在测试环境中部署和验证Amazon广告优化系统的新版本。

**目标:**
- 在测试环境执行数据库迁移
- 验证所有新功能的正常运行
- 进行性能测试和回归测试
- 确保系统稳定性

---

## 2. 前置条件

### 2.1. 环境要求

- Node.js 22.x
- MySQL 8.0+
- 测试数据库(与生产环境隔离)
- 测试Amazon Ads账户

### 2.2. 备份

**⚠️ 重要:** 在执行任何迁移前,必须备份测试数据库!

```bash
# 备份数据库
./scripts/backup-database.sh test

# 验证备份文件
ls -lh backups/
```

---

## 3. 部署步骤

### 3.1. 拉取最新代码

```bash
git pull origin main
git log --oneline -10  # 查看最近的提交
```

### 3.2. 安装依赖

```bash
pnpm install
```

### 3.3. 配置环境变量

编辑 `.env.test` 文件:

```bash
# 数据库配置(测试环境)
DATABASE_URL=mysql://user:password@test-db-host:3306/ads_optimizer_test

# Amazon Ads API(测试账户)
AMAZON_ADS_CLIENT_ID=your_test_client_id
AMAZON_ADS_CLIENT_SECRET=your_test_client_secret
AMAZON_ADS_REFRESH_TOKEN=your_test_refresh_token

# 其他配置
NODE_ENV=test
PORT=3001
```

### 3.4. 执行数据库迁移

```bash
# 1. 执行迁移脚本
./scripts/run-migration.sh

# 2. 验证迁移结果
pnpm tsx scripts/verify-migration.ts
```

**预期输出:**

```
开始验证数据库迁移...

1. 检查新表是否存在...
   ✅ organizations 表存在
   ✅ organization_members 表存在
   ✅ subscriptions 表存在
   ✅ api_keys 表存在
   ✅ usage_logs 表存在
   ✅ ml_models 表存在
   ✅ ab_experiments 表存在
   ✅ ab_experiment_groups 表存在

2. 检查现有表的organizationId字段...
   ✅ campaigns.organizationId 字段存在
   ✅ ad_groups.organizationId 字段存在
   ✅ keywords.organizationId 字段存在
   ✅ performance_groups.organizationId 字段存在

3. 检查默认组织...
   ✅ 默认组织已创建: Default Organization

4. 检查数据完整性...
   ✅ 所有广告活动已关联组织

5. 检查索引...
   ✅ 找到 8 个组织相关索引

✅ 数据库迁移验证完成!
```

### 3.5. 填充测试数据

```bash
# 填充ML训练数据
pnpm tsx scripts/seed-ml-training-data.ts all

# 验证数据
pnpm tsx scripts/seed-ml-training-data.ts report
```

### 3.6. 构建和启动应用

```bash
# 构建前端
pnpm run build

# 启动服务器
pnpm run start
```

应用将在 `http://localhost:3001` 启动。

---

## 4. 功能测试清单

### 4.1. 基础功能测试

- [ ] 用户登录和认证
- [ ] 广告账户切换
- [ ] 数据同步功能
- [ ] 广告活动列表展示

### 4.2. 新功能测试

#### ML预算优化
- [ ] 访问 `/optimization-center`
- [ ] 切换到"ML预算优化"标签
- [ ] 选择优化目标(最大化销售/目标ACoS/目标ROAS)
- [ ] 点击"重新计算"按钮
- [ ] 验证预算分配建议是否正确显示
- [ ] 验证优化可视化图表是否正常渲染

#### 智能洞察
- [ ] 访问 `/campaigns`
- [ ] 验证SmartInsights组件是否显示
- [ ] 验证AI建议是否根据广告活动数据生成
- [ ] 点击"应用建议"按钮,验证功能

#### 策略自定义
- [ ] 访问 `/strategy-center`
- [ ] 验证策略自定义编辑器是否显示
- [ ] 创建一个自定义策略
- [ ] 编辑现有策略
- [ ] 保存并应用策略

#### 组织管理
- [ ] 访问 `/settings`
- [ ] 切换到"组织管理"标签
- [ ] 验证组织信息是否正确显示
- [ ] 邀请新成员(使用测试邮箱)
- [ ] 验证成员列表是否更新
- [ ] 移除成员

#### 趋势预测和异常检测
- [ ] 访问任意性能组详情页
- [ ] 启用"趋势预测"开关
- [ ] 验证7天预测数据是否显示
- [ ] 启用"异常检测"开关
- [ ] 验证异常点是否标记

---

## 5. 性能测试

### 5.1. 响应时间测试

使用 `ab` (Apache Bench) 进行压力测试:

```bash
# 测试首页响应时间
ab -n 1000 -c 10 http://localhost:3001/

# 测试API响应时间
ab -n 100 -c 5 http://localhost:3001/api/campaigns
```

**性能指标:**
- P50响应时间 < 200ms
- P95响应时间 < 500ms
- P99响应时间 < 1000ms

### 5.2. 数据库查询性能

```bash
# 启用慢查询日志
mysql> SET GLOBAL slow_query_log = 'ON';
mysql> SET GLOBAL long_query_time = 0.5;

# 查看慢查询
mysql> SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;
```

### 5.3. 内存和CPU使用率

```bash
# 监控服务器资源使用
top -p $(pgrep -f "node.*index.js")

# 或使用htop
htop -p $(pgrep -f "node.*index.js")
```

**资源限制:**
- CPU使用率 < 70%
- 内存使用率 < 80%

---

## 6. 回归测试

### 6.1. 自动化测试

```bash
# 运行所有测试
pnpm test

# 运行集成测试
pnpm test tests/integration/

# 生成测试覆盖率报告
pnpm test:coverage
```

### 6.2. 手动回归测试

验证以下核心功能未受影响:

- [ ] 广告活动创建和编辑
- [ ] 关键词管理
- [ ] 出价调整
- [ ] 预算管理
- [ ] 报表生成
- [ ] 数据导出

---

## 7. 问题排查

### 7.1. 数据库迁移失败

**症状:** 迁移脚本执行失败或验证不通过

**排查步骤:**
1. 检查数据库连接配置
2. 查看MySQL错误日志
3. 验证用户权限
4. 回滚并重新执行迁移

```bash
# 回滚迁移
mysql -u user -p ads_optimizer_test < backups/backup_YYYYMMDD_HHMMSS.sql

# 重新执行
./scripts/run-migration.sh
```

### 7.2. API调用失败

**症状:** 前端显示"加载失败"或"服务器错误"

**排查步骤:**
1. 检查浏览器控制台错误
2. 查看服务器日志
3. 验证TRPC路由是否正确注册
4. 测试API端点

```bash
# 查看服务器日志
tail -f logs/server.log

# 测试API端点
curl -X POST http://localhost:3001/api/trpc/mlOptimization.allocateBudget \
  -H "Content-Type: application/json" \
  -d '{"accountId": 1, "totalBudget": 1000, "objective": "maximize_sales"}'
```

### 7.3. 前端组件未显示

**症状:** 新功能的UI组件不显示或显示空白

**排查步骤:**
1. 检查浏览器控制台是否有React错误
2. 验证组件导入路径
3. 检查props传递是否正确
4. 清除浏览器缓存并重新加载

---

## 8. 测试完成标准

在进入Staging环境部署前,必须满足以下条件:

- ✅ 数据库迁移验证100%通过
- ✅ 所有新功能测试通过
- ✅ 性能测试指标达标
- ✅ 回归测试无重大问题
- ✅ 无P0/P1级别的bug
- ✅ 测试报告已生成并审核

---

## 9. 下一步

测试环境验证完成后,进入**阶段3: Staging环境部署**。
