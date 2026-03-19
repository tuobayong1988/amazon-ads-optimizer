/**
 * v443: 僵尸账户自动检测与标注机制
 * 
 * 功能:
 * - 在每次high层批量同步完成后自动运行
 * - 检查所有active账户的最近N次同步记录
 * - 如果连续N次同步都返回0条记录，自动标记为paused
 * - 记录检测事件到ops日志和data_sync_logs
 * 
 * 设计原则:
 * - 保守策略: 需要连续10次同步0记录才触发（约20小时的观察窗口）
 * - 可恢复: 用户可以在后台手动将账户重新激活为active
 * - 透明: 所有自动暂停操作都有完整日志记录
 */
import { createModuleLogger } from '../../utils/logger';
import { sql } from 'drizzle-orm';
import { logSync, logSyncWarn } from '../../utils/opsLogger';

const log = createModuleLogger('zombieAccountDetector');

// ==================== 配置 ====================

/** 连续多少次同步0记录才判定为僵尸账户 */
const CONSECUTIVE_ZERO_THRESHOLD = 10;

/** 检查的最近同步记录数量（应 >= CONSECUTIVE_ZERO_THRESHOLD） */
const CHECK_WINDOW_SIZE = 10;

// ==================== 类型 ====================

export interface ZombieDetectionResult {
  checkedAccounts: number;
  detectedZombies: ZombieAccount[];
  pausedAccounts: number;
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
 * 执行僵尸账户检测
 * 在每次high层批量同步完成后调用
 */
export async function detectAndPauseZombieAccounts(): Promise<ZombieDetectionResult> {
  const result: ZombieDetectionResult = {
    checkedAccounts: 0,
    detectedZombies: [],
    pausedAccounts: 0,
    errors: [],
  };

  try {
    const { getDb } = await import('../../db');
    const database = await getDb();
    if (!database) {
      result.errors.push('数据库不可用');
      return result;
    }

    // 1. 获取所有active状态的账户
    const activeAccounts = await database.execute(sql`
      SELECT id, accountName, marketplace
      FROM ad_accounts
      WHERE status = 'active'
    `);

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

        // 查询最近N次completed状态的同步记录
        const recentSyncs = await database.execute(sql`
          SELECT recordsSynced, completedAt
          FROM data_sync_jobs
          WHERE accountId = ${accountId}
            AND status = 'completed'
          ORDER BY completedAt DESC
          LIMIT ${CHECK_WINDOW_SIZE}
        `);

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
          const olderRows = (olderSync as Record<string, unknown>)[0] || olderSync;
          if (Array.isArray(olderRows) && olderRows.length > 0) {
            lastNonZeroSyncAt = olderRows[0].completedAt ? new Date(olderRows[0].completedAt).toISOString() : null;
          }
        }

        // 5. 判定是否为僵尸账户
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

            const pauseMsg = `🔇 自动暂停僵尸账户: ${accountId}(${accountName}, ${marketplace}) — 连续${consecutiveZeros}次同步0条记录, 最后有数据: ${lastNonZeroSyncAt || '从未'}`;
            log.warn(`[ZombieDetector] ${pauseMsg}`);
            logSyncWarn('ZombieDetector', pauseMsg, {
              accountId,
              accountName,
              marketplace,
              consecutiveZeros,
              lastNonZeroSyncAt,
              action: 'auto_paused',
            });
          } catch (pauseErr: unknown) {
            const errMsg = `暂停账户${accountId}失败: ${(pauseErr as Error).message}`;
            log.error(`[ZombieDetector] ${errMsg}`);
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
    if (result.detectedZombies.length > 0) {
      log.warn(`[ZombieDetector] 检测完成: 检查${result.checkedAccounts}个账户, 发现${result.detectedZombies.length}个僵尸账户, 自动暂停${result.pausedAccounts}个`);
      logSyncWarn('ZombieDetector', `僵尸账户检测完成`, {
        checkedAccounts: result.checkedAccounts,
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
      log.info(`[ZombieDetector] 检测完成: 检查${result.checkedAccounts}个账户, 所有账户同步正常`);
    }

    return result;
  } catch (error: unknown) {
    const errMsg = `僵尸账户检测失败: ${(error as Error).message}`;
    log.error(`[ZombieDetector] ${errMsg}`);
    result.errors.push(errMsg);
    return result;
  }
}
