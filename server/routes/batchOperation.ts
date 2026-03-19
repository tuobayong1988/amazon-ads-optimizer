/**
 * 批量操作路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { AmazonSyncService } from '../sync/amazonSyncService';
import { runAutoBidOptimization } from '../sync/autoBidOptimization';
import * as batchOperationService from '../automation/batchOperationService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Route_batchOperation');

export const batchOperationRouter = router({
  // List batch operations
  list: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      status: z.string().optional(),
      operationType: z.string().optional(),
      limit: z.number().optional().default(50),
    }))
    .query(async ({ ctx, input }) => {
      return db.listBatchOperations(ctx.user.id, input);
    }),

  // Get batch operation details
  // v370.4: 数据隔离 - 验证批量操作归属
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }: unknown) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (batch.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }
      const items = await db.getBatchOperationItems(input.id);
      return { ...batch, items };
    }),

  // Create batch operation for negative keywords
  createNegativeKeywordBatch: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      name: z.string(),
      description: z.string().optional(),
      sourceType: z.string().optional(),
      sourceTaskId: z.number().optional(),
      items: z.array(z.object({
        entityType: z.enum(['keyword', 'product_target', 'campaign', 'ad_group']),
        entityId: z.number(),
        entityName: z.string().optional(),
        negativeKeyword: z.string(),
        negativeMatchType: z.enum(['negative_phrase', 'negative_exact']),
        negativeLevel: z.enum(['ad_group', 'campaign']),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate items
      for (const item of input.items) {
        const validation = batchOperationService.validateNegativeKeywordItem(item);
        if (!validation.valid) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: validation.error });
        }
      }

      // Create batch operation
      const batchId = await db.createBatchOperation({
        userId: ctx.user.id,
        accountId: input.accountId,
        operationType: 'negative_keyword',
        name: input.name,
        description: input.description,
        requiresApproval: true,
        sourceType: input.sourceType,
        sourceTaskId: input.sourceTaskId,
      });

      // Add items with rollback data
      const itemsWithRollback = input.items.map(item => ({
        ...item,
        previousValue: batchOperationService.prepareRollbackData('negative_keyword', item),
      }));
      await db.addBatchOperationItems(batchId, itemsWithRollback);

      return { batchId, totalItems: input.items.length };
    }),

  // Create batch operation for bid adjustments
  createBidAdjustmentBatch: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      name: z.string(),
      description: z.string().optional(),
      sourceType: z.string().optional(),
      sourceTaskId: z.number().optional(),
      maxBid: z.number().optional().default(100),
      items: z.array(z.object({
        entityType: z.enum(['keyword', 'product_target']),
        entityId: z.number(),
        entityName: z.string().optional(),
        currentBid: z.number(),
        newBid: z.number(),
        bidChangeReason: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate items
      for (const item of input.items) {
        const validation = batchOperationService.validateBidAdjustmentItem(item, input.maxBid);
        if (!validation.valid) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `${item.entityName}: ${validation.error}` });
        }
      }

      // Create batch operation
      const batchId = await db.createBatchOperation({
        userId: ctx.user.id,
        accountId: input.accountId,
        operationType: 'bid_adjustment',
        name: input.name,
        description: input.description,
        requiresApproval: true,
        sourceType: input.sourceType,
        sourceTaskId: input.sourceTaskId,
      });

      // Add items with rollback data
      const itemsWithRollback = input.items.map(item => ({
        ...item,
        previousValue: batchOperationService.prepareRollbackData('bid_adjustment', item),
      }));
      await db.addBatchOperationItems(batchId, itemsWithRollback);

      return { batchId, totalItems: input.items.length };
    }),

  // v370.4: 数据隔离 - Approve batch operation
  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (batch.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }
      if (batch.batchStatus !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Batch operation is not pending approval' });
      }

      await db.approveBatchOperation(input.id, ctx.user.id);
      return { success: true };
    }),

  // v370.4: 数据隔离 - Execute batch operation
  execute: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (batch.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }
      if (batch.requiresApproval && batch.batchStatus !== 'approved') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Batch operation requires approval before execution' });
      }
      if (batch.batchStatus === 'executing' || batch.batchStatus === 'completed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Batch operation is already executing or completed' });
      }

      // Update status to executing
      await db.updateBatchOperationStatus(input.id, {
        status: 'executing',
        executedBy: ctx.user.id,
        executedAt: new Date(),
      });

      // Get items and execute
      const items = await db.getBatchOperationItems(input.id);
      let successCount = 0;
      let failedCount = 0;
      const errors: Array<{ itemId: number; error: string }> = [];

      // v453: 收集同步任务，确保批量操作通过Amazon API真正生效
      const syncTasks: Array<Record<string, unknown>> = [];
      
      for (const item of items) {
        try {
          // Execute based on operation type
          if (batch.operationType === 'negative_keyword' && item.negativeKeyword) {
            // Add negative keyword to local DB
            await db.addNegativeKeyword({
              campaignId: item.entityId,
              adGroupId: item.negativeLevel === 'ad_group' ? item.entityId : undefined,
              keyword: item.negativeKeyword,
              matchType: item.negativeMatchType === 'negative_phrase' ? 'phrase' : 'exact',
              level: item.negativeLevel as 'ad_group' | 'campaign',
            });
            // v453: 创建同步任务
            syncTasks.push({
              accountId: batch.accountId || 0,
              taskType: 'negative_keyword',
              targetEntityType: item.negativeLevel === 'ad_group' ? 'ad_group' : 'campaign',
              targetEntityId: item.entityId,
              targetEntityName: item.negativeKeyword,
              action: item.negativeMatchType === 'negative_exact' ? 'add_negative_exact' : 'add_negative_phrase',
              source: 'batch_operation',
              priority: 'high',
            });
          } else if (batch.operationType === 'bid_adjustment' && item.newBid) {
            // Update bid in local DB
            if (item.entityType === 'keyword') {
              await db.updateKeyword(item.entityId, { bid: item.newBid });
            } else if (item.entityType === 'product_target') {
              await db.updateProductTargetBid(item.entityId, item.newBid);
            }
            // v453: 创建同步任务
            syncTasks.push({
              accountId: batch.accountId || 0,
              taskType: item.entityType === 'keyword' ? 'bid' : 'product_target_bid',
              targetEntityType: item.entityType || 'keyword',
              targetEntityId: item.entityId,
              targetEntityName: item.entityType || 'target',
              action: 'adjust_bid',
              newValue: String(item.newBid),
              oldValue: String(item.previousBid || 0),
              source: 'batch_operation',
              priority: 'high',
            });
          }

          await db.updateBatchOperationItemStatus(item.id, {
            status: 'success',
            executedAt: new Date(),
          });
          successCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? (error as Error).message : 'Unknown error';
          await db.updateBatchOperationItemStatus(item.id, {
            status: 'failed',
            errorMessage,
            executedAt: new Date(),
          });
          failedCount++;
          errors.push({ itemId: item.id, error: errorMessage });
        }
      }
      
      // v453: 将同步任务入队到优化同步引擎
      if (syncTasks.length > 0) {
        try {
          const { enqueueTasks } = await import('../sync/optimizationSyncEngine');
          await enqueueTasks(syncTasks as unknown[]);
          log.info(`[BatchOperation] v453: 已入队 ${syncTasks.length} 个同步任务到Amazon API`);
        } catch (enqueueErr: unknown) {
          log.error(`[BatchOperation] v453: 同步任务入队失败: ${(enqueueErr as Error).message}`);
        }
      }

      // Update batch status
      const finalStatus = failedCount === items.length ? 'failed' : 'completed';
      await db.updateBatchOperationStatus(input.id, {
        status: finalStatus,
        processedItems: items.length,
        successItems: successCount,
        failedItems: failedCount,
        completedAt: new Date(),
      });

      return {
        status: finalStatus,
        totalItems: items.length,
        successItems: successCount,
        failedItems: failedCount,
        errors,
      };
    }),

  // v370.4: 数据隔离 - Rollback batch operation
  rollback: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (batch.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }
      if (!batchOperationService.canRollback(batch.batchStatus as batchOperationService.BatchStatus, batch.completedAt ? new Date(batch.completedAt) : undefined)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot rollback this batch operation' });
      }

      // Get items and rollback
      const items = await db.getBatchOperationItems(input.id);
      let successCount = 0;

      for (const item of items) {
        if (item.itemStatus !== 'success') continue;

        try {
          const rollbackData = item.previousValue ? JSON.parse(item.previousValue) : null;
          
          if (rollbackData?.action === 'remove_negative_keyword') {
            // Remove the negative keyword that was added
            // This would require a delete function
          } else if (rollbackData?.action === 'restore_bid') {
            // Restore original bid
            if (item.entityType === 'keyword') {
              await db.updateKeyword(item.entityId, { bid: rollbackData.originalBid });
            } else if (item.entityType === 'product_target') {
              await db.updateProductTargetBid(item.entityId, rollbackData.originalBid);
            }
          }

          await db.updateBatchOperationItemStatus(item.id, {
            status: 'rolled_back',
          });
          successCount++;
        } catch (error) {
          // Continue with other items even if one fails
        }
      }

      await db.rollbackBatchOperation(input.id, ctx.user.id);

      return { success: true, rolledBackItems: successCount };
    }),

  // v370.4: 数据隔离 - Cancel pending batch operation
  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }: unknown) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (batch.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }
      if (batch.batchStatus !== 'pending' && batch.batchStatus !== 'approved') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Can only cancel pending or approved operations' });
      }

      await db.updateBatchOperationStatus(input.id, { status: 'cancelled' });
      return { success: true };
    }),

  // v370.4: 数据隔离 - Get batch operation summary
  getSummary: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }: unknown) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (batch.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const result: batchOperationService.BatchOperationResult = {
        batchId: batch.id,
        status: batch.batchStatus as batchOperationService.BatchStatus,
        totalItems: batch.totalItems || 0,
        processedItems: batch.processedItems || 0,
        successItems: batch.successItems || 0,
        failedItems: batch.failedItems || 0,
        errors: [],
      };

      return batchOperationService.generateBatchSummary(result);
    }),

  // Estimate execution time
  estimateTime: protectedProcedure
    .input(z.object({
      operationType: z.enum(['negative_keyword', 'bid_adjustment', 'keyword_migration', 'campaign_status']),
      itemCount: z.number(),
    }))
    .query(({ input }: unknown) => {
      const seconds = batchOperationService.estimateExecutionTime(input.itemCount, input.operationType);
      return { estimatedSeconds: seconds };
    }),

  // Get operation history with detailed records
  getHistory: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      operationType: z.enum(['negative_keyword', 'bid_adjustment', 'keyword_migration', 'campaign_status']).optional(),
      status: z.enum(['pending', 'approved', 'executing', 'completed', 'failed', 'cancelled', 'rolled_back']).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const operations = await db.listBatchOperations(ctx.user.id, {
        accountId: input.accountId,
        status: input.status,
        operationType: input.operationType,
        limit: input.limit,
      });

      // Filter by date if provided
      let filteredOps = operations;
      if (input.startDate) {
        const startDate = new Date(input.startDate);
        filteredOps = filteredOps.filter(op => new Date(op.createdAt) >= startDate);
      }
      if (input.endDate) {
        const endDate = new Date(input.endDate);
        endDate.setHours(23, 59, 59, 999);
        filteredOps = filteredOps.filter(op => new Date(op.createdAt) <= endDate);
      }

      // Calculate statistics
      const stats = {
        total: filteredOps.length,
        completed: filteredOps.filter(op => op.batchStatus === 'completed').length,
        failed: filteredOps.filter(op => op.batchStatus === 'failed').length,
        pending: filteredOps.filter(op => op.batchStatus === 'pending' || op.batchStatus === 'approved').length,
        rolledBack: filteredOps.filter(op => op.batchStatus === 'rolled_back').length,
        totalItemsProcessed: filteredOps.reduce((sum: number, op: Record<string, unknown>) => sum + (op.processedItems || 0), 0),
        totalSuccessItems: filteredOps.reduce((sum: number, op: Record<string, unknown>) => sum + (op.successItems || 0), 0),
        totalFailedItems: filteredOps.reduce((sum: number, op: Record<string, unknown>) => sum + (op.failedItems || 0), 0),
      };

      return {
        operations: filteredOps.slice(input.offset, input.offset + input.limit),
        stats,
        pagination: {
          total: filteredOps.length,
          limit: input.limit,
          offset: input.offset,
          hasMore: input.offset + input.limit < filteredOps.length,
        },
      };
    }),

  // v370.4: 数据隔离 - Get detailed operation record with all items
  getDetailedRecord: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }: unknown) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (batch.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }
      const items = await db.getBatchOperationItems(input.id);

      // Group items by status
      const itemsByStatus = {
        success: items.filter(item => item.itemStatus === 'success'),
        failed: items.filter(item => item.itemStatus === 'failed'),
        pending: items.filter(item => item.itemStatus === 'pending'),
        skipped: items.filter(item => item.itemStatus === 'skipped'),
        rolledBack: items.filter(item => item.itemStatus === 'rolled_back'),
      };

      // Calculate execution duration
      let executionDuration: number | null = null;
      if (batch.executedAt && batch.completedAt) {
        executionDuration = new Date(batch.completedAt).getTime() - new Date(batch.executedAt).getTime();
      }

      return {
        ...batch,
        items,
        itemsByStatus,
        executionDuration,
        summary: batchOperationService.generateBatchSummary({
          batchId: batch.id,
          status: batch.batchStatus as batchOperationService.BatchStatus,
          totalItems: batch.totalItems || 0,
          processedItems: batch.processedItems || 0,
          successItems: batch.successItems || 0,
          failedItems: batch.failedItems || 0,
          errors: items.filter(i => i.errorMessage).map(i => ({
            itemId: i.id,
            error: i.errorMessage || 'Unknown error',
          })),
        }),
      };
    }),

  // Apply bid adjustments directly (for special scenario optimization)
  applyBidAdjustments: protectedProcedure
    .input(z.object({
      adjustments: z.array(z.object({
        keywordId: z.number(),
        newBid: z.number(),
        reason: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let successCount = 0;
      let failedCount = 0;
      const errors: Array<{ keywordId: number; error: string }> = [];

      // ✅ 修复P0-2: 创建Amazon API客户端，确保出价调整传递到Amazon
      // 先获取第一个keyword的accountId来创建API客户端
      let syncService: AmazonSyncService | null = null;
      if (input.adjustments.length > 0) {
        try {
          const firstKw = await db.getKeywordById(input.adjustments[0].keywordId);
          if (firstKw) {
            const adGroup = firstKw.internalAdGroupId ? await db.getAdGroupById(firstKw.internalAdGroupId) : null;  // v421: 使用internalAdGroupId(int)
            // v209: 使用getCampaignByAmazonId — adGroup.campaignId是Amazon varchar ID
            const campaign = adGroup ? await db.getCampaignByAmazonCampaignId(adGroup.campaignId) : null;
            if (campaign?.accountId) {
              const credentials = await db.getAmazonApiCredentials(campaign.accountId);
              if (credentials) {
                const accountInfo = await db.getAdAccountById(campaign.accountId);
                syncService = await AmazonSyncService.createFromCredentials(
                  {
                    clientId: credentials.clientId,
                    clientSecret: credentials.clientSecret,
                    refreshToken: credentials.refreshToken,
                    profileId: credentials.profileId,
                    region: credentials.region as 'NA' | 'EU' | 'FE',
                  },
                  campaign.accountId,
                  ctx.user.id,
                  accountInfo?.marketplace || 'US'
                );
              }
            }
          }
        } catch (initError: unknown) {
          log.error('[applyBidAdjustments] 创建Amazon API客户端失败:', (initError as Error).message);
        }
      }

      for (const adj of input.adjustments) {
        try {
          // Get current keyword info
          const keyword = await db.getKeywordById(adj.keywordId);
          if (!keyword) {
            throw new Error('关键词不存在');
          }

          // Get ad group to find campaign
          const adGroup = keyword.internalAdGroupId ? await db.getAdGroupById(keyword.internalAdGroupId) : null;  // v421: 使用internalAdGroupId(int)
          // v209: 使用getCampaignByAmazonId — adGroup.campaignId是Amazon varchar ID
          const campaign = adGroup ? await db.getCampaignByAmazonCampaignId(adGroup.campaignId) : null;

          // ✅ 先通过Amazon API更新出价
          let apiSuccess = false;
          if (syncService && keyword.keywordId) {
            try {
              await (syncService as Record<string, unknown>).client.updateKeywordBids([{
                keywordId: String(keyword.keywordId),  // v356: 统一使用String类型传递Amazon ID
                bid: Number(adj.newBid.toFixed(2)),
              }]);
              apiSuccess = true;
            } catch (apiError: unknown) {
              log.error(`[applyBidAdjustments] Amazon API调用失败 (keyword ${adj.keywordId}):`, (apiError as Error).message);
            }
          }

          // Update local bid
          await db.updateKeyword(adj.keywordId, { bid: String(adj.newBid) });

          // Log the adjustment using biddingLogs
          await db.createBiddingLog({
            accountId: campaign?.accountId || 0,
            campaignId: adGroup?.campaignId ?? '0',
            internalAdGroupId: keyword.internalAdGroupId || 0,  // v421: internalAdGroupId已经是int类型
            logTargetType: 'keyword',
            targetId: adj.keywordId,
            targetName: keyword.keywordText || '',
            actionType: adj.newBid > parseFloat(keyword.bid || '0') ? 'increase' : 'decrease',
            previousBid: keyword.bid || '0',
            newBid: String(adj.newBid),
            reason: `${apiSuccess ? '[API✅]' : syncService ? '[API❌]' : '[仅本地]'} ${adj.reason || '竞价效率优化'}`,
          });

          successCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? (error as Error).message : 'Unknown error';
          errors.push({ keywordId: adj.keywordId, error: errorMessage });
          failedCount++;
        }
      }

      return {
        success: failedCount === 0,
        totalItems: input.adjustments.length,
        successItems: successCount,
        failedItems: failedCount,
        errors,
      };
    }),

  // Export operation history
  exportHistory: protectedProcedure
    .input(z.object({
      operationIds: z.array(z.number()).optional(),
      format: z.enum(['json', 'csv']).default('json'),
    }))
    .query(async ({ ctx, input }) => {
      let operations;
      if (input.operationIds && input.operationIds.length > 0) {
        operations = await Promise.all(
          input.operationIds.map(id => db.getBatchOperation(id))
        );
        operations = operations.filter(Boolean);
      } else {
        operations = await db.listBatchOperations(ctx.user.id, { limit: 1000 });
      }

      if (input.format === 'csv') {
        const headers = ['ID', '操作名称', '操作类型', '状态', '总项数', '成功数', '失败数', '创建时间', '执行时间', '完成时间'];
        const rows = operations.map(op => [
          op?.id,
          op?.name,
          op?.operationType,
          op?.batchStatus,
          op?.totalItems,
          op?.successItems,
          op?.failedItems,
          op?.createdAt,
          op?.executedAt,
          op?.completedAt,
        ]);
        const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
        return { format: 'csv', data: csv };
      }

      return { format: 'json', data: operations };
    }),
});
