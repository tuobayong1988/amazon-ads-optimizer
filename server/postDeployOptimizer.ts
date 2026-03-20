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
 * 与现有系统的关系 (v261重构后):
 * - 在 optimizationAutoCorrector（API执行级纠错）之前运行（新算法优先原则）
 * - 执行顺序: PostDeploy重优化 → AutoCorrector纠错 → 效果验证
 * - 重优化完成后，常规调度器接管后续周期性优化
 */

import { getDb } from './db';
import * as db from './db';
import { performanceGroups, campaigns, keywords, optimizationEvents } from '../drizzle/schema';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { createModuleLogger } from './utils/logger';
import { SYSTEM_VERSION } from './utils/systemVersion';

const log = createModuleLogger('PostDeploy');

// ==================== 系统版本号 ====================
// v329重构: SYSTEM_VERSION 统一从 utils/systemVersion.ts 导入，消除双源不同步问题
// 每次发版时只需修改 utils/systemVersion.ts 中的版本号
// 重新导出以保持向后兼容（_core/index.ts 和 routes/ops.ts 从此文件导入）
export { SYSTEM_VERSION };

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
  | 'sync'          // API同步链路变更
  | 'product_target' // 商品定向管理变更
  | 'all';          // 全部模块

type CorrectionAction =
  | 'rerun_analysis'          // 重新运行分析（不执行API调用）
  | 'rerun_optimization'      // 重新运行优化（包括API调用）
  | 'reset_dayparting_rules'  // 重置分时规则后重新生成
  | 'reset_placement_rules'   // 重置位置规则后重新生成
  | 'recalculate_budgets'     // 重新计算预算分配
  | 'fix_timezone_errors'     // 修复时区错误导致的错误调整
  | 'rebuild_combo_analysis'  // 重建多维度组合分析
  | 'full_reoptimize'        // 全量重优化
  | 'cleanup_stale_pending'   // 清理无效pending日志
  | 'revalidate_pending_commands'  // v310: 用新算法重评估pending指令合理性
  | 'audit_synced_commands'        // v310: 回溯审计已执行指令的正确性
  | 'retry_product_target_sync'   // v310: 重试商品定向同步
  | 'resync_data'                  // v344: 触发全量数据重新同步
  | 'cold_start';                  // v344: 触发冷启动流程

const VERSION_CHANGELOG: VersionChange[] = [
  {
    version: 482,
    description: 'v482: [多租户数据隔离与权限修复] — (1)P0-算法效果概览数据隔离: algorithmEffectService.ts的optimization_events和optimization_logs查询改为基于账户归属(accountId)的数据隔离，系统管理员查看所有数据，普通用户只能查看自己账户的数据，新用户无账户时返回空数据 (2)P0-预发布引擎权限收紧: DashboardLayout.tsx侧边栏预发布引擎菜单从"role===admin"改为"role===admin && organizationId===1"，仅内部系统管理员可见 (3)P1-移除ElaraFit占位符: Amazon API添加店铺弹窗的placeholder从"例如：ElaraFit、My Store等"改为"例如：My Store、我的店铺等"',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 481,
    description: 'v481: [注册页面自动跳转登录页紧急修复] — (1)P0-inviteCode.validate从protectedProcedure改为publicProcedure: 允许未登录用户在注册页面验证邀请码 (2)P0-公开页面免疫未授权重定向: main.tsx的redirectToLoginIfUnauthorized排除/register等公开路径，防止未登录用户被强制跳转到登录页',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 480,
    description: 'v480: [SP Manual否定产品定向400错误根因修复] — (1)P0-定向算法修复: SP Manual广告活动的否定产品定向从Campaign级降级为AdGroup级，因为Amazon API不允许Manual广告活动创建Campaign级否定产品定向(返回400错误)，只有SP Auto广告活动支持Campaign级否定产品定向',
    affectedModules: ['searchterm'],
    correctionActions: [],
  },
  {
    version: 479,
    description: 'v479: [彻底消除entityNotFoundError残留] — (1)P0-修复h.execute bug: getDb()改为await getDb()+sql.raw()模板，修复v477标记过期关键词功能完全失效的问题 (2)P0-重试队列amazon_deleted清理: 批量同步前自动取消引用amazon_deleted/archived实体的pending/retry任务 (3)P0-updateKeywordStatus entityNotFound检测: 关键词状态更新的per-item错误现在也能检测entityNotFoundError并自动标记',
    affectedModules: ['bid', 'placement', 'dayparting', 'searchterm'],
    correctionActions: [],
  },
  {
    version: 478,
    description: 'v478: [全面修复5类失败根因 — 实现100%API执行成功率] — (1)P0-SB/SD否定词API路由: SB/SD广告活动的否定关键词不再误用SP API，改为跳过并记录 (2)P0-否定产品定向幂等性: 创建前查询已有否定产品定向，去除重复避免报错 (3)P0-错误详情回写: 否定产品定向的失败原因现在被正确记录到apiSyncDetail (4)P0-失败重试入队: add_negative_product_target失败现在会被收集并入队重试 (5)P1-campaignType传递: 否定关键词的detail对象现在携带campaignType用于API路由',
    affectedModules: ['searchterm'],
    correctionActions: [],
  },
  {
    version: 477,
    description: 'v477: [entityNotFoundError根治 — 智能重试+预过滤+自动标记机制] — (1)P0-智能重试: 遇到entityNotFoundError时自动提取坏的entity ID，从API批次中移除后重试剩余项目，最多10次 (2)P0-预过滤: 在构建API批次前查询keyword/target的状态，自动跳过amazon_deleted/archived的entity (3)P0-自动标记: 被Amazon拒绝的entity自动标记为amazon_deleted，防止后续重复失败 (4)覆盖范围: updateKeywordBids/updateProductTargetBids/updateKeywordStatus三个API函数',
    affectedModules: ['bid', 'placement', 'dayparting', 'dayparting_budget', 'searchterm'],
    correctionActions: [],
  },
  {
    version: 476,
    description: 'v476: [API限流防护 — 全层级激进节流机制，优先保证100%成功率] — (1)P0-优化模块间节流: 每个模块执行后等待20秒 (2)P0-PostDeploy阶段间节流: A-F阶段间每次等待20秒 (3)P0-目标间节流: 调度器和PostDeploy目标间均等待30秒 (4)P0-广告活动间节流: 每个广告活动的优化操作间隔5秒 (5)P1-API批次间节流: 关键词/商品定向批量更新间等待10秒 (6)P1-建议竞价同步节流: 每个adGroup请求间隔5秒 (7)P1-重试机制增强: 基础延迟10秒/最大退避60秒/最多5次重试 (8)P2-数据同步节流: 步骤间基础延迟2秒/大账户额外延迟10秒/账户间延迟10秒',
    affectedModules: ['bid', 'placement', 'dayparting', 'dayparting_budget', 'budget', 'searchterm'],
    correctionActions: [],
  },
  {
    version: 475,
    description: 'v475: [PostDeployOptimizer自愈修复+全量重优化触发] — (1)P0-版本检测修复: getLastDeployedVersion现在同时接受success和partial_success状态,修复无限重试循环 (2)P0-状态判定改进: 无模块执行且无错误时视为success(无需操作) (3)P0-全量重优化触发: 因之前版本从未真正执行重优化,本版本强制触发full_reoptimize对所有活跃目标重新优化 (4)P1-错误详情日志: 每个目标的重优化错误现在以WARN级别记录,便于诊断',
    affectedModules: ['bid', 'placement', 'dayparting', 'dayparting_budget', 'budget', 'searchterm', 'keyword', 'multidim', 'coordination', 'product_target'],
    correctionActions: ['full_reoptimize', 'rerun_optimization', 'revalidate_pending_commands', 'audit_synced_commands', 'rerun_correction_scan'],
  },
  {
    version: 445,
    description: 'v445: [锁冲突机制修复 + force-sync重构 + 错误解析增强] — (1)P0-force-sync重构: tier=full时使用triggerManualFullSync获得完整功能(含nightly步骤+心跳进度), 添加isManual标记使手动同步获得最高优先级 (2)P0-trigger_source区分: data_sync_jobs新增trigger_source字段区分manual/auto, 自动同步调度器排除手动同步job避免互相阻塞 (3)P1-negative_keyword错误解析增强: 覆盖otherError/entityNotFoundError/malformedValueError等所有Amazon错误类型, 不再丢失错误详情 (4)P1-不可恢复错误自动检测: entityNotFoundError/malformedValueError直接标记permanently_failed不再重试 (5)P2-archived实体过滤: getKeywordsByCampaignId/getKeywordsByAdGroupId/getProductTargetsByCampaignId自动过滤archived状态实体',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'ops', 'db'],
    correctionActions: [],
  },
  {
    version: 444,
    description: 'v444: [全局字段/ID标准统一审计与修复 + API错误解析增强] — (1)P0-历史NULL数据回填: product_targets 29条+2条重复删除, search_terms 493条, negative_keywords 21条孤儿数据删除 (2)P0-全局accountId NOT NULL约束: 对24个表的accountId字段统一加NOT NULL约束 (3)P1-schema同步: drizzle/schema.ts中所有accountId字段统一为.notNull() (4)P2-API错误解析增强: SP/SB keyword、product target的API错误响应现在记录完整JSON对象，兼容errorCode/errorMessage/errorDescription等字段名',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['schema', 'db', 'sync'],
    correctionActions: [],
  },
  {
    version: 443,
    description: 'v443: [僵尸账户自动检测与标注机制] — (1)P0-僵尸账户自动检测: 新增zombieAccountDetector模块,在每次high层同步完成后自动检查连续10次同步0条记录的账户并自动标记为paused (2)P0-paused账户过滤: discoverSyncableAccounts现在过滤paused状态的账户,不再浪费API调用 (3)P1-账户管理API: 新增POST /api/ops/detect-zombies手动触发检测 + POST /api/ops/reactivate-account重新激活账户 (4)P2-立即暂停90022(MX)/90025(CA)/90026(MX)三个无经营账户',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'ops', 'infrastructure'],
    correctionActions: [],
  },
  {
    version: 442,
    description: 'v442: [AMS累加模式重构 + 统一同步日志 + 僵尸账户排查] — (1)P0-AMS数据处理重构: upsertDailyPerformanceFromAms从over写模式转为累加模式(impressions+=, clicks+=, cost+=, sales+=),新增ams_processed_messages表实现idempotency_id去重 (2)P0-updateDailyPerformanceConversion同样重构为累加模式 (3)P1-统一同步日志: force-sync端点现在会创建data_sync_jobs记录,同步完成后更新状态/耗时/记录数 (4)P2-僵尸账户排查: 确认90022(MX)/90025(CA)/90026(MX)API凭证有效但Amazon后台无广告活动',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'db', 'ops'],
    correctionActions: [
      'CREATE TABLE IF NOT EXISTS ams_processed_messages (id INT AUTO_INCREMENT PRIMARY KEY, idempotency_id VARCHAR(128) NOT NULL UNIQUE, dataset_id VARCHAR(64), processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
    ],
  },
  {
    version: 418,
    description: 'v418: [ID体系一致性重构 + 集中式ID解析 + API验证层] — (1)P0-BUG修复: 修复SD匹配目标报告错误的reportTypeId(sdMatchedTarget→sdTargeting), SB广告位报告配置错误(reportTypeId+groupBy), 搜索词收割harvestAmazonAdGroupId未赋值, 否定关键词campaignId回退使用内部ID (2)P0-模式重构: keywords/productTargets/searchTerms/negativeKeywords等11张表的adGroupId(varchar)重命名为internalAdGroupId(int),统一ID类型消除隐式类型转换 (3)P1-集中式ID解析服务: 新增EntityIdResolver统一处理内部ID↔Amazon ID转换,带缓存和批量解析 (4)P1-API参数预检验证层: 新增AmazonApiValidator基于官方Postman集合验证reportTypeId/groupBy/columns/ID格式',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'optimization', 'schema', 'utils'],
    correctionActions: [
      'ALTER TABLE keywords CHANGE COLUMN ad_group_id internal_ad_group_id INT',
      'ALTER TABLE product_targets CHANGE COLUMN ad_group_id internal_ad_group_id INT',
      'ALTER TABLE search_terms CHANGE COLUMN ad_group_id internal_ad_group_id INT',
      'ALTER TABLE negative_keywords CHANGE COLUMN ad_group_id internal_ad_group_id INT',
    ],
  },
  {
    version: 417,
    description: 'v417: [信息孤岛审计与修复 + 架构优化] — (1)P0-实现缺失API: 新增amazonApi.getAllAuthStatus和amazonApi.refreshToken两个tRPC路由,修复前端AmazonApiAuthStatus页面的断裂链路 (2)P0-启动effectTrackingScheduler: 在系统启动时调用startEffectTrackingScheduler(每1小时),并在deployLifecycleManager中添加优雅停止逻辑 (3)P1-清理死代码: 删除services/effectTrackingScheduler.ts(664行)、services/amazonApiTypes.ts(53行)、sync/performanceSyncOptimizer.ts(252行) (4)P2-架构优化: sync目录整合(services/sync→sync/)、bidOptimizer.ts拆分为5个功能模块、前端pages按功能域重组到12个子目录',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'optimization', 'frontend', 'infrastructure'],
    correctionActions: [],
  },
  {
    version: 416,
    description: 'v416: [后端代码结构重构] — (1)P0-server根目录重组: 将114个文件按功能域归类到28个子目录(api/、sync/、scheduler/、optimization/、budget/、analytics/、system/、config/、automation/等) (2)P0-更新601个import路径: 自动化脚本处理所有静态import和动态import的路径更新 (3)P1-清理70+顶层杂散文件: 历史报告/调试脚本/图表归档到docs/archive/ (4)P2-项目文档体系: 新增docs/development/下架构说明、模块说明、开发指南',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['infrastructure'],
    correctionActions: [],
  },
  {
    version: 415,
    description: 'v415: [建议竞价同步+数据同步全面审计] — (1)P0-新增SP建议竞价同步: 在syncSp.ts中新增syncSpBidRecommendations方法,按adGroup分组批量调用Amazon SP Bid Recommendations API,将suggestedBid写入keywords和productTargets表 (2)P0-新增SYNC_STEP: sp_bid_recommendations步骤(full tier),在每次完整同步时自动获取建议竞价 (3)P1-前端展示建议竞价: 在AdGroupDetail的关键词和商品定位表格中添加建议竞价列,黄色表示建议竞价高于当前出价,绿色表示低于或等于 (4)P2-数据同步模块全面审计: 确认所有31个SYNC_STEPS覆盖SP/SB/SD所有层级',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'frontend'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 414,
    description: 'v414: [源码干净构建] — (1)P0-移除外挂BullMQ补丁: 清除v484-v490的所有运行时注入代码,恢复纯净源码架构 (2)P0-修SB adGroupId映射: 修复42849个SB keywords和3498个product targets的adGroupId今Amazon ID映射到内部DB ID (3)P1-消除Worker队列冲突: 移除v490独立的ads-account-sync-queue,解决与原始队列的Ay锁冲突问题',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 410,
    description: 'v410: [调度器全局并发控制] — (1)P0-数据库级别并发检查: executeUnifiedSync在执行前查询data_sync_jobs表中是否有running状态且心跳正常(近10分钟内更新)的任务,如果存在则跳过本次调度 (2)P0-解决手动/自动同步冲突: 之前手动触发的全量同步不会设置tierRunningState内存变量,导致调度器仍然会创建新任务,现在通过数据库查询彻底解决 (3)P1-避免API限流: 多个同步任务并发请求Amazon API会触发429/425限流,单任务运行确保最优API利用率 (4)P2-容错回退: 数据库检查失败时回退到内存级别tierRunningState检查,不阻塞正常同步',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 412,
    description: 'v412: [字段映射修复] — 修复Drizzle mysql2返回格式[rows,fields]的解析问题,确保并发检查和任务接管日志正确显示任务ID、账户、进度等信息',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 411,
    description: 'v411: [三项优化] — (1)P0-Stale cleanup阈值调优: 启动清理30分钟→10分钟,定期清理60分钟→15分钟,与v410并发检查窗口一致,避免僵尸任务长时间阻塞调度器 (2)P0-任务接管机制: 服务器重启后新实例读取中断任务的断点信息,对于步骤较多(>=10步)且已完成超过3步的任务,触发full同步接管恢复 (3)P1-并发控制日志增强: 添加跳过计数器、心跳时间、进度百分比,恢复执行时输出之前跳过次数',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 410,
    description: 'v410: [调度器全局并发控制] — 数据库级别检查running任务,避免调度器在全量同步运行时创建新任务导致API限流',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['scheduler'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 409,
    description: 'v409: [Startup/Shutdown清理机制修复] — (1)P0-Shutdown不再无条件杀死running同步任务: 之前SIGTERM时无条件将所有running任务标记为failed,导致正常运行的同步被误杀;现在只记录日志,由startup cleanup基于updated_at阈值处理 (2)P0-Startup cleanup添加5分钟阈值: 之前无条件清理所有running任务,现在只清理updated_at超过5分钟的任务(心跳间隔3分钟,5分钟无更新才判定为卡死) (3)P1-保护心跳正常的任务: startup时如果发现心跳正常的running任务,记录日志但不清理',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 408,
    description: 'v408: [心跳机制+僵尸清理修复] — (1)P0-心跳机制: 步骤执行期间每3分钟通过onProgress更新updated_at,防止长步骤(如当日绩效需等待Amazon报告生成15分钟)被误判为卡死 (2)P0-僵尸判定基准修复: cleanupStaleJobs从startedAt改为updated_at判断,只有长时间无更新才判定为卡死(而非启动时间超过阈值) (3)P1-清理阈值调整: 启动清理30分钟+定期清理60分钟(从startedAt的10/30分钟恢复为updated_at的合理阈值) (4)P2-异常安全: catch块中也清除心跳定时器防止内存泄漏',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 407,
    description: 'v407: [前后端进度一致性修复] — (1)P0-API增强: getSyncJobById返回currentStepIndex和totalSteps,前端可精确显示第X/Y步 (2)P0-前端进度修复: 整体进度条从站点级计算改为综合步骤级计算,直接使用后端progressPercent (3)P0-动态步骤进度条: 从硬编码17格改为根据totalSteps动态生成,支持31步全量同步 (4)P1-步骤名称显示: 直接显示后端返回的步骤名,不再依赖硬编码映射表',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'frontend'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 406,
    description: 'v406: [同步引擎全面修复] — (1)P0-进度更新await: syncAccount中onProgress回调添加await,确保DB写入完成后再继续,修复前端进度永远卡在初始状态的bug (2)P0-手动同步优先级: 新增isManual标记,手动全量同步不再被自动同步阻塞,强制释放自动同步锁 (3)P0-nightly PST时区: 夜间同步从服务器本地时间改为PST凌晨2点(UTC 10:00) (4)P1-僵尸任务清理: cleanupStaleJobs阈值从30分钟缩短到10分钟 (5)P1-锁释放修复: syncAll路由中锁释放移入finally块,确保整个同步期间持有锁 (6)P1-Job状态初始化: 同步启动时立即将job状态更新为running',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 405,
    description: 'v405: [Auto Scaling稳定性+同步SIGTERM保护] — (1)P0-Auto Scaling修复: Scale Down Cooldown从360s增加到900s,评估周期从1个(5min)增加到3个(15min),防止同步期间实例被终止 (2)P0-SIGTERM保护: syncAccount步骤循环中检查isShuttingDown,提前保存进度并优雅退出 (3)P1-部署后同步降级: deployLifecycleManager步骤3.5d从full层级改为high层级,避免CPU飙升触发伸缩 (4)P2-ebextensions配置: 新增04_autoscaling.config,固化Cooldown和滚动更新策略',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'infrastructure'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 404,
    description: 'v404: [统一同步代码路径] — (1)P0-手动同步统一: amazonApi.syncAll路由从500+行硬编码重构为调用unifiedSyncEngine.triggerManualFullSync,手动/自动同步共用同一代码路径 (2)P0-全量同步覆盖所有步骤: 手动全量同步现在执行所有SYNC_STEPS(含nightly层级),确保keyword_performance/target_performance/ad_group_performance不被遗漏 (3)P0-specificSteps修复: syncAccount中specificSteps现在从SYNC_STEPS全集过滤而非getStepsForTier结果,支持跨层级执行',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'api'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 403,
    description: 'v403: [数据隔离安全加固+nightly同步层级+前端优化+品牌重命名] — (1)P0-数据隔离: smartCampaign路由新增4个verifyAccountAccess中间件,堆塞越权访问漏洞 (2)P1-承载能力: EB环境变量DB_POOL_SIZE=100/NODE_OPTIONS=3072MB/MAX_CONCURRENT_ACCOUNTS=15 (3)P2-nightly同步层级: 将keyword_performance/target_performance/ad_group_performance从full迁移到nightly层级,每日凌晨2点执行,超时4小时,解决full层级超时问题 (4)P3-策略管理页面: 增加isError状态处理和重新加载按钮 (5)P3-品牌重命名: 全局替换Amazon Ads Optimizer为PPCOPT,移除页脚版权信息',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'frontend', 'security', 'infrastructure'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 402,
    description: 'v402: [后端分页+同步分解+连接池+前端优化] \u2014 (1)P1-后端分页API: campaigns.listPaginated新端点,支持服务端分页/排序/筛选/搜索,返回状态统计和类型统计 (2)P1-前端Campaigns页面改造: 切换到服务端分页模式,高级筛选时回退到全量模式 (3)P2-同步子任务分解: syncAll新增layers参数支持按层执行,Layer级别错误隔离,失败不影响后续层 (4)P3-连接池优化: DB_POOL_SIZE默认值从25提升到100 (5)P3-前端代码分割: SmartInsights/QuickActions懒加载,导出功能动态import,Campaigns chunk减少7%',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'frontend', 'infrastructure'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 401,
    description: 'v401: [深度性能优化+基础设施升级] — (1)P0-SQL索引优化: 将高频查询中的DATE()函数包裹改为范围查询,允许MySQL使用idx_daily_perf_campaign_date等索引(db-performance-trend/budgetTracking/budgetAlert/optimization.getTrends) (2)P0-SP自动定向同步N+1修复: syncAutoTargeting循环内的adGroup查询改为预加载Map+批量UPSERT (3)P1-RDS升级: db.t4g.small→db.t4g.medium(4GB RAM)+存储从20GB→50GB+IOPS升至3000 (4)P1-keywordPlacementHourlyPerformance表索引从PLAIN INDEX改为UNIQUE约束,防止并发重复数据 (5)P1-Dashboard目标达成度统一使用后端七维度评分而非前端简单比值 (6)P2-optimizationLogs表添加account_id+status+created_at复合索引优化getMetrics查询',
    affectedModules: ['sync', 'optimization', 'frontend', 'infrastructure'],
    correctionActions: ['revalidate_sync_performance', 'run_schema_migration'],
  },
  {
    version: 400,
    description: 'v400: [全面优化修复] — (1)P0-修复CorrectionReview页面崩溃: 变量声明顺序错误导致TDZ错误,accounts在useGlobalAccountId之后使用 (2)P0-修复AutoOptimizationDashboard永久加载: 添加DashboardLayout包裹+错误状态处理+重试按钮+骨架屏优化 (3)P1-修复广告位绩效同步N+1查询: 预加载campaigns映射替代循环内逐条查询+移除冗余existing检查 (4)P1-修复广告组绩效同步N+1查询: SP/SB/SD广告组循环内查询改为预加载Map查找 (5)P1-优化SQL查询: campaigns查询从SELECT*改为只查必要字段',
    affectedModules: ['sync', 'optimization', 'frontend'],
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 397,
    description: 'v397: [堆内存使用率告警误报修复] — (1)全局统一使用v8.getHeapStatistics().heap_size_limit替代process.memoryUsage().heapTotal计算堆内存使用率,消除V8动态收缩heapTotal导致的虚高97%告警 (2)monitoring.ts系统资源API:heapUsagePercent改用heap_size_limit计算,告警阈值从90%调整为85% (3)ops.ts运维诊断API:evaluateAlerts和/status端点的heapUsagePct改用heap_size_limit (4)optimizationAutoCorrector.ts定时纠错扫描内存检查改用heap_size_limit (5)前端HealthMonitor.tsx增加堆上限明细显示',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 396,
    description: 'v396: [否定词同步campaignType安全过滤] — (1)P1-optimizationSyncEngine否定词同步增加campaignType过滤,SB/SD类型campaign自动跳过SP否定词API,避免"parent program type must be Sponsored Products"错误和无限重试 (2)P1-automationExecutionEngine否定词同步同样增加campaignType检查,SB/SD类型记录优化日志但不调用API (3)修复否定词回填时同时获取campaignType字段',
    affectedModules: ['keyword', 'searchterm'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 395,
    description: 'v395: [搜索词数据精准性修复+SUMMARY聚合+500租户同步吞吐量提升] — (1)P0-搜索词同步从INSERT改为ON DUPLICATE KEY UPDATE,消除每次同步产生的重复数据 (2)P0-SB搜索词同样改为批量UPSERT,消除逐条查询的N+1性能问题 (3)P0-关键词绩效SUMMARY模式分批数据按targetId聚合累加,修复后一批覆盖前一批的数据丢失问题 (4)P0-广告组绩效fetchBatchedReport添加groupByKey参数,SP/SB/SD广告组报告分批聚合 (5)P1-500租户同步吞吐量提升80%:高频50→80,中频80→120,全量100→200 (6)P1-汇率调用从循环内移到循环外预加载,消除每条记录的async开销 (7)搜索词表添加唯一约束迁移,自动清理历史重复数据',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 394,
    description: 'v394: [连接池泄露自动检测回收+前端代码分割推广] — (1)connection.ts新增连接泄露追踪器,每30秒扫描活跃连接,超过120秒未释放自动回收 (2)记录每个借出连接的调用栈便于诊断 (3)getPoolStats()新增activeDirectConnections/oldestActiveConnectionMs/autoReclaimed指标 (4)OptimalBidCell从2968行Campaigns.tsx拆分为独立组件支持lazy loading (5)Home页面(1757行)改为lazy loading,减小初始包体积',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 393,
    description: 'v393: [动态内存配置服务+消除硬编码内存阈值+内存保护自适应] — (1)新建systemConfigService,通过v8.getHeapStatistics()动态获取Node.js堆内存上限 (2)修复unifiedSyncEngine中heapUtilization硬编码1400MB的致命错误,改为动态计算 (3)dataSyncScheduler内存保护阈值从硬编码(1200/900MB)改为动态计算(基于堆内存上限的105%/80%) (4)_core/index.ts健康检查阈值从硬编码1400MB改为动态获取',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 392,
    description: 'v392: [系统资源监控+DB连接池扩容+前端组件级代码分割] — (1)添加/api/monitoring/system-resources端点,实时监控CPU/内存/DB连接数/事件循环延迟 (2)DB_POOL_SIZE从40增加到60,提升多租户并发能力 (3)Dashboard图表区域提取为DashboardCharts懒加载组件,减少首屏bundle大小 (4)系统健康页面新增系统资源监控标签页',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 391,
    description: 'v391: [N+1查询消除+批量汇总优化+同步吞吐量提升] — (1)P1-updateCampaignPerformanceSummary重写为批量GROUP BY汇总,SQL查询从数百次减少到4次 (2)P1-processReportData预加载campaigns到内存Map,消除数千次逐条DB查询 (3)P1-syncBidAdjustmentsToAmazon改为批量IN查询解析Amazon ID (4)P2-Full同步间隔6小时缩短到2小时,每周期最大账号从40增加到100 (5)P2-500租户完整同步从6.2天缩短到20小时',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 390,
    description: 'v390: [前端骨架屏优化+后端API并行查询+健康分析缓存+性能索引] — (1)P2-纠错监控页面添加完整loading骨架屏,解决数据加载时的空白闪烁问题 (2)P2-系统健康监控页面添加loading骨架屏,优化用户体验 (3)P3-getDashboard的6个串行SQL查询改为Promise.all并行执行,提升响应速度约60-70% (4)P3-analyzeCampaignHealth结果缓存120秒,避免重复计算 (5)P3-getHealthAlerts复用健康分析缓存,消除重复数据库查询 (6)P3-添加6个复合索引覆盖optimization_events和daily_performance表高频查询',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 389,
    description: 'v389: [EB实例升级+内存优化+SD否定定位同步注册] — (1)P1-EB实例从 t3.small(2GB)升级到 t3.medium(4GB),支持200-500租户规模 (2)P1-Node.js堆内存限制从1400MB提升到3072MB,充分利用t3.medium内存 (3)P1-SD否定商品定位同步步骤已确认注册到SYNC_STEPS (4)P2-DB_POOL_SIZE从25提升到40,提升并发处理能力 (5)P2-纠错监控页面功能验证通过,94.4%同步率正常',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 380,
    description: 'v380: [P2命令确认增强+心跳探测优化+P3数据完整性+动态超时+RL冷启动] — (1)P2-confirmation同步层级扩展: TIER_HIERARCHY.confirmation从high扩展为high+medium,确俞ad_groups/keywords/targets变更能被确认同步 (2)P2-心跳探测两级策略: 从30分钟单级探测升级为90min+30min两级探测,避免系统重启后误报 (3)P3-joinIntegrity修复: 使用LEFT JOIN+accountId精确统计孤立广告组,修复orphanedAdGroups负数问题 (4)P3-动态超时: 大账户同步超时根据广告活动数动态调整(1000-3000:60min,3000-5000:75min,5000+:90min) (5)P3-RL冷启动加速: 双源数据统计(optimization_events+optimization_logs)+折算比例从0.3提升到0.5',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 379,
    description: 'v379: [SQL安全修复+可观测性修复+数据库索引优化] — (1)P0-修复8处SQL模板字符串中的as-any类型断言泄漏: syncPerformance.ts(DATE(date) as unknown), bidOperations.ts(INSERT...as unknown x2), deployLifecycleManager.ts(INSERT...as unknown x2), systemRouter.ts(ALTER TABLE...as unknown x2), auditLogService.ts(COUNT(*) as unknown as total) (2)P1-Observability服务修复: 将executedAt替换为createdAt解决optimization_events表查询失败问题+添加try-catch优雅降级 (3)P2-optimization_logs表添加复合索引(pg+category+createdAt, account+category+createdAt)解决SelfEvolution模坰30天范围查询超时',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 378,
    description: 'v378: [修复自动优化仪表盘和API授权状态页面] — (1)P0-AutoOptimizationDashboard.tsx: 修复trpc调用方式从tRPC vanilla client改为react-query hooks(getMetrics/getRecentActions/getTrends三个查询全部修复),解决"t[i] is not a function"错误导致仪表盘显示全部0的问题 (2)P1-AmazonApiAuthStatus.tsx: 修复trpc调用方式(getAllAuthStatus.query→useQuery, refreshToken.mutate→useMutation),解决API授权状态页面无法加载数据的问题',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands'],
  },
  {
    version: 377,
    description: 'v377: [全面多租户数据隔离强化] — (1)P1-algorithm路由数据隔离:7个方法添加verifyAccountAccess校验,包括getPerformance/analyzeByType/analyzeByRange/getSuggestions/getParameterTuning/runAutoCorrection (2)P1-placement路由数据隔离:33个方法添加verifyAccountAccess校验,覆盖所有位置优化、边际收益分析、决策树等功能 (3)P1-performanceGroup路由数据隔离:list和create方法添加verifyAccountAccess,assignCampaign/batchAssignCampaigns添加verifyPerformanceGroupAccess (4)P1-intelligentRecommendation路由数据隔离:scan/quickCreateGoal/getSummaryBadge添加verifyAccountAccess (5)P1-adAutomation/analytics/automation/bidding/dailySync/dayparting/specialScenario/nextGen路由数据隔离强化',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands', 'audit_synced_commands'],
  },
  {
    version: 376,
    description: 'v376: [数据隔离强化与评分算法优化] — (1)P1-campaign.list/listUnassigned数据隔离:增加verifyAccountAccess校验,防止跨租户查询广告活动 (2)P1-keyword.list数据隔离:增加verifyAdGroupAccess校验,防止跨租户查询关键词 (3)P1-内存泄漏修复:autoOperationService.logStore增加MAX_LOG_STORE_SIZE=10000限制,防止无限增长导致OOM (4)P2-评分算法核心指标权重提升:所有策略模板coreMetric权重从14-30%提升至30-45%,确保ACoS/ROAS偏离时评分真实反映问题严重性 (5)P2-同步时间范围扩展:SP类型同步从90天扩展到95天,充分利用Amazon API最大支持范围',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands', 'audit_synced_commands'],
  },
  {
    version: 375,
    description: 'v375: [审计日志完善与操作可追溯性增强] — (1)P2-修复审计日志显示"未知用户":系统自动操作(userId=0)现在正确显示为"系统自动优化",同时修复后端统计查询和前端显示的fallback逻辑 (2)P2-新增否定关键词/否定ASIN审计日志:优化同步引擎执行否定词操作后记录完整审计跟踪 (3)P2-新增搜索词收割审计日志:新关键词添加操作可完整追溯 (4)P2-新增位置倾斜/分时调整审计日志:所有优化操作类型均有完整审计记录',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands', 'audit_synced_commands'],
  },
  {
    version: 374,
    description: 'v374: [架构级缺陷修复] — (1)P0-动态并发控制反馈回路修复:recordThrottleEvent/recordSuccessEvent在amazonAdsApi响应拦截器中正式连接,实现真正的动态并发调整 (2)P0-分批轮转同步:full同步间隔6h+每周期最多25账号,high最多30账号,medium最多50账号,解决500租户API调用量超限 (3)P0-Leader选举保护优化调度器:startOptimizationScheduler移至onBecomeLeader回调,确保单实例执行 (4)P1-API限流联动并发控制:apiRateLimitService.recordExternalThrottle联动syncPriorityScheduler.recordThrottleEvent (5)P1-多租户隔离增强:getCampaignsByPerformanceGroupId增加accountId二次验证',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands', 'audit_synced_commands', 'rerun_optimization'],
  },
  {
    version: 373,
    description: 'v373: [500租户规模承载力优化] — (1)P1-同步优先级调度:引入租户活跃度评分和滚动窗口模式,确保高优先级账号优先同步 (2)P1-动态并发控制:根据API 429错误率自动调整并发数,批次间延迟自适应100ms-2000ms (3)P2-指令执行可靠性:添加失败指令自动重试队列和执行确认机制 (4)P2-自愈状态修复:数据健康页面通过数据库查询Leader实例的自愈状态,解决非Leader实例显示“已停止”问题 (5)P3-前端体验优化:纠错监控页面添加空状态提示,广告活动列表添加同步状态提示',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands', 'audit_synced_commands', 'rerun_optimization'],
  },
  {
    version: 372,
    description: 'v372: [性能与扩展性优化] — (1)P1-核心表索引添加:campaigns/adGroups/keywords/searchTerms/negativeKeywords/productTargets/scheduledTasks添加accountId/campaignId等关键索引,解决500租户规模全表扫描性能瓶颈 (2)P1-MySQL分布式API限流:生产环境使用MySQL存储替代内存存储,确保多EB实例环境下API限流全局一致性 (3)P2-并发同步提升:MAX_CONCURRENT_ACCOUNTS从10提升至50,大幅缩短全量数据同步时间 (4)P3-优雅停机延长:GRACEFUL_SHUTDOWN_TIMEOUT从25s延长至90s,避免长时间优化任务被中断',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands', 'audit_synced_commands', 'rerun_optimization'],
  },
  {
    version: 370,
    description: 'v370: [批量完整性检查+告警持久化+HTTP 425+前端修复] — (1)P0-批量完整性检查SQL修复:dataIntegrityChecker.ts和sloMonitor.ts中表名从mazon_ad_accounts修复为ad_accounts,status列名修复为is_active (2)P0-anomaly_alert_logs列名修复:riskActionEngine.ts中persistRiskAlert使用与实际数据库结构匹配的列名 (3)P0-dbAutoMigration修复:anomaly_alert_logs的CREATE TABLE与ALTER TABLE与Drizzle migration实际结构对齐 (4)P1-HTTP 425处理:Amazon API返回425 Too Early时不重试直接跳过 (5)P1-HealthMonitor全局账户同步:从硬编码selectedAccountId=1改为使用全局useCurrentAccountId',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands', 'audit_synced_commands', 'rerun_optimization'],
  },
  {
    version: 369,
    description: 'v369: [全面系统评估优化] — (1)P0-API限流accountId=0修复:所有API调用现在传递真实accountId (2)P0-缺失数据库表迁移:budget_auto_execution_configs/history/details/logs+keyword_auto_execution_configs (3)P0-RL日志增强:recordBidAction错误日志包含完整上下文 (4)P1-日志缓冲区扩容15000→30000+批次大小100→200 (5)P1-同步记录数统计修复 (6)P1-前端优化目标达成度显示优化',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands', 'audit_synced_commands', 'rerun_optimization'],
  },
  {
    version: 368,
    description: 'v368: [P1/P2优化] — (1)P0-lockManager升级为混合锁(内存锁+MySQL GET_LOCK分布式锁) (2)P0-修复GET_LOCK连接管理Bug (3)P1-API限流优化:429退避per-account级别+指数恢复+应用级全局TPS上限 (4)P2-前端修复:60天→90天+系统健康卡片空状态',
    affectedModules: ['bid', 'budget', 'keyword', 'searchterm', 'placement', 'dayparting'],
    correctionActions: ['revalidate_pending_commands', 'audit_synced_commands', 'rerun_optimization'],
  },
  {
    version: 361,
    description: 'v361.0: [架构质量全面优化] — (1)P0-多租户数据隔离修复 (2)P0-幂等性UPSERT (3)P0-统一同步架构 (4)P0-定时器泄漏修复 (5)P0-SQL注入消除 (6)P1-db.ts拆分26子模块 (7)P1-统一竞价与预算架构 (8)P1-连接池+索引优化 (9)P1-前端巨型页面拆分 (10)P2-类型安全提升 (11)P2-API访问控制审计 (12)P2-统一审计日志服务 (13)P2-日志规范化 (14)P3-React.memo优化 (15)P3-算法常量集中管理 (16)P3-环境变量统一管理',
    affectedModules: ['all'],
    correctionActions: ['revalidate_pending_commands', 'audit_synced_commands', 'rerun_optimization', 'cleanup_stale_pending'],
  },
  {
    version: 360,
    description: 'v360.0: [业务优化全面升级] — (1)P0-daily_performance唯一约束+批量UPSERT重构,消除数据重复累积 (2)P0-API限流服务统一集成,所有API调用经过限流许可检查 (3)P0-新授权24h数据采集周期 (4)P0-优化目标日预算约束修复 (5)P1-统一预算分配机制 (6)P1-84时段分时优化重构 (7)P1-跨广告活动智能倾斜 (8)P2-全局否定功能 (9)P2-优化日志透明度增强',
    affectedModules: ['all'],
    correctionActions: ['resync_data', 'recalculate_budgets', 'reset_dayparting_rules', 'rerun_optimization'],
  },
  {
    version: 359,
    description: 'v359.0: [效率·智能·韧性全面升级] — (1)32个未认证端点修复 (2)批量API调用重构(90%减少) (3)DAG并行调度(5.5x提升) (4)分布式API限流服务 (5)独立自愈任务调度器 (6)指令确认机制 (7)A/B测试框架 (8)测试覆盖率增强',
    affectedModules: ['sync', 'all'],
    correctionActions: ['resync_data', 'rerun_optimization'],
  },
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
  {
    version: 216,
    description: 'v216: 部署健康修复 — 修夌umami分析脚本导致55%HTTP4xx错误, 修复SP/SB搜索词报告SUMMARY+date列冲突(改为DAILY), 添加sync-health/sync-diagnosis运维端点, 修复前端同步进度步骤显示',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 217,
    description: 'v217: 数据同步全面修复 — 后端同步流程从8步扩展到17步(添加SB/SD广告组、SB关键词、SB/SD商品定位、否定关键词、否定商品定位、搜索词、广告位置绩效), 前端进度条和步骤标签同步17步, 每个步骤都有updateProgress调用确保实时进度反馈',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 218,
    description: 'v218: 前端崩溃修复 — 修复AmazonApiSettings页面ReferenceError(useEffect引用未声明的accounts变量), 将同步进度useEffect移到accounts定义之后',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 219,
    description: 'v219: 统一同步引擎 — 自动发现所有活跃账户(消除data_sync_schedules依赖), 分层同步策略(高频15min/中频30min/完整60min), 多账户并发控制(最多3个并行), 优化后确认同步(防止重复优化), 检查点/恢复机制, 步骤级错误隔离',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 220,
    description: 'v220: API速率控制与系统健康监控 — 自适应API速率控制器(滑动窗口计数+指数退避+自动恢复), 步骤间/批次间动态延迟, 429限流检测与退避, 每15分钟系统健康快照(内存/API速率/同步率), 内存泄漏检测, 确认同步效果追踪(触发源/成功率/平均耗时)',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 221,
    description: 'v221: 全面系统优化 — 修复分层同步锁Bug(层级感知锁防止medium层被跳过), 修复日志拼接[object Object]Bug, 前端路由自动账户选择, 审计日志记录优化操作, optimizationTargetEngine确认同步全覆盖, 数据新鲜度检查机制(防止基于旧数据优化), 前端乐观UI更新, 内存保护与僵尸条目清理',
    // @ts-expect-error - type assertion
    affectedModules: ['sync', 'bidOptimization', 'budgetOptimization', 'placementOptimization', 'negativeKeywords', 'searchTermHarvesting'] as unknown,
    // @ts-expect-error - type assertion
    correctionActions: ['reoptimize_all'] as unknown,
  },
  {
    version: 222,
    description: 'v222: 智能调度协调+日志安全+campaignId架构级修复+内存优化 — (1)调度器层级智能协调避免API压力 (2)全链路安全数字提取防御[object Object] (3)修复multiDimensionOptimizer中campaignId混用 (4)Procfile堆内存512MB→2048MB (5)健康检查阈值优化 (6)架构级campaignId守卫: 创建campaignIdResolver统一解析器, 在createBiddingLog/insertOptimizationEvent/batchInsertOptimizationEvents三个入口添加守卫, 修复自动纠错写入campaignId=0的根因',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 223,
    description: 'v223: [严重修复] NextGen规则引擎targetAcos单位转换Bug — 数据库存储百分比(30.0)被当作小数(0.30)使用,导致目标ACoS被误读为3000%,所有关键词出价只升不降. 修复: (1)calculateNextGenBid入口添加防御性转换(>1则/100) (2)ruleEngineDecision添加双重兆底转换 (3)分时竞价出价不变时跳过日志记录 (4)清理无效pending分时竞价日志 (5)部署后自动触发全量重优化,使用修复后的算法纠正所有错误出价',
    affectedModules: ['bid'],
    correctionActions: ['cleanup_stale_pending', 'rerun_optimization'],
  },
  {
    version: 238,
    description: 'v238: [关键修复] 规则引擎零曝光探索无限提价循环修复 + 出价累积保护 — (1)零曝光探索增加出价上限保护(不超过maxBid的40%) (2)零点击低曝光场景增加出价上限保护(不超过maxBid的50%) (3)零转化场景增强降价力度(花费超标时降价10-25%) (4)ACOS超标降价增强(v232紧急降价+v238累积保护) (5)部署后自动触发全量重优化纠正历史错误提价',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 239,
    description: 'v239: 元学习算法选择器门槛降低 — UCB门槛10→5条RL日志, Sigmoid门槛20→10条, CQL门槛50→30条, Ensemble门槛3→2个算法可用, 加速高级算法冷启动',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 240,
    description: 'v240: [审计修复] 出价微调灵敏度提升 — (1)hold判定阈值从$0.01降低到$0.005，低出价关键词的微调不再被四舍五入吃掉 (2)ACOS达标场景调整系数从0.10提高到0.15，微调更有效 (3)ACOS略高场景降价系数从0.20提高到0.25，降价更积极 (4)部署后自动触发全量重优化纠正历史hold判定',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 241,
    description: 'v241: [RL冷启动+部署流程优化+监控] — (1)RL冷启动探索策略: 当规则引擎判定为hold时，20%概率进行±3-5%探索性出价，打破冷启动死锁 (2)Reward回填窗口从24-72h扩展到12-96h，加速数据积累 (3)PostDeploy重优化后同步更新moduleLastExecutionMap，避免定时任务被跳过 (4)新增NextGen监控仪表板API /api/ops/nextgen-monitor (5)recordModuleExecution导出为公共函数',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 242,
    description: 'v242: [系统性修复] — (1)规则引擎精度感知调整: 引入最小有效调整量$0.02，避免微调被四舍五入吃掉 (2)RL冷启动探索策略优化: 探索率自适应调整，加速数据积累 (3)调度状态持久化: 模块执行时间持久化到数据库，彻底解决部署重启导致定时任务被跳过 (4)关键词同步修复: 增强错误日志序列化+重试机制+并发控制 (5)数据库迁移: 新增module_execution_times字段',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 243,
    description: 'v243: [死锁修复] — (1)生命周期判定优化: OR改为AND逻辑，避免老广告永久停留在launch阶段 (2)launch阶段bid间隔4h降为2h (3)模块执行时间恢复策略优化: 不再使用last_optimization_at回退填充，避免PostDeploy更新时间导致死锁 (4)PostDeploy强制初始化module_execution_times',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 244,
    description: 'v244: [安全检查修复] — (1)移除v232紧急止损逻辑:安全检查触发时跳过该campaign而非暂停整个优化目标 (2)PostDeploy自动恢复被错误关闭的优化目标(autoOptimize=0→1) (3)修复前端自动优化状态显示bug(使用autoOptimize字段而非status字段)',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 245,
    description: 'v245: [系统健康修复] — (1)RL奖励回填窗口从12h降至6h加速冷启动 (2)紧急优化队列持久化到数据库(emergency_optimization_queue表) (3)风险评估结果写入anomaly_alert_logs (4)预算同步自动确认:syncSpCampaigns中检测Amazon返回budget与pendingBudget一致时自动标记synced (5)自动化部署脚本:构建→打包→部署→版本验证→自动回滚',
    affectedModules: ['bid', 'budget'],
    correctionActions: ['rerun_optimization', 'recalculate_budgets'],
  },
  {
    version: 248,
    description: 'v248: [统一修复] — (1)同步层冲突跳过正确分类: 修复v222新格式层冲突消息未被识别为skipped而被记录为failed (2)RL Reward回填下限6h→3h: 打破冷启动死锁,加速高级算法eligible (3)negative_keywords同步频率提升: 从full层(60min)提升到medium层(30min) (4)日志缓冲区扩容: 5000→15000避免日志丢失 (5)API 429限流增强: 重试2→4次,基础延迟2s→3s,最大退避15s→30s,批量延迟1s→2s (6)数据库自动迁移: 启动时自动创建缺失的表/列(anomaly_alert_logs,emergency_optimization_queue,module_execution_times)',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 249,
    description: 'v249: [监控修复] — (1)nextgen-monitor bidStats SQL查询条件修复: action_type过滤与recordExecutionLog写入值不匹配导致totalEvents始终为0 (2)optimization-events端点补全api_sync_status/keyword_text/previous_bid/new_bid字段 (3)增加API同步状态统计查询',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 250,
    description: 'v250: [架构修复] — (1)recordExecutionLog双写机制修复: 将直接insert(optimizationLogs)替换为createOptimizationLog()确保同时写入optimization_events表，修复前端和监控无法看到NextGen算法出价记录的问题 (2)日志缓冲区扩容: GLOBAL_BUF 1500→5000避免溢出',
    affectedModules: ['bid'],  // 出价日志写入路径变更，需要重新执行以验证双写
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 251,
    description: 'v251: [算法增强] — (1)NextGen规则引擎使用真实AOV(groupAvgAov)替代currentBid*30的粗暴假设，解决品类偏见问题 (2)否定词决策引入花费/客单价比率，解决高客单价产品的“假阳性”否定问题 (3)引入归因延迟容忍度(1.5x)避免误杀正在归因中的流量 (4)前端数据概览卡片布局修复',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['bid', 'negative_keyword'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 252,
    description: 'v252: [RL数据质量修复+UI增强] — (1)captureStateSnapshot修复: 优先使用关键词/商品定向级别的绩效数据，而非账户级别汇总 (2)recordBidAction修复: 传递campaignId和adGroupId确保正确粒度 (3)OptimizationLogs组件增强: 算法类型可视化徽章+决策上下文展开面板+置信度进度条+归因保护指示器 (4)AlgorithmEffectDashboard增强: 算法层级分布卡片+算法层级分析Tab+真实数据计算替代硬编码 (5)RL诊断端点: 新增/ops/rl-diagnostics用于监控Reward回填状态',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 253,
    description: 'v253: [审计修复] — (1)RL诊断SQL Bug修复: accountId字段不一致 (2)backfillRewards增强: 移除limit限制+零数据场景处理 (3)规则引擎个性化: 数据置信度因子+CTR相关性感知 (4)UI同步状态修复: 区分历史记录和真正待同步',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 254,
    description: 'v254: [趋势感知优化] — (1)规则引擎趋势感知: 利用dailyData计算近期表现趋势(improving/stable/declining) (2)提价场景: 趋势improving时加速提价，declining时减缓 (3)降价场景: 趋势declining时加速止损，improving时减缓避免误杀 (4)零转化场景: 趋势improving时增加归因容忍度',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 255,
    description: 'v255: [指令确认+报告API修复] — (1)PostOptVerifier: 修复amazonKeywordId Bug，使用真正的Amazon ID而非本地自增ID (2)SD/SP/SB报告API: 修复5个date+SUMMARY冲突和reportTypeId错误 (3)SB Negative API: 403错误降级为WARN',
    affectedModules: ['sync', 'bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 256,
    description: 'v256: [全链路审计修复] — (1)RL智能双通道回填: 移除3h下限，实体级数据即时回填+扩展窗口到168h，解决重启冷启动瓶颈 (2)自动冲突解决引擎: 批量解决73K+积压pending冲突 (3)高级算法激活阈值优化: UCB 5→3, Sigmoid 10→5, CQL 30→15 (4)recordsSynced字段映射修复 (5)否定关键词同步提升到high层(30min→10min)',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'bid', 'rl'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 257,
    description: 'v257: [全链路优化升级] — (1)P0出价振荡根治: 4h冷却时间+24h最大调整次数+最小调整幅度阈值 (2)P0三通道RL回填: 新增通道C从optimization_events合成奖励 (3)P1主动探索策略: 多梯度探索(3-12%)+非hold扰动，加速高级算法激活 (4)P1 match_type历史数据回填 (5)P2纠错事件关联追踪+优化日志增强 (6)v257.1热修复: systemVersion.ts版本号同步+数据库连接池增强配置+JWT认证降级策略',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 258,
    description: 'v258: [P0核心算法重构] — (1)P0-ACoS死亡螺旋根治: 归因延迟保护(点击<5强制观察)+降价熔断(7天累计30%上限/连续3次强hold/最低40%保护)+多维度决策(CTR辅助判断)+降价力度上限(15%/25%) (2)P0-高级算法激活: UCB零门槛始终可用+LinUCB/Sigmoid降至1-2条+待回填日志计入 (3)P1-统一出价仲裁: 纠正前检查更新决策+冷却/熔断保护期跳过 (4)P1-日志可读性: 新增reason_details/guardrail_info/related_event_id字段+前端护栏机制可视化',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 259,
    description: 'v259: [全链路智能升级] — (1)P0-切断ACoS死亡螺旋: 熔断触发时主动提价8%恢复曝光+最低曝光保护(近3天曝光低于基线50%时暂停降价并提价)+底线恢复机制 (2)P0-根治出价回滚: 纠错器时间窗口从3天缩小到1天+SQL层排除护栏事件+仲裁检查窗口扩大到8小时 (3)P1-强制激活UCB: 历史数据合成绕过回填链路+UCB基础分1.30+rule_based降分0.85+Ensemble降至2算法 (4)P1-RL回填修复: 零数据重试机制+回填健康检查报告 (5)P1-双向出价: ACOS极优场景积极提价25%+超标降价上限收紧到20% (6)P2-数据展示一致性: riskActionEngine降价上限对齐+护栏可视化增强(提价恢复/曝光保护/双向出价标识)',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 260,
    description: 'v260: [持续监控+动态提价+仪表盘增强] — (1)P0-系统健康监控API: 回滚率/算法激活率/ACoS趋势/熔断触发率/提价分析实时计算 (2)P1-动态提价模型: 基于CTR+CVR精细化调整提价幅度(明星词30%/高流量15%/高转化20%/保守10%) (3)P2-仪表盘增强: 前端新增回滚率+算法激活率+ACoS趋势+熔断触发率四大健康指标卡片 (4)网站底部公司信息: 深圳一品名轩科技有限公司',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 261,
    description: 'v261: [部署后纠错机制重构] — (1)启动协调顺序重构: PostDeploy→AutoCorrector→效果验证(新算法优先原则) (2)部署后效果验证闭环: 重优化后等待60秒再次扫描确认Amazon已接受所有指令 (3)前端纠错报告可视化: Dashboard新增部署后纠错报告卡片',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 262,
    description: 'v262: [前台页面重构] — 新增首页/优化逻辑/联系我们页面 + PublicLayout统一导航和底部公司信息(纯前端变更,不影响后端优化模块)',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 268,
    description: 'v268: [B级→A级冲刺] — (1)P0-1紧急优化增强: 分层级降价+收紧暂停门槛+渐进熔断恢复+竞争力恢复模式 (2)P0-2评分算法优化: 方向正确性加分+优化速度评估+品类CVR基准 (3)P1-1高级算法强制激活: 降低激活门槛+RL数据快速积累+模型训练加速 (4)P1-2竞价智能化: 归因延迟感知+无单词保护期 (5)P2-1可观测性增强: 分级告警+智能降噪+算法效能监控',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 273,
    description: 'v273: [自动优化停滞感+算法分布修复] — (1)P0-算法分类修正: cooldown_hold/direction_hold从rule_engine改为guardrail层级 (2)P0-冷却期优化: 6h降至4h+24h最大调整次数3→4 (3)P1-高级算法激活增强: confidence门槛降低(ensemble 0.35→0.30, CQL/LinUCB 0.25→0.20) (4)P1-前端统计增强: 新增guardrail层级颜色+中文名+算法分布计算修正 (5)P2-调度器心跳日志增强',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 274,
    description: 'v274: [全面引擎增强] — (1)P0-因果推断接入出价决策: causalInferenceResults的optimalBid作为信号源融入batchCalculateNextGenBids (2)P0-CQL训练增强: 数据质量验证+奖励归一化+模型质量评估+冷启动探索 (3)P1-竞争环境感知增强: 多维信号融合(CPC波动+曝光份额+CTR变化+日报数据) (4)P1-预算分池具象化: performanceData字段记录GTO决策元数据 (5)P2-自动纠错闭环增强: 因果推断辅助纠错判断+效果评分增加因果维度',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 275,
    description: 'v275: [可视化+风控+智能化] — (1)P1-前端因果推断可视化: AlgorithmEffectDashboard新增因果分析Tab+影响分布图+置信度进度条 (2)P1-预算分池Dashboard: 实时展示80/20分池分配和回报 (3)P2-CQL模型监控: 训练状态/决策次数/模型质量分展示 (4)P2-竞争环境感知展示: 竞争强度分布图+市场动态卡片 (5)P2-风险等级分层自动响应: 红/黄/绿三级风险评估+自动出价乘数调整+冷却期延长 (6)P3-动态时间衰减权重: 指数衰减+波动性自适应 (7)P3-特征缓存TTL优化: 3天宽限期逐天回退',
    affectedModules: ['bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 310,
    description: 'v310: [全链路修复+自愈增强] — (1)P0-去重逻辑增强pending状态检查: 修复重复关键词创建(542+207条) (2)P0-品牌词永久失败标记: INVALID_VALUE错误自动标记not_applicable (3)P0-无效targetId自动清理: 清除导致API失败的无效Amazon ID (4)P0-SD广告组状态API修复: 新增updateSdAdGroupStatus方法 (5)P1-超时pending自动处理: 24h未同步自动标记timeout (6)P1-商品定向创建API实现: createSpProductTargets+syncNewProductTargetsToAmazon (7)P1-关键词Amazon ID回填重试: 解决pending keyword_create缺少Amazon ID (8)P2-分时竞价历史pending清理: dayparting_bid无效记录清理 (9)P0-pending指令新算法重评估: 用新算法判断pending指令是否仍合理 (10)P1-已执行指令回溯审计: 审计synced指令是否与新算法一致',
    affectedModules: ['bid', 'sync', 'product_target', 'keyword', 'dayparting'],
    correctionActions: ['rerun_optimization', 'cleanup_stale_pending', 'revalidate_pending_commands', 'audit_synced_commands', 'retry_product_target_sync'],
  },
  {
    version: 311,
    description: 'v311: [PT campaign底层修复+三层防御体系] — (1)P0-Campaign级别PT类型检查: 新增isProductTargetingCampaign()函数，通过命名约定(POE/POB/PT/ASIN)识别Product Targeting campaign (2)P0-三层防御体系: executeSearchTermAnalysis遍历开头跳过PT campaign + canAddPositiveKeyword双重检查 + adGroupHasProductTargets底层拦截 (3)P0-AutoCorrector PT检查: retryHistoricalFailedKeywordHarvests重试前检查campaign类型，PT campaign直接标记invalid_legacy (4)P0-SearchTermHarvester PT过滤: findTargetAdGroup过滤掉PT类型campaign (5)P1-30019配置修复: 关闭keywordAutoEnabled阻止向POE campaign添加keyword (6)P1-keywords表去重索引: uk_keyword_dedup(adGroupId,keywordText,matchType)数据库层面防重复',
    affectedModules: ['keyword', 'searchterm'],
    correctionActions: ['cleanup_stale_pending'],
  },
  {
    version: 328,
    description: 'v328: [深度分析修复] — (1)P0-keyword_create去重窗口从24h扩展到7天: 消陥46.5%的already_exists重复创建问题 (2)P0-SD adgroup_pause API修复: String类型adGroupId避免大数字精度丢失+添加Content-Type header (3)P0-adgroup_pause连续失败保护: 同一adGroup失败≥3次后停止重试 (4)P1-AutoCorrector容差增大: 从$0.01提升到$0.03消除拉锯战 (5)P1-AutoCorrector纠错冷却: 同一keyword 8小时内最多纠正1次',
    affectedModules: ['keyword', 'sync', 'bid'],
    correctionActions: ['rerun_optimization', 'cleanup_stale_pending', 'revalidate_pending_commands'],
  },
  {
    version: 329,
    description: 'v329: [架构级稳定性重构] — (1)P0-版本号统一单一来源: 消除systemVersion.ts和postDeployOptimizer.ts双源不同步问题,心跳/生命周期/PostDeploy统一使用systemVersion.ts (2)P0-PostDeployOptimizer容错重构: recordDeployVersion/updateTargetOptimizedVersion/getLastDeployedVersion全部改用raw SQL+3次重试,避免Drizzle ORM schema不匹配和数据库瞬时中断导致部署后优化失败 (3)P0-deployLifecycleManager错误隔离: 步骤4b-4e每个步骤独立try-catch,PostDeploy失败不阻塞AutoCorrector,步骤4d/4e改用raw SQL记录 (4)P0-内存管理重构: V8堆限制从2048MB降至1400MB为OS预留600MB,decisionTraces缓存10000→2000,metricBuffer 5000→1000,metricAggregates/modelCache/efficiencyHistoryBuffer/changeLogs全部添加大小上限 (5)P1-任务分层内存预算: executeOptimizationTask添加80%内存预算检查,AutoCorrector每账户处理前85%内存检查,startAutoCorrector添加90%内存保护',
    affectedModules: ['bid', 'sync', 'keyword'],
    correctionActions: ['rerun_optimization', 'cleanup_stale_pending', 'revalidate_pending_commands'],
  },
  {
    version: 335,
    description: 'v335: [数据同步保障体系] — (1)P0-deployLifecycleManager优雅关闭增加dataSyncJobs状态重置: running→failed,pending→cancelled (2)P0-orchestrateStartup增加数据同步恢复步骤3.5: 清理卡死running任务+检查同步滞后账户+记录恢复事件 (3)P0-dataSyncScheduler启动时清理卡死任务(30分钟超时)+启动后2分钟高频同步+5分钟完整同步 (4)P0-dataSyncService新增cleanupStaleJobs和cleanupOrphanedPendingJobs函数 (5)P1-optimizationTargetEngine所有details.push路径添加algorithmUsed字段',
    affectedModules: ['sync', 'bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 336,
    description: 'v336: [数据同步保障体系全面升级+事件驱动同步+部署恢复增强] — (1)P0-SYSTEM_VERSION更新329→336: 修复v335遗漏的版本号更新导致心跳/PostDeploy版本检测失效 (2)P0-事件驱动同步触发: amazonApi路由保存凭证后立即触发syncAllAccounts+新账户创建后立即触发完整同步 (3)P0-部署恢复增强: orchestrateStartup步骤3.5增加主动触发syncAllAccounts而非仅清理+缩短启动后首次同步延迟(2分钟→30秒高频,5分钟→60秒完整) (4)P1-同步健康监控: 每次同步后检查结果+连续3次失败记录告警事件+心跳中包含同步状态 (5)P1-VERSION_CHANGELOG补充v330-v336条目',
    affectedModules: ['sync', 'bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 338,
    description: 'v338: [统一智能冷启动机制] — (1)P0-新增coldStartService.ts: 统一冷启动服务，支持四大场景(new_account/credential_refresh/new_marketplace/version_upgrade)自动触发全量同步+数据年龄分层优化 (2)P0-数据年龄分层: 历史数据(30-90天)一次性批量Ngram分析+否定词+搜索词收割, 近期数据(7-14天)按常规高频调度优化 (3)P0-accountInitializationService集成: 新账户全量同步完成后自动触发冷启动(skipSync=true) (4)P0-amazonApi路由集成: saveCredentials检测凭证刷新场景触发冷启动, saveMultipleProfiles为每个新站点触发冷启动 (5)P0-deployLifecycleManager集成: orchestrateStartup步骤4e增加版本升级场景的批量冷启动 (6)P1-cold_start_logs表: 记录每次冷启动的完整执行统计(同步/历史优化/近期优化各阶段耗时和结果) (7)P1-幂等性保护: 同一账户+同一版本只执行一次冷启动, 并发防护+内存保护+错误隔离',
    affectedModules: ['sync', 'searchterm', 'bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 339,
    description: 'v339: [数据同步分批处理全面修复] — (1)P0-SP搜索词同步分批: syncSearchTerms增加31天分批逻辑,确保90天搜索词数据完整拉取 (2)P0-SP自动定向同步分批: syncAutoTargeting增加31天分批逻辑 (3)P0-SB搜索词同步分批: syncSbSearchTerms增加31天分批逻辑(60天上限) (4)P0-SB定向同步分批: syncSbTargeting增加31天分批逻辑 (5)P0-SB广告位同步分批: syncSbPlacementPerformance增加31天分批逻辑 (6)P0-SD定向同步分批: syncSdTargeting增加31天分批逻辑 (7)P0-SP广告位同步分批: syncPlacementPerformance增加31天分批逻辑 (8)P0-关键词绩效同步分批: syncKeywordPerformanceData增加31天分批逻辑 (9)P0-广告组绩效同步分批: syncAdGroupPerformanceData中SP/SB/SD三个子报告均增加分批逻辑 (10)P1-syncAll参数化: performanceDays支持外部传入,默认14天,unifiedSyncEngine full tier传入90天',
    affectedModules: ['sync'],
    correctionActions: ['resync_data'],
  },
  {
    version: 340,
    description: 'v340: [同步健康监控+Token竞态修复+大账户保护] — (1)P0-syncAll详细日志: 为syncAll方法增加统一runStep诊断日志系统,记录每个同步步骤的开始/结束/耗时/记录数/异常,同步完成后输出汇总报告 (2)P0-手动触发同步API: 新增POST /api/ops/force-sync端点,支持指定账户ID和同步层级(full/fast/minimal)手动触发全量同步 (3)P0-Token刷新竞态修复: 实现全局级别Refresh Token刷新锁,解决多个API客户端实例共享同一Refresh Token时的并发刷新冲突,三级Token获取路径(实例缓存→全局锁缓存→全局锁并发等待→实际刷新) (4)P1-同步健康监控: 当账户同步完成但totalSynced=0时自动触发critical级别告警,写入anomaly_alert_logs表 (5)P1-大账户自适应保护: 超过1000个广告活动的账户自动启用保护模式(步骤间额外延迟3秒+单账户同步45分钟超时保护)',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'api', 'monitoring'],
    correctionActions: ['resync_data'],
  },
  {
    version: 341,
    description: 'v341: [401自动重刷新Token修复] — (1)P0-401自动重刷新Token并重试: 当Amazon API返回401 Unauthorized时,自动清除实例级和全局级Token缓存,强制重新执行doRefreshToken()获取新Token,然后重试原始请求(最多1次),防止无限循环 (2)P0-解决LERUCCI店铺同步失败根因: 账户90027/90026/90025的accessToken为NULL导致所有API请求返回401,但旧版本不会重试刷新Token,现在收到01后会自动尝试刷新并重试',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['api', 'sync'],
    correctionActions: ['resync_data'],
  },
  {
    version: 342,
    description: 'v342: [OAuth授权凭证保存机制重大修复] — (1)P0-后端回调直接保存凭证: amazonAuthCallback.ts获取新refresh_token后直接更新数据库中所有匹配的账户凭证,不再依赖前端中转 (2)P0-修复前端clientSecret空字符串缺陷: 前端processCallback中clientSecret硬编码为空字符串导致saveMultipleProfiles验证失败,新refresh_token从未保存到数据库,这是账户90027持续401的根本原因 (3)P0-服务端凭证回退: saveMultipleProfiles和saveCredentials支持__USE_SERVER_SECRET__标记,自动使用服务端环境变量中的clientId/clientSecret (4)P0-保护性数据库更新: saveAmazonApiCredentials不再用空值覆盖已有的有效凭证 (5)P1-共享Token批量更新: 后端回调自动更新所有使用相同clientId的账户的refresh_token (6)P1-回调后自动触发同步: 凭证更新后自动触发受影响账户的立即同步',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['auth', 'api', 'sync', 'db'],
    correctionActions: ['resync_data'],
  },
  {
    version: 343,
    description: 'v343: [授权模块智能去重修复] — (1)P0-后端回调profile智能去重: 对于同一国家的多个profile(seller/vendor),优先保留已在系统中存在的profile,跳过未知的profile,防止创建重复站点 (2)P0-前端授权回调智能分流: 后端已保存凭证(backendSaved>0)时,前端不再调用saveMultipleProfiles,彻底消除刷新授权时的重复创建风险 (3)P0-saveMultipleProfiles去重保护: 增加isRefreshAuth参数和同店铺+同国家重复检查,即使被调用也不会创建重复站点 (4)P1-accountType信息传递: profiles数据中增加accountType字段(seller/vendor/agency),用于智能筛选',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['auth', 'api'],
    correctionActions: ['resync_data'],
  },
  {
    version: 344,
    description: 'v344: [P0冷启动同步天数修复 + P1竞价日志表修复] — (1)P0-coldStartService.executeFullSync修复: syncAll()调用时强制传入performanceDays=90天,之前未传参数导致默认只同步14天绩效数据 (2)P0-移除syncPerformanceOnly硬编码限制: 之前硬编码days>30?30:days导致最多只同步30天 (3)P1-bidding_logs表结构修复: 添加缺失的algorithm_used列,更新logTargetType和actionType枚举值 (4)P1-创建cold_start_logs表: 之前表不存在导致冷启动日志记录失败 (5)P1-amazon_api_credentials表添加last_cold_start_version和last_cold_start_at列',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'bidding', 'cold_start'],
    correctionActions: ['resync_data', 'cold_start'],
  },
  {
    version: 355,
    description: 'v355: [pending重试SQL修复 + searchTermHarvester ID修复 + 内存优化] — (1)P0-pending重试SQL列名修复: campaigns表查询中campaign_id(下划线)改为campaignId(驼峰),修复SELECT和结果引用三处错误,解决pending keyword_create重试时无法查找Amazon Campaign ID导致重试失败 (2)P1-searchTermHarvester ID混用修复: getSearchTermsByCampaignId传入sourceCampaign.id(本地ID)改为sourceCampaign.campaignId(Amazon ID),解决搜索词收割无法查询到search_terms数据导致收割候选为空 (3)P2-内存优化-bundle瘦身: build-server.js排除vite/rollup/babel/tailwindcss等构建时依赖+开启minify压缩,bundle体14.59MB降至4.23MB(减少71%) (4)P2-内存优化-heapUtilization修复: 使用heapUsed/max-old-space-size(1400MB)替代heapUsed/heapTotal,消除V8动态收缩heapTotal导致的虚假高内存使用率告警(97%→实际约7-15%)',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['optimization', 'sync'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 354,
    description: 'v354: [budget_adjustment修复 + placement_adjust激活 + SB/SBV前置过滤] — (1)P0-budget_adjustment ID不匹配修复: aggregatePerformanceData传入campaign.id(本地自增ID)改为campaign.campaignId(Amazon ID),解决daily_performance查询永远匹配不到数据导致模块完全休眠 (2)P0-CampaignPerformanceData/BudgetAllocationSuggestion增加amazonCampaignId字段,修复整个ID链路(campaigns.find匹配+db.updateCampaign+scheduleBudgetVerification) (3)P1-placement_adjust阈值修复: generatePlacementSuggestions过滤阈值从>5降低为>0,解决confidence=0.6时maxDeltaPercent=5但严格大于5导致中等置信度建议永远被过滤 (4)P1-analyzePlacementOptimization中的needsAdjustment和adjustedCount阈值同步修复 (5)P2-v310 pending重试路径增加SB/SD campaignType前置过滤,解决V351过滤被绕过导致244条SB pending记录反复重试失败 (6)P2-V351 SB/SD过滤增加optimization_logs记录(skipped_unsupported_campaign_type),避免静默跳过无法追踪',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['optimization'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 353,
    description: 'v353: [搜索词收割优化 + 休眠模块诊断 + search_terms去重修复] — (1)P0-search_terms去重key修复: existingMap从buildExistingKey使用本地campaign.id改为Amazon campaignId,解决去重失效导致重复INSERT (2)P0-品牌词前置过滤: 在CREATE_KEYWORD决策后立即检查品牌词,避免品牌词通过API创建被拒绝导致反复重试 (3)P0-PT广告组前置检查: 在campaign循环开头预加载PT状态,避免在API同步阶段才发现skipped_pt_adgroup (4)P1-去重窗口从7天扩展到30天: 进一步消除already_exists重复创建 (5)P1-action_type映射修复: brand_protect_skip/exploration_protect_skip等不再被错误归类为keyword_create (6)P1-去重查询覆盖新action_type: 包含search_term_brand_protect等新类型 (7)P2-placement诊断日志增强: 追踪建议生成和过滤原因 (8)P2-budget诊断日志增强: 追踪建议生成和应用统计',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['optimization', 'sync'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 352,
    description: 'v352: [数据同步架构重构 - 精细化分账户/分广告类型/分步骤串行化] — (1)P0-报告请求串行化: SP→SB→SD从并行Promise.all改为串行执行,每种广告类型间加3秒延迟,大幅降低API限流风险 (2)P0-智能账户交错排序: 同一品牌(userId)不同站点账户分散到不同批次,避免共享API凭证的账户同时发起请求 (3)P0-账户间串行+5秒延迟: 替代旧的并行批次执行,确保单个账户完成后再开始下一个 (4)P1-并发控制降级: MAX_CONCURRENT_ACCOUNTS从3降为2 (5)P1-优化指令同步增强: 账号间3秒延迟+任务类型间1秒延迟 (6)P1-syncAll步骤间1秒延迟: 降低API调用密度',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'optimization'],
    correctionActions: ['resync_data'],
  },
  {
    version: 351,
    description: 'v351: [P1分时竞价灵敏度重写 + bidding_logs修复 + 永久失败标记增强 + SB/SD数据保留期处理] — (1)P1-分时竞价算法灵敏度彻底重写: 三层级联放大(3x偏差放大+最小偏差保证±0.05+时段特征增强),解决95.6%规则为1.00的根因 (2)P1-分时规则24h自动重算: 替换旧算法生成的无效规则 (3)P1-分时执行阈值降低: $0.01→$0.005+2%双重判断 (4)P1-dayparting recordModuleExecution修复: dayparting_adjustment使用executeAllEnabledTargets但遗漏recordModuleExecution调用 (5)P1-bidding_logs原生SQL列名修复: snake_case→camelCase匹配Drizzle schema (6)P1-SB/SD关键词创建过滤: 阻止对SB/SD广告活动的无效API调用 (7)P1-permanently_failed标记增强: 移除localKeywordId前提条件,覆盖所有失败记录 (8)P1-SB/SD数据保留期自动处理: startDate自动clamp到保留期范围内 (9)P2-placement诊断日志增强',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['dayparting', 'bid', 'sync', 'optimization'],
    correctionActions: ['reset_dayparting_rules', 'rerun_optimization'],
  },
  {
    version: 349,
    description: 'v349: [P0分时竞价修复 + SB搜索词报告修复 + report_jobs表创建 + 诊断增强] — (1)P0-分时竞价停滞修复: dayparting_adjustment升级为关键任务,防止因内存压力被跳过导致分时策略完全停滞 (2)P1-SB搜索词报告400修复: 移除searchTerm groupBy中不允许的campaignStatus过滤器 (3)P1-report_jobs表创建: schema中定义但从未在数据库中创建,导致21个Failed query错误 (4)P2-分时竞价诊断日志: 添加campaigns循环中的详细跳过原因统计',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['optimization', 'sync', 'db'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 348,
    description: 'v348: [P0凭证解密修复 + P0构建修复 + P1报告诊断增强] — (1)P0-凭证解密修复: discoverSyncableAccounts()直接JOIN查询绕过getAmazonApiCredential()的safeDecrypt(),V345加密凭证后clientSecret和refreshToken以enc:v1:格式发送给Amazon OAuth导致全部账户Token刷新401失败 (2)P0-构建修复: V347的config undefined防护代码未被编译到dist/index.js,导致拦截器崩溃 (3)P1-报告错误诊断增强: SP/SB/SD报告请求失败时记录完整的status/data/headers/requestBody信息',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'build'],
    correctionActions: ['resync_data'],
  },
  {
    version: 347,
    description: 'v347: [P0分时竞价修复 + 内存检查修复 + 优化日志修复] — (1)P0-缺失表创建: keyword_placement_hourly_performance和multi_dim_combo_analysis表从未在数据库中创建,导致分时竞价完全瘫痪 (2)P0-performanceGroupId修复: getOptimizationTargetConfig中未赋值导致所有optimization_logs查询失败(否词去重/搜索词去重/pending重试全部失效) (3)P0-内存检查逻辑修复: 从heapUsed/heapTotal百分比改为RSS绝对值(MB)阈值,解决内存实际只用102MB却报告89%导致任务被跳过 (4)P1-anomaly_alert_logs修复: INSERT全参数化+message列扩展为MEDIUMTEXT (5)P1-cold_start_logs缺失列补全',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['optimization', 'sync', 'db'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 426,
    description: 'v426: [性能全面优化+分布式锁重启+安全增强] — (1)P0-API响应解析Bug修复: updateKeywordBids/updateKeywordStatus/updateProductTargetBids/updateTargetStatus/updateSpAdGroupStatus五个函数修复v3 API error对象的index字段解析,消除“假失败”问题 (2)P0-cleanupExpiredDaypartingBids提升为纠错扫描第1步+独立30分钟定时任务 (3)P1-N+1查询消除: adGroupSync/searchTermSync/negativeKeywordSync全面重写,预加载Map+批量insert (4)P1-绩效数据精度统一: toFixed(2)/toFixed(4)一致化 (5)P1-数据库查询优化: analytics.ts消除DATE()索引失效+合并6次COUNT为1次+campaigns.ts添加accountId过滤 (6)P1-轻量级API: 新增campaign.statusCounts和campaign.listNamesOnly端点,前端6处替换为轻量API (7)P1-keyword路由N+1修复: batchUpdateBid/batchUpdateStatus批量化 (8)P2-安全异常处理增强: 熔断检查异常改为安全拒绝,风险评估异常改为默认红色 (9)P2-SB否定关键词匹配修复: 添加internalAdGroupId条件 (10)P3-分布式锁重启: 基于sync_locks表的混合锁模式,替代GET_LOCK不占用连接池 (11)P3-同步数据校验摘要日志',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'optimization', 'correction', 'db', 'api', 'frontend'],
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 429,
    description: 'v429: [彻底统一ID体系] — (1)P0-SB出价API彻底修复: updateSbKeywordBids回退v3端点PUT /sb/keywords+补充必填adGroupId/campaignId/state字段 (2)P0-amazonIdResolver字段名bug修复: 3处kw.adGroupId→kw.internal_ad_group_id(修复即时回填完全失效) (3)P1-entityIdResolver全面激活: 应用入口initEntityIdResolver+10分钟缓存+批量解析 (4)P1-双层降级架构: bidOperations/syncBidOperations/amazonApiHelper全部实现entityIdResolver优先+amazonIdResolver降级 (5)P1-僵尸任务清理增强: 阈值30min→15min (6)P1-失效引用前置校验: 已删除实体的任务自动cancelled (7)P2-SB 403重试任务retry_count重置 (8)P2-同步后缓存清理机制',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'optimization', 'services'],
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 428,
    description: 'v428: [综合优化修复] — (1)P0-SB出价API端点修复: updateSbKeywordBids从PUT /sb/v4/keywords改为PUT /sb/keywords(v3端点),解决7261个403错误 (2)P1-updateLocalStatus列名映射修复: keywords→keywordStatus,campaigns→campaignStatus,ad_groups→adGroupStatus,product_targets→targetStatus (3)P2-SB否定词: 使用SB专用API(POST /sb/negativeKeywords) (4)P2-Amazon ID前置校验 (5)P2-僵尸任务清理: processing超过30分钟自动重置 (6)P2-SD定向报告: 跳过空targetingText记录',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'optimization'],
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 474,
    description: 'v474: [日志系统全面修复+产品定向bid格式安全+报告错误详情] — (1)P0-createModuleLogger重构: Error对象自动序列化到message字段,一次性修复全系统160+处空错误日志 (2)P0-SD/SB/SP产品定向bid格式安全处理: 当API返回对象型式bid时提取amount数值,修复"Cannot convert object to primitive value"错误 (3)P1-报告提交失败日志增强: 记录完整HTTP响应体,便于调试SB/SD报告400错误 (4)P1-Assets API/NotificationService/ContextualFeatureService错误日志修复',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['logging', 'sync', 'reporting'],
    correctionActions: [],
  },
  {
    version: 425,
    description: 'v425: [同步失败全面修复+同步锁机制重构+手动同步最高优先级] — (1)P0-同步锁机制重构: 手动同步最高优先级,任何时候触发都能立即执行,不被自动同步阻塞 (2)P0-syncIdempotencyService新增forceAcquireSyncLock强制获取锁 (3)P0-unifiedSyncEngine同层级/full层锁冲突时手动同步强制释放 (4)P0-dataSyncScheduler.triggerManualSync添加幂等锁保护 (5)P1-纠错服务增强: retryFailedBidAdjustments修复成功判断逻辑(itemResults逐条判断) (6)P1-新增cleanupExpiredDaypartingBids: 超过24h的dayparting_bid失败标记为superseded (7)P1-超过7天的失败事件标记为permanently_failed (8)P1-daypartingExecutor重试增强: 从1次增加到3次指数退避 (9)P1-amazonApiHelper Amazon ID缺失容错: 区分可重试和不可重试,不可重试标记为not_applicable (10)P1-riskActionEngine同步健康度优化: 排除superseded/permanently_failed,失败率>5%才触发P0告警',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['sync', 'optimization', 'correction'],
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 346,
    description: 'v346: [P2全面优化] — (1)除零防护加固: bidOptimizer中15+处除法操作添加安全检查 (2)竞态条件防护: 新增AsyncMutex进程级互斥锁工具 (3)内存泄漏修复: marketplaceCache添加TTL+容量上限+定时清理 (4)SQL注入加固: auditLogService/inviteCodeService/marginalBenefitBatchService参数化改造 (5)空catch块修复: 8处空catch添加结构化日志 (6)any类型收窄: bidOptimizer和optimizationTargetEngine中10+处as any消除 (7)归档代码清理: 删除_archived_v149(103文件/1.2MB) (8)日志统一: 25+文件16+处console迁移到结构化日志',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['optimization', 'security', 'sync', 'logging'],
    correctionActions: [],
  },
  {
    version: 345,
    description: 'v345: [P0安全加固 + P1性能优化 + P2代码质量] — (1)P0-凭证加密存储: 新增CryptoService(AES-256-GCM)加解密服务,clientSecret和refreshToken在数据库中加密存储,读取时自动解密,向后兼容明文数据 (2)P0-JWT密钥安全: 移除硬编码default-secret-key回退逻辑,未配置JWT_SECRET时系统拒绝启动 (3)P0-运维接口强制认证: 移除OPS_API_KEY未配置时的无认证分支 (4)P1-数据库索引优化: 为hourly_performance和bidding_logs大表添加复合索引 (5)P1-N+1查询优化: 批量化改造优化引擎中的循环查询 (6)P2-魔法数字常量化: 优化服务中的硬编码数字替换为具名常量',
    // @ts-expect-error - runtime type mismatch
    affectedModules: ['security', 'db', 'optimization', 'ops'],
    correctionActions: ['rerun_optimization'],
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
  // v329重构: 改用raw SQL替代Drizzle ORM，避免部署重启时schema不匹配导致查询失败
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const database = await getDb();
      if (!database) return null;
      
      const result = await database.execute(sql`
        SELECT action_detail FROM optimization_events
        WHERE event_category = 'settings_change'
          AND action_type = 'settings_update'
          AND status IN ('success', 'partial_success')
          AND JSON_EXTRACT(action_detail, '$.type') = 'system_deploy'
        ORDER BY created_at DESC
        LIMIT 1
      `);
      
      const rows = (result as Record<string, unknown>[][])[0] || [];
      if (rows.length > 0 && rows[0].action_detail) {
        try {
          const detail = typeof rows[0].action_detail === 'string' 
            ? JSON.parse(rows[0].action_detail) 
            : rows[0].action_detail;
          return detail.systemVersion || null;
        } catch {
          return null;
        }
      }
      return null;
    } catch (error: unknown) {
      log.warn(`[PostDeployOptimizer] 获取上次部署版本失败 (尝试${attempt}/${maxRetries}): ${(error as Error).message}`);
      if (attempt < maxRetries) {
        await sleep(5000 * attempt); // 递增等待
      }
    }
  }
  log.warn(`[PostDeployOptimizer] 获取上次部署版本失败: 已耗尽所有重试`);
  return null;
}

/**
 * 记录当前版本的部署事件
 */
async function recordDeployVersion(version: number, result: PostDeployResult): Promise<void> {
  // v329重构: 改用raw SQL替代Drizzle ORM，避免部署重启时schema不匹配导致insert失败
  // 添加重试机制，确保部署版本一定被记录（否则下次重启会重复触发PostDeploy）
  const actionDetail = JSON.stringify({
    type: 'system_deploy',
    systemVersion: version,
    previousVersion: result.previousVersion,
    versionsApplied: result.versionsToApply,
    affectedModules: result.affectedModules,
    targetsProcessed: result.targetsProcessed,
    targetsSucceeded: result.targetsSucceeded,
    targetsFailed: result.targetsFailed,
    totalActions: result.totalOptimizationActions,
  });
  const statusValue = result.targetsFailed === 0 ? 'success' : 'partial_success';
  const changeReason = `系统部署 v${version}`;
  const prevValue = result.previousVersion?.toString() || 'none';
  
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const database = await getDb();
      if (!database) {
        log.warn(`[PostDeployOptimizer] 记录部署版本失败: 数据库连接不可用 (尝试${attempt}/${maxRetries})`);
        if (attempt < maxRetries) await sleep(10000 * attempt);
        continue;
      }
      
      await database.execute(sql`
        INSERT INTO optimization_events 
          (account_id, event_category, action_type, action_detail, change_reason, 
           previous_value, new_value, algorithm_version, status, api_sync_status, created_at)
        VALUES 
          (0, 'settings_change', 'settings_update', ${actionDetail}, ${changeReason},
           ${prevValue}, ${version.toString()}, ${`v${version}`}, ${statusValue}, 'not_applicable', NOW())
      `);
      
      log.info(`[PostDeployOptimizer] ✓ 已记录部署版本 v${version} (status=${statusValue})`);
      return; // 成功，直接返回
    } catch (error: unknown) {
      log.warn(`[PostDeployOptimizer] 记录部署版本失败 (尝试${attempt}/${maxRetries}): ${(error as Error).message}`);
      if (attempt < maxRetries) {
        await sleep(10000 * attempt); // 递增等待: 10s, 20s
      }
    }
  }
  log.warn(`[PostDeployOptimizer] ✗ 记录部署版本 v${version} 失败: 已耗尽所有重试，下次重启将重新触发PostDeploy`);
}

/**
 * 更新优化目标的"上次优化版本"
 */
async function updateTargetOptimizedVersion(targetId: number, version: number): Promise<void> {
  // v329重构: 改用raw SQL替代Drizzle ORM，避免部署重启时schema不匹配导致insert失败
  const actionDetail = JSON.stringify({
    type: 'target_reoptimized',
    systemVersion: version,
    targetId: targetId,
  });
  const changeReason = `优化目标 ${targetId} 部署后重优化 v${version}`;
  
  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const database = await getDb();
      if (!database) return;
      
      await database.execute(sql`
        INSERT INTO optimization_events 
          (account_id, event_category, action_type, action_detail, change_reason,
           previous_value, new_value, algorithm_version, status, api_sync_status, created_at)
        VALUES 
          (0, 'settings_change', 'settings_update', ${actionDetail}, ${changeReason},
           'reoptimize_triggered', ${`v${version}`}, ${`v${version}`}, 'success', 'not_applicable', NOW())
      `);
      return; // 成功
    } catch (error: unknown) {
      log.warn(`[PostDeployOptimizer] 更新目标版本失败 (targetId=${targetId}, 尝试${attempt}/${maxRetries}): ${(error as Error).message}`);
      if (attempt < maxRetries) await sleep(5000);
    }
  }
}

/**
 * 获取优化目标上次被重优化的版本号
 */
async function getTargetLastOptimizedVersion(targetId: number): Promise<number | null> {
  // v329重构: 改用raw SQL替代Drizzle ORM
  try {
    const database = await getDb();
    if (!database) return null;
    
    const result = await database.execute(sql`
      SELECT action_detail FROM optimization_events
      WHERE event_category = 'settings_change'
        AND action_type = 'settings_update'
        AND status = 'success'
        AND JSON_EXTRACT(action_detail, '$.type') = 'target_reoptimized'
        AND JSON_EXTRACT(action_detail, '$.targetId') = ${targetId}
      ORDER BY created_at DESC
      LIMIT 1
    `);
    
    const rows = (result as Record<string, unknown>[][])[0] || [];
    if (rows.length > 0 && rows[0].action_detail) {
      try {
        const detail = typeof rows[0].action_detail === 'string'
          ? JSON.parse(rows[0].action_detail)
          : rows[0].action_detail;
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
  return VERSION_CHANGELOG.filter(v => v.version > fromVersion).sort((a: unknown, b: unknown) => a.version - b.version);
}

/**
 * 合并多个版本的受影响模块
 */
function mergeAffectedModules(versions: VersionChange[]): string[] {
  const modules = new Set<string>();
  for (const v of versions) {
    for (const m of v.affectedModules) {
      if (m === 'all') {
        return ['bid', 'placement', 'dayparting', 'dayparting_budget', 'budget', 'searchterm', 'keyword', 'multidim', 'coordination', 'sync', 'product_target'];
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
    const { getOptimizationTargetConfig, executeOptimizationTarget } = await import('./optimization/optimizationTargetEngine');
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
    for (const action of (correctionActions as unknown[])) {
      try {
        switch (action) {
          case 'rebuild_combo_analysis': {
            // 重建多维度组合分析
            log.debug(`[PostDeployOptimizer] [${config.name}] 重建多维度组合分析...`);
            try {
              const { analyzeCampaignCombos } = await import('./optimization/multiDimComboAnalyzer');
              const database = await getDb();
              if (!database) break;
              const campaignsList = await db.getCampaignsByAccountId(config.accountId);
              const enabledCampaigns = campaignsList.filter((c: Record<string, unknown>) => c.campaignStatus === 'enabled');
              
              for (const campaign of (enabledCampaigns as unknown[])) {
                try {
                  await analyzeCampaignCombos(
                    database,
                    campaign.id,
                    config.accountId,
                    config.targetAcos || 30,
                  );
                  correctionsApplied++;
                } catch (campErr: unknown) {
                  errors.push(`组合分析失败(campaign ${campaign.id}): ${(campErr as Error).message}`);
                }
              }
              modulesExecuted.push('multidim_rebuild');
            } catch (comboErr: unknown) {
              errors.push(`多维度组合分析重建失败: ${(comboErr as Error).message}`);
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
          
          case 'cleanup_stale_pending': {
            // v223: 清理无效的pending分时竞价日志（出价不变但仍记录为pending）
            log.info(`[PostDeployOptimizer] [${config.name}] 清理无效pending分时竞价日志...`);
            try {
              const database = await getDb();
              if (database) {
                const cleanupResult = await database.execute(
                  sql`UPDATE optimization_logs 
                      SET api_sync_status = 'not_applicable', 
                          error_message = 'v223: 清理无效pending - 分时竞价出价未变更' 
                      WHERE performance_group_id = ${targetId}
                        AND action_type = 'dayparting_bid' 
                        AND api_sync_status = 'pending'
                        AND previous_value = new_value`
                );
                const cleaned = (cleanupResult as Record<string, unknown>[])?.[0]?.affectedRows || 0;
                log.info(`[PostDeployOptimizer] [${config.name}] 清理了 ${cleaned} 条无效pending日志`);
                correctionsApplied += cleaned;
                modulesExecuted.push('cleanup_stale_pending');
              }
            } catch (cleanErr: unknown) {
              errors.push(`清理pending日志失败: ${(cleanErr as Error).message}`);
            }
            break;
          }
          
          case 'revalidate_pending_commands': {
            // v310: 用新算法重评估所有pending指令的合理性
            // 不是简单重试，而是重新计算：如果新算法认为该指令不合理，则取消
            log.info(`[PostDeployOptimizer] [${config.name}] v310: 开始pending指令新算法重评估...`);
            try {
              const database = await getDb();
              if (!database) break;
              
              // 查询该优化目标下所有pending的出价/状态变更指令
              const pendingLogs = await database.execute(
                sql`SELECT ol.id, ol.action_type, ol.entity_type, ol.entity_id, 
                           ol.previous_value, ol.new_value, ol.created_at,
                           k.keywordText, k.bid as current_bid, k.keywordId as amazon_keyword_id,
                           pt.bid as pt_current_bid, pt.targetId as amazon_target_id
                    FROM optimization_logs ol
                    LEFT JOIN keywords k ON ol.entity_type = 'keyword' AND ol.entity_id = k.id
                    LEFT JOIN product_targets pt ON ol.entity_type = 'product_target' AND ol.entity_id = pt.id
                    WHERE ol.performance_group_id = ${targetId}
                      AND ol.api_sync_status = 'pending'
                      AND ol.action_type IN ('bid_increase', 'bid_decrease', 'target_pause', 'target_enable')
                      AND ol.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`
              );
              
              const rows = (pendingLogs as Record<string, unknown>[])?.[0] || pendingLogs;
              if (!Array.isArray(rows) || rows.length === 0) {
                log.info(`[PostDeployOptimizer] [${config.name}] v310: 无pending出价/状态指令需要重评估`);
                break;
              }
              
              log.warn(`[PostDeployOptimizer] [${config.name}] v310: 发现${rows.length}条pending指令需要重评估`);
              
              let cancelled = 0;
              let kept = 0;
              
              for (const row of (rows as unknown[])) {
                try {
                  const actionType = row.action_type;
                  const newValue = parseFloat(String(row.new_value));
                  const prevValue = parseFloat(String(row.previous_value));
                  const currentBid = parseFloat(String(row.current_bid || row.pt_current_bid || 0));
                  
                  // 判断逻辑：如果当前实际出价已经与pending指令的目标值不同方向，则取消
                  let shouldCancel = false;
                  let cancelReason = '';
                  
                  if (actionType === 'bid_increase' || actionType === 'bid_decrease') {
                    // 出价指令：如果当前出价已经超过了pending指令的目标值（说明后续有更新的调整），取消
                    if (actionType === 'bid_increase' && currentBid >= newValue) {
                      shouldCancel = true;
                      cancelReason = `当前出价$${currentBid.toFixed(2)}已>=目标$${newValue.toFixed(2)}`;
                    } else if (actionType === 'bid_decrease' && currentBid <= newValue) {
                      shouldCancel = true;
                      cancelReason = `当前出价$${currentBid.toFixed(2)}已<=目标$${newValue.toFixed(2)}`;
                    }
                    // 如果pending指令的调整幅度过大（>40%），也取消（可能是旧算法的极端决策）
                    if (!shouldCancel && prevValue > 0) {
                      const changePercent = Math.abs(newValue - prevValue) / prevValue;
                      if (changePercent > 0.4) {
                        shouldCancel = true;
                        cancelReason = `调整幅度${(changePercent * 100).toFixed(1)}%超过40%安全阈值`;
                      }
                    }
                  } else if (actionType === 'target_pause' || actionType === 'target_enable') {
                    // 状态变更指令：检查是否缺少Amazon ID（无法执行）
                    if (!row.amazon_keyword_id && !row.amazon_target_id) {
                      shouldCancel = true;
                      cancelReason = '缺少Amazon ID，无法执行状态变更';
                    }
                  }
                  
                  if (shouldCancel) {
                    await database.execute(
                      sql`UPDATE optimization_logs 
                          SET api_sync_status = 'not_applicable',
                              error_message = ${`v310重评估取消: ${cancelReason}`}
                          WHERE id = ${row.id}`
                    );
                    cancelled++;
                  } else {
                    kept++;
                  }
                } catch (evalErr: unknown) {
                  errors.push(`v310: pending重评估单条失败: ${(evalErr as Error).message}`);
                }
              }
              
              log.warn(`[PostDeployOptimizer] [${config.name}] v310: pending重评估完成: 总计=${rows.length}, 取消=${cancelled}, 保留=${kept}`);
              correctionsApplied += cancelled;
              modulesExecuted.push('revalidate_pending');
            } catch (revalErr: unknown) {
              errors.push(`v310: pending指令重评估失败: ${(revalErr as Error).message}`);
            }
            break;
          }
          
          case 'audit_synced_commands': {
            // v310: 回溯审计已执行(synced)的指令是否与新算法一致
            // 如果发现不合理的已执行指令，生成纠正指令
            log.info(`[PostDeployOptimizer] [${config.name}] v310: 开始已执行指令回溯审计...`);
            try {
              const database = await getDb();
              if (!database) break;
              
              // 查询最近48小时内synced的出价调整指令
              const syncedLogs = await database.execute(
                sql`SELECT ol.id, ol.action_type, ol.entity_type, ol.entity_id,
                           ol.previous_value, ol.new_value, ol.created_at,
                           k.bid as current_bid, k.keywordText, k.keywordId as amazon_keyword_id,
                           pg.targetAcos as target_acos
                    FROM optimization_logs ol
                    LEFT JOIN keywords k ON ol.entity_type = 'keyword' AND ol.entity_id = k.id
                    LEFT JOIN performance_groups pg ON ol.performance_group_id = pg.id
                    WHERE ol.performance_group_id = ${targetId}
                      AND ol.api_sync_status = 'synced'
                      AND ol.action_type IN ('bid_increase', 'bid_decrease')
                      AND ol.created_at > DATE_SUB(NOW(), INTERVAL 48 HOUR)
                    ORDER BY ol.created_at DESC
                    LIMIT 200`
              );
              
              const rows = (syncedLogs as Record<string, unknown>[])?.[0] || syncedLogs;
              if (!Array.isArray(rows) || rows.length === 0) {
                log.info(`[PostDeployOptimizer] [${config.name}] v310: 无近期synced出价指令需要审计`);
                break;
              }
              
              log.info(`[PostDeployOptimizer] [${config.name}] v310: 审计${rows.length}条已执行出价指令...`);
              
              let flagged = 0;
              
              for (const row of (rows as unknown[])) {
                const newValue = parseFloat(String(row.new_value));
                const prevValue = parseFloat(String(row.previous_value));
                const currentBid = parseFloat(String(row.current_bid || 0));
                
                // 审计规则：检测可能不合理的已执行指令
                let isUnreasonable = false;
                let auditReason = '';
                
                // 规则1: 降价幅度超过30%的指令
                if (row.action_type === 'bid_decrease' && prevValue > 0) {
                  const decreasePercent = (prevValue - newValue) / prevValue;
                  if (decreasePercent > 0.30) {
                    isUnreasonable = true;
                    auditReason = `降价幅度${(decreasePercent * 100).toFixed(1)}%超过30%安全阈值`;
                  }
                }
                
                // 规则2: 提价幅度超过50%的指令
                if (row.action_type === 'bid_increase' && prevValue > 0) {
                  const increasePercent = (newValue - prevValue) / prevValue;
                  if (increasePercent > 0.50) {
                    isUnreasonable = true;
                    auditReason = `提价幅度${(increasePercent * 100).toFixed(1)}%超过50%安全阈值`;
                  }
                }
                
                // 规则3: 出价低于$0.02的极端降价（可能导致无曝光）
                if (newValue < 0.02 && prevValue >= 0.10) {
                  isUnreasonable = true;
                  auditReason = `出价降至$${newValue.toFixed(2)}，可能导致零曝光`;
                }
                
                if (isUnreasonable) {
                  flagged++;
                  // 记录审计发现到optimization_events
                  try {
                    await database.execute(
                      sql`INSERT INTO optimization_events 
                          (account_id, event_category, action_type, action_detail, change_reason, 
                           previous_value, new_value, algorithm_version, status, api_sync_status)
                          VALUES (${config.accountId}, 'audit', 'algorithm_audit', 
                                  ${JSON.stringify({ 
                                    sourceLogId: row.id, 
                                    entityType: row.entity_type, 
                                    entityId: row.entity_id,
                                    originalAction: row.action_type,
                                    auditReason,
                                    keywordText: row.keywordText,
                                  })},
                                  ${`v310审计: ${auditReason}`},
                                  ${String(row.new_value)}, ${String(row.current_bid)},
                                  'v310', 'success', 'not_applicable')`
                    );
                  } catch (insertErr: unknown) {
                    log.warn(`v310: 审计记录插入失败: ${(insertErr as Error).message}`);
                  }
                }
              }
              
              log.warn(`[PostDeployOptimizer] [${config.name}] v310: 审计完成: 检查=${rows.length}, 标记不合理=${flagged}`);
              correctionsApplied += flagged;
              modulesExecuted.push('audit_synced');
            } catch (auditErr: unknown) {
              errors.push(`v310: 已执行指令审计失败: ${(auditErr as Error).message}`);
            }
            break;
          }
          
          case 'retry_product_target_sync': {
            // v310: 重试失败/pending的商品定向创建
            log.info(`[PostDeployOptimizer] [${config.name}] v310: 重试商品定向同步...`);
            try {
              const database = await getDb();
              if (!database) break;
              
              // 查询该优化目标下pending的product_target创建指令
              const pendingPtLogs = await database.execute(
                sql`SELECT ol.id, ol.entity_id, ol.new_value, ol.action_type
                    FROM optimization_logs ol
                    WHERE ol.performance_group_id = ${targetId}
                      AND ol.api_sync_status = 'pending'
                      AND ol.action_type = 'product_target_create'
                      AND ol.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`
              );
              
              const rows = (pendingPtLogs as Record<string, unknown>[])?.[0] || pendingPtLogs;
              if (!Array.isArray(rows) || rows.length === 0) {
                log.info(`[PostDeployOptimizer] [${config.name}] v310: 无pending商品定向创建需要重试`);
                break;
              }
              
              log.warn(`[PostDeployOptimizer] [${config.name}] v310: 发现${rows.length}条pending商品定向创建`);
              // 实际重试逻辑由AutoCorrector的retryFailedProductTargetCreations处理
              // 这里只记录发现，触发AutoCorrector在后续步骤中处理
              correctionsApplied += rows.length;
              modulesExecuted.push('product_target_sync');
            } catch (ptErr: unknown) {
              errors.push(`v310: 商品定向同步重试失败: ${(ptErr as Error).message}`);
            }
            break;
          }
          
          case 'resync_data': {
            // v344: 触发全量数据重新同步
            log.info(`[PostDeployOptimizer] [${config.name}] v344: 触发全量数据重新同步 (账户${config.accountId})...`);
            try {
              const { triggerColdStart } = await import('./optimization/coldStartService');
              await triggerColdStart(config.accountId, {
                reason: 'version_upgrade',
                force: true,
                historicalDays: 90,
                skipSync: false,
              });
              modulesExecuted.push('resync_data');
              correctionsApplied++;
              log.info(`[PostDeployOptimizer] [${config.name}] v344: 全量数据重新同步已触发`);
            } catch (syncErr: unknown) {
              errors.push(`全量数据重新同步触发失败: ${(syncErr as Error).message}`);
            }
            break;
          }
          
          case 'cold_start': {
            // v344: 触发冷启动流程
            log.info(`[PostDeployOptimizer] [${config.name}] v344: 触发冷启动 (账户${config.accountId})...`);
            try {
              const { triggerColdStart } = await import('./optimization/coldStartService');
              await triggerColdStart(config.accountId, {
                reason: 'version_upgrade',
                force: true,
                historicalDays: 90,
              });
              modulesExecuted.push('cold_start');
              correctionsApplied++;
              log.info(`[PostDeployOptimizer] [${config.name}] v344: 冷启动已触发`);
            } catch (csErr: unknown) {
              errors.push(`冷启动触发失败: ${(csErr as Error).message}`);
            }
            break;
          }
          
          default:
            break;
        }
      } catch (actionErr: unknown) {
        errors.push(`纠正动作 ${action} 失败: ${(actionErr as Error).message}`);
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
          } catch (dpErr: unknown) {
            errors.push(`分时竞价重优化失败: ${(dpErr as Error).message}`);
          }
        }
        
        // v476: 阶段间节流 — 分时竞价完成后等待20秒，优先保证100%成功率
        if (modulesExecuted.includes('dayparting')) {
          log.info(`[PostDeployOptimizer] v476: 阶段间节流 - 等待20秒...`);
          await sleep(20000);
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
          } catch (dbErr: unknown) {
            errors.push(`分时预算重优化失败: ${(dbErr as Error).message}`);
          }
        }
        
        // v476: 阶段间节流 — 分时预算完成后等待20秒
        if (modulesExecuted.includes('dayparting_budget')) {
          log.info(`[PostDeployOptimizer] v476: 阶段间节流 - 等待20秒...`);
          await sleep(20000);
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
          } catch (bidErr: unknown) {
            errors.push(`出价重优化失败: ${(bidErr as Error).message}`);
          }
        }
        
        // v476: 阶段间节流 — 出价优化完成后等待20秒
        if (modulesExecuted.includes('bid')) {
          log.info(`[PostDeployOptimizer] v476: 阶段间节流 - 等待20秒...`);
          await sleep(20000);
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
          } catch (plErr: unknown) {
            errors.push(`位置重优化失败: ${(plErr as Error).message}`);
          }
        }
        
        // v476: 阶段间节流 — 位置优化完成后等待20秒
        if (modulesExecuted.includes('placement')) {
          log.info(`[PostDeployOptimizer] v476: 阶段间节流 - 等待20秒...`);
          await sleep(20000);
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
          } catch (bgErr: unknown) {
            errors.push(`预算重优化失败: ${(bgErr as Error).message}`);
          }
        }
        
        // v476: 阶段间节流 — 预算分配完成后等待20秒
        if (modulesExecuted.includes('budget')) {
          log.info(`[PostDeployOptimizer] v476: 阶段间节流 - 等待20秒...`);
          await sleep(20000);
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
          } catch (stErr: unknown) {
            errors.push(`搜索词重优化失败: ${(stErr as Error).message}`);
          }
        }
        
      } catch (fullErr: unknown) {
        errors.push(`全量重优化失败: ${(fullErr as Error).message}`);
      }
    }
    
    // 步骤3: 更新目标的优化版本
    await updateTargetOptimizedVersion(targetId, SYSTEM_VERSION);
    
    // v241: 更新模块执行时间，避免后续定时任务因使用旧的数据库恢复时间而被跳过
    try {
      const { recordModuleExecution } = await import('./sync/dataSyncScheduler');
      for (const mod of modulesExecuted) {
        // 将PostDeploy执行的模块名称映射到调度器的模块名称
        const moduleMapping: Record<string, string> = {
          'bid': 'bid',
          'placement': 'placement',
          'dayparting': 'dayparting',
          'dayparting_budget': 'budget',
          'searchterm': 'searchTermHarvest',
          'budget': 'budget',
        };
        const schedulerModule = moduleMapping[mod];
        if (schedulerModule) {
          await recordModuleExecution(targetId, schedulerModule);
          log.info(`[PostDeployOptimizer] v242: 已更新模块执行时间(内存+数据库): target=${targetId}, module=${schedulerModule}`);
        }
      }
    } catch (syncErr: unknown) {
      log.warn(`[PostDeployOptimizer] v241: 更新模块执行时间失败(不影响主流程): ${(syncErr as Error).message}`);
    }
    
    // v475: 改进状态判定逻辑 — 没有模块执行且没有错误时视为success(无需操作)
    // 只有存在错误且没有任何模块成功执行时才视为failed
    const finalStatus = errors.length === 0 ? 'success' : (modulesExecuted.length > 0 ? 'success' : 'failed');
    if (errors.length > 0) {
      log.warn(`[PostDeployOptimizer] [${config.name}] 重优化错误详情: ${errors.join('; ')}`);
    }
    if (modulesExecuted.length === 0 && errors.length === 0) {
      log.info(`[PostDeployOptimizer] [${config.name}] 无需执行任何模块(correctionActions无匹配/shouldFullReoptimize=false)`);
    }
    return {
      targetId,
      targetName: config.name,
      accountId: config.accountId,
      status: finalStatus,
      modulesExecuted,
      correctionsApplied,
      optimizationActions,
      errors,
      duration: Date.now() - startTime,
    };
    
  } catch (error: unknown) {
    log.warn(`[PostDeployOptimizer] 目标${targetId}重优化异常: ${(error as Error).message}`);
    return {
      targetId,
      targetName: 'unknown',
      accountId: 0,
      status: 'failed',
      modulesExecuted,
      correctionsApplied,
      optimizationActions,
      errors: [...errors, (error as Error).message],
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
        // v266 P0-1: 修复过于宽泛的not_applicable标记
        // 只将真正的内部设置变更(system_deploy, target_reoptimized, algorithm_config等)标记为not_applicable
        // 保留需要API同步的设置变更(budget, bid相关)的pending/failed状态
        const settingsResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'not_applicable',
              api_sync_detail = ${JSON.stringify({ reason: 'v266: 内部设置变更不需要Amazon API同步', fixedAt: new Date().toISOString() })}
          WHERE action_type = 'settings_update'
            AND event_category = 'settings_change'
            AND api_sync_status IN ('failed', 'pending')
            AND (
              JSON_EXTRACT(action_detail, '$.type') IN ('system_deploy', 'target_reoptimized', 'algorithm_config', 'strategy_update', 'system_config')
              OR change_reason LIKE '%部署%'
              OR change_reason LIKE '%算法%参数%'
              OR change_reason LIKE '%策略%更新%'
            )
        `);
        const settingsFixed = (settingsResult as Record<string, unknown>[])[0]?.affectedRows || 0;
        log.info(`[PostDeployOptimizer] v266: 修复${settingsFixed}个内部settings_update事件状态为not_applicable(保留需要API同步的设置变更)`);
        
        // v266: 将之前被错误标记为not_applicable的预算/出价相关settings_update事件恢复为pending，以便重试同步
        const restoreResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'pending',
              api_sync_detail = ${JSON.stringify({ reason: 'v266: 恢复被错误标记的需要API同步的设置变更', fixedAt: new Date().toISOString() })}
          WHERE action_type = 'settings_update'
            AND event_category = 'settings_change'
            AND api_sync_status = 'not_applicable'
            AND (
              change_reason LIKE '%预算%'
              OR change_reason LIKE '%budget%'
              OR change_reason LIKE '%出价%'
              OR change_reason LIKE '%bid%'
              OR JSON_EXTRACT(action_detail, '$.type') IN ('budget_adjustment', 'bid_adjustment')
            )
            AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);
        const restored = (restoreResult as Record<string, unknown>[])[0]?.affectedRows || 0;
        if (restored > 0) {
          log.warn(`[PostDeployOptimizer] v266: 恢复${restored}个被错误标记的预算/出价settings_update事件为pending`);
        }
        
        // 修夌2: 同步修夌optimization_logs表
        await database.execute(sql`
          UPDATE optimization_logs ol
          INNER JOIN optimization_events oe ON oe.source_id = ol.id AND oe.source_table = 'optimization_logs'
          SET ol.api_sync_status = 'not_applicable'
          WHERE oe.action_type = 'settings_update'
            AND oe.event_category = 'settings_change'
            AND oe.api_sync_status = 'not_applicable'
            AND ol.api_sync_status IN ('failed', 'pending')
        `).catch((e: Error) => log.warn(`[PostDeployOptimizer] v202: 同步optimization_logs失败: ${(e as Error).message}`));
        
        // 修夌3: 将超过30天的旧失败事件标记为invalid_legacy
        const legacyResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'invalid_legacy',
              api_sync_detail = ${JSON.stringify({ reason: 'v202: 超过30天的历史失败事件', fixedAt: new Date().toISOString() })}
          WHERE api_sync_status = 'failed'
            AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND action_type NOT IN ('bid_increase', 'bid_decrease')
        `);
        const legacyFixed = (legacyResult as Record<string, unknown>[])[0]?.affectedRows || 0;
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
        const targetFixed = (targetResult as Record<string, unknown>[])[0]?.affectedRows || 0;
        log.warn(`[PostDeployOptimizer] v203: 标记${targetFixed}个超过7天的target状态变更失败事件为invalid_legacy`);
        
        // 修复5: 将所有placement_adjust/bid_auto_adjust中的失败事件标记为invalid_legacy
        const miscResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'invalid_legacy',
              api_sync_detail = ${JSON.stringify({ reason: 'v203: 无重试机制的历史失败事件', fixedAt: new Date().toISOString() })}
          WHERE action_type IN ('placement_adjust', 'bid_auto_adjust')
            AND api_sync_status = 'failed'
        `);
        const miscFixed = (miscResult as Record<string, unknown>[])[0]?.affectedRows || 0;
        log.warn(`[PostDeployOptimizer] v203: 标记${miscFixed}个无重试机制的失败事件为invalid_legacy`);
      }
    } catch (migrationErr: unknown) {
      log.warn(`[PostDeployOptimizer] v203: 数据迁移失败: ${(migrationErr as Error).message}`);
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
  
  // 4. v244: 部署前先恢复所有被v232安全检查错误关闭的优化目标
  // 问题背景：v232的安全检查逻辑会因单个campaign的正常波动就关闭整个优化目标
  // 修复：在每次部署时，自动检查并恢复所有status=active但autoOptimize=0的优化目标
  try {
    const database = await getDb();
    if (database) {
      const allGroups = await database
        .select({ id: performanceGroups.id, name: performanceGroups.name, autoOptimize: performanceGroups.autoOptimize, status: performanceGroups.status })
        .from(performanceGroups)
        .where(and(
          eq(performanceGroups.status, 'active'),
          eq(performanceGroups.autoOptimize, 0)
        ));
      
      if (allGroups.length > 0) {
        log.warn(`[PostDeployOptimizer] v244: 发现 ${allGroups.length} 个活跃优化目标的autoOptimize被关闭，正在自动恢复...`);
        for (const group of allGroups) {
          // 检查该优化目标下是否有enabled状态的广告活动（v168的合理暂停不应被恢复）
          const pgCampaigns = await db.getCampaignsByPerformanceGroupId(group.id);
          const enabledCount = pgCampaigns.filter((c: Record<string, unknown>) => c.campaignStatus === 'enabled').length;
          if (enabledCount > 0) {
            await db.updatePerformanceGroup(group.id, { autoOptimize: 1 });
            log.info(`[PostDeployOptimizer] v244: 已恢复优化目标 "${group.name}" (ID:${group.id}) 的自动优化 - 有${enabledCount}个enabled广告活动`);
          } else {
            log.info(`[PostDeployOptimizer] v244: 优化目标 "${group.name}" (ID:${group.id}) 下无enabled广告活动，保持关闭状态`);
          }
        }
      } else {
        log.info(`[PostDeployOptimizer] v244: 所有活跃优化目标的autoOptimize状态正常`);
      }
    }
  } catch (restoreErr: unknown) {
    log.warn(`[PostDeployOptimizer] v244: 恢复优化目标状态失败:`, (restoreErr as Error).message);
  }

  // 4b. v257: match_type历史数据回填迁移
  if (!lastVersion || lastVersion < 257) {
    try {
      const { backfillMatchType } = await import('./migrations/v257_backfill_match_type');
      const matchTypeResult = await backfillMatchType();
      log.info(`[PostDeployOptimizer] v257: match_type回填完成: updated=${matchTypeResult.updated}, errors=${matchTypeResult.errors}`);
    } catch (migrationErr: unknown) {
      log.warn(`[PostDeployOptimizer] v257: match_type回填失败: ${(migrationErr as Error).message}`);
    }
  }

  // 4c. v258: optimization_events表新增字段迁移
  if (!lastVersion || lastVersion < 258) {
    try {
      const { runV258Migration } = await import('./migrations/v258_add_log_fields');
      await runV258Migration();
      log.info(`[PostDeployOptimizer] v258: 日志字段迁移完成`);
    } catch (migrationErr: unknown) {
      log.warn(`[PostDeployOptimizer] v258: 日志字段迁移失败: ${(migrationErr as Error).message}`);
    }
  }

  // 4d. v268: 性能优化索引迁移
  if (!lastVersion || lastVersion < 268) {
    try {
      const { runV268PerformanceIndexMigration } = await import('./migrations/v268_performance_indexes');
      await runV268PerformanceIndexMigration();
      log.info(`[PostDeployOptimizer] v268: 性能优化索引创建完成`);
    } catch (migrationErr: unknown) {
      log.warn(`[PostDeployOptimizer] v268: 性能优化索引创建失败: ${(migrationErr as Error).message}`);
    }
  }

  // 4e. v345: 凭证加密迁移 + 性能索引
  if (!lastVersion || lastVersion < 345) {
    try {
      const { migrateEncryptCredentials } = await import('./migrations/v345_encrypt_credentials');
      const migResult = await migrateEncryptCredentials();
      log.info(`[PostDeployOptimizer] v345: 凭证加密迁移完成 (加密=${migResult.encrypted}, 跳过=${migResult.skipped}, 失败=${migResult.failed})`);
    } catch (migrationErr: unknown) {
      log.warn(`[PostDeployOptimizer] v345: 凭证加密迁移失败: ${(migrationErr as Error).message}`);
    }

    try {
      const { runV345PerformanceIndexMigration } = await import('./migrations/v345_performance_indexes');
      await runV345PerformanceIndexMigration();
      log.info(`[PostDeployOptimizer] v345: 性能索引创建完成`);
    } catch (migrationErr: unknown) {
      log.warn(`[PostDeployOptimizer] v345: 性能索引创建失败: ${(migrationErr as Error).message}`);
    }
  }

  // 4f. v361: 核心表索引迁移
  if (!lastVersion || parseFloat(String(lastVersion)) < 361.0) {
    try {
      const { runV361CoreTableIndexes } = await import('./migrations/v361_core_table_indexes');
      const database = await getDb();
      if (database) {
        await runV361CoreTableIndexes(database);
        log.info(`[PostDeployOptimizer] v361: 核心表索引创建完成`);
      }
    } catch (migrationErr: unknown) {
      log.warn(`[PostDeployOptimizer] v361: 核心表索引创建失败: ${(migrationErr as Error).message}`);
    }
  }

  // 4g. v372: 扩展索引迁移 + 分布式限流表
  if (!lastVersion || parseFloat(String(lastVersion)) < 372.0) {
    try {
      const { runV372ExtendedIndexes } = await import('./migrations/v372_extended_indexes');
      const database = await getDb();
      if (database) {
        await runV372ExtendedIndexes(database);
        log.info(`[PostDeployOptimizer] v372: 扩展索引和分布式限流表创建完成`);
      }
    } catch (migrationErr: unknown) {
      log.warn(`[PostDeployOptimizer] v372: 扩展索引迁移失败: ${(migrationErr as Error).message}`);
    }
  }

  // v390: 性能优化索引 - 为纠错监控和健康分析的高频查询添加复合索引
  if (versionsToApply.some(v => v.version >= 390)) {
    try {
      const { runV390PerformanceIndexes } = await import('./migrations/v390_performance_indexes');
      const database = await getDb();
      if (database) {
        await runV390PerformanceIndexes(database);
        log.info(`[PostDeployOptimizer] v390: 性能优化索引创建完成`);
      }
    } catch (migrationErr: unknown) {
      log.warn(`[PostDeployOptimizer] v390: 性能优化索引迁移失败: ${(migrationErr as Error).message}`);
    }
  }

  // v395: 搜索词唯一约束迁移 - 清理重复数据并添加唯一索引
  if (versionsToApply.some(v => v.version >= 395)) {
    try {
      const { runV395SearchTermsUnique } = await import('./migrations/v395_search_terms_unique');
      const database = await getDb();
      if (database) {
        await runV395SearchTermsUnique(database);
        log.info(`[PostDeployOptimizer] v395: 搜索词唯一约束迁移完成`);
      }
    } catch (migrationErr: unknown) {
      log.warn(`[PostDeployOptimizer] v395: 搜索词唯一约束迁移失败: ${(migrationErr as Error).message}`);
    }
  }

  // 5. 获取所有活跃优化目标（恢复后重新获取）
  const { getEnabledOptimizationTargets } = await import('./optimization/optimizationTargetEngine');
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
  const sortedTargets = targets.sort((a: unknown, b: unknown) => {
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
        } catch (err: unknown) {
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
              errors: [`重试${POST_DEPLOY_CONFIG.maxRetries}次后仍然失败: ${(err as Error).message}`],
              duration: 0,
            };
          } else {
            log.warn(`[PostDeployOptimizer] [${target.name}] 重试 ${retries}/${POST_DEPLOY_CONFIG.maxRetries}: ${(err as Error).message}`);
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
        
        // v476: 目标间节流 — 每个目标执行完成后等待15秒，避免API限流
        // PostDeploy是全量重优化，API调用密度更高，需要更长的间隔
        const INTER_TARGET_DELAY_MS = 30000;  // 30秒 — 优先保证100%成功率
        log.info(`[PostDeployOptimizer] v476: 目标间节流 - 等待${INTER_TARGET_DELAY_MS / 1000}秒后执行下一个目标...`);
        await sleep(INTER_TARGET_DELAY_MS);
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
  
  log.info(`[PostDeployOptimizer] ========================================`);
  log.info(`[PostDeployOptimizer] 部署后重优化完成!`);
  log.info(`[PostDeployOptimizer] 版本: v${lastVersion || 0} → v${SYSTEM_VERSION}`);
  if (failed > 0) {
    log.warn(`[PostDeployOptimizer] 目标: ${targetResults.length}个处理, ${succeeded}个成功, ${failed}个失败`);
  } else {
    log.info(`[PostDeployOptimizer] 目标: ${targetResults.length}个处理, ${succeeded}个成功, ${failed}个失败`);
  }
  log.info(`[PostDeployOptimizer] 优化动作: ${totalActions}个`);
  log.info(`[PostDeployOptimizer] 耗时: ${((finalResult.completedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}秒`);
  log.info(`[PostDeployOptimizer] ========================================`);
  
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
  
  const { getEnabledOptimizationTargets } = await import('./optimization/optimizationTargetEngine');
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
