// Extracted from production dist/index.js
// Original module: server/_debug/debug-sync.ts
// Lines: 246

var log193, debugSyncRouter;
var init_debug_sync = __esm({
  "server/_debug/debug-sync.ts"() {
    "use strict";
    init_logger();
    init_trpc();
    init_zod();
    init_db2();
    init_amazonSyncService();
    log193 = createModuleLogger("Debugsync");
    debugSyncRouter = router({
      /**
       * 测试API连接并返回原始数据
       */
      testApiConnection: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number()
      })).query(async ({ input }) => {
        try {
          const credentials = await getAmazonApiCredentials(input.accountId);
          if (!credentials) {
            return { success: false, error: "\u672A\u627E\u5230API\u51ED\u8BC1" };
          }
          const account = await getAdAccountById(input.accountId);
          const marketplace = account?.marketplace || "US";
          const syncService = await AmazonSyncService.createFromCredentials(
            {
              clientId: credentials.clientId,
              clientSecret: credentials.clientSecret,
              refreshToken: credentials.refreshToken,
              profileId: credentials.profileId,
              region: credentials.region
            },
            input.accountId,
            1,
            // userId
            marketplace
          );
          const apiResponse = await syncService.client.listSpCampaigns();
          return {
            success: true,
            data: {
              accountId: input.accountId,
              marketplace,
              profileId: credentials.profileId,
              region: credentials.region,
              apiResponseCount: Array.isArray(apiResponse) ? apiResponse.length : 0,
              apiResponse,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }
          };
        } catch (error48) {
          return {
            success: false,
            error: error48.message,
            stack: error48.stack,
            // @ts-expect-error - Axios error response access
            details: error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.toString()
          };
        }
      }),
      /**
       * 检查数据库中的campaigns数据
       */
      checkDatabaseCampaigns: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number()
        // @ts-ignore
      })).query(async ({ input }) => {
        try {
          const campaigns6 = await getCampaignsByAccountId(input.accountId);
          return {
            success: true,
            data: {
              accountId: input.accountId,
              campaignCount: campaigns6.length,
              campaigns: campaigns6.slice(0, 10),
              // 只返回前10个
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }
          };
        } catch (error48) {
          return {
            success: false,
            error: error48.message,
            stack: error48.stack
          };
        }
      }),
      /**
       * 检查sync_tasks表
       */
      checkSyncTasks: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        // @ts-ignore
        limit: external_exports.number().default(10)
      })).query(async ({ input }) => {
        try {
          const conn = await getDirectConnection(5e3);
          let tasks = [];
          try {
            const [rows] = await conn.execute(
              `SELECT * FROM sync_tasks 
             WHERE account_id = ? 
             ORDER BY created_at DESC 
             LIMIT ?`,
              [input.accountId, input.limit]
            );
            tasks = rows;
          } finally {
            conn.release();
          }
          return {
            success: true,
            data: {
              accountId: input.accountId,
              taskCount: tasks.length,
              tasks,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }
          };
        } catch (error48) {
          return {
            success: false,
            error: error48.message,
            stack: error48.stack
          };
        }
      }),
      /**
       * 触发全量同步 - 用于手动触发指定账户的全量数据同步
       */
      triggerFullSync: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number()
      })).mutation(async ({ input }) => {
        try {
          const credentials = await getAmazonApiCredentials(input.accountId);
          if (!credentials) {
            return { success: false, error: "\u672A\u627E\u5230API\u51ED\u8BC1" };
          }
          const account = await getAdAccountById(input.accountId);
          const marketplace = account?.marketplace || "US";
          const syncService = await AmazonSyncService.createFromCredentials(
            {
              clientId: credentials.clientId,
              clientSecret: credentials.clientSecret,
              refreshToken: credentials.refreshToken,
              profileId: credentials.profileId,
              region: credentials.region
            },
            input.accountId,
            1,
            marketplace
          );
          const startTime = (/* @__PURE__ */ new Date()).toISOString();
          syncService.syncAll({ syncMode: "recovery" }).then((result) => {
            log193.info(
              `[FullSync] Account ${input.accountId} (${account?.storeName} ${marketplace}) completed:`,
              JSON.stringify(result).substring(0, 500)
            );
          }).catch((err) => {
            log193.warn(`[FullSync] Account ${input.accountId} (${account?.storeName} ${marketplace}) failed:`, err.message);
          });
          return {
            success: true,
            message: `\u5168\u91CF\u540C\u6B65\u5DF2\u89E6\u53D1: ${account?.storeName} ${marketplace} (ID: ${input.accountId})`,
            startTime
          };
        } catch (error48) {
          return {
            success: false,
            error: error48.message,
            stack: error48.stack
          };
        }
      }),
      /**
       * 批量触发所有账户的全量同步
       */
      triggerFullSyncAll: protectedProcedure.mutation(async () => {
        try {
          const accounts = await getAdAccounts();
          const activeAccounts = accounts.filter(
            (a) => a.marketplace && a.marketplace !== "" && a.connectionStatus === "connected"
          );
          // v577: 强阻断 - 检查并记录被跳过的error状态账户
          const errorAccounts = accounts.filter(
            (a) => a.marketplace && a.marketplace !== "" && a.connectionStatus === "error"
          );
          if (errorAccounts.length > 0) {
            log193.warn(`[FullSyncAll] v577: 跳过 ${errorAccounts.length} 个error状态账户: ${errorAccounts.map(a => `${a.id}(${a.storeName} ${a.marketplace}): ${a.connectionErrorMessage || 'unknown'}`).join(', ')}`);
            for (const errAcc of errorAccounts) {
              results.push({ accountId: errAcc.id, store: errAcc.storeName, marketplace: errAcc.marketplace, status: "blocked", reason: `v577: 账户认证失败(error状态), 原因: ${errAcc.connectionErrorMessage || '未知'}. 请重新授权后再同步.` });
            }
          }
          const results = [];
          const startTime = (/* @__PURE__ */ new Date()).toISOString();
          for (const account of activeAccounts) {
            try {
              const credentials = await getAmazonApiCredentials(account.id);
              if (!credentials) {
                results.push({ accountId: account.id, store: account.storeName, marketplace: account.marketplace, status: "skipped", reason: "\u65E0API\u51ED\u8BC1" });
                continue;
              }
              const syncService = await AmazonSyncService.createFromCredentials(
                {
                  // @ts-ignore
                  clientId: credentials.clientId,
                  clientSecret: credentials.clientSecret,
                  // @ts-ignore
                  refreshToken: credentials.refreshToken,
                  profileId: credentials.profileId,
                  region: credentials.region
                },
                // @ts-ignore
                account.id,
                1,
                // @ts-ignore
                account.marketplace || "US"
              );
              syncService.syncAll({ syncMode: "recovery" }).then((result) => {
                log193.info(`[FullSyncAll] Account ${account.id} (${account.storeName} ${account.marketplace}) completed`);
              }).catch((err) => {
                log193.warn(`[FullSyncAll] Account ${account.id} (${account.storeName} ${account.marketplace}) failed: ${err?.message || err?.code || String(err).slice(0, 300) || "unknown error"}`);
              });
              results.push({ accountId: account.id, store: account.storeName, marketplace: account.marketplace, status: "triggered" });
            } catch (err) {
              results.push({ accountId: account.id, store: account.storeName, marketplace: account.marketplace, status: "error", error: err.message });
            }
          }
          return {
            success: true,
            // @ts-ignore
            message: `\u5DF2\u89E6\u53D1 ${results.filter((r) => r.status === "triggered").length} \u4E2A\u8D26\u6237\u7684\u5168\u91CF\u540C\u6B65`,
            startTime,
            accounts: results
          };
        } catch (error48) {
          return {
            success: false,
            error: error48.message
          };
        }
      })
    });
  }
});

