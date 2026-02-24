/**
 * Unified Sync Engine v220 - 统一数据同步引擎
 * 
 * 核心职责：
 * 1. 自动发现所有活跃账户（无需依赖data_sync_schedules表）
 * 2. 分层同步策略（高频/中频/完整）
 * 3. 多账户并发控制
 * 4. 检查点/恢复机制
 * 5. 优化后确认同步（防止重复优化）
 * 6. 步骤级错误隔离
 * 7. API调用速率控制（v220）
 * 8. 系统健康监控（v220）
 * 
 * 设计原则：
 * - 零配置：新授权的账户自动纳入同步
 * - 高可靠：单步失败不影响其他步骤和账户
 * - 可观测：完整的同步状态和进度追踪
 * - 幂等性：重复执行不会产生副作用
 * - 自适应：根据API限流反馈动态调整速率（v220）
 */

import * as db from './db';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { AmazonSyncService } from './amazonSyncService';
import { createModuleLogger } from './utils/logger';
import { logSync, logSyncWarn, logSyncError } from './utils/opsLogger';

const log = createModuleLogger('UnifiedSync');

// ==================== v220: API速率控制器 ====================

/**
 * 自适应API速率控制器
 * 
 * Amazon Advertising API 限制：
 * - 列表/报告端点: 约10 TPS (每秒事务数)
 * - 批量更新端点: 约5 TPS
 * - 报告请求端点: 约1 TPS
 * 
 * 策略：
 * - 维护滑动窗口内的API调用计数
 * - 当接近限额时主动降速（插入延迟）
 * - 遇到429后指数退避并降低基线速率
 * - 一段时间无429后逐步恢复速率
 */
class ApiRateController {
  // 滑动窗口配置
  private windowMs = 60_000; // 1分钟窗口
  private maxCallsPerWindow = 120; // 每分钟最多120次API调用（保守值，实际限额更高）
  private callTimestamps: number[] = [];
  
  // 自适应速率
  private baseStepDelayMs = 200; // 步骤间基础延迟（毫秒）
  private currentStepDelayMs = 200; // 当前步骤间延迟
  private baseBatchDelayMs = 2000; // 批次间基础延迟
  private currentBatchDelayMs = 2000; // 当前批次间延迟
  
  // 限流反馈
  private throttleCount = 0; // 当前窗口内被限流次数
  private totalThrottleCount = 0; // 总限流次数
  private lastThrottleTime: Date | null = null;
  private consecutiveSuccessWindows = 0; // 连续无限流的窗口数
  
  // 监控指标
  private totalApiCalls = 0;
  private windowApiCalls = 0;
  private peakCallsPerMinute = 0;

  /**
   * 记录一次API调用
   */
  recordApiCall(): void {
    const now = Date.now();
    this.callTimestamps.push(now);
    this.totalApiCalls++;
    this.windowApiCalls++;
    
    // 清理过期的时间戳
    this.pruneOldTimestamps(now);
    
    // 更新峰值
    const currentRate = this.getCallsInWindow();
    if (currentRate > this.peakCallsPerMinute) {
      this.peakCallsPerMinute = currentRate;
    }
  }

  /**
   * 记录一次限流事件（429响应）
   */
  recordThrottle(): void {
    this.throttleCount++;
    this.totalThrottleCount++;
    this.lastThrottleTime = new Date();
    this.consecutiveSuccessWindows = 0;
    
    // 遇到限流时增加延迟（指数退避）
    const backoffFactor = Math.min(Math.pow(1.5, this.throttleCount), 8); // 最多8倍
    this.currentStepDelayMs = Math.min(this.baseStepDelayMs * backoffFactor, 5000); // 最多5秒
    this.currentBatchDelayMs = Math.min(this.baseBatchDelayMs * backoffFactor, 30000); // 最多30秒
    
    log.warn(`[RateControl] API限流! 第${this.throttleCount}次, 步骤延迟调整为${this.currentStepDelayMs}ms, 批次延迟调整为${this.currentBatchDelayMs}ms`);
    logSyncWarn('RateControl', 'API限流触发退避', {
      throttleCount: this.throttleCount,
      totalThrottles: this.totalThrottleCount,
      stepDelay: this.currentStepDelayMs,
      batchDelay: this.currentBatchDelayMs,
    });
  }

  /**
   * 获取步骤间应等待的延迟（毫秒）
   * 根据当前API调用速率动态调整
   */
  getStepDelay(): number {
    const currentRate = this.getCallsInWindow();
    const utilizationRatio = currentRate / this.maxCallsPerWindow;
    
    if (utilizationRatio > 0.8) {
      // 超过80%利用率，显著增加延迟
      return Math.max(this.currentStepDelayMs * 2, 1000);
    } else if (utilizationRatio > 0.6) {
      // 超过60%利用率，适度增加延迟
      return Math.max(this.currentStepDelayMs * 1.5, 500);
    }
    
    return this.currentStepDelayMs;
  }

  /**
   * 获取批次间应等待的延迟（毫秒）
   */
  getBatchDelay(): number {
    const currentRate = this.getCallsInWindow();
    const utilizationRatio = currentRate / this.maxCallsPerWindow;
    
    if (utilizationRatio > 0.7) {
      return Math.max(this.currentBatchDelayMs * 2, 5000);
    }
    
    return this.currentBatchDelayMs;
  }

  /**
   * 在同步周期结束时调用，尝试恢复速率
   */
  onSyncCycleComplete(): void {
    if (this.throttleCount === 0) {
      this.consecutiveSuccessWindows++;
      
      // 连续3个无限流的周期后，逐步恢复速率
      if (this.consecutiveSuccessWindows >= 3 && this.currentStepDelayMs > this.baseStepDelayMs) {
        this.currentStepDelayMs = Math.max(
          this.baseStepDelayMs,
          this.currentStepDelayMs * 0.7 // 每次恢复30%
        );
        this.currentBatchDelayMs = Math.max(
          this.baseBatchDelayMs,
          this.currentBatchDelayMs * 0.7
        );
        log.info(`[RateControl] 速率恢复: 步骤延迟=${this.currentStepDelayMs}ms, 批次延迟=${this.currentBatchDelayMs}ms`);
      }
    }
    
    // 重置窗口限流计数
    this.throttleCount = 0;
    this.windowApiCalls = 0;
  }

  /**
   * 获取速率控制器状态（用于监控日志）
   */
  getStatus(): RateControlStatus {
    return {
      totalApiCalls: this.totalApiCalls,
      callsInCurrentWindow: this.getCallsInWindow(),
      peakCallsPerMinute: this.peakCallsPerMinute,
      currentStepDelayMs: this.currentStepDelayMs,
      currentBatchDelayMs: this.currentBatchDelayMs,
      totalThrottleCount: this.totalThrottleCount,
      lastThrottleTime: this.lastThrottleTime,
      consecutiveSuccessWindows: this.consecutiveSuccessWindows,
      utilizationPercent: Math.round((this.getCallsInWindow() / this.maxCallsPerWindow) * 100),
    };
  }

  private getCallsInWindow(): number {
    this.pruneOldTimestamps(Date.now());
    return this.callTimestamps.length;
  }

  private pruneOldTimestamps(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.callTimestamps.length > 0 && this.callTimestamps[0] < cutoff) {
      this.callTimestamps.shift();
    }
  }
}

/** 速率控制器状态 */
export interface RateControlStatus {
  totalApiCalls: number;
  callsInCurrentWindow: number;
  peakCallsPerMinute: number;
  currentStepDelayMs: number;
  currentBatchDelayMs: number;
  totalThrottleCount: number;
  lastThrottleTime: Date | null;
  consecutiveSuccessWindows: number;
  utilizationPercent: number;
}

// 全局速率控制器实例
const rateController = new ApiRateController();

// ==================== v220: 系统健康监控 ====================

/** 系统健康快照 */
export interface HealthSnapshot {
  timestamp: string;
  memoryMB: { rss: number; heapUsed: number; heapTotal: number; heapUtilization: number };
  rateControl: RateControlStatus;
  syncStats: {
    totalSyncsCompleted: number;
    totalSyncsFailed: number;
    activeSyncs: number;
    discoveredAccounts: number;
  };
  confirmationSyncStats: {
    totalTriggered: number;
    totalSucceeded: number;
    totalFailed: number;
    avgDurationMs: number;
    lastTriggeredAt: string | null;
    triggerSources: Record<string, number>;
  };
}

// 确认同步追踪器
const confirmationTracker = {
  totalTriggered: 0,
  totalSucceeded: 0,
  totalFailed: 0,
  totalDurationMs: 0,
  lastTriggeredAt: null as string | null,
  triggerSources: {} as Record<string, number>,
};

// 健康快照历史（保留最近24个，每15分钟一个 = 6小时历史）
const healthHistory: HealthSnapshot[] = [];
const MAX_HEALTH_HISTORY = 24;

/**
 * 采集系统健康快照
 */
export function captureHealthSnapshot(): HealthSnapshot {
  const mem = process.memoryUsage();
  const snapshot: HealthSnapshot = {
    timestamp: new Date().toISOString(),
    memoryMB: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      heapUtilization: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    },
    rateControl: rateController.getStatus(),
    syncStats: {
      totalSyncsCompleted: engineStatus.totalSyncsCompleted,
      totalSyncsFailed: engineStatus.totalSyncsFailed,
      activeSyncs: activeSyncs.size,
      discoveredAccounts: engineStatus.discoveredAccounts,
    },
    confirmationSyncStats: {
      totalTriggered: confirmationTracker.totalTriggered,
      totalSucceeded: confirmationTracker.totalSucceeded,
      totalFailed: confirmationTracker.totalFailed,
      avgDurationMs: confirmationTracker.totalTriggered > 0
        ? Math.round(confirmationTracker.totalDurationMs / confirmationTracker.totalTriggered)
        : 0,
      lastTriggeredAt: confirmationTracker.lastTriggeredAt,
      triggerSources: { ...confirmationTracker.triggerSources },
    },
  };

  // 保存到历史
  healthHistory.push(snapshot);
  if (healthHistory.length > MAX_HEALTH_HISTORY) {
    healthHistory.shift();
  }

  return snapshot;
}

/**
 * 输出健康监控日志（每15分钟由调度器调用）
 */
export function logHealthSnapshot(): void {
  const snapshot = captureHealthSnapshot();
  
  const memWarning = snapshot.memoryMB.heapUtilization > 90 ? ' [WARNING: 堆内存>90%]' : '';
  const throttleWarning = snapshot.rateControl.totalThrottleCount > 0 
    ? ` [限流: ${snapshot.rateControl.totalThrottleCount}次]` : '';
  
  log.info(
    `[HealthMonitor] v220 系统健康快照:` +
    ` 内存=${snapshot.memoryMB.rss}MB(堆${snapshot.memoryMB.heapUtilization}%)${memWarning}` +
    ` | API调用=${snapshot.rateControl.totalApiCalls}(峰值${snapshot.rateControl.peakCallsPerMinute}/min, 利用率${snapshot.rateControl.utilizationPercent}%)${throttleWarning}` +
    ` | 同步=${snapshot.syncStats.totalSyncsCompleted}成功/${snapshot.syncStats.totalSyncsFailed}失败` +
    ` | 确认同步=${snapshot.confirmationSyncStats.totalTriggered}次(成功${snapshot.confirmationSyncStats.totalSucceeded}, 平均${snapshot.confirmationSyncStats.avgDurationMs}ms)`
  );
  
  logSync('HealthMonitor', 'v220 系统健康快照', snapshot);
  
  // 内存泄漏检测：如果最近4个快照RSS持续增长，发出警告
  if (healthHistory.length >= 4) {
    const recent4 = healthHistory.slice(-4);
    const isMonotonicallyIncreasing = recent4.every((s, i) => 
      i === 0 || s.memoryMB.rss > recent4[i - 1].memoryMB.rss
    );
    if (isMonotonicallyIncreasing) {
      const growth = recent4[3].memoryMB.rss - recent4[0].memoryMB.rss;
      log.warn(`[HealthMonitor] 内存泄漏疑似: RSS连续4个周期增长, 增量=${growth}MB (${recent4[0].memoryMB.rss}MB → ${recent4[3].memoryMB.rss}MB)`);
      logSyncWarn('HealthMonitor', '内存泄漏疑似', {
        growth,
        from: recent4[0].memoryMB.rss,
        to: recent4[3].memoryMB.rss,
        snapshots: recent4.map(s => ({ time: s.timestamp, rss: s.memoryMB.rss })),
      });
    }
  }
}

/**
 * 获取健康快照历史
 */
export function getHealthHistory(): HealthSnapshot[] {
  return [...healthHistory];
}

// ==================== 类型定义 ====================

/** 同步层级 */
export type SyncTier = 'high' | 'medium' | 'full' | 'confirmation';

/** 可同步账户（自动发现的） */
export interface SyncableAccount {
  accountId: number;
  userId: number;
  accountName: string;
  marketplace: string;
  profileId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  region: 'NA' | 'EU' | 'FE';
  lastSyncAt: string | null;
  syncStatus: string | null;
}

/** 同步步骤定义 */
export interface SyncStep {
  id: string;
  name: string;
  tier: SyncTier; // 该步骤属于哪个同步层级
  execute: (service: AmazonSyncService, context: SyncContext) => Promise<StepResult>;
}

/** 步骤执行结果 */
export interface StepResult {
  success: boolean;
  synced: number;
  errors: string[];
  details?: Record<string, any>;
}

/** 同步上下文（用于检查点和进度追踪） */
export interface SyncContext {
  accountId: number;
  userId: number;
  tier: SyncTier;
  startTime: Date;
  completedSteps: string[];
  failedSteps: string[];
  currentStep: string | null;
  totalSynced: number;
  totalErrors: number;
  checkpoint: Record<string, any>;
}

/** 账户同步结果 */
export interface AccountSyncResult {
  accountId: number;
  accountName: string;
  tier: SyncTier;
  success: boolean;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  completedSteps: number;
  failedSteps: number;
  totalSteps: number;
  totalSynced: number;
  errors: string[];
  stepResults: Record<string, StepResult>;
}

/** 批量同步结果 */
export interface BatchSyncResult {
  tier: SyncTier;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  totalAccounts: number;
  successfulAccounts: number;
  failedAccounts: number;
  skippedAccounts: number;
  accountResults: AccountSyncResult[];
}

/** 引擎状态 */
export interface EngineStatus {
  isRunning: boolean;
  lastSyncTime: Record<SyncTier, Date | null>;
  nextSyncTime: Record<SyncTier, Date | null>;
  totalSyncsCompleted: number;
  totalSyncsFailed: number;
  currentlyRunning: { accountId: number; tier: SyncTier; step: string }[];
  recentErrors: string[];
  discoveredAccounts: number;
}

// ==================== 同步步骤注册表 ====================

/**
 * 定义所有同步步骤及其所属层级
 * 高频步骤：广告活动状态、当日绩效
 * 中频步骤：广告组、关键词、定位、搜索词
 * 完整步骤：否定词、广告位、素材、历史绩效
 */
const SYNC_STEPS: SyncStep[] = [
  // === 高频同步步骤（每15分钟） ===
  {
    id: 'sp_campaigns',
    name: 'SP广告活动',
    tier: 'high',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSpCampaigns();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_campaigns',
    name: 'SB广告活动',
    tier: 'high',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSbCampaigns();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sd_campaigns',
    name: 'SD广告活动',
    tier: 'high',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSdCampaigns();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'performance_today',
    name: '当日绩效',
    tier: 'high',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncPerformanceOnly(1);
        return { success: true, synced: synced || 0, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },

  // === 中频同步步骤（每30分钟） ===
  {
    id: 'sp_ad_groups',
    name: 'SP广告组',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSpAdGroups();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_ad_groups',
    name: 'SB广告组',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSbAdGroups();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sd_ad_groups',
    name: 'SD广告组',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSdAdGroups();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sp_keywords',
    name: 'SP关键词',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSpKeywords();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_keywords',
    name: 'SB关键词',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSbKeywords();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sp_product_targets',
    name: 'SP商品定位',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSpProductTargets();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_product_targets',
    name: 'SB商品定位',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSbProductTargets();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sd_product_targets',
    name: 'SD商品定位',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSdProductTargets();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'performance_7d',
    name: '7天绩效回溯',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncPerformanceOnly(7);
        return { success: true, synced: synced || 0, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },

  // === 完整同步步骤（每60分钟） ===
  {
    id: 'sp_negative_keywords',
    name: 'SP否定关键词',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSpNegativeKeywords();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_negative_keywords',
    name: 'SB否定关键词',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSbNegativeKeywords();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sp_negative_targets',
    name: 'SP否定商品定位',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSpNegativeProductTargets();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_negative_targets',
    name: 'SB否定商品定位',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSbNegativeTargets();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sp_search_terms',
    name: 'SP搜索词',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncSearchTerms(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_search_terms',
    name: 'SB搜索词',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncSbSearchTerms(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sp_placement_performance',
    name: 'SP广告位绩效',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncPlacementPerformance(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_placement_performance',
    name: 'SB广告位绩效',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncSbPlacementPerformance(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sp_auto_targeting',
    name: 'SP自动定向',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncAutoTargeting(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sd_targeting',
    name: 'SD定向报告',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncSdTargeting(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_targeting',
    name: 'SB定向报告',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncSbTargeting(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_ads',
    name: 'SB广告素材',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const result = await service.syncSbAds();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'sb_asset_urls',
    name: 'SB素材URL',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncAssetUrls();
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'performance_14d',
    name: '14天绩效回溯',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncPerformanceData(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'keyword_performance',
    name: '关键词绩效',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncKeywordPerformanceData(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'target_performance',
    name: '定位绩效',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncProductTargetPerformanceData(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
  {
    id: 'ad_group_performance',
    name: '广告组绩效',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        const synced = await service.syncAdGroupPerformanceData(14);
        return { success: true, synced, errors: [] };
      } catch (e: any) {
        return { success: false, synced: 0, errors: [e.message] };
      }
    },
  },
];

// 同步层级包含关系：高层级包含低层级的所有步骤
const TIER_HIERARCHY: Record<SyncTier, SyncTier[]> = {
  high: ['high'],
  medium: ['high', 'medium'],
  full: ['high', 'medium', 'full'],
  confirmation: ['high'], // 确认同步只同步广告活动状态
};

// ==================== 引擎状态 ====================

const engineStatus: EngineStatus = {
  isRunning: false,
  lastSyncTime: { high: null, medium: null, full: null, confirmation: null },
  nextSyncTime: { high: null, medium: null, full: null, confirmation: null },
  totalSyncsCompleted: 0,
  totalSyncsFailed: 0,
  currentlyRunning: [],
  recentErrors: [],
  discoveredAccounts: 0,
};

// 并发控制
const MAX_CONCURRENT_ACCOUNTS = 3;
const activeSyncs = new Map<number, { tier: SyncTier; startTime: Date }>();

// 导出速率控制器供外部使用
export function getRateController(): ApiRateController {
  return rateController;
}

// ==================== 核心功能：自动发现账户 ====================

/**
 * 自动发现所有可同步的账户
 * 直接查询 ad_accounts JOIN amazon_api_credentials，无需依赖 data_sync_schedules
 */
export async function discoverSyncableAccounts(): Promise<SyncableAccount[]> {
  try {
    const database = await db.getDb();
    if (!database) {
      log.error('[UnifiedSync] 数据库不可用，无法发现账户');
      return [];
    }

    const { adAccounts, amazonApiCredentials } = await import('../drizzle/schema');

    // 联表查询：获取所有有API凭证且状态为active的账户
    const results = await database
      .select({
        accountId: adAccounts.id,
        userId: adAccounts.userId,
        accountName: adAccounts.accountName,
        marketplace: adAccounts.marketplace,
        profileId: adAccounts.profileId,
        clientId: amazonApiCredentials.clientId,
        clientSecret: amazonApiCredentials.clientSecret,
        refreshToken: amazonApiCredentials.refreshToken,
        region: amazonApiCredentials.region,
        lastSyncAt: amazonApiCredentials.lastSyncAt,
        syncStatus: amazonApiCredentials.syncStatus,
        accountStatus: adAccounts.status,
      })
      .from(adAccounts)
      .innerJoin(amazonApiCredentials, eq(adAccounts.id, amazonApiCredentials.accountId));

    // 过滤：只保留有效的账户（有clientId, clientSecret, refreshToken, profileId）
    const syncable = results
      .filter(r => {
        // 必须有完整的API凭证
        if (!r.clientId || !r.clientSecret || !r.refreshToken || !r.profileId) {
          return false;
        }
        // 账户状态不能是archived
        if (r.accountStatus === 'archived') {
          return false;
        }
        return true;
      })
      .map(r => ({
        accountId: r.accountId,
        userId: r.userId,
        accountName: r.accountName,
        marketplace: r.marketplace,
        profileId: r.profileId!,
        clientId: r.clientId,
        clientSecret: r.clientSecret,
        refreshToken: r.refreshToken as string,
        region: (r.region as 'NA' | 'EU' | 'FE') || 'NA',
        lastSyncAt: r.lastSyncAt,
        syncStatus: r.syncStatus,
      }));

    engineStatus.discoveredAccounts = syncable.length;
    log.info(`[UnifiedSync] 自动发现 ${syncable.length} 个可同步账户（共 ${results.length} 个账户记录）`);
    
    return syncable;
  } catch (error: any) {
    log.error(`[UnifiedSync] 账户发现失败: ${error.message}`);
    logSyncError('UnifiedSync', '账户发现失败', { error: error.message });
    return [];
  }
}

// ==================== 核心功能：执行分层同步 ====================

/**
 * 获取指定层级需要执行的同步步骤
 */
export function getStepsForTier(tier: SyncTier): SyncStep[] {
  const includedTiers = TIER_HIERARCHY[tier];
  return SYNC_STEPS.filter(step => includedTiers.includes(step.tier));
}

/**
 * 为单个账户执行同步
 */
export async function syncAccount(
  account: SyncableAccount,
  tier: SyncTier,
  options?: {
    specificSteps?: string[];  // 只执行指定步骤（用于确认同步）
    skipSteps?: string[];      // 跳过指定步骤
    onProgress?: (step: string, index: number, total: number) => void;
  }
): Promise<AccountSyncResult> {
  const startTime = new Date();
  const result: AccountSyncResult = {
    accountId: account.accountId,
    accountName: account.accountName,
    tier,
    success: false,
    startTime,
    endTime: startTime,
    durationMs: 0,
    completedSteps: 0,
    failedSteps: 0,
    totalSteps: 0,
    totalSynced: 0,
    errors: [],
    stepResults: {},
  };

  // 并发检查
  if (activeSyncs.has(account.accountId)) {
    const existing = activeSyncs.get(account.accountId)!;
    // 如果已经有同层级或更高层级的同步在运行，跳过
    const runningMinutes = (Date.now() - existing.startTime.getTime()) / 60000;
    if (runningMinutes < 30) { // 30分钟超时保护
      log.info(`[UnifiedSync] 账户 ${account.accountId} 已有${existing.tier}层同步在运行（${runningMinutes.toFixed(1)}分钟），跳过`);
      result.errors.push(`已有${existing.tier}层同步在运行`);
      return result;
    } else {
      log.warn(`[UnifiedSync] 账户 ${account.accountId} 的${existing.tier}层同步已超时（${runningMinutes.toFixed(1)}分钟），强制释放`);
      activeSyncs.delete(account.accountId);
    }
  }

  // 注册活跃同步
  activeSyncs.set(account.accountId, { tier, startTime });
  engineStatus.currentlyRunning.push({ accountId: account.accountId, tier, step: 'initializing' });

  try {
    // 创建同步服务
    const syncService = await AmazonSyncService.createFromCredentials(
      {
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        refreshToken: account.refreshToken,
        profileId: account.profileId,
        region: account.region,
      },
      account.accountId,
      account.userId,
      account.marketplace
    );

    // 确定要执行的步骤
    let steps = getStepsForTier(tier);
    
    if (options?.specificSteps) {
      steps = steps.filter(s => options.specificSteps!.includes(s.id));
    }
    if (options?.skipSteps) {
      steps = steps.filter(s => !options.skipSteps!.includes(s.id));
    }

    result.totalSteps = steps.length;

    // 创建同步上下文
    const context: SyncContext = {
      accountId: account.accountId,
      userId: account.userId,
      tier,
      startTime,
      completedSteps: [],
      failedSteps: [],
      currentStep: null,
      totalSynced: 0,
      totalErrors: 0,
      checkpoint: {},
    };

    // 逐步执行同步
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      context.currentStep = step.id;

      // 更新引擎状态
      const runningEntry = engineStatus.currentlyRunning.find(r => r.accountId === account.accountId);
      if (runningEntry) {
        runningEntry.step = step.name;
      }

      // 进度回调
      if (options?.onProgress) {
        options.onProgress(step.name, i, steps.length);
      }

      log.info(`[UnifiedSync] 账户 ${account.accountId} 执行步骤 [${i + 1}/${steps.length}]: ${step.name}`);

      // v220: 步骤间速率控制延迟
      if (i > 0) {
        const stepDelay = rateController.getStepDelay();
        if (stepDelay > 0) {
          await sleep(stepDelay);
        }
      }

      try {
        // v220: 记录API调用（每个步骤通常包含1-3个API调用）
        rateController.recordApiCall();
        const stepResult = await step.execute(syncService, context);
        result.stepResults[step.id] = stepResult;

        if (stepResult.success) {
          result.completedSteps++;
          context.completedSteps.push(step.id);
          result.totalSynced += stepResult.synced;
          context.totalSynced += stepResult.synced;
        } else {
          result.failedSteps++;
          context.failedSteps.push(step.id);
          context.totalErrors++;
          result.errors.push(`${step.name}: ${stepResult.errors.join(', ')}`);
        }

        // 保存检查点
        context.checkpoint[step.id] = {
          completedAt: new Date().toISOString(),
          success: stepResult.success,
          synced: stepResult.synced,
        };

      } catch (error: any) {
        // 步骤级错误隔离：单步失败不影响后续步骤
        result.failedSteps++;
        context.failedSteps.push(step.id);
        context.totalErrors++;
        result.errors.push(`${step.name}: ${error.message}`);
        result.stepResults[step.id] = { success: false, synced: 0, errors: [error.message] };
        
        // v220: 检测是否为API限流错误
        const isThrottle = error.message?.includes('429') || 
                          error.message?.includes('限流') || 
                          error.message?.includes('TooManyRequests') ||
                          error.message?.includes('throttl');
        if (isThrottle) {
          rateController.recordThrottle();
          // 限流后额外等待
          const throttleDelay = rateController.getStepDelay();
          log.warn(`[UnifiedSync] 账户 ${account.accountId} 步骤 ${step.name} 触发限流，等待${throttleDelay}ms后继续`);
          await sleep(throttleDelay);
        }
        
        log.error(`[UnifiedSync] 账户 ${account.accountId} 步骤 ${step.name} 异常: ${error.message}`);
      }
    }

    // 更新最后同步时间
    try {
      await db.updateAmazonApiCredentials(account.accountId, {
        lastSyncAt: new Date().toISOString(),
        syncStatus: result.failedSteps === 0 ? 'idle' : 'error',
        syncErrorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : null,
      });
    } catch (e: any) {
      log.warn(`[UnifiedSync] 更新账户 ${account.accountId} 同步状态失败: ${e.message}`);
    }

    result.success = result.failedSteps === 0 || result.completedSteps > 0;

  } catch (error: any) {
    result.errors.push(`同步初始化失败: ${error.message}`);
    log.error(`[UnifiedSync] 账户 ${account.accountId} 同步初始化失败: ${error.message}`);
  } finally {
    // 清理
    activeSyncs.delete(account.accountId);
    engineStatus.currentlyRunning = engineStatus.currentlyRunning.filter(
      r => r.accountId !== account.accountId
    );

    result.endTime = new Date();
    result.durationMs = result.endTime.getTime() - result.startTime.getTime();

    // 更新引擎统计
    if (result.success) {
      engineStatus.totalSyncsCompleted++;
    } else {
      engineStatus.totalSyncsFailed++;
    }
  }

  return result;
}

// ==================== 核心功能：批量同步 ====================

/**
 * 对所有发现的账户执行指定层级的同步
 * 支持并发控制：最多同时同步 MAX_CONCURRENT_ACCOUNTS 个账户
 */
export async function syncAllAccounts(tier: SyncTier): Promise<BatchSyncResult> {
  const startTime = new Date();
  const batchResult: BatchSyncResult = {
    tier,
    startTime,
    endTime: startTime,
    durationMs: 0,
    totalAccounts: 0,
    successfulAccounts: 0,
    failedAccounts: 0,
    skippedAccounts: 0,
    accountResults: [],
  };

  log.info(`[UnifiedSync] 开始${tier}层批量同步...`);
  logSync('UnifiedSync', `开始${tier}层批量同步`, { tier });

  // 自动发现所有可同步账户
  const accounts = await discoverSyncableAccounts();
  batchResult.totalAccounts = accounts.length;

  if (accounts.length === 0) {
    log.info('[UnifiedSync] 没有发现可同步的账户');
    batchResult.endTime = new Date();
    batchResult.durationMs = batchResult.endTime.getTime() - startTime.getTime();
    return batchResult;
  }

  log.info(`[UnifiedSync] 发现 ${accounts.length} 个账户，开始并行同步（最大并发: ${MAX_CONCURRENT_ACCOUNTS}）`);

  // 分批并行执行
  for (let i = 0; i < accounts.length; i += MAX_CONCURRENT_ACCOUNTS) {
    const batch = accounts.slice(i, i + MAX_CONCURRENT_ACCOUNTS);
    
    const batchResults = await Promise.all(
      batch.map(account => syncAccount(account, tier))
    );

    for (const accountResult of batchResults) {
      batchResult.accountResults.push(accountResult);
      if (accountResult.success) {
        batchResult.successfulAccounts++;
      } else if (accountResult.errors.some(e => e.includes('已有') && e.includes('在运行'))) {
        batchResult.skippedAccounts++;
      } else {
        batchResult.failedAccounts++;
      }
    }

    // v220: 批次间自适应延迟，根据API限流反馈动态调整
    if (i + MAX_CONCURRENT_ACCOUNTS < accounts.length) {
      const batchDelay = rateController.getBatchDelay();
      log.info(`[UnifiedSync] 批次间延迟 ${batchDelay}ms (利用率: ${rateController.getStatus().utilizationPercent}%)`);
      await sleep(batchDelay);
    }
  }

  // v220: 通知速率控制器同步周期完成，尝试恢复速率
  rateController.onSyncCycleComplete();

  batchResult.endTime = new Date();
  batchResult.durationMs = batchResult.endTime.getTime() - startTime.getTime();
  engineStatus.lastSyncTime[tier] = batchResult.endTime;

  // 记录同步日志
  const totalSynced = batchResult.accountResults.reduce((sum, r) => sum + r.totalSynced, 0);
  log.info(`[UnifiedSync] ${tier}层批量同步完成: ${batchResult.successfulAccounts}/${batchResult.totalAccounts} 成功, ${batchResult.failedAccounts} 失败, ${batchResult.skippedAccounts} 跳过, 总同步 ${totalSynced} 条, 耗时 ${batchResult.durationMs}ms`);
  logSync('UnifiedSync', `${tier}层批量同步完成`, {
    tier,
    total: batchResult.totalAccounts,
    success: batchResult.successfulAccounts,
    failed: batchResult.failedAccounts,
    skipped: batchResult.skippedAccounts,
    totalSynced,
    durationMs: batchResult.durationMs,
  });

  // 记录同步结果到数据库
  await recordBatchSyncResult(batchResult);

  return batchResult;
}

// ==================== 优化后确认同步 ====================

/**
 * 优化后确认同步
 * 当优化命令执行后（暂停/启用广告活动、调整预算/出价），
 * 立即从Amazon回读最新状态，防止下一轮优化基于过期数据做出重复操作
 * 
 * @param accountId 账户ID
 * @param affectedEntities 受影响的实体类型列表
 */
export async function confirmationSync(
  accountId: number,
  affectedEntities: ('campaigns' | 'ad_groups' | 'keywords' | 'targets' | 'budgets')[],
  triggerSource?: string // v220: 触发源标识（如 'optimizationSyncEngine', 'batchUpdateCampaignStatus' 等）
): Promise<AccountSyncResult | null> {
  const source = triggerSource || 'unknown';
  
  // v220: 追踪确认同步触发
  confirmationTracker.totalTriggered++;
  confirmationTracker.lastTriggeredAt = new Date().toISOString();
  confirmationTracker.triggerSources[source] = (confirmationTracker.triggerSources[source] || 0) + 1;
  
  log.info(`[UnifiedSync] v220 触发确认同步: 账户 ${accountId}, 受影响实体: ${affectedEntities.join(', ')}, 触发源: ${source}`);
  logSync('UnifiedSync', 'v220 触发确认同步', { accountId, affectedEntities, triggerSource: source });

  // 发现该账户
  const accounts = await discoverSyncableAccounts();
  const account = accounts.find(a => a.accountId === accountId);

  if (!account) {
    log.warn(`[UnifiedSync] 确认同步: 账户 ${accountId} 不可用或未授权`);
    return null;
  }

  // 根据受影响的实体类型确定需要同步的步骤
  const stepsToSync: string[] = [];
  
  for (const entity of affectedEntities) {
    switch (entity) {
      case 'campaigns':
      case 'budgets':
        stepsToSync.push('sp_campaigns', 'sb_campaigns', 'sd_campaigns');
        break;
      case 'ad_groups':
        stepsToSync.push('sp_ad_groups', 'sb_ad_groups', 'sd_ad_groups');
        break;
      case 'keywords':
        stepsToSync.push('sp_keywords', 'sb_keywords');
        break;
      case 'targets':
        stepsToSync.push('sp_product_targets', 'sb_product_targets', 'sd_product_targets');
        break;
    }
  }

  // 去重
  const uniqueSteps = [...new Set(stepsToSync)];

  // 等待一小段时间让Amazon处理命令（API通常需要几秒钟传播）
  await sleep(3000);

  // 执行确认同步
  const result = await syncAccount(account, 'confirmation', {
    specificSteps: uniqueSteps,
  });

  // v220: 追踪确认同步结果
  confirmationTracker.totalDurationMs += result.durationMs;
  if (result.success) {
    confirmationTracker.totalSucceeded++;
  } else {
    confirmationTracker.totalFailed++;
  }

  log.info(
    `[UnifiedSync] v220 确认同步完成: 账户 ${accountId}, ` +
    `成功 ${result.completedSteps}/${result.totalSteps} 步, 同步 ${result.totalSynced} 条, ` +
    `耗时 ${result.durationMs}ms, 触发源: ${source}, ` +
    `累计: ${confirmationTracker.totalTriggered}次(成功${confirmationTracker.totalSucceeded})`
  );
  logSync('UnifiedSync', 'v220 确认同步完成', {
    accountId,
    completedSteps: result.completedSteps,
    totalSteps: result.totalSteps,
    totalSynced: result.totalSynced,
    durationMs: result.durationMs,
    triggerSource: source,
    cumulativeStats: {
      totalTriggered: confirmationTracker.totalTriggered,
      totalSucceeded: confirmationTracker.totalSucceeded,
      totalFailed: confirmationTracker.totalFailed,
      avgDurationMs: Math.round(confirmationTracker.totalDurationMs / confirmationTracker.totalTriggered),
    },
  });

  return result;
}

// ==================== 辅助功能 ====================

/**
 * 获取引擎状态
 */
export function getEngineStatus(): EngineStatus & { rateControl: RateControlStatus; confirmationSync: typeof confirmationTracker } {
  return {
    ...engineStatus,
    rateControl: rateController.getStatus(),
    confirmationSync: { ...confirmationTracker },
  };
}

/**
 * 获取所有同步步骤信息（用于前端展示）
 */
export function getAllSyncSteps(): { id: string; name: string; tier: SyncTier }[] {
  return SYNC_STEPS.map(s => ({ id: s.id, name: s.name, tier: s.tier }));
}

/**
 * 记录批量同步结果到数据库
 */
async function recordBatchSyncResult(batchResult: BatchSyncResult): Promise<void> {
  try {
    const database = await db.getDb();
    if (!database) return;

    const { dataSyncJobs } = await import('../drizzle/schema');

    for (const accountResult of batchResult.accountResults) {
      if (accountResult.errors.some(e => e.includes('已有') && e.includes('在运行'))) {
        continue; // 跳过被跳过的账户
      }

      try {
        await database.insert(dataSyncJobs).values({
          userId: 1, // 系统自动同步
          accountId: accountResult.accountId,
          syncType: batchResult.tier === 'high' ? 'campaigns' : batchResult.tier === 'medium' ? 'targeting' : 'all',
          status: accountResult.success ? 'completed' : 'failed',
          startedAt: accountResult.startTime.toISOString().slice(0, 19).replace('T', ' '),
          completedAt: accountResult.endTime.toISOString().slice(0, 19).replace('T', ' '),
          durationMs: accountResult.durationMs,
          errorMessage: accountResult.errors.length > 0 ? accountResult.errors.slice(0, 3).join('; ') : null,
          spCampaigns: accountResult.stepResults['sp_campaigns']?.synced || 0,
          sbCampaigns: accountResult.stepResults['sb_campaigns']?.synced || 0,
          sdCampaigns: accountResult.stepResults['sd_campaigns']?.synced || 0,
          adGroupsSynced: (accountResult.stepResults['sp_ad_groups']?.synced || 0) +
            (accountResult.stepResults['sb_ad_groups']?.synced || 0) +
            (accountResult.stepResults['sd_ad_groups']?.synced || 0),
          keywordsSynced: (accountResult.stepResults['sp_keywords']?.synced || 0) +
            (accountResult.stepResults['sb_keywords']?.synced || 0),
          targetsSynced: (accountResult.stepResults['sp_product_targets']?.synced || 0) +
            (accountResult.stepResults['sb_product_targets']?.synced || 0) +
            (accountResult.stepResults['sd_product_targets']?.synced || 0),
          performanceSynced: (accountResult.stepResults['performance_today']?.synced || 0) +
            (accountResult.stepResults['performance_7d']?.synced || 0) +
            (accountResult.stepResults['performance_14d']?.synced || 0),
        });
      } catch (insertErr: any) {
        log.warn(`[UnifiedSync] 记录账户 ${accountResult.accountId} 同步结果失败: ${insertErr.message}`);
      }
    }
  } catch (error: any) {
    log.warn(`[UnifiedSync] 记录批量同步结果失败: ${error.message}`);
  }
}

/**
 * 手动触发单账户完整同步（供前端调用）
 */
export async function triggerManualFullSync(
  accountId: number,
  onProgress?: (step: string, index: number, total: number) => void
): Promise<AccountSyncResult | null> {
  const accounts = await discoverSyncableAccounts();
  const account = accounts.find(a => a.accountId === accountId);

  if (!account) {
    log.warn(`[UnifiedSync] 手动同步: 账户 ${accountId} 不可用`);
    return null;
  }

  return syncAccount(account, 'full', { onProgress });
}

/**
 * 检查账户是否正在同步
 */
export function isAccountSyncing(accountId: number): boolean {
  return activeSyncs.has(accountId);
}

/**
 * 获取账户当前同步状态
 */
export function getAccountSyncStatus(accountId: number): { tier: SyncTier; startTime: Date } | null {
  return activeSyncs.get(accountId) || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 导出 ====================
export { SYNC_STEPS, TIER_HIERARCHY, MAX_CONCURRENT_ACCOUNTS };
