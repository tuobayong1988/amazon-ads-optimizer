/**
 * API安全三件套服务模块
 * 1. 详细操作日志记录
 * 2. 每日花费限额告警
 * 3. 异常操作自动暂停通知
 */

import { getDb } from './db';
import { 
  apiOperationLogs, 
  spendLimitConfigs, 
  spendAlertLogs,
  anomalyDetectionRules,
  anomalyAlertLogs,
  autoPauseRecords
} from '../drizzle/schema';
import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { notifyOwner } from './_core/notification';

// ==================== 类型定义 ====================

export type OperationType = 
  | 'bid_adjustment'
  | 'budget_change'
  | 'campaign_status'
  | 'keyword_status'
  | 'negative_keyword'
  | 'target_status'
  | 'batch_operation'
  | 'api_sync'
  | 'auto_optimization'
  | 'manual_operation'
  | 'other';

export type TargetType = 'campaign' | 'ad_group' | 'keyword' | 'product_target' | 'search_term' | 'account' | 'multiple';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type OperationSource = 'manual' | 'auto_optimization' | 'scheduled_task' | 'api_callback' | 'batch_operation';

export interface LogOperationParams {
  userId: number;
  accountId?: number;
  operationType: OperationType;
  targetType: TargetType;
  targetId?: number;
  targetName?: string;
  actionDescription: string;
  previousValue?: string;
  newValue?: string;
  changeAmount?: number;
  changePercent?: number;
  affectedCount?: number;
  batchOperationId?: number;
  status?: 'success' | 'failed' | 'pending' | 'rolled_back';
  errorMessage?: string;
  source?: OperationSource;
  ipAddress?: string;
  userAgent?: string;
  riskLevel?: RiskLevel;
}

export interface SpendLimitConfigParams {
  userId: number;
  accountId: number;
  dailySpendLimit: number;
  warningThreshold1?: number;
  warningThreshold2?: number;
  criticalThreshold?: number;
  autoStopEnabled?: boolean;
  autoStopThreshold?: number;
}

export interface AnomalyRuleParams {
  userId: number;
  accountId?: number;
  ruleName: string;
  ruleDescription?: string;
  ruleType: 'bid_spike' | 'bid_drop' | 'batch_size' | 'frequency' | 'budget_change' | 'spend_velocity' | 'conversion_drop' | 'acos_spike' | 'custom';
  conditionType: 'threshold' | 'percentage_change' | 'absolute_change' | 'rate_limit';
  conditionValue: number;
  conditionTimeWindow?: number;
  actionOnTrigger?: 'alert_only' | 'pause_and_alert' | 'rollback_and_alert' | 'block_operation';
  priority?: number;
}

// ==================== 1. 详细操作日志记录 ====================

/**
 * 记录API操作日志
 */
export async function logApiOperation(params: LogOperationParams): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    console.warn('[ApiSecurity] Database not available, skipping log');
    return null;
  }

  try {
    // 自动评估风险等级
    const riskLevel = params.riskLevel || evaluateRiskLevel(params);
    
    const result = await db.insert(apiOperationLogs).values({
      userId: params.userId,
      accountId: params.accountId || null,
      operationType: params.operationType,
      targetType: params.targetType,
      targetId: params.targetId || null,
      targetName: params.targetName || null,
      actionDescription: params.actionDescription,
      previousValue: params.previousValue || null,
      newValue: params.newValue || null,
      changeAmount: params.changeAmount?.toString() || null,
      changePercent: params.changePercent?.toString() || null,
      affectedCount: params.affectedCount || 1,
      batchOperationId: params.batchOperationId || null,
      status: params.status || 'success',
      errorMessage: params.errorMessage || null,
      source: params.source || 'manual',
      ipAddress: params.ipAddress || null,
      userAgent: params.userAgent || null,
      riskLevel: riskLevel,
      requiresReview: riskLevel === 'high' || riskLevel === 'critical' ? 1 : 0,
    });

    const logId = Number(result[0].insertId);
    
    // 高风险操作发送通知
    if (riskLevel === 'high' || riskLevel === 'critical') {
      await notifyHighRiskOperation(params, riskLevel);
    }

    console.log(`[ApiSecurity] Operation logged: ${params.operationType} - ${params.actionDescription}`);
    return logId;
  } catch (error) {
    console.error('[ApiSecurity] Failed to log operation:', error);
    return null;
  }
}

/**
 * 评估操作风险等级
 */
function evaluateRiskLevel(params: LogOperationParams): RiskLevel {
  // 批量操作
  if (params.affectedCount && params.affectedCount > 50) {
    return 'critical';
  }
  if (params.affectedCount && params.affectedCount > 20) {
    return 'high';
  }
  if (params.affectedCount && params.affectedCount > 5) {
    return 'medium';
  }

  // 大幅度变更
  if (params.changePercent) {
    const absChange = Math.abs(params.changePercent);
    if (absChange > 100) return 'critical';
    if (absChange > 50) return 'high';
    if (absChange > 20) return 'medium';
  }

  // 特定操作类型
  if (params.operationType === 'budget_change' && params.changeAmount) {
    const absAmount = Math.abs(params.changeAmount);
    if (absAmount > 1000) return 'high';
    if (absAmount > 500) return 'medium';
  }

  return 'low';
}

/**
 * 发送高风险操作通知
 */
async function notifyHighRiskOperation(params: LogOperationParams, riskLevel: RiskLevel): Promise<void> {
  const title = `⚠️ ${riskLevel === 'critical' ? '严重' : '高'}风险操作告警`;
  const content = `
操作类型: ${params.operationType}
目标: ${params.targetName || params.targetType}
描述: ${params.actionDescription}
影响数量: ${params.affectedCount || 1}
${params.changePercent ? `变更幅度: ${params.changePercent}%` : ''}
${params.changeAmount ? `变更金额: $${params.changeAmount}` : ''}
来源: ${params.source || 'manual'}
时间: ${new Date().toLocaleString('zh-CN')}
  `.trim();

  try {
    await notifyOwner({ title, content });
  } catch (error) {
    console.error('[ApiSecurity] Failed to send high risk notification:', error);
  }
}

/**
 * 查询操作日志
 */
export async function getOperationLogs(params: {
  userId?: number;
  accountId?: number;
  operationType?: OperationType;
  status?: string;
  riskLevel?: RiskLevel;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: any[]; total: number }> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };

  try {
    const conditions = [];
    
    if (params.userId) {
      conditions.push(eq(apiOperationLogs.userId, params.userId));
    }
    if (params.accountId) {
      conditions.push(eq(apiOperationLogs.accountId, params.accountId));
    }
    if (params.operationType) {
      conditions.push(eq(apiOperationLogs.operationType, params.operationType));
    }
    if (params.status) {
      conditions.push(eq(apiOperationLogs.status, params.status as any));
    }
    if (params.riskLevel) {
      conditions.push(eq(apiOperationLogs.riskLevel, params.riskLevel));
    }
    if (params.startDate) {
      conditions.push(gte(apiOperationLogs.executedAt, params.startDate));
    }
    if (params.endDate) {
      conditions.push(lte(apiOperationLogs.executedAt, params.endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logs = await db
      .select()
      .from(apiOperationLogs)
      .where(whereClause)
      .orderBy(desc(apiOperationLogs.createdAt))
      .limit(params.limit || 50)
      .offset(params.offset || 0);

    const countResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(apiOperationLogs)
      .where(whereClause);

    return {
      logs,
      total: countResult[0]?.count || 0,
    };
  } catch (error) {
    console.error('[ApiSecurity] Failed to get operation logs:', error);
    return { logs: [], total: 0 };
  }
}

// ==================== 2. 每日花费限额告警 ====================

/**
 * 创建或更新花费限额配置
 */
export async function upsertSpendLimitConfig(params: SpendLimitConfigParams): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    // 检查是否已存在配置
    const existing = await db
      .select()
      .from(spendLimitConfigs)
      .where(and(
        eq(spendLimitConfigs.userId, params.userId),
        eq(spendLimitConfigs.accountId, params.accountId)
      ))
      .limit(1);

    if (existing.length > 0) {
      // 更新现有配置
      await db
        .update(spendLimitConfigs)
        .set({
          dailySpendLimit: params.dailySpendLimit.toString(),
          warningThreshold1: (params.warningThreshold1 || 50).toString(),
          warningThreshold2: (params.warningThreshold2 || 80).toString(),
          criticalThreshold: (params.criticalThreshold || 95).toString(),
          autoStopEnabled: params.autoStopEnabled ? 1 : 0,
          autoStopThreshold: (params.autoStopThreshold || 100).toString(),
        })
        .where(eq(spendLimitConfigs.id, existing[0].id));
      
      return existing[0].id;
    } else {
      // 创建新配置
      const result = await db.insert(spendLimitConfigs).values({
        userId: params.userId,
        accountId: params.accountId,
        dailySpendLimit: params.dailySpendLimit.toString(),
        warningThreshold1: (params.warningThreshold1 || 50).toString(),
        warningThreshold2: (params.warningThreshold2 || 80).toString(),
        criticalThreshold: (params.criticalThreshold || 95).toString(),
        autoStopEnabled: params.autoStopEnabled ? 1 : 0,
        autoStopThreshold: (params.autoStopThreshold || 100).toString(),
      });
      
      return Number(result[0].insertId);
    }
  } catch (error) {
    console.error('[ApiSecurity] Failed to upsert spend limit config:', error);
    return null;
  }
}

/**
 * 获取花费限额配置
 */
export async function getSpendLimitConfig(userId: number, accountId: number): Promise<any | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const configs = await db
      .select()
      .from(spendLimitConfigs)
      .where(and(
        eq(spendLimitConfigs.userId, userId),
        eq(spendLimitConfigs.accountId, accountId)
      ))
      .limit(1);

    return configs[0] || null;
  } catch (error) {
    console.error('[ApiSecurity] Failed to get spend limit config:', error);
    return null;
  }
}

/**
 * 检查花费限额并发送告警
 */
export async function checkSpendLimit(
  userId: number, 
  accountId: number, 
  currentSpend: number
): Promise<{ 
  exceeded: boolean; 
  alertType?: string; 
  shouldPause?: boolean;
}> {
  const config = await getSpendLimitConfig(userId, accountId);
  if (!config || !config.isEnabled) {
    return { exceeded: false };
  }

  const dailyLimit = parseFloat(config.dailySpendLimit);
  const spendPercent = (currentSpend / dailyLimit) * 100;

  const db = await getDb();
  if (!db) return { exceeded: false };

  // 检查今天是否已发送过同类型告警
  const today = new Date().toISOString().split('T')[0];
  const existingAlerts = await db
    .select()
    .from(spendAlertLogs)
    .where(and(
      eq(spendAlertLogs.configId, config.id),
      gte(spendAlertLogs.createdAt, today)
    ));

  const alertedTypes = new Set(existingAlerts.map(a => a.alertType));

  let alertType: string | undefined;
  let alertLevel: 'info' | 'warning' | 'critical' = 'info';
  let shouldPause = false;

  // 检查各级别阈值
  if (spendPercent >= 100 && !alertedTypes.has('limit_reached')) {
    alertType = 'limit_reached';
    alertLevel = 'critical';
    if (config.autoStopEnabled) {
      shouldPause = true;
    }
  } else if (spendPercent >= parseFloat(config.criticalThreshold) && !alertedTypes.has('critical_95')) {
    alertType = 'critical_95';
    alertLevel = 'critical';
  } else if (spendPercent >= parseFloat(config.warningThreshold2) && !alertedTypes.has('warning_80')) {
    alertType = 'warning_80';
    alertLevel = 'warning';
  } else if (spendPercent >= parseFloat(config.warningThreshold1) && !alertedTypes.has('warning_50')) {
    alertType = 'warning_50';
    alertLevel = 'info';
  }

  if (alertType) {
    // 记录告警
    await db.insert(spendAlertLogs).values({
      configId: config.id,
      userId,
      accountId,
      alertType: alertType as any,
      alertLevel,
      currentSpend: currentSpend.toString(),
      dailyLimit: dailyLimit.toString(),
      spendPercent: spendPercent.toFixed(2),
    });

    // 发送通知
    await sendSpendAlert(userId, accountId, alertType, currentSpend, dailyLimit, spendPercent);

    return { exceeded: true, alertType, shouldPause };
  }

  return { exceeded: false };
}

/**
 * 发送花费告警通知
 */
async function sendSpendAlert(
  userId: number,
  accountId: number,
  alertType: string,
  currentSpend: number,
  dailyLimit: number,
  spendPercent: number
): Promise<void> {
  const alertMessages: Record<string, { title: string; emoji: string }> = {
    'warning_50': { title: '花费已达50%', emoji: '📊' },
    'warning_80': { title: '花费已达80%', emoji: '⚠️' },
    'critical_95': { title: '花费已达95%', emoji: '🚨' },
    'limit_reached': { title: '花费已达限额', emoji: '🛑' },
    'auto_stopped': { title: '已自动暂停广告', emoji: '⏸️' },
  };

  const msg = alertMessages[alertType] || { title: '花费告警', emoji: '📢' };

  const title = `${msg.emoji} ${msg.title}`;
  const content = `
账号ID: ${accountId}
当前花费: $${currentSpend.toFixed(2)}
每日限额: $${dailyLimit.toFixed(2)}
消耗比例: ${spendPercent.toFixed(1)}%
时间: ${new Date().toLocaleString('zh-CN')}

${alertType === 'limit_reached' ? '⚠️ 建议立即检查广告活动状态' : ''}
  `.trim();

  try {
    await notifyOwner({ title, content });
  } catch (error) {
    console.error('[ApiSecurity] Failed to send spend alert:', error);
  }
}

/**
 * 获取花费告警历史
 */
export async function getSpendAlertHistory(
  userId: number,
  accountId?: number,
  limit: number = 50
): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const conditions = [eq(spendAlertLogs.userId, userId)];
    if (accountId) {
      conditions.push(eq(spendAlertLogs.accountId, accountId));
    }

    const alerts = await db
      .select()
      .from(spendAlertLogs)
      .where(and(...conditions))
      .orderBy(desc(spendAlertLogs.createdAt))
      .limit(limit);

    return alerts;
  } catch (error) {
    console.error('[ApiSecurity] Failed to get spend alert history:', error);
    return [];
  }
}

// ==================== 3. 异常操作自动暂停通知 ====================

/**
 * 创建异常检测规则
 */
export async function createAnomalyRule(params: AnomalyRuleParams): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    // 映射ruleType到anomalyType枚举值
    const anomalyTypeMap: Record<string, 'bid_spike' | 'bid_drop' | 'batch_size' | 'budget_change' | 'acos_spike' | 'spend_velocity' | 'click_anomaly' | 'conversion_drop'> = {
      'bid_spike': 'bid_spike',
      'bid_drop': 'bid_drop',
      'batch_size': 'batch_size',
      'budget_change': 'budget_change',
      'acos_spike': 'acos_spike',
      'spend_velocity': 'spend_velocity',
      'conversion_drop': 'conversion_drop',
      'frequency': 'click_anomaly',
      'custom': 'bid_spike',
    };
    
    // 映射conditionType到detectionMethod枚举值
    const detectionMethodMap: Record<string, 'threshold' | 'percentage_change' | 'absolute_change' | 'rate_limit' | 'statistical'> = {
      'threshold': 'threshold',
      'percentage_change': 'percentage_change',
      'absolute_change': 'absolute_change',
      'rate_limit': 'rate_limit',
    };
    
    // 映射actionOnTrigger到actionType枚举值
    const actionTypeMap: Record<string, 'alert_only' | 'pause_and_alert' | 'rollback_and_alert' | 'block_operation'> = {
      'alert_only': 'alert_only',
      'pause_and_alert': 'pause_and_alert',
      'rollback_and_alert': 'rollback_and_alert',
      'block_operation': 'block_operation',
    };
    
    const result = await db.insert(anomalyDetectionRules).values({
      userId: params.userId,
      accountId: params.accountId || null,
      ruleName: params.ruleName,
      ruleDescription: params.ruleDescription || null,
      anomalyType: anomalyTypeMap[params.ruleType] || 'bid_spike',
      detectionMethod: detectionMethodMap[params.conditionType] || 'threshold',
      thresholdValue: params.conditionValue.toString(),
      timeWindowMinutes: params.conditionTimeWindow || 60,
      actionType: actionTypeMap[params.actionOnTrigger || 'alert_only'] || 'alert_only',
      priority: params.priority || 5,
    });

    return Number(result[0].insertId);
  } catch (error) {
    console.error('[ApiSecurity] Failed to create anomaly rule:', error);
    return null;
  }
}

/**
 * 获取用户的异常检测规则
 */
export async function getAnomalyRules(userId: number, accountId?: number): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const conditions = [eq(anomalyDetectionRules.userId, userId)];
    if (accountId) {
      conditions.push(eq(anomalyDetectionRules.accountId, accountId));
    }

    const rules = await db
      .select()
      .from(anomalyDetectionRules)
      .where(and(...conditions))
      .orderBy(desc(anomalyDetectionRules.priority));

    return rules;
  } catch (error) {
    console.error('[ApiSecurity] Failed to get anomaly rules:', error);
    return [];
  }
}

/**
 * 检测操作是否触发异常规则
 */
export async function checkAnomalyRules(
  userId: number,
  accountId: number,
  operationType: string,
  value: number,
  operationId?: number
): Promise<{
  triggered: boolean;
  rule?: any;
  action?: string;
}> {
  const rules = await getAnomalyRules(userId, accountId);
  const enabledRules = rules.filter(r => r.isEnabled);

  const db = await getDb();
  if (!db) return { triggered: false };

  for (const rule of enabledRules) {
    let triggered = false;
    const threshold = parseFloat(rule.conditionValue);

    // 根据规则类型检测
    switch (rule.ruleType) {
      case 'bid_spike':
        if (operationType === 'bid_adjustment' && value > threshold) {
          triggered = true;
        }
        break;
      case 'bid_drop':
        if (operationType === 'bid_adjustment' && value < -threshold) {
          triggered = true;
        }
        break;
      case 'batch_size':
        if (operationType === 'batch_operation' && value > threshold) {
          triggered = true;
        }
        break;
      case 'budget_change':
        if (operationType === 'budget_change' && Math.abs(value) > threshold) {
          triggered = true;
        }
        break;
      case 'acos_spike':
        if (value > threshold) {
          triggered = true;
        }
        break;
      default:
        if (value > threshold) {
          triggered = true;
        }
    }

    if (triggered) {
      // 映射ruleType到anomalyType枚举值
      const anomalyTypeMap: Record<string, 'bid_spike' | 'bid_drop' | 'batch_size' | 'budget_change' | 'acos_spike' | 'spend_velocity' | 'click_anomaly' | 'conversion_drop'> = {
        'bid_spike': 'bid_spike',
        'bid_drop': 'bid_drop',
        'batch_size': 'batch_size',
        'budget_change': 'budget_change',
        'acos_spike': 'acos_spike',
        'spend_velocity': 'spend_velocity',
        'conversion_drop': 'conversion_drop',
        'frequency': 'click_anomaly',
        'custom': 'bid_spike',
      };
      
      // 映射actionTaken到枚举值
      const actionTakenMap: Record<string, 'none' | 'alerted' | 'paused' | 'rolled_back' | 'blocked'> = {
        'alert_only': 'alerted',
        'pause_and_alert': 'paused',
        'rollback_and_alert': 'rolled_back',
        'block_operation': 'blocked',
      };
      
      // 记录异常告警
      await db.insert(anomalyAlertLogs).values({
        ruleId: rule.id,
        userId,
        accountId,
        anomalyType: anomalyTypeMap[rule.ruleType] || 'bid_spike',
        detectedValue: value.toString(),
        thresholdValue: threshold.toString(),
        affectedTargetName: `${rule.ruleName}: 检测值 ${value} 超过阈值 ${threshold}`,
        operationLogId: operationId || null,
        affectedTargetType: operationType,
        actionTaken: actionTakenMap[rule.actionOnTrigger || 'alert_only'] || 'alerted',
      });

      // 发送异常通知
      await sendAnomalyAlert(rule, value, operationType);

      return {
        triggered: true,
        rule,
        action: rule.actionOnTrigger,
      };
    }
  }

  return { triggered: false };
}

/**
 * 发送异常告警通知
 */
async function sendAnomalyAlert(rule: any, value: number, operationType: string): Promise<void> {
  const actionEmojis: Record<string, string> = {
    'alert_only': '⚠️',
    'pause_and_alert': '⏸️',
    'rollback_and_alert': '↩️',
    'block_operation': '🚫',
  };

  const emoji = actionEmojis[rule.actionOnTrigger] || '⚠️';
  const title = `${emoji} 异常操作检测: ${rule.ruleName}`;
  const content = `
规则名称: ${rule.ruleName}
规则类型: ${rule.ruleType}
操作类型: ${operationType}
检测值: ${value}
阈值: ${rule.conditionValue}
执行动作: ${rule.actionOnTrigger}
时间: ${new Date().toLocaleString('zh-CN')}

${rule.ruleDescription || ''}
  `.trim();

  try {
    await notifyOwner({ title, content });
  } catch (error) {
    console.error('[ApiSecurity] Failed to send anomaly alert:', error);
  }
}

/**
 * 记录自动暂停
 */
export async function recordAutoPause(params: {
  userId: number;
  accountId: number;
  pauseReason: 'spend_limit' | 'anomaly_detected' | 'acos_threshold' | 'manual_trigger' | 'scheduled';
  pauseScope: 'account' | 'campaign' | 'ad_group' | 'keyword' | 'target';
  pausedEntityIds: number[];
  previousStates?: Record<number, string>;
  relatedAlertId?: number;
  relatedRuleId?: number;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  // 映射pauseReason到数据库枚举值
  const pauseReasonMap: Record<string, 'spend_limit' | 'anomaly_detected' | 'manual_trigger' | 'scheduled' | 'api_error'> = {
    'spend_limit': 'spend_limit',
    'anomaly_detected': 'anomaly_detected',
    'acos_threshold': 'anomaly_detected', // acos_threshold映射到anomaly_detected
    'manual_trigger': 'manual_trigger',
    'scheduled': 'scheduled',
  };
  
  // 映射pauseScope到triggerSource
  const triggerSourceMap: Record<string, string> = {
    'account': 'account_level',
    'campaign': 'campaign_level',
    'ad_group': 'ad_group_level',
    'keyword': 'keyword_level',
    'target': 'target_level',
  };

  try {
    const result = await db.insert(autoPauseRecords).values({
      userId: params.userId,
      accountId: params.accountId,
      pauseReason: pauseReasonMap[params.pauseReason] || 'anomaly_detected',
      triggerSource: triggerSourceMap[params.pauseScope] || 'system',
      triggerRuleId: params.relatedRuleId || null,
      affectedCampaigns: params.pauseScope === 'campaign' ? params.pausedEntityIds.length : 0,
      affectedAdGroups: params.pauseScope === 'ad_group' ? params.pausedEntityIds.length : 0,
      affectedKeywords: params.pauseScope === 'keyword' ? params.pausedEntityIds.length : 0,
      previousState: params.previousStates ? JSON.stringify(params.previousStates) : null,
    });

    const recordId = Number(result[0].insertId);

    // 发送暂停通知
    await sendAutoPauseNotification(params);

    return recordId;
  } catch (error) {
    console.error('[ApiSecurity] Failed to record auto pause:', error);
    return null;
  }
}

/**
 * 发送自动暂停通知
 */
async function sendAutoPauseNotification(params: {
  pauseReason: string;
  pauseScope: string;
  pausedEntityIds: number[];
  accountId: number;
}): Promise<void> {
  const reasonMessages: Record<string, string> = {
    'spend_limit': '花费达到每日限额',
    'anomaly_detected': '检测到异常操作',
    'acos_threshold': 'ACoS超过阈值',
    'manual_trigger': '手动触发',
    'scheduled': '定时暂停',
  };

  const title = '⏸️ 广告已自动暂停';
  const content = `
暂停原因: ${reasonMessages[params.pauseReason] || params.pauseReason}
暂停范围: ${params.pauseScope}
影响数量: ${params.pausedEntityIds.length}
账号ID: ${params.accountId}
时间: ${new Date().toLocaleString('zh-CN')}

请登录系统查看详情并决定是否恢复。
  `.trim();

  try {
    await notifyOwner({ title, content });
  } catch (error) {
    console.error('[ApiSecurity] Failed to send auto pause notification:', error);
  }
}

/**
 * 恢复暂停的实体
 */
export async function resumePausedEntities(
  recordId: number,
  userId: number,
  resumeReason: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    await db
      .update(autoPauseRecords)
      .set({
        isResumed: 1,
        resumedBy: userId,
        resumedAt: new Date().toISOString(),
        resumeReason,
      })
      .where(eq(autoPauseRecords.id, recordId));

    return true;
  } catch (error) {
    console.error('[ApiSecurity] Failed to resume paused entities:', error);
    return false;
  }
}

/**
 * 获取自动暂停记录
 */
export async function getAutoPauseRecords(
  userId: number,
  accountId?: number,
  includeResumed: boolean = false
): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const conditions = [eq(autoPauseRecords.userId, userId)];
    if (accountId) {
      conditions.push(eq(autoPauseRecords.accountId, accountId));
    }
    if (!includeResumed) {
      conditions.push(eq(autoPauseRecords.isResumed, 0));
    }

    const records = await db
      .select()
      .from(autoPauseRecords)
      .where(and(...conditions))
      .orderBy(desc(autoPauseRecords.createdAt));

    return records;
  } catch (error) {
    console.error('[ApiSecurity] Failed to get auto pause records:', error);
    return [];
  }
}

// ==================== 默认规则初始化 ====================

/**
 * 为新用户创建默认异常检测规则
 */
export async function initializeDefaultRules(userId: number): Promise<void> {
  const defaultRules: Omit<AnomalyRuleParams, 'userId'>[] = [
    {
      ruleName: '出价飙升检测',
      ruleDescription: '当单次出价调整超过200%时触发告警',
      ruleType: 'bid_spike',
      conditionType: 'percentage_change',
      conditionValue: 200,
      actionOnTrigger: 'alert_only',
      priority: 8,
    },
    {
      ruleName: '批量操作数量检测',
      ruleDescription: '当单次批量操作影响超过100个目标时触发告警',
      ruleType: 'batch_size',
      conditionType: 'threshold',
      conditionValue: 100,
      actionOnTrigger: 'alert_only',
      priority: 7,
    },
    {
      ruleName: '预算大幅变更检测',
      ruleDescription: '当预算变更超过$500时触发告警',
      ruleType: 'budget_change',
      conditionType: 'absolute_change',
      conditionValue: 500,
      actionOnTrigger: 'alert_only',
      priority: 6,
    },
    {
      ruleName: 'ACoS异常检测',
      ruleDescription: '当ACoS超过100%时触发告警',
      ruleType: 'acos_spike',
      conditionType: 'threshold',
      conditionValue: 100,
      actionOnTrigger: 'alert_only',
      priority: 5,
    },
  ];

  for (const rule of defaultRules) {
    await createAnomalyRule({ ...rule, userId });
  }

  console.log(`[ApiSecurity] Initialized default rules for user ${userId}`);
}
