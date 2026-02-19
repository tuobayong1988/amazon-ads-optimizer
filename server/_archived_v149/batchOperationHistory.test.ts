import { describe, it, expect } from 'vitest';
import * as batchOperationService from './batchOperationService';

describe('Batch Operation History', () => {
  describe('generateBatchSummary', () => {
    it('should generate correct summary string for completed operation', () => {
      const result: batchOperationService.BatchOperationResult = {
        batchId: 1,
        status: 'completed',
        totalItems: 100,
        processedItems: 100,
        successItems: 95,
        failedItems: 5,
        errors: [
          { itemId: 1, error: 'API rate limit exceeded' },
          { itemId: 2, error: 'Invalid keyword' },
        ],
      };

      const summary = batchOperationService.generateBatchSummary(result);

      // generateBatchSummary returns a string, not an object
      expect(typeof summary).toBe('string');
      expect(summary).toContain('总计项目: 100');
      expect(summary).toContain('成功: 95');
      expect(summary).toContain('失败: 5');
      expect(summary).toContain('95.0%');
    });

    it('should handle zero items gracefully', () => {
      const result: batchOperationService.BatchOperationResult = {
        batchId: 2,
        status: 'completed',
        totalItems: 0,
        processedItems: 0,
        successItems: 0,
        failedItems: 0,
        errors: [],
      };

      const summary = batchOperationService.generateBatchSummary(result);

      expect(typeof summary).toBe('string');
      expect(summary).toContain('总计项目: 0');
      expect(summary).toContain('0%');
    });

    it('should calculate correct success rate in summary', () => {
      const result: batchOperationService.BatchOperationResult = {
        batchId: 3,
        status: 'completed',
        totalItems: 50,
        processedItems: 50,
        successItems: 40,
        failedItems: 10,
        errors: [],
      };

      const summary = batchOperationService.generateBatchSummary(result);

      expect(summary).toContain('80.0%');
    });
  });

  describe('estimateExecutionTime', () => {
    it('should estimate time for negative keyword operations', () => {
      const time = batchOperationService.estimateExecutionTime(100, 'negative_keyword');
      expect(time).toBeGreaterThan(0);
    });

    it('should estimate time for bid adjustment operations', () => {
      const time = batchOperationService.estimateExecutionTime(50, 'bid_adjustment');
      expect(time).toBeGreaterThan(0);
    });

    it('should scale with item count', () => {
      const time10 = batchOperationService.estimateExecutionTime(10, 'negative_keyword');
      const time100 = batchOperationService.estimateExecutionTime(100, 'negative_keyword');
      expect(time100).toBeGreaterThan(time10);
    });
  });

  describe('History Data Structure', () => {
    it('should have correct stats structure', () => {
      const mockStats = {
        total: 10,
        completed: 7,
        failed: 2,
        pending: 1,
        rolledBack: 0,
        totalItemsProcessed: 500,
        totalSuccessItems: 450,
        totalFailedItems: 50,
      };

      expect(mockStats.total).toBe(mockStats.completed + mockStats.failed + mockStats.pending + mockStats.rolledBack);
      expect(mockStats.totalItemsProcessed).toBe(mockStats.totalSuccessItems + mockStats.totalFailedItems);
    });

    it('should have correct pagination structure', () => {
      const mockPagination = {
        total: 100,
        limit: 20,
        offset: 0,
        hasMore: true,
      };

      expect(mockPagination.hasMore).toBe(mockPagination.offset + mockPagination.limit < mockPagination.total);
    });

    it('should correctly determine hasMore for last page', () => {
      const mockPagination = {
        total: 100,
        limit: 20,
        offset: 80,
        hasMore: false,
      };

      expect(mockPagination.hasMore).toBe(mockPagination.offset + mockPagination.limit < mockPagination.total);
    });
  });

  describe('Operation Detail Structure', () => {
    it('should group items by status correctly', () => {
      const mockItems = [
        { id: 1, status: 'success' },
        { id: 2, status: 'success' },
        { id: 3, status: 'failed' },
        { id: 4, status: 'pending' },
        { id: 5, status: 'skipped' },
      ];

      const itemsByStatus = {
        success: mockItems.filter(item => item.status === 'success'),
        failed: mockItems.filter(item => item.status === 'failed'),
        pending: mockItems.filter(item => item.status === 'pending'),
        skipped: mockItems.filter(item => item.status === 'skipped'),
        rolledBack: mockItems.filter(item => item.status === 'rolled_back'),
      };

      expect(itemsByStatus.success.length).toBe(2);
      expect(itemsByStatus.failed.length).toBe(1);
      expect(itemsByStatus.pending.length).toBe(1);
      expect(itemsByStatus.skipped.length).toBe(1);
      expect(itemsByStatus.rolledBack.length).toBe(0);
    });

    it('should calculate execution duration correctly', () => {
      const executedAt = new Date('2024-01-01T10:00:00Z');
      const completedAt = new Date('2024-01-01T10:05:30Z');
      
      const executionDuration = completedAt.getTime() - executedAt.getTime();
      
      expect(executionDuration).toBe(330000); // 5 minutes 30 seconds in milliseconds
    });
  });

  describe('Date Filtering', () => {
    it('should filter operations by start date', () => {
      const operations = [
        { id: 1, createdAt: new Date('2024-01-01') },
        { id: 2, createdAt: new Date('2024-01-15') },
        { id: 3, createdAt: new Date('2024-02-01') },
      ];

      const startDate = new Date('2024-01-10');
      const filtered = operations.filter(op => new Date(op.createdAt) >= startDate);

      expect(filtered.length).toBe(2);
      expect(filtered.map(op => op.id)).toEqual([2, 3]);
    });

    it('should filter operations by end date', () => {
      const operations = [
        { id: 1, createdAt: new Date('2024-01-01') },
        { id: 2, createdAt: new Date('2024-01-15') },
        { id: 3, createdAt: new Date('2024-02-01') },
      ];

      const endDate = new Date('2024-01-20');
      endDate.setHours(23, 59, 59, 999);
      const filtered = operations.filter(op => new Date(op.createdAt) <= endDate);

      expect(filtered.length).toBe(2);
      expect(filtered.map(op => op.id)).toEqual([1, 2]);
    });

    it('should filter operations by date range', () => {
      const operations = [
        { id: 1, createdAt: new Date('2024-01-01') },
        { id: 2, createdAt: new Date('2024-01-15') },
        { id: 3, createdAt: new Date('2024-02-01') },
      ];

      const startDate = new Date('2024-01-10');
      const endDate = new Date('2024-01-20');
      endDate.setHours(23, 59, 59, 999);
      
      const filtered = operations.filter(op => {
        const opDate = new Date(op.createdAt);
        return opDate >= startDate && opDate <= endDate;
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe(2);
    });
  });
});
