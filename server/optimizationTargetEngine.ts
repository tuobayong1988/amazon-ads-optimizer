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
  
  // 7. 执行中央竞价协调（收集各服务建议并统一处理）
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
      
      // v129: 补偿同步机制 - 通过Amazon API查询已存在关键词的keywordId并回填到本地数据库
      try {
        const dbInstance = await db.getDb();
        if (dbInstance) {
          const { keywords: kwTable, adGroups: agTable, campaigns: campTable } = await import('../drizzle/schema');
          const { eq, isNull, and, inArray, sql: sqlTag } = await import('drizzle-orm');
          
          // 查询该账号下所有缺少keywordId的关键词（通过JOIN关联查询）
          const missingKws = await dbInstance.select({
            id: kwTable.id,
            adGroupId: kwTable.adGroupId,
            keywordText: kwTable.keywordText,
            matchType: kwTable.matchType,
            bid: kwTable.bid,
          })
            .from(kwTable)
            .innerJoin(agTable, eq(kwTable.adGroupId, agTable.id))
            .innerJoin(campTable, eq(agTable.campaignId, campTable.id))
            .where(and(
              eq(campTable.accountId, accountId),
              isNull(kwTable.keywordId)
            ));
          
          if (missingKws.length > 0) {
            console.log(`[BidOptimization] 补偿同步: 发现账号${accountId}下${missingKws.length}个关键词缺少Amazon keywordId`);
            
            // 按adGroupId分组
            const groupedByAdGroup = new Map<number, typeof missingKws>();
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
              // 按adGroup分组，通过API查询已存在的关键词并匹配回填keywordId
              for (const [adGroupLocalId, kwsInGroup] of groupedByAdGroup) {
                try {
                  // 获取Amazon adGroupId
                  const [ag] = await dbInstance.select().from(agTable).where(eq(agTable.id, adGroupLocalId)).limit(1);
                  if (!ag || !ag.adGroupId) {
                    console.warn(`[BidOptimization] 补偿同步: adGroup id=${adGroupLocalId} 缺少Amazon adGroupId, 跳过${kwsInGroup.length}个关键词`);
                    totalCompensateFailed += kwsInGroup.length;
                    continue;
                  }
                  
                  const amazonAdGroupId = Number(ag.adGroupId);
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
                  for (const kw of kwsInGroup) {
                    const key = `${(kw.keywordText || '').toLowerCase().trim()}_${(kw.matchType || '').toLowerCase()}`;
                    const amazonKeywordId = amazonKwMap.get(key);
                    
                    if (amazonKeywordId) {
                      // 回填keywordId到本地数据库（updatedAt由数据库自动更新onUpdateNow）
                      try {
                        await dbInstance.update(kwTable)
                          .set({ keywordId: amazonKeywordId })
                          .where(eq(kwTable.id, kw.id));
                        matched++;
                        totalCompensated++;
                      } catch (updateErr: any) {
                        console.error(`[BidOptimization] 补偿同步: 更新keyword id=${kw.id}失败: ${updateErr.message}`);
                        unmatched++;
                        totalCompensateFailed++;
                      }
                    } else {
                      unmatched++;
                      totalCompensateFailed++;
                    }
                  }
                  
                  if (matched > 0) {
                    console.log(`[BidOptimization] ✅ adGroup=${adGroupLocalId} 补偿同步成功: ${matched}个关键词回填了Amazon keywordId`);
                  }
                  if (unmatched > 0) {
                    console.warn(`[BidOptimization] ⚠️ adGroup=${adGroupLocalId} 补偿同步: ${unmatched}个关键词在Amazon端未找到匹配`);
                  }
                  
                  // adGroup间延迟1秒，避免API限流
                  await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (groupErr: any) {
                  console.error(`[BidOptimization] 补偿同步adGroup=${adGroupLocalId}异常: ${groupErr.message}`);
                  totalCompensateFailed += kwsInGroup.length;
                  
                  // 如果是限流错误，等待更长时间
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
        }
      } catch (compensateErr: any) {
        console.error(`[BidOptimization] 补偿同步机制异常: ${compensateErr.message}`);
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
        const adjustment = {
          campaignId: campaign.id,
          campaignName: campaign.name,
          placement: suggestion.placement,
          currentMultiplier: suggestion.currentMultiplier,
          suggestedMultiplier: suggestion.suggestedMultiplier,
          reason: suggestion.reason,
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
      
      // v122: 同步位置倾斜到 Amazon API
      if (!dryRun && suggestions.length > 0) {
        try {
          const amazonCampaignId = campaign.campaignId || campaign.id.toString();
          const topSuggestion = suggestions.find((s: any) => s.placement === 'top_of_search');
          const productSuggestion = suggestions.find((s: any) => s.placement === 'product_page');
          
          if (topSuggestion || productSuggestion) {
            await amazonApiHelper.syncPlacementAdjustmentToAmazon(
              config.accountId,
              amazonCampaignId,
              topSuggestion?.suggestedMultiplier || campaign.placementTopSearchBidAdjustment || 0,
              productSuggestion?.suggestedMultiplier || campaign.placementProductPageBidAdjustment || 0,
              `位置优化: Top=${topSuggestion?.suggestedMultiplier || 0}%, Product=${productSuggestion?.suggestedMultiplier || 0}%`
            );
          }
        } catch (apiError: any) {
          console.error(`[PlacementOptimization] Amazon API同步失败 (Campaign ${campaign.campaignName}):`, apiError.message);
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
        
        const adjustment = {
          campaignId: campaign.id,
          campaignName: campaign.name,
          keywordId: keyword.id,
          keywordText: keyword.keywordText,
          hour: currentHour,
          dayOfWeek: currentDayOfWeek,
          baseBid,
          bidMultiplier,
          adjustedBid,
        };
        
        details.push(adjustment);
        
        if (!dryRun && bidMultiplier !== 1.0) {
          // v122: 实际通过 Amazon API 调整出价
          try {
            const success = await amazonApiHelper.syncBidAdjustmentsToAmazon(
              config.accountId,
              [{
                keywordId: keyword.id,
                newBid: Math.round(adjustedBid * 100) / 100,
                campaignId: campaign.id,
                reason: `分时竞价: ${currentHour}:00 乘数${bidMultiplier}`,
                isProductTarget: false,
              }]
            );
            if (success.success > 0) adjustmentsCount++;
          } catch (apiError: any) {
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
          
          const negativeKeyword = {
            campaignId: campaign.id,
            campaignName: campaign.name,
            searchTerm: term.searchTerm,
            action: 'add_negative',
            reason: `负面搜索词: ${term.reason}`,
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
          const newKeyword = {
            campaignId: campaign.id,
            campaignName: campaign.name,
            searchTerm: term.searchTerm,
            action: 'add_keyword',
            reason: `正面搜索词: ${term.reason}`,
          };
          
          details.push(newKeyword);
          
          if (!dryRun) {
            // v123: 添加为新关键词 - 先调用Amazon API创建，获取keywordId后存入本地数据库
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
                
                // 先插入本地数据库
                const { keywords } = await import('../drizzle/schema');
                const insertResult = await dbInstance.insert(keywords).values({
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
                      console.log(`[SearchTermAnalysis] ✅ 新关键词已同步到Amazon: "${term.searchTerm}"`);
                    } else {
                      console.error(`[SearchTermAnalysis] ❌ 新关键词同步失败: "${term.searchTerm}" - ${apiResult.errors.join('; ')}`);
                    }
                  } catch (apiError: any) {
                    console.error(`[SearchTermAnalysis] ❌ 新关键词API同步异常: "${term.searchTerm}" -`, apiError.message);
                  }
                } else {
                  console.warn(`[SearchTermAnalysis] ⚠️ 缺少Amazon ID，无法同步关键词: adGroupId=${amazonAdGroupId}, campaignId=${amazonCampaignId}`);
                }
              }
            }
            newKeywordsAdded++;
          }
        }
      }
      // v122: 同步否定关键词到 Amazon API
      if (!dryRun) {
        const negativeDetails = details.filter(d => d.action === 'add_negative' && d.campaignId === campaign.id);
        if (negativeDetails.length > 0) {
          try {
            const amazonCampaignId = Number(campaign.campaignId || campaign.id);
            await amazonApiHelper.syncNegativeKeywordsToAmazon(
              config.accountId,
              negativeDetails.map(d => ({
                campaignId: amazonCampaignId,
                keywordText: d.searchTerm,
                matchType: d.reason?.includes('exact') ? 'negativeExact' as const : 'negativePhrase' as const,
                level: 'campaign' as const,
              }))
            );
            console.log(`[SearchTermAnalysis] Amazon API同步: ${negativeDetails.length}个否定词 (Campaign ${campaign.campaignName})`);
          } catch (apiError: any) {
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
      
      const adjustment = {
        campaignId: suggestion.campaignId,
        campaignName: campaign.name,
        currentBudget: suggestion.currentBudget,
        suggestedBudget: suggestion.suggestedBudget,
        changeAmount: suggestion.suggestedBudget - suggestion.currentBudget,
        changePercent: ((suggestion.suggestedBudget - suggestion.currentBudget) / suggestion.currentBudget * 100).toFixed(2),
        reason: suggestion.reasons?.join(', ') || '',
        expectedImpact: (suggestion as any).expectedRoasChange || 0,
      };
      
      details.push(adjustment);
      
      if (!dryRun && Math.abs(suggestion.suggestedBudget - suggestion.currentBudget) > 1) {
        // 实际执行预算调整（本地数据库）
        await db.updateCampaign(suggestion.campaignId, { 
          dailyBudget: suggestion.suggestedBudget.toFixed(2) 
        });
        adjustmentsCount++;
        
        // v122: 同步预算调整到 Amazon API
        try {
          const amazonCampaignId = campaign.campaignId || campaign.id.toString();
          await amazonApiHelper.syncBudgetAdjustmentToAmazon(
            config.accountId,
            amazonCampaignId,
            suggestion.suggestedBudget,
            `预算优化: $${suggestion.currentBudget.toFixed(2)} -> $${suggestion.suggestedBudget.toFixed(2)}`
          );
        } catch (apiError: any) {
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
          const action = {
            campaignId: campaign.id,
            campaignName: campaign.name,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: 'pause',
            reason: pauseReason,
            currentStatus: keyword.keywordStatus,
          };
          
          details.push(action);
          
          if (!dryRun) {
            await db.updateKeyword(keyword.id, { keywordStatus: 'paused' });
            pausedCount++;
          }
        } else if (shouldEnable) {
          const action = {
            campaignId: campaign.id,
            campaignName: campaign.name,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: 'enable',
            reason: enableReason,
            currentStatus: keyword.keywordStatus,
          };
          
          details.push(action);
          
          if (!dryRun) {
            await db.updateKeyword(keyword.id, { keywordStatus: 'enabled' });
            enabledCount++;
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
      
      for (const detail of result.bidOptimization.details.slice(0, 50)) {
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
          status: bidApiSyncStatus === 'synced' ? 'success' : bidApiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || bidApiSyncStatus,
          apiSyncDetail: detail.apiSyncDetail || (bidApiSyncResult ? JSON.stringify(bidApiSyncResult) : null),
          apiSyncedAt: bidApiSyncStatus === 'synced' ? now : null,
          errorMessage: bidApiSyncStatus === 'failed' && bidApiSyncResult?.errors?.length > 0 ? bidApiSyncResult.errors.join('; ') : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // 记录位置调整日志（包含Amazon API同步状态）
    if (result.placementOptimization.executed && result.placementOptimization.adjustmentsCount > 0) {
      for (const detail of result.placementOptimization.details.slice(0, 20)) {
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: detail.accountId || 0,
          logCategory: 'placement_adjustment',
          actionType: 'placement_adjust',
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: detail.previousValue || '',
          newValue: detail.newValue || '',
          changeReason: detail.reason || '位置优化调整',
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
      for (const detail of result.searchTermAnalysis.details.slice(0, 50)) {
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
    
    // 记录投放词状态变更日志（包含API同步状态）
    if (result.keywordStatusChanges.executed) {
      for (const detail of result.keywordStatusChanges.details.slice(0, 50)) {
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
    
    console.log(`[OptimizationTargetEngine] 执行日志已写入数据库: ${result.targetName}`, {
      status: result.status,
      bidAdjustments: result.bidOptimization.adjustmentsCount,
      placementAdjustments: result.placementOptimization.adjustmentsCount,
      negativeKeywords: result.searchTermAnalysis.negativeKeywordsAdded,
      newKeywords: result.searchTermAnalysis.newKeywordsAdded,
      keywordsPaused: result.keywordStatusChanges.pausedCount,
      keywordsEnabled: result.keywordStatusChanges.enabledCount,
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
