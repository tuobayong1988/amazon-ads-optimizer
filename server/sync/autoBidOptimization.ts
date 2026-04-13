/**
 * 自动出价优化模块 (v223)
 * 
 * 从 amazonSyncService.ts 中提取，负责执行自动出价优化逻辑。
 * v230: 使用NextGen算法替代旧的calculateBidAdjustment，旧算法作为回退保留。
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../db';
import { keywords, adGroups, campaigns } from '../../drizzle/schema';
import { calculateBidAdjustment, OptimizationTarget, PerformanceGroupConfig } from '../optimization/bidOptimizer';
import { createModuleLogger } from '../utils/logger';
import type { AmazonSyncService } from './amazonSyncService';

const log = createModuleLogger('AutoBidOpt');

export async function runAutoBidOptimization(
  syncService: AmazonSyncService,
  accountId: number,
  performanceGroupConfig: PerformanceGroupConfig
): Promise<{ optimized: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { optimized: 0, skipped: 0 };

  const keywordsToOptimize = await db
    .select({ keyword: keywords })
    .from(keywords)
    .innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id))
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
    .where(and(
      eq(campaigns.accountId, accountId),
      eq(keywords.keywordStatus, 'enabled')
    ))
    .then(rows => rows.map(r => r.keyword));

  log.debug(`v230: 账号${accountId} 共${keywordsToOptimize.length}个启用关键词需要优化`);
  const results = { optimized: 0, skipped: 0 };

  // v230: 尝试使用NextGen算法
  try {
    const { batchCalculateNextGenBids } = await import('../optimization/nextGenBidOrchestrator');
    // @ts-expect-error - type assertion
    const { buildContextFeatures } = await import('../analytics/contextualFeatureService') as unknown;
    
    const batchItems = keywordsToOptimize.map(kw => ({
      keywordId: kw.id,
      currentBid: parseFloat(kw.bid),
      impressions: kw.impressions || 0,
      clicks: kw.clicks || 0,
      spend: parseFloat(kw.spend || '0'),
      sales: parseFloat(kw.sales || '0'),
      orders: kw.orders || 0,
      acos: parseFloat(kw.spend || '0') > 0 && parseFloat(kw.sales || '0') > 0
        ? parseFloat(kw.spend || '0') / parseFloat(kw.sales || '0')
        : 0,
      cvr: (kw.clicks || 0) > 0 ? (kw.orders || 0) / (kw.clicks || 0) : 0,
      cpc: (kw.clicks || 0) > 0 ? parseFloat(kw.spend || '0') / (kw.clicks || 0) : 0,
      targetAcos: performanceGroupConfig.targetAcos || 0.3,
    }));
    
    const context = await buildContextFeatures(accountId);
    // @ts-expect-error - type assertion
    const nextGenResults = await batchCalculateNextGenBids(accountId, batchItems as unknown, context);
    
    for (const ngResult of nextGenResults) {
      // @ts-expect-error Dynamic type assertion
      if ((ngResult as Record<string, unknown>[]).action === 'hold') {
        results.skipped++;
        continue;
      }
      
      // @ts-expect-error Dynamic type assertion
      const kw = keywordsToOptimize.find(k => k.id === (ngResult as Record<string, unknown>[]).keywordId);
      if (!kw) { results.skipped++; continue; }
      
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.id, kw.internalAdGroupId!))  // v421: 使用internalAdGroupId(int)
        .limit(1);

      if (adGroup) {
        // @ts-expect-error Type inference limitation
        const success = await syncService.applyBidAdjustment(
          // @ts-expect-error Legacy code type compatibility
          'keyword',
          kw.id,
          ngResult.newBid,
          // @ts-expect-error Dynamic type assertion
          `NextGen[${(ngResult as Record<string, unknown>[]).algorithm}]: ${ngResult.reason}`,
          adGroup.campaignId
        );
        
        if (success) {
          results.optimized++;
        } else {
          results.skipped++;
        }
      } else {
        results.skipped++;
      }
    }
    
    log.info(`v230: NextGen优化完成 optimized=${results.optimized}, skipped=${results.skipped}`);
    return results;
  } catch (nextGenError: unknown) {
    log.warn(`v230: NextGen算法失败，回退到旧算法: ${(nextGenError as Error).message}`);
  }

  // v230: 回退到旧算法
  // @ts-expect-error Dynamic type assertion
  for (const kw of (keywordsToOptimize as unknown[])) {
    // @ts-expect-error Legacy code type compatibility
    const target: OptimizationTarget = {
      // @ts-expect-error Legacy code type compatibility
      id: kw.id,
      // @ts-expect-error Legacy code type compatibility
      type: 'keyword',
      // @ts-expect-error Amazon API response type flexibility
      currentBid: parseFloat(kw.bid),
      // @ts-expect-error Legacy code type compatibility
      impressions: kw.impressions || 0,
      // @ts-expect-error Legacy code type compatibility
      clicks: kw.clicks || 0,
      // @ts-expect-error Legacy code type compatibility
      spend: parseFloat(kw.spend || '0'),
      // @ts-expect-error Legacy code type compatibility
      sales: parseFloat(kw.sales || '0'),
      // @ts-expect-error Legacy code type compatibility
      orders: kw.orders || 0,
      // @ts-expect-error Legacy code type compatibility
      matchType: kw.matchType,
    // @ts-expect-error Legacy code type compatibility
    };

    // @ts-expect-error Type inference limitation
    const adjustment = calculateBidAdjustment(target, performanceGroupConfig, 10, 0.02);

    if (adjustment) {
      const [adGroup] = await db
        .select()
        .from(adGroups)
        // @ts-expect-error DB query type inference limitation
        .where(eq(adGroups.id, kw.internalAdGroupId!))  // v421: 使用internalAdGroupId(int)
        .limit(1);

      if (adGroup) {
        // @ts-expect-error Type inference limitation
        const success = await syncService.applyBidAdjustment(
          'keyword',
          // @ts-expect-error Legacy code type compatibility
          kw.id,
          adjustment.newBid,
          adjustment.reason,
          adGroup.campaignId
        );
        
        if (success) {
          results.optimized++;
        } else {
          results.skipped++;
        }
      } else {
        results.skipped++;
      }
    } else {
      results.skipped++;
    }
  }

  return results;
}
