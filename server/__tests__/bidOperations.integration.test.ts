/**
 * 出价调整操作 - 集成测试
 * 
 * 测试 bidOperations 子模块中的核心方法：
 * - applyBidAdjustment: 单个出价调整并同步到 Amazon API
 * - applyBatchBidAdjustments: 批量出价调整
 * - getPlacementMultiplier: 展示位置调整系数提取
 * 
 * 所有数据库操作和 Amazon API 调用均使用 vi.mock() 完全模拟，
 * 不会连接任何真实数据库或 Amazon API，不会触及真实广告数据。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== 使用 vi.hoisted 定义可在 vi.mock 中引用的变量 ====================

const { mockDb, mockGetDb } = vi.hoisted(() => {
  const db: any = {
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
  keywords: { id: 'keywords.id', adGroupId: 'keywords.internalAdGroupId', keywordId: 'keywords.keywordId', bid: 'keywords.bid' },
  productTargets: { id: 'productTargets.id', adGroupId: 'productTargets.internalAdGroupId', targetId: 'productTargets.targetId', bid: 'productTargets.bid' },
  dailyPerformance: {},
  hourlyPerformance: {},
  biddingLogs: {},
  placementPerformance: {},
  searchTerms: {},
  negativeKeywords: {},
  optimizationEvents: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: any[]) => ({ type: 'and', args })),
  sql: vi.fn(),
  gte: vi.fn((...args: any[]) => ({ type: 'gte', args })),
  lte: vi.fn((...args: any[]) => ({ type: 'lte', args })),
  inArray: vi.fn((...args: any[]) => ({ type: 'inArray', args })),
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
    bidProtected: 0, bidOverwritten: 0, budgetProtected: 0, budgetOverwritten: 0, protectedEntities: [],
  })),
  logSyncProtectionSummary: vi.fn(),
  hasRecentSyncedOptimization: vi.fn().mockResolvedValue(false),
  getRecentlyOptimizedKeywordIds: vi.fn().mockResolvedValue(new Set()),
  getRecentlyOptimizedCampaignIds: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock('../bidOptimizer', () => ({
  calculateBidAdjustment: vi.fn().mockReturnValue({
    newBid: 1.50,
    action: 'increase',
    reason: 'Performance improvement',
    confidence: 0.85,
  }),
}));

vi.mock('../services/amazonIdResolver', () => ({
  resolveKeywordIdOnDemand: vi.fn().mockResolvedValue({ amazonId: 'amz-kw-001', source: 'cache' }),
  resolveProductTargetIdOnDemand: vi.fn().mockResolvedValue({ amazonId: 'amz-pt-001', source: 'cache' }),
}));

// ==================== 导入被测模块 ====================

import { AmazonSyncService } from '../sync/amazonSyncService';
import '../sync/syncBidOperations';

// ==================== 测试套件 ====================

describe('bidOperations 集成测试（纯 Mock，不触及真实数据）', () => {
  let syncService: AmazonSyncService;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      listSpCampaigns: vi.fn().mockResolvedValue([]),
      listSpAdGroups: vi.fn().mockResolvedValue([]),
      listSpKeywords: vi.fn().mockResolvedValue([]),
      listSpProductTargets: vi.fn().mockResolvedValue([]),
      updateKeywordBids: vi.fn().mockResolvedValue({ success: true, errors: [] }),
      updateProductTargetBids: vi.fn().mockResolvedValue({ success: true, errors: [] }),
      updateSpKeywords: vi.fn().mockResolvedValue([{ keywordId: 300001, code: 'SUCCESS' }]),
      updateSpTargets: vi.fn().mockResolvedValue([{ targetId: 400001, code: 'SUCCESS' }]),
    };

    syncService = new AmazonSyncService(mockClient, 1, 1, 'US');

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

  // ==================== applyBidAdjustment ====================

  describe('applyBidAdjustment', () => {
    it('应成功调整关键词出价', async () => {
      mockDb.limit.mockImplementation(() => {
        return Promise.resolve([{
          id: 10,
          keywordId: '300001',
          keywordText: 'test keyword',
          bid: '1.00',
          adGroupId: 1,
        }]);
      });

      const result = await syncService.applyBidAdjustment(
        'keyword', 10, 1.50, 'Performance optimization', 1
      );

      // v358: applyBidAdjustment返回对象{success: boolean, apiResponseId?}而非纯boolean
      expect(result).toBeTruthy();
      if (typeof result === 'object') {
        expect(result.success).toBe(true);
      }
    });

    it('应成功调整商品定位出价', async () => {
      mockDb.limit.mockImplementation(() => {
        return Promise.resolve([{
          id: 20,
          targetId: '400001',
          targetValue: 'B0TESTEXAMPLE',
          bid: '0.80',
          adGroupId: 1,
        }]);
      });

      const result = await syncService.applyBidAdjustment(
        'product_target', 20, 1.20, 'ACOS improvement', 1
      );

      // v358: applyBidAdjustment返回对象{success: boolean, apiResponseId?}而非纯boolean
      expect(result).toBeTruthy();
      if (typeof result === 'object') {
        expect(result.success).toBe(true);
      }
    });

    it('应在数据库连接失败时返回 false', async () => {
      mockGetDb.mockResolvedValueOnce(null);

      const result = await syncService.applyBidAdjustment(
        'keyword', 10, 1.50, 'Test', 1
      );

      expect(result).toBe(false);
    });

    it('应在目标不存在时返回 false', async () => {
      mockDb.limit.mockResolvedValue([]);

      const result = await syncService.applyBidAdjustment(
        'keyword', 999, 1.50, 'Test', 1
      );

      expect(result).toBe(false);
    });

    it('应在出价为负数时返回 false', async () => {
      const result = await syncService.applyBidAdjustment(
        'keyword', 10, -0.50, 'Invalid bid', 1
      );

      expect(result).toBe(false);
    });

    it('应记录出价调整日志', async () => {
      mockDb.limit.mockImplementation(() => {
        return Promise.resolve([{
          id: 10,
          keywordId: '300001',
          keywordText: 'test keyword',
          bid: '1.00',
          adGroupId: 1,
        }]);
      });

      await syncService.applyBidAdjustment(
        'keyword', 10, 1.50, 'Performance optimization', 1
      );

      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  // ==================== applyBatchBidAdjustments ====================

  describe('applyBatchBidAdjustments', () => {
    it('应成功批量调整出价', async () => {
      mockDb.limit.mockImplementation(() => {
        return Promise.resolve([{
          id: 10,
          keywordId: '300001',
          keywordText: 'test keyword',
          bid: '1.00',
          adGroupId: 1,
        }]);
      });

      const adjustments = [
        { targetType: 'keyword' as const, targetId: 10, newBid: 1.50, reason: 'Test A', campaignId: 1 },
        { targetType: 'keyword' as const, targetId: 11, newBid: 1.80, reason: 'Test B', campaignId: 1 },
      ];

      const result = await syncService.applyBatchBidAdjustments(adjustments);
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('failed');
      expect(result.success + result.failed).toBe(2);
    });

    it('应在空数组时返回 { success: 0, failed: 0 }', async () => {
      const result = await syncService.applyBatchBidAdjustments([]);
      expect(result).toEqual({ success: 0, failed: 0 });
    });

    it('应正确统计成功和失败数量', async () => {
      let callCount = 0;
      mockDb.limit.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve([{
            id: 10,
            keywordId: '300001',
            keywordText: 'test keyword',
            bid: '1.00',
            adGroupId: 1,
          }]);
        }
        return Promise.resolve([]);
      });

      const adjustments = [
        { targetType: 'keyword' as const, targetId: 10, newBid: 1.50, reason: 'Test A', campaignId: 1 },
        { targetType: 'keyword' as const, targetId: 999, newBid: 1.80, reason: 'Test B', campaignId: 1 },
      ];

      const result = await syncService.applyBatchBidAdjustments(adjustments);
      expect(result.success + result.failed).toBe(2);
    });

    it('应支持混合类型的批量调整', async () => {
      mockDb.limit.mockImplementation(() => {
        return Promise.resolve([{
          id: 10,
          keywordId: '300001',
          keywordText: 'test keyword',
          bid: '1.00',
          adGroupId: 1,
          targetId: '400001',
          targetValue: 'B0TEST',
        }]);
      });

      const adjustments = [
        { targetType: 'keyword' as const, targetId: 10, newBid: 1.50, reason: 'Keyword opt', campaignId: 1 },
        { targetType: 'product_target' as const, targetId: 20, newBid: 0.90, reason: 'Target opt', campaignId: 1 },
      ];

      const result = await syncService.applyBatchBidAdjustments(adjustments);
      expect(result.success + result.failed).toBe(2);
    });
  });

  // ==================== getPlacementMultiplier ====================

  describe('getPlacementMultiplier', () => {
    it('应正确提取 placementTop 调整系数', () => {
      const campaign: any = {
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
      const campaign: any = {
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
      const campaign: any = { bidding: {} };
      expect(syncService.getPlacementMultiplier(campaign, 'placementTop')).toBe(0);
    });

    it('应在 bidding 为 undefined 时返回 0', () => {
      const campaign: any = {};
      expect(syncService.getPlacementMultiplier(campaign, 'placementTop')).toBe(0);
    });

    it('应在 adjustments 为空数组时返回 0', () => {
      const campaign: any = { bidding: { adjustments: [] } };
      expect(syncService.getPlacementMultiplier(campaign, 'placementTop')).toBe(0);
    });

    it('应在找不到匹配的 predicate 时返回 0', () => {
      const campaign: any = {
        bidding: { adjustments: [{ predicate: 'placementTop', percentage: 50 }] },
      };
      expect(syncService.getPlacementMultiplier(campaign, 'placementProductPage')).toBe(0);
    });

    it('应正确处理 percentage 为字符串的情况', () => {
      const campaign: any = {
        bidding: { adjustments: [{ predicate: 'placementTop', percentage: '75' }] },
      };
      expect(syncService.getPlacementMultiplier(campaign, 'placementTop')).toBe(75);
    });

    it('应正确处理 percentage 为 0 的情况', () => {
      const campaign: any = {
        bidding: { adjustments: [{ predicate: 'placementTop', percentage: 0 }] },
      };
      expect(syncService.getPlacementMultiplier(campaign, 'placementTop')).toBe(0);
    });
  });
});
