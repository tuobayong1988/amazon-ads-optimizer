# 流量隔离与N-Gram降噪算法设计文档

## 1. 算法概述

本文档描述亚马逊广告优化系统中的流量隔离体系和N-Gram降噪算法的设计方案。核心目标是实现从"被动清洗"到"主动隔离"的转变，通过智能算法自动管理否定词，减少流量重叠和无效点击。

## 2. 核心算法模块

### 2.1 N-Gram词根分析算法

**目标**：识别搜索词中的高频无效词根，实现批量降噪。

**算法流程**：

1. **数据采集**：收集所有"1点击0转化"的搜索词
2. **分词处理**：将搜索词拆分为单词（Unigram）和双词组合（Bigram）
3. **词频统计**：统计每个词根在无效搜索词中的出现频率
4. **阈值判定**：当词根出现频率超过阈值（如50次），标记为高频无效词根
5. **否定建议**：生成短语否定（Negative Phrase）建议

**数据结构**：

```typescript
interface NGramAnalysisResult {
  token: string;           // 词根
  frequency: number;       // 出现频率
  totalClicks: number;     // 总点击数
  totalSpend: number;      // 总花费
  conversionRate: number;  // 转化率
  confidence: number;      // 置信度
  suggestedAction: 'negative_phrase' | 'monitor' | 'ignore';
}
```

### 2.2 流量隔离算法

**目标**：检测跨广告活动的搜索词重叠，实现流量归属决策。

**算法流程**：

1. **重叠检测**：扫描所有广告活动，识别相同搜索词出现在多个活动中的情况
2. **性能对比**：计算每个活动中该搜索词的CVR、AOV、ROAS
3. **归属决策**：将流量归属给表现最佳的广告活动
4. **否定生成**：在其他活动中生成Negative Exact否定词

**决策矩阵**：

| 指标 | 权重 | 说明 |
|------|------|------|
| CVR（转化率） | 40% | 核心指标，直接反映流量质量 |
| AOV（客单价） | 30% | 反映流量价值 |
| ROAS | 20% | 综合投入产出比 |
| 历史数据量 | 10% | 数据可信度 |

### 2.3 漏斗模型算法

**目标**：实现三层漏斗架构，确保流量在正确的层级被捕获。

**层级定义**：

| 层级 | 匹配类型 | 目标 | 否定策略 |
|------|----------|------|----------|
| Tier 1（精准层） | Exact | 核心大词，火力全开 | 无需否定 |
| Tier 2（长尾层） | Exact/Phrase | 长尾变体词 | Negative Exact掉Tier 1的词 |
| Tier 3（探索层） | Broad/Phrase | 发现未知新词 | Negative Phrase掉Tier 1和Tier 2的词根 |

**算法流程**：

1. **广告活动分类**：根据匹配类型识别广告活动所属层级
2. **已知词库构建**：从Tier 1和Tier 2中提取所有已投放的词
3. **否定词同步**：自动在下层活动中添加上层词的否定
4. **新词迁移**：当探索层发现高转化新词时，建议迁移到精准层

### 2.4 Exact First策略

**目标**：对于高确定性的词，直接使用精准匹配，避免广泛匹配"猜测"。

**算法流程**：

1. **词库分析**：识别用户标记为"高相关"的词
2. **直接投放**：建议在Exact广告活动中直接投放
3. **否定同步**：在Broad/Phrase活动中添加这些词的Negative Exact

## 3. 数据库设计

### 3.1 新增表结构

```sql
-- N-Gram分析结果表
CREATE TABLE ngram_analysis_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  token VARCHAR(255) NOT NULL,
  token_type ENUM('unigram', 'bigram') NOT NULL,
  frequency INT DEFAULT 0,
  total_clicks INT DEFAULT 0,
  total_spend DECIMAL(10,2) DEFAULT 0,
  total_conversions INT DEFAULT 0,
  conversion_rate DECIMAL(5,4),
  confidence DECIMAL(5,4),
  suggested_action ENUM('negative_phrase', 'monitor', 'ignore') DEFAULT 'monitor',
  is_blacklisted TINYINT DEFAULT 0,
  analysis_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 流量冲突记录表
CREATE TABLE traffic_conflicts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  search_term VARCHAR(500) NOT NULL,
  conflict_campaigns JSON, -- 冲突的广告活动列表
  winner_campaign_id INT,
  winner_reason TEXT,
  resolution_status ENUM('pending', 'resolved', 'ignored') DEFAULT 'pending',
  resolution_action TEXT,
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 漏斗层级配置表
CREATE TABLE funnel_tier_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  campaign_id INT NOT NULL,
  tier_level ENUM('tier1_exact', 'tier2_longtail', 'tier3_explore') NOT NULL,
  match_type_filter VARCHAR(32),
  auto_negative_sync TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 已知词库表
CREATE TABLE known_keywords_library (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  keyword_text VARCHAR(500) NOT NULL,
  keyword_category ENUM('high_relevance', 'competitor', 'brand', 'generic', 'longtail') NOT NULL,
  source_tier ENUM('tier1', 'tier2', 'tier3', 'manual') NOT NULL,
  performance_score DECIMAL(5,2),
  is_active TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## 4. API接口设计

### 4.1 N-Gram分析接口

```typescript
// 执行N-Gram分析
POST /api/trpc/trafficIsolation.runNGramAnalysis
Input: { accountId: number, dateRange: { start: Date, end: Date }, minFrequency?: number }
Output: { results: NGramAnalysisResult[], totalTokensAnalyzed: number, suggestedNegatives: number }

// 获取N-Gram分析结果
GET /api/trpc/trafficIsolation.getNGramResults
Input: { accountId: number, tokenType?: 'unigram' | 'bigram', minFrequency?: number }
Output: { results: NGramAnalysisResult[] }

// 应用N-Gram否定建议
POST /api/trpc/trafficIsolation.applyNGramNegatives
Input: { accountId: number, tokens: string[], targetCampaignIds?: number[] }
Output: { applied: number, failed: number, errors: string[] }
```

### 4.2 流量隔离接口

```typescript
// 检测流量冲突
POST /api/trpc/trafficIsolation.detectTrafficConflicts
Input: { accountId: number, dateRange: { start: Date, end: Date } }
Output: { conflicts: TrafficConflict[], totalConflicts: number }

// 解决流量冲突
POST /api/trpc/trafficIsolation.resolveTrafficConflict
Input: { conflictId: number, winnerCampaignId: number, autoApplyNegatives?: boolean }
Output: { success: boolean, negativesApplied: number }

// 批量解决冲突
POST /api/trpc/trafficIsolation.batchResolveConflicts
Input: { accountId: number, strategy: 'best_cvr' | 'best_aov' | 'best_roas' | 'manual' }
Output: { resolved: number, negativesApplied: number }
```

### 4.3 漏斗模型接口

```typescript
// 配置漏斗层级
POST /api/trpc/trafficIsolation.configureFunnelTier
Input: { campaignId: number, tierLevel: 'tier1_exact' | 'tier2_longtail' | 'tier3_explore' }
Output: { success: boolean }

// 同步漏斗否定词
POST /api/trpc/trafficIsolation.syncFunnelNegatives
Input: { accountId: number, autoApply?: boolean }
Output: { suggestions: NegativeSuggestion[], applied?: number }

// 获取新词迁移建议
GET /api/trpc/trafficIsolation.getKeywordMigrationSuggestions
Input: { accountId: number, minConversions?: number, minCVR?: number }
Output: { suggestions: KeywordMigrationSuggestion[] }
```

## 5. 算法参数配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| ngram_min_frequency | 10 | N-Gram词根最小出现频率 |
| ngram_confidence_threshold | 0.7 | 建议否定的置信度阈值 |
| conflict_min_overlap_days | 3 | 判定流量冲突的最小重叠天数 |
| cvr_weight | 0.4 | 流量归属决策中CVR的权重 |
| aov_weight | 0.3 | 流量归属决策中AOV的权重 |
| roas_weight | 0.2 | 流量归属决策中ROAS的权重 |
| data_volume_weight | 0.1 | 流量归属决策中数据量的权重 |
| migration_min_conversions | 3 | 建议迁移的最小转化数 |
| migration_min_cvr | 0.05 | 建议迁移的最小转化率 |

## 6. 执行流程

### 6.1 自动化执行周期

1. **每日执行**：N-Gram分析、流量冲突检测
2. **每周执行**：漏斗否定词同步、新词迁移建议
3. **实时监控**：高优先级冲突告警

### 6.2 安全边界

- 单次否定词添加上限：100个
- 单日否定词添加上限：500个
- 高频词根确认阈值：出现50次以上需人工确认
- 核心词保护：品牌词、高转化词不自动否定

## 7. 预期效果

| 指标 | 预期改善 |
|------|----------|
| 无效点击减少 | 30-50% |
| 流量重叠减少 | 60-80% |
| 数据归因准确性 | 显著提升 |
| 人工操作工作量 | 减少70% |

---

**文档版本**：1.0  
**作者**：Manus AI  
**创建日期**：2026-01-08
