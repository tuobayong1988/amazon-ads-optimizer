/**
 * 批量查询工具 - 解决N+1查询问题
 * v361: 提供通用的批量查询和缓存机制，避免在循环中逐条查询数据库
 */

import { createModuleLogger } from './logger';

const log = createModuleLogger('BatchQueryHelper');

/**
 * 批量查询缓存 - 在单次操作中缓存已查询的实体
 * 使用方式：
 *   const cache = new QueryCache<Campaign>();
 *   for (const item of items) {
 *     const campaign = await cache.getOrFetch(item.campaignId, () => getCampaignById(item.campaignId));
 *   }
 */
export class QueryCache<T> {
  private cache = new Map<string | number, T | null>();
  private hitCount = 0;
  private missCount = 0;
  private readonly name: string;

  constructor(name: string = 'QueryCache') {
    this.name = name;
  }

  /**
   * 从缓存获取或通过fetcher查询
   */
  async getOrFetch(key: string | number, fetcher: () => Promise<T | null | undefined>): Promise<T | null> {
    if (this.cache.has(key)) {
      this.hitCount++;
      return this.cache.get(key) || null;
    }

    this.missCount++;
    const result = await fetcher();
    this.cache.set(key, result || null);
    return result || null;
  }

  /**
   * 批量预加载 - 一次性查询多个ID，填充缓存
   */
  async preload(keys: (string | number)[], batchFetcher: (keys: (string | number)[]) => Promise<Map<string | number, T>>): Promise<void> {
    const uncachedKeys = keys.filter(k => !this.cache.has(k));
    if (uncachedKeys.length === 0) return;

    try {
      const results = await batchFetcher(uncachedKeys);
      for (const key of uncachedKeys) {
        this.cache.set(key, results.get(key) || null);
      }
      log.debug(`[${this.name}] 预加载 ${uncachedKeys.length} 条记录，命中 ${results.size} 条`);
    } catch (error) {
      log.warn(`[${this.name}] 批量预加载失败:`, (error as Error).message);
    }
  }

  /**
   * 获取缓存统计
   */
  getStats(): { hits: number; misses: number; size: number; hitRate: string } {
    const total = this.hitCount + this.missCount;
    return {
      hits: this.hitCount,
      misses: this.missCount,
      size: this.cache.size,
      hitRate: total > 0 ? `${((this.hitCount / total) * 100).toFixed(1)}%` : '0%',
    };
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }
}

/**
 * 将数组分成指定大小的批次
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * 带并发限制的批量执行
 * @param items 待处理的项目列表
 * @param concurrency 最大并发数
 * @param processor 处理函数
 */
export async function batchProcess<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const batches = chunk(items, concurrency);

  for (const batch of batches) {
    const batchResults = await Promise.allSettled(batch.map(processor));
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        log.warn(`[BatchProcess] 批次中某项处理失败:`, result.reason?.message || result.reason);
      }
    }
  }

  return results;
}
