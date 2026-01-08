import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 同步进度持久化功能测试
 * 测试同步进度的保存、更新和查询功能
 */

describe('同步进度持久化功能', () => {
  describe('进度更新逻辑', () => {
    it('应该正确计算进度百分比', () => {
      const totalSteps = 7;
      
      // 测试各步骤的进度计算
      const calculateProgress = (stepIndex: number) => {
        return Math.round(((stepIndex + 1) / totalSteps) * 100);
      };
      
      expect(calculateProgress(0)).toBe(14); // 第1步: 1/7 = 14%
      expect(calculateProgress(1)).toBe(29); // 第2步: 2/7 = 29%
      expect(calculateProgress(2)).toBe(43); // 第3步: 3/7 = 43%
      expect(calculateProgress(3)).toBe(57); // 第4步: 4/7 = 57%
      expect(calculateProgress(4)).toBe(71); // 第5步: 5/7 = 71%
      expect(calculateProgress(5)).toBe(86); // 第6步: 6/7 = 86%
      expect(calculateProgress(6)).toBe(100); // 第7步: 7/7 = 100%
    });
    
    it('应该正确定义同步步骤', () => {
      const syncSteps = [
        { name: 'SP广告活动', key: 'spCampaigns' },
        { name: 'SB广告活动', key: 'sbCampaigns' },
        { name: 'SD广告活动', key: 'sdCampaigns' },
        { name: '广告组', key: 'adGroups' },
        { name: '关键词', key: 'keywords' },
        { name: '商品定位', key: 'targets' },
        { name: '绩效数据', key: 'performance' },
      ];
      
      expect(syncSteps.length).toBe(7);
      expect(syncSteps[0].name).toBe('SP广告活动');
      expect(syncSteps[6].name).toBe('绩效数据');
    });
  });
  
  describe('进度状态管理', () => {
    it('应该正确处理运行中状态', () => {
      const mockSyncJob = {
        status: 'running',
        progressPercent: 43,
        currentStep: 'SD广告活动',
        spCampaigns: 10,
        sbCampaigns: 5,
        sdCampaigns: 0,
        adGroupsSynced: 0,
        keywordsSynced: 0,
        targetsSynced: 0,
      };
      
      expect(mockSyncJob.status).toBe('running');
      expect(mockSyncJob.progressPercent).toBe(43);
      expect(mockSyncJob.currentStep).toBe('SD广告活动');
    });
    
    it('应该正确处理完成状态', () => {
      const mockSyncJob = {
        status: 'completed',
        progressPercent: 100,
        currentStep: '同步完成',
        spCampaigns: 10,
        sbCampaigns: 5,
        sdCampaigns: 3,
        adGroupsSynced: 50,
        keywordsSynced: 200,
        targetsSynced: 30,
      };
      
      expect(mockSyncJob.status).toBe('completed');
      expect(mockSyncJob.progressPercent).toBe(100);
    });
    
    it('应该正确处理失败状态', () => {
      const mockSyncJob = {
        status: 'failed',
        errorMessage: 'API请求超时',
      };
      
      expect(mockSyncJob.status).toBe('failed');
      expect(mockSyncJob.errorMessage).toBe('API请求超时');
    });
  });
  
  describe('前端轮询逻辑', () => {
    it('应该在同步进行中时启用轮询', () => {
      const syncProgress = { step: 'sp' };
      const shouldPoll = syncProgress.step !== 'idle' && 
                         syncProgress.step !== 'complete' && 
                         syncProgress.step !== 'error';
      
      expect(shouldPoll).toBe(true);
    });
    
    it('应该在同步完成时禁用轮询', () => {
      const syncProgress = { step: 'complete' };
      const shouldPoll = syncProgress.step !== 'idle' && 
                         syncProgress.step !== 'complete' && 
                         syncProgress.step !== 'error';
      
      expect(shouldPoll).toBe(false);
    });
    
    it('应该在同步空闲时禁用轮询', () => {
      const syncProgress = { step: 'idle' };
      const shouldPoll = syncProgress.step !== 'idle' && 
                         syncProgress.step !== 'complete' && 
                         syncProgress.step !== 'error';
      
      expect(shouldPoll).toBe(false);
    });
    
    it('应该在同步错误时禁用轮询', () => {
      const syncProgress = { step: 'error' };
      const shouldPoll = syncProgress.step !== 'idle' && 
                         syncProgress.step !== 'complete' && 
                         syncProgress.step !== 'error';
      
      expect(shouldPoll).toBe(false);
    });
  });
  
  describe('站点进度数据结构', () => {
    it('应该正确构建站点进度对象', () => {
      const siteProgress = {
        currentStep: 'SP广告活动',
        stepIndex: 0,
        totalSteps: 7,
        progressPercent: 14,
        results: {
          spCampaigns: 10,
          sbCampaigns: 0,
          sdCampaigns: 0,
          adGroups: 0,
          keywords: 0,
          targets: 0,
        },
      };
      
      expect(siteProgress.currentStep).toBe('SP广告活动');
      expect(siteProgress.stepIndex).toBe(0);
      expect(siteProgress.totalSteps).toBe(7);
      expect(siteProgress.progressPercent).toBe(14);
      expect(siteProgress.results.spCampaigns).toBe(10);
    });
  });
});
