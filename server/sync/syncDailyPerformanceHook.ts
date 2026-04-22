/**
 * v717: 每日绩效数据同步钩子
 * 
 * 在现有的syncKeywordPerformanceData完成后调用，
 * 将当天的keyword/target绩效数据写入keyword_daily_performance表。
 * 
 * 这个钩子不改变现有的同步逻辑，只是在同步完成后额外写入每日明细数据。
 */

import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db';
import { sql, eq, and } from 'drizzle-orm';
import { keywordDailyPerformance, keywords, productTargets } from '../../drizzle/schema';

const log = createModuleLogger('SyncDailyPerfHook');

/**
 * 在keyword绩效同步完成后，将当天的数据快照写入keyword_daily_performance表
 * 
 * 由于Amazon报告返回的是SUMMARY模式（时间范围内的汇总），
 * 我们需要通过"今天的汇总 - 昨天的汇总"来推算每日增量。
 * 
 * 但更简单的方案是：直接请求DAILY模式的报告（1天范围），
 * 这样每天的数据就是独立的。
 * 
 * 本钩子在每次全量同步时被调用，写入当天的快照。
 */
export async function syncDailyPerformanceSnapshot(
  accountId: number,
  marketplace: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  try {
    const today = new Date();
    // 写入前天的数据（考虑归因延迟，最近2天的数据不稳定）
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() - 2);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    log.info(`[v717] 开始写入账户${accountId}的每日绩效快照: ${dateStr}`);
    
    // 从keywords表读取当前汇总数据，写入每日快照
    // 注意：这是一个简化方案，理想情况下应该从DAILY报告中获取
    // 但作为第一步，我们先用当前汇总数据建立基线
    const enabledKeywords = await db
      .select({
        id: keywords.id,
        accountId: keywords.accountId,
        campaignId: keywords.campaignId,
        internalAdGroupId: keywords.internalAdGroupId,
        impressions: keywords.impressions,
        clicks: keywords.clicks,
        spend: keywords.spend,
        sales: keywords.sales,
        orders: keywords.orders,
      })
      .from(keywords)
      .where(and(
        eq(keywords.accountId, accountId),
        eq(keywords.keywordStatus, 'enabled')
      ));
    
    const enabledTargets = await db
      .select({
        id: productTargets.id,
        accountId: productTargets.accountId,
        campaignId: productTargets.campaignId,
        internalAdGroupId: productTargets.internalAdGroupId,
        impressions: productTargets.impressions,
        clicks: productTargets.clicks,
        spend: productTargets.spend,
        sales: productTargets.sales,
        orders: productTargets.orders,
      })
      .from(productTargets)
      .where(and(
        eq(productTargets.accountId, accountId),
        eq(productTargets.targetStatus, 'enabled')
      ));
    
    let written = 0;
    
    // 写入keyword每日快照
    for (const kw of enabledKeywords) {
      try {
        const clicks = kw.clicks || 0;
        const impressions = kw.impressions || 0;
        const spend = parseFloat(kw.spend || '0');
        const sales = parseFloat(kw.sales || '0');
        const orders = kw.orders || 0;
        
        // 跳过完全没有数据的keyword
        if (impressions === 0 && clicks === 0 && spend === 0) continue;
        
        await db.insert(keywordDailyPerformance)
          .values({
            accountId: kw.accountId,
            campaignId: kw.campaignId,
            internalAdGroupId: kw.internalAdGroupId ? Number(kw.internalAdGroupId) : null,
            keywordId: kw.id,
            targetId: null,
            entityType: 'keyword',
            date: dateStr,
            impressions,
            clicks,
            spend: String(spend.toFixed(4)),
            sales: String(sales.toFixed(2)),
            orders,
            unitsSold: 0,
            cpc: clicks > 0 ? String((spend / clicks).toFixed(4)) : null,
            acos: sales > 0 ? String((spend / sales).toFixed(4)) : null,
            roas: spend > 0 ? String((sales / spend).toFixed(2)) : null,
            ctr: impressions > 0 ? String((clicks / impressions).toFixed(6)) : null,
            cvr: clicks > 0 ? String((orders / clicks).toFixed(6)) : null,
            dataSource: 'calculated',
          })
          .onDuplicateKeyUpdate({
            set: {
              impressions,
              clicks,
              spend: String(spend.toFixed(4)),
              sales: String(sales.toFixed(2)),
              orders,
              cpc: clicks > 0 ? String((spend / clicks).toFixed(4)) : null,
              acos: sales > 0 ? String((spend / sales).toFixed(4)) : null,
              roas: spend > 0 ? String((sales / spend).toFixed(2)) : null,
              ctr: impressions > 0 ? String((clicks / impressions).toFixed(6)) : null,
              cvr: clicks > 0 ? String((orders / clicks).toFixed(6)) : null,
              updatedAt: sql`CURRENT_TIMESTAMP`,
            }
          });
        written++;
      } catch (_: unknown) { /* 单条写入失败不影响整体 */ }
    }
    
    // 写入product_target每日快照
    for (const pt of enabledTargets) {
      try {
        const clicks = pt.clicks || 0;
        const impressions = pt.impressions || 0;
        const spend = parseFloat(pt.spend || '0');
        const sales = parseFloat(pt.sales || '0');
        const orders = pt.orders || 0;
        
        if (impressions === 0 && clicks === 0 && spend === 0) continue;
        
        await db.insert(keywordDailyPerformance)
          .values({
            accountId: pt.accountId,
            campaignId: pt.campaignId,
            internalAdGroupId: pt.internalAdGroupId ? Number(pt.internalAdGroupId) : null,
            keywordId: null,
            targetId: pt.id,
            entityType: 'product_target',
            date: dateStr,
            impressions,
            clicks,
            spend: String(spend.toFixed(4)),
            sales: String(sales.toFixed(2)),
            orders,
            unitsSold: 0,
            cpc: clicks > 0 ? String((spend / clicks).toFixed(4)) : null,
            acos: sales > 0 ? String((spend / sales).toFixed(4)) : null,
            roas: spend > 0 ? String((sales / spend).toFixed(2)) : null,
            ctr: impressions > 0 ? String((clicks / impressions).toFixed(6)) : null,
            cvr: clicks > 0 ? String((orders / clicks).toFixed(6)) : null,
            dataSource: 'calculated',
          })
          .onDuplicateKeyUpdate({
            set: {
              impressions,
              clicks,
              spend: String(spend.toFixed(4)),
              sales: String(sales.toFixed(2)),
              orders,
              cpc: clicks > 0 ? String((spend / clicks).toFixed(4)) : null,
              acos: sales > 0 ? String((spend / sales).toFixed(4)) : null,
              roas: spend > 0 ? String((sales / spend).toFixed(2)) : null,
              ctr: impressions > 0 ? String((clicks / impressions).toFixed(6)) : null,
              cvr: clicks > 0 ? String((orders / clicks).toFixed(6)) : null,
              updatedAt: sql`CURRENT_TIMESTAMP`,
            }
          });
        written++;
      } catch (_: unknown) { /* 单条写入失败不影响整体 */ }
    }
    
    log.info(`[v717] 账户${accountId}每日绩效快照写入完成: ${written}条 (${enabledKeywords.length}个keyword + ${enabledTargets.length}个target)`);
    return written;
    
  } catch (err: unknown) {
    log.warn(`[v717] 每日绩效快照写入异常: ${(err as Error).message}`);
    return 0;
  }
}
