/**
 * v381: 广告活动详情 - 修复致命ID混淆bug
 * 所有函数现在接受Amazon campaignId（字符串）作为参数
 */

import { eq, sql } from 'drizzle-orm';
import { Campaign, Keyword, ProductTarget, adGroups, campaigns, keywords, productTargets, searchTerms, placementPerformance, negativeKeywords } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== Campaign Detail Functions ====================

/**
 * v381: 获取广告活动详情（包含广告组、关键词、搜索词等）
 * @param amazonCampaignId - Amazon广告活动ID（字符串）
 */
export async function getCampaignDetailWithStats(amazonCampaignId: string) {
  const db = await getDb();
  if (!db) return null;
  
  // v381: 使用Amazon campaignId查询
  const campaign = await db.select().from(campaigns)
    .where(eq(campaigns.campaignId, amazonCampaignId)).limit(1);
  if (!campaign[0]) return null;
  
  // 使用Amazon campaignId查询广告组
  const adGroupList = await db.select().from(adGroups)
    .where(eq(adGroups.campaignId, amazonCampaignId));
  
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
  const searchTermList = await db.select().from(searchTerms)
    .where(eq(searchTerms.campaignId, amazonCampaignId));
  
  return {
    campaign: campaign[0],
    adGroups: adGroupList,
    keywords: keywordList,
    productTargets: productTargetList,
    searchTerms: searchTermList,
  };
}

/**
 * v381: 获取广告活动的广告位表现数据 - 使用placement_performance表的真实数据
 * @param amazonCampaignId - Amazon广告活动ID（字符串）
 */
export async function getCampaignPlacementStats(amazonCampaignId: string) {
  const db = await getDb();
  if (!db) return [];
  
  // v381: 从placement_performance表获取真实的广告位数据
  try {
    const placementData = await db.select().from(placementPerformance)
      .where(eq(placementPerformance.campaignId, amazonCampaignId));
    
    if (placementData.length > 0) {
      // 按placement类型聚合数据
      const placementMap = new Map<string, {
        placement: string;
        placementLabel: string;
        bidAdjustment: number;
        impressions: number;
        clicks: number;
        spend: number;
        sales: number;
        orders: number;
      }>();
      
      const labelMap: Record<string, string> = {
        'top_of_search': '搜索结果顶部',
        'product_page': '商品页面',
        'rest_of_search': '搜索结果其他位置',
        'top': '搜索结果顶部',
        'detail_page': '商品页面',
        'other': '搜索结果其他位置',
      };
      
      for (const p of placementData) {
        const key = p.placement || 'other';
        const existing = placementMap.get(key);
        if (existing) {
          existing.impressions += p.impressions || 0;
          existing.clicks += p.clicks || 0;
          existing.spend += parseFloat(String(p.spend || '0'));
          existing.sales += parseFloat(String(p.sales || '0'));
          existing.orders += p.orders || 0;
        } else {
          placementMap.set(key, {
            placement: key,
            placementLabel: labelMap[key] || key,
            bidAdjustment: 0,
            impressions: p.impressions || 0,
            clicks: p.clicks || 0,
            spend: parseFloat(String(p.spend || '0')),
            sales: parseFloat(String(p.sales || '0')),
            orders: p.orders || 0,
          });
        }
      }
      
      // 获取campaign的bid adjustment设置
      const campaign = await db.select().from(campaigns)
        .where(eq(campaigns.campaignId, amazonCampaignId)).limit(1);
      if (campaign[0]) {
        for (const [key, data] of placementMap) {
          if (key === 'top_of_search' || key === 'top') {
            data.bidAdjustment = campaign[0].placementTopSearchBidAdjustment || 0;
          } else if (key === 'product_page' || key === 'detail_page') {
            data.bidAdjustment = campaign[0].placementProductPageBidAdjustment || 0;
          } else {
            data.bidAdjustment = campaign[0].placementRestBidAdjustment || 0;
          }
        }
      }
      
      return Array.from(placementMap.values());
    }
  } catch (e) {
    // placement_performance表查询失败时回退到campaign级别数据
  }
  
  // 回退：如果placement_performance表没有数据，使用campaign级别数据
  const campaign = await db.select().from(campaigns)
    .where(eq(campaigns.campaignId, amazonCampaignId)).limit(1);
  if (!campaign[0]) return [];
  
  return [
    {
      placement: "top_of_search",
      placementLabel: "搜索结果顶部",
      bidAdjustment: campaign[0].placementTopSearchBidAdjustment || 0,
      impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0,
    },
    {
      placement: "product_page",
      placementLabel: "商品页面",
      bidAdjustment: campaign[0].placementProductPageBidAdjustment || 0,
      impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0,
    },
    {
      placement: "rest_of_search",
      placementLabel: "搜索结果其他位置",
      bidAdjustment: campaign[0].placementRestBidAdjustment || 0,
      impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0,
    },
  ];
}

/**
 * v381: 获取广告活动下所有投放词（关键词+商品定向）
 * @param amazonCampaignId - Amazon广告活动ID（字符串）
 */
export async function getCampaignTargets(amazonCampaignId: string) {
  const db = await getDb();
  if (!db) return { keywords: [], productTargets: [] };
  
  // 获取广告组ID列表
  const adGroupList = await db.select({ id: adGroups.id, adGroupName: adGroups.adGroupName })
    .from(adGroups)
    .where(eq(adGroups.campaignId, amazonCampaignId));
  
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
  
  // adGroupId现在是string类型，需要转换为number才能匹配map key
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
