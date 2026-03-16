# 3. 前端模块说明

## 3.1 目录结构 (重构后)

```
client/src/
├── App.tsx             # 应用根组件和路由
├── main.tsx            # 入口文件
├── assets/             # 静态资源
├── components/         # 可复用UI组件
│   ├── ui/             # 基础UI组件 (Button, Input, ...)
│   └── shared/         # 共享业务组件
├── features/           # 功能模块 (按页面功能划分)
│   ├── campaigns/      # 广告活动相关
│   ├── dashboard/      # 仪表盘
│   └── ...
├── hooks/              # 自定义React Hooks
├── lib/                # 工具函数和tRPC客户端
├── styles/             # 全局样式
└── types/              # 前端类型定义
```

## 3.2 关键模块

| 模块路径 | 描述 |
|---|---|
| `client/src/App.tsx` | **应用根组件**：定义了应用的主布局和前端路由（使用`wouter`）。所有页面组件在这里被懒加载。 |
| `client/src/lib/trpc.ts` | **tRPC客户端**：创建并导出了tRPC客户端实例，用于在前端调用后端API。 |
| `client/src/features/` | **功能模块**：按业务功能组织页面和相关组件。例如，`features/campaigns/`包含广告活动列表、详情页等所有相关代码。 |
| `client/src/components/ui/` | **基础UI库**：基于`radix-ui`和`tailwind-merge`封装的基础UI组件，例如`Button`, `Input`, `Table`等。 |
| `client/src/hooks/` | **自定义Hooks**：存放可复用的React Hooks，例如`useDebounce`, `useLocalStorage`等。 |
