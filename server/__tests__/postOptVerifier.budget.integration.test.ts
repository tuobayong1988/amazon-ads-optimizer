/**
 * PostOptimizationVerifier 预算验证 - 端到端集成测试
 * 
 * 测试 verifyBudgetAdjustments 函数的两条完整路径：
 * 
 * 路径A (数据库优先验证)：
 *   getDb() 返回有效 Drizzle 实例 → 查询 campaigns 表 → 
 *   对比 dailyBudget 与 expectedValue → confirmed/conflict/not_found
 * 
 * 路径B (API 回退验证)：
 *   getDb() 返回 null → 调用 verifyBudgetAdjustmentsViaApi →
 *   通过 syncService.client.listSpCampaigns/listSbCampaigns/listSdCampaigns 获取预算 →
 *   对比 → confirmed/conflict/not_found
 * 
 * 混合路径 (DB部分成功 + API补充)：
 *   DB查到部分campaign → 部分confirmed → 未找到的项回退API验证
 * 
 * 边缘场景：
 *   - DB查询异常 → 单项回退API
 *   - API调用全部失败 → error状态
 *   - 预算容差判定（±$0.01）
 *   - 空items数组
 *   - getDb()抛出异常
 * 
 * 所有数据库操作和 Amazon API 调用均使用 vi.mock() 完全模拟，
 * 不会连接任何真实数据库或 Amazon API。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==================== 使用 vi.hoisted 定义可在 vi.mock 中引用的变量 ====================

const { mockDb, mockGetDb, mockSyncService } = vi.hoisted(() => {
  const limit = vi.fn().mockResolvedValue([]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const db = { select, from, where, limit };

  const mockGetDb = vi.fn().mockResolvedValue(db);

  const mockSyncService = {
    client: {
      listSpCampaigns: vi.fn().mockResolvedValue([]),
      listSbCampaigns: vi.fn().mockResolvedValue([]),
      listSdCampaigns: vi.fn().mockResolvedValue([]),
    },
  };

  return { mockDb: db, mockGetDb, mockSyncService };
});

// ==================== Mock 定义 ====================

vi.mock('../db', () => ({
  getDb: mockGetDb,
}));

vi.mock('../../drizzle/schema', () => ({
  campaigns: {
    id: 'campaigns.id',
    accountId: 'campaigns.accountId',
    campaignId: 'campaigns.campaignId',
    dailyBudget: 'campaigns.dailyBudget',
  },
  keywords: { id: 'keywords.id', keywordId: 'keywords.keywordId', bid: 'keywords.bid' },
  negativeKeywords: { id: 'negativeKeywords.id' },
  syncConflicts: { id: 'syncConflicts.id' },
  sdAudiences: { id: 'sdAudiences.id' },
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

vi.mock('../sync/syncCoordinator', () => ({
  isSyncRunning: vi.fn().mockReturnValue(false),
  getSyncLockInfo: vi.fn().mockReturnValue(null),
  isAccountSyncing: vi.fn().mockReturnValue(false),
  getAccountLockInfo: vi.fn().mockReturnValue(null),
}));

vi.mock('../services/amazonApiHelper', () => ({
  getAmazonSyncService: vi.fn().mockResolvedValue(null),
}));

// ==================== 导入被测模块 ====================

import { __test__ } from '../optimization/postOptimizationVerifier';
const { verifyBudgetAdjustments, verifyBudgetAdjustmentsViaApi } = __test__;

// ==================== 测试辅助工具 ====================

interface VerificationItem {
  type: string;
  localId: number;
  amazonId: string;
  expectedValue: unknown;
  context?: {
    campaignId?: number;
    adGroupId?: number;
    accountId?: number;
    fieldName?: string;
  };
}

interface VerificationResult {
  item: VerificationItem;
  status: 'confirmed' | 'conflict' | 'not_found' | 'error';
  actualValue?: unknown;
  message?: string;
}

function createBudgetItem(overrides: Partial<VerificationItem> = {}): VerificationItem {
  return {
    type: 'budget_adjustment',
    localId: 1001,
    amazonId: '12345678901234',
    expectedValue: 50.00,
    context: { campaignId: 1, accountId: 100 },
    ...overrides,
  };
}

function mockDbQueryResult(results: Array<{ dailyBudget: number | null; campaignId: string }>) {
  mockDb.limit.mockResolvedValue(results);
}

function mockDbQueryError(error: Error) {
  mockDb.limit.mockRejectedValue(error);
}

function mockApiCampaigns(options: {
  sp?: Array<{ campaignId: string; dailyBudget?: number; budget?: { dailyBudget?: number; budget?: number } }>;
  sb?: Array<{ campaignId: string; dailyBudget?: number; budget?: { dailyBudget?: number; budget?: number } }>;
  sd?: Array<{ campaignId: string; dailyBudget?: number; budget?: { dailyBudget?: number } }>;
}) {
  if (options.sp) mockSyncService.client.listSpCampaigns.mockResolvedValue(options.sp);
  if (options.sb) mockSyncService.client.listSbCampaigns.mockResolvedValue(options.sb);
  if (options.sd) mockSyncService.client.listSdCampaigns.mockResolvedValue(options.sd);
}

// ==================== 测试套件 ====================

describe('PostOptVerifier 预算验证 - 端到端测试', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    // 恢复默认行为
    mockGetDb.mockResolvedValue(mockDb);
    mockDb.select.mockReturnValue({ from: mockDb.from });
    mockDb.from.mockReturnValue({ where: mockDb.where });
    mockDb.where.mockReturnValue({ limit: mockDb.limit });
    mockDb.limit.mockResolvedValue([]);
    mockSyncService.client.listSpCampaigns.mockResolvedValue([]);
    mockSyncService.client.listSbCampaigns.mockResolvedValue([]);
    mockSyncService.client.listSdCampaigns.mockResolvedValue([]);
  });

  // ============================================================
  // 路径A：数据库优先验证
  // ============================================================

  describe('路径A: 数据库优先验证', () => {

    it('A1: DB查到campaign且预算一致 → confirmed', async () => {
      const item = createBudgetItem({ amazonId: '99001122334455', expectedValue: 35.50 });
      mockDbQueryResult([{ dailyBudget: 35.50, campaignId: '99001122334455' }]);

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
      expect(results[0].actualValue).toBe(35.50);
      // 不应调用API
      expect(mockSyncService.client.listSpCampaigns).not.toHaveBeenCalled();
    });

    it('A2: DB查到campaign但预算不一致 → 回退API验证并确认', async () => {
      const item = createBudgetItem({ amazonId: '99001122334455', expectedValue: 50.00 });
      mockDbQueryResult([{ dailyBudget: 45.00, campaignId: '99001122334455' }]);
      mockApiCampaigns({ sp: [{ campaignId: '99001122334455', dailyBudget: 50.00 }] });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
      expect(results[0].actualValue).toBe(50.00);
      expect(mockSyncService.client.listSpCampaigns).toHaveBeenCalled();
    });

    it('A3: DB未找到campaign → 回退API验证', async () => {
      const item = createBudgetItem({ amazonId: '99001122334455', expectedValue: 25.00 });
      mockDbQueryResult([]);
      mockApiCampaigns({ sb: [{ campaignId: '99001122334455', budget: { dailyBudget: 25.00 } }] });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
      expect(results[0].actualValue).toBe(25.00);
    });

    it('A4: DB查到campaign但dailyBudget为null → 回退API验证', async () => {
      const item = createBudgetItem({ amazonId: '99001122334455', expectedValue: 30.00 });
      mockDbQueryResult([{ dailyBudget: null, campaignId: '99001122334455' }]);
      mockApiCampaigns({ sd: [{ campaignId: '99001122334455', dailyBudget: 30.00 }] });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
    });

    it('A5: DB查询抛出异常 → 单项回退API验证', async () => {
      const item = createBudgetItem({ amazonId: '99001122334455', expectedValue: 20.00 });
      mockDbQueryError(new Error('Connection timeout'));
      mockApiCampaigns({ sp: [{ campaignId: '99001122334455', dailyBudget: 20.00 }] });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
      expect(mockSyncService.client.listSpCampaigns).toHaveBeenCalled();
    });

    it('A6: 多个items - 部分DB确认，部分回退API', async () => {
      const items = [
        createBudgetItem({ localId: 1, amazonId: '111', expectedValue: 10.00 }),
        createBudgetItem({ localId: 2, amazonId: '222', expectedValue: 20.00 }),
        createBudgetItem({ localId: 3, amazonId: '333', expectedValue: 30.00 }),
      ];

      let callCount = 0;
      mockDb.limit.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([{ dailyBudget: 10.00, campaignId: '111' }]);
        if (callCount === 2) return Promise.resolve([]);
        return Promise.resolve([{ dailyBudget: 25.00, campaignId: '333' }]);
      });

      mockApiCampaigns({
        sp: [
          { campaignId: '222', dailyBudget: 20.00 },
          { campaignId: '333', dailyBudget: 30.00 },
        ],
      });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, items);

      expect(results).toHaveLength(3);
      const r1 = results.find(r => r.item.localId === 1);
      expect(r1?.status).toBe('confirmed');
      expect(r1?.actualValue).toBe(10.00);
      const r2 = results.find(r => r.item.localId === 2);
      expect(r2?.status).toBe('confirmed');
      const r3 = results.find(r => r.item.localId === 3);
      expect(r3?.status).toBe('confirmed');
    });

    it('A7: 预算容差判定 - 差异在$0.01内视为confirmed', async () => {
      const item = createBudgetItem({ amazonId: '555', expectedValue: 100.00 });
      mockDbQueryResult([{ dailyBudget: 100.009, campaignId: '555' }]);

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
    });

    it('A8: 预算容差判定 - 差异超过$0.01视为conflict需API验证', async () => {
      const item = createBudgetItem({ amazonId: '555', expectedValue: 100.00 });
      mockDbQueryResult([{ dailyBudget: 100.02, campaignId: '555' }]);
      mockApiCampaigns({ sp: [{ campaignId: '555', dailyBudget: 100.02 }] });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('conflict');
      expect(results[0].actualValue).toBe(100.02);
    });
  });

  // ============================================================
  // 路径B：API 回退验证（getDb返回null）
  // ============================================================

  describe('路径B: API回退验证（数据库不可用）', () => {

    beforeEach(() => {
      mockGetDb.mockResolvedValue(null);
    });

    it('B1: DB不可用 → 通过SP API找到campaign并确认预算', async () => {
      const item = createBudgetItem({ amazonId: '77788899900', expectedValue: 45.00 });
      mockApiCampaigns({ sp: [{ campaignId: '77788899900', dailyBudget: 45.00 }] });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
      expect(results[0].actualValue).toBe(45.00);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('B2: DB不可用 → 通过SB API找到campaign（嵌套budget结构）', async () => {
      const item = createBudgetItem({ amazonId: '88899900011', expectedValue: 60.00 });
      mockApiCampaigns({
        sp: [],
        sb: [{ campaignId: '88899900011', budget: { dailyBudget: 60.00 } }],
      });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
      expect(results[0].actualValue).toBe(60.00);
    });

    it('B3: DB不可用 → 通过SD API找到campaign', async () => {
      const item = createBudgetItem({ amazonId: '11122233344', expectedValue: 80.00 });
      mockApiCampaigns({
        sp: [],
        sb: [],
        sd: [{ campaignId: '11122233344', dailyBudget: 80.00 }],
      });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
    });

    it('B4: DB不可用 → API中未找到campaign → not_found', async () => {
      const item = createBudgetItem({ amazonId: '99999999999', expectedValue: 100.00 });
      mockApiCampaigns({ sp: [], sb: [], sd: [] });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_found');
    });

    it('B5: DB不可用 → API预算不一致 → conflict', async () => {
      const item = createBudgetItem({ amazonId: '44455566677', expectedValue: 50.00 });
      mockApiCampaigns({ sp: [{ campaignId: '44455566677', dailyBudget: 75.00 }] });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('conflict');
      expect(results[0].actualValue).toBe(75.00);
      expect(results[0].message).toContain('期望预算');
    });

    it('B6: DB不可用 → SP API rejected被catch捕获 → 返回空数组 → not_found', async () => {
      const item = createBudgetItem({ amazonId: '12345', expectedValue: 10.00 });
      // listSpCampaigns().catch(() => []) 会将rejected promise转为空数组
      mockSyncService.client.listSpCampaigns.mockRejectedValue(new Error('API rate limit'));

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      // 因为.catch(() => [])处理了错误，所以不会进入error分支，而是找不到campaign
      expect(results[0].status).toBe('not_found');
    });

    it('B6b: DB不可用 → API返回非法数据导致整体异常 → error', async () => {
      const item = createBudgetItem({ amazonId: '12345', expectedValue: 10.00 });
      // 让listSpCampaigns返回一个会在for循环中崩溃的值
      mockSyncService.client.listSpCampaigns.mockResolvedValue(null as unknown);

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
    });

    it('B7: DB不可用 → 多个items跨SP/SB/SD类型', async () => {
      const items = [
        createBudgetItem({ localId: 1, amazonId: 'sp001', expectedValue: 10.00 }),
        createBudgetItem({ localId: 2, amazonId: 'sb001', expectedValue: 20.00 }),
        createBudgetItem({ localId: 3, amazonId: 'sd001', expectedValue: 30.00 }),
        createBudgetItem({ localId: 4, amazonId: 'missing', expectedValue: 40.00 }),
      ];

      mockApiCampaigns({
        sp: [{ campaignId: 'sp001', dailyBudget: 10.00 }],
        sb: [{ campaignId: 'sb001', budget: { dailyBudget: 20.00 } }],
        sd: [{ campaignId: 'sd001', dailyBudget: 30.00 }],
      });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, items);

      expect(results).toHaveLength(4);
      expect(results.filter(r => r.status === 'confirmed')).toHaveLength(3);
      expect(results.filter(r => r.status === 'not_found')).toHaveLength(1);
    });
  });

  // ============================================================
  // 路径B直接测试：verifyBudgetAdjustmentsViaApi
  // ============================================================

  describe('路径B直接测试: verifyBudgetAdjustmentsViaApi', () => {

    it('ViaApi-1: SP campaign使用顶层dailyBudget字段', async () => {
      const item = createBudgetItem({ amazonId: 'sp_top', expectedValue: 55.00 });
      mockApiCampaigns({ sp: [{ campaignId: 'sp_top', dailyBudget: 55.00 }] });

      const results: VerificationResult[] = await verifyBudgetAdjustmentsViaApi(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
    });

    it('ViaApi-2: SB campaign使用budget.budget字段（旧版API格式）', async () => {
      const item = createBudgetItem({ amazonId: 'sb_old', expectedValue: 100.00 });
      mockApiCampaigns({
        sp: [],
        sb: [{ campaignId: 'sb_old', budget: { budget: 100.00 } }],
        sd: [],
      });

      const results: VerificationResult[] = await verifyBudgetAdjustmentsViaApi(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
      expect(results[0].actualValue).toBe(100.00);
    });

    it('ViaApi-3: SP API rejected被catch捕获 → not_found', async () => {
      const item = createBudgetItem({ amazonId: '12345', expectedValue: 10.00 });
      // .catch(() => []) 会将rejected转为空数组
      mockSyncService.client.listSpCampaigns.mockRejectedValue(new Error('Network error'));

      const results: VerificationResult[] = await verifyBudgetAdjustmentsViaApi(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_found');
    });

    it('ViaApi-4: API返回null导致for循环崩溃 → error', async () => {
      const item = createBudgetItem({ amazonId: '12345', expectedValue: 10.00 });
      mockSyncService.client.listSpCampaigns.mockResolvedValue(null as unknown);

      const results: VerificationResult[] = await verifyBudgetAdjustmentsViaApi(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
    });
  });

  // ============================================================
  // 边缘场景
  // ============================================================

  describe('边缘场景', () => {

    it('E1: 空items数组 → 返回空结果', async () => {
      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, []);
      expect(results).toHaveLength(0);
    });

    it('E2: expectedValue为字符串数字 → Number()正确转换', async () => {
      const item = createBudgetItem({ amazonId: '12345', expectedValue: '50.00' });
      mockDbQueryResult([{ dailyBudget: 50.00, campaignId: '12345' }]);

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
    });

    it('E3: getDb()抛出异常（非返回null）→ 整体error', async () => {
      mockGetDb.mockRejectedValue(new Error('Database connection pool exhausted'));

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [
        createBudgetItem({ amazonId: '12345', expectedValue: 50.00 }),
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
    });

    it('E4: API部分失败（SP成功，SB/SD rejected）→ catch处理后仍能验证SP中的campaign', async () => {
      mockGetDb.mockResolvedValue(null);
      const item = createBudgetItem({ amazonId: 'sp_only', expectedValue: 25.00 });
      mockSyncService.client.listSpCampaigns.mockResolvedValue([{ campaignId: 'sp_only', dailyBudget: 25.00 }]);
      // 使用mockRejectedValue而非同步throw，这样.catch(() => [])可以正确捕获
      mockSyncService.client.listSbCampaigns.mockRejectedValue(new Error('SB API down'));
      mockSyncService.client.listSdCampaigns.mockRejectedValue(new Error('SD API down'));

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      // .catch(() => []) 会将rejected转为空数组，不影响SP的结果
      expect(results[0].status).toBe('confirmed');
    });

    it('E4b: API同步throw（非Promise reject）→ 整体error', async () => {
      mockGetDb.mockResolvedValue(null);
      const item = createBudgetItem({ amazonId: 'sp_only', expectedValue: 25.00 });
      // 同步throw不会被.catch()捕获，会导致整个try块失败
      mockSyncService.client.listSpCampaigns.mockImplementation(() => { throw new Error('Sync throw'); });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
    });

    it('E5: 大批量验证（50个items）不会超时或崩溃', async () => {
      const items = Array.from({ length: 50 }, (_, i) =>
        createBudgetItem({ localId: i + 1, amazonId: `campaign_${i}`, expectedValue: 10 + i })
      );

      // 所有DB查询都返回匹配结果
      let idx = 0;
      mockDb.limit.mockImplementation(() => {
        const val = 10 + idx;
        idx++;
        return Promise.resolve([{ dailyBudget: val, campaignId: `campaign_${idx - 1}` }]);
      });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, items);

      expect(results).toHaveLength(50);
      expect(results.every(r => r.status === 'confirmed')).toBe(true);
      expect(mockSyncService.client.listSpCampaigns).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // v750修复验证：await getDb() 正确性
  // ============================================================

  describe('v750修复验证: getDb() async正确性', () => {

    it('V750-1: getDb()是异步函数 → 正确await后获得DB实例', async () => {
      const item = createBudgetItem({ amazonId: '12345', expectedValue: 50.00 });
      mockDbQueryResult([{ dailyBudget: 50.00, campaignId: '12345' }]);

      await verifyBudgetAdjustments(mockSyncService, [item]);

      // 如果await正确，select应该被调用（说明拿到了真正的db实例而非Promise）
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('V750-2: getDb()返回null → 正确进入API回退路径而非报错', async () => {
      mockGetDb.mockResolvedValue(null);
      const item = createBudgetItem({ amazonId: '12345', expectedValue: 50.00 });
      mockApiCampaigns({ sp: [{ campaignId: '12345', dailyBudget: 50.00 }] });

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockSyncService.client.listSpCampaigns).toHaveBeenCalled();
      expect(results[0].status).toBe('confirmed');
    });

    it('V750-3: getDb()延迟返回 → 不会产生竞态条件', async () => {
      mockGetDb.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(mockDb), 50)));
      const item = createBudgetItem({ amazonId: '12345', expectedValue: 50.00 });
      mockDbQueryResult([{ dailyBudget: 50.00, campaignId: '12345' }]);

      const results: VerificationResult[] = await verifyBudgetAdjustments(mockSyncService, [item]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('confirmed');
    });
  });
});
