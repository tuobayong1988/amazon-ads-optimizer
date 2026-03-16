#!/bin/bash
# =============================================================================
# Amazon Ads Optimizer - 标准化部署脚本 (v2 - 集成构建与版本验证)
# 
# 此脚本按照成功部署版本（v243/v250/v251/v255）的精确结构创建部署包
# 
# v2 改进:
# - 自动执行 pnpm build，确保每次部署使用最新构建产物
# - 构建后验证 SYSTEM_VERSION 与目标版本号一致，防止版本错乱
# - 增加 --skip-build 参数，允许跳过构建（仅用于紧急回滚场景）
# 
# 成功部署的必要条件：
# 1. 包含 pnpm-lock.yaml（不是 package-lock.json）
# 2. 包含 drizzle/ 目录（schema和迁移文件）
# 3. 包含 dist/ 目录（编译后的服务端和前端代码）
# 4. 包含 .ebextensions/ 和 .platform/ 配置
# 5. 包含 .npmrc（legacy-peer-deps=true）
# 6. 包含 Procfile 和 package.json
# 7. 不包含 package-lock.json（会导致npm install冲突）
# 8. 不包含 node_modules/（EB会自动安装）
# 9. 包含 server/ 和 shared/ 源代码（Procfile使用tsx直接运行TypeScript）
# 10. dist/index.js 中的 SYSTEM_VERSION 必须与目标版本号一致
# =============================================================================

set -e

cd "$(dirname "$0")"

# ==================== 参数解析 ====================
SKIP_BUILD=false
AUTO_DEPLOY=false
VERSION=""

for arg in "$@"; do
    case $arg in
        --skip-build)
            SKIP_BUILD=true
            ;;
        --auto-deploy)
            AUTO_DEPLOY=true
            ;;
        v*)
            VERSION="$arg"
            ;;
    esac
done

if [ -z "$VERSION" ]; then
    echo "ERROR: 请指定版本号，例如: bash deploy.sh v256"
    echo "用法: bash deploy.sh <版本号> [--skip-build] [--auto-deploy]"
    echo "  --skip-build   跳过构建步骤（仅用于紧急回滚）"
    echo "  --auto-deploy  构建完成后自动部署到生产环境"
    exit 1
fi

# 获取版本信息
COMMIT=$(git rev-parse --short HEAD)
VERSION_NUM="${VERSION#v}"  # 去掉v前缀，得到纯数字
VERSION_LABEL="app-${VERSION}-${COMMIT}"
ZIP_FILE="/tmp/${VERSION_LABEL}.zip"

echo "=========================================="
echo "部署版本: ${VERSION_LABEL}"
echo "跳过构建: ${SKIP_BUILD}"
echo "自动部署: ${AUTO_DEPLOY}"
echo "=========================================="

# ==================== 步骤 1: 构建应用 ====================
if [ "$SKIP_BUILD" = false ]; then
    echo "[1/8] 构建应用..."
    echo "  执行 pnpm build ..."
    pnpm build 2>&1 | tail -5
    echo "  ✓ 构建完成"
else
    echo "[1/8] 跳过构建（--skip-build 模式）"
    echo "  ⚠ 警告: 使用现有的 dist/ 目录，请确认构建产物是最新的"
fi

# ==================== 步骤 2: 验证构建产物 ====================
echo "[2/8] 验证构建产物..."
if [ ! -f "dist/index.js" ]; then
    echo "ERROR: dist/index.js 不存在"
    if [ "$SKIP_BUILD" = true ]; then
        echo "提示: 请先运行 pnpm build 或移除 --skip-build 参数"
    fi
    exit 1
fi
if [ ! -d "dist/public" ]; then
    echo "ERROR: dist/public/ 不存在"
    exit 1
fi
echo "  ✓ dist/index.js 存在 ($(wc -c < dist/index.js) bytes)"
echo "  ✓ dist/public/ 存在 ($(find dist/public -type f | wc -l) files)"

# ==================== 步骤 3: 版本号一致性验证 ====================
echo "[3/8] 验证版本号一致性..."

# v370.4: 适配esbuild minified输出 - 多种方式提取版本号
BUILD_VERSION=""
# 方式1: 从源代码直接提取（最可靠）
BUILD_VERSION=$(grep -oP 'SYSTEM_VERSION\s*=\s*\K[0-9]+(\.[0-9]+)?' server/utils/systemVersion.ts 2>/dev/null | head -1)
# 方式2: 从dist中提取minified变量赋值
if [ -z "$BUILD_VERSION" ]; then
  BUILD_VERSION=$(grep -oP 'vr=\K[0-9]+(\.[0-9]+)?' dist/index.js 2>/dev/null | head -1)
fi
# 方式3: 传统格式
if [ -z "$BUILD_VERSION" ]; then
  BUILD_VERSION=$(grep -oP 'SYSTEM_VERSION\s*=\s*\K[0-9]+(\.[0-9]+)?' dist/index.js 2>/dev/null | head -1)
fi

if [ -z "$BUILD_VERSION" ]; then
    echo "ERROR: 无法提取 SYSTEM_VERSION"
    exit 1
fi

echo "  构建产物版本: v${BUILD_VERSION}"
echo "  目标部署版本: ${VERSION} (${VERSION_NUM})"

# 严格验证: 构建产物版本必须与目标版本一致
if [ "$BUILD_VERSION" != "$VERSION_NUM" ]; then
    echo ""
    echo "ERROR: 版本号不匹配！构建产物 SYSTEM_VERSION=${BUILD_VERSION}，目标版本=${VERSION}"
    echo "请检查 server/utils/systemVersion.ts 中的版本号"
    exit 1
fi

echo "  ✓ 版本号一致性验证通过: v${BUILD_VERSION}"

# ==================== 步骤 4: 检查必需文件 ====================
echo "[4/8] 检查必需文件..."
REQUIRED_FILES=".npmrc package.json pnpm-lock.yaml Procfile"
for f in $REQUIRED_FILES; do
    if [ ! -f "$f" ]; then
        echo "ERROR: $f 不存在"
        exit 1
    fi
    echo "  ✓ $f"
done

# 检查drizzle目录
if [ ! -d "drizzle" ]; then
    echo "ERROR: drizzle/ 目录不存在"
    exit 1
fi
echo "  ✓ drizzle/ ($(find drizzle -type f | wc -l) files)"

# 检查.ebextensions和.platform
if [ ! -d ".ebextensions" ]; then
    echo "ERROR: .ebextensions/ 目录不存在"
    exit 1
fi
echo "  ✓ .ebextensions/"
if [ ! -d ".platform" ]; then
    echo "ERROR: .platform/ 目录不存在"
    exit 1
fi
echo "  ✓ .platform/"

# ==================== 步骤 5: 创建部署包 ====================
echo "[5/8] 创建部署包..."
rm -f "$ZIP_FILE"

# 使用明确的包含列表（而非排除列表）
# 注意: Procfile使用tsx直接运行TypeScript源代码，因此必须包含server/和shared/目录
zip -r "$ZIP_FILE" \
    .npmrc \
    package.json \
    pnpm-lock.yaml \
    Procfile \
    tsconfig.json \
    dist/ \
    server/ \
    shared/ \
    drizzle/ \
    .ebextensions/ \
    .platform/ \
    -x "dist/index.js.map" \
    -x "dist/public/blog/*" \
    -x "dist/public/og-image.png" \
    -x "drizzle/schema.ts.bak" \
    -x "server/**/*.test.ts" \
    -x "server/**/*.spec.ts" \
    2>&1 | tail -3

echo "  ✓ 部署包: $ZIP_FILE ($(du -h $ZIP_FILE | cut -f1))"

# ==================== 步骤 6: 验证部署包内容 ====================
echo "[6/8] 验证部署包内容..."
echo "  文件总数: $(unzip -l $ZIP_FILE | tail -1 | awk '{print $2}')"

# 确认不包含package-lock.json
if unzip -l "$ZIP_FILE" | grep -q "package-lock.json"; then
    echo "ERROR: 部署包中包含 package-lock.json！这会导致部署失败"
    exit 1
fi
echo "  ✓ 不包含 package-lock.json"

# 确认不包含node_modules
if unzip -l "$ZIP_FILE" | grep -q "node_modules/"; then
    echo "ERROR: 部署包中包含 node_modules/！"
    exit 1
fi
echo "  ✓ 不包含 node_modules/"

# 确认包含关键文件
for f in ".npmrc" "package.json" "pnpm-lock.yaml" "Procfile" "dist/index.js" "drizzle/schema.ts"; do
    if ! unzip -l "$ZIP_FILE" | grep -q "$f"; then
        echo "ERROR: 部署包中缺少 $f"
        exit 1
    fi
    echo "  ✓ 包含 $f"
done

# ==================== 步骤 7: 上传到S3 ====================
echo "[7/8] 上传到S3..."
S3_BUCKET="elasticbeanstalk-us-east-1-408336117167"
S3_KEY="amazon-ads-optimizer/${VERSION_LABEL}.zip"
aws s3 cp "$ZIP_FILE" "s3://${S3_BUCKET}/${S3_KEY}" 2>&1 | tail -1
echo "  ✓ 上传完成: s3://${S3_BUCKET}/${S3_KEY}"

# ==================== 步骤 8: 创建EB应用版本 ====================
echo "[8/8] 创建EB应用版本..."
aws elasticbeanstalk create-application-version \
    --application-name amazon-ads-optimizer \
    --version-label "$VERSION_LABEL" \
    --source-bundle S3Bucket="${S3_BUCKET}",S3Key="${S3_KEY}" \
    --description "Deploy ${VERSION} commit ${COMMIT} (SYSTEM_VERSION=${BUILD_VERSION})" \
    --query 'ApplicationVersion.VersionLabel' \
    --output text 2>&1
echo "  ✓ 应用版本创建完成: ${VERSION_LABEL}"

echo ""
echo "=========================================="
echo "✅ 部署包准备完成！"
echo "版本标签: ${VERSION_LABEL}"
echo "构建版本: SYSTEM_VERSION = ${BUILD_VERSION}"
echo ""

if [ "$AUTO_DEPLOY" = true ]; then
    echo "🚀 自动部署模式: 正在部署到生产环境..."
    aws elasticbeanstalk update-environment \
        --environment-name amazon-ads-env-prod \
        --version-label "$VERSION_LABEL" \
        --query 'Status' \
        --output text 2>&1
    echo "  ✓ 部署已触发，请等待环境更新完成"
    echo ""
    echo "监控部署状态:"
    echo "  aws elasticbeanstalk describe-environments \\"
    echo "    --environment-names amazon-ads-env-prod \\"
    echo "    --query 'Environments[0].{Status:Status,Health:Health,Version:VersionLabel}'"
else
    echo "要部署到现有环境，运行:"
    echo "  aws elasticbeanstalk update-environment \\"
    echo "    --environment-name amazon-ads-env-prod \\"
    echo "    --version-label ${VERSION_LABEL}"
    echo ""
    echo "或使用 --auto-deploy 参数自动部署:"
    echo "  bash deploy.sh ${VERSION} --auto-deploy"
fi
echo "=========================================="
