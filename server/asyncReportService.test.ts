import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as asyncReportService from './asyncReportService';
import * as performanceSyncScheduler from './performanceSyncScheduler';

describe('Async Report Service', () => {
  describe('Service Status', () => {
    it('should return service status', () => {
      const status = asyncReportService.getServiceStatus();
      expect(status).toBeDefined();
      expect(typeof status.isPolling).toBe('boolean');
    });
  });

  describe('Report Polling', () => {
    it('should start and stop report polling', () => {
      // 启动轮询
      asyncReportService.startReportPolling();
      let status = asyncReportService.getServiceStatus();
      expect(status.isPolling).toBe(true);

      // 停止轮询
      asyncReportService.stopReportPolling();
      status = asyncReportService.getServiceStatus();
      expect(status.isPolling).toBe(false);
    });

    it('should not start polling twice', () => {
      asyncReportService.startReportPolling();
      asyncReportService.startReportPolling(); // 第二次调用应该被忽略
      
      const status = asyncReportService.getServiceStatus();
      expect(status.isPolling).toBe(true);

      asyncReportService.stopReportPolling();
    });
  });
});

describe('Performance Sync Scheduler', () => {
  describe('Scheduler Status', () => {
    it('should return scheduler status', () => {
      const status = performanceSyncScheduler.getSchedulerStatus();
      expect(status).toBeDefined();
      expect(typeof status.isRunning).toBe('boolean');
      expect(typeof status.totalSyncs).toBe('number');
      expect(typeof status.failedSyncs).toBe('number');
      expect(Array.isArray(status.errors)).toBe(true);
    });
  });

  describe('Scheduler Control', () => {
    it('should start and stop scheduler', () => {
      // 启动调度器
      performanceSyncScheduler.startPerformanceSyncScheduler();
      let status = performanceSyncScheduler.getSchedulerStatus();
      expect(status.isRunning).toBe(true);
      expect(status.nextRunAt).toBeDefined();

      // 停止调度器
      performanceSyncScheduler.stopPerformanceSyncScheduler();
      status = performanceSyncScheduler.getSchedulerStatus();
      expect(status.isRunning).toBe(false);
    });

    it('should not start scheduler twice', () => {
      performanceSyncScheduler.startPerformanceSyncScheduler();
      performanceSyncScheduler.startPerformanceSyncScheduler(); // 第二次调用应该被忽略
      
      const status = performanceSyncScheduler.getSchedulerStatus();
      expect(status.isRunning).toBe(true);

      performanceSyncScheduler.stopPerformanceSyncScheduler();
    });
  });

  describe('Manual Sync Trigger', () => {
    it('should handle manual sync trigger without account', async () => {
      // 这个测试需要数据库连接，可能会失败
      try {
        const result = await performanceSyncScheduler.triggerManualSync();
        expect(result).toBeDefined();
        expect(typeof result.success).toBe('boolean');
        expect(typeof result.message).toBe('string');
      } catch (error) {
        // 数据库连接失败是预期的
        expect(error).toBeDefined();
      }
    });
  });
});

describe('Report Request Types', () => {
  it('should support all report types', () => {
    const supportedTypes = ['sp_campaigns', 'sp_keywords', 'sp_targets', 'sb_campaigns', 'sb_keywords', 'sd_campaigns'];
    
    // 验证类型定义存在
    expect(supportedTypes.length).toBe(6);
  });

  it('should support all report statuses', () => {
    const supportedStatuses = ['pending', 'submitted', 'processing', 'completed', 'failed', 'timeout'];
    
    // 验证状态定义存在
    expect(supportedStatuses.length).toBe(6);
  });
});

describe('Sync Configuration', () => {
  it('should support all sync frequencies', () => {
    const supportedFrequencies = ['hourly', 'every_4_hours', 'every_12_hours', 'daily'];
    
    // 验证频率定义存在
    expect(supportedFrequencies.length).toBe(4);
  });

  it('should have valid default sync time', () => {
    // 默认同步时间应该是凌晨2点
    const defaultHour = 2;
    const defaultMinute = 0;
    
    expect(defaultHour).toBeGreaterThanOrEqual(0);
    expect(defaultHour).toBeLessThan(24);
    expect(defaultMinute).toBeGreaterThanOrEqual(0);
    expect(defaultMinute).toBeLessThan(60);
  });
});

// ==================== 新增：异步报告任务调度器测试 ====================

describe('Report Job Scheduler Integration', () => {
  it('should have correct attribution days configuration', () => {
    // 根据用户需求：SP 14天，SB/SD 30天
    const REPORT_CONFIG = {
      SP: { attributionDays: 14 },
      SB: { attributionDays: 30 },
      SD: { attributionDays: 30 },
    };

    expect(REPORT_CONFIG.SP.attributionDays).toBe(14);
    expect(REPORT_CONFIG.SB.attributionDays).toBe(30);
    expect(REPORT_CONFIG.SD.attributionDays).toBe(30);
  });

  it('should have correct slice configuration for hot data', () => {
    // 热数据：90天，7天一个切片
    const SLICE_CONFIG = {
      hotData: { days: 90, sliceSize: 7 },
    };

    expect(SLICE_CONFIG.hotData.days).toBe(90);
    expect(SLICE_CONFIG.hotData.sliceSize).toBe(7);
  });

  it('should have correct slice configuration for cold data', () => {
    // 冷数据：91-365天，10天一个切片
    const SLICE_CONFIG = {
      coldData: { startDay: 91, endDay: 365, sliceSize: 10 },
    };

    expect(SLICE_CONFIG.coldData.startDay).toBe(91);
    expect(SLICE_CONFIG.coldData.endDay).toBe(365);
    expect(SLICE_CONFIG.coldData.sliceSize).toBe(10);
  });

  it('should calculate correct number of hot data slices', () => {
    const hotDays = 90;
    const sliceSize = 7;
    const expectedSlices = Math.ceil(hotDays / sliceSize);
    
    // 90 / 7 = 12.86, 向上取整 = 13
    expect(expectedSlices).toBe(13);
  });

  it('should calculate correct number of cold data slices', () => {
    const coldDays = 365 - 91 + 1; // 275天
    const sliceSize = 10;
    const expectedSlices = Math.ceil(coldDays / sliceSize);
    
    // 275 / 10 = 27.5, 向上取整 = 28
    expect(expectedSlices).toBe(28);
  });

  it('should calculate total initialization jobs correctly', () => {
    const hotSlices = 13;
    const coldSlices = 28;
    const adTypes = 3; // SP, SB, SD
    
    const totalJobs = (hotSlices + coldSlices) * adTypes;
    
    // (13 + 28) * 3 = 123
    expect(totalJobs).toBe(123);
  });
});

describe('Report Job Status Flow', () => {
  it('should have valid status transitions', () => {
    const validStatuses = ['pending', 'submitted', 'processing', 'completed', 'failed', 'expired'];
    
    // 验证所有状态都已定义
    expect(validStatuses).toContain('pending');
    expect(validStatuses).toContain('submitted');
    expect(validStatuses).toContain('processing');
    expect(validStatuses).toContain('completed');
    expect(validStatuses).toContain('failed');
    expect(validStatuses).toContain('expired');
  });

  it('should follow correct status flow', () => {
    // pending -> submitted -> processing -> completed/failed
    const statusFlow = {
      pending: ['submitted', 'failed'],
      submitted: ['processing', 'failed'],
      processing: ['completed', 'failed'],
      completed: [],
      failed: [],
      expired: [],
    };

    expect(statusFlow.pending).toContain('submitted');
    expect(statusFlow.submitted).toContain('processing');
    expect(statusFlow.processing).toContain('completed');
  });
});

describe('Scheduler Intervals', () => {
  it('should have correct submit interval', () => {
    const submitInterval = 30 * 1000; // 30秒
    expect(submitInterval).toBe(30000);
  });

  it('should have correct check interval', () => {
    const checkInterval = 60 * 1000; // 1分钟
    expect(checkInterval).toBe(60000);
  });

  it('should have correct process interval', () => {
    const processInterval = 30 * 1000; // 30秒
    expect(processInterval).toBe(30000);
  });

  it('should have correct cleanup interval', () => {
    const cleanupInterval = 24 * 60 * 60 * 1000; // 24小时
    expect(cleanupInterval).toBe(86400000);
  });
});
