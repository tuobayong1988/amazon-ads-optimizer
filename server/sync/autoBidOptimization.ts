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
    .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
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
    const { batchCalculateNextGenBids } = await import('../nextGenBidOrchestrator');
    // @ts-ignore
    const { buildContextFeatures } = await import('../contextualFeatureService') as unknown;
    
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
    // @ts-ignore
    const nextGenResults = await batchCalculateNextGenBids(accountId, batchItems as unknown, context);
    
    for (const ngResult of nextGenResults) {
      // @ts-ignore
      if ((ngResult as Record<string, any>[]).action === 'hold') {
        results.skipped++;
        continue;
      }
      
      // @ts-ignore
      const kw = keywordsToOptimize.find(k => k.id === (ngResult as Record<string, any>[]).keywordId);
      if (!kw) { results.skipped++; continue; }
      
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.id, Number(kw.adGroupId)))  // v357: adGroupId现在是string类型
        .limit(1);

      if (adGroup) {
        const success = await syncService.applyBidAdjustment(
          'keyword',
          kw.id,
          ngResult.newBid,
          // @ts-ignore
          `NextGen[${(ngResult as Record<string, any>[]).algorithm}]: ${ngResult.reason}`,
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
  for (const kw of (keywordsToOptimize as any[])) {
    const target: OptimizationTarget = {
      id: kw.id,
      type: 'keyword',
      currentBid: parseFloat(kw.bid),
      impressions: kw.impressions || 0,
      clicks: kw.clicks || 0,
      spend: parseFloat(kw.spend || '0'),
      sales: parseFloat(kw.sales || '0'),
      orders: kw.orders || 0,
      matchType: kw.matchType,
    };

    const adjustment = calculateBidAdjustment(target, performanceGroupConfig, 10, 0.02);

    if (adjustment) {
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.id, Number(kw.adGroupId)))  // v357: adGroupId现在是string类型
        .limit(1);

      if (adGroup) {
        const success = await syncService.applyBidAdjustment(
          'keyword',
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
