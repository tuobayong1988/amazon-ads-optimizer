import { describe, it, expect } from 'vitest';
import {
  calculateZScores,
  detectAnomaliesZScore,
  detectAnomaliesIQR,
  detectAnomaliesMovingAverage,
  detectSuddenChanges,
  detectAnomaliesCombined,
  generateAnomalyReport,
  calculateAnomalyScore,
  DataPoint,
  Anomaly,
} from './anomalyDetection';

// 辅助函数：生成带日期的数据点
function makeData(values: number[]): DataPoint[] {
  return values.map((v: any, i: any) => ({
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    value: v,
  }));
}

describe('anomalyDetection', () => {
  describe('calculateZScores', () => {
    it('should calculate z-scores for data points', () => {
      const data = makeData([10, 12, 11, 13, 12, 100, 11, 12]);
      const result = calculateZScores(data);

      expect(result).toHaveLength(8);
      // 100 should have a very high z-score
      const outlier = result.find(r => r.value === 100);
      expect(outlier).toBeDefined();
      expect(outlier!.zScore).toBeGreaterThan(2);
    });

    it('should handle uniform data (std = 0)', () => {
      const data = makeData([5, 5, 5, 5]);
      const result = calculateZScores(data);

      expect(result).toHaveLength(4);
      result.forEach(r => expect(r.zScore).toBe(0));
    });

    it('should return empty for less than 2 data points', () => {
      const data = makeData([5]);
      const result = calculateZScores(data);
      expect(result).toHaveLength(0);
    });
  });

  describe('detectAnomaliesZScore', () => {
    it('should detect outliers using z-score', () => {
      const data = makeData([10, 12, 11, 13, 12, 100, 11, 12]);
      const anomalies = detectAnomaliesZScore(data, 2);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies.some(a => a.value === 100)).toBe(true);
    });

    it('should classify anomaly type as spike or drop', () => {
      const data = makeData([10, 12, 11, 13, 12, 100, 11, 12]);
      const anomalies = detectAnomaliesZScore(data, 2);

      const spike = anomalies.find(a => a.value === 100);
      expect(spike?.type).toBe('spike');
    });

    it('should adjust sensitivity with threshold', () => {
      const data = makeData([10, 12, 11, 13, 12, 25, 11, 12]);
      const sensitiveResult = detectAnomaliesZScore(data, 1.5);
      const strictResult = detectAnomaliesZScore(data, 3);

      expect(sensitiveResult.length).toBeGreaterThanOrEqual(strictResult.length);
    });

    it('should handle data with no anomalies', () => {
      const data = makeData([10, 10, 10, 10, 10]);
      const anomalies = detectAnomaliesZScore(data, 2);
      expect(anomalies).toHaveLength(0);
    });
  });

  describe('detectAnomaliesIQR', () => {
    it('should detect outliers using IQR method', () => {
      const data = makeData([10, 12, 11, 13, 12, 100, 11, 12]);
      const anomalies = detectAnomaliesIQR(data);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies.some(a => a.value === 100)).toBe(true);
    });

    it('should return empty for small datasets (< 4 points)', () => {
      const data = makeData([10, 100, 10]);
      const anomalies = detectAnomaliesIQR(data);
      expect(anomalies).toHaveLength(0);
    });

    it('should classify severity levels', () => {
      const data = makeData([10, 12, 11, 13, 12, 200, 11, 12]);
      const anomalies = detectAnomaliesIQR(data);

      anomalies.forEach(a => {
        expect(['low', 'medium', 'high']).toContain(a.severity);
      });
    });
  });

  describe('detectAnomaliesMovingAverage', () => {
    it('should detect anomalies based on moving average', () => {
      const data = makeData([10, 12, 11, 13, 12, 11, 10, 100, 12, 11]);
      const anomalies = detectAnomaliesMovingAverage(data, 3, 2);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies.some(a => a.value === 100)).toBe(true);
    });

    it('should return empty if data is shorter than window', () => {
      const data = makeData([10, 12]);
      const anomalies = detectAnomaliesMovingAverage(data, 7, 2);
      expect(anomalies).toHaveLength(0);
    });

    it('should adjust sensitivity with threshold', () => {
      const data = makeData([10, 12, 11, 13, 12, 11, 10, 30, 12, 11]);
      const sensitiveResult = detectAnomaliesMovingAverage(data, 3, 1);
      const strictResult = detectAnomaliesMovingAverage(data, 3, 3);

      expect(sensitiveResult.length).toBeGreaterThanOrEqual(strictResult.length);
    });
  });

  describe('detectSuddenChanges', () => {
    it('should detect sudden value changes', () => {
      const data = makeData([10, 10, 10, 50, 10]);
      const anomalies = detectSuddenChanges(data, 0.5);

      expect(anomalies.length).toBeGreaterThan(0);
    });

    it('should skip zero values to avoid division by zero', () => {
      const data = makeData([0, 100, 0]);
      const anomalies = detectSuddenChanges(data, 0.5);
      // First transition (0->100) is skipped because prev is 0
      // Second transition (100->0) should be detected
      expect(anomalies.some(a => a.value === 0)).toBe(true);
    });

    it('should classify severity based on change rate', () => {
      const data = makeData([10, 25, 10]); // 150% change, then -60% change
      const anomalies = detectSuddenChanges(data, 0.5);

      anomalies.forEach(a => {
        expect(['low', 'medium', 'high']).toContain(a.severity);
      });
    });
  });

  describe('detectAnomaliesCombined', () => {
    it('should detect anomalies using combined methods', () => {
      const data = makeData([10, 12, 11, 13, 12, 100, 11, 12, 10, 13, 11, 12]);
      const anomalies = detectAnomaliesCombined(data);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies.some(a => a.value === 100)).toBe(true);
    });

    it('should deduplicate anomalies on same date', () => {
      const data = makeData([10, 12, 11, 13, 12, 100, 11, 12, 10, 13, 11, 12]);
      const anomalies = detectAnomaliesCombined(data);

      // No duplicate dates
      const dates = anomalies.map(a => a.date);
      const uniqueDates = [...new Set(dates)];
      expect(dates.length).toBe(uniqueDates.length);
    });

    it('should return empty for small datasets', () => {
      const data = makeData([10, 100]);
      const anomalies = detectAnomaliesCombined(data);
      expect(anomalies).toHaveLength(0);
    });

    it('should sort results by date', () => {
      const data = makeData([10, 12, 100, 13, 12, 200, 11, 12, 10, 13, 11, 12]);
      const anomalies = detectAnomaliesCombined(data);

      for (let i = 1; i < anomalies.length; i++) {
        expect(new Date(anomalies[i].date).getTime())
          .toBeGreaterThanOrEqual(new Date(anomalies[i - 1].date).getTime());
      }
    });
  });

  describe('generateAnomalyReport', () => {
    it('should generate report with correct structure', () => {
      const anomalies: Anomaly[] = [
        { date: '2024-01-01', value: 100, expected: 10, deviation: 90, severity: 'high', type: 'spike' },
        { date: '2024-01-02', value: 1, expected: 10, deviation: 9, severity: 'low', type: 'drop' },
        { date: '2024-01-03', value: 50, expected: 10, deviation: 40, severity: 'medium', type: 'spike' },
      ];

      const report = generateAnomalyReport(anomalies);

      expect(report.total).toBe(3);
      expect(report.byType.spike).toBe(2);
      expect(report.byType.drop).toBe(1);
      expect(report.bySeverity.high).toBe(1);
      expect(report.bySeverity.medium).toBe(1);
      expect(report.bySeverity.low).toBe(1);
      expect(report.recentAnomalies.length).toBeLessThanOrEqual(5);
    });

    it('should handle empty anomalies', () => {
      const report = generateAnomalyReport([]);
      expect(report.total).toBe(0);
      expect(report.recentAnomalies).toHaveLength(0);
    });
  });

  describe('calculateAnomalyScore', () => {
    it('should return high score for clean data', () => {
      const data = makeData([10, 11, 10, 11, 10, 11, 10, 11, 10, 11]);
      const result = calculateAnomalyScore(data);

      expect(result.score).toBeGreaterThan(80);
      expect(result.anomalyRate).toBeLessThan(0.2);
      expect(['excellent', 'good']).toContain(result.quality);
    });

    it('should return low score for noisy data', () => {
      const data = makeData([10, 100, 1, 200, 5, 300, 2, 150, 10, 250]);
      const result = calculateAnomalyScore(data);

      expect(result.score).toBeLessThan(90);
    });

    it('should handle empty data', () => {
      const result = calculateAnomalyScore([]);
      expect(result.score).toBe(0);
      expect(result.quality).toBe('poor');
    });

    it('should classify quality levels correctly', () => {
      // Clean data should be excellent
      const cleanData = makeData([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
      const cleanResult = calculateAnomalyScore(cleanData);
      expect(cleanResult.quality).toBe('excellent');
    });
  });
});
