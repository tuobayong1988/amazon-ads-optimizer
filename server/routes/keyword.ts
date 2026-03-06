/**
 * 关键词与商品定向路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { generateSimulatedTrendData, calculateTrendSummary } from './_helpers';
import * as db from "../db";
import * as bidOptimizer from "../bidOptimizer";
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Route_keyword');


// ==================== Keyword Router ====================
export const keywordRouter = router({
  list: protectedProcedure
    .input(z.object({ adGroupId: z.number() }))
    .query(async ({ input }) => {
      return db.getKeywordsByAdGroupId(input.adGroupId);
    }),
  
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getKeywordById(input.id);
    }),
  
  updateBid: protectedProcedure
    .input(z.object({
      id: z.number(),
      bid: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 获取关键词信息用于审计日志
      const keyword = await db.getKeywordById(input.id);
      const previousBid = keyword?.bid || '0';
      
      await db.updateKeywordBid(input.id, input.bid);
      
      // 记录审计日志
      const { logAudit } = await import("../auditService");
      await logAudit({
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        userEmail: ctx.user.email || undefined,
        actionType: 'bid_adjust_single',
        targetType: 'keyword',
        targetId: String(input.id),
        targetName: keyword?.keywordText || keyword?.keywordId || undefined,
        description: `调整关键词出价从$${previousBid}到$${input.bid}`,
        previousValue: { bid: previousBid },
        newValue: { bid: input.bid },
        status: 'success',
      });
      
      return { success: true };
    }),
  
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      bid: z.string().optional(),
      status: z.enum(["enabled", "paused", "archived"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateKeyword(id, data);
      return { success: true };
    }),
  
  // 批量更新出价
  batchUpdateBid: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      bidType: z.enum(["fixed", "increase_percent", "decrease_percent", "cpc_multiplier", "cpc_increase_percent", "cpc_decrease_percent"]),
      bidValue: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const results = [];
      for (const id of input.ids) {
        const keyword = await db.getKeywordById(id);
        if (!keyword) continue;
        
        let newBid: number;
        const currentBid = parseFloat(keyword.bid);
        const spend = parseFloat(keyword.spend || "0");
        const clicks = keyword.clicks || 0;
        const cpc = clicks > 0 ? spend / clicks : currentBid; // 如果没有点击，使用当前出价作为CPC
        
        if (input.bidType === "fixed") {
          newBid = input.bidValue;
        } else if (input.bidType === "increase_percent") {
          newBid = currentBid * (1 + input.bidValue / 100);
        } else if (input.bidType === "decrease_percent") {
          newBid = currentBid * (1 - input.bidValue / 100);
        } else if (input.bidType === "cpc_multiplier") {
          // 按CPC倍数设置出价
          newBid = cpc * input.bidValue;
        } else if (input.bidType === "cpc_increase_percent") {
          // 按CPC百分比提高
          newBid = cpc * (1 + input.bidValue / 100);
        } else {
          // cpc_decrease_percent - 按CPC百分比降低
          newBid = cpc * (1 - input.bidValue / 100);
        }
        
        // 确保出价不低于0.02
        newBid = Math.max(0.02, Math.round(newBid * 100) / 100);
        
        await db.updateKeywordBid(id, newBid.toFixed(2));
        results.push({ id, oldBid: currentBid, newBid, cpc });
      }
      
      // 记录批量出价调整审计日志
      if (results.length > 0) {
        const { logAudit } = await import("../auditService");
        const bidTypeDesc: Record<string, string> = {
          fixed: `固定出价$${input.bidValue}`,
          increase_percent: `提高${input.bidValue}%`,
          decrease_percent: `降低${input.bidValue}%`,
          cpc_multiplier: `CPC的${input.bidValue}倍`,
          cpc_increase_percent: `CPC提高${input.bidValue}%`,
          cpc_decrease_percent: `CPC降低${input.bidValue}%`,
        };
        await logAudit({
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          userEmail: ctx.user.email || undefined,
          actionType: 'bid_adjust_batch',
          targetType: 'keyword',
          description: `批量调整${results.length}个关键词出价（${bidTypeDesc[input.bidType]}）`,
          metadata: { bidType: input.bidType, bidValue: input.bidValue, count: results.length },
          previousValue: results.map(r => ({ id: r.id, bid: r.oldBid })),
          newValue: results.map(r => ({ id: r.id, bid: r.newBid })),
          status: 'success',
        });
      }
      
      // v159: 同步出价调整到Amazon
      if (results.length > 0) {
        try {
          const dbInstance = await db.getDb();
          if (dbInstance) {
            const { keywords: keywordsTable, adGroups, campaigns } = await import('../../drizzle/schema');
            const { eq, inArray } = await import('drizzle-orm');
            
            const kwDetails = await dbInstance.select({
              kwId: keywordsTable.id,
              adGroupId: keywordsTable.adGroupId,
              campaignId: adGroups.campaignId,
              accountId: campaigns.accountId,
            })
            .from(keywordsTable)
            .innerJoin(adGroups, eq(keywordsTable.adGroupId, adGroups.id))
            .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
            .where(inArray(keywordsTable.id, results.map(r => r.id)));
            
            const byAccount = new Map<number, Array<{ keywordId: number; newBid: number; campaignId: number }>>();
            for (const kw of kwDetails) {
              const r = results.find(r => r.id === kw.kwId);
              if (!r) continue;
              if (!byAccount.has(kw.accountId)) byAccount.set(kw.accountId, []);
              byAccount.get(kw.accountId)!.push({ keywordId: kw.kwId, newBid: r.newBid, campaignId: kw.campaignId } as any);
            }
            
            const { syncBidAdjustmentsToAmazon } = await import('../services/amazonApiHelper');
            for (const [accountId, kws] of byAccount) {
              const adjustments = kws.map(kw => ({
                keywordId: kw.keywordId,
                newBid: kw.newBid,
                campaignId: kw.campaignId,
                reason: `用户手动批量调整关键词出价`,
              }));
              const syncResult = await syncBidAdjustmentsToAmazon(accountId, adjustments);
              log.info(`[Keyword.batchUpdateBid] v159: accountId=${accountId}, 同步结果: 成功=${syncResult.success}, 失败=${syncResult.failed}`);
              
              // v219: 出价同步后触发确认同步
              if (syncResult.success > 0) {
                try {
                  const { confirmationSync } = await import('../unifiedSyncEngine');
                  confirmationSync(accountId, ['keywords'], 'batchUpdateBid').catch((err: any) => {
                    log.error(`[Keyword.batchUpdateBid] v220: 确认同步失败:`, err.message);
                  });
                } catch (e: any) { log.debug(`确认同步触发忽略: ${e instanceof Error ? e.message : e}`); }
              }
            }
          }
        } catch (syncError: any) {
          log.error(`[Keyword.batchUpdateBid] v159: Amazon同步失败(本地已更新):`, syncError.message);
        }
      }
      
      return { success: true, updated: results.length, results };
    }),
  
  // 批量更新状态
  batchUpdateStatus: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      status: z.enum(["enabled", "paused"]),
    }))
    .mutation(async ({ input }) => {
      // v159: 先更新本地数据库
      let updated = 0;
      for (const id of input.ids) {
        await db.updateKeyword(id, { keywordStatus: input.status });
        updated++;
      }
      
      // v159: 同步关键词状态变更到Amazon
      try {
        // 获取关键词的accountId（通过adGroup -> campaign关联）
        const dbInstance = await db.getDb();
        if (dbInstance) {
          const { keywords: keywordsTable, adGroups, campaigns } = await import('../../drizzle/schema');
          const { eq, inArray } = await import('drizzle-orm');
          
          // 查询关键词关联的accountId
          const kwDetails = await dbInstance.select({
            kwId: keywordsTable.id,
            adGroupId: keywordsTable.adGroupId,
            campaignId: adGroups.campaignId,
            accountId: campaigns.accountId,
          })
          .from(keywordsTable)
          .innerJoin(adGroups, eq(keywordsTable.adGroupId, adGroups.id))
          .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
          .where(inArray(keywordsTable.id, input.ids));
          
          // 按accountId分组
          const byAccount = new Map<number, Array<{ keywordId: number; campaignId: number }>>();
          for (const kw of kwDetails) {
            if (!byAccount.has(kw.accountId)) byAccount.set(kw.accountId, []);
            byAccount.get(kw.accountId)!.push({ keywordId: kw.kwId, campaignId: kw.campaignId } as any);
          }
          
          // 按账号同步到Amazon
          const { syncKeywordStatusToAmazon } = await import('../services/amazonApiHelper');
          for (const [accountId, kws] of byAccount) {
            const statusChanges = kws.map(kw => ({
              keywordId: kw.keywordId,
              newStatus: input.status as 'enabled' | 'paused',
              campaignId: kw.campaignId,
              reason: `用户手动批量${input.status === 'enabled' ? '启用' : '暂停'}关键词`,
            }));
            const syncResult = await syncKeywordStatusToAmazon(accountId, statusChanges);
            log.info(`[Keyword.batchUpdateStatus] v159: accountId=${accountId}, 同步结果: 成功=${syncResult.success}, 失败=${syncResult.failed}`);
            
            // v219: 关键词状态同步后触发确认同步
            if (syncResult.success > 0) {
              try {
                const { confirmationSync } = await import('../unifiedSyncEngine');
                confirmationSync(accountId, ['keywords'], 'batchUpdateStatus').catch((err: any) => {
                  log.error(`[Keyword.batchUpdateStatus] v220: 确认同步失败:`, err.message);
                });
              } catch (e: any) { log.debug(`确认同步触发忽略: ${e instanceof Error ? e.message : e}`); }
            }
          }
        }
      } catch (syncError: any) {
        log.error(`[Keyword.batchUpdateStatus] v159: Amazon同步失败(本地已更新):`, syncError.message);
      }
      
      return { success: true, updated };
    }),
  
  getMarketCurve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const keyword = await db.getKeywordById(input.id);
      if (!keyword) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Keyword not found" });
      }
      
      const target: bidOptimizer.OptimizationTarget = {
        id: keyword.id,
        type: "keyword",
        currentBid: parseFloat(keyword.bid),
        impressions: keyword.impressions || 0,
        clicks: keyword.clicks || 0,
        spend: parseFloat(keyword.spend || "0"),
        sales: parseFloat(keyword.sales || "0"),
        orders: keyword.orders || 0,
        matchType: keyword.matchType,
      };
      
      return bidOptimizer.generateMarketCurve(target);
    }),
  
  // 获取关键词历史趋势数据
  getHistoryTrend: protectedProcedure
    .input(z.object({
      id: z.number(),
      days: z.number().min(7).max(90).default(30),
    }))
    .query(async ({ input }) => {
      const keyword = await db.getKeywordById(input.id);
      if (!keyword) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Keyword not found" });
      }
      
      // 获取历史数据
      const historyData = await db.getKeywordHistoryData(input.id, input.days);
      
      // 如果没有历史数据，生成模拟数据
      if (!historyData || historyData.length === 0) {
        const simulatedData = generateSimulatedTrendData(keyword, input.days);
        return {
          keyword: {
            id: keyword.id,
            keywordText: keyword.keywordText,
            matchType: keyword.matchType,
            bid: keyword.bid,
          },
          trendData: simulatedData,
          summary: calculateTrendSummary(simulatedData),
        };
      }
      
      return {
        keyword: {
          id: keyword.id,
          keywordText: keyword.keywordText,
          matchType: keyword.matchType,
          bid: keyword.bid,
        },
        trendData: historyData,
        summary: calculateTrendSummary(historyData),
      };
    }),
  
  // 批量创建关键词（从搜索词转投放词）
  batchCreate: protectedProcedure
    .input(z.object({
      adGroupId: z.number(),
      keywords: z.array(z.object({
        keywordText: z.string(),
        matchType: z.enum(["broad", "phrase", "exact"]),
        bid: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const results = [];
      const errors = [];
      
      for (const kw of input.keywords) {
        try {
          // 检查是否已存在相同的关键词（相同文本+相同匹配方式）
          const existingKeywords = await db.getKeywordsByAdGroupId(input.adGroupId);
          const exists = existingKeywords.some(
            (existing) => 
              existing.keywordText.toLowerCase() === kw.keywordText.toLowerCase() &&
              existing.matchType === kw.matchType
          );
          
          if (exists) {
            errors.push({
              keywordText: kw.keywordText,
              matchType: kw.matchType,
              error: "关键词已存在",
            });
            continue;
          }
          
          const id = await db.createKeyword({
            adGroupId: input.adGroupId,
            keywordText: kw.keywordText,
            matchType: kw.matchType,
            bid: kw.bid,
            keywordStatus: "enabled",
          });
          
          results.push({
            id,
            keywordText: kw.keywordText,
            matchType: kw.matchType,
            bid: kw.bid,
          });
        } catch (error) {
          errors.push({
            keywordText: kw.keywordText,
            matchType: kw.matchType,
            error: error instanceof Error ? error.message : "创建失败",
          });
        }
      }
      
      return {
        success: true,
        created: results.length,
        failed: errors.length,
        results,
        errors,
      };
    }),
});


// ==================== Product Target Router ====================
export const productTargetRouter = router({
  list: protectedProcedure
    .input(z.object({ adGroupId: z.number() }))
    .query(async ({ input }) => {
      return db.getProductTargetsByAdGroupId(input.adGroupId);
    }),
  
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getProductTargetById(input.id);
    }),
  
  updateBid: protectedProcedure
    .input(z.object({
      id: z.number(),
      bid: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.updateProductTargetBid(input.id, input.bid);
      return { success: true };
    }),
  
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      bid: z.string().optional(),
      status: z.enum(["enabled", "paused", "archived"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateProductTarget(id, data);
      return { success: true };
    }),
  
  // 批量更新出价
  batchUpdateBid: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      bidType: z.enum(["fixed", "increase_percent", "decrease_percent", "cpc_multiplier", "cpc_increase_percent", "cpc_decrease_percent"]),
      bidValue: z.number(),
    }))
    .mutation(async ({ input }) => {
      const results = [];
      for (const id of input.ids) {
        const target = await db.getProductTargetById(id);
        if (!target) continue;
        
        let newBid: number;
        const currentBid = parseFloat(target.bid);
        const spend = parseFloat(target.spend || "0");
        const clicks = target.clicks || 0;
        const cpc = clicks > 0 ? spend / clicks : currentBid;
        
        if (input.bidType === "fixed") {
          newBid = input.bidValue;
        } else if (input.bidType === "increase_percent") {
          newBid = currentBid * (1 + input.bidValue / 100);
        } else if (input.bidType === "decrease_percent") {
          newBid = currentBid * (1 - input.bidValue / 100);
        } else if (input.bidType === "cpc_multiplier") {
          newBid = cpc * input.bidValue;
        } else if (input.bidType === "cpc_increase_percent") {
          newBid = cpc * (1 + input.bidValue / 100);
        } else {
          newBid = cpc * (1 - input.bidValue / 100);
        }
        
        newBid = Math.max(0.02, Math.round(newBid * 100) / 100);
        
        await db.updateProductTargetBid(id, newBid.toFixed(2));
        results.push({ id, oldBid: currentBid, newBid, cpc });
      }
      
      // v159: 同步商品定向出价调整到Amazon
      if (results.length > 0) {
        try {
          const dbInstance = await db.getDb();
          if (dbInstance) {
            const { productTargets, adGroups, campaigns } = await import('../../drizzle/schema');
            const { eq, inArray } = await import('drizzle-orm');
            
            const ptDetails = await dbInstance.select({
              ptId: productTargets.id,
              adGroupId: productTargets.adGroupId,
              campaignId: adGroups.campaignId,
              accountId: campaigns.accountId,
            })
            .from(productTargets)
            .innerJoin(adGroups, eq(productTargets.adGroupId, adGroups.id))
            .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
            .where(inArray(productTargets.id, results.map(r => r.id)));
            
            const byAccount = new Map<number, Array<{ keywordId: number; newBid: number; campaignId: number }>>();
            for (const pt of ptDetails) {
              const r = results.find(r => r.id === pt.ptId);
              if (!r) continue;
              if (!byAccount.has(pt.accountId)) byAccount.set(pt.accountId, []);
              byAccount.get(pt.accountId)!.push({ keywordId: pt.ptId, newBid: r.newBid, campaignId: pt.campaignId } as any);
            }
            
            const { syncBidAdjustmentsToAmazon } = await import('../services/amazonApiHelper');
            for (const [accountId, pts] of byAccount) {
              const adjustments = pts.map(pt => ({
                keywordId: pt.keywordId,
                newBid: pt.newBid,
                campaignId: pt.campaignId,
                reason: `用户手动批量调整商品定向出价`,
                isProductTarget: true,
              }));
              const syncResult = await syncBidAdjustmentsToAmazon(accountId, adjustments);
              log.info(`[ProductTarget.batchUpdateBid] v159: accountId=${accountId}, 同步结果: 成功=${syncResult.success}, 失败=${syncResult.failed}`);
            }
          }
        } catch (syncError: any) {
          log.error(`[ProductTarget.batchUpdateBid] v159: Amazon同步失败(本地已更新):`, syncError.message);
        }
      }
      
      return { success: true, updated: results.length, results };
    }),
  
  // 批量更新状态
  batchUpdateStatus: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      status: z.enum(["enabled", "paused"]),
    }))
    .mutation(async ({ input }) => {
      // v159: 先更新本地数据库
      let updated = 0;
      for (const id of input.ids) {
        await db.updateProductTarget(id, { targetStatus: input.status });
        updated++;
      }
      
      // v159: 同步商品定向状态变更到Amazon
      try {
        const dbInstance = await db.getDb();
        if (dbInstance) {
          const { productTargets, adGroups, campaigns } = await import('../../drizzle/schema');
          const { eq, inArray } = await import('drizzle-orm');
          
          const ptDetails = await dbInstance.select({
            ptId: productTargets.id,
            adGroupId: productTargets.adGroupId,
            campaignId: adGroups.campaignId,
            accountId: campaigns.accountId,
          })
          .from(productTargets)
          .innerJoin(adGroups, eq(productTargets.adGroupId, adGroups.id))
          .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
          .where(inArray(productTargets.id, input.ids));
          
          const byAccount = new Map<number, Array<{ keywordId: number; campaignId: number }>>();
          for (const pt of ptDetails) {
            if (!byAccount.has(pt.accountId)) byAccount.set(pt.accountId, []);
            byAccount.get(pt.accountId)!.push({ keywordId: pt.ptId, campaignId: pt.campaignId } as any);
          }
          
          const { syncKeywordStatusToAmazon } = await import('../services/amazonApiHelper');
          for (const [accountId, pts] of byAccount) {
            const statusChanges = pts.map(pt => ({
              keywordId: pt.keywordId,
              newStatus: input.status as 'enabled' | 'paused',
              campaignId: pt.campaignId,
              reason: `用户手动批量${input.status === 'enabled' ? '启用' : '暂停'}商品定向`,
              isProductTarget: true,
            }));
            const syncResult = await syncKeywordStatusToAmazon(accountId, statusChanges);
            log.info(`[ProductTarget.batchUpdateStatus] v159: accountId=${accountId}, 同步结果: 成功=${syncResult.success}, 失败=${syncResult.failed}`);
          }
        }
      } catch (syncError: any) {
        log.error(`[ProductTarget.batchUpdateStatus] v159: Amazon同步失败(本地已更新):`, syncError.message);
      }
      
      return { success: true, updated };
    }),
  
  // 获取商品定向历史趋势数据
  getHistoryTrend: protectedProcedure
    .input(z.object({
      id: z.number(),
      days: z.number().min(7).max(90).default(30),
    }))
    .query(async ({ input }) => {
      const target = await db.getProductTargetById(input.id);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Product target not found" });
      }
      
      // 获取历史数据
      const historyData = await db.getProductTargetHistoryData(input.id, input.days);
      
      // 如果没有历史数据，生成模拟数据
      if (!historyData || historyData.length === 0) {
        const simulatedData = generateSimulatedTrendData(target, input.days);
        return {
          target: {
            id: target.id,
            targetExpression: target.targetExpression,
            targetType: target.targetType,
            bid: target.bid,
          },
          trendData: simulatedData,
          summary: calculateTrendSummary(simulatedData),
        };
      }
      
      return {
        target: {
          id: target.id,
          targetExpression: target.targetExpression,
          targetType: target.targetType,
          bid: target.bid,
        },
        trendData: historyData,
        summary: calculateTrendSummary(historyData),
      };
    }),
});
