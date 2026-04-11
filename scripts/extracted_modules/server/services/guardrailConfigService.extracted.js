// Extracted from production dist/index.js
// Original module: server/services/guardrailConfigService.ts
// Lines: 332

var guardrailConfigService_exports = {};
__export(guardrailConfigService_exports, {
  GuardrailConfigService: () => GuardrailConfigService,
  getGuardrailConfigService: () => getGuardrailConfigService,
  initGuardrailConfigService: () => initGuardrailConfigService
});
function getGuardrailConfigService() {
  if (!instance) {
    instance = new GuardrailConfigService();
  }
  return instance;
}
async function initGuardrailConfigService() {
  const service = getGuardrailConfigService();
  await service.loadFromDatabase();
  return service;
}
var log93, HARD_LIMITS, GuardrailConfigService, instance;
var init_guardrailConfigService = __esm({
  "server/services/guardrailConfigService.ts"() {
    "use strict";
    init_logger();
    init_optimizationSafetyGuardrails();
    log93 = createModuleLogger("GuardrailConfigService");
    HARD_LIMITS = {
      bid: {
        maxSingleChangePercent: { min: 0.05, max: 0.5 },
        // 5% ~ 50%
        maxDailyChangePercent: { min: 0.1, max: 0.6 },
        // 10% ~ 60%
        minBid: { min: 0.01, max: 0.1 },
        // $0.01 ~ $0.10
        maxBid: { min: 50, max: 500 },
        // $50 ~ $500
        consecutiveSameDirectionSlowdown: { min: 2, max: 7 },
        slowdownFactor: { min: 0.3, max: 0.8 }
      },
      budget: {
        maxSingleChangePercent: { min: 0.1, max: 0.5 },
        // 10% ~ 50%
        maxDailyChangePercent: { min: 0.15, max: 0.7 },
        // 15% ~ 70%
        minDailyBudget: { min: 0.5, max: 5 },
        // $0.50 ~ $5
        maxDailyBudget: { min: 1e4, max: 1e5 }
        // $10K ~ $100K
      },
      placement: {
        maxSingleChangePct: { min: 10, max: 50 },
        // 10 ~ 50 百分点
        maxTotalAdjustment: { min: 100, max: 900 },
        // 100% ~ 900%
        minTotalAdjustment: { min: -80, max: 0 }
        // -80% ~ 0%
      },
      emergency: {
        salesDropThreshold: { min: 0.2, max: 0.7 },
        // 20% ~ 70%
        spendSurgeThreshold: { min: 1.5, max: 5 },
        // 150% ~ 500%
        ordersDropThreshold: { min: 0.25, max: 0.8 },
        // 25% ~ 80%
        lookbackDays: { min: 1, max: 14 }
        // 1 ~ 14天
      }
    };
    GuardrailConfigService = class {
      static {
        __name(this, "GuardrailConfigService");
      }
      /** 内存缓存: scope:scopeKey -> ConfigEntry */
      cache = /* @__PURE__ */ new Map();
      /** 缓存有效期（毫秒） */
      cacheTTL = 5 * 60 * 1e3;
      // 5分钟
      /** 最后缓存刷新时间 */
      lastCacheRefresh = 0;
      constructor() {
        log93.info("\u5B89\u5168\u62A4\u680F\u52A8\u6001\u914D\u7F6E\u670D\u52A1\u521D\u59CB\u5316");
      }
      /**
       * 获取指定上下文的有效护栏配置
       * 按优先级合并: 账户级 > 广告类型级 > 全局默认
       */
      getEffectiveConfig(accountId, adType) {
        const config2 = this.deepClone(SAFETY_LIMITS2);
        const globalOverride = this.cache.get("global:default");
        if (globalOverride) {
          this.applyOverride(config2, globalOverride.overrides);
        }
        if (adType && adType !== "default") {
          const adTypeOverride = this.cache.get(`adType:${adType}`);
          if (adTypeOverride) {
            this.applyOverride(config2, adTypeOverride.overrides);
          }
        }
        if (accountId) {
          const accountOverride = this.cache.get(`account:${accountId}`);
          if (accountOverride) {
            this.applyOverride(config2, accountOverride.overrides);
          }
        }
        return config2;
      }
      /**
       * 设置配置覆盖
       * 自动验证硬编界限
       */
      setConfigOverride(scope, scopeKey, overrides, updatedBy) {
        const errors = this.validateOverrides(overrides);
        if (errors.length > 0) {
          return { success: false, errors };
        }
        const entry = {
          scope,
          scopeKey,
          overrides,
          updatedAt: /* @__PURE__ */ new Date(),
          updatedBy
        };
        const cacheKey = `${scope}:${scopeKey}`;
        this.cache.set(cacheKey, entry);
        log93.info(`\u5B89\u5168\u62A4\u680F\u914D\u7F6E\u5DF2\u66F4\u65B0: ${cacheKey}`, {
          scope,
          scopeKey,
          updatedBy,
          overrides: JSON.stringify(overrides)
        });
        this.persistToDatabase(entry).catch((err) => {
          log93.warn("\u6301\u4E45\u5316\u62A4\u680F\u914D\u7F6E\u5931\u8D25", err);
        });
        return { success: true, errors: [] };
      }
      /**
       * 删除配置覆盖，恢复默认
       */
      removeConfigOverride(scope, scopeKey) {
        const cacheKey = `${scope}:${scopeKey}`;
        const existed = this.cache.delete(cacheKey);
        if (existed) {
          log93.info(`\u5B89\u5168\u62A4\u680F\u914D\u7F6E\u5DF2\u5220\u9664: ${cacheKey}`);
          this.removeFromDatabase(scope, scopeKey).catch((err) => {
            log93.warn("\u4ECE\u6570\u636E\u5E93\u5220\u9664\u62A4\u680F\u914D\u7F6E\u5931\u8D25", err);
          });
        }
        return existed;
      }
      /**
       * 获取所有配置覆盖
       */
      getAllOverrides() {
        return Array.from(this.cache.values());
      }
      /**
       * 获取指定范围的配置覆盖
       */
      getOverride(scope, scopeKey) {
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
      async loadFromDatabase() {
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
          const db = await getDb3();
          if (!db) return;
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const rows = await db.execute(sql15`
        SELECT action_detail FROM optimization_events 
        WHERE event_category = 'guardrail_config' 
        AND status = 'active'
        ORDER BY created_at DESC
      `);
          if (rows && Array.isArray(rows) && rows.length > 0) {
            for (const row of rows) {
              try {
                const detail = JSON.parse(row.action_detail || "{}");
                if (detail.scope && detail.scopeKey && detail.overrides) {
                  const cacheKey = `${detail.scope}:${detail.scopeKey}`;
                  this.cache.set(cacheKey, {
                    scope: detail.scope,
                    scopeKey: detail.scopeKey,
                    overrides: detail.overrides,
                    updatedAt: new Date(detail.updatedAt || Date.now()),
                    updatedBy: detail.updatedBy || "system"
                  });
                }
              } catch {
              }
            }
            log93.info(`\u4ECE\u6570\u636E\u5E93\u52A0\u8F7D\u4E86 ${this.cache.size} \u6761\u62A4\u680F\u914D\u7F6E`);
          }
          this.lastCacheRefresh = Date.now();
        } catch (err) {
          log93.warn("\u4ECE\u6570\u636E\u5E93\u52A0\u8F7D\u62A4\u680F\u914D\u7F6E\u5931\u8D25", err);
        }
      }
      // ==================== 内部方法 ====================
      /**
       * 验证覆盖值是否在硬编界限内
       */
      validateOverrides(overrides) {
        const errors = [];
        if (overrides.bid) {
          for (const [key, value] of Object.entries(overrides.bid)) {
            const limit = HARD_LIMITS.bid[key];
            if (limit && (value < limit.min || value > limit.max)) {
              errors.push(`bid.${key}: ${value} \u8D85\u51FA\u5141\u8BB8\u8303\u56F4 [${limit.min}, ${limit.max}]`);
            }
          }
        }
        if (overrides.budget) {
          for (const [key, value] of Object.entries(overrides.budget)) {
            const limit = HARD_LIMITS.budget[key];
            if (limit && (value < limit.min || value > limit.max)) {
              errors.push(`budget.${key}: ${value} \u8D85\u51FA\u5141\u8BB8\u8303\u56F4 [${limit.min}, ${limit.max}]`);
            }
          }
        }
        if (overrides.placement) {
          for (const [key, value] of Object.entries(overrides.placement)) {
            const limit = HARD_LIMITS.placement[key];
            if (limit && (value < limit.min || value > limit.max)) {
              errors.push(`placement.${key}: ${value} \u8D85\u51FA\u5141\u8BB8\u8303\u56F4 [${limit.min}, ${limit.max}]`);
            }
          }
        }
        if (overrides.emergency) {
          for (const [key, value] of Object.entries(overrides.emergency)) {
            const limit = HARD_LIMITS.emergency[key];
            if (limit && (value < limit.min || value > limit.max)) {
              errors.push(`emergency.${key}: ${value} \u8D85\u51FA\u5141\u8BB8\u8303\u56F4 [${limit.min}, ${limit.max}]`);
            }
          }
        }
        return errors;
      }
      /**
       * 将覆盖值合并到配置中
       */
      applyOverride(config2, overrides) {
        if (overrides.bid) {
          Object.assign(config2.bid, overrides.bid);
        }
        if (overrides.budget) {
          Object.assign(config2.budget, overrides.budget);
        }
        if (overrides.placement) {
          Object.assign(config2.placement, overrides.placement);
        }
        if (overrides.emergency) {
          Object.assign(config2.emergency, overrides.emergency);
        }
      }
      /**
       * 深拷贝对象
       */
      deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
      }
      /**
       * 持久化配置到数据库
       */
      async persistToDatabase(entry) {
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
          const db = await getDb3();
          if (!db) return;
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          await db.execute(sql15`
        UPDATE optimization_events 
        SET status = 'inactive'
        WHERE event_category = 'guardrail_config'
        AND JSON_EXTRACT(action_detail, '$.scope') = ${entry.scope}
        AND JSON_EXTRACT(action_detail, '$.scopeKey') = ${entry.scopeKey}
      `);
          await db.execute(sql15`
        INSERT INTO optimization_events (
          account_id, event_category, action_type, action_detail, status, created_at
        ) VALUES (
          0, 'guardrail_config', 'config_update',
          ${JSON.stringify({
            scope: entry.scope,
            scopeKey: entry.scopeKey,
            overrides: entry.overrides,
            updatedAt: entry.updatedAt.toISOString(),
            updatedBy: entry.updatedBy
          })},
          'active',
          NOW()
        )
      `);
        } catch (err) {
          log93.warn("\u6301\u4E45\u5316\u62A4\u680F\u914D\u7F6E\u5230\u6570\u636E\u5E93\u5931\u8D25", err);
          throw err;
        }
      }
      /**
       * 从数据库删除配置
       */
      async removeFromDatabase(scope, scopeKey) {
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
          const db = await getDb3();
          if (!db) return;
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          await db.execute(sql15`
        UPDATE optimization_events 
        SET status = 'inactive'
        WHERE event_category = 'guardrail_config'
        AND JSON_EXTRACT(action_detail, '$.scope') = ${scope}
        AND JSON_EXTRACT(action_detail, '$.scopeKey') = ${scopeKey}
      `);
        } catch (err) {
          log93.warn("\u4ECE\u6570\u636E\u5E93\u5220\u9664\u62A4\u680F\u914D\u7F6E\u5931\u8D25", err);
        }
      }
    };
    instance = null;
    __name(getGuardrailConfigService, "getGuardrailConfigService");
    __name(initGuardrailConfigService, "initGuardrailConfigService");
  }
});

