#!/bin/bash

# Amazon广告优化系统部署脚本
# 用于构建和部署应用到生产环境

set -e

echo "========================================="
echo "Amazon广告优化系统 - 部署脚本"
echo "========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查环境变量
check_env() {
    echo -e "${YELLOW}检查环境变量...${NC}"
    
    if [ -z "$DATABASE_URL" ]; then
        echo -e "${RED}错误: DATABASE_URL 未设置${NC}"
        exit 1
    fi
    
    if [ -z "$JWT_SECRET" ]; then
        echo -e "${RED}错误: JWT_SECRET 未设置${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ 环境变量检查通过${NC}"
}

# 安装依赖
install_dependencies() {
    echo -e "${YELLOW}安装依赖...${NC}"
    pnpm install --frozen-lockfile
    echo -e "${GREEN}✓ 依赖安装完成${NC}"
}

# 构建前端
build_client() {
    echo -e "${YELLOW}构建前端应用...${NC}"
    cd client
    pnpm run build
    cd ..
    echo -e "${GREEN}✓ 前端构建完成${NC}"
}

# 构建后端
build_server() {
    echo -e "${YELLOW}构建后端应用...${NC}"
    pnpm run build
    echo -e "${GREEN}✓ 后端构建完成${NC}"
}

# 数据库迁移
run_migrations() {
    echo -e "${YELLOW}运行数据库迁移...${NC}"
    pnpm run db:push
    echo -e "${GREEN}✓ 数据库迁移完成${NC}"
}

# 创建部署包
create_deployment_package() {
    echo -e "${YELLOW}创建部署包...${NC}"
    
    DEPLOY_DIR="deploy_$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$DEPLOY_DIR"
    
    # 复制必要文件
    cp -r dist "$DEPLOY_DIR/"
    cp -r client/dist "$DEPLOY_DIR/client-dist"
    cp package.json "$DEPLOY_DIR/"
    cp pnpm-lock.yaml "$DEPLOY_DIR/"
    cp -r node_modules "$DEPLOY_DIR/" 2>/dev/null || echo "跳过node_modules复制"
    
    # 创建启动脚本
    cat > "$DEPLOY_DIR/start.sh" << 'EOF'
#!/bin/bash
export NODE_ENV=production
node dist/index.js
EOF
    chmod +x "$DEPLOY_DIR/start.sh"
    
    # 创建压缩包
    tar -czf "${DEPLOY_DIR}.tar.gz" "$DEPLOY_DIR"
    rm -rf "$DEPLOY_DIR"
    
    echo -e "${GREEN}✓ 部署包创建完成: ${DEPLOY_DIR}.tar.gz${NC}"
}

# 启动应用
start_application() {
    echo -e "${YELLOW}启动应用...${NC}"
    
    # 停止旧进程
    pkill -f "node dist/index.js" || true
    
    # 启动新进程
    NODE_ENV=production nohup node dist/index.js > app.log 2>&1 &
    
    echo -e "${GREEN}✓ 应用已启动${NC}"
    echo -e "${GREEN}日志文件: app.log${NC}"
}

# 健康检查
health_check() {
    echo -e "${YELLOW}执行健康检查...${NC}"
    
    sleep 5
    
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ 应用健康检查通过${NC}"
    else
        echo -e "${RED}✗ 应用健康检查失败${NC}"
        echo -e "${YELLOW}查看日志: tail -f app.log${NC}"
        exit 1
    fi
}

# 主流程
main() {
    echo ""
    echo "开始部署流程..."
    echo ""
    
    check_env
    install_dependencies
    build_client
    build_server
    run_migrations
    create_deployment_package
    start_application
    health_check
    
    echo ""
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}部署完成!${NC}"
    echo -e "${GREEN}=========================================${NC}"
    echo ""
    echo "应用地址: http://localhost:3000"
    echo "查看日志: tail -f app.log"
    echo ""
}

# 执行主流程
main
