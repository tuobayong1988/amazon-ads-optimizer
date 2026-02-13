# CloudWatch 监控和告警配置

## 概述

本文档描述了Amazon Ads Optimizer系统的CloudWatch监控和告警配置。

## 监控指标

### 1. 环境健康指标

| 指标名称 | 命名空间 | 描述 | 告警阈值 |
|---------|---------|------|---------|
| EnvironmentHealth | AWS/ElasticBeanstalk | 环境健康状态 (0=OK, 5=Warning, 10=Degraded, 15=Severe, 20=Unknown) | > 15 |
| CPUUtilization | AWS/ElasticBeanstalk | CPU使用率百分比 | > 80% |
| MemoryUtilization | AWS/ElasticBeanstalk | 内存使用率百分比 | > 85% |

### 2. 应用程序指标

| 指标名称 | 命名空间 | 描述 | 告警阈值 |
|---------|---------|------|---------|
| ApplicationRequests5xx | AWS/ElasticBeanstalk | 5xx错误请求数 | > 10次/5分钟 |
| ApplicationRequests4xx | AWS/ElasticBeanstalk | 4xx错误请求数 | 监控但不告警 |
| ApplicationLatencyP99 | AWS/ElasticBeanstalk | 99分位响应延迟 | > 3000ms |

### 3. 数据库指标 (RDS)

| 指标名称 | 命名空间 | 描述 | 告警阈值 |
|---------|---------|------|---------|
| CPUUtilization | AWS/RDS | 数据库CPU使用率 | > 80% |
| FreeableMemory | AWS/RDS | 可用内存 | < 500MB |
| DatabaseConnections | AWS/RDS | 数据库连接数 | > 80% 最大连接数 |

## 告警配置

### 自动配置脚本

使用提供的脚本自动配置所有告警:

```bash
# 1. 编辑脚本,修改邮箱地址
vi aws-cloudwatch-setup.sh
# 修改: EMAIL_ADDRESS="your-email@example.com"

# 2. 配置AWS凭证
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"
export AWS_DEFAULT_REGION="us-east-1"

# 3. 运行配置脚本
./aws-cloudwatch-setup.sh
```

### 手动配置步骤

#### 1. 创建SNS主题

```bash
aws sns create-topic \
  --name amazon-ads-optimizer-alerts \
  --region us-east-1
```

#### 2. 订阅邮件通知

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:ACCOUNT_ID:amazon-ads-optimizer-alerts \
  --protocol email \
  --notification-endpoint your-email@example.com \
  --region us-east-1
```

**重要**: 检查邮箱并确认订阅!

#### 3. 创建CPU告警

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name amazon-ads-optimizer-high-cpu \
  --alarm-description "CPU使用率超过80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=EnvironmentName,Value=Amazon-ads-optimizer-env \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:amazon-ads-optimizer-alerts \
  --region us-east-1
```

#### 4. 创建环境健康告警

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name amazon-ads-optimizer-environment-health \
  --alarm-description "环境健康状态异常" \
  --metric-name EnvironmentHealth \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 60 \
  --threshold 15 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=EnvironmentName,Value=Amazon-ads-optimizer-env \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:amazon-ads-optimizer-alerts \
  --region us-east-1
```

## 查看监控数据

### 通过AWS控制台

1. 访问CloudWatch控制台: https://console.aws.amazon.com/cloudwatch/
2. 选择区域: us-east-1
3. 导航到 "告警" > "所有告警"
4. 查看告警状态和历史记录

### 通过AWS CLI

```bash
# 查看所有告警
aws cloudwatch describe-alarms --region us-east-1

# 查看特定告警
aws cloudwatch describe-alarms \
  --alarm-names amazon-ads-optimizer-high-cpu \
  --region us-east-1

# 查看告警历史
aws cloudwatch describe-alarm-history \
  --alarm-name amazon-ads-optimizer-high-cpu \
  --max-records 10 \
  --region us-east-1
```

### 查看指标数据

```bash
# 查看CPU使用率
aws cloudwatch get-metric-statistics \
  --namespace AWS/ElasticBeanstalk \
  --metric-name CPUUtilization \
  --dimensions Name=EnvironmentName,Value=Amazon-ads-optimizer-env \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average \
  --region us-east-1
```

## 自定义应用程序指标

### 发送自定义指标

在应用程序中添加CloudWatch指标:

```typescript
import { CloudWatch } from 'aws-sdk';

const cloudwatch = new CloudWatch({ region: 'us-east-1' });

// 发送数据同步成功率指标
await cloudwatch.putMetricData({
  Namespace: 'AmazonAdsOptimizer',
  MetricData: [{
    MetricName: 'DailySyncSuccessRate',
    Value: successRate,
    Unit: 'Percent',
    Timestamp: new Date(),
    Dimensions: [{
      Name: 'Environment',
      Value: 'Production'
    }]
  }]
}).promise();
```

### 为自定义指标创建告警

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name amazon-ads-optimizer-sync-failure \
  --alarm-description "数据同步成功率低于90%" \
  --metric-name DailySyncSuccessRate \
  --namespace AmazonAdsOptimizer \
  --statistic Average \
  --period 3600 \
  --threshold 90 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=Environment,Value=Production \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:amazon-ads-optimizer-alerts \
  --region us-east-1
```

## 日志监控

### 配置日志组

Elastic Beanstalk自动创建日志组:
- `/aws/elasticbeanstalk/Amazon-ads-optimizer-env/var/log/eb-engine.log`
- `/aws/elasticbeanstalk/Amazon-ads-optimizer-env/var/log/web.stdout.log`

### 创建日志指标过滤器

监控应用程序错误:

```bash
# 创建指标过滤器
aws logs put-metric-filter \
  --log-group-name /aws/elasticbeanstalk/Amazon-ads-optimizer-env/var/log/web.stdout.log \
  --filter-name ErrorCount \
  --filter-pattern "[ERROR]" \
  --metric-transformations \
    metricName=ApplicationErrors,\
metricNamespace=AmazonAdsOptimizer,\
metricValue=1,\
defaultValue=0 \
  --region us-east-1

# 为日志错误创建告警
aws cloudwatch put-metric-alarm \
  --alarm-name amazon-ads-optimizer-application-errors \
  --alarm-description "应用程序错误数超过10次/小时" \
  --metric-name ApplicationErrors \
  --namespace AmazonAdsOptimizer \
  --statistic Sum \
  --period 3600 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:amazon-ads-optimizer-alerts \
  --region us-east-1
```

## 监控仪表板

### 创建CloudWatch仪表板

```bash
aws cloudwatch put-dashboard \
  --dashboard-name amazon-ads-optimizer \
  --dashboard-body file://cloudwatch-dashboard.json \
  --region us-east-1
```

### 仪表板配置示例

创建 `cloudwatch-dashboard.json`:

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ElasticBeanstalk", "CPUUtilization", {"stat": "Average"}],
          [".", "MemoryUtilization", {"stat": "Average"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "系统资源使用率",
        "yAxis": {
          "left": {
            "min": 0,
            "max": 100
          }
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ElasticBeanstalk", "EnvironmentHealth", {"stat": "Average"}]
        ],
        "period": 60,
        "stat": "Average",
        "region": "us-east-1",
        "title": "环境健康状态"
      }
    }
  ]
}
```

## 告警响应流程

### 1. CPU使用率过高

**可能原因**:
- 数据同步任务并发过高
- 数据库查询效率低
- 内存泄漏导致GC频繁

**处理步骤**:
1. 检查应用程序日志
2. 查看数据库慢查询
3. 考虑扩容实例类型
4. 优化代码和查询

### 2. 环境健康状态异常

**可能原因**:
- 应用程序崩溃
- 数据库连接失败
- 外部API超时

**处理步骤**:
1. 检查Elastic Beanstalk事件日志
2. 查看应用程序错误日志
3. 验证数据库连接
4. 检查Amazon Ads API状态

### 3. 5xx错误率过高

**可能原因**:
- 代码bug
- 数据库连接池耗尽
- 第三方API故障

**处理步骤**:
1. 查看错误日志定位问题
2. 检查数据库连接数
3. 验证Amazon Ads API可用性
4. 回滚到上一个稳定版本

## 成本优化

### 监控成本

CloudWatch定价:
- 前10个指标免费
- 额外指标: $0.30/指标/月
- 告警: $0.10/告警/月
- 日志存储: $0.50/GB/月

### 优化建议

1. **合理设置指标采集频率**: 非关键指标使用5分钟或更长周期
2. **日志保留策略**: 设置日志保留期限(如30天)
3. **使用指标过滤**: 只采集必要的日志指标
4. **定期清理**: 删除不再使用的告警和仪表板

## 维护和更新

### 定期检查

- **每周**: 查看告警历史,识别误报
- **每月**: 审查监控指标,调整阈值
- **每季度**: 评估监控覆盖范围,添加新指标

### 更新告警阈值

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name amazon-ads-optimizer-high-cpu \
  --threshold 85 \
  --region us-east-1
```

### 删除告警

```bash
aws cloudwatch delete-alarms \
  --alarm-names amazon-ads-optimizer-high-cpu \
  --region us-east-1
```

## 故障排查

### 告警未触发

1. 检查告警配置是否正确
2. 验证SNS订阅是否已确认
3. 查看CloudWatch指标是否有数据

### 收不到邮件通知

1. 检查邮箱垃圾邮件文件夹
2. 验证SNS订阅状态
3. 确认邮箱地址正确

### 指标数据缺失

1. 检查Elastic Beanstalk环境是否运行
2. 验证CloudWatch代理配置
3. 查看IAM权限是否正确

## 参考资源

- [AWS CloudWatch 文档](https://docs.aws.amazon.com/cloudwatch/)
- [Elastic Beanstalk 监控](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/health-enhanced.html)
- [CloudWatch 定价](https://aws.amazon.com/cloudwatch/pricing/)
