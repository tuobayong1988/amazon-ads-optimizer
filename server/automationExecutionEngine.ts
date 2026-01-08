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
  | 'auto_rollback';      // 自动回滚

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
