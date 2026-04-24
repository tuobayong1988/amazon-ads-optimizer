/**
 * v732.5g: ElaraFit 广告数据分析与批量优化端点
 * 
 * 修复: executePause 和 executeBidAdjust 使用正确的 amazonApiHelper 函数
 * - syncKeywordStatusToAmazon() 用于暂停关键词和product_target
 * - syncBidAdjustmentsToAmazon() 用于出价调整（支持keyword和product_target）
 */
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import * as amazonApiHelper from '../services/amazonApiHelper';
import { createModuleLogger } from "../utils/logger";
import { z } from 'zod';
const log = createModuleLogger('v732-ElaraFit-Analysis');

export const elarafitAnalysisRouter = router({
  
  analyzeKeywords: adminProcedure
    .input(z.object({
      accountId: z.number(),
      statusFilter: z.enum(['enabled', 'paused', 'all']).default('enabled'),
      excludeAmazonDeleted: z.boolean().default(true),
    }))
    .query(async ({ input }) => {
      const { accountId, statusFilter, excludeAmazonDeleted } = input;
      const database = await getDb();
      
      const keywordsResult = await database.execute(sql`
        SELECT 
          k.id as entity_id,
          'keyword' as entity_type,
          k.campaignId as campaign_id,
          k.keywordText as entity_text,
          k.matchType as match_type,
          k.bid as current_bid,
          k.keywordId as amazon_entity_id,
          k.keywordStatus as current_status,
          k.internal_ad_group_id,
          k.impressions, k.clicks, k.spend, k.sales, k.orders,
          k.keywordAcos as acos, k.keywordRoas as roas, k.keywordCpc as cpc,
          c.campaignName as campaign_name,
          c.campaignType as campaign_type,
          ag.adGroupId as amazon_ad_group_id
        FROM keywords k
        JOIN campaigns c ON k.campaignId = c.campaignId AND c.accountId = ${accountId}
        LEFT JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
        WHERE k.accountId = ${accountId}
          ${statusFilter === 'all' ? sql`` : sql`AND k.keywordStatus = ${statusFilter}`}
          ${excludeAmazonDeleted ? sql`AND k.keywordStatus != 'amazon_deleted'` : sql``}
      `);
      
      const targetsResult = await database.execute(sql`
        SELECT 
          pt.id as entity_id,
          'product_target' as entity_type,
          pt.campaignId as campaign_id,
          pt.targetValue as entity_text,
          pt.target_match_type as match_type,
          pt.bid as current_bid,
          pt.targetId as amazon_entity_id,
          pt.targetStatus as current_status,
          pt.internal_ad_group_id,
          pt.impressions, pt.clicks, pt.spend, pt.sales, pt.orders,
          pt.targetAcos as acos, pt.targetRoas as roas, pt.targetCpc as cpc,
          c.campaignName as campaign_name,
          c.campaignType as campaign_type,
          ag.adGroupId as amazon_ad_group_id
        FROM product_targets pt
        JOIN campaigns c ON pt.campaignId = c.campaignId AND c.accountId = ${accountId}
        LEFT JOIN ad_groups ag ON pt.internal_ad_group_id = ag.id
        WHERE pt.accountId = ${accountId}
          ${statusFilter === 'all' ? sql`` : sql`AND pt.targetStatus = ${statusFilter}`}
          ${excludeAmazonDeleted ? sql`AND pt.targetStatus != 'amazon_deleted'` : sql``}
      `);

      const allKeywords = (keywordsResult as any)[0] || [];
      const allTargets = (targetsResult as any)[0] || [];
      const allEntities = [...allKeywords, ...allTargets];
      
      log.info(`Account ${accountId}: ${allKeywords.length} keywords, ${allTargets.length} targets`);
      
      const toPause: any[] = [];
      const toPauseBadRoas: any[] = [];
      const toReduceBid: any[] = [];
      const toOptimize: any[] = [];
      const toKeep: any[] = [];
      
      for (const entity of allEntities) {
        const spend = parseFloat(entity.spend || '0');
        const sales = parseFloat(entity.sales || '0');
        const orders = parseInt(entity.orders || '0');
        const clicks = parseInt(entity.clicks || '0');
        const impressions = parseInt(entity.impressions || '0');
        const currentBid = parseFloat(entity.current_bid || '0');
        const cpc = parseFloat(entity.cpc || '0');
        const roas = spend > 0 ? sales / spend : 0;
        
        const item = {
          entity_id: entity.entity_id,
          entity_type: entity.entity_type,
          entity_text: entity.entity_text,
          match_type: entity.match_type,
          campaign_id: entity.campaign_id,
          campaign_name: entity.campaign_name,
          campaign_type: entity.campaign_type,
          amazon_entity_id: entity.amazon_entity_id,
          amazon_ad_group_id: entity.amazon_ad_group_id,
          internal_ad_group_id: entity.internal_ad_group_id,
          current_bid: currentBid,
          current_status: entity.current_status,
          spend, sales, orders, clicks, impressions, cpc, roas,
        };
        
        if (spend === 0 && clicks === 0) {
          toKeep.push(item);
        } else if (orders === 0) {
          toPause.push({ ...item, action: 'pause', reason: 'zero_conversion' });
        } else if (roas < 0.5) {
          toPauseBadRoas.push({ ...item, action: 'pause', reason: 'very_bad_roas' });
        } else if (roas < 1.0) {
          const newBid = Math.max(0.02, cpc > 0 ? parseFloat((cpc * 0.6).toFixed(2)) : parseFloat((currentBid * 0.5).toFixed(2)));
          const bidChange = currentBid > 0 ? ((newBid - currentBid) / currentBid * 100) : 0;
          toReduceBid.push({ ...item, action: 'reduce_bid', new_bid: newBid, bid_change_pct: bidChange, reason: 'bad_roas' });
        } else {
          const newBid = Math.max(0.02, cpc > 0 ? parseFloat((cpc * 0.8).toFixed(2)) : currentBid);
          const bidChange = currentBid > 0 ? ((newBid - currentBid) / currentBid * 100) : 0;
          toOptimize.push({ ...item, action: 'optimize_bid', new_bid: newBid, bid_change_pct: bidChange, reason: 'good_roas' });
        }
      }
      
      const pauseSavings = toPause.reduce((sum: number, e: any) => sum + e.spend, 0);
      const badRoasSavings = toPauseBadRoas.reduce((sum: number, e: any) => sum + e.spend, 0);
      const reduceSavings = toReduceBid.reduce((sum: number, e: any) => {
        const reduction = e.current_bid > 0 ? (e.current_bid - e.new_bid) / e.current_bid : 0;
        return sum + e.spend * reduction;
      }, 0);
      const optimizeSavings = toOptimize.reduce((sum: number, e: any) => {
        const reduction = e.current_bid > 0 ? Math.max(0, (e.current_bid - e.new_bid) / e.current_bid) : 0;
        return sum + e.spend * reduction;
      }, 0);
      
      const optimizeRevenue = toOptimize.reduce((sum: number, e: any) => sum + e.sales, 0);
      const reduceRevenue = toReduceBid.reduce((sum: number, e: any) => sum + e.sales, 0);
      
      const summary = {
        totalEntities: allEntities.length,
        keywordCount: allKeywords.length,
        targetCount: allTargets.length,
        toPauseZeroConversion: toPause.length,
        toPauseBadRoas: toPauseBadRoas.length,
        toReduceBid: toReduceBid.length,
        toOptimize: toOptimize.length,
        toKeep: toKeep.length,
        totalSpend: allEntities.reduce((s: number, e: any) => s + parseFloat(e.spend || '0'), 0),
        totalSales: allEntities.reduce((s: number, e: any) => s + parseFloat(e.sales || '0'), 0),
        totalOrders: allEntities.reduce((s: number, e: any) => s + parseInt(e.orders || '0'), 0),
        savings: {
          fromPauseZeroConversion: parseFloat(pauseSavings.toFixed(2)),
          fromPauseBadRoas: parseFloat(badRoasSavings.toFixed(2)),
          fromReduceBid: parseFloat(reduceSavings.toFixed(2)),
          fromOptimizeBid: parseFloat(optimizeSavings.toFixed(2)),
          total: parseFloat((pauseSavings + badRoasSavings + reduceSavings + optimizeSavings).toFixed(2)),
        },
        retainedRevenue: parseFloat((optimizeRevenue + reduceRevenue).toFixed(2)),
      };
      
      return { 
        summary, 
        toPause: toPause.sort((a: any, b: any) => b.spend - a.spend),
        toPauseBadRoas: toPauseBadRoas.sort((a: any, b: any) => b.spend - a.spend),
        toReduceBid: toReduceBid.sort((a: any, b: any) => b.spend - a.spend),
        toOptimize: toOptimize.sort((a: any, b: any) => b.sales - a.sales),
      };
    }),

  /**
   * v732.5g: 修复暂停操作 — 使用 syncKeywordStatusToAmazon
   * 该函数内部会自动解析Amazon ID、分批发送、处理keyword和product_target
   */
  executePause: adminProcedure
    .input(z.object({
      accountId: z.number(),
      entities: z.array(z.object({
        entity_id: z.number(),
        entity_type: z.string(),
        amazon_entity_id: z.string(),
        campaign_id: z.string(),
        campaign_type: z.string().nullable(),
      })),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const { accountId, entities, dryRun } = input;
      
      log.info(`executePause v733: account=${accountId}, entities=${entities.length}, dryRun=${dryRun}`);
      
      if (dryRun) {
        return { success: true, message: `DryRun: would pause ${entities.length} entities`, count: entities.length };
      }
      
      // v733: API优先模式 - 先调用Amazon API，只有API成功后才更新本地DB
      const statusChanges = entities.map(e => ({
        keywordId: e.entity_id,
        newStatus: 'paused' as const,
        reason: 'ElaraFit optimization: zero conversion or very bad ROAS',
        isProductTarget: e.entity_type === 'product_target',
      }));
      
      let pausedCount = 0;
      let localUpdated = 0;
      const errors: string[] = [];
      const successEntityIds = new Set<number>();  // 记录API成功的实体ID
      
      // 分批处理（每批200个）
      const batchSize = 200;
      for (let i = 0; i < statusChanges.length; i += batchSize) {
        const batch = statusChanges.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(statusChanges.length / batchSize);
        
        try {
          const result = await amazonApiHelper.syncKeywordStatusToAmazon(accountId, batch);
          pausedCount += result.success;
          // 记录成功的实体ID
          if (result.successIds) {
            for (const id of result.successIds) successEntityIds.add(id);
          } else {
            // 如果没有successIds字段，则假定整批成功
            for (const sc of batch) successEntityIds.add(sc.keywordId);
          }
          if (result.errors.length > 0) {
            errors.push(...result.errors.slice(0, 3));
          }
          log.info(`executePause batch ${batchNum}/${totalBatches}: success=${result.success}, failed=${result.failed}`);
        } catch (e: any) {
          errors.push(`Batch ${batchNum}: ${e.message}`);
          log.error(`executePause batch ${batchNum} error: ${e.message}`);
        }
      }
      
      // v733: 只更新API成功的实体的本地状态
      const database = await getDb();
      for (const entity of entities) {
        if (!successEntityIds.has(entity.entity_id)) continue;  // API未成功，跳过本地更新
        try {
          if (entity.entity_type === 'keyword') {
            await database.execute(sql`UPDATE keywords SET keywordStatus = 'paused' WHERE id = ${entity.entity_id}`);
          } else {
            await database.execute(sql`UPDATE product_targets SET targetStatus = 'paused' WHERE id = ${entity.entity_id}`);
          }
          localUpdated++;
        } catch (e: any) {
          log.warn(`executePause: 本地DB更新失败 entity_id=${entity.entity_id}: ${e.message}`);
        }
      }
      
      log.info(`executePause v733: API成功${pausedCount}, 本地更新${localUpdated}, 总请求${entities.length}`);
      return { success: true, pausedCount, localUpdated, totalRequested: entities.length, errors };
    }),

  /**
   * v732.5g: 修复出价调整 — 统一使用 syncBidAdjustmentsToAmazon
   * 该函数内部会自动处理keyword和product_target的出价调整
   */
  executeBidAdjust: adminProcedure
    .input(z.object({
      accountId: z.number(),
      adjustments: z.array(z.object({
        entity_id: z.number(),
        entity_type: z.string(),
        amazon_entity_id: z.string().nullable(),
        amazon_ad_group_id: z.string().nullable(),
        campaign_id: z.string(),
        campaign_type: z.string().nullable(),
        new_bid: z.number(),
      })),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const { accountId, adjustments, dryRun } = input;
      
      log.info(`executeBidAdjust v733: account=${accountId}, adjustments=${adjustments.length}, dryRun=${dryRun}`);
      
      if (dryRun) {
        return { success: true, message: `DryRun: would adjust ${adjustments.length} bids`, count: adjustments.length };
      }
      
      // v733: API优先模式
      const bidAdjustments = adjustments.map(a => ({
        keywordId: a.entity_id,
        productTargetId: a.entity_type === 'product_target' ? a.entity_id : undefined,
        newBid: a.new_bid,
        reason: 'ElaraFit optimization: bid adjustment to optimal CPC x 80%',
        isProductTarget: a.entity_type === 'product_target',
      }));
      
      let adjustedCount = 0;
      let localUpdated = 0;
      const errors: string[] = [];
      const successEntityIds = new Set<number>();
      
      // 分批处理（每批200个）
      const batchSize = 200;
      for (let i = 0; i < bidAdjustments.length; i += batchSize) {
        const batch = bidAdjustments.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(bidAdjustments.length / batchSize);
        
        try {
          const result = await amazonApiHelper.syncBidAdjustmentsToAmazon(accountId, batch);
          adjustedCount += result.success;
          // v733: 从 itemResults 中精确提取成功的实体ID
          if (result.itemResults && result.itemResults.size > 0) {
            for (const [entityId, itemResult] of result.itemResults) {
              if (itemResult.status === 'synced') successEntityIds.add(entityId);
            }
          } else if (result.success > 0) {
            // fallback: 如果没有itemResults，假定整批成功
            for (const ba of batch) successEntityIds.add(ba.keywordId);
          }
          if (result.errors.length > 0) {
            errors.push(...result.errors.slice(0, 3));
          }
          log.info(`executeBidAdjust batch ${batchNum}/${totalBatches}: success=${result.success}, failed=${result.failed}`);
        } catch (e: any) {
          errors.push(`Batch ${batchNum}: ${e.message}`);
          log.error(`executeBidAdjust batch ${batchNum} error: ${e.message}`);
        }
      }
      
      // v733: 只更新API成功的实体的本地出价
      const database = await getDb();
      for (const adj of adjustments) {
        if (!successEntityIds.has(adj.entity_id)) continue;
        try {
          if (adj.entity_type === 'keyword') {
            await database.execute(sql`UPDATE keywords SET bid = ${adj.new_bid} WHERE id = ${adj.entity_id}`);
          } else {
            await database.execute(sql`UPDATE product_targets SET bid = ${adj.new_bid} WHERE id = ${adj.entity_id}`);
          }
          localUpdated++;
        } catch (e: any) {
          log.warn(`executeBidAdjust: 本地DB更新失败 entity_id=${adj.entity_id}: ${e.message}`);
        }
      }
      
      log.info(`executeBidAdjust v733: API成功${adjustedCount}, 本地更新${localUpdated}, 总请求${adjustments.length}`);
      return { success: true, adjustedCount, localUpdated, totalRequested: adjustments.length, errors };
    }),

  /**
   * v732.5h: 同步本地已暂停的实体到Amazon API
   * 查询本地DB中 status='paused' 且有花费的实体，通过Amazon API执行暂停
   */
  syncPausedToAmazon: adminProcedure
    .input(z.object({
      accountId: z.number(),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const { accountId, dryRun } = input;
      const database = await getDb();
      
      // 查询本地已暂停的关键词（有花费但零转化，或极差ROAS）
      const pausedKeywords = await database.execute(sql`
        SELECT id, keywordId, keywordText, campaignId, keywordRoas, spend, orders
        FROM keywords 
        WHERE accountId = ${accountId} 
          AND keywordStatus = 'paused'
          AND spend > 0
          AND (orders = 0 OR (orders > 0 AND spend > 0 AND sales > 0 AND sales / spend < 0.5))
      `);
      
      const pausedTargets = await database.execute(sql`
        SELECT id, targetId, targetValue, campaignId, targetRoas, spend, orders
        FROM product_targets 
        WHERE accountId = ${accountId} 
          AND targetStatus = 'paused'
          AND spend > 0
          AND (orders = 0 OR (orders > 0 AND spend > 0 AND sales > 0 AND sales / spend < 0.5))
      `);
      
      const keywords = (pausedKeywords as any)[0] || [];
      const targets = (pausedTargets as any)[0] || [];
      
      log.info(`syncPausedToAmazon: account=${accountId}, keywords=${keywords.length}, targets=${targets.length}, dryRun=${dryRun}`);
      
      if (dryRun) {
        return {
          success: true,
          message: `DryRun: would sync ${keywords.length} keywords + ${targets.length} targets to Amazon as paused`,
          keywordCount: keywords.length,
          targetCount: targets.length,
        };
      }
      
      // 构建状态变更列表
      const statusChanges: Array<{
        keywordId: number;
        newStatus: 'paused';
        reason: string;
        isProductTarget?: boolean;
      }> = [];
      
      for (const kw of keywords) {
        statusChanges.push({
          keywordId: kw.id,
          newStatus: 'paused',
          reason: 'ElaraFit optimization sync: zero conversion or very bad ROAS',
          isProductTarget: false,
        });
      }
      
      for (const pt of targets) {
        statusChanges.push({
          keywordId: pt.id,
          newStatus: 'paused',
          reason: 'ElaraFit optimization sync: zero conversion or very bad ROAS',
          isProductTarget: true,
        });
      }
      
      let pausedCount = 0;
      const errors: string[] = [];
      
      // 分批处理
      const batchSize = 200;
      for (let i = 0; i < statusChanges.length; i += batchSize) {
        const batch = statusChanges.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(statusChanges.length / batchSize);
        
        try {
          const result = await amazonApiHelper.syncKeywordStatusToAmazon(accountId, batch);
          pausedCount += result.success;
          if (result.errors.length > 0) {
            errors.push(...result.errors.slice(0, 5));
          }
          log.info(`syncPausedToAmazon batch ${batchNum}/${totalBatches}: success=${result.success}, failed=${result.failed}`);
        } catch (e: any) {
          errors.push(`Batch ${batchNum}: ${e.message}`);
        }
      }
      
      return {
        success: true,
        pausedCount,
        totalRequested: statusChanges.length,
        keywordCount: keywords.length,
        targetCount: targets.length,
        errors,
      };
    }),

  /**
   * v733: 分日绩效数据健康检查
   * 检查 keyword_daily_performance 表中数据的覆盖率和完整性
   */
  dailyPerformanceHealth: adminProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const { accountId } = input;
      const database = await getDb();
      
      // 查询数据覆盖的日期范围
      const dateRange = await database.execute(sql.raw(`
        SELECT 
          MIN(date) as earliest_date,
          MAX(date) as latest_date,
          COUNT(DISTINCT date) as total_days,
          COUNT(*) as total_records,
          SUM(CASE WHEN entity_type = 'keyword' THEN 1 ELSE 0 END) as keyword_records,
          SUM(CASE WHEN entity_type = 'product_target' THEN 1 ELSE 0 END) as target_records,
          SUM(CASE WHEN data_source = 'api_report' THEN 1 ELSE 0 END) as api_report_records,
          SUM(CASE WHEN data_source = 'calculated' THEN 1 ELSE 0 END) as calculated_records
        FROM keyword_daily_performance
        WHERE account_id = ${accountId}
      `));
      
      // 查询最近90天每天的记录数
      const dailyCoverage = await database.execute(sql.raw(`
        SELECT date, COUNT(*) as records, 
          SUM(CASE WHEN data_source = 'api_report' THEN 1 ELSE 0 END) as api_records,
          SUM(spend) as total_spend, SUM(orders) as total_orders
        FROM keyword_daily_performance
        WHERE account_id = ${accountId}
          AND date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        GROUP BY date
        ORDER BY date DESC
      `));
      
      // 查询enabled实体总数与有分日数据的实体数
      const entityCoverage = await database.execute(sql.raw(`
        SELECT 
          (SELECT COUNT(*) FROM keywords WHERE accountId = ${accountId} AND keywordStatus = 'enabled') as enabled_keywords,
          (SELECT COUNT(*) FROM product_targets WHERE accountId = ${accountId} AND targetStatus = 'enabled') as enabled_targets,
          (SELECT COUNT(DISTINCT keyword_id) FROM keyword_daily_performance WHERE account_id = ${accountId} AND entity_type = 'keyword' AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) as keywords_with_recent_data,
          (SELECT COUNT(DISTINCT target_id) FROM keyword_daily_performance WHERE account_id = ${accountId} AND entity_type = 'product_target' AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) as targets_with_recent_data
      `));
      
      const range = (dateRange as any)[0]?.[0] || {};
      const coverage = (dailyCoverage as any)[0] || [];
      const entities = (entityCoverage as any)[0]?.[0] || {};
      
      // 计算缺失的日期
      const coveredDates = new Set(coverage.map((r: any) => r.date));
      const missingDates: string[] = [];
      for (let i = 0; i < 90; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const ds = d.toISOString().split('T')[0];
        if (!coveredDates.has(ds) && i > 2) missingDates.push(ds);  // 最近2天可能还没同步
      }
      
      return {
        dateRange: {
          earliest: range.earliest_date,
          latest: range.latest_date,
          totalDays: parseInt(range.total_days || '0'),
          totalRecords: parseInt(range.total_records || '0'),
          keywordRecords: parseInt(range.keyword_records || '0'),
          targetRecords: parseInt(range.target_records || '0'),
          apiReportRecords: parseInt(range.api_report_records || '0'),
          calculatedRecords: parseInt(range.calculated_records || '0'),
        },
        entityCoverage: {
          enabledKeywords: parseInt(entities.enabled_keywords || '0'),
          enabledTargets: parseInt(entities.enabled_targets || '0'),
          keywordsWithRecentData: parseInt(entities.keywords_with_recent_data || '0'),
          targetsWithRecentData: parseInt(entities.targets_with_recent_data || '0'),
        },
        missingDates: missingDates.slice(0, 30),
        dailyCoverage: coverage.slice(0, 30),
        healthScore: missingDates.length === 0 ? 'excellent' : missingDates.length < 10 ? 'good' : missingDates.length < 30 ? 'fair' : 'poor',
      };
    }),

  /**
   * v733: 通用批量分析端点 — 支持多时间窗口绩效数据
   * 从 keyword_daily_performance 表读取真实分日数据，
   * 按 90-60天、60-30天、30-14天、14-7天、7-3天 五个时间窗口聚合
   */
  bulkAnalyzeWithTimeWindows: adminProcedure
    .input(z.object({
      accountId: z.number(),
      statusFilter: z.enum(['enabled', 'paused', 'all']).default('enabled'),
      timeWindows: z.array(z.object({
        label: z.string(),
        startDaysAgo: z.number(),
        endDaysAgo: z.number(),
      })).default([
        { label: '90d-60d', startDaysAgo: 90, endDaysAgo: 60 },
        { label: '60d-30d', startDaysAgo: 60, endDaysAgo: 30 },
        { label: '30d-14d', startDaysAgo: 30, endDaysAgo: 14 },
        { label: '14d-7d', startDaysAgo: 14, endDaysAgo: 7 },
        { label: '7d-3d', startDaysAgo: 7, endDaysAgo: 3 },
      ]),
      roasThresholds: z.object({
        pauseBelow: z.number().default(0.5),
        reduceBidBelow: z.number().default(1.0),
        goodAbove: z.number().default(1.0),
      }).default({ pauseBelow: 0.5, reduceBidBelow: 1.0, goodAbove: 1.0 }),
      bidMultiplier: z.number().default(0.8),
    }))
    .query(async ({ input }) => {
      const { accountId, statusFilter, timeWindows, roasThresholds, bidMultiplier } = input;
      const database = await getDb();
      
      log.info(`bulkAnalyzeWithTimeWindows v733: account=${accountId}, windows=${timeWindows.length}`);
      
      // Step 1: 获取所有实体基础信息
      const statusConditionKw = statusFilter === 'all' ? '' : `AND k.keywordStatus = '${statusFilter}'`;
      const statusConditionPt = statusFilter === 'all' ? '' : `AND pt.targetStatus = '${statusFilter}'`;
      
      const keywordsResult = await database.execute(sql.raw(`
        SELECT k.id as entity_id, 'keyword' as entity_type, k.campaignId as campaign_id,
          k.keywordText as entity_text, k.matchType as match_type, k.bid as current_bid,
          k.keywordId as amazon_entity_id, k.keywordStatus as current_status,
          k.internal_ad_group_id, k.impressions, k.clicks, k.spend, k.sales, k.orders,
          k.keywordCpc as cpc, c.campaignName as campaign_name, c.campaignType as campaign_type,
          ag.adGroupId as amazon_ad_group_id
        FROM keywords k
        JOIN campaigns c ON k.campaignId = c.campaignId AND c.accountId = ${accountId}
        LEFT JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
        WHERE k.accountId = ${accountId}
          ${statusConditionKw}
          AND k.keywordStatus != 'amazon_deleted'
      `));
      
      const targetsResult = await database.execute(sql.raw(`
        SELECT pt.id as entity_id, 'product_target' as entity_type, pt.campaignId as campaign_id,
          pt.targetValue as entity_text, pt.target_match_type as match_type, pt.bid as current_bid,
          pt.targetId as amazon_entity_id, pt.targetStatus as current_status,
          pt.internal_ad_group_id, pt.impressions, pt.clicks, pt.spend, pt.sales, pt.orders,
          pt.targetCpc as cpc, c.campaignName as campaign_name, c.campaignType as campaign_type,
          ag.adGroupId as amazon_ad_group_id
        FROM product_targets pt
        JOIN campaigns c ON pt.campaignId = c.campaignId AND c.accountId = ${accountId}
        LEFT JOIN ad_groups ag ON pt.internal_ad_group_id = ag.id
        WHERE pt.accountId = ${accountId}
          ${statusConditionPt}
          AND pt.targetStatus != 'amazon_deleted'
      `));
      
      const allKeywords = (keywordsResult as any)[0] || [];
      const allTargets = (targetsResult as any)[0] || [];
      const allEntities = [...allKeywords, ...allTargets];
      
      // Step 2: 查询每个时间窗口的分日绩效数据
      const windowPerformance: Record<string, Map<string, { spend: number; sales: number; orders: number; clicks: number; cpc: number }>> = {};
      
      for (const tw of timeWindows) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - tw.startDaysAgo);
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - tw.endDaysAgo);
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];
        
        // v733: 查询keyword的分日绩效
        const kwPerfResult = await database.execute(sql.raw(`
          SELECT keyword_id as entity_id, 'keyword' as entity_type,
            SUM(spend) as total_spend, SUM(sales) as total_sales,
            SUM(orders) as total_orders, SUM(clicks) as total_clicks,
            CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) ELSE 0 END as avg_cpc
          FROM keyword_daily_performance
          WHERE account_id = ${accountId}
            AND entity_type = 'keyword'
            AND date >= '${startStr}'
            AND date < '${endStr}'
          GROUP BY keyword_id
        `));
        // v733: 查询product_target的分日绩效
        const ptPerfResult = await database.execute(sql.raw(`
          SELECT target_id as entity_id, 'product_target' as entity_type,
            SUM(spend) as total_spend, SUM(sales) as total_sales,
            SUM(orders) as total_orders, SUM(clicks) as total_clicks,
            CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) ELSE 0 END as avg_cpc
          FROM keyword_daily_performance
          WHERE account_id = ${accountId}
            AND entity_type = 'product_target'
            AND date >= '${startStr}'
            AND date < '${endStr}'
          GROUP BY target_id
        `));
        
        const perfMap = new Map<string, { spend: number; sales: number; orders: number; clicks: number; cpc: number }>();
        const allPerfRows = [...((kwPerfResult as any)[0] || []), ...((ptPerfResult as any)[0] || [])];
        for (const row of allPerfRows) {
          const key = `${row.entity_type}_${row.entity_id}`;
          perfMap.set(key, {
            spend: parseFloat(row.total_spend || '0'),
            sales: parseFloat(row.total_sales || '0'),
            orders: parseInt(row.total_orders || '0'),
            clicks: parseInt(row.total_clicks || '0'),
            cpc: parseFloat(row.avg_cpc || '0'),
          });
        }
        windowPerformance[tw.label] = perfMap;
      }
      
      // Step 3: 对每个实体进行多时间窗口分析
      const results: any[] = [];
      
      for (const entity of allEntities) {
        const entityKey = `${entity.entity_type}_${entity.entity_id}`;
        const totalSpend = parseFloat(entity.spend || '0');
        const totalOrders = parseInt(entity.orders || '0');
        
        // 收集各窗口绩效
        const windowData: Record<string, { spend: number; sales: number; orders: number; clicks: number; cpc: number; roas: number }> = {};
        let hasAnyConversion = false;
        let allWindowsBadRoas = true;
        let bestRoas = 0;
        let bestRoasWindow = '';
        let bestCpc = 0;
        let windowsWithOrders = 0;
        
        for (const tw of timeWindows) {
          const perf = windowPerformance[tw.label]?.get(entityKey);
          if (perf) {
            const roas = perf.spend > 0 ? perf.sales / perf.spend : 0;
            windowData[tw.label] = { ...perf, roas };
            if (perf.orders > 0) {
              hasAnyConversion = true;
              windowsWithOrders++;
              if (roas >= roasThresholds.goodAbove) allWindowsBadRoas = false;
              if (roas > bestRoas) {
                bestRoas = roas;
                bestRoasWindow = tw.label;
                bestCpc = perf.cpc;
              }
            }
          } else {
            windowData[tw.label] = { spend: 0, sales: 0, orders: 0, clicks: 0, cpc: 0, roas: 0 };
          }
        }
        
        // 分类决策
        let action = 'keep';
        let reason = '';
        let newBid = parseFloat(entity.current_bid || '0');
        
        if (totalSpend > 0 && totalOrders === 0 && !hasAnyConversion) {
          action = 'pause';
          reason = 'zero_conversion_90d';
        } else if (totalSpend > 0 && allWindowsBadRoas && hasAnyConversion) {
          action = 'pause';
          reason = 'all_windows_bad_roas';
        } else if (hasAnyConversion && windowsWithOrders >= 2 && bestRoas >= roasThresholds.goodAbove) {
          action = 'optimize_bid';
          reason = `repeated_orders_best_window_${bestRoasWindow}`;
          newBid = Math.max(0.02, parseFloat((bestCpc * bidMultiplier).toFixed(2)));
        } else if (hasAnyConversion && bestRoas < roasThresholds.reduceBidBelow) {
          action = 'reduce_bid';
          reason = 'marginal_roas';
          newBid = Math.max(0.02, parseFloat((bestCpc * 0.6).toFixed(2)));
        }
        
        results.push({
          entity_id: entity.entity_id,
          entity_type: entity.entity_type,
          entity_text: entity.entity_text,
          match_type: entity.match_type,
          campaign_id: entity.campaign_id,
          campaign_name: entity.campaign_name,
          campaign_type: entity.campaign_type,
          amazon_entity_id: entity.amazon_entity_id,
          amazon_ad_group_id: entity.amazon_ad_group_id,
          current_bid: parseFloat(entity.current_bid || '0'),
          current_status: entity.current_status,
          total_spend: totalSpend,
          total_sales: parseFloat(entity.sales || '0'),
          total_orders: totalOrders,
          window_data: windowData,
          best_roas: bestRoas,
          best_roas_window: bestRoasWindow,
          best_cpc: bestCpc,
          windows_with_orders: windowsWithOrders,
          action,
          reason,
          new_bid: action.includes('bid') ? newBid : null,
          bid_change_pct: action.includes('bid') && parseFloat(entity.current_bid || '0') > 0
            ? parseFloat(((newBid - parseFloat(entity.current_bid || '0')) / parseFloat(entity.current_bid || '0') * 100).toFixed(1))
            : null,
        });
      }
      
      // Step 4: 汇总统计
      const toPause = results.filter(r => r.action === 'pause');
      const toOptimize = results.filter(r => r.action === 'optimize_bid');
      const toReduce = results.filter(r => r.action === 'reduce_bid');
      const toKeep = results.filter(r => r.action === 'keep');
      
      const summary = {
        totalEntities: allEntities.length,
        keywordCount: allKeywords.length,
        targetCount: allTargets.length,
        toPause: toPause.length,
        toOptimizeBid: toOptimize.length,
        toReduceBid: toReduce.length,
        toKeep: toKeep.length,
        timeWindowsUsed: timeWindows.map(tw => tw.label),
        roasThresholds,
        bidMultiplier,
        estimatedSavings: {
          fromPause: parseFloat(toPause.reduce((s: number, r: any) => s + r.total_spend, 0).toFixed(2)),
          fromReduceBid: parseFloat(toReduce.reduce((s: number, r: any) => {
            const reduction = r.current_bid > 0 ? Math.max(0, (r.current_bid - r.new_bid) / r.current_bid) : 0;
            return s + r.total_spend * reduction;
          }, 0).toFixed(2)),
          fromOptimizeBid: parseFloat(toOptimize.reduce((s: number, r: any) => {
            const reduction = r.current_bid > 0 ? Math.max(0, (r.current_bid - r.new_bid) / r.current_bid) : 0;
            return s + r.total_spend * reduction;
          }, 0).toFixed(2)),
        },
      };
      
      log.info(`bulkAnalyzeWithTimeWindows v733: pause=${toPause.length}, optimize=${toOptimize.length}, reduce=${toReduce.length}, keep=${toKeep.length}`);
      
      return {
        summary,
        toPause: toPause.sort((a: any, b: any) => b.total_spend - a.total_spend),
        toOptimizeBid: toOptimize.sort((a: any, b: any) => b.best_roas - a.best_roas),
        toReduceBid: toReduce.sort((a: any, b: any) => b.total_spend - a.total_spend),
        toKeep: toKeep.sort((a: any, b: any) => b.total_spend - a.total_spend).slice(0, 100),
      };
    }),
});
