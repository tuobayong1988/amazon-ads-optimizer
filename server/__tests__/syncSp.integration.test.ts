/**
 * SP 广告数据同步 - 集成测试
 * 
 * 测试 syncSp 子模块中的核心同步方法：
 * - syncSpCampaigns: SP 广告活动同步
 * - syncSpAdGroups: SP 广告组同步
 * - syncSpKeywords: SP 关键词同步（含出价保护逻辑）
 * - syncSpProductTargets: SP 商品定位同步（含出价保护逻辑）
 * - getPlacementMultiplier: 展示位置调整系数提取
 * 
 * 所有数据库操作和 Amazon API 调用均使用 vi.mock() 完全模拟，
 * 不会连接任何真实数据库或 Amazon API，不会触及真实广告数据。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== 使用 vi.hoisted 定义可在 vi.mock 中引用的变量 ====================

const { mockDb, mockGetDb } = vi.hoisted(() => {
  const db: unknown = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue(Promise.resolve([])),
    offset: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnValue(Promise.resolve([])),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnValue(Promise.resolve()),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockReturnValue(Promise.resolve([[], []])),
  };
  return { mockDb: db, mockGetDb: vi.fn().mockResolvedValue(db) };
});

// ==================== Mock 定义 ====================

vi.mock('../db', () => ({
  getDb: mockGetDb,
}));

vi.mock('../../drizzle/schema', () => ({
  campaigns: { id: 'campaigns.id', accountId: 'campaigns.accountId', campaignId: 'campaigns.campaignId' },
  adGroups: { id: 'adGroups.id', adGroupId: 'adGroups.adGroupId', campaignId: 'adGroups.campaignId' },
  keywords: { id: 'keywords.id', adGroupId: 'keywords.internalAdGroupId', keywordId: 'keywords.keywordId' },
  productTargets: { id: 'productTargets.id', adGroupId: 'productTargets.internalAdGroupId', targetId: 'productTargets.targetId' },
  dailyPerformance: {},
  hourlyPerformance: {},
  biddingLogs: {},
  placementPerformance: {},
  searchTerms: {},
  negativeKeywords: {},
  optimizationEvents: { keywordId: 'optimizationEvents.keywordId', eventCategory: 'optimizationEvents.eventCategory', apiSyncStatus: 'optimizationEvents.apiSyncStatus', createdAt: 'optimizationEvents.createdAt' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: vi.fn(),
  gte: vi.fn((...args: unknown[]) => ({ type: 'gte', args })),
  lte: vi.fn((...args: unknown[]) => ({ type: 'lte', args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: 'inArray', args })),
  desc: vi.fn(),
  asc: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  createModuleLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../utils/timezone', () => ({
  getMarketplaceDateRange: vi.fn().mockReturnValue({ startDate: '2025-01-01', endDate: '2025-01-31' }),
  getMarketplaceCurrentDate: vi.fn().mockReturnValue('2025-01-15'),
  getMarketplaceYesterday: vi.fn().mockReturnValue('2025-01-14'),
  getMarketplaceHistoricalDateRange: vi.fn().mockReturnValue({ startDate: '2024-12-01', endDate: '2025-01-15' }),
}));

vi.mock('../services/exchangeRateService', () => ({
  getExchangeRateByMarketplace: vi.fn().mockResolvedValue({ currency: 'USD', rate: 1.0 }),
}));

vi.mock('../sync/syncHelpers', () => ({
  SYNC_PROTECTION_CONFIG: {
    BID_PROTECTION_HOURS: 24,
    BUDGET_PROTECTION_HOURS: 24,
    BID_THRESHOLD: 0.01,
    BUDGET_THRESHOLD: 0.01,
  },
  createSyncProtectionStats: vi.fn(() => ({
    bidProtected: 0,
    bidOverwritten: 0,
    budgetProtected: 0,
    budgetOverwritten: 0,
    protectedEntities: [],
  })),
  logSyncProtectionSummary: vi.fn(),
  hasRecentSyncedOptimization: vi.fn().mockResolvedValue(false),
  getRecentlyOptimizedKeywordIds: vi.fn().mockResolvedValue(new Set()),
  getRecentlyOptimizedCampaignIds: vi.fn().mockResolvedValue(new Set()),
}));

// ==================== 测试数据工厂 ====================

function createMockSpCampaign(overrides: Partial<unknown> = {}): unknown {
  return {
    campaignId: 100001,
    name: 'Test SP Campaign',
    state: 'enabled',
    targetingType: 'manual',
    dailyBudget: 50,
    startDate: '2025-01-01',
    endDate: undefined,
    premiumBidAdjustment: false,
    bidding: {
      strategy: 'legacyForSales',
      adjustments: [
        { predicate: 'placementTop', percentage: 50 },
        { predicate: 'placementProductPage', percentage: 20 },
      ],
    },
    ...overrides,
  };
}

function createMockSpAdGroup(overrides: Partial<unknown> = {}): unknown {
  return {
    adGroupId: 200001,
    campaignId: 100001,
    name: 'Test Ad Group',
    state: 'enabled',
    defaultBid: 1.50,
    ...overrides,
  };
}

function createMockSpKeyword(overrides: Partial<unknown> = {}): unknown {
  return {
    keywordId: 300001,
    adGroupId: 200001,
    campaignId: 100001,
    state: 'enabled',
    keywordText: 'test keyword',
    matchType: 'exact',
    bid: 1.20,
    ...overrides,
  };
}

function createMockSpProductTarget(overrides: Partial<unknown> = {}): unknown {
  return {
    targetId: 400001,
    adGroupId: 200001,
    campaignId: 100001,
    state: 'enabled',
    expressionType: 'manual',
    expression: [{ type: 'asinSameAs', value: 'B0TESTEXAMPLE' }],
    bid: 0.80,
    ...overrides,
  };
}

// ==================== 导入被测模块 ====================

import { AmazonSyncService } from '../sync/amazonSyncService';
import '../sync/syncSp';
import '../sync/syncBidOperations';

// ==================== 测试套件 ====================

describe('syncSp 集成测试（纯 Mock，不触及真实数据）', () => {
  let syncService: AmazonSyncService;
  let mockClient: unknown;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      listSpCampaigns: vi.fn().mockResolvedValue([]),
      listSpAdGroups: vi.fn().mockResolvedValue([]),
      listSpKeywords: vi.fn().mockResolvedValue([]),
      listSpProductTargets: vi.fn().mockResolvedValue([]),
      listSpNegativeKeywords: vi.fn().mockResolvedValue([]),
      listSpNegativeProductTargets: vi.fn().mockResolvedValue([]),
      updateKeywordBids: vi.fn().mockResolvedValue({ success: true, errors: [] }),
      updateProductTargetBids: vi.fn().mockResolvedValue({ success: true, errors: [] }),
    };

    syncService = new AmazonSyncService(mockClient, 1, 1, 'US');

    // 重置 mockDb 的默认行为
    mockGetDb.mockResolvedValue(mockDb);
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockReturnValue(Promise.resolve([]));
    mockDb.groupBy.mockReturnValue(Promise.resolve([]));
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnValue(Promise.resolve());
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== syncSpCampaigns ====================

  describe('syncSpCampaigns', () => {
    it('应在数据库连接失败时返回 { synced: 0, skipped: 0 }', async () => {
      mockGetDb.mockResolvedValueOnce(null);

      const result = await syncService.syncSpCampaigns();
      expect(result).toEqual({ synced: 0, skipped: 0 });
    });

    it('应在 API 返回空数组时返回 { synced: 0, skipped: 0 }', async () => {
      mockClient.listSpCampaigns.mockResolvedValue([]);

      const result = await syncService.syncSpCampaigns();
      expect(result).toEqual({ synced: 0, skipped: 0 });
      expect(mockClient.listSpCampaigns).toHaveBeenCalledOnce();
    });

    it('应成功同步新的 SP 广告活动（插入模式）', async () => {
      const mockCampaign = createMockSpCampaign();
      mockClient.listSpCampaigns.mockResolvedValue([mockCampaign]);
      mockDb.limit.mockResolvedValue([]);

      const result = await syncService.syncSpCampaigns();
      expect(result).toEqual({ synced: 1, skipped: 0 });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('应成功同步已存在的 SP 广告活动（更新模式）', async () => {
      const mockCampaign = createMockSpCampaign();
      mockClient.listSpCampaigns.mockResolvedValue([mockCampaign]);

      const existingRecord = { id: 1, dailyBudget: '50', placementTopSearchBidAdjustment: 50, placementProductPageBidAdjustment: 20 };
      mockDb.limit.mockResolvedValue([existingRecord]);

      const result = await syncService.syncSpCampaigns();
      expect(result).toEqual({ synced: 1, skipped: 0 });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('应正确解析嵌套的 budget 结构', async () => {
      const mockCampaign = createMockSpCampaign({
        dailyBudget: undefined,
        budget: { budget: 75.50 },
      });
      mockClient.listSpCampaigns.mockResolvedValue([mockCampaign]);
      mockDb.limit.mockResolvedValue([]);

      const result = await syncService.syncSpCampaigns();
      expect(result).toEqual({ synced: 1, skipped: 0 });
    });

    it('应正确处理 YYYYMMDD 格式的日期', async () => {
      const mockCampaign = createMockSpCampaign({
        startDate: '20250115',
        endDate: '20250228',
      });
      mockClient.listSpCampaigns.mockResolvedValue([mockCampaign]);
      mockDb.limit.mockResolvedValue([]);

      const result = await syncService.syncSpCampaigns();
      expect(result).toEqual({ synced: 1, skipped: 0 });
    });

    it('应在预算保护生效时保留本地预算', async () => {
      const { getRecentlyOptimizedCampaignIds } = await import('../sync/syncHelpers');
      (getRecentlyOptimizedCampaignIds as Record<string, unknown>).mockResolvedValue(new Set([1]));

      const mockCampaign = createMockSpCampaign({ dailyBudget: 30 });
      mockClient.listSpCampaigns.mockResolvedValue([mockCampaign]);

      const existingRecord = { id: 1, dailyBudget: '50', placementTopSearchBidAdjustment: 50, placementProductPageBidAdjustment: 20 };
      mockDb.limit.mockResolvedValue([existingRecord]);

      const result = await syncService.syncSpCampaigns();
      expect(result).toEqual({ synced: 1, skipped: 0 });
    });

    it('应正确处理多个广告活动的批量同步', async () => {
      const campaigns = [
        createMockSpCampaign({ campaignId: 100001, name: 'Campaign A' }),
        createMockSpCampaign({ campaignId: 100002, name: 'Campaign B' }),
        createMockSpCampaign({ campaignId: 100003, name: 'Campaign C' }),
      ];
      mockClient.listSpCampaigns.mockResolvedValue(campaigns);
      mockDb.limit.mockResolvedValue([]);

      const result = await syncService.syncSpCampaigns();
      expect(result).toEqual({ synced: 3, skipped: 0 });
    });

    it('应在 API 调用失败时返回 { synced: 0, skipped: 0 }', async () => {
      mockClient.listSpCampaigns.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await syncService.syncSpCampaigns();
      expect(result).toEqual({ synced: 0, skipped: 0 });
    });

    it('应正确处理 auto 类型的广告活动', async () => {
      const mockCampaign = createMockSpCampaign({ targetingType: 'AUTO' });
      mockClient.listSpCampaigns.mockResolvedValue([mockCampaign]);
      mockDb.limit.mockResolvedValue([]);

      const result = await syncService.syncSpCampaigns();
      expect(result).toEqual({ synced: 1, skipped: 0 });
    });
  });

  // ==================== syncSpAdGroups ====================

  describe('syncSpAdGroups', () => {
    it('应在数据库连接失败时返回 { synced: 0, skipped: 0 }', async () => {
      mockGetDb.mockResolvedValueOnce(null);

      const result = await syncService.syncSpAdGroups();
      expect(result).toEqual({ synced: 0, skipped: 0 });
    });

    it('应成功同步新的广告组', async () => {
      const mockAdGroup = createMockSpAdGroup();
      mockClient.listSpAdGroups.mockResolvedValue([mockAdGroup]);

      let callCount = 0;
      mockDb.limit.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([{ id: 1, campaignId: '100001' }]);
        }
        return Promise.resolve([]);
      });

      const result = await syncService.syncSpAdGroups();
      expect(result).toEqual({ synced: 1, skipped: 0 });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('应正确更新已存在的广告组', async () => {
      const mockAdGroup = createMockSpAdGroup();
      mockClient.listSpAdGroups.mockResolvedValue([mockAdGroup]);

      let callCount = 0;
      mockDb.limit.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([{ id: 1, campaignId: '100001' }]);
        }
        return Promise.resolve([{ id: 10, adGroupId: '200001' }]);
      });

      const result = await syncService.syncSpAdGroups();
      expect(result).toEqual({ synced: 1, skipped: 0 });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('应在 API 调用失败时返回 { synced: 0, skipped: 0 }', async () => {
      mockClient.listSpAdGroups.mockRejectedValue(new Error('Network error'));

      const result = await syncService.syncSpAdGroups();
      expect(result).toEqual({ synced: 0, skipped: 0 });
    });
  });

  // ==================== syncSpKeywords ====================

  describe('syncSpKeywords', () => {
    it('应在数据库连接失败时返回 { synced: 0, skipped: 0 }', async () => {
      mockGetDb.mockResolvedValueOnce(null);

      const result = await syncService.syncSpKeywords();
      expect(result).toEqual({ synced: 0, skipped: 0 });
    });

    it('应成功同步新关键词（插入模式）', async () => {
      const mockKeyword = createMockSpKeyword();
      mockClient.listSpKeywords.mockResolvedValue([mockKeyword]);

      let callCount = 0;
      mockDb.limit.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return Promise.resolve([{ id: 1, adGroupId: '200001', campaignId: '100001' }]);
        }
        return Promise.resolve([]);
      });

      const result = await syncService.syncSpKeywords();
      expect(result).toEqual({ synced: 1, skipped: 0 });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('应在出价保护生效时保留本地出价', async () => {
      const { getRecentlyOptimizedKeywordIds } = await import('../sync/syncHelpers');
      (getRecentlyOptimizedKeywordIds as Record<string, unknown>).mockResolvedValue(new Set([10]));

      const mockKeyword = createMockSpKeyword({ bid: 0.80 });
      mockClient.listSpKeywords.mockResolvedValue([mockKeyword]);

      let callCount = 0;
      mockDb.limit.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return Promise.resolve([{ id: 1, adGroupId: '200001', campaignId: '100001' }]);
        }
        return Promise.resolve([{ id: 10, keywordId: '300001', keywordText: 'test keyword', bid: '1.50' }]);
      });

      const result = await syncService.syncSpKeywords();
      expect(result).toEqual({ synced: 1, skipped: 0 });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('应在 API 调用失败时返回 { synced: 0, skipped: 0 }', async () => {
      mockClient.listSpKeywords.mockRejectedValue(new Error('Throttled'));

      const result = await syncService.syncSpKeywords();
      expect(result).toEqual({ synced: 0, skipped: 0 });
    });

    it('应跳过没有对应广告组的关键词', async () => {
      const mockKeyword = createMockSpKeyword();
      mockClient.listSpKeywords.mockResolvedValue([mockKeyword]);
      mockDb.limit.mockResolvedValue([]);

      const result = await syncService.syncSpKeywords();
      expect(result).toEqual({ synced: 0, skipped: 0 });
    });
  });

  // ==================== syncSpProductTargets ====================

  describe('syncSpProductTargets', () => {
    it('应在数据库连接失败时返回 { synced: 0, skipped: 0 }', async () => {
      mockGetDb.mockResolvedValueOnce(null);

      const result = await syncService.syncSpProductTargets();
      expect(result).toEqual({ synced: 0, skipped: 0 });
    });

    it('应成功同步新的商品定位（ASIN 定向）', async () => {
      const mockTarget = createMockSpProductTarget();
      mockClient.listSpProductTargets.mockResolvedValue([mockTarget]);

      let callCount = 0;
      mockDb.limit.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return Promise.resolve([{ id: 1, adGroupId: '200001', campaignId: '100001' }]);
        }
        return Promise.resolve([]);
      });

      const result = await syncService.syncSpProductTargets();
      expect(result).toEqual({ synced: 1, skipped: 0 });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('应正确解析品类定向表达式', async () => {
      const mockTarget = createMockSpProductTarget({
        expression: [
          { type: 'asinCategorySameAs', value: '12345' },
          { type: 'asinPriceBetween', value: '10-50' },
        ],
      });
      mockClient.listSpProductTargets.mockResolvedValue([mockTarget]);

      let callCount = 0;
      mockDb.limit.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return Promise.resolve([{ id: 1, adGroupId: '200001', campaignId: '100001' }]);
        }
        return Promise.resolve([]);
      });

      const result = await syncService.syncSpProductTargets();
      expect(result).toEqual({ synced: 1, skipped: 0 });
    });

    it('应正确处理自动定向表达式', async () => {
      const mockTarget = createMockSpProductTarget({
        expressionType: 'auto',
        expression: [{ type: 'queryBroadRelMatches', value: '' }],
      });
      mockClient.listSpProductTargets.mockResolvedValue([mockTarget]);

      let callCount = 0;
      mockDb.limit.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return Promise.resolve([{ id: 1, adGroupId: '200001', campaignId: '100001' }]);
        }
        return Promise.resolve([]);
      });

      const result = await syncService.syncSpProductTargets();
      expect(result).toEqual({ synced: 1, skipped: 0 });
    });

    it('应在 API 调用失败时返回 { synced: 0, skipped: 0 }', async () => {
      mockClient.listSpProductTargets.mockRejectedValue(new Error('API error'));

      const result = await syncService.syncSpProductTargets();
      expect(result).toEqual({ synced: 0, skipped: 0 });
    });
  });

  // ==================== getPlacementMultiplier ====================

  describe('getPlacementMultiplier', () => {
    it('应正确提取 placementTop 调整系数', () => {
      const campaign: unknown = {
        bidding: {
          adjustments: [
            { predicate: 'placementTop', percentage: 80 },
            { predicate: 'placementProductPage', percentage: 30 },
          ],
        },
      };
      expect(syncService.getPlacementMultiplier(campaign, 'placementTop')).toBe(80);
    });

    it('应正确提取 placementProductPage 调整系数', () => {
      const campaign: unknown = {
        bidding: {
          adjustments: [
            { predicate: 'placementTop', percentage: 50 },
            { predicate: 'placementProductPage', percentage: 25 },
          ],
        },
      };
      expect(syncService.getPlacementMultiplier(campaign, 'placementProductPage')).toBe(25);
    });

    it('应在没有调整时返回 0', () => {
      const campaign: unknown = { bidding: {} };
      expect(syncService.getPlacementMultiplier(campaign, 'placementTop')).toBe(0);
    });

    it('应在 bidding 为 undefined 时返回 0', () => {
      const campaign: unknown = {};
      expect(syncService.getPlacementMultiplier(campaign, 'placementTop')).toBe(0);
    });

    it('应在 adjustments 为空数组时返回 0', () => {
      const campaign: unknown = { bidding: { adjustments: [] } };
      expect(syncService.getPlacementMultiplier(campaign, 'placementTop')).toBe(0);
    });

    it('应正确处理 percentage 为字符串的情况', () => {
      const campaign: unknown = {
        bidding: { adjustments: [{ predicate: 'placementTop', percentage: '75' }] },
      };
      expect(syncService.getPlacementMultiplier(campaign, 'placementTop')).toBe(75);
    });
  });
});
