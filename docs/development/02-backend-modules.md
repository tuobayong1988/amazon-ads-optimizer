# 2. 后端模块说明

## 2.1 目录结构 (重构后)

```
server/
├── _core/          # 核心框架 (trpc, express, ...)
├── api/            # tRPC路由定义 (原routes/)
├── services/       # 业务服务 (按功能域划分)
│   ├── sync/       # 数据同步服务
│   ├── optimization/ # 优化服务
│   ├── budget/     # 预算服务
│   └── ...
├── db/             # 数据库schema和查询
├── jobs/           # 后台任务和调度器
├── types/          # 全局类型定义
└── index.ts        # 入口文件
```

## 2.2 关键模块

| 模块路径 | 描述 |
|---|---|
| `server/_core/` | **核心框架**：封装了Express服务器、tRPC实例、中间件、错误处理等底层逻辑。 |
| `server/api/` | **API层**：定义所有tRPC路由。每个文件对应一个功能域，例如`campaign.ts`, `keyword.ts`。 |
| `server/services/` | **服务层**：实现核心业务逻辑。每个子目录是一个功能域，例如`sync/`处理数据同步，`optimization/`处理广告优化。 |
| `server/db/` | **数据访问层**：使用Drizzle ORM定义数据库表结构(schema)和数据查询方法。 |
| `server/jobs/` | **任务调度层**：包含所有后台任务的定义和调度逻辑，例如数据同步调度器。 |
| `server/amazonAdsApi.ts` | **Amazon API客户端**：封装了对Amazon Ads API的所有HTTP请求，提供类型化的接口。 |
| `server/unifiedSyncEngine.ts` | **统一同步引擎**：定义了数据同步的步骤(SYNC_STEPS)和分层调度逻辑(TIER_HIERARCHY)。 |
