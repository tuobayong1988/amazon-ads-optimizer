/**
 * 商品定位同步模块 v474_MARKER_XYZZY
 * 从 amazonSyncService.ts 拆分的独立模块
 */
import { eq, and, sql, gte, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import {
  campaigns,
  adGroups,
  keywords,
  productTargets,
  dailyPerformance,
  hourlyPerformance,
  biddingLogs,
  placementPerformance,
  searchTerms,
  negativeKeywords,
  optimizationEvents,
} from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';
import type { AmazonAdsApiClient } from './amazonAdsApi';
import { forwardAlign, markEntitiesVerified, nextSyncVersion } from './entityStateAlignment';

/** 同步服务上下文 - 从AmazonSyncService传入 */
export interface SyncContext {
  client: AmazonAdsApiClient;
  accountId: number;
  userId: number;
  marketplace: string;
}

const log = createModuleLogger('productTargetSync');
const _v474_BUILD_MARKER = 'v474_XYZZY_BUILD_CHECK';

/**
 * 同步SB商品定位
 * 从Amazon SB API获取商品定位列表并同步到本地数据库
 */
export async function syncSbProductTargets(service: SyncContext,): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiTargets = await service.client.listSbTargets();
    let synced = 0;
    let skipped = 0;

    log.debug(`获取到 ${apiTargets.length} 个SB商品定位`);

    // v681: 批量预加载 — 消除N+1查询问题
    const allAdGroups = await db.select().from(adGroups);
    const adGroupByAmazonId = new Map<string, typeof allAdGroups[0]>();
    for (const ag of allAdGroups) {
      if (ag.adGroupId) adGroupByAmazonId.set(String(ag.adGroupId), ag);
    }
    const allTargets = await db.select().from(productTargets);
    const ptByAgIdAndTargetId = new Map<string, typeof allTargets[0]>();
    for (const pt of allTargets) {
      if (pt.internalAdGroupId && pt.targetId) {
        ptByAgIdAndTargetId.set(`${pt.internalAdGroupId}_${pt.targetId}`, pt);
      }
    }
    log.info(`v681: SB商品定位批量预加载完成 — ${allAdGroups.length}个广告组, ${allTargets.length}个产品定向, API返回${apiTargets.length}个`);

    for (const apiTarget of apiTargets) {
      // v681: 使用Map查找替代DB查询
      const adGroup = adGroupByAmazonId.get(String(apiTarget.adGroupId));
      if (!adGroup) continue;

      // 解析定向表达式和匹配类型 - 支持ASIN定向和品类定向
      let targetType: 'asin' | 'category' = 'category';
      let targetValue = '';
      let targetExpression = '';
      let targetMatchType: 'exact' | 'expanded' | 'category_exact' | 'brand_exact' | 'substitute' | 'accessory' | 'loose' | 'close' = 'exact';
      let categoryName: string | null = null;
      let categoryRefinements: string | null = null;
      const refinements: Record<string, unknown> = {};

      const exprArray = apiTarget.expression || apiTarget.expressions || [];
      if (Array.isArray(exprArray) && exprArray.length > 0) {
        targetExpression = JSON.stringify(exprArray);
        
        for (const expr of exprArray) {
          const et = (expr.type || '').toLowerCase();
          
          if (et.includes('categorysame') || et.includes('category')) {
            targetType = 'category';
            targetValue = expr.value || '';
            targetMatchType = 'category_exact';
          } else if (et.includes('brandsame')) {
            targetType = 'category';
            targetValue = expr.value || '';
            targetMatchType = 'brand_exact';
          } else if (et.includes('pricebetween') || et.includes('price')) {
            refinements.priceRange = expr.value;
          } else if (et.includes('reviewrating') || et.includes('star') || et.includes('rating')) {
            refinements.starRating = expr.value;
          } else if (et.includes('expanded') || et.includes('expandedfrom')) {
            targetType = 'asin';
            targetValue = expr.value || '';
            targetMatchType = 'expanded';
          } else if (et.includes('substitute')) {
            targetType = 'asin';
            targetValue = expr.value || 'AUTO_SUBSTITUTES';
            targetMatchType = 'substitute';
          } else if (et.includes('accessory') || et.includes('complement')) {
            targetType = 'asin';
            targetValue = expr.value || 'AUTO_COMPLEMENTS';
            targetMatchType = 'accessory';
          } else if (et.includes('asin') && et.includes('same')) {
            targetType = 'asin';
            targetValue = expr.value || '';
            targetMatchType = 'exact';
          } else if (et.includes('broadrel') || et.includes('loose')) {
            targetValue = expr.value || 'AUTO_LOOSE';
            targetMatchType = 'loose';
          } else if (et.includes('highrel') || et.includes('close')) {
            targetValue = expr.value || 'AUTO_CLOSE';
            targetMatchType = 'close';
          } else if (expr.value && !targetValue) {
            targetValue = expr.value;
          }
        }
        
        if (Object.keys(refinements).length > 0) {
          categoryRefinements = JSON.stringify(refinements);
        }
      } else if (typeof exprArray === 'string') {
        targetExpression = exprArray;
      }

      // v681: 使用Map查找existing target
      const existing = ptByAgIdAndTargetId.get(`${adGroup.id}_${String(apiTarget.targetId)}`);

      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

       const targetData = {
        accountId: service.accountId,  // v311: 添加缺失的accountId
        internalAdGroupId: adGroup.id,
        campaignId: adGroup.campaignId,
        targetId: String(apiTarget.targetId),
        targetType,
        targetValue,
        targetExpression,
        targetMatchType,
        bid: String(typeof apiTarget.bid === 'object' && apiTarget.bid !== null ? (apiTarget.bid as Record<string, unknown>).amount || 0 : (apiTarget.bid || 0)),
        targetStatus: normalizedState,
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (synced === 0) {
        log.debug(`SB产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
      }

      if (existing) {
        // v523.2: 保护 amazon_deleted 状态不被同步覆盖
        if (existing.targetStatus === 'amazon_deleted' && normalizedState !== 'archived') {
          log.debug(`v523.2: 保护SB target amazon_deleted状态 - target=${existing.targetValue}(id=${existing.id})`);
          delete (targetData as Record<string, unknown>).targetStatus;
        }
        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
      } else {
        await db.insert(productTargets).values({
          ...targetData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SB商品定位同步完成: synced=${synced}, skipped=${skipped}`);

    // v525: 正向对齐 - SB商品定位
    try {
      const syncVer = nextSyncVersion();
      const amazonTargetIds = apiTargets.map((t: any) => String(t.targetId)).filter(Boolean);
      markEntitiesVerified('product_target', apiTargets.map((t: any) => Number(t.targetId)).filter(Boolean), syncVer);
      await forwardAlign(service.accountId, 'product_target', amazonTargetIds);
    } catch (alignErr: unknown) {
      log.debug(`[v525] SB商品定位正向对齐失败: ${(alignErr as Error).message}`);
    }

    return { synced, skipped };
  } catch (error) {
    log.warn('Error syncing SB product targets:', error);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步SD商品定位（从List API）
 * 从Amazon SD API获取商品定位列表并同步到本地数据库
 */
export async function syncSdProductTargets(service: SyncContext,): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiTargets = await service.client.listSdTargets();
    let synced = 0;
    let skipped = 0;

    log.debug(`获取到 ${apiTargets.length} 个SD商品定位`);

    // v681: 批量预加载 — 消除N+1查询问题
    const allAdGroups = await db.select().from(adGroups);
    const adGroupByAmazonId = new Map<string, typeof allAdGroups[0]>();
    for (const ag of allAdGroups) {
      if (ag.adGroupId) adGroupByAmazonId.set(String(ag.adGroupId), ag);
    }
    const allTargets = await db.select().from(productTargets);
    const ptByAgIdAndTargetId = new Map<string, typeof allTargets[0]>();
    for (const pt of allTargets) {
      if (pt.internalAdGroupId && pt.targetId) {
        ptByAgIdAndTargetId.set(`${pt.internalAdGroupId}_${pt.targetId}`, pt);
      }
    }
    log.info(`v681: SD商品定位批量预加载完成 — ${allAdGroups.length}个广告组, ${allTargets.length}个产品定向, API返回${apiTargets.length}个`);

    for (const apiTarget of apiTargets) {
      // v681: 使用Map查找替代DB查询
      const adGroup = adGroupByAmazonId.get(String(apiTarget.adGroupId));
      if (!adGroup) continue;

      // 解析定向表达式和匹配类型 - 支持ASIN定向和品类定向
      let targetType: 'asin' | 'category' = 'category';
      let targetValue = '';
      let targetExpression = '';
      let targetMatchType: 'exact' | 'expanded' | 'category_exact' | 'brand_exact' | 'substitute' | 'accessory' | 'loose' | 'close' = 'exact';
      let categoryName: string | null = null;
      let categoryRefinements: string | null = null;
      const refinements: Record<string, unknown> = {};

      const exprArray = apiTarget.expression || [];
      if (Array.isArray(exprArray) && exprArray.length > 0) {
        targetExpression = JSON.stringify(exprArray);
        
        for (const expr of exprArray) {
          const et = (expr.type || '').toLowerCase();
          
          if (et.includes('categorysame') || et.includes('category')) {
            targetType = 'category';
            targetValue = expr.value || '';
            targetMatchType = 'category_exact';
          } else if (et.includes('brandsame')) {
            targetType = 'category';
            targetValue = expr.value || '';
            targetMatchType = 'brand_exact';
          } else if (et.includes('pricebetween') || et.includes('price')) {
            refinements.priceRange = expr.value;
          } else if (et.includes('reviewrating') || et.includes('star') || et.includes('rating')) {
            refinements.starRating = expr.value;
          } else if (et.includes('expanded') || et.includes('expandedfrom')) {
            targetType = 'asin';
            targetValue = expr.value || '';
            targetMatchType = 'expanded';
          } else if (et.includes('substitute')) {
            targetType = 'asin';
            targetValue = expr.value || 'AUTO_SUBSTITUTES';
            targetMatchType = 'substitute';
          } else if (et.includes('accessory') || et.includes('complement')) {
            targetType = 'asin';
            targetValue = expr.value || 'AUTO_COMPLEMENTS';
            targetMatchType = 'accessory';
          } else if (et.includes('asin') && et.includes('same')) {
            targetType = 'asin';
            targetValue = expr.value || '';
            targetMatchType = 'exact';
          } else if (et.includes('broadrel') || et.includes('loose')) {
            targetValue = expr.value || 'AUTO_LOOSE';
            targetMatchType = 'loose';
          } else if (et.includes('highrel') || et.includes('close')) {
            targetValue = expr.value || 'AUTO_CLOSE';
            targetMatchType = 'close';
          } else if (expr.value && !targetValue) {
            targetValue = expr.value;
          }
        }
        
        if (Object.keys(refinements).length > 0) {
          categoryRefinements = JSON.stringify(refinements);
        }
      } else if (apiTarget.expressionType) {
        targetExpression = apiTarget.expressionType;
        if (apiTarget.expressionType === 'auto') {
          targetValue = 'AUTO';
          targetMatchType = 'loose';
        }
      }

      // v681: 使用Map查找existing target
      const existing = ptByAgIdAndTargetId.get(`${adGroup.id}_${String(apiTarget.targetId)}`);

      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const targetData = {
        accountId: service.accountId,  // v311: 添加缺失的accountId
        internalAdGroupId: adGroup.id,
        campaignId: adGroup.campaignId,
        targetId: String(apiTarget.targetId),
        targetType,
        targetValue,
        targetExpression,
        targetMatchType,
        bid: String(typeof apiTarget.bid === 'object' && apiTarget.bid !== null ? (apiTarget.bid as Record<string, unknown>).amount || 0 : (apiTarget.bid || 0)),
        targetStatus: normalizedState,
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (synced === 0) {
        log.debug(`SD产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}, bid=${JSON.stringify(apiTarget.bid)}`);
      }

      if (existing) {
        // v523.2: 保护 amazon_deleted 状态不被同步覆盖
        if (existing.targetStatus === 'amazon_deleted' && normalizedState !== 'archived') {
          log.debug(`v523.2: 保护SD target amazon_deleted状态 - target=${existing.targetValue}(id=${existing.id})`);
          delete (targetData as Record<string, unknown>).targetStatus;
        }
        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
      } else {
        await db.insert(productTargets).values({
          ...targetData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SD商品定位同步完成: synced=${synced}, skipped=${skipped}`);

    // v525: 正向对齐 - SD商品定位
    try {
      const syncVer = nextSyncVersion();
      const amazonTargetIds = apiTargets.map((t: any) => String(t.targetId)).filter(Boolean);
      markEntitiesVerified('product_target', apiTargets.map((t: any) => Number(t.targetId)).filter(Boolean), syncVer);
      await forwardAlign(service.accountId, 'product_target', amazonTargetIds);
    } catch (alignErr: unknown) {
      log.debug(`[v525] SD商品定位正向对齐失败: ${(alignErr as Error).message}`);
    }

    return { synced, skipped };
  } catch (error) {
    log.warn('Error syncing SD product targets:', error);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步SP否定商品定向
 * 从Amazon API获取否定商品定向并同步到本地negativeKeywords表
 */
export async function syncSpNegativeProductTargets(service: SyncContext,): Promise<{ synced: number; updated: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, updated: 0 };
  try {
    let synced = 0;
    let updated = 0;
    // 1. 同步活动级别否定商品定向
    log.info(`开始同步SP活动级别否定商品定向...`);
    const campaignNegTargets = await service.client.listSpCampaignNegativeTargets();
    log.debug(`获取到 ${campaignNegTargets.length} 个活动级别否定商品定向`);
    for (const neg of campaignNegTargets) {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, service.accountId),
            eq(campaigns.campaignId, String(neg.campaignId))
          )
        )
        .limit(1);
      if (!campaign) continue;
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      const expression = neg.expression || [];
      const asinExpr = expression.find((e: Record<string, unknown>) => e.type?.toLowerCase().includes('asin'));
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            eq(negativeKeywords.accountId, service.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.negativeLevel, 'campaign'),
            eq(negativeKeywords.negativeType, 'product'),
            eq(negativeKeywords.negativeText, negativeText)
          )
        )
        .limit(1);
      if (existing) {
        await db.update(negativeKeywords)
          .set({ amazonNegativeKeywordId: amazonTargetId || null, negativeStatus: 'active' as const })
          .where(eq(negativeKeywords.id, existing.id));
        updated++;
      } else {
        await db.insert(negativeKeywords).values({
          accountId: service.accountId,
          campaignId: String(campaign.campaignId),
          negativeLevel: 'campaign',
          negativeType: 'product',
          negativeText: negativeText,
          negativeMatchType: 'negative_exact',
          amazonNegativeKeywordId: amazonTargetId || null,
          negativeSource: 'manual',
          negativeStatus: 'active',
        });
        synced++;
      }
    }
    // 2. 同步广告组级别否定商品定向
    log.info(`开始同步SP广告组级别否定商品定向...`);
    const adGroupNegTargets = await service.client.listSpNegativeTargets();
    log.debug(`获取到 ${adGroupNegTargets.length} 个广告组级别否定商品定向`);
    for (const neg of adGroupNegTargets) {
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(neg.adGroupId)))
        .limit(1);
      if (!adGroup) continue;
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.campaignId, adGroup.campaignId))
        .limit(1);
      if (!campaign) continue;
      const expression = neg.expression || [];
      const asinExpr = expression.find((e: Record<string, unknown>) => e.type?.toLowerCase().includes('asin'));
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            eq(negativeKeywords.accountId, service.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.internalAdGroupId, adGroup.id),
            eq(negativeKeywords.negativeLevel, 'ad_group'),
            eq(negativeKeywords.negativeType, 'product'),
            eq(negativeKeywords.negativeText, negativeText)
          )
        )
        .limit(1);
      if (existing) {
        await db.update(negativeKeywords)
          .set({ amazonNegativeKeywordId: amazonTargetId || null, negativeStatus: 'active' as const })
          .where(eq(negativeKeywords.id, existing.id));
        updated++;
      } else {
        await db.insert(negativeKeywords).values({
          accountId: service.accountId,
          campaignId: String(campaign.campaignId),
          internalAdGroupId: adGroup.id,
          negativeLevel: 'ad_group',
          negativeType: 'product',
          negativeText: negativeText,
          negativeMatchType: 'negative_exact',
          amazonNegativeKeywordId: amazonTargetId || null,
          negativeSource: 'manual',
          negativeStatus: 'active',
        });
        synced++;
      }
    }
    log.info(`SP否定商品定向同步完成: ${synced} 条新记录, ${updated} 条更新`);
    return { synced, updated };
  } catch (error) {
    log.warn('Error syncing SP negative product targets:', error);
    return { synced: 0, updated: 0 };
  }
}


/**
 * 同步SP商品定位
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
export async function syncSpProductTargets(service: SyncContext,lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiTargets = await service.client.listSpProductTargets();
    let synced = 0;
    let skipped = 0;

    // v681: 批量预加载 — 消除N+1查询问题
    // 1. 预加载所有adGroups的 adGroupId -> record 映射
    const allAdGroups = await db.select().from(adGroups);
    const adGroupByAmazonId = new Map<string, typeof allAdGroups[0]>();
    for (const ag of allAdGroups) {
      if (ag.adGroupId) adGroupByAmazonId.set(String(ag.adGroupId), ag);
    }
    // 2. 预加载所有productTargets，建立索引
    const allTargets = await db.select().from(productTargets);
    const ptByAgIdAndTargetId = new Map<string, typeof allTargets[0]>();
    for (const pt of allTargets) {
      if (pt.internalAdGroupId && pt.targetId) {
        ptByAgIdAndTargetId.set(`${pt.internalAdGroupId}_${pt.targetId}`, pt);
      }
    }
    log.info(`v681: SP产品定向批量预加载完成 — ${allAdGroups.length}个广告组, ${allTargets.length}个产品定向, API返回${apiTargets.length}个`);

    // v150.1: 使用预加载的Map批量收集existing target IDs（不再逐条DB查询）
    const allExistingTargetIds: number[] = [];
    for (const at of apiTargets) {
      const ag = adGroupByAmazonId.get(String(at.adGroupId));
      if (!ag) continue;
      const ex = ptByAgIdAndTargetId.get(`${ag.id}_${String(at.targetId)}`);
      if (ex) allExistingTargetIds.push(ex.id);
    }
    const protectedTargetIds = await getRecentlyOptimizedKeywordIds(allExistingTargetIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpProductTargets: 批量查询完成, ${protectedTargetIds.size}个产品定向有近期出价优化事件`);

    for (const apiTarget of apiTargets) {
      // v681: 使用Map查找替代DB查询
      const adGroup = adGroupByAmazonId.get(String(apiTarget.adGroupId));
      if (!adGroup) continue;

      // ============================================================
      // 解析定向表达式 - 支持ASIN定向和品类定向两种模式
      // ============================================================
      // Amazon SP API expression数组可能包含以下type:
      // ASIN定向: asinSameAs(精准), asinExpandedFrom(拓展)
      // 品类定向: asinCategorySameAs(品类精准+品类ID)
      // 品牌定向: asinBrandSameAs(品牌精准)
      // 自动定向: queryBroadRelMatches(广泛/loose), queryHighRelMatches(紧密/close)
      //          asinSubstituteSameAs(替代品), asinAccessorySameAs(配件)
      // 品类细化: asinPriceBetween(价格范围), asinReviewRatingBetween(星级范围)
      
      let targetType: 'asin' | 'category' = 'asin';
      let targetValue = '';
      let targetMatchType: 'exact' | 'expanded' | 'category_exact' | 'brand_exact' | 'substitute' | 'accessory' | 'loose' | 'close' = 'exact';
      let categoryName: string | null = null;
      let categoryRefinements: string | null = null;
      
      // 收集品类细化条件
      const refinements: Record<string, unknown> = {};
      
      for (const expr of (apiTarget.expression || [])) {
        const et = (expr.type || '').toLowerCase();
        
        if (et.includes('categorysame') || et === 'asincategorysameAs' || et === 'asincategorysame') {
          // 品类定向
          targetType = 'category';
          targetValue = expr.value || '';
          targetMatchType = 'category_exact';
        } else if (et.includes('brandsame') || et === 'asinbrandsameAs' || et === 'asinbrandsame') {
          // 品牌定向（属于品类定向的子类型）
          targetType = 'category';
          targetValue = expr.value || '';
          targetMatchType = 'brand_exact';
        } else if (et.includes('pricebetween') || et.includes('price')) {
          // 价格范围细化
          refinements.priceRange = expr.value;
        } else if (et.includes('reviewrating') || et.includes('star') || et.includes('rating')) {
          // 星级范围细化
          refinements.starRating = expr.value;
        } else if (et.includes('isprime')) {
          // Prime筛选
          refinements.isPrime = expr.value;
        } else if (et.includes('expanded') || et.includes('expandedfrom')) {
          // ASIN拓展匹配
          targetType = 'asin';
          targetValue = expr.value || '';
          targetMatchType = 'expanded';
        } else if (et.includes('substitute')) {
          targetType = 'asin';
          targetValue = expr.value || 'AUTO_SUBSTITUTES';
          targetMatchType = 'substitute';
        } else if (et.includes('accessory') || et.includes('complement')) {
          targetType = 'asin';
          targetValue = expr.value || 'AUTO_COMPLEMENTS';
          targetMatchType = 'accessory';
        } else if (et.includes('broadrel') || et.includes('broad_rel') || et.includes('loose')) {
          targetValue = expr.value || 'AUTO_LOOSE';
          targetMatchType = 'loose';
        } else if (et.includes('highrel') || et.includes('high_rel') || et.includes('close')) {
          targetValue = expr.value || 'AUTO_CLOSE';
          targetMatchType = 'close';
        } else if (et.includes('asin') && et.includes('same')) {
          // ASIN精准匹配 (asinSameAs)
          targetType = 'asin';
          targetValue = expr.value || '';
          targetMatchType = 'exact';
        } else if (expr.value && !targetValue) {
          // 兜底：取第一个有值的expression
          targetValue = expr.value;
        }
      }
      
      // 如果没有从expression中提取到值，尝试从resolvedExpression获取
      if (!targetValue && (apiTarget as Record<string, unknown>).resolvedExpression) {
        const resolved = (apiTarget as Record<string, unknown>).resolvedExpression;
        if (Array.isArray(resolved)) {
          for (const re of resolved) {
            const ret = (re.type || '').toLowerCase();
            if (ret.includes('category')) {
              targetType = 'category';
              targetValue = re.value || '';
              targetMatchType = 'category_exact';
              categoryName = re.name || null;
            } else if (re.value) {
              targetValue = re.value;
            }
          }
        }
      }
      
      // 构建品类细化条件JSON
      if (Object.keys(refinements).length > 0) {
        categoryRefinements = JSON.stringify(refinements);
      }
      
      // v474: 安全处理 - 如果targetValue仍然为空，使用expression类型作为回退值
      if (!targetValue) {
        const exprTypes = (apiTarget.expression || []).map((e: Record<string, unknown>) => e.type || '').join(',');
        targetValue = exprTypes || `AUTO_${String(apiTarget.targetId)}`;
        log.debug(`v474: targetValue为空，使用回退值: ${targetValue}, expression=${JSON.stringify(apiTarget.expression)}`);
      }
      
      // Amazon API返回的state可能是大写，需要转换为小写
      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      // v681: 使用Map查找existing target
      const existing = ptByAgIdAndTargetId.get(`${adGroup.id}_${String(apiTarget.targetId)}`);

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      const targetData = {
        accountId: service.accountId,  // v311: 添加缺失的accountId
        internalAdGroupId: adGroup.id,
        campaignId: adGroup.campaignId,
        targetId: String(apiTarget.targetId),
        targetType: targetType as 'asin' | 'category',
        targetValue,
        targetExpression: JSON.stringify(apiTarget.expression),
        targetMatchType,
        targetStatus: normalizedState,
        bid: String(typeof apiTarget.bid === 'object' && apiTarget.bid !== null ? (apiTarget.bid as Record<string, unknown>).amount || 0 : (apiTarget.bid || 0)),
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (synced === 0) {
        log.debug(`SP产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
      }

      if (existing) {
        // v523.2: 保护 amazon_deleted 状态不被同步覆盖
        if (existing.targetStatus === 'amazon_deleted' && normalizedState !== 'archived') {
          log.debug(`v523.2: 保护SP target amazon_deleted状态 - target=${existing.targetValue}(id=${existing.id})`);
          delete (targetData as Record<string, unknown>).targetStatus;
        }
        // v150: 智能出价保护策略
        // 检查optimization_events表，如果该产品定向有24小时内成功同步的出价优化事件，
        // 则保留本地bid不被覆盖
        const localBid = parseFloat(existing.bid || '0');
        const apiBid = parseFloat(String(apiTarget.bid || '0'));
        
        if (Math.abs(localBid - apiBid) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBid > 0) {
          // 出价不一致，检查是否有近期优化事件（使用批量查询结果）
          const hasRecentOpt = protectedTargetIds.has(existing.id);
          if (hasRecentOpt) {
            log.debug(`v150: 出价保护生效 - target=${existing.targetValue}, local=$${localBid}, api=$${apiBid}, 保留本地优化出价`);
            delete (targetData as Record<string, unknown>[]).bid;
            protectionStats.bidProtected++;
            protectionStats.protectedEntities.push(`tgt:${existing.targetValue}`);
          } else {
            log.debug(`v150: 出价差异 - target=${existing.targetValue}, local=$${localBid}, api=$${apiBid}, 以API为准`);
            protectionStats.bidOverwritten++;
          }
        }
        
        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
      } else {
        await db.insert(productTargets).values({
          ...targetData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SP产品定向同步完成: synced=${synced}, skipped=${skipped}`);
    logSyncProtectionSummary('syncSpProductTargets', protectionStats);

    // v525: 正向对齐 - SP产品定向
    try {
      const syncVer = nextSyncVersion();
      const amazonTargetIds = apiTargets.map((t: any) => String(t.targetId)).filter(Boolean);
      markEntitiesVerified('product_target', apiTargets.map((t: any) => Number(t.targetId)).filter(Boolean), syncVer);
      await forwardAlign(service.accountId, 'product_target', amazonTargetIds);
    } catch (alignErr: unknown) {
      log.debug(`[v525] SP产品定向正向对齐失败: ${(alignErr as Error).message}`);
    }

    return { synced, skipped };
  } catch (error) {
    log.warn('Error syncing SP product targets:', error);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步商品定位级别绩效数据
 * 注意: SP-Targeting报告已包含商品定位数据，syncKeywordPerformanceData中已处理
 * 此方法作为补充，确保数据完整性
 */
export async function syncProductTargetPerformanceData(service: SyncContext,days: number): Promise<number> {
  // SP-Targeting报告已在syncKeywordPerformanceData中处理了product_targets的更新
  // 这里返回0表示不需要额外同步
  log.info('商品定位绩效数据已在syncKeywordPerformanceData中一并处理');
  return 0;
}


