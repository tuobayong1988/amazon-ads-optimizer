/**
 * 测试 Amazon Sync Service 中 startDate 字段的同步逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟日期格式转换函数
function normalizeStartDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  
  const str = String(dateStr);
  
  // YYYY-MM-DD格式
  if (str.includes('-')) {
    return str;
  }
  
  // YYYYMMDD格式 (SD API)
  if (str.length === 8) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  }
  
  return null;
}

describe('Amazon Sync Service - startDate Field', () => {
  describe('normalizeStartDate', () => {
    it('should handle YYYY-MM-DD format (SP/SB API)', () => {
      expect(normalizeStartDate('2024-01-15')).toBe('2024-01-15');
      expect(normalizeStartDate('2023-12-31')).toBe('2023-12-31');
    });

    it('should convert YYYYMMDD format to YYYY-MM-DD (SD API)', () => {
      expect(normalizeStartDate('20240115')).toBe('2024-01-15');
      expect(normalizeStartDate('20231231')).toBe('2023-12-31');
      expect(normalizeStartDate('20220811')).toBe('2022-08-11');
    });

    it('should handle null/undefined values', () => {
      expect(normalizeStartDate(null)).toBe(null);
      expect(normalizeStartDate(undefined)).toBe(null);
      expect(normalizeStartDate('')).toBe(null);
    });

    it('should handle invalid formats', () => {
      expect(normalizeStartDate('invalid')).toBe(null);
      expect(normalizeStartDate('2024')).toBe(null);
      expect(normalizeStartDate('12345')).toBe(null);
    });
  });

  describe('SP Campaign startDate parsing', () => {
    it('should correctly parse SP campaign with startDate', () => {
      const apiCampaign = {
        campaignId: '123456789',
        name: 'Test Campaign',
        state: 'ENABLED',
        startDate: '2024-01-15',
        endDate: '2024-12-31',
        targetingType: 'MANUAL',
        budget: { budget: 50 }
      };

      const startDateValue = normalizeStartDate(apiCampaign.startDate);
      const endDateValue = normalizeStartDate(apiCampaign.endDate);

      expect(startDateValue).toBe('2024-01-15');
      expect(endDateValue).toBe('2024-12-31');
    });

    it('should handle SP campaign without endDate', () => {
      const apiCampaign = {
        campaignId: '123456789',
        name: 'Test Campaign',
        state: 'ENABLED',
        startDate: '2024-01-15',
        targetingType: 'MANUAL',
        budget: { budget: 50 }
      };

      const startDateValue = normalizeStartDate(apiCampaign.startDate);
      const endDateValue = normalizeStartDate((apiCampaign as any).endDate);

      expect(startDateValue).toBe('2024-01-15');
      expect(endDateValue).toBe(null);
    });
  });

  describe('SD Campaign startDate parsing', () => {
    it('should correctly parse SD campaign with YYYYMMDD format', () => {
      const apiCampaign = {
        campaignId: 987654321,
        name: 'SD Test Campaign',
        state: 'enabled',
        startDate: '20240115',
        budget: 100
      };

      const startDateValue = normalizeStartDate(apiCampaign.startDate);

      expect(startDateValue).toBe('2024-01-15');
    });

    it('should handle SD campaign with YYYY-MM-DD format (if API changes)', () => {
      const apiCampaign = {
        campaignId: 987654321,
        name: 'SD Test Campaign',
        state: 'enabled',
        startDate: '2024-01-15',
        budget: 100
      };

      const startDateValue = normalizeStartDate(apiCampaign.startDate);

      expect(startDateValue).toBe('2024-01-15');
    });
  });

  describe('SB Campaign startDate parsing', () => {
    it('should correctly parse SB campaign with startDate', () => {
      const apiCampaign = {
        campaignId: '555666777',
        name: 'SB Test Campaign',
        state: 'ENABLED',
        startDate: '2024-02-20',
        budget: 30,
        budgetType: 'DAILY'
      };

      const startDateValue = normalizeStartDate(apiCampaign.startDate);

      expect(startDateValue).toBe('2024-02-20');
    });
  });

  describe('Campaign data mapping', () => {
    it('should correctly map campaign data with startDate and endDate', () => {
      const apiCampaign = {
        campaignId: '123456789',
        name: 'Test Campaign',
        state: 'ENABLED',
        startDate: '2024-01-15',
        endDate: '2024-12-31',
        targetingType: 'MANUAL',
        budget: { budget: 50 }
      };

      const campaignData = {
        accountId: 1,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: 'sp_manual' as const,
        targetingType: 'manual' as const,
        dailyBudget: String(apiCampaign.budget.budget),
        campaignStatus: apiCampaign.state.toLowerCase() as 'enabled' | 'paused' | 'archived',
        startDate: normalizeStartDate(apiCampaign.startDate),
        endDate: normalizeStartDate(apiCampaign.endDate),
      };

      expect(campaignData.startDate).toBe('2024-01-15');
      expect(campaignData.endDate).toBe('2024-12-31');
      expect(campaignData.campaignStatus).toBe('enabled');
    });
  });
});
