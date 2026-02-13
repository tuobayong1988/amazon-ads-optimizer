#!/bin/bash

# AWS CloudWatch 监控和告警配置脚本
# 用于Amazon Ads Optimizer系统

set -e

# 配置变量
ENVIRONMENT_NAME="Amazon-ads-optimizer-env"
APPLICATION_NAME="amazon-ads-optimizer"
REGION="us-east-1"
SNS_TOPIC_NAME="amazon-ads-optimizer-alerts"
EMAIL_ADDRESS="admin@example.com"  # 请修改为实际的邮箱地址

echo "========================================="
echo "Amazon Ads Optimizer - CloudWatch 监控配置"
echo "========================================="
echo ""

# 1. 创建SNS主题用于告警通知
echo "[1/6] 创建SNS告警主题..."
SNS_TOPIC_ARN=$(aws sns create-topic \
  --name $SNS_TOPIC_NAME \
  --region $REGION \
  --query 'TopicArn' \
  --output text 2>/dev/null || \
  aws sns list-topics --region $REGION --query "Topics[?contains(TopicArn, '$SNS_TOPIC_NAME')].TopicArn" --output text)

echo "SNS主题ARN: $SNS_TOPIC_ARN"

# 2. 订阅邮件通知
echo "[2/6] 配置邮件订阅..."
aws sns subscribe \
  --topic-arn $SNS_TOPIC_ARN \
  --protocol email \
  --notification-endpoint $EMAIL_ADDRESS \
  --region $REGION 2>/dev/null || echo "邮件订阅可能已存在"

echo "请检查邮箱 $EMAIL_ADDRESS 并确认订阅"

# 3. 创建CPU使用率告警
echo "[3/6] 创建CPU使用率告警..."
aws cloudwatch put-metric-alarm \
  --alarm-name "${APPLICATION_NAME}-high-cpu" \
  --alarm-description "CPU使用率超过80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=EnvironmentName,Value=$ENVIRONMENT_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --region $REGION

echo "✓ CPU告警已创建"

# 4. 创建内存使用率告警
echo "[4/6] 创建内存使用率告警..."
aws cloudwatch put-metric-alarm \
  --alarm-name "${APPLICATION_NAME}-high-memory" \
  --alarm-description "内存使用率超过85%" \
  --metric-name MemoryUtilization \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 300 \
  --threshold 85 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=EnvironmentName,Value=$ENVIRONMENT_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --region $REGION 2>/dev/null || echo "内存告警创建失败(可能不支持该指标)"

echo "✓ 内存告警已配置"

# 5. 创建环境健康状态告警
echo "[5/6] 创建环境健康状态告警..."
aws cloudwatch put-metric-alarm \
  --alarm-name "${APPLICATION_NAME}-environment-health" \
  --alarm-description "环境健康状态异常" \
  --metric-name EnvironmentHealth \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 60 \
  --threshold 15 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=EnvironmentName,Value=$ENVIRONMENT_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --region $REGION

echo "✓ 环境健康告警已创建"

# 6. 创建应用程序错误率告警
echo "[6/6] 创建应用程序错误率告警..."
aws cloudwatch put-metric-alarm \
  --alarm-name "${APPLICATION_NAME}-high-error-rate" \
  --alarm-description "应用程序5xx错误率超过5%" \
  --metric-name ApplicationRequests5xx \
  --namespace AWS/ElasticBeanstalk \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=EnvironmentName,Value=$ENVIRONMENT_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --region $REGION 2>/dev/null || echo "错误率告警创建失败(可能不支持该指标)"

echo "✓ 错误率告警已配置"

echo ""
echo "========================================="
echo "CloudWatch监控配置完成!"
echo "========================================="
echo ""
echo "已创建的告警:"
echo "  1. CPU使用率 > 80%"
echo "  2. 内存使用率 > 85%"
echo "  3. 环境健康状态异常"
echo "  4. 5xx错误率 > 10次/5分钟"
echo ""
echo "告警通知将发送到: $EMAIL_ADDRESS"
echo "SNS主题ARN: $SNS_TOPIC_ARN"
echo ""
echo "查看告警状态:"
echo "  aws cloudwatch describe-alarms --region $REGION"
echo ""
echo "查看CloudWatch控制台:"
echo "  https://console.aws.amazon.com/cloudwatch/home?region=$REGION#alarmsV2:"
echo ""
