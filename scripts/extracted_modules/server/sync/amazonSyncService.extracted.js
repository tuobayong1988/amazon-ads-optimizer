// Extracted from production dist/index.js
// Original module: server/sync/amazonSyncService.ts
// Lines: 1080

var amazonSyncService_exports = {};
__export(amazonSyncService_exports, {
  AmazonSyncService: () => AmazonSyncService,
  flushSearchTermBatch: () => flushSearchTermBatch,
  syncInitialHistoricalData: () => syncInitialHistoricalData
});
async function flushSearchTermBatch(db, batch) {
  if (batch.length === 0) return;
  try {
    await db.insert(searchTerms).values(batch).onDuplicateKeyUpdate({
      set: {
        searchTermImpressions: sql`VALUES(search_term_impressions)`,
        searchTermClicks: sql`VALUES(search_term_clicks)`,
        searchTermSpend: sql`VALUES(search_term_spend)`,
        searchTermSales: sql`VALUES(search_term_sales)`,
        searchTermOrders: sql`VALUES(search_term_orders)`,
        searchTermAcos: sql`VALUES(search_term_acos)`,
        searchTermRoas: sql`VALUES(search_term_roas)`,
        searchTermCtr: sql`VALUES(search_term_ctr)`,
        searchTermCvr: sql`VALUES(search_term_cvr)`,
        searchTermCpc: sql`VALUES(search_term_cpc)`,
        searchTermUnitsOrdered: sql`VALUES(search_term_units_ordered)`,
        searchTermTargetId: sql`VALUES(search_term_target_id)`,
        targetText: sql`VALUES(target_text)`,
        searchTermMatchType: sql`VALUES(search_term_match_type)`,
        sourceMatchType: sql`VALUES(source_match_type)`,
        sourceTargetType: sql`VALUES(source_target_type)`,
        searchTermType: sql`VALUES(search_term_type)`,
        reportEndDate: sql`VALUES(report_end_date)`,
        // v614: 添加campaignType到upsert更新列
        campaignType: sql`VALUES(campaign_type)`,
        updatedAt: sql`VALUES(updated_at)`
      }
    });
  } catch (insertErr) {
    log32.warn(`[v395] \u641C\u7D22\u8BCD\u6279\u91CFUPSERT\u5931\u8D25\uFF0C\u56DE\u9000\u5230\u9010\u6761\u6A21\u5F0F: ${insertErr.message}`);
    for (const row of batch) {
      try {
        await db.insert(searchTerms).values(row).onDuplicateKeyUpdate({
          set: {
            searchTermImpressions: sql`VALUES(search_term_impressions)`,
            searchTermClicks: sql`VALUES(search_term_clicks)`,
            searchTermSpend: sql`VALUES(search_term_spend)`,
            searchTermSales: sql`VALUES(search_term_sales)`,
            searchTermOrders: sql`VALUES(search_term_orders)`,
            searchTermAcos: sql`VALUES(search_term_acos)`,
            searchTermRoas: sql`VALUES(search_term_roas)`,
            searchTermCtr: sql`VALUES(search_term_ctr)`,
            searchTermCvr: sql`VALUES(search_term_cvr)`,
            searchTermCpc: sql`VALUES(search_term_cpc)`,
            searchTermUnitsOrdered: sql`VALUES(search_term_units_ordered)`,
            updatedAt: sql`VALUES(updated_at)`
          }
        });
      } catch (singleErr) {
        log32.debug(`[v395] \u641C\u7D22\u8BCD\u5355\u6761UPSERT\u5931\u8D25: ${singleErr.message}`);
      }
    }
  }
}
async function syncInitialHistoricalData(syncService, accountId, userId) {
  log32.info(`\u5F00\u59CB\u9996\u6B21\u540C\u6B6590\u5929\u5386\u53F2\u6570\u636E (\u8D26\u53F7: ${accountId})`);
  const results = {
    performance: 0
  };
  try {
    results.performance = await syncService.syncPerformanceData(90);
    log32.info(`\u9996\u6B21\u540C\u6B65\u5B8C\u6210: ${results.performance} \u6761\u5386\u53F2\u7EE9\u6548\u8BB0\u5F55`);
  } catch (error48) {
    log32.warn("\u9996\u6B21\u540C\u6B65\u5931\u8D25:", error48);
  }
  return results;
}
var log32, AmazonSyncService;
var init_amazonSyncService = __esm({
  "server/sync/amazonSyncService.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_logger();
    init_amazonAdsApi();
    init_timezone();
    init_syncServiceProvider();
    log32 = createModuleLogger("SyncService");
    AmazonSyncService = class _AmazonSyncService {
      static {
        __name(this, "AmazonSyncService");
      }
      client;
      accountId;
      userId;
      marketplace;
      // 站点代码，用于时区计算
      constructor(client, accountId, userId, marketplace = "US") {
        this.client = client;
        this.accountId = accountId;
        this.userId = userId;
        this.marketplace = marketplace;
        if (client) client.accountId = accountId;
      }
      /**
       * 从数据库加载API凭证并创建同步服务
       */
      static async createFromCredentials(credentials, accountId, userId, marketplace = "US") {
        const apiCredentials = {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region
        };
        const client = createAmazonAdsClient(apiCredentials);
        client.accountId = accountId;
        return new _AmazonSyncService(client, accountId, userId, marketplace);
      }
      /**
       * v402: 完整同步所有数据（三阶段同步策略 + 子任务分解）
       * - init模式: 新账号初始化，同步API支持的最长时间范围（SP 90天/SB 60天/SD 90天）
       * - daily模式: 日常增量，只同步近14天数据（归因期内可能变化的数据），大幅减少API调用
       * - recovery模式: 自愈恢复（宕机/数据异常），同步90天全量数据
       * 
       * v402增强:
       * - 支持按广告类型分解同步（layers参数）
       * - 每个Layer独立错误隔离，失败不影响后续层
       * - 支持重试失败的子任务（retryFailedLayers）
       */
      async syncAll(options) {
        const results = {
          campaigns: 0,
          adGroups: 0,
          keywords: 0,
          targets: 0,
          performance: 0,
          spCampaigns: 0,
          sbCampaigns: 0,
          sdCampaigns: 0,
          _syncDiagnostics: []
        };
        const syncAllStartTime = Date.now();
        let totalSteps = 0;
        let failedSteps = 0;
        const syncMode = options?.syncMode || "daily";
        const DAILY_SYNC_DAYS = 14;
        const FULL_SP_DAYS = 90;
        const FULL_SB_DAYS = 60;
        const FULL_SD_DAYS = 90;
        const isFullSync = syncMode === "init" || syncMode === "recovery";
        const spDays = isFullSync ? FULL_SP_DAYS : DAILY_SYNC_DAYS;
        const sbDays = isFullSync ? FULL_SB_DAYS : DAILY_SYNC_DAYS;
        const sdDays = isFullSync ? FULL_SD_DAYS : DAILY_SYNC_DAYS;
        log32.info(`[syncAll] \u23F1\uFE0F \u8D26\u6237${this.accountId} \u5F00\u59CB${syncMode}\u6A21\u5F0F\u540C\u6B65 (SP=${spDays}\u5929, SB=${sbDays}\u5929, SD=${sdDays}\u5929)`);
        // v577: 认证预检 - 在开始同步前验证API token有效性
        try {
          const preCheckHeaders = await this.client.getHeaders();
          const preCheckResp = await this.client.axiosInstance.get("/v2/profiles", {
            headers: preCheckHeaders,
            timeout: 15000
          });
          log32.info(`[syncAll] v577: 认证预检通过, profileId=${this.client.credentials.profileId}, profiles=${preCheckResp.data?.length || 0}`);
        } catch (preCheckErr) {
          const preCheckStatus = preCheckErr.response?.status;
          if (preCheckStatus === 401 || preCheckStatus === 403) {
            log32.warn(`[syncAll] v577: 认证预检失败(${preCheckStatus}), 账户${this.accountId}的API凭证无效, 跳过同步`);
            // 自动更新账户状态为error
            try {
              const { getDb: getDb5 } = await Promise.resolve().then(() => (init_db2(), db_exports));
              const db5 = await getDb5();
              if (db5) {
                const { sql: sql17 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
                await db5.execute(sql17`
                  UPDATE ad_accounts SET connectionStatus = 'error', 
                  connectionErrorMessage = CONCAT('v577: 同步预检失败(HTTP ', ${preCheckStatus}, '), API凭证无效或已过期'),
                  lastConnectionCheck = NOW()
                  WHERE id = ${this.accountId}
                `);
              }
            } catch (_) {}
            return { synced: 0, failed: 0, steps: [], error: `认证预检失败(${preCheckStatus})` };
          }
          log32.debug(`[syncAll] v577: 认证预检非致命错误(${preCheckStatus}), 继续同步: ${preCheckErr.message}`);
        }
        const STEP_RETRY_CONFIG = { maxRetries: 3, baseDelayMs: 3e3 };
        const LAYER_TRANSITION_DELAY_MS = 2e3;
        const MAX_CONCURRENT_PER_LAYER = 8;
        const runStep = /* @__PURE__ */ __name(async (stepName, fn) => {
          totalSteps++;
          const stepStart = Date.now();
          log32.info(`[syncAll] \u{1F4CC} \u8D26\u6237${this.accountId} \u6B65\u9AA4[${totalSteps}] ${stepName} \u5F00\u59CB...`);
          for (let attempt = 0; attempt <= STEP_RETRY_CONFIG.maxRetries; attempt++) {
            try {
              const result = await fn();
              const durationMs = Date.now() - stepStart;
              let synced = 0;
              if (typeof result === "number") synced = result;
              else if (result && typeof result === "object" && "synced" in result) synced = result.synced;
              results._syncDiagnostics.push({ stepName, synced, durationMs, ...attempt > 0 ? { retried: true } : {} });
              log32.info(`[syncAll] \u2705 \u8D26\u6237${this.accountId} \u6B65\u9AA4[${totalSteps}] ${stepName} \u5B8C\u6210: ${synced}\u6761, \u8017\u65F6${durationMs}ms${attempt > 0 ? ` (\u7B2C${attempt}\u6B21\u91CD\u8BD5\u6210\u529F)` : ""}`);
              if (totalSteps > 1) {
                await new Promise((resolve) => setTimeout(resolve, 1e3));
              }
              return result;
            } catch (error48) {
              const errMsg = error48.message || "";
              const isRetryable = errMsg.includes("429") || errMsg.includes("503") || errMsg.includes("502") || errMsg.includes("ETIMEDOUT") || errMsg.includes("ECONNRESET");
              if (isRetryable && attempt < STEP_RETRY_CONFIG.maxRetries) {
                const delay2 = STEP_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
                log32.warn(`[syncAll] \u26A0\uFE0F \u8D26\u6237${this.accountId} \u6B65\u9AA4[${totalSteps}] ${stepName} \u5931\u8D25(\u53EF\u91CD\u8BD5): ${errMsg}, ${delay2}ms\u540E\u91CD\u8BD5...`);
                await new Promise((resolve) => setTimeout(resolve, delay2));
                continue;
              }
              const durationMs = Date.now() - stepStart;
              failedSteps++;
              results._syncDiagnostics.push({ stepName, synced: 0, durationMs, error: errMsg });
              log32.warn(`[syncAll] \u274C \u8D26\u6237${this.accountId} \u6B65\u9AA4[${totalSteps}] ${stepName} \u5931\u8D25(${durationMs}ms): ${errMsg}`);
              return null;
            }
          }
          return null;
        }, "runStep");
        const targetLayers = options?.layers || [0, 1, 2, 3, 4, 5];
        const layerResults = {};
        const runLayer = /* @__PURE__ */ __name(async (layerId, layerName, fn) => {
          if (!targetLayers.includes(layerId)) {
            log32.info(`[syncAll] v402: \u8DF3\u8FC7 Layer ${layerId} (${layerName}) - \u4E0D\u5728\u76EE\u6807\u5C42\u5217\u8868\u4E2D`);
            return;
          }
          const layerStart = Date.now();
          try {
            await fn();
            layerResults[layerId] = { success: true };
            log32.info(`[syncAll] v402: Layer ${layerId} (${layerName}) \u5B8C\u6210\uFF0C\u8017\u65F6${Date.now() - layerStart}ms`);
          } catch (layerErr) {
            const errMsg = layerErr.message || "unknown";
            layerResults[layerId] = { success: false, error: errMsg };
            log32.warn(`[syncAll] v402: Layer ${layerId} (${layerName}) \u5931\u8D25: ${errMsg}\uFF0C\u7EE7\u7EED\u6267\u884C\u540E\u7EED\u5C42`);
          }
        }, "runLayer");
        await runLayer(0, "\u5E7F\u544A\u6D3B\u52A8\u540C\u6B65", async () => {
          log32.info(`[syncAll] v359: Layer 0 - \u5E7F\u544A\u6D3B\u52A8\u540C\u6B65 (3\u4E2A\u5E76\u884C)`);
          const [spResult, sbResult, sdResult] = await Promise.allSettled([
            // @ts-expect-error - runStep type inference
            runStep("SP\u5E7F\u544A\u6D3B\u52A8", () => this.syncSpCampaigns()),
            // @ts-expect-error - runStep type inference
            runStep("SB\u5E7F\u544A\u6D3B\u52A8", () => this.syncSbCampaigns()),
            // @ts-expect-error - runStep type inference
            runStep("SD\u5E7F\u544A\u6D3B\u52A8", () => this.syncSdCampaigns())
          ]);
          if (spResult.status === "fulfilled" && spResult.value !== null) {
            results.spCampaigns = typeof spResult.value === "number" ? spResult.value : spResult.value?.synced || 0;
            results.campaigns += results.spCampaigns;
          }
          if (sbResult.status === "fulfilled" && sbResult.value !== null) {
            results.sbCampaigns = typeof sbResult.value === "number" ? sbResult.value : sbResult.value?.synced || 0;
            results.campaigns += results.sbCampaigns;
          }
          if (sdResult.status === "fulfilled" && sdResult.value !== null) {
            results.sdCampaigns = typeof sdResult.value === "number" ? sdResult.value : sdResult.value?.synced || 0;
            results.campaigns += results.sdCampaigns;
          }
          await new Promise((resolve) => setTimeout(resolve, LAYER_TRANSITION_DELAY_MS));
        });
        // v580: PERMISSION_DENIED预检 - 检查账户是否有持续的权限拒绝
        const _permDeniedKey = `perm_denied_${this.profileId || this.accountId}`;
        if (AmazonAdsApiClient._authFailureCounters && AmazonAdsApiClient._authFailureCounters.get(_permDeniedKey) >= 3) {
          log32.warn(`[v580] 账户${this.accountId}(profileId=${this.profileId})连续${AmazonAdsApiClient._authFailureCounters.get(_permDeniedKey)}次PERMISSION_DENIED, 跳过后续同步`);
          const totalDurationMs2 = Date.now() - syncAllStartTime;
          log32.info(`[v580] PERMISSION_DENIED账户${this.accountId}快速跳过，耗时${totalDurationMs2}ms`);
          return results;
        }
        // v587: 记录campaignCount供大账户增量同步使用
        this._campaignCount = results.campaigns || 0;
        log32.info(`[v587] 账户${this.accountId} campaigns总数=${this._campaignCount}, ${this._campaignCount >= 1000 ? '大账户-启用增量策略' : '普通账户'}`);
        // v578: 空账户预检 - 如果Layer 0同步后campaigns总数为0，跳过后续的报告请求层以节省API额度
        if (results.campaigns === 0 && targetLayers.includes(0)) {
          log32.info(`[syncAll] v578: 账户${this.accountId}的campaigns总数为0(SP=${results.spCampaigns||0}, SB=${results.sbCampaigns||0}, SD=${results.sdCampaigns||0})，跳过Layer 1-6的详细同步以节省API额度`);
          const totalDurationMs = Date.now() - syncAllStartTime;
          log32.info(`[syncAll] v578: 空账户${this.accountId}快速完成，耗时${totalDurationMs}ms`);
          // 记录审计日志
          try {
            const { recordAudit: recordAudit3 } = await Promise.resolve().then(() => (init_auditLogService(), auditLogService_exports));
            recordAudit3({
              action: "sync.empty_account_skip",
              accountId: this.accountId,
              entityType: "account",
              entityId: this.accountId,
              source: "system",
              result: "success",
              metadata: { reason: "zero_campaigns", durationMs: totalDurationMs }
            });
          } catch (_) {}
          return results;
        }
        await runLayer(1, "\u5E7F\u544A\u7EC4\u540C\u6B65", async () => {
          log32.info(`[syncAll] v359: Layer 1 - \u5E7F\u544A\u7EC4\u540C\u6B65 (3\u4E2A\u5E76\u884C)`);
          const [spAdGroupResult, sbAdGroupResult, sdAdGroupResult] = await Promise.allSettled([
            // @ts-expect-error - runStep type inference
            runStep("SP\u5E7F\u544A\u7EC4", () => this.syncSpAdGroups()),
            // @ts-expect-error - runStep type inference
            runStep("SB\u5E7F\u544A\u7EC4", () => this.syncSbAdGroups()),
            // @ts-expect-error - runStep type inference
            runStep("SD\u5E7F\u544A\u7EC4", () => this.syncSdAdGroups())
          ]);
          if (spAdGroupResult.status === "fulfilled" && spAdGroupResult.value !== null) {
            results.adGroups += typeof spAdGroupResult.value === "number" ? spAdGroupResult.value : spAdGroupResult.value?.synced || 0;
          }
          if (sbAdGroupResult.status === "fulfilled" && sbAdGroupResult.value !== null) {
            results.adGroups += sbAdGroupResult.value?.synced || 0;
          }
          if (sdAdGroupResult.status === "fulfilled" && sdAdGroupResult.value !== null) {
            results.adGroups += sdAdGroupResult.value?.synced || 0;
          }
          await new Promise((resolve) => setTimeout(resolve, LAYER_TRANSITION_DELAY_MS));
        });
        await runLayer(2, "\u5173\u952E\u8BCD/\u5546\u54C1\u5B9A\u4F4D/\u53D7\u4F17/\u7D20\u6750\u540C\u6B65", async () => {
          log32.info(`[syncAll] v500: Layer 2 - \u5173\u952E\u8BCD/\u5546\u54C1\u5B9A\u4F4D/\u53D7\u4F17/\u7D20\u6750\u540C\u6B65 (7\u4E2A\u5E76\u884C)`);
          const [spKeywordResult, sbKeywordResult, spTargetResult, sbTargetResult, sdTargetResult, sbAdsResult, sdAudienceResult] = await Promise.allSettled([
            // @ts-expect-error - runStep type inference
            runStep("SP\u5173\u952E\u8BCD", () => this.syncSpKeywords()),
            // @ts-expect-error - runStep type inference
            runStep("SB\u5173\u952E\u8BCD", () => this.syncSbKeywords()),
            // @ts-expect-error - runStep type inference
            runStep("SP\u5546\u54C1\u5B9A\u4F4D", () => this.syncSpProductTargets()),
            // @ts-expect-error - runStep type inference
            runStep("SB\u5546\u54C1\u5B9A\u4F4D", () => this.syncSbProductTargets()),
            // @ts-expect-error - runStep type inference
            runStep("SD\u5546\u54C1\u5B9A\u4F4D", () => this.syncSdProductTargets()),
            // @ts-expect-error - runStep type inference
            runStep("SB\u5E7F\u544A\u7D20\u6750", () => this.syncSbAds()),
            // @ts-expect-error - runStep type inference
            // v500: 新增SD受众定向同步
            runStep("SD\u53D7\u4F17\u5B9A\u5411", () => this.syncSdAudiences())
          ]);
          if (spKeywordResult.status === "fulfilled" && spKeywordResult.value !== null) {
            results.keywords += typeof spKeywordResult.value === "number" ? spKeywordResult.value : spKeywordResult.value?.synced || 0;
          }
          if (sbKeywordResult.status === "fulfilled" && sbKeywordResult.value !== null) {
            results.keywords += sbKeywordResult.value?.synced || 0;
          }
          if (spTargetResult.status === "fulfilled" && spTargetResult.value !== null) {
            results.targets += typeof spTargetResult.value === "number" ? spTargetResult.value : spTargetResult.value?.synced || 0;
          }
          if (sbTargetResult.status === "fulfilled" && sbTargetResult.value !== null) {
            results.targets += sbTargetResult.value?.synced || 0;
          }
          if (sdTargetResult.status === "fulfilled" && sdTargetResult.value !== null) {
            results.targets += sdTargetResult.value?.synced || 0;
          }
          if (sdAudienceResult.status === "fulfilled" && sdAudienceResult.value !== null) {
            results.targets += sdAudienceResult.value?.synced || 0;
          }
          await new Promise((resolve) => setTimeout(resolve, LAYER_TRANSITION_DELAY_MS));
        });
        await runLayer(3, "\u5426\u5B9A\u8BCD/\u641C\u7D22\u8BCD/\u5E7F\u544A\u4F4D\u7EE9\u6548\u540C\u6B65", async () => {
          log32.info(`[syncAll] v382: Layer 3 - \u5426\u5B9A\u8BCD/\u641C\u7D22\u8BCD/\u5E7F\u544A\u4F4D\u7EE9\u6548\u540C\u6B65 (9\u4E2A\u5E76\u884C)`);
          await Promise.allSettled([
            // @ts-expect-error - runStep type inference
            runStep("SP\u5426\u5B9A\u5173\u952E\u8BCD", () => this.syncSpNegativeKeywords()),
            // @ts-expect-error - runStep type inference
            runStep("SP\u5426\u5B9A\u5546\u54C1\u5B9A\u5411", () => this.syncSpNegativeProductTargets()),
            // @ts-expect-error - runStep type inference
            runStep("SB\u5426\u5B9A\u5173\u952E\u8BCD", () => this.syncSbNegativeKeywords()),
            // @ts-expect-error - runStep type inference
            runStep("SB\u5426\u5B9A\u5546\u54C1\u5B9A\u5411", () => this.syncSbNegativeTargets()),
            // @ts-expect-error - runStep type inference
            runStep("SD\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411", () => this.syncSdNegativeTargets()),
            // @ts-ignore
            runStep(`SP\u641C\u7D22\u8BCD(${spDays}\u5929)`, () => this.syncSearchTerms(spDays)),
            // @ts-expect-error - runStep type inference
            runStep(`SB\u641C\u7D22\u8BCD(${sbDays}\u5929)`, () => this.syncSbSearchTerms(sbDays)),
            // @ts-expect-error - runStep type inference
            runStep(`SP\u5E7F\u544A\u4F4D\u7EE9\u6548(${spDays}\u5929)`, () => this.syncPlacementPerformance(spDays)),
            // @ts-expect-error - runStep type inference
            runStep(`SB\u5E7F\u544A\u4F4D\u7EE9\u6548(${sbDays}\u5929)`, () => this.syncSbPlacementPerformance(sbDays))
            // @ts-ignore
          ]);
          await new Promise((resolve) => setTimeout(resolve, LAYER_TRANSITION_DELAY_MS));
        });
        await runLayer(4, "\u5B9A\u5411\u62A5\u544A/\u7D20\u6750URL\u540C\u6B65", async () => {
          log32.info(`[syncAll] v359: Layer 4 - \u5B9A\u5411\u62A5\u544A/\u7D20\u6750URL\u540C\u6B65 (4\u4E2A\u5E76\u884C)`);
          await Promise.allSettled([
            // @ts-ignore
            runStep(`SP\u81EA\u52A8\u5B9A\u5411(${spDays}\u5929)`, () => this.syncAutoTargeting(spDays)),
            // @ts-expect-error - runStep type inference
            runStep(`SD\u5B9A\u5411\u62A5\u544A(${sdDays}\u5929)`, () => this.syncSdTargeting(sdDays)),
            // @ts-expect-error - runStep type inference
            runStep(`SB\u5B9A\u5411\u62A5\u544A(${sbDays}\u5929)`, () => this.syncSbTargeting(sbDays)),
            // @ts-ignore
            runStep("SB\u7D20\u6750URL\u89E3\u6790", () => this.syncAssetUrls())
          ]);
          await new Promise((resolve) => setTimeout(resolve, LAYER_TRANSITION_DELAY_MS));
        });
        const performanceDays = options?.performanceDays || (isFullSync ? parseInt(process.env.SYNC_PERFORMANCE_DAYS || "90", 10) : DAILY_SYNC_DAYS);
        await runLayer(5, "\u7EE9\u6548\u6570\u636E\u540C\u6B65", async () => {
          log32.info(`[syncAll] v359: Layer 5 - \u7EE9\u6548\u6570\u636E\u540C\u6B65 (4\u4E2A\u5E76\u884C, ${performanceDays}\u5929)`);
          const [perfResult, _kwPerfResult, _ptPerfResult, _agPerfResult] = await Promise.allSettled([
            // @ts-expect-error - runStep type inference
            runStep(`\u5E7F\u544A\u6D3B\u52A8\u7EE9\u6548(${performanceDays}\u5929)`, () => this.syncPerformanceData(performanceDays)),
            // @ts-expect-error - runStep type inference
            runStep(`\u5173\u952E\u8BCD\u7EE9\u6548(${performanceDays}\u5929)`, () => this.syncKeywordPerformanceData(performanceDays)),
            // @ts-expect-error - runStep type inference
            runStep(`\u5546\u54C1\u5B9A\u4F4D\u7EE9\u6548(${performanceDays}\u5929)`, () => this.syncProductTargetPerformanceData(performanceDays)),
            // @ts-expect-error - runStep type inference
            runStep(`\u5E7F\u544A\u7EC4\u7EE9\u6548(${performanceDays}\u5929)`, () => this.syncAdGroupPerformanceData(performanceDays))
          ]);
          if (perfResult.status === "fulfilled" && perfResult.value !== null) {
            results.performance += typeof perfResult.value === "number" ? perfResult.value : perfResult.value?.synced || 0;
          }
        });
        await runLayer(6, "\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65", async () => {
          log32.info(`[syncAll] v519: Layer 6 - \u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65 (4\u4E2A\u5E76\u884C\uFF0C\u542BSD\u53D7\u4F17)`);
          await Promise.allSettled([
            // @ts-expect-error - runStep type inference
            runStep("SP\u5EFA\u8BAE\u7ADE\u4EF7", () => this.syncSpBidRecommendations()),
            // @ts-expect-error - runStep type inference
            runStep("SB\u5EFA\u8BAE\u7ADE\u4EF7", () => this.syncSbBidRecommendations()),
            // @ts-expect-error - runStep type inference
            runStep("SD\u5EFA\u8BAE\u7ADE\u4EF7", () => this.syncSdBidRecommendations()),
            // @ts-expect-error - runStep type inference
            runStep("SD\u53D7\u4F17\u5EFA\u8BAE\u7ADE\u4EF7", () => this.syncSdAudienceBidRecommendations())
          ]);
        });
        const failedLayers = Object.entries(layerResults).filter(([_, r]) => !r.success).map(([id, r]) => `Layer${id}(${r.error})`);
        if (failedLayers.length > 0) {
          log32.warn(`[syncAll] v402: \u8D26\u6237${this.accountId} \u6709${failedLayers.length}\u4E2A\u5C42\u5931\u8D25: ${failedLayers.join(", ")}`);
        }
        const totalDurationMs = Date.now() - syncAllStartTime;
        const totalSynced = results._syncDiagnostics.reduce((sum2, d) => sum2 + d.synced, 0);
        const failedStepNames = results._syncDiagnostics.filter((d) => d.error).map((d) => d.stepName);
        log32.info(`[syncAll] \u{1F4CA} \u8D26\u6237${this.accountId} ${syncMode}\u6A21\u5F0F\u540C\u6B65\u5B8C\u6210: \u603B\u6B65\u9AA4=${totalSteps}, \u6210\u529F=${totalSteps - failedSteps}, \u5931\u8D25=${failedSteps}, \u603B\u8BB0\u5F55=${totalSynced}, \u603B\u8017\u65F6=${totalDurationMs}ms`);
        if (failedSteps > 0) {
          log32.warn(`[syncAll] \u26A0\uFE0F \u8D26\u6237${this.accountId} \u5931\u8D25\u6B65\u9AA4: ${failedStepNames.join(", ")}`);
        }
        if (totalSynced === 0 && totalSteps > 0) {
          log32.warn(`[syncAll] \u{1F6A8} \u8D26\u6237${this.accountId} \u5168\u91CF\u540C\u6B65\u5B8C\u6210\u4F46\u603B\u8BB0\u5F55\u6570\u4E3A0\uFF01\u53EF\u80FD\u5B58\u5728API\u6388\u6743\u6216\u6570\u636E\u95EE\u9898\uFF0C\u8BF7\u68C0\u67E5\u4EE5\u4E0A\u5404\u6B65\u9AA4\u8BE6\u60C5\u3002`);
        }
        try {
          const { recordAudit: recordAudit3 } = await Promise.resolve().then(() => (init_auditLogService(), auditLogService_exports));
          recordAudit3({
            action: "sync.full_sync",
            accountId: this.accountId,
            entityType: "account",
            entityId: this.accountId,
            source: "system",
            result: failedSteps === 0 ? "success" : totalSynced > 0 ? "partial" : "failure",
            metadata: {
              totalSteps,
              successSteps: totalSteps - failedSteps,
              failedSteps,
              totalSynced,
              durationMs: totalDurationMs,
              failedStepNames,
              // v402: 子任务分解信息
              layerResults,
              targetLayers
            }
          });
        } catch (auditErr) {
        }
        return results;
      }
      /**
       * 仅同步广告活动（高频同步）
       * 用于快速获取广告活动状态和预算变化
       */
      async syncCampaignsOnly() {
        const results = {
          campaigns: 0,
          spCampaigns: 0,
          // @ts-ignore
          sbCampaigns: 0,
          sdCampaigns: 0
        };
        try {
          const spResult = await this.syncSpCampaigns();
          results.spCampaigns = typeof spResult === "number" ? spResult : spResult.synced;
          results.campaigns += results.spCampaigns;
        } catch (error48) {
          log32.warn("SP\u5E7F\u544A\u6D3B\u52A8\u540C\u6B65\u5931\u8D25:", error48.message);
        }
        try {
          const sbResult = await this.syncSbCampaigns();
          results.sbCampaigns = typeof sbResult === "number" ? sbResult : sbResult.synced;
          results.campaigns += results.sbCampaigns;
        } catch (error48) {
          log32.warn("SB\u5E7F\u544A\u6D3B\u52A8\u540C\u6B65\u5931\u8D25:", error48.message);
        }
        try {
          const sdResult = await this.syncSdCampaigns();
          results.sdCampaigns = typeof sdResult === "number" ? sdResult : sdResult.synced;
          results.campaigns += results.sdCampaigns;
        } catch (error48) {
          log32.warn("SD\u5E7F\u544A\u6D3B\u52A8\u540C\u6B65\u5931\u8D25:", error48.message);
        }
        log32.info(`\u5E7F\u544A\u6D3B\u52A8\u540C\u6B65\u5B8C\u6210: SP=${results.spCampaigns}, SB=${results.sbCampaigns}, SD=${results.sdCampaigns}`);
        return results;
      }
      /**
       * 同步广告组和定位数据（中频同步）
       * 用于获取广告组、关键词和商品定位的变化
       */
      async syncAdGroupsAndTargeting() {
        const results = {
          adGroups: 0,
          keywords: 0,
          targets: 0
        };
        try {
          const spAdGroupResult = await this.syncSpAdGroups();
          results.adGroups += typeof spAdGroupResult === "number" ? spAdGroupResult : spAdGroupResult.synced;
        } catch (e) {
          log32.warn("SP\u5E7F\u544A\u7EC4\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          const sbAdGroupResult = await this.syncSbAdGroups();
          results.adGroups += sbAdGroupResult.synced;
        } catch (e) {
          log32.warn("SB\u5E7F\u544A\u7EC4\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          const sdAdGroupResult = await this.syncSdAdGroups();
          results.adGroups += sdAdGroupResult.synced;
        } catch (e) {
          log32.warn("SD\u5E7F\u544A\u7EC4\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          const spKeywordResult = await this.syncSpKeywords();
          results.keywords += typeof spKeywordResult === "number" ? spKeywordResult : spKeywordResult.synced;
        } catch (e) {
          log32.warn("SP\u5173\u952E\u8BCD\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          const sbKeywordResult = await this.syncSbKeywords();
          results.keywords += sbKeywordResult.synced;
        } catch (e) {
          log32.warn("SB\u5173\u952E\u8BCD\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          const spTargetResult = await this.syncSpProductTargets();
          results.targets += typeof spTargetResult === "number" ? spTargetResult : spTargetResult.synced;
        } catch (e) {
          log32.warn("SP\u5546\u54C1\u5B9A\u4F4D\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          const sbTargetResult = await this.syncSbProductTargets();
          results.targets += sbTargetResult.synced;
        } catch (e) {
          log32.warn("SB\u5546\u54C1\u5B9A\u4F4D\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          const sdTargetResult = await this.syncSdProductTargets();
          results.targets += sdTargetResult.synced;
        } catch (e) {
          log32.warn("SD\u5546\u54C1\u5B9A\u4F4D\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          log32.info(`v196: \u4E2D\u9891\u540C\u6B65 - \u5F00\u59CB\u540C\u6B65SP\u641C\u7D22\u8BCD\u6570\u636E(7\u5929)...`);
          const spSearchTermSynced = await this.syncSearchTerms(7);
          log32.info(`v196: \u4E2D\u9891\u540C\u6B65 - SP\u641C\u7D22\u8BCD\u540C\u6B65\u5B8C\u6210: ${spSearchTermSynced}\u6761`);
        } catch (e) {
          log32.warn("v196: \u4E2D\u9891\u540C\u6B65 - SP\u641C\u7D22\u8BCD\u540C\u6B65\u5931\u8D25:", e.message);
        }
        log32.info(`\u5168\u6E20\u9053\u5E7F\u544A\u7EC4\u548C\u5B9A\u4F4D\u540C\u6B65\u5B8C\u6210: \u5E7F\u544A\u7EC4=${results.adGroups}, \u5173\u952E\u8BCD=${results.keywords}, \u5B9A\u4F4D=${results.targets}`);
        return results;
      }
    };
    __name(flushSearchTermBatch, "flushSearchTermBatch");
    AmazonSyncService.prototype.syncSearchTerms = async function(days = 90) {
      const db = await getDb();
      if (!db) return 0;
      try {
        const MAX_DAYS_PER_REQUEST = 31;
        const totalDays = Math.min(days, 90);
        const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
        const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
        log32.info(`v339: \u5F00\u59CB\u540C\u6B65SP\u641C\u7D22\u8BCD\u6570\u636E: \u5171${totalDays}\u5929\uFF0C\u5206${batches}\u6279\u8BF7\u6C42 (\u7AD9\u70B9: ${this.marketplace})`);
        log32.info(`v339: \u603B\u8303\u56F4: ${rangeStartDate} - ${rangeEndDate}`);
        let allReportData = [];
        if (batches === 1) {
          try {
            const reportId = await this.client.requestSpSearchTermReport(rangeStartDate, rangeEndDate);
            const data = await this.client.waitAndDownloadReport(reportId, 3e5);
            if (data && data.length > 0) allReportData = data;
          } catch (e) {
            log32.warn(`v413: SP\u641C\u7D22\u8BCD\u62A5\u544A\u8BF7\u6C42\u5931\u8D25:`, e.message);
          }
        } else {
          const batchRequests = [];
          for (let batch = 0; batch < batches; batch++) {
            const endDateObj = new Date(rangeEndDate);
            endDateObj.setDate(endDateObj.getDate() - batch * MAX_DAYS_PER_REQUEST);
            const startDateObj = new Date(endDateObj);
            const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - batch * MAX_DAYS_PER_REQUEST);
            startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
            const bStart = startDateObj.toISOString().split("T")[0];
            const bEnd = endDateObj.toISOString().split("T")[0];
            batchRequests.push({
              name: `SP\u641C\u7D22\u8BCD\u7B2C${batch + 1}/${batches}\u6279(${bStart}~${bEnd})`,
              requestFn: /* @__PURE__ */ __name(() => this.client.requestSpSearchTermReport(bStart, bEnd), "requestFn")
            });
          }
          log32.info(`[v413] SP\u641C\u7D22\u8BCD: ${batches}\u6279\u6B21\u6279\u91CF\u63D0\u4EA4\u5F00\u59CB`);
          const results = await this.client.submitAndWaitMultipleReports(batchRequests, 12e5, 3e3);
          for (const result of results) {
            if (result.data && result.data.length > 0) {
              allReportData = allReportData.concat(result.data);
            } else if (result.error) {
              log32.warn(`[v413] ${result.name}\u5931\u8D25: ${result.error}`);
            }
          }
        }
        const startDate = rangeStartDate;
        const endDate = rangeEndDate;
        if (allReportData.length === 0) {
          log32.debug("v339: \u6240\u6709\u6279\u6B21\u641C\u7D22\u8BCD\u62A5\u544A\u6570\u636E\u4E3A\u7A7A");
          return 0;
        }
        const reportData = allReportData;
        log32.info(`v339: \u5171\u83B7\u53D6\u5230 ${reportData.length} \u6761\u641C\u7D22\u8BCD\u6570\u636E\uFF08${batches}\u6279\u5408\u5E76\uFF09\uFF0C\u5F00\u59CB\u6279\u91CF\u9884\u52A0\u8F7D...`);
        const allCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId }).from(campaigns).where(eq(campaigns.accountId, this.accountId));
        const campaignMap = /* @__PURE__ */ new Map();
        for (const c of allCampaigns) {
          campaignMap.set(String(c.campaignId), { id: c.id, campaignId: String(c.campaignId) });
        }
        const allAdGroups = await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups).where(eq(adGroups.accountId, this.accountId));
        const adGroupMap = /* @__PURE__ */ new Map();
        for (const ag of allAdGroups) {
          adGroupMap.set(String(ag.adGroupId), { id: ag.id });
        }
        const allKeywords = await db.select({ id: keywords.id, adGroupId: keywords.internalAdGroupId, keywordText: keywords.keywordText, matchType: keywords.matchType }).from(keywords).where(eq(keywords.accountId, this.accountId));
        const keywordMap = /* @__PURE__ */ new Map();
        for (const kw of allKeywords) {
          const key = `${kw.adGroupId}:${(kw.keywordText || "").toLowerCase()}`;
          keywordMap.set(key, { id: kw.id, matchType: kw.matchType });
        }
        const allTargets = await db.select({ id: productTargets.id, adGroupId: productTargets.internalAdGroupId, targetValue: productTargets.targetValue, targetMatchType: productTargets.targetMatchType }).from(productTargets).where(eq(productTargets.accountId, this.accountId));
        const targetMap = /* @__PURE__ */ new Map();
        for (const t2 of allTargets) {
          const key = `${t2.adGroupId}:${(t2.targetValue || "").toLowerCase()}`;
          targetMap.set(key, { id: t2.id, targetMatchType: t2.targetMatchType });
        }
        const allSearchTerms = await db.select({ id: searchTerms.id, campaignId: searchTerms.campaignId, adGroupId: searchTerms.internalAdGroupId, searchTerm: searchTerms.searchTerm }).from(searchTerms).where(eq(searchTerms.accountId, this.accountId));
        const existingMap = /* @__PURE__ */ new Map();
        for (const st of allSearchTerms) {
          const key = `${st.campaignId}:${st.adGroupId}:${(st.searchTerm || "").toLowerCase()}`;
          existingMap.set(key, st.id);
        }
        log32.info(`v196: \u9884\u52A0\u8F7D\u5B8C\u6210 - campaigns=${allCampaigns.length}, adGroups=${allAdGroups.length}, keywords=${allKeywords.length}, targets=${allTargets.length}, existingSearchTerms=${allSearchTerms.length}`);
        let synced = 0;
        let skipped = 0;
        const BATCH_SIZE = 300;
        let upsertBatch = [];
        const nowStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
        for (const row of reportData) {
          const campaign = campaignMap.get(String(row.campaignId));
          if (!campaign) {
            skipped++;
            continue;
          }
          const adGroup = adGroupMap.get(String(row.adGroupId));
          if (!adGroup) {
            skipped++;
            continue;
          }
          const cost = row.cost || 0;
          const sales = row.sales7d || row.sales14d || 0;
          const clicks = row.clicks || 0;
          const impressions = row.impressions || 0;
          const orders = row.purchases7d || row.purchases14d || 0;
          const targetingText = row.targeting || row.keyword || "";
          const keywordType = (row.keywordType || row.matchType || "").toLowerCase();
          const isProductTarget = keywordType === "targeting";
          let searchTermTargetId = null;
          let resolvedMatchType = keywordType;
          if (!isProductTarget) {
            const kwKey = `${adGroup.id}:${targetingText.toLowerCase()}`;
            const matchedKeyword = keywordMap.get(kwKey);
            if (matchedKeyword) {
              searchTermTargetId = matchedKeyword.id;
              resolvedMatchType = matchedKeyword.matchType || keywordType;
            }
          } else {
            const tKey = `${adGroup.id}:${targetingText.toLowerCase()}`;
            const matchedTarget = targetMap.get(tKey);
            if (matchedTarget) {
              searchTermTargetId = matchedTarget.id;
              resolvedMatchType = matchedTarget.targetMatchType || "targeting";
            }
          }
          const searchTermText = row.searchTerm || "";
          const isAsinSearchTerm2 = /^[Bb]0[A-Za-z0-9]{8,}$/.test(searchTermText.trim());
          const searchTermType = isAsinSearchTerm2 ? "asin" : "keyword";
          const sourceMatchType = resolvedMatchType;
          const sourceTargetType = isProductTarget ? "product_target" : "keyword";
          const unitsOrdered = row.unitsSold7d || row.unitsSold14d || row.unitsSold || row.unitsSoldClicks || 0;
          const rowDate = row.date || startDate;
          const searchTermData = {
            accountId: this.accountId,
            campaignId: campaign.campaignId,
            internalAdGroupId: adGroup.id,
            // v418: ID体系重构
            searchTerm: searchTermText,
            searchTermTargetType: isProductTarget ? "product_target" : "keyword",
            searchTermTargetId,
            targetText: targetingText,
            searchTermMatchType: resolvedMatchType,
            searchTermImpressions: impressions,
            searchTermClicks: clicks,
            searchTermSpend: String(cost),
            searchTermSales: String(sales),
            searchTermOrders: orders,
            searchTermAcos: sales > 0 ? String(cost / sales * 100) : null,
            searchTermRoas: cost > 0 ? String(sales / cost) : null,
            searchTermCtr: impressions > 0 ? String(clicks / impressions) : null,
            searchTermCvr: clicks > 0 ? String(orders / clicks) : null,
            // @ts-ignore
            searchTermCpc: clicks > 0 ? String(cost / clicks) : null,
            // v383: reportStartDate和reportEndDate都使用行级别的具体日期
            reportStartDate: rowDate,
            reportEndDate: rowDate,
            sourceMatchType,
            sourceTargetType,
            searchTermType,
            searchTermUnitsOrdered: unitsOrdered,
            // v614: 写入campaign_type字段
            campaignType: "sp",
            updatedAt: nowStr
          };
          upsertBatch.push({
            ...searchTermData,
            createdAt: nowStr
          });
          if (upsertBatch.length >= BATCH_SIZE) {
            await flushSearchTermBatch(db, upsertBatch);
            synced += upsertBatch.length;
            upsertBatch = [];
          }
        }
        if (upsertBatch.length > 0) {
          await flushSearchTermBatch(db, upsertBatch);
          synced += upsertBatch.length;
          upsertBatch = [];
        }
        log32.info(`v196: \u641C\u7D22\u8BCD\u540C\u6B65\u5B8C\u6210: \u540C\u6B65=${synced}, \u8DF3\u8FC7=${skipped} (\u65E0\u5339\u914Dcampaign/adGroup)`);
        return synced;
      } catch (error48) {
        log32.warn("v196: \u540C\u6B65\u641C\u7D22\u8BCD\u5931\u8D25:", error48);
        return 0;
      }
    };
    AmazonSyncService.prototype.syncAutoTargeting = async function(days = 90) {
      const db = await getDb();
      if (!db) return 0;
      try {
        const MAX_DAYS_PER_REQUEST = 31;
        const totalDays = Math.min(days, 90);
        const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
        const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
        log32.info(`v339: \u5F00\u59CB\u540C\u6B65SP\u81EA\u52A8\u5B9A\u5411\u6570\u636E: \u5171${totalDays}\u5929\uFF0C\u5206${batches}\u6279\u8BF7\u6C42 (\u7AD9\u70B9: ${this.marketplace})`);
        let allReportData = [];
        if (batches === 1) {
          try {
            const reportId = await this.client.requestSpAutoTargetingReport(rangeStartDate, rangeEndDate);
            const data = await this.client.waitAndDownloadReport(reportId, 3e5);
            if (data && data.length > 0) allReportData = data;
          } catch (e) {
            log32.warn(`v413: SP\u81EA\u52A8\u5B9A\u5411\u62A5\u544A\u8BF7\u6C42\u5931\u8D25:`, e.message);
          }
        } else {
          const batchRequests = [];
          for (let batch = 0; batch < batches; batch++) {
            const endDateObj = new Date(rangeEndDate);
            endDateObj.setDate(endDateObj.getDate() - batch * MAX_DAYS_PER_REQUEST);
            const startDateObj = new Date(endDateObj);
            const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - batch * MAX_DAYS_PER_REQUEST);
            startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
            const bStart = startDateObj.toISOString().split("T")[0];
            const bEnd = endDateObj.toISOString().split("T")[0];
            batchRequests.push({
              name: `SP\u81EA\u52A8\u5B9A\u5411\u7B2C${batch + 1}/${batches}\u6279(${bStart}~${bEnd})`,
              requestFn: /* @__PURE__ */ __name(() => this.client.requestSpAutoTargetingReport(bStart, bEnd), "requestFn")
            });
          }
          log32.info(`[v413] SP\u81EA\u52A8\u5B9A\u5411: ${batches}\u6279\u6B21\u6279\u91CF\u63D0\u4EA4\u5F00\u59CB`);
          const results = await this.client.submitAndWaitMultipleReports(batchRequests, 12e5, 3e3);
          for (const result of results) {
            if (result.data && result.data.length > 0) {
              allReportData = allReportData.concat(result.data);
            } else if (result.error) {
              log32.warn(`[v413] ${result.name}\u5931\u8D25: ${result.error}`);
            }
          }
        }
        const reportData = allReportData;
        if (!reportData || reportData.length === 0) {
          log32.debug("v339: \u6240\u6709\u6279\u6B21\u81EA\u52A8\u5B9A\u5411\u62A5\u544A\u6570\u636E\u4E3A\u7A7A");
          return 0;
        }
        log32.info(`v339: \u5171\u83B7\u53D6\u5230 ${reportData.length} \u6761\u81EA\u52A8\u5B9A\u5411\u6570\u636E\uFF08${batches}\u6279\u5408\u5E76\uFF09`);
        let synced = 0;
        const allAdGroups = await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId, campaignId: adGroups.campaignId }).from(adGroups).where(eq(adGroups.accountId, this.accountId));
        const adGroupMap = /* @__PURE__ */ new Map();
        for (const ag of allAdGroups) {
          adGroupMap.set(String(ag.adGroupId), { id: ag.id, campaignId: ag.campaignId });
        }
        const allExistingTargets = await db.select({ id: productTargets.id, adGroupId: productTargets.internalAdGroupId, targetId: productTargets.targetId }).from(productTargets).where(eq(productTargets.accountId, this.accountId));
        const existingTargetMap = /* @__PURE__ */ new Map();
        for (const t2 of allExistingTargets) {
          existingTargetMap.set(`${t2.adGroupId}:${t2.targetId}`, t2.id);
        }
        log32.info(`v401: \u81EA\u52A8\u5B9A\u5411\u9884\u52A0\u8F7D\u5B8C\u6210 - adGroups=${allAdGroups.length}, existingTargets=${allExistingTargets.length}`);
        const BATCH_SIZE = 200;
        let upsertBatch = [];
        const nowStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
        for (const row of reportData) {
          const kwType = (row.keywordType || "").toUpperCase();
          if (kwType !== "TARGETING" && kwType !== "AUTO") continue;
          const adGroup = adGroupMap.get(String(row.adGroupId));
          if (!adGroup) continue;
          const cost = row.cost || 0;
          const sales = row.sales7d || row.sales14d || row.salesClicks14d || 0;
          const clicks = row.clicks || 0;
          const impressions = row.impressions || 0;
          const orders = row.purchases7d || row.purchases14d || row.purchasesClicks14d || 0;
          const targetingExpression = row.targeting || row.targetingExpression || "";
          let targetType = "category";
          let targetValue = targetingExpression;
          if (targetingExpression.includes("close-match")) {
            targetValue = "CLOSE_MATCH";
          } else if (targetingExpression.includes("loose-match")) {
            targetValue = "LOOSE_MATCH";
          } else if (targetingExpression.includes("substitutes")) {
            targetValue = "SUBSTITUTES";
          } else if (targetingExpression.includes("complements")) {
            targetValue = "COMPLEMENTS";
          }
          const rowTargetId = row.keywordId || row.targetId || "";
          const existingKey = `${String(adGroup.id)}:${String(rowTargetId)}`;
          const existingId = existingTargetMap.get(existingKey);
          const targetData = {
            accountId: this.accountId,
            internalAdGroupId: adGroup.id,
            // v418: ID体系重构
            campaignId: adGroup.campaignId || "",
            targetId: String(rowTargetId),
            targetType,
            targetValue,
            // @ts-ignore
            targetExpression: targetingExpression,
            bid: "0.00",
            impressions: Number(impressions),
            clicks: Number(clicks),
            spend: String(cost),
            sales: String(sales),
            orders: Number(orders),
            targetAcos: sales > 0 ? String((cost / sales * 100).toFixed(2)) : null,
            targetRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
            targetCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
            targetCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
            targetCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
            targetStatus: "enabled",
            updatedAt: nowStr
          };
          if (existingId) {
            await db.update(productTargets).set(targetData).where(eq(productTargets.id, existingId));
          } else {
            upsertBatch.push({
              ...targetData,
              createdAt: nowStr
            });
            if (upsertBatch.length >= BATCH_SIZE) {
              await db.insert(productTargets).values(upsertBatch);
              synced += upsertBatch.length;
              upsertBatch = [];
            }
          }
          if (existingId) synced++;
        }
        if (upsertBatch.length > 0) {
          await db.insert(productTargets).values(upsertBatch);
          synced += upsertBatch.length;
        }
        log32.info(`\u81EA\u52A8\u5B9A\u5411\u540C\u6B65\u5B8C\u6210: ${synced} \u6761\u8BB0\u5F55`);
        return synced;
      } catch (error48) {
        log32.warn("\u540C\u6B65\u81EA\u52A8\u5B9A\u5411\u5931\u8D25:", error48);
        return 0;
      }
    };
    AmazonSyncService.prototype.syncAllAdData = async function(days = 90) {
      const results = {
        campaigns: 0,
        adGroups: 0,
        keywords: 0,
        // @ts-ignore
        targets: 0,
        searchTerms: 0,
        placements: 0
      };
      try {
        log32.info(`\u5F00\u59CB\u5B8C\u6574\u540C\u6B65\u6240\u6709\u5E7F\u544A\u6570\u636E (${days}\u5929)`);
        const spResult = await this.syncSpCampaigns();
        const sbResult = await this.syncSbCampaigns();
        const sdResult = await this.syncSdCampaigns();
        results.campaigns = (typeof spResult === "number" ? spResult : spResult.synced) + // @ts-ignore
        (typeof sbResult === "number" ? sbResult : sbResult.synced) + (typeof sdResult === "number" ? sdResult : sdResult.synced);
        const adGroupResult = await this.syncSpAdGroups();
        results.adGroups = typeof adGroupResult === "number" ? adGroupResult : adGroupResult.synced;
        try {
          const sbAdGroupResult = await this.syncSbAdGroups();
          results.adGroups += sbAdGroupResult.synced;
        } catch (e) {
          log32.warn("[SyncAllAd] SB\u5E7F\u544A\u7EC4\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          const sdAdGroupResult = await this.syncSdAdGroups();
          results.adGroups += sdAdGroupResult.synced;
        } catch (e) {
          log32.warn("[SyncAllAd] SD\u5E7F\u544A\u7EC4\u540C\u6B65\u5931\u8D25:", e.message);
        }
        const keywordResult = await this.syncSpKeywords();
        results.keywords = typeof keywordResult === "number" ? keywordResult : keywordResult.synced;
        try {
          const sbKeywordResult = await this.syncSbKeywords();
          results.keywords += sbKeywordResult.synced;
        } catch (e) {
          log32.warn("[SyncAllAd] SB\u5173\u952E\u8BCD\u540C\u6B65\u5931\u8D25:", e.message);
        }
        const targetResult = await this.syncSpProductTargets();
        results.targets = typeof targetResult === "number" ? targetResult : targetResult.synced;
        try {
          const sbPtResult = await this.syncSbProductTargets();
          results.targets += sbPtResult.synced;
        } catch (e) {
          log32.warn("[SyncAllAd] SB\u5546\u54C1\u5B9A\u5411\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          const sdPtResult = await this.syncSdProductTargets();
          results.targets += sdPtResult.synced;
        } catch (e) {
          log32.warn("[SyncAllAd] SD\u5546\u54C1\u5B9A\u5411\u540C\u6B65\u5931\u8D25:", e.message);
        }
        const autoTargetResult = await this.syncAutoTargeting(days);
        results.targets += autoTargetResult;
        const sdTargetResult = await this.syncSdTargeting(days);
        results.targets += sdTargetResult;
        const sbTargetResult = await this.syncSbTargeting(days);
        results.keywords += sbTargetResult;
        try {
          const negKwResult = await this.syncSpNegativeKeywords();
          log32.info(`[SyncAllAd] SP\u5426\u5B9A\u5173\u952E\u8BCD: ${negKwResult.synced}\u65B0\u589E, ${negKwResult.updated}\u66F4\u65B0`);
        } catch (e) {
          log32.warn("[SyncAllAd] SP\u5426\u5B9A\u5173\u952E\u8BCD\u540C\u6B65\u5931\u8D25:", e.message);
        }
        try {
          const negPtResult = await this.syncSpNegativeProductTargets();
          log32.info(`[SyncAllAd] SP\u5426\u5B9A\u5546\u54C1\u5B9A\u5411: ${negPtResult.synced}\u65B0\u589E, ${negPtResult.updated}\u66F4\u65B0`);
        } catch (e) {
          log32.warn("[SyncAllAd] SP\u5426\u5B9A\u5546\u54C1\u5B9A\u5411\u540C\u6B65\u5931\u8D25:", e.message);
        }
        results.searchTerms = await this.syncSearchTerms(days);
        try {
          const sbStSynced = await this.syncSbSearchTerms(days);
          results.searchTerms += sbStSynced;
        } catch (e) {
          log32.warn("[SyncAllAd] SB\u641C\u7D22\u8BCD\u540C\u6B65\u5931\u8D25:", e.message);
        }
        results.placements = await this.syncPlacementPerformance(days);
        log32.info(`\u5B8C\u6574\u540C\u6B65\u5B8C\u6210:`, results);
      } catch (error48) {
        log32.warn("\u5B8C\u6574\u540C\u6B65\u5931\u8D25:", error48);
      }
      return results;
    };
    AmazonSyncService.prototype.syncPerformanceOnly = async function(days = 90) {
      const results = {
        performance: 0,
        keywordPerf: 0,
        targetPerf: 0
      };
      try {
        results.performance = await this.syncPerformanceData(days);
        log32.info(`\u7EE9\u6548\u6570\u636E\u540C\u6B65\u5B8C\u6210: ${results.performance} \u6761\u8BB0\u5F55`);
      } catch (error48) {
        log32.warn("\u7EE9\u6548\u6570\u636E\u540C\u6B65\u5931\u8D25:", error48);
      }
      try {
        log32.info(`\u5F00\u59CB\u540C\u6B65\u5173\u952E\u8BCD\u7EA7\u522B\u7EE9\u6548\u6570\u636E\uFF08${days}\u5929\uFF09...`);
        results.keywordPerf = await this.syncKeywordPerformanceData(days);
        log32.info(`\u5173\u952E\u8BCD\u7EE9\u6548\u6570\u636E\u540C\u6B65\u5B8C\u6210: ${results.keywordPerf}\u6761`);
      } catch (kwPerfError) {
        log32.warn("\u5173\u952E\u8BCD\u7EE9\u6548\u6570\u636E\u540C\u6B65\u5931\u8D25:", kwPerfError.message);
      }
      try {
        log32.info(`\u5F00\u59CB\u540C\u6B65\u5546\u54C1\u5B9A\u4F4D\u7EA7\u522B\u7EE9\u6548\u6570\u636E\uFF08${days}\u5929\uFF09...`);
        results.targetPerf = await this.syncProductTargetPerformanceData(days);
        log32.info(`\u5546\u54C1\u5B9A\u4F4D\u7EE9\u6548\u6570\u636E\u540C\u6B65\u5B8C\u6210: ${results.targetPerf}\u6761`);
      } catch (ptPerfError) {
        log32.warn("\u5546\u54C1\u5B9A\u4F4D\u7EE9\u6548\u6570\u636E\u540C\u6B65\u5931\u8D25:", ptPerfError.message);
      }
      return results;
    };
    AmazonSyncService.prototype.syncAssetUrls = async function() {
      const db = await getDb();
      if (!db) return 0;
      try {
        const adGroupsNeedingUrls = await db.select().from(adGroups).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(
          and(
            eq(campaigns.accountId, this.accountId),
            sql`(${adGroups.videoAssetId} IS NOT NULL AND ${adGroups.videoAssetId} != '' AND (${adGroups.videoUrl} IS NULL OR ${adGroups.videoUrl} = ''))
              OR (${adGroups.brandLogoAssetId} IS NOT NULL AND ${adGroups.brandLogoAssetId} != '' AND (${adGroups.brandLogoUrl} IS NULL OR ${adGroups.brandLogoUrl} = ''))
              OR (${adGroups.customImageAssetId} IS NOT NULL AND ${adGroups.customImageAssetId} != '' AND (${adGroups.customImageUrl} IS NULL OR ${adGroups.customImageUrl} = ''))`
          )
        );
        if (adGroupsNeedingUrls.length === 0) {
          log32.debug("\u6240\u6709SB\u5E7F\u544A\u7EC4\u7684\u7D20\u6750URL\u5DF2\u662F\u6700\u65B0");
          return 0;
        }
        log32.debug(`\u627E\u5230 ${adGroupsNeedingUrls.length} \u4E2A\u9700\u8981\u89E3\u6790\u7D20\u6750URL\u7684\u5E7F\u544A\u7EC4`);
        const assetIdsToResolve = /* @__PURE__ */ new Set();
        for (const row of adGroupsNeedingUrls) {
          if (row.ad_groups.videoAssetId && !row.ad_groups.videoUrl) {
            assetIdsToResolve.add(row.ad_groups.videoAssetId);
          }
          if (row.ad_groups.brandLogoAssetId && !row.ad_groups.brandLogoUrl) {
            assetIdsToResolve.add(row.ad_groups.brandLogoAssetId);
          }
          if (row.ad_groups.customImageAssetId && !row.ad_groups.customImageUrl) {
            assetIdsToResolve.add(row.ad_groups.customImageAssetId);
          }
        }
        log32.debug(`\u9700\u8981\u89E3\u6790 ${assetIdsToResolve.size} \u4E2A\u552F\u4E00\u7D20\u6750ID`);
        const resolvedUrls = await this.client.resolveAssetUrls(Array.from(assetIdsToResolve));
        log32.info(`\u6210\u529F\u89E3\u6790 ${resolvedUrls.size} \u4E2A\u7D20\u6750URL`);
        let updated = 0;
        for (const row of adGroupsNeedingUrls) {
          const updates = {};
          let needsUpdate = false;
          if (row.ad_groups.videoAssetId && !row.ad_groups.videoUrl) {
            const resolved = resolvedUrls.get(row.ad_groups.videoAssetId);
            if (resolved) {
              updates.videoUrl = resolved.url;
              if (resolved.thumbnailUrl) {
                updates.videoThumbnailUrl = resolved.thumbnailUrl;
              }
              needsUpdate = true;
            }
          }
          if (row.ad_groups.brandLogoAssetId && !row.ad_groups.brandLogoUrl) {
            const resolved = resolvedUrls.get(row.ad_groups.brandLogoAssetId);
            if (resolved) {
              updates.brandLogoUrl = resolved.url;
              needsUpdate = true;
            }
          }
          if (row.ad_groups.customImageAssetId && !row.ad_groups.customImageUrl) {
            const resolved = resolvedUrls.get(row.ad_groups.customImageAssetId);
            if (resolved) {
              updates.customImageUrl = resolved.url;
              needsUpdate = true;
            }
          }
          if (needsUpdate) {
            await db.update(adGroups).set(updates).where(eq(adGroups.id, row.ad_groups.id));
            updated++;
          }
        }
        return updated;
      } catch (error48) {
        log32.warn("syncAssetUrls\u5931\u8D25:", error48.message);
        throw error48;
      }
    };
    registerSyncServiceFactory(
      (credentials, accountId, userId, marketplace) => AmazonSyncService.createFromCredentials(credentials, accountId, userId, marketplace)
    );
    __name(syncInitialHistoricalData, "syncInitialHistoricalData");
  }
});

