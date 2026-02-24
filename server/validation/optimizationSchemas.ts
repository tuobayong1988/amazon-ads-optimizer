/**
 * 优化目标和优化操作的运行时数据校验 Schema
 * 
 * 对优化引擎的输入/输出数据进行运行时校验，
 * 确保出价调整、预算分配等关键操作的数据完整性。
 */
import { z } from 'zod';

// ============================================================
// 出价优化 Schema
// ============================================================

export const BidAdjustmentSchema = z.object({
  keywordId: z.number({ message: 'keywordId is required for bid adjustment' }),
  productTargetId: z.number().optional(),
  campaignId: z.union([z.string(), z.number()]),
  newBid: z.number()
    .min(0.02, 'Bid must be at least $0.02')
    .max(1000, 'Bid cannot exceed $1000'),
  reason: z.string().default(''),
  isProductTarget: z.boolean().optional(),
});

export const BidAdjustmentBatchSchema = z.array(BidAdjustmentSchema)
  .min(1, 'At least one bid adjustment is required');

// ============================================================
// 预算分配 Schema
// ============================================================

export const BudgetAllocationSchema = z.object({
  campaignId: z.union([z.string(), z.number()]),
  amazonCampaignId: z.string().optional(),
  newDailyBudget: z.number()
    .min(1, 'Daily budget must be at least $1')
    .max(1000000, 'Daily budget cannot exceed $1,000,000'),
  reason: z.string().default(''),
  previousBudget: z.number().optional(),
});

// ============================================================
// 关键词状态变更 Schema
// ============================================================

export const KeywordStatusChangeSchema = z.object({
  keywordId: z.number({ message: 'keywordId is required' }),
  newStatus: z.enum(['enabled', 'paused', 'archived']),
  campaignId: z.number(),
  reason: z.string().default(''),
  isProductTarget: z.boolean().optional(),
});

// ============================================================
// 广告活动状态变更 Schema
// ============================================================

export const CampaignStatusChangeSchema = z.object({
  campaignId: z.number({ message: 'campaignId is required' }),
  amazonCampaignId: z.string(),
  newStatus: z.enum(['enabled', 'paused', 'archived']),
  campaignName: z.string().default(''),
  campaignType: z.string().optional(),
  reason: z.string().default(''),
});

// ============================================================
// 位置倾斜 Schema
// ============================================================

export const PlacementAdjustmentSchema = z.object({
  campaignId: z.union([z.string(), z.number()]),
  amazonCampaignId: z.string(),
  placementTop: z.number().min(0).max(900).default(0),
  placementProductPage: z.number().min(0).max(900).default(0),
  reason: z.string().default(''),
});

// ============================================================
// 搜索词迁移 Schema
// ============================================================

export const SearchTermMigrationSchema = z.object({
  searchTerm: z.string().min(1, 'Search term cannot be empty'),
  sourceCampaignId: z.union([z.string(), z.number()]),
  targetCampaignId: z.union([z.string(), z.number()]).optional(),
  targetAdGroupId: z.number().optional(),
  matchType: z.enum(['broad', 'phrase', 'exact']).default('exact'),
  suggestedBid: z.number().min(0.02).optional(),
  reason: z.string().default(''),
});

// ============================================================
// 否定关键词 Schema
// ============================================================

export const NegativeKeywordSchema = z.object({
  keywordText: z.string().min(1, 'Keyword text cannot be empty'),
  matchType: z.enum(['negativeExact', 'negativePhrase']),
  campaignId: z.union([z.string(), z.number()]),
  adGroupId: z.number().optional(),
  reason: z.string().default(''),
});

// ============================================================
// 优化目标配置 Schema
// ============================================================

export const OptimizationTargetConfigSchema = z.object({
  targetAcos: z.number().min(0).max(100).optional(),
  targetRoas: z.number().min(0).optional(),
  maxBid: z.number().min(0.02).max(1000).optional(),
  minBid: z.number().min(0.02).max(1000).optional(),
  dailyBudgetLimit: z.number().min(1).optional(),
  enableBidOptimization: z.boolean().default(true),
  enableBudgetOptimization: z.boolean().default(true),
  enablePlacementOptimization: z.boolean().default(true),
  enableSearchTermHarvesting: z.boolean().default(true),
  enableNegativeKeywords: z.boolean().default(true),
  enableDayparting: z.boolean().default(false),
});

// ============================================================
// 安全性守卫 Schema
// ============================================================

export const SafetyGuardrailConfigSchema = z.object({
  maxBidChangePercent: z.number().min(1).max(100).default(30),
  maxBudgetChangePercent: z.number().min(1).max(100).default(50),
  minDataPointsRequired: z.number().min(1).default(7),
  cooldownPeriodHours: z.number().min(0).default(24),
  maxDailyChanges: z.number().min(1).default(100),
});

// ============================================================
// 类型导出
// ============================================================

export type ValidatedBidAdjustment = z.infer<typeof BidAdjustmentSchema>;
export type ValidatedBudgetAllocation = z.infer<typeof BudgetAllocationSchema>;
export type ValidatedKeywordStatusChange = z.infer<typeof KeywordStatusChangeSchema>;
export type ValidatedCampaignStatusChange = z.infer<typeof CampaignStatusChangeSchema>;
export type ValidatedPlacementAdjustment = z.infer<typeof PlacementAdjustmentSchema>;
export type ValidatedSearchTermMigration = z.infer<typeof SearchTermMigrationSchema>;
export type ValidatedNegativeKeyword = z.infer<typeof NegativeKeywordSchema>;
export type ValidatedOptimizationTargetConfig = z.infer<typeof OptimizationTargetConfigSchema>;
export type ValidatedSafetyGuardrailConfig = z.infer<typeof SafetyGuardrailConfigSchema>;
