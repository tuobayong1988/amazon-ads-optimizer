#!/bin/bash
set -e

cd /var/app/staging

# 安装pnpm
npm install -g pnpm@10.4.1

# 使用pnpm安装依赖
pnpm install --frozen-lockfile

# 构建项目
pnpm build
