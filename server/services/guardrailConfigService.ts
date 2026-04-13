/**
 * v359: 安全护栏动态配置服务
 * 
 * 解决评估报告中指出的问题:
 * 安全护栏参数（出价变更上限20%、最低出价$0.02等）是硬编码常量，
 * 无法按账户、广告类型或市场动态调整。
 * 
 * 设计:
 * - 三级配置优先级: 账户级 > 广告类型级 > 全局默认
 * - 数据库持久化 + 内存缓存
 * - 运行时动态更新，无需重启
 * - 安全边界: 动态配置不能超出硬编界限（防止误配置）
 */

import { createModuleLogger } from '../utils/logger';
import { SAFETY_LIMITS } from '../optimization/optimizationSafetyGuardrails';

const log = createModuleLogger('GuardrailConfigService');

// ==================== 类型定义 ====================

/** 广告类型 */
export type AdType = 'sp' | 'sb' | 'sd' | 'default';

/** 可配置的护栏参数 */
export interface GuardrailConfig {
  bid: {
    maxSingleChangePercent: number;
    maxDailyChangePercent: number;
    minBid: number;
    maxBid: number;
    consecutiveSameDirectionSlowdown: number;
    slowdownFactor: number;
  };
  budget: {
    maxSingleChangePercent: number;
    maxDailyChangePercent: number;
    minDailyBudget: number;
    maxDailyBudget: number;
  };
  placement: {
    maxSingleChangePct: number;
    maxTotalAdjustment: number;
    minTotalAdjustment: number;
  };
  emergency: {
    salesDropThreshold: number;
    spendSurgeThreshold: number;
    ordersDropThreshold: number;
    lookbackDays: number;
  };
}

/** 配置覆盖（部分字段） */
export type GuardrailConfigOverride = {
  bid?: Partial<GuardrailConfig['bid']>;
  budget?: Partial<GuardrailConfig['budget']>;
  placement?: Partial<GuardrailConfig['placement']>;
  emergency?: Partial<GuardrailConfig['emergency']>;
};

/** 配置条目（数据库存储格式） */
interface ConfigEntry {
  scope: 'global' | 'adType' | 'account';
  scopeKey: string; // 'default' | 'sp' | 'sb' | 'sd' | accountId
  overrides: GuardrailConfigOverride;
  updatedAt: Date;
  updatedBy: string;
}

/**
 * 硬编界限 - 动态配置不能超出这些范围
 * 防止误配置导致系统失控
 */
const HARD_LIMITS = {
  bid: {
    maxSingleChangePercent: { min: 0.05, max: 0.50 },  // 5% ~ 50%
    maxDailyChangePercent: { min: 0.10, max: 0.60 },   // 10% ~ 60%
    minBid: { min: 0.01, max: 0.50 },                  // v645: $0.01 ~ $0.50 (放宽上限以支持SB广告$0.25最低竞价)
    maxBid: { min: 50, max: 500 },                      // $50 ~ $500
    consecutiveSameDirectionSlowdown: { min: 2, max: 7 },
    slowdownFactor: { min: 0.3, max: 0.8 },
  },
  budget: {
    maxSingleChangePercent: { min: 0.10, max: 0.50 },  // 10% ~ 50%
    maxDailyChangePercent: { min: 0.15, max: 0.70 },   // 15% ~ 70%
    minDailyBudget: { min: 0.50, max: 5 },             // $0.50 ~ $5
    maxDailyBudget: { min: 10000, max: 100000 },       // $10K ~ $100K
  },
  placement: {
    maxSingleChangePct: { min: 10, max: 50 },          // 10 ~ 50 百分点
    maxTotalAdjustment: { min: 100, max: 900 },        // 100% ~ 900%
    minTotalAdjustment: { min: -80, max: 0 },          // -80% ~ 0%
  },
  emergency: {
    salesDropThreshold: { min: 0.20, max: 0.70 },      // 20% ~ 70%
    spendSurgeThreshold: { min: 1.5, max: 5.0 },       // 150% ~ 500%
    ordersDropThreshold: { min: 0.25, max: 0.80 },     // 25% ~ 80%
    lookbackDays: { min: 1, max: 14 },                 // 1 ~ 14天
  },
};

// ==================== 配置服务 ====================

export class GuardrailConfigService {
  /** 内存缓存: scope:scopeKey -> ConfigEntry */
  private cache = new Map<string, ConfigEntry>();
  
  /** 缓存有效期（毫秒） */
  private cacheTTL = 5 * 60 * 1000; // 5分钟
  
  /** 最后缓存刷新时间 */
  private lastCacheRefresh = 0;
  
  constructor() {
    log.info('安全护栏动态配置服务初始化');
  }
  
  /**
   * 获取指定上下文的有效护栏配置
   * 按优先级合并: 账户级 > 广告类型级 > 全局默认
   */
  getEffectiveConfig(accountId?: number, adType?: AdType): GuardrailConfig {
    // 从默认值开始
    const config = this.deepClone(SAFETY_LIMITS) as GuardrailConfig;
    
    // 层级1: 应用全局覆盖
    const globalOverride = this.cache.get('global:default');
    if (globalOverride) {
      this.applyOverride(config, globalOverride.overrides);
    }
    
    // 层级2: 应用广告类型覆盖
    if (adType && adType !== 'default') {
      const adTypeOverride = this.cache.get(`adType:${adType}`);
      if (adTypeOverride) {
        this.applyOverride(config, adTypeOverride.overrides);
      }
    }
    
    // 层级3: 应用账户级覆盖
    if (accountId) {
      const accountOverride = this.cache.get(`account:${accountId}`);
      if (accountOverride) {
        this.applyOverride(config, accountOverride.overrides);
      }
    }
    
    return config;
  }
  
  /**
   * 设置配置覆盖
   * 自动验证硬编界限
   */
  setConfigOverride(
    scope: 'global' | 'adType' | 'account',
    scopeKey: string,
    overrides: GuardrailConfigOverride,
    updatedBy: string
  ): { success: boolean; errors: string[] } {
    const errors = this.validateOverrides(overrides);
    if (errors.length > 0) {
      return { success: false, errors };
    }
    
    const entry: ConfigEntry = {
      scope,
      scopeKey,
      overrides,
      updatedAt: new Date(),
      updatedBy,
    };
    
    const cacheKey = `${scope}:${scopeKey}`;
    this.cache.set(cacheKey, entry);
    
    log.info(`安全护栏配置已更新: ${cacheKey}`, {
      scope, scopeKey, updatedBy,
      overrides: JSON.stringify(overrides),
    });
    
    // 异步持久化到数据库
    this.persistToDatabase(entry).catch((err: any) => {
      log.warn('持久化护栏配置失败', err);
    });
    
    return { success: true, errors: [] };
  }
  
  /**
   * 删除配置覆盖，恢复默认
   */
  removeConfigOverride(scope: 'global' | 'adType' | 'account', scopeKey: string): boolean {
    const cacheKey = `${scope}:${scopeKey}`;
    const existed = this.cache.delete(cacheKey);
    
    if (existed) {
      log.info(`安全护栏配置已删除: ${cacheKey}`);
      this.removeFromDatabase(scope, scopeKey).catch((err: any) => {
        log.warn('从数据库删除护栏配置失败', err);
      });
    }
    
    return existed;
  }
  
  /**
   * 获取所有配置覆盖
   */
  getAllOverrides(): ConfigEntry[] {
    return Array.from(this.cache.values());
  }
  
  /**
   * 获取指定范围的配置覆盖
   */
  getOverride(scope: 'global' | 'adType' | 'account', scopeKey: string): GuardrailConfigOverride | null {
    const entry = this.cache.get(`${scope}:${scopeKey}`);
    return entry?.overrides || null;
  }
  
  /**
   * 获取硬编界限（供前端显示）
   */
  getHardLimits() {
    return HARD_LIMITS;
  }
  
  /**
   * 从数据库加载配置到缓存
   */
  async loadFromDatabase(): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;
      
      const { sql } = await import('drizzle-orm');
      
      // 从optimization_events表中读取护栏配置
      const rows = await db.execute(sql`
        SELECT action_detail FROM optimization_events 
        WHERE event_category = 'guardrail_config' 
        AND status = 'active'
        ORDER BY created_at DESC
      `);
      
      if (rows && Array.isArray(rows) && rows.length > 0) {
        for (const row of (rows as unknown[])) {
          try {
            // @ts-expect-error Dynamic type assertion
            const detail = JSON.parse((row as Record<string, unknown>).action_detail || '{}');
            if (detail.scope && detail.scopeKey && detail.overrides) {
              const cacheKey = `${detail.scope}:${detail.scopeKey}`;
              this.cache.set(cacheKey, {
                scope: detail.scope,
                scopeKey: detail.scopeKey,
                overrides: detail.overrides,
                updatedAt: new Date(detail.updatedAt || Date.now()),
                updatedBy: detail.updatedBy || 'system',
              });
            }
          } catch {
            // 跳过无效记录
          }
        }
        log.info(`从数据库加载了 ${this.cache.size} 条护栏配置`);
      }
      
      this.lastCacheRefresh = Date.now();
    } catch (err: any) {
      log.warn('从数据库加载护栏配置失败', err);
    }
  }
  
  // ==================== 内部方法 ====================
  
  /**
   * 验证覆盖值是否在硬编界限内
   */
  private validateOverrides(overrides: GuardrailConfigOverride): string[] {
    const errors: string[] = [];
    
    if (overrides.bid) {
      for (const [key, value] of Object.entries(overrides.bid)) {
        // @ts-expect-error Amazon API response type flexibility
        const limit = (HARD_LIMITS.bid as Record<string, unknown>)[key];
        // @ts-expect-error Conditional type narrowing
        if (limit && (value < limit.min || value > limit.max)) {
          // @ts-expect-error Amazon API response type flexibility
          errors.push(`bid.${key}: ${value} 超出允许范围 [${limit.min}, ${limit.max}]`);
        }
      }
    }
    
    // @ts-expect-error Conditional type narrowing
    if (overrides.budget) {
      // @ts-expect-error Complex function parameter types
      for (const [key, value] of Object.entries(overrides.budget)) {
        const limit = (HARD_LIMITS.budget as Record<string, unknown>)[key];
        // @ts-expect-error Conditional type narrowing
        if (limit && (value < limit.min || value > limit.max)) {
          // @ts-expect-error Complex function parameter types
          errors.push(`budget.${key}: ${value} 超出允许范围 [${limit.min}, ${limit.max}]`);
        }
      }
    // @ts-expect-error Legacy code type compatibility
    }
    
    if (overrides.placement) {
      for (const [key, value] of Object.entries(overrides.placement)) {
        const limit = (HARD_LIMITS.placement as Record<string, unknown>)[key];
        // @ts-expect-error Conditional type narrowing
        if (limit && (value < limit.min || value > limit.max)) {
          // @ts-expect-error Complex function parameter types
          errors.push(`placement.${key}: ${value} 超出允许范围 [${limit.min}, ${limit.max}]`);
        // @ts-expect-error Legacy code type compatibility
        }
      // @ts-expect-error Legacy code type compatibility
      }
    }
    
    if (overrides.emergency) {
      for (const [key, value] of Object.entries(overrides.emergency)) {
        const limit = (HARD_LIMITS.emergency as Record<string, unknown>)[key];
        // @ts-expect-error Conditional type narrowing
        if (limit && (value < limit.min || value > limit.max)) {
          // @ts-expect-error Complex function parameter types
          errors.push(`emergency.${key}: ${value} 超出允许范围 [${limit.min}, ${limit.max}]`);
        }
      }
    }
    
    return errors;
  }
  
  /**
   * 将覆盖值合并到配置中
   */
  private applyOverride(config: GuardrailConfig, overrides: GuardrailConfigOverride): void {
    if (overrides.bid) {
      Object.assign(config.bid, overrides.bid);
    }
    if (overrides.budget) {
      Object.assign(config.budget, overrides.budget);
    }
    if (overrides.placement) {
      Object.assign(config.placement, overrides.placement);
    }
    if (overrides.emergency) {
      Object.assign(config.emergency, overrides.emergency);
    }
  }
  
  /**
   * 深拷贝对象
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }
  
  /**
   * 持久化配置到数据库
   */
  private async persistToDatabase(entry: ConfigEntry): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;
      
      const { sql } = await import('drizzle-orm');
      
      // 先标记旧配置为inactive
      await db.execute(sql`
        UPDATE optimization_events 
        SET status = 'inactive'
        WHERE event_category = 'guardrail_config'
        AND JSON_EXTRACT(action_detail, '$.scope') = ${entry.scope}
        AND JSON_EXTRACT(action_detail, '$.scopeKey') = ${entry.scopeKey}
      `);
      
      // 插入新配置
      await db.execute(sql`
        INSERT INTO optimization_events (
          account_id, event_category, action_type, action_detail, status, created_at
        ) VALUES (
          0, 'guardrail_config', 'config_update',
          ${JSON.stringify({
            scope: entry.scope,
            scopeKey: entry.scopeKey,
            overrides: entry.overrides,
            updatedAt: entry.updatedAt.toISOString(),
            updatedBy: entry.updatedBy,
          })},
          'active',
          NOW()
        )
      `);
    } catch (err: any) {
      log.warn('持久化护栏配置到数据库失败', err);
      throw err;
    }
  }
  
  /**
   * 从数据库删除配置
   */
  private async removeFromDatabase(scope: string, scopeKey: string): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;
      
      const { sql } = await import('drizzle-orm');
      
      await db.execute(sql`
        UPDATE optimization_events 
        SET status = 'inactive'
        WHERE event_category = 'guardrail_config'
        AND JSON_EXTRACT(action_detail, '$.scope') = ${scope}
        AND JSON_EXTRACT(action_detail, '$.scopeKey') = ${scopeKey}
      `);
    } catch (err: any) {
      log.warn('从数据库删除护栏配置失败', err);
    }
  }
}

// ==================== 单例管理 ====================

let instance: GuardrailConfigService | null = null;

export function getGuardrailConfigService(): GuardrailConfigService {
  if (!instance) {
    instance = new GuardrailConfigService();
  }
  return instance;
}

export async function initGuardrailConfigService(): Promise<GuardrailConfigService> {
  const service = getGuardrailConfigService();
  await service.loadFromDatabase();
  return service;
}
