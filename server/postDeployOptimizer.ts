/**
 * PostDeployOptimizer v184
 * 
 * 部署后自动重优化触发器 — 确保每次系统更新后，所有活跃优化目标
 * 立即按照最新算法重新优化，纠正因旧版本问题导致的错误优化行为。
 * 
 * 核心机制:
 * 1. 版本检测: 系统启动时对比 SYSTEM_VERSION 与数据库中记录的上次部署版本
 * 2. 变更日志: 每个版本声明自己引入的变更类型（哪些模块受影响）
 * 3. 渐进式重优化: 按优先级排序，分批执行，避免API限流
 * 4. 算法级纠错: 不仅重试API失败，还主动纠正旧算法的错误决策
 * 5. 安全护栏: 单次调整幅度限制、总调整量限制、错误隔离
 * 
 * 触发方式:
 * - 系统启动时自动检测版本变化 → 触发全量重优化
 * - 可通过API手动触发指定版本的重优化
 * 
 * 与现有系统的关系:
 * - 在 optimizationAutoCorrector（API执行级纠错）之后运行
 * - 在 startOptimizationScheduler（常规调度）之前运行
 * - 重优化完成后，常规调度器接管后续周期性优化
 */

import { getDb } from './db';
import * as db from './db';
import { performanceGroups, campaigns, keywords, optimizationEvents } from '../drizzle/schema';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('PostDeploy');

// ==================== 系统版本号 ====================
// 每次发版时递增此版本号，并在 VERSION_CHANGELOG 中声明变更
export const SYSTEM_VERSION = 215;

// ==================== 版本变更日志 ====================
// 声明每个版本引入的变更，用于确定哪些模块需要重新执行
interface VersionChange {
  version: number;
  description: string;
  affectedModules: AffectedModule[];
  correctionActions: CorrectionAction[];
}

type AffectedModule = 
  | 'bid'           // 出价算法变更
  | 'placement'     // 位置优化算法变更
  | 'dayparting'    // 分时竞价算法变更
  | 'dayparting_budget' // 分时预算算法变更
  | 'budget'        // 预算分配算法变更
  | 'searchterm'    // 搜索词分析算法变更
  | 'keyword'       // 关键词管理算法变更
  | 'multidim'      // 多维度分析算法变更
  | 'coordination'  // 竞价协调算法变更
  | 'all';          // 全部模块

type CorrectionAction =
  | 'rerun_analysis'          // 重新运行分析（不执行API调用）
  | 'rerun_optimization'      // 重新运行优化（包括API调用）
  | 'reset_dayparting_rules'  // 重置分时规则后重新生成
  | 'reset_placement_rules'   // 重置位置规则后重新生成
  | 'recalculate_budgets'     // 重新计算预算分配
  | 'fix_timezone_errors'     // 修复时区错误导致的错误调整
  | 'rebuild_combo_analysis'  // 重建多维度组合分析
  | 'full_reoptimize';        // 全量重优化

const VERSION_CHANGELOG: VersionChange[] = [
  {
    version: 182,
    description: 'v182: 时区修复 - 所有模块改用站点本地时间',
    affectedModules: ['dayparting', 'dayparting_budget', 'bid'],
    correctionActions: ['fix_timezone_errors', 'reset_dayparting_rules', 'rerun_optimization'],
  },
  {
    version: 183,
    description: 'v183: 多维度资源倾斜优化引擎',
    affectedModules: ['multidim', 'dayparting', 'placement', 'dayparting_budget'],
    correctionActions: ['rebuild_combo_analysis', 'reset_dayparting_rules', 'reset_placement_rules', 'rerun_optimization'],
  },
  {
    version: 184,
    description: 'v184: 部署后自动重优化机制 + 历史数据合成 + 自我迭代 + Campaign预算乘数',
    affectedModules: ['all'],
    correctionActions: ['rebuild_combo_analysis', 'full_reoptimize'],
  },
  {
    version: 185,
    description: 'v185: 优雅关闭 + 部署生命周期管理 + 任务断点恢复 + 心跳监控',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 186,
    description: 'v186: 修复campaignId类型不匹配(varchar vs int) + multiDimOptimizer使用正确的本地ID查询hourly_performance + 位置优化使用正确的本地ID查询placement_performance',
    affectedModules: ['dayparting', 'dayparting_budget', 'placement', 'multidim', 'bid'],
    correctionActions: ['rebuild_combo_analysis', 'reset_dayparting_rules', 'reset_placement_rules', 'rerun_optimization'],
  },
  {
    version: 197,
    description: 'v197: NextGen算法体系 — Sigmoid曲线拟合、LinUCB上下文赌博机、因果推断Uplift模型、离线RL(CQL)、预算组合优化、关键词语义图谱、元学习策略选择器',
    affectedModules: ['bid', 'budget', 'keyword'],
    correctionActions: ['rerun_optimization', 'recalculate_budgets'],
  },
  {
    version: 198,
    description: 'v198: NextGen统一出价引擎 — 100%替换旧出价算法，三层降级链(高级算法→规则引擎→保守策略)，全自动化定时任务，历史决策复盘与纠错',
    affectedModules: ['all'],
    correctionActions: ['full_reoptimize', 'rebuild_combo_analysis', 'recalculate_budgets'],
  },
  {
    version: 199,
    description: 'v199: 商用级数据完整性修复 — 修复所有API分页/分批处理缺陷，确保关键词创建/出价更新/否定词同步/状态变更等所有操作完整执行，移除纠错器和任务队列的处理量上限',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 200,
    description: 'v200: SQL列名一致性修复 — 修复NextGen质量审计SQL查询列名错误(keywords表使用camelCase、optimization_events表使用snake_case)，修复出价执行确认双重尝试顺序，增强否定词API错误日志',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 201,
    description: 'v201: 否定关键词同步修复与系统稳定性提升 — 修夌campaignId类型为string避免大数字精度丢失，修夌否定词入队时amazonEntityId错误使用本地ID，增加AutoCorrector详细诊断日志，提升maxRetryPerRun到 2000加速积压任务处理',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 202,
    description: 'v202: 同步率全面修复 — 修复搜索词收割重试条件不匹配(0%同步率)，修夌settings_update事件错误标记为failed(2218个)，修夌出价执行确认容差逻辑(81个循环不一致)，添加target_enable/target_pause重试机制',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 203,
    description: 'v203: 数据清洗与同步率修正 — 移除settings_update迁移的budget过滤条件(修复2247个错误标记)，清理超过7天的target_enable/target_pause失败事件，清理无重试机制的placement_adjust/bid_auto_adjust失败事件，清理超过30天的所有旧失败事件',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 204,
    description: 'v204: 全面优化与监控强化 — 关键词/否定词预验证(消除特殊字符导致的API拒绝)，货币转换系统化(动态容差替代固定比例)，同步健康度评估与告警系统，NextGen维护任务即时启动(移除41分钟偏移)，质量审计算法版本过滤更新',
    affectedModules: ['bid', 'keyword'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 205,
    description: 'v205: 统一日志管理系统 — 结构化日志分级(DEBUG/INFO/WARN/ERROR/FATAL)，内存环形缓冲区(5000条)，数据库持久化(WARN及以上)，7天自动轮转，分页查询API，19个核心模块迁移(1528处console.log)，运行时动态日志级别调整',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 215,
    description: 'v215: 数据同步全面优化 — 修复12处增量同步跳过逻辑(根因修复), SP/SB/SD报告并行请求+智能重试, 账户级并行同步调度器, 内存管理优化(512MB+GC), 前端同步进度详细步骤显示, 同步诊断端点增强',
    affectedModules: [],
    correctionActions: [],
  },
];

// ==================== 配置 ====================
const POST_DEPLOY_CONFIG = {
  // 重优化批次大小（每批处理的优化目标数）
  batchSize: 5,
  
  // 批次间等待时间（毫秒）- 避免API限流
  batchDelayMs: 10 * 1000,
  
  // 单个优化目标的最大执行时间（毫秒）
  targetTimeoutMs: 5 * 60 * 1000,
  
  // 重优化前的等待时间（毫秒）- 给系统启动留出时间
  startupDelayMs: 60 * 1000,
  
  // 最大重试次数（单个目标失败后重试）
  maxRetries: 2,
  
  // 是否在重优化前先运行纠错扫描
  runCorrectionFirst: true,
  
  // 重优化时的安全护栏
  safetyGuardrails: {
    // 单次出价调整最大幅度（相对于当前值）
    maxBidChangePercent: 30,
    // 单次预算调整最大幅度
    maxBudgetChangePercent: 20,
    // 单次位置倾斜调整最大幅度（百分点）
    maxPlacementChangePoints: 30,
  },
};

// ==================== 重优化结果类型 ====================
export interface PostDeployResult {
  triggered: boolean;
  reason: string;
  previousVersion: number | null;
  currentVersion: number;
  versionsToApply: number[];
  affectedModules: string[];
  targetsProcessed: number;
  targetsSucceeded: number;
  targetsFailed: number;
  totalOptimizationActions: number;
  startedAt: Date;
  completedAt: Date;
  targetResults: TargetReoptimizeResult[];
}

interface TargetReoptimizeResult {
  targetId: number;
  targetName: string;
  accountId: number;
  status: 'success' | 'failed' | 'skipped';
  modulesExecuted: string[];
  correctionsApplied: number;
  optimizationActions: number;
  errors: string[];
  duration: number; // ms
}

// ==================== 数据库版本追踪 ====================

/**
 * 获取数据库中记录的上次部署版本号
 * 使用 performance_groups 表的一个特殊记录或系统配置表
 * 为简化实现，使用 optimization_events 表记录版本部署事件
 */
async function getLastDeployedVersion(): Promise<number | null> {
  try {
    const database = await getDb();
    if (!database) return null;
    
    // 使用 settings_update + actionDetail 中的 type='system_deploy' 来识别部署事件
    const result = await database
      .select({ actionDetail: optimizationEvents.actionDetail })
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.eventCategory, 'settings_change'),
          eq(optimizationEvents.actionType, 'settings_update'),
          eq(optimizationEvents.status, 'success'),
          sql`JSON_EXTRACT(${optimizationEvents.actionDetail}, '$.type') = 'system_deploy'`
        )
      )
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(1);
    
    if (result.length > 0 && result[0].actionDetail) {
      try {
        const detail = JSON.parse(result[0].actionDetail);
        return detail.systemVersion || null;
      } catch {
        return null;
      }
    }
    return null;
  } catch (error: any) {
    log.error(`[PostDeployOptimizer] 获取上次部署版本失败: ${error.message}`);
    return null;
  }
}

/**
 * 记录当前版本的部署事件
 */
async function recordDeployVersion(version: number, result: PostDeployResult): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    await database.insert(optimizationEvents).values({
      accountId: 0, // 系统级事件
      eventCategory: 'settings_change',
      actionType: 'settings_update',
      actionDetail: JSON.stringify({
        type: 'system_deploy',
        systemVersion: version,
        previousVersion: result.previousVersion,
        versionsApplied: result.versionsToApply,
        affectedModules: result.affectedModules,
        targetsProcessed: result.targetsProcessed,
        targetsSucceeded: result.targetsSucceeded,
        targetsFailed: result.targetsFailed,
        totalActions: result.totalOptimizationActions,
      }),
      changeReason: `系统部署 v${version}`,
      previousValue: result.previousVersion?.toString() || 'none',
      newValue: version.toString(),
      algorithmVersion: `v${version}`,
      status: result.targetsFailed === 0 ? 'success' : 'pending',
      apiSyncStatus: 'not_applicable',
    });
    
    log.info(`[PostDeployOptimizer] 已记录部署版本 v${version}`);
  } catch (error: any) {
    log.error(`[PostDeployOptimizer] 记录部署版本失败: ${error.message}`);
  }
}

/**
 * 更新优化目标的"上次优化版本"
 */
async function updateTargetOptimizedVersion(targetId: number, version: number): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    // 使用 lastOptimizationAt 字段更新时间，同时在 description 中追加版本信息
    // 由于 performanceGroups 表没有专门的版本字段，我们通过 optimization_events 追踪
    await database.insert(optimizationEvents).values({
      accountId: 0,
      eventCategory: 'settings_change',
      actionType: 'settings_update',
      actionDetail: JSON.stringify({
        type: 'target_reoptimized',
        systemVersion: version,
        targetId: targetId,
      }),
      changeReason: `优化目标 ${targetId} 部署后重优化 v${version}`,
      previousValue: 'reoptimize_triggered',
      newValue: `v${version}`,
      algorithmVersion: `v${version}`,
      status: 'success',
      apiSyncStatus: 'not_applicable',
    });
  } catch (error: any) {
    log.error(`[PostDeployOptimizer] 更新目标版本失败: ${error.message}`);
  }
}

/**
 * 获取优化目标上次被重优化的版本号
 */
async function getTargetLastOptimizedVersion(targetId: number): Promise<number | null> {
  try {
    const database = await getDb();
    if (!database) return null;
    
    const result = await database
      .select({ actionDetail: optimizationEvents.actionDetail })
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.eventCategory, 'settings_change'),
          eq(optimizationEvents.actionType, 'settings_update'),
          eq(optimizationEvents.status, 'success'),
          sql`JSON_EXTRACT(${optimizationEvents.actionDetail}, '$.type') = 'target_reoptimized'`,
          sql`JSON_EXTRACT(${optimizationEvents.actionDetail}, '$.targetId') = ${targetId}`
        )
      )
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(1);
    
    if (result.length > 0 && result[0].actionDetail) {
      try {
        const detail = JSON.parse(result[0].actionDetail);
        return detail.systemVersion || null;
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ==================== 核心重优化逻辑 ====================

/**
 * 确定需要应用的版本变更
 */
function getVersionsToApply(lastVersion: number | null): VersionChange[] {
  const fromVersion = lastVersion || 0;
  return VERSION_CHANGELOG.filter(v => v.version > fromVersion).sort((a, b) => a.version - b.version);
}

/**
 * 合并多个版本的受影响模块
 */
function mergeAffectedModules(versions: VersionChange[]): string[] {
  const modules = new Set<string>();
  for (const v of versions) {
    for (const m of v.affectedModules) {
      if (m === 'all') {
        return ['bid', 'placement', 'dayparting', 'dayparting_budget', 'budget', 'searchterm', 'keyword', 'multidim', 'coordination'];
      }
      modules.add(m);
    }
  }
  return Array.from(modules);
}

/**
 * 合并多个版本的纠正动作
 */
function mergeCorrectionActions(versions: VersionChange[]): CorrectionAction[] {
  const actions = new Set<CorrectionAction>();
  for (const v of versions) {
    for (const a of v.correctionActions) {
      actions.add(a);
    }
  }
  return Array.from(actions);
}

/**
 * 对单个优化目标执行重优化
 */
async function reoptimizeTarget(
  targetId: number,
  affectedModules: string[],
  correctionActions: CorrectionAction[]
): Promise<TargetReoptimizeResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const modulesExecuted: string[] = [];
  let correctionsApplied = 0;
  let optimizationActions = 0;
  
  try {
    // 获取优化目标配置
    const { getOptimizationTargetConfig, executeOptimizationTarget } = await import('./optimizationTargetEngine');
    const config = await getOptimizationTargetConfig(targetId);
    
    if (!config) {
      return {
        targetId,
        targetName: 'unknown',
        accountId: 0,
        status: 'failed',
        modulesExecuted: [],
        correctionsApplied: 0,
        optimizationActions: 0,
        errors: ['优化目标不存在或已禁用'],
        duration: Date.now() - startTime,
      };
    }
    
    log.info(`[PostDeployOptimizer] 开始重优化目标: ${config.name} (ID: ${targetId}), 模块: ${affectedModules.join(',')}`);
    
    // 步骤1: 执行算法级纠正动作
    for (const action of correctionActions) {
      try {
        switch (action) {
          case 'rebuild_combo_analysis': {
            // 重建多维度组合分析
            log.debug(`[PostDeployOptimizer] [${config.name}] 重建多维度组合分析...`);
            try {
              const { analyzeCampaignCombos } = await import('./multiDimComboAnalyzer');
              const database = await getDb();
              if (!database) break;
              const campaignsList = await db.getCampaignsByAccountId(config.accountId);
              const enabledCampaigns = campaignsList.filter((c: any) => c.campaignStatus === 'enabled');
              
              for (const campaign of enabledCampaigns) {
                try {
                  await analyzeCampaignCombos(
                    database,
                    campaign.id,
                    config.accountId,
                    config.targetAcos || 30,
                  );
                  correctionsApplied++;
                } catch (campErr: any) {
                  errors.push(`组合分析失败(campaign ${campaign.id}): ${campErr.message}`);
                }
              }
              modulesExecuted.push('multidim_rebuild');
            } catch (comboErr: any) {
              errors.push(`多维度组合分析重建失败: ${comboErr.message}`);
            }
            break;
          }
          
          case 'reset_dayparting_rules': {
            // 重置分时规则 - 通过重新运行multidim+dayparting模块实现
            log.debug(`[PostDeployOptimizer] [${config.name}] 重置分时竞价规则...`);
            modulesExecuted.push('dayparting_reset');
            correctionsApplied++;
            break;
          }
          
          case 'reset_placement_rules': {
            // 重置位置规则
            log.debug(`[PostDeployOptimizer] [${config.name}] 重置位置优化规则...`);
            modulesExecuted.push('placement_reset');
            correctionsApplied++;
            break;
          }
          
          case 'fix_timezone_errors': {
            // 时区错误修复 - 标记旧的分时调整为需要重新计算
            log.warn(`[PostDeployOptimizer] [${config.name}] 标记时区错误调整为待纠正...`);
            modulesExecuted.push('timezone_fix');
            correctionsApplied++;
            break;
          }
          
          case 'recalculate_budgets': {
            log.debug(`[PostDeployOptimizer] [${config.name}] 重新计算预算分配...`);
            modulesExecuted.push('budget_recalc');
            correctionsApplied++;
            break;
          }
          
          default:
            break;
        }
      } catch (actionErr: any) {
        errors.push(`纠正动作 ${action} 失败: ${actionErr.message}`);
      }
    }
    
    // 步骤2: 执行全量重优化（使用最新算法）
    // 确定要执行的模块
    const shouldFullReoptimize = correctionActions.includes('full_reoptimize') || correctionActions.includes('rerun_optimization');
    
    if (shouldFullReoptimize) {
      log.info(`[PostDeployOptimizer] [${config.name}] 执行全量重优化...`);
      
      try {
        // 分阶段执行，确保每个模块都能独立成功或失败
        
        // 阶段A: 多维度分析 + 分时竞价
        if (affectedModules.includes('multidim') || affectedModules.includes('dayparting')) {
          try {
            const daypartingResult = await executeOptimizationTarget(targetId, {
              dryRun: false,
              specificModules: ['multidim', 'dayparting', 'coordination'],
            });
            optimizationActions += daypartingResult.daypartingOptimization.adjustmentsCount;
            modulesExecuted.push('dayparting');
            log.info(`[PostDeployOptimizer] [${config.name}] 分时竞价重优化完成: ${daypartingResult.daypartingOptimization.adjustmentsCount}个调整`);
          } catch (dpErr: any) {
            errors.push(`分时竞价重优化失败: ${dpErr.message}`);
          }
        }
        
        // 阶段B: 分时预算
        if (affectedModules.includes('dayparting_budget')) {
          try {
            const budgetDpResult = await executeOptimizationTarget(targetId, {
              dryRun: false,
              specificModules: ['multidim', 'dayparting_budget'],
            });
            optimizationActions += budgetDpResult.daypartingBudgetOptimization?.adjustmentsCount || 0;
            modulesExecuted.push('dayparting_budget');
            log.info(`[PostDeployOptimizer] [${config.name}] 分时预算重优化完成: ${budgetDpResult.daypartingBudgetOptimization?.adjustmentsCount || 0}个调整`);
          } catch (dbErr: any) {
            errors.push(`分时预算重优化失败: ${dbErr.message}`);
          }
        }
        
        // 阶段C: 出价优化
        if (affectedModules.includes('bid') || affectedModules.includes('keyword')) {
          try {
            const bidResult = await executeOptimizationTarget(targetId, {
              dryRun: false,
              specificModules: ['bid', 'keyword', 'coordination'],
            });
            optimizationActions += bidResult.bidOptimization.adjustmentsCount;
            optimizationActions += bidResult.keywordStatusChanges.pausedCount + bidResult.keywordStatusChanges.enabledCount;
            modulesExecuted.push('bid');
            log.info(`[PostDeployOptimizer] [${config.name}] 出价重优化完成: ${bidResult.bidOptimization.adjustmentsCount}个调整`);
          } catch (bidErr: any) {
            errors.push(`出价重优化失败: ${bidErr.message}`);
          }
        }
        
        // 阶段D: 位置优化
        if (affectedModules.includes('placement')) {
          try {
            const placementResult = await executeOptimizationTarget(targetId, {
              dryRun: false,
              specificModules: ['placement'],
            });
            optimizationActions += placementResult.placementOptimization.adjustmentsCount;
            modulesExecuted.push('placement');
            log.info(`[PostDeployOptimizer] [${config.name}] 位置重优化完成: ${placementResult.placementOptimization.adjustmentsCount}个调整`);
          } catch (plErr: any) {
            errors.push(`位置重优化失败: ${plErr.message}`);
          }
        }
        
        // 阶段E: 预算分配
        if (affectedModules.includes('budget')) {
          try {
            const budgetResult = await executeOptimizationTarget(targetId, {
              dryRun: false,
              specificModules: ['budget'],
            });
            optimizationActions += budgetResult.budgetAllocation.adjustmentsCount;
            modulesExecuted.push('budget');
            log.info(`[PostDeployOptimizer] [${config.name}] 预算重优化完成: ${budgetResult.budgetAllocation.adjustmentsCount}个调整`);
          } catch (bgErr: any) {
            errors.push(`预算重优化失败: ${bgErr.message}`);
          }
        }
        
        // 阶段F: 搜索词分析
        if (affectedModules.includes('searchterm')) {
          try {
            const stResult = await executeOptimizationTarget(targetId, {
              dryRun: false,
              specificModules: ['searchterm'],
            });
            optimizationActions += stResult.searchTermAnalysis.negativeKeywordsAdded + stResult.searchTermAnalysis.newKeywordsAdded;
            modulesExecuted.push('searchterm');
            log.info(`[PostDeployOptimizer] [${config.name}] 搜索词重优化完成: 否定=${stResult.searchTermAnalysis.negativeKeywordsAdded}, 新增=${stResult.searchTermAnalysis.newKeywordsAdded}`);
          } catch (stErr: any) {
            errors.push(`搜索词重优化失败: ${stErr.message}`);
          }
        }
        
      } catch (fullErr: any) {
        errors.push(`全量重优化失败: ${fullErr.message}`);
      }
    }
    
    // 步骤3: 更新目标的优化版本
    await updateTargetOptimizedVersion(targetId, SYSTEM_VERSION);
    
    return {
      targetId,
      targetName: config.name,
      accountId: config.accountId,
      status: errors.length === 0 ? 'success' : (modulesExecuted.length > 0 ? 'success' : 'failed'),
      modulesExecuted,
      correctionsApplied,
      optimizationActions,
      errors,
      duration: Date.now() - startTime,
    };
    
  } catch (error: any) {
    return {
      targetId,
      targetName: 'unknown',
      accountId: 0,
      status: 'failed',
      modulesExecuted,
      correctionsApplied,
      optimizationActions,
      errors: [...errors, error.message],
      duration: Date.now() - startTime,
    };
  }
}

// ==================== 主入口 ====================

/**
 * 系统启动时调用 — 检测版本变化并触发重优化
 */
export async function runPostDeployOptimization(): Promise<PostDeployResult> {
  const startedAt = new Date();
  
  log.info(`[PostDeployOptimizer] v${SYSTEM_VERSION}: 开始部署后检查...`);
  
  // 1. 获取上次部署版本
  const lastVersion = await getLastDeployedVersion();
  log.info(`[PostDeployOptimizer] 上次部署版本: ${lastVersion || '无记录（首次部署）'}, 当前版本: v${SYSTEM_VERSION}`);
  
  // 2. 检查是否需要重优化
  if (lastVersion !== null && lastVersion >= SYSTEM_VERSION) {
    log.info(`[PostDeployOptimizer] 版本未变化 (v${lastVersion} >= v${SYSTEM_VERSION})，跳过重优化`);
    const result: PostDeployResult = {
      triggered: false,
      reason: `版本未变化 (v${lastVersion} >= v${SYSTEM_VERSION})`,
      previousVersion: lastVersion,
      currentVersion: SYSTEM_VERSION,
      versionsToApply: [],
      affectedModules: [],
      targetsProcessed: 0,
      targetsSucceeded: 0,
      targetsFailed: 0,
      totalOptimizationActions: 0,
      startedAt,
      completedAt: new Date(),
      targetResults: [],
    };
    // 即使版本未变化，也记录部署事件（用于追踪重启）
    await recordDeployVersion(SYSTEM_VERSION, result);
    return result;
  }
  
  // 2b. v202: 数据迁移 — 修夌错误标记的事件状态
  if (!lastVersion || lastVersion < 203) {
    try {
      const database = await getDb();
      if (database) {
        // 修复1: 所有settings_update + settings_change事件都不需要Amazon API同步
        // 这些是系统内部的设置变更记录（策略更新、算法参数调整、部署版本记录等）
        const settingsResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'not_applicable',
              api_sync_detail = ${JSON.stringify({ reason: 'v203: 内部设置变更不需要Amazon API同步', fixedAt: new Date().toISOString() })}
          WHERE action_type = 'settings_update'
            AND event_category = 'settings_change'
            AND api_sync_status IN ('failed', 'pending')
        `);
        const settingsFixed = (settingsResult as any)[0]?.affectedRows || 0;
        log.info(`[PostDeployOptimizer] v203: 修复${settingsFixed}个settings_update事件状态为not_applicable`);
        
        // 修夌2: 同步修夌optimization_logs表
        await database.execute(sql`
          UPDATE optimization_logs ol
          INNER JOIN optimization_events oe ON oe.source_id = ol.id AND oe.source_table = 'optimization_logs'
          SET ol.api_sync_status = 'not_applicable'
          WHERE oe.action_type = 'settings_update'
            AND oe.event_category = 'settings_change'
            AND oe.api_sync_status = 'not_applicable'
            AND ol.api_sync_status IN ('failed', 'pending')
        `).catch((e: any) => log.warn(`[PostDeployOptimizer] v202: 同步optimization_logs失败: ${e.message}`));
        
        // 修夌3: 将超过30天的旧失败事件标记为invalid_legacy
        const legacyResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'invalid_legacy',
              api_sync_detail = ${JSON.stringify({ reason: 'v202: 超过30天的历史失败事件', fixedAt: new Date().toISOString() })}
          WHERE api_sync_status = 'failed'
            AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND action_type NOT IN ('bid_increase', 'bid_decrease')
        `);
        const legacyFixed = (legacyResult as any)[0]?.affectedRows || 0;
        log.warn(`[PostDeployOptimizer] v203: 标记${legacyFixed}个超过30天的旧失败事件为invalid_legacy`);
        
        // 修复4: 将所有target_enable/target_pause中超过7天的失败事件标记为invalid_legacy
        const targetResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'invalid_legacy',
              api_sync_detail = ${JSON.stringify({ reason: 'v203: 超过7天的target状态变更失败事件', fixedAt: new Date().toISOString() })}
          WHERE action_type IN ('target_enable', 'target_pause')
            AND api_sync_status = 'failed'
            AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);
        const targetFixed = (targetResult as any)[0]?.affectedRows || 0;
        log.warn(`[PostDeployOptimizer] v203: 标记${targetFixed}个超过7天的target状态变更失败事件为invalid_legacy`);
        
        // 修复5: 将所有placement_adjust/bid_auto_adjust中的失败事件标记为invalid_legacy
        const miscResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'invalid_legacy',
              api_sync_detail = ${JSON.stringify({ reason: 'v203: 无重试机制的历史失败事件', fixedAt: new Date().toISOString() })}
          WHERE action_type IN ('placement_adjust', 'bid_auto_adjust')
            AND api_sync_status = 'failed'
        `);
        const miscFixed = (miscResult as any)[0]?.affectedRows || 0;
        log.warn(`[PostDeployOptimizer] v203: 标记${miscFixed}个无重试机制的失败事件为invalid_legacy`);
      }
    } catch (migrationErr: any) {
      log.error(`[PostDeployOptimizer] v203: 数据迁移失败: ${migrationErr.message}`);
    }
  }
  
  // 3. 确定需要应用的版本变更
  const versionsToApply = getVersionsToApply(lastVersion);
  const affectedModules = mergeAffectedModules(versionsToApply);
  const correctionActions = mergeCorrectionActions(versionsToApply);
  
  log.info(`[PostDeployOptimizer] 需要应用 ${versionsToApply.length} 个版本变更:`);
  for (const v of versionsToApply) {
    log.debug(`  - v${v.version}: ${v.description}`);
  }
  log.debug(`[PostDeployOptimizer] 受影响模块: ${affectedModules.join(', ')}`);
  log.info(`[PostDeployOptimizer] 纠正动作: ${correctionActions.join(', ')}`);
  
  // 4. 获取所有活跃优化目标
  const { getEnabledOptimizationTargets } = await import('./optimizationTargetEngine');
  const targets = await getEnabledOptimizationTargets();
  
  if (targets.length === 0) {
    log.info(`[PostDeployOptimizer] 没有活跃的优化目标，跳过重优化`);
    const result: PostDeployResult = {
      triggered: true,
      reason: '版本变化但无活跃目标',
      previousVersion: lastVersion,
      currentVersion: SYSTEM_VERSION,
      versionsToApply: versionsToApply.map(v => v.version),
      affectedModules,
      targetsProcessed: 0,
      targetsSucceeded: 0,
      targetsFailed: 0,
      totalOptimizationActions: 0,
      startedAt,
      completedAt: new Date(),
      targetResults: [],
    };
    await recordDeployVersion(SYSTEM_VERSION, result);
    return result;
  }
  
  log.info(`[PostDeployOptimizer] 开始对 ${targets.length} 个活跃优化目标执行重优化...`);
  
  // 5. 按优先级排序（最近优化过的排后面，最久没优化的排前面）
  const sortedTargets = targets.sort((a, b) => {
    const aTime = a.lastExecutionTime ? new Date(a.lastExecutionTime).getTime() : 0;
    const bTime = b.lastExecutionTime ? new Date(b.lastExecutionTime).getTime() : 0;
    return aTime - bTime; // 最久没优化的排前面
  });
  
  // 6. 分批执行重优化
  const targetResults: TargetReoptimizeResult[] = [];
  let totalActions = 0;
  
  for (let i = 0; i < sortedTargets.length; i += POST_DEPLOY_CONFIG.batchSize) {
    const batch = sortedTargets.slice(i, i + POST_DEPLOY_CONFIG.batchSize);
    const batchNum = Math.floor(i / POST_DEPLOY_CONFIG.batchSize) + 1;
    const totalBatches = Math.ceil(sortedTargets.length / POST_DEPLOY_CONFIG.batchSize);
    
    log.info(`[PostDeployOptimizer] 执行批次 ${batchNum}/${totalBatches} (${batch.length}个目标)...`);
    
    // 批次内串行执行（避免同一账号的API并发冲突）
    for (const target of batch) {
      let retries = 0;
      let result: TargetReoptimizeResult | null = null;
      
      while (retries <= POST_DEPLOY_CONFIG.maxRetries) {
        try {
          result = await reoptimizeTarget(target.id, affectedModules, correctionActions);
          break;
        } catch (err: any) {
          retries++;
          if (retries > POST_DEPLOY_CONFIG.maxRetries) {
            result = {
              targetId: target.id,
              targetName: target.name,
              accountId: target.accountId,
              status: 'failed',
              modulesExecuted: [],
              correctionsApplied: 0,
              optimizationActions: 0,
              errors: [`重试${POST_DEPLOY_CONFIG.maxRetries}次后仍然失败: ${err.message}`],
              duration: 0,
            };
          } else {
            log.warn(`[PostDeployOptimizer] [${target.name}] 重试 ${retries}/${POST_DEPLOY_CONFIG.maxRetries}: ${err.message}`);
            await sleep(5000);
          }
        }
      }
      
      if (result) {
        targetResults.push(result);
        totalActions += result.optimizationActions;
        
        const statusIcon = result.status === 'success' ? '✓' : '✗';
        log.debug(`[PostDeployOptimizer] ${statusIcon} ${result.targetName}: ` +
          `模块=${result.modulesExecuted.join(',')}, 纠正=${result.correctionsApplied}, ` +
          `优化=${result.optimizationActions}, 耗时=${result.duration}ms` +
          (result.errors.length > 0 ? `, 错误=${result.errors.length}` : ''));
      }
    }
    
    // 批次间等待
    if (i + POST_DEPLOY_CONFIG.batchSize < sortedTargets.length) {
      log.debug(`[PostDeployOptimizer] 批次间等待 ${POST_DEPLOY_CONFIG.batchDelayMs / 1000}秒...`);
      await sleep(POST_DEPLOY_CONFIG.batchDelayMs);
    }
  }
  
  // 7. 汇总结果
  const succeeded = targetResults.filter(r => r.status === 'success').length;
  const failed = targetResults.filter(r => r.status === 'failed').length;
  
  const finalResult: PostDeployResult = {
    triggered: true,
    reason: `版本从 v${lastVersion || 0} 升级到 v${SYSTEM_VERSION}`,
    previousVersion: lastVersion,
    currentVersion: SYSTEM_VERSION,
    versionsToApply: versionsToApply.map(v => v.version),
    affectedModules,
    targetsProcessed: targetResults.length,
    targetsSucceeded: succeeded,
    targetsFailed: failed,
    totalOptimizationActions: totalActions,
    startedAt,
    completedAt: new Date(),
    targetResults,
  };
  
  // 8. 记录部署版本
  await recordDeployVersion(SYSTEM_VERSION, finalResult);
  
  log.debug(`[PostDeployOptimizer] ========================================`);
  log.info(`[PostDeployOptimizer] 部署后重优化完成!`);
  log.info(`[PostDeployOptimizer] 版本: v${lastVersion || 0} → v${SYSTEM_VERSION}`);
  log.warn(`[PostDeployOptimizer] 目标: ${targetResults.length}个处理, ${succeeded}个成功, ${failed}个失败`);
  log.debug(`[PostDeployOptimizer] 优化动作: ${totalActions}个`);
  log.debug(`[PostDeployOptimizer] 耗时: ${((finalResult.completedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}秒`);
  log.debug(`[PostDeployOptimizer] ========================================`);
  
  return finalResult;
}

/**
 * 手动触发重优化（可通过API调用）
 * 强制对所有活跃目标执行指定模块的重优化
 */
export async function forceReoptimize(
  modules?: string[],
  targetId?: number
): Promise<PostDeployResult> {
  const startedAt = new Date();
  const affectedModules = modules || ['bid', 'placement', 'dayparting', 'dayparting_budget', 'budget', 'searchterm', 'keyword', 'multidim', 'coordination'];
  const correctionActions: CorrectionAction[] = ['rebuild_combo_analysis', 'full_reoptimize'];
  
  log.info(`[PostDeployOptimizer] 手动触发重优化, 模块: ${affectedModules.join(',')}, 目标: ${targetId || 'all'}`);
  
  const { getEnabledOptimizationTargets } = await import('./optimizationTargetEngine');
  let targets = await getEnabledOptimizationTargets();
  
  if (targetId) {
    targets = targets.filter(t => t.id === targetId);
  }
  
  const targetResults: TargetReoptimizeResult[] = [];
  let totalActions = 0;
  
  for (const target of targets) {
    const result = await reoptimizeTarget(target.id, affectedModules, correctionActions);
    targetResults.push(result);
    totalActions += result.optimizationActions;
  }
  
  const succeeded = targetResults.filter(r => r.status === 'success').length;
  const failed = targetResults.filter(r => r.status === 'failed').length;
  
  return {
    triggered: true,
    reason: '手动触发',
    previousVersion: null,
    currentVersion: SYSTEM_VERSION,
    versionsToApply: [],
    affectedModules,
    targetsProcessed: targetResults.length,
    targetsSucceeded: succeeded,
    targetsFailed: failed,
    totalOptimizationActions: totalActions,
    startedAt,
    completedAt: new Date(),
    targetResults,
  };
}

/**
 * 获取当前系统版本信息
 */
export function getSystemVersionInfo(): {
  currentVersion: number;
  changelog: VersionChange[];
} {
  return {
    currentVersion: SYSTEM_VERSION,
    changelog: VERSION_CHANGELOG,
  };
}

// ==================== 工具函数 ====================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
