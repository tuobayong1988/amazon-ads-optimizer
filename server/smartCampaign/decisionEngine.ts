/**
 * 智能投放决策引擎
 * 自动化广告投放决策,包括启停、出价调整、预算调整等
 */

export interface CampaignMetrics {
  campaignId: string;
  campaignName: string;
  status: 'enabled' | 'paused' | 'archived';
  dailyBudget: number;
  currentBid: number;
  
  // 性能指标(最近7天)
  spend: number;
  sales: number;
  impressions: number;
  clicks: number;
  conversions: number;
  acos: number;
  roas: number;
  ctr: number; // Click-through rate
  cvr: number; // Conversion rate
  
  // 趋势指标
  spendTrend: 'up' | 'down' | 'stable';
  salesTrend: 'up' | 'down' | 'stable';
  acosTrend: 'up' | 'down' | 'stable';
}

export interface OptimizationGoal {
  type: 'maximize_sales' | 'target_acos' | 'target_roas' | 'minimize_cost';
  targetValue?: number;
  maxDailyBudget?: number;
  minROAS?: number;
}

export interface Decision {
  campaignId: string;
  action: 'pause' | 'enable' | 'increase_bid' | 'decrease_bid' | 'increase_budget' | 'decrease_budget' | 'no_action';
  currentValue?: number;
  recommendedValue?: number;
  confidence: number; // 0-1
  reasoning: string;
  priority: 'high' | 'medium' | 'low';
  expectedImpact: {
    salesChange: number; // Percentage
    spendChange: number;
    acosChange: number;
  };
}

/**
 * 规则引擎
 * 基于预定义规则做出决策
 */
class RuleEngine {
  /**
   * 评估是否应该暂停广告活动
   */
  shouldPauseCampaign(metrics: CampaignMetrics, goal: OptimizationGoal): Decision | null {
    const reasons: string[] = [];
    let shouldPause = false;

    // 规则1: ACoS过高且持续上升
    if (goal.type === 'target_acos' && goal.targetValue) {
      if (metrics.acos > goal.targetValue * 1.5 && metrics.acosTrend === 'up') {
        reasons.push(`ACoS (${metrics.acos.toFixed(1)}%) 远超目标 (${goal.targetValue}%) 且持续上升`);
        shouldPause = true;
      }
    }

    // 规则2: ROAS过低
    if (goal.minROAS && metrics.roas < goal.minROAS * 0.5) {
      reasons.push(`ROAS (${metrics.roas.toFixed(2)}) 远低于最低要求 (${goal.minROAS})`);
      shouldPause = true;
    }

    // 规则3: 花费但无转化
    if (metrics.spend > 50 && metrics.conversions === 0) {
      reasons.push(`已花费 $${metrics.spend.toFixed(2)} 但无任何转化`);
      shouldPause = true;
    }

    // 规则4: CTR极低
    if (metrics.impressions > 1000 && metrics.ctr < 0.1) {
      reasons.push(`CTR (${metrics.ctr.toFixed(2)}%) 极低,广告相关性差`);
      shouldPause = true;
    }

    if (shouldPause) {
      return {
        campaignId: metrics.campaignId,
        action: 'pause',
        confidence: 0.9,
        reasoning: `建议暂停: ${reasons.join('; ')}`,
        priority: 'high',
        expectedImpact: {
          salesChange: -100,
          spendChange: -100,
          acosChange: 0,
        },
      };
    }

    return null;
  }

  /**
   * 评估是否应该启用已暂停的广告活动
   */
  shouldEnableCampaign(metrics: CampaignMetrics, goal: OptimizationGoal): Decision | null {
    if (metrics.status !== 'paused') return null;

    // 简单规则: 如果历史表现良好,可以考虑重新启用
    // 这里需要历史数据支持,暂时返回null
    return null;
  }

  /**
   * 评估是否应该调整出价
   */
  shouldAdjustBid(metrics: CampaignMetrics, goal: OptimizationGoal): Decision | null {
    const currentBid = metrics.currentBid;

    // 规则1: ACoS过高,降低出价
    if (goal.type === 'target_acos' && goal.targetValue) {
      if (metrics.acos > goal.targetValue * 1.2) {
        const decreaseRatio = Math.min(0.2, (metrics.acos - goal.targetValue) / goal.targetValue * 0.5);
        const newBid = currentBid * (1 - decreaseRatio);

        return {
          campaignId: metrics.campaignId,
          action: 'decrease_bid',
          currentValue: currentBid,
          recommendedValue: Math.round(newBid * 100) / 100,
          confidence: 0.8,
          reasoning: `ACoS (${metrics.acos.toFixed(1)}%) 高于目标 (${goal.targetValue}%),建议降低出价以控制成本`,
          priority: 'high',
          expectedImpact: {
            salesChange: -10,
            spendChange: -15,
            acosChange: -10,
          },
        };
      }
    }

    // 规则2: ACoS过低且销售额可以提升,提高出价
    if (goal.type === 'target_acos' && goal.targetValue) {
      if (metrics.acos < goal.targetValue * 0.8 && metrics.salesTrend !== 'down') {
        const increaseRatio = Math.min(0.15, (goal.targetValue - metrics.acos) / goal.targetValue * 0.3);
        const newBid = currentBid * (1 + increaseRatio);

        return {
          campaignId: metrics.campaignId,
          action: 'increase_bid',
          currentValue: currentBid,
          recommendedValue: Math.round(newBid * 100) / 100,
          confidence: 0.7,
          reasoning: `ACoS (${metrics.acos.toFixed(1)}%) 低于目标 (${goal.targetValue}%),有提升销售额的空间`,
          priority: 'medium',
          expectedImpact: {
            salesChange: 15,
            spendChange: 20,
            acosChange: 5,
          },
        };
      }
    }

    // 规则3: 最大化销售额,ROAS良好时提高出价
    if (goal.type === 'maximize_sales') {
      if (metrics.roas > 2 && metrics.salesTrend === 'up') {
        const newBid = currentBid * 1.1;

        return {
          campaignId: metrics.campaignId,
          action: 'increase_bid',
          currentValue: currentBid,
          recommendedValue: Math.round(newBid * 100) / 100,
          confidence: 0.75,
          reasoning: `ROAS (${metrics.roas.toFixed(2)}) 良好且销售额上升,建议提高出价以扩大销售`,
          priority: 'medium',
          expectedImpact: {
            salesChange: 20,
            spendChange: 25,
            acosChange: 3,
          },
        };
      }
    }

    return null;
  }

  /**
   * 评估是否应该调整预算
   */
  shouldAdjustBudget(metrics: CampaignMetrics, goal: OptimizationGoal): Decision | null {
    const currentBudget = metrics.dailyBudget;

    // 规则1: 花费接近预算上限且表现良好,提高预算
    if (metrics.spend > currentBudget * 0.9) {
      if (goal.type === 'target_acos' && goal.targetValue) {
        if (metrics.acos <= goal.targetValue * 1.1) {
          const newBudget = Math.min(
            currentBudget * 1.2,
            goal.maxDailyBudget || currentBudget * 2
          );

          return {
            campaignId: metrics.campaignId,
            action: 'increase_budget',
            currentValue: currentBudget,
            recommendedValue: Math.round(newBudget * 100) / 100,
            confidence: 0.85,
            reasoning: `花费已达预算上限且ACoS (${metrics.acos.toFixed(1)}%) 符合目标,建议提高预算以获取更多销售`,
            priority: 'high',
            expectedImpact: {
              salesChange: 20,
              spendChange: 20,
              acosChange: 0,
            },
          };
        }
      }
    }

    // 规则2: 花费远低于预算且表现不佳,降低预算
    if (metrics.spend < currentBudget * 0.5) {
      if (goal.type === 'target_acos' && goal.targetValue) {
        if (metrics.acos > goal.targetValue * 1.3) {
          const newBudget = currentBudget * 0.7;

          return {
            campaignId: metrics.campaignId,
            action: 'decrease_budget',
            currentValue: currentBudget,
            recommendedValue: Math.round(newBudget * 100) / 100,
            confidence: 0.7,
            reasoning: `花费远低于预算且ACoS (${metrics.acos.toFixed(1)}%) 不理想,建议降低预算`,
            priority: 'low',
            expectedImpact: {
              salesChange: -5,
              spendChange: -10,
              acosChange: -5,
            },
          };
        }
      }
    }

    return null;
  }
}

/**
 * 智能决策引擎
 */
export class SmartDecisionEngine {
  private ruleEngine: RuleEngine;

  constructor() {
    this.ruleEngine = new RuleEngine();
  }

  /**
   * 为单个广告活动生成决策
   */
  makeDecision(metrics: CampaignMetrics, goal: OptimizationGoal): Decision {
    // 按优先级评估各种决策
    
    // 1. 检查是否应该暂停
    const pauseDecision = this.ruleEngine.shouldPauseCampaign(metrics, goal);
    if (pauseDecision) return pauseDecision;

    // 2. 检查是否应该启用
    const enableDecision = this.ruleEngine.shouldEnableCampaign(metrics, goal);
    if (enableDecision) return enableDecision;

    // 3. 检查是否应该调整出价
    const bidDecision = this.ruleEngine.shouldAdjustBid(metrics, goal);
    if (bidDecision) return bidDecision;

    // 4. 检查是否应该调整预算
    const budgetDecision = this.ruleEngine.shouldAdjustBudget(metrics, goal);
    if (budgetDecision) return budgetDecision;

    // 5. 无需操作
    return {
      campaignId: metrics.campaignId,
      action: 'no_action',
      confidence: 1,
      reasoning: '当前表现符合预期,无需调整',
      priority: 'low',
      expectedImpact: {
        salesChange: 0,
        spendChange: 0,
        acosChange: 0,
      },
    };
  }

  /**
   * 为多个广告活动批量生成决策
   */
  makeBatchDecisions(
    campaigns: CampaignMetrics[],
    goal: OptimizationGoal
  ): Decision[] {
    const decisions = campaigns.map((campaign: any) => this.makeDecision(campaign, goal));

    // 按优先级和置信度排序
    decisions.sort((a: any, b: any) => {
      const priorityScore = { high: 3, medium: 2, low: 1 };
      // @ts-expect-error - runtime type mismatch
      const scoreA = priorityScore[a.priority] * a.confidence;
      // @ts-expect-error - runtime type mismatch
      const scoreB = priorityScore[b.priority] * b.confidence;
      return scoreB - scoreA;
    });

    return decisions;
  }

  /**
   * 生成优化报告
   */
  generateOptimizationReport(decisions: Decision[]): {
    summary: {
      totalCampaigns: number;
      actionRequired: number;
      highPriority: number;
      expectedSalesIncrease: number;
      expectedSpendChange: number;
    };
    recommendations: Decision[];
  } {
    const actionableDecisions = decisions.filter((d: any) => d.action !== 'no_action');
    const highPriorityDecisions = actionableDecisions.filter((d: any) => d.priority === 'high');

    const expectedSalesIncrease = actionableDecisions.reduce(
      (sum, d) => sum + d.expectedImpact.salesChange,
      0
    );
    const expectedSpendChange = actionableDecisions.reduce(
      (sum, d) => sum + d.expectedImpact.spendChange,
      0
    );

    return {
      summary: {
        totalCampaigns: decisions.length,
        actionRequired: actionableDecisions.length,
        highPriority: highPriorityDecisions.length,
        expectedSalesIncrease: Math.round(expectedSalesIncrease * 10) / 10,
        expectedSpendChange: Math.round(expectedSpendChange * 10) / 10,
      },
      recommendations: actionableDecisions,
    };
  }
}

/**
 * 自动执行引擎
 * 自动执行决策(需要用户授权)
 */
export class AutoExecutionEngine {
  /**
   * 执行单个决策
   */
  async executeDecision(
    decision: Decision,
    dryRun: boolean = true
  ): Promise<{
    success: boolean;
    executed: boolean;
    message: string;
  }> {
    if (dryRun) {
      return {
        success: true,
        executed: false,
        message: `[DRY RUN] ${decision.action} for campaign ${decision.campaignId}: ${decision.reasoning}`,
      };
    }

    // 实际执行逻辑需要调用Amazon Ads API
    // 这里仅返回模拟结果
    try {
      switch (decision.action) {
        case 'pause':
          // await amazonAdsApi.pauseCampaign(decision.campaignId);
          return {
            success: true,
            executed: true,
            message: `Successfully paused campaign ${decision.campaignId}`,
          };

        case 'enable':
          // await amazonAdsApi.enableCampaign(decision.campaignId);
          return {
            success: true,
            executed: true,
            message: `Successfully enabled campaign ${decision.campaignId}`,
          };

        case 'increase_bid':
        case 'decrease_bid':
          // await amazonAdsApi.updateBid(decision.campaignId, decision.recommendedValue);
          return {
            success: true,
            executed: true,
            message: `Successfully updated bid to ${decision.recommendedValue} for campaign ${decision.campaignId}`,
          };

        case 'increase_budget':
        case 'decrease_budget':
          // await amazonAdsApi.updateBudget(decision.campaignId, decision.recommendedValue);
          return {
            success: true,
            executed: true,
            message: `Successfully updated budget to ${decision.recommendedValue} for campaign ${decision.campaignId}`,
          };

        case 'no_action':
          return {
            success: true,
            executed: false,
            message: 'No action required',
          };

        default:
          return {
            success: false,
            executed: false,
            message: `Unknown action: ${decision.action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        executed: false,
        message: `Failed to execute: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
      };
    }
  }

  /**
   * 批量执行决策
   */
  async executeBatchDecisions(
    decisions: Decision[],
    dryRun: boolean = true,
    maxConcurrent: number = 5
  ): Promise<Array<{
    decision: Decision;
    result: {
      success: boolean;
      executed: boolean;
      message: string;
    };
  }>> {
    const results: Array<{
      decision: Decision;
      result: {
        success: boolean;
        executed: boolean;
        message: string;
      };
    }> = [];

    // 分批执行,避免过载
    for (let i = 0; i < decisions.length; i += maxConcurrent) {
      const batch = decisions.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map(async (decision) => ({
          decision,
          result: await this.executeDecision(decision, dryRun),
        }))
      );
      results.push(...batchResults);
    }

    return results;
  }
}
