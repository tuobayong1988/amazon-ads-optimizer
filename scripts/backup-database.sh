#!/bin/bash

# 数据库备份脚本
# 用于Amazon Ads Optimizer系统

set -e

# 配置
BACKUP_DIR="/home/ubuntu/backups/database"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup-$TIMESTAMP.sql.gz"

# 从环境变量或DATABASE_URL解析数据库连接信息
if [ -n "$DATABASE_URL" ]; then
  # 解析DATABASE_URL格式: mysql://user:pass@host:port/dbname
  DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
  DB_PASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
  DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
  DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
  DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
else
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-3306}"
  DB_NAME="${DB_NAME:-amazon_ads_optimizer}"
  DB_USER="${DB_USER:-root}"
  DB_PASSWORD="${DB_PASSWORD}"
fi

# S3配置(可选)
S3_BUCKET="${S3_BACKUP_BUCKET:-}"

echo "========================================="
echo "Amazon Ads Optimizer - 数据库备份"
echo "========================================="
echo ""
echo "时间: $(date)"
echo "数据库: $DB_NAME"
echo "主机: $DB_HOST:$DB_PORT"
echo "备份文件: $BACKUP_FILE"
echo ""

# 创建备份目录
mkdir -p $BACKUP_DIR

# 检查mysqldump是否可用
if ! command -v mysqldump &> /dev/null; then
  echo "错误: mysqldump 未安装"
  echo "请安装: sudo apt-get install mysql-client"
  exit 1
fi

# 执行备份
echo "[1/4] 开始备份数据库..."
if [ -n "$DB_PASSWORD" ]; then
  mysqldump \
    --host=$DB_HOST \
    --port=$DB_PORT \
    --user=$DB_USER \
    --password=$DB_PASSWORD \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --hex-blob \
    --databases $DB_NAME \
    2>/dev/null | gzip > $BACKUP_FILE
else
  mysqldump \
    --host=$DB_HOST \
    --port=$DB_PORT \
    --user=$DB_USER \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --hex-blob \
    --databases $DB_NAME \
    2>/dev/null | gzip > $BACKUP_FILE
fi

# 检查备份文件
if [ -f "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "✓ 备份完成! 文件大小: $SIZE"
else
  echo "✗ 备份失败!"
  exit 1
fi

# 上传到S3(如果配置了)
if [ -n "$S3_BUCKET" ]; then
  echo ""
  echo "[2/4] 上传备份到S3..."
  if command -v aws &> /dev/null; then
    aws s3 cp $BACKUP_FILE $S3_BUCKET/database/$(basename $BACKUP_FILE)
    echo "✓ S3上传完成"
  else
    echo "⚠ AWS CLI未安装,跳过S3上传"
  fi
else
  echo ""
  echo "[2/4] 跳过S3上传(未配置S3_BACKUP_BUCKET)"
fi

# 验证备份
echo ""
echo "[3/4] 验证备份文件..."
if gunzip -t $BACKUP_FILE 2>/dev/null; then
  echo "✓ 备份文件完整"
else
  echo "✗ 备份文件损坏!"
  exit 1
fi

# 清理旧备份
echo ""
echo "[4/4] 清理超过 $RETENTION_DAYS 天的旧备份..."
DELETED=$(find $BACKUP_DIR -name "backup-*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
echo "✓ 已删除 $DELETED 个旧备份文件"

echo ""
echo "========================================="
echo "备份任务完成!"
echo "========================================="
echo ""
echo "备份文件: $BACKUP_FILE"
echo "文件大小: $(du -h $BACKUP_FILE | cut -f1)"
echo "保留期限: $RETENTION_DAYS 天"
echo ""
echo "恢复命令:"
echo "  gunzip -c $BACKUP_FILE | mysql -h \$DB_HOST -u \$DB_USER -p \$DB_NAME"
echo ""
