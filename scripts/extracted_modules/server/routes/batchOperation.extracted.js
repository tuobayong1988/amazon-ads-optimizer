// Extracted from production dist/index.js
// Original module: server/routes/batchOperation.ts
// Lines: 537

var log188, batchOperationRouter;
var init_batchOperation = __esm({
  "server/routes/batchOperation.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_db2();
    init_amazonSyncService();
    init_batchOperationService();
    init_logger();
    log188 = createModuleLogger("Route_batchOperation");
    batchOperationRouter = router({
      // List batch operations
      list: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        status: external_exports.string().optional(),
        operationType: external_exports.string().optional(),
        limit: external_exports.number().optional().default(50)
      })).query(async ({ ctx, input }) => {
        return listBatchOperations(ctx.user.id, input);
      }),
      // Get batch operation details
      // v370.4: 数据隔离 - 验证批量操作归属
      get: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const batch = await getBatchOperation(input.id);
        if (!batch) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Batch operation not found" });
        }
        if (batch.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        const items = await getBatchOperationItems(input.id);
        return { ...batch, items };
      }),
      // Create batch operation for negative keywords
      createNegativeKeywordBatch: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        name: external_exports.string(),
        description: external_exports.string().optional(),
        sourceType: external_exports.string().optional(),
        sourceTaskId: external_exports.number().optional(),
        items: external_exports.array(external_exports.object({
          entityType: external_exports.enum(["keyword", "product_target", "campaign", "ad_group"]),
          entityId: external_exports.number(),
          entityName: external_exports.string().optional(),
          negativeKeyword: external_exports.string(),
          negativeMatchType: external_exports.enum(["negative_phrase", "negative_exact"]),
          negativeLevel: external_exports.enum(["ad_group", "campaign"])
        }))
      })).mutation(async ({ ctx, input }) => {
        for (const item of input.items) {
          const validation = validateNegativeKeywordItem(item);
          if (!validation.valid) {
            throw new TRPCError({ code: "BAD_REQUEST", message: validation.error });
          }
        }
        const batchId = await createBatchOperation({
          userId: ctx.user.id,
          accountId: input.accountId,
          operationType: "negative_keyword",
          name: input.name,
          description: input.description,
          requiresApproval: true,
          sourceType: input.sourceType,
          sourceTaskId: input.sourceTaskId
        });
        const itemsWithRollback = input.items.map((item) => ({
          ...item,
          previousValue: prepareRollbackData("negative_keyword", item)
        }));
        await addBatchOperationItems(batchId, itemsWithRollback);
        return { batchId, totalItems: input.items.length };
      }),
      // Create batch operation for bid adjustments
      createBidAdjustmentBatch: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        name: external_exports.string(),
        description: external_exports.string().optional(),
        sourceType: external_exports.string().optional(),
        sourceTaskId: external_exports.number().optional(),
        maxBid: external_exports.number().optional().default(100),
        items: external_exports.array(external_exports.object({
          entityType: external_exports.enum(["keyword", "product_target"]),
          entityId: external_exports.number(),
          entityName: external_exports.string().optional(),
          currentBid: external_exports.number(),
          newBid: external_exports.number(),
          bidChangeReason: external_exports.string().optional()
        }))
      })).mutation(async ({ ctx, input }) => {
        for (const item of input.items) {
          const validation = validateBidAdjustmentItem(item, input.maxBid);
          if (!validation.valid) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `${item.entityName}: ${validation.error}` });
          }
        }
        const batchId = await createBatchOperation({
          userId: ctx.user.id,
          accountId: input.accountId,
          operationType: "bid_adjustment",
          name: input.name,
          description: input.description,
          requiresApproval: true,
          sourceType: input.sourceType,
          sourceTaskId: input.sourceTaskId
        });
        const itemsWithRollback = input.items.map((item) => ({
          ...item,
          previousValue: prepareRollbackData("bid_adjustment", item)
        }));
        await addBatchOperationItems(batchId, itemsWithRollback);
        return { batchId, totalItems: input.items.length };
      }),
      // v370.4: 数据隔离 - Approve batch operation
      approve: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const batch = await getBatchOperation(input.id);
        if (!batch) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Batch operation not found" });
        }
        if (batch.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        if (batch.batchStatus !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Batch operation is not pending approval" });
        }
        await approveBatchOperation(input.id, ctx.user.id);
        return { success: true };
      }),
      // v370.4: 数据隔离 - Execute batch operation
      execute: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const batch = await getBatchOperation(input.id);
        if (!batch) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Batch operation not found" });
        }
        if (batch.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        if (batch.requiresApproval && batch.batchStatus !== "approved") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Batch operation requires approval before execution" });
        }
        if (batch.batchStatus === "executing" || batch.batchStatus === "completed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Batch operation is already executing or completed" });
        }
        await updateBatchOperationStatus(input.id, {
          status: "executing",
          executedBy: ctx.user.id,
          executedAt: /* @__PURE__ */ new Date()
        });
        const items = await getBatchOperationItems(input.id);
        let successCount = 0;
        let failedCount = 0;
        const errors = [];
        const syncTasks = [];
        for (const item of items) {
          try {
            if (batch.operationType === "negative_keyword" && item.negativeKeyword) {
              await addNegativeKeyword({
                campaignId: item.entityId,
                adGroupId: item.negativeLevel === "ad_group" ? item.entityId : void 0,
                keyword: item.negativeKeyword,
                matchType: item.negativeMatchType === "negative_phrase" ? "phrase" : "exact",
                level: item.negativeLevel
              });
              syncTasks.push({
                accountId: batch.accountId || 0,
                taskType: "negative_keyword",
                targetEntityType: item.negativeLevel === "ad_group" ? "ad_group" : "campaign",
                targetEntityId: item.entityId,
                targetEntityName: item.negativeKeyword,
                action: item.negativeMatchType === "negative_exact" ? "add_negative_exact" : "add_negative_phrase",
                source: "batch_operation",
                priority: "high"
              });
            } else if (batch.operationType === "bid_adjustment" && item.newBid) {
              if (item.entityType === "keyword") {
                await updateKeyword(item.entityId, { bid: item.newBid });
              } else if (item.entityType === "product_target") {
                await updateProductTargetBid(item.entityId, item.newBid);
              }
              syncTasks.push({
                accountId: batch.accountId || 0,
                taskType: item.entityType === "keyword" ? "bid" : "product_target_bid",
                targetEntityType: item.entityType || "keyword",
                targetEntityId: item.entityId,
                targetEntityName: item.entityType || "target",
                action: "adjust_bid",
                // @ts-ignore
                newValue: String(item.newBid),
                // @ts-ignore
                oldValue: String(item.previousBid || 0),
                source: "batch_operation",
                priority: "high"
              });
            }
            await updateBatchOperationItemStatus(item.id, {
              status: "success",
              executedAt: /* @__PURE__ */ new Date()
            });
            successCount++;
          } catch (error48) {
            const errorMessage = error48 instanceof Error ? error48.message : "Unknown error";
            await updateBatchOperationItemStatus(item.id, {
              status: "failed",
              errorMessage,
              executedAt: /* @__PURE__ */ new Date()
            });
            failedCount++;
            errors.push({ itemId: item.id, error: errorMessage });
          }
        }
        if (syncTasks.length > 0) {
          try {
            const { enqueueTasks: enqueueTasks2 } = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
            await enqueueTasks2(syncTasks);
            log188.info(`[BatchOperation] v453: \u5DF2\u5165\u961F ${syncTasks.length} \u4E2A\u540C\u6B65\u4EFB\u52A1\u5230Amazon API`);
          } catch (enqueueErr) {
            log188.warn(`[BatchOperation] v453: \u540C\u6B65\u4EFB\u52A1\u5165\u961F\u5931\u8D25: ${enqueueErr.message}`);
          }
        }
        const finalStatus = failedCount === items.length ? "failed" : "completed";
        await updateBatchOperationStatus(input.id, {
          status: finalStatus,
          processedItems: items.length,
          successItems: successCount,
          failedItems: failedCount,
          completedAt: /* @__PURE__ */ new Date()
        });
        return {
          status: finalStatus,
          totalItems: items.length,
          successItems: successCount,
          failedItems: failedCount,
          errors
        };
      }),
      // v370.4: 数据隔离 - Rollback batch operation
      rollback: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const batch = await getBatchOperation(input.id);
        if (!batch) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Batch operation not found" });
        }
        if (batch.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        if (!canRollback(batch.batchStatus, batch.completedAt ? new Date(batch.completedAt) : void 0)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot rollback this batch operation" });
        }
        const items = await getBatchOperationItems(input.id);
        let successCount = 0;
        for (const item of items) {
          if (item.itemStatus !== "success") continue;
          try {
            const rollbackData = item.previousValue ? JSON.parse(item.previousValue) : null;
            if (rollbackData?.action === "remove_negative_keyword") {
            } else if (rollbackData?.action === "restore_bid") {
              if (item.entityType === "keyword") {
                await updateKeyword(item.entityId, { bid: rollbackData.originalBid });
              } else if (item.entityType === "product_target") {
                await updateProductTargetBid(item.entityId, rollbackData.originalBid);
              }
            }
            await updateBatchOperationItemStatus(item.id, {
              status: "rolled_back"
            });
            successCount++;
          } catch (error48) {
          }
        }
        await rollbackBatchOperation(input.id, ctx.user.id);
        return { success: true, rolledBackItems: successCount };
      }),
      // v370.4: 数据隔离 - Cancel pending batch operation
      cancel: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const batch = await getBatchOperation(input.id);
        if (!batch) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Batch operation not found" });
        }
        if (batch.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        if (batch.batchStatus !== "pending" && batch.batchStatus !== "approved") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Can only cancel pending or approved operations" });
        }
        await updateBatchOperationStatus(input.id, { status: "cancelled" });
        return { success: true };
      }),
      // v370.4: 数据隔离 - Get batch operation summary
      getSummary: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const batch = await getBatchOperation(input.id);
        if (!batch) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Batch operation not found" });
        }
        if (batch.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        const result = {
          batchId: batch.id,
          status: batch.batchStatus,
          totalItems: batch.totalItems || 0,
          processedItems: batch.processedItems || 0,
          successItems: batch.successItems || 0,
          failedItems: batch.failedItems || 0,
          errors: []
        };
        return generateBatchSummary(result);
      }),
      // Estimate execution time
      // @ts-ignore
      estimateTime: protectedProcedure.input(external_exports.object({
        operationType: external_exports.enum(["negative_keyword", "bid_adjustment", "keyword_migration", "campaign_status"]),
        itemCount: external_exports.number()
      })).query(({ input }) => {
        const seconds = estimateExecutionTime(input.itemCount, input.operationType);
        return { estimatedSeconds: seconds };
      }),
      // Get operation history with detailed records
      getHistory: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        operationType: external_exports.enum(["negative_keyword", "bid_adjustment", "keyword_migration", "campaign_status"]).optional(),
        status: external_exports.enum(["pending", "approved", "executing", "completed", "failed", "cancelled", "rolled_back"]).optional(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        limit: external_exports.number().optional().default(50),
        offset: external_exports.number().optional().default(0)
      })).query(async ({ ctx, input }) => {
        const operations = await listBatchOperations(ctx.user.id, {
          accountId: input.accountId,
          status: input.status,
          operationType: input.operationType,
          limit: input.limit
        });
        let filteredOps = operations;
        if (input.startDate) {
          const startDate = new Date(input.startDate);
          filteredOps = filteredOps.filter((op) => new Date(op.createdAt) >= startDate);
        }
        if (input.endDate) {
          const endDate = new Date(input.endDate);
          endDate.setHours(23, 59, 59, 999);
          filteredOps = filteredOps.filter((op) => new Date(op.createdAt) <= endDate);
        }
        const stats4 = {
          // @ts-ignore
          total: filteredOps.length,
          // @ts-ignore
          completed: filteredOps.filter((op) => op.batchStatus === "completed").length,
          failed: filteredOps.filter((op) => op.batchStatus === "failed").length,
          pending: filteredOps.filter((op) => op.batchStatus === "pending" || op.batchStatus === "approved").length,
          rolledBack: filteredOps.filter((op) => op.batchStatus === "rolled_back").length,
          // @ts-ignore
          totalItemsProcessed: filteredOps.reduce((sum2, op) => sum2 + (op.processedItems || 0), 0),
          // @ts-ignore
          totalSuccessItems: filteredOps.reduce((sum2, op) => sum2 + (op.successItems || 0), 0),
          // @ts-ignore
          totalFailedItems: filteredOps.reduce((sum2, op) => sum2 + (op.failedItems || 0), 0)
        };
        return {
          operations: filteredOps.slice(input.offset, input.offset + input.limit),
          stats: stats4,
          pagination: {
            total: filteredOps.length,
            limit: input.limit,
            // @ts-ignore
            offset: input.offset,
            hasMore: input.offset + input.limit < filteredOps.length
          }
        };
      }),
      // v370.4: 数据隔离 - Get detailed operation record with all items
      getDetailedRecord: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const batch = await getBatchOperation(input.id);
        if (!batch) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Batch operation not found" });
        }
        if (batch.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        const items = await getBatchOperationItems(input.id);
        const itemsByStatus = {
          success: items.filter((item) => item.itemStatus === "success"),
          failed: items.filter((item) => item.itemStatus === "failed"),
          pending: items.filter((item) => item.itemStatus === "pending"),
          skipped: items.filter((item) => item.itemStatus === "skipped"),
          rolledBack: items.filter((item) => item.itemStatus === "rolled_back")
        };
        let executionDuration = null;
        if (batch.executedAt && batch.completedAt) {
          executionDuration = new Date(batch.completedAt).getTime() - new Date(batch.executedAt).getTime();
        }
        return {
          ...batch,
          items,
          itemsByStatus,
          executionDuration,
          summary: generateBatchSummary({
            batchId: batch.id,
            status: batch.batchStatus,
            totalItems: batch.totalItems || 0,
            processedItems: batch.processedItems || 0,
            successItems: batch.successItems || 0,
            failedItems: batch.failedItems || 0,
            errors: items.filter((i) => i.errorMessage).map((i) => ({
              itemId: i.id,
              error: i.errorMessage || "Unknown error"
            }))
          })
        };
      }),
      // Apply bid adjustments directly (for special scenario optimization)
      applyBidAdjustments: protectedProcedure.input(external_exports.object({
        adjustments: external_exports.array(external_exports.object({
          keywordId: external_exports.number(),
          newBid: external_exports.number(),
          reason: external_exports.string().optional()
        }))
      })).mutation(async ({ ctx, input }) => {
        let successCount = 0;
        let failedCount = 0;
        const errors = [];
        let syncService = null;
        if (input.adjustments.length > 0) {
          try {
            const firstKw = await getKeywordById(input.adjustments[0].keywordId);
            if (firstKw) {
              const adGroup = firstKw.internalAdGroupId ? await getAdGroupById(firstKw.internalAdGroupId) : null;
              const campaign = adGroup ? await getCampaignByAmazonCampaignId(adGroup.campaignId) : null;
              if (campaign?.accountId) {
                const credentials = await getAmazonApiCredentials(campaign.accountId);
                if (credentials) {
                  const accountInfo = await getAdAccountById(campaign.accountId);
                  syncService = await AmazonSyncService.createFromCredentials(
                    {
                      clientId: credentials.clientId,
                      clientSecret: credentials.clientSecret,
                      refreshToken: credentials.refreshToken,
                      profileId: credentials.profileId,
                      region: credentials.region
                    },
                    campaign.accountId,
                    ctx.user.id,
                    accountInfo?.marketplace || "US"
                  );
                }
              }
            }
          } catch (initError) {
            log188.warn("[applyBidAdjustments] \u521B\u5EFAAmazon API\u5BA2\u6237\u7AEF\u5931\u8D25:", initError.message);
          }
        }
        for (const adj of input.adjustments) {
          try {
            const keyword = await getKeywordById(adj.keywordId);
            if (!keyword) {
              throw new Error("\u5173\u952E\u8BCD\u4E0D\u5B58\u5728");
            }
            const adGroup = keyword.internalAdGroupId ? await getAdGroupById(keyword.internalAdGroupId) : null;
            const campaign = adGroup ? await getCampaignByAmazonCampaignId(adGroup.campaignId) : null;
            let apiSuccess = false;
            if (syncService && keyword.keywordId) {
              try {
                await syncService.client.updateKeywordBids([{
                  keywordId: String(keyword.keywordId),
                  // v356: 统一使用String类型传递Amazon ID
                  bid: Number(adj.newBid.toFixed(2))
                }]);
                apiSuccess = true;
              } catch (apiError) {
                log188.warn(`[applyBidAdjustments] Amazon API\u8C03\u7528\u5931\u8D25 (keyword ${adj.keywordId}):`, apiError.message);
              }
            }
            await updateKeyword(adj.keywordId, { bid: String(adj.newBid) });
            await createBiddingLog({
              accountId: campaign?.accountId || 0,
              campaignId: adGroup?.campaignId ?? "0",
              internalAdGroupId: keyword.internalAdGroupId || 0,
              // v421: internalAdGroupId已经是int类型
              logTargetType: "keyword",
              targetId: adj.keywordId,
              targetName: keyword.keywordText || "",
              actionType: adj.newBid > parseFloat(keyword.bid || "0") ? "increase" : "decrease",
              previousBid: keyword.bid || "0",
              newBid: String(adj.newBid),
              reason: `${apiSuccess ? "[API\u2705]" : syncService ? "[API\u274C]" : "[\u4EC5\u672C\u5730]"} ${adj.reason || "\u7ADE\u4EF7\u6548\u7387\u4F18\u5316"}`
            });
            successCount++;
          } catch (error48) {
            const errorMessage = error48 instanceof Error ? error48.message : "Unknown error";
            errors.push({ keywordId: adj.keywordId, error: errorMessage });
            failedCount++;
          }
        }
        return {
          success: failedCount === 0,
          totalItems: input.adjustments.length,
          successItems: successCount,
          failedItems: failedCount,
          errors
        };
      }),
      // Export operation history
      exportHistory: protectedProcedure.input(external_exports.object({
        operationIds: external_exports.array(external_exports.number()).optional(),
        format: external_exports.enum(["json", "csv"]).default("json")
      })).query(async ({ ctx, input }) => {
        let operations;
        if (input.operationIds && input.operationIds.length > 0) {
          operations = await Promise.all(
            input.operationIds.map((id) => getBatchOperation(id))
          );
          operations = operations.filter(Boolean);
        } else {
          operations = await listBatchOperations(ctx.user.id, { limit: 1e3 });
        }
        if (input.format === "csv") {
          const headers = ["ID", "\u64CD\u4F5C\u540D\u79F0", "\u64CD\u4F5C\u7C7B\u578B", "\u72B6\u6001", "\u603B\u9879\u6570", "\u6210\u529F\u6570", "\u5931\u8D25\u6570", "\u521B\u5EFA\u65F6\u95F4", "\u6267\u884C\u65F6\u95F4", "\u5B8C\u6210\u65F6\u95F4"];
          const rows = operations.map((op) => [
            op?.id,
            op?.name,
            op?.operationType,
            op?.batchStatus,
            op?.totalItems,
            op?.successItems,
            op?.failedItems,
            op?.createdAt,
            op?.executedAt,
            op?.completedAt
          ]);
          const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
          return { format: "csv", data: csv };
        }
        return { format: "json", data: operations };
      })
    });
  }
});

