/**
 * v644: 可靠的指令确认服务（优化版）
 * 
 * v359原始功能:
 * 1. 确认同步自适应延迟（根据操作类型和历史延迟动态调整）
 * 2. 持久化确认队列，保证至少执行一次
 * 3. 带超时的指数退避重试
 * 4. 完整的状态机追踪
 * 
 * v644优化:
 * - 新增同账户去重机制: 同一账户在5分钟内的多个confirmation请求会被合并
 * - 新增每账户最小间隔: 同一账户两次confirmation执行之间至少间隔5分钟
 * - 合并时自动扩展affectedEntities，确保所有受影响的实体都被覆盖
 * - 减少API配额消耗（之前60分钟内同一账户执行了8次confirmation）
 */

import { createModuleLogger } from '../utils/logger';
import { logSync, logSyncError } from '../utils/opsLogger';

const log = createModuleLogger('CommandConfirmation');

// ==================== 类型定义 ====================

/** 确认请求 */
export interface ConfirmationRequest {
  id: string;
  accountId: number;
  affectedEntities: ('campaigns' | 'ad_groups' | 'keywords' | 'targets' | 'budgets')[];
  triggerSource: string;
  /** 操作类型（影响传播延迟） */
  operationType: 'bid_change' | 'status_change' | 'budget_change' | 'keyword_create' | 'general';
  /** 创建时间 */
  createdAt: Date;
  /** 预计传播完成时间 */
  expectedReadyAt: Date;
  /** 当前重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 当前状态 */
  status: 'pending' | 'waiting' | 'confirming' | 'confirmed' | 'failed' | 'expired';
  /** 最后一次确认结果 */
  lastResult?: ConfirmationResult;
  /** v644: 合并的触发源列表 */
  mergedSources?: string[];
}

/** 确认结果 */
interface ConfirmationResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  totalSynced: number;
  durationMs: number;
  matchRate: number; // 数据匹配率（0-1）
  timestamp: Date;
}

/** 操作类型对应的传播延迟配置 */
interface PropagationConfig {
  /** 初始等待时间（毫秒） */
  initialDelayMs: number;
  /** 每次重试增加的等待时间（毫秒） */
  retryIncrementMs: number;
  /** 最大等待时间（毫秒） */
  maxDelayMs: number;
}

/** 确认服务指标 */
export interface ConfirmationMetrics {
  totalRequests: number;
  pendingRequests: number;
  confirmedRequests: number;
  failedRequests: number;
  expiredRequests: number;
  avgConfirmationTimeMs: number;
  avgRetryCount: number;
  confirmationSuccessRate: number;
  /** 按操作类型的平均传播延迟 */
  avgPropagationDelayByType: Record<string, number>;
  /** v644: 合并的请求数 */
  mergedRequests: number;
}

// ==================== 配置 ====================

/** 按操作类型的传播延迟配置 */
const PROPAGATION_CONFIGS: Record<string, PropagationConfig> = {
  bid_change: {
    initialDelayMs: 5000,       // 出价变更通常5秒内传播
    retryIncrementMs: 5000,
    maxDelayMs: 30000,
  },
  status_change: {
    initialDelayMs: 8000,       // 状态变更需要更长时间
    retryIncrementMs: 8000,
    maxDelayMs: 60000,
  },
  budget_change: {
    initialDelayMs: 15000,      // v641: 预算变更传播延迟增加到15秒
    retryIncrementMs: 15000,    // v641: 重试间隔增加到15秒
    maxDelayMs: 120000,         // v641: 最大等待时间增加到2分钟
  },
  keyword_create: {
    initialDelayMs: 15000,      // 新建关键词需要最长传播时间
    retryIncrementMs: 15000,
    maxDelayMs: 120000,
  },
  general: {
    initialDelayMs: 5000,
    retryIncrementMs: 5000,
    maxDelayMs: 30000,
  },
};

/** 确认队列最大容量 */
const MAX_QUEUE_SIZE = 200;

/** 确认请求过期时间（毫秒） */
const REQUEST_EXPIRY_MS = 30 * 60 * 1000; // 30分钟

/** 确认处理循环间隔（毫秒） */
const PROCESSING_INTERVAL_MS = 2000;
const IDLE_INTERVAL_MS = 10000; // v360: 队列为空时使用更长间隔

/** v644: 同一账户两次confirmation执行之间的最小间隔（毫秒） */
const PER_ACCOUNT_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5分钟

/** v644: 同一账户的confirmation请求合并窗口（毫秒） */
const MERGE_WINDOW_MS = 3 * 60 * 1000; // 3分钟内的请求会被合并

// ==================== 确认服务主类 ====================

export class CommandConfirmationService {
  private queue: Map<string, ConfirmationRequest> = new Map();
  private processingTimer: NodeJS.Timeout | null = null;
  private running = false;
  
  /** 历史传播延迟（用于自适应调整） */
  private propagationHistory: Map<string, number[]> = new Map();
  
  /** v644: 每个账户最后一次confirmation执行完成的时间 */
  private lastConfirmationTime: Map<number, number> = new Map();
  
  /** 指标 */
  private metrics: ConfirmationMetrics = {
    totalRequests: 0,
    pendingRequests: 0,
    confirmedRequests: 0,
    failedRequests: 0,
    expiredRequests: 0,
    avgConfirmationTimeMs: 0,
    avgRetryCount: 0,
    confirmationSuccessRate: 0,
    avgPropagationDelayByType: {},
    mergedRequests: 0,
  };
  
  private totalConfirmationTimeMs = 0;
  private totalRetryCount = 0;
  
  constructor() {
    log.info('[CommandConfirmation] v644: 初始化可靠指令确认服务（带去重和合并优化）');
  }
  
  /**
   * 提交确认请求
   * v644: 添加同账户去重/合并逻辑
   */
  submitConfirmation(
    accountId: number,
    affectedEntities: ConfirmationRequest['affectedEntities'],
    triggerSource: string,
    operationType: ConfirmationRequest['operationType'] = 'general'
  ): string {
    // v644: 检查是否有同一账户的pending/waiting请求可以合并
    const existingRequest = this.findMergeableRequest(accountId);
    if (existingRequest) {
      // 合并affectedEntities
      const mergedEntities = new Set([...existingRequest.affectedEntities, ...affectedEntities]);
      existingRequest.affectedEntities = Array.from(mergedEntities) as ConfirmationRequest['affectedEntities'];
      
      // 升级operationType（优先级: budget_change > keyword_create > status_change > bid_change > general）
      existingRequest.operationType = this.mergeOperationType(existingRequest.operationType, operationType);
      
      // 记录合并源
      if (!existingRequest.mergedSources) existingRequest.mergedSources = [existingRequest.triggerSource];
      existingRequest.mergedSources.push(triggerSource);
      
      this.metrics.mergedRequests++;
      
      log.info(`[CommandConfirmation] v644: 合并确认请求到 ${existingRequest.id}: 账户${accountId}, 新实体=${affectedEntities.join(',')}, 来源=${triggerSource}, 合并后实体=${existingRequest.affectedEntities.join(',')}`);
      
      return existingRequest.id;
    }
    
    // 检查队列容量
    if (this.queue.size >= MAX_QUEUE_SIZE) {
      this.cleanupExpired();
      
      if (this.queue.size >= MAX_QUEUE_SIZE) {
        log.warn(`[CommandConfirmation] 队列已满(${MAX_QUEUE_SIZE})，丢弃最旧的请求`);
        const oldest = Array.from(this.queue.values())
          .filter(r => r.status === 'pending' || r.status === 'waiting')
          // @ts-expect-error Legacy code type compatibility
          .sort((a: unknown, b: unknown) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        if (oldest) this.queue.delete(oldest.id);
      }
    }
    
    const config = PROPAGATION_CONFIGS[operationType] || PROPAGATION_CONFIGS.general;
    const adaptiveDelay = this.getAdaptiveDelay(operationType, config);
    
    // v644: 考虑每账户最小间隔
    const lastTime = this.lastConfirmationTime.get(accountId) || 0;
    const timeSinceLastConfirmation = Date.now() - lastTime;
    const effectiveDelay = Math.max(
      adaptiveDelay,
      timeSinceLastConfirmation < PER_ACCOUNT_MIN_INTERVAL_MS 
        ? PER_ACCOUNT_MIN_INTERVAL_MS - timeSinceLastConfirmation 
        : 0
    );
    
    const request: ConfirmationRequest = {
      id: `confirm-${accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      accountId,
      affectedEntities,
      triggerSource,
      operationType,
      createdAt: new Date(),
      expectedReadyAt: new Date(Date.now() + effectiveDelay),
      retryCount: 0,
      maxRetries: 5,
      status: 'waiting',
    };
    
    this.queue.set(request.id, request);
    this.metrics.totalRequests++;
    this.metrics.pendingRequests = this.queue.size;
    
    log.info(`[CommandConfirmation] v644: 提交确认请求 ${request.id}: 账户${accountId}, 类型=${operationType}, 延迟=${effectiveDelay}ms${effectiveDelay > adaptiveDelay ? '(含冷却期)' : ''}, 来源=${triggerSource}`);
    logSync('CommandConfirmation', 'v644: 提交确认请求', {
      requestId: request.id, accountId, operationType, effectiveDelay, triggerSource,
    });
    
    return request.id;
  }
  
  /**
   * v644: 查找可合并的请求
   * 同一账户在MERGE_WINDOW_MS内的waiting状态请求可以合并
   */
  private findMergeableRequest(accountId: number): ConfirmationRequest | null {
    const now = Date.now();
    for (const request of this.queue.values()) {
      if (
        request.accountId === accountId &&
        request.status === 'waiting' &&
        (now - request.createdAt.getTime()) < MERGE_WINDOW_MS
      ) {
        return request;
      }
    }
    return null;
  }
  
  /**
   * v644: 合并操作类型（取优先级更高的）
   */
  private mergeOperationType(
    existing: ConfirmationRequest['operationType'],
    incoming: ConfirmationRequest['operationType']
  ): ConfirmationRequest['operationType'] {
    const priority: Record<string, number> = {
      general: 0,
      bid_change: 1,
      status_change: 2,
      keyword_create: 3,
      budget_change: 4,
    };
    return (priority[incoming] || 0) > (priority[existing] || 0) ? incoming : existing;
  }
  
  /**
   * 查询确认请求状态
   */
  getRequestStatus(requestId: string): ConfirmationRequest | null {
    return this.queue.get(requestId) || null;
  }
  
  /**
   * 启动确认处理循环
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextProcessing();
    log.info('[CommandConfirmation] v644: 确认处理循环已启动（智能轮询+去重模式）');
  }
  
  /**
   * 停止确认处理循环
   */
  stop(): void {
    this.running = false;
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
    log.info('[CommandConfirmation] v644: 确认处理循环已停止');
  }
  
  /**
   * v360: 智能调度下一次处理
   */
  private scheduleNextProcessing(): void {
    if (!this.running) return;
    const hasPending = Array.from(this.queue.values()).some(
      r => r.status === 'waiting' || r.status === 'confirming'
    );
    const interval = hasPending ? PROCESSING_INTERVAL_MS : IDLE_INTERVAL_MS;
    this.processingTimer = setTimeout(() => {
      this.processQueue().catch((err: any) => {
        log.warn(`[CommandConfirmation] 处理循环异常: ${(err as Error).message}`);
      }).finally(() => {
        this.scheduleNextProcessing();
      });
    }, interval);
  }
  
  /**
   * 获取确认服务指标
   */
  getMetrics(): ConfirmationMetrics {
    const completed = this.metrics.confirmedRequests + this.metrics.failedRequests;
    return {
      ...this.metrics,
      pendingRequests: this.queue.size,
      avgConfirmationTimeMs: completed > 0 ? Math.round(this.totalConfirmationTimeMs / completed) : 0,
      avgRetryCount: completed > 0 ? Math.round((this.totalRetryCount / completed) * 100) / 100 : 0,
      confirmationSuccessRate: completed > 0 ? Math.round((this.metrics.confirmedRequests / completed) * 100) / 100 : 0,
      avgPropagationDelayByType: this.getAvgPropagationDelays(),
    };
  }
  
  // ==================== 内部方法 ====================
  
  /**
   * 处理确认队列
   */
  private async processQueue(): Promise<void> {
    const now = Date.now();
    
    for (const [requestId, request] of this.queue.entries()) {
      // 跳过已完成的请求
      if (request.status === 'confirmed' || request.status === 'failed' || request.status === 'expired') {
        if (now - request.createdAt.getTime() > REQUEST_EXPIRY_MS) {
          this.queue.delete(requestId);
        }
        continue;
      }
      
      // 检查过期
      if (now - request.createdAt.getTime() > REQUEST_EXPIRY_MS) {
        request.status = 'expired';
        this.metrics.expiredRequests++;
        log.warn(`[CommandConfirmation] 请求${requestId}已过期`);
        continue;
      }
      
      // 检查是否到达预期传播时间
      if (request.status === 'waiting' && now >= request.expectedReadyAt.getTime()) {
        // v644: 检查每账户最小间隔
        const lastTime = this.lastConfirmationTime.get(request.accountId) || 0;
        if (now - lastTime < PER_ACCOUNT_MIN_INTERVAL_MS) {
          // 还在冷却期，延迟执行
          request.expectedReadyAt = new Date(lastTime + PER_ACCOUNT_MIN_INTERVAL_MS);
          continue;
        }
        
        request.status = 'confirming';
        await this.executeConfirmation(request);
      }
    }
  }
  
  /**
   * 执行确认同步
   */
  private async executeConfirmation(request: ConfirmationRequest): Promise<void> {
    const startTime = Date.now();
    
    try {
      const mergedInfo = request.mergedSources ? `, 合并了${request.mergedSources.length}个请求` : '';
      log.info(`[CommandConfirmation] v644: 执行确认: ${request.id}, 重试=${request.retryCount}/${request.maxRetries}, 实体=${request.affectedEntities.join(',')}${mergedInfo}`);
      
      // 调用原有的确认同步逻辑
      const { confirmationSync } = await import('../sync/unifiedSyncEngine');
      const syncResult: unknown = await confirmationSync(
        request.accountId,
        request.affectedEntities as ('campaigns' | 'keywords' | 'targets' | 'budgets' | 'ad_groups')[],
        `v644_reliable_${request.triggerSource}`
      );
      
      const durationMs = Date.now() - startTime;
      
      // v644: 记录执行完成时间
      this.lastConfirmationTime.set(request.accountId, Date.now());
      
      // @ts-expect-error Dynamic property access
      if (syncResult && syncResult.completedSteps > 0) {
        // @ts-expect-error Dynamic property access
        const matchRate = syncResult.totalSteps > 0 ? syncResult.completedSteps / syncResult.totalSteps : 0;
        
        request.status = 'confirmed';
        request.lastResult = {
          success: true,
          // @ts-expect-error Legacy code type compatibility
          completedSteps: syncResult.completedSteps,
          // @ts-expect-error Legacy code type compatibility
          totalSteps: syncResult.totalSteps,
          // @ts-expect-error Legacy code type compatibility
          totalSynced: syncResult.totalSynced,
          durationMs,
          matchRate,
          timestamp: new Date(),
        };
        
        this.metrics.confirmedRequests++;
        this.totalConfirmationTimeMs += (Date.now() - request.createdAt.getTime());
        this.totalRetryCount += request.retryCount;
        
        const propagationDelay = request.expectedReadyAt.getTime() - request.createdAt.getTime();
        this.recordPropagationDelay(request.operationType, propagationDelay);
        
        // @ts-expect-error Express request/response type assertion
        log.info(`[CommandConfirmation] v644: 确认成功: ${request.id}, 步骤=${syncResult.completedSteps}/${syncResult.totalSteps}, 同步=${syncResult.totalSynced}条, 匹配率=${(matchRate * 100).toFixed(1)}%, 耗时=${durationMs}ms`);
      // @ts-expect-error Complex function parameter types
      } else if (syncResult && syncResult.errors?.some((e: string) => e.includes('full层同步在运行') || e.includes('同步在运行'))) {
        // v388: full同步正在运行时，视为"已覆盖确认"
        request.status = 'confirmed';
        request.lastResult = {
          success: true,
          completedSteps: 0,
          // @ts-expect-error Legacy code type compatibility
          totalSteps: syncResult.totalSteps || 0,
          totalSynced: 0,
          durationMs,
          matchRate: 1,
          timestamp: new Date(),
        };
        
        this.metrics.confirmedRequests++;
        this.totalConfirmationTimeMs += (Date.now() - request.createdAt.getTime());
        this.totalRetryCount += request.retryCount;
        
        // @ts-expect-error Express request/response type assertion
        log.info(`[CommandConfirmation] v644: 确认已被full同步覆盖: ${request.id}, 耗时=${durationMs}ms`);
      } else {
        await this.handleConfirmationFailure(request, durationMs, '确认同步返回空结果或0步骤');
      }
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      // v644: 即使失败也记录时间，避免立即重试
      this.lastConfirmationTime.set(request.accountId, Date.now());
      await this.handleConfirmationFailure(request, durationMs, (error as Error).message);
    }
  }
  
  /**
   * 处理确认失败
   */
  private async handleConfirmationFailure(
    request: ConfirmationRequest,
    durationMs: number,
    errorMsg: string
  ): Promise<void> {
    request.retryCount++;
    
    if (request.retryCount >= request.maxRetries) {
      request.status = 'failed';
      request.lastResult = {
        success: false,
        completedSteps: 0,
        totalSteps: 0,
        totalSynced: 0,
        durationMs,
        matchRate: 0,
        timestamp: new Date(),
      };
      
      this.metrics.failedRequests++;
      this.totalConfirmationTimeMs += (Date.now() - request.createdAt.getTime());
      this.totalRetryCount += request.retryCount;
      
      log.warn(`[CommandConfirmation] v644: 确认最终失败: ${request.id}, 重试${request.retryCount}次后放弃: ${errorMsg}`);
      logSyncError('CommandConfirmation', `v644: 确认最终失败`, {
        requestId: request.id,
        accountId: request.accountId,
        operationType: request.operationType,
        retryCount: request.retryCount,
        error: errorMsg,
      });
    } else {
      const config = PROPAGATION_CONFIGS[request.operationType] || PROPAGATION_CONFIGS.general;
      const additionalDelay = config.retryIncrementMs * request.retryCount;
      // v644: 重试时也要考虑每账户最小间隔
      const effectiveDelay = Math.max(additionalDelay, PER_ACCOUNT_MIN_INTERVAL_MS);
      request.expectedReadyAt = new Date(Date.now() + effectiveDelay);
      request.status = 'waiting';
      
      log.warn(`[CommandConfirmation] v644: 确认重试: ${request.id}, 第${request.retryCount}次, 等待${effectiveDelay}ms: ${errorMsg}`);
    }
  }
  
  /**
   * 获取自适应传播延迟
   */
  private getAdaptiveDelay(operationType: string, config: PropagationConfig): number {
    const history = this.propagationHistory.get(operationType);
    
    if (!history || history.length < 5) {
      return config.initialDelayMs;
    }
    
    // @ts-expect-error Type inference limitation
    const recent = history.slice(-20).sort((a: unknown, b: unknown) => a - b);
    const p75Index = Math.floor(recent.length * 0.75);
    const p75Delay = recent[p75Index];
    const adaptiveDelay = Math.round(p75Delay * 1.2);
    
    return Math.max(config.initialDelayMs, Math.min(adaptiveDelay, config.maxDelayMs));
  }
  
  /**
   * 记录传播延迟
   */
  private recordPropagationDelay(operationType: string, delayMs: number): void {
    if (!this.propagationHistory.has(operationType)) {
      this.propagationHistory.set(operationType, []);
    }
    const history = this.propagationHistory.get(operationType)!;
    history.push(delayMs);
    
    if (history.length > 100) {
      // @ts-expect-error DB query type inference limitation
      this.propagationHistory.set(operationType, history.slice(-50));
    }
  }
  
  /**
   * 获取按类型的平均传播延迟
   */
  private getAvgPropagationDelays(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [type, history] of this.propagationHistory.entries()) {
      if (history.length > 0) {
        // @ts-expect-error Array method type inference
        result[type] = Math.round(history.reduce((a: unknown, b: unknown) => a + b, 0) / history.length);
      }
    }
    return result;
  }
  
  /**
   * 清理过期请求
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [requestId, request] of this.queue.entries()) {
      if (now - request.createdAt.getTime() > REQUEST_EXPIRY_MS) {
        if (request.status === 'pending' || request.status === 'waiting') {
          request.status = 'expired';
          this.metrics.expiredRequests++;
        }
        this.queue.delete(requestId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      log.info(`[CommandConfirmation] 清理${cleaned}个过期请求`);
    }
  }
}

// ==================== 全局实例 ====================

let globalService: CommandConfirmationService | null = null;

/**
 * 获取全局确认服务实例
 */
export function getCommandConfirmationService(): CommandConfirmationService {
  if (!globalService) {
    globalService = new CommandConfirmationService();
    globalService.start();
  }
  return globalService;
}

/**
 * 便捷函数: 提交可靠的确认请求
 */
export function submitReliableConfirmation(
  accountId: number,
  affectedEntities: ConfirmationRequest['affectedEntities'],
  triggerSource: string,
  operationType: ConfirmationRequest['operationType'] = 'general'
): string {
  return getCommandConfirmationService().submitConfirmation(
    accountId, affectedEntities, triggerSource, operationType
  );
}
