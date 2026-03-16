# 部署问题报告与解决方案

## 问题总结

在尝试部署新版本(v89)到生产环境时,遇到了应用无法启动的问题,导致环境健康状态为Red,所有请求返回502 Bad Gateway错误。

## 根本原因

**模块系统不匹配**

1. **问题**: 构建后的`dist/index.js`文件包含ES模块的`import`语句
2. **原因**: TypeScript编译器(tsc)配置为输出ES模块格式,但没有进行打包
3. **影响**: Node.js无法解析这些`import`语句,导致应用启动失败并抛出`ERR_MODULE_NOT_FOUND`错误

## 技术细节

### 错误日志
```
Feb 13 07:40:55 ip-172-31-0-4 web[34100]: code: 'ERR_MODULE_NOT_FOUND'
Feb 13 07:40:55 ip-172-31-0-4 web[34100]: Node.js v20.19.5
```

### 配置问题
- `package.json`中设置了`"type": "module"`
- `tsconfig.server.json`配置为输出ESNext模块
- 构建后的代码包含裸import语句(如`import { mysqlTable } from "drizzle-orm/mysql-core"`)
- 这些依赖没有被打包到最终的bundle中

## 解决方案

### 方案A: 使用打包工具 (推荐)

使用esbuild或webpack将所有依赖打包成单个文件:

```bash
# 安装esbuild
pnpm add -D esbuild

# 创建构建脚本
cat > build-server.js << 'EOF'
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/index.js',
  external: ['pg-native'],
  format: 'cjs',
  sourcemap: true,
}).catch(() => process.exit(1));
EOF

# 更新package.json中的build脚本
"build": "vite build --config vite.build.config.ts && node build-server.js"
```

### 方案B: 使用CommonJS格式

修改TypeScript配置输出CommonJS格式并移除package.json中的type字段:

1. 修改`tsconfig.server.json`:
```json
{
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node"
  }
}
```

2. 从`package.json`中移除`"type": "module"`

3. 修复所有TypeScript类型错误(约200+个错误)

### 方案C: 保持ES模块但正确配置

1. 保留`"type": "module"`
2. 确保所有import路径包含文件扩展名
3. 使用node的--experimental-specifier-resolution=node标志

## 当前状态

- ✅ 已回滚到稳定版本 `v88-fix-sync-timeout`
- ⏳ 环境正在更新中
- ❌ v89版本因模块问题无法部署

## 后续行动计划

1. **立即**: 等待回滚完成,确认生产环境恢复正常
2. **短期** (1-2天): 
   - 在开发环境实施方案A(使用esbuild打包)
   - 修复所有TypeScript类型错误
   - 在测试环境验证新的构建配置
3. **中期** (1周):
   - 完成所有集成测试
   - 重新部署v89到Staging环境
   - 收集反馈并修复问题
4. **长期**: 按照灰度发布计划部署到生产环境

## 经验教训

1. **构建验证**: 部署前应在本地验证构建产物能否正常运行
2. **渐进式部署**: 应先部署到测试/Staging环境,而非直接生产
3. **回滚准备**: 始终准备好快速回滚方案
4. **监控告警**: 部署后立即监控应用日志和健康状态

## 附录

### 快速验证构建产物的命令
```bash
# 构建后测试
cd /home/ubuntu/amazon-ads-optimizer
pnpm run build
NODE_ENV=production node dist/index.js

# 如果启动成功,应该看到类似输出:
# Server listening on port 3000
```

### 相关文件
- `/home/ubuntu/amazon-ads-optimizer/tsconfig.server.json`
- `/home/ubuntu/amazon-ads-optimizer/package.json`
- `/home/ubuntu/amazon-ads-optimizer/dist/index.js`
