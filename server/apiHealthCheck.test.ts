/**
 * API健康检测和操作确认功能单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟Token健康状态检测逻辑
function checkTokenHealth(credentials: {
  hasCredentials: boolean;
  isValid: boolean;
  lastSyncAt?: Date;
}) {
  if (!credentials.hasCredentials) {
    return {
      status: 'not_configured' as const,
      message: '未配置API凭证',
      isHealthy: false,
      needsReauth: true,
    };
  }

  if (!credentials.isValid) {
    return {
      status: 'expired' as const,
      message: 'Token已过期，请重新授权',
      isHealthy: false,
      needsReauth: true,
    };
  }

  const daysSinceSync = credentials.lastSyncAt
    ? Math.floor((Date.now() - credentials.lastSyncAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const syncWarning = daysSinceSync !== null && daysSinceSync > 7;

  return {
    status: 'healthy' as const,
    message: 'API连接正常',
    isHealthy: true,
    needsReauth: false,
    daysSinceSync,
    syncWarning,
  };
}

// 模拟操作确认逻辑
interface ChangeItem {
  id: string | number;
  name: string;
  field: string;
  fieldLabel: string;
  oldValue: number | string;
  newValue: number | string;
  unit?: string;
  changePercent?: number;
}

function validateOperationChanges(changes: ChangeItem[]): {
  isValid: boolean;
  totalChanges: number;
  increaseCount: number;
  decreaseCount: number;
  riskLevel: 'low' | 'medium' | 'high';
} {
  const totalChanges = changes.length;
  const increaseCount = changes.filter(c => 
    typeof c.oldValue === 'number' && typeof c.newValue === 'number' && c.newValue > c.oldValue
  ).length;
  const decreaseCount = changes.filter(c => 
    typeof c.oldValue === 'number' && typeof c.newValue === 'number' && c.newValue < c.oldValue
  ).length;

  // 根据变更数量和类型确定风险等级
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (totalChanges > 10) {
    riskLevel = 'high';
  } else if (totalChanges > 5 || decreaseCount > 3) {
    riskLevel = 'medium';
  }

  return {
    isValid: totalChanges > 0,
    totalChanges,
    increaseCount,
    decreaseCount,
    riskLevel,
  };
}

// 计算变更百分比
function calculateChangePercent(oldValue: number, newValue: number): number {
  if (oldValue === 0) return newValue > 0 ? 100 : 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

describe('API健康检测', () => {
  describe('checkTokenHealth', () => {
    it('应该返回未配置状态当没有凭证时', () => {
      const result = checkTokenHealth({
        hasCredentials: false,
        isValid: false,
      });

      expect(result.status).toBe('not_configured');
      expect(result.isHealthy).toBe(false);
      expect(result.needsReauth).toBe(true);
      expect(result.message).toBe('未配置API凭证');
    });

    it('应该返回过期状态当Token无效时', () => {
      const result = checkTokenHealth({
        hasCredentials: true,
        isValid: false,
      });

      expect(result.status).toBe('expired');
      expect(result.isHealthy).toBe(false);
      expect(result.needsReauth).toBe(true);
      expect(result.message).toBe('Token已过期，请重新授权');
    });

    it('应该返回健康状态当Token有效时', () => {
      const result = checkTokenHealth({
        hasCredentials: true,
        isValid: true,
        lastSyncAt: new Date(),
      });

      expect(result.status).toBe('healthy');
      expect(result.isHealthy).toBe(true);
      expect(result.needsReauth).toBe(false);
      expect(result.message).toBe('API连接正常');
    });

    it('应该显示同步警告当超过7天未同步时', () => {
      const eightDaysAgo = new Date();
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

      const result = checkTokenHealth({
        hasCredentials: true,
        isValid: true,
        lastSyncAt: eightDaysAgo,
      });

      expect(result.status).toBe('healthy');
      expect(result.isHealthy).toBe(true);
      expect(result.syncWarning).toBe(true);
      expect(result.daysSinceSync).toBeGreaterThanOrEqual(8);
    });

    it('应该不显示同步警告当最近同步过时', () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const result = checkTokenHealth({
        hasCredentials: true,
        isValid: true,
        lastSyncAt: twoDaysAgo,
      });

      expect(result.syncWarning).toBe(false);
      expect(result.daysSinceSync).toBeLessThanOrEqual(2);
    });
  });
});

describe('操作确认验证', () => {
  describe('validateOperationChanges', () => {
    it('应该正确统计变更数量', () => {
      const changes: ChangeItem[] = [
        { id: 1, name: '活动1', field: 'budget', fieldLabel: '预算', oldValue: 100, newValue: 150 },
        { id: 2, name: '活动2', field: 'budget', fieldLabel: '预算', oldValue: 200, newValue: 180 },
        { id: 3, name: '活动3', field: 'budget', fieldLabel: '预算', oldValue: 150, newValue: 150 },
      ];

      const result = validateOperationChanges(changes);

      expect(result.totalChanges).toBe(3);
      expect(result.increaseCount).toBe(1);
      expect(result.decreaseCount).toBe(1);
      expect(result.isValid).toBe(true);
    });

    it('应该返回低风险当变更数量少时', () => {
      const changes: ChangeItem[] = [
        { id: 1, name: '活动1', field: 'budget', fieldLabel: '预算', oldValue: 100, newValue: 150 },
      ];

      const result = validateOperationChanges(changes);

      expect(result.riskLevel).toBe('low');
    });

    it('应该返回中风险当变更数量适中时', () => {
      const changes: ChangeItem[] = Array.from({ length: 6 }, (_, i) => ({
        id: i,
        name: `活动${i}`,
        field: 'budget',
        fieldLabel: '预算',
        oldValue: 100,
        newValue: 150,
      }));

      const result = validateOperationChanges(changes);

      expect(result.riskLevel).toBe('medium');
    });

    it('应该返回高风险当变更数量多时', () => {
      const changes: ChangeItem[] = Array.from({ length: 15 }, (_, i) => ({
        id: i,
        name: `活动${i}`,
        field: 'budget',
        fieldLabel: '预算',
        oldValue: 100,
        newValue: 150,
      }));

      const result = validateOperationChanges(changes);

      expect(result.riskLevel).toBe('high');
    });

    it('应该返回无效当没有变更时', () => {
      const result = validateOperationChanges([]);

      expect(result.isValid).toBe(false);
      expect(result.totalChanges).toBe(0);
    });

    it('应该返回中风险当减少项目较多时', () => {
      const changes: ChangeItem[] = [
        { id: 1, name: '活动1', field: 'budget', fieldLabel: '预算', oldValue: 100, newValue: 50 },
        { id: 2, name: '活动2', field: 'budget', fieldLabel: '预算', oldValue: 200, newValue: 100 },
        { id: 3, name: '活动3', field: 'budget', fieldLabel: '预算', oldValue: 150, newValue: 75 },
        { id: 4, name: '活动4', field: 'budget', fieldLabel: '预算', oldValue: 180, newValue: 90 },
      ];

      const result = validateOperationChanges(changes);

      expect(result.riskLevel).toBe('medium');
      expect(result.decreaseCount).toBe(4);
    });
  });

  describe('calculateChangePercent', () => {
    it('应该正确计算增加百分比', () => {
      const percent = calculateChangePercent(100, 150);
      expect(percent).toBe(50);
    });

    it('应该正确计算减少百分比', () => {
      const percent = calculateChangePercent(200, 150);
      expect(percent).toBe(-25);
    });

    it('应该处理零值情况', () => {
      const percent = calculateChangePercent(0, 100);
      expect(percent).toBe(100);
    });

    it('应该处理无变化情况', () => {
      const percent = calculateChangePercent(100, 100);
      expect(percent).toBe(0);
    });

    it('应该正确计算小数百分比', () => {
      const percent = calculateChangePercent(100, 133);
      expect(percent).toBe(33);
    });
  });
});

describe('批量操作风险评估', () => {
  it('应该识别高风险的批量暂停操作', () => {
    const changes: ChangeItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      name: `活动${i}`,
      field: 'status',
      fieldLabel: '状态',
      oldValue: '启用中',
      newValue: '已暂停',
    }));

    const result = validateOperationChanges(changes);

    expect(result.riskLevel).toBe('high');
    expect(result.totalChanges).toBe(20);
  });

  it('应该识别混合变更的风险等级', () => {
    const changes: ChangeItem[] = [
      { id: 1, name: '活动1', field: 'budget', fieldLabel: '预算', oldValue: 100, newValue: 200 },
      { id: 2, name: '活动2', field: 'budget', fieldLabel: '预算', oldValue: 150, newValue: 100 },
      { id: 3, name: '活动3', field: 'bid', fieldLabel: '竞价', oldValue: 1.5, newValue: 2.0 },
    ];

    const result = validateOperationChanges(changes);

    expect(result.totalChanges).toBe(3);
    expect(result.increaseCount).toBe(2);
    expect(result.decreaseCount).toBe(1);
    expect(result.riskLevel).toBe('low');
  });
});
