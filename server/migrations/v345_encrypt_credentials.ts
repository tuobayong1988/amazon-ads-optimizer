import { createModuleLogger } from "../utils/logger";
const log = createModuleLogger("Migration:v345enc");
/**
 * v345 数据迁移脚本: 加密现有明文凭证 + 扩展clientSecret列
 * 
 * 执行步骤:
 * 1. 将 clientSecret 列从 VARCHAR(255) 扩展为 TEXT（加密后数据更长）
 * 2. 读取所有现有凭证
 * 3. 对未加密的 clientSecret 和 refreshToken 进行加密
 * 4. 写回数据库
 * 
 * 安全特性:
 * - 幂等操作：已加密的数据不会被重复加密
 * - 事务保护：单条记录更新失败不影响其他记录
 * - 详细日志：记录每条记录的处理结果
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { encrypt, isEncrypted, isCryptoAvailable, selfTest } from '../utils/cryptoService';

export async function migrateEncryptCredentials(): Promise<{
  success: boolean;
  totalRecords: number;
  encrypted: number;
  skipped: number;
  failed: number;
  errors: string[];
}> {
  const result = {
    success: false,
    totalRecords: 0,
    encrypted: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
  };

  log.info('[v345-migration] 开始凭证加密迁移...');

  // 前置检查: 加密服务是否可用
  if (!isCryptoAvailable()) {
    const msg = 'ENCRYPTION_KEY 环境变量未配置，跳过凭证加密迁移';
    console.warn(`[v345-migration] ${msg}`);
    result.errors.push(msg);
    return result;
  }

  // 前置检查: 自检加密/解密流程
  const test = selfTest();
  if (!test.success) {
    const msg = `加密服务自检失败: ${test.error}`;
    console.error(`[v345-migration] ${msg}`);
    result.errors.push(msg);
    return result;
  }
  log.info('[v345-migration] 加密服务自检通过');

  const db = await getDb();
  if (!db) {
    result.errors.push('数据库连接不可用');
    return result;
  }

  try {
    // 步骤1: 扩展 clientSecret 列为 TEXT
    log.info('[v345-migration] 步骤1: 检查并扩展 clientSecret 列...');
    try {
      await db.execute(sql`
        ALTER TABLE amazon_api_credentials 
        MODIFY COLUMN clientSecret TEXT NOT NULL
      `);
      log.info('[v345-migration] clientSecret 列已扩展为 TEXT');
    } catch (alterError: unknown) {
      // 如果已经是 TEXT 类型，忽略错误
      log.info(`[v345-migration] ALTER TABLE 结果: ${(alterError as Error).message}`);
    }

    // 步骤2: 读取所有凭证记录
    log.info('[v345-migration] 步骤2: 读取所有凭证记录...');
    const rows = await db.execute(sql`
      SELECT id, accountId, clientSecret, refreshToken 
      FROM amazon_api_credentials
    `) as unknown;
    
    // @ts-ignore
    const records = rows[0] || rows;
    result.totalRecords = records.length;
    log.info(`[v345-migration] 共 ${records.length} 条凭证记录`);

    // 步骤3: 逐条加密
    for (const record of (records as any[])) {
      try {
        const needEncryptSecret = record.clientSecret && !isEncrypted(record.clientSecret);
        const needEncryptToken = record.refreshToken && !isEncrypted(record.refreshToken);

        if (!needEncryptSecret && !needEncryptToken) {
          result.skipped++;
          log.info(`[v345-migration] 账户 ${record.accountId}: 已加密，跳过`);
          continue;
        }

        const updates: string[] = [];
        
        if (needEncryptSecret) {
          const encryptedSecret = encrypt(record.clientSecret);
          await db.execute(sql`
            UPDATE amazon_api_credentials 
            SET clientSecret = ${encryptedSecret}
            WHERE id = ${record.id}
          `);
          updates.push('clientSecret');
        }

        if (needEncryptToken) {
          const encryptedToken = encrypt(record.refreshToken);
          await db.execute(sql`
            UPDATE amazon_api_credentials 
            SET refreshToken = ${encryptedToken}
            WHERE id = ${record.id}
          `);
          updates.push('refreshToken');
        }

        result.encrypted++;
        log.info(`[v345-migration] 账户 ${record.accountId}: 已加密 [${updates.join(', ')}]`);
      } catch (recordError: unknown) {
        result.failed++;
        const msg = `账户 ${record.accountId} 加密失败: ${(recordError as Error).message}`;
        result.errors.push(msg);
        console.error(`[v345-migration] ${msg}`);
      }
    }

    result.success = result.failed === 0;
    log.info(`[v345-migration] 迁移完成: 总计=${result.totalRecords}, 加密=${result.encrypted}, 跳过=${result.skipped}, 失败=${result.failed}`);
    
    return result;
  } catch (error: unknown) {
    result.errors.push(`迁移异常: ${(error as Error).message}`);
    console.error(`[v345-migration] 迁移异常:`, error);
    return result;
  }
}
