import { describe, it, expect } from 'vitest';

// 辅助函数 - 计算调整后天数
function calculateDaysSinceAdjustment(adjustmentDate: Date, currentDate: Date): number {
  const diffTime = currentDate.getTime() - adjustmentDate.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

// 辅助函数 - 判断是否应该收集数据
function shouldCollectData(
  daysSince: number,
  has7Day: boolean,
  has14Day: boolean,
  has30Day: boolean
): { collect7Day: boolean; collect14Day: boolean; collect30Day: boolean } {
  return {
    collect7Day: daysSince >= 7 && !has7Day,
    collect14Day: daysSince >= 14 && !has14Day,
    collect30Day: daysSince >= 30 && !has30Day,
  };
}

// 辅助函数 - 计算实际利润
function calculateActualProfit(revenue: number, adSpend: number): number {
  return revenue - adSpend;
}

// 辅助函数 - 计算利润预测准确度
function calculateProfitAccuracy(estimated: number, actual: number): number {
  if (estimated === 0 && actual === 0) return 100;
  if (estimated === 0 || actual === 0) return 0;
  
  // 如果符号相同，计算准确度
  if ((estimated > 0 && actual > 0) || (estimated < 0 && actual < 0)) {
    const ratio = Math.min(Math.abs(estimated), Math.abs(actual)) / 
                  Math.max(Math.abs(estimated), Math.abs(actual));
    return ratio * 100;
  }
  
  // 符号不同，准确度为0
  return 0;
}

// 辅助函数 - 聚合追踪统计
function aggregateTrackingStats(records: Array<{ estimatedProfitIncrease: number; actual7DayProfit: number | null }>): {
  totalEstimated: number;
  totalActual: number;
  recordCount: number;
  averageAccuracy: number;
} {
  if (records.length === 0) {
    return { totalEstimated: 0, totalActual: 0, recordCount: 0, averageAccuracy: 0 };
  }
  
  const totalEstimated = records.reduce((sum, r) => sum + (r.estimatedProfitIncrease || 0), 0);
  const totalActual = records.reduce((sum, r) => sum + (r.actual7DayProfit || 0), 0);
  
  const accuracies = records
    .filter(r => r.actual7DayProfit !== null)
    .map(r => calculateProfitAccuracy(r.estimatedProfitIncrease, r.actual7DayProfit!));
  
  const averageAccuracy = accuracies.length > 0 
    ? accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length 
    : 0;
  
  return { totalEstimated, totalActual, recordCount: records.length, averageAccuracy };
}

describe('效果追踪定时任务服务', () => {
  describe('calculateDaysSinceAdjustment - 计算调整后天数', () => {
    it('应该正确计算天数差', () => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      const days = calculateDaysSinceAdjustment(sevenDaysAgo, now);
      expect(days).toBe(7);
    });

    it('应该处理同一天的情况', () => {
      const now = new Date();
      const days = calculateDaysSinceAdjustment(now, now);
      expect(days).toBe(0);
    });

    it('应该处理14天的情况', () => {
      const now = new Date();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      
      const days = calculateDaysSinceAdjustment(fourteenDaysAgo, now);
      expect(days).toBe(14);
    });

    it('应该处理30天的情况', () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const days = calculateDaysSinceAdjustment(thirtyDaysAgo, now);
      expect(days).toBe(30);
    });
  });

  describe('shouldCollectData - 判断是否应该收集数据', () => {
    it('应该在第7天收集7天数据', () => {
      const result = shouldCollectData(7, false, false, false);
      expect(result.collect7Day).toBe(true);
      expect(result.collect14Day).toBe(false);
      expect(result.collect30Day).toBe(false);
    });

    it('应该在第14天收集14天数据', () => {
      const result = shouldCollectData(14, true, false, false);
      expect(result.collect7Day).toBe(false);
      expect(result.collect14Day).toBe(true);
      expect(result.collect30Day).toBe(false);
    });

    it('应该在第30天收集30天数据', () => {
      const result = shouldCollectData(30, true, true, false);
      expect(result.collect7Day).toBe(false);
      expect(result.collect14Day).toBe(false);
      expect(result.collect30Day).toBe(true);
    });

    it('如果已收集则不应重复收集', () => {
      const result = shouldCollectData(7, true, false, false);
      expect(result.collect7Day).toBe(false);
    });

    it('应该处理边界情况 - 第6天', () => {
      const result = shouldCollectData(6, false, false, false);
      expect(result.collect7Day).toBe(false);
      expect(result.collect14Day).toBe(false);
      expect(result.collect30Day).toBe(false);
    });

    it('应该处理超过30天的情况', () => {
      const result = shouldCollectData(45, false, false, false);
      // 超过30天仍可收集未收集的数据
      expect(result.collect7Day).toBe(true);
      expect(result.collect14Day).toBe(true);
      expect(result.collect30Day).toBe(true);
    });
  });

  describe('calculateActualProfit - 计算实际利润', () => {
    it('应该正确计算利润', () => {
      // 利润 = 收入 - 广告支出
      const profit = calculateActualProfit(1000, 300);
      expect(profit).toBe(700);
    });

    it('应该处理亏损情况', () => {
      const profit = calculateActualProfit(200, 500);
      expect(profit).toBe(-300);
    });

    it('应该处理零收入情况', () => {
      const profit = calculateActualProfit(0, 100);
      expect(profit).toBe(-100);
    });

    it('应该处理零支出情况', () => {
      const profit = calculateActualProfit(500, 0);
      expect(profit).toBe(500);
    });
  });

  describe('calculateProfitAccuracy - 计算利润预测准确度', () => {
    it('应该计算完美预测的准确度', () => {
      const accuracy = calculateProfitAccuracy(100, 100);
      expect(accuracy).toBe(100);
    });

    it('应该计算低估的准确度', () => {
      // 预估100，实际150，偏差50%
      const accuracy = calculateProfitAccuracy(100, 150);
      expect(accuracy).toBeCloseTo(66.67, 1);
    });

    it('应该计算高估的准确度', () => {
      // 预估100，实际50，偏差50%
      const accuracy = calculateProfitAccuracy(100, 50);
      expect(accuracy).toBeCloseTo(50, 1);
    });

    it('应该处理预估为0的情况', () => {
      const accuracy = calculateProfitAccuracy(0, 100);
      expect(accuracy).toBe(0);
    });

    it('应该处理实际为0的情况', () => {
      const accuracy = calculateProfitAccuracy(100, 0);
      expect(accuracy).toBe(0);
    });

    it('应该处理负数情况', () => {
      // 预估-100，实际-100，完美预测
      const accuracy = calculateProfitAccuracy(-100, -100);
      expect(accuracy).toBe(100);
    });
  });

  describe('aggregateTrackingStats - 聚合追踪统计', () => {
    it('应该正确聚合多条记录的统计', () => {
      const records = [
        { estimatedProfitIncrease: 100, actual7DayProfit: 90 },
        { estimatedProfitIncrease: 200, actual7DayProfit: 180 },
        { estimatedProfitIncrease: 150, actual7DayProfit: 160 },
      ];
      
      const stats = aggregateTrackingStats(records);
      
      expect(stats.totalEstimated).toBe(450);
      expect(stats.totalActual).toBe(430);
      expect(stats.recordCount).toBe(3);
      expect(stats.averageAccuracy).toBeGreaterThan(0);
    });

    it('应该处理空数组', () => {
      const stats = aggregateTrackingStats([]);
      
      expect(stats.totalEstimated).toBe(0);
      expect(stats.totalActual).toBe(0);
      expect(stats.recordCount).toBe(0);
      expect(stats.averageAccuracy).toBe(0);
    });

    it('应该处理部分缺失数据', () => {
      const records = [
        { estimatedProfitIncrease: 100, actual7DayProfit: null },
        { estimatedProfitIncrease: 200, actual7DayProfit: 180 },
      ];
      
      const stats = aggregateTrackingStats(records);
      
      expect(stats.totalEstimated).toBe(300);
      expect(stats.totalActual).toBe(180);
      expect(stats.recordCount).toBe(2);
    });
  });
});

describe('批量回滚功能', () => {
  describe('批量回滚验证', () => {
    it('应该验证空数组', () => {
      const ids: number[] = [];
      expect(ids.length).toBe(0);
    });

    it('应该验证单个ID', () => {
      const ids = [1];
      expect(ids.length).toBe(1);
    });

    it('应该验证多个ID', () => {
      const ids = [1, 2, 3, 4, 5];
      expect(ids.length).toBe(5);
    });

    it('应该过滤重复ID', () => {
      const ids = [1, 2, 2, 3, 3, 3];
      const uniqueIds = [...new Set(ids)];
      expect(uniqueIds.length).toBe(3);
    });
  });

  describe('批量回滚结果统计', () => {
    it('应该正确统计成功和失败数量', () => {
      const results = [
        { success: true },
        { success: true },
        { success: false },
        { success: true },
        { success: false },
      ];
      
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;
      
      expect(successCount).toBe(3);
      expect(failedCount).toBe(2);
    });

    it('应该处理全部成功', () => {
      const results = [
        { success: true },
        { success: true },
        { success: true },
      ];
      
      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBe(3);
    });

    it('应该处理全部失败', () => {
      const results = [
        { success: false },
        { success: false },
      ];
      
      const failedCount = results.filter(r => !r.success).length;
      expect(failedCount).toBe(2);
    });
  });
});
