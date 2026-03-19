/**
 * 否定关键词同步模块
 * 从 amazonSyncService.ts 拆分的独立模块
 * v426: 修复广告组过滤问题 + 消除N+1查询 + 批量insert
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

const log = createModuleLogger('negativeKeywordSync');

/**
 * v426: 预加载否定关键词同步所需的所有关联数据
 */
async function preloadNegativeKeywordMaps(db: unknown, accountId: number) {
  // 1. campaigns: amazonCampaignId -> campaign
  const allCampaigns = await db
    .select({ id: campaigns.id, campaignId: campaigns.campaignId })
    .from(campaigns)
    .where(eq(campaigns.accountId, accountId));
  const campaignMap = new Map<string, { id: number; campaignId: string }>();
  for (const c of allCampaigns) {
    campaignMap.set(String(c.campaignId), c);
  }

  // 2. adGroups: amazonAdGroupId -> adGroup
  const allAdGroups = await db
    .select({ id: adGroups.id, adGroupId: adGroups.adGroupId, campaignId: adGroups.campaignId })
    .from(adGroups)
    .where(eq(adGroups.accountId, accountId));
  const adGroupMap = new Map<string, { id: number; adGroupId: string; campaignId: string }>();
  for (const ag of allAdGroups) {
    adGroupMap.set(ag.adGroupId, ag);
  }

  // 3. existing negativeKeywords: compositeKey -> id
  const allNegatives = await db
    .select({
      id: negativeKeywords.id,
      campaignId: negativeKeywords.campaignId,
      internalAdGroupId: negativeKeywords.internalAdGroupId,
      negativeLevel: negativeKeywords.negativeLevel,
      negativeType: negativeKeywords.negativeType,
      negativeText: negativeKeywords.negativeText,
    })
    .from(negativeKeywords)
    .where(eq(negativeKeywords.accountId, accountId));

  // v426: 使用包含adGroupId的复合键，确保广告组级别的否定关键词正确匹配
  const existingMap = new Map<string, number>();
  for (const n of allNegatives) {
    const key = `${n.campaignId}|${n.internalAdGroupId || 'null'}|${n.negativeLevel}|${n.negativeType || 'keyword'}|${(n.negativeText || '').toLowerCase()}`;
    existingMap.set(key, n.id);
  }

  log.info(`v426: 否定关键词预加载完成 - campaigns=${allCampaigns.length}, adGroups=${allAdGroups.length}, existing=${allNegatives.length}`);

  return { campaignMap, adGroupMap, existingMap };
}

/**
 * 同步SP否定关键词（活动级别 + 广告组级别）
 * v426: 消除N+1查询，修复广告组过滤
 */
export async function syncSpNegativeKeywords(service: SyncContext): Promise<{ synced: number; updated: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, updated: 0 };

  try {
    let synced = 0;
    let updated = 0;

    // v426: 预加载所有关联数据
    const { campaignMap, adGroupMap, existingMap } = await preloadNegativeKeywordMaps(db, service.accountId);
    const toInsert: unknown[] = [];

    // 1. 同步活动级别否定关键词
    log.info(`开始同步SP活动级别否定关键词...`);
    const campaignNegatives = await service.client.listSpCampaignNegativeKeywords();
    log.debug(`获取到 ${campaignNegatives.length} 个活动级别否定关键词`);

    for (const neg of campaignNegatives) {
      const campaign = campaignMap.get(String(neg.campaignId));
      if (!campaign) continue;
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      const matchType = (neg.matchType || '').toLowerCase().includes('phrase')
        ? 'negative_phrase' as const
        : 'negative_exact' as const;
      const amazonKeywordId = String(neg.keywordId || neg.campaignNegativeKeywordId || '');

      // v426: 使用包含adGroupId的复合键查找
      const existingKey = `${campaign.campaignId}|null|campaign|keyword|${(neg.keywordText || '').toLowerCase()}`;
      const existingId = existingMap.get(existingKey);

      if (existingId) {
        await db.update(negativeKeywords)
          .set({ negativeMatchType: matchType, amazonNegativeKeywordId: amazonKeywordId || null, negativeStatus: 'active' as const })
          .where(eq(negativeKeywords.id, existingId));
        updated++;
      } else {
        toInsert.push({
          accountId: service.accountId,
          campaignId: String(campaign.campaignId),
          negativeLevel: 'campaign' as const,
          negativeType: 'keyword' as const,
          negativeText: neg.keywordText || '',
          negativeMatchType: matchType,
          amazonNegativeKeywordId: amazonKeywordId || null,
          negativeSource: 'manual' as const,
          negativeStatus: 'active' as const,
        });
      }
    }

    // 2. 同步广告组级别否定关键词
    log.info(`开始同步SP广告组级别否定关键词...`);
    const adGroupNegatives = await service.client.listSpNegativeKeywords();
    log.debug(`获取到 ${adGroupNegatives.length} 个广告组级别否定关键词`);

    for (const neg of adGroupNegatives) {
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;

      // v426: O(1) Map查找替代数据库查询
      const adGroup = adGroupMap.get(String(neg.adGroupId));
      if (!adGroup) continue;
      const campaign = campaignMap.get(adGroup.campaignId);
      if (!campaign) continue;

      const matchType = (neg.matchType || '').toLowerCase().includes('phrase')
        ? 'negative_phrase' as const
        : 'negative_exact' as const;
      const amazonKeywordId = String(neg.keywordId || neg.negativeKeywordId || '');

      // v426: 修复P2-3 — 使用包含internalAdGroupId的复合键，确保广告组级别正确匹配
      const existingKey = `${campaign.campaignId}|${adGroup.id}|ad_group|keyword|${(neg.keywordText || '').toLowerCase()}`;
      const existingId = existingMap.get(existingKey);

      if (existingId) {
        await db.update(negativeKeywords)
          .set({ negativeMatchType: matchType, amazonNegativeKeywordId: amazonKeywordId || null, negativeStatus: 'active' as const })
          .where(eq(negativeKeywords.id, existingId));
        updated++;
      } else {
        toInsert.push({
          accountId: service.accountId,
          campaignId: String(campaign.campaignId),
          internalAdGroupId: adGroup.id,
          negativeLevel: 'ad_group' as const,
          negativeType: 'keyword' as const,
          negativeText: neg.keywordText || '',
          negativeMatchType: matchType,
          amazonNegativeKeywordId: amazonKeywordId || null,
          negativeSource: 'manual' as const,
          negativeStatus: 'active' as const,
        });
      }
    }

    // v471: 批量insert with onDuplicateKeyUpdate to handle unique constraint conflicts
    const CHUNK_SIZE = 200;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      try {
        await db.insert(negativeKeywords).values(chunk)
          .onDuplicateKeyUpdate({ set: { negativeStatus: sql`VALUES(negativeStatus)`, negativeMatchType: sql`VALUES(negativeMatchType)` } });
        synced += chunk.length;
      } catch (err) {
        log.warn(`v471: 批量insert失败(${chunk.length}条)，回退逐条: ${(err as Error).message}`);
        for (const item of chunk) {
          try {
            await db.insert(negativeKeywords).values(item)
              .onDuplicateKeyUpdate({ set: { negativeStatus: sql`VALUES(negativeStatus)`, negativeMatchType: sql`VALUES(negativeMatchType)` } });
            synced++;
          } catch (e) {
            log.warn(`v471: 逐条insert失败: ${(e as Error).message}`);
          }
        }
      }
    }

    log.info(`v471: SP否定关键词同步完成: ${synced} 条新记录, ${updated} 条更新`);
    return { synced, updated };
  } catch (error) {
    log.error('Error syncing SP negative keywords:', error);
    return { synced: 0, updated: 0 };
  }
}


/**
 * 同步SB否定关键词
 * v426: 消除N+1查询，修复广告组过滤
 */
export async function syncSbNegativeKeywords(service: SyncContext): Promise<{ synced: number; updated: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, updated: 0 };
  try {
    let synced = 0;
    let updated = 0;

    // v426: 预加载
    const { campaignMap, adGroupMap, existingMap } = await preloadNegativeKeywordMaps(db, service.accountId);
    const toInsert: unknown[] = [];

    const sbNegatives = await service.client.listSbNegativeKeywords();
    log.debug(`获取到 ${sbNegatives.length} 个SB否定关键词`);

    for (const neg of sbNegatives) {
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;

      const campaign = campaignMap.get(String(neg.campaignId));
      if (!campaign) continue;

      let adGroupId: number | null = null;
      if (neg.adGroupId) {
        const adGroup = adGroupMap.get(String(neg.adGroupId));
        if (adGroup) adGroupId = adGroup.id;
      }

      const matchType = (neg.matchType || '').toLowerCase().includes('phrase')
        ? 'negative_phrase' as const
        : 'negative_exact' as const;
      const amazonKeywordId = String(neg.keywordId || neg.negativeKeywordId || '');
      const negLevel = adGroupId ? 'ad_group' as const : 'campaign' as const;

      // v426: 修复P2-3 — 使用包含internalAdGroupId的复合键
      const existingKey = `${campaign.campaignId}|${adGroupId || 'null'}|${negLevel}|keyword|${(neg.keywordText || '').toLowerCase()}`;
      const existingId = existingMap.get(existingKey);

      if (existingId) {
        await db.update(negativeKeywords)
          .set({ negativeMatchType: matchType, amazonNegativeKeywordId: amazonKeywordId || null, negativeStatus: 'active' as const })
          .where(eq(negativeKeywords.id, existingId));
        updated++;
      } else {
        toInsert.push({
          accountId: service.accountId,
          campaignId: String(campaign.campaignId),
          internalAdGroupId: adGroupId,
          negativeLevel: negLevel,
          negativeType: 'keyword' as const,
          negativeText: neg.keywordText || '',
          negativeMatchType: matchType,
          amazonNegativeKeywordId: amazonKeywordId || null,
          negativeSource: 'manual' as const,
          negativeStatus: 'active' as const,
        });
      }
    }

    // v471: 批量insert with onDuplicateKeyUpdate
    const CHUNK_SIZE = 200;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      try {
        await db.insert(negativeKeywords).values(chunk)
          .onDuplicateKeyUpdate({ set: { negativeStatus: sql`VALUES(negativeStatus)`, negativeMatchType: sql`VALUES(negativeMatchType)` } });
        synced += chunk.length;
      } catch (err) {
        for (const item of chunk) {
          try {
            await db.insert(negativeKeywords).values(item)
              .onDuplicateKeyUpdate({ set: { negativeStatus: sql`VALUES(negativeStatus)`, negativeMatchType: sql`VALUES(negativeMatchType)` } });
            synced++;
          } catch (e) { /* skip */ }
        }
      }
    }

    log.info(`v471: SB否定关键词同步完成: ${synced}条新增, ${updated}条更新`);
    return { synced, updated };
  } catch (error: unknown) {
    log.error('SB否定关键词同步失败:', (error as Error).message);
    return { synced: 0, updated: 0 };
  }
}


/**
 * 同步SB否定商品定向
 * v426: 消除N+1查询
 */
export async function syncSbNegativeTargets(service: SyncContext): Promise<{ synced: number; updated: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, updated: 0 };
  try {
    let synced = 0;
    let updated = 0;

    // v426: 预加载
    const { campaignMap, adGroupMap, existingMap } = await preloadNegativeKeywordMaps(db, service.accountId);
    const toInsert: unknown[] = [];

    const sbNegTargets = await service.client.listSbNegativeTargets();
    log.debug(`获取到 ${sbNegTargets.length} 个SB否定商品定向`);

    for (const neg of sbNegTargets) {
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;

      const campaign = campaignMap.get(String(neg.campaignId));
      if (!campaign) continue;

      let adGroupId: number | null = null;
      if (neg.adGroupId) {
        const adGroup = adGroupMap.get(String(neg.adGroupId));
        if (adGroup) adGroupId = adGroup.id;
      }

      const expression = neg.expression || [];
      const asinExpr = expression.find((e: Record<string, unknown>) => e.type?.toLowerCase().includes('asin'));
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const negLevel = adGroupId ? 'ad_group' as const : 'campaign' as const;

      // v426: 修复P2-3 — 使用包含internalAdGroupId的复合键
      const existingKey = `${campaign.campaignId}|${adGroupId || 'null'}|${negLevel}|product|${negativeText.toLowerCase()}`;
      const existingId = existingMap.get(existingKey);

      if (existingId) {
        await db.update(negativeKeywords)
          .set({ amazonNegativeKeywordId: amazonTargetId || null, negativeStatus: 'active' as const })
          .where(eq(negativeKeywords.id, existingId));
        updated++;
      } else {
        toInsert.push({
          accountId: service.accountId,
          campaignId: String(campaign.campaignId),
          internalAdGroupId: adGroupId,
          negativeLevel: negLevel,
          negativeType: 'product' as const,
          negativeText: negativeText,
          negativeMatchType: 'negative_exact' as const,
          amazonNegativeKeywordId: amazonTargetId || null,
          negativeSource: 'manual' as const,
          negativeStatus: 'active' as const,
        });
      }
    }

    // v471: 批量insert with onDuplicateKeyUpdate
    const CHUNK_SIZE = 200;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      try {
        await db.insert(negativeKeywords).values(chunk)
          .onDuplicateKeyUpdate({ set: { negativeStatus: sql`VALUES(negativeStatus)`, negativeMatchType: sql`VALUES(negativeMatchType)` } });
        synced += chunk.length;
      } catch (err) {
        for (const item of chunk) {
          try {
            await db.insert(negativeKeywords).values(item)
              .onDuplicateKeyUpdate({ set: { negativeStatus: sql`VALUES(negativeStatus)`, negativeMatchType: sql`VALUES(negativeMatchType)` } });
            synced++;
          } catch (e) { /* skip */ }
        }
      }
    }

    log.info(`v471: SB否定商品定向同步完成: ${synced}条新增, ${updated}条更新`);
    return { synced, updated };
  } catch (error: unknown) {
    log.error('SB否定商品定向同步失败:', (error as Error).message);
    return { synced: 0, updated: 0 };
  }
}
