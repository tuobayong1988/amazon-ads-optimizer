/**
 * 系统版本常量
 * 
 * 从 postDeployOptimizer.ts 中提取的独立模块。
 * 提取目的：打破 deployLifecycleManager -> postDeployOptimizer 的循环依赖。
 * deployLifecycleManager 只需要 SYSTEM_VERSION 常量，不需要依赖整个 postDeployOptimizer。
 */

export const SYSTEM_VERSION = 259;  // v259: 提价恢复机制+曝光保护+纠错器时序重构+强制UCB激活+RL回填修复+双向出价+护栏可视化增强
