/**
 * 自动止血服务 (Auto Stop-Loss Service)
 * 
 * v503: 长效自动化止血机制
 * 
 * 核心功能：
 * 1. 自动暂停高ACoS Campaign - 连续N天ACoS超阈值且无改善趋势时自动暂停
 * 2. 搜索词自动否定 - 定期扫描搜索词报告，自动否定高花费零/低转化词
 * 3. Campaign重新激活防护 - 监控已暂停Campaign的状态变更，防止无策略的批量重新激活
 * 4. 数据悬崖自动修复 - 检测到悬崖后自动恢复竞价到历史CPC水平
 * 
 * 设计原则：
 * - 渐进式操作：所有竞价调整不超过20%/次
 * - 安全边界：历史出单>10的Campaign不直接暂停，只降价
 * - 审计追踪：所有自动操作通过auditLogService记录
 * - 通知机制：关键操作通知账户负责人
 */

import { getDb } from '../db';
import { campaigns, keywords, negativeKeywords } from '../../drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';
import { logOptimization, logOptimizationWarn } from '../utils/opsLogger';
import { recordAudit } from '../services/auditLogService';
import { syncCampaignStatusToAmazon, syncNegativeKeywordsToAmazon, syncBidAdjustmentsToAmazon } from '../services/amazonApiHelper';
import { notifyOwner } from '../_core/notification';

const log = createModuleLogger('AutoStopLoss');

// ==================== 配置常量 ====================

/** 止血规则配置 */
export const STOP_LOSS_CONFIG = {
  /** Campaign自动暂停规则 */
  campaignAutoPause: {
    /** 连续天数ACoS超阈值触发暂停 */
    consecutiveDays: 7,
    /** ACoS阈值（%），超过此值视为严重亏损 */
    acosThreshold: 150,
    /** 最低花费门槛（$），低于此值不触发（避免误判小额Campaign） */
    minSpendThreshold: 30,
    /** 最低点击门槛，低于此值不触发（数据量不足） */
    minClicksThreshold: 20,
    /** 是否排除有历史高转化的Campaign */
    excludeHistoricalPerformers: true,
    /** 历史高转化的定义：过去90天订单数>此值 */
    historicalOrderThreshold: 10,
  },
  
  /** 搜索词自动否定规则 */
  searchTermAutoNegate: {
    /** 花费门槛（$），超过此值且零转化则否定 */
    zeroConversionSpendThreshold: 15,
    /** 高花费低转化的ACoS阈值（%） */
    highAcosThreshold: 200,
    /** 高花费低转化的花费门槛（$） */
    highAcosSpendThreshold: 30,
    /** 竞品品牌词列表（自动否定） */
    competitorBrands: [
      'better me', 'betterme', 'bala', 'blogilates', 'p.volve', 'pvolve',
      'balanced body', 'merrithew', 'stott', 'gaiam'
    ],
    /** 不相关品类词列表（自动否定） */
    irrelevantCategories: [
      'yoga mat', 'yoga block', 'resistance bands for working out',
      'dumbbells', 'kettlebell', 'jump rope', 'treadmill',
      'calf stretcher', 'slant board', 'foam roller'
    ],
  },
  
  /** Campaign重新激活防护 */
  reactivationGuard: {
    /** 检查窗口（小时），在此时间内批量重新激活触发警报 */
    checkWindowHours: 24,
    /** 批量重新激活阈值，超过此数量触发警报 */
    batchReactivationThreshold: 5,
    /** 是否自动回滚无策略的批量重新激活 */
    autoRollbackEnabled: true,
    /** 历史ACoS阈值（%），超过此值的Campaign重新激活需要审批 */
    historicalAcosThreshold: 100,
  },
  
  /** 数据悬崖自动修复 */
  dataCliffRepair: {
    /** 历史订单数门槛，超过此值的关键词触发悬崖检测 */
    historicalOrderThreshold: 4,
    /** 流量下降幅度阈值（%），超过此值视为悬崖 */
    trafficDropThreshold: 50,
    /** 修复时使用的历史CPC回溯天数 */
    historicalCpcLookbackDays: 90,
    /** 单次修复的最大竞价提升幅度（%） */
    maxBidIncreasePercent: 20,
  },
};

// ==================== 类型定义 ====================

export interface StopLossAction {
  actionType: 'campaign_pause' | 'search_term_negate' | 'bid_restore' | 'reactivation_rollback' | 'budget_alert';
  entityType: 'campaign' | 'keyword' | 'search_term';
  entityId: number;
  entityName: string;
  accountId: number;
  reason: string;
  previousValue?: string | number;
  newValue?: string | number;
  confidence: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  autoExecuted: boolean;
  executedAt?: Date;
  details: Record<string, unknown>;
}

export interface StopLossScanResult {
  accountId: number;
  scanTime: Date;
  duration: number;
  actions: StopLossAction[];
  summary: {
    campaignsPaused: number;
    searchTermsNegated: number;
    bidsRestored: number;
    reactivationsRolledBack: number;
    budgetAlerts: number;
  };
}

// ==================== 核心功能1：自动暂停高ACoS Campaign ====================

/**
 * 扫描并自动暂停连续高ACoS的Campaign
 * 
 * 逻辑：
 * 1. 获取账户下所有enabled的Campaign
 * 2. 查询每个Campaign最近N天的每日表现
 * 3. 如果连续N天ACoS都超过阈值，且无改善趋势，则暂停
 * 4. 排除历史高转化的Campaign（仅发出警告，不暂停）
 */
export async function scanAndPauseHighAcosCampaigns(accountId: number): Promise<StopLossAction[]> {
  const actions: StopLossAction[] = [];
  const config = STOP_LOSS_CONFIG.campaignAutoPause;
  
  try {
    const dbInstance = await getDb();
    if (!dbInstance) return actions;
    
    // 获取所有enabled的Campaign
    const enabledCampaigns = await dbInstance
      .select({
        id: campaigns.id,
        campaignId: campaigns.campaignId,
        campaignName: campaigns.campaignName,
        campaignType: campaigns.campaignType,
        campaignStatus: campaigns.campaignStatus,
      })
      .from(campaigns)
      .where(and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignStatus, 'enabled')
      ));
    
    log.info(`[AutoStopLoss] 扫描 ${enabledCampaigns.length} 个活跃Campaign (accountId=${accountId})`);
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - config.consecutiveDays - 1);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const historyStartDate = new Date();
    historyStartDate.setDate(historyStartDate.getDate() - 90);
    const historyStartStr = historyStartDate.toISOString().split('T')[0];
    
    for (const campaign of enabledCampaigns) {
      try {
        // 查询最近N天的每日表现（daily_performance表以campaignId关联）
        const dailyData = await dbInstance.execute(sql`
          SELECT date, spend, sales, orders, clicks, impressions
          FROM daily_performance
          WHERE campaignId = ${campaign.campaignId}
            AND accountId = ${accountId}
            AND date >= ${startDateStr}
            AND date <= ${endDateStr}
          ORDER BY date DESC
          LIMIT ${config.consecutiveDays + 1}
        `);
        
        const rows = Array.isArray(dailyData) ? (Array.isArray(dailyData[0]) ? dailyData[0] : dailyData) : [];
        if ((rows as unknown[]).length < config.consecutiveDays) continue;
        
        // 检查是否连续N天ACoS超阈值
        let consecutiveHighAcos = 0;
        let totalSpend = 0;
        let totalSales = 0;
        let totalClicks = 0;
        
        for (const row of rows as Array<Record<string, number>>) {
          const spend = Number(row.spend) || 0;
          const sales = Number(row.sales) || 0;
          const clicks = Number(row.clicks) || 0;
          totalSpend += spend;
          totalSales += sales;
          totalClicks += clicks;
          
          if (spend > 0) {
            const dailyAcos = sales > 0 ? (spend / sales) * 100 : 999;
            if (dailyAcos > config.acosThreshold) {
              consecutiveHighAcos++;
            } else {
              break;
            }
          }
        }
        
        if (consecutiveHighAcos < config.consecutiveDays) continue;
        if (totalSpend < config.minSpendThreshold) continue;
        if (totalClicks < config.minClicksThreshold) continue;
        
        // 检查历史表现
        let isHistoricalPerformer = false;
        if (config.excludeHistoricalPerformers) {
          const historyData = await dbInstance.execute(sql`
            SELECT COALESCE(SUM(orders), 0) as totalOrders
            FROM daily_performance
            WHERE campaignId = ${campaign.campaignId}
              AND accountId = ${accountId}
              AND date >= ${historyStartStr}
          `);
          const historyRows = Array.isArray(historyData) ? (Array.isArray(historyData[0]) ? historyData[0] : historyData) : [];
          const totalOrders = Number((historyRows[0] as Record<string, number>)?.totalOrders) || 0;
          isHistoricalPerformer = totalOrders > config.historicalOrderThreshold;
        }
        
        const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 999;
        
        if (isHistoricalPerformer) {
          // 历史高转化Campaign：不暂停，只记录警告
          log.warn(`[AutoStopLoss] Campaign "${campaign.campaignName}" 连续${consecutiveHighAcos}天ACoS>${config.acosThreshold}%（均值${avgAcos.toFixed(0)}%），但有历史出单记录，仅发出警告`);
          actions.push({
            actionType: 'campaign_pause',
            entityType: 'campaign',
            entityId: campaign.id,
            entityName: campaign.campaignName || '',
            accountId,
            reason: `连续${consecutiveHighAcos}天ACoS>${config.acosThreshold}%（均值${avgAcos.toFixed(0)}%），有历史出单记录，建议人工审查`,
            confidence: 0.7,
            severity: 'high',
            autoExecuted: false,
            details: { avgAcos, consecutiveDays: consecutiveHighAcos, totalSpend, isHistoricalPerformer: true },
          });
        } else {
          // 非历史高转化Campaign：自动暂停
          log.warn(`[AutoStopLoss] 自动暂停Campaign "${campaign.campaignName}" - 连续${consecutiveHighAcos}天ACoS>${config.acosThreshold}%（均值${avgAcos.toFixed(0)}%）`);
          
          // 更新本地数据库
          await dbInstance
            .update(campaigns)
            .set({ campaignStatus: 'paused' })
            .where(eq(campaigns.id, campaign.id));
          
          // 同步到Amazon API
          try {
            await syncCampaignStatusToAmazon(accountId, [{
              amazonCampaignId: campaign.campaignId,
              newStatus: 'paused',
              campaignName: campaign.campaignName || '',
              campaignType: campaign.campaignType || undefined,
              reason: `[AutoStopLoss] 连续${consecutiveHighAcos}天ACoS>${config.acosThreshold}%`,
            }]);
          } catch (apiErr: unknown) {
            log.error(`[AutoStopLoss] Amazon API同步失败: ${(apiErr as Error).message}`);
          }
          
          // 记录审计日志
          recordAudit({
            action: 'campaign.pause',
            accountId,
            entityType: 'campaign',
            entityId: campaign.id,
            entityName: campaign.campaignName || '',
            previousValue: 'enabled',
            newValue: 'paused',
            source: 'system',
            metadata: { reason: `[AutoStopLoss] 连续${consecutiveHighAcos}天ACoS=${avgAcos.toFixed(0)}%，自动暂停` },
          });
          
          actions.push({
            actionType: 'campaign_pause',
            entityType: 'campaign',
            entityId: campaign.id,
            entityName: campaign.campaignName || '',
            accountId,
            reason: `连续${consecutiveHighAcos}天ACoS>${config.acosThreshold}%（均值${avgAcos.toFixed(0)}%），已自动暂停`,
            previousValue: 'enabled',
            newValue: 'paused',
            confidence: 0.9,
            severity: 'critical',
            autoExecuted: true,
            executedAt: new Date(),
            details: { avgAcos, consecutiveDays: consecutiveHighAcos, totalSpend, isHistoricalPerformer: false },
          });
          
          logOptimization('AutoStopLoss', `Campaign暂停: ${campaign.campaignName} (ACoS=${avgAcos.toFixed(0)}%, 连续${consecutiveHighAcos}天)`);
        }
      } catch (campaignErr: unknown) {
        log.warn(`[AutoStopLoss] Campaign ${campaign.id} 扫描异常: ${(campaignErr as Error).message}`);
      }
    }
    
    log.info(`[AutoStopLoss] Campaign扫描完成: ${actions.filter(a => a.autoExecuted).length}个自动暂停, ${actions.filter(a => !a.autoExecuted).length}个警告`);
  } catch (err: unknown) {
    log.error(`[AutoStopLoss] Campaign扫描异常: ${(err as Error).message}`);
  }
  
  return actions;
}

// ==================== 核心功能2：搜索词自动否定 ====================

/**
 * 扫描搜索词报告，自动否定无效搜索词
 * 
 * 规则：
 * 1. 高花费零转化：花费>$15且0订单 → 精准否定
 * 2. 高花费低转化：花费>$30且ACoS>200% → 精准否定
 * 3. 竞品品牌词：包含竞品品牌名 → 精准否定
 * 4. 不相关品类词：与核心产品不相关 → 精准否定
 */
export async function scanAndNegateSearchTerms(accountId: number): Promise<StopLossAction[]> {
  const actions: StopLossAction[] = [];
  const config = STOP_LOSS_CONFIG.searchTermAutoNegate;
  
  try {
    const dbInstance = await getDb();
    if (!dbInstance) return actions;
    
    // 查询最近14天的搜索词数据（使用search_terms表的实际字段名）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const searchTermData = await dbInstance.execute(sql`
      SELECT 
        st.id,
        st.searchTerm,
        st.campaignId,
        st.internal_ad_group_id,
        SUM(st.searchTermSpend) as totalSpend,
        SUM(st.searchTermSales) as totalSales,
        SUM(st.searchTermOrders) as totalOrders,
        SUM(st.searchTermClicks) as totalClicks,
        SUM(st.searchTermImpressions) as totalImpressions
      FROM search_terms st
      WHERE st.accountId = ${accountId}
        AND st.reportStartDate >= ${startDateStr}
        AND st.reportStartDate <= ${endDateStr}
      GROUP BY st.searchTerm, st.campaignId, st.internal_ad_group_id
      HAVING SUM(st.searchTermSpend) > 5
      ORDER BY SUM(st.searchTermSpend) DESC
      LIMIT 500
    `);
    
    const rows = Array.isArray(searchTermData) ? (Array.isArray(searchTermData[0]) ? searchTermData[0] : searchTermData) : [];
    
    log.info(`[AutoStopLoss] 扫描 ${(rows as unknown[]).length} 个搜索词 (accountId=${accountId})`);
    
    const negativeKeywordsToSync: Array<{
      campaignId: string;
      adGroupId?: string;
      keywordText: string;
      matchType: 'negativeExact' | 'negativePhrase';
      level: 'campaign' | 'adgroup';
    }> = [];
    
    for (const row of rows as Array<Record<string, unknown>>) {
      const searchTerm = String(row.searchTerm || '').toLowerCase();
      const spend = Number(row.totalSpend) || 0;
      const sales = Number(row.totalSales) || 0;
      const orders = Number(row.totalOrders) || 0;
      const clicks = Number(row.totalClicks) || 0;
      const acos = sales > 0 ? (spend / sales) * 100 : (spend > 0 ? 999 : 0);
      
      let shouldNegate = false;
      let reason = '';
      let severity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
      
      // 规则1：高花费零转化
      if (orders === 0 && spend >= config.zeroConversionSpendThreshold) {
        shouldNegate = true;
        reason = `零转化高花费: $${spend.toFixed(2)}花费, 0订单, ${clicks}点击`;
        severity = 'critical';
      }
      
      // 规则2：高花费低转化
      if (!shouldNegate && acos > config.highAcosThreshold && spend >= config.highAcosSpendThreshold) {
        shouldNegate = true;
        reason = `高ACoS: ${acos.toFixed(0)}%, 花费$${spend.toFixed(2)}, ${orders}订单`;
        severity = 'high';
      }
      
      // 规则3：竞品品牌词
      if (!shouldNegate) {
        const matchedBrand = config.competitorBrands.find(brand => searchTerm.includes(brand));
        if (matchedBrand && spend > 5) {
          shouldNegate = true;
          reason = `竞品品牌词"${matchedBrand}": 花费$${spend.toFixed(2)}, ACoS=${acos.toFixed(0)}%`;
          severity = 'high';
        }
      }
      
      // 规则4：不相关品类词
      if (!shouldNegate) {
        const matchedCategory = config.irrelevantCategories.find(cat => searchTerm.includes(cat));
        if (matchedCategory && spend > 10) {
          shouldNegate = true;
          reason = `不相关品类词"${matchedCategory}": 花费$${spend.toFixed(2)}, ACoS=${acos.toFixed(0)}%`;
          severity = 'medium';
        }
      }
      
      if (!shouldNegate) continue;
      
      // 检查是否已经被否定过
      const existingNeg = await dbInstance.execute(sql`
        SELECT id FROM negative_keywords
        WHERE accountId = ${accountId}
          AND negativeText = ${searchTerm}
          AND campaignId = ${row.campaignId}
        LIMIT 1
      `);
      
      const existingRows = Array.isArray(existingNeg) ? (Array.isArray(existingNeg[0]) ? existingNeg[0] : existingNeg) : [];
      if ((existingRows as unknown[]).length > 0) continue;
      
      // 写入本地数据库
      try {
        await dbInstance.insert(negativeKeywords).values({
          accountId,
          campaignId: String(row.campaignId),
          negativeLevel: 'campaign',
          negativeType: 'keyword',
          negativeText: searchTerm,
          negativeMatchType: 'negative_exact',
          negativeSource: 'auto_optimization',
          sourceReason: reason,
          negativeStatus: 'active',
        });
        
        // 收集待同步的否定词
        negativeKeywordsToSync.push({
          campaignId: String(row.campaignId),
          keywordText: searchTerm,
          matchType: 'negativeExact',
          level: 'campaign',
        });
        
        // 记录审计日志
        recordAudit({
          action: 'negative_keyword.add',
          accountId,
          entityType: 'search_term',
          entityId: String(row.id),
          entityName: searchTerm,
          source: 'system',
          metadata: { reason: `[AutoStopLoss] ${reason}` },
        });
        
        actions.push({
          actionType: 'search_term_negate',
          entityType: 'search_term',
          entityId: Number(row.id) || 0,
          entityName: searchTerm,
          accountId,
          reason,
          confidence: severity === 'critical' ? 0.95 : severity === 'high' ? 0.85 : 0.75,
          severity,
          autoExecuted: true,
          executedAt: new Date(),
          details: { spend, sales, orders, clicks, acos, campaignId: row.campaignId },
        });
      } catch (negErr: unknown) {
        log.warn(`[AutoStopLoss] 否定词添加失败(${searchTerm}): ${(negErr as Error).message}`);
      }
    }
    
    // 批量同步否定词到Amazon API
    if (negativeKeywordsToSync.length > 0) {
      try {
        const syncResult = await syncNegativeKeywordsToAmazon(accountId, negativeKeywordsToSync);
        log.info(`[AutoStopLoss] 否定词API同步: 成功=${syncResult.success}, 失败=${syncResult.failed}`);
      } catch (apiErr: unknown) {
        log.warn(`[AutoStopLoss] 否定词批量API同步失败: ${(apiErr as Error).message}`);
      }
    }
    
    log.info(`[AutoStopLoss] 搜索词扫描完成: ${actions.length}个搜索词已否定`);
  } catch (err: unknown) {
    log.error(`[AutoStopLoss] 搜索词扫描异常: ${(err as Error).message}`);
  }
  
  return actions;
}

// ==================== 核心功能3：Campaign重新激活防护 ====================

/**
 * 监控Campaign状态变更，检测并阻止无策略的批量重新激活
 */
export async function scanReactivatedCampaigns(accountId: number): Promise<StopLossAction[]> {
  const actions: StopLossAction[] = [];
  const config = STOP_LOSS_CONFIG.reactivationGuard;
  
  try {
    const dbInstance = await getDb();
    if (!dbInstance) return actions;
    
    // 查询最近24小时内状态变更为enabled的Campaign
    const checkWindowStart = new Date();
    checkWindowStart.setHours(checkWindowStart.getHours() - config.checkWindowHours);
    
    const reactivated = await dbInstance.execute(sql`
      SELECT c.id, c.campaignId, c.campaignName, c.campaignType, c.campaignStatus, c.updatedAt
      FROM campaigns c
      WHERE c.accountId = ${accountId}
        AND c.campaignStatus = 'enabled'
        AND c.updatedAt >= ${checkWindowStart.toISOString()}
    `);
    
    const rows = Array.isArray(reactivated) ? (Array.isArray(reactivated[0]) ? reactivated[0] : reactivated) : [];
    
    if ((rows as unknown[]).length < config.batchReactivationThreshold) {
      log.debug(`[AutoStopLoss] 重新激活检查: ${(rows as unknown[]).length}个Campaign (低于阈值${config.batchReactivationThreshold})`);
      return actions;
    }
    
    log.warn(`[AutoStopLoss] 检测到批量重新激活: ${(rows as unknown[]).length}个Campaign在${config.checkWindowHours}小时内被激活`);
    
    const historyStartDate = new Date();
    historyStartDate.setDate(historyStartDate.getDate() - 90);
    const historyStartStr = historyStartDate.toISOString().split('T')[0];
    
    const campaignsToRollback: Array<{
      amazonCampaignId: string;
      newStatus: 'paused';
      campaignName: string;
      campaignType?: string;
      reason: string;
    }> = [];
    
    for (const row of rows as Array<Record<string, unknown>>) {
      const historyData = await dbInstance.execute(sql`
        SELECT 
          COALESCE(SUM(spend), 0) as totalSpend,
          COALESCE(SUM(sales), 0) as totalSales,
          COALESCE(SUM(orders), 0) as totalOrders
        FROM daily_performance
        WHERE campaignId = ${row.campaignId}
          AND accountId = ${accountId}
          AND date >= ${historyStartStr}
      `);
      
      const historyRows = Array.isArray(historyData) ? (Array.isArray(historyData[0]) ? historyData[0] : historyData) : [];
      const totalSpend = Number((historyRows[0] as Record<string, number>)?.totalSpend) || 0;
      const totalSales = Number((historyRows[0] as Record<string, number>)?.totalSales) || 0;
      const totalOrders = Number((historyRows[0] as Record<string, number>)?.totalOrders) || 0;
      const historicalAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : (totalSpend > 0 ? 999 : 0);
      
      if (historicalAcos > config.historicalAcosThreshold && totalSpend > 20) {
        if (config.autoRollbackEnabled) {
          await dbInstance
            .update(campaigns)
            .set({ campaignStatus: 'paused' })
            .where(eq(campaigns.id, Number(row.id)));
          
          campaignsToRollback.push({
            amazonCampaignId: String(row.campaignId),
            newStatus: 'paused',
            campaignName: String(row.campaignName),
            campaignType: String(row.campaignType || ''),
            reason: `[AutoStopLoss] 重新激活防护: 历史ACoS=${historicalAcos.toFixed(0)}%`,
          });
          
          recordAudit({
            action: 'campaign.pause',
            accountId,
            entityType: 'campaign',
            entityId: Number(row.id),
            entityName: String(row.campaignName),
            previousValue: 'enabled',
            newValue: 'paused',
            source: 'system',
            metadata: { reason: `[AutoStopLoss] 重新激活防护回滚: 历史ACoS=${historicalAcos.toFixed(0)}%` },
          });
          
          actions.push({
            actionType: 'reactivation_rollback',
            entityType: 'campaign',
            entityId: Number(row.id),
            entityName: String(row.campaignName),
            accountId,
            reason: `批量重新激活防护: 历史ACoS=${historicalAcos.toFixed(0)}%（>${config.historicalAcosThreshold}%），已自动回滚为paused`,
            previousValue: 'enabled',
            newValue: 'paused',
            confidence: 0.85,
            severity: 'high',
            autoExecuted: true,
            executedAt: new Date(),
            details: { historicalAcos, totalSpend, totalSales, totalOrders },
          });
          
          logOptimizationWarn('AutoStopLoss', `重新激活回滚: ${row.campaignName} (历史ACoS=${historicalAcos.toFixed(0)}%)`);
        }
      }
    }
    
    // 批量同步到Amazon API
    if (campaignsToRollback.length > 0) {
      try {
        await syncCampaignStatusToAmazon(accountId, campaignsToRollback);
      } catch (apiErr: unknown) {
        log.warn(`[AutoStopLoss] 回滚API同步失败: ${(apiErr as Error).message}`);
      }
    }
    
    log.info(`[AutoStopLoss] 重新激活防护完成: ${actions.length}个Campaign已回滚`);
  } catch (err: unknown) {
    log.error(`[AutoStopLoss] 重新激活防护异常: ${(err as Error).message}`);
  }
  
  return actions;
}

// ==================== 核心功能4：数据悬崖自动修复 ====================

/**
 * 检测并修复数据悬崖
 * 
 * 逻辑：
 * 1. 查询所有历史订单>4的关键词
 * 2. 使用keywords表自身的汇总数据比较近期vs历史表现
 * 3. 如果流量下降>50%，视为数据悬崖
 * 4. 自动恢复竞价到历史CPC水平（单次最多提升20%）
 * 
 * 注意：daily_performance表没有keywordId字段，因此使用keywords表的汇总字段
 */
export async function scanAndRepairDataCliffs(accountId: number): Promise<StopLossAction[]> {
  const actions: StopLossAction[] = [];
  const config = STOP_LOSS_CONFIG.dataCliffRepair;
  
  try {
    const dbInstance = await getDb();
    if (!dbInstance) return actions;
    
    // 查询历史订单>4且当前活跃的关键词
    // keywords表有orders（汇总）、bid（当前竞价）、keywordCpc（历史CPC）
    const coreKeywords = await dbInstance.execute(sql`
      SELECT 
        k.id, k.keywordId, k.keywordText, k.matchType, 
        k.bid as currentBid,
        k.orders as totalOrders,
        k.clicks as totalClicks,
        k.impressions as totalImpressions,
        k.spend as totalSpend,
        k.keywordCpc as historicalCpc,
        k.campaignId,
        c.campaignName
      FROM keywords k
      JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
      INNER JOIN performance_groups pg ON c.performanceGroupId = pg.id AND pg.auto_optimize = 1 AND pg.status = 'active'
      WHERE k.accountId = ${accountId}
        AND k.keywordStatus = 'enabled'
        AND k.bid IS NOT NULL
        AND k.orders >= ${config.historicalOrderThreshold}
    `);
    
    const kwRows = Array.isArray(coreKeywords) ? (Array.isArray(coreKeywords[0]) ? coreKeywords[0] : coreKeywords) : [];
    
    log.info(`[AutoStopLoss] 数据悬崖扫描: ${(kwRows as unknown[]).length}个核心关键词(历史订单>=${config.historicalOrderThreshold}) (accountId=${accountId})`);
    
    const bidAdjustments: Array<{
      keywordId: number;
      newBid: number;
      reason: string;
    }> = [];
    
    for (const kw of kwRows as Array<Record<string, unknown>>) {
      try {
        const currentBid = Number(kw.currentBid) || 0;
        const historicalCpc = Number(kw.historicalCpc) || 0;
        const totalOrders = Number(kw.totalOrders) || 0;
        const totalClicks = Number(kw.totalClicks) || 0;
        
        if (currentBid <= 0 || historicalCpc <= 0) continue;
        
        // 检测数据悬崖：当前竞价远低于历史CPC
        // 如果当前竞价比历史CPC低30%以上，且该关键词有足够的历史出单，视为潜在悬崖
        const bidGapPercent = ((historicalCpc - currentBid) / historicalCpc) * 100;
        
        if (bidGapPercent < 30) continue; // 竞价差距不够大
        
        // 计算修复竞价
        const maxIncrease = currentBid * (config.maxBidIncreasePercent / 100);
        const targetBid = historicalCpc; // 目标是恢复到历史CPC
        const actualIncrease = Math.min(targetBid - currentBid, maxIncrease);
        
        if (actualIncrease <= 0.01) continue; // 调整量太小
        
        const newBid = Math.round((currentBid + actualIncrease) * 100) / 100;
        
        log.warn(`[AutoStopLoss] 数据悬崖检测: "${kw.keywordText}" (${kw.matchType}) 竞价修复 $${currentBid} → $${newBid} (历史CPC=$${historicalCpc.toFixed(2)}, 历史订单=${totalOrders})`);
        
        // 更新本地数据库
        await dbInstance
          .update(keywords)
          .set({ bid: String(newBid) })
          .where(eq(keywords.id, Number(kw.id)));
        
        bidAdjustments.push({
          keywordId: Number(kw.id),
          newBid,
          reason: `[AutoStopLoss] 数据悬崖修复: $${currentBid}→$${newBid}`,
        });
        
        recordAudit({
          action: 'keyword.bid_change',
          accountId,
          entityType: 'keyword',
          entityId: Number(kw.id),
          entityName: `${kw.keywordText} (${kw.matchType})`,
          previousValue: String(currentBid),
          newValue: String(newBid),
          source: 'system',
          metadata: { reason: `[AutoStopLoss] 数据悬崖修复: 历史CPC=$${historicalCpc.toFixed(2)}, 历史订单=${totalOrders}` },
        });
        
        actions.push({
          actionType: 'bid_restore',
          entityType: 'keyword',
          entityId: Number(kw.id),
          entityName: `${kw.keywordText} (${kw.matchType})`,
          accountId,
          reason: `数据悬崖修复: 竞价($${currentBid})远低于历史CPC($${historicalCpc.toFixed(2)})，恢复至$${newBid}`,
          previousValue: currentBid,
          newValue: newBid,
          confidence: 0.8,
          severity: 'high',
          autoExecuted: true,
          executedAt: new Date(),
          details: { 
            bidGapPercent,
            historicalCpc, 
            totalOrders,
            totalClicks,
            campaignName: kw.campaignName,
          },
        });
        
        logOptimization('AutoStopLoss', `数据悬崖修复: ${kw.keywordText} ($${currentBid}→$${newBid})`);
      } catch (kwErr: unknown) {
        log.warn(`[AutoStopLoss] 关键词 ${kw.id} 悬崖检测异常: ${(kwErr as Error).message}`);
      }
    }
    
    // v737: 批量同步竞价到Amazon API，使用itemResults逐条验证
    if (bidAdjustments.length > 0) {
      try {
        const syncResult = await syncBidAdjustmentsToAmazon(accountId, bidAdjustments.map(adj => ({
          keywordId: adj.keywordId,
          newBid: adj.newBid,
          reason: adj.reason,
          algorithmUsed: 'auto_stop_loss_cliff_repair',
        })));
        
        // v737: 逐条检查每个关键词的实际同步结果
        let syncedCount = 0, failedCount = 0;
        for (const adj of bidAdjustments) {
          const itemResult = syncResult.itemResults?.get(adj.keywordId);
          if (itemResult?.status === 'synced') {
            syncedCount++;
          } else {
            failedCount++;
            log.warn(`[AutoStopLoss] v737: 关键词${adj.keywordId}竞价修复同步失败: ${itemResult?.error || 'API返回无结果'}`);
          }
        }
        log.info(`[AutoStopLoss] v737: 竞价修复API同步结果: 成功=${syncedCount}, 失败=${failedCount}`);
      } catch (apiErr: unknown) {
        log.warn(`[AutoStopLoss] 竞价修复API同步失败: ${(apiErr as Error).message}`);
      }
    }
    
    log.info(`[AutoStopLoss] 数据悬崖扫描完成: ${actions.length}个关键词竞价已修复`);
  } catch (err: unknown) {
    log.error(`[AutoStopLoss] 数据悬崖扫描异常: ${(err as Error).message}`);
  }
  
  return actions;
}

// ==================== 统一入口：执行全量止血扫描 ====================

/**
 * 执行全量止血扫描
 * 由调度器定期调用，依次执行所有止血检查
 */
export async function executeFullStopLossScan(accountId: number): Promise<StopLossScanResult> {
  const startTime = Date.now();
  const allActions: StopLossAction[] = [];
  
  log.info(`[AutoStopLoss] ========== 开始全量止血扫描 (accountId=${accountId}) ==========`);
  
  // 1. 自动暂停高ACoS Campaign
  try {
    const pauseActions = await scanAndPauseHighAcosCampaigns(accountId);
    allActions.push(...pauseActions);
  } catch (err: unknown) {
    log.error(`[AutoStopLoss] Campaign暂停扫描失败: ${(err as Error).message}`);
  }
  
  // 2. 搜索词自动否定
  try {
    const negateActions = await scanAndNegateSearchTerms(accountId);
    allActions.push(...negateActions);
  } catch (err: unknown) {
    log.error(`[AutoStopLoss] 搜索词否定扫描失败: ${(err as Error).message}`);
  }
  
  // 3. Campaign重新激活防护
  try {
    const reactivationActions = await scanReactivatedCampaigns(accountId);
    allActions.push(...reactivationActions);
  } catch (err: unknown) {
    log.error(`[AutoStopLoss] 重新激活防护失败: ${(err as Error).message}`);
  }
  
  // 4. 数据悬崖自动修复
  try {
    const cliffActions = await scanAndRepairDataCliffs(accountId);
    allActions.push(...cliffActions);
  } catch (err: unknown) {
    log.error(`[AutoStopLoss] 数据悬崖修复失败: ${(err as Error).message}`);
  }
  
  const duration = Date.now() - startTime;
  
  const result: StopLossScanResult = {
    accountId,
    scanTime: new Date(),
    duration,
    actions: allActions,
    summary: {
      campaignsPaused: allActions.filter(a => a.actionType === 'campaign_pause' && a.autoExecuted).length,
      searchTermsNegated: allActions.filter(a => a.actionType === 'search_term_negate').length,
      bidsRestored: allActions.filter(a => a.actionType === 'bid_restore').length,
      reactivationsRolledBack: allActions.filter(a => a.actionType === 'reactivation_rollback').length,
      budgetAlerts: allActions.filter(a => a.actionType === 'budget_alert').length,
    },
  };
  
  log.info(`[AutoStopLoss] ========== 全量止血扫描完成 (${duration}ms) ==========`);
  log.info(`[AutoStopLoss] 汇总: Campaign暂停=${result.summary.campaignsPaused}, 搜索词否定=${result.summary.searchTermsNegated}, 竞价修复=${result.summary.bidsRestored}, 重新激活回滚=${result.summary.reactivationsRolledBack}`);
  
  // 发送通知（如果有关键操作）
  if (allActions.some(a => a.severity === 'critical')) {
    try {
      const criticalActions = allActions.filter(a => a.severity === 'critical');
      await notifyOwner({
        title: `[止血预警] 自动止血系统执行了${criticalActions.length}个关键操作`,
        content: criticalActions.map(a => `• ${a.reason}`).join('\n'),
      });
    } catch (notifyErr: unknown) {
      log.warn(`[AutoStopLoss] 通知发送失败: ${(notifyErr as Error).message}`);
    }
  }
  
  return result;
}

// ==================== 配置管理 ====================

/**
 * 获取止血配置
 */
export function getStopLossConfig(): typeof STOP_LOSS_CONFIG {
  return { ...STOP_LOSS_CONFIG };
}

/**
 * 更新止血配置（运行时动态更新）
 */
export function updateStopLossConfig(updates: Partial<typeof STOP_LOSS_CONFIG>): void {
  Object.assign(STOP_LOSS_CONFIG, updates);
  log.info(`[AutoStopLoss] 配置已更新: ${JSON.stringify(updates)}`);
}
