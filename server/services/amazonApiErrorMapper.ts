/**
 * v509: Amazon API 错误码统一映射表
 * 
 * 目的: 将 Amazon Ads API 返回的各种错误码统一归类处理，
 * 避免散落在 amazonApiHelper.ts 各分支中的字符串匹配。
 * 
 * 设计原则:
 * 1. 所有 Amazon API 错误码在此文件中统一注册和分类
 * 2. 每种错误码映射到标准化的处理策略（retry, archive, mark_deleted, permanently_fail, skip）
 * 3. 处理策略决定 optimization_tasks 和 optimization_events 的最终状态
 * 4. 新增错误码只需在此文件中添加映射，无需修改业务逻辑
 */

import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('ApiErrorMapper');

// ============================================================
// 错误处理策略定义
// ============================================================

export type ErrorHandlingStrategy = 
  | 'retry'              // 可重试: 暂时性错误，稍后重试
  | 'mark_deleted'       // 标记删除: 实体在Amazon端已不存在
  | 'mark_archived'      // 标记归档: 实体在Amazon端已归档
  | 'permanently_fail'   // 永久失败: 不可恢复的错误
  | 'skip'               // 跳过: 无需处理（如权限不足的广告类型）
  | 'throttle_retry';    // 限流重试: API限流，需要降速重试

export interface ErrorMapping {
  /** 错误码/模式的唯一标识 */
  code: string;
  /** 匹配模式（用于错误消息的模糊匹配） */
  patterns: string[];
  /** 处理策略 */
  strategy: ErrorHandlingStrategy;
  /** optimization_tasks 应设置的状态 */
  taskStatus: 'failed' | 'permanently_failed' | 'synced';
  /** optimization_events 应设置的 api_sync_status */
  eventSyncStatus: 'failed' | 'permanently_failed' | 'synced' | 'not_applicable';
  /** 是否需要标记源实体（keyword/product_target）的状态 */
  markEntityStatus?: 'amazon_deleted' | 'amazon_archived' | null;
  /** 人类可读的错误描述 */
  description: string;
  /** 最大重试次数（仅 retry/throttle_retry 策略有效） */
  maxRetries?: number;
  /** 严重程度 */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================================
// 统一错误码映射表
// ============================================================

const ERROR_MAPPINGS: ErrorMapping[] = [
  // ==================== 实体不存在类 ====================
  {
    code: 'ENTITY_NOT_FOUND',
    patterns: [
      'entitynotfounderror',
      'entity_not_found',
      'could not find',
      'not found',
      'does not exist',
    ],
    strategy: 'mark_deleted',
    taskStatus: 'permanently_failed',
    eventSyncStatus: 'permanently_failed',
    markEntityStatus: 'amazon_deleted',
    description: '实体在Amazon端已不存在（已被删除或从未创建成功）',
    severity: 'medium',
  },
  {
    code: 'ENTITY_STATE_ERROR',
    patterns: [
      'entitystateerror',
      'entity_state_error',
      'archived entity',
      'entity is archived',
    ],
    strategy: 'mark_archived',
    taskStatus: 'permanently_failed',
    eventSyncStatus: 'permanently_failed',
    markEntityStatus: 'amazon_archived',
    description: '实体在Amazon端已归档，无法修改',
    severity: 'medium',
  },
  {
    code: 'KEYWORD_AD_GROUP_NOT_FOUND',
    patterns: [
      'keyword_cannot_find_ad_group',
      'ad group not found',
      'adgroup not found',
      'cannot find ad group',
      'cannot find the adgroup',  // v522: Amazon实际返回的错误消息格式
    ],
    strategy: 'mark_deleted',
    taskStatus: 'permanently_failed',
    eventSyncStatus: 'permanently_failed',
    markEntityStatus: 'amazon_deleted',
    description: '关键词所属的广告组在Amazon端已不存在',
    severity: 'high',
  },
  {
    code: 'CAMPAIGN_NOT_FOUND',
    patterns: [
      'campaign not found',
      'campaign does not exist',
      'invalid campaign',
    ],
    strategy: 'mark_deleted',
    taskStatus: 'permanently_failed',
    eventSyncStatus: 'permanently_failed',
    markEntityStatus: null,
    description: '广告活动在Amazon端已不存在',
    severity: 'high',
  },

  // ==================== 参数错误类 ====================
  {
    code: 'MALFORMED_VALUE',
    patterns: [
      'malformedvalueerror',
      'malformed_value',
      'invalid value',
      'value is not valid',
    ],
    strategy: 'permanently_fail',
    taskStatus: 'permanently_failed',
    eventSyncStatus: 'permanently_failed',
    markEntityStatus: null,
    description: '请求参数值格式错误（如出价超出范围）',
    severity: 'high',
  },
  {
    code: 'INVALID_ARGUMENT',
    patterns: [
      'invalid_argument',
      'invalidargument',
      'bad request',
      'invalid parameter',
    ],
    strategy: 'permanently_fail',
    taskStatus: 'permanently_failed',
    eventSyncStatus: 'permanently_failed',
    markEntityStatus: null,
    description: '请求参数无效',
    severity: 'high',
  },
  {
    code: 'DUPLICATE_VALUE',
    patterns: [
      'duplicatevalueerror',
      'duplicate_value',
      'already exists',
      'duplicate entry',
    ],
    strategy: 'skip',
    taskStatus: 'synced', // 重复意味着已经存在，视为成功
    eventSyncStatus: 'synced',
    markEntityStatus: null,
    description: '实体已存在（重复创建），视为成功',
    severity: 'low',
  },

  // ==================== 限流/服务端错误类 ====================
  {
    code: 'THROTTLED',
    patterns: [
      'too many requests',
      'throttl',
      'rate limit',
      '请求过于频繁',
      'status=429',
    ],
    strategy: 'throttle_retry',
    taskStatus: 'failed',
    eventSyncStatus: 'failed',
    markEntityStatus: null,
    description: 'API限流，需要降速重试',
    maxRetries: 5,
    severity: 'medium',
  },
  {
    code: 'SERVER_ERROR',
    patterns: [
      'internal server error',
      'status=500',
      'status=502',
      'status=503',
      'service unavailable',
      'gateway timeout',
    ],
    strategy: 'retry',
    taskStatus: 'failed',
    eventSyncStatus: 'failed',
    markEntityStatus: null,
    description: 'Amazon服务端错误，可重试',
    maxRetries: 3,
    severity: 'medium',
  },
  {
    code: 'NETWORK_ERROR',
    patterns: [
      'econnreset',
      'etimedout',
      'econnrefused',
      'network error',
      'socket hang up',
    ],
    strategy: 'retry',
    taskStatus: 'failed',
    eventSyncStatus: 'failed',
    markEntityStatus: null,
    description: '网络连接错误，可重试',
    maxRetries: 3,
    severity: 'medium',
  },

  // ==================== 权限/认证类 ====================
  {
    code: 'AUTH_EXPIRED',
    patterns: [
      'status=401',
      'unauthorized',
      'token expired',
      'invalid token',
    ],
    strategy: 'retry',
    taskStatus: 'failed',
    eventSyncStatus: 'failed',
    markEntityStatus: null,
    description: '认证过期，需要刷新Token后重试',
    maxRetries: 2,
    severity: 'high',
  },
  {
    code: 'PERMISSION_DENIED',
    patterns: [
      'status=403',
      'forbidden',
      'permission_denied',
      'access denied',
    ],
    strategy: 'skip',
    taskStatus: 'permanently_failed',
    eventSyncStatus: 'not_applicable',
    markEntityStatus: null,
    description: '权限不足（如账户未开通该广告类型）',
    severity: 'low',
  },

  // ==================== 业务逻辑类 ====================
  {
    code: 'BID_BELOW_MINIMUM',
    patterns: [
      'bid below minimum',
      'minimum bid',
      'bid must be at least',
      'bid too low',
    ],
    strategy: 'permanently_fail',
    taskStatus: 'permanently_failed',
    eventSyncStatus: 'permanently_failed',
    markEntityStatus: null,
    description: '出价低于Amazon最低限制',
    severity: 'medium',
  },
  {
    code: 'BID_ABOVE_MAXIMUM',
    patterns: [
      'bid above maximum',
      'maximum bid',
      'bid must not exceed',
      'bid too high',
    ],
    strategy: 'permanently_fail',
    taskStatus: 'permanently_failed',
    eventSyncStatus: 'permanently_failed',
    markEntityStatus: null,
    description: '出价超过Amazon最高限制',
    severity: 'medium',
  },
  {
    code: 'BUDGET_BELOW_MINIMUM',
    patterns: [
      'budget below minimum',
      'minimum budget',
      'budget must be at least',
    ],
    strategy: 'permanently_fail',
    taskStatus: 'permanently_failed',
    eventSyncStatus: 'permanently_failed',
    markEntityStatus: null,
    description: '预算低于Amazon最低限制',
    severity: 'medium',
  },
];

// ============================================================
// 错误匹配引擎
// ============================================================

/**
 * 根据错误消息匹配最佳的错误映射
 * @param errorMessage 原始错误消息（字符串或JSON）
 * @returns 匹配到的错误映射，未匹配返回默认映射
 */
export function classifyError(errorMessage: string): ErrorMapping {
  const lowerMessage = errorMessage.toLowerCase();
  
  // 尝试解析JSON错误（Amazon API经常返回JSON格式错误）
  let parsedMessage = lowerMessage;
  try {
    const parsed = JSON.parse(errorMessage);
    parsedMessage = JSON.stringify(parsed).toLowerCase();
  } catch {
    // 非JSON格式，使用原始消息
  }
  
  // 按优先级匹配（实体不存在类 > 参数错误类 > 限流类 > 其他）
  for (const mapping of ERROR_MAPPINGS) {
    for (const pattern of mapping.patterns) {
      if (parsedMessage.includes(pattern)) {
        log.debug(`[v509] 错误分类: "${errorMessage.substring(0, 100)}" → ${mapping.code} (${mapping.strategy})`);
        return mapping;
      }
    }
  }
  
  // 默认映射：未知错误，标记为可重试
  log.warn(`[v509] 未知错误类型，使用默认映射: "${errorMessage.substring(0, 200)}"`);
  return {
    code: 'UNKNOWN',
    patterns: [],
    strategy: 'retry',
    taskStatus: 'failed',
    eventSyncStatus: 'failed',
    markEntityStatus: null,
    description: '未知错误，尝试重试',
    maxRetries: 3,
    severity: 'medium',
  };
}

/**
 * 判断错误是否属于"实体不存在"类
 * 用于替代散落在各处的字符串匹配
 */
export function isEntityNotFoundError(errorMessage: string): boolean {
  const mapping = classifyError(errorMessage);
  return mapping.code === 'ENTITY_NOT_FOUND' 
    || mapping.code === 'ENTITY_STATE_ERROR'
    || mapping.code === 'KEYWORD_AD_GROUP_NOT_FOUND'
    || mapping.code === 'CAMPAIGN_NOT_FOUND';
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(errorMessage: string): boolean {
  const mapping = classifyError(errorMessage);
  return mapping.strategy === 'retry' || mapping.strategy === 'throttle_retry';
}

/**
 * 判断错误是否是限流
 */
export function isThrottleError(errorMessage: string): boolean {
  const mapping = classifyError(errorMessage);
  return mapping.strategy === 'throttle_retry';
}

/**
 * 判断错误是否需要标记源实体状态
 */
export function shouldMarkEntityDeleted(errorMessage: string): boolean {
  const mapping = classifyError(errorMessage);
  return mapping.markEntityStatus === 'amazon_deleted' || mapping.markEntityStatus === 'amazon_archived';
}

/**
 * 获取错误对应的实体标记状态
 */
export function getEntityMarkStatus(errorMessage: string): 'amazon_deleted' | 'amazon_archived' | null {
  const mapping = classifyError(errorMessage);
  return mapping.markEntityStatus || null;
}

/**
 * 获取所有已注册的错误映射（用于管理界面展示）
 */
export function getAllErrorMappings(): ErrorMapping[] {
  return [...ERROR_MAPPINGS];
}

/**
 * 获取错误统计摘要
 * @param errors 错误消息数组
 * @returns 按策略分组的统计
 */
export function summarizeErrors(errors: string[]): Record<ErrorHandlingStrategy, { count: number; codes: string[] }> {
  const summary: Record<string, { count: number; codes: Set<string> }> = {};
  
  for (const error of errors) {
    const mapping = classifyError(error);
    if (!summary[mapping.strategy]) {
      summary[mapping.strategy] = { count: 0, codes: new Set() };
    }
    summary[mapping.strategy].count++;
    summary[mapping.strategy].codes.add(mapping.code);
  }
  
  const result: Record<string, { count: number; codes: string[] }> = {};
  for (const [strategy, data] of Object.entries(summary)) {
    result[strategy] = { count: data.count, codes: Array.from(data.codes) };
  }
  
  return result as Record<ErrorHandlingStrategy, { count: number; codes: string[] }>;
}
