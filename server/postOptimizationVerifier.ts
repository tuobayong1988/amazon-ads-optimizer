/**
 * v166: 优化后即时验证同步服务 (PostOptimizationVerifier)
 * 
 * 核心功能：
 * 当优化引擎通过Amazon API发送优化指令后，自动触发"临时节点任务"，
 * 在短时间内从Amazon回查并确认优化执行情况，将确认后的数据即时回填本地数据库。
 * 
 * 设计原则：
 * 1. 非阻塞 — 验证任务异步执行，不阻塞优化引擎的主流程
 * 2. 延迟触发 — 给Amazon 30-60秒处理时间后再回查
 * 3. 多轮重试 — 如果首次验证未确认，自动安排后续验证（最多3轮）
 * 4. 精准回填 — 只更新被优化过的字段，不影响其他数据
 * 5. 冲突检测 — 如果Amazon返回的值与预期不一致，标记冲突状态
 * 6. 多租户安全 — 每个验证任务绑定accountId，隔离不同店铺的数据
 * 
 * 支持的验证类型：
 * - bid_adjustment: 关键词/商品定位出价变更
 * - budget_adjustment: 广告活动预算变更
 * - placement_adjustment: 位置倾斜比例变更
 * - negative_keyword: 否定关键词添加
 * - keyword_status: 关键词状态变更（暂停/启用）
 * - search_term_migration: 搜索词迁移（新关键词创建）
 */

import { getDb } from './db';
import { keywords, campaigns, negativeKeywords, syncConflicts } from '../drizzle/schema';
import { eq, and, inArray, sql, gte, lte } from 'drizzle-orm';
import { getAmazonSyncService } from './services/amazonApiHelper';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('PostOptVerifier');

// ============================================================
// 类型定义
// ============================================================

/** 验证任务类型 */
export type VerificationType = 
  | 'bid_adjustment'
  | 'budget_adjustment' 
  | 'placement_adjustment'
  | 'negative_keyword'
  | 'keyword_status'
  | 'search_term_migration';

/** 单个验证项 */
export interface VerificationItem {
  type: VerificationType;
  /** 本地数据库记录ID */
  localId: number;
  /** Amazon侧的ID（keywordId/campaignId等） */
  amazonId: string;
  /** 期望的值（优化引擎设置的值） */
  expectedValue: any;
  /** 额外上下文信息 */
  context?: {
    campaignId?: number;
    adGroupId?: number;
    accountId?: number;
    fieldName?: string;
  };
}

/** 验证任务 */
export interface VerificationTask {
  id: string;
  accountId: number;
  items: VerificationItem[];
  createdAt: Date;
  /** 第几轮验证（从1开始） */
  attempt: number;
  /** 最大重试次数 */
  maxAttempts: number;
  /** 下次执行时间 */
  scheduledAt: Date;
}

/** 验证结果 */
export interface VerificationResult {
  item: VerificationItem;
  status: 'confirmed' | 'conflict' | 'not_found' | 'error';
  actualValue?: any;
  message?: string;
}

// ============================================================
// 验证任务队列（内存队列 + 定时器驱动）
// ============================================================

/** 待执行的验证任务队列 */
const pendingTasks: Map<string, VerificationTask> = new Map();

/** 活跃的定时器 */
const activeTimers: Map<string, NodeJS.Timeout> = new Map();

/** 验证延迟配置（秒） */
const VERIFICATION_DELAYS = {
  /** 首次验证延迟：给Amazon 45秒处理时间 */
  firstAttempt: 45,
  /** 第二次验证延迟：3分钟后 */
  secondAttempt: 180,
  /** 第三次验证延迟：10分钟后 */
  thirdAttempt: 600,
};

/** 生成唯一任务ID */
function generateTaskId(accountId: number, type: string): string {
  return `verify_${accountId}_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// 核心API：注册验证任务
// ============================================================

/**
 * 注册出价调整验证任务
 * 在出价优化API成功后调用，安排延迟验证
 */
export function scheduleBidVerification(
  accountId: number,
  adjustments: Array<{
    localKeywordId: number;
    amazonKeywordId: string;
    expectedBid: number;
    campaignId?: number;
    adGroupId?: number;
    isProductTarget?: boolean;
  }>
): string {
  if (adjustments.length === 0) return '';
  
  const items: VerificationItem[] = adjustments.map(adj => ({
    type: 'bid_adjustment' as VerificationType,
    localId: adj.localKeywordId,
    amazonId: adj.amazonKeywordId,
    expectedValue: adj.expectedBid,
    context: {
      campaignId: adj.campaignId,
      adGroupId: adj.adGroupId,
      accountId,
      fieldName: adj.isProductTarget ? 'product_target_bid' : 'keyword_bid',
    },
  }));

  return scheduleVerificationTask(accountId, items);
}

/**
 * 注册预算调整验证任务
 */
export function scheduleBudgetVerification(
  accountId: number,
  adjustments: Array<{
    localCampaignId: number;
    amazonCampaignId: string;
    expectedBudget: number;
  }>
): string {
  if (adjustments.length === 0) return '';
  
  const items: VerificationItem[] = adjustments.map(adj => ({
    type: 'budget_adjustment' as VerificationType,
    localId: adj.localCampaignId,
    amazonId: adj.amazonCampaignId,
    expectedValue: adj.expectedBudget,
    context: { accountId },
  }));

  return scheduleVerificationTask(accountId, items);
}

/**
 * 注册位置倾斜验证任务
 */
export function schedulePlacementVerification(
  accountId: number,
  adjustments: Array<{
    localCampaignId: number;
    amazonCampaignId: string;
    expectedTopOfSearch?: number;
    expectedProductPage?: number;
  }>
): string {
  if (adjustments.length === 0) return '';
  
  const items: VerificationItem[] = adjustments.map(adj => ({
    type: 'placement_adjustment' as VerificationType,
    localId: adj.localCampaignId,
    amazonId: adj.amazonCampaignId,
    expectedValue: {
      topOfSearch: adj.expectedTopOfSearch,
      productPage: adj.expectedProductPage,
    },
    context: { accountId },
  }));

  return scheduleVerificationTask(accountId, items);
}

/**
 * 注册否定关键词验证任务
 */
export function scheduleNegativeKeywordVerification(
  accountId: number,
  negativeKeywords: Array<{
    localId: number;
    amazonKeywordId?: string;
    keywordText: string;
    matchType: string;
    campaignId?: number;
    adGroupId?: number;
  }>
): string {
  if (negativeKeywords.length === 0) return '';
  
  const items: VerificationItem[] = negativeKeywords.map(nk => ({
    type: 'negative_keyword' as VerificationType,
    localId: nk.localId,
    amazonId: nk.amazonKeywordId || '',
    expectedValue: { keywordText: nk.keywordText, matchType: nk.matchType },
    context: {
      campaignId: nk.campaignId,
      adGroupId: nk.adGroupId,
      accountId,
    },
  }));

  return scheduleVerificationTask(accountId, items);
}

/**
 * 注册关键词状态变更验证任务
 */
export function scheduleKeywordStatusVerification(
  accountId: number,
  changes: Array<{
    localKeywordId: number;
    amazonKeywordId: string;
    expectedState: 'enabled' | 'paused' | 'archived';
    adGroupId?: number;
  }>
): string {
  if (changes.length === 0) return '';
  
  const items: VerificationItem[] = changes.map(ch => ({
    type: 'keyword_status' as VerificationType,
    localId: ch.localKeywordId,
    amazonId: ch.amazonKeywordId,
    expectedValue: ch.expectedState,
    context: {
      adGroupId: ch.adGroupId,
      accountId,
    },
  }));

  return scheduleVerificationTask(accountId, items);
}

// ============================================================
// 内部：任务调度与执行
// ============================================================

/**
 * 调度验证任务（内部方法）
 */
function scheduleVerificationTask(accountId: number, items: VerificationItem[]): string {
  const taskId = generateTaskId(accountId, items[0]?.type || 'mixed');
  
  const task: VerificationTask = {
    id: taskId,
    accountId,
    items,
    createdAt: new Date(),
    attempt: 1,
    maxAttempts: 3,
    scheduledAt: new Date(Date.now() + VERIFICATION_DELAYS.firstAttempt * 1000),
  };
  
  pendingTasks.set(taskId, task);
  
  // 设置延迟执行定时器
  const timer = setTimeout(async () => {
    await executeVerificationTask(taskId);
  }, VERIFICATION_DELAYS.firstAttempt * 1000);
  
  activeTimers.set(taskId, timer);
  
  log.info(`v166: 验证任务已注册 taskId=${taskId}, accountId=${accountId}, items=${items.length}, 类型=${items[0]?.type}, 首次验证将在${VERIFICATION_DELAYS.firstAttempt}秒后执行`);
  
  return taskId;
}

/**
 * 执行验证任务
 */
async function executeVerificationTask(taskId: string): Promise<void> {
  const task = pendingTasks.get(taskId);
  if (!task) {
    log.warn(`任务 ${taskId} 不存在，可能已被取消`);
    return;
  }
  
  log.info(`v166: 开始执行验证任务 taskId=${taskId}, attempt=${task.attempt}/${task.maxAttempts}, items=${task.items.length}`);
  
  try {
    // 获取Amazon API客户端
    const syncService = await getAmazonSyncService(task.accountId);
    if (!syncService) {
      log.error(`无法获取accountId=${task.accountId}的API客户端，跳过验证`);
      cleanupTask(taskId);
      return;
    }
    
    // 按类型分组执行验证
    const resultsByType = new Map<VerificationType, VerificationResult[]>();
    const itemsByType = groupItemsByType(task.items);
    
    for (const [type, items] of itemsByType.entries()) {
      const results = await verifyByType(syncService, type, items);
      resultsByType.set(type, results);
    }
    
    // 处理验证结果
    const allResults = Array.from(resultsByType.values()).flat();
    const confirmed = allResults.filter(r => r.status === 'confirmed');
    const conflicts = allResults.filter(r => r.status === 'conflict');
    const notFound = allResults.filter(r => r.status === 'not_found');
    const errors = allResults.filter(r => r.status === 'error');
    
    log.warn(`v166: 验证结果 taskId=${taskId} — 确认=${confirmed.length}, 冲突=${conflicts.length}, 未找到=${notFound.length}, 错误=${errors.length}`);
    
    // 回填确认的数据到本地数据库
    if (confirmed.length > 0) {
      await applyConfirmedResults(confirmed);
    }
    
    // 处理冲突
    if (conflicts.length > 0) {
      await handleConflicts(conflicts);
    }
    
    // 判断是否需要重试
    const unresolved = [...notFound, ...errors];
    if (unresolved.length > 0 && task.attempt < task.maxAttempts) {
      // 安排下一轮验证
      task.attempt++;
      task.items = unresolved.map(r => r.item); // 只重试未解决的项
      
      const delayKey = task.attempt === 2 ? 'secondAttempt' : 'thirdAttempt';
      const delay = VERIFICATION_DELAYS[delayKey];
      task.scheduledAt = new Date(Date.now() + delay * 1000);
      
      const timer = setTimeout(async () => {
        await executeVerificationTask(taskId);
      }, delay * 1000);
      
      activeTimers.set(taskId, timer);
      log.info(`v166: ${unresolved.length}项未解决，安排第${task.attempt}轮验证，${delay}秒后执行`);
    } else {
      // 所有项已处理或已达最大重试次数
      if (unresolved.length > 0) {
        log.warn(`v166: ${unresolved.length}项在${task.maxAttempts}轮验证后仍未解决，保持pending_confirmation状态等待定时同步`);
      }
      cleanupTask(taskId);
    }
    
  } catch (error: unknown) {
    log.error(`v166: 验证任务执行异常 taskId=${taskId}:`, (error as Error).message);
    
    // 异常时安排重试
    if (task.attempt < task.maxAttempts) {
      task.attempt++;
      const delay = VERIFICATION_DELAYS.thirdAttempt; // 异常时使用最长延迟
      const timer = setTimeout(async () => {
        await executeVerificationTask(taskId);
      }, delay * 1000);
      activeTimers.set(taskId, timer);
    } else {
      cleanupTask(taskId);
    }
  }
}

// ============================================================
// 按类型验证
// ============================================================

function groupItemsByType(items: VerificationItem[]): Map<VerificationType, VerificationItem[]> {
  const grouped = new Map<VerificationType, VerificationItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.type) || [];
    existing.push(item);
    grouped.set(item.type, existing);
  }
  return grouped;
}

/**
 * 根据类型执行验证
 */
async function verifyByType(
  syncService: any,
  type: VerificationType,
  items: VerificationItem[]
): Promise<VerificationResult[]> {
  switch (type) {
    case 'bid_adjustment':
      return verifyBidAdjustments(syncService, items);
    case 'budget_adjustment':
      return verifyBudgetAdjustments(syncService, items);
    case 'placement_adjustment':
      return verifyPlacementAdjustments(syncService, items);
    case 'negative_keyword':
      return verifyNegativeKeywords(syncService, items);
    case 'keyword_status':
      return verifyKeywordStatus(syncService, items);
    case 'search_term_migration':
      return verifyBidAdjustments(syncService, items); // 搜索词迁移后的新关键词也通过bid验证
    default:
      log.warn(`未知验证类型: ${type}`);
      return items.map(item => ({ item, status: 'error' as const, message: `未知类型: ${type}` }));
  }
}

/**
 * 验证出价调整
 * 通过Amazon API查询关键词当前出价，与期望值对比
 */
async function verifyBidAdjustments(
  syncService: any,
  items: VerificationItem[]
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  
  // 按adGroupId分组，减少API调用次数
  const byAdGroup = new Map<number, VerificationItem[]>();
  for (const item of items) {
    const adGroupId = item.context?.adGroupId || 0;
    const existing = byAdGroup.get(adGroupId) || [];
    existing.push(item);
    byAdGroup.set(adGroupId, existing);
  }
  
  for (const [adGroupId, groupItems] of byAdGroup.entries()) {
    try {
      // 查询该adGroup下的所有关键词
      const isProductTarget = groupItems[0]?.context?.fieldName === 'product_target_bid';
      let amazonItems: unknown[];
      
      if (isProductTarget) {
        amazonItems = await syncService.client.listSpProductTargets(adGroupId || undefined);
      } else {
        amazonItems = await syncService.client.listSpKeywords(adGroupId || undefined);
      }
      
      // 构建Amazon ID到出价的映射
      const amazonBidMap = new Map<string, number>();
      for (const apiItem of amazonItems) {
        const id = String(isProductTarget ? apiItem.targetId : apiItem.keywordId);
        amazonBidMap.set(id, apiItem.bid);
      }
      
      // 逐项验证
      for (const item of groupItems) {
        const actualBid = amazonBidMap.get(item.amazonId);
        if (actualBid === undefined) {
          results.push({ item, status: 'not_found', message: `Amazon中未找到ID=${item.amazonId}` });
          continue;
        }
        
        const expectedBid = Number(item.expectedValue);
        const tolerance = 0.01; // 允许$0.01的误差（浮点精度）
        
        if (Math.abs(actualBid - expectedBid) <= tolerance) {
          results.push({ item, status: 'confirmed', actualValue: actualBid });
        } else {
          results.push({
            item,
            status: 'conflict',
            actualValue: actualBid,
            message: `期望出价=$${expectedBid.toFixed(2)}, Amazon实际=$${actualBid.toFixed(2)}`,
          });
        }
      }
      
    } catch (error: unknown) {
      log.error(`出价验证API调用失败 adGroupId=${adGroupId}:`, (error as Error).message);
      for (const item of groupItems) {
        results.push({ item, status: 'error', message: (error as Error).message });
      }
    }
  }
  
  return results;
}

/**
 * 验证预算调整
 * 通过Amazon API查询广告活动当前预算，与期望值对比
 */
async function verifyBudgetAdjustments(
  syncService: any,
  items: VerificationItem[]
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  
  try {
    // 查询所有SP广告活动
    const amazonCampaigns = await syncService.client.listSpCampaigns();
    
    // 构建Amazon campaignId到budget的映射
    const amazonBudgetMap = new Map<string, number>();
    for (const campaign of amazonCampaigns) {
      amazonBudgetMap.set(String(campaign.campaignId), campaign.dailyBudget);
    }
    
    for (const item of items) {
      const actualBudget = amazonBudgetMap.get(item.amazonId);
      if (actualBudget === undefined) {
        results.push({ item, status: 'not_found', message: `Amazon中未找到campaignId=${item.amazonId}` });
        continue;
      }
      
      const expectedBudget = Number(item.expectedValue);
      const tolerance = 0.01;
      
      if (Math.abs(actualBudget - expectedBudget) <= tolerance) {
        results.push({ item, status: 'confirmed', actualValue: actualBudget });
      } else {
        results.push({
          item,
          status: 'conflict',
          actualValue: actualBudget,
          message: `期望预算=$${expectedBudget.toFixed(2)}, Amazon实际=$${actualBudget.toFixed(2)}`,
        });
      }
    }
    
  } catch (error: unknown) {
    log.error(`预算验证API调用失败:`, (error as Error).message);
    for (const item of items) {
      results.push({ item, status: 'error', message: (error as Error).message });
    }
  }
  
  return results;
}

/**
 * 验证位置倾斜调整
 * 通过Amazon API查询广告活动的bidding.adjustments，与期望值对比
 */
async function verifyPlacementAdjustments(
  syncService: any,
  items: VerificationItem[]
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  
  try {
    const amazonCampaigns = await syncService.client.listSpCampaigns();
    
    // 构建Amazon campaignId到位置倾斜的映射
    const amazonPlacementMap = new Map<string, { topOfSearch: number; productPage: number }>();
    for (const campaign of amazonCampaigns) {
      const adjustments = campaign.bidding?.adjustments || [];
      let topOfSearch = 0, productPage = 0;
      for (const adj of adjustments) {
        if (adj.predicate === 'placementTop') topOfSearch = adj.percentage;
        if (adj.predicate === 'placementProductPage') productPage = adj.percentage;
      }
      amazonPlacementMap.set(String(campaign.campaignId), { topOfSearch, productPage });
    }
    
    for (const item of items) {
      const actual = amazonPlacementMap.get(item.amazonId);
      if (!actual) {
        results.push({ item, status: 'not_found', message: `Amazon中未找到campaignId=${item.amazonId}` });
        continue;
      }
      
      const expected = item.expectedValue;
      let isMatch = true;
      const mismatches: string[] = [];
      
      if (expected.topOfSearch !== undefined && Math.abs(actual.topOfSearch - expected.topOfSearch) > 1) {
        isMatch = false;
        mismatches.push(`搜索顶部: 期望=${expected.topOfSearch}%, 实际=${actual.topOfSearch}%`);
      }
      if (expected.productPage !== undefined && Math.abs(actual.productPage - expected.productPage) > 1) {
        isMatch = false;
        mismatches.push(`商品页面: 期望=${expected.productPage}%, 实际=${actual.productPage}%`);
      }
      
      if (isMatch) {
        results.push({ item, status: 'confirmed', actualValue: actual });
      } else {
        results.push({
          item,
          status: 'conflict',
          actualValue: actual,
          message: mismatches.join('; '),
        });
      }
    }
    
  } catch (error: unknown) {
    log.error(`位置倾斜验证API调用失败:`, (error as Error).message);
    for (const item of items) {
      results.push({ item, status: 'error', message: (error as Error).message });
    }
  }
  
  return results;
}

/**
 * 验证否定关键词
 * 通过Amazon API查询否定关键词列表，确认新添加的否词是否存在
 */
async function verifyNegativeKeywords(
  syncService: any,
  items: VerificationItem[]
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  
  // 按campaignId分组
  const byCampaign = new Map<number, VerificationItem[]>();
  for (const item of items) {
    const campaignId = item.context?.campaignId || 0;
    const existing = byCampaign.get(campaignId) || [];
    existing.push(item);
    byCampaign.set(campaignId, existing);
  }
  
  for (const [campaignId, groupItems] of byCampaign.entries()) {
    try {
      // 查询该campaign下的所有否定关键词
      const amazonNegatives = await syncService.client.listSpCampaignNegativeKeywords(campaignId || undefined);
      
      // 构建keywordText到记录的映射
      const amazonNegMap = new Map<string, unknown>();
      for (const neg of amazonNegatives) {
        const key = `${neg.keywordText}_${neg.matchType}`.toLowerCase();
        amazonNegMap.set(key, neg);
      }
      
      // 也查询adGroup级别的否定关键词
      const adGroupIds = new Set(groupItems.map(i => i.context?.adGroupId).filter(Boolean));
      for (const adGroupId of adGroupIds) {
        try {
          const adGroupNegatives = await syncService.client.listSpNegativeKeywords(adGroupId);
          for (const neg of adGroupNegatives) {
            const key = `${neg.keywordText}_${neg.matchType}`.toLowerCase();
            amazonNegMap.set(key, neg);
          }
        } catch (e: unknown) {
          log.warn(`查询adGroup ${adGroupId} 否定关键词失败: ${(e as Error).message}`);
        }
      }
      
      for (const item of groupItems) {
        const expected = item.expectedValue;
        const key = `${expected.keywordText}_${expected.matchType}`.toLowerCase();
        const found = amazonNegMap.get(key);
        
        if (found) {
          results.push({ item, status: 'confirmed', actualValue: found });
        } else {
          results.push({
            item,
            status: 'not_found',
            message: `否词 "${expected.keywordText}" (${expected.matchType}) 在Amazon中未找到`,
          });
        }
      }
      
    } catch (error: unknown) {
      log.error(`否词验证API调用失败 campaignId=${campaignId}:`, (error as Error).message);
      for (const item of groupItems) {
        results.push({ item, status: 'error', message: (error as Error).message });
      }
    }
  }
  
  return results;
}

/**
 * 验证关键词状态变更
 */
async function verifyKeywordStatus(
  syncService: any,
  items: VerificationItem[]
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  
  // 按adGroupId分组
  const byAdGroup = new Map<number, VerificationItem[]>();
  for (const item of items) {
    const adGroupId = item.context?.adGroupId || 0;
    const existing = byAdGroup.get(adGroupId) || [];
    existing.push(item);
    byAdGroup.set(adGroupId, existing);
  }
  
  for (const [adGroupId, groupItems] of byAdGroup.entries()) {
    try {
      const amazonKeywords = await syncService.client.listSpKeywords(adGroupId || undefined);
      
      const amazonStateMap = new Map<string, string>();
      for (const kw of amazonKeywords) {
        amazonStateMap.set(String(kw.keywordId), kw.state);
      }
      
      for (const item of groupItems) {
        const actualState = amazonStateMap.get(item.amazonId);
        if (actualState === undefined) {
          results.push({ item, status: 'not_found', message: `Amazon中未找到keywordId=${item.amazonId}` });
          continue;
        }
        
        if (actualState.toLowerCase() === String(item.expectedValue).toLowerCase()) {
          results.push({ item, status: 'confirmed', actualValue: actualState });
        } else {
          results.push({
            item,
            status: 'conflict',
            actualValue: actualState,
            message: `期望状态=${item.expectedValue}, Amazon实际=${actualState}`,
          });
        }
      }
      
    } catch (error: unknown) {
      log.error(`状态验证API调用失败 adGroupId=${adGroupId}:`, (error as Error).message);
      for (const item of groupItems) {
        results.push({ item, status: 'error', message: (error as Error).message });
      }
    }
  }
  
  return results;
}

// ============================================================
// 数据回填
// ============================================================

/**
 * 将已确认的结果回填到本地数据库
 * 更新sync状态为synced，清除pending字段
 */
async function applyConfirmedResults(results: VerificationResult[]): Promise<void> {
  const dbConn = await getDb();
  if (!dbConn) {
    log.error('数据库连接失败，无法回填确认结果');
    return;
  }
  
  try {
    await dbConn.transaction(async (tx) => {
      for (const result of results) {
        const { item } = result;
        
        switch (item.type) {
          case 'bid_adjustment':
          case 'search_term_migration': {
            if (item.context?.fieldName === 'product_target_bid') {
              // 商品定位 - 暂不添加sync状态字段
              log.debug(`v166: ✅ 商品定位 ${item.localId} 出价已确认: $${result.actualValue}`);
            } else {
              // 关键词出价确认 — 清除pending状态
              await tx.update(keywords)
                .set({
                  bid: String(result.actualValue),
                  pendingBid: null,
                  bidSyncStatus: 'synced',
                } as any)
                .where(eq(keywords.id, item.localId));
              log.debug(`v166: ✅ 关键词 ${item.localId} 出价已确认: $${result.actualValue}`);
            }
            break;
          }
          
          case 'budget_adjustment': {
            await tx.update(campaigns)
              .set({
                dailyBudget: String(result.actualValue),
                pendingBudget: null,
                budgetSyncStatus: 'synced',
                lastSyncedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
              } as any)
              .where(eq(campaigns.id, item.localId));
            log.debug(`v166: ✅ 广告活动 ${item.localId} 预算已确认: $${result.actualValue}`);
            break;
          }
          
          case 'placement_adjustment': {
            const updateData: any = {
              placementSyncStatus: 'synced',
              pendingPlacementTop: null,
              pendingPlacementProduct: null,
              lastSyncedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            };
            if (result.actualValue?.topOfSearch !== undefined) {
              updateData.placementTopSearchBidAdjustment = String(result.actualValue.topOfSearch);
            }
            if (result.actualValue?.productPage !== undefined) {
              updateData.placementProductPageBidAdjustment = String(result.actualValue.productPage);
            }
            await tx.update(campaigns)
              .set(updateData)
              .where(eq(campaigns.id, item.localId));
            log.debug(`v166: ✅ 广告活动 ${item.localId} 位置倾斜已确认: top=${result.actualValue?.topOfSearch}%, product=${result.actualValue?.productPage}%`);
            break;
          }
          
          case 'negative_keyword': {
            // 否词确认 — 如果Amazon返回了keywordId，更新本地记录
            if (result.actualValue?.keywordId) {
              log.debug(`v166: ✅ 否词 ${item.localId} 已确认存在于Amazon (amazonId=${result.actualValue.keywordId})`);
            } else {
              log.debug(`v166: ✅ 否词 ${item.localId} 已确认存在于Amazon`);
            }
            break;
          }
          
          case 'keyword_status': {
            log.info(`v166: ✅ 关键词 ${item.localId} 状态已确认: ${result.actualValue}`);
            break;
          }
        }
      }
    });
    
    log.info(`v166: 事务回填完成, ${results.length}项已确认并更新`);
    
  } catch (error: unknown) {
    log.error(`v166: 事务回填失败:`, (error as Error).message);
  }
}

/**
 * 处理冲突结果
 * 当Amazon返回的值与期望值不一致时，标记冲突状态并记录日志
 */
async function handleConflicts(results: VerificationResult[]): Promise<void> {
  const dbConn = await getDb();
  if (!dbConn) return;
  
  try {
    await dbConn.transaction(async (tx) => {
      for (const result of results) {
        const { item } = result;
        
        switch (item.type) {
          case 'bid_adjustment': {
            if (item.context?.fieldName !== 'product_target_bid') {
              // 冲突时：以Amazon的实际值为准，但标记冲突状态
              await tx.update(keywords)
                .set({
                  bid: String(result.actualValue),
                  pendingBid: null,
                  bidSyncStatus: 'conflict',
                } as any)
                .where(eq(keywords.id, item.localId));
            }
            log.warn(`v166: ⚠️ 出价冲突 keyword=${item.localId}: ${result.message}`);
            break;
          }
          
          case 'budget_adjustment': {
            await tx.update(campaigns)
              .set({
                dailyBudget: String(result.actualValue),
                pendingBudget: null,
                budgetSyncStatus: 'conflict',
                lastSyncedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
              } as any)
              .where(eq(campaigns.id, item.localId));
            log.warn(`v166: ⚠️ 预算冲突 campaign=${item.localId}: ${result.message}`);
            break;
          }
          
          case 'placement_adjustment': {
            const updateData: any = {
              placementSyncStatus: 'conflict',
              pendingPlacementTop: null,
              pendingPlacementProduct: null,
              lastSyncedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            };
            if (result.actualValue?.topOfSearch !== undefined) {
              updateData.placementTopSearchBidAdjustment = String(result.actualValue.topOfSearch);
            }
            if (result.actualValue?.productPage !== undefined) {
              updateData.placementProductPageBidAdjustment = String(result.actualValue.productPage);
            }
            await tx.update(campaigns)
              .set(updateData)
              .where(eq(campaigns.id, item.localId));
            log.warn(`v166: ⚠️ 位置倾斜冲突 campaign=${item.localId}: ${result.message}`);
            break;
          }
          
          default: {
            log.warn(`v166: ⚠️ ${item.type}冲突 id=${item.localId}: ${result.message}`);
          }
        }
      }
    });
    
    log.warn(`v166: ${results.length}项冲突已处理（以Amazon实际值为准）`);
    
  } catch (error: unknown) {
    log.error(`v166: 冲突处理事务失败:`, (error as Error).message);
  }
}

// ============================================================
// 工具方法
// ============================================================

/**
 * 清理已完成的任务
 */
function cleanupTask(taskId: string): void {
  pendingTasks.delete(taskId);
  const timer = activeTimers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(taskId);
  }
}

/**
 * 获取当前待处理的验证任务数量（用于监控）
 */
export function getPendingTaskCount(): number {
  return pendingTasks.size;
}

/**
 * 获取所有待处理任务的摘要（用于监控和调试）
 */
export function getPendingTasksSummary(): Array<{
  taskId: string;
  accountId: number;
  itemCount: number;
  attempt: number;
  createdAt: string;
  scheduledAt: string;
}> {
  return Array.from(pendingTasks.values()).map(task => ({
    taskId: task.id,
    accountId: task.accountId,
    itemCount: task.items.length,
    attempt: task.attempt,
    createdAt: task.createdAt.toISOString(),
    scheduledAt: task.scheduledAt.toISOString(),
  }));
}

/**
 * 取消指定账户的所有待处理验证任务
 */
export function cancelTasksForAccount(accountId: number): number {
  let cancelled = 0;
  for (const [taskId, task] of pendingTasks.entries()) {
    if (task.accountId === accountId) {
      cleanupTask(taskId);
      cancelled++;
    }
  }
  if (cancelled > 0) {
    log.debug(`v166: 已取消accountId=${accountId}的${cancelled}个验证任务`);
  }
  return cancelled;
}

// ============================================================
// v256: 自动冲突解决引擎
// ============================================================

/**
 * v256: 自动批量解决 sync_conflicts 中的 pending 冲突
 * 
 * 解决策略:
 * 1. suggested_resolution='use_remote' 的 data_mismatch 冲突 → 自动解决（以亚马逊数据为准）
 * 2. missing_remote 冲突 → 自动忽略（本地数据已删除或不再存在）
 * 3. status_conflict 冲突 → 自动解决（以亚马逊状态为准）
 * 4. 其他冲突 → 保留为 pending，等待手动处理
 * 
 * 每次最多处理 2000 条，避免单次事务过大
 * 由 nextGenMaintenance 定时触发（每30分钟）
 */
export async function autoResolveConflicts(accountId: number): Promise<{ resolved: number; ignored: number; skipped: number }> {
  const dbConn = await getDb();
  if (!dbConn) return { resolved: 0, ignored: 0, skipped: 0 };
  
  let resolved = 0;
  let ignored = 0;
  let skipped = 0;
  
  try {
    // 查找待处理的冲突（最多2000条）
    const pendingConflicts = await dbConn.select({
      id: syncConflicts.id,
      conflictType: syncConflicts.conflictType,
      suggestedResolution: syncConflicts.suggestedResolution,
      entityType: syncConflicts.entityType,
      entityId: syncConflicts.entityId,
    }).from(syncConflicts)
      .where(and(
        eq(syncConflicts.accountId, accountId),
        eq(syncConflicts.resolutionStatus, 'pending')
      ))
      .limit(2000);
    
    if (pendingConflicts.length === 0) return { resolved: 0, ignored: 0, skipped: 0 };
    
    const autoResolveIds: number[] = [];
    const autoIgnoreIds: number[] = [];
    
    for (const conflict of pendingConflicts) {
      if (conflict.conflictType === 'data_mismatch' && conflict.suggestedResolution === 'use_remote') {
        // 数据不匹配且建议使用远程数据 → 自动解决
        autoResolveIds.push(conflict.id);
      } else if (conflict.conflictType === 'missing_remote') {
        // 远程不存在 → 自动忽略
        autoIgnoreIds.push(conflict.id);
      } else if (conflict.conflictType === 'status_conflict' && conflict.suggestedResolution === 'use_remote') {
        // 状态冲突且建议使用远程 → 自动解决
        autoResolveIds.push(conflict.id);
      } else {
        skipped++;
      }
    }
    
    // 批量更新为 resolved
    if (autoResolveIds.length > 0) {
      // 分批处理，每批500条
      for (let i = 0; i < autoResolveIds.length; i += 500) {
        const batch = autoResolveIds.slice(i, i + 500);
        await dbConn.update(syncConflicts)
          .set({
            resolutionStatus: 'resolved',
            resolvedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            resolutionNotes: 'v257: 自动解决 - 以亚马逊实际数据为准 (use_remote)',
          } as any)
          .where(inArray(syncConflicts.id, batch));
      }
      resolved = autoResolveIds.length;
    }
    
    // 批量更新为 ignored
    if (autoIgnoreIds.length > 0) {
      for (let i = 0; i < autoIgnoreIds.length; i += 500) {
        const batch = autoIgnoreIds.slice(i, i + 500);
        await dbConn.update(syncConflicts)
          .set({
            resolutionStatus: 'ignored',
            resolvedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            resolutionNotes: 'v257: 自动忽略 - 远程实体不存在',
          } as any)
          .where(inArray(syncConflicts.id, batch));
      }
      ignored = autoIgnoreIds.length;
    }
    
    log.info(`v257: 自动冲突解决完成 accountId=${accountId}: resolved=${resolved}, ignored=${ignored}, skipped=${skipped}, total=${pendingConflicts.length}`);
    
  } catch (error: unknown) {
    log.error(`v257: 自动冲突解决失败 accountId=${accountId}: ${(error as Error).message}`);
  }
  
  return { resolved, ignored, skipped };
}
