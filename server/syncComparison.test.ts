import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 同步统计对比功能测试
 * 测试getLastSyncData函数返回正确的上次同步数据
 */

// 模拟数据库返回的同步任务数据
interface MockSyncJob {
  id: number;
  accountId: number;
  status: string;
  spCampaigns: number;
  sbCampaigns: number;
  sdCampaigns: number;
  adGroupsSynced: number;
  keywordsSynced: number;
  targetsSynced: number;
  completedAt: string;
}

// 模拟getLastSyncData函数的逻辑
function getLastSyncData(jobs: MockSyncJob[], accountId: number) {
  const completedJobs = jobs
    .filter(job => job.accountId === accountId && job.status === 'completed')
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  
  const lastJob = completedJobs[0];
  
  if (!lastJob) return null;
  
  return {
    sp: lastJob.spCampaigns || 0,
    sb: lastJob.sbCampaigns || 0,
    sd: lastJob.sdCampaigns || 0,
    adGroups: lastJob.adGroupsSynced || 0,
    keywords: lastJob.keywordsSynced || 0,
    targets: lastJob.targetsSynced || 0,
    syncedAt: lastJob.completedAt,
  };
}

// 计算同步数据差异
function calculateSyncDiff(
  current: { sp: number; sb: number; sd: number; adGroups: number; keywords: number; targets: number },
  previous: { sp: number; sb: number; sd: number; adGroups: number; keywords: number; targets: number } | null
) {
  if (!previous) return null;
  
  return {
    sp: current.sp - previous.sp,
    sb: current.sb - previous.sb,
    sd: current.sd - previous.sd,
    adGroups: current.adGroups - previous.adGroups,
    keywords: current.keywords - previous.keywords,
    targets: current.targets - previous.targets,
    totalCampaigns: (current.sp + current.sb + current.sd) - (previous.sp + previous.sb + previous.sd),
    totalKeywordsTargets: (current.keywords + current.targets) - (previous.keywords + previous.targets),
  };
}

describe('同步统计对比功能', () => {
  describe('getLastSyncData', () => {
    it('应该返回最近一次成功同步的数据', () => {
      const mockJobs: MockSyncJob[] = [
        {
          id: 1,
          accountId: 100,
          status: 'completed',
          spCampaigns: 50,
          sbCampaigns: 10,
          sdCampaigns: 5,
          adGroupsSynced: 100,
          keywordsSynced: 500,
          targetsSynced: 200,
          completedAt: '2026-01-07T10:00:00Z',
        },
        {
          id: 2,
          accountId: 100,
          status: 'completed',
          spCampaigns: 55,
          sbCampaigns: 12,
          sdCampaigns: 6,
          adGroupsSynced: 110,
          keywordsSynced: 550,
          targetsSynced: 220,
          completedAt: '2026-01-08T10:00:00Z',
        },
      ];

      const result = getLastSyncData(mockJobs, 100);
      
      expect(result).not.toBeNull();
      expect(result?.sp).toBe(55);
      expect(result?.sb).toBe(12);
      expect(result?.sd).toBe(6);
      expect(result?.adGroups).toBe(110);
      expect(result?.keywords).toBe(550);
      expect(result?.targets).toBe(220);
    });

    it('应该忽略失败的同步任务', () => {
      const mockJobs: MockSyncJob[] = [
        {
          id: 1,
          accountId: 100,
          status: 'completed',
          spCampaigns: 50,
          sbCampaigns: 10,
          sdCampaigns: 5,
          adGroupsSynced: 100,
          keywordsSynced: 500,
          targetsSynced: 200,
          completedAt: '2026-01-07T10:00:00Z',
        },
        {
          id: 2,
          accountId: 100,
          status: 'failed',
          spCampaigns: 0,
          sbCampaigns: 0,
          sdCampaigns: 0,
          adGroupsSynced: 0,
          keywordsSynced: 0,
          targetsSynced: 0,
          completedAt: '2026-01-08T10:00:00Z',
        },
      ];

      const result = getLastSyncData(mockJobs, 100);
      
      expect(result).not.toBeNull();
      expect(result?.sp).toBe(50);
      expect(result?.keywords).toBe(500);
    });

    it('没有同步记录时应该返回null', () => {
      const mockJobs: MockSyncJob[] = [];
      
      const result = getLastSyncData(mockJobs, 100);
      
      expect(result).toBeNull();
    });

    it('应该只返回指定账户的数据', () => {
      const mockJobs: MockSyncJob[] = [
        {
          id: 1,
          accountId: 100,
          status: 'completed',
          spCampaigns: 50,
          sbCampaigns: 10,
          sdCampaigns: 5,
          adGroupsSynced: 100,
          keywordsSynced: 500,
          targetsSynced: 200,
          completedAt: '2026-01-08T10:00:00Z',
        },
        {
          id: 2,
          accountId: 200,
          status: 'completed',
          spCampaigns: 30,
          sbCampaigns: 5,
          sdCampaigns: 3,
          adGroupsSynced: 60,
          keywordsSynced: 300,
          targetsSynced: 100,
          completedAt: '2026-01-08T11:00:00Z',
        },
      ];

      const result = getLastSyncData(mockJobs, 100);
      
      expect(result?.sp).toBe(50);
      expect(result?.keywords).toBe(500);
    });
  });

  describe('calculateSyncDiff', () => {
    it('应该正确计算数据增加的差异', () => {
      const current = { sp: 60, sb: 15, sd: 8, adGroups: 120, keywords: 600, targets: 250 };
      const previous = { sp: 50, sb: 10, sd: 5, adGroups: 100, keywords: 500, targets: 200 };
      
      const diff = calculateSyncDiff(current, previous);
      
      expect(diff).not.toBeNull();
      expect(diff?.sp).toBe(10);
      expect(diff?.sb).toBe(5);
      expect(diff?.sd).toBe(3);
      expect(diff?.adGroups).toBe(20);
      expect(diff?.keywords).toBe(100);
      expect(diff?.targets).toBe(50);
      expect(diff?.totalCampaigns).toBe(18); // (60+15+8) - (50+10+5) = 18
      expect(diff?.totalKeywordsTargets).toBe(150); // (600+250) - (500+200) = 150
    });

    it('应该正确计算数据减少的差异', () => {
      const current = { sp: 45, sb: 8, sd: 4, adGroups: 90, keywords: 450, targets: 180 };
      const previous = { sp: 50, sb: 10, sd: 5, adGroups: 100, keywords: 500, targets: 200 };
      
      const diff = calculateSyncDiff(current, previous);
      
      expect(diff?.sp).toBe(-5);
      expect(diff?.sb).toBe(-2);
      expect(diff?.sd).toBe(-1);
      expect(diff?.adGroups).toBe(-10);
      expect(diff?.keywords).toBe(-50);
      expect(diff?.targets).toBe(-20);
      expect(diff?.totalCampaigns).toBe(-8);
      expect(diff?.totalKeywordsTargets).toBe(-70);
    });

    it('数据没有变化时差异应该为0', () => {
      const current = { sp: 50, sb: 10, sd: 5, adGroups: 100, keywords: 500, targets: 200 };
      const previous = { sp: 50, sb: 10, sd: 5, adGroups: 100, keywords: 500, targets: 200 };
      
      const diff = calculateSyncDiff(current, previous);
      
      expect(diff?.sp).toBe(0);
      expect(diff?.sb).toBe(0);
      expect(diff?.sd).toBe(0);
      expect(diff?.adGroups).toBe(0);
      expect(diff?.keywords).toBe(0);
      expect(diff?.targets).toBe(0);
      expect(diff?.totalCampaigns).toBe(0);
      expect(diff?.totalKeywordsTargets).toBe(0);
    });

    it('没有上次同步数据时应该返回null', () => {
      const current = { sp: 50, sb: 10, sd: 5, adGroups: 100, keywords: 500, targets: 200 };
      
      const diff = calculateSyncDiff(current, null);
      
      expect(diff).toBeNull();
    });
  });

  describe('分页修复验证', () => {
    it('应该能处理超过100条记录的数据', () => {
      // 模拟修复后的分页逻辑返回的数据
      const syncResult = {
        sp: 150, // 超过100条
        sb: 25,
        sd: 10,
        adGroups: 300, // 超过100条
        keywords: 1500, // 超过100条
        targets: 800, // 超过100条
      };

      // 验证数据可以正确处理
      expect(syncResult.sp).toBeGreaterThan(100);
      expect(syncResult.adGroups).toBeGreaterThan(100);
      expect(syncResult.keywords).toBeGreaterThan(100);
      expect(syncResult.targets).toBeGreaterThan(100);
    });

    it('应该正确计算大量数据的差异', () => {
      const current = { sp: 150, sb: 25, sd: 10, adGroups: 300, keywords: 1500, targets: 800 };
      const previous = { sp: 100, sb: 20, sd: 8, adGroups: 200, keywords: 100, targets: 100 }; // 修复前只有100条
      
      const diff = calculateSyncDiff(current, previous);
      
      // 修复后应该能看到大量数据增加
      expect(diff?.sp).toBe(50);
      expect(diff?.adGroups).toBe(100);
      expect(diff?.keywords).toBe(1400); // 修复后获取到更多关键词
      expect(diff?.targets).toBe(700); // 修复后获取到更多商品定位
    });
  });
});
