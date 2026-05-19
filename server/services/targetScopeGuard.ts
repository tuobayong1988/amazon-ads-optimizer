/**
 * v785: 统一目标范围守卫（TargetScopeGuard）
 *
 * 审计背景：自动优化与数据同步路径在部分候选实体查询和 Amazon 写回前，
 * 仅依赖 campaignId / adGroupId / local entity id，缺少 accountId + performanceGroupId
 * + campaignId 的统一闭环校验。该守卫用于所有自动优化写路径的最后一道
 * fail-closed 范围断言，避免跨账户、跨优化目标或跨广告活动误写。
 */

import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  adGroups,
  campaigns,
  keywords,
  negativeKeywords,
  performanceGroups,
  productTargets,
  sdAudiences,
  searchTerms,
} from '../../drizzle/schema';
import { getDb } from '../db/connection';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('TargetScopeGuard');

export type GuardedEntityType =
  | 'campaign'
  | 'ad_group'
  | 'keyword'
  | 'product_target'
  | 'search_term'
  | 'negative_keyword'
  | 'sd_audience';

export interface TargetScopeEntityRef {
  type: GuardedEntityType;
  /** 本地自增 ID，适用于 keyword/product_target/search_term/ad_group 等实体。 */
  id?: number | string | null;
  /** Amazon campaignId。用于实体 ID 暂缺时的兜底校验。 */
  campaignId?: string | null;
  /** 本地 adGroups.id。用于 search term / product target / SD audience 兜底校验。 */
  internalAdGroupId?: number | null;
}

export interface TargetScopeContext {
  accountId: number;
  /** 优化目标/绩效组 ID。自动优化写路径应尽量传入；strict=true 时必须传入。 */
  performanceGroupId?: number | null;
  /** 当前操作声明的目标广告活动，可为本地 campaigns.id 或 Amazon campaignId。 */
  campaignId?: number | string | null;
  /** 批量或单项写入的候选实体。 */
  entities?: TargetScopeEntityRef[];
  /** 操作来源，写入安全日志使用。 */
  source?: string;
  /** 操作类型，写入安全日志使用。 */
  operation?: string;
  /** 是否强制要求 performanceGroupId。默认 false，便于逐步接入遗留路径。 */
  strictPerformanceGroup?: boolean;
}

export interface TargetScopeAssertionResult {
  allowed: boolean;
  reason?: string;
  checkedCampaignIds: string[];
  checkedEntityCount: number;
}

export class TargetScopeViolationError extends Error {
  public readonly code = 'TARGET_SCOPE_VIOLATION';
  public readonly context: TargetScopeContext;

  constructor(message: string, context: TargetScopeContext) {
    super(message);
    this.name = 'TargetScopeViolationError';
    this.context = context;
  }
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function toStringOrNull(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function buildCampaignIdentityWhere(campaignId: number | string | null | undefined) {
  const idAsNumber = toNumberOrNull(campaignId);
  const idAsString = toStringOrNull(campaignId);
  if (idAsNumber !== null && idAsString !== null) {
    return or(eq(campaigns.id, idAsNumber), eq(campaigns.campaignId, idAsString));
  }
  if (idAsNumber !== null) return eq(campaigns.id, idAsNumber);
  if (idAsString !== null) return eq(campaigns.campaignId, idAsString);
  return undefined;
}

function deny(message: string, context: TargetScopeContext): never {
  log.warn(`[TargetScopeGuard] 拒绝越界自动优化写入: ${message}; accountId=${context.accountId}, performanceGroupId=${context.performanceGroupId ?? 'n/a'}, campaignId=${context.campaignId ?? 'n/a'}, operation=${context.operation ?? 'unknown'}, source=${context.source ?? 'unknown'}`);
  throw new TargetScopeViolationError(message, context);
}

async function assertPerformanceGroup(context: TargetScopeContext): Promise<void> {
  const db = await getDb();
  if (!db) deny('数据库不可用，无法校验优化目标范围', context);

  if (!context.performanceGroupId) {
    if (context.strictPerformanceGroup) deny('缺少 performanceGroupId，无法执行严格目标范围校验', context);
    return;
  }

  const [group] = await db.select({
    id: performanceGroups.id,
    accountId: performanceGroups.accountId,
    status: performanceGroups.status,
  }).from(performanceGroups).where(and(
    eq(performanceGroups.id, context.performanceGroupId),
    eq(performanceGroups.accountId, context.accountId)
  )).limit(1);

  if (!group) {
    deny(`performanceGroupId=${context.performanceGroupId} 不属于 accountId=${context.accountId}`, context);
  }

  if (group.status === 'archived') {
    deny(`performanceGroupId=${context.performanceGroupId} 已归档，禁止自动优化写入`, context);
  }
}

async function assertCampaign(context: TargetScopeContext): Promise<string | null> {
  const db = await getDb();
  if (!db) deny('数据库不可用，无法校验广告活动范围', context);

  const identityWhere = buildCampaignIdentityWhere(context.campaignId);
  if (!identityWhere) return null;

  const whereParts: any[] = [eq(campaigns.accountId, context.accountId), identityWhere];
  if (context.performanceGroupId) whereParts.push(eq(campaigns.performanceGroupId, context.performanceGroupId));

  const [campaign] = await db.select({
    id: campaigns.id,
    campaignId: campaigns.campaignId,
    accountId: campaigns.accountId,
    performanceGroupId: campaigns.performanceGroupId,
    campaignStatus: campaigns.campaignStatus,
  }).from(campaigns).where(and(...whereParts)).limit(1);

  if (!campaign) {
    deny(`campaignId=${context.campaignId} 不在 accountId=${context.accountId}${context.performanceGroupId ? ` / performanceGroupId=${context.performanceGroupId}` : ''} 范围内`, context);
  }

  const campaignStatus = String(campaign.campaignStatus || '');
  if (campaignStatus === 'archived' || campaignStatus === 'amazon_deleted') {
    deny(`campaignId=${campaign.campaignId} 已归档或已删除，禁止自动优化写入`, context);
  }

  return campaign.campaignId || null;
}

async function assertEntity(context: TargetScopeContext, entity: TargetScopeEntityRef): Promise<string | null> {
  const db = await getDb();
  if (!db) deny('数据库不可用，无法校验实体范围', context);

  const localId = toNumberOrNull(entity.id);
  const campaignId = toStringOrNull(entity.campaignId);
  const contextCampaignId = toStringOrNull(context.campaignId);
  const expectedCampaignId = campaignId || contextCampaignId;

  const baseCampaignWhere: any[] = [eq(campaigns.accountId, context.accountId)];
  if (context.performanceGroupId) baseCampaignWhere.push(eq(campaigns.performanceGroupId, context.performanceGroupId));
  if (expectedCampaignId) baseCampaignWhere.push(eq(campaigns.campaignId, expectedCampaignId));

  switch (entity.type) {
    case 'campaign': {
      const scopedContext = { ...context, campaignId: entity.id ?? entity.campaignId ?? context.campaignId };
      return await assertCampaign(scopedContext);
    }

    case 'ad_group': {
      const whereParts: any[] = [...baseCampaignWhere];
      if (localId !== null) whereParts.push(eq(adGroups.id, localId));
      else if (entity.internalAdGroupId) whereParts.push(eq(adGroups.id, entity.internalAdGroupId));
      else deny('ad_group 实体缺少本地 ID，无法校验范围', context);

      const [row] = await db.select({ campaignId: adGroups.campaignId, adGroupStatus: adGroups.adGroupStatus })
        .from(adGroups)
        .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
        .where(and(...whereParts))
        .limit(1);
      if (!row) deny(`ad_group=${entity.id ?? entity.internalAdGroupId} 不在目标范围内`, context);
      const adGroupStatus = String(row.adGroupStatus || '');
      if (adGroupStatus === 'archived' || adGroupStatus === 'amazon_deleted') deny(`ad_group=${entity.id ?? entity.internalAdGroupId} 已归档或已删除`, context);
      return row.campaignId || null;
    }

    case 'keyword': {
      if (localId === null) deny('keyword 实体缺少本地 ID，无法校验范围', context);
      const [row] = await db.select({ campaignId: keywords.campaignId, keywordStatus: keywords.keywordStatus })
        .from(keywords)
        .innerJoin(campaigns, eq(keywords.campaignId, campaigns.campaignId))
        .where(and(...baseCampaignWhere, eq(keywords.id, localId), eq(keywords.accountId, context.accountId)))
        .limit(1);
      if (!row) deny(`keyword=${entity.id} 不在目标范围内`, context);
      if (row.keywordStatus === 'archived' || row.keywordStatus === 'amazon_deleted') deny(`keyword=${entity.id} 已归档或已删除`, context);
      return row.campaignId || null;
    }

    case 'product_target': {
      if (localId === null) deny('product_target 实体缺少本地 ID，无法校验范围', context);
      const [row] = await db.select({ campaignId: productTargets.campaignId, targetStatus: productTargets.targetStatus })
        .from(productTargets)
        .innerJoin(campaigns, eq(productTargets.campaignId, campaigns.campaignId))
        .where(and(...baseCampaignWhere, eq(productTargets.id, localId), eq(productTargets.accountId, context.accountId)))
        .limit(1);
      if (!row) deny(`product_target=${entity.id} 不在目标范围内`, context);
      if (row.targetStatus === 'archived' || row.targetStatus === 'amazon_deleted') deny(`product_target=${entity.id} 已归档或已删除`, context);
      return row.campaignId || null;
    }

    case 'search_term': {
      if (localId === null) deny('search_term 实体缺少本地 ID，无法校验范围', context);
      const [row] = await db.select({ campaignId: searchTerms.campaignId })
        .from(searchTerms)
        .innerJoin(campaigns, eq(searchTerms.campaignId, campaigns.campaignId))
        .where(and(...baseCampaignWhere, eq(searchTerms.id, localId), eq(searchTerms.accountId, context.accountId)))
        .limit(1);
      if (!row) deny(`search_term=${entity.id} 不在目标范围内`, context);
      return row.campaignId || null;
    }

    case 'negative_keyword': {
      if (localId === null) deny('negative_keyword 实体缺少本地 ID，无法校验范围', context);
      const [row] = await db.select({ campaignId: negativeKeywords.campaignId, negativeStatus: negativeKeywords.negativeStatus })
        .from(negativeKeywords)
        .innerJoin(campaigns, eq(negativeKeywords.campaignId, campaigns.campaignId))
        .where(and(...baseCampaignWhere, eq(negativeKeywords.id, localId), eq(negativeKeywords.accountId, context.accountId)))
        .limit(1);
      if (!row) deny(`negative_keyword=${entity.id} 不在目标范围内`, context);
      if (row.negativeStatus === 'removed') deny(`negative_keyword=${entity.id} 已移除，禁止写入`, context);
      return row.campaignId || null;
    }

    case 'sd_audience': {
      if (localId === null) deny('sd_audience 实体缺少本地 ID，无法校验范围', context);
      const [row] = await db.select({ campaignId: adGroups.campaignId, state: sdAudiences.state })
        .from(sdAudiences)
        .innerJoin(adGroups, eq(sdAudiences.internalAdGroupId, adGroups.id))
        .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
        .where(and(...baseCampaignWhere, eq(sdAudiences.id, localId), eq(sdAudiences.accountId, context.accountId)))
        .limit(1);
      if (!row) deny(`sd_audience=${entity.id} 不在目标范围内`, context);
      if (row.state === 'archived') deny(`sd_audience=${entity.id} 已归档，禁止写入`, context);
      return row.campaignId || null;
    }

    default:
      deny(`未知实体类型 ${(entity as any).type}`, context);
  }
}

/**
 * 对自动优化候选目标执行统一范围断言。
 *
 * 该函数采用 fail-closed 策略：数据库不可用、优化目标缺失、广告活动或实体不匹配
 * 均抛出 TargetScopeViolationError，调用方应阻断 Amazon 写回并记录失败状态。
 */
export async function assertTargetScope(context: TargetScopeContext): Promise<TargetScopeAssertionResult> {
  if (!Number.isFinite(context.accountId) || context.accountId <= 0) {
    deny(`非法 accountId=${context.accountId}`, context);
  }

  await assertPerformanceGroup(context);
  const checkedCampaignIds = new Set<string>();
  const directCampaignId = await assertCampaign(context);
  if (directCampaignId) checkedCampaignIds.add(directCampaignId);

  for (const entity of context.entities || []) {
    const scopedCampaignId = await assertEntity(context, entity);
    if (scopedCampaignId) checkedCampaignIds.add(scopedCampaignId);
  }

  return {
    allowed: true,
    checkedCampaignIds: Array.from(checkedCampaignIds),
    checkedEntityCount: context.entities?.length || 0,
  };
}

/**
 * 批量断言多个实体属于同一账户/优化目标范围。用于 Amazon 写回辅助层一次性预检。
 */
export async function assertTargetEntitiesInScope(
  accountId: number,
  performanceGroupId: number | null | undefined,
  entities: TargetScopeEntityRef[],
  options: { campaignId?: number | string | null; operation?: string; source?: string; strictPerformanceGroup?: boolean } = {}
): Promise<TargetScopeAssertionResult> {
  return assertTargetScope({
    accountId,
    performanceGroupId,
    campaignId: options.campaignId,
    entities,
    operation: options.operation,
    source: options.source,
    strictPerformanceGroup: options.strictPerformanceGroup,
  });
}

/**
 * 兼容类式调用，便于后续在执行器与服务中逐步替换。
 */
export class TargetScopeGuard {
  static assertTargetScope = assertTargetScope;
  static assertTargetEntitiesInScope = assertTargetEntitiesInScope;
}
