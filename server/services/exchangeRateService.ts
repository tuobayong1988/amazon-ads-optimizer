/**
 * v149: 实时汇率服务
 * 
 * 使用 ExchangeRate-API (open.er-api.com) 免费端点获取实时汇率
 * - 每日自动更新一次（API数据每24小时刷新）
 * - 内存缓存 + 本地文件缓存双重保障
 * - 失败时自动降级到静态汇率
 * - 无需API Key
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('ExchangeRate');

// ========== 静态兜底汇率（当API不可用时使用） ==========
const FALLBACK_RATES_TO_USD: Record<string, number> = {
  'USD': 1.0,
  'CAD': 0.7345,
  'MXN': 0.0495,
  'GBP': 1.27,
  'EUR': 1.08,
  'JPY': 0.0067,
  'AUD': 0.65,
  'SGD': 0.74,
  'INR': 0.012,
  'AED': 0.2723,
  'SAR': 0.2667,
  'BRL': 0.17,
  'SEK': 0.096,
  'PLN': 0.25,
};

// ========== 站点到货币的映射 ==========
export const MARKETPLACE_CURRENCY: Record<string, string> = {
  'US': 'USD', 'CA': 'CAD', 'MX': 'MXN', 'BR': 'BRL',
  'UK': 'GBP', 'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR', 'ES': 'EUR', 'NL': 'EUR', 'SE': 'SEK', 'PL': 'PLN', 'BE': 'EUR',
  'JP': 'JPY', 'AU': 'AUD', 'SG': 'SGD', 'IN': 'INR', 'AE': 'AED', 'SA': 'SAR',
};

// ========== 缓存状态 ==========
interface RateCache {
  rates: Record<string, number>;  // 货币到USD的汇率（1 XXX = ? USD）
  lastUpdated: number;            // Unix时间戳（毫秒）
  source: 'api' | 'file' | 'fallback';
}

let rateCache: RateCache | null = null;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12小时缓存有效期
const CACHE_FILE_PATH = '/tmp/exchange_rates_cache.json';
const API_URL = 'https://open.er-api.com/v6/latest/USD';

/**
 * 从ExchangeRate-API获取最新汇率
 * API返回的是 1 USD = X 外币，我们需要转换为 1 外币 = X USD
 */
async function fetchRatesFromApi(): Promise<Record<string, number> | null> {
  try {
    log.info('[ExchangeRateService] 正在从API获取最新汇率...');
    const response = await axios.get(API_URL, { timeout: 10000 });
    
    if (response.data?.result !== 'success' || !response.data?.rates) {
      log.warn('[ExchangeRateService] API返回异常:', response.data?.result);
      return null;
    }
    
    const apiRates = response.data.rates as Record<string, number>;
    
    // 转换为 1 外币 = X USD 的格式
    const ratesToUsd: Record<string, number> = {};
    for (const [currency, rateFromUsd] of Object.entries(apiRates)) {
      if (typeof rateFromUsd === 'number' && rateFromUsd > 0) {
        ratesToUsd[currency] = 1 / rateFromUsd;
      }
    }
    ratesToUsd['USD'] = 1.0;
    
    log.info(`[ExchangeRateService] API获取成功，共${Object.keys(ratesToUsd).length}种货币`);
    
    // 验证关键货币是否存在
    const requiredCurrencies = ['CAD', 'MXN', 'GBP', 'EUR', 'JPY', 'AUD'];
    const missing = requiredCurrencies.filter(c => !ratesToUsd[c]);
    if (missing.length > 0) {
      log.warn(`[ExchangeRateService] 缺少关键货币: ${missing.join(', ')}，使用兜底值补充`);
      for (const c of (missing as unknown[])) {
        ratesToUsd[c] = FALLBACK_RATES_TO_USD[c] || 1.0;
      }
    }
    
    return ratesToUsd;
  } catch (error: unknown) {
    log.warn(`[ExchangeRateService] API请求失败: ${(error as Error).message}`);
    return null;
  }
}

/**
 * 从本地文件缓存加载汇率
 */
function loadRatesFromFile(): RateCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
    if (data?.rates && data?.lastUpdated) {
      log.info(`[ExchangeRateService] 从文件缓存加载汇率，更新时间: ${new Date(data.lastUpdated).toISOString()}`);
      return { rates: data.rates, lastUpdated: data.lastUpdated, source: 'file' };
    }
  } catch (error: unknown) {
    log.warn(`[ExchangeRateService] 文件缓存读取失败: ${(error as Error).message}`);
  }
  return null;
}

/**
 * 保存汇率到本地文件缓存
 */
function saveRatesToFile(rates: Record<string, number>): void {
  try {
    const data = { rates, lastUpdated: Date.now() };
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(data, null, 2));
    log.info('[ExchangeRateService] 汇率已保存到文件缓存');
  } catch (error: unknown) {
    log.warn(`[ExchangeRateService] 文件缓存写入失败: ${(error as Error).message}`);
  }
}

/**
 * 获取汇率（带缓存）
 * 优先级：内存缓存 > API实时获取 > 文件缓存 > 静态兜底
 */
export async function getExchangeRates(): Promise<Record<string, number>> {
  // 1. 检查内存缓存是否有效
  if (rateCache && (Date.now() - rateCache.lastUpdated) < CACHE_TTL_MS) {
    return rateCache.rates;
  }
  
  // 2. 尝试从API获取最新汇率
  const apiRates = await fetchRatesFromApi();
  if (apiRates) {
    rateCache = { rates: apiRates, lastUpdated: Date.now(), source: 'api' };
    saveRatesToFile(apiRates);
    return apiRates;
  }
  
  // 3. API失败，尝试从文件缓存加载
  const fileCache = loadRatesFromFile();
  if (fileCache) {
    rateCache = fileCache;
    return fileCache.rates;
  }
  
  // 4. 全部失败，使用静态兜底汇率
  log.warn('[ExchangeRateService] 所有汇率源不可用，使用静态兜底汇率');
  rateCache = { rates: FALLBACK_RATES_TO_USD, lastUpdated: Date.now(), source: 'fallback' };
  return FALLBACK_RATES_TO_USD;
}

/**
 * 获取单个货币到USD的汇率
 */
export async function getExchangeRate(currency: string): Promise<number> {
  const rates = await getExchangeRates();
  return rates[currency] || 1.0;
}

/**
 * 根据站点代码获取到USD的汇率
 */
export async function getExchangeRateByMarketplace(marketplace: string): Promise<{ currency: string; rate: number }> {
  const currency = MARKETPLACE_CURRENCY[marketplace] || 'USD';
  const rate = await getExchangeRate(currency);
  return { currency, rate };
}

/**
 * 获取当前汇率缓存状态（用于监控和调试）
 */
export function getExchangeRateStatus(): {
  source: string;
  lastUpdated: string | null;
  ageMinutes: number;
  currencyCount: number;
} {
  if (!rateCache) {
    return { source: 'not_initialized', lastUpdated: null, ageMinutes: -1, currencyCount: 0 };
  }
  return {
    source: rateCache.source,
    lastUpdated: new Date(rateCache.lastUpdated).toISOString(),
    ageMinutes: Math.round((Date.now() - rateCache.lastUpdated) / 60000),
    currencyCount: Object.keys(rateCache.rates).length,
  };
}

/**
 * 强制刷新汇率缓存（用于手动触发）
 */
export async function refreshExchangeRates(): Promise<{ success: boolean; source: string; message: string }> {
  rateCache = null; // 清除内存缓存
  const rates = await getExchangeRates();
  const status = getExchangeRateStatus();
  return {
    success: status.source === 'api',
    source: status.source,
    message: status.source === 'api' 
      ? `汇率已从API刷新，共${status.currencyCount}种货币` 
      : `API不可用，使用${status.source}数据源`,
  };
}
