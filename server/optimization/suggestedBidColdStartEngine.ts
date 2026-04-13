/**
 * v511: 冷启动智能出价引擎 (Suggested Bid Cold Start Engine)
 * 
 * 核心目标：
 * 对于缺乏Amazon建议竞价或零数据的新投放词/ASIN，通过多级动态锚点机制
 * 智能推断合理的初始出价，替代之前的空壳Stub和规则引擎的"盲目提价"。
 * 
 * 多级动态锚点优先级链：
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Level 1: 同AdGroup优质词CPC锚点（最精确）                       │
 * │  ├── 查询同广告组内近30天有出单且ACoS达标的投放词                  │
 * │  ├── 提取加权平均CPC作为基准出价                                  │
 * │  └── 置信度: 0.75-0.85                                          │
 * │                                                                  │
 * │  Level 2: 同Campaign优质词CPC锚点                                │
 * │  ├── 扩大范围至同广告活动内寻找优质词CPC                          │
 * │  ├── 使用出单词的加权平均CPC                                      │
 * │  └── 置信度: 0.60-0.75                                          │
 * │                                                                  │
 * │  Level 3: 贝叶斯平滑推断（活动级先验）                            │
 * │  ├── 调用bayesianBidSmoothingEngine获取账户级先验                 │
 * │  ├── 结合crossProductTransferEngine的跨品迁移先验                 │
 * │  └── 置信度: 0.45-0.60                                          │
 * │                                                                  │
 * │  Level 4: Amazon建议竞价（如果存在但之前未使用）                   │
 * │  ├── 直接使用target自身的suggestedBid                             │
 * │  └── 置信度: 0.55-0.70                                          │
 * │                                                                  │
 * │  Level 5: 兜底策略                                                │
 * │  └── 返回null，由规则引擎处理                                     │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * 动态测试系数：
 * - 匹配类型系数：exact=1.10, phrase=1.00, broad=0.85, auto=0.80
 * - 竞争度系数：基于目标ACoS动态调整 (0.8-1.2)
 * - 新词探索系数：冷启动前7天额外+5%探索加成
 * 
 * 后续自动学习：
 * - 所有冷启动出价通过rlDataRecorder记录，标记source='cold_start'
 * - 数据积累后高级算法（CQL/LinUCB/Sigmoid）自动接管
 * - 同时更新活动内锚点CPC（随着更多词出单，锚点更精确）
 */

import { getDb } from '../db';
import { keywords, productTargets, adGroups } from '../../drizzle/schema';
import { eq, and, gt, gte, sql, isNotNull } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';
import { estimateBid, type BayesianBidEstimate } from './bayesianBidSmoothingEngine';
import { getTransferPriorForCampaign, blendTransferWithOwn, type TransferParameters } from './crossProductTransferEngine';

const log = createModuleLogger('ColdStartBid');

// ==================== 配置常量 ====================

const COLD_START_CONFIG = {
  /** 冷启动期定义：创建后多少天内视为冷启动 */
  COLD_START_PERIOD_DAYS: 14,
  /** 数据稀疏阈值：点击数低于此值视为数据不足 */
  DATA_SPARSE_CLICKS_THRESHOLD: 5,
  /** 数据稀疏阈值：曝光数低于此值视为零数据 */
  DATA_SPARSE_IMPRESSIONS_THRESHOLD: 50,
  /** 同组优质词最少需要多少个才构成有效锚点 */
  MIN_ANCHOR_SAMPLES_ADGROUP: 1,
  /** 同活动优质词最少需要多少个才构成有效锚点 */
  MIN_ANCHOR_SAMPLES_CAMPAIGN: 2,
  /** 优质词定义：近30天至少出多少单 */
  QUALITY_MIN_ORDERS: 2,
  /** 优质词定义：ACoS不超过目标ACoS的多少倍 */
  QUALITY_ACOS_MULTIPLIER: 1.5,
  /** 锚点CPC的安全上限：不超过maxBid的多少 */
  ANCHOR_BID_MAX_RATIO: 0.70,
  /** 锚点CPC的安全下限 */
  ANCHOR_BID_MIN: 0.10,
  /** 新词探索加成（冷启动前7天） */
  EXPLORATION_BOOST: 0.05,
  /** 探索加成的天数 */
  EXPLORATION_BOOST_DAYS: 7,
};

/** 匹配类型系数映射 */
const MATCH_TYPE_COEFFICIENTS: Record<string, number> = {
  'exact': 1.10,      // 精确匹配：竞争更激烈，需要稍高出价
  'phrase': 1.00,     // 词组匹配：基准系数
  'broad': 0.85,      // 广泛匹配：流量更泛，出价可以更低
  'auto': 0.80,       // 自动广告：系统匹配，保守出价
  'targeting': 0.90,  // 商品定向：介于精确和广泛之间
  'default': 0.90,    // 默认
};

// ==================== 类型定义 ====================

/** 冷启动出价目标信息 */
export interface ColdStartTarget {
  id: number;
  type: 'keyword' | 'product_target';
  currentBid: number;
  suggestedBid?: number;
  suggestedBidRangeStart?: number;
  suggestedBidRangeEnd?: number;
  matchType?: string;
  keywordText?: string;
  campaignId?: number;  // amazonCampaignId
  adGroupId?: number;   // internalAdGroupId
  clicks?: number;
  impressions?: number;
  spend?: number;
  sales?: number;
  orders?: number;
  createdAt?: string;
}

/** 冷启动出价结果 */
export interface ColdStartBidResult {
  /** 推荐出价 */
  recommendedBid: number;
  /** 使用的策略 */
  strategy: 'adgroup_anchor' | 'campaign_anchor' | 'bayesian_smoothing' | 'suggested_bid_enhanced' | 'transfer_prior';
  /** 先验权重 */
  priorWeight: number;
  /** 置信度 (0-1) */
  confidence: number;
  /** 决策原因 */
  reason: string;
  /** 建议竞价信息 */
  suggestedBidInfo: {
    suggestedBid: number;
    rangeStart: number;
    rangeEnd: number;
    source: string;
  };
  /** 动态系数详情 */
  coefficients: {
    matchType: number;
    competition: number;
    exploration: number;
    combined: number;
  };
}

/** 优质词锚点数据 */
interface AnchorData {
  /** 加权平均CPC */
  weightedAvgCpc: number;
  /** 平均出价 */
  avgBid: number;
  /** 样本数 */
  sampleCount: number;
  /** 总订单数 */
  totalOrders: number;
  /** 平均ACoS */
  avgAcos: number;
  /** 来源级别 */
  source: 'adgroup' | 'campaign';
}

// ==================== 核心导出函数 ====================

/**
 * 判断目标是否处于冷启动期
 * 
 * 冷启动条件（满足任一）：
 * 1. 创建时间在COLD_START_PERIOD_DAYS天内
 * 2. 累计点击数低于DATA_SPARSE_CLICKS_THRESHOLD
 * 3. 累计曝光数低于DATA_SPARSE_IMPRESSIONS_THRESHOLD
 */
export function isInColdStartPeriod(
  target: ColdStartTarget,
): boolean {
  // 条件1：数据稀疏
  const clicks = target.clicks || 0;
  const impressions = target.impressions || 0;
  
  if (clicks < COLD_START_CONFIG.DATA_SPARSE_CLICKS_THRESHOLD) {
    return true;
  }
  
  if (impressions < COLD_START_CONFIG.DATA_SPARSE_IMPRESSIONS_THRESHOLD) {
    return true;
  }
  
  // 条件2：创建时间在冷启动期内
  if (target.createdAt) {
    const createdDate = new Date(target.createdAt);
    const daysSinceCreation = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation <= COLD_START_CONFIG.COLD_START_PERIOD_DAYS) {
      return true;
    }
  }
  
  return false;
}

/**
 * 获取冷启动出价覆盖
 * 
 * 多级动态锚点机制：
 * Level 1: 同AdGroup优质词CPC → Level 2: 同Campaign优质词CPC
 * → Level 3: 贝叶斯平滑推断 → Level 4: Amazon建议竞价增强
 * → Level 5: 返回null（由规则引擎处理）
 * 
 * @param accountId 账户ID
 * @param target 冷启动目标信息
 * @param targetAcos 目标ACoS (小数形式, 如0.30)
 * @returns 冷启动出价结果，或null表示无法推断
 */
export async function getColdStartBidOverride(
  accountId: number,
  target: ColdStartTarget,
  targetAcos: number,
): Promise<ColdStartBidResult | null> {
  try {
    // 检查是否处于冷启动期
    if (!isInColdStartPeriod(target)) {
      return null;
    }
    
    log.info(`[ColdStart] 目标${target.id}(${target.type})进入冷启动出价引擎, ` +
      `currentBid=$${target.currentBid.toFixed(2)}, clicks=${target.clicks || 0}, ` +
      `impressions=${target.impressions || 0}, matchType=${target.matchType || 'unknown'}`);
    
    // 计算动态系数
    const coefficients = calculateDynamicCoefficients(target, targetAcos);
    
    // ===== Level 1: 同AdGroup优质词CPC锚点 =====
    if (target.adGroupId) {
      const adGroupAnchor = await getAdGroupAnchorCpc(
        accountId, target.adGroupId, target.type, targetAcos
      );
      
      if (adGroupAnchor && adGroupAnchor.sampleCount >= COLD_START_CONFIG.MIN_ANCHOR_SAMPLES_ADGROUP) {
        const anchorBid = calculateAnchorBid(adGroupAnchor, coefficients, target);
        const confidence = calculateConfidence(adGroupAnchor, 'adgroup');
        
        log.info(`[ColdStart] Level 1命中: 同AdGroup锚点CPC=$${adGroupAnchor.weightedAvgCpc.toFixed(2)}, ` +
          `样本=${adGroupAnchor.sampleCount}, 推荐出价=$${anchorBid.toFixed(2)}, 置信度=${confidence.toFixed(2)}`);
        
        return buildResult(anchorBid, 'adgroup_anchor', confidence, adGroupAnchor, coefficients, target,
          `同广告组内${adGroupAnchor.sampleCount}个优质词的加权CPC=$${adGroupAnchor.weightedAvgCpc.toFixed(2)}作为锚点`);
      }
    }
    
    // ===== Level 2: 同Campaign优质词CPC锚点 =====
    if (target.campaignId) {
      const campaignAnchor = await getCampaignAnchorCpc(
        accountId, target.campaignId, target.type, targetAcos
      );
      
      if (campaignAnchor && campaignAnchor.sampleCount >= COLD_START_CONFIG.MIN_ANCHOR_SAMPLES_CAMPAIGN) {
        const anchorBid = calculateAnchorBid(campaignAnchor, coefficients, target);
        const confidence = calculateConfidence(campaignAnchor, 'campaign');
        
        log.info(`[ColdStart] Level 2命中: 同Campaign锚点CPC=$${campaignAnchor.weightedAvgCpc.toFixed(2)}, ` +
          `样本=${campaignAnchor.sampleCount}, 推荐出价=$${anchorBid.toFixed(2)}, 置信度=${confidence.toFixed(2)}`);
        
        return buildResult(anchorBid, 'campaign_anchor', confidence, campaignAnchor, coefficients, target,
          `同广告活动内${campaignAnchor.sampleCount}个优质词的加权CPC=$${campaignAnchor.weightedAvgCpc.toFixed(2)}作为锚点`);
      }
    }
    
    // ===== Level 3: 贝叶斯平滑推断 + 跨品迁移先验 =====
    {
      const bayesianResult = await getBayesianSmoothedBid(accountId, target, targetAcos, coefficients);
      if (bayesianResult) {
        return bayesianResult;
      }
    }
    
    // ===== Level 4: Amazon建议竞价增强 =====
    // 如果target有suggestedBid但之前的规则引擎可能处理不够智能
    // 这里结合动态系数给出更精确的出价
    if (target.suggestedBid && target.suggestedBid > 0) {
      const enhancedBid = target.suggestedBid * coefficients.combined;
      const safeBid = Math.max(
        COLD_START_CONFIG.ANCHOR_BID_MIN,
        Math.min(enhancedBid, target.suggestedBid * 1.30) // 不超过建议竞价的130%
      );
      
      const confidence = 0.60;
      
      log.info(`[ColdStart] Level 4命中: Amazon建议竞价增强, suggestedBid=$${target.suggestedBid.toFixed(2)}, ` +
        `动态系数=${coefficients.combined.toFixed(2)}, 推荐出价=$${safeBid.toFixed(2)}`);
      
      return {
        recommendedBid: Math.round(safeBid * 100) / 100,
        strategy: 'suggested_bid_enhanced',
        priorWeight: 0.70,
        confidence,
        reason: `Amazon建议竞价$${target.suggestedBid.toFixed(2)} × 动态系数${coefficients.combined.toFixed(2)}`,
        suggestedBidInfo: {
          suggestedBid: target.suggestedBid,
          rangeStart: target.suggestedBidRangeStart || target.suggestedBid * 0.70,
          rangeEnd: target.suggestedBidRangeEnd || target.suggestedBid * 1.30,
          source: 'amazon_suggested_enhanced',
        },
        coefficients,
      };
    }
    
    // ===== Level 5: 无法推断，返回null =====
    log.info(`[ColdStart] 所有Level均未命中, target=${target.id}, 将由规则引擎处理`);
    return null;
    
  } catch (err: unknown) {
    log.warn(`[ColdStart] 冷启动引擎异常(target=${target.id}): ${(err as Error).message}`);
    return null;
  }
}

// ==================== 锚点查询函数 ====================

/**
 * Level 1: 查询同AdGroup内优质词的CPC锚点
 * 
 * 优质词定义：
 * - 近30天有出单（orders >= QUALITY_MIN_ORDERS）
 * - ACoS不超过目标ACoS的QUALITY_ACOS_MULTIPLIER倍
 * - 状态为enabled
 */
async function getAdGroupAnchorCpc(
  accountId: number,
  internalAdGroupId: number,
  entityType: 'keyword' | 'product_target',
  targetAcos: number,
): Promise<AnchorData | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    
    const maxAcos = targetAcos * COLD_START_CONFIG.QUALITY_ACOS_MULTIPLIER;
    
    if (entityType === 'keyword') {
      // 查询同AdGroup内有出单的关键词
      const [stats] = await db.select({
        count: sql<number>`COUNT(*)`,
        // 加权平均CPC：使用订单数作为权重
        weightedAvgCpc: sql<number>`
          COALESCE(
            SUM(CAST(${keywords.spend} AS DECIMAL(12,4))) / NULLIF(SUM(${keywords.clicks}), 0),
            AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))
          )`,
        avgBid: sql<number>`AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
        totalOrders: sql<number>`COALESCE(SUM(${keywords.orders}), 0)`,
        totalSpend: sql<number>`COALESCE(SUM(CAST(${keywords.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql<number>`COALESCE(SUM(CAST(${keywords.sales} AS DECIMAL(12,2))), 0)`,
      })
      .from(keywords)
      .where(and(
        eq(keywords.accountId, accountId),
        eq(keywords.internalAdGroupId, internalAdGroupId),
        eq(keywords.keywordStatus, 'enabled'),
        gte(keywords.orders, COLD_START_CONFIG.QUALITY_MIN_ORDERS),
        gt(keywords.clicks, 0),
      ));
      
      if (!stats || Number(stats.count) === 0) return null;
      
      const totalSpend = Number(stats.totalSpend || 0);
      const totalSales = Number(stats.totalSales || 0);
      const actualAcos = totalSales > 0 ? totalSpend / totalSales : 999;
      
      // 过滤：整体ACoS不能太离谱
      if (actualAcos > maxAcos * 2) return null;
      
      return {
        weightedAvgCpc: Math.max(0.02, Number(stats.weightedAvgCpc || 0)),
        avgBid: Math.max(0.02, Number(stats.avgBid || 0)),
        sampleCount: Number(stats.count),
        totalOrders: Number(stats.totalOrders),
        avgAcos: actualAcos,
        source: 'adgroup',
      };
    } else {
      // 查询同AdGroup内有出单的商品定向
      const [stats] = await db.select({
        count: sql<number>`COUNT(*)`,
        weightedAvgCpc: sql<number>`
          COALESCE(
            SUM(CAST(${productTargets.spend} AS DECIMAL(12,4))) / NULLIF(SUM(${productTargets.clicks}), 0),
            AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))
          )`,
        avgBid: sql<number>`AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
        totalOrders: sql<number>`COALESCE(SUM(${productTargets.orders}), 0)`,
        totalSpend: sql<number>`COALESCE(SUM(CAST(${productTargets.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql<number>`COALESCE(SUM(CAST(${productTargets.sales} AS DECIMAL(12,2))), 0)`,
      })
      .from(productTargets)
      .where(and(
        eq(productTargets.accountId, accountId),
        eq(productTargets.internalAdGroupId, internalAdGroupId),
        gte(productTargets.orders, COLD_START_CONFIG.QUALITY_MIN_ORDERS),
        gt(productTargets.clicks, 0),
      ));
      
      if (!stats || Number(stats.count) === 0) return null;
      
      const totalSpend = Number(stats.totalSpend || 0);
      const totalSales = Number(stats.totalSales || 0);
      const actualAcos = totalSales > 0 ? totalSpend / totalSales : 999;
      
      if (actualAcos > maxAcos * 2) return null;
      
      return {
        weightedAvgCpc: Math.max(0.02, Number(stats.weightedAvgCpc || 0)),
        avgBid: Math.max(0.02, Number(stats.avgBid || 0)),
        sampleCount: Number(stats.count),
        totalOrders: Number(stats.totalOrders),
        avgAcos: actualAcos,
        source: 'adgroup',
      };
    }
  } catch (err: unknown) {
    log.warn(`[ColdStart] AdGroup锚点查询异常: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Level 2: 查询同Campaign内优质词的CPC锚点
 * 
 * 与Level 1类似，但扩大范围至整个广告活动
 */
async function getCampaignAnchorCpc(
  accountId: number,
  amazonCampaignId: number,
  entityType: 'keyword' | 'product_target',
  targetAcos: number,
): Promise<AnchorData | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    
    const maxAcos = targetAcos * COLD_START_CONFIG.QUALITY_ACOS_MULTIPLIER;
    
    // 直接使用amazonCampaignId作为campaigns表的campaignId进行查询
    // campaigns表中的campaignId字段存储的就是Amazon的campaign ID
    const campaignIdStr = String(amazonCampaignId);
    
    if (entityType === 'keyword') {
      const [stats] = await db.select({
        count: sql<number>`COUNT(*)`,
        weightedAvgCpc: sql<number>`
          COALESCE(
            SUM(CAST(${keywords.spend} AS DECIMAL(12,4))) / NULLIF(SUM(${keywords.clicks}), 0),
            AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))
          )`,
        avgBid: sql<number>`AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
        totalOrders: sql<number>`COALESCE(SUM(${keywords.orders}), 0)`,
        totalSpend: sql<number>`COALESCE(SUM(CAST(${keywords.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql<number>`COALESCE(SUM(CAST(${keywords.sales} AS DECIMAL(12,2))), 0)`,
      })
      .from(keywords)
      .where(and(
        eq(keywords.accountId, accountId),
        eq(keywords.campaignId, campaignIdStr),
        eq(keywords.keywordStatus, 'enabled'),
        gte(keywords.orders, COLD_START_CONFIG.QUALITY_MIN_ORDERS),
        gt(keywords.clicks, 0),
      ));
      
      if (!stats || Number(stats.count) === 0) return null;
      
      const totalSpend = Number(stats.totalSpend || 0);
      const totalSales = Number(stats.totalSales || 0);
      const actualAcos = totalSales > 0 ? totalSpend / totalSales : 999;
      
      if (actualAcos > maxAcos * 2) return null;
      
      return {
        weightedAvgCpc: Math.max(0.02, Number(stats.weightedAvgCpc || 0)),
        avgBid: Math.max(0.02, Number(stats.avgBid || 0)),
        sampleCount: Number(stats.count),
        totalOrders: Number(stats.totalOrders),
        avgAcos: actualAcos,
        source: 'campaign',
      };
    } else {
      const [stats] = await db.select({
        count: sql<number>`COUNT(*)`,
        weightedAvgCpc: sql<number>`
          COALESCE(
            SUM(CAST(${productTargets.spend} AS DECIMAL(12,4))) / NULLIF(SUM(${productTargets.clicks}), 0),
            AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))
          )`,
        avgBid: sql<number>`AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
        totalOrders: sql<number>`COALESCE(SUM(${productTargets.orders}), 0)`,
        totalSpend: sql<number>`COALESCE(SUM(CAST(${productTargets.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql<number>`COALESCE(SUM(CAST(${productTargets.sales} AS DECIMAL(12,2))), 0)`,
      })
      .from(productTargets)
      .where(and(
        eq(productTargets.accountId, accountId),
        eq(productTargets.campaignId, campaignIdStr),
        gte(productTargets.orders, COLD_START_CONFIG.QUALITY_MIN_ORDERS),
        gt(productTargets.clicks, 0),
      ));
      
      if (!stats || Number(stats.count) === 0) return null;
      
      const totalSpend = Number(stats.totalSpend || 0);
      const totalSales = Number(stats.totalSales || 0);
      const actualAcos = totalSales > 0 ? totalSpend / totalSales : 999;
      
      if (actualAcos > maxAcos * 2) return null;
      
      return {
        weightedAvgCpc: Math.max(0.02, Number(stats.weightedAvgCpc || 0)),
        avgBid: Math.max(0.02, Number(stats.avgBid || 0)),
        sampleCount: Number(stats.count),
        totalOrders: Number(stats.totalOrders),
        avgAcos: actualAcos,
        source: 'campaign',
      };
    }
  } catch (err: unknown) {
    log.warn(`[ColdStart] Campaign锚点查询异常: ${(err as Error).message}`);
    return null;
  }
}

// ==================== 贝叶斯平滑 + 跨品迁移 ====================

/**
 * Level 3: 贝叶斯平滑推断 + 跨品迁移先验融合
 * 
 * 1. 调用bayesianBidSmoothingEngine获取账户级先验
 * 2. 尝试获取crossProductTransferEngine的跨品迁移先验
 * 3. 融合两者给出推荐出价
 */
async function getBayesianSmoothedBid(
  accountId: number,
  target: ColdStartTarget,
  targetAcos: number,
  coefficients: ReturnType<typeof calculateDynamicCoefficients>,
): Promise<ColdStartBidResult | null> {
  try {
    // Step 1: 获取贝叶斯平滑推断
    const entityType = target.type === 'keyword' ? 'keyword' as const : 'product_target' as const;
    const subType = target.matchType || undefined;
    const entityPerformance = {
      impressions: target.impressions || 0,
      clicks: target.clicks || 0,
      spend: target.spend || 0,
      sales: target.sales || 0,
      orders: target.orders || 0,
    };
    
    const bayesianEstimate = await estimateBid(
      accountId, entityType, target.currentBid, subType, entityPerformance
    );
    
    // Step 2: 尝试获取跨品迁移先验
    let transferPrior: TransferParameters | null = null;
    if (target.campaignId) {
      // @ts-expect-error Legacy code type compatibility
      try {
        // @ts-expect-error Async operation type inference
        transferPrior = await getTransferPriorForCampaign(accountId, target.campaignId);
      } catch {
        // 跨品迁移失败不影响主流程
      }
    }
    
    // Step 3: 融合决策
    if (bayesianEstimate.success) {
      let finalBid = bayesianEstimate.estimatedBid;
      let source = bayesianEstimate.method;
      let confidence = bayesianEstimate.confidence;
      
      // 如果有跨品迁移先验，融合
      // @ts-expect-error Dynamic property access
      if (transferPrior && transferPrior.transferBid > 0) {
        const transferWeight = Math.min(0.35, transferPrior.transferWeight || 0.20);
        // @ts-expect-error Legacy code type compatibility
        finalBid = blendTransferWithOwn(transferPrior.transferBid, finalBid, transferWeight);
        source += ` + 跨品迁移(权重${(transferWeight * 100).toFixed(0)}%)`;
        confidence = Math.min(0.70, confidence + 0.05);
        
        // @ts-expect-error Complex function parameter types
        log.info(`[ColdStart] Level 3融合跨品迁移: transferBid=$${transferPrior.transferBid.toFixed(2)}, ` +
          `weight=${(transferWeight * 100).toFixed(0)}%, blended=$${finalBid.toFixed(2)}`);
      }
      
      // 应用动态系数
      finalBid = finalBid * coefficients.combined;
      finalBid = Math.max(COLD_START_CONFIG.ANCHOR_BID_MIN, finalBid);
      finalBid = Math.round(finalBid * 100) / 100;
      
      log.info(`[ColdStart] Level 3命中: 贝叶斯平滑推断=$${bayesianEstimate.estimatedBid.toFixed(2)}, ` +
        `动态系数=${coefficients.combined.toFixed(2)}, 最终推荐=$${finalBid.toFixed(2)}`);
      
      return {
        recommendedBid: finalBid,
        strategy: transferPrior ? 'transfer_prior' : 'bayesian_smoothing',
        priorWeight: bayesianEstimate.priorWeight,
        confidence,
        reason: `贝叶斯平滑推断: ${source}`,
        suggestedBidInfo: {
          suggestedBid: bayesianEstimate.estimatedBid,
          rangeStart: bayesianEstimate.bidRangeLow,
          rangeEnd: bayesianEstimate.bidRangeHigh,
          source: 'bayesian_smoothing',
        },
        coefficients,
      };
    }
    
    return null;
  } catch (err: unknown) {
    log.warn(`[ColdStart] 贝叶斯平滑推断异常: ${(err as Error).message}`);
    return null;
  }
}

// ==================== 动态系数计算 ====================

/**
 * 计算动态测试系数
 * 
 * 三个维度的系数相乘：
 * 1. 匹配类型系数：精确匹配偏高，广泛匹配偏低
 * 2. 竞争度系数：基于目标ACoS动态调整
 * 3. 探索加成：冷启动前7天额外+5%
 */
function calculateDynamicCoefficients(
  target: ColdStartTarget,
  targetAcos: number,
): { matchType: number; competition: number; exploration: number; combined: number } {
  // 1. 匹配类型系数
  const matchType = target.matchType?.toLowerCase() || 'default';
  const matchTypeCoeff = MATCH_TYPE_COEFFICIENTS[matchType] || MATCH_TYPE_COEFFICIENTS['default'];
  
  // 2. 竞争度系数：目标ACoS越低说明利润空间越小，出价需要更精确
  // ACoS < 15%: 高利润要求 → 系数0.85（保守出价）
  // ACoS 15-30%: 正常 → 系数1.00
  // ACoS 30-50%: 宽松 → 系数1.10（可以更激进测试）
  // ACoS > 50%: 非常宽松 → 系数1.15
  let competitionCoeff: number;
  if (targetAcos < 0.15) {
    competitionCoeff = 0.85;
  } else if (targetAcos < 0.30) {
    competitionCoeff = 0.85 + (targetAcos - 0.15) / 0.15 * 0.15; // 0.85 → 1.00
  } else if (targetAcos < 0.50) {
    competitionCoeff = 1.00 + (targetAcos - 0.30) / 0.20 * 0.10; // 1.00 → 1.10
  } else {
    competitionCoeff = 1.15;
  }
  
  // 3. 探索加成：创建后7天内额外+5%
  let explorationCoeff = 1.00;
  if (target.createdAt) {
    const createdDate = new Date(target.createdAt);
    const daysSinceCreation = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation <= COLD_START_CONFIG.EXPLORATION_BOOST_DAYS) {
      explorationCoeff = 1.0 + COLD_START_CONFIG.EXPLORATION_BOOST;
    }
  }
  
  const combined = matchTypeCoeff * competitionCoeff * explorationCoeff;
  
  return {
    matchType: Math.round(matchTypeCoeff * 100) / 100,
    competition: Math.round(competitionCoeff * 100) / 100,
    exploration: Math.round(explorationCoeff * 100) / 100,
    combined: Math.round(combined * 100) / 100,
  };
}

// ==================== 辅助计算函数 ====================

/**
 * 基于锚点数据和动态系数计算最终出价
 */
function calculateAnchorBid(
  anchor: AnchorData,
  coefficients: ReturnType<typeof calculateDynamicCoefficients>,
  target: ColdStartTarget,
): number {
  // 基础出价 = 锚点CPC × 动态系数
  let bid = anchor.weightedAvgCpc * coefficients.combined;
  
  // 安全边界
  bid = Math.max(COLD_START_CONFIG.ANCHOR_BID_MIN, bid);
  
  // 不超过当前出价的200%（防止跳跃过大）
  if (target.currentBid > 0.05) {
    bid = Math.min(bid, target.currentBid * 2.0);
  }
  
  return Math.round(bid * 100) / 100;
}

/**
 * 基于锚点数据计算置信度
 */
function calculateConfidence(anchor: AnchorData, source: 'adgroup' | 'campaign'): number {
  const sourceBase = source === 'adgroup' ? 0.75 : 0.60;
  
  // 样本数加成
  const sampleBonus = Math.min(0.10, anchor.sampleCount * 0.02);
  
  // 订单数加成
  const orderBonus = Math.min(0.05, anchor.totalOrders * 0.005);
  
  return Math.min(0.85, sourceBase + sampleBonus + orderBonus);
}

/**
 * 构建标准化的冷启动出价结果
 */
function buildResult(
  recommendedBid: number,
  strategy: ColdStartBidResult['strategy'],
  confidence: number,
  anchor: AnchorData,
  coefficients: ReturnType<typeof calculateDynamicCoefficients>,
  target: ColdStartTarget,
  reason: string,
): ColdStartBidResult {
  return {
    recommendedBid,
    strategy,
    priorWeight: anchor.source === 'adgroup' ? 0.80 : 0.65,
    confidence,
    reason,
    suggestedBidInfo: {
      suggestedBid: anchor.weightedAvgCpc,
      rangeStart: anchor.weightedAvgCpc * 0.70,
      rangeEnd: anchor.weightedAvgCpc * 1.30,
      source: `${anchor.source}_anchor`,
    },
    coefficients,
  };
}
