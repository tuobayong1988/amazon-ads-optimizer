/**
 * v360: 全局否定关键词服务
 * 跨广告活动的账户级否定词管理
 * 
 * 功能:
 * 1. 跨广告活动分析: 识别在多个广告活动中表现差的搜索词
 * 2. 全局否定词管理: 将否定词应用到账户下所有相关广告活动
 * 3. 效果追踪: 追踪全局否定词的阻止效果
 */
import { getDb } from '../db';
import { accountNegativeKeywords, InsertAccountNegativeKeyword } from '../../drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
// @ts-ignore - runtime type mismatch
import { log } from '../utils/logger';

/**
 * 跨广告活动分析结果
 */
interface CrossCampaignAnalysisResult {
  searchTerm: string;
  campaignCount: number;
  totalSpend: number;
  totalClicks: number;
  totalOrders: number;
  avgAcos: number;
  recommendation: 'negate' | 'monitor' | 'keep';
  reason: string;
}

/**
 * 分析跨广告活动的低效搜索词
 * 找出在多个广告活动中都表现差的搜索词，推荐为全局否定
 */
export async function analyzeCrossCampaignNegatives(
  accountId: number,
  options: {
    minCampaignCount?: number;   // 至少出现在N个广告活动中
    minTotalSpend?: number;      // 最低总花费阈值
    maxAcos?: number;            // ACoS超过此值视为低效
    lookbackDays?: number;       // 分析的时间窗口
  } = {}
): Promise<CrossCampaignAnalysisResult[]> {
  const {
    minCampaignCount = 2,
    minTotalSpend = 10,
    maxAcos = 100,
    lookbackDays = 30,
  } = options;

  const db = await getDb();
  if (!db) {
    log.warn('[GlobalNegative] 数据库不可用');
    return [];
  }

  try {
    // 查询在多个广告活动中出现且表现差的搜索词
    const results = await db.execute(sql`
      SELECT 
        st.searchTerm,
        COUNT(DISTINCT st.campaignId) as campaignCount,
        SUM(st.spend) as totalSpend,
        SUM(st.clicks) as totalClicks,
        SUM(st.orders) as totalOrders,
        CASE WHEN SUM(st.sales) > 0 
          THEN SUM(st.spend) / SUM(st.sales) * 100 
          ELSE 999 
        END as avgAcos
      FROM search_terms st
      INNER JOIN campaigns c ON st.campaignId = c.campaignId
      WHERE c.accountId = ${accountId}
        AND st.reportDate >= DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(lookbackDays))} DAY)
        AND st.searchTerm IS NOT NULL
        AND st.searchTerm != ''
      GROUP BY st.searchTerm
      HAVING campaignCount >= ${minCampaignCount}
        AND totalSpend >= ${minTotalSpend}
        AND (totalOrders = 0 OR avgAcos > ${maxAcos})
      ORDER BY totalSpend DESC
      LIMIT 100
    `);

    const rows = (results as unknown[][])?.[0] as Record<string, unknown>[] || [];
    
    return rows.map(row => {
      const totalOrders = Number(row.totalOrders || 0);
      const avgAcos = Number(row.avgAcos || 999);
      const totalSpend = Number(row.totalSpend || 0);
      
      let recommendation: 'negate' | 'monitor' | 'keep' = 'monitor';
      let reason = '';
      
      if (totalOrders === 0 && totalSpend >= minTotalSpend * 2) {
        recommendation = 'negate';
        reason = `在${row.campaignCount}个广告活动中花费$${totalSpend.toFixed(2)}但零转化`;
      } else if (avgAcos > maxAcos * 1.5) {
        recommendation = 'negate';
        reason = `跨${row.campaignCount}个广告活动平均ACoS=${avgAcos.toFixed(1)}%，远超阈值`;
      } else if (avgAcos > maxAcos) {
        recommendation = 'monitor';
        reason = `跨${row.campaignCount}个广告活动平均ACoS=${avgAcos.toFixed(1)}%，略超阈值`;
      }
      
      return {
        searchTerm: String(row.searchTerm),
        campaignCount: Number(row.campaignCount),
        totalSpend,
        totalClicks: Number(row.totalClicks || 0),
        totalOrders,
        avgAcos,
        recommendation,
        reason,
      };
    });
  } catch (error: unknown) {
    log.warn(`[GlobalNegative] 跨广告活动分析失败: ${(error as Error).message}`);
    return [];
  }
}

/**
 * 添加全局否定关键词
 */
export async function addGlobalNegativeKeyword(
  accountId: number,
  negativeText: string,
  matchType: 'negative_exact' | 'negative_phrase',
  source: InsertAccountNegativeKeyword['source'] = 'manual',
  sourceReason?: string
): Promise<{ success: boolean; id?: number; message: string }> {
  const db = await getDb();
  if (!db) return { success: false, message: '数据库不可用' };

  try {
    const result = await db.insert(accountNegativeKeywords).values({
      accountId,
      negativeText: negativeText.toLowerCase().trim(),
      negativeMatchType: matchType,
      source,
      sourceReason,
      status: 'active',
    }).onDuplicateKeyUpdate({
      set: { status: 'active', sourceReason, updatedAt: sql`NOW()` },
    });

    // @ts-ignore Dynamic type assertion
    const insertId = (result as Record<string, unknown>[])[0]?.insertId as unknown as number;
    log.info(`[GlobalNegative] 添加全局否定词: "${negativeText}" (${matchType}), accountId=${accountId}, source=${source}`);
    
    return { success: true, id: insertId, message: `成功添加全局否定词: ${negativeText}` };
  } catch (error: unknown) {
    log.warn(`[GlobalNegative] 添加全局否定词失败: ${(error as Error).message}`);
    return { success: false, message: (error as Error).message };
  }
}

/**
 * 获取账户的全局否定关键词列表
 */
export async function getGlobalNegativeKeywords(
  accountId: number,
  status: 'active' | 'paused' | 'removed' = 'active'
): Promise<Array<{ id: number; negativeText: string; negativeMatchType: string; source: string; appliedCampaignCount: number }>> {
  const db = await getDb();
  if (!db) return [];

  try {
    const results = await db.select()
      .from(accountNegativeKeywords)
      .where(and(
        eq(accountNegativeKeywords.accountId, accountId),
        eq(accountNegativeKeywords.status, status)
      ));
    
    return results.map(r => ({
      id: r.id,
      negativeText: r.negativeText,
      negativeMatchType: r.negativeMatchType,
      source: r.source || 'manual',
      appliedCampaignCount: r.appliedCampaignCount || 0,
    }));
  } catch (error: unknown) {
    log.warn(`[GlobalNegative] 获取全局否定词失败: ${(error as Error).message}`);
    return [];
  }
}

/**
 * 执行跨广告活动否定词分析并自动添加
 * 用于定时任务调用
 */
export async function executeGlobalNegativeAnalysis(accountId: number): Promise<{
  analyzed: number;
  added: number;
  errors: string[];
}> {
  const result = { analyzed: 0, added: 0, errors: [] as string[] };
  
  try {
    const candidates = await analyzeCrossCampaignNegatives(accountId, {
      minCampaignCount: 3,
      minTotalSpend: 20,
      maxAcos: 80,
      lookbackDays: 30,
    });
    
    result.analyzed = candidates.length;
    
    for (const candidate of candidates) {
      if (candidate.recommendation === 'negate') {
        const addResult = await addGlobalNegativeKeyword(
          accountId,
          candidate.searchTerm,
          'negative_exact',
          'cross_campaign_analysis',
          candidate.reason
        );
        if (addResult.success) {
          result.added++;
        } else {
          result.errors.push(`"${candidate.searchTerm}": ${addResult.message}`);
        }
      }
    }
    
    log.info(`[GlobalNegative] 账户${accountId}全局否定分析完成: 分析=${result.analyzed}, 添加=${result.added}`);
  } catch (error: unknown) {
    result.errors.push((error as Error).message);
    log.warn(`[GlobalNegative] 全局否定分析异常: ${(error as Error).message}`);
  }
  
  return result;
}
