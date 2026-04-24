/**
 * v733: 每日绩效数据同步钩子（重写）
 * 
 * 修复问题1.1: keyword_daily_performance 分日数据不完整
 * 
 * 旧版问题：
 *   从 keywords/productTargets 表读取汇总数据写入快照，
 *   dataSource='calculated'，数据不是真正的分日数据。
 * 
 * 新版方案：
 *   1. 请求 SP Targeting DAILY 报告（timeUnit: 'DAILY'）
 *   2. 将报告中的真实分日数据写入 keyword_daily_performance 表
 *   3. 通过 keywordId/targetId 匹配本地实体
 *   4. dataSource='api_report'
 */
import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db';
import { sql, eq, and } from 'drizzle-orm';
import { keywordDailyPerformance, keywords, productTargets } from '../../drizzle/schema';

const log = createModuleLogger('SyncDailyPerfHook');

export async function syncDailyPerformanceSnapshot(
  accountId: number,
  marketplace: string,
  options?: {
    syncService?: any;
    daysBack?: number;
    skipRecentDays?: number;
  }
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const daysBack = options?.daysBack || 7;
  const skipRecentDays = options?.skipRecentDays || 2;
  const syncService = options?.syncService;
  
  try {
    log.info(`[v733] 开始同步账户${accountId}的DAILY绩效数据: 回溯${daysBack}天，跳过最近${skipRecentDays}天`);
    
    if (!syncService || !syncService.client) {
      log.info(`[v733] 未传入syncService，回退到快照模式`);
      return await fallbackSnapshotMode(db, accountId);
    }
    
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - skipRecentDays);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - daysBack + 1);
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    log.info(`[v733] 请求DAILY报告: ${startDateStr} ~ ${endDateStr}`);
    
    let reportData: any[] = [];
    try {
      const reportId = await syncService.client.requestSpTargetingDailyReport(startDateStr, endDateStr);
      const data = await syncService.client.waitAndDownloadReport(reportId, 600000);
      if (data && data.length > 0) {
        reportData = data;
      }
    } catch (e: any) {
      log.warn(`[v733] DAILY报告请求失败: ${e.message}，回退到快照模式`);
      return await fallbackSnapshotMode(db, accountId);
    }
    
    if (reportData.length === 0) {
      log.info(`[v733] DAILY报告数据为空，跳过`);
      return 0;
    }
    
    log.info(`[v733] 获取到${reportData.length}条DAILY报告数据，开始匹配本地实体`);
    
    // 预加载本地实体索引
    const allKeywords = await db.select({
      id: keywords.id, keywordId: keywords.keywordId,
      accountId: keywords.accountId, campaignId: keywords.campaignId,
      internalAdGroupId: keywords.internalAdGroupId,
    }).from(keywords).where(eq(keywords.accountId, accountId));
    
    const allTargets = await db.select({
      id: productTargets.id, targetId: productTargets.targetId,
      accountId: productTargets.accountId, campaignId: productTargets.campaignId,
      internalAdGroupId: productTargets.internalAdGroupId,
    }).from(productTargets).where(eq(productTargets.accountId, accountId));
    
    const kwByAmazonId = new Map<string, typeof allKeywords[0]>();
    for (const kw of allKeywords) {
      if (kw.keywordId) kwByAmazonId.set(kw.keywordId, kw);
    }
    
    const ptByAmazonId = new Map<string, typeof allTargets[0]>();
    for (const pt of allTargets) {
      if (pt.targetId) ptByAmazonId.set(pt.targetId, pt);
    }
    
    let written = 0;
    let matched = 0;
    let unmatched = 0;
    
    for (const row of reportData) {
      const reportKeywordId = String(row.keywordId || '');
      const dateStr = row.date || '';
      if (!reportKeywordId || !dateStr) continue;
      
      const cost = parseFloat(row.cost || '0');
      const sales = parseFloat(row.sales7d || row.sales14d || '0');
      const orders = parseInt(row.purchases7d || row.purchases14d || '0', 10);
      const impressions = parseInt(row.impressions || '0', 10);
      const clicks = parseInt(row.clicks || '0', 10);
      const unitsSold = parseInt(row.unitsSoldClicks7d || row.unitsSoldClicks14d || '0', 10);
      
      if (impressions === 0 && clicks === 0 && cost === 0) continue;
      
      const kw = kwByAmazonId.get(reportKeywordId);
      const pt = !kw ? ptByAmazonId.get(reportKeywordId) : null;
      
      if (!kw && !pt) { unmatched++; continue; }
      matched++;
      
      const entity = kw || pt!;
      const entityType = kw ? 'keyword' : 'product_target';
      
      try {
        await db.insert(keywordDailyPerformance).values({
          accountId: entity.accountId,
          campaignId: entity.campaignId,
          internalAdGroupId: entity.internalAdGroupId ? Number(entity.internalAdGroupId) : null,
          keywordId: kw ? kw.id : null,
          targetId: pt ? pt.id : null,
          entityType,
          date: dateStr,
          impressions, clicks,
          spend: cost.toFixed(4),
          sales: sales.toFixed(2),
          orders, unitsSold,
          cpc: clicks > 0 ? (cost / clicks).toFixed(4) : null,
          acos: sales > 0 ? (cost / sales).toFixed(4) : null,
          roas: cost > 0 ? (sales / cost).toFixed(2) : null,
          ctr: impressions > 0 ? (clicks / impressions).toFixed(6) : null,
          cvr: clicks > 0 ? (orders / clicks).toFixed(6) : null,
          dataSource: 'api_report',
        }).onDuplicateKeyUpdate({
          set: {
            impressions, clicks,
            spend: cost.toFixed(4), sales: sales.toFixed(2),
            orders, unitsSold,
            cpc: clicks > 0 ? (cost / clicks).toFixed(4) : null,
            acos: sales > 0 ? (cost / sales).toFixed(4) : null,
            roas: cost > 0 ? (sales / cost).toFixed(2) : null,
            ctr: impressions > 0 ? (clicks / impressions).toFixed(6) : null,
            cvr: clicks > 0 ? (orders / clicks).toFixed(6) : null,
            dataSource: 'api_report',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          }
        });
        written++;
      } catch (_: unknown) { /* skip */ }
    }
    
    log.info(`[v733] 账户${accountId} DAILY绩效写入完成: ${written}条写入, ${matched}条匹配, ${unmatched}条未匹配 (共${reportData.length}条)`);
    return written;
    
  } catch (err: unknown) {
    log.warn(`[v733] DAILY绩效数据同步异常: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * 回退快照模式：当无法获取DAILY报告时，使用旧的汇总数据快照方式
 */
async function fallbackSnapshotMode(db: any, accountId: number): Promise<number> {
  try {
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() - 2);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    log.info(`[v733-fallback] 使用快照模式写入账户${accountId}的每日绩效: ${dateStr}`);
    
    const enabledKeywords = await db.select({
      id: keywords.id, accountId: keywords.accountId, campaignId: keywords.campaignId,
      internalAdGroupId: keywords.internalAdGroupId,
      impressions: keywords.impressions, clicks: keywords.clicks,
      spend: keywords.spend, sales: keywords.sales, orders: keywords.orders,
    }).from(keywords).where(and(eq(keywords.accountId, accountId), eq(keywords.keywordStatus, 'enabled')));
    
    const enabledTargets = await db.select({
      id: productTargets.id, accountId: productTargets.accountId, campaignId: productTargets.campaignId,
      internalAdGroupId: productTargets.internalAdGroupId,
      impressions: productTargets.impressions, clicks: productTargets.clicks,
      spend: productTargets.spend, sales: productTargets.sales, orders: productTargets.orders,
    }).from(productTargets).where(and(eq(productTargets.accountId, accountId), eq(productTargets.targetStatus, 'enabled')));
    
    let written = 0;
    
    for (const kw of enabledKeywords) {
      try {
        const clicks = kw.clicks || 0;
        const impressions = kw.impressions || 0;
        const spend = parseFloat(kw.spend || '0');
        const sales = parseFloat(kw.sales || '0');
        const orders = kw.orders || 0;
        if (impressions === 0 && clicks === 0 && spend === 0) continue;
        
        await db.insert(keywordDailyPerformance).values({
          accountId: kw.accountId, campaignId: kw.campaignId,
          internalAdGroupId: kw.internalAdGroupId ? Number(kw.internalAdGroupId) : null,
          keywordId: kw.id, targetId: null, entityType: 'keyword', date: dateStr,
          impressions, clicks, spend: String(spend.toFixed(4)), sales: String(sales.toFixed(2)),
          orders, unitsSold: 0,
          cpc: clicks > 0 ? String((spend / clicks).toFixed(4)) : null,
          acos: sales > 0 ? String((spend / sales).toFixed(4)) : null,
          roas: spend > 0 ? String((sales / spend).toFixed(2)) : null,
          ctr: impressions > 0 ? String((clicks / impressions).toFixed(6)) : null,
          cvr: clicks > 0 ? String((orders / clicks).toFixed(6)) : null,
          dataSource: 'calculated',
        }).onDuplicateKeyUpdate({ set: { impressions, clicks, spend: String(spend.toFixed(4)), sales: String(sales.toFixed(2)), orders, updatedAt: sql`CURRENT_TIMESTAMP` } });
        written++;
      } catch (_: unknown) { /* skip */ }
    }
    
    for (const pt of enabledTargets) {
      try {
        const clicks = pt.clicks || 0;
        const impressions = pt.impressions || 0;
        const spend = parseFloat(pt.spend || '0');
        const sales = parseFloat(pt.sales || '0');
        const orders = pt.orders || 0;
        if (impressions === 0 && clicks === 0 && spend === 0) continue;
        
        await db.insert(keywordDailyPerformance).values({
          accountId: pt.accountId, campaignId: pt.campaignId,
          internalAdGroupId: pt.internalAdGroupId ? Number(pt.internalAdGroupId) : null,
          keywordId: null, targetId: pt.id, entityType: 'product_target', date: dateStr,
          impressions, clicks, spend: String(spend.toFixed(4)), sales: String(sales.toFixed(2)),
          orders, unitsSold: 0,
          cpc: clicks > 0 ? String((spend / clicks).toFixed(4)) : null,
          acos: sales > 0 ? String((spend / sales).toFixed(4)) : null,
          roas: spend > 0 ? String((sales / spend).toFixed(2)) : null,
          ctr: impressions > 0 ? String((clicks / impressions).toFixed(6)) : null,
          cvr: clicks > 0 ? String((orders / clicks).toFixed(6)) : null,
          dataSource: 'calculated',
        }).onDuplicateKeyUpdate({ set: { impressions, clicks, spend: String(spend.toFixed(4)), sales: String(sales.toFixed(2)), orders, updatedAt: sql`CURRENT_TIMESTAMP` } });
        written++;
      } catch (_: unknown) { /* skip */ }
    }
    
    log.info(`[v733-fallback] 账户${accountId}快照模式写入完成: ${written}条`);
    return written;
  } catch (err: unknown) {
    log.warn(`[v733-fallback] 快照模式写入异常: ${(err as Error).message}`);
    return 0;
  }
}
