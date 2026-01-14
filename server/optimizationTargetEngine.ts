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
 * 执行出价优化
 */
async function executeBidOptimization(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: any[] }> {
  const details: any[] = [];
  let adjustmentsCount = 0;
  
  const bidConfig: bidOptimizer.PerformanceGroupConfig = {
    optimizationGoal: config.optimizationGoal,
    targetAcos: config.targetAcos,
    targetRoas: config.targetRoas,
    dailyBudget: config.dailyBudget,
    maxBid: config.maxBid,
  };
  
  for (const campaign of campaigns) {
    // 获取广告活动下的所有关键词
    const keywords = await db.getKeywordsByCampaignId(campaign.id);
    
    for (const keyword of keywords) {
      if (keyword.keywordStatus !== 'enabled') continue;
      
      const currentBid = parseFloat(keyword.bid || '0');
      if (currentBid <= 0) continue;
      
      // 计算最优出价
      // 生成市场曲线并计算最优出价
      const marketCurve = bidOptimizer.generateMarketCurve(keyword as any);
      const optimalBid = bidOptimizer.findOptimalBid(marketCurve, bidConfig);
      
      if (optimalBid && Math.abs(optimalBid - currentBid) > 0.01) {
        const adjustment = {
          keywordId: keyword.id,
          keywordText: keyword.keywordText,
          campaignId: campaign.id,
          campaignName: campaign.name,
          currentBid,
          newBid: optimalBid,
          changePercent: ((optimalBid - currentBid) / currentBid * 100).toFixed(2),
          reason: bidOptimizer.getAdjustmentReason(keyword, bidConfig),
        };
        
        details.push(adjustment);
        
        if (!dryRun) {
          // 实际执行出价调整
          await db.updateKeyword(keyword.id, { bid: optimalBid.toFixed(2) });
          adjustmentsCount++;
        }
      }
    }
  }
  
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details };
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
          // 实际执行位置调整
          await placementOptimizationService.applyPlacementAdjustment(
            campaign.amazonCampaignId || campaign.id.toString(),
            config.accountId,
            suggestion
          );
          adjustmentsCount++;
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
  
  const currentHour = new Date().getHours();
  const currentDayOfWeek = new Date().getDay();
  
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
          // 记录分时竞价调整（实际执行通过Amazon API）
          adjustmentsCount++;
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
      
      // 处理分类结果
      for (const term of classification) {
        if (term.suggestedAction === 'negative_exact' || term.suggestedAction === 'negative_phrase') {
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
            // 添加为新关键词
            const dbInstance = await db.getDb();
            if (dbInstance) {
              // 获取广告组ID
              const adGroups = await db.getAdGroupsByCampaignId(campaign.id);
              if (adGroups.length > 0) {
                const { keywords } = await import('../drizzle/schema');
                await dbInstance.insert(keywords).values({
                  adGroupId: adGroups[0].id,
                  keywordText: term.searchTerm,
                  matchType: (term.matchTypeSuggestion || 'exact') as any,
                  bid: '0.50',
                  keywordStatus: 'enabled',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              }
            }
            newKeywordsAdded++;
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
        // 实际执行预算调整
        await db.updateCampaign(suggestion.campaignId, { 
          dailyBudget: suggestion.suggestedBudget.toFixed(2) 
        });
        adjustmentsCount++;
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
  
  for (const campaign of campaigns) {
    try {
      // 获取广告活动下的所有关键词
      const keywords = await db.getKeywordsByCampaignId(campaign.id);
      
      for (const keyword of keywords) {
        const spend = parseFloat(keyword.spend || '0');
        const sales = parseFloat(keyword.sales || '0');
        const clicks = keyword.clicks || 0;
        const conversions = keyword.orders || 0;
        const acos = sales > 0 ? (spend / sales * 100) : 0;
        
        // 判断是否需要暂停（高花费低转化）
        const shouldPause = keyword.keywordStatus === 'enabled' && 
          spend > 50 && // 花费超过$50
          conversions === 0 && // 没有转化
          clicks > 20; // 点击超过20次
        
        // 判断是否需要启用（之前暂停但现在表现改善）
        const shouldEnable = keyword.keywordStatus === 'paused' &&
          acos > 0 && acos < (config.targetAcos || 30);
        
        if (shouldPause) {
          const action = {
            campaignId: campaign.id,
            campaignName: campaign.name,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: 'pause',
            reason: `高花费低转化: 花费$${spend.toFixed(2)}, 点击${clicks}, 转化${conversions}`,
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
            reason: `表现改善: ACoS ${acos.toFixed(2)}%`,
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
  // 这里可以将执行结果记录到数据库
  console.log(`[OptimizationTargetEngine] 执行完成: ${result.targetName}`, {
    status: result.status,
    bidAdjustments: result.bidOptimization.adjustmentsCount,
    placementAdjustments: result.placementOptimization.adjustmentsCount,
    daypartingAdjustments: result.daypartingOptimization.adjustmentsCount,
    negativeKeywords: result.searchTermAnalysis.negativeKeywordsAdded,
    newKeywords: result.searchTermAnalysis.newKeywordsAdded,
    budgetAdjustments: result.budgetAllocation.adjustmentsCount,
    keywordsPaused: result.keywordStatusChanges.pausedCount,
    keywordsEnabled: result.keywordStatusChanges.enabledCount,
    bidCoordination: {
      campaignsCoordinated: result.bidCoordination.campaignsCoordinated,
      circuitBreakerTriggered: result.bidCoordination.circuitBreakerTriggered,
    },
    errors: result.errors.length,
  });
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
    if (group.status === 'active') {
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
 */
export async function executeAllEnabledTargets(
  accountId?: number,
  options: { dryRun?: boolean } = {}
): Promise<OptimizationExecutionResult[]> {
  const targets = await getEnabledOptimizationTargets(accountId);
  const results: OptimizationExecutionResult[] = [];
  
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
