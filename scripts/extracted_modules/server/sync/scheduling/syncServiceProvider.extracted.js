// Extracted from production dist/index.js
// Original module: server/sync/scheduling/syncServiceProvider.ts
// Lines: 77

function registerSyncServiceFactory(factory2) {
  _syncServiceFactory = factory2;
  log30.debug("SyncService \u5DE5\u5382\u51FD\u6570\u5DF2\u6CE8\u518C");
}
async function getAmazonSyncService(accountId) {
  if (!_syncServiceFactory) {
    throw new Error(
      "[SyncServiceProvider] SyncService \u5DE5\u5382\u51FD\u6570\u5C1A\u672A\u6CE8\u518C\u3002\u8BF7\u786E\u4FDD amazonSyncService.ts \u5DF2\u88AB\u5BFC\u5165\u5E76\u5B8C\u6210\u521D\u59CB\u5316\u3002"
    );
  }
  const MAX_RETRIES2 = 2;
  const RETRY_DELAY_MS = 3e3;
  for (let attempt = 0; attempt <= MAX_RETRIES2; attempt++) {
    try {
      const account = await getAdAccountById(accountId);
      if (!account) {
        log30.warn(`[SyncServiceProvider] \u8D26\u53F7 ${accountId} \u4E0D\u5B58\u5728`);
        return null;
      }
      // v620-fix12: 检查账户连接状态，拒绝为未授权账户创建API服务
      if (account.connectionStatus !== "connected") {
        log30.warn(`[SyncServiceProvider] [v620-fix12] \u8D26\u53F7 ${accountId} \u672A\u6388\u6743 (connectionStatus=${account.connectionStatus}), \u62D2\u7EDD\u521B\u5EFAAPI\u670D\u52A1`);
        return null;
      }
      const credentials = await getAmazonApiCredentials(accountId);
      if (!credentials) {
        log30.warn(`[SyncServiceProvider] \u8D26\u53F7 ${accountId} \u672A\u914D\u7F6EAPI\u51ED\u8BC1`);
        return null;
      }
      if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
        log30.warn(`[SyncServiceProvider] \u8D26\u53F7 ${accountId} API\u51ED\u8BC1\u4E0D\u5B8C\u6574`);
        return null;
      }
      if (!account.profileId) {
        log30.warn(`[SyncServiceProvider] \u8D26\u53F7 ${accountId} \u7F3A\u5C11profileId`);
        return null;
      }
      const syncService = await _syncServiceFactory(
        {
          clientId: credentials.clientId || "",
          clientSecret: credentials.clientSecret || "",
          refreshToken: credentials.refreshToken || "",
          profileId: account.profileId || "",
          region: credentials.region || "NA"
        },
        accountId,
        account.userId,
        account.marketplace || "US"
      );
      return syncService;
    } catch (error48) {
      const isRetryable = error48.code === "ECONNRESET" || error48.code === "ETIMEDOUT" || error48.code === "ECONNREFUSED" || error48.code === "PROTOCOL_CONNECTION_LOST" || error48.message?.includes("Connection lost") || error48.message?.includes("ECONNRESET");
      if (isRetryable && attempt < MAX_RETRIES2) {
        const waitTime = RETRY_DELAY_MS * (attempt + 1);
        log30.warn(`[SyncServiceProvider] \u521B\u5EFASyncService\u5931\u8D25(\u53EF\u91CD\u8BD5), \u7B2C${attempt + 1}\u6B21\u91CD\u8BD5, \u7B49\u5F85${waitTime}ms... (accountId=${accountId}): ${error48.message}`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
      log30.warn(`[SyncServiceProvider] \u521B\u5EFASyncService\u5931\u8D25 (accountId=${accountId}, \u5DF2\u91CD\u8BD5${attempt}\u6B21):`, error48.message);
      return null;
    }
  }
  return null;
}
var log30, _syncServiceFactory;
var init_syncServiceProvider = __esm({
  "server/sync/scheduling/syncServiceProvider.ts"() {
    "use strict";
    init_db2();
    init_logger();
    log30 = createModuleLogger("SyncServiceProvider");
    _syncServiceFactory = null;
    __name(registerSyncServiceFactory, "registerSyncServiceFactory");
    __name(getAmazonSyncService, "getAmazonSyncService");
  }
});

