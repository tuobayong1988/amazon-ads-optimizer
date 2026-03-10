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

export const SYSTEM_VERSION = 389;  // v389: EB实例升级t3.small→t3.medium(4GB)、Node.js内存限制3072MB、DB连接池40、SD否定定位同步注册、纠错监控验证通过
