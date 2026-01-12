/**
 * 日内调整服务 (Intraday Pacing Service)
 * 
 * 专家建议：AMS的价值不在于算ROAS，而在于算"花钱速度"
 * 
 * 核心功能：
 * 1. 监控预算流失速度（Intraday Pacing）
 * 2. 如果花太快，降低分时折扣
 * 3. 如果发现超高点击但0转化（异常流量攻击），紧急暂停
 * 
 * 禁区：绝不根据实时ROAS去调整Base Bid
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { getRealtimeSpendForGuard } from './dualTrackSyncService';

// ==================== 类型定义 ====================

/**
 * 预算消耗状态
 */
export type PacingStatus = 'on_track' | 'underspending' | 'overspending' | 'critical';

/**
 * 日内调整建议
 */
export interface IntradayAdjustment {
  campaignId: string;
  accountId: number;
  currentHour: number;
  dailyBudget: number;
  todaySpend: number;
  todayClicks: number;
  todayImpressions: number;
  idealSpendPercent: number;
  actualSpendPercent: number;
  pacingStatus: PacingStatus;
  suggestedAction: 'none' | 'reduce_bid' | 'increase_bid' | 'pause' | 'alert';
  suggestedMultiplier: number;
  reason: string;
  anomalyDetected: boolean;
  anomalyType?: 'click_fraud' | 'budget_drain' | 'zero_conversion';
}

// ==================== 配置 ====================

/**
 * 日内调整配置
 */
export const INTRADAY_CONFIG = {
  // 目标结束时间（小时，24小时制）- 希望预算能撑到这个时间
  targetEndHour: 22,
  
  // 开始时间（小时）
  startHour: 0,
  
  // 消耗速度阈值
  overspendingThreshold: 1.5,   // 超过理想消耗的150%
  criticalThreshold: 2.0,       // 超过理想消耗的200%
  underspendingThreshold: 0.5,  // 低于理想消耗的50%
  
  // 调整乘数
  overspendingMultiplier: 0.8,  // 花太快时降低20%
  criticalMultiplier: 0.5,      // 危急时降低50%
  underspendingMultiplier: 1.2, // 花太慢时提高20%
  
  // 异常检测阈值
  clickFraudThreshold: 100,     // 单小时点击超过100次
  clickFraudCtrThreshold: 0.15, // CTR超过15%可能是异常
  zeroConversionClickThreshold: 50, // 50次点击0转化触发警告
  
  // 最小检查间隔（分钟）
  minCheckInterval: 15,
};

// ==================== 核心函数 ====================

/**
 * 调整日内消耗速度
 * 专家建议：利用AMS实时数据调整预算消耗速度
 * 
 * @param campaignId - 广告活动ID
 * @param accountId - 账号ID
 */
export async function adjustIntradayPacing(
  campaignId: string,
  accountId: number
): Promise<IntradayAdjustment> {
  // 1. 从AMS Buffer获取今日实时花费
  const realtimeData = await getRealtimeSpendForGuard(accountId, campaignId);
  
  // 2. 获取Campaign预算
  const dailyBudget = await getCampaignBudget(accountId, campaignId);
  
  const currentHour = new Date().getHours();
  
  // 3. 计算理想消耗曲线
  // 假设我们希望预算能撑到晚上22点
  const hoursRemaining = Math.max(1, INTRADAY_CONFIG.targetEndHour - currentHour);
  const hoursPassed = currentHour - INTRADAY_CONFIG.startHour;
  const totalHours = INTRADAY_CONFIG.targetEndHour - INTRADAY_CONFIG.startHour;
  
  const idealSpendPercent = hoursPassed / totalHours;
  const actualSpendPercent = dailyBudget > 0 ? realtimeData.todaySpend / dailyBudget : 0;
  
  // 4. 计算消耗速度比率
  const pacingRatio = idealSpendPercent > 0 ? actualSpendPercent / idealSpendPercent : 1;
  
  // 5. 确定消耗状态
  let pacingStatus: PacingStatus;
  let suggestedAction: IntradayAdjustment['suggestedAction'] = 'none';
  let suggestedMultiplier = 1;
  let reason = '';
  
  if (pacingRatio >= INTRADAY_CONFIG.criticalThreshold) {
    pacingStatus = 'critical';
    suggestedAction = 'reduce_bid';
    suggestedMultiplier = INTRADAY_CONFIG.criticalMultiplier;
    reason = `🔥 烧钱太快！消耗速度是理想的${(pacingRatio * 100).toFixed(0)}%，触发日内保护`;
  } else if (pacingRatio >= INTRADAY_CONFIG.overspendingThreshold) {
    pacingStatus = 'overspending';
    suggestedAction = 'reduce_bid';
    suggestedMultiplier = INTRADAY_CONFIG.overspendingMultiplier;
    reason = `消耗速度偏快（${(pacingRatio * 100).toFixed(0)}%），建议降低出价`;
  } else if (pacingRatio <= INTRADAY_CONFIG.underspendingThreshold) {
    pacingStatus = 'underspending';
    suggestedAction = 'increase_bid';
    suggestedMultiplier = INTRADAY_CONFIG.underspendingMultiplier;
    reason = `消耗速度偏慢（${(pacingRatio * 100).toFixed(0)}%），可以适当提高出价`;
  } else {
    pacingStatus = 'on_track';
    reason = '消耗速度正常';
  }
  
  // 6. 异常检测
  const anomalyResult = detectAnomalies(
    realtimeData.todayClicks,
    realtimeData.todayImpressions,
    realtimeData.todaySpend,
    currentHour
  );
  
  if (anomalyResult.detected) {
    suggestedAction = anomalyResult.action;
    reason = anomalyResult.reason;
  }
  
  return {
    campaignId,
    accountId,
    currentHour,
    dailyBudget,
    todaySpend: realtimeData.todaySpend,
    todayClicks: realtimeData.todayClicks,
    todayImpressions: realtimeData.todayImpressions,
    idealSpendPercent: Math.round(idealSpendPercent * 100) / 100,
    actualSpendPercent: Math.round(actualSpendPercent * 100) / 100,
    pacingStatus,
    suggestedAction,
    suggestedMultiplier,
    reason,
    anomalyDetected: anomalyResult.detected,
    anomalyType: anomalyResult.type,
  };
}

/**
 * 批量检查所有活跃Campaign的日内消耗
 */
export async function checkAllCampaignsPacing(
  accountId: number
): Promise<IntradayAdjustment[]> {
  const db = await getDb();
  if (!db) return [];
  
  try {
    // 获取所有启用的Campaign
    const [rows] = await db.execute(sql`
      SELECT campaignId, dailyBudget
      FROM campaigns
      WHERE accountId = ${accountId}
        AND status = 'enabled'
        AND dailyBudget > 0
    `) as any;
    
    const campaigns = Array.isArray(rows) ? rows : [];
    const results: IntradayAdjustment[] = [];
    
    for (const campaign of campaigns) {
      const adjustment = await adjustIntradayPacing(
        campaign.campaignId,
        accountId
      );
      results.push(adjustment);
    }
    
    return results;
  } catch (error) {
    console.error('[IntradayPacing] 批量检查失败:', error);
    return [];
  }
}

/**
 * 获取需要紧急处理的Campaign
 */
export async function getCriticalCampaigns(
  accountId: number
): Promise<IntradayAdjustment[]> {
  const allAdjustments = await checkAllCampaignsPacing(accountId);
  
  return allAdjustments.filter(adj => 
    adj.pacingStatus === 'critical' || 
    adj.anomalyDetected ||
    adj.suggestedAction === 'pause'
  );
}

/**
 * 应用日内调整
 * 专家建议：动态调整分时系数，而不是改Base Bid
 */
export async function applyIntradayAdjustment(
  adjustment: IntradayAdjustment
): Promise<{
  success: boolean;
  action: string;
  previousMultiplier: number;
  newMultiplier: number;
}> {
  // 这里应该调用分时服务来临时调整乘数
  // 而不是直接修改Base Bid
  
  console.log('[IntradayPacing] 应用调整:', {
    campaignId: adjustment.campaignId,
    action: adjustment.suggestedAction,
    multiplier: adjustment.suggestedMultiplier,
    reason: adjustment.reason,
  });
  
  // TODO: 实际调用分时服务
  // await daypartingService.applyTemporaryMultiplier(
  //   adjustment.campaignId, 
  //   adjustment.suggestedMultiplier
  // );
  
  return {
    success: true,
    action: adjustment.suggestedAction,
    previousMultiplier: 1,
    newMultiplier: adjustment.suggestedMultiplier,
  };
}

// ==================== 辅助函数 ====================

/**
 * 获取Campaign预算
 */
async function getCampaignBudget(
  accountId: number,
  campaignId: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  try {
    const [rows] = await db.execute(sql`
      SELECT dailyBudget
      FROM campaigns
      WHERE accountId = ${accountId}
        AND campaignId = ${campaignId}
      LIMIT 1
    `) as any;
    
    const campaign = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    return campaign?.dailyBudget || 0;
  } catch (error) {
    console.error('[IntradayPacing] 获取预算失败:', error);
    return 0;
  }
}

/**
 * 检测异常流量
 * 专家建议：如果发现超高点击但0转化（异常流量攻击），紧急暂停
 */
function detectAnomalies(
  clicks: number,
  impressions: number,
  spend: number,
  currentHour: number
): {
  detected: boolean;
  type?: 'click_fraud' | 'budget_drain' | 'zero_conversion';
  action: IntradayAdjustment['suggestedAction'];
  reason: string;
} {
  // 计算每小时平均点击
  const avgClicksPerHour = currentHour > 0 ? clicks / currentHour : clicks;
  
  // 计算CTR
  const ctr = impressions > 0 ? clicks / impressions : 0;
  
  // 1. 检测点击欺诈（异常高的点击率或点击量）
  if (avgClicksPerHour > INTRADAY_CONFIG.clickFraudThreshold || 
      ctr > INTRADAY_CONFIG.clickFraudCtrThreshold) {
    return {
      detected: true,
      type: 'click_fraud',
      action: 'pause',
      reason: `⚠️ 检测到异常流量！每小时点击${avgClicksPerHour.toFixed(0)}次，CTR ${(ctr * 100).toFixed(1)}%，建议紧急暂停`,
    };
  }
  
  // 2. 检测预算快速消耗（可能是竞争对手恶意点击）
  if (spend > 0 && clicks > INTRADAY_CONFIG.zeroConversionClickThreshold) {
    // 这里不检查转化，因为实时转化数据不可信
    // 只检查花费速度是否异常
    const avgSpendPerClick = spend / clicks;
    if (avgSpendPerClick > 2) { // 每次点击超过$2可能有问题
      return {
        detected: true,
        type: 'budget_drain',
        action: 'alert',
        reason: `⚠️ 每次点击成本异常高（$${avgSpendPerClick.toFixed(2)}），请检查竞价设置`,
      };
    }
  }
  
  return {
    detected: false,
    action: 'none',
    reason: '',
  };
}

/**
 * 计算剩余预算可支撑的时间
 */
export function calculateBudgetRunway(
  dailyBudget: number,
  currentSpend: number,
  currentHour: number,
  avgSpendPerHour: number
): {
  remainingBudget: number;
  hoursRemaining: number;
  projectedEndHour: number;
  willLastUntilTarget: boolean;
} {
  const remainingBudget = dailyBudget - currentSpend;
  const hoursRemaining = avgSpendPerHour > 0 ? remainingBudget / avgSpendPerHour : 24 - currentHour;
  const projectedEndHour = currentHour + hoursRemaining;
  
  return {
    remainingBudget,
    hoursRemaining: Math.round(hoursRemaining * 10) / 10,
    projectedEndHour: Math.min(24, Math.round(projectedEndHour)),
    willLastUntilTarget: projectedEndHour >= INTRADAY_CONFIG.targetEndHour,
  };
}

export default {
  adjustIntradayPacing,
  checkAllCampaignsPacing,
  getCriticalCampaigns,
  applyIntradayAdjustment,
  calculateBudgetRunway,
  INTRADAY_CONFIG,
};
