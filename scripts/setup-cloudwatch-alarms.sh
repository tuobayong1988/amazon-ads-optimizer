#!/bin/bash
# CloudWatch告警配置脚本
# 需要管理员权限执行

set -e

REGION="us-east-1"
ENV_NAME="amazon-ads-env-prod"
DB_INSTANCE="amazon-ads-optimizer-db"
SNS_TOPIC_NAME="amazon-ads-optimizer-alerts"
EMAIL="your-email@example.com"  # 请修改为实际邮箱

echo "========================================="
echo "Amazon Ads Optimizer - CloudWatch告警配置"
echo "========================================="
echo ""

# 1. 创建SNS主题
echo "1. 创建SNS主题..."
SNS_TOPIC_ARN=$(aws sns create-topic \
  --name $SNS_TOPIC_NAME \
  --region $REGION \
  --query 'TopicArn' \
  --output text 2>/dev/null || \
  aws sns list-topics --region $REGION --query "Topics[?contains(TopicArn, '$SNS_TOPIC_NAME')].TopicArn" --output text)

echo "   SNS主题ARN: $SNS_TOPIC_ARN"

# 2. 订阅邮箱
echo "2. 订阅邮箱通知..."
aws sns subscribe \
  --topic-arn $SNS_TOPIC_ARN \
  --protocol email \
  --notification-endpoint $EMAIL \
  --region $REGION 2>/dev/null || echo "   邮箱可能已订阅"

echo "   请检查邮箱 $EMAIL 并确认订阅"
echo ""

# 3. 创建告警 - 应用健康检查
echo "3. 创建应用健康检查告警..."
aws cloudwatch put-metric-alarm \
  --alarm-name "${ENV_NAME}-health-check-failed" \
  --alarm-description "Alert when application health check fails" \
  --metric-name EnvironmentHealth \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 300 \
  --threshold 15 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=EnvironmentName,Value=$ENV_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --treat-missing-data notBreaching \
  --region $REGION

echo "   ✓ 健康检查告警已创建"

# 4. 创建告警 - HTTP 5xx错误
echo "4. 创建HTTP 5xx错误告警..."
aws cloudwatch put-metric-alarm \
  --alarm-name "${ENV_NAME}-5xx-errors" \
  --alarm-description "Alert when 5xx error rate exceeds threshold" \
  --metric-name ApplicationRequests5xx \
  --namespace AWS/ElasticBeanstalk \
  --statistic Sum \
  --period 300 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=EnvironmentName,Value=$ENV_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --treat-missing-data notBreaching \
  --region $REGION

echo "   ✓ 5xx错误告警已创建"

# 5. 创建告警 - 高延迟
echo "5. 创建响应时间告警..."
aws cloudwatch put-metric-alarm \
  --alarm-name "${ENV_NAME}-high-latency" \
  --alarm-description "Alert when P99 latency exceeds 2 seconds" \
  --metric-name ApplicationLatencyP99 \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 300 \
  --threshold 2 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 \
  --dimensions Name=EnvironmentName,Value=$ENV_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --treat-missing-data notBreaching \
  --region $REGION

echo "   ✓ 响应时间告警已创建"

# 6. 创建告警 - CPU使用率
echo "6. 创建CPU使用率告警..."
INSTANCE_ID=$(aws elasticbeanstalk describe-environment-resources \
  --environment-name $ENV_NAME \
  --region $REGION \
  --query 'EnvironmentResources.Instances[0].Id' \
  --output text)

if [ "$INSTANCE_ID" != "None" ] && [ -n "$INSTANCE_ID" ]; then
  aws cloudwatch put-metric-alarm \
    --alarm-name "${ENV_NAME}-high-cpu" \
    --alarm-description "Alert when CPU usage exceeds 80%" \
    --metric-name CPUUtilization \
    --namespace AWS/EC2 \
    --statistic Average \
    --period 300 \
    --threshold 80 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 3 \
    --dimensions Name=InstanceId,Value=$INSTANCE_ID \
    --alarm-actions $SNS_TOPIC_ARN \
    --region $REGION
  
  echo "   ✓ CPU使用率告警已创建 (Instance: $INSTANCE_ID)"
else
  echo "   ⚠ 无法获取实例ID,跳过CPU告警"
fi

# 7. 创建告警 - 数据库连接数
echo "7. 创建数据库连接数告警..."
aws cloudwatch put-metric-alarm \
  --alarm-name "${DB_INSTANCE}-high-connections" \
  --alarm-description "Alert when database connections exceed 80% of max" \
  --metric-name DatabaseConnections \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=DBInstanceIdentifier,Value=$DB_INSTANCE \
  --alarm-actions $SNS_TOPIC_ARN \
  --region $REGION

echo "   ✓ 数据库连接数告警已创建"

# 8. 创建告警 - 磁盘空间
echo "8. 创建磁盘空间告警..."
aws cloudwatch put-metric-alarm \
  --alarm-name "${ENV_NAME}-low-disk-space" \
  --alarm-description "Alert when disk usage exceeds 85%" \
  --metric-name RootFilesystemUtil \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 300 \
  --threshold 85 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=EnvironmentName,Value=$ENV_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --treat-missing-data notBreaching \
  --region $REGION

echo "   ✓ 磁盘空间告警已创建"

echo ""
echo "========================================="
echo "✅ CloudWatch告警配置完成!"
echo "========================================="
echo ""
echo "已创建的告警:"
echo "  1. ${ENV_NAME}-health-check-failed"
echo "  2. ${ENV_NAME}-5xx-errors"
echo "  3. ${ENV_NAME}-high-latency"
echo "  4. ${ENV_NAME}-high-cpu"
echo "  5. ${DB_INSTANCE}-high-connections"
echo "  6. ${ENV_NAME}-low-disk-space"
echo ""
echo "SNS主题: $SNS_TOPIC_ARN"
echo "订阅邮箱: $EMAIL"
echo ""
echo "⚠️  请检查邮箱并确认SNS订阅!"
echo ""

# 9. 列出所有告警状态
echo "当前告警状态:"
aws cloudwatch describe-alarms \
  --alarm-name-prefix "${ENV_NAME}" \
  --region $REGION \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue}' \
  --output table
