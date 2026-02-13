/**
 * 统一优化执行引擎
 * 
 * 协调所有优化模块(关键词、出价、预算、位置等),解决冲突,执行优化操作
 */

import { OptimizationObjective } from './strategyOrchestrator';

// 优化操作类型
export enum OptimizationType {
  BID_ADJUSTMENT = 'bid_adjustment',
  BUDGET_ADJUSTMENT = 'budget_adjustment',
  KEYWORD_STATUS = 'keyword_status',
  PLACEMENT_BID = 'placement_bid',
  CAMPAIGN_STATUS = 'campaign_status',
}

// 优化操作
export interface OptimizationAction {
  id: string;
  type: OptimizationType;
  targetId: number; // campaignId, keywordId等
  targetName: string;
  currentValue: any;
  suggestedValue: any;
  expectedImpact: {
    acosChange: number; // 预期ACoS变化(百分点)
    salesChange: number; // 预期销售额变化(美元)
    profitChange: number; // 预期利润变化(美元)
  };
  confidence: number; // 0-100
  priority: number; // 1-10, 越高越优先
  reason: string;
  source: string; // 来自哪个优化模块
  createdAt: Date;
}

// 优化冲突
export interface OptimizationConflict {
  action1: OptimizationAction;
  action2: OptimizationAction;
  conflictType: 'direct' | 'indirect';
  description: string;
  resolution: 'keep_action1' | 'keep_action2' | 'merge' | 'skip_both';
}

// 执行计划
export interface ExecutionPlan {
  actions: OptimizationAction[];
  conflicts: OptimizationConflict[];
  totalExpectedImpact: {
    acosChange: number;
    salesChange: number;
    profitChange: number;
  };
  estimatedExecutionTime: number; // 秒
}

/**
 * 收集所有优化模块的建议
 */
export async function collectOptimizationActions(
  accountId: number,
  campaignId: number,
  objective: OptimizationObjective
): Promise<OptimizationAction[]> {
  const actions: OptimizationAction[] = [];

  // TODO: 调用各个优化模块
  // 1. 关键词优化模块
  // const keywordActions = await keywordOptimizationService.getActions(campaignId, objective);
  // actions.push(...keywordActions);

  // 2. 出价优化模块
  // const bidActions = await bidOptimizationService.getActions(campaignId, objective);
  // actions.push(...bidActions);

  // 3. 预算优化模块
  // const budgetActions = await budgetOptimizationService.getActions(campaignId, objective);
  // actions.push(...budgetActions);

  // 4. 位置优化模块
  // const placementActions = await placementOptimizationService.getActions(campaignId, objective);
  // actions.push(...placementActions);

  // 5. ML优化模块
  // const mlActions = await mlOptimizationService.getActions(campaignId, objective);
  // actions.push(...mlActions);

  return actions;
}

/**
 * 检测优化操作之间的冲突
 */
export function detectConflicts(actions: OptimizationAction[]): OptimizationConflict[] {
  const conflicts: OptimizationConflict[] = [];

  for (let i = 0; i < actions.length; i++) {
    for (let j = i + 1; j < actions.length; j++) {
      const action1 = actions[i];
      const action2 = actions[j];

      // 直接冲突: 对同一目标的相同类型操作
      if (action1.type === action2.type && action1.targetId === action2.targetId) {
        conflicts.push({
          action1,
          action2,
          conflictType: 'direct',
          description: `两个模块对同一目标提出了不同的${action1.type}建议`,
          resolution: action1.confidence > action2.confidence ? 'keep_action1' : 'keep_action2',
        });
      }

      // 间接冲突: 出价和预算的相互影响
      if (
        (action1.type === OptimizationType.BID_ADJUSTMENT && action2.type === OptimizationType.BUDGET_ADJUSTMENT) ||
        (action1.type === OptimizationType.BUDGET_ADJUSTMENT && action2.type === OptimizationType.BID_ADJUSTMENT)
      ) {
        // 如果出价大幅提升,但预算降低,则冲突
        const bidIncrease = action1.type === OptimizationType.BID_ADJUSTMENT ? 
          (action1.suggestedValue / action1.currentValue - 1) : 
          (action2.suggestedValue / action2.currentValue - 1);
        const budgetChange = action1.type === OptimizationType.BUDGET_ADJUSTMENT ? 
          (action1.suggestedValue / action1.currentValue - 1) : 
          (action2.suggestedValue / action2.currentValue - 1);

        if (bidIncrease > 0.1 && budgetChange < -0.1) {
          conflicts.push({
            action1,
            action2,
            conflictType: 'indirect',
            description: '出价提升但预算降低,可能导致广告提前停止',
            resolution: 'merge',
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * 解决冲突并生成执行计划
 */
export function resolveConflictsAndCreatePlan(
  actions: OptimizationAction[],
  conflicts: OptimizationConflict[]
): ExecutionPlan {
  const resolvedActions: OptimizationAction[] = [];
  const skippedActionIds = new Set<string>();

  // 处理冲突
  for (const conflict of conflicts) {
    switch (conflict.resolution) {
      case 'keep_action1':
        skippedActionIds.add(conflict.action2.id);
        break;
      case 'keep_action2':
        skippedActionIds.add(conflict.action1.id);
        break;
      case 'merge':
        // 合并两个操作(取平均值)
        const mergedAction: OptimizationAction = {
          ...conflict.action1,
          id: `${conflict.action1.id}_merged`,
          suggestedValue: (conflict.action1.suggestedValue + conflict.action2.suggestedValue) / 2,
          confidence: Math.min(conflict.action1.confidence, conflict.action2.confidence),
          reason: `合并建议: ${conflict.action1.reason}; ${conflict.action2.reason}`,
          source: `${conflict.action1.source} + ${conflict.action2.source}`,
        };
        resolvedActions.push(mergedAction);
        skippedActionIds.add(conflict.action1.id);
        skippedActionIds.add(conflict.action2.id);
        break;
      case 'skip_both':
        skippedActionIds.add(conflict.action1.id);
        skippedActionIds.add(conflict.action2.id);
        break;
    }
  }

  // 添加无冲突的操作
  for (const action of actions) {
    if (!skippedActionIds.has(action.id)) {
      resolvedActions.push(action);
    }
  }

  // 按优先级排序
  resolvedActions.sort((a, b) => b.priority - a.priority);

  // 计算总预期影响
  const totalExpectedImpact = resolvedActions.reduce(
    (sum, action) => ({
      acosChange: sum.acosChange + action.expectedImpact.acosChange,
      salesChange: sum.salesChange + action.expectedImpact.salesChange,
      profitChange: sum.profitChange + action.expectedImpact.profitChange,
    }),
    { acosChange: 0, salesChange: 0, profitChange: 0 }
  );

  return {
    actions: resolvedActions,
    conflicts,
    totalExpectedImpact,
    estimatedExecutionTime: resolvedActions.length * 2, // 假设每个操作2秒
  };
}

/**
 * 执行优化计划
 */
export async function executeOptimizationPlan(
  plan: ExecutionPlan,
  dryRun: boolean = true
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const action of plan.actions) {
    try {
      if (dryRun) {
        console.log(`[DRY RUN] Would execute: ${action.type} on ${action.targetName}`);
        success++;
      } else {
        // TODO: 实际执行优化操作
        // await executeAction(action);
        success++;
      }
    } catch (error: any) {
      failed++;
      errors.push(`Failed to execute ${action.type} on ${action.targetName}: ${error.message}`);
    }
  }

  return { success, failed, errors };
}
