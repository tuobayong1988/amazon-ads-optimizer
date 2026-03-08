/**
 * v359: 可靠指令确认服务单元测试
 * 
 * 测试确认队列、自适应延迟、重试机制
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

vi.mock('../utils/opsLogger', () => ({
  logSync: vi.fn(),
  logSyncError: vi.fn(),
}));

// Mock confirmationSync
vi.mock('../unifiedSyncEngine', () => ({
  confirmationSync: vi.fn().mockResolvedValue({
    success: true,
    completedSteps: 3,
    totalSteps: 3,
    totalSynced: 15,
    durationMs: 500,
  }),
}));

import { CommandConfirmationService, type ConfirmationRequest } from '../services/commandConfirmationService';

describe('CommandConfirmationService', () => {
  let service: CommandConfirmationService;
  
  beforeEach(() => {
    service = new CommandConfirmationService();
  });
  
  afterEach(() => {
    service.stop();
    vi.restoreAllMocks();
  });
  
  describe('Request Submission', () => {
    it('should submit a confirmation request and return an ID', () => {
      const requestId = service.submitConfirmation(
        1, ['keywords'], 'test', 'bid_change'
      );
      
      expect(requestId).toBeDefined();
      expect(requestId).toContain('confirm-1-');
    });
    
    it('should create request with correct initial status', () => {
      const requestId = service.submitConfirmation(
        1, ['keywords'], 'test', 'bid_change'
      );
      
      const request = service.getRequestStatus(requestId);
      expect(request).not.toBeNull();
      expect(request!.status).toBe('waiting');
      expect(request!.retryCount).toBe(0);
      expect(request!.maxRetries).toBe(3);
    });
    
    it('should set correct operation type', () => {
      const bidId = service.submitConfirmation(1, ['keywords'], 'test', 'bid_change');
      const statusId = service.submitConfirmation(1, ['campaigns'], 'test', 'status_change');
      const budgetId = service.submitConfirmation(1, ['budgets'], 'test', 'budget_change');
      
      expect(service.getRequestStatus(bidId)!.operationType).toBe('bid_change');
      expect(service.getRequestStatus(statusId)!.operationType).toBe('status_change');
      expect(service.getRequestStatus(budgetId)!.operationType).toBe('budget_change');
    });
    
    it('should handle multiple affected entities', () => {
      const requestId = service.submitConfirmation(
        1, ['keywords', 'campaigns', 'budgets'], 'test', 'general'
      );
      
      const request = service.getRequestStatus(requestId);
      expect(request!.affectedEntities).toEqual(['keywords', 'campaigns', 'budgets']);
    });
  });
  
  describe('Adaptive Delay', () => {
    it('should use operation-type-specific initial delays', () => {
      const bidId = service.submitConfirmation(1, ['keywords'], 'test', 'bid_change');
      const keywordId = service.submitConfirmation(1, ['keywords'], 'test', 'keyword_create');
      
      const bidRequest = service.getRequestStatus(bidId)!;
      const keywordRequest = service.getRequestStatus(keywordId)!;
      
      // keyword_create应该有更长的延迟
      const bidDelay = bidRequest.expectedReadyAt.getTime() - bidRequest.createdAt.getTime();
      const keywordDelay = keywordRequest.expectedReadyAt.getTime() - keywordRequest.createdAt.getTime();
      
      expect(keywordDelay).toBeGreaterThan(bidDelay);
    });
  });
  
  describe('Queue Management', () => {
    it('should return null for non-existent request', () => {
      const result = service.getRequestStatus('non-existent-id');
      expect(result).toBeNull();
    });
    
    it('should handle multiple concurrent requests', () => {
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(service.submitConfirmation(i, ['keywords'], `test-${i}`, 'bid_change'));
      }
      
      expect(ids.length).toBe(10);
      // 所有请求应该有唯一ID
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });
  });
  
  describe('Metrics', () => {
    it('should track total requests', () => {
      service.submitConfirmation(1, ['keywords'], 'test1', 'bid_change');
      service.submitConfirmation(2, ['campaigns'], 'test2', 'status_change');
      service.submitConfirmation(3, ['budgets'], 'test3', 'budget_change');
      
      const metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.pendingRequests).toBe(3);
    });
    
    it('should report zero success rate initially', () => {
      const metrics = service.getMetrics();
      expect(metrics.confirmationSuccessRate).toBe(0);
      expect(metrics.avgConfirmationTimeMs).toBe(0);
    });
  });
  
  describe('Service Lifecycle', () => {
    it('should start and stop without errors', () => {
      service.start();
      expect(() => service.stop()).not.toThrow();
    });
    
    it('should handle double start gracefully', () => {
      service.start();
      expect(() => service.start()).not.toThrow();
      service.stop();
    });
    
    it('should handle stop without start', () => {
      expect(() => service.stop()).not.toThrow();
    });
  });
});
