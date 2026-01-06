import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as notificationService from './notificationService';
import * as schedulerService from './schedulerService';

describe('Notification Service', () => {
  describe('isQuietHours', () => {
    it('should detect quiet hours spanning midnight', () => {
      const config: notificationService.NotificationConfig = {
        ...notificationService.defaultNotificationConfig,
        quietHoursStart: 22,
        quietHoursEnd: 8,
      };

      // Mock Date to 23:00
      const mockDate = new Date('2024-01-15T23:00:00');
      vi.setSystemTime(mockDate);
      expect(notificationService.isQuietHours(config)).toBe(true);

      // Mock Date to 03:00
      vi.setSystemTime(new Date('2024-01-15T03:00:00'));
      expect(notificationService.isQuietHours(config)).toBe(true);

      // Mock Date to 10:00
      vi.setSystemTime(new Date('2024-01-15T10:00:00'));
      expect(notificationService.isQuietHours(config)).toBe(false);

      vi.useRealTimers();
    });

    it('should detect quiet hours within same day', () => {
      const config: notificationService.NotificationConfig = {
        ...notificationService.defaultNotificationConfig,
        quietHoursStart: 12,
        quietHoursEnd: 14,
      };

      vi.setSystemTime(new Date('2024-01-15T13:00:00'));
      expect(notificationService.isQuietHours(config)).toBe(true);

      vi.setSystemTime(new Date('2024-01-15T15:00:00'));
      expect(notificationService.isQuietHours(config)).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('analyzeHealthMetrics', () => {
    const baseMetrics: notificationService.HealthMetrics = {
      campaignId: 1,
      campaignName: 'Test Campaign',
      currentAcos: 30,
      previousAcos: 25,
      currentCtr: 2.0,
      previousCtr: 2.5,
      currentConversionRate: 10,
      previousConversionRate: 12,
      currentSpend: 100,
      previousSpend: 80,
    };

    it('should generate ACoS spike alert when threshold exceeded', () => {
      const config: notificationService.NotificationConfig = {
        ...notificationService.defaultNotificationConfig,
        acosThreshold: 25,
      };

      const alerts = notificationService.analyzeHealthMetrics(baseMetrics, config);
      const acosAlert = alerts.find(a => a.type === 'acos_spike');
      
      expect(acosAlert).toBeDefined();
      expect(acosAlert?.severity).toBe('warning');
      expect(acosAlert?.currentValue).toBe(30);
    });

    it('should generate CTR drop alert when threshold exceeded', () => {
      const metrics: notificationService.HealthMetrics = {
        ...baseMetrics,
        currentCtr: 1.5,
        previousCtr: 2.5,
      };

      const config: notificationService.NotificationConfig = {
        ...notificationService.defaultNotificationConfig,
        ctrDropThreshold: 30,
      };

      const alerts = notificationService.analyzeHealthMetrics(metrics, config);
      const ctrAlert = alerts.find(a => a.type === 'ctr_drop');
      
      expect(ctrAlert).toBeDefined();
      expect(ctrAlert?.changePercent).toBeLessThan(0);
    });

    it('should generate conversion drop alert when threshold exceeded', () => {
      const metrics: notificationService.HealthMetrics = {
        ...baseMetrics,
        currentConversionRate: 6,
        previousConversionRate: 10,
      };

      const config: notificationService.NotificationConfig = {
        ...notificationService.defaultNotificationConfig,
        conversionDropThreshold: 30,
      };

      const alerts = notificationService.analyzeHealthMetrics(metrics, config);
      const convAlert = alerts.find(a => a.type === 'conversion_drop');
      
      expect(convAlert).toBeDefined();
    });

    it('should generate spend spike alert when threshold exceeded', () => {
      const metrics: notificationService.HealthMetrics = {
        ...baseMetrics,
        currentSpend: 200,
        previousSpend: 100,
      };

      const config: notificationService.NotificationConfig = {
        ...notificationService.defaultNotificationConfig,
        spendSpikeThreshold: 50,
      };

      const alerts = notificationService.analyzeHealthMetrics(metrics, config);
      const spendAlert = alerts.find(a => a.type === 'spend_spike');
      
      expect(spendAlert).toBeDefined();
      expect(spendAlert?.changePercent).toBe(100);
    });

    it('should mark critical alerts when values are significantly above threshold', () => {
      const metrics: notificationService.HealthMetrics = {
        ...baseMetrics,
        currentAcos: 80,
        previousAcos: 25,
      };

      const config: notificationService.NotificationConfig = {
        ...notificationService.defaultNotificationConfig,
        acosThreshold: 40,
      };

      const alerts = notificationService.analyzeHealthMetrics(metrics, config);
      const acosAlert = alerts.find(a => a.type === 'acos_spike');
      
      expect(acosAlert?.severity).toBe('critical');
    });
  });

  describe('generateDailyReportContent', () => {
    it('should generate formatted report content', () => {
      const data: notificationService.DailyReportData = {
        accountName: 'Test Account',
        date: '2024-01-15',
        totalCampaigns: 10,
        activeCampaigns: 8,
        totalSpend: 500,
        totalSales: 2000,
        averageAcos: 25,
        averageRoas: 4,
        topPerformers: [
          { name: 'Campaign A', roas: 6, sales: 600 },
          { name: 'Campaign B', roas: 5, sales: 500 },
        ],
        needsAttention: [
          { name: 'Campaign C', issue: 'ACoS过高' },
        ],
        optimizationsSuggested: 15,
        optimizationsApplied: 10,
      };

      const content = notificationService.generateDailyReportContent(data);
      
      expect(content).toContain('Test Account');
      expect(content).toContain('2024-01-15');
      expect(content).toContain('8/10');
      expect(content).toContain('$500.00');
      expect(content).toContain('Campaign A');
      expect(content).toContain('ACoS过高');
    });
  });
});

describe('Scheduler Service', () => {
  describe('shouldTaskRun', () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    it('should return true for daily task at correct time', () => {
      const config: schedulerService.TaskConfig = {
        taskType: 'ngram_analysis',
        name: 'Test Task',
        enabled: true,
        schedule: 'daily',
        runTime: '06:00',
        autoApply: false,
        requireApproval: true,
      };

      vi.setSystemTime(new Date('2024-01-15T06:02:00'));
      expect(schedulerService.shouldTaskRun(config)).toBe(true);

      vi.setSystemTime(new Date('2024-01-15T07:00:00'));
      expect(schedulerService.shouldTaskRun(config)).toBe(false);

      vi.useRealTimers();
    });

    it('should not run if already ran today', () => {
      const config: schedulerService.TaskConfig = {
        taskType: 'ngram_analysis',
        name: 'Test Task',
        enabled: true,
        schedule: 'daily',
        runTime: '06:00',
        autoApply: false,
        requireApproval: true,
      };

      vi.setSystemTime(new Date('2024-01-15T06:02:00'));
      const lastRunAt = new Date('2024-01-15T06:00:00');
      
      expect(schedulerService.shouldTaskRun(config, lastRunAt)).toBe(false);

      vi.useRealTimers();
    });

    it('should check day of week for weekly tasks', () => {
      const config: schedulerService.TaskConfig = {
        taskType: 'ngram_analysis',
        name: 'Test Task',
        enabled: true,
        schedule: 'weekly',
        runTime: '06:00',
        dayOfWeek: 1, // Monday
        autoApply: false,
        requireApproval: true,
      };

      // Monday - should run
      vi.setSystemTime(new Date('2024-01-15T06:02:00'));
      expect(schedulerService.shouldTaskRun(config)).toBe(true);

      // Monday with lastRunAt set to today - should not run
      const lastRunAt = new Date('2024-01-15T06:00:00');
      expect(schedulerService.shouldTaskRun(config, lastRunAt)).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('calculateNextRunTime', () => {
    it('should calculate next daily run time', () => {
      const config: schedulerService.TaskConfig = {
        taskType: 'ngram_analysis',
        name: 'Test Task',
        enabled: true,
        schedule: 'daily',
        runTime: '06:00',
        autoApply: false,
        requireApproval: true,
      };

      vi.setSystemTime(new Date('2024-01-15T10:00:00'));
      const nextRun = schedulerService.calculateNextRunTime(config);
      
      expect(nextRun.getDate()).toBe(16);
      expect(nextRun.getHours()).toBe(6);
      expect(nextRun.getMinutes()).toBe(0);

      vi.useRealTimers();
    });

    it('should return today if time has not passed', () => {
      const config: schedulerService.TaskConfig = {
        taskType: 'ngram_analysis',
        name: 'Test Task',
        enabled: true,
        schedule: 'daily',
        runTime: '18:00',
        autoApply: false,
        requireApproval: true,
      };

      vi.setSystemTime(new Date('2024-01-15T10:00:00'));
      const nextRun = schedulerService.calculateNextRunTime(config);
      
      expect(nextRun.getDate()).toBe(15);
      expect(nextRun.getHours()).toBe(18);

      vi.useRealTimers();
    });
  });

  describe('executeNgramAnalysis', () => {
    it('should execute N-Gram analysis and return results', async () => {
      const searchTerms = [
        { searchTerm: 'cheap product', clicks: 100, conversions: 0, spend: 50, sales: 0, impressions: 1000 },
        { searchTerm: 'cheap item', clicks: 80, conversions: 0, spend: 40, sales: 0, impressions: 800 },
        { searchTerm: 'quality product', clicks: 50, conversions: 5, spend: 25, sales: 100, impressions: 500 },
      ];

      const result = await schedulerService.executeNgramAnalysis(searchTerms, false);
      
      expect(result.status).toBe('success');
      expect(result.taskType).toBe('ngram_analysis');
      expect(result.itemsProcessed).toBe(3);
      expect(result.suggestionsApplied).toBe(0);
    });
  });

  describe('executeHealthCheck', () => {
    it('should execute health check and return results', async () => {
      const campaigns: notificationService.HealthMetrics[] = [
        {
          campaignId: 1,
          campaignName: 'Campaign A',
          currentAcos: 60,
          previousAcos: 25,
          currentCtr: 2,
          previousCtr: 2.5,
          currentConversionRate: 10,
          previousConversionRate: 12,
          currentSpend: 100,
          previousSpend: 80,
        },
      ];

      const result = await schedulerService.executeHealthCheck(campaigns);
      
      expect(result.status).toBe('success');
      expect(result.taskType).toBe('health_check');
      expect(result.itemsProcessed).toBe(1);
    });
  });

  describe('formatTaskResult', () => {
    it('should format successful task result', () => {
      const result: schedulerService.TaskExecutionResult = {
        taskId: 1,
        taskType: 'ngram_analysis',
        status: 'success',
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 10,
        itemsProcessed: 100,
        suggestionsGenerated: 15,
        suggestionsApplied: 5,
        resultSummary: {},
      };

      const formatted = schedulerService.formatTaskResult(result);
      
      expect(formatted).toContain('✅');
      expect(formatted).toContain('N-Gram词根分析');
      expect(formatted).toContain('执行成功');
      expect(formatted).toContain('100');
      expect(formatted).toContain('15');
    });

    it('should format failed task result', () => {
      const result: schedulerService.TaskExecutionResult = {
        taskId: 1,
        taskType: 'health_check',
        status: 'failed',
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 5,
        itemsProcessed: 0,
        suggestionsGenerated: 0,
        suggestionsApplied: 0,
        errorMessage: 'Connection timeout',
        resultSummary: {},
      };

      const formatted = schedulerService.formatTaskResult(result);
      
      expect(formatted).toContain('❌');
      expect(formatted).toContain('执行失败');
      expect(formatted).toContain('Connection timeout');
    });
  });

  describe('defaultTaskConfigs', () => {
    it('should have all task types configured', () => {
      const taskTypes: schedulerService.TaskType[] = [
        'ngram_analysis',
        'funnel_migration',
        'traffic_conflict',
        'smart_bidding',
        'health_check',
        'data_sync',
      ];

      taskTypes.forEach(type => {
        expect(schedulerService.defaultTaskConfigs[type]).toBeDefined();
        expect(schedulerService.defaultTaskConfigs[type].name).toBeTruthy();
      });
    });
  });
});
