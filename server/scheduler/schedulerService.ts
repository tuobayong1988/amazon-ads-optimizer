/**
 * Scheduler Service - Handle automated optimization tasks
 */

import { analyzeNgrams, analyzeFunnelMigration, detectTrafficConflicts, analyzeBidAdjustments } from '../automation/adAutomation';
import { sendNotification, sendBatchAlerts, analyzeHealthMetrics, HealthMetrics, NotificationConfig, defaultNotificationConfig } from '../system/notificationService';

// Task types
export type TaskType = 
  | 'ngram_analysis'
  | 'funnel_migration'
  | 'traffic_conflict'
  | 'smart_bidding'
  | 'health_check'
  | 'data_sync'
  | 'traffic_isolation_full';  // 完整流量隔离自动化周期

// Task configuration
export interface TaskConfig {
  taskType: TaskType;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: 'hourly' | 'daily' | 'weekly' | 'monthly';
  runTime: string; // HH:MM format
  dayOfWeek?: number; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
  parameters?: Record<string, any>;
  autoApply: boolean;
  requireApproval: boolean;
}

// Task execution result
export interface TaskExecutionResult {
  taskId: number;
  taskType: TaskType;
  status: 'success' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt: Date;
  duration: number; // seconds
  itemsProcessed: number;
  suggestionsGenerated: number;
  suggestionsApplied: number;
  errorMessage?: string;
  resultSummary: Record<string, any>;
}

// Default task configurations
export const defaultTaskConfigs: Record<TaskType, Partial<TaskConfig>> = {
  ngram_analysis: {
    name: 'N-Gram词根分析',
    description: '分析无效搜索词的共同词根特征，生成批量否定词建议',
    schedule: 'daily',
    runTime: '06:00',
    autoApply: false,
    requireApproval: true
  },
  funnel_migration: {
    name: '漏斗迁移分析',
    description: '监控广泛匹配中表现优秀的词，建议迁移到短语或精准匹配',
    schedule: 'daily',
    runTime: '06:30',
    autoApply: false,
    requireApproval: true
  },
  traffic_conflict: {
    name: '流量冲突检测',
    description: '检测跨广告活动的重叠搜索词，建议最优流量分配方案',
    schedule: 'daily',
    runTime: '07:00',
    autoApply: false,
    requireApproval: true
  },
  smart_bidding: {
    name: '智能竞价调整',
    description: '基于绩效数据自动计算最优出价调整',
    schedule: 'daily',
    runTime: '07:30',
    autoApply: false,
    requireApproval: true
  },
  health_check: {
    name: '健康度检查',
    description: '监控广告活动健康状态，检测异常指标',
    schedule: 'hourly',
    runTime: '00:00',
    autoApply: false,
    requireApproval: false
  },
  data_sync: {
    name: '数据同步',
    description: '从TAmazon API同步最新广告数据',
    schedule: 'daily',
    runTime: '05:00',
    autoApply: true,
    requireApproval: false
  },
  traffic_isolation_full: {
    name: '流量隔离自动化',
    description: '完整流量隔离周期：N-Gram分析+漏斗同步+关键词迁移+冲突解决',
    schedule: 'daily',
    runTime: '06:00',
    autoApply: true,
    requireApproval: false
  }
};

/**
 * Check if task should run at current time
 */
export function shouldTaskRun(config: TaskConfig, lastRunAt?: Date): boolean {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const [targetHour, targetMinute] = config.runTime.split(':').map(Number);
  
  // Check if we're within the run window (5 minute tolerance)
  const isInRunWindow = 
    currentHour === targetHour && 
    Math.abs(currentMinute - targetMinute) <= 5;
  
  if (!isInRunWindow) return false;
  
  // Check if already ran today/this hour
  if (lastRunAt) {
    const lastRunDate = new Date(lastRunAt);
    
    switch (config.schedule) {
      case 'hourly':
        // Don't run if ran within the last hour
        return (now.getTime() - lastRunDate.getTime()) > 55 * 60 * 1000;
      
      case 'daily':
        // Don't run if ran today
        return lastRunDate.toDateString() !== now.toDateString();
      
      case 'weekly':
        // Check day of week and if ran this week
        if (config.dayOfWeek !== undefined && now.getDay() !== config.dayOfWeek) {
          return false;
        }
        const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
        return lastRunDate < weekAgo;
      
      case 'monthly':
        // Check day of month and if ran this month
        if (config.dayOfMonth !== undefined && now.getDate() !== config.dayOfMonth) {
          return false;
        }
        return lastRunDate.getMonth() !== now.getMonth() || 
               lastRunDate.getFullYear() !== now.getFullYear();
    }
  }
  
  return true;
}

/**
 * Calculate next run time for a task
 */
export function calculateNextRunTime(config: TaskConfig): Date {
  const now = new Date();
  const [targetHour, targetMinute] = config.runTime.split(':').map(Number);
  
  let nextRun = new Date(now);
  nextRun.setHours(targetHour, targetMinute, 0, 0);
  
  // If the time has passed today, move to next occurrence
  if (nextRun <= now) {
    switch (config.schedule) {
      case 'hourly':
        nextRun.setHours(nextRun.getHours() + 1);
        break;
      case 'daily':
        nextRun.setDate(nextRun.getDate() + 1);
        break;
      case 'weekly':
        nextRun.setDate(nextRun.getDate() + 7);
        if (config.dayOfWeek !== undefined) {
          while (nextRun.getDay() !== config.dayOfWeek) {
            nextRun.setDate(nextRun.getDate() + 1);
          }
        }
        break;
      case 'monthly':
        nextRun.setMonth(nextRun.getMonth() + 1);
        if (config.dayOfMonth !== undefined) {
          nextRun.setDate(config.dayOfMonth);
        }
        break;
    }
  }
  
  return nextRun;
}

/**
 * Execute N-Gram analysis task
 */
export async function executeNgramAnalysis(
  searchTerms: Array<{
    searchTerm: string;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    impressions: number;
    campaignType?: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
    targetingType?: 'keyword' | 'product';
  }>,
  autoApply: boolean = false
): Promise<TaskExecutionResult> {
  const startedAt = new Date();
  
  try {
    const result = analyzeNgrams(searchTerms);
    
    const completedAt = new Date();
    
    return {
      taskId: 0,
      taskType: 'ngram_analysis',
      status: 'success',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: searchTerms.length,
      suggestionsGenerated: result.filter((r: { isNegativeCandidate: boolean }) => r.isNegativeCandidate).length,
      suggestionsApplied: autoApply ? result.filter((r: { isNegativeCandidate: boolean }) => r.isNegativeCandidate).length : 0,
      resultSummary: {
        totalNgrams: result.length,
        negativeCandidates: result.filter((r: { isNegativeCandidate: boolean }) => r.isNegativeCandidate).length,
        estimatedSavings: result.filter((r: { isNegativeCandidate: boolean }) => r.isNegativeCandidate).reduce((sum: number, r: { totalSpend: number }) => sum + r.totalSpend, 0)
      }
    };
  } catch (error) {
    const completedAt = new Date();
    return {
      taskId: 0,
      taskType: 'ngram_analysis',
      status: 'failed',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: 0,
      suggestionsGenerated: 0,
      suggestionsApplied: 0,
      errorMessage: error instanceof Error ? (error as Error).message : 'Unknown error',
      resultSummary: {}
    };
  }
}

/**
 * Execute funnel migration analysis task
 */
export async function executeFunnelMigration(
  searchTerms: Array<{
    searchTerm: string;
    campaignId: number;
    campaignName: string;
    campaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
    targetingType: 'keyword' | 'product';
    matchType: 'broad' | 'phrase' | 'exact' | 'auto' | 'product';
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    roas: number;
    acos: number;
    cpc: number;
    adGroupId?: number;
    adGroupName?: string;
  }>,
  autoApply: boolean = false
): Promise<TaskExecutionResult> {
  const startedAt = new Date();
  
  try {
    const result = analyzeFunnelMigration(searchTerms);
    
    const completedAt = new Date();
    
    return {
      taskId: 0,
      taskType: 'funnel_migration',
      status: 'success',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: searchTerms.length,
      suggestionsGenerated: result.length,
      suggestionsApplied: autoApply ? result.length : 0,
      resultSummary: {
        broadToPhrase: result.filter((s: { fromMatchType: string }) => s.fromMatchType === 'broad').length,
        phraseToExact: result.filter((s: { fromMatchType: string }) => s.fromMatchType === 'phrase').length
      }
    };
  } catch (error) {
    const completedAt = new Date();
    return {
      taskId: 0,
      taskType: 'funnel_migration',
      status: 'failed',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: 0,
      suggestionsGenerated: 0,
      suggestionsApplied: 0,
      errorMessage: error instanceof Error ? (error as Error).message : 'Unknown error',
      resultSummary: {}
    };
  }
}

/**
 * Execute traffic conflict detection task
 */
export async function executeTrafficConflictDetection(
  searchTerms: Array<{
    searchTerm: string;
    campaignId: number;
    campaignName: string;
    campaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
    targetingType: 'keyword' | 'product';
    matchType: 'broad' | 'phrase' | 'exact' | 'auto' | 'product';
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    roas: number;
    acos: number;
    cpc: number;
    adGroupId?: number;
    adGroupName?: string;
  }>,
  autoApply: boolean = false
): Promise<TaskExecutionResult> {
  const startedAt = new Date();
  
  try {
    const result = detectTrafficConflicts(searchTerms);
    
    const completedAt = new Date();
    
    return {
      taskId: 0,
      taskType: 'traffic_conflict',
      status: 'success',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: searchTerms.length,
      suggestionsGenerated: result.length,
      suggestionsApplied: autoApply ? result.length : 0,
      resultSummary: {
        conflictsDetected: result.length,
        campaignsAffected: new Set(result.flatMap((c: { campaigns: Array<{ campaignId: number }> }) => c.campaigns.map((camp: { campaignId: number }) => camp.campaignId))).size
      }
    };
  } catch (error) {
    const completedAt = new Date();
    return {
      taskId: 0,
      taskType: 'traffic_conflict',
      status: 'failed',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: 0,
      suggestionsGenerated: 0,
      suggestionsApplied: 0,
      errorMessage: error instanceof Error ? (error as Error).message : 'Unknown error',
      resultSummary: {}
    };
  }
}

/**
 * Execute smart bidding task
 */
export async function executeSmartBidding(
  bidTargets: Array<{
    id: number;
    type: 'keyword' | 'product_target';
    name: string;
    campaignId: number;
    campaignName: string;
    currentBid: number;
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    targetAcos?: number;
    targetRoas?: number;
  }>,
  targetAcos: number,
  autoApply: boolean = false
): Promise<TaskExecutionResult> {
  const startedAt = new Date();
  
  try {
    const result = analyzeBidAdjustments(bidTargets, { targetAcos, targetRoas: 100 / targetAcos, rampUpPercent: 5, maxBidMultiplier: 3, minImpressions: 100, correctionWindow: 14 });
    
    const completedAt = new Date();
    
    const increaseCount = result.filter((a: { adjustmentType: string }) => a.adjustmentType === 'increase').length;
    const decreaseCount = result.filter((a: { adjustmentType: string }) => a.adjustmentType === 'decrease').length;
    
    return {
      taskId: 0,
      taskType: 'smart_bidding',
      status: 'success',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: bidTargets.length,
      suggestionsGenerated: result.length,
      suggestionsApplied: autoApply ? result.length : 0,
      resultSummary: {
        increases: increaseCount,
        decreases: decreaseCount,
        holds: bidTargets.length - increaseCount - decreaseCount
      }
    };
  } catch (error) {
    const completedAt = new Date();
    return {
      taskId: 0,
      taskType: 'smart_bidding',
      status: 'failed',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: 0,
      suggestionsGenerated: 0,
      suggestionsApplied: 0,
      errorMessage: error instanceof Error ? (error as Error).message : 'Unknown error',
      resultSummary: {}
    };
  }
}

/**
 * Execute health check task
 */
export async function executeHealthCheck(
  campaigns: HealthMetrics[],
  notificationConfig: NotificationConfig = defaultNotificationConfig
): Promise<TaskExecutionResult> {
  const startedAt = new Date();
  
  try {
    const allAlerts = campaigns.flatMap(campaign => 
      analyzeHealthMetrics(campaign, notificationConfig)
    );
    
    // Send alerts if any critical issues found
    if (allAlerts.length > 0) {
      await sendBatchAlerts(allAlerts);
    }
    
    const completedAt = new Date();
    
    return {
      taskId: 0,
      taskType: 'health_check',
      status: 'success',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: campaigns.length,
      suggestionsGenerated: allAlerts.length,
      suggestionsApplied: 0,
      resultSummary: {
        campaignsChecked: campaigns.length,
        alertsGenerated: allAlerts.length,
        criticalAlerts: allAlerts.filter((a: { severity: string }) => a.severity === 'critical').length,
        warningAlerts: allAlerts.filter((a: { severity: string }) => a.severity === 'warning').length
      }
    };
  } catch (error) {
    const completedAt = new Date();
    return {
      taskId: 0,
      taskType: 'health_check',
      status: 'failed',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: 0,
      suggestionsGenerated: 0,
      suggestionsApplied: 0,
      errorMessage: error instanceof Error ? (error as Error).message : 'Unknown error',
      resultSummary: {}
    };
  }
}

/**
 * Format task execution result for display
 */
export function formatTaskResult(result: TaskExecutionResult): string {
  const statusEmoji = {
    success: '✅',
    failed: '❌',
    cancelled: '⚪'
  };
  
  let message = `${statusEmoji[result.status]} **${getTaskTypeName(result.taskType)}** - ${result.status === 'success' ? '执行成功' : '执行失败'}\n\n`;
  
  message += `⏱️ 执行时间: ${result.duration}秒\n`;
  message += `📊 处理项目: ${result.itemsProcessed}\n`;
  message += `💡 生成建议: ${result.suggestionsGenerated}\n`;
  
  if (result.suggestionsApplied > 0) {
    message += `✅ 已应用: ${result.suggestionsApplied}\n`;
  }
  
  if (result.errorMessage) {
    message += `\n❌ 错误: ${result.errorMessage}\n`;
  }
  
  return message;
}

function getTaskTypeName(taskType: TaskType): string {
  const names: Record<TaskType, string> = {
    ngram_analysis: 'N-Gram词根分析',
    funnel_migration: '漏斗迁移分析',
    traffic_conflict: '流量冲突检测',
    smart_bidding: '智能竞价调整',
    health_check: '健康度检查',
    data_sync: '数据同步',
    traffic_isolation_full: '流量隔离自动化'
  };
  return names[taskType];
}

// ==================== 流量隔离自动化任务 ====================

import { runFullTrafficIsolationCycle, AutomationConfig } from '../automation/automationExecutionEngine';

/**
 * 执行完整流量隔离自动化周期
 * 包含：N-Gram分析 + 漏斗否定词同步 + 关键词迁移 + 流量冲突解决
 */
export async function executeTrafficIsolationFull(
  accountId: number,
  config?: Partial<AutomationConfig>
): Promise<TaskExecutionResult> {
  const startedAt = new Date();
  
  try {
    // 使用默认配置或传入的配置
    const fullConfig: AutomationConfig = {
      mode: config?.mode || 'full_auto',
      safetyLimits: config?.safetyLimits || {
        maxBidChangePercent: 30,
        maxBudgetChangePercent: 50,
        maxDailyExecutions: 100,
        minConfidenceScore: 0.7,
      },
      notificationConfig: config?.notificationConfig || {
        notifyOnSuccess: true,
        notifyOnFailure: true,
        dailySummary: true,
      },
      enabledTypes: config?.enabledTypes || [
        'ngram_analysis',
        'funnel_negative_sync',
        'keyword_migration',
        'traffic_conflict_resolution',
      ],
    };
    
    const result = await runFullTrafficIsolationCycle(accountId, fullConfig);
    
    const completedAt = new Date();
    
    return {
      taskId: 0,
      taskType: 'traffic_isolation_full',
      status: result.success ? 'success' : 'failed',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: result.summary.totalNegativesAdded + result.summary.totalKeywordsMigrated + result.summary.totalConflictsResolved,
      suggestionsGenerated: result.summary.totalNegativesAdded + result.summary.totalKeywordsMigrated + result.summary.totalConflictsResolved,
      suggestionsApplied: fullConfig.mode === 'full_auto' ? 
        result.summary.totalNegativesAdded + result.summary.totalKeywordsMigrated + result.summary.totalConflictsResolved : 0,
      resultSummary: {
        negativesAdded: result.summary.totalNegativesAdded,
        keywordsMigrated: result.summary.totalKeywordsMigrated,
        conflictsResolved: result.summary.totalConflictsResolved,
        estimatedSavings: result.summary.estimatedSavings,
        ngramAnalysis: result.ngramResult.success,
        funnelSync: result.funnelResult.success,
        migration: result.migrationResult.success,
        conflictResolution: result.conflictResult.success,
      }
    };
  } catch (error) {
    const completedAt = new Date();
    return {
      taskId: 0,
      taskType: 'traffic_isolation_full',
      status: 'failed',
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
      itemsProcessed: 0,
      suggestionsGenerated: 0,
      suggestionsApplied: 0,
      errorMessage: error instanceof Error ? (error as Error).message : 'Unknown error',
      resultSummary: {}
    };
  }
}
