/**
 * v361: API凭证管理
 * 从db.ts拆分的子模块
 */

import { eq, not } from 'drizzle-orm';
import { getDb } from './connection';
import { createModuleLogger } from '../utils/logger';
import { AmazonApiCredential, InsertAmazonApiCredential, amazonApiCredentials } from '../../drizzle/schema';

const log = createModuleLogger('DB:credentials');

export async function saveAmazonApiCredentials(data: InsertAmazonApiCredential) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v345: 凭证加密 — 在写入数据库前加密敏感字段
  const { safeEncrypt } = await import('../utils/cryptoService');
  
  // v342: 保护性更新 - 不用空值覆盖已有的有效值
  const updateSet: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  // 只在新值非空时才更新对应字段
  if (data.clientId && data.clientId !== '' && data.clientId !== '__USE_SERVER_SECRET__') {
    updateSet.clientId = data.clientId;
  }
  if (data.clientSecret && data.clientSecret !== '' && data.clientSecret !== '__USE_SERVER_SECRET__') {
    updateSet.clientSecret = safeEncrypt(data.clientSecret);
  }
  if (data.refreshToken && data.refreshToken !== '') {
    updateSet.refreshToken = safeEncrypt(data.refreshToken);
  }
  if (data.profileId && data.profileId !== '') {
    updateSet.profileId = data.profileId;
  }
  if (data.region) {
    updateSet.region = data.region;
  }
  
  // v345: 加密 insert values 中的敏感字段
  const encryptedData = {
    ...data,
    clientSecret: data.clientSecret ? safeEncrypt(data.clientSecret) : data.clientSecret,
    refreshToken: data.refreshToken ? safeEncrypt(data.refreshToken) : data.refreshToken,
  };
  
  await db.insert(amazonApiCredentials).values(encryptedData).onDuplicateKeyUpdate({
    set: updateSet,
  });
  
  log.info(`[db] v345: saveAmazonApiCredentials 完成 (accountId=${data.accountId}, 更新字段=[${Object.keys(updateSet).filter(k => k !== 'updatedAt').join(',')}], 凭证已加密)`);
}

export async function getAmazonApiCredentials(accountId: number): Promise<AmazonApiCredential | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(amazonApiCredentials)
    .where(eq(amazonApiCredentials.accountId, accountId))
    .limit(1);
  
  const row = result[0] || null;
  if (!row) return null;
  
  // v345: 自动解密敏感字段（向后兼容明文数据）
  const { safeDecrypt } = await import('../utils/cryptoService');
  return {
    ...row,
    clientSecret: safeDecrypt(row.clientSecret),
    refreshToken: safeDecrypt(row.refreshToken as string),
  };
}

export async function updateAmazonApiCredentials(accountId: number, data: Partial<InsertAmazonApiCredential>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v345: 加密敏感字段
  const { safeEncrypt } = await import('../utils/cryptoService');
  const encryptedData: Record<string, unknown> = { ...data, updatedAt: new Date().toISOString() };
  if (encryptedData.clientSecret) {
    // @ts-ignore
    encryptedData.clientSecret = safeEncrypt(encryptedData.clientSecret);
  }
  // @ts-ignore
  if (encryptedData.refreshToken) {
    // @ts-ignore
    encryptedData.refreshToken = safeEncrypt(encryptedData.refreshToken);
  }
  
  await db.update(amazonApiCredentials)
    .set(encryptedData)
    .where(eq(amazonApiCredentials.accountId, accountId));
}

export async function deleteAmazonApiCredentials(accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(amazonApiCredentials)
    .where(eq(amazonApiCredentials.accountId, accountId));
}

export async function updateAmazonApiCredentialsLastSync(accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(amazonApiCredentials)
    .set({ lastSyncAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(amazonApiCredentials.accountId, accountId));
}

/**
 * 更新账户的时区和货币信息
 * 从 Amazon Advertising API 的 GET /v2/profiles 获取
 */

/**
 * 更新账户的时区和货币信息
 * 从 Amazon Advertising API 的 GET /v2/profiles 获取
 */
export async function updateAmazonApiCredentialsTimezone(
  accountId: number,
  timezone: string,
  currencyCode: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(amazonApiCredentials)
    .set({ 
      timezone,
      currencyCode,
      updatedAt: new Date().toISOString() 
    })
    .where(eq(amazonApiCredentials.accountId, accountId));
}

// ==================== Ad Automation Functions ====================

// 获取搜索词数据用于N-Gram分析 - 使用keywords表的数据
