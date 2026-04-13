/**
 * 数据概览智能建议引擎 v501
 * 
 * 为数据概览模块提供三类智能优化建议：
 * 1. 紧急止血 (Emergency Bleeding) - 零转化高花费的搜索词/商品投放
 * 2. 高ACOS抑制 (High ACOS Suppression) - ACOS异常偏高的关键词/商品投放
 * 3. 广告活动优化目标调整 (Goal Adjustment) - 未纳入优化目标的活跃广告活动
 * 
 * 每类建议均支持一键优化执行，通过 Amazon API 同步引擎真正生效。
 */
import { eq, and, sql, gt, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import {
  campaigns,
  searchTerms,
  keywords,
  productTargets,
  performanceGroups,
  adGroups,
  negativeKeywords,
} from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('DashboardRecommendationEngine');

// ==================== 类型定义 ====================

/** 紧急止血建议项 */
export interface EmergencyBleedingItem {
  id: string;
  entityType: 'search_term' | 'product_target';
  entityId: number;          // 数据库内部ID
  amazonEntityId: string;    // Amazon API使用的ID
  entityText: string;        // 搜索词文本或ASIN
  campaignId: string;        // Amazon campaignId
  campaignName: string;
  campaignDbId: number;
  adGroupId: number;         // 内部adGroup ID
  adGroupName: string;
  spend: number;
  clicks: number;
  impressions: number;
  orders: number;
  currentBid: number;
  suggestedAction: 'add_negative_exact' | 'reduce_bid_90';
  actionLabel: string;
}

/** 高ACOS抑制建议项 */
export interface HighAcosItem {
  id: string;
  entityType: 'keyword' | 'product_target';
  entityId: number;
  amazonEntityId: string;
  entityText: string;
  matchType: string;
  campaignId: string;
  campaignName: string;
  campaignDbId: number;
  adGroupId: number;
  adGroupName: string;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
  currentBid: number;
  suggestedBid: number;
  reductionPercent: number;
  suggestedAction: 'reduce_bid';
  actionLabel: string;
}

/** 优化目标调整建议项 */
export interface GoalAdjustmentItem {
  id: string;
  campaignDbId: number;
  campaignId: string;
  campaignName: string;
  campaignType: string;
  recent7dSpend: number;
  recent7dSales: number;
  recent7dAcos: number;
  recent7dOrders: number;
  suggestedGoalName: string;
}

/** 扫描结果 */
export interface DashboardRecommendationResult {
  accountId: number;
  scanTime: string;
  emergencyBleeding: {
    items: EmergencyBleedingItem[];
    totalCount: number;
    totalWastedSpend: number;
  };
  highAcosSuppression: {
    items: HighAcosItem[];
    totalCount: number;
    totalExcessSpend: number;
  };
  goalAdjustment: {
    items: GoalAdjustmentItem[];
    totalCount: number;
    totalUnmanagedSpend: number;
  };
}

// ==================== 紧急止血扫描 ====================

async function scanEmergencyBleeding(accountId: number): Promise<DashboardRecommendationResult['emergencyBleeding']> {
  const db_ = await getDb();
  if (!db_) return { items: [], totalCount: 0, totalWastedSpend: 0 };

  const items: EmergencyBleedingItem[] = [];

  try {
    // v501.2: 先获取已添加否定关键词的搜索词列表（用于排除已处理项）
    const existingNegatives = await db_.select({
      negativeText: negativeKeywords.negativeText,
      campaignId: negativeKeywords.campaignId,
    }).from(negativeKeywords)
      .where(and(
        eq(negativeKeywords.accountId, accountId),
        eq(negativeKeywords.negativeType, 'keyword'),
        sql`${negativeKeywords.negativeStatus} != 'removed'`,
      ));
    
    // 构建已否定搜索词的Set（campaignId + negativeText 组合作为唯一键）
    const negatedSearchTermSet = new Set(
      existingNegatives.map(n => `${n.campaignId}||${n.negativeText.toLowerCase()}`)
    );
    log.info(`[紧急止血扫描] 已有 ${negatedSearchTermSet.size} 个否定关键词，将排除已处理项`);

    // v501.2: 获取已有pending/processing状态的optimization_tasks中的商品投放ID（用于排除已处理项）
    const existingBidTasks = await db_.execute(
      sql`SELECT target_entity_id FROM optimization_tasks 
          WHERE account_id = ${accountId} 
          AND task_type = 'bid_adjustment' 
          AND target_entity_type = 'product_target'
          AND action = 'adjust_bid'
          AND algorithm_used = 'dashboard_emergency_bleeding'
          AND status IN ('pending', 'processing', 'synced')`
    );
    // v501.4: 修复 db_.execute() 返回值格式 — MySQL2返回 [rows[], fields[]]，需要取 [0] 获取行数据
    const bidTaskRows = (existingBidTasks as unknown as unknown[][])[0] || [];
    const processedPtIds = new Set(
      (bidTaskRows as {target_entity_id: number}[]).map(r => r.target_entity_id)
    );
    log.info(`[紧急止血扫描] 已有 ${processedPtIds.size} 个商品投放竞价调整任务，将排除已处理项`);

    // 1. 扫描零转化高花费搜索词 (花费 > $10, 订单 = 0)
    const zeroConvSearchTerms = await db_.select({
      id: searchTerms.id,
      searchTerm: searchTerms.searchTerm,
      campaignId: searchTerms.campaignId,
      internalAdGroupId: searchTerms.internalAdGroupId,
      spend: searchTerms.searchTermSpend,
      clicks: searchTerms.searchTermClicks,
      impressions: searchTerms.searchTermImpressions,
      orders: searchTerms.searchTermOrders,
    }).from(searchTerms)
      .where(and(
        eq(searchTerms.accountId, accountId),
        sql`CAST(${searchTerms.searchTermSpend} AS DECIMAL(10,2)) > 10`,
        sql`${searchTerms.searchTermOrders} = 0`,
      ))
      .orderBy(sql`CAST(${searchTerms.searchTermSpend} AS DECIMAL(10,2)) DESC`);

    // 获取关联的广告活动和广告组信息
    for (const st of zeroConvSearchTerms) {
      // v501.2: 排除已添加否定关键词的搜索词
      const negKey = `${st.campaignId}||${st.searchTerm.toLowerCase()}`;
      if (negatedSearchTermSet.has(negKey)) {
        continue; // 跳过已处理的搜索词
      }

      const campaignInfo = await db_.select({
        id: campaigns.id,
        campaignName: campaigns.campaignName,
      }).from(campaigns)
        .where(and(
          eq(campaigns.accountId, accountId),
          eq(campaigns.campaignId, st.campaignId),
        ))
        .limit(1);

      const adGroupInfo = st.internalAdGroupId ? await db_.select({
        adGroupName: adGroups.adGroupName,
      }).from(adGroups)
        .where(eq(adGroups.id, st.internalAdGroupId))
        .limit(1) : [];

      const spend = parseFloat(String(st.spend || '0'));

      items.push({
        id: `st-${st.id}`,
        entityType: 'search_term',
        entityId: st.id,
        amazonEntityId: '',
        entityText: st.searchTerm,
        campaignId: st.campaignId,
        campaignName: campaignInfo[0]?.campaignName || '未知广告活动',
        campaignDbId: campaignInfo[0]?.id || 0,
        adGroupId: st.internalAdGroupId || 0,
        adGroupName: adGroupInfo[0]?.adGroupName || '未知广告组',
        spend,
        clicks: st.clicks || 0,
        impressions: st.impressions || 0,
        orders: 0,
        currentBid: 0,
        suggestedAction: 'add_negative_exact',
        actionLabel: `添加精准否定「${st.searchTerm}」`,
      });
    }

    // 2. 扫描零转化高花费商品投放 (花费 > $10, 订单 = 0, 状态 = enabled)
    const zeroConvTargets = await db_.select({
      id: productTargets.id,
      targetId: productTargets.targetId,
      targetValue: productTargets.targetValue,
      targetType: productTargets.targetType,
      campaignId: productTargets.campaignId,
      internalAdGroupId: productTargets.internalAdGroupId,
      bid: productTargets.bid,
      spend: productTargets.spend,
      clicks: productTargets.clicks,
      impressions: productTargets.impressions,
      orders: productTargets.orders,
    }).from(productTargets)
      .where(and(
        eq(productTargets.accountId, accountId),
        eq(productTargets.targetStatus, 'enabled'),
        sql`CAST(${productTargets.spend} AS DECIMAL(10,2)) > 10`,
        sql`${productTargets.orders} = 0`,
      ))
      .orderBy(sql`CAST(${productTargets.spend} AS DECIMAL(10,2)) DESC`);

    for (const pt of zeroConvTargets) {
      // v501.2: 排除已提交过竞价调整任务的商品投放
      if (processedPtIds.has(pt.id)) {
        continue; // 跳过已处理的商品投放
      }

      const campaignInfo = await db_.select({
        id: campaigns.id,
        campaignName: campaigns.campaignName,
      }).from(campaigns)
        .where(and(
          eq(campaigns.accountId, accountId),
          eq(campaigns.campaignId, pt.campaignId || ''),
        ))
        .limit(1);

      const adGroupInfo = pt.internalAdGroupId ? await db_.select({
        adGroupName: adGroups.adGroupName,
      }).from(adGroups)
        .where(eq(adGroups.id, pt.internalAdGroupId))
        .limit(1) : [];

      const spend = parseFloat(String(pt.spend || '0'));
      const currentBid = parseFloat(String(pt.bid || '0'));

      items.push({
        id: `pt-${pt.id}`,
        entityType: 'product_target',
        entityId: pt.id,
        amazonEntityId: pt.targetId || '',
        entityText: pt.targetValue,
        campaignId: pt.campaignId || '',
        campaignName: campaignInfo[0]?.campaignName || '未知广告活动',
        campaignDbId: campaignInfo[0]?.id || 0,
        adGroupId: pt.internalAdGroupId || 0,
        adGroupName: adGroupInfo[0]?.adGroupName || '未知广告组',
        spend,
        clicks: pt.clicks || 0,
        impressions: pt.impressions || 0,
        orders: 0,
        currentBid,
        suggestedAction: 'reduce_bid_90',
        actionLabel: `降低竞价90%（$${currentBid.toFixed(2)} → $${(currentBid * 0.1).toFixed(2)}）`,
      });
    }

    // 按花费降序排列
    items.sort((a, b) => b.spend - a.spend);
    const totalWasted = items.reduce((sum, item) => sum + item.spend, 0);

    // v501.1: 返回所有项目，不再截断，确保全选能选中所有项
    return {
      items,
      totalCount: items.length,
      totalWastedSpend: Math.round(totalWasted * 100) / 100,
    };
  } catch (error: any) {
    log.warn(`[紧急止血扫描] 失败: ${(error as Error).message}`);
    return { items: [], totalCount: 0, totalWastedSpend: 0 };
  }
}

// ==================== 高ACOS抑制扫描 ====================

async function scanHighAcos(accountId: number): Promise<DashboardRecommendationResult['highAcosSuppression']> {
  const db_ = await getDb();
  if (!db_) return { items: [], totalCount: 0, totalExcessSpend: 0 };

  const items: HighAcosItem[] = [];

  try {
    // v501.2: 获取已有pending/processing/synced状态的高ACOS抑制竞价调整任务（用于排除已处理项）
    const existingKwBidTasks = await db_.execute(
      sql`SELECT target_entity_id, target_entity_type FROM optimization_tasks 
          WHERE account_id = ${accountId} 
          AND task_type = 'bid_adjustment' 
          AND algorithm_used = 'dashboard_high_acos_suppression'
          AND status IN ('pending', 'processing', 'synced')`
    );
    const processedKwIds = new Set<number>();
    const processedPtAcosIds = new Set<number>();
    // v501.4: 修复 db_.execute() 返回值格式 — MySQL2返回 [rows[], fields[]]，需要取 [0] 获取行数据
    const taskRows = (existingKwBidTasks as unknown as unknown[][])[0] || [];
    for (const r of (taskRows as {target_entity_id: number; target_entity_type: string}[])) {
      if (r.target_entity_type === 'keyword') processedKwIds.add(r.target_entity_id);
      if (r.target_entity_type === 'product_target') processedPtAcosIds.add(r.target_entity_id);
    }
    log.info(`[高ACOS扫描] 已有 ${processedKwIds.size} 个关键词和 ${processedPtAcosIds.size} 个商品投放竞价调整任务，将排除已处理项`);

    // 1. 扫描高ACOS关键词 (ACOS > 100%, 花费 > $5, 状态 = enabled)
    const highAcosKeywords = await db_.select({
      id: keywords.id,
      keywordId: keywords.keywordId,
      keywordText: keywords.keywordText,
      matchType: keywords.matchType,
      campaignId: keywords.campaignId,
      internalAdGroupId: keywords.internalAdGroupId,
      bid: keywords.bid,
      spend: keywords.spend,
      sales: keywords.sales,
      orders: keywords.orders,
      keywordAcos: keywords.keywordAcos,
    }).from(keywords)
      .where(and(
        eq(keywords.accountId, accountId),
        eq(keywords.keywordStatus, 'enabled'),
        sql`CAST(${keywords.spend} AS DECIMAL(10,2)) > 5`,
        sql`CAST(${keywords.sales} AS DECIMAL(10,2)) > 0`,
        sql`CAST(${keywords.keywordAcos} AS DECIMAL(5,2)) > 100`,
      ))
      .orderBy(sql`CAST(${keywords.keywordAcos} AS DECIMAL(5,2)) DESC`);

    for (const kw of highAcosKeywords) {
      // v501.2: 排除已提交过竞价调整任务的关键词
      if (processedKwIds.has(kw.id)) {
        continue; // 跳过已处理的关键词
      }

      const campaignInfo = await db_.select({
        id: campaigns.id,
        campaignName: campaigns.campaignName,
      }).from(campaigns)
        .where(and(
          eq(campaigns.accountId, accountId),
          eq(campaigns.campaignId, kw.campaignId || ''),
        ))
        .limit(1);

      const adGroupInfo = kw.internalAdGroupId ? await db_.select({
        adGroupName: adGroups.adGroupName,
      }).from(adGroups)
        .where(eq(adGroups.id, kw.internalAdGroupId))
        .limit(1) : [];

      const spend = parseFloat(String(kw.spend || '0'));
      const sales = parseFloat(String(kw.sales || '0'));
      const acos = parseFloat(String(kw.keywordAcos || '0'));
      const currentBid = parseFloat(String(kw.bid || '0'));
      // v501.1: 修复currentBid=0或acos=0时产生Infinity/NaN的bug
      // 建议竞价 = 当前竞价 × (目标ACOS 30% / 当前ACOS)，最低不低于 $0.10
      const suggestedBid = (currentBid > 0 && acos > 0) 
        ? Math.max(0.10, currentBid * (30 / acos)) 
        : 0.10;
      const reductionPercent = currentBid > 0 
        ? Math.min(99, Math.max(0, Math.round((1 - suggestedBid / currentBid) * 100)))
        : 100; // currentBid=0时，建议竞价$0.10视为100%调整

      items.push({
        id: `kw-${kw.id}`,
        entityType: 'keyword',
        entityId: kw.id,
        amazonEntityId: kw.keywordId || '',
        entityText: kw.keywordText,
        matchType: kw.matchType,
        campaignId: kw.campaignId || '',
        campaignName: campaignInfo[0]?.campaignName || '未知广告活动',
        campaignDbId: campaignInfo[0]?.id || 0,
        adGroupId: kw.internalAdGroupId || 0,
        adGroupName: adGroupInfo[0]?.adGroupName || '未知广告组',
        spend,
        sales,
        orders: kw.orders || 0,
        acos,
        currentBid,
        suggestedBid: Math.round(suggestedBid * 100) / 100,
        reductionPercent,
        suggestedAction: 'reduce_bid',
        actionLabel: `降低竞价${reductionPercent}%（$${currentBid.toFixed(2)} → $${suggestedBid.toFixed(2)}）`,
      });
    }

    // 2. 扫描高ACOS商品投放 (ACOS > 100%, 花费 > $5, 状态 = enabled)
    const highAcosTargets = await db_.select({
      id: productTargets.id,
      targetId: productTargets.targetId,
      targetValue: productTargets.targetValue,
      targetType: productTargets.targetType,
      campaignId: productTargets.campaignId,
      internalAdGroupId: productTargets.internalAdGroupId,
      bid: productTargets.bid,
      spend: productTargets.spend,
      sales: productTargets.sales,
      orders: productTargets.orders,
      targetAcos: productTargets.targetAcos,
    }).from(productTargets)
      .where(and(
        eq(productTargets.accountId, accountId),
        eq(productTargets.targetStatus, 'enabled'),
        sql`CAST(${productTargets.spend} AS DECIMAL(10,2)) > 5`,
        sql`CAST(${productTargets.sales} AS DECIMAL(10,2)) > 0`,
        sql`CAST(${productTargets.targetAcos} AS DECIMAL(5,2)) > 100`,
      ))
      .orderBy(sql`CAST(${productTargets.targetAcos} AS DECIMAL(5,2)) DESC`);

    for (const pt of highAcosTargets) {
      // v501.2: 排除已提交过竞价调整任务的商品投放
      if (processedPtAcosIds.has(pt.id)) {
        continue; // 跳过已处理的商品投放
      }

      const campaignInfo = await db_.select({
        id: campaigns.id,
        campaignName: campaigns.campaignName,
      }).from(campaigns)
        .where(and(
          eq(campaigns.accountId, accountId),
          eq(campaigns.campaignId, pt.campaignId || ''),
        ))
        .limit(1);

      const adGroupInfo = pt.internalAdGroupId ? await db_.select({
        adGroupName: adGroups.adGroupName,
      }).from(adGroups)
        .where(eq(adGroups.id, pt.internalAdGroupId))
        .limit(1) : [];

      const spend = parseFloat(String(pt.spend || '0'));
      const sales = parseFloat(String(pt.sales || '0'));
      const acos = parseFloat(String(pt.targetAcos || '0'));
      const currentBid = parseFloat(String(pt.bid || '0'));
      // v501.1: 修复currentBid=0或acos=0时产生Infinity/NaN的bug
      const suggestedBid = (currentBid > 0 && acos > 0) 
        ? Math.max(0.10, currentBid * (30 / acos)) 
        : 0.10;
      const reductionPercent = currentBid > 0 
        ? Math.min(99, Math.max(0, Math.round((1 - suggestedBid / currentBid) * 100)))
        : 100; // currentBid=0时，建议竞价$0.10视为100%调整

      items.push({
        id: `pt-${pt.id}`,
        entityType: 'product_target',
        entityId: pt.id,
        amazonEntityId: pt.targetId || '',
        entityText: pt.targetValue,
        matchType: pt.targetType,
        campaignId: pt.campaignId || '',
        campaignName: campaignInfo[0]?.campaignName || '未知广告活动',
        campaignDbId: campaignInfo[0]?.id || 0,
        adGroupId: pt.internalAdGroupId || 0,
        adGroupName: adGroupInfo[0]?.adGroupName || '未知广告组',
        spend,
        sales,
        orders: pt.orders || 0,
        acos,
        currentBid,
        suggestedBid: Math.round(suggestedBid * 100) / 100,
        reductionPercent,
        suggestedAction: 'reduce_bid',
        actionLabel: `降低竞价${reductionPercent}%（$${currentBid.toFixed(2)} → $${suggestedBid.toFixed(2)}）`,
      });
    }

    // 按ACOS降序排列
    items.sort((a, b) => b.acos - a.acos);
    // 超额花费 = 花费 - 销售额 × 30%（目标ACOS）
    const totalExcess = items.reduce((sum, item) => sum + Math.max(0, item.spend - item.sales * 0.3), 0);

    // v501.1: 返回所有项目，不再截断，确保全选能选中所有项
    return {
      items,
      totalCount: items.length,
      totalExcessSpend: Math.round(totalExcess * 100) / 100,
    };
  } catch (error: any) {
    log.warn(`[高ACOS扫描] 失败: ${(error as Error).message}`);
    return { items: [], totalCount: 0, totalExcessSpend: 0 };
  }
}

// ==================== 优化目标调整扫描 ====================

async function scanGoalAdjustment(accountId: number): Promise<DashboardRecommendationResult['goalAdjustment']> {
  const db_ = await getDb();
  if (!db_) return { items: [], totalCount: 0, totalUnmanagedSpend: 0 };

  try {
    // 查找所有活跃但未分配performanceGroupId的广告活动
    const unmanagedCampaigns = await db_.select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      campaignType: campaigns.campaignType,
      performanceGroupId: campaigns.performanceGroupId,
    }).from(campaigns)
      .where(and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignStatus, 'enabled'),
        isNull(campaigns.performanceGroupId),
      ));

    if (unmanagedCampaigns.length === 0) {
      return { items: [], totalCount: 0, totalUnmanagedSpend: 0 };
    }

    // 获取近7天绩效数据
    const now = new Date();
    const endDate = new Date(now); endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - 6);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    // 使用daily_performance表获取近7天数据（如果有）
    // 如果没有daily_performance数据，使用campaigns表的累积数据作为参考
    const items: GoalAdjustmentItem[] = unmanagedCampaigns.map(c => {
      return {
        id: `camp-${c.id}`,
        campaignDbId: c.id,
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        campaignType: c.campaignType,
        recent7dSpend: 0,
        recent7dSales: 0,
        recent7dAcos: 0,
        recent7dOrders: 0,
        suggestedGoalName: '建议创建新优化目标',
      };
    });

    // 按花费降序排列
    items.sort((a, b) => b.recent7dSpend - a.recent7dSpend);
    const totalUnmanagedSpend = items.reduce((sum, item) => sum + item.recent7dSpend, 0);

    return {
      items,  // v501.1: 返回所有项目
      totalCount: items.length,
      totalUnmanagedSpend: Math.round(totalUnmanagedSpend * 100) / 100,
    };
  } catch (error: any) {
    log.warn(`[优化目标调整扫描] 失败: ${(error as Error).message}`);
    return { items: [], totalCount: 0, totalUnmanagedSpend: 0 };
  }
}

// ==================== 核心扫描入口 ====================

export async function scanDashboardRecommendations(accountId: number): Promise<DashboardRecommendationResult> {
  log.info(`[数据概览建议] 开始扫描账号 #${accountId}`);

  const [emergencyBleeding, highAcosSuppression, goalAdjustment] = await Promise.all([
    scanEmergencyBleeding(accountId),
    scanHighAcos(accountId),
    scanGoalAdjustment(accountId),
  ]);

  log.info(`[数据概览建议] 扫描完成 - 紧急止血:${emergencyBleeding.totalCount}项, 高ACOS:${highAcosSuppression.totalCount}项, 目标调整:${goalAdjustment.totalCount}项`);

  return {
    accountId,
    scanTime: new Date().toISOString(),
    emergencyBleeding,
    highAcosSuppression,
    goalAdjustment,
  };
}

// ==================== 一键优化执行 ====================

/**
 * 执行紧急止血：为搜索词添加精准否定，为商品投放降低竞价90%
 */
export async function executeEmergencyBleeding(
  accountId: number,
  itemIds: string[],
  allItems: EmergencyBleedingItem[]
): Promise<{ successCount: number; failCount: number; details: string[] }> {
  const db_ = await getDb();
  if (!db_) throw new Error('数据库连接失败');

  const selectedItems = allItems.filter(item => itemIds.includes(item.id));
  let successCount = 0;
  let failCount = 0;
  const details: string[] = [];
  const syncTasks: Record<string, unknown>[] = [];
  // v501.1: 生成统一的batchId
  const { randomUUID } = await import('crypto');
  const batchId = randomUUID();

  for (const item of selectedItems) {
    try {
      if (item.entityType === 'search_term' && item.suggestedAction === 'add_negative_exact') {
        // v501.3: 修复INSERT语法 - 使用标准Drizzle ORM写法（替代错误的 db_.insert(sql`...`) ）
        await db_.insert(negativeKeywords).values({
          accountId: accountId,
          campaignId: item.campaignId,
          internalAdGroupId: item.adGroupId,
          negativeLevel: 'campaign',
          negativeType: 'keyword',
          negativeText: item.entityText,
          negativeMatchType: 'negative_exact',
          negativeSource: 'auto_optimization',
          sourceReason: '紧急止血-零转化高花费搜索词',
          negativeStatus: 'active',
        });
        log.info(`[紧急止血] 已插入否定关键词: campaignId=${item.campaignId}, text=${item.entityText}`);

        // v501.1: 创建Amazon API同步任务（修复字段匹配）
        syncTasks.push({
          batchId,
          optimizationTargetId: 0, // 0 = 系统自动优化（非绩效组触发）
          accountId,
          taskType: 'negative_keyword',
          targetEntityType: 'campaign', // 否定关键词添加到campaign级别
          targetEntityId: item.campaignDbId, // 使用campaign的数据库内部ID
          amazonEntityId: item.campaignId, // Amazon campaignId
          targetEntityName: item.entityText,
          action: 'create_negative_exact',
          newValue: item.entityText,
          changeReason: '紧急止血-零转化高花费搜索词',
          algorithmUsed: 'dashboard_emergency_bleeding',
          priority: 0, // P0最高优先级
          campaignId: item.campaignDbId,
          campaignName: item.campaignName,
          adGroupId: item.adGroupId,
        });

        details.push(`✅ 已添加否定词「${item.entityText}」(花费$${item.spend.toFixed(2)})`);
        successCount++;
      } else if (item.entityType === 'product_target' && item.suggestedAction === 'reduce_bid_90') {
        const newBid = Math.max(0.02, item.currentBid * 0.1);

        // 更新本地数据库竞价
        await db_.update(productTargets)
          .set({ bid: String(newBid) })
          .where(eq(productTargets.id, item.entityId));

        // v501.1: 创建Amazon API同步任务（修复字段匹配）
        syncTasks.push({
          batchId,
          optimizationTargetId: 0, // 0 = 系统自动优化
          accountId,
          taskType: 'bid_adjustment', // v501.1: 修正为bid_adjustment（同步引擎通过target_entity_type区分）
          targetEntityType: 'product_target',
          targetEntityId: item.entityId,
          amazonEntityId: item.amazonEntityId,
          targetEntityName: item.entityText,
          action: 'adjust_bid',
          oldValue: String(item.currentBid),
          newValue: String(Math.round(newBid * 100) / 100),
          changeReason: '紧急止血-零转化商品投放降价90%',
          algorithmUsed: 'dashboard_emergency_bleeding',
          priority: 0,
          campaignId: item.campaignDbId,
          campaignName: item.campaignName,
          adGroupId: item.adGroupId,
        });

        details.push(`✅ 已降低「${item.entityText}」竞价90%($${item.currentBid.toFixed(2)}→$${newBid.toFixed(2)})`);
        successCount++;
      }
    } catch (error: any) {
      failCount++;
      details.push(`❌ 处理「${item.entityText}」失败: ${(error as Error).message}`);
    }
  }

  // v501.3: 入队同步任务（添加详细日志）
  if (syncTasks.length > 0) {
    try {
      log.info(`[紧急止血] 准备入队 ${syncTasks.length} 个同步任务, batchId=${batchId}`);
      const { enqueueTasks } = await import('../sync/optimizationSyncEngine');
      // @ts-expect-error Dynamic type assertion
      const resultBatchId = await enqueueTasks(syncTasks as unknown[]);
      log.info(`[紧急止血] ✅ 同步任务入队成功: batchId=${resultBatchId}, ${syncTasks.length}条任务`);
    } catch (err: any) {
      log.error(`[紧急止血] ❌ 同步任务入队失败: ${(err as Error).message}`, err);
    }
  }

  log.info(`[紧急止血] 执行完成: 成功=${successCount}, 失败=${failCount}`);
  return { successCount, failCount, details };
}

/**
 * 执行高ACOS抑制：降低关键词和商品投放的竞价
 */
export async function executeHighAcosSuppression(
  accountId: number,
  itemIds: string[],
  allItems: HighAcosItem[]
): Promise<{ successCount: number; failCount: number; details: string[] }> {
  const db_ = await getDb();
  if (!db_) throw new Error('数据库连接失败');

  const selectedItems = allItems.filter(item => itemIds.includes(item.id));
  let successCount = 0;
  let failCount = 0;
  const details: string[] = [];
  const syncTasks: Record<string, unknown>[] = [];
  // v501.1: 生成统一的batchId
  const { randomUUID } = await import('crypto');
  const batchId = randomUUID();

  for (const item of selectedItems) {
    try {
      if (item.entityType === 'keyword') {
        // 更新关键词竞价
        await db_.update(keywords)
          .set({ bid: String(item.suggestedBid) })
          .where(eq(keywords.id, item.entityId));

        // v501.1: 修复字段匹配，确保同步引擎能正确处理
        syncTasks.push({
          batchId,
          optimizationTargetId: 0, // 0 = 系统自动优化
          accountId,
          taskType: 'bid_adjustment',
          targetEntityType: 'keyword',
          targetEntityId: item.entityId,
          amazonEntityId: item.amazonEntityId,
          targetEntityName: item.entityText,
          action: 'adjust_bid',
          oldValue: String(item.currentBid),
          newValue: String(item.suggestedBid),
          changeReason: `高ACOS抑制-ACoS ${item.acos.toFixed(0)}%降价${item.reductionPercent}%`,
          algorithmUsed: 'dashboard_high_acos_suppression',
          priority: 1, // P1高优先级
          campaignId: item.campaignDbId,
          campaignName: item.campaignName,
          adGroupId: item.adGroupId,
        });

        details.push(`✅ 「${item.entityText}」竞价降${item.reductionPercent}%($${item.currentBid.toFixed(2)}→$${item.suggestedBid.toFixed(2)}, ACoS:${item.acos.toFixed(0)}%)`);
        successCount++;
      } else if (item.entityType === 'product_target') {
        // 更新商品投放竞价
        await db_.update(productTargets)
          .set({ bid: String(item.suggestedBid) })
          .where(eq(productTargets.id, item.entityId));

        // v501.1: 修复字段匹配，taskType统一为bid_adjustment
        syncTasks.push({
          batchId,
          optimizationTargetId: 0, // 0 = 系统自动优化
          accountId,
          taskType: 'bid_adjustment', // v501.1: 修正为bid_adjustment（同步引擎通过target_entity_type区分）
          targetEntityType: 'product_target',
          targetEntityId: item.entityId,
          amazonEntityId: item.amazonEntityId,
          targetEntityName: item.entityText,
          action: 'adjust_bid',
          oldValue: String(item.currentBid),
          newValue: String(item.suggestedBid),
          changeReason: `高ACOS抑制-ACoS ${item.acos.toFixed(0)}%降价${item.reductionPercent}%`,
          algorithmUsed: 'dashboard_high_acos_suppression',
          priority: 1,
          campaignId: item.campaignDbId,
          campaignName: item.campaignName,
          adGroupId: item.adGroupId,
        });

        details.push(`✅ 「${item.entityText}」竞价降${item.reductionPercent}%($${item.currentBid.toFixed(2)}→$${item.suggestedBid.toFixed(2)}, ACoS:${item.acos.toFixed(0)}%)`);
        successCount++;
      }
    } catch (error: any) {
      failCount++;
      details.push(`❌ 处理「${item.entityText}」失败: ${(error as Error).message}`);
    }
  }

  // v501.3: 入队同步任务（添加详细日志）
  if (syncTasks.length > 0) {
    try {
      log.info(`[高ACOS抑制] 准备入队 ${syncTasks.length} 个同步任务, batchId=${batchId}`);
      // @ts-expect-error Async operation type inference
      const { enqueueTasks } = await import('../sync/optimizationSyncEngine');
      // @ts-expect-error Dynamic type assertion
      const resultBatchId = await enqueueTasks(syncTasks as unknown[]);
      log.info(`[高ACOS抑制] ✅ 同步任务入队成功: batchId=${resultBatchId}, ${syncTasks.length}条任务`);
    } catch (err: any) {
      log.error(`[高ACOS抑制] ❌ 同步任务入队失败: ${(err as Error).message}`, err);
    }
  }

  log.info(`[高ACOS抑制] 执行完成: 成功=${successCount}, 失败=${failCount}`);
  return { successCount, failCount, details };
}

/**
 * 执行优化目标调整：将广告活动分配到指定的绩效组
 */
export async function executeGoalAdjustment(
  accountId: number,
  campaignDbIds: number[],
  performanceGroupId: number
): Promise<{ successCount: number; failCount: number; details: string[] }> {
  const db_ = await getDb();
  if (!db_) throw new Error('数据库连接失败');

  let successCount = 0;
  let failCount = 0;
  const details: string[] = [];

  // 验证绩效组存在
  const pgInfo = await db_.select({
    id: performanceGroups.id,
    name: performanceGroups.name,
  }).from(performanceGroups)
    .where(eq(performanceGroups.id, performanceGroupId))
    .limit(1);

  if (pgInfo.length === 0) {
    throw new Error(`绩效组 #${performanceGroupId} 不存在`);
  }

  for (const campDbId of campaignDbIds) {
    try {
      await db_.update(campaigns)
        .set({ performanceGroupId })
        .where(and(
          eq(campaigns.id, campDbId),
          eq(campaigns.accountId, accountId),
        ));

      const campInfo = await db_.select({ campaignName: campaigns.campaignName })
        .from(campaigns)
        .where(eq(campaigns.id, campDbId))
        .limit(1);

      details.push(`✅ 「${campInfo[0]?.campaignName || `#${campDbId}`}」已分配到「${pgInfo[0].name}」`);
      successCount++;
    } catch (error: any) {
      failCount++;
      details.push(`❌ 分配广告活动 #${campDbId} 失败: ${(error as Error).message}`);
    }
  }

  return { successCount, failCount, details };
}
