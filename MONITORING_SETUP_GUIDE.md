# 监控和告警配置指南

**目标环境:** amazon-ads-env-prod  
**应用:** amazon-ads-optimizer  
**创建日期:** 2026-02-13

---

## ⚠️ 权限说明

当前IAM用户(manus-deploy)没有CloudWatch告警配置权限。需要管理员账户执行以下配置,或为manus-deploy用户添加以下权限:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:DeleteAlarms",
        "cloudwatch:DescribeAlarms",
        "sns:CreateTopic",
        "sns:Subscribe",
        "sns:Publish"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 📊 推荐的CloudWatch告警配置

### 1. 应用健康检查告警

**告警名称:** `amazon-ads-optimizer-health-check-failed`  
**描述:** 当应用健康检查失败时触发告警

**AWS CLI命令:**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "amazon-ads-optimizer-health-check-failed" \
  --alarm-description "Alert when application health check fails" \
  --metric-name InstanceHealth \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 300 \
  --threshold 15 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=EnvironmentName,Value=amazon-ads-env-prod \
  --alarm-actions arn:aws:sns:us-east-1:696154297094:ops-alerts \
  --treat-missing-data notBreaching
```

**说明:**
- 监控指标: InstanceHealth (实例健康状态)
- 阈值: 健康分数 < 15 (满分25)
- 评估周期: 2个连续5分钟周期
- 触发条件: 连续10分钟健康状态不佳

### 2. HTTP 5xx错误率告警

**告警名称:** `amazon-ads-optimizer-5xx-errors`  
**描述:** 当HTTP 5xx错误率超过5%时触发告警

**AWS CLI命令:**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "amazon-ads-optimizer-5xx-errors" \
  --alarm-description "Alert when 5xx error rate exceeds 5%" \
  --metric-name ApplicationRequests5xx \
  --namespace AWS/ElasticBeanstalk \
  --statistic Sum \
  --period 300 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=EnvironmentName,Value=amazon-ads-env-prod \
  --alarm-actions arn:aws:sns:us-east-1:696154297094:ops-alerts \
  --treat-missing-data notBreaching
```

**说明:**
- 监控指标: ApplicationRequests5xx (5xx错误数)
- 阈值: 5分钟内超过50个5xx错误
- 评估周期: 2个连续5分钟周期

### 3. 响应时间告警

**告警名称:** `amazon-ads-optimizer-high-latency`  
**描述:** 当P99响应时间超过2秒时触发告警

**AWS CLI命令:**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "amazon-ads-optimizer-high-latency" \
  --alarm-description "Alert when P99 latency exceeds 2 seconds" \
  --metric-name ApplicationLatencyP99 \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 300 \
  --threshold 2 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 \
  --dimensions Name=EnvironmentName,Value=amazon-ads-env-prod \
  --alarm-actions arn:aws:sns:us-east-1:696154297094:ops-alerts \
  --treat-missing-data notBreaching
```

**说明:**
- 监控指标: ApplicationLatencyP99 (P99延迟)
- 阈值: 2秒
- 评估周期: 3个连续5分钟周期(15分钟)

### 4. CPU使用率告警

**告警名称:** `amazon-ads-optimizer-high-cpu`  
**描述:** 当CPU使用率持续超过80%时触发告警

**AWS CLI命令:**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "amazon-ads-optimizer-high-cpu" \
  --alarm-description "Alert when CPU usage exceeds 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/EC2 \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 \
  --dimensions Name=EnvironmentName,Value=amazon-ads-env-prod \
  --alarm-actions arn:aws:sns:us-east-1:696154297094:ops-alerts
```

**说明:**
- 监控指标: CPUUtilization (CPU使用率)
- 阈值: 80%
- 评估周期: 3个连续5分钟周期(15分钟)

### 5. 数据库连接数告警

**告警名称:** `amazon-ads-optimizer-db-connections`  
**描述:** 当数据库连接数接近最大值时触发告警

**AWS CLI命令:**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "amazon-ads-optimizer-db-connections" \
  --alarm-description "Alert when database connections exceed 80% of max" \
  --metric-name DatabaseConnections \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=DBInstanceIdentifier,Value=amazon-ads-optimizer-db \
  --alarm-actions arn:aws:sns:us-east-1:696154297094:ops-alerts
```

**说明:**
- 监控指标: DatabaseConnections (数据库连接数)
- 阈值: 80个连接(假设max_connections=100)
- 评估周期: 2个连续5分钟周期

### 6. 磁盘空间告警

**告警名称:** `amazon-ads-optimizer-low-disk-space`  
**描述:** 当磁盘使用率超过85%时触发告警

**AWS CLI命令:**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "amazon-ads-optimizer-low-disk-space" \
  --alarm-description "Alert when disk usage exceeds 85%" \
  --metric-name RootFilesystemUtil \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 300 \
  --threshold 85 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=EnvironmentName,Value=amazon-ads-env-prod \
  --alarm-actions arn:aws:sns:us-east-1:696154297094:ops-alerts
```

---

## 📧 SNS主题配置

### 创建告警通知主题

**1. 创建SNS主题:**
```bash
aws sns create-topic \
  --name ops-alerts \
  --region us-east-1
```

**2. 订阅邮箱:**
```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:696154297094:ops-alerts \
  --protocol email \
  --notification-endpoint your-email@example.com
```

**3. 确认订阅:**
收到邮件后点击确认链接。

---

## 📈 CloudWatch Dashboard配置

### 创建自定义仪表板

**仪表板名称:** `amazon-ads-optimizer-dashboard`

**AWS CLI命令:**
```bash
aws cloudwatch put-dashboard \
  --dashboard-name amazon-ads-optimizer-dashboard \
  --dashboard-body file:///path/to/dashboard-config.json
```

**dashboard-config.json示例:**
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ElasticBeanstalk", "EnvironmentHealth", {"stat": "Average"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Environment Health",
        "yAxis": {"left": {"min": 0, "max": 25}}
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ElasticBeanstalk", "ApplicationRequests2xx", {"stat": "Sum"}],
          [".", "ApplicationRequests4xx", {"stat": "Sum"}],
          [".", "ApplicationRequests5xx", {"stat": "Sum"}]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "us-east-1",
        "title": "HTTP Requests by Status Code"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ElasticBeanstalk", "ApplicationLatencyP99", {"stat": "Average"}],
          [".", "ApplicationLatencyP90", {"stat": "Average"}],
          [".", "ApplicationLatencyP50", {"stat": "Average"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Application Latency"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/EC2", "CPUUtilization", {"stat": "Average"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "CPU Utilization"
      }
    }
  ]
}
```

---

## 🔍 日志监控配置

### CloudWatch Logs Insights查询

**1. 查找错误日志:**
```
fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 100
```

**2. 查找慢查询:**
```
fields @timestamp, @message
| filter @message like /Query took/
| parse @message /Query took (?<duration>\d+)ms/
| filter duration > 1000
| sort duration desc
| limit 50
```

**3. 统计HTTP状态码分布:**
```
fields @timestamp
| filter @message like /HTTP/
| parse @message /HTTP (?<status>\d+)/
| stats count() by status
```

### 设置日志保留策略

**AWS CLI命令:**
```bash
aws logs put-retention-policy \
  --log-group-name /aws/elasticbeanstalk/amazon-ads-env-prod/var/log/web.stdout.log \
  --retention-in-days 30
```

---

## 🎯 监控最佳实践

### 1. 分层监控策略

**基础层 (Infrastructure):**
- CPU使用率
- 内存使用率
- 磁盘空间
- 网络流量

**应用层 (Application):**
- HTTP状态码分布
- 响应时间(P50, P90, P99)
- 请求吞吐量
- 错误率

**业务层 (Business):**
- 活跃用户数
- API调用量
- 广告活动数量
- 优化执行成功率

### 2. 告警阈值设置原则

- **警告级别:** 超过正常值20-30%
- **严重级别:** 超过正常值50%或影响服务
- **紧急级别:** 服务中断或数据丢失风险

### 3. 告警降噪策略

- 使用评估周期避免瞬时波动
- 设置合理的阈值避免误报
- 使用复合告警减少告警数量
- 定期审查和调整告警规则

### 4. 响应流程

1. **接收告警** → 确认告警内容
2. **初步诊断** → 查看仪表板和日志
3. **问题定位** → 确定根本原因
4. **执行修复** → 应用修复措施
5. **验证恢复** → 确认服务恢复正常
6. **事后分析** → 记录问题和改进措施

---

## 📋 执行清单

### 立即执行

- [ ] 为manus-deploy用户添加CloudWatch权限
- [ ] 创建SNS主题并订阅邮箱
- [ ] 配置6个核心告警
- [ ] 创建CloudWatch Dashboard
- [ ] 设置日志保留策略

### 短期计划(1周内)

- [ ] 配置应用性能监控(APM)
- [ ] 设置自定义业务指标
- [ ] 建立告警响应流程
- [ ] 培训团队成员使用监控工具

### 长期计划(1个月内)

- [ ] 实施分布式追踪
- [ ] 建立容量规划模型
- [ ] 自动化告警响应
- [ ] 定期监控报告

---

## 🔗 相关资源

- [AWS CloudWatch文档](https://docs.aws.amazon.com/cloudwatch/)
- [Elastic Beanstalk监控](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/health-enhanced.html)
- [CloudWatch Logs Insights查询语法](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)

---

**文档版本:** 1.0  
**最后更新:** 2026-02-13  
**维护者:** DevOps Team
