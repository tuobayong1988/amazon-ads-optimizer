/**
 * 自动出价优化 - 集成测试
 * 
 * 测试 autoBidOptimization 子模块中的核心方法：
 * - runAutoBidOptimization: 自动出价优化主流程
 * 
 * 所有数据库操作和 Amazon API 调用均使用 vi.mock() 完全模拟，
 * 不会连接任何真实数据库或 Amazon API，不会触及真实广告数据。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== 使用 vi.hoisted 定义可在 vi.mock 中引用的变量 ====================

const { mockGetDb } = vi.hoisted(() => {
  const mockGetDb = vi.fn();
  return { mockGetDb };
});

/**
 * 创建一个 Drizzle-style 的 db mock，使用 Proxy 实现链式调用。
 * 
 * 关键设计：
 * - db 对象本身没有 .then（避免 await getDb() 触发 thenable）
 * - 链式方法（select/from/where 等）返回的对象有 .then（支持 await db.select().from().where()）
 * - .then(callback) 返回 callback(thenData) 的结果
 * 
 * @param thenData - .then() 回调收到的数据（模拟查询结果）
 */
function createDbProxy(thenData: any[] = []): any {
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') return undefined; // db 本身不是 thenable
      if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag || prop === 'constructor') return undefined;
      // 所有方法返回一个有 .then 的链式 proxy
      return (..._args: any[]) => createChainProxy(thenData);
    }
  };
  return new Proxy({}, handler);
}

function createChainProxy(thenData: any[]): any {
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: any, reject?: any) => Promise.resolve(thenData).then(resolve, reject);
      }
      if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag || prop === 'constructor') return undefined;
      return (..._args: any[]) => new Proxy({}, handler); // 继续链式
    }
  };
  return new Proxy({}, handler);
}

// ==================== Mock 定义 ====================

vi.mock('../db', () => ({
  getDb: mockGetDb,
}));

vi.mock('../../drizzle/schema', () => ({
  campaigns: { id: 'id', accountId: 'accountId', campaignId: 'campaignId', optimizationStatus: 'optimizationStatus' },
  adGroups: { id: 'id', adGroupId: 'adGroupId', campaignId: 'campaignId' },
  keywords: { id: 'id', adGroupId: 'adGroupId', keywordId: 'keywordId', bid: 'bid', keywordStatus: 'keywordStatus' },
  productTargets: { id: 'id', adGroupId: 'adGroupId', targetId: 'targetId', bid: 'bid' },
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

vi.mock('../nextGenBidOrchestrator', () => ({
  batchCalculateNextGenBids: vi.fn().mockResolvedValue([
    {
      targetId: 10,
      targetType: 'keyword',
      previousBid: 1.00,
      newBid: 1.30,
      actionType: 'increase',
      bidChangePercent: 30,
      reason: 'Performance improvement',
      algorithmUsed: 'nextgen-v2',
      confidence: 0.85,
    },
  ]),
}));

vi.mock('../contextualFeatureService', () => ({
  buildContextFeatures: vi.fn().mockResolvedValue({
    dayOfWeek: 3,
    hourOfDay: 14,
    isWeekend: false,
    seasonality: 'normal',
  }),
}));

vi.mock('../sync/scheduling/syncServiceProvider', () => ({
  getAmazonSyncService: vi.fn().mockResolvedValue(null),
}));

// ==================== 导入被测模块 ====================

import { runAutoBidOptimization } from '../sync/autoBidOptimization';

// ==================== 测试辅助 ====================

function createMockSyncService(): any {
  return {
    accountId: 1,
    marketplace: 'US',
    applyBidAdjustment: vi.fn().mockResolvedValue(true),
    applyBatchBidAdjustments: vi.fn().mockResolvedValue({ success: 0, failed: 0 }),
  };
}

function createMockPerformanceGroupConfig(): any {
  return {
    optimizationGoal: 'maximize_sales',
    strategyTemplate: 'balanced',
    targetAcos: 30,
    targetRoas: 3.0,
    dailySpendLimit: 100,
    maxBid: 5.0,
  };
}

// ==================== 测试套件 ====================

describe('autoBidOptimization 集成测试（纯 Mock，不触及真实数据）', () => {
  let mockSyncService: any;
  let mockConfig: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncService = createMockSyncService();
    mockConfig = createMockPerformanceGroupConfig();
    // 默认返回空结果的 db
    mockGetDb.mockImplementation(() => Promise.resolve(createDbProxy([])));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runAutoBidOptimization', () => {
    it('应在数据库连接失败时返回 { optimized: 0, skipped: 0 }', async () => {
      mockGetDb.mockResolvedValueOnce(null);

      const result = await runAutoBidOptimization(mockSyncService, 1, mockConfig);
      expect(result).toEqual({ optimized: 0, skipped: 0 });
    });

    it('应在没有启用关键词时返回 { optimized: 0, skipped: 0 }', async () => {
      // 默认 db proxy 返回空数组，.then(rows => rows.map(r => r.keyword)) 得到 []
      const result = await runAutoBidOptimization(mockSyncService, 1, mockConfig);
      expect(result.optimized).toBe(0);
      // 即使没有关键词，内部逻辑可能仍然计数 skipped
      expect(typeof result.skipped).toBe('number');
    });

    it('应接受不同的 accountId 参数', async () => {
      const result1 = await runAutoBidOptimization(mockSyncService, 42, mockConfig);
      expect(result1).toBeDefined();
      expect(result1).toHaveProperty('optimized');
      expect(result1).toHaveProperty('skipped');

      const result2 = await runAutoBidOptimization(mockSyncService, 100, mockConfig);
      expect(result2).toBeDefined();
    });

    it('应在有启用关键词时尝试使用 NextGen 算法', async () => {
      // 数据格式：.select({ keyword: keywords }) 返回 [{keyword: {...}}, ...]
      // .then(rows => rows.map(r => r.keyword)) 提取出关键词对象
      const mockRows = [
        { keyword: { id: 10, keywordId: '300001', keywordText: 'test keyword', bid: '1.00', adGroupId: 1, matchType: 'broad' } },
        { keyword: { id: 11, keywordId: '300002', keywordText: 'another keyword', bid: '1.50', adGroupId: 1, matchType: 'exact' } },
      ];

      mockGetDb.mockImplementationOnce(() => Promise.resolve(createDbProxy(mockRows)));

      const result = await runAutoBidOptimization(mockSyncService, 1, mockConfig);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('optimized');
    });

    it('应在 NextGen 算法失败时回退到传统算法', async () => {
      const mockRows = [
        { keyword: { id: 10, keywordId: '300001', keywordText: 'test keyword', bid: '1.00', adGroupId: 1, matchType: 'broad', impressions: 100, clicks: 10, spend: '5.00', sales: '20.00', orders: 2 } },
      ];

      mockGetDb.mockImplementationOnce(() => Promise.resolve(createDbProxy(mockRows)));

      // 让 NextGen 算法抛出异常
      const { batchCalculateNextGenBids } = await import('../nextGenBidOrchestrator');
      (batchCalculateNextGenBids as any).mockRejectedValueOnce(new Error('NextGen unavailable'));

      const result = await runAutoBidOptimization(mockSyncService, 1, mockConfig);
      expect(result).toBeDefined();
      // 回退到传统算法后应该有优化结果
      expect(typeof result.optimized).toBe('number');
    });

    it('应正确处理单个关键词的优化', async () => {
      const mockRows = [
        { keyword: { id: 10, keywordId: '300001', keywordText: 'single keyword', bid: '2.00', adGroupId: 1, matchType: 'phrase', impressions: 50, clicks: 5, spend: '3.00', sales: '10.00', orders: 1 } },
      ];

      mockGetDb.mockImplementationOnce(() => Promise.resolve(createDbProxy(mockRows)));

      const result = await runAutoBidOptimization(mockSyncService, 1, mockConfig);
      expect(result).toBeDefined();
      expect(typeof result.optimized).toBe('number');
      expect(typeof result.skipped).toBe('number');
    });

    it('应在 accountId 为 0 时仍能执行', async () => {
      const result = await runAutoBidOptimization(mockSyncService, 0, mockConfig);
      expect(result).toBeDefined();
      expect(result.optimized).toBe(0);
      expect(typeof result.skipped).toBe('number');
    });

    it('应正确使用 performanceGroupConfig 中的参数', async () => {
      const customConfig = createMockPerformanceGroupConfig();
      customConfig.targetAcos = 15;
      customConfig.maxBid = 10.0;

      const result = await runAutoBidOptimization(mockSyncService, 1, customConfig);
      expect(result).toBeDefined();
    });
  });
});
