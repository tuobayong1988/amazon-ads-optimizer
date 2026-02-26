/**
 * 系统版本常量
 * 
 * 从 postDeployOptimizer.ts 中提取的独立模块。
 * 提取目的：打破 deployLifecycleManager -> postDeployOptimizer 的循环依赖。
 * deployLifecycleManager 只需要 SYSTEM_VERSION 常量，不需要依赖整个 postDeployOptimizer。
 */

export const SYSTEM_VERSION = 258;  // v258: ACoS死亡螺旋根治(归因延迟+熔断+多维度决策) + 高级算法激活(零门槛UCB+强制探索) + 统一出价仲裁 + 日志可读性增强
