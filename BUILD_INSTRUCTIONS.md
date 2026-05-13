# v752 生产环境构建指南

## 构建命令

```bash
npx esbuild server/_core/index.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=esm \
  --outfile=dist/index.js \
  --banner:js="import { fileURLToPath as __esm_fileURLToPath } from 'url'; import { dirname as __esm_dirname } from 'path'; import { createRequire as __esm_createRequire } from 'module'; const __filename = __esm_fileURLToPath(import.meta.url); const __dirname = __esm_dirname(__filename); const require = __esm_createRequire(import.meta.url);" \
  --define:process.env.NODE_ENV='"production"' \
  --external:mysql2 \
  --external:drizzle-orm \
  --external:@aws-sdk/* \
  --external:lightningcss \
  --external:tailwindcss \
  --external:@tailwindcss/* \
  --external:@babel/* \
  --external:vite \
  --external:@vitejs/* \
  --external:vite-plugin-manus-runtime \
  --external:@builder.io/*
```

## 关键构建参数说明

| 参数 | 说明 |
|------|------|
| `--format=esm` | ESM格式，因为package.json中有"type":"module" |
| `--banner:js` | 提供 `__dirname`, `__filename`, `require` polyfill（ESM中不可用） |
| `--define:process.env.NODE_ENV='"production"'` | 编译时消除开发模式代码（vite/HMR等） |
| `--external:vite` | vite仅在开发模式使用，生产环境不需要 |
| `--external:mysql2` | 运行时从node_modules加载（bundled包中包含） |
| `--external:drizzle-orm` | 运行时从node_modules加载 |

## 部署流程

1. 构建 `dist/index.js`
2. 从上一个成功版本的bundled包解压
3. 替换 `dist/index.js`
4. 重新打包为zip
5. 上传到S3: `s3://elasticbeanstalk-us-east-1-408336117167/`
6. 创建EB应用版本
7. 更新环境: `amazon-ads-env-prod-v2`

## 环境变量

- `DB_POOL_SIZE=50` (已通过EB环境配置设置)
- `DB_READ_POOL_SIZE=50`
- `NODE_ENV=production`
