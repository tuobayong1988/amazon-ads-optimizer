/**
 * 系统版本常量
 * 
 * 从 postDeployOptimizer.ts 中提取的独立模块。
 * 提取目的：打破 deployLifecycleManager -> postDeployOptimizer 的循环依赖。
 * deployLifecycleManager 只需要 SYSTEM_VERSION 常量，不需要依赖整个 postDeployOptimizer。
 */

export const SYSTEM_VERSION = 257;  // v257: 出价振荡根治 + 三通道RL回填 + 主动探索策略 + match_type回填 + 纠错关联追踪
