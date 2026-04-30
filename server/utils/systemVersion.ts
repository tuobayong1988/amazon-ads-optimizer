/**
 * 系统版本常量 — 唯一来源 (Single Source of Truth)
 * 
 * v329重构: 所有模块的 SYSTEM_VERSION 统一从此文件获取。
 * 
 * 导入链:
 *   - deployLifecycleManager.ts  → 直接导入此文件 (心跳、生命周期管理)
 *   - postDeployOptimizer.ts     → 直接导入此文件 (部署后重优化)
 *   - _core/index.ts             → 通过 postDeployOptimizer.ts 的 re-export 导入
 *   - routes/ops.ts              → 通过 postDeployOptimizer.ts 的 re-export 导入
 *   - optimizationMonitoringService.ts → 动态导入两者进行一致性校验
 * 
 * 每次发版时，只需修改此文件中的版本号，并在 postDeployOptimizer.ts 的
 * VERSION_CHANGELOG 中添加对应的变更日志条目。
 */
export const SYSTEM_VERSION = 742;  // v742: 三大数据同步阻断性问题修复 — (1)否词同步崩溃: syncSp/syncSb/syncSd onDuplicateKeyUpdate SQL列名映射(amazonNegativeKeywordId→amazon_negative_keyword_id) (2)新账户初始化卡死自愈: collecting状态超时24h自动完成 (3)搜索词停滞: full/nightly层_forceSync=true+移除searchTermSync.ts无效this引用
