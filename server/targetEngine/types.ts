/**
 * v362: 优化目标引擎 - 共享类型定义
 * 从 optimizationTargetEngine.ts 拆分
 */
import * as db from "../db";
import * as campaignLifecycleService from "../services/campaignLifecycleService";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30分钟TTL
const marketplaceCache = new Map<number, { value: string; expiresAt: number }>();

// 定期清理过期缓存
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of marketplaceCache.entries()) {
    if (now > entry.expiresAt) marketplaceCache.delete(key);
  }
}, 10 * 60 * 1000);

async function getAccountMarketplace(accountId: number): Promise<string> {
  const cached = marketplaceCache.get(accountId);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const account = await db.getAdAccountById(accountId);
  const marketplace = account?.marketplace || 'US';
  marketplaceCache.set(accountId, { value: marketplace, expiresAt: Date.now() + CACHE_TTL_MS });
  return marketplace;
}

// v221: 获取账户最后同步时间，用于数据新鲜度检查
async function getLastSyncTimeForAccount(accountId: number): Promise<Date | null> {
  try {
    const account = await db.getAdAccountById(accountId);
    // @ts-ignore
    if (account && (account as unknown).lastSyncAt) {
      // @ts-ignore
      return new Date((account as unknown).lastSyncAt);
    }
    // 备用：从同步日志表查询
    const { getEngineStatus } = await import('../sync/unifiedSyncEngine');
    const status = getEngineStatus();
    // @ts-ignore
    if ((status as string).lastSyncResults) {
      // @ts-ignore
      const accountResult = ((status as string).lastSyncResults as any[])?.find((r: Record<string, any>) => r.accountId === accountId);
      if (accountResult?.completedAt) {
        return new Date(accountResult.completedAt);
      }
    }
    return null;
  } catch {
    return null;
  }
}

// 优化执行结果类型
export interface OptimizationExecutionResult {
  targetId: number;
  targetName: string;
  accountId: number; // v167: 添加accountId确保日志记录正确
  executionTime: Date;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  
  // 各优化模块的执行结果
  bidOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: Record<string, any>[];
  };
  
  placementOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: Record<string, any>[];
  };
  
  daypartingOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: Record<string, any>[];
  };
  
  // v179: 分时预算优化
  daypartingBudgetOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: Record<string, any>[];
  };
  
  searchTermAnalysis: {
    executed: boolean;
    negativeKeywordsAdded: number;
    newKeywordsAdded: number;
    details: Record<string, any>[];
  };
  
  budgetAllocation: {
    executed: boolean;
    adjustmentsCount: number;
    details: Record<string, any>[];
  };
  
  keywordStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: Record<string, any>[];
  };
  
  // v135: 广告活动状态变更
  campaignStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: Record<string, any>[];
  };
  
  // v135: 广告组状态变更
  adGroupStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: Record<string, any>[];
  };
  
  // 多维度智能优化结果
  multiDimensionOptimization: {
    executed: boolean;
    campaignsAnalyzed: number;
    rulesGenerated: number;
    details: Record<string, any>[];
  };
  
  // 中央竞价协调器执行结果
  bidCoordination: {
    executed: boolean;
    campaignsCoordinated: number;
    circuitBreakerTriggered: number;
    details: Record<string, any>[];
  };
  
  errors: string[];
  warnings: string[];
  
  // v143: 生命周期信息
  lifecycleStage?: string;
  lifecycleSummary?: string;
  
  // v137: 重试队列信息
  retryBatchId?: string;
  retryTaskCount?: number;
}

// 优化目标配置
export interface OptimizationTargetConfig {
  id: number;
  name: string;
  accountId: number;
  marketplace: string; // 站点代码，用于时区感知分时
  isEnabled: boolean;
  
  // 优化目标
  optimizationGoal: 'maximize_sales' | 'target_acos' | 'target_roas' | 'balanced';
  targetAcos?: number;
  targetRoas?: number;
  dailyBudget?: number;
  maxBid?: number;
  
  // 各优化模块的启用状态
  enableBidOptimization: boolean;
  enablePlacementOptimization: boolean;
  enableDaypartingOptimization: boolean;
  enableSearchTermAnalysis: boolean;
  enableBudgetAllocation: boolean;
  enableKeywordAutoExecution: boolean;
  
  // 执行频率设置
  executionFrequency: 'hourly' | 'daily' | 'weekly';
  lastExecutionTime?: Date;
  nextExecutionTime?: Date;
  
  // 安全设置
  maxDailyBidChanges: number;
  maxBidChangePercent: number;
  minDataPoints: number;
  autoRollbackEnabled: boolean;
  
  // v143: 生命周期感知调度
  lifecycleStage?: campaignLifecycleService.LifecycleStage;
  lifecycleConfig?: campaignLifecycleService.LifecycleOptimizationConfig;
  lifecycleSummary?: string;
  
  // v164: 自我进化所需字段
  userId: number;
  strategyTemplateId?: string;
  
  // v329: 关联的业绩组ID
  performanceGroupId?: number;
}

/**
 * 获取优化目标的完整配置
 */
