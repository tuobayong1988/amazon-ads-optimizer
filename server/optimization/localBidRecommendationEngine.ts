/**
 * v457: 本地出价推荐引擎 (Local Bid Recommendation Engine)
 * 
 * 当Amazon Theme-Based Bid Recommendations API返回422时，
 * 利用本地历史转化数据计算智能出价建议，替代简单的默认值兜底。
 * 
 * 推荐策略（三级回退）：
 * 1. 同AdGroup级别：使用同一广告组内其他关键词/Target的历史表现
 * 2. 同Campaign级别：使用同一广告活动内的历史表现
 * 3. 同Account级别：使用同一账号内同类型广告活动的历史表现
 * 
 * 出价计算公式：
 *   推荐出价 = 加权平均CPC × (目标ACoS / 实际ACoS) × 置信度调整因子
 *   范围下限 = 推荐出价 × 0.50
 *   范围上限 = 推荐出价 × 1.50
 */

import { getDb } from '../db';
import {
  keywords as keywordsTable,
  productTargets as productTargetsTable,
  campaigns as campaignsTable,
  adGroups as adGroupsTable,
  bidPerformanceHistory as bphTable,
} from '../../drizzle/schema';
import { eq, and, sql, gt, isNull, or } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('LocalBidRec');

/** 本地推荐结果 */
export interface LocalBidRecommendation {
  suggestedBid: number;
  rangeStart: number;
  rangeEnd: number;
  confidence: number;       // 0~1, 数据越充分越高
  source: 'adgroup' | 'campaign' | 'account' | 'minimum_default';
  sampleSize: number;       // 用于计算的样本数量
  reasoning: string;
}

/** 聚合的历史表现数据 */
interface AggregatedPerformance {
  totalClicks: number;
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  totalImpressions: number;
  sampleCount: number;
  avgBid: number;
}

/**
 * 获取关键词的本地出价推荐
 * 
 * @param accountId - 账号ID
 * @param adGroupId - Amazon广告组ID
 * @param campaignId - Amazon广告活动ID (可选)
 * @param campaignType - 广告活动类型 ('sponsoredProducts' | 'sponsoredBrands' | 'sponsoredDisplay')
 * @param targetAcos - 目标ACoS (0~1之间, 如0.30表示30%)
 * @returns 本地出价推荐结果
 */
export async function getLocalKeywordBidRecommendation(
  accountId: number,
  adGroupId: string,
  campaignId?: string,
  campaignType: string = 'sponsoredProducts',
  targetAcos: number = 0.30,
): Promise<LocalBidRecommendation> {
  const db = getDb();

  // ========== 策略1: 同AdGroup级别 ==========
  try {
    const adGroupPerf = await db.select({
      totalClicks: sql<number>`COALESCE(SUM(${keywordsTable.clicks}), 0)`,
      totalSpend: sql<number>`COALESCE(SUM(CAST(${keywordsTable.spend} AS DECIMAL(12,2))), 0)`,
      totalSales: sql<number>`COALESCE(SUM(CAST(${keywordsTable.sales} AS DECIMAL(12,2))), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${keywordsTable.orders}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${keywordsTable.impressions}), 0)`,
      sampleCount: sql<number>`COUNT(*)`,
      avgBid: sql<number>`COALESCE(AVG(CAST(${keywordsTable.bid} AS DECIMAL(10,2))), 0)`,
    })
    .from(keywordsTable)
    .innerJoin(adGroupsTable, eq(keywordsTable.internalAdGroupId, adGroupsTable.id))
    .where(
      and(
        eq(adGroupsTable.adGroupId, adGroupId),
        eq(keywordsTable.accountId, accountId),
        eq(keywordsTable.keywordStatus, 'enabled'),
        gt(keywordsTable.clicks, 0),
      )
    );

    const perf = adGroupPerf[0];
    if (perf && perf.totalClicks >= 10) {
      const rec = calculateBidFromPerformance(perf, targetAcos, 'adgroup');
      log.info(`[v457] 本地推荐(AdGroup级): adGroupId=${adGroupId}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}, samples=${rec.sampleSize}`);
      return rec;
    }
  } catch (err) {
    log.debug(`[v457] AdGroup级查询失败: ${(err as Error).message}`);
  }

  // ========== 策略2: 同Campaign级别 ==========
  if (campaignId) {
    try {
      const campaignPerf = await db.select({
        totalClicks: sql<number>`COALESCE(SUM(${keywordsTable.clicks}), 0)`,
        totalSpend: sql<number>`COALESCE(SUM(CAST(${keywordsTable.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql<number>`COALESCE(SUM(CAST(${keywordsTable.sales} AS DECIMAL(12,2))), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${keywordsTable.orders}), 0)`,
        totalImpressions: sql<number>`COALESCE(SUM(${keywordsTable.impressions}), 0)`,
        sampleCount: sql<number>`COUNT(*)`,
        avgBid: sql<number>`COALESCE(AVG(CAST(${keywordsTable.bid} AS DECIMAL(10,2))), 0)`,
      })
      .from(keywordsTable)
      .where(
        and(
          eq(keywordsTable.campaignId, campaignId),
          eq(keywordsTable.accountId, accountId),
          eq(keywordsTable.keywordStatus, 'enabled'),
          gt(keywordsTable.clicks, 0),
        )
      );

      const perf = campaignPerf[0];
      if (perf && perf.totalClicks >= 5) {
        const rec = calculateBidFromPerformance(perf, targetAcos, 'campaign');
        log.info(`[v457] 本地推荐(Campaign级): campaignId=${campaignId}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}, samples=${rec.sampleCount}`);
        return rec;
      }
    } catch (err) {
      log.debug(`[v457] Campaign级查询失败: ${(err as Error).message}`);
    }
  }

  // ========== 策略3: 同Account级别（同类型广告活动） ==========
  try {
    const accountPerf = await db.select({
      totalClicks: sql<number>`COALESCE(SUM(${keywordsTable.clicks}), 0)`,
      totalSpend: sql<number>`COALESCE(SUM(CAST(${keywordsTable.spend} AS DECIMAL(12,2))), 0)`,
      totalSales: sql<number>`COALESCE(SUM(CAST(${keywordsTable.sales} AS DECIMAL(12,2))), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${keywordsTable.orders}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${keywordsTable.impressions}), 0)`,
      sampleCount: sql<number>`COUNT(*)`,
      avgBid: sql<number>`COALESCE(AVG(CAST(${keywordsTable.bid} AS DECIMAL(10,2))), 0)`,
    })
    .from(keywordsTable)
    .innerJoin(campaignsTable, eq(keywordsTable.campaignId, campaignsTable.campaignId))
    .where(
      and(
        eq(keywordsTable.accountId, accountId),
        eq(campaignsTable.campaignType, campaignType as any),
        eq(keywordsTable.keywordStatus, 'enabled'),
        gt(keywordsTable.clicks, 0),
      )
    );

    const perf = accountPerf[0];
    if (perf && perf.totalClicks >= 3) {
      const rec = calculateBidFromPerformance(perf, targetAcos, 'account');
      log.info(`[v457] 本地推荐(Account级): accountId=${accountId}, type=${campaignType}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}, samples=${rec.sampleCount}`);
      return rec;
    }
  } catch (err) {
    log.debug(`[v457] Account级查询失败: ${(err as Error).message}`);
  }

  // ========== 兜底: 返回最低默认值 ==========
  log.warn(`[v457] 所有本地推荐策略均无足够数据, accountId=${accountId}, adGroupId=${adGroupId}, 返回最低默认值`);
  return {
    suggestedBid: 0.75,
    rangeStart: 0.30,
    rangeEnd: 1.50,
    confidence: 0.10,
    source: 'minimum_default',
    sampleSize: 0,
    reasoning: '本地无历史数据，使用最低默认出价',
  };
}

/**
 * 获取商品定位Target的本地出价推荐
 */
export async function getLocalTargetBidRecommendation(
  accountId: number,
  adGroupId: string,
  campaignId?: string,
  campaignType: string = 'sponsoredProducts',
  targetAcos: number = 0.30,
): Promise<LocalBidRecommendation> {
  const db = getDb();

  // ========== 策略1: 同AdGroup级别 ==========
  try {
    const adGroupPerf = await db.select({
      totalClicks: sql<number>`COALESCE(SUM(${productTargetsTable.clicks}), 0)`,
      totalSpend: sql<number>`COALESCE(SUM(CAST(${productTargetsTable.spend} AS DECIMAL(12,2))), 0)`,
      totalSales: sql<number>`COALESCE(SUM(CAST(${productTargetsTable.sales} AS DECIMAL(12,2))), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${productTargetsTable.orders}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${productTargetsTable.impressions}), 0)`,
      sampleCount: sql<number>`COUNT(*)`,
      avgBid: sql<number>`COALESCE(AVG(CAST(${productTargetsTable.bid} AS DECIMAL(10,2))), 0)`,
    })
    .from(productTargetsTable)
    .innerJoin(adGroupsTable, eq(productTargetsTable.internalAdGroupId, adGroupsTable.id))
    .where(
      and(
        eq(adGroupsTable.adGroupId, adGroupId),
        eq(productTargetsTable.accountId, accountId),
        or(
          eq(productTargetsTable.targetStatus, 'enabled'),
          isNull(productTargetsTable.targetStatus),
        ),
        gt(productTargetsTable.clicks, 0),
        or(
          eq(productTargetsTable.amazonDeleted, 0),
          isNull(productTargetsTable.amazonDeleted),
        ),
      )
    );

    const perf = adGroupPerf[0];
    if (perf && perf.totalClicks >= 10) {
      const rec = calculateBidFromPerformance(perf, targetAcos, 'adgroup');
      log.info(`[v457] Target本地推荐(AdGroup级): adGroupId=${adGroupId}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}`);
      return rec;
    }
  } catch (err) {
    log.debug(`[v457] Target AdGroup级查询失败: ${(err as Error).message}`);
  }

  // ========== 策略2: 同Campaign级别 ==========
  if (campaignId) {
    try {
      const campaignPerf = await db.select({
        totalClicks: sql<number>`COALESCE(SUM(${productTargetsTable.clicks}), 0)`,
        totalSpend: sql<number>`COALESCE(SUM(CAST(${productTargetsTable.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql<number>`COALESCE(SUM(CAST(${productTargetsTable.sales} AS DECIMAL(12,2))), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${productTargetsTable.orders}), 0)`,
        totalImpressions: sql<number>`COALESCE(SUM(${productTargetsTable.impressions}), 0)`,
        sampleCount: sql<number>`COUNT(*)`,
        avgBid: sql<number>`COALESCE(AVG(CAST(${productTargetsTable.bid} AS DECIMAL(10,2))), 0)`,
      })
      .from(productTargetsTable)
      .where(
        and(
          eq(productTargetsTable.campaignId, campaignId),
          eq(productTargetsTable.accountId, accountId),
          or(
            eq(productTargetsTable.targetStatus, 'enabled'),
            isNull(productTargetsTable.targetStatus),
          ),
          gt(productTargetsTable.clicks, 0),
          or(
            eq(productTargetsTable.amazonDeleted, 0),
            isNull(productTargetsTable.amazonDeleted),
          ),
        )
      );

      const perf = campaignPerf[0];
      if (perf && perf.totalClicks >= 5) {
        const rec = calculateBidFromPerformance(perf, targetAcos, 'campaign');
        log.info(`[v457] Target本地推荐(Campaign级): campaignId=${campaignId}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}`);
        return rec;
      }
    } catch (err) {
      log.debug(`[v457] Target Campaign级查询失败: ${(err as Error).message}`);
    }
  }

  // ========== 策略3: 同Account级别 ==========
  try {
    const accountPerf = await db.select({
      totalClicks: sql<number>`COALESCE(SUM(${productTargetsTable.clicks}), 0)`,
      totalSpend: sql<number>`COALESCE(SUM(CAST(${productTargetsTable.spend} AS DECIMAL(12,2))), 0)`,
      totalSales: sql<number>`COALESCE(SUM(CAST(${productTargetsTable.sales} AS DECIMAL(12,2))), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${productTargetsTable.orders}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${productTargetsTable.impressions}), 0)`,
      sampleCount: sql<number>`COUNT(*)`,
      avgBid: sql<number>`COALESCE(AVG(CAST(${productTargetsTable.bid} AS DECIMAL(10,2))), 0)`,
    })
    .from(productTargetsTable)
    .innerJoin(campaignsTable, eq(productTargetsTable.campaignId, campaignsTable.campaignId))
    .where(
      and(
        eq(productTargetsTable.accountId, accountId),
        eq(campaignsTable.campaignType, campaignType as any),
        or(
          eq(productTargetsTable.targetStatus, 'enabled'),
          isNull(productTargetsTable.targetStatus),
        ),
        gt(productTargetsTable.clicks, 0),
        or(
          eq(productTargetsTable.amazonDeleted, 0),
          isNull(productTargetsTable.amazonDeleted),
        ),
      )
    );

    const perf = accountPerf[0];
    if (perf && perf.totalClicks >= 3) {
      const rec = calculateBidFromPerformance(perf, targetAcos, 'account');
      log.info(`[v457] Target本地推荐(Account级): accountId=${accountId}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}`);
      return rec;
    }
  } catch (err) {
    log.debug(`[v457] Target Account级查询失败: ${(err as Error).message}`);
  }

  // ========== 兜底 ==========
  log.warn(`[v457] Target所有本地推荐策略均无足够数据, accountId=${accountId}, adGroupId=${adGroupId}`);
  return {
    suggestedBid: 0.75,
    rangeStart: 0.30,
    rangeEnd: 1.50,
    confidence: 0.10,
    source: 'minimum_default',
    sampleSize: 0,
    reasoning: '本地无历史数据，使用最低默认出价',
  };
}

/**
 * 核心计算逻辑：基于历史表现数据计算推荐出价
 * 
 * 算法原理：
 * 1. 计算加权平均CPC (总花费/总点击)
 * 2. 计算实际ACoS (总花费/总销售额)
 * 3. 推荐出价 = avgCPC × (targetACoS / actualACoS)
 *    - 如果实际ACoS高于目标，降低出价
 *    - 如果实际ACoS低于目标，适度提升出价
 * 4. 置信度基于样本量和数据质量
 */
function calculateBidFromPerformance(
  perf: AggregatedPerformance,
  targetAcos: number,
  source: 'adgroup' | 'campaign' | 'account',
): LocalBidRecommendation {
  const { totalClicks, totalSpend, totalSales, totalOrders, totalImpressions, sampleCount, avgBid } = perf;

  // 计算核心指标
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const actualAcos = totalSales > 0 ? totalSpend / totalSales : 1.0;
  const cvr = totalClicks > 0 ? totalOrders / totalClicks : 0;
  const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

  let suggestedBid: number;

  if (totalSales > 0 && actualAcos > 0) {
    // 主算法: 基于ACoS调整的CPC
    // 推荐出价 = avgCPC × (targetACoS / actualACoS)
    const acosRatio = Math.min(Math.max(targetAcos / actualAcos, 0.30), 3.0); // 限制调整幅度
    suggestedBid = avgCpc * acosRatio;
  } else if (cvr > 0 && avgOrderValue > 0) {
    // 备用算法: 基于CVR和AOV
    // 推荐出价 = targetACoS × AOV × CVR
    suggestedBid = targetAcos * avgOrderValue * cvr;
  } else {
    // 最后兜底: 使用当前平均出价的80%
    suggestedBid = avgBid > 0 ? avgBid * 0.80 : 0.75;
  }

  // 安全边界: 出价不低于$0.10, 不高于$100
  suggestedBid = Math.max(0.10, Math.min(suggestedBid, 100.0));

  // 计算推荐范围
  const rangeStart = Math.max(0.10, suggestedBid * 0.50);
  const rangeEnd = Math.min(100.0, suggestedBid * 1.50);

  // 计算置信度 (基于样本量和数据级别)
  let confidence: number;
  const sourceMultiplier = source === 'adgroup' ? 1.0 : source === 'campaign' ? 0.80 : 0.60;

  if (totalClicks >= 100 && totalOrders >= 5) {
    confidence = 0.85 * sourceMultiplier;
  } else if (totalClicks >= 50 && totalOrders >= 2) {
    confidence = 0.70 * sourceMultiplier;
  } else if (totalClicks >= 20) {
    confidence = 0.55 * sourceMultiplier;
  } else if (totalClicks >= 10) {
    confidence = 0.40 * sourceMultiplier;
  } else {
    confidence = 0.25 * sourceMultiplier;
  }

  const reasoning = [
    `来源: ${source}级历史数据`,
    `样本: ${sampleCount}个实体, ${totalClicks}次点击, ${totalOrders}次转化`,
    `avgCPC=$${avgCpc.toFixed(2)}, actualACoS=${(actualAcos * 100).toFixed(1)}%, targetACoS=${(targetAcos * 100).toFixed(1)}%`,
    `CVR=${(cvr * 100).toFixed(2)}%, AOV=$${avgOrderValue.toFixed(2)}`,
  ].join('; ');

  return {
    suggestedBid: Math.round(suggestedBid * 100) / 100, // 保留2位小数
    rangeStart: Math.round(rangeStart * 100) / 100,
    rangeEnd: Math.round(rangeEnd * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    source,
    sampleSize: sampleCount,
    reasoning,
  };
}
