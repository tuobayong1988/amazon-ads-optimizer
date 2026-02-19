import { describe, it, expect } from 'vitest';

// 测试出价调整历史记录相关的纯函数逻辑

describe('出价调整历史记录模块', () => {
  
  describe('出价变化百分比计算', () => {
    // 计算出价变化百分比的函数
    function calculateBidChangePercent(previousBid: number, newBid: number): number {
      if (previousBid <= 0) return 100;
      return ((newBid - previousBid) / previousBid) * 100;
    }
    
    it('应该正确计算出价提高的百分比', () => {
      expect(calculateBidChangePercent(1.0, 1.5)).toBeCloseTo(50, 1);
      expect(calculateBidChangePercent(2.0, 3.0)).toBeCloseTo(50, 1);
      expect(calculateBidChangePercent(0.5, 1.0)).toBeCloseTo(100, 1);
    });
    
    it('应该正确计算出价降低的百分比', () => {
      expect(calculateBidChangePercent(2.0, 1.0)).toBeCloseTo(-50, 1);
      expect(calculateBidChangePercent(1.5, 1.0)).toBeCloseTo(-33.33, 1);
      expect(calculateBidChangePercent(3.0, 2.0)).toBeCloseTo(-33.33, 1);
    });
    
    it('应该处理出价不变的情况', () => {
      expect(calculateBidChangePercent(1.0, 1.0)).toBe(0);
      expect(calculateBidChangePercent(2.5, 2.5)).toBe(0);
    });
    
    it('应该处理原出价为0的情况', () => {
      expect(calculateBidChangePercent(0, 1.0)).toBe(100);
      expect(calculateBidChangePercent(0, 0.5)).toBe(100);
    });
    
    it('应该处理负数原出价的情况', () => {
      expect(calculateBidChangePercent(-1, 1.0)).toBe(100);
    });
  });
  
  describe('调整类型标签', () => {
    const adjustmentTypeLabels: Record<string, string> = {
      manual: '手动调整',
      auto_optimal: '利润最优',
      auto_dayparting: '分时策略',
      auto_placement: '位置倾斜',
      batch_campaign: '批量活动',
      batch_group: '批量绩效组',
    };
    
    it('应该为所有调整类型提供标签', () => {
      expect(adjustmentTypeLabels['manual']).toBe('手动调整');
      expect(adjustmentTypeLabels['auto_optimal']).toBe('利润最优');
      expect(adjustmentTypeLabels['auto_dayparting']).toBe('分时策略');
      expect(adjustmentTypeLabels['auto_placement']).toBe('位置倾斜');
      expect(adjustmentTypeLabels['batch_campaign']).toBe('批量活动');
      expect(adjustmentTypeLabels['batch_group']).toBe('批量绩效组');
    });
    
    it('应该覆盖所有6种调整类型', () => {
      expect(Object.keys(adjustmentTypeLabels).length).toBe(6);
    });
  });
  
  describe('状态标签', () => {
    const statusLabels: Record<string, string> = {
      applied: '已应用',
      pending: '待处理',
      failed: '失败',
      rolled_back: '已回滚',
    };
    
    it('应该为所有状态提供标签', () => {
      expect(statusLabels['applied']).toBe('已应用');
      expect(statusLabels['pending']).toBe('待处理');
      expect(statusLabels['failed']).toBe('失败');
      expect(statusLabels['rolled_back']).toBe('已回滚');
    });
    
    it('应该覆盖所有4种状态', () => {
      expect(Object.keys(statusLabels).length).toBe(4);
    });
  });
  
  describe('分页计算', () => {
    function calculatePagination(total: number, page: number, pageSize: number) {
      const totalPages = Math.ceil(total / pageSize);
      const offset = (page - 1) * pageSize;
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;
      
      return { totalPages, offset, hasNextPage, hasPrevPage };
    }
    
    it('应该正确计算总页数', () => {
      expect(calculatePagination(100, 1, 20).totalPages).toBe(5);
      expect(calculatePagination(101, 1, 20).totalPages).toBe(6);
      expect(calculatePagination(50, 1, 50).totalPages).toBe(1);
      expect(calculatePagination(0, 1, 20).totalPages).toBe(0);
    });
    
    it('应该正确计算偏移量', () => {
      expect(calculatePagination(100, 1, 20).offset).toBe(0);
      expect(calculatePagination(100, 2, 20).offset).toBe(20);
      expect(calculatePagination(100, 3, 20).offset).toBe(40);
      expect(calculatePagination(100, 5, 20).offset).toBe(80);
    });
    
    it('应该正确判断是否有下一页', () => {
      expect(calculatePagination(100, 1, 20).hasNextPage).toBe(true);
      expect(calculatePagination(100, 4, 20).hasNextPage).toBe(true);
      expect(calculatePagination(100, 5, 20).hasNextPage).toBe(false);
    });
    
    it('应该正确判断是否有上一页', () => {
      expect(calculatePagination(100, 1, 20).hasPrevPage).toBe(false);
      expect(calculatePagination(100, 2, 20).hasPrevPage).toBe(true);
      expect(calculatePagination(100, 5, 20).hasPrevPage).toBe(true);
    });
  });
  
  describe('日期范围筛选', () => {
    function isWithinDateRange(date: string, startDate?: string, endDate?: string): boolean {
      if (!startDate && !endDate) return true;
      
      const dateTime = new Date(date).getTime();
      
      if (startDate && dateTime < new Date(startDate).getTime()) {
        return false;
      }
      
      if (endDate && dateTime > new Date(endDate).getTime()) {
        return false;
      }
      
      return true;
    }
    
    it('应该在没有日期限制时返回true', () => {
      expect(isWithinDateRange('2024-01-15')).toBe(true);
      expect(isWithinDateRange('2024-06-15')).toBe(true);
    });
    
    it('应该正确处理只有开始日期的情况', () => {
      expect(isWithinDateRange('2024-01-15', '2024-01-01')).toBe(true);
      expect(isWithinDateRange('2024-01-15', '2024-02-01')).toBe(false);
    });
    
    it('应该正确处理只有结束日期的情况', () => {
      expect(isWithinDateRange('2024-01-15', undefined, '2024-02-01')).toBe(true);
      expect(isWithinDateRange('2024-03-15', undefined, '2024-02-01')).toBe(false);
    });
    
    it('应该正确处理有开始和结束日期的情况', () => {
      expect(isWithinDateRange('2024-01-15', '2024-01-01', '2024-02-01')).toBe(true);
      expect(isWithinDateRange('2023-12-15', '2024-01-01', '2024-02-01')).toBe(false);
      expect(isWithinDateRange('2024-03-15', '2024-01-01', '2024-02-01')).toBe(false);
    });
  });
  
  describe('统计数据聚合', () => {
    interface AdjustmentRecord {
      bidChangePercent: number;
      expectedProfitIncrease: number;
      adjustmentType: string;
    }
    
    function aggregateStats(records: AdjustmentRecord[]) {
      if (records.length === 0) {
        return {
          totalAdjustments: 0,
          totalProfitIncrease: 0,
          avgBidChange: 0,
          increasedCount: 0,
          decreasedCount: 0,
        };
      }
      
      const totalProfitIncrease = records.reduce((sum, r) => sum + r.expectedProfitIncrease, 0);
      const avgBidChange = records.reduce((sum, r) => sum + r.bidChangePercent, 0) / records.length;
      const increasedCount = records.filter(r => r.bidChangePercent > 0).length;
      const decreasedCount = records.filter(r => r.bidChangePercent < 0).length;
      
      return {
        totalAdjustments: records.length,
        totalProfitIncrease,
        avgBidChange,
        increasedCount,
        decreasedCount,
      };
    }
    
    it('应该正确计算空记录的统计', () => {
      const stats = aggregateStats([]);
      expect(stats.totalAdjustments).toBe(0);
      expect(stats.totalProfitIncrease).toBe(0);
      expect(stats.avgBidChange).toBe(0);
    });
    
    it('应该正确计算总调整次数', () => {
      const records = [
        { bidChangePercent: 10, expectedProfitIncrease: 5, adjustmentType: 'auto_optimal' },
        { bidChangePercent: -5, expectedProfitIncrease: 3, adjustmentType: 'auto_optimal' },
        { bidChangePercent: 15, expectedProfitIncrease: 8, adjustmentType: 'manual' },
      ];
      expect(aggregateStats(records).totalAdjustments).toBe(3);
    });
    
    it('应该正确计算总利润提升', () => {
      const records = [
        { bidChangePercent: 10, expectedProfitIncrease: 5, adjustmentType: 'auto_optimal' },
        { bidChangePercent: -5, expectedProfitIncrease: 3, adjustmentType: 'auto_optimal' },
        { bidChangePercent: 15, expectedProfitIncrease: 8, adjustmentType: 'manual' },
      ];
      expect(aggregateStats(records).totalProfitIncrease).toBe(16);
    });
    
    it('应该正确计算平均出价变化', () => {
      const records = [
        { bidChangePercent: 10, expectedProfitIncrease: 5, adjustmentType: 'auto_optimal' },
        { bidChangePercent: -5, expectedProfitIncrease: 3, adjustmentType: 'auto_optimal' },
        { bidChangePercent: 15, expectedProfitIncrease: 8, adjustmentType: 'manual' },
      ];
      expect(aggregateStats(records).avgBidChange).toBeCloseTo(6.67, 1);
    });
    
    it('应该正确统计提高和降低的次数', () => {
      const records = [
        { bidChangePercent: 10, expectedProfitIncrease: 5, adjustmentType: 'auto_optimal' },
        { bidChangePercent: -5, expectedProfitIncrease: 3, adjustmentType: 'auto_optimal' },
        { bidChangePercent: 15, expectedProfitIncrease: 8, adjustmentType: 'manual' },
        { bidChangePercent: 0, expectedProfitIncrease: 0, adjustmentType: 'manual' },
      ];
      const stats = aggregateStats(records);
      expect(stats.increasedCount).toBe(2);
      expect(stats.decreasedCount).toBe(1);
    });
  });
  
  describe('CSV导出格式', () => {
    function formatRecordForCSV(record: {
      appliedAt: string;
      campaignName: string;
      keywordText: string;
      previousBid: number;
      newBid: number;
      bidChangePercent: number;
      adjustmentType: string;
    }): string[] {
      return [
        record.appliedAt,
        record.campaignName || '-',
        record.keywordText || '-',
        `$${record.previousBid.toFixed(2)}`,
        `$${record.newBid.toFixed(2)}`,
        `${record.bidChangePercent.toFixed(1)}%`,
        record.adjustmentType,
      ];
    }
    
    it('应该正确格式化记录为CSV行', () => {
      const record = {
        appliedAt: '2024-01-15 10:30:00',
        campaignName: 'Test Campaign',
        keywordText: 'test keyword',
        previousBid: 1.5,
        newBid: 2.0,
        bidChangePercent: 33.33,
        adjustmentType: 'auto_optimal',
      };
      
      const row = formatRecordForCSV(record);
      expect(row[0]).toBe('2024-01-15 10:30:00');
      expect(row[1]).toBe('Test Campaign');
      expect(row[2]).toBe('test keyword');
      expect(row[3]).toBe('$1.50');
      expect(row[4]).toBe('$2.00');
      expect(row[5]).toBe('33.3%');
      expect(row[6]).toBe('auto_optimal');
    });
    
    it('应该处理空值', () => {
      const record = {
        appliedAt: '2024-01-15',
        campaignName: '',
        keywordText: '',
        previousBid: 0,
        newBid: 1.0,
        bidChangePercent: 100,
        adjustmentType: 'manual',
      };
      
      const row = formatRecordForCSV(record);
      expect(row[1]).toBe('-');
      expect(row[2]).toBe('-');
      expect(row[3]).toBe('$0.00');
    });
  });
});
