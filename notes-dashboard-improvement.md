# AlgorithmEffectDashboard 改进方案

## 现有问题
1. ACoS趋势图下方的统计卡片使用硬编码数据（-12.3%, 23天, 76.7%）
2. 优化前后对比下方的统计卡片也使用硬编码数据（-23%, +35%, +18%, -8%）
3. 缺少算法层级分布可视化（advanced/rule_engine/conservative）
4. 缺少AOV相关的决策质量展示

## 可用API
- trpc.algorithmEffect.getStats - 按算法分组统计（包含count, positiveRate等）
- trpc.algorithmEffect.getTrend - 效果趋势
- trpc.algorithmOptimization.getPerformance - 算法性能指标
- trpc.algorithmOptimization.analyzeByType - 按调整类型分析
- trpc.algorithmOptimization.analyzeByRange - 按出价变化幅度分析

## 改进内容
1. 新增"算法层级分布"Tab - 使用algorithmEffect.getStats数据，展示饼图+表格
2. 替换硬编码统计卡片为真实数据计算
3. 在核心指标卡片中增加算法层级分布迷你图
4. 改进执行历史Tab，增加算法层级标签
