# 部署包结构对比分析与标准化打包方案

## 一、历史版本部署包对比

通过下载和分析S3上过去4个成功部署版本的部署包，发现了关键的结构差异。

| 版本 | 大小 | 文件数 | 状态 | node_modules | server/ | shared/ | drizzle/ | .platform/ | .npmrc |
|------|------|--------|------|-------------|---------|---------|----------|------------|--------|
| **v444** (标杆) | 5.9MB | 661 | 成功 | 无 | 有 | 有 | 有 | 有 | 有 |
| **v431** | 5.8MB | ~660 | 成功 | 无 | 有 | 有 | 有 | 有 | 有 |
| **v428** | 5.8MB | ~660 | 成功 | 无 | 有 | 有 | 有 | 有 | 有 |
| v328-298 | 39.3MB | 3816 | 成功 | **有** | 有 | 有 | 有 | 有 | 有 |
| v452.13 (旧) | 9.9MB | 203 | 成功* | 无 | **缺** | **缺** | **缺** | 有 | **缺** |
| v453 (旧) | 9.9MB | 195 | 失败 | 无 | **缺** | **缺** | **缺** | **缺** | **缺** |
| **v453-full** (修正) | 6.5MB | 666 | **成功** | 无 | 有 | 有 | 有 | 有 | 有 |

> *v452.13虽然部署成功，但缺少server/、shared/、drizzle/等关键目录，可能导致运行时功能不完整（如数据库自动迁移无法执行、动态import解析失败等）。

## 二、v444（标杆版本）的完整结构

```
.npmrc                              # npm配置（legacy-peer-deps等）
package.json                        # 依赖声明（89个production dependencies）
pnpm-lock.yaml                      # 锁定依赖版本
Procfile                            # EB启动命令: node --max-old-space-size=3072 --expose-gc dist/index.js
tsconfig.json                       # TypeScript配置

.ebextensions/                      # EB配置
  01_node.config                    # Node.js版本配置
  02_nginx.config                   # Nginx反向代理配置
  03_graceful_shutdown.config       # 优雅关闭配置
  04_autoscaling.config             # 自动扩缩容配置

.platform/                          # EB平台hooks
  hooks/prebuild/01_setup_npmrc.sh  # 设置.npmrc到webapp用户目录
  hooks/predeploy/01_install_deps.sh # npm install --production
  nginx/conf.d/graceful_shutdown.conf # Nginx优雅关闭配置

dist/                               # 构建产物
  index.js                          # 服务端bundle（esbuild打包，~7-9MB）
  *.ts                              # 自动生成的wrapper stub文件（指向server/源码）
  public/                           # 前端静态资源（Vite构建）
    index.html
    assets/*.js
    assets/*.css

server/                             # 服务端源码（被dist/*.ts stub文件引用）
shared/                             # 共享类型和常量
drizzle/                            # 数据库迁移文件
  *.sql                             # SQL迁移脚本
  meta/                             # Drizzle元数据
  schema.ts                         # 数据库schema定义
```

### 关键发现：dist/*.ts stub文件的作用

dist/目录中的.ts文件是v422版本引入的wrapper stub文件，用于动态import解析：

```typescript
// dist/db.ts
export * from './../server/db';

// dist/optimizationScheduler.ts
export * from './../server/optimization/optimizationScheduler';
```

这意味着 **server/ 目录是运行时必需的**，因为dist/index.js中的动态import会通过这些stub文件解析到server/源码。

## 三、标准打包命令

```bash
cd /home/ubuntu/amazon-ads-optimizer

# 1. 构建前端
npx vite build

# 2. 构建后端
node build-server.js

# 3. 打包（按v444标杆结构）
zip -r /tmp/deploy.zip \
  .npmrc \
  package.json \
  pnpm-lock.yaml \
  Procfile \
  tsconfig.json \
  .ebextensions/ \
  .platform/ \
  dist/ \
  server/ \
  shared/ \
  drizzle/ \
  -x "dist/*.map" \
  -x "server/__tests__/*" \
  -x "server/_archived/*" \
  -x "server/_debug/*" \
  -x "server/scripts/*" \
  -x "*.test.*" \
  -x "*.spec.*"

# 预期大小：5-7MB，600-700个文件
```

## 四、部署验证清单

1. 包大小在5-7MB范围内（过大说明包含了不必要的文件，过小说明缺少关键目录）
2. 顶层目录必须包含：`.npmrc`, `package.json`, `pnpm-lock.yaml`, `Procfile`, `tsconfig.json`, `.ebextensions/`, `.platform/`, `dist/`, `server/`, `shared/`, `drizzle/`
3. `dist/index.js` 存在且大小在5-10MB
4. `dist/public/` 包含前端资源
5. `dist/*.ts` stub文件存在
6. `server/` 源码目录完整
7. `drizzle/` 迁移SQL文件完整
