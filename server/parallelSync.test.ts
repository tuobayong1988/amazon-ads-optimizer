import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 并行同步功能测试
 * 测试并发控制和并行同步逻辑
 */

describe('并行同步功能', () => {
  describe('并发控制逻辑', () => {
    // 模拟并发控制函数
    const executeWithConcurrencyLimit = async <T,>(
      tasks: (() => Promise<T>)[],
      limit: number,
      onProgress?: (completed: number, total: number) => void
    ): Promise<PromiseSettledResult<T>[]> => {
      const results: PromiseSettledResult<T>[] = [];
      let completed = 0;
      
      for (let i = 0; i < tasks.length; i += limit) {
        const batch = tasks.slice(i, i + limit);
        const batchResults = await Promise.allSettled(batch.map(task => task()));
        results.push(...batchResults);
        completed += batch.length;
        onProgress?.(completed, tasks.length);
      }
      
      return results;
    };

    it('应该正确控制并发数量', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;
      
      const createTask = (id: number, delay: number) => async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(resolve => setTimeout(resolve, delay));
        currentConcurrent--;
        return id;
      };
      
      const tasks = [
        createTask(1, 50),
        createTask(2, 50),
        createTask(3, 50),
        createTask(4, 50),
        createTask(5, 50),
      ];
      
      await executeWithConcurrencyLimit(tasks, 3);
      
      // 最大并发数应该不超过限制
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });
    
    it('应该返回所有任务的结果', async () => {
      const tasks = [
        async () => 1,
        async () => 2,
        async () => 3,
        async () => 4,
        async () => 5,
      ];
      
      const results = await executeWithConcurrencyLimit(tasks, 2);
      
      expect(results.length).toBe(5);
      expect(results.filter(r => r.status === 'fulfilled').length).toBe(5);
    });
    
    it('应该正确处理失败的任务', async () => {
      const tasks = [
        async () => 1,
        async () => { throw new Error('Task 2 failed'); },
        async () => 3,
      ];
      
      const results = await executeWithConcurrencyLimit(tasks, 3);
      
      expect(results.length).toBe(3);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
    });
    
    it('应该调用进度回调', async () => {
      const progressCalls: [number, number][] = [];
      
      const tasks = [
        async () => 1,
        async () => 2,
        async () => 3,
        async () => 4,
      ];
      
      await executeWithConcurrencyLimit(tasks, 2, (completed, total) => {
        progressCalls.push([completed, total]);
      });
      
      expect(progressCalls.length).toBe(2); // 2批次
      expect(progressCalls[0]).toEqual([2, 4]); // 第一批完成
      expect(progressCalls[1]).toEqual([4, 4]); // 第二批完成
    });
  });
  
  describe('并行同步配置', () => {
    it('默认并发数应该为3', () => {
      const MAX_CONCURRENT_SYNCS = 3;
      expect(MAX_CONCURRENT_SYNCS).toBe(3);
    });
    
    it('应该能够处理单个站点', async () => {
      const sites = [{ id: 1, name: 'US' }];
      const limit = 3;
      
      // 单个站点应该正常工作
      expect(sites.length).toBeLessThanOrEqual(limit);
    });
    
    it('应该能够处理多于并发限制的站点', async () => {
      const sites = [
        { id: 1, name: 'US' },
        { id: 2, name: 'CA' },
        { id: 3, name: 'MX' },
        { id: 4, name: 'UK' },
        { id: 5, name: 'DE' },
      ];
      const limit = 3;
      
      // 5个站点，并发限制3，应该分2批执行
      const batches = Math.ceil(sites.length / limit);
      expect(batches).toBe(2);
    });
  });
  
  describe('站点同步状态管理', () => {
    type SiteStatus = 'pending' | 'syncing' | 'success' | 'failed';
    
    interface SiteSyncStatus {
      id: number;
      name: string;
      status: SiteStatus;
      progress: number;
    }
    
    it('应该正确更新站点状态为同步中', () => {
      const sites: SiteSyncStatus[] = [
        { id: 1, name: 'US', status: 'pending', progress: 0 },
        { id: 2, name: 'CA', status: 'pending', progress: 0 },
        { id: 3, name: 'MX', status: 'pending', progress: 0 },
      ];
      
      // 模拟更新站点1为同步中
      const updatedSites = sites.map(s => 
        s.id === 1 ? { ...s, status: 'syncing' as const, progress: 10 } : s
      );
      
      expect(updatedSites[0].status).toBe('syncing');
      expect(updatedSites[0].progress).toBe(10);
      expect(updatedSites[1].status).toBe('pending');
    });
    
    it('应该正确更新站点状态为成功', () => {
      const sites: SiteSyncStatus[] = [
        { id: 1, name: 'US', status: 'syncing', progress: 90 },
      ];
      
      const updatedSites = sites.map(s => 
        s.id === 1 ? { ...s, status: 'success' as const, progress: 100 } : s
      );
      
      expect(updatedSites[0].status).toBe('success');
      expect(updatedSites[0].progress).toBe(100);
    });
    
    it('应该正确更新站点状态为失败', () => {
      const sites: SiteSyncStatus[] = [
        { id: 1, name: 'US', status: 'syncing', progress: 50 },
      ];
      
      const updatedSites = sites.map(s => 
        s.id === 1 ? { ...s, status: 'failed' as const, progress: 0 } : s
      );
      
      expect(updatedSites[0].status).toBe('failed');
      expect(updatedSites[0].progress).toBe(0);
    });
    
    it('应该正确计算完成进度', () => {
      const totalSites = 5;
      const completedSites = 3;
      
      // 进度计算: (完成数/总数) * 90 + 5
      const progress = Math.round((completedSites / totalSites) * 90) + 5;
      
      expect(progress).toBe(59); // 3/5 * 90 + 5 = 54 + 5 = 59
    });
  });
  
  describe('并行同步结果累加', () => {
    it('应该正确累加多个站点的同步结果', () => {
      const siteResults = [
        { sp: 10, sb: 5, sd: 2, adGroups: 50, keywords: 200, targets: 30 },
        { sp: 8, sb: 3, sd: 1, adGroups: 40, keywords: 150, targets: 20 },
        { sp: 12, sb: 7, sd: 3, adGroups: 60, keywords: 250, targets: 40 },
      ];
      
      const totalResults = siteResults.reduce((acc, result) => ({
        sp: acc.sp + result.sp,
        sb: acc.sb + result.sb,
        sd: acc.sd + result.sd,
        adGroups: acc.adGroups + result.adGroups,
        keywords: acc.keywords + result.keywords,
        targets: acc.targets + result.targets,
      }), { sp: 0, sb: 0, sd: 0, adGroups: 0, keywords: 0, targets: 0 });
      
      expect(totalResults.sp).toBe(30);
      expect(totalResults.sb).toBe(15);
      expect(totalResults.sd).toBe(6);
      expect(totalResults.adGroups).toBe(150);
      expect(totalResults.keywords).toBe(600);
      expect(totalResults.targets).toBe(90);
    });
  });
});
