/**
 * 数据库查询提供者 — 解耦 campaignIdResolver 对 db.ts 的直接依赖
 * 
 * 通过依赖注入模式，campaignIdResolver 不再直接导入 db.ts，
 * 而是通过此模块注册的回调函数间接访问数据库。
 * db.ts 在初始化时注册这些回调，从而打破循环依赖。
 * 
 * 注意：此模块不得导入 db.ts（包括动态导入），否则会重新引入循环依赖。
 */

import { createModuleLogger } from './logger';

const log = createModuleLogger('dbQueryProvider');

// ==================== 类型定义 ====================

export interface AdGroupRecord {
  id: number;
  campaignId: string | null;
  [key: string]: unknown;
}

// v357: adGroupId和campaignId字段类型修复为string，与数据库实际varchar(64)一致
export interface KeywordRecord {
  id: number;
  internalAdGroupId: number | null;  // v421: 使用internalAdGroupId(int)
  campaignId: string | null;
  [key: string]: unknown;
}

export interface ProductTargetRecord {
  id: number;
  internalAdGroupId: number | null;  // v421: 使用internalAdGroupId(int)
  campaignId: string | null;
  [key: string]: unknown;
}

export type GetAdGroupByIdFn = (id: number) => Promise<AdGroupRecord | null | undefined>;
export type GetKeywordByIdFn = (id: number) => Promise<KeywordRecord | null | undefined>;
export type GetProductTargetByIdFn = (id: number) => Promise<ProductTargetRecord | null | undefined>;
export type GetDbFn = () => Promise<any>;

// ==================== 注册表 ====================

let _getAdGroupById: GetAdGroupByIdFn | null = null;
let _getKeywordById: GetKeywordByIdFn | null = null;
let _getProductTargetById: GetProductTargetByIdFn | null = null;
let _getDb: GetDbFn | null = null;

/**
 * 注册数据库查询函数（由 db.ts 在初始化时调用）
 */
export function registerDbQueryProviders(providers: {
  getAdGroupById: GetAdGroupByIdFn;
  getKeywordById: GetKeywordByIdFn;
  getProductTargetById: GetProductTargetByIdFn;
  getDb: GetDbFn;
}): void {
  _getAdGroupById = providers.getAdGroupById;
  _getKeywordById = providers.getKeywordById;
  _getProductTargetById = providers.getProductTargetById;
  _getDb = providers.getDb;
  log.debug('数据库查询提供者已注册');
}

/**
 * 检查提供者是否已注册
 */
export function isDbQueryProviderRegistered(): boolean {
  return _getAdGroupById !== null && _getKeywordById !== null && _getProductTargetById !== null && _getDb !== null;
}

// ==================== 查询函数 ====================

function ensureRegistered(fnName: string): void {
  if (!_getAdGroupById || !_getKeywordById || !_getProductTargetById || !_getDb) {
    throw new Error(
      `[dbQueryProvider] ${fnName}: 数据库查询提供者尚未注册。` +
      `请确保 db.ts 已被导入并完成初始化。`
    );
  }
}

export async function queryAdGroupById(id: number): Promise<AdGroupRecord | null | undefined> {
  ensureRegistered('queryAdGroupById');
  return _getAdGroupById!(id);
}

export async function queryKeywordById(id: number): Promise<KeywordRecord | null | undefined> {
  ensureRegistered('queryKeywordById');
  return _getKeywordById!(id);
}

export async function queryProductTargetById(id: number): Promise<ProductTargetRecord | null | undefined> {
  ensureRegistered('queryProductTargetById');
  return _getProductTargetById!(id);
}

export async function queryDb(): Promise<any> {
  ensureRegistered('queryDb');
  return _getDb!();
}
