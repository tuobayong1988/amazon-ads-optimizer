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
  
  // 获取时间范围内的绩效数据汇总
  // ✅ 只汇总campaign级别的记录，排除账户级汇总记录
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
      sql`DATE(${dailyPerformance.date}) >= ${startDate}`,
      sql`DATE(${dailyPerformance.date}) <= ${endDate}`
    ))
    .groupBy(dailyPerformance.campaignId);
  
  // v122h: 单独查询今日数据（站点本地时间的今天）
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
      sql`DATE(${dailyPerformance.date}) = ${effectiveTodayDate}`
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
  
  // 获取所有优化目标组名称用于关联展示
  const allGroups = await db.select({
    id: performanceGroups.id,
    name: performanceGroups.name,
    strategyTemplateId: performanceGroups.strategyTemplateId,
    strategyTemplateName: performanceGroups.strategyTemplateName,
  }).from(performanceGroups);
  const groupMap = new Map<number, typeof allGroups[0]>();
  for (const g of allGroups) {
    groupMap.set(g.id, g);
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
 * @deprecated v361: 此函数不进行租户隔离，仅限系统级内部任务使用。
 * 面向用户的查询请使用 getCampaignsByAccountId(accountId) 确保数据隔离。
 */

/**
 * @deprecated v361: 此函数不进行租户隔离，仅限系统级内部任务使用。
 * 面向用户的查询请使用 getCampaignsByAccountId(accountId) 确保数据隔离。
 */
export async function getAllCampaigns() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(campaigns);
}

export async function getCampaignsByPerformanceGroupId(performanceGroupId: number) {
  const db = await getDb();
  if (!db) return [];
  
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

// ==================== Ad Group Functions ====================
