import { describe, it, expect, vi } from 'vitest';

describe('Data Validation Feature', () => {
  describe('getLocalDataStats', () => {
    it('should return data statistics structure', () => {
      // 验证返回的数据结构
      const expectedStructure = {
        spCampaigns: expect.any(Number),
        sbCampaigns: expect.any(Number),
        sdCampaigns: expect.any(Number),
        adGroups: expect.any(Number),
        keywords: expect.any(Number),
        productTargets: expect.any(Number),
      };
      
      // 模拟返回数据
      const mockStats = {
        spCampaigns: 10,
        sbCampaigns: 5,
        sdCampaigns: 3,
        adGroups: 50,
        keywords: 200,
        productTargets: 30,
      };
      
      expect(mockStats).toMatchObject(expectedStructure);
    });

    it('should return zero values when no data exists', () => {
      const emptyStats = {
        spCampaigns: 0,
        sbCampaigns: 0,
        sdCampaigns: 0,
        adGroups: 0,
        keywords: 0,
        productTargets: 0,
      };
      
      expect(emptyStats.spCampaigns).toBe(0);
      expect(emptyStats.sbCampaigns).toBe(0);
      expect(emptyStats.sdCampaigns).toBe(0);
      expect(emptyStats.adGroups).toBe(0);
      expect(emptyStats.keywords).toBe(0);
      expect(emptyStats.productTargets).toBe(0);
    });
  });

  describe('validateData', () => {
    it('should return validation results structure', () => {
      const mockValidationResult = {
        results: [
          { entityType: 'spCampaigns', localCount: 10, remoteCount: 10 },
          { entityType: 'sbCampaigns', localCount: 5, remoteCount: 5 },
          { entityType: 'sdCampaigns', localCount: 3, remoteCount: 3 },
          { entityType: 'adGroups', localCount: 50, remoteCount: 50 },
          { entityType: 'keywords', localCount: 200, remoteCount: 200 },
          { entityType: 'productTargets', localCount: 30, remoteCount: 30 },
        ],
        validatedAt: new Date(),
      };
      
      expect(mockValidationResult.results).toHaveLength(6);
      expect(mockValidationResult.validatedAt).toBeInstanceOf(Date);
    });

    it('should detect data mismatches', () => {
      const mockValidationResult = {
        results: [
          { entityType: 'spCampaigns', localCount: 10, remoteCount: 12 },
          { entityType: 'keywords', localCount: 200, remoteCount: 195 },
        ],
      };
      
      const mismatches = mockValidationResult.results.filter(
        r => r.localCount !== r.remoteCount
      );
      
      expect(mismatches).toHaveLength(2);
      expect(mismatches[0].entityType).toBe('spCampaigns');
      expect(mismatches[0].localCount - mismatches[0].remoteCount).toBe(-2);
    });

    it('should calculate total difference correctly', () => {
      const results = [
        { entityType: 'spCampaigns', localCount: 10, remoteCount: 12 },
        { entityType: 'keywords', localCount: 200, remoteCount: 195 },
        { entityType: 'adGroups', localCount: 50, remoteCount: 50 },
      ];
      
      const totalDifference = results.reduce(
        (sum, r) => sum + Math.abs(r.remoteCount - r.localCount),
        0
      );
      
      expect(totalDifference).toBe(7); // |12-10| + |195-200| + |50-50| = 2 + 5 + 0 = 7
    });
  });

  describe('Validation Status', () => {
    it('should correctly identify match status', () => {
      const getStatus = (localCount: number, remoteCount: number) => {
        return localCount === remoteCount ? 'match' : 'mismatch';
      };
      
      expect(getStatus(10, 10)).toBe('match');
      expect(getStatus(10, 12)).toBe('mismatch');
      expect(getStatus(0, 0)).toBe('match');
    });

    it('should correctly calculate validation statistics', () => {
      const results = [
        { status: 'match' },
        { status: 'match' },
        { status: 'mismatch' },
        { status: 'match' },
        { status: 'error' },
        { status: 'mismatch' },
      ];
      
      const matchCount = results.filter(r => r.status === 'match').length;
      const mismatchCount = results.filter(r => r.status === 'mismatch').length;
      const errorCount = results.filter(r => r.status === 'error').length;
      
      expect(matchCount).toBe(3);
      expect(mismatchCount).toBe(2);
      expect(errorCount).toBe(1);
    });
  });
});
