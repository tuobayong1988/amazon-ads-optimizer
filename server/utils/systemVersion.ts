/**
 * 系统版本常量
 * 
 * 从 postDeployOptimizer.ts 中提取的独立模块。
 * 提取目的：打破 deployLifecycleManager -> postDeployOptimizer 的循环依赖。
 * deployLifecycleManager 只需要 SYSTEM_VERSION 常量，不需要依赖整个 postDeployOptimizer。
 */

export const SYSTEM_VERSION = 252;  // v252: 修复RL数据记录粒度Bug + captureStateSnapshot关键词级别数据 + recordBidAction传递campaignId + UI决策上下文增强
