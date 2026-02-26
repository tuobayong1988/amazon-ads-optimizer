#!/bin/bash
# =============================================================================
# Amazon Ads Optimizer - 标准化部署脚本
# 
# 此脚本按照成功部署版本（v243/v250/v251）的精确结构创建部署包
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
# 9. 不包含源代码（client/ server/ shared/）
# =============================================================================

set -e

cd "$(dirname "$0")"

# 获取版本信息
COMMIT=$(git rev-parse --short HEAD)
VERSION=${1:-"v252"}
VERSION_LABEL="app-${VERSION}-${COMMIT}"
ZIP_FILE="/tmp/${VERSION_LABEL}.zip"

echo "=========================================="
echo "部署版本: ${VERSION_LABEL}"
echo "=========================================="

# 1. 确保前端和后端都已构建
echo "[1/6] 检查构建产物..."
if [ ! -f "dist/index.js" ]; then
    echo "ERROR: dist/index.js 不存在，请先运行构建"
    exit 1
fi
if [ ! -d "dist/public" ]; then
    echo "ERROR: dist/public/ 不存在，请先运行前端构建"
    exit 1
fi
echo "  ✓ dist/index.js 存在 ($(wc -c < dist/index.js) bytes)"
echo "  ✓ dist/public/ 存在 ($(find dist/public -type f | wc -l) files)"

# 2. 检查必需文件
echo "[2/6] 检查必需文件..."
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

# 3. 创建部署包（严格按照成功版本的结构）
echo "[3/6] 创建部署包..."
rm -f "$ZIP_FILE"

# 使用明确的包含列表（而非排除列表）
zip -r "$ZIP_FILE" \
    .npmrc \
    package.json \
    pnpm-lock.yaml \
    Procfile \
    dist/ \
    drizzle/ \
    .ebextensions/ \
    .platform/ \
    -x "dist/index.js.map" \
    -x "dist/public/blog/*" \
    -x "dist/public/og-image.png" \
    -x "drizzle/schema.ts.bak" \
    2>&1 | tail -3

echo "  ✓ 部署包: $ZIP_FILE ($(du -h $ZIP_FILE | cut -f1))"

# 4. 验证部署包内容
echo "[4/6] 验证部署包内容..."
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

# 5. 上传到S3
echo "[5/6] 上传到S3..."
S3_BUCKET="elasticbeanstalk-us-east-1-696154297094"
S3_KEY="amazon-ads-optimizer/${VERSION_LABEL}.zip"
aws s3 cp "$ZIP_FILE" "s3://${S3_BUCKET}/${S3_KEY}" 2>&1 | tail -1
echo "  ✓ 上传完成: s3://${S3_BUCKET}/${S3_KEY}"

# 6. 创建EB应用版本
echo "[6/6] 创建EB应用版本..."
aws elasticbeanstalk create-application-version \
    --application-name amazon-ads-optimizer \
    --version-label "$VERSION_LABEL" \
    --source-bundle S3Bucket="${S3_BUCKET}",S3Key="${S3_KEY}" \
    --description "Deploy ${VERSION} commit ${COMMIT}" \
    --query 'ApplicationVersion.VersionLabel' \
    --output text 2>&1
echo "  ✓ 应用版本创建完成: ${VERSION_LABEL}"

echo ""
echo "=========================================="
echo "部署包准备完成！"
echo "版本标签: ${VERSION_LABEL}"
echo ""
echo "要部署到现有环境，运行:"
echo "  aws elasticbeanstalk update-environment \\"
echo "    --environment-name amazon-ads-env-prod \\"
echo "    --version-label ${VERSION_LABEL}"
echo ""
echo "要创建新环境，运行:"
echo "  aws elasticbeanstalk create-environment \\"
echo "    --application-name amazon-ads-optimizer \\"
echo "    --environment-name amazon-ads-env-prod \\"
echo "    --version-label ${VERSION_LABEL} \\"
echo "    --solution-stack-name '64bit Amazon Linux 2023 v6.5.1 running Node.js 22'"
echo "=========================================="
