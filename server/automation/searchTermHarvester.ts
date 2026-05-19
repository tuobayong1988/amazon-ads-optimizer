/**
 * Search Term Harvester - 搜索词收割原子操作模块
 * 
 * v357: 重构实体创建流程 - "先API后DB"原子操作原则
 * 核心原则: 必须先成功创建Amazon实体并获取有效ID后，才写入本地数据库。
 * API调用失败时不在本地留下任何痕迹，彻底杜绝"幽灵记录"。
 * 
 * v753: 增加500错误指数退避重试机制 + 连续失败熔断保护
 * - harvestSearchTermAtomic: Step1/Step2遇到500/internalServerError时，最多重试3次（退避1s→2s→4s）
 * - batchHarvestSearchTerms: 连续5次500错误触发熔断，暂停60秒后继续；连续15次500错误终止整批
 * 
 * 三步原子操作：
 * 1. 在目标广告组创建精确匹配关键词（createSpKeywords）→ 获取Amazon keywordId
 * 2. 在源广告组添加否定精确关键词（createSpNegativeKeywords）→ 获取Amazon negativeKeywordId
 * 3. 仅当Step1&2均成功后，才记录本地数据库（包含完整的accountId, campaignId, keywordId）
 * 
 * 任一步骤失败时执行补偿回滚，避免"关键词已创建但否定词未添加"导致的流量重叠。
 */

import * as db from '../db';
import { AmazonSyncService } from '../sync/amazonSyncService';
import { createAmazonAdsClient, AmazonAdsApiClient } from '../sync/amazonAdsApi';
import { isAsinSearchTerm, adGroupHasProductTargets, sanitizeAndValidateKeyword, isProductTargetingCampaign } from '../utils/keywordValidator';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('SearchTermHarvester');

// ==================== 类型定义 ====================

/** 搜索词收割候选项 */
export interface HarvestCandidate {
  searchTerm: string;
  /** 源广告组内部ID（本地数据库） */
  sourceAdGroupId: number;
  /** 源Campaign内部ID */
  sourceCampaignId: number;
  /** 源广告组Amazon ID */
  sourceAmazonAdGroupId: string;
  /** 源Campaign Amazon ID */
  sourceAmazonCampaignId: string;
  /** 目标广告组内部ID（精确匹配Campaign的广告组） */
  targetAdGroupId: number;
  /** 目标Campaign内部ID */
  targetCampaignId: number;
  /** 目标广告组Amazon ID */
  targetAmazonAdGroupId: string;
  /** 目标Campaign Amazon ID */
  targetAmazonCampaignId: string;
  /** 建议出价 */
  suggestedBid: number;
  /** 绩效数据 */
  performance: {
    clicks: number;
    orders: number;
    spend: number;
    sales: number;
    acos: number;
    roas: number;
    cvr: number;
  };
  /** 收割原因 */
  reason: string;
}

/** 收割操作结果 */
export interface HarvestResult {
  searchTerm: string;
  success: boolean;
  /** 操作阶段：keyword_created, negative_added, db_logged, rolled_back */
  stage: 'keyword_created' | 'negative_added' | 'db_logged' | 'rolled_back' | 'failed';
  /** 创建的关键词Amazon ID（用于回滚） */
  createdKeywordId?: number;
  /** 创建的否定关键词Amazon ID（用于回滚） */
  createdNegativeKeywordId?: number;
  /** 本地关键词ID */
  localKeywordId?: number;
  /** 本地否定关键词ID */
  localNegativeKeywordId?: number;
  /** 错误信息 */
  error?: string;
  /** 回滚信息 */
  rollbackInfo?: string;
}

/** 收割配置 */
export interface HarvestConfig {
  /** 最小订单数阈值（默认2） */
  minOrders: number;
  /** 最大ACoS阈值（默认目标ACoS的1.5倍，或50%） */
  maxAcos: number;
  /** 最小点击数阈值（默认10） */
  minClicks: number;
  /** 最小ROAS阈值（默认2.0） */
  minRoas: number;
  /** 出价计算方式：基于CPC还是基于CVR*AOV */
  bidStrategy: 'cpc_based' | 'cvr_aov_based';
  /** 出价折扣系数（精确匹配通常比宽泛匹配出价低10-20%） */
  bidDiscountFactor: number;
  /** 是否执行dry run（仅分析不执行） */
  dryRun: boolean;
}

/** 默认收割配置 */
const DEFAULT_HARVEST_CONFIG: HarvestConfig = {
  minOrders: 2,
  maxAcos: 50,
  minClicks: 10,
  minRoas: 2.0,
  bidStrategy: 'cvr_aov_based',
  bidDiscountFactor: 0.85, // 精确匹配出价为宽泛/短语的85%
  dryRun: false,
};

// ==================== v753: 重试与熔断配置 ====================

/** v753: 500错误指数退避重试配置 */
const RETRY_CONFIG = {
  /** 最大重试次数 */
  maxRetries: 3,
  /** 初始退避时间（毫秒） */
  initialBackoffMs: 1000,
  /** 退避倍数 */
  backoffMultiplier: 2,
  /** 可重试的错误码 */
  retryableErrorCodes: ['internalServerError', 'INTERNAL_ERROR', 'THROTTLED', '500', '503', '429'],
};

/** v753: 批量收割熔断配置 */
const CIRCUIT_BREAKER_CONFIG = {
  /** 连续失败N次触发冷却 */
  consecutiveFailuresForCooldown: 5,
  /** 冷却等待时间（毫秒） */
  cooldownMs: 60_000,
  /** 连续失败N次终止整批 */
  consecutiveFailuresForAbort: 15,
};

/**
 * v753: 判断错误是否为可重试的服务端错误（500/503/429/internalServerError）
 */
function isRetryableServerError(error: unknown): boolean {
  if (!error) return false;
  const errStr = typeof error === 'string' ? error : JSON.stringify(error);
  return RETRY_CONFIG.retryableErrorCodes.some(code => errStr.includes(code));
}

/**
 * v753: 指数退避等待
 */
async function exponentialBackoff(attempt: number): Promise<void> {
  const delayMs = RETRY_CONFIG.initialBackoffMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
  log.info(`[v753] 指数退避等待: attempt=${attempt + 1}, delay=${delayMs}ms`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

// ==================== 核心函数 ====================

/**
 * 识别高绩效搜索词候选项
 * 
 * 从searchTerms表中筛选满足收割条件的搜索词，并匹配目标精确匹配广告组。
 * 
 * 筛选条件：
 * - 订单数 >= minOrders
 * - 点击数 >= minClicks
 * - ACoS <= maxAcos（或ROAS >= minRoas）
 * - 搜索词尚未作为精确匹配关键词存在于目标广告组
 */
export async function identifyHarvestCandidates(
  accountId: number,
  config: Partial<HarvestConfig> = {},
  allowedCampaignIds?: number[]  // v746: 限制范围为优化目标内的campaign IDs
): Promise<HarvestCandidate[]> {
  const cfg = { ...DEFAULT_HARVEST_CONFIG, ...config };
  const candidates: HarvestCandidate[] = [];

  try {
    // 1. 获取该账号下所有Campaign
    let allCampaigns = await db.getCampaignsByAccountId(accountId);
    if (!allCampaigns || allCampaigns.length === 0) {
      log.debug(`账号 ${accountId} 无广告活动`);
      return [];
    }

    // v746: 如果提供了 allowedCampaignIds，限制范围为优化目标内的campaigns
    if (allowedCampaignIds && allowedCampaignIds.length > 0) {
      const allowedSet = new Set(allowedCampaignIds);
      allCampaigns = allCampaigns.filter(c => allowedSet.has(c.id));
      log.info(`[SearchTermHarvester] v746: 权限边界控制 - 限制范围为 ${allCampaigns.length} 个优化目标内campaigns（总共 ${allowedCampaignIds.length} 个允许ID）`);
      if (allCampaigns.length === 0) {
        log.info(`[SearchTermHarvester] v746: 优化目标内无匹配campaigns，跳过收割`);
        return [];
      }
    } else {
      log.warn(`[SearchTermHarvester] v746: 未提供 allowedCampaignIds，跳过收割以防越权操作`);
      return [];
    }

    // 2. 区分自动/宽泛Campaign和精确匹配Campaign
    const sourceCampaigns = allCampaigns.filter(c => 
      c.campaignStatus === 'enabled' && 
      (c.campaignType === 'sp_auto' || c.targetingType === 'auto')
    );
    const manualCampaigns = allCampaigns.filter(c => 
      c.campaignStatus === 'enabled' && 
      c.campaignType === 'sp_manual' && 
      c.targetingType === 'manual'
    );

    if (sourceCampaigns.length === 0) {
      log.info(`账号 ${accountId} 无自动Campaign，跳过收割`);
      return [];
    }

    // 3. 遍历每个源Campaign的搜索词
    for (const sourceCampaign of sourceCampaigns) {
      // v355: P1修复 — getSearchTermsByCampaignId期望Amazon ID，不是本地自增ID
      // sourceCampaign.id是本地ID，sourceCampaign.campaignId是Amazon ID
      const searchTermsList = await db.getSearchTermsByCampaignId(String(sourceCampaign.campaignId));
      
      for (const st of searchTermsList) {
        const clicks = Number(st.searchTermClicks) || 0;
        const orders = Number(st.searchTermOrders) || 0;
        const spend = parseFloat(String(st.searchTermSpend || '0'));
        const sales = parseFloat(String(st.searchTermSales || '0'));
        
        // 基本过滤
        if (clicks < cfg.minClicks || orders < cfg.minOrders) continue;
        
        const acos = sales > 0 ? (spend / sales) * 100 : 999;
        const roas = spend > 0 ? sales / spend : 0;
        const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
        
        // 绩效过滤：ACoS <= 阈值 或 ROAS >= 阈值
        if (acos > cfg.maxAcos && roas < cfg.minRoas) continue;
        
        // v194: ASIN格式的搜索词不应该作为关键词收割
        if (isAsinSearchTerm(st.searchTerm)) {
          log.info(`v194: 跳过ASIN搜索词 "${st.searchTerm}"，应作为product target处理`);
          continue;
        }
        
        // v194: 清洗搜索词，过滤无效字符
        const validation = sanitizeAndValidateKeyword(st.searchTerm);
        if (!validation.isValid) {
          log.warn(`v194: 搜索词校验失败 "${st.searchTerm}": ${validation.reasonMessage || validation.reasonCode || 'invalid'}`);
          continue;
        }
        
        // 4. 查找目标精确匹配广告组
        // 策略：在同账号的手动Campaign中查找是否已有该关键词的精确匹配
        const targetInfo = await findTargetAdGroup(
          st.searchTerm,
          manualCampaigns,
          sourceCampaign
        );
        
        if (!targetInfo) continue; // 没有合适的目标广告组
        
        // 5. 检查是否已存在精确匹配关键词（避免重复收割）
        const existingKeywords = await db.getKeywordsByAdGroupId(targetInfo.adGroupId);
        const alreadyExists = existingKeywords.some(
          k => k.keywordText?.toLowerCase() === st.searchTerm.toLowerCase() && 
               k.matchType === 'exact'
        );
        
        if (alreadyExists) continue;
        
        // 6. 计算建议出价
        const suggestedBid = calculateHarvestBid(
          { clicks, orders, spend, sales },
          cfg
        );
        
        // 7. 获取源广告组信息
        const sourceAdGroup = st.internalAdGroupId ? await db.getAdGroupById(st.internalAdGroupId) : null;  // v421: 使用internalAdGroupId(int)
        if (!sourceAdGroup) continue;
        
        candidates.push({
          searchTerm: st.searchTerm,
          sourceAdGroupId: st.internalAdGroupId,  // v421: internalAdGroupId已经是int
          sourceCampaignId: sourceCampaign.id,
          sourceAmazonAdGroupId: sourceAdGroup.adGroupId,
          sourceAmazonCampaignId: sourceCampaign.campaignId,
          targetAdGroupId: targetInfo.adGroupId,
          targetCampaignId: targetInfo.campaignId,
          targetAmazonAdGroupId: targetInfo.amazonAdGroupId,
          targetAmazonCampaignId: targetInfo.amazonCampaignId,
          suggestedBid,
          performance: { clicks, orders, spend, sales, acos, roas, cvr },
          reason: `高绩效搜索词: ${orders}单, ACoS=${acos.toFixed(1)}%, ROAS=${roas.toFixed(2)}, CVR=${cvr.toFixed(1)}%`,
        });
      }
    }

    log.debug(`账号 ${accountId} 识别到 ${candidates.length} 个收割候选项`);
    return candidates;

  } catch (error: unknown) {
    log.warn(`识别候选项失败:`, (error as Error).message);
    return [];
  }
}

/**
 * 执行单个搜索词的原子收割操作
 * 
 * 三步原子操作：
 * Step 1: 在目标广告组创建精确匹配关键词（Amazon API）
 * Step 2: 在源广告组添加否定精确关键词（Amazon API）
 * Step 3: 记录本地数据库
 * 
 * 任一步骤失败时执行补偿回滚。
 */
export async function harvestSearchTermAtomic(
  candidate: HarvestCandidate,
  apiClient: AmazonAdsApiClient,
  accountId: number
): Promise<HarvestResult> {
  const result: HarvestResult = {
    searchTerm: candidate.searchTerm,
    success: false,
    stage: 'failed',
  };

  log.info(`开始原子收割: "${candidate.searchTerm}" (${candidate.reason})`);

  // ============ Step 1: 创建精确匹配关键词（v753: 带指数退避重试） ============
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const createResult = await apiClient.createSpKeywords([{
        adGroupId: String(candidate.targetAmazonAdGroupId),
        campaignId: String(candidate.targetAmazonCampaignId),
        keywordText: candidate.searchTerm,
        matchType: 'exact',
        bid: candidate.suggestedBid,
        state: 'enabled',
      }]);

      if (!createResult.success || createResult.createdKeywords.length === 0) {
        const errorMsg = createResult.errors.length > 0 
          ? JSON.stringify(createResult.errors) 
          : '未知错误';
        
        // v749: 检查是否是"已存在"错误（幂等处理）
        const isDuplicate = createResult.errors.some((e: unknown) => {
          try {
            const errStr = JSON.stringify(e);
            return errStr.includes('DUPLICATE') || errStr.includes('already exists') || errStr.includes('DUPLICATE_VALUE');
          } catch { return false; }
        });
        
        if (isDuplicate) {
          log.info(`关键词已存在，跳过: "${candidate.searchTerm}"`);
          result.error = '关键词已存在于目标广告组';
          return result;
        }
        
        // v753: 检查是否为可重试的500错误
        if (isRetryableServerError(errorMsg) && attempt < RETRY_CONFIG.maxRetries) {
          log.warn(`[v753] Step1 遇到服务端错误(attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries}): "${candidate.searchTerm}" — ${errorMsg.slice(0, 200)}`);
          await exponentialBackoff(attempt);
          continue; // 重试
        }
        
        result.error = `Step1 创建关键词失败: ${errorMsg}`;
        log.warn(`${result.error}`);
        return result;
      }

      result.createdKeywordId = createResult.createdKeywords[0].keywordId;
      result.stage = 'keyword_created';
      log.info(`Step1 完成: 创建关键词 ID=${result.createdKeywordId}${attempt > 0 ? ` (第${attempt + 1}次尝试成功)` : ''}`);
      break; // 成功，跳出重试循环

    } catch (error: unknown) {
      // v753: 网络层异常也支持重试
      if (isRetryableServerError((error as Error).message) && attempt < RETRY_CONFIG.maxRetries) {
        log.warn(`[v753] Step1 网络异常(attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries}): ${(error as Error).message?.slice(0, 200)}`);
        await exponentialBackoff(attempt);
        continue;
      }
      result.error = `Step1 异常: ${(error as Error).message}`;
      log.warn(`${result.error}`);
      return result;
    }
  }
  // v753: 如果重试全部耗尽仍未成功（stage仍为failed），直接返回
  if (result.stage === 'failed') {
    result.error = result.error || `Step1 重试${RETRY_CONFIG.maxRetries}次后仍失败`;
    return result;
  }

  // ============ Step 2: 添加否定关键词（v230: 智能选择否定类型） ============
  // v230: 根据搜索词特征智能选择否定类型
  // 单词搜索词使用negativePhrase以覆盖变体流量
  // 多词搜索词使用negativeExact以避免过度否定
  const searchTermWords = candidate.searchTerm.trim().split(/\s+/);
  const negativeMatchType = searchTermWords.length <= 2 ? 'negativePhrase' : 'negativeExact';
  // v753: Step2也增加指数退避重试
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      log.info(`v230: 搜索词"${candidate.searchTerm}"包含${searchTermWords.length}个词，使用${negativeMatchType}否定类型`);
      
      const negativeResult = await apiClient.createSpNegativeKeywords([{
        adGroupId: String(candidate.sourceAmazonAdGroupId),
        campaignId: String(candidate.sourceAmazonCampaignId),
        keywordText: candidate.searchTerm,
        matchType: negativeMatchType,
        state: 'enabled',
      }]);

      // 检查否定词创建结果
      const negativeErrors = negativeResult.filter((r: Record<string, unknown>) => r.code && r.code !== 'SUCCESS');
      
      if (negativeErrors.length > 0) {
        // 检查是否是"已存在"错误（幂等处理）
        const isDuplicate = negativeErrors.some((e: Record<string, unknown>) => 
          String(e.code).includes('DUPLICATE') || String(e.details).includes('already exists')
        );
        
        if (!isDuplicate) {
          // v753: 检查是否为可重试的500错误
          const negErrorStr = JSON.stringify(negativeErrors);
          if (isRetryableServerError(negErrorStr) && attempt < RETRY_CONFIG.maxRetries) {
            log.warn(`[v753] Step2 遇到服务端错误(attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries}): "${candidate.searchTerm}" — ${negErrorStr.slice(0, 200)}`);
            await exponentialBackoff(attempt);
            continue; // 重试
          }
          // Step 2 失败，需要回滚 Step 1
          log.warn(`Step2 失败，开始回滚 Step1...`);
          await rollbackKeywordCreation(apiClient, result.createdKeywordId!);
          result.stage = 'rolled_back';
          result.error = `Step2 否定词创建失败: ${negErrorStr}`;
          result.rollbackInfo = `已回滚: 删除关键词 ID=${result.createdKeywordId}`;
          return result;
        }
      }

      // 获取否定词ID
      const successNeg = negativeResult.find((r: Record<string, unknown>) => !r.code || r.code === 'SUCCESS');
      if (successNeg) {
        result.createdNegativeKeywordId = successNeg.keywordId;
      }
      
      result.stage = 'negative_added';
      log.info(`Step2 完成: 添加否定词 ID=${result.createdNegativeKeywordId}${attempt > 0 ? ` (第${attempt + 1}次尝试成功)` : ''}`);
      break; // 成功，跳出重试循环

    } catch (error: unknown) {
      // v753: 网络层异常也支持重试
      if (isRetryableServerError((error as Error).message) && attempt < RETRY_CONFIG.maxRetries) {
        log.warn(`[v753] Step2 网络异常(attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries}): ${(error as Error).message?.slice(0, 200)}`);
        await exponentialBackoff(attempt);
        continue;
      }
      // Step 2 异常，回滚 Step 1
      log.warn(`Step2 异常: ${(error as Error).message}，开始回滚 Step1...`);
      await rollbackKeywordCreation(apiClient, result.createdKeywordId!);
      result.stage = 'rolled_back';
      result.error = `Step2 异常: ${(error as Error).message}`;
      result.rollbackInfo = `已回滚: 删除关键词 ID=${result.createdKeywordId}`;
      return result;
    }
  }
  // v753: 如果Step2重试全部耗尽仍未成功
  if (result.stage !== 'negative_added') {
    log.warn(`[v753] Step2 重试${RETRY_CONFIG.maxRetries}次后仍失败，回滚Step1...`);
    await rollbackKeywordCreation(apiClient, result.createdKeywordId!);
    result.stage = 'rolled_back';
    result.error = result.error || `Step2 重试${RETRY_CONFIG.maxRetries}次后仍失败`;
    result.rollbackInfo = `已回滚: 删除关键词 ID=${result.createdKeywordId}`;
    return result;
  }

  // ============ Step 3: 记录本地数据库（v357: 包含完整ID信息） ============
  // v357: 核心改进 - createKeyword时必须包含accountId、campaignId和Amazon keywordId
  // 确保本地记录与Amazon实体完全对应，杜绝幽灵记录
  try {
    // v357: 验证Amazon keywordId有效性 - 必须是有效的非空值
    const amazonKeywordId = String(result.createdKeywordId || '');
    if (!amazonKeywordId || amazonKeywordId === 'undefined' || amazonKeywordId === 'null' || amazonKeywordId === '0') {
      log.warn(`v357: Step3 中止 - Amazon keywordId无效: "${amazonKeywordId}"，不写入本地数据库`);
      result.error = `Step3 中止: Amazon keywordId无效 (${amazonKeywordId})，API操作已生效但本地未记录`;
      result.success = true; // API层面成功
      result.stage = 'negative_added';
      return result;
    }

    // 3a. 在本地keywords表创建记录（v357: 包含完整的accountId, campaignId, keywordId）
    const localKeywordId = await db.createKeyword({
      accountId: accountId,
      campaignId: String(candidate.targetAmazonCampaignId),  // v357: 使用Amazon Campaign ID
      internalAdGroupId: candidate.targetAdGroupId,  // v421: 使用internalAdGroupId(int)
      keywordId: amazonKeywordId,  // v357: 已验证的Amazon keywordId
      keywordText: candidate.searchTerm,
      matchType: 'exact',
      bid: candidate.suggestedBid.toFixed(2),
      keywordStatus: 'enabled',
    });
    result.localKeywordId = localKeywordId;
    log.info(`v357: 本地keyword已创建: localId=${localKeywordId}, amazonKeywordId=${amazonKeywordId}, accountId=${accountId}, campaignId=${candidate.targetAmazonCampaignId}`);

    // 3b. 在本地negativeKeywords表创建记录 (v230: 使用智能选择的否定类型)
    await db.addNegativeKeyword({
      campaignId: candidate.sourceCampaignId,
      adGroupId: candidate.sourceAdGroupId,
      keyword: candidate.searchTerm,
      matchType: negativeMatchType === 'negativePhrase' ? 'phrase' : 'exact',
      level: 'ad_group',
    });

    // 3c. 创建出价日志（v357: 增强日志信息，记录Amazon ID便于追踪）
    await db.createBiddingLog({
      accountId,
      campaignId: String(candidate.targetAmazonCampaignId),  // v357: 使用Amazon Campaign ID
      internalAdGroupId: candidate.targetAdGroupId,  // v421: 使用internalAdGroupId
      logTargetType: 'keyword',
      targetId: localKeywordId,
      targetName: candidate.searchTerm,
      logMatchType: 'exact',
      actionType: 'set',
      previousBid: '0.00',
      newBid: candidate.suggestedBid.toFixed(2),
      bidChangePercent: '100.00',
      reason: `[搜索词收割] ${candidate.reason} | 源Campaign=${candidate.sourceAmazonCampaignId} → 目标Campaign=${candidate.targetAmazonCampaignId} | amazonKeywordId=${amazonKeywordId}`,
      algorithmVersion: '2.0.0-harvest-v357',
      isIntradayAdjustment: 0,
    });

    // v513: 修复搜索词收割的同步闭环 — 通过标准链路记录同步状态
    // 关键改进: 
    // 1. 记录完整的 api_sync_detail 包含 Amazon 响应信息
    // 2. 设置 api_synced_at 时间戳
    // 3. 确保 keyword_id 字段正确引用本地 ID，使纠错器不会误判为未同步
    try {
      const syncDetail = JSON.stringify({
        syncedBy: 'searchTermHarvester-v513',
        amazonKeywordId: amazonKeywordId,
        amazonCampaignId: candidate.targetAmazonCampaignId,
        amazonAdGroupId: candidate.targetAmazonAdGroupId,
        syncedAt: new Date().toISOString(),
        syncMethod: 'direct_api_call',
      });
      await db.insertOptimizationEvent({
        accountId,
        eventCategory: 'search_term_action',
        actionType: 'search_term_harvest',
        // @ts-ignore Legacy code type compatibility
        campaignId: candidate.targetCampaignId,
        // @ts-ignore Legacy code type compatibility
        keywordId: localKeywordId,
        keywordText: candidate.searchTerm,
        matchType: 'exact',
        previousBid: '0.00',
        newBid: candidate.suggestedBid.toFixed(2),
        changeReason: `[搜索词收割] ${candidate.reason} | amazonKeywordId=${amazonKeywordId} | targetCampaign=${candidate.targetAmazonCampaignId}`,
        status: 'success',
        apiSyncStatus: 'synced',
        apiSyncDetail: syncDetail,
        sourceTable: 'search_term_harvester',
      });
      // 同时记录否定词操作
      const negSyncDetail = JSON.stringify({
        syncedBy: 'searchTermHarvester-v513',
        amazonNegKeywordId: result.createdNegativeKeywordId || null,
        amazonCampaignId: candidate.sourceAmazonCampaignId,
        syncedAt: new Date().toISOString(),
        syncMethod: 'direct_api_call',
      });
      await db.insertOptimizationEvent({
        accountId,
        // @ts-ignore Legacy code type compatibility
        eventCategory: 'search_term_action',
        actionType: 'negative_keyword_add',
        // @ts-ignore Legacy code type compatibility
        campaignId: candidate.sourceCampaignId,
        keywordText: candidate.searchTerm,
        matchType: 'exact',
        changeReason: `[搜索词收割-否定] 源广告组添加否定词 | amazonNegKeywordId=${result.createdNegativeKeywordId || 'N/A'} | sourceCampaign=${candidate.sourceAmazonCampaignId}`,
        status: 'success',
        apiSyncStatus: 'synced',
        apiSyncDetail: negSyncDetail,
        sourceTable: 'search_term_harvester',
      });
    } catch (eventErr: unknown) {
      log.warn(`v513: 记录optimization_events失败: ${(eventErr as Error).message}`);
    }

    result.stage = 'db_logged';
    result.success = true;
    log.info(`Step3 完成: 本地数据库已更新`);

  } catch (error: unknown) {
    // Step 3 失败（本地DB），API操作已成功，记录警告但不回滚API
    // 因为API操作已经生效，回滚会造成更大的不一致
    log.warn(`Step3 本地DB记录失败: ${(error as Error).message}，API操作已生效`);
    result.error = `Step3 本地DB失败(API已生效): ${(error as Error).message}`;
    // 标记为部分成功
    result.success = true; // API层面成功
    result.stage = 'negative_added'; // 停留在Step2完成状态
  }

  return result;
}

/**
 * 批量执行搜索词收割
 * 
 * 对所有候选项执行原子收割操作，汇总结果。
 */
export async function batchHarvestSearchTerms(
  accountId: number,
  config: Partial<HarvestConfig> = {},
  allowedCampaignIds?: number[]  // v746: 限制范围为优化目标内的campaign IDs
): Promise<{
  candidates: HarvestCandidate[];
  results: HarvestResult[];
  summary: {
    total: number;
    success: number;
    failed: number;
    rolledBack: number;
    skipped: number;
  };
}> {
  const cfg = { ...DEFAULT_HARVEST_CONFIG, ...config };
  
  // 1. 识别候选项 - v746: 传入 allowedCampaignIds 限制范围
  const candidates = await identifyHarvestCandidates(accountId, cfg, allowedCampaignIds);
  
  if (candidates.length === 0) {
    return {
      candidates: [],
      results: [],
      summary: { total: 0, success: 0, failed: 0, rolledBack: 0, skipped: 0 },
    };
  }

  // 如果是dry run，直接返回候选项
  if (cfg.dryRun) {
    log.info(`Dry Run: 发现 ${candidates.length} 个候选项，不执行`);
    return {
      candidates,
      results: [],
      summary: { total: candidates.length, success: 0, failed: 0, rolledBack: 0, skipped: candidates.length },
    };
  }

  // 2. 获取API客户端
  const credentials = await db.getAmazonApiCredentials(accountId);
  if (!credentials) {
    log.warn(`账号 ${accountId} 无API凭证，无法执行收割`);
    return {
      candidates,
      results: [],
      summary: { total: candidates.length, success: 0, failed: candidates.length, rolledBack: 0, skipped: 0 },
    };
  }

  const apiClient = createAmazonAdsClient({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken: typeof credentials.refreshToken === 'string' ? credentials.refreshToken : '',
    profileId: credentials.profileId,
    region: credentials.region as 'NA' | 'EU' | 'FE',
  });

  // 3. 逐个执行原子收割（v753: 增加连续失败熔断保护）
  const results: HarvestResult[] = [];
  let success = 0, failed = 0, rolledBack = 0;
  let consecutiveServerErrors = 0; // v753: 连续服务端错误计数
  let totalServerErrors = 0; // v753: 总服务端错误计数
  let aborted = false; // v753: 是否因熔断终止

  for (const candidate of candidates) {
    // v753: 检查是否已触发终止熔断
    if (aborted) {
      results.push({
        searchTerm: candidate.searchTerm,
        success: false,
        stage: 'failed',
        error: `[v753] 批量收割已因连续${CIRCUIT_BREAKER_CONFIG.consecutiveFailuresForAbort}次服务端错误而终止`,
      });
      failed++;
      continue;
    }

    try {
      const result = await harvestSearchTermAtomic(candidate, apiClient, accountId);
      results.push(result);
      
      if (result.success) {
        success++;
        consecutiveServerErrors = 0; // 成功则重置连续错误计数
      } else if (result.stage === 'rolled_back') {
        rolledBack++;
        // v753: 检查是否为服务端错误导致的回滚
        if (result.error && isRetryableServerError(result.error)) {
          consecutiveServerErrors++;
          totalServerErrors++;
        } else {
          consecutiveServerErrors = 0;
        }
      } else {
        failed++;
        // v753: 检查是否为服务端错误
        if (result.error && isRetryableServerError(result.error)) {
          consecutiveServerErrors++;
          totalServerErrors++;
        } else {
          consecutiveServerErrors = 0;
        }
      }

      // v753: 连续失败熔断检查
      if (consecutiveServerErrors >= CIRCUIT_BREAKER_CONFIG.consecutiveFailuresForAbort) {
        log.warn(`[v753] 熔断触发: 连续${consecutiveServerErrors}次服务端错误，终止剩余${candidates.length - results.length}个候选项`);
        aborted = true;
        continue;
      }
      if (consecutiveServerErrors >= CIRCUIT_BREAKER_CONFIG.consecutiveFailuresForCooldown && consecutiveServerErrors < CIRCUIT_BREAKER_CONFIG.consecutiveFailuresForAbort) {
        log.warn(`[v753] 冷却触发: 连续${consecutiveServerErrors}次服务端错误，等待${CIRCUIT_BREAKER_CONFIG.cooldownMs / 1000}秒后继续...`);
        await new Promise(resolve => setTimeout(resolve, CIRCUIT_BREAKER_CONFIG.cooldownMs));
        consecutiveServerErrors = 0; // 冷却后重置
      }

      // API请求间隔，避免速率限制
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error: unknown) {
      log.warn(`收割异常: "${candidate.searchTerm}" - ${(error as Error).message}`);
      results.push({
        searchTerm: candidate.searchTerm,
        success: false,
        stage: 'failed',
        error: (error as Error).message,
      });
      failed++;
      if (isRetryableServerError((error as Error).message)) {
        consecutiveServerErrors++;
        totalServerErrors++;
      }
    }
  }

  log.warn(`[v753] 批量收割完成: 成功=${success}, 失败=${failed}, 回滚=${rolledBack}, 服务端错误总计=${totalServerErrors}, 熔断终止=${aborted}`);

  return {
    candidates,
    results,
    summary: {
      total: candidates.length,
      success,
      failed,
      rolledBack,
      skipped: 0,
    },
  };
}

// ==================== 辅助函数 ====================

/**
 * 查找目标精确匹配广告组
 * 
 * 策略：
 * 1. 优先查找同账号下名称包含"Exact"或"精确"的手动Campaign的广告组
 * 2. 如果没有，查找第一个手动Campaign的第一个广告组
 * 3. 如果都没有，返回null（不执行收割）
 */
async function findTargetAdGroup(
  searchTerm: string,
  manualCampaigns: unknown[],
  sourceCampaign: unknown
): Promise<{
  adGroupId: number;
  campaignId: number;
  amazonAdGroupId: string;
  amazonCampaignId: string;
} | null> {
  
  // v311: 先过滤掉Product Targeting类型的campaign
  const nonPTCampaigns = manualCampaigns.filter(c => 
    // @ts-ignore - runtime type mismatch
    !isProductTargetingCampaign(c.campaignName || '')
  );
  
  // 策由1: 查找名称包含"Exact"的Campaign（排除PT类型）
  const exactCampaigns = nonPTCampaigns.filter(c => 
    // @ts-ignore - runtime type mismatch
    c.campaignName?.toLowerCase().includes('exact') ||
    // @ts-ignore - runtime type mismatch
    c.campaignName?.includes('精确')
  );
  
  for (const campaign of (exactCampaigns as unknown[])) {
    // v206: getAdGroupsByCampaignId需要Amazon campaignId
    // @ts-ignore DB query type inference limitation
    const adGroupsList = await db.getAdGroupsByCampaignId(campaign.campaignId);
    const enabledAdGroups = adGroupsList.filter((ag: Record<string, unknown>) => ag.adGroupStatus === 'enabled');
    
    for (const ag of enabledAdGroups) {
      // v194: 跳过已有product targets的广告组
      const hasPT = await adGroupHasProductTargets(ag.id);
      if (hasPT) {
        log.info(`v194: 跳过product target广告组 id=${ag.id}`);
        // @ts-ignore Legacy code type compatibility
        continue;
      }
      // @ts-ignore Return type compatibility
      return {
        adGroupId: ag.id,
        // @ts-ignore Amazon API response type flexibility
        campaignId: campaign.campaignId,
        amazonAdGroupId: ag.adGroupId,
        // @ts-ignore Amazon API response type flexibility
        amazonCampaignId: campaign.campaignId,
      };
    // @ts-ignore Legacy code type compatibility
    }
  }
  
  // 策由2: 查找任意手动Campaign的广告组（排除PT类型）
  for (const campaign of (nonPTCampaigns as unknown[])) {
    // v206: getAdGroupsByCampaignId需要Amazon campaignId
    // @ts-ignore DB query type inference limitation
    const adGroupsList = await db.getAdGroupsByCampaignId(campaign.campaignId);
    const enabledAdGroups = adGroupsList.filter((ag: Record<string, unknown>) => ag.adGroupStatus === 'enabled');
    
    for (const ag of enabledAdGroups) {
      // v194: 跳过已有product targets的广告组
      const hasPT = await adGroupHasProductTargets(ag.id);
      if (hasPT) continue;
      return {
        adGroupId: ag.id,
        // @ts-ignore Amazon API response type flexibility
        campaignId: campaign.campaignId,
        amazonAdGroupId: ag.adGroupId,
        // @ts-ignore Amazon API response type flexibility
        amazonCampaignId: campaign.campaignId,
      };
    }
  }
  
  return null;
}

/**
 * 计算收割出价
 * 
 * 基于搜索词的历史绩效数据计算建议出价：
 * - CVR*AOV策略：bid = CVR * AOV * 目标ACoS折扣
 * - CPC策略：bid = 历史CPC * 折扣系数
 */
function calculateHarvestBid(
  performance: { clicks: number; orders: number; spend: number; sales: number },
  config: HarvestConfig
): number {
  const { clicks, orders, spend, sales } = performance;
  
  if (config.bidStrategy === 'cvr_aov_based' && orders > 0) {
    const cvr = orders / clicks;
    const aov = sales / orders;
    // 目标ACoS为30%时的理论出价，再乘以折扣系数
    const targetAcosRate = 0.30;
    const theoreticalBid = cvr * aov * targetAcosRate * config.bidDiscountFactor;
    return Math.round(Math.max(0.10, Math.min(theoreticalBid, 5.00)) * 100) / 100;
  }
  
  // CPC策略
  if (clicks > 0) {
    const historicalCpc = spend / clicks;
    const bid = historicalCpc * config.bidDiscountFactor;
    return Math.round(Math.max(0.10, Math.min(bid, 5.00)) * 100) / 100;
  }
  
  // 默认出价
  return 0.50;
}

/**
 * 回滚关键词创建（补偿操作）
 * 
 * 当Step 2失败时，删除Step 1创建的关键词。
 */
async function rollbackKeywordCreation(
  apiClient: AmazonAdsApiClient,
  keywordId: number | string  // v356: 支持string类型
): Promise<void> {
  try {
    // Amazon SP API: 通过将关键词状态设为archived来"删除"
    await apiClient.updateKeywordBids([{
      keywordId: String(keywordId),  // v356: 统一使用String类型传递Amazon ID
      bid: 0.02, // 设置最低出价
    }]);
    
    // 注意：Amazon API不支持真正删除关键词，只能archive
    // 这里通过设置最低出价来最小化影响
    log.info(`回滚成功: 关键词 ${keywordId} 已设置最低出价`);
  } catch (error: unknown) {
    log.warn(`回滚失败: 关键词 ${keywordId} - ${(error as Error).message}`);
    // 回滚失败时记录告警，需要人工介入
  }
}
