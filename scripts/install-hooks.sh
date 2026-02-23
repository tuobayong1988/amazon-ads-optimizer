#!/bin/bash
# ============================================================
# install-hooks.sh — 安装 git pre-commit hook
# 
# 用法: bash scripts/install-hooks.sh
# ============================================================

HOOK_DIR="$(git rev-parse --show-toplevel)/.git/hooks"
HOOK_FILE="$HOOK_DIR/pre-commit"

cat > "$HOOK_FILE" << 'HOOK'
#!/bin/bash
# ============================================================
# pre-commit hook — ID安全检查
# 自动安装: bash scripts/install-hooks.sh
# ============================================================

echo "🔍 Running ID Safety Check..."

# 检查是否有server/目录下的文件被修改
CHANGED_SERVER_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep "^server/" || true)

if [ -z "$CHANGED_SERVER_FILES" ]; then
    echo "✅ No server files changed, skipping ID safety check."
    exit 0
fi

# 运行ID安全检查（严格模式）
node scripts/check-id-safety.js --strict
RESULT=$?

if [ $RESULT -ne 0 ]; then
    echo ""
    echo "❌ ID Safety Check FAILED!"
    echo "   请修复上述ID混用问题后再提交。"
    echo "   参考: server/utils/idTypes.ts 中的 THE LAW"
    echo ""
    echo "   如需跳过检查（紧急情况）: git commit --no-verify"
    exit 1
fi

echo "✅ ID Safety Check passed."
exit 0
HOOK

chmod +x "$HOOK_FILE"
echo "✅ Pre-commit hook installed at: $HOOK_FILE"
echo "   每次 git commit 时将自动运行 ID 安全检查"
