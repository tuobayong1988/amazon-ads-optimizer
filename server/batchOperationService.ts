/**
 * Batch Operation Service
 * Handles bulk operations for negative keywords and bid adjustments
 */

export type OperationType = 'negative_keyword' | 'bid_adjustment' | 'keyword_migration' | 'campaign_status';
export type BatchStatus = 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';
export type ItemStatus = 'pending' | 'success' | 'failed' | 'skipped' | 'rolled_back';

export interface BatchOperationConfig {
  operationType: OperationType;
  name: string;
  description?: string;
  requiresApproval: boolean;
  sourceType?: string;
  sourceTaskId?: number;
}

export interface NegativeKeywordItem {
  entityType: 'keyword' | 'product_target' | 'campaign' | 'ad_group';
  entityId: number;
  entityName?: string;
  negativeKeyword: string;
  negativeMatchType: 'negative_phrase' | 'negative_exact';
  negativeLevel: 'ad_group' | 'campaign';
}

export interface BidAdjustmentItem {
  entityType: 'keyword' | 'product_target';
  entityId: number;
  entityName?: string;
  currentBid: number;
  newBid: number;
  bidChangeReason?: string;
}

export interface BatchOperationResult {
  batchId: number;
  status: BatchStatus;
  totalItems: number;
  processedItems: number;
  successItems: number;
  failedItems: number;
  errors: Array<{ itemId: number; error: string }>;
}

/**
 * Calculate bid change percentage
 */
export function calculateBidChangePercent(currentBid: number, newBid: number): number {
  if (currentBid === 0) return newBid > 0 ? 100 : 0;
  return ((newBid - currentBid) / currentBid) * 100;
}

/**
 * Validate negative keyword item
 */
export function validateNegativeKeywordItem(item: NegativeKeywordItem): { valid: boolean; error?: string } {
  if (!item.negativeKeyword || item.negativeKeyword.trim().length === 0) {
    return { valid: false, error: '否定词不能为空' };
  }
  
  if (item.negativeKeyword.length > 500) {
    return { valid: false, error: '否定词长度不能超过500字符' };
  }
  
  if (!['negative_phrase', 'negative_exact'].includes(item.negativeMatchType)) {
    return { valid: false, error: '无效的匹配类型' };
  }
  
  if (!['ad_group', 'campaign'].includes(item.negativeLevel)) {
    return { valid: false, error: '无效的否定词层级' };
  }
  
  return { valid: true };
}

/**
 * Validate bid adjustment item
 */
export function validateBidAdjustmentItem(item: BidAdjustmentItem, maxBid: number = 100): { valid: boolean; error?: string } {
  if (item.newBid < 0.02) {
    return { valid: false, error: '出价不能低于$0.02' };
  }
  
  if (item.newBid > maxBid) {
    return { valid: false, error: `出价不能超过$${maxBid}` };
  }
  
  const changePercent = Math.abs(calculateBidChangePercent(item.currentBid, item.newBid));
  if (changePercent > 500) {
    return { valid: false, error: '单次出价调整幅度不能超过500%' };
  }
  
  return { valid: true };
}

/**
 * Group items by campaign for efficient processing
 */
export function groupItemsByCampaign<T extends { entityId: number }>(
  items: T[],
  getCampaignId: (item: T) => number
): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  
  for (const item of items) {
    const campaignId = getCampaignId(item);
    const existing = groups.get(campaignId) || [];
    existing.push(item);
    groups.set(campaignId, existing);
  }
  
  return groups;
}

/**
 * Generate batch operation summary
 */
export function generateBatchSummary(result: BatchOperationResult): string {
  const successRate = result.totalItems > 0 
    ? ((result.successItems / result.totalItems) * 100).toFixed(1)
    : '0';
    
  let summary = `批量操作完成\n`;
  summary += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `总计项目: ${result.totalItems}\n`;
  summary += `成功: ${result.successItems} (${successRate}%)\n`;
  summary += `失败: ${result.failedItems}\n`;
  
  if (result.errors.length > 0) {
    summary += `\n错误详情:\n`;
    result.errors.slice(0, 5).forEach((err, i) => {
      summary += `${i + 1}. 项目 #${err.itemId}: ${err.error}\n`;
    });
    if (result.errors.length > 5) {
      summary += `... 还有 ${result.errors.length - 5} 个错误\n`;
    }
  }
  
  return summary;
}

/**
 * Prepare rollback data for a batch operation item
 */
export function prepareRollbackData(
  operationType: OperationType,
  item: NegativeKeywordItem | BidAdjustmentItem
): string {
  const rollbackData: Record<string, unknown> = {
    operationType,
    timestamp: new Date().toISOString(),
  };
  
  if (operationType === 'negative_keyword') {
    const nkItem = item as NegativeKeywordItem;
    rollbackData.action = 'remove_negative_keyword';
    rollbackData.negativeKeyword = nkItem.negativeKeyword;
    rollbackData.negativeMatchType = nkItem.negativeMatchType;
    rollbackData.negativeLevel = nkItem.negativeLevel;
  } else if (operationType === 'bid_adjustment') {
    const bidItem = item as BidAdjustmentItem;
    rollbackData.action = 'restore_bid';
    rollbackData.originalBid = bidItem.currentBid;
  }
  
  return JSON.stringify(rollbackData);
}

/**
 * Estimate execution time for batch operation
 */
export function estimateExecutionTime(totalItems: number, operationType: OperationType): number {
  // Estimated seconds per item based on operation type
  const timePerItem: Record<OperationType, number> = {
    negative_keyword: 0.5,
    bid_adjustment: 0.3,
    keyword_migration: 1.0,
    campaign_status: 0.2,
  };
  
  const baseTime = 5; // Base overhead in seconds
  return Math.ceil(baseTime + totalItems * timePerItem[operationType]);
}

/**
 * Format operation type for display
 */
export function formatOperationType(type: OperationType): string {
  const labels: Record<OperationType, string> = {
    negative_keyword: '否定词添加',
    bid_adjustment: '出价调整',
    keyword_migration: '关键词迁移',
    campaign_status: '广告活动状态',
  };
  return labels[type];
}

/**
 * Check if batch operation can be rolled back
 */
export function canRollback(status: BatchStatus, completedAt?: Date): boolean {
  // Can only rollback completed operations
  if (status !== 'completed') return false;
  
  // Can only rollback within 7 days
  if (completedAt) {
    const daysSinceCompletion = (Date.now() - completedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCompletion > 7) return false;
  }
  
  return true;
}

/**
 * Default batch operation configurations
 */
export const defaultBatchConfigs: Record<string, Partial<BatchOperationConfig>> = {
  ngram_negatives: {
    operationType: 'negative_keyword',
    name: 'N-Gram分析否定词',
    description: '基于N-Gram词根分析生成的批量否定词建议',
    requiresApproval: true,
    sourceType: 'ngram_analysis',
  },
  funnel_migration: {
    operationType: 'keyword_migration',
    name: '漏斗迁移',
    description: '将表现优秀的广泛匹配词迁移到短语/精准匹配',
    requiresApproval: true,
    sourceType: 'funnel_migration',
  },
  smart_bidding: {
    operationType: 'bid_adjustment',
    name: '智能竞价调整',
    description: '基于绩效数据的智能出价优化',
    requiresApproval: false,
    sourceType: 'smart_bidding',
  },
  conflict_resolution: {
    operationType: 'negative_keyword',
    name: '流量冲突解决',
    description: '解决跨广告活动的流量冲突',
    requiresApproval: true,
    sourceType: 'traffic_conflict',
  },
};
