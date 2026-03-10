/**
 * v393: 系统配置服务
 * 
 * 统一管理系统级配置，消除硬编码值。
 * 通过 v8.getHeapStatistics() 动态获取 Node.js 堆内存上限，
 * 替代之前硬编码的 1400MB，确保在不同实例类型下内存管理正确。
 */
import v8 from 'v8';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('SystemConfig');

/**
 * 动态获取 Node.js 堆内存上限（MB）
 * 通过 v8.getHeapStatistics().heap_size_limit 获取真实的 --max-old-space-size 值
 */
function getHeapSizeLimitMB(): number {
  const stats = v8.getHeapStatistics();
  return Math.round(stats.heap_size_limit / 1024 / 1024);
}

// 在模块加载时读取一次，避免频繁调用 v8 API
const HEAP_SIZE_LIMIT_MB = getHeapSizeLimitMB();

/**
 * 系统内存配置
 * 所有内存相关的阈值都基于实际的堆内存上限动态计算
 */
export const memoryConfig = {
  /** Node.js 堆内存上限（MB），来自 --max-old-space-size */
  heapSizeLimitMB: HEAP_SIZE_LIMIT_MB,

  /** 堆内存健康阈值（MB）：低于此值认为内存健康 */
  heapHealthyThresholdMB: Math.round(HEAP_SIZE_LIMIT_MB * 0.80),

  /** 堆内存保护触发阈值（百分比）：超过此值触发GC */
  heapProtectionPercent: 85,

  /** RSS 内存危急阈值（MB）：超过此值跳过所有任务 */
  rssCriticalMB: Math.round(HEAP_SIZE_LIMIT_MB * 1.05),

  /** RSS 内存警告阈值（MB）：超过此值跳过非关键任务 */
  rssWarningMB: Math.round(HEAP_SIZE_LIMIT_MB * 0.80),
};

/**
 * 计算堆内存使用率（百分比）
 * 使用真实的堆内存上限，而非硬编码值
 */
export function calculateHeapUtilization(heapUsedBytes: number): number {
  return Math.round((heapUsedBytes / (HEAP_SIZE_LIMIT_MB * 1024 * 1024)) * 100);
}

/**
 * 检查堆内存是否健康
 */
export function isHeapHealthy(heapUsedMB: number): boolean {
  return heapUsedMB < memoryConfig.heapHealthyThresholdMB;
}

// 启动时输出配置信息
log.info(`[SystemConfig] v393 内存配置已初始化:` +
  ` heapSizeLimit=${HEAP_SIZE_LIMIT_MB}MB,` +
  ` heapHealthy<${memoryConfig.heapHealthyThresholdMB}MB,` +
  ` rssWarning>${memoryConfig.rssWarningMB}MB,` +
  ` rssCritical>${memoryConfig.rssCriticalMB}MB`);
