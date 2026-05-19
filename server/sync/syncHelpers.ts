/**
 * 同步辅助函数 (v223)
 * 
 * 从 amazonSyncService.ts 中提取的辅助工具函数，
 * 供 syncWithTracking 和其他同步模块使用。
 */

import { eq, and, gte, inArray, sql, isNotNull, ne } from 'drizzle-orm';
import { getDb } from '../db';
import { optimizationEvents, keywords } from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('SyncHelpers');

// ==================== 同步保护配置 ====================

export const SYNC_PROTECTION_CONFIG = {
  /** 出价保护时间窗口（小时） */
  BID_PROTECTION_HOURS: 24,
  /** 预算保护时间窗口（小时） */
  BUDGET_PROTECTION_HOURS: 24,
  /** 出价/预算差异阈值（美元） */
  BID_THRESHOLD: 0.01,
} as const;

/**
 * v737: 检查是否有最近已同步的优化操作
 * 重构：对于bid_adjustment类型，基于keywords表的真实状态判断
 * 对于budget_adjustment类型，仍使用optimization_events（但要求有api_response_id）
 */
export async function hasRecentSyncedOptimization(
  keywordId?: number,
  campaignId?: number,
  category: 'bid_adjustment' | 'budget_adjustment' = 'bid_adjustment',
  hoursWindow: number = 24
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    
    if (category === 'bid_adjustment' && keywordId) {
      // v737: 对于bid_adjustment，直接查询keywords表的真实状态
      const result = await db
        .select({ id: keywords.id })
        .from(keywords)
        .where(and(
          eq(keywords.id, keywordId),
          // @ts-ignore Legacy column type compatibility
          eq(keywords.bidSyncStatus, 'pending_confirmation'),
          // @ts-ignore Legacy column type compatibility
          isNotNull(keywords.lastApiResponseId),
          // @ts-ignore Legacy column type compatibility
          gte(keywords.lastOptimizedAt, cutoff)
        ))
        .limit(1);
      return result.length > 0;
    }
    
    // 对于budget_adjustment或无keywordId的情况，仍使用optimization_events但要求有api_response_id
    const conditions: unknown[] = [
      eq(optimizationEvents.eventCategory, category),
      eq(optimizationEvents.apiSyncStatus, 'synced'),
      gte(optimizationEvents.createdAt, cutoff),
      // v737: 要求有API执行凭证
      isNotNull(optimizationEvents.apiResponseId),
    ];
    
    if (keywordId) {
      // @ts-ignore Array method type inference
      conditions.push(eq(optimizationEvents.keywordId, keywordId));
    }
    // @ts-ignore Conditional type narrowing
    if (campaignId) {
      // @ts-ignore Array method type inference
      conditions.push(eq(optimizationEvents.campaignId, campaignId));
    }
    
    const result = await db.select({ id: optimizationEvents.id })
      .from(optimizationEvents)
      // @ts-ignore - Drizzle dynamic where conditions
      .where(and(...conditions))
      .limit(1);
    
    return result.length > 0;
  } catch (error: any) {
    return false;
  }
}

/**
 * v737: 重构出价保护机制 - 基于keywords表的bid_sync_status和last_api_response_id判断保护
 * 替代旧的基于optimization_events.api_sync_status='synced'的不可靠判断
 * 
 * 保护条件（同时满足）：
 * 1. bid_sync_status = 'pending_confirmation' — 表示出价已发送但未验证
 * 2. last_api_response_id IS NOT NULL — 表示有Amazon API执行凭证
 * 3. last_optimized_at >= cutoff — 在保护时间窗口内
 */
export async function getRecentlyOptimizedKeywordIds(
  keywordIds: number[],
  hoursWindow: number = 24
): Promise<Set<number>> {
  try {
    if (keywordIds.length === 0) return new Set();
    const db = await getDb();
    if (!db) {
      log.warn('v737: 数据库连接不可用，保护机制无法工作！');
      return new Set();
    }
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    
    // v737: 直接查询keywords表 - 基于真实的API执行凭证判断保护
    const results = await db
      .select({ id: keywords.id })
      .from(keywords)
      .where(and(
        inArray(keywords.id, keywordIds),
        // @ts-ignore Legacy column type compatibility
        eq(keywords.bidSyncStatus, 'pending_confirmation'),
        // @ts-ignore Legacy column type compatibility
        isNotNull(keywords.lastApiResponseId),
        // @ts-ignore Legacy column type compatibility
        gte(keywords.lastOptimizedAt, cutoff)
      ));
    
    const protectedSet = new Set(results.map(r => r.id).filter(Boolean));
    
    log.info(`v737: 出价保护查询完成, 输入${keywordIds.length}个关键词, 保护${protectedSet.size}个 (基于pending_confirmation+apiResponseId)`);
    // @ts-ignore Return type compatibility
    return protectedSet;
  } catch (error: any) {
    log.warn('v737: 批量查询优化关键词失败，保护机制降级！', (error instanceof Error ? (error as Error).message : String(error)));
    return new Set();
  }
}

/**
 * v150+v212: 批量查询有近期预算优化事件的广告活动ID集合
 */
export async function getRecentlyOptimizedCampaignIds(
  campaignIds: number[],
  hoursWindow: number = 24
): Promise<Set<number>> {
  try {
    if (campaignIds.length === 0) return new Set();
    const db = await getDb();
    if (!db) {
      log.warn('v212: 数据库连接不可用，预算保护机制无法工作！');
      return new Set();
    }
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    
    const results = await db
      // @ts-ignore DB query type inference limitation
      .select({ campaignId: optimizationEvents.campaignId })
      .from(optimizationEvents)
      .where(and(
        eq(optimizationEvents.eventCategory, 'budget_adjustment'),
        eq(optimizationEvents.apiSyncStatus, 'synced'),
        gte(optimizationEvents.createdAt, cutoff),
        // @ts-ignore Legacy code type compatibility
        inArray(optimizationEvents.campaignId, campaignIds)
      ))
      .groupBy(optimizationEvents.campaignId);
    
    const protectedSet = new Set(results.map(r => r.campaignId!).filter(Boolean));
    log.info(`v212: 预算保护查询完成, 输入${campaignIds.length}个广告活动, 保护${protectedSet.size}个`);
    // @ts-ignore Return type compatibility
    return protectedSet;
  } catch (error: any) {
    log.warn('v212: 批量查询优化广告活动失败:', (error instanceof Error ? (error as Error).message : String(error)));
    return new Set();
  }
}

// ==================== 同步保护统计 ====================

export interface SyncProtectionStats {
  bidProtected: number;
  bidOverwritten: number;
  budgetProtected: number;
  budgetOverwritten: number;
  protectedEntities: string[];
}

export function createSyncProtectionStats(): SyncProtectionStats {
  return { bidProtected: 0, bidOverwritten: 0, budgetProtected: 0, budgetOverwritten: 0, protectedEntities: [] };
}

export function logSyncProtectionSummary(functionName: string, stats: SyncProtectionStats): void {
  const total = stats.bidProtected + stats.bidOverwritten + stats.budgetProtected + stats.budgetOverwritten;
  if (total === 0) return;
  log.info(`${functionName} 同步保护摘要: ` +
    `出价保护=${stats.bidProtected}, 出价覆盙=${stats.bidOverwritten}, ` +
    `预算保护=${stats.budgetProtected}, 预算覆盙=${stats.budgetOverwritten}`);
  if (stats.protectedEntities.length > 0) {
    log.debug(`${functionName} 被保护实体: ${stats.protectedEntities.slice(0, 20).join(', ')}${stats.protectedEntities.length > 20 ? ` ...等${stats.protectedEntities.length}个` : ''}`);
  }
}

/**
 * 检测数据冲突
 * 注意：空值（空字符串、"0"、null、undefined）被视为"无数据"，不与远程数据产生冲突
 */
export function detectConflict(
  existing: Record<string, unknown>,
  newData: Record<string, unknown>,
  fieldsToCheck: string[]
): { hasConflict: boolean; conflictFields: string[] } {
  const conflictFields: string[] = [];
  
  const isEmptyValue = (value: Record<string, unknown>): boolean => {
    if (value === undefined || value === null) return true;
    // @ts-ignore Type inference limitation
    const strValue = String(value).trim();
    // @ts-ignore Return type compatibility
    return strValue === '' || strValue === '0' || strValue === '0.00' || strValue === '0.0';
  };
  
  for (const field of fieldsToCheck) {
    const existingValue = existing[field];
    const newValue = newData[field];
    
    // @ts-ignore Conditional type narrowing
    if (isEmptyValue(existingValue)) continue;
    // @ts-ignore Conditional type narrowing
    if (isEmptyValue(newValue)) continue;
    
    const existingStr = String(existingValue).trim();
    const newStr = String(newValue).trim();
    
    if (existingStr !== newStr) {
      conflictFields.push(field);
    }
  }
  
  return {
    hasConflict: conflictFields.length > 0,
    conflictFields,
  };
}
