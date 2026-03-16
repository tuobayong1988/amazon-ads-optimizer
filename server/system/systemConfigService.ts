/**
 * v271 P3-2: 系统配置外部化服务 (System Config Service)
 * 
 * 解决问题：v270中大量关键参数（安全护栏阈值、探索率、融合阈值等）
 * 硬编码在各模块源码中，修改需要重新部署。
 * 
 * 核心设计：
 * 1. 集中管理所有可配置参数
 * 2. 支持运行时热更新（通过API或数据库）
 * 3. 参数分层：系统级 > 账户级 > 策略级
 * 4. 变更审计：记录每次配置变更的操作者和原因
 * 5. 安全边界：每个参数有合法范围约束
 * 
 * 参数分类：
 * - safety: 安全护栏参数（冷却时间、熔断阈值等）
 * - algorithm: 算法参数（探索率、融合阈值等）
 * - execution: 执行参数（并发数、重试次数等）
 * - business: 业务参数（最低出价、最高出价等）
 */

import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('SystemConfig');

// ==================== 类型定义 ====================

export interface ConfigParameter {
  key: string;
  value: number | string | boolean;
  category: 'safety' | 'algorithm' | 'execution' | 'business';
  description: string;
  defaultValue: number | string | boolean;
  /** 数值参数的合法范围 */
  range?: { min: number; max: number };
  /** 最后更新时间 */
  updatedAt: Date;
  /** 更新者 */
  updatedBy: string;
}

export interface ConfigChangeLog {
  key: string;
  previousValue: number | string | boolean;
  newValue: number | string | boolean;
  changedBy: string;
  reason: string;
  timestamp: Date;
}

// ==================== 配置定义 ====================

/**
 * 系统默认配置参数
 * 将原来分散在各模块中的硬编码值集中到此处
 */
const DEFAULT_CONFIG: Record<string, Omit<ConfigParameter, 'updatedAt' | 'updatedBy'>> = {
  // ===== 安全护栏参数 =====
  'safety.cooldown_hours': {
    key: 'safety.cooldown_hours',
    value: 4, // v273: 从6小时降至4小时，提高优化频率避免停滞感
    category: 'safety',
    description: '出价调整冷却时间窗口（小时）',
    defaultValue: 4,
    range: { min: 1, max: 24 },
  },
  'safety.min_adjustment_percent': {
    key: 'safety.min_adjustment_percent',
    value: 0.02,
    category: 'safety',
    description: '最小调整幅度百分比',
    defaultValue: 0.02,
    range: { min: 0.01, max: 0.10 },
  },
  'safety.max_adjustments_per_day': {
    key: 'safety.max_adjustments_per_day',
    value: 4, // v273: 从3次提升至4次，配合冷却期缩短提高优化吸入量
    category: 'safety',
    description: '24小时内最大调整次数',
    defaultValue: 4,
    range: { min: 1, max: 10 },
  },
  'safety.max_cumulative_decrease_7d': {
    key: 'safety.max_cumulative_decrease_7d',
    value: 0.20,
    category: 'safety',
    description: '7天内累计降价幅度上限',
    defaultValue: 0.20,
    range: { min: 0.10, max: 0.50 },
  },
  'safety.max_consecutive_decreases': {
    key: 'safety.max_consecutive_decreases',
    value: 2,
    category: 'safety',
    description: '连续降价次数上限',
    defaultValue: 2,
    range: { min: 1, max: 5 },
  },
  'safety.min_bid_floor_ratio': {
    key: 'safety.min_bid_floor_ratio',
    value: 0.50,
    category: 'safety',
    description: '最低出价保护比例（相对初始出价）',
    defaultValue: 0.50,
    range: { min: 0.30, max: 0.80 },
  },
  'safety.recovery_boost_percent': {
    key: 'safety.recovery_boost_percent',
    value: 0.15,
    category: 'safety',
    description: '熔断触发时的提价恢复比例',
    defaultValue: 0.15,
    range: { min: 0.05, max: 0.30 },
  },
  'safety.max_bid_change_percent': {
    key: 'safety.max_bid_change_percent',
    value: 0.20,
    category: 'safety',
    description: '单次最大出价变化幅度',
    defaultValue: 0.20,
    range: { min: 0.05, max: 0.50 },
  },
  
  // ===== 算法参数 =====
  'algorithm.fusion_threshold': {
    key: 'algorithm.fusion_threshold',
    value: 0.15,
    category: 'algorithm',
    description: 'Cascade Ensemble融合阈值（分差百分比）',
    defaultValue: 0.15,
    range: { min: 0.05, max: 0.30 },
  },
  'algorithm.exploration_rate_min': {
    key: 'algorithm.exploration_rate_min',
    value: 0.30,
    category: 'algorithm',
    description: '探索率下限',
    defaultValue: 0.30,
    range: { min: 0.10, max: 0.50 },
  },
  'algorithm.exploration_rate_max': {
    key: 'algorithm.exploration_rate_max',
    value: 0.65,
    category: 'algorithm',
    description: '探索率上限',
    defaultValue: 0.65,
    range: { min: 0.30, max: 0.80 },
  },
  'algorithm.ucb_epsilon': {
    key: 'algorithm.ucb_epsilon',
    value: 0.20,
    category: 'algorithm',
    description: 'UCB探索的epsilon参数',
    defaultValue: 0.20,
    range: { min: 0.05, max: 0.40 },
  },
  'algorithm.confidence_threshold_ensemble': {
    key: 'algorithm.confidence_threshold_ensemble',
    value: 0.35,
    category: 'algorithm',
    description: '融合算法的置信度门槛',
    defaultValue: 0.35,
    range: { min: 0.20, max: 0.60 },
  },
  'algorithm.weight_learning_rate': {
    key: 'algorithm.weight_learning_rate',
    value: 0.02,
    category: 'algorithm',
    description: '权重自学习的学习率',
    defaultValue: 0.02,
    range: { min: 0.005, max: 0.10 },
  },
  
  // ===== 执行参数 =====
  'execution.api_retry_count': {
    key: 'execution.api_retry_count',
    value: 3,
    category: 'execution',
    description: 'Amazon API调用重试次数',
    defaultValue: 3,
    range: { min: 1, max: 5 },
  },
  'execution.api_retry_delay_ms': {
    key: 'execution.api_retry_delay_ms',
    value: 2000,
    category: 'execution',
    description: 'API重试间隔（毫秒）',
    defaultValue: 2000,
    range: { min: 500, max: 10000 },
  },
  'execution.batch_size': {
    key: 'execution.batch_size',
    value: 50,
    category: 'execution',
    description: '批量操作的批次大小',
    defaultValue: 50,
    range: { min: 10, max: 200 },
  },
  'execution.concurrent_accounts': {
    key: 'execution.concurrent_accounts',
    value: 3,
    category: 'execution',
    description: '并发处理的账户数',
    defaultValue: 3,
    range: { min: 1, max: 10 },
  },
  
  // ===== 业务参数 =====
  'business.default_target_acos': {
    key: 'business.default_target_acos',
    value: 0.30,
    category: 'business',
    description: '默认目标ACoS',
    defaultValue: 0.30,
    range: { min: 0.05, max: 1.00 },
  },
  'business.min_bid': {
    key: 'business.min_bid',
    value: 0.02,
    category: 'business',
    description: '最低出价（美元）',
    defaultValue: 0.02,
    range: { min: 0.01, max: 0.10 },
  },
  'business.max_bid': {
    key: 'business.max_bid',
    value: 100.00,
    category: 'business',
    description: '最高出价（美元）',
    defaultValue: 100.00,
    range: { min: 10.00, max: 500.00 },
  },
  'business.default_profit_margin': {
    key: 'business.default_profit_margin',
    value: 0.30,
    category: 'business',
    description: '默认利润率',
    defaultValue: 0.30,
    range: { min: 0.05, max: 0.80 },
  },
};

// ==================== 运行时状态 ====================

/** 运行时配置（内存缓存，支持热更新） */
const runtimeConfig: Map<string, ConfigParameter> = new Map();

/** 配置变更日志 */
const changeLogs: ConfigChangeLog[] = [];
const MAX_CHANGE_LOGS = 200; // v329: 限制变更日志数量，防止无限增长

// 初始化运行时配置
function initializeConfig(): void {
  for (const [key, def] of Object.entries(DEFAULT_CONFIG)) {
    runtimeConfig.set(key, {
      ...def,
      updatedAt: new Date(),
      updatedBy: 'system_init',
    });
  }
}

// 自动初始化
initializeConfig();

// ==================== 核心函数 ====================

/**
 * 获取配置参数值
 */
export function getConfig<T = number>(key: string): T {
  const param = runtimeConfig.get(key);
  if (param) {
    return param.value as T;
  }
  const def = DEFAULT_CONFIG[key];
  if (def) {
    return def.defaultValue as T;
  }
  throw new Error(`[SystemConfig] 未知配置参数: ${key}`);
}

/**
 * 获取配置参数的完整信息
 */
export function getConfigDetail(key: string): ConfigParameter | undefined {
  return runtimeConfig.get(key);
}

/**
 * 更新配置参数
 */
export function updateConfig(
  key: string,
  value: number | string | boolean,
  updatedBy: string = 'system',
  reason: string = ''
): boolean {
  const param = runtimeConfig.get(key);
  if (!param) {
    log.warn(`[SystemConfig] 尝试更新未知参数: ${key}`);
    return false;
  }

  // 范围检查
  if (param.range && typeof value === 'number') {
    if (value < param.range.min || value > param.range.max) {
      log.warn(`[SystemConfig] 参数${key}的值${value}超出合法范围[${param.range.min}, ${param.range.max}]`);
      return false;
    }
  }

  // 记录变更日志
  changeLogs.push({
    key,
    previousValue: param.value,
    newValue: value,
    changedBy: updatedBy,
    reason,
    timestamp: new Date(),
  });
  // v329: 限制变更日志数量
  while (changeLogs.length > MAX_CHANGE_LOGS) changeLogs.shift();

  // 更新值
  param.value = value;
  param.updatedAt = new Date();
  param.updatedBy = updatedBy;

  log.info(`[SystemConfig] 参数更新: ${key} = ${value} (by ${updatedBy}, reason: ${reason})`);
  return true;
}

/**
 * 批量更新配置
 */
export function batchUpdateConfig(
  updates: Array<{ key: string; value: number | string | boolean }>,
  updatedBy: string = 'system',
  reason: string = ''
): { success: number; failed: number; errors: string[] } {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const update of updates) {
    if (updateConfig(update.key, update.value, updatedBy, reason)) {
      success++;
    } else {
      failed++;
      errors.push(`参数${update.key}更新失败`);
    }
  }

  return { success, failed, errors };
}

/**
 * 重置参数到默认值
 */
export function resetConfig(key: string, resetBy: string = 'system'): boolean {
  const def = DEFAULT_CONFIG[key];
  if (!def) return false;

  return updateConfig(key, def.defaultValue, resetBy, '重置为默认值');
}

/**
 * 重置所有参数到默认值
 */
export function resetAllConfig(resetBy: string = 'system'): void {
  initializeConfig();
  changeLogs.push({
    key: '*',
    previousValue: 'all',
    newValue: 'defaults',
    changedBy: resetBy,
    reason: '重置所有参数为默认值',
    timestamp: new Date(),
  });
  // v329: 限制变更日志数量
  while (changeLogs.length > MAX_CHANGE_LOGS) changeLogs.shift();
}

/**
 * 获取所有配置参数
 */
export function getAllConfig(category?: string): ConfigParameter[] {
  const all = Array.from(runtimeConfig.values());
  if (category) {
    return all.filter(p => p.category === category);
  }
  return all;
}

/**
 * 获取配置变更日志
 */
export function getChangeLog(limit: number = 100): ConfigChangeLog[] {
  return changeLogs.slice(-limit);
}

/**
 * 导出当前配置为JSON（用于备份）
 */
export function exportConfig(): Record<string, number | string | boolean> {
  const exported: Record<string, number | string | boolean> = {};
  for (const [key, param] of runtimeConfig) {
    exported[key] = param.value;
  }
  return exported;
}

/**
 * 从JSON导入配置（用于恢复）
 */
export function importConfig(
  config: Record<string, number | string | boolean>,
  importedBy: string = 'system'
): { success: number; failed: number } {
  let success = 0;
  let failed = 0;

  for (const [key, value] of Object.entries(config)) {
    if (updateConfig(key, value, importedBy, '从备份导入')) {
      success++;
    } else {
      failed++;
    }
  }

  return { success, failed };
}
