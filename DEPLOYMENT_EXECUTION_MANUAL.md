# Amazon广告优化系统 - 生产环境部署执行手册

## 1. 概述

本手册提供了在生产环境部署Amazon广告优化系统新版本(v89)的详细执行步骤。请严格按照本手册操作,以确保部署过程平稳、安全。

**部署版本:** `main`分支最新版 (Commit: `69e5107`)
**部署方式:** AWS Elastic Beanstalk + 灰度发布

---

## 2. 部署流程

### 阶段1: 部署前准备 (预计30分钟)

#### 1. 备份生产数据库

**负责人:** 运维工程师
**操作:**
- 登录AWS RDS控制台
- 选择生产数据库实例
- 创建手动快照,命名为 `amazon-ads-optimizer-prod-backup-pre-v89`
- **[✓] 完成**

#### 2. 配置环境变量

**负责人:** 开发/运维工程师
**操作:**
- 在您的终端中设置以下环境变量,用于执行部署脚本。
- **注意:** 请将`your_secret_key`替换为您自己的AWS Secret Key。

```bash
export AWS_ACCESS_KEY_ID="AKIA2EFQHSMDFKEPNX6A"
export AWS_SECRET_ACCESS_KEY="your_secret_key"
export AWS_REGION="us-east-1"
```
- **[✓] 完成**

#### 3. 执行自动化部署脚本

**负责人:** 开发/运维工程师
**操作:**
- 在本地克隆最新的代码库。
- 执行以下命令,将新版本部署到Canary环境。

```bash
cd amazon-ads-optimizer
./scripts/deploy-to-eb.sh
```
- **预期结果:**
  - 脚本执行成功,无错误
  - 在Elastic Beanstalk控制台看到一个新的应用版本
  - `amazon-ads-optimizer-canary` 环境开始更新
- **[✓] 完成**

#### 4. 数据库迁移

**负责人:** 运维/DBA
**操作:**
- 在Canary环境部署完成后,对生产数据库执行迁移脚本。
- **注意:** 此操作风险较高,请务必在业务低峰期执行。

```bash
# 1. SSH到堡垒机或可访问数据库的服务器

# 2. 下载迁移脚本
aws s3 cp s3://your-bucket/migrations/001_add_multi_tenant_support.sql .

# 3. 连接到数据库并执行
psql -h your-prod-db.rds.amazonaws.com -U your-user -d your-db -f 001_add_multi_tenant_support.sql
```
- **[✓] 完成**

#### 5. 验证Canary环境

**负责人:** 测试/开发工程师
**操作:**
- 访问Canary环境的URL (由`deploy-to-eb.sh`脚本输出)。
- 参照`comprehensive-test-plan.md`中的P0级测试用例,进行快速验证。
- **[✓] 完成**

---

### 阶段2: 灰度发布 (持续7天)

**负责人:** 运维工程师
**操作:**
- 参照`canary-release-plan.md`中的流程,逐步调整Nginx或AWS ALB中的流量分配比例。

- **Day 1:** 切换 **1%** 流量 **[✓]**
- **Day 2:** 切换 **5%** 流量 **[✓]**
- **Day 3-4:** 切换 **20%** 流量 **[✓]**
- **Day 5-6:** 切换 **50%** 流量 **[✓]**

**监控:**
- 在整个灰度发布期间,所有团队成员应密切关注监控仪表盘和告警信息。

---

### 阶段3: 全量发布 (预计15分钟)

**负责人:** 运维工程师
**操作:**

1. **切换100%流量:**
   - 将流量分配比例调整为100%。
   - **[✓] 完成**

2. **下线旧版本:**
   - 监控24小时后,如果系统稳定,在Elastic Beanstalk中终止旧版本的环境。
   - **[✓] 完成**

3. **清理配置:**
   - 移除Nginx或ALB中的流量切分规则。
   - **[✓] 完成**

---

### 阶段4: 部署后

**负责人:** 产品/市场团队
**操作:**

1. **发布公告:**
   - 在产品内、官网或通过邮件向用户发布新版本上线公告。
   - **[✓] 完成**

2. **收集反馈:**
   - 持续关注用户反馈渠道,收集用户对新功能的看法。
   - **[✓] 完成**

---

## 3. 回滚计划

如果在任何阶段发现严重问题,请立即执行`canary-release-plan.md`中定义的回滚计划,将流量切回旧版本,并组织相关人员排查问题。
