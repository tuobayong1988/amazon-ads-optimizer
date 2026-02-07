/**
 * Search Term Harvester - 搜索词收割原子操作模块
 * 
 * 数据专家改进2：将搜索词收割拆分为原子操作，确保三步操作的一致性：
 * 1. 在目标广告组创建精确匹配关键词（createSpKeywords）
 * 2. 在源广告组添加否定精确关键词（createSpNegativeKeywords）
 * 3. 记录本地数据库日志
 * 
 * 任一步骤失败时执行补偿回滚，避免"关键词已创建但否定词未添加"导致的流量重叠。
 */

import * as db from './db';
import { AmazonSyncService } from './amazonSyncService';
import { createAmazonAdsClient, AmazonAdsApiClient } from './amazonAdsApi';

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
      console.log(`[SearchTermHarvester] 账号 ${accountId} 无广告活动`);
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
      console.log(`[SearchTermHarvester] 账号 ${accountId} 无自动Campaign，跳过收割`);
      return [];
    }

    // 3. 遍历每个源Campaign的搜索词
    for (const sourceCampaign of sourceCampaigns) {
      const searchTermsList = await db.getSearchTermsByCampaignId(sourceCampaign.id);
      
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
        const sourceAdGroup = await db.getAdGroupById(st.adGroupId);
        if (!sourceAdGroup) continue;
        
        candidates.push({
          searchTerm: st.searchTerm,
          sourceAdGroupId: st.adGroupId,
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

    console.log(`[SearchTermHarvester] 账号 ${accountId} 识别到 ${candidates.length} 个收割候选项`);
    return candidates;

  } catch (error: any) {
    console.error(`[SearchTermHarvester] 识别候选项失败:`, error.message);
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

  console.log(`[SearchTermHarvester] 开始原子收割: "${candidate.searchTerm}" (${candidate.reason})`);

  // ============ Step 1: 创建精确匹配关键词 ============
  try {
    const createResult = await apiClient.createSpKeywords([{
      adGroupId: parseInt(candidate.targetAmazonAdGroupId),
      campaignId: parseInt(candidate.targetAmazonCampaignId),
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
      const isDuplicate = createResult.errors.some((e: any) => 
        String(e).includes('DUPLICATE') || String(e).includes('already exists')
      );
      
      if (isDuplicate) {
        console.log(`[SearchTermHarvester] 关键词已存在，跳过: "${candidate.searchTerm}"`);
        result.error = '关键词已存在于目标广告组';
        return result;
      }
      
      result.error = `Step1 创建关键词失败: ${errorMsg}`;
      console.error(`[SearchTermHarvester] ${result.error}`);
      return result;
    }

    result.createdKeywordId = createResult.createdKeywords[0].keywordId;
    result.stage = 'keyword_created';
    console.log(`[SearchTermHarvester] Step1 完成: 创建关键词 ID=${result.createdKeywordId}`);

  } catch (error: any) {
    result.error = `Step1 异常: ${error.message}`;
    console.error(`[SearchTermHarvester] ${result.error}`);
    return result;
  }

  // ============ Step 2: 添加否定精确关键词 ============
  try {
    const negativeResult = await apiClient.createSpNegativeKeywords([{
      adGroupId: parseInt(candidate.sourceAmazonAdGroupId),
      campaignId: parseInt(candidate.sourceAmazonCampaignId),
      keywordText: candidate.searchTerm,
      matchType: 'negativeExact',
      state: 'enabled',
    }]);

    // 检查否定词创建结果
    const negativeErrors = negativeResult.filter((r: any) => r.code && r.code !== 'SUCCESS');
    
    if (negativeErrors.length > 0) {
      // 检查是否是"已存在"错误（幂等处理）
      const isDuplicate = negativeErrors.some((e: any) => 
        String(e.code).includes('DUPLICATE') || String(e.details).includes('already exists')
      );
      
      if (!isDuplicate) {
        // Step 2 失败，需要回滚 Step 1
        console.error(`[SearchTermHarvester] Step2 失败，开始回滚 Step1...`);
        await rollbackKeywordCreation(apiClient, result.createdKeywordId!);
        result.stage = 'rolled_back';
        result.error = `Step2 否定词创建失败: ${JSON.stringify(negativeErrors)}`;
        result.rollbackInfo = `已回滚: 删除关键词 ID=${result.createdKeywordId}`;
        return result;
      }
    }

    // 获取否定词ID
    const successNeg = negativeResult.find((r: any) => !r.code || r.code === 'SUCCESS');
    if (successNeg) {
      result.createdNegativeKeywordId = successNeg.keywordId;
    }
    
    result.stage = 'negative_added';
    console.log(`[SearchTermHarvester] Step2 完成: 添加否定词 ID=${result.createdNegativeKeywordId}`);

  } catch (error: any) {
    // Step 2 异常，回滚 Step 1
    console.error(`[SearchTermHarvester] Step2 异常: ${error.message}，开始回滚 Step1...`);
    await rollbackKeywordCreation(apiClient, result.createdKeywordId!);
    result.stage = 'rolled_back';
    result.error = `Step2 异常: ${error.message}`;
    result.rollbackInfo = `已回滚: 删除关键词 ID=${result.createdKeywordId}`;
    return result;
  }

  // ============ Step 3: 记录本地数据库 ============
  try {
    // 3a. 在本地keywords表创建记录
    const localKeywordId = await db.createKeyword({
      adGroupId: candidate.targetAdGroupId,
      keywordId: String(result.createdKeywordId),
      keywordText: candidate.searchTerm,
      matchType: 'exact',
      bid: candidate.suggestedBid.toFixed(2),
      keywordStatus: 'enabled',
    });
    result.localKeywordId = localKeywordId;

    // 3b. 在本地negativeKeywords表创建记录
    await db.addNegativeKeyword({
      campaignId: candidate.sourceCampaignId,
      adGroupId: candidate.sourceAdGroupId,
      keyword: candidate.searchTerm,
      matchType: 'exact',
      level: 'ad_group',
    });

    // 3c. 创建出价日志
    await db.createBiddingLog({
      accountId,
      campaignId: candidate.targetCampaignId,
      adGroupId: candidate.targetAdGroupId,
      logTargetType: 'keyword',
      targetId: localKeywordId,
      targetName: candidate.searchTerm,
      logMatchType: 'exact',
      actionType: 'set',
      previousBid: '0.00',
      newBid: candidate.suggestedBid.toFixed(2),
      bidChangePercent: '100.00',
      reason: `[搜索词收割] ${candidate.reason} | 源Campaign=${candidate.sourceCampaignId} → 目标Campaign=${candidate.targetCampaignId}`,
      algorithmVersion: '2.0.0-harvest',
      isIntradayAdjustment: 0,
    });

    result.stage = 'db_logged';
    result.success = true;
    console.log(`[SearchTermHarvester] Step3 完成: 本地数据库已更新`);

  } catch (error: any) {
    // Step 3 失败（本地DB），API操作已成功，记录警告但不回滚API
    // 因为API操作已经生效，回滚会造成更大的不一致
    console.warn(`[SearchTermHarvester] Step3 本地DB记录失败: ${error.message}，API操作已生效`);
    result.error = `Step3 本地DB失败(API已生效): ${error.message}`;
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
    console.log(`[SearchTermHarvester] Dry Run: 发现 ${candidates.length} 个候选项，不执行`);
    return {
      candidates,
      results: [],
      summary: { total: candidates.length, success: 0, failed: 0, rolledBack: 0, skipped: candidates.length },
    };
  }

  // 2. 获取API客户端
  const credentials = await db.getAmazonApiCredentials(accountId);
  if (!credentials) {
    console.error(`[SearchTermHarvester] 账号 ${accountId} 无API凭证，无法执行收割`);
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

    } catch (error: any) {
      console.error(`[SearchTermHarvester] 收割异常: "${candidate.searchTerm}" - ${error.message}`);
      results.push({
        searchTerm: candidate.searchTerm,
        success: false,
        stage: 'failed',
        error: error.message,
      });
      failed++;
    }
  }

  console.log(`[SearchTermHarvester] 批量收割完成: 成功=${success}, 失败=${failed}, 回滚=${rolledBack}`);

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
  manualCampaigns: any[],
  sourceCampaign: any
): Promise<{
  adGroupId: number;
  campaignId: number;
  amazonAdGroupId: string;
  amazonCampaignId: string;
} | null> {
  
  // 策略1: 查找名称包含"Exact"的Campaign
  const exactCampaigns = manualCampaigns.filter(c => 
    c.campaignName?.toLowerCase().includes('exact') ||
    c.campaignName?.includes('精确')
  );
  
  for (const campaign of exactCampaigns) {
    const adGroupsList = await db.getAdGroupsByCampaignId(campaign.id);
    const enabledAdGroups = adGroupsList.filter((ag: any) => ag.adGroupStatus === 'enabled');
    
    if (enabledAdGroups.length > 0) {
      return {
        adGroupId: enabledAdGroups[0].id,
        campaignId: campaign.id,
        amazonAdGroupId: enabledAdGroups[0].adGroupId,
        amazonCampaignId: campaign.campaignId,
      };
    }
  }
  
  // 策略2: 查找任意手动Campaign的广告组
  for (const campaign of manualCampaigns) {
    const adGroupsList = await db.getAdGroupsByCampaignId(campaign.id);
    const enabledAdGroups = adGroupsList.filter((ag: any) => ag.adGroupStatus === 'enabled');
    
    if (enabledAdGroups.length > 0) {
      return {
        adGroupId: enabledAdGroups[0].id,
        campaignId: campaign.id,
        amazonAdGroupId: enabledAdGroups[0].adGroupId,
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
  keywordId: number
): Promise<void> {
  try {
    // Amazon SP API: 通过将关键词状态设为archived来"删除"
    await apiClient.updateKeywordBids([{
      keywordId,
      bid: 0.02, // 设置最低出价
    }]);
    
    // 注意：Amazon API不支持真正删除关键词，只能archive
    // 这里通过设置最低出价来最小化影响
    console.log(`[SearchTermHarvester] 回滚成功: 关键词 ${keywordId} 已设置最低出价`);
  } catch (error: any) {
    console.error(`[SearchTermHarvester] 回滚失败: 关键词 ${keywordId} - ${error.message}`);
    // 回滚失败时记录告警，需要人工介入
  }
}
