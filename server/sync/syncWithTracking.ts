/**
 * 带变更跟踪的同步方法 (v223)
 * 
 * 从 amazonSyncService.ts 中提取，通过 prototype 扩展 AmazonSyncService 类。
 * 提供带有详细变更记录和冲突检测的同步方法。
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../db';
import { campaigns, adGroups, keywords, productTargets } from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';
import { AmazonSyncService } from './amazonSyncService';
import { detectConflict, getRecentlyOptimizedKeywordIds, getRecentlyOptimizedCampaignIds, SYNC_PROTECTION_CONFIG, createSyncProtectionStats, logSyncProtectionSummary } from './syncHelpers';
import {
  createSyncChangeRecordsBatch,
  createSyncConflictsBatch,
} from '../db';
import type {
  InsertSyncChangeRecord,
  InsertSyncConflict,
} from '../../drizzle/schema';

const log = createModuleLogger('SyncTracking');

// 扩展 AmazonSyncService 类型声明
declare module '../../amazonSyncService' {
  interface AmazonSyncService {
    syncSpCampaignsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
    syncSbCampaignsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
    syncSdCampaignsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
    syncSpAdGroupsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
    syncSpKeywordsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
    syncSpProductTargetsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
  }
}

export interface SyncResultWithTracking {
  synced: number;
  skipped: number;
  created: number;
  updated: number;
  deleted: number;
  conflicts: number;
}

AmazonSyncService.prototype.syncSpCampaignsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  log.info('[同步WithTracking] ========== 开始同步SP广告活动(带跟踪) ==========');
  log.info('[同步WithTracking] 参数:', { accountId: this.accountId, lastSyncTime, syncJobId });
  
  const db = await getDb();
  if (!db) {
    log.error('[同步WithTracking] ❌ 数据库连接失败');
    return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };
  }
  log.info('[同步WithTracking] ✅ 数据库连接成功');

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    log.info('[同步WithTracking] 正在调用Amazon API: listSpCampaigns()...');
    const apiCampaigns = await this.client.listSpCampaigns();
    log.info(`[同步WithTracking] ✅ API调用成功,返回 ${apiCampaigns.length} 个SP广告活动`);
    
    if (apiCampaigns.length === 0) {
      log.warn('[同步WithTracking] ⚠️ API返回空数组 - 没有SP广告活动');
      return result;
    }

    // v150.1: 批量预查询所有需要保护的广告活动ID
    const allExCampaignIds: number[] = [];
    for (const ac of apiCampaigns) {
      const [ex] = await db.select({ id: campaigns.id }).from(campaigns)
        .where(and(eq(campaigns.accountId, this.accountId), eq(campaigns.campaignId, String(ac.campaignId))))
        .limit(1);
      if (ex) allExCampaignIds.push(ex.id);
    }
    const protectedCampaignIds = await getRecentlyOptimizedCampaignIds(allExCampaignIds, SYNC_PROTECTION_CONFIG.BUDGET_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpCampaignsWithTracking: 批量查询完成, ${protectedCampaignIds.size}个广告活动有近期预算优化事件`);

    for (const apiCampaign of apiCampaigns) {
      const [existing] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, String(apiCampaign.campaignId))
          )
        )
        .limit(1);

      // 增量同步检查
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      // Amazon API返回的targetingType是大写的AUTO/MANUAL，需要转换为小写
      const normalizedTargetingType = (apiCampaign.targetingType || 'manual').toLowerCase() as 'auto' | 'manual';
      const campaignType = normalizedTargetingType === 'auto' ? 'sp_auto' : 'sp_manual';
      
      // v168: SP API v3的dailyBudget可能嵌套在多种结构中
      let dailyBudgetValue = 0;
      const budgetFieldT = (apiCampaign as Record<string, unknown>).budget;
      if (budgetFieldT !== undefined && budgetFieldT !== null) {
        if (typeof budgetFieldT === 'number') {
          dailyBudgetValue = budgetFieldT;
        } else if (typeof budgetFieldT === 'object') {
          dailyBudgetValue = budgetFieldT.budget || budgetFieldT.dailyBudget || budgetFieldT.amount || 0;
        }
      }
      if (dailyBudgetValue === 0 && apiCampaign.dailyBudget) {
        dailyBudgetValue = Number(apiCampaign.dailyBudget) || 0;
      }
      if (dailyBudgetValue === 0) {
        log.warn(`v168: SP广告(Tracking) ${apiCampaign.name} budget解析为0, 原始budget字段:`, JSON.stringify(budgetFieldT));
      }
      
      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: campaignType as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
        targetingType: normalizedTargetingType,
        dailyBudget: String(dailyBudgetValue),
        campaignStatus: (apiCampaign.state?.toLowerCase() || 'enabled') as 'enabled' | 'paused' | 'archived',
        placementTopSearchBidAdjustment: this.getPlacementMultiplier(apiCampaign, 'placementTop'),
        placementProductPageBidAdjustment: this.getPlacementMultiplier(apiCampaign, 'placementProductPage'),
        placementRestBidAdjustment: this.getPlacementMultiplier(apiCampaign, 'placementRestOfSearch'),
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        // 检测冲突
        const conflictCheck = detectConflict(existing, campaignData, ['dailyBudget', 'status']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: campaignData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        // 记录变更
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'updated',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            previousData: existing,
            newData: campaignData,
            changedFields: Object.keys(campaignData).filter(k => 
              (existing as Record<string, unknown>)[k] !== (campaignData as Record<string, unknown>[])[k as number]
            ),
          });
        }

        // v168: 零值预算防护
        const localBudget = parseFloat(existing.dailyBudget || '0');
        const apiBudget = parseFloat(String(campaignData.dailyBudget || '0'));
        if (apiBudget === 0 && localBudget > 0) {
          log.warn(`v168: 零值预算防护(Tracking)生效 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}`);
          delete (campaignData as Record<string, unknown>[]).dailyBudget;
        }
        // v150.1: 预算保护逻辑
        if (Math.abs(localBudget - apiBudget) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBudget > 0) {
          const hasRecentOpt = protectedCampaignIds.has(existing.id);
          if (hasRecentOpt) {
            log.debug(`v150.1: 预算保护生效(WT) - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}`);
            delete (campaignData as Record<string, unknown>[]).dailyBudget;
            protectionStats.budgetProtected++;
            protectionStats.protectedEntities.push(`camp:${existing.campaignName}`);
          } else {
            protectionStats.budgetOverwritten++;
          }
        }
        
        // v165+v423: 位置倾斜比例保护逻辑 - 如果有近期优化事件，保留本地位置倾斜值
        const localTopPlacement = existing.placementTopSearchBidAdjustment || 0;
        const apiTopPlacement = (campaignData as Record<string, unknown>[]).placementTopSearchBidAdjustment || 0;
        const localProductPlacement = existing.placementProductPageBidAdjustment || 0;
        const apiProductPlacement = (campaignData as Record<string, unknown>[]).placementProductPageBidAdjustment || 0;
        // v423: 增加restOfSearch位置保护
        const localRestPlacement = (existing as Record<string, unknown>).placementRestBidAdjustment || 0;
        const apiRestPlacement = (campaignData as Record<string, unknown>[]).placementRestBidAdjustment || 0;
        const hasPlacementDiff = localTopPlacement !== apiTopPlacement || localProductPlacement !== apiProductPlacement || localRestPlacement !== apiRestPlacement;
        if (hasPlacementDiff && protectedCampaignIds.has(existing.id)) {
          log.debug(`v165: 位置倾斜保护生效 - campaign=${existing.campaignName}, localTop=${localTopPlacement}%, apiTop=${apiTopPlacement}%, localProduct=${localProductPlacement}%, apiProduct=${apiProductPlacement}%, localRest=${localRestPlacement}%, apiRest=${apiRestPlacement}%`);
          delete (campaignData as Record<string, unknown>[]).placementTopSearchBidAdjustment;
          delete (campaignData as Record<string, unknown>[]).placementProductPageBidAdjustment;
          delete (campaignData as Record<string, unknown>[]).placementRestBidAdjustment;
          protectionStats.protectedEntities.push(`placement:${existing.campaignName}`);
        }

        await db
          .update(campaigns)
          // @ts-expect-error - Drizzle query builder type
          .set(campaignData)
          .where(eq(campaigns.id, existing.id));
        result.updated++;
      } else {
        // 记录新建
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'created',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            newData: campaignData,
          });
        }

        // @ts-expect-error - Drizzle query builder type
        await db.insert(campaigns).values({
          ...campaignData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    // 批量保存变更记录
    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    log.info('[同步WithTracking] ========== SP广告活动同步完成 ==========');
    log.info('[同步WithTracking] 结果:', result);
    logSyncProtectionSummary('syncSpCampaignsWithTracking', protectionStats);
    return result;
  } catch (error: unknown) {
    log.error('[同步WithTracking] ❌ SP广告活动同步失败');
    // @ts-expect-error - runtime type mismatch
    log.error('[同步WithTracking] 错误类型:', error.constructor?.name);
    // @ts-expect-error - error message access
    log.error('[同步WithTracking] 错误消息:', error?.message || error);
    // @ts-expect-error - error stack access
    log.error('[同步WithTracking] 错误堆栈:', error?.stack);
    // @ts-expect-error - Axios error response access
    if (error?.response) {
      // @ts-expect-error - Axios error response access
      log.error('[同步WithTracking] API响应状态:', (error as Error & { response?: unknown }).response.status);
      // @ts-expect-error - Axios error response access
      log.error('[同步WithTracking] API响应数据:', JSON.stringify((error as Error & { response?: unknown }).response.data, null, 2));
    }
    return result;
  }
};

/**
 * 同步SB广告活动（带变更跟踪）
 */
AmazonSyncService.prototype.syncSbCampaignsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    const apiCampaigns = await this.client.listSbCampaigns();

    for (const apiCampaign of apiCampaigns) {
      const [existing] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, String(apiCampaign.campaignId))
          )
        )
        .limit(1);

      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      // ✅ 根据SB广告的Campaign Goal确定计费方式
      const sbGoal = (apiCampaign as Record<string, unknown>).goal || (apiCampaign as Record<string, unknown>).campaignGoal || '';
      let sbCostType: 'cpc' | 'vcpm' | 'cpm' = 'cpc';
      if (sbGoal === 'GROW_BRAND_IMPRESSION_SHARE' || sbGoal === 'growBrandImpressionShare') {
        sbCostType = 'vcpm';
      }
      if ((apiCampaign as Record<string, unknown>).costType) {
        const apiCostType = String((apiCampaign as Record<string, unknown>).costType).toLowerCase();
        if (apiCostType === 'vcpm' || apiCostType === 'cpm') {
          sbCostType = apiCostType as 'vcpm' | 'cpm';
        }
      }

      // 获取SB广告格式
      const sbAdFormat = (apiCampaign as Record<string, unknown>).adFormat || (apiCampaign as Record<string, unknown>).creative?.adFormat || null;
      const validAdFormats = ['productCollection', 'video', 'storeSpotlight', 'brandVideo'];
      const normalizedAdFormat = validAdFormats.includes(sbAdFormat) ? sbAdFormat : null;

      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: 'sb' as const,
        targetingType: 'manual' as const,
        dailyBudget: String(apiCampaign.budget?.budget || apiCampaign.budget || 0),
        campaignStatus: ((apiCampaign.state || 'enabled').toLowerCase()) as 'enabled' | 'paused' | 'archived',
        state: ((apiCampaign.state || 'enabled').toLowerCase()) as 'enabled' | 'paused' | 'archived' | 'pending' | 'other',
        costType: sbCostType, // ✅ 根据Goal动态设置
        campaignGoal: sbGoal || null, // ✅ 存储原始Goal值
        adFormat: normalizedAdFormat, // ✅ 存储广告格式
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        const conflictCheck = detectConflict(existing, campaignData, ['dailyBudget', 'status']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: campaignData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'updated',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            previousData: existing,
            newData: campaignData,
            changedFields: Object.keys(campaignData).filter(k => 
              (existing as Record<string, unknown>)[k] !== (campaignData as Record<string, unknown>[])[k as number]
            ),
          });
        }

        await db
          .update(campaigns)
          .set(campaignData)
          .where(eq(campaigns.id, existing.id));
        result.updated++;
      } else {
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'created',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            newData: campaignData,
          });
        }

        await db.insert(campaigns).values({
          ...campaignData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    return result;
  } catch (error) {
    log.error('Error syncing SB campaigns with tracking:', error);
    return result;
  }
};

/**
 * 同步SD广告活动（带变更跟踪）
 */
AmazonSyncService.prototype.syncSdCampaignsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    const apiCampaigns = await this.client.listSdCampaigns();

    for (const apiCampaign of apiCampaigns) {
      const [existing] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, String(apiCampaign.campaignId))
          )
        )
        .limit(1);

      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      // ✅ 获取SD广告的计费类型
      const sdCostType = ((apiCampaign as Record<string, unknown>).costType || 'cpc').toLowerCase();
      const validCostTypes = ['cpc', 'vcpm', 'cpm'];
      const normalizedCostType = validCostTypes.includes(sdCostType) ? sdCostType : 'cpc';

      // ✅ 获取SD广告的Campaign Goal（广告目标）
      const sdGoal = (apiCampaign as Record<string, unknown>).goal || 
                     (apiCampaign as Record<string, unknown>).optimizationGoal || 
                     (apiCampaign as Record<string, unknown>).bidOptimization || '';

      // ✅ 获取SD广告的tactic（定向策略）
      const sdTactic = (apiCampaign as Record<string, unknown>).tactic || null;

      // ✅ 获取SD广告的竞价优化目标
      const sdBidOptimization = (apiCampaign as Record<string, unknown>).bidOptimization || null;
      const validBidOpts = ['reach', 'pageVisits', 'conversions'];
      const normalizedBidOpt = validBidOpts.includes(sdBidOptimization) ? sdBidOptimization : null;

      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: 'sd' as const,
        targetingType: 'manual' as const,
        dailyBudget: String(apiCampaign.budget?.budget || apiCampaign.budget || 0),
        campaignStatus: ((apiCampaign.state || 'enabled').toLowerCase()) as 'enabled' | 'paused' | 'archived',
        state: ((apiCampaign.state || 'enabled').toLowerCase()) as 'enabled' | 'paused' | 'archived' | 'pending' | 'other',
        costType: normalizedCostType as 'cpc' | 'vcpm' | 'cpm', // ✅ 从API获取
        campaignGoal: sdGoal || null, // ✅ 存储SD广告目标
        bidOptimization: normalizedBidOpt, // ✅ 存储竞价优化目标
        tactic: sdTactic, // ✅ 存储定向策略
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        const conflictCheck = detectConflict(existing, campaignData, ['dailyBudget', 'status']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: campaignData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'updated',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            previousData: existing,
            newData: campaignData,
            changedFields: Object.keys(campaignData).filter(k => 
              (existing as Record<string, unknown>)[k] !== (campaignData as Record<string, unknown>[])[k as number]
            ),
          });
        }

        await db
          .update(campaigns)
          .set(campaignData)
          .where(eq(campaigns.id, existing.id));
        result.updated++;
      } else {
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'created',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            newData: campaignData,
          });
        }

        await db.insert(campaigns).values({
          ...campaignData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    return result;
  } catch (error) {
    log.error('Error syncing SD campaigns with tracking:', error);
    return result;
  }
};

/**
 * 同步SP广告组（带变更跟踪）
 */
AmazonSyncService.prototype.syncSpAdGroupsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    const apiAdGroups = await this.client.listSpAdGroups();

    for (const apiAdGroup of apiAdGroups) {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, String(apiAdGroup.campaignId))
          )
        )
        .limit(1);

      if (!campaign) {
        result.skipped++;
        continue;
      }

      const [existing] = await db
        .select()
        .from(adGroups)
        .where(
          and(
            eq(adGroups.campaignId, String(campaign.campaignId)),
            eq(adGroups.adGroupId, String(apiAdGroup.adGroupId))
          )
        )
        .limit(1);

      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      // Amazon API返回的state可能是大写的ENABLED/PAUSED/ARCHIVED，需要转换为小写
      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';
      
      const adGroupData = {
        campaignId: campaign.campaignId,
        accountId: this.accountId,
        adGroupId: String(apiAdGroup.adGroupId),
        adGroupName: apiAdGroup.name,
        defaultBid: String(apiAdGroup.defaultBid || 0),
        adGroupStatus: normalizedState,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        const conflictCheck = detectConflict(existing, adGroupData, ['defaultBid', 'adGroupStatus']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'ad_group',
            entityId: String(apiAdGroup.adGroupId),
            entityName: apiAdGroup.name,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: adGroupData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'ad_group',
            changeType: 'updated',
            entityId: String(apiAdGroup.adGroupId),
            entityName: apiAdGroup.name,
            previousData: existing,
            newData: adGroupData,
            changedFields: Object.keys(adGroupData).filter(k => 
              (existing as Record<string, unknown>)[k] !== (adGroupData as Record<string, unknown>[])[k]
            ),
          });
        }

        await db
          .update(adGroups)
          .set(adGroupData)
          .where(eq(adGroups.id, existing.id));
        result.updated++;
      } else {
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'ad_group',
            changeType: 'created',
            entityId: String(apiAdGroup.adGroupId),
            entityName: apiAdGroup.name,
            newData: adGroupData,
          });
        }

        await db.insert(adGroups).values({
          ...adGroupData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    return result;
  } catch (error) {
    log.error('Error syncing SP ad groups with tracking:', error);
    return result;
  }
};

/**
 * 同步SP关键词（带变更跟踪）
 */
AmazonSyncService.prototype.syncSpKeywordsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    const apiKeywords = await this.client.listSpKeywords();

    // v150.1: 批量预查询所有需要保护的关键词ID
    const allExKwIds: number[] = [];
    for (const ak of apiKeywords) {
      const [ag] = await db.select({ id: adGroups.id }).from(adGroups)
        .where(eq(adGroups.adGroupId, String(ak.adGroupId))).limit(1);
      if (!ag) continue;
      const [ex] = await db.select({ id: keywords.id }).from(keywords)
        .where(and(eq(keywords.internalAdGroupId, ag.id), eq(keywords.keywordId, String(ak.keywordId)))).limit(1);  // v420: 修复 int类型
      if (ex) allExKwIds.push(ex.id);
    }
    const protectedKeywordIds = await getRecentlyOptimizedKeywordIds(allExKwIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpKeywordsWithTracking: 批量查询完成, ${protectedKeywordIds.size}个关键词有近期出价优化事件`);

    for (const apiKeyword of apiKeywords) {
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(apiKeyword.adGroupId)))
        .limit(1);

      if (!adGroup) {
        result.skipped++;
        continue;
      }

      const [existing] = await db
        .select()
        .from(keywords)
        .where(
          and(
            eq(keywords.internalAdGroupId, adGroup.id),  // v420: 修复 - internalAdGroupId是int类型
            eq(keywords.keywordId, String(apiKeyword.keywordId))
          )
        )
        .limit(1);

      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      // Amazon API返回的matchType和state可能是大写，需要转换为小写
      const normalizedMatchType = (apiKeyword.matchType || 'broad').toLowerCase() as 'broad' | 'phrase' | 'exact';
      const normalizedState = (apiKeyword.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';
      
      const keywordData = {
        internalAdGroupId: adGroup.id,  // v418: ID体系重构
        accountId: this.accountId,
        campaignId: adGroup.campaignId || '',  // v357
        keywordId: String(apiKeyword.keywordId),
        keywordText: apiKeyword.keywordText,
        matchType: normalizedMatchType,
        bid: String(apiKeyword.bid || 0),
        keywordStatus: normalizedState,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        const conflictCheck = detectConflict(existing, keywordData, ['bid', 'keywordStatus']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'keyword',
            entityId: String(apiKeyword.keywordId),
            entityName: apiKeyword.keywordText,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: keywordData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'keyword',
            changeType: 'updated',
            entityId: String(apiKeyword.keywordId),
            entityName: apiKeyword.keywordText,
            previousData: existing,
            newData: keywordData,
            changedFields: Object.keys(keywordData).filter(k => 
              (existing as Record<string, unknown>)[k] !== (keywordData as Record<string, unknown>[])[k]
            ),
          });
        }

        // v150.1: 出价保护逻辑
        const localBid = parseFloat(existing.bid || '0');
        const apiBid = parseFloat(String(apiKeyword.bid || '0'));
        if (Math.abs(localBid - apiBid) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBid > 0) {
          const hasRecentOpt = protectedKeywordIds.has(existing.id);
          if (hasRecentOpt) {
            log.debug(`v150.1: 出价保护生效(WT) - keyword=${existing.keywordText}, local=$${localBid}, api=$${apiBid}`);
            delete (keywordData as Record<string, unknown>[]).bid;
            protectionStats.bidProtected++;
            protectionStats.protectedEntities.push(`kw:${existing.keywordText}`);
          } else {
            protectionStats.bidOverwritten++;
          }
        }

        await db
          .update(keywords)
          .set(keywordData)
          .where(eq(keywords.id, existing.id));
        result.updated++;
      } else {
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'keyword',
            changeType: 'created',
            entityId: String(apiKeyword.keywordId),
            entityName: apiKeyword.keywordText,
            newData: keywordData,
          });
        }

        await db.insert(keywords).values({
          ...keywordData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    logSyncProtectionSummary('syncSpKeywordsWithTracking', protectionStats);
    return result;
  } catch (error) {
    log.error('Error syncing SP keywords with tracking:', error);
    return result;
  }
};

/**
 * 同步SP商品定位（带变更跟踪）
 */
AmazonSyncService.prototype.syncSpProductTargetsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    const apiTargets = await this.client.listSpProductTargets();

    // v150.1: 批量预查询所有需要保护的产品定向ID
    const allExTgtIds: number[] = [];
    for (const at of apiTargets) {
      const [ag] = await db.select({ id: adGroups.id }).from(adGroups)
        .where(eq(adGroups.adGroupId, String(at.adGroupId))).limit(1);
      if (!ag) continue;
      const [ex] = await db.select({ id: productTargets.id }).from(productTargets)
        .where(and(eq(productTargets.internalAdGroupId, ag.id), eq(productTargets.targetId, String(at.targetId)))).limit(1);  // v420: 修复 int类型
      if (ex) allExTgtIds.push(ex.id);
    }
    const protectedTargetIds = await getRecentlyOptimizedKeywordIds(allExTgtIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpProductTargetsWithTracking: 批量查询完成, ${protectedTargetIds.size}个产品定向有近期出价优化事件`);

    for (const apiTarget of apiTargets) {
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(apiTarget.adGroupId)))
        .limit(1);

      if (!adGroup) {
        result.skipped++;
        continue;
      }

      const [existing] = await db
        .select()
        .from(productTargets)
        .where(
          and(
            eq(productTargets.internalAdGroupId, adGroup.id),  // v420: 修复 - internalAdGroupId是int类型
            eq(productTargets.targetId, String(apiTarget.targetId))
          )
        )
        .limit(1);

      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      // 解析表达式获取目标类型和值
      let targetType = 'asin';
      let targetValue = '';
      if (apiTarget.expression && apiTarget.expression.length > 0) {
        const expr = apiTarget.expression[0];
        // Amazon API返回的type可能是大写，需要转换为小写
        const rawType = (expr.type || 'asin').toLowerCase();
        // 将asinSameAs等转换为asin
        targetType = rawType.includes('asin') ? 'asin' : rawType.includes('category') ? 'category' : 'asin';
        targetValue = expr.value || '';
      }
      
      // Amazon API返回的state可能是大写，需要转换为小写
      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const targetData = {
        internalAdGroupId: adGroup.id,  // v418: ID体系重构
        campaignId: adGroup.campaignId || '',  // v357
        targetId: String(apiTarget.targetId),
        targetType: targetType as 'asin' | 'category',
        targetValue,
        bid: String(apiTarget.bid || 0),
        targetStatus: normalizedState,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        const conflictCheck = detectConflict(existing, targetData, ['bid', 'targetStatus']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'product_target',
            entityId: String(apiTarget.targetId),
            entityName: targetValue,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: targetData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'product_target',
            changeType: 'updated',
            entityId: String(apiTarget.targetId),
            entityName: targetValue,
            previousData: existing,
            newData: targetData,
            changedFields: Object.keys(targetData).filter(k => 
              (existing as Record<string, unknown>)[k] !== (targetData as Record<string, unknown>[])[k]
            ),
          });
        }

        // v150.1: 出价保护逻辑
        const localBid = parseFloat(existing.bid || '0');
        const apiBid = parseFloat(String(apiTarget.bid || '0'));
        if (Math.abs(localBid - apiBid) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBid > 0) {
          const hasRecentOpt = protectedTargetIds.has(existing.id);
          if (hasRecentOpt) {
            log.debug(`v150.1: 出价保护生效(WT) - target=${existing.targetValue}, local=$${localBid}, api=$${apiBid}`);
            delete (targetData as Record<string, unknown>[]).bid;
            protectionStats.bidProtected++;
            protectionStats.protectedEntities.push(`tgt:${existing.targetValue}`);
          } else {
            protectionStats.bidOverwritten++;
          }
        }

        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
        result.updated++;
      } else {
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'product_target',
            changeType: 'created',
            entityId: String(apiTarget.targetId),
            entityName: targetValue,
            newData: targetData,
          });
        }

        await db.insert(productTargets).values({
          ...targetData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    logSyncProtectionSummary('syncSpProductTargetsWithTracking', protectionStats);
    return result;
  } catch (error) {
    log.error('Error syncing SP product targets with tracking:', error);
    return result;
  }
};


/**
 * 首次同步：获取90天历史数据
 * 仅在账户首次连接时调用，用于填充历史数据
 * 后续定时同步只需要14天归因回溯
 */
