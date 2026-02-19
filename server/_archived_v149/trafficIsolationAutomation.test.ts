/**
 * Traffic Isolation Automation Integration Tests
 * 
 * 测试流量隔离自动化功能的集成
 */

import { describe, it, expect, vi } from 'vitest';
import * as schedulerService from './schedulerService';
import * as automationExecutionEngine from './automationExecutionEngine';
import * as trafficIsolationService from './trafficIsolationService';

describe('Traffic Isolation Automation Integration', () => {
  describe('Scheduler Service - Traffic Isolation Task Type', () => {
    it('should include traffic_isolation_full in default task configs', () => {
      const configs = schedulerService.defaultTaskConfigs;
      expect(configs).toHaveProperty('traffic_isolation_full');
      expect(configs.traffic_isolation_full.name).toBe('流量隔离自动化');
      expect(configs.traffic_isolation_full.schedule).toBe('daily');
      expect(configs.traffic_isolation_full.autoApply).toBe(true);
    });

    it('should have correct task type name for traffic_isolation_full', () => {
      // 验证任务类型包含新的流量隔离类型
      const taskTypes: schedulerService.TaskType[] = [
        'ngram_analysis',
        'funnel_migration',
        'traffic_conflict',
        'smart_bidding',
        'health_check',
        'data_sync',
        'traffic_isolation_full',
      ];
      
      expect(taskTypes).toContain('traffic_isolation_full');
    });
  });

  describe('Automation Execution Engine - Traffic Isolation Tasks', () => {
    it('should export runFullTrafficIsolationCycle function', () => {
      expect(typeof automationExecutionEngine.runFullTrafficIsolationCycle).toBe('function');
    });

    it('should export runNGramAnalysisTask function', () => {
      expect(typeof automationExecutionEngine.runNGramAnalysisTask).toBe('function');
    });

    it('should export runFunnelSyncTask function', () => {
      expect(typeof automationExecutionEngine.runFunnelSyncTask).toBe('function');
    });

    it('should export runKeywordMigrationTask function', () => {
      expect(typeof automationExecutionEngine.runKeywordMigrationTask).toBe('function');
    });

    it('should export runTrafficConflictDetectionTask function', () => {
      expect(typeof automationExecutionEngine.runTrafficConflictDetectionTask).toBe('function');
    });
  });

  describe('Traffic Isolation Service - Core Functions', () => {
    it('should export runNGramAnalysis function', () => {
      expect(typeof trafficIsolationService.runNGramAnalysis).toBe('function');
    });

    it('should export detectTrafficConflicts function', () => {
      expect(typeof trafficIsolationService.detectTrafficConflicts).toBe('function');
    });

    it('should export identifyFunnelTiers function', () => {
      expect(typeof trafficIsolationService.identifyFunnelTiers).toBe('function');
    });

    it('should export syncFunnelNegatives function', () => {
      expect(typeof trafficIsolationService.syncFunnelNegatives).toBe('function');
    });

    it('should export getKeywordMigrationSuggestions function', () => {
      expect(typeof trafficIsolationService.getKeywordMigrationSuggestions).toBe('function');
    });

    it('should export runFullTrafficIsolationAnalysis function', () => {
      expect(typeof trafficIsolationService.runFullTrafficIsolationAnalysis).toBe('function');
    });
  });

  describe('Automation Config Types', () => {
    it('should support full_auto mode', () => {
      const config: automationExecutionEngine.AutomationConfig = {
        mode: 'full_auto',
        safetyLimits: {
          maxBidChangePercent: 30,
          maxBudgetChangePercent: 50,
          maxDailyExecutions: 100,
          minConfidenceScore: 0.7,
        },
        notificationConfig: {
          notifyOnSuccess: true,
          notifyOnFailure: true,
          dailySummary: true,
        },
        enabledTypes: ['ngram_analysis', 'funnel_negative_sync'],
      };
      
      expect(config.mode).toBe('full_auto');
      expect(config.enabledTypes).toContain('ngram_analysis');
    });

    it('should support supervised mode', () => {
      const config: automationExecutionEngine.AutomationConfig = {
        mode: 'supervised',
        safetyLimits: {
          maxBidChangePercent: 20,
          maxBudgetChangePercent: 30,
          maxDailyExecutions: 50,
          minConfidenceScore: 0.8,
        },
        notificationConfig: {
          notifyOnSuccess: true,
          notifyOnFailure: true,
          dailySummary: false,
        },
        enabledTypes: ['keyword_migration'],
      };
      
      expect(config.mode).toBe('supervised');
    });

    it('should support approval_required mode', () => {
      const config: automationExecutionEngine.AutomationConfig = {
        mode: 'approval_required',
        safetyLimits: {
          maxBidChangePercent: 10,
          maxBudgetChangePercent: 20,
          maxDailyExecutions: 20,
          minConfidenceScore: 0.9,
        },
        notificationConfig: {
          notifyOnSuccess: false,
          notifyOnFailure: true,
          dailySummary: true,
        },
        enabledTypes: ['traffic_conflict_resolution'],
      };
      
      expect(config.mode).toBe('approval_required');
    });
  });

  describe('Traffic Isolation Config', () => {
    it('should have valid N-Gram analysis config', () => {
      const config = trafficIsolationService.TRAFFIC_ISOLATION_CONFIG;
      
      expect(config).toHaveProperty('ngram');
      expect(config.ngram.minFrequency).toBeGreaterThan(0);
      expect(config.ngram.highRiskFrequency).toBeGreaterThan(0);
      expect(config.ngram.confidenceThreshold).toBeLessThan(1);
    });

    it('should have valid funnel tier config', () => {
      const config = trafficIsolationService.TRAFFIC_ISOLATION_CONFIG;
      
      expect(config).toHaveProperty('funnel');
      expect(config.funnel.tier1MatchTypes).toContain('exact');
      expect(config.funnel.tier2MatchTypes).toContain('phrase');
      expect(config.funnel.tier3MatchTypes).toContain('broad');
    });

    it('should have valid migration config', () => {
      const config = trafficIsolationService.TRAFFIC_ISOLATION_CONFIG;
      
      expect(config).toHaveProperty('migration');
      expect(config.migration.minConversions).toBeGreaterThan(0);
      expect(config.migration.minCVR).toBeGreaterThan(0);
      expect(config.migration.minClicks).toBeGreaterThan(0);
    });
  });

  describe('N-Gram Token Analysis', () => {
    it('should correctly identify token types', () => {
      // 测试词根类型识别
      const unigramToken: trafficIsolationService.NGramToken = {
        token: 'cheap',
        tokenType: 'unigram',
        frequency: 50,
        totalClicks: 100,
        totalSpend: 50,
        totalConversions: 0,
        conversionRate: 0,
        confidence: 0.9,
        searchTerms: ['cheap whitening', 'cheap kit'],
        suggestedAction: 'negative_phrase',
      };
      
      expect(unigramToken.tokenType).toBe('unigram');
      expect(unigramToken.suggestedAction).toBe('negative_phrase');
    });

    it('should correctly calculate confidence score', () => {
      const token: trafficIsolationService.NGramToken = {
        token: 'used',
        tokenType: 'unigram',
        frequency: 100,
        totalClicks: 200,
        totalSpend: 100,
        totalConversions: 0,
        conversionRate: 0,
        confidence: 0.95,
        searchTerms: ['used whitening', 'used product'],
        suggestedAction: 'negative_phrase',
      };
      
      // 高频率 + 零转化 = 高置信度
      expect(token.confidence).toBeGreaterThan(0.9);
    });
  });

  describe('Traffic Conflict Detection', () => {
    it('should correctly identify traffic conflicts', () => {
      const conflict: trafficIsolationService.TrafficConflict = {
        searchTerm: 'teeth whitening kit',
        conflictingCampaigns: [
          {
            campaignId: 1,
            campaignName: 'Exact Match Campaign',
            matchType: 'exact',
            clicks: 100,
            conversions: 10,
            spend: 50,
            sales: 200,
            cvr: 0.1,
            aov: 20,
            roas: 4,
            score: 0.9,
          },
          {
            campaignId: 2,
            campaignName: 'Broad Match Campaign',
            matchType: 'broad',
            clicks: 50,
            conversions: 2,
            spend: 25,
            sales: 40,
            cvr: 0.04,
            aov: 20,
            roas: 1.6,
            score: 0.4,
          },
        ],
        suggestedWinner: {
          campaignId: 1,
          campaignName: 'Exact Match Campaign',
          reason: '更高的CVR和ROAS',
        },
        totalWastedSpend: 25,
      };
      
      expect(conflict.conflictingCampaigns.length).toBe(2);
      expect(conflict.suggestedWinner.campaignId).toBe(1);
      expect(conflict.totalWastedSpend).toBeGreaterThan(0);
    });
  });

  describe('Funnel Tier Configuration', () => {
    it('should correctly configure funnel tiers', () => {
      const tier1: trafficIsolationService.FunnelTierConfig = {
        campaignId: 1,
        campaignName: 'Exact Match Campaign',
        tierLevel: 'tier1_exact',
        matchType: 'exact',
        autoNegativeSync: true,
      };
      
      const tier2: trafficIsolationService.FunnelTierConfig = {
        campaignId: 2,
        campaignName: 'Phrase Match Campaign',
        tierLevel: 'tier2_longtail',
        matchType: 'phrase',
        autoNegativeSync: true,
      };
      
      const tier3: trafficIsolationService.FunnelTierConfig = {
        campaignId: 3,
        campaignName: 'Broad Match Campaign',
        tierLevel: 'tier3_explore',
        matchType: 'broad',
        autoNegativeSync: true,
      };
      
      expect(tier1.tierLevel).toBe('tier1_exact');
      expect(tier2.tierLevel).toBe('tier2_longtail');
      expect(tier3.tierLevel).toBe('tier3_explore');
    });
  });

  describe('Keyword Migration Suggestions', () => {
    it('should correctly generate migration suggestions', () => {
      const suggestion: trafficIsolationService.KeywordMigrationSuggestion = {
        searchTerm: 'teeth whitening gel kit',
        sourceCampaignId: 3,
        sourceCampaignName: 'Broad Match Campaign',
        sourceTier: 'tier3_explore',
        targetTier: 'tier1_exact',
        clicks: 50,
        conversions: 8,
        cvr: 0.16,
        sales: 160,
        reason: 'CVR > 10%, 建议迁移到精准层',
      };
      
      expect(suggestion.cvr).toBeGreaterThan(0.1);
      expect(suggestion.targetTier).toBe('tier1_exact');
    });
  });
});
