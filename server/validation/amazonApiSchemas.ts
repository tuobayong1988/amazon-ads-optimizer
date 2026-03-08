/**
 * Amazon Ads API 运行时数据校验 Schema
 * 
 * 使用 Zod 对 Amazon API 返回的外部数据进行运行时校验，
 * 确保数据结构符合预期，防止因 API 变更或异常数据导致系统崩溃。
 */
import { z } from 'zod';

// ============================================================
// 基础枚举 Schema
// ============================================================

export const CampaignStateSchema = z.enum(['enabled', 'paused', 'archived']);
export const TargetingTypeSchema = z.enum(['manual', 'auto']);
export const BiddingStrategySchema = z.enum(['legacyForSales', 'autoForSales', 'manual']);
export const PlacementPredicateSchema = z.enum(['placementTop', 'placementProductPage']);
export const MatchTypeSchema = z.enum(['broad', 'phrase', 'exact']);
export const NegativeMatchTypeSchema = z.enum(['negativeExact', 'negativePhrase']);

// ============================================================
// SP Campaign Schema
// ============================================================

export const SpCampaignSchema = z.object({
  campaignId: z.number({ message: 'campaignId must be a number' }),
  name: z.string().default('Unknown Campaign'),
  state: CampaignStateSchema.default('paused'),
  targetingType: TargetingTypeSchema.default('manual'),
  dailyBudget: z.number().min(0).default(0),
  startDate: z.string().default(''),
  endDate: z.string().optional(),
  premiumBidAdjustment: z.boolean().default(false),
  bidding: z.object({
    strategy: BiddingStrategySchema.default('manual'),
    adjustments: z.array(z.object({
      predicate: PlacementPredicateSchema,
      percentage: z.number().min(0).max(900),
    })).optional(),
  }).optional(),
}).passthrough(); // 允许额外字段，避免API新增字段导致校验失败

export const SpCampaignListResponseSchema = z.object({
  campaigns: z.array(SpCampaignSchema).default([]),
  nextToken: z.string().optional().nullable(),
}).passthrough();

// ============================================================
// SP Ad Group Schema
// ============================================================

export const SpAdGroupSchema = z.object({
  adGroupId: z.number({ message: 'adGroupId must be a number' }),
  campaignId: z.number({ message: 'campaignId must be a number' }),
  name: z.string().default('Unknown Ad Group'),
  state: CampaignStateSchema.default('paused'),
  defaultBid: z.number().min(0).default(0),
}).passthrough();

export const SpAdGroupListResponseSchema = z.object({
  adGroups: z.array(SpAdGroupSchema).default([]),
  nextToken: z.string().optional().nullable(),
}).passthrough();

// ============================================================
// SP Keyword Schema
// ============================================================

export const SpKeywordSchema = z.object({
  keywordId: z.number({ message: 'keywordId must be a number' }),
  adGroupId: z.number({ message: 'adGroupId must be a number' }),
  campaignId: z.number({ message: 'campaignId must be a number' }),
  state: CampaignStateSchema.default('paused'),
  keywordText: z.string().default(''),
  matchType: MatchTypeSchema.default('broad'),
  bid: z.number().min(0).default(0),
}).passthrough();

export const SpKeywordListResponseSchema = z.object({
  keywords: z.array(SpKeywordSchema).default([]),
  nextToken: z.string().optional().nullable(),
}).passthrough();

// ============================================================
// SP Product Target Schema
// ============================================================

export const SpProductTargetSchema = z.object({
  targetId: z.number({ message: 'targetId must be a number' }),
  adGroupId: z.number({ message: 'adGroupId must be a number' }),
  campaignId: z.number({ message: 'campaignId must be a number' }),
  state: CampaignStateSchema.default('paused'),
  expressionType: z.enum(['auto', 'manual']).default('manual'),
  expression: z.array(z.object({
    type: z.string(),
    value: z.string().optional(),
  })).default([]),
  bid: z.number().min(0).default(0),
}).passthrough();

export const SpProductTargetListResponseSchema = z.object({
  targets: z.array(SpProductTargetSchema).default([]),
  nextToken: z.string().optional().nullable(),
}).passthrough();

// ============================================================
// Performance Metrics Schema
// ============================================================

export const PerformanceMetricsSchema = z.object({
  impressions: z.number().min(0).default(0),
  clicks: z.number().min(0).default(0),
  cost: z.number().min(0).default(0),
  attributedSales14d: z.number().min(0).default(0),
  attributedConversions14d: z.number().min(0).default(0),
  attributedUnitsOrdered14d: z.number().min(0).default(0),
}).passthrough();

export const CampaignPerformanceSchema = PerformanceMetricsSchema.extend({
  campaignId: z.number(),
  campaignName: z.string().default(''),
}).passthrough();

export const KeywordPerformanceSchema = PerformanceMetricsSchema.extend({
  keywordId: z.number(),
  keywordText: z.string().default(''),
  matchType: z.string().default(''),
}).passthrough();

// ============================================================
// Token Response Schema
// ============================================================

export const TokenResponseSchema = z.object({
  access_token: z.string({ message: 'access_token is required' }),
  refresh_token: z.string().optional(),
  token_type: z.string().default('bearer'),
  expires_in: z.number().default(3600),
}).passthrough();

// ============================================================
// Amazon Profile Schema
// ============================================================

export const AmazonProfileSchema = z.object({
  profileId: z.number({ message: 'profileId must be a number' }),
  countryCode: z.string().default(''),
  currencyCode: z.string().default('USD'),
  timezone: z.string().default(''),
  accountInfo: z.object({
    marketplaceStringId: z.string().default(''),
    id: z.string().default(''),
    type: z.string().default(''),
    name: z.string().default(''),
  }).optional(),
}).passthrough();

// ============================================================
// Budget Usage Schema
// ============================================================

export const BudgetUsageDataSchema = z.object({
  campaignId: z.number(),
  budgetUsagePercent: z.number().min(0).max(100).default(0),
  usedBudget: z.number().min(0).default(0),
  totalBudget: z.number().min(0).default(0),
}).passthrough();

// ============================================================
// 安全解析辅助函数
// ============================================================

import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('validation');

/**
 * 安全解析 Amazon API 返回数据。
 * 如果解析失败，记录警告日志并返回 null（而非抛出异常），
 * 允许调用方决定如何处理无效数据。
 */
export function safeParseApiResponse<T>(
  schema: z.ZodType<T>,
  data: any,
  context: string
): T | null {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      log.warn(`API数据校验失败 [${context}]:`, {
        errors: (error.issues as any[]).map((e: Record<string, any>) => ({
          path: e.path?.join('.') || '',
          message: (e as Error).message || '',
          received: e.received,
        })),
        dataPreview: JSON.stringify(data).slice(0, 500),
      });
    } else {
      log.error(`API数据校验异常 [${context}]:`, error);
    }
    return null;
  }
}

/**
 * 安全解析并返回默认值（当解析失败时）。
 * 适用于列表类数据，失败时返回空数组。
 */
export function safeParseWithDefault<T>(
  schema: z.ZodType<T>,
  data: any,
  defaultValue: T,
  context: string
): T {
  const result = safeParseApiResponse(schema, data, context);
  return result ?? defaultValue;
}

// ============================================================
// 类型导出（从 Schema 推导）
// ============================================================

export type ValidatedSpCampaign = z.infer<typeof SpCampaignSchema>;
export type ValidatedSpAdGroup = z.infer<typeof SpAdGroupSchema>;
export type ValidatedSpKeyword = z.infer<typeof SpKeywordSchema>;
export type ValidatedSpProductTarget = z.infer<typeof SpProductTargetSchema>;
export type ValidatedPerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;
export type ValidatedTokenResponse = z.infer<typeof TokenResponseSchema>;
export type ValidatedAmazonProfile = z.infer<typeof AmazonProfileSchema>;
