# actionDetail 字段分析

## NextGenBidResult 接口 (nextGenBidOrchestrator.ts)
- targetId: number
- targetType: 'keyword' | 'product_target'
- previousBid: number
- newBid: number
- actionType: 'increase' | 'decrease' | 'hold'
- bidChangePercent: number
- reason: string (包含AOV、花费比率、ACOS等决策上下文)
- algorithmUsed: string (如 'RuleEngine-v251', 'RL-Exploration' 等)
- confidence: number (0-1)
- algorithmTier: 'advanced' | 'rule_engine' | 'conservative'
- gtoModifier?: GTOModifier (博弈论修正)

## detail对象 (optimizationTargetEngine.ts 中构建)
出价优化日志的actionDetail包含：
- keywordId: number
- keywordText: string
- localCampaignId
- amazonCampaignId
- campaignName: string
- currentBid: number
- newBid: number
- changePercent: string (百分比)
- reason: string (包含决策上下文如AOV、花费比率等)
- algorithmUsed: string
- confidenceScore: number
- algorithmTier: 'advanced' | 'rule_engine' | 'conservative'
- isProductTarget?: boolean (商品定向时为true)
- productTargetId?: number

## reason字段中包含的决策上下文 (从ruleEngineDecision)
- AOV值: "AOV=$XX"
- 花费比率: "X.Xx超标"
- ACOS: "ACOS优秀(XX.X% vs 目标XX.X%)"
- 零曝光探索: "零曝光探索: 提升XX%"
- 低曝光零点击: "低曝光零点击(XX次)"
- 零转化高花费: "零转化高花费($XX.XX)"
- 归因保护: attributionToleranceFactor (1.5x容忍因子)

## PerformanceGroupConfig 中的AOV相关
- groupAvgAov?: number (广告组平均客单价)
- groupAvgCvr?: number (广告组平均CVR)
- groupAvgCpc?: number (广告组平均CPC)
