# 数据库备份策略

## 概述

本文档描述了Amazon Ads Optimizer系统的数据库备份和恢复策略。

## RDS自动备份配置

### 当前配置

由于系统使用Elastic Beanstalk环境变量中的`DATABASE_URL`连接外部数据库,需要根据实际数据库类型配置备份策略。

### 如果使用RDS数据库

#### 1. 启用自动备份

```bash
# 查看当前RDS实例
aws rds describe-db-instances --region us-east-1

# 修改RDS实例启用自动备份
aws rds modify-db-instance \
  --db-instance-identifier your-db-instance-id \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --region us-east-1
```

**配置说明**:
- `backup-retention-period`: 备份保留天数 (1-35天,推荐7天)
- `preferred-backup-window`: 备份时间窗口 (UTC时间,选择业务低峰期)

#### 2. 创建手动快照

```bash
# 创建数据库快照
aws rds create-db-snapshot \
  --db-instance-identifier your-db-instance-id \
  --db-snapshot-identifier amazon-ads-optimizer-snapshot-$(date +%Y%m%d-%H%M%S) \
  --region us-east-1

# 查看快照状态
aws rds describe-db-snapshots \
  --db-instance-identifier your-db-instance-id \
  --region us-east-1
```

#### 3. 配置快照复制(跨区域备份)

```bash
# 复制快照到其他区域
aws rds copy-db-snapshot \
  --source-db-snapshot-identifier arn:aws:rds:us-east-1:ACCOUNT_ID:snapshot:snapshot-name \
  --target-db-snapshot-identifier amazon-ads-optimizer-backup-us-west-2 \
  --source-region us-east-1 \
  --region us-west-2
```

### 如果使用TiDB Cloud

TiDB Cloud提供自动备份功能:

1. 登录TiDB Cloud控制台
2. 选择集群 > 备份设置
3. 配置自动备份:
   - 备份频率: 每天
   - 备份时间: 业务低峰期(如凌晨3点)
   - 保留期限: 7天
4. 启用PITR(Point-in-Time Recovery): 保留7天的binlog

## 备份策略

### 自动备份计划

| 备份类型 | 频率 | 保留期限 | 备份时间 |
|---------|------|---------|---------|
| 全量备份 | 每天 | 7天 | 凌晨3:00 UTC |
| 增量备份 | 每小时 | 24小时 | 整点 |
| 手动快照 | 部署前 | 30天 | 按需 |
| 跨区域备份 | 每周 | 30天 | 周日凌晨 |

### 备份内容

**关键数据表**:
- `users`: 用户账号信息
- `adAccounts`: 广告账户配置
- `campaigns`: 广告活动数据
- `dailyPerformance`: 每日绩效数据
- `performanceGroups`: 优化目标分组
- `biddingLogs`: 出价调整历史
- `amazonApiCredentials`: API凭证(加密存储)

**可重建数据**(优先级较低):
- `dataSyncJobs`: 同步任务记录
- `notificationHistory`: 通知历史
- `auditLogs`: 审计日志

## 备份脚本

### MySQL/RDS备份脚本

创建 `scripts/backup-database.sh`:

```bash
#!/bin/bash

# 数据库备份脚本
# 用于MySQL/RDS数据库

set -e

# 配置
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-amazon_ads_optimizer}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD}"
BACKUP_DIR="/home/ubuntu/backups/database"
S3_BUCKET="s3://amazon-ads-optimizer-backups"
RETENTION_DAYS=7

# 创建备份目录
mkdir -p $BACKUP_DIR

# 生成备份文件名
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup-$TIMESTAMP.sql.gz"

echo "开始备份数据库..."
echo "时间: $(date)"
echo "数据库: $DB_NAME"
echo "备份文件: $BACKUP_FILE"

# 执行备份
mysqldump \
  --host=$DB_HOST \
  --port=$DB_PORT \
  --user=$DB_USER \
  --password=$DB_PASSWORD \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  --databases $DB_NAME \
  | gzip > $BACKUP_FILE

# 检查备份文件
if [ -f "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "备份完成! 文件大小: $SIZE"
else
  echo "备份失败!"
  exit 1
fi

# 上传到S3
if [ -n "$S3_BUCKET" ]; then
  echo "上传备份到S3..."
  aws s3 cp $BACKUP_FILE $S3_BUCKET/database/$(basename $BACKUP_FILE)
  echo "S3上传完成"
fi

# 清理旧备份
echo "清理超过 $RETENTION_DAYS 天的旧备份..."
find $BACKUP_DIR -name "backup-*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "备份任务完成!"
```

### 使用cron定时备份

```bash
# 编辑crontab
crontab -e

# 添加每天凌晨3点备份
0 3 * * * /home/ubuntu/amazon-ads-optimizer/scripts/backup-database.sh >> /var/log/database-backup.log 2>&1

# 添加每周日跨区域备份
0 4 * * 0 /home/ubuntu/amazon-ads-optimizer/scripts/backup-to-s3.sh >> /var/log/s3-backup.log 2>&1
```

## 数据恢复

### 从RDS快照恢复

#### 1. 恢复到新实例

```bash
# 从快照创建新的RDS实例
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier amazon-ads-optimizer-restored \
  --db-snapshot-identifier amazon-ads-optimizer-snapshot-20260213 \
  --db-instance-class db.t3.medium \
  --region us-east-1

# 等待实例可用
aws rds wait db-instance-available \
  --db-instance-identifier amazon-ads-optimizer-restored \
  --region us-east-1

# 获取新实例的连接信息
aws rds describe-db-instances \
  --db-instance-identifier amazon-ads-optimizer-restored \
  --query 'DBInstances[0].Endpoint' \
  --region us-east-1
```

#### 2. 更新应用程序配置

```bash
# 更新Elastic Beanstalk环境变量
aws elasticbeanstalk update-environment \
  --environment-name Amazon-ads-optimizer-env \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,\
OptionName=DATABASE_URL,\
Value="mysql://user:pass@new-host:3306/dbname" \
  --region us-east-1
```

### 从SQL备份文件恢复

```bash
# 解压备份文件
gunzip backup-20260213-030000.sql.gz

# 恢复数据库
mysql \
  --host=$DB_HOST \
  --port=$DB_PORT \
  --user=$DB_USER \
  --password=$DB_PASSWORD \
  < backup-20260213-030000.sql

# 验证数据
mysql \
  --host=$DB_HOST \
  --port=$DB_PORT \
  --user=$DB_USER \
  --password=$DB_PASSWORD \
  --database=$DB_NAME \
  -e "SELECT COUNT(*) FROM campaigns;"
```

### Point-in-Time Recovery (PITR)

如果启用了PITR,可以恢复到任意时间点:

```bash
# 恢复到指定时间点
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier your-db-instance-id \
  --target-db-instance-identifier amazon-ads-optimizer-pitr-restored \
  --restore-time 2026-02-13T10:30:00Z \
  --region us-east-1
```

## 备份验证

### 定期验证流程

**每月验证**:
1. 选择一个最近的备份
2. 恢复到测试环境
3. 验证数据完整性
4. 测试关键功能
5. 记录验证结果

### 验证脚本

创建 `scripts/verify-backup.sh`:

```bash
#!/bin/bash

# 备份验证脚本

set -e

BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
  echo "用法: $0 <backup-file.sql.gz>"
  exit 1
fi

echo "验证备份文件: $BACKUP_FILE"

# 1. 检查文件完整性
echo "[1/4] 检查文件完整性..."
gunzip -t $BACKUP_FILE
echo "✓ 文件完整"

# 2. 检查文件大小
echo "[2/4] 检查文件大小..."
SIZE=$(stat -f%z $BACKUP_FILE 2>/dev/null || stat -c%s $BACKUP_FILE)
MIN_SIZE=$((1024 * 1024))  # 最小1MB

if [ $SIZE -lt $MIN_SIZE ]; then
  echo "✗ 文件太小,可能不完整"
  exit 1
fi
echo "✓ 文件大小正常: $(numfmt --to=iec $SIZE)"

# 3. 检查SQL内容
echo "[3/4] 检查SQL内容..."
gunzip -c $BACKUP_FILE | head -100 | grep -q "CREATE TABLE"
echo "✓ SQL内容正常"

# 4. 统计表数量
echo "[4/4] 统计表数量..."
TABLE_COUNT=$(gunzip -c $BACKUP_FILE | grep -c "CREATE TABLE" || true)
echo "✓ 包含 $TABLE_COUNT 个表"

echo ""
echo "备份验证完成! 文件可用于恢复。"
```

## 灾难恢复计划

### RTO和RPO目标

- **RTO (Recovery Time Objective)**: 4小时
- **RPO (Recovery Point Objective)**: 1小时

### 恢复优先级

**P0 - 关键**(1小时内恢复):
- 用户认证系统
- 广告账户配置
- API凭证

**P1 - 重要**(4小时内恢复):
- 广告活动数据
- 每日绩效数据
- 优化目标配置

**P2 - 一般**(24小时内恢复):
- 历史日志
- 通知记录
- 审计日志

### 恢复步骤

1. **评估影响范围** (15分钟)
   - 确定数据丢失范围
   - 识别受影响的功能

2. **选择恢复点** (15分钟)
   - 选择最近的可用备份
   - 评估数据丢失量

3. **执行恢复** (2-3小时)
   - 从快照创建新实例
   - 恢复数据库
   - 更新应用程序配置

4. **验证和测试** (30分钟)
   - 验证数据完整性
   - 测试关键功能
   - 确认系统正常

5. **切换流量** (15分钟)
   - 更新DNS或负载均衡器
   - 监控系统状态

6. **事后分析** (1-2天)
   - 记录事故详情
   - 改进备份策略
   - 更新文档

## 监控和告警

### 备份监控指标

- 备份成功率
- 备份文件大小
- 备份执行时间
- 存储空间使用率

### CloudWatch告警

```bash
# 创建备份失败告警
aws cloudwatch put-metric-alarm \
  --alarm-name database-backup-failure \
  --alarm-description "数据库备份失败" \
  --metric-name BackupJobsFailed \
  --namespace AWS/Backup \
  --statistic Sum \
  --period 86400 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:amazon-ads-optimizer-alerts \
  --region us-east-1
```

## 成本优化

### 存储成本

- RDS自动备份: 免费(等于数据库大小)
- 手动快照: $0.095/GB/月
- S3标准存储: $0.023/GB/月
- S3 Glacier: $0.004/GB/月

### 优化建议

1. **使用生命周期策略**: 自动将旧备份转移到Glacier
2. **压缩备份文件**: 使用gzip压缩,节省50-70%空间
3. **删除过期备份**: 自动清理超过保留期的备份
4. **跨区域备份**: 仅保留关键备份

### S3生命周期策略

```bash
# 创建生命周期规则
aws s3api put-bucket-lifecycle-configuration \
  --bucket amazon-ads-optimizer-backups \
  --lifecycle-configuration file://lifecycle-policy.json
```

`lifecycle-policy.json`:

```json
{
  "Rules": [
    {
      "Id": "MoveToGlacier",
      "Status": "Enabled",
      "Prefix": "database/",
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "GLACIER"
        }
      ],
      "Expiration": {
        "Days": 90
      }
    }
  ]
}
```

## 安全性

### 备份加密

- **传输加密**: 使用SSL/TLS连接数据库
- **存储加密**: 启用RDS加密和S3服务端加密
- **访问控制**: 使用IAM策略限制备份访问

### IAM策略示例

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rds:CreateDBSnapshot",
        "rds:DescribeDBSnapshots",
        "rds:RestoreDBInstanceFromDBSnapshot"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "us-east-1"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::amazon-ads-optimizer-backups/*"
    }
  ]
}
```

## 最佳实践

1. **自动化备份**: 使用脚本和cron自动执行备份
2. **多地域备份**: 至少保留一份跨区域备份
3. **定期验证**: 每月验证备份可恢复性
4. **文档化流程**: 记录备份和恢复步骤
5. **演练恢复**: 每季度进行恢复演练
6. **监控告警**: 及时发现备份失败
7. **加密保护**: 加密备份文件和传输
8. **访问控制**: 限制备份访问权限

## 故障排查

### 备份失败

**可能原因**:
- 磁盘空间不足
- 数据库连接失败
- 权限不足
- 网络问题

**解决方法**:
1. 检查磁盘空间: `df -h`
2. 测试数据库连接: `mysql -h $DB_HOST -u $DB_USER -p`
3. 检查IAM权限
4. 查看错误日志

### 恢复失败

**可能原因**:
- 备份文件损坏
- 版本不兼容
- 配置错误

**解决方法**:
1. 验证备份文件: `gunzip -t backup.sql.gz`
2. 检查MySQL版本兼容性
3. 查看恢复日志
4. 尝试其他备份文件

## 参考资源

- [AWS RDS 备份文档](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)
- [MySQL 备份和恢复](https://dev.mysql.com/doc/refman/8.0/en/backup-and-recovery.html)
- [AWS Backup 服务](https://aws.amazon.com/backup/)
