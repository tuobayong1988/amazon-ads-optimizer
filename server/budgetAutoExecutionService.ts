/**
 * 预算自动执行服务
 * 设置定时任务自动应用预算建议，减少人工干预
 */

import { getDb } from './db';
import {
  budgetAutoExecutionConfigs,
  budgetAutoExecutionHistory,
  budgetAutoExecutionDetails,
  campaigns,
  performanceGroups,
  InsertBudgetAutoExecutionConfig,
  InsertBudgetAutoExecutionHistory,
  InsertBudgetAutoExecutionDetail,
  BudgetAutoExecutionConfig,
  BudgetAutoExecutionHistory,
} from '../drizzle/schema';
import { eq, and, lte, gte, desc, isNull, or } from 'drizzle-orm';
import { generateBudgetAllocationSuggestions } from './intelligentBudgetAllocationService';
import { notifyOwner } from './_core/notification';

// 自动执行配置接口
export interface AutoExecutionConfigInput {
  accountId: number;
  performanceGroupId?: number;
  configName: string;
  isEnabled?: boolean;
  executionFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  executionTime?: string; // HH:MM格式
  executionDayOfWeek?: number; // 0-6
  executionDayOfMonth?: number; // 1-31
  minDataDays?: number;
  maxAdjustmentPercent?: number;
  minBudget?: number;
  requireApproval?: boolean;
  notifyOnExecution?: boolean;
  notifyOnError?: boolean;
}

// 创建自动执行配置
export async function createAutoExecutionConfig(
  config: AutoExecutionConfigInput,
  userId?: number
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const nextExecutionAt = calculateNextExecutionTime(config);

  const configData: InsertBudgetAutoExecutionConfig = {
    accountId: config.accountId,
    performanceGroupId: config.performanceGroupId,
    configName: config.configName,
    isEnabled: config.isEnabled ? 1 : 0,
    executionFrequency: config.executionFrequency,
    executionTime: config.executionTime || '06:00',
    executionDayOfWeek: config.executionDayOfWeek,
    executionDayOfMonth: config.executionDayOfMonth,
    minDataDays: config.minDataDays || 7,
    maxAdjustmentPercent: String(config.maxAdjustmentPercent || 15),
    minBudget: String(config.minBudget || 5),
    requireApproval: config.requireApproval ? 1 : 0,
    notifyOnExecution: config.notifyOnExecution !== false ? 1 : 0,
    notifyOnError: config.notifyOnError !== false ? 1 : 0,
    nextExecutionAt: nextExecutionAt.toISOString().slice(0, 19).replace('T', ' '),
    createdBy: userId,
  };

  const result = await db.insert(budgetAutoExecutionConfigs).values(configData);
  return result[0].insertId;
}

// 更新自动执行配置
export async function updateAutoExecutionConfig(
  configId: number,
  updates: Partial<AutoExecutionConfigInput>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const updateData: Record<string, unknown> = {};
  
  if (updates.configName !== undefined) updateData.configName = updates.configName;
  if (updates.isEnabled !== undefined) updateData.isEnabled = updates.isEnabled ? 1 : 0;
  if (updates.executionFrequency !== undefined) updateData.executionFrequency = updates.executionFrequency;
  if (updates.executionTime !== undefined) updateData.executionTime = updates.executionTime;
  if (updates.executionDayOfWeek !== undefined) updateData.executionDayOfWeek = updates.executionDayOfWeek;
  if (updates.executionDayOfMonth !== undefined) updateData.executionDayOfMonth = updates.executionDayOfMonth;
  if (updates.minDataDays !== undefined) updateData.minDataDays = updates.minDataDays;
  if (updates.maxAdjustmentPercent !== undefined) updateData.maxAdjustmentPercent = String(updates.maxAdjustmentPercent);
  if (updates.minBudget !== undefined) updateData.minBudget = String(updates.minBudget);
  if (updates.requireApproval !== undefined) updateData.requireApproval = updates.requireApproval ? 1 : 0;
  if (updates.notifyOnExecution !== undefined) updateData.notifyOnExecution = updates.notifyOnExecution ? 1 : 0;
  if (updates.notifyOnError !== undefined) updateData.notifyOnError = updates.notifyOnError ? 1 : 0;

  // 如果更新了执行时间相关配置，重新计算下次执行时间
  if (updates.executionFrequency || updates.executionTime || updates.executionDayOfWeek || updates.executionDayOfMonth) {
    const currentConfig = await getAutoExecutionConfigById(configId);
    if (currentConfig) {
      const mergedConfig = { ...currentConfig, ...updates };
      const nextExecutionAt = calculateNextExecutionTime(mergedConfig as AutoExecutionConfigInput);
      updateData.nextExecutionAt = nextExecutionAt.toISOString().slice(0, 19).replace('T', ' ');
    }
  }

  await db.update(budgetAutoExecutionConfigs)
    .set(updateData)
    .where(eq(budgetAutoExecutionConfigs.id, configId));
}

// 删除自动执行配置
export async function deleteAutoExecutionConfig(configId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db.delete(budgetAutoExecutionConfigs).where(eq(budgetAutoExecutionConfigs.id, configId));
}

// 获取自动执行配置列表
export async function getAutoExecutionConfigs(accountId: number): Promise<BudgetAutoExecutionConfig[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select()
    .from(budgetAutoExecutionConfigs)
    .where(eq(budgetAutoExecutionConfigs.accountId, accountId))
    .orderBy(desc(budgetAutoExecutionConfigs.createdAt));
}

// 获取单个自动执行配置
export async function getAutoExecutionConfigById(configId: number): Promise<BudgetAutoExecutionConfig | null> {
  const db = await getDb();
  if (!db) return null;

  const results = await db.select()
    .from(budgetAutoExecutionConfigs)
    .where(eq(budgetAutoExecutionConfigs.id, configId))
    .limit(1);

  return results[0] || null;
}

// 计算下次执行时间
function calculateNextExecutionTime(config: AutoExecutionConfigInput): Date {
  const now = new Date();
  const [hours, minutes] = (config.executionTime || '06:00').split(':').map(Number);
  
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  // 如果今天的执行时间已过，从明天开始计算
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  switch (config.executionFrequency) {
    case 'daily':
      // 已经设置好了
      break;
    
    case 'weekly':
      const targetDayOfWeek = config.executionDayOfWeek ?? 1; // 默认周一
      while (next.getDay() !== targetDayOfWeek) {
        next.setDate(next.getDate() + 1);
      }
      break;
    
    case 'biweekly':
      const biweeklyDay = config.executionDayOfWeek ?? 1;
      while (next.getDay() !== biweeklyDay) {
        next.setDate(next.getDate() + 1);
      }
      // 确保是双周
      const weekNumber = Math.floor((next.getTime() - new Date(next.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
      if (weekNumber % 2 !== 0) {
        next.setDate(next.getDate() + 7);
      }
      break;
    
    case 'monthly':
      const targetDay = config.executionDayOfMonth ?? 1;
      next.setDate(targetDay);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
      break;
  }

  return next;
}

// 获取待执行的配置
export async function getPendingExecutions(): Promise<BudgetAutoExecutionConfig[]> {
  const db = await getDb();
  if (!db) return [];

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  return db.select()
    .from(budgetAutoExecutionConfigs)
    .where(and(
      eq(budgetAutoExecutionConfigs.isEnabled, 1),
      lte(budgetAutoExecutionConfigs.nextExecutionAt, now)
    ));
}

// 执行预算分配
export async function executeBudgetAllocation(configId: number): Promise<{
  executionId: number;
  status: 'completed' | 'failed' | 'pending_approval';
  summary: {
    totalCampaigns: number;
    adjustedCampaigns: number;
    skippedCampaigns: number;
    errorCampaigns: number;
    totalBudgetBefore: number;
    totalBudgetAfter: number;
  };
  details: Array<{
    campaignId: number;
    campaignName: string;
    budgetBefore: number;
    budgetAfter: number;
    adjustmentPercent: number;
    status: 'applied' | 'skipped' | 'error';
    reason?: string;
  }>;
}> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // 获取配置
  const config = await getAutoExecutionConfigById(configId);
  if (!config) throw new Error('配置不存在');

  // 创建执行记录
  const executionData: InsertBudgetAutoExecutionHistory = {
    configId,
    accountId: config.accountId,
    executionStartAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    status: 'running',
  };

  const executionResult = await db.insert(budgetAutoExecutionHistory).values(executionData);
  const executionId = executionResult[0].insertId;

  try {
    // 获取预算分配建议
    const suggestions = await generateBudgetAllocationSuggestions(
      config.accountId,
      config.performanceGroupId || undefined
    );

    const details: Array<{
      campaignId: number;
      campaignName: string;
      budgetBefore: number;
      budgetAfter: number;
      adjustmentPercent: number;
      status: 'applied' | 'skipped' | 'error';
      reason?: string;
    }> = [];

    let totalBudgetBefore = 0;
    let totalBudgetAfter = 0;
    let adjustedCampaigns = 0;
    let skippedCampaigns = 0;
    let errorCampaigns = 0;

    const maxAdjustmentPercent = parseFloat(config.maxAdjustmentPercent || '15');
    const minBudget = parseFloat(config.minBudget || '5');

    for (const suggestion of suggestions.suggestions) {
      const budgetBefore = suggestion.currentBudget;
      let budgetAfter = suggestion.suggestedBudget;
      const adjustmentPercent = suggestion.adjustmentPercent;

      totalBudgetBefore += budgetBefore;

      // 检查调整幅度是否超过限制
      if (Math.abs(adjustmentPercent) > maxAdjustmentPercent) {
        // 限制调整幅度
        const limitedAdjustment = adjustmentPercent > 0 ? maxAdjustmentPercent : -maxAdjustmentPercent;
        budgetAfter = budgetBefore * (1 + limitedAdjustment / 100);
      }

      // 确保不低于最小预算
      budgetAfter = Math.max(budgetAfter, minBudget);

      // 检查是否需要跳过（调整幅度太小）
      if (Math.abs(budgetAfter - budgetBefore) < 0.01) {
        skippedCampaigns++;
        details.push({
          campaignId: suggestion.campaignId,
          campaignName: suggestion.campaignName,
          budgetBefore,
          budgetAfter: budgetBefore,
          adjustmentPercent: 0,
          status: 'skipped',
          reason: '调整幅度太小',
        });
        totalBudgetAfter += budgetBefore;
        continue;
      }

      // 检查风险等级
      if (suggestion.riskLevel === 'high' && !config.requireApproval) {
        skippedCampaigns++;
        details.push({
          campaignId: suggestion.campaignId,
          campaignName: suggestion.campaignName,
          budgetBefore,
          budgetAfter: budgetBefore,
          adjustmentPercent: 0,
          status: 'skipped',
          reason: '高风险调整，已跳过',
        });
        totalBudgetAfter += budgetBefore;
        continue;
      }

      try {
        // 如果不需要审批，直接应用
        if (!config.requireApproval) {
          // 更新广告活动预算
          await db.update(campaigns)
            .set({ dailyBudget: String(budgetAfter) })
            .where(eq(campaigns.id, suggestion.campaignId));

          adjustedCampaigns++;
          details.push({
            campaignId: suggestion.campaignId,
            campaignName: suggestion.campaignName,
            budgetBefore,
            budgetAfter,
            adjustmentPercent: ((budgetAfter - budgetBefore) / budgetBefore) * 100,
            status: 'applied',
          });
          totalBudgetAfter += budgetAfter;
        } else {
          // 需要审批，标记为pending
          details.push({
            campaignId: suggestion.campaignId,
            campaignName: suggestion.campaignName,
            budgetBefore,
            budgetAfter,
            adjustmentPercent: ((budgetAfter - budgetBefore) / budgetBefore) * 100,
            status: 'skipped',
            reason: '等待审批',
          });
          totalBudgetAfter += budgetBefore;
          skippedCampaigns++;
        }
      } catch (error) {
        errorCampaigns++;
        details.push({
          campaignId: suggestion.campaignId,
          campaignName: suggestion.campaignName,
          budgetBefore,
          budgetAfter: budgetBefore,
          adjustmentPercent: 0,
          status: 'error',
          reason: error instanceof Error ? error.message : '未知错误',
        });
        totalBudgetAfter += budgetBefore;
      }

      // 保存执行明细
      await db.insert(budgetAutoExecutionDetails).values({
        executionId,
        campaignId: suggestion.campaignId,
        campaignName: suggestion.campaignName,
        budgetBefore: String(budgetBefore),
        budgetAfter: String(details[details.length - 1].status === 'applied' ? budgetAfter : budgetBefore),
        adjustmentPercent: String(details[details.length - 1].adjustmentPercent),
        adjustmentReason: suggestion.reasons.join('; '),
        compositeScore: String(suggestion.compositeScore),
        riskLevel: suggestion.riskLevel,
        status: details[details.length - 1].status,
        errorMessage: details[details.length - 1].reason,
      });
    }

    // 确定最终状态
    const finalStatus = config.requireApproval ? 'pending_approval' : 'completed';

    // 更新执行记录
    const summary = {
      totalCampaigns: suggestions.suggestions.length,
      adjustedCampaigns,
      skippedCampaigns,
      errorCampaigns,
      totalBudgetBefore,
      totalBudgetAfter,
    };

    await db.update(budgetAutoExecutionHistory)
      .set({
        executionEndAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        status: finalStatus,
        totalCampaigns: summary.totalCampaigns,
        adjustedCampaigns: summary.adjustedCampaigns,
        skippedCampaigns: summary.skippedCampaigns,
        errorCampaigns: summary.errorCampaigns,
        totalBudgetBefore: String(summary.totalBudgetBefore),
        totalBudgetAfter: String(summary.totalBudgetAfter),
        executionSummary: JSON.stringify(summary),
      })
      .where(eq(budgetAutoExecutionHistory.id, executionId));

    // 更新配置的下次执行时间
    const nextExecutionAt = calculateNextExecutionTime(config as unknown as AutoExecutionConfigInput);
    await db.update(budgetAutoExecutionConfigs)
      .set({
        lastExecutionAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        nextExecutionAt: nextExecutionAt.toISOString().slice(0, 19).replace('T', ' '),
      })
      .where(eq(budgetAutoExecutionConfigs.id, configId));

    // 发送通知
    if (config.notifyOnExecution) {
      await notifyOwner({
        title: '预算自动分配执行完成',
        content: `配置"${config.configName}"已执行完成。\n` +
          `总计${summary.totalCampaigns}个广告活动，` +
          `已调整${summary.adjustedCampaigns}个，` +
          `跳过${summary.skippedCampaigns}个，` +
          `错误${summary.errorCampaigns}个。\n` +
          `预算变化：$${summary.totalBudgetBefore.toFixed(2)} → $${summary.totalBudgetAfter.toFixed(2)}`,
      });
    }

    return {
      executionId,
      status: finalStatus,
      summary,
      details,
    };
  } catch (error) {
    // 更新执行记录为失败
    await db.update(budgetAutoExecutionHistory)
      .set({
        executionEndAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : '未知错误',
      })
      .where(eq(budgetAutoExecutionHistory.id, executionId));

    // 发送错误通知
    if (config.notifyOnError) {
      await notifyOwner({
        title: '预算自动分配执行失败',
        content: `配置"${config.configName}"执行失败。\n错误信息：${error instanceof Error ? error.message : '未知错误'}`,
      });
    }

    throw error;
  }
}

// 获取执行历史
export async function getExecutionHistory(
  accountId: number,
  limit: number = 50
): Promise<BudgetAutoExecutionHistory[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select()
    .from(budgetAutoExecutionHistory)
    .where(eq(budgetAutoExecutionHistory.accountId, accountId))
    .orderBy(desc(budgetAutoExecutionHistory.executionStartAt))
    .limit(limit);
}

// 获取执行详情
export async function getExecutionDetails(executionId: number): Promise<{
  execution: BudgetAutoExecutionHistory;
  details: Array<{
    id: number;
    campaignId: number;
    campaignName: string | null;
    budgetBefore: string | null;
    budgetAfter: string | null;
    adjustmentPercent: string | null;
    adjustmentReason: string | null;
    compositeScore: string | null;
    riskLevel: string | null;
    status: string;
    errorMessage: string | null;
  }>;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const executionResults = await db.select()
    .from(budgetAutoExecutionHistory)
    .where(eq(budgetAutoExecutionHistory.id, executionId))
    .limit(1);

  if (executionResults.length === 0) return null;

  const details = await db.select()
    .from(budgetAutoExecutionDetails)
    .where(eq(budgetAutoExecutionDetails.executionId, executionId));

  return {
    execution: executionResults[0],
    details: details.map(d => ({
      id: d.id,
      campaignId: d.campaignId,
      campaignName: d.campaignName,
      budgetBefore: d.budgetBefore,
      budgetAfter: d.budgetAfter,
      adjustmentPercent: d.adjustmentPercent,
      adjustmentReason: d.adjustmentReason,
      compositeScore: d.compositeScore,
      riskLevel: d.riskLevel,
      status: d.status,
      errorMessage: d.errorMessage,
    })),
  };
}

// 审批执行
export async function approveExecution(
  executionId: number,
  userId: number,
  approve: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  if (approve) {
    // 获取执行详情
    const executionData = await getExecutionDetails(executionId);
    if (!executionData) throw new Error('执行记录不存在');

    // 应用所有待审批的调整
    for (const detail of executionData.details) {
      if (detail.status === 'skipped' && detail.errorMessage === '等待审批') {
        await db.update(campaigns)
          .set({ dailyBudget: detail.budgetAfter })
          .where(eq(campaigns.id, detail.campaignId));

        await db.update(budgetAutoExecutionDetails)
          .set({ status: 'applied' })
          .where(eq(budgetAutoExecutionDetails.id, detail.id));
      }
    }

    // 更新执行状态
    await db.update(budgetAutoExecutionHistory)
      .set({
        status: 'completed',
        approvedBy: userId,
        approvedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      })
      .where(eq(budgetAutoExecutionHistory.id, executionId));
  } else {
    // 拒绝执行
    await db.update(budgetAutoExecutionHistory)
      .set({
        status: 'cancelled',
        approvedBy: userId,
        approvedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      })
      .where(eq(budgetAutoExecutionHistory.id, executionId));
  }
}

// 手动触发执行
export async function triggerManualExecution(configId: number): Promise<{
  executionId: number;
  status: string;
}> {
  const result = await executeBudgetAllocation(configId);
  return {
    executionId: result.executionId,
    status: result.status,
  };
}

// 定时任务检查器（应该由外部调度器调用）
export async function checkAndExecutePendingTasks(): Promise<{
  executed: number;
  failed: number;
  errors: string[];
}> {
  const pendingConfigs = await getPendingExecutions();
  
  let executed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const config of pendingConfigs) {
    try {
      await executeBudgetAllocation(config.id);
      executed++;
    } catch (error) {
      failed++;
      errors.push(`配置${config.id}执行失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  return { executed, failed, errors };
}


// ==================== 辅助函数（用于单元测试） ====================

/**
 * 检查是否应该现在执行
 */
export function shouldExecuteNowExported(
  config: {
    executionFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
    executionTime: string;
    executionDayOfWeek: number | null;
    executionDayOfMonth: number | null;
  },
  now: Date = new Date()
): boolean {
  const [targetHour, targetMinute] = config.executionTime.split(':').map(Number);
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  // 检查时间是否匹配（允许5分钟误差）
  const timeMatch = currentHour === targetHour && Math.abs(currentMinute - targetMinute) <= 5;
  
  if (!timeMatch) return false;
  
  switch (config.executionFrequency) {
    case 'daily':
      return true;
    case 'weekly':
      return now.getDay() === config.executionDayOfWeek;
    case 'biweekly':
      // 简化实现：检查是否是指定的星期几，且是偶数周
      const weekNumber = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
      return now.getDay() === config.executionDayOfWeek && weekNumber % 2 === 0;
    case 'monthly':
      return now.getDate() === config.executionDayOfMonth;
    default:
      return false;
  }
}

// Export the internal function for testing
export { calculateNextExecutionTime };

/**
 * 计算下次执行时间（导出版本，用于测试）
 */
export function calculateNextExecutionTimeForTest(
  config: {
    executionFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
    executionTime: string;
    executionDayOfWeek: number | null;
    executionDayOfMonth: number | null;
  },
  now: Date = new Date()
): Date {
  const [targetHour, targetMinute] = config.executionTime.split(':').map(Number);
  const next = new Date(now);
  next.setHours(targetHour, targetMinute, 0, 0);
  
  // 如果今天的执行时间已过，从明天开始计算
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  
  switch (config.executionFrequency) {
    case 'daily':
      // 已经设置好了
      break;
    case 'weekly':
      while (next.getDay() !== config.executionDayOfWeek) {
        next.setDate(next.getDate() + 1);
      }
      break;
    case 'biweekly':
      while (next.getDay() !== config.executionDayOfWeek) {
        next.setDate(next.getDate() + 1);
      }
      // 如果需要，再加一周
      const weekNumber = Math.floor(next.getTime() / (7 * 24 * 60 * 60 * 1000));
      if (weekNumber % 2 !== 0) {
        next.setDate(next.getDate() + 7);
      }
      break;
    case 'monthly':
      if (next.getDate() > (config.executionDayOfMonth || 1)) {
        next.setMonth(next.getMonth() + 1);
      }
      next.setDate(config.executionDayOfMonth || 1);
      break;
  }
  
  return next;
}

/**
 * 验证预算调整
 */
export function validateBudgetAdjustment(adjustment: {
  currentBudget: number;
  newBudget: number;
  minBudget?: number;
  maxAdjustmentPercent?: number;
}): {
  isValid: boolean;
  reason?: string;
} {
  const { currentBudget, newBudget, minBudget = 5, maxAdjustmentPercent = 20 } = adjustment;
  
  // 检查最小预算
  if (newBudget < minBudget) {
    return { isValid: false, reason: `新预算 $${newBudget} 低于最小预算 $${minBudget}` };
  }
  
  // 检查调整幅度
  const adjustmentPercent = Math.abs((newBudget - currentBudget) / currentBudget * 100);
  if (adjustmentPercent > maxAdjustmentPercent) {
    return { 
      isValid: false, 
      reason: `调整幅度 ${adjustmentPercent.toFixed(1)}% 超过最大调整幅度 ${maxAdjustmentPercent}%` 
    };
  }
  
  return { isValid: true };
}

/**
 * 生成执行摘要
 */
export function generateExecutionSummary(
  details: Array<{
    campaignId: number;
    status: string;
    budgetBefore: number;
    budgetAfter: number;
  }>
): {
  totalCampaigns: number;
  adjustedCampaigns: number;
  skippedCampaigns: number;
  errorCampaigns: number;
  totalBudgetBefore: number;
  totalBudgetAfter: number;
} {
  const summary = {
    totalCampaigns: details.length,
    adjustedCampaigns: 0,
    skippedCampaigns: 0,
    errorCampaigns: 0,
    totalBudgetBefore: 0,
    totalBudgetAfter: 0,
  };
  
  for (const detail of details) {
    summary.totalBudgetBefore += detail.budgetBefore;
    summary.totalBudgetAfter += detail.budgetAfter;
    
    switch (detail.status) {
      case 'applied':
        summary.adjustedCampaigns++;
        break;
      case 'skipped':
        summary.skippedCampaigns++;
        break;
      case 'error':
        summary.errorCampaigns++;
        break;
    }
  }
  
  return summary;
}

/**
 * 格式化执行报告
 */
export function formatExecutionReport(execution: {
  id: number;
  status: string;
  totalCampaigns: number;
  adjustedCampaigns: number;
  skippedCampaigns: number;
  errorCampaigns: number;
  totalBudgetBefore: number;
  totalBudgetAfter: number;
  executionStartAt: Date;
  executionEndAt: Date;
}): string {
  const statusLabels: Record<string, string> = {
    completed: '执行完成',
    failed: '执行失败',
    running: '执行中',
    pending_approval: '待审批',
    cancelled: '已取消',
  };
  
  const budgetChange = execution.totalBudgetAfter - execution.totalBudgetBefore;
  const budgetChangePercent = (budgetChange / execution.totalBudgetBefore * 100).toFixed(2);
  const duration = (execution.executionEndAt.getTime() - execution.executionStartAt.getTime()) / 1000;
  
  return `
预算自动执行报告
================
状态: ${statusLabels[execution.status] || execution.status}
执行时间: ${execution.executionStartAt.toLocaleString()} - ${execution.executionEndAt.toLocaleString()}
耗时: ${duration.toFixed(0)}秒

广告活动统计:
- 总计: ${execution.totalCampaigns}
- 已调整: ${execution.adjustedCampaigns}
- 已跳过: ${execution.skippedCampaigns}
- 错误: ${execution.errorCampaigns}

预算变化:
- 调整前: $${execution.totalBudgetBefore.toFixed(2)}
- 调整后: $${execution.totalBudgetAfter.toFixed(2)}
- 变化: ${budgetChange >= 0 ? '+' : ''}$${budgetChange.toFixed(2)} (${budgetChangePercent}%)
  `.trim();
}
