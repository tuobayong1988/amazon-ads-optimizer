import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('BudgetPortfolioOptimizer');
/**
 * v756: 预算组合优化器 (Budget Portfolio Optimizer) — 第二次重构
 * 
 * v755重构修正了totalBudget语义，但仍然采用"总预算约束下的重新分配"模式。
 * v754分析报告发现预算几乎全部被降低，系统在持续消耗卖家广告效果。
 * 
 * v756核心理念转变：
 * 1. 从"总预算约束分配"改为"ROAS导向的独立预算调整"
 * 2. 每个campaign独立评估，不受总预算约束
 * 3. 预算优化是"再分配"：从投产差的逐步转移给投产好的
 * 4. 订单量大的campaign需要特殊保护，不能大幅下调
 * 5. 禁止将预算设为0或接近0，最低保护$5或当前预算的70%
 * 6. 所有调整必须循序渐进，单次最大±10%
 * 7. dailyBudget是优化目标的日花费上限，不是分配总池
 */
import { DbInstance, getDb } from "../db";
import {
  campaigns,
  dailyPerformance,
  budgetOptimizationResults,
} from "../../drizzle/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

// ==================== 类型定义 ====================

export interface CampaignPerformanceProfile {
  campaignId: string;
  campaignName: string;
  currentBudget: number;
  // 绩效指标
  avgRoas7d: number;
  avgRoas14d: number;
  avgRoas30d: number;
  avgAcos30d: number;
  avgDailySpend: number;
  avgDailySales: number;
  totalOrders30d: number;
  totalClicks30d: number;
  totalImpressions30d: number;
  dayCount: number;
  // 趋势
  roasTrend: 'improving' | 'stable' | 'declining';
  // 预算利用率
  budgetUtilization: number;
}

export interface BudgetAdjustmentDecision {
  campaignId: string;
  campaignName: string;
  currentBudget: number;
  adjustedBudget: number;
  budgetChange: number;
  changePercent: number;
  direction: 'increase' | 'decrease' | 'hold';
  reason: string;
  protectionFlags: string[];
  roasCategory: 'excellent' | 'good' | 'average' | 'poor' | 'no_data';
  orderCategory: 'high_volume' | 'medium_volume' | 'low_volume' | 'no_orders';
}

export interface OptimalAllocation {
  campaignId: string;
  campaignName: string;
  currentBudget: number;
  optimalBudget: number;
  budgetChange: number;
  changePercent: number;
  expectedProfit: number;
  expectedRoas: number;
  marginalProfit: number;
}

export interface PortfolioOptimizationResult {
  totalBudget: number;
  allocations: OptimalAllocation[];
  expectedTotalProfit: number;
  expectedTotalRoas: number;
  expectedTotalSales: number;
  algorithmUsed: 'marginal_utility' | 'knapsack' | 'combinatorial_bandit' | 'roas_guided_reallocation';
  iterationCount: number;
  convergenceScore: number;
}

// ==================== v756: 安全约束配置 ====================

const BUDGET_SAFETY_CONFIG = {
  // v756: 单次最大增幅统一为5%
  maxSingleIncreasePercent: 0.05,
  // v756: 单次最大降幅统一为5%
  maxSingleDecreasePercent: 0.05,
  // v756: 订单量大的campaign降幅上限3%（更保守）
  highOrderDecreaseLimit: 0.03,
  // v756: 最低预算保护 — $5或当前预算的70%，取较大值
  minBudgetAbsolute: 5.00,
  minBudgetRelativeFloor: 0.70,
  // v756: 最高预算上限
  maxBudget: 50000.00,
  // v756: ROAS分类阈值
  excellentRoasThreshold: 5.0,
  goodRoasThreshold: 3.0,
  averageRoasThreshold: 1.5,
  // v756: 订单量分类阈值（30天）
  highOrderThreshold: 50,
  mediumOrderThreshold: 10,
  // v756: 预算利用率阈值 — 高利用率表示预算不够用
  highUtilizationThreshold: 85,
  // v756: 数据置信度最低天数
  minDataDaysForAdjustment: 7,
};

// ==================== 辅助函数 ====================

async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

/**
 * v756: 收集campaign的多时间窗口绩效数据
 */
async function collectCampaignPerformance(
  db: DbInstance,
  accountId: number,
  campaignId: string,
  campaignName: string,
  currentBudget: number
): Promise<CampaignPerformanceProfile> {
  const now = new Date();
  const date7d = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
  const date14d = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
  const date30d = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
  const endDate = now.toISOString().split('T')[0];

  // 查询30天完整数据
  const perfData30d = await (db as any).select({
    totalSpend: sql<number>`COALESCE(SUM(CAST(spend AS DECIMAL(10,2))), 0)`,
    totalSales: sql<number>`COALESCE(SUM(CAST(sales AS DECIMAL(10,2))), 0)`,
    totalOrders: sql<number>`COALESCE(SUM(orders), 0)`,
    totalClicks: sql<number>`COALESCE(SUM(clicks), 0)`,
    totalImpressions: sql<number>`COALESCE(SUM(impressions), 0)`,
    dayCount: sql<number>`COUNT(DISTINCT date)`,
  }).from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      eq(dailyPerformance.campaignId, campaignId),
      gte(dailyPerformance.date, date30d),
      lte(dailyPerformance.date, endDate)
    ));

  // 查询7天数据
  const perfData7d = await (db as any).select({
    totalSpend: sql<number>`COALESCE(SUM(CAST(spend AS DECIMAL(10,2))), 0)`,
    totalSales: sql<number>`COALESCE(SUM(CAST(sales AS DECIMAL(10,2))), 0)`,
  }).from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      eq(dailyPerformance.campaignId, campaignId),
      gte(dailyPerformance.date, date7d),
      lte(dailyPerformance.date, endDate)
    ));

  // 查询14天数据
  const perfData14d = await (db as any).select({
    totalSpend: sql<number>`COALESCE(SUM(CAST(spend AS DECIMAL(10,2))), 0)`,
    totalSales: sql<number>`COALESCE(SUM(CAST(sales AS DECIMAL(10,2))), 0)`,
  }).from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      eq(dailyPerformance.campaignId, campaignId),
      gte(dailyPerformance.date, date14d),
      lte(dailyPerformance.date, endDate)
    ));

  const p30 = perfData30d[0] || {};
  const p7 = perfData7d[0] || {};
  const p14 = perfData14d[0] || {};

  const totalSpend30d = Number(p30.totalSpend) || 0;
  const totalSales30d = Number(p30.totalSales) || 0;
  const totalOrders30d = Number(p30.totalOrders) || 0;
  const totalClicks30d = Number(p30.totalClicks) || 0;
  const totalImpressions30d = Number(p30.totalImpressions) || 0;
  const dayCount = Number(p30.dayCount) || 0;

  const spend7d = Number(p7.totalSpend) || 0;
  const sales7d = Number(p7.totalSales) || 0;
  const spend14d = Number(p14.totalSpend) || 0;
  const sales14d = Number(p14.totalSales) || 0;

  const avgRoas7d = spend7d > 0 ? sales7d / spend7d : 0;
  const avgRoas14d = spend14d > 0 ? sales14d / spend14d : 0;
  const avgRoas30d = totalSpend30d > 0 ? totalSales30d / totalSpend30d : 0;
  const avgAcos30d = totalSales30d > 0 ? totalSpend30d / totalSales30d : 1;
  const avgDailySpend = dayCount > 0 ? totalSpend30d / dayCount : 0;
  const avgDailySales = dayCount > 0 ? totalSales30d / dayCount : 0;

  // 判断ROAS趋势
  let roasTrend: 'improving' | 'stable' | 'declining' = 'stable';
  if (avgRoas7d > avgRoas30d * 1.15) {
    roasTrend = 'improving';
  } else if (avgRoas7d < avgRoas30d * 0.85) {
    roasTrend = 'declining';
  }

  // 预算利用率
  const budgetUtilization = currentBudget > 0 ? Math.min(100, (avgDailySpend / currentBudget) * 100) : 0;

  return {
    campaignId,
    campaignName,
    currentBudget,
    avgRoas7d,
    avgRoas14d,
    avgRoas30d,
    avgAcos30d,
    avgDailySpend,
    avgDailySales,
    totalOrders30d,
    totalClicks30d,
    totalImpressions30d,
    dayCount,
    roasTrend,
    budgetUtilization,
  };
}

/**
 * v756: 对单个campaign做独立的预算调整决策
 * 
 * 决策矩阵：
 * | ROAS      | 订单量   | 利用率高 | 决策                    |
 * |-----------|---------|---------|------------------------|
 * | excellent | high    | yes     | 提预算+5%              |
 * | excellent | high    | no      | 提预算+3%              |
 * | excellent | low     | yes     | 提预算+5%              |
 * | excellent | low     | no      | 提预算+2%              |
 * | good      | high    | yes     | 提预算+5%              |
 * | good      | high    | no      | 保持不变               |
 * | good      | low     | any     | 保持不变               |
 * | average   | high    | any     | 保持不变（订单保护）    |
 * | average   | low     | any     | 小幅降预算-2%~-3%      |
 * | poor      | high    | any     | 小幅降预算-3%（订单保护）|
 * | poor      | low     | any     | 降预算-3%~-5%          |
 * | no_data   | any     | any     | 保持不变               |
 */
function makeIndependentBudgetDecision(
  profile: CampaignPerformanceProfile,
  groupAvgRoas: number
): BudgetAdjustmentDecision {
  const protectionFlags: string[] = [];
  let direction: 'increase' | 'decrease' | 'hold' = 'hold';
  let changePercent = 0;
  let reason = '';

  // 分类ROAS
  let roasCategory: BudgetAdjustmentDecision['roasCategory'] = 'no_data';
  if (profile.dayCount < BUDGET_SAFETY_CONFIG.minDataDaysForAdjustment) {
    roasCategory = 'no_data';
  } else if (profile.avgRoas30d >= BUDGET_SAFETY_CONFIG.excellentRoasThreshold) {
    roasCategory = 'excellent';
  } else if (profile.avgRoas30d >= BUDGET_SAFETY_CONFIG.goodRoasThreshold) {
    roasCategory = 'good';
  } else if (profile.avgRoas30d >= BUDGET_SAFETY_CONFIG.averageRoasThreshold) {
    roasCategory = 'average';
  } else {
    roasCategory = 'poor';
  }

  // 分类订单量
  let orderCategory: BudgetAdjustmentDecision['orderCategory'] = 'no_orders';
  if (profile.totalOrders30d >= BUDGET_SAFETY_CONFIG.highOrderThreshold) {
    orderCategory = 'high_volume';
  } else if (profile.totalOrders30d >= BUDGET_SAFETY_CONFIG.mediumOrderThreshold) {
    orderCategory = 'medium_volume';
  } else if (profile.totalOrders30d > 0) {
    orderCategory = 'low_volume';
  }

  const highUtilization = profile.budgetUtilization >= BUDGET_SAFETY_CONFIG.highUtilizationThreshold;

  // 决策逻辑
  switch (roasCategory) {
    case 'excellent':
      direction = 'increase';
      if (orderCategory === 'high_volume' || orderCategory === 'medium_volume') {
        changePercent = highUtilization ? 0.05 : 0.03;
        reason = `ROAS优秀(${profile.avgRoas30d.toFixed(2)})且订单量大(${profile.totalOrders30d}单)`;
      } else {
        changePercent = highUtilization ? 0.05 : 0.02;
        reason = `ROAS优秀(${profile.avgRoas30d.toFixed(2)})，有增长潜力`;
      }
      // 趋势修正
      if (profile.roasTrend === 'improving') {
        changePercent = Math.min(changePercent * 1.2, BUDGET_SAFETY_CONFIG.maxSingleIncreasePercent);
        reason += '，近期趋势向好';
      }
      break;

    case 'good':
      if ((orderCategory === 'high_volume' || orderCategory === 'medium_volume') && highUtilization) {
        direction = 'increase';
        changePercent = 0.05;
        reason = `ROAS良好(${profile.avgRoas30d.toFixed(2)})，高订单量(${profile.totalOrders30d}单)且预算接近饱和`;
      } else if (orderCategory === 'high_volume') {
        direction = 'hold';
        reason = `ROAS良好(${profile.avgRoas30d.toFixed(2)})，高订单量(${profile.totalOrders30d}单)，保持稳定`;
        protectionFlags.push('订单量保护-维持');
      } else {
        direction = 'hold';
        reason = `ROAS良好(${profile.avgRoas30d.toFixed(2)})，保持当前预算`;
      }
      break;

    case 'average':
      if (orderCategory === 'high_volume' || orderCategory === 'medium_volume') {
        direction = 'hold';
        reason = `ROAS一般(${profile.avgRoas30d.toFixed(2)})但订单量大(${profile.totalOrders30d}单)，保持预算避免订单下滑`;
        protectionFlags.push('订单量保护-维持');
      } else {
        direction = 'decrease';
        changePercent = profile.avgRoas30d >= 2.0 ? 0.02 : 0.03;
        reason = `ROAS一般(${profile.avgRoas30d.toFixed(2)})且订单量少(${profile.totalOrders30d}单)，小幅降低预算`;
      }
      // 趋势修正：如果趋势改善，减缓降幅
      if (direction === 'decrease' && profile.roasTrend === 'improving') {
        changePercent *= 0.5;
        reason += '，但趋势改善中，保守降低';
      }
      break;

    case 'poor':
      if (orderCategory === 'high_volume') {
        direction = 'decrease';
        changePercent = BUDGET_SAFETY_CONFIG.highOrderDecreaseLimit;
        reason = `ROAS较差(${profile.avgRoas30d.toFixed(2)})但订单量大(${profile.totalOrders30d}单)，受限降低`;
        protectionFlags.push('订单量保护-限制降幅');
      } else if (orderCategory === 'medium_volume') {
        direction = 'decrease';
        changePercent = 0.03;
        reason = `ROAS较差(${profile.avgRoas30d.toFixed(2)})，中等订单量(${profile.totalOrders30d}单)，适度降低`;
      } else {
        direction = 'decrease';
        changePercent = BUDGET_SAFETY_CONFIG.maxSingleDecreasePercent;
        reason = `ROAS较差(${profile.avgRoas30d.toFixed(2)})且订单量少(${profile.totalOrders30d}单)，降低预算`;
      }
      // 趋势修正
      if (profile.roasTrend === 'improving') {
        changePercent *= 0.6;
        reason += '，趋势改善中减缓降幅';
      } else if (profile.roasTrend === 'declining') {
        changePercent = Math.min(changePercent * 1.1, BUDGET_SAFETY_CONFIG.maxSingleDecreasePercent);
        reason += '，趋势下滑';
      }
      break;

    case 'no_data':
      direction = 'hold';
      reason = `数据不足(仅${profile.dayCount}天)，保持当前预算等待更多数据`;
      protectionFlags.push('数据不足保护');
      break;
  }

  // 计算调整后预算
  let adjustedBudget = profile.currentBudget;
  if (direction === 'increase') {
    adjustedBudget = profile.currentBudget * (1 + changePercent);
    adjustedBudget = Math.min(adjustedBudget, BUDGET_SAFETY_CONFIG.maxBudget);
  } else if (direction === 'decrease') {
    adjustedBudget = profile.currentBudget * (1 - changePercent);
    // v756: 最低预算保护 — $5或当前预算的70%，取较大值
    const minBudget = Math.max(
      BUDGET_SAFETY_CONFIG.minBudgetAbsolute,
      profile.currentBudget * BUDGET_SAFETY_CONFIG.minBudgetRelativeFloor
    );
    adjustedBudget = Math.max(adjustedBudget, minBudget);
    if (adjustedBudget >= profile.currentBudget - 0.01) {
      // 如果保护后实际没有降低，改为hold
      direction = 'hold';
      adjustedBudget = profile.currentBudget;
      reason += ' [已触及最低保护线，保持不变]';
      protectionFlags.push('最低预算保护');
    }
  }

  adjustedBudget = Math.round(adjustedBudget * 100) / 100;
  const actualChange = adjustedBudget - profile.currentBudget;
  const actualChangePercent = profile.currentBudget > 0
    ? actualChange / profile.currentBudget
    : 0;

  return {
    campaignId: profile.campaignId,
    campaignName: profile.campaignName,
    currentBudget: profile.currentBudget,
    adjustedBudget,
    budgetChange: Math.round(actualChange * 100) / 100,
    changePercent: Math.round(actualChangePercent * 10000) / 10000,
    direction,
    reason,
    protectionFlags,
    roasCategory,
    orderCategory,
  };
}

// ==================== 核心优化接口 ====================

/**
 * v756: 运行预算组合优化（高层接口）— ROAS导向独立调整版
 * 
 * 核心变更：
 * 1. 每个campaign独立评估，不受totalBudget约束
 * 2. 基于ROAS和订单量的决策矩阵
 * 3. 订单量大的campaign有特殊保护
 * 4. 最低预算保护：$5或当前预算的70%
 * 5. dailyBudget仅作为日花费上限参考，不参与分配
 */
export async function optimizeBudgetPortfolio(
  accountId: number,
  performanceGroupId?: number,
  _totalBudgetOverride?: number  // 保留参数签名但不使用
): Promise<PortfolioOptimizationResult | null> {
  const db = await getDbInstance();

  try {
    // 查询所有活跃campaign（分页，无数量限制）
    const whereConditions = [
      eq(campaigns.accountId, accountId),
      eq(campaigns.campaignStatus, 'enabled'),
    ];
    if (performanceGroupId) {
      whereConditions.push(eq(campaigns.performanceGroupId, performanceGroupId));
    }

    const PAGE_SIZE = 500;
    let allCampaigns: any[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await db.select({
        id: campaigns.id,
        campaignId: campaigns.campaignId,
        name: campaigns.campaignName,
        dailyBudget: campaigns.dailyBudget,
        campaignType: campaigns.campaignType,
        performanceGroupId: campaigns.performanceGroupId,
        lastOptimizedAt: campaigns.lastOptimizedAt,  // v756: 查询最后优化时间用于冷却期检查
      }).from(campaigns)
        .where(and(...whereConditions))
        .limit(PAGE_SIZE)
        .offset(offset);

      allCampaigns = allCampaigns.concat(batch);
      hasMore = batch.length === PAGE_SIZE;
      offset += PAGE_SIZE;
    }

    if (allCampaigns.length === 0) return null;

    log.info(`[v756-BudgetPortfolio] 查询到 ${allCampaigns.length} 个活跏campaign`);

    // v756: 冷却期检查 — 跳过最近48小时内已调整过预算的campaign
    const { isBudgetInCooldown } = await import('../optimization/gradualOptimizationEngine');
    const eligibleCampaigns: typeof allCampaigns = [];
    let cooldownSkipped = 0;
    for (const campaign of allCampaigns) {
      if (isBudgetInCooldown((campaign as any).lastOptimizedAt)) {
        cooldownSkipped++;
      } else {
        eligibleCampaigns.push(campaign);
      }
    }
    if (cooldownSkipped > 0) {
      log.info(`[v756-BudgetPortfolio] 冷却期跳过: ${cooldownSkipped}个campaign在48小时内已调整过预算，本次不再调整`);
    }
    if (eligibleCampaigns.length === 0) {
      log.info(`[v756-BudgetPortfolio] 所有campaign均在冷却期内，跳过本次预算优化`);
      return null;
    }
    // 用eligibleCampaigns替代allCampaigns进行后续处理
    allCampaigns = eligibleCampaigns;

    if (_totalBudgetOverride) {
      log.info(`[v756-BudgetPortfolio] [安全] 忽略totalBudgetOverride=$${_totalBudgetOverride}，采用独立评估模式（dailyBudget仅作为日花费上限参考）`);
    }

    // 收集每个campaign的绩效数据
    const profiles: CampaignPerformanceProfile[] = [];
    for (const campaign of allCampaigns) {
      const profile = await collectCampaignPerformance(
        db, accountId,
        String(campaign.campaignId),
        campaign.name || '',
        Number(campaign.dailyBudget) || 10
      );
      profiles.push(profile);
    }

    // 计算组平均ROAS（用于相对比较）
    const totalSpend = profiles.reduce((sum, p) => sum + p.avgDailySpend, 0);
    const totalSales = profiles.reduce((sum, p) => sum + p.avgDailySales, 0);
    const groupAvgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;

    // v756: 对每个campaign独立做预算调整决策
    const decisions: BudgetAdjustmentDecision[] = [];
    for (const profile of profiles) {
      const decision = makeIndependentBudgetDecision(profile, groupAvgRoas);
      decisions.push(decision);
    }

    // 统计决策方向
    const increaseCount = decisions.filter(d => d.direction === 'increase').length;
    const decreaseCount = decisions.filter(d => d.direction === 'decrease').length;
    const holdCount = decisions.filter(d => d.direction === 'hold').length;
    const highOrderProtected = decisions.filter(d => d.protectionFlags.some(f => f.includes('订单量保护'))).length;
    const minBudgetProtected = decisions.filter(d => d.protectionFlags.some(f => f.includes('最低预算保护'))).length;

    log.info(`[v756-BudgetPortfolio] 决策结果: 总${decisions.length}个campaign, 提预算=${increaseCount}, 降预算=${decreaseCount}, 保持=${holdCount}, 订单保护=${highOrderProtected}, 最低保护=${minBudgetProtected}`);

    // 记录ROAS分类分布
    const roasDist = {
      excellent: decisions.filter(d => d.roasCategory === 'excellent').length,
      good: decisions.filter(d => d.roasCategory === 'good').length,
      average: decisions.filter(d => d.roasCategory === 'average').length,
      poor: decisions.filter(d => d.roasCategory === 'poor').length,
      no_data: decisions.filter(d => d.roasCategory === 'no_data').length,
    };
    log.info(`[v756-BudgetPortfolio] ROAS分布: excellent=${roasDist.excellent}, good=${roasDist.good}, average=${roasDist.average}, poor=${roasDist.poor}, no_data=${roasDist.no_data}`);

    // 转换为OptimalAllocation格式（兼容下游接口）
    const allocations: OptimalAllocation[] = decisions.map(d => ({
      campaignId: d.campaignId,
      campaignName: d.campaignName,
      currentBudget: d.currentBudget,
      optimalBudget: d.adjustedBudget,
      budgetChange: d.budgetChange,
      changePercent: d.changePercent,
      expectedProfit: 0,
      expectedRoas: 0,
      marginalProfit: 0,
    }));

    const currentTotalBudget = allCampaigns.reduce(
      (sum: number, c: any) => sum + (Number(c.dailyBudget) || 0), 0
    );
    const newTotalBudget = allocations.reduce((sum, a) => sum + a.optimalBudget, 0);

    const result: PortfolioOptimizationResult = {
      totalBudget: currentTotalBudget,
      allocations,
      expectedTotalProfit: 0,
      expectedTotalRoas: groupAvgRoas,
      expectedTotalSales: totalSales,
      algorithmUsed: 'roas_guided_reallocation',
      iterationCount: 1,
      convergenceScore: 1.0,
    };

    log.info(`[v756-BudgetPortfolio] 预算变化: $${currentTotalBudget.toFixed(2)} → $${newTotalBudget.toFixed(2)} (${((newTotalBudget - currentTotalBudget) / currentTotalBudget * 100).toFixed(1)}%)`);

    // 保存结果
    try {
      await (db as any).insert(budgetOptimizationResults).values({
        accountId,
        performanceGroupId: performanceGroupId || null,
        optimizationDate: new Date().toISOString().split('T')[0],
        totalBudget: String(currentTotalBudget),
        allocations: JSON.stringify(allocations.slice(0, 50)), // 限制存储大小
        expectedTotalProfit: '0',
        expectedTotalRoas: String(groupAvgRoas.toFixed(4)),
        expectedTotalSales: String(totalSales.toFixed(2)),
        algorithmUsed: 'roas_guided_reallocation',
        iterationCount: 1,
        convergenceScore: '1.000000',
      } as Record<string, unknown>);
    } catch (saveErr: any) {
      log.warn(`[v756-BudgetPortfolio] 保存结果失败(不影响主流程): ${saveErr.message}`);
    }

    return result;

  } catch (error: any) {
    log.warn(`[v756-BudgetPortfolio] Error:`, error);
    return null;
  }
}
