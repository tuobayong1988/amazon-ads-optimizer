/**
 * Amazon API授权状态检查服务
 * 监控和管理Amazon API授权状态，包括Token过期时间、授权范围等
 */

import { getDb } from "./db";
import { amazonApiCredentials, accounts } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

export interface ApiAuthStatus {
  accountId: number;
  accountName: string;
  profileId: string;
  marketplace: string;
  tokenExpiresAt: string | null;
  tokenExpired: boolean;
  daysUntilExpiry: number | null;
  lastRefreshAt: string | null;
  authScope: string[];
  status: 'active' | 'expired' | 'expiring_soon' | 'unknown';
  refreshUrl?: string;
}

export interface ApiAuthStatusSummary {
  totalAccounts: number;
  activeAccounts: number;
  expiredAccounts: number;
  expiringAccounts: number;
  accounts: ApiAuthStatus[];
}

/**
 * 获取单个账号的API授权状态
 */
export async function getAccountApiAuthStatus(accountId: number): Promise<ApiAuthStatus | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [credential] = await db
    .select()
    .from(amazonApiCredentials)
    .where(eq(amazonApiCredentials.accountId, accountId));

  if (!credential) {
    return null;
  }

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId));

  if (!account) {
    return null;
  }

  const now = new Date();
  const expiresAt = credential.tokenExpiresAt ? new Date(credential.tokenExpiresAt) : null;
  const tokenExpired = expiresAt ? expiresAt < now : false;
  
  let daysUntilExpiry: number | null = null;
  if (expiresAt && !tokenExpired) {
    daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  let status: 'active' | 'expired' | 'expiring_soon' | 'unknown' = 'unknown';
  if (tokenExpired) {
    status = 'expired';
  } else if (daysUntilExpiry !== null && daysUntilExpiry <= 7) {
    status = 'expiring_soon';
  } else if (daysUntilExpiry !== null && daysUntilExpiry > 7) {
    status = 'active';
  }

  return {
    accountId,
    accountName: account.accountName || '',
    profileId: credential.profileId || '',
    marketplace: credential.marketplace || '',
    tokenExpiresAt: credential.tokenExpiresAt,
    tokenExpired,
    daysUntilExpiry,
    lastRefreshAt: credential.updatedAt,
    authScope: credential.authScope ? JSON.parse(credential.authScope) : [],
    status,
    refreshUrl: `/api/amazon-api/refresh-auth?accountId=${accountId}`,
  };
}

/**
 * 获取所有账号的API授权状态
 */
export async function getAllAccountsApiAuthStatus(userId?: number): Promise<ApiAuthStatusSummary> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let credentials = await db.select().from(amazonApiCredentials);

  if (userId) {
    // 如果指定了userId，需要过滤该用户有权限的账号
    const userAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId));

    const userAccountIds = userAccounts.map(a => a.id);
    credentials = credentials.filter(c => userAccountIds.includes(c.accountId));
  }

  const statuses: ApiAuthStatus[] = [];
  let activeCount = 0;
  let expiredCount = 0;
  let expiringCount = 0;

  for (const credential of credentials) {
    const status = await getAccountApiAuthStatus(credential.accountId);
    if (status) {
      statuses.push(status);
      
      if (status.status === 'active') {
        activeCount++;
      } else if (status.status === 'expired') {
        expiredCount++;
      } else if (status.status === 'expiring_soon') {
        expiringCount++;
      }
    }
  }

  return {
    totalAccounts: statuses.length,
    activeAccounts: activeCount,
    expiredAccounts: expiredCount,
    expiringAccounts: expiringCount,
    accounts: statuses,
  };
}

/**
 * 检查是否需要刷新Token
 */
export async function shouldRefreshToken(accountId: number): Promise<boolean> {
  const status = await getAccountApiAuthStatus(accountId);
  if (!status) return false;

  // 如果已过期或即将在7天内过期，需要刷新
  return status.tokenExpired || (status.daysUntilExpiry !== null && status.daysUntilExpiry <= 7);
}

/**
 * 获取需要刷新的账号列表
 */
export async function getAccountsNeedingRefresh(): Promise<ApiAuthStatus[]> {
  const summary = await getAllAccountsApiAuthStatus();
  return summary.accounts.filter(
    account => account.status === 'expired' || account.status === 'expiring_soon'
  );
}

/**
 * 更新Token过期时间
 */
export async function updateTokenExpiryTime(
  accountId: number,
  expiresAt: Date
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(amazonApiCredentials)
    .set({
      tokenExpiresAt: expiresAt.toISOString(),
      updatedAt: new Date(),
    })
    .where(eq(amazonApiCredentials.accountId, accountId));
}

/**
 * 记录Token刷新事件
 */
export async function logTokenRefreshEvent(
  accountId: number,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 这里可以插入到审计日志或事件日志表
  // 目前只记录到console
  if (success) {
    console.log(`[Amazon API] Token refreshed successfully for account ${accountId}`);
  } else {
    console.error(`[Amazon API] Token refresh failed for account ${accountId}: ${errorMessage}`);
  }
}

/**
 * 获取授权状态警告信息
 */
export function getAuthStatusWarning(status: ApiAuthStatus): string | null {
  if (status.tokenExpired) {
    return `Amazon API Token已过期，请立即重新授权以恢复数据同步功能`;
  }

  if (status.daysUntilExpiry !== null && status.daysUntilExpiry <= 7) {
    return `Amazon API Token将在${status.daysUntilExpiry}天后过期，建议提前重新授权`;
  }

  return null;
}
