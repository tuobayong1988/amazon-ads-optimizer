#!/bin/bash
# ============================================================
# pre-deploy-check.sh
# v239 - 版本发布前自动检查脚本
# 
# 用法: ./scripts/pre-deploy-check.sh [expected_version]
# 示例: ./scripts/pre-deploy-check.sh 239
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "  Pre-Deploy Checklist v239"
echo "=========================================="
echo ""

ERRORS=0
WARNINGS=0

# ---- 检查1: SYSTEM_VERSION一致性 ----
echo "🔍 检查1: SYSTEM_VERSION一致性"

VERSION_POST=$(grep -oP 'export const SYSTEM_VERSION\s*=\s*\K\d+' server/postDeployOptimizer.ts 2>/dev/null || echo "NOT_FOUND")
VERSION_UTIL=$(grep -oP 'export const SYSTEM_VERSION\s*=\s*\K\d+' server/utils/systemVersion.ts 2>/dev/null || echo "NOT_FOUND")

if [ "$VERSION_POST" = "NOT_FOUND" ]; then
  echo -e "  ${RED}✗ postDeployOptimizer.ts 中未找到 SYSTEM_VERSION${NC}"
  ERRORS=$((ERRORS + 1))
elif [ "$VERSION_UTIL" = "NOT_FOUND" ]; then
  echo -e "  ${RED}✗ utils/systemVersion.ts 中未找到 SYSTEM_VERSION${NC}"
  ERRORS=$((ERRORS + 1))
elif [ "$VERSION_POST" != "$VERSION_UTIL" ]; then
  echo -e "  ${RED}✗ SYSTEM_VERSION不一致: postDeployOptimizer=$VERSION_POST, systemVersion=$VERSION_UTIL${NC}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "  ${GREEN}✓ SYSTEM_VERSION一致: $VERSION_POST${NC}"
fi

# 如果指定了期望版本号，检查是否匹配
if [ -n "$1" ]; then
  EXPECTED=$1
  if [ "$VERSION_POST" != "$EXPECTED" ]; then
    echo -e "  ${RED}✗ SYSTEM_VERSION($VERSION_POST) 不等于期望版本($EXPECTED)${NC}"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓ SYSTEM_VERSION匹配期望版本: $EXPECTED${NC}"
  fi
fi

# ---- 检查2: VERSION_CHANGELOG是否包含当前版本 ----
echo ""
echo "🔍 检查2: VERSION_CHANGELOG完整性"

if grep -q "version: $VERSION_POST" server/postDeployOptimizer.ts 2>/dev/null; then
  echo -e "  ${GREEN}✓ VERSION_CHANGELOG包含v$VERSION_POST的变更记录${NC}"
else
  echo -e "  ${YELLOW}⚠ VERSION_CHANGELOG中未找到v$VERSION_POST的变更记录${NC}"
  WARNINGS=$((WARNINGS + 1))
fi

# ---- 检查3: TypeScript编译检查 ----
echo ""
echo "🔍 检查3: TypeScript编译"

if npx tsc --noEmit --skipLibCheck 2>/dev/null; then
  echo -e "  ${GREEN}✓ TypeScript编译通过${NC}"
else
  echo -e "  ${YELLOW}⚠ TypeScript编译有警告（--skipLibCheck模式）${NC}"
  WARNINGS=$((WARNINGS + 1))
fi

# ---- 检查4: 前端构建检查 ----
echo ""
echo "🔍 检查4: 前端构建"

if [ -d "client/dist" ]; then
  BUNDLE_SIZE=$(du -sh client/dist 2>/dev/null | cut -f1)
  echo -e "  ${GREEN}✓ 前端构建产物存在 (${BUNDLE_SIZE})${NC}"
else
  echo -e "  ${RED}✗ 前端构建产物不存在，请先运行 npx vite build${NC}"
  ERRORS=$((ERRORS + 1))
fi

# ---- 检查5: 服务端构建检查 ----
echo ""
echo "🔍 检查5: 服务端构建"

if [ -f "dist/index.js" ]; then
  SERVER_SIZE=$(du -sh dist/index.js 2>/dev/null | cut -f1)
  echo -e "  ${GREEN}✓ 服务端构建产物存在 (${SERVER_SIZE})${NC}"
  
  # 检查GTO模块是否被打包
  if grep -q "gtoCompetitorAwareness\|GTO_MODIFIER" dist/index.js 2>/dev/null; then
    echo -e "  ${GREEN}✓ GTO引擎模块已打包${NC}"
  else
    echo -e "  ${YELLOW}⚠ GTO引擎模块可能未被打包${NC}"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo -e "  ${RED}✗ 服务端构建产物不存在，请先运行 node build-server.js${NC}"
  ERRORS=$((ERRORS + 1))
fi

# ---- 检查6: 关键文件完整性 ----
echo ""
echo "🔍 检查6: 关键文件完整性"

REQUIRED_FILES=(
  "server/nextGenBidOrchestrator.ts"
  "server/metaLearningSelector.ts"
  "server/optimizationTargetEngine.ts"
  "server/postDeployOptimizer.ts"
  "server/gtoIntegrationOrchestrator.ts"
  "server/gtoCompetitorAwarenessEngine.ts"
  "server/gtoDynamicEVEngine.ts"
  "server/gtoExploratoryInvestmentEngine.ts"
  "server/gtoBudgetPoolingEngine.ts"
  "server/gtoOpportunityWindowEngine.ts"
  "server/gtoKeywordPortfolioBalancer.ts"
  "server/optimizationMonitoringService.ts"
  "server/riskActionEngine.ts"
  "Procfile"
  "package.json"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [ -f "$f" ]; then
    echo -e "  ${GREEN}✓ $f${NC}"
  else
    echo -e "  ${RED}✗ $f 缺失${NC}"
    ERRORS=$((ERRORS + 1))
  fi
done

# ---- 检查7: 未提交的更改 ----
echo ""
echo "🔍 检查7: Git状态"

UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l)
if [ "$UNCOMMITTED" -eq 0 ]; then
  echo -e "  ${GREEN}✓ 所有更改已提交${NC}"
else
  echo -e "  ${YELLOW}⚠ 有${UNCOMMITTED}个未提交的更改${NC}"
  WARNINGS=$((WARNINGS + 1))
fi

# ---- 汇总 ----
echo ""
echo "=========================================="
if [ $ERRORS -gt 0 ]; then
  echo -e "  ${RED}❌ 检查失败: ${ERRORS}个错误, ${WARNINGS}个警告${NC}"
  echo -e "  ${RED}请修复所有错误后再部署${NC}"
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  echo -e "  ${YELLOW}⚠ 检查通过（有警告）: ${WARNINGS}个警告${NC}"
  echo -e "  ${YELLOW}建议修复警告后再部署${NC}"
  exit 0
else
  echo -e "  ${GREEN}✅ 所有检查通过，可以部署${NC}"
  exit 0
fi
echo "=========================================="
