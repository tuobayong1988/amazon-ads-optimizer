#!/bin/bash

###############################################################################
# Amazon广告优化系统 - 生产环境自动化部署脚本 v2
#
# 功能:
#   1. 预检查: 验证AWS凭证、代码状态、构建环境
#   2. 构建: 前端+后端一体化构建
#   3. 打包: 创建包含node_modules的完整部署包
#   4. 部署: 上传S3 → 创建EB版本 → 更新环境
#   5. 验证: 等待部署完成 → 验证版本号 → 健康检查
#   6. 回滚: 部署失败时自动回滚到上一个版本
#
# 用法:
#   ./scripts/deploy-production.sh              # 完整部署（构建+部署+验证）
#   ./scripts/deploy-production.sh --skip-build # 跳过构建（使用已有dist）
#   ./scripts/deploy-production.sh --dry-run    # 只构建打包，不实际部署
#
# 环境要求:
#   - AWS CLI已配置（~/.aws/credentials）
#   - Node.js 20+ 和 pnpm
#   - 项目根目录执行
#
# 作者: Manus AI
# 日期: 2026-02-25
###############################################################################

set -euo pipefail

# ============================================================
# 配置
# ============================================================

# AWS/EB配置
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
EB_APP_NAME="amazon-ads-optimizer"
EB_ENV_NAME="amazon-ads-env-prod-v2"
S3_BUCKET="elasticbeanstalk-us-east-1-696154297094"
PROD_URL="http://amazon-ads-env-prod-v2.eba-uhm6tipg.us-east-1.elasticbeanstalk.com"

# OPS API配置
OPS_API_KEY="${OPS_API_KEY:-9adYxHBc8XTE9uwuje3-cegKy6rbzbwfS36Ld3duZ-o}"

# 超时配置
DEPLOY_TIMEOUT=600          # 部署超时（秒）
HEALTH_CHECK_TIMEOUT=120    # 健康检查超时（秒）
VERSION_CHECK_RETRIES=10    # 版本验证重试次数
VERSION_CHECK_INTERVAL=30   # 版本验证间隔（秒）

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 参数解析
SKIP_BUILD=false
DRY_RUN=false
for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
    --dry-run) DRY_RUN=true ;;
    --help) echo "用法: $0 [--skip-build] [--dry-run]"; exit 0 ;;
  esac
done

# ============================================================
# 工具函数
# ============================================================

log_info()  { echo -e "${GREEN}[INFO]${NC} $(date '+%H:%M:%S') $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $(date '+%H:%M:%S') $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date '+%H:%M:%S') $1"; }
log_step()  { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${BLUE}[STEP]${NC} $1"; echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

cleanup() {
  if [ -n "${TEMP_DIR:-}" ] && [ -d "$TEMP_DIR" ]; then
    log_info "清理临时目录: $TEMP_DIR"
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

# ============================================================
# 步骤1: 预检查
# ============================================================

pre_check() {
  log_step "步骤1/6: 预检查"
  
  # 确认在项目根目录
  if [ ! -f "package.json" ] || [ ! -d "server" ]; then
    log_error "请在项目根目录执行此脚本"
    exit 1
  fi
  
  # 检查AWS CLI
  if ! command -v aws &>/dev/null; then
    log_error "AWS CLI未安装"
    exit 1
  fi
  
  # 验证AWS凭证
  if ! aws sts get-caller-identity --region "$AWS_REGION" &>/dev/null; then
    log_error "AWS凭证无效，请检查 ~/.aws/credentials"
    exit 1
  fi
  log_info "AWS凭证验证通过"
  
  # 检查EB环境状态
  local env_status
  env_status=$(aws elasticbeanstalk describe-environments \
    --application-name "$EB_APP_NAME" \
    --environment-names "$EB_ENV_NAME" \
    --region "$AWS_REGION" \
    --query "Environments[0].Status" --output text 2>/dev/null)
  
  if [ "$env_status" != "Ready" ]; then
    log_error "EB环境状态不是Ready（当前: $env_status），请等待环境就绪后再部署"
    exit 1
  fi
  log_info "EB环境状态: Ready"
  
  # 获取当前生产版本（用于回滚）
  CURRENT_VERSION=$(aws elasticbeanstalk describe-environments \
    --application-name "$EB_APP_NAME" \
    --environment-names "$EB_ENV_NAME" \
    --region "$AWS_REGION" \
    --query "Environments[0].VersionLabel" --output text 2>/dev/null)
  log_info "当前生产版本: $CURRENT_VERSION"
  
  # 获取代码中的SYSTEM_VERSION
  SYSTEM_VERSION=$(grep -oP 'SYSTEM_VERSION\s*=\s*\K\d+' server/utils/systemVersion.ts 2>/dev/null || echo "unknown")
  log_info "代码SYSTEM_VERSION: $SYSTEM_VERSION"
  
  # 获取git commit
  GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
  log_info "Git: $GIT_BRANCH @ $GIT_COMMIT"
  
  # 检查是否有未提交的变更
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    log_warn "存在未提交的代码变更，建议先提交"
    git status --short
  fi
}

# ============================================================
# 步骤2: 构建
# ============================================================

build_app() {
  log_step "步骤2/6: 构建应用"
  
  if [ "$SKIP_BUILD" = true ]; then
    log_info "跳过构建（--skip-build）"
    if [ ! -f "dist/index.js" ]; then
      log_error "dist/index.js不存在，无法跳过构建"
      exit 1
    fi
    return
  fi
  
  # 安装依赖
  log_info "检查依赖..."
  if [ -d "node_modules" ]; then
    log_info "node_modules/已存在，复用当前已验证依赖"
  elif [ -f "package-lock.json" ]; then
    log_info "node_modules/不存在，使用npm ci安装依赖"
    npm ci
  else
    log_info "node_modules/不存在且未找到package-lock.json，使用npm install安装依赖"
    npm install
  fi
  
  # 构建
  log_info "构建前端+后端..."
  npm run build
  
  # 验证构建产物
  if [ ! -f "dist/index.js" ]; then
    log_error "构建失败: dist/index.js不存在"
    exit 1
  fi
  
  if [ ! -d "dist/public" ]; then
    log_error "构建失败: dist/public/不存在"
    exit 1
  fi
  
  local js_size
  js_size=$(wc -c < dist/index.js)
  log_info "构建产物: dist/index.js ($(numfmt --to=iec $js_size))"
  log_info "前端文件: $(find dist/public -type f | wc -l) 个文件"
}

# ============================================================
# 步骤3: 创建部署包
# ============================================================

create_package() {
  log_step "步骤3/6: 创建部署包"
  
  TEMP_DIR=$(mktemp -d)
  VERSION_LABEL="app-v${SYSTEM_VERSION}-${GIT_COMMIT}"
  PACKAGE_FILE="/tmp/${VERSION_LABEL}.zip"
  
  log_info "版本标签: $VERSION_LABEL"
  log_info "临时目录: $TEMP_DIR"
  
  # 复制构建产物
  log_info "复制dist/..."
  cp -r dist "$TEMP_DIR/"
  
  # 复制package.json（EB需要）
  cp package.json "$TEMP_DIR/"
  
  # 复制node_modules（关键！EB不会自动安装）
  log_info "复制node_modules/..."
  cp -r node_modules "$TEMP_DIR/"
  
  # 复制Procfile
  if [ -f "Procfile" ]; then
    cp Procfile "$TEMP_DIR/"
  else
    echo 'web: node --max-old-space-size=2048 --expose-gc dist/index.js' > "$TEMP_DIR/Procfile"
  fi
  
  # 复制.ebextensions
  if [ -d ".ebextensions" ]; then
    cp -r .ebextensions "$TEMP_DIR/"
  fi
  
  # 创建部署元数据文件（用于版本验证）
  cat > "$TEMP_DIR/deploy-meta.json" << METAEOF
{
  "version": "$VERSION_LABEL",
  "systemVersion": $SYSTEM_VERSION,
  "gitCommit": "$GIT_COMMIT",
  "gitBranch": "$GIT_BRANCH",
  "buildTime": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "builder": "deploy-production.sh v2"
}
METAEOF
  
  # 打包
  log_info "创建zip包..."
  cd "$TEMP_DIR"
  zip -r -q "$PACKAGE_FILE" .
  cd - > /dev/null
  
  local pkg_size
  pkg_size=$(wc -c < "$PACKAGE_FILE")
  log_info "部署包: $PACKAGE_FILE ($(numfmt --to=iec $pkg_size))"
  
  # 验证包内容
  local file_count
  file_count=$(unzip -l "$PACKAGE_FILE" | tail -1 | awk '{print $2}')
  log_info "包内文件数: $file_count"
  
  # 关键文件检查
  # 避免在 set -o pipefail 下使用 `unzip | grep -q`：grep 提前命中退出会让 unzip 收到 SIGPIPE，导致误判为缺少文件。
  local package_file_list="$TEMP_DIR/package-file-list.txt"
  unzip -Z1 "$PACKAGE_FILE" > "$package_file_list"
  for check_file in "dist/index.js" "package.json" "Procfile" "node_modules/.package-lock.json"; do
    if ! grep -Fxq "$check_file" "$package_file_list"; then
      # .package-lock.json可能不存在，只警告
      if [ "$check_file" = "node_modules/.package-lock.json" ]; then
        log_warn "包中缺少 $check_file（可能正常）"
      else
        log_error "包中缺少关键文件: $check_file"
        exit 1
      fi
    fi
  done
  log_info "部署包验证通过"
}

# ============================================================
# 步骤4: 上传并部署
# ============================================================

deploy() {
  log_step "步骤4/6: 上传并部署"
  
  if [ "$DRY_RUN" = true ]; then
    log_info "Dry run模式，跳过实际部署"
    log_info "部署包位置: $PACKAGE_FILE"
    return
  fi
  
  # 上传到S3
  log_info "上传到S3..."
  aws s3 cp "$PACKAGE_FILE" "s3://${S3_BUCKET}/deployments/$(basename $PACKAGE_FILE)" \
    --region "$AWS_REGION" --quiet
  log_info "S3上传完成"
  
  # 创建应用版本
  log_info "创建EB应用版本: $VERSION_LABEL"
  aws elasticbeanstalk create-application-version \
    --application-name "$EB_APP_NAME" \
    --version-label "$VERSION_LABEL" \
    --source-bundle S3Bucket="$S3_BUCKET",S3Key="deployments/$(basename $PACKAGE_FILE)" \
    --region "$AWS_REGION" \
    --output text --query "ApplicationVersion.VersionLabel"
  
  # 部署到环境
  log_info "部署到环境: $EB_ENV_NAME"
  aws elasticbeanstalk update-environment \
    --application-name "$EB_APP_NAME" \
    --environment-name "$EB_ENV_NAME" \
    --version-label "$VERSION_LABEL" \
    --region "$AWS_REGION" \
    --output text --query "EnvironmentId"
  
  log_info "部署命令已发送"
}

# ============================================================
# 步骤5: 等待部署完成
# ============================================================

wait_for_deployment() {
  log_step "步骤5/6: 等待部署完成"
  
  if [ "$DRY_RUN" = true ]; then
    log_info "Dry run模式，跳过等待"
    return
  fi
  
  local start_time=$SECONDS
  local last_status=""
  
  while true; do
    local elapsed=$((SECONDS - start_time))
    
    if [ $elapsed -gt $DEPLOY_TIMEOUT ]; then
      log_error "部署超时（${DEPLOY_TIMEOUT}秒），触发回滚"
      rollback
      exit 1
    fi
    
    local env_status
    env_status=$(aws elasticbeanstalk describe-environments \
      --application-name "$EB_APP_NAME" \
      --environment-names "$EB_ENV_NAME" \
      --region "$AWS_REGION" \
      --query "Environments[0].Status" --output text 2>/dev/null)
    
    if [ "$env_status" != "$last_status" ]; then
      log_info "环境状态: $env_status (${elapsed}s)"
      last_status="$env_status"
    fi
    
    if [ "$env_status" = "Ready" ]; then
      # 确认版本标签匹配
      local deployed_version
      deployed_version=$(aws elasticbeanstalk describe-environments \
        --application-name "$EB_APP_NAME" \
        --environment-names "$EB_ENV_NAME" \
        --region "$AWS_REGION" \
        --query "Environments[0].VersionLabel" --output text 2>/dev/null)
      
      if [ "$deployed_version" = "$VERSION_LABEL" ]; then
        log_info "EB部署完成，版本标签匹配: $deployed_version"
        break
      else
        log_warn "EB状态Ready但版本不匹配: 期望=$VERSION_LABEL, 实际=$deployed_version"
        # 可能是部署失败回滚了
        if [ $elapsed -gt 120 ]; then
          log_error "版本不匹配，部署可能失败"
          rollback
          exit 1
        fi
      fi
    fi
    
    sleep 15
  done
  
  # 等待应用启动
  log_info "等待应用启动..."
  sleep 30
}

# ============================================================
# 步骤6: 验证部署
# ============================================================

verify_deployment() {
  log_step "步骤6/6: 验证部署"
  
  if [ "$DRY_RUN" = true ]; then
    log_info "Dry run模式，跳过验证"
    return
  fi
  
  local verified=false
  
  for i in $(seq 1 $VERSION_CHECK_RETRIES); do
    log_info "版本验证尝试 $i/$VERSION_CHECK_RETRIES..."
    
    # 通过OPS API获取运行时版本
    local status_json
    status_json=$(curl -s --max-time 15 "${PROD_URL}/api/ops/status?key=${OPS_API_KEY}" 2>/dev/null || echo "{}")
    
    if [ -z "$status_json" ] || [ "$status_json" = "{}" ]; then
      log_warn "API无响应，等待${VERSION_CHECK_INTERVAL}秒后重试..."
      sleep $VERSION_CHECK_INTERVAL
      continue
    fi
    
    local runtime_version
    runtime_version=$(echo "$status_json" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('system', {}).get('versionNumber', 'unknown'))
except:
    print('error')
" 2>/dev/null)
    
    log_info "运行时SYSTEM_VERSION: $runtime_version, 期望: $SYSTEM_VERSION"
    
    if [ "$runtime_version" = "$SYSTEM_VERSION" ]; then
      log_info "版本验证通过！"
      verified=true
      
      # 额外健康检查
      local health_level
      health_level=$(echo "$status_json" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('health', {}).get('level', 'unknown'))
except:
    print('error')
" 2>/dev/null)
      
      local uptime
      uptime=$(echo "$status_json" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('system', {}).get('uptimeFormatted', 'unknown'))
except:
    print('error')
" 2>/dev/null)
      
      log_info "系统健康: $health_level"
      log_info "运行时间: $uptime"
      break
    fi
    
    sleep $VERSION_CHECK_INTERVAL
  done
  
  if [ "$verified" = false ]; then
    log_error "版本验证失败！生产环境未运行预期版本"
    log_error "期望SYSTEM_VERSION=$SYSTEM_VERSION, 实际=$runtime_version"
    log_warn "触发自动回滚..."
    rollback
    exit 1
  fi
  
  # 检查EB环境健康
  local env_health
  env_health=$(aws elasticbeanstalk describe-environments \
    --application-name "$EB_APP_NAME" \
    --environment-names "$EB_ENV_NAME" \
    --region "$AWS_REGION" \
    --query "Environments[0].Health" --output text 2>/dev/null)
  
  log_info "EB环境健康: $env_health"
  
  if [ "$env_health" = "Red" ]; then
    log_error "EB环境健康状态为Red，触发回滚"
    rollback
    exit 1
  fi
}

# ============================================================
# 回滚
# ============================================================

rollback() {
  if [ -z "${CURRENT_VERSION:-}" ]; then
    log_error "无法回滚: 未记录之前的版本"
    return 1
  fi
  
  log_warn "回滚到版本: $CURRENT_VERSION"
  
  aws elasticbeanstalk update-environment \
    --application-name "$EB_APP_NAME" \
    --environment-name "$EB_ENV_NAME" \
    --version-label "$CURRENT_VERSION" \
    --region "$AWS_REGION" \
    --output text --query "EnvironmentId" 2>/dev/null || true
  
  log_warn "回滚命令已发送，请手动确认环境恢复"
}

# ============================================================
# 部署摘要
# ============================================================

print_summary() {
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  部署成功！${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "  版本标签:     $VERSION_LABEL"
  echo "  SYSTEM_VERSION: $SYSTEM_VERSION"
  echo "  Git Commit:   $GIT_COMMIT ($GIT_BRANCH)"
  echo "  生产URL:      $PROD_URL"
  echo "  OPS监控:      ${PROD_URL}/api/ops/status?key=${OPS_API_KEY}"
  echo ""
  echo "  部署时间:     $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "  上一版本:     $CURRENT_VERSION"
  echo ""
  
  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}  [DRY RUN] 部署包位置: $PACKAGE_FILE${NC}"
    echo ""
  fi
}

# ============================================================
# 主流程
# ============================================================

main() {
  echo ""
  echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║  Amazon广告优化系统 - 生产环境部署 v2        ║${NC}"
  echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
  echo ""
  
  pre_check
  build_app
  create_package
  deploy
  wait_for_deployment
  verify_deployment
  print_summary
}

main "$@"
