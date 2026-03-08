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
import type { AmazonAdsApiClient } from '../amazonAdsApi';

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
        // v141: 即时回填机制 - 尝试通过Amazon API查找并回填keywordId
        log.debug(`[applyBidAdjustment] keyword id=${targetId} ("${kw.keywordText}") 缺少keywordId，尝试即时回填...`);
        try {
          const { resolveKeywordIdOnDemand } = await import('./services/amazonIdResolver');
          // 获取accountId: 通过adGroup -> campaign -> accountId
          const [ag] = await db.select().from(adGroups).where(eq(adGroups.id, kw.adGroupId)).limit(1);
          if (ag) {
            const [camp] = await db.select().from(campaigns).where(eq(campaigns.campaignId, ag.campaignId)).limit(1);
            if (camp) {
              const resolvedId = await resolveKeywordIdOnDemand(camp.accountId, targetId);
              if (resolvedId) {
                kw.keywordId = resolvedId;
                log.info(`[applyBidAdjustment] ✅ 即时回填成功: keyword id=${targetId} -> keywordId=${resolvedId}`);
              }
            }
          }
        } catch (resolveErr: unknown) {
          log.error(`[applyBidAdjustment] 即时回填异常: ${(resolveErr as Error).message}`);
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
      adGroupId = kw.adGroupId;
      
      // v222: 使用统一解析器获取正确的 Amazon campaignId
      const { safeCampaignIdForInsert } = await import('./utils/campaignIdResolver');
      resolvedCampaignId = await safeCampaignIdForInsert({
        campaignId,
        targetLocalId: targetId,
        targetType: 'keyword',
        adGroupId: kw.adGroupId,
        caller: 'applyBidAdjustment:keyword',
      });

      // v125: Amazon SP API v3 要求keywordId为字符串类型，直接传递字符串
      if (!amazonId || amazonId.trim() === '' || amazonId === '0') {
        log.error(`[applyBidAdjustment] keyword id=${targetId} 的Amazon keywordId无效: "${amazonId}"`);
        return false;
      }
      log.debug(`[applyBidAdjustment] 调用Amazon API: keywordId="${amazonId}", bid=${Number(newBid.toFixed(2))}`);
      await service.client.updateKeywordBids([{
        keywordId: amazonId,
        bid: Number(newBid.toFixed(2)),
      }]);

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
        // v141: 即时回填机制 - 尝试通过Amazon API查找并回填targetId
        log.debug(`[applyBidAdjustment] product_target id=${targetId} ("${pt.targetValue}") 缺少targetId，尝试即时回填...`);
        try {
          const { resolveProductTargetIdOnDemand } = await import('./services/amazonIdResolver');
          const [ag] = await db.select().from(adGroups).where(eq(adGroups.id, pt.adGroupId)).limit(1);
          if (ag) {
            const [camp] = await db.select().from(campaigns).where(eq(campaigns.campaignId, ag.campaignId)).limit(1);
            if (camp) {
              const resolvedId = await resolveProductTargetIdOnDemand(camp.accountId, targetId);
              if (resolvedId) {
                pt.targetId = resolvedId;
                log.info(`[applyBidAdjustment] ✅ 即时回填成功: product_target id=${targetId} -> targetId=${resolvedId}`);
              }
            }
          }
        } catch (resolveErr: unknown) {
          log.error(`[applyBidAdjustment] 即时回填异常: ${(resolveErr as Error).message}`);
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
      adGroupId = pt.adGroupId;
      
      // v222: 使用统一解析器获取正确的 Amazon campaignId
      const { safeCampaignIdForInsert } = await import('./utils/campaignIdResolver');
      resolvedCampaignId = await safeCampaignIdForInsert({
        campaignId,
        targetLocalId: targetId,
        targetType: 'product_target',
        adGroupId: pt.adGroupId,
        caller: 'applyBidAdjustment:product_target',
      });

      // v125: Amazon SP API v3 要求targetId为字符串类型，直接传递字符串
      if (!amazonId || amazonId.trim() === '' || amazonId === '0') {
        log.error(`[applyBidAdjustment] product_target id=${targetId} 的Amazon targetId无效: "${amazonId}"`);
        return false;
      }
      log.debug(`[applyBidAdjustment] 调用Amazon API: targetId="${amazonId}", bid=${Number(newBid.toFixed(2))}`);
      await service.client.updateProductTargetBids([{
        targetId: amazonId,
        bid: Number(newBid.toFixed(2)),
      }]);

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
        adGroupId,
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
        await db.execute(sql`INSERT INTO bidding_logs (accountId, campaignId, adGroupId, logTargetType, targetId, targetName, actionType, previousBid, newBid, bidChangePercent, reason, algorithmVersion, isIntradayAdjustment, execution_status, createdAt) VALUES (${service.accountId}, ${resolvedCampaignId}, ${adGroupId}, ${logTargetType}, ${targetId}, ${targetName}, ${actionType}, ${String(oldBid)}, ${String(newBid)}, ${String(bidChangePercent)}, ${reason}, ${'v1.0'}, ${0}, ${'success'}, ${now})`);
        log.info(`[applyBidAdjustment] ✅ 日志通过原生SQL插入成功`);
      } catch (rawSqlError: unknown) {
        log.error(`[applyBidAdjustment] ⚠️ 原生SQL日志也失败: ${(rawSqlError as Error).message}`);
      }
    }

    return true;
  } catch (error: unknown) {
    const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : (error as Error).message;
    log.error(`[applyBidAdjustment] ❗ ${targetType} id=${targetId} 出价调整失败:`, errorDetail);
    log.error(`[applyBidAdjustment] 详细信息: newBid=${newBid}, campaignId=${campaignId}, HTTP状态=${(error as Error & { response?: unknown }).response?.status || 'N/A'}`);
    
    // v126: 记录失败的出价调整到bidding_logs
    try {
      const bidChangePercent = oldBid > 0 ? ((newBid - oldBid) / oldBid) * 100 : 0;
      const actionType = newBid > oldBid ? 'increase' : newBid < oldBid ? 'decrease' : 'set';
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const logTargetType = targetType === 'keyword' ? 'keyword' : 'product_target';
      const errMsg = errorDetail.substring(0, 500);
      await db.execute(sql`INSERT INTO bidding_logs (accountId, campaignId, adGroupId, logTargetType, targetId, targetName, actionType, previousBid, newBid, bidChangePercent, reason, algorithmVersion, isIntradayAdjustment, execution_status, error_message, createdAt) VALUES (${service.accountId}, ${resolvedCampaignId}, ${adGroupId}, ${logTargetType}, ${targetId}, ${targetName || ''}, ${actionType}, ${String(oldBid)}, ${String(newBid)}, ${String(bidChangePercent)}, ${reason}, ${'v1.0'}, ${0}, ${'failed'}, ${errMsg}, ${now})`);
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
 */
export function getPlacementMultiplier(campaign: any, placement: string): number {
  const adjustment = campaign.bidding?.adjustments?.find(
    a => a.predicate === placement
  );
  return adjustment ? Number(adjustment.percentage) : 0;
}


