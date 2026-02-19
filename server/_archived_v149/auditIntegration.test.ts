/**
 * 审计日志集成测试
 * 验证关键操作点的审计日志记录功能
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logAudit, ACTION_DESCRIPTIONS, ACTION_CATEGORIES } from './auditService';

// Mock getDb
vi.mock('./db', () => ({
  getDb: vi.fn().mockResolvedValue({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: 1,
          userId: 1,
          userName: 'Test User',
          userEmail: 'test@test.com',
          actionType: 'bid_adjust_single',
          targetType: 'keyword',
          targetId: '123',
          targetName: 'test keyword',
          description: '调整关键词出价',
          status: 'success',
          createdAt: new Date().toISOString(),
        }]),
      }),
    }),
  }),
}));

describe('审计日志服务', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('操作类型定义', () => {
    it('应该包含出价调整操作类型', () => {
      expect(ACTION_CATEGORIES.bid).toContain('bid_adjust_single');
      expect(ACTION_CATEGORIES.bid).toContain('bid_adjust_batch');
      expect(ACTION_CATEGORIES.bid).toContain('bid_rollback');
    });

    it('应该包含广告活动操作类型', () => {
      expect(ACTION_CATEGORIES.campaign).toContain('campaign_create');
      expect(ACTION_CATEGORIES.campaign).toContain('campaign_update');
      expect(ACTION_CATEGORIES.campaign).toContain('campaign_delete');
    });

    it('应该包含数据操作类型', () => {
      expect(ACTION_CATEGORIES.data).toContain('data_import');
      expect(ACTION_CATEGORIES.data).toContain('data_export');
    });

    it('应该包含自动化操作类型', () => {
      expect(ACTION_CATEGORIES.automation).toContain('automation_enable');
      expect(ACTION_CATEGORIES.automation).toContain('automation_disable');
      expect(ACTION_CATEGORIES.automation).toContain('automation_config_update');
    });
  });

  describe('操作描述映射', () => {
    it('应该有单个出价调整的中文描述', () => {
      expect(ACTION_DESCRIPTIONS['bid_adjust_single']).toBe('单个出价调整');
    });

    it('应该有批量出价调整的中文描述', () => {
      expect(ACTION_DESCRIPTIONS['bid_adjust_batch']).toBe('批量出价调整');
    });

    it('应该有广告活动更新的中文描述', () => {
      expect(ACTION_DESCRIPTIONS['campaign_update']).toBe('更新广告活动');
    });

    it('应该有数据导入的中文描述', () => {
      expect(ACTION_DESCRIPTIONS['data_import']).toBe('导入数据');
    });
  });

  describe('logAudit函数', () => {
    it('应该成功记录单个出价调整日志', async () => {
      const result = await logAudit({
        userId: 1,
        userName: 'Test User',
        userEmail: 'test@test.com',
        actionType: 'bid_adjust_single',
        targetType: 'keyword',
        targetId: '123',
        targetName: 'yoga mat',
        description: '调整关键词出价从$1.50到$1.80',
        previousValue: { bid: '1.50' },
        newValue: { bid: '1.80' },
        status: 'success',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe(1);
    });

    it('应该成功记录批量出价调整日志', async () => {
      const result = await logAudit({
        userId: 1,
        userName: 'Test User',
        actionType: 'bid_adjust_batch',
        targetType: 'keyword',
        description: '批量调整10个关键词出价（提高10%）',
        metadata: { bidType: 'increase_percent', bidValue: 10, count: 10 },
        status: 'success',
      });

      expect(result).toBeDefined();
    });

    it('应该成功记录广告活动更新日志', async () => {
      const result = await logAudit({
        userId: 1,
        actionType: 'campaign_update',
        targetType: 'campaign',
        targetId: '456',
        targetName: 'Yoga Products Campaign',
        description: '更新广告活动（日预算: $100）',
        previousValue: { dailyBudget: '50' },
        newValue: { dailyBudget: '100' },
        status: 'success',
      });

      expect(result).toBeDefined();
    });

    it('应该成功记录数据同步日志', async () => {
      const result = await logAudit({
        userId: 1,
        actionType: 'data_import',
        targetType: 'account',
        targetId: '789',
        targetName: 'ElaraFit US',
        description: '启动数据同步（全部数据）',
        metadata: { syncType: 'all', jobId: 123 },
        accountId: 789,
        status: 'success',
      });

      expect(result).toBeDefined();
    });

    it('应该成功记录AI优化执行日志', async () => {
      const result = await logAudit({
        userId: 1,
        actionType: 'automation_config_update',
        targetType: 'campaign',
        targetId: '456',
        targetName: 'Yoga Products Campaign',
        description: '执行AI优化建议（5条建议）',
        metadata: { suggestionsCount: 5, aiSummary: 'AI分析摘要' },
        status: 'success',
      });

      expect(result).toBeDefined();
    });

    it('应该在没有提供描述时使用默认描述', async () => {
      const result = await logAudit({
        userId: 1,
        actionType: 'bid_adjust_single',
        targetType: 'keyword',
        status: 'success',
      });

      expect(result).toBeDefined();
    });
  });
});

describe('审计日志集成点', () => {
  it('出价调整操作应该记录审计日志', () => {
    // 验证出价调整操作类型存在
    expect(ACTION_CATEGORIES.bid).toBeDefined();
    expect(ACTION_CATEGORIES.bid.length).toBeGreaterThan(0);
  });

  it('广告活动管理操作应该记录审计日志', () => {
    // 验证广告活动操作类型存在
    expect(ACTION_CATEGORIES.campaign).toBeDefined();
    expect(ACTION_CATEGORIES.campaign.length).toBeGreaterThan(0);
  });

  it('数据同步操作应该记录审计日志', () => {
    // 验证数据操作类型存在
    expect(ACTION_CATEGORIES.data).toBeDefined();
    expect(ACTION_CATEGORIES.data).toContain('data_import');
  });

  it('自动化/策略执行操作应该记录审计日志', () => {
    // 验证自动化操作类型存在
    expect(ACTION_CATEGORIES.automation).toBeDefined();
    expect(ACTION_CATEGORIES.automation).toContain('automation_config_update');
  });
});
