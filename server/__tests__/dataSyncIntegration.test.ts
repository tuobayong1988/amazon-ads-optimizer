/**
 * 数据同步流程 - 集成测试
 * 
 * 测试 Amazon API 数据校验、字段映射、数据转换的完整流程。
 * 使用 Zod Schema 验证数据在各个处理阶段的正确性。
 */
import { describe, it, expect } from 'vitest';
import {
  SpCampaignSchema,
  SpCampaignListResponseSchema,
  SpAdGroupSchema,
  SpKeywordSchema,
  PerformanceMetricsSchema,
  AmazonProfileSchema,
  safeParseApiResponse,
  safeParseWithDefault,
} from '../validation/amazonApiSchemas';

// ============================================================
// Amazon API 响应数据校验测试
// ============================================================

describe('Amazon API Response Validation', () => {
  describe('Campaign data sync', () => {
    it('should validate and normalize campaign data from API', () => {
      // 模拟 Amazon API 返回的原始数据
      const rawApiResponse = {
        campaigns: [
          {
            campaignId: 123456789,
            name: 'SP - Brand - Exact',
            state: 'enabled',
            targetingType: 'manual',
            dailyBudget: 50.00,
            startDate: '20250101',
            premiumBidAdjustment: true,
            bidding: {
              strategy: 'autoForSales',
              adjustments: [
                { predicate: 'placementTop', percentage: 50 },
              ],
            },
          },
          {
            campaignId: 987654321,
            name: 'SP - Auto',
            state: 'paused',
            targetingType: 'auto',
            dailyBudget: 30.00,
            startDate: '20250115',
            premiumBidAdjustment: false,
          },
        ],
        nextToken: null,
      };

      const result = SpCampaignListResponseSchema.parse(rawApiResponse);
      
      expect(result.campaigns).toHaveLength(2);
      expect(result.campaigns[0].bidding?.strategy).toBe('autoForSales');
      expect(result.campaigns[1].targetingType).toBe('auto');
    });

    it('should handle malformed campaign data gracefully', () => {
      const malformedResponse = {
        campaigns: [
          { campaignId: 111, name: 'Valid' , state: 'enabled', targetingType: 'manual', dailyBudget: 50, startDate: '2025-01-01', premiumBidAdjustment: false },
          { campaignId: null, name: 'Invalid - no ID' }, // invalid
        ],
      };

      // 整体解析会失败因为第二个campaign没有campaignId
      expect(() => SpCampaignListResponseSchema.parse(malformedResponse)).toThrow();
    });

    it('should use safeParseWithDefault for resilient parsing', () => {
      const malformedData = 'not a valid response';
      
      const result = safeParseWithDefault(
        SpCampaignListResponseSchema,
        malformedData,
        { campaigns: [] },
        'campaign-sync'
      );
      
      expect(result.campaigns).toHaveLength(0);
    });
  });

  describe('Keyword data sync', () => {
    it('should validate keyword with all match types', () => {
      const matchTypes = ['exact', 'phrase', 'broad'];
      
      for (const matchType of matchTypes) {
        const keyword = {
          keywordId: 100,
          adGroupId: 200,
          campaignId: 300,
          state: 'enabled',
          keywordText: 'test keyword',
          matchType,
          bid: 1.50,
        };
        
        const result = SpKeywordSchema.parse(keyword);
        expect(result.matchType).toBe(matchType);
      }
    });

    it('should handle keyword with missing optional bid', () => {
      const keyword = {
        keywordId: 100,
        adGroupId: 200,
        campaignId: 300,
        state: 'enabled',
        keywordText: 'test',
        matchType: 'exact',
      };
      
      const result = SpKeywordSchema.parse(keyword);
      // Zod schema 中 bid 有 default(0)，所以缺失时会默认为 0
      expect(result.bid).toBe(0);
    });
  });

  describe('Performance metrics sync', () => {
    it('should validate complete performance data', () => {
      const metrics = {
        impressions: 10000,
        clicks: 500,
        cost: 250.50,
        attributedSales14d: 1500.00,
        attributedConversions14d: 25,
        attributedUnitsOrdered14d: 30,
      };
      
      const result = PerformanceMetricsSchema.parse(metrics);
      
      // 验证 CTR 和 ACOS 可以正确计算
      const ctr = result.clicks / result.impressions;
      const acos = result.cost / result.attributedSales14d;
      
      expect(ctr).toBeCloseTo(0.05, 2);
      expect(acos).toBeCloseTo(0.167, 2);
    });

    it('should handle zero impressions (no division by zero)', () => {
      const metrics = PerformanceMetricsSchema.parse({
        impressions: 0,
        clicks: 0,
        cost: 0,
      });
      
      expect(metrics.impressions).toBe(0);
      // CTR calculation should handle this
      const ctr = metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0;
      expect(ctr).toBe(0);
    });

    it('should handle partial performance data', () => {
      const partial = {
        impressions: 100,
        clicks: 5,
        // missing cost and sales
      };
      
      const result = PerformanceMetricsSchema.parse(partial);
      expect(result.cost).toBe(0);
      expect(result.attributedSales14d).toBe(0);
    });
  });

  describe('Amazon Profile validation', () => {
    it('should validate a complete profile', () => {
      const profile = {
        profileId: 123456,
        countryCode: 'US',
        currencyCode: 'USD',
        timezone: 'America/Los_Angeles',
        accountInfo: {
          marketplaceStringId: 'ATVPDKIKX0DER',
          id: 'A1234567890',
          type: 'seller',
        },
      };
      
      const result = AmazonProfileSchema.parse(profile);
      expect(result.countryCode).toBe('US');
      expect(result.accountInfo.type).toBe('seller');
    });
  });
});

// ============================================================
// 数据转换一致性测试
// ============================================================

describe('Data Transformation Consistency', () => {
  it('should maintain campaignId type consistency through pipeline', () => {
    // API 返回 number 类型的 campaignId
    const apiCampaign = SpCampaignSchema.parse({
      campaignId: 12345,
      name: 'Test',
      state: 'enabled',
      targetingType: 'manual',
      dailyBudget: 50,
      startDate: '2025-01-01',
      premiumBidAdjustment: false,
    });
    
    expect(typeof apiCampaign.campaignId).toBe('number');
    
    // 转换为数据库存储格式（string）
    const dbCampaignId = String(apiCampaign.campaignId);
    expect(typeof dbCampaignId).toBe('string');
    expect(dbCampaignId).toBe('12345');
  });

  it('should handle bid precision through conversion', () => {
    const keyword = SpKeywordSchema.parse({
      keywordId: 100,
      adGroupId: 200,
      campaignId: 300,
      state: 'enabled',
      keywordText: 'test',
      matchType: 'exact',
      bid: 1.999,
    });
    
    // 出价应该保持原始精度
    expect(keyword.bid).toBe(1.999);
    
    // 通过安全护栏后应该四舍五入到分
    // 直接测试精度转换逻辑
    const roundedBid = Math.round(keyword.bid! * 100) / 100;
    expect(roundedBid).toBe(2.00);
    expect(roundedBid.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
  });
});

// ============================================================
// 批量数据处理测试
// ============================================================

describe('Batch Data Processing', () => {
  it('should validate large campaign lists efficiently', () => {
    const campaigns = Array.from({ length: 100 }, (_, i) => ({
      campaignId: i + 1,
      name: `Campaign ${i + 1}`,
      state: i % 3 === 0 ? 'paused' : 'enabled',
      targetingType: i % 2 === 0 ? 'manual' : 'auto',
      dailyBudget: 10 + i,
      startDate: '2025-01-01',
      premiumBidAdjustment: false,
    }));
    
    const response = SpCampaignListResponseSchema.parse({ campaigns });
    expect(response.campaigns).toHaveLength(100);
  });

  it('should handle mixed valid/invalid items with individual parsing', () => {
    const items = [
      { campaignId: 1, name: 'Valid 1', state: 'enabled', targetingType: 'manual', dailyBudget: 50, startDate: '2025-01-01', premiumBidAdjustment: false },
      { name: 'Invalid - no ID' }, // missing campaignId
      { campaignId: 3, name: 'Valid 3', state: 'enabled', targetingType: 'manual', dailyBudget: 50, startDate: '2025-01-01', premiumBidAdjustment: false },
    ];
    
    const validItems = items
      .map(item => safeParseApiResponse(SpCampaignSchema, item, 'batch-test'))
      .filter(Boolean);
    
    expect(validItems).toHaveLength(2);
    expect(validItems[0]?.campaignId).toBe(1);
    expect(validItems[1]?.campaignId).toBe(3);
  });
});
