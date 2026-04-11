// Extracted from production dist/index.js
// Original module: server/automation/automationExecutionEngine.ts
// Lines: 1547

function cleanupStaleMemoryData() {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString().split("T")[0];
  let cleanedCount = 0;
  for (const key of dailyExecutionCount.keys()) {
    if (!key.includes(today) && !key.includes(yesterday)) {
      dailyExecutionCount.delete(key);
      cleanedCount++;
    }
  }
  if (executionHistory.length > 100) {
    executionHistory.splice(0, executionHistory.length - 100);
  }
  if (accountConfigs.size > 50) {
    const keys = Array.from(accountConfigs.keys());
    for (let i = 0; i < keys.length - 50; i++) {
      accountConfigs.delete(keys[i]);
    }
  }
  if (cleanedCount > 0) {
    log180.info(`[MemoryCleanup] v230: \u6E05\u7406\u4E86${cleanedCount}\u6761\u8FC7\u671F\u7684dailyExecutionCount\u8BB0\u5F55`);
  }
}
function getAccountAutomationConfig(accountId) {
  if (!accountConfigs.has(accountId)) {
    accountConfigs.set(accountId, {
      accountId,
      ...DEFAULT_AUTOMATION_CONFIG
    });
  }
  return accountConfigs.get(accountId);
}
function updateAccountAutomationConfig(accountId, config2) {
  const current = getAccountAutomationConfig(accountId);
  const updated = {
    ...current,
    ...config2,
    accountId,
    safetyBoundary: {
      ...current.safetyBoundary,
      ...config2.safetyBoundary || {}
    },
    scheduleConfig: {
      ...current.scheduleConfig,
      ...config2.scheduleConfig || {}
    },
    notificationConfig: {
      ...current.notificationConfig,
      ...config2.notificationConfig || {}
    }
  };
  accountConfigs.set(accountId, updated);
  return updated;
}
function checkDailyLimit(accountId, type) {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const key = `${accountId}_${today}_${type}`;
  const count11 = dailyExecutionCount.get(key) || 0;
  const config2 = getAccountAutomationConfig(accountId);
  switch (type) {
    case "bid_adjustment":
      return count11 < config2.safetyBoundary.maxDailyBidAdjustments;
    case "budget_adjustment":
      return count11 < config2.safetyBoundary.maxDailyBudgetAdjustments;
    default:
      return count11 < config2.safetyBoundary.maxDailyTotalAdjustments;
  }
}
function incrementDailyCount(accountId, type) {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const key = `${accountId}_${today}_${type}`;
  const count11 = dailyExecutionCount.get(key) || 0;
  dailyExecutionCount.set(key, count11 + 1);
}
function checkAdjustmentBoundary(accountId, type, currentValue, newValue) {
  const config2 = getAccountAutomationConfig(accountId);
  const changePercent = Math.abs((newValue - currentValue) / currentValue * 100);
  switch (type) {
    case "bid_adjustment":
      if (changePercent > config2.safetyBoundary.maxBidChangePercent) {
        return {
          allowed: false,
          reason: `\u7ADE\u4EF7\u8C03\u6574\u5E45\u5EA6 ${changePercent.toFixed(1)}% \u8D85\u8FC7\u5B89\u5168\u8FB9\u754C ${config2.safetyBoundary.maxBidChangePercent}%`
        };
      }
      break;
    case "budget_adjustment":
      if (changePercent > config2.safetyBoundary.maxBudgetChangePercent) {
        return {
          allowed: false,
          reason: `\u9884\u7B97\u8C03\u6574\u5E45\u5EA6 ${changePercent.toFixed(1)}% \u8D85\u8FC7\u5B89\u5168\u8FB9\u754C ${config2.safetyBoundary.maxBudgetChangePercent}%`
        };
      }
      break;
    case "placement_tilt":
      if (changePercent > config2.safetyBoundary.maxPlacementChangePercent) {
        return {
          allowed: false,
          reason: `\u4F4D\u7F6E\u503E\u659C\u8C03\u6574\u5E45\u5EA6 ${changePercent.toFixed(1)}% \u8D85\u8FC7\u5B89\u5168\u8FB9\u754C ${config2.safetyBoundary.maxPlacementChangePercent}%`
        };
      }
      break;
  }
  return { allowed: true };
}
function checkConfidenceThreshold(accountId, confidence) {
  const config2 = getAccountAutomationConfig(accountId);
  if (confidence >= config2.safetyBoundary.autoExecuteConfidence) {
    return { mode: "auto", reason: `\u7F6E\u4FE1\u5EA6 ${confidence}% >= ${config2.safetyBoundary.autoExecuteConfidence}%\uFF0C\u81EA\u52A8\u6267\u884C` };
  } else if (confidence >= config2.safetyBoundary.supervisedConfidence) {
    return { mode: "supervised", reason: `\u7F6E\u4FE1\u5EA6 ${confidence}% >= ${config2.safetyBoundary.supervisedConfidence}%\uFF0C\u76D1\u7763\u6267\u884C` };
  } else {
    return { mode: "manual", reason: `\u7F6E\u4FE1\u5EA6 ${confidence}% < ${config2.safetyBoundary.supervisedConfidence}%\uFF0C\u9700\u4EBA\u5DE5\u786E\u8BA4` };
  }
}
async function executeOptimization(accountId, type, targetType, targetId, targetName, currentValue, newValue, confidence, reason) {
  const config2 = getAccountAutomationConfig(accountId);
  const resultId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  if (!config2.enabled) {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: "blocked",
      reason: "\u81EA\u52A8\u5316\u6267\u884C\u5DF2\u7981\u7528",
      executedAt: /* @__PURE__ */ new Date(),
      executedBy: "auto"
    };
  }
  if (!config2.enabledTypes.includes(type)) {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: "blocked",
      reason: `\u6267\u884C\u7C7B\u578B ${type} \u672A\u542F\u7528`,
      executedAt: /* @__PURE__ */ new Date(),
      executedBy: "auto"
    };
  }
  if (!checkDailyLimit(accountId, type)) {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: "blocked",
      reason: "\u5DF2\u8FBE\u5230\u6BCF\u65E5\u6267\u884C\u9650\u5236",
      executedAt: /* @__PURE__ */ new Date(),
      executedBy: "auto"
    };
  }
  const boundaryCheck = checkAdjustmentBoundary(accountId, type, currentValue, newValue);
  if (!boundaryCheck.allowed) {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: "blocked",
      reason: boundaryCheck.reason,
      executedAt: /* @__PURE__ */ new Date(),
      executedBy: "auto"
    };
  }
  const confidenceCheck = checkConfidenceThreshold(accountId, confidence);
  if (confidenceCheck.mode === "manual" && config2.mode !== "approval") {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: "skipped",
      reason: confidenceCheck.reason,
      executedAt: /* @__PURE__ */ new Date(),
      executedBy: "auto"
    };
  }
  try {
    switch (type) {
      case "bid_adjustment": {
        let bidApiSuccess = false;
        let bidCampaignId = "";
        let bidAdGroupId = 0;
        const keyword = await getKeywordById(targetId);
        if (keyword && (keyword.keywordStatus === "amazon_deleted" || keyword.keywordStatus === "archived")) {
          log180.warn(`[AutoExec] v601: \u8DF3\u8FC7\u5DF2\u5220\u9664/\u5F52\u6863\u5173\u952E\u8BCD\u7684\u7ADE\u4EF7\u8C03\u6574 (keyword ${targetId}, status=${keyword.keywordStatus})`);
          await createBiddingLog({
            accountId,
            campaignId: "",
            internalAdGroupId: 0,
            logTargetType: "keyword",
            targetId,
            targetName,
            actionType: "skipped",
            previousBid: String(currentValue),
            newBid: String(newValue),
            reason: `[v601] \u8DF3\u8FC7\u5DF2\u5220\u9664/\u5F52\u6863\u5173\u952E\u8BCD (status=${keyword.keywordStatus})`
          });
          break;
        }
        if (keyword) {
          const adGroup = keyword.internalAdGroupId ? await getAdGroupById(keyword.internalAdGroupId) : null;
          if (adGroup) {
            bidAdGroupId = adGroup.id;
            bidCampaignId = adGroup.campaignId;
            const campaign = await getCampaignByAmazonCampaignId(adGroup.campaignId);
            if (campaign?.accountId) {
              try {
                const credentials = await getAmazonApiCredentials(campaign.accountId);
                if (credentials && keyword.keywordId) {
                  const { AmazonSyncService: SyncSvc } = await Promise.resolve().then(() => (init_amazonSyncService(), amazonSyncService_exports));
                  const accountInfo = await getAdAccountById(campaign.accountId);
                  const svc = await SyncSvc.createFromCredentials(
                    {
                      clientId: credentials.clientId,
                      clientSecret: credentials.clientSecret,
                      refreshToken: credentials.refreshToken,
                      profileId: credentials.profileId,
                      region: credentials.region
                    },
                    campaign.accountId,
                    0,
                    accountInfo?.marketplace || "US"
                  );
                  await svc.client.updateKeywordBids([{
                    keywordId: String(keyword.keywordId),
                    // v356: 使用String()替代parseInt()，避免Amazon ID精度丢失
                    bid: newValue
                  }]);
                  bidApiSuccess = true;
                }
              } catch (apiErr) {
                log180.warn(`[AutoExec] Amazon API\u8C03\u7528\u5931\u8D25 (keyword ${targetId}):`, apiErr.message);
              }
            }
          }
        }
        if (bidApiSuccess) {
          await updateKeyword(targetId, { bid: String(newValue) });
        } else {
          log180.warn(`[AutoExec] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7\u672C\u5730DB\u66F4\u65B0 (keyword ${targetId})`);
        }
        await createBiddingLog({
          accountId,
          campaignId: bidCampaignId,
          internalAdGroupId: bidAdGroupId,
          // v421: 使用internalAdGroupId
          logTargetType: "keyword",
          targetId,
          targetName,
          actionType: newValue > currentValue ? "increase" : "decrease",
          previousBid: String(currentValue),
          newBid: String(newValue),
          reason: `${bidApiSuccess ? "[API\u2705]" : "[API\u274C\u672A\u540C\u6B65]"} [\u81EA\u52A8\u6267\u884C] ${reason}`
        });
        if (!bidApiSuccess) {
          throw new Error("Amazon API\u51FA\u4EF7\u540C\u6B65\u5931\u8D25\uFF0C\u672C\u5730DB\u672A\u66F4\u65B0");
        }
        break;
      }
      case "budget_adjustment": {
        let budgetApiSuccess = false;
        const budgetCampaign = await getCampaignById(targetId);
        if (budgetCampaign?.accountId && budgetCampaign.campaignId) {
          const campaignType = budgetCampaign.campaignType;
          const isSp = campaignType === "sp_auto" || campaignType === "sp_manual";
          if (isSp) {
            try {
              const brCredentials = await getAmazonApiCredentials(budgetCampaign.accountId);
              if (brCredentials) {
                const { AmazonSyncService: BrSyncSvc } = await Promise.resolve().then(() => (init_amazonSyncService(), amazonSyncService_exports));
                const brAccountInfo = await getAdAccountById(budgetCampaign.accountId);
                const brSvc = await BrSyncSvc.createFromCredentials(
                  {
                    clientId: brCredentials.clientId,
                    clientSecret: brCredentials.clientSecret,
                    refreshToken: brCredentials.refreshToken,
                    profileId: brCredentials.profileId,
                    region: brCredentials.region
                  },
                  budgetCampaign.accountId,
                  0,
                  brAccountInfo?.marketplace || "US"
                );
                const budgetRules = await brSvc.client.listSpCampaignBudgetRules(
                  String(budgetCampaign.campaignId)
                );
                if (budgetRules && budgetRules.length > 0) {
                  log180.warn(`[AutoExec] v600: SP campaign ${targetId} (${budgetCampaign.campaignId}) \u542F\u7528\u4E86${budgetRules.length}\u6761Budget Rules\uFF0C\u8DF3\u8FC7\u5E38\u89C4\u9884\u7B97\u8C03\u6574\u4EE5\u907F\u514D\u51B2\u7A81`);
                  await updateCampaign(targetId, {
                    hasBudgetRules: 1,
                    budgetRulesCount: budgetRules.length
                  });
                  await createBiddingLog({
                    accountId,
                    campaignId: String(targetId),
                    internalAdGroupId: 0,
                    logTargetType: "campaign_budget",
                    targetId,
                    targetName: targetName || `Campaign ${targetId}`,
                    actionType: "skip",
                    previousBid: String(currentValue),
                    newBid: String(newValue),
                    reason: `[v600\u8DF3\u8FC7] SP campaign\u542F\u7528\u4E86${budgetRules.length}\u6761Budget Rules\uFF0C\u8DF3\u8FC7\u5E38\u89C4\u9884\u7B97\u8C03\u6574`
                  });
                  break;
                } else {
                  await updateCampaign(targetId, {
                    hasBudgetRules: 0,
                    budgetRulesCount: 0
                  });
                }
              }
            } catch (brCheckErr) {
              log180.warn(`[AutoExec] v600: Budget Rules\u68C0\u67E5\u5931\u8D25 (campaign ${targetId}): ${brCheckErr.message}\uFF0C\u7EE7\u7EED\u6267\u884C\u9884\u7B97\u8C03\u6574`);
            }
          }
          try {
            const budgetCredentials = await getAmazonApiCredentials(budgetCampaign.accountId);
            if (budgetCredentials) {
              const { AmazonSyncService: BudgetSyncSvc } = await Promise.resolve().then(() => (init_amazonSyncService(), amazonSyncService_exports));
              const budgetAccountInfo = await getAdAccountById(budgetCampaign.accountId);
              const budgetSvc = await BudgetSyncSvc.createFromCredentials(
                {
                  clientId: budgetCredentials.clientId,
                  clientSecret: budgetCredentials.clientSecret,
                  refreshToken: budgetCredentials.refreshToken,
                  profileId: budgetCredentials.profileId,
                  region: budgetCredentials.region
                },
                budgetCampaign.accountId,
                0,
                budgetAccountInfo?.marketplace || "US"
              );
              const finalBudgetValue = isSp ? Math.round(newValue) : newValue;
              await budgetSvc.client.updateSpCampaign(
                String(budgetCampaign.campaignId),
                // v356: 使用String()替代parseInt()，避免Amazon ID精度丢失
                { dailyBudget: finalBudgetValue }
              );
              budgetApiSuccess = true;
              if (isSp && finalBudgetValue !== newValue) {
                log180.info(`[AutoExec] v600: SP\u9884\u7B97\u53D6\u6574: ${newValue} -> ${finalBudgetValue}`);
              }
              newValue = finalBudgetValue;
            }
          } catch (budgetApiErr) {
            log180.warn(`[AutoExec] Amazon API\u9884\u7B97\u8C03\u6574\u5931\u8D25 (campaign ${targetId}):`, budgetApiErr.message);
          }
        }
        if (budgetApiSuccess) {
          await updateCampaign(targetId, { dailyBudget: String(newValue) });
        } else {
          log180.warn(`[AutoExec] v148: \u9884\u7B97API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7\u672C\u5730DB\u66F4\u65B0 (campaign ${targetId})`);
        }
        await createBiddingLog({
          accountId,
          campaignId: String(targetId),
          internalAdGroupId: 0,
          // v421: 使用internalAdGroupId
          logTargetType: "campaign_budget",
          targetId,
          targetName: targetName || `Campaign ${targetId}`,
          actionType: newValue > currentValue ? "increase" : "decrease",
          previousBid: String(currentValue),
          newBid: String(newValue),
          reason: `${budgetApiSuccess ? "[API\u2705]" : "[API\u274C\u672A\u540C\u6B65]"} [\u81EA\u52A8\u6267\u884C] \u9884\u7B97\u8C03\u6574: ${reason}`
        });
        log180.info(`[AutoExec] v148: \u9884\u7B97\u8C03\u6574: campaign=${targetId}, ${currentValue} -> ${newValue}, API=${budgetApiSuccess ? "\u2705" : "\u274C"}`);
        if (!budgetApiSuccess) {
          throw new Error("Amazon API\u9884\u7B97\u540C\u6B65\u5931\u8D25\uFF0C\u672C\u5730DB\u672A\u66F4\u65B0");
        }
        break;
      }
      case "product_target_bid": {
        let ptApiSuccess = false;
        let ptCampaignId = "";
        let ptAdGroupId = 0;
        const productTarget = await getProductTargetById(targetId);
        if (productTarget) {
          const ptAdGroup = productTarget.internalAdGroupId ? await getAdGroupById(productTarget.internalAdGroupId) : null;
          if (ptAdGroup) {
            ptAdGroupId = ptAdGroup.id;
            ptCampaignId = ptAdGroup.campaignId;
            const ptCampaign = await getCampaignByAmazonCampaignId(ptAdGroup.campaignId);
            if (ptCampaign?.accountId && productTarget.targetId) {
              try {
                const ptCredentials = await getAmazonApiCredentials(ptCampaign.accountId);
                if (ptCredentials) {
                  const { AmazonSyncService: PtSyncSvc } = await Promise.resolve().then(() => (init_amazonSyncService(), amazonSyncService_exports));
                  const ptAccountInfo = await getAdAccountById(ptCampaign.accountId);
                  const ptSvc = await PtSyncSvc.createFromCredentials(
                    {
                      clientId: ptCredentials.clientId,
                      clientSecret: ptCredentials.clientSecret,
                      refreshToken: ptCredentials.refreshToken,
                      profileId: ptCredentials.profileId,
                      region: ptCredentials.region
                    },
                    ptCampaign.accountId,
                    0,
                    ptAccountInfo?.marketplace || "US"
                  );
                  await ptSvc.client.updateProductTargetBids([{
                    targetId: String(productTarget.targetId),
                    // v356: 使用String()替代parseInt()，避免Amazon ID精度丢失
                    bid: newValue
                  }]);
                  ptApiSuccess = true;
                }
              } catch (ptApiErr) {
                log180.warn(`[AutoExec] Amazon API\u8C03\u7528\u5931\u8D25 (productTarget ${targetId}):`, ptApiErr.message);
              }
            }
          }
        }
        if (ptApiSuccess) {
          await updateProductTargetBid(targetId, String(newValue));
        } else {
          log180.warn(`[AutoExec] v148: \u5546\u54C1\u5B9A\u5411API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7\u672C\u5730DB\u66F4\u65B0 (productTarget ${targetId})`);
        }
        await createBiddingLog({
          accountId,
          campaignId: ptCampaignId,
          internalAdGroupId: ptAdGroupId,
          // v421: 使用internalAdGroupId
          logTargetType: "product_target",
          targetId,
          targetName,
          actionType: newValue > currentValue ? "increase" : "decrease",
          previousBid: String(currentValue),
          newBid: String(newValue),
          reason: `${ptApiSuccess ? "[API\u2705]" : "[API\u274C\u672A\u540C\u6B65]"} [\u81EA\u52A8\u6267\u884C] ${reason}`
        });
        if (!ptApiSuccess) {
          throw new Error("Amazon API\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u540C\u6B65\u5931\u8D25\uFF0C\u672C\u5730DB\u672A\u66F4\u65B0");
        }
        break;
      }
      case "placement_tilt": {
        let placementApiSuccess = false;
        const placementCampaign = await getCampaignById(targetId);
        if (placementCampaign?.accountId && placementCampaign.campaignId) {
          try {
            const placementCredentials = await getAmazonApiCredentials(placementCampaign.accountId);
            if (placementCredentials) {
              const { AmazonSyncService: PlSyncSvc } = await Promise.resolve().then(() => (init_amazonSyncService(), amazonSyncService_exports));
              const plAccountInfo = await getAdAccountById(placementCampaign.accountId);
              const plSvc = await PlSyncSvc.createFromCredentials(
                {
                  clientId: placementCredentials.clientId,
                  clientSecret: placementCredentials.clientSecret,
                  refreshToken: placementCredentials.refreshToken,
                  profileId: placementCredentials.profileId,
                  region: placementCredentials.region
                },
                placementCampaign.accountId,
                0,
                plAccountInfo?.marketplace || "US"
              );
              await plSvc.client.updateSpCampaign(
                String(placementCampaign.campaignId),
                // v356: 使用String()替代parseInt()，避免Amazon ID精度丢失
                {
                  dynamicBidding: {
                    placementBidding: [
                      {
                        placement: targetName.includes("\u641C\u7D22\u9876\u90E8") || targetName.includes("top") ? "PLACEMENT_TOP" : targetName.includes("\u5546\u54C1\u8BE6\u60C5") || targetName.includes("product") ? "PLACEMENT_PRODUCT_PAGE" : "PLACEMENT_REST_OF_SEARCH",
                        percentage: Math.round(newValue)
                      }
                    ]
                  }
                }
              );
              placementApiSuccess = true;
            }
          } catch (plApiErr) {
            log180.warn(`[AutoExec] Amazon API\u5E7F\u544A\u4F4D\u7F6E\u8C03\u6574\u5931\u8D25 (campaign ${targetId}):`, plApiErr.message);
          }
        }
        await createBiddingLog({
          accountId,
          campaignId: String(targetId),
          internalAdGroupId: 0,
          // v421: 使用internalAdGroupId
          logTargetType: "placement",
          targetId,
          targetName: targetName || `Campaign ${targetId} Placement`,
          actionType: newValue > currentValue ? "increase" : "decrease",
          previousBid: String(currentValue),
          newBid: String(newValue),
          reason: `${placementApiSuccess ? "[API\u2705]" : "[API\u274C]"} [\u81EA\u52A8\u6267\u884C] \u5E7F\u544A\u4F4D\u7F6E\u503E\u659C\u8C03\u6574: ${reason}`
        });
        log180.info(`[AutoExec] v148: \u5E7F\u544A\u4F4D\u7F6E\u503E\u659C: campaign=${targetId}, ${currentValue}% -> ${newValue}%, API=${placementApiSuccess ? "\u2705" : "\u274C"}`);
        if (!placementApiSuccess) {
          throw new Error("Amazon API\u5E7F\u544A\u4F4D\u7F6E\u503E\u659C\u540C\u6B65\u5931\u8D25");
        }
        break;
      }
      case "dayparting": {
        let daypartingApiSuccess = false;
        const dpCampaign = await getCampaignById(targetId);
        if (dpCampaign?.accountId && dpCampaign.campaignId) {
          try {
            const dpCredentials = await getAmazonApiCredentials(dpCampaign.accountId);
            if (dpCredentials) {
              const { AmazonSyncService: DpSyncSvc } = await Promise.resolve().then(() => (init_amazonSyncService(), amazonSyncService_exports));
              const dpAccountInfo = await getAdAccountById(dpCampaign.accountId);
              const dpSvc = await DpSyncSvc.createFromCredentials(
                {
                  clientId: dpCredentials.clientId,
                  clientSecret: dpCredentials.clientSecret,
                  refreshToken: dpCredentials.refreshToken,
                  profileId: dpCredentials.profileId,
                  region: dpCredentials.region
                },
                dpCampaign.accountId,
                0,
                dpAccountInfo?.marketplace || "US"
              );
              await dpSvc.client.updateSpCampaign(
                String(dpCampaign.campaignId),
                // v356: 使用String()替代parseInt()，避免Amazon ID精度丢失
                { dailyBudget: newValue }
              );
              daypartingApiSuccess = true;
            }
          } catch (dpApiErr) {
            log180.warn(`[AutoExec] v271: \u5206\u65F6\u7B56\u7565Amazon API\u8C03\u6574\u5931\u8D25 (campaign ${targetId}):`, dpApiErr.message);
          }
        }
        if (daypartingApiSuccess) {
          await updateCampaign(targetId, { dailyBudget: String(newValue) });
        }
        await createBiddingLog({
          accountId,
          campaignId: String(targetId),
          internalAdGroupId: 0,
          // v421: 使用internalAdGroupId
          logTargetType: "campaign_budget",
          targetId,
          targetName: targetName || `Campaign ${targetId} Dayparting`,
          actionType: newValue > currentValue ? "increase" : "decrease",
          previousBid: String(currentValue),
          newBid: String(newValue),
          reason: `${daypartingApiSuccess ? "[API\u2705]" : "[API\u274C\u672A\u540C\u6B65]"} [\u81EA\u52A8\u6267\u884C] \u5206\u65F6\u7B56\u7565\u8C03\u6574: ${reason}`
        });
        log180.info(`[AutoExec] v271: \u5206\u65F6\u7B56\u7565: campaign=${targetId}, ${currentValue} -> ${newValue}, API=${daypartingApiSuccess ? "\u2705" : "\u274C"}`);
        if (!daypartingApiSuccess) {
          throw new Error("Amazon API\u5206\u65F6\u7B56\u7565\u540C\u6B65\u5931\u8D25");
        }
        break;
      }
      case "negative_keyword": {
        let negApiSuccess = false;
        let negCampaignId = "";
        let negCampaignType = "sp_manual";
        const negKeyword = await getKeywordById(targetId);
        let negAccountId = accountId;
        if (negKeyword) {
          const negAdGroup = negKeyword.internalAdGroupId ? await getAdGroupById(negKeyword.internalAdGroupId) : null;
          if (negAdGroup) {
            negCampaignId = negAdGroup.campaignId;
            const negCampaign = await getCampaignByAmazonCampaignId(negAdGroup.campaignId);
            if (negCampaign?.accountId) {
              negAccountId = negCampaign.accountId;
            }
            if (negCampaign?.campaignType) {
              negCampaignType = negCampaign.campaignType;
            }
          }
        }
        const negCTypeNorm = negCampaignType.toLowerCase();
        if (negCTypeNorm === "sb" || negCTypeNorm === "sd") {
          log180.info(`[AutoExec] v395: \u8DF3\u8FC7SB/SD\u5426\u5B9A\u8BCD: campaign_type=${negCampaignType}, keyword="${targetName}"`);
          await createOptimizationLog({
            // @ts-ignore
            performanceGroupId: performanceGroupId || 0,
            // @ts-ignore
            performanceGroupName: performanceGroupName || "",
            accountId,
            // @ts-ignore
            accountName: accountName || "",
            logCategory: "negative_keyword",
            actionType: "negative_keyword_add",
            // @ts-ignore
            targetEntityType: "keyword",
            targetEntityId: targetId,
            targetEntityName: targetName || "",
            previousValue: "",
            newValue: `\u8DF3\u8FC7: ${negCampaignType}\u7C7B\u578B\u4E0D\u652F\u6301SP\u5426\u5B9A\u8BCDAPI`,
            reason: `v395: SB/SD campaign\u4E0D\u652F\u6301\u901A\u8FC7SP\u5426\u5B9A\u8BCDAPI\u540C\u6B65`,
            apiSyncStatus: "internal"
            // v513: 不需要API同步的内部事件
          });
          break;
        }
        const negWords = (targetName || "").trim().split(/\s+/);
        const negMatchType = negWords.length <= 2 ? "negativePhrase" : "negativeExact";
        if (!negCampaignId) {
          log180.warn(`[AutoExec] v400-fix: \u65E0\u6CD5\u89E3\u6790\u5426\u5B9A\u8BCD\u7684Amazon campaignId, keyword=${targetId}, \u8DF3\u8FC7API\u8C03\u7528`);
          await createBiddingLog({
            accountId,
            campaignId: "UNRESOLVED",
            internalAdGroupId: 0,
            // v421: 使用internalAdGroupId
            logTargetType: "negative_keyword",
            targetId,
            targetName: targetName || "",
            actionType: "add",
            previousBid: "",
            newBid: "",
            reason: `[API\u274C] v400-fix: keyword ${targetId} \u65E0\u6CD5\u89E3\u6790\u5230\u5BF9\u5E94\u7684Amazon campaignId\uFF0C\u8DF3\u8FC7\u5426\u5B9A\u8BCD\u521B\u5EFA`
          });
          break;
        }
        try {
          const negSyncResult = await syncNegativeKeywordsToAmazon(negAccountId, [{
            campaignId: String(negCampaignId),
            // v400-fix: BUG-A6修复 - 仅使用已验证的Amazon campaignId
            keywordText: targetName || "",
            matchType: negMatchType,
            level: "campaign"
          }]);
          if (negSyncResult.success > 0) {
            negApiSuccess = true;
            log180.info(`[AutoExec] v266: \u5426\u5B9A\u5173\u952E\u8BCDAPI\u540C\u6B65\u6210\u529F: "${targetName}", matchType=${negMatchType}`);
          } else {
            log180.warn(`[AutoExec] v266: \u5426\u5B9A\u5173\u952E\u8BCDAPI\u540C\u6B65\u5931\u8D25: ${negSyncResult.errors.join("; ")}`);
          }
        } catch (negApiErr) {
          log180.warn(`[AutoExec] v266: \u5426\u5B9A\u5173\u952E\u8BCDAmazon API\u8C03\u7528\u5F02\u5E38:`, negApiErr.message);
        }
        if (negApiSuccess) {
          try {
            await addNegativeKeyword({
              campaignId: targetId,
              keyword: targetName || "",
              matchType: negMatchType === "negativePhrase" ? "phrase" : "exact",
              level: "campaign"
            });
          } catch (dbErr) {
            log180.warn(`[AutoExec] v266: \u5426\u5B9A\u8BCD\u672C\u5730DB\u5199\u5165\u5931\u8D25(API\u5DF2\u6210\u529F): ${dbErr.message}`);
          }
        }
        await createBiddingLog({
          accountId,
          campaignId: String(negCampaignId),
          internalAdGroupId: 0,
          // v421: 使用internalAdGroupId
          logTargetType: "negative_keyword",
          targetId,
          targetName: targetName || "Negative Keyword",
          actionType: "add",
          previousBid: "0",
          newBid: "0",
          reason: `${negApiSuccess ? "[API\u2705]" : "[API\u274C\u672A\u540C\u6B65]"} [\u81EA\u52A8\u6267\u884C] \u5426\u5B9A\u5173\u952E\u8BCD\u6DFB\u52A0: ${reason}`
        });
        if (!negApiSuccess) {
          throw new Error("Amazon API\u5426\u5B9A\u5173\u952E\u8BCD\u540C\u6B65\u5931\u8D25");
        }
        break;
      }
      case "search_term_harvest": {
        let harvestApiSuccess = false;
        let harvestCampaignId = "";
        let harvestAdGroupId = 0;
        let harvestAmazonAdGroupId = "";
        let harvestAmazonCampaignId = "";
        let harvestSyncResult = null;
        const targetCampaignMatch = reason.match(/目标Campaign=(\d+)/);
        const targetCampaignIdFromReason = targetCampaignMatch ? parseInt(targetCampaignMatch[1]) : targetId;
        const harvestCampaign = await getCampaignById(targetCampaignIdFromReason);
        if (harvestCampaign) {
          harvestCampaignId = harvestCampaign.campaignId || "";
          harvestAmazonCampaignId = String(harvestCampaign.campaignId || "");
          try {
            const harvestAdGroups = await getAdGroupsByCampaignId(harvestCampaign.campaignId);
            if (harvestAdGroups && harvestAdGroups.length > 0) {
              const enabledAg = harvestAdGroups.find((ag) => ag.adGroupStatus === "enabled") || harvestAdGroups[0];
              harvestAdGroupId = enabledAg.id;
              harvestAmazonAdGroupId = String(enabledAg.adGroupId || "");
              log180.info(`[AutoExec] v400-fix: \u641C\u7D22\u8BCD\u6536\u5272\u89E3\u6790\u5230adGroup: localId=${harvestAdGroupId}, amazonAdGroupId=${harvestAmazonAdGroupId}`);
            } else {
              log180.warn(`[AutoExec] v400-fix: Campaign ${harvestCampaign.campaignId} \u4E0B\u672A\u627E\u5230\u4EFB\u4F55adGroup`);
            }
          } catch (agErr) {
            log180.warn(`[AutoExec] v400-fix: \u83B7\u53D6Campaign\u4E0B\u7684adGroup\u5931\u8D25: ${agErr.message}`);
          }
        }
        try {
          harvestSyncResult = await syncNewKeywordsToAmazon(accountId, [{
            adGroupId: harvestAmazonAdGroupId || harvestAdGroupId,
            campaignId: harvestAmazonCampaignId || harvestCampaignId,
            // @ts-ignore
            keywordText: targetName || "",
            matchType: "exact",
            bid: newValue || 0.75
            // 使用传入的newValue作为出价，默认0.75
          }]);
          if (harvestSyncResult.success > 0) {
            harvestApiSuccess = true;
            log180.info(`[AutoExec] v266: \u641C\u7D22\u8BCD\u6536\u5272API\u540C\u6B65\u6210\u529F: "${targetName}", bid=${newValue}`);
          } else {
            log180.warn(`[AutoExec] v266: \u641C\u7D22\u8BCD\u6536\u5272API\u540C\u6B65\u5931\u8D25: ${harvestSyncResult.errors.join("; ")}`);
          }
        } catch (harvestApiErr) {
          log180.warn(`[AutoExec] v266: \u641C\u7D22\u8BCD\u6536\u5272Amazon API\u8C03\u7528\u5F02\u5E38:`, harvestApiErr.message);
        }
        if (harvestApiSuccess) {
          const harvestAmazonKeywordId = harvestSyncResult.createdKeywords?.[0]?.amazonKeywordId;
          const validKeywordId = harvestAmazonKeywordId ? String(harvestAmazonKeywordId) : "";
          if (!validKeywordId || validKeywordId === "0") {
            log180.warn(`[AutoExec] v357: API\u6210\u529F\u4F46\u672A\u83B7\u53D6\u5230\u6709\u6548keywordId\uFF0C\u4E0D\u5199\u5165\u672C\u5730DB\u4EE5\u907F\u514D\u5E7D\u7075\u8BB0\u5F55`);
          } else {
            try {
              await createKeyword({
                accountId,
                // v357: 包含accountId
                campaignId: harvestAmazonCampaignId || String(harvestCampaignId),
                // v357: 包含Amazon campaignId
                internalAdGroupId: harvestAdGroupId,
                // v421: 使用internalAdGroupId(int)
                keywordId: validKeywordId,
                // v357: 使用API返回的Amazon keywordId
                keywordText: targetName || "",
                matchType: "exact",
                bid: String(newValue || 0.75),
                keywordStatus: "enabled"
              });
              log180.info(`[AutoExec] v357: \u672C\u5730keyword\u5DF2\u521B\u5EFA: amazonKeywordId=${validKeywordId}, accountId=${accountId}`);
            } catch (dbErr) {
              log180.warn(`[AutoExec] v357: \u641C\u7D22\u8BCD\u6536\u5272\u672C\u5730DB\u5199\u5165\u5931\u8D25(API\u5DF2\u6210\u529F): ${dbErr.message}`);
            }
          }
        }
        await createBiddingLog({
          accountId,
          campaignId: String(harvestCampaignId),
          internalAdGroupId: harvestAdGroupId,
          // v421: 使用internalAdGroupId
          logTargetType: "search_term_harvest",
          targetId,
          targetName: targetName || "Search Term Harvest",
          actionType: "add",
          previousBid: "0",
          newBid: String(newValue || 0.75),
          reason: `${harvestApiSuccess ? "[API\u2705]" : "[API\u274C\u672A\u540C\u6B65]"} [\u81EA\u52A8\u6267\u884C] \u641C\u7D22\u8BCD\u6536\u5272: ${reason}`
        });
        log180.info(`[AutoExec] v266: \u641C\u7D22\u8BCD\u6536\u5272\u6267\u884C: target=${targetName}, API=${harvestApiSuccess ? "\u2705" : "\u274C"}`);
        if (!harvestApiSuccess) {
          throw new Error("Amazon API\u641C\u7D22\u8BCD\u6536\u5272\u540C\u6B65\u5931\u8D25");
        }
        break;
      }
      default:
        log180.info(`[AutoExec] \u672A\u5B9E\u73B0\u7684\u6267\u884C\u7C7B\u578B: ${type}, target=${targetName}`);
        break;
    }
    incrementDailyCount(accountId, type);
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: "success",
      reason: `${confidenceCheck.reason}\u3002${reason}`,
      executedAt: /* @__PURE__ */ new Date(),
      executedBy: "auto"
    };
  } catch (error48) {
    return {
      id: resultId,
      type,
      targetType,
      targetId,
      targetName,
      previousValue: currentValue,
      newValue,
      confidence,
      status: "failed",
      reason: `\u6267\u884C\u5931\u8D25: ${error48 instanceof Error ? error48.message : "Unknown error"}`,
      executedAt: /* @__PURE__ */ new Date(),
      executedBy: "auto"
    };
  }
}
async function batchExecuteOptimizations(accountId, optimizations) {
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startedAt = /* @__PURE__ */ new Date();
  const results = [];
  let successItems = 0;
  let failedItems = 0;
  let skippedItems = 0;
  let blockedItems = 0;
  for (const opt of optimizations) {
    const result = await executeOptimization(
      accountId,
      opt.type,
      opt.targetType,
      opt.targetId,
      opt.targetName,
      opt.currentValue,
      opt.newValue,
      opt.confidence,
      opt.reason
    );
    results.push(result);
    switch (result.status) {
      case "success":
        successItems++;
        break;
      case "failed":
        failedItems++;
        break;
      case "skipped":
        skippedItems++;
        break;
      case "blocked":
        blockedItems++;
        break;
    }
  }
  const batch = {
    id: batchId,
    accountId,
    startedAt,
    completedAt: /* @__PURE__ */ new Date(),
    totalItems: optimizations.length,
    successItems,
    failedItems,
    skippedItems,
    blockedItems,
    results
  };
  executionHistory.push(batch);
  const config2 = getAccountAutomationConfig(accountId);
  if (config2.notificationConfig.notifyOnFailure && failedItems > 0) {
    await sendNotification({
      userId: 0,
      // 系统通知
      accountId,
      type: "alert",
      severity: "warning",
      title: "\u81EA\u52A8\u6267\u884C\u90E8\u5206\u5931\u8D25",
      message: `\u6279\u6B21 ${batchId}\uFF1A\u6210\u529F ${successItems}\uFF0C\u5931\u8D25 ${failedItems}\uFF0C\u8DF3\u8FC7 ${skippedItems}\uFF0C\u963B\u6B62 ${blockedItems}`
    });
  }
  return batch;
}
async function runFullAutomationCycle(accountId) {
  const config2 = getAccountAutomationConfig(accountId);
  if (!config2.enabled) {
    return {
      analysisResults: [],
      executionBatch: null,
      summary: {
        totalAnalyzed: 0,
        totalExecuted: 0,
        totalSkipped: 0,
        totalBlocked: 0
        // @ts-ignore
      }
    };
  }
  const analysisResults = await runUnifiedOptimizationAnalysis(
    accountId,
    {
      // @ts-ignore
      optimizationTypes: config2.enabledTypes.filter(
        (t2) => ["bid_adjustment", "placement_tilt", "dayparting", "negative_keyword"].includes(t2)
      )
    }
  );
  const optimizations = analysisResults.filter((r) => r.confidence >= config2.safetyBoundary.supervisedConfidence).map((r) => ({
    type: r.type,
    targetType: r.targetType,
    targetId: r.targetId,
    targetName: r.targetName,
    currentValue: typeof r.currentValue === "number" ? r.currentValue : parseFloat(r.currentValue) || 0,
    newValue: typeof r.suggestedValue === "number" ? r.suggestedValue : parseFloat(r.suggestedValue) || 0,
    confidence: r.confidence,
    reason: r.reasoning
  }));
  const executionBatch = optimizations.length > 0 ? await batchExecuteOptimizations(accountId, optimizations) : null;
  return {
    analysisResults,
    executionBatch,
    summary: {
      totalAnalyzed: analysisResults.length,
      totalExecuted: executionBatch?.successItems || 0,
      totalSkipped: executionBatch?.skippedItems || 0,
      totalBlocked: executionBatch?.blockedItems || 0
    }
  };
}
function getExecutionHistory2(accountId, options = {}) {
  let filtered = executionHistory.filter((b) => b.accountId === accountId);
  if (options.startDate) {
    filtered = filtered.filter((b) => b.startedAt >= options.startDate);
  }
  if (options.endDate) {
    filtered = filtered.filter((b) => b.startedAt <= options.endDate);
  }
  filtered.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  if (options.limit) {
    filtered = filtered.slice(0, options.limit);
  }
  return filtered;
}
function getDailyExecutionStats(accountId, date6) {
  const targetDate = date6 || /* @__PURE__ */ new Date();
  const dateStr = targetDate.toISOString().split("T")[0];
  const config2 = getAccountAutomationConfig(accountId);
  const bidCount = dailyExecutionCount.get(`${accountId}_${dateStr}_bid_adjustment`) || 0;
  const budgetCount = dailyExecutionCount.get(`${accountId}_${dateStr}_budget_adjustment`) || 0;
  let totalCount = 0;
  dailyExecutionCount.forEach((value, key) => {
    if (key.startsWith(`${accountId}_${dateStr}_`)) {
      totalCount += value;
    }
  });
  return {
    date: dateStr,
    bidAdjustments: bidCount,
    budgetAdjustments: budgetCount,
    totalAdjustments: totalCount,
    remaining: {
      bidAdjustments: Math.max(0, config2.safetyBoundary.maxDailyBidAdjustments - bidCount),
      budgetAdjustments: Math.max(0, config2.safetyBoundary.maxDailyBudgetAdjustments - budgetCount),
      totalAdjustments: Math.max(0, config2.safetyBoundary.maxDailyTotalAdjustments - totalCount)
    }
  };
}
function emergencyStop(accountId, reason) {
  const config2 = getAccountAutomationConfig(accountId);
  config2.enabled = false;
  accountConfigs.set(accountId, config2);
  sendNotification({
    userId: 0,
    // 系统通知
    accountId,
    type: "alert",
    severity: "critical",
    title: "\u81EA\u52A8\u5316\u7D27\u6025\u505C\u6B62",
    message: `\u8D26\u53F7 ${accountId} \u7684\u81EA\u52A8\u5316\u6267\u884C\u5DF2\u7D27\u6025\u505C\u6B62\u3002\u539F\u56E0\uFF1A${reason}`
  });
}
function resumeAutomation(accountId) {
  const config2 = getAccountAutomationConfig(accountId);
  config2.enabled = true;
  accountConfigs.set(accountId, config2);
}
async function runNGramAnalysisTask(accountId) {
  const config2 = getAccountAutomationConfig(accountId);
  if (!config2.enabled || !config2.enabledTypes.includes("ngram_analysis")) {
    return {
      success: false,
      analysisResult: null,
      suggestedNegatives: 0,
      appliedNegatives: 0,
      message: "N-Gram\u5206\u6790\u4EFB\u52A1\u672A\u542F\u7528"
    };
  }
  try {
    const endDate = /* @__PURE__ */ new Date();
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(startDate.getDate() - 30);
    const analysisResult = await runNGramAnalysis(
      accountId,
      startDate,
      endDate,
      { minFrequency: 5 }
    );
    const suggestedNegatives = analysisResult.suggestedNegatives.length;
    if (suggestedNegatives === 0) {
      return {
        success: true,
        analysisResult,
        suggestedNegatives: 0,
        appliedNegatives: 0,
        message: "\u672A\u53D1\u73B0\u9700\u8981\u5426\u5B9A\u7684\u9AD8\u9891\u65E0\u6548\u8BCD\u6839"
      };
    }
    let appliedNegatives = 0;
    if (config2.mode === "full_auto") {
      const campaigns6 = await getCampaignsByAccountId(accountId);
      const database = await getDb();
      for (const suggestion of analysisResult.suggestedNegatives) {
        const spCampaigns = campaigns6.filter((c) => {
          const cType = String(c.campaignType || "").toLowerCase();
          if (cType === "sb" || cType === "sd") {
            log180.debug(`[NGram] v614i-P1: \u8DF3\u8FC7SB/SD campaign: type=${c.campaignType}, id=${c.campaignId}, token="${suggestion.token}"`);
            return false;
          }
          return true;
        });
        const negativesToSync = spCampaigns.map((campaign) => ({
          campaignId: String(campaign.campaignId),
          keywordText: suggestion.token,
          matchType: suggestion.matchType === "negative_phrase" ? "negativePhrase" : "negativeExact",
          level: "campaign"
        }));
        try {
          const syncResult = await syncNegativeKeywordsToAmazon(accountId, negativesToSync);
          for (const campaign of campaigns6) {
            const amazonCampaignId = String(campaign.campaignId);
            const mapKey = `campaign:${amazonCampaignId}:${suggestion.token.toLowerCase()}`;
            const amazonNegKeywordId = syncResult.keywordIdMap.get(mapKey);
            try {
              await addNegativeKeyword({
                // @ts-ignore
                campaignId: campaign.campaignId,
                keyword: suggestion.token,
                matchType: suggestion.matchType === "negative_phrase" ? "phrase" : "exact",
                level: "campaign"
              });
              if (amazonNegKeywordId && database) {
                await database.execute(sql`
 UPDATE negative_keywords 
 SET amazon_negative_keyword_id = ${amazonNegKeywordId},
 negativeSource = 'ngram_analysis'
 WHERE campaignId = ${campaign.campaignId}
 AND negativeText = ${suggestion.token}
 AND amazon_negative_keyword_id IS NULL
 LIMIT 1
 `);
              }
              appliedNegatives++;
            } catch (dbError) {
            }
          }
          if (syncResult.failed > 0) {
            log180.warn(`[AutomationEngine] N-Gram\u5426\u5B9A\u8BCD\u90E8\u5206\u540C\u6B65\u5931\u8D25: ${syncResult.errors.join("; ")}`);
          }
        } catch (apiError) {
          log180.warn(`[AutomationEngine] N-Gram\u5426\u5B9A\u8BCD API\u540C\u6B65\u5931\u8D25: ${apiError.message}`);
          for (const campaign of campaigns6) {
            try {
              await addNegativeKeyword({
                // @ts-ignore
                campaignId: campaign.campaignId,
                keyword: suggestion.token,
                matchType: suggestion.matchType === "negative_phrase" ? "phrase" : "exact",
                level: "campaign"
              });
              appliedNegatives++;
            } catch (dbError) {
            }
          }
        }
      }
      if (config2.notificationConfig.notifyOnSuccess) {
        await sendNotification({
          userId: 0,
          accountId,
          type: "system",
          severity: "info",
          title: "N-Gram\u5206\u6790\u5B8C\u6210",
          message: `\u8BC6\u522B\u5230 ${suggestedNegatives} \u4E2A\u9AD8\u9891\u65E0\u6548\u8BCD\u6839\uFF0C\u5DF2\u81EA\u52A8\u5E94\u7528 ${appliedNegatives} \u4E2A\u5426\u5B9A\u8BCD\u5E76\u540C\u6B65\u5230Amazon`
        });
      }
    } else {
      await sendNotification({
        userId: 0,
        accountId,
        type: "system",
        severity: "info",
        title: "N-Gram\u5206\u6790\u5B8C\u6210",
        message: `\u8BC6\u522B\u5230 ${suggestedNegatives} \u4E2A\u9AD8\u9891\u65E0\u6548\u8BCD\u6839\uFF0C\u8BF7\u5728\u4F18\u5316\u4E2D\u5FC3\u67E5\u770B\u5E76\u786E\u8BA4`
      });
    }
    return {
      success: true,
      analysisResult,
      suggestedNegatives,
      appliedNegatives,
      message: config2.mode === "full_auto" ? `\u5DF2\u81EA\u52A8\u5E94\u7528 ${appliedNegatives} \u4E2A\u5426\u5B9A\u8BCD` : `\u8BC6\u522B\u5230 ${suggestedNegatives} \u4E2A\u5EFA\u8BAE\uFF0C\u7B49\u5F85\u786E\u8BA4`
    };
  } catch (error48) {
    const errorMessage = error48 instanceof Error ? error48.message : "Unknown error";
    if (config2.notificationConfig.notifyOnFailure) {
      await sendNotification({
        userId: 0,
        accountId,
        type: "alert",
        severity: "warning",
        title: "N-Gram\u5206\u6790\u5931\u8D25",
        message: errorMessage
      });
    }
    return {
      success: false,
      analysisResult: null,
      suggestedNegatives: 0,
      appliedNegatives: 0,
      message: `N-Gram\u5206\u6790\u5931\u8D25: ${errorMessage}`
    };
  }
}
async function runFunnelSyncTask(accountId) {
  const config2 = getAccountAutomationConfig(accountId);
  if (!config2.enabled || !config2.enabledTypes.includes("funnel_sync")) {
    return {
      success: false,
      tierConfigs: [],
      syncResult: null,
      message: "\u6F0F\u6597\u540C\u6B65\u4EFB\u52A1\u672A\u542F\u7528"
    };
  }
  try {
    const tierConfigs = await identifyFunnelTiers(accountId);
    if (tierConfigs.length === 0) {
      return {
        success: true,
        tierConfigs: [],
        syncResult: null,
        message: "\u672A\u68C0\u6D4B\u5230\u6F0F\u6597\u5C42\u7EA7\u914D\u7F6E\uFF0C\u8BF7\u5148\u914D\u7F6E\u5E7F\u544A\u6D3B\u52A8\u5C42\u7EA7"
      };
    }
    const syncResult = await syncFunnelNegatives(accountId, tierConfigs);
    const totalNegatives = syncResult.totalNegativesToAdd;
    if (totalNegatives > 0) {
      if (config2.mode === "full_auto") {
        if (config2.notificationConfig.notifyOnSuccess) {
          await sendNotification({
            userId: 0,
            accountId,
            type: "system",
            severity: "info",
            // @ts-ignore
            title: "\u6F0F\u6597\u5426\u5B9A\u8BCD\u540C\u6B65\u5B8C\u6210",
            message: `\u5DF2\u540C\u6B65 ${totalNegatives} \u4E2A\u5426\u5B9A\u8BCD\u5230\u5404\u5C42\u7EA7\u5E7F\u544A\u6D3B\u52A8`
          });
        }
      } else {
        await sendNotification({
          userId: 0,
          accountId,
          type: "system",
          severity: "info",
          title: "\u6F0F\u6597\u5426\u5B9A\u8BCD\u540C\u6B65\u5EFA\u8BAE",
          message: `\u68C0\u6D4B\u5230 ${totalNegatives} \u4E2A\u9700\u8981\u540C\u6B65\u7684\u5426\u5B9A\u8BCD\uFF0C\u8BF7\u5728\u4F18\u5316\u4E2D\u5FC3\u67E5\u770B`
        });
      }
    }
    return {
      success: true,
      tierConfigs,
      // @ts-ignore
      syncResult,
      message: `\u8BC6\u522B ${tierConfigs.length} \u4E2A\u6F0F\u6597\u5C42\u7EA7\uFF0C\u540C\u6B65 ${totalNegatives} \u4E2A\u5426\u5B9A\u8BCD`
    };
  } catch (error48) {
    const errorMessage = error48 instanceof Error ? error48.message : "Unknown error";
    if (config2.notificationConfig.notifyOnFailure) {
      await sendNotification({
        userId: 0,
        accountId,
        type: "alert",
        severity: "warning",
        title: "\u6F0F\u6597\u540C\u6B65\u5931\u8D25",
        message: errorMessage
      });
    }
    return {
      success: false,
      tierConfigs: [],
      syncResult: null,
      message: `\u6F0F\u6597\u540C\u6B65\u5931\u8D25: ${errorMessage}`
    };
  }
}
async function runKeywordMigrationTask(accountId) {
  const config2 = getAccountAutomationConfig(accountId);
  if (!config2.enabled || !config2.enabledTypes.includes("keyword_migration")) {
    return {
      success: false,
      suggestions: [],
      appliedMigrations: 0,
      message: "\u5173\u952E\u8BCD\u8FC1\u79FB\u4EFB\u52A1\u672A\u542F\u7528"
    };
  }
  try {
    const tierConfigs = await identifyFunnelTiers(accountId);
    if (tierConfigs.length === 0) {
      return {
        success: true,
        suggestions: [],
        appliedMigrations: 0,
        message: "\u672A\u68C0\u6D4B\u5230\u6F0F\u6597\u5C42\u7EA7\u914D\u7F6E"
      };
    }
    const endDate = /* @__PURE__ */ new Date();
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(startDate.getDate() - 30);
    const suggestions = await getKeywordMigrationSuggestions(
      accountId,
      tierConfigs,
      startDate,
      endDate
    );
    if (suggestions.length === 0) {
      return {
        success: true,
        suggestions: [],
        appliedMigrations: 0,
        message: "\u672A\u53D1\u73B0\u9700\u8981\u8FC1\u79FB\u7684\u5173\u952E\u8BCD"
      };
    }
    let appliedMigrations = 0;
    if (config2.mode === "full_auto") {
      const tier1Configs = tierConfigs.filter((t2) => t2.tierLevel === "tier1_exact");
      if (tier1Configs.length > 0) {
        const tier1CampaignId = tier1Configs[0].campaignId;
        const tier1AdGroups = await getAdGroupsByCampaignId(tier1CampaignId);
        if (tier1AdGroups.length > 0) {
          const targetAdGroupId = tier1AdGroups[0].id;
          for (const suggestion of suggestions) {
            try {
              const newKeyword = {
                internalAdGroupId: targetAdGroupId,
                // v421: 使用internalAdGroupId
                // @ts-ignore
                keywordText: suggestion.searchTerm,
                matchType: "exact",
                keywordStatus: "enabled",
                bid: "1.00"
              };
              log180.info("[AutomationEngine] Would create keyword:", newKeyword);
              await addNegativeKeyword({
                // @ts-ignore
                campaignId: suggestion.sourceCampaignId,
                // @ts-ignore
                keyword: suggestion.searchTerm,
                matchType: "exact",
                level: "campaign"
              });
              appliedMigrations++;
            } catch (error48) {
            }
          }
        }
      }
      if (config2.notificationConfig.notifyOnSuccess && appliedMigrations > 0) {
        await sendNotification({
          userId: 0,
          accountId,
          type: "system",
          severity: "info",
          title: "\u5173\u952E\u8BCD\u8FC1\u79FB\u5B8C\u6210",
          message: `\u5DF2\u81EA\u52A8\u8FC1\u79FB ${appliedMigrations} \u4E2A\u9AD8\u8F6C\u5316\u5173\u952E\u8BCD\u5230\u7CBE\u51C6\u5C42`
        });
      }
    } else {
      await sendNotification({
        userId: 0,
        accountId,
        type: "system",
        severity: "info",
        title: "\u5173\u952E\u8BCD\u8FC1\u79FB\u5EFA\u8BAE",
        message: `\u68C0\u6D4B\u5230 ${suggestions.length} \u4E2A\u9AD8\u8F6C\u5316\u5173\u952E\u8BCD\u53EF\u8FC1\u79FB\u5230\u7CBE\u51C6\u5C42\uFF0C\u8BF7\u5728\u4F18\u5316\u4E2D\u5FC3\u67E5\u770B`
      });
    }
    return {
      success: true,
      suggestions,
      appliedMigrations,
      message: config2.mode === "full_auto" ? `\u5DF2\u81EA\u52A8\u8FC1\u79FB ${appliedMigrations} \u4E2A\u5173\u952E\u8BCD` : `\u8BC6\u522B\u5230 ${suggestions.length} \u4E2A\u8FC1\u79FB\u5EFA\u8BAE\uFF0C\u7B49\u5F85\u786E\u8BA4`
    };
  } catch (error48) {
    const errorMessage = error48 instanceof Error ? error48.message : "Unknown error";
    if (config2.notificationConfig.notifyOnFailure) {
      await sendNotification({
        userId: 0,
        accountId,
        type: "alert",
        severity: "warning",
        title: "\u5173\u952E\u8BCD\u8FC1\u79FB\u5931\u8D25",
        message: errorMessage
      });
    }
    return {
      success: false,
      suggestions: [],
      appliedMigrations: 0,
      message: `\u5173\u952E\u8BCD\u8FC1\u79FB\u5931\u8D25: ${errorMessage}`
    };
  }
}
async function runTrafficConflictDetectionTask(accountId) {
  const config2 = getAccountAutomationConfig(accountId);
  if (!config2.enabled || !config2.enabledTypes.includes("traffic_isolation")) {
    return {
      success: false,
      conflictResult: null,
      resolvedConflicts: 0,
      message: "\u6D41\u91CF\u9694\u79BB\u4EFB\u52A1\u672A\u542F\u7528"
    };
  }
  try {
    const endDate = /* @__PURE__ */ new Date();
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(startDate.getDate() - 14);
    const conflictResult = await detectTrafficConflicts2(
      accountId,
      startDate,
      endDate
    );
    if (conflictResult.totalConflicts === 0) {
      return {
        success: true,
        conflictResult,
        resolvedConflicts: 0,
        message: "\u672A\u68C0\u6D4B\u5230\u6D41\u91CF\u51B2\u7A81"
      };
    }
    let resolvedConflicts = 0;
    if (config2.mode === "full_auto") {
      for (const suggestion of conflictResult.resolutionSuggestions) {
        for (const negative of suggestion.negativesToAdd) {
          try {
            await addNegativeKeyword({
              campaignId: negative.campaignId,
              keyword: negative.negativeText,
              matchType: negative.matchType === "negative_exact" ? "exact" : "phrase",
              level: "campaign"
            });
            resolvedConflicts++;
          } catch (error48) {
          }
        }
      }
      if (config2.notificationConfig.notifyOnSuccess && resolvedConflicts > 0) {
        await sendNotification({
          userId: 0,
          accountId,
          type: "system",
          severity: "info",
          title: "\u6D41\u91CF\u51B2\u7A81\u89E3\u51B3\u5B8C\u6210",
          message: `\u68C0\u6D4B\u5230 ${conflictResult.totalConflicts} \u4E2A\u51B2\u7A81\uFF0C\u5DF2\u81EA\u52A8\u89E3\u51B3 ${resolvedConflicts} \u4E2A\uFF0C\u6F5C\u5728\u8282\u7701 $${conflictResult.totalWastedSpend.toFixed(2)}`
        });
      }
    } else {
      await sendNotification({
        userId: 0,
        accountId,
        type: "alert",
        severity: "warning",
        title: "\u68C0\u6D4B\u5230\u6D41\u91CF\u51B2\u7A81",
        message: `\u68C0\u6D4B\u5230 ${conflictResult.totalConflicts} \u4E2A\u6D41\u91CF\u51B2\u7A81\uFF0C\u6F5C\u5728\u6D6A\u8D39 $${conflictResult.totalWastedSpend.toFixed(2)}\uFF0C\u8BF7\u5728\u4F18\u5316\u4E2D\u5FC3\u67E5\u770B`
      });
    }
    return {
      success: true,
      conflictResult,
      resolvedConflicts,
      message: config2.mode === "full_auto" ? `\u5DF2\u81EA\u52A8\u89E3\u51B3 ${resolvedConflicts} \u4E2A\u51B2\u7A81` : `\u68C0\u6D4B\u5230 ${conflictResult.totalConflicts} \u4E2A\u51B2\u7A81\uFF0C\u7B49\u5F85\u786E\u8BA4`
    };
  } catch (error48) {
    const errorMessage = error48 instanceof Error ? error48.message : "Unknown error";
    if (config2.notificationConfig.notifyOnFailure) {
      await sendNotification({
        userId: 0,
        accountId,
        type: "alert",
        severity: "warning",
        title: "\u6D41\u91CF\u51B2\u7A81\u68C0\u6D4B\u5931\u8D25",
        message: errorMessage
      });
    }
    return {
      success: false,
      conflictResult: null,
      resolvedConflicts: 0,
      message: `\u6D41\u91CF\u51B2\u7A81\u68C0\u6D4B\u5931\u8D25: ${errorMessage}`
    };
  }
}
async function runFullTrafficIsolationCycle(accountId, overrideConfig) {
  const config2 = getAccountAutomationConfig(accountId);
  if (!config2.enabled) {
    return {
      success: false,
      // @ts-ignore
      ngramResult: { success: false, analysisResult: null, suggestedNegatives: 0, appliedNegatives: 0, message: "\u81EA\u52A8\u5316\u672A\u542F\u7528" },
      funnelResult: { success: false, tierConfigs: [], syncResult: null, message: "\u81EA\u52A8\u5316\u672A\u542F\u7528" },
      migrationResult: { success: false, suggestions: [], appliedMigrations: 0, message: "\u81EA\u52A8\u5316\u672A\u542F\u7528" },
      conflictResult: { success: false, conflictResult: null, resolvedConflicts: 0, message: "\u81EA\u52A8\u5316\u672A\u542F\u7528" },
      summary: {
        totalNegativesAdded: 0,
        totalKeywordsMigrated: 0,
        totalConflictsResolved: 0,
        estimatedSavings: 0
      }
    };
  }
  const ngramResult = await runNGramAnalysisTask(accountId);
  const funnelResult = await runFunnelSyncTask(accountId);
  const migrationResult = await runKeywordMigrationTask(accountId);
  const conflictResult = await runTrafficConflictDetectionTask(accountId);
  const summary = {
    totalNegativesAdded: ngramResult.appliedNegatives + (funnelResult.syncResult?.totalNegativesToAdd || 0),
    totalKeywordsMigrated: migrationResult.appliedMigrations,
    totalConflictsResolved: conflictResult.resolvedConflicts,
    // @ts-ignore
    estimatedSavings: (ngramResult.analysisResult?.suggestedNegatives.reduce((sum2, n) => sum2 + n.estimatedSavings, 0) || 0) + (conflictResult.conflictResult?.totalWastedSpend || 0)
  };
  if (config2.notificationConfig.dailySummary) {
    await sendNotification({
      userId: 0,
      accountId,
      type: "report",
      severity: "info",
      title: "\u6D41\u91CF\u9694\u79BB\u81EA\u52A8\u5316\u5468\u671F\u5B8C\u6210",
      message: `\u6DFB\u52A0\u5426\u5B9A\u8BCD: ${summary.totalNegativesAdded}, \u8FC1\u79FB\u5173\u952E\u8BCD: ${summary.totalKeywordsMigrated}, \u89E3\u51B3\u51B2\u7A81: ${summary.totalConflictsResolved}, \u9884\u4F30\u8282\u7701: $${summary.estimatedSavings.toFixed(2)}`
    });
  }
  return {
    success: ngramResult.success || funnelResult.success || migrationResult.success || conflictResult.success,
    ngramResult,
    funnelResult,
    migrationResult,
    conflictResult,
    summary
  };
}
var log180, DEFAULT_SAFETY_BOUNDARY, DEFAULT_AUTOMATION_CONFIG, accountConfigs, executionHistory, dailyExecutionCount, _memoryCleanupTimer;
var init_automationExecutionEngine = __esm({
  "server/automation/automationExecutionEngine.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_db2();
    init_unifiedOptimizationEngine();
    init_notificationService();
    init_trafficIsolationService();
    init_amazonApiHelper();
    init_drizzle_orm();
    log180 = createModuleLogger("AutoExecEngine");
    DEFAULT_SAFETY_BOUNDARY = {
      // 单次调整限制 (v602: 收紧安全边界)
      maxBidChangePercent: 20,
      // v602: 从30%降低到20%
      maxBudgetChangePercent: 50,
      maxPlacementChangePercent: 20,
      // 每日调整限制 (v602: 收紧每日限制)
      maxDailyBidAdjustments: 50,
      // v602: 从100降低到50
      maxDailyBudgetAdjustments: 10,
      maxDailyTotalAdjustments: 80,
      // v602: 从150降低到80
      // 置信度阈值
      autoExecuteConfidence: 80,
      supervisedConfidence: 60,
      // 紧急停止条件
      acosIncreaseThreshold: 50,
      spendOverrunThreshold: 200,
      conversionDropThreshold: 70,
      apiFailureThreshold: 3
    };
    DEFAULT_AUTOMATION_CONFIG = {
      enabled: true,
      mode: "full_auto",
      safetyBoundary: DEFAULT_SAFETY_BOUNDARY,
      enabledTypes: [
        "bid_adjustment",
        "product_target_bid",
        "budget_adjustment",
        "placement_tilt",
        "negative_keyword",
        "dayparting",
        "auto_rollback",
        "ngram_analysis",
        "funnel_sync",
        "keyword_migration",
        "traffic_isolation",
        "funnel_migration",
        "search_term_harvest"
      ],
      scheduleConfig: {
        bidAdjustmentTime: "07:00",
        budgetAdjustmentTime: "06:00",
        analysisTime: "05:30",
        syncTime: "05:00"
      },
      notificationConfig: {
        notifyOnSuccess: false,
        notifyOnFailure: true,
        notifyOnBlocked: true,
        dailySummary: true,
        weeklySummary: true
      }
    };
    accountConfigs = /* @__PURE__ */ new Map();
    executionHistory = [];
    dailyExecutionCount = /* @__PURE__ */ new Map();
    __name(cleanupStaleMemoryData, "cleanupStaleMemoryData");
    _memoryCleanupTimer = setInterval(cleanupStaleMemoryData, 60 * 60 * 1e3);
    __name(getAccountAutomationConfig, "getAccountAutomationConfig");
    __name(updateAccountAutomationConfig, "updateAccountAutomationConfig");
    __name(checkDailyLimit, "checkDailyLimit");
    __name(incrementDailyCount, "incrementDailyCount");
    __name(checkAdjustmentBoundary, "checkAdjustmentBoundary");
    __name(checkConfidenceThreshold, "checkConfidenceThreshold");
    __name(executeOptimization, "executeOptimization");
    __name(batchExecuteOptimizations, "batchExecuteOptimizations");
    __name(runFullAutomationCycle, "runFullAutomationCycle");
    __name(getExecutionHistory2, "getExecutionHistory");
    __name(getDailyExecutionStats, "getDailyExecutionStats");
    __name(emergencyStop, "emergencyStop");
    __name(resumeAutomation, "resumeAutomation");
    __name(runNGramAnalysisTask, "runNGramAnalysisTask");
    __name(runFunnelSyncTask, "runFunnelSyncTask");
    __name(runKeywordMigrationTask, "runKeywordMigrationTask");
    __name(runTrafficConflictDetectionTask, "runTrafficConflictDetectionTask");
    __name(runFullTrafficIsolationCycle, "runFullTrafficIsolationCycle");
  }
});

