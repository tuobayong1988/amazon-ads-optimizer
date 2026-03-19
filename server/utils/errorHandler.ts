/**
 * v362: 统一错误处理模块
 * 
 * 提供标准化的错误处理范式，替代空catch块和静默忽略错误的做法。
 * 
 * 设计原则：
 * 1. 所有错误必须被记录，不允许静默忽略
 * 2. 区分可恢复错误和不可恢复错误
 * 3. 提供上下文信息，便于问题排查
 * 4. 支持错误分类和统计
 */

import { createModuleLogger } from './logger';

const log = createModuleLogger('ErrorHandler');

// ============================================================
// 错误分类
// ============================================================

export enum ErrorCategory {
  /** 数据库连接或查询错误 */
  DATABASE = 'database',
  /** Amazon API调用错误 */
  AMAZON_API = 'amazon_api',
  /** API限流错误 */
  RATE_LIMIT = 'rate_limit',
  /** 数据验证错误 */
  VALIDATION = 'validation',
  /** 业务逻辑错误 */
  BUSINESS_LOGIC = 'business_logic',
  /** 网络错误 */
  NETWORK = 'network',
  /** 认证/授权错误 */
  AUTH = 'auth',
  /** 配置错误 */
  CONFIG = 'config',
  /** 未知错误 */
  UNKNOWN = 'unknown',
}

export enum ErrorSeverity {
  /** 可忽略 - 不影响业务流程 */
  LOW = 'low',
  /** 中等 - 部分功能受影响但可继续 */
  MEDIUM = 'medium',
  /** 高 - 核心功能受影响 */
  HIGH = 'high',
  /** 致命 - 系统无法继续运行 */
  CRITICAL = 'critical',
}

// ============================================================
// 错误上下文
// ============================================================

export interface ErrorContext {
  /** 模块名称 */
  module: string;
  /** 操作名称 */
  operation: string;
  /** 相关实体ID */
  entityId?: number | string;
  /** 相关账号ID */
  accountId?: number;
  /** 额外上下文数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================
// 错误统计
// ============================================================

interface ErrorStats {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  recentErrors: Array<{
    timestamp: Date;
    category: ErrorCategory;
    message: string;
    module: string;
  }>;
}

const errorStats: ErrorStats = {
  total: 0,
  byCategory: {},
  bySeverity: {},
  recentErrors: [],
};

const MAX_RECENT_ERRORS = 100;

// ============================================================
// 核心错误处理函数
// ============================================================

/**
 * 统一错误处理入口
 * 
 * @param error - 捕获的错误对象
 * @param context - 错误上下文信息
 * @param options - 处理选项
 * @returns 格式化的错误信息
 */
export function handleError(
  error: unknown,
  context: ErrorContext,
  options?: {
    severity?: ErrorSeverity;
    category?: ErrorCategory;
    rethrow?: boolean;
    silent?: boolean;
  }
): string {
  const err = normalizeError(error);
  const category = options?.category || classifyError(err);
  const severity = options?.severity || inferSeverity(category);
  
  const errorMessage = formatErrorMessage(err, context, category);
  
  // 记录统计
  recordErrorStats(category, severity, err.message, context.module);
  
  // 根据严重程度选择日志级别
  if (!options?.silent) {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        log.error(`[CRITICAL] ${errorMessage}`);
        break;
      case ErrorSeverity.HIGH:
        log.error(`${errorMessage}`);
        break;
      case ErrorSeverity.MEDIUM:
        log.warn(`${errorMessage}`);
        break;
      case ErrorSeverity.LOW:
        log.debug(`${errorMessage}`);
        break;
    }
  }
  
  // 是否重新抛出
  if (options?.rethrow) {
    throw err;
  }
  
  return errorMessage;
}

/**
 * 安全执行异步操作，自动处理错误
 * 
 * @param fn - 要执行的异步函数
 * @param context - 错误上下文
 * @param options - 处理选项
 * @returns 执行结果或默认值
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  context: ErrorContext,
  options?: {
    defaultValue?: T;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    retries?: number;
    retryDelayMs?: number;
  }
): Promise<T | undefined> {
  const maxRetries = options?.retries || 0;
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = (options?.retryDelayMs || 1000) * Math.pow(2, attempt);
        log.warn(`[${context.module}] ${context.operation} 失败 (尝试 ${attempt + 1}/${maxRetries + 1}), ${delay}ms后重试`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  handleError(lastError, context, {
    category: options?.category,
    severity: options?.severity,
  });
  
  return options?.defaultValue;
}

/**
 * 安全执行同步操作
 */
export function safeExecuteSync<T>(
  fn: () => T,
  context: ErrorContext,
  defaultValue?: T
): T | undefined {
  try {
    return fn();
  } catch (error) {
    handleError(error, context, { severity: ErrorSeverity.LOW });
    return defaultValue;
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 将未知错误标准化为Error对象
 */
function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  if (typeof error === 'object' && error !== null) {
    const msg = (error as Record<string, unknown>).message || (error as Record<string, unknown>).msg || JSON.stringify(error);
    return new Error(msg);
  }
  return new Error(String(error));
}

/**
 * 自动分类错误
 */
function classifyError(error: Error): ErrorCategory {
  const msg = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  
  // 数据库错误
  if (msg.includes('econnrefused') && (msg.includes('3306') || msg.includes('mysql'))) return ErrorCategory.DATABASE;
  if (msg.includes('deadlock') || msg.includes('lock wait timeout')) return ErrorCategory.DATABASE;
  if (msg.includes('too many connections')) return ErrorCategory.DATABASE;
  if (msg.includes('er_') || name.includes('queryerror')) return ErrorCategory.DATABASE;
  
  // API限流
  if (msg.includes('throttl') || msg.includes('rate limit') || msg.includes('429')) return ErrorCategory.RATE_LIMIT;
  if (msg.includes('too many requests')) return ErrorCategory.RATE_LIMIT;
  
  // Amazon API错误
  if (msg.includes('amazon') || msg.includes('advertising-api')) return ErrorCategory.AMAZON_API;
  if (msg.includes('access denied') && msg.includes('api')) return ErrorCategory.AMAZON_API;
  
  // 认证错误
  if (msg.includes('unauthorized') || msg.includes('401') || msg.includes('403')) return ErrorCategory.AUTH;
  if (msg.includes('token expired') || msg.includes('invalid token')) return ErrorCategory.AUTH;
  
  // 网络错误
  if (msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('enotfound')) return ErrorCategory.NETWORK;
  if (msg.includes('socket hang up') || msg.includes('network')) return ErrorCategory.NETWORK;
  
  // 验证错误
  if (msg.includes('validation') || msg.includes('invalid') || msg.includes('required')) return ErrorCategory.VALIDATION;
  
  return ErrorCategory.UNKNOWN;
}

/**
 * 根据错误分类推断严重程度
 */
function inferSeverity(category: ErrorCategory): ErrorSeverity {
  switch (category) {
    case ErrorCategory.DATABASE:
      return ErrorSeverity.HIGH;
    case ErrorCategory.RATE_LIMIT:
      return ErrorSeverity.MEDIUM;
    case ErrorCategory.AMAZON_API:
      return ErrorSeverity.MEDIUM;
    case ErrorCategory.AUTH:
      return ErrorSeverity.HIGH;
    case ErrorCategory.NETWORK:
      return ErrorSeverity.MEDIUM;
    case ErrorCategory.VALIDATION:
      return ErrorSeverity.LOW;
    case ErrorCategory.BUSINESS_LOGIC:
      return ErrorSeverity.MEDIUM;
    case ErrorCategory.CONFIG:
      return ErrorSeverity.HIGH;
    default:
      return ErrorSeverity.MEDIUM;
  }
}

/**
 * 格式化错误消息
 */
function formatErrorMessage(error: Error, context: ErrorContext, category: ErrorCategory): string {
  const parts = [
    `[${context.module}]`,
    `${context.operation}失败`,
    `[${category}]`,
    error.message,
  ];
  
  if (context.entityId) parts.push(`entityId=${context.entityId}`);
  if (context.accountId) parts.push(`accountId=${context.accountId}`);
  
  return parts.join(' | ');
}

/**
 * 记录错误统计
 */
function recordErrorStats(
  category: ErrorCategory,
  severity: ErrorSeverity,
  message: string,
  module: string
) {
  errorStats.total++;
  errorStats.byCategory[category] = (errorStats.byCategory[category] || 0) + 1;
  errorStats.bySeverity[severity] = (errorStats.bySeverity[severity] || 0) + 1;
  
  errorStats.recentErrors.push({
    timestamp: new Date(),
    category,
    message: message.substring(0, 200),
    module,
  });
  
  // 保持最近错误列表大小
  if (errorStats.recentErrors.length > MAX_RECENT_ERRORS) {
    errorStats.recentErrors = errorStats.recentErrors.slice(-MAX_RECENT_ERRORS);
  }
}

/**
 * 获取错误统计信息
 */
export function getErrorStats(): ErrorStats {
  return { ...errorStats };
}

/**
 * 重置错误统计（用于测试）
 */
export function resetErrorStats(): void {
  errorStats.total = 0;
  errorStats.byCategory = {};
  errorStats.bySeverity = {};
  errorStats.recentErrors = [];
}
