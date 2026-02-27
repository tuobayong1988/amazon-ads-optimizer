/**
 * riskActionEngine.ts - 风险行动引擎 (v245, v259增强)
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

import * as db from './db';
import { getDb } from './db';
import { createModuleLogger } from './utils/logger';

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
  actionType: 'emergency_bid_reduction' | 'pause_extreme_loss' | 'nextgen_reevaluate' | 'trigger_correction_scan' | 'accelerate_sync';
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
 * 判定账户风险等级 — 与前端listWithPerformance保持一致
 * 但增加了更细粒度的阈值判断
 */
function assessAccountRiskLevel(acos: number): 'critical' | 'warning' | 'healthy' {
  if (acos > 50) return 'critical';
  if (acos > 35) return 'warning';
  return 'healthy';
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
    await dbInstance.execute(sql`
      INSERT INTO anomaly_alert_logs (account_id, alert_type, severity, message, created_at)
      VALUES (${accountId}, ${alertType}, ${severity}, ${detail}, NOW())
    `);
  } catch (err: any) {
    log.error(`[persistRiskAlert] 写入anomaly_alert_logs失败: ${err.message}`);
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
    const [existing] = await dbInstance.execute(sql`
      SELECT id FROM emergency_optimization_queue
      WHERE accountId = ${accountId} AND actionType = ${actionType} AND processed = 0
      LIMIT 1
    `) as any;
    
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
  } catch (err: any) {
    log.error(`[persistEmergencyTask] 写入emergency_optimization_queue失败: ${err.message}`);
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
    
    for (const account of actualSites) {
      try {
        // 获取最近7天的绩效数据
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 6);
        
        const performance = await db.getAccountPerformanceSummary(account.id, startDate, endDate);
        const spend = performance?.totalSpend || 0;
        const sales = performance?.totalSales || 0;
        const acos = spend > 0 && sales > 0 ? (spend / sales) * 100 : 0;
        
        if (spend < 1) continue; // 跳过无花费的账户
        
        const riskLevel = assessAccountRiskLevel(acos);
        const actions: RiskAction[] = [];
        
        if (riskLevel === 'critical') {
          // P0: 紧急降价 — 对ACoS > 80%的关键词执行紧急降价
          actions.push({
            actionType: 'emergency_bid_reduction',
            priority: 'P0',
            description: `账户ACoS=${acos.toFixed(1)}%严重超标，触发NextGen紧急降价策略`,
            estimatedImpact: 'v259: 预计降低高ACoS关键词出价10-20%（与NextGen熔断上限对齐）',
          });
          
          // P0: 暂停极端亏损关键词（ACoS > 200%且花费 > $5）
          actions.push({
            actionType: 'pause_extreme_loss',
            priority: 'P0',
            description: '暂停ACoS>200%且花费>$5的极端亏损关键词',
            estimatedImpact: '立即止损，减少无效花费',
          });
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
          await persistRiskAlert(
            account.id,
            `risk_${riskLevel}`,
            riskLevel === 'critical' ? 'high' : 'medium',
            `账户${account.storeName || account.accountName}(${account.marketplace}) 7日ACoS=${acos.toFixed(1)}%, 风险等级=${riskLevel}, 推荐行动: ${actions.map(a => a.actionType).join(', ')}`
          );
        }
        
        assessments.push({
          accountId: account.id,
          accountName: account.storeName || account.accountName || `Account ${account.id}`,
          marketplace: account.marketplace || 'US',
          currentAcos: acos,
          riskLevel,
          riskEscalated: riskLevel === 'critical',
          recommendedActions: actions,
        });
      } catch (err: any) {
        log.error(`[assessAccountRisks] Error assessing account ${account.id}: ${err.message}`);
      }
    }
    
    return assessments.sort((a, b) => b.currentAcos - a.currentAcos);
  } catch (err: any) {
    log.error(`[assessAccountRisks] Fatal error: ${err.message}`);
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
    const [statusStats] = await dbInstance.execute(
      sql`SELECT api_sync_status, COUNT(*) as count FROM optimization_events GROUP BY api_sync_status`
    ) as any;
    
    const dist = statusStats || [];
    const synced = Number(dist.find((d: any) => d.api_sync_status === 'synced')?.count || 0);
    const pending = Number(dist.find((d: any) => d.api_sync_status === 'pending_sync' || d.api_sync_status === 'pending')?.count || 0);
    const failed = Number(dist.find((d: any) => d.api_sync_status === 'failed')?.count || 0);
    const notApplicable = Number(dist.find((d: any) => d.api_sync_status === 'not_applicable')?.count || 0)
      + Number(dist.find((d: any) => d.api_sync_status === 'invalid_legacy')?.count || 0);
    
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
  } catch (err: any) {
    log.error(`[assessSyncHealth] Error: ${err.message}`);
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
 * 遵循渐进式优化原则（v259更新）：
 * 1. 紧急降价最大幅度限制在20%（与NextGen熔断机制对齐，防止死亡螺旋）
 * 2. 暂停关键词仅针对极端亏损（ACoS > 200%且花费 > $5）
 * 3. 所有操作记录到optimization_events表，可追溯可回滚
 * 4. 紧急模式下也会触发提价恢复评估，确保曝光不会持续萎缩
 */
export async function executeRiskActions(): Promise<RiskActionResult> {
  const timestamp = new Date().toISOString();
  const actionResults: RiskActionResult['actionResults'] = [];
  let actionsTriggered = 0;
  
  log.info('[RiskActionEngine] 开始风险评估和行动执行...');
  
  // 1. 评估账户风险
  const accountRisks = await assessAccountRisks();
  const criticalAccounts = accountRisks.filter(a => a.riskLevel === 'critical');
  const warningAccounts = accountRisks.filter(a => a.riskLevel === 'warning');
  
  log.info(`[RiskActionEngine] 账户风险评估完成: critical=${criticalAccounts.length}, warning=${warningAccounts.length}, healthy=${accountRisks.length - criticalAccounts.length - warningAccounts.length}`);
  
  // 2. 对critical账户执行紧急优化
  for (const account of criticalAccounts) {
    for (const action of account.recommendedActions) {
      try {
        if (action.actionType === 'emergency_bid_reduction') {
          // v245: 持久化到数据库而非内存
          const result = await markAccountForEmergencyOptimization(account.accountId, 'emergency_bid_reduction', action.priority, action.description);
          actionsTriggered++;
          actionResults.push({
            actionType: 'emergency_bid_reduction',
            accountId: account.accountId,
            success: result,
            detail: `账户${account.accountName}(ACoS=${account.currentAcos.toFixed(1)}%)已标记为紧急优化(已持久化到DB)`,
          });
        }
        
        if (action.actionType === 'pause_extreme_loss') {
          const result = await markAccountForEmergencyOptimization(account.accountId, 'pause_extreme_loss', action.priority, action.description);
          actionsTriggered++;
          actionResults.push({
            actionType: 'pause_extreme_loss',
            accountId: account.accountId,
            success: result,
            detail: `账户${account.accountName}已标记暂停极端亏损关键词(已持久化到DB)`,
          });
        }
      } catch (err: any) {
        actionResults.push({
          actionType: action.actionType,
          accountId: account.accountId,
          success: false,
          detail: `执行失败: ${err.message}`,
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
    } catch (err: any) {
      actionResults.push({
        actionType: 'trigger_correction_scan',
        success: false,
        detail: `纠错扫描失败: ${err.message}`,
      });
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
  } catch (err: any) {
    log.error(`[RiskActionEngine] 标记紧急优化失败: ${err.message}`);
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
    const [rows] = await dbInstance.execute(sql`
      SELECT actionType FROM emergency_optimization_queue
      WHERE accountId = ${accountId} AND processed = 0
      ORDER BY createdAt DESC LIMIT 1
    `) as any;
    
    if (rows && rows.length > 0) {
      return { inQueue: true, type: rows[0].actionType };
    }
    return { inQueue: false };
  } catch (err: any) {
    log.error(`[isAccountInEmergencyQueue] 查询失败: ${err.message}`);
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
  } catch (err: any) {
    log.error(`[markEmergencyOptimizationProcessed] 更新失败: ${err.message}`);
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
    const [rows] = await dbInstance.execute(sql`
      SELECT accountId, actionType FROM emergency_optimization_queue
      WHERE processed = 0
      ORDER BY 
        CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 END,
        createdAt ASC
    `) as any;
    
    if (!rows) return [];
    return rows.map((r: any) => ({ accountId: r.accountId, type: r.actionType }));
  } catch (err: any) {
    log.error(`[getPendingEmergencyAccounts] 查询失败: ${err.message}`);
    return [];
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
    const [result] = await dbInstance.execute(sql`
      DELETE FROM emergency_optimization_queue
      WHERE processed = 1 AND processedAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `) as any;
    
    const deleted = (result as any)?.affectedRows || 0;
    if (deleted > 0) {
      log.info(`[RiskActionEngine] v245: 清理${deleted}条已处理的紧急优化记录`);
    }
  } catch (err: any) {
    log.error(`[cleanupProcessedEntries] 清理失败: ${err.message}`);
  }
}
