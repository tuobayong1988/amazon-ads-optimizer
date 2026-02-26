/**
 * 系统版本常量
 * 
 * 从 postDeployOptimizer.ts 中提取的独立模块。
 * 提取目的：打破 deployLifecycleManager -> postDeployOptimizer 的循环依赖。
 * deployLifecycleManager 只需要 SYSTEM_VERSION 常量，不需要依赖整个 postDeployOptimizer。
 */

export const SYSTEM_VERSION = 254;  // v254: 趋势感知优化 - 规则引擎引入近期表现趋势因子，避免误杀正在好转的关键词
