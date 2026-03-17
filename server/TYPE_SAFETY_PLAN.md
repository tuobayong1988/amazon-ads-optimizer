# 类型安全提升计划 (v361 → v427)

## v427 改进成果

| 指标 | v361 状态 | v427 状态 | 改善 |
| :--- | :--- | :--- | :--- |
| `@ts-ignore` | ~1,108 | 0 (代码中) | **100% 消除** |
| `@ts-expect-error` | 10 | 911 (全部有注释) | 从 @ts-ignore 迁移 |
| 类型工具库 | 无 | `server/types/utilTypes.ts` | 新增 |
| 类型分类 | 无 | 30 种注释分类 | 新增 |

### v427 核心改动

1. **消除所有 @ts-ignore**：将 1,040 个 `@ts-ignore` 全部替换为 `@ts-expect-error`
2. **统一工具类型库** (`server/types/utilTypes.ts`)：AxiosLikeError, MySQLExecuteResult, extractRows, extractCount, getErrorMessage 等
3. **描述性注释**：所有 911 个 `@ts-expect-error` 都附带了分类注释

### @ts-expect-error 分类分布

| 分类 | 数量 | 优先级 | 建议方案 |
| :--- | :--- | :--- | :--- |
| runtime type mismatch | 334 | 中 | 逐步添加接口定义 |
| type assertion | 109 | 低 | 替换为具体类型 |
| dynamic property access | 75 | 中 | 使用类型守卫 |
| Drizzle raw SQL execution | 62 | 高 | 使用 extractRows/extractCount |
| Drizzle query builder type | 54 | 中 | 升级 Drizzle 类型推导 |
| Axios error response access | 50 | 高 | 使用 AxiosLikeError |
| runStep type inference | 29 | 中 | 修复 runStep 签名 |
| error message access | 26 | 高 | 使用 getErrorMessage() |
| 其他 | 172 | 低 | 逐步处理 |

## 编码规范

1. **新代码禁止使用** `@ts-ignore`，必须使用 `@ts-expect-error` 并附带说明
2. **优先使用** `server/types/utilTypes.ts` 中的工具类型和函数
3. **逐步替换** `: any` 为具体接口或 `unknown`
4. **类型断言** 优先使用 `as Type` 而非 `as any`
5. **错误处理** 使用 `getErrorMessage()` 而非 `(error as any).message`
6. **数据库结果** 使用 `extractRows()` / `extractCount()` 而非手动类型断言
