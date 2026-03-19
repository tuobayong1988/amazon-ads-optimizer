/**
 * v427: 统一工具类型定义
 * 
 * 本模块提供系统中常用的类型定义和类型守卫，
 * 用于消除 @ts-ignore 标记，提升类型安全性。
 * 
 * 主要覆盖以下场景：
 * 1. Axios 错误类型处理
 * 2. MySQL/Drizzle 执行结果类型
 * 3. 动态 Drizzle 查询条件
 * 4. Amazon API 响应类型
 * 5. 通用错误处理
 */

// ============================================================
// 1. Axios 错误类型
// ============================================================

/**
 * Axios 风格的错误对象类型
 * 用于替代 (error as Record<string, unknown>).response?.status 等模式
 */
export interface AxiosLikeError extends Error {
  response?: {
    status: number;
    statusText?: string;
    data?: unknown;
    headers?: Record<string, string>;
  };
  code?: string;
  config?: {
    url?: string;
    method?: string;
    _retryCount?: number;
    [key: string]: unknown;
  };
  isAxiosError?: boolean;
}

/**
 * 类型守卫：判断错误是否为 Axios 风格的错误
 */
export function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  return 'response' in e || 'isAxiosError' in e || ('message' in e && 'config' in e);
}

/**
 * 安全地从错误对象中提取 HTTP 状态码
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (isAxiosLikeError(error)) {
    return error.response?.status;
  }
  return undefined;
}

/**
 * 安全地从错误对象中提取响应数据
 */
export function getErrorResponseData(error: unknown): unknown {
  if (isAxiosLikeError(error)) {
    return error.response?.data;
  }
  return undefined;
}

/**
 * 安全地从错误对象中提取响应头
 */
export function getErrorResponseHeaders(error: unknown): Record<string, string> | undefined {
  if (isAxiosLikeError(error)) {
    return error.response?.headers;
  }
  return undefined;
}

// ============================================================
// 2. MySQL / Drizzle 执行结果类型
// ============================================================

/**
 * MySQL execute() 返回的结果类型
 * 对应 database.execute(sql`...`) 的返回值
 */
export interface MySQLExecuteResult {
  affectedRows: number;
  insertId: number;
  warningStatus: number;
  changedRows?: number;
}

/**
 * 从 Drizzle execute() 结果中安全提取 affectedRows
 */
export function getAffectedRows(result: unknown): number {
  if (!result || !Array.isArray(result)) return 0;
  const header = result[0] as Record<string, unknown> | undefined;
  if (header && typeof header === 'object' && 'affectedRows' in header) {
    return Number(header.affectedRows) || 0;
  }
  return 0;
}

/**
 * 从 Drizzle execute() 结果中安全提取 insertId
 */
export function getInsertId(result: unknown): number {
  if (!result || !Array.isArray(result)) return 0;
  const header = result[0] as Record<string, unknown> | undefined;
  if (header && typeof header === 'object' && 'insertId' in header) {
    return Number(header.insertId) || 0;
  }
  return 0;
}

/**
 * 从 Drizzle execute(sql`SELECT ...`) 结果中安全提取行数据
 * execute() 返回 [rows, fields]，rows 是数组
 */
export function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result || !Array.isArray(result)) return [];
  const rows = result[0];
  if (Array.isArray(rows)) return rows as T[];
  return [];
}

/**
 * 从 Drizzle execute(sql`SELECT COUNT(*)...`) 结果中安全提取计数值
 */
export function extractCount(result: unknown, field: string = 'cnt'): number {
  const rows = extractRows(result);
  if (rows.length === 0) return 0;
  const row = rows[0] as Record<string, unknown>;
  return Number(row[field] || row['count'] || row['COUNT(*)'] || 0);
}

// ============================================================
// 3. 通用错误处理
// ============================================================

/**
 * 安全地从 unknown 错误中提取错误消息
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as Record<string, unknown>).message);
  }
  return String(error);
}

/**
 * 安全地从 unknown 错误中提取错误栈
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack;
  if (error && typeof error === 'object' && 'stack' in error) {
    return String((error as Record<string, unknown>).stack);
  }
  return undefined;
}

/**
 * MySQL 重复键错误判断
 */
export function isDuplicateKeyError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  return msg.includes('ER_DUP_ENTRY') || msg.includes('Duplicate entry');
}

/**
 * MySQL 错误码提取
 */
export function getMySQLErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if ('code' in e) return String(e.code);
    if ('errno' in e) return String(e.errno);
  }
  return undefined;
}

// ============================================================
// 4. 增强的 Error 类型（用于附加额外属性）
// ============================================================

/**
 * 带有额外属性的 Error 类型
 * 用于替代 (enhancedError as Record<string, unknown>).status = xxx 等模式
 */
export class EnhancedError extends Error {
  status?: number;
  originalError?: unknown;
  isHtmlResponse?: boolean;
  retryCount?: number;
  code?: string;
  errno?: number;

  constructor(message: string, properties?: Partial<Omit<EnhancedError, keyof Error>>) {
    super(message);
    this.name = 'EnhancedError';
    if (properties) {
      Object.assign(this, properties);
    }
  }
}

// ============================================================
// 5. Amazon API 响应类型
// ============================================================

/**
 * Amazon Ads API 通用报告行
 */
export interface AmazonReportRow {
  [key: string]: string | number | undefined;
}

/**
 * Amazon Ads API 广告活动数据
 */
export interface AmazonCampaignData {
  campaignId: string;
  name: string;
  state: string;
  campaignType?: string;
  targetingType?: string;
  dailyBudget?: number;
  startDate?: string;
  endDate?: string;
  bidding?: {
    strategy?: string;
    adjustments?: Array<{
      predicate: string;
      percentage: number;
    }>;
  };
  [key: string]: unknown;
}

/**
 * Amazon Ads API 广告组数据
 */
export interface AmazonAdGroupData {
  adGroupId: string;
  campaignId: string;
  name: string;
  state: string;
  defaultBid?: number;
  [key: string]: unknown;
}

/**
 * Amazon Ads API 关键词数据
 */
export interface AmazonKeywordData {
  keywordId: string;
  adGroupId: string;
  campaignId: string;
  keywordText: string;
  matchType: string;
  state: string;
  bid?: number;
  [key: string]: unknown;
}

/**
 * Amazon Ads API 搜索词报告行
 */
export interface AmazonSearchTermRow {
  searchTerm: string;
  campaignId: string;
  adGroupId: string;
  keywordId?: string;
  targetId?: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  [key: string]: unknown;
}

// ============================================================
// 6. Drizzle 动态查询辅助类型
// ============================================================

/**
 * Drizzle SQL 条件类型（用于动态 where 构建）
 * 替代 .where(and(...conditions)) 的 @ts-ignore
 */
import type { SQL } from 'drizzle-orm';
// v429: removed self-referencing import (these functions are already defined in this file)

export type DrizzleCondition = SQL<unknown> | undefined;

/**
 * 安全构建 Drizzle AND 条件数组
 * 过滤掉 undefined 值，返回有效条件数组
 */
export function buildConditions(...conditions: (DrizzleCondition | false | null)[]): SQL<unknown>[] {
  return conditions.filter((c): c is SQL<unknown> => c != null && c !== false);
}

// ============================================================
// 7. 同步结果类型扩展
// ============================================================

/**
 * 同步步骤执行结果（用于 runStep 函数的返回值类型）
 */
export interface StepResult {
  name: string;
  success: boolean;
  synced: number;
  error?: string;
  durationMs: number;
}

/**
 * 数据成熟度级别
 */
export type DataMaturityLevel = 'fresh' | 'recent' | 'mature' | 'stale' | 'unknown';

/**
 * 值级别
 */
export type ValueLevel = 'high' | 'medium' | 'low' | 'none' | 'unknown';

/**
 * 优化目标类型
 */
export type OptimizationGoalType = 'maximize_sales' | 'minimize_acos' | 'maximize_roas' | 'target_acos' | 'balanced' | string;

// ============================================================
// 8. 通用 Record 辅助类型
// ============================================================

/**
 * 安全地将 unknown 转为 Record
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * 安全地从对象中提取字符串值
 */
export function getString(obj: unknown, key: string, defaultValue: string = ''): string {
  const record = asRecord(obj);
  const val = record[key];
  return typeof val === 'string' ? val : defaultValue;
}

/**
 * 安全地从对象中提取数字值
 */
export function getNumber(obj: unknown, key: string, defaultValue: number = 0): number {
  const record = asRecord(obj);
  const val = record[key];
  return typeof val === 'number' ? val : Number(val) || defaultValue;
}
