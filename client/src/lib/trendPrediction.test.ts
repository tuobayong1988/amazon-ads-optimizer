import { describe, it, expect } from 'vitest';
import {
  linearRegressionIndexed as linearRegression,
  movingAverage,
  predictTrendDetailed as predictTrend,
  analyzeTrend,
} from './trendPrediction';

describe('trendPrediction', () => {
  describe('linearRegression', () => {
    it('should calculate correct linear regression for upward trend', () => {
      const data = [
        { value: 10, index: 0 },
        { value: 20, index: 1 },
        { value: 30, index: 2 },
        { value: 40, index: 3 },
      ];

      const result = linearRegression(data);

      expect(result.slope).toBeCloseTo(10, 1);
      expect(result.intercept).toBeCloseTo(10, 1);
      expect(result.rSquared).toBeGreaterThan(0.99);
    });

    it('should calculate correct linear regression for downward trend', () => {
      const data = [
        { value: 40, index: 0 },
        { value: 30, index: 1 },
        { value: 20, index: 2 },
        { value: 10, index: 3 },
      ];

      const result = linearRegression(data);

      expect(result.slope).toBeCloseTo(-10, 1);
      expect(result.intercept).toBeCloseTo(40, 1);
      expect(result.rSquared).toBeGreaterThan(0.99);
    });

    it('should handle flat data', () => {
      const data = [
        { value: 50, index: 0 },
        { value: 50, index: 1 },
        { value: 50, index: 2 },
        { value: 50, index: 3 },
      ];

      const result = linearRegression(data);

      expect(result.slope).toBeCloseTo(0, 1);
      expect(result.intercept).toBeCloseTo(50, 1);
    });

    it('should handle single data point', () => {
      const data = [{ value: 100, index: 0 }];

      const result = linearRegression(data);

      expect(result.slope).toBe(0);
      expect(result.intercept).toBe(100);
      expect(result.rSquared).toBe(1);
    });

    it('should handle empty data', () => {
      const data: Array<{ value: number; index: number }> = [];

      const result = linearRegression(data);

      expect(result.slope).toBe(0);
      expect(result.intercept).toBe(0);
      expect(result.rSquared).toBe(0);
    });
  });

  describe('movingAverage', () => {
    it('should calculate correct moving average', () => {
      const data = [10, 20, 30, 40, 50];
      const window = 3;

      const result = movingAverage(data, window);

      expect(result).toHaveLength(5);
      expect(result[0]).toBe(10); // First value unchanged
      expect(result[1]).toBe(15); // (10 + 20) / 2
      expect(result[2]).toBe(20); // (10 + 20 + 30) / 3
      expect(result[3]).toBe(30); // (20 + 30 + 40) / 3
      expect(result[4]).toBe(40); // (30 + 40 + 50) / 3
    });

    it('should handle window size of 1', () => {
      const data = [10, 20, 30];
      const window = 1;

      const result = movingAverage(data, window);

      expect(result).toEqual(data);
    });

    it('should handle window size larger than data', () => {
      const data = [10, 20, 30];
      const window = 10;

      const result = movingAverage(data, window);

      expect(result[2]).toBeCloseTo(20, 1); // Average of all values
    });

    it('should handle empty data', () => {
      const data: number[] = [];
      const window = 3;

      const result = movingAverage(data, window);

      expect(result).toEqual([]);
    });
  });

  describe('predictTrend', () => {
    it('should predict future values correctly', () => {
      const historicalData = [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 110 },
        { date: '2024-01-03', value: 120 },
        { date: '2024-01-04', value: 130 },
        { date: '2024-01-05', value: 140 },
      ];

      const result = predictTrend(historicalData, 3);

      expect(result.predictions).toHaveLength(3);
      expect(result.predictions[0].value).toBeGreaterThan(140);
      expect(result.predictions[1].value).toBeGreaterThan(
        result.predictions[0].value
      );
      expect(result.predictions[2].value).toBeGreaterThan(
        result.predictions[1].value
      );
    });

    it('should include confidence intervals', () => {
      // 使用有噪声的数据，确保 standardError > 0
      const historicalData = [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 115 },
        { date: '2024-01-03', value: 108 },
        { date: '2024-01-04', value: 125 },
        { date: '2024-01-05', value: 118 },
      ];

      const result = predictTrend(historicalData, 2);

      result.predictions.forEach((prediction: unknown) => {
        expect(prediction.lower).toBeLessThanOrEqual(prediction.value);
        expect(prediction.upper).toBeGreaterThanOrEqual(prediction.value);
      });
    });

    it('should handle insufficient data', () => {
      const historicalData = [{ date: '2024-01-01', value: 100 }];

      const result = predictTrend(historicalData, 3);

      expect(result.predictions).toHaveLength(3);
      result.predictions.forEach((prediction: unknown) => {
        expect(prediction.value).toBeCloseTo(100, 1);
      });
    });
  });

  describe('analyzeTrend', () => {
    it('should identify upward trend', () => {
      const data = [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 120 },
        { date: '2024-01-03', value: 140 },
        { date: '2024-01-04', value: 160 },
      ];

      const result = analyzeTrend(data);

      expect(result.direction).toBe('up');
      expect(result.strength).toBeGreaterThan(0.5);
      expect(result.rSquared).toBeGreaterThan(0.9);
    });

    it('should identify downward trend', () => {
      const data = [
        { date: '2024-01-01', value: 160 },
        { date: '2024-01-02', value: 140 },
        { date: '2024-01-03', value: 120 },
        { date: '2024-01-04', value: 100 },
      ];

      const result = analyzeTrend(data);

      expect(result.direction).toBe('down');
      expect(result.strength).toBeGreaterThan(0.5);
    });

    it('should identify stable trend', () => {
      const data = [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 101 },
        { date: '2024-01-03', value: 99 },
        { date: '2024-01-04', value: 100 },
      ];

      const result = analyzeTrend(data);

      expect(result.direction).toBe('stable');
      expect(result.strength).toBeLessThan(0.3);
    });

    it('should handle empty data', () => {
      const data: Array<{ date: string; value: number }> = [];

      const result = analyzeTrend(data);

      expect(result.direction).toBe('stable');
      expect(result.strength).toBe(0);
      expect(result.rSquared).toBe(0);
    });
  });
});
