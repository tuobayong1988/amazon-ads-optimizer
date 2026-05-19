// @ts-nocheck
/**
 * @deprecated v361: 此模块已废弃，功能已被AmazonSyncService完全覆盖。
 * 请使用 server/amazonSyncService.ts 作为统一的同步入口。
 * 计划在v362中删除此文件。
 * 
 * Unified Sync Engine v222 - 统一数据同步引擎
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

import * as db from '../db';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { AmazonSyncService } from './amazonSyncService';
import { createModuleLogger } from '../utils/logger';
import { logSync, logSyncWarn, logSyncError } from '../utils/opsLogger';
import { calculateHeapUtilization } from '../services/systemConfigService';
import { saveSyncCheckpoint, loadSyncCheckpoint, clearSyncCheckpoint, buildRecoveryStrategy } from './checkpointManager';
import type { SyncCheckpointData } from './checkpointManager';

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
/** @deprecated v360: 已废弃，统一使用 apiRateLimitService.ts 中的 ApiRateLimitService。保留代码仅为向后兼容，实际限流已由统一服务处理 */
class ApiRateController {
  // 滑动窗口配置
  private windowMs = 60_000; // 1分钟窗口
  private maxCallsPerWindow = 60; // v658: 每分钟最多60次API调用（从120降低，稳定性优先）
  private callTimestamps: number[] = [];
  
  // 自适应速率
  private baseStepDelayMs = 3000; // v658: 步骤间基础延迟3秒（从2秒提升，确保每个API调用有充足时间）
  private currentStepDelayMs = 3000; // v658: 当前步骤间延迟
  private baseBatchDelayMs = 5000; // v658: 批次间基础延迟5秒（从2秒提升）
  private currentBatchDelayMs = 5000; // v658: 当前批次间延迟
  
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
    this.currentStepDelayMs = Math.min(this.baseStepDelayMs * backoffFactor, 15000); // v476: 最多15秒，完全避免429限流
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
      // v393: 使用systemConfigService动态获取堆内存上限，替代硬编码的1400MB
      // 通过v8.getHeapStatistics().heap_size_limit获取真实的--max-old-space-size值
      heapUtilization: calculateHeapUtilization(mem.heapUsed),
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
  
  // @ts-ignore - v652: logSync overload
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

  // v221 内存保护：堆内存超过85%时主动触发GC（如果可用）
  if (snapshot.memoryMB.heapUtilization > 85) {
    log.warn(`[HealthMonitor] 堆内存使用率${snapshot.memoryMB.heapUtilization}%，触发内存保护`);
    if (typeof global.gc === 'function') {
      global.gc();
      log.info('[HealthMonitor] 已手动触发GC');
    }
  }

  // v528: 基于心跳活跃度的智能僵尸清理
  // 核心原则：心跳活跃 = 任务存活，只有心跳停止才是僵尸
  // 两层保护：① 心跳超时(10分钟) ② 绝对超时(6小时安全网)
  const now = new Date();
  let zombiesCleaned = 0;
  for (const [key, sync] of activeSyncs.entries()) {
    const heartbeatAge = now.getTime() - sync.lastHeartbeat.getTime();
    const totalRuntime = now.getTime() - sync.startTime.getTime();
    const absoluteTimeout = Math.min(sync.timeoutMs || MAX_ABSOLUTE_TIMEOUT_MS, MAX_ABSOLUTE_TIMEOUT_MS);
    
    // 判定条件：心跳超时 OR 绝对超时
    const isHeartbeatDead = heartbeatAge > HEARTBEAT_ZOMBIE_TIMEOUT_MS;
    const isAbsoluteTimeout = totalRuntime > absoluteTimeout;
    
    if (isHeartbeatDead || isAbsoluteTimeout) {
      const runningMin = (totalRuntime / 60000).toFixed(1);
      const heartbeatMin = (heartbeatAge / 60000).toFixed(1);
      const reason = isHeartbeatDead 
        ? `心跳超时(${heartbeatMin}分钟无心跳，阈值${Math.round(HEARTBEAT_ZOMBIE_TIMEOUT_MS / 60000)}分钟)` 
        : `绝对超时(运行${runningMin}分钟，上限${Math.round(absoluteTimeout / 60000)}分钟)`;
      log.warn(`[HealthMonitor] v528: 僵尸清理 - ${key} 已运行${runningMin}分钟，原因: ${reason}`);
      activeSyncs.delete(key);
      zombiesCleaned++;
    }
  }
  // 同步清理currentlyRunning中对应的僵尸条目
  if (zombiesCleaned > 0) {
    engineStatus.currentlyRunning = engineStatus.currentlyRunning.filter(r => {
      const key = `${r.accountId}:${r.tier}`;
      return activeSyncs.has(key);
    });
    log.warn(`[HealthMonitor] v528: 已清理 ${zombiesCleaned} 个僵尸同步条目`);
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
export type SyncTier = 'high' | 'medium' | 'full' | 'nightly' | 'confirmation';

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
  parallelGroup?: string; // v682: 同一parallelGroup的步骤可以并行执行，大幅减少报告等待时间
  deferrable?: boolean; // v757: 可延迟执行的步骤，不阻塞主同步流程，在其他步骤完成后异步执行
  execute: (service: AmazonSyncService, context: SyncContext) => Promise<StepResult>;
}

/** 步骤执行结果 */
export interface StepResult {
  success: boolean;
  synced: number;
  errors: string[];
  details?: Record<string, unknown>;
}

// v689: 同步失败精细化分类 — 区分API限流/Token过期/网络超时/权限拒绝/服务端错误/未知错误
type SyncFailureCategory = 'api_throttle' | 'token_expired' | 'network_timeout' | 'permission_denied' | 'server_error' | 'unknown';

const FAILURE_CATEGORY_LABELS: Record<SyncFailureCategory, string> = {
  api_throttle: 'Amazon API限流(429)',
  token_expired: 'Token过期/凭证失效',
  network_timeout: '网络超时/连接中断',
  permission_denied: '权限拒绝(403)',
  server_error: 'Amazon服务端错误(5xx)',
  unknown: '未知错误',
};

function classifySyncFailure(errMsg: string): SyncFailureCategory {
  const msg = errMsg.toLowerCase();
  // API限流
  if (msg.includes('429') || msg.includes('toomanyrequests') || msg.includes('throttl') || msg.includes('限流') || msg.includes('rate limit')) {
    return 'api_throttle';
  }
  // Token过期
  if (msg.includes('refresh token') || msg.includes('invalid_grant') || msg.includes('重新授权') || msg.includes('token刷新失败') || msg.includes('token刷新认证失败') || msg.includes('401') || msg.includes('unauthorized')) {
    return 'token_expired';
  }
  // 网络超时
  if (msg.includes('etimedout') || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('socket hang up') || msg.includes('timeout') || msg.includes('network')) {
    return 'network_timeout';
  }
  // 权限拒绝
  if (msg.includes('403') || msg.includes('forbidden') || msg.includes('permission') || msg.includes('not authorized')) {
    return 'permission_denied';
  }
  // 服务端错误
  if (msg.includes('502') || msg.includes('503') || msg.includes('504') || msg.includes('500') || msg.includes('internal server error') || msg.includes('bad gateway') || msg.includes('service unavailable')) {
    return 'server_error';
  }
  return 'unknown';
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
  checkpoint: Record<string, unknown>;
  /** v473: Profile广告类型能力检测 — 记录该Profile支持的广告类型 */
  adTypeCapabilities: {
    sb: boolean | null; // null=未检测, true=支持, false=不支持(403)
    sd: boolean | null;
  };
  /** v663: 大账户增量同步模式 — >200广告活动的账户自动启用，缩短报告天数范围 */
  incrementalMode: boolean;
  /** v663: 增量模式下的报告天数上限（SP/SD默认14天，SB默认7天） */
  incrementalReportDays: { sp: number; sb: number; sd: number };
  /** v686: 长耗时步骤子进度回调 — 用于报告步骤内部的细粒度进展 */
  onSubProgress?: (subProgress: { phase: string; current: number; total: number; detail?: string }) => void;
}

/** 账户同步结果 */
export interface AccountSyncResult {
  accountId: number;
  userId: number; // v336: 添加userId用于recordBatchSyncResult
  accountName: string;
  tier: SyncTier;
  success: boolean;
  /** v641: 部分成功标记 — 超时或中断导致部分步骤被跳过时为true */
  partialSuccess: boolean;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  completedSteps: number;
  failedSteps: number;
  /** v641: 因超时/中断被跳过的步骤数 */
  skippedSteps: number;
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
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSpCampaigns();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_campaigns',
    name: 'SB广告活动',
    tier: 'high',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSbCampaigns();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sd_campaigns',
    name: 'SD广告活动',
    tier: 'high',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSdCampaigns();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'performance_today',
    name: '当日绩效',
    tier: 'high',
    execute: async (service, ctx) => {
      try {
        // v688: 注入子进度回调，使当日绩效步骤也能推送细粒度进度
        ctx.onSubProgress?.({ phase: '提交报告', current: 0, total: 3, detail: '准备提交1天绩效报告' });
        (service as any)._subProgressCallback = ctx.onSubProgress;
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncPerformanceOnly(1);
        (service as any)._subProgressCallback = undefined;
        // v221: syncPerformanceOnly返回对象{performance, keywordPerf, targetPerf}，需要求和
        const synced = typeof result === 'number' ? result : 
          (result.performance || 0) + (result.keywordPerf || 0) + (result.targetPerf || 0);
        ctx.onSubProgress?.({ phase: '完成', current: 3, total: 3, detail: `入库${synced}条` });
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        (service as any)._subProgressCallback = undefined; // v688: 确保异常时也清理回调
        return { success: false, synced: 0, errors: [(e as Error).message] };
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
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSpAdGroups();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_ad_groups',
    name: 'SB广告组',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSbAdGroups();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sd_ad_groups',
    name: 'SD广告组',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSdAdGroups();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sp_keywords',
    name: 'SP关键词',
    tier: 'medium',
    deferrable: true, // v757: SP关键词同步拆分为异步任务，不阻塞其他步骤
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSpKeywords();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_keywords',
    name: 'SB关键词',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSbKeywords();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sp_product_targets',
    name: 'SP商品定位',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSpProductTargets();
        const synced = typeof result === 'number' ? result : result.synced;
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_product_targets',
    name: 'SB商品定位',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSbProductTargets();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sd_product_targets',
    name: 'SD商品定位',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSdProductTargets();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'performance_7d',
    name: '7天绩效回溯',
    tier: 'medium',
    execute: async (service, ctx) => {
      try {
        // v688: 注入子进度回调，使7天绩效回溯步骤也能推送细粒度进度
        ctx.onSubProgress?.({ phase: '提交报告', current: 0, total: 3, detail: '准备提交7天绩效报告' });
        (service as any)._subProgressCallback = ctx.onSubProgress;
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncPerformanceOnly(7);
        (service as any)._subProgressCallback = undefined;
        // v221: syncPerformanceOnly返回对象，需要求和
        const synced = typeof result === 'number' ? result :
          (result.performance || 0) + (result.keywordPerf || 0) + (result.targetPerf || 0);
        ctx.onSubProgress?.({ phase: '完成', current: 3, total: 3, detail: `入库${synced}条` });
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        (service as any)._subProgressCallback = undefined; // v688: 确保异常时也清理回调
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },

  // === 完整同步步骤（每60分钟） ===
  {
    id: 'sp_negative_keywords',
    name: 'SP否定关键词',
    tier: 'high',  // v256: 从 medium 提升到 high，确保否定关键词及时同步（30min→10min）
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSpNegativeKeywords();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_negative_keywords',
    name: 'SB否定关键词',
    tier: 'high',  // v256: 从 medium 提升到 high
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSbNegativeKeywords();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sp_negative_targets',
    name: 'SP否定商品定位',
    tier: 'high',  // v256: 从 medium 提升到 high
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSpNegativeProductTargets();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_negative_targets',
    name: 'SB否定商品定位',
    tier: 'high',  // v256: 从 medium 提升到 high
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSbNegativeTargets();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sd_negative_targets',
    name: 'SD否定商品定位',
    tier: 'high',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSdNegativeTargets();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sp_search_terms',
    name: 'SP搜索词',
    tier: 'full',
    parallelGroup: 'search_terms', // v682: SP/SB搜索词并行执行
    execute: async (service, ctx) => {
      try {
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sp : 95; // v663: 增量模式缩短天数
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncSearchTerms(days); // v376: SP搜索词扩展到95天（SP API最大支持范围）
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_search_terms',
    name: 'SB搜索词',
    tier: 'full',
    parallelGroup: 'search_terms', // v682: SP/SB搜索词并行执行
    execute: async (service, ctx) => {
      try {
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sb : 60; // v663: 增量模式缩短天数
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncSbSearchTerms(days); // v337.2: SB搜索词扩展到60天（SB最奇60天）
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sp_placement_performance',
    name: 'SP广告位绩效',
    tier: 'full',
    parallelGroup: 'placement_perf', // v682: SP/SB广告位绩效并行执行
    execute: async (service, ctx) => {
      try {
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sp : 95; // v663: 增量模式缩短天数
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncPlacementPerformance(days); // v376: SP广告位绩效扩展到95天（SP API最大支持范围）
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_placement_performance',
    name: 'SB广告位绩效',
    tier: 'full',
    parallelGroup: 'placement_perf', // v682: SP/SB广告位绩效并行执行
    execute: async (service, ctx) => {
      try {
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sb : 60; // v663: 增量模式缩短天数
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncSbPlacementPerformance(days); // v337.2: SB广告位绩效扩展到60天
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sp_auto_targeting',
    name: 'SP自动定向',
    tier: 'full',
    parallelGroup: 'targeting_reports', // v682: SP/SD/SB定向报告并行执行
    execute: async (service, ctx) => {
      try {
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sp : 95; // v663: 增量模式缩短天数
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncAutoTargeting(days); // v376: SP自动定向扩展到95天（SP API最大支持范围）
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sd_targeting',
    name: 'SD定向报告',
    tier: 'full',
    parallelGroup: 'targeting_reports', // v682: SP/SD/SB定向报告并行执行
    execute: async (service, ctx) => {
      try {
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sd : 95; // v663: 增量模式缩短天数
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncSdTargeting(days); // v376: SD定向扩展到95天
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_targeting',
    name: 'SB定向报告',
    tier: 'full',
    parallelGroup: 'targeting_reports', // v682: SP/SD/SB定向报告并行执行
    execute: async (service, ctx) => {
      try {
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sb : 60; // v663: 增量模式缩短天数
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncSbTargeting(days); // v337.2: SB定向扩展到60天（SB最奇60天）
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_ads',
    name: 'SB广告素材',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSbAds();
        return { success: true, synced: result.synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_asset_urls',
    name: 'SB素材URL',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncAssetUrls();
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sp_bid_recommendations',
    name: 'SP建议竞价',
    tier: 'medium', // v521: 从full降级到medium层，允许建议竞价独立于报告下载步骤运行
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSpBidRecommendations();
        const synced = typeof result === 'number' ? result : (result as Record<string, unknown>).synced || 0;
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sb_bid_recommendations',
    name: 'SB建议竞价',
    tier: 'medium', // v521: 从full降级到medium层，解决全量同步阻塞导致SB建议竞价无法写入的问题
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSbBidRecommendations();
        const synced = typeof result === 'number' ? result : (result as Record<string, unknown>).synced || 0;
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sd_bid_recommendations',
    name: 'SD建议竞价',
    tier: 'medium', // v521: 从full降级到medium层，解决全量同步阻塞导致SD建议竞价无法写入的问题
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSdBidRecommendations();
        const synced = typeof result === 'number' ? result : (result as Record<string, unknown>).synced || 0;
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  // v519: SD受众定向建议竞价
  {
    id: 'sd_audience_bid_recommendations',
    name: 'SD受众建议竞价',
    tier: 'medium', // v521: 从full降级到medium层
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const result = await service.syncSdAudienceBidRecommendations();
        const synced = typeof result === 'number' ? result : (result as Record<string, unknown>).synced || 0;
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'sp_budget_rules',
    name: 'SP预算规则',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncSpBudgetRules();
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'performance_95d',
    name: '95天绩效回溯',
    tier: 'full',
    execute: async (service, ctx) => {
      try {
        // v679: 新账户渐进式初始化检测
        const { needsProgressiveInit, createInitProgress, executeProgressiveInit, loadInitProgress, saveInitProgress } = await import('./progressiveInitSync');
        const needsInit = await needsProgressiveInit(ctx.accountId);
        
        if (needsInit) {
          log.info(`[v679] 账户${ctx.accountId}需要渐进式初始化同步`);
          ctx.onSubProgress?.({ phase: '渐进式初始化', current: 0, total: 1, detail: '加载进度' });
          let progress = await loadInitProgress(ctx.accountId);
          if (!progress || progress.overallStatus === 'completed') {
            progress = createInitProgress(ctx.accountId);
          }
          
          ctx.onSubProgress?.({ phase: '渐进式初始化', current: 0, total: 1, detail: '执行中...' });
          progress = await executeProgressiveInit(service, progress);
          await saveInitProgress(progress);
          
          const totalSynced = Object.values(progress.phases)
            .reduce((sum, p) => sum + (p.recordsSynced || 0), 0);
          ctx.onSubProgress?.({ phase: '渐进式初始化', current: 1, total: 1, detail: `完成: ${totalSynced}条` });
          log.info(`[v679] 渐进式初始化完成: 状态=${progress.overallStatus}, 总同步=${totalSynced}条`);
          return { success: progress.overallStatus !== 'pending', synced: totalSynced, errors: [] };
        }
        
        // v686: 非新账户，使用分层时间窗口+跨批并行模式，注入子进度回调
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sp : 95;
        ctx.onSubProgress?.({ phase: '提交报告', current: 0, total: 3, detail: `准备提交${days}天绩效报告` });
        // v686: 将子进度回调传递给syncPerformanceData
        (service as any)._subProgressCallback = ctx.onSubProgress;
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncPerformanceData(days);
        (service as any)._subProgressCallback = undefined;
        ctx.onSubProgress?.({ phase: '完成', current: 3, total: 3, detail: `入库${synced}条` });
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'keyword_performance',
    name: '关键词绩效',
    tier: 'nightly',
    parallelGroup: 'nightly_perf', // v682: 关键词/定位/广告组绩效并行执行 // v403: 从 full 迁移到 nightly，避免 full 层级超时
    execute: async (service, ctx) => {
      try {
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sp : 95; // v663: 增量模式缩短天数
        ctx.onSubProgress?.({ phase: '请求报告', current: 0, total: 3, detail: `准备请求${days}天关键词绩效报告` });
        (service as any)._subProgressCallback = ctx.onSubProgress;
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncKeywordPerformanceData(days); // v376: 关键词绩效扩展到95天（SP API最大支持范围）
        (service as any)._subProgressCallback = undefined;
        ctx.onSubProgress?.({ phase: '完成', current: 3, total: 3, detail: `入库${synced}条` });
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'target_performance',
    name: '定位绩效',
    tier: 'nightly',
    parallelGroup: 'nightly_perf', // v682: 关键词/定位/广告组绩效并行执行 // v403: 从 full 迁移到 nightly，避免 full 层级超时
    execute: async (service, ctx) => {
      try {
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sp : 95; // v663: 增量模式缩短天数
        ctx.onSubProgress?.({ phase: '同步定位绩效', current: 0, total: 1, detail: `${days}天定位绩效数据` });
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncProductTargetPerformanceData(days); // v376: 定位绩效扩展到95天（SP API最大支持范围）
        ctx.onSubProgress?.({ phase: '完成', current: 1, total: 1, detail: `入库${synced}条` });
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
  {
    id: 'ad_group_performance',
    name: '广告组绩效',
    tier: 'nightly',
    parallelGroup: 'nightly_perf', // v682: 关键词/定位/广告组绩效并行执行 // v403: 从 full 迁移到 nightly，避免 full 层级超时
    execute: async (service, ctx) => {
      try {
        const days = ctx.incrementalMode ? ctx.incrementalReportDays.sp : 95; // v663: 增量模式缩短天数
        ctx.onSubProgress?.({ phase: '提交报告', current: 0, total: 3, detail: `准备提交${days}天广告组绩效报告` });
        (service as any)._subProgressCallback = ctx.onSubProgress;
        // @ts-ignore - v652: prototype mixin method
        const synced = await service.syncAdGroupPerformanceData(days); // v376: 广告组绩效扩展到95天（SP API最大支持范围）
        (service as any)._subProgressCallback = undefined;
        ctx.onSubProgress?.({ phase: '完成', current: 3, total: 3, detail: `入库${synced}条` });
        return { success: true, synced, errors: [] };
      } catch (e: unknown) {
        return { success: false, synced: 0, errors: [(e as Error).message] };
      }
    },
  },
];

// v221: 同步层级步骤映射
// 修复BUG: 之前medium层包含high层步骤，导致high层锁阻塞medium层
// 现在每层只执行自己专有的步骤，因为各层有独立的定时器
// full层仍然包含所有步骤（用于完整同步和首次同步）
const TIER_HIERARCHY: Record<SyncTier, SyncTier[]> = {
  high: ['high'],                    // 高频：只执行high专有步骤
  medium: ['medium'],                // 中频：只执行medium专有步骤（不再重复high层）
  full: ['high', 'medium', 'full'],  // 完整：执行所有层级步骤
  nightly: ['nightly'],              // v403: 夜间层级：耗时最长的绩效报表（关键词/定位/广告组绩效）
  confirmation: ['high', 'medium'],   // v380: 确认同步覆盖high+medium层，确保ad_groups/keywords/targets变更能被确认
};

// ==================== 引擎状态 ====================

const engineStatus: EngineStatus = {
  isRunning: false,
  lastSyncTime: { high: null, medium: null, full: null, nightly: null, confirmation: null },
  nextSyncTime: { high: null, medium: null, full: null, nightly: null, confirmation: null },
  totalSyncsCompleted: 0,
  totalSyncsFailed: 0,
  currentlyRunning: [],
  recentErrors: [],
  discoveredAccounts: 0,
};

// v399: 并发控制 - 默认从10→15，500租户场景下提升同步吞吐量
const MAX_CONCURRENT_ACCOUNTS = parseInt(process.env.MAX_CONCURRENT_ACCOUNTS || '15', 10);
const activeSyncs = new Map<string, {
  tier: SyncTier;
  startTime: Date;
  lastHeartbeat: Date;       // v528: 最后心跳时间（每次onProgress/心跳定时器更新）
  timeoutMs: number;         // 绝对超时（安全网，防止无限运行）
}>();

// v665: 活跃同步上下文引用 — 用于SIGTERM时主动保存所有活跃同步的checkpoint
const activeSyncContexts = new Map<string, {
  accountId: number;
  tier: string;
  context: { completedSteps: string[]; totalSynced: number; checkpoint: Record<string, unknown> };
  startTime: Date;
}>();

/**
 * v665: 导出函数 — SIGTERM时主动保存所有活跃同步的checkpoint
 * 由deployLifecycleManager在persistShutdownState中调用
 */
export async function saveAllActiveCheckpoints(): Promise<number> {
  let saved = 0;
  for (const [key, entry] of activeSyncContexts.entries()) {
    try {
      const checkpointData: SyncCheckpointData = {
        completedSteps: [...entry.context.completedSteps],
        interruptReason: 'shutdown',
        totalSynced: entry.context.totalSynced,
        elapsedMs: Date.now() - entry.startTime.getTime(),
        stepCheckpoints: Object.fromEntries(
          entry.context.completedSteps.map(sid => [sid, { status: 'completed', synced: (entry.context.checkpoint[sid] as { synced?: number })?.synced || 0 }])
        ),
        recordCheckpoints: {},
        savedAt: new Date().toISOString(),
      };
      await saveSyncCheckpoint(entry.accountId, entry.tier, checkpointData);
      saved++;
      log.info(`[v665] SIGTERM checkpoint已保存: 账户${entry.accountId} ${entry.tier}层, 已完成${entry.context.completedSteps.length}步`);
    } catch (err: unknown) {
      log.warn(`[v665] SIGTERM checkpoint保存失败: 账户${entry.accountId} ${entry.tier}层: ${(err as Error).message}`);
    }
  }
  return saved;
}

// v653: 空账户诊断去重缓存 — 连续相同诊断结果的账户不再重复输出warn日志
// 解决v652验证报告4.1：日志缓冲区使用率从84%升至100%的问题
const emptyAccountDiagCache = new Map<number, { diagnosisType: string; count: number; firstSeen: Date; backoffLevel: number; lastSyncAttempt: Date }>();
const DIAG_DEDUP_LOG_INTERVAL = 10;  // 每10次相同诊断才输出一次汇总日志

// v743: 启动时从数据库恢复空账户退避状态，解决部署重启后内存缓存丢失的问题
// 核心问题：emptyAccountDiagCache 是内存 Map，每次 EB 部署重启后清空，
// 空账户需要重新积累 3 次 TRULY_EMPTY 诊断才能触发退避，
// 在 high 层 30 分钟频率下需要 90 分钟才能重新建立退避状态
async function restoreEmptyAccountBackoffState(): Promise<void> {
  try {
    const database = await db.getDb();
    if (!database) return;
    
    // 查询所有活跃账户的广告活动数量
    const accountCampaignCounts = await database.execute(
      sql`SELECT a.id as accountId, COUNT(c.id) as campaignCount,
             a.emptyAccountBackoff as backoffJson
           FROM ad_accounts a
           LEFT JOIN campaigns c ON c.accountId = a.id
           WHERE a.status = 'active'
           GROUP BY a.id`
    );
    // @ts-ignore - drizzle result
    const rows = Array.isArray(accountCampaignCounts) ? accountCampaignCounts[0] : (accountCampaignCounts?.rows || accountCampaignCounts);
    // @ts-ignore - drizzle result
    if (!rows || !Array.isArray(rows)) return;
    
    let restoredFromDb = 0;
    let prefilledFromCampaigns = 0;
    
    for (const row of rows as any[]) {
      const accountId = row.accountId;
      const campaignCount = Number(row.campaignCount || 0);
      
      // 尝试从 DB JSON 字段恢复
      if (row.backoffJson) {
        try {
          const saved = JSON.parse(row.backoffJson);
          if (saved.diagnosisType === 'TRULY_EMPTY') {
            emptyAccountDiagCache.set(accountId, {
              diagnosisType: saved.diagnosisType,
              count: saved.count || 3,
              firstSeen: new Date(saved.firstSeen || Date.now() - 86400000),
              backoffLevel: Math.max(saved.backoffLevel || 0, 1), // v743-fix2: at least level 1
              lastSyncAttempt: new Date(saved.lastSyncAttempt || Date.now() - 86400000),
            });
            restoredFromDb++;
            continue;
          }
        } catch { /* JSON解析失败，回退到广告活动数检测 */ }
      }
      
      // 对 campaigns 表中 COUNT=0 的账户，直接预填充缓存
      if (campaignCount === 0) {
        emptyAccountDiagCache.set(accountId, {
          diagnosisType: 'TRULY_EMPTY',
          count: 3, // 预设为最小触发次数，立即生效
          firstSeen: new Date(Date.now() - 24 * 60 * 60 * 1000), // 假设24小时前开始
          backoffLevel: 1, // 从第1级开始（冷却期12h），而不是0级（6h）
          lastSyncAttempt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 假设6小时前同步过
        });
        prefilledFromCampaigns++;
      }
    }
    
    if (restoredFromDb > 0 || prefilledFromCampaigns > 0) {
      log.info(`[UnifiedSync] v743: 空账户退避状态恢复完成 — 从DB恢复=${restoredFromDb}, 从广告活动数预填充=${prefilledFromCampaigns}, 总计=${emptyAccountDiagCache.size}个空账户已启用退避`);
    }
  } catch (err: unknown) {
    log.warn(`[UnifiedSync] v743: 空账户退避状态恢复失败: ${(err as Error).message}`);
  }
}

// v743: 将空账户退避状态持久化到数据库
async function persistEmptyAccountBackoffState(accountId: number): Promise<void> {
  try {
    const diag = emptyAccountDiagCache.get(accountId);
    if (!diag) return;
    
    const database = await db.getDb();
    if (!database) return;
    
    const backoffJson = JSON.stringify({
      diagnosisType: diag.diagnosisType,
      count: diag.count,
      firstSeen: diag.firstSeen.toISOString(),
      backoffLevel: diag.backoffLevel,
      lastSyncAttempt: diag.lastSyncAttempt.toISOString(),
    });
    
    await database.execute(
      sql`UPDATE ad_accounts SET emptyAccountBackoff = ${backoffJson} WHERE id = ${accountId}`
    );
  } catch (err: unknown) {
    // 持久化失败不影响同步继续
    log.debug(`[UnifiedSync] v743: 空账户退避状态持久化失败(${accountId}): ${(err as Error).message}`);
  }
}

// v743: 启动时调用恢复函数
restoreEmptyAccountBackoffState().catch(err => {
  log.warn(`[UnifiedSync] v743: 启动时恢复空账户退避状态失败: ${(err as Error).message}`);
});

/**
 * v657: 获取空账户监控统计数据
 * 用于 /api/ops/status 端点展示空账户预检机制的效果
 */
/**
 * v665: 导出当前进程中活跃同步的账户ID列表
 * 用于cleanupStaleJobs交叉验证：DB中running但不在当前进程的activeSyncs中的任务是僵尸任务
 */
export function getActiveSyncAccountIds(): Set<number> {
  const ids = new Set<number>();
  for (const [key] of activeSyncs.entries()) {
    const accountId = parseInt(key.split(':')[0], 10);
    if (!isNaN(accountId)) ids.add(accountId);
  }
  return ids;
}

export function getEmptyAccountStats(): {
  totalEmpty: number;
  accounts: Array<{ accountId: number; diagnosisType: string; count: number; firstSeen: string; ageMins: number; backoffLevel: number; nextSyncInHours: number }>;
  apiRequestsSaved: number;
} {
  const accounts: Array<{ accountId: number; diagnosisType: string; count: number; firstSeen: string; ageMins: number; backoffLevel: number; nextSyncInHours: number }> = [];
  let totalSkippedCycles = 0;
  const now = Date.now();
  
  for (const [accountId, diag] of emptyAccountDiagCache.entries()) {
    const ageMins = Math.round((now - diag.firstSeen.getTime()) / 60000);
    // v741: 计算下次同步时间
    const backoffLevel = diag.backoffLevel || 0;
    const baseCooldownHours = 6; // 默认值，与 systemConfigService 一致
    const effectiveCooldownMs = Math.min(baseCooldownHours * Math.pow(2, backoffLevel), 168) * 60 * 60 * 1000;
    const timeSinceLastSync = now - diag.lastSyncAttempt.getTime();
    const nextSyncInHours = Math.max(0, (effectiveCooldownMs - timeSinceLastSync) / (1000 * 60 * 60));
    accounts.push({
      accountId,
      diagnosisType: diag.diagnosisType,
      count: diag.count,
      firstSeen: diag.firstSeen.toISOString(),
      ageMins,
      backoffLevel,
      nextSyncInHours: Math.round(nextSyncInHours * 10) / 10,
    });
    totalSkippedCycles += diag.count;
  }
  
  // 每个跳过的同步周期约节省5-8个API请求（绩效报告、搜索词、建议竞价等）
  const apiRequestsSaved = totalSkippedCycles * 6;
  
  return {
    totalEmpty: emptyAccountDiagCache.size,
    accounts: accounts.sort((a, b) => b.count - a.count),
    apiRequestsSaved,
  };
}

// v652: 并发排队机制 — 当检测到同层级/full层同步在运行时，不再直接拒绝，而是等待锁释放后重试
// 解决v651验证报告R-5：22个账户因并发保护被直接拒绝的问题
const QUEUE_POLL_INTERVAL_MS = 30_000;  // 每30秒检查一次锁状态
const QUEUE_MAX_WAIT_MS = 15 * 60_000;  // 最多等待15分钟

/** v652: 等待指定账户的同步锁释放 */
async function waitForSyncSlot(accountId: number, tier: string, blockingTier: string): Promise<boolean> {
  const waitStart = Date.now();
  log.info(`[UnifiedSync] v652: 账户 ${accountId} ${tier}层进入排队等待（被${blockingTier}层阻塞），最多等待${QUEUE_MAX_WAIT_MS / 60000}分钟`);
  
  while (Date.now() - waitStart < QUEUE_MAX_WAIT_MS) {
    // 检查阻塞锁是否已释放
    const accountLocks = Array.from(activeSyncs.entries())
      .filter(([key]) => key.startsWith(`${accountId}:`));
    
    const stillBlocked = accountLocks.some(([existingKey, existing]) => {
      const existingTier = existingKey.split(':')[1];
      const runningMinutes = (Date.now() - existing.startTime.getTime()) / 60000;
      const existingTimeoutMin = (existing.timeoutMs || DEFAULT_SYNC_TIMEOUT_MS) / 60000;
      // 已超时的锁不算阻塞
      if (runningMinutes >= existingTimeoutMin) return false;
      // 检查阻塞条件是否仍然存在
      if (existingTier === tier) return true;  // 同层级仍在运行
      if (existingTier === 'full' && tier !== 'confirmation') return true;  // full层仍在运行
      if (existingTier === 'medium' && tier === 'high') return true;  // medium阻塞high
      if (tier === 'full' && existingTier !== 'full') return true;  // full等待其他层
      return false;
    });
    
    if (!stillBlocked) {
      const waitedSec = ((Date.now() - waitStart) / 1000).toFixed(1);
      log.info(`[UnifiedSync] v652: 账户 ${accountId} ${tier}层排队等待完成（等待了${waitedSec}秒），开始执行`);
      return true;  // 锁已释放，可以执行
    }
    
    await new Promise(resolve => setTimeout(resolve, QUEUE_POLL_INTERVAL_MS));
  }
  
  const waitedMin = ((Date.now() - waitStart) / 60000).toFixed(1);
  log.warn(`[UnifiedSync] v652: 账户 ${accountId} ${tier}层排队等待超时（${waitedMin}分钟），将在下一轮重试`);
  return false;  // 等待超时
}

// v528: 心跳超时 — 僵尸判定的主要依据
// 如果一个任务超过此时间没有心跳更新，才判定为僵尸
// 心跳每1分钟发送一次（v521），所以10分钟无心跳说明任务确实卡死
const HEARTBEAT_ZOMBIE_TIMEOUT_MS = 120 * 60 * 1000; // v677: 120分钟无心跳 = 僵尸（从30分钟延长，匹配步骤超时最长120分钟 — v676实测90023的performance_95d需要60-90分钟）

// v528: 绝对超时（安全网） — 即使心跳正常，也不允许无限运行
// 这是防止心跳正常但任务实际卡在无限循环中的极端情况
const MAX_ABSOLUTE_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6小时绝对上限

// v528: 动态超时常量（仅用于绝对超时安全网，不再是僵尸判定的主要依据）
const DEFAULT_SYNC_TIMEOUT_MS = 180 * 60 * 1000; // v663: 默认180分钟（从120分钟延长，v662实测90084/90052超时失败）
// v663: 超时分层同步上调，确保大账户有足够时间完成全量同步
const LARGE_ACCOUNT_TIMEOUT_TIERS = [
  { threshold: 5000, timeoutMs: 240 * 60 * 1000 },  // 5000+广告活动: 4小时（从3小时延长）
  { threshold: 3000, timeoutMs: 210 * 60 * 1000 },  // 3000-5000: 3.5小时（从2.5小时延长）
  { threshold: 1000, timeoutMs: 180 * 60 * 1000 },  // 1000-3000: 3小时（从2小时延长）
  { threshold: 500, timeoutMs: 150 * 60 * 1000 },   // 500-1000: 2.5小时（从1.5小时延长）
  { threshold: 100, timeoutMs: 120 * 60 * 1000 },   // 100-500: 2小时（从1.25小时延长）
];
const NIGHTLY_SYNC_TIMEOUT_MS = 4 * 60 * 60 * 1000; // nightly层级: 4小时

// v663: 大账户增量同步策略常量
const INCREMENTAL_SYNC_CAMPAIGN_THRESHOLD = 200; // 超过200个广告活动的账户启用增量同步
const INCREMENTAL_REPORT_DAYS = { sp: 14, sb: 7, sd: 14 }; // 增量模式下的报告天数上限
const FULL_REPORT_DAYS = { sp: 95, sb: 60, sd: 95 }; // 全量模式下的报告天数（原始值）

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
      log.warn('[UnifiedSync] 数据库不可用，无法发现账户');
      return [];
    }

    const { adAccounts, amazonApiCredentials } = await import('../../drizzle/schema');

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

    // v348: 解密凭证 - discoverSyncableAccounts直接JOIN查询绕过了getAmazonApiCredential的safeDecrypt
    // V345加密凭证后，必须在此处解密，否则Token刷新会使用加密格式的凭证导致401
    const { safeDecrypt } = await import('../utils/cryptoService');

    // 过滤：只保留有效的账户（有clientId, clientSecret, refreshToken, profileId）
    // v652: R-1修复 — 添加详细的凭证缺失诊断日志
    const skippedReasons: { accountId: number; accountName: string; reason: string }[] = [];
    const syncable = results
      .filter(r => {
        // 必须有完整的API凭证
        if (!r.clientId || !r.clientSecret || !r.refreshToken || !r.profileId) {
          const missing: string[] = [];
          if (!r.clientId) missing.push('clientId');
          if (!r.clientSecret) missing.push('clientSecret');
          if (!r.refreshToken) missing.push('refreshToken');
          if (!r.profileId) missing.push('profileId');
          skippedReasons.push({
            accountId: r.accountId,
            accountName: r.accountName || `未命名账户#${r.accountId}`,
            reason: `凭证不完整: 缺少${missing.join(', ')}`,
          });
          return false;
        }
        // 账户状态不能是archived或paused
        if (r.accountStatus === 'archived' || r.accountStatus === 'paused') {
          skippedReasons.push({
            accountId: r.accountId,
            accountName: r.accountName || `未命名账户#${r.accountId}`,
            reason: `账户状态: ${r.accountStatus}`,
          });
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
        clientSecret: safeDecrypt(r.clientSecret),
        refreshToken: safeDecrypt(r.refreshToken as string),
        region: (r.region as 'NA' | 'EU' | 'FE') || 'NA',
        lastSyncAt: r.lastSyncAt,
        syncStatus: r.syncStatus,
      }));

    engineStatus.discoveredAccounts = syncable.length;
    log.info(`[UnifiedSync] 自动发现 ${syncable.length} 个可同步账户（共 ${results.length} 个账户记录，${skippedReasons.length} 个被跳过）`);
    
    // v652: R-1 详细记录被跳过的账户及原因，便于诊断凭证问题
    if (skippedReasons.length > 0) {
      for (const skip of skippedReasons) {
        log.warn(`[UnifiedSync] v652: 账户 ${skip.accountId}(${skip.accountName}) 被跳过 - ${skip.reason}`);
      }
      logSyncWarn('UnifiedSync', `v652: ${skippedReasons.length}个账户因凭证/状态问题被跳过`, {
        skippedCount: skippedReasons.length,
        details: skippedReasons.map(s => `${s.accountId}:${s.reason}`).join('; '),
      });
    }
    
    return syncable;
  } catch (error: unknown) {
    log.warn(`[UnifiedSync] 账户发现失败: ${(error as Error).message}`);
    logSyncError('UnifiedSync', '账户发现失败', { error: (error as Error).message });
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
    onProgress?: (step: string, index: number, total: number) => void | Promise<void>;
    /** v775: 仅在步骤成功完成并已更新 context.completedSteps 后触发，用于安全保存断点 */
    onStepComplete?: (step: { stepId: string; stepName: string; stepIndex: number; totalSteps: number; synced: number; totalSynced: number; completedStepIds: string[] }) => void | Promise<void>;
    isManual?: boolean;        // v406: 手动同步标记，拥有最高优先级
    checkpointResume?: boolean; // v779: 生产断点续跑专用语义，允许报告步骤拆分为异步小任务
  }
): Promise<AccountSyncResult> {
  const startTime = new Date();
  const result: AccountSyncResult = {
    accountId: account.accountId,
    userId: account.userId, // v336: 传递userId用于同步记录
    accountName: account.accountName,
    tier,
    success: false,
    partialSuccess: false, // v641: 部分成功标记
    startTime,
    endTime: startTime,
    durationMs: 0,
    completedSteps: 0,
    failedSteps: 0,
    skippedSteps: 0, // v641: 跳过步骤计数
    totalSteps: 0,
    totalSynced: 0,
    errors: [],
    stepResults: {},
  };

  // v222: 智能层级互斥保护
  // 规则：
  // 1. 同一层级重复触发 → 跳过
  // 2. full层运行时 → 所有其他层级跳过（full包含所有步骤）
  //    v388例外: confirmation层级允许与full层并行（confirmation只是验证性读取，不会冲突）
  // 3. medium层运行时 → high层跳过（减少API并发压力）
  // 4. high层运行时 → medium层正常执行（步骤不重叠）
  // 5. full层请求时有其他层级运行 → 跳过（等下一轮）
  // 6. 超时保护：45分钟后强制释放（v424）
  const lockKey = `${account.accountId}:${tier}`;
  const accountLocks = Array.from(activeSyncs.entries())
    .filter(([key]) => key.startsWith(`${account.accountId}:`));
  
  // v388: 记录是否有full层同步正在运行（用于confirmation层级的特殊处理）
  let fullSyncRunning = false;
  
  for (const [existingKey, existing] of accountLocks) {
    const existingTier = existingKey.split(':')[1];
    const runningMinutes = (Date.now() - existing.startTime.getTime()) / 60000;
    
    // v518: 动态超时保护 - 使用每个条目自身的超时值（而非硬编码45分钟）
    const existingTimeoutMin = (existing.timeoutMs || DEFAULT_SYNC_TIMEOUT_MS) / 60000;
    if (runningMinutes >= existingTimeoutMin) {
      log.warn(`[UnifiedSync] v518: 账户 ${account.accountId} 的${existingTier}层同步已超时（${runningMinutes.toFixed(1)}分钟 >= 动态阈值${existingTimeoutMin}分钟），强制释放`);
      activeSyncs.delete(existingKey);
      continue;
    }
    
    // 同一层级的同步在运行
    if (existingTier === tier) {
      // v425: 手动同步拥有最高优先级，强制释放已有的同层级锁
      if (options?.isManual) {
        log.warn(`[UnifiedSync] v425: 手动同步优先 - 强制释放账户 ${account.accountId} 的${existingTier}层自动同步锁（已运行${runningMinutes.toFixed(1)}分钟）`);
        activeSyncs.delete(existingKey);
        continue;
      }
      // v652: 不再直接return，而是进入排队等待
      log.info(`[UnifiedSync] v652: 账户 ${account.accountId} 已有${existingTier}层同步在运行（${runningMinutes.toFixed(1)}分钟），${tier}层进入排队等待`);
      const slotAcquired = await waitForSyncSlot(account.accountId, tier, existingTier);
      if (!slotAcquired) {
        result.errors.push(`排队等待超时: 已有${existingTier}层同步在运行`);
        return result;
      }
      break; // 锁已释放，跳出检查循环继续执行
    }
    
    // full层同步在运行时的处理
    if (existingTier === 'full') {
      // v425: 手动同步拥有最高优先级，强制释放已有的full层自动同步锁
      if (options?.isManual) {
        log.warn(`[UnifiedSync] v425: 手动同步优先 - 强制释放账户 ${account.accountId} 的full层自动同步锁（已运行${runningMinutes.toFixed(1)}分钟）`);
        activeSyncs.delete(existingKey);
        continue;
      }
      // v388: confirmation层级允许与full层并行运行
      if (tier === 'confirmation') {
        fullSyncRunning = true;
        log.info(`[UnifiedSync] v388: 账户 ${account.accountId} full层同步在运行（${runningMinutes.toFixed(1)}分钟），confirmation层允许并行执行`);
        continue;
      }
      // v652: 排队等待而非直接跳过
      log.info(`[UnifiedSync] v652: 账户 ${account.accountId} 已有full层同步在运行（${runningMinutes.toFixed(1)}分钟），${tier}层进入排队等待`);
      const slotAcquired = await waitForSyncSlot(account.accountId, tier, 'full');
      if (!slotAcquired) {
        result.errors.push(`排队等待超时: 已有full层同步在运行`);
        return result;
      }
      break; // 锁已释放
    }
    
    // v222: medium层运行时，high层排队等待（v652从直接跳过改为排队）
    if (existingTier === 'medium' && tier === 'high') {
      log.info(`[UnifiedSync] v652: 账户 ${account.accountId} medium层正在运行（${runningMinutes.toFixed(1)}分钟），high层进入排队等待`);
      const slotAcquired = await waitForSyncSlot(account.accountId, 'high', 'medium');
      if (!slotAcquired) {
        result.errors.push(`排队等待超时: medium层同步在运行`);
        return result;
      }
      break; // 锁已释放
    }
    
    // v406: 手动全量同步拥有最高优先级
    if (tier === 'full' && existingTier !== 'full') {
      if (options?.isManual) {
        log.warn(`[UnifiedSync] v406: 手动全量同步优先 - 强制释放账户 ${account.accountId} 的${existingTier}层自动同步锁`);
        activeSyncs.delete(existingKey);
        continue;
      }
      // v652: full层排队等待而非直接跳过
      log.info(`[UnifiedSync] v652: 账户 ${account.accountId} 有${existingTier}层同步在运行，full层进入排队等待`);
      const slotAcquired = await waitForSyncSlot(account.accountId, 'full', existingTier);
      if (!slotAcquired) {
        result.errors.push(`排队等待超时: ${existingTier}层同步在运行`);
        return result;
      }
      break; // 锁已释放
    }
  }

  // v528: 注册活跃同步（包含心跳时间和动态超时值）
  // 注：timeoutMs会在下方查询广告活动数量后更新
  activeSyncs.set(lockKey, { tier, startTime, lastHeartbeat: new Date(), timeoutMs: DEFAULT_SYNC_TIMEOUT_MS });
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

    // v676-fix: 手动全量同步时强制使用同步等待模式
    // triggerManualFullSync 不经过 syncAll()，所以需要在这里设置 _forceSync
    // 判断条件：isManual=true 且包含 nightly 步骤（如 performance_95d）
    const hasNightlySteps = options?.specificSteps?.some(s => 
      ['performance_95d', 'keyword_performance', 'ad_group_performance', 'target_performance', 'placement_performance'].includes(s)
    );
    const checkpointResumeAsyncReports = options?.checkpointResume === true;
    if (options?.isManual && (hasNightlySteps || tier === 'full')) {
      syncService._forceSync = true;
      syncService._reportWaitTimeoutMs = 1800000; // 30分钟
      log.info(`[v676-fix] syncAccount: 手动全量同步模式, _forceSync=true, 报告等待超时=1800秒`);
    } else if (checkpointResumeAsyncReports && (tier === 'full' || tier === 'nightly')) {
      // v779: 断点续跑不同于重新full同步。报告型剩余步骤移交P5异步report_jobs小任务，避免单个resume任务长时间阻塞。
      syncService._forceSync = false;
      log.info(`[v779] syncAccount: checkpoint_resume模式, _forceSync=false, 报告步骤拆分为可独立重试的异步小任务`);
    } else if (tier === 'full' || tier === 'nightly') {
      // v742: full/nightly 层自动同步也使用同步等待模式
      // 修复搜索词停滞问题：P5异步队列对搜索词报告的提交存在静默失败
      // 全量同步层的报告（搜索词、定向、广告位等）必须同步等待获取数据
      syncService._forceSync = true;
      syncService._reportWaitTimeoutMs = 1800000; // 30分钟
      log.info(`[v742] syncAccount: full/nightly层自动同步, _forceSync=true, 确保搜索词等报告同步获取数据`);
    }

    // 确定要执行的步骤
    // v404: 当传入specificSteps时，从所有SYNC_STEPS中过滤（支持手动全量同步跨层级执行）
    let steps: SyncStep[];
    if (options?.specificSteps) {
      steps = SYNC_STEPS.filter(s => options.specificSteps!.includes(s.id));
    } else {
      steps = getStepsForTier(tier);
    }
    if (options?.skipSteps) {
      steps = steps.filter(s => !options.skipSteps!.includes(s.id));
    }

    result.totalSteps = steps.length;

    // v340: 大账户自适应保护机制
    // 查询账户的广告活动数量，动态调整同步策略
    let campaignCount = 0;
    let isLargeAccount = false;
    const LARGE_ACCOUNT_THRESHOLD = 100; // v648: 降低阈值到100，使中等账号也能获得动态超时保护
    const LARGE_ACCOUNT_STEP_DELAY_MS = 10000; // v476: 大账户步骤间额外延迟10秒，优先保证100%成功率
    // v518: 使用全局动态超时常量（与僵尸清理、锁超时保持一致）
    let SYNC_TIMEOUT_MS = tier === 'nightly' ? NIGHTLY_SYNC_TIMEOUT_MS : DEFAULT_SYNC_TIMEOUT_MS;
    try {
      const database = await db.getDb();
      if (database) {
        const { campaigns: campaignsTable } = await import('../../drizzle/schema');
        const countResult = await database
          .select({ count: sql<number>`COUNT(*)` })
          .from(campaignsTable)
          .where(eq(campaignsTable.accountId, account.accountId));
        campaignCount = countResult[0]?.count || 0;
        isLargeAccount = campaignCount >= LARGE_ACCOUNT_THRESHOLD;
        if (isLargeAccount && tier !== 'nightly') {
          // v648: 动态超时计算 - 覆盖100+广告活动的中等账号
          for (const t of LARGE_ACCOUNT_TIMEOUT_TIERS) {
            if (campaignCount >= t.threshold) {
              SYNC_TIMEOUT_MS = t.timeoutMs;
              break;
            }
          }
          // v518: 同步更新activeSyncs中的超时值，确保僵尸清理和锁超时使用同一动态值
          const existingSync = activeSyncs.get(lockKey);
          if (existingSync) {
            existingSync.timeoutMs = SYNC_TIMEOUT_MS;
          }
          log.warn(`[UnifiedSync] v518: 大账户检测! 账户${account.accountId}(${account.accountName})拥有${campaignCount}个广告活动，动态超时=${Math.round(SYNC_TIMEOUT_MS / 60000)}分钟（已同步到僵尸清理/锁超时）`);
        }
      }
    } catch (e: unknown) {
      log.debug(`[UnifiedSync] v340: 查询账户广告活动数失败: ${(e as Error).message}`);
    }

    // v673: 增强空账户预检机制 — 对无广告活动的站点实施彻底跳过
    // 修复v648的两个缺陷：1) isManual条件导致手动同步不跳过；2) 仅跳过报告步骤不够彻底
    let activeCampaignCount = campaignCount;
    if (campaignCount > 0) {
      try {
        const database = await db.getDb();
        if (database) {
          const { campaigns: campaignsTable } = await import('../../drizzle/schema');
          const activeResult = await database
            .select({ count: sql<number>`COUNT(*)` })
            .from(campaignsTable)
            .where(and(
              eq(campaignsTable.accountId, account.accountId),
              sql`${campaignsTable.campaignStatus} IN ('enabled', 'paused')`
            ));
          activeCampaignCount = activeResult[0]?.count || 0;
        }
      } catch (e: unknown) {
        log.debug(`[v673] 查询活跃广告活动数失败: ${(e as Error).message}`);
      }
    }

    // v673: 对完全无广告活动的账户（campaignCount === 0），仅保留3个campaign检查步骤
    // 这样可以检测是否有新创建的广告活动，同时避免浪费时间在空站点上
    if (campaignCount === 0) {
      const CAMPAIGN_CHECK_STEPS = new Set(['sp_campaigns', 'sb_campaigns', 'sd_campaigns']);
      const originalCount = steps.length;
      steps = steps.filter(s => CAMPAIGN_CHECK_STEPS.has(s.id));
      const skippedCount = originalCount - steps.length;
      const syncType = options?.isManual ? '手动' : '自动';
      log.info(`[v673] 空站点快速跳过(${syncType}): 账户${account.accountId}(${account.accountName})无广告活动，仅执行${steps.length}个campaign检查步骤，跳过${skippedCount}个步骤`);
      result.skippedSteps = (result.skippedSteps || 0) + skippedCount;
      result.totalSteps = steps.length;
    }
    // v673: 对全部已归档的账户（有campaign但activeCampaignCount === 0），跳过报告和竞价类步骤
    else if (activeCampaignCount === 0) {
      const SKIP_FOR_ARCHIVED = new Set([
        'performance_today', 'performance_7d', 'performance_95d',
        'sp_search_terms', 'sb_search_terms',
        'sp_placement_performance', 'sb_placement_performance',
        'sp_auto_targeting', 'sd_targeting', 'sb_targeting',
        'keyword_performance', 'target_performance', 'ad_group_performance',
        'sp_budget_rules',
        'sp_bid_recommendations', 'sb_bid_recommendations', 'sd_bid_recommendations', 'sd_audience_bid_recommendations',
      ]);
      const originalCount = steps.length;
      steps = steps.filter(s => !SKIP_FOR_ARCHIVED.has(s.id));
      const skippedCount = originalCount - steps.length;
      const syncType = options?.isManual ? '手动' : '自动';
      if (skippedCount > 0) {
        log.info(`[v673] 归档账户优化(${syncType}): 账户${account.accountId}(${account.accountName})${campaignCount}个广告活动全部已归档，跳过${skippedCount}个报告/竞价步骤，执行${steps.length}个基础步骤`);
        result.skippedSteps = (result.skippedSteps || 0) + skippedCount;
      }
      result.totalSteps = steps.length;
    }

    // v663: 大账户增量同步策略 — 超过200个广告活动的账户，非手动触发时自动使用增量同步
    // 增量同步仅缩短报告天数范围，不跳过任何步骤，确保数据完整性
    const useIncrementalSync = campaignCount >= INCREMENTAL_SYNC_CAMPAIGN_THRESHOLD
      && !options?.isManual
      && (tier === 'full' || tier === 'nightly');
    const reportDays = useIncrementalSync ? INCREMENTAL_REPORT_DAYS : FULL_REPORT_DAYS;
    if (useIncrementalSync) {
      log.info(`[v663] 大账户增量同步: 账户${account.accountId}(${account.accountName}) ${campaignCount}个广告活动>${INCREMENTAL_SYNC_CAMPAIGN_THRESHOLD}阈值, 报告天数缩短为 SP=${reportDays.sp}天/SB=${reportDays.sb}天/SD=${reportDays.sd}天`);
    }

    // v663: 断点续传 — 加载上次中断的检查点，跳过已完成的步骤
    let checkpointSkipSteps: Set<string> = new Set();
    let checkpointResumeInfo = '';
    let restoredCheckpointData: SyncCheckpointData | null = null;
    if (!options?.isManual) {
      try {
        const savedCheckpoint = await loadSyncCheckpoint(account.accountId, tier);
        if (savedCheckpoint) {
          restoredCheckpointData = savedCheckpoint;
          const recovery = buildRecoveryStrategy(savedCheckpoint);
          checkpointSkipSteps = recovery.skipSteps;
          checkpointResumeInfo = recovery.resumeInfo;
          log.info(`[v663] 断点续传: 账户${account.accountId} ${tier}层 - ${checkpointResumeInfo}`);
          // 将检查点中已完成的步骤加入skipSteps
          steps = steps.filter(s => !checkpointSkipSteps.has(s.id));
          const skippedByCheckpoint = checkpointSkipSteps.size;
          if (skippedByCheckpoint > 0) {
            log.info(`[v663] 断点续传: 跳过${skippedByCheckpoint}个已完成步骤，剩余${steps.length}个步骤待执行`);
            result.totalSteps = steps.length;
          }
        }
      } catch (cpErr: unknown) {
        log.warn(`[v663] 加载检查点失败(不影响同步): ${(cpErr as Error).message}`);
      }
    }

    const restoredCompletedSteps = Array.from(new Set([
      ...(restoredCheckpointData?.completedSteps || []),
      ...(options?.skipSteps || []),
    ]));

    // 创建同步上下文
    const context: SyncContext = {
      accountId: account.accountId,
      userId: account.userId,
      tier,
      startTime,
      completedSteps: restoredCompletedSteps,
      failedSteps: [],
      currentStep: null,
      totalSynced: restoredCheckpointData?.totalSynced || 0,
      totalErrors: 0,
      checkpoint: restoredCheckpointData?.stepCheckpoints || {},
      adTypeCapabilities: { sb: null, sd: null },
      incrementalMode: useIncrementalSync,
      incrementalReportDays: reportDays,
    };

    // v665: 注册活跃同步上下文，用于SIGTERM时主动保存checkpoint
    activeSyncContexts.set(lockKey, { accountId: account.accountId, tier, context, startTime });

    // v775: 步骤成功完成后立即保存账户级MySQL checkpoint，并通知队列消费者保存任务级Redis checkpoint。
    // 注意：onProgress会在步骤开始和心跳期间触发，不能作为“完成”信号。
    const persistCompletedStepCheckpoint = async (stepId: string, stepName: string, stepIndex: number, totalSteps: number, synced: number) => {
      const checkpointData: SyncCheckpointData = {
        completedSteps: [...context.completedSteps],
        interruptReason: 'step_complete',
        totalSynced: context.totalSynced,
        elapsedMs: Date.now() - startTime.getTime(),
        stepCheckpoints: Object.fromEntries(
          context.completedSteps.map(sid => [sid, {
            status: 'completed',
            synced: (context.checkpoint[sid] as { synced?: number })?.synced || (sid === stepId ? synced : 0),
            completedAt: (context.checkpoint[sid] as { completedAt?: string })?.completedAt,
          }])
        ),
        recordCheckpoints: {},
        savedAt: new Date().toISOString(),
      };
      await saveSyncCheckpoint(account.accountId, tier, checkpointData).catch((cpErr: unknown) => {
        log.warn(`[v775] 保存步骤完成checkpoint失败: 账户${account.accountId} ${tier}层 ${stepName}: ${(cpErr as Error).message}`);
      });
      if (options?.onStepComplete) {
        try {
          await Promise.resolve(options.onStepComplete({
            stepId,
            stepName,
            stepIndex,
            totalSteps,
            synced,
            totalSynced: context.totalSynced,
            completedStepIds: [...context.completedSteps],
          }));
        } catch (progressErr: unknown) {
          log.debug(`[UnifiedSync] v775: 步骤完成回调失败: ${(progressErr as Error).message}`);
        }
      }
    };

    // v684: 先发后收报告策略 — 在执行步骤前一次性提交所有报告请求
    // 效果: 所有报告在Amazon后台并行生成，同时执行API直接调用步骤
    // 然后集中轮询所有报告状态，哪个好了就立即下载处理
    let prefetchSession: import('./prefetchReportScheduler').PrefetchSession | null = null;
    const isFullSync = tier === 'full' || (options?.specificSteps && options.specificSteps.length > 20);
    if (isFullSync && steps.length > 10 && !checkpointResumeAsyncReports) {
      try {
        const { submitAllReports, pollAndDownloadAllReports, cleanupPrefetchSession } = await import('./prefetchReportScheduler');
        log.info(`[v684] 先发后收: 开始阶段A — 一次性提交所有报告请求`);
        prefetchSession = await submitAllReports(
          syncService.client,
          account.accountId,
          account.marketplace,
          useIncrementalSync,
          reportDays,
          context.adTypeCapabilities
        );
        log.info(`[v684] 先发后收: 阶段A完成，${prefetchSession.reports.size}个报告已提交，现在执行API直接调用步骤`);
      } catch (prefetchErr: unknown) {
        log.warn(`[v684] 先发后收: 阶段A失败，回退到传统串行模式: ${(prefetchErr as Error).message}`);
        prefetchSession = null;
      }
    }

    // v684: 如果启用了先发后收，重新排序步骤：API直接调用步骤优先执行，报告步骤放到最后
    if (prefetchSession) {
      const { isReportStep } = await import('./prefetchReportScheduler');
      const apiSteps = steps.filter(s => !isReportStep(s.id));
      const reportSteps = steps.filter(s => isReportStep(s.id));
      steps = [...apiSteps, ...reportSteps];
      log.info(`[v684] 步骤重排序: ${apiSteps.length}个API步骤优先 + ${reportSteps.length}个报告步骤后续`);
    }

    // v757: 延迟执行队列 — 收集deferrable步骤，在主同步完成后异步执行
    const deferredSteps: { step: SyncStep; originalIndex: number }[] = [];

    // v682: 将步骤分组 — 同一parallelGroup的步骤合并为一个并行执行单元
    // 效果: 7个串行报告步骤(35-210分钟) → 3个并行组(15-70分钟)
    interface StepGroup {
      steps: { step: SyncStep; originalIndex: number }[];
      isParallel: boolean;
      groupName: string;
    }
    const stepGroups: StepGroup[] = [];
    let currentGroupKey: string | null = null;
    let currentGroup: StepGroup | null = null;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const groupKey = step.parallelGroup || `__single_${i}`;
      if (groupKey === currentGroupKey && currentGroup) {
        // 同一并行组，追加到当前组
        currentGroup.steps.push({ step, originalIndex: i });
      } else {
        // 新组
        if (currentGroup) stepGroups.push(currentGroup);
        currentGroup = {
          steps: [{ step, originalIndex: i }],
          isParallel: !!step.parallelGroup,
          groupName: step.parallelGroup || step.name,
        };
        currentGroupKey = groupKey;
      }
    }
    if (currentGroup) stepGroups.push(currentGroup);
    
    const parallelGroupCount = stepGroups.filter(g => g.isParallel && g.steps.length > 1).length;
    if (parallelGroupCount > 0) {
      log.info(`[v682] 并行组优化: ${steps.length}个步骤分为${stepGroups.length}个执行单元，其中${parallelGroupCount}个并行组`);
    }
    
    // 逐组执行同步（组内并行，组间串行）
    let globalStepIndex = 0; // 用于进度计算
    let prefetchPollingDone = false; // v684: 标记是否已执行阶段C轮询
    for (const group of stepGroups) {
      // v684: 先发后收阶段C — 当第一个报告步骤即将执行时，集中轮询所有报告
      if (prefetchSession && !prefetchPollingDone) {
        const firstStepId = group.steps[0]?.step?.id || '';
        const { isReportStep: checkReport, pollAndDownloadAllReports } = await import('./prefetchReportScheduler');
        if (checkReport(firstStepId)) {
          prefetchPollingDone = true;
          log.info(`[v684] 先发后收: 开始阶段C — 集中轮询所有报告状态`);
          try {
            await pollAndDownloadAllReports(
              syncService.client,
              prefetchSession,
              1200000, // 20分钟超时
              (completed, total, currentReport) => {
                if (options?.onProgress) {
                  try { options.onProgress(`报告下载 ${completed}/${total}: ${currentReport}`, globalStepIndex, steps.length); } catch (_e) {}
                }
              }
            );
            const completedCount = Array.from(prefetchSession.reports.values()).filter(r => r.status === 'completed').length;
            log.info(`[v684] 先发后收: 阶段C完成，${completedCount}/${prefetchSession.reports.size}个报告已下载`);
          } catch (pollErr: unknown) {
            log.warn(`[v684] 先发后收: 阶段C失败: ${(pollErr as Error).message}`);
          }
        }
      }
      
      // 并行组执行（组内所有步骤同时启动）
      if (group.isParallel && group.steps.length > 1) {
        const groupStepNames = group.steps.map(s => s.step.name).join(', ');
        log.info(`[v682] 并行组开始: [${group.groupName}] 包含${group.steps.length}个步骤: ${groupStepNames}`);
        
        // 更新进度显示为并行组名称
        context.currentStep = `并行: ${groupStepNames}`;
        const runningEntry = engineStatus.currentlyRunning.find(r => r.accountId === account.accountId);
        if (runningEntry) {
          runningEntry.step = `并行: ${group.groupName}`;
        }
        if (options?.onProgress) {
          try { await options.onProgress(`并行: ${groupStepNames}`, globalStepIndex, steps.length); } catch (_e) {}
        }
        
        // v688: 初始化并行子进度跟踪器 — 每个并行任务独立跟踪，避免相互覆盖
        const parallelSubProgressMap: Record<string, { stepId: string; stepName: string; phase: string; current: number; total: number; detail?: string }> = {};
        
        // 并行执行组内所有步骤
        const parallelPromises = group.steps.map(async ({ step }) => {
          const STEP_TIMEOUT_MAP: Record<string, number> = {
            'performance_today': 25, 'performance_7d': 25, 'performance_95d': 45,
            'sp_search_terms': 30, 'sb_search_terms': 30,
            'sp_placement_performance': 30, 'sb_placement_performance': 30,
            'keyword_performance': 30, 'target_performance': 30, 'ad_group_performance': 30,
            'sp_auto_targeting': 30, 'sd_targeting': 30, 'sb_targeting': 30,
            // v757: SP关键词超时提升到70分钟
            'sp_keywords': 70, 'sb_keywords': 10,
            'sp_negative_keywords': 90, 'sp_negative_targets': 90,
          };
          const timeoutMinutes = STEP_TIMEOUT_MAP[step.id] || 30;
          const STEP_TIMEOUT_MS = timeoutMinutes * 60 * 1000;
          
          // v688: 为每个并行步骤创建独立的子进度回调，带stepId标识
          const stepContext = { ...context };
          const LONG_RUNNING_STEPS = ['performance_95d', 'keyword_performance', 'target_performance', 'ad_group_performance', 'performance_today', 'performance_7d'];
          if (LONG_RUNNING_STEPS.includes(step.id)) {
            stepContext.onSubProgress = (subProgress: { phase: string; current: number; total: number; detail?: string }) => {
              try {
                // 更新并行子进度Map
                parallelSubProgressMap[step.id] = {
                  stepId: step.id,
                  stepName: step.name,
                  phase: subProgress.phase,
                  current: subProgress.current,
                  total: subProgress.total,
                  detail: subProgress.detail,
                };
                // 广播合并后的并行子进度
                const { broadcastSyncProgress } = require('./syncProgressWs');
                const stepProgressPercent = Math.round(((globalStepIndex + 1) / steps.length) * 100);
                broadcastSyncProgress(account.accountId, {
                  step: `并行: ${groupStepNames}`,
                  stepIndex: globalStepIndex,
                  totalSteps: steps.length,
                  progressPercent: stepProgressPercent,
                  status: 'running',
                  subProgress: subProgress, // 单个步骤的最新子进度（向后兼容）
                  parallelSubProgress: { ...parallelSubProgressMap }, // 所有并行步骤的子进度汇总
                });
              } catch (_subErr) { /* 子进度推送失败不影响同步 */ }
            };
          } else {
            stepContext.onSubProgress = undefined;
          }
          
          try {
            rateController.recordApiCall();
            const stepResult = await Promise.race([
              step.execute(syncService, stepContext),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`STEP_TIMEOUT: 步骤${step.name}超时(${timeoutMinutes}分钟)`)), STEP_TIMEOUT_MS)),
            ]);
            return { stepId: step.id, stepName: step.name, result: stepResult };
          } catch (e: unknown) {
            return { stepId: step.id, stepName: step.name, result: { success: false, synced: 0, errors: [(e as Error).message] } as StepResult };
          }
        });
        
        const parallelResults = await Promise.allSettled(parallelPromises);
        
        // 处理并行组结果
        for (const settled of parallelResults) {
          const { stepId, stepName, result: stepResult } = settled.status === 'fulfilled' 
            ? settled.value 
            : { stepId: 'unknown', stepName: 'unknown', result: { success: false, synced: 0, errors: [(settled.reason as Error).message] } as StepResult };
          
          result.stepResults[stepId] = stepResult;
          const safeSynced = typeof stepResult.synced === 'number' ? stepResult.synced : 0;
          // @ts-ignore - runtime type
          stepResult.synced = safeSynced;
          if (stepResult.success) {
            result.completedSteps++;
            context.completedSteps.push(stepId);
            result.totalSynced += safeSynced;
            context.totalSynced += safeSynced;
            context.checkpoint[stepId] = {
              completedAt: new Date().toISOString(),
              success: true,
              synced: safeSynced,
            };
            await persistCompletedStepCheckpoint(stepId, stepName, globalStepIndex, steps.length, safeSynced);
            log.info(`[v682] 并行步骤完成: ${stepName} — 同步${safeSynced}条记录`);
          } else {
            result.failedSteps++;
            context.failedSteps.push(stepId);
            result.errors.push(`${stepName}: ${stepResult.errors.join(', ')}`);
            log.warn(`[v682] 并行步骤失败: ${stepName} — ${stepResult.errors.join(', ')}`);
          }
        }
        
        globalStepIndex += group.steps.length;
        log.info(`[v682] 并行组完成: [${group.groupName}] ${group.steps.length}个步骤已全部完成`);
        continue; // 跳过下方的单步执行逻辑
      }
      
      // 单步执行（原有逻辑）
      const { step } = group.steps[0];
      const i = globalStepIndex;
      globalStepIndex++;
      context.currentStep = step.id;

      // v757: 检测可延迟执行的步骤，收集到延迟队列而非立即执行
      if (step.deferrable) {
        deferredSteps.push({ step, originalIndex: i });
        log.info(`[v757] 延迟执行: 步骤${step.name}已加入异步队列，不阻塞主同步流程`);
        result.stepResults[step.id] = { success: true, synced: 0, errors: [], details: { deferred: true } };
        result.completedSteps++;
        context.completedSteps.push(step.id);
        context.checkpoint[step.id] = {
          completedAt: new Date().toISOString(),
          success: true,
          synced: 0,
          deferred: true,
        };
        await persistCompletedStepCheckpoint(step.id, step.name, i, steps.length, 0);
        continue;
      }

      // 更新引擎状态
      const runningEntry = engineStatus.currentlyRunning.find(r => r.accountId === account.accountId);
      if (runningEntry) {
        runningEntry.step = step.name;
      }

      // v528: 进度回调 + 心跳更新（每个步骤开始时同步更新DB和内存心跳）
      if (options?.onProgress) {
        try {
          await options.onProgress(step.name, i, steps.length);
        } catch (progressErr: unknown) {
          log.debug(`[UnifiedSync] v406: 进度回调失败: ${(progressErr as Error).message}`);
        }
      }
      // v528: 每个步骤开始时更新内存心跳
      const syncEntryForStep = activeSyncs.get(lockKey);
      if (syncEntryForStep) {
        syncEntryForStep.lastHeartbeat = new Date();
      }

      // v473: Profile广告类型能力检测 — 如果已检测到不支持SB/SD，跳过对应步骤
      const isSbStep = step.id.startsWith('sb_');
      const isSdStep = step.id.startsWith('sd_');
      if (isSbStep && context.adTypeCapabilities.sb === false) {
        log.info(`[UnifiedSync] v473: 跳过步骤 ${step.name} — 该Profile不支持SB广告`);
        result.stepResults[step.id] = { success: true, synced: 0, errors: [] };
        result.completedSteps++;
        context.completedSteps.push(step.id);
        context.checkpoint[step.id] = {
          completedAt: new Date().toISOString(),
          success: true,
          synced: 0,
          skippedByCapability: true,
        };
        await persistCompletedStepCheckpoint(step.id, step.name, i, steps.length, 0);
        continue;
      }
      if (isSdStep && context.adTypeCapabilities.sd === false) {
        log.info(`[UnifiedSync] v473: 跳过步骤 ${step.name} — 该Profile不支持SD广告`);
        result.stepResults[step.id] = { success: true, synced: 0, errors: [] };
        result.completedSteps++;
        context.completedSteps.push(step.id);
        context.checkpoint[step.id] = {
          completedAt: new Date().toISOString(),
          success: true,
          synced: 0,
          skippedByCapability: true,
        };
        await persistCompletedStepCheckpoint(step.id, step.name, i, steps.length, 0);
        continue;
      }

      log.info(`[UnifiedSync] 账户 ${account.accountId} 执行步骤 [${i + 1}/${steps.length}]: ${step.name}`);

      // v405: 检查系统是否正在关闭（SIGTERM），提前保存进度并优雅退出
      try {
        const { isShuttingDown } = await import('../deployLifecycleManager');
        if (isShuttingDown()) {
          const skippedCount = steps.length - i;
          const shutdownMsg = `账户${account.accountId} 同步被系统关闭中断，已完成${i}/${steps.length}步骤，跳过${skippedCount}个步骤`;
          log.warn(`[UnifiedSync] v641: ${shutdownMsg}`);
          result.errors.push(shutdownMsg);
          // v641: 记录跳过的步骤
          result.skippedSteps += skippedCount;
          for (const skippedStep of steps.slice(i)) {
            result.stepResults[skippedStep.id] = { success: false, synced: 0, errors: ['shutdown_skipped'] };
          }
          result.stepResults['_interrupted'] = { success: false, synced: 0, errors: [shutdownMsg] };
          // v663: 断点续传 — 系统关闭时保存检查点
          try {
            const checkpointData: SyncCheckpointData = {
              completedSteps: [...context.completedSteps],
              interruptReason: 'shutdown',
              totalSynced: context.totalSynced,
              elapsedMs: Date.now() - startTime.getTime(),
              stepCheckpoints: Object.fromEntries(
                context.completedSteps.map(sid => [sid, { status: 'completed', synced: (context.checkpoint[sid] as { synced?: number })?.synced || 0 }])
              ),
              recordCheckpoints: {},
              savedAt: new Date().toISOString(),
            };
            await saveSyncCheckpoint(account.accountId, tier, checkpointData);
            log.info(`[v663] 断点已保存(shutdown): 账户${account.accountId} ${tier}层, 已完成${context.completedSteps.length}步`);
          } catch (cpErr: unknown) {
            log.warn(`[v663] 保存检查点失败(shutdown): ${(cpErr as Error).message}`);
          }
          break;
        }
      } catch (e: any) {
        // isShuttingDown检查失败不影响同步继续
      }

      // v340+v641: 单账户同步超时保护 — 超时后精确记录跳过的步骤
      const elapsed = Date.now() - startTime.getTime();
      if (elapsed > SYNC_TIMEOUT_MS) {
        const skippedCount = steps.length - i;
        const skippedNames = steps.slice(i).map(s => s.name).join(', ');
        const timeoutMsg = `账户${account.accountId} 同步超时(${Math.round(elapsed / 60000)}分钟>阈值${SYNC_TIMEOUT_MS / 60000}分钟)，已完成${i}/${steps.length}步骤，跳过${skippedCount}个步骤: [${skippedNames}]`;
        log.warn(`[UnifiedSync] v641: ${timeoutMsg}`);
        result.errors.push(timeoutMsg);
        // v641: 精确记录跳过的步骤数，用于区分“部分成功”和“完全成功”
        result.skippedSteps += skippedCount;
        // 为每个跳过的步骤记录状态
        for (const skippedStep of steps.slice(i)) {
          result.stepResults[skippedStep.id] = { success: false, synced: 0, errors: ['timeout_skipped'] };
        }
        // v663: 断点续传 — 超时时保存检查点
        try {
          const checkpointData: SyncCheckpointData = {
            completedSteps: [...context.completedSteps],
            interruptReason: 'timeout',
            totalSynced: context.totalSynced,
            elapsedMs: elapsed,
            stepCheckpoints: Object.fromEntries(
              context.completedSteps.map(sid => [sid, { status: 'completed', synced: (context.checkpoint[sid] as { synced?: number })?.synced || 0 }])
            ),
            recordCheckpoints: {},
            savedAt: new Date().toISOString(),
          };
          await saveSyncCheckpoint(account.accountId, tier, checkpointData);
          log.info(`[v663] 断点已保存(timeout): 账户${account.accountId} ${tier}层, 已完成${context.completedSteps.length}步, 耗时${Math.round(elapsed / 60000)}分钟`);
        } catch (cpErr: unknown) {
          log.warn(`[v663] 保存检查点失败(timeout): ${(cpErr as Error).message}`);
        }
        break;
      }

      // v220+v340: 步骤间速率控制延迟（大账户额外增加延迟）
      if (i > 0) {
        const baseDelay = rateController.getStepDelay();
        const extraDelay = isLargeAccount ? LARGE_ACCOUNT_STEP_DELAY_MS : 0;
        const totalDelay = baseDelay + extraDelay;
        if (totalDelay > 0) {
          if (isLargeAccount) {
            log.debug(`[UnifiedSync] v340: 大账户步骤间延迟 ${totalDelay}ms (基础${baseDelay}ms + 大账户保护${extraDelay}ms)`);
          }
          await sleep(totalDelay);
        }
      }

      // v643: 步骤级自动重试机制 — 对可重试错误(429/5xx/网络超时)自动重试最多2次
      // 参考amazonSyncService.ts的成熟重试模式，使用指数退避策略
      const STEP_MAX_RETRIES = 2;
      const STEP_RETRY_BASE_DELAY_MS = 5000; // 5s -> 10s 指数退避
      
      // v658-fix: 将heartbeatTimer声明提升到for循环外部
      // 修复esbuild构建时try块内let声明与catch块引用变量名不一致的bug
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      
      for (let retryAttempt = 0; retryAttempt <= STEP_MAX_RETRIES; retryAttempt++) {
      try {
        // v220: 记录API调用（每个步骤通常包含1-3个API调用）
        rateController.recordApiCall();
        
        // v651: 心跳机制 - 始终启动心跳定时器（不再依赖onProgress）
        // v650审计发现：自动同步不传onProgress导致心跳不启动，15分钟后被cleanupStaleJobs误杀
        // 修复：心跳定时器始终启动，同时更新内存心跳和DB心跳（通过直接UPDATE data_sync_jobs）
        heartbeatTimer = setInterval(async () => {
          try {
            // v651: 始终更新内存心跳，防止HealthMonitor误判为僵尸
            const syncEntry = activeSyncs.get(lockKey);
            if (syncEntry) {
              syncEntry.lastHeartbeat = new Date();
            }
            // v651: 如果有onProgress回调（手动同步），通过回调更新DB
            if (options?.onProgress) {
              await options.onProgress(step.name, i, steps.length);
            } else {
              // v651: 自动同步 — 直接更新data_sync_jobs中该账户最近的running任务的updated_at
              // MySQL的ON UPDATE CURRENT_TIMESTAMP会自动更新updated_at
              // v670: 修复心跳更新缺失progressPercent — 前端依赖此字段显示进度百分比
              // v671: 同时通过WebSocket广播进度更新
              try {
                const database = await db.getDb();
                const heartbeatProgressPercent = Math.round(((i + 1) / steps.length) * 100);
                if (database) {
                  const { dataSyncJobs } = await import('../../drizzle/schema');
                  await database.update(dataSyncJobs)
                    .set({ currentStep: step.name, currentStepIndex: i, totalSteps: steps.length, progressPercent: heartbeatProgressPercent })
                    .where(and(
                      eq(dataSyncJobs.accountId, account.accountId),
                      eq(dataSyncJobs.status, 'running')
                    ));
                }
                // v671: WebSocket实时推送进度
                try {
                  const { broadcastSyncProgress } = await import('./syncProgressWs');
                  broadcastSyncProgress(account.accountId, {
                    step: step.name,
                    stepIndex: i,
                    totalSteps: steps.length,
                    progressPercent: heartbeatProgressPercent,
                    status: 'running',
                  });
                } catch (_wsErr) { /* WebSocket广播失败不影响同步 */ }
              } catch (dbErr: any) {
                // DB更新失败不影响同步继续
              }
            }
            log.debug(`[UnifiedSync] v651: 心跳更新(DB+内存) - 账户${account.accountId} 步骤[${i+1}/${steps.length}]: ${step.name}`);
          } catch (hbErr: any) {
            // 心跳失败不影响同步继续，但仍然更新内存心跳以防止误杀
            const syncEntry = activeSyncs.get(lockKey);
            if (syncEntry) {
              syncEntry.lastHeartbeat = new Date();
            }
          }
        }, 60 * 1000); // 每1分钟发送一次心跳
        
        // v660: 步骤级智能超时 — 根据步骤类型设置充足超时
        // 列表步骤(campaigns/ad_groups/keywords): 10分钟
        // 报告步骤(performance/search_terms/placement): 30-45分钟
        // 素材步骤(sb_asset_urls): 15分钟
        // 竞价步骤(bid_recommendations): 30分钟（v664: 从20分钟放宽，v663实测90045的SP建议竞价20分钟不够）
        // 其他步骤: 15分钟
        // v660: STEP_TIMEOUT_MAP 大幅放宽 — v659实测发现原超时导致大量步骤失败
        // 核心原则: 稳定性和成功率优先于效率，宁可等待也不要超时失败
        const STEP_TIMEOUT_MAP: Record<string, number> = {
          // 列表步骤: v754: SP/SD广告活动从10→20分钟（v753实测90124的SP广告活动和90052的SD广告活动10分钟超时）
          'sp_campaigns': 20, 'sb_campaigns': 10, 'sd_campaigns': 20,
          'sp_ad_groups': 15, 'sb_ad_groups': 10, 'sd_ad_groups': 15,
          'sp_keywords': 70, 'sb_keywords': 10, // v757: sp_keywords从50→70分钟（v754实测90100的SP关键词50分钟超时，配合v757增量同步优化）
          'sp_product_targets': 20, 'sb_product_targets': 10, 'sd_product_targets': 10, // v678: sp_product_targets从10→20分钟（v677实测90023的SP商品定位步骤10分钟超时）
          'sp_negative_keywords': 90, 'sb_negative_keywords': 30, // v743: sp_negative_keywords从45→90分钟（v742实测90124的23.7万条否词需要更多时间，即使v743已优化为批量模式）
          'sp_negative_targets': 90, 'sb_negative_targets': 15, 'sd_negative_targets': 15, // v744: sp_negative_targets从50→90分钟（v743-fix2监控发现90052/90124仍100%超时，配合批量优化）
          'sp_auto_targeting': 10, 'sd_targeting': 10, 'sb_targeting': 10,
          'sb_ads': 10, 'sp_budget_rules': 10,
          // v679: 报告步骤超时优化 — 跨批并行提交后统一轮询，但大账户报告生成仍需时间
          // v678: performance_7d=120分钟, performance_95d=120分钟（串行14批）
          // v679.1: performance_today=25分钟（实测90023的3225campaigns需要15-20分钟生成报告）
          // v679.1: performance_7d=25分钟, performance_95d=45分钟（跨批并行但大账户仍需等待）
          'performance_today': 25, 'performance_7d': 25, 'performance_95d': 45, // v679.1: 修正超时（v679实测15分钟太激进）
          'sp_search_terms': 30, 'sb_search_terms': 30,
          'sp_placement_performance': 30, 'sb_placement_performance': 30,
          'keyword_performance': 30, 'target_performance': 30, 'ad_group_performance': 30, // v679: 从90→30分钟（跨批并行提交后统一轮询）
          // 素材步骤: 15分钟（从5分钟放宽）
          'sb_asset_urls': 15,
          // 竞价步骤: v665: SP建议竞价提升到60分钟（v664实测90045/90052在30分钟内仍无法完成），其他竞价步骤30分钟
          'sp_bid_recommendations': 60, 'sb_bid_recommendations': 30,
          'sd_bid_recommendations': 30, 'sd_audience_bid_recommendations': 30,
        };
        const timeoutMinutes = STEP_TIMEOUT_MAP[step.id] || 30; // v663: 默认超时从15分钟提升到30分钟（v662实测90107的SP否定关键词/商品定位15分钟不够）
        const STEP_TIMEOUT_MS = timeoutMinutes * 60 * 1000;
        const stepTimeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`STEP_TIMEOUT: 步骤${step.name}超时(${STEP_TIMEOUT_MS / 60000}分钟)`)), STEP_TIMEOUT_MS);
        });
        // v686: 为长耗时步骤注入子进度回调 — 通过WebSocket实时推送细粒度进展
        const LONG_RUNNING_STEPS = ['performance_95d', 'keyword_performance', 'target_performance', 'ad_group_performance', 'performance_today', 'performance_7d'];
        if (LONG_RUNNING_STEPS.includes(step.id)) {
          context.onSubProgress = (subProgress) => {
            try {
              const { broadcastSyncProgress } = require('./syncProgressWs');
              const stepProgressPercent = Math.round(((i + 1) / steps.length) * 100);
              broadcastSyncProgress(account.accountId, {
                step: step.name,
                stepIndex: i,
                totalSteps: steps.length,
                progressPercent: stepProgressPercent,
                status: 'running',
                subProgress,
              });
            } catch (_subErr) { /* 子进度推送失败不影响同步 */ }
          };
        } else {
          context.onSubProgress = undefined;
        }
        
        const stepResult = await Promise.race([
          step.execute(syncService, context),
          stepTimeoutPromise,
        ]);
        
        // v408: 清除心跳定时器
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        
        result.stepResults[step.id] = stepResult;

        // 确保synced始终为数字（防止某些步骤返回对象导致[object Object]拼接）
        const safeSynced = typeof stepResult.synced === 'number' ? stepResult.synced : 
          (typeof stepResult.synced === 'object' && stepResult.synced !== null ? 
            // @ts-ignore - dynamic property access
            Object.values(stepResult.synced as Record<string, unknown>).reduce((s: number, v: Record<string, unknown>) => s + (typeof v === 'number' ? v : 0), 0) : 0);
        // @ts-ignore - runtime type mismatch
        stepResult.synced = safeSynced;

        if (stepResult.success) {
          result.completedSteps++;
          context.completedSteps.push(step.id);
          // @ts-ignore - runtime type mismatch
          result.totalSynced += safeSynced;
          // @ts-ignore - runtime type mismatch
          context.totalSynced += safeSynced;
        } else {
          // v473: 检测403权限拒绝 — 如果SB/SD广告活动步骤返回403，记录该Profile不支持此广告类型
          const errMsg = stepResult.errors.join(', ').toLowerCase();
          const is403 = errMsg.includes('403') || errMsg.includes('permission') || errMsg.includes('forbidden') || errMsg.includes('not authorized');
          if (step.id === 'sb_campaigns' && is403) {
            context.adTypeCapabilities.sb = false;
            log.warn(`[UnifiedSync] v473: 检测到账户${account.accountId}的Profile不支持SB广告(403)，后续所有SB步骤将自动跳过`);
            // 不计入失败 — 这是正常的权限限制，不是错误
            result.completedSteps++;
            context.completedSteps.push(step.id);
          } else if (step.id === 'sd_campaigns' && is403) {
            context.adTypeCapabilities.sd = false;
            log.warn(`[UnifiedSync] v473: 检测到账户${account.accountId}的Profile不支持SD广告(403)，后续所有SD步骤将自动跳过`);
            result.completedSteps++;
            context.completedSteps.push(step.id);
          } else {
            result.failedSteps++;
            context.failedSteps.push(step.id);
            context.totalErrors++;
            result.errors.push(`${step.name}: ${stepResult.errors.join(', ')}`);
          }
        }

        // v473: 如果SB/SD campaigns步骤成功，记录该Profile支持此广告类型
        if (stepResult.success) {
          if (step.id === 'sb_campaigns') context.adTypeCapabilities.sb = true;
          if (step.id === 'sd_campaigns') context.adTypeCapabilities.sd = true;
        }

        // 保存检查点
        context.checkpoint[step.id] = {
          completedAt: new Date().toISOString(),
          success: stepResult.success,
          synced: stepResult.synced,
        };
        if (stepResult.success || context.completedSteps.includes(step.id)) {
          await persistCompletedStepCheckpoint(step.id, step.name, i, steps.length, safeSynced as number);
        }
        
        // v643: 步骤执行成功（无论是否重试过），跳出重试循环
        if (retryAttempt > 0) {
          log.info(`[UnifiedSync] v643: 账户 ${account.accountId} 步骤 ${step.name} 第${retryAttempt}次重试成功`);
        }
        break; // 成功，跳出重试循环

      } catch (error: unknown) {
        // v408: 异常时也清除心跳定时器
        // @ts-ignore - v652: NodeJS.Timeout type
        if (heartbeatTimer) {
          // @ts-ignore - v652: clearInterval type
          clearInterval(heartbeatTimer);
          // @ts-ignore - v652: timer null assignment
          heartbeatTimer = null;
        }
        
        const errMsg = (error as Error).message || '';
        
        // v643: 检测是否为可重试错误(429/5xx/网络超时)
        const isRetryableError = errMsg.includes('429') || 
                                errMsg.includes('503') || errMsg.includes('502') ||
                                errMsg.includes('ETIMEDOUT') || errMsg.includes('ECONNRESET') ||
                                errMsg.includes('TooManyRequests') || errMsg.includes('throttl') ||
                                errMsg.includes('限流') || errMsg.includes('socket hang up') ||
                                errMsg.includes('ECONNREFUSED') || errMsg.includes('network');
        
        // v642: 检测是否为Refresh Token过期错误 — 不可重试
        const isTokenExpired = errMsg.includes('Refresh Token已过期') ||
                              errMsg.includes('invalid_grant') ||
                              errMsg.includes('重新授权') ||
                              errMsg.includes('Token刷新失败') ||
                              errMsg.includes('Token刷新认证失败');
        
        // v643: 可重试错误且未达到最大重试次数 — 自动重试
        if (isRetryableError && !isTokenExpired && retryAttempt < STEP_MAX_RETRIES) {
          const retryDelay = STEP_RETRY_BASE_DELAY_MS * Math.pow(2, retryAttempt);
          // 限流错误记录到速率控制器
          if (errMsg.includes('429') || errMsg.includes('TooManyRequests') || errMsg.includes('throttl') || errMsg.includes('限流')) {
            rateController.recordThrottle();
          }
          log.warn(`[UnifiedSync] v643: 账户 ${account.accountId} 步骤 ${step.name} 失败(可重试): ${errMsg}, ${retryDelay}ms后第${retryAttempt + 1}次重试...`);
          await sleep(retryDelay);
          continue; // 重试当前步骤
        }
        
        // 步骤级错误隔离：单步失败不影响后续步骤
        result.failedSteps++;
        context.failedSteps.push(step.id);
        context.totalErrors++;
        const retryInfo = retryAttempt > 0 ? ` (已重试${retryAttempt}次)` : '';
        
        // v689: 精细化失败分类 — 区分限流/Token过期/网络超时/权限/服务端/未知
        const failureCategory = classifySyncFailure(errMsg);
        const failureCategoryLabel = FAILURE_CATEGORY_LABELS[failureCategory];
        result.errors.push(`${step.name}: [${failureCategory}] ${errMsg}${retryInfo}`);
        result.stepResults[step.id] = { 
          success: false, synced: 0, 
          errors: [`${errMsg}${retryInfo}`],
          details: { failureCategory, failureCategoryLabel, retryAttempts: retryAttempt },
        };
        
        // v689: 记录精细化失败日志到OPS日志系统
        logSyncError('UnifiedSync', `v689: 步骤失败[${failureCategory}]`, {
          accountId: account.accountId,
          accountName: account.accountName,
          marketplace: account.marketplace,
          stepId: step.id,
          stepName: step.name,
          tier,
          failureCategory,
          failureCategoryLabel,
          retryAttempts: retryAttempt,
          errorMessage: errMsg.slice(0, 500),
        });
        
        // v220: 限流后额外等待
        if (errMsg.includes('429') || errMsg.includes('TooManyRequests') || errMsg.includes('throttl') || errMsg.includes('限流')) {
          rateController.recordThrottle();
          const throttleDelay = rateController.getStepDelay();
          log.warn(`[UnifiedSync] 账户 ${account.accountId} 步骤 ${step.name} 触发限流，等待${throttleDelay}ms后继续`);
          await sleep(throttleDelay);
        }
        
        // v642: Token过期 — 标记账户并终止后续步骤
        if (isTokenExpired) {
          log.error(`[UnifiedSync] v642: 账户 ${account.accountId} Refresh Token已过期，终止后续同步步骤`);
          try {
            await db.updateAmazonApiCredentials(account.accountId, {
              syncStatus: 'auth_expired',
              syncErrorMessage: `Refresh Token已过期，请在Amazon API管理页面重新授权 (发现于${new Date().toISOString()})`,
            });
          } catch (dbErr: unknown) {
            log.warn(`[UnifiedSync] v642: 更新账户授权状态失败: ${(dbErr as Error).message}`);
          }
          const remainingSteps = steps.slice(i + 1);
          result.skippedSteps += remainingSteps.length;
          for (const skippedStep of remainingSteps) {
            result.stepResults[skippedStep.id] = { success: false, synced: 0, errors: ['token_expired_skipped'] };
          }
          result.errors.push(`Refresh Token已过期，跳过剩余${remainingSteps.length}个步骤`);
          break; // 终止后续步骤
        }
        
        log.warn(`[UnifiedSync] 账户 ${account.accountId} 步骤 ${step.name} 异常${retryInfo}: ${errMsg}`);
        break; // v643: 不可重试错误，跳出重试循环继续下一个步骤
      }
      } // v643: 结束重试for循环
      
      // v685: 步骤间内存优化 — 每个步骤完成后检查内存并触发GC
      // v684验证发现同步期间RSS达到2076MB，需要在步骤间主动释放内存
      if (i > 0 && i % 3 === 0) { // 每3个步骤检查一次
        try {
          const mem = process.memoryUsage();
          const rssMB = Math.round(mem.rss / 1024 / 1024);
          const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
          log.info(`[v685] 步骤间内存检查 [${i}/${steps.length}]: RSS=${rssMB}MB, Heap=${heapMB}MB`);
          
          // RSS > 800MB 或 堆使用 > 500MB 时触发GC
          if ((rssMB > 800 || heapMB > 500) && typeof global.gc === 'function') {
            global.gc();
            const memAfter = process.memoryUsage();
            const rssAfterMB = Math.round(memAfter.rss / 1024 / 1024);
            const heapAfterMB = Math.round(memAfter.heapUsed / 1024 / 1024);
            log.info(`[v685] 步骤间GC完成: RSS ${rssMB}→${rssAfterMB}MB, Heap ${heapMB}→${heapAfterMB}MB, 释放=${rssMB - rssAfterMB}MB`);
          }
        } catch { /* 内存检查失败不影响同步 */ }
      }
    }

    // v757: 主同步完成后，异步执行延迟步骤（不阻塞主流程结果返回）
    if (deferredSteps.length > 0) {
      log.info(`[v757] 开始异步执行${deferredSteps.length}个延迟步骤: ${deferredSteps.map(d => d.step.name).join(', ')}`);
      // 异步执行，不等待完成（fire-and-forget）
      (async () => {
        for (const { step: deferredStep } of deferredSteps) {
          try {
            log.info(`[v757] 异步执行延迟步骤: ${deferredStep.name} | 账户${account.accountId}`);
            const DEFERRED_TIMEOUT_MS = 70 * 60 * 1000; // 70分钟超时
            const deferredTimeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(`DEFERRED_TIMEOUT: 延迟步骤${deferredStep.name}超时(70分钟)`)), DEFERRED_TIMEOUT_MS);
            });
            const deferredResult = await Promise.race([
              deferredStep.execute(syncService, context),
              deferredTimeoutPromise,
            ]);
            const deferredSynced = typeof deferredResult.synced === 'number' ? deferredResult.synced : 0;
            if (deferredResult.success) {
              log.info(`[v757] 延迟步骤完成: ${deferredStep.name} | 同步${deferredSynced}条 | 账户${account.accountId}`);
            } else {
              log.warn(`[v757] 延迟步骤失败: ${deferredStep.name} | 错误: ${deferredResult.errors.join(', ')} | 账户${account.accountId}`);
            }
            // 更新步骤结果（覆盖之前的占位符）
            result.stepResults[deferredStep.id] = deferredResult;
          } catch (deferredErr: unknown) {
            log.error(`[v757] 延迟步骤异常: ${deferredStep.name} | ${(deferredErr as Error).message} | 账户${account.accountId}`);
            result.stepResults[deferredStep.id] = { success: false, synced: 0, errors: [(deferredErr as Error).message], details: { deferred: true, timedOut: true } };
          }
        }
        log.info(`[v757] 所有延迟步骤已完成 | 账户${account.accountId}`);
      })().catch(err => {
        log.error(`[v757] 延迟步骤执行器异常: ${err.message}`);
      });
    }

    // v689: 同步完成后汇总失败分类统计
    if (result.failedSteps > 0) {
      const failureCategoryCounts: Record<string, number> = {};
      const failureCategorySteps: Record<string, string[]> = {};
      for (const [stepId, stepRes] of Object.entries(result.stepResults)) {
        if (!stepRes.success && stepRes.details?.failureCategory) {
          const cat = stepRes.details.failureCategory as string;
          failureCategoryCounts[cat] = (failureCategoryCounts[cat] || 0) + 1;
          if (!failureCategorySteps[cat]) failureCategorySteps[cat] = [];
          failureCategorySteps[cat].push(stepId);
        }
      }
      const categoryBreakdown = Object.entries(failureCategoryCounts)
        .map(([cat, count]) => `${FAILURE_CATEGORY_LABELS[cat as SyncFailureCategory] || cat}=${count}次(步骤:${failureCategorySteps[cat].join(',')})`);
      logSyncWarn('UnifiedSync', `v689: 账户${account.accountId}同步失败汇总`, {
        accountId: account.accountId,
        accountName: account.accountName,
        marketplace: account.marketplace,
        tier,
        totalFailed: result.failedSteps,
        totalCompleted: result.completedSteps,
        totalSkipped: result.skippedSteps,
        failureCategoryCounts,
        failureCategorySteps,
        categoryBreakdown: categoryBreakdown.join(' | '),
      });
      log.warn(`[UnifiedSync] v689: 账户${account.accountId}(${account.accountName}) ${tier}层同步失败汇总: ${categoryBreakdown.join(' | ')} | 完成=${result.completedSteps}, 失败=${result.failedSteps}, 跳过=${result.skippedSteps}`);
    }

    // v738: 修夌lastSyncAt更新逻辑 — 绩效数据失败时不更新lastSyncAt
    // 原问题：无论同步是否成功都更新lastSyncAt，导致优化引擎误以为数据是最新的
    // 修复：检查绩效数据步骤(performance_today/performance_7d/performance_95d)是否成功
    //        只有绩效数据步骤成功时才更新lastSyncAt
    try {
      // v738: 检查绩效数据步骤是否成功
      const performanceStepIds = ['performance_today', 'performance_7d', 'performance_95d'];
      const performanceStepsExecuted = performanceStepIds.filter(id => result.stepResults[id]);
      const performanceStepsSucceeded = performanceStepsExecuted.filter(id => result.stepResults[id]?.success);
      const hasPerformanceData = performanceStepsSucceeded.length > 0;
      
      // v738: 只有绩效数据步骤成功时才更新lastSyncAt
      // 如果绩效数据步骤全部失败/跳过，不更新lastSyncAt，让优化引擎能感知数据过时
      const shouldUpdateLastSync = hasPerformanceData || performanceStepsExecuted.length === 0;
      
      const syncStatus = result.success ? 'idle' : (result.failedSteps > 0 ? 'error' : 'idle');
      const updatePayload: Record<string, unknown> = {
        syncStatus,
        syncErrorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : null,
      };
      
      if (shouldUpdateLastSync) {
        updatePayload.lastSyncAt = new Date().toISOString();
      } else {
        // v738: 绩效数据失败，不更新lastSyncAt，记录警告
        log.warn(`[UnifiedSync] v738: 账户${account.accountId} 绩效数据步骤全部失败(${performanceStepsExecuted.join(',')})，不更新lastSyncAt，保留旧值以触发优化引擎数据断路器`);
        updatePayload.syncErrorMessage = `v738: 绩效数据同步失败(步骤:${performanceStepsExecuted.join(',')})，lastSyncAt未更新; ${result.errors.slice(0, 2).join('; ')}`;
      }
      
      await db.updateAmazonApiCredentials(account.accountId, updatePayload);
      
      if (!shouldUpdateLastSync) {
        log.info(`[UnifiedSync] v738: 账户${account.accountId} lastSyncAt未更新 | 绩效步骤执行=${performanceStepsExecuted.length}, 成功=${performanceStepsSucceeded.length}`);
      }
    } catch (e: unknown) {
      log.warn(`[UnifiedSync] 更新账户 ${account.accountId} 同步状态失败: ${(e as Error).message}`);
    }

    // v641: 三态成功判定 — 完全成功 / 部分成功 / 失败
    // 完全成功: 所有步骤都成功，无失败无跳过
    // 部分成功: 有步骤成功但有步骤被跳过(超时/中断)，不再伪装为“成功”
    // 失败: 所有步骤都失败或无步骤完成
    if (result.failedSteps === 0 && result.skippedSteps === 0) {
      result.success = true;
      result.partialSuccess = false;
    } else if (result.completedSteps > 0 && result.skippedSteps > 0) {
      // v641: 有步骤完成但有步骤被跳过 — 标记为“部分成功”而非“成功”
      result.success = false;
      result.partialSuccess = true;
      log.warn(`[UnifiedSync] v641: 账户${account.accountId} 同步部分成功: 完成=${result.completedSteps}, 失败=${result.failedSteps}, 跳过=${result.skippedSteps}, 总步骤=${result.totalSteps}`);
    } else {
      result.success = result.failedSteps === 0;
      result.partialSuccess = false;
    }

    // v663: 断点续传 — 同步完全成功时清除检查点，失败/部分成功时保留检查点供下次续传
    if (result.success) {
      try {
        await clearSyncCheckpoint(account.accountId, tier);
      } catch (cpErr: unknown) {
        log.debug(`[v663] 清除检查点失败(不影响结果): ${(cpErr as Error).message}`);
      }
    }

    // v340: 同步健康监控告警 - 当同步完成但总记录数为0时触发告警
    // v652: R-4修复 — 增强空账户诊断，区分“真空账户”和“API异常”
    if (result.totalSynced === 0 && result.totalSteps > 0) {
      // v652: 分析步骤结果，诊断空数据的根因
      const stepDetails = Object.entries(result.stepResults);
      const allStepsZero = stepDetails.every(([, r]) => (r as { synced?: number }).synced === 0);
      const hasAuthErrors = result.errors.some(e => /401|403|unauthorized|forbidden|token.*expired/i.test(e));
      const hasRateErrors = result.errors.some(e => /429|throttl|rate.*limit/i.test(e));
      const hasTimeoutErrors = result.errors.some(e => /timeout|ETIMEDOUT|ECONNRESET/i.test(e));
      
      let diagnosisType: string;
      let diagnosisDetail: string;
      if (hasAuthErrors) {
        diagnosisType = 'AUTH_FAILURE';
        diagnosisDetail = `凭证失效: 请检查账户${account.accountId}的API凭证是否过期或被撤销`;
      } else if (hasRateErrors) {
        diagnosisType = 'RATE_LIMITED';
        diagnosisDetail = `API限流: 账户${account.accountId}被Amazon API限流，建议降低同步频率`;
      } else if (hasTimeoutErrors) {
        diagnosisType = 'NETWORK_TIMEOUT';
        diagnosisDetail = `网络超时: 账户${account.accountId}的API请求超时，可能是网络问题或Amazon服务器繁忙`;
      } else if (allStepsZero && result.failedSteps === 0) {
        diagnosisType = 'TRULY_EMPTY';
        diagnosisDetail = `真空账户: 账户${account.accountId}的所有步骤返回0条记录且无错误，可能是新账户或无广告活动`;
      } else {
        diagnosisType = 'UNKNOWN_ZERO';
        diagnosisDetail = `未知原因: 账户${account.accountId}同步0条记录，失败步骤=${result.failedSteps}，需要人工排查`;
      }
      
      const alertMsg = `⚠️ 账户${account.accountId}(${account.accountName}) ${tier}层同步完成但总记录数为0 [${diagnosisType}] ${diagnosisDetail} | 步骤=${result.totalSteps}, 失败=${result.failedSteps}, 错误=${result.errors.slice(0, 3).join('; ')}`;
      
      // v653: 空账户诊断去重 — TRULY_EMPTY连续相同时降级为debug，每10次输出一次汇总
      // 解决v652验证报告4.1：11个TRULY_EMPTY账户每30分钟输出11条warn导致缓冲区溢出
      let shouldLogWarn = true;
      let shouldLogOps = true;
      let shouldWriteDb = true;
      
      if (diagnosisType === 'TRULY_EMPTY') {
        const cached = emptyAccountDiagCache.get(account.accountId);
        if (cached && cached.diagnosisType === 'TRULY_EMPTY') {
          cached.count++;
          // 连续相同诊断：降级为debug日志，不写opsLogger，不写DB
          shouldLogWarn = false;
          shouldLogOps = false;
          shouldWriteDb = false;
          // 每DIAG_DEDUP_LOG_INTERVAL次输出一次汇总
          if (cached.count % DIAG_DEDUP_LOG_INTERVAL === 0) {
            const ageMins = Math.round((Date.now() - cached.firstSeen.getTime()) / 60000);
            log.info(`[UnifiedSync] v653: 账户${account.accountId}(${account.accountName}) 已连续${cached.count}次诊断为TRULY_EMPTY（距首次发现${ageMins}分钟），已降级日志`);
          }
        } else {
          // v744: 首次检测或诊断类型变化 — 检查缓存中是否已有从 DB 恢复的状态
          // 修复 v743-fix2 发现的问题：启动时 restoreEmptyAccountBackoffState 成功恢复了 count=3/backoffLevel=1，
          // 但第一次同步时这里的 else 分支会用 count=1/backoffLevel=0 覆盖掉恢复的状态
          const existingCached = emptyAccountDiagCache.get(account.accountId);
          if (existingCached && existingCached.diagnosisType === 'TRULY_EMPTY' && existingCached.count >= 3) {
            // 已有从 DB 恢复的有效退避状态，保留并递增 count
            existingCached.count++;
            log.info(`[UnifiedSync] v744: 账户${account.accountId} 已有恢复的退避状态(count=${existingCached.count}, backoffLevel=${existingCached.backoffLevel})，保留而非重置`);
          } else {
            // 真正的首次检测：设置初始状态
            emptyAccountDiagCache.set(account.accountId, { diagnosisType: 'TRULY_EMPTY', count: 1, firstSeen: new Date(), backoffLevel: 0, lastSyncAttempt: new Date() });
          }
          // v743: 首次检测到TRULY_EMPTY时持久化
          persistEmptyAccountBackoffState(account.accountId).catch(() => {});
        }
      } else {
        // 非TRULY_EMPTY诊断：清除缓存（账户状态变化）
        emptyAccountDiagCache.delete(account.accountId);
        // v743: 同时清除DB中的退避状态
        (async () => {
          try {
            const database = await db.getDb();
            if (database) {
              await database.execute(sql`UPDATE ad_accounts SET emptyAccountBackoff = NULL WHERE id = ${account.accountId}`);
            }
          } catch { /* 清除失败不影响同步 */ }
        })();
      }
      
      // v474: confirmation层同步0条是常见的(无待确认的出价更新)，降级为WARN
      if (tier === 'confirmation') {
        log.warn(`[UnifiedSync] v474: ${tier}层同步0条记录(正常): ${alertMsg}`);
      } else if (shouldLogWarn) {
        log.warn(`[UnifiedSync] 🚨 v652同步健康告警[${diagnosisType}]: ${alertMsg}`);
      }
      if (shouldLogOps) {
        logSyncWarn('UnifiedSync', alertMsg, {
          accountId: account.accountId,
          accountName: account.accountName,
          marketplace: account.marketplace,
          tier,
          diagnosisType,  // v652: 新增诊断类型
          diagnosisDetail,  // v652: 新增诊断详情
          totalSteps: result.totalSteps,
          completedSteps: result.completedSteps,
          failedSteps: result.failedSteps,
          errors: result.errors,
        });
      }
      // 异步写入告警日志到数据库
      if (shouldWriteDb) {
        try {
          const database = await db.getDb();
          if (database) {
            // v347: 全参数化INSERT，避免drizzle sql模板中字面量的潜在问题
            const alertType = `SYNC_ZERO_RECORDS_${diagnosisType}`;  // v652: 告警类型包含诊断结果
            const alertSeverity = diagnosisType === 'TRULY_EMPTY' ? 'info' : 'critical';  // v652: 真空账户降级为info
            const alertMessage = JSON.stringify({
              alertMessage: alertMsg,
              tier,
              diagnosisType,  // v652
              diagnosisDetail,  // v652
              totalSteps: result.totalSteps,
              failedSteps: result.failedSteps,
              errors: result.errors.slice(0, 5),
              stepResults: Object.entries(result.stepResults).map(([id, r]) => ({ id, success: (r as { success?: boolean }).success, synced: (r as { synced?: number }).synced })),
            });
            await database.execute(sql`
              INSERT INTO anomaly_alert_logs (accountId, anomalyType, detectedValue, actionTaken, createdAt)
              VALUES (${account.accountId}, ${alertType}, ${alertSeverity}, ${alertMessage}, NOW())
            `);
          }
        } catch (alertDbErr: unknown) {
          log.warn(`[UnifiedSync] 同步健康告警写入DB失败: ${(alertDbErr as Error).message}`);
        }
      }
    }

  } catch (error: unknown) {
    result.errors.push(`同步初始化失败: ${(error as Error).message}`);
    log.warn(`[UnifiedSync] 账户 ${account.accountId} 同步初始化失败: ${(error as Error).message}`);
  } finally {
    // 清理
    activeSyncs.delete(lockKey);
    activeSyncContexts.delete(lockKey); // v665: 清理活跃同步上下文引用
    // v684: 清理预取会话，释放报告数据内存
    try {
      const { cleanupPrefetchSession } = await import('./prefetchReportScheduler');
      cleanupPrefetchSession(account.accountId);
    } catch (_e) { /* 清理失败不影响结果 */ }
    // v221: 只清理当前层级的条目，不影响其他层级的并行同步
    engineStatus.currentlyRunning = engineStatus.currentlyRunning.filter(
      r => !(r.accountId === account.accountId && r.tier === tier)
    );

    result.endTime = new Date();
    result.durationMs = result.endTime.getTime() - result.startTime.getTime();

    // v426: P3-3 同步数据校验摘要日志
    const durationSec = (result.durationMs / 1000).toFixed(1);
    const stepSummary = Object.entries(result.stepResults)
      // @ts-ignore - v652: stepResults entry type
      .map(([step, r]: [string, unknown]) => `${step}:${r.synced ?? r.result ?? '?'}`)
      .join(', ');
    const errorSummary = result.errors.length > 0 ? ` | 错误: ${result.errors.slice(0, 3).join('; ')}` : '';
    // v641: 三态状态显示
    const statusEmoji = result.success ? '✅成功' : (result.partialSuccess ? '⚠️部分成功' : '❌失败');
    log.info(
      `[v641-SyncSummary] 账户=${account.accountId}(${account.accountName}) ` +
      `层级=${tier} 状态=${statusEmoji} ` +
      `耗时=${durationSec}s 步骤=${result.completedSteps}/${result.totalSteps} ` +
      `同步数=${result.totalSynced} 失败=${result.failedSteps} 跳过=${result.skippedSteps}` +
      `${errorSummary} | 明细: ${stepSummary}`
    );

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
 * v352: 智能账户交错排序
 * 同一品牌（userId）的不同站点账户分散到不同批次，避免共享API凭证的账户同时发起请求
 * 
 * 例如：输入 [ElaraFit-US, ElaraFit-CA, ElaraFit-MX, LERUCCI-US, LERUCCI-CA, LERUCCI-MX]
 * 输出 [ElaraFit-US, LERUCCI-US, ElaraFit-CA, LERUCCI-CA, ElaraFit-MX, LERUCCI-MX]
 */
function interleaveAccountsByUser(accounts: SyncableAccount[]): SyncableAccount[] {
  if (accounts.length <= 1) return accounts;
  
  // 按userId分组
  const groups = new Map<number, SyncableAccount[]>();
  for (const account of (accounts as unknown[])) {
    // @ts-ignore - v652: userId type
    const userId = account.userId;
    if (!groups.has(userId)) groups.set(userId, []);
    // @ts-ignore - v652: Map.get non-null
    groups.get(userId)!.push(account);
  }
  
  // 交错合并：每轮从每个组取一个
  const result: SyncableAccount[] = [];
  const groupArrays = Array.from(groups.values());
  const maxLen = Math.max(...groupArrays.map(g => g.length));
  
  for (let i = 0; i < maxLen; i++) {
    for (const group of groupArrays) {
      if (i < group.length) {
        result.push(group[i]);
      }
    }
  }
  
  return result;
}

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

  // v681: 设置消费者优先级为自动同步
  try {
    const { setActiveConsumerPriority, refreshConsumerPriorityHeartbeat } = await import('../services/apiRateLimitService');
    setActiveConsumerPriority('auto_sync');
  } catch { /* 优先级设置失败不影响同步 */ }

  // 自动发现所有可同步账户
  const allAccounts = await discoverSyncableAccounts();
  batchResult.totalAccounts = allAccounts.length;

  if (allAccounts.length === 0) {
    log.info('[UnifiedSync] 没有发现可同步的账户');
    batchResult.endTime = new Date();
    batchResult.durationMs = batchResult.endTime.getTime() - startTime.getTime();
    return batchResult;
  }

  // v373: 同步优先级调度 - 为每个账号计算优先级评分，滚动窗口模式
  let accounts = allAccounts;
  try {
    const { calculateAccountPriorities, getMaxAccountsForTier } = await import('../services/syncPriorityScheduler');
    const prioritized = await calculateAccountPriorities(
      // @ts-ignore - v652: priority extension
      allAccounts.map(a => ({ ...a, priorityScore: 0, priorityReasons: [] }))
    );
    const maxAccounts = getMaxAccountsForTier(tier);
    if (prioritized.length > maxAccounts) {
      // v523: 新账号保障机制 — 从未同步过的账号必须包含在本周期中，不受 maxAccounts 截断
      const topAccounts = prioritized.slice(0, maxAccounts) as typeof allAccounts;
      const topAccountIds = new Set(topAccounts.map(a => a.accountId));
      const neverSyncedMissing = prioritized.slice(maxAccounts).filter(
        (a: any) => !a.lastSyncAt && !topAccountIds.has(a.accountId)
      ) as typeof allAccounts;
      if (neverSyncedMissing.length > 0) {
        log.warn(`[UnifiedSync] [v523] 新账号保障: ${neverSyncedMissing.length}个从未同步的账号被强制加入本周期: ${neverSyncedMissing.map(a => a.accountId).join(', ')}`);
        accounts = [...topAccounts, ...neverSyncedMissing];
      } else {
        accounts = topAccounts;
      }
      log.info(`[UnifiedSync] [v373] 优先级调度: ${allAccounts.length}个账号中选取${accounts.length}个进行${tier}层同步`);
      log.info(`[UnifiedSync] [v373] 跳过的${prioritized.length - accounts.length}个低优先级账号将在下一周期同步`);
    } else {
      accounts = prioritized as typeof allAccounts;
      log.info(`[UnifiedSync] [v373] 优先级调度: 全部${accounts.length}个账号参与${tier}层同步`);
    }
  } catch (priErr: any) {
    log.warn(`[UnifiedSync] [v373] 优先级调度失败，使用默认顺序: ${(priErr as Error).message}`);
  }

  // v659: 长跑赛制 — 严格串行 + 错峰排序
  // 核心原则：同一时间只有1个账户在同步，确保每个账户获得100%的API资源和内存
  // 排序策略：空/小账户先跑（快速完成释放资源），大账户后跑（独占资源充分执行）
  
  // v659: 同步前内存检查
  try {
    const { checkMemoryPressure } = await import('./syncCoordinator');
    const memPressure = checkMemoryPressure();
    if (memPressure.shouldForceGC && typeof global.gc === 'function') {
      global.gc();
      log.info(`[UnifiedSync] v659: 同步前触发GC (RSS=${memPressure.rssMB}MB)`);
    }
    if (memPressure.shouldPauseSyncs) {
      log.warn(`[UnifiedSync] v659: 内存危急(RSS=${memPressure.rssMB}MB)，跳过本轮同步`);
      return batchResult;
    }
    log.info(`[UnifiedSync] v659: 内存状态 level=${memPressure.level}, RSS=${memPressure.rssMB}MB`);
  } catch {
    // 内存检查失败不阻止同步
  }

  // v659: 错峰排序 — 按账户大小排序（小→大），空账户最先
  // 查询每个账户的广告活动数量用于排序
  const accountSizes = new Map<number, number>();
  try {
    const database = await db.getDb();
    if (database) {
      const { campaigns: campaignsTable } = await import('../../drizzle/schema');
      for (const acct of accounts) {
        try {
          const countResult = await database
            .select({ count: sql<number>`COUNT(*)` })
            .from(campaignsTable)
            .where(eq(campaignsTable.accountId, acct.accountId));
          // @ts-ignore - drizzle count result
          const count = countResult?.[0]?.count || 0;
          accountSizes.set(acct.accountId, count);
        } catch {
          accountSizes.set(acct.accountId, 0);
        }
      }
    }
  } catch {
    // 查询失败使用默认排序
  }

  // 排序：空账户(0) → 小账户(<100) → 中账户(100-1000) → 大账户(>1000)
  const sortedAccounts = [...accounts].sort((a, b) => {
    const sizeA = accountSizes.get(a.accountId) || 0;
    const sizeB = accountSizes.get(b.accountId) || 0;
    return sizeA - sizeB;
  });

  log.info(`[UnifiedSync] v659: 长跑赛制启动 — ${sortedAccounts.length}个账户严格串行同步`);
  log.info(`[UnifiedSync] v659: 错峰排序: ${sortedAccounts.map(a => `${a.accountId}(${accountSizes.get(a.accountId) || 0}活动)`).join(' → ')}`);

  // v659: 严格串行执行 — 一个接一个，绝不并行
  for (let idx = 0; idx < sortedAccounts.length; idx++) {
    const account = sortedAccounts[idx];
    const acctSize = accountSizes.get(account.accountId) || 0;
    const sizeLabel = acctSize === 0 ? '空' : acctSize < 100 ? '小' : acctSize < 1000 ? '中' : '大';
    
    log.info(`[UnifiedSync] v659: [${idx + 1}/${sortedAccounts.length}] 开始同步 ${account.accountId}(${account.accountName}) ${account.marketplace} — ${sizeLabel}账户(${acctSize}活动)`);
    
    // v683: 获取账户级同步锁 — 确保同一账户不会被手动和自动同步同时处理
    try {
      const { acquireAccountLock, updateTierProgress } = await import('./syncCoordinator');
      const lockAcquired = acquireAccountLock(account.accountId, `auto_${tier}`, tier, acctSize >= 100);
      if (!lockAcquired) {
        log.info(`[UnifiedSync] v683: 账户${account.accountId}已被锁定（可能正在手动同步），跳过`);
        batchResult.skippedAccounts++;
        continue;
      }
      updateTierProgress(tier, sortedAccounts.length, idx, account.accountId);
    } catch (lockErr: any) {
      log.debug(`[UnifiedSync] v683: 获取账户锁失败: ${(lockErr as Error).message}`);
    }
    
    // v741: per-account 智能冷却期 — 大账户使用更长的冷却期（默认48h），普通账户保持24h
    // 核心原则: 大账户全量同步耗时长且资源消耗大，延长冷却期可显著降低系统负载
    // 大账户的数据新鲜度由 high/medium 层增量同步保障
    if (tier === 'full' || tier === 'nightly') {
      try {
        const database = await db.getDb();
        if (database) {
          // v741: 根据账户大小动态调整冷却期
          let cooldownHours = 24; // 默认24小时
          try {
            const { getConfig } = await import('../services/systemConfigService');
            const largeAccountThreshold = getConfig('execution.large_account_campaign_threshold') as number;
            const largeAccountCooldown = getConfig('execution.large_account_full_sync_cooldown_hours') as number;
            if (acctSize >= largeAccountThreshold) {
              cooldownHours = largeAccountCooldown;
            }
          } catch { /* 配置读取失败使用默认值 */ }
          
          const lastFullSync = await database.execute(
            sql`SELECT MAX(completedAt) as lastCompleted
                FROM data_sync_jobs
                WHERE accountId = ${account.accountId}
                AND syncType = 'all'
                AND status = 'completed'
                AND completedAt >= DATE_SUB(NOW(), INTERVAL ${cooldownHours} HOUR)`
          );
          // @ts-ignore - drizzle result
          const rows = Array.isArray(lastFullSync) ? lastFullSync[0] : (lastFullSync?.rows || lastFullSync);
          // @ts-ignore - drizzle result
          const lastCompleted = rows?.[0]?.lastCompleted || (Array.isArray(rows) ? rows[0]?.lastCompleted : null);
          if (lastCompleted) {
            const hoursSince = (Date.now() - new Date(lastCompleted).getTime()) / (1000 * 60 * 60);
            const isLarge = acctSize >= 200;
            log.info(`[UnifiedSync] v741: 账户${account.accountId}${isLarge ? '(大账户)' : ''} 上次全量同步在 ${hoursSince.toFixed(1)}小时前，冷却期${cooldownHours}h内，跳过`);
            logSync('UnifiedSync', `v741: 账户${account.accountId}全量同步冷却期跳过`, {
              accountId: account.accountId, hoursSince: hoursSince.toFixed(1), tier,
              cooldownHours, isLargeAccount: isLarge, campaignCount: acctSize,
            });
            batchResult.skippedAccounts++;
            continue;
          }
        }
      } catch (cooldownErr: any) {
        // 冷却期检查失败不阻止同步继续
        log.debug(`[UnifiedSync] v741: 账户${account.accountId}冷却期检查失败: ${(cooldownErr as Error).message}`);
      }
    }
    
    // v741: 大账户 high/medium 层智能冷却期
    // 大账户(>200活动)在 high 层每30分钟触发一次同步太频繁，浪费资源
    // 对大账户实施 per-account 冷却期（默认2小时），避免重复同步
    if ((tier === 'high' || tier === 'medium') && acctSize > 0) {
      try {
        const { getConfig } = await import('../services/systemConfigService');
        const largeAccountThreshold = getConfig('execution.large_account_campaign_threshold') as number;
        const highSyncCooldownHours = getConfig('execution.large_account_high_sync_cooldown_hours') as number;
        
        if (acctSize >= largeAccountThreshold) {
          const database = await db.getDb();
          if (database) {
            const lastSync = await database.execute(
              sql`SELECT MAX(completedAt) as lastCompleted
                  FROM data_sync_jobs
                  WHERE accountId = ${account.accountId}
                  AND status = 'completed'
                  AND completedAt >= DATE_SUB(NOW(), INTERVAL ${highSyncCooldownHours} HOUR)`
            );
            // @ts-ignore - drizzle result
            const rows = Array.isArray(lastSync) ? lastSync[0] : (lastSync?.rows || lastSync);
            // @ts-ignore - drizzle result
            const lastCompleted = rows?.[0]?.lastCompleted || (Array.isArray(rows) ? rows[0]?.lastCompleted : null);
            if (lastCompleted) {
              const hoursSince = (Date.now() - new Date(lastCompleted).getTime()) / (1000 * 60 * 60);
              log.info(`[UnifiedSync] v741: 大账户${account.accountId}(${acctSize}活动) ${tier}层上次同步在${hoursSince.toFixed(1)}h前，冷却期${highSyncCooldownHours}h内，跳过`);
              logSync('UnifiedSync', `v741: 大账户${account.accountId} ${tier}层冷却期跳过`, {
                accountId: account.accountId, tier, campaignCount: acctSize,
                hoursSince: hoursSince.toFixed(1), cooldownHours: highSyncCooldownHours,
              });
              batchResult.skippedAccounts++;
              // 释放账户锁
              try {
                const { releaseAccountLock } = await import('./syncCoordinator');
                releaseAccountLock(account.accountId, `auto_${tier}`);
              } catch { /* ignore */ }
              continue;
            }
          }
        }
      } catch (largeCooldownErr: any) {
        log.debug(`[UnifiedSync] v741: 大账户${tier}层冷却期检查失败: ${(largeCooldownErr as Error).message}`);
      }
    }
    
    // v741: 真空账户(TRULY_EMPTY)指数退避策略（替代v687的固定冷却期）
    // 覆盖所有层级（包括full/nightly），彻底消除空站点的无效重试和超时浪费
    // 退避策略：baseCooldown * 2^backoffLevel，从6h逐步升级到最大168h（7天）
    // 当账户重新出现广告活动时（非TRULY_EMPTY诊断），缓存自动清除，恢复正常同步频率
    {
      const emptyDiag = emptyAccountDiagCache.get(account.accountId);
      if (emptyDiag && emptyDiag.diagnosisType === 'TRULY_EMPTY') {
        try {
          const { getConfig } = await import('../services/systemConfigService');
          const minDiagCount = getConfig('execution.empty_account_min_diag_count') as number;
          const baseCooldownHours = getConfig('execution.empty_account_cooldown_hours') as number;
          const maxBackoffHours = getConfig('execution.empty_account_max_backoff_hours') as number;
          
          if (emptyDiag.count >= minDiagCount) {
            // v741: 指数退避计算 — cooldown = baseCooldown * 2^backoffLevel，上限为maxBackoffHours
            const backoffLevel = emptyDiag.backoffLevel || 0;
            const effectiveCooldownHours = Math.min(baseCooldownHours * Math.pow(2, backoffLevel), maxBackoffHours);
            const effectiveCooldownMs = effectiveCooldownHours * 60 * 60 * 1000;
            const timeSinceLastSync = Date.now() - emptyDiag.lastSyncAttempt.getTime();
            const hoursSinceLastSync = timeSinceLastSync / (1000 * 60 * 60);
            
            if (timeSinceLastSync < effectiveCooldownMs) {
              // 仍在退避冷却期内，跳过同步
              log.info(`[UnifiedSync] v741: 空站点指数退避 — 账户${account.accountId}(${account.accountName}) 连续${emptyDiag.count}次TRULY_EMPTY，退避等级=${backoffLevel}，${tier}层跳过(冷却${effectiveCooldownHours.toFixed(0)}h，已过${hoursSinceLastSync.toFixed(1)}h)`);
              logSync('UnifiedSync', `v741: 空站点${account.accountId}指数退避跳过`, {
                accountId: account.accountId, tier, diagCount: emptyDiag.count,
                backoffLevel, effectiveCooldownHours: effectiveCooldownHours.toFixed(0),
                hoursSinceLastSync: hoursSinceLastSync.toFixed(1),
              });
              batchResult.skippedAccounts++;
              // 释放账户锁
              try {
                const { releaseAccountLock } = await import('./syncCoordinator');
                releaseAccountLock(account.accountId, `auto_${tier}`);
              } catch { /* ignore */ }
              continue;
            } else {
              // 冷却期已过，执行一次同步检查，并提升退避等级
              emptyDiag.backoffLevel = backoffLevel + 1;
              emptyDiag.lastSyncAttempt = new Date();
              const nextCooldownHours = Math.min(baseCooldownHours * Math.pow(2, emptyDiag.backoffLevel), maxBackoffHours);
              log.info(`[UnifiedSync] v741: 空站点${account.accountId}退避冷却期(${effectiveCooldownHours.toFixed(0)}h)已过，执行检查同步，退避等级提升${backoffLevel}→${emptyDiag.backoffLevel}，下次冷却${nextCooldownHours.toFixed(0)}h`);
              // v743: 持久化退避状态到DB，确保重启后不丢失
              persistEmptyAccountBackoffState(account.accountId).catch(() => {});
            }
          }
        } catch (emptyCheckErr: any) {
          // 配置读取失败不阻止同步
          log.debug(`[UnifiedSync] v741: 空站点退避检查失败: ${(emptyCheckErr as Error).message}`);
        }
      }
    }
    
    // v659: 每个账户同步前检查内存
    try {
      const { checkMemoryPressure } = await import('./syncCoordinator');
      const memCheck = checkMemoryPressure();
      if (memCheck.shouldPauseSyncs) {
        log.warn(`[UnifiedSync] v659: 内存危急(RSS=${memCheck.rssMB}MB)，中断剩余${sortedAccounts.length - idx}个账户同步`);
        // 标记剩余账户为跳过
        for (let j = idx; j < sortedAccounts.length; j++) {
          batchResult.skippedAccounts++;
        }
        break;
      }
      if (memCheck.level === 'high') {
        log.warn(`[UnifiedSync] v659: 内存偏高(RSS=${memCheck.rssMB}MB)，暂停120秒等待GC...`);
        if (typeof global.gc === 'function') global.gc();
        await sleep(120000);
        // GC后再检查一次
        const memCheck2 = checkMemoryPressure();
        if (memCheck2.shouldPauseSyncs) {
          log.warn(`[UnifiedSync] v659: GC后内存仍然危急(RSS=${memCheck2.rssMB}MB)，中断同步`);
          for (let j = idx; j < sortedAccounts.length; j++) {
            batchResult.skippedAccounts++;
          }
          break;
        }
      }
    } catch {
      // 内存检查失败不阻止同步
    }
    
    // v743-fix2: 账户级并发保护 — 检查该账户是否已有running状态的任务
    // 防止断路器/多路径同时触发导致同一账户创建重复任务
    try {
      const database = await db.getDb();
      if (database) {
        const runningCheck = await database.execute(
          sql`SELECT id FROM data_sync_jobs WHERE accountId = ${account.accountId} AND status = 'running' AND updated_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE) LIMIT 1`
        );
        // @ts-ignore - drizzle result
        const runningRows = Array.isArray(runningCheck) ? runningCheck[0] : (runningCheck?.rows || runningCheck);
        // @ts-ignore - drizzle result
        if (runningRows && runningRows.length > 0) {
          // @ts-ignore - drizzle result
          log.debug(`[UnifiedSync] v743-fix2: 账户${account.accountId}已有running任务Job#${runningRows[0].id}，跳过`);
          batchResult.skippedAccounts++;
          continue;
        }
      }
    } catch { /* 检查失败不阻止同步 */ }

    // v651: 自动同步也创建running状态的data_sync_jobs记录
    let autoSyncJobId: number | null = null;
    try {
      const database = await db.getDb();
      if (database) {
        const { dataSyncJobs } = await import('../../drizzle/schema');
        const insertResult = await database.insert(dataSyncJobs).values({
          userId: account.userId || 390001,
          accountId: account.accountId,
          syncType: tier === 'high' ? 'campaigns' : tier === 'medium' ? 'targeting' : 'all',
          status: 'running',
          startedAt: sql`NOW()`,
          currentStep: 'initializing',
          totalSteps: 0,
          currentStepIndex: 0,
          progressPercent: 0,
        });
        autoSyncJobId = insertResult[0]?.insertId || null;
        log.debug(`[UnifiedSync] v659: 自动同步创建Job#${autoSyncJobId} 账户${account.accountId}`);
      }
    } catch (jobCreateErr: any) {
      log.debug(`[UnifiedSync] v659: 创建自动同步Job失败: ${(jobCreateErr as Error).message}`);
    }
    
    // v651: 为自动同步创建onProgress回调
    // v671: 同时通过WebSocket广播进度更新
    const autoSyncOnProgress = async (step: string, index: number, total: number) => {
      const progressPercent = Math.round(((index + 1) / total) * 100);
      // v671: WebSocket实时推送
      try {
        const { broadcastSyncProgress } = await import('./syncProgressWs');
        broadcastSyncProgress(account.accountId, {
          step, stepIndex: index, totalSteps: total, progressPercent, status: 'running',
        });
      } catch (_wsErr) { /* WebSocket广播失败不影响同步 */ }
      if (autoSyncJobId) {
        try {
          const database = await db.getDb();
          if (database) {
            const { dataSyncJobs } = await import('../../drizzle/schema');
            await database.update(dataSyncJobs)
              .set({ currentStep: step, currentStepIndex: index, totalSteps: total, progressPercent })
              .where(eq(dataSyncJobs.id, autoSyncJobId));
          }
        } catch (e: any) {
          // 心跳更新失败不影响同步继续
        }
      }
    };
    
    const accountResult = await syncAccount(account, tier, { onProgress: autoSyncOnProgress });
    
    // v651: 更新自动同步Job的最终状态
    if (autoSyncJobId) {
      try {
        const database = await db.getDb();
        if (database) {
          const { dataSyncJobs } = await import('../../drizzle/schema');
          await database.update(dataSyncJobs)
            .set({
              status: accountResult.success ? 'completed' : (accountResult.partialSuccess ? 'completed' : 'failed'),
              completedAt: sql`NOW()`,
              durationMs: accountResult.durationMs,
              errorMessage: accountResult.errors.length > 0 ? accountResult.errors.slice(0, 3).join('; ') : null,
              progressPercent: 100,
              recordsSynced: typeof accountResult.totalSynced === 'number' ? accountResult.totalSynced : 0,
            })
            .where(eq(dataSyncJobs.id, autoSyncJobId));
        }
      } catch (jobUpdateErr: any) {
        log.debug(`[UnifiedSync] v659: 更新自动同步Job#${autoSyncJobId}最终状态失败: ${(jobUpdateErr as Error).message}`);
      }
    }
    // v683: 释放账户级同步锁 — 单个账户同步完成即释放，不阻塞其他账户
    try {
      const { releaseAccountLock } = await import('./syncCoordinator');
      releaseAccountLock(account.accountId, `auto_${tier}`);
    } catch (relErr: any) {
      log.debug(`[UnifiedSync] v683: 释放账户锁失败: ${(relErr as Error).message}`);
    }
    
    // v671: WebSocket广播同步完成/失败状态
    try {
      const { broadcastSyncCompleted, broadcastSyncFailed } = await import('./syncProgressWs');
      if (accountResult.success || accountResult.partialSuccess) {
        broadcastSyncCompleted(account.accountId, {
          recordsSynced: typeof accountResult.totalSynced === 'number' ? accountResult.totalSynced : 0,
          progressPercent: 100,
        });
      } else {
        broadcastSyncFailed(account.accountId, {
          errorMessage: accountResult.errors.slice(0, 3).join('; '),
        });
      }
    } catch (_wsErr) { /* WebSocket广播失败不影响流程 */ }
    
    // 统计结果
    batchResult.accountResults.push(accountResult);
    if (accountResult.success) {
      batchResult.successfulAccounts++;
    } else if (accountResult.errors.some(e => 
      (e.includes('已有') && e.includes('在运行')) ||
      e.includes('层同步在运行') ||
      e.includes('层正在运行') ||
      e.includes('层跳过') ||
      e.includes('层跟过') ||
      e.includes('智能跳过') ||
      e.includes('等下一轮')
    )) {
      batchResult.skippedAccounts++;
    } else {
      batchResult.failedAccounts++;
    }
    
    // v683: 优化账户间延迟 — 账户级锁已防止冲突，大幅缩短延迟时间
    // v683改进：从原来的1-5分钟缩短到10-60秒，总耗时从2-3小时降至30-60分钟
    if (idx < sortedAccounts.length - 1) {
      let delayMs: number;
      let delayReason: string;
      
      const hasThrottle = accountResult.errors.some(e => 
        e.includes('429') || e.includes('TooManyRequests') || e.includes('throttl') || e.includes('限流')
      );
      const hasFailed = !accountResult.success && !accountResult.partialSuccess;
      
      // v683: 延迟策略优化 — 保留API退避但大幅缩短正常间隔
      if (hasThrottle) {
        delayMs = 60000; // v683: 限流→等待60秒（从5分钟缩短，账户级锁已防止并发冲突）
        delayReason = 'API限流退避(60s)';
      } else if (hasFailed) {
        delayMs = 30000; // v683: 失败→等待30秒（从2分钟缩短）
        delayReason = '失败后冷却(30s)';
      } else {
        delayMs = 10000; // v683: 成功→等待10秒（从1分钟缩短，账户锁已保证互斥）
        delayReason = '正常间隔(10s)';
      }
      
      // 内存压力额外延迟
      try {
        const { checkMemoryPressure } = await import('./syncCoordinator');
        const memCheck = checkMemoryPressure();
        if (memCheck.level === 'elevated') {
          delayMs = Math.max(delayMs, 30000); // v683: 内存偏高时至少等待30秒（从60s缩短）
          delayReason += '+内存偏高(30s)';
          if (typeof global.gc === 'function') global.gc();
        }
      } catch {
        // 内存检查失败不影响
      }
      
      log.info(`[UnifiedSync] v683: 账户间延迟 ${delayMs}ms (${delayReason}) — 下一个: ${sortedAccounts[idx + 1].accountId}`);
      await sleep(delayMs);
    }
  }

  // v220: 通知速率控制器同步周期完成，尝试恢复速率
  rateController.onSyncCycleComplete();

  batchResult.endTime = new Date();
  batchResult.durationMs = batchResult.endTime.getTime() - startTime.getTime();
  engineStatus.lastSyncTime[tier] = batchResult.endTime;

  // v222: 记录同步日志（安全数字提取，防止[object Object]拼接）
  const totalSynced = batchResult.accountResults.reduce((sum: unknown, r: unknown) => {
    // @ts-ignore - v652: totalSynced type
    const synced = typeof r.totalSynced === 'number' ? r.totalSynced : 0;
    return sum + synced;
  }, 0);
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

  // v443: high层同步完成后自动检测僵尸账户
  if (tier === 'high') {
    try {
      const { detectAndPauseZombieAccounts } = await import('./infrastructure/zombieAccountDetector');
      const zombieResult = await detectAndPauseZombieAccounts();
      if (zombieResult.pausedAccounts > 0) {
        log.warn(`[UnifiedSync] [v443] 僵尸账户检测: 自动暂停${zombieResult.pausedAccounts}个无数据账户`);
      }
    } catch (zombieErr: unknown) {
      log.warn(`[UnifiedSync] [v443] 僵尸账户检测失败: ${(zombieErr as Error).message}`);
    }
  }

  // v681: 清除自动同步消费者优先级
  try {
    const { setActiveConsumerPriority } = await import('../services/apiRateLimitService');
    setActiveConsumerPriority(null);
  } catch { /* 优先级清除失败不影响结果 */ }

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

  // v380: 移除固定3秒等待，CommandConfirmationService已提供自适应传播延迟机制
  // 保留最小1秒等待确保API请求已提交
  await sleep(1000);

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
  // v222: 安全提取数字值，防止[object Object]写入数据库
  const safeNum = (val: Record<string, unknown>): number => {
    if (typeof val === 'number' && !isNaN(val)) return val;
    if (typeof val === 'object' && val !== null) {
      // 尝试从对象中提取数字值并求和
      // @ts-ignore - v652: reduce accumulator type
      return Object.values(val).reduce((s: number, v: Record<string, unknown>) => s + (typeof v === 'number' ? v : 0), 0) as number;
    }
    return 0;
  };

  try {
    const database = await db.getDb();
    if (!database) return;

    const { dataSyncJobs } = await import('../../drizzle/schema');

    for (const accountResult of batchResult.accountResults) {
      if (accountResult.errors.some(e => 
        (e.includes('已有') && e.includes('在运行')) ||
        e.includes('层同步在运行') ||
        e.includes('层正在运行') ||
        e.includes('层跳过') ||
        e.includes('层跟过') ||
        e.includes('智能跳过') ||
        e.includes('等下一轮')
      )) {
        continue; // v248: 跳过层冲突导致的跳过，不记录为failed
      }

      // v370: 跳过totalSteps为0的空同步记录（避免0/0步骤的无效记录）
      if (accountResult.totalSteps === 0 && Object.keys(accountResult.stepResults).length === 0) {
        continue;
      }

      try {
        // @ts-ignore - Drizzle query builder type
        await database.insert(dataSyncJobs).values({
          userId: accountResult.userId || 390001, // v336: 使用账户关联的userId，而不是硬编码的1
          accountId: accountResult.accountId,
          syncType: batchResult.tier === 'high' ? 'campaigns' : batchResult.tier === 'medium' ? 'targeting' : 'all',
          status: accountResult.success ? 'completed' : 'failed',
          startedAt: sql`DATE_SUB(NOW(), INTERVAL ${Math.max(Math.round((accountResult.durationMs || 0) / 1000), 0)} SECOND)`,
          completedAt: sql`NOW()`,
          durationMs: accountResult.durationMs,
          errorMessage: accountResult.errors.length > 0 ? accountResult.errors.slice(0, 3).join('; ') : null,
          // @ts-ignore - runtime type mismatch
          spCampaigns: safeNum(accountResult.stepResults['sp_campaigns']?.synced),
          // @ts-ignore - runtime type mismatch
          sbCampaigns: safeNum(accountResult.stepResults['sb_campaigns']?.synced),
          // @ts-ignore - runtime type mismatch
          sdCampaigns: safeNum(accountResult.stepResults['sd_campaigns']?.synced),
          // @ts-ignore - runtime type mismatch
          adGroupsSynced: safeNum(accountResult.stepResults['sp_ad_groups']?.synced) +
            // @ts-ignore - runtime type mismatch
            safeNum(accountResult.stepResults['sb_ad_groups']?.synced) +
            // @ts-ignore - runtime type mismatch
            safeNum(accountResult.stepResults['sd_ad_groups']?.synced),
          // @ts-ignore - runtime type mismatch
          keywordsSynced: safeNum(accountResult.stepResults['sp_keywords']?.synced) +
            // @ts-ignore - runtime type mismatch
            safeNum(accountResult.stepResults['sb_keywords']?.synced),
          // @ts-ignore - runtime type mismatch
          targetsSynced: safeNum(accountResult.stepResults['sp_product_targets']?.synced) +
            // @ts-ignore - runtime type mismatch
            safeNum(accountResult.stepResults['sb_product_targets']?.synced) +
            // @ts-ignore - runtime type mismatch
            safeNum(accountResult.stepResults['sd_product_targets']?.synced),
          // @ts-ignore - runtime type mismatch
          performanceSynced: safeNum(accountResult.stepResults['performance_today']?.synced) +
            // @ts-ignore - runtime type mismatch
            safeNum(accountResult.stepResults['performance_7d']?.synced) +
            // @ts-ignore - runtime type mismatch
            safeNum(accountResult.stepResults['performance_95d']?.synced),
          // v256: 修复 recordsSynced 字段映射 — 计算所有步骤的同步记录总数
          recordsSynced: Object.values(accountResult.stepResults).reduce(
            // @ts-ignore - v652: step synced type
            (total: number, step: unknown) => total + safeNum(step?.synced), 0
          ),
          // v364: 修复同步任务步骤计数缺失 - 添加totalSteps和currentStepIndex
          totalSteps: accountResult.totalSteps || Object.keys(accountResult.stepResults).length,
          currentStepIndex: accountResult.totalSteps || Object.keys(accountResult.stepResults).length,
          currentStep: accountResult.success ? '完成' : '失败',
          progressPercent: accountResult.success ? 100 : Math.round(
            // @ts-ignore - v652: stepResults filter type
            (Object.values(accountResult.stepResults).filter((s: unknown) => s?.success).length / 
             Math.max(Object.keys(accountResult.stepResults).length, 1)) * 100
          ),
        } as Record<string, unknown>);
      } catch (insertErr: unknown) {
        log.warn(`[UnifiedSync] 记录账户 ${accountResult.accountId} 同步结果失败: ${(insertErr as Error).message}`);
      }
    }
  } catch (error: unknown) {
    log.warn(`[UnifiedSync] 记录批量同步结果失败: ${(error as Error).message}`);
  }
}

/**
 * 手动触发单账户完整同步（供前端调用）
 * v404: 重构 - 手动全量同步执行所有步骤（包括nightly层级），并支持jobId进度更新
 */
export async function triggerManualFullSync(
  accountId: number,
  onProgress?: (step: string, index: number, total: number) => void,
  options?: {
    jobId?: number;  // v404: 传入jobId用于更新data_sync_jobs进度
    userId?: number; // v404: 传入userId用于审计
  }
): Promise<AccountSyncResult | null> {
  const accounts = await discoverSyncableAccounts();
  const account = accounts.find(a => a.accountId === accountId);

  if (!account) {
    log.warn(`[UnifiedSync] 手动同步: 账户 ${accountId} 不可用`);
    return null;
  }

  // v404: 手动全量同步执行ALL步骤（包括nightly层级的keyword_performance等）
  // 使用full层级 + 显式包含nightly步骤
  const allSteps = SYNC_STEPS.map(s => s.id); // 所有步骤ID
  const fullSteps = getStepsForTier('full').map(s => s.id);
  const nightlySteps = getStepsForTier('nightly').map(s => s.id);
  const combinedStepIds = [...new Set([...fullSteps, ...nightlySteps])];
  // 按SYNC_STEPS原始顺序排列
  const orderedStepIds = allSteps.filter(id => combinedStepIds.includes(id));

  // v404: 包装onProgress以同时更新data_sync_jobs
  const wrappedOnProgress = async (step: string, index: number, total: number) => {
    // 调用原始回调
    if (onProgress) {
      onProgress(step, index, total);
    }
    const progressPercent = Math.round(((index + 1) / total) * 100);
    // v684: 先更新内存缓存（即时生效，前端轮询立即可见）
    if (options?.jobId) {
      try {
        const { cacheUpdateSyncProgress } = await import('./syncStatusCache');
        cacheUpdateSyncProgress(options.jobId, {
          currentStep: step,
          totalSteps: total,
          currentStepIndex: index,
          progressPercent,
        });
      } catch (_e) { /* 缓存更新失败不影响主流程 */ }
    }
    // 更新data_sync_jobs进度（数据库持久化）
    if (options?.jobId) {
      try {
        const { updateSyncJob } = await import('../db/syncJobs');
        await updateSyncJob(options.jobId, {
          currentStep: step,
          totalSteps: total,
          currentStepIndex: index,
          progressPercent,
        });
      } catch (e: unknown) {
        log.debug(`[UnifiedSync] v404: 更新手动同步进度失败: ${(e as Error).message}`);
      }
    }
  };

  log.info(`[UnifiedSync] v404: 手动全量同步账户 ${accountId}，执行 ${orderedStepIds.length} 个步骤（含nightly层级）`);

  // v679.4: 激活手动同步覆盖 — 通知自动同步调度器暂停
  // 解决问题：手动全量同步与自动同步同时运行导致API配额竞争和严重429限流
  const { setManualOverride, acquireAccountLock, releaseAccountLock } = await import('./syncCoordinator');
  setManualOverride(true);
  log.info(`[UnifiedSync] v679.4: 手动同步覆盖已激活，自动同步将被暂停`);

  // v683: 统一锁路径 — 手动同步也使用账户级锁，确保与自动同步互斥
  // 手动同步可以抢占自动同步的锁（acquireAccountLock内部处理优先级）
  const manualLockAcquired = acquireAccountLock(accountId, 'manual', 'full', true);
  if (!manualLockAcquired) {
    log.warn(`[UnifiedSync] v683: 手动同步账户${accountId}获取锁失败（可能有另一个手动同步在运行）`);
    // 仍然继续执行，因为手动同步应该始终允许执行
  }
  log.info(`[UnifiedSync] v683: 手动同步账户${accountId}已获取账户级锁`);

  // v681: 设置消费者优先级为手动同步（最高优先级）
  const { setActiveConsumerPriority } = await import('../services/apiRateLimitService');
  setActiveConsumerPriority('manual_sync');

  let result: AccountSyncResult | null = null;
  try {
  // v406: 使用full层级+isManual标记，确保手动同步不会被自动同步阻塞
  result = await syncAccount(account, 'full', {
    specificSteps: orderedStepIds,
    onProgress: wrappedOnProgress,
    isManual: true,
  });
  } finally {
    // v683: 释放账户级锁
    releaseAccountLock(accountId, 'manual');
    // v679.4: 无论同步成功或失败，都取消手动同步覆盖
    setManualOverride(false);
    // v681: 清除消费者优先级，恢复正常配额分配
    setActiveConsumerPriority(null);
    log.info(`[UnifiedSync] v683: 手动同步账户${accountId}锁已释放，覆盖已取消，优先级已清除`);
  }

  // v404: 同步完成后更新data_sync_jobs最终状态
  if (options?.jobId && result) {
    // v684: 先更新内存缓存的最终状态
    try {
      const { cacheUpdateSyncProgress } = await import('./syncStatusCache');
      cacheUpdateSyncProgress(options.jobId, {
        status: result.success ? 'completed' : (result.partialSuccess ? 'completed' : 'failed'),
        recordsSynced: result.totalSynced,
        durationMs: result.durationMs,
        currentStep: result.success ? '完成' : '失败',
        totalSteps: result.totalSteps,
        currentStepIndex: result.totalSteps,
        progressPercent: result.success ? 100 : Math.round(
          (result.completedSteps / Math.max(result.totalSteps, 1)) * 100
        ),
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : undefined,
      });
    } catch (_e) { /* 缓存更新失败不影响主流程 */ }
    try {
      const { updateSyncJob } = await import('../db/syncJobs');
      const safeNum = (v: unknown) => (typeof v === 'number' && !isNaN(v) ? v : 0);
      await updateSyncJob(options.jobId, {
        status: result.success || result.partialSuccess ? 'completed' : 'failed',
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : undefined,
        durationMs: result.durationMs,
        recordsSynced: result.totalSynced,
        spCampaigns: safeNum(result.stepResults['sp_campaigns']?.synced),
        sbCampaigns: safeNum(result.stepResults['sb_campaigns']?.synced),
        sdCampaigns: safeNum(result.stepResults['sd_campaigns']?.synced),
        adGroupsSynced: safeNum(result.stepResults['sp_ad_groups']?.synced) +
          safeNum(result.stepResults['sb_ad_groups']?.synced) +
          safeNum(result.stepResults['sd_ad_groups']?.synced),
        keywordsSynced: safeNum(result.stepResults['sp_keywords']?.synced) +
          safeNum(result.stepResults['sb_keywords']?.synced),
        targetsSynced: safeNum(result.stepResults['sp_product_targets']?.synced) +
          safeNum(result.stepResults['sb_product_targets']?.synced) +
          safeNum(result.stepResults['sd_product_targets']?.synced),
        totalSteps: result.totalSteps,
        currentStepIndex: result.totalSteps,
        currentStep: result.success ? '完成' : '失败',
        progressPercent: result.success ? 100 : Math.round(
          (result.completedSteps / Math.max(result.totalSteps, 1)) * 100
        ),
      });
    } catch (e: unknown) {
      log.warn(`[UnifiedSync] v404: 更新手动同步最终状态失败: ${(e as Error).message}`);
    }
  }

  return result;
}

/**
 * 检查账户是否正在同步
 */
export function isAccountSyncing(accountId: number): boolean {
  // v221: 检查该账户是否有任何层级的同步在运行
  return Array.from(activeSyncs.keys()).some(key => key.startsWith(`${accountId}:`));
}

/**
 * 获取账户当前同步状态
 */
export function getAccountSyncStatus(accountId: number): { tier: SyncTier; startTime: Date } | null {
  // v221: 查找该账户任何层级的活跃同步
  for (const [key, value] of activeSyncs.entries()) {
    if (key.startsWith(`${accountId}:`)) {
      return value;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 导出 ====================
export { SYNC_STEPS, TIER_HIERARCHY, MAX_CONCURRENT_ACCOUNTS };

/**
 * v776: 生产运维断点续跑入口。
 *
 * 与 triggerManualFullSync 明确分离：该方法只用于从 sync_checkpoints_v2 中恢复 full 层断点，
 * 不设置 isManual=true，确保 syncAccount 能加载 checkpoint 并跳过已完成步骤。
 */
export async function triggerCheckpointResumeSync(
  accountId: number,
  options?: {
    jobId?: number;
    onProgress?: (step: string, index: number, total: number) => void | Promise<void>;
  }
): Promise<{ resumed: boolean; checkpoint: SyncCheckpointData | null; result: AccountSyncResult | null; error?: string }> {
  const startTime = Date.now();
  const checkpoint = await loadSyncCheckpoint(accountId, 'full');

  if (!checkpoint) {
    log.warn(`[UnifiedSync] v776: checkpoint resume 未找到有效断点，账户 ${accountId}`);
    if (options?.jobId) {
      try {
        const { updateSyncJob } = await import('../db/syncJobs');
        await updateSyncJob(options.jobId, {
          status: 'failed',
          currentStep: '未找到有效断点',
          progressPercent: 0,
          durationMs: Date.now() - startTime,
          errorMessage: 'no_checkpoint',
        });
      } catch (e: unknown) {
        log.warn(`[UnifiedSync] v776: checkpoint resume 更新无断点任务失败: ${(e as Error).message}`);
      }
    }
    return { resumed: false, checkpoint: null, result: null, error: 'no_checkpoint' };
  }

  const accounts = await discoverSyncableAccounts();
  const account = accounts.find(a => a.accountId === accountId);
  if (!account) {
    log.warn(`[UnifiedSync] v776: checkpoint resume 账户不可用，账户 ${accountId}`);
    if (options?.jobId) {
      try {
        const { updateSyncJob } = await import('../db/syncJobs');
        await updateSyncJob(options.jobId, {
          status: 'failed',
          currentStep: '账户不可用',
          progressPercent: 0,
          durationMs: Date.now() - startTime,
          errorMessage: 'account_not_found_or_unavailable',
        });
      } catch (e: unknown) {
        log.warn(`[UnifiedSync] v776: checkpoint resume 更新账户不可用任务失败: ${(e as Error).message}`);
      }
    }
    return { resumed: false, checkpoint, result: null, error: 'account_not_found_or_unavailable' };
  }

  const wrappedOnProgress = async (step: string, index: number, total: number) => {
    if (options?.onProgress) {
      await options.onProgress(step, index, total);
    }
    if (options?.jobId) {
      const progressPercent = Math.round(((index + 1) / Math.max(total, 1)) * 100);
      try {
        const { cacheUpdateSyncProgress } = await import('./syncStatusCache');
        cacheUpdateSyncProgress(options.jobId, {
          status: 'running',
          currentStep: step,
          totalSteps: total,
          currentStepIndex: index,
          progressPercent,
        });
      } catch (_e) { /* 缓存更新失败不影响续跑 */ }
      try {
        const { updateSyncJob } = await import('../db/syncJobs');
        await updateSyncJob(options.jobId, {
          status: 'running',
          currentStep: step,
          totalSteps: total,
          currentStepIndex: index,
          progressPercent,
        });
      } catch (e: unknown) {
        log.debug(`[UnifiedSync] v776: checkpoint resume 更新进度失败: ${(e as Error).message}`);
      }
    }
  };

  const recovery = buildRecoveryStrategy(checkpoint);
  log.info(`[UnifiedSync] v776: checkpoint resume 开始，账户 ${accountId}，${recovery.resumeInfo}`);

  let result: AccountSyncResult | null = null;
  try {
    result = await syncAccount(account, 'full', {
      onProgress: wrappedOnProgress,
      isManual: false,
      checkpointResume: true,
    });

    if (result.success || result.partialSuccess) {
      await clearSyncCheckpoint(accountId, 'full');
    }

    if (options?.jobId) {
      const { updateSyncJob } = await import('../db/syncJobs');
      const safeNum = (v: unknown) => (typeof v === 'number' && !isNaN(v) ? v : 0);
      await updateSyncJob(options.jobId, {
        status: result.success || result.partialSuccess ? 'completed' : 'failed',
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : undefined,
        durationMs: result.durationMs || (Date.now() - startTime),
        recordsSynced: result.totalSynced,
        spCampaigns: safeNum(result.stepResults?.['sp_campaigns']?.synced),
        sbCampaigns: safeNum(result.stepResults?.['sb_campaigns']?.synced),
        sdCampaigns: safeNum(result.stepResults?.['sd_campaigns']?.synced),
        adGroupsSynced: safeNum(result.stepResults?.['sp_ad_groups']?.synced) +
          safeNum(result.stepResults?.['sb_ad_groups']?.synced) +
          safeNum(result.stepResults?.['sd_ad_groups']?.synced),
        keywordsSynced: safeNum(result.stepResults?.['sp_keywords']?.synced) +
          safeNum(result.stepResults?.['sb_keywords']?.synced),
        targetsSynced: safeNum(result.stepResults?.['sp_product_targets']?.synced) +
          safeNum(result.stepResults?.['sb_product_targets']?.synced) +
          safeNum(result.stepResults?.['sd_product_targets']?.synced),
        totalSteps: result.totalSteps,
        currentStepIndex: result.totalSteps,
        currentStep: result.success || result.partialSuccess ? '完成' : '失败',
        progressPercent: result.success || result.partialSuccess ? 100 : Math.round(
          (result.completedSteps / Math.max(result.totalSteps, 1)) * 100
        ),
      });
    }

    log.info(`[UnifiedSync] v776: checkpoint resume 完成，账户 ${accountId}，成功=${result.success}，部分成功=${result.partialSuccess}，记录=${result.totalSynced}`);
    return { resumed: true, checkpoint, result };
  } catch (error: unknown) {
    const message = (error as Error).message;
    log.error(`[UnifiedSync] v776: checkpoint resume 异常，账户 ${accountId}: ${message}`);
    if (options?.jobId) {
      try {
        const { updateSyncJob } = await import('../db/syncJobs');
        await updateSyncJob(options.jobId, {
          status: 'failed',
          currentStep: '断点续跑异常',
          durationMs: Date.now() - startTime,
          errorMessage: message,
        });
      } catch (updateErr: unknown) {
        log.warn(`[UnifiedSync] v776: checkpoint resume 异常后更新任务失败: ${(updateErr as Error).message}`);
      }
    }
    return { resumed: true, checkpoint, result, error: message };
  }
}

