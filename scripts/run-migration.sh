#!/bin/bash

# 数据库迁移执行脚本
# 用法: ./scripts/run-migration.sh

set -e

echo "========================================="
echo "Amazon广告优化系统 - 数据库迁移"
echo "========================================="
echo ""

# 检查环境变量
if [ -z "$DATABASE_URL" ]; then
  echo "❌ 错误: DATABASE_URL 环境变量未设置"
  echo "请在.env文件中配置数据库连接信息"
  exit 1
fi

# 解析数据库连接信息
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
DB_PASS=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')

echo "📊 数据库信息:"
echo "  主机: $DB_HOST"
echo "  端口: $DB_PORT"
echo "  数据库: $DB_NAME"
echo "  用户: $DB_USER"
echo ""

# 备份数据库
echo "📦 备份当前数据库..."
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
mysqldump -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASS $DB_NAME > "/tmp/$BACKUP_FILE" 2>/dev/null || {
  echo "⚠️  警告: 数据库备份失败,继续执行迁移可能有风险"
  read -p "是否继续? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
}
echo "✓ 备份完成: /tmp/$BACKUP_FILE"
echo ""

# 执行迁移
echo "🚀 执行数据库迁移..."
MIGRATION_FILE=$1

if [ -z "$MIGRATION_FILE" ]; then
  echo "❌ 错误: 请提供迁移文件的路径作为第一个参数"
  echo "用法: ./scripts/run-migration.sh [path/to/migration.sql]"
  exit 1
fi

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "❌ 错误: 迁移文件不存在: $MIGRATION_FILE"
  exit 1
fi

mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASS $DB_NAME < $MIGRATION_FILE 2>&1 | tee /tmp/migration.log

if [ ${PIPESTATUS[0]} -eq 0 ]; then
  echo ""
  echo "✅ 数据库迁移成功完成!"
else
  echo ""
  echo "❌ 数据库迁移失败,请查看日志: /tmp/migration.log"
  echo "可以使用以下命令恢复数据库:"
  echo "  mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASS $DB_NAME < /tmp/$BACKUP_FILE"
  exit 1
fi

# 验证步骤已简化，因为这是一个通用脚本
echo ""
echo "🔍 迁移脚本执行完毕，请手动验证结果。"

echo ""
echo "========================================="
echo "✅ 迁移完成!"
echo "========================================="
echo ""
echo "下一步:"
echo "1. 运行数据填充脚本: pnpm tsx scripts/seed-ml-training-data.ts all"
echo "2. 重启应用: pnpm run dev"
echo ""
