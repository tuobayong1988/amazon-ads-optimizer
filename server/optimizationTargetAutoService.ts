/**
 * 优化目标自动执行服务
 * 当优化目标启用时，自动执行分时预算分配和投放词自动优化
 */

import { getDb } from "./_core/db";
import { 
  performanceGroups, 
  campaigns, 
  hourlyPerformance,
  dailyPerformance,
  keywords,
  adGroups
} from "../drizzle/schema";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

// 时段表现数据接口
interface HourlyPerformanceData {
  hour: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
  roas: number;
  conversionRate: number;
}

// 分时预算分配结果接口
interface DaypartingAllocation {
  hour: number;
  budgetPercent: number;
  budgetAmount: number;
  expectedRoas: number;
  priority: 'low' | 'normal' | 'high' | 'critical';
  reason: string;
}

// 优化目标配置接口
interface OptimizationTargetConfig {
  id: number;
  name: string;
  accountId: number;
  status: string;
  optimizationGoal: string;
  targetAcos: number | null;
  targetRoas: number | null;
  dailySpendLimit: number | null;
  
  // 分时预算配置
  daypartingEnabled: boolean;
  daypartingStrategy: string;
  daypartingAutoAdjust: boolean;
  daypartingMinBudgetPercent: number;
  daypartingMaxBudgetPercent: number;
  daypartingReserveBudget: number;
  
  // 投放词自动执行配置
  keywordAutoEnabled: boolean;
  keywordAutoPauseEnabled: boolean;
  keywordAutoEnableEnabled: boolean;
  keywordPauseMinSpend: number;
  keywordPauseMaxAcos: number;
}

/**
 * 获取优化目标配置
 */
export async function getOptimizationTargetConfig(targetId: number): Promise<OptimizationTargetConfig | null> {
  const db = getDb();
  const targets = await db
    .select()
    .from(performanceGroups)
    .where(eq(performanceGroups.id, targetId))
    .limit(1);
  
  if (targets.length === 0) return null;
  
  const target = targets[0];
  return {
    id: target.id,
    name: target.name,
    accountId: target.accountId,
    status: target.status || 'active',
    optimizationGoal: target.optimizationGoal || 'maximize_sales',
    targetAcos: target.targetAcos ? parseFloat(target.targetAcos) : null,
    targetRoas: target.targetRoas ? parseFloat(target.targetRoas) : null,
    dailySpendLimit: target.dailySpendLimit ? parseFloat(target.dailySpendLimit) : null,
    daypartingEnabled: target.daypartingEnabled === 1,
    daypartingStrategy: target.daypartingStrategy || 'performance_based',
    daypartingAutoAdjust: target.daypartingAutoAdjust === 1,
    daypartingMinBudgetPercent: parseFloat(target.daypartingMinBudgetPercent || '2'),
    daypartingMaxBudgetPercent: parseFloat(target.daypartingMaxBudgetPercent || '15'),
    daypartingReserveBudget: parseFloat(target.daypartingReserveBudget || '10'),
    keywordAutoEnabled: target.keywordAutoEnabled === 1,
    keywordAutoPauseEnabled: target.keywordAutoPauseEnabled === 1,
    keywordAutoEnableEnabled: target.keywordAutoEnableEnabled === 1,
    keywordPauseMinSpend: parseFloat(target.keywordPauseMinSpend || '10'),
    keywordPauseMaxAcos: parseFloat(target.keywordPauseMaxAcos || '100'),
  };
}

/**
 * 获取优化目标下的所有广告活动ID
 */
export async function getTargetCampaignIds(targetId: number): Promise<number[]> {
  const db = getDb();
  
  // 假设有一个关联表，这里简化处理，直接从campaigns表获取
  // 实际应该从performance_group_campaigns关联表获取
  const campaignData = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.performanceGroupId, targetId));
  
  return campaignData.map(c => c.id);
}

/**
 * 分析各时段的历史表现数据
 */
export async function analyzeHourlyPerformance(
  accountId: number,
  campaignIds: number[],
  days: number = 14
): Promise<HourlyPerformanceData[]> {
  const db = getDb();
  
  // 计算日期范围
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  // 获取各时段的聚合数据
  const hourlyData = await db
    .select({
      hour: hourlyPerformance.hour,
      impressions: sql<number>`SUM(${hourlyPerformance.impressions})`,
      clicks: sql<number>`SUM(${hourlyPerformance.clicks})`,
      spend: sql<number>`SUM(${hourlyPerformance.spend})`,
      sales: sql<number>`SUM(${hourlyPerformance.sales})`,
      orders: sql<number>`SUM(${hourlyPerformance.orders})`,
    })
    .from(hourlyPerformance)
    .where(
      and(
        eq(hourlyPerformance.accountId, accountId),
        inArray(hourlyPerformance.campaignId, campaignIds.map(String)),
        gte(hourlyPerformance.date, startDate.toISOString().split('T')[0]),
        lte(hourlyPerformance.date, endDate.toISOString().split('T')[0])
      )
    )
    .groupBy(hourlyPerformance.hour);
  
  // 转换为标准格式
  const result: HourlyPerformanceData[] = [];
  
  for (let hour = 0; hour < 24; hour++) {
    const data = hourlyData.find(d => d.hour === hour);
    
    if (data) {
      const spend = Number(data.spend) || 0;
      const sales = Number(data.sales) || 0;
      const clicks = Number(data.clicks) || 0;
      const orders = Number(data.orders) || 0;
      
      result.push({
        hour,
        impressions: Number(data.impressions) || 0,
        clicks,
        spend,
        sales,
        orders,
        acos: sales > 0 ? (spend / sales) * 100 : 0,
        roas: spend > 0 ? sales / spend : 0,
        conversionRate: clicks > 0 ? (orders / clicks) * 100 : 0,
      });
    } else {
      result.push({
        hour,
        impressions: 0,
        clicks: 0,
        spend: 0,
        sales: 0,
        orders: 0,
        acos: 0,
        roas: 0,
        conversionRate: 0,
      });
    }
  }
  
  return result;
}

/**
 * 基于历史表现计算分时预算分配
 */
export function calculateDaypartingAllocation(
  hourlyData: HourlyPerformanceData[],
  config: OptimizationTargetConfig,
  totalBudget: number
): DaypartingAllocation[] {
  const allocations: DaypartingAllocation[] = [];
  
  // 计算总销售额和总花费
  const totalSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
  const totalSpend = hourlyData.reduce((sum, h) => sum + h.spend, 0);
  
  // 预留预算
  const reserveBudget = totalBudget * (config.daypartingReserveBudget / 100);
  const allocatableBudget = totalBudget - reserveBudget;
  
  if (config.daypartingStrategy === 'equal') {
    // 平均分配策略
    const equalPercent = 100 / 24;
    const equalAmount = allocatableBudget / 24;
    
    for (let hour = 0; hour < 24; hour++) {
      allocations.push({
        hour,
        budgetPercent: equalPercent,
        budgetAmount: equalAmount,
        expectedRoas: hourlyData[hour].roas,
        priority: 'normal',
        reason: '平均分配策略',
      });
    }
  } else {
    // 基于表现的分配策略
    // 计算每个时段的权重分数
    const scores: { hour: number; score: number }[] = [];
    
    for (const hourData of hourlyData) {
      let score = 0;
      
      switch (config.optimizationGoal) {
        case 'maximize_sales':
          // 销售额越高，分数越高
          score = totalSales > 0 ? (hourData.sales / totalSales) * 100 : 0;
          break;
        case 'target_acos':
          // ACoS越低且有销售，分数越高
          if (hourData.sales > 0 && config.targetAcos) {
            const acosRatio = config.targetAcos / Math.max(hourData.acos, 1);
            score = Math.min(acosRatio, 2) * (hourData.sales / Math.max(totalSales, 1)) * 100;
          }
          break;
        case 'target_roas':
          // ROAS越高，分数越高
          if (config.targetRoas && hourData.roas > 0) {
            const roasRatio = hourData.roas / config.targetRoas;
            score = Math.min(roasRatio, 2) * (hourData.sales / Math.max(totalSales, 1)) * 100;
          }
          break;
        default:
          // 综合考虑销售额和ROAS
          const salesWeight = totalSales > 0 ? (hourData.sales / totalSales) * 50 : 0;
          const roasWeight = hourData.roas > 0 ? Math.min(hourData.roas / 3, 1) * 50 : 0;
          score = salesWeight + roasWeight;
      }
      
      scores.push({ hour: hourData.hour, score });
    }
    
    // 归一化分数
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    
    for (const { hour, score } of scores) {
      let budgetPercent = totalScore > 0 ? (score / totalScore) * 100 : 100 / 24;
      
      // 应用最小/最大限制
      budgetPercent = Math.max(budgetPercent, config.daypartingMinBudgetPercent);
      budgetPercent = Math.min(budgetPercent, config.daypartingMaxBudgetPercent);
      
      const budgetAmount = allocatableBudget * (budgetPercent / 100);
      const hourData = hourlyData[hour];
      
      // 确定优先级
      let priority: 'low' | 'normal' | 'high' | 'critical' = 'normal';
      if (hourData.roas >= 3) priority = 'critical';
      else if (hourData.roas >= 2) priority = 'high';
      else if (hourData.roas < 1) priority = 'low';
      
      // 生成原因说明
      let reason = '';
      if (hourData.sales > 0) {
        reason = `ROAS ${hourData.roas.toFixed(2)}, ACoS ${hourData.acos.toFixed(1)}%, 销售$${hourData.sales.toFixed(2)}`;
      } else {
        reason = '无历史销售数据，使用基础分配';
      }
      
      allocations.push({
        hour,
        budgetPercent,
        budgetAmount,
        expectedRoas: hourData.roas,
        priority,
        reason,
      });
    }
    
    // 重新归一化确保总和为100%
    const totalPercent = allocations.reduce((sum, a) => sum + a.budgetPercent, 0);
    if (totalPercent > 0) {
      const scale = (100 - config.daypartingReserveBudget) / totalPercent;
      for (const allocation of allocations) {
        allocation.budgetPercent *= scale;
        allocation.budgetAmount = allocatableBudget * (allocation.budgetPercent / 100);
      }
    }
  }
  
  return allocations;
}

/**
 * 执行优化目标的自动优化任务
 */
export async function executeOptimizationTargetAuto(targetId: number): Promise<{
  success: boolean;
  daypartingResult?: {
    allocations: DaypartingAllocation[];
    totalBudget: number;
  };
  keywordResult?: {
    paused: number;
    enabled: number;
    estimatedSavings: number;
  };
  errors: string[];
}> {
  const errors: string[] = [];
  
  try {
    const config = await getOptimizationTargetConfig(targetId);
    if (!config) {
      return { success: false, errors: ['优化目标不存在'] };
    }
    
    if (config.status !== 'active') {
      return { success: false, errors: ['优化目标未激活'] };
    }
    
    const campaignIds = await getTargetCampaignIds(targetId);
    if (campaignIds.length === 0) {
      return { success: false, errors: ['优化目标下没有广告活动'] };
    }
    
    let daypartingResult;
    let keywordResult;
    
    // 执行分时预算分配
    if (config.daypartingEnabled) {
      try {
        const hourlyData = await analyzeHourlyPerformance(config.accountId, campaignIds);
        const totalBudget = config.dailySpendLimit || 100; // 默认100美元
        const allocations = calculateDaypartingAllocation(hourlyData, config, totalBudget);
        
        // 更新上次分析时间
        const db = getDb();
        await db
          .update(performanceGroups)
          .set({ 
            daypartingLastAnalysis: new Date().toISOString(),
            daypartingLastExecution: new Date().toISOString(),
          })
          .where(eq(performanceGroups.id, targetId));
        
        daypartingResult = { allocations, totalBudget };
      } catch (err) {
        errors.push(`分时预算分配失败: ${err}`);
      }
    }
    
    // 执行投放词自动优化
    if (config.keywordAutoEnabled) {
      try {
        const result = await executeKeywordAutoForTarget(targetId, config, campaignIds);
        keywordResult = result;
        
        // 更新上次执行时间
        const db = getDb();
        await db
          .update(performanceGroups)
          .set({ keywordLastAutoExecution: new Date().toISOString() })
          .where(eq(performanceGroups.id, targetId));
      } catch (err) {
        errors.push(`投放词自动优化失败: ${err}`);
      }
    }
    
    // 发送通知（仅在有实际操作时）
    if (daypartingResult || (keywordResult && (keywordResult.paused > 0 || keywordResult.enabled > 0))) {
      const messages: string[] = [];
      
      if (daypartingResult) {
        const highPriorityHours = daypartingResult.allocations
          .filter(a => a.priority === 'critical' || a.priority === 'high')
          .map(a => `${a.hour}:00`)
          .join(', ');
        messages.push(`分时预算分配完成，高优先级时段: ${highPriorityHours || '无'}`);
      }
      
      if (keywordResult) {
        if (keywordResult.paused > 0) {
          messages.push(`自动暂停 ${keywordResult.paused} 个低效投放词，预计节省 $${keywordResult.estimatedSavings.toFixed(2)}`);
        }
        if (keywordResult.enabled > 0) {
          messages.push(`自动启用 ${keywordResult.enabled} 个潜力投放词`);
        }
      }
      
      if (messages.length > 0) {
        await notifyOwner({
          title: `优化目标"${config.name}"自动优化完成`,
          content: messages.join('\n'),
        });
      }
    }
    
    return {
      success: errors.length === 0,
      daypartingResult,
      keywordResult,
      errors,
    };
  } catch (err) {
    return { success: false, errors: [String(err)] };
  }
}

/**
 * 执行优化目标下的投放词自动优化
 */
async function executeKeywordAutoForTarget(
  targetId: number,
  config: OptimizationTargetConfig,
  campaignIds: number[]
): Promise<{ paused: number; enabled: number; estimatedSavings: number }> {
  const db = getDb();
  let paused = 0;
  let enabled = 0;
  let estimatedSavings = 0;
  
  // 获取优化目标下所有广告活动的关键词
  const keywordData = await db
    .select({
      id: keywords.id,
      keywordText: keywords.keywordText,
      status: keywords.keywordStatus,
      spend: keywords.spend,
      sales: keywords.sales,
      clicks: keywords.clicks,
      orders: keywords.orders,
    })
    .from(keywords)
    .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
    .where(inArray(adGroups.campaignId, campaignIds));
  
  // 执行自动暂停
  if (config.keywordAutoPauseEnabled) {
    for (const kw of keywordData) {
      if (kw.status !== 'enabled') continue;
      
      const spend = parseFloat(kw.spend || '0');
      const sales = parseFloat(kw.sales || '0');
      const orders = kw.orders || 0;
      const acos = sales > 0 ? (spend / sales) * 100 : (spend > 0 ? 999 : 0);
      
      // 检查是否满足暂停条件
      const shouldPause = 
        spend >= config.keywordPauseMinSpend && 
        (orders === 0 || acos > config.keywordPauseMaxAcos);
      
      if (shouldPause) {
        await db
          .update(keywords)
          .set({ keywordStatus: 'paused' })
          .where(eq(keywords.id, kw.id));
        
        paused++;
        estimatedSavings += spend;
      }
    }
  }
  
  // 执行自动启用
  if (config.keywordAutoEnableEnabled) {
    for (const kw of keywordData) {
      if (kw.status !== 'paused') continue;
      
      const spend = parseFloat(kw.spend || '0');
      const sales = parseFloat(kw.sales || '0');
      const orders = kw.orders || 0;
      const roas = spend > 0 ? sales / spend : 0;
      
      // 检查是否满足启用条件（有转化且ROAS达标）
      const shouldEnable = orders >= 2 && roas >= 2;
      
      if (shouldEnable) {
        await db
          .update(keywords)
          .set({ keywordStatus: 'enabled' })
          .where(eq(keywords.id, kw.id));
        
        enabled++;
      }
    }
  }
  
  return { paused, enabled, estimatedSavings };
}

/**
 * 获取优化目标的分时预算分配预览
 */
export async function previewDaypartingAllocation(targetId: number): Promise<{
  allocations: DaypartingAllocation[];
  hourlyData: HourlyPerformanceData[];
  totalBudget: number;
} | null> {
  const config = await getOptimizationTargetConfig(targetId);
  if (!config) return null;
  
  const campaignIds = await getTargetCampaignIds(targetId);
  if (campaignIds.length === 0) return null;
  
  const hourlyData = await analyzeHourlyPerformance(config.accountId, campaignIds);
  const totalBudget = config.dailySpendLimit || 100;
  const allocations = calculateDaypartingAllocation(hourlyData, config, totalBudget);
  
  return { allocations, hourlyData, totalBudget };
}

/**
 * 批量执行所有激活的优化目标的自动优化
 */
export async function executeAllActiveTargets(): Promise<{
  total: number;
  success: number;
  failed: number;
  results: { targetId: number; targetName: string; success: boolean; errors: string[] }[];
}> {
  const db = getDb();
  
  // 获取所有激活的优化目标
  const activeTargets = await db
    .select({ id: performanceGroups.id, name: performanceGroups.name })
    .from(performanceGroups)
    .where(eq(performanceGroups.status, 'active'));
  
  const results: { targetId: number; targetName: string; success: boolean; errors: string[] }[] = [];
  let success = 0;
  let failed = 0;
  
  for (const target of activeTargets) {
    const result = await executeOptimizationTargetAuto(target.id);
    
    results.push({
      targetId: target.id,
      targetName: target.name,
      success: result.success,
      errors: result.errors,
    });
    
    if (result.success) {
      success++;
    } else {
      failed++;
    }
  }
  
  return {
    total: activeTargets.length,
    success,
    failed,
    results,
  };
}
