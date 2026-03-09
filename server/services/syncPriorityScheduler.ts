/**
 * v373: 同步优先级调度服务
 * 
 * 解决500租户规模下的核心问题：
 * 1. 高频同步（15分钟）无法在周期内完成所有账号同步
 * 2. 所有租户一视同仁，活跃租户和不活跃租户获得相同同步频率
 * 3. 缺少基于租户活跃度的优先级调度
 * 
 * 设计方案：
 * - 引入租户同步优先级评分系统
 * - 高频同步改为滚动窗口模式：每个周期同步TOP-N个最高优先级账号
 * - 确保所有账号在合理时间内都能被同步到
 */
import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

const log = createModuleLogger('SyncPriority');

// ==================== 类型定义 ====================
interface AccountPriority {
  accountId: number;
  userId: number;
  accountName: string;
  marketplace: string;
  profileId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  region: string;
  lastSyncAt: Date | null;
  syncStatus: string | null;
  priorityScore: number;
  priorityReasons: string[];
}

interface PriorityConfig {
  /** 高频同步每周期最大账号数（滚动窗口） */
  highFreqMaxAccounts: number;
  /** 中频同步每周期最大账号数 */
  mediumFreqMaxAccounts: number;
  /** 完整同步不限制（全量） */
  fullSyncMaxAccounts: number;
  /** 距离上次同步超过此时间（分钟）的账号获得额外优先级 */
  staleSyncThresholdMinutes: number;
  /** 有活跃优化目标的账号优先级加分 */
  activeTargetBonus: number;
  /** 最近有用户操作的账号优先级加分 */
  recentActivityBonus: number;
  /** 距离上次同步每超过1分钟的加分 */
  staleSyncBonusPerMinute: number;
  /** 新账号（从未同步过）的优先级加分 */
  newAccountBonus: number;
}

// ==================== 配置 ====================
const DEFAULT_CONFIG: PriorityConfig = {
  highFreqMaxAccounts: 30,       // v374: 高频同步每周期最多30个账号（从50降低，确保15分钟内完成）
  mediumFreqMaxAccounts: 50,     // v374: 中频同步每周期最多50个账号（从100降低）
  fullSyncMaxAccounts: 25,       // v374: 完整同步每周期最多25个账号（从9999降低，实现分批轮转）
  staleSyncThresholdMinutes: 30, // 30分钟未同步视为过期
  activeTargetBonus: 30,         // 有活跃优化目标加30分
  recentActivityBonus: 20,       // 最近有用户操作加20分
  staleSyncBonusPerMinute: 0.5,  // 每超过1分钟加0.5分
  newAccountBonus: 50,           // 新账号（从未同步）加50分
};

// ==================== 动态并发控制 ====================
interface DynamicConcurrencyState {
  currentConcurrency: number;
  minConcurrency: number;
  maxConcurrency: number;
  recentThrottleCount: number;
  recentSuccessCount: number;
  lastAdjustTime: Date;
  currentBatchDelay: number;
  minBatchDelay: number;
  maxBatchDelay: number;
}

const concurrencyState: DynamicConcurrencyState = {
  currentConcurrency: parseInt(process.env.MAX_CONCURRENT_ACCOUNTS || '10', 10),
  minConcurrency: 3,
  maxConcurrency: parseInt(process.env.MAX_CONCURRENT_ACCOUNTS || '10', 10),
  recentThrottleCount: 0,
  recentSuccessCount: 0,
  lastAdjustTime: new Date(),
  currentBatchDelay: 200,
  minBatchDelay: 100,
  maxBatchDelay: 2000,
};

// ==================== 优先级评分 ====================

/**
 * 为账号列表计算同步优先级评分
 */
export async function calculateAccountPriorities(
  accounts: AccountPriority[],
  config: PriorityConfig = DEFAULT_CONFIG
): Promise<AccountPriority[]> {
  const database = await getDb();
  if (!database) {
    log.warn('[SyncPriority] v373: 数据库不可用，使用默认优先级排序');
    return accounts;
  }

  try {
    // 批量查询活跃优化目标数
    const activeTargetCounts = new Map<number, number>();
    try {
      const targetResults = await database.execute(
        sql`SELECT account_id, COUNT(*) as target_count 
            FROM performance_groups 
            WHERE status = 'active' 
            GROUP BY account_id`
      );
      const rows = Array.isArray(targetResults) ? targetResults : 
                   (targetResults as any)?.[0] || [];
      for (const row of rows as any[]) {
        activeTargetCounts.set(Number(row.account_id), Number(row.target_count));
      }
    } catch (err) {
      log.warn(`[SyncPriority] v373: 查询活跃优化目标失败: ${(err as Error).message}`);
    }

    // 批量查询最近用户活动（最近30分钟内有操作的账号）
    const recentlyActiveAccounts = new Set<number>();
    try {
      const activityResults = await database.execute(
        sql`SELECT DISTINCT account_id FROM optimization_logs 
            WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
            UNION
            SELECT DISTINCT account_id FROM optimization_events 
            WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)`
      );
      const rows = Array.isArray(activityResults) ? activityResults : 
                   (activityResults as any)?.[0] || [];
      for (const row of rows as any[]) {
        recentlyActiveAccounts.add(Number(row.account_id));
      }
    } catch (err) {
      log.warn(`[SyncPriority] v373: 查询最近用户活动失败: ${(err as Error).message}`);
    }

    // 计算每个账号的优先级评分
    const now = Date.now();
    for (const account of accounts) {
      let score = 0;
      const reasons: string[] = [];

      // 1. 从未同步过的新账号 - 最高优先级
      if (!account.lastSyncAt) {
        score += config.newAccountBonus;
        reasons.push(`新账号+${config.newAccountBonus}`);
      } else {
        // 2. 距离上次同步时间越长，优先级越高
        const minutesSinceSync = (now - new Date(account.lastSyncAt).getTime()) / 60000;
        if (minutesSinceSync > config.staleSyncThresholdMinutes) {
          const staleBonus = Math.min(
            (minutesSinceSync - config.staleSyncThresholdMinutes) * config.staleSyncBonusPerMinute,
            100 // 最多加100分
          );
          score += staleBonus;
          reasons.push(`过期${Math.round(minutesSinceSync)}min+${staleBonus.toFixed(1)}`);
        }
      }

      // 3. 有活跃优化目标的账号
      const targetCount = activeTargetCounts.get(account.accountId) || 0;
      if (targetCount > 0) {
        const targetBonus = Math.min(config.activeTargetBonus * targetCount, 90);
        score += targetBonus;
        reasons.push(`${targetCount}个活跃目标+${targetBonus}`);
      }

      // 4. 最近有用户操作的账号
      if (recentlyActiveAccounts.has(account.accountId)) {
        score += config.recentActivityBonus;
        reasons.push(`近期活跃+${config.recentActivityBonus}`);
      }

      account.priorityScore = score;
      account.priorityReasons = reasons;
    }

    // 按优先级降序排序
    accounts.sort((a, b) => b.priorityScore - a.priorityScore);

    log.info(`[SyncPriority] v373: 优先级评分完成，${accounts.length}个账号，` +
      `TOP3: ${accounts.slice(0, 3).map(a => `${a.accountId}(${a.priorityScore.toFixed(0)}分)`).join(', ')}`);

    return accounts;
  } catch (err) {
    log.error(`[SyncPriority] v373: 优先级评分失败: ${(err as Error).message}`);
    return accounts;
  }
}

/**
 * 获取指定层级的最大同步账号数
 */
export function getMaxAccountsForTier(tier: string, config: PriorityConfig = DEFAULT_CONFIG): number {
  switch (tier) {
    case 'high': return config.highFreqMaxAccounts;
    case 'medium': return config.mediumFreqMaxAccounts;
    case 'full': return config.fullSyncMaxAccounts;
    default: return config.fullSyncMaxAccounts;
  }
}

// ==================== 动态并发控制 ====================

/**
 * 记录API限流事件，触发并发降级
 */
export function recordThrottleEvent(): void {
  concurrencyState.recentThrottleCount++;
  
  // 如果短时间内多次限流，立即降级
  if (concurrencyState.recentThrottleCount >= 3) {
    const oldConcurrency = concurrencyState.currentConcurrency;
    concurrencyState.currentConcurrency = Math.max(
      concurrencyState.minConcurrency,
      Math.floor(concurrencyState.currentConcurrency * 0.7) // 降低30%
    );
    concurrencyState.currentBatchDelay = Math.min(
      concurrencyState.maxBatchDelay,
      concurrencyState.currentBatchDelay * 1.5 // 增加50%延迟
    );
    concurrencyState.recentThrottleCount = 0;
    concurrencyState.lastAdjustTime = new Date();
    
    log.warn(`[SyncPriority] v373: API限流降级 - 并发 ${oldConcurrency}→${concurrencyState.currentConcurrency}, ` +
      `延迟 ${concurrencyState.currentBatchDelay}ms`);
  }
}

/**
 * 记录API成功事件，尝试并发升级
 */
export function recordSuccessEvent(): void {
  concurrencyState.recentSuccessCount++;
  
  // 连续成功50次且距离上次调整超过5分钟，尝试升级
  const timeSinceLastAdjust = Date.now() - concurrencyState.lastAdjustTime.getTime();
  if (concurrencyState.recentSuccessCount >= 50 && timeSinceLastAdjust > 5 * 60 * 1000) {
    const oldConcurrency = concurrencyState.currentConcurrency;
    concurrencyState.currentConcurrency = Math.min(
      concurrencyState.maxConcurrency,
      concurrencyState.currentConcurrency + 1 // 逐步增加1
    );
    concurrencyState.currentBatchDelay = Math.max(
      concurrencyState.minBatchDelay,
      concurrencyState.currentBatchDelay * 0.9 // 减少10%延迟
    );
    concurrencyState.recentSuccessCount = 0;
    concurrencyState.recentThrottleCount = 0;
    concurrencyState.lastAdjustTime = new Date();
    
    if (oldConcurrency !== concurrencyState.currentConcurrency) {
      log.info(`[SyncPriority] v373: API成功升级 - 并发 ${oldConcurrency}→${concurrencyState.currentConcurrency}, ` +
        `延迟 ${concurrencyState.currentBatchDelay.toFixed(0)}ms`);
    }
  }
}

/**
 * 获取当前动态并发数
 */
export function getCurrentConcurrency(): number {
  return concurrencyState.currentConcurrency;
}

/**
 * 获取当前动态批次延迟
 */
export function getCurrentBatchDelay(): number {
  return Math.round(concurrencyState.currentBatchDelay);
}

/**
 * 获取动态并发状态
 */
export function getConcurrencyStatus(): DynamicConcurrencyState {
  return { ...concurrencyState };
}

/**
 * 重置动态并发状态（同步周期完成后调用）
 */
export function resetConcurrencyCounters(): void {
  concurrencyState.recentThrottleCount = 0;
  concurrencyState.recentSuccessCount = 0;
}
