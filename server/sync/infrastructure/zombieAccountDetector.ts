/**
 * v644: 僵尸账户自动检测与标注机制（修复版）
 * 
 * v443原始功能:
 * - 在每次high层批量同步完成后自动运行
 * - 检查所有active账户的最近N次同步记录
 * - 如果连续N次同步都返回0条记录，自动标记为paused
 * 
 * v644修复:
 * - 新增自动恢复机制: 被auto_paused的账户在有API凭证时自动恢复为active
 * - 排除"有凭证但同步失败"的账户（这些不是真正的僵尸账户）
 * - 只暂停"确实没有广告活动"的空账户，而不是"因Token过期导致同步失败"的账户
 * - 提升阈值从10次到20次，避免误判
 * - 添加自动恢复日志
 * 
 * 设计原则:
 * - 保守策略: 需要连续20次同步0记录才触发
 * - 可恢复: 自动恢复机制 + 用户可手动激活
 * - 透明: 所有操作都有完整日志记录
 * - 安全: 不暂停有API凭证且最近有同步尝试的账户
 */
import { createModuleLogger } from '../../utils/logger';
import { sql } from 'drizzle-orm';
import { logSync, logSyncWarn } from '../../utils/opsLogger';

const log = createModuleLogger('zombieAccountDetector');

// ==================== 配置 ====================

/** v644: 连续多少次同步0记录才判定为僵尸账户（从10提升到20） */
const CONSECUTIVE_ZERO_THRESHOLD = 20;

/** 检查的最近同步记录数量（应 >= CONSECUTIVE_ZERO_THRESHOLD） */
const CHECK_WINDOW_SIZE = 20;

// ==================== 类型 ====================

export interface ZombieDetectionResult {
  checkedAccounts: number;
  detectedZombies: ZombieAccount[];
  pausedAccounts: number;
  recoveredAccounts: number;  // v644: 新增恢复计数
  errors: string[];
}

export interface ZombieAccount {
  accountId: number;
  accountName: string;
  marketplace: string;
  consecutiveZeroSyncs: number;
  lastNonZeroSyncAt: string | null;
  autoPaused: boolean;
}

// ==================== 核心逻辑 ====================

/**
 * v644: 自动恢复被误暂停的账户
 * 检查所有paused状态的账户，如果它们有有效的API凭证，自动恢复为active
 */
async function autoRecoverPausedAccounts(database: any): Promise<number> {
  let recoveredCount = 0;
  try {
    // 查找所有被自动暂停的账户（有API凭证但状态为paused）
    const pausedWithCredentials = await database.execute(sql`
      SELECT a.id, a.accountName, a.marketplace, a.profileId,
             c.clientId, c.refreshToken
      FROM ad_accounts a
      INNER JOIN amazon_api_credentials c ON a.id = c.accountId
      WHERE a.status = 'paused'
        AND c.clientId IS NOT NULL
        AND c.refreshToken IS NOT NULL
        AND a.profileId IS NOT NULL
    `);

    // @ts-ignore Dynamic type assertion
    const accounts = (pausedWithCredentials as Record<string, unknown>)[0] || pausedWithCredentials;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return 0;
    }

    for (const account of accounts) {
      try {
        await database.execute(sql`
          UPDATE ad_accounts
          SET status = 'active'
          WHERE id = ${account.id} AND status = 'paused'
        `);
        recoveredCount++;
        const msg = `🔄 自动恢复账户: ${account.id}(${account.accountName}, ${account.marketplace}) — 检测到有效API凭证，从paused恢复为active`;
        log.info(`[ZombieDetector] ${msg}`);
        logSync('ZombieDetector', msg, {
          accountId: account.id,
          accountName: account.accountName,
          marketplace: account.marketplace,
          action: 'auto_recovered',
        });
      } catch (recoverErr: unknown) {
        log.warn(`[ZombieDetector] 恢复账户${account.id}失败: ${(recoverErr as Error).message}`);
      }
    }

    if (recoveredCount > 0) {
      log.info(`[ZombieDetector] v644: 自动恢复了 ${recoveredCount} 个被误暂停的账户`);
    }
  } catch (error: unknown) {
    log.warn(`[ZombieDetector] v644: 自动恢复检查失败: ${(error as Error).message}`);
  }
  return recoveredCount;
}

/**
 * 执行僵尸账户检测
 * v644: 先执行自动恢复，再执行检测
 */
export async function detectAndPauseZombieAccounts(): Promise<ZombieDetectionResult> {
  const result: ZombieDetectionResult = {
    checkedAccounts: 0,
    detectedZombies: [],
    pausedAccounts: 0,
    recoveredAccounts: 0,
    errors: [],
  };

  try {
    const { getDb } = await import('../../db');
    const database = await getDb();
    if (!database) {
      result.errors.push('数据库不可用');
      return result;
    }

    // v644: 第0步 - 先自动恢复被误暂停的账户
    result.recoveredAccounts = await autoRecoverPausedAccounts(database);

    // 1. 获取所有active状态的账户
    const activeAccounts = await database.execute(sql`
      SELECT id, accountName, marketplace
      FROM ad_accounts
      WHERE status = 'active'
    `);

    // @ts-ignore Dynamic type assertion
    const accounts = (activeAccounts as Record<string, unknown>)[0] || activeAccounts;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      log.info('[ZombieDetector] 没有active状态的账户需要检查');
      return result;
    }

    result.checkedAccounts = accounts.length;
    log.info(`[ZombieDetector] 开始检查 ${accounts.length} 个active账户的同步健康状态`);

    // 2. 逐个检查每个账户的最近N次同步记录
    for (const account of accounts) {
      try {
        const accountId = account.id;
        const accountName = account.accountName || `Account-${accountId}`;
        const marketplace = account.marketplace || 'Unknown';

        // v644: 先检查该账户是否有API凭证 - 有凭证的账户不应被暂停
        const credCheck = await database.execute(sql`
          SELECT COUNT(*) as cnt
          FROM amazon_api_credentials
          WHERE accountId = ${accountId}
            AND clientId IS NOT NULL
            AND refreshToken IS NOT NULL
        `);
        // @ts-ignore Dynamic type assertion
        const credRows = (credCheck as Record<string, unknown>)[0] || credCheck;
        const hasCredentials = Array.isArray(credRows) && credRows.length > 0 && Number(credRows[0]?.cnt) > 0;

        if (hasCredentials) {
          // v644: 有API凭证的账户不暂停（可能只是Token过期或临时性问题）
          continue;
        }

        // 查询最近N次completed状态的同步记录
        const recentSyncs = await database.execute(sql`
          SELECT recordsSynced, completedAt
          FROM data_sync_jobs
          WHERE accountId = ${accountId}
            AND status = 'completed'
          ORDER BY completedAt DESC
          LIMIT ${sql.raw(String(CHECK_WINDOW_SIZE))}
        `);

        // @ts-ignore Dynamic type assertion
        const syncRows = (recentSyncs as Record<string, unknown>)[0] || recentSyncs;
        if (!Array.isArray(syncRows) || syncRows.length < CHECK_WINDOW_SIZE) {
          // 同步记录不足，跳过（新账户或刚开始同步的账户）
          continue;
        }

        // 3. 计算连续0记录的次数
        let consecutiveZeros = 0;
        for (const sync of syncRows) {
          const synced = Number(sync.recordsSynced) || 0;
          if (synced === 0) {
            consecutiveZeros++;
          } else {
            break; // 遇到非0记录就停止计数
          }
        }

        // 4. 找到最后一次有数据的同步时间
        let lastNonZeroSyncAt: string | null = null;
        for (const sync of syncRows) {
          if (Number(sync.recordsSynced) > 0) {
            lastNonZeroSyncAt = sync.completedAt ? new Date(sync.completedAt).toISOString() : null;
            break;
          }
        }

        // 如果最近N次全部为0但还没找到非0记录，查更早的记录
        if (!lastNonZeroSyncAt && consecutiveZeros >= CHECK_WINDOW_SIZE) {
          const olderSync = await database.execute(sql`
            SELECT completedAt
            FROM data_sync_jobs
            WHERE accountId = ${accountId}
              AND status = 'completed'
              AND recordsSynced > 0
            ORDER BY completedAt DESC
            LIMIT 1
          `);
          // @ts-ignore Dynamic type assertion
          const olderRows = (olderSync as Record<string, unknown>)[0] || olderSync;
          if (Array.isArray(olderRows) && olderRows.length > 0) {
            lastNonZeroSyncAt = olderRows[0].completedAt ? new Date(olderRows[0].completedAt).toISOString() : null;
          }
        }

        // 5. 判定是否为僵尸账户（只对无API凭证的账户执行）
        if (consecutiveZeros >= CONSECUTIVE_ZERO_THRESHOLD) {
          const zombie: ZombieAccount = {
            accountId,
            accountName,
            marketplace,
            consecutiveZeroSyncs: consecutiveZeros,
            lastNonZeroSyncAt,
            autoPaused: false,
          };

          // 自动标记为paused
          try {
            await database.execute(sql`
              UPDATE ad_accounts
              SET status = 'paused'
              WHERE id = ${accountId} AND status = 'active'
            `);
            zombie.autoPaused = true;
            result.pausedAccounts++;

            const pauseMsg = `🔇 自动暂停僵尸账户: ${accountId}(${accountName}, ${marketplace}) — 连续${consecutiveZeros}次同步0条记录, 最后有数据: ${lastNonZeroSyncAt || '从未'}, 无API凭证`;
            log.warn(`[ZombieDetector] ${pauseMsg}`);
            logSyncWarn('ZombieDetector', pauseMsg, {
              accountId,
              accountName,
              marketplace,
              consecutiveZeros,
              lastNonZeroSyncAt,
              action: 'auto_paused',
              hasCredentials: false,
            });
          } catch (pauseErr: unknown) {
            const errMsg = `暂停账户${accountId}失败: ${(pauseErr as Error).message}`;
            log.warn(`[ZombieDetector] ${errMsg}`);
            result.errors.push(errMsg);
          }

          result.detectedZombies.push(zombie);
        }
      } catch (accountErr: unknown) {
        const errMsg = `检查账户${account.id}失败: ${(accountErr as Error).message}`;
        log.warn(`[ZombieDetector] ${errMsg}`);
        result.errors.push(errMsg);
      }
    }

    // 6. 输出检测摘要
    if (result.detectedZombies.length > 0 || result.recoveredAccounts > 0) {
      log.warn(`[ZombieDetector] v644检测完成: 检查${result.checkedAccounts}个账户, 恢复${result.recoveredAccounts}个, 发现${result.detectedZombies.length}个僵尸账户, 自动暂停${result.pausedAccounts}个`);
      logSyncWarn('ZombieDetector', `僵尸账户检测完成(v644)`, {
        checkedAccounts: result.checkedAccounts,
        recoveredAccounts: result.recoveredAccounts,
        detectedZombies: result.detectedZombies.length,
        pausedAccounts: result.pausedAccounts,
        zombies: result.detectedZombies.map(z => ({
          id: z.accountId,
          name: z.accountName,
          market: z.marketplace,
          zeros: z.consecutiveZeroSyncs,
          paused: z.autoPaused,
        })),
      });
    } else {
      log.info(`[ZombieDetector] v644检测完成: 检查${result.checkedAccounts}个账户, 恢复${result.recoveredAccounts}个, 所有账户同步正常`);
    }

    return result;
  } catch (error: unknown) {
    const errMsg = `僵尸账户检测失败: ${(error as Error).message}`;
    log.warn(`[ZombieDetector] ${errMsg}`);
    result.errors.push(errMsg);
    return result;
  }
}
