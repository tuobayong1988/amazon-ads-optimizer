/**
 * 运行时数据校验模块 - 单元测试
 * 
 * 测试 Zod Schema 对 Amazon API 返回数据和优化操作数据的校验逻辑，
 * 确保无效数据能被正确拦截，有效数据能正常通过。
 */
import { describe, it, expect } from 'vitest';
import {
  SpCampaignSchema,
  SpCampaignListResponseSchema,
  SpAdGroupSchema,
  SpKeywordSchema,
  SpProductTargetSchema,
  PerformanceMetricsSchema,
  TokenResponseSchema,
  AmazonProfileSchema,
  safeParseApiResponse,
  safeParseWithDefault,
} from '../validation/amazonApiSchemas';
import {
  BidAdjustmentSchema,
  BudgetAllocationSchema,
  OptimizationTargetConfigSchema,
  SafetyGuardrailConfigSchema,
  NegativeKeywordSchema,
  SearchTermMigrationSchema,
} from '../validation/optimizationSchemas';

// ============================================================
// Amazon API Schema 测试
// ============================================================

describe('SpCampaignSchema', () => {
  it('should validate a complete campaign object', () => {
    const campaign = {
      campaignId: 12345,
      name: 'Test Campaign',
      state: 'enabled',
      targetingType: 'manual',
      dailyBudget: 50.00,
      startDate: '2025-01-01',
      premiumBidAdjustment: false,
    };
    const result = SpCampaignSchema.parse(campaign);
    expect(result.campaignId).toBe(12345);
    expect(result.name).toBe('Test Campaign');
  });

  it('should apply defaults for missing optional fields', () => {
    const campaign = {
      campaignId: 12345,
    };
    const result = SpCampaignSchema.parse(campaign);
    expect(result.name).toBe('Unknown Campaign');
    expect(result.state).toBe('paused');
    expect(result.dailyBudget).toBe(0);
  });

  it('should reject campaign without campaignId', () => {
    expect(() => SpCampaignSchema.parse({ name: 'Test' })).toThrow();
  });

  it('should reject campaign with non-numeric campaignId', () => {
    expect(() => SpCampaignSchema.parse({ campaignId: 'abc' })).toThrow();
  });

  it('should allow extra fields (passthrough)', () => {
    const campaign = {
      campaignId: 12345,
      name: 'Test',
      state: 'enabled',
      targetingType: 'manual',
      dailyBudget: 50,
      startDate: '2025-01-01',
      premiumBidAdjustment: false,
      unknownField: 'extra data',
    };
    const result = SpCampaignSchema.parse(campaign);
    expect((result as any).unknownField).toBe('extra data');
  });

  it('should validate bidding strategy and adjustments', () => {
    const campaign = {
      campaignId: 12345,
      name: 'Test',
      state: 'enabled',
      targetingType: 'manual',
      dailyBudget: 50,
      startDate: '2025-01-01',
      premiumBidAdjustment: false,
      bidding: {
        strategy: 'autoForSales',
        adjustments: [
          { predicate: 'placementTop', percentage: 50 },
          { predicate: 'placementProductPage', percentage: 30 },
        ],
      },
    };
    const result = SpCampaignSchema.parse(campaign);
    expect(result.bidding?.strategy).toBe('autoForSales');
    expect(result.bidding?.adjustments).toHaveLength(2);
  });
});

describe('SpCampaignListResponseSchema', () => {
  it('should validate a list response with campaigns', () => {
    const response = {
      campaigns: [
        { campaignId: 1, name: 'C1', state: 'enabled', targetingType: 'manual', dailyBudget: 50, startDate: '2025-01-01', premiumBidAdjustment: false },
        { campaignId: 2, name: 'C2', state: 'paused', targetingType: 'auto', dailyBudget: 30, startDate: '2025-01-01', premiumBidAdjustment: false },
      ],
      nextToken: 'abc123',
    };
    const result = SpCampaignListResponseSchema.parse(response);
    expect(result.campaigns).toHaveLength(2);
    expect(result.nextToken).toBe('abc123');
  });

  it('should handle empty campaigns array', () => {
    const response = { campaigns: [] };
    const result = SpCampaignListResponseSchema.parse(response);
    expect(result.campaigns).toHaveLength(0);
  });

  it('should handle null nextToken', () => {
    const response = { campaigns: [], nextToken: null };
    const result = SpCampaignListResponseSchema.parse(response);
    expect(result.nextToken).toBeNull();
  });
});

describe('SpKeywordSchema', () => {
  it('should validate a complete keyword', () => {
    const keyword = {
      keywordId: 100,
      adGroupId: 200,
      campaignId: 300,
      state: 'enabled',
      keywordText: 'test keyword',
      matchType: 'exact',
      bid: 1.50,
    };
    const result = SpKeywordSchema.parse(keyword);
    expect(result.keywordText).toBe('test keyword');
    expect(result.matchType).toBe('exact');
  });

  it('should reject invalid matchType', () => {
    expect(() => SpKeywordSchema.parse({
      keywordId: 100,
      adGroupId: 200,
      campaignId: 300,
      matchType: 'invalid',
      bid: 1.0,
    })).toThrow();
  });
});

describe('PerformanceMetricsSchema', () => {
  it('should validate complete metrics', () => {
    const metrics = {
      impressions: 1000,
      clicks: 50,
      cost: 25.50,
      attributedSales14d: 150.00,
      attributedConversions14d: 5,
      attributedUnitsOrdered14d: 7,
    };
    const result = PerformanceMetricsSchema.parse(metrics);
    expect(result.impressions).toBe(1000);
    expect(result.cost).toBe(25.50);
  });

  it('should default missing metrics to 0', () => {
    const result = PerformanceMetricsSchema.parse({});
    expect(result.impressions).toBe(0);
    expect(result.clicks).toBe(0);
    expect(result.cost).toBe(0);
  });

  it('should reject negative values', () => {
    expect(() => PerformanceMetricsSchema.parse({ impressions: -1 })).toThrow();
  });
});

describe('TokenResponseSchema', () => {
  it('should validate a complete token response', () => {
    const token = {
      access_token: 'Atza|xxx',
      refresh_token: 'Atzr|yyy',
      token_type: 'bearer',
      expires_in: 3600,
    };
    const result = TokenResponseSchema.parse(token);
    expect(result.access_token).toBe('Atza|xxx');
  });

  it('should reject missing access_token', () => {
    expect(() => TokenResponseSchema.parse({ expires_in: 3600 })).toThrow();
  });
});

// ============================================================
// 安全解析辅助函数测试
// ============================================================

describe('safeParseApiResponse', () => {
  it('should return parsed data for valid input', () => {
    const result = safeParseApiResponse(
      SpCampaignSchema,
      { campaignId: 123, name: 'Test', state: 'enabled', targetingType: 'manual', dailyBudget: 50, startDate: '2025-01-01', premiumBidAdjustment: false },
      'test-context'
    );
    expect(result).not.toBeNull();
    expect(result?.campaignId).toBe(123);
  });

  it('should return null for invalid input without throwing', () => {
    const result = safeParseApiResponse(
      SpCampaignSchema,
      { name: 'Missing campaignId' },
      'test-invalid'
    );
    expect(result).toBeNull();
  });
});

describe('safeParseWithDefault', () => {
  it('should return parsed data for valid input', () => {
    const result = safeParseWithDefault(
      SpCampaignListResponseSchema,
      { campaigns: [{ campaignId: 1, name: 'C1', state: 'enabled', targetingType: 'manual', dailyBudget: 50, startDate: '2025-01-01', premiumBidAdjustment: false }] },
      { campaigns: [] },
      'test-default'
    );
    expect(result.campaigns).toHaveLength(1);
  });

  it('should return default value for invalid input', () => {
    const result = safeParseWithDefault(
      SpCampaignListResponseSchema,
      'invalid data',
      { campaigns: [] },
      'test-fallback'
    );
    expect(result.campaigns).toHaveLength(0);
  });
});

// ============================================================
// 优化操作 Schema 测试
// ============================================================

describe('BidAdjustmentSchema', () => {
  it('should validate a valid bid adjustment', () => {
    const adj = {
      keywordId: 100,
      campaignId: '200',
      newBid: 1.50,
      reason: 'Performance improvement',
    };
    const result = BidAdjustmentSchema.parse(adj);
    expect(result.newBid).toBe(1.50);
  });

  it('should reject bid below $0.02', () => {
    expect(() => BidAdjustmentSchema.parse({
      keywordId: 100,
      campaignId: 200,
      newBid: 0.01,
    })).toThrow();
  });

  it('should reject bid above $1000', () => {
    expect(() => BidAdjustmentSchema.parse({
      keywordId: 100,
      campaignId: 200,
      newBid: 1001,
    })).toThrow();
  });

  it('should accept campaignId as string or number', () => {
    const result1 = BidAdjustmentSchema.parse({ keywordId: 1, campaignId: '123', newBid: 1.0 });
    const result2 = BidAdjustmentSchema.parse({ keywordId: 1, campaignId: 123, newBid: 1.0 });
    expect(result1.campaignId).toBe('123');
    expect(result2.campaignId).toBe(123);
  });
});

describe('BudgetAllocationSchema', () => {
  it('should validate a valid budget allocation', () => {
    const alloc = {
      campaignId: '100',
      newDailyBudget: 50.00,
      reason: 'Budget optimization',
    };
    const result = BudgetAllocationSchema.parse(alloc);
    expect(result.newDailyBudget).toBe(50.00);
  });

  it('should reject budget below $1', () => {
    expect(() => BudgetAllocationSchema.parse({
      campaignId: 100,
      newDailyBudget: 0.50,
    })).toThrow();
  });
});

describe('NegativeKeywordSchema', () => {
  it('should validate a valid negative keyword', () => {
    const nk = {
      keywordText: 'cheap',
      matchType: 'negativeExact',
      campaignId: 100,
    };
    const result = NegativeKeywordSchema.parse(nk);
    expect(result.matchType).toBe('negativeExact');
  });

  it('should reject empty keyword text', () => {
    expect(() => NegativeKeywordSchema.parse({
      keywordText: '',
      matchType: 'negativeExact',
      campaignId: 100,
    })).toThrow();
  });

  it('should reject invalid match type', () => {
    expect(() => NegativeKeywordSchema.parse({
      keywordText: 'test',
      matchType: 'exact', // not a negative match type
      campaignId: 100,
    })).toThrow();
  });
});

describe('OptimizationTargetConfigSchema', () => {
  it('should validate with all defaults', () => {
    const result = OptimizationTargetConfigSchema.parse({});
    expect(result.enableBidOptimization).toBe(true);
    expect(result.enableBudgetOptimization).toBe(true);
    expect(result.enableDayparting).toBe(false);
  });

  it('should reject ACoS above 100%', () => {
    expect(() => OptimizationTargetConfigSchema.parse({
      targetAcos: 150,
    })).toThrow();
  });

  it('should reject maxBid below $0.02', () => {
    expect(() => OptimizationTargetConfigSchema.parse({
      maxBid: 0.01,
    })).toThrow();
  });
});

describe('SafetyGuardrailConfigSchema', () => {
  it('should validate with all defaults', () => {
    const result = SafetyGuardrailConfigSchema.parse({});
    expect(result.maxBidChangePercent).toBe(30);
    expect(result.maxBudgetChangePercent).toBe(50);
    expect(result.cooldownPeriodHours).toBe(24);
  });
});

describe('SearchTermMigrationSchema', () => {
  it('should validate a valid migration', () => {
    const migration = {
      searchTerm: 'wireless earbuds',
      sourceCampaignId: '100',
      matchType: 'exact',
      suggestedBid: 1.50,
    };
    const result = SearchTermMigrationSchema.parse(migration);
    expect(result.searchTerm).toBe('wireless earbuds');
  });

  it('should reject empty search term', () => {
    expect(() => SearchTermMigrationSchema.parse({
      searchTerm: '',
      sourceCampaignId: 100,
    })).toThrow();
  });
});
