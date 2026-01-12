/**
 * Amazon广告站点时区工具
 * 
 * 亚马逊广告数据按照各站点当地时区记录，而非UTC或服务器时区。
 * 此工具提供时区转换功能，确保数据同步和查询使用正确的时区。
 */

// 站点时区映射（IANA时区标识符）
export const MARKETPLACE_TIMEZONES: Record<string, string> = {
  // 北美站点 - 美国太平洋时间
  'US': 'America/Los_Angeles',
  'CA': 'America/Los_Angeles',
  'MX': 'America/Los_Angeles',
  
  // 欧洲站点
  'UK': 'Europe/London',
  'GB': 'Europe/London',
  'DE': 'Europe/Berlin',
  'FR': 'Europe/Paris',
  'IT': 'Europe/Rome',
  'ES': 'Europe/Madrid',
  'NL': 'Europe/Amsterdam',
  'SE': 'Europe/Stockholm',
  'PL': 'Europe/Warsaw',
  'BE': 'Europe/Brussels',
  
  // 亚太站点
  'JP': 'Asia/Tokyo',
  'AU': 'Australia/Sydney',
  'SG': 'Asia/Singapore',
  'IN': 'Asia/Kolkata',
  'AE': 'Asia/Dubai',
  'SA': 'Asia/Riyadh',
  
  // 南美站点
  'BR': 'America/Sao_Paulo',
};

// 默认时区（用于未知站点）
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * 获取站点对应的时区
 * @param marketplace 站点代码（如 'US', 'UK', 'JP'）
 * @returns IANA时区标识符
 */
export function getMarketplaceTimezone(marketplace: string): string {
  const normalizedMarketplace = marketplace?.toUpperCase() || '';
  return MARKETPLACE_TIMEZONES[normalizedMarketplace] || DEFAULT_TIMEZONE;
}

/**
 * 获取站点当前日期（YYYY-MM-DD格式）
 * @param marketplace 站点代码
 * @returns 站点当地日期字符串
 */
export function getMarketplaceCurrentDate(marketplace: string): string {
  const timezone = getMarketplaceTimezone(marketplace);
  const now = new Date();
  
  // 使用Intl.DateTimeFormat获取站点当地日期
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  return formatter.format(now); // 返回 YYYY-MM-DD 格式
}

/**
 * 获取站点当前时间的Date对象
 * @param marketplace 站点代码
 * @returns 表示站点当地时间的Date对象
 */
export function getMarketplaceNow(marketplace: string): Date {
  const timezone = getMarketplaceTimezone(marketplace);
  const now = new Date();
  
  // 获取站点当地时间的各个部分
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';
  
  // 创建一个新的Date对象，表示站点当地时间
  // 注意：这个Date对象的内部时间戳仍然是UTC，但我们用它来表示站点当地时间
  return new Date(
    parseInt(getPart('year')),
    parseInt(getPart('month')) - 1,
    parseInt(getPart('day')),
    parseInt(getPart('hour')),
    parseInt(getPart('minute')),
    parseInt(getPart('second'))
  );
}

/**
 * 计算站点时区的日期范围
 * @param marketplace 站点代码
 * @param daysBack 往前推的天数
 * @returns { startDate: string, endDate: string } 日期范围（YYYY-MM-DD格式）
 */
export function getMarketplaceDateRange(marketplace: string, daysBack: number): { startDate: string; endDate: string } {
  const timezone = getMarketplaceTimezone(marketplace);
  const now = new Date();
  
  // 获取站点当地的今天日期
  const endDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const endDate = endDateFormatter.format(now);
  
  // 计算开始日期
  const startDateTime = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const startDate = endDateFormatter.format(startDateTime);
  
  return { startDate, endDate };
}

/**
 * 获取站点昨天的日期
 * @param marketplace 站点代码
 * @returns 站点昨天的日期字符串（YYYY-MM-DD格式）
 */
export function getMarketplaceYesterday(marketplace: string): string {
  const timezone = getMarketplaceTimezone(marketplace);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  return formatter.format(yesterday);
}

/**
 * 判断给定日期是否是站点的"今天"
 * @param dateStr 日期字符串（YYYY-MM-DD格式）
 * @param marketplace 站点代码
 * @returns 是否是站点的今天
 */
export function isMarketplaceToday(dateStr: string, marketplace: string): boolean {
  return dateStr === getMarketplaceCurrentDate(marketplace);
}

/**
 * 判断给定日期是否是站点的"昨天"
 * @param dateStr 日期字符串（YYYY-MM-DD格式）
 * @param marketplace 站点代码
 * @returns 是否是站点的昨天
 */
export function isMarketplaceYesterday(dateStr: string, marketplace: string): boolean {
  return dateStr === getMarketplaceYesterday(marketplace);
}

/**
 * 获取站点时区与UTC的偏移量（小时）
 * @param marketplace 站点代码
 * @returns UTC偏移量（如 -8 表示 UTC-8）
 */
export function getMarketplaceUtcOffset(marketplace: string): number {
  const timezone = getMarketplaceTimezone(marketplace);
  const now = new Date();
  
  // 获取UTC时间
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  
  // 获取站点当地时间
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  
  // 计算偏移量（简化计算，可能有夏令时误差）
  const localHour = parseInt(formatter.format(now));
  const utcHour = new Date(utcTime).getUTCHours();
  
  let offset = localHour - utcHour;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  
  return offset;
}

/**
 * 将UTC日期转换为站点当地日期
 * @param utcDateStr UTC日期字符串（YYYY-MM-DD格式）
 * @param marketplace 站点代码
 * @returns 站点当地日期字符串（YYYY-MM-DD格式）
 */
export function utcToMarketplaceDate(utcDateStr: string, marketplace: string): string {
  const timezone = getMarketplaceTimezone(marketplace);
  const utcDate = new Date(utcDateStr + 'T12:00:00Z'); // 使用中午时间避免日期边界问题
  
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  return formatter.format(utcDate);
}

/**
 * 获取站点数据可用的最新日期
 * Amazon广告数据通常有12-24小时延迟，所以最新可用数据通常是昨天
 * @param marketplace 站点代码
 * @returns 最新可用数据日期（YYYY-MM-DD格式）
 */
export function getMarketplaceLatestDataDate(marketplace: string): string {
  // Amazon广告数据通常在次日才可用，所以返回昨天的日期
  return getMarketplaceYesterday(marketplace);
}

/**
 * 计算站点时区的历史日期范围（用于API同步，排除今天）
 * 
 * 快慢双轨架构说明：
 * - API（慢车道）：只负责拉取T-1（昨天）及之前的数据，用于历史校准
 * - AMS（快车道）：负责今天的实时数据推送
 * 
 * @param marketplace 站点代码
 * @param daysBack 往前推的天数（从昨天开始计算）
 * @returns { startDate: string, endDate: string } 日期范围（YYYY-MM-DD格式）
 */
export function getMarketplaceHistoricalDateRange(marketplace: string, daysBack: number): { startDate: string; endDate: string } {
  const timezone = getMarketplaceTimezone(marketplace);
  const now = new Date();
  
  // endDate 是昨天（T-1），不是今天
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  const endDate = formatter.format(yesterday);
  
  // startDate 是从昨天往前推 daysBack 天
  const startDateTime = new Date(yesterday.getTime() - (daysBack - 1) * 24 * 60 * 60 * 1000);
  const startDate = formatter.format(startDateTime);
  
  return { startDate, endDate };
}
