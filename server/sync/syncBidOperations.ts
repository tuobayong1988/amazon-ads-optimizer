/**
 * 出价调整操作和展示位置计算方法
 * 
 * 从 amazonSyncService.ts 中提取的 bidOperations 子模块。
 * 通过 prototype 扩展模式将方法注入到 AmazonSyncService 类中。
 */
import { eq, and, sql, gte, lte, inArray, desc, asc, isNull, isNotNull } from 'drizzle-orm';
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
import type { AmazonAdsApiClient, SpCampaign } from './amazonAdsApi';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from '../utils/timezone';
import { getExchangeRateByMarketplace } from '../services/exchangeRateService';
import { AmazonSyncService } from './amazonSyncService';
import {
  SYNC_PROTECTION_CONFIG,
  createSyncProtectionStats,
  logSyncProtectionSummary,
  hasRecentSyncedOptimization,
  getRecentlyOptimizedKeywordIds,
  getRecentlyOptimizedCampaignIds,
} from './syncHelpers';
import { calculateBidAdjustment } from '../optimization/bidOptimizer';
import type { OptimizationTarget, PerformanceGroupConfig } from '../optimization/bidOptimizer';

const log = createModuleLogger('bidOperations');

// ==================== 类型声明（模块扩展） ====================

declare module '../../amazonSyncService' {
  interface AmazonSyncService {
    applyBidAdjustment(...args: unknown[]): unknown;
    applyBatchBidAdjustments(...args: unknown[]): unknown;
    getPlacementMultiplier(...args: unknown[]): unknown;
  }
}

// ==================== 方法实现 ====================

/**
 * 执行出价调整并同步到Amazon
 */
AmazonSyncService.prototype.applyBidAdjustment = async function(this: AmazonSyncService, targetType: 'keyword' | 'product_target', targetId: number, newBid: number, reason: string, campaignId: number | string, algorithmUsed?: string): Promise<boolean | { success: boolean; apiResponseId?: string }> {
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
        log.warn(`[applyBidAdjustment] keyword id=${targetId} 不存在`);
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
            const [ag] = await db.select().from(adGroups).where(eq(adGroups.id, Number(kw.internalAdGroupId))).limit(1);
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
            log.warn(`[applyBidAdjustment] 即时回填异常: ${(resolveErr as Error).message}`);
          }
        }
        
        if (!kw.keywordId) {
          log.warn(`[applyBidAdjustment] keyword id=${targetId} ("${kw.keywordText}") 缺少Amazon keywordId，无法同步到Amazon`);
          // v190: 改为可重试 - ID可能在后续同步中被回填，重试队列会在下次执行时重新尝试
          const err = new Error(`MISSING_AMAZON_ID: keyword id=${targetId} 缺少Amazon keywordId`);
          throw err;
        }
      }
      
      amazonId = kw.keywordId;
      oldBid = parseFloat(kw.bid);
      targetName = kw.keywordText;
      adGroupId = Number(kw.internalAdGroupId) || null;  // v357: adGroupId现在是string类型
      
      // v222: 使用统一解析器获取正确的 Amazon campaignId
      const { safeCampaignIdForInsert } = await import('../utils/campaignIdResolver');
      resolvedCampaignId = await safeCampaignIdForInsert({
        campaignId,
        targetLocalId: targetId,
        targetType: 'keyword',
        adGroupId: Number(kw.internalAdGroupId) || null,  // v357: adGroupId现在是string类型
        caller: 'applyBidAdjustment:keyword',
      });

      // v125: Amazon SP API v3 要求keywordId为字符串类型，直接传递字符串
      if (!amazonId || amazonId.trim() === '' || amazonId === '0') {
        log.warn(`[applyBidAdjustment] keyword id=${targetId} 的Amazon keywordId无效: "${amazonId}"`);
        return false;
      }
      log.debug(`[applyBidAdjustment] 调用Amazon API: keywordId="${amazonId}", bid=${Number(newBid.toFixed(2))}`);
      // v333: 捕获API返回的requestId用于端到端追踪
      const apiResult: unknown = await this.client.updateKeywordBids([{
        keywordId: amazonId,
        bid: Number(newBid.toFixed(2)),
      }]);
      var _apiResponseId = apiResult.requestIds?.[0] || '';

      // v150: 移除冗余DB更新 - 本地DB更新由executeBidOptimization的事务批量处理统一执行
      // 避免双重DB更新导致的性能浪费和潜在不一致性
    } else {
      const [pt] = await db
        .select()
        .from(productTargets)
        .where(eq(productTargets.id, targetId))
        .limit(1);
      
      if (!pt) {
        log.warn(`[applyBidAdjustment] product_target id=${targetId} 不存在`);
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
            const [ag] = await db.select().from(adGroups).where(eq(adGroups.id, Number(pt.internalAdGroupId))).limit(1);
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
            log.warn(`[applyBidAdjustment] 即时回填异常: ${(resolveErr as Error).message}`);
          }
        }
        
        if (!pt.targetId) {
          log.warn(`[applyBidAdjustment] product_target id=${targetId} ("${pt.targetValue}") 缺少Amazon targetId，无法同步到Amazon`);
          // v190: 改为可重试 - ID可能在后续同步中被回填，重试队列会在下次执行时重新尝试
          const err = new Error(`MISSING_AMAZON_ID: product_target id=${targetId} 缺少Amazon targetId`);
          throw err;
        }
      }
      
      amazonId = pt.targetId;
      oldBid = parseFloat(pt.bid);
      targetName = pt.targetValue || 'Product Target';
      adGroupId = Number(pt.internalAdGroupId) || null;  // v357: adGroupId现在是string类型
      
      // v222: 使用统一解析器获取正确的 Amazon campaignId
      const { safeCampaignIdForInsert } = await import('../utils/campaignIdResolver');
      resolvedCampaignId = await safeCampaignIdForInsert({
        campaignId,
        targetLocalId: targetId,
        targetType: 'product_target',
        adGroupId: Number(pt.internalAdGroupId) || null,  // v357: adGroupId现在是string类型
        caller: 'applyBidAdjustment:product_target',
      });

      // v125: Amazon SP API v3 要求targetId为字符串类型，直接传递字符串
      if (!amazonId || amazonId.trim() === '' || amazonId === '0') {
        log.warn(`[applyBidAdjustment] product_target id=${targetId} 的Amazon targetId无效: "${amazonId}"`);
        return false;
      }
      log.debug(`[applyBidAdjustment] 调用Amazon API: targetId="${amazonId}", bid=${Number(newBid.toFixed(2))}`);
      // v333: 捕获API返回的requestId用于端到端追踪
      const ptApiResult = await this.client.updateProductTargetBids([{
        targetId: amazonId,
        bid: Number(newBid.toFixed(2)),
      }]);
      // @ts-expect-error - runtime type mismatch
      var _apiResponseId = ptApiResult.requestIds?.[0] || '';

      // v150: 移除冗余DB更新 - 本地DB更新由executeBidOptimization的事务批量处理统一执行
      // 避免双重DB更新导致的性能浪费和潜在不一致性
    }

    // 计算出价变化
    const bidChangePercent = oldBid > 0 ? ((newBid - oldBid) / oldBid) * 100 : 0;
    const actionType = newBid > oldBid ? 'increase' : newBid < oldBid ? 'decrease' : 'set';

    // v126: 将日志记录和API调用分开，确保API成功后即使日志失败也返回true
    log.info(`[applyBidAdjustment] ✅ Amazon API调用成功: ${targetType} id=${targetId}, ${oldBid} -> ${newBid}${_apiResponseId ? `, requestId=${_apiResponseId}` : ''}`);
    
    try {
      // @ts-expect-error - Drizzle query builder type
      await db.insert(biddingLogs).values({
        accountId: this.accountId,
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
        // v334: 记录使用的具体算法
        algorithmUsed: algorithmUsed || null,
        isIntradayAdjustment: 0,
        executionStatus: 'success',
        // v333: 记录Amazon API的requestId用于端到端追踪
        apiResponseId: _apiResponseId || null,
        createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      } as Record<string, unknown>);
    } catch (logError: unknown) {
      log.warn(`[applyBidAdjustment] ⚠️ 日志记录失败（API已成功）: ${(logError as Error).message}`);
      try {
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const logTargetType = targetType === 'keyword' ? 'keyword' : 'product_target';
        await db.execute(sql`INSERT INTO bidding_logs (accountId, campaignId, internal_ad_group_id, logTargetType, targetId, targetName, actionType, previousBid, newBid, bidChangePercent, reason, algorithmVersion, isIntradayAdjustment, execution_status, createdAt) VALUES (${this.accountId}, ${resolvedCampaignId}, ${adGroupId}, ${logTargetType}, ${targetId}, ${targetName}, ${actionType}, ${String(oldBid)}, ${String(newBid)}, ${String(bidChangePercent)}, ${reason}, ${'v1.0'}, ${0}, ${'success'}, ${now})`);
        log.info(`[applyBidAdjustment] ✅ 日志通过原生SQL插入成功`);
      } catch (rawSqlError: unknown) {
        log.warn(`[applyBidAdjustment] ⚠️ 原生SQL日志也失败: ${(rawSqlError as Error).message}`);
      }
    }

    // v333: 返回包含apiResponseId的结果对象，同时保持向后兼容（truthy值）
    return { success: true, apiResponseId: _apiResponseId || undefined };
  } catch (error: unknown) {
    // @ts-expect-error - error message access
    const errorDetail = (error as Record<string, unknown>).response?.data ? JSON.stringify(error.response.data) : (error as Error).message;
    log.warn(`[applyBidAdjustment] ❗ ${targetType} id=${targetId} 出价调整失败:`, errorDetail);
    // @ts-expect-error - Axios error response access
    log.warn(`[applyBidAdjustment] 详细信息: newBid=${newBid}, campaignId=${campaignId}, HTTP状态=${(error as Error & { response?: unknown }).response?.status || 'N/A'}`);
    
    // v310-fix: 识别Amazon ID无效错误，清空targetId防止后续继续尝试同步
    const isInvalidId = (
      // @ts-expect-error - Axios error response access
      (error as Error & { response?: unknown }).response?.status === 404 ||
      errorDetail.includes('INVALID_ARGUMENT') ||
      errorDetail.includes('NOT_FOUND') ||
      errorDetail.includes('RESOURCE_NOT_FOUND') ||
      errorDetail.includes('EntityNotFound') ||
      errorDetail.includes('does not exist')
    );
    if (isInvalidId && amazonId) {
      log.warn(`[applyBidAdjustment] v310-fix: ${targetType} id=${targetId} 的Amazon ID "${amazonId}" 已失效，清空以防止后续重复失败`);
      try {
        const dbInstance = await getDb();
        if (dbInstance) {
          const { sql: sqlTag } = await import('drizzle-orm');
          if (targetType === 'keyword') {
            await dbInstance.execute(sqlTag`UPDATE keywords SET keywordId = NULL WHERE id = ${targetId}`);
          } else {
            await dbInstance.execute(sqlTag`UPDATE product_targets SET targetId = NULL WHERE id = ${targetId}`);
          }
          log.info(`[applyBidAdjustment] v310-fix: 已清空${targetType} id=${targetId}的Amazon ID，将通过即时回填机制重新获取`);
        }
      } catch (clearErr: unknown) {
        log.warn(`[applyBidAdjustment] v310-fix: 清空Amazon ID失败: ${(clearErr as Error).message}`);
      }
    }
    
    // v126: 记录失败的出价调整到bidding_logs
    try {
      const bidChangePercent = oldBid > 0 ? ((newBid - oldBid) / oldBid) * 100 : 0;
      const actionType = newBid > oldBid ? 'increase' : newBid < oldBid ? 'decrease' : 'set';
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const logTargetType = targetType === 'keyword' ? 'keyword' : 'product_target';
      const errMsg = errorDetail.substring(0, 500);
      await db.execute(sql`INSERT INTO bidding_logs (accountId, campaignId, internal_ad_group_id, logTargetType, targetId, targetName, actionType, previousBid, newBid, bidChangePercent, reason, algorithmVersion, isIntradayAdjustment, execution_status, error_message, createdAt) VALUES (${this.accountId}, ${resolvedCampaignId}, ${adGroupId}, ${logTargetType}, ${targetId}, ${targetName || ''}, ${actionType}, ${String(oldBid)}, ${String(newBid)}, ${String(bidChangePercent)}, ${reason}, ${'v1.0'}, ${0}, ${'failed'}, ${errMsg}, ${now})`);
        // v351: 同时检查server/sync/bidOperations.ts中的相同问题
    } catch (logErr: unknown) {
      log.warn(`[applyBidAdjustment] ⚠️ 失败日志记录也失败: ${(logErr as Error).message}`);
    }
    
    return false;
  }
};

/**
 * 批量执行出价调整
 */
AmazonSyncService.prototype.applyBatchBidAdjustments = async function(this: AmazonSyncService, adjustments: Array<{ targetType: 'keyword' | 'product_target'; targetId: number; newBid: number; reason: string; campaignId: number; }>): Promise<{ success: number; failed: number }> {
  const results = { success: 0, failed: 0 };

  for (const adj of adjustments) {
    const success = await this.applyBidAdjustment(
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
};

/**
 * 获取展示位置调整系数
 * v423: 支持Amazon SP API v3的dynamicBidding.placementBidding结构
 */
AmazonSyncService.prototype.getPlacementMultiplier = function(this: AmazonSyncService, campaign: SpCampaign, placement: string): number {
  const c = campaign as Record<string, unknown>;
  // v423: 优先从API v3的dynamicBidding.placementBidding中获取
  if (c.dynamicBidding?.placementBidding?.length > 0) {
    const placementMap: Record<string, string> = {
      'placementTop': 'PLACEMENT_TOP',
      'placementProductPage': 'PLACEMENT_PRODUCT_PAGE',
      'placementRestOfSearch': 'PLACEMENT_REST_OF_SEARCH',
    };
    const v3Placement = placementMap[placement] || placement;
    const adjustment = c.dynamicBidding.placementBidding.find(
      (a: unknown) => a.placement === v3Placement
    );
    return adjustment ? Number(adjustment.percentage) : 0;
  }
  // 兼容旧版API的bidding.adjustments结构
  const adjustment = campaign.bidding?.adjustments?.find(
    a => a.predicate === placement
  );
  return adjustment ? Number(adjustment.percentage) : 0;
};

