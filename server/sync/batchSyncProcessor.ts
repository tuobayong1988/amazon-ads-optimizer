/**
 * v671: 大任务批次拆分处理器
 * 
 * 针对超过1,000个广告活动的Super-XL级账户，将同步数据的数据库写入操作
 * 从"一次性全量处理"细化为"按批次分段处理"：
 * 
 * 1. API数据拉取仍然一次性完成（Amazon API的分页机制已经很高效）
 * 2. 数据库写入操作按批次执行（每批500条记录）
 * 3. 每批之间添加延迟（100ms），降低数据库瞬时压力
 * 4. 每5批执行一次GC提示，降低内存峰值
 * 5. 通过WebSocket推送批次级进度，提供更细粒度的进度反馈
 * 
 * 设计原则：
 * - 最小侵入性：不修改API调用逻辑，只优化数据库写入路径
 * - 向后兼容：小账户（<1000条记录）仍使用原有逻辑，无额外开销
 * - 可观测性：每批完成后输出日志和WebSocket进度
 */

import { createModuleLogger } from '../utils/logger';
import { broadcastSyncProgress } from './syncProgressWs';

const log = createModuleLogger('BatchSync');

// ==================== 配置常量 ====================

/** 启用批次处理的最小记录数阈值 */
export const BATCH_PROCESSING_THRESHOLD = 1000;

/** 每批处理的记录数 */
export const BATCH_SIZE = 500;

/** 批次间延迟（毫秒） */
export const BATCH_DELAY_MS = 100;

/** 每N批执行一次GC提示 */
export const GC_HINT_INTERVAL = 5;

/** 大批量处理时的额外延迟（超过5000条记录时） */
export const LARGE_BATCH_EXTRA_DELAY_MS = 200;

// ==================== 批次处理器 ====================

export interface BatchProcessorOptions<T> {
  /** 待处理的数据数组 */
  items: T[];
  /** 处理单条记录的函数 */
  processItem: (item: T, index: number) => Promise<void>;
  /** 账户ID（用于WebSocket推送和日志） */
  accountId: number;
  /** 步骤名称（用于日志和WebSocket推送） */
  stepName: string;
  /** 自定义批次大小（可选，默认500） */
  batchSize?: number;
  /** 自定义批次间延迟（可选，默认100ms） */
  batchDelayMs?: number;
  /** 是否启用WebSocket进度推送（默认true） */
  enableWsPush?: boolean;
  /** 当前步骤在总步骤中的索引（用于计算总进度） */
  stepIndex?: number;
  /** 总步骤数 */
  totalSteps?: number;
}

export interface BatchProcessResult {
  totalProcessed: number;
  totalBatches: number;
  durationMs: number;
  usedBatchMode: boolean;
}

/**
 * 批次处理器 - 将大量数据库写入操作分批执行
 * 
 * 当数据量超过 BATCH_PROCESSING_THRESHOLD 时自动启用批次模式：
 * - 按 batchSize 分批处理
 * - 每批之间添加延迟
 * - 定期执行GC提示
 * - 通过WebSocket推送批次级进度
 * 
 * 数据量低于阈值时直接顺序处理，无额外开销。
 */
export async function processBatch<T>(options: BatchProcessorOptions<T>): Promise<BatchProcessResult> {
  const {
    items,
    processItem,
    accountId,
    stepName,
    batchSize = BATCH_SIZE,
    batchDelayMs = BATCH_DELAY_MS,
    enableWsPush = true,
    stepIndex,
    totalSteps,
  } = options;

  const startTime = Date.now();
  const totalItems = items.length;

  // 小数据量：直接顺序处理，无额外开销
  if (totalItems < BATCH_PROCESSING_THRESHOLD) {
    for (let i = 0; i < totalItems; i++) {
      await processItem(items[i], i);
    }
    return {
      totalProcessed: totalItems,
      totalBatches: 1,
      durationMs: Date.now() - startTime,
      usedBatchMode: false,
    };
  }

  // 大数据量：启用批次处理模式
  const totalBatches = Math.ceil(totalItems / batchSize);
  const isVeryLarge = totalItems > 5000;
  const effectiveDelay = isVeryLarge ? batchDelayMs + LARGE_BATCH_EXTRA_DELAY_MS : batchDelayMs;

  log.info(`[v671] 批次处理启动: ${stepName}, 账户${accountId}, 总记录=${totalItems}, 批次大小=${batchSize}, 总批次=${totalBatches}, 批次延迟=${effectiveDelay}ms`);

  let processedCount = 0;

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, totalItems);
    const batchItems = items.slice(batchStart, batchEnd);

    // 处理当前批次
    for (let i = 0; i < batchItems.length; i++) {
      await processItem(batchItems[i], batchStart + i);
      processedCount++;
    }

    // 批次间延迟
    if (batchIndex < totalBatches - 1) {
      await sleep(effectiveDelay);
    }

    // GC提示（每N批执行一次）
    if ((batchIndex + 1) % GC_HINT_INTERVAL === 0 && global.gc) {
      try {
        global.gc();
      } catch {
        // GC提示失败不影响处理
      }
    }

    // WebSocket推送批次进度
    if (enableWsPush && (batchIndex + 1) % 2 === 0) { // 每2批推送一次，避免过于频繁
      const batchProgress = Math.round(((batchIndex + 1) / totalBatches) * 100);
      broadcastSyncProgress(accountId, {
        step: stepName,
        stepIndex,
        totalSteps,
        progressPercent: stepIndex !== undefined && totalSteps
          ? Math.round(((stepIndex + batchProgress / 100) / totalSteps) * 100)
          : undefined,
        batchInfo: {
          currentBatch: batchIndex + 1,
          totalBatches,
          batchProgress,
        },
      });
    }

    // 每10批输出一次进度日志
    if ((batchIndex + 1) % 10 === 0 || batchIndex === totalBatches - 1) {
      const elapsed = Date.now() - startTime;
      const rate = Math.round(processedCount / (elapsed / 1000));
      log.info(`[v671] 批次进度: ${stepName}, 账户${accountId}, 批次${batchIndex + 1}/${totalBatches}, 已处理${processedCount}/${totalItems}, 速率=${rate}条/秒`);
    }
  }

  const durationMs = Date.now() - startTime;
  log.info(`[v671] 批次处理完成: ${stepName}, 账户${accountId}, 总记录=${totalItems}, 总批次=${totalBatches}, 耗时=${Math.round(durationMs / 1000)}秒`);

  return {
    totalProcessed: processedCount,
    totalBatches,
    durationMs,
    usedBatchMode: true,
  };
}

/**
 * 批量数据库写入处理器 - 将INSERT/UPDATE操作分批执行
 * 
 * 与 processBatch 不同，此函数接受一个批量写入函数，
 * 一次性处理一批记录（而非逐条处理），更适合批量INSERT场景。
 */
export async function processBatchBulk<T>(options: {
  items: T[];
  processBatch: (batch: T[], batchIndex: number) => Promise<number>;
  accountId: number;
  stepName: string;
  batchSize?: number;
  batchDelayMs?: number;
  enableWsPush?: boolean;
  stepIndex?: number;
  totalSteps?: number;
}): Promise<BatchProcessResult> {
  const {
    items,
    processBatch: processBatchFn,
    accountId,
    stepName,
    batchSize = BATCH_SIZE,
    batchDelayMs = BATCH_DELAY_MS,
    enableWsPush = true,
    stepIndex,
    totalSteps,
  } = options;

  const startTime = Date.now();
  const totalItems = items.length;

  if (totalItems < BATCH_PROCESSING_THRESHOLD) {
    const processed = await processBatchFn(items, 0);
    return {
      totalProcessed: processed,
      totalBatches: 1,
      durationMs: Date.now() - startTime,
      usedBatchMode: false,
    };
  }

  const totalBatches = Math.ceil(totalItems / batchSize);
  const isVeryLarge = totalItems > 5000;
  const effectiveDelay = isVeryLarge ? batchDelayMs + LARGE_BATCH_EXTRA_DELAY_MS : batchDelayMs;

  log.info(`[v671] 批量写入启动: ${stepName}, 账户${accountId}, 总记录=${totalItems}, 批次大小=${batchSize}, 总批次=${totalBatches}`);

  let totalProcessed = 0;

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, totalItems);
    const batch = items.slice(batchStart, batchEnd);

    const processed = await processBatchFn(batch, batchIndex);
    totalProcessed += processed;

    // 批次间延迟
    if (batchIndex < totalBatches - 1) {
      await sleep(effectiveDelay);
    }

    // GC提示
    if ((batchIndex + 1) % GC_HINT_INTERVAL === 0 && global.gc) {
      try { global.gc(); } catch { /* ignore */ }
    }

    // WebSocket推送
    if (enableWsPush && (batchIndex + 1) % 2 === 0) {
      const batchProgress = Math.round(((batchIndex + 1) / totalBatches) * 100);
      broadcastSyncProgress(accountId, {
        step: stepName,
        stepIndex,
        totalSteps,
        progressPercent: stepIndex !== undefined && totalSteps
          ? Math.round(((stepIndex + batchProgress / 100) / totalSteps) * 100)
          : undefined,
        batchInfo: {
          currentBatch: batchIndex + 1,
          totalBatches,
          batchProgress,
        },
      });
    }

    // 进度日志
    if ((batchIndex + 1) % 10 === 0 || batchIndex === totalBatches - 1) {
      const elapsed = Date.now() - startTime;
      const rate = Math.round(totalProcessed / (elapsed / 1000));
      log.info(`[v671] 批量写入进度: ${stepName}, 账户${accountId}, 批次${batchIndex + 1}/${totalBatches}, 已处理${totalProcessed}/${totalItems}, 速率=${rate}条/秒`);
    }
  }

  const durationMs = Date.now() - startTime;
  log.info(`[v671] 批量写入完成: ${stepName}, 账户${accountId}, 总记录=${totalItems}, 已写入=${totalProcessed}, 耗时=${Math.round(durationMs / 1000)}秒`);

  return {
    totalProcessed,
    totalBatches,
    durationMs,
    usedBatchMode: true,
  };
}

// ==================== v672: API拉取阶段的分批请求 ====================

/** 启用API分批拉取的广告活动数阈值 */
export const API_BATCH_FETCH_CAMPAIGN_THRESHOLD = 500;

/** 每批API请求包含的广告活动数 */
export const API_BATCH_CAMPAIGN_SIZE = 50;

/** API批次间延迟（毫秒）*/
export const API_BATCH_DELAY_MS = 200;

export interface ApiBatchFetchOptions<T> {
  /** 账户下所有广告活动ID列表 */
  campaignIds: string[];
  /** 按campaignId批次调用API的函数 */
  fetchBatch: (campaignIds: string[]) => Promise<T[]>;
  /** 不带过滤器的全量拉取函数（小账户降级使用）*/
  fetchAll: () => Promise<T[]>;
  /** 账户ID（用于日志和WebSocket推送）*/
  accountId: number;
  /** 步骤名称（用于日志和WebSocket推送）*/
  stepName: string;
  /** 自定义每批campaign数（可选，默认50）*/
  batchCampaignSize?: number;
  /** 自定义批次间延迟（可选，默认200ms）*/
  batchDelayMs?: number;
}

export interface ApiBatchFetchResult<T> {
  data: T[];
  totalBatches: number;
  durationMs: number;
  usedBatchMode: boolean;
}

/**
 * v672: API拉取阶段的分批请求处理器
 * 
 * 当账户广告活动数超过 API_BATCH_FETCH_CAMPAIGN_THRESHOLD 时，
 * 将campaignId分成每批 API_BATCH_CAMPAIGN_SIZE 个，
 * 通过 campaignIdFilter 参数分批调用Amazon API，
 * 从源头控制每次API请求的数据量和内存占用。
 * 
 * 小账户（<500个广告活动）仍使用原有的全量拉取方式，无额外开销。
 */
export async function batchApiFetch<T>(options: ApiBatchFetchOptions<T>): Promise<ApiBatchFetchResult<T>> {
  const {
    campaignIds,
    fetchBatch,
    fetchAll,
    accountId,
    stepName,
    batchCampaignSize = API_BATCH_CAMPAIGN_SIZE,
    batchDelayMs = API_BATCH_DELAY_MS,
  } = options;

  const startTime = Date.now();

  // 小账户：直接全量拉取，无额外开销
  if (campaignIds.length < API_BATCH_FETCH_CAMPAIGN_THRESHOLD) {
    const data = await fetchAll();
    return {
      data,
      totalBatches: 1,
      durationMs: Date.now() - startTime,
      usedBatchMode: false,
    };
  }

  // 大账户：按campaignId分批拉取
  const totalBatches = Math.ceil(campaignIds.length / batchCampaignSize);
  const allData: T[] = [];

  log.info(`[v672] API分批拉取启动: ${stepName}, 账户${accountId}, 广告活动数=${campaignIds.length}, 每批=${batchCampaignSize}个, 总批次=${totalBatches}`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * batchCampaignSize;
    const batchEnd = Math.min(batchStart + batchCampaignSize, campaignIds.length);
    const batchCampaignIds = campaignIds.slice(batchStart, batchEnd);

    try {
      const batchData = await fetchBatch(batchCampaignIds);
      allData.push(...batchData);

      // 进度日志（每5批或最后一批）
      if ((batchIndex + 1) % 5 === 0 || batchIndex === totalBatches - 1) {
        const elapsed = Date.now() - startTime;
        log.info(`[v672] API分批进度: ${stepName}, 账户${accountId}, 批次${batchIndex + 1}/${totalBatches}, 已拉取${allData.length}条, 耗时${Math.round(elapsed / 1000)}秒`);
      }

      // WebSocket推送API拉取进度
      if ((batchIndex + 1) % 3 === 0) {
        broadcastSyncProgress(accountId, {
          step: `${stepName} (API拉取)`,
          batchInfo: {
            currentBatch: batchIndex + 1,
            totalBatches,
            batchProgress: Math.round(((batchIndex + 1) / totalBatches) * 100),
          },
        });
      }
    } catch (error: unknown) {
      log.warn(`[v672] API分批拉取失败: ${stepName}, 账户${accountId}, 批次${batchIndex + 1}/${totalBatches}, campaigns=${batchCampaignIds.length}, error=${(error as Error).message}`);
      // 单批失败不中断整个同步，记录并继续下一批
      // 数据自愈机制会在后续同步中补充缺失的数据
    }

    // 批次间延迟，缓解API负载
    if (batchIndex < totalBatches - 1) {
      await sleep(batchDelayMs);
    }

    // 每10批触发GC提示
    if ((batchIndex + 1) % 10 === 0 && global.gc) {
      try { global.gc(); } catch { /* ignore */ }
    }
  }

  const durationMs = Date.now() - startTime;
  log.info(`[v672] API分批拉取完成: ${stepName}, 账户${accountId}, 总记录=${allData.length}, 总批次=${totalBatches}, 耗时=${Math.round(durationMs / 1000)}秒`);

  return {
    data: allData,
    totalBatches,
    durationMs,
    usedBatchMode: true,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
