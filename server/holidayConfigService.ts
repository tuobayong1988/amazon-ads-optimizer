/**
 * 节假日配置服务
 * 管理用户自定义的节假日和促销日配置
 */

import { getDb } from './db';
import { holidayConfigurations, type InsertHolidayConfiguration } from '../drizzle/schema';
import { eq, and, gte, lte, desc, sql, or } from 'drizzle-orm';
import { MARKETPLACE_HOLIDAYS, type HolidayConfig } from './algorithmUtils';

/**
 * 创建节假日配置
 */
export async function createHolidayConfig(
  data: InsertHolidayConfiguration
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const [result] = await db.insert(holidayConfigurations).values({
    ...data,
    createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
  });
  
  return result.insertId;
}

/**
 * 批量创建系统默认节假日配置
 */
export async function initializeSystemHolidays(
  userId: number,
  marketplace: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const holidays = MARKETPLACE_HOLIDAYS[marketplace] || MARKETPLACE_HOLIDAYS['US'];
  
  const records: InsertHolidayConfiguration[] = holidays.map(holiday => {
    let startDate: string;
    let endDate: string;
    
    if (holiday.date.includes('~')) {
      [startDate, endDate] = holiday.date.split('~');
    } else {
      startDate = holiday.date;
      endDate = holiday.date;
    }
    
    return {
      userId,
      marketplace,
      name: holiday.name,
      startDate,
      endDate,
      bidMultiplier: holiday.bidMultiplier.toString(),
      budgetMultiplier: holiday.budgetMultiplier.toString(),
      priority: holiday.priority,
      isActive: 1,
      isSystemDefault: 1,
      preHolidayDays: 7,
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
    };
  });
  
  if (records.length === 0) return 0;
  
  await db.insert(holidayConfigurations).values(records);
  return records.length;
}

/**
 * 获取用户的节假日配置
 */
export async function getHolidayConfigs(
  userId: number,
  marketplace?: string
): Promise<typeof holidayConfigurations.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  return db
    .select()
    .from(holidayConfigurations)
    .where(
      and(
        eq(holidayConfigurations.userId, userId),
        marketplace ? eq(holidayConfigurations.marketplace, marketplace) : undefined
      )
    )
    .orderBy(holidayConfigurations.startDate);
}

/**
 * 获取指定日期的节假日配置
 */
export async function getHolidayConfigForDate(
  userId: number,
  marketplace: string,
  date: Date
): Promise<typeof holidayConfigurations.$inferSelect | null> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const dateStr = date.toISOString().split('T')[0];
  
  const [result] = await db
    .select()
    .from(holidayConfigurations)
    .where(
      and(
        eq(holidayConfigurations.userId, userId),
        eq(holidayConfigurations.marketplace, marketplace),
        eq(holidayConfigurations.isActive, 1),
        lte(holidayConfigurations.startDate, dateStr),
        gte(holidayConfigurations.endDate, dateStr)
      )
    )
    .orderBy(desc(sql`CASE 
      WHEN ${holidayConfigurations.priority} = 'high' THEN 3 
      WHEN ${holidayConfigurations.priority} = 'medium' THEN 2 
      ELSE 1 
    END`))
    .limit(1);
  
  return result || null;
}

/**
 * 更新节假日配置
 */
export async function updateHolidayConfig(
  id: number,
  data: Partial<InsertHolidayConfiguration>
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  await db
    .update(holidayConfigurations)
    .set({
      ...data,
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
    })
    .where(eq(holidayConfigurations.id, id));
  
  return true;
}

/**
 * 删除节假日配置
 */
export async function deleteHolidayConfig(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  await db
    .delete(holidayConfigurations)
    .where(eq(holidayConfigurations.id, id));
  
  return true;
}

/**
 * 切换节假日配置的启用状态
 */
export async function toggleHolidayConfig(
  id: number,
  isActive: boolean
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  await db
    .update(holidayConfigurations)
    .set({
      isActive: isActive ? 1 : 0,
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
    })
    .where(eq(holidayConfigurations.id, id));
  
  return true;
}

/**
 * 获取即将到来的节假日（未来30天内）
 */
export async function getUpcomingHolidays(
  userId: number,
  marketplace?: string,
  days: number = 30
): Promise<typeof holidayConfigurations.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const today = new Date().toISOString().split('T')[0];
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  const futureDateStr = futureDate.toISOString().split('T')[0];
  
  return db
    .select()
    .from(holidayConfigurations)
    .where(
      and(
        eq(holidayConfigurations.userId, userId),
        marketplace ? eq(holidayConfigurations.marketplace, marketplace) : undefined,
        eq(holidayConfigurations.isActive, 1),
        gte(holidayConfigurations.startDate, today),
        lte(holidayConfigurations.startDate, futureDateStr)
      )
    )
    .orderBy(holidayConfigurations.startDate);
}

/**
 * 获取预热期内的节假日配置
 */
export async function getPreHolidayConfig(
  userId: number,
  marketplace: string,
  date: Date
): Promise<{
  holiday: typeof holidayConfigurations.$inferSelect;
  daysUntil: number;
  bidMultiplier: number;
  budgetMultiplier: number;
} | null> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const dateStr = date.toISOString().split('T')[0];
  const dateMs = date.getTime();
  
  // 获取所有高优先级的未来节假日
  const holidays = await db
    .select()
    .from(holidayConfigurations)
    .where(
      and(
        eq(holidayConfigurations.userId, userId),
        eq(holidayConfigurations.marketplace, marketplace),
        eq(holidayConfigurations.isActive, 1),
        eq(holidayConfigurations.priority, 'high'),
        gte(holidayConfigurations.startDate, dateStr)
      )
    )
    .orderBy(holidayConfigurations.startDate);
  
  for (const holiday of holidays) {
    const holidayStartDate = new Date(holiday.startDate);
    const daysUntil = Math.floor((holidayStartDate.getTime() - dateMs) / (1000 * 60 * 60 * 24));
    
    if (daysUntil > 0 && daysUntil <= holiday.preHolidayDays) {
      // 在预热期内，线性增加乘数
      const progress = 1 - daysUntil / holiday.preHolidayDays;
      const baseBidMultiplier = parseFloat(holiday.bidMultiplier);
      const baseBudgetMultiplier = parseFloat(holiday.budgetMultiplier);
      
      const bidMultiplier = 1 + (baseBidMultiplier - 1) * progress * 0.5;
      const budgetMultiplier = 1 + (baseBudgetMultiplier - 1) * progress * 0.5;
      
      return {
        holiday,
        daysUntil,
        bidMultiplier: Math.round(bidMultiplier * 100) / 100,
        budgetMultiplier: Math.round(budgetMultiplier * 100) / 100
      };
    }
  }
  
  return null;
}

/**
 * 获取完整的日期调整乘数（结合数据库配置和默认配置）
 */
export async function getDateAdjustmentMultipliersFromDb(
  userId: number,
  marketplace: string,
  date: Date
): Promise<{
  bidMultiplier: number;
  budgetMultiplier: number;
  reason: string;
  holidayName: string | null;
}> {
  // 首先检查是否为节假日
  const holidayConfig = await getHolidayConfigForDate(userId, marketplace, date);
  if (holidayConfig) {
    return {
      bidMultiplier: parseFloat(holidayConfig.bidMultiplier),
      budgetMultiplier: parseFloat(holidayConfig.budgetMultiplier),
      reason: `${holidayConfig.name} (${holidayConfig.priority} priority)`,
      holidayName: holidayConfig.name
    };
  }
  
  // 检查是否为预热期
  const preHoliday = await getPreHolidayConfig(userId, marketplace, date);
  if (preHoliday) {
    return {
      bidMultiplier: preHoliday.bidMultiplier,
      budgetMultiplier: preHoliday.budgetMultiplier,
      reason: `Pre-${preHoliday.holiday.name} warm-up period (${preHoliday.daysUntil} days until)`,
      holidayName: preHoliday.holiday.name
    };
  }
  
  return { bidMultiplier: 1, budgetMultiplier: 1, reason: 'Normal day', holidayName: null };
}

/**
 * 获取支持的站点列表
 */
export function getSupportedMarketplaces(): string[] {
  return Object.keys(MARKETPLACE_HOLIDAYS);
}
