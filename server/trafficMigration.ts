/**
 * 流量迁移和冲突消解算法
 * 
 * 实现 Broad → Phrase → Exact 的迁移漏斗
 * 支持流量隔离和冲突消解
 */

import { getDb } from "./db";
import { searchTerms, keywords, negativeKeywords, campaigns } from "../drizzle/schema";
import { eq, and, gte, sql, inArray, ne } from "drizzle-orm";

// 迁移配置
export const MIGRATION_CONFIG = {
  // 迁移触发条件
  MIGRATION_TRIGGERS: {
    MIN_CLICKS: 5,              // 最小点击数
    MIN_ORDERS: 2,              // 最小订单数
    MIN_CVR: 5,                 // 最小转化率(%)
    MAX_ACOS: 30,               // 最大ACoS(%)
    MIN_ROAS: 3.0,              // 最小ROAS
  },
  
  // 冲突消解配置
  CONFLICT_RESOLUTION: {
    MIN_PERFORMANCE_DIFF: 20,   // 最小表现差异(%)
    WINNER_SELECTION: 'roas',   // 胜者选择标准: 'roas' | 'cvr' | 'acos'
  },
  
  // 层级过滤配置
  TIER_ARCHITECTURE: {
    TIER1: 'exact',             // 第一层：精准匹配
    TIER2: 'phrase',            // 第二层：短语匹配
    TIER3: 'broad',             // 第三层：广泛匹配
  },
};

// 搜索词表现类型
export interface SearchTermPerformance {
  searchTerm: string;
  campaignId: number;
  campaignName: string;
  adGroupId: number;
  matchType: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  ctr: number;
  cvr: number;
  acos: number;
  roas: number;
}

// 迁移建议类型
export interface MigrationSuggestion {
  searchTerm: string;
  sourceCampaign: {
    id: number;
    name: string;
    matchType: string;
  };
  targetTier: 'exact' | 'phrase';
  performance: {
    clicks: number;
    orders: number;
    cvr: number;
    acos: number;
    roas: number;
  };
  reason: string;
  priority: 'high' | 'medium' | 'low';
  action: 'migrate_to_exact' | 'migrate_to_phrase' | 'add_negative';
}

// 冲突检测类型
export interface ConflictDetection {
  searchTerm: string;
  campaigns: Array<{
    campaignId: number;
    campaignName: string;
    matchType: string;
    clicks: number;
    orders: number;
    cvr: number;
    acos: number;
    roas: number;
  }>;
  winner: {
    campaignId: number;
    campaignName: string;
    reason: string;
  };
  losers: Array<{
    campaignId: number;
    campaignName: string;
  }>;
  severity: 'high' | 'medium' | 'low';
}

/**
 * 分析搜索词表现
 */
export async function analyzeSearchTermPerformance(
  accountId: number,
  campaignIds?: number[],
  days: number = 30
): Promise<SearchTermPerformance[]> {
  const db = await getDb();
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  // 构建查询
  let query = `
    SELECT 
      st.search_term,
      st.campaign_id,
      c.campaign_name,
      st.ad_group_id,
      st.search_term_match_type as match_type,
      SUM(st.search_term_impressions) as impressions,
      SUM(st.search_term_clicks) as clicks,
      SUM(st.search_term_spend) as spend,
      SUM(st.search_term_sales) as sales,
      SUM(st.search_term_orders) as orders
    FROM search_terms st
    JOIN campaigns c ON st.campaign_id = c.id
    WHERE st.account_id = ?
    AND st.report_start_date >= ?
  `;
  const params: any[] = [accountId, startDateStr];
  
  if (campaignIds && campaignIds.length > 0) {
    query += ` AND st.campaign_id IN (${campaignIds.map(() => '?').join(',')})`;
    params.push(...campaignIds);
  }
  
  query += ` GROUP BY st.search_term, st.campaign_id, c.campaign_name, st.ad_group_id, st.search_term_match_type`;
  
  const result = await db.execute(sql.raw(query));
  const rows = (result as any[])[0] || [];
  
  // 计算指标
  return rows.map((t: any) => {
    const impressions = Number(t.impressions) || 0;
    const clicks = Number(t.clicks) || 0;
    const spend = Number(t.spend) || 0;
    const sales = Number(t.sales) || 0;
    const orders = Number(t.orders) || 0;
    
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : Infinity;
    const roas = spend > 0 ? sales / spend : 0;
    
    return {
      searchTerm: t.search_term,
      campaignId: t.campaign_id,
      campaignName: t.campaign_name,
      adGroupId: t.ad_group_id,
      matchType: t.match_type || 'unknown',
      impressions,
      clicks,
      spend,
      sales,
      orders,
      ctr,
      cvr,
      acos,
      roas,
    };
  });
}

/**
 * 生成迁移建议
 */
export async function generateMigrationSuggestions(
  accountId: number,
  campaignIds?: number[],
  days: number = 30,
  targetRoas: number = 3.0
): Promise<MigrationSuggestion[]> {
  const termPerformance = await analyzeSearchTermPerformance(accountId, campaignIds, days);
  
  const suggestions: MigrationSuggestion[] = [];
  const triggers = MIGRATION_CONFIG.MIGRATION_TRIGGERS;
  
  for (const term of termPerformance) {
    // 跳过已经是精准匹配的词
    if (term.matchType === 'exact') continue;
    
    // 检查是否满足迁移条件
    const meetsClickThreshold = term.clicks >= triggers.MIN_CLICKS;
    const meetsOrderThreshold = term.orders >= triggers.MIN_ORDERS;
    const meetsCvrThreshold = term.cvr >= triggers.MIN_CVR;
    const meetsAcosThreshold = term.acos <= triggers.MAX_ACOS;
    const meetsRoasThreshold = term.roas >= targetRoas;
    
    // 高优先级：满足所有条件
    if (meetsClickThreshold && meetsOrderThreshold && meetsCvrThreshold && meetsRoasThreshold) {
      const targetTier = term.matchType === 'broad' ? 'phrase' : 'exact';
      
      suggestions.push({
        searchTerm: term.searchTerm,
        sourceCampaign: {
          id: term.campaignId,
          name: term.campaignName,
          matchType: term.matchType,
        },
        targetTier: targetTier as 'exact' | 'phrase',
        performance: {
          clicks: term.clicks,
          orders: term.orders,
          cvr: term.cvr,
          acos: term.acos,
          roas: term.roas,
        },
        reason: `高表现词 (ROAS ${term.roas.toFixed(2)}, CVR ${term.cvr.toFixed(1)}%)`,
        priority: 'high',
        action: targetTier === 'exact' ? 'migrate_to_exact' : 'migrate_to_phrase',
      });
    }
    // 中优先级：满足大部分条件
    else if (meetsClickThreshold && meetsOrderThreshold && (meetsCvrThreshold || meetsRoasThreshold)) {
      const targetTier = term.matchType === 'broad' ? 'phrase' : 'exact';
      
      suggestions.push({
        searchTerm: term.searchTerm,
        sourceCampaign: {
          id: term.campaignId,
          name: term.campaignName,
          matchType: term.matchType,
        },
        targetTier: targetTier as 'exact' | 'phrase',
        performance: {
          clicks: term.clicks,
          orders: term.orders,
          cvr: term.cvr,
          acos: term.acos,
          roas: term.roas,
        },
        reason: `潜力词 (${term.orders}订单, CVR ${term.cvr.toFixed(1)}%)`,
        priority: 'medium',
        action: targetTier === 'exact' ? 'migrate_to_exact' : 'migrate_to_phrase',
      });
    }
  }
  
  // 按优先级和ROAS排序
  suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.performance.roas - a.performance.roas;
  });
  
  return suggestions;
}

/**
 * 检测流量冲突
 */
export async function detectTrafficConflicts(
  accountId: number,
  campaignIds?: number[],
  days: number = 30
): Promise<ConflictDetection[]> {
  const termPerformance = await analyzeSearchTermPerformance(accountId, campaignIds, days);
  
  // 按搜索词分组
  const termGroups = new Map<string, SearchTermPerformance[]>();
  for (const term of termPerformance) {
    const existing = termGroups.get(term.searchTerm) || [];
    existing.push(term);
    termGroups.set(term.searchTerm, existing);
  }
  
  const conflicts: ConflictDetection[] = [];
  
  // 找出在多个Campaign中出现的搜索词
  for (const [searchTerm, terms] of Array.from(termGroups.entries())) {
    // 获取唯一的Campaign列表
    const uniqueCampaigns = new Map<number, SearchTermPerformance>();
    for (const term of terms) {
      const existing = uniqueCampaigns.get(term.campaignId);
      if (!existing || term.clicks > existing.clicks) {
        uniqueCampaigns.set(term.campaignId, term);
      }
    }
    
    // 如果只在一个Campaign中出现，不算冲突
    if (uniqueCampaigns.size <= 1) continue;
    
    // 构建冲突信息
    const campaignList = Array.from(uniqueCampaigns.values()).map(t => ({
      campaignId: t.campaignId,
      campaignName: t.campaignName,
      matchType: t.matchType,
      clicks: t.clicks,
      orders: t.orders,
      cvr: t.cvr,
      acos: t.acos,
      roas: t.roas,
    }));
    
    // 选择胜者（基于ROAS）
    const sortedByRoas = [...campaignList].sort((a, b) => b.roas - a.roas);
    const winner = sortedByRoas[0];
    const losers = sortedByRoas.slice(1);
    
    // 计算严重程度
    const totalClicks = campaignList.reduce((sum, c) => sum + c.clicks, 0);
    let severity: 'high' | 'medium' | 'low' = 'low';
    if (totalClicks >= 50 || campaignList.length >= 3) {
      severity = 'high';
    } else if (totalClicks >= 20 || campaignList.length >= 2) {
      severity = 'medium';
    }
    
    conflicts.push({
      searchTerm,
      campaigns: campaignList,
      winner: {
        campaignId: winner.campaignId,
        campaignName: winner.campaignName,
        reason: `最高ROAS (${winner.roas.toFixed(2)})`,
      },
      losers: losers.map(l => ({
        campaignId: l.campaignId,
        campaignName: l.campaignName,
      })),
      severity,
    });
  }
  
  // 按严重程度排序
  conflicts.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
  
  return conflicts;
}

/**
 * 执行流量隔离（添加否定词）
 */
export async function executeTrafficIsolation(
  accountId: number,
  isolations: Array<{
    searchTerm: string;
    campaignId: number;
    adGroupId?: number;
  }>
): Promise<{ success: boolean; addedCount: number; errors: string[] }> {
  const db = await getDb();
  if (!db) return { success: false, addedCount: 0, errors: ['Database not available'] };
  
  const errors: string[] = [];
  let addedCount = 0;
  
  for (const isolation of isolations) {
    try {
      await db.insert(negativeKeywords).values({
        accountId,
        campaignId: isolation.campaignId,
        adGroupId: isolation.adGroupId || null,
        negativeLevel: isolation.adGroupId ? 'ad_group' : 'campaign',
        negativeType: 'keyword',
        negativeText: isolation.searchTerm,
        negativeMatchType: 'negative_exact',
        negativeSource: 'traffic_conflict',
        negativeStatus: 'active',
      });
      addedCount++;
    } catch (error: any) {
      if (!error.message?.includes('Duplicate')) {
        errors.push(`添加否定词 "${isolation.searchTerm}" 到Campaign ${isolation.campaignId} 失败: ${error.message}`);
      }
    }
  }
  
  return {
    success: errors.length === 0,
    addedCount,
    errors,
  };
}

/**
 * 获取迁移摘要
 */
export async function getMigrationSummary(
  accountId: number,
  campaignIds?: number[],
  days: number = 30
): Promise<{
  totalSearchTerms: number;
  migrationCandidates: number;
  highPriority: number;
  mediumPriority: number;
  conflictCount: number;
  estimatedImpact: {
    potentialSavings: number;
    potentialRoasImprovement: number;
  };
}> {
  const suggestions = await generateMigrationSuggestions(accountId, campaignIds, days);
  const conflicts = await detectTrafficConflicts(accountId, campaignIds, days);
  const termPerformance = await analyzeSearchTermPerformance(accountId, campaignIds, days);
  
  const uniqueTerms = new Set(termPerformance.map(t => t.searchTerm));
  
  const highPriority = suggestions.filter(s => s.priority === 'high').length;
  const mediumPriority = suggestions.filter(s => s.priority === 'medium').length;
  
  // 估算潜在节省（冲突词的重复花费）
  let potentialSavings = 0;
  for (const conflict of conflicts) {
    const loserSpend = conflict.losers.reduce((sum, l) => {
      const loserData = conflict.campaigns.find(c => c.campaignId === l.campaignId);
      return sum + (loserData?.clicks || 0) * 0.5; // 假设CPC为0.5
    }, 0);
    potentialSavings += loserSpend;
  }
  
  return {
    totalSearchTerms: uniqueTerms.size,
    migrationCandidates: suggestions.length,
    highPriority,
    mediumPriority,
    conflictCount: conflicts.length,
    estimatedImpact: {
      potentialSavings,
      potentialRoasImprovement: suggestions.length > 0 ? 0.15 : 0, // 预估15%ROAS提升
    },
  };
}

/**
 * 获取层级过滤架构状态
 */
export async function getTierArchitectureStatus(
  accountId: number,
  campaignIds?: number[]
): Promise<{
  tier1: { name: string; keywords: number; description: string };
  tier2: { name: string; keywords: number; description: string };
  tier3: { name: string; keywords: number; description: string };
  isolationStatus: {
    tier1InTier2Negatives: number;
    tier1InTier3Negatives: number;
    tier2InTier3Negatives: number;
  };
}> {
  const db = await getDb();
  if (!db) {
    return {
      tier1: { name: 'Exact Campaign', keywords: 0, description: '精准匹配层 - 稳定收割高价值流量' },
      tier2: { name: 'Phrase Campaign', keywords: 0, description: '短语匹配层 - 验证转化潜力' },
      tier3: { name: 'Broad Campaign', keywords: 0, description: '广泛匹配层 - 探索新流量' },
      isolationStatus: { tier1InTier2Negatives: 0, tier1InTier3Negatives: 0, tier2InTier3Negatives: 0 },
    };
  }
  
  // 获取各匹配类型的关键词数量
  const query = `
    SELECT match_type, COUNT(*) as count
    FROM keywords
    WHERE account_id = ?
    GROUP BY match_type
  `;
  
  const result = await db.execute(sql.raw(query));
  const rows = (result as any[])[0] || [];
  
  const countMap = new Map<string, number>();
  for (const row of rows) {
    countMap.set(row.match_type, Number(row.count) || 0);
  }
  
  return {
    tier1: {
      name: 'Exact Campaign',
      keywords: countMap.get('exact') || 0,
      description: '精准匹配层 - 稳定收割高价值流量',
    },
    tier2: {
      name: 'Phrase Campaign',
      keywords: countMap.get('phrase') || 0,
      description: '短语匹配层 - 验证转化潜力',
    },
    tier3: {
      name: 'Broad Campaign',
      keywords: countMap.get('broad') || 0,
      description: '广泛匹配层 - 探索新流量',
    },
    isolationStatus: {
      tier1InTier2Negatives: 0, // 需要实际计算
      tier1InTier3Negatives: 0,
      tier2InTier3Negatives: 0,
    },
  };
}
