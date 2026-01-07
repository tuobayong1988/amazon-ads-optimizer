/**
 * 投放词自动执行服务
 * 实现高花费低转化投放词的自动暂停、潜力词自动启用、以及回滚机制
 */

import { getDb } from "./_core/db";
import { 
  keywords, 
  productTargets, 
  campaigns, 
  adGroups,
  keywordAutoExecutionConfigs,
  keywordAutoExecutionHistory,
  keywordAutoExecutionDetails
} from "../drizzle/schema";
import { eq, and, gte, lte, desc, sql, or, isNull } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

// 投放词表现数据接口
interface KeywordPerformance {
  id: number;
  keywordText: string;
  matchType: string;
  status: string;
  bid: number;
  campaignId: number;
  campaignName: string;
  adGroupId: number;
  adGroupName: string;
  spend: number;
  sales: number;
  clicks: number;
  impressions: number;
  orders: number;
  acos: number;
  roas: number;
  daysWithData: number;
}

// 自动执行配置接口
interface AutoExecutionConfig {
  id: number;
  accountId: number;
  name: string;
  isEnabled: boolean;
  
  // 自动暂停规则
  autoPauseEnabled: boolean;
  pauseMinSpend: number;
  pauseMinClicks: number;
  pauseMaxAcos: number;
  pauseMinDays: number;
  pauseZeroConversions: boolean;
  
  // 自动启用规则
  autoEnableEnabled: boolean;
  enableMinConversions: number;
  enableMinRoas: number;
  enableCooldownDays: number;
  
  // 安全阈值
  maxDailyPauses: number;
  maxDailyEnables: number;
  excludeTopPerformers: boolean;
  topPerformerThreshold: number;
  
  // 回滚设置
  enableRollback: boolean;
  rollbackWindowHours: number;
  rollbackTriggerSpendDrop: number;
  
  // 通知设置
  notifyOnExecution: boolean;
  notifyOnRollback: boolean;
  requireApproval: boolean;
}

// 执行结果接口
interface ExecutionResult {
  success: boolean;
  executionId: number;
  keywordsPaused: number;
  keywordsEnabled: number;
  keywordsSkipped: number;
  keywordsError: number;
  estimatedSpendSaved: number;
  details: ExecutionDetail[];
  errors: string[];
}

interface ExecutionDetail {
  keywordId: number;
  keywordText: string;
  actionType: 'pause' | 'enable' | 'rollback';
  statusBefore: string;
  statusAfter: string;
  triggerReason: string;
  metrics: {
    spend: number;
    sales: number;
    clicks: number;
    acos: number;
    roas: number;
  };
}

/**
 * 获取账号的自动执行配置
 */
export async function getAutoExecutionConfig(accountId: number): Promise<AutoExecutionConfig | null> {
  const db = getDb();
  const configs = await db
    .select()
    .from(keywordAutoExecutionConfigs)
    .where(eq(keywordAutoExecutionConfigs.accountId, accountId))
    .limit(1);
  
  if (configs.length === 0) return null;
  
  const config = configs[0];
  return {
    id: config.id,
    accountId: config.accountId,
    name: config.name,
    isEnabled: config.isEnabled === 1,
    autoPauseEnabled: config.autoPauseEnabled === 1,
    pauseMinSpend: parseFloat(config.pauseMinSpend || '10'),
    pauseMinClicks: config.pauseMinClicks || 20,
    pauseMaxAcos: parseFloat(config.pauseMaxAcos || '100'),
    pauseMinDays: config.pauseMinDays || 7,
    pauseZeroConversions: config.pauseZeroConversions === 1,
    autoEnableEnabled: config.autoEnableEnabled === 1,
    enableMinConversions: config.enableMinConversions || 2,
    enableMinRoas: parseFloat(config.enableMinRoas || '2'),
    enableCooldownDays: config.enableCooldownDays || 14,
    maxDailyPauses: config.maxDailyPauses || 10,
    maxDailyEnables: config.maxDailyEnables || 5,
    excludeTopPerformers: config.excludeTopPerformers === 1,
    topPerformerThreshold: parseFloat(config.topPerformerThreshold || '20'),
    enableRollback: config.enableRollback === 1,
    rollbackWindowHours: config.rollbackWindowHours || 24,
    rollbackTriggerSpendDrop: parseFloat(config.rollbackTriggerSpendDrop || '30'),
    notifyOnExecution: config.notifyOnExecution === 1,
    notifyOnRollback: config.notifyOnRollback === 1,
    requireApproval: config.requireApproval === 1,
  };
}

/**
 * 创建或更新自动执行配置
 */
export async function saveAutoExecutionConfig(
  accountId: number,
  config: Partial<AutoExecutionConfig>,
  userId?: number
): Promise<number> {
  const db = getDb();
  
  const existingConfig = await getAutoExecutionConfig(accountId);
  
  const configData = {
    accountId,
    name: config.name || '默认自动执行配置',
    isEnabled: config.isEnabled ? 1 : 0,
    autoPauseEnabled: config.autoPauseEnabled ? 1 : 0,
    pauseMinSpend: config.pauseMinSpend?.toString() || '10.00',
    pauseMinClicks: config.pauseMinClicks || 20,
    pauseMaxAcos: config.pauseMaxAcos?.toString() || '100.00',
    pauseMinDays: config.pauseMinDays || 7,
    pauseZeroConversions: config.pauseZeroConversions ? 1 : 0,
    autoEnableEnabled: config.autoEnableEnabled ? 1 : 0,
    enableMinConversions: config.enableMinConversions || 2,
    enableMinRoas: config.enableMinRoas?.toString() || '2.00',
    enableCooldownDays: config.enableCooldownDays || 14,
    maxDailyPauses: config.maxDailyPauses || 10,
    maxDailyEnables: config.maxDailyEnables || 5,
    excludeTopPerformers: config.excludeTopPerformers ? 1 : 0,
    topPerformerThreshold: config.topPerformerThreshold?.toString() || '20.00',
    enableRollback: config.enableRollback ? 1 : 0,
    rollbackWindowHours: config.rollbackWindowHours || 24,
    rollbackTriggerSpendDrop: config.rollbackTriggerSpendDrop?.toString() || '30.00',
    notifyOnExecution: config.notifyOnExecution ? 1 : 0,
    notifyOnRollback: config.notifyOnRollback ? 1 : 0,
    requireApproval: config.requireApproval ? 1 : 0,
    createdBy: userId,
  };
  
  if (existingConfig) {
    await db
      .update(keywordAutoExecutionConfigs)
      .set(configData)
      .where(eq(keywordAutoExecutionConfigs.id, existingConfig.id));
    return existingConfig.id;
  } else {
    const result = await db
      .insert(keywordAutoExecutionConfigs)
      .values(configData as any);
    return result[0].insertId;
  }
}

/**
 * 获取需要暂停的投放词（高花费低转化）
 */
export async function getKeywordsToPause(
  accountId: number,
  config: AutoExecutionConfig
): Promise<KeywordPerformance[]> {
  const db = getDb();
  
  // 获取所有启用状态的关键词及其表现数据
  const keywordData = await db
    .select({
      id: keywords.id,
      keywordText: keywords.keywordText,
      matchType: keywords.matchType,
      status: keywords.keywordStatus,
      bid: keywords.bid,
      campaignId: campaigns.id,
      campaignName: campaigns.campaignName,
      adGroupId: adGroups.id,
      adGroupName: adGroups.adGroupName,
      spend: keywords.spend,
      sales: keywords.sales,
      clicks: keywords.clicks,
      impressions: keywords.impressions,
      orders: keywords.orders,
    })
    .from(keywords)
    .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.accountId, accountId),
        eq(keywords.keywordStatus, 'enabled')
      )
    );
  
  // 筛选需要暂停的关键词
  const keywordsToPause: KeywordPerformance[] = [];
  
  for (const kw of keywordData) {
    const spend = parseFloat(kw.spend || '0');
    const sales = parseFloat(kw.sales || '0');
    const clicks = kw.clicks || 0;
    const orders = kw.orders || 0;
    const acos = sales > 0 ? (spend / sales) * 100 : (spend > 0 ? 999 : 0);
    const roas = spend > 0 ? sales / spend : 0;
    
    // 检查是否满足暂停条件
    let shouldPause = false;
    let reason = '';
    
    // 条件1: 高花费零转化
    if (config.pauseZeroConversions && spend >= config.pauseMinSpend && orders === 0) {
      shouldPause = true;
      reason = `高花费零转化: 花费$${spend.toFixed(2)}, 0个订单`;
    }
    // 条件2: 高花费高ACoS
    else if (spend >= config.pauseMinSpend && clicks >= config.pauseMinClicks && acos > config.pauseMaxAcos) {
      shouldPause = true;
      reason = `高花费高ACoS: 花费$${spend.toFixed(2)}, ACoS ${acos.toFixed(1)}% > ${config.pauseMaxAcos}%`;
    }
    
    // 排除表现好的词
    if (shouldPause && config.excludeTopPerformers && acos > 0 && acos <= config.topPerformerThreshold) {
      shouldPause = false;
    }
    
    if (shouldPause) {
      keywordsToPause.push({
        id: kw.id,
        keywordText: kw.keywordText,
        matchType: kw.matchType || 'broad',
        status: kw.status || 'enabled',
        bid: parseFloat(kw.bid || '0'),
        campaignId: kw.campaignId,
        campaignName: kw.campaignName,
        adGroupId: kw.adGroupId,
        adGroupName: kw.adGroupName,
        spend,
        sales,
        clicks,
        impressions: kw.impressions || 0,
        orders,
        acos,
        roas,
        daysWithData: config.pauseMinDays,
      });
    }
  }
  
  // 限制每日最大暂停数量
  return keywordsToPause.slice(0, config.maxDailyPauses);
}

/**
 * 获取可以重新启用的投放词（潜力词恢复）
 */
export async function getKeywordsToEnable(
  accountId: number,
  config: AutoExecutionConfig
): Promise<KeywordPerformance[]> {
  if (!config.autoEnableEnabled) return [];
  
  const db = getDb();
  
  // 获取所有暂停状态的关键词
  const keywordData = await db
    .select({
      id: keywords.id,
      keywordText: keywords.keywordText,
      matchType: keywords.matchType,
      status: keywords.keywordStatus,
      bid: keywords.bid,
      campaignId: campaigns.id,
      campaignName: campaigns.campaignName,
      adGroupId: adGroups.id,
      adGroupName: adGroups.adGroupName,
      spend: keywords.spend,
      sales: keywords.sales,
      clicks: keywords.clicks,
      impressions: keywords.impressions,
      orders: keywords.orders,
    })
    .from(keywords)
    .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.accountId, accountId),
        eq(keywords.keywordStatus, 'paused')
      )
    );
  
  // 筛选可以重新启用的关键词
  const keywordsToEnable: KeywordPerformance[] = [];
  
  for (const kw of keywordData) {
    const spend = parseFloat(kw.spend || '0');
    const sales = parseFloat(kw.sales || '0');
    const orders = kw.orders || 0;
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : 0;
    
    // 检查是否满足启用条件
    if (orders >= config.enableMinConversions && roas >= config.enableMinRoas) {
      keywordsToEnable.push({
        id: kw.id,
        keywordText: kw.keywordText,
        matchType: kw.matchType || 'broad',
        status: kw.status || 'paused',
        bid: parseFloat(kw.bid || '0'),
        campaignId: kw.campaignId,
        campaignName: kw.campaignName,
        adGroupId: kw.adGroupId,
        adGroupName: kw.adGroupName,
        spend,
        sales,
        clicks: kw.clicks || 0,
        impressions: kw.impressions || 0,
        orders,
        acos,
        roas,
        daysWithData: config.enableCooldownDays,
      });
    }
  }
  
  // 限制每日最大启用数量
  return keywordsToEnable.slice(0, config.maxDailyEnables);
}

/**
 * 执行自动暂停/启用操作
 */
export async function executeAutoActions(
  accountId: number,
  userId?: number
): Promise<ExecutionResult> {
  const db = getDb();
  const config = await getAutoExecutionConfig(accountId);
  
  if (!config || !config.isEnabled) {
    return {
      success: false,
      executionId: 0,
      keywordsPaused: 0,
      keywordsEnabled: 0,
      keywordsSkipped: 0,
      keywordsError: 0,
      estimatedSpendSaved: 0,
      details: [],
      errors: ['自动执行配置未启用'],
    };
  }
  
  const errors: string[] = [];
  const details: ExecutionDetail[] = [];
  let keywordsPaused = 0;
  let keywordsEnabled = 0;
  let keywordsSkipped = 0;
  let keywordsError = 0;
  let estimatedSpendSaved = 0;
  
  // 创建执行历史记录
  const executionResult = await db
    .insert(keywordAutoExecutionHistory)
    .values({
      configId: config.id,
      accountId,
      executionStartAt: new Date().toISOString(),
      executionType: 'auto_pause',
      status: 'running',
    } as any);
  
  const executionId = executionResult[0].insertId;
  
  try {
    // 获取需要暂停的关键词
    if (config.autoPauseEnabled) {
      const keywordsToPause = await getKeywordsToPause(accountId, config);
      
      for (const kw of keywordsToPause) {
        try {
          // 更新关键词状态
          await db
            .update(keywords)
            .set({ keywordStatus: 'paused' })
            .where(eq(keywords.id, kw.id));
          
          // 记录执行明细
          await db.insert(keywordAutoExecutionDetails).values({
            executionId,
            keywordId: kw.id,
            keywordText: kw.keywordText,
            matchType: kw.matchType,
            campaignId: kw.campaignId,
            campaignName: kw.campaignName,
            adGroupId: kw.adGroupId,
            adGroupName: kw.adGroupName,
            statusBefore: 'enabled',
            statusAfter: 'paused',
            bidBefore: kw.bid.toString(),
            actionType: 'pause',
            triggerReason: `高花费低转化: 花费$${kw.spend.toFixed(2)}, ACoS ${kw.acos.toFixed(1)}%`,
            spend: kw.spend.toString(),
            sales: kw.sales.toString(),
            clicks: kw.clicks,
            impressions: kw.impressions,
            orders: kw.orders,
            acos: kw.acos.toString(),
            roas: kw.roas.toString(),
            status: 'applied',
          } as any);
          
          keywordsPaused++;
          estimatedSpendSaved += kw.spend;
          
          details.push({
            keywordId: kw.id,
            keywordText: kw.keywordText,
            actionType: 'pause',
            statusBefore: 'enabled',
            statusAfter: 'paused',
            triggerReason: `高花费低转化: 花费$${kw.spend.toFixed(2)}, ACoS ${kw.acos.toFixed(1)}%`,
            metrics: {
              spend: kw.spend,
              sales: kw.sales,
              clicks: kw.clicks,
              acos: kw.acos,
              roas: kw.roas,
            },
          });
        } catch (err) {
          keywordsError++;
          errors.push(`暂停关键词 "${kw.keywordText}" 失败: ${err}`);
        }
      }
    }
    
    // 获取可以启用的关键词
    if (config.autoEnableEnabled) {
      const keywordsToEnable = await getKeywordsToEnable(accountId, config);
      
      for (const kw of keywordsToEnable) {
        try {
          // 更新关键词状态
          await db
            .update(keywords)
            .set({ keywordStatus: 'enabled' })
            .where(eq(keywords.id, kw.id));
          
          // 记录执行明细
          await db.insert(keywordAutoExecutionDetails).values({
            executionId,
            keywordId: kw.id,
            keywordText: kw.keywordText,
            matchType: kw.matchType,
            campaignId: kw.campaignId,
            campaignName: kw.campaignName,
            adGroupId: kw.adGroupId,
            adGroupName: kw.adGroupName,
            statusBefore: 'paused',
            statusAfter: 'enabled',
            bidBefore: kw.bid.toString(),
            actionType: 'enable',
            triggerReason: `潜力词恢复: ${kw.orders}个订单, ROAS ${kw.roas.toFixed(2)}`,
            spend: kw.spend.toString(),
            sales: kw.sales.toString(),
            clicks: kw.clicks,
            impressions: kw.impressions,
            orders: kw.orders,
            acos: kw.acos.toString(),
            roas: kw.roas.toString(),
            status: 'applied',
          } as any);
          
          keywordsEnabled++;
          
          details.push({
            keywordId: kw.id,
            keywordText: kw.keywordText,
            actionType: 'enable',
            statusBefore: 'paused',
            statusAfter: 'enabled',
            triggerReason: `潜力词恢复: ${kw.orders}个订单, ROAS ${kw.roas.toFixed(2)}`,
            metrics: {
              spend: kw.spend,
              sales: kw.sales,
              clicks: kw.clicks,
              acos: kw.acos,
              roas: kw.roas,
            },
          });
        } catch (err) {
          keywordsError++;
          errors.push(`启用关键词 "${kw.keywordText}" 失败: ${err}`);
        }
      }
    }
    
    // 更新执行历史记录
    await db
      .update(keywordAutoExecutionHistory)
      .set({
        executionEndAt: new Date().toISOString(),
        status: errors.length > 0 ? 'partially_completed' : 'completed',
        totalKeywordsAnalyzed: keywordsPaused + keywordsEnabled + keywordsSkipped + keywordsError,
        keywordsPaused,
        keywordsEnabled,
        keywordsSkipped,
        keywordsError,
        estimatedSpendSaved: estimatedSpendSaved.toString(),
        executionSummary: JSON.stringify({
          paused: keywordsPaused,
          enabled: keywordsEnabled,
          skipped: keywordsSkipped,
          errors: keywordsError,
          estimatedSpendSaved,
        }),
        errorMessage: errors.length > 0 ? errors.join('; ') : null,
      })
      .where(eq(keywordAutoExecutionHistory.id, executionId));
    
    // 发送通知
    if (config.notifyOnExecution && (keywordsPaused > 0 || keywordsEnabled > 0)) {
      await notifyOwner({
        title: '投放词自动优化执行完成',
        content: `自动暂停 ${keywordsPaused} 个高花费低转化投放词，预计节省花费 $${estimatedSpendSaved.toFixed(2)}。自动启用 ${keywordsEnabled} 个潜力词。`,
      });
    }
    
    return {
      success: true,
      executionId,
      keywordsPaused,
      keywordsEnabled,
      keywordsSkipped,
      keywordsError,
      estimatedSpendSaved,
      details,
      errors,
    };
  } catch (err) {
    // 更新执行历史为失败状态
    await db
      .update(keywordAutoExecutionHistory)
      .set({
        executionEndAt: new Date().toISOString(),
        status: 'failed',
        errorMessage: String(err),
      })
      .where(eq(keywordAutoExecutionHistory.id, executionId));
    
    return {
      success: false,
      executionId,
      keywordsPaused,
      keywordsEnabled,
      keywordsSkipped,
      keywordsError,
      estimatedSpendSaved,
      details,
      errors: [String(err)],
    };
  }
}

/**
 * 回滚最近的自动执行操作
 */
export async function rollbackLastExecution(
  accountId: number,
  executionId: number,
  reason: string,
  userId?: number
): Promise<{ success: boolean; rolledBackCount: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];
  let rolledBackCount = 0;
  
  try {
    // 获取执行明细
    const details = await db
      .select()
      .from(keywordAutoExecutionDetails)
      .where(
        and(
          eq(keywordAutoExecutionDetails.executionId, executionId),
          eq(keywordAutoExecutionDetails.status, 'applied')
        )
      );
    
    for (const detail of details) {
      try {
        // 恢复原状态
        await db
          .update(keywords)
          .set({ keywordStatus: detail.statusBefore })
          .where(eq(keywords.id, detail.keywordId));
        
        // 更新明细状态
        await db
          .update(keywordAutoExecutionDetails)
          .set({
            status: 'rolled_back',
            rolledBackAt: new Date().toISOString(),
            rollbackReason: reason,
          })
          .where(eq(keywordAutoExecutionDetails.id, detail.id));
        
        rolledBackCount++;
      } catch (err) {
        errors.push(`回滚关键词 "${detail.keywordText}" 失败: ${err}`);
      }
    }
    
    // 更新执行历史状态
    await db
      .update(keywordAutoExecutionHistory)
      .set({
        status: 'rolled_back',
        rollbackTriggeredAt: new Date().toISOString(),
        rollbackReason: reason,
        rollbackBy: userId,
      })
      .where(eq(keywordAutoExecutionHistory.id, executionId));
    
    // 获取配置并发送通知
    const config = await getAutoExecutionConfig(accountId);
    if (config?.notifyOnRollback) {
      await notifyOwner({
        title: '投放词自动优化已回滚',
        content: `已回滚 ${rolledBackCount} 个投放词的状态变更。回滚原因: ${reason}`,
      });
    }
    
    return { success: true, rolledBackCount, errors };
  } catch (err) {
    return { success: false, rolledBackCount, errors: [String(err)] };
  }
}

/**
 * 获取执行历史列表
 */
export async function getExecutionHistory(
  accountId: number,
  limit: number = 20
): Promise<any[]> {
  const db = getDb();
  
  const history = await db
    .select()
    .from(keywordAutoExecutionHistory)
    .where(eq(keywordAutoExecutionHistory.accountId, accountId))
    .orderBy(desc(keywordAutoExecutionHistory.executionStartAt))
    .limit(limit);
  
  return history;
}

/**
 * 获取执行明细
 */
export async function getExecutionDetails(executionId: number): Promise<any[]> {
  const db = getDb();
  
  const details = await db
    .select()
    .from(keywordAutoExecutionDetails)
    .where(eq(keywordAutoExecutionDetails.executionId, executionId))
    .orderBy(desc(keywordAutoExecutionDetails.createdAt));
  
  return details;
}

/**
 * 预览自动执行操作（不实际执行）
 */
export async function previewAutoActions(accountId: number): Promise<{
  keywordsToPause: KeywordPerformance[];
  keywordsToEnable: KeywordPerformance[];
  estimatedSpendSaved: number;
}> {
  const config = await getAutoExecutionConfig(accountId);
  
  if (!config || !config.isEnabled) {
    return {
      keywordsToPause: [],
      keywordsToEnable: [],
      estimatedSpendSaved: 0,
    };
  }
  
  const keywordsToPause = config.autoPauseEnabled 
    ? await getKeywordsToPause(accountId, config) 
    : [];
  const keywordsToEnable = config.autoEnableEnabled 
    ? await getKeywordsToEnable(accountId, config) 
    : [];
  
  const estimatedSpendSaved = keywordsToPause.reduce((sum, kw) => sum + kw.spend, 0);
  
  return {
    keywordsToPause,
    keywordsToEnable,
    estimatedSpendSaved,
  };
}
