# 4. 开发指南

## 4.1 环境搭建

1. **安装pnpm**: `npm install -g pnpm`
2. **安装依赖**: `pnpm install`
3. **配置环境变量**: 复制`.env.example`为`.env`，并填入数据库和Amazon API凭证。

## 4.2 本地开发

- **启动前端**: `pnpm dev` (会同时代理后端请求)
- **单独启动后端**: `pnpm dev:server`

## 4.3 代码规范

- **格式化**: 使用Prettier进行代码格式化，提交前会自动执行。
- **命名**: 
    - 文件名: `kebab-case.ts`
    - 变量/函数: `camelCase`
    - 类/类型: `PascalCase`
- **tRPC**: 遵循tRPC的最佳实践，保持前后端类型安全。

## 4.4 创建新功能模块 (示例)

1. **后端**:
    - 在`server/db/`下创建新的schema文件 (如果需要新表)。
    - 在`server/services/`下创建新的服务文件，实现业务逻辑。
    - 在`server/api/`下创建新的路由文件，暴露API。
    - 在`server/routers.ts`中注册新路由。
2. **前端**:
    - 在`client/src/features/`下创建新的功能目录。
    - 创建页面组件和相关子组件。
    - 在`client/src/App.tsx`中添加新页面的路由。
    - 使用`trpc`客户端调用API。
