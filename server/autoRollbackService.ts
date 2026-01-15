/**
 * 自动回滚规则服务
 * 根据设定的阈值自动评估出价调整效果，生成回滚建议
 */

import { getDb } from './db';
import { bidAdjustmentHistory } from '../drizzle/schema';
import { eq, and, isNull, isNotNull, lte, gte, sql, desc } from 'drizzle-orm';

// 回滚规则配置
export interface RollbackRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  // 触发条件
  conditions: {
    // 实际效果低于预估的百分比阈值（如50表示低于预估50%时触发）
    profitThresholdPercent: number;
    // 最小追踪天数（7/14/30）
    minTrackingDays: 7 | 14 | 30;
    // 最小样本数量
    minSampleCount: number;
    // 是否考虑负向调整（降价）
    includeNegativeAdjustments: boolean;
  };
  // 动作配置
  actions: {
    // 是否自动回滚（false则只生成建议）
    autoRollback: boolean;
    // 是否发送通知
    sendNotification: boolean;
    // 通知优先级
    notificationPriority: 'low' | 'medium' | 'high';
  };
  createdAt: Date;
  updatedAt: Date;
}

// 回滚建议
export interface RollbackSuggestion {
  id: string;
  ruleId: string;
  ruleName: string;
  adjustmentId: number;
  keywordId: number;
  keywordText: string;
  campaignId: number;
  campaignName: string;
  // 调整详情
  previousBid: number;
  newBid: number;
  bidChangePercent: number;
  adjustedAt: Date;
  // 效果数据
  estimatedProfit: number;
  actualProfit: number;
  profitDifferencePercent: number;
  trackingDays: number;
  // 建议状态
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  priority: 'low' | 'medium' | 'high';
  reason: string;
  createdAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNote?: string;
}

// 默认回滚规则
export const DEFAULT_ROLLBACK_RULES: RollbackRule[] = [
  {
    id: 'rule_severe_underperform',
    name: '严重效果不佳',
    description: '实际效果低于预估70%以上，建议立即回滚',
    enabled: true,
    conditions: {
      profitThresholdPercent: 30, // 实际效果只有预估的30%或更低
      minTrackingDays: 7,
      minSampleCount: 1,
      includeNegativeAdjustments: false,
    },
    actions: {
      autoRollback: false,
      sendNotification: true,
      notificationPriority: 'high',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'rule_moderate_underperform',
    name: '中度效果不佳',
    description: '实际效果低于预估50%，建议考虑回滚',
    enabled: true,
    conditions: {
      profitThresholdPercent: 50,
      minTrackingDays: 14,
      minSampleCount: 3,
      includeNegativeAdjustments: false,
    },
    actions: {
      autoRollback: false,
      sendNotification: true,
      notificationPriority: 'medium',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'rule_long_term_underperform',
    name: '长期效果不佳',
    description: '30天后实际效果仍低于预估40%，强烈建议回滚',
    enabled: true,
    conditions: {
      profitThresholdPercent: 40,
      minTrackingDays: 30,
      minSampleCount: 1,
      includeNegativeAdjustments: true,
    },
    actions: {
      autoRollback: false,
      sendNotification: true,
      notificationPriority: 'high',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// 内存存储规则和建议（实际应用中应存储在数据库）
let rollbackRules: RollbackRule[] = [...DEFAULT_ROLLBACK_RULES];
let rollbackSuggestions: RollbackSuggestion[] = [];

/**
 * 获取所有回滚规则
 */
export function getRollbackRules(): RollbackRule[] {
  return [...rollbackRules];
}

/**
 * 获取单个回滚规则
 */
export function getRollbackRule(ruleId: string): RollbackRule | undefined {
  return rollbackRules.find(r => r.id === ruleId);
}

/**
 * 创建回滚规则
 */
export function createRollbackRule(rule: Omit<RollbackRule, 'id' | 'createdAt' | 'updatedAt'>): RollbackRule {
  const newRule: RollbackRule = {
    ...rule,
    id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  rollbackRules.push(newRule);
  return newRule;
}

/**
 * 更新回滚规则
 */
export function updateRollbackRule(ruleId: string, updates: Partial<RollbackRule>): RollbackRule | null {
  const index = rollbackRules.findIndex(r => r.id === ruleId);
  if (index === -1) return null;
  
  rollbackRules[index] = {
    ...rollbackRules[index],
    ...updates,
    updatedAt: new Date(),
  };
  return rollbackRules[index];
}

/**
 * 删除回滚规则
 */
export function deleteRollbackRule(ruleId: string): boolean {
  const index = rollbackRules.findIndex(r => r.id === ruleId);
  if (index === -1) return false;
  rollbackRules.splice(index, 1);
  return true;
}

/**
 * 评估单条历史记录是否需要回滚
 */
export function evaluateAdjustment(
  record: {
    id: number;
    keywordId: number;
    keywordText: string;
    campaignId: number;
    campaignName: string;
    previousBid: string | number;
    newBid: string | number;
    bidChangePercent: string | number;
    adjustedAt: Date | string | number;
    estimatedProfitChange: string | number | null;
    actualProfit7D: string | number | null;
    actualProfit14D: string | number | null;
    actualProfit30D: string | number | null;
  },
  rule: RollbackRule
): RollbackSuggestion | null {
  // 检查规则是否启用
  if (!rule.enabled) return null;
  
  // 获取实际利润数据
  let actualProfit: number | null = null;
  let trackingDays: number = 0;
  
  if (rule.conditions.minTrackingDays <= 7 && record.actualProfit7D !== null) {
    actualProfit = parseFloat(String(record.actualProfit7D));
    trackingDays = 7;
  } else if (rule.conditions.minTrackingDays <= 14 && record.actualProfit14D !== null) {
    actualProfit = parseFloat(String(record.actualProfit14D));
    trackingDays = 14;
  } else if (rule.conditions.minTrackingDays <= 30 && record.actualProfit30D !== null) {
    actualProfit = parseFloat(String(record.actualProfit30D));
    trackingDays = 30;
  }
  
  // 没有足够的追踪数据
  if (actualProfit === null) return null;
  
  const estimatedProfit = parseFloat(String(record.estimatedProfitChange || 0));
  const bidChange = parseFloat(String(record.bidChangePercent || 0));
  
  // 检查是否包含负向调整
  if (!rule.conditions.includeNegativeAdjustments && bidChange < 0) {
    return null;
  }
  
  // 计算实际效果相对于预估的百分比
  let profitDifferencePercent: number;
  if (estimatedProfit === 0) {
    // 预估为0时，如果实际为负则触发
    profitDifferencePercent = actualProfit < 0 ? 0 : 100;
  } else if (estimatedProfit > 0) {
    // 正向预估
    profitDifferencePercent = (actualProfit / estimatedProfit) * 100;
  } else {
    // 负向预估（预期亏损）
    profitDifferencePercent = actualProfit <= estimatedProfit ? 100 : (actualProfit / estimatedProfit) * 100;
  }
  
  // 检查是否低于阈值
  if (profitDifferencePercent >= rule.conditions.profitThresholdPercent) {
    return null;
  }
  
  // 生成回滚建议
  const suggestion: RollbackSuggestion = {
    id: `suggestion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ruleId: rule.id,
    ruleName: rule.name,
    adjustmentId: record.id,
    keywordId: record.keywordId,
    keywordText: record.keywordText || '',
    campaignId: record.campaignId,
    campaignName: record.campaignName || '',
    previousBid: parseFloat(String(record.previousBid)),
    newBid: parseFloat(String(record.newBid)),
    bidChangePercent: bidChange,
    adjustedAt: new Date(record.adjustedAt),
    estimatedProfit,
    actualProfit,
    profitDifferencePercent: Math.round(profitDifferencePercent * 100) / 100,
    trackingDays,
    status: 'pending',
    priority: rule.actions.notificationPriority,
    reason: generateRollbackReason(rule, estimatedProfit, actualProfit, profitDifferencePercent, trackingDays),
    createdAt: new Date(),
  };
  
  return suggestion;
}

/**
 * 生成回滚原因说明
 */
function generateRollbackReason(
  rule: RollbackRule,
  estimatedProfit: number,
  actualProfit: number,
  profitDifferencePercent: number,
  trackingDays: number
): string {
  const profitDiff = actualProfit - estimatedProfit;
  const direction = profitDiff < 0 ? '低于' : '高于';
  
  return `根据规则"${rule.name}"：${trackingDays}天实际利润($${actualProfit.toFixed(2)})${direction}预估利润($${estimatedProfit.toFixed(2)})${Math.abs(100 - profitDifferencePercent).toFixed(1)}%，触发回滚建议。`;
}

/**
 * 运行所有回滚规则评估
 */
export async function runRollbackEvaluation(accountId?: number): Promise<{
  evaluated: number;
  suggestions: RollbackSuggestion[];
}> {
  const db = await getDb();
  if (!db) return { evaluated: 0, suggestions: [] };
  
  // 查询有追踪数据且未回滚的记录
  // 使用status字段检查是否已回滚（status != 'rolled_back'）
  let query = db
    .select()
    .from(bidAdjustmentHistory)
    .where(
      and(
        sql`${bidAdjustmentHistory.status} != 'rolled_back'`,
        // 至少有7天追踪数据
        isNotNull(bidAdjustmentHistory.actualProfit7D)
      )
    );
  
  const records = await query;
  
  // 如果指定了账号ID，过滤记录
  const filteredRecords = accountId 
    ? records.filter(r => r.accountId === accountId)
    : records;
  
  const newSuggestions: RollbackSuggestion[] = [];
  const enabledRules = rollbackRules.filter(r => r.enabled);
  
  for (const record of filteredRecords) {
    for (const rule of enabledRules) {
      // 检查是否已有该记录的建议
      const existingSuggestion = rollbackSuggestions.find(
        s => s.adjustmentId === record.id && s.ruleId === rule.id && s.status === 'pending'
      );
      if (existingSuggestion) continue;
      
      const suggestion = evaluateAdjustment(record as any, rule);
      if (suggestion) {
        newSuggestions.push(suggestion);
        rollbackSuggestions.push(suggestion);
      }
    }
  }
  
  return {
    evaluated: filteredRecords.length,
    suggestions: newSuggestions,
  };
}

/**
 * 获取回滚建议列表
 */
export function getRollbackSuggestions(filters?: {
  status?: RollbackSuggestion['status'];
  priority?: RollbackSuggestion['priority'];
  ruleId?: string;
  accountId?: number;
}): RollbackSuggestion[] {
  let suggestions = [...rollbackSuggestions];
  
  if (filters?.status) {
    suggestions = suggestions.filter(s => s.status === filters.status);
  }
  if (filters?.priority) {
    suggestions = suggestions.filter(s => s.priority === filters.priority);
  }
  if (filters?.ruleId) {
    suggestions = suggestions.filter(s => s.ruleId === filters.ruleId);
  }
  
  // 按创建时间倒序排列
  return suggestions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * 获取单个回滚建议
 */
export function getRollbackSuggestion(suggestionId: string): RollbackSuggestion | undefined {
  return rollbackSuggestions.find(s => s.id === suggestionId);
}

/**
 * 审核回滚建议
 */
export function reviewRollbackSuggestion(
  suggestionId: string,
  action: 'approve' | 'reject',
  reviewedBy: string,
  reviewNote?: string
): RollbackSuggestion | null {
  const index = rollbackSuggestions.findIndex(s => s.id === suggestionId);
  if (index === -1) return null;
  
  rollbackSuggestions[index] = {
    ...rollbackSuggestions[index],
    status: action === 'approve' ? 'approved' : 'rejected',
    reviewedAt: new Date(),
    reviewedBy,
    reviewNote,
  };
  
  return rollbackSuggestions[index];
}

/**
 * 执行回滚建议
 */
export async function executeRollbackSuggestion(suggestionId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const suggestion = rollbackSuggestions.find(s => s.id === suggestionId);
  if (!suggestion) {
    return { success: false, message: '建议不存在' };
  }
  
  if (suggestion.status !== 'approved') {
    return { success: false, message: '建议尚未批准' };
  }
  
  // 这里应该调用实际的回滚逻辑
  // 由于回滚逻辑已在routers.ts中实现，这里只更新状态
  const index = rollbackSuggestions.findIndex(s => s.id === suggestionId);
  rollbackSuggestions[index] = {
    ...rollbackSuggestions[index],
    status: 'executed',
  };
  
  return { success: true, message: '回滚建议已执行' };
}

/**
 * 获取回滚建议统计
 */
export function getRollbackSuggestionStats(): {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  executed: number;
  byPriority: { low: number; medium: number; high: number };
  byRule: Record<string, number>;
} {
  const stats = {
    total: rollbackSuggestions.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    executed: 0,
    byPriority: { low: 0, medium: 0, high: 0 },
    byRule: {} as Record<string, number>,
  };
  
  for (const suggestion of rollbackSuggestions) {
    stats[suggestion.status]++;
    stats.byPriority[suggestion.priority]++;
    stats.byRule[suggestion.ruleId] = (stats.byRule[suggestion.ruleId] || 0) + 1;
  }
  
  return stats;
}

/**
 * 清除已处理的建议（保留最近30天）
 */
export function cleanupOldSuggestions(): number {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const originalCount = rollbackSuggestions.length;
  
  rollbackSuggestions = rollbackSuggestions.filter(s => 
    s.status === 'pending' || s.createdAt > thirtyDaysAgo
  );
  
  return originalCount - rollbackSuggestions.length;
}
