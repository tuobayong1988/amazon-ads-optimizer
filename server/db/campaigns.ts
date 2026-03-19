/**
 * v361: 广告活动管理
 * 从db.ts拆分的子模块
 */

import { and, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import { Campaign, InsertCampaign, campaigns, dailyPerformance, performanceGroups } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== Campaign Functions ====================
export async function createCampaign(campaign: InsertCampaign) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(campaigns).values(campaign);
  return result[0].insertId;
}

export async function getCampaignsByAccountId(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(campaigns).where(eq(campaigns.accountId, accountId));
}

// 获取带时间范围绩效数据的广告活动列表

// 获取带时间范围绩效数据的广告活动列表
export async function getCampaignsWithPerformance(
  accountId: number,
  startDate: string,
  endDate: string,
  todayDate?: string  // v122h: 站点本地时间的"今天"，用于单独查询今日数据
) {
  const db = await getDb();
  if (!db) return [];
  
  // 获取广告活动基本信息
  const campaignList = await db.select().from(campaigns).where(eq(campaigns.accountId, accountId));
  
  // v401: 获取时间范围内的绩效数据汇总
  // ✅ 只汇总campaign级别的记录，排除账户级汇总记录
  // v401: 优化查询 - 避免DATE()函数包裹以利用idx_daily_perf_account_date索引
  const perfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`${dailyPerformance.date} >= ${startDate}`,
      sql`${dailyPerformance.date} < DATE_ADD(${endDate}, INTERVAL 1 DAY)`
    ))
    .groupBy(dailyPerformance.campaignId);
  
  // v122h: 单独查询今日数据（站点本地时间的今天）
  const effectiveTodayDate = todayDate || endDate;
  // v401: 优化今日数据查询 - 避免DATE()函数包裹以利用索引
  const todayPerfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    todayImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    todayClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    todaySpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    todaySales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    todayOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`${dailyPerformance.date} >= ${effectiveTodayDate}`,
      sql`${dailyPerformance.date} < DATE_ADD(${effectiveTodayDate}, INTERVAL 1 DAY)`
    ))
    .groupBy(dailyPerformance.campaignId);
  
  // 创建绩效数据映射
  const perfMap = new Map<string, typeof perfData[0]>();
  for (const p of perfData) {
    if (p.campaignId) {
      perfMap.set(p.campaignId, p);
    }
  }
  
  // 创建今日数据映射
  const todayPerfMap = new Map<string, typeof todayPerfData[0]>();
  for (const p of todayPerfData) {
    if (p.campaignId) {
      todayPerfMap.set(p.campaignId, p);
    }
  }
  
  // v426: 获取当前账户相关的优化目标组（通过campaigns关联过滤，避免加载全部组）
  const accountGroupIds = [...new Set(campaignList.map((c: unknown) => c.performanceGroupId).filter(Boolean))];
  let groupMap = new Map<number, { id: number; name: string; strategyTemplateId: number | null; strategyTemplateName: string | null }>();
  if (accountGroupIds.length > 0) {
    const relevantGroups = await db.select({
      id: performanceGroups.id,
      name: performanceGroups.name,
      strategyTemplateId: performanceGroups.strategyTemplateId,
      strategyTemplateName: performanceGroups.strategyTemplateName,
    }).from(performanceGroups).where(inArray(performanceGroups.id, accountGroupIds));
    for (const g of relevantGroups) {
      groupMap.set(g.id, g);
    }
  }
  
  // 合并数据 - 包含优化目标组名称和策略模板推荐
  return campaignList.map(campaign => {
    const perf = perfMap.get(campaign.campaignId);
    const impressions = perf?.totalImpressions || 0;
    const clicks = perf?.totalClicks || 0;
    const spend = parseFloat(perf?.totalSpend || '0');
    const sales = parseFloat(perf?.totalSales || '0');
    const orders = perf?.totalOrders || 0;
    
    // 获取优化目标组信息
    const group = campaign.performanceGroupId ? groupMap.get(campaign.performanceGroupId) : null;
    
    // v122h: 获取今日数据
    const todayPerf = todayPerfMap.get(campaign.campaignId);
    const dailySpend = parseFloat(todayPerf?.todaySpend || '0');
    const dailySales = parseFloat(todayPerf?.todaySales || '0');
    const dailyImpressions = todayPerf?.todayImpressions || 0;
    const dailyClicks = todayPerf?.todayClicks || 0;
    const dailyOrders = todayPerf?.todayOrders || 0;
    
    return {
      ...campaign,
      impressions,
      clicks,
      spend: spend.toFixed(2),
      sales: sales.toFixed(2),
      orders,
      acos: sales > 0 ? ((spend / sales) * 100).toFixed(2) : null,
      roas: spend > 0 ? (sales / spend).toFixed(2) : null,
      ctr: impressions > 0 ? ((clicks / impressions) * 100).toFixed(4) : null,
      cvr: clicks > 0 ? ((orders / clicks) * 100).toFixed(4) : null,
      cpc: clicks > 0 ? (spend / clicks).toFixed(2) : null,
      // v122h: 今日数据（站点本地时间）
      dailySpend: dailySpend.toFixed(2),
      dailySales: dailySales.toFixed(2),
      dailyImpressions,
      dailyClicks,
      dailyOrders,
      // 优化目标组信息
      performanceGroupName: group?.name || null,
      performanceGroupStrategyTemplate: group?.strategyTemplateName || null,
      // 策略模板推荐信息（已存储在campaigns表中）
      recommendedStrategyTemplateId: campaign.recommendedStrategyTemplateId || null,
      recommendedStrategyTemplateName: campaign.recommendedStrategyTemplateName || null,
      recommendationReason: campaign.recommendationReason || null,
    };
  });
}

/**
 * v402: 后端分页版本的广告活动列表查询
 * 支持服务端分页、排序、基础筛选，返回分页数据+聚合统计
 * 当前端使用高级数值筛选时，回退到全量模式（serverPagination=false）
 */
export interface CampaignPaginationParams {
  accountId: number;
  startDate: string;
  endDate: string;
  todayDate?: string;
  // 分页参数
  page?: number;
  pageSize?: number;
  // 排序参数
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  // 基础筛选参数
  search?: string;
  campaignType?: string;  // 'all' | 'sp_auto' | 'sp_manual' | 'sb' | 'sd'
  campaignStatus?: string;  // 'all' | 'enabled' | 'paused' | 'archived'
  optimizationStatus?: string;  // 'all' | 'managed' | 'unmanaged'
  // 是否使用服务端分页（false时返回全量数据用于前端高级筛选）
  serverPagination?: boolean;
}

export interface CampaignPaginatedResult {
  data: unknown[];
  total: number;
  filteredTotal: number;
  page: number;
  pageSize: number;
  totalPages: number;
  // 聚合统计（基于全量数据，不受分页影响）
  statusCounts: {
    enabled: number;
    paused: number;
    archived: number;
    managed: number;
    unmanaged: number;
  };
  typeCounts: Record<string, number>;
}

export async function getCampaignsWithPerformancePaginated(
  params: CampaignPaginationParams
): Promise<CampaignPaginatedResult> {
  const db = await getDb();
  if (!db) return { data: [], total: 0, filteredTotal: 0, page: 1, pageSize: 25, totalPages: 0, statusCounts: { enabled: 0, paused: 0, archived: 0, managed: 0, unmanaged: 0 }, typeCounts: {} };
  
  const {
    accountId, startDate, endDate, todayDate,
    page = 1, pageSize = 25,
    sortField, sortDirection = 'desc',
    search, campaignType, campaignStatus, optimizationStatus,
    serverPagination = true
  } = params;
  
  // ========== Step 1: 构建WHERE条件 ==========
  const whereConditions: unknown[] = [eq(campaigns.accountId, accountId)];
  
  // 基础筛选 - 搜索
  if (search && search.trim()) {
    whereConditions.push(sql`${campaigns.campaignName} LIKE ${'%' + search.trim() + '%'}`);
  }
  
  // 基础筛选 - 广告类型
  if (campaignType && campaignType !== 'all') {
    whereConditions.push(eq(campaigns.campaignType, campaignType));
  }
  
  // 基础筛选 - 运行状态
  if (campaignStatus && campaignStatus !== 'all') {
    whereConditions.push(eq(campaigns.campaignStatus, campaignStatus));
  }
  
  // 基础筛选 - 优化状态
  if (optimizationStatus && optimizationStatus !== 'all') {
    if (optimizationStatus === 'managed') {
      whereConditions.push(sql`${campaigns.performanceGroupId} IS NOT NULL`);
    } else if (optimizationStatus === 'unmanaged') {
      whereConditions.push(sql`${campaigns.performanceGroupId} IS NULL`);
    } else {
      whereConditions.push(eq(campaigns.optimizationStatus, optimizationStatus));
    }
  }
  
  const whereClause = and(...whereConditions);
  
  // ========== Step 2: 获取总数和聚合统计（基于accountId全量数据，不受筛选影响） ==========
  const [totalCountResult] = await db.select({
    total: sql<number>`COUNT(*)`,
    enabled: sql<number>`SUM(CASE WHEN ${campaigns.campaignStatus} = 'enabled' THEN 1 ELSE 0 END)`,
    paused: sql<number>`SUM(CASE WHEN ${campaigns.campaignStatus} = 'paused' THEN 1 ELSE 0 END)`,
    archived: sql<number>`SUM(CASE WHEN ${campaigns.campaignStatus} = 'archived' THEN 1 ELSE 0 END)`,
    managed: sql<number>`SUM(CASE WHEN ${campaigns.performanceGroupId} IS NOT NULL THEN 1 ELSE 0 END)`,
    unmanaged: sql<number>`SUM(CASE WHEN ${campaigns.performanceGroupId} IS NULL THEN 1 ELSE 0 END)`,
  }).from(campaigns).where(eq(campaigns.accountId, accountId));
  
  const total = totalCountResult?.total || 0;
  const statusCounts = {
    enabled: totalCountResult?.enabled || 0,
    paused: totalCountResult?.paused || 0,
    archived: totalCountResult?.archived || 0,
    managed: totalCountResult?.managed || 0,
    unmanaged: totalCountResult?.unmanaged || 0,
  };
  
  // 获取类型统计（基于全量数据）
  const typeCountsResult = await db.select({
    campaignType: campaigns.campaignType,
    count: sql<number>`COUNT(*)`,
  }).from(campaigns).where(eq(campaigns.accountId, accountId)).groupBy(campaigns.campaignType);
  const typeCounts: Record<string, number> = {};
  for (const tc of typeCountsResult) {
    if (tc.campaignType) typeCounts[tc.campaignType] = tc.count;
  }
  
  // ========== Step 3: 获取筛选后的总数 ==========
  const [filteredCountResult] = await db.select({
    count: sql<number>`COUNT(*)`,
  }).from(campaigns).where(whereClause);
  const filteredTotal = filteredCountResult?.count || 0;
  
  // ========== Step 4: 构建排序 ==========
  // v402: 支持的排序字段映射
  const sortFieldMap: Record<string, unknown> = {
    campaignName: campaigns.campaignName,
    campaignType: campaigns.campaignType,
    status: campaigns.campaignStatus,
    dailyBudget: campaigns.dailyBudget,
    startDate: campaigns.startDate,
    costType: campaigns.costType,
    campaignGoal: campaigns.campaignGoal,
    adFormat: campaigns.adFormat,
  };
  
  // 绩效字段排序需要特殊处理（在合并后排序）
  const perfSortFields = ['impressions', 'clicks', 'totalSpend', 'totalSales', 'acos', 'roas', 'ctr', 'cvr', 'cpc', 'dailySpend', 'dailySales'];
  const isPerfSort = sortField && perfSortFields.includes(sortField);
  
  // ========== Step 5: 查询广告活动数据 ==========
  let campaignList: unknown[];
  
  if (serverPagination && !isPerfSort) {
    // 服务端分页模式 - 非绩效字段排序时可以直接SQL分页
    let query = db.select().from(campaigns).where(whereClause) as unknown;
    
    // 添加排序
    if (sortField && sortFieldMap[sortField]) {
      const col = sortFieldMap[sortField];
      query = query.orderBy(sortDirection === 'asc' ? sql`${col} ASC` : sql`${col} DESC`);
    } else {
      // 默认按ID降序
      query = query.orderBy(sql`${campaigns.id} DESC`);
    }
    
    // 添加分页
    const offset = (page - 1) * pageSize;
    query = query.limit(pageSize).offset(offset);
    
    campaignList = await query;
  } else {
    // 全量模式 - 绩效字段排序或前端高级筛选时需要全量数据
    campaignList = await db.select().from(campaigns).where(whereClause);
  }
  
  // ========== Step 6: 获取绩效数据 ==========
  // 获取时间范围内的绩效数据汇总
  const perfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`${dailyPerformance.date} >= ${startDate}`,
      sql`${dailyPerformance.date} < DATE_ADD(${endDate}, INTERVAL 1 DAY)`
    ))
    .groupBy(dailyPerformance.campaignId);
  
  // 今日数据
  const effectiveTodayDate = todayDate || endDate;
  const todayPerfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    todayImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    todayClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    todaySpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    todaySales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    todayOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`${dailyPerformance.date} >= ${effectiveTodayDate}`,
      sql`${dailyPerformance.date} < DATE_ADD(${effectiveTodayDate}, INTERVAL 1 DAY)`
    ))
    .groupBy(dailyPerformance.campaignId);
  
  // 创建绩效数据映射
  const perfMap = new Map<string, typeof perfData[0]>();
  for (const p of perfData) {
    if (p.campaignId) perfMap.set(p.campaignId, p);
  }
  const todayPerfMap = new Map<string, typeof todayPerfData[0]>();
  for (const p of todayPerfData) {
    if (p.campaignId) todayPerfMap.set(p.campaignId, p);
  }
  
  // v426: 获取当前账户相关的优化目标组（通过campaigns关联过滤，避免加载全部组）
  const accountGroupIds = [...new Set(campaignList.map((c: unknown) => c.performanceGroupId).filter(Boolean))];
  let groupMap = new Map<number, { id: number; name: string; strategyTemplateId: number | null; strategyTemplateName: string | null }>();
  if (accountGroupIds.length > 0) {
    const relevantGroups = await db.select({
      id: performanceGroups.id,
      name: performanceGroups.name,
      strategyTemplateId: performanceGroups.strategyTemplateId,
      strategyTemplateName: performanceGroups.strategyTemplateName,
    }).from(performanceGroups).where(inArray(performanceGroups.id, accountGroupIds));
    for (const g of relevantGroups) groupMap.set(g.id, g);
  }
  
  // ========== Step 7: 合并数据 ==========
  let mergedData = campaignList.map(campaign => {
    const perf = perfMap.get(campaign.campaignId);
    const impressions = perf?.totalImpressions || 0;
    const clicks = perf?.totalClicks || 0;
    const spend = parseFloat(perf?.totalSpend || '0');
    const sales = parseFloat(perf?.totalSales || '0');
    const orders = perf?.totalOrders || 0;
    const group = campaign.performanceGroupId ? groupMap.get(campaign.performanceGroupId) : null;
    const todayPerf = todayPerfMap.get(campaign.campaignId);
    const dailySpend = parseFloat(todayPerf?.todaySpend || '0');
    const dailySales = parseFloat(todayPerf?.todaySales || '0');
    const dailyImpressions = todayPerf?.todayImpressions || 0;
    const dailyClicks = todayPerf?.todayClicks || 0;
    const dailyOrders = todayPerf?.todayOrders || 0;
    
    return {
      ...campaign,
      impressions, clicks,
      spend: spend.toFixed(2),
      sales: sales.toFixed(2),
      orders,
      acos: sales > 0 ? ((spend / sales) * 100).toFixed(2) : null,
      roas: spend > 0 ? (sales / spend).toFixed(2) : null,
      ctr: impressions > 0 ? ((clicks / impressions) * 100).toFixed(4) : null,
      cvr: clicks > 0 ? ((orders / clicks) * 100).toFixed(4) : null,
      cpc: clicks > 0 ? (spend / clicks).toFixed(2) : null,
      dailySpend: dailySpend.toFixed(2),
      dailySales: dailySales.toFixed(2),
      dailyImpressions, dailyClicks, dailyOrders,
      performanceGroupName: group?.name || null,
      performanceGroupStrategyTemplate: group?.strategyTemplateName || null,
      recommendedStrategyTemplateId: campaign.recommendedStrategyTemplateId || null,
      recommendedStrategyTemplateName: campaign.recommendedStrategyTemplateName || null,
      recommendationReason: campaign.recommendationReason || null,
    };
  });
  
  // ========== Step 8: 绩效字段排序（全量模式下） ==========
  if (isPerfSort && sortField) {
    mergedData.sort((a: unknown, b: unknown) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case 'impressions': aVal = a.impressions || 0; bVal = b.impressions || 0; break;
        case 'clicks': aVal = a.clicks || 0; bVal = b.clicks || 0; break;
        case 'totalSpend': aVal = parseFloat(a.spend || '0'); bVal = parseFloat(b.spend || '0'); break;
        case 'totalSales': aVal = parseFloat(a.sales || '0'); bVal = parseFloat(b.sales || '0'); break;
        case 'acos': aVal = parseFloat(a.acos || '0'); bVal = parseFloat(b.acos || '0'); break;
        case 'roas': aVal = parseFloat(a.roas || '0'); bVal = parseFloat(b.roas || '0'); break;
        case 'ctr': aVal = parseFloat(a.ctr || '0'); bVal = parseFloat(b.ctr || '0'); break;
        case 'cvr': aVal = parseFloat(a.cvr || '0'); bVal = parseFloat(b.cvr || '0'); break;
        case 'cpc': aVal = parseFloat(a.cpc || '0'); bVal = parseFloat(b.cpc || '0'); break;
        case 'dailySpend': aVal = parseFloat(a.dailySpend || '0'); bVal = parseFloat(b.dailySpend || '0'); break;
        case 'dailySales': aVal = parseFloat(a.dailySales || '0'); bVal = parseFloat(b.dailySales || '0'); break;
        default: return 0;
      }
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }
  
  // ========== Step 9: 全量模式下的内存分页 ==========
  let resultData = mergedData;
  let resultFilteredTotal = filteredTotal;
  
  if (!serverPagination || isPerfSort) {
    // 全量模式下在内存中分页
    resultFilteredTotal = mergedData.length;
    const offset = (page - 1) * pageSize;
    resultData = mergedData.slice(offset, offset + pageSize);
  }
  
  const totalPages = Math.ceil(resultFilteredTotal / pageSize);
  
  return {
    data: resultData,
    total,
    filteredTotal: resultFilteredTotal,
    page,
    pageSize,
    totalPages,
    statusCounts,
    typeCounts,
  };
}

/**
 * @deprecated v361: 此函数不进行租户隔离，仅限系统级内部任务使用。
 * 面向用户的查询请使用 getCampaignsByAccountId(accountId) 确保数据隔离。
 */
export async function getAllCampaigns() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(campaigns);
}

export async function getCampaignsByPerformanceGroupId(performanceGroupId: number, expectedAccountId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  // v374: 多租户数据隔离增强 - 如果提供了accountId，同时验证广告活动属于该账户
  if (expectedAccountId) {
    return db.select().from(campaigns).where(
      and(
        eq(campaigns.performanceGroupId, performanceGroupId),
        eq(campaigns.accountId, expectedAccountId)
      )
    );
  }
  return db.select().from(campaigns).where(eq(campaigns.performanceGroupId, performanceGroupId));
}

// 获取未分配到绩效组的广告活动

// 获取未分配到绩效组的广告活动
export async function getUnassignedCampaigns(accountId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  if (accountId) {
    return db.select().from(campaigns).where(
      and(
        eq(campaigns.accountId, accountId),
        isNull(campaigns.performanceGroupId)
      )
    );
  }
  
  return db.select().from(campaigns).where(isNull(campaigns.performanceGroupId));
}

export async function getCampaignById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return result[0];
}

/**
 * 通过Amazon广告活动ID和账户ID查找本地广告活动记录
 * 用于AMS数据流中将Amazon campaignId映射到本地数据库ID
 */

/**
 * 通过Amazon广告活动ID和账户ID查找本地广告活动记录
 * 用于AMS数据流中将Amazon campaignId映射到本地数据库ID
 */
export async function getCampaignByAmazonId(accountId: number, amazonCampaignId: string) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignId, amazonCampaignId)
      )
    )
    .limit(1);
  return result[0];
}

/**
 * 通过Amazon广告活动ID查找本地广告活动记录（不需要accountId）
 * Amazon campaignId全局唯一，可直接查找
 */

/**
 * 通过Amazon广告活动ID查找本地广告活动记录（不需要accountId）
 * Amazon campaignId全局唯一，可直接查找
 */
export async function getCampaignByAmazonCampaignId(amazonCampaignId: string) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select()
    .from(campaigns)
    .where(eq(campaigns.campaignId, amazonCampaignId))
    .limit(1);
  return result[0];
}

export async function updateCampaign(id: number, data: Partial<InsertCampaign>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(campaigns).set(data).where(eq(campaigns.id, id));
}

export async function assignCampaignToPerformanceGroup(campaignId: number, performanceGroupId: number | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(campaigns).set({ performanceGroupId }).where(eq(campaigns.id, campaignId));
}

// 批量分配广告活动到绩效组

// 批量分配广告活动到绩效组
export async function batchAssignCampaignsToPerformanceGroup(campaignIds: number[], performanceGroupId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 批量更新广告活动的performanceGroupId和optimizationStatus
  await db.update(campaigns)
    .set({ 
      performanceGroupId,
      optimizationStatus: "managed"
    })
    .where(inArray(campaigns.id, campaignIds));
}

/** v426: 轻量级广告活动名称列表（仅返回id/name/type/status，用于下拉选择框） */
export async function getCampaignNamesOnly(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    id: campaigns.id,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    campaignType: campaigns.campaignType,
    campaignStatus: campaigns.campaignStatus,
    optimizationStatus: campaigns.optimizationStatus,
    performanceGroupId: campaigns.performanceGroupId,
  })
    .from(campaigns)
    .where(eq(campaigns.accountId, accountId));
}

/** v426: 轻量级广告活动状态统计（替代全量加载） */
export async function getCampaignStatusCounts(accountId: number) {
  const db = await getDb();
  if (!db) return { total: 0, enabled: 0, paused: 0, archived: 0, managed: 0, unmanaged: 0 };
  
  const rows = await db.select({
    campaignStatus: campaigns.campaignStatus,
    optimizationStatus: campaigns.optimizationStatus,
    cnt: sql<number>`COUNT(*)`
  })
    .from(campaigns)
    .where(eq(campaigns.accountId, accountId))
    .groupBy(campaigns.campaignStatus, campaigns.optimizationStatus);
  
  let total = 0, enabled = 0, paused = 0, archived = 0, managed = 0, unmanaged = 0;
  for (const row of rows) {
    // @ts-expect-error - runtime type mismatch
    const count = Number(row.cnt);
    total += count;
    // @ts-expect-error - runtime type mismatch
    if (row.campaignStatus === 'enabled') enabled += count;
    // @ts-expect-error - runtime type mismatch
    if (row.campaignStatus === 'paused') paused += count;
    // @ts-expect-error - runtime type mismatch
    if (row.campaignStatus === 'archived') archived += count;
    // @ts-expect-error - runtime type mismatch
    if (row.optimizationStatus === 'managed') managed += count;
    else unmanaged += count;
  }
  return { total, enabled, paused, archived, managed, unmanaged };
}

// ==================== Ad Group Functions ====================
