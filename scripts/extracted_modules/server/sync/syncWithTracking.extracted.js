// Extracted from production dist/index.js
// Original module: server/sync/syncWithTracking.ts
// Lines: 919

var log166;
var init_syncWithTracking = __esm({
  "server/sync/syncWithTracking.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_logger();
    init_amazonSyncService();
    init_syncHelpers();
    init_db2();
    log166 = createModuleLogger("SyncTracking");
    AmazonSyncService.prototype.syncSpCampaignsWithTracking = async function(lastSyncTime, syncJobId) {
      log166.info("[\u540C\u6B65WithTracking] ========== \u5F00\u59CB\u540C\u6B65SP\u5E7F\u544A\u6D3B\u52A8(\u5E26\u8DDF\u8E2A) ==========");
      log166.info("[\u540C\u6B65WithTracking] \u53C2\u6570:", { accountId: this.accountId, lastSyncTime, syncJobId });
      const db = await getDb();
      if (!db) {
        log166.warn("[\u540C\u6B65WithTracking] \u274C \u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
        return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };
      }
      log166.info("[\u540C\u6B65WithTracking] \u2705 \u6570\u636E\u5E93\u8FDE\u63A5\u6210\u529F");
      const result = {
        synced: 0,
        skipped: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0
      };
      const changeRecords = [];
      const conflictRecords = [];
      try {
        log166.info("[\u540C\u6B65WithTracking] \u6B63\u5728\u8C03\u7528Amazon API: listSpCampaigns()...");
        const apiCampaigns = await this.client.listSpCampaigns();
        log166.info(`[\u540C\u6B65WithTracking] \u2705 API\u8C03\u7528\u6210\u529F,\u8FD4\u56DE ${apiCampaigns.length} \u4E2ASP\u5E7F\u544A\u6D3B\u52A8`);
        if (apiCampaigns.length === 0) {
          log166.warn("[\u540C\u6B65WithTracking] \u26A0\uFE0F API\u8FD4\u56DE\u7A7A\u6570\u7EC4 - \u6CA1\u6709SP\u5E7F\u544A\u6D3B\u52A8");
          return result;
        }
        const allExCampaignIds = [];
        for (const ac of apiCampaigns) {
          const [ex] = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.accountId, this.accountId), eq(campaigns.campaignId, String(ac.campaignId)))).limit(1);
          if (ex) allExCampaignIds.push(ex.id);
        }
        const protectedCampaignIds = await getRecentlyOptimizedCampaignIds(allExCampaignIds, SYNC_PROTECTION_CONFIG.BUDGET_PROTECTION_HOURS);
        const protectionStats = createSyncProtectionStats();
        log166.info(`syncSpCampaignsWithTracking: \u6279\u91CF\u67E5\u8BE2\u5B8C\u6210, ${protectedCampaignIds.size}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u6709\u8FD1\u671F\u9884\u7B97\u4F18\u5316\u4E8B\u4EF6`);
        for (const apiCampaign of apiCampaigns) {
          const [existing] = await db.select().from(campaigns).where(
            and(
              eq(campaigns.accountId, this.accountId),
              eq(campaigns.campaignId, String(apiCampaign.campaignId))
            )
          ).limit(1);
          const normalizedTargetingType = (apiCampaign.targetingType || "manual").toLowerCase();
          const campaignType = normalizedTargetingType === "auto" ? "sp_auto" : "sp_manual";
          let dailyBudgetValue = 0;
          const budgetFieldT = apiCampaign.budget;
          if (budgetFieldT !== void 0 && budgetFieldT !== null) {
            if (typeof budgetFieldT === "number") {
              dailyBudgetValue = budgetFieldT;
            } else if (typeof budgetFieldT === "object") {
              dailyBudgetValue = budgetFieldT.budget || budgetFieldT.dailyBudget || budgetFieldT.amount || 0;
            }
          }
          if (dailyBudgetValue === 0 && apiCampaign.dailyBudget) {
            dailyBudgetValue = Number(apiCampaign.dailyBudget) || 0;
          }
          if (dailyBudgetValue === 0) {
            log166.warn(`v168: SP\u5E7F\u544A(Tracking) ${apiCampaign.name} budget\u89E3\u6790\u4E3A0, \u539F\u59CBbudget\u5B57\u6BB5:`, JSON.stringify(budgetFieldT));
          }
          const campaignData = {
            accountId: this.accountId,
            campaignId: String(apiCampaign.campaignId),
            campaignName: apiCampaign.name,
            // @ts-ignore
            campaignType,
            // @ts-ignore
            targetingType: normalizedTargetingType,
            // @ts-ignore
            dailyBudget: String(dailyBudgetValue),
            campaignStatus: apiCampaign.state?.toLowerCase() || "enabled",
            // @ts-ignore
            placementTopSearchBidAdjustment: this.getPlacementMultiplier(apiCampaign, "placementTop"),
            // @ts-ignore
            placementProductPageBidAdjustment: this.getPlacementMultiplier(apiCampaign, "placementProductPage"),
            // @ts-ignore
            placementRestBidAdjustment: this.getPlacementMultiplier(apiCampaign, "placementRestOfSearch"),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            const conflictCheck = detectConflict(existing, campaignData, ["dailyBudget", "status"]);
            if (conflictCheck.hasConflict && syncJobId) {
              conflictRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "campaign",
                entityId: String(apiCampaign.campaignId),
                entityName: apiCampaign.name,
                conflictType: "data_mismatch",
                localData: existing,
                remoteData: campaignData,
                conflictFields: conflictCheck.conflictFields
              });
              result.conflicts++;
            }
            if (syncJobId) {
              changeRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                // @ts-ignore
                entityType: "campaign",
                changeType: "updated",
                entityId: String(apiCampaign.campaignId),
                entityName: apiCampaign.name,
                previousData: existing,
                newData: campaignData,
                changedFields: Object.keys(campaignData).filter(
                  (k) => (
                    // @ts-ignore
                    existing[k] !== campaignData[k]
                  )
                )
                // @ts-ignore
              });
            }
            const localBudget = parseFloat(existing.dailyBudget || "0");
            const apiBudget = parseFloat(String(campaignData.dailyBudget || "0"));
            if (apiBudget === 0 && localBudget > 0) {
              log166.warn(`v168: \u96F6\u503C\u9884\u7B97\u9632\u62A4(Tracking)\u751F\u6548 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}`);
              delete campaignData.dailyBudget;
            }
            if (Math.abs(localBudget - apiBudget) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBudget > 0) {
              const hasRecentOpt = protectedCampaignIds.has(existing.id);
              if (hasRecentOpt) {
                log166.debug(`v150.1: \u9884\u7B97\u4FDD\u62A4\u751F\u6548(WT) - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}`);
                delete campaignData.dailyBudget;
                protectionStats.budgetProtected++;
                protectionStats.protectedEntities.push(`camp:${existing.campaignName}`);
              } else {
                protectionStats.budgetOverwritten++;
              }
            }
            const localTopPlacement = existing.placementTopSearchBidAdjustment || 0;
            const apiTopPlacement = campaignData.placementTopSearchBidAdjustment || 0;
            const localProductPlacement = existing.placementProductPageBidAdjustment || 0;
            const apiProductPlacement = campaignData.placementProductPageBidAdjustment || 0;
            const localRestPlacement = existing.placementRestBidAdjustment || 0;
            const apiRestPlacement = campaignData.placementRestBidAdjustment || 0;
            const hasPlacementDiff = localTopPlacement !== apiTopPlacement || localProductPlacement !== apiProductPlacement || localRestPlacement !== apiRestPlacement;
            if (hasPlacementDiff && protectedCampaignIds.has(existing.id)) {
              log166.debug(`v165: \u4F4D\u7F6E\u503E\u659C\u4FDD\u62A4\u751F\u6548 - campaign=${existing.campaignName}, localTop=${localTopPlacement}%, apiTop=${apiTopPlacement}%, localProduct=${localProductPlacement}%, apiProduct=${apiProductPlacement}%, localRest=${localRestPlacement}%, apiRest=${apiRestPlacement}%`);
              delete campaignData.placementTopSearchBidAdjustment;
              delete campaignData.placementProductPageBidAdjustment;
              delete campaignData.placementRestBidAdjustment;
              protectionStats.protectedEntities.push(`placement:${existing.campaignName}`);
            }
            await db.update(campaigns).set(campaignData).where(eq(campaigns.id, existing.id));
            result.updated++;
          } else {
            if (syncJobId) {
              changeRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "campaign",
                changeType: "created",
                entityId: String(apiCampaign.campaignId),
                entityName: apiCampaign.name,
                newData: campaignData
              });
            }
            await db.insert(campaigns).values({
              ...campaignData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
            result.created++;
          }
          result.synced++;
        }
        if (changeRecords.length > 0) {
          await createSyncChangeRecordsBatch(changeRecords);
        }
        if (conflictRecords.length > 0) {
          await createSyncConflictsBatch(conflictRecords);
        }
        log166.info("[\u540C\u6B65WithTracking] ========== SP\u5E7F\u544A\u6D3B\u52A8\u540C\u6B65\u5B8C\u6210 ==========");
        log166.info("[\u540C\u6B65WithTracking] \u7ED3\u679C:", result);
        logSyncProtectionSummary("syncSpCampaignsWithTracking", protectionStats);
        return result;
      } catch (error48) {
        log166.warn("[\u540C\u6B65WithTracking] \u274C SP\u5E7F\u544A\u6D3B\u52A8\u540C\u6B65\u5931\u8D25");
        log166.warn("[\u540C\u6B65WithTracking] \u9519\u8BEF\u7C7B\u578B:", error48.constructor?.name);
        log166.warn("[\u540C\u6B65WithTracking] \u9519\u8BEF\u6D88\u606F:", error48?.message || error48);
        log166.warn("[\u540C\u6B65WithTracking] \u9519\u8BEF\u5806\u6808:", error48?.stack);
        if (error48?.response) {
          log166.warn("[\u540C\u6B65WithTracking] API\u54CD\u5E94\u72B6\u6001:", error48.response.status);
          log166.warn("[\u540C\u6B65WithTracking] API\u54CD\u5E94\u6570\u636E:", JSON.stringify(error48.response.data, null, 2));
        }
        return result;
      }
    };
    AmazonSyncService.prototype.syncSbCampaignsWithTracking = async function(lastSyncTime, syncJobId) {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };
      const result = {
        synced: 0,
        skipped: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0
      };
      const changeRecords = [];
      const conflictRecords = [];
      try {
        const apiCampaigns = await this.client.listSbCampaigns();
        for (const apiCampaign of apiCampaigns) {
          try { // P3v12: per-campaign try-catch
          const [existing] = await db.select().from(campaigns).where(
            and(
              eq(campaigns.accountId, this.accountId),
              eq(campaigns.campaignId, String(apiCampaign.campaignId))
            )
          ).limit(1);
          const sbGoal = apiCampaign.goal || apiCampaign.campaignGoal || "";
          let sbCostType = "cpc";
          if (sbGoal === "GROW_BRAND_IMPRESSION_SHARE" || sbGoal === "growBrandImpressionShare") {
            sbCostType = "vcpm";
          }
          if (apiCampaign.costType) {
            const apiCostType = String(apiCampaign.costType).toLowerCase();
            if (apiCostType === "vcpm" || apiCostType === "cpm") {
              sbCostType = apiCostType;
            }
          }
          const sbAdFormat = apiCampaign.adFormat || apiCampaign.creative?.adFormat || null;
          const validAdFormats = ["productCollection", "video", "storeSpotlight", "brandVideo"];
          const normalizedAdFormat = validAdFormats.includes(sbAdFormat) ? sbAdFormat : null;
          const campaignData = {
            accountId: this.accountId,
            campaignId: String(apiCampaign.campaignId),
            campaignName: apiCampaign.name,
            campaignType: "sb",
            targetingType: "manual",
            // @ts-ignore
            dailyBudget: String(apiCampaign.budget?.budget || apiCampaign.budget || 0),
            // @ts-ignore
            campaignStatus: (apiCampaign.state || "enabled").toLowerCase(),
            // @ts-ignore
            state: (apiCampaign.state || "enabled").toLowerCase(),
            costType: sbCostType,
            // ✅ 根据Goal动态设置
            campaignGoal: sbGoal || null,
            // ✅ 存储原始Goal值
            adFormat: normalizedAdFormat,
            // ✅ 存储广告格式
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            const conflictCheck = detectConflict(existing, campaignData, ["dailyBudget", "status"]);
            if (conflictCheck.hasConflict && syncJobId) {
              conflictRecords.push({
                syncJobId,
                // @ts-ignore
                accountId: this.accountId,
                userId: this.userId,
                entityType: "campaign",
                entityId: String(apiCampaign.campaignId),
                // @ts-ignore
                entityName: apiCampaign.name,
                conflictType: "data_mismatch",
                localData: existing,
                remoteData: campaignData,
                conflictFields: conflictCheck.conflictFields
              });
              result.conflicts++;
            }
            if (syncJobId) {
              changeRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "campaign",
                changeType: "updated",
                entityId: String(apiCampaign.campaignId),
                // @ts-ignore
                entityName: apiCampaign.name,
                previousData: existing,
                newData: campaignData,
                changedFields: Object.keys(campaignData).filter(
                  (k) => (
                    // @ts-ignore
                    existing[k] !== campaignData[k]
                  )
                )
              });
            }
            await db.update(campaigns).set(campaignData).where(eq(campaigns.id, existing.id));
            result.updated++;
          } else {
            if (syncJobId) {
              changeRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "campaign",
                changeType: "created",
                entityId: String(apiCampaign.campaignId),
                // @ts-ignore
                entityName: apiCampaign.name,
                newData: campaignData
              });
            }
            await db.insert(campaigns).values({
              ...campaignData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
            result.created++;
          }
          result.synced++;
          } catch (_sbWtErr) {
            const _isLockTimeout2 = (_sbWtErr.cause?.message || _sbWtErr.message || '').includes('Lock wait timeout');
            if (_isLockTimeout2) {
              log166.warn(`P3v12: SB-WT campaign ${apiCampaign.campaignId} lock timeout, retrying in 2s...`);
              await new Promise(r => setTimeout(r, 2000));
              try {
                const [existing2] = await db.select().from(campaigns).where(and(eq(campaigns.accountId, this.accountId), eq(campaigns.campaignId, String(apiCampaign.campaignId)))).limit(1);
                const retryData = { accountId: this.accountId, campaignId: String(apiCampaign.campaignId), campaignName: apiCampaign.name || '', campaignType: 'sb', targetingType: 'manual', campaignStatus: (apiCampaign.state || 'enabled').toLowerCase(), state: (apiCampaign.state || 'enabled').toLowerCase(), updatedAt: (new Date()).toISOString().slice(0, 19).replace('T', ' ') };
                Object.keys(retryData).forEach(function(_k2){ if(retryData[_k2] === undefined) delete retryData[_k2]; });
                if (existing2) { await db.update(campaigns).set(retryData).where(eq(campaigns.id, existing2.id)); } else { await db.insert(campaigns).values({ ...retryData, createdAt: (new Date()).toISOString().slice(0, 19).replace('T', ' ') }); }
                result.synced++;
                log166.info(`P3v12: SB-WT campaign ${apiCampaign.campaignId} retry succeeded`);
              } catch (_retryErr2) { log166.warn(`P3v12: SB-WT campaign ${apiCampaign.campaignId} retry failed: ${_retryErr2.cause?.message || _retryErr2.message}`); }
            } else {
              log166.warn(`P3v12: SB-WT campaign ${apiCampaign.campaignId} FAIL: ${_sbWtErr.cause?.message || _sbWtErr.message}`);
            }
          }
        }
        if (changeRecords.length > 0) {
          await createSyncChangeRecordsBatch(changeRecords);
        }
        if (conflictRecords.length > 0) {
          await createSyncConflictsBatch(conflictRecords);
        }
        return result;
      } catch (error48) {
        log166.warn("Error syncing SB campaigns with tracking:", error48);
        return result;
      }
    };
    AmazonSyncService.prototype.syncSdCampaignsWithTracking = async function(lastSyncTime, syncJobId) {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };
      const result = {
        synced: 0,
        skipped: 0,
        // @ts-ignore
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0
      };
      const changeRecords = [];
      const conflictRecords = [];
      try {
        const apiCampaigns = await this.client.listSdCampaigns();
        for (const apiCampaign of apiCampaigns) {
          const [existing] = await db.select().from(campaigns).where(
            and(
              eq(campaigns.accountId, this.accountId),
              eq(campaigns.campaignId, String(apiCampaign.campaignId))
            )
          ).limit(1);
          const sdCostType = (apiCampaign.costType || "cpc").toLowerCase();
          const validCostTypes = ["cpc", "vcpm", "cpm"];
          const normalizedCostType = validCostTypes.includes(sdCostType) ? sdCostType : "cpc";
          const sdGoal = apiCampaign.goal || apiCampaign.optimizationGoal || apiCampaign.bidOptimization || "";
          const sdTactic = apiCampaign.tactic || null;
          const sdBidOptimization = apiCampaign.bidOptimization || null;
          const validBidOpts = ["reach", "pageVisits", "conversions"];
          const normalizedBidOpt = validBidOpts.includes(sdBidOptimization) ? sdBidOptimization : null;
          const campaignData = {
            accountId: this.accountId,
            campaignId: String(apiCampaign.campaignId),
            campaignName: apiCampaign.name,
            campaignType: "sd",
            targetingType: "manual",
            // @ts-ignore
            dailyBudget: String(apiCampaign.budget?.budget || apiCampaign.budget || 0),
            // @ts-ignore
            campaignStatus: (apiCampaign.state || "enabled").toLowerCase(),
            // @ts-ignore
            state: (apiCampaign.state || "enabled").toLowerCase(),
            // @ts-ignore
            costType: normalizedCostType,
            // ✅ 从API获取
            campaignGoal: sdGoal || null,
            // ✅ 存储SD广告目标
            bidOptimization: normalizedBidOpt,
            // ✅ 存储竞价优化目标
            tactic: sdTactic,
            // ✅ 存储定向策略
            // @ts-ignore
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          Object.keys(campaignData).forEach(function(_k){ if(campaignData[_k] === undefined) delete campaignData[_k]; }); // P3v11: filter undefined
          try { // P3v8: per-campaign try-catch
          if (existing) {
            const conflictCheck = detectConflict(existing, campaignData, ["dailyBudget", "status"]);
            if (conflictCheck.hasConflict && syncJobId) {
              conflictRecords.push({
                // @ts-ignore
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "campaign",
                entityId: String(apiCampaign.campaignId),
                // @ts-ignore
                entityName: apiCampaign.name,
                conflictType: "data_mismatch",
                localData: existing,
                remoteData: campaignData,
                conflictFields: conflictCheck.conflictFields
              });
              result.conflicts++;
            }
            if (syncJobId) {
              changeRecords.push({
                // @ts-ignore
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "campaign",
                changeType: "updated",
                entityId: String(apiCampaign.campaignId),
                // @ts-ignore
                entityName: apiCampaign.name,
                previousData: existing,
                newData: campaignData,
                changedFields: Object.keys(campaignData).filter(
                  (k) => (
                    // @ts-ignore
                    existing[k] !== campaignData[k]
                  )
                )
              });
            }
            await db.update(campaigns).set(campaignData).where(eq(campaigns.id, existing.id));
            result.updated++;
          } else {
            if (syncJobId) {
              changeRecords.push({
                // @ts-ignore
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "campaign",
                changeType: "created",
                entityId: String(apiCampaign.campaignId),
                // @ts-ignore
                entityName: apiCampaign.name,
                newData: campaignData
              });
            }
            await db.insert(campaigns).values({
              ...campaignData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
            result.created++;
          }
          result.synced++;
          } catch (_sdCampErr) {
            const _isLockTimeout3 = (_sdCampErr.cause?.message || _sdCampErr.message || '').includes('Lock wait timeout');
            if (_isLockTimeout3) {
              log210.warn(`P3v12: SD campaign ${apiCampaign.campaignId} lock timeout, retrying in 2s...`);
              await new Promise(r => setTimeout(r, 2000));
              try {
                const [existing3] = await db.select().from(campaigns).where(and(eq(campaigns.accountId, this.accountId), eq(campaigns.campaignId, String(apiCampaign.campaignId)))).limit(1);
                const retryData3 = { accountId: this.accountId, campaignId: String(apiCampaign.campaignId), campaignName: apiCampaign.name || '', campaignType: 'sd', targetingType: 'manual', campaignStatus: (apiCampaign.state || 'enabled').toLowerCase(), state: (apiCampaign.state || 'enabled').toLowerCase(), updatedAt: (new Date()).toISOString().slice(0, 19).replace('T', ' ') };
                Object.keys(retryData3).forEach(function(_k3){ if(retryData3[_k3] === undefined) delete retryData3[_k3]; });
                if (existing3) { await db.update(campaigns).set(retryData3).where(eq(campaigns.id, existing3.id)); } else { await db.insert(campaigns).values({ ...retryData3, createdAt: (new Date()).toISOString().slice(0, 19).replace('T', ' ') }); }
                result.synced++;
                log210.info(`P3v12: SD campaign ${apiCampaign.campaignId} retry succeeded`);
              } catch (_retryErr3) { log210.warn(`P3v12: SD campaign ${apiCampaign.campaignId} retry failed: ${_retryErr3.cause?.message || _retryErr3.message}`); }
            } else {
              log210.warn(`P3v12: SD campaign ${apiCampaign.campaignId} FAIL: ${_sdCampErr.cause?.message || _sdCampErr.message}`);
            }
          }
        }
        if (changeRecords.length > 0) {
          await createSyncChangeRecordsBatch(changeRecords);
        }
        if (conflictRecords.length > 0) {
          await createSyncConflictsBatch(conflictRecords);
        }
        return result;
      } catch (error48) {
        log166.warn("Error syncing SD campaigns with tracking:", error48);
        return result;
      }
    };
    AmazonSyncService.prototype.syncSpAdGroupsWithTracking = async function(lastSyncTime, syncJobId) {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };
      const result = {
        synced: 0,
        skipped: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0
      };
      const changeRecords = [];
      const conflictRecords = [];
      try {
        const apiAdGroups = await this.client.listSpAdGroups();
        for (const apiAdGroup of apiAdGroups) {
          const [campaign] = await db.select().from(campaigns).where(
            and(
              eq(campaigns.accountId, this.accountId),
              eq(campaigns.campaignId, String(apiAdGroup.campaignId))
            )
          ).limit(1);
          if (!campaign) {
            result.skipped++;
            continue;
          }
          const [existing] = await db.select().from(adGroups).where(
            and(
              eq(adGroups.campaignId, String(campaign.campaignId)),
              eq(adGroups.adGroupId, String(apiAdGroup.adGroupId))
            )
          ).limit(1);
          const normalizedState = (apiAdGroup.state || "enabled").toLowerCase();
          const adGroupData = {
            campaignId: campaign.campaignId,
            accountId: this.accountId,
            adGroupId: String(apiAdGroup.adGroupId),
            adGroupName: apiAdGroup.name,
            defaultBid: String(apiAdGroup.defaultBid || 0),
            adGroupStatus: normalizedState,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            const conflictCheck = detectConflict(existing, adGroupData, ["defaultBid", "adGroupStatus"]);
            if (conflictCheck.hasConflict && syncJobId) {
              conflictRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "ad_group",
                entityId: String(apiAdGroup.adGroupId),
                entityName: apiAdGroup.name,
                conflictType: "data_mismatch",
                localData: existing,
                remoteData: adGroupData,
                conflictFields: conflictCheck.conflictFields
              });
              result.conflicts++;
            }
            if (syncJobId) {
              changeRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "ad_group",
                changeType: "updated",
                entityId: String(apiAdGroup.adGroupId),
                entityName: apiAdGroup.name,
                previousData: existing,
                newData: adGroupData,
                changedFields: Object.keys(adGroupData).filter(
                  (k) => (
                    // @ts-ignore
                    existing[k] !== adGroupData[k]
                  )
                )
              });
            }
            await db.update(adGroups).set(adGroupData).where(eq(adGroups.id, existing.id));
            result.updated++;
          } else {
            if (syncJobId) {
              changeRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "ad_group",
                changeType: "created",
                entityId: String(apiAdGroup.adGroupId),
                entityName: apiAdGroup.name,
                newData: adGroupData
              });
            }
            await db.insert(adGroups).values({
              ...adGroupData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
            result.created++;
          }
          result.synced++;
        }
        if (changeRecords.length > 0) {
          await createSyncChangeRecordsBatch(changeRecords);
        }
        if (conflictRecords.length > 0) {
          await createSyncConflictsBatch(conflictRecords);
        }
        return result;
      } catch (error48) {
        log166.warn("Error syncing SP ad groups with tracking:", error48);
        return result;
      }
    };
    AmazonSyncService.prototype.syncSpKeywordsWithTracking = async function(lastSyncTime, syncJobId) {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };
      const result = {
        synced: 0,
        skipped: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0
      };
      const changeRecords = [];
      const conflictRecords = [];
      try {
        const apiKeywords = await this.client.listSpKeywords();
        const allExKwIds = [];
        for (const ak of apiKeywords) {
          const [ag] = await db.select({ id: adGroups.id }).from(adGroups).where(eq(adGroups.adGroupId, String(ak.internal_ad_group_id))).limit(1);
          if (!ag) continue;
          const [ex] = await db.select({ id: keywords.id }).from(keywords).where(and(eq(keywords.internalAdGroupId, ag.id), eq(keywords.keywordId, String(ak.keywordId)))).limit(1);
          if (ex) allExKwIds.push(ex.id);
        }
        const protectedKeywordIds = await getRecentlyOptimizedKeywordIds(allExKwIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
        const protectionStats = createSyncProtectionStats();
        log166.info(`syncSpKeywordsWithTracking: \u6279\u91CF\u67E5\u8BE2\u5B8C\u6210, ${protectedKeywordIds.size}\u4E2A\u5173\u952E\u8BCD\u6709\u8FD1\u671F\u51FA\u4EF7\u4F18\u5316\u4E8B\u4EF6`);
        for (const apiKeyword of apiKeywords) {
          const [adGroup] = await db.select().from(adGroups).where(eq(adGroups.adGroupId, String(apiKeyword.adGroupId))).limit(1);
          if (!adGroup) {
            result.skipped++;
            continue;
          }
          const [existing] = await db.select().from(keywords).where(
            and(
              eq(keywords.internalAdGroupId, adGroup.id),
              // v420: 修复 - internalAdGroupId是int类型
              eq(keywords.keywordId, String(apiKeyword.keywordId))
            )
          ).limit(1);
          const normalizedMatchType = (apiKeyword.matchType || "broad").toLowerCase();
          const normalizedState = (apiKeyword.state || "enabled").toLowerCase();
          const keywordData = {
            internalAdGroupId: adGroup.id,
            // v418: ID体系重构
            accountId: this.accountId,
            campaignId: adGroup.campaignId || "",
            // v357
            keywordId: String(apiKeyword.keywordId),
            keywordText: apiKeyword.keywordText,
            matchType: normalizedMatchType,
            bid: String(apiKeyword.bid || 0),
            keywordStatus: normalizedState,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            if (existing.keywordStatus === "amazon_deleted" && normalizedState !== "archived") {
              log166.debug(`v523.2: \u4FDD\u62A4(WT) keyword amazon_deleted\u72B6\u6001 - keyword=${existing.keywordText}(id=${existing.id})`);
              delete keywordData.keywordStatus;
            }
            const conflictCheck = detectConflict(existing, keywordData, ["bid", "keywordStatus"]);
            if (conflictCheck.hasConflict && syncJobId) {
              conflictRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "keyword",
                entityId: String(apiKeyword.keywordId),
                entityName: apiKeyword.keywordText,
                conflictType: "data_mismatch",
                localData: existing,
                remoteData: keywordData,
                conflictFields: conflictCheck.conflictFields
              });
              result.conflicts++;
            }
            if (syncJobId) {
              changeRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "keyword",
                changeType: "updated",
                entityId: String(apiKeyword.keywordId),
                entityName: apiKeyword.keywordText,
                previousData: existing,
                newData: keywordData,
                changedFields: Object.keys(keywordData).filter(
                  (k) => (
                    // @ts-ignore
                    existing[k] !== keywordData[k]
                  )
                )
              });
            }
            const localBid = parseFloat(existing.bid || "0");
            const apiBid = parseFloat(String(apiKeyword.bid || "0"));
            if (Math.abs(localBid - apiBid) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBid > 0) {
              const hasRecentOpt = protectedKeywordIds.has(existing.id);
              if (hasRecentOpt) {
                log166.debug(`v150.1: \u51FA\u4EF7\u4FDD\u62A4\u751F\u6548(WT) - keyword=${existing.keywordText}, local=$${localBid}, api=$${apiBid}`);
                delete keywordData.bid;
                protectionStats.bidProtected++;
                protectionStats.protectedEntities.push(`kw:${existing.keywordText}`);
              } else {
                protectionStats.bidOverwritten++;
              }
            }
            await db.update(keywords).set(keywordData).where(eq(keywords.id, existing.id));
            result.updated++;
          } else {
            if (syncJobId) {
              changeRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "keyword",
                changeType: "created",
                entityId: String(apiKeyword.keywordId),
                entityName: apiKeyword.keywordText,
                newData: keywordData
              });
            }
            await db.insert(keywords).values({
              ...keywordData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            }).onDuplicateKeyUpdate({
              set: {
                bid: sql`VALUES(bid)`,
                keywordStatus: sql`VALUES(keyword_status)`,
                keywordId: sql`VALUES(keyword_id)`,
                updatedAt: sql`NOW()`
              }
            });
            result.created++;
          }
          result.synced++;
        }
        if (changeRecords.length > 0) {
          await createSyncChangeRecordsBatch(changeRecords);
        }
        if (conflictRecords.length > 0) {
          await createSyncConflictsBatch(conflictRecords);
        }
        logSyncProtectionSummary("syncSpKeywordsWithTracking", protectionStats);
        return result;
      } catch (error48) {
        log166.warn("Error syncing SP keywords with tracking:", error48);
        return result;
      }
    };
    AmazonSyncService.prototype.syncSpProductTargetsWithTracking = async function(lastSyncTime, syncJobId) {
      const db = await getDb();
      if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };
      const result = {
        synced: 0,
        skipped: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0
      };
      const changeRecords = [];
      const conflictRecords = [];
      try {
        const apiTargets = await this.client.listSpProductTargets();
        const allExTgtIds = [];
        for (const at of apiTargets) {
          const [ag] = await db.select({ id: adGroups.id }).from(adGroups).where(eq(adGroups.adGroupId, String(at.adGroupId))).limit(1);
          if (!ag) continue;
          const [ex] = await db.select({ id: productTargets.id }).from(productTargets).where(and(eq(productTargets.internalAdGroupId, ag.id), eq(productTargets.targetId, String(at.targetId)))).limit(1);
          if (ex) allExTgtIds.push(ex.id);
        }
        const protectedTargetIds = await getRecentlyOptimizedKeywordIds(allExTgtIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
        const protectionStats = createSyncProtectionStats();
        log166.info(`syncSpProductTargetsWithTracking: \u6279\u91CF\u67E5\u8BE2\u5B8C\u6210, ${protectedTargetIds.size}\u4E2A\u4EA7\u54C1\u5B9A\u5411\u6709\u8FD1\u671F\u51FA\u4EF7\u4F18\u5316\u4E8B\u4EF6`);
        for (const apiTarget of apiTargets) {
          const [adGroup] = await db.select().from(adGroups).where(eq(adGroups.adGroupId, String(apiTarget.adGroupId))).limit(1);
          if (!adGroup) {
            result.skipped++;
            continue;
          }
          const [existing] = await db.select().from(productTargets).where(
            and(
              eq(productTargets.internalAdGroupId, adGroup.id),
              // v420: 修复 - internalAdGroupId是int类型
              eq(productTargets.targetId, String(apiTarget.targetId))
            )
          ).limit(1);
          let targetType = "asin";
          let targetValue = "";
          if (apiTarget.expression && apiTarget.expression.length > 0) {
            const expr = apiTarget.expression[0];
            const rawType = (expr.type || "asin").toLowerCase();
            targetType = rawType.includes("asin") ? "asin" : rawType.includes("category") ? "category" : "asin";
            targetValue = expr.value || "";
          }
          const normalizedState = (apiTarget.state || "enabled").toLowerCase();
          const targetData = {
            internalAdGroupId: adGroup.id,
            // v418: ID体系重构
            campaignId: adGroup.campaignId || "",
            // v357
            targetId: String(apiTarget.targetId),
            targetType,
            targetValue,
            bid: String(apiTarget.bid || 0),
            targetStatus: normalizedState,
            // @ts-ignore
            updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
          };
          if (existing) {
            if (existing.targetStatus === "amazon_deleted" && normalizedState !== "archived") {
              log166.debug(`v523.2: \u4FDD\u62A4(WT) target amazon_deleted\u72B6\u6001 - target=${existing.targetValue}(id=${existing.id})`);
              delete targetData.targetStatus;
            }
            const conflictCheck = detectConflict(existing, targetData, ["bid", "targetStatus"]);
            if (conflictCheck.hasConflict && syncJobId) {
              conflictRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "product_target",
                entityId: String(apiTarget.targetId),
                entityName: targetValue,
                conflictType: "data_mismatch",
                localData: existing,
                remoteData: targetData,
                conflictFields: conflictCheck.conflictFields
              });
              result.conflicts++;
            }
            if (syncJobId) {
              changeRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "product_target",
                // @ts-ignore
                changeType: "updated",
                entityId: String(apiTarget.targetId),
                entityName: targetValue,
                previousData: existing,
                newData: targetData,
                changedFields: Object.keys(targetData).filter(
                  (k) => (
                    // @ts-ignore
                    existing[k] !== targetData[k]
                  )
                )
              });
            }
            const localBid = parseFloat(existing.bid || "0");
            const apiBid = parseFloat(String(apiTarget.bid || "0"));
            if (Math.abs(localBid - apiBid) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBid > 0) {
              const hasRecentOpt = protectedTargetIds.has(existing.id);
              if (hasRecentOpt) {
                log166.debug(`v150.1: \u51FA\u4EF7\u4FDD\u62A4\u751F\u6548(WT) - target=${existing.targetValue}, local=$${localBid}, api=$${apiBid}`);
                delete targetData.bid;
                protectionStats.bidProtected++;
                protectionStats.protectedEntities.push(`tgt:${existing.targetValue}`);
              } else {
                protectionStats.bidOverwritten++;
              }
            }
            await db.update(productTargets).set(targetData).where(eq(productTargets.id, existing.id));
            result.updated++;
          } else {
            if (syncJobId) {
              changeRecords.push({
                syncJobId,
                accountId: this.accountId,
                userId: this.userId,
                entityType: "product_target",
                changeType: "created",
                entityId: String(apiTarget.targetId),
                entityName: targetValue,
                newData: targetData
              });
            }
            await db.insert(productTargets).values({
              ...targetData,
              createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            });
            result.created++;
          }
          result.synced++;
        }
        if (changeRecords.length > 0) {
          await createSyncChangeRecordsBatch(changeRecords);
        }
        if (conflictRecords.length > 0) {
          await createSyncConflictsBatch(conflictRecords);
        }
        logSyncProtectionSummary("syncSpProductTargetsWithTracking", protectionStats);
        return result;
      } catch (error48) {
        log166.warn("Error syncing SP product targets with tracking:", error48);
        return result;
      }
    };
  }
});

