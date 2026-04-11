// Extracted from production dist/index.js
// Original module: server/services/amazonIdResolver.ts
// Lines: 634

var amazonIdResolver_exports = {};
__export(amazonIdResolver_exports, {
  ensureAmazonIdsReady: () => ensureAmazonIdsReady,
  resolveKeywordIdOnDemand: () => resolveKeywordIdOnDemand,
  resolveProductTargetIdOnDemand: () => resolveProductTargetIdOnDemand
});
async function ensureAmazonIdsReady(accountId) {
  const result = {
    keywordsResolved: 0,
    keywordsFailed: 0,
    keywordsCreated: 0,
    keywordsCleanedUp: 0,
    productTargetsResolved: 0,
    productTargetsFailed: 0,
    totalMissingBefore: 0,
    totalMissingAfter: 0,
    errors: []
  };
  log37.info(`========== \u5F00\u59CBPre-Sync ID Resolution: accountId=${accountId} ==========`);
  let directConn = null;
  try {
    directConn = await getDirectConnection(6e4);
    await resolveKeywordIds(accountId, directConn, result);
    await resolveProductTargetIds(accountId, directConn, result);
    const [remainingKws] = await directConn.execute(
      `SELECT COUNT(*) AS cnt FROM keywords k
       INNER JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
       INNER JOIN campaigns c ON ag.campaignId = c.campaignId
       WHERE c.accountId = ? AND k.keywordId IS NULL`,
      [accountId]
      // @ts-ignore
    );
    const [remainingPts] = await directConn.execute(
      `SELECT COUNT(*) AS cnt FROM product_targets pt
       INNER JOIN ad_groups ag ON pt.internal_ad_group_id = ag.id
       INNER JOIN campaigns c ON ag.campaignId = c.campaignId
       WHERE c.accountId = ? AND pt.targetId IS NULL`,
      [accountId]
    );
    result.totalMissingAfter = (remainingKws[0]?.cnt || 0) + (remainingPts[0]?.cnt || 0);
    log37.info(`========== Pre-Sync ID Resolution \u5B8C\u6210 ==========`);
    log37.warn(`Keywords: \u56DE\u586B${result.keywordsResolved}, \u521B\u5EFA${result.keywordsCreated}, \u6E05\u7406${result.keywordsCleanedUp}, \u5931\u8D25${result.keywordsFailed}`);
    log37.warn(`ProductTargets: \u56DE\u586B${result.productTargetsResolved}, \u5931\u8D25${result.productTargetsFailed}`);
    log37.debug(`\u603B\u7F3A\u5931: ${result.totalMissingBefore} \u2192 ${result.totalMissingAfter}`);
  } catch (err) {
    result.errors.push(`IdResolver\u5F02\u5E38: ${err.message}`);
    log37.warn(`\u5F02\u5E38: ${err.message}`);
  } finally {
    if (directConn) {
      try {
        directConn.release();
      } catch (_) {
      }
    }
  }
  return result;
}
async function resolveKeywordIds(accountId, conn, result) {
  const [missingKws] = await conn.execute(
    `SELECT k.id, k.internal_ad_group_id, k.keywordText, k.matchType, k.bid, k.keywordStatus
     FROM keywords k
     INNER JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
     INNER JOIN campaigns c ON ag.campaignId = c.campaignId
     WHERE c.accountId = ? AND k.keywordId IS NULL`,
    [accountId]
  );
  if (missingKws.length === 0) {
    log37.debug(`Keywords: \u8BE5\u8D26\u53F7\u4E0B\u6240\u6709\u5173\u952E\u8BCD\u5747\u5DF2\u6709Amazon keywordId`);
    return;
  }
  result.totalMissingBefore += missingKws.length;
  log37.info(`Keywords: \u53D1\u73B0${missingKws.length}\u4E2A\u5173\u952E\u8BCD\u7F3A\u5C11Amazon keywordId`);
  const groupedByAdGroup = /* @__PURE__ */ new Map();
  for (const kw of missingKws) {
    const group = groupedByAdGroup.get(kw.internal_ad_group_id) || [];
    group.push(kw);
    groupedByAdGroup.set(kw.internal_ad_group_id, group);
  }
  log37.debug(`Keywords: \u5206\u5E03\u5728${groupedByAdGroup.size}\u4E2AadGroup\u4E2D`);
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    result.errors.push(`\u65E0\u6CD5\u83B7\u53D6\u8D26\u53F7${accountId}\u7684API\u670D\u52A1`);
    result.keywordsFailed = missingKws.length;
    return;
  }
  for (const [adGroupLocalId, kwsInGroup] of groupedByAdGroup) {
    try {
      const [agRows] = await conn.execute(
        "SELECT id, adGroupId as adGroupId FROM ad_groups WHERE id = ? LIMIT 1",
        [adGroupLocalId]
      );
      if (!agRows[0] || !agRows[0].adGroupId) {
        log37.warn(`adGroup id=${adGroupLocalId} \u7F3A\u5C11Amazon adGroupId`);
        result.keywordsFailed += kwsInGroup.length;
        continue;
      }
      const amazonAdGroupId = Number(agRows[0].adGroupId);
      let adGroupCampaignType = "sp_manual";
      try {
        const [agCampRows] = await conn.execute(
          `SELECT c.campaignType FROM campaigns c
           INNER JOIN ad_groups ag ON ag.campaignId = c.campaignId
           WHERE ag.id = ? LIMIT 1`,
          [adGroupLocalId]
        );
        if (agCampRows.length > 0 && agCampRows[0].campaignType) {
          adGroupCampaignType = agCampRows[0].campaignType;
        }
      } catch (_) {
      }
      const isAdGroupSb = adGroupCampaignType === "sb";
      const amazonKeywords = isAdGroupSb ? await syncService.client.listSbKeywords(String(amazonAdGroupId)) : await syncService.client.listSpKeywords(amazonAdGroupId);
      if (isAdGroupSb) {
        log37.info(`[IdResolver] v224: SB\u5E7F\u544A\u7EC4 adGroup=${adGroupLocalId}(Amazon:${amazonAdGroupId}): \u4F7F\u7528SB API\u67E5\u627E\u5173\u952E\u8BCD, \u627E\u5230${amazonKeywords.length}\u4E2A`);
      }
      log37.debug(`adGroup=${adGroupLocalId}(Amazon:${amazonAdGroupId}): Amazon\u8FD4\u56DE${amazonKeywords.length}\u4E2Akeywords, \u672C\u5730\u7F3A\u5931${kwsInGroup.length}\u4E2A`);
      const amazonKwMap = /* @__PURE__ */ new Map();
      for (const ak of amazonKeywords) {
        const key = `${ak.keywordText?.toLowerCase()}|${ak.matchType?.toLowerCase()}`;
        amazonKwMap.set(key, String(ak.keywordId));
      }
      const hasProductTargets = await adGroupHasProductTargets(adGroupLocalId, conn);
      if (hasProductTargets) {
        log37.info(`\u26A0\uFE0F adGroup=${adGroupLocalId}: \u5E7F\u544A\u7EC4\u5DF2\u6709product targets\uFF0C\u6E05\u7406${kwsInGroup.length}\u4E2A\u65E0\u6548keyword\u8BB0\u5F55`);
        for (const kw of kwsInGroup) {
          await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [kw.id]);
          result.keywordsCleanedUp++;
        }
        continue;
      }
      const toCreate = [];
      for (const kw of kwsInGroup) {
        if (isAsinSearchTerm(kw.keywordText || "")) {
          log37.debug(`\u26A0\uFE0F \u6E05\u7406ASIN\u683C\u5F0F\u5173\u952E\u8BCD id=${kw.id} "${kw.keywordText}"`);
          await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [kw.id]);
          result.keywordsCleanedUp++;
          continue;
        }
        const key = `${kw.keywordText?.toLowerCase()}|${kw.matchType?.toLowerCase()}`;
        const amazonKeywordId = amazonKwMap.get(key);
        if (amazonKeywordId) {
          let resolvedCampaignId = "";
          try {
            const [campLookup] = await conn.execute(
              `SELECT c.campaignId FROM campaigns c INNER JOIN ad_groups ag ON ag.campaignId = c.campaignId WHERE ag.id = ? LIMIT 1`,
              // @ts-ignore
              [adGroupLocalId]
            );
            resolvedCampaignId = campLookup[0]?.campaignId || "";
          } catch (_) {
          }
          try {
            await conn.execute(
              `UPDATE keywords SET keywordId = ?,
               // @ts-ignore
               accountId = COALESCE(accountId, ?),
               campaignId = COALESCE(campaignId, ?)
               WHERE id = ? AND keywordId IS NULL`,
              // @ts-ignore
              [amazonKeywordId, accountId, resolvedCampaignId || null, kw.id]
            );
            result.keywordsResolved++;
            log37.debug(`\u2705 v357: \u56DE\u586Bkeyword id=${kw.id} "${kw.keywordText?.substring(0, 25)}" \u2192 keywordId=${amazonKeywordId}, accountId=${accountId}`);
          } catch (updateErr) {
            if (updateErr.code === "ER_DUP_ENTRY" || updateErr.errno === 1062) {
              await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [kw.id]);
              result.keywordsCleanedUp++;
              log37.debug(`\u{1F9F9} \u6E05\u7406\u91CD\u590Dkeyword id=${kw.id} (keywordId=${amazonKeywordId}\u5DF2\u5B58\u5728)`);
            } else {
              result.keywordsFailed++;
              log37.warn(`\u274C \u56DE\u586Bkeyword id=${kw.id}\u5931\u8D25: ${updateErr.message}`);
            }
          }
        } else {
          toCreate.push(kw);
        }
      }
      if (toCreate.length > 0) {
        log37.info(`adGroup=${adGroupLocalId}: ${toCreate.length}\u4E2A\u5173\u952E\u8BCD\u9700\u8981\u5728Amazon\u521B\u5EFA`);
        const [campRows] = await conn.execute(
          `SELECT c.campaignId, c.targetingType FROM campaigns c
           INNER JOIN ad_groups ag ON ag.campaignId = c.campaignId
           WHERE ag.id = ? LIMIT 1`,
          [adGroupLocalId]
        );
        const amazonCampaignId = campRows[0]?.campaignId ? Number(campRows[0].campaignId) : null;
        const campaignTargetingType = campRows[0]?.targetingType || "manual";
        if (isAdGroupSb) {
          log37.info(`[IdResolver] v224: SB\u5E7F\u544A\u7EC4 adGroup=${adGroupLocalId}: ${toCreate.length}\u4E2A\u5173\u952E\u8BCD\u5728Amazon\u4E0A\u4E0D\u5B58\u5728\uFF0CSB\u5E7F\u544A\u6D3B\u52A8\u4E0D\u652F\u6301API\u521B\u5EFA\u5173\u952E\u8BCD\uFF0C\u8DF3\u8FC7`);
          result.keywordsFailed += toCreate.length;
        } else if (!canAddPositiveKeyword(campaignTargetingType)) {
          log37.info(`\u26A0\uFE0F adGroup=${adGroupLocalId} \u5C5E\u4E8Eauto-targeting\u5E7F\u544A\u6D3B\u52A8\uFF0C\u8DF3\u8FC7${toCreate.length}\u4E2A\u6B63\u9762\u5173\u952E\u8BCD\u521B\u5EFA\uFF08\u81EA\u52A8\u5E7F\u544A\u53EA\u80FD\u6DFB\u52A0\u5426\u5B9A\u5173\u952E\u8BCD\uFF09`);
          for (const kw of toCreate) {
            await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [kw.id]);
            result.keywordsCleanedUp++;
          }
        } else if (amazonCampaignId) {
          const validatedBatch = [];
          for (const kw of toCreate) {
            const validation = sanitizeAndValidateKeyword(kw.keywordText || "", "positive");
            if (validation.isValid) {
              kw.keywordText = validation.sanitizedText;
              validatedBatch.push(kw);
            } else {
              log37.debug(`\u26A0\uFE0F \u5173\u952E\u8BCD\u6821\u9A8C\u4E0D\u901A\u8FC7 id=${kw.id} "${kw.keywordText?.substring(0, 30)}": ${validation.reasonMessage}`);
              await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [kw.id]);
              result.keywordsCleanedUp++;
            }
          }
          if (validatedBatch.length === 0) {
            log37.info(`adGroup=${adGroupLocalId}: \u6240\u6709\u5173\u952E\u8BCD\u6821\u9A8C\u4E0D\u901A\u8FC7\uFF0C\u8DF3\u8FC7\u521B\u5EFA`);
          }
          const batchSize = 25;
          for (let i = 0; i < validatedBatch.length; i += batchSize) {
            const batch = validatedBatch.slice(i, i + batchSize);
            try {
              const createResults = await syncService.client.createSpKeywords(
                // @ts-ignore
                batch.map((kw) => ({
                  campaignId: amazonCampaignId,
                  adGroupId: amazonAdGroupId,
                  keywordText: kw.keywordText,
                  // @ts-ignore
                  matchType: kw.matchType || "broad",
                  // @ts-ignore
                  bid: parseFloat(kw.bid || "1.00"),
                  state: kw.keywordStatus === "paused" ? "paused" : "enabled"
                }))
              );
              const createdKeywords = createResults.createdKeywords || createResults;
              for (let j = 0; j < createdKeywords.length; j++) {
                const created = createdKeywords[j];
                const original = batch[j];
                if (created.code === "SUCCESS" && created.keywordId) {
                  try {
                    await conn.execute(
                      `UPDATE keywords SET keywordId = ?,
                       // @ts-ignore
                       accountId = COALESCE(accountId, ?),
                       campaignId = COALESCE(campaignId, ?)
                       // @ts-ignore
                       WHERE id = ? AND keywordId IS NULL`,
                      // @ts-ignore
                      [String(created.keywordId), accountId, String(amazonCampaignId), original.id]
                    );
                    result.keywordsCreated++;
                    log37.info(`\u2705 v357: \u521B\u5EFAkeyword id=${original.id} "${original.keywordText?.substring(0, 25)}" \u2192 keywordId=${created.keywordId}, accountId=${accountId}, campaignId=${amazonCampaignId}`);
                  } catch (upErr) {
                    if (upErr.code === "ER_DUP_ENTRY" || upErr.errno === 1062) {
                      await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [original.id]);
                      result.keywordsCleanedUp++;
                    } else {
                      result.keywordsFailed++;
                    }
                  }
                } else {
                  let resolved = false;
                  const [existing] = await conn.execute(
                    `SELECT id, keywordId FROM keywords WHERE internal_ad_group_id = ? AND keywordText = ? AND matchType = ? AND keywordId IS NOT NULL LIMIT 1`,
                    // @ts-ignore
                    [original.internal_ad_group_id, original.keywordText, original.matchType]
                  );
                  if (existing.length > 0) {
                    await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [original.id]);
                    result.keywordsCleanedUp++;
                    log37.debug(`\u{1F9F9} \u6E05\u7406\u91CD\u590Dkeyword id=${original.id} (\u5DF2\u6709\u6709\u6548\u8BB0\u5F55id=${existing[0].id})`);
                    resolved = true;
                  }
                  if (!resolved) {
                    try {
                      const amazonKeywords2 = isAdGroupSb ? await syncService.client.listSbKeywords(String(amazonAdGroupId)) : await syncService.client.listSpKeywords(Number(amazonAdGroupId));
                      const matchedKw = amazonKeywords2.find(
                        (ak) => (
                          // @ts-ignore
                          ak.keywordText?.toLowerCase() === original.keywordText?.toLowerCase() && // @ts-ignore
                          ak.matchType?.toUpperCase() === (original.matchType || "broad").toUpperCase()
                        )
                      );
                      if (matchedKw && matchedKw.keywordId) {
                        await conn.execute(
                          `UPDATE keywords SET keywordId = ?,
                           accountId = COALESCE(accountId, ?),
                           campaignId = COALESCE(campaignId, ?)
                           WHERE id = ? AND keywordId IS NULL`,
                          // @ts-ignore
                          [String(matchedKw.keywordId), accountId, String(amazonCampaignId), original.id]
                        );
                        result.keywordsCreated++;
                        log37.debug(`\u2705 v357: \u4ECEAmazon\u56DE\u586Bkeyword id=${original.id} "${original.keywordText?.substring(0, 25)}" \u2192 keywordId=${matchedKw.keywordId}, accountId=${accountId}`);
                        resolved = true;
                      }
                    } catch (lookupErr) {
                      log37.warn(`\u26A0\uFE0F Amazon\u5173\u952E\u8BCD\u67E5\u8BE2\u5931\u8D25: ${lookupErr.message}`);
                    }
                  }
                  if (!resolved) {
                    result.keywordsFailed++;
                    const errDetail = created.details || created.code || "Unknown";
                    log37.warn(`\u274C \u521B\u5EFAkeyword\u5931\u8D25 id=${original.id} "${original.keywordText?.substring(0, 25)}": ${errDetail}`);
                  }
                }
              }
            } catch (createErr) {
              log37.warn(`\u274C \u6279\u91CF\u521B\u5EFAkeywords\u5F02\u5E38: ${createErr.message}`);
              result.keywordsFailed += batch.length;
            }
            if (i + batchSize < validatedBatch.length) {
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        } else {
          log37.warn(`adGroup=${adGroupLocalId} \u65E0\u6CD5\u83B7\u53D6Amazon campaignId`);
          result.keywordsFailed += toCreate.length;
        }
      }
    } catch (agErr) {
      log37.warn(`adGroup=${adGroupLocalId}\u5904\u7406\u5F02\u5E38: ${agErr.message}`);
      result.keywordsFailed += kwsInGroup.length;
    }
  }
}
async function resolveProductTargetIds(accountId, conn, result) {
  const [missingPts] = await conn.execute(
    `SELECT pt.id, pt.internal_ad_group_id, pt.targetExpression, pt.targetValue, pt.target_match_type as targetMatchType
     FROM product_targets pt
     INNER JOIN ad_groups ag ON pt.internal_ad_group_id = ag.id
     INNER JOIN campaigns c ON ag.campaignId = c.campaignId
     WHERE c.accountId = ? AND pt.targetId IS NULL`,
    [accountId]
  );
  if (missingPts.length === 0) {
    log37.debug(`ProductTargets: \u8BE5\u8D26\u53F7\u4E0B\u6240\u6709product_targets\u5747\u5DF2\u6709Amazon targetId`);
    return;
  }
  result.totalMissingBefore += missingPts.length;
  log37.info(`ProductTargets: \u53D1\u73B0${missingPts.length}\u4E2Aproduct_targets\u7F3A\u5C11Amazon targetId`);
  const ptGroupedByAdGroup = /* @__PURE__ */ new Map();
  for (const pt of missingPts) {
    const group = ptGroupedByAdGroup.get(pt.internal_ad_group_id) || [];
    group.push(pt);
    ptGroupedByAdGroup.set(pt.internal_ad_group_id, group);
  }
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    result.errors.push(`\u65E0\u6CD5\u83B7\u53D6\u8D26\u53F7${accountId}\u7684API\u670D\u52A1`);
    result.productTargetsFailed = missingPts.length;
    return;
  }
  for (const [adGroupLocalId, ptsInGroup] of ptGroupedByAdGroup) {
    try {
      const [agRows] = await conn.execute(
        "SELECT id, adGroupId as adGroupId FROM ad_groups WHERE id = ? LIMIT 1",
        [adGroupLocalId]
      );
      if (!agRows[0] || !agRows[0].adGroupId) {
        result.productTargetsFailed += ptsInGroup.length;
        continue;
      }
      const amazonAdGroupId = Number(agRows[0].adGroupId);
      const amazonTargets = await syncService.client.listSpProductTargets(amazonAdGroupId);
      log37.debug(`adGroup=${adGroupLocalId}(Amazon:${amazonAdGroupId}): Amazon\u8FD4\u56DE${amazonTargets.length}\u4E2Atargets, \u672C\u5730\u7F3A\u5931${ptsInGroup.length}\u4E2A`);
      const amazonPtMap = /* @__PURE__ */ new Map();
      for (const at of amazonTargets) {
        const atAny = at;
        const expr = JSON.stringify(atAny.expression || atAny.targetingClause?.expression || []);
        amazonPtMap.set(expr, String(at.targetId));
        if (atAny.resolvedExpression) {
          amazonPtMap.set(JSON.stringify(atAny.resolvedExpression), String(at.targetId));
        }
      }
      for (const pt of ptsInGroup) {
        let amazonTargetId;
        if (pt.targetExpression) {
          amazonTargetId = amazonPtMap.get(pt.targetExpression);
        }
        if (!amazonTargetId && pt.targetValue) {
          for (const at of amazonTargets) {
            const atAny2 = at;
            const exprStr = JSON.stringify(atAny2.expression || atAny2.targetingClause?.expression || []);
            if (exprStr.includes(pt.targetValue)) {
              amazonTargetId = String(at.targetId);
              break;
            }
          }
        }
        if (amazonTargetId) {
          try {
            await conn.execute(
              "UPDATE product_targets SET targetId = ? WHERE id = ? AND targetId IS NULL",
              [amazonTargetId, pt.id]
            );
            result.productTargetsResolved++;
            log37.debug(`\u2705 \u56DE\u586Bproduct_target id=${pt.id} \u2192 targetId=${amazonTargetId}`);
          } catch (updateErr) {
            if (updateErr.code === "ER_DUP_ENTRY" || updateErr.errno === 1062) {
              await conn.execute("DELETE FROM product_targets WHERE id = ? AND targetId IS NULL", [pt.id]);
              result.productTargetsResolved++;
              log37.debug(`\u{1F9F9} \u6E05\u7406\u91CD\u590Dproduct_target id=${pt.id}`);
            } else {
              result.productTargetsFailed++;
            }
          }
        } else {
          const [existing] = await conn.execute(
            `SELECT id FROM product_targets WHERE internal_ad_group_id = ? AND targetValue = ? AND targetId IS NOT NULL LIMIT 1`,
            [pt.internal_ad_group_id, pt.targetValue || ""]
          );
          if (existing.length > 0) {
            await conn.execute("DELETE FROM product_targets WHERE id = ? AND targetId IS NULL", [pt.id]);
            result.productTargetsResolved++;
          } else {
            result.productTargetsFailed++;
          }
        }
      }
    } catch (agErr) {
      log37.warn(`PT adGroup=${adGroupLocalId}\u5904\u7406\u5F02\u5E38: ${agErr.message}`);
      result.productTargetsFailed += ptsInGroup.length;
    }
  }
}
async function resolveKeywordIdOnDemand(accountId, keywordLocalId) {
  let conn = null;
  try {
    conn = await getDirectConnection();
    const [kwRows] = await conn.execute(
      `SELECT k.id, k.internal_ad_group_id, k.keywordText, k.matchType, k.bid, k.keywordStatus,
              ag.adGroupId AS amazonAdGroupId, c.campaignId AS amazonCampaignId
       FROM keywords k
       // @ts-ignore
       INNER JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
       INNER JOIN campaigns c ON ag.campaignId = c.campaignId
       // @ts-ignore
       WHERE k.id = ? AND k.keywordId IS NULL`,
      // @ts-ignore
      [keywordLocalId]
    );
    if (kwRows.length === 0) return null;
    const kw = kwRows[0];
    if (!kw.amazonAdGroupId) return null;
    if (isAsinSearchTerm(kw.keywordText || "")) {
      log37.debug(`\u26A0\uFE0F \u5373\u65F6\u6E05\u7406ASIN\u683C\u5F0F\u5173\u952E\u8BCD id=${keywordLocalId} "${kw.keywordText}"`);
      await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [keywordLocalId]);
      return null;
    }
    const hasProductTargets = await adGroupHasProductTargets(kw.internal_ad_group_id, conn);
    if (hasProductTargets) {
      log37.debug(`\u26A0\uFE0F \u5373\u65F6\u6E05\u7406: keyword id=${keywordLocalId} \u5E7F\u544A\u7EC4\u5DF2\u6709product targets`);
      await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [keywordLocalId]);
      return null;
    }
    const syncService = await getAmazonSyncService(accountId);
    if (!syncService) return null;
    let campaignType = "sp_manual";
    try {
      const [campTypeRows] = await conn.execute(
        "SELECT campaignType FROM campaigns WHERE campaignId = ? LIMIT 1",
        // @ts-ignore
        [String(kw.amazonCampaignId)]
      );
      if (campTypeRows.length > 0 && campTypeRows[0].campaignType) {
        campaignType = campTypeRows[0].campaignType;
      }
    } catch (_) {
    }
    const isSbCampaign = campaignType === "sb";
    const amazonAdGroupId = Number(kw.amazonAdGroupId);
    const amazonKeywords = isSbCampaign ? await syncService.client.listSbKeywords(String(amazonAdGroupId)) : await syncService.client.listSpKeywords(amazonAdGroupId);
    if (isSbCampaign) {
      log37.info(`[IdResolver] v224: SB\u5173\u952E\u8BCDID\u89E3\u6790 - \u4F7F\u7528SB API, adGroupId=${amazonAdGroupId}, \u627E\u5230${amazonKeywords.length}\u4E2A\u5173\u952E\u8BCD`);
    }
    const key = `${kw.keywordText?.toLowerCase()}|${kw.matchType?.toLowerCase()}`;
    for (const ak of amazonKeywords) {
      const akKey = `${ak.keywordText?.toLowerCase()}|${ak.matchType?.toLowerCase()}`;
      if (akKey === key) {
        const amazonKeywordId = String(ak.keywordId);
        try {
          await conn.execute(
            // @ts-ignore
            "UPDATE keywords SET keywordId = ? WHERE id = ? AND keywordId IS NULL",
            // @ts-ignore
            [amazonKeywordId, keywordLocalId]
          );
          log37.debug(`\u2705 \u5373\u65F6\u56DE\u586Bkeyword id=${keywordLocalId} \u2192 keywordId=${amazonKeywordId}`);
          return amazonKeywordId;
        } catch (upErr) {
          if (upErr.code === "ER_DUP_ENTRY" || upErr.errno === 1062) {
            await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [keywordLocalId]);
          }
          return null;
        }
      }
    }
    const amazonCampaignId = Number(kw.amazonCampaignId);
    if (amazonCampaignId) {
      const [campTypeRows] = await conn.execute(
        "SELECT targetingType FROM campaigns WHERE campaignId = ? LIMIT 1",
        // @ts-ignore
        [String(kw.amazonCampaignId)]
      );
      const campTargetingType = campTypeRows[0]?.targetingType || "manual";
      if (!canAddPositiveKeyword(campTargetingType)) {
        log37.info(`\u26A0\uFE0F \u5373\u65F6\u521B\u5EFA\u62E6\u622A: keyword id=${keywordLocalId} \u5C5E\u4E8Eauto-targeting\u5E7F\u544A\u6D3B\u52A8\uFF0C\u4E0D\u80FD\u6DFB\u52A0\u6B63\u9762\u5173\u952E\u8BCD`);
        await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [keywordLocalId]);
        return null;
      }
      const kwValidation = sanitizeAndValidateKeyword(kw.keywordText || "", "positive");
      if (!kwValidation.isValid) {
        log37.info(`\u26A0\uFE0F \u5373\u65F6\u521B\u5EFA\u62E6\u622A: keyword id=${keywordLocalId} "${kw.keywordText?.substring(0, 30)}" \u6821\u9A8C\u4E0D\u901A\u8FC7: ${kwValidation.reasonMessage}`);
        await conn.execute("DELETE FROM keywords WHERE id = ? AND keywordId IS NULL", [keywordLocalId]);
        return null;
      }
      if (isSbCampaign) {
        log37.info(`[IdResolver] v224: SB\u5173\u952E\u8BCD id=${keywordLocalId} \u5728Amazon\u4E0A\u4E0D\u5B58\u5728\uFF0CSB\u5E7F\u544A\u6D3B\u52A8\u4E0D\u652F\u6301API\u521B\u5EFA\u5173\u952E\u8BCD`);
        return null;
      }
      try {
        const createResults = await syncService.client.createSpKeywords([{
          campaignId: amazonCampaignId,
          adGroupId: amazonAdGroupId,
          keywordText: kwValidation.sanitizedText,
          // @ts-ignore
          matchType: kw.matchType || "broad",
          // @ts-ignore
          bid: parseFloat(kw.bid || "1.00"),
          // @ts-ignore
          state: kw.keywordStatus === "paused" ? "paused" : "enabled"
        }]);
        const createdKws = createResults.createdKeywords || createResults;
        if (createdKws[0]?.code === "SUCCESS" && createdKws[0]?.keywordId) {
          const newKeywordId = String(createdKws[0].keywordId);
          await conn.execute(
            `UPDATE keywords SET keywordId = ?,
             accountId = COALESCE(accountId, ?),
             campaignId = COALESCE(campaignId, ?)
             WHERE id = ? AND keywordId IS NULL`,
            [newKeywordId, accountId, String(amazonCampaignId), keywordLocalId]
          );
          log37.info(`\u2705 v357: \u5373\u65F6\u521B\u5EFAkeyword id=${keywordLocalId} \u2192 keywordId=${newKeywordId}, accountId=${accountId}`);
          return newKeywordId;
        }
      } catch (createErr) {
        log37.warn(`\u5373\u65F6\u521B\u5EFAkeyword\u5931\u8D25: ${createErr.message}`);
      }
    }
    return null;
  } catch (err) {
    log37.warn(`resolveKeywordIdOnDemand\u5F02\u5E38: ${err.message}`);
    return null;
  } finally {
    if (conn) {
      try {
        conn.release();
      } catch (_) {
      }
    }
  }
}
async function resolveProductTargetIdOnDemand(accountId, ptLocalId) {
  let conn = null;
  try {
    conn = await getDirectConnection();
    const [ptRows] = await conn.execute(
      `SELECT pt.id, pt.internal_ad_group_id, pt.targetExpression, pt.targetValue,
              ag.adGroupId AS amazonAdGroupId
       FROM product_targets pt
       INNER JOIN ad_groups ag ON pt.internal_ad_group_id = ag.id
       INNER JOIN campaigns c ON ag.campaignId = c.campaignId
       WHERE pt.id = ? AND pt.targetId IS NULL`,
      [ptLocalId]
    );
    if (ptRows.length === 0) return null;
    const pt = ptRows[0];
    if (!pt.amazonAdGroupId) return null;
    const syncService = await getAmazonSyncService(accountId);
    if (!syncService) return null;
    const amazonAdGroupId = Number(pt.amazonAdGroupId);
    const amazonTargets = await syncService.client.listSpProductTargets(amazonAdGroupId);
    for (const at of amazonTargets) {
      const atAny = at;
      const exprStr = JSON.stringify(atAny.expression || atAny.targetingClause?.expression || []);
      let matched = false;
      if (pt.targetExpression && exprStr === pt.targetExpression) {
        matched = true;
      } else if (pt.targetValue && exprStr.includes(pt.targetValue)) {
        matched = true;
      }
      if (matched) {
        const amazonTargetId = String(at.targetId);
        try {
          await conn.execute(
            "UPDATE product_targets SET targetId = ? WHERE id = ? AND targetId IS NULL",
            [amazonTargetId, ptLocalId]
          );
          log37.debug(`\u2705 \u5373\u65F6\u56DE\u586Bproduct_target id=${ptLocalId} \u2192 targetId=${amazonTargetId}`);
          return amazonTargetId;
        } catch (upErr) {
          if (upErr.code === "ER_DUP_ENTRY" || upErr.errno === 1062) {
            await conn.execute("DELETE FROM product_targets WHERE id = ? AND targetId IS NULL", [ptLocalId]);
          }
          return null;
        }
      }
    }
    return null;
  } catch (err) {
    log37.warn(`resolveProductTargetIdOnDemand\u5F02\u5E38: ${err.message}`);
    return null;
  } finally {
    if (conn) {
      try {
        conn.release();
      } catch (_) {
      }
    }
  }
}
var log37;
var init_amazonIdResolver = __esm({
  "server/services/amazonIdResolver.ts"() {
    "use strict";
    init_syncServiceProvider();
    init_db2();
    init_keywordValidator();
    init_logger();
    log37 = createModuleLogger("IdResolver");
    __name(ensureAmazonIdsReady, "ensureAmazonIdsReady");
    __name(resolveKeywordIds, "resolveKeywordIds");
    __name(resolveProductTargetIds, "resolveProductTargetIds");
    __name(resolveKeywordIdOnDemand, "resolveKeywordIdOnDemand");
    __name(resolveProductTargetIdOnDemand, "resolveProductTargetIdOnDemand");
  }
});

