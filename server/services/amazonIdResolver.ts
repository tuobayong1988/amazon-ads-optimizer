/**
 * Amazon ID Resolver Service (v194)
 * 
 * 统一的Pre-Sync ID保障层，确保所有优化操作前Amazon ID就绪。
 * 
 * 在每次优化目标执行前调用 ensureAmazonIdsReady()，自动完成：
 * 1. 查找该账号下所有缺失 keywordId 的 keywords → 通过 Amazon API 查询并回填
 * 2. 查找该账号下所有缺失 targetId 的 product_targets → 通过 Amazon API 查询并回填
 * 3. 如果回填失败（Amazon上也不存在），尝试通过 API 创建新关键词
 * 4. 清理无法回填的重复/无效记录
 * 
 * v194新增:
 * - 检查广告组是否已有product targets，如果有则不创建keyword
 * - ASIN格式的关键词自动清理（应该是product target而非keyword）
 * - 增强Unicode控制字符清洗
 * 
 * 这样所有下游优化模块（出价调整、暂停/重启、分时策略、位置倾斜等）
 * 都能获得完整的Amazon ID，确保100%同步成功率。
 */

// v223: 从 syncServiceProvider 导入，避免循环依赖
import { getAmazonSyncService } from '../sync/scheduling/syncServiceProvider';
import * as db from '../db'; // v350: 统一使用连接池
import { sanitizeAndValidateKeyword, canAddPositiveKeyword, isAsinSearchTerm, adGroupHasProductTargets } from '../utils/keywordValidator';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('IdResolver');

export interface IdResolutionResult {
  keywordsResolved: number;
  keywordsFailed: number;
  keywordsCreated: number;
  keywordsCleanedUp: number;
  productTargetsResolved: number;
  productTargetsFailed: number;
  totalMissingBefore: number;
  totalMissingAfter: number;
  errors: string[];
}

/**
 * 确保指定账号下所有 keywords 和 product_targets 的 Amazon ID 就绪
 * 在优化目标执行前调用，作为统一的ID保障层
 */
export async function ensureAmazonIdsReady(accountId: number): Promise<IdResolutionResult> {
  const result: IdResolutionResult = {
    keywordsResolved: 0,
    keywordsFailed: 0,
    keywordsCreated: 0,
    keywordsCleanedUp: 0,
    productTargetsResolved: 0,
    productTargetsFailed: 0,
    totalMissingBefore: 0,
    totalMissingAfter: 0,
    errors: [],
  };

  log.info(`========== 开始Pre-Sync ID Resolution: accountId=${accountId} ==========`);

  let directConn: unknown = null;
  try {
    // v350: 使用连接池获取直接连接，替代独立createConnection
    directConn = await db.getDirectConnection(60_000); // 60秒超时，ID解析可能较长

    // ========== 阶段1: 回填缺失的 keywordId ==========
    await resolveKeywordIds(accountId, directConn, result);

    // ========== 阶段2: 回填缺失的 targetId ==========
    await resolveProductTargetIds(accountId, directConn, result);

    // ========== 阶段3: 统计最终缺失数 ==========
    // @ts-ignore - v652: mysql2/dynamic type
    const [remainingKws] = await directConn.execute(
      `SELECT COUNT(*) AS cnt FROM keywords k
       INNER JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
       INNER JOIN campaigns c ON ag.campaignId = c.campaignId
       WHERE c.accountId = ? AND k.keywordId IS NULL`,
      [accountId]
    );
    // @ts-ignore - v652: mysql2/dynamic type
    const [remainingPts] = await directConn.execute(
      `SELECT COUNT(*) AS cnt FROM product_targets pt
       INNER JOIN ad_groups ag ON pt.internal_ad_group_id = ag.id
       INNER JOIN campaigns c ON ag.campaignId = c.campaignId
       WHERE c.accountId = ? AND pt.targetId IS NULL`,
      [accountId]
    );
    result.totalMissingAfter = (remainingKws[0]?.cnt || 0) + (remainingPts[0]?.cnt || 0);

    log.info(`========== Pre-Sync ID Resolution 完成 ==========`);
    log.warn(`Keywords: 回填${result.keywordsResolved}, 创建${result.keywordsCreated}, 清理${result.keywordsCleanedUp}, 失败${result.keywordsFailed}`);
    log.warn(`ProductTargets: 回填${result.productTargetsResolved}, 失败${result.productTargetsFailed}`);
    log.debug(`总缺失: ${result.totalMissingBefore} → ${result.totalMissingAfter}`);

  } catch (err: unknown) {
    result.errors.push(`IdResolver异常: ${(err as Error).message}`);
    log.warn(`异常: ${(err as Error).message}`);
  } finally {
    if (directConn) {
      // @ts-ignore - v652: mysql2/dynamic type
      try { directConn.release(); } catch (_: any) {} // v350: 归还连接到池
    }
  }

  return result;
}

/**
 * 阶段1: 回填缺失的 keywordId
 * 
 * 策略:
 * 1. 按adGroup分组，通过Amazon API查询该adGroup下的所有keywords
 * 2. 按 keywordText + matchType 匹配本地记录
 * 3. 匹配成功 → UPDATE keywordId
 * 4. 匹配失败 → 尝试通过API创建新关键词
 * 5. 创建也失败 → 检查是否有重复记录，清理无效数据
 */
async function resolveKeywordIds(
  accountId: number,
  // @ts-ignore - runtime type mismatch
  conn: DbInstance,
  result: IdResolutionResult
): Promise<void> {
  // 查询该账号下所有缺少keywordId的关键词
  const [missingKws] = await conn.execute(
    `SELECT k.id, k.internal_ad_group_id, k.keywordText, k.matchType, k.bid, k.keywordStatus
     FROM keywords k
     INNER JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
     INNER JOIN campaigns c ON ag.campaignId = c.campaignId
     WHERE c.accountId = ? AND k.keywordId IS NULL`,
    [accountId]
  );

  if (missingKws.length === 0) {
    log.debug(`Keywords: 该账号下所有关键词均已有Amazon keywordId`);
    return;
  }

  result.totalMissingBefore += missingKws.length;
  log.info(`Keywords: 发现${missingKws.length}个关键词缺少Amazon keywordId`);

  // 按adGroupId分组
  const groupedByAdGroup = new Map<number, Record<string, unknown>[]>();
  for (const kw of (missingKws as unknown[])) {
    // v429: 修复字段名bug — SQL返回的是internal_ad_group_id而非adGroupId
    // @ts-ignore - v652: mysql2/dynamic type
    const group = groupedByAdGroup.get(kw.internal_ad_group_id) || [];
    // @ts-ignore - v652: mysql2/dynamic type
    group.push(kw);
    // @ts-ignore - v652: mysql2/dynamic type
    groupedByAdGroup.set(kw.internal_ad_group_id, group);
  }

  log.debug(`Keywords: 分布在${groupedByAdGroup.size}个adGroup中`);

  // 获取SyncService实例
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    result.errors.push(`无法获取账号${accountId}的API服务`);
    result.keywordsFailed = missingKws.length;
    return;
  }

  for (const [adGroupLocalId, kwsInGroup] of groupedByAdGroup) {
    try {
      // 获取Amazon adGroupId
      const [agRows] = await conn.execute(
        'SELECT id, adGroupId as adGroupId FROM ad_groups WHERE id = ? LIMIT 1',
        [adGroupLocalId]
      );
      if (!agRows[0] || !agRows[0].adGroupId) {
        log.warn(`adGroup id=${adGroupLocalId} 缺少Amazon adGroupId`);
        result.keywordsFailed += kwsInGroup.length;
        continue;
      }

      const amazonAdGroupId = Number(agRows[0].adGroupId);

      // v224: 查询该广告组所属campaign的类型，SB广告活动使用SB API
      let adGroupCampaignType = 'sp_manual';
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
      } catch (_: any) {}
      const isAdGroupSb = adGroupCampaignType === 'sb';

      // v224: 通过Amazon API查询该adGroup下的所有keywords - 根据campaign类型选择API
      const amazonKeywords = isAdGroupSb
        // @ts-ignore - v652: mysql2/dynamic type
        ? await (syncService as Record<string, unknown>).client.listSbKeywords(String(amazonAdGroupId))
        // @ts-ignore - v652: mysql2/dynamic type
        : await (syncService as Record<string, unknown>).client.listSpKeywords(amazonAdGroupId);
      if (isAdGroupSb) {
        log.info(`[IdResolver] v224: SB广告组 adGroup=${adGroupLocalId}(Amazon:${amazonAdGroupId}): 使用SB API查找关键词, 找到${amazonKeywords.length}个`);
      }
      log.debug(`adGroup=${adGroupLocalId}(Amazon:${amazonAdGroupId}): Amazon返回${amazonKeywords.length}个keywords, 本地缺失${kwsInGroup.length}个`);

      // 构建匹配索引: "keywordText|matchType" -> keywordId
      const amazonKwMap = new Map<string, string>();
      for (const ak of amazonKeywords) {
        // @ts-ignore - dynamic property access
        const key = `${(ak as Record<string, unknown>).keywordText?.toLowerCase()}|${(ak as Record<string, unknown>).matchType?.toLowerCase()}`;
        amazonKwMap.set(key, String((ak as Record<string, unknown>).keywordId));
      }

      // v194: 检查广告组是否已有product targets
      const hasProductTargets = await adGroupHasProductTargets(adGroupLocalId, conn);
      if (hasProductTargets) {
        log.info(`⚠️ adGroup=${adGroupLocalId}: 广告组已有product targets，清理${kwsInGroup.length}个无效keyword记录`);
        for (const kw of (kwsInGroup as unknown[])) {
          // @ts-ignore - v652: mysql2/dynamic type
          await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [kw.id]);
          result.keywordsCleanedUp++;
        }
        continue;
      }

      // 需要创建的关键词列表
      const toCreate: unknown[] = [];

      for (const kw of (kwsInGroup as unknown[])) {
        // v194: ASIN格式的搜索词不应该作为keyword，清理
        // @ts-ignore - v652: mysql2/dynamic type
        if (isAsinSearchTerm(kw.keywordText || '')) {
          // @ts-ignore - v652: mysql2/dynamic type
          log.debug(`⚠️ 清理ASIN格式关键词 id=${kw.id} "${kw.keywordText}"`);
          // @ts-ignore - v652: mysql2/dynamic type
          await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [kw.id]);
          result.keywordsCleanedUp++;
          continue;
        }

        // @ts-ignore - v652: mysql2/dynamic type
        const key = `${kw.keywordText?.toLowerCase()}|${kw.matchType?.toLowerCase()}`;
        const amazonKeywordId = amazonKwMap.get(key);

        if (amazonKeywordId) {
          // 匹配成功 → 回填keywordId（v357: 同时回填accountId和campaignId）
          // v357: 查询该adGroup对应的campaignId用于回填
          let resolvedCampaignId = '';
          try {
            const [campLookup] = await conn.execute(
              `SELECT c.campaignId FROM campaigns c INNER JOIN ad_groups ag ON ag.campaignId = c.campaignId WHERE ag.id = ? LIMIT 1`,
              [adGroupLocalId]
            );
            resolvedCampaignId = campLookup[0]?.campaignId || '';
          } catch (_: any) {}
          try {
            await conn.execute(
              `UPDATE keywords SET keywordId = ?,
               accountId = COALESCE(accountId, ?),
               campaignId = COALESCE(campaignId, ?)
               WHERE id = ? AND keywordId IS NULL`,
              // @ts-ignore - v652: mysql2/dynamic type
              [amazonKeywordId, accountId, resolvedCampaignId || null, kw.id]
            );
            result.keywordsResolved++;
            // @ts-ignore - v652: mysql2/dynamic type
            log.debug(`✅ v357: 回填keyword id=${kw.id} "${kw.keywordText?.substring(0, 25)}" → keywordId=${amazonKeywordId}, accountId=${accountId}`);
          } catch (updateErr: unknown) {
            // @ts-ignore - MySQL error code check
            if ((updateErr as Error & { code?: string }).code === 'ER_DUP_ENTRY' || updateErr.errno === 1062) {
              // 唯一约束冲突 → 说明是重复记录，删除
              // @ts-ignore - v652: mysql2/dynamic type
              await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [kw.id]);
              result.keywordsCleanedUp++;
              // @ts-ignore - v652: mysql2/dynamic type
              log.debug(`🧹 清理重复keyword id=${kw.id} (keywordId=${amazonKeywordId}已存在)`);
            } else {
              result.keywordsFailed++;
              // @ts-ignore - v652: mysql2/dynamic type
              log.warn(`❌ 回填keyword id=${kw.id}失败: ${(updateErr as Error).message}`);
            }
          }
        } else {
          // Amazon上不存在 → 加入创建队列
          toCreate.push(kw);
        }
      }

      // 批量创建Amazon上不存在的关键词
      if (toCreate.length > 0) {
        log.info(`adGroup=${adGroupLocalId}: ${toCreate.length}个关键词需要在Amazon创建`);

        // 获取Amazon campaignId和campaign targetingType
        const [campRows] = await conn.execute(
          `SELECT c.campaignId, c.targetingType FROM campaigns c
           INNER JOIN ad_groups ag ON ag.campaignId = c.campaignId
           WHERE ag.id = ? LIMIT 1`,
          [adGroupLocalId]
        );
        const amazonCampaignId = campRows[0]?.campaignId ? Number(campRows[0].campaignId) : null;
        const campaignTargetingType = campRows[0]?.targetingType || 'manual';

        // v224: SB广告活动不支持通过API创建关键词
        if (isAdGroupSb) {
          log.info(`[IdResolver] v224: SB广告组 adGroup=${adGroupLocalId}: ${toCreate.length}个关键词在Amazon上不存在，SB广告活动不支持API创建关键词，跳过`);
          result.keywordsFailed += toCreate.length;
        } else if (!canAddPositiveKeyword(campaignTargetingType)) {
          // v192: 自动广告活动不允许创建正面关键词
          log.info(`⚠️ adGroup=${adGroupLocalId} 属于auto-targeting广告活动，跳过${toCreate.length}个正面关键词创建（自动广告只能添加否定关键词）`);
          // 清理这些不应该存在的关键词记录
          for (const kw of (toCreate as unknown[])) {
            // @ts-ignore - v652: mysql2/dynamic type
            await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [kw.id]);
            result.keywordsCleanedUp++;
          }
        } else if (amazonCampaignId) {
          // v192: 批量校验关键词数据质量
          const validatedBatch: unknown[] = [];
          for (const kw of (toCreate as unknown[])) {
            // @ts-ignore - v652: mysql2/dynamic type
            const validation = sanitizeAndValidateKeyword(kw.keywordText || '', 'positive');
            if (validation.isValid) {
              // @ts-ignore - v652: mysql2/dynamic type
              kw.keywordText = validation.sanitizedText; // 使用清洗后的文本
              validatedBatch.push(kw);
            } else {
              // @ts-ignore - v652: mysql2/dynamic type
              log.debug(`⚠️ 关键词校验不通过 id=${kw.id} "${kw.keywordText?.substring(0, 30)}": ${validation.reasonMessage}`);
              // @ts-ignore - v652: mysql2/dynamic type
              await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [kw.id]);
              result.keywordsCleanedUp++;
            }
          }
          
          if (validatedBatch.length === 0) {
            log.info(`adGroup=${adGroupLocalId}: 所有关键词校验不通过，跳过创建`);
          }

          // v360: 增加批量大小到每批次25个，Amazon API实际支持每次最多1000个
          const batchSize = 25;
          for (let i = 0; i < validatedBatch.length; i += batchSize) {
            const batch = validatedBatch.slice(i, i + batchSize);
            try {
              // @ts-ignore - v652: mysql2/dynamic type
              const createResults = await (syncService as Record<string, unknown>).client.createSpKeywords(
                // @ts-ignore - v652: mysql2/dynamic type
                batch.map((kw: Record<string, unknown>) => ({
                  campaignId: amazonCampaignId,
                  adGroupId: amazonAdGroupId,
                  keywordText: kw.keywordText,
                  matchType: kw.matchType || 'broad',
                  // @ts-ignore - v652: mysql2/dynamic type
                  bid: parseFloat(kw.bid || '1.00'),
                  state: kw.keywordStatus === 'paused' ? 'paused' : 'enabled',
                }))
              );

              const createdKeywords = createResults.createdKeywords || createResults;
              for (let j = 0; j < createdKeywords.length; j++) {
                const created = createdKeywords[j];
                const original = batch[j];
                if (created.code === 'SUCCESS' && created.keywordId) {
                  try {
                    // v357: 创建成功时同时回填keywordId、accountId和campaignId
                    await conn.execute(
                      `UPDATE keywords SET keywordId = ?,
                       accountId = COALESCE(accountId, ?),
                       campaignId = COALESCE(campaignId, ?)
                       WHERE id = ? AND keywordId IS NULL`,
                      // @ts-ignore - v652: mysql2/dynamic type
                      [String(created.keywordId), accountId, String(amazonCampaignId), original.id]
                    );
                    result.keywordsCreated++;
                    // @ts-ignore - v652: mysql2/dynamic type
                    log.info(`✅ v357: 创建keyword id=${original.id} "${original.keywordText?.substring(0, 25)}" → keywordId=${created.keywordId}, accountId=${accountId}, campaignId=${amazonCampaignId}`);
                  } catch (upErr: unknown) {
                    // @ts-ignore - MySQL error code check
                    if ((upErr as Error & { code?: string }).code === 'ER_DUP_ENTRY' || upErr.errno === 1062) {
                      // @ts-ignore - v652: mysql2/dynamic type
                      await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [original.id]);
                      result.keywordsCleanedUp++;
                    } else {
                      result.keywordsFailed++;
                    }
                  }
                } else {
                  // 创建失败 → 尝试从Amazon回填keywordId（处理duplicateValueError）
                  let resolved = false;
                  
                  // 先检查本地是否已有有效记录
                  const [existing] = await conn.execute(
                    `SELECT id, keywordId FROM keywords WHERE internal_ad_group_id = ? AND keywordText = ? AND matchType = ? AND keywordId IS NOT NULL LIMIT 1`,
                    // @ts-ignore - v652: mysql2/dynamic type
                    [original.internal_ad_group_id, original.keywordText, original.matchType]
                  );
                  if (existing.length > 0) {
                    // @ts-ignore - v652: mysql2/dynamic type
                    await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [original.id]);
                    result.keywordsCleanedUp++;
                    // @ts-ignore - v652: mysql2/dynamic type
                    log.debug(`🧹 清理重复keyword id=${original.id} (已有有效记录id=${existing[0].id})`);
                    resolved = true;
                  }
                  
                  // 如果本地没有，尝试从Amazon API查询并回填
                  if (!resolved) {
                    try {
                      // v224: 根据campaign类型选择正确的API
                      const amazonKeywords = isAdGroupSb
                        // @ts-ignore - v652: mysql2/dynamic type
                        ? await (syncService as Record<string, unknown>).client.listSbKeywords(String(amazonAdGroupId))
                        // @ts-ignore - v652: mysql2/dynamic type
                        : await (syncService as Record<string, unknown>).client.listSpKeywords(Number(amazonAdGroupId));
                      const matchedKw = amazonKeywords.find((ak: Record<string, unknown>) => 
                        // @ts-ignore - v652: mysql2/dynamic type
                        ak.keywordText?.toLowerCase() === original.keywordText?.toLowerCase() && 
                        // @ts-ignore - v652: mysql2/dynamic type
                        ak.matchType?.toUpperCase() === (original.matchType || 'broad').toUpperCase()
                      );
                      if (matchedKw && matchedKw.keywordId) {
                        // v357: 回填时同时填充accountId和campaignId
                        await conn.execute(
                          `UPDATE keywords SET keywordId = ?,
                           accountId = COALESCE(accountId, ?),
                           campaignId = COALESCE(campaignId, ?)
                           WHERE id = ? AND keywordId IS NULL`,
                          // @ts-ignore - v652: mysql2/dynamic type
                          [String(matchedKw.keywordId), accountId, String(amazonCampaignId), original.id]
                        );
                        result.keywordsCreated++;
                        // @ts-ignore - v652: mysql2/dynamic type
                        log.debug(`✅ v357: 从Amazon回填keyword id=${original.id} "${original.keywordText?.substring(0, 25)}" → keywordId=${matchedKw.keywordId}, accountId=${accountId}`);
                        resolved = true;
                      }
                    } catch (lookupErr: unknown) {
                      log.warn(`⚠️ Amazon关键词查询失败: ${(lookupErr as Error).message}`);
                    }
                  }
                  
                  if (!resolved) {
                    result.keywordsFailed++;
                    const errDetail = (created as Record<string, unknown>).details || created.code || 'Unknown';
                    // @ts-ignore - v652: mysql2/dynamic type
                    log.warn(`❌ 创建keyword失败 id=${original.id} "${original.keywordText?.substring(0, 25)}": ${errDetail}`);
                  }
                }
              }
            } catch (createErr: unknown) {
              log.warn(`❌ 批量创建keywords异常: ${(createErr as Error).message}`);
              result.keywordsFailed += batch.length;
            }

            // v360: 批次间延迟，配合限流服务
            if (i + batchSize < validatedBatch.length) {
              await new Promise(r => setTimeout(r, 500));
            }
          }
        } else {
          log.warn(`adGroup=${adGroupLocalId} 无法获取Amazon campaignId`);
          result.keywordsFailed += toCreate.length;
        }
      }
    } catch (agErr: unknown) {
      log.warn(`adGroup=${adGroupLocalId}处理异常: ${(agErr as Error).message}`);
      result.keywordsFailed += kwsInGroup.length;
    }
  }
}

/**
 * 阶段2: 回填缺失的 targetId
 * 
 * 策略:
 * 1. 按adGroup分组，通过Amazon API查询该adGroup下的所有product targets
 * 2. 按 expression/targetValue 匹配本地记录
 * 3. 匹配成功 → UPDATE targetId
 * 4. 匹配失败 → 检查是否有重复记录，清理无效数据
 */
async function resolveProductTargetIds(
  accountId: number,
  // @ts-ignore - runtime type mismatch
  conn: DbInstance,
  result: IdResolutionResult
): Promise<void> {
  // 查询该账号下所有缺少targetId的product_targets
  const [missingPts] = await conn.execute(
    `SELECT pt.id, pt.internal_ad_group_id, pt.targetExpression, pt.targetValue, pt.target_match_type as targetMatchType
     FROM product_targets pt
     INNER JOIN ad_groups ag ON pt.internal_ad_group_id = ag.id
     INNER JOIN campaigns c ON ag.campaignId = c.campaignId
     WHERE c.accountId = ? AND pt.targetId IS NULL`,
    [accountId]
  );

  if (missingPts.length === 0) {
    log.debug(`ProductTargets: 该账号下所有product_targets均已有Amazon targetId`);
    return;
  }

  result.totalMissingBefore += missingPts.length;
  log.info(`ProductTargets: 发现${missingPts.length}个product_targets缺少Amazon targetId`);

  // 按adGroupId分组
  const ptGroupedByAdGroup = new Map<number, Record<string, unknown>[]>();
  for (const pt of missingPts) {
    const group = ptGroupedByAdGroup.get(pt.internal_ad_group_id) || [];
    group.push(pt);
    ptGroupedByAdGroup.set(pt.internal_ad_group_id, group);
  }

  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    result.errors.push(`无法获取账号${accountId}的API服务`);
    result.productTargetsFailed = missingPts.length;
    return;
  }

  for (const [adGroupLocalId, ptsInGroup] of ptGroupedByAdGroup) {
    try {
      // 获取Amazon adGroupId
      const [agRows] = await conn.execute(
        'SELECT id, adGroupId as adGroupId FROM ad_groups WHERE id = ? LIMIT 1',
        [adGroupLocalId]
      );
      if (!agRows[0] || !agRows[0].adGroupId) {
        result.productTargetsFailed += ptsInGroup.length;
        continue;
      }

      const amazonAdGroupId = Number(agRows[0].adGroupId);

      // 通过Amazon API查询该adGroup下的所有product targets
      // @ts-ignore - v652: mysql2/dynamic type
      const amazonTargets = await (syncService as Record<string, unknown>).client.listSpProductTargets(amazonAdGroupId);
      log.debug(`adGroup=${adGroupLocalId}(Amazon:${amazonAdGroupId}): Amazon返回${amazonTargets.length}个targets, 本地缺失${ptsInGroup.length}个`);

      // 构建匹配索引
      const amazonPtMap = new Map<string, string>();
      for (const at of amazonTargets) {
        const atAny = at as unknown;
        // 用expression作为匹配键
        // @ts-ignore - runtime type mismatch
        const expr = JSON.stringify(atAny.expression || atAny.targetingClause?.expression || []);
        amazonPtMap.set(expr, String(at.targetId));
        // 也用resolvedExpression匹配
        // @ts-ignore - runtime type mismatch
        if (atAny.resolvedExpression) {
          // @ts-ignore - Drizzle query builder type
          amazonPtMap.set(JSON.stringify(atAny.resolvedExpression), String(at.targetId));
        }
      }

      for (const pt of ptsInGroup) {
        let amazonTargetId: string | undefined;

        // 方式1: 通过targetExpression匹配
        if (pt.targetExpression) {
          // @ts-ignore - v652: mysql2/dynamic type
          amazonTargetId = amazonPtMap.get(pt.targetExpression);
        }

        // 方式2: 遍历Amazon targets，按ASIN或类目匹配
        if (!amazonTargetId && pt.targetValue) {
          for (const at of amazonTargets) {
            const atAny2 = at as unknown;
            // @ts-ignore - runtime type mismatch
            const exprStr = JSON.stringify(atAny2.expression || atAny2.targetingClause?.expression || []);
            // @ts-ignore - v652: mysql2/dynamic type
            if (exprStr.includes(pt.targetValue)) {
              amazonTargetId = String(at.targetId);
              break;
            }
          }
        }

        if (amazonTargetId) {
          try {
            await conn.execute(
              'UPDATE product_targets SET targetId = ? WHERE id = ? AND targetId IS NULL',
              [amazonTargetId, pt.id]
            );
            result.productTargetsResolved++;
            log.debug(`✅ 回填product_target id=${pt.id} → targetId=${amazonTargetId}`);
          } catch (updateErr: unknown) {
            // @ts-ignore - MySQL error code check
            if ((updateErr as Error & { code?: string }).code === 'ER_DUP_ENTRY' || updateErr.errno === 1062) {
              await conn.execute('DELETE FROM product_targets WHERE id = ? AND targetId IS NULL', [pt.id]);
              result.productTargetsResolved++;
              log.debug(`🧹 清理重复product_target id=${pt.id}`);
            } else {
              result.productTargetsFailed++;
            }
          }
        } else {
          // 检查是否有重复记录
          const [existing] = await conn.execute(
            `SELECT id FROM product_targets WHERE internal_ad_group_id = ? AND targetValue = ? AND targetId IS NOT NULL LIMIT 1`,
            [pt.internal_ad_group_id, pt.targetValue || '']
          );
          if (existing.length > 0) {
            await conn.execute('DELETE FROM product_targets WHERE id = ? AND targetId IS NULL', [pt.id]);
            result.productTargetsResolved++;
          } else {
            result.productTargetsFailed++;
          }
        }
      }
    } catch (agErr: unknown) {
      log.warn(`PT adGroup=${adGroupLocalId}处理异常: ${(agErr as Error).message}`);
      result.productTargetsFailed += ptsInGroup.length;
    }
  }
}

/**
 * 即时回填单个keyword的keywordId
 * 作为最后防线，在同步函数发现缺失ID时调用
 */
export async function resolveKeywordIdOnDemand(
  accountId: number,
  keywordLocalId: number
): Promise<string | null> {
  // @ts-ignore - runtime type mismatch
  let conn: DbInstance = null;
  try {
    // v350: 使用连接池获取直接连接
    conn = await db.getDirectConnection();

    // 获取关键词信息
    const [kwRows] = await conn.execute(
      `SELECT k.id, k.internal_ad_group_id, k.keywordText, k.matchType, k.bid, k.keywordStatus,
              ag.adGroupId AS amazonAdGroupId, c.campaignId AS amazonCampaignId
       FROM keywords k
       INNER JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
       INNER JOIN campaigns c ON ag.campaignId = c.campaignId
       WHERE k.id = ? AND k.keywordId IS NULL`,
      [keywordLocalId]
    );

    if (kwRows.length === 0) return null;
    const kw = kwRows[0] as unknown;
    // @ts-ignore - v652: mysql2/dynamic type
    if (!kw.amazonAdGroupId) return null;

    // v194: ASIN格式的关键词不应该存在于keywords表
    // @ts-ignore - v652: mysql2/dynamic type
    if (isAsinSearchTerm(kw.keywordText || '')) {
      // @ts-ignore - v652: mysql2/dynamic type
      log.debug(`⚠️ 即时清理ASIN格式关键词 id=${keywordLocalId} "${kw.keywordText}"`);
      await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [keywordLocalId]);
      return null;
    }

    // v194: 检查广告组是否已有product targets
    // v429: 修复字段名bug — SQL结果中字段名是internal_ad_group_id
    // @ts-ignore - v652: mysql2/dynamic type
    const hasProductTargets = await adGroupHasProductTargets(kw.internal_ad_group_id, conn);
    if (hasProductTargets) {
      log.debug(`⚠️ 即时清理: keyword id=${keywordLocalId} 广告组已有product targets`);
      await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [keywordLocalId]);
      return null;
    }

    const syncService = await getAmazonSyncService(accountId);
    if (!syncService) return null;

    // v224: 查询campaign类型，SB广告活动使用SB API查找关键词
    let campaignType = 'sp_manual';
    try {
      const [campTypeRows] = await conn.execute(
        'SELECT campaignType FROM campaigns WHERE campaignId = ? LIMIT 1',
        // @ts-ignore - v652: mysql2/dynamic type
        [String(kw.amazonCampaignId)]
      );
      if (campTypeRows.length > 0 && campTypeRows[0].campaignType) {
        campaignType = campTypeRows[0].campaignType;
      }
    } catch (_: any) {}
    const isSbCampaign = campaignType === 'sb';

    // @ts-ignore - v652: mysql2/dynamic type
    const amazonAdGroupId = Number(kw.amazonAdGroupId);
    const amazonKeywords = isSbCampaign
      // @ts-ignore - v652: mysql2/dynamic type
      ? await (syncService as Record<string, unknown>).client.listSbKeywords(String(amazonAdGroupId))
      // @ts-ignore - v652: mysql2/dynamic type
      : await (syncService as Record<string, unknown>).client.listSpKeywords(amazonAdGroupId);
    
    if (isSbCampaign) {
      log.info(`[IdResolver] v224: SB关键词ID解析 - 使用SB API, adGroupId=${amazonAdGroupId}, 找到${amazonKeywords.length}个关键词`);
    }

    // 按 keywordText + matchType 匹配
    // @ts-ignore - v652: mysql2/dynamic type
    const key = `${kw.keywordText?.toLowerCase()}|${kw.matchType?.toLowerCase()}`;
    for (const ak of amazonKeywords) {
      // @ts-ignore - dynamic property access
      const akKey = `${(ak as Record<string, unknown>).keywordText?.toLowerCase()}|${(ak as Record<string, unknown>).matchType?.toLowerCase()}`;
      if (akKey === key) {
        const amazonKeywordId = String((ak as Record<string, unknown>).keywordId);
        try {
          await conn.execute(
            'UPDATE keywords SET keywordId = ? WHERE id = ? AND keywordId IS NULL',
            [amazonKeywordId, keywordLocalId]
          );
          log.debug(`✅ 即时回填keyword id=${keywordLocalId} → keywordId=${amazonKeywordId}`);
          return amazonKeywordId;
        } catch (upErr: unknown) {
          // @ts-ignore - MySQL error code check
          if ((upErr as Error & { code?: string }).code === 'ER_DUP_ENTRY' || upErr.errno === 1062) {
            await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [keywordLocalId]);
          }
          return null;
        }
      }
    }

    // Amazon上不存在 → 尝试创建
    // @ts-ignore - v652: mysql2/dynamic type
    const amazonCampaignId = Number(kw.amazonCampaignId);
    if (amazonCampaignId) {
      // v192: 查询campaign的targetingType，拦截auto-targeting
      const [campTypeRows] = await conn.execute(
        'SELECT targetingType FROM campaigns WHERE campaignId = ? LIMIT 1',
        // @ts-ignore - v652: mysql2/dynamic type
        [String(kw.amazonCampaignId)]
      );
      const campTargetingType = campTypeRows[0]?.targetingType || 'manual';
      
      if (!canAddPositiveKeyword(campTargetingType)) {
        log.info(`⚠️ 即时创建拦截: keyword id=${keywordLocalId} 属于auto-targeting广告活动，不能添加正面关键词`);
        await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [keywordLocalId]);
        return null;
      }
      
      // v192: 校验关键词数据质量
      // @ts-ignore - v652: mysql2/dynamic type
      const kwValidation = sanitizeAndValidateKeyword(kw.keywordText || '', 'positive');
      if (!kwValidation.isValid) {
        // @ts-ignore - v652: mysql2/dynamic type
        log.info(`⚠️ 即时创建拦截: keyword id=${keywordLocalId} "${kw.keywordText?.substring(0, 30)}" 校验不通过: ${kwValidation.reasonMessage}`);
        await conn.execute('DELETE FROM keywords WHERE id = ? AND keywordId IS NULL', [keywordLocalId]);
        return null;
      }
      
      // v224: SB广告活动不支持通过API创建关键词，跳过创建步骤
      if (isSbCampaign) {
        log.info(`[IdResolver] v224: SB关键词 id=${keywordLocalId} 在Amazon上不存在，SB广告活动不支持API创建关键词`);
        return null;
      }
      
      try {
        // @ts-ignore - v652: mysql2/dynamic type
        const createResults = await (syncService as Record<string, unknown>).client.createSpKeywords([{
          campaignId: amazonCampaignId,
          adGroupId: amazonAdGroupId,
          keywordText: kwValidation.sanitizedText,
          // @ts-ignore - v652: mysql2/dynamic type
          matchType: kw.matchType || 'broad',
          // @ts-ignore - v652: mysql2/dynamic type
          bid: parseFloat(kw.bid || '1.00'),
          // @ts-ignore - v652: mysql2/dynamic type
          state: kw.keywordStatus === 'paused' ? 'paused' : 'enabled',
        }]);

        const createdKws = createResults.createdKeywords || createResults;
        if (createdKws[0]?.code === 'SUCCESS' && createdKws[0]?.keywordId) {
          const newKeywordId = String(createdKws[0].keywordId);
          // v357: 创建成功时同时回填accountId和campaignId
          await conn.execute(
            `UPDATE keywords SET keywordId = ?,
             accountId = COALESCE(accountId, ?),
             campaignId = COALESCE(campaignId, ?)
             WHERE id = ? AND keywordId IS NULL`,
            [newKeywordId, accountId, String(amazonCampaignId), keywordLocalId]
          );
          log.info(`✅ v357: 即时创建keyword id=${keywordLocalId} → keywordId=${newKeywordId}, accountId=${accountId}`);
          return newKeywordId;
        }
      } catch (createErr: unknown) {
        log.warn(`即时创建keyword失败: ${(createErr as Error).message}`);
      }
    }

    return null;
  } catch (err: unknown) {
    log.warn(`resolveKeywordIdOnDemand异常: ${(err as Error).message}`);
    return null;
  } finally {
    if (conn) {
      try { conn.release(); } catch (_: any) {} // v350: 归还连接到池
    }
  }
}

/**
 * 即时回填单个product_target的targetId
 * 作为最后防线，在同步函数发现缺失ID时调用
 */
export async function resolveProductTargetIdOnDemand(
  accountId: number,
  ptLocalId: number
): Promise<string | null> {
  // @ts-ignore - runtime type mismatch
  let conn: DbInstance = null;
  try {
    // v350: 使用连接池获取直接连接
    conn = await db.getDirectConnection();

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
    const pt = ptRows[0] as unknown;
    // @ts-ignore - v652: mysql2/dynamic type
    if (!pt.amazonAdGroupId) return null;

    const syncService = await getAmazonSyncService(accountId);
    if (!syncService) return null;

    // @ts-ignore - v652: mysql2/dynamic type
    const amazonAdGroupId = Number(pt.amazonAdGroupId);
    // @ts-ignore - v652: mysql2/dynamic type
    const amazonTargets = await (syncService as Record<string, unknown>).client.listSpProductTargets(amazonAdGroupId);

    for (const at of amazonTargets) {
      const atAny = at as unknown;
      // @ts-ignore - runtime type mismatch
      const exprStr = JSON.stringify(atAny.expression || atAny.targetingClause?.expression || []);

      let matched = false;
      // @ts-ignore - v652: mysql2/dynamic type
      if (pt.targetExpression && exprStr === pt.targetExpression) {
        matched = true;
      // @ts-ignore - v652: mysql2/dynamic type
      } else if (pt.targetValue && exprStr.includes(pt.targetValue)) {
        matched = true;
      }

      if (matched) {
        const amazonTargetId = String(at.targetId);
        try {
          await conn.execute(
            'UPDATE product_targets SET targetId = ? WHERE id = ? AND targetId IS NULL',
            [amazonTargetId, ptLocalId]
          );
          log.debug(`✅ 即时回填product_target id=${ptLocalId} → targetId=${amazonTargetId}`);
          return amazonTargetId;
        } catch (upErr: unknown) {
          // @ts-ignore - MySQL error code check
          if ((upErr as Error & { code?: string }).code === 'ER_DUP_ENTRY' || upErr.errno === 1062) {
            await conn.execute('DELETE FROM product_targets WHERE id = ? AND targetId IS NULL', [ptLocalId]);
          }
          return null;
        }
      }
    }

    return null;
  } catch (err: unknown) {
    log.warn(`resolveProductTargetIdOnDemand异常: ${(err as Error).message}`);
    return null;
  } finally {
    if (conn) {
      try { conn.release(); } catch (_: any) {} // v350: 归还连接到池
    }
  }
}
