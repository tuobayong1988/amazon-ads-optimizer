/**
 * Amazon Ads Optimizer — EntityIdResolver Database Provider (v418)
 * 
 * EntityIdResolver的数据库查询实现层。
 * 通过依赖注入模式与EntityIdResolver解耦，避免循环依赖。
 */

import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { campaigns, adGroups, keywords, productTargets } from '../../drizzle/schema';
import type { DbQueryProvider } from './entityIdResolver';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('EntityIdResolverDb');

/**
 * 创建EntityIdResolver的数据库查询提供者
 */
export function createEntityIdResolverDbProvider(): DbQueryProvider {
  return {
    async getCampaignByInternalId(id: number) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: campaigns.id,
        campaignId: campaigns.campaignId,
        campaignName: campaigns.campaignName,
      }).from(campaigns).where(eq(campaigns.id, id)).limit(1);
      return results[0] || null;
    },

    async getCampaignByAmazonId(amazonId: string) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: campaigns.id,
        campaignId: campaigns.campaignId,
        campaignName: campaigns.campaignName,
      }).from(campaigns).where(eq(campaigns.campaignId, amazonId)).limit(1);
      return results[0] || null;
    },

    async getAdGroupByInternalId(id: number) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: adGroups.id,
        adGroupId: adGroups.adGroupId,
        campaignId: adGroups.campaignId,
      }).from(adGroups).where(eq(adGroups.id, id)).limit(1);
      return results[0] || null;
    },

    async getAdGroupByAmazonId(amazonId: string) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: adGroups.id,
        adGroupId: adGroups.adGroupId,
        campaignId: adGroups.campaignId,
      }).from(adGroups).where(eq(adGroups.adGroupId, amazonId)).limit(1);
      return results[0] || null;
    },

    // @ts-ignore Complex function parameter types
    async getKeywordByInternalId(id: number) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: keywords.id,
        keywordId: keywords.keywordId,
        internalAdGroupId: keywords.internalAdGroupId,
      }).from(keywords).where(eq(keywords.id, id)).limit(1);
      return results[0] || null;
    },

    // @ts-ignore Complex function parameter types
    async getProductTargetByInternalId(id: number) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: productTargets.id,
        targetId: productTargets.targetId,
        internalAdGroupId: productTargets.internalAdGroupId,
      }).from(productTargets).where(eq(productTargets.id, id)).limit(1);
      return results[0] || null;
    // @ts-ignore Legacy code type compatibility
    },

    // @ts-ignore Complex function parameter types
    async getKeywordsByInternalIds(ids: number[]) {
      if (ids.length === 0) return [];
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: keywords.id,
        keywordId: keywords.keywordId,
        internalAdGroupId: keywords.internalAdGroupId,
      // @ts-ignore DB query type inference limitation
      }).from(keywords).where(inArray(keywords.id, ids));
    },

    // @ts-ignore Complex function parameter types
    async getProductTargetsByInternalIds(ids: number[]) {
      if (ids.length === 0) return [];
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: productTargets.id,
        targetId: productTargets.targetId,
        internalAdGroupId: productTargets.internalAdGroupId,
      }).from(productTargets).where(inArray(productTargets.id, ids));
    },
  };
}
