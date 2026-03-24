/**
 * 历史CPC动态底线服务 (Historical CPC Floor Service)
 * 
 * v510: 核心升级 — 动态历史CPC底线替代固定比例底线
 * 
 * 核心理念（来自"竞价锚定原则"）：
 * 出价永远不应跌破维持基本曝光所需的历史验证成本。
 * 一个投放词在历史稳定出单期的CPC，是该词维持竞争力的最低锚点。
 * 
 * 底线公式：
 *   Bid Floor = max(历史稳定出单期平均CPC × 0.85, 当前出价 × minBidFloorRatio)
 * 
 * 数据来源：
 * - keywords表: keywordCpc字段（汇总历史CPC）
 * - daily_performance表: 按日期窗口计算精确的历史CPC
 * - product_targets表: 对于ASIN定向的历史CPC
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('HistoricalCpcFloor');

/**
 * 历史CPC底线计算结果
 */
export interface HistoricalCpcFloorResult {
  /** 计算得到的动态底线 */
  dynamicFloor: number;
  /** 历史稳定出单期的平均CPC */
  historicalCpc: number;
  /** 底线来源说明 */
  source: 'historical_cpc' | 'ratio_fallback' | 'no_data';
  /** 历史出单期的订单数 */
  historicalOrders: number;
  /** 历史数据的时间范围描述 */
  periodDescription: string;
}

/**
 * 获取关键词的历史CPC动态底线
 * 
 * 查询逻辑：
 * 1. 优先使用daily_performance中60-90天前的出单期数据计算精确CPC
 * 2. 回退到keywords表的keywordCpc汇总字段
 * 3. 最终回退到固定比例底线
 * 
 * @param accountId 账户ID
 * @param keywordId 关键词ID（内部数据库ID）
 * @param currentBid 当前出价
 * @param minBidFloorRatio 固定比例底线系数（默认0.50）
 * @returns 历史CPC底线计算结果
 */
export async function getKeywordCpcFloor(
  accountId: number,
  keywordId: number,
  currentBid: number,
  minBidFloorRatio: number = 0.50
): Promise<HistoricalCpcFloorResult> {
  const ratioFloor = currentBid * minBidFloorRatio;
  
  try {
    const db = await getDb();
    if (!db) {
      return { dynamicFloor: ratioFloor, historicalCpc: 0, source: 'ratio_fallback', historicalOrders: 0, periodDescription: 'DB不可用' };
    }
    
    // 策略1: 查询daily_performance中30-90天前的出单期数据
    // 选择30-90天窗口是因为：这段时间的数据已经完成归因，且足够代表稳定表现
    const result = await db.execute(sql`
      SELECT 
        COALESCE(SUM(dp.spend), 0) as total_spend,
        COALESCE(SUM(dp.clicks), 0) as total_clicks,
        COALESCE(SUM(dp.orders), 0) as total_orders,
        COUNT(DISTINCT dp.report_date) as data_days
      FROM daily_performance dp
      WHERE dp.account_id = ${accountId}
        AND dp.keyword_id = ${keywordId}
        AND dp.report_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND dp.report_date <= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND dp.orders > 0
    `);
    
    const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
    const row = (rows as Array<Record<string, unknown>>)[0];
    
    if (row) {
      const totalSpend = Number(row.total_spend) || 0;
      const totalClicks = Number(row.total_clicks) || 0;
      const totalOrders = Number(row.total_orders) || 0;
      const dataDays = Number(row.data_days) || 0;
      
      if (totalClicks >= 10 && totalOrders >= 2) {
        const historicalCpc = totalSpend / totalClicks;
        const dynamicFloor = Math.max(historicalCpc * 0.85, ratioFloor);
        
        log.info(`[CpcFloor] keyword=${keywordId}: 历史CPC=$${historicalCpc.toFixed(2)} (${dataDays}天出单数据, ${totalOrders}单), 动态底线=$${dynamicFloor.toFixed(2)}`);
        
        return {
          dynamicFloor,
          historicalCpc,
          source: 'historical_cpc',
          historicalOrders: totalOrders,
          periodDescription: `30-90天出单期(${dataDays}天, ${totalOrders}单, ${totalClicks}次点击)`,
        };
      }
    }
    
    // 策略2: 回退到keywords表的keywordCpc汇总字段
    const kwResult = await db.execute(sql`
      SELECT keyword_cpc, orders
      FROM keywords
      WHERE id = ${keywordId} AND account_id = ${accountId}
    `);
    
    const kwRows = Array.isArray(kwResult) ? (Array.isArray(kwResult[0]) ? kwResult[0] : kwResult) : [];
    const kwRow = (kwRows as Array<Record<string, unknown>>)[0];
    
    if (kwRow) {
      const keywordCpc = Number(kwRow.keyword_cpc) || 0;
      const orders = Number(kwRow.orders) || 0;
      
      if (keywordCpc > 0 && orders >= 4) {
        const dynamicFloor = Math.max(keywordCpc * 0.85, ratioFloor);
        
        log.info(`[CpcFloor] keyword=${keywordId}: 汇总CPC=$${keywordCpc.toFixed(2)} (${orders}单), 动态底线=$${dynamicFloor.toFixed(2)}`);
        
        return {
          dynamicFloor,
          historicalCpc: keywordCpc,
          source: 'historical_cpc',
          historicalOrders: orders,
          periodDescription: `keywords表汇总(${orders}单)`,
        };
      }
    }
    
    // 策略3: 无历史数据，回退到固定比例底线
    return {
      dynamicFloor: ratioFloor,
      historicalCpc: 0,
      source: 'no_data',
      historicalOrders: 0,
      periodDescription: '无历史出单数据',
    };
    
  } catch (error: unknown) {
    log.warn(`[CpcFloor] 查询失败(keyword=${keywordId}): ${(error as Error).message}`);
    return { dynamicFloor: ratioFloor, historicalCpc: 0, source: 'ratio_fallback', historicalOrders: 0, periodDescription: '查询异常' };
  }
}

/**
 * 获取Product Target的历史CPC动态底线
 * 
 * 与关键词逻辑类似，但查询product_targets表
 */
export async function getTargetCpcFloor(
  accountId: number,
  targetId: number,
  currentBid: number,
  minBidFloorRatio: number = 0.50
): Promise<HistoricalCpcFloorResult> {
  const ratioFloor = currentBid * minBidFloorRatio;
  
  try {
    const db = await getDb();
    if (!db) {
      return { dynamicFloor: ratioFloor, historicalCpc: 0, source: 'ratio_fallback', historicalOrders: 0, periodDescription: 'DB不可用' };
    }
    
    // 查询daily_performance中30-90天前的出单期数据
    const result = await db.execute(sql`
      SELECT 
        COALESCE(SUM(dp.spend), 0) as total_spend,
        COALESCE(SUM(dp.clicks), 0) as total_clicks,
        COALESCE(SUM(dp.orders), 0) as total_orders,
        COUNT(DISTINCT dp.report_date) as data_days
      FROM daily_performance dp
      WHERE dp.account_id = ${accountId}
        AND dp.target_id = ${targetId}
        AND dp.report_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND dp.report_date <= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND dp.orders > 0
    `);
    
    const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
    const row = (rows as Array<Record<string, unknown>>)[0];
    
    if (row) {
      const totalSpend = Number(row.total_spend) || 0;
      const totalClicks = Number(row.total_clicks) || 0;
      const totalOrders = Number(row.total_orders) || 0;
      const dataDays = Number(row.data_days) || 0;
      
      if (totalClicks >= 10 && totalOrders >= 2) {
        const historicalCpc = totalSpend / totalClicks;
        const dynamicFloor = Math.max(historicalCpc * 0.85, ratioFloor);
        
        return {
          dynamicFloor,
          historicalCpc,
          source: 'historical_cpc',
          historicalOrders: totalOrders,
          periodDescription: `30-90天出单期(${dataDays}天, ${totalOrders}单)`,
        };
      }
    }
    
    // 回退到product_targets表的汇总字段
    const ptResult = await db.execute(sql`
      SELECT target_cpc, orders
      FROM product_targets
      WHERE id = ${targetId} AND account_id = ${accountId}
    `);
    
    const ptRows = Array.isArray(ptResult) ? (Array.isArray(ptResult[0]) ? ptResult[0] : ptResult) : [];
    const ptRow = (ptRows as Array<Record<string, unknown>>)[0];
    
    if (ptRow) {
      const targetCpc = Number(ptRow.target_cpc) || 0;
      const orders = Number(ptRow.orders) || 0;
      
      if (targetCpc > 0 && orders >= 4) {
        const dynamicFloor = Math.max(targetCpc * 0.85, ratioFloor);
        return {
          dynamicFloor,
          historicalCpc: targetCpc,
          source: 'historical_cpc',
          historicalOrders: orders,
          periodDescription: `product_targets表汇总(${orders}单)`,
        };
      }
    }
    
    return {
      dynamicFloor: ratioFloor,
      historicalCpc: 0,
      source: 'no_data',
      historicalOrders: 0,
      periodDescription: '无历史出单数据',
    };
    
  } catch (error: unknown) {
    log.warn(`[CpcFloor] 查询失败(target=${targetId}): ${(error as Error).message}`);
    return { dynamicFloor: ratioFloor, historicalCpc: 0, source: 'ratio_fallback', historicalOrders: 0, periodDescription: '查询异常' };
  }
}

/**
 * 统一入口：根据实体类型获取动态CPC底线
 */
export async function getDynamicBidFloor(
  accountId: number,
  entityType: 'keyword' | 'product_target',
  entityId: number,
  currentBid: number,
  minBidFloorRatio: number = 0.50
): Promise<HistoricalCpcFloorResult> {
  if (entityType === 'keyword') {
    return getKeywordCpcFloor(accountId, entityId, currentBid, minBidFloorRatio);
  } else {
    return getTargetCpcFloor(accountId, entityId, currentBid, minBidFloorRatio);
  }
}
