#!/bin/bash
# API端点验证脚本

BASE_URL="http://ppcopt-prod.us-east-1.elasticbeanstalk.com"
API_URL="$BASE_URL/api/trpc"

echo "========================================="
echo "Amazon Ads Optimizer - API端点验证"
echo "========================================="
echo "Base URL: $BASE_URL"
echo "API URL: $API_URL"
echo ""

# 测试计数器
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 测试函数
test_endpoint() {
  local name="$1"
  local endpoint="$2"
  local expected_status="${3:-200}"
  
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  echo -n "Testing $name... "
  
  response=$(curl -s -w "\n%{http_code}" "$API_URL/$endpoint" 2>&1)
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  if [ "$http_code" = "$expected_status" ]; then
    echo "✓ PASS (HTTP $http_code)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
    
    # 显示响应摘要
    if echo "$body" | jq -e . >/dev/null 2>&1; then
      echo "  Response: $(echo "$body" | jq -c '.' | head -c 100)..."
    fi
  else
    echo "✗ FAIL (HTTP $http_code, expected $expected_status)"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  Response: $(echo "$body" | head -c 200)"
  fi
  echo ""
}

# 测试函数 - POST请求
test_post_endpoint() {
  local name="$1"
  local endpoint="$2"
  local data="$3"
  local expected_status="${4:-200}"
  
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  echo -n "Testing $name (POST)... "
  
  response=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$data" \
    "$API_URL/$endpoint" 2>&1)
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  if [ "$http_code" = "$expected_status" ]; then
    echo "✓ PASS (HTTP $http_code)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    echo "✗ FAIL (HTTP $http_code, expected $expected_status)"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  Response: $(echo "$body" | head -c 200)"
  fi
  echo ""
}

echo "==================== 核心API测试 ===================="
echo ""

# 1. 认证相关
test_endpoint "auth.me (获取当前用户)" "auth.me"

# 2. 广告账户相关
test_endpoint "adAccount.list (账户列表)" "adAccount.list"
test_endpoint "adAccount.getDefault (默认账户)" "adAccount.getDefault"

# 3. 性能组相关
test_endpoint "performanceGroup.list (性能组列表)" "performanceGroup.list"

# 4. 广告活动相关
test_endpoint "campaign.list (活动列表)" "campaign.list"

# 5. 关键词相关
test_endpoint "keyword.list (关键词列表)" "keyword.list"

# 6. 分析相关
test_endpoint "analytics.overview (数据概览)" "analytics.overview"

# 7. 优化相关
test_endpoint "optimization.getRecommendations (优化建议)" "optimization.getRecommendations"

# 8. 通知相关
test_endpoint "notification.getSettings (通知设置)" "notification.getSettings"

# 9. 调度器相关
test_endpoint "scheduler.getTasks (调度任务)" "scheduler.getTasks"

# 10. 数据同步相关
test_endpoint "dataSync.getJobs (同步任务)" "dataSync.getJobs"

echo "==================== 多租户API测试 ===================="
echo ""

# 11. 多租户相关
test_endpoint "multiTenant.organizations.list (组织列表)" "multiTenant.organizations.list"
test_endpoint "multiTenant.subscriptionPlans.list (订阅计划)" "multiTenant.subscriptionPlans.list"

echo "==================== ML优化API测试 ===================="
echo ""

# 12. ML优化相关
test_endpoint "mlOptimization.predictions.list (ML预测列表)" "mlOptimization.predictions.list"

echo "==================== 智能活动API测试 ===================="
echo ""

# 13. 智能活动相关
test_endpoint "smartCampaign.decisions.list (决策列表)" "smartCampaign.decisions.list"

echo ""
echo "========================================="
echo "测试完成!"
echo "========================================="
echo "总测试数: $TOTAL_TESTS"
echo "通过: $PASSED_TESTS"
echo "失败: $FAILED_TESTS"
echo "成功率: $(awk "BEGIN {printf \"%.1f%%\", ($PASSED_TESTS/$TOTAL_TESTS)*100}")"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
  echo "✅ 所有API端点测试通过!"
  exit 0
else
  echo "⚠️  有 $FAILED_TESTS 个端点测试失败"
  exit 1
fi
