/**
 * v791+: 仪表盘首屏快照短 TTL 缓存辅助模块。
 *
 * 目标：
 * 1. 缓存键显式包含用户、账号和日期范围，保证多租户隔离。
 * 2. 提供账号级精准失效，供同步任务完成后调用。
 * 3. 统一返回缓存元数据，便于前端展示“缓存命中/生成时间/TTL”。
 */
import { apiCache } from './apiCacheService';

const DASHBOARD_BOOTSTRAP_PREFIX = 'analytics.getDashboardBootstrap.v791';
export const DASHBOARD_BOOTSTRAP_TTL_MS = 30 * 1000;

export type DashboardBootstrapCacheMeta = {
  cacheKey: string;
  cacheTtlMs: number;
  cacheStatus: 'hit' | 'miss' | 'bypass';
  cachedAt?: string;
};

export function buildDashboardBootstrapCacheKey(params: {
  userId: number;
  accountId: number | null;
  startDate: string;
  endDate: string;
  days: number;
}): string {
  return [
    DASHBOARD_BOOTSTRAP_PREFIX,
    `u${params.userId}`,
    `a${params.accountId ?? 'none'}`,
    `s${params.startDate}`,
    `e${params.endDate}`,
    `d${params.days}`,
  ].join(':');
}

export function withDashboardBootstrapCacheMeta<T extends Record<string, unknown>>(
  payload: T,
  cacheKey: string,
  cacheStatus: DashboardBootstrapCacheMeta['cacheStatus'],
): T & { cacheMeta: DashboardBootstrapCacheMeta } {
  return {
    ...payload,
    cacheMeta: {
      cacheKey,
      cacheTtlMs: DASHBOARD_BOOTSTRAP_TTL_MS,
      cacheStatus,
      cachedAt: new Date().toISOString(),
    },
  };
}

export function invalidateDashboardBootstrapCache(params: { userId?: number; accountId?: number | null }): number {
  const userToken = typeof params.userId === 'number' ? `:u${params.userId}:` : null;
  const accountToken = typeof params.accountId === 'number' ? `:a${params.accountId}:` : null;

  return apiCache.invalidateWhere((key) => {
    if (!key.startsWith(DASHBOARD_BOOTSTRAP_PREFIX)) return false;
    if (userToken && !key.includes(userToken)) return false;
    if (accountToken && !key.includes(accountToken)) return false;
    return true;
  });
}
