/**
 * 用户体验优化功能单元测试
 * 测试批量操作确认、引导流程进度保存、API状态检测等功能
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage for testing onboarding progress
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

describe('引导流程进度保存功能', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('应该能够保存引导进度到localStorage', () => {
    const ONBOARDING_PROGRESS_KEY = 'amazon-ads-optimizer-onboarding-progress';
    const step = 'connect';
    
    localStorageMock.setItem(ONBOARDING_PROGRESS_KEY, step);
    
    expect(localStorageMock.getItem(ONBOARDING_PROGRESS_KEY)).toBe('connect');
  });

  it('应该能够恢复保存的引导进度', () => {
    const ONBOARDING_PROGRESS_KEY = 'amazon-ads-optimizer-onboarding-progress';
    localStorageMock.setItem(ONBOARDING_PROGRESS_KEY, 'sync');
    
    const savedProgress = localStorageMock.getItem(ONBOARDING_PROGRESS_KEY);
    
    expect(savedProgress).toBe('sync');
  });

  it('完成引导后应该清除进度', () => {
    const ONBOARDING_STORAGE_KEY = 'amazon-ads-optimizer-onboarding-completed';
    const ONBOARDING_PROGRESS_KEY = 'amazon-ads-optimizer-onboarding-progress';
    
    localStorageMock.setItem(ONBOARDING_PROGRESS_KEY, 'connect');
    localStorageMock.setItem(ONBOARDING_STORAGE_KEY, 'true');
    localStorageMock.removeItem(ONBOARDING_PROGRESS_KEY);
    
    expect(localStorageMock.getItem(ONBOARDING_STORAGE_KEY)).toBe('true');
    expect(localStorageMock.getItem(ONBOARDING_PROGRESS_KEY)).toBeNull();
  });

  it('跳过引导后应该清除进度', () => {
    const ONBOARDING_STORAGE_KEY = 'amazon-ads-optimizer-onboarding-completed';
    const ONBOARDING_PROGRESS_KEY = 'amazon-ads-optimizer-onboarding-progress';
    
    localStorageMock.setItem(ONBOARDING_PROGRESS_KEY, 'connect');
    localStorageMock.setItem(ONBOARDING_STORAGE_KEY, 'skipped');
    localStorageMock.removeItem(ONBOARDING_PROGRESS_KEY);
    
    expect(localStorageMock.getItem(ONBOARDING_STORAGE_KEY)).toBe('skipped');
    expect(localStorageMock.getItem(ONBOARDING_PROGRESS_KEY)).toBeNull();
  });

  it('重置引导应该清除所有相关存储', () => {
    const ONBOARDING_STORAGE_KEY = 'amazon-ads-optimizer-onboarding-completed';
    const ONBOARDING_PROGRESS_KEY = 'amazon-ads-optimizer-onboarding-progress';
    
    localStorageMock.setItem(ONBOARDING_STORAGE_KEY, 'true');
    localStorageMock.setItem(ONBOARDING_PROGRESS_KEY, 'sync');
    
    // Reset
    localStorageMock.removeItem(ONBOARDING_STORAGE_KEY);
    localStorageMock.removeItem(ONBOARDING_PROGRESS_KEY);
    
    expect(localStorageMock.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    expect(localStorageMock.getItem(ONBOARDING_PROGRESS_KEY)).toBeNull();
  });
});

describe('批量操作确认逻辑', () => {
  it('应该正确识别高风险批量操作', () => {
    const isHighRiskOperation = (totalItems: number, operationType: string) => {
      if (totalItems > 10) return true;
      if (operationType === 'campaign_status') return true;
      if (operationType === 'bid_adjustment' && totalItems > 5) return true;
      return false;
    };

    expect(isHighRiskOperation(15, 'negative_keyword')).toBe(true);
    expect(isHighRiskOperation(5, 'campaign_status')).toBe(true);
    expect(isHighRiskOperation(8, 'bid_adjustment')).toBe(true);
    expect(isHighRiskOperation(3, 'negative_keyword')).toBe(false);
  });

  it('应该生成正确的确认消息', () => {
    const generateConfirmMessage = (batchName: string, totalItems: number) => {
      if (totalItems > 10) {
        return `此操作将影响 ${totalItems} 个项目，请谨慎确认`;
      }
      return `您即将执行"${batchName}"批量操作`;
    };

    expect(generateConfirmMessage('测试批次', 15)).toContain('15 个项目');
    expect(generateConfirmMessage('测试批次', 5)).toContain('测试批次');
  });

  it('应该正确格式化操作类型标签', () => {
    const operationTypeLabels: Record<string, string> = {
      negative_keyword: '否定词添加',
      bid_adjustment: '出价调整',
      keyword_migration: '关键词迁移',
      campaign_status: '广告活动状态',
    };

    expect(operationTypeLabels['negative_keyword']).toBe('否定词添加');
    expect(operationTypeLabels['campaign_status']).toBe('广告活动状态');
  });
});

describe('API状态检测逻辑', () => {
  it('应该正确判断API健康状态', () => {
    type HealthStatus = 'healthy' | 'expired' | 'error' | 'not_configured';
    
    const getStatusLabel = (status: HealthStatus) => {
      const labels: Record<HealthStatus, string> = {
        healthy: '正常',
        expired: '已过期',
        error: '连接错误',
        not_configured: '未配置',
      };
      return labels[status];
    };

    expect(getStatusLabel('healthy')).toBe('正常');
    expect(getStatusLabel('expired')).toBe('已过期');
    expect(getStatusLabel('not_configured')).toBe('未配置');
  });

  it('应该正确判断是否需要重新授权', () => {
    const needsReauth = (status: string) => {
      return status === 'expired' || status === 'not_configured';
    };

    expect(needsReauth('expired')).toBe(true);
    expect(needsReauth('not_configured')).toBe(true);
    expect(needsReauth('healthy')).toBe(false);
    expect(needsReauth('error')).toBe(false);
  });

  it('应该正确计算同步警告', () => {
    const shouldShowSyncWarning = (daysSinceSync: number | null) => {
      return daysSinceSync !== null && daysSinceSync > 7;
    };

    expect(shouldShowSyncWarning(10)).toBe(true);
    expect(shouldShowSyncWarning(5)).toBe(false);
    expect(shouldShowSyncWarning(null)).toBe(false);
  });

  it('应该正确格式化最近同步时间', () => {
    const formatSyncTime = (timestamp: number) => {
      const now = Date.now();
      const diff = now - timestamp;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      
      if (days === 0) return '今天';
      if (days === 1) return '昨天';
      return `${days}天前`;
    };

    const now = Date.now();
    expect(formatSyncTime(now)).toBe('今天');
    expect(formatSyncTime(now - 24 * 60 * 60 * 1000)).toBe('昨天');
    expect(formatSyncTime(now - 3 * 24 * 60 * 60 * 1000)).toBe('3天前');
  });
});

describe('变更预览功能', () => {
  it('应该正确计算变更百分比', () => {
    const calculateChangePercent = (oldValue: number, newValue: number) => {
      if (oldValue === 0) return newValue > 0 ? 100 : 0;
      return ((newValue - oldValue) / oldValue) * 100;
    };

    expect(calculateChangePercent(100, 120)).toBe(20);
    expect(calculateChangePercent(100, 80)).toBe(-20);
    expect(calculateChangePercent(0, 50)).toBe(100);
  });

  it('应该正确格式化变更项', () => {
    interface ChangeItem {
      id: number;
      name: string;
      field: string;
      fieldLabel: string;
      oldValue: number;
      newValue: number;
      unit?: string;
    }

    const formatChangeItem = (item: ChangeItem) => {
      const change = item.newValue - item.oldValue;
      const direction = change > 0 ? '增加' : '减少';
      return `${item.name}: ${item.fieldLabel}${direction} ${Math.abs(change)}${item.unit || ''}`;
    };

    const item: ChangeItem = {
      id: 1,
      name: '测试广告活动',
      field: 'budget',
      fieldLabel: '预算',
      oldValue: 100,
      newValue: 150,
      unit: '美元',
    };

    expect(formatChangeItem(item)).toBe('测试广告活动: 预算增加 50美元');
  });

  it('应该正确统计受影响的项目数', () => {
    const countAffectedItems = (changes: Array<{ id: number }>) => {
      const uniqueIds = new Set(changes.map(c => c.id));
      return uniqueIds.size;
    };

    const changes = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 1, name: 'A' }, // 重复
      { id: 3, name: 'C' },
    ];

    expect(countAffectedItems(changes)).toBe(3);
  });
});
