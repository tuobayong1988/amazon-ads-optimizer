# 广告优化算法代码清单

## 核心算法服务

### 1. 优化目标引擎
- `server/optimizationTargetEngine.ts` - 优化目标执行引擎
- `server/optimizationTargetAutoService.ts` - 自动优化服务

### 2. 算法优化服务
- `server/algorithmOptimizationService.ts` - 算法优化核心服务
- `server/algorithmUtils.ts` - 算法工具函数
- `server/algorithmEffectService.ts` - 算法效果跟踪

### 3. 位置优化
- `server/placementOptimizationService.ts` - 位置优化服务(V1)
- `server/placementOptimizationServiceV2.ts` - 位置优化服务(V2)
- `server/placementCoordinationService.ts` - 位置协调服务
- `server/placementEffectTrackingService.ts` - 位置效果跟踪

### 4. 策略推荐
- `server/strategyRecommendationService.ts` - 策略推荐服务

### 5. 机器学习
- `server/ml/bidOptimizer.ts` - ML出价优化器
- `server/routes/mlOptimization.ts` - ML优化API

### 6. 智能投放
- `server/smartCampaign/decisionEngine.ts` - 智能决策引擎
- `server/routes/smartCampaign.ts` - 智能投放API

## 待分析项
- [ ] 每个算法的核心逻辑
- [ ] 算法之间的依赖关系
- [ ] 算法的输入输出
- [ ] 算法的配置参数
- [ ] 算法的性能指标
