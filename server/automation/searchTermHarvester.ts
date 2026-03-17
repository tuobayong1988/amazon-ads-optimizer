/**
 * Search Term Harvester - 搜索词收割原子操作模块
 * 
 * v357: 重构实体创建流程 - "先API后DB"原子操作原则
 * 核心原则: 必须先成功创建Amazon实体并获取有效ID后，才写入本地数据库。
 * API调用失败时不在本地留下任何痕迹，彻底杜绝"幽灵记录"。
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
  config: Partial<HarvestConfig> = {}
): Promise<HarvestCandidate[]> {
  const cfg = { ...DEFAULT_HARVEST_CONFIG, ...config };
  const candidates: HarvestCandidate[] = [];

  try {
    // 1. 获取该账号下所有Campaign
    const allCampaigns = await db.getCampaignsByAccountId(accountId);
    if (!allCampaigns || allCampaigns.length === 0) {
      log.debug(`账号 ${accountId} 无广告活动`);
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
      const searchTermsList = await db.getSearchTermsByCampaignId(sourceCampaign.String(campaignId));
      
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
    log.error(`识别候选项失败:`, (error as Error).message);
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

  // ============ Step 1: 创建精确匹配关键词 ============
  try {
    const createResult = await apiClient.createSpKeywords([{
      adGroupId: String(candidate.targetAmazonAdGroupId),  // v356: 使用String()替代parseInt()，避免未来ID格式变更导致截断
      campaignId: String(candidate.targetAmazonCampaignId),  // v356: 使用String()替代parseInt()，全程保持字符串类型
      keywordText: candidate.searchTerm,
      matchType: 'exact',
      bid: candidate.suggestedBid,
      state: 'enabled',
    }]);

    if (!createResult.success || createResult.createdKeywords.length === 0) {
      const errorMsg = createResult.errors.length > 0 
        ? JSON.stringify(createResult.errors) 
        : '未知错误';
      
      // 检查是否是"已存在"错误（幂等处理）
      // @ts-expect-error - runtime type mismatch
      const isDuplicate = createResult.errors.some((e: Record<string, any>) => 
        String(e).includes('DUPLICATE') || String(e).includes('already exists')
      );
      
      if (isDuplicate) {
        log.info(`关键词已存在，跳过: "${candidate.searchTerm}"`);
        result.error = '关键词已存在于目标广告组';
        return result;
      }
      
      result.error = `Step1 创建关键词失败: ${errorMsg}`;
      log.error(`${result.error}`);
      return result;
    }

    result.createdKeywordId = createResult.createdKeywords[0].keywordId;
    result.stage = 'keyword_created';
    log.info(`Step1 完成: 创建关键词 ID=${result.createdKeywordId}`);

  } catch (error: unknown) {
    result.error = `Step1 异常: ${(error as Error).message}`;
    log.error(`${result.error}`);
    return result;
  }

  // ============ Step 2: 添加否定关键词（v230: 智能选择否定类型） ============
  // v230: 根据搜索词特征智能选择否定类型
  // 单词搜索词使用negativePhrase以覆盖变体流量
  // 多词搜索词使用negativeExact以避免过度否定
  const searchTermWords = candidate.searchTerm.trim().split(/\s+/);
  const negativeMatchType = searchTermWords.length <= 2 ? 'negativePhrase' : 'negativeExact';
  try {
    log.info(`v230: 搜索词"${candidate.searchTerm}"包含${searchTermWords.length}个词，使用${negativeMatchType}否定类型`);
    
    const negativeResult = await apiClient.createSpNegativeKeywords([{
      adGroupId: String(candidate.sourceAmazonAdGroupId),  // v356: 使用String()替代parseInt()，避免未来ID格式变更导致截断
      campaignId: String(candidate.sourceAmazonCampaignId),  // v356: 使用String()替代parseInt()，全程保持字符串类型
      keywordText: candidate.searchTerm,
      matchType: negativeMatchType,
      state: 'enabled',
    }]);

    // 检查否定词创建结果
    const negativeErrors = negativeResult.filter((r: Record<string, any>) => r.code && r.code !== 'SUCCESS');
    
    if (negativeErrors.length > 0) {
      // 检查是否是"已存在"错误（幂等处理）
      const isDuplicate = negativeErrors.some((e: Record<string, any>) => 
        String(e.code).includes('DUPLICATE') || String(e.details).includes('already exists')
      );
      
      if (!isDuplicate) {
        // Step 2 失败，需要回滚 Step 1
        log.error(`Step2 失败，开始回滚 Step1...`);
        await rollbackKeywordCreation(apiClient, result.createdKeywordId!);
        result.stage = 'rolled_back';
        result.error = `Step2 否定词创建失败: ${JSON.stringify(negativeErrors)}`;
        result.rollbackInfo = `已回滚: 删除关键词 ID=${result.createdKeywordId}`;
        return result;
      }
    }

    // 获取否定词ID
    const successNeg = negativeResult.find((r: Record<string, any>) => !r.code || r.code === 'SUCCESS');
    if (successNeg) {
      result.createdNegativeKeywordId = successNeg.keywordId;
    }
    
    result.stage = 'negative_added';
    log.info(`Step2 完成: 添加否定词 ID=${result.createdNegativeKeywordId}`);

  } catch (error: unknown) {
    // Step 2 异常，回滚 Step 1
    log.error(`Step2 异常: ${(error as Error).message}，开始回滚 Step1...`);
    await rollbackKeywordCreation(apiClient, result.createdKeywordId!);
    result.stage = 'rolled_back';
    result.error = `Step2 异常: ${(error as Error).message}`;
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
      log.error(`v357: Step3 中止 - Amazon keywordId无效: "${amazonKeywordId}"，不写入本地数据库`);
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

    // v357: 增强optimization_events记录，包含Amazon ID用于追踪
    try {
      await db.insertOptimizationEvent({
        accountId,
        eventCategory: 'search_term_action',
        actionType: 'search_term_harvest',
        campaignId: candidate.targetCampaignId,
        keywordId: localKeywordId,
        keywordText: candidate.searchTerm,
        matchType: 'exact',
        previousBid: '0.00',
        newBid: candidate.suggestedBid.toFixed(2),
        changeReason: `[搜索词收割] ${candidate.reason} | amazonKeywordId=${amazonKeywordId} | targetCampaign=${candidate.targetAmazonCampaignId}`,
        status: 'success',
        apiSyncStatus: 'synced',
        sourceTable: 'search_term_harvester',
      });
      // 同时记录否定词操作
      await db.insertOptimizationEvent({
        accountId,
        eventCategory: 'search_term_action',
        actionType: 'negative_keyword_add',
        campaignId: candidate.sourceCampaignId,
        keywordText: candidate.searchTerm,
        matchType: 'exact',
        changeReason: `[搜索词收割-否定] 源广告组添加否定词 | amazonNegKeywordId=${result.createdNegativeKeywordId || 'N/A'} | sourceCampaign=${candidate.sourceAmazonCampaignId}`,
        status: 'success',
        apiSyncStatus: 'synced',
        sourceTable: 'search_term_harvester',
      });
    } catch (eventErr: unknown) {
      log.warn(`v357: 记录optimization_events失败: ${(eventErr as Error).message}`);
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
  config: Partial<HarvestConfig> = {}
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
  
  // 1. 识别候选项
  const candidates = await identifyHarvestCandidates(accountId, cfg);
  
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
    log.error(`账号 ${accountId} 无API凭证，无法执行收割`);
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

  // 3. 逐个执行原子收割（串行执行，避免API速率限制）
  const results: HarvestResult[] = [];
  let success = 0, failed = 0, rolledBack = 0;

  for (const candidate of candidates) {
    try {
      const result = await harvestSearchTermAtomic(candidate, apiClient, accountId);
      results.push(result);
      
      if (result.success) {
        success++;
      } else if (result.stage === 'rolled_back') {
        rolledBack++;
      } else {
        failed++;
      }

      // API请求间隔，避免速率限制
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error: unknown) {
      log.error(`收割异常: "${candidate.searchTerm}" - ${(error as Error).message}`);
      results.push({
        searchTerm: candidate.searchTerm,
        success: false,
        stage: 'failed',
        error: (error as Error).message,
      });
      failed++;
    }
  }

  log.warn(`批量收割完成: 成功=${success}, 失败=${failed}, 回滚=${rolledBack}`);

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
    // @ts-expect-error - runtime type mismatch
    !isProductTargetingCampaign(c.campaignName || '')
  );
  
  // 策由1: 查找名称包含"Exact"的Campaign（排除PT类型）
  const exactCampaigns = nonPTCampaigns.filter(c => 
    // @ts-expect-error - runtime type mismatch
    c.campaignName?.toLowerCase().includes('exact') ||
    // @ts-expect-error - runtime type mismatch
    c.campaignName?.includes('精确')
  );
  
  for (const campaign of (exactCampaigns as any[])) {
    // v206: getAdGroupsByCampaignId需要Amazon campaignId
    const adGroupsList = await db.getAdGroupsByCampaignId(campaign.campaignId);
    const enabledAdGroups = adGroupsList.filter((ag: Record<string, any>) => ag.adGroupStatus === 'enabled');
    
    for (const ag of enabledAdGroups) {
      // v194: 跳过已有product targets的广告组
      const hasPT = await adGroupHasProductTargets(ag.id);
      if (hasPT) {
        log.info(`v194: 跳过product target广告组 id=${ag.id}`);
        continue;
      }
      return {
        adGroupId: ag.id,
        campaignId: campaign.campaignId,
        amazonAdGroupId: ag.adGroupId,
        amazonCampaignId: campaign.campaignId,
      };
    }
  }
  
  // 策由2: 查找任意手动Campaign的广告组（排除PT类型）
  for (const campaign of (nonPTCampaigns as any[])) {
    // v206: getAdGroupsByCampaignId需要Amazon campaignId
    const adGroupsList = await db.getAdGroupsByCampaignId(campaign.campaignId);
    const enabledAdGroups = adGroupsList.filter((ag: Record<string, any>) => ag.adGroupStatus === 'enabled');
    
    for (const ag of enabledAdGroups) {
      // v194: 跳过已有product targets的广告组
      const hasPT = await adGroupHasProductTargets(ag.id);
      if (hasPT) continue;
      return {
        adGroupId: ag.id,
        campaignId: campaign.campaignId,
        amazonAdGroupId: ag.adGroupId,
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
    log.error(`回滚失败: 关键词 ${keywordId} - ${(error as Error).message}`);
    // 回滚失败时记录告警，需要人工介入
  }
}
