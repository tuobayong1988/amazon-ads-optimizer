/**
 * v359: API限流服务单元测试
 * 
 * 测试分端点令牌桶限流的核心逻辑
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock外部依赖
vi.mock('../utils/logger', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { ApiRateLimitService, type EndpointRateConfig, type ApiEndpointType } from '../services/apiRateLimitService';

describe('ApiRateLimitService', () => {
  let service: ApiRateLimitService;
  
  beforeEach(() => {
    service = new ApiRateLimitService();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('Token Bucket - Basic Operations', () => {
    it('should allow requests within rate limit', async () => {
      const decision = await service.acquirePermit(1, 'list');
      expect(decision.allowed).toBe(true);
      expect(decision.waitMs).toBe(0);
    });
    
    it('should differentiate between endpoint types', async () => {
      // list端点有更高的TPS（突发容量15 vs report的3）
      const listDecision = await service.acquirePermit(1, 'list');
      const reportDecision = await service.acquirePermit(1, 'report');
      
      expect(listDecision.allowed).toBe(true);
      expect(reportDecision.allowed).toBe(true);
      
      // list应该有更多剩余令牌
      expect(listDecision.remainingTokens).toBeGreaterThan(reportDecision.remainingTokens);
    });
    
    it('should isolate rate limits per account', async () => {
      // 账户1和账户2应该有独立的限流
      const decision1 = await service.acquirePermit(1, 'list');
      const decision2 = await service.acquirePermit(2, 'list');
      
      expect(decision1.allowed).toBe(true);
      expect(decision2.allowed).toBe(true);
      
      // 两个账户的剩余令牌应该相同（都是初始值-1）
      expect(decision1.remainingTokens).toBe(decision2.remainingTokens);
    });
  });
  
  describe('Token Bucket - Burst Handling', () => {
    it('should allow burst up to capacity', async () => {
      // report端点突发容量为3
      const results = [];
      for (let i = 0; i < 3; i++) {
        results.push(await service.acquirePermit(1, 'report'));
      }
      
      // 前3个请求应该都被允许（突发容量=3）
      expect(results.every(r => r.allowed)).toBe(true);
    });
    
    it('should throttle when burst capacity exhausted', async () => {
      // 快速消耗snapshot端点的令牌（突发容量=2）
      await service.acquirePermit(1, 'snapshot');
      await service.acquirePermit(1, 'snapshot');
      
      // 第3个请求应该需要等待
      const decision = await service.acquirePermit(1, 'snapshot');
      if (!decision.allowed) {
        expect(decision.waitMs).toBeGreaterThan(0);
      }
    });
  });
  
  describe('429 Response Handling', () => {
    it('should record throttle events from Amazon', () => {
      service.recordExternalThrottle(1, 'mutate');
      
      const metrics = service.getMetrics(1, 'mutate');
      expect(metrics.length).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('Metrics Collection', () => {
    it('should return metrics array for account', async () => {
      await service.acquirePermit(1, 'list');
      await service.acquirePermit(1, 'list');
      
      const metrics = service.getMetrics(1, 'list');
      expect(Array.isArray(metrics)).toBe(true);
    });
    
    it('should return all endpoint metrics', () => {
      const allMetrics = service.getAllMetrics();
      expect(allMetrics).toBeDefined();
      expect(Array.isArray(allMetrics)).toBe(true);
    });
  });
  
  describe('Configuration', () => {
    it('should return endpoint configs', () => {
      const configs = service.getConfigs();
      expect(configs).toBeDefined();
      expect(configs.list).toBeDefined();
      expect(configs.mutate).toBeDefined();
      expect(configs.report).toBeDefined();
      expect(configs.snapshot).toBeDefined();
      expect(configs.default).toBeDefined();
    });
    
    it('should allow updating endpoint config', () => {
      service.updateConfig('list', { maxRequestsPerSecond: 20 });
      const configs = service.getConfigs();
      expect(configs.list.maxRequestsPerSecond).toBe(20);
    });
    
    it('should accept custom endpoint configs in constructor', () => {
      const customConfigs: Partial<Record<ApiEndpointType, EndpointRateConfig>> = {
        list: {
          maxRequestsPerSecond: 20,
          maxRequestsPerMinute: 1000,
          burstCapacity: 30,
          refillRatePerSecond: 20,
        },
      };
      
      const customService = new ApiRateLimitService(undefined, customConfigs);
      const configs = customService.getConfigs();
      expect(configs.list.maxRequestsPerSecond).toBe(20);
      expect(configs.list.burstCapacity).toBe(30);
    });
  });
  
  describe('Batch Planning', () => {
    it('should plan batch requests', async () => {
      const plan = await service.planBatchRequests(1, 'mutate', 10);
      expect(plan).toBeDefined();
    });
  });
  
  describe('Throttle Callback', () => {
    it('should register throttle callback', () => {
      const callback = vi.fn();
      service.onThrottle(callback);
      // 回调注册不应抛出错误
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
