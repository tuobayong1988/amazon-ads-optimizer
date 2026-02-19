/**
 * 双轨制数据同步服务单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock getDb
vi.mock('../db', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '../db';
import {
  getDualTrackStatus,
  getDataSourceStats,
  getMergedPerformanceData,
  DATA_SOURCE_PRIORITY,
  CONSISTENCY_THRESHOLDS,
} from './dualTrackSyncService';

describe('DualTrackSyncService', () => {
  let mockDb: any;
  let mockExecute: any;

  beforeEach(() => {
    mockExecute = vi.fn();
    mockDb = {
      execute: mockExecute,
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('DATA_SOURCE_PRIORITY', () => {
    it('should have correct priority for realtime mode', () => {
      expect(DATA_SOURCE_PRIORITY.realtime).toEqual(['ams', 'api']);
    });

    it('should have correct priority for historical mode', () => {
      expect(DATA_SOURCE_PRIORITY.historical).toEqual(['api', 'ams']);
    });

    it('should have correct priority for reporting mode', () => {
      expect(DATA_SOURCE_PRIORITY.reporting).toEqual(['merged', 'api', 'ams']);
    });
  });

  describe('CONSISTENCY_THRESHOLDS', () => {
    it('should have value deviation threshold of 5%', () => {
      expect(CONSISTENCY_THRESHOLDS.valueDeviation).toBe(0.05);
    });

    it('should have time delay threshold of 60 minutes', () => {
      expect(CONSISTENCY_THRESHOLDS.timeDelay).toBe(60);
    });

    it('should have alert threshold of 3 consecutive inconsistencies', () => {
      expect(CONSISTENCY_THRESHOLDS.alertThreshold).toBe(3);
    });
  });

  describe('getDualTrackStatus', () => {
    it('should return error status when database is not available', async () => {
      vi.mocked(getDb).mockResolvedValue(null);

      const result = await getDualTrackStatus(1);

      expect(result.overallHealth).toBe('error');
      expect(result.api.status).toBe('error');
      expect(result.ams.status).toBe('error');
    });

    it('should return correct structure when database is available', async () => {
      const mockDb = {
        execute: vi.fn().mockResolvedValue([[]]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await getDualTrackStatus(1);

      expect(result).toHaveProperty('api');
      expect(result).toHaveProperty('ams');
      expect(result).toHaveProperty('lastConsistencyCheck');
      expect(result).toHaveProperty('overallHealth');
      expect(result.api).toHaveProperty('source', 'api');
      expect(result.ams).toHaveProperty('source', 'ams');
    });
  });

  describe('getDataSourceStats', () => {
    it('should return zero stats when database is not available', async () => {
      vi.mocked(getDb).mockResolvedValue(null);

      const result = await getDataSourceStats(1);

      expect(result.api.records).toBe(0);
      expect(result.ams.records).toBe(0);
      expect(result.merged.records).toBe(0);
    });

    it('should return correct structure', async () => {
      const mockDb = {
        execute: vi.fn().mockResolvedValue([[]]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await getDataSourceStats(1);

      expect(result).toHaveProperty('api');
      expect(result).toHaveProperty('ams');
      expect(result).toHaveProperty('merged');
      expect(result.api).toHaveProperty('records');
      expect(result.api).toHaveProperty('lastUpdate');
    });
  });

  describe('Data Source Priority Logic', () => {
    it('realtime mode should prioritize AMS data', () => {
      const priority = DATA_SOURCE_PRIORITY.realtime;
      expect(priority[0]).toBe('ams');
      expect(priority.indexOf('ams')).toBeLessThan(priority.indexOf('api'));
    });

    it('historical mode should prioritize API data', () => {
      const priority = DATA_SOURCE_PRIORITY.historical;
      expect(priority[0]).toBe('api');
      expect(priority.indexOf('api')).toBeLessThan(priority.indexOf('ams'));
    });

    it('reporting mode should prioritize merged data', () => {
      const priority = DATA_SOURCE_PRIORITY.reporting;
      expect(priority[0]).toBe('merged');
    });
  });

  describe('getMergedPerformanceData', () => {
    it('should return empty array when database connection fails', async () => {
      vi.mocked(getDb).mockResolvedValue(null);

      const result = await getMergedPerformanceData(1, '2024-01-01', '2024-01-07');

      expect(result).toEqual([]);
    });

    it('should return API data for historical priority', async () => {
      const mockApiData = [
        { campaignId: 1, amazonCampaignId: 'C001', reportDate: '2024-01-01', impressions: 1000, clicks: 50 },
      ];
      mockExecute.mockResolvedValueOnce([mockApiData]);
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await getMergedPerformanceData(1, '2024-01-01', '2024-01-07', 'historical');

      expect(result).toEqual(mockApiData);
    });
  });

  describe('Consistency Thresholds', () => {
    it('should have reasonable AMS backfill threshold', () => {
      expect(CONSISTENCY_THRESHOLDS.amsBackfillThreshold).toBeGreaterThan(0);
      expect(CONSISTENCY_THRESHOLDS.amsBackfillThreshold).toBeLessThanOrEqual(24);
    });

    it('should have reasonable value deviation threshold', () => {
      expect(CONSISTENCY_THRESHOLDS.valueDeviation).toBeGreaterThan(0);
      expect(CONSISTENCY_THRESHOLDS.valueDeviation).toBeLessThan(0.5);
    });
  });
});
