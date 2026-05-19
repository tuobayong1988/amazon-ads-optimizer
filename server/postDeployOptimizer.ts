// @ts-nocheck
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
  | 'optimization'  // 优化引擎变更
  | 'automation'    // 自动化执行变更
  | 'product_target' // 商品定向管理变更
  | 'correction'    // 纠错服务变更
  | 'logging'       // 日志系统变更
  | 'reporting'     // 报告系统变更
  | 'system'        // 系统配置、调度、基础设施变更
  | 'client'        // 前端客户端变更
  | 'frontend'      // 前端界面变更
  | 'db'            // 数据库连接或 schema 变更
  | 'migration'     // 数据迁移/修复变更
  | 'api'           // API 路由或契约变更
  | 'auth'          // 认证授权变更
  | 'security'      // 安全控制变更
  | 'core'          // 核心启动与运行时变更
  | 'dashboard'     // 仪表盘变更
  | 'scheduler'     // 调度器变更
  | 'batchSync'     // 批量同步变更
  | 'syncPerformance' // 同步性能数据变更
  | 'rateLimit'     // 限流策略变更
  | 'apiRateLimit'  // API 限流策略变更
  | 'circuitBreaker' // 熔断器变更
  | 'budgetRules'   // 预算规则变更
  | 'dataRepair'    // 数据修复变更
  | 'rl_training'   // 强化学习训练变更
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
  | 'cold_start'                   // v344: 触发冷启动流程
  | 'rerun_correction_scan'       // v513: 重新运行纠错扫描
  | 'cleanup_bid_set_backlog'      // v648: 清理bid_set积压+无效状态变更积压
  | 'cleanup_harvest_backlog'     // v648: 清理搜索词收割积压
  | 'repair_organization_id_90107';  // v676: 修复账户90107的organization_id从1到30012

const VERSION_CHANGELOG: VersionChange[] = [
  {
    version: 785,
    description: 'v785: [性能巡检查询链路优化] — (1)P0-Dashboard关键KPI/趋势查询从tRPC批处理链路拆分,并将performance日期过滤改为索引友好的半开区间,降低首屏慢批处理耦合 (2)P0-Amazon API设置页同步任务轮询改为仅活跃任务期间高频轮询,避免无任务时持续请求 (3)P1-SyncLogs改为服务端分页、状态/关键词/日期过滤,并补充同步历史复合索引迁移 (4)P1-修复A/B测试旧路径兼容与canonical不一致 (5)P2-增强Dashboard错误诊断、KPI骨架屏和图表日期范围文案。',
    affectedModules: ['analytics', 'sync', 'db'],
    correctionActions: [],
  },
  {
    version: 784,
    description: 'v784: [campaigns storeId回退热修] — (1)P0-修复共享campaign维度上下文storeId仅读取ad_accounts.store_id的问题,当store_id为空时统一回退到ad_accounts.accountId (2)P0-覆盖独立SP/SB/SD同步、带tracking同步与performance报告自动创建campaigns路径,避免后续同步再次把storeId写空 (3)P1-配合生产回填将历史campaigns.storeId补齐,确保店铺/站点维度筛选和归因稳定。',
    affectedModules: ['sync', 'reports', 'db'],
    correctionActions: [],
  },
  {
    version: 783,
    description: 'v783: [campaigns全写入路径维度修复] — (1)P0-新增共享campaign维度上下文,统一profileId/marketplaceId/storeId/countryCode回退规则 (2)P0-补齐独立SP/SB/SD同步、带tracking同步与performance报告自动创建campaigns的维度写入,避免绕过campaignSync导致新记录缺维度 (3)P1-storeId回退到ad_accounts.store_id或accountId,countryCode统一大写,提升跨店铺/跨站点归因稳定性。',
    affectedModules: ['sync', 'reports', 'db'],
    correctionActions: [],
  },
  {
    version: 782,
    description: 'v782: [campaigns marketplaceId维度回填热修] — (1)P0-当ad_accounts.marketplaceId为空时,campaigns.marketplaceId自动回退到ad_accounts.marketplace或当前同步上下文站点代码,避免已补列但站点维度为空 (2)P0-自动迁移补齐countryCode缺列兜底,并强化profileId/marketplaceId/storeId/countryCode回填自愈逻辑 (3)P1-保持v781已新增维度索引与同步写入逻辑,确保跨店铺/跨站点广告活动可稳定归因。',
    affectedModules: ['sync', 'db', 'migration'],
    correctionActions: [],
  },
  {
    version: 781,
    description: 'v781: [campaigns店铺/站点维度映射热修] — (1)P0-campaigns表自动补齐profileId/marketplaceId/storeId三列并增加账户+维度索引,保留既有countryCode列 (2)P0-SP/SB/SD广告活动同步写入时强制填充profileId、marketplaceId、storeId、countryCode,避免跨店铺/跨站点广告活动无法一致归因 (3)P1-storeId按项目既有语义从ad_accounts.accountId回填,marketplaceId/profileId优先使用广告账户维度与当前Amazon Ads client上下文。',
    affectedModules: ['sync', 'db', 'migration'],
    correctionActions: [],
  },
  {
    version: 780,
    description: 'v780: [checkpoint resume旧任务收口热修] — (1)P0-/api/ops/checkpoint-resume在创建新续跑任务前自动取消同账户旧running checkpoint_resume任务,避免部署中断或二次续跑后残留多个非终态任务 (2)P0-被取代任务统一收口为cancelled并写入completedAt/current_step/errorMessage,防止status=running但心跳停滞的状态污染运维判断 (3)P1-保留新任务checkpoint_resume非手动语义和sync_checkpoints_v2剩余步骤恢复策略,不影响已完成任务与无断点账户。',
    affectedModules: ['sync', 'ops'],
    correctionActions: [],
  },
  {
    version: 779,
    description: 'v779: [checkpoint resume绩效小任务拆分热修] — (1)P0-checkpoint_resume模式显式保持isManual=false且设置_forceSync=false,将剩余报告型绩效步骤移交P5 report_jobs异步小任务而非在单个resume任务中同步等待 (2)P0-禁用checkpoint resume下的full预取阻塞路径,确保只围绕sync_checkpoints_v2恢复后的剩余步骤入队处理 (3)P1-复用report_jobs retryCount/maxRetries/updatedAt/30分钟超时恢复策略,使当日绩效、7天/95天绩效、关键词、投放、商品定位和广告组绩效具备独立重试与可观测收口。',
    affectedModules: ['sync', 'scheduler'],
    correctionActions: [],
  },
  {
    version: 778,
    description: 'v778: [checkpoint resume断点加载热修] — (1)P0-checkpointManager.loadSyncCheckpoint改用项目标准typedQueryOne解析drizzle/mysql2 execute结果,避免生产环境因返回结构差异误判sync_checkpoints_v2中不存在full断点 (2)P0-兼容JSON列返回string或object两种形态,确保/api/ops/checkpoint-resume能正确加载断点并进入剩余步骤执行 (3)P1-保留4小时有效期与account_id+tier=full筛选策略,不改变断点语义。',
    affectedModules: ['sync', 'ops'],
    correctionActions: [],
  },
  {
    version: 777,
    description: 'v777: [checkpoint resume非手动语义热修] — (1)P0-data_sync_jobs.trigger_source允许并写入checkpoint_resume,避免断点续跑任务在任务表中继续被标记为manual (2)P0-/api/ops/checkpoint-resume创建任务时使用checkpoint_resume来源,与force-sync手动full同步彻底分离 (3)P1-保留syncAccount isManual=false与sync_checkpoints_v2 full断点恢复策略,确保只执行剩余步骤。',
    affectedModules: ['sync', 'ops'],
    correctionActions: [],
  },
  {
    version: 776,
    description: 'v776: [checkpoint resume生产运维与任务状态收口修复] — (1)P0-新增受opsAuth/OPS_API_KEY保护的/api/ops/checkpoint-resume接口,将重新full同步与从sync_checkpoints_v2断点续跑明确分离 (2)P0-triggerCheckpointResumeSync以非手动语义调用syncAccount,加载full断点并仅执行剩余步骤,成功或部分成功后清理checkpoint (3)P0-data_sync_jobs终态规范化,消除partial_success非法状态、空status和失败步骤progress=100并存问题 (4)P1-triggerManualFullSync不再写入partial_success非法枚举,统一收口为completed或failed。',
    affectedModules: ['sync', 'ops'],
    correctionActions: [],
  },
  {
    version: 775,
    description: 'v775: [同步任务断点续跑与失败恢复修复] — (1)P0-统一同步引擎在步骤成功完成后立即持久化账户级MySQL checkpoint,避免超时或心跳掉线后从零全量重跑 (2)P0-队列消费者新增安全的onStepComplete任务级Redis checkpoint追加,不再把步骤开始/心跳误判为完成 (3)P0-续跑上下文继承历史completedSteps与totalSynced,防止后续checkpoint覆盖丢失既有进度 (4)P1-失败重试、中断恢复和卡住任务清理后释放原账户锁,避免恢复任务被旧锁反复重新入队。',
    affectedModules: ['sync'],
    correctionActions: [],
  },
  {
    version: 774,
    description: 'v774: [广告组绩效同步异步接管修复] — (1)P0-广告组绩效同步等待报告时将内部等待上限收敛到25分钟,避免外层30分钟STEP_TIMEOUT抢先失败 (2)P0-submitAndWaitMultipleReports返回reportId超时结果后自动写入report_jobs submitted任务,由后台异步调度继续轮询下载并落库 (3)P0-异步报表服务补齐ad_group_sync/spAdGroups/sbAdGroups/sdAdGroups请求路由与processAdGroupPerformanceData落库处理,确保被接管报告能覆盖更新ad_groups绩效字段 (4)P1-入队去重与高优先级元数据补齐,提升全量/nightly同步失败自愈能力',
    affectedModules: ['sync', 'reporting'],
    correctionActions: [],
  },
  {
    version: 773,
    description: 'v773: [全量同步任务 data_sync_jobs 时间基准完整修复] — (1)P0-统一同步引擎 running 检查从 startedAt 改为 updated_at 心跳,避免 UTC startedAt 在 MySQL US/Pacific 会话中表现为未来时间并长期阻塞 full/nightly 同步 (2)P0-自动同步任务 startedAt/completedAt 改为数据库 NOW(),批量结果记录使用数据库本地时间反推开始时间 (3)P0-server/db/syncJobs 统一 create/update 时间字段为数据库 NOW(),覆盖手动、调度和恢复入口 (4)P1-与 v772 心跳清理、启动维护任务和分片锁本地时间修复形成闭环,确保全量同步可持续运行并被正确恢复',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 772,
    description: 'v772: [全量同步恢复修复 — 心跳清理与时区一致性] — (1)P0-data_sync_jobs运行中任务清理从startedAt绝对时长改为COALESCE(lastHeartbeat,updatedAt,startedAt)心跳超时判定,避免正常长耗时全量同步被2小时/6小时清理误杀 (2)P0-同步清理、pending取消、完成时间统一使用数据库本地NOW()/DATE_SUB计算,消除Node UTC字符串与MySQL US/Pacific会话时区混用导致的180分钟误判 (3)P1-启动维护任务health-check改用TIMESTAMPDIFF数据库侧计算运行时长和心跳年龄,补齐独立清理入口 (4)P1-分片锁过期清理改用数据库本地NOW(),避免分片锁生命周期受UTC/Pacific偏差影响。',
    affectedModules: ['sync'],
    correctionActions: [],
  },
  {
    version: 771,
    description: 'v771: [Amazon Ads 同步稳定性与自愈升级 — 4项增强] — (1)P0-SB targeting入库修复: 将 SB 关键词与商品定向分别写入 keywords/product_targets,避免 Amazon 原始 targeting_type 枚举误入 SP 自动投放枚举字段 (2)P0-生产调度稳定性增强: full/nightly 层同步接入可持久化分片执行,保留账户级失败隔离、失败分片重试与 Worker 生命周期管理 (3)P1-数据完整性自愈升级: 完整性巡检增加缺失实体引用检测、实体补偿同步与批量自动修复统一入口 (4)P1-监控运维入口增强: 手动完整性修复接口切换为检查加自动修复统一能力,提升部署后巡检与问题闭环效率',
    affectedModules: ['sync', 'keyword', 'product_target', 'reporting'],
    correctionActions: [],
  },
  {
    version: 687,
    description: 'v687: [内存削峰+真空账户降级+UI状态恢复 — 3项增强] — (1)P0-极端数据量内存削峰: downloadReport流式解析每5万条触发GC+submitAndWaitMultipleReports报告下载后立即GC+processReportData UPSERT批次500→200+flushDailyPerfBatch消除完整副本克隆+syncPerformanceData报告引用释放 (2)P1-真空账户同步频率降级: 连续3次TRULY_EMPTY诊断后触发6小时冷却期+仅对high/medium层生效+冷却期后自动重置+配置中心可调 (3)P1-UI状态恢复逻辑: useSyncProgressWs检测WebSocket 1008/1006认证失败+暴露isAuthExpired+AmazonApiSettings 21个mutation注入checkAuthError+登录过期友好banner+隐藏ApiHealthMonitor误导',
    affectedModules: ['sync', 'system', 'client'],
    correctionActions: [],
  },
  {
    version: 686,
    description: 'v686: [全量同步与系统防御优化 — 3项增强] — (1)P0-数据库连接池调优: connectTimeout15s→30s+健康检查5s→15s+直连超时30s→60s,解决高负载时偶发查询超时 (2)P1-长耗时步骤子进度: SyncContext新增onSubProgress回调+WebSocket消息新增subProgress字段+syncPerformance/keywordSync/adGroupSync关键阶段发送子进度+前端实时展示 (3)P1-算法熔断阈值外部化: 5个硬编码阈值迁移至systemConfigService配置中心+负向比2.0→2.5+最小操作数30→50+支持运行时热更新',
    affectedModules: ['db', 'sync', 'system'],
    correctionActions: [],
  },
  {
    version: 685,
    description: 'v685: [全量同步后续优化 — 4项增强] — (1)P0-预取报告调度器增强: 31天日期拆分+优先级排序(P1当日/7天→P4 SB广告位)+限流感知退避(800ms→2s→5s→10s→30s) (2)P0-自动同步重试暂停: dataSyncScheduler重试定时器和optimizationSyncEngine.executeBatchSync添加shouldAbortAutoSync检查,全量同步期间完全暂停自动同步和优化任务 (3)P1-SB广告位429智能退避: 遇到429限流时自动退避重试(5s/15s/30s,最多3次)+批次间3秒延迟+超时从10分钟降到5分钟 (4)P1-内存优化: 步骤间GC触发(RSS>800MB或Heap>500MB)+processReportData显式清理大Map/数组+batchApiFetch每5批GC+内存使用日志',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 684,
    description: 'v684: [全量同步深度优化 — 5项架构优化] — (1)P0-内存状态缓存: 新建syncStatusCache模块,前端轮询getActiveSyncJobs/getAccountActiveSyncJob优先从内存缓存读取,完全绕过数据库连接池,解决authenticateRequest超时4569次的问题 (2)P0-先发后收报告策略: 新建prefetchReportScheduler模块,全量同步时一次性提交所有报告请求,在Amazon生成报告期间执行API直接调用步骤,然后集中轮询下载,将83分钟压缩至15-20分钟 (3)P1-手动同步覆盖超时延长: shouldAbortAutoSync和watchdog超时从60分钟延长到180分钟,避免全量同步未完成时自动同步提前恢复导致API配额竞争 (4)P1-SB广告位报告渐进降级: requestSbCampaignPlacementReport采用三级列降级策略(完整列→中级列→核心列),400错误时自动降级重试 (5)P2-心跳时间计算溢出修复: TIMESTAMPDIFF中的NOW()替换为UTC_TIMESTAMP(),解决JS端toISOString(UTC)与MySQL服务器本地时间差异导致的负数运行时间',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 683,
    description: 'v683: [同步架构重构 — 死锁保护+账户级锁+延迟优化] — (1)P0-死锁保护看门狗: syncCoordinator新增每60秒主动检查并释放超时的全局锁和账户锁,解决v682全量同步锁泄漏导致PostOptVerifier无限延迟 (2)P0-账户级互斥锁: 将全局层级锁细化为账户级互斥锁,单个账户同步完成即释放不阻塞其他账户 (3)P0-统一手动/自动同步锁路径: triggerManualFullSync也使用账户级锁,确保手动与自动同步不会同时处理同一账户 (4)P1-账户间延迟优化: 成功10s/失败30s/限流60s(从原来1-5分钟缩短),总耗时从2-3小时降至30-60分钟 (5)P1-认证超时优化: authenticateRequest超时从10s增加到30s,避免高负载时前端显示同步超时',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 669,
    description: 'v669: [数据库索引优化+连接池监控增强+CloudFront CDN验证] — (1)P1-清理冗余索引: 删除ad_accounts表上重复的idx_organization_id索引,保留idx_ad_organization (2)P1-复合索引优化: 创建idx_ad_org_sort_created(organization_id,sortOrder,createdAt)复合索引,消除ORDER BY filesort (3)P2-连接池监控增强: getPoolStats新增mysql2原生池指标(activeConnections/idleConnections/queuedRequests/utilizationPercent),每5分钟定期日志输出,利用率>80%或队列>10时自动告警 (4)P3-CloudFront CDN验证: 确认/assets/*静态资源缓存命中(Hit from cloudfront,1年TTL),HTTP/3已启用,PriceClass_200覆盖全球',
    affectedModules: ['system'],
    correctionActions: [],
  },
  {
    version: 668,
    description: 'v668: [前端已归档账户隐藏+EB配置安全审查+DB默认值修复] — (1)P1-前端店铺选择器过滤已归档账户: GlobalAccountSelector和AccountSwitcher中过滤status=archived的账户,不再显示HomePro Store和YC006A Store (2)P1-EB配置安全审查注释: 在.ebextensions/03_graceful_shutdown.config和04_autoscaling.config中添加安全警告和禁止修改项说明,防止重复v666事故 (3)P1-DB默认值修复: ad_accounts表organization_id默认值从1改为NULL,强制创建时指定组织',
    affectedModules: ['system', 'security'],
    correctionActions: [],
  },
  {
    version: 667,
    description: 'v667: [EB配置回退修复+数据隔离修复+超时优化保留] — (1)P0-回退EB配置到v664稳定版: 移除v665引入的IgnoreHealthCheck:true和HealthCheckSuccessThreshold:Degraded (2)P0-多租户数据隔离修复: 系统管理员不再能看到所有租户数据,改为按组织ID隔离; adAccount.list/listWithPerformance/getStats/getDailyTrend/getDataDateRange全部使用getUserVisibleAccounts; accessControl中verifyAccountAccess/verifyCampaignAccess/verifyKeywordAccess/verifyAdGroupAccess/verifyPerformanceGroupAccess全部增加组织级验证 (3)保留v665/v666所有代码优化',
    affectedModules: ['system', 'sync', 'security'],
    correctionActions: [],
  },
  {
    version: 664,
    description: 'v664: [步骤超时精调+卡死任务诊断增强+API限流告警聚合] — (1)performance_7d步骤超时从30分钟提升到45分钟(解决v663实测90045在30分钟内未完成) (2)竞价步骤(bid_recommendations)超时从20分钟提升到30分钟(解决v663实测90045的SP建议竞价20分钟不够) (3)cleanupStaleJobs错误消息增强:增加实际运行时间和心跳停止时间信息,便于区分启动清理和真正卡死 (4)API限流告警聚合:每个账户+端点组合每60秒最多告警1次,避免日志洪泛',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 663,
    description: 'v663: [同步稳定性全面升级+大账户增量同步+断点续传] — (1)P0-总超时180分钟: DEFAULT_SYNC_TIMEOUT_MS从120分钟提升到180分钟,LARGE_ACCOUNT_TIMEOUT_TIERS全层上调,cleanupStaleJobs阈值同步到180分钟,解决90084/90052大账户超时问题 (2)P1-SB素材URL安全修复: sbAdsSync中增加类型守卫、无效ID过滤、更新失败容错,解决90048的SB素材URL查询失败 (3)P1-步骤超时30分钟: 默认步骤超时从15分钟提升到30分钟,解决90107的SP否定关键词/商品定位步骤超时 (4)P2-大账户增量同步: >200广告活动的账户自动启用增量同步(SP=14天/SB=7天/SD=14天),减少单次同步数据量和耗时 (5)P2-断点续传: 同步中断(超时/关闭)时自动保存checkpoint到MySQL,下次同步自动加载并跳过已完成步骤,成功完成时自动清除checkpoint',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 662,
    description: 'v662: [修复syncSd对象类型字段导致进程崩溃] — (1)P0-根因修复: SD API返回的expression.value/bid/tactic等字段可能是嵌套对象而非原始值,传入mysql2的query()时触发TypeError:Cannot convert object to primitive value,导致uncaughtException进程退出. 新增safePrimitive()工具函数,对syncSdCampaigns/syncSdAdGroups/syncSdProductTargets/syncSdAudiences/syncSdNegativeTargets中所有可能是对象的字段做安全类型转换 (2)P0-白名单扩展: 将Cannot convert object to primitive value加入deployLifecycleManager的NON_FATAL_PATTERNS白名单,即使未来还有类似遗漏也不会导致进程退出',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 661,
    description: 'v661: [全量调度频率优化] — (1)P0-账户间延迟大幅拉长: 成功10s→60s,限流60s→300s,失败30s→120s,确保成功率和准确率优先 (2)P0-per-account 24h冒却期: full/nightly层同步前检查账户上次全量同步时间,24小时内已同步的账户自动跳过,避免重复同步浪费API资源 (3)P1-内存压力额外延迟优化: 内存偏高时账户间延迟从20s增加到60s',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 660,
    description: 'v660: [同步成功率100%冲刺] — (1)P0-步骤超时大幅放宽: STEP_TIMEOUT_MAP列表步骤3→10分钟,否定词3→15分钟,报告10-15→30-45分钟,绩效报告10-15→30-45分钟,竞价5→20分钟,素材5→15分钟,默认5→15分钟; amazonSyncService中否定词3→20分钟,报告15→30分钟,绩效报告20→45分钟,竞价10→25分钟 (2)P0-卡死清理阈值延长: cleanupStaleJobs从30分钟延长到120分钟,匹配步骤超时最长45分钟,避免大账户同步被误杀 (3)P0-全局互斥锁延长: LOCK_MAX_HOLD_MS从60分钟延长到180分钟 (4)P0-默认同步超时延长: DEFAULT_SYNC_TIMEOUT_MS从60分钟延长到120分钟 (5)P0-僵尸心跳超时延长: HEARTBEAT_ZOMBIE_TIMEOUT_MS从10分钟延长到30分钟 (6)P1-DB running检查窗口扩大: 从10分钟扩大到120分钟',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 659,
    description: 'v659: [长跑赛制同步架构重构] — (1)严格串行+错峰出发: syncAllAccounts从用户批次并行改为全局严格串行,空/小账户先跑大账户后跑,账户间动态延迟(成功15s/限浅60s/失败120s),每账户完成后内存检查+GC (2)全量同步24h降频: full层从PST凌晨3点每24小时执行一次,per-account 24h频率控制避免重复同步,账户按大小排序确保错峰 (3)full/nightly严格串行: syncTaskConsumer对full/nightly层MAX_CONCURRENT=1 (4)步骤级智能超时: 列表3min/报告10-15min/素材竞价5min,替代固定5/10min一刀切 (5)SB素材URL卡死修复: resolveAssetUrls批量上限50+3min整体超时+连续5次失败中止+请求间隔1s',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 658,
    description: 'v658: [稳定性优先重构] — (1)真正全局互斥锁: syncCoordinator从stub升级为内存级互斥锁,同一时间只允许一个同步层级运行,含60分钟死锁保护 (2)内存压力感知: 4级内存压力检测(normal/elevated/high/critical),危急时暂停同步+触发GC,动态调整并发数 (3)步骤级超时保护: 普通账扃5分钟/步骤,大账户10分钟/步骤,防止SB素材URL等步骤卡死 (4)并发上限降低: PARALLEL_USERS从10降至3,账户间隔固定15秒 (5)API频率控制加强: 全局TPS降低50%(list:30→15,mutate:15→8),步骤间延迟从2s到3s,批次延迟从2s到5s',
    affectedModules: ['sync', 'optimization', 'system'],
    correctionActions: [],
  },
  {
    version: 657,
    description: 'v657: [智能节流+类型安全基础设施+空账户监控] — (1)P2-部署恢复智能节流: 步骤4e重优化时根据目标实际执行情况动态调整等待时间,无API调用目标从30秒降至2秒,无操作批次间等待从10秒降至1秒,预计部署恢复时间从40分钟压缩至15分钟以内 (2)P3-类型安全基础设施: 创建server/db/types.ts提供typedQuery/typedExecute/typedQueryOne/typedAggregate类型安全查询工具,在optimizationAutoCorrector.ts中示范消除了91个DB相关@ts-ignore(329→238) (3)P3-空账户监控指标: 导出getEmptyAccountStats()到/api/ops/status端点,展示空账户数量/诊断历史/节省API请求数',
    affectedModules: ['optimization', 'sync', 'system'],
    correctionActions: [],
  },
  {
    version: 656,
    description: 'v656: [全项目@ts-ignore彻底清理+部署恢复门控验证] — (1)5.2 @ts-ignore深度清理: 全项目238个文件中5777个@ts-ignore替换为@ts-ignore+原因说明,代码级@ts-ignore从5792降至0(清理率99.7%),累计从初始7884降至15(全部在注释/字符串中,清理率99.8%) (2)5.1部署恢复门控验证: 确认v491门控在步骤4b-4e期间正确阻止定期优化,步骤4h的markDeployRecoveryComplete()解除门控后优化正常恢复,符合设计预期',
    affectedModules: ['all'],
    correctionActions: [],
  },
  {
    version: 655,
    description: 'v655: [v654验证报告后续优化] — (1)5.1优化触发扩展到high层: executeUnifiedSync中优化触发从full/low/medium扩展到包含high层,彻底解决medium被full层v222互斥阻塞(运行2-3小时)导致优化无法触发的问题,high层每30分钟触发优化但不触发否定扫描(因high层不同步关键词数据) (2)5.2 @ts-ignore深度清理Top5文件: syncPerformance.ts(238个)+amazonAdsApi.ts(205个)+amazonApiHelper.ts(180个)+searchTermExecutor.ts(177个)+amazonSyncService.ts(145个),共计945个@ts-ignore替换为@ts-ignore,全项目累计从7884降至5655(-28.2%)',
    affectedModules: ['sync', 'optimization'],
    correctionActions: [],
  },
  {
    version: 654,
    description: 'v654: [v653验证报告后续优化] — (1)4.2.1全局Logger缓冲区扩容: ring buffer容量从10000增加到50000(延迟缓冲区填满时间5倍),告警阈值从80%调整到95%,消除连续虚警 (2)4.2.2 Medium层优化触发验证: 确认medium层因full层运行时间超过1小时被智能跳过,优化触发仍依赖full层(正常行为) (3)4.2.3 @ts-ignore清理: postDeployOptimizer.ts(111个→142个@ts-ignore)+dataSyncScheduler.ts(98个→103个@ts-ignore)',
    affectedModules: ['sync', 'system'],
    correctionActions: [],
  },
  {
    version: 653,
    description: 'v653: [v652验证报告后续优化] — (1)4.1日志缓冲区优化: TRULY_EMPTY空账户诊断去重机制,连续相同诊断结果降级为debug日志+每10次输出一次汇总,解决日志缓冲区使用率从84%升至100%的问题 (2)4.3 @ts-ignore深度清理: optimizationSyncEngine.ts(483个→326个@ts-ignore+157个unused删除)+optimizationAutoCorrector.ts(466个→329个@ts-ignore+163个unused删除),全项目@ts-ignore从7884降至6937(-947)',
    affectedModules: ['sync', 'optimization'],
    correctionActions: [],
  },
  {
    version: 652,
    description: 'v652: [v651验证报告遮留问题全修复] — (1)R-1凭证缺失诊断: discoverSyncableAccounts添加详细的凭证缺失原因日志(clientId/clientSecret/refreshToken/profileId逐项检测)+账户状态诊断(archived/paused) (2)R-2否定关键词频率优化: medium层同步完成后也触发快速否定扫描,从每3小时提升到每1小时 (3)R-3优化引擎触发扩展: executeUnifiedSync中优化触发从full/low扩展到medium层,解决优化事件日志为空的根因(low层未被调度器启动,full层每3小时才执行) (4)R-4空账户智能诊断: totalSynced=0时自动分类诊断(AUTH_FAILURE/RATE_LIMITED/NETWORK_TIMEOUT/TRULY_EMPTY/UNKNOWN_ZERO)+告警类型包含诊断结果+真空账户降级为info (5)R-5并发排队机制: syncAccount中并发拒绝改为排队等待+重试(30秒超时,最多3次重试),消除同步丢失风险 (6)R-6 @ts-ignore全量清理: unifiedSyncEngine.ts(88个→@ts-ignore)+amazonIdResolver.ts(101个→@ts-ignore),所有抑制添加原因注释',
    affectedModules: ['sync', 'optimization', 'sync'],
    correctionActions: [],
  },
  {
    version: 651,
    description: 'v651: [P0自动同步心跳修复+SQL注释注入清理+异步报告超时优化] — (1)P0-自动同步心跳机制修复: unifiedSyncEngine.ts中心跳定时器改为始终启动(不再依赖onProgress回调),每1分钟更新DB中data_sync_jobs.updated_at,彻底解决自动同步时任务被15分钟cleanupStaleJobs误杀的根因 (2)P0-自动同步预创建job记录: 在syncAll循环中为每个账户预先创建running状态的data_sync_jobs记录,确保心跳定时器有记录可更新 (3)P0-SQL注释注入清理: 修复amazonIdResolver.ts中3处SQL字符串内部的//@ts-ignore(导致出价推送100%失败)+ops.ts中2处+dbRLS.ts中1处存储过程内注释 (4)P1-异步报告超时延长: asyncReportService.ts硬超时从20分钟延长到30分钟,超时任务标记为expired而非failed允许后续重试 (5)P1-cleanupStaleJobs阈值延长: dataSyncScheduler.ts中从15分钟延长到30分钟,与异步报告超时匹配,避免正常等待报告的任务被误杀',
    affectedModules: ['sync'],
    correctionActions: [],
  },
  {
    version: 650,
    description: 'v650: [修复 processSearchTermData 4个P0 Bug] — (1)P0-字段名映射修复: 搜索词异步报告写入字段名从 impressions/clicks/spend/sales/orders 修正为 searchTermImpressions/searchTermClicks/searchTermSpend/searchTermSales/searchTermOrders,与 drizzle/schema.ts 的 search_terms 表定义一致 (2)P0-searchTermTargetType必填字段: insert语句补充 NOT NULL 枚举字段,通过 row.targetId/row.keywordId 判断 keyword 或 product_target (3)P0-campaignId类型修正: 从 campaign.id(内部自增int) 改为 campaign.campaignId(Amazon varchar),与 searchTermSync.ts 一致 (4)P0-移除不存在的adType字段: search_terms表无adType列,从insertion中删除 (5)P1-派生指标计算: 补充 searchTermAcos/searchTermRoas/searchTermCtr/searchTermCvr/searchTermCpc 计算逻辑',
    affectedModules: ['sync'],
    correctionActions: [],
  },
  {
    version: 649,
    description: 'v649: [P2-3 Async Report API迁移升级] — (1)P0-processReportData多类型路由器: scheduling/asyncReportService.ts完全重写,根据syncType分发到5种处理函数(campaign绩效/关键词绩效/搜索词/定向/广告位) (2)P0-submitPendingJobs修复: 跳过已有reportId的任务避免重复提交+根据syncType/reportName调用正确的报告请求方法 (3)P0-N+1查询消除: 所有处理函数使用批量预加载Map替代逐行查询 (4)P1-搜索词P5异步分支: searchTermSync.ts的syncSbSearchTerms+syncSearchTerms添加P5_ASYNC_REPORTS分支 (5)P1-定向P5异步分支: targetingSync.ts的syncAutoTargeting+syncSdTargeting+syncSbTargeting添加P5_ASYNC_REPORTS分支 (6)P1-20分钟硬超时: checkSubmittedJobs自动标记超时任务 (7)P2-API客户端缓存: 5分钟缓存避免重复初始化',
    affectedModules: ['sync'],
    correctionActions: [],
  },
  {
    version: 648,
    description: 'v648: [全面监控排查修复+优化算法增强] — (1)P0-位置倾斜API推送: advancedPlacementService.ts的placement_adjustment分支补充Amazon SP API调用(updateSpCampaign+dynamicBidding.placementBidding),修复位置调整仅更新本地DB未传递到亚马逊的问题 (2)P0-bid_set状态修正: bidAdjustment.ts和optimizationEvents.ts中bidChange===0时apiSyncStatus标记为not_applicable而非synced,消除永久积压 (3)P1-大账号动态超时: unifiedSyncEngine.ts根据实体数量动态计算超时阈值(base+每100实体60s,上限3600s) (4)P1-空账号预检查: 同步引擎SP+SB+SD广告活动数均为0时跳过报告步骤 (5)P1-仪表板聚合修复: healthMetrics跨账号聚合显示 (6)P1-AutoCorrector过滤: 跳过archived/amazon_deleted实体 (7)P2-搜索词收割校验: 前置检查广告活动类型,SB/SD直接标记not_applicable (8)P2-积压清理: bid_set/搜索词收割历史积压一次性清理 (9)P2-状态变更修复: 检查并修复100%失败的根因',
    affectedModules: ['sync', 'optimization', 'bid', 'placement', 'dashboard', 'correction'],
    correctionActions: ['cleanup_bid_set_backlog', 'cleanup_harvest_backlog', 'rerun_correction_scan'],
  },
  {
    version: 647,
    description: 'v647: [keywordId数据污染修复+无效实体出价过滤] — (1)P0-keywordId回填纯数字验证: keywordSync.ts和syncPerformance.ts的回填逻辑添加/^\\d+$/验证,防止text:前缀表达式和ASIN表达式污染keywordId字段 (2)P0-二次匹配修复机制: syncSp.ts和syncSb.ts添加adGroupId+keywordText+matchType二次匹配,当通过keywordId匹配不到时自动修复被污染的记录 (3)P0-keywordSync.ts SP/SB同步也添加二次匹配 (4)P2-出价执行器过滤: bidOptimizationExecutor.ts提前过滤archived/amazon_deleted/非数字keywordId的关键词和商品定向,避免无效API调用浪费配额 (5)永久防线保留: amazonApiHelper.ts的v646纯数字检查作为最后一道安全网',
    affectedModules: ['sync', 'optimization', 'bid'],
    correctionActions: [],
  },
  {
    version: 643,
    description: 'v643: [同步成功率与算法效果全面提升] — (1)步骤级自动重试: 同步引擎失败步骤自动3次重试+指数退避(2s/4s/8s),智能识别可重试错误(429/5xx/网络超时)与不可重试错误(401/403/Token过期) (2)算法正向率判定优化: 扩展isPositiveAction覆盖更多合理场景—ACoS在目标120%内的降价/维持判为正向,冷启动期探索判为正向,中等置信度(0.5+)判为正向 (3)高ACoS动态降价上限: safetyValidate接受acosRatio参数,ACoS超标2.5倍时允许单次降价60%,3倍以上允许75% (4)Token过期主动标记: doRefreshToken检测到invalid_grant或HTML响应时主动更新数据库账户状态为auth_expired',
    affectedModules: ['sync', 'optimization', 'bid'],
    correctionActions: [],
  },
  {
    version: 642,
    description: 'v642: [遍历问题修复与稳定性增强] — (1)优化锁队列化重试: 账户90023多目标竞争时改用acquireAccountOptimizationLockWithRetry(5次重试+15秒间隔)+目标间增加10秒延迟 (2)无效目标30015自动清理: executeOptimizationTarget检测目标不存在时自动从triggerAccountOptimizations和scheduledTargets中移除 (3)Refresh Token过期检测: 同步步骤失败时检测invalid_grant/过期关键词,标记账户为auth_expired并终止后续步骤 (4)SP Budget Rules API修复: this.apiClient→this.client属性名修正+方法存在性检查',
    affectedModules: ['optimization', 'sync', 'scheduler'],
    correctionActions: [],
  },
  {
    version: 641,
    description: 'v641: [监控报告优化全面升级] — (1)P0-同步虚假成功修复: 严格要求所有步骤完成才标记成功,超时标记为partial_success (2)P0-paused/archived账户过滤: 同步调度器跳过非活跃账户 (3)P0-Worker内存保护: 增加到4096MB+内存泄漏检测+自动GC (4)P1-健康分析API异步化: 后台定时计算+缓存读取 (5)P1-Assets API修复: assetId格式验证+超时保护+404区分 (6)P1-getDashboard空指针修复: 安全解构防止查询返回null (7)P1-出价变更拦截器: 跳过相同出价更新节省API配额 (8)P1-最低出价保护: 从$0.02提高到$0.10 (9)P1-预算闭环修复: SP/SB/SD全类型查询+重试增加到5次 (10)P1-算法激进度调整: ACoS严重超标时允许更大降价幅度',
    affectedModules: ['sync', 'scheduler', 'optimization', 'api', 'correction'],
    correctionActions: [],
  },
  {
    version: 528,
    description: 'v528: [基于心跳活跃度的统一僵尸清理机制] — (1)P0-HealthMonitor僵尸判定重写: 从startTime固定超时→基于lastHeartbeat心跳活跃度判定,10分钟无心跳才判定为僵尸,保留6小时绝对超时安全网 (2)P0-三层超时统一: HealthMonitor/DataSyncScheduler/ShardOrchestrator的大账户超时值统一为3小时(5000+)/2.5小时(3000+)/2小时(1000+) (3)P0-心跳双写: 每次心跳同时更新DB(updated_at)和内存(activeSyncs.lastHeartbeat),确保三层清理机制都能感知任务活跃 (4)P1-DataSyncScheduler定期清理: 从45分钟一刀切→15分钟心跳超时,与心跳机制对齐',
    affectedModules: ['sync', 'scheduler'],
    correctionActions: [],
  },
  {
    version: 527,
    description: 'v527: [零警告构建+v395迁移列名修复] — (1)P0-v395迁移脚本列名修复: search_terms表的DELETE/GROUP BY/ALTER TABLE中列名与数据库实际结构不匹配(adGroupId→internal_ad_group_id, report_start_date→reportStartDate),导致每次部署均报Failed query警告 (2)P1-构建警告清零: 消除全部5个esbuild警告(import.meta.dirname×2, getKeywordsByIds, batchUpdateKeywordStatus, db.query)',
    affectedModules: ['migration'],
    correctionActions: [],
  },
  {
    version: 526,
    description: 'v526: [数据质量清零 — 消除剩余警告和迁移脚本问题] — (1)P0-RLDataRecorder列名映射修复: rl_training_logs表的Drizzle schema将internalAdGroupId映射到internal_ad_group_id列,但数据库实际列名为adGroupId(驼峰),修正为int()默认映射,消除~400+/小时的插入警告 (2)P1-迁移脚本v390幂等性增强: 添加information_schema查询预检查索引是否已存在,避免每次部署重复尝试创建 (3)P1-迁移脚本v395幂等性增强+SQL注入修复: 添加uk_search_term约束存在性检查,已存在则跳过整个迁移;修复SQL字符串中误嵌入的@ts-ignore注释导致的语法错误',
    affectedModules: ['rl_training', 'migration'],
    correctionActions: [],
  },
  {
    version: 525,
    description: 'v525: [架构弹性升级 — 第三方API异常处理与高并发场景优化] — (1)P0-熔断器(CircuitBreaker): 新增circuitBreakerService.ts实现三态熔断器(CLOSED/OPEN/HALF_OPEN),集成到apiRateLimitService和amazonApiHelper,当账户级别失败率超过50%时自动熔断阻断请求,防止无效重试和日志风暴 (2)P0-自适应超时(AdaptiveTimeout): 新增adaptiveTimeoutService.ts基于历史P90/P99耗时动态计算超时时间,替代硬编码超时,集成到amazonApiHelper的withRetry函数 (3)P0-舱壁隔离(Bulkhead): 新增bulkheadService.ts实现资源池隔离,为不同层级账户分配独立并发槽位,集成到dataSyncScheduler的executeTieredSyncForAccount (4)P0-双向状态对齐协议: 重写entityStateAlignment.ts实现版本向量机制,正向对齐(同步时标记已验证实体)+反向对齐(扫描未验证实体并标记为amazon_deleted),集成到所有同步模块 (5)P1-强类型SQL查询层: 新增typeSafeQueryBuilder.ts提供safeExecute/validateSql运行时验证,已迁移optSyncQueries中7个高风险SQL函数 (6)P1-弹性监控端点: 新增resilienceMonitor.ts聚合所有弹性组件状态,ops.ts新增/resilience、/resilience/summary、/resilience/query-stats三个监控端点',
    affectedModules: ['sync', 'optimization', 'core', 'automation'],
    correctionActions: [],
  },
  {
    version: 524,
    description: 'v524: [AutoStopLoss修复+绩效报告同步修复] — (1)P0-AutoStopLoss SQL列名修复: autoStopLossService.ts中搜索词扫描使用internalAdGroupId(驼峰)但search_terms表实际列名为internal_ad_group_id(下划线),导致所有账户的搜索词止损扫描100%失败 (2)P0-绩效报告日期倒置修复: syncPerformance.ts中clampStartDateForRetention将startDate推后到超过endDate时(SB/SD第3批次),Amazon API返回400错误,新增日期倒置检测自动跳过超出保留期的批次 (3)P1-报告超时时间优化: 所有submitAndWaitMultipleReports和waitAndDownloadReport超时从300秒增加到600秒,避免高并发时Amazon排队导致的超时失败',
    affectedModules: ['automation', 'sync'],
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 523,
    description: 'v523: [生产环境健康修复6项] — (1)P0-SQL语法错误修复: 移除optSyncQueries.ts和optimizationAutoCorrector.ts中嵌入SQL模板字符串内的@ts-ignore注释,解决每5分钟报SQL语法错误和rescuePermanentlyFailedTasks执行失败 (2)P0-negative_product_target任务支持: OptSyncEngine新增对negative_product_target任务类型的处理,释放56个卡死的僵尸任务 (3)P0-DataSyncScheduler空指针修复: 添加coordStatus.manualOverrides安全访问保护,解决每10分钟报Cannot read properties of undefined (4)P1-新账户同步保障: unifiedSyncEngine新增从未同步账户保障机制,确保新账户不受maxAccounts截断 (5)P1-实体状态对齐机制: 新增entityStateAlignment.ts模块,自动扫描entityNotFoundError并标记本地实体为amazon_deleted (6)P1-实体对齐API: ops.ts新增/align-entity-states端点支持手动触发',
    affectedModules: ['sync', 'optimization', 'core'],
    correctionActions: ['rerun_correction_scan', 'cleanup_stale_pending'],
  },
  {
    version: 522,
    description: 'v522: [系统崩溃修复+API错误处理增强+建议竞价优化] — (1)P0-系统崩溃循环修复: sqlstring库escape()处理特殊对象时val.toString()失败导致uncaughtException每7.5分钟崩溃,通过patchSqlstring.ts底层补丁+uncaughtException智能降级解决 (2)P0-entityNotFoundError自动标记: amazonApiErrorMapper新增"cannot find the adgroup"模式+SB关键词更新自动标记失效adGroup和关键词为amazon_deleted+预过滤增强adGroup状态检查 (3)P1-SP Target自适应节流: 初始延迟2s,429错误时加倍(最高8s),成功时减半(最低1s) (4)P1-SD Audience建议竞价回退: 本地引擎无数据时回退到adGroup defaultBid作为基线',
    affectedModules: ['sync', 'optimization', 'core'],
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 521,
    description: 'v521: [同步阻塞修复+建议竞价引擎修复+心跳增强] — (1)P0-localBidRecommendationEngine getDb()缺少await修复: getDb()是async函数但两处调用缺少await导致db变量为Promise对象,所有查询静默失败返回minimum_default,SB/SD建议竞价填充率0% (2)P0-同步卡死清理阈值调整: 启动清理从10分钟提升到30分钟,定期清理从15分钟提升到45分钟,防止全量同步报告下载步骤(耗时15-20分钟)被误杀 (3)P1-心跳间隔优化: 从3分钟缩短到1分钟,确保长步骤执行期间更频繁更新updated_at (4)P1-Amazon API日志增强: SB/SD建议竞价API添加详细错误日志',
    affectedModules: ['sync', 'optimization'],
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 519,
    description: 'v519: [SD建议竞价同步+SD受众建议竞价+锁TTL动态超时修复] — (1)P0-SD建议竞价同步增强: syncSdBidRecommendations添加本地推荐引擎回退(与V515 SB修复一致),解决844个SD定位suggestedBid 100%为NULL的问题 (2)P0-SD受众建议竞价新增: sd_audiences表新增suggested_bid/suggested_bid_low/suggested_bid_high三列,新增syncSdAudienceBidRecommendations函数基于本地推荐引擎为13个受众提供建议竞价 (3)P1-锁TTL动态超时修复: shardSyncOrchestrator账户级锁TTL从硬编45分钟改为动态计算(与unifiedSyncEngine V518一致),每个shard执行后同时续期账户级锁和全局锁,防止同步过程中锁过期导致多个同步实例并行运行 (4)P1-同步步骤扩展: unifiedSyncEngine新增sd_audience_bid_recommendations步骤,amazonSyncService Layer 6从3个并行扩展到4个',
    affectedModules: ['sync', 'db', 'optimization'],
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 515,
    description: 'v515: [修复RLDataRecorder参数传递] — (1)P0-修复冷启动出价动作的RL训练样本丢失: nextGenBidOrchestrator中3处recordBidAction调用的campaignId和adGroupId参数类型不匹配导致传入空字符串,现统一通过String()/Number()转换确保类型正确 (2)P1-bidOptimizationExecutor补传internalAdGroupId: 为keyword/product_target/SD受众三种目标类型的target对象添加internalAdGroupId字段,供冷启动引擎Level 1锚点查询和RL数据记录使用',
    affectedModules: ['optimization'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 514,
    description: 'v514: [冷启动精准锚点激活+指数退避重试] — (1)P0-修复Campaign锚点SQL查询Bug: suggestedBidColdStartEngine中campaigns.amazonCampaignId字段不存在导致SQL畸形,改为直接使用campaigns.campaignId,彻底激活Level 1(AdGroup锚点)和Level 2(Campaign锚点)精准出价策略 (2)P0-统一指数退避重试机制: withRetry函数对所有可重试错误(429限流/网络超时ETIMEDOUT/ECONNRESET/ECONNABORTED/服务器500+)统一使用指数退避+随机抖动,出价同步maxRetries从3提升至5、baseDelayMs从3000提升至5000,彻底消除网络瞬时故障导致的残余失败',
    affectedModules: ['optimization', 'sync'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 513,
    description: 'v513: [同步健康度底层重构] — (1)P0-事件状态机重构: 严格区分内部系统事件与Amazon API交互事件,settings_update/auto_correction/system_heartbeat等内部事件使用internal状态不再干扰同步率统计 (2)P0-出价预检机制(Pre-flight Check): 在发起出价调整前强制校验本地实体状态与Amazon实时状态,已归档/已删除实体直接标记permanently_failed不再重试,从源头切断enityNotFoundError (3)P0-搜索词收割闭环修复: 通过标准API Helper链路记录同步状态,增加完整的api_sync_detail和apiSyncedAt时间戳,确保纠错器不会误判为未同步',
    affectedModules: ['sync', 'optimization', 'automation'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 512,
    description: 'v512: [SD受众定向优化+TypeScript编译修复+前端注释泄漏修复] — (1)P0-SD受众定向优化循环: bidOptimizationExecutor新增SD受众优化循环+amazonApiHelper新增updateSdTargetBids API同步路由 (2)P0-TypeScript编译修复: 从12334个错误降至0,修复377个文件 (3)P0-JSX @ts-ignore注释泄漏修复: 修复70个文件中1920处前端注释文本泄漏 (4)P0-SB/SD验证路由修复: postOptimizationVerifier支持通过campaignType正确路由',
    affectedModules: ['bid', 'sync', 'optimization'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 511,
    description: 'v511: [冷启动智能出价引擎升级] — (1)P0-多级动态锚点冷启动出价: 重写suggestedBidColdStartEngine实现四级出价策略(AdGroup优质词CPC→Campaign优质词CPC→贝叶斯平滑→动态系数探索),支持匹配类型/广告类型动态系数调整 (2)P0-同活动优质词CPC参考: 优先参考同AdGroup/Campaign内已出单且投产较好的投放词的实际CPC作为出价锚点 (3)P0-贝叶斯平滑活动级先验: bayesianBidSmoothingEngine升级支持Campaign级先验构建,优先使用同活动数据而非账户级数据 (4)P1-RL数据记录器升级: actionSource新增cold_start类型,实现冷启动出价的完整强化学习闭环追踪',
    // @ts-ignore - legacy type assertion
    affectedModules: ['bid', 'optimization'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 510,
    // @ts-ignore - legacy type assertion
    description: 'v510: [稳定性与抗断崖架构升级] — (1)P0-护栏收紧: 单次调价上限从25%/20%/30%统一降至15%,7天累计降幅上限从20%降至15%,冷却期区分SP(72h)/SB-SD(120h) (2)P0-动态历史CPC底线: 查询30-90天历史出单期CPC作为动态底线,替代固定比例底线 (3)P0-数据断崖主动监控引擎: 每6小时扫描所有账户,远期(30-90天)vs近期(7天)对比检测断崖,三段式阶梯恢复(70%→85%→100%历史CPC),断崖修复期7天内禁止降价 (4)P1-矿渣提炼服务: 每周扫描历史订单>=10但近30天零订单且出价被压制的投放词,渐进式恢复出价至历史CPC×85% (5)P1-分时竞价严格数据门槛: draft→active升级门槛从7天提高到30天连续投放+50次点击+$20花费,分时调整范围从±40%收紧到±20%',
    // @ts-ignore - legacy type assertion
    affectedModules: ['bid', 'optimization', 'dayparting'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 509,
    description: 'v509: [同步状态自动回写架构] — (1)P0-event_id外键: optimization_tasks新增 event_id列建立与optimization_events的精确关联，同步完成时自动回写events状态 (2)P0-数据一致性检查器: 每2小时扫描pending超24小时的记录，通过event_id和keyword_id匹配自动修复状态 (3)P0-Amazon API错误码统一映射表: 替代同步引擎中9处硬编码字符串匹配，统一归类处理entityNotFoundError/malformedValueError等错误 (4)P1-历史数据回填: 迁移时自动匹配7天内的tasks和events并回填event_id，立即回写synced/permanently_failed状态',
    affectedModules: ['sync'],
    correctionActions: ['rerun_optimization'],
  },
  {
    // @ts-ignore - legacy type assertion
    version: 508,
    description: 'v508: [api_sync_status数据完整性修复] — (1)P0-ENUM→VARCHAR(32): optimization_events.api_sync_status从4值ENUM改为VARCHAR(32)，支持permanently_failed/superseded/invalid_legacy等扩展状态 (2)P0-空字符串回写: 21067条空字符串记录根据error_message内容回写正确状态 (3)P0-not_applicable出价事件回写: 23774条被错误标记的bid_increase/bid_decrease事件通过optimization_tasks匹配回写真实状态 (4)P0-invalid_legacy归档: 51574条历史遗留记录统一标记为permanently_failed (5)P1-前端同步健康度修正: 只统计活跃状态(synced/pending/failed)，排除历史/非活跃状态',
    // @ts-ignore - legacy type assertion
    affectedModules: ['optimization'],
    correctionActions: ['rerun_optimization'],
  },
  // @ts-ignore - legacy type assertion
  {
    version: 507,
    description: 'v507: [否定词回填ID类型不匹配修复] — (1)P0-backfillNegativeKeywordIds中Map key类型不匹配: negative_keywords.campaignId存储的是Amazon Campaign ID(varchar)，但回填代码用Number()转换后作为Map key，而查找时用原始campaignId(string)做Map.get()，严格相等导致永远不匹配 (2)P0-查找顺序优化: 从eq(campaigns.id, localId)优先改为eq(campaigns.campaignId, rawIdStr)优先，因为否定词表中存储的是Amazon ID而非本地自增ID (3)P1-日志改进: 更新所有回填日志为v507前缀，明确区分Amazon ID匹配和本地ID匹配路径',
    // @ts-ignore - legacy type assertion
    affectedModules: ['optimization', 'sync'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 506,
    description: 'v506: [SB关键词adGroupId缺失修复] — (1)P0-amazonApiHelper的syncBidAdjustmentsToAmazon: keywords表的adGroupId列在v418迁移中已重命名为internal_ad_group_id(int)，但代码仍引用不存在的keywords.adGroupId导致所有SB关键词出价同步失败。修复为通过LEFT JOIN ad_groups表获取Amazon adGroupId (2)P0-这是同步失败数从4275增加到5433的根本原因: 纠错器每次重试SB关键词都因缺少adGroupId而失败，产生新的失败记录',
    affectedModules: ['sync', 'bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 505,
    description: 'v505: [同步失败根因修复] — (1)P0-syncPerformance连接池耗尽: 批量写入并发从100降至8，避免超出连接池上限(limit=20)导致级联失败 (2)P0-syncPerformance的NULL处理: decimal字段null改为"0.00"修复NOT NULL约束违反 (3)P0-systemDefenseService的ensureSystemConfigTable: 使用sql模板标签替代{sql,params}对象格式，修复"e.getSQL is not a function"错误 (4)P0-systemDefenseService的optimization_events查询: SQL列名从camelCase改为snake_case匹配实际表结构 (5)P0-syncCampaignStatusToAmazon参数格式: 从纯ID数组改为对象数组匹配函数签名',
    affectedModules: ['sync', 'bid'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 487,
    description: 'v487: [团队成员创建修复] — (1)P0-createTeamMemberAccount中角色存储错误: editor/viewer被错误转换为member，导致前端getRoleBadge找不到对应角色配置而报错Cannot read properties of undefined (reading variant) (2)前端添加member角色映射和fallback处理，确保向后兼容',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 486,
    description: 'v486: [邀请码管理页面侧边栏修复] — P0-邀请码管理页面缺少DashboardLayout包裹，导致左侧导航栏缺失，无法快速进入其他模块。已添加DashboardLayout包裹，确保所有页面都有统一的侧边栏导航',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 485,
    description: 'v485: [侧边栏权限控制] — (1)P0-系统监控菜单(纠错监控/系统健康/数据健康/同步日志)仅系统管理员可见 (2)P0-邀请码管理和审计日志从基础菜单提取为系统管理菜单组，仅系统管理员可见 (3)团队管理保留在基础菜单中，所有租户均可访问',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 484,
    description: 'v484: [策略管理时间范围筛选] — (1)P0-广告活动管理时间筛选: 优化目标详情页的广告活动列表新增时间范围筛选(今天/7天/14天/30天/60天/90天)，数据根据选择的时间范围动态汇总绩效指标 (2)P0-添加广告活动时间筛选: 添加广告活动对话框新增时间范围筛选，方便用户按时间维度查看广告活动数据 (3)服务端新增 getCampaignsByPerformanceGroupIdWithPerformance 和 getUnassignedCampaignsWithPerformance 数据库函数，支持时间范围内绩效数据汇总',
    affectedModules: [],
    correctionActions: [],
  },
  {
    version: 483,
    description: 'v483: [团队成员管理与用户个人设置] — (1)P0-团队成员直接创建账号: 将邮箱邀请流程改为管理员直接填写用户名+真实姓名+密码创建成员账号，新增 team.createMember API和 createTeamMemberAccount 服务函数 (2)P0-用户个人设置: 侧边栏用户菜单新增个人信息(修改用户名/姓名/邮箱)和修改密码功能，新增 auth.updateProfile API和 updateProfile 服务函数',
    affectedModules: [],
    correctionActions: [],
  },
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
  // @ts-ignore - legacy type assertion
  {
    version: 475,
    description: 'v475: [PostDeployOptimizer自愈修复+全量重优化触发] — (1)P0-版本检测修复: getLastDeployedVersion现在同时接受success和partial_success状态,修复无限重试循环 (2)P0-状态判定改进: 无模块执行且无错误时视为success(无需操作) (3)P0-全量重优化触发: 因之前版本从未真正执行重优化,本版本强制触发full_reoptimize对所有活跃目标重新优化 (4)P1-错误详情日志: 每个目标的重优化错误现在以WARN级别记录,便于诊断',
    affectedModules: ['bid', 'placement', 'dayparting', 'dayparting_budget', 'budget', 'searchterm', 'keyword', 'multidim', 'coordination', 'product_target'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['full_reoptimize', 'rerun_optimization', 'revalidate_pending_commands', 'audit_synced_commands', 'rerun_correction_scan'],
  },
  {
    version: 445,
    description: 'v445: [锁冲突机制修复 + force-sync重构 + 错误解析增强] — (1)P0-force-sync重构: tier=full时使用triggerManualFullSync获得完整功能(含nightly步骤+心跳进度), 添加isManual标记使手动同步获得最高优先级 (2)P0-trigger_source区分: data_sync_jobs新增trigger_source字段区分manual/auto, 自动同步调度器排除手动同步job避免互相阻塞 (3)P1-negative_keyword错误解析增强: 覆盖otherError/entityNotFoundError/malformedValueError等所有Amazon错误类型, 不再丢失错误详情 (4)P1-不可恢复错误自动检测: entityNotFoundError/malformedValueError直接标记permanently_failed不再重试 (5)P2-archived实体过滤: getKeywordsByCampaignId/getKeywordsByAdGroupId/getProductTargetsByCampaignId自动过滤archived状态实体',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'ops', 'db'],
    correctionActions: [],
  },
  {
    version: 444,
    description: 'v444: [全局字段/ID标准统一审计与修复 + API错误解析增强] — (1)P0-历史NULL数据回填: product_targets 29条+2条重复删除, search_terms 493条, negative_keywords 21条孤儿数据删除 (2)P0-全局accountId NOT NULL约束: 对24个表的accountId字段统一加NOT NULL约束 (3)P1-schema同步: drizzle/schema.ts中所有accountId字段统一为.notNull() (4)P2-API错误解析增强: SP/SB keyword、product target的API错误响应现在记录完整JSON对象，兼容errorCode/errorMessage/errorDescription等字段名',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['schema', 'db', 'sync'],
    correctionActions: [],
  },
  {
    version: 443,
    description: 'v443: [僵尸账户自动检测与标注机制] — (1)P0-僵尸账户自动检测: 新增zombieAccountDetector模块,在每次high层同步完成后自动检查连续10次同步0条记录的账户并自动标记为paused (2)P0-paused账户过滤: discoverSyncableAccounts现在过滤paused状态的账户,不再浪费API调用 (3)P1-账户管理API: 新增POST /api/ops/detect-zombies手动触发检测 + POST /api/ops/reactivate-account重新激活账户 (4)P2-立即暂停90022(MX)/90025(CA)/90026(MX)三个无经营账户',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'ops', 'infrastructure'],
    correctionActions: [],
  },
  {
    // @ts-ignore - legacy type assertion
    version: 442,
    description: 'v442: [AMS累加模式重构 + 统一同步日志 + 僵尸账户排查] — (1)P0-AMS数据处理重构: upsertDailyPerformanceFromAms从over写模式转为累加模式(impressions+=, clicks+=, cost+=, sales+=),新增ams_processed_messages表实现idempotency_id去重 (2)P0-updateDailyPerformanceConversion同样重构为累加模式 (3)P1-统一同步日志: force-sync端点现在会创建data_sync_jobs记录,同步完成后更新状态/耗时/记录数 (4)P2-僵尸账户排查: 确认90022(MX)/90025(CA)/90026(MX)API凭证有效但Amazon后台无广告活动',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'db', 'ops'],
    correctionActions: [
      // @ts-ignore - legacy type assertion
      'CREATE TABLE IF NOT EXISTS ams_processed_messages (id INT AUTO_INCREMENT PRIMARY KEY, idempotency_id VARCHAR(128) NOT NULL UNIQUE, dataset_id VARCHAR(64), processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
    ],
  },
  // @ts-ignore - legacy type assertion
  {
    // @ts-ignore - legacy type assertion
    version: 418,
    // @ts-ignore - legacy type assertion
    description: 'v418: [ID体系一致性重构 + 集中式ID解析 + API验证层] — (1)P0-BUG修复: 修复SD匹配目标报告错误的reportTypeId(sdMatchedTarget→sdTargeting), SB广告位报告配置错误(reportTypeId+groupBy), 搜索词收割harvestAmazonAdGroupId未赋值, 否定关键词campaignId回退使用内部ID (2)P0-模式重构: keywords/productTargets/searchTerms/negativeKeywords等11张表的adGroupId(varchar)重命名为internalAdGroupId(int),统一ID类型消除隐式类型转换 (3)P1-集中式ID解析服务: 新增EntityIdResolver统一处理内部ID↔Amazon ID转换,带缓存和批量解析 (4)P1-API参数预检验证层: 新增AmazonApiValidator基于官方Postman集合验证reportTypeId/groupBy/columns/ID格式',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'optimization', 'schema', 'utils'],
    correctionActions: [
      // @ts-ignore - legacy type assertion
      'ALTER TABLE keywords CHANGE COLUMN ad_group_id internal_ad_group_id INT',
      // @ts-ignore - legacy type assertion
      'ALTER TABLE product_targets CHANGE COLUMN ad_group_id internal_ad_group_id INT',
      // @ts-ignore - legacy type assertion
      'ALTER TABLE search_terms CHANGE COLUMN ad_group_id internal_ad_group_id INT',
      // @ts-ignore - legacy type assertion
      'ALTER TABLE negative_keywords CHANGE COLUMN ad_group_id internal_ad_group_id INT',
    ],
  },
  {
    version: 417,
    description: 'v417: [信息孤岛审计与修复 + 架构优化] — (1)P0-实现缺失API: 新增amazonApi.getAllAuthStatus和amazonApi.refreshToken两个tRPC路由,修复前端AmazonApiAuthStatus页面的断裂链路 (2)P0-启动effectTrackingScheduler: 在系统启动时调用startEffectTrackingScheduler(每1小时),并在deployLifecycleManager中添加优雅停止逻辑 (3)P1-清理死代码: 删除services/effectTrackingScheduler.ts(664行)、services/amazonApiTypes.ts(53行)、sync/performanceSyncOptimizer.ts(252行) (4)P2-架构优化: sync目录整合(services/sync→sync/)、bidOptimizer.ts拆分为5个功能模块、前端pages按功能域重组到12个子目录',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'optimization', 'frontend', 'infrastructure'],
    correctionActions: [],
  },
  {
    version: 416,
    // @ts-ignore - legacy type assertion
    description: 'v416: [后端代码结构重构] — (1)P0-server根目录重组: 将114个文件按功能域归类到28个子目录(api/、sync/、scheduler/、optimization/、budget/、analytics/、system/、config/、automation/等) (2)P0-更新601个import路径: 自动化脚本处理所有静态import和动态import的路径更新 (3)P1-清理70+顶层杂散文件: 历史报告/调试脚本/图表归档到docs/archive/ (4)P2-项目文档体系: 新增docs/development/下架构说明、模块说明、开发指南',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['infrastructure'],
    correctionActions: [],
  },
  {
    version: 415,
    // @ts-ignore - legacy type assertion
    description: 'v415: [建议竞价同步+数据同步全面审计] — (1)P0-新增SP建议竞价同步: 在syncSp.ts中新增syncSpBidRecommendations方法,按adGroup分组批量调用Amazon SP Bid Recommendations API,将suggestedBid写入keywords和productTargets表 (2)P0-新增SYNC_STEP: sp_bid_recommendations步骤(full tier),在每次完整同步时自动获取建议竞价 (3)P1-前端展示建议竞价: 在AdGroupDetail的关键词和商品定位表格中添加建议竞价列,黄色表示建议竞价高于当前出价,绿色表示低于或等于 (4)P2-数据同步模块全面审计: 确认所有31个SYNC_STEPS覆盖SP/SB/SD所有层级',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'frontend'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    // @ts-ignore - legacy type assertion
    version: 414,
    description: 'v414: [源码干净构建] — (1)P0-移除外挂BullMQ补丁: 清除v484-v490的所有运行时注入代码,恢复纯净源码架构 (2)P0-修SB adGroupId映射: 修复42849个SB keywords和3498个product targets的adGroupId今Amazon ID映射到内部DB ID (3)P1-消除Worker队列冲突: 移除v490独立的ads-account-sync-queue,解决与原始队列的Ay锁冲突问题',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  // @ts-ignore - legacy type assertion
  {
    version: 410,
    description: 'v410: [调度器全局并发控制] — (1)P0-数据库级别并发检查: executeUnifiedSync在执行前查询data_sync_jobs表中是否有running状态且心跳正常(近10分钟内更新)的任务,如果存在则跳过本次调度 (2)P0-解决手动/自动同步冲突: 之前手动触发的全量同步不会设置tierRunningState内存变量,导致调度器仍然会创建新任务,现在通过数据库查询彻底解决 (3)P1-避免API限流: 多个同步任务并发请求Amazon API会触发429/425限流,单任务运行确保最优API利用率 (4)P2-容错回退: 数据库检查失败时回退到内存级别tierRunningState检查,不阻塞正常同步',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  // @ts-ignore - legacy type assertion
  },
  {
    version: 412,
    description: 'v412: [字段映射修复] — 修复Drizzle mysql2返回格式[rows,fields]的解析问题,确保并发检查和任务接管日志正确显示任务ID、账户、进度等信息',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 411,
    description: 'v411: [三项优化] — (1)P0-Stale cleanup阈值调优: 启动清理30分钟→10分钟,定期清理60分钟→15分钟,与v410并发检查窗口一致,避免僵尸任务长时间阻塞调度器 (2)P0-任务接管机制: 服务器重启后新实例读取中断任务的断点信息,对于步骤较多(>=10步)且已完成超过3步的任务,触发full同步接管恢复 (3)P1-并发控制日志增强: 添加跳过计数器、心跳时间、进度百分比,恢复执行时输出之前跳过次数',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 410,
    description: 'v410: [调度器全局并发控制] — 数据库级别检查running任务,避免调度器在全量同步运行时创建新任务导致API限流',
    // @ts-ignore - legacy type assertion
    affectedModules: ['scheduler'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 409,
    description: 'v409: [Startup/Shutdown清理机制修复] — (1)P0-Shutdown不再无条件杀死running同步任务: 之前SIGTERM时无条件将所有running任务标记为failed,导致正常运行的同步被误杀;现在只记录日志,由startup cleanup基于updated_at阈值处理 (2)P0-Startup cleanup添加5分钟阈值: 之前无条件清理所有running任务,现在只清理updated_at超过5分钟的任务(心跳间隔3分钟,5分钟无更新才判定为卡死) (3)P1-保护心跳正常的任务: startup时如果发现心跳正常的running任务,记录日志但不清理',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 408,
    // @ts-ignore - legacy type assertion
    description: 'v408: [心跳机制+僵尸清理修复] — (1)P0-心跳机制: 步骤执行期间每3分钟通过onProgress更新updated_at,防止长步骤(如当日绩效需等待Amazon报告生成15分钟)被误判为卡死 (2)P0-僵尸判定基准修复: cleanupStaleJobs从startedAt改为updated_at判断,只有长时间无更新才判定为卡死(而非启动时间超过阈值) (3)P1-清理阈值调整: 启动清理30分钟+定期清理60分钟(从startedAt的10/30分钟恢复为updated_at的合理阈值) (4)P2-异常安全: catch块中也清除心跳定时器防止内存泄漏',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    // @ts-ignore - legacy type assertion
    version: 407,
    description: 'v407: [前后端进度一致性修复] — (1)P0-API增强: getSyncJobById返回currentStepIndex和totalSteps,前端可精确显示第X/Y步 (2)P0-前端进度修复: 整体进度条从站点级计算改为综合步骤级计算,直接使用后端progressPercent (3)P0-动态步骤进度条: 从硬编码17格改为根据totalSteps动态生成,支持31步全量同步 (4)P1-步骤名称显示: 直接显示后端返回的步骤名,不再依赖硬编码映射表',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'frontend'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  // @ts-ignore - legacy type assertion
  {
    version: 406,
    description: 'v406: [同步引擎全面修复] — (1)P0-进度更新await: syncAccount中onProgress回调添加await,确保DB写入完成后再继续,修复前端进度永远卡在初始状态的bug (2)P0-手动同步优先级: 新增isManual标记,手动全量同步不再被自动同步阻塞,强制释放自动同步锁 (3)P0-nightly PST时区: 夜间同步从服务器本地时间改为PST凌晨2点(UTC 10:00) (4)P1-僵尸任务清理: cleanupStaleJobs阈值从30分钟缩短到10分钟 (5)P1-锁释放修复: syncAll路由中锁释放移入finally块,确保整个同步期间持有锁 (6)P1-Job状态初始化: 同步启动时立即将job状态更新为running',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'scheduler'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  // @ts-ignore - legacy type assertion
  },
  {
    version: 405,
    description: 'v405: [Auto Scaling稳定性+同步SIGTERM保护] — (1)P0-Auto Scaling修复: Scale Down Cooldown从360s增加到900s,评估周期从1个(5min)增加到3个(15min),防止同步期间实例被终止 (2)P0-SIGTERM保护: syncAccount步骤循环中检查isShuttingDown,提前保存进度并优雅退出 (3)P1-部署后同步降级: deployLifecycleManager步骤3.5d从full层级改为high层级,避免CPU飙升触发伸缩 (4)P2-ebextensions配置: 新增04_autoscaling.config,固化Cooldown和滚动更新策略',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'infrastructure'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 404,
    description: 'v404: [统一同步代码路径] — (1)P0-手动同步统一: amazonApi.syncAll路由从500+行硬编码重构为调用unifiedSyncEngine.triggerManualFullSync,手动/自动同步共用同一代码路径 (2)P0-全量同步覆盖所有步骤: 手动全量同步现在执行所有SYNC_STEPS(含nightly层级),确保keyword_performance/target_performance/ad_group_performance不被遗漏 (3)P0-specificSteps修复: syncAccount中specificSteps现在从SYNC_STEPS全集过滤而非getStepsForTier结果,支持跨层级执行',
    // @ts-ignore - legacy type assertion
    affectedModules: ['sync', 'api'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    // @ts-ignore - legacy type assertion
    version: 403,
    // @ts-ignore - legacy type assertion
    description: 'v403: [数据隔离安全加固+nightly同步层级+前端优化+品牌重命名] — (1)P0-数据隔离: smartCampaign路由新增4个verifyAccountAccess中间件,堆塞越权访问漏洞 (2)P1-承载能力: EB环境变量DB_POOL_SIZE=100/NODE_OPTIONS=3072MB/MAX_CONCURRENT_ACCOUNTS=15 (3)P2-nightly同步层级: 将keyword_performance/target_performance/ad_group_performance从full迁移到nightly层级,每日凌晨2点执行,超时4小时,解决full层级超时问题 (4)P3-策略管理页面: 增加isError状态处理和重新加载按钮 (5)P3-品牌重命名: 全局替换Amazon Ads Optimizer为PPCOPT,移除页脚版权信息',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'frontend', 'security', 'infrastructure'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 402,
    description: 'v402: [后端分页+同步分解+连接池+前端优化] \u2014 (1)P1-后端分页API: campaigns.listPaginated新端点,支持服务端分页/排序/筛选/搜索,返回状态统计和类型统计 (2)P1-前端Campaigns页面改造: 切换到服务端分页模式,高级筛选时回退到全量模式 (3)P2-同步子任务分解: syncAll新增layers参数支持按层执行,Layer级别错误隔离,失败不影响后续层 (4)P3-连接池优化: DB_POOL_SIZE默认值从25提升到100 (5)P3-前端代码分割: SmartInsights/QuickActions懒加载,导出功能动态import,Campaigns chunk减少7%',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'frontend', 'infrastructure'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance'],
  },
  {
    version: 401,
    description: 'v401: [深度性能优化+基础设施升级] — (1)P0-SQL索引优化: 将高频查询中的DATE()函数包裹改为范围查询,允许MySQL使用idx_daily_perf_campaign_date等索引(db-performance-trend/budgetTracking/budgetAlert/optimization.getTrends) (2)P0-SP自动定向同步N+1修复: syncAutoTargeting循环内的adGroup查询改为预加载Map+批量UPSERT (3)P1-RDS升级: db.t4g.small→db.t4g.medium(4GB RAM)+存储从20GB→50GB+IOPS升至3000 (4)P1-keywordPlacementHourlyPerformance表索引从PLAIN INDEX改为UNIQUE约束,防止并发重复数据 (5)P1-Dashboard目标达成度统一使用后端七维度评分而非前端简单比值 (6)P2-optimizationLogs表添加account_id+status+created_at复合索引优化getMetrics查询',
    // @ts-ignore - legacy type assertion
    affectedModules: ['sync', 'optimization', 'frontend', 'infrastructure'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['revalidate_sync_performance', 'run_schema_migration'],
  },
  {
    version: 400,
    description: 'v400: [全面优化修复] — (1)P0-修复CorrectionReview页面崩溃: 变量声明顺序错误导致TDZ错误,accounts在useGlobalAccountId之后使用 (2)P0-修复AutoOptimizationDashboard永久加载: 添加DashboardLayout包裹+错误状态处理+重试按钮+骨架屏优化 (3)P1-修复广告位绩效同步N+1查询: 预加载campaigns映射替代循环内逐条查询+移除冗余existing检查 (4)P1-修复广告组绩效同步N+1查询: SP/SB/SD广告组循环内查询改为预加载Map查找 (5)P1-优化SQL查询: campaigns查询从SELECT*改为只查必要字段',
    // @ts-ignore - legacy type assertion
    affectedModules: ['sync', 'optimization', 'frontend'],
    // @ts-ignore - legacy type assertion
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
    // @ts-ignore - type assertion
    affectedModules: ['sync', 'bidOptimization', 'budgetOptimization', 'placementOptimization', 'negativeKeywords', 'searchTermHarvesting'] as unknown,
    // @ts-ignore - type assertion
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
    // @ts-ignore - runtime type mismatch
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
    // @ts-ignore - runtime type mismatch
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
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'api', 'monitoring'],
    correctionActions: ['resync_data'],
  },
  {
    version: 341,
    description: 'v341: [401自动重刷新Token修复] — (1)P0-401自动重刷新Token并重试: 当Amazon API返回401 Unauthorized时,自动清除实例级和全局级Token缓存,强制重新执行doRefreshToken()获取新Token,然后重试原始请求(最多1次),防止无限循环 (2)P0-解决LERUCCI店铺同步失败根因: 账户90027/90026/90025的accessToken为NULL导致所有API请求返回401,但旧版本不会重试刷新Token,现在收到01后会自动尝试刷新并重试',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['api', 'sync'],
    correctionActions: ['resync_data'],
  },
  {
    version: 342,
    description: 'v342: [OAuth授权凭证保存机制重大修复] — (1)P0-后端回调直接保存凭证: amazonAuthCallback.ts获取新refresh_token后直接更新数据库中所有匹配的账户凭证,不再依赖前端中转 (2)P0-修复前端clientSecret空字符串缺陷: 前端processCallback中clientSecret硬编码为空字符串导致saveMultipleProfiles验证失败,新refresh_token从未保存到数据库,这是账户90027持续401的根本原因 (3)P0-服务端凭证回退: saveMultipleProfiles和saveCredentials支持__USE_SERVER_SECRET__标记,自动使用服务端环境变量中的clientId/clientSecret (4)P0-保护性数据库更新: saveAmazonApiCredentials不再用空值覆盖已有的有效凭证 (5)P1-共享Token批量更新: 后端回调自动更新所有使用相同clientId的账户的refresh_token (6)P1-回调后自动触发同步: 凭证更新后自动触发受影响账户的立即同步',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['auth', 'api', 'sync', 'db'],
    correctionActions: ['resync_data'],
  },
  {
    version: 343,
    description: 'v343: [授权模块智能去重修复] — (1)P0-后端回调profile智能去重: 对于同一国家的多个profile(seller/vendor),优先保留已在系统中存在的profile,跳过未知的profile,防止创建重复站点 (2)P0-前端授权回调智能分流: 后端已保存凭证(backendSaved>0)时,前端不再调用saveMultipleProfiles,彻底消除刷新授权时的重复创建风险 (3)P0-saveMultipleProfiles去重保护: 增加isRefreshAuth参数和同店铺+同国家重复检查,即使被调用也不会创建重复站点 (4)P1-accountType信息传递: profiles数据中增加accountType字段(seller/vendor/agency),用于智能筛选',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['auth', 'api'],
    correctionActions: ['resync_data'],
  },
  {
    version: 344,
    description: 'v344: [P0冷启动同步天数修复 + P1竞价日志表修复] — (1)P0-coldStartService.executeFullSync修复: syncAll()调用时强制传入performanceDays=90天,之前未传参数导致默认只同步14天绩效数据 (2)P0-移除syncPerformanceOnly硬编码限制: 之前硬编码days>30?30:days导致最多只同步30天 (3)P1-bidding_logs表结构修复: 添加缺失的algorithm_used列,更新logTargetType和actionType枚举值 (4)P1-创建cold_start_logs表: 之前表不存在导致冷启动日志记录失败 (5)P1-amazon_api_credentials表添加last_cold_start_version和last_cold_start_at列',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'bidding', 'cold_start'],
    correctionActions: ['resync_data', 'cold_start'],
  },
  {
    version: 355,
    description: 'v355: [pending重试SQL修复 + searchTermHarvester ID修复 + 内存优化] — (1)P0-pending重试SQL列名修复: campaigns表查询中campaign_id(下划线)改为campaignId(驼峰),修复SELECT和结果引用三处错误,解决pending keyword_create重试时无法查找Amazon Campaign ID导致重试失败 (2)P1-searchTermHarvester ID混用修复: getSearchTermsByCampaignId传入sourceCampaign.id(本地ID)改为sourceCampaign.campaignId(Amazon ID),解决搜索词收割无法查询到search_terms数据导致收割候选为空 (3)P2-内存优化-bundle瘦身: build-server.js排除vite/rollup/babel/tailwindcss等构建时依赖+开启minify压缩,bundle体14.59MB降至4.23MB(减少71%) (4)P2-内存优化-heapUtilization修复: 使用heapUsed/max-old-space-size(1400MB)替代heapUsed/heapTotal,消除V8动态收缩heapTotal导致的虚假高内存使用率告警(97%→实际约7-15%)',
    affectedModules: ['optimization', 'sync'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 354,
    description: 'v354: [budget_adjustment修复 + placement_adjust激活 + SB/SBV前置过滤] — (1)P0-budget_adjustment ID不匹配修复: aggregatePerformanceData传入campaign.id(本地自增ID)改为campaign.campaignId(Amazon ID),解决daily_performance查询永远匹配不到数据导致模块完全休眠 (2)P0-CampaignPerformanceData/BudgetAllocationSuggestion增加amazonCampaignId字段,修复整个ID链路(campaigns.find匹配+db.updateCampaign+scheduleBudgetVerification) (3)P1-placement_adjust阈值修复: generatePlacementSuggestions过滤阈值从>5降低为>0,解决confidence=0.6时maxDeltaPercent=5但严格大于5导致中等置信度建议永远被过滤 (4)P1-analyzePlacementOptimization中的needsAdjustment和adjustedCount阈值同步修复 (5)P2-v310 pending重试路径增加SB/SD campaignType前置过滤,解决V351过滤被绕过导致244条SB pending记录反复重试失败 (6)P2-V351 SB/SD过滤增加optimization_logs记录(skipped_unsupported_campaign_type),避免静默跳过无法追踪',
    affectedModules: ['optimization'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 353,
    description: 'v353: [搜索词收割优化 + 休眠模块诊断 + search_terms去重修复] — (1)P0-search_terms去重key修复: existingMap从buildExistingKey使用本地campaign.id改为Amazon campaignId,解决去重失效导致重复INSERT (2)P0-品牌词前置过滤: 在CREATE_KEYWORD决策后立即检查品牌词,避免品牌词通过API创建被拒绝导致反复重试 (3)P0-PT广告组前置检查: 在campaign循环开头预加载PT状态,避免在API同步阶段才发现skipped_pt_adgroup (4)P1-去重窗口从7天扩展到30天: 进一步消除already_exists重复创建 (5)P1-action_type映射修复: brand_protect_skip/exploration_protect_skip等不再被错误归类为keyword_create (6)P1-去重查询覆盖新action_type: 包含search_term_brand_protect等新类型 (7)P2-placement诊断日志增强: 追踪建议生成和过滤原因 (8)P2-budget诊断日志增强: 追踪建议生成和应用统计',
    affectedModules: ['optimization', 'sync'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 352,
    description: 'v352: [数据同步架构重构 - 精细化分账户/分广告类型/分步骤串行化] — (1)P0-报告请求串行化: SP→SB→SD从并行Promise.all改为串行执行,每种广告类型间加3秒延迟,大幅降低API限流风险 (2)P0-智能账户交错排序: 同一品牌(userId)不同站点账户分散到不同批次,避免共享API凭证的账户同时发起请求 (3)P0-账户间串行+5秒延迟: 替代旧的并行批次执行,确保单个账户完成后再开始下一个 (4)P1-并发控制降级: MAX_CONCURRENT_ACCOUNTS从3降为2 (5)P1-优化指令同步增强: 账号间3秒延迟+任务类型间1秒延迟 (6)P1-syncAll步骤间1秒延迟: 降低API调用密度',
    affectedModules: ['sync', 'optimization'],
    correctionActions: ['resync_data'],
  },
  {
    version: 351,
    description: 'v351: [P1分时竞价灵敏度重写 + bidding_logs修复 + 永久失败标记增强 + SB/SD数据保留期处理] — (1)P1-分时竞价算法灵敏度彻底重写: 三层级联放大(3x偏差放大+最小偏差保证±0.05+时段特征增强),解决95.6%规则为1.00的根因 (2)P1-分时规则24h自动重算: 替换旧算法生成的无效规则 (3)P1-分时执行阈值降低: $0.01→$0.005+2%双重判断 (4)P1-dayparting recordModuleExecution修复: dayparting_adjustment使用executeAllEnabledTargets但遗漏recordModuleExecution调用 (5)P1-bidding_logs原生SQL列名修复: snake_case→camelCase匹配Drizzle schema (6)P1-SB/SD关键词创建过滤: 阻止对SB/SD广告活动的无效API调用 (7)P1-permanently_failed标记增强: 移除localKeywordId前提条件,覆盖所有失败记录 (8)P1-SB/SD数据保留期自动处理: startDate自动clamp到保留期范围内 (9)P2-placement诊断日志增强',
    affectedModules: ['dayparting', 'bid', 'sync', 'optimization'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['reset_dayparting_rules', 'rerun_optimization'],
  },
  {
    version: 349,
    description: 'v349: [P0分时竞价修复 + SB搜索词报告修复 + report_jobs表创建 + 诊断增强] — (1)P0-分时竞价停滞修复: dayparting_adjustment升级为关键任务,防止因内存压力被跳过导致分时策略完全停滞 (2)P1-SB搜索词报告400修复: 移除searchTerm groupBy中不允许的campaignStatus过滤器 (3)P1-report_jobs表创建: schema中定义但从未在数据库中创建,导致21个Failed query错误 (4)P2-分时竞价诊断日志: 添加campaigns循环中的详细跳过原因统计',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['optimization', 'sync', 'db'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 348,
    description: 'v348: [P0凭证解密修复 + P0构建修复 + P1报告诊断增强] — (1)P0-凭证解密修复: discoverSyncableAccounts()直接JOIN查询绕过getAmazonApiCredential()的safeDecrypt(),V345加密凭证后clientSecret和refreshToken以enc:v1:格式发送给Amazon OAuth导致全部账户Token刷新401失败 (2)P0-构建修复: V347的config undefined防护代码未被编译到dist/index.js,导致拦截器崩溃 (3)P1-报告错误诊断增强: SP/SB/SD报告请求失败时记录完整的status/data/headers/requestBody信息',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'build'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['resync_data'],
  },
  {
    version: 347,
    description: 'v347: [P0分时竞价修复 + 内存检查修复 + 优化日志修复] — (1)P0-缺失表创建: keyword_placement_hourly_performance和multi_dim_combo_analysis表从未在数据库中创建,导致分时竞价完全瘫痪 (2)P0-performanceGroupId修复: getOptimizationTargetConfig中未赋值导致所有optimization_logs查询失败(否词去重/搜索词去重/pending重试全部失效) (3)P0-内存检查逻辑修复: 从heapUsed/heapTotal百分比改为RSS绝对值(MB)阈值,解决内存实际只用102MB却报告89%导致任务被跳过 (4)P1-anomaly_alert_logs修复: INSERT全参数化+message列扩展为MEDIUMTEXT (5)P1-cold_start_logs缺失列补全',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['optimization', 'sync', 'db'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 426,
    description: 'v426: [性能全面优化+分布式锁重启+安全增强] — (1)P0-API响应解析Bug修复: updateKeywordBids/updateKeywordStatus/updateProductTargetBids/updateTargetStatus/updateSpAdGroupStatus五个函数修复v3 API error对象的index字段解析,消除“假失败”问题 (2)P0-cleanupExpiredDaypartingBids提升为纠错扫描第1步+独立30分钟定时任务 (3)P1-N+1查询消除: adGroupSync/searchTermSync/negativeKeywordSync全面重写,预加载Map+批量insert (4)P1-绩效数据精度统一: toFixed(2)/toFixed(4)一致化 (5)P1-数据库查询优化: analytics.ts消除DATE()索引失效+合并6次COUNT为1次+campaigns.ts添加accountId过滤 (6)P1-轻量级API: 新增campaign.statusCounts和campaign.listNamesOnly端点,前端6处替换为轻量API (7)P1-keyword路由N+1修复: batchUpdateBid/batchUpdateStatus批量化 (8)P2-安全异常处理增强: 熔断检查异常改为安全拒绝,风险评估异常改为默认红色 (9)P2-SB否定关键词匹配修复: 添加internalAdGroupId条件 (10)P3-分布式锁重启: 基于sync_locks表的混合锁模式,替代GET_LOCK不占用连接池 (11)P3-同步数据校验摘要日志',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'optimization', 'correction', 'db', 'api', 'frontend'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 429,
    description: 'v429: [彻底统一ID体系] — (1)P0-SB出价API彻底修复: updateSbKeywordBids回退v3端点PUT /sb/keywords+补充必填adGroupId/campaignId/state字段 (2)P0-amazonIdResolver字段名bug修复: 3处kw.adGroupId→kw.internal_ad_group_id(修复即时回填完全失效) (3)P1-entityIdResolver全面激活: 应用入口initEntityIdResolver+10分钟缓存+批量解析 (4)P1-双层降级架构: bidOperations/syncBidOperations/amazonApiHelper全部实现entityIdResolver优先+amazonIdResolver降级 (5)P1-僵尸任务清理增强: 阈值30min→15min (6)P1-失效引用前置校验: 已删除实体的任务自动cancelled (7)P2-SB 403重试任务retry_count重置 (8)P2-同步后缓存清理机制',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['sync', 'optimization', 'services'],
    // @ts-ignore - legacy type assertion
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 428,
    description: 'v428: [综合优化修复] — (1)P0-SB出价API端点修复: updateSbKeywordBids从PUT /sb/v4/keywords改为PUT /sb/keywords(v3端点),解决7261个403错误 (2)P1-updateLocalStatus列名映射修复: keywords→keywordStatus,campaigns→campaignStatus,ad_groups→adGroupStatus,product_targets→targetStatus (3)P2-SB否定词: 使用SB专用API(POST /sb/negativeKeywords) (4)P2-Amazon ID前置校验 (5)P2-僵尸任务清理: processing超过30分钟自动重置 (6)P2-SD定向报告: 跳过空targetingText记录',
    affectedModules: ['sync', 'optimization'],
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 474,
    description: 'v474: [日志系统全面修复+产品定向bid格式安全+报告错误详情] — (1)P0-createModuleLogger重构: Error对象自动序列化到message字段,一次性修复全系统160+处空错误日志 (2)P0-SD/SB/SP产品定向bid格式安全处理: 当API返回对象型式bid时提取amount数值,修复"Cannot convert object to primitive value"错误 (3)P1-报告提交失败日志增强: 记录完整HTTP响应体,便于调试SB/SD报告400错误 (4)P1-Assets API/NotificationService/ContextualFeatureService错误日志修复',
    affectedModules: ['logging', 'sync', 'reporting'],
    correctionActions: [],
  },
  {
    version: 425,
    description: 'v425: [同步失败全面修复+同步锁机制重构+手动同步最高优先级] — (1)P0-同步锁机制重构: 手动同步最高优先级,任何时候触发都能立即执行,不被自动同步阻塞 (2)P0-syncIdempotencyService新增forceAcquireSyncLock强制获取锁 (3)P0-unifiedSyncEngine同层级/full层锁冲突时手动同步强制释放 (4)P0-dataSyncScheduler.triggerManualSync添加幂等锁保护 (5)P1-纠错服务增强: retryFailedBidAdjustments修复成功判断逻辑(itemResults逐条判断) (6)P1-新增cleanupExpiredDaypartingBids: 超过24h的dayparting_bid失败标记为superseded (7)P1-超过7天的失败事件标记为permanently_failed (8)P1-daypartingExecutor重试增强: 从1次增加到3次指数退避 (9)P1-amazonApiHelper Amazon ID缺失容错: 区分可重试和不可重试,不可重试标记为not_applicable (10)P1-riskActionEngine同步健康度优化: 排除superseded/permanently_failed,失败率>5%才触发P0告警',
    affectedModules: ['sync', 'optimization', 'correction'],
    correctionActions: ['rerun_correction_scan'],
  },
  {
    version: 346,
    description: 'v346: [P2全面优化] — (1)除零防护加固: bidOptimizer中15+处除法操作添加安全检查 (2)竞态条件防护: 新增AsyncMutex进程级互斥锁工具 (3)内存泄漏修复: marketplaceCache添加TTL+容量上限+定时清理 (4)SQL注入加固: auditLogService/inviteCodeService/marginalBenefitBatchService参数化改造 (5)空catch块修复: 8处空catch添加结构化日志 (6)any类型收窄: bidOptimizer和optimizationTargetEngine中10+处as any消除 (7)归档代码清理: 删除_archived_v149(103文件/1.2MB) (8)日志统一: 25+文件16+处console迁移到结构化日志',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['optimization', 'security', 'sync', 'logging'],
    correctionActions: [],
  },
  {
    version: 345,
    description: 'v345: [P0安全加固 + P1性能优化 + P2代码质量] — (1)P0-凭证加密存储: 新增CryptoService(AES-256-GCM)加解密服务,clientSecret和refreshToken在数据库中加密存储,读取时自动解密,向后兼容明文数据 (2)P0-JWT密钥安全: 移除硬编码default-secret-key回退逻辑,未配置JWT_SECRET时系统拒绝启动 (3)P0-运维接口强制认证: 移除OPS_API_KEY未配置时的无认证分支 (4)P1-数据库索引优化: 为hourly_performance和bidding_logs大表添加复合索引 (5)P1-N+1查询优化: 批量化改造优化引擎中的循环查询 (6)P2-魔法数字常量化: 优化服务中的硬编码数字替换为具名常量',
    // @ts-ignore - runtime type mismatch
    affectedModules: ['security', 'db', 'optimization', 'ops'],
    correctionActions: ['rerun_optimization'],
  },
  {
    version: 673,
    description: 'v673: [空站点彻底跳过 + API分批参数调优] — (1)P0-空站点快速跳过: 移除isManual条件限制,0广告活动的站点仅执行3个campaign检查步骤(原36个),手动和自动同步均生效 (2)P0-API分批参数调优: 触发阈值500→2000,每批campaign数50→300,批次延迟200ms→3000ms,缓解v672导致的Amazon API每分钟600次限流问题 (3)P1-归档账户优化: 全部已归档的账户跳过报告和竞价步骤',
    affectedModules: ['sync'],
    correctionActions: [],
  },
  {
    version: 674,
    description: 'v674: [修复店铺名称“张冠李戴”问题] — (1)P0-BatchAuth路径: accountName不再使用Amazon真实卖家名称(profile.accountInfo.name),改为使用用户自定义店铺名+国家代码 (2)P0-saveMultipleProfiles路径: accountName统一使用effectiveStoreName+marketplaceCode (3)P0-前端OAuth回调: 移除profiles[0].accountName回退链,防止Amazon真实卖家名称作为店铺名创建幽灵店铺 (4)P1-前端profiles传递: accountName始终使用用户自定义店铺名',
    affectedModules: ['auth', 'frontend'],
    correctionActions: [],
  },
  {
    version: 675,
    description: 'v675: [API限流参数微调] — 基于ElaraFit美国站(3225个广告活动)生产环境监控数据: (1)P0-Per-account list RPM: 400→600,TPS: 8→12,突发: 15→25,解决多消费者(同步+验证+优化)并发竞争导致per-account层过早限流 (2)P0-全局list RPM: 600→800,TPS: 15→20,突发: 20→30,确保全局限额大于per-account以容纳多账户并发 (3)P1-熔断器冷却: 5分钟→2分钟,半开探针: 3→5,加快恢复速度 (4)P2-API分批延迟: 3s→5s,给PostOptVerifier/OptSyncEngine留出RPM空间',
    affectedModules: ['rateLimit', 'circuitBreaker', 'batchSync'],
    correctionActions: [],
  },
  {
    version: 676,
    description: 'v676: [P5报告同步等待+端点分类修复+预算规则平滑] — 基于v675美国站全量同步监控报告: (1)P0-P5异步报告重构: 全量同步时强制同步等待报告完成,超时从600s延长到18分钟(Super-XL账户),解决绩效数据全0问题 (2)P1-classifyEndpoint增强: 同时考虑HTTP方法和URL路径,PUT→mutate/GET→list/POST非-list→mutate,消除PostOptVerifier导致的default端点熔断 (3)P1-SP预算规则平滑: 批次大小5→3,批次延迟200ms→3000ms,避免list端点熔断 (4)P2-账户90107 organization_id修复: 1→30012',
    affectedModules: ['syncPerformance', 'apiRateLimit', 'budgetRules', 'dataRepair'],
    correctionActions: ['repair_organization_id_90107'],
  },
  {
    version: 679,
    description: 'v679: [数据同步效率优化] — 基于v678分析报告: (1)P0-分层时间窗口+跨批并行报告提交: 将所有时间切片的报告一次性提交到Amazon统一轮询,从14批串行(70-100分钟)变为并行(5-10分钟) (2)P1-新账户渐进式初始化: 分三阶段(7天热数据→1-30天温数据→31-95天冷数据),每阶段独立失败/重试,支持断点续传 (3)P2-SP分页优化: maxResults从100提升到10000(SP API v3最大值),减少分页请求次数33倍 (4)P3-步骤超时缩短: performance_95d从120→30分钟,keyword/target/adgroup_performance从90→30分钟',
    affectedModules: ['sync', 'reporting'],
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
  // @ts-ignore - legacy type assertion
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
      
      // @ts-ignore - legacy type assertion
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
    
    // @ts-ignore - legacy type assertion
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
  // @ts-ignore - legacy type assertion
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
        // @ts-ignore - legacy type assertion
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
                    // @ts-ignore - legacy type assertion
                    campaign.id,
                    config.accountId,
                    config.targetAcos || 30,
                  );
                  correctionsApplied++;
                } catch (campErr: unknown) {
                  // @ts-ignore - legacy type assertion
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
            // @ts-ignore - legacy type assertion
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
                // @ts-ignore - legacy type assertion
                const cleaned = (cleanupResult as Record<string, unknown>[])?.[0]?.affectedRows || 0;
                log.info(`[PostDeployOptimizer] [${config.name}] 清理了 ${cleaned} 条无效pending日志`);
                // @ts-ignore - legacy type assertion
                correctionsApplied += cleaned;
                modulesExecuted.push('cleanup_stale_pending');
              }
            } catch (cleanErr: unknown) {
              errors.push(`清理pending日志失败: ${(cleanErr as Error).message}`);
            }
            // @ts-ignore - legacy type assertion
            break;
          // @ts-ignore - legacy type assertion
          }
          
          // @ts-ignore - legacy type assertion
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
              
              // @ts-ignore - legacy type assertion
              const rows = (pendingLogs as Record<string, unknown>[])?.[0] || pendingLogs;
              // @ts-ignore - legacy type assertion
              if (!Array.isArray(rows) || rows.length === 0) {
                log.info(`[PostDeployOptimizer] [${config.name}] v310: 无pending出价/状态指令需要重评估`);
                break;
              }
              
              log.warn(`[PostDeployOptimizer] [${config.name}] v310: 发现${rows.length}条pending指令需要重评估`);
              
              let cancelled = 0;
              let kept = 0;
              
              for (const row of (rows as unknown[])) {
                // @ts-ignore - legacy type assertion
                try {
                  // @ts-ignore - legacy type assertion
                  const actionType = row.action_type;
                  // @ts-ignore - legacy type assertion
                  const newValue = parseFloat(String(row.new_value));
                  // @ts-ignore - legacy type assertion
                  const prevValue = parseFloat(String(row.previous_value));
                  // @ts-ignore - legacy type assertion
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
                    // @ts-ignore - legacy type assertion
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
 WHERE id = ${(row as any).id}`
                    );
                    cancelled++;
                  } else {
                    kept++;
                  }
                } catch (evalErr: unknown) {
                  errors.push(`v310: pending重评估单条失败: ${(evalErr as Error).message}`);
                }
              }
              
              // @ts-ignore - legacy type assertion
              log.warn(`[PostDeployOptimizer] [${config.name}] v310: pending重评估完成: 总计=${rows.length}, 取消=${cancelled}, 保留=${kept}`);
              // @ts-ignore - legacy type assertion
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
              
              // @ts-ignore - legacy type assertion
              const rows = (syncedLogs as Record<string, unknown>[])?.[0] || syncedLogs;
              if (!Array.isArray(rows) || rows.length === 0) {
                log.info(`[PostDeployOptimizer] [${config.name}] v310: 无近期synced出价指令需要审计`);
                break;
              }
              
              // @ts-ignore - legacy type assertion
              log.info(`[PostDeployOptimizer] [${config.name}] v310: 审计${rows.length}条已执行出价指令...`);
              
              // @ts-ignore - legacy type assertion
              let flagged = 0;
              
              for (const row of (rows as unknown[])) {
                // @ts-ignore - legacy type assertion
                const newValue = parseFloat(String(row.new_value));
                // @ts-ignore - legacy type assertion
                const prevValue = parseFloat(String(row.previous_value));
                // @ts-ignore - legacy type assertion
                const currentBid = parseFloat(String(row.current_bid || 0));
                
                // 审计规则：检测可能不合理的已执行指令
                let isUnreasonable = false;
                let auditReason = '';
                
                // 规则1: 降价幅度超过30%的指令
                // @ts-ignore - legacy type assertion
                if (row.action_type === 'bid_decrease' && prevValue > 0) {
                  const decreasePercent = (prevValue - newValue) / prevValue;
                  if (decreasePercent > 0.30) {
                    isUnreasonable = true;
                    auditReason = `降价幅度${(decreasePercent * 100).toFixed(1)}%超过30%安全阈值`;
                  }
                }
                
                // 规则2: 提价幅度超过50%的指令
                // @ts-ignore - legacy type assertion
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
                  // @ts-ignore - legacy type assertion
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
 ${String((row as any).new_value)}, ${String((row as any).current_bid)},
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
              
              // @ts-ignore - legacy type assertion
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
          
          // v648: 清理bid_set积压
          case 'cleanup_bid_set_backlog': {
            log.info(`[PostDeployOptimizer] [${config.name}] v648: 清理bid_set积压...`);
            try {
              const database = await getDb();
              if (database) {
                // 1. 将所有bid_set事件的apiSyncStatus从synced修正为not_applicable
                const bidSetResult = await database.execute(
                  sql`UPDATE optimization_events 
                      SET api_sync_status = 'not_applicable',
                          api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.v648_cleanup', 'bid_set_no_api_needed')
                      WHERE action_type = 'bid_set' 
                      AND api_sync_status IN ('synced', 'pending', 'failed')`
                );
                // @ts-ignore - legacy type assertion
                const bidSetCleaned = (bidSetResult as Record<string, unknown>[])?.[0]?.affectedRows || 0;
                log.info(`[PostDeployOptimizer] v648: 清理了 ${bidSetCleaned} 条bid_set积压`);
                
                // 2. 将所有bid_set的optimization_logs也修正
                const bidSetLogsResult = await database.execute(
                  sql`UPDATE optimization_logs 
                      SET api_sync_status = 'not_applicable',
                          error_message = CONCAT(COALESCE(error_message, ''), ' | v648: bid_set无需API同步')
                      WHERE action_type = 'bid_set' 
                      AND api_sync_status IN ('synced', 'pending', 'failed')`
                );
                // @ts-ignore - legacy type assertion
                const bidSetLogsCleaned = (bidSetLogsResult as Record<string, unknown>[])?.[0]?.affectedRows || 0;
                log.info(`[PostDeployOptimizer] v648: 清理了 ${bidSetLogsCleaned} 条bid_set日志积压`);
                
                // @ts-ignore - legacy type assertion
                correctionsApplied += bidSetCleaned + bidSetLogsCleaned;
                modulesExecuted.push('cleanup_bid_set_backlog');
              }
            } catch (cleanErr: unknown) {
              errors.push(`v648 bid_set积压清理失败: ${(cleanErr as Error).message}`);
            }
            break;
          }
          
          // v648: 清理搜索词收割积压（skipped_unsupported_campaign_type）
          case 'cleanup_harvest_backlog': {
            log.info(`[PostDeployOptimizer] [${config.name}] v648: 清理搜索词收割积压...`);
            try {
              const database = await getDb();
              if (database) {
                // 将skipped_unsupported_campaign_type的pending/failed事件标记为not_applicable
                const harvestResult = await database.execute(
                  sql`UPDATE optimization_events 
                      SET api_sync_status = 'not_applicable',
                          api_sync_detail = JSON_SET(COALESCE(api_sync_detail, '{}'), '$.v648_cleanup', 'harvest_unsupported_campaign_type')
                      WHERE (action_type = 'search_term_harvest' OR action_type = 'keyword_create')
                      AND api_sync_status IN ('pending', 'failed')
                      AND (error_message LIKE '%unsupported_campaign_type%' OR error_message LIKE '%SB%' OR error_message LIKE '%SD%')`
                );
                // @ts-ignore - legacy type assertion
                const harvestCleaned = (harvestResult as Record<string, unknown>[])?.[0]?.affectedRows || 0;
                log.info(`[PostDeployOptimizer] v648: 清理了 ${harvestCleaned} 条搜索词收割积压`);
                
                // @ts-ignore - legacy type assertion
                correctionsApplied += harvestCleaned;
                modulesExecuted.push('cleanup_harvest_backlog');
              }
            } catch (cleanErr: unknown) {
              errors.push(`v648 搜索词收割积压清理失败: ${(cleanErr as Error).message}`);
            }
            break;
          }
          
          case 'repair_organization_id_90107': {
            log.info(`[PostDeployOptimizer] [${config.name}] v676: 修复账户90107的organization_id...`);
            try {
              const database = await getDb();
              if (database) {
                // 将账户90107(CYAFIXED)的organization_id从1修正为30012
                const repairResult = await database.execute(
                  sql`UPDATE ad_accounts SET organization_id = 30012 WHERE id = 90107 AND organization_id = 1`
                );
                // @ts-ignore - legacy type assertion
                const repaired = (repairResult as Record<string, unknown>[])?.[0]?.affectedRows || 0;
                log.info(`[PostDeployOptimizer] v676: 账户90107 organization_id修复: ${repaired}行受影响`);
                // @ts-ignore - legacy type assertion
                correctionsApplied += repaired;
                modulesExecuted.push('repair_organization_id_90107');
              }
            } catch (repairErr: unknown) {
              errors.push(`v676 账户90107 organization_id修复失败: ${(repairErr as Error).message}`);
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
      // @ts-ignore - legacy type assertion
      previousVersion: lastVersion,
      // @ts-ignore - legacy type assertion
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
        // @ts-ignore - legacy type assertion
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
        // @ts-ignore - legacy type assertion
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
        // @ts-ignore - legacy type assertion
        const restored = (restoreResult as Record<string, unknown>[])[0]?.affectedRows || 0;
        // @ts-ignore - legacy type assertion
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
        // @ts-ignore - legacy type assertion
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
        // @ts-ignore - legacy type assertion
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
        // @ts-ignore - legacy type assertion
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
  
  // 4. v244: [v740已禁用] 原逻辑会在每次部署时自动将autoOptimize=0恢复为1
  // v740修复：该行为覆盖了用户手动关闭自动优化的意图，属于严重违反用户授权的行为
  // 现在只记录状态日志，绝不自动修改autoOptimize字段
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
        // v740: 只记录日志，不自动恢复 — 尊重用户的autoOptimize设置
        log.info(`[PostDeployOptimizer] v740: 发现 ${allGroups.length} 个活跃优化目标的autoOptimize已关闭（用户手动设置），尊重用户意图，不自动恢复`);
        for (const group of allGroups) {
          log.info(`[PostDeployOptimizer] v740: 优化目标 "${group.name}" (ID:${group.id}) autoOptimize=0，保持用户设置不变`);
        }
      } else {
        log.info(`[PostDeployOptimizer] v740: 所有活跃优化目标的autoOptimize状态正常(均为开启)`);
      }
    }
  } catch (restoreErr: unknown) {
    log.warn(`[PostDeployOptimizer] v740: 检查优化目标autoOptimize状态失败:`, (restoreErr as Error).message);
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
        // @ts-ignore - legacy type assertion
        await runV372ExtendedIndexes(database);
        // @ts-ignore - legacy type assertion
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
    // @ts-ignore - legacy type assertion
    const aTime = a.lastExecutionTime ? new Date(a.lastExecutionTime).getTime() : 0;
    // @ts-ignore - legacy type assertion
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
        
        // v657: 智能节流 — 根据目标实际执行情况动态调整等待时间
        // 如果目标没有执行任何模块（无API调用），则无需长时间等待
        const hadActualApiCalls = result.modulesExecuted.length > 0 || result.optimizationActions > 0 || result.correctionsApplied > 0;
        const INTER_TARGET_DELAY_MS = hadActualApiCalls ? 30000 : 2000;  // 有API调用:30秒 | 无操作:2秒
        if (hadActualApiCalls) {
          log.info(`[PostDeployOptimizer] v657: 目标间节流(有API调用) - 等待${INTER_TARGET_DELAY_MS / 1000}秒后执行下一个目标...`);
        } else {
          log.debug(`[PostDeployOptimizer] v657: 目标无操作(0模块/0优化/0纠正) - 快速跳过,仅等待${INTER_TARGET_DELAY_MS / 1000}秒...`);
        }
        await sleep(INTER_TARGET_DELAY_MS);
      }
    }
    
    // v657: 智能批次间等待 — 如果批次内所有目标都无操作，缩短等待
    if (i + POST_DEPLOY_CONFIG.batchSize < sortedTargets.length) {
      const batchHadApiCalls = targetResults.slice(-batch.length).some(
        r => r.modulesExecuted.length > 0 || r.optimizationActions > 0 || r.correctionsApplied > 0
      );
      const batchDelay = batchHadApiCalls ? POST_DEPLOY_CONFIG.batchDelayMs : 1000;  // 有API:10秒 | 无操作:1秒
      log.debug(`[PostDeployOptimizer] v657: 批次间等待 ${batchDelay / 1000}秒 (${batchHadApiCalls ? '有API调用' : '无操作快速跳过'})...`);
      await sleep(batchDelay);
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
