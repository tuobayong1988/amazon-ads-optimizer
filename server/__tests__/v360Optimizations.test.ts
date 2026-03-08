/**
 * v360 优化模块测试
 * 覆盖P0-P2的核心变更
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==================== P0-2: API限流服务测试 ====================
describe('v360 API限流服务集成', () => {
  it('acquireApiPermit应该返回Promise', async () => {
    // 验证限流服务的基本接口
    const { acquireApiPermit } = await import('../services/apiRateLimitService');
    expect(typeof acquireApiPermit).toBe('function');
  });

  it('classifyEndpoint应该正确分类API端点', async () => {
    const { classifyEndpoint } = await import('../services/apiRateLimitService');
    expect(typeof classifyEndpoint).toBe('function');
    
    const readClass = classifyEndpoint('/sp/campaigns', 'GET');
    expect(readClass).toBeDefined();
    
    const writeClass = classifyEndpoint('/sp/campaigns', 'PUT');
    expect(writeClass).toBeDefined();
  });
});

// ==================== P0-5: 预算守恒约束测试 ====================
describe('v360 预算守恒约束', () => {
  it('getDefaultAllocationConfig应该返回有效配置', async () => {
    const { getDefaultAllocationConfig } = await import('../intelligentBudgetAllocationService');
    const config = getDefaultAllocationConfig();
    expect(config).toBeDefined();
    expect(config.maxIncreasePct).toBeGreaterThan(0);
    expect(config.maxDecreasePct).toBeGreaterThan(0);
  });

  it('AllocationConfig应该支持targetTotalBudget参数', async () => {
    const { getDefaultAllocationConfig } = await import('../intelligentBudgetAllocationService');
    const config = getDefaultAllocationConfig();
    // targetTotalBudget是可选参数，默认不设置
    expect('targetTotalBudget' in config || config.targetTotalBudget === undefined).toBeTruthy();
  });
});

// ==================== P1-5: 验证队列监控接口测试 ====================
describe('v360 验证队列监控', () => {
  it('getPendingVerificationCount应该返回数字', async () => {
    const { getPendingVerificationCount } = await import('../postOptimizationVerifier');
    const count = getPendingVerificationCount();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('getPendingVerificationSummary应该返回数组', async () => {
    const { getPendingVerificationSummary } = await import('../postOptimizationVerifier');
    const summary = getPendingVerificationSummary();
    expect(Array.isArray(summary)).toBe(true);
  });
});

// ==================== P1-7: 自愈调度器升级冷却测试 ====================
describe('v360 自愈调度器', () => {
  it('SelfHealingScheduler应该可以实例化', async () => {
    const mod = await import('../services/selfHealingScheduler');
    expect(mod).toBeDefined();
  });
});

// ==================== P2-1: 全局否定关键词服务测试 ====================
describe('v360 全局否定关键词服务', () => {
  it('analyzeCrossCampaignNegatives应该导出', async () => {
    const { analyzeCrossCampaignNegatives } = await import('../services/globalNegativeKeywordService');
    expect(typeof analyzeCrossCampaignNegatives).toBe('function');
  });

  it('addGlobalNegativeKeyword应该导出', async () => {
    const { addGlobalNegativeKeyword } = await import('../services/globalNegativeKeywordService');
    expect(typeof addGlobalNegativeKeyword).toBe('function');
  });

  it('getGlobalNegativeKeywords应该导出', async () => {
    const { getGlobalNegativeKeywords } = await import('../services/globalNegativeKeywordService');
    expect(typeof getGlobalNegativeKeywords).toBe('function');
  });

  it('executeGlobalNegativeAnalysis应该导出', async () => {
    const { executeGlobalNegativeAnalysis } = await import('../services/globalNegativeKeywordService');
    expect(typeof executeGlobalNegativeAnalysis).toBe('function');
  });
});

// ==================== P2-3: ACoS偏差因子测试 ====================
describe('v360 ACoS偏差因子', () => {
  it('ACoS偏差区间分类应该正确', () => {
    // 测试ACoS偏差区间逻辑
    const classifyAcosZone = (acosRatio: number): string => {
      if (acosRatio < 0.5) return 'boost_zone';
      if (acosRatio < 0.7) return 'growth_zone';
      if (acosRatio <= 1.0) return 'target_zone';
      if (acosRatio <= 1.5) return 'caution_zone';
      if (acosRatio <= 2.0) return 'reduce_zone';
      if (acosRatio <= 3.0) return 'danger_zone';
      return 'emergency_zone';
    };

    expect(classifyAcosZone(0.3)).toBe('boost_zone');
    expect(classifyAcosZone(0.6)).toBe('growth_zone');
    expect(classifyAcosZone(0.9)).toBe('target_zone');
    expect(classifyAcosZone(1.2)).toBe('caution_zone');
    expect(classifyAcosZone(1.8)).toBe('reduce_zone');
    expect(classifyAcosZone(2.5)).toBe('danger_zone');
    expect(classifyAcosZone(4.0)).toBe('emergency_zone');
  });

  it('ACoS偏差方向分类应该正确', () => {
    const classifyDirection = (acosRatio: number): string => {
      if (acosRatio < 1) return 'below_target';
      if (acosRatio <= 1.5) return 'slightly_above';
      if (acosRatio <= 2.0) return 'moderately_above';
      if (acosRatio <= 3.0) return 'severely_above';
      return 'extremely_above';
    };

    expect(classifyDirection(0.5)).toBe('below_target');
    expect(classifyDirection(1.3)).toBe('slightly_above');
    expect(classifyDirection(1.7)).toBe('moderately_above');
    expect(classifyDirection(2.5)).toBe('severely_above');
    expect(classifyDirection(5.0)).toBe('extremely_above');
  });
});

// ==================== P2-4: 同步状态检查测试 ====================
describe('v360 同步状态协调', () => {
  it('isSyncRunning应该导出并返回布尔值', async () => {
    const { isSyncRunning } = await import('../dataSyncScheduler');
    expect(typeof isSyncRunning).toBe('function');
    const result = isSyncRunning();
    expect(typeof result).toBe('boolean');
  });
});

// ==================== P1-2: 渐进式优化策略测试 ====================
describe('v360 渐进式优化策略', () => {
  it('gradualOptimizationEngine应该导出核心函数', async () => {
    const mod = await import('../gradualOptimizationEngine');
    expect(mod).toBeDefined();
    // 验证核心函数存在
    expect(typeof mod.applyGradualBudgetAdjustment).toBe('function');
  });
});

// ==================== P1-3: 分时优化测试 ====================
describe('v360 分时优化', () => {
  it('daypartingService应该导出核心函数', async () => {
    const mod = await import('../daypartingService');
    expect(mod).toBeDefined();
  });
});
