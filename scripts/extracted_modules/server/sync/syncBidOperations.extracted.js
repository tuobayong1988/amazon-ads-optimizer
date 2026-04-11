// Extracted from production dist/index.js
// Original module: server/sync/syncBidOperations.ts
// Lines: 266

var log212;
var init_syncBidOperations = __esm({
  "server/sync/syncBidOperations.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_logger();
    init_amazonSyncService();
    log212 = createModuleLogger("bidOperations");
    AmazonSyncService.prototype.applyBidAdjustment = async function(targetType, targetId, newBid, reason, campaignId, algorithmUsed) {
      const db = await getDb();
      if (!db) return false;
      let amazonId = "";
      let oldBid = 0;
      let targetName = "";
      let adGroupId = null;
      let resolvedCampaignId = "";
      try {
        if (targetType === "keyword") {
          const [kw] = await db.select().from(keywords).where(eq(keywords.id, targetId)).limit(1);
          if (!kw) {
            log212.warn(`[applyBidAdjustment] keyword id=${targetId} \u4E0D\u5B58\u5728`);
            return false;
          }
          if (!kw.keywordId) {
            log212.debug(`[applyBidAdjustment] keyword id=${targetId} ("${kw.keywordText}") \u7F3A\u5C11keywordId\uFF0C\u5C1D\u8BD5\u89E3\u6790...`);
            try {
              const { resolveKeywordId: resolveKeywordId2 } = await Promise.resolve().then(() => (init_entityIdResolver(), entityIdResolver_exports));
              const resolved = await resolveKeywordId2(targetId);
              if (resolved && resolved.amazonId) {
                kw.keywordId = resolved.amazonId;
                log212.info(`[applyBidAdjustment] \u2705 v429 entityIdResolver\u89E3\u6790\u6210\u529F: keyword id=${targetId} -> keywordId=${resolved.amazonId}`);
              }
            } catch (_) {
            }
            if (!kw.keywordId) {
              try {
                const { resolveKeywordIdOnDemand: resolveKeywordIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
                const [ag] = await db.select().from(adGroups).where(eq(adGroups.id, Number(kw.internalAdGroupId))).limit(1);
                if (ag) {
                  const [camp] = await db.select().from(campaigns).where(eq(campaigns.campaignId, ag.campaignId)).limit(1);
                  if (camp) {
                    const resolvedId = await resolveKeywordIdOnDemand2(camp.accountId, targetId);
                    if (resolvedId) {
                      kw.keywordId = resolvedId;
                      log212.info(`[applyBidAdjustment] \u2705 v429 amazonIdResolver\u56DE\u586B\u6210\u529F: keyword id=${targetId} -> keywordId=${resolvedId}`);
                    }
                  }
                }
              } catch (resolveErr) {
                log212.warn(`[applyBidAdjustment] \u5373\u65F6\u56DE\u586B\u5F02\u5E38: ${resolveErr.message}`);
              }
            }
            if (!kw.keywordId) {
              log212.warn(`[applyBidAdjustment] keyword id=${targetId} ("${kw.keywordText}") \u7F3A\u5C11Amazon keywordId\uFF0C\u65E0\u6CD5\u540C\u6B65\u5230Amazon`);
              const err = new Error(`MISSING_AMAZON_ID: keyword id=${targetId} \u7F3A\u5C11Amazon keywordId`);
              throw err;
            }
          }
          amazonId = kw.keywordId;
          oldBid = parseFloat(kw.bid);
          targetName = kw.keywordText;
          adGroupId = Number(kw.internalAdGroupId) || null;
          const { safeCampaignIdForInsert: safeCampaignIdForInsert2 } = await Promise.resolve().then(() => (init_campaignIdResolver(), campaignIdResolver_exports));
          resolvedCampaignId = await safeCampaignIdForInsert2({
            campaignId,
            targetLocalId: targetId,
            targetType: "keyword",
            adGroupId: Number(kw.internalAdGroupId) || null,
            // v357: adGroupId现在是string类型
            caller: "applyBidAdjustment:keyword"
          });
          if (!amazonId || amazonId.trim() === "" || amazonId === "0") {
            log212.warn(`[applyBidAdjustment] keyword id=${targetId} \u7684Amazon keywordId\u65E0\u6548: "${amazonId}"`);
            return false;
          }
          log212.debug(`[applyBidAdjustment] \u8C03\u7528Amazon API: keywordId="${amazonId}", bid=${Number(newBid.toFixed(2))}`);
          const apiResult = await this.client.updateKeywordBids([{
            keywordId: amazonId,
            // @ts-ignore
            bid: Number(newBid.toFixed(2))
          }]);
          var _apiResponseId = apiResult.requestIds?.[0] || "";
        } else {
          const [pt] = await db.select().from(productTargets).where(eq(productTargets.id, targetId)).limit(1);
          if (!pt) {
            log212.warn(`[applyBidAdjustment] product_target id=${targetId} \u4E0D\u5B58\u5728`);
            return false;
          }
          if (!pt.targetId) {
            log212.debug(`[applyBidAdjustment] product_target id=${targetId} ("${pt.targetValue}") \u7F3A\u5C11targetId\uFF0C\u5C1D\u8BD5\u89E3\u6790...`);
            try {
              const { resolveProductTargetId: resolveProductTargetId2 } = await Promise.resolve().then(() => (init_entityIdResolver(), entityIdResolver_exports));
              const resolved = await resolveProductTargetId2(targetId);
              if (resolved && resolved.amazonId) {
                pt.targetId = resolved.amazonId;
                log212.info(`[applyBidAdjustment] \u2705 v429 entityIdResolver\u89E3\u6790\u6210\u529F: product_target id=${targetId} -> targetId=${resolved.amazonId}`);
              }
            } catch (_) {
            }
            if (!pt.targetId) {
              try {
                const { resolveProductTargetIdOnDemand: resolveProductTargetIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
                const [ag] = await db.select().from(adGroups).where(eq(adGroups.id, Number(pt.internalAdGroupId))).limit(1);
                if (ag) {
                  const [camp] = await db.select().from(campaigns).where(eq(campaigns.campaignId, ag.campaignId)).limit(1);
                  if (camp) {
                    const resolvedId = await resolveProductTargetIdOnDemand2(camp.accountId, targetId);
                    if (resolvedId) {
                      pt.targetId = resolvedId;
                      log212.info(`[applyBidAdjustment] \u2705 v429 amazonIdResolver\u56DE\u586B\u6210\u529F: product_target id=${targetId} -> targetId=${resolvedId}`);
                    }
                  }
                }
              } catch (resolveErr) {
                log212.warn(`[applyBidAdjustment] \u5373\u65F6\u56DE\u586B\u5F02\u5E38: ${resolveErr.message}`);
              }
            }
            if (!pt.targetId) {
              log212.warn(`[applyBidAdjustment] product_target id=${targetId} ("${pt.targetValue}") \u7F3A\u5C11Amazon targetId\uFF0C\u65E0\u6CD5\u540C\u6B65\u5230Amazon`);
              const err = new Error(`MISSING_AMAZON_ID: product_target id=${targetId} \u7F3A\u5C11Amazon targetId`);
              throw err;
            }
          }
          amazonId = pt.targetId;
          oldBid = parseFloat(pt.bid);
          targetName = pt.targetValue || "Product Target";
          adGroupId = Number(pt.internalAdGroupId) || null;
          const { safeCampaignIdForInsert: safeCampaignIdForInsert2 } = await Promise.resolve().then(() => (init_campaignIdResolver(), campaignIdResolver_exports));
          resolvedCampaignId = await safeCampaignIdForInsert2({
            campaignId,
            targetLocalId: targetId,
            targetType: "product_target",
            adGroupId: Number(pt.internalAdGroupId) || null,
            // v357: adGroupId现在是string类型
            caller: "applyBidAdjustment:product_target"
          });
          if (!amazonId || amazonId.trim() === "" || amazonId === "0") {
            log212.warn(`[applyBidAdjustment] product_target id=${targetId} \u7684Amazon targetId\u65E0\u6548: "${amazonId}"`);
            return false;
          }
          log212.debug(`[applyBidAdjustment] \u8C03\u7528Amazon API: targetId="${amazonId}", bid=${Number(newBid.toFixed(2))}`);
          const ptApiResult = await this.client.updateProductTargetBids([{
            targetId: amazonId,
            bid: Number(newBid.toFixed(2))
          }]);
          var _apiResponseId = ptApiResult.requestIds?.[0] || "";
        }
        const bidChangePercent = oldBid > 0 ? (newBid - oldBid) / oldBid * 100 : 0;
        const actionType = newBid > oldBid ? "increase" : newBid < oldBid ? "decrease" : "set";
        log212.info(`[applyBidAdjustment] \u2705 Amazon API\u8C03\u7528\u6210\u529F: ${targetType} id=${targetId}, ${oldBid} -> ${newBid}${_apiResponseId ? `, requestId=${_apiResponseId}` : ""}`);
        try {
          await db.insert(biddingLogs).values({
            accountId: this.accountId,
            campaignId: resolvedCampaignId,
            internalAdGroupId: adGroupId,
            // v418: ID体系重构
            logTargetType: targetType === "keyword" ? "keyword" : "product_target",
            targetId,
            targetName,
            actionType,
            previousBid: String(oldBid),
            newBid: String(newBid),
            bidChangePercent: String(bidChangePercent),
            reason,
            algorithmVersion: "v1.0",
            // v334: 记录使用的具体算法
            algorithmUsed: algorithmUsed || null,
            isIntradayAdjustment: 0,
            executionStatus: "success",
            // v333: 记录Amazon API的requestId用于端到端追踪
            apiResponseId: _apiResponseId || null,
            createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          });
        } catch (logError) {
          log212.warn(`[applyBidAdjustment] \u26A0\uFE0F \u65E5\u5FD7\u8BB0\u5F55\u5931\u8D25\uFF08API\u5DF2\u6210\u529F\uFF09: ${logError.message}`);
          try {
            const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
            const logTargetType = targetType === "keyword" ? "keyword" : "product_target";
            await db.execute(sql`INSERT INTO bidding_logs (accountId, campaignId, internal_ad_group_id, logTargetType, targetId, targetName, actionType, previousBid, newBid, bidChangePercent, reason, algorithmVersion, isIntradayAdjustment, execution_status, createdAt) VALUES (${this.accountId}, ${resolvedCampaignId}, ${adGroupId}, ${logTargetType}, ${targetId}, ${targetName}, ${actionType}, ${String(oldBid)}, ${String(newBid)}, ${String(bidChangePercent)}, ${reason}, ${"v1.0"}, ${0}, ${"success"}, ${now})`);
            log212.info(`[applyBidAdjustment] \u2705 \u65E5\u5FD7\u901A\u8FC7\u539F\u751FSQL\u63D2\u5165\u6210\u529F`);
          } catch (rawSqlError) {
            log212.warn(`[applyBidAdjustment] \u26A0\uFE0F \u539F\u751FSQL\u65E5\u5FD7\u4E5F\u5931\u8D25: ${rawSqlError.message}`);
          }
        }
        return { success: true, apiResponseId: _apiResponseId || void 0 };
      } catch (error48) {
        const errorDetail = error48.response?.data ? JSON.stringify(error48.response.data) : error48.message;
        log212.warn(`[applyBidAdjustment] \u2757 ${targetType} id=${targetId} \u51FA\u4EF7\u8C03\u6574\u5931\u8D25:`, errorDetail);
        log212.warn(`[applyBidAdjustment] \u8BE6\u7EC6\u4FE1\u606F: newBid=${newBid}, campaignId=${campaignId}, HTTP\u72B6\u6001=${error48.response?.status || "N/A"}`);
        const isInvalidId = (
          // @ts-expect-error - Axios error response access
          error48.response?.status === 404 || errorDetail.includes("INVALID_ARGUMENT") || errorDetail.includes("NOT_FOUND") || errorDetail.includes("RESOURCE_NOT_FOUND") || errorDetail.includes("EntityNotFound") || errorDetail.includes("does not exist")
        );
        if (isInvalidId && amazonId) {
          log212.warn(`[applyBidAdjustment] v310-fix: ${targetType} id=${targetId} \u7684Amazon ID "${amazonId}" \u5DF2\u5931\u6548\uFF0C\u6E05\u7A7A\u4EE5\u9632\u6B62\u540E\u7EED\u91CD\u590D\u5931\u8D25`);
          try {
            const dbInstance = await getDb();
            if (dbInstance) {
              const { sql: sqlTag } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
              if (targetType === "keyword") {
                await dbInstance.execute(sqlTag`UPDATE keywords SET keywordId = NULL WHERE id = ${targetId}`);
              } else {
                await dbInstance.execute(sqlTag`UPDATE product_targets SET targetId = NULL WHERE id = ${targetId}`);
              }
              log212.info(`[applyBidAdjustment] v310-fix: \u5DF2\u6E05\u7A7A${targetType} id=${targetId}\u7684Amazon ID\uFF0C\u5C06\u901A\u8FC7\u5373\u65F6\u56DE\u586B\u673A\u5236\u91CD\u65B0\u83B7\u53D6`);
            }
          } catch (clearErr) {
            log212.warn(`[applyBidAdjustment] v310-fix: \u6E05\u7A7AAmazon ID\u5931\u8D25: ${clearErr.message}`);
          }
        }
        try {
          const bidChangePercent = oldBid > 0 ? (newBid - oldBid) / oldBid * 100 : 0;
          const actionType = newBid > oldBid ? "increase" : newBid < oldBid ? "decrease" : "set";
          const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
          const logTargetType = targetType === "keyword" ? "keyword" : "product_target";
          const errMsg = errorDetail.substring(0, 500);
          await db.execute(sql`INSERT INTO bidding_logs (accountId, campaignId, internal_ad_group_id, logTargetType, targetId, targetName, actionType, previousBid, newBid, bidChangePercent, reason, algorithmVersion, isIntradayAdjustment, execution_status, error_message, createdAt) VALUES (${this.accountId}, ${resolvedCampaignId}, ${adGroupId}, ${logTargetType}, ${targetId}, ${targetName || ""}, ${actionType}, ${String(oldBid)}, ${String(newBid)}, ${String(bidChangePercent)}, ${reason}, ${"v1.0"}, ${0}, ${"failed"}, ${errMsg}, ${now})`);
        } catch (logErr) {
          log212.warn(`[applyBidAdjustment] \u26A0\uFE0F \u5931\u8D25\u65E5\u5FD7\u8BB0\u5F55\u4E5F\u5931\u8D25: ${logErr.message}`);
        }
        return false;
      }
    };
    AmazonSyncService.prototype.applyBatchBidAdjustments = async function(adjustments) {
      const results = { success: 0, failed: 0 };
      for (const adj of adjustments) {
        const success2 = await this.applyBidAdjustment(
          adj.targetType,
          adj.targetId,
          adj.newBid,
          adj.reason,
          adj.campaignId
        );
        if (success2) {
          results.success++;
        } else {
          results.failed++;
        }
      }
      return results;
    };
    AmazonSyncService.prototype.getPlacementMultiplier = function(campaign, placement) {
      const c = campaign;
      if (c.dynamicBidding?.placementBidding?.length > 0) {
        const placementMap = {
          "placementTop": "PLACEMENT_TOP",
          "placementProductPage": "PLACEMENT_PRODUCT_PAGE",
          "placementRestOfSearch": "PLACEMENT_REST_OF_SEARCH"
        };
        const v3Placement = placementMap[placement] || placement;
        const adjustment2 = c.dynamicBidding.placementBidding.find(
          // @ts-ignore
          (a) => a.placement === v3Placement
        );
        return adjustment2 ? Number(adjustment2.percentage) : 0;
      }
      const adjustment = campaign.bidding?.adjustments?.find(
        (a) => a.predicate === placement
      );
      return adjustment ? Number(adjustment.percentage) : 0;
    };
  }
});

