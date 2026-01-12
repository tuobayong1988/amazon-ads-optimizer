/**
 * AMS (Amazon Marketing Stream) 数据处理服务
 * 
 * 负责处理从SQS接收的AMS实时数据，并进行时区转换
 * 
 * 核心功能：
 * 1. 将AMS消息中的UTC时间转换为店铺当地时间
 * 2. 按店铺当地日期聚合数据
 * 3. 存储到daily_performance表（dataSource='ams'）
 * 4. 不覆盖已校准的API数据（isFinalized=true）
 */

import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { format, parseISO } from 'date-fns';
import * as db from './db';

// ==================== 类型定义 ====================

/**
 * AMS消息结构（从SQS接收）
 */
export interface AmsMessage {
  messageId: string;
  subscriptionId: string;
  dataSetId: AmsDatasetType;
  timestamp: string;  // UTC时间，ISO 8601格式
  data: AmsTrafficData | AmsBudgetData | AmsConversionData;
}

/**
 * AMS数据集类型
 */
export type AmsDatasetType = 
  | 'sp-traffic'      // SP实时流量数据（曝光、点击、花费）
  | 'sb-traffic'      // SB实时流量数据
  | 'sd-traffic'      // SD实时流量数据
  | 'sp-conversion'   // SP转化数据
  | 'sp-budget-usage' // SP预算使用
  | 'sb-budget-usage' // SB预算使用
  | 'sd-budget-usage';// SD预算使用

/**
 * AMS流量数据结构
 */
export interface AmsTrafficData {
  campaignId: string;
  adGroupId?: string;
  impressions: number;
  clicks: number;
  cost: number;
  eventTime: string;  // UTC时间
}

/**
 * AMS预算数据结构
 */
export interface AmsBudgetData {
  campaignId: string;
  budgetUsed: number;
  budgetRemaining: number;
  eventTime: string;  // UTC时间
}

/**
 * AMS转化数据结构
 */
export interface AmsConversionData {
  campaignId: string;
  adGroupId?: string;
  attributedSales: number;
  attributedConversions: number;
  eventTime: string;  // UTC时间
}

/**
 * 聚合后的AMS数据
 */
export interface AggregatedAmsData {
  accountId: number;
  campaignId: string;
  adGroupId?: string;
  date: string;  // 店铺当地日期，YYYY-MM-DD格式
  adType: 'sp' | 'sb' | 'sd';
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  dataSource: 'ams';
}

// ==================== 时区映射 ====================

/**
 * 亚马逊站点到时区的映射
 * 参考: https://advertising.amazon.com/API/docs/en-us/reference/profiles
 */
export const MARKETPLACE_TIMEZONE_MAP: Record<string, string> = {
  // 北美
  'US': 'America/Los_Angeles',  // 美国 - 太平洋时间
  'CA': 'America/Toronto',      // 加拿大 - 东部时间
  'MX': 'America/Mexico_City',  // 墨西哥 - 中部时间
  'BR': 'America/Sao_Paulo',    // 巴西 - 圣保罗时间
  
  // 欧洲
  'UK': 'Europe/London',        // 英国 - 格林威治时间
  'DE': 'Europe/Berlin',        // 德国 - 中欧时间
  'FR': 'Europe/Paris',         // 法国 - 中欧时间
  'IT': 'Europe/Rome',          // 意大利 - 中欧时间
  'ES': 'Europe/Madrid',        // 西班牙 - 中欧时间
  'NL': 'Europe/Amsterdam',     // 荷兰 - 中欧时间
  'SE': 'Europe/Stockholm',     // 瑞典 - 中欧时间
  'PL': 'Europe/Warsaw',        // 波兰 - 中欧时间
  'TR': 'Europe/Istanbul',      // 土耳其 - 东欧时间
  'BE': 'Europe/Brussels',      // 比利时 - 中欧时间
  
  // 亚太
  'JP': 'Asia/Tokyo',           // 日本 - 日本标准时间
  'AU': 'Australia/Sydney',     // 澳大利亚 - 悉尼时间
  'SG': 'Asia/Singapore',       // 新加坡 - 新加坡时间
  'IN': 'Asia/Kolkata',         // 印度 - 印度标准时间
  'AE': 'Asia/Dubai',           // 阿联酋 - 海湾标准时间
  'SA': 'Asia/Riyadh',          // 沙特 - 阿拉伯标准时间
  'EG': 'Africa/Cairo',         // 埃及 - 东欧时间
};

// ==================== 核心函数 ====================

/**
 * 将UTC时间转换为店铺当地时间的日期
 * 
 * @param utcTimestamp UTC时间戳（ISO 8601格式）
 * @param timezone 店铺时区（如 'America/Los_Angeles'）
 * @returns 店铺当地日期（YYYY-MM-DD格式）
 */
export function convertUtcToLocalDate(utcTimestamp: string, timezone: string): string {
  try {
    // 解析UTC时间
    const utcDate = parseISO(utcTimestamp);
    
    // 转换为目标时区的日期
    const localDate = formatInTimeZone(utcDate, timezone, 'yyyy-MM-dd');
    
    return localDate;
  } catch (error) {
    console.error(`[AMS] 时区转换失败: ${utcTimestamp} -> ${timezone}`, error);
    // 降级处理：使用UTC日期
    return utcTimestamp.split('T')[0];
  }
}

/**
 * 将UTC时间转换为店铺当地时间的完整时间戳
 * 
 * @param utcTimestamp UTC时间戳（ISO 8601格式）
 * @param timezone 店铺时区
 * @returns 店铺当地时间（ISO 8601格式）
 */
export function convertUtcToLocalTimestamp(utcTimestamp: string, timezone: string): string {
  try {
    const utcDate = parseISO(utcTimestamp);
    return formatInTimeZone(utcDate, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
  } catch (error) {
    console.error(`[AMS] 时区转换失败: ${utcTimestamp} -> ${timezone}`, error);
    return utcTimestamp;
  }
}

/**
 * 根据站点代码获取时区
 * 
 * @param marketplace 站点代码（如 'US', 'JP'）
 * @param dbTimezone 数据库中存储的时区（优先使用）
 * @returns 时区字符串
 */
export function getTimezoneForMarketplace(marketplace: string, dbTimezone?: string | null): string {
  // 优先使用数据库中存储的时区（从Amazon API获取的真实时区）
  if (dbTimezone) {
    return dbTimezone;
  }
  
  // 降级使用映射表
  return MARKETPLACE_TIMEZONE_MAP[marketplace] || 'UTC';
}

/**
 * 获取店铺当前日期（基于时区）
 * 
 * @param timezone 店铺时区
 * @returns 当前日期（YYYY-MM-DD格式）
 */
export function getCurrentDateInTimezone(timezone: string): string {
  const now = new Date();
  return formatInTimeZone(now, timezone, 'yyyy-MM-dd');
}

/**
 * 判断日期是否是"今天"（基于店铺时区）
 * 
 * @param date 日期字符串（YYYY-MM-DD格式）
 * @param timezone 店铺时区
 * @returns 是否是今天
 */
export function isToday(date: string, timezone: string): boolean {
  const today = getCurrentDateInTimezone(timezone);
  return date === today;
}

// ==================== AMS消息处理 ====================

/**
 * 处理AMS流量消息
 * 
 * @param message AMS消息
 * @param accountId 账号ID
 * @param timezone 店铺时区
 */
export async function processAmsTrafficMessage(
  message: AmsMessage,
  accountId: number,
  timezone: string
): Promise<void> {
  const data = message.data as AmsTrafficData;
  
  // 将UTC时间转换为店铺当地日期
  const eventTime = data.eventTime || message.timestamp;
  const localDate = convertUtcToLocalDate(eventTime, timezone);
  
  console.log(`[AMS] 处理流量消息: campaignId=${data.campaignId}, UTC=${eventTime}, 本地日期=${localDate}, 时区=${timezone}`);
  
  // 检查该日期的数据是否已经被API校准
  const existingData = await db.getDailyPerformanceByAccountAndDate(
    accountId,
    localDate
  );
  
  if (existingData?.isFinalized) {
    console.log(`[AMS] 跳过已校准数据: ${localDate} ${data.campaignId}`);
    return;
  }
  
  // 聚合并存储AMS数据
  await db.upsertDailyPerformanceFromAms({
    accountId,
    date: localDate,
    impressions: data.impressions,
    clicks: data.clicks,
    cost: data.cost,
  });
  
  console.log(`[AMS] 流量数据已存储: ${localDate} ${data.campaignId}`);
}

/**
 * 处理AMS转化消息
 * 
 * @param message AMS消息
 * @param accountId 账号ID
 * @param timezone 店铺时区
 */
export async function processAmsConversionMessage(
  message: AmsMessage,
  accountId: number,
  timezone: string
): Promise<void> {
  const data = message.data as AmsConversionData;
  
  // 将UTC时间转换为店铺当地日期
  const eventTime = data.eventTime || message.timestamp;
  const localDate = convertUtcToLocalDate(eventTime, timezone);
  
  console.log(`[AMS] 处理转化消息: campaignId=${data.campaignId}, UTC=${eventTime}, 本地日期=${localDate}, 时区=${timezone}`);
  
  // 检查该日期的数据是否已经被API校准
  const existingData = await db.getDailyPerformanceByAccountAndDate(
    accountId,
    localDate
  );
  
  if (existingData?.isFinalized) {
    console.log(`[AMS] 跳过已校准数据: ${localDate} ${data.campaignId}`);
    return;
  }
  
  // 更新转化数据
  await db.updateDailyPerformanceConversion({
    accountId,
    date: localDate,
    sales: data.attributedSales,
    orders: data.attributedConversions,
  });
  
  console.log(`[AMS] 转化数据已更新: ${localDate} ${data.campaignId}`);
}

/**
 * 批量处理AMS消息
 * 
 * @param messages AMS消息数组
 * @param accountId 账号ID
 * @param marketplace 站点代码
 */
export async function processAmsMessages(
  messages: AmsMessage[],
  accountId: number,
  marketplace: string
): Promise<{ processed: number; skipped: number; errors: number }> {
  // 获取账号的时区配置
  const credentials = await db.getAmazonApiCredentials(accountId);
  const timezone = getTimezoneForMarketplace(marketplace, credentials?.timezone);
  
  console.log(`[AMS] 开始处理 ${messages.length} 条消息, 站点=${marketplace}, 时区=${timezone}`);
  
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const message of messages) {
    try {
      if (message.dataSetId.includes('traffic')) {
        await processAmsTrafficMessage(message, accountId, timezone);
        processed++;
      } else if (message.dataSetId.includes('conversion')) {
        await processAmsConversionMessage(message, accountId, timezone);
        processed++;
      } else if (message.dataSetId.includes('budget')) {
        // 预算数据暂不处理
        skipped++;
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(`[AMS] 处理消息失败:`, error);
      errors++;
    }
  }
  
  console.log(`[AMS] 处理完成: processed=${processed}, skipped=${skipped}, errors=${errors}`);
  
  return { processed, skipped, errors };
}

// ==================== 辅助函数 ====================

/**
 * 从数据集ID获取广告类型
 */
function getAdTypeFromDatasetId(dataSetId: AmsDatasetType): 'sp' | 'sb' | 'sd' {
  if (dataSetId.startsWith('sp-')) return 'sp';
  if (dataSetId.startsWith('sb-')) return 'sb';
  if (dataSetId.startsWith('sd-')) return 'sd';
  return 'sp';
}

/**
 * 验证时区字符串是否有效
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取所有支持的站点时区列表
 */
export function getSupportedTimezones(): Array<{ marketplace: string; timezone: string }> {
  return Object.entries(MARKETPLACE_TIMEZONE_MAP).map(([marketplace, timezone]) => ({
    marketplace,
    timezone,
  }));
}
