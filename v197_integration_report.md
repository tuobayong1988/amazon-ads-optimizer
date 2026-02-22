# v197 下一代算法体系 — 集成部署报告

## 一、执行摘要

本次升级将**10个下一代核心算法模块**从独立文件状态，**真正集成到了广告优化系统的3个核心业务入口**中，确保新算法在生产环境中参与实际的出价决策、定时维护和API服务。所有代码已通过esbuild编译验证并推送至GitHub仓库。

## 二、集成前的问题诊断

在审查中发现，此前创建的10个算法模块文件虽然代码逻辑完整，但**完全没有被现有业务代码调用**：

| 业务入口文件 | 集成前状态 | 问题 |
|---|---|---|
| `optimizationTargetEngine.ts` | 仅调用 `bidOptimizer.optimizePerformanceGroupEnhanced()` | 新算法完全不参与出价决策 |
| `dataSyncScheduler.ts` | 仅注册了8种定时任务 | 无特征缓存、模型训练、因果分析等维护任务 |
| `routers.ts` | 未导入任何新模块 | 前端无法访问新算法功能 |

这意味着即使部署到生产环境，新算法也**不会产生任何实际效果**。

## 三、集成方案与实施

### 3.1 集成点1：核心出价流程（optimizationTargetEngine.ts）

**修改文件**：`server/optimizationTargetEngine.ts`

**集成策略**：在现有出价优化流程中，对每个关键词和商品定向，**先尝试NextGen算法，失败或不适用时自动回退到现有UCB算法**。

**关键词出价流程（修改后）**：

```
对每个关键词:
  1. 调用 nextGenOrchestrator.calculateNextGenBid()
     - 内部执行: 元学习选择器 → 最优算法(Sigmoid/LinUCB/CQL) → 安全校验 → RL记录
  2. 如果返回结果 → 使用NextGen出价（标记isNextGen=true）
  3. 如果返回null（不在流量中）→ 回退到现有UCB算法
  4. 如果抛出异常 → 记录错误，回退到现有UCB算法
  5. 所有出价均经过v165绝对红线校验
```

**商品定向出价流程**：与关键词相同的集成模式。

**A/B流量分配**：通过 `nextGenBidOrchestrator` 中的 `shouldUseNextGen()` 函数，基于targetId的确定性哈希进行流量分配。初始配置为**30%流量使用新算法**，可通过配置动态调整。

### 3.2 集成点2：定时任务调度（dataSyncScheduler.ts）

**修改文件**：`server/dataSyncScheduler.ts`

新增3个定时任务类型，注册到现有的优化调度器中：

| 任务类型 | 执行频率 | 偏移量 | 功能 |
|---|---|---|---|
| `nextgen_maintenance` | 每4小时 | 41分钟 | 特征缓存、Sigmoid曲线拟合、RL Reward回填、因果推断分析、算法结果回填 |
| `nextgen_model_training` | 每6小时 | 46分钟 | CQL离线强化学习模型训练 |
| `nextgen_budget_optimization` | 每日凌晨2:00 | — | 预算组合优化 + 关键词语义图谱分析 |

每个任务都遍历所有启用的优化目标，对每个账户独立执行，并包含完整的错误处理和日志记录。

### 3.3 集成点3：API路由层（routers.ts）

**修改文件**：`server/routers.ts`

新增 `nextGenRouter` tRPC路由，提供7个API端点：

| 端点 | 类型 | 功能 |
|---|---|---|
| `nextGen.getStatus` | query | 获取NextGen算法系统状态（版本、算法列表、流量比例） |
| `nextGen.runMaintenance` | mutation | 手动触发NextGen维护任务 |
| `nextGen.trainModel` | mutation | 手动触发CQL模型训练 |
| `nextGen.getCausalAnalysis` | query | 获取因果推断分析结果 |
| `nextGen.getKeywordOpportunities` | query | 获取关键词图谱扩展机会和否定词候选 |
| `nextGen.optimizeBudget` | mutation | 执行预算组合优化 |
| `nextGen.analyzeKeywordGraph` | mutation | 执行关键词图谱分析 |

## 四、编译验证

使用esbuild对整个项目进行编译验证：

```
esbuild server/routers.ts --bundle --platform=node → 成功
输出: dist_verify/routers_check.js (3.0MB)
警告: 1个（来自debug-sync.ts，与新算法无关）
错误: 0个
```

## 五、集成完整性验证

| 验证项 | 预期 | 实际 | 状态 |
|---|---|---|---|
| optimizationTargetEngine.ts 中 nextGenOrchestrator 引用数 | ≥3 | 3 | 通过 |
| dataSyncScheduler.ts 中 nextgen 相关引用数 | ≥10 | 30 | 通过 |
| routers.ts 中新模块引用数 | ≥10 | 13 | 通过 |
| 新算法模块文件数量 | 10 | 10 | 通过 |
| 新模块被业务代码引用的文件数 | ≥5 | 8 | 通过 |
| esbuild编译 | 0错误 | 0错误 | 通过 |
| Git推送 | 成功 | 成功 | 通过 |

## 六、新算法模块清单

| 模块文件 | 算法 | 层级 | 被调用方 |
|---|---|---|---|
| `contextualFeatureService.ts` | 上下文特征管道 (17维) | P0 | nextGenBidOrchestrator |
| `rlDataRecorder.ts` | RL State-Action-Reward记录 | P0 | nextGenBidOrchestrator |
| `sigmoidCurveFitter.ts` | Sigmoid曲线拟合 + 利润优化 | P1 | nextGenBidOrchestrator (维护) |
| `contextualBanditService.ts` | LinUCB上下文赌博机 | P1 | metaLearningSelector |
| `causalInferenceEngine.ts` | 因果推断DID + Uplift | P1 | nextGenBidOrchestrator (维护), routers |
| `offlineRLService.ts` | CQL离线强化学习 | P2 | nextGenBidOrchestrator (训练), metaLearningSelector |
| `budgetPortfolioOptimizer.ts` | 预算组合优化 (边际效用) | P2 | nextGenBidOrchestrator (每日), routers |
| `keywordGraphService.ts` | 关键词语义图谱 + LLM扩展 | P2 | nextGenBidOrchestrator (每日), routers |
| `metaLearningSelector.ts` | 元学习策略选择器 | P2 | nextGenBidOrchestrator (出价) |
| `nextGenBidOrchestrator.ts` | 统一编排器 | 集成 | optimizationTargetEngine, dataSyncScheduler, routers |

## 七、数据流架构

```
用户请求/定时触发
    ↓
optimizationTargetEngine.executeOptimizationTarget()
    ↓
executeBidOptimization()
    ↓ (对每个关键词/商品定向)
nextGenOrchestrator.calculateNextGenBid()
    ├── contextualFeatureService.extractFeatureVector()  → 17维特征
    ├── metaLearningSelector.selectBestAlgorithm()       → 选择最优算法
    │   ├── Sigmoid曲线拟合 (数据充足时)
    │   ├── LinUCB上下文赌博机 (在线学习)
    │   ├── CQL离线强化学习 (模型已训练时)
    │   └── 规则引擎 (兜底)
    ├── safetyValidate()                                  → 安全校验
    └── rlDataRecorder.recordBidAction()                  → 记录RL数据
    ↓
v165绝对红线校验 → Amazon API同步 → 本地DB更新
```

## 八、部署状态

| 项目 | 状态 |
|---|---|
| Git提交 | `0015800` feat(v197): 将下一代算法体系集成到核心业务流程 |
| 分支 | main |
| 推送 | 成功推送至 `origin/main` |
| 生产部署 | 代码已推送，等待CI/CD自动部署或手动触发 |

## 九、渐进式上线建议

1. **第一阶段（当前）**：30%流量使用NextGen算法，70%使用现有算法
2. **第二阶段（1-2周后）**：根据因果推断分析结果，如果NextGen组表现优于对照组，提升至50%
3. **第三阶段（1个月后）**：全面切换至NextGen算法，现有算法作为兜底
4. **监控指标**：通过 `nextGen.getStatus` API和因果推断分析结果持续监控算法效果
