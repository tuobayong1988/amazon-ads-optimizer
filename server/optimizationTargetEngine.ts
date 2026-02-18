/**
 * 优化目标自动执行引擎
 * 
 * 核心理念：优化目标作为所有优化算法的统一执行入口
 * 当优化目标启用后，自动对其下的广告活动执行所有优化策略
 * 
 * 优化策略包括：
 * 1. 广告活动位置百分比调整
 * 2. 投放词分时竞价
 * 3. 客户搜索词分析和处理
 * 4. 预算分配优化
 * 5. 投放词暂停/启用决策
 */

import * as db from "./db";
import * as bidOptimizer from "./bidOptimizer";
import * as daypartingService from "./daypartingService";
import * as placementOptimizationService from "./placementOptimizationService";
import * as adAutomation from "./adAutomation";
import * as intelligentBudgetAllocationService from "./intelligentBudgetAllocationService";
import * as bidCoordinator from "./services/bidCoordinator";
import * as amazonApiHelper from "./services/amazonApiHelper";
import { getLocalHour, getLocalDayOfWeek, isNewKeyword, getExplorationStrategy, isProtectedKeyword } from "./algorithmUtils";

// 缓存账号站点信息，避免重复查询
const marketplaceCache = new Map<number, string>();

async function getAccountMarketplace(accountId: number): Promise<string> {
  if (marketplaceCache.has(accountId)) return marketplaceCache.get(accountId)!;
  const account = await db.getAdAccountById(accountId);
  const marketplace = account?.marketplace || 'US';
  marketplaceCache.set(accountId, marketplace);
  return marketplace;
}

// 优化执行结果类型
export interface OptimizationExecutionResult {
  targetId: number;
  targetName: string;
  executionTime: Date;
  status: 'success' | 'partial' | 'failed';
  
  // 各优化模块的执行结果
  bidOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: any[];
  };
  
  placementOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: any[];
  };
  
  daypartingOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: any[];
  };
  
  searchTermAnalysis: {
    executed: boolean;
    negativeKeywordsAdded: number;
    newKeywordsAdded: number;
    details: any[];
  };
  
  budgetAllocation: {
    executed: boolean;
    adjustmentsCount: number;
    details: any[];
  };
  
  keywordStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: any[];
  };
  
  // v135: 广告活动状态变更
  campaignStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: any[];
  };
  
  // v135: 广告组状态变更
  adGroupStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: any[];
  };
  
  // 中央竞价协调器执行结果
  bidCoordination: {
    executed: boolean;
    campaignsCoordinated: number;
    circuitBreakerTriggered: number;
    details: any[];
  };
  
  errors: string[];
  warnings: string[];
}

// 优化目标配置
export interface OptimizationTargetConfig {
  id: number;
  name: string;
  accountId: number;
  marketplace: string; // 站点代码，用于时区感知分时
  isEnabled: boolean;
  
  // 优化目标
  optimizationGoal: 'maximize_sales' | 'target_acos' | 'target_roas' | 'balanced';
  targetAcos?: number;
  targetRoas?: number;
  dailyBudget?: number;
  maxBid?: number;
  
  // 各优化模块的启用状态
  enableBidOptimization: boolean;
  enablePlacementOptimization: boolean;
  enableDaypartingOptimization: boolean;
  enableSearchTermAnalysis: boolean;
  enableBudgetAllocation: boolean;
  enableKeywordAutoExecution: boolean;
  
  // 执行频率设置
  executionFrequency: 'hourly' | 'daily' | 'weekly';
  lastExecutionTime?: Date;
  nextExecutionTime?: Date;
  
  // 安全设置
  maxDailyBidChanges: number;
  maxBidChangePercent: number;
  minDataPoints: number;
  autoRollbackEnabled: boolean;
}

/**
 * 获取优化目标的完整配置
 */
export async function getOptimizationTargetConfig(targetId: number): Promise<OptimizationTargetConfig | null> {
  const group = await db.getPerformanceGroupById(targetId);
  if (!group) return null;
  
  return {
    id: group.id,
    name: group.name,
    accountId: group.accountId,
    marketplace: await getAccountMarketplace(group.accountId),
    isEnabled: group.status === 'active',
    
    optimizationGoal: (group.optimizationGoal as any) || 'balanced',
    targetAcos: group.targetAcos ? parseFloat(group.targetAcos) : undefined,
    targetRoas: group.targetRoas ? parseFloat(group.targetRoas) : undefined,
    dailyBudget: group.dailyBudget ? parseFloat(group.dailyBudget) : undefined,
    maxBid: group.maxBid ? parseFloat(group.maxBid) : undefined,
    
    // 默认启用所有优化模块
    enableBidOptimization: true,
    enablePlacementOptimization: true,
    enableDaypartingOptimization: true,
    enableSearchTermAnalysis: true,
    enableBudgetAllocation: true,
    enableKeywordAutoExecution: true,
    
    executionFrequency: 'daily',
    lastExecutionTime: undefined,
    nextExecutionTime: undefined,
    
    maxDailyBidChanges: 100,
    maxBidChangePercent: 30,
    minDataPoints: 7,
    autoRollbackEnabled: true,
  };
}

/**
 * 执行优化目标的所有优化策略
 */
export async function executeOptimizationTarget(
  targetId: number,
  options: {
    dryRun?: boolean;
    forceExecution?: boolean;
    specificModules?: string[];
  } = {}
): Promise<OptimizationExecutionResult> {
  const { dryRun = false, forceExecution = false, specificModules } = options;
  
  const config = await getOptimizationTargetConfig(targetId);
  if (!config) {
    throw new Error(`优化目标 ${targetId} 不存在`);
  }
  
  if (!config.isEnabled && !forceExecution) {
    throw new Error(`优化目标 ${config.name} 未启用`);
  }
  
  const result: OptimizationExecutionResult = {
    targetId: config.id,
    targetName: config.name,
    executionTime: new Date(),
    status: 'success',
    bidOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    placementOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    daypartingOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    searchTermAnalysis: { executed: false, negativeKeywordsAdded: 0, newKeywordsAdded: 0, details: [] },
    budgetAllocation: { executed: false, adjustmentsCount: 0, details: [] },
    keywordStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
    campaignStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
    adGroupStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
    bidCoordination: { executed: false, campaignsCoordinated: 0, circuitBreakerTriggered: 0, details: [] },
    errors: [],
    warnings: [],
  };
  
  // 获取优化目标下的所有广告活动
  const campaigns = await db.getCampaignsByPerformanceGroupId(targetId);
  if (campaigns.length === 0) {
    result.warnings.push('优化目标下没有广告活动');
    return result;
  }
  
  const shouldExecute = (module: string) => {
    if (specificModules && specificModules.length > 0) {
      return specificModules.includes(module);
    }
    return true;
  };
  
  // 1. 执行出价优化
  if (config.enableBidOptimization && shouldExecute('bid')) {
    try {
      const bidResults = await executeBidOptimization(config, campaigns, dryRun);
      result.bidOptimization = bidResults;
    } catch (error: any) {
      result.errors.push(`出价优化失败: ${error.message}`);
    }
  }
  
  // 2. 执行位置优化
  if (config.enablePlacementOptimization && shouldExecute('placement')) {
    try {
      const placementResults = await executePlacementOptimization(config, campaigns, dryRun);
      result.placementOptimization = placementResults;
    } catch (error: any) {
      result.errors.push(`位置优化失败: ${error.message}`);
    }
  }
  
  // 3. 执行分时竞价优化
  if (config.enableDaypartingOptimization && shouldExecute('dayparting')) {
    try {
      const daypartingResults = await executeDaypartingOptimization(config, campaigns, dryRun);
      result.daypartingOptimization = daypartingResults;
    } catch (error: any) {
      result.errors.push(`分时竞价优化失败: ${error.message}`);
    }
  }
  
  // 4. 执行搜索词分析
  if (config.enableSearchTermAnalysis && shouldExecute('searchterm')) {
    try {
      const searchTermResults = await executeSearchTermAnalysis(config, campaigns, dryRun);
      result.searchTermAnalysis = searchTermResults;
    } catch (error: any) {
      result.errors.push(`搜索词分析失败: ${error.message}`);
    }
  }
  
  // 5. 执行预算分配优化
  if (config.enableBudgetAllocation && shouldExecute('budget')) {
    try {
      const budgetResults = await executeBudgetAllocation(config, campaigns, dryRun);
      result.budgetAllocation = budgetResults;
    } catch (error: any) {
      result.errors.push(`预算分配优化失败: ${error.message}`);
    }
  }
  
  // 6. 执行投放词状态变更
  if (config.enableKeywordAutoExecution && shouldExecute('keyword')) {
    try {
      const keywordResults = await executeKeywordStatusChanges(config, campaigns, dryRun);
      result.keywordStatusChanges = keywordResults;
    } catch (error: any) {
      result.errors.push(`投放词状态变更失败: ${error.message}`);
    }
  }
  
  // 7. v135: 执行广告活动状态变更
  if (config.enableKeywordAutoExecution && shouldExecute('campaign_status')) {
    try {
      const campaignResults = await executeCampaignStatusChanges(config, campaigns, dryRun);
      result.campaignStatusChanges = campaignResults;
    } catch (error: any) {
      result.errors.push(`广告活动状态变更失败: ${error.message}`);
    }
  }
  
  // 8. v135: 执行广告组状态变更
  if (config.enableKeywordAutoExecution && shouldExecute('adgroup_status')) {
    try {
      const adGroupResults = await executeAdGroupStatusChanges(config, campaigns, dryRun);
      result.adGroupStatusChanges = adGroupResults;
    } catch (error: any) {
      result.errors.push(`广告组状态变更失败: ${error.message}`);
    }
  }
  
  // 9. 执行中央竞价协调（收集各服务建议并统一处理）
  if (shouldExecute('coordination')) {
    try {
      const coordinationResults = await executeBidCoordination(
        config,
        campaigns,
        result.bidOptimization.details,
        result.placementOptimization.details,
        result.daypartingOptimization.details,
        dryRun
      );
      result.bidCoordination = coordinationResults;
      
      // 将协调器的警告添加到结果中
      if (coordinationResults.details.length > 0) {
        for (const detail of coordinationResults.details) {
          if (detail.warnings && detail.warnings.length > 0) {
            result.warnings.push(...detail.warnings);
          }
        }
      }
    } catch (error: any) {
      result.errors.push(`中央竞价协调失败: ${error.message}`);
    }
  }
  
  // 更新执行状态
  if (result.errors.length > 0) {
    result.status = result.errors.length === 7 ? 'failed' : 'partial';
  }
  
  // 记录执行日志
  if (!dryRun) {
    await recordExecutionLog(result);
    
    // v137: 将失败的同步任务入队到重试队列
    try {
      const { enqueueTasks } = await import('./optimizationSyncEngine');
      const { randomUUID } = await import('crypto');
      const failedTasks: any[] = [];
      const batchId = randomUUID();
      
      // 收集出价调整中失败的任务
      if (result.bidOptimization?.details) {
        for (const detail of result.bidOptimization.details) {
          if (detail.apiSyncStatus === 'failed' || detail.apiSyncStatus === 'partial') {
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'bid_adjustment',
              priority: 1,
              targetEntityType: detail.isProductTarget ? 'product_target' : 'keyword',
              targetEntityId: detail.keywordId,
              amazonEntityId: null, // 将在同步引擎中查询
              targetEntityName: detail.keywordText,
              action: detail.newBid > detail.currentBid ? 'bid_increase' : 'bid_decrease',
              oldValue: String(detail.currentBid),
              newValue: String(detail.newBid),
              changeReason: detail.reason,
              algorithmUsed: detail.algorithmUsed,
              confidenceScore: detail.confidenceScore,
              campaignId: detail.campaignId,
              campaignName: detail.campaignName,
            });
          }
        }
      }
      
      // 收集关键词状态变更中失败的任务
      if (result.keywordStatusChanges?.details) {
        for (const detail of result.keywordStatusChanges.details) {
          if (detail.apiSyncStatus === 'failed') {
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'keyword_status',
              priority: 1,
              targetEntityType: 'keyword',
              targetEntityId: detail.keywordId || detail.targetId,
              amazonEntityId: null,
              targetEntityName: detail.keywordText,
              action: detail.newStatus || detail.action,
              oldValue: detail.oldStatus || detail.previousValue,
              newValue: detail.newStatus || detail.newValue,
              changeReason: detail.reason,
              campaignId: detail.campaignId,
              campaignName: detail.campaignName,
            });
          }
        }
      }
      
      // 收集广告活动状态变更中失败的任务
      if (result.campaignStatusChanges?.details) {
        for (const detail of result.campaignStatusChanges.details) {
          if (detail.apiSyncStatus === 'failed') {
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'campaign_status',
              priority: 0,
              targetEntityType: 'campaign',
              targetEntityId: detail.campaignId,
              amazonEntityId: detail.amazonCampaignId,
              targetEntityName: detail.campaignName,
              action: detail.newStatus,
              oldValue: detail.oldStatus,
              newValue: detail.newStatus,
              changeReason: detail.reason,
            });
          }
        }
      }
      
      // 收集广告组状态变更中失败的任务
      if (result.adGroupStatusChanges?.details) {
        for (const detail of result.adGroupStatusChanges.details) {
          if (detail.apiSyncStatus === 'failed') {
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'adgroup_status',
              priority: 0,
              targetEntityType: 'adgroup',
              targetEntityId: detail.adGroupId,
              amazonEntityId: detail.amazonAdGroupId,
              targetEntityName: detail.adGroupName,
              action: detail.newStatus,
              oldValue: detail.oldStatus,
              newValue: detail.newStatus,
              changeReason: detail.reason,
            });
          }
        }
      }
      
      if (failedTasks.length > 0) {
        await enqueueTasks(failedTasks);
        console.log(`[OptimizationTarget] v137: ${failedTasks.length}个失败任务已入队重试队列, batchId=${batchId}`);
        result.retryBatchId = batchId;
        result.retryTaskCount = failedTasks.length;
      }
    } catch (enqueueErr: any) {
      console.error(`[OptimizationTarget] v137: 入队失败任务异常: ${enqueueErr.message}`);
    }
  }
  
  return result;
}

/**
 * v122h: 执行出价优化 - 使用UCB增强版算法
 * 集成动态弹性系数、UCB探索-利用平衡、时间衰减ROAS、节假日调整
 */
async function executeBidOptimization(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: any[] }> {
  const details: any[] = [];
  let adjustmentsCount = 0;
  
  // v122h: 计算广告组平均CVR、CPC、AOV作为贝叶斯先验数据
  let totalClicks = 0, totalOrders = 0, totalSpend = 0, totalSales = 0;
  for (const c of campaigns) {
    totalClicks += (c.clicks || 0);
    totalOrders += (c.orders || 0);
    totalSpend += parseFloat(c.spend || '0');
    totalSales += parseFloat(c.sales || '0');
  }
  const groupAvgCvr = totalClicks > 0 ? totalOrders / totalClicks : 0.05;
  const groupAvgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0.80;
  const groupAvgAov = totalOrders > 0 ? totalSales / totalOrders : 30;
  
  const bidConfig: bidOptimizer.PerformanceGroupConfig = {
    optimizationGoal: config.optimizationGoal,
    targetAcos: config.targetAcos,
    targetRoas: config.targetRoas,
    dailyBudget: config.dailyBudget,
    maxBid: config.maxBid,
    groupAvgCvr,
    groupAvgCpc,
    groupAvgAov,
  };
  
  const currentDate = new Date();
  const maxBidLimit = config.maxBid || 10;
  
  for (const campaign of campaigns) {
    // v122h: 获取campaign级别的14天历史每日数据，用于时间衰减ROAS计算
    let campaignDailyData: Array<{ date: Date; spend: number; sales: number; clicks: number; orders: number }> = [];
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 14);
      const rawDailyData = await db.getDailyPerformanceByDateRange(config.accountId, startDate, endDate, campaign.id);
      campaignDailyData = rawDailyData.map(d => ({
        date: new Date(d.date),
        spend: parseFloat(String(d.spend || '0')),
        sales: parseFloat(String(d.sales || '0')),
        clicks: d.clicks || 0,
        orders: d.orders || 0,
      }));
    } catch (e: any) {
      console.log(`[BidOptimization] 获取campaign ${campaign.id} 历史数据失败: ${e.message}`);
    }
    
    // v122h: 收集该campaign下所有关键词，构建EnhancedOptimizationTarget
    const keywords = await db.getKeywordsByCampaignId(campaign.id);
    const keywordTargets: bidOptimizer.EnhancedOptimizationTarget[] = [];
    
    for (const keyword of keywords) {
      if (keyword.keywordStatus !== 'enabled') continue;
      const currentBid = parseFloat(keyword.bid || '0');
      if (currentBid <= 0) continue;
      
      keywordTargets.push({
        id: keyword.id,
        type: 'keyword',
        currentBid,
        impressions: keyword.impressions || 0,
        clicks: keyword.clicks || 0,
        spend: parseFloat(keyword.spend || '0'),
        sales: parseFloat(keyword.sales || '0'),
        orders: keyword.orders || 0,
        matchType: keyword.matchType,
        campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : undefined,
        historicalAvgImpressions: campaign.impressions ? Math.round(campaign.impressions / 14) : undefined,
        // v122h: 传入campaign级别的每日数据用于时间衰减ROAS和UCB
        dailyData: campaignDailyData.length > 0 ? campaignDailyData : undefined,
        marketplace: config.marketplace,
        campaignId: campaign.id,
      });
    }
    
    // v122h: 使用UCB增强版算法批量优化关键词
    if (keywordTargets.length > 0) {
      const results = bidOptimizer.optimizePerformanceGroupEnhanced(
        keywordTargets, bidConfig, maxBidLimit, currentDate
      );
      
      for (const result of results) {
        if (Math.abs(result.newBid - result.previousBid) > 0.01) {
          const keyword = keywords.find(k => k.id === result.targetId);
          const adjustment = {
            keywordId: result.targetId,
            keywordText: keyword?.keywordText || `关键词 ${result.targetId}`,
            campaignId: campaign.id,
            campaignName: campaign.name || campaign.campaignName,
            currentBid: result.previousBid,
            newBid: result.newBid,
            changePercent: result.bidChangePercent.toFixed(2),
            reason: `[${result.algorithmUsed}] ${result.reason}`,
            algorithmUsed: result.algorithmUsed,
            confidenceScore: result.confidenceScore,
          };
          
          details.push(adjustment);
          
          if (!dryRun) {
            await db.updateKeyword(result.targetId, { bid: result.newBid.toFixed(2) });
            adjustmentsCount++;
          }
        }
      }
    }
    
    // v122h: 商品定向也使用UCB增强版算法
    const adGroupsList = await db.getAdGroupsByCampaignId(campaign.id);
    const productTargets: bidOptimizer.EnhancedOptimizationTarget[] = [];
    const allTargets: any[] = [];
    
    for (const ag of adGroupsList) {
      const targets = await db.getProductTargetsByAdGroupId(ag.id);
      for (const target of targets) {
        if (target.targetStatus !== 'enabled') continue;
        const currentBid = parseFloat(target.bid || '0');
        if (currentBid <= 0) continue;
        
        allTargets.push(target);
        productTargets.push({
          id: target.id,
          type: 'product_target',
          currentBid,
          impressions: target.impressions || 0,
          clicks: target.clicks || 0,
          spend: parseFloat(target.spend || '0'),
          sales: parseFloat(target.sales || '0'),
          orders: target.orders || 0,
          matchType: target.targetMatchType || 'exact',
          campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : undefined,
          historicalAvgImpressions: campaign.impressions ? Math.round(campaign.impressions / 14) : undefined,
          dailyData: campaignDailyData.length > 0 ? campaignDailyData : undefined,
          marketplace: config.marketplace,
          campaignId: campaign.id,
        });
      }
    }
    
    if (productTargets.length > 0) {
      const results = bidOptimizer.optimizePerformanceGroupEnhanced(
        productTargets, bidConfig, maxBidLimit, currentDate
      );
      
      for (const result of results) {
        if (Math.abs(result.newBid - result.previousBid) > 0.01) {
          const target = allTargets.find(t => t.id === result.targetId);
          const adjustment = {
            keywordId: result.targetId,
            keywordText: target?.targetText || target?.targetValue || `商品定向 ${result.targetId}`,
            campaignId: campaign.id,
            campaignName: campaign.name || campaign.campaignName,
            currentBid: result.previousBid,
            newBid: result.newBid,
            changePercent: result.bidChangePercent.toFixed(2),
            reason: `商品定向 - [${result.algorithmUsed}] ${result.reason}`,
            isProductTarget: true,
            algorithmUsed: result.algorithmUsed,
            confidenceScore: result.confidenceScore,
          };
          
          details.push(adjustment);
          
          if (!dryRun) {
            await db.updateProductTarget(result.targetId, { bid: result.newBid.toFixed(2) });
            adjustmentsCount++;
          }
        }
      }
    }
  }
  
  // v123: 批量同步出价调整到 Amazon API，并记录同步结果
  let apiSyncResult: { success: number; failed: number; errors: string[] } = { success: 0, failed: 0, errors: [] };
  let apiSyncStatus: 'pending' | 'synced' | 'failed' | 'partial' = 'pending';
  
  if (!dryRun && details.length > 0) {
    try {
      const accountId = config.accountId;
      
      // v130: 补偿同步机制 - 通过Amazon API查询已存在关键词的keywordId并回填到本地数据库
      // 使用mysql2直接连接执行UPDATE，绕过Drizzle ORM的casing映射问题
      try {
        const mysql2 = await import('mysql2/promise');
        const dbUrl = process.env.DATABASE_URL;
        if (dbUrl) {
          const directConn = await mysql2.createConnection(dbUrl);
          try {
            // 查询该账号下所有缺少keywordId的关键词
            const [missingKws] = await directConn.execute<any[]>(
              `SELECT k.id, k.adGroupId, k.keywordText, k.matchType, k.bid
               FROM keywords k
               INNER JOIN ad_groups ag ON k.adGroupId = ag.id
               INNER JOIN campaigns c ON ag.campaignId = c.id
               WHERE c.accountId = ? AND k.keywordId IS NULL`,
              [accountId]
            );
            
            if (missingKws.length > 0) {
              console.log(`[BidOptimization] 补偿同步: 发现账号${accountId}下${missingKws.length}个关键词缺少Amazon keywordId`);
              
              // 按adGroupId分组
              const groupedByAdGroup = new Map<number, any[]>();
              for (const kw of missingKws) {
                const group = groupedByAdGroup.get(kw.adGroupId) || [];
                group.push(kw);
                groupedByAdGroup.set(kw.adGroupId, group);
              }
              
              console.log(`[BidOptimization] 补偿同步: 分布在${groupedByAdGroup.size}个adGroup中`);
              
              let totalCompensated = 0;
              let totalCompensateFailed = 0;
              
              // 获取SyncService实例（用于调用listSpKeywords）
              const syncService = await amazonApiHelper.getAmazonSyncService(accountId);
              if (!syncService) {
                console.error(`[BidOptimization] 补偿同步: 无法获取账号${accountId}的API服务`);
              } else {
                for (const [adGroupLocalId, kwsInGroup] of groupedByAdGroup) {
                  try {
                    // 获取Amazon adGroupId
                    const [agRows] = await directConn.execute<any[]>(
                      'SELECT id, adGroupId FROM ad_groups WHERE id = ? LIMIT 1',
                      [adGroupLocalId]
                    );
                    if (!agRows[0] || !agRows[0].adGroupId) {
                      console.warn(`[BidOptimization] 补偿同步: adGroup id=${adGroupLocalId} 缺少Amazon adGroupId, 跳过${kwsInGroup.length}个关键词`);
                      totalCompensateFailed += kwsInGroup.length;
                      continue;
                    }
                    
                    const amazonAdGroupId = Number(agRows[0].adGroupId);
                    console.log(`[BidOptimization] 补偿同步: adGroup=${adGroupLocalId}(Amazon:${amazonAdGroupId}), 查询Amazon已有关键词...`);
                    
                    // 通过Amazon API查询该adGroup下的所有关键词
                    const amazonKeywords = await syncService.client.listSpKeywords(amazonAdGroupId);
                    console.log(`[BidOptimization] 补偿同步: Amazon返回${amazonKeywords.length}个关键词`);
                    
                    // 构建查找索引: keywordText_matchType -> amazonKeywordId
                    const amazonKwMap = new Map<string, string>();
                    for (const ak of amazonKeywords) {
                      const key = `${(ak.keywordText || '').toLowerCase().trim()}_${(ak.matchType || '').toLowerCase()}`;
                      amazonKwMap.set(key, String(ak.keywordId));
                    }
                    
                    // 匹配本地缺失keywordId的关键词
                    let matched = 0;
                    let unmatched = 0;
                    const unmatchedKws: any[] = [];
                    for (const kw of kwsInGroup) {
                      const key = `${(kw.keywordText || '').toLowerCase().trim()}_${(kw.matchType || '').toLowerCase()}`;
                      const amazonKeywordId = amazonKwMap.get(key);
                      
                      if (amazonKeywordId) {
                        try {
                          await directConn.execute(
                            'UPDATE keywords SET keywordId = ? WHERE id = ? AND keywordId IS NULL',
                            [amazonKeywordId, kw.id]
                          );
                          matched++;
                          totalCompensated++;
                        } catch (updateErr: any) {
                          // 唯一约束冲突 (ER_DUP_ENTRY) - keywordId已被其他记录使用，删除当前重复记录
                          if (updateErr.code === 'ER_DUP_ENTRY' || updateErr.errno === 1062) {
                            try {
                              await directConn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [kw.id]);
                              console.log(`[BidOptimization] 补偿同步: 删除重复keyword id=${kw.id} (keywordId=${amazonKeywordId}已存在)`);
                              matched++;
                              totalCompensated++;
                            } catch (delErr: any) {
                              console.error(`[BidOptimization] 补偿同步: 删除重复keyword id=${kw.id}失败: ${delErr.message}`);
                              unmatched++;
                              totalCompensateFailed++;
                            }
                          } else {
                            console.error(`[BidOptimization] 补偿同步: 更新keyword id=${kw.id}失败: ${updateErr.message} (code=${updateErr.code}, errno=${updateErr.errno})`);
                            unmatched++;
                            totalCompensateFailed++;
                          }
                        }
                      } else {
                        unmatchedKws.push(kw);
                        unmatched++;
                      }
                    }
                    
                    if (matched > 0) {
                      console.log(`[BidOptimization] ✅ adGroup=${adGroupLocalId} 补偿同步(回填): ${matched}个关键词`);
                    }
                    
                    // 对于在Amazon端未找到匹配的关键词，尝试重新创建到Amazon
                    if (unmatchedKws.length > 0) {
                      console.log(`[BidOptimization] adGroup=${adGroupLocalId}: ${unmatchedKws.length}个关键词在Amazon端不存在，尝试重新创建...`);
                      
                      // 获取campaignId
                      const [campRows] = await directConn.execute<any[]>(
                        'SELECT c.campaignId FROM ad_groups ag INNER JOIN campaigns c ON ag.campaignId = c.id WHERE ag.id = ? LIMIT 1',
                        [adGroupLocalId]
                      );
                      const amazonCampaignId = campRows[0]?.campaignId ? Number(campRows[0].campaignId) : null;
                      
                      if (amazonCampaignId) {
                        // 清理关键词文本中的特殊字符（Unicode替换字符等）
                        const cleanText = (text: string) => text.replace(/[\uFFFC\uFFFD\u200B-\u200F\u2028-\u202F]/g, '').trim();
                        
                        // 分批创建（每批最多50个）
                        const RECREATE_BATCH = 50;
                        for (let i = 0; i < unmatchedKws.length; i += RECREATE_BATCH) {
                          const batch = unmatchedKws.slice(i, i + RECREATE_BATCH);
                          try {
                            const createResult = await syncService.client.createSpKeywords(
                              batch.map(k => ({
                                adGroupId: amazonAdGroupId,
                                campaignId: amazonCampaignId,
                                keywordText: cleanText(k.keywordText),
                                matchType: k.matchType as 'exact' | 'phrase' | 'broad',
                                bid: Number(k.bid) > 0 ? Number(k.bid) : 0.5,
                                state: 'enabled' as const,
                              }))
                            );
                            
                            for (let j = 0; j < createResult.createdKeywords.length; j++) {
                              const created = createResult.createdKeywords[j];
                              const original = batch[j];
                              if (created.code === 'SUCCESS' && created.keywordId) {
                                try {
                                  await directConn.execute(
                                    'UPDATE keywords SET keywordId = ? WHERE id = ? AND keywordId IS NULL',
                                    [String(created.keywordId), original.id]
                                  );
                                  totalCompensated++;
                                  console.log(`[BidOptimization] ✅ 补偿同步(创建): keyword id=${original.id} "${original.keywordText?.substring(0, 30)}" -> keywordId=${created.keywordId}`);
                                } catch (upErr: any) {
                                  if (upErr.code === 'ER_DUP_ENTRY' || upErr.errno === 1062) {
                                    await directConn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [original.id]);
                                    totalCompensated++;
                                    console.log(`[BidOptimization] 补偿同步(创建): 删除重复keyword id=${original.id}`);
                                  } else {
                                    totalCompensateFailed++;
                                    console.error(`[BidOptimization] 补偿同步(创建): 更新keywordId失败 id=${original.id}: ${upErr.message}`);
                                  }
                                }
                              } else {
                                totalCompensateFailed++;
                                console.warn(`[BidOptimization] 补偿同步(创建): keyword id=${original.id} 创建失败: code=${created.code}`);
                              }
                            }
                          } catch (createErr: any) {
                            console.error(`[BidOptimization] 补偿同步(创建)批次失败: ${createErr.message}`);
                            totalCompensateFailed += batch.length;
                            if (createErr.response?.status === 429) {
                              await new Promise(resolve => setTimeout(resolve, 5000));
                            }
                          }
                          // 批间延迟
                          await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                      } else {
                        console.warn(`[BidOptimization] adGroup=${adGroupLocalId}: 无法获取campaignId，跳过重新创建`);
                        totalCompensateFailed += unmatchedKws.length;
                      }
                    }
                    
                    // adGroup间延迟1秒，避免API限流
                    await new Promise(resolve => setTimeout(resolve, 1000));
                  } catch (groupErr: any) {
                    console.error(`[BidOptimization] 补偿同步adGroup=${adGroupLocalId}异常: ${groupErr.message}`);
                    totalCompensateFailed += kwsInGroup.length;
                    
                    if (groupErr.response?.status === 429) {
                      console.log(`[BidOptimization] ⚠️ API限流，等待10秒...`);
                      await new Promise(resolve => setTimeout(resolve, 10000));
                    }
                  }
                }
              }
              
              console.log(`[BidOptimization] 补偿同步完成: 成功=${totalCompensated}, 失败=${totalCompensateFailed}, 总计=${missingKws.length}`);
            } else {
              console.log(`[BidOptimization] 补偿同步: 该账号下所有关键词均已有Amazon keywordId, 无需补偿`);
            }
          } finally {
            await directConn.end();
          }
        }
      } catch (compensateErr: any) {
        console.error(`[BidOptimization] 关键词补偿同步机制异常: ${compensateErr.message}`);
      }
      
      // v138: 补偿同步机制 - product_targets的targetId回填
      try {
        const mysql2pt = await import('mysql2/promise');
        const dbUrlPt = process.env.DATABASE_URL;
        if (dbUrlPt) {
          const ptConn = await mysql2pt.createConnection(dbUrlPt);
          try {
            // 查询该账号下所有缺少targetId的product_targets
            const [missingPts] = await ptConn.execute<any[]>(
              `SELECT pt.id, pt.adGroupId, pt.targetExpression, pt.targetValue, pt.targetMatchType
               FROM product_targets pt
               INNER JOIN ad_groups ag ON pt.adGroupId = ag.id
               INNER JOIN campaigns c ON ag.campaignId = c.id
               WHERE c.accountId = ? AND pt.targetId IS NULL`,
              [accountId]
            );
            
            if (missingPts.length > 0) {
              console.log(`[BidOptimization] PT补偿同步: 发现账号${accountId}下${missingPts.length}个product_targets缺少Amazon targetId`);
              
              // 按adGroupId分组
              const ptGroupedByAdGroup = new Map<number, any[]>();
              for (const pt of missingPts) {
                const group = ptGroupedByAdGroup.get(pt.adGroupId) || [];
                group.push(pt);
                ptGroupedByAdGroup.set(pt.adGroupId, group);
              }
              
              const syncService = await amazonApiHelper.getAmazonSyncService(accountId);
              if (syncService) {
                let ptCompensated = 0;
                let ptFailed = 0;
                
                for (const [adGroupLocalId, ptsInGroup] of ptGroupedByAdGroup) {
                  try {
                    // 获取Amazon adGroupId
                    const [agRows] = await ptConn.execute<any[]>(
                      'SELECT id, adGroupId FROM ad_groups WHERE id = ? LIMIT 1',
                      [adGroupLocalId]
                    );
                    if (!agRows[0] || !agRows[0].adGroupId) {
                      ptFailed += ptsInGroup.length;
                      continue;
                    }
                    
                    const amazonAdGroupId = Number(agRows[0].adGroupId);
                    
                    // 通过Amazon API查询该adGroup下的所有product targets
                    const amazonTargets = await syncService.client.listSpProductTargets(amazonAdGroupId);
                    console.log(`[BidOptimization] PT补偿同步: adGroup=${adGroupLocalId}(Amazon:${amazonAdGroupId}), Amazon返回${amazonTargets.length}个targets`);
                    
                    // 构建查找索引: targetExpression -> targetId
                    const amazonPtMap = new Map<string, string>();
                    for (const at of amazonTargets) {
                      // 使用expression value作为匹配键
                      const atAny = at as any;
                      const expr = JSON.stringify(atAny.expression || atAny.targetingClause?.expression || []);
                      amazonPtMap.set(expr, String(at.targetId));
                      // 也用resolvedExpression匹配
                      if (atAny.resolvedExpression) {
                        amazonPtMap.set(JSON.stringify(atAny.resolvedExpression), String(at.targetId));
                      }
                    }
                    
                    for (const pt of ptsInGroup) {
                      // 尝试多种匹配方式
                      let amazonTargetId: string | undefined;
                      
                      // 方式1: 通过targetExpression匹配
                      if (pt.targetExpression) {
                        amazonTargetId = amazonPtMap.get(pt.targetExpression);
                      }
                      
                      // 方式2: 遍历Amazon targets，按ASIN或类目匹配
                      if (!amazonTargetId && pt.targetValue) {
                        for (const at of amazonTargets) {
                          const atAny2 = at as any;
                          const exprStr = JSON.stringify(atAny2.expression || atAny2.targetingClause?.expression || []);
                          if (exprStr.includes(pt.targetValue)) {
                            amazonTargetId = String(at.targetId);
                            break;
                          }
                        }
                      }
                      
                      if (amazonTargetId) {
                        try {
                          await ptConn.execute(
                            'UPDATE product_targets SET targetId = ? WHERE id = ? AND targetId IS NULL',
                            [amazonTargetId, pt.id]
                          );
                          ptCompensated++;
                        } catch (updateErr: any) {
                          if (updateErr.code === 'ER_DUP_ENTRY' || updateErr.errno === 1062) {
                            await ptConn.execute('DELETE FROM product_targets WHERE id = ? AND targetId IS NULL', [pt.id]);
                            ptCompensated++;
                          } else {
                            ptFailed++;
                          }
                        }
                      } else {
                        ptFailed++;
                      }
                    }
                  } catch (agErr: any) {
                    console.error(`[BidOptimization] PT补偿同步: adGroup=${adGroupLocalId}异常: ${agErr.message}`);
                    ptFailed += ptsInGroup.length;
                  }
                }
                
                console.log(`[BidOptimization] PT补偿同步完成: 成功=${ptCompensated}, 失败=${ptFailed}, 总计=${missingPts.length}`);
              }
            } else {
              console.log(`[BidOptimization] PT补偿同步: 该账号下所有product_targets均已有Amazon targetId`);
            }
          } finally {
            await ptConn.end();
          }
        }
      } catch (ptCompensateErr: any) {
        console.error(`[BidOptimization] PT补偿同步机制异常: ${ptCompensateErr.message}`);
      }
      
      apiSyncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
        accountId,
        details.map(d => ({
          keywordId: d.keywordId,
          newBid: d.newBid,
          campaignId: d.campaignId,
          reason: d.reason,
          isProductTarget: d.isProductTarget || false,
        }))
      );
      
      if (apiSyncResult.failed === 0 && apiSyncResult.success > 0) {
        apiSyncStatus = 'synced';
      } else if (apiSyncResult.success === 0) {
        apiSyncStatus = 'failed';
      } else {
        apiSyncStatus = 'partial';
      }
      
      console.log(`[BidOptimization] Amazon API同步: 成功=${apiSyncResult.success}, 失败=${apiSyncResult.failed}, 状态=${apiSyncStatus}`);
      if (apiSyncResult.errors.length > 0) {
        console.error(`[BidOptimization] Amazon API同步错误:`, apiSyncResult.errors.join('; '));
      }
    } catch (apiError: any) {
      apiSyncStatus = 'failed';
      apiSyncResult.errors.push(apiError.message);
      console.error(`[BidOptimization] Amazon API同步异常:`, apiError.message);
    }
  } else if (dryRun) {
    apiSyncStatus = 'pending'; // 模拟模式不同步
  }
  
  // 将API同步结果附加到每个调整详情中，供日志记录使用
  for (const detail of details) {
    detail.apiSyncStatus = apiSyncStatus;
    detail.apiSyncDetail = JSON.stringify({
      totalSuccess: apiSyncResult.success,
      totalFailed: apiSyncResult.failed,
      errors: apiSyncResult.errors.slice(0, 5),
    });
  }
  
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details, apiSyncResult, apiSyncStatus };
}

/**
 * 执行位置优化
 */
async function executePlacementOptimization(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: any[] }> {
  const details: any[] = [];
  let adjustmentsCount = 0;
  
  for (const campaign of campaigns) {
    try {
      // 分析位置表现
      const analysis = await placementOptimizationService.analyzePlacementPerformance(campaign.amazonCampaignId || campaign.id.toString(), config.accountId);
      
      // 生成位置调整建议
      const suggestions = await placementOptimizationService.generatePlacementSuggestions(
        campaign.amazonCampaignId || campaign.id.toString(),
        config.accountId
      );
      
      for (const suggestion of suggestions) {
        const adjustment: any = {
          accountId: config.accountId,
          campaignId: campaign.id,
          campaignName: campaign.name,
          placement: suggestion.placement,
          currentMultiplier: suggestion.currentMultiplier,
          suggestedMultiplier: suggestion.suggestedMultiplier,
          reason: suggestion.reason,
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        
        details.push(adjustment);
        
        if (!dryRun && suggestion.suggestedMultiplier !== suggestion.currentMultiplier) {
          // 实际执行位置调整（本地数据库）
          await placementOptimizationService.applyPlacementAdjustment(
            campaign.amazonCampaignId || campaign.id.toString(),
            config.accountId,
            suggestion
          );
          adjustmentsCount++;
        }
      }
      
      // v134: 同步位置倾斜到 Amazon API，并记录同步状态
      if (!dryRun && suggestions.length > 0) {
        let placementSyncSuccess = false;
        let placementSyncError = '';
        try {
          const amazonCampaignId = campaign.campaignId || campaign.id.toString();
          const topSuggestion = suggestions.find((s: any) => s.placement === 'top_of_search');
          const productSuggestion = suggestions.find((s: any) => s.placement === 'product_page');
          
          if (topSuggestion || productSuggestion) {
            const syncResult = await amazonApiHelper.syncPlacementAdjustmentToAmazon(
              config.accountId,
              amazonCampaignId,
              topSuggestion?.suggestedMultiplier || campaign.placementTopSearchBidAdjustment || 0,
              productSuggestion?.suggestedMultiplier || campaign.placementProductPageBidAdjustment || 0,
              `位置优化: Top=${topSuggestion?.suggestedMultiplier || 0}%, Product=${productSuggestion?.suggestedMultiplier || 0}%`
            );
            placementSyncSuccess = syncResult;
          }
        } catch (apiError: any) {
          placementSyncError = apiError.message;
          console.error(`[PlacementOptimization] Amazon API同步失败 (Campaign ${campaign.campaignName}):`, apiError.message);
        }
        
        // v134: 将同步状态回写到该campaign的所有detail中
        for (const d of details.filter(d => d.campaignId === campaign.id)) {
          d.apiSyncStatus = placementSyncSuccess ? 'synced' : (placementSyncError ? 'failed' : 'pending');
          d.apiSyncDetail = placementSyncError ? JSON.stringify({ error: placementSyncError }) : null;
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        error: error.message,
      });
    }
  }
  
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details };
}

/**
 * 执行分时竞价优化
 */
async function executeDaypartingOptimization(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: any[] }> {
  const details: any[] = [];
  let adjustmentsCount = 0;
  
  // v122h: 使用站点本地时间而非UTC时间
  const marketplace = config.marketplace || 'US';
  const now = new Date();
  const currentHour = getLocalHour(now, marketplace);
  const currentDayOfWeek = getLocalDayOfWeek(now, marketplace);
  
  for (const campaign of campaigns) {
    try {
      // 获取分时策略
      const strategy = await daypartingService.getDaypartingStrategy(campaign.id);
      if (!strategy || strategy.daypartingStatus !== 'active') continue;
      
      // 获取当前时段的调整规则
      const hourlyRule = await daypartingService.getHourlyRule(strategy.id, currentHour, currentDayOfWeek);
      if (!hourlyRule) continue;
      
      const bidMultiplier = parseFloat(hourlyRule.bidMultiplier || '1.00');
      
      // 获取广告活动下的所有关键词
      const keywords = await db.getKeywordsByCampaignId(campaign.id);
      
      for (const keyword of keywords) {
        if (keyword.keywordStatus !== 'enabled') continue;
        
        const baseBid = parseFloat(keyword.bid || '0');
        if (baseBid <= 0) continue;
        
        const adjustedBid = baseBid * bidMultiplier;
        
        const adjustment: any = {
          accountId: config.accountId,
          campaignId: campaign.id,
          campaignName: campaign.name,
          keywordId: keyword.id,
          keywordText: keyword.keywordText,
          hour: currentHour,
          dayOfWeek: currentDayOfWeek,
          baseBid,
          bidMultiplier,
          adjustedBid,
          currentBid: baseBid,
          newBid: adjustedBid,
          reason: `分时竞价: ${currentHour}:00 乘数${bidMultiplier}x, 基础出价$${baseBid.toFixed(2)} → $${adjustedBid.toFixed(2)}`,
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        
        details.push(adjustment);
        
        if (!dryRun && bidMultiplier !== 1.0) {
          // v134: 实际通过 Amazon API 调整出价，并记录同步状态
          try {
            const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
              config.accountId,
              [{
                keywordId: keyword.id,
                newBid: Math.round(adjustedBid * 100) / 100,
                campaignId: campaign.id,
                reason: `分时竞价: ${currentHour}:00 乘数${bidMultiplier}`,
                isProductTarget: false,
              }]
            );
            if (syncResult.success > 0) {
              adjustmentsCount++;
              adjustment.apiSyncStatus = 'synced';
            } else {
              adjustment.apiSyncStatus = 'failed';
              adjustment.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
            }
          } catch (apiError: any) {
            adjustment.apiSyncStatus = 'failed';
            adjustment.apiSyncDetail = JSON.stringify({ error: apiError.message });
            console.error(`[DaypartingOptimization] API同步失败 (kw ${keyword.keywordText}):`, apiError.message);
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        error: error.message,
      });
    }
  }
  
  return { executed: true, adjustmentsCount, details };
}

/**
 * 执行搜索词分析
 */
async function executeSearchTermAnalysis(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; negativeKeywordsAdded: number; newKeywordsAdded: number; details: any[] }> {
  const details: any[] = [];
  let negativeKeywordsAdded = 0;
  let newKeywordsAdded = 0;
  
  for (const campaign of campaigns) {
    try {
      // 获取搜索词数据
      const searchTerms = await db.getSearchTermsByCampaignId(campaign.id);
      
      // 分类搜索词 - 使用简化的分类逻辑
      const searchTermTexts = searchTerms.map(st => st.searchTerm);
      const classification = adAutomation.classifySearchTerms(
        searchTermTexts,
        [], // 产品关键词
        { category: '', brand: '' } // 产品属性
      );
      
      // v122h: 获取品牌词用于保护
      const account = await db.getAdAccountById(config.accountId);
      const brandTerms = account?.brandName ? [account.brandName] : [];
      
      // 处理分类结果
      for (const term of classification) {
        if (term.suggestedAction === 'negative_exact' || term.suggestedAction === 'negative_phrase') {
          // v122h: 品牌词保护 - 不否定含有品牌词的搜索词
          if (brandTerms.length > 0 && isProtectedKeyword(term.searchTerm, brandTerms)) {
            details.push({
              campaignId: campaign.id,
              campaignName: campaign.name,
              searchTerm: term.searchTerm,
              action: 'brand_protect_skip',
              reason: `[品牌词保护] 搜索词"${term.searchTerm}"含有品牌词，跳过否定`,
            });
            continue;
          }
          
          // v122h: 探索期保护 - 检查对应的投放词是否在探索期内
          const matchingKeywords = await db.getKeywordsByCampaignId(campaign.id);
          const matchingKw = matchingKeywords.find((kw: any) => 
            kw.keywordText?.toLowerCase() === term.searchTerm.toLowerCase()
          );
          if (matchingKw?.createdAt) {
            const kwCreatedAt = new Date(matchingKw.createdAt);
            if (isNewKeyword(kwCreatedAt, matchingKw.clicks || 0, matchingKw.impressions || 0, 7)) {
              details.push({
                campaignId: campaign.id,
                campaignName: campaign.name,
                searchTerm: term.searchTerm,
                action: 'exploration_protect_skip',
                reason: `[探索期保护] 对应投放词在探索期内，跳过否定，给予充分的数据积累时间`,
              });
              continue;
            }
          }
          
          const negativeKeyword: any = {
            accountId: config.accountId,
            campaignId: campaign.id,
            campaignName: campaign.name,
            searchTerm: term.searchTerm,
            matchType: term.suggestedAction === 'negative_exact' ? 'negative_exact' : 'negative_phrase',
            action: 'add_negative',
            reason: `负面搜索词: ${term.reason}`,
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          
          details.push(negativeKeyword);
          
          if (!dryRun) {
            const matchType = term.suggestedAction === 'negative_exact' ? 'exact' : 'phrase';
            // 添加否定关键词
            const dbInstance = await db.getDb();
            if (dbInstance) {
              const { negativeKeywords } = await import('../drizzle/schema');
              await dbInstance.insert(negativeKeywords).values({
                accountId: campaign.accountId || 0,
                campaignId: campaign.id,
                negativeLevel: 'campaign',
                negativeType: 'keyword',
                negativeText: term.searchTerm,
                negativeMatchType: matchType === 'exact' ? 'negative_exact' : 'negative_phrase',
                negativeSource: 'ngram_analysis',
                createdAt: new Date().toISOString(),
              });
            }
            negativeKeywordsAdded++;
          }
        } else if (term.suggestedAction === 'target') {
          const newKeyword: any = {
            accountId: config.accountId,
            campaignId: campaign.id,
            campaignName: campaign.name,
            searchTerm: term.searchTerm,
            matchType: (term.matchTypeSuggestion || 'exact'),
            action: 'add_keyword',
            reason: `正面搜索词: ${term.reason}`,
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          
          details.push(newKeyword);
          
          if (!dryRun) {
            // v133: 添加为新关键词 - 先检查去重，再调用Amazon API创建
            const dbInstance = await db.getDb();
            if (dbInstance) {
              // 获取广告组（需要Amazon adGroupId和campaignId）
              const adGroups = await db.getAdGroupsByCampaignId(campaign.id);
              if (adGroups.length > 0) {
                const adGroup = adGroups[0];
                const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                const amazonCampaignId = Number(campaign.campaignId || campaign.id);
                const matchType = (term.matchTypeSuggestion || 'exact') as 'exact' | 'phrase' | 'broad';
                const bid = 0.50;
                
                // v139: 增强去重检查 - 检查本地数据库是否已存在相同关键词（包括keywordId为NULL的重复记录）
                const { keywords } = await import('../drizzle/schema');
                const { eq: eqOp, and: andOp } = await import('drizzle-orm');
                const existingKeywords = await dbInstance.select({ id: keywords.id, keywordId: keywords.keywordId })
                  .from(keywords)
                  .where(andOp(
                    eqOp(keywords.adGroupId, adGroup.id),
                    eqOp(keywords.keywordText, term.searchTerm),
                    eqOp(keywords.matchType, matchType as any)
                  ))
                  .limit(5);
                
                if (existingKeywords.length > 0) {
                  // v139: 如果存在多条重复记录（keywordId为NULL），清理多余的
                  if (existingKeywords.length > 1) {
                    const withId = existingKeywords.filter(k => k.keywordId !== null);
                    const withoutId = existingKeywords.filter(k => k.keywordId === null);
                    // 保留有keywordId的记录，删除多余的无ID记录
                    const toDelete = withId.length > 0 ? withoutId : withoutId.slice(1);
                    for (const dup of toDelete) {
                      try {
                        await dbInstance.delete(keywords).where(eqOp(keywords.id, dup.id));
                        console.log(`[SearchTermAnalysis] 🧹 清理重复关键词: id=${dup.id} "${term.searchTerm}" (keywordId=${dup.keywordId})`);
                      } catch (delErr: any) {
                        console.warn(`[SearchTermAnalysis] 清理重复关键词失败: id=${dup.id}: ${delErr.message}`);
                      }
                    }
                  }
                  console.log(`[SearchTermAnalysis] ⏭️ 关键词已存在，跳过创建: "${term.searchTerm}" (${matchType}) id=${existingKeywords[0].id}, keywordId=${existingKeywords[0].keywordId}`);
                } else {
                  // 插入本地数据库 - v138: 修复缺少accountId和campaignId的问题
                  const insertResult = await dbInstance.insert(keywords).values({
                    accountId: config.accountId || null,
                    campaignId: campaign.campaignId || null,
                    adGroupId: adGroup.id,
                    keywordText: term.searchTerm,
                    matchType: matchType as any,
                    bid: String(bid),
                    keywordStatus: 'enabled',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  });
                  const localKeywordId = (insertResult as any)[0]?.insertId;
                  
                  // 调用Amazon API创建关键词
                  if (amazonAdGroupId > 0 && amazonCampaignId > 0) {
                    try {
                      const apiResult = await amazonApiHelper.syncNewKeywordsToAmazon(
                        config.accountId,
                        [{
                          localKeywordId: localKeywordId || undefined,
                          adGroupId: amazonAdGroupId,
                          campaignId: amazonCampaignId,
                          keywordText: term.searchTerm,
                          matchType: matchType,
                          bid: bid,
                        }]
                      );
                      if (apiResult.success > 0) {
                        newKeyword.apiSyncStatus = 'synced';
                        console.log(`[SearchTermAnalysis] ✅ 新关键词已同步到Amazon: "${term.searchTerm}"`);
                      } else {
                        newKeyword.apiSyncStatus = 'failed';
                        newKeyword.apiSyncDetail = JSON.stringify({ errors: apiResult.errors });
                        console.error(`[SearchTermAnalysis] ❌ 新关键词同步失败: "${term.searchTerm}" - ${apiResult.errors.join('; ')}`);
                      }
                    } catch (apiError: any) {
                      newKeyword.apiSyncStatus = 'failed';
                      newKeyword.apiSyncDetail = JSON.stringify({ error: apiError.message });
                      console.error(`[SearchTermAnalysis] ❌ 新关键词API同步异常: "${term.searchTerm}" -`, apiError.message);
                    }
                  } else {
                    console.warn(`[SearchTermAnalysis] ⚠️ 缺少Amazon ID，无法同步关键词: adGroupId=${amazonAdGroupId}, campaignId=${amazonCampaignId}`);
                  }
                }
              }
            }
            newKeywordsAdded++;
          }
        }
      }
      // v134: 同步否定关键词到 Amazon API，并记录同步状态
      if (!dryRun) {
        const negativeDetails = details.filter(d => d.action === 'add_negative' && d.campaignId === campaign.id);
        if (negativeDetails.length > 0) {
          try {
            const amazonCampaignId = Number(campaign.campaignId || campaign.id);
            const negSyncResult = await amazonApiHelper.syncNegativeKeywordsToAmazon(
              config.accountId,
              negativeDetails.map(d => ({
                campaignId: amazonCampaignId,
                keywordText: d.searchTerm,
                matchType: d.matchType === 'negative_exact' ? 'negativeExact' as const : 'negativePhrase' as const,
                level: 'campaign' as const,
              }))
            );
            // v134: 将同步状态回写到detail中
            const negSyncStatus = negSyncResult.failed === 0 && negSyncResult.success > 0 ? 'synced' : 
                                  negSyncResult.success === 0 ? 'failed' : 'partial';
            for (const d of negativeDetails) {
              d.apiSyncStatus = negSyncStatus;
              if (negSyncResult.errors.length > 0) {
                d.apiSyncDetail = JSON.stringify({ errors: negSyncResult.errors });
              }
            }
            console.log(`[SearchTermAnalysis] Amazon API同步: ${negativeDetails.length}个否定词, 状态=${negSyncStatus} (Campaign ${campaign.campaignName})`);
          } catch (apiError: any) {
            for (const d of negativeDetails) {
              d.apiSyncStatus = 'failed';
              d.apiSyncDetail = JSON.stringify({ error: apiError.message });
            }
            console.error(`[SearchTermAnalysis] Amazon API同步失败 (Campaign ${campaign.campaignName}):`, apiError.message);
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        error: error.message,
      });
    }
  }
  
  return { executed: true, negativeKeywordsAdded, newKeywordsAdded, details };
}

/**
 * 执行预算分配优化
 */
async function executeBudgetAllocation(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: any[] }> {
  const details: any[] = [];
  let adjustmentsCount = 0;
  
  try {
    // 获取预算分配建议
    const budgetResult = await intelligentBudgetAllocationService.generateBudgetAllocationSuggestions(config.id);
    
    for (const suggestion of budgetResult.suggestions) {
      const campaign = campaigns.find(c => c.id === suggestion.campaignId);
      if (!campaign) continue;
      
      const adjustment: any = {
        accountId: config.accountId,
        campaignId: suggestion.campaignId,
        campaignName: campaign.name,
        currentBudget: suggestion.currentBudget,
        suggestedBudget: suggestion.suggestedBudget,
        changeAmount: suggestion.suggestedBudget - suggestion.currentBudget,
        changePercent: ((suggestion.suggestedBudget - suggestion.currentBudget) / suggestion.currentBudget * 100).toFixed(2),
        reason: suggestion.reasons?.join(', ') || '',
        expectedImpact: (suggestion as any).expectedRoasChange || 0,
        apiSyncStatus: dryRun ? 'pending' : 'pending',
      };
      
      details.push(adjustment);
      
      if (!dryRun && Math.abs(suggestion.suggestedBudget - suggestion.currentBudget) > 1) {
        // 实际执行预算调整（本地数据库）
        await db.updateCampaign(suggestion.campaignId, { 
          dailyBudget: suggestion.suggestedBudget.toFixed(2) 
        });
        adjustmentsCount++;
        
        // v134: 同步预算调整到 Amazon API，并记录同步状态
        try {
          const amazonCampaignId = campaign.campaignId || campaign.id.toString();
          const budgetSyncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
            config.accountId,
            amazonCampaignId,
            suggestion.suggestedBudget,
            `预算优化: $${suggestion.currentBudget.toFixed(2)} -> $${suggestion.suggestedBudget.toFixed(2)}`
          );
          adjustment.apiSyncStatus = budgetSyncResult ? 'synced' : 'failed';
        } catch (apiError: any) {
          adjustment.apiSyncStatus = 'failed';
          adjustment.apiSyncDetail = JSON.stringify({ error: apiError.message });
          console.error(`[BudgetAllocation] Amazon API同步失败 (Campaign ${campaign.campaignName}):`, apiError.message);
        }
      }
    }
  } catch (error: any) {
    details.push({ error: error.message });
  }
  
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details };
}

/**
 * 执行投放词状态变更
 */
async function executeKeywordStatusChanges(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; pausedCount: number; enabledCount: number; details: any[] }> {
  const details: any[] = [];
  let pausedCount = 0;
  let enabledCount = 0;
  
  // v122g: 策略感知的动态暂停阈值
  // 不同策略对“高花费无转化”的容忍度不同
  const goal = config.optimizationGoal || 'balanced';
  let pauseSpendThreshold = 50;  // 默认花费阈值
  let pauseClickThreshold = 20;  // 默认点击阈值
  let maxAcosThreshold = (config.targetAcos || 30) * 2.5; // 默认ACoS上限为目标的2.5倍
  
  if (['aggressive-growth', 'seasonal-boost', 'market-expansion'].includes(goal)) {
    // 激进策略：更高的容忍度，允许更多试错成本
    pauseSpendThreshold = 100;
    pauseClickThreshold = 40;
    maxAcosThreshold = (config.targetAcos || 30) * 3.5;
  } else if (['profit-focused', 'brand-defense', 'decline-management'].includes(goal)) {
    // 保守策略：更低的容忍度，但也不能太激进
    pauseSpendThreshold = 35;
    pauseClickThreshold = 15;
    maxAcosThreshold = (config.targetAcos || 30) * 2;
  } else if (['inventory-clearance', 'competitor-attack'].includes(goal)) {
    // 特殊策略：中等容忍度
    pauseSpendThreshold = 70;
    pauseClickThreshold = 30;
    maxAcosThreshold = (config.targetAcos || 30) * 3;
  }
  
  // v122g: 计算组平均AOV，用于动态调整花费阈值
  let totalSalesForAov = 0, totalOrdersForAov = 0;
  for (const c of campaigns) {
    totalSalesForAov += parseFloat(c.sales || '0');
    totalOrdersForAov += (c.orders || 0);
  }
  const groupAov = totalOrdersForAov > 0 ? totalSalesForAov / totalOrdersForAov : 30;
  // 花费阈值至少为1.5倍AOV，确保有足够数据判断
  pauseSpendThreshold = Math.max(pauseSpendThreshold, groupAov * 1.5);
  
  for (const campaign of campaigns) {
    try {
      // 获取广告活动下的所有关键词
      const keywords = await db.getKeywordsByCampaignId(campaign.id);
      
      for (const keyword of keywords) {
        const spend = parseFloat(keyword.spend || '0');
        const sales = parseFloat(keyword.sales || '0');
        const clicks = keyword.clicks || 0;
        const conversions = keyword.orders || 0;
        const impressions = keyword.impressions || 0;
        const acos = sales > 0 ? (spend / sales * 100) : 0;
        
        // v122g: 多维度暂停判断（替代原来的粗暴硬编码阈值）
        let shouldPause = false;
        let pauseReason = '';
        
        if (keyword.keywordStatus === 'enabled') {
          // 条件1：高花费零转化（使用动态阈值）
          if (spend > pauseSpendThreshold && conversions === 0 && clicks > pauseClickThreshold) {
            shouldPause = true;
            pauseReason = `高花费零转化: 花费$${spend.toFixed(2)}(>阈值$${pauseSpendThreshold.toFixed(0)}), 点击${clicks}(>阈值${pauseClickThreshold}), 转化${conversions}`;
          }
          // 条件2：ACoS远超目标且数据充足
          else if (acos > maxAcosThreshold && clicks > pauseClickThreshold && conversions > 0) {
            shouldPause = true;
            pauseReason = `ACoS远超目标: ACoS ${acos.toFixed(1)}%(>阈值${maxAcosThreshold.toFixed(0)}%), 点击${clicks}, 转化${conversions}`;
          }
          
          // v122h: 探索期保护 - 新关键词在7天探索期内不执行暂停
          if (shouldPause && keyword.createdAt) {
            const keywordCreatedAt = new Date(keyword.createdAt);
            const isNew = isNewKeyword(keywordCreatedAt, clicks, impressions, 7);
            if (isNew) {
              shouldPause = false;
              const explorationInfo = getExplorationStrategy(keywordCreatedAt, clicks, impressions, parseFloat(keyword.bid || '0'));
              details.push({
                campaignId: campaign.id,
                campaignName: campaign.name,
                keywordId: keyword.id,
                keywordText: keyword.keywordText,
                action: 'exploration_protect',
                reason: `[探索期保护] 关键词在探索期内(剩余${explorationInfo.explorationDaysRemaining}天)，策略:${explorationInfo.strategy}，不执行暂停`,
                currentStatus: keyword.keywordStatus,
              });
              continue;
            }
          }
          
          // v122h: 品牌词保护 - 品牌词不自动暂停，仅记录警告
          if (shouldPause) {
            const account = await db.getAdAccountById(config.accountId);
            const brandTerms = account?.brandName ? [account.brandName] : [];
            if (brandTerms.length > 0 && isProtectedKeyword(keyword.keywordText, brandTerms)) {
              shouldPause = false;
              details.push({
                campaignId: campaign.id,
                campaignName: campaign.name,
                keywordId: keyword.id,
                keywordText: keyword.keywordText,
                action: 'brand_protect',
                reason: `[品牌词保护] 品牌关键词"${keyword.keywordText}"不自动暂停，建议人工评估`,
                currentStatus: keyword.keywordStatus,
              });
              continue;
            }
          }
          
          // v122g+h: 低数据量保护 - 如果数据量太少，不执行暂停，给予更多观察时间
          if (shouldPause && clicks < 10 && spend < groupAov) {
            shouldPause = false;
            details.push({
              campaignId: campaign.id,
              campaignName: campaign.name,
              keywordId: keyword.id,
              keywordText: keyword.keywordText,
              action: 'observe',
              reason: `[观察期] 数据量不足(点击${clicks},花费$${spend.toFixed(2)})，继续观察而非直接暂停`,
              currentStatus: keyword.keywordStatus,
            });
            continue;
          }
        }
        
        // v122g: 更智能的启用判断
        let shouldEnable = false;
        let enableReason = '';
        
        if (keyword.keywordStatus === 'paused') {
          // 条件1：有转化且ACoS在目标范围内
          if (acos > 0 && acos < (config.targetAcos || 30)) {
            shouldEnable = true;
            enableReason = `表现改善: ACoS ${acos.toFixed(2)}%(目标${config.targetAcos || 30}%)`;
          }
          // v122g 条件2：历史CVR尚可，可以尝试重新探索
          else if (conversions > 0 && clicks > 5) {
            const cvr = conversions / clicks;
            if (cvr > 0.02) { // CVR > 2%说明有转化潜力
              shouldEnable = true;
              enableReason = `[探索模式重启] 历史CVR ${(cvr * 100).toFixed(1)}%尚可，尝试以探索性出价重新启用`;
            }
          }
        }
        
        if (shouldPause) {
          const action: any = {
            accountId: config.accountId,
            campaignId: campaign.id,
            campaignName: campaign.name,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: 'pause',
            reason: pauseReason,
            currentStatus: keyword.keywordStatus,
            newStatus: 'paused',
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          
          details.push(action);
          
          if (!dryRun) {
            // v134: 先更新本地数据库
            await db.updateKeyword(keyword.id, { keywordStatus: 'paused' });
            pausedCount++;
            
            // v134: 同步到Amazon API - 这是之前缺失的关键步骤
            try {
              const syncResult = await amazonApiHelper.syncKeywordStatusToAmazon(
                config.accountId,
                [{
                  keywordId: keyword.id,
                  newStatus: 'paused',
                  campaignId: campaign.id,
                  reason: pauseReason,
                  isProductTarget: false,
                }]
              );
              action.apiSyncStatus = syncResult.success > 0 ? 'synced' : 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
            } catch (apiError: any) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
              console.error(`[KeywordStatusChange] Amazon API同步失败 (暂停 ${keyword.keywordText}):`, apiError.message);
            }
          }
        } else if (shouldEnable) {
          const action: any = {
            accountId: config.accountId,
            campaignId: campaign.id,
            campaignName: campaign.name,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: 'enable',
            reason: enableReason,
            currentStatus: keyword.keywordStatus,
            newStatus: 'enabled',
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          
          details.push(action);
          
          if (!dryRun) {
            // v134: 先更新本地数据库
            await db.updateKeyword(keyword.id, { keywordStatus: 'enabled' });
            enabledCount++;
            
            // v134: 同步到Amazon API - 这是之前缺失的关键步骤
            try {
              const syncResult = await amazonApiHelper.syncKeywordStatusToAmazon(
                config.accountId,
                [{
                  keywordId: keyword.id,
                  newStatus: 'enabled',
                  campaignId: campaign.id,
                  reason: enableReason,
                  isProductTarget: false,
                }]
              );
              action.apiSyncStatus = syncResult.success > 0 ? 'synced' : 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
            } catch (apiError: any) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
              console.error(`[KeywordStatusChange] Amazon API同步失败 (启用 ${keyword.keywordText}):`, apiError.message);
            }
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        error: error.message,
      });
    }
  }
  
  return { executed: true, pausedCount, enabledCount, details };
}

/**
 * v135: 执行广告活动状态变更
 * 自动判断广告活动是否应该暂停或启用，并同步到Amazon
 */
async function executeCampaignStatusChanges(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; pausedCount: number; enabledCount: number; details: any[] }> {
  const details: any[] = [];
  let pausedCount = 0;
  let enabledCount = 0;
  
  const goal = config.optimizationGoal || 'balanced';
  const targetAcos = config.targetAcos || 30;
  
  // 广告活动暂停阈值（比关键词更保守，因为影响范围更大）
  let campaignPauseSpendThreshold = 200;
  let campaignPauseClickThreshold = 100;
  let campaignMaxAcosThreshold = targetAcos * 3;
  
  if (['profit-focused', 'brand-defense', 'decline-management'].includes(goal)) {
    campaignPauseSpendThreshold = 150;
    campaignPauseClickThreshold = 80;
    campaignMaxAcosThreshold = targetAcos * 2.5;
  }
  
  for (const campaign of campaigns) {
    try {
      const spend = parseFloat(campaign.spend || '0');
      const sales = parseFloat(campaign.sales || '0');
      const clicks = campaign.clicks || 0;
      const conversions = campaign.orders || 0;
      const acos = sales > 0 ? (spend / sales * 100) : 0;
      const campaignStatus = campaign.campaignStatus || 'enabled';
      
      let shouldPause = false;
      let pauseReason = '';
      let shouldEnable = false;
      let enableReason = '';
      
      if (campaignStatus === 'enabled') {
        // 条件1：高花费零转化
        if (spend > campaignPauseSpendThreshold && conversions === 0 && clicks > campaignPauseClickThreshold) {
          shouldPause = true;
          pauseReason = `广告活动高花费零转化: 花费$${spend.toFixed(2)}(>阈值$${campaignPauseSpendThreshold}), 点击${clicks}(>阈值${campaignPauseClickThreshold}), 转化${conversions}`;
        }
        // 条件2：ACoS远超目标
        else if (acos > campaignMaxAcosThreshold && clicks > campaignPauseClickThreshold && conversions > 0) {
          shouldPause = true;
          pauseReason = `广告活动ACoS远超目标: ACoS ${acos.toFixed(1)}%(>阈值${campaignMaxAcosThreshold.toFixed(0)}%), 点击${clicks}, 转化${conversions}`;
        }
      } else if (campaignStatus === 'paused') {
        // 广告活动启用判断：仅在有明确改善时启用
        if (acos > 0 && acos < targetAcos * 0.8) {
          shouldEnable = true;
          enableReason = `广告活动表现改善: ACoS ${acos.toFixed(1)}%(目标${targetAcos}%), 建议重新启用`;
        }
      }
      
      if (shouldPause) {
        const action: any = {
          accountId: config.accountId,
          entityType: 'campaign',
          campaignId: campaign.id,
          campaignName: campaign.name || campaign.campaignName,
          amazonCampaignId: campaign.campaignId || campaign.amazonCampaignId,
          action: 'pause',
          reason: pauseReason,
          currentStatus: campaignStatus,
          newStatus: 'paused',
          spend: spend,
          sales: sales,
          clicks: clicks,
          conversions: conversions,
          acos: acos,
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        details.push(action);
        
        if (!dryRun) {
          await db.updateCampaign(campaign.id, { campaignStatus: 'paused' });
          pausedCount++;
          
          try {
            const syncResult = await amazonApiHelper.syncCampaignStatusToAmazon(
              config.accountId,
              [{
                campaignId: campaign.id,
                amazonCampaignId: String(campaign.campaignId || campaign.amazonCampaignId || ''),
                newStatus: 'paused',
                campaignName: campaign.name || campaign.campaignName || '',
                reason: pauseReason,
              }]
            );
            action.apiSyncStatus = syncResult.success > 0 ? 'synced' : 'failed';
            if (syncResult.errors.length > 0) {
              action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
            }
          } catch (apiError: any) {
            action.apiSyncStatus = 'failed';
            action.apiSyncDetail = JSON.stringify({ error: apiError.message });
          }
        }
      } else if (shouldEnable) {
        const action: any = {
          accountId: config.accountId,
          entityType: 'campaign',
          campaignId: campaign.id,
          campaignName: campaign.name || campaign.campaignName,
          amazonCampaignId: campaign.campaignId || campaign.amazonCampaignId,
          action: 'enable',
          reason: enableReason,
          currentStatus: campaignStatus,
          newStatus: 'enabled',
          spend: spend,
          sales: sales,
          clicks: clicks,
          conversions: conversions,
          acos: acos,
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        details.push(action);
        
        if (!dryRun) {
          await db.updateCampaign(campaign.id, { campaignStatus: 'enabled' });
          enabledCount++;
          
          try {
            const syncResult = await amazonApiHelper.syncCampaignStatusToAmazon(
              config.accountId,
              [{
                campaignId: campaign.id,
                amazonCampaignId: String(campaign.campaignId || campaign.amazonCampaignId || ''),
                newStatus: 'enabled',
                campaignName: campaign.name || campaign.campaignName || '',
                reason: enableReason,
              }]
            );
            action.apiSyncStatus = syncResult.success > 0 ? 'synced' : 'failed';
            if (syncResult.errors.length > 0) {
              action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
            }
          } catch (apiError: any) {
            action.apiSyncStatus = 'failed';
            action.apiSyncDetail = JSON.stringify({ error: apiError.message });
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.name || campaign.campaignName,
        entityType: 'campaign',
        error: error.message,
      });
    }
  }
  
  return { executed: true, pausedCount, enabledCount, details };
}

/**
 * v135: 执行广告组状态变更
 * 自动判断广告组是否应该暂停或启用，并同步到Amazon
 */
async function executeAdGroupStatusChanges(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; pausedCount: number; enabledCount: number; details: any[] }> {
  const details: any[] = [];
  let pausedCount = 0;
  let enabledCount = 0;
  
  const targetAcos = config.targetAcos || 30;
  
  // 广告组暂停阈值（介于广告活动和关键词之间）
  let adGroupPauseSpendThreshold = 100;
  let adGroupPauseClickThreshold = 50;
  let adGroupMaxAcosThreshold = targetAcos * 2.8;
  
  for (const campaign of campaigns) {
    try {
      const adGroups = await db.getAdGroupsByCampaignId(campaign.id);
      
      for (const adGroup of adGroups) {
        const spend = parseFloat(adGroup.spend || '0');
        const sales = parseFloat(adGroup.sales || '0');
        const clicks = adGroup.clicks || 0;
        const conversions = adGroup.orders || 0;
        const acos = sales > 0 ? (spend / sales * 100) : 0;
        const adGroupStatus = adGroup.adGroupStatus || 'enabled';
        
        let shouldPause = false;
        let pauseReason = '';
        let shouldEnable = false;
        let enableReason = '';
        
        if (adGroupStatus === 'enabled') {
          if (spend > adGroupPauseSpendThreshold && conversions === 0 && clicks > adGroupPauseClickThreshold) {
            shouldPause = true;
            pauseReason = `广告组高花费零转化: 花费$${spend.toFixed(2)}(>阈值$${adGroupPauseSpendThreshold}), 点击${clicks}(>阈值${adGroupPauseClickThreshold}), 转化${conversions}`;
          } else if (acos > adGroupMaxAcosThreshold && clicks > adGroupPauseClickThreshold && conversions > 0) {
            shouldPause = true;
            pauseReason = `广告组ACoS远超目标: ACoS ${acos.toFixed(1)}%(>阈值${adGroupMaxAcosThreshold.toFixed(0)}%), 点击${clicks}, 转化${conversions}`;
          }
        } else if (adGroupStatus === 'paused') {
          if (acos > 0 && acos < targetAcos * 0.8) {
            shouldEnable = true;
            enableReason = `广告组表现改善: ACoS ${acos.toFixed(1)}%(目标${targetAcos}%), 建议重新启用`;
          }
        }
        
        if (shouldPause) {
          const action: any = {
            accountId: config.accountId,
            entityType: 'adGroup',
            campaignId: campaign.id,
            campaignName: campaign.name || campaign.campaignName,
            adGroupId: adGroup.id,
            adGroupName: adGroup.adGroupName || adGroup.name,
            amazonAdGroupId: adGroup.adGroupId || adGroup.amazonAdGroupId,
            action: 'pause',
            reason: pauseReason,
            currentStatus: adGroupStatus,
            newStatus: 'paused',
            spend: spend,
            sales: sales,
            clicks: clicks,
            conversions: conversions,
            acos: acos,
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          details.push(action);
          
          if (!dryRun) {
            await db.updateAdGroupStatus(adGroup.id, 'paused');
            pausedCount++;
            
            try {
              const syncResult = await amazonApiHelper.syncAdGroupStatusToAmazon(
                config.accountId,
                [{
                  adGroupId: adGroup.id,
                  amazonAdGroupId: String(adGroup.adGroupId || adGroup.amazonAdGroupId || ''),
                  newStatus: 'paused',
                  adGroupName: adGroup.adGroupName || adGroup.name || '',
                  campaignName: campaign.name || campaign.campaignName || '',
                  reason: pauseReason,
                }]
              );
              action.apiSyncStatus = syncResult.success > 0 ? 'synced' : 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
            } catch (apiError: any) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            }
          }
        } else if (shouldEnable) {
          const action: any = {
            accountId: config.accountId,
            entityType: 'adGroup',
            campaignId: campaign.id,
            campaignName: campaign.name || campaign.campaignName,
            adGroupId: adGroup.id,
            adGroupName: adGroup.adGroupName || adGroup.name,
            amazonAdGroupId: adGroup.adGroupId || adGroup.amazonAdGroupId,
            action: 'enable',
            reason: enableReason,
            currentStatus: adGroupStatus,
            newStatus: 'enabled',
            spend: spend,
            sales: sales,
            clicks: clicks,
            conversions: conversions,
            acos: acos,
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          details.push(action);
          
          if (!dryRun) {
            await db.updateAdGroupStatus(adGroup.id, 'enabled');
            enabledCount++;
            
            try {
              const syncResult = await amazonApiHelper.syncAdGroupStatusToAmazon(
                config.accountId,
                [{
                  adGroupId: adGroup.id,
                  amazonAdGroupId: String(adGroup.adGroupId || adGroup.amazonAdGroupId || ''),
                  newStatus: 'enabled',
                  adGroupName: adGroup.adGroupName || adGroup.name || '',
                  campaignName: campaign.name || campaign.campaignName || '',
                  reason: enableReason,
                }]
              );
              action.apiSyncStatus = syncResult.success > 0 ? 'synced' : 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
            } catch (apiError: any) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            }
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.name || campaign.campaignName,
        entityType: 'adGroup',
        error: error.message,
      });
    }
  }
  
  return { executed: true, pausedCount, enabledCount, details };
}

/**
 * 执行中央竞价协调
 * 收集bidOptimizer、daypartingService、placementService的建议
 * 计算理论最高CPC并实施熔断机制
 */
async function executeBidCoordination(
  config: OptimizationTargetConfig,
  campaigns: any[],
  bidDetails: any[],
  placementDetails: any[],
  daypartingDetails: any[],
  dryRun: boolean
): Promise<{ executed: boolean; campaignsCoordinated: number; circuitBreakerTriggered: number; details: any[] }> {
  const details: any[] = [];
  let campaignsCoordinated = 0;
  let circuitBreakerTriggered = 0;
  
  // 按广告活动分组处理
  for (const campaign of campaigns) {
    try {
      const proposals: bidCoordinator.BidProposal[] = [];
      
      // 1. 收集出价优化建议
      const bidSuggestions = bidDetails.filter(d => d.campaignId === campaign.id);
      for (const suggestion of bidSuggestions) {
        if (suggestion.newBid && suggestion.currentBid) {
          const multiplier = suggestion.newBid / suggestion.currentBid;
          proposals.push(bidCoordinator.createBidProposal(
            campaign.id,
            'campaign',
            'base_algo',
            {
              suggestedMultiplier: multiplier,
              confidence: 0.85,
              reason: suggestion.reason || '基于市场曲线的最优出价调整',
            }
          ));
        }
      }
      
      // 2. 收集位置优化建议
      const placementSuggestions = placementDetails.filter(d => d.campaignId === campaign.id);
      for (const suggestion of placementSuggestions) {
        if (suggestion.suggestedMultiplier !== undefined) {
          proposals.push(bidCoordinator.createBidProposal(
            campaign.id,
            'campaign',
            'placement',
            {
              suggestedMultiplier: 1 + (suggestion.suggestedMultiplier - suggestion.currentMultiplier) / 100,
              confidence: 0.75,
              reason: suggestion.reason || '位置效率优化',
            }
          ));
        }
      }
      
      // 3. 收集分时策略建议
      const daypartingSuggestions = daypartingDetails.filter(d => d.campaignId === campaign.id);
      for (const suggestion of daypartingSuggestions) {
        if (suggestion.bidMultiplier && suggestion.bidMultiplier !== 1) {
          proposals.push(bidCoordinator.createBidProposal(
            campaign.id,
            'campaign',
            'dayparting',
            {
              suggestedMultiplier: suggestion.bidMultiplier,
              confidence: 0.8,
              reason: `分时策略: ${suggestion.hour}:00 乘数${suggestion.bidMultiplier}`,
            }
          ));
        }
      }
      
      // 如果没有建议，跳过该广告活动
      if (proposals.length === 0) continue;
      
      // 4. 获取当前广告活动的竞价配置
      const currentBaseBid = parseFloat(campaign.defaultBid || '1');
      const currentPlacementMultiplier = parseFloat(campaign.topOfSearchMultiplier || '0');
      const currentDaypartingMultiplier = 1; // 分时乘数需要从策略中获取
      
      // 5. 调用中央协调器
      const coordinatedResult = await bidCoordinator.applyCoordinatedBids(
        campaign.amazonCampaignId || campaign.id.toString(),
        config.accountId,
        proposals,
        currentBaseBid,
        currentPlacementMultiplier,
        currentDaypartingMultiplier
      );
      
      // 6. 记录协调结果
      const coordinationDetail = {
        campaignId: campaign.id,
        campaignName: campaign.name,
        proposalsCount: proposals.length,
        originalBaseBid: coordinatedResult.originalBaseBid,
        finalBaseBid: coordinatedResult.finalBaseBid,
        theoreticalMaxCPC: coordinatedResult.theoreticalMaxCPC,
        effectiveMultiplier: coordinatedResult.effectiveMultiplier,
        circuitBreakerTriggered: coordinatedResult.circuitBreakerTriggered,
        circuitBreakerReason: coordinatedResult.circuitBreakerReason,
        warnings: coordinatedResult.warnings,
      };
      
      details.push(coordinationDetail);
      campaignsCoordinated++;
      
      if (coordinatedResult.circuitBreakerTriggered) {
        circuitBreakerTriggered++;
      }
      
      // 7. 如果不是干运行且有实际调整，记录日志
      if (!dryRun && coordinatedResult.finalBaseBid !== coordinatedResult.originalBaseBid) {
        console.log(`[BidCoordination] 广告活动 ${campaign.name} 竞价协调完成:`, {
          original: coordinatedResult.originalBaseBid,
          final: coordinatedResult.finalBaseBid,
          maxCPC: coordinatedResult.theoreticalMaxCPC,
          circuitBreaker: coordinatedResult.circuitBreakerTriggered,
        });
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        error: error.message,
      });
    }
  }
  
  return { executed: true, campaignsCoordinated, circuitBreakerTriggered, details };
}

/**
 * 记录执行日志
 */
async function recordExecutionLog(result: OptimizationExecutionResult): Promise<void> {
  const dbInstance = await db.getDb();
  if (!dbInstance) return;
  
  try {
    const { optimizationLogs } = await import('../drizzle/schema');
    const now = new Date().toISOString();
    
    // 记录出价调整日志（包含Amazon API同步状态）
    if (result.bidOptimization.executed && result.bidOptimization.adjustmentsCount > 0) {
      const bidApiSyncStatus = (result.bidOptimization as any).apiSyncStatus || 'pending';
      const bidApiSyncResult = (result.bidOptimization as any).apiSyncResult;
      console.log(`[recordExecutionLog] 出价调整日志: bidApiSyncStatus=${bidApiSyncStatus}, details=${result.bidOptimization.details.length}`);
      
      for (const detail of result.bidOptimization.details) {
        const finalSyncStatus = detail.apiSyncStatus || bidApiSyncStatus || 'pending';
        try {
          await dbInstance.insert(optimizationLogs).values({
            performanceGroupId: result.targetId,
            performanceGroupName: result.targetName,
            accountId: detail.accountId || 0,
            logCategory: 'bid_adjustment',
            actionType: detail.newBid > detail.currentBid ? 'bid_increase' : 'bid_decrease',
            campaignId: detail.campaignId,
            campaignName: detail.campaignName,
            actionDetail: JSON.stringify(detail),
            previousValue: `$${detail.currentBid.toFixed(2)}`,
            newValue: `$${detail.newBid.toFixed(2)}`,
            changeReason: detail.reason || `出价调整 ${detail.changePercent}%`,
            status: finalSyncStatus === 'synced' || finalSyncStatus === 'partial' ? 'success' : finalSyncStatus === 'failed' ? 'failed' : 'success',
            apiSyncStatus: finalSyncStatus,
            apiSyncDetail: detail.apiSyncDetail || (bidApiSyncResult ? JSON.stringify(bidApiSyncResult) : null),
            apiSyncedAt: (finalSyncStatus === 'synced' || finalSyncStatus === 'partial') ? now : null,
            errorMessage: finalSyncStatus === 'failed' && bidApiSyncResult?.errors?.length > 0 ? bidApiSyncResult.errors.join('; ') : null,
            createdAt: now,
            executedAt: now,
          });
        } catch (insertError: any) {
          console.error(`[recordExecutionLog] 出价日志写入失败: ${insertError.message}`, { keywordId: detail.keywordId, finalSyncStatus });
        }
      }
    }
    
    // 记录位置调整日志（包含Amazon API同步状态）
    if (result.placementOptimization.executed && result.placementOptimization.adjustmentsCount > 0) {
      for (const detail of result.placementOptimization.details) {
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: detail.accountId || 0,
          logCategory: 'placement_adjustment',
          actionType: 'placement_adjust',
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: detail.previousValue || `${detail.placement}: ${detail.currentMultiplier}%`,
          newValue: detail.newValue || `${detail.placement}: ${detail.suggestedMultiplier}%`,
          changeReason: detail.reason || `位置优化: ${detail.placement} ${detail.currentMultiplier}% → ${detail.suggestedMultiplier}%`,
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // 记录搜索词分析日志（否定词和新关键词，包含API同步状态）
    if (result.searchTermAnalysis.executed) {
      for (const detail of result.searchTermAnalysis.details) {
        const actionType = detail.action === 'add_negative' ? 'negative_keyword_add' : 'keyword_create';
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: detail.accountId || 0,
          logCategory: 'optimization_settings',
          actionType: actionType,
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: '',
          newValue: detail.searchTerm || '',
          changeReason: detail.reason || '',
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v134: 记录分时竞价日志（包含API同步状态）
    if (result.daypartingOptimization.executed && result.daypartingOptimization.adjustmentsCount > 0) {
      for (const detail of result.daypartingOptimization.details) {
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: detail.accountId || 0,
          logCategory: 'bid_adjustment',
          actionType: 'dayparting_bid',
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: `$${detail.baseBid?.toFixed(2) || '0.00'}`,
          newValue: `$${detail.adjustedBid?.toFixed(2) || '0.00'}`,
          changeReason: detail.reason || `分时竞价: ${detail.hour}:00 乘数${detail.bidMultiplier}x`,
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v134: 记录预算分配日志（包含API同步状态）
    if (result.budgetAllocation.executed && result.budgetAllocation.adjustmentsCount > 0) {
      for (const detail of result.budgetAllocation.details) {
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: detail.accountId || 0,
          logCategory: 'optimization_settings',
          actionType: 'budget_adjustment',
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: `$${detail.currentBudget?.toFixed(2) || '0.00'}`,
          newValue: `$${detail.suggestedBudget?.toFixed(2) || '0.00'}`,
          changeReason: detail.reason || `预算调整 ${detail.changePercent}%`,
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // 记录投放词状态变更日志（包含API同步状态）
    if (result.keywordStatusChanges.executed) {
      for (const detail of result.keywordStatusChanges.details) {
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: detail.accountId || 0,
          logCategory: 'bid_adjustment',
          actionType: detail.action === 'pause' ? 'target_pause' : 'target_enable',
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: detail.currentStatus || '',
          newValue: detail.action || '',
          changeReason: detail.reason || '',
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v135: 记录广告活动状态变更日志
    if (result.campaignStatusChanges.executed) {
      for (const detail of result.campaignStatusChanges.details) {
        if (detail.error) continue; // 跳过错误记录
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: detail.accountId || 0,
          logCategory: 'optimization_settings',
          actionType: detail.action === 'pause' ? 'campaign_pause' : 'campaign_enable',
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: detail.currentStatus || '',
          newValue: detail.newStatus || '',
          changeReason: detail.reason || '',
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v135: 记录广告组状态变更日志
    if (result.adGroupStatusChanges.executed) {
      for (const detail of result.adGroupStatusChanges.details) {
        if (detail.error) continue; // 跳过错误记录
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: detail.accountId || 0,
          logCategory: 'optimization_settings',
          actionType: detail.action === 'pause' ? 'adgroup_pause' : 'adgroup_enable',
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: detail.currentStatus || '',
          newValue: detail.newStatus || '',
          changeReason: detail.reason || `广告组 "${detail.adGroupName}" ${detail.action === 'pause' ? '暂停' : '启用'}`,
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v139: 更新优化目标的 last_optimization_at 时间戳
    try {
      const { performanceGroups } = await import('../drizzle/schema');
      const { eq: eqOp } = await import('drizzle-orm');
      await dbInstance.update(performanceGroups)
        .set({ lastOptimizationAt: new Date() } as any)
        .where(eqOp(performanceGroups.id, result.targetId));
      console.log(`[OptimizationTargetEngine] 已更新 last_optimization_at: targetId=${result.targetId}`);
    } catch (updateErr: any) {
      // 如果Drizzle ORM的casing映射有问题，使用mysql2直接更新
      try {
        const mysql2 = await import('mysql2/promise');
        const dbUrl = process.env.DATABASE_URL;
        if (dbUrl) {
          const directConn = await mysql2.createConnection(dbUrl);
          await directConn.execute(
            'UPDATE performance_groups SET last_optimization_at = NOW() WHERE id = ?',
            [result.targetId]
          );
          await directConn.end();
          console.log(`[OptimizationTargetEngine] 已通过mysql2更新 last_optimization_at: targetId=${result.targetId}`);
        }
      } catch (directErr: any) {
        console.error(`[OptimizationTargetEngine] 更新last_optimization_at失败: ${directErr.message}`);
      }
    }
    
    console.log(`[OptimizationTargetEngine] 执行日志已写入数据库: ${result.targetName}`, {
      status: result.status,
      bidAdjustments: result.bidOptimization.adjustmentsCount,
      placementAdjustments: result.placementOptimization.adjustmentsCount,
      negativeKeywords: result.searchTermAnalysis.negativeKeywordsAdded,
      newKeywords: result.searchTermAnalysis.newKeywordsAdded,
      keywordsPaused: result.keywordStatusChanges.pausedCount,
      keywordsEnabled: result.keywordStatusChanges.enabledCount,
      campaignsPaused: result.campaignStatusChanges.pausedCount,
      campaignsEnabled: result.campaignStatusChanges.enabledCount,
      adGroupsPaused: result.adGroupStatusChanges.pausedCount,
      adGroupsEnabled: result.adGroupStatusChanges.enabledCount,
    });
  } catch (error: any) {
    console.error(`[OptimizationTargetEngine] 日志写入失败:`, error.message);
    // 回退到console.log
    console.log(`[OptimizationTargetEngine] 执行完成(日志回退): ${result.targetName}`, {
      status: result.status,
      errors: result.errors.length,
    });
  }
}

/**
 * 获取所有启用的优化目标
 */
export async function getEnabledOptimizationTargets(accountId?: number): Promise<OptimizationTargetConfig[]> {
  const dbInstance = await db.getDb();
  if (!dbInstance) return [];
  
  const groups = accountId 
    ? await db.getPerformanceGroupsByAccountId(accountId)
    : await db.getPerformanceGroupsByAccountId(0);
  
  const configs: OptimizationTargetConfig[] = [];
  
  for (const group of groups) {
    // 只执行 status='active' 且 autoOptimize 开启的优化目标
    if (group.status === 'active' && (group as any).autoOptimize !== 0) {
      const config = await getOptimizationTargetConfig(group.id);
      if (config) {
        configs.push(config);
      }
    }
  }
  
  return configs;
}

/**
 * 批量执行所有启用的优化目标
 * v122: 支持 specificModules 参数，实现模块隔离执行
 */
export async function executeAllEnabledTargets(
  accountId?: number,
  options: { dryRun?: boolean; specificModules?: string[] } = {}
): Promise<OptimizationExecutionResult[]> {
  const targets = await getEnabledOptimizationTargets(accountId);
  const results: OptimizationExecutionResult[] = [];
  
  const modulesDesc = options.specificModules?.length ? options.specificModules.join(',') : 'all';
  console.log(`[OptimizationTargetEngine] 批量执行 ${targets.length} 个优化目标, 模块: ${modulesDesc}`);
  
  for (const target of targets) {
    try {
      const result = await executeOptimizationTarget(target.id, options);
      results.push(result);
    } catch (error: any) {
      results.push({
        targetId: target.id,
        targetName: target.name,
        executionTime: new Date(),
        status: 'failed',
        bidOptimization: { executed: false, adjustmentsCount: 0, details: [] },
        placementOptimization: { executed: false, adjustmentsCount: 0, details: [] },
        daypartingOptimization: { executed: false, adjustmentsCount: 0, details: [] },
        searchTermAnalysis: { executed: false, negativeKeywordsAdded: 0, newKeywordsAdded: 0, details: [] },
        budgetAllocation: { executed: false, adjustmentsCount: 0, details: [] },
        keywordStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
        campaignStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
        adGroupStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
        bidCoordination: { executed: false, campaignsCoordinated: 0, circuitBreakerTriggered: 0, details: [] },
        errors: [error.message],
        warnings: [],
      });
    }
  }
  
  return results;
}

/**
 * 获取优化目标的执行摘要
 */
export async function getOptimizationTargetSummary(targetId: number): Promise<{
  config: OptimizationTargetConfig | null;
  campaignsCount: number;
  keywordsCount: number;
  lastExecution?: OptimizationExecutionResult;
  pendingActions: {
    bidAdjustments: number;
    placementAdjustments: number;
    negativeKeywords: number;
    budgetAdjustments: number;
  };
}> {
  const config = await getOptimizationTargetConfig(targetId);
  if (!config) {
    return {
      config: null,
      campaignsCount: 0,
      keywordsCount: 0,
      pendingActions: {
        bidAdjustments: 0,
        placementAdjustments: 0,
        negativeKeywords: 0,
        budgetAdjustments: 0,
      },
    };
  }
  
  const campaigns = await db.getCampaignsByPerformanceGroupId(targetId);
  let keywordsCount = 0;
  
  for (const campaign of campaigns) {
    const keywords = await db.getKeywordsByCampaignId(campaign.id);
    keywordsCount += keywords.length;
  }
  
  // 执行干运行获取待处理操作数量
  const dryRunResult = await executeOptimizationTarget(targetId, { dryRun: true, forceExecution: true });
  
  return {
    config,
    campaignsCount: campaigns.length,
    keywordsCount,
    pendingActions: {
      bidAdjustments: dryRunResult.bidOptimization.details.length,
      placementAdjustments: dryRunResult.placementOptimization.details.length,
      negativeKeywords: dryRunResult.searchTermAnalysis.negativeKeywordsAdded,
      budgetAdjustments: dryRunResult.budgetAllocation.details.length,
    },
  };
}
