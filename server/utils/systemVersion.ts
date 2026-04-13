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

export const SYSTEM_VERSION = 663;  // v663: P0-总超时180分钟+清理阈值同步 P1-SB素材URL安全修复+步骤超时30分钟 P2-大账户增量同步+断点续传
