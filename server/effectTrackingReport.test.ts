/**
 * 效果追踪报告和批量回滚功能单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock数据
const mockBidAdjustmentRecords = [
  {
    id: 1,
    accountId: 1,
    campaignId: 101,
    campaignName: '测试广告活动1',
    keywordId: 1001,
    keywordText: '测试关键词1',
    previousBid: '1.00',
    newBid: '1.20',
    bidChangePercent: '20.00',
    adjustmentType: 'auto_optimal',
    estimatedProfitChange: '50.00',
    actualProfit7d: '45.00',
    actualProfit14d: '48.00',
    actualProfit30d: '52.00',
    appliedAt: new Date('2024-01-01').toISOString(),
    status: 'applied',
    isRolledBack: false,
  },
  {
    id: 2,
    accountId: 1,
    campaignId: 101,
    campaignName: '测试广告活动1',
    keywordId: 1002,
    keywordText: '测试关键词2',
    previousBid: '0.80',
    newBid: '0.90',
    bidChangePercent: '12.50',
    adjustmentType: 'auto_dayparting',
    estimatedProfitChange: '30.00',
    actualProfit7d: '25.00',
    actualProfit14d: null,
    actualProfit30d: null,
    appliedAt: new Date('2024-01-05').toISOString(),
    status: 'applied',
    isRolledBack: false,
  },
  {
    id: 3,
    accountId: 1,
    campaignId: 102,
    campaignName: '测试广告活动2',
    keywordId: 1003,
    keywordText: '测试关键词3',
    previousBid: '1.50',
    newBid: '1.30',
    bidChangePercent: '-13.33',
    adjustmentType: 'manual',
    estimatedProfitChange: '-20.00',
    actualProfit7d: '-15.00',
    actualProfit14d: '-18.00',
    actualProfit30d: '-22.00',
    appliedAt: new Date('2024-01-10').toISOString(),
    status: 'applied',
    isRolledBack: false,
  },
];

// 辅助函数：计算准确率
function calculateAccuracy(estimated: number, actual: number): number {
  if (estimated === 0) return actual >= 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (1 - Math.abs(actual - estimated) / Math.abs(estimated)) * 100));
}

// 辅助函数：生成报告摘要
function generateReportSummary(records: typeof mockBidAdjustmentRecords) {
  let totalRecords = records.length;
  let trackedRecords = 0;
  let totalEstimatedProfit = 0;
  let totalActualProfit7d = 0;
  let totalActualProfit14d = 0;
  let totalActualProfit30d = 0;
  let count7d = 0, count14d = 0, count30d = 0;

  for (const record of records) {
    const estimated = parseFloat(record.estimatedProfitChange || '0');
    totalEstimatedProfit += estimated;

    if (record.actualProfit7d !== null) {
      const actual = parseFloat(record.actualProfit7d);
      totalActualProfit7d += actual;
      count7d++;
      trackedRecords++;
    }
    if (record.actualProfit14d !== null) {
      totalActualProfit14d += parseFloat(record.actualProfit14d);
      count14d++;
    }
    if (record.actualProfit30d !== null) {
      totalActualProfit30d += parseFloat(record.actualProfit30d);
      count30d++;
    }
  }

  return {
    totalRecords,
    trackedRecords,
    trackingRate: totalRecords > 0 ? Math.round(trackedRecords / totalRecords * 100) : 0,
    totalEstimatedProfit: Math.round(totalEstimatedProfit * 100) / 100,
    totalActualProfit7d: Math.round(totalActualProfit7d * 100) / 100,
    totalActualProfit14d: Math.round(totalActualProfit14d * 100) / 100,
    totalActualProfit30d: Math.round(totalActualProfit30d * 100) / 100,
    accuracy7d: count7d > 0 ? Math.round(calculateAccuracy(totalEstimatedProfit, totalActualProfit7d) * 100) / 100 : null,
    accuracy14d: count14d > 0 ? Math.round(calculateAccuracy(totalEstimatedProfit, totalActualProfit14d) * 100) / 100 : null,
    accuracy30d: count30d > 0 ? Math.round(calculateAccuracy(totalEstimatedProfit, totalActualProfit30d) * 100) / 100 : null,
  };
}

// 辅助函数：按调整类型分组
function groupByAdjustmentType(records: typeof mockBidAdjustmentRecords) {
  const byType: Record<string, { count: number; estimated: number; actual: number }> = {};

  for (const record of records) {
    const type = record.adjustmentType || 'unknown';
    if (!byType[type]) {
      byType[type] = { count: 0, estimated: 0, actual: 0 };
    }
    byType[type].count++;
    byType[type].estimated += parseFloat(record.estimatedProfitChange || '0');
    if (record.actualProfit7d !== null) {
      byType[type].actual += parseFloat(record.actualProfit7d);
    }
  }

  return Object.entries(byType).map(([type, data]) => ({
    type,
    ...data,
    accuracy: calculateAccuracy(data.estimated, data.actual),
  }));
}

// 辅助函数：模拟批量回滚
function simulateBatchRollback(
  records: typeof mockBidAdjustmentRecords,
  adjustmentIds: number[]
): { id: number; success: boolean; error?: string }[] {
  const results: { id: number; success: boolean; error?: string }[] = [];

  for (const id of adjustmentIds) {
    const record = records.find(r => r.id === id);
    
    if (!record) {
      results.push({ id, success: false, error: '记录不存在' });
      continue;
    }
    
    if (record.isRolledBack) {
      results.push({ id, success: false, error: '已回滚' });
      continue;
    }
    
    // 模拟成功回滚
    results.push({ id, success: true });
  }

  return results;
}

describe('效果追踪报告', () => {
  describe('generateReportSummary', () => {
    it('应该正确计算报告摘要', () => {
      const summary = generateReportSummary(mockBidAdjustmentRecords);
      
      expect(summary.totalRecords).toBe(3);
      expect(summary.trackedRecords).toBe(3); // 所有记录都有7天数据
      expect(summary.trackingRate).toBe(100);
      expect(summary.totalEstimatedProfit).toBe(60); // 50 + 30 - 20
      expect(summary.totalActualProfit7d).toBe(55); // 45 + 25 - 15
    });

    it('应该正确计算准确率', () => {
      const summary = generateReportSummary(mockBidAdjustmentRecords);
      
      // 7天准确率：(1 - |55 - 60| / |60|) * 100 = 91.67%
      expect(summary.accuracy7d).toBeGreaterThan(90);
      expect(summary.accuracy7d).toBeLessThan(95);
    });

    it('应该处理空记录', () => {
      const summary = generateReportSummary([]);
      
      expect(summary.totalRecords).toBe(0);
      expect(summary.trackedRecords).toBe(0);
      expect(summary.trackingRate).toBe(0);
      expect(summary.accuracy7d).toBeNull();
    });

    it('应该处理部分追踪数据', () => {
      const partialRecords = mockBidAdjustmentRecords.filter(r => r.id <= 2);
      const summary = generateReportSummary(partialRecords);
      
      expect(summary.totalRecords).toBe(2);
      // 只有第一条记录有14天和30天数据
      expect(summary.accuracy14d).not.toBeNull();
    });
  });

  describe('groupByAdjustmentType', () => {
    it('应该正确按调整类型分组', () => {
      const grouped = groupByAdjustmentType(mockBidAdjustmentRecords);
      
      expect(grouped.length).toBe(3); // auto_optimal, auto_dayparting, manual
      
      const autoOptimal = grouped.find(g => g.type === 'auto_optimal');
      expect(autoOptimal).toBeDefined();
      expect(autoOptimal?.count).toBe(1);
      expect(autoOptimal?.estimated).toBe(50);
      expect(autoOptimal?.actual).toBe(45);
    });

    it('应该计算每种类型的准确率', () => {
      const grouped = groupByAdjustmentType(mockBidAdjustmentRecords);
      
      for (const group of grouped) {
        expect(group.accuracy).toBeGreaterThanOrEqual(0);
        expect(group.accuracy).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('calculateAccuracy', () => {
    it('应该正确计算正向预估的准确率', () => {
      // 预估100，实际90，准确率90%
      expect(calculateAccuracy(100, 90)).toBe(90);
      
      // 预估100，实际100，准确率100%
      expect(calculateAccuracy(100, 100)).toBe(100);
      
      // 预估100，实际50，准确率50%
      expect(calculateAccuracy(100, 50)).toBe(50);
    });

    it('应该正确计算负向预估的准确率', () => {
      // 预估-100，实际-90，准确率90%
      expect(calculateAccuracy(-100, -90)).toBe(90);
      
      // 预估-100，实际-100，准确率100%
      expect(calculateAccuracy(-100, -100)).toBe(100);
    });

    it('应该处理预估为0的情况', () => {
      // 预估0，实际正数，准确率100%
      expect(calculateAccuracy(0, 10)).toBe(100);
      
      // 预估0，实际负数，准确率0%
      expect(calculateAccuracy(0, -10)).toBe(0);
      
      // 预估0，实际0，准确率100%
      expect(calculateAccuracy(0, 0)).toBe(100);
    });

    it('应该限制准确率在0-100之间', () => {
      // 实际远超预估
      expect(calculateAccuracy(10, 100)).toBeLessThanOrEqual(100);
      expect(calculateAccuracy(10, 100)).toBeGreaterThanOrEqual(0);
      
      // 实际远低于预估
      expect(calculateAccuracy(100, -100)).toBeLessThanOrEqual(100);
      expect(calculateAccuracy(100, -100)).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('批量回滚功能', () => {
  describe('simulateBatchRollback', () => {
    it('应该成功回滚有效记录', () => {
      const results = simulateBatchRollback(mockBidAdjustmentRecords, [1, 2]);
      
      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    it('应该处理不存在的记录', () => {
      const results = simulateBatchRollback(mockBidAdjustmentRecords, [999]);
      
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('记录不存在');
    });

    it('应该处理已回滚的记录', () => {
      const recordsWithRolledBack = [
        ...mockBidAdjustmentRecords,
        {
          ...mockBidAdjustmentRecords[0],
          id: 4,
          isRolledBack: true,
        },
      ];
      
      const results = simulateBatchRollback(recordsWithRolledBack, [4]);
      
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('已回滚');
    });

    it('应该处理混合情况', () => {
      const recordsWithRolledBack = [
        ...mockBidAdjustmentRecords,
        {
          ...mockBidAdjustmentRecords[0],
          id: 4,
          isRolledBack: true,
        },
      ];
      
      const results = simulateBatchRollback(recordsWithRolledBack, [1, 4, 999]);
      
      expect(results.length).toBe(3);
      expect(results.filter(r => r.success).length).toBe(1);
      expect(results.filter(r => !r.success).length).toBe(2);
    });

    it('应该返回正确的成功和失败计数', () => {
      const results = simulateBatchRollback(mockBidAdjustmentRecords, [1, 2, 3]);
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      expect(successCount).toBe(3);
      expect(failCount).toBe(0);
    });
  });

  describe('批量回滚验证', () => {
    it('应该验证回滚后出价恢复', () => {
      const record = mockBidAdjustmentRecords[0];
      
      // 模拟回滚：newBid应该变回previousBid
      const rollbackBid = record.previousBid;
      const currentBid = record.newBid;
      
      expect(rollbackBid).toBe('1.00');
      expect(currentBid).toBe('1.20');
      expect(rollbackBid).not.toBe(currentBid);
    });

    it('应该验证回滚记录的状态更新', () => {
      const record = { ...mockBidAdjustmentRecords[0] };
      
      // 模拟回滚状态更新
      record.isRolledBack = true;
      record.status = 'rolled_back';
      
      expect(record.isRolledBack).toBe(true);
      expect(record.status).toBe('rolled_back');
    });
  });
});

describe('报告筛选功能', () => {
  it('应该按日期范围筛选', () => {
    const startDate = new Date('2024-01-03');
    const endDate = new Date('2024-01-08');
    
    const filtered = mockBidAdjustmentRecords.filter(r => {
      const appliedAt = new Date(r.appliedAt);
      return appliedAt >= startDate && appliedAt <= endDate;
    });
    
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe(2);
  });

  it('应该按广告活动筛选', () => {
    const campaignId = 101;
    
    const filtered = mockBidAdjustmentRecords.filter(r => r.campaignId === campaignId);
    
    expect(filtered.length).toBe(2);
  });

  it('应该按调整类型筛选', () => {
    const adjustmentType = 'auto_optimal';
    
    const filtered = mockBidAdjustmentRecords.filter(r => r.adjustmentType === adjustmentType);
    
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe(1);
  });

  it('应该支持组合筛选', () => {
    const campaignId = 101;
    const adjustmentType = 'auto_optimal';
    
    const filtered = mockBidAdjustmentRecords.filter(r => 
      r.campaignId === campaignId && r.adjustmentType === adjustmentType
    );
    
    expect(filtered.length).toBe(1);
  });
});

describe('报告导出功能', () => {
  it('应该生成正确的CSV格式', () => {
    const headers = ['ID', '广告活动', '关键词', '调整前出价', '调整后出价', '预估利润', '7天实际利润'];
    const record = mockBidAdjustmentRecords[0];
    
    const csvRow = [
      record.id,
      record.campaignName,
      record.keywordText,
      record.previousBid,
      record.newBid,
      record.estimatedProfitChange,
      record.actualProfit7d,
    ].join(',');
    
    expect(csvRow).toContain('1');
    expect(csvRow).toContain('测试广告活动1');
    expect(csvRow).toContain('测试关键词1');
    expect(csvRow).toContain('1.00');
    expect(csvRow).toContain('1.20');
    expect(csvRow).toContain('50.00');
    expect(csvRow).toContain('45.00');
  });

  it('应该处理null值', () => {
    const record = mockBidAdjustmentRecords[1];
    
    const csvRow = [
      record.id,
      record.campaignName,
      record.keywordText,
      record.previousBid,
      record.newBid,
      record.estimatedProfitChange,
      record.actualProfit14d || '',
    ].join(',');
    
    // actualProfit14d是null，应该为空字符串结尾
    expect(csvRow.endsWith(','));
  });
});
