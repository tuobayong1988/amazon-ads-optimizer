/**
 * 同步辅助函数 (v223)
 * 
 * 从 amazonSyncService.ts 中提取的辅助工具函数，
 * 供 syncWithTracking 和其他同步模块使用。
 */

import { eq, and, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { optimizationEvents } from '../../../drizzle/schema';
import { createModuleLogger } from '../../utils/logger';

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
 * 检查是否有最近已同步的优化操作
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
    
    const conditions: unknown[] = [
      eq(optimizationEvents.eventCategory, category),
      eq(optimizationEvents.apiSyncStatus, 'synced'),
      gte(optimizationEvents.createdAt, cutoff),
    ];
    
    if (keywordId) {
      conditions.push(eq(optimizationEvents.keywordId, keywordId));
    }
    if (campaignId) {
      conditions.push(eq(optimizationEvents.campaignId, campaignId));
    }
    
    const result = await db.select({ id: optimizationEvents.id })
      .from(optimizationEvents)
      .where(and(...conditions))
      .limit(1);
    
    return result.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * v150+v212: 批量查询有近期出价优化事件的关键词ID集合
 */
export async function getRecentlyOptimizedKeywordIds(
  keywordIds: number[],
  hoursWindow: number = 24
): Promise<Set<number>> {
  try {
    if (keywordIds.length === 0) return new Set();
    const db = await getDb();
    if (!db) {
      log.error('v212: 数据库连接不可用，保护机制无法工作！');
      return new Set();
    }
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    
    // v212: 查询synced状态的记录（主要保护对象）
    const results = await db
      .select({ keywordId: optimizationEvents.keywordId })
      .from(optimizationEvents)
      .where(and(
        eq(optimizationEvents.eventCategory, 'bid_adjustment'),
        eq(optimizationEvents.apiSyncStatus, 'synced'),
        gte(optimizationEvents.createdAt, cutoff),
        inArray(optimizationEvents.keywordId, keywordIds)
      ))
      .groupBy(optimizationEvents.keywordId);
    
    const protectedSet = new Set(results.map(r => r.keywordId!).filter(Boolean));
    
    // v212: Fallback - 如果optimization_events查询结果为空，尝试从optimization_logs中查找
    if (protectedSet.size === 0 && keywordIds.length > 0) {
      try {
        const fallbackResults = await db.execute(
          sql`SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.keywordId')) as kw_id
              FROM optimization_logs
              WHERE log_category = 'bid_adjustment'
                AND api_sync_status IN ('synced', 'partial')
                AND created_at >= ${cutoff}
                AND JSON_EXTRACT(action_detail, '$.keywordId') IS NOT NULL`
        );
        const fallbackRows = (fallbackResults as unknown as any[][])[0] || [];
        if (fallbackRows && fallbackRows.length > 0) {
          const fallbackKeywordIds = new Set(fallbackRows.map((r: Record<string, unknown>) => Number(r.kw_id)).filter((id: number) => id > 0 && keywordIds.includes(id)));
          if (fallbackKeywordIds.size > 0) {
            log.debug(`v212: Fallback查询optimization_logs找到${fallbackKeywordIds.size}个需要保护的关键词`);
            for (const id of fallbackKeywordIds) protectedSet.add(id);
          }
        }
      } catch (fallbackErr) {
        log.warn('v212: Fallback查询optimization_logs失败:', (fallbackErr as any).message);
      }
    }
    
    log.info(`v212: 查询完成, 输入${keywordIds.length}个关键词, 保护${protectedSet.size}个`);
    return protectedSet;
  } catch (error) {
    log.error('v212: 批量查询优化关键词失败，保护机制降级！', (error as any).message);
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
      log.error('v212: 数据库连接不可用，预算保护机制无法工作！');
      return new Set();
    }
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    
    const results = await db
      .select({ campaignId: optimizationEvents.campaignId })
      .from(optimizationEvents)
      .where(and(
        eq(optimizationEvents.eventCategory, 'budget_adjustment'),
        eq(optimizationEvents.apiSyncStatus, 'synced'),
        gte(optimizationEvents.createdAt, cutoff),
        inArray(optimizationEvents.campaignId, campaignIds)
      ))
      .groupBy(optimizationEvents.campaignId);
    
    const protectedSet = new Set(results.map(r => r.campaignId!).filter(Boolean));
    log.info(`v212: 预算保护查询完成, 输入${campaignIds.length}个广告活动, 保护${protectedSet.size}个`);
    return protectedSet;
  } catch (error) {
    log.error('v212: 批量查询优化广告活动失败:', (error as any).message);
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
    const strValue = String(value).trim();
    return strValue === '' || strValue === '0' || strValue === '0.00' || strValue === '0.0';
  };
  
  for (const field of fieldsToCheck) {
    const existingValue = existing[field];
    const newValue = newData[field];
    
    if (isEmptyValue(existingValue)) continue;
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
