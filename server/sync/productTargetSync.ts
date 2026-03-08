/**
 * 商品定位同步模块
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
import type { AmazonAdsApiClient } from '../amazonAdsApi';

/** 同步服务上下文 - 从AmazonSyncService传入 */
export interface SyncContext {
  client: AmazonAdsApiClient;
  accountId: number;
  userId: number;
  marketplace: string;
}

const log = createModuleLogger('productTargetSync');

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

    for (const apiTarget of apiTargets) {
      // 查找对应的ad group
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(apiTarget.adGroupId)))
        .limit(1);

      if (!adGroup) continue;

      // 解析定向表达式和匹配类型 - 支持ASIN定向和品类定向
      let targetType: 'asin' | 'category' = 'category';
      let targetValue = '';
      let targetExpression = '';
      let targetMatchType: 'exact' | 'expanded' | 'category_exact' | 'brand_exact' | 'substitute' | 'accessory' | 'loose' | 'close' = 'exact';
      let categoryName: string | null = null;
      let categoryRefinements: string | null = null;
      const refinements: Record<string, any> = {};

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

      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(productTargets)
        .where(
          and(
            eq(productTargets.adGroupId, adGroup.id),
            eq(productTargets.targetId, String(apiTarget.targetId))
          )
        )
        .limit(1);

      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

       const targetData = {
        accountId: service.accountId,  // v311: 添加缺失的accountId
        adGroupId: adGroup.id,
        campaignId: adGroup.campaignId,
        targetId: String(apiTarget.targetId),
        targetType,
        targetValue,
        targetExpression,
        targetMatchType,
        bid: String(apiTarget.bid || 0),
        targetStatus: normalizedState,
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (synced === 0) {
        log.debug(`SB产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
      }

      if (existing) {
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
    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SB product targets:', error);
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

    for (const apiTarget of apiTargets) {
      // 查找对应的ad group
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(apiTarget.adGroupId)))
        .limit(1);

      if (!adGroup) continue;

      // 解析定向表达式和匹配类型 - 支持ASIN定向和品类定向
      let targetType: 'asin' | 'category' = 'category';
      let targetValue = '';
      let targetExpression = '';
      let targetMatchType: 'exact' | 'expanded' | 'category_exact' | 'brand_exact' | 'substitute' | 'accessory' | 'loose' | 'close' = 'exact';
      let categoryName: string | null = null;
      let categoryRefinements: string | null = null;
      const refinements: Record<string, any> = {};

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

      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(productTargets)
        .where(
          and(
            eq(productTargets.adGroupId, adGroup.id),
            eq(productTargets.targetId, String(apiTarget.targetId))
          )
        )
        .limit(1);

      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const targetData = {
        accountId: service.accountId,  // v311: 添加缺失的accountId
        adGroupId: adGroup.id,
        campaignId: adGroup.campaignId,
        targetId: String(apiTarget.targetId),
        targetType,
        targetValue,
        targetExpression,
        targetMatchType,
        bid: String(apiTarget.bid || 0),
        targetStatus: normalizedState,
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (synced === 0) {
        log.debug(`SD产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);;
      }

      if (existing) {
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
    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SD product targets:', error);
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
      const asinExpr = expression.find((e: Record<string, any>) => e.type?.toLowerCase().includes('asin'));
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
      const asinExpr = expression.find((e: Record<string, any>) => e.type?.toLowerCase().includes('asin'));
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            eq(negativeKeywords.accountId, service.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.adGroupId, adGroup.id),
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
          adGroupId: adGroup.id,
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
    log.error('Error syncing SP negative product targets:', error);
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

    // v150.1: 批量预查询所有需要保护的产品定向ID（减少循环内DB查询）
    const allExistingTargetIds: number[] = [];
    for (const at of apiTargets) {
      const [ag] = await db.select({ id: adGroups.id }).from(adGroups)
        .where(eq(adGroups.adGroupId, String(at.adGroupId))).limit(1);
      if (!ag) continue;
      const [ex] = await db.select({ id: productTargets.id }).from(productTargets)
        .where(and(eq(productTargets.adGroupId, ag.id), eq(productTargets.targetId, String(at.targetId)))).limit(1);
      if (ex) allExistingTargetIds.push(ex.id);
    }
    const protectedTargetIds = await getRecentlyOptimizedKeywordIds(allExistingTargetIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpProductTargets: 批量查询完成, ${protectedTargetIds.size}个产品定向有近期出价优化事件`);

    for (const apiTarget of apiTargets) {
      // 查找对应的ad group
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(apiTarget.adGroupId)))
        .limit(1);

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
      const refinements: Record<string, any> = {};
      
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
        } else if (et.includes('broadrel') || et.includes('loose')) {
          targetValue = expr.value || 'AUTO_LOOSE';
          targetMatchType = 'loose';
        } else if (et.includes('highrel') || et.includes('close')) {
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
      if (!targetValue && (apiTarget as Record<string, any>).resolvedExpression) {
        const resolved = (apiTarget as Record<string, any>).resolvedExpression;
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
      
      // Amazon API返回的state可能是大写，需要转换为小写
      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(productTargets)
        .where(
          and(
            eq(productTargets.adGroupId, adGroup.id),
            eq(productTargets.targetId, String(apiTarget.targetId))
          )
        )
        .limit(1);

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      const targetData = {
        accountId: service.accountId,  // v311: 添加缺失的accountId
        adGroupId: adGroup.id,
        campaignId: adGroup.campaignId,
        targetId: String(apiTarget.targetId),
        targetType: targetType as 'asin' | 'category',
        targetValue,
        targetExpression: JSON.stringify(apiTarget.expression),
        targetMatchType,
        targetStatus: normalizedState,
        bid: String(apiTarget.bid || 0),
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (synced === 0) {
        log.debug(`SP产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
      }

      if (existing) {
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
            delete (targetData as Record<string, any>[]).bid;
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
    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SP product targets:', error);
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


