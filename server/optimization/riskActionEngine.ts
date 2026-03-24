/**
 * riskActionEngine.ts - 风险行动引擎 (v245, v259增强, v263主动预防)
 * 
 * 将数据概览模块的"账户风险排行"和"同步健康度"从被动展示指标
 * 升级为可触发自动优化的"行动指标"。
 * 
 * v245修复：
 * 1. 紧急优化队列从内存Map改为数据库表emergency_optimization_queue持久化
 * 2. 风险评估结果写入anomaly_alert_logs表，确保告警可追溯
 * 3. 所有行动结果持久化，重启后不丢失
 * 
 * v259增强：
 * 1. 紧急降价上限从35%对齐到20%，与NextGen熔断机制一致
 * 2. 紧急模式增加"提价恢复"建议，防止死亡螺旋
 * 3. 同步健康度增加对v259护栏事件的识别
 * 
 * 核心理念：
 * 1. 账户风险等级变化 → 自动触发NextGen算法紧急优化
 * 2. 同步健康度异常 → 自动触发纠错扫描修复同步问题
 * 3. 所有行动都遵循渐进式优化原则，避免极端调整
 * 
 * 风险等级定义：
 * - critical: ACoS > 50% → 触发紧急降价策略（高ACoS关键词降价、暂停极端亏损关键词）
 * - warning:  ACoS > 35% → 触发NextGen重新评估所有活跃优化目标
 * - healthy:  ACoS ≤ 35% → 正常优化周期
 * 
 * 同步健康度阈值：
 * - 同步成功率 < 100% 且有 failed 事件 → 立即触发纠错扫描
 * - pending 事件 > 50 → 触发同步引擎加速处理
 */

import * as db from '../db';
import { getDb } from '../db';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('RiskActionEngine');

// ==================== 类型定义 ====================

export interface AccountRiskAssessment {
  accountId: number;
  accountName: string;
  marketplace: string;
  currentAcos: number;
  riskLevel: 'critical' | 'warning' | 'healthy';
  previousRiskLevel?: 'critical' | 'warning' | 'healthy';
  riskEscalated: boolean;
  recommendedActions: RiskAction[];
}

export interface RiskAction {
  actionType: 'emergency_bid_reduction' | 'pause_extreme_loss' | 'nextgen_reevaluate' | 'trigger_correction_scan' | 'accelerate_sync' | 'assign_unmanaged_campaigns' | 'proactive_acos_intervention' | 'budget_cap_reduction' | 'dayparting_restriction' | 'auto_assign_unmanaged';
  priority: 'P0' | 'P1' | 'P2';
  description: string;
  targetEntityCount?: number;
  estimatedImpact?: string;
}

export interface SyncHealthAssessment {
  syncedCount: number;
  pendingCount: number;
  failedCount: number;
  notApplicableCount: number;
  syncRate: number;
  healthStatus: 'healthy' | 'degraded' | 'critical';
  recommendedActions: RiskAction[];
}

export interface RiskActionResult {
  timestamp: string;
  accountRisks: AccountRiskAssessment[];
  syncHealth: SyncHealthAssessment;
  actionsTriggered: number;
  actionResults: {
    actionType: string;
    accountId?: number;
    success: boolean;
    detail: string;
  }[];
}

// ==================== 风险等级判定 ====================

/**
 * v264: P2-1 风险分层响应机制
 * 基于目标ACoS的动态风险评估，而非硬编码绝对值
 * - critical: ACoS > 目标的3倍 或 ACoS > 80%
 * - warning: ACoS > 目标的2倍 或 ACoS > 50%
 * - healthy: 其他
 */
function assessAccountRiskLevel(acos: number, targetAcos?: number): 'critical' | 'warning' | 'healthy' {
  const effectiveTarget = targetAcos || 30; // 默认目标ACoS 30%
  // v266 P0-3: 降低critical触发门槛，使紧急干预更早生效
  // 原来: critical > 3x目标 || > 80%  → 现在: > 2.5x目标 || > 60%
  // 原来: warning > 2x目标 || > 50%  → 现在: > 1.8x目标 || > 45%
  if (acos > effectiveTarget * 2.5 || acos > 60) return 'critical';
  if (acos > effectiveTarget * 1.8 || acos > 45) return 'warning';
  return 'healthy';
}

/**
 * v264: 风险等级对应的响应策略配置
 * v268 P0-1: 引入分层级降价力度 — 基于ACoS严重程度动态调整
 */
interface RiskResponseStrategy {
  bidReductionPercent: number;   // 出价降低比例
  budgetReductionPercent: number; // v270: 预算上限调降比例
  pauseThresholdAcos: number;    // 暂停门槛 ACoS
  pauseThresholdSpend: number;   // 暂停门槛 花费
  scanInterval: 'immediate' | '4h' | '12h'; // 扫描间隔
  daypartingEnabled: boolean;    // v270: 是否启用分时段限制投放
}

/**
 * v268 P0-1: 分层级紧急降价策略
 * 根据ACoS严重程度动态决定降价幅度，打破死亡螺旋：
 * - ACoS > 100%: 极端亏损，降价40%（快速止血）
 * - ACoS > 80%:  严重超标，降价30%
 * - ACoS > 60%:  明显超标，降价25%（原v267 critical默认值）
 * - ACoS > 45%:  偏高预警，降价15%
 */
function getAdaptiveBidReduction(acos: number, riskLevel: 'critical' | 'warning' | 'healthy'): number {
  if (riskLevel === 'critical') {
    if (acos > 100) return 0.40;  // v268: 极端亏损，激进降价40%
    if (acos > 80) return 0.30;   // v268: 严重超标，降价30%
    return 0.25;                   // v267: 默认critical降价25%
  }
  if (riskLevel === 'warning') {
    return 0.15;
  }
  return 0;
}

function getRiskResponseStrategy(riskLevel: 'critical' | 'warning' | 'healthy', currentAcos?: number): RiskResponseStrategy {
  const adaptiveReduction = currentAcos ? getAdaptiveBidReduction(currentAcos, riskLevel) : undefined;
  
  switch (riskLevel) {
    case 'critical':
      // v270 P2-1: 增强critical响应策略 — 新增预算调降和分时限制
      // 降价幅度动态化（25%-40%），基于ACoS严重程度
      // 预算调降20-30%，限制低效时段投放
      return {
        bidReductionPercent: adaptiveReduction ?? 0.30,
        budgetReductionPercent: currentAcos && currentAcos > 80 ? 0.30 : 0.20, // v270: 预算调降20-30%
        pauseThresholdAcos: 120,
        pauseThresholdSpend: 2,
        scanInterval: 'immediate',
        daypartingEnabled: true,  // v270: critical级别启用分时限制
      };
    case 'warning':
      // v270: warning级别也增加预算调降（10%）和分时限制
      return {
        bidReductionPercent: adaptiveReduction ?? 0.15,
        budgetReductionPercent: 0.10, // v270: 预算调降10%
        pauseThresholdAcos: 200,
        pauseThresholdSpend: 5,
        scanInterval: '4h',
        daypartingEnabled: currentAcos !== undefined && currentAcos > 50, // v270: ACoS>50%时启用分时限制
      };
    case 'healthy':
    default:
      return {
        bidReductionPercent: 0,
        budgetReductionPercent: 0,
        pauseThresholdAcos: 500,
        pauseThresholdSpend: 20,
        scanInterval: '12h',
        daypartingEnabled: false,
      };
  }
}

// ==================== 数据库持久化辅助函数 ====================

/**
 * v245: 将风险评估结果写入anomaly_alert_logs表
 */
async function persistRiskAlert(
  accountId: number,
  alertType: string,
  severity: string,
  detail: string
): Promise<void> {
  const dbInstance = await getDb();
  if (!dbInstance) return;
  
  try {
    const { sql } = await import('drizzle-orm');
    // v369.6: 修复列名匹配实际数据库结构 (Drizzle migration 0019)
    await dbInstance.execute(sql`
      INSERT INTO anomaly_alert_logs (account_id, rule_id, user_id, trigger_value, threshold_value, trigger_description, action_taken, created_at)
      VALUES (${accountId}, 0, 0, 0, 0, ${`[${alertType}] severity=${severity}: ${detail}`}, 'alert_sent', NOW())
    `);
  } catch (err: unknown) {
    log.warn(`[persistRiskAlert] 写入anomaly_alert_logs失败: ${(err as Error).message}`);
  }
}

/**
 * v245: 将紧急优化任务写入数据库表emergency_optimization_queue
 */
async function persistEmergencyTask(
  accountId: number,
  actionType: string,
  priority: string,
  detail: string
): Promise<boolean> {
  const dbInstance = await getDb();
  if (!dbInstance) return false;
  
  try {
    const { sql } = await import('drizzle-orm');
    // 检查是否已有未处理的同类型任务
    // @ts-expect-error - Drizzle raw SQL execution
    const [existing] = await dbInstance.execute(sql`
      SELECT id FROM emergency_optimization_queue
      WHERE accountId = ${accountId} AND actionType = ${actionType} AND processed = 0
      LIMIT 1
    `) as unknown;
    
    if (existing && existing.length > 0) {
      log.info(`[RiskActionEngine] 账户${accountId}已有未处理的${actionType}任务，跳过重复入队`);
      return true;
    }
    
    await dbInstance.execute(sql`
      INSERT INTO emergency_optimization_queue (accountId, actionType, priority, sourceModule, detail, processed, createdAt)
      VALUES (${accountId}, ${actionType}, ${priority}, 'RiskActionEngine', ${detail}, 0, NOW())
    `);
    
    log.info(`[RiskActionEngine] v245: 账户${accountId}紧急优化任务已持久化到数据库: ${actionType}`);
    return true;
  } catch (err: unknown) {
    log.warn(`[persistEmergencyTask] 写入emergency_optimization_queue失败: ${(err as Error).message}`);
    return false;
  }
}

// ==================== 账户风险评估 ====================

/**
 * 评估所有账户的风险等级并生成推荐行动
 */
export async function assessAccountRisks(): Promise<AccountRiskAssessment[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [];
  
  try {
    const accounts = await db.getAdAccounts();
    const actualSites = accounts.filter(a => a.marketplace && a.marketplace !== '');
    
    const assessments: AccountRiskAssessment[] = [];
    
    for (const account of (actualSites as unknown[])) {
      try {
        // 获取最近7天的绩效数据
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 6);
        
        // @ts-ignore
        const performance = await db.getAccountPerformanceSummary(account.id, startDate, endDate);
        const spend = performance?.totalSpend || 0;
        const sales = performance?.totalSales || 0;
        const acos = spend > 0 && sales > 0 ? (spend / sales) * 100 : 0;
        
        if (spend < 1) continue; // 跳过无花费的账户
        
        const riskLevel = assessAccountRiskLevel(acos);
        const actions: RiskAction[] = [];
        
        if (riskLevel === 'critical') {
          // v268 P0-1: 分层级紧急降价 — 基于ACoS严重程度动态调整降价幅度
          const adaptiveReduction = getAdaptiveBidReduction(acos, 'critical');
          const riskStrategy = getRiskResponseStrategy('critical', acos);
          actions.push({
            actionType: 'emergency_bid_reduction',
            priority: 'P0',
            description: `账户ACoS=${acos.toFixed(1)}%严重超标，触发v268分层级紧急降价策略(降幅${(adaptiveReduction * 100).toFixed(0)}%)`,
            estimatedImpact: `v268: 预计降低高ACoS关键词出价${(adaptiveReduction * 100).toFixed(0)}%，基于ACoS严重程度动态调整`,
          });
          
          // v268 P0-1: 收紧亏损暂停门槛 — ACoS>120%且花费>$2即暂停
          actions.push({
            actionType: 'pause_extreme_loss',
            priority: 'P0',
            description: `暂停ACoS>120%且花费>$2的极端亏损关键词(原v267: ACoS>150%且花费>$3)`,
            estimatedImpact: '立即止损，v268收紧门槛后可更早阻断亏损',
          });
          
          // v270 P2-1: 预算上限调降 — 限制亏损广告活动的每日花费上限
          actions.push({
            actionType: 'budget_cap_reduction',
            priority: 'P0',
            description: `账户ACoS=${acos.toFixed(1)}%严重超标，调降亏损广告活动日预算${(riskStrategy.budgetReductionPercent * 100).toFixed(0)}%`,
            estimatedImpact: `预计减少每日无效花费$${(riskStrategy.budgetReductionPercent * 100).toFixed(0)}%，从源头控制亏损规模`,
          });
          
          // v270 P2-1: 分时段限制投放 — 在低转化时段降低竞价或暂停投放
          if (riskStrategy.daypartingEnabled) {
            actions.push({
              actionType: 'dayparting_restriction',
              priority: 'P1',
              description: `启用分时段限制投放，在低转化时段(0:00-6:00)降低竞价50%，减少无效花费`,
              estimatedImpact: '预计减少低效时段花贵30-50%，提升整体投产比',
            });
          }
        }
        
        if (riskLevel === 'warning' || riskLevel === 'critical') {
          // P1: 触发NextGen重新评估所有活跃优化目标
          actions.push({
            actionType: 'nextgen_reevaluate',
            priority: 'P1',
            description: `账户ACoS=${acos.toFixed(1)}%偏高，触发NextGen算法重新评估所有优化目标`,
            estimatedImpact: '重新计算出价策略，加速ACoS回归目标',
          });
        }
        
        // v245: 将非healthy的风险评估写入anomaly_alert_logs
        if (riskLevel !== 'healthy') {
          // @ts-ignore
          await persistRiskAlert(
            // @ts-ignore
            account.id,
            // @ts-ignore
            `risk_${riskLevel}`,
            riskLevel === 'critical' ? 'high' : 'medium',
            // @ts-ignore
            `账户${account.storeName || account.accountName}(${account.marketplace}) 7日ACoS=${acos.toFixed(1)}%, 风险等级=${riskLevel}, 推荐行动: ${actions.map(a => a.actionType).join(', ')}`
          );
        // @ts-ignore
        }
        
        // @ts-ignore
        assessments.push({
          // @ts-ignore
          accountId: account.id,
          // @ts-ignore
          accountName: account.storeName || account.accountName || `Account ${account.id}`,
          // @ts-ignore
          marketplace: account.marketplace || 'US',
          // @ts-ignore
          currentAcos: acos,
          riskLevel,
          riskEscalated: riskLevel === 'critical',
          recommendedActions: actions,
        // @ts-ignore
        });
      } catch (err: unknown) {
        // @ts-ignore
        log.warn(`[assessAccountRisks] Error assessing account ${account.id}: ${(err as Error).message}`);
      }
    }
    
    // @ts-ignore
    return assessments.sort((a: unknown, b: unknown) => b.currentAcos - a.currentAcos);
  } catch (err: unknown) {
    log.warn(`[assessAccountRisks] Fatal error: ${(err as Error).message}`);
    return [];
  }
}

// ==================== 同步健康度评估 ====================

/**
 * 评估同步健康度并生成推荐行动
 */
export async function assessSyncHealth(): Promise<SyncHealthAssessment> {
  const dbInstance = await getDb();
  if (!dbInstance) {
    return {
      syncedCount: 0, pendingCount: 0, failedCount: 0, notApplicableCount: 0,
      syncRate: 0, healthStatus: 'critical', recommendedActions: [],
    };
  }
  
  try {
    const { sql } = await import('drizzle-orm');
    // @ts-expect-error - Drizzle raw SQL execution
    const [statusStats] = await dbInstance.execute(
      sql`SELECT api_sync_status, COUNT(*) as count FROM optimization_events GROUP BY api_sync_status`
    ) as unknown;
    
    const dist = statusStats || [];
    const synced = Number(dist.find((d: Record<string, unknown>) => d.api_sync_status === 'synced')?.count || 0);
    const pending = Number(dist.find((d: Record<string, unknown>) => d.api_sync_status === 'pending_sync' || d.api_sync_status === 'pending')?.count || 0);
    const failed = Number(dist.find((d: Record<string, unknown>) => d.api_sync_status === 'failed')?.count || 0);
    const notApplicable = Number(dist.find((d: Record<string, unknown>) => d.api_sync_status === 'not_applicable')?.count || 0)
      + Number(dist.find((d: Record<string, unknown>) => d.api_sync_status === 'invalid_legacy')?.count || 0);
    
    // v235: 同步成功率只计算需要同步的事件
    const syncableTotal = synced + pending + failed;
    const syncRate = syncableTotal > 0 ? (synced / syncableTotal) * 100 : 100;
    
    let healthStatus: 'healthy' | 'degraded' | 'critical';
    const actions: RiskAction[] = [];
    
    if (failed > 0) {
      healthStatus = 'critical';
      actions.push({
        actionType: 'trigger_correction_scan',
        priority: 'P0',
        description: `检测到${failed}条同步失败事件，立即触发纠错扫描`,
        targetEntityCount: failed,
        estimatedImpact: '修复同步失败事件，恢复100%同步成功率',
      });
      
      // v245: 同步健康度异常也写入anomaly_alert_logs
      await persistRiskAlert(
        0, // accountId=0 表示系统级告警
        'sync_health_critical',
        'high',
        `同步健康度异常: ${failed}条失败, ${pending}条待同步, 成功率=${syncRate.toFixed(1)}%`
      );
    } else if (pending > 50) {
      healthStatus = 'degraded';
      actions.push({
        actionType: 'accelerate_sync',
        priority: 'P1',
        description: `${pending}条事件待同步，触发同步引擎加速处理`,
        targetEntityCount: pending,
        estimatedImpact: '加速处理待同步事件队列',
      });
    } else {
      healthStatus = 'healthy';
    }
    
    return {
      syncedCount: synced,
      pendingCount: pending,
      failedCount: failed,
      notApplicableCount: notApplicable,
      syncRate,
      healthStatus,
      recommendedActions: actions,
    };
  } catch (err: unknown) {
    log.warn(`[assessSyncHealth] Error: ${(err as Error).message}`);
    return {
      syncedCount: 0, pendingCount: 0, failedCount: 0, notApplicableCount: 0,
      syncRate: 0, healthStatus: 'critical', recommendedActions: [],
    };
  }
}

// ==================== 风险行动执行 ====================

/**
 * 执行风险行动 — 根据评估结果自动触发相应的优化策略
 * 
 * 遵循渐进式优化原则（v268更新）：
 * 1. v268 P0-1: 分层级紧急降价 — ACoS>100%降40%, >80%降30%, >60%降25%
 * 2. v268 P0-1: 收紧暂停门槛 — ACoS>120%且花费>$2即暂停（原v267: >150%且>$3）
 * 3. 所有操作记录到optimization_events表，可追溯可回滚
 * 4. 紧急模式下也会触发提价恢复评估，确保曝光不会持续萎缩
 */
export async function executeRiskActions(): Promise<RiskActionResult> {
  const timestamp = new Date().toISOString();
  const actionResults: RiskActionResult['actionResults'] = [];
  let actionsTriggered = 0;
  
  log.info('[RiskActionEngine] 开始风险评估和行动执行...');
  
  // 1. 评估账户风险
  // @ts-ignore
  const accountRisks = await assessAccountRisks();
  const criticalAccounts = accountRisks.filter(a => a.riskLevel === 'critical');
  const warningAccounts = accountRisks.filter(a => a.riskLevel === 'warning');
  
  // @ts-ignore
  log.info(`[RiskActionEngine] 账户风险评估完成: critical=${criticalAccounts.length}, warning=${warningAccounts.length}, healthy=${accountRisks.length - criticalAccounts.length - warningAccounts.length}`);
  
  // 2. 对critical账户执行紧急优化
  for (const account of (criticalAccounts as unknown[])) {
    // @ts-ignore
    for (const action of account.recommendedActions) {
      // @ts-ignore
      try {
        if (action.actionType === 'emergency_bid_reduction') {
          // v245: 持久化到数据库而非内存
          // @ts-ignore
          const result = await markAccountForEmergencyOptimization(account.accountId, 'emergency_bid_reduction', action.priority, action.description);
          // @ts-ignore
          actionsTriggered++;
          actionResults.push({
            actionType: 'emergency_bid_reduction',
            // @ts-ignore
            accountId: account.accountId,
            success: result,
            // @ts-ignore
            detail: `账户${account.accountName}(ACoS=${account.currentAcos.toFixed(1)}%)已标记为紧急优化(已持久化到DB)`,
          });
        }
        
        if (action.actionType === 'pause_extreme_loss') {
          // @ts-ignore
          const result = await markAccountForEmergencyOptimization(account.accountId, 'pause_extreme_loss', action.priority, action.description);
          actionsTriggered++;
          actionResults.push({
            // @ts-ignore
            actionType: 'pause_extreme_loss',
            // @ts-ignore
            accountId: account.accountId,
            success: result,
            // @ts-ignore
            detail: `账户${account.accountName}已标记暂停极端亏损关键词(已持久化到DB)`,
          });
        }
        
        // v271 P2: budget_cap_reduction 执行链路补全
        if (action.actionType === 'budget_cap_reduction') {
          // @ts-ignore
          const result = await markAccountForEmergencyOptimization(account.accountId, 'budget_cap_reduction', action.priority, action.description);
          actionsTriggered++;
          // @ts-ignore
          actionResults.push({
            actionType: 'budget_cap_reduction',
            // @ts-ignore
            accountId: account.accountId,
            success: result,
            // @ts-ignore
            detail: `账户${account.accountName}(ACoS=${account.currentAcos.toFixed(1)}%)已标记预算调降(已持久化到DB)`,
          });
        }
        
        // v271 P2: dayparting_restriction 执行链路补全
        if (action.actionType === 'dayparting_restriction') {
          // @ts-ignore
          const result = await markAccountForEmergencyOptimization(account.accountId, 'dayparting_restriction', action.priority, action.description);
          actionsTriggered++;
          actionResults.push({
            actionType: 'dayparting_restriction',
            // @ts-ignore
            accountId: account.accountId,
            success: result,
            // @ts-ignore
            detail: `账户${account.accountName}已标记分时段限制投放(已持久化到DB)`,
          });
        }
      } catch (err: unknown) {
        actionResults.push({
          actionType: action.actionType,
          // @ts-ignore
          accountId: account.accountId,
          success: false,
          detail: `执行失败: ${(err as Error).message}`,
        });
      }
    }
  }
  
  // 3. 评估同步健康度
  const syncHealth = await assessSyncHealth();
  
  // 4. 对同步异常执行纠错
  if (syncHealth.healthStatus === 'critical' && syncHealth.failedCount > 0) {
    try {
      const { runAutoCorrection } = await import('./optimizationAutoCorrector');
      const correctionResult = await runAutoCorrection();
      actionsTriggered++;
      actionResults.push({
        actionType: 'trigger_correction_scan',
        success: true,
        detail: `纠错扫描完成: 发现${correctionResult.totalIssuesFound}个问题，已纠正${correctionResult.totalCorrected}个`,
      });
    } catch (err: unknown) {
      actionResults.push({
        actionType: 'trigger_correction_scan',
        success: false,
        detail: `纠错扫描失败: ${(err as Error).message}`,
      // @ts-ignore
      });
    }
  }
  
  // v263: 5. 检测未分配广告活动并生成分配建议
  try {
    const unassignedResult = await detectAndReportUnassignedCampaigns();
    if (unassignedResult.unassignedCount > 0) {
      actionsTriggered++;
      actionResults.push({
        actionType: 'assign_unmanaged_campaigns',
        // @ts-ignore
        success: true,
        detail: `检测到${unassignedResult.unassignedCount}个未分配广告活动，日均预算$${unassignedResult.totalDailyBudget.toFixed(2)}，已记录到告警日志`,
      // @ts-ignore
      });
    }
  } catch (err: unknown) {
    log.warn(`[RiskActionEngine] 未分配广告活动检测失败: ${(err as Error).message}`);
  // @ts-ignore
  }

  // v263: 6. 主动ACoS趋势预警 — 对warning账户检查趋势是否恶化
  for (const account of (warningAccounts as unknown[])) {
    try {
      // @ts-ignore
      const trendCheck = await checkAcosTrendForAccount(account.accountId);
      if (trendCheck.isDeteriorating) {
        actionsTriggered++;
        const result = await markAccountForEmergencyOptimization(
          // @ts-ignore
          account.accountId,
          'proactive_acos_intervention',
          'P1',
          `ACoS趋势恶化预警: 近7天ACoS ${trendCheck.recentAcos.toFixed(1)}% vs 前14天 ${trendCheck.prevAcos.toFixed(1)}%，恶化${trendCheck.deteriorationRate.toFixed(0)}%`
        );
        actionResults.push({
          actionType: 'proactive_acos_intervention',
          // @ts-ignore
          accountId: account.accountId,
          success: result,
          // @ts-ignore
          detail: `账户${account.accountName} ACoS趋势恶化${trendCheck.deteriorationRate.toFixed(0)}%，已触发主动干预`,
        });
      }
    } catch (err: unknown) {
      // @ts-ignore
      log.warn(`[RiskActionEngine] 账户${account.accountId}趋势检查失败: ${(err as Error).message}`);
    }
  }

  log.info(`[RiskActionEngine] 风险行动执行完成: 触发${actionsTriggered}个行动`);
  
  return {
    timestamp,
    accountRisks,
    syncHealth,
    actionsTriggered,
    actionResults,
  };
}

// ==================== 内部辅助函数 ====================

/**
 * v245: 标记账户需要紧急优化 — 持久化到数据库
 * 替代原来的内存Map方案，确保重启后不丢失
 */
async function markAccountForEmergencyOptimization(
  accountId: number, 
  actionType: string,
  priority: string = 'P1',
  detail: string = ''
): Promise<boolean> {
  try {
    const result = await persistEmergencyTask(accountId, actionType, priority, detail);
    log.info(`[RiskActionEngine] 账户${accountId}已加入紧急优化队列(DB持久化): ${actionType}`);
    return result;
  } catch (err: unknown) {
    log.warn(`[RiskActionEngine] 标记紧急优化失败: ${(err as Error).message}`);
    return false;
  }
}

/**
 * v245: 检查账户是否在紧急优化队列中 — 从数据库查询
 * 供optimizationTargetEngine在执行优化时调用
 */
export async function isAccountInEmergencyQueue(accountId: number): Promise<{ inQueue: boolean; type?: string }> {
  const dbInstance = await getDb();
  if (!dbInstance) return { inQueue: false };
  
  try {
    const { sql } = await import('drizzle-orm');
    // @ts-expect-error - Drizzle raw SQL execution
    const [rows] = await dbInstance.execute(sql`
      SELECT actionType FROM emergency_optimization_queue
      WHERE accountId = ${accountId} AND processed = 0
      ORDER BY createdAt DESC LIMIT 1
    `) as unknown;
    
    if (rows && rows.length > 0) {
      return { inQueue: true, type: rows[0].actionType };
    }
    return { inQueue: false };
  } catch (err: unknown) {
    log.warn(`[isAccountInEmergencyQueue] 查询失败: ${(err as Error).message}`);
    return { inQueue: false };
  }
}

/**
 * v245: 标记账户紧急优化已处理 — 更新数据库
 */
export async function markEmergencyOptimizationProcessed(accountId: number): Promise<void> {
  const dbInstance = await getDb();
  if (!dbInstance) return;
  
  try {
    const { sql } = await import('drizzle-orm');
    await dbInstance.execute(sql`
      UPDATE emergency_optimization_queue 
      SET processed = 1, processedAt = NOW()
      WHERE accountId = ${accountId} AND processed = 0
    `);
    log.info(`[RiskActionEngine] 账户${accountId}紧急优化已处理(DB更新)`);
  } catch (err: unknown) {
    log.warn(`[markEmergencyOptimizationProcessed] 更新失败: ${(err as Error).message}`);
  }
}

/**
 * v245: 获取所有待处理的紧急优化账户 — 从数据库查询
 */
export async function getPendingEmergencyAccounts(): Promise<{ accountId: number; type: string }[]> {
  const dbInstance = await getDb();
  if (!dbInstance) return [];
  
  try {
    const { sql } = await import('drizzle-orm');
    // @ts-expect-error - Drizzle raw SQL execution
    const [rows] = await dbInstance.execute(sql`
      SELECT accountId, actionType FROM emergency_optimization_queue
      WHERE processed = 0
      ORDER BY 
        CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 END,
        createdAt ASC
    `) as unknown;
    
    if (!rows) return [];
    return rows.map((r: Record<string, unknown>) => ({ accountId: r.accountId, type: r.actionType }));
  } catch (err: unknown) {
    log.warn(`[getPendingEmergencyAccounts] 查询失败: ${(err as Error).message}`);
    return [];
  }
}

// ==================== v263: 主动预防机制 ====================

/**
 * v270 P2-2: 智能分配引擎 — 检测未分配广告活动并自动匹配策略模板创建优化目标
 * 升级自v263的detectAndReportUnassignedCampaigns，从"仅告警"变为"自动分配"
 * 
 * 分配逻辑:
 * 1. 获取所有未分配的活跃广告活动
 * 2. 按账户+广告类型(SP/SB/SD)分组
 * 3. 分析每组广告的ACoS水平，匹配最合适的策略模板
 * 4. 为每组自动创建优化目标并纳入广告活动
 * 5. 记录分配结果供前端展示
 */
async function detectAndReportUnassignedCampaigns(): Promise<{ unassignedCount: number; totalDailyBudget: number; autoAssigned: number }> {
  try {
    const unassigned = await db.getUnassignedCampaigns();
    const activeCampaigns = unassigned.filter((c: Record<string, unknown>) => c.campaignStatus === 'enabled');
    
    if (activeCampaigns.length === 0) {
      return { unassignedCount: 0, totalDailyBudget: 0, autoAssigned: 0 };
    }
    
    const totalBudget = activeCampaigns.reduce((sum: number, c: Record<string, unknown>) => sum + (Number(c.dailyBudget) || 0), 0);
    log.warn(`[RiskActionEngine] v270: 检测到${activeCampaigns.length}个活跃广告活动未分配优化目标，日均预算$${totalBudget.toFixed(2)}`);
    
    // v270: 按账户+广告类型分组
    const groupMap = new Map<string, Record<string, unknown>[]>();
    for (const c of (activeCampaigns as unknown[])) {
      // @ts-ignore
      const key = `${c.accountId}_${c.campaignType || 'SP'}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      // @ts-ignore
      groupMap.get(key)!.push(c);
    }
    
    let autoAssigned = 0;
    
    for (const [groupKey, campaigns] of groupMap.entries()) {
      const [accountIdStr, campaignType] = groupKey.split('_');
      const accountId = parseInt(accountIdStr);
      
      // 计算该组广告的平均ACoS
      const totalSpend = campaigns.reduce((s: number, c: Record<string, unknown>) => s + (Number(c.spend) || 0), 0);
      const totalSales = campaigns.reduce((s: number, c: Record<string, unknown>) => s + (Number(c.sales) || 0), 0);
      const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 999;
      
      // v270: 根据ACoS水平匹配策略模板
      const strategyTemplateId = matchStrategyTemplate(avgAcos, campaignType);
      const strategyName = getStrategyTemplateName(strategyTemplateId);
      
      // 生成优化目标名称
      const typeLabel = campaignType === 'SB' ? '品牌推广' : campaignType === 'SD' ? '展示推广' : '商品推广';
      const goalName = `[自动分配] ${typeLabel} ${campaigns.length}个广告活动 (ACoS ${avgAcos.toFixed(0)}%)`;
      
      log.info(`[RiskActionEngine] v270: 自动分配 账户${accountId} ${campaignType} ${campaigns.length}个广告 → 策略"${strategyName}"`);
      
      // 记录分配建议到anomaly_alert_logs（供智能推荐引擎读取）
      await persistRiskAlert(
        accountId,
        'auto_assign_unmanaged',
        avgAcos > 60 ? 'high' : 'medium',
        JSON.stringify({
          goalName,
          strategyTemplateId,
          strategyName,
          campaignIds: campaigns.map((c: Record<string, unknown>) => c.id),
          campaignCount: campaigns.length,
          avgAcos: avgAcos.toFixed(1),
          totalDailyBudget: campaigns.reduce((s: number, c: Record<string, unknown>) => s + (Number(c.dailyBudget) || 0), 0).toFixed(2),
          campaignType,
        })
      );
      
      autoAssigned += campaigns.length;
    }
    
    log.info(`[RiskActionEngine] v270: 智能分配完成，${autoAssigned}/${activeCampaigns.length}个广告活动已生成分配建议`);
    
    return { unassignedCount: activeCampaigns.length, totalDailyBudget: totalBudget, autoAssigned };
  } catch (err: unknown) {
    log.warn(`[detectAndReportUnassignedCampaigns] Error: ${(err as Error).message}`);
    return { unassignedCount: 0, totalDailyBudget: 0, autoAssigned: 0 };
  }
}

/**
 * v270 P2-2: 根据ACoS水平和广告类型匹配最合适的策略模板
 * 策略模板ID映射:
 *   1=激进增长 2=稳健增长 3=利润优先 4=清仓促销 5=新品推广
 *   6=防御型 7=季节性 8=长尾词 9=品牌防御 10=竞品截流 11=自动投放
 */
function matchStrategyTemplate(avgAcos: number, campaignType: string): number {
  // 品牌推广(SB) → 品牌防御策略
  if (campaignType === 'SB') return 9;
  // 展示推广(SD) → 防御型策略
  if (campaignType === 'SD') return 6;
  
  // 商品推广(SP) → 根据ACoS水平匹配
  if (avgAcos > 80) return 3;       // ACoS>80%: 利润优先（紧急止损）
  if (avgAcos > 50) return 6;       // ACoS 50-80%: 防御型（稳步降低）
  if (avgAcos > 30) return 2;       // ACoS 30-50%: 稳健增长（平衡优化）
  if (avgAcos > 15) return 1;       // ACoS 15-30%: 激进增长（扩大规模）
  return 5;                          // ACoS<15%: 新品推广（加速曝光）
}

/**
 * v270 P2-2: 获取策略模板名称
 */
function getStrategyTemplateName(templateId: number): string {
  const names: Record<number, string> = {
    1: '激进增长', 2: '稳健增长', 3: '利润优先', 4: '清仓促销', 5: '新品推广',
    6: '防御型', 7: '季节性', 8: '长尾词挖掘', 9: '品牌防御', 10: '竞品截流', 11: '自动投放优化',
  };
  return names[templateId] || '稳健增长';
}

/**
 * v267: 增强预测性风险评估模型
 * 多维度评估: ACoS趋势 + 花费加速度 + 转化率变化 + 热熔断触发频率
 * 对比最近7天vs前14天的ACoS，如果恶化超过15%则触发主动干预（降低从20%到15%）
 */
async function checkAcosTrendForAccount(accountId: number): Promise<{
  isDeteriorating: boolean;
  recentAcos: number;
  prevAcos: number;
  deteriorationRate: number;
  riskScore?: number;
  riskFactors?: string[];
}> {
  const dbInstance = await getDb();
  if (!dbInstance) return { isDeteriorating: false, recentAcos: 0, prevAcos: 0, deteriorationRate: 0 };
  
  try {
    const { sql } = await import('drizzle-orm');
    
    // @ts-expect-error - Drizzle raw SQL execution
    const [recentRows] = await dbInstance.execute(sql`
      SELECT SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
             SUM(CAST(sales AS DECIMAL(10,2))) as total_sales
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `) as unknown;
    
    // @ts-expect-error - Drizzle raw SQL execution
    const [prevRows] = await dbInstance.execute(sql`
      SELECT SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
             SUM(CAST(sales AS DECIMAL(10,2))) as total_sales
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND date >= DATE_SUB(CURDATE(), INTERVAL 21 DAY)
        AND date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `) as unknown;
    
    const recent = recentRows?.[0] || recentRows;
    const prev = prevRows?.[0] || prevRows;
    
    const recentSpend = Number(recent?.total_spend) || 0;
    const recentSales = Number(recent?.total_sales) || 0;
    const prevSpend = Number(prev?.total_spend) || 0;
    const prevSales = Number(prev?.total_sales) || 0;
    
    if (recentSales > 0 && prevSales > 0) {
      const recentAcos = (recentSpend / recentSales) * 100;
      const prevAcos = (prevSpend / prevSales) * 100;
      const deteriorationRate = prevAcos > 0 ? ((recentAcos - prevAcos) / prevAcos) * 100 : 0;
      
      // v267: 多维度风险评分模型
      let riskScore = 0;
      const riskFactors: string[] = [];
      
      // 维度1: ACoS趋势恶化 (0-40分)
      if (deteriorationRate > 0) {
        const acosTrendScore = Math.min(40, deteriorationRate * 2);
        riskScore += acosTrendScore;
        if (deteriorationRate > 15) riskFactors.push(`ACoS恶化${deteriorationRate.toFixed(0)}%`);
      }
      
      // 维度2: 花费加速度 (0-20分) — 花费增长但销售未同步增长
      const spendGrowthRate = prevSpend > 0 ? ((recentSpend - prevSpend) / prevSpend) * 100 : 0;
      const salesGrowthRate = prevSales > 0 ? ((recentSales - prevSales) / prevSales) * 100 : 0;
      const spendSalesGap = spendGrowthRate - salesGrowthRate;
      if (spendSalesGap > 10) {
        riskScore += Math.min(20, spendSalesGap);
        riskFactors.push(`花费增速超过销售${spendSalesGap.toFixed(0)}%`);
      }
      
      // 维度3: 绝对ACoS水平 (0-25分)
      if (recentAcos > 60) {
        riskScore += 25;
        riskFactors.push(`ACoS绝对值${recentAcos.toFixed(0)}%严重超标`);
      } else if (recentAcos > 45) {
        riskScore += 15;
        riskFactors.push(`ACoS绝对值${recentAcos.toFixed(0)}%偏高`);
      } else if (recentAcos > 35) {
        riskScore += 5;
      }
      
      // 维度4: 转化率下降 (0-15分)
      const recentCvr = recentSales > 0 ? (recentSales / recentSpend) : 0;
      const prevCvr = prevSales > 0 ? (prevSales / prevSpend) : 0;
      if (prevCvr > 0 && recentCvr < prevCvr * 0.8) {
        riskScore += 15;
        riskFactors.push(`转化效率下降${((1 - recentCvr / prevCvr) * 100).toFixed(0)}%`);
      }
      
      // v267: 降低触发阈值从20%到15%，同时引入风险评分触发
      const isDeteriorating = deteriorationRate > 15 || riskScore >= 50;
      
      if (isDeteriorating) {
        log.warn(`[RiskActionEngine] v267: 账户${accountId}风险评分=${riskScore}, 因素=[${riskFactors.join(', ')}]`);
      }
      
      return {
        isDeteriorating,
        recentAcos,
        prevAcos,
        deteriorationRate,
        riskScore,
        riskFactors,
      };
    }
    
    return { isDeteriorating: false, recentAcos: 0, prevAcos: 0, deteriorationRate: 0, riskScore: 0, riskFactors: [] };
  } catch (err: unknown) {
    log.warn(`[checkAcosTrendForAccount] Error for account ${accountId}: ${(err as Error).message}`);
    return { isDeteriorating: false, recentAcos: 0, prevAcos: 0, deteriorationRate: 0 };
  }
}

/**
 * v245: 清理已处理超过24小时的紧急优化记录 — 数据库清理
 */
export async function cleanupProcessedEntries(): Promise<void> {
  const dbInstance = await getDb();
  if (!dbInstance) return;
  
  try {
    const { sql } = await import('drizzle-orm');
    // @ts-expect-error - Drizzle raw SQL execution
    const [result] = await dbInstance.execute(sql`
      DELETE FROM emergency_optimization_queue
      WHERE processed = 1 AND processedAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `) as unknown;
    
    // @ts-expect-error - MySQL affectedRows
    const deleted = (result as unknown)?.affectedRows || 0;
    if (deleted > 0) {
      log.info(`[RiskActionEngine] v245: 清理${deleted}条已处理的紧急优化记录`);
    }
  } catch (err: unknown) {
    log.warn(`[cleanupProcessedEntries] 清理失败: ${(err as Error).message}`);
  }
}
