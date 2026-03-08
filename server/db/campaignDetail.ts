/**
 * v361: 广告活动详情
 * 从db.ts拆分的子模块
 */

import { eq, sql } from 'drizzle-orm';
import { Campaign, Keyword, ProductTarget, adGroups, campaigns, keywords, productTargets, searchTerms } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== Campaign Detail Functions ====================
export async function getCampaignDetailWithStats(campaignId: number) {
  const db = await getDb();
  if (!db) return null;
  
  // 获取广告活动基本信息
  const campaign = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign[0]) return null;
  
  // 获取广告组列表
  const adGroupList = await db.select().from(adGroups).where(eq(adGroups.campaignId, String(campaignId)));
  
  // 获取广告组ID列表
  const adGroupIds = adGroupList.map(ag => ag.id);
  
  // 获取所有关键词
  let keywordList: Keyword[] = [];
  if (adGroupIds.length > 0) {
    keywordList = await db.select().from(keywords)
      .where(sql`${keywords.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  }
  
  // 获取所有商品定向
  let productTargetList: ProductTarget[] = [];
  if (adGroupIds.length > 0) {
    productTargetList = await db.select().from(productTargets)
      .where(sql`${productTargets.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  }
  
  // 获取搜索词报告
  const searchTermList = await db.select().from(searchTerms).where(eq(searchTerms.campaignId, String(campaignId)));
  
  return {
    campaign: campaign[0],
    adGroups: adGroupList,
    keywords: keywordList,
    productTargets: productTargetList,
    searchTerms: searchTermList,
  };
}

// 获取广告活动的广告位表现数据

// 获取广告活动的广告位表现数据
export async function getCampaignPlacementStats(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const campaign = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign[0]) return [];
  
  // 返回广告位数据（从campaigns表的placement字段获取）
  const placementData = [
    {
      placement: "top_of_search",
      placementLabel: "搜索结果顶部",
      bidAdjustment: campaign[0].placementTopSearchBidAdjustment || 0,
      // 模拟数据，实际应从daily_performance或专门的placement表获取
      impressions: Math.floor((campaign[0].impressions || 0) * 0.3),
      clicks: Math.floor((campaign[0].clicks || 0) * 0.35),
      spend: parseFloat(campaign[0].spend || "0") * 0.35,
      sales: parseFloat(campaign[0].sales || "0") * 0.4,
      orders: Math.floor((campaign[0].orders || 0) * 0.4),
    },
    {
      placement: "product_page",
      placementLabel: "商品页面",
      bidAdjustment: campaign[0].placementProductPageBidAdjustment || 0,
      impressions: Math.floor((campaign[0].impressions || 0) * 0.5),
      clicks: Math.floor((campaign[0].clicks || 0) * 0.45),
      spend: parseFloat(campaign[0].spend || "0") * 0.45,
      sales: parseFloat(campaign[0].sales || "0") * 0.4,
      orders: Math.floor((campaign[0].orders || 0) * 0.4),
    },
    {
      placement: "rest_of_search",
      placementLabel: "搜索结果其他位置",
      bidAdjustment: campaign[0].placementRestBidAdjustment || 0,
      impressions: Math.floor((campaign[0].impressions || 0) * 0.2),
      clicks: Math.floor((campaign[0].clicks || 0) * 0.2),
      spend: parseFloat(campaign[0].spend || "0") * 0.2,
      sales: parseFloat(campaign[0].sales || "0") * 0.2,
      orders: Math.floor((campaign[0].orders || 0) * 0.2),
    },
  ];
  
  return placementData;
}

// 获取广告活动下所有投放词（关键词+商品定向）

// 获取广告活动下所有投放词（关键词+商品定向）
export async function getCampaignTargets(campaignId: number) {
  const db = await getDb();
  if (!db) return { keywords: [], productTargets: [] };
  
  // 获取广告组ID列表
  const adGroupList = await db.select({ id: adGroups.id, adGroupName: adGroups.adGroupName })
    .from(adGroups)
    .where(eq(adGroups.campaignId, String(campaignId)));
  
  if (adGroupList.length === 0) {
    return { keywords: [], productTargets: [] };
  }
  
  const adGroupIds = adGroupList.map(ag => ag.id);
  const adGroupMap = new Map(adGroupList.map(ag => [ag.id, ag.adGroupName]));
  
  // 获取所有关键词
  const keywordList = await db.select().from(keywords)
    .where(sql`${keywords.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  
  // 获取所有商品定向
  const productTargetList = await db.select().from(productTargets)
    .where(sql`${productTargets.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  
  // v357: adGroupId现在是string类型，需要转换为number才能匹配map key
  const keywordsWithAdGroup = keywordList.map(k => ({
    ...k,
    adGroupName: adGroupMap.get(Number(k.adGroupId)) || "未知广告组"
  }));
  
  const productTargetsWithAdGroup = productTargetList.map(pt => ({
    ...pt,
    adGroupName: adGroupMap.get(Number(pt.adGroupId)) || "未知广告组"
  }));
  
  return {
    keywords: keywordsWithAdGroup,
    productTargets: productTargetsWithAdGroup
  };
}


// ==================== AI Optimization Execution Functions ====================

// 创建AI优化执行记录
