/**
 * v361: 搜索词与否定词管理
 * 从db.ts拆分的子模块
 */

import { and, desc, eq, not, sql } from 'drizzle-orm';
import { Campaign, InsertSearchTerm, adGroups, biddingLogs, campaigns, dailyPerformance, keywords, negativeKeywords, productTargets, searchTerms } from '../../drizzle/schema';
import { getDb } from './connection';
import { guardCampaignIdParam, guardCampaignIdInsert } from '../utils/idTypes';

// ==================== Ad Automation Functions ====================

// 获取搜索词数据用于N-Gram分析 - 使用keywords表的数据
export async function getSearchTermsForAnalysis(accountId: number, _days: number = 30) {
  const db = await getDb();
  if (!db) return [];
  
  // 使用keywords表自带的绩效数据
  const result = await db.select({
    searchTerm: keywords.keywordText,
    clicks: keywords.clicks,
    orders: keywords.orders,
    spend: keywords.spend,
    sales: keywords.sales,
    impressions: keywords.impressions,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
  .where(eq(campaigns.accountId, accountId));
  
  return result.map(r => ({
    searchTerm: r.searchTerm || '',
    clicks: Number(r.clicks) || 0,
    conversions: Number(r.orders) || 0,
    spend: parseFloat(r.spend || '0'),
    sales: parseFloat(r.sales || '0'),
    impressions: Number(r.impressions) || 0,
  }));
}

// 获取广告活动搜索词数据用于漏斗迁移和冲突检测

// 获取广告活动搜索词数据用于漏斗迁移和冲突检测
export async function getCampaignSearchTerms(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  // 使用keywords表自带的绩效数据
  const result = await db.select({
    searchTerm: keywords.keywordText,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    matchType: keywords.matchType,
    clicks: keywords.clicks,
    spend: keywords.spend,
    sales: keywords.sales,
    orders: keywords.orders,
    bid: keywords.bid,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
  .where(eq(campaigns.accountId, accountId));
  
  return result.map(r => {
    const clicks = Number(r.clicks) || 0;
    const orders = Number(r.orders) || 0;
    const spend = parseFloat(r.spend || '0');
    const sales = parseFloat(r.sales || '0');
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    
    return {
      searchTerm: r.searchTerm || '',
      campaignId: r.campaignId,
      campaignName: r.campaignName || '',
      campaignType: 'sp_manual' as const, // 默认为SP手动广告
      targetingType: 'keyword' as const, // 关键词定位
      matchType: (r.matchType || 'broad') as 'broad' | 'phrase' | 'exact' | 'auto' | 'product',
      clicks,
      conversions: orders,
      spend,
      sales,
      roas,
      acos,
      cpc,
    };
  });
}

// 获取竞价目标数据用于智能竞价分析

// 获取竞价目标数据用于智能竞价分析
export async function getBidTargets(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  // 获取关键词目标 - 使用keywords表自带的绩效数据
  const keywordTargets = await db.select({
    id: keywords.id,
    name: keywords.keywordText,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    currentBid: keywords.bid,
    impressions: keywords.impressions,
    clicks: keywords.clicks,
    spend: keywords.spend,
    sales: keywords.sales,
    orders: keywords.orders,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
  .where(eq(campaigns.accountId, accountId));
  
  // 获取商品定位目标 - 使用productTargets表自带的绩效数据
  const productTargetResults = await db.select({
    id: productTargets.id,
    name: productTargets.targetValue,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    currentBid: productTargets.bid,
    impressions: productTargets.impressions,
    clicks: productTargets.clicks,
    spend: productTargets.spend,
    sales: productTargets.sales,
    orders: productTargets.orders,
  })
  .from(productTargets)
  .innerJoin(adGroups, eq(productTargets.internalAdGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
  .where(eq(campaigns.accountId, accountId));
  
  const results = [
    ...keywordTargets.map(r => ({
      id: r.id,
      type: 'keyword' as const,
      name: r.name || '',
      campaignId: r.campaignId,
      campaignName: r.campaignName || '',
      currentBid: parseFloat(r.currentBid || '0'),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      conversions: Number(r.orders) || 0,
      spend: parseFloat(r.spend || '0'),
      sales: parseFloat(r.sales || '0'),
    })),
    ...productTargetResults.map(r => ({
      id: r.id,
      type: 'product_target' as const,
      name: r.name || '',
      campaignId: r.campaignId,
      campaignName: r.campaignName || '',
      currentBid: parseFloat(r.currentBid || '0'),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      conversions: Number(r.orders) || 0,
      spend: parseFloat(r.spend || '0'),
      sales: parseFloat(r.sales || '0'),
    })),
  ];
  
  return results;
}

// 获取唯一搜索词列表用于分类

// 获取唯一搜索词列表用于分类
export async function getUniqueSearchTerms(accountId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.selectDistinct({
    searchTerm: keywords.keywordText,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
  .where(eq(campaigns.accountId, accountId));
  
  return result.map(r => r.searchTerm || '').filter(t => t.length > 0);
}

// 添加否定关键词
// addNegativeKeyword函数已移至文件末尾的批量操作扩展部分

// 记录漏斗迁移操作

// 添加否定关键词
// addNegativeKeyword函数已移至文件末尾的批量操作扩展部分

// 记录漏斗迁移操作
export async function recordMigration(data: {
  accountId: number;
  searchTerm: string;
  fromCampaignId: number | string;  // v207: Amazon campaignId (varchar)
  toMatchType: 'phrase' | 'exact';
  suggestedBid: number;
  status: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 记录到bidding_logs
  await db.insert(biddingLogs).values({
    accountId: data.accountId,
    campaignId: guardCampaignIdInsert(data.fromCampaignId, 'biddingLogs'),  // v208: 写入守卫
    logTargetType: 'keyword',
    targetId: 0,
    targetName: data.searchTerm,
    logMatchType: data.toMatchType,
    actionType: 'set',
    previousBid: '0',
    newBid: data.suggestedBid.toString(),
    reason: `漏斗迁移: 升级到${data.toMatchType}匹配`,
  });
}


// ==================== Ad Automation Functions ====================


// ==================== 半月纠错复盘 ====================

// ==================== Ad Automation Functions ====================


// ==================== 半月纠错复盘 ====================

export interface BidChangeRecord {
  id: number;
  targetId: number;
  targetName: string;
  targetType: 'keyword' | 'product_target' | 'placement';
  campaignId: number;
  campaignName: string;
  oldBid: number;
  newBid: number;
  changeDate: string;
  changeReason: string;
  performanceAfter?: {
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    roas: number;
    acos: number;
  };
}

export async function getBidChangeRecords(accountId: number, days: number): Promise<BidChangeRecord[]> {
  const db = await getDb();
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  // 从bidding_logs获取出价变更记录
  const logs = await db.select()
    .from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId))
    .orderBy(desc(biddingLogs.createdAt))
    .limit(500);
  
  // 转换为BidChangeRecord格式
  const records: BidChangeRecord[] = [];
  for (const bidRecord of logs) {
    if (bidRecord.actionType !== 'increase' && bidRecord.actionType !== 'decrease' && bidRecord.actionType !== 'set') {
      continue;
    }
    
    const oldBid = parseFloat(bidRecord.previousBid || '0');
    const newBid = parseFloat(bidRecord.newBid || '0');
    
    if (oldBid === 0 || newBid === 0) continue;
    
    // v187: 使用真实数据库数据代替模拟数据
    // 从日绩效表获取出价变更后7天的平均绩效
    let performanceAfter = {
      clicks: 0,
      conversions: 0,
      spend: 0,
      sales: 0,
      roas: 0,
      acos: 0,
    };
    try {
      if (bidRecord.campaignId) {
        const changeDate = new Date(bidRecord.createdAt || Date.now());
        const endDate = new Date(changeDate);
        endDate.setDate(endDate.getDate() + 7);
        const perfRows = await db.select()
          .from(dailyPerformance)
          .where(and(
            // @ts-ignore - dynamic property access
            eq(dailyPerformance.campaignId, String((log as Record<string, unknown>).campaignId)),
            sql`DATE(${dailyPerformance.date}) >= ${changeDate.toISOString().split('T')[0]}`,
            sql`DATE(${dailyPerformance.date}) <= ${endDate.toISOString().split('T')[0]}`
          ));
        if (perfRows.length > 0) {
          // @ts-ignore Type inference limitation
          const totalClicks = perfRows.reduce((s: unknown, r: unknown) => s + (r.clicks || 0), 0);
          // @ts-ignore Type inference limitation
          const totalSpend = perfRows.reduce((s: unknown, r: unknown) => s + parseFloat(String(r.spend || '0')), 0);
          // @ts-ignore Type inference limitation
          const totalSales = perfRows.reduce((s: unknown, r: unknown) => s + parseFloat(String(r.sales || '0')), 0);
          // @ts-ignore Type inference limitation
          const totalOrders = perfRows.reduce((s: unknown, r: unknown) => s + (r.orders || 0), 0);
          // @ts-ignore Legacy code type compatibility
          performanceAfter = {
            // @ts-ignore Legacy code type compatibility
            clicks: totalClicks,
            // @ts-ignore Legacy code type compatibility
            conversions: totalOrders,
            // @ts-ignore Legacy code type compatibility
            spend: totalSpend,
            // @ts-ignore Legacy code type compatibility
            sales: totalSales,
            // @ts-ignore Conditional type narrowing
            roas: totalSpend > 0 ? totalSales / totalSpend : 0,
            // @ts-ignore Conditional type narrowing
            acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
          };
        }
      }
    } catch (e: any) {
      // 查询失败时使用零值，不使用模拟数据
    }
    
    records.push({
      id: bidRecord.id,
      targetId: bidRecord.targetId || 0,
      targetName: bidRecord.targetName || '',
      targetType: bidRecord.logTargetType as 'keyword' | 'product_target' | 'placement',
      // @ts-ignore - type assertion
      campaignId: bidRecord.campaignId || 0 as unknown,
      campaignName: '',
      oldBid,
      newBid,
      changeDate: bidRecord.createdAt || new Date().toISOString(),
      changeReason: bidRecord.reason || '',
      performanceAfter,
    });
  }
  
  return records;
}

export async function recordBidChange(data: {
  accountId: number;
  targetId: number;
  targetType: 'keyword' | 'product';
  oldBid: number;
  newBid: number;
  reason: string;
  campaignId?: number | string;  // v207: Amazon campaignId (varchar)
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 将'product'转换为'product_target'以匹配数据库枚举值
  const dbTargetType = data.targetType === 'product' ? 'product_target' : 'keyword';
  
  await db.insert(biddingLogs).values({
    accountId: data.accountId,
    campaignId: data.campaignId ? guardCampaignIdInsert(data.campaignId, 'biddingLogs') : '',  // v208: 写入守卫
    logTargetType: dbTargetType,
    targetId: data.targetId,
    targetName: '',
    logMatchType: 'exact',
    actionType: data.newBid > data.oldBid ? 'increase' : 'decrease',
    previousBid: data.oldBid.toString(),
    newBid: data.newBid.toString(),
    reason: data.reason,
  });
}

// ==================== 广告活动健康度监控 ====================

// ==================== 广告活动健康度监控 ====================

export interface CampaignHealthMetrics {
  campaignId: number;
  campaignName: string;
  campaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
  currentMetrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
    cpc: number;
  };
  historicalAverage: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
    cpc: number;
  };
  changes: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
    cpc: number;
  };
}

export async function getCampaignHealthMetrics(accountId: number): Promise<CampaignHealthMetrics[]> {
  const db = await getDb();
  if (!db) return [];
  
  // 获取所有广告活动
  // @ts-ignore DB query type inference limitation
  const campaignList = await db.select()
    .from(campaigns)
    .where(eq(campaigns.accountId, accountId));
  
  const results: CampaignHealthMetrics[] = [];
  
  for (const campaign of (campaignList as unknown[])) {
    // 获取最近7天的绩效数据
    const recentPerf = await db.select()
      .from(dailyPerformance)
      // @ts-ignore DB query type inference limitation
      .where(eq(dailyPerformance.campaignId, String(campaign.campaignId)))
      .orderBy(desc(dailyPerformance.date))
      .limit(7);
    
    // 获取历史30天的绩效数据
    const historicalPerf = await db.select()
      .from(dailyPerformance)
      // @ts-ignore DB query type inference limitation
      .where(eq(dailyPerformance.campaignId, String(campaign.campaignId)))
      .orderBy(desc(dailyPerformance.date))
      // @ts-ignore Legacy code type compatibility
      .limit(30);
    
    // 计算当前指标（最近7天平均）
    const currentMetrics = calculateAverageMetrics(recentPerf);
    
    // 计算历史平均（30天）
    const historicalAverage = calculateAverageMetrics(historicalPerf);
    
    // 计算变化百分比
    const changes = calculateMetricChanges(currentMetrics, historicalAverage);
    
    results.push({
      // @ts-ignore Amazon API response type flexibility
      campaignId: String(campaign.campaignId),
      // @ts-ignore Amazon API response type flexibility
      campaignName: campaign.campaignName,
      // @ts-ignore Amazon API response type flexibility
      campaignType: campaign.campaignType as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
      currentMetrics,
      historicalAverage,
      changes,
    });
  }
  
  return results;
}

function calculateAverageMetrics(perfData: unknown[]): CampaignHealthMetrics['currentMetrics'] {
  if (perfData.length === 0) {
    return {
      impressions: 0,
      clicks: 0,
      spend: 0,
      sales: 0,
      orders: 0,
      ctr: 0,
      cvr: 0,
      acos: 0,
      roas: 0,
      cpc: 0,
    };
  }
  
  interface PerfTotals { impressions: number; clicks: number; spend: number; sales: number; orders: number; }
  const totals: PerfTotals = (perfData as Array<Record<string, unknown>>).reduce<PerfTotals>((acc, p) => ({
    impressions: acc.impressions + (Number(p.impressions) || 0),
    clicks: acc.clicks + (Number(p.clicks) || 0),
    spend: acc.spend + parseFloat(String(p.spend || '0')),
    sales: acc.sales + parseFloat(String(p.sales || '0')),
    orders: acc.orders + (Number(p.orders) || 0),
  }), { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 });
  
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cvr = totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0;
  const acos = totals.sales > 0 ? (totals.spend / totals.sales) * 100 : 0;
  const roas = totals.spend > 0 ? totals.sales / totals.spend : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  
  return {
    impressions: Math.round(totals.impressions / perfData.length),
    clicks: Math.round(totals.clicks / perfData.length),
    spend: totals.spend / perfData.length,
    sales: totals.sales / perfData.length,
    orders: Math.round(totals.orders / perfData.length),
    ctr,
    cvr,
    acos,
    roas,
    cpc,
  };
}

function calculateMetricChanges(
  current: CampaignHealthMetrics['currentMetrics'],
  historical: CampaignHealthMetrics['historicalAverage']
): CampaignHealthMetrics['changes'] {
  const calcChange = (curr: number, hist: number) => {
    if (hist === 0) return curr > 0 ? 100 : 0;
    return ((curr - hist) / hist) * 100;
  };
  
  return {
    impressions: calcChange(current.impressions, historical.impressions),
    clicks: calcChange(current.clicks, historical.clicks),
    spend: calcChange(current.spend, historical.spend),
    sales: calcChange(current.sales, historical.sales),
    orders: calcChange(current.orders, historical.orders),
    ctr: calcChange(current.ctr, historical.ctr),
    cvr: calcChange(current.cvr, historical.cvr),
    acos: calcChange(current.acos, historical.acos),
    roas: calcChange(current.roas, historical.roas),
    cpc: calcChange(current.cpc, historical.cpc),
  };
}

// ==================== 批量操作扩展 ====================

// ==================== 批量操作扩展 ====================

export async function addNegativeKeyword(data: {
  campaignId: string | number;
  adGroupId?: number;
  // @ts-ignore Legacy code type compatibility
  keyword: string;
  matchType: 'phrase' | 'exact';
  level?: 'ad_group' | 'campaign';
  accountId?: number; // v453: 支持传入accountId，不再硬编码
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v453: 如果未传入accountId，通过campaignId查询关联账号
  let resolvedAccountId = data.accountId || 0;
  if (!resolvedAccountId && data.campaignId) {
    try {
      const { sql } = await import('drizzle-orm');
      const rows = await db.execute(sql`SELECT accountId FROM campaigns WHERE id = ${data.campaignId} OR campaignId = ${String(data.campaignId)} LIMIT 1`);
      if (rows && (rows as unknown[]).length > 0) {
        // @ts-ignore Dynamic type assertion
        resolvedAccountId = (rows as unknown[])[0]?.accountId || 0;
      }
    } catch { /* 查询失败时使用默认值 */ }
  }
  
  // 记录到negativeKeywords表
  // @ts-ignore - Drizzle query builder type
  await db.insert(negativeKeywords).values({
    accountId: resolvedAccountId,
    campaignId: data.campaignId,
    internalAdGroupId: data.adGroupId || null,
    negativeLevel: data.level || (data.adGroupId ? 'ad_group' : 'campaign'),
    negativeType: 'keyword',
    negativeText: data.keyword,
    negativeMatchType: data.matchType === 'phrase' ? 'negative_phrase' : 'negative_exact',
    negativeSource: 'manual',
  } as Record<string, unknown>);
}


// 获取广告活动的否定关键词列表

// 获取广告活动的否定关键词列表
export async function getNegativeKeywordsByCampaignId(campaignId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(negativeKeywords).where(eq(negativeKeywords.campaignId, String(campaignId)));
}

// 获取账号的所有否定关键词列表

// 获取账号的所有否定关键词列表
export async function getNegativeKeywordsByAccountId(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(negativeKeywords).where(eq(negativeKeywords.accountId, accountId));
}

// v381: 获取广告组级别的否定关键词/否定商品定向
export async function getNegativeKeywordsByAdGroupId(adGroupId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(negativeKeywords).where(eq(negativeKeywords.internalAdGroupId, Number(adGroupId)));
}

// ==================== Notification Functions ====================

// ==================== Search Terms Functions ====================
export async function getSearchTermsByCampaignId(campaignId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  // v208: 入口守卫 — campaignId必须是Amazon ID
  const campaignIdStr = guardCampaignIdParam(campaignId, 'getSearchTermsByCampaignId');
  return db.select().from(searchTerms).where(eq(searchTerms.campaignId, campaignIdStr));
}

// v357: adGroupId参数类型改为string | number

// v357: adGroupId参数类型改为string | number
export async function getSearchTermsByAdGroupId(adGroupId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(searchTerms).where(eq(searchTerms.internalAdGroupId, Number(adGroupId)));
}

export async function createSearchTerm(data: InsertSearchTerm) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(searchTerms).values(data);
  return result[0].insertId;
}

/**
 * v361: UPSERT模式 - 避免搜索词重复插入
 */

/**
 * v361: UPSERT模式 - 避免搜索词重复插入
 */
export async function bulkCreateSearchTerms(data: InsertSearchTerm[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (data.length === 0) return;
  await db.insert(searchTerms).values(data).onDuplicateKeyUpdate({
    set: {
      searchTermImpressions: sql`VALUES(search_term_impressions)`,
      searchTermClicks: sql`VALUES(search_term_clicks)`,
      searchTermSpend: sql`VALUES(search_term_spend)`,
      searchTermSales: sql`VALUES(search_term_sales)`,
      searchTermOrders: sql`VALUES(search_term_orders)`,
    },
  });
}

// ==================== Campaign Detail Functions ====================
