#!/bin/bash

###############################################################################
# AWS Elastic Beanstalk 自动化部署脚本
#
# 用途: 将Amazon广告优化系统部署到AWS Elastic Beanstalk
# 作者: Manus AI
# 日期: 2026-02-13
###############################################################################

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查必需的环境变量
check_env_vars() {
    log_info "检查环境变量..."
    
    if [ -z "$AWS_ACCESS_KEY_ID" ]; then
        log_error "AWS_ACCESS_KEY_ID 环境变量未设置"
        exit 1
    fi
    
    if [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
        log_error "AWS_SECRET_ACCESS_KEY 环境变量未设置"
        exit 1
    fi
    
    if [ -z "$AWS_REGION" ]; then
        log_warn "AWS_REGION 未设置,使用默认值 us-east-1"
        export AWS_REGION="us-east-1"
    fi
    
    log_info "环境变量检查完成"
}

# 检查必需的工具
check_tools() {
    log_info "检查必需的工具..."
    
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI 未安装,请先安装: https://aws.amazon.com/cli/"
        exit 1
    fi
    
    if ! command -v eb &> /dev/null; then
        log_error "EB CLI 未安装,请先安装: pip install awsebcli"
        exit 1
    fi
    
    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm 未安装"
        exit 1
    fi
    
    log_info "工具检查完成"
}

# 配置AWS凭证
configure_aws() {
    log_info "配置AWS凭证..."
    
    aws configure set aws_access_key_id "$AWS_ACCESS_KEY_ID"
    aws configure set aws_secret_access_key "$AWS_SECRET_ACCESS_KEY"
    aws configure set default.region "$AWS_REGION"
    
    # 验证凭证
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS凭证验证失败"
        exit 1
    fi
    
    log_info "AWS凭证配置完成"
}

# 构建应用
build_app() {
    log_info "开始构建应用..."
    
    # 安装依赖
    log_info "安装依赖..."
    pnpm install
    
    # 构建前端
    log_info "构建前端..."
    pnpm run build
    
    log_info "应用构建完成"
}

# 创建部署包
create_deployment_package() {
    log_info "创建部署包..."
    
    VERSION=$(git rev-parse --short HEAD)
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    PACKAGE_NAME="amazon-ads-optimizer-${VERSION}-${TIMESTAMP}.zip"
    
    # 创建临时目录
    TEMP_DIR=$(mktemp -d)
    
    # 复制必需的文件
    cp -r build "$TEMP_DIR/"
    cp -r node_modules "$TEMP_DIR/"
    cp package.json "$TEMP_DIR/"
    cp -r server "$TEMP_DIR/"
    cp -r drizzle "$TEMP_DIR/"
    
    # 创建.ebextensions配置
    mkdir -p "$TEMP_DIR/.ebextensions"
    
    # 创建Node.js配置
    cat > "$TEMP_DIR/.ebextensions/nodejs.config" << 'EOF'
option_settings:
  aws:elasticbeanstalk:container:nodejs:
    NodeCommand: "node server/index.js"
    NodeVersion: 22.13.0
  aws:elasticbeanstalk:application:environment:
    NODE_ENV: production
EOF
    
    # 打包
    cd "$TEMP_DIR"
    zip -r "/tmp/$PACKAGE_NAME" .
    cd -
    
    # 清理临时目录
    rm -rf "$TEMP_DIR"
    
    log_info "部署包已创建: /tmp/$PACKAGE_NAME"
    echo "$PACKAGE_NAME"
}

# 上传到S3
upload_to_s3() {
    local PACKAGE_NAME=$1
    local S3_BUCKET="elasticbeanstalk-${AWS_REGION}-$(aws sts get-caller-identity --query Account --output text)"
    
    log_info "上传部署包到S3..."
    
    # 检查bucket是否存在,不存在则创建
    if ! aws s3 ls "s3://${S3_BUCKET}" 2>&1 > /dev/null; then
        log_info "创建S3 bucket: ${S3_BUCKET}"
        aws s3 mb "s3://${S3_BUCKET}" --region "$AWS_REGION"
    fi
    
    # 上传
    aws s3 cp "/tmp/$PACKAGE_NAME" "s3://${S3_BUCKET}/deployments/$PACKAGE_NAME"
    
    log_info "部署包已上传到S3"
    echo "${S3_BUCKET}"
}

# 创建应用版本
create_app_version() {
    local PACKAGE_NAME=$1
    local S3_BUCKET=$2
    local APP_NAME="amazon-ads-optimizer"
    local VERSION_LABEL="${PACKAGE_NAME%.zip}"
    
    log_info "创建应用版本: ${VERSION_LABEL}"
    
    aws elasticbeanstalk create-application-version \
        --application-name "$APP_NAME" \
        --version-label "$VERSION_LABEL" \
        --source-bundle S3Bucket="$S3_BUCKET",S3Key="deployments/$PACKAGE_NAME" \
        --region "$AWS_REGION"
    
    log_info "应用版本已创建"
    echo "$VERSION_LABEL"
}

# 部署到环境
deploy_to_environment() {
    local VERSION_LABEL=$1
    local ENV_NAME=$2
    local APP_NAME="amazon-ads-optimizer"
    
    log_info "部署到环境: ${ENV_NAME}"
    
    aws elasticbeanstalk update-environment \
        --application-name "$APP_NAME" \
        --environment-name "$ENV_NAME" \
        --version-label "$VERSION_LABEL" \
        --region "$AWS_REGION"
    
    log_info "部署命令已发送,等待环境更新..."
    
    # 等待环境更新完成
    aws elasticbeanstalk wait environment-updated \
        --application-name "$APP_NAME" \
        --environment-names "$ENV_NAME" \
        --region "$AWS_REGION"
    
    log_info "环境更新完成"
}

# 主流程
main() {
    log_info "========================================="
    log_info "AWS Elastic Beanstalk 部署开始"
    log_info "========================================="
    
    # 检查环境变量和工具
    check_env_vars
    check_tools
    configure_aws
    
    # 构建应用
    build_app
    
    # 创建部署包
    PACKAGE_NAME=$(create_deployment_package)
    
    # 上传到S3
    S3_BUCKET=$(upload_to_s3 "$PACKAGE_NAME")
    
    # 创建应用版本
    VERSION_LABEL=$(create_app_version "$PACKAGE_NAME" "$S3_BUCKET")
    
    # 部署到Canary环境(金丝雀实例)
    log_info "========================================="
    log_info "部署到Canary环境"
    log_info "========================================="
    deploy_to_environment "$VERSION_LABEL" "amazon-ads-optimizer-canary"
    
    log_info "========================================="
    log_info "部署完成!"
    log_info "========================================="
    log_info "版本标签: ${VERSION_LABEL}"
    log_info "Canary环境URL: $(aws elasticbeanstalk describe-environments --application-name amazon-ads-optimizer --environment-names amazon-ads-optimizer-canary --region $AWS_REGION --query 'Environments[0].CNAME' --output text)"
    log_info ""
    log_info "下一步:"
    log_info "1. 验证Canary环境的健康状态"
    log_info "2. 配置流量切分,开始灰度发布"
    log_info "3. 监控系统指标"
}

# 执行主流程
main
