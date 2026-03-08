/**
 * v359: 独立自愈调度器单元测试
 * 
 * 测试自愈任务的调度、执行和生命周期管理
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

vi.mock('../utils/asyncMutex', () => ({
  AsyncMutex: class {
    async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    }
  },
}));

vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

import { SelfHealingScheduler, type SelfHealingStatus } from '../services/selfHealingScheduler';

describe('SelfHealingScheduler', () => {
  let scheduler: SelfHealingScheduler;
  
  beforeEach(() => {
    scheduler = new SelfHealingScheduler();
  });
  
  afterEach(() => {
    scheduler.stop();
    vi.restoreAllMocks();
  });
  
  describe('Task Registration', () => {
    it('should register a healing task', () => {
      scheduler.registerTask({
        id: 'test-probe',
        name: '测试探针',
        level: 'probe',
        intervalMs: 60000,
        enabled: true,
        timeoutMs: 30000,
        execute: vi.fn().mockResolvedValue({
          success: true,
          issuesFound: 0,
          issuesFixed: 0,
          details: 'OK',
        }),
      });
      
      const status = scheduler.getStatus();
      expect(status.taskStatuses['test-probe']).toBeDefined();
    });
    
    it('should register tasks at different levels', () => {
      const levels = ['probe', 'check', 'repair', 'emergency'] as const;
      
      for (const level of levels) {
        scheduler.registerTask({
          id: `task-${level}`,
          name: `${level}任务`,
          level,
          intervalMs: 60000,
          enabled: true,
          timeoutMs: 30000,
          execute: vi.fn().mockResolvedValue({
            success: true,
            issuesFound: 0,
            issuesFixed: 0,
            details: 'OK',
          }),
        });
      }
      
      const status = scheduler.getStatus();
      levels.forEach(level => {
        expect(status.taskStatuses[`task-${level}`]).toBeDefined();
      });
    });
  });
  
  describe('Lifecycle Management', () => {
    it('should start without errors', () => {
      scheduler.registerTask({
        id: 'lifecycle-test',
        name: '生命周期测试',
        level: 'probe',
        intervalMs: 60000,
        enabled: true,
        timeoutMs: 30000,
        execute: vi.fn().mockResolvedValue({
          success: true, issuesFound: 0, issuesFixed: 0, details: 'OK',
        }),
      });
      
      scheduler.start();
      expect(scheduler.getStatus().running).toBe(true);
    });
    
    it('should stop without errors', () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.getStatus().running).toBe(false);
    });
    
    it('should handle stop without start', () => {
      expect(() => scheduler.stop()).not.toThrow();
    });
  });
  
  describe('Status Reporting', () => {
    it('should report initial status correctly', () => {
      const status = scheduler.getStatus();
      expect(status.running).toBe(false);
      expect(status.totalExecutions).toBe(0);
      expect(status.totalIssuesFound).toBe(0);
      expect(status.totalIssuesFixed).toBe(0);
      expect(status.startedAt).toBeNull();
    });
    
    it('should track started time after start', () => {
      scheduler.start();
      const status = scheduler.getStatus();
      expect(status.startedAt).not.toBeNull();
    });
  });
  
  describe('Task Enable/Disable', () => {
    it('should enable and disable tasks', () => {
      scheduler.registerTask({
        id: 'toggle-task',
        name: '可切换任务',
        level: 'check',
        intervalMs: 60000,
        enabled: true,
        timeoutMs: 30000,
        execute: vi.fn().mockResolvedValue({
          success: true, issuesFound: 0, issuesFixed: 0, details: 'OK',
        }),
      });
      
      // 禁用
      scheduler.setTaskEnabled('toggle-task', false);
      expect(scheduler.getStatus().taskStatuses['toggle-task'].enabled).toBe(false);
      
      // 启用
      scheduler.setTaskEnabled('toggle-task', true);
      expect(scheduler.getStatus().taskStatuses['toggle-task'].enabled).toBe(true);
    });
  });
  
  describe('Execution History', () => {
    it('should return empty history initially', () => {
      const history = scheduler.getRecentHistory();
      expect(history).toEqual([]);
    });
    
    it('should respect history limit parameter', () => {
      const history = scheduler.getRecentHistory(5);
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });
});
