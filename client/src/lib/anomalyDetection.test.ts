import { describe, it, expect } from 'vitest';
import {
  zScoreDetection,
  iqrDetection,
  movingAverageDetection,
  detectAnomalies,
  classifyAnomaly,
} from './anomalyDetection';

describe('anomalyDetection', () => {
  describe('zScoreDetection', () => {
    it('should detect outliers using z-score', () => {
      const data = [10, 12, 11, 13, 12, 100, 11, 12]; // 100 is an outlier

      const result = zScoreDetection(data, 2);

      expect(result).toHaveLength(8);
      expect(result[5]).toBe(true); // Index 5 (value 100) should be anomaly
      expect(result[0]).toBe(false);
      expect(result[1]).toBe(false);
    });

    it('should handle uniform data', () => {
      const data = [50, 50, 50, 50, 50];

      const result = zScoreDetection(data, 2);

      expect(result.every((v) => v === false)).toBe(true);
    });

    it('should handle empty data', () => {
      const data: number[] = [];

      const result = zScoreDetection(data, 2);

      expect(result).toEqual([]);
    });

    it('should adjust sensitivity with threshold', () => {
      const data = [10, 12, 11, 13, 12, 25, 11, 12];

      const strictResult = zScoreDetection(data, 1.5);
      const lenientResult = zScoreDetection(data, 3);

      expect(strictResult.filter((v) => v).length).toBeGreaterThanOrEqual(
        lenientResult.filter((v) => v).length
      );
    });
  });

  describe('iqrDetection', () => {
    it('should detect outliers using IQR method', () => {
      const data = [10, 12, 11, 13, 12, 100, 11, 12, 13, 10];

      const result = iqrDetection(data);

      expect(result[5]).toBe(true); // 100 is an outlier
    });

    it('should handle small datasets', () => {
      const data = [10, 20, 30];

      const result = iqrDetection(data);

      expect(result).toHaveLength(3);
    });

    it('should handle uniform data', () => {
      const data = [50, 50, 50, 50, 50];

      const result = iqrDetection(data);

      expect(result.every((v) => v === false)).toBe(true);
    });
  });

  describe('movingAverageDetection', () => {
    it('should detect anomalies based on moving average', () => {
      const data = [10, 12, 11, 13, 50, 12, 11, 13]; // 50 is anomaly

      const result = movingAverageDetection(data, 3, 2);

      expect(result[4]).toBe(true); // Index 4 (value 50) should be anomaly
    });

    it('should handle beginning of data', () => {
      const data = [100, 10, 12, 11, 13];

      const result = movingAverageDetection(data, 3, 2);

      // First few points may not be detected due to insufficient history
      expect(result).toHaveLength(5);
    });

    it('should adjust sensitivity with threshold', () => {
      const data = [10, 12, 11, 13, 25, 12, 11, 13];

      const strictResult = movingAverageDetection(data, 3, 1.5);
      const lenientResult = movingAverageDetection(data, 3, 3);

      expect(strictResult.filter((v) => v).length).toBeGreaterThanOrEqual(
        lenientResult.filter((v) => v).length
      );
    });
  });

  describe('detectAnomalies', () => {
    it('should detect anomalies using combined methods', () => {
      const data = [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 110 },
        { date: '2024-01-03', value: 105 },
        { date: '2024-01-04', value: 500 }, // Clear anomaly
        { date: '2024-01-05', value: 108 },
      ];

      const result = detectAnomalies(data);

      expect(result).toHaveLength(5);
      expect(result[3].isAnomaly).toBe(true);
      expect(result[3].severity).toBe('high');
      expect(result[0].isAnomaly).toBe(false);
    });

    it('should classify anomaly types', () => {
      const data = [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 110 },
        { date: '2024-01-03', value: 500 }, // Peak
        { date: '2024-01-04', value: 10 }, // Valley
        { date: '2024-01-05', value: 108 },
      ];

      const result = detectAnomalies(data);

      const peak = result.find((r) => r.type === 'peak');
      const valley = result.find((r) => r.type === 'valley');

      expect(peak).toBeDefined();
      expect(valley).toBeDefined();
    });

    it('should handle data with no anomalies', () => {
      const data = [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 102 },
        { date: '2024-01-03', value: 101 },
        { date: '2024-01-04', value: 103 },
      ];

      const result = detectAnomalies(data);

      expect(result.every((r) => !r.isAnomaly)).toBe(true);
    });

    it('should provide anomaly statistics', () => {
      const data = [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 500 },
        { date: '2024-01-03', value: 105 },
        { date: '2024-01-04', value: 10 },
        { date: '2024-01-05', value: 108 },
      ];

      const result = detectAnomalies(data);

      const anomalies = result.filter((r) => r.isAnomaly);
      expect(anomalies.length).toBeGreaterThan(0);

      anomalies.forEach((anomaly) => {
        expect(anomaly.deviation).toBeDefined();
        expect(typeof anomaly.deviation).toBe('number');
      });
    });
  });

  describe('classifyAnomaly', () => {
    it('should classify as peak for high values', () => {
      const value = 200;
      const mean = 100;
      const stdDev = 20;

      const result = classifyAnomaly(value, mean, stdDev);

      expect(result.type).toBe('peak');
      expect(result.severity).toBe('high');
    });

    it('should classify as valley for low values', () => {
      const value = 50;
      const mean = 100;
      const stdDev = 10;

      const result = classifyAnomaly(value, mean, stdDev);

      expect(result.type).toBe('valley');
      expect(result.severity).toBe('high');
    });

    it('should classify severity correctly', () => {
      const mean = 100;
      const stdDev = 10;

      const lowAnomaly = classifyAnomaly(120, mean, stdDev);
      const mediumAnomaly = classifyAnomaly(130, mean, stdDev);
      const highAnomaly = classifyAnomaly(150, mean, stdDev);

      expect(lowAnomaly.severity).toBe('low');
      expect(mediumAnomaly.severity).toBe('medium');
      expect(highAnomaly.severity).toBe('high');
    });

    it('should calculate deviation percentage', () => {
      const value = 150;
      const mean = 100;
      const stdDev = 20;

      const result = classifyAnomaly(value, mean, stdDev);

      expect(result.deviation).toBeCloseTo(50, 0); // 50% above mean
    });
  });
});
