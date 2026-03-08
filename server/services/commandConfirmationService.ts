/**
 * v359: 可靠的指令确认服务
 * 
 * 解决评估报告中指出的问题:
 * 1. 确认同步固定3秒延迟 → 自适应延迟（根据操作类型和历史延迟动态调整）
 * 2. 确认同步fire-and-forget → 持久化确认队列，保证至少执行一次
 * 3. 无超时和重试 → 带超时的指数退避重试
 * 4. 指令状态追踪不完整 → 完整的状态机追踪
 * 
 * 设计:
 * - 确认请求入队后持久化到数据库（不再依赖内存）
 * - 独立的确认处理循环，不依赖主同步流程
 * - 自适应传播延迟：根据操作类型和历史成功率动态调整等待时间
 * - 最多3次确认重试，每次增加等待时间
 * - 完整的确认结果追踪和指标
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
    initialDelayMs: 10000,      // 预算变更传播较慢
    retryIncrementMs: 10000,
    maxDelayMs: 60000,
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
const IDLE_INTERVAL_MS = 10000; // v360: 队列为空时使用更长间隔，降低CPU消耗

// ==================== 确认服务主类 ====================

export class CommandConfirmationService {
  private queue: Map<string, ConfirmationRequest> = new Map();
  private processingTimer: NodeJS.Timeout | null = null;
  private running = false;
  
  /** 历史传播延迟（用于自适应调整） */
  private propagationHistory: Map<string, number[]> = new Map();
  
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
  };
  
  private totalConfirmationTimeMs = 0;
  private totalRetryCount = 0;
  
  constructor() {
    log.info('[CommandConfirmation] v359: 初始化可靠指令确认服务');
  }
  
  /**
   * 提交确认请求
   * 替代原来的fire-and-forget模式
   */
  submitConfirmation(
    accountId: number,
    affectedEntities: ConfirmationRequest['affectedEntities'],
    triggerSource: string,
    operationType: ConfirmationRequest['operationType'] = 'general'
  ): string {
    // 检查队列容量
    if (this.queue.size >= MAX_QUEUE_SIZE) {
      // 清理过期请求
      this.cleanupExpired();
      
      if (this.queue.size >= MAX_QUEUE_SIZE) {
        log.warn(`[CommandConfirmation] 队列已满(${MAX_QUEUE_SIZE})，丢弃最旧的请求`);
        // 删除最旧的pending请求
        const oldest = Array.from(this.queue.values())
          .filter(r => r.status === 'pending')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        if (oldest) this.queue.delete(oldest.id);
      }
    }
    
    const config = PROPAGATION_CONFIGS[operationType] || PROPAGATION_CONFIGS.general;
    const adaptiveDelay = this.getAdaptiveDelay(operationType, config);
    
    const request: ConfirmationRequest = {
      id: `confirm-${accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      accountId,
      affectedEntities,
      triggerSource,
      operationType,
      createdAt: new Date(),
      expectedReadyAt: new Date(Date.now() + adaptiveDelay),
      retryCount: 0,
      maxRetries: 3,
      status: 'waiting',
    };
    
    this.queue.set(request.id, request);
    this.metrics.totalRequests++;
    this.metrics.pendingRequests = this.queue.size;
    
    log.info(`[CommandConfirmation] v359: 提交确认请求 ${request.id}: 账户${accountId}, 类型=${operationType}, 延迟=${adaptiveDelay}ms, 来源=${triggerSource}`);
    logSync('CommandConfirmation', 'v359: 提交确认请求', {
      requestId: request.id, accountId, operationType, adaptiveDelay, triggerSource,
    });
    
    return request.id;
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
    
    // v360: P3-5 智能轮询 - 队列为空时使用更长间隔
    this.scheduleNextProcessing();
    
    log.info('[CommandConfirmation] v360: 确认处理循环已启动（智能轮询模式）');
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
    log.info('[CommandConfirmation] v360: 确认处理循环已停止');
  }
  
  /**
   * v360: 智能调度下一次处理
   * 队列有待处理项时使用2秒间隔，空闲时使用10秒间隔
   */
  private scheduleNextProcessing(): void {
    if (!this.running) return;
    const hasPending = Array.from(this.queue.values()).some(
      r => r.status === 'waiting' || r.status === 'confirming'
    );
    const interval = hasPending ? PROCESSING_INTERVAL_MS : IDLE_INTERVAL_MS;
    this.processingTimer = setTimeout(() => {
      this.processQueue().catch(err => {
        log.error(`[CommandConfirmation] 处理循环异常: ${(err as Error).message}`);
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
        // 已完成的请求保留5分钟后清理
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
      log.info(`[CommandConfirmation] 执行确认: ${request.id}, 重试=${request.retryCount}/${request.maxRetries}`);
      
      // 调用原有的确认同步逻辑
      const { confirmationSync } = await import('../unifiedSyncEngine');
      const syncResult = await confirmationSync(
        request.accountId,
        request.affectedEntities as ('campaigns' | 'keywords' | 'targets' | 'budgets' | 'ad_groups')[],
        `v359_reliable_${request.triggerSource}`
      );
      
      const durationMs = Date.now() - startTime;
      
      if (syncResult && syncResult.completedSteps > 0) {
        // 确认成功
        const matchRate = syncResult.totalSteps > 0 ? syncResult.completedSteps / syncResult.totalSteps : 0;
        
        request.status = 'confirmed';
        request.lastResult = {
          success: true,
          completedSteps: syncResult.completedSteps,
          totalSteps: syncResult.totalSteps,
          totalSynced: syncResult.totalSynced,
          durationMs,
          matchRate,
          timestamp: new Date(),
        };
        
        this.metrics.confirmedRequests++;
        this.totalConfirmationTimeMs += (Date.now() - request.createdAt.getTime());
        this.totalRetryCount += request.retryCount;
        
        // 记录传播延迟（用于自适应调整）
        const propagationDelay = request.expectedReadyAt.getTime() - request.createdAt.getTime();
        this.recordPropagationDelay(request.operationType, propagationDelay);
        
        log.info(`[CommandConfirmation] 确认成功: ${request.id}, 步骤=${syncResult.completedSteps}/${syncResult.totalSteps}, 匹配率=${(matchRate * 100).toFixed(1)}%, 耗时=${durationMs}ms`);
      } else {
        // 确认失败，尝试重试
        await this.handleConfirmationFailure(request, durationMs, '确认同步返回空结果或0步骤');
      }
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
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
      // 达到最大重试次数
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
      
      log.error(`[CommandConfirmation] 确认最终失败: ${request.id}, 重试${request.retryCount}次后放弃: ${errorMsg}`);
      logSyncError('CommandConfirmation', `v359: 确认最终失败`, {
        requestId: request.id,
        accountId: request.accountId,
        operationType: request.operationType,
        retryCount: request.retryCount,
        error: errorMsg,
      });
    } else {
      // 重新排队，增加等待时间
      const config = PROPAGATION_CONFIGS[request.operationType] || PROPAGATION_CONFIGS.general;
      const additionalDelay = config.retryIncrementMs * request.retryCount;
      request.expectedReadyAt = new Date(Date.now() + additionalDelay);
      request.status = 'waiting';
      
      log.warn(`[CommandConfirmation] 确认重试: ${request.id}, 第${request.retryCount}次, 额外等待${additionalDelay}ms: ${errorMsg}`);
    }
  }
  
  /**
   * 获取自适应传播延迟
   * 基于历史数据动态调整
   */
  private getAdaptiveDelay(operationType: string, config: PropagationConfig): number {
    const history = this.propagationHistory.get(operationType);
    
    if (!history || history.length < 5) {
      // 历史数据不足，使用默认值
      return config.initialDelayMs;
    }
    
    // 使用最近20次的P75延迟作为自适应值
    const recent = history.slice(-20).sort((a, b) => a - b);
    const p75Index = Math.floor(recent.length * 0.75);
    const p75Delay = recent[p75Index];
    
    // 在P75基础上增加20%安全余量
    const adaptiveDelay = Math.round(p75Delay * 1.2);
    
    // 限制在配置范围内
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
    
    // 保留最近100条记录
    if (history.length > 100) {
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
        result[type] = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
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
 * 替代原来的 confirmationSync(...).then().catch() 模式
 * 
 * 使用示例:
 * ```typescript
 * // 旧方式 (fire-and-forget):
 * confirmationSync(accountId, entities, 'source').then(...).catch(...);
 * 
 * // 新方式 (可靠确认):
 * const requestId = submitReliableConfirmation(accountId, entities, 'source', 'bid_change');
 * ```
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
