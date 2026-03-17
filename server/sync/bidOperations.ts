/**
 * 出价操作模块
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

/** 同步服务上下文 - 从AmazonSyncService传入 */
export interface SyncContext {
  client: AmazonAdsApiClient;
  accountId: number;
  userId: number;
  marketplace: string;
}

const log = createModuleLogger('bidOperations');

/**
 * 执行出价调整并同步到Amazon
 */
export async function applyBidAdjustment(service: SyncContext,
  targetType: 'keyword' | 'product_target',
  targetId: number,
  newBid: number,
  reason: string,
  campaignId: number | string  // v206: Amazon campaignId (varchar) or local int
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  let amazonId: string = '';
  let oldBid: number = 0;
  let targetName: string = '';
  let adGroupId: number | null = null;
  
  // v222: 使用统一的 campaignId 解析器确保写入正确的 Amazon ID
  let resolvedCampaignId: string = '';
  
  try {

    if (targetType === 'keyword') {
      const [kw] = await db
        .select()
        .from(keywords)
        .where(eq(keywords.id, targetId))
        .limit(1);
      
      if (!kw) {
        log.error(`[applyBidAdjustment] keyword id=${targetId} 不存在`);
        return false;
      }
      if (!kw.keywordId) {
        // v429: 使用entityIdResolver优先，amazonIdResolver降级
        log.debug(`[applyBidAdjustment] keyword id=${targetId} ("${kw.keywordText}") 缺少keywordId，尝试解析...`);
        
        // 第一层：entityIdResolver（有缓存，无API调用）
        try {
          const { resolveKeywordId } = await import('../services/entityIdResolver');
          const resolved = await resolveKeywordId(targetId);
          if (resolved && resolved.amazonId) {
            kw.keywordId = resolved.amazonId;
            log.info(`[applyBidAdjustment] ✅ v429 entityIdResolver解析成功: keyword id=${targetId} -> keywordId=${resolved.amazonId}`);
          }
        } catch (_) { /* entityIdResolver未初始化或查询失败 */ }
        
        // 第二层：amazonIdResolver即时回填（通过Amazon API）
        if (!kw.keywordId) {
          try {
            const { resolveKeywordIdOnDemand } = await import('../services/amazonIdResolver');
            const [ag] = await db.select().from(adGroups).where(eq(adGroups.id, kw.internalAdGroupId)).limit(1);
            if (ag) {
              const [camp] = await db.select().from(campaigns).where(eq(campaigns.campaignId, ag.campaignId)).limit(1);
              if (camp) {
                const resolvedId = await resolveKeywordIdOnDemand(camp.accountId, targetId);
                if (resolvedId) {
                  kw.keywordId = resolvedId;
                  log.info(`[applyBidAdjustment] ✅ v429 amazonIdResolver回填成功: keyword id=${targetId} -> keywordId=${resolvedId}`);
                }
              }
            }
          } catch (resolveErr: unknown) {
            log.error(`[applyBidAdjustment] 即时回填异常: ${(resolveErr as Error).message}`);
          }
        }
        
        if (!kw.keywordId) {
          log.error(`[applyBidAdjustment] keyword id=${targetId} ("${kw.keywordText}") 缺少Amazon keywordId，无法同步到Amazon`);
          // v190: 改为可重试 - ID可能在后续同步中被回填，重试队列会在下次执行时重新尝试
          const err = new Error(`MISSING_AMAZON_ID: keyword id=${targetId} 缺少Amazon keywordId`);
          throw err;
        }
      }
      
      amazonId = kw.keywordId;
      oldBid = parseFloat(kw.bid);
      targetName = kw.keywordText;
      adGroupId = kw.internalAdGroupId;
      
      // v222: 使用统一解析器获取正确的 Amazon campaignId
      const { safeCampaignIdForInsert } = await import('../utils/campaignIdResolver');
      resolvedCampaignId = await safeCampaignIdForInsert({
        campaignId,
        targetLocalId: targetId,
        targetType: 'keyword',
        adGroupId: kw.internalAdGroupId,
        caller: 'applyBidAdjustment:keyword',
      });

      // v125: Amazon SP API v3 要求keywordId为字符串类型，直接传递字符串
      if (!amazonId || amazonId.trim() === '' || amazonId === '0') {
        log.error(`[applyBidAdjustment] keyword id=${targetId} 的Amazon keywordId无效: "${amazonId}"`);
        return false;
      }
      log.debug(`[applyBidAdjustment] 调用Amazon API: keywordId="${amazonId}", bid=${Number(newBid.toFixed(2))}`);
      // v426: 检查API返回值，确保出价更新真正成功
      const bidResult = await service.client.updateKeywordBids([{
        keywordId: amazonId,
        bid: Number(newBid.toFixed(2)),
      }]);
      if (!bidResult.success && bidResult.errors.length > 0) {
        const errDetail = JSON.stringify(bidResult.errors[0]);
        log.error(`[applyBidAdjustment] v426: Amazon API返回错误: keywordId=${amazonId}, errors=${errDetail}`);
        throw new Error(`AMAZON_API_ERROR: keyword bid update failed: ${errDetail}`);
      }

      // v150: 移除冗余DB更新 - 本地DB更新由executeBidOptimization的事务批量处理统一执行
      // 避免双重DB更新导致的性能浪费和潜在不一致性
    } else {
      const [pt] = await db
        .select()
        .from(productTargets)
        .where(eq(productTargets.id, targetId))
        .limit(1);
      
      if (!pt) {
        log.error(`[applyBidAdjustment] product_target id=${targetId} 不存在`);
        return false;
      }
      if (!pt.targetId) {
        // v429: 使用entityIdResolver优先，amazonIdResolver降级
        log.debug(`[applyBidAdjustment] product_target id=${targetId} ("${pt.targetValue}") 缺少targetId，尝试解析...`);
        
        // 第一层：entityIdResolver（有缓存，无API调用）
        try {
          const { resolveProductTargetId } = await import('../services/entityIdResolver');
          const resolved = await resolveProductTargetId(targetId);
          if (resolved && resolved.amazonId) {
            pt.targetId = resolved.amazonId;
            log.info(`[applyBidAdjustment] ✅ v429 entityIdResolver解析成功: product_target id=${targetId} -> targetId=${resolved.amazonId}`);
          }
        } catch (_) { /* entityIdResolver未初始化或查询失败 */ }
        
        // 第二层：amazonIdResolver即时回填（通过Amazon API）
        if (!pt.targetId) {
          try {
            const { resolveProductTargetIdOnDemand } = await import('../services/amazonIdResolver');
            const [ag] = await db.select().from(adGroups).where(eq(adGroups.id, pt.internalAdGroupId)).limit(1);
            if (ag) {
              const [camp] = await db.select().from(campaigns).where(eq(campaigns.campaignId, ag.campaignId)).limit(1);
              if (camp) {
                const resolvedId = await resolveProductTargetIdOnDemand(camp.accountId, targetId);
                if (resolvedId) {
                  pt.targetId = resolvedId;
                  log.info(`[applyBidAdjustment] ✅ v429 amazonIdResolver回填成功: product_target id=${targetId} -> targetId=${resolvedId}`);
                }
              }
            }
          } catch (resolveErr: unknown) {
            log.error(`[applyBidAdjustment] 即时回填异常: ${(resolveErr as Error).message}`);
          }
        }
        
        if (!pt.targetId) {
          log.error(`[applyBidAdjustment] product_target id=${targetId} ("${pt.targetValue}") 缺少Amazon targetId，无法同步到Amazon`);
          // v190: 改为可重试 - ID可能在后续同步中被回填，重试队列会在下次执行时重新尝试
          const err = new Error(`MISSING_AMAZON_ID: product_target id=${targetId} 缺少Amazon targetId`);
          throw err;
        }
      }
      
      amazonId = pt.targetId;
      oldBid = parseFloat(pt.bid);
      targetName = pt.targetValue || 'Product Target';
      adGroupId = pt.internalAdGroupId;
      
      // v222: 使用统一解析器获取正确的 Amazon campaignId
      const { safeCampaignIdForInsert } = await import('../utils/campaignIdResolver');
      resolvedCampaignId = await safeCampaignIdForInsert({
        campaignId,
        targetLocalId: targetId,
        targetType: 'product_target',
        adGroupId: pt.internalAdGroupId,
        caller: 'applyBidAdjustment:product_target',
      });

      // v125: Amazon SP API v3 要求targetId为字符串类型，直接传递字符串
      if (!amazonId || amazonId.trim() === '' || amazonId === '0') {
        log.error(`[applyBidAdjustment] product_target id=${targetId} 的Amazon targetId无效: "${amazonId}"`);
        return false;
      }
      log.debug(`[applyBidAdjustment] 调用Amazon API: targetId="${amazonId}", bid=${Number(newBid.toFixed(2))}`);
      // v426: 检查API返回值，确保出价更新真正成功
      const targetBidResult = await service.client.updateProductTargetBids([{
        targetId: amazonId,
        bid: Number(newBid.toFixed(2)),
      }]);
      if (!targetBidResult.success && targetBidResult.errors.length > 0) {
        const errDetail = JSON.stringify(targetBidResult.errors[0]);
        log.error(`[applyBidAdjustment] v426: Amazon API返回错误: targetId=${amazonId}, errors=${errDetail}`);
        throw new Error(`AMAZON_API_ERROR: target bid update failed: ${errDetail}`);
      }

      // v150: 移除冗余DB更新 - 本地DB更新由executeBidOptimization的事务批量处理统一执行
      // 避免双重DB更新导致的性能浪费和潜在不一致性
    }

    // 计算出价变化
    const bidChangePercent = oldBid > 0 ? ((newBid - oldBid) / oldBid) * 100 : 0;
    const actionType = newBid > oldBid ? 'increase' : newBid < oldBid ? 'decrease' : 'set';

    // v126: 将日志记录和API调用分开，确保API成功后即使日志失败也返回true
    log.info(`[applyBidAdjustment] ✅ Amazon API调用成功: ${targetType} id=${targetId}, ${oldBid} -> ${newBid}`);
    
    try {
      await db.insert(biddingLogs).values({
        accountId: service.accountId,
        campaignId: resolvedCampaignId,
        internalAdGroupId: adGroupId,  // v418: ID体系重构
        logTargetType: targetType === 'keyword' ? 'keyword' : 'product_target',
        targetId,
        targetName,
        actionType: actionType as 'increase' | 'decrease' | 'set',
        previousBid: String(oldBid),
        newBid: String(newBid),
        bidChangePercent: String(bidChangePercent),
        reason,
        algorithmVersion: 'v1.0',
        isIntradayAdjustment: 0,
        executionStatus: 'success',
        createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
    } catch (logError: unknown) {
      log.error(`[applyBidAdjustment] ⚠️ 日志记录失败（API已成功）: ${(logError as Error).message}`);
      try {
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const logTargetType = targetType === 'keyword' ? 'keyword' : 'product_target';
        await db.execute(sql`INSERT INTO bidding_logs (accountId, campaignId, internal_ad_group_id, logTargetType, targetId, targetName, actionType, previousBid, newBid, bidChangePercent, reason, algorithmVersion, isIntradayAdjustment, execution_status, createdAt) VALUES (${service.accountId}, ${resolvedCampaignId}, ${adGroupId}, ${logTargetType}, ${targetId}, ${targetName}, ${actionType}, ${String(oldBid)}, ${String(newBid)}, ${String(bidChangePercent)}, ${reason}, ${'v1.0'}, ${0}, ${'success'}, ${now})`);
        log.info(`[applyBidAdjustment] ✅ 日志通过原生SQL插入成功`);
      } catch (rawSqlError: unknown) {
        log.error(`[applyBidAdjustment] ⚠️ 原生SQL日志也失败: ${(rawSqlError as Error).message}`);
      }
    }

    return true;
  } catch (error: unknown) {
    const errorDetail = (error as any).response?.data ? JSON.stringify(error.response.data) : (error as Error).message;
    log.error(`[applyBidAdjustment] ❗ ${targetType} id=${targetId} 出价调整失败:`, errorDetail);
    log.error(`[applyBidAdjustment] 详细信息: newBid=${newBid}, campaignId=${campaignId}, HTTP状态=${(error as Error & { response?: unknown }).response?.status || 'N/A'}`);
    
    // v126: 记录失败的出价调整到bidding_logs
    try {
      const bidChangePercent = oldBid > 0 ? ((newBid - oldBid) / oldBid) * 100 : 0;
      const actionType = newBid > oldBid ? 'increase' : newBid < oldBid ? 'decrease' : 'set';
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const logTargetType = targetType === 'keyword' ? 'keyword' : 'product_target';
      const errMsg = errorDetail.substring(0, 500);
      await db.execute(sql`INSERT INTO bidding_logs (accountId, campaignId, internal_ad_group_id, logTargetType, targetId, targetName, actionType, previousBid, newBid, bidChangePercent, reason, algorithmVersion, isIntradayAdjustment, execution_status, error_message, createdAt) VALUES (${service.accountId}, ${resolvedCampaignId}, ${adGroupId}, ${logTargetType}, ${targetId}, ${targetName || ''}, ${actionType}, ${String(oldBid)}, ${String(newBid)}, ${String(bidChangePercent)}, ${reason}, ${'v1.0'}, ${0}, ${'failed'}, ${errMsg}, ${now})`);
    } catch (logErr: unknown) {
      log.error(`[applyBidAdjustment] ⚠️ 失败日志记录也失败: ${(logErr as Error).message}`);
    }
    
    return false;
  }
}


/**
 * 批量执行出价调整
 */
export async function applyBatchBidAdjustments(service: SyncContext,
  adjustments: Array<{
    targetType: 'keyword' | 'product_target';
    targetId: number;
    newBid: number;
    reason: string;
    campaignId: number;
  }>
): Promise<{ success: number; failed: number }> {
  const results = { success: 0, failed: 0 };

  for (const adj of adjustments) {
    const success = await service.applyBidAdjustment(
      adj.targetType,
      adj.targetId,
      adj.newBid,
      adj.reason,
      adj.campaignId
    );
    
    if (success) {
      results.success++;
    } else {
      results.failed++;
    }
  }

  return results;
}

/**
 * 获取展示位置调整系数
 * v423: 支持Amazon SP API v3的dynamicBidding.placementBidding结构
 * API v3返回: { dynamicBidding: { placementBidding: [{ placement: 'PLACEMENT_TOP', percentage: 19 }] } }
 * 旧版API返回: { bidding: { adjustments: [{ predicate: 'placementTop', percentage: 19 }] } }
 * 
 * placement参数映射:
 *   'placementTop' -> 'PLACEMENT_TOP'
 *   'placementProductPage' -> 'PLACEMENT_PRODUCT_PAGE'
 *   'placementRestOfSearch' -> 'PLACEMENT_REST_OF_SEARCH'
 */
export function getPlacementMultiplier(campaign: Record<string, any>, placement: string): number {
  // v423: 优先从API v3的dynamicBidding.placementBidding中获取
  if (campaign.dynamicBidding?.placementBidding?.length > 0) {
    // 将旧的predicate名称映射到API v3的placement名称
    const placementMap: Record<string, string> = {
      'placementTop': 'PLACEMENT_TOP',
      'placementProductPage': 'PLACEMENT_PRODUCT_PAGE',
      'placementRestOfSearch': 'PLACEMENT_REST_OF_SEARCH',
    };
    const v3Placement = placementMap[placement] || placement;
    const adjustment = campaign.dynamicBidding.placementBidding.find(
      (a: any) => a.placement === v3Placement
    );
    return adjustment ? Number(adjustment.percentage) : 0;
  }
  
  // 兼容旧版API的bidding.adjustments结构
  const adjustment = campaign.bidding?.adjustments?.find(
    (a: any) => a.predicate === placement
  );
  return adjustment ? Number(adjustment.percentage) : 0;
}


