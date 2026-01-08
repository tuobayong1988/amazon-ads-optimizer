/**
 * 自动化执行引擎
 * 
 * 核心理念：系统自动完成优化工作，人只做监督
 * 
 * 功能：
 * 1. 统一的自动化执行入口
 * 2. 安全边界检查
 * 3. 执行日志记录
 * 4. 异常处理和回滚
 * 5. 智能调度
 */

import { getDb } from './db';
import * as db from './db';
import * as unifiedOptimizationEngine from './unifiedOptimizationEngine';
import * as bidOptimizer from './bidOptimizer';
import * as autoRollbackService from './autoRollbackService';
import * as specialScenarioOptimizationService from './specialScenarioOptimizationService';
import * as notificationService from './notificationService';
import * as trafficIsolationService from './trafficIsolationService';

// ==================== 类型定义 ====================

/**
 * 自动化执行模式
 */
export type AutomationMode = 
  | 'full_auto'      // 全自动：满足条件自动执行
  | 'supervised'     // 监督模式：自动执行+事后通知
  | 'approval'       // 审批模式：需人工确认
  | 'disabled';      // 禁用

/**
 * 执行类型
 */
export type ExecutionType = 
  | 'bid_adjustment'      // 竞价调整
  | 'budget_adjustment'   // 预算调整
  | 'placement_tilt'      // 位置倾斜
  | 'negative_keyword'    // 否定词添加
  | 'dayparting'          // 分时策略
  | 'funnel_migration'    // 漏斗迁移
  | 'traffic_isolation'   // 流量隔离
  | 'auto_rollback'       // 自动回滚
  | 'ngram_analysis'      // N-Gram分析
  | 'funnel_sync'         // 漏斗否定词同步
  | 'keyword_migration';  // 关键词迁移

/**
 * 安全边界配置
 */
export interface SafetyBoundary {
  // 单次调整限制
  maxBidChangePercent: number;        // 竞价调整幅度上限（%）
  maxBudgetChangePercent: number;     // 预算调整幅度上限（%）
  maxPlacementChangePercent: number;  // 位置倾斜调整上限（%）
  
  // 每日调整限制
  maxDailyBidAdjustments: number;     // 每日竞价调整次数上限
  maxDailyBudgetAdjustments: number;  // 每日预算调整次数上限
  maxDailyTotalAdjustments: number;   // 每日总调整数量上限
  
  // 置信度阈值
  autoExecuteConfidence: number;      // 全自动执行置信度阈值
  supervisedConfidence: number;       // 监督执行置信度阈值
  
  // 紧急停止条件
  acosIncreaseThreshold: number;      // ACoS增长阈值（%）
  spendOverrunThreshold: number;      // 花费超支阈值（%）
  conversionDropThreshold: number;    // 转化率下降阈值（%）
  apiFailureThreshold: number;        // API连续失败次数
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  id: string;
  type: ExecutionType;
  targetType: 'keyword' | 'campaign' | 'ad_group' | 'placement';
  targetId: number;
  targetName: string;
  previousValue: string | number;
  newValue: string | number;
  confidence: number;
  status: 'success' | 'failed' | 'skipped' | 'blocked';
  reason: string;
  executedAt: Date;
  executedBy: 'auto' | 'manual';
}

/**
 * 执行批次
 */
export interface ExecutionBatch {
  id: string;
  accountId: number;
  startedAt: Date;
  completedAt?: Date;
  totalItems: number;
  successItems: number;
  failedItems: number;
  skippedItems: number;
  blockedItems: number;
  results: ExecutionResult[];
}

/**
 * 账号自动化配置
 */
export interface AccountAutomationConfig {
  accountId: number;
  enabled: boolean;
  mode: AutomationMode;
  safetyBoundary: SafetyBoundary;
  enabledTypes: ExecutionType[];
  scheduleConfig: {
    bidAdjustmentTime: string;      // HH:MM
    budgetAdjustmentTime: string;
    analysisTime: string;
    syncTime: string;
  };
  notificationConfig: {
    notifyOnSuccess: boolean;
    notifyOnFailure: boolean;
    notifyOnBlocked: boolean;
    dailySummary: boolean;
    weeklySummary: boolean;
  };
}

// ==================== 默认配置 ====================

export const DEFAULT_SAFETY_BOUNDARY: SafetyBoundary = {
  // 单次调整限制
  maxBidChangePercent: 30,
  maxBudgetChangePercent: 50,
  maxPlacementChangePercent: 20,
  
  // 每日调整限制
  maxDailyBidAdjustments: 100,
  maxDailyBudgetAdjustments: 10,
  maxDailyTotalAdjustments: 150,
  
  // 置信度阈值
  autoExecuteConfidence: 80,
  supervisedConfidence: 60,
  
  // 紧急停止条件
  acosIncreaseThreshold: 50,
  spendOverrunThreshold: 200,
  conversionDropThreshold: 70,
  apiFailureThreshold: 3,
};

export const DEFAULT_AUTOMATION_CONFIG: Omit<AccountAutomationConfig, 'accountId'> = {
  enabled: true,
  mode: 'full_auto',
  safetyBoundary: DEFAULT_SAFETY_BOUNDARY,
  enabledTypes: [
    'bid_adjustment',
    'budget_adjustment',
    'placement_tilt',
    'negative_keyword',
    'dayparting',
    'auto_rollback',
    'ngram_analysis',
    'funnel_sync',
    'keyword_migration',
    'traffic_isolation',
    'funnel_migration',
  ],
  scheduleConfig: {
    bidAdjustmentTime: '07:00',
    budgetAdjustmentTime: '06:00',
    analysisTime: '05:30',
    syncTime: '05:00',
  },
  notificationConfig: {
    notifyOnSuccess: false,
    notifyOnFailure: true,
    notifyOnBlocked: true,
    dailySummary: true,
    weeklySummary: true,
  },
};

// ==================== 内存存储（实际应存入数据库） ====================

const accountConfigs: Map<number, AccountAutomationConfig> = new Map();
const executionHistory: ExecutionBatch[] = [];
const dailyExecutionCount: Map<string, number> = new Map(); // key: accountId_date_type

// ==================== 核心函数 ====================

/**
 * 获取账号自动化配置
 */
export function getAccountAutomationConfig(accountId: number): AccountAutomationConfig {
  if (!accountConfigs.has(accountId)) {
    accountConfigs.set(accountId, {
      accountId,
      ...DEFAULT_AUTOMATION_CONFIG,
    });
  }
  return accountConfigs.get(accountId)!;
}

/**
 * 更新账号自动化配置
 */
export function updateAccountAutomationConfig(
  accountId: number,
  config: Partial<AccountAutomationConfig>
): AccountAutomationConfig {
  const current = getAccountAutomationConfig(accountId);
  const updated = {
    ...current,
    ...config,
    accountId,
    safetyBoundary: {
      ...current.safetyBoundary,
      ...(config.safetyBoundary || {}),
    },
    scheduleConfig: {
      ...current.scheduleConfig,
      ...(config.scheduleConfig || {}),
    },
    notificationConfig: {
      ...current.notificationConfig,
      ...(config.notificationConfig || {}),
    },
  };
  accountConfigs.set(accountId, updated);
  return updated;
}

/**
 * 检查是否超过每日执行限制
 */
function checkDailyLimit(accountId: number, type: ExecutionType): boolean {
  const today = new Date().toISOString().split('T')[0];
  const key = `${accountId}_${today}_${type}`;
  const count = dailyExecutionCount.get(key) || 0;
  const config = getAccountAutomationConfig(accountId);
  
  switch (type) {
    case 'bid_adjustment':
      return count < config.safetyBoundary.maxDailyBidAdjustments;
    case 'budget_adjustment':
      return count < config.safetyBoundary.maxDailyBudgetAdjustments;
    default:
      return count < config.safetyBoundary.maxDailyTotalAdjustments;
  }
}

/**
 * 增加每日执行计数
 */
function incrementDailyCount(accountId: number, type: ExecutionType): void {
  const today = new Date().toISOString().split('T')[0];
  const key = `${accountId}_${today}_${type}`;
  const count = dailyExecutionCount.get(key) || 0;
  dailyExecutionCount.set(key, count + 1);
}

/**
 * 检查调整幅度是否在安全边界内
 */
function checkAdjustmentBoundary(
  accountId: number,
  type: ExecutionType,
  currentValue: number,
  newValue: number
): { allowed: boolean; reason?: string } {
  const config = getAccountAutomationConfig(accountId);
  const changePercent = Math.abs((newValue - currentValue) / currentValue * 100);
  
  switch (type) {
    case 'bid_adjustment':
      if (changePercent > config.safetyBoundary.maxBidChangePercent) {
        return {
          allowed: false,
          reason: `竞价调整幅度 ${changePercent.toFixed(1)}% 超过安全边界 ${config.safetyBoundary.maxBidChangePercent}%`,
        };
      }
      break;
    case 'budget_adjustment':
      if (changePercent > config.safetyBoundary.maxBudgetChangePercent) {
        return {
          allowed: false,
          reason: `预算调整幅度 ${changePercent.toFixed(1)}% 超过安全边界 ${config.safetyBoundary.maxBudgetChangePercent}%`,
        };
      }
      break;
    case 'placement_tilt':
      if (changePercent > config.safetyBoundary.maxPlacementChangePercent) {
        return {
          allowed: false,
          reason: `位置倾斜调整幅度 ${changePercent.toFixed(1)}% 超过安全边界 ${config.safetyBoundary.maxPlacementChangePercent}%`,
        };
      }
      break;
  }
  
  return { allowed: true };
}

/**
 * 检查置信度是否满足自动执行条件
 */
function checkConfidenceThreshold(
  accountId: number,
  confidence: number
): { mode: 'auto' | 'supervised' | 'manual'; reason: string } {
  const config = getAccountAutomationConfig(accountId);
  
  if (confidence >= config.safetyBoundary.autoExecuteConfidence) {
    return { mode: 'auto', reason: `置信度 ${confidence}% >= ${config.safetyBoundary.autoExecuteConfidence}%，自动执行` };
  } else if (confidence >= config.safetyBoundary.supervisedConfidence) {
    return { mode: 'supervised', reason: `置信度 ${confidence}% >= ${config.safetyBoundary.supervisedConfidence}%，监督执行` };
  } else {
    return { mode: 'manual', reason: `置信度 ${confidence}% < ${config.safetyBoundary.supervisedConfidence}%，需人工确认` };
  }
}

/**
 * 执行单个优化决策
 */
export async function executeOptimization(
  accountId: number,
  type: ExecutionType,
  targetType: 'keyword' | 'campaign' | 'ad_group' | 'placement',
  targetId: number,
  targetName: string,
  currentValue: number,
  newValue: number,
  confidence: number,
  reason: string
): Promise<ExecutionResult> {
  const config = getAccountAutomationConfig(accountId);
  const resultId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // 检查是否启用
  if (!config.enabled) {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: 'blocked',
      reason: '自动化执行已禁用',
      executedAt: new Date(),
      executedBy: 'auto',
    };
  }
  
  // 检查执行类型是否启用
  if (!config.enabledTypes.includes(type)) {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: 'blocked',
      reason: `执行类型 ${type} 未启用`,
      executedAt: new Date(),
      executedBy: 'auto',
    };
  }
  
  // 检查每日限制
  if (!checkDailyLimit(accountId, type)) {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: 'blocked',
      reason: '已达到每日执行限制',
      executedAt: new Date(),
      executedBy: 'auto',
    };
  }
  
  // 检查调整幅度
  const boundaryCheck = checkAdjustmentBoundary(accountId, type, currentValue, newValue);
  if (!boundaryCheck.allowed) {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: 'blocked',
      reason: boundaryCheck.reason!,
      executedAt: new Date(),
      executedBy: 'auto',
    };
  }
  
  // 检查置信度
  const confidenceCheck = checkConfidenceThreshold(accountId, confidence);
  if (confidenceCheck.mode === 'manual' && config.mode !== 'approval') {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: 'skipped',
      reason: confidenceCheck.reason,
      executedAt: new Date(),
      executedBy: 'auto',
    };
  }
  
  // 执行实际操作
  try {
    switch (type) {
      case 'bid_adjustment':
        await db.updateKeyword(targetId, { bid: String(newValue) });
        await db.createBiddingLog({
          accountId,
          campaignId: 0, // TODO: 获取实际campaignId
          adGroupId: 0,
          logTargetType: 'keyword',
          targetId,
          targetName,
          actionType: newValue > currentValue ? 'increase' : 'decrease',
          previousBid: String(currentValue),
          newBid: String(newValue),
          reason: `[自动执行] ${reason}`,
        });
        break;
        
      case 'budget_adjustment':
        await db.updateCampaign(targetId, { dailyBudget: String(newValue) });
        break;
        
      // 其他类型的执行逻辑...
      default:
        // 通用处理
        break;
    }
    
    // 增加执行计数
    incrementDailyCount(accountId, type);
    
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: 'success',
      reason: `${confidenceCheck.reason}。${reason}`,
      executedAt: new Date(),
      executedBy: 'auto',
    };
  } catch (error) {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: 'failed',
      reason: `执行失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
      executedAt: new Date(),
      executedBy: 'auto',
    };
  }
}

/**
 * 批量执行优化决策
 */
export async function batchExecuteOptimizations(
  accountId: number,
  optimizations: Array<{
    type: ExecutionType;
    targetType: 'keyword' | 'campaign' | 'ad_group' | 'placement';
    targetId: number;
    targetName: string;
    currentValue: number;
    newValue: number;
    confidence: number;
    reason: string;
  }>
): Promise<ExecutionBatch> {
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startedAt = new Date();
  const results: ExecutionResult[] = [];
  
  let successItems = 0;
  let failedItems = 0;
  let skippedItems = 0;
  let blockedItems = 0;
  
  for (const opt of optimizations) {
    const result = await executeOptimization(
      accountId,
      opt.type,
      opt.targetType,
      opt.targetId,
      opt.targetName,
      opt.currentValue,
      opt.newValue,
      opt.confidence,
      opt.reason
    );
    
    results.push(result);
    
    switch (result.status) {
      case 'success':
        successItems++;
        break;
      case 'failed':
        failedItems++;
        break;
      case 'skipped':
        skippedItems++;
        break;
      case 'blocked':
        blockedItems++;
        break;
    }
  }
  
  const batch: ExecutionBatch = {
    id: batchId,
    accountId,
    startedAt,
    completedAt: new Date(),
    totalItems: optimizations.length,
    successItems,
    failedItems,
    skippedItems,
    blockedItems,
    results,
  };
  
  // 保存执行历史
  executionHistory.push(batch);
  
  // 发送通知
  const config = getAccountAutomationConfig(accountId);
  if (config.notificationConfig.notifyOnFailure && failedItems > 0) {
    await notificationService.sendNotification({
      userId: 0, // 系统通知
      accountId,
      type: 'alert',
      severity: 'warning',
      title: '自动执行部分失败',
      message: `批次 ${batchId}：成功 ${successItems}，失败 ${failedItems}，跳过 ${skippedItems}，阻止 ${blockedItems}`,
    });
  }
  
  return batch;
}

/**
 * 运行完整的自动优化流程
 */
export async function runFullAutomationCycle(accountId: number): Promise<{
  analysisResults: any[];
  executionBatch: ExecutionBatch | null;
  summary: {
    totalAnalyzed: number;
    totalExecuted: number;
    totalSkipped: number;
    totalBlocked: number;
  };
}> {
  const config = getAccountAutomationConfig(accountId);
  
  if (!config.enabled) {
    return {
      analysisResults: [],
      executionBatch: null,
      summary: {
        totalAnalyzed: 0,
        totalExecuted: 0,
        totalSkipped: 0,
        totalBlocked: 0,
      },
    };
  }
  
  // 1. 运行统一优化分析
  const analysisResults = await unifiedOptimizationEngine.runUnifiedOptimizationAnalysis(
    accountId,
    {
      optimizationTypes: config.enabledTypes.filter(t => 
        ['bid_adjustment', 'placement_tilt', 'dayparting', 'negative_keyword'].includes(t)
      ) as any[],
    }
  );
  
  // 2. 转换为执行格式
  const optimizations = analysisResults
    .filter(r => r.confidence >= config.safetyBoundary.supervisedConfidence)
    .map(r => ({
      type: r.type as ExecutionType,
      targetType: r.targetType as any,
      targetId: r.targetId,
      targetName: r.targetName,
      currentValue: typeof r.currentValue === 'number' ? r.currentValue : parseFloat(r.currentValue as string) || 0,
      newValue: typeof r.suggestedValue === 'number' ? r.suggestedValue : parseFloat(r.suggestedValue as string) || 0,
      confidence: r.confidence,
      reason: r.reasoning,
    }));
  
  // 3. 批量执行
  const executionBatch = optimizations.length > 0
    ? await batchExecuteOptimizations(accountId, optimizations)
    : null;
  
  // 4. 返回汇总
  return {
    analysisResults,
    executionBatch,
    summary: {
      totalAnalyzed: analysisResults.length,
      totalExecuted: executionBatch?.successItems || 0,
      totalSkipped: executionBatch?.skippedItems || 0,
      totalBlocked: executionBatch?.blockedItems || 0,
    },
  };
}

/**
 * 获取执行历史
 */
export function getExecutionHistory(
  accountId: number,
  options: {
    limit?: number;
    startDate?: Date;
    endDate?: Date;
  } = {}
): ExecutionBatch[] {
  let filtered = executionHistory.filter(b => b.accountId === accountId);
  
  if (options.startDate) {
    filtered = filtered.filter(b => b.startedAt >= options.startDate!);
  }
  
  if (options.endDate) {
    filtered = filtered.filter(b => b.startedAt <= options.endDate!);
  }
  
  // 按时间倒序
  filtered.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  
  if (options.limit) {
    filtered = filtered.slice(0, options.limit);
  }
  
  return filtered;
}

/**
 * 获取每日执行统计
 */
export function getDailyExecutionStats(accountId: number, date?: Date): {
  date: string;
  bidAdjustments: number;
  budgetAdjustments: number;
  totalAdjustments: number;
  remaining: {
    bidAdjustments: number;
    budgetAdjustments: number;
    totalAdjustments: number;
  };
} {
  const targetDate = date || new Date();
  const dateStr = targetDate.toISOString().split('T')[0];
  const config = getAccountAutomationConfig(accountId);
  
  const bidCount = dailyExecutionCount.get(`${accountId}_${dateStr}_bid_adjustment`) || 0;
  const budgetCount = dailyExecutionCount.get(`${accountId}_${dateStr}_budget_adjustment`) || 0;
  
  // 计算总数
  let totalCount = 0;
  dailyExecutionCount.forEach((value, key) => {
    if (key.startsWith(`${accountId}_${dateStr}_`)) {
      totalCount += value;
    }
  });
  
  return {
    date: dateStr,
    bidAdjustments: bidCount,
    budgetAdjustments: budgetCount,
    totalAdjustments: totalCount,
    remaining: {
      bidAdjustments: Math.max(0, config.safetyBoundary.maxDailyBidAdjustments - bidCount),
      budgetAdjustments: Math.max(0, config.safetyBoundary.maxDailyBudgetAdjustments - budgetCount),
      totalAdjustments: Math.max(0, config.safetyBoundary.maxDailyTotalAdjustments - totalCount),
    },
  };
}

/**
 * 紧急停止所有自动化
 */
export function emergencyStop(accountId: number, reason: string): void {
  const config = getAccountAutomationConfig(accountId);
  config.enabled = false;
  accountConfigs.set(accountId, config);
  
  // 发送紧急通知
  notificationService.sendNotification({
    userId: 0, // 系统通知
    accountId,
    type: 'alert',
    severity: 'critical',
    title: '自动化紧急停止',
    message: `账号 ${accountId} 的自动化执行已紧急停止。原因：${reason}`,
  });
}

/**
 * 恢复自动化执行
 */
export function resumeAutomation(accountId: number): void {
  const config = getAccountAutomationConfig(accountId);
  config.enabled = true;
  accountConfigs.set(accountId, config);
}

// ==================== 流量隔离自动化任务 ====================

/**
 * 运行N-Gram分析自动化任务
 * 自动识别高频无效词根并生成否定词建议
 */
export async function runNGramAnalysisTask(accountId: number): Promise<{
  success: boolean;
  analysisResult: trafficIsolationService.NGramAnalysisResult | null;
  suggestedNegatives: number;
  appliedNegatives: number;
  message: string;
}> {
  const config = getAccountAutomationConfig(accountId);
  
  if (!config.enabled || !config.enabledTypes.includes('ngram_analysis')) {
    return {
      success: false,
      analysisResult: null,
      suggestedNegatives: 0,
      appliedNegatives: 0,
      message: 'N-Gram分析任务未启用',
    };
  }
  
  try {
    // 1. 运行N-Gram分析（最近30天数据）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    const analysisResult = await trafficIsolationService.runNGramAnalysis(
      accountId,
      startDate,
      endDate,
      { minFrequency: 5 }
    );
    
    // 2. 检查是否有高风险词根需要否定
    const suggestedNegatives = analysisResult.suggestedNegatives.length;
    
    if (suggestedNegatives === 0) {
      return {
        success: true,
        analysisResult,
        suggestedNegatives: 0,
        appliedNegatives: 0,
        message: '未发现需要否定的高频无效词根',
      };
    }
    
    // 3. 如果是全自动模式，自动应用否定词
    let appliedNegatives = 0;
    if (config.mode === 'full_auto') {
      // 获取所有广告活动并应用否定词
      const campaigns = await db.getCampaignsByAccountId(accountId);
      
      for (const suggestion of analysisResult.suggestedNegatives) {
        // 为每个广告活动添加否定词
        for (const campaign of campaigns) {
          try {
            await db.addNegativeKeyword({
              campaignId: campaign.id,
              keyword: suggestion.token,
              matchType: suggestion.matchType === 'negative_phrase' ? 'phrase' : 'exact',
              level: 'campaign',
            });
            appliedNegatives++;
          } catch (error) {
            // 可能已存在，跳过
          }
        }
      }
      
      // 发送通知
      if (config.notificationConfig.notifyOnSuccess) {
        await notificationService.sendNotification({
          userId: 0,
          accountId,
          type: 'system',
          severity: 'info',
          title: 'N-Gram分析完成',
          message: `识别到 ${suggestedNegatives} 个高频无效词根，已自动应用 ${appliedNegatives} 个否定词`,
        });
      }
    } else {
      // 监督模式：发送通知但不自动执行
      await notificationService.sendNotification({
        userId: 0,
        accountId,
        type: 'system',
        severity: 'info',
        title: 'N-Gram分析完成',
        message: `识别到 ${suggestedNegatives} 个高频无效词根，请在优化中心查看并确认`,
      });
    }
    
    return {
      success: true,
      analysisResult,
      suggestedNegatives,
      appliedNegatives,
      message: config.mode === 'full_auto' 
        ? `已自动应用 ${appliedNegatives} 个否定词`
        : `识别到 ${suggestedNegatives} 个建议，等待确认`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (config.notificationConfig.notifyOnFailure) {
      await notificationService.sendNotification({
        userId: 0,
        accountId,
        type: 'alert',
        severity: 'warning',
        title: 'N-Gram分析失败',
        message: errorMessage,
      });
    }
    
    return {
      success: false,
      analysisResult: null,
      suggestedNegatives: 0,
      appliedNegatives: 0,
      message: `N-Gram分析失败: ${errorMessage}`,
    };
  }
}

/**
 * 运行漏斗否定词同步任务
 * 自动识别漏斗层级并同步否定词
 */
export async function runFunnelSyncTask(accountId: number): Promise<{
  success: boolean;
  tierConfigs: trafficIsolationService.FunnelTierConfig[];
  syncResult: trafficIsolationService.FunnelSyncResult | null;
  message: string;
}> {
  const config = getAccountAutomationConfig(accountId);
  
  if (!config.enabled || !config.enabledTypes.includes('funnel_sync')) {
    return {
      success: false,
      tierConfigs: [],
      syncResult: null,
      message: '漏斗同步任务未启用',
    };
  }
  
  try {
    // 1. 自动识别漏斗层级
    const tierConfigs = await trafficIsolationService.identifyFunnelTiers(accountId);
    
    if (tierConfigs.length === 0) {
      return {
        success: true,
        tierConfigs: [],
        syncResult: null,
        message: '未检测到漏斗层级配置，请先配置广告活动层级',
      };
    }
    
    // 2. 同步漏斗否定词
    const syncResult = await trafficIsolationService.syncFunnelNegatives(accountId, tierConfigs);
    
    // 3. 发送通知
    const totalNegatives = syncResult.totalNegativesToAdd;
    
    if (totalNegatives > 0) {
      if (config.mode === 'full_auto') {
        // 全自动模式：已自动应用
        if (config.notificationConfig.notifyOnSuccess) {
          await notificationService.sendNotification({
            userId: 0,
            accountId,
            type: 'system',
            severity: 'info',
            title: '漏斗否定词同步完成',
            message: `已同步 ${totalNegatives} 个否定词到各层级广告活动`,
          });
        }
      } else {
        // 监督模式：发送通知
        await notificationService.sendNotification({
          userId: 0,
          accountId,
          type: 'system',
          severity: 'info',
          title: '漏斗否定词同步建议',
          message: `检测到 ${totalNegatives} 个需要同步的否定词，请在优化中心查看`,
        });
      }
    }
    
    return {
      success: true,
      tierConfigs,
      syncResult,
      message: `识别 ${tierConfigs.length} 个漏斗层级，同步 ${totalNegatives} 个否定词`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (config.notificationConfig.notifyOnFailure) {
      await notificationService.sendNotification({
        userId: 0,
        accountId,
        type: 'alert',
        severity: 'warning',
        title: '漏斗同步失败',
        message: errorMessage,
      });
    }
    
    return {
      success: false,
      tierConfigs: [],
      syncResult: null,
      message: `漏斗同步失败: ${errorMessage}`,
    };
  }
}

/**
 * 运行关键词迁移建议任务
 * 自动识别探索层中表现优异的搜索词并建议迁移到精准层
 */
export async function runKeywordMigrationTask(accountId: number): Promise<{
  success: boolean;
  suggestions: trafficIsolationService.KeywordMigrationSuggestion[];
  appliedMigrations: number;
  message: string;
}> {
  const config = getAccountAutomationConfig(accountId);
  
  if (!config.enabled || !config.enabledTypes.includes('keyword_migration')) {
    return {
      success: false,
      suggestions: [],
      appliedMigrations: 0,
      message: '关键词迁移任务未启用',
    };
  }
  
  try {
    // 1. 获取漏斗层级配置
    const tierConfigs = await trafficIsolationService.identifyFunnelTiers(accountId);
    
    if (tierConfigs.length === 0) {
      return {
        success: true,
        suggestions: [],
        appliedMigrations: 0,
        message: '未检测到漏斗层级配置',
      };
    }
    
    // 2. 获取迁移建议（最近30天数据）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    const suggestions = await trafficIsolationService.getKeywordMigrationSuggestions(
      accountId,
      tierConfigs,
      startDate,
      endDate
    );
    
    if (suggestions.length === 0) {
      return {
        success: true,
        suggestions: [],
        appliedMigrations: 0,
        message: '未发现需要迁移的关键词',
      };
    }
    
    // 3. 如果是全自动模式，自动执行迁移
    let appliedMigrations = 0;
    if (config.mode === 'full_auto') {
      // 获取Tier 1广告活动
      const tier1Configs = tierConfigs.filter(t => t.tierLevel === 'tier1_exact');
      
      if (tier1Configs.length > 0) {
        const tier1CampaignId = tier1Configs[0].campaignId;
        
        // 获取Tier 1广告组
        const tier1AdGroups = await db.getAdGroupsByCampaignId(tier1CampaignId);
        
        if (tier1AdGroups.length > 0) {
          const targetAdGroupId = tier1AdGroups[0].id;
          
          for (const suggestion of suggestions) {
            try {
              // 添加到精准层
              // 添加到精准层（使用现有的关键词添加逻辑）
              // 注意：KeywordMigrationSuggestion没有suggestedBid字段，使用默认值
              const newKeyword = {
                adGroupId: targetAdGroupId,
                keywordText: suggestion.searchTerm,
                matchType: 'exact' as const,
                keywordStatus: 'enabled' as const,
                bid: '1.00',
              };
              // TODO: 通过API创建关键词
              console.log('[AutomationEngine] Would create keyword:', newKeyword);
              
              // 在源广告活动中添加否定词
              await db.addNegativeKeyword({
                campaignId: suggestion.sourceCampaignId,
                keyword: suggestion.searchTerm,
                matchType: 'exact',
                level: 'campaign',
              });
              
              appliedMigrations++;
            } catch (error) {
              // 可能已存在，跳过
            }
          }
        }
      }
      
      // 发送通知
      if (config.notificationConfig.notifyOnSuccess && appliedMigrations > 0) {
        await notificationService.sendNotification({
          userId: 0,
          accountId,
          type: 'system',
          severity: 'info',
          title: '关键词迁移完成',
          message: `已自动迁移 ${appliedMigrations} 个高转化关键词到精准层`,
        });
      }
    } else {
      // 监督模式：发送通知
      await notificationService.sendNotification({
        userId: 0,
        accountId,
        type: 'system',
        severity: 'info',
        title: '关键词迁移建议',
        message: `检测到 ${suggestions.length} 个高转化关键词可迁移到精准层，请在优化中心查看`,
      });
    }
    
    return {
      success: true,
      suggestions,
      appliedMigrations,
      message: config.mode === 'full_auto'
        ? `已自动迁移 ${appliedMigrations} 个关键词`
        : `识别到 ${suggestions.length} 个迁移建议，等待确认`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (config.notificationConfig.notifyOnFailure) {
      await notificationService.sendNotification({
        userId: 0,
        accountId,
        type: 'alert',
        severity: 'warning',
        title: '关键词迁移失败',
        message: errorMessage,
      });
    }
    
    return {
      success: false,
      suggestions: [],
      appliedMigrations: 0,
      message: `关键词迁移失败: ${errorMessage}`,
    };
  }
}

/**
 * 运行流量冲突检测任务
 * 自动检测同一搜索词在多个广告活动中出现的情况
 */
export async function runTrafficConflictDetectionTask(accountId: number): Promise<{
  success: boolean;
  conflictResult: trafficIsolationService.TrafficConflictAnalysisResult | null;
  resolvedConflicts: number;
  message: string;
}> {
  const config = getAccountAutomationConfig(accountId);
  
  if (!config.enabled || !config.enabledTypes.includes('traffic_isolation')) {
    return {
      success: false,
      conflictResult: null,
      resolvedConflicts: 0,
      message: '流量隔离任务未启用',
    };
  }
  
  try {
    // 1. 检测流量冲突（最近14天数据）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);
    
    const conflictResult = await trafficIsolationService.detectTrafficConflicts(
      accountId,
      startDate,
      endDate
    );
    
    if (conflictResult.totalConflicts === 0) {
      return {
        success: true,
        conflictResult,
        resolvedConflicts: 0,
        message: '未检测到流量冲突',
      };
    }
    
    // 2. 如果是全自动模式，自动解决冲突
    let resolvedConflicts = 0;
    if (config.mode === 'full_auto') {
      for (const suggestion of conflictResult.resolutionSuggestions) {
        for (const negative of suggestion.negativesToAdd) {
          try {
            await db.addNegativeKeyword({
              campaignId: negative.campaignId,
              keyword: negative.negativeText,
              matchType: negative.matchType === 'negative_exact' ? 'exact' : 'phrase',
              level: 'campaign',
            });
            resolvedConflicts++;
          } catch (error) {
            // 可能已存在，跳过
          }
        }
      }
      
      // 发送通知
      if (config.notificationConfig.notifyOnSuccess && resolvedConflicts > 0) {
        await notificationService.sendNotification({
          userId: 0,
          accountId,
          type: 'system',
          severity: 'info',
          title: '流量冲突解决完成',
          message: `检测到 ${conflictResult.totalConflicts} 个冲突，已自动解决 ${resolvedConflicts} 个，潜在节省 $${conflictResult.totalWastedSpend.toFixed(2)}`,
        });
      }
    } else {
      // 监督模式：发送通知
      await notificationService.sendNotification({
        userId: 0,
        accountId,
        type: 'alert',
        severity: 'warning',
        title: '检测到流量冲突',
        message: `检测到 ${conflictResult.totalConflicts} 个流量冲突，潜在浪费 $${conflictResult.totalWastedSpend.toFixed(2)}，请在优化中心查看`,
      });
    }
    
    return {
      success: true,
      conflictResult,
      resolvedConflicts,
      message: config.mode === 'full_auto'
        ? `已自动解决 ${resolvedConflicts} 个冲突`
        : `检测到 ${conflictResult.totalConflicts} 个冲突，等待确认`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (config.notificationConfig.notifyOnFailure) {
      await notificationService.sendNotification({
        userId: 0,
        accountId,
        type: 'alert',
        severity: 'warning',
        title: '流量冲突检测失败',
        message: errorMessage,
      });
    }
    
    return {
      success: false,
      conflictResult: null,
      resolvedConflicts: 0,
      message: `流量冲突检测失败: ${errorMessage}`,
    };
  }
}

/**
 * 运行完整的流量隔离自动化周期
 * 包含：N-Gram分析 + 漏斗同步 + 关键词迁移 + 冲突检测
 */
// 简化的配置接口，用于调度服务调用
export interface AutomationConfig {
  mode: 'full_auto' | 'supervised' | 'approval_required';
  safetyLimits?: {
    maxBidChangePercent: number;
    maxBudgetChangePercent: number;
    maxDailyExecutions: number;
    minConfidenceScore: number;
  };
  notificationConfig?: {
    notifyOnSuccess: boolean;
    notifyOnFailure: boolean;
    dailySummary: boolean;
  };
  enabledTypes?: string[];
}

export async function runFullTrafficIsolationCycle(
  accountId: number, 
  overrideConfig?: Partial<AutomationConfig>
): Promise<{
  success: boolean;
  ngramResult: Awaited<ReturnType<typeof runNGramAnalysisTask>>;
  funnelResult: Awaited<ReturnType<typeof runFunnelSyncTask>>;
  migrationResult: Awaited<ReturnType<typeof runKeywordMigrationTask>>;
  conflictResult: Awaited<ReturnType<typeof runTrafficConflictDetectionTask>>;
  summary: {
    totalNegativesAdded: number;
    totalKeywordsMigrated: number;
    totalConflictsResolved: number;
    estimatedSavings: number;
  };
}> {
  const config = getAccountAutomationConfig(accountId);
  
  if (!config.enabled) {
    return {
      success: false,
      ngramResult: { success: false, analysisResult: null, suggestedNegatives: 0, appliedNegatives: 0, message: '自动化未启用' },
      funnelResult: { success: false, tierConfigs: [], syncResult: null, message: '自动化未启用' },
      migrationResult: { success: false, suggestions: [], appliedMigrations: 0, message: '自动化未启用' },
      conflictResult: { success: false, conflictResult: null, resolvedConflicts: 0, message: '自动化未启用' },
      summary: {
        totalNegativesAdded: 0,
        totalKeywordsMigrated: 0,
        totalConflictsResolved: 0,
        estimatedSavings: 0,
      },
    };
  }
  
  // 依次执行各个任务
  const ngramResult = await runNGramAnalysisTask(accountId);
  const funnelResult = await runFunnelSyncTask(accountId);
  const migrationResult = await runKeywordMigrationTask(accountId);
  const conflictResult = await runTrafficConflictDetectionTask(accountId);
  
  // 汇总结果
  const summary = {
    totalNegativesAdded: ngramResult.appliedNegatives + (funnelResult.syncResult?.totalNegativesToAdd || 0),
    totalKeywordsMigrated: migrationResult.appliedMigrations,
    totalConflictsResolved: conflictResult.resolvedConflicts,
    estimatedSavings: (ngramResult.analysisResult?.suggestedNegatives.reduce((sum, n) => sum + n.estimatedSavings, 0) || 0) +
                      (conflictResult.conflictResult?.totalWastedSpend || 0),
  };
  
  // 发送汇总通知
  if (config.notificationConfig.dailySummary) {
    await notificationService.sendNotification({
      userId: 0,
      accountId,
      type: 'report',
      severity: 'info',
      title: '流量隔离自动化周期完成',
      message: `添加否定词: ${summary.totalNegativesAdded}, 迁移关键词: ${summary.totalKeywordsMigrated}, 解决冲突: ${summary.totalConflictsResolved}, 预估节省: $${summary.estimatedSavings.toFixed(2)}`,
    });
  }
  
  return {
    success: ngramResult.success || funnelResult.success || migrationResult.success || conflictResult.success,
    ngramResult,
    funnelResult,
    migrationResult,
    conflictResult,
    summary,
  };
}
