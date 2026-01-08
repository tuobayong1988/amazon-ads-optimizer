# Amazon广告分渠道优化算法设计

**作者**: Manus AI  
**版本**: 2.0  
**日期**: 2026年1月

---

## 一、Amazon广告渠道全景图

Amazon广告平台提供三大广告产品线，每种产品线有其独特的展示位置、竞价机制和转化路径。要实现全局最优，必须深入理解每个渠道的特性。

### 1.1 广告类型与特性对比

| 广告类型 | 展示位置 | 竞价机制 | 转化路径 | 核心指标 | 优化难度 |
|---------|---------|---------|---------|---------|---------|
| **SP自动广告** | 搜索结果、商品详情页 | CPC | 搜索→点击→购买 | ACoS, ROAS | ★★☆ |
| **SP手动-关键词** | 搜索结果、商品详情页 | CPC | 搜索→点击→购买 | ACoS, ROAS, 关键词排名 | ★★★ |
| **SP手动-商品定向** | 商品详情页 | CPC | 浏览→点击→购买 | ACoS, 竞品转化率 | ★★☆ |
| **SB商品集合** | 搜索结果顶部 | CPC | 搜索→品牌认知→购买 | 新客户%, 品牌搜索量 | ★★★ |
| **SB旗舰店聚焦** | 搜索结果顶部 | CPC | 搜索→旗舰店→购买 | 旗舰店访问量, 停留时间 | ★★☆ |
| **SB视频广告** | 搜索结果中部 | CPC | 搜索→视频观看→购买 | 视频完播率, CVR | ★★★★ |
| **SD受众定向** | 站内外展示位 | CPC/vCPM | 展示→再营销→购买 | 浏览归因销售, 频次 | ★★★ |
| **SD商品定向** | 商品详情页、相关位置 | CPC/vCPM | 浏览→关联→购买 | 关联转化率 | ★★☆ |

### 1.2 渠道间的协同与竞争关系

```
                    ┌─────────────────────────────────────────┐
                    │           用户购买旅程                    │
                    └─────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
   ┌─────────┐                  ┌─────────┐                  ┌─────────┐
   │  认知   │                  │  考虑   │                  │  转化   │
   │ (SD)   │ ───────────────▶ │(SB/SP) │ ───────────────▶ │  (SP)  │
   └─────────┘                  └─────────┘                  └─────────┘
        │                             │                             │
        │   SD展示广告                 │   SB品牌广告                 │   SP商品推广
        │   - 受众再营销               │   - 视频广告(搜索)           │   - 精确关键词
        │   - 兴趣定向                 │   - 品牌旗舰店               │   - 商品定向
        │                             │   - 商品集合                 │
        └─────────────────────────────┴─────────────────────────────┘
```

**关键洞察**：
- SP广告是转化的最后一环，直接影响销量
- SB广告在品牌建设和新客户获取上有独特价值
- SD广告负责漏斗顶部的流量引入和再营销
- **SB视频广告**虽然是品牌广告，但其核心是搜索，应使用搜索广告的优化逻辑

---

## 二、分渠道优化算法设计

### 2.1 SP商品推广广告优化算法

SP广告是Amazon广告的核心，直接驱动销售。其优化算法需要最精细化。

#### 2.1.1 SP自动广告优化

**四种匹配类型的差异化处理**：

| 匹配类型 | 流量特征 | 优化策略 | 关键指标 |
|---------|---------|---------|---------|
| 紧密匹配(Close Match) | 高相关性搜索词 | 积极竞价，挖掘高价值词 | CVR, ACoS |
| 宽泛匹配(Loose Match) | 相关性较低的搜索词 | 保守竞价，筛选有效词 | CTR, 搜索词质量 |
| 同类商品(Substitutes) | 竞品详情页流量 | 竞争性竞价，抢占份额 | 竞品转化率 |
| 关联商品(Complements) | 互补商品页流量 | 稳定竞价，交叉销售 | 关联购买率 |

**算法流程**：

```python
def optimize_sp_auto_targeting(targeting_data, params):
    """
    SP自动广告优化算法
    
    核心思想：
    1. 按匹配类型分组分析
    2. 为每种类型建立独立的市场曲线
    3. 考虑搜索词迁移价值
    """
    
    for targeting_type in ['close_match', 'loose_match', 'substitutes', 'complements']:
        # 1. 获取该类型的历史数据
        history = get_targeting_history(targeting_data, targeting_type)
        
        # 2. 构建市场曲线
        market_curve = build_market_curve(history)
        
        # 3. 计算最优竞价（考虑类型特性）
        if targeting_type == 'close_match':
            # 紧密匹配：追求转化，可接受较高竞价
            optimal_bid = find_optimal_bid(market_curve, target_acos=params.target_acos)
        elif targeting_type == 'loose_match':
            # 宽泛匹配：控制成本，挖掘潜力词
            optimal_bid = find_optimal_bid(market_curve, target_acos=params.target_acos * 0.8)
        elif targeting_type == 'substitutes':
            # 同类商品：竞争性出价
            optimal_bid = find_competitive_bid(market_curve, competition_factor=1.2)
        else:
            # 关联商品：稳定出价
            optimal_bid = find_stable_bid(market_curve)
        
        # 4. 生成优化建议
        yield generate_suggestion(targeting_type, optimal_bid)
```

#### 2.1.2 SP手动广告-关键词定向优化

**这是搜索广告优化的核心，需要完整应用市场曲线建模、边际分析和决策树逻辑。**

**算法架构**：

```
┌─────────────────────────────────────────────────────────────────┐
│                    SP关键词优化算法流程                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ 数据收集    │───▶│ 市场曲线建模 │───▶│ 边际分析    │         │
│  │ (30天历史)  │    │ (展现/CTR/利润)│   │ (MR=MC点)  │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ 决策树预测  │───▶│ 场景模拟    │───▶│ 最优竞价    │         │
│  │ (CTR/CVR)  │    │ (约束优化)  │    │ (输出)      │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**关键词分层优化策略**：

| 关键词层级 | 数据量要求 | 优化方法 | 调整幅度 |
|-----------|-----------|---------|---------|
| 头部词（高流量） | 点击≥100/周 | 市场曲线+边际分析 | ±5-15% |
| 腰部词（中流量） | 点击10-100/周 | 决策树+规则 | ±10-25% |
| 长尾词（低流量） | 点击<10/周 | 贝叶斯先验+决策树 | ±15-30% |
| 新词（无数据） | 无历史数据 | 类似词迁移+保守出价 | 初始竞价 |

**市场曲线建模公式**：

展现曲线（对数模型）：
$$Impressions = a \times \ln(CPC + b) + c$$

其中：
- $a$: 对数系数，反映市场深度
- $b$: 偏移量，防止对数无穷
- $c$: 基础展现量

CTR曲线（位置相关模型）：
$$CTR = CTR_{base} \times (1 + \beta \times PositionScore)$$

其中：
- $CTR_{base}$: 基础点击率
- $\beta$: 位置加成系数
- $PositionScore$: 位置得分（0-1）

利润函数：
$$Profit = Clicks \times (CVR \times AOV - CPC)$$

**边际分析算法**：

```python
def marginal_analysis(market_curve, conversion_params, current_bid):
    """
    边际分析：找到边际利润为零的点
    
    边际利润 = 边际收入 - 边际成本
    最优点：边际利润 = 0
    """
    
    profit_curve = []
    step = 0.02  # 竞价步长
    
    for bid in np.arange(MIN_BID, MAX_BID, step):
        impressions = calculate_impressions(bid, market_curve)
        ctr = calculate_ctr(bid, market_curve)
        clicks = impressions * ctr
        
        revenue = clicks * conversion_params.cvr * conversion_params.aov
        cost = clicks * bid * 0.7  # 实际CPC约为竞价的70%
        profit = revenue - cost
        
        profit_curve.append({
            'bid': bid,
            'profit': profit,
            'marginal_profit': (profit - profit_curve[-1]['profit']) / step if profit_curve else 0
        })
    
    # 找到边际利润接近0且利润为正的点
    optimal_bid = find_zero_marginal_profit(profit_curve)
    
    return optimal_bid
```

#### 2.1.3 SP广告位置优化

**三个广告位置的差异化策略**：

| 位置 | 特点 | 优化目标 | 倍数范围 |
|-----|------|---------|---------|
| 搜索顶部(Top of Search) | CTR最高，竞争激烈 | 品牌词、高转化词 | 0-900% |
| 商品详情页(Product Pages) | CVR较高，流量稳定 | 竞品定向、关联词 | 0-900% |
| 其他位置(Rest of Search) | 成本最低，量大 | 长尾词、测试词 | 基础竞价 |

**位置优化算法**：

```python
def optimize_placement_bids(placement_data, target_acos):
    """
    位置竞价优化算法
    
    核心思想：
    1. 计算各位置的效率得分
    2. 高效位置提高倍数，低效位置降低倍数
    3. 保持整体ACoS在目标范围内
    """
    
    suggestions = []
    
    for placement in ['top_of_search', 'product_pages']:
        # 计算位置效率
        efficiency = target_acos / placement_data[placement].acos
        
        # 计算建议倍数
        current_multiplier = placement_data[placement].current_multiplier
        suggested_multiplier = current_multiplier * (efficiency ** 0.5)  # 平方根平滑
        
        # 限制调整幅度
        suggested_multiplier = clamp(
            suggested_multiplier,
            current_multiplier * 0.7,  # 最多降30%
            current_multiplier * 1.3   # 最多升30%
        )
        
        # 限制在有效范围
        suggested_multiplier = clamp(suggested_multiplier, 0, 9)  # 0-900%
        
        suggestions.append({
            'placement': placement,
            'current': current_multiplier,
            'suggested': suggested_multiplier,
            'efficiency': efficiency
        })
    
    return suggestions
```

### 2.2 SB品牌广告优化算法

SB广告的核心价值在于品牌建设和新客户获取，优化时需要考虑这些长期价值。

#### 2.2.1 SB广告类型特性

| 类型 | 核心目标 | 关键指标 | 优化重点 |
|-----|---------|---------|---------|
| 商品集合 | 品牌认知+销售 | 新客户%, 品牌搜索提升 | 关键词覆盖、创意优化 |
| 旗舰店聚焦 | 旗舰店引流 | 旗舰店访问量, 页面停留 | 分类页面优化 |
| **视频广告** | **搜索转化** | **视频完播率, CVR** | **关键词竞价、视频质量** |

#### 2.2.2 SB视频广告优化（搜索核心）

**重要**：SB视频广告虽然归类为品牌广告，但其本质是搜索广告，用户通过搜索触发，因此需要应用完整的搜索广告优化逻辑。

**SB视频广告优化算法**：

```python
def optimize_sb_video_ad(video_performance, params):
    """
    SB视频广告优化算法
    
    核心思想：
    1. 应用搜索广告的市场曲线建模
    2. 考虑视频特有指标（观看率、完播率）
    3. 计入新客户价值
    """
    
    # 1. 检查视频质量指标
    if video_performance.video_view_rate < 0.5:
        # 视频观看率过低，优先优化创意
        return {
            'type': 'creative_optimization',
            'reason': '视频观看率低于50%，建议优化视频内容',
            'bid_adjustment': -10  # 同时小幅降低竞价
        }
    
    # 2. 计算调整后的ACoS（考虑新客户价值）
    new_customer_weight = 1.5  # 新客户价值权重
    adjusted_sales = (
        video_performance.sales + 
        video_performance.new_to_brand_sales * (new_customer_weight - 1)
    )
    adjusted_acos = video_performance.cost / adjusted_sales
    
    # 3. 构建市场曲线（使用搜索广告逻辑）
    market_curve = build_search_ad_market_curve(video_performance)
    
    # 4. 边际分析找最优竞价
    optimal_bid = marginal_analysis(
        market_curve,
        conversion_params={
            'cvr': video_performance.cvr,
            'aov': video_performance.aov
        },
        current_bid=video_performance.current_bid
    )
    
    # 5. 应用视频广告特有的调整因子
    if video_performance.video_completion_rate > 0.3:
        # 高完播率，说明视频质量好，可以更积极
        optimal_bid *= 1.1
    
    return {
        'type': 'bid_adjustment',
        'current_bid': video_performance.current_bid,
        'suggested_bid': optimal_bid,
        'adjusted_acos': adjusted_acos,
        'new_customer_impact': video_performance.new_to_brand_orders_percent
    }
```

#### 2.2.3 SB商品集合/旗舰店广告优化

这类广告更侧重品牌价值，优化逻辑与纯搜索广告有所不同：

```python
def optimize_sb_brand_ad(brand_performance, params):
    """
    SB品牌广告优化算法（商品集合、旗舰店聚焦）
    
    核心思想：
    1. 平衡短期销售和长期品牌价值
    2. 重点关注新客户获取成本
    3. 考虑品牌搜索量提升
    """
    
    # 1. 计算新客户获取成本 (CAC)
    new_customer_cost = (
        brand_performance.cost / 
        max(brand_performance.new_to_brand_orders, 1)
    )
    
    # 2. 计算品牌价值调整后的ACoS
    # 新客户的长期价值 = 首单价值 × LTV系数
    ltv_factor = 2.5  # 假设客户生命周期价值是首单的2.5倍
    adjusted_sales = (
        brand_performance.sales +
        brand_performance.new_to_brand_sales * (ltv_factor - 1)
    )
    brand_adjusted_acos = brand_performance.cost / adjusted_sales
    
    # 3. 基于品牌目标决定优化方向
    if brand_performance.new_to_brand_orders_percent > 0.5:
        # 新客户占比高，品牌广告效果好
        target_acos = params.target_acos * 1.3  # 可接受更高ACoS
    else:
        # 新客户占比低，需要控制成本
        target_acos = params.target_acos
    
    # 4. 生成优化建议
    if brand_adjusted_acos > target_acos:
        return {
            'action': 'decrease_bid',
            'adjustment_percent': -15,
            'reason': f'品牌调整后ACoS({brand_adjusted_acos:.1%})高于目标'
        }
    elif brand_adjusted_acos < target_acos * 0.7:
        return {
            'action': 'increase_bid',
            'adjustment_percent': 15,
            'reason': f'品牌调整后ACoS({brand_adjusted_acos:.1%})低于目标，可扩大投放'
        }
    else:
        return {
            'action': 'maintain',
            'reason': '当前表现在目标范围内'
        }
```

### 2.3 SD展示广告优化算法

SD广告的核心是展示和再营销，其优化逻辑与搜索广告有本质区别。

#### 2.3.1 SD广告特性

| 定向类型 | 用户意图 | 转化路径 | 优化重点 |
|---------|---------|---------|---------|
| 浏览再营销 | 已有兴趣 | 提醒→回访→购买 | 频次控制、时效性 |
| 购买再营销 | 已购买过 | 提醒→复购 | 复购周期、关联推荐 |
| 相似受众 | 潜在兴趣 | 发现→兴趣→购买 | 受众扩展、成本控制 |
| 商品定向 | 浏览竞品 | 比较→选择→购买 | 竞品分析、差异化 |

#### 2.3.2 SD广告优化算法

```python
def optimize_sd_ad(sd_performance, params):
    """
    SD展示广告优化算法
    
    核心思想：
    1. 考虑浏览归因销售额（不仅仅是点击归因）
    2. 控制展示频次，避免用户疲劳
    3. 根据定向类型调整策略
    """
    
    # 1. 计算综合ACoS（点击归因 + 浏览归因）
    # 浏览归因通常给予较低权重
    view_attribution_weight = 0.3
    total_attributed_sales = (
        sd_performance.click_sales +
        sd_performance.view_sales * view_attribution_weight
    )
    effective_acos = sd_performance.cost / max(total_attributed_sales, 0.01)
    
    # 2. 检查展示频次
    if sd_performance.frequency > 10:
        # 频次过高，用户可能已疲劳
        return {
            'action': 'expand_audience',
            'reason': f'展示频次({sd_performance.frequency})过高，建议扩大受众范围',
            'bid_adjustment': -10
        }
    
    # 3. 根据定向类型优化
    if sd_performance.targeting_type == 'remarketing':
        # 再营销：关注转化时效
        if sd_performance.days_since_view > 14:
            return {
                'action': 'decrease_bid',
                'adjustment_percent': -20,
                'reason': '再营销时效已过（>14天），降低投入'
            }
    
    elif sd_performance.targeting_type == 'similar_audience':
        # 相似受众：关注获客成本
        cac = sd_performance.cost / max(sd_performance.new_customers, 1)
        if cac > params.max_cac:
            return {
                'action': 'decrease_bid',
                'adjustment_percent': -15,
                'reason': f'获客成本({cac:.2f})超过目标'
            }
    
    # 4. 考虑计费方式切换
    if sd_performance.ctr < 0.001 and sd_performance.billing_type == 'CPC':
        return {
            'action': 'switch_billing',
            'from': 'CPC',
            'to': 'vCPM',
            'reason': 'CTR极低，建议切换到vCPM计费以控制成本'
        }
    
    # 5. 常规竞价优化
    if effective_acos > params.target_acos:
        return {
            'action': 'decrease_bid',
            'adjustment_percent': -15,
            'reason': f'有效ACoS({effective_acos:.1%})高于目标'
        }
    elif effective_acos < params.target_acos * 0.6:
        return {
            'action': 'increase_bid',
            'adjustment_percent': 15,
            'reason': f'有效ACoS({effective_acos:.1%})远低于目标，可扩大投放'
        }
    
    return {'action': 'maintain', 'reason': '当前表现在目标范围内'}
```

---

## 三、全局优化与Scenarios模型

### 3.1 跨渠道预算分配

**问题**：如何在SP、SB、SD三大渠道间分配预算以实现全局最优？

**解决方案**：边际效益均衡原则

```
最优分配条件：
各渠道的边际ROAS相等

即：MR_SP / MC_SP = MR_SB / MC_SB = MR_SD / MC_SD
```

**算法实现**：

```python
def optimize_cross_channel_budget(channel_data, total_budget, params):
    """
    跨渠道预算分配算法
    
    核心思想：
    1. 计算各渠道的边际ROAS
    2. 将预算从边际ROAS低的渠道转移到高的渠道
    3. 直到边际ROAS均衡
    """
    
    # 1. 计算各渠道的边际ROAS曲线
    marginal_curves = {}
    for channel in ['SP', 'SB', 'SD']:
        marginal_curves[channel] = calculate_marginal_roas_curve(
            channel_data[channel],
            budget_range=(0, total_budget)
        )
    
    # 2. 使用拉格朗日乘数法求解最优分配
    # 目标：max Σ Revenue_i(Budget_i)
    # 约束：Σ Budget_i = Total_Budget
    
    optimal_allocation = solve_lagrangian(
        marginal_curves,
        total_budget,
        constraints={
            'min_sp_ratio': 0.5,   # SP至少占50%
            'max_sd_ratio': 0.2,   # SD最多占20%
            'min_channel_budget': 10  # 每个渠道最少$10
        }
    )
    
    # 3. 生成分配建议
    suggestions = []
    for channel, budget in optimal_allocation.items():
        current = channel_data[channel].current_budget
        change = budget - current
        suggestions.append({
            'channel': channel,
            'current_budget': current,
            'suggested_budget': budget,
            'change': change,
            'change_percent': change / current if current > 0 else 0,
            'expected_marginal_roas': marginal_curves[channel].at(budget)
        })
    
    return suggestions
```

### 3.2 Scenarios场景模拟模型

**这是Adspert的核心创新，我们需要实现类似功能。**

**Scenarios模型的核心思想**：

1. 给定目标（如ACoS=25%）和预算约束
2. 模拟所有可能的竞价组合
3. 找到在约束内最大化利润的组合
4. 输出置信区间，展示目标可达性

**算法实现**：

```python
def scenarios_optimization(
    performance_group,
    target_goal,
    budget_constraint,
    num_simulations=10000
):
    """
    Scenarios场景模拟优化
    
    使用蒙特卡洛模拟在约束条件下寻找最优解
    """
    
    # 1. 获取所有可竞价对象
    biddable_objects = get_all_biddable_objects(performance_group)
    
    # 2. 为每个对象构建市场曲线
    market_curves = {}
    for obj in biddable_objects:
        market_curves[obj.id] = build_market_curve(obj)
    
    # 3. 蒙特卡洛模拟
    results = []
    for _ in range(num_simulations):
        # 随机生成一组竞价
        bids = generate_random_bids(biddable_objects)
        
        # 预测结果
        predicted = predict_performance(bids, market_curves)
        
        # 检查是否满足约束
        if meets_constraints(predicted, target_goal, budget_constraint):
            results.append({
                'bids': bids,
                'predicted_profit': predicted.profit,
                'predicted_acos': predicted.acos,
                'predicted_sales': predicted.sales
            })
    
    # 4. 找到最优解
    if results:
        best = max(results, key=lambda x: x['predicted_profit'])
    else:
        # 没有满足约束的解，放宽约束重新搜索
        best = find_closest_solution(results, target_goal)
    
    # 5. 计算置信区间
    confidence_interval = calculate_confidence_interval(results)
    
    # 6. 评估目标可达性
    reachability = len(results) / num_simulations
    
    return {
        'optimal_bids': best['bids'],
        'predicted_performance': {
            'profit': best['predicted_profit'],
            'acos': best['predicted_acos'],
            'sales': best['predicted_sales']
        },
        'confidence_interval': confidence_interval,
        'goal_reachability': reachability,
        'recommendation': generate_recommendation(reachability, target_goal)
    }


def generate_recommendation(reachability, target_goal):
    """生成目标可达性建议"""
    
    if reachability > 0.8:
        return f"目标({target_goal})高度可达，建议保持当前设置"
    elif reachability > 0.5:
        return f"目标({target_goal})可能达成，建议观察1-2周"
    elif reachability > 0.2:
        return f"目标({target_goal})较难达成，建议调整至历史值±20%范围内"
    else:
        return f"目标({target_goal})几乎不可达，强烈建议重新设置目标"
```

### 3.3 全局优化决策流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        全局优化决策流程                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐                                                        │
│  │ 1. 数据收集 │                                                        │
│  │ (各渠道数据) │                                                        │
│  └──────┬──────┘                                                        │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ 2. 分渠道优化                                                │       │
│  │                                                              │       │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐                   │       │
│  │  │SP优化   │   │SB优化   │   │SD优化   │                   │       │
│  │  │(搜索核心)│   │(品牌+搜索)│  │(展示核心)│                   │       │
│  │  └────┬────┘   └────┬────┘   └────┬────┘                   │       │
│  │       │             │             │                         │       │
│  │       └─────────────┼─────────────┘                         │       │
│  │                     │                                        │       │
│  └─────────────────────┼────────────────────────────────────────┘       │
│                        │                                                │
│                        ▼                                                │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ 3. 全局协调                                                  │       │
│  │                                                              │       │
│  │  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐       │       │
│  │  │跨渠道预算   │   │Scenarios    │   │目标可达性   │       │       │
│  │  │分配        │   │场景模拟     │   │评估        │       │       │
│  │  └─────────────┘   └─────────────┘   └─────────────┘       │       │
│  │                                                              │       │
│  └─────────────────────┬────────────────────────────────────────┘       │
│                        │                                                │
│                        ▼                                                │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ 4. 输出优化建议                                              │       │
│  │                                                              │       │
│  │  - 各渠道竞价调整建议                                        │       │
│  │  - 预算重分配建议                                            │       │
│  │  - 目标调整建议（如不可达）                                   │       │
│  │  - 置信区间和风险提示                                        │       │
│  │                                                              │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 四、算法参数配置

### 4.1 分渠道默认参数

| 参数 | SP广告 | SB广告 | SD广告 | 说明 |
|-----|-------|-------|-------|------|
| 目标ACoS | 25% | 30% | 35% | SB/SD允许更高ACoS |
| 最小竞价 | $0.10 | $0.20 | $0.15 | SD可略低 |
| 最大竞价 | $10.00 | $15.00 | $5.00 | SD通常不需高竞价 |
| 单次调整上限 | ±25% | ±30% | ±20% | SD更保守 |
| 最小点击数 | 10 | 15 | 20 | SD需要更多数据 |
| 学习期 | 7天 | 14天 | 14天 | 品牌广告需更长学习期 |
| 新客户权重 | 1.0 | 1.5 | 1.2 | SB最重视新客户 |

### 4.2 Performance Group配置建议

| 目标类型 | 适用场景 | 推荐渠道配比 |
|---------|---------|-------------|
| 最大化销售 | 成熟产品、旺季 | SP:70%, SB:20%, SD:10% |
| 目标ACoS | 日常运营 | SP:60%, SB:25%, SD:15% |
| 目标ROAS | 利润导向 | SP:65%, SB:20%, SD:15% |
| 新客户获取 | 新品推广 | SP:40%, SB:40%, SD:20% |
| 品牌建设 | 长期投资 | SP:30%, SB:50%, SD:20% |

---

## 五、总结

### 5.1 核心设计原则

1. **分渠道差异化**：每种广告类型有独特的优化逻辑
2. **搜索广告核心**：SP和SB视频广告使用完整的市场曲线+边际分析+决策树
3. **全局协调**：通过Scenarios模型和跨渠道预算分配实现全局最优
4. **安全边界**：多层风控保护，防止算法失控

### 5.2 与Adspert的差异化优势

| 维度 | Adspert | 我们的系统 |
|-----|---------|-----------|
| 分时竞价 | 不支持 | ✅ 84个独立控制单元 |
| 位置优化 | 基础支持 | ✅ 三位置独立优化 |
| A/B测试 | 不支持 | ✅ 内置实验框架 |
| 自动回滚 | 不支持 | ✅ 效果不佳自动回滚 |
| 多时间窗口 | 单一窗口 | ✅ 7/14/30天多窗口 |
| 渠道协同 | 基础 | ✅ 漏斗协同优化 |

### 5.3 实施路线图

1. **第一阶段**（2周）：完善分渠道优化算法
2. **第二阶段**（2周）：实现Scenarios场景模拟
3. **第三阶段**（2周）：实现跨渠道预算分配
4. **第四阶段**（持续）：算法调优和效果验证

---

## References

[1] Adspert. "PPC AI: How Adspert's Algorithm Nails Bid Optimization." https://www.adspert.net/ppc-ai-adspert-algorithm/

[2] Amazon Advertising. "Sponsored Products." https://advertising.amazon.com/solutions/products/sponsored-products

[3] Amazon Advertising. "Sponsored Brands." https://advertising.amazon.com/solutions/products/sponsored-brands

[4] Amazon Advertising. "Sponsored Display." https://advertising.amazon.com/solutions/products/sponsored-display
