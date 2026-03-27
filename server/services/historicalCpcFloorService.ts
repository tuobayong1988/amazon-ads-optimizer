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
    
    // v529: daily_performance是campaign级别的表，没有keyword_id列
    // 改为直接使用keywords表的汇总字段(keywordCpc, orders)
    // 策略1: 查询keywords表的keywordCpc汇总字段
    const kwResult = await db.execute(sql`
      SELECT keywordCpc, orders
      FROM keywords
      WHERE id = ${keywordId} AND accountId = ${accountId}
    `);
    
    const kwRows = Array.isArray(kwResult) ? (Array.isArray(kwResult[0]) ? kwResult[0] : kwResult) : [];
    const kwRow = (kwRows as Array<Record<string, unknown>>)[0];
    
    if (kwRow) {
      const keywordCpc = Number(kwRow.keywordCpc) || 0;
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
    
    // v529: daily_performance是campaign级别的表，没有target_id列
    // 改为直接使用product_targets表的汇总字段(targetCpc, orders)
    const ptResult = await db.execute(sql`
      SELECT targetCpc, orders
      FROM product_targets
      WHERE id = ${targetId} AND accountId = ${accountId}
    `);
    
    const ptRows = Array.isArray(ptResult) ? (Array.isArray(ptResult[0]) ? ptResult[0] : ptResult) : [];
    const ptRow = (ptRows as Array<Record<string, unknown>>)[0];
    
    if (ptRow) {
      const targetCpc = Number(ptRow.targetCpc) || 0;
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
