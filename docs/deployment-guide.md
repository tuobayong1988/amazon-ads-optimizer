# Amazon广告优化系统 - 部署指南

## 概述

本文档提供了Amazon广告优化系统的完整部署指南,包括环境准备、构建、部署和验证步骤。

## 系统要求

### 硬件要求
- CPU: 2核或以上
- 内存: 4GB或以上
- 磁盘: 20GB可用空间

### 软件要求
- Node.js: v18.0.0或以上
- pnpm: v8.0.0或以上
- MySQL: v8.0或以上
- Git: v2.0或以上

## 环境变量配置

在部署前,需要配置以下环境变量:

```bash
# 数据库配置
DATABASE_URL=mysql://user:password@host:3306/database

# JWT配置
JWT_SECRET=your-secret-key-here

# Amazon Ads API配置
AMAZON_ADS_CLIENT_ID=your-client-id
AMAZON_ADS_CLIENT_SECRET=your-client-secret
AMAZON_ADS_REFRESH_TOKEN=your-refresh-token

# AWS配置(可选)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# 应用配置
NODE_ENV=production
PORT=3000
```

## 部署步骤

### 1. 克隆代码仓库

```bash
git clone https://github.com/tuobayong1988/amazon-ads-optimizer.git
cd amazon-ads-optimizer
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

创建 `.env` 文件:

```bash
cp .env.example .env
# 编辑 .env 文件,填入实际配置
nano .env
```

### 4. 数据库初始化

```bash
# 运行数据库迁移
pnpm run db:push

# (可选)导入初始数据
pnpm run db:seed
```

### 5. 构建应用

```bash
# 构建前端
cd client
pnpm run build
cd ..

# 构建后端
pnpm run build
```

### 6. 启动应用

```bash
# 使用部署脚本
./scripts/deploy.sh

# 或手动启动
NODE_ENV=production node dist/index.js
```

### 7. 验证部署

```bash
# 检查应用状态
curl http://localhost:3000/health

# 查看日志
tail -f app.log
```

## 使用Docker部署(推荐)

### 1. 构建Docker镜像

```bash
docker build -t amazon-ads-optimizer:latest .
```

### 2. 运行容器

```bash
docker run -d \
  --name amazon-ads-optimizer \
  -p 3000:3000 \
  -e DATABASE_URL="mysql://user:password@host:3306/database" \
  -e JWT_SECRET="your-secret-key" \
  amazon-ads-optimizer:latest
```

### 3. 使用Docker Compose

```bash
docker-compose up -d
```

## 生产环境优化

### 1. 使用PM2管理进程

```bash
# 安装PM2
npm install -g pm2

# 启动应用
pm2 start dist/index.js --name amazon-ads-optimizer

# 设置开机自启
pm2 startup
pm2 save
```

### 2. 配置Nginx反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. 配置SSL证书

```bash
# 使用Let's Encrypt
sudo certbot --nginx -d your-domain.com
```

## 监控和日志

### 1. 应用日志

```bash
# 查看实时日志
tail -f app.log

# 查看错误日志
grep ERROR app.log
```

### 2. CloudWatch监控

参考 `docs/cloudwatch-monitoring.md` 配置CloudWatch监控和告警。

### 3. 数据库备份

参考 `docs/database-backup.md` 配置自动备份策略。

## 故障排查

### 应用无法启动

1. 检查环境变量是否正确配置
2. 检查数据库连接是否正常
3. 查看应用日志获取详细错误信息

### 数据库连接失败

1. 验证DATABASE_URL格式是否正确
2. 检查数据库服务是否运行
3. 验证数据库用户权限

### API调用失败

1. 检查Amazon Ads API凭证是否有效
2. 验证refresh token是否过期
3. 查看API调用日志

## 更新和回滚

### 更新应用

```bash
# 拉取最新代码
git pull origin main

# 安装新依赖
pnpm install

# 重新构建
pnpm run build

# 重启应用
pm2 restart amazon-ads-optimizer
```

### 回滚版本

```bash
# 切换到指定版本
git checkout v1.0.0

# 重新构建和部署
./scripts/deploy.sh
```

## 安全建议

1. **使用强密码**: JWT_SECRET应使用强随机字符串
2. **限制数据库访问**: 仅允许应用服务器IP访问数据库
3. **启用HTTPS**: 生产环境必须使用SSL/TLS加密
4. **定期更新**: 及时更新依赖包修复安全漏洞
5. **备份数据**: 定期备份数据库和重要配置文件

## 性能优化

1. **数据库索引**: 为常用查询字段添加索引
2. **缓存策略**: 使用Redis缓存热点数据
3. **负载均衡**: 使用多实例部署提高可用性
4. **CDN加速**: 静态资源使用CDN分发

## 支持和反馈

如有问题或建议,请通过以下方式联系:

- GitHub Issues: https://github.com/tuobayong1988/amazon-ads-optimizer/issues
- Email: support@example.com

## 版本历史

- v1.0.0 (2024-01-15): 初始版本发布
- v1.1.0 (2024-02-13): 添加趋势预测、异常检测、批量导出等功能

## 许可证

MIT License
