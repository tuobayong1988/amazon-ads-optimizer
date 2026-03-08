/**
 * v359: 增强型分端点API限流服务
 * 
 * 解决评估报告中指出的问题:
 * 1. 单例内存限流器无法跨实例共享 → 预留分布式接口(RateLimitStore)
 * 2. 限流配置"一刀切"未区分API端点 → 按端点类型区分TPS配置
 * 3. 缺少限流指标监控 → 内置指标收集和告警
 * 
 * Amazon Advertising API 限流规则:
 * - 列表/查询端点 (list): ~10 TPS
 * - 批量更新端点 (mutate): ~5 TPS  
 * - 报告请求端点 (report): ~1 TPS
 * - 快照请求端点 (snapshot): ~1 TPS
 * 
 * 架构:
 * - RateLimitStore: 存储抽象层 (当前内存实现，未来可替换为Redis)
 * - TokenBucket: 令牌桶算法核心
 * - ApiRateLimitService: 面向业务的限流服务
 */

import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('ApiRateLimitService');

// ==================== 类型定义 ====================

/** API端点类型 */
export type ApiEndpointType = 'list' | 'mutate' | 'report' | 'snapshot' | 'default';

/** 单个端点的限流配置 */
export interface EndpointRateConfig {
  /** 每秒允许的最大请求数 (TPS) */
  maxRequestsPerSecond: number;
  /** 每分钟允许的最大请求数 */
  maxRequestsPerMinute: number;
  /** 令牌桶容量（允许的突发量） */
  burstCapacity: number;
  /** 令牌恢复速率（每秒恢复的令牌数） */
  refillRatePerSecond: number;
}

/** 限流指标 */
export interface RateLimitMetrics {
  endpointType: ApiEndpointType;
  accountId: number;
  totalRequests: number;
  acceptedRequests: number;
  rejectedRequests: number;
  totalWaitTimeMs: number;
  avgWaitTimeMs: number;
  peakTps: number;
  throttleEvents: number;
  lastThrottleTime: Date | null;
}

/** 限流决策结果 */
export interface RateLimitDecision {
  allowed: boolean;
  waitMs: number;
  remainingTokens: number;
  retryAfterMs?: number;
}

// ==================== 存储抽象层 ====================

/**
 * 限流存储接口 - 抽象层
 * 当前使用内存实现，未来可替换为Redis实现以支持分布式
 */
export interface RateLimitStore {
  /** 获取令牌桶状态 */
  getBucket(key: string): Promise<{ tokens: number; lastRefillTime: number } | null>;
  /** 更新令牌桶状态 */
  setBucket(key: string, tokens: number, lastRefillTime: number, ttlMs?: number): Promise<void>;
  /** 原子性地消费令牌（返回消费后的剩余令牌数，-1表示不足） */
  consumeToken(key: string, config: EndpointRateConfig): Promise<{ remaining: number; waitMs: number }>;
  /** 记录请求计数（滑动窗口） */
  incrementCounter(key: string, windowMs: number): Promise<number>;
  /** 获取当前窗口内的请求计数 */
  getCounter(key: string): Promise<number>;
}

/**
 * 内存限流存储实现
 * 适用于单实例部署，性能最优
 */
class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { tokens: number; lastRefillTime: number }>();
  private counters = new Map<string, { count: number; windowStart: number; windowMs: number }>();
  
  async getBucket(key: string): Promise<{ tokens: number; lastRefillTime: number } | null> {
    return this.buckets.get(key) || null;
  }
  
  async setBucket(key: string, tokens: number, lastRefillTime: number): Promise<void> {
    this.buckets.set(key, { tokens, lastRefillTime });
  }
  
  async consumeToken(key: string, config: EndpointRateConfig): Promise<{ remaining: number; waitMs: number }> {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    
    if (!bucket) {
      // 初始化令牌桶
      bucket = { tokens: config.burstCapacity, lastRefillTime: now };
      this.buckets.set(key, bucket);
    }
    
    // 计算自上次填充以来应该恢复的令牌数
    const elapsedMs = now - bucket.lastRefillTime;
    const tokensToAdd = (elapsedMs / 1000) * config.refillRatePerSecond;
    bucket.tokens = Math.min(config.burstCapacity, bucket.tokens + tokensToAdd);
    bucket.lastRefillTime = now;
    
    if (bucket.tokens >= 1) {
      // 有足够令牌，消费一个
      bucket.tokens -= 1;
      return { remaining: Math.floor(bucket.tokens), waitMs: 0 };
    } else {
      // 令牌不足，计算需要等待的时间
      const deficit = 1 - bucket.tokens;
      const waitMs = Math.ceil((deficit / config.refillRatePerSecond) * 1000);
      return { remaining: 0, waitMs };
    }
  }
  
  async incrementCounter(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    let counter = this.counters.get(key);
    
    if (!counter || (now - counter.windowStart) >= counter.windowMs) {
      // 窗口已过期，重置
      counter = { count: 0, windowStart: now, windowMs };
      this.counters.set(key, counter);
    }
    
    counter.count++;
    return counter.count;
  }
  
  async getCounter(key: string): Promise<number> {
    const counter = this.counters.get(key);
    if (!counter) return 0;
    
    const now = Date.now();
    if ((now - counter.windowStart) >= counter.windowMs) {
      return 0; // 窗口已过期
    }
    return counter.count;
  }
}

// ==================== 端点限流配置 ====================

/** 
 * v359: 按端点类型区分的限流配置
 * 基于Amazon Advertising API官方限流规则
 */
const DEFAULT_ENDPOINT_CONFIGS: Record<ApiEndpointType, EndpointRateConfig> = {
  list: {
    maxRequestsPerSecond: 8,      // 官方~10 TPS，保守设为8
    maxRequestsPerMinute: 400,
    burstCapacity: 15,            // 允许短时突发到15
    refillRatePerSecond: 8,
  },
  mutate: {
    maxRequestsPerSecond: 4,      // 官方~5 TPS，保守设为4
    maxRequestsPerMinute: 200,
    burstCapacity: 8,
    refillRatePerSecond: 4,
  },
  report: {
    maxRequestsPerSecond: 1,      // 报告端点限制严格
    maxRequestsPerMinute: 30,
    burstCapacity: 3,
    refillRatePerSecond: 1,
  },
  snapshot: {
    maxRequestsPerSecond: 1,
    maxRequestsPerMinute: 20,
    burstCapacity: 2,
    refillRatePerSecond: 0.5,
  },
  default: {
    maxRequestsPerSecond: 5,
    maxRequestsPerMinute: 200,
    burstCapacity: 10,
    refillRatePerSecond: 5,
  },
};

// ==================== 限流服务主类 ====================

export class ApiRateLimitService {
  private store: RateLimitStore;
  private configs: Record<ApiEndpointType, EndpointRateConfig>;
  private metrics = new Map<string, RateLimitMetrics>();
  
  /** 限流事件回调（用于告警） */
  private onThrottleCallback?: (accountId: number, endpointType: ApiEndpointType, waitMs: number) => void;
  
  constructor(
    store?: RateLimitStore,
    configs?: Partial<Record<ApiEndpointType, Partial<EndpointRateConfig>>>
  ) {
    this.store = store || new InMemoryRateLimitStore();
    
    // 合并自定义配置和默认配置
    this.configs = { ...DEFAULT_ENDPOINT_CONFIGS };
    if (configs) {
      for (const [type, overrides] of Object.entries(configs)) {
        if (overrides && this.configs[type as ApiEndpointType]) {
          this.configs[type as ApiEndpointType] = {
            ...this.configs[type as ApiEndpointType],
            ...overrides,
          };
        }
      }
    }
    
    log.info(`[ApiRateLimitService] v359: 初始化完成, 端点配置: ${JSON.stringify(
      Object.entries(this.configs).map(([k, v]) => `${k}=${v.maxRequestsPerSecond}TPS`).join(', ')
    )}`);
  }
  
  /**
   * 请求限流检查 - 核心方法
   * 在发起API调用前调用此方法，获取限流决策
   * 
   * @param accountId 广告账户ID
   * @param endpointType API端点类型
   * @param autoWait 是否自动等待（true则阻塞直到获得令牌，false则立即返回决策）
   * @returns 限流决策
   */
  async acquirePermit(
    accountId: number,
    endpointType: ApiEndpointType = 'default',
    autoWait: boolean = true
  ): Promise<RateLimitDecision> {
    const config = this.configs[endpointType] || this.configs.default;
    const bucketKey = `ratelimit:${accountId}:${endpointType}`;
    const minuteCounterKey = `ratelimit:minute:${accountId}:${endpointType}`;
    
    // 检查每分钟限额
    const minuteCount = await this.store.getCounter(minuteCounterKey);
    if (minuteCount >= config.maxRequestsPerMinute) {
      const waitMs = 60000; // 等待到下一分钟
      this.recordThrottle(accountId, endpointType, waitMs);
      
      if (autoWait) {
        log.warn(`[RateLimit] 账户${accountId} ${endpointType}端点每分钟限额已满(${minuteCount}/${config.maxRequestsPerMinute}), 等待${waitMs}ms`);
        await this.delay(Math.min(waitMs, 10000)); // 最多等10秒
        return this.acquirePermit(accountId, endpointType, autoWait); // 递归重试
      }
      
      return { allowed: false, waitMs, remainingTokens: 0, retryAfterMs: waitMs };
    }
    
    // 令牌桶检查
    const { remaining, waitMs } = await this.store.consumeToken(bucketKey, config);
    
    if (waitMs > 0) {
      this.recordThrottle(accountId, endpointType, waitMs);
      
      if (autoWait) {
        log.debug(`[RateLimit] 账户${accountId} ${endpointType}端点令牌不足, 等待${waitMs}ms`);
        await this.delay(waitMs);
        // 等待后重新消费令牌
        const retryResult = await this.store.consumeToken(bucketKey, config);
        await this.store.incrementCounter(minuteCounterKey, 60000);
        this.recordAccepted(accountId, endpointType, waitMs);
        return { allowed: true, waitMs, remainingTokens: retryResult.remaining };
      }
      
      return { allowed: false, waitMs, remainingTokens: 0, retryAfterMs: waitMs };
    }
    
    // 令牌充足，记录请求
    await this.store.incrementCounter(minuteCounterKey, 60000);
    this.recordAccepted(accountId, endpointType, 0);
    return { allowed: true, waitMs: 0, remainingTokens: remaining };
  }
  
  /**
   * 批量请求限流 - 用于批量API调用前预检
   * 预先检查是否有足够的配额执行N个请求
   * 
   * @param accountId 广告账户ID
   * @param endpointType API端点类型
   * @param requestCount 预计请求数量
   * @returns 建议的批次大小和间隔
   */
  async planBatchRequests(
    accountId: number,
    endpointType: ApiEndpointType,
    requestCount: number
  ): Promise<{
    recommendedBatchSize: number;
    batchIntervalMs: number;
    estimatedTotalTimeMs: number;
  }> {
    const config = this.configs[endpointType] || this.configs.default;
    
    // 根据TPS计算推荐的批次大小
    const recommendedBatchSize = Math.min(
      requestCount,
      config.burstCapacity,
      config.maxRequestsPerSecond * 2 // 允许2秒的突发
    );
    
    // 批次间隔 = 批次大小 / TPS * 1000ms + 安全余量
    const batchIntervalMs = Math.ceil((recommendedBatchSize / config.refillRatePerSecond) * 1000) + 500;
    
    // 预计总时间
    const totalBatches = Math.ceil(requestCount / recommendedBatchSize);
    const estimatedTotalTimeMs = totalBatches * batchIntervalMs;
    
    log.debug(`[RateLimit] 批量规划: 账户${accountId} ${endpointType} ${requestCount}个请求 -> 批次大小${recommendedBatchSize}, 间隔${batchIntervalMs}ms, 预计${estimatedTotalTimeMs}ms`);
    
    return { recommendedBatchSize, batchIntervalMs, estimatedTotalTimeMs };
  }
  
  /**
   * 记录外部429限流事件
   * 当Amazon API返回429时调用，触发自适应降速
   */
  recordExternalThrottle(accountId: number, endpointType: ApiEndpointType): void {
    const config = this.configs[endpointType];
    if (config) {
      // 临时降低该端点的TPS（自适应退避）
      const originalTps = DEFAULT_ENDPOINT_CONFIGS[endpointType].maxRequestsPerSecond;
      config.maxRequestsPerSecond = Math.max(1, Math.floor(config.maxRequestsPerSecond * 0.7));
      config.refillRatePerSecond = config.maxRequestsPerSecond;
      
      log.warn(`[RateLimit] v359: 外部429限流! 账户${accountId} ${endpointType}端点TPS降低: ${originalTps} -> ${config.maxRequestsPerSecond}`);
      
      // 60秒后尝试恢复
      setTimeout(() => {
        config.maxRequestsPerSecond = Math.min(
          config.maxRequestsPerSecond + 1,
          DEFAULT_ENDPOINT_CONFIGS[endpointType].maxRequestsPerSecond
        );
        config.refillRatePerSecond = config.maxRequestsPerSecond;
        log.info(`[RateLimit] v359: ${endpointType}端点TPS恢复: -> ${config.maxRequestsPerSecond}`);
      }, 60000);
    }
    
    if (this.onThrottleCallback) {
      this.onThrottleCallback(accountId, endpointType, 0);
    }
  }
  
  /**
   * 设置限流事件回调
   */
  onThrottle(callback: (accountId: number, endpointType: ApiEndpointType, waitMs: number) => void): void {
    this.onThrottleCallback = callback;
  }
  
  /**
   * 获取指定账户和端点的限流指标
   */
  getMetrics(accountId: number, endpointType?: ApiEndpointType): RateLimitMetrics[] {
    const results: RateLimitMetrics[] = [];
    for (const [key, metrics] of this.metrics.entries()) {
      if (metrics.accountId === accountId) {
        if (!endpointType || metrics.endpointType === endpointType) {
          results.push({ ...metrics });
        }
      }
    }
    return results;
  }
  
  /**
   * 获取所有限流指标汇总
   */
  getAllMetrics(): RateLimitMetrics[] {
    return Array.from(this.metrics.values()).map(m => ({ ...m }));
  }
  
  /**
   * 获取当前限流配置
   */
  getConfigs(): Record<ApiEndpointType, EndpointRateConfig> {
    return { ...this.configs };
  }
  
  /**
   * 动态更新端点限流配置
   */
  updateConfig(endpointType: ApiEndpointType, config: Partial<EndpointRateConfig>): void {
    if (this.configs[endpointType]) {
      this.configs[endpointType] = { ...this.configs[endpointType], ...config };
      log.info(`[RateLimit] v359: 更新${endpointType}端点配置: ${JSON.stringify(config)}`);
    }
  }
  
  /**
   * 重置指标（通常在同步周期结束时调用）
   */
  resetMetrics(): void {
    this.metrics.clear();
  }
  
  // ==================== 内部方法 ====================
  
  private getMetricsKey(accountId: number, endpointType: ApiEndpointType): string {
    return `${accountId}:${endpointType}`;
  }
  
  private getOrCreateMetrics(accountId: number, endpointType: ApiEndpointType): RateLimitMetrics {
    const key = this.getMetricsKey(accountId, endpointType);
    let metrics = this.metrics.get(key);
    if (!metrics) {
      metrics = {
        endpointType,
        accountId,
        totalRequests: 0,
        acceptedRequests: 0,
        rejectedRequests: 0,
        totalWaitTimeMs: 0,
        avgWaitTimeMs: 0,
        peakTps: 0,
        throttleEvents: 0,
        lastThrottleTime: null,
      };
      this.metrics.set(key, metrics);
    }
    return metrics;
  }
  
  private recordAccepted(accountId: number, endpointType: ApiEndpointType, waitMs: number): void {
    const metrics = this.getOrCreateMetrics(accountId, endpointType);
    metrics.totalRequests++;
    metrics.acceptedRequests++;
    metrics.totalWaitTimeMs += waitMs;
    metrics.avgWaitTimeMs = metrics.totalWaitTimeMs / metrics.acceptedRequests;
  }
  
  private recordThrottle(accountId: number, endpointType: ApiEndpointType, waitMs: number): void {
    const metrics = this.getOrCreateMetrics(accountId, endpointType);
    metrics.totalRequests++;
    metrics.throttleEvents++;
    metrics.lastThrottleTime = new Date();
    
    if (this.onThrottleCallback) {
      this.onThrottleCallback(accountId, endpointType, waitMs);
    }
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==================== 全局单例 ====================

let globalRateLimitService: ApiRateLimitService | null = null;

/**
 * 获取全局限流服务实例
 */
export function getApiRateLimitService(): ApiRateLimitService {
  if (!globalRateLimitService) {
    globalRateLimitService = new ApiRateLimitService();
    
    // 设置限流告警回调
    globalRateLimitService.onThrottle((accountId, endpointType, waitMs) => {
      if (waitMs > 5000) {
        log.error(`[ALERT] v359: API限流告警! 账户${accountId} ${endpointType}端点等待${waitMs}ms`);
      }
    });
  }
  return globalRateLimitService;
}

/**
 * 替换全局限流服务（用于测试或切换到Redis实现）
 */
export function setApiRateLimitService(service: ApiRateLimitService): void {
  globalRateLimitService = service;
}

/**
 * 便捷函数: 在API调用前获取限流许可
 * 
 * 使用示例:
 * ```typescript
 * await acquireApiPermit(accountId, 'mutate');
 * const result = await amazonApi.updateKeywordBids(bids);
 * ```
 */
export async function acquireApiPermit(
  accountId: number,
  endpointType: ApiEndpointType = 'default'
): Promise<void> {
  const service = getApiRateLimitService();
  await service.acquirePermit(accountId, endpointType, true);
}

/**
 * 便捷函数: 分类API端点类型
 * 根据API方法名自动判断端点类型
 */
export function classifyEndpoint(methodName: string): ApiEndpointType {
  const lowerName = methodName.toLowerCase();
  
  // 报告类
  if (lowerName.includes('report') || lowerName.includes('performance') || lowerName.includes('searchterm')) {
    return 'report';
  }
  
  // 快照类
  if (lowerName.includes('snapshot')) {
    return 'snapshot';
  }
  
  // 变更类
  if (lowerName.includes('update') || lowerName.includes('create') || lowerName.includes('delete') ||
      lowerName.includes('sync') || lowerName.includes('apply') || lowerName.includes('add') ||
      lowerName.includes('remove') || lowerName.includes('archive')) {
    return 'mutate';
  }
  
  // 查询类
  if (lowerName.includes('list') || lowerName.includes('get') || lowerName.includes('fetch') ||
      lowerName.includes('query') || lowerName.includes('search')) {
    return 'list';
  }
  
  return 'default';
}
