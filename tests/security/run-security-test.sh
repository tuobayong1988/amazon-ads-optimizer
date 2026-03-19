#!/bin/bash
# v452.9: 多租户安全回归测试运行脚本
# 
# 用法:
#   ./tests/security/run-security-test.sh [base_url] [admin_token]
#
# 环境变量:
#   APP_BASE_URL   - 应用基础URL（默认: http://localhost:3000）
#   ADMIN_TOKEN    - 管理员JWT token
#
# 退出码:
#   0 - 所有测试通过
#   1 - 存在测试失败
#   2 - 配置错误

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 参数解析
BASE_URL="${1:-${APP_BASE_URL:-http://localhost:3000}}"
TOKEN="${2:-${ADMIN_TOKEN:-}}"

if [ -z "$TOKEN" ]; then
    echo "❌ 错误: 未提供管理员token"
    echo "用法: $0 [base_url] [admin_token]"
    echo "或设置环境变量: export ADMIN_TOKEN=<your_token>"
    exit 2
fi

echo "🔒 运行多租户安全回归测试..."
echo "   目标: $BASE_URL"
echo "   时间: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# 确保 requests 库可用
python3 -c "import requests" 2>/dev/null || {
    echo "安装 requests 库..."
    pip3 install requests -q
}

# 运行测试
RESULT_FILE="${PROJECT_DIR}/test-results-$(date +%Y%m%d_%H%M%S).json"

python3 "$SCRIPT_DIR/tenant-isolation-test.py" \
    --base-url "$BASE_URL" \
    --admin-token "$TOKEN" \
    --output "$RESULT_FILE" \
    --timeout 30

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ 所有安全测试通过，部署安全。"
else
    echo ""
    echo "❌ 安全测试失败！请检查结果: $RESULT_FILE"
fi

exit $EXIT_CODE
