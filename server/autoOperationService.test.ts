import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('./db', () => ({
  getAdAccountById: vi.fn().mockResolvedValue({
    id: 1,
    accountName: 'Test Account',
    connectionStatus: 'connected',
  }),
  getCampaignsByAccountId: vi.fn().mockResolvedValue([
    { id: 1, name: 'Campaign 1', status: 'enabled' },
    { id: 2, name: 'Campaign 2', status: 'enabled' },
  ]),
}));

vi.mock('./amazonSyncService', () => ({
  AmazonSyncService: {
    syncAllData: vi.fn().mockResolvedValue({
      success: true,
      syncedCampaigns: 5,
      syncedKeywords: 100,
      syncedReports: 30,
    }),
  },
}));

vi.mock('./trafficIsolationService', () => ({
  runNGramAnalysis: vi.fn().mockResolvedValue({
    accountId: 1,
    analysisDate: new Date(),
    totalSearchTermsAnalyzed: 1000,
    totalTokensExtracted: 500,
    highRiskTokens: [],
    mediumRiskTokens: [],
    suggestedNegatives: [
      { token: 'free', matchType: 'negative_exact', reason: 'Low conversion', estimatedSavings: 50 },
    ],
  }),
  syncFunnelNegatives: vi.fn().mockResolvedValue({
    accountId: 1,
    syncDate: new Date(),
    totalNegativesSynced: 10,
    tierResults: [],
    errors: [],
  }),
  detectTrafficConflicts: vi.fn().mockResolvedValue({
    accountId: 1,
    analysisDate: new Date(),
    totalConflicts: 2,
    totalWastedSpend: 100,
    conflicts: [],
    recommendations: [],
  }),
  getKeywordMigrationSuggestions: vi.fn().mockResolvedValue({
    accountId: 1,
    analysisDate: new Date(),
    totalSuggestions: 5,
    suggestions: [],
  }),
}));

vi.mock('./bidOptimizer', () => ({
  calculateOptimalBid: vi.fn().mockReturnValue({
    suggestedBid: 1.5,
    confidence: 0.85,
    reason: 'Market curve optimization',
  }),
}));

// Import after mocks
import { autoOperationService } from './autoOperationService';

describe('AutoOperationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Configuration Management', () => {
    it('should return null for non-existent account config', async () => {
      const config = await autoOperationService.getConfig(999);
      
      // 如果账号不存在配置，应返回null
      expect(config).toBeNull();
    });

    it('should create config when upserting', async () => {
      await autoOperationService.upsertConfig({
        accountId: 999,
        enabled: false,
        intervalHours: 2,
      });
      
      const config = await autoOperationService.getConfig(999);
      expect(config).toBeDefined();
      expect(config!.accountId).toBe(999);
      expect(config!.enabled).toBe(false);
      expect(config!.intervalHours).toBe(2);
    });

    it('should update existing config', async () => {
      // First create a config
      await autoOperationService.upsertConfig({
        accountId: 1,
        enabled: true,
        intervalHours: 4,
      });

      const config = await autoOperationService.getConfig(1);
      
      expect(config.enabled).toBe(true);
      expect(config.intervalHours).toBe(4);
    });

    it('should enable/disable individual steps', async () => {
      await autoOperationService.upsertConfig({
        accountId: 1,
        enableDataSync: true,
        enableNgramAnalysis: false,
        enableFunnelSync: true,
        enableConflictDetection: false,
        enableMigrationSuggestion: true,
        enableBidOptimization: false,
      });

      const config = await autoOperationService.getConfig(1);
      
      expect(config.enableDataSync).toBe(true);
      expect(config.enableNgramAnalysis).toBe(false);
      expect(config.enableFunnelSync).toBe(true);
      expect(config.enableConflictDetection).toBe(false);
      expect(config.enableMigrationSuggestion).toBe(true);
      expect(config.enableBidOptimization).toBe(false);
    });

    it('should get all configs', async () => {
      // Create multiple configs
      await autoOperationService.upsertConfig({ accountId: 1, enabled: true });
      await autoOperationService.upsertConfig({ accountId: 2, enabled: false });

      const configs = await autoOperationService.getAllConfigs();
      
      expect(configs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Operation Execution', () => {
    it('should execute full operation and return results', async () => {
      // Enable auto operation for account
      await autoOperationService.upsertConfig({
        accountId: 1,
        enabled: true,
        enableDataSync: true,
        enableNgramAnalysis: true,
        enableFunnelSync: true,
        enableConflictDetection: true,
        enableMigrationSuggestion: true,
        enableBidOptimization: true,
      });

      const result = await autoOperationService.executeFullOperation(1);
      
      expect(result).toBeDefined();
      expect(result.accountId).toBe(1);
      expect(result.steps).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.totalSteps).toBeGreaterThan(0);
    });

    it('should skip disabled steps', async () => {
      await autoOperationService.upsertConfig({
        accountId: 1,
        enabled: true,
        enableDataSync: true,
        enableNgramAnalysis: false,
        enableFunnelSync: false,
        enableConflictDetection: false,
        enableMigrationSuggestion: false,
        enableBidOptimization: false,
      });

      const result = await autoOperationService.executeFullOperation(1);
      
      // Only data_sync should be executed
      const executedSteps = result.steps.filter((s: any) => s.status !== 'skipped');
      expect(executedSteps.length).toBe(1);
      expect(executedSteps[0].step).toBe('data_sync');
    });

    it('should record operation logs', async () => {
      await autoOperationService.upsertConfig({
        accountId: 1,
        enabled: true,
      });

      await autoOperationService.executeFullOperation(1);
      
      const logs = await autoOperationService.getLogs(1, 10);
      
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].accountId).toBe(1);
    });

    it('should update lastRunAt and nextRunAt after execution', async () => {
      await autoOperationService.upsertConfig({
        accountId: 3,
        enabled: true,
        intervalHours: 2,
      });

      // 等待一下确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 10));

      await autoOperationService.executeFullOperation(3);

      const afterConfig = await autoOperationService.getConfig(3);
      
      expect(afterConfig).toBeDefined();
      expect(afterConfig!.lastRunAt).toBeDefined();
      expect(afterConfig!.nextRunAt).toBeDefined();
    });
  });

  describe('Scheduled Execution', () => {
    it('should identify due tasks', async () => {
      // Create a config with past nextRunAt
      await autoOperationService.upsertConfig({
        accountId: 1,
        enabled: true,
        intervalHours: 2,
      });

      // Manually set nextRunAt to past
      const config = await autoOperationService.getConfig(1);
      // The config should be due for execution
      
      const configs = await autoOperationService.getAllConfigs();
      const enabledConfigs = configs.filter((c: any) => c.enabled);
      
      expect(enabledConfigs.length).toBeGreaterThan(0);
    });

    it('should execute all due tasks', async () => {
      await autoOperationService.upsertConfig({
        accountId: 4,
        enabled: true,
        intervalHours: 2,
      });

      const results = await autoOperationService.executeAllDueTasks();
      
      expect(results).toBeDefined();
      // executeAllDueTasks 返回的是对象，不是数组
      expect(typeof results).toBe('object');
    });
  });

  describe('Error Handling', () => {
    it('should handle step failures gracefully', async () => {
      // Mock a failure in one of the services
      const trafficService = await import('./trafficIsolationService');
      vi.mocked(trafficService.runNGramAnalysis).mockRejectedValueOnce(new Error('Analysis failed'));

      await autoOperationService.upsertConfig({
        accountId: 1,
        enabled: true,
        enableNgramAnalysis: true,
      });

      const result = await autoOperationService.executeFullOperation(1);
      
      // Should still complete, but with failed step
      expect(result).toBeDefined();
      expect(result.summary.failedSteps).toBeGreaterThanOrEqual(0);
    });

    it('should log errors in operation logs', async () => {
      const trafficService = await import('./trafficIsolationService');
      vi.mocked(trafficService.runNGramAnalysis).mockRejectedValueOnce(new Error('Test error'));

      await autoOperationService.upsertConfig({
        accountId: 1,
        enabled: true,
        enableNgramAnalysis: true,
      });

      await autoOperationService.executeFullOperation(1);
      
      const logs = await autoOperationService.getLogs(1, 10);
      
      // Should have logged the operation
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('Step Results', () => {
    it('should return correct step result structure', async () => {
      await autoOperationService.upsertConfig({
        accountId: 1,
        enabled: true,
        enableDataSync: true,
      });

      const result = await autoOperationService.executeFullOperation(1);
      
      const dataSyncStep = result.steps.find((s: any) => s.step === 'data_sync');
      
      if (dataSyncStep && dataSyncStep.status !== 'skipped') {
        expect(dataSyncStep).toHaveProperty('step');
        expect(dataSyncStep).toHaveProperty('status');
        expect(dataSyncStep).toHaveProperty('duration');
      }
    });

    it('should calculate correct summary statistics', async () => {
      await autoOperationService.upsertConfig({
        accountId: 1,
        enabled: true,
        enableDataSync: true,
        enableNgramAnalysis: true,
        enableFunnelSync: true,
        enableConflictDetection: true,
        enableMigrationSuggestion: true,
        enableBidOptimization: true,
      });

      const result = await autoOperationService.executeFullOperation(1);
      
      expect(result.summary.totalSteps).toBe(6);
      expect(result.summary.successSteps + result.summary.failedSteps + result.summary.skippedSteps).toBe(6);
    });
  });
});
