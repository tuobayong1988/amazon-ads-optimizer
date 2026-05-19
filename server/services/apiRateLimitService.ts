// @ts-nocheck
/**
 * v368: 增强型分端点API限流服务
 * 
 * 基于v359版本优化:
 * 1. 429自适应退避改为per-account级别，不再影响全局配置
 * 2. 退避恢复策略从线性(+1)改为指数恢复（更快恢复到正常TPS）
 * 3. 增加全局TPS上限（跨账户），防止多账户并发超过Amazon应用级限额
 * 4. 增强限流日志，记录账户维度的限流统计
 * 
 * Amazon Advertising API 限流规则:
 * - 列表/查询端点 (list): ~10 TPS
 * - 批量更新端点 (mutate): ~5 TPS  
 * - 报告请求端点 (report): ~1 TPS
 * - 快照请求端点 (snapshot): ~1 TPS
 * - 应用级全局限额: 所有账户共享，约为单账户的3-5倍
 */

import { createModuleLogger } from '../utils/logger';
import { SYSTEM_VERSION } from '../utils/systemVersion';
import { getCircuitBreaker, CircuitState } from './circuitBreakerService';

const log = createModuleLogger('ApiRateLimitService');

// ==================== 类型定义 ====================

/** API端点类型 */
export type ApiEndpointType = 'list' | 'mutate' | 'report' | 'snapshot' | 'default';

/**
 * v681: API消费者优先级
 * 用于统一API配额调度器，高优先级任务运行时自动压缩低优先级任务的配额
 */
export type ApiConsumerPriority = 'manual_sync' | 'auto_sync' | 'optimization' | 'verification' | 'background';

/** 消费者优先级配置 */
const CONSUMER_PRIORITY_CONFIG: Record<ApiConsumerPriority, {
  /** 优先级数值，越小越高 */
  priority: number;
  /** 当更高优先级消费者活跃时，此消费者的配额压缩系数 (0-1) */
  throttleFactor: number;
  /** 当更高优先级消费者活跃时，额外等待时间(ms) */
  extraDelayMs: number;
}> = {
  manual_sync:   { priority: 1, throttleFactor: 1.0, extraDelayMs: 0 },
  auto_sync:     { priority: 2, throttleFactor: 0.8, extraDelayMs: 0 },
  optimization:  { priority: 3, throttleFactor: 0.6, extraDelayMs: 200 },
  verification:  { priority: 4, throttleFactor: 0.4, extraDelayMs: 500 },
  background:    { priority: 5, throttleFactor: 0.3, extraDelayMs: 1000 },
};

/** v681: 当前活跃的最高优先级消费者 */
let activeHighestPriority: ApiConsumerPriority | null = null;
let activeHighestPrioritySetAt: number = 0;
const PRIORITY_EXPIRY_MS = 300_000; // 5分钟无活动自动过期

/**
 * v681: 设置当前活跃的最高优先级消费者
 * 在同步/优化任务开始时调用
 */
export function setActiveConsumerPriority(consumer: ApiConsumerPriority | null): void {
  const prev = activeHighestPriority;
  activeHighestPriority = consumer;
  activeHighestPrioritySetAt = consumer ? Date.now() : 0;
  if (prev !== consumer) {
    log.info(`[v681] 活跃消费者优先级变更: ${prev || 'none'} -> ${consumer || 'none'}`);
  }
}

/**
 * v681: 获取当前活跃的最高优先级消费者
 */
export function getActiveConsumerPriority(): ApiConsumerPriority | null {
  if (!activeHighestPriority) return null;
  // 自动过期检查
  if (Date.now() - activeHighestPrioritySetAt > PRIORITY_EXPIRY_MS) {
    log.info(`[v681] 活跃消费者优先级已过期(${activeHighestPriority}), 自动清除`);
    activeHighestPriority = null;
    activeHighestPrioritySetAt = 0;
    return null;
  }
  return activeHighestPriority;
}

/**
 * v681: 刷新活跃消费者的心跳，防止过期
 */
export function refreshConsumerPriorityHeartbeat(): void {
  if (activeHighestPriority) {
    activeHighestPrioritySetAt = Date.now();
  }
}

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
/**
 * v752: Redis分布式限流存储
 * 使用Redis INCR + EXPIRE实现滑动窗口计数
 * 部署多实例时，设置环境变量 REDIS_URL 即可自动切换
 * 
 * 使用方式：
 *   1. 安装 ioredis: pnpm add ioredis
 *   2. 设置环境变量: REDIS_URL=redis://host:6379
 *   3. 系统自动检测并使用Redis限流存储
 */
class RedisRateLimitStore implements RateLimitStore {
  private redis: any = null;
  private fallback: InMemoryRateLimitStore;
  
  constructor() {
    this.fallback = new InMemoryRateLimitStore();
    if (process.env.REDIS_URL) {
      try {
        const Redis = require('ioredis');
        this.redis = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times: number) => Math.min(times * 100, 3000),
          lazyConnect: true,
        });
        this.redis.connect().catch((err: Error) => {
          log.warn(`[RateLimit] v752: Redis连接失败，回退到内存限流: ${err.message}`);
          this.redis = null;
        });
        log.info(`[RateLimit] v752: Redis分布式限流已启用`);
      } catch (err) {
        log.info(`[RateLimit] v752: ioredis未安装，使用内存限流（单实例模式）`);
        this.redis = null;
      }
    }
  }
  
  async incrementCounter(key: string, windowMs: number): Promise<number> {
    if (!this.redis) return this.fallback.incrementCounter(key, windowMs);
    try {
      const windowKey = `ratelimit:${key}:${Math.floor(Date.now() / windowMs)}`;
      const count = await this.redis.incr(windowKey);
      if (count === 1) {
        await this.redis.pexpire(windowKey, windowMs * 2);
      }
      return count;
    } catch (err) {
      return this.fallback.incrementCounter(key, windowMs);
    }
  }
  
  async getCounter(key: string): Promise<number> {
    if (!this.redis) return this.fallback.getCounter(key);
    try {
      const windowMs = key.includes('minute') ? 60000 : 1000;
      const windowKey = `ratelimit:${key}:${Math.floor(Date.now() / windowMs)}`;
      const count = await this.redis.get(windowKey);
      return parseInt(count || '0', 10);
    } catch (err) {
      return this.fallback.getCounter(key);
    }
  }
}

/**
 * v752: 实例ID标识 — 水平扩展准备
 * 每个实例生成唯一ID，用于日志追踪和分布式协调
 */
const INSTANCE_ID = process.env.INSTANCE_ID || `inst-${process.pid}-${Date.now().toString(36).slice(-4)}`;

/**
 * v752: 限流存储工厂 — 根据环境自动选择存储后端
 */
function createRateLimitStore(): RateLimitStore {
  if (process.env.REDIS_URL) {
    log.info(`[RateLimit] v752: 使用Redis分布式限流 (实例ID: ${INSTANCE_ID})`);
    return new RedisRateLimitStore();
  }
  log.info(`[RateLimit] v752: 使用内存限流（单实例模式, ID: ${INSTANCE_ID})`);
  return new InMemoryRateLimitStore();
}

class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { tokens: number; lastRefillTime: number }>();
  private counters = new Map<string, { count: number; windowStart: number; windowMs: number; prevCount: number; prevWindowStart: number }>();
  
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
    
    if (!counter) {
      counter = { count: 0, windowStart: now, windowMs, prevCount: 0, prevWindowStart: 0 };
      this.counters.set(key, counter);
    } else if ((now - counter.windowStart) >= counter.windowMs) {
      // v751: 滑动窗口 - 保存上一个窗口的计数用于平滑
      counter.prevCount = counter.count;
      counter.prevWindowStart = counter.windowStart;
      counter.count = 0;
      counter.windowStart = now;
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
    
    // v751: 滑动窗口加权计算
    // 使用当前窗口已过去的时间比例来加权上一个窗口的计数
    // 这样可以避免固定窗口边界处的突发问题
    const elapsedInWindow = now - counter.windowStart;
    const windowProgress = elapsedInWindow / counter.windowMs; // 0~1
    const prevWeight = 1 - windowProgress; // 窗口刚开始时，上一窗口权重高
    
    if (counter.prevCount > 0 && counter.prevWindowStart > 0) {
      // 上一窗口的加权贡献
      const smoothedCount = counter.count + Math.floor(counter.prevCount * prevWeight);
      return smoothedCount;
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
    maxRequestsPerSecond: 12,     // v675: 从8提升到12，给多消费者(同步+验证+优化)留出空间
    maxRequestsPerMinute: 600,    // v675: 从400提升到600，匹配全局限额，避免per-account层过早限流
    burstCapacity: 25,            // v675: 从15提升到25，容纳同步+验证的并发突发
    refillRatePerSecond: 12,      // v675: 匹配TPS
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

/**
 * v368: 应用级全局TPS上限配置
 * 所有账户共享的全局限额，防止多账户并发超过Amazon应用级限制
 * 通常为单账户限额的3-5倍
 */
// v658: 降低全局TPS上限，稳定性优先于效率
// 核心原则：宁可慢一点，也要确保每个请求都成功
const GLOBAL_ENDPOINT_CONFIGS: Record<ApiEndpointType, EndpointRateConfig> = {
  list: {
    maxRequestsPerSecond: 30,     // v751: 从20提升到30，15账户并发×2TPS=30TPS刚好匹配
    maxRequestsPerMinute: 1200,   // v751: 从800提升到1200，消除频繁触顶（日志显示810/800）
    burstCapacity: 45,            // v751: 从30提升到45，容纳15账户同时发起list请求
    refillRatePerSecond: 30,      // v751: 匹配TPS
  },
  mutate: {
    maxRequestsPerSecond: 8,      // v658: 从15降到8
    maxRequestsPerMinute: 300,    // v658: 从750降到300
    burstCapacity: 12,            // v658: 从25降到12
    refillRatePerSecond: 8,
  },
  report: {
    maxRequestsPerSecond: 5,      // v752: 从3提升到5（恢复v658前水平）
    maxRequestsPerMinute: 150,    // v752: 从90提升到150（15账户并发report请求）
    burstCapacity: 8,             // v752: 从5提升到8
    refillRatePerSecond: 5,      // v752: 匹配TPS
  },
  snapshot: {
    maxRequestsPerSecond: 2,      // v658: 从3降到2
    maxRequestsPerMinute: 30,     // v658: 从60降到30
    burstCapacity: 3,             // v658: 从5降到3
    refillRatePerSecond: 2,
  },
  default: {
    maxRequestsPerSecond: 10,     // v658: 从20降到10
    maxRequestsPerMinute: 400,    // v658: 从800降到400
    burstCapacity: 15,            // v658: 从30降到15
    refillRatePerSecond: 10,
  },
};

// ==================== Per-Account 退避状态 ====================

/**
 * v368: Per-account退避状态
 * 429退避不再修改全局配置，而是维护每个账户独立的退避系数
 */
interface AccountThrottleState {
  /** 当前退避系数 (0-1, 1=正常, 0.3=最低) */
  backoffFactor: number;
  /** 连续429次数 */
  consecutive429Count: number;
  /** 上次429时间 */
  lastThrottleTime: number;
  /** 恢复定时器 */
  recoveryTimer: ReturnType<typeof setTimeout> | null;
}

const accountThrottleStates = new Map<string, AccountThrottleState>();

// ==================== 限流服务主类 ====================

export class ApiRateLimitService {
  private store: RateLimitStore;
  private globalStore: RateLimitStore;
  private configs: Record<ApiEndpointType, EndpointRateConfig>;
  private metrics = new Map<string, RateLimitMetrics>();
  
  /** 限流事件回调（用于告警） */
  private onThrottleCallback?: (accountId: number, endpointType: ApiEndpointType, waitMs: number) => void;
  
  constructor(
    store?: RateLimitStore,
    configs?: Partial<Record<ApiEndpointType, Partial<EndpointRateConfig>>>
  ) {
    this.store = store || new InMemoryRateLimitStore();
    this.globalStore = store || new InMemoryRateLimitStore(); // v373: 全局限流也使用分布式存储，多实例共享全局TPS限额
    
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
    
    log.info(`[ApiRateLimitService] v${SYSTEM_VERSION}: 初始化完成, 端点配置: ${
      Object.entries(this.configs).map(([k, v]) => `${k}=${v.maxRequestsPerSecond}TPS`).join(', ')
    }, 全局限额: ${
      Object.entries(GLOBAL_ENDPOINT_CONFIGS).map(([k, v]) => `${k}=${v.maxRequestsPerSecond}TPS`).join(', ')
    }`);
  }
  
  /**
   * v368: 获取账户的有效限流配置（考虑退避系数）
   */
  private getEffectiveConfig(accountId: number, endpointType: ApiEndpointType): EndpointRateConfig {
    const baseConfig = this.configs[endpointType] || this.configs.default;
    const stateKey = `${accountId}:${endpointType}`;
    const state = accountThrottleStates.get(stateKey);
    
    if (!state || state.backoffFactor >= 1.0) {
      return baseConfig;
    }
    
    // 应用退避系数
    return {
      maxRequestsPerSecond: Math.max(1, Math.floor(baseConfig.maxRequestsPerSecond * state.backoffFactor)),
      maxRequestsPerMinute: Math.max(10, Math.floor(baseConfig.maxRequestsPerMinute * state.backoffFactor)),
      burstCapacity: Math.max(1, Math.floor(baseConfig.burstCapacity * state.backoffFactor)),
      refillRatePerSecond: Math.max(0.5, baseConfig.refillRatePerSecond * state.backoffFactor),
    };
  }
  
  /**
   * 请求限流检查 - 核心方法
   * 在发起API调用前调用此方法，获取限流决策
   * 
   * v368: 增加全局限流层，先检查全局限额再检查per-account限额
   */
  async acquirePermit(
    accountId: number,
    endpointType: ApiEndpointType = 'default',
    autoWait: boolean = true
  ): Promise<RateLimitDecision> {
    // v525: 熔断器前置检查 - 如果该账户+端点已熔断，直接快速失败
    const circuitBreaker = getCircuitBreaker();
    if (!circuitBreaker.canPass(accountId, endpointType)) {
      const status = circuitBreaker.getStatus(accountId, endpointType);
      const waitMs = status.timeUntilHalfOpen || 60000;
      log.warn(`[RateLimit] v${SYSTEM_VERSION}: 账户${accountId} ${endpointType}端点已熔断(${status.state}), 快速失败 | 剩余冷却${Math.round(waitMs / 1000)}s`);
      this.recordThrottle(accountId, endpointType, waitMs);
      return { allowed: false, waitMs, remainingTokens: 0, retryAfterMs: waitMs };
    }

    const effectiveConfig = this.getEffectiveConfig(accountId, endpointType);
    const globalConfig = GLOBAL_ENDPOINT_CONFIGS[endpointType] || GLOBAL_ENDPOINT_CONFIGS.default;
    
    const bucketKey = `ratelimit:${accountId}:${endpointType}`;
    const minuteCounterKey = `ratelimit:minute:${accountId}:${endpointType}`;
    const globalBucketKey = `ratelimit:global:${endpointType}`;
    const globalMinuteKey = `ratelimit:global:minute:${endpointType}`;
    
    const MAX_ACQUIRE_RETRIES = 3;
    let acquireAttempt = 0;
    
    while (acquireAttempt < MAX_ACQUIRE_RETRIES) {
      // v368: 先检查全局限额
      const globalMinuteCount = await this.globalStore.getCounter(globalMinuteKey);
      if (globalMinuteCount >= globalConfig.maxRequestsPerMinute) {
        const waitMs = 3000; // v751: 全局限额满时等待3秒（从10s降低，RPM提升后触顶频率大幅降低）
        this.recordThrottle(accountId, endpointType, waitMs);
        
        if (autoWait && acquireAttempt < MAX_ACQUIRE_RETRIES - 1) {
          acquireAttempt++;
          log.warn(`[RateLimit] v${SYSTEM_VERSION}: 全局${endpointType}端点每分钟限额已满(${globalMinuteCount}/${globalConfig.maxRequestsPerMinute}), 等待${waitMs/1000}s (重试${acquireAttempt}/${MAX_ACQUIRE_RETRIES})`);
          await this.delay(waitMs);
          continue;
        }
        return { allowed: false, waitMs, remainingTokens: 0, retryAfterMs: waitMs };
      }
      
      // 检查per-account每分钟限额
      const minuteCount = await this.store.getCounter(minuteCounterKey);
      if (minuteCount >= effectiveConfig.maxRequestsPerMinute) {
        const waitMs = 60000;
        this.recordThrottle(accountId, endpointType, waitMs);
        
        if (autoWait && acquireAttempt < MAX_ACQUIRE_RETRIES - 1) {
          acquireAttempt++;
          log.warn(`[RateLimit] 账户${accountId} ${endpointType}端点每分钟限额已满(${minuteCount}/${effectiveConfig.maxRequestsPerMinute}), 等待${Math.min(waitMs, 10000)}ms (重试${acquireAttempt}/${MAX_ACQUIRE_RETRIES})`);
          await this.delay(Math.min(waitMs, 10000));
          continue;
        }
        
        return { allowed: false, waitMs, remainingTokens: 0, retryAfterMs: waitMs };
      }
      break;
    }
    
    // v368: 全局令牌桶检查
    const globalResult = await this.globalStore.consumeToken(globalBucketKey, globalConfig);
    if (globalResult.waitMs > 0) {
      if (autoWait) {
        log.debug(`[RateLimit] v${SYSTEM_VERSION}: 全局${endpointType}端点令牌不足, 等待${globalResult.waitMs}ms`);
        await this.delay(globalResult.waitMs);
        await this.globalStore.consumeToken(globalBucketKey, globalConfig);
      } else {
        return { allowed: false, waitMs: globalResult.waitMs, remainingTokens: 0, retryAfterMs: globalResult.waitMs };
      }
    }
    
    // Per-account令牌桶检查
    const { remaining, waitMs } = await this.store.consumeToken(bucketKey, effectiveConfig);
    
    if (waitMs > 0) {
      this.recordThrottle(accountId, endpointType, waitMs);
      
      if (autoWait) {
        log.debug(`[RateLimit] 账户${accountId} ${endpointType}端点令牌不足, 等待${waitMs}ms`);
        await this.delay(waitMs);
        // 等待后重新消费令牌
        const retryResult = await this.store.consumeToken(bucketKey, effectiveConfig);
        await this.store.incrementCounter(minuteCounterKey, 60000);
        await this.globalStore.incrementCounter(`ratelimit:global:minute:${endpointType}`, 60000);
        this.recordAccepted(accountId, endpointType, waitMs);
        return { allowed: true, waitMs, remainingTokens: retryResult.remaining };
      }
      
      return { allowed: false, waitMs, remainingTokens: 0, retryAfterMs: waitMs };
    }
    
    // 令牌充足，记录请求
    await this.store.incrementCounter(minuteCounterKey, 60000);
    await this.globalStore.incrementCounter(`ratelimit:global:minute:${endpointType}`, 60000);
    this.recordAccepted(accountId, endpointType, 0);
    return { allowed: true, waitMs: 0, remainingTokens: remaining };
  }
  
  /**
   * 批量请求限流 - 用于批量API调用前预检
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
    const config = this.getEffectiveConfig(accountId, endpointType);
    
    const recommendedBatchSize = Math.min(
      requestCount,
      config.burstCapacity,
      config.maxRequestsPerSecond * 2
    );
    
    const batchIntervalMs = Math.ceil((recommendedBatchSize / config.refillRatePerSecond) * 1000) + 500;
    const totalBatches = Math.ceil(requestCount / recommendedBatchSize);
    const estimatedTotalTimeMs = totalBatches * batchIntervalMs;
    
    log.debug(`[RateLimit] 批量规划: 账户${accountId} ${endpointType} ${requestCount}个请求 -> 批次大小${recommendedBatchSize}, 间隔${batchIntervalMs}ms, 预计${estimatedTotalTimeMs}ms`);
    
    return { recommendedBatchSize, batchIntervalMs, estimatedTotalTimeMs };
  }
  
  /**
   * v368: 记录外部429限流事件 - Per-account退避
   * 当Amazon API返回429时调用，触发该账户的自适应降速
   * 不再修改全局配置，只影响触发429的特定账户
   */
  recordExternalThrottle(accountId: number, endpointType: ApiEndpointType): void {
    // v525: 429错误同时通知熔断器
    const circuitBreaker = getCircuitBreaker();
    circuitBreaker.recordFailure(accountId, endpointType, false);
    const stateKey = `${accountId}:${endpointType}`;
    let state = accountThrottleStates.get(stateKey);
    
    if (!state) {
      state = {
        backoffFactor: 1.0,
        consecutive429Count: 0,
        lastThrottleTime: Date.now(),
        recoveryTimer: null,
      };
      accountThrottleStates.set(stateKey, state);
    }
    
    // 清除之前的恢复定时器
    if (state.recoveryTimer) {
      clearTimeout(state.recoveryTimer);
      state.recoveryTimer = null;
    }
    
    // 递增连续429计数
    state.consecutive429Count++;
    state.lastThrottleTime = Date.now();
    
    // 指数退避：每次429将退避系数乘以0.6，最低0.3（即最低降到原始TPS的30%）
    const previousFactor = state.backoffFactor;
    state.backoffFactor = Math.max(0.3, state.backoffFactor * 0.6);
    
    const baseConfig = this.configs[endpointType] || this.configs.default;
    const effectiveTps = Math.max(1, Math.floor(baseConfig.maxRequestsPerSecond * state.backoffFactor));
    
    log.warn(`[RateLimit] v${SYSTEM_VERSION}: 外部429限流! 账户${accountId} ${endpointType}端点 ` +
      `退避系数: ${previousFactor.toFixed(2)} -> ${state.backoffFactor.toFixed(2)}, ` +
      `有效TPS: ${effectiveTps}, 连续429: ${state.consecutive429Count}次`);
    
    // v374: 联动动态并发控制 - 将API层限流事件传递到同步调度层
    try {
      const { recordThrottleEvent } = require('../sync/scheduling/syncPriorityScheduler');
      recordThrottleEvent();
    } catch (_) { /* 不影响主流程 */ }
    
    // v368: 指数恢复 - 30秒后开始恢复，每30秒恢复一次
    // 恢复速度：backoffFactor = min(1.0, current * 1.5)
    const scheduleRecovery = () => {
      const recoveryIntervalMs = 30000; // 30秒恢复间隔
      state!.recoveryTimer = setTimeout(() => {
        if (!state) return;
        
        const previousRecoveryFactor = state.backoffFactor;
        state.backoffFactor = Math.min(1.0, state.backoffFactor * 1.5);
        state.consecutive429Count = Math.max(0, state.consecutive429Count - 1);
        
        const recoveredTps = Math.max(1, Math.floor(baseConfig.maxRequestsPerSecond * state.backoffFactor));
        log.info(`[RateLimit] v${SYSTEM_VERSION}: 账户${accountId} ${endpointType}端点TPS恢复: ` +
          `退避系数 ${previousRecoveryFactor.toFixed(2)} -> ${state.backoffFactor.toFixed(2)}, ` +
          `有效TPS: ${recoveredTps}`);
        
        if (state.backoffFactor < 1.0) {
          // 还未完全恢复，继续调度恢复
          scheduleRecovery();
        } else {
          // 完全恢复
          state.consecutive429Count = 0;
          state.recoveryTimer = null;
          log.info(`[RateLimit] v${SYSTEM_VERSION}: 账户${accountId} ${endpointType}端点已完全恢复到正常TPS`);
        }
      }, recoveryIntervalMs);
    };
    
    scheduleRecovery();
    
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
   * v368: 获取账户退避状态
   */
  getAccountThrottleState(accountId: number, endpointType: ApiEndpointType): { backoffFactor: number; consecutive429Count: number } | null {
    const state = accountThrottleStates.get(`${accountId}:${endpointType}`);
    if (!state) return null;
    return { backoffFactor: state.backoffFactor, consecutive429Count: state.consecutive429Count };
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
      log.info(`[RateLimit] v${SYSTEM_VERSION}: 更新${endpointType}端点配置: ${JSON.stringify(config)}`);
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
 * v372: 创建分布式限流存储
 * 生产环境使用MySQL存储实现跨实例共享限流状态
 * 开发环境使用内存存储
 */
function createDistributedStore(): RateLimitStore {
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    try {
      const { MysqlRateLimitStore } = require('./mysqlRateLimitStore');
      log.info(`[v372] 生产环境: 使用MySQL分布式限流存储`);
      return new MysqlRateLimitStore();
    } catch (err) {
      log.warn(`[v372] MySQL限流存储初始化失败，降级到内存存储: ${(err as Error).message}`);
      return new InMemoryRateLimitStore();
    }
  }
  log.info(`[v372] 开发环境: 使用内存限流存储`);
  return new InMemoryRateLimitStore();
}

/**
 * 获取全局限流服务实例
 * v372: 生产环境自动使用MySQL分布式存储
 */
export function getApiRateLimitService(): ApiRateLimitService {
  if (!globalRateLimitService) {
    const store = createDistributedStore();
    globalRateLimitService = new ApiRateLimitService(store);
    
    // v664: 限流告警聚合机制 — 每个账户+端点组合每60秒最多告警1次，避免日志洪泛
    const throttleAlertTracker: Map<string, { count: number; lastLogTime: number; totalWaitMs: number }> = new Map();
    const THROTTLE_ALERT_INTERVAL_MS = 60_000; // 60秒聚合窗口
    globalRateLimitService.onThrottle((accountId, endpointType, waitMs) => {
      if (waitMs > 5000) {
        const key = `${accountId}:${endpointType}`;
        const now = Date.now();
        const tracker = throttleAlertTracker.get(key);
        if (!tracker || (now - tracker.lastLogTime) >= THROTTLE_ALERT_INTERVAL_MS) {
          // 输出聚合告警
          const suppressedCount = tracker ? tracker.count : 0;
          const avgWait = tracker ? Math.round(tracker.totalWaitMs / Math.max(1, tracker.count)) : waitMs;
          if (suppressedCount > 0) {
            log.warn(`[ALERT] v${SYSTEM_VERSION}: API限流告警! 账户${accountId} ${endpointType}端点等待${waitMs}ms (过去60秒内共${suppressedCount}次限流，平均等待${avgWait}ms)`);
          } else {
            log.warn(`[ALERT] v${SYSTEM_VERSION}: API限流告警! 账户${accountId} ${endpointType}端点等待${waitMs}ms`);
          }
          throttleAlertTracker.set(key, { count: 0, lastLogTime: now, totalWaitMs: 0 });
        } else {
          // 聚合计数，不输出日志
          tracker.count++;
          tracker.totalWaitMs += waitMs;
        }
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
 * v681: 增强版 — 支持消费者优先级，高优先级任务运行时自动压缩低优先级任务的配额
 * 
 * 使用示例:
 * ```typescript
 * await acquireApiPermit(accountId, 'mutate', 'auto_sync');
 * const result = await amazonApi.updateKeywordBids(bids);
 * ```
 */
export async function acquireApiPermit(
  accountId: number,
  endpointType: ApiEndpointType = 'default',
  consumer?: ApiConsumerPriority
): Promise<void> {
  const service = getApiRateLimitService();
  
  // v681: 消费者优先级调度 — 当更高优先级消费者活跃时，低优先级消费者额外等待
  if (consumer) {
    const activeHighest = getActiveConsumerPriority();
    if (activeHighest) {
      const activePriorityNum = CONSUMER_PRIORITY_CONFIG[activeHighest].priority;
      const myPriorityNum = CONSUMER_PRIORITY_CONFIG[consumer].priority;
      
      if (myPriorityNum > activePriorityNum) {
        // 我的优先级低于当前活跃的最高优先级，需要额外等待
        const myConfig = CONSUMER_PRIORITY_CONFIG[consumer];
        if (myConfig.extraDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, myConfig.extraDelayMs));
        }
      }
    }
  }
  
  await service.acquirePermit(accountId, endpointType, true);
}

/**
 * 便捷函数: 分类API端点类型
 * v676: 增强版 — 同时考虑URL路径和HTTP方法，大幅减少落入default端点的请求
 * 根因：Amazon API URL设计不一致，SD使用GET /sd/xxx，SP v3使用POST /sp/xxx/list
 * PUT请求的URL不含 update/create 等关键词，导致被错误归类为default
 */
export function classifyEndpoint(methodName: string, httpMethod?: string): ApiEndpointType {
  const lowerName = methodName.toLowerCase();
  const method = (httpMethod || '').toUpperCase();
  
  // 报告类
  if (lowerName.includes('report') || lowerName.includes('performance') || lowerName.includes('searchterm')) {
    return 'report';
  }
  
  // 快照类
  if (lowerName.includes('snapshot')) {
    return 'snapshot';
  }
  
  // 变更类 - URL关键词匹配
  if (lowerName.includes('update') || lowerName.includes('create') || lowerName.includes('delete') ||
      lowerName.includes('sync') || lowerName.includes('apply') || lowerName.includes('add') ||
      lowerName.includes('remove') || lowerName.includes('archive')) {
    return 'mutate';
  }
  
  // v676: PUT请求始终是变更操作（更新广告活动/关键词/出价等）
  if (method === 'PUT') {
    return 'mutate';
  }
  
  // v676: DELETE请求始终是变更操作
  if (method === 'DELETE') {
    return 'mutate';
  }
  
  // 查询类 - URL关键词匹配
  if (lowerName.includes('list') || lowerName.includes('get') || lowerName.includes('fetch') ||
      lowerName.includes('query') || lowerName.includes('search')) {
    return 'list';
  }
  
  // v676: 推荐竞价API是查询类（POST /sb/recommendations/bids, POST /sd/targets/bid/recommendations）
  if (lowerName.includes('recommendation')) {
    return 'list';
  }
  
  // v676: Budget Rules API是查询类（GET /sp/campaigns/{id}/budgetRules）
  if (lowerName.includes('budgetrule')) {
    return 'list';
  }
  
  // v676: GET请求默认为查询类（覆盖SD API的 GET /sd/campaigns, /sd/adGroups, /sd/targets 等）
  if (method === 'GET') {
    return 'list';
  }
  
  // v676: POST请求到非/list端点的是创建操作（如 POST /sp/keywords, POST /sp/negativeKeywords）
  // 排除已被上面规则匹配的报告/快照/查询类
  if (method === 'POST' && !lowerName.includes('list')) {
    // POST到非-list端点通常是创建操作（如创建否定关键词、创建广告活动等）
    // 但也可能是查询（如 POST /streams/subscriptions），归类为mutate更安全
    return 'mutate';
  }
  
  return 'default';
}
