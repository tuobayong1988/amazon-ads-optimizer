/**
 * 站点时区配置和时间转换工具
 * 用于根据各站点的本地时间计算日期范围
 */

// Amazon广告站点时区配置
export const MARKETPLACE_TIMEZONES: Record<string, { timezone: string; name: string; offset: number }> = {
  // 北美
  'US': { timezone: 'America/Los_Angeles', name: '美国', offset: -8 },  // PST/PDT
  'CA': { timezone: 'America/Vancouver', name: '加拿大', offset: -8 },  // PST/PDT
  'MX': { timezone: 'America/Mexico_City', name: '墨西哥', offset: -6 }, // CST
  
  // 欧洲
  'UK': { timezone: 'Europe/London', name: '英国', offset: 0 },
  'DE': { timezone: 'Europe/Berlin', name: '德国', offset: 1 },
  'FR': { timezone: 'Europe/Paris', name: '法国', offset: 1 },
  'IT': { timezone: 'Europe/Rome', name: '意大利', offset: 1 },
  'ES': { timezone: 'Europe/Madrid', name: '西班牙', offset: 1 },
  'NL': { timezone: 'Europe/Amsterdam', name: '荷兰', offset: 1 },
  'SE': { timezone: 'Europe/Stockholm', name: '瑞典', offset: 1 },
  'PL': { timezone: 'Europe/Warsaw', name: '波兰', offset: 1 },
  'BE': { timezone: 'Europe/Brussels', name: '比利时', offset: 1 },
  
  // 亚太
  'JP': { timezone: 'Asia/Tokyo', name: '日本', offset: 9 },
  'AU': { timezone: 'Australia/Sydney', name: '澳大利亚', offset: 11 },
  'SG': { timezone: 'Asia/Singapore', name: '新加坡', offset: 8 },
  'IN': { timezone: 'Asia/Kolkata', name: '印度', offset: 5.5 },
  'AE': { timezone: 'Asia/Dubai', name: '阿联酋', offset: 4 },
  'SA': { timezone: 'Asia/Riyadh', name: '沙特阿拉伯', offset: 3 },
  
  // 南美
  'BR': { timezone: 'America/Sao_Paulo', name: '巴西', offset: -3 },
};

/**
 * 获取指定站点的当前本地日期
 * @param marketplace 站点代码 (US, CA, MX等)
 * @returns 站点本地日期 (YYYY-MM-DD格式)
 */
export function getMarketplaceLocalDate(marketplace: string): string {
  const config = MARKETPLACE_TIMEZONES[marketplace] || MARKETPLACE_TIMEZONES['US'];
  const now = new Date();
  
  // 使用Intl.DateTimeFormat获取站点本地时间
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  return formatter.format(now);
}

/**
 * 获取指定站点的当前本地时间
 * @param marketplace 站点代码
 * @returns 站点本地时间对象
 */
export function getMarketplaceLocalTime(marketplace: string): Date {
  const config = MARKETPLACE_TIMEZONES[marketplace] || MARKETPLACE_TIMEZONES['US'];
  const now = new Date();
  
  // 获取站点本地时间的各个部分
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  
  const dateObj: Record<string, string> = {};
  parts.forEach(part => {
    dateObj[part.type] = part.value;
  });
  
  return new Date(
    parseInt(dateObj.year),
    parseInt(dateObj.month) - 1,
    parseInt(dateObj.day),
    parseInt(dateObj.hour),
    parseInt(dateObj.minute),
    parseInt(dateObj.second)
  );
}

/**
 * 根据站点时区计算日期范围
 * @param marketplace 站点代码
 * @param timeRange 时间范围类型
 * @returns { startDate: string, endDate: string }
 */
export function calculateDateRangeByMarketplace(
  marketplace: string,
  timeRange: 'today' | 'yesterday' | '7days' | '14days' | '30days' | '60days' | '90days'
): { startDate: string; endDate: string } {
  const localDate = getMarketplaceLocalDate(marketplace);
  const [year, month, day] = localDate.split('-').map(Number);
  const today = new Date(year, month - 1, day);
  
  let startDate: Date;
  let endDate: Date;
  
  switch (timeRange) {
    case 'today':
      startDate = today;
      endDate = today;
      break;
    case 'yesterday':
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 1);
      endDate = startDate;
      break;
    case '7days':
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 6);
      endDate = today;
      break;
    case '14days':
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 13);
      endDate = today;
      break;
    case '30days':
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 29);
      endDate = today;
      break;
    case '60days':
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 59);
      endDate = today;
      break;
    case '90days':
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 89);
      endDate = today;
      break;
    default:
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 6);
      endDate = today;
  }
  
  const formatDate = (d: Date): string => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  
  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

/**
 * 获取站点时区信息
 * @param marketplace 站点代码
 * @returns 时区配置
 */
export function getMarketplaceTimezoneInfo(marketplace: string) {
  return MARKETPLACE_TIMEZONES[marketplace] || MARKETPLACE_TIMEZONES['US'];
}

/**
 * 格式化站点本地时间显示
 * @param marketplace 站点代码
 * @param format 格式类型
 * @returns 格式化的时间字符串
 */
export function formatMarketplaceLocalTime(
  marketplace: string,
  format: 'date' | 'time' | 'datetime' = 'datetime'
): string {
  const config = MARKETPLACE_TIMEZONES[marketplace] || MARKETPLACE_TIMEZONES['US'];
  const now = new Date();
  
  const options: Intl.DateTimeFormatOptions = {
    timeZone: config.timezone,
  };
  
  switch (format) {
    case 'date':
      options.year = 'numeric';
      options.month = '2-digit';
      options.day = '2-digit';
      break;
    case 'time':
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.hour12 = false;
      break;
    case 'datetime':
      options.year = 'numeric';
      options.month = '2-digit';
      options.day = '2-digit';
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.hour12 = false;
      break;
  }
  
  return new Intl.DateTimeFormat('zh-CN', options).format(now);
}

/**
 * 判断站点当前是否处于"今天"的某个时间点
 * 用于确定是否应该显示"今天"的数据
 * @param marketplace 站点代码
 * @returns 站点当前小时数 (0-23)
 */
export function getMarketplaceCurrentHour(marketplace: string): number {
  const config = MARKETPLACE_TIMEZONES[marketplace] || MARKETPLACE_TIMEZONES['US'];
  const now = new Date();
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: '2-digit',
    hour12: false,
  });
  
  const hourStr = formatter.format(now);
  return parseInt(hourStr);
}
