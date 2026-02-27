/**
 * 智能运营推荐引擎 v269.4
 * 
 * 核心升级：从"提醒系统"升级为"自动优化执行系统"
 * 
 * 1. 扫描指定账号下【所有】活跃广告活动的健康状态（覆盖sp_auto/sp_manual/sb/sd全部类型）
 * 2. 检测表现恶化的广告活动（ACoS飙升、花费激增但销售下降等）
 * 3. 已纳管恶化广告：自动调用executeOptimizationTarget执行补充优化，展示已执行的具体动作
 * 4. 未纳管恶化广告：生成一键创建优化目标的预填充数据，创建后立即触发完整优化链路
 */
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from './db';
import { campaigns, performanceGroups, dailyPerformance } from '../drizzle/schema';
import { STRATEGY_TEMPLATES } from './strategyRecommendationService';

// ==================== 类型定义 ====================

interface CampaignHealthData {
  campaignDbId: number;
  campaignId: string;
  campaignName: string;
  campaignType: string;
  campaignStatus: string;
  performanceGroupId: number | null;
  performanceGroupName: string | null;
  recent7dSpend: number;
  recent7dSales: number;
  recent7dAcos: number;
  recent7dImpressions: number;
  recent7dClicks: number;
  recent7dOrders: number;
  prev7dSpend: number;
  prev7dSales: number;
  prev7dAcos: number;
  prev7dImpressions: number;
  prev7dClicks: number;
  prev7dOrders: number;
  healthScore: number;
  deteriorationReasons: string[];
}

interface AutoOptimizationAction {
  type: 'bid_adjustment' | 'placement_tilt' | 'dayparting' | 'negative_keyword' | 'budget_allocation' | 'keyword_status' | 'campaign_status';
  description: string;
  count: number;
  status: 'executed' | 'pending' | 'skipped';
  details: string;
}

interface Recommendation {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'unmanaged_deteriorating' | 'managed_deteriorating';
  title: string;
  description: string;
  campaigns: CampaignHealthData[];
  suggestedStrategy: {
    id: string;
    name: string;
    description: string;
    targetAcos: number;
  } | null;
  estimatedImpact: {
    potentialSavings: number;
    acosReduction: string;
    description: string;
  };
  // v269.4: 已执行的自动优化动作（已纳管恶化广告）
  autoOptimizationActions: AutoOptimizationAction[];
  autoOptimizationSummary: string;
  action: {
    type: 'create_goal' | 'auto_optimized' | 'no_action';
    label: string;
    prefillData?: {
      name: string;
      description: string;
      optimizationGoal: string;
      targetAcos: number;
      targetRoas: number;
      strategyTemplateId: string;
      strategyTemplateName: string;
      campaignIds: number[];
    };
    goalId?: number;
  };
}

interface ScanResult {
  accountId: number;
  scanTime: string;
  totalCampaignsScanned: number;
  activeCampaignsScanned: number;
  deterioratingCampaigns: number;
  unmanagedDeteriorating: number;
  managedDeteriorating: number;
  totalPotentialSavings: number;
  autoOptimizationTriggered: boolean;
  autoOptimizationResults: { targetId: number; targetName: string; status: string; actions: AutoOptimizationAction[] }[];
  recommendations: Recommendation[];
}

// ==================== 健康评分算法 ====================

function calculateHealthScore(campaign: CampaignHealthData): number {
  let score = 0;
  const reasons: string[] = [];

  if (campaign.recent7dSpend > 0 && campaign.recent7dSales > 0) {
    const currentAcos = campaign.recent7dAcos;
    const prevAcos = campaign.prev7dAcos;
    
    if (prevAcos > 0 && currentAcos > prevAcos) {
      const acosIncrease = ((currentAcos - prevAcos) / prevAcos) * 100;
      if (acosIncrease > 100) {
        score -= 40;
        reasons.push(`ACoS飙升${acosIncrease.toFixed(0)}%（${prevAcos.toFixed(1)}%→${currentAcos.toFixed(1)}%）`);
      } else if (acosIncrease > 50) {
        score -= 25;
        reasons.push(`ACoS大幅上升${acosIncrease.toFixed(0)}%`);
      } else if (acosIncrease > 20) {
        score -= 15;
        reasons.push(`ACoS上升${acosIncrease.toFixed(0)}%`);
      }
    }
    
    if (currentAcos > 80) {
      score -= 30;
      reasons.push(`ACoS极高(${currentAcos.toFixed(1)}%)`);
    } else if (currentAcos > 50) {
      score -= 15;
      reasons.push(`ACoS偏高(${currentAcos.toFixed(1)}%)`);
    }
  }

  if (campaign.prev7dSpend > 0) {
    const spendChange = ((campaign.recent7dSpend - campaign.prev7dSpend) / campaign.prev7dSpend) * 100;
    if (spendChange > 100) {
      score -= 20;
      reasons.push(`花费激增${spendChange.toFixed(0)}%`);
    } else if (spendChange > 50) {
      score -= 10;
      reasons.push(`花费大幅增加${spendChange.toFixed(0)}%`);
    }
  }

  if (campaign.prev7dSales > 0) {
    const salesChange = ((campaign.recent7dSales - campaign.prev7dSales) / campaign.prev7dSales) * 100;
    if (salesChange < -50) {
      score -= 25;
      reasons.push(`销售额暴跌${Math.abs(salesChange).toFixed(0)}%`);
    } else if (salesChange < -20) {
      score -= 15;
      reasons.push(`销售额下降${Math.abs(salesChange).toFixed(0)}%`);
    }
  }

  if (campaign.recent7dSpend > 5 && campaign.recent7dOrders === 0) {
    score -= 30;
    reasons.push(`花费$${campaign.recent7dSpend.toFixed(0)}但零转化`);
  }

  if (campaign.recent7dImpressions > 1000 && campaign.recent7dClicks > 0) {
    const ctr = (campaign.recent7dClicks / campaign.recent7dImpressions) * 100;
    if (ctr < 0.1) {
      score -= 10;
      reasons.push(`点击率极低(${ctr.toFixed(2)}%)`);
    }
  }

  campaign.healthScore = score;
  campaign.deteriorationReasons = reasons;
  return score;
}

// ==================== 策略匹配算法 ====================

function matchStrategy(campaignList: CampaignHealthData[]): typeof STRATEGY_TEMPLATES[0] | null {
  if (campaignList.length === 0) return null;

  const totalSpend = campaignList.reduce((sum, c) => sum + c.recent7dSpend, 0);
  const totalSales = campaignList.reduce((sum, c) => sum + c.recent7dSales, 0);
  const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 999;

  const zeroCvCampaigns = campaignList.filter(c => c.recent7dSpend > 5 && c.recent7dOrders === 0);
  if (zeroCvCampaigns.length > campaignList.length * 0.5) {
    return STRATEGY_TEMPLATES.find(t => t.id === 'emergency-response') || STRATEGY_TEMPLATES[0];
  }
  if (avgAcos > 80) return STRATEGY_TEMPLATES.find(t => t.id === 'decline-management') || STRATEGY_TEMPLATES[2];
  if (avgAcos > 40) return STRATEGY_TEMPLATES.find(t => t.id === 'profit-focused') || STRATEGY_TEMPLATES[2];
  if (avgAcos > 25) return STRATEGY_TEMPLATES.find(t => t.id === 'balanced') || STRATEGY_TEMPLATES[1];
  return STRATEGY_TEMPLATES.find(t => t.id === 'aggressive-growth') || STRATEGY_TEMPLATES[0];
}

// ==================== 自动优化执行 ====================

async function executeAutoOptimizationForTarget(
  targetId: number,
  targetName: string,
  deterioratingCampaigns: CampaignHealthData[]
): Promise<{ status: string; actions: AutoOptimizationAction[]; summary: string }> {
  const actions: AutoOptimizationAction[] = [];
  
  try {
    // 动态导入优化引擎（避免循环依赖）
    const optimizationTargetEngine = await import('./optimizationTargetEngine');
    
    // 根据恶化程度决定优化模块
    const maxSeverity = Math.min(...deterioratingCampaigns.map(c => c.healthScore));
    let specificModules: string[];
    
    if (maxSeverity <= -40) {
      // 严重恶化：执行全部优化模块（紧急止损）
      specificModules = ['bid', 'searchterm', 'keyword', 'budget', 'placement', 'dayparting'];
    } else if (maxSeverity <= -25) {
      // 中度恶化：执行核心模块
      specificModules = ['bid', 'searchterm', 'keyword', 'budget'];
    } else {
      // 轻度恶化：仅调整竞价和搜索词
      specificModules = ['bid', 'searchterm'];
    }
    
    console.log(`[智能推荐] 对优化目标「${targetName}」(#${targetId})执行补充优化，模块: ${specificModules.join(', ')}, 恶化严重度: ${maxSeverity}`);
    
    // 调用现有的优化执行引擎
    const result = await optimizationTargetEngine.executeOptimizationTarget(targetId, {
      dryRun: false,
      forceExecution: true,
      specificModules,
    });
    
    // 收集执行结果
    if (result.bidOptimization.executed) {
      actions.push({
        type: 'bid_adjustment',
        description: '竞价调整',
        count: result.bidOptimization.adjustmentsCount,
        status: result.bidOptimization.adjustmentsCount > 0 ? 'executed' : 'skipped',
        details: result.bidOptimization.adjustmentsCount > 0 
          ? `已对${result.bidOptimization.adjustmentsCount}个投放词进行竞价调整` 
          : '当前竞价在合理范围内，无需调整',
      });
    }
    
    if (result.placementOptimization.executed) {
      actions.push({
        type: 'placement_tilt',
        description: '位置倾斜优化',
        count: result.placementOptimization.adjustmentsCount,
        status: result.placementOptimization.adjustmentsCount > 0 ? 'executed' : 'skipped',
        details: result.placementOptimization.adjustmentsCount > 0
          ? `已调整${result.placementOptimization.adjustmentsCount}个广告活动的位置倾斜比例`
          : '位置倾斜比例无需调整',
      });
    }
    
    if (result.daypartingOptimization.executed) {
      actions.push({
        type: 'dayparting',
        description: '分时策略优化',
        count: result.daypartingOptimization.adjustmentsCount,
        status: result.daypartingOptimization.adjustmentsCount > 0 ? 'executed' : 'skipped',
        details: result.daypartingOptimization.adjustmentsCount > 0
          ? `已调整${result.daypartingOptimization.adjustmentsCount}个时段的竞价/预算`
          : '分时策略无需调整',
      });
    }
    
    if (result.searchTermAnalysis.executed) {
      const negCount = result.searchTermAnalysis.negativeKeywordsAdded;
      const newCount = result.searchTermAnalysis.newKeywordsAdded;
      if (negCount > 0 || newCount > 0) {
        actions.push({
          type: 'negative_keyword',
          description: '搜索词优化',
          count: negCount + newCount,
          status: 'executed',
          details: `否定${negCount}个低效搜索词，迁移${newCount}个高效搜索词`,
        });
      }
    }
    
    if (result.budgetAllocation.executed) {
      actions.push({
        type: 'budget_allocation',
        description: '预算分配优化',
        count: result.budgetAllocation.adjustmentsCount,
        status: result.budgetAllocation.adjustmentsCount > 0 ? 'executed' : 'skipped',
        details: result.budgetAllocation.adjustmentsCount > 0
          ? `已调整${result.budgetAllocation.adjustmentsCount}个广告活动的预算分配`
          : '预算分配无需调整',
      });
    }
    
    if (result.keywordStatusChanges.executed) {
      const paused = result.keywordStatusChanges.pausedCount;
      const enabled = result.keywordStatusChanges.enabledCount;
      if (paused > 0 || enabled > 0) {
        actions.push({
          type: 'keyword_status',
          description: '关键词状态调整',
          count: paused + enabled,
          status: 'executed',
          details: `暂停${paused}个低效关键词，启用${enabled}个潜力关键词`,
        });
      }
    }
    
    const executedActions = actions.filter(a => a.status === 'executed');
    const totalAdjustments = executedActions.reduce((sum, a) => sum + a.count, 0);
    
    const summary = totalAdjustments > 0
      ? `系统已自动执行${executedActions.length}类优化动作，共${totalAdjustments}项调整`
      : '系统已完成分析，当前优化策略仍在执行中，暂无需额外调整';
    
    return { status: result.status, actions, summary };
    
  } catch (error: any) {
    console.error(`[智能推荐] 对优化目标「${targetName}」执行自动优化失败:`, error.message);
    return {
      status: 'error',
      actions: [{
        type: 'bid_adjustment',
        description: '自动优化执行',
        count: 0,
        status: 'skipped',
        details: `执行失败: ${error.message}`,
      }],
      summary: `自动优化执行遇到问题: ${error.message}`,
    };
  }
}

// ==================== 核心扫描引擎 ====================

export async function scanAccountHealth(accountId: number): Promise<ScanResult> {
  const db = await getDb();
  if (!db) {
    return {
      accountId, scanTime: new Date().toISOString(),
      totalCampaignsScanned: 0, activeCampaignsScanned: 0,
      deterioratingCampaigns: 0, unmanagedDeteriorating: 0, managedDeteriorating: 0,
      totalPotentialSavings: 0, autoOptimizationTriggered: false, autoOptimizationResults: [],
      recommendations: [],
    };
  }

  // v269.4: 获取该账号下【所有】活跃广告活动（覆盖sp_auto, sp_manual, sb, sd全部类型，不限数量）
  const allCampaigns = await db.select({
    id: campaigns.id,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    campaignType: campaigns.campaignType,
    campaignStatus: campaigns.campaignStatus,
    performanceGroupId: campaigns.performanceGroupId,
  }).from(campaigns)
    .where(and(
      eq(campaigns.accountId, accountId),
      eq(campaigns.campaignStatus, 'enabled')
    ));

  const totalCampaigns = allCampaigns.length;
  if (totalCampaigns === 0) {
    return {
      accountId, scanTime: new Date().toISOString(),
      totalCampaignsScanned: 0, activeCampaignsScanned: 0,
      deterioratingCampaigns: 0, unmanagedDeteriorating: 0, managedDeteriorating: 0,
      totalPotentialSavings: 0, autoOptimizationTriggered: false, autoOptimizationResults: [],
      recommendations: [],
    };
  }

  // 获取绩效组名称映射
  const pgIds = [...new Set(allCampaigns.filter(c => c.performanceGroupId).map(c => c.performanceGroupId!))];
  const pgMap = new Map<number, string>();
  if (pgIds.length > 0) {
    const pgs = await db.select({ id: performanceGroups.id, name: performanceGroups.name })
      .from(performanceGroups)
      .where(sql`${performanceGroups.id} IN (${sql.join(pgIds.map(id => sql`${id}`), sql`, `)})`);
    pgs.forEach(pg => pgMap.set(pg.id, pg.name));
  }

  // 计算日期范围
  const now = new Date();
  const recent7dEnd = new Date(now); recent7dEnd.setDate(recent7dEnd.getDate() - 1);
  const recent7dStart = new Date(recent7dEnd); recent7dStart.setDate(recent7dStart.getDate() - 6);
  const prev7dEnd = new Date(recent7dStart); prev7dEnd.setDate(prev7dEnd.getDate() - 1);
  const prev7dStart = new Date(prev7dEnd); prev7dStart.setDate(prev7dStart.getDate() - 6);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  // 批量获取近7天和前7天绩效数据
  const recent7dPerf = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
  }).from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`DATE(${dailyPerformance.date}) >= ${fmt(recent7dStart)}`,
      sql`DATE(${dailyPerformance.date}) <= ${fmt(recent7dEnd)}`
    )).groupBy(dailyPerformance.campaignId);

  const prev7dPerf = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
  }).from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`DATE(${dailyPerformance.date}) >= ${fmt(prev7dStart)}`,
      sql`DATE(${dailyPerformance.date}) <= ${fmt(prev7dEnd)}`
    )).groupBy(dailyPerformance.campaignId);

  const recentMap = new Map<string, typeof recent7dPerf[0]>();
  recent7dPerf.forEach(p => { if (p.campaignId) recentMap.set(p.campaignId, p); });
  const prevMap = new Map<string, typeof prev7dPerf[0]>();
  prev7dPerf.forEach(p => { if (p.campaignId) prevMap.set(p.campaignId, p); });

  // 构建健康数据
  const healthDataList: CampaignHealthData[] = allCampaigns.map(c => {
    const recent = recentMap.get(c.campaignId);
    const prev = prevMap.get(c.campaignId);
    const rSpend = parseFloat(recent?.totalSpend || '0');
    const rSales = parseFloat(recent?.totalSales || '0');
    const pSpend = parseFloat(prev?.totalSpend || '0');
    const pSales = parseFloat(prev?.totalSales || '0');

    const data: CampaignHealthData = {
      campaignDbId: c.id,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      campaignType: c.campaignType,
      campaignStatus: c.campaignStatus || 'enabled',
      performanceGroupId: c.performanceGroupId,
      performanceGroupName: c.performanceGroupId ? (pgMap.get(c.performanceGroupId) || null) : null,
      recent7dSpend: rSpend, recent7dSales: rSales,
      recent7dAcos: rSales > 0 ? (rSpend / rSales) * 100 : (rSpend > 0 ? 999 : 0),
      recent7dImpressions: recent?.totalImpressions || 0,
      recent7dClicks: recent?.totalClicks || 0,
      recent7dOrders: recent?.totalOrders || 0,
      prev7dSpend: pSpend, prev7dSales: pSales,
      prev7dAcos: pSales > 0 ? (pSpend / pSales) * 100 : (pSpend > 0 ? 999 : 0),
      prev7dImpressions: prev?.totalImpressions || 0,
      prev7dClicks: prev?.totalClicks || 0,
      prev7dOrders: prev?.totalOrders || 0,
      healthScore: 0, deteriorationReasons: [],
    };
    calculateHealthScore(data);
    return data;
  });

  // 分类
  const deteriorating = healthDataList.filter(c => c.healthScore <= -15);
  const unmanagedDet = deteriorating.filter(c => !c.performanceGroupId);
  const managedDet = deteriorating.filter(c => !!c.performanceGroupId);

  // 生成推荐
  const recommendations: Recommendation[] = [];
  const autoOptResults: ScanResult['autoOptimizationResults'] = [];
  let autoOptTriggered = false;

  // ==================== 已纳管恶化广告：自动执行补充优化 ====================
  if (managedDet.length > 0) {
    const byGroup = new Map<number, CampaignHealthData[]>();
    managedDet.forEach(c => {
      const gid = c.performanceGroupId!;
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid)!.push(c);
    });

    for (const [groupId, groupCampaigns] of byGroup) {
      const groupName = groupCampaigns[0].performanceGroupName || `优化目标#${groupId}`;
      
      // v269.4核心升级：自动执行补充优化
      const autoOptResult = await executeAutoOptimizationForTarget(groupId, groupName, groupCampaigns);
      autoOptTriggered = true;
      autoOptResults.push({
        targetId: groupId,
        targetName: groupName,
        status: autoOptResult.status,
        actions: autoOptResult.actions,
      });

      const totalWasted = groupCampaigns.reduce((sum, c) => {
        if (c.recent7dAcos > 30 && c.recent7dSales > 0) return sum + Math.max(0, c.recent7dSpend - c.recent7dSales * 0.3);
        return sum + (c.recent7dOrders === 0 ? c.recent7dSpend : 0);
      }, 0);

      const executedActions = autoOptResult.actions.filter(a => a.status === 'executed');

      recommendations.push({
        id: `managed-${groupId}-${Date.now()}`,
        priority: groupCampaigns.some(c => c.healthScore <= -40) ? 'high' : 'medium',
        type: 'managed_deteriorating',
        title: `「${groupName}」中${groupCampaigns.length}个广告恶化，系统已自动执行补充优化`,
        description: autoOptResult.summary,
        campaigns: groupCampaigns.slice(0, 10),
        suggestedStrategy: null,
        estimatedImpact: {
          potentialSavings: Math.round(totalWasted * 100) / 100,
          acosReduction: `预计可降${Math.min(50, Math.round(totalWasted / (groupCampaigns.reduce((s, c) => s + c.recent7dSpend, 0) || 1) * 100))}%`,
          description: autoOptResult.summary,
        },
        autoOptimizationActions: autoOptResult.actions,
        autoOptimizationSummary: autoOptResult.summary,
        action: {
          type: 'auto_optimized',
          label: executedActions.length > 0 ? `已自动执行${executedActions.length}类优化` : '分析完成，持续监控中',
          goalId: groupId,
        },
      });
    }
  }

  // ==================== 未纳管恶化广告：生成一键创建优化目标 ====================
  if (unmanagedDet.length > 0) {
    unmanagedDet.sort((a, b) => a.healthScore - b.healthScore);
    const strategy = matchStrategy(unmanagedDet);
    const totalWasted = unmanagedDet.reduce((sum, c) => {
      if (c.recent7dAcos > 30 && c.recent7dSales > 0) return sum + Math.max(0, c.recent7dSpend - c.recent7dSales * 0.3);
      return sum + (c.recent7dOrders === 0 ? c.recent7dSpend : 0);
    }, 0);

    recommendations.push({
      id: `unmanaged-${accountId}-${Date.now()}`,
      priority: unmanagedDet.some(c => c.healthScore <= -40) ? 'critical' : 'high',
      type: 'unmanaged_deteriorating',
      title: `${unmanagedDet.length}个未纳管广告活动表现恶化，建议使用「${strategy?.name || '平衡增长'}」策略立即优化`,
      description: `发现${unmanagedDet.length}个未纳入任何优化目标的活跃广告活动近7天表现明显恶化。` +
        `一键创建优化目标后，系统将立即执行竞价调整、搜索词优化、预算分配等全套自动优化。`,
      campaigns: unmanagedDet.slice(0, 10),
      suggestedStrategy: strategy ? { id: strategy.id, name: strategy.name, description: strategy.description, targetAcos: strategy.targetAcos } : null,
      estimatedImpact: {
        potentialSavings: Math.round(totalWasted * 100) / 100,
        acosReduction: strategy ? `ACoS目标降至${strategy.targetAcos}%` : 'ACoS目标降至30%',
        description: `创建优化目标后，系统将立即启动自动优化，预计每周可节省$${totalWasted.toFixed(0)}广告花费。`,
      },
      autoOptimizationActions: [],
      autoOptimizationSummary: '创建优化目标后将立即触发首次全套自动优化',
      action: {
        type: 'create_goal',
        label: '一键创建优化目标并立即优化',
        prefillData: {
          name: `智能推荐-${strategy?.name || '平衡增长'}-${new Date().toLocaleDateString('zh-CN')}`,
          description: `由智能推荐系统自动创建。包含${unmanagedDet.length}个表现恶化的广告活动，使用「${strategy?.name || '平衡增长'}」策略进行自动优化。`,
          optimizationGoal: 'target_acos',
          targetAcos: strategy?.targetAcos || 30,
          targetRoas: strategy ? Math.round(100 / strategy.targetAcos * 100) / 100 : 3.33,
          strategyTemplateId: strategy?.id || 'balanced',
          strategyTemplateName: strategy?.name || '平衡增长',
          campaignIds: unmanagedDet.map(c => c.campaignDbId),
        },
      },
    });
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    accountId, scanTime: new Date().toISOString(),
    totalCampaignsScanned: totalCampaigns, activeCampaignsScanned: totalCampaigns,
    deterioratingCampaigns: deteriorating.length,
    unmanagedDeteriorating: unmanagedDet.length,
    managedDeteriorating: managedDet.length,
    totalPotentialSavings: Math.round(recommendations.reduce((s, r) => s + r.estimatedImpact.potentialSavings, 0) * 100) / 100,
    autoOptimizationTriggered: autoOptTriggered,
    autoOptimizationResults: autoOptResults,
    recommendations,
  };
}
