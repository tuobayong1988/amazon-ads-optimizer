/**
 * 货币工具函数
 * 用于根据marketplace或currency代码获取正确的货币符号
 */

// Marketplace到货币代码的映射
export const MARKETPLACE_CURRENCY_MAP: Record<string, string> = {
  US: 'USD',
  CA: 'CAD',
  MX: 'MXN',
  BR: 'BRL',
  UK: 'GBP',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  SE: 'SEK',
  PL: 'PLN',
  JP: 'JPY',
  AU: 'AUD',
  SG: 'SGD',
  AE: 'AED',
  SA: 'SAR',
  IN: 'INR',
};

// 货币代码到显示符号的映射
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  CAD: 'CA$',
  MXN: 'MX$',
  BRL: 'R$',
  GBP: '£',
  EUR: '€',
  SEK: 'kr',
  PLN: 'zł',
  JPY: '¥',
  AUD: 'A$',
  SGD: 'S$',
  AED: 'AED ',
  SAR: 'SAR ',
  INR: '₹',
};

/**
 * 根据marketplace获取货币符号
 */
export function getCurrencySymbol(marketplace?: string | null): string {
  if (!marketplace) return '$';
  const currencyCode = MARKETPLACE_CURRENCY_MAP[marketplace] || 'USD';
  return CURRENCY_SYMBOLS[currencyCode] || '$';
}

/**
 * 根据货币代码获取货币符号
 */
export function getCurrencySymbolByCode(currencyCode?: string | null): string {
  if (!currencyCode) return '$';
  return CURRENCY_SYMBOLS[currencyCode] || '$';
}

/**
 * 格式化金额显示
 * @param amount 金额数值
 * @param marketplace 站点代码（用于确定货币）
 * @param options 格式化选项
 */
export function formatCurrency(
  amount: number,
  marketplace?: string | null,
  options?: { decimals?: number; compact?: boolean }
): string {
  const symbol = getCurrencySymbol(marketplace);
  const decimals = options?.decimals ?? 2;
  
  if (options?.compact && Math.abs(amount) >= 1000) {
    return `${symbol}${(amount / 1000).toFixed(1)}k`;
  }
  
  return `${symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * 格式化金额显示（使用货币代码）
 */
export function formatCurrencyByCode(
  amount: number,
  currencyCode?: string | null,
  options?: { decimals?: number; compact?: boolean }
): string {
  const symbol = getCurrencySymbolByCode(currencyCode);
  const decimals = options?.decimals ?? 2;
  
  if (options?.compact && Math.abs(amount) >= 1000) {
    return `${symbol}${(amount / 1000).toFixed(1)}k`;
  }
  
  return `${symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
