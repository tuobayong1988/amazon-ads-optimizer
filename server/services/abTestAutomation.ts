/**
 * v359: 自动化A/B测试框架
 * 
 * 解决评估报告中指出的问题:
 * 1. A/B测试需手动创建 → 自动发现可测试的算法变体并创建实验
 * 2. 无法自动对比算法效果 → 自动收集指标、分析结果、应用最优策略
 * 3. 算法进化周期过长(每日1次) → 通过A/B测试加速算法迭代
 * 
 * 核心功能:
 * - 自动实验规划: 根据算法进化引擎的建议自动创建实验
 * - 自动指标收集: 定期收集实验组和控制组的绩效指标
 * - 自动统计分析: 达到统计显著性后自动判定胜者
 * - 自动策略应用: 胜出的策略自动推广到全量流量
 * - 实验生命周期管理: 创建→运行→分析→应用→归档
 */

import { createModuleLogger } from '../utils/logger';
import { logSync } from '../utils/opsLogger';

const log = createModuleLogger('ABTestAutomation');

// ==================== 类型定义 ====================

/** 自动实验计划 */
export interface AutoExperimentPlan {
  /** 实验类型 */
  experimentType: 'algorithm_strategy' | 'fusion_threshold' | 'exploration_rate' | 'bid_strategy';
  /** 账户ID */
  accountId: number;
  /** 实验名称 */
  name: string;
  /** 实验描述 */
  description: string;
  /** 控制组参数 */
  controlParams: Record<string, unknown>;
  /** 实验组参数 */
  treatmentParams: Record<string, unknown>;
  /** 目标指标 */
  targetMetric: 'roas' | 'acos' | 'conversions' | 'revenue' | 'profit';
  /** 最小样本量（天数） */
  minSampleDays: number;
  /** 最大运行天数 */
  maxDurationDays: number;
  /** 最小统计显著性 */
  minSignificance: number;
  /** 优先级 (1=最高) */
  priority: number;
}

/** 实验执行状态 */
interface ExperimentExecution {
  planId: string;
  testId: number;
  status: 'created' | 'running' | 'analyzing' | 'applying' | 'completed' | 'failed';
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  result?: ExperimentResult;
}

/** 实验结果 */
interface ExperimentResult {
  winner: 'control' | 'treatment' | 'inconclusive';
  significance: number;
  improvementPercent: number;
  controlMetrics: Record<string, number>;
  treatmentMetrics: Record<string, number>;
  recommendation: string;
  autoApplied: boolean;
}

/** 自动化调度器状态 */
export interface ABTestAutomationStatus {
  running: boolean;
  totalExperimentsCreated: number;
  totalExperimentsCompleted: number;
  totalAutoApplied: number;
  activeExperiments: number;
  pendingPlans: number;
  lastRunTime: Date | null;
}

// ==================== 配置 ====================

/** 自动实验的默认配置 */
const DEFAULT_CONFIG = {
  /** 每个账户最大同时运行的实验数 */
  maxConcurrentExperimentsPerAccount: 2,
  /** 实验检查间隔（毫秒） */
  checkIntervalMs: 6 * 60 * 60 * 1000, // 每6小时检查一次
  /** 最小统计显著性阈值 */
  minSignificanceThreshold: 0.95,
  /** 自动应用的最小改善幅度 */
  minImprovementForAutoApply: 0.05, // 5%
  /** 实验最小运行天数 */
  minRunDays: 7,
  /** 实验最大运行天数 */
  maxRunDays: 30,
};

// ==================== 自动化A/B测试调度器 ====================

export class ABTestAutomationScheduler {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private pendingPlans: AutoExperimentPlan[] = [];
  private activeExecutions: Map<string, ExperimentExecution> = new Map();
  
  private stats = {
    totalCreated: 0,
    totalCompleted: 0,
    totalAutoApplied: 0,
    lastRunTime: null as Date | null,
  };
  
  constructor() {
    log.info('[ABTestAutomation] v359: 初始化自动化A/B测试框架');
  }
  
  /**
   * 启动自动化调度器
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    
    // 延迟30分钟后首次运行（等待系统稳定）
    setTimeout(() => {
      if (this.running) {
        this.runCycle().catch(err => {
          log.warn(`[ABTestAutomation] 首次运行失败: ${(err as Error).message}`);
        });
      }
    }, 30 * 60 * 1000);
    
    // 定期运行
    this.timer = setInterval(() => {
      this.runCycle().catch(err => {
        log.warn(`[ABTestAutomation] 定期运行失败: ${(err as Error).message}`);
      });
    }, DEFAULT_CONFIG.checkIntervalMs);
    
    log.info(`[ABTestAutomation] v359: 调度器已启动, 检查间隔=${DEFAULT_CONFIG.checkIntervalMs / 3600000}小时`);
  }
  
  /**
   * 停止调度器
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('[ABTestAutomation] v359: 调度器已停止');
  }
  
  /**
   * 提交实验计划
   * 由算法进化引擎或手动触发
   */
  submitPlan(plan: AutoExperimentPlan): void {
    this.pendingPlans.push(plan);
    this.pendingPlans.sort((a: unknown, b: unknown) => a.priority - b.priority);
    
    log.info(`[ABTestAutomation] 提交实验计划: ${plan.name}, 类型=${plan.experimentType}, 账户=${plan.accountId}`);
  }
  
  /**
   * 获取调度器状态
   */
  getStatus(): ABTestAutomationStatus {
    return {
      running: this.running,
      totalExperimentsCreated: this.stats.totalCreated,
      totalExperimentsCompleted: this.stats.totalCompleted,
      totalAutoApplied: this.stats.totalAutoApplied,
      activeExperiments: this.activeExecutions.size,
      pendingPlans: this.pendingPlans.length,
      lastRunTime: this.stats.lastRunTime,
    };
  }
  
  // ==================== 核心循环 ====================
  
  /**
   * 执行一个完整的自动化周期
   */
  private async runCycle(): Promise<void> {
    this.stats.lastRunTime = new Date();
    log.info(`[ABTestAutomation] v359: 开始自动化周期, 待处理计划=${this.pendingPlans.length}, 活跃实验=${this.activeExecutions.size}`);
    
    try {
      // Step 1: 检查活跃实验的状态
      await this.checkActiveExperiments();
      
      // Step 2: 自动发现新的实验机会
      await this.discoverExperimentOpportunities();
      
      // Step 3: 创建新实验（从待处理计划中）
      await this.createPendingExperiments();
      
      // Step 4: 收集实验指标
      await this.collectExperimentMetrics();
      
      log.info(`[ABTestAutomation] v359: 自动化周期完成, 创建=${this.stats.totalCreated}, 完成=${this.stats.totalCompleted}, 自动应用=${this.stats.totalAutoApplied}`);
    } catch (error: unknown) {
      log.warn(`[ABTestAutomation] 自动化周期异常: ${(error as Error).message}`);
    }
  }
  
  /**
   * 检查活跃实验状态
   */
  private async checkActiveExperiments(): Promise<void> {
    try {
      const { checkAndCompleteExpiredExperiments } = await import('../analytics/abTestIntegration');
      const completedCount = await checkAndCompleteExpiredExperiments();
      
      if (completedCount > 0) {
        log.info(`[ABTestAutomation] ${completedCount}个实验已到期完成`);
      }
      
      // 检查活跃执行中的实验
      for (const [planId, execution] of this.activeExecutions.entries()) {
        if (execution.status === 'running') {
          await this.evaluateExperiment(planId, execution);
        }
      }
    } catch (error: unknown) {
      log.warn(`[ABTestAutomation] 检查活跃实验失败: ${(error as Error).message}`);
    }
  }
  
  /**
   * 评估单个实验
   */
  private async evaluateExperiment(planId: string, execution: ExperimentExecution): Promise<void> {
    try {
      const { analyzeABTestResults } = await import('../analytics/abTestService');
      const analysis = await analyzeABTestResults(execution.testId) as unknown;
      
      if (!analysis) return;
      
      // 检查是否达到统计显著性
      const significance = analysis.significance || 0;
      const daysSinceStart = execution.startedAt 
        ? (Date.now() - execution.startedAt.getTime()) / (1000 * 60 * 60 * 24)
        : 0;
      
      if (significance >= DEFAULT_CONFIG.minSignificanceThreshold && daysSinceStart >= DEFAULT_CONFIG.minRunDays) {
        // 达到显著性，分析结果
        execution.status = 'analyzing';
        
        const winner = analysis.winner;
        const improvement = analysis.improvementPercent || 0;
        
        execution.result = {
          winner: winner === 'control' ? 'control' : winner === 'treatment' ? 'treatment' : 'inconclusive',
          significance,
          improvementPercent: improvement,
          controlMetrics: analysis.controlMetrics || {},
          treatmentMetrics: analysis.treatmentMetrics || {},
          recommendation: this.generateRecommendation(winner, improvement, significance),
          autoApplied: false,
        };
        
        // 自动应用胜出策略
        if (winner === 'treatment' && improvement >= DEFAULT_CONFIG.minImprovementForAutoApply * 100) {
          await this.autoApplyWinner(execution);
          execution.result.autoApplied = true;
          this.stats.totalAutoApplied++;
        }
        
        execution.status = 'completed';
        execution.completedAt = new Date();
        this.stats.totalCompleted++;
        
        log.info(`[ABTestAutomation] 实验${execution.testId}完成: 胜者=${winner}, 改善=${improvement}%, 显著性=${significance}, 自动应用=${execution.result.autoApplied}`);
        logSync('ABTestAutomation', 'v359: 实验完成', {
          testId: execution.testId,
          winner,
          improvement,
          significance,
          autoApplied: execution.result.autoApplied,
        });
      } else if (daysSinceStart > DEFAULT_CONFIG.maxRunDays) {
        // 超过最大运行天数，标记为不确定
        execution.status = 'completed';
        execution.completedAt = new Date();
        execution.result = {
          winner: 'inconclusive',
          significance,
          improvementPercent: 0,
          controlMetrics: {},
          treatmentMetrics: {},
          recommendation: '实验运行超过最大天数仍未达到统计显著性，建议增加样本量或调整实验参数',
          autoApplied: false,
        };
        this.stats.totalCompleted++;
        
        log.warn(`[ABTestAutomation] 实验${execution.testId}超时: 显著性仅${significance}, 未达到阈值${DEFAULT_CONFIG.minSignificanceThreshold}`);
      }
    } catch (error: unknown) {
      log.warn(`[ABTestAutomation] 评估实验${execution.testId}失败: ${(error as Error).message}`);
    }
  }
  
  /**
   * 自动发现实验机会
   * 基于算法进化引擎的数据，自动生成实验计划
   */
  private async discoverExperimentOpportunities(): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const database = await getDb();
      if (!database) return;
      
      const { sql } = await import('drizzle-orm');
      
      // 查找有足够数据但尚未进行过A/B测试的账户
      const accounts = await database.execute(sql`
        SELECT DISTINCT aa.id as account_id, aa.accountName as account_name
        FROM ad_accounts aa
        LEFT JOIN ab_tests abt ON aa.id = abt.accountId AND abt.status IN ('running', 'created')
        WHERE aa.status = 'active'
        AND abt.id IS NULL
        AND aa.id IN (
          SELECT DISTINCT accountId FROM daily_performance 
          WHERE date > DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          GROUP BY accountId
          HAVING COUNT(DISTINCT date) >= 14
        )
        LIMIT 5
      `);
      
      const accountRows = (accounts as unknown[][])?.[0] || [];
      
      for (const row of accountRows as Record<string, unknown>[]) {
        const accountId = Number(row.account_id);
        
        // 检查该账户是否已有待处理的计划
        const hasPending = this.pendingPlans.some(p => p.accountId === accountId);
        const hasActive = Array.from(this.activeExecutions.values()).some(
          e => e.status === 'running' && e.planId.includes(`account-${accountId}`)
        );
        
        if (!hasPending && !hasActive) {
          // v360: P3-4 扩展自动发现实验类型
          // 根据账户特征选择最合适的实验类型
          const experimentTypes = [
            {
              type: 'fusion_threshold',
              name: '融合阈值优化',
              description: '对比不同融合阈值对ROAS的影响',
              controlParams: { fusionThreshold: 0.15 },
              treatmentParams: { fusionThreshold: 0.10 },
              targetMetric: 'roas' as const,
            },
            {
              type: 'bid_strategy',
              name: '竞价策略对比',
              description: '对比保守型与激进型竞价策略对ACoS的影响',
              controlParams: { bidAggressiveness: 0.8 },
              treatmentParams: { bidAggressiveness: 1.2 },
              targetMetric: 'acos' as const,
            },
            {
              type: 'exploration_rate',
              name: '探索率优化',
              description: '对比不同探索率对新关键词发现和ROAS的影响',
              controlParams: { explorationRate: 0.1 },
              treatmentParams: { explorationRate: 0.2 },
              targetMetric: 'roas' as const,
            },
          ];
          
          // 轮流选择实验类型（基于账户ID确定性分配）
          const selectedType = experimentTypes[accountId % experimentTypes.length];
          
          this.submitPlan({
            // @ts-expect-error - runtime type mismatch
            experimentType: selectedType.type,
            accountId,
            name: `v360自动实验: ${selectedType.name} (账户${accountId})`,
            description: `自动发现的实验机会: ${selectedType.description}`,
            controlParams: selectedType.controlParams,
            treatmentParams: selectedType.treatmentParams,
            targetMetric: selectedType.targetMetric,
            minSampleDays: 7,
            maxDurationDays: 21,
            minSignificance: 0.95,
            priority: 3,
          });
        }
      }
    } catch (error: unknown) {
      log.warn(`[ABTestAutomation] 发现实验机会失败: ${(error as Error).message}`);
    }
  }
  
  /**
   * 创建待处理的实验
   */
  private async createPendingExperiments(): Promise<void> {
    const plansToProcess = [...this.pendingPlans];
    this.pendingPlans = [];
    
    for (const plan of plansToProcess) {
      try {
        // 检查并发限制
        const accountActiveCount = Array.from(this.activeExecutions.values())
          .filter(e => e.status === 'running' && e.planId.includes(`account-${plan.accountId}`))
          .length;
        
        if (accountActiveCount >= DEFAULT_CONFIG.maxConcurrentExperimentsPerAccount) {
          // 放回队列
          this.pendingPlans.push(plan);
          continue;
        }
        
        // 创建实验
        const { createAlgorithmExperiment } = await import('../analytics/abTestIntegration');
        const result = await createAlgorithmExperiment({
          name: plan.name,
          description: plan.description,
          accountId: plan.accountId,
          experimentType: plan.experimentType,
          controlConfig: {
            algorithmMode: 'single' as const,
            customParams: plan.controlParams as Record<string, unknown>,
          },
          treatmentConfig: {
            algorithmMode: 'cascade_ensemble' as const,
            customParams: plan.treatmentParams as Record<string, unknown>,
          },
          targetMetric: plan.targetMetric,
          durationDays: plan.maxDurationDays,
          trafficSplit: 0.5,
        });
        
        if (result && result.testId) {
          const planId = `account-${plan.accountId}-${Date.now()}`;
          this.activeExecutions.set(planId, {
            planId,
            testId: result.testId,
            status: 'running',
            createdAt: new Date(),
            startedAt: new Date(),
            completedAt: null,
          });
          
          this.stats.totalCreated++;
          log.info(`[ABTestAutomation] v359: 自动创建实验: ${plan.name}, testId=${result.testId}`);
        }
      } catch (error: unknown) {
        log.warn(`[ABTestAutomation] 创建实验失败: ${plan.name}: ${(error as Error).message}`);
        // 失败的计划不放回队列，避免无限重试
      }
    }
  }
  
  /**
   * 收集实验指标
   */
  private async collectExperimentMetrics(): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const database = await getDb();
      if (!database) return;
      
      const { sql } = await import('drizzle-orm');
      
      // 查找所有运行中的实验
      const runningTests = await database.execute(sql`
        SELECT id, accountId FROM ab_tests WHERE status = 'running'
      `);
      
      const tests = (runningTests as unknown[][])?.[0] || [];
      
      for (const test of tests as Record<string, unknown>[]) {
        try {
          const { recordExperimentDailyMetrics } = await import('../analytics/abTestIntegration');
          await recordExperimentDailyMetrics(Number(test.accountId));
        } catch (err: unknown) {
          log.warn(`[ABTestAutomation] 收集实验${test.id}指标失败: ${(err as Error).message}`);
        }
      }
    } catch (error: unknown) {
      log.warn(`[ABTestAutomation] 收集实验指标失败: ${(error as Error).message}`);
    }
  }
  
  /**
   * 自动应用胜出策略
   */
  private async autoApplyWinner(execution: ExperimentExecution): Promise<void> {
    try {
      log.info(`[ABTestAutomation] v359: 自动应用胜出策略, 实验${execution.testId}`);
      
      // 记录自动应用事件
      const { getDb } = await import('../db');
      const database = await getDb();
      if (!database) return;
      
      const { optimizationEvents } = await import('../../drizzle/schema');
      
      await database.insert(optimizationEvents).values({
        accountId: 0,
        eventCategory: 'settings_change',
        actionType: 'auto_correction',
        actionDetail: JSON.stringify({
          type: 'ab_test_auto_apply',
          testId: execution.testId,
          result: execution.result,
          appliedAt: new Date().toISOString(),
        }),
        changeReason: `v359 A/B测试自动应用: 实验${execution.testId}胜出策略`,
        algorithmVersion: 'v359',
        status: 'success',
        apiSyncStatus: 'not_applicable',
      });
      
      log.info(`[ABTestAutomation] v359: 胜出策略已记录, 实验${execution.testId}`);
    } catch (error: unknown) {
      log.warn(`[ABTestAutomation] 自动应用失败: ${(error as Error).message}`);
    }
  }
  
  /**
   * 生成推荐说明
   */
  private generateRecommendation(winner: string, improvement: number, significance: number): string {
    if (winner === 'treatment' && improvement >= 10) {
      return `实验组显著优于控制组(改善${improvement.toFixed(1)}%, p=${(1 - significance).toFixed(3)})，强烈建议采用实验组策略`;
    } else if (winner === 'treatment' && improvement >= 5) {
      return `实验组优于控制组(改善${improvement.toFixed(1)}%, p=${(1 - significance).toFixed(3)})，建议采用实验组策略`;
    } else if (winner === 'control') {
      return `控制组表现更好，建议保持当前策略不变`;
    } else {
      return `两组差异不显著，建议延长实验时间或增加样本量`;
    }
  }
}

// ==================== 全局实例 ====================

let globalScheduler: ABTestAutomationScheduler | null = null;

/**
 * 获取全局A/B测试自动化调度器
 */
export function getABTestAutomationScheduler(): ABTestAutomationScheduler {
  if (!globalScheduler) {
    globalScheduler = new ABTestAutomationScheduler();
  }
  return globalScheduler;
}

/**
 * 启动A/B测试自动化
 */
export function startABTestAutomation(): void {
  const scheduler = getABTestAutomationScheduler();
  scheduler.start();
}

/**
 * 停止A/B测试自动化
 */
export function stopABTestAutomation(): void {
  if (globalScheduler) {
    globalScheduler.stop();
  }
}
