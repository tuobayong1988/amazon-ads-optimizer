/**
 * SB广告同步模块
 * 
 * 职责：
 * - syncSbAds: 同步SB广告素材（品牌广告的创意素材详情）
 * - syncAssetUrls: 解析SB广告组中的素材ID为实际URL
 * 
 * v417: 清理重复代码
 * - WithTracking方法已统一到 syncWithTracking.ts
 * - runAutoBidOptimization已独立到 autoBidOptimization.ts
 * - syncInitialHistoricalData已在 amazonSyncService.ts 中
 * - detectConflict已在 syncHelpers.ts 中
 */
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  campaigns,
  adGroups,
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

const log = createModuleLogger('sbAdsSync');

/**
 * 同步SB广告素材（品牌广告的创意素材详情）
 * 包含: headline, brandLogo, customImage, video, brandName等
 * 写入ad_groups表的creative字段
 */
export async function syncSbAds(service: SyncContext,): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };
  try {
    const apiAds = await service.client.listSbAds();
    let synced = 0;
    let skipped = 0;
    log.debug(`获取到 ${apiAds.length} 个SB广告素材`);
    
    // 调试：输出第一个广告素材的完整结构
    if (apiAds.length > 0) {
      log.debug('SB广告素材API返回结构示例:', JSON.stringify(apiAds[0], null, 2));
    }
    
    for (const ad of apiAds) {
      // 查找对应的广告组
      const adGroupIdStr = String(ad.adGroupId);
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, adGroupIdStr))
        .limit(1);
      
      if (!adGroup) {
        skipped++;
        continue;
      }
      
      // 提取素材信息
      const creative = ad.creative || ad;
      const headline = creative.headline || ad.headline || null;
      const brandLogoAssetId = creative.brandLogoAssetID || creative.brandLogoAssetId || 
                              creative.brandLogo?.assetId || null;
      const customImageAssetId = creative.customImageAssetID || creative.customImageAssetId || 
                                creative.customImage?.assetId || null;
      const videoAssetId = creative.video?.assetId || creative.videoAssetId || null;
      const creativeType = ad.creativeType || creative.type || null;
      
      // 更新广告组的素材字段
      const updateData: Record<string, any> = {
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (headline) updateData.headline = headline;
      if (brandLogoAssetId) updateData.brandLogoAssetId = brandLogoAssetId;
      if (customImageAssetId) updateData.customImageAssetId = customImageAssetId;
      if (videoAssetId) updateData.videoAssetId = videoAssetId;
      if (creativeType) updateData.creativeType = creativeType;
      
      await db.update(adGroups)
        .set(updateData)
        .where(eq(adGroups.id, adGroup.id));
      synced++;
    }
    
    log.info(`SB广告素材同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error: unknown) {
    log.error('SB广告素材同步失败:', (error as Error).message);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 解析SB广告组中的素材ID为实际URL
 * 查找所有有assetId但没有对应URL的广告组，调用Creative Asset Library API解析
 */
export async function syncAssetUrls(service: SyncContext,): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    // 查找所有有素材ID但没有URL的SB广告组
    const adGroupsNeedingUrls = await db
      .select()
      .from(adGroups)
      .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
      .where(
        and(
          eq(campaigns.accountId, service.accountId),
          sql`(${adGroups.videoAssetId} IS NOT NULL AND ${adGroups.videoAssetId} != '' AND (${adGroups.videoUrl} IS NULL OR ${adGroups.videoUrl} = ''))
            OR (${adGroups.brandLogoAssetId} IS NOT NULL AND ${adGroups.brandLogoAssetId} != '' AND (${adGroups.brandLogoUrl} IS NULL OR ${adGroups.brandLogoUrl} = ''))
            OR (${adGroups.customImageAssetId} IS NOT NULL AND ${adGroups.customImageAssetId} != '' AND (${adGroups.customImageUrl} IS NULL OR ${adGroups.customImageUrl} = ''))`
        )
      );

    if (adGroupsNeedingUrls.length === 0) {
      log.debug('所有SB广告组的素材URL已是最新');
      return 0;
    }

    log.debug(`找到 ${adGroupsNeedingUrls.length} 个需要解析素材URL的广告组`);

    // 收集所有需要解析的assetId
    const assetIdsToResolve = new Set<string>();
    for (const row of (adGroupsNeedingUrls as any[])) {
      if (row.ad_groups.videoAssetId && !row.ad_groups.videoUrl) {
        assetIdsToResolve.add(row.ad_groups.videoAssetId);
      }
      if (row.ad_groups.brandLogoAssetId && !row.ad_groups.brandLogoUrl) {
        assetIdsToResolve.add(row.ad_groups.brandLogoAssetId);
      }
      if (row.ad_groups.customImageAssetId && !row.ad_groups.customImageUrl) {
        assetIdsToResolve.add(row.ad_groups.customImageAssetId);
      }
    }

    log.debug(`需要解析 ${assetIdsToResolve.size} 个唯一素材ID`);

    // 批量解析素材URL
    const resolvedUrls = await service.client.resolveAssetUrls(Array.from(assetIdsToResolve));
    log.info(`成功解析 ${resolvedUrls.size} 个素材URL`);

    // 更新数据库
    let updated = 0;
    for (const row of (adGroupsNeedingUrls as any[])) {
      const updates: Record<string, any> = {};
      let needsUpdate = false;

      if (row.ad_groups.videoAssetId && !row.ad_groups.videoUrl) {
        const resolved = resolvedUrls.get(row.ad_groups.videoAssetId);
        if (resolved) {
          updates.videoUrl = resolved.url;
          if (resolved.thumbnailUrl) {
            updates.videoThumbnailUrl = resolved.thumbnailUrl;
          }
          needsUpdate = true;
        }
      }

      if (row.ad_groups.brandLogoAssetId && !row.ad_groups.brandLogoUrl) {
        const resolved = resolvedUrls.get(row.ad_groups.brandLogoAssetId);
        if (resolved) {
          updates.brandLogoUrl = resolved.url;
          needsUpdate = true;
        }
      }

      if (row.ad_groups.customImageAssetId && !row.ad_groups.customImageUrl) {
        const resolved = resolvedUrls.get(row.ad_groups.customImageAssetId);
        if (resolved) {
          updates.customImageUrl = resolved.url;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        await db
          .update(adGroups)
          .set(updates)
          .where(eq(adGroups.id, row.ad_groups.id));
        updated++;
      }
    }

    return updated;
  } catch (error: unknown) {
    log.error('syncAssetUrls失败:', (error as Error).message);
    throw error;
  }
}
