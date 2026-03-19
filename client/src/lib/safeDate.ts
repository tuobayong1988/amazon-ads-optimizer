/**
 * 安全日期工具库 - 统一处理所有日期解析、格式化和转换
 * 
 * 解决的核心问题：
 * 1. 移动端Safari对非标准日期格式（如"2/20"、中文日期）解析为Invalid Date
 * 2. null/undefined/空字符串传入new Date()导致Invalid Date
 * 3. Invalid Date调用toISOString()、toLocaleDateString()等方法时崩溃
 * 
 * 所有前端组件应使用本库的函数替代直接的new Date()和toISOString()调用
 */

/**
 * 安全解析日期 - 处理各种格式和无效输入
 * @param value - 任意日期值（字符串、Date对象、数字、null、undefined）
 * @param fallback - 解析失败时的回退值，默认为当前时间
 * @returns 有效的Date对象
 */
export function safeParseDate(value: unknown, fallback?: Date): Date {
  if (!value && value !== 0) {
    return fallback || new Date();
  }

  // 已经是有效Date对象
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? (fallback || new Date()) : value;
  }

  // 数字（时间戳）
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? (fallback || new Date()) : d;
  }

  // 字符串处理
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'N/A' || trimmed === 'null' || trimmed === 'undefined') {
      return fallback || new Date();
    }

    // 尝试直接解析（ISO格式、标准格式等）
    let d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d;
    }

    // 尝试处理中文日期格式（如"2/20"、"2月20日"等）
    // 补充年份后重试
    const shortDateMatch = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
    if (shortDateMatch) {
      const year = new Date().getFullYear();
      d = new Date(`${year}-${shortDateMatch[1].padStart(2, '0')}-${shortDateMatch[2].padStart(2, '0')}`);
      if (!isNaN(d.getTime())) {
        return d;
      }
    }

    // 处理中文月日格式（如"2月20日"）
    const cnDateMatch = trimmed.match(/(\d{1,2})月(\d{1,2})日?/);
    if (cnDateMatch) {
      const year = new Date().getFullYear();
      d = new Date(`${year}-${cnDateMatch[1].padStart(2, '0')}-${cnDateMatch[2].padStart(2, '0')}`);
      if (!isNaN(d.getTime())) {
        return d;
      }
    }

    return fallback || new Date();
  }

  return fallback || new Date();
}

/**
 * 安全转换为ISO日期字符串（YYYY-MM-DD）
 * @param value - 任意日期值
 * @param fallback - 解析失败时的回退字符串
 * @returns ISO日期字符串
 */
export function safeToISODateString(value: unknown, fallback?: string): string {
  const date = safeParseDate(value);
  try {
    return date.toISOString().split('T')[0];
  } catch {
    return fallback || new Date().toISOString().split('T')[0];
  }
}

/**
 * 安全转换为ISO完整字符串
 * @param value - 任意日期值
 * @returns ISO完整字符串
 */
export function safeToISOString(value: unknown): string {
  const date = safeParseDate(value);
  try {
    return date.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * 安全格式化为本地日期字符串
 * @param value - 任意日期值
 * @param locale - 语言环境，默认'zh-CN'
 * @param options - Intl.DateTimeFormatOptions
 * @param fallback - 解析失败时的回退字符串
 * @returns 格式化后的日期字符串
 */
export function safeToLocaleDateString(
  value: unknown,
  locale: string = 'zh-CN',
  options?: Intl.DateTimeFormatOptions,
  fallback: string = '-'
): string {
  try {
    const date = safeParseDate(value);
    return date.toLocaleDateString(locale, options);
  } catch {
    return fallback;
  }
}

/**
 * 安全格式化为本地日期时间字符串
 * @param value - 任意日期值
 * @param locale - 语言环境，默认'zh-CN'
 * @param options - Intl.DateTimeFormatOptions
 * @param fallback - 解析失败时的回退字符串
 * @returns 格式化后的日期时间字符串
 */
export function safeToLocaleString(
  value: unknown,
  locale: string = 'zh-CN',
  options?: Intl.DateTimeFormatOptions,
  fallback: string = '-'
): string {
  try {
    const date = safeParseDate(value);
    return date.toLocaleString(locale, options);
  } catch {
    return fallback;
  }
}

/**
 * 安全格式化为本地时间字符串
 * @param value - 任意日期值
 * @param locale - 语言环境，默认'zh-CN'
 * @param options - Intl.DateTimeFormatOptions
 * @param fallback - 解析失败时的回退字符串
 * @returns 格式化后的时间字符串
 */
export function safeToLocaleTimeString(
  value: unknown,
  locale: string = 'zh-CN',
  options?: Intl.DateTimeFormatOptions,
  fallback: string = '-'
): string {
  try {
    const date = safeParseDate(value);
    return date.toLocaleTimeString(locale, options);
  } catch {
    return fallback;
  }
}

/**
 * 安全获取时间戳
 * @param value - 任意日期值
 * @returns 时间戳（毫秒），无效时返回0
 */
export function safeGetTime(value: unknown): number {
  try {
    const date = safeParseDate(value);
    const time = date.getTime();
    return isNaN(time) ? 0 : time;
  } catch {
    return 0;
  }
}

/**
 * 安全日期比较排序函数
 * @param a - 第一个日期值
 * @param b - 第二个日期值
 * @returns 排序比较结果
 */
export function safeDateCompare(a: unknown, b: unknown): number {
  return safeGetTime(a) - safeGetTime(b);
}

/**
 * 检查日期值是否有效
 * @param value - 任意日期值
 * @returns 是否为有效日期
 */
export function isValidDate(value: unknown): boolean {
  if (!value && value !== 0) return false;
  try {
    const date = value instanceof Date ? value : new Date(value);
    return !isNaN(date.getTime());
  } catch {
    return false;
  }
}
