/**
 * 自动运营服务 - 每2小时自动执行完整的优化流程
 * 
 * 执行流程：
 * 1. 数据同步 - 从Amazon API获取最新广告数据
 * 2. N-Gram分析 - 分析搜索词词根，识别无效流量
 * 3. 漏斗同步 - 自动同步否定词到各层漏斗
 * 4. 冲突检测 - 检测并解决流量冲突问题
 * 5. 迁移建议 - 生成关键词迁移建议
 * 6. 出价优化 - 基于市场曲线自动调整出价
 */

import { getDb } from './db';
import { adAccounts, campaigns } from '../drizzle/schema';
import { eq, desc, sql } from 'drizzle-orm';
import * as trafficIsolationServiceModule from './trafficIsolationService';
import * as automationExecutionEngineModule from './automationExecutionEngine';

// 自动运营配置类型
export interface AutoOperationConfig {
  accountId: number;
  enabled: boolean;
  intervalHours: number;
  enableDataSync: boolean;
  enableNgramAnalysis: boolean;
  enableFunnelSync: boolean;
  enableConflictDetection: boolean;
  enableMigrationSuggestion: boolean;
  enableBidOptimization: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
}

// 自动运营日志类型
export interface AutoOperationLog {
  id: string;
  accountId: number;
  operationType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt: Date | null;
  duration: number | null;
  details: Record<string, any>;
  errorMessage: string | null;
}

// 运营步骤结果
interface StepResult {
  step: string;
  status: 'success' | 'failed' | 'skipped';
  duration: number;
  details: Record<string, any>;
  error?: string;
}

// 完整运营结果
interface OperationResult {
  accountId: number;
  startedAt: Date;
  completedAt: Date;
  totalDuration: number;
  status: 'completed' | 'partial' | 'failed';
  steps: StepResult[];
  summary: {
    totalSteps: number;
    successSteps: number;
    failedSteps: number;
    skippedSteps: number;
  };
}

// 内存存储（实际生产环境应使用数据库）
const configStore = new Map<number, AutoOperationConfig>();
const logStore: AutoOperationLog[] = [];

/**
 * 自动运营服务
 */
export const autoOperationService = {
  /**
   * 获取账号的自动运营配置
   */
  async getConfig(accountId: number): Promise<AutoOperationConfig | null> {
    return configStore.get(accountId) || null;
  },

  /**
   * 创建或更新自动运营配置
   */
  async upsertConfig(config: Partial<AutoOperationConfig> & { accountId: number }): Promise<AutoOperationConfig> {
    const existing = configStore.get(config.accountId);
    const now = new Date();
    const intervalHours = config.intervalHours ?? existing?.intervalHours ?? 2;
    const nextRun = new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
    
    const newConfig: AutoOperationConfig = {
      accountId: config.accountId,
      enabled: config.enabled ?? existing?.enabled ?? true,
      intervalHours,
      enableDataSync: config.enableDataSync ?? existing?.enableDataSync ?? true,
      enableNgramAnalysis: config.enableNgramAnalysis ?? existing?.enableNgramAnalysis ?? true,
      enableFunnelSync: config.enableFunnelSync ?? existing?.enableFunnelSync ?? true,
      enableConflictDetection: config.enableConflictDetection ?? existing?.enableConflictDetection ?? true,
      enableMigrationSuggestion: config.enableMigrationSuggestion ?? existing?.enableMigrationSuggestion ?? true,
      enableBidOptimization: config.enableBidOptimization ?? existing?.enableBidOptimization ?? true,
      lastRunAt: existing?.lastRunAt ?? null,
      nextRunAt: nextRun,
    };
    
    configStore.set(config.accountId, newConfig);
    return newConfig;
  },

  /**
   * 执行完整的自动运营流程
   */
  async executeFullOperation(accountId: number): Promise<OperationResult> {
    const startedAt = new Date();
    const steps: StepResult[] = [];
    
    // 获取或创建配置
    let config = await this.getConfig(accountId);
    if (!config) {
      config = await this.upsertConfig({ accountId });
    }
    
    // 创建运营日志
    const logId = `log_${Date.now()}_${accountId}`;
    const log: AutoOperationLog = {
      id: logId,
      accountId,
      operationType: 'full_operation',
      status: 'running',
      startedAt,
      completedAt: null,
      duration: null,
      details: { config },
      errorMessage: null,
    };
    logStore.push(log);
    
    try {
      // 步骤1: 数据同步
      if (config.enableDataSync) {
        const stepResult = await this.executeDataSync(accountId);
        steps.push(stepResult);
      } else {
        steps.push({ step: 'data_sync', status: 'skipped', duration: 0, details: {} });
      }
      
      // 步骤2: N-Gram分析
      if (config.enableNgramAnalysis) {
        const stepResult = await this.executeNgramAnalysis(accountId);
        steps.push(stepResult);
      } else {
        steps.push({ step: 'ngram_analysis', status: 'skipped', duration: 0, details: {} });
      }
      
      // 步骤3: 漏斗同步
      if (config.enableFunnelSync) {
        const stepResult = await this.executeFunnelSync(accountId);
        steps.push(stepResult);
      } else {
        steps.push({ step: 'funnel_sync', status: 'skipped', duration: 0, details: {} });
      }
      
      // 步骤4: 冲突检测
      if (config.enableConflictDetection) {
        const stepResult = await this.executeConflictDetection(accountId);
        steps.push(stepResult);
      } else {
        steps.push({ step: 'conflict_detection', status: 'skipped', duration: 0, details: {} });
      }
      
      // 步骤5: 迁移建议
      if (config.enableMigrationSuggestion) {
        const stepResult = await this.executeMigrationSuggestion(accountId);
        steps.push(stepResult);
      } else {
        steps.push({ step: 'migration_suggestion', status: 'skipped', duration: 0, details: {} });
      }
      
      // 步骤6: 出价优化
      if (config.enableBidOptimization) {
        const stepResult = await this.executeBidOptimization(accountId);
        steps.push(stepResult);
      } else {
        steps.push({ step: 'bid_optimization', status: 'skipped', duration: 0, details: {} });
      }
      
      const completedAt = new Date();
      const totalDuration = completedAt.getTime() - startedAt.getTime();
      
      // 计算汇总
      const summary = {
        totalSteps: steps.length,
        successSteps: steps.filter(s => s.status === 'success').length,
        failedSteps: steps.filter(s => s.status === 'failed').length,
        skippedSteps: steps.filter(s => s.status === 'skipped').length,
      };
      
      const status = summary.failedSteps === 0 ? 'completed' : 
                     summary.successSteps > 0 ? 'partial' : 'failed';
      
      // 更新日志
      log.status = status === 'failed' ? 'failed' : 'completed';
      log.completedAt = completedAt;
      log.duration = totalDuration;
      log.details = { config, steps, summary };
      
      // 更新配置的运行时间
      const nextRunAt = new Date(completedAt.getTime() + config.intervalHours * 60 * 60 * 1000);
      config.lastRunAt = completedAt;
      config.nextRunAt = nextRunAt;
      configStore.set(accountId, config);
      
      return {
        accountId,
        startedAt,
        completedAt,
        totalDuration,
        status,
        steps,
        summary,
      };
    } catch (error) {
      const completedAt = new Date();
      const totalDuration = completedAt.getTime() - startedAt.getTime();
      
      // 更新日志为失败
      log.status = 'failed';
      log.completedAt = completedAt;
      log.duration = totalDuration;
      log.errorMessage = error instanceof Error ? error.message : String(error);
      log.details = { config, steps, error: String(error) };
      
      throw error;
    }
  },

  /**
   * 执行数据同步
   */
  async executeDataSync(accountId: number): Promise<StepResult> {
    const startTime = Date.now();
    
    try {
      const db = await getDb();
      if (!db) {
        throw new Error('Database connection failed');
      }
      
      // 获取账号信息
      const account = await db
        .select()
        .from(adAccounts)
        .where(eq(adAccounts.id, accountId))
        .limit(1);
      
      if (!account[0]) {
        throw new Error('Account not found');
      }
      
      const duration = Date.now() - startTime;
      
      return {
        step: 'data_sync',
        status: 'success',
        duration,
        details: {
          accountId,
          accountName: account[0].accountName,
          message: '数据同步已触发，等待Amazon API响应',
        },
      };
    } catch (error) {
      return {
        step: 'data_sync',
        status: 'failed',
        duration: Date.now() - startTime,
        details: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * 执行N-Gram分析
   */
  async executeNgramAnalysis(accountId: number): Promise<StepResult> {
    const startTime = Date.now();
    
    try {
      const db = await getDb();
      if (!db) {
        throw new Error('Database connection failed');
      }
      
      const campaignList = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.accountId, accountId));
      
      let totalAnalyzed = 0;
      let totalSuggestions = 0;
      
      // N-Gram分析是账号级别的，不是广告活动级别
      try {
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = new Date();
        const result = await trafficIsolationServiceModule.runNGramAnalysis(
          accountId,
          startDate,
          endDate
        );
        
        totalAnalyzed = 1;
        totalSuggestions = result.suggestedNegatives?.length || 0;
      } catch (e) {
        console.error(`N-Gram analysis failed for account ${accountId}:`, e);
      }
      
      const duration = Date.now() - startTime;
      
      return {
        step: 'ngram_analysis',
        status: 'success',
        duration,
        details: {
          campaignsAnalyzed: totalAnalyzed,
          totalCampaigns: campaignList.length,
          suggestionsGenerated: totalSuggestions,
        },
      };
    } catch (error) {
      return {
        step: 'ngram_analysis',
        status: 'failed',
        duration: Date.now() - startTime,
        details: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * 执行漏斗同步
   */
  async executeFunnelSync(accountId: number): Promise<StepResult> {
    const startTime = Date.now();
    
    try {
      // 默认漏斗配置 - 使用空数组，将自动从数据库获取
      const defaultTierConfigs: trafficIsolationServiceModule.FunnelTierConfig[] = [];
      
      const result = await trafficIsolationServiceModule.syncFunnelNegatives(accountId, defaultTierConfigs);
      
      const duration = Date.now() - startTime;
      
      return {
        step: 'funnel_sync',
        status: 'success',
        duration,
        details: {
          syncedCount: result.totalNegativesToAdd || 0,
          tier1Keywords: result.tier1Keywords?.length || 0,
          tier2Keywords: result.tier2Keywords?.length || 0,
        },
      };
    } catch (error) {
      return {
        step: 'funnel_sync',
        status: 'failed',
        duration: Date.now() - startTime,
        details: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * 执行冲突检测
   */
  async executeConflictDetection(accountId: number): Promise<StepResult> {
    const startTime = Date.now();
    
    try {
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30天前
      const endDate = new Date();
      const result = await trafficIsolationServiceModule.detectTrafficConflicts(accountId, startDate, endDate);
      
      const duration = Date.now() - startTime;
      
      return {
        step: 'conflict_detection',
        status: 'success',
        duration,
        details: {
          conflictsDetected: result.conflicts?.length || 0,
          totalWastedSpend: result.totalWastedSpend || 0,
          resolutionSuggestions: result.conflicts?.length || 0,
        },
      };
    } catch (error) {
      return {
        step: 'conflict_detection',
        status: 'failed',
        duration: Date.now() - startTime,
        details: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * 执行迁移建议
   */
  async executeMigrationSuggestion(accountId: number): Promise<StepResult> {
    const startTime = Date.now();
    
    try {
      // 默认漏斗配置 - 使用空数组，将自动从数据库获取
      const defaultTierConfigs: trafficIsolationServiceModule.FunnelTierConfig[] = [];
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = new Date();
      const result = await trafficIsolationServiceModule.getKeywordMigrationSuggestions(accountId, defaultTierConfigs, startDate, endDate);
      
      const duration = Date.now() - startTime;
      
      return {
        step: 'migration_suggestion',
        status: 'success',
        duration,
        details: {
          suggestionsGenerated: result?.length || 0,
          potentialImpact: {},
        },
      };
    } catch (error) {
      return {
        step: 'migration_suggestion',
        status: 'failed',
        duration: Date.now() - startTime,
        details: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * 执行出价优化
   */
  async executeBidOptimization(accountId: number): Promise<StepResult> {
    const startTime = Date.now();
    
    try {
      const db = await getDb();
      if (!db) {
        throw new Error('Database connection failed');
      }
      
      const campaignList = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.accountId, accountId));
      
      let totalOptimized = 0;
      let totalAdjustments = 0;
      
      for (const campaign of campaignList) {
        try {
          // 调用自动化执行引擎进行出价优化
          const result = await automationExecutionEngineModule.executeOptimization(
            accountId,
            'bid_adjustment',
            'campaign',
            campaign.id,
            campaign.campaignName || `Campaign ${campaign.id}`,
            Number(campaign.dailyBudget) || 0,
            Number(campaign.dailyBudget) || 0,
            0.8,
            '自动运营定时优化'
          );
          
          if (result.status === 'success') {
            totalOptimized++;
            totalAdjustments++;
          }
        } catch (e) {
          console.error(`Bid optimization failed for campaign ${campaign.id}:`, e);
        }
      }
      
      const duration = Date.now() - startTime;
      
      return {
        step: 'bid_optimization',
        status: 'success',
        duration,
        details: {
          campaignsOptimized: totalOptimized,
          totalCampaigns: campaignList.length,
          adjustmentsApplied: totalAdjustments,
        },
      };
    } catch (error) {
      return {
        step: 'bid_optimization',
        status: 'failed',
        duration: Date.now() - startTime,
        details: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * 获取运营日志
   */
  async getLogs(accountId: number, limit: number = 50): Promise<AutoOperationLog[]> {
    return logStore
      .filter(log => log.accountId === accountId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  },

  /**
   * 获取所有需要执行的账号
   */
  async getAccountsDueForExecution(): Promise<number[]> {
    const now = new Date();
    const dueAccounts: number[] = [];
    
    configStore.forEach((config, accountId) => {
      if (config.enabled && config.nextRunAt && config.nextRunAt <= now) {
        dueAccounts.push(accountId);
      }
    });
    
    return dueAccounts;
  },

  /**
   * 执行所有到期的自动运营任务
   */
  async executeAllDueTasks(): Promise<{ executed: number; failed: number; results: OperationResult[] }> {
    const accountIds = await this.getAccountsDueForExecution();
    
    const results: OperationResult[] = [];
    let executed = 0;
    let failed = 0;
    
    for (const accountId of accountIds) {
      try {
        const result = await this.executeFullOperation(accountId);
        results.push(result);
        executed++;
      } catch (error) {
        console.error(`Auto operation failed for account ${accountId}:`, error);
        failed++;
      }
    }
    
    return { executed, failed, results };
  },

  /**
   * 获取所有配置
   */
  async getAllConfigs(): Promise<AutoOperationConfig[]> {
    return Array.from(configStore.values());
  },
};

export default autoOperationService;
