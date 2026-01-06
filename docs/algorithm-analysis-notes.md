# Amazon Ads Optimizer 算法分析笔记

## 1. 当前系统中的优化算法

### 1.1 核心出价优化算法 (bidOptimizer.ts)

**算法原理：**
- 基于边际收益=边际成本(MR=MC)的经济学原理
- 使用对数模型估算市场曲线
- 支持多种优化目标：maximize_sales, target_acos, target_roas, daily_spend_limit, daily_cost

**关键函数：**
- `calculateMetrics()`: 计算ACoS, ROAS, CTR, CVR, CPC, AOV
- `estimateMarketCeiling()`: 估算流量天花板
- `generateMarketCurve()`: 生成出价-效果曲线
- `findOptimalBid()`: 寻找最优出价点
- `calculateBidAdjustment()`: 计算出价调整建议
- `calculatePlacementAdjustments()`: 计算广告位调整
- `calculateIntradayAdjustment()`: 日内出价调整

**约束条件：**
- 单次调整幅度限制在25%以内
- 最低出价限制: $0.02
- 最高出价限制: $100

### 1.2 智能预算分配算法 (intelligentBudgetAllocationService.ts)

**评分维度：**
- 转化效率得分 (conversionEfficiencyScore)
- ROAS得分 (roasScore)
- 增长潜力得分 (growthPotentialScore)
- 稳定性得分 (stabilityScore)
- 趋势得分 (trendScore)

**权重配置：**
- 转化效率权重: 0.25
- ROAS权重: 0.25
- 增长潜力权重: 0.20
- 稳定性权重: 0.15
- 趋势权重: 0.15

**预算曲线模型：**
- 使用对数函数近似边际效益递减
- 计算最优预算点和边际效益递减点

### 1.3 自动回滚服务 (autoRollbackService.ts)

**回滚触发条件：**
- 效果追踪周期: 7/14/30天
- 利润下降阈值可配置
- 支持排除负向调整

### 1.4 算法优化服务 (algorithmOptimizationService.ts)

**默认参数：**
- 最大出价提升: 30%
- 最大出价降低: 20%
- 最小数据点要求
- 置信度阈值

### 1.5 效果追踪调度器 (effectTrackingScheduler.ts)

**追踪周期：**
- 7天追踪
- 14天追踪
- 30天追踪

**追踪指标：**
- 实际利润
- 实际点击
- 实际销售
- 实际ACoS

### 1.6 A/B测试服务 (abTestService.ts)

**测试类型：**
- budget_allocation
- bid_strategy
- targeting

**目标指标：**
- roas
- acos
- conversions
- revenue
- profit

## 2. 数据库表结构支持

### 出价相关表：
- bidding_logs: 出价日志
- bid_adjustment_history: 出价调整历史
- bid_object_profit_estimates: 竞价对象利润估算
- bid_performance_history: 出价表现历史

### 预算相关表：
- budget_allocations: 预算分配
- budget_allocation_configs: 预算分配配置
- budget_allocation_suggestions: 预算分配建议
- budget_allocation_history: 预算分配历史
- budget_auto_execution_configs: 预算自动执行配置
- budget_auto_execution_history: 预算自动执行历史

### 效果追踪表：
- ai_execution_predictions: AI执行预测
- ai_prediction_reviews: AI预测回顾

## 3. Adspert算法特点研究

### 3.1 核心算法原理

Adspert的PPC AI算法结合三种方法来确定最优CPC出价：

1. **市场曲线 (Market Curves)**
   - 基于历史数据创建出价-点击关系曲线
   - 预测展示量、点击量、有效CPC
   - 使用曲线拟合(Curve Fitting)找到最佳出价点

2. **决策树 (Decision Tree)**
   - 使用机器学习预测CTR、转化率、转化价值
   - 分析广告活动、关键词、产品信息等多维度数据
   - 生成“森林”级别的决策模型

3. **情景模拟 (Scenarios)**
   - Adspert独有的预测模型
   - 展示不同目标设置的可能结果
   - 帮助用户设置可达成的目标

### 3.2 核心理念

- **Performance Group**: 将目标相同的广告活动分组优化
- **目标约束**: 用户设置目标和预算，算法在约束内寻找最优解
- **渐进式调整**: 建议目标调整幅度不超过历史值的20%
- **利润最大化**: 最终目标是最大化利润(收入-广告支出)

### 3.3 出价策略

- 算法检查所有可出价对象的平均表现
- 选择平均能达成目标且符合预算的CPC出价
- 单个关键词可能不达标，但整体Performance Group达标
- 支持多种目标类型: Cost per Day, ACoS, ROAS等

### 3.4 平台支持

- Amazon Ads
- eBay Ads
- Google Ads
- Microsoft Advertising
- Walmart Connect

