// Extracted from production dist/index.js
// Original module: server/sync/amazonAdsApi.ts
// Lines: 6342

var amazonAdsApi_exports = {};
__export(amazonAdsApi_exports, {
  API_ENDPOINTS: () => API_ENDPOINTS,
  AmazonAdsApiClient: () => AmazonAdsApiClient,
  DEFAULT_REDIRECT_URI: () => DEFAULT_REDIRECT_URI,
  MARKETPLACE_TO_REGION: () => MARKETPLACE_TO_REGION,
  OAUTH_AUTH_ENDPOINTS: () => OAUTH_AUTH_ENDPOINTS,
  VALID_TRAFFIC_DATASETS: () => VALID_TRAFFIC_DATASETS,
  createAmazonAdsClient: () => createAmazonAdsClient,
  validateCredentials: () => validateCredentials
});
function generateUuidV4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function createAmazonAdsClient(credentials) {
  return new AmazonAdsApiClient(credentials);
}
async function validateCredentials(credentials) {
  log29.info("[validateCredentials] \u5F00\u59CB\u9A8C\u8BC1\u51ED\u8BC1:", {
    clientIdPrefix: credentials.clientId?.substring(0, 30) + "...",
    clientSecretPrefix: credentials.clientSecret?.substring(0, 20) + "...",
    refreshTokenPrefix: credentials.refreshToken?.substring(0, 20) + "...",
    profileId: credentials.profileId,
    region: credentials.region
  });
  try {
    const client = new AmazonAdsApiClient(credentials);
    log29.info("[validateCredentials] \u5BA2\u6237\u7AEF\u521B\u5EFA\u6210\u529F\uFF0C\u5F00\u59CB\u83B7\u53D6profiles...");
    const profiles = await client.getProfiles();
    log29.debug(`[validateCredentials] \u83B7\u53D6\u5230 ${profiles.length} \u4E2Aprofiles`);
    return true;
  } catch (error48) {
    log29.warn("[validateCredentials] \u9A8C\u8BC1\u5931\u8D25:", {
      message: error48.message,
      // @ts-expect-error - Axios error response access
      response: error48.response?.data,
      // @ts-expect-error - Axios error response access
      status: error48.response?.status
    });
    return false;
  }
}
var import_json_bigint, log29, JSONBigString, API_ENDPOINTS, OAUTH_TOKEN_URL, OAUTH_AUTH_ENDPOINTS, DEFAULT_REDIRECT_URI, MARKETPLACE_TO_REGION, AmazonAdsApiClient, VALID_TRAFFIC_DATASETS;
var init_amazonAdsApi = __esm({
  "server/sync/amazonAdsApi.ts"() {
    "use strict";
    init_axios2();
    import_json_bigint = __toESM(require_json_bigint());
    init_logger();
    init_apiRateLimitService();
    init_adaptiveRateLimiter();
    init_syncPriorityScheduler();
    log29 = createModuleLogger("AmazonAPI");
    JSONBigString = (0, import_json_bigint.default)({ storeAsString: true });
    API_ENDPOINTS = {
      NA: "https://advertising-api.amazon.com",
      EU: "https://advertising-api-eu.amazon.com",
      FE: "https://advertising-api-fe.amazon.com"
    };
    OAUTH_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
    OAUTH_AUTH_ENDPOINTS = {
      NA: "https://www.amazon.com/ap/oa",
      EU: "https://eu.account.amazon.com/ap/oa",
      FE: "https://apac.account.amazon.com/ap/oa"
    };
    DEFAULT_REDIRECT_URI = "https://www.ppcopt.com/api/auth/callback";
    MARKETPLACE_TO_REGION = {
      US: "NA",
      CA: "NA",
      MX: "NA",
      BR: "NA",
      UK: "EU",
      DE: "EU",
      FR: "EU",
      IT: "EU",
      ES: "EU",
      NL: "EU",
      SE: "EU",
      PL: "EU",
      TR: "EU",
      AE: "EU",
      SA: "EU",
      EG: "EU",
      IN: "EU",
      JP: "FE",
      AU: "FE",
      SG: "FE"
    };
    AmazonAdsApiClient = class _AmazonAdsApiClient {
      static {
        __name(this, "AmazonAdsApiClient");
      }
      credentials;
      accessToken = null;
      tokenExpiry = null;
      axiosInstance;
      // v369: 关联的accountId，用于API限流按账户独立计数
      accountId = 0;
      // v148: Token刷新锁 - 防止并发请求同时触发多次刷新
      tokenRefreshPromise = null;
      // v340: 全局级别Refresh Token刷新锁
      // 解决多个实例共享同一个Refresh Token时的并发刷新竞态条件
      // key = refreshToken的前16位（脱敏）, value = { promise, accessToken, expiry }
      static _globalRefreshLocks = /* @__PURE__ */ new Map();
      static _disconnectedAccounts = /* @__PURE__ */ new Set(); // fix24-P3v3-4.3a: disconnected账户即时熔断集合
      static GLOBAL_LOCK_CLEANUP_INTERVAL = 2 * 60 * 1e3;
      // 5分钟清理一次过期锁
      static _lastCleanup = 0;
      constructor(credentials) {
        this.credentials = credentials;
        // v595: Store accountId from credentials for token persistence
        if (credentials.accountId) {
          this.accountId = credentials.accountId;
        }
        this.axiosInstance = axios_default.create({
          baseURL: API_ENDPOINTS[credentials.region],
          headers: {
            "Amazon-Advertising-API-ClientId": credentials.clientId,
            "Amazon-Advertising-API-Scope": credentials.profileId,
            "Content-Type": "application/json"
          },
          // v509: 添加30秒超时保护，防止Amazon API无限等待导致请求堆积
          timeout: 3e4,
          // 设置responseType为text，确保axios返回原始字符串
          // 这样json-bigint才能正确解析BigInt
          responseType: "text",
          // 使用json-bigint解析响应，防止BigInt精度丢失
          transformResponse: [(data) => {
            if (typeof data === "string") {
              try {
                return JSONBigString.parse(data);
              } catch (e) {
                return data;
              }
            }
            return data;
          }]
        });
        this.axiosInstance.interceptors.request.use(async (config2) => {
          const token = await this.getAccessToken();
          config2.headers.Authorization = `Bearer ${token}`;
          config2._requestStartTime = Date.now();
          try {
            const endpointType = classifyEndpoint(config2.url || "default");
            await acquireApiPermit(this.accountId, endpointType);
          } catch (_) {
          }
          return config2;
        });
        this.axiosInstance.interceptors.response.use(
          (response) => {
            try {
              recordSuccessEvent();
            } catch (_) {
            }
            try {
              const endpointType = classifyEndpoint(response.config?.url || "default");
              recordApiResponseForAdaptiveLimiting(
                this.accountId,
                endpointType,
                response.headers || {},
                Date.now() - (response.config?._requestStartTime || Date.now()),
                response.status
              );
            } catch (_) {
            }
            return response;
          },
          async (error48) => {
            const config2 = error48.config;
            const status = error48.response?.status;
            if (!config2) {
              log29.warn(`[Amazon API] v347: error.config\u4E3Aundefined, status=${status}, message=${error48.message}`);
              // v620-fix14g-P3: fix24-P3-3c 当config为undefined且消息包含Token过期时，标记账户断开
              if (error48.message && (error48.message.includes('Refresh Token') || error48.message.includes('Token\u5237\u65B0\u5931\u8D25') || error48.message.includes('\u8FC7\u671F') || error48.message.includes('invalid_grant'))) {
                try {
                  if (this.credentials?.accountId) {
                    const { updateAdAccountConnectionStatus: updateConnStatus_noconfig } = await Promise.resolve().then(() => (init_accounts(), accounts_exports));
                    await updateConnStatus_noconfig(this.credentials.accountId, 'disconnected', `Token error (no config) at ${new Date().toISOString()}: ${error48.message.substring(0, 200)}`);
                    log29.warn(`[Amazon API] fix24-P3-3c: Account ${this.credentials.accountId} auto-disconnected due to token error (no config)`);
                    _AmazonAdsApiClient._disconnectedAccounts.add(this.credentials.accountId); // fix24-P3v3-4.3f
                  }
                } catch (disconnErr3c) {
                  log29.warn(`[Amazon API] fix24-P3-3c: Failed to auto-disconnect: ${disconnErr3c.message}`);
                }
              }
              return Promise.reject(error48);
            }
            if (!config2._retryCount) {
              config2._retryCount = 0;
            }
            if (status === 401 && (!config2._auth401RetryCount || config2._auth401RetryCount < 2)) {
              const requestUrl = config2?.url || "unknown";
              const profileId = config2?.headers?.["Amazon-Advertising-API-Scope"] || "unknown";
              log29.debug(`[Amazon API] v341: \u6536\u5230401\uFF0C\u6E05\u9664Token\u7F13\u5B58\u5E76\u5F3A\u5236\u91CD\u5237\u65B0 (profileId=${profileId}, URL=${requestUrl})`);
              this.accessToken = null;
              this.tokenExpiry = null;
              const refreshTokenKey = this.credentials.refreshToken.substring(0, 16);
              _AmazonAdsApiClient._globalRefreshLocks.delete(refreshTokenKey);
              config2._auth401RetryCount = (config2._auth401RetryCount || 0) + 1;
              config2._auth401Retried = true;
              // v578: 增加刷新前的短暂等待，避免并发刷新冲突
              await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
              try {
                const newToken = await this.getAccessToken();
                config2.headers.Authorization = `Bearer ${newToken}`;
                log29.debug(`[Amazon API] v341: Token\u91CD\u5237\u65B0\u6210\u529F\uFF0C\u91CD\u8BD5\u8BF7\u6C42 (profileId=${profileId}, URL=${requestUrl})`);
                return this.axiosInstance(config2);
              } catch (refreshErr) {
                log29.warn(`[Amazon API] v341: Token\u91CD\u5237\u65B0\u5931\u8D25: ${refreshErr.message} (profileId=${profileId})`);
                this._triggerAuthFailureAlert(401, "TOKEN_EXPIRED", profileId, requestUrl).catch((alertErr) => {
                  log29.warn(`[Amazon API] v333: \u8BA4\u8BC1\u5931\u8D25\u544A\u8B66\u53D1\u9001\u5931\u8D25: ${alertErr.message}`);
                });
                throw error48;
              }
            }
            if (status === 401 && config2._auth401RetryCount >= 3 || status === 403) {
              const authErrorType = status === 401 ? "TOKEN_EXPIRED" : "PERMISSION_DENIED";
              // v580: PERMISSION_DENIED时记录profileId用于后续自动跳过
              if (authErrorType === "PERMISSION_DENIED") {
                const _pid = config?.headers?.["Amazon-Advertising-API-Scope"] || "unknown";
                log29.warn(`[v580] PERMISSION_DENIED detected for profileId=${_pid}, will be tracked for auto-skip`);
              }
              const requestUrl = config2?.url || "unknown";
              const profileId = config2?.headers?.["Amazon-Advertising-API-Scope"] || "unknown";
              const isSbSdEndpoint = requestUrl.startsWith("/sb/") || requestUrl.startsWith("/sd/");
              if (status === 403 && isSbSdEndpoint) {
                log29.debug(`[Amazon API] v474: SB/SD\u6743\u9650\u4E0D\u8DB3(403), profileId=${profileId}, URL=${requestUrl} (\u8D26\u6237\u53EF\u80FD\u672A\u5F00\u901A\u8BE5\u5E7F\u544A\u7C7B\u578B)`); return Promise.reject(error48);
              } else {
                log29.warn(`[Amazon API] v333: \u8BA4\u8BC1\u5931\u8D25\u544A\u8B66! status=${status}, type=${authErrorType}, profileId=${profileId}, URL=${requestUrl}`);
              }
              this._triggerAuthFailureAlert(status, authErrorType, profileId, requestUrl).catch((alertErr) => {
                log29.warn(`[Amazon API] v333: \u8BA4\u8BC1\u5931\u8D25\u544A\u8B66\u53D1\u9001\u5931\u8D25: ${alertErr.message}`);
              });
            }
            if (status === 425) {
              log29.warn(`[Amazon API] v369.6: HTTP 425 Too Early (\u91CD\u590D\u8BF7\u6C42\u88AB\u62D2\u7EDD), URL: ${config2.url}, \u8DF3\u8FC7\u91CD\u8BD5`);
              return Promise.reject(error48);
            }
            const isRetryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
            const MAX_RETRIES2 = 3;
            if (status === 429) {
              try {
                const endpointType = classifyEndpoint(config2.url || "default");
                getApiRateLimitService().recordExternalThrottle(this.accountId, endpointType);
                recordThrottleEvent();
                const errHeaders = error48.response?.headers || {};
                recordApiResponseForAdaptiveLimiting(
                  this.accountId,
                  endpointType,
                  errHeaders,
                  Date.now() - (config2._requestStartTime || Date.now()),
                  429
                );
              } catch (_) {
              }
            }
            if (isRetryable && config2._retryCount < MAX_RETRIES2) {
              config2._retryCount++;
              let baseDelay = status === 429 ? 5e3 : 2e3;
              const retryAfter = error48.response?.headers?.["retry-after"];
              if (retryAfter) {
                const retryAfterMs = parseInt(retryAfter) * 1e3;
                if (!isNaN(retryAfterMs) && retryAfterMs > 0) {
                  baseDelay = Math.max(baseDelay, retryAfterMs);
                }
              }
              const delay2 = baseDelay * Math.pow(2, config2._retryCount - 1) + Math.random() * 1e3;
              log29.warn(`[Amazon API] v148: \u72B6\u6001\u7801${status}, \u7B2C${config2._retryCount}/${MAX_RETRIES2}\u6B21\u91CD\u8BD5, \u7B49\u5F85${Math.round(delay2)}ms, URL: ${config2.url}`);
              await new Promise((resolve) => setTimeout(resolve, delay2));
              return this.axiosInstance(config2);
            }
            if (error48.response) {
              const contentType = error48.response.headers?.["content-type"] || "";
              const data = error48.response.data;
              if (contentType.includes("text/html") || typeof data === "string" && data.startsWith("<")) {
                if (status === 404 || status === 403) {
                  log29.warn(`[Amazon API] v474: HTML\u54CD\u5E94 status=${status}, URL=${config2?.url} (\u8D26\u6237\u53EF\u80FD\u672A\u5F00\u901A\u8BE5\u5E7F\u544A\u7C7B\u578B)`);
                } else if (status === 429) {
                  log29.warn(`[Amazon API] v474: HTML\u54CD\u5E94 status=429 (API\u9650\u6D41), URL=${config2?.url}`);
                } else {
                  log29.warn(`[Amazon API] v148: HTML\u54CD\u5E94 status=${status}, URL=${config2?.url}`);
                }
                let errorMessage = "Amazon API returned an error page";
                if (status === 401) {
                  errorMessage = "Token\u5DF2\u8FC7\u671F\u6216\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u6388\u6743";
                } else if (status === 403) {
                  errorMessage = "\u6CA1\u6709\u8BBF\u95EE\u6743\u9650\uFF0C\u8BF7\u68C0\u67E5API\u51ED\u8BC1\u548C\u6743\u9650\u8BBE\u7F6E";
                } else if (status === 404) {
                  errorMessage = "API\u7AEF\u70B9\u4E0D\u5B58\u5728\uFF0C\u8BF7\u68C0\u67E5\u8BF7\u6C42URL";
                } else if (status === 429) {
                  errorMessage = `API\u9650\u6D41\uFF0C\u5DF2\u91CD\u8BD5${MAX_RETRIES2}\u6B21\u4ECD\u5931\u8D25`;
                } else if (status >= 500) {
                  errorMessage = `Amazon API\u670D\u52A1\u5668\u9519\u8BEF(${status})\uFF0C\u5DF2\u91CD\u8BD5${config2._retryCount}\u6B21`;
                }
                const enhancedError = new Error(errorMessage);
                enhancedError.originalError = error48;
                enhancedError.status = status;
                enhancedError.isHtmlResponse = true;
                enhancedError.retryCount = config2._retryCount;
                throw enhancedError;
              }
            }
            if (config2._retryCount > 0) {
              error48.retryCount = config2._retryCount;
            }
            throw error48;
          }
        );
      }
      /**
       * 动态设置Profile ID
       * 用于在同一个API客户端实例中切换不同的广告配置文件
       * @param profileId - 新的Profile ID
       */
      setProfileId(profileId) {
        this.credentials.profileId = profileId;
        this.axiosInstance.defaults.headers["Amazon-Advertising-API-Scope"] = profileId;
      }
      /**
       * 获取当前Profile ID
       */
      getProfileId() {
        return this.credentials.profileId;
      }
      /**
       * v333: 认证失败告警触发器
       * 当Amazon API返回401/403时，触发告警通知管理员检查API凭证有效性
       * 包含30分钟冷却机制，防止告警风暴
       */
      static _authAlertCooldowns = /* @__PURE__ */ new Map();
      static AUTH_ALERT_COOLDOWN_MS = 10 * 60 * 1e3;
      // 30分钟冷却
      static _authFailureCounters = /* @__PURE__ */ new Map();
      async _triggerAuthFailureAlert(statusCode, errorType, profileId, requestUrl) {
        const alertKey = `auth_${statusCode}_${profileId}`;
        const now = Date.now();
        const counter = _AmazonAdsApiClient._authFailureCounters.get(alertKey) || { count: 0, firstSeen: now };
        counter.count++;
        _AmazonAdsApiClient._authFailureCounters.set(alertKey, counter);
        const lastAlertTime = _AmazonAdsApiClient._authAlertCooldowns.get(alertKey) || 0;
        if (now - lastAlertTime < _AmazonAdsApiClient.AUTH_ALERT_COOLDOWN_MS) {
          log29.debug(`[Amazon API] v333: \u8BA4\u8BC1\u5931\u8D25\u544A\u8B66\u5728\u51B7\u5374\u671F\u5185, profileId=${profileId}, \u7D2F\u8BA1\u5931\u8D25=${counter.count}\u6B21`);
          return;
        }
        _AmazonAdsApiClient._authAlertCooldowns.set(alertKey, now);
        const severity = counter.count >= 5 ? "critical" : "warning";
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
          const dbInstance = await getDb3();
          if (dbInstance) {
            const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
            await dbInstance.execute(sql15`
          INSERT INTO anomaly_alert_logs (accountId, anomalyType, detectedValue, actionTaken, createdAt)
          VALUES (
            0,
            ${"AUTH_FAILURE_" + errorType},
            ${severity},
            ${JSON.stringify({
              statusCode,
              errorType,
              profileId,
              requestUrl,
              failureCount: counter.count,
              firstSeenAt: new Date(counter.firstSeen).toISOString(),
              alertMessage: statusCode === 401 ? `Amazon API\u8BA4\u8BC1\u5931\u8D25(401 Unauthorized): profileId=${profileId}\u7684API Token\u53EF\u80FD\u5DF2\u8FC7\u671F\u6216\u65E0\u6548\u3002\u8BF7\u7ACB\u5373\u68C0\u67E5\u5E76\u5237\u65B0OAuth Token\u3002\u7D2F\u8BA1\u5931\u8D25${counter.count}\u6B21\u3002` : `Amazon API\u6743\u9650\u62D2\u7EDD(403 Forbidden): profileId=${profileId}\u7F3A\u5C11\u5FC5\u8981\u7684API\u6743\u9650\u3002\u8BF7\u68C0\u67E5\u5E7F\u544A\u8D26\u6237\u6388\u6743\u8303\u56F4\u3002\u7D2F\u8BA1\u5931\u8D25${counter.count}\u6B21\u3002`
            })},
            NOW()
          )
        `);
            log29.warn(`[Amazon API] v333: \u8BA4\u8BC1\u5931\u8D25\u544A\u8B66\u5DF2\u5199\u5165DB: type=${errorType}, profileId=${profileId}, severity=${severity}, count=${counter.count}`);
          }
        } catch (dbErr) {
          log29.warn(`[Amazon API] v333: \u8BA4\u8BC1\u5931\u8D25\u544A\u8B66\u5199\u5165DB\u5931\u8D25: ${dbErr.message}`);
        }
        try {
          const { sendNotification: sendNotification3 } = await Promise.resolve().then(() => (init_notificationService(), notificationService_exports));
          await sendNotification3({
            userId: 0,
            // 系统级告警
            type: "alert",
            severity,
            title: `Amazon API\u8BA4\u8BC1\u5931\u8D25\u544A\u8B66 - ${errorType}`,
            message: statusCode === 401 ? `\u26A0\uFE0F Amazon Advertising API\u8FD4\u56DE401 Unauthorized

Profile ID: ${profileId}
\u8BF7\u6C42URL: ${requestUrl}
\u7D2F\u8BA1\u5931\u8D25: ${counter.count}\u6B21
\u9996\u6B21\u53D1\u73B0: ${new Date(counter.firstSeen).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}

\u5EFA\u8BAE\u64CD\u4F5C: \u8BF7\u7ACB\u5373\u68C0\u67E5\u5E76\u5237\u65B0\u8BE5\u8D26\u6237\u7684OAuth Token\uFF0C\u786E\u4FDDRefresh Token\u672A\u8FC7\u671F\u3002` : `\u26A0\uFE0F Amazon Advertising API\u8FD4\u56DE403 Forbidden

Profile ID: ${profileId}
\u8BF7\u6C42URL: ${requestUrl}
\u7D2F\u8BA1\u5931\u8D25: ${counter.count}\u6B21

\u5EFA\u8BAE\u64CD\u4F5C: \u8BF7\u68C0\u67E5\u5E7F\u544A\u8D26\u6237\u7684API\u6388\u6743\u8303\u56F4\u548C\u6743\u9650\u8BBE\u7F6E\u3002`,
            relatedEntityType: "amazon_api_auth"
          });
          log29.info(`[Amazon API] v333: \u8BA4\u8BC1\u5931\u8D25\u544A\u8B66\u901A\u77E5\u5DF2\u53D1\u9001: profileId=${profileId}`);
        } catch (notifyErr) {
          log29.warn(`[Amazon API] v333: \u8BA4\u8BC1\u5931\u8D25\u544A\u8B66\u901A\u77E5\u53D1\u9001\u5931\u8D25: ${notifyErr.message}`);
        }
        // v577: 自动标记auth_failed - 累计失败>=5次自动将账户标记为error状态
        if (counter.count >= 5) {
          try {
            const { getDb: getDb4 } = await Promise.resolve().then(() => (init_db2(), db_exports));
            const dbInstance2 = await getDb4();
            if (dbInstance2) {
              const { sql: sql16 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
              const matchedAccounts = await dbInstance2.execute(sql16`
                SELECT id, accountName, storeName FROM ad_accounts 
                WHERE profileId = ${profileId} AND connectionStatus = 'connected'
              `);
              if (matchedAccounts && matchedAccounts.length > 0) {
                for (const acc of matchedAccounts) {
                  await dbInstance2.execute(sql16`
                    UPDATE ad_accounts SET 
                      connectionStatus = 'error',
                      connectionErrorMessage = ${'`v577: API认证持续失败, 累计失败次数超过5次. 请重新授权.`'},
                      lastConnectionCheck = NOW()
                    WHERE id = ${acc.id}
                  `);
                  log29.warn(`[Amazon API] v577: 账户 ` + acc.id + `(` + (acc.storeName || '') + `) 因持续认证失败已自动标记为error状态, profileId=` + profileId);
                }
              }
            }
          } catch (markErr) {
            log29.warn("[Amazon API] v577: 自动标记auth_failed失败: " + markErr.message);
          }
        }
        _AmazonAdsApiClient._authFailureCounters.delete(alertKey);
      }
      /**
       * 生成OAuth授权URL
       * @param clientId - 客户端编号
       * @param redirectUri - 回调地址
       * @param region - 地区（NA/EU/FE），默认NA
       * @param state - 状态参数，用于防止CSRF攻击
       */
      static generateAuthUrl(clientId, redirectUri, region = "NA", state) {
        const params = new URLSearchParams({
          client_id: clientId,
          scope: "advertising::campaign_management",
          response_type: "code",
          redirect_uri: redirectUri
        });
        if (state) {
          params.append("state", state);
        }
        const authEndpoint = OAUTH_AUTH_ENDPOINTS[region];
        return `${authEndpoint}?${params.toString()}`;
      }
      /**
       * 生成所有地区的OAuth授权URL
       */
      static generateAllRegionAuthUrls(clientId, redirectUri, state) {
        return {
          NA: this.generateAuthUrl(clientId, redirectUri, "NA", state),
          EU: this.generateAuthUrl(clientId, redirectUri, "EU", state),
          FE: this.generateAuthUrl(clientId, redirectUri, "FE", state)
        };
      }
      /**
       * 使用授权码获取Token
       */
      static async exchangeCodeForToken(code, clientId, clientSecret, redirectUri) {
        const response = await axios_default.post(OAUTH_TOKEN_URL, new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret
        }), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });
        return response.data;
      }
      /**
       * 获取Access Token（自动刷新）
       */
      async getAccessToken() {
        // fix24-P3v3-4.3b: 检查账户是否已被标记为disconnected
        if (this.credentials?.accountId && _AmazonAdsApiClient._disconnectedAccounts.has(this.credentials.accountId)) {
          throw new Error(`[fix24-P3v3-4.3] 账户 ${this.credentials.accountId} 已被标记为disconnected，跳过API请求`);
        }
        if (this.accessToken && this.tokenExpiry && /* @__PURE__ */ new Date() < this.tokenExpiry) {
          const timeToExpiry = this.tokenExpiry.getTime() - Date.now();
          if (timeToExpiry < 20 * 60 * 1e3 && !this.tokenRefreshPromise) {
            log29.debug(`[Amazon API] v614i-fix23: Token\u5C06\u5728${Math.round(timeToExpiry / 1e3)}\u79D2\u540E\u8FC7\u671F\uFF0C\u89E6\u53D1\u4E3B\u52A8\u9884\u5237\u65B0`);
            this.tokenRefreshPromise = this.doRefreshToken().then((token) => {
              log29.debug("[Amazon API] v614i-fix23: \u4E3B\u52A8\u9884\u5237\u65B0\u6210\u529F");
              return token;
            }).catch((err) => {
              log29.warn(`[Amazon API] v614i-fix23: \u4E3B\u52A8\u9884\u5237\u65B0\u5931\u8D25(\u975E\u81F4\u547D): ${err.message}`);
              return this.accessToken;
            }).finally(() => {
              this.tokenRefreshPromise = null;
            });
          }
          return this.accessToken;
        }
        const refreshTokenKey = this.credentials.refreshToken.substring(0, 16);
        const globalLock = _AmazonAdsApiClient._globalRefreshLocks.get(refreshTokenKey);
        if (globalLock && globalLock.accessToken && globalLock.tokenExpiry && /* @__PURE__ */ new Date() < globalLock.tokenExpiry) {
          this.accessToken = globalLock.accessToken;
          this.tokenExpiry = globalLock.tokenExpiry;
          log29.debug(`[Amazon API] v340: \u590D\u7528\u5168\u5C40\u9501\u4E2D\u5DF2\u5237\u65B0\u7684Token (refreshToken=${refreshTokenKey}...)`);
          return this.accessToken;
        }
        if (this.tokenRefreshPromise) {
          return this.tokenRefreshPromise;
        }
        if (globalLock && globalLock.promise) {
          log29.debug(`[Amazon API] v340: \u7B49\u5F85\u5168\u5C40\u9501\u4E2D\u7684\u5E76\u53D1\u5237\u65B0 (refreshToken=${refreshTokenKey}...)`);
          try {
            const token = await globalLock.promise;
            this.accessToken = token;
            this.tokenExpiry = globalLock.tokenExpiry;
            return token;
          } catch (e) {
            log29.warn(`[Amazon API] v340: \u5168\u5C40\u9501\u5237\u65B0\u5931\u8D25\uFF0C\u672C\u5B9E\u4F8B\u5C06\u91CD\u65B0\u5C1D\u8BD5`);
          }
        }
        this.tokenRefreshPromise = this.doRefreshToken();
        const globalEntry = {
          promise: this.tokenRefreshPromise,
          accessToken: null,
          tokenExpiry: null
        };
        _AmazonAdsApiClient._globalRefreshLocks.set(refreshTokenKey, globalEntry);
        try {
          const token = await this.tokenRefreshPromise;
          globalEntry.accessToken = this.accessToken;
          globalEntry.tokenExpiry = this.tokenExpiry;
          return token;
        } finally {
          this.tokenRefreshPromise = null;
          this._cleanupGlobalLocks();
        }
      }
      /**
       * v340: 清理过期的全局刷新锁条目，防止内存泄漏
       */
      _cleanupGlobalLocks() {
        const now = Date.now();
        if (now - _AmazonAdsApiClient._lastCleanup < _AmazonAdsApiClient.GLOBAL_LOCK_CLEANUP_INTERVAL) {
          return;
        }
        _AmazonAdsApiClient._lastCleanup = now;
        const currentDate = /* @__PURE__ */ new Date();
        for (const [key, entry] of _AmazonAdsApiClient._globalRefreshLocks.entries()) {
          if (entry.tokenExpiry && currentDate > entry.tokenExpiry) {
            _AmazonAdsApiClient._globalRefreshLocks.delete(key);
          }
        }
      }
      /**
       * v148: 实际执行Token刷新的内部方法
       */
      async doRefreshToken() {
        const MAX_TOKEN_RETRIES = 3;
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_TOKEN_RETRIES; attempt++) {
          try {
            log29.debug(`[Amazon API] Refreshing access token... (attempt ${attempt}/${MAX_TOKEN_RETRIES})`);
            const response = await axios_default.post(OAUTH_TOKEN_URL, new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: this.credentials.refreshToken,
              client_id: this.credentials.clientId,
              client_secret: this.credentials.clientSecret
            }), {
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              // @ts-ignore
              timeout: 15e3
            });
            this.accessToken = response.data.access_token;
            this.tokenExpiry = new Date(Date.now() + (response.data.expires_in - 300) * 1e3);
            log29.debug("[Amazon API] Access token refreshed successfully");
            // v595: Persist tokenExpiresAt to DB to prevent stale expiry display
            try {
              if (this.credentials && this.credentials.accountId) {
                const { updateAmazonApiCredentials: updateCreds595 } = await Promise.resolve().then(() => (init_credentials(), credentials_exports));
                await updateCreds595(this.credentials.accountId, {
                  accessToken: this.accessToken,
                  tokenExpiresAt: this.tokenExpiry.toISOString()
                });
                log29.debug(`[Amazon API] v595: tokenExpiresAt persisted to DB for account ${this.credentials.accountId}`);
              }
            } catch (persistErr) {
              log29.debug(`[Amazon API] v595: Failed to persist tokenExpiresAt: ${persistErr.message} (non-fatal)`);
            }
            return this.accessToken;
          } catch (error48) {
            lastError = error48;
            if (error48.response) {
              const contentType = error48.response.headers?.["content-type"] || "";
              const data = error48.response.data;
              if (contentType.includes("text/html") || typeof data === "string" && data.startsWith("<")) {
                log29.warn("[Amazon API] Token refresh returned HTML instead of JSON");
                this.accessToken = null;
                this.tokenExpiry = null;
                // v620-fix14g-P3: fix24-P3-3 HTML响应也触发自动断开连接（与invalid_grant一致）
                try {
                  if (this.credentials?.accountId) {
                    const { updateAdAccountConnectionStatus: updateConnStatus_html } = await Promise.resolve().then(() => (init_accounts(), accounts_exports));
                    await updateConnStatus_html(this.credentials.accountId, 'disconnected', `HTML response during token refresh at ${new Date().toISOString()} - possible token expiry`);
                    log29.warn(`[Amazon API] fix24-P3-3: Account ${this.credentials.accountId} auto-disconnected due to HTML token response`);
                    _AmazonAdsApiClient._disconnectedAccounts.add(this.credentials.accountId); // fix24-P3v3-4.3c
                  }
                } catch (disconnErr3) {
                  log29.warn(`[Amazon API] fix24-P3-3: Failed to auto-disconnect: ${disconnErr3.message}`);
                }
                throw new Error("Token\u5237\u65B0\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u6388\u6743\u3002\u53EF\u80FD\u539F\u56E0\uFF1ARefresh Token\u5DF2\u8FC7\u671F\u6216\u65E0\u6548");
              }
              if (error48.response.status === 400) {
                const errorData = error48.response.data;
                if (errorData?.error === "invalid_grant") {
                  this.accessToken = null;
                  this.tokenExpiry = null;
                  // v620-fix13: P0-3 Fix - Auto-disconnect account on invalid_grant
                  try {
                    if (this.credentials?.accountId) {
                      const { updateAdAccountConnectionStatus: updateConnStatus_ig } = await Promise.resolve().then(() => (init_accounts(), accounts_exports));
                      await updateConnStatus_ig(this.credentials.accountId, 'disconnected', `invalid_grant detected at ${new Date().toISOString()} - Refresh Token expired or revoked`);
                      log29.warn(`[Amazon API] v620-fix13: Account ${this.credentials.accountId} connectionStatus set to 'disconnected' due to invalid_grant`);
                      _AmazonAdsApiClient._disconnectedAccounts.add(this.credentials.accountId); // fix24-P3v3-4.3d
                    } else {
                      log29.warn(`[Amazon API] v620-fix13: Cannot auto-disconnect - no accountId in credentials`);
                    }
                  } catch (disconnErr) {
                    log29.warn(`[Amazon API] v620-fix13: Failed to auto-disconnect account: ${disconnErr.message}`);
                  }
                  try {
                    const { notifyOwner: notifyOwner2 } = await Promise.resolve().then(() => (init_notification(), notification_exports));
                    const accountLabel = this.credentials.profileId ? `ProfileId=${this.credentials.profileId}` : `RefreshToken=${this.credentials.refreshToken?.substring(0, 16)}...`;
                    await notifyOwner2({
                      title: `\u26A0\uFE0F [Amazon\u5E7F\u544A\u7CFB\u7EDF] Token\u6388\u6743\u5931\u6548 - \u5DF2\u81EA\u52A8\u65AD\u5F00\u8FDE\u63A5`,
                      content: [
                        `\u8D26\u53F7: ${this.credentials?.accountId || 'unknown'} (${accountLabel})`,
                        `\u9519\u8BEF\u7C7B\u578B: invalid_grant (400)`,
                        `\u9519\u8BEF\u8BE6\u60C5: ${JSON.stringify(errorData)}`,
                        `\u53D1\u751F\u65F6\u95F4: ${(/* @__PURE__ */ new Date()).toISOString()}`,
                        ``,
                        `\u5F71\u54CD: \u8BE5\u8D26\u53F7\u7684\u6240\u6709\u5E7F\u544A\u6570\u636E\u540C\u6B65\u548C\u4F18\u5316\u6307\u4EE4\u4E0B\u53D1\u5C06\u5168\u9762\u4E2D\u65AD\uFF01`,
                        `\u81EA\u52A8\u5904\u7406: \u8D26\u53F7connectionStatus\u5DF2\u81EA\u52A8\u8BBE\u4E3Adisconnected\uFF0C\u540C\u6B65\u548C\u4F18\u5316\u5DF2\u505C\u6B62`,
                        `\u64CD\u4F5C: \u8BF7\u8FD0\u8425\u56E2\u961F\u767B\u5F55\u7CFB\u7EDF\u524D\u7AEF\uFF0C\u4E3A\u8BE5\u8D26\u53F7\u91CD\u65B0\u5B8C\u6210 Amazon OAuth \u6388\u6743\u6D41\u7A0B`
                      ].join("\n")
                    });
                    log29.warn(`[Amazon API] v535: invalid_grant\u544A\u8B66\u5DF2\u53D1\u9001 - ${accountLabel}`);
                  } catch (notifyErr) {
                    log29.warn(`[Amazon API] v535: invalid_grant\u544A\u8B66\u53D1\u9001\u5931\u8D25: ${notifyErr.message}`);
                  }
                  throw new Error("Refresh Token\u5DF2\u8FC7\u671F\u6216\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u6388\u6743");
                }
              }
              if (error48.response.status === 401 || error48.response.status === 403) {
                this.accessToken = null;
                this.tokenExpiry = null;
                // v620-fix14g-P3: fix24-P3-3b 401/403也触发自动断开
                try {
                  if (this.credentials?.accountId) {
                    const { updateAdAccountConnectionStatus: updateConnStatus_auth } = await Promise.resolve().then(() => (init_accounts(), accounts_exports));
                    await updateConnStatus_auth(this.credentials.accountId, 'disconnected', `Token refresh ${error48.response.status} at ${new Date().toISOString()}`);
                    log29.warn(`[Amazon API] fix24-P3-3b: Account ${this.credentials.accountId} auto-disconnected due to ${error48.response.status} during token refresh`);
                    _AmazonAdsApiClient._disconnectedAccounts.add(this.credentials.accountId); // fix24-P3v3-4.3e
                  }
                } catch (disconnErr3b) {
                  log29.warn(`[Amazon API] fix24-P3-3b: Failed to auto-disconnect: ${disconnErr3b.message}`);
                }
                throw new Error(`Token\u5237\u65B0\u8BA4\u8BC1\u5931\u8D25(${error48.response.status})\uFF0C\u8BF7\u68C0\u67E5API\u51ED\u8BC1`);
              }
            }
            log29.warn(`[Amazon API] Token refresh attempt ${attempt}/${MAX_TOKEN_RETRIES} failed: ${error48.message}`);
            if (attempt < MAX_TOKEN_RETRIES) {
              const delay2 = Math.pow(2, attempt) * 1e3 + Math.random() * 1e3;
              log29.debug(`[Amazon API] Retrying token refresh in ${Math.round(delay2)}ms...`);
              await new Promise((r) => setTimeout(r, delay2));
            }
          }
        }
        this.accessToken = null;
        this.tokenExpiry = null;
        log29.warn(`[Amazon API] Token refresh failed after ${MAX_TOKEN_RETRIES} attempts: ${lastError?.message}`);
        throw lastError;
      }
      /**
       * 获取广告配置文件列表
       * 注意：获取profiles时不需要Amazon-Advertising-API-Scope header
       */
      async getProfiles() {
        const token = await this.getAccessToken();
        const response = await axios_default.get(`${API_ENDPOINTS[this.credentials.region]}/v2/profiles`, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Amazon-Advertising-API-ClientId": this.credentials.clientId,
            "Content-Type": "application/json"
          }
        });
        return response.data;
      }
      // ==================== Sponsored Products API ====================
      /**
       * 获取SP广告活动列表
       * 注意：SP API v3需要特定的Content-Type header
       * 如果vendor MIME type失败，回退到application/json
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSpCampaigns(filters) {
        const allCampaigns = [];
        let nextToken;
        const headerVariants = [
          { "Content-Type": "application/vnd.spCampaign.v3+json", "Accept": "application/vnd.spCampaign.v3+json" },
          { "Content-Type": "application/json", "Accept": "application/json" }
        ];
        let workingHeaders = null;
        let lastError = null;
        do {
          const body = {
            maxResults: 100,
            // 请求扩展字段，包括startDate和endDate
            includeExtendedDataFields: true
          };
          if (filters?.stateFilter) {
            body.stateFilter = { include: [filters.stateFilter] };
          }
          if (filters?.nameFilter) {
            body.nameFilter = { queryTermMatchType: "BROAD_MATCH", include: [filters.nameFilter] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          if (workingHeaders) {
            try {
              const response = await this.axiosInstance.post("/sp/campaigns/list", body, { headers: workingHeaders });
              const campaigns6 = response.data.campaigns || [];
              allCampaigns.push(...campaigns6);
              nextToken = response.data.nextToken;
              log29.debug(`[SP API] Fetched ${campaigns6.length} campaigns, total: ${allCampaigns.length}, hasMore: ${!!nextToken}`);
            } catch (error48) {
              log29.warn("[SP API] Error fetching campaigns:", error48.message);
              throw error48;
            }
          } else {
            for (const headers of headerVariants) {
              try {
                const response = await this.axiosInstance.post("/sp/campaigns/list", body, { headers });
                workingHeaders = headers;
                const campaigns6 = response.data.campaigns || [];
                allCampaigns.push(...campaigns6);
                nextToken = response.data.nextToken;
                log29.debug(`[SP API] Fetched ${campaigns6.length} campaigns, total: ${allCampaigns.length}, hasMore: ${!!nextToken}`);
                break;
              } catch (error48) {
                lastError = error48;
                if (error48.response?.status === 415) {
                  log29.warn(`SP campaigns list failed with headers ${JSON.stringify(headers)}, trying next variant...`);
                  continue;
                }
                throw error48;
              }
            }
            if (!workingHeaders) {
              throw lastError;
            }
          }
        } while (nextToken);
        log29.debug(`[SP API] Total campaigns fetched: ${allCampaigns.length}`);
        if (allCampaigns.length > 0) {
          log29.debug("[SP API DEBUG] First campaign full structure:", JSON.stringify(allCampaigns[0], null, 2));
          log29.debug("[SP API DEBUG] First campaign startDate:", allCampaigns[0].startDate);
          log29.debug("[SP API DEBUG] First campaign keys:", Object.keys(allCampaigns[0]));
        }
        return allCampaigns;
      }
      /**
       * 创建SP广告活动
       */
      async createSpCampaign(campaign) {
        const response = await this.axiosInstance.post("/sp/campaigns", {
          campaigns: [campaign]
        }, {
          headers: {
            "Content-Type": "application/vnd.spCampaign.v3+json",
            "Accept": "application/vnd.spCampaign.v3+json"
          }
        });
        return response.data.campaigns[0];
      }
      /**
       * 更新SP广告活动
       */
      async updateSpCampaign(campaignId, updates) {
        const formattedUpdates = { ...updates };
        if (formattedUpdates.dailyBudget !== void 0) {
          formattedUpdates.dailyBudget = Number(Number(formattedUpdates.dailyBudget).toFixed(2));
        }
        const requestBody = { campaigns: [{ campaignId: String(campaignId), ...formattedUpdates }] };
        log29.debug(`[SP API] updateSpCampaign \u8BF7\u6C42\u4F53:`, JSON.stringify(requestBody).substring(0, 500));
        await this.axiosInstance.put("/sp/campaigns", requestBody, {
          headers: {
            "Content-Type": "application/vnd.spCampaign.v3+json",
            "Accept": "application/vnd.spCampaign.v3+json"
          }
        });
      }
      /**
       * 获取SP广告组列表
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSpAdGroups(campaignId) {
        const allAdGroups = [];
        let nextToken;
        const headerVariants = [
          { "Content-Type": "application/vnd.spAdGroup.v3+json", "Accept": "application/vnd.spAdGroup.v3+json" },
          { "Content-Type": "application/json", "Accept": "application/json" }
        ];
        let workingHeaders = null;
        let lastError = null;
        do {
          const body = { maxResults: 100 };
          if (campaignId) {
            body.campaignIdFilter = { include: [String(campaignId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          if (workingHeaders) {
            try {
              const response = await this.axiosInstance.post("/sp/adGroups/list", body, { headers: workingHeaders });
              const adGroups6 = response.data.adGroups || [];
              allAdGroups.push(...adGroups6);
              nextToken = response.data.nextToken;
              log29.debug(`[SP API] Fetched ${adGroups6.length} ad groups, total: ${allAdGroups.length}, hasMore: ${!!nextToken}`);
            } catch (error48) {
              log29.warn("[SP API] Error fetching ad groups:", error48.message);
              throw error48;
            }
          } else {
            for (const headers of headerVariants) {
              try {
                const response = await this.axiosInstance.post("/sp/adGroups/list", body, { headers });
                workingHeaders = headers;
                const adGroups6 = response.data.adGroups || [];
                allAdGroups.push(...adGroups6);
                nextToken = response.data.nextToken;
                log29.debug(`[SP API] Fetched ${adGroups6.length} ad groups, total: ${allAdGroups.length}, hasMore: ${!!nextToken}`);
                break;
              } catch (error48) {
                lastError = error48;
                if (error48.response?.status === 415) {
                  continue;
                }
                throw error48;
              }
            }
            if (!workingHeaders) {
              throw lastError;
            }
          }
        } while (nextToken);
        log29.debug(`[SP API] Total ad groups fetched: ${allAdGroups.length}`);
        return allAdGroups;
      }
      /**
       * 获取SP关键词列表
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSpKeywords(adGroupId) {
        const allKeywords = [];
        let nextToken;
        const headerVariants = [
          { "Content-Type": "application/vnd.spKeyword.v3+json", "Accept": "application/vnd.spKeyword.v3+json" },
          { "Content-Type": "application/json", "Accept": "application/json" }
        ];
        let workingHeaders = null;
        let lastError = null;
        do {
          const body = { maxResults: 100 };
          if (adGroupId) {
            body.adGroupIdFilter = { include: [String(adGroupId)] };
          }
          body.stateFilter = { include: ["ENABLED", "PAUSED", "ARCHIVED"] };
          if (nextToken) {
            body.nextToken = nextToken;
          }
          if (workingHeaders) {
            try {
              const response = await this.axiosInstance.post("/sp/keywords/list", body, { headers: workingHeaders });
              const keywords10 = response.data.keywords || [];
              allKeywords.push(...keywords10);
              nextToken = response.data.nextToken;
              log29.debug(`[SP API] Fetched ${keywords10.length} keywords, total: ${allKeywords.length}, hasMore: ${!!nextToken}`);
            } catch (error48) {
              log29.warn(`[SP API] Error fetching keywords: ${error48.message} ${error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 200) : ""}`);
              throw error48;
            }
          } else {
            for (const headers of headerVariants) {
              try {
                const response = await this.axiosInstance.post("/sp/keywords/list", body, { headers });
                workingHeaders = headers;
                const keywords10 = response.data.keywords || [];
                allKeywords.push(...keywords10);
                nextToken = response.data.nextToken;
                log29.debug(`[SP API] Fetched ${keywords10.length} keywords, total: ${allKeywords.length}, hasMore: ${!!nextToken}`);
                break;
              } catch (error48) {
                lastError = error48;
                log29.warn(`[SP API] listSpKeywords header variant failed (status=${error48.response?.status}):`, error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 200) : error48.message);
                if (error48.response?.status === 415 || error48.response?.status === 400) {
                  continue;
                }
                throw error48;
              }
            }
            if (!workingHeaders) {
              throw lastError;
            }
          }
        } while (nextToken);
        log29.debug(`[SP API] Total keywords fetched: ${allKeywords.length}`);
        return allKeywords;
      }
      /**
       * 创建SP关键词（用于搜索词收割：将高转化搜索词添加为精确匹配关键词）
       */
      async createSpKeywords(keywords10) {
        const BATCH_SIZE = 1e3;
        const BATCH_DELAY_MS = 300;
        const allCreatedKeywords = [];
        const allErrors = [];
        const totalBatches = Math.ceil(keywords10.length / BATCH_SIZE);
        log29.info(`[SP API] v199: createSpKeywords \u5206\u6279\u5904\u7406: \u603B\u8BA1${keywords10.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batchKeywords = keywords10.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          log29.info(`[SP API] v199: \u7B2C${batchIdx + 1}/${totalBatches}\u6279: ${batchKeywords.length}\u4E2A\u5173\u952E\u8BCD\u521B\u5EFA`);
          try {
            const formattedKeywords = batchKeywords.map((k) => ({
              adGroupId: String(k.internal_ad_group_id),
              campaignId: String(k.campaignId),
              keywordText: k.keywordText,
              matchType: (k.matchType || "EXACT").toUpperCase(),
              bid: Number(k.bid.toFixed(2)),
              state: (k.state || "enabled").toUpperCase()
            }));
            const requestBody = { keywords: formattedKeywords };
            const response = await this.axiosInstance.post("/sp/keywords", requestBody, {
              headers: {
                "Content-Type": "application/vnd.spKeyword.v3+json",
                "Accept": "application/vnd.spKeyword.v3+json"
              }
            });
            const responseKeywords = response.data?.keywords;
            if (responseKeywords && typeof responseKeywords === "object" && !Array.isArray(responseKeywords)) {
              if (responseKeywords.success && Array.isArray(responseKeywords.success)) {
                for (const item of responseKeywords.success) {
                  const idx = item.index || 0;
                  allCreatedKeywords.push({
                    keywordId: item.keywordId,
                    keywordText: batchKeywords[idx]?.keywordText || "",
                    code: "SUCCESS"
                  });
                }
              }
              if (responseKeywords.error && Array.isArray(responseKeywords.error)) {
                for (const item of responseKeywords.error) {
                  allErrors.push(item);
                  const errorDetail = item.description || item.details || item.message || "";
                  allCreatedKeywords.push({
                    keywordId: null,
                    keywordText: batchKeywords[item.index]?.keywordText || "",
                    code: item.code || "ERROR"
                  });
                  log29.warn(`[SP API] v168: \u5173\u952E\u8BCD\u521B\u5EFA\u5931\u8D25\u8BE6\u60C5: keyword="${batchKeywords[item.index]?.keywordText}", code=${item.code}, description="${errorDetail}"`);
                }
              }
            } else if (Array.isArray(responseKeywords)) {
              for (const k of responseKeywords) {
                allCreatedKeywords.push({
                  keywordId: k.keywordId,
                  keywordText: k.keywordText || "",
                  code: k.code || "SUCCESS"
                });
                if (k.code && k.code !== "SUCCESS") allErrors.push(k);
              }
            }
          } catch (error48) {
            log29.warn(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u5173\u952E\u8BCD\u521B\u5EFAAPI\u8C03\u7528\u5931\u8D25: ${error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message}`);
            for (const kw of batchKeywords) {
              allCreatedKeywords.push({ keywordId: null, keywordText: kw.keywordText, code: "BATCH_ERROR" });
              allErrors.push({ keywordText: kw.keywordText, code: "BATCH_ERROR", details: error48.message });
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.warn(`[SP API] v199: \u5173\u952E\u8BCD\u521B\u5EFA\u5B8C\u6210: \u603B\u8BA1=${keywords10.length}, \u6210\u529F=${allCreatedKeywords.length - allErrors.length}, \u5931\u8D25=${allErrors.length}`);
        return { success: allErrors.length === 0, createdKeywords: allCreatedKeywords, errors: allErrors };
      }
      /**
       * 更新关键词出价
       */
      async updateKeywordBids(updates) {
        // v587: SP关键词去重 - 防御性编程
        const _spDedupMap = new Map();
        for (const u of updates) { _spDedupMap.set(String(u.keywordId), u); }
        if (_spDedupMap.size < updates.length) {
          log29.info(`[v587] SP API内部去重: ${updates.length} -> ${_spDedupMap.size}`);
          updates = Array.from(_spDedupMap.values());
        }
        const BATCH_SIZE = 1e3;
        const BATCH_DELAY_MS = 300;
        const allErrors = [];
        const allRequestIds = [];
        let totalSuccess = 0;
        const formattedAll = updates.map((u) => ({
          keywordId: String(u.keywordId),
          bid: Number(u.bid.toFixed(2))
        }));
        const totalBatches = Math.ceil(formattedAll.length / BATCH_SIZE);
        log29.info(`[SP API] v199: updateKeywordBids \u5206\u6279\u5904\u7406: \u603B\u8BA1${formattedAll.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          let currentBatch = formattedAll.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          log29.info(`[SP API] v199: \u7B2C${batchIdx + 1}/${totalBatches}\u6279: ${currentBatch.length}\u4E2A\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0`);
          const MAX_ENTITY_RETRIES = 10;
          let entityRetryCount = 0;
          const removedKeywordIds = [];
          let batchCompleted = false;
          while (!batchCompleted && currentBatch.length > 0) {
            const requestBody = { keywords: currentBatch };
            try {
              const response = await this.axiosInstance.put("/sp/keywords", requestBody, {
                headers: {
                  "Content-Type": "application/vnd.spKeyword.v3+json",
                  "Accept": "application/vnd.spKeyword.v3+json"
                }
              });
              const requestId = response.headers?.["x-amzn-requestid"] || response.headers?.["x-amz-request-id"] || response.headers?.["requestid"] || "";
              if (requestId) {
                allRequestIds.push(requestId);
                log29.info(`[SP API] v333: \u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0 batch#${batchIdx + 1} requestId=${requestId}`);
              }
              const responseKeywords = response.data?.keywords;
              if (responseKeywords && typeof responseKeywords === "object" && !Array.isArray(responseKeywords)) {
                if (responseKeywords.error && Array.isArray(responseKeywords.error)) {
                  for (const err of responseKeywords.error) {
                    const failedIndex = typeof err.index === "number" ? err.index : void 0;
                    const failedKeywordId = err.keywordId || (failedIndex !== void 0 ? currentBatch[failedIndex]?.keywordId : "unknown");
                    const errorCode = err.code || err.errorCode || "ERROR";
                    const errorDetails = err.description || err.details || err.message || err.errorMessage || err.errorDescription || "";
                    const fullErrorStr = JSON.stringify(err).substring(0, 300);
                    allErrors.push({ keywordId: failedKeywordId, code: errorCode, details: errorDetails || fullErrorStr });
                    if (fullErrorStr.includes("entityNotFoundError") || fullErrorStr.includes("entityStateError")) {
                      log29.warn(`[SP API] v474: \u5173\u952E\u8BCD\u5DF2\u5220\u9664/\u5F52\u6863: keywordId=${failedKeywordId}, error=${fullErrorStr.slice(0, 150)}`);
                      removedKeywordIds.push(String(failedKeywordId));
                    } else {
                      log29.warn(`[SP API] v444: \u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5931\u8D25: keywordId=${failedKeywordId}, index=${failedIndex}, code=${errorCode}, details=${errorDetails}, fullError=${fullErrorStr}`);
                    }
                  }
                }
                if (responseKeywords.success && Array.isArray(responseKeywords.success)) {
                  totalSuccess += responseKeywords.success.length;
                  for (const item of responseKeywords.success) {
                    const successKeywordId = item.keywordId || (typeof item.index === "number" ? currentBatch[item.index]?.keywordId : "unknown");
                    log29.debug(`[SP API] v426: \u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u6210\u529F: keywordId=${successKeywordId}`);
                  }
                }
              } else if (Array.isArray(response.data)) {
                for (const item of response.data) {
                  if (item.code === "SUCCESS") {
                    totalSuccess++;
                  } else {
                    allErrors.push({ keywordId: item.keywordId, code: item.code || "ERROR", details: item.description || item.details || "" });
                    log29.warn(`[SP API] v426: \u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5931\u8D25(v2): keywordId=${item.keywordId}, code=${item.code}, details=${item.description || item.details}`);
                  }
                }
              } else {
                log29.warn(`[SP API] v426: \u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u54CD\u5E94\u683C\u5F0F\u672A\u77E5, HTTP\u72B6\u6001=${response.status}, \u5047\u8BBEbatch#${batchIdx + 1}\u7684${currentBatch.length}\u4E2A\u66F4\u65B0\u6210\u529F`);
                totalSuccess += currentBatch.length;
              }
              batchCompleted = true;
            } catch (batchErr) {
              const errResponse = batchErr?.response;
              const errData = errResponse?.data;
              const errString = typeof errData === "string" ? errData : JSON.stringify(errData || "");
              const errRequestId = errResponse?.headers?.["x-amzn-requestid"] || errResponse?.headers?.["x-amz-request-id"] || "";
              if (errRequestId) {
                allRequestIds.push(errRequestId);
              }
              const isEntityNotFound = errString.includes("entityNotFoundError") || errString.includes("ENTITY_NOT_FOUND") || errString.includes("entityStateError");
              if (isEntityNotFound && entityRetryCount < MAX_ENTITY_RETRIES) {
                const badKeywordIds = [];
                try {
                  const errObj = typeof errData === "string" ? JSON.parse(errData) : errData;
                  const errors = errObj?.errors || [];
                  for (const err of errors) {
                    const entityId = err?.errorValue?.entityNotFoundError?.entityId || err?.errorValue?.entityStateError?.entityId || "";
                    const trigger = err?.errorValue?.entityNotFoundError?.cause?.trigger || err?.errorValue?.entityStateError?.cause?.trigger || "";
                    if (entityId) badKeywordIds.push(String(entityId));
                    else if (trigger) badKeywordIds.push(String(trigger));
                  }
                } catch (_) {
                  const matches = errString.match(/entityId[":\s]+["](\d{10,})/g) || [];
                  for (const m of matches) {
                    const id = m.match(/(\d{10,})/);
                    if (id) badKeywordIds.push(id[1]);
                  }
                  if (badKeywordIds.length === 0) {
                    const triggerMatches = errString.match(/trigger[":\s]+["](\d{10,})/g) || [];
                    for (const m of triggerMatches) {
                      const id = m.match(/(\d{10,})/);
                      if (id) badKeywordIds.push(id[1]);
                    }
                  }
                }
                if (badKeywordIds.length > 0) {
                  const badSet = new Set(badKeywordIds);
                  const beforeCount = currentBatch.length;
                  currentBatch = currentBatch.filter((item) => !badSet.has(item.keywordId));
                  removedKeywordIds.push(...badKeywordIds);
                  entityRetryCount++;
                  for (const badId of badKeywordIds) {
                    allErrors.push({ keywordId: badId, code: "ENTITY_NOT_FOUND", details: "Amazon\u7AEF\u5DF2\u4E0D\u5B58\u5728\uFF0C\u5DF2\u81EA\u52A8\u79FB\u9664\u5E76\u91CD\u8BD5\u5269\u4F59\u6279\u6B21" });
                  }
                  log29.warn(`[SP API] v477: entityNotFoundError\u667A\u80FD\u91CD\u8BD5(${entityRetryCount}/${MAX_ENTITY_RETRIES}): \u79FB\u9664${badKeywordIds.length}\u4E2A\u574Fkeyword(${badKeywordIds.join(",")}), \u6279\u6B21\u4ECE${beforeCount}\u51CF\u81F3${currentBatch.length}, \u7B49\u5F855\u79D2\u540E\u91CD\u8BD5...`);
                  await new Promise((resolve) => setTimeout(resolve, 5e3));
                  continue;
                }
              }
              log29.warn(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u51FA\u4EF7\u66F4\u65B0API\u8C03\u7528\u5931\u8D25: ${batchErr.message}`);
              for (const item of currentBatch) {
                allErrors.push({ keywordId: item.keywordId, code: "BATCH_ERROR", details: batchErr.message });
              }
              batchCompleted = true;
            }
          }
          if (removedKeywordIds.length > 0) {
            try {
              const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
              const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
              const db = await getDb3();
              if (db) {
                const idList = removedKeywordIds.map((id) => String(id));
                await db.execute(
                  sql15.raw(`UPDATE keywords SET keywordStatus = 'amazon_deleted' WHERE keywordId IN (${idList.map((id) => `'${id}'`).join(",")})`)
                );
                log29.warn(`[SP API] v477: \u5DF2\u6807\u8BB0${removedKeywordIds.length}\u4E2AentityNotFound\u5173\u952E\u8BCD\u4E3Aamazon_deleted: ${removedKeywordIds.slice(0, 5).join(", ")}`);
              }
            } catch (markErr) {
              log29.warn(`[SP API] v477: \u6807\u8BB0\u8FC7\u671F\u5173\u952E\u8BCD\u5931\u8D25: ${markErr.message}`);
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.warn(`[SP API] v199: \u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u603B\u8BA1=${updates.length}, \u6210\u529F=${totalSuccess}, \u5931\u8D25=${allErrors.length}, requestIds=${allRequestIds.length}`);
        return { success: allErrors.length === 0, errors: allErrors, requestIds: allRequestIds };
      }
      /**
       * v134: 更新关键词状态（enabled/paused/archived）
       * 通过 PUT /sp/keywords API 更新关键词的 state 字段
       * 这是确保优化系统的暂停/启用决策同步到Amazon的关键方法
       */
      async updateKeywordStatus(updates) {
        const BATCH_SIZE = 1e3;
        const BATCH_DELAY_MS = 300;
        const allErrors = [];
        let totalSuccess = 0;
        const formattedAll = updates.map((u) => ({
          keywordId: String(u.keywordId),
          state: u.state.toUpperCase()
        }));
        const totalBatches = Math.ceil(formattedAll.length / BATCH_SIZE);
        log29.info(`[SP API] v199: updateKeywordStatus \u5206\u6279\u5904\u7406: \u603B\u8BA1${formattedAll.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          let currentBatch = formattedAll.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          const MAX_ENTITY_RETRIES = 10;
          let entityRetryCount = 0;
          let batchCompleted = false;
          while (!batchCompleted && currentBatch.length > 0) {
            const requestBody = { keywords: currentBatch };
            try {
              const response = await this.axiosInstance.put("/sp/keywords", requestBody, {
                headers: {
                  "Content-Type": "application/vnd.spKeyword.v3+json",
                  "Accept": "application/vnd.spKeyword.v3+json"
                }
              });
              const responseKeywords = response.data?.keywords;
              if (responseKeywords && typeof responseKeywords === "object" && !Array.isArray(responseKeywords)) {
                const removedKeywordIds = [];
                if (responseKeywords.error && Array.isArray(responseKeywords.error)) {
                  for (const err of responseKeywords.error) {
                    const failedIndex = typeof err.index === "number" ? err.index : void 0;
                    const failedKeywordId = err.keywordId || (failedIndex !== void 0 ? currentBatch[failedIndex]?.keywordId : "unknown");
                    const errorCode = err.code || "ERROR";
                    const errorDetails = err.description || err.details || err.message || "";
                    const fullErrorStr = JSON.stringify(err).substring(0, 300);
                    allErrors.push({ keywordId: failedKeywordId, code: errorCode, details: errorDetails || fullErrorStr });
                    if (fullErrorStr.includes("entityNotFoundError") || fullErrorStr.includes("entityStateError")) {
                      log29.warn(`[SP API] v479: \u5173\u952E\u8BCD\u72B6\u6001\u66F4\u65B0-\u5173\u952E\u8BCD\u5DF2\u5220\u9664/\u5F52\u6863: keywordId=${failedKeywordId}, error=${fullErrorStr.slice(0, 150)}`);
                      removedKeywordIds.push(String(failedKeywordId));
                    } else {
                      log29.warn(`[SP API] v479: \u5173\u952E\u8BCD\u72B6\u6001\u66F4\u65B0\u5931\u8D25: keywordId=${failedKeywordId}, index=${failedIndex}, code=${errorCode}, fullError=${fullErrorStr}`);
                    }
                  }
                }
                if (removedKeywordIds.length > 0) {
                  try {
                    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
                    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
                    const db = await getDb3();
                    if (db) {
                      await db.execute(
                        sql15.raw(`UPDATE keywords SET keywordStatus = 'amazon_deleted' WHERE keywordId IN (${removedKeywordIds.map((id) => `'${id}'`).join(",")})`)
                      );
                      log29.warn(`[SP API] v479: \u5DF2\u6807\u8BB0${removedKeywordIds.length}\u4E2A\u72B6\u6001\u66F4\u65B0\u5931\u8D25\u7684\u5173\u952E\u8BCD\u4E3Aamazon_deleted`);
                    }
                  } catch (markErr) {
                    log29.warn(`[SP API] v479: \u6807\u8BB0\u8FC7\u671F\u5173\u952E\u8BCD\u5931\u8D25: ${markErr.message}`);
                  }
                }
                if (responseKeywords.success && Array.isArray(responseKeywords.success)) {
                  totalSuccess += responseKeywords.success.length;
                }
              } else if (Array.isArray(response.data)) {
                for (const item of response.data) {
                  if (item.code === "SUCCESS") {
                    totalSuccess++;
                  } else {
                    allErrors.push({ keywordId: item.keywordId, code: item.code || "ERROR", details: item.description || "" });
                  }
                }
              } else {
                log29.warn(`[SP API] v426: \u5173\u952E\u8BCD\u72B6\u6001\u66F4\u65B0\u54CD\u5E94\u683C\u5F0F\u672A\u77E5, HTTP\u72B6\u6001=${response.status}, \u5047\u8BBEbatch\u6210\u529F`);
                totalSuccess += currentBatch.length;
              }
              batchCompleted = true;
            } catch (batchErr) {
              const errResponse = batchErr?.response;
              const errData = errResponse?.data;
              const errString = typeof errData === "string" ? errData : JSON.stringify(errData || "");
              const isEntityNotFound = errString.includes("entityNotFoundError") || errString.includes("ENTITY_NOT_FOUND") || errString.includes("entityStateError");
              if (isEntityNotFound && entityRetryCount < MAX_ENTITY_RETRIES) {
                const badKeywordIds = [];
                try {
                  const errObj = typeof errData === "string" ? JSON.parse(errData) : errData;
                  for (const err of errObj?.errors || []) {
                    const entityId = err?.errorValue?.entityNotFoundError?.entityId || err?.errorValue?.entityStateError?.entityId || "";
                    const trigger = err?.errorValue?.entityNotFoundError?.cause?.trigger || err?.errorValue?.entityStateError?.cause?.trigger || "";
                    if (entityId) badKeywordIds.push(String(entityId));
                    else if (trigger) badKeywordIds.push(String(trigger));
                  }
                } catch (_) {
                  const matches = errString.match(/entityId[":\s]+["](\d{10,})/g) || [];
                  for (const m of matches) {
                    const id = m.match(/(\d{10,})/);
                    if (id) badKeywordIds.push(id[1]);
                  }
                }
                if (badKeywordIds.length > 0) {
                  const badSet = new Set(badKeywordIds);
                  const beforeCount = currentBatch.length;
                  currentBatch = currentBatch.filter((item) => !badSet.has(item.keywordId));
                  entityRetryCount++;
                  for (const badId of badKeywordIds) {
                    allErrors.push({ keywordId: badId, code: "ENTITY_NOT_FOUND", details: "Amazon\u7AEF\u5DF2\u4E0D\u5B58\u5728\uFF0C\u5DF2\u81EA\u52A8\u79FB\u9664\u5E76\u91CD\u8BD5" });
                  }
                  log29.warn(`[SP API] v477: \u72B6\u6001\u66F4\u65B0entityNotFoundError\u667A\u80FD\u91CD\u8BD5(${entityRetryCount}/${MAX_ENTITY_RETRIES}): \u79FB\u9664${badKeywordIds.length}\u4E2A, \u6279\u6B21\u4ECE${beforeCount}\u51CF\u81F3${currentBatch.length}`);
                  await new Promise((resolve) => setTimeout(resolve, 5e3));
                  continue;
                }
              }
              log29.warn(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u72B6\u6001\u66F4\u65B0API\u8C03\u7528\u5931\u8D25: ${batchErr.message}`);
              for (const item of currentBatch) {
                allErrors.push({ keywordId: item.keywordId, code: "BATCH_ERROR", details: batchErr.message });
              }
              batchCompleted = true;
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.warn(`[SP API] v199: \u5173\u952E\u8BCD\u72B6\u6001\u66F4\u65B0\u5B8C\u6210: \u603B\u8BA1=${updates.length}, \u6210\u529F=${totalSuccess}, \u5931\u8D25=${allErrors.length}`);
        return { success: allErrors.length === 0, successCount: totalSuccess, errors: allErrors };
      }
      /**
       * v134: 更新商品定向状态（enabled/paused/archived）
       * 通过 PUT /sp/targets API 更新商品定向的 state 字段
       */
      async updateProductTargetStatus(updates) {
        const BATCH_SIZE = 1e3;
        const BATCH_DELAY_MS = 300;
        const allErrors = [];
        let totalSuccess = 0;
        const formattedAll = updates.map((u) => ({
          targetId: String(u.targetId),
          state: u.state.toUpperCase()
        }));
        const totalBatches = Math.ceil(formattedAll.length / BATCH_SIZE);
        log29.info(`[SP API] v199: updateProductTargetStatus \u5206\u6279\u5904\u7406: \u603B\u8BA1${formattedAll.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = formattedAll.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          const requestBody = { targetingClauses: batch };
          try {
            const response = await this.axiosInstance.put("/sp/targets", requestBody, {
              headers: {
                "Content-Type": "application/vnd.spTargetingClause.v3+json",
                "Accept": "application/vnd.spTargetingClause.v3+json"
              }
            });
            const responseTargets = response.data?.targetingClauses;
            if (responseTargets && typeof responseTargets === "object" && !Array.isArray(responseTargets)) {
              if (responseTargets.error && Array.isArray(responseTargets.error)) {
                for (const err of responseTargets.error) {
                  const failedIndex = typeof err.index === "number" ? err.index : void 0;
                  const failedTargetId = err.targetId || (failedIndex !== void 0 ? batch[failedIndex]?.targetId : "unknown");
                  allErrors.push({ targetId: failedTargetId, code: err.code || "ERROR", details: err.description || err.details || "" });
                }
              }
              if (responseTargets.success && Array.isArray(responseTargets.success)) {
                totalSuccess += responseTargets.success.length;
              }
            }
          } catch (batchErr) {
            log29.warn(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u5546\u54C1\u5B9A\u5411\u72B6\u6001\u66F4\u65B0\u5931\u8D25: ${batchErr.message}`);
            for (const item of batch) {
              allErrors.push({ targetId: item.targetId, code: "BATCH_ERROR", details: batchErr.message });
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.warn(`[SP API] v199: \u5546\u54C1\u5B9A\u5411\u72B6\u6001\u66F4\u65B0\u5B8C\u6210: \u603B\u8BA1=${updates.length}, \u6210\u529F=${totalSuccess}, \u5931\u8D25=${allErrors.length}`);
        return { success: allErrors.length === 0, successCount: totalSuccess, errors: allErrors };
      }
      /**
       * v135: 更新SP广告组状态
       * 通过 PUT /sp/adGroups 更新广告组的state字段
       */
      async updateSpAdGroupStatus(updates) {
        const BATCH_SIZE = 1e3;
        const BATCH_DELAY_MS = 300;
        const allErrors = [];
        let totalSuccess = 0;
        const formattedAll = updates.map((u) => ({
          adGroupId: String(u.adGroupId),
          state: u.state.toUpperCase()
        }));
        const totalBatches = Math.ceil(formattedAll.length / BATCH_SIZE);
        log29.info(`[SP API] v199: updateSpAdGroupStatus \u5206\u6279\u5904\u7406: \u603B\u8BA1${formattedAll.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = formattedAll.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          const requestBody = { adGroups: batch };
          try {
            const response = await this.axiosInstance.put("/sp/adGroups", requestBody, {
              headers: {
                "Content-Type": "application/vnd.spAdGroup.v3+json",
                "Accept": "application/vnd.spAdGroup.v3+json"
              }
            });
            const responseAdGroups = response.data?.adGroups;
            if (responseAdGroups && typeof responseAdGroups === "object" && !Array.isArray(responseAdGroups)) {
              if (responseAdGroups.error && Array.isArray(responseAdGroups.error)) {
                for (const err of responseAdGroups.error) {
                  const failedIndex = typeof err.index === "number" ? err.index : void 0;
                  const failedAdGroupId = err.adGroupId || (failedIndex !== void 0 ? batch[failedIndex]?.adGroupId : "unknown");
                  allErrors.push({ adGroupId: failedAdGroupId, code: err.code || "ERROR", details: err.description || err.details || "" });
                }
              }
              if (responseAdGroups.success && Array.isArray(responseAdGroups.success)) {
                totalSuccess += responseAdGroups.success.length;
              }
            } else if (Array.isArray(response.data)) {
              for (const item of response.data) {
                if (item.code === "SUCCESS") {
                  totalSuccess++;
                } else {
                  allErrors.push({ adGroupId: item.adGroupId, code: item.code || "ERROR", details: item.description || "" });
                }
              }
            } else {
              log29.warn(`[SP API] v426: \u5E7F\u544A\u7EC4\u72B6\u6001\u66F4\u65B0\u54CD\u5E94\u683C\u5F0F\u672A\u77E5, \u5047\u8BBEbatch\u6210\u529F`);
              totalSuccess += batch.length;
            }
          } catch (batchErr) {
            log29.warn(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u5E7F\u544A\u7EC4\u72B6\u6001\u66F4\u65B0\u5931\u8D25: ${batchErr.message}`);
            for (const item of batch) {
              allErrors.push({ adGroupId: item.adGroupId, code: "BATCH_ERROR", details: batchErr.message });
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.warn(`[SP API] v199: \u5E7F\u544A\u7EC4\u72B6\u6001\u66F4\u65B0\u5B8C\u6210: \u603B\u8BA1=${updates.length}, \u6210\u529F=${totalSuccess}, \u5931\u8D25=${allErrors.length}`);
        return { success: allErrors.length === 0, successCount: totalSuccess, errors: allErrors };
      }
      /**
       * 获取SP商品定位列表
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSpProductTargets(adGroupId) {
        const allTargets = [];
        let nextToken;
        const headerVariants = [
          { "Content-Type": "application/vnd.spTargetingClause.v3+json", "Accept": "application/vnd.spTargetingClause.v3+json" },
          { "Content-Type": "application/json", "Accept": "application/json" }
        ];
        let workingHeaders = null;
        let lastError = null;
        do {
          const body = { maxResults: 100 };
          if (adGroupId) {
            body.adGroupIdFilter = { include: [String(adGroupId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          if (workingHeaders) {
            try {
              const response = await this.axiosInstance.post("/sp/targets/list", body, { headers: workingHeaders });
              const targets = response.data.targetingClauses || [];
              allTargets.push(...targets);
              nextToken = response.data.nextToken;
              log29.debug(`[SP API] Fetched ${targets.length} targets, total: ${allTargets.length}, hasMore: ${!!nextToken}`);
            } catch (error48) {
              log29.warn("[SP API] Error fetching targets:", error48.message);
              throw error48;
            }
          } else {
            for (const headers of headerVariants) {
              try {
                const response = await this.axiosInstance.post("/sp/targets/list", body, { headers });
                workingHeaders = headers;
                const targets = response.data.targetingClauses || [];
                allTargets.push(...targets);
                nextToken = response.data.nextToken;
                log29.debug(`[SP API] Fetched ${targets.length} targets, total: ${allTargets.length}, hasMore: ${!!nextToken}`);
                break;
              } catch (error48) {
                lastError = error48;
                if (error48.response?.status === 415) {
                  continue;
                }
                throw error48;
              }
            }
            if (!workingHeaders) {
              throw lastError;
            }
          }
        } while (nextToken);
        log29.debug(`[SP API] Total targets fetched: ${allTargets.length}`);
        return allTargets;
      }
      /**
       * 更新商品定位出价
       */
      async updateProductTargetBids(updates) {
        const BATCH_SIZE = 1e3;
        const BATCH_DELAY_MS = 300;
        const allErrors = [];
        const allRequestIds = [];
        let totalSuccess = 0;
        const formattedAll = updates.map((u) => ({
          targetId: String(u.targetId),
          bid: Number(u.bid.toFixed(2))
        }));
        const totalBatches = Math.ceil(formattedAll.length / BATCH_SIZE);
        log29.info(`[SP API] v199: updateProductTargetBids \u5206\u6279\u5904\u7406: \u603B\u8BA1${formattedAll.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          let currentBatch = formattedAll.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          const MAX_ENTITY_RETRIES = 10;
          let entityRetryCount = 0;
          const removedTargetIds = [];
          let batchCompleted = false;
          while (!batchCompleted && currentBatch.length > 0) {
            const requestBody = { targetingClauses: currentBatch };
            try {
              const response = await this.axiosInstance.put("/sp/targets", requestBody, {
                headers: {
                  "Content-Type": "application/vnd.spTargetingClause.v3+json",
                  "Accept": "application/vnd.spTargetingClause.v3+json"
                }
              });
              const requestId = response.headers?.["x-amzn-requestid"] || response.headers?.["x-amz-request-id"] || response.headers?.["requestid"] || "";
              if (requestId) {
                allRequestIds.push(requestId);
                log29.info(`[SP API] v333: \u5546\u54C1\u5B9A\u4F4D\u51FA\u4EF7\u66F4\u65B0 batch#${batchIdx + 1} requestId=${requestId}`);
              }
              const responseTargets = response.data?.targetingClauses;
              if (responseTargets && typeof responseTargets === "object" && !Array.isArray(responseTargets)) {
                if (responseTargets.error && Array.isArray(responseTargets.error)) {
                  for (const err of responseTargets.error) {
                    const failedIndex = typeof err.index === "number" ? err.index : void 0;
                    const failedTargetId = err.targetId || (failedIndex !== void 0 ? currentBatch[failedIndex]?.targetId : "unknown");
                    const errorCode = err.code || err.errorCode || "ERROR";
                    const errorDetails = err.description || err.details || err.message || err.errorMessage || err.errorDescription || "";
                    const fullErrorStr = JSON.stringify(err).substring(0, 300);
                    allErrors.push({ targetId: failedTargetId, code: errorCode, details: errorDetails || fullErrorStr });
                    if (fullErrorStr.includes("entityNotFoundError") || fullErrorStr.includes("entityStateError")) {
                      log29.warn(`[SP API] v477: \u5546\u54C1\u5B9A\u5411\u5DF2\u5220\u9664/\u5F52\u6863: targetId=${failedTargetId}`);
                      removedTargetIds.push(String(failedTargetId));
                    } else {
                      log29.warn(`[SP API] v444: \u5546\u54C1\u5B9A\u4F4D\u51FA\u4EF7\u66F4\u65B0\u5931\u8D25: targetId=${failedTargetId}, index=${failedIndex}, code=${errorCode}, details=${errorDetails}, fullError=${fullErrorStr}`);
                    }
                  }
                }
                if (responseTargets.success && Array.isArray(responseTargets.success)) {
                  totalSuccess += responseTargets.success.length;
                }
              } else if (Array.isArray(response.data)) {
                for (const item of response.data) {
                  if (item.code === "SUCCESS") {
                    totalSuccess++;
                  } else {
                    allErrors.push({ targetId: item.targetId, code: item.code || "ERROR", details: item.description || "" });
                  }
                }
              } else {
                log29.warn(`[SP API] v426: \u5546\u54C1\u5B9A\u4F4D\u51FA\u4EF7\u66F4\u65B0\u54CD\u5E94\u683C\u5F0F\u672A\u77E5, HTTP\u72B6\u6001=${response.status}, \u5047\u8BBEbatch\u6210\u529F`);
                totalSuccess += currentBatch.length;
              }
              batchCompleted = true;
            } catch (batchErr) {
              const errResponse = batchErr?.response;
              const errData = errResponse?.data;
              const errString = typeof errData === "string" ? errData : JSON.stringify(errData || "");
              const errRequestId = errResponse?.headers?.["x-amzn-requestid"] || errResponse?.headers?.["x-amz-request-id"] || "";
              if (errRequestId) {
                allRequestIds.push(errRequestId);
              }
              const isEntityNotFound = errString.includes("entityNotFoundError") || errString.includes("ENTITY_NOT_FOUND") || errString.includes("entityStateError");
              if (isEntityNotFound && entityRetryCount < MAX_ENTITY_RETRIES) {
                const badTargetIds = [];
                try {
                  const errObj = typeof errData === "string" ? JSON.parse(errData) : errData;
                  const errors = errObj?.errors || [];
                  for (const err of errors) {
                    const entityId = err?.errorValue?.entityNotFoundError?.entityId || err?.errorValue?.entityStateError?.entityId || "";
                    const trigger = err?.errorValue?.entityNotFoundError?.cause?.trigger || err?.errorValue?.entityStateError?.cause?.trigger || "";
                    if (entityId) badTargetIds.push(String(entityId));
                    else if (trigger) badTargetIds.push(String(trigger));
                  }
                } catch (_) {
                  const matches = errString.match(/entityId[":\s]+["](\d{10,})/g) || [];
                  for (const m of matches) {
                    const id = m.match(/(\d{10,})/);
                    if (id) badTargetIds.push(id[1]);
                  }
                }
                if (badTargetIds.length > 0) {
                  const badSet = new Set(badTargetIds);
                  const beforeCount = currentBatch.length;
                  currentBatch = currentBatch.filter((item) => !badSet.has(item.targetId));
                  removedTargetIds.push(...badTargetIds);
                  entityRetryCount++;
                  for (const badId of badTargetIds) {
                    allErrors.push({ targetId: badId, code: "ENTITY_NOT_FOUND", details: "Amazon\u7AEF\u5DF2\u4E0D\u5B58\u5728\uFF0C\u5DF2\u81EA\u52A8\u79FB\u9664\u5E76\u91CD\u8BD5\u5269\u4F59\u6279\u6B21" });
                  }
                  log29.warn(`[SP API] v477: target entityNotFoundError\u667A\u80FD\u91CD\u8BD5(${entityRetryCount}/${MAX_ENTITY_RETRIES}): \u79FB\u9664${badTargetIds.length}\u4E2A\u574Ftarget, \u6279\u6B21\u4ECE${beforeCount}\u51CF\u81F3${currentBatch.length}, \u7B49\u5F855\u79D2\u540E\u91CD\u8BD5...`);
                  await new Promise((resolve) => setTimeout(resolve, 5e3));
                  continue;
                }
              }
              log29.warn(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u5546\u54C1\u5B9A\u4F4D\u51FA\u4EF7\u66F4\u65B0\u5931\u8D25: ${batchErr.message}`);
              for (const item of currentBatch) {
                allErrors.push({ targetId: item.targetId, code: "BATCH_ERROR", details: batchErr.message });
              }
              batchCompleted = true;
            }
          }
          if (removedTargetIds.length > 0) {
            try {
              const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
              const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
              const db = await getDb3();
              if (db) {
                const idList = removedTargetIds.map((id) => String(id));
                await db.execute(
                  sql15.raw(`UPDATE product_targets SET targetStatus = 'amazon_deleted' WHERE targetId IN (${idList.map((id) => `'${id}'`).join(",")})`)
                );
                log29.warn(`[SP API] v477: \u5DF2\u6807\u8BB0${removedTargetIds.length}\u4E2AentityNotFound\u5546\u54C1\u5B9A\u5411\u4E3Aamazon_deleted`);
              }
            } catch (markErr) {
              log29.warn(`[SP API] v477: \u6807\u8BB0\u8FC7\u671F\u5546\u54C1\u5B9A\u5411\u5931\u8D25: ${markErr.message}`);
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.warn(`[SP API] v199: \u5546\u54C1\u5B9A\u4F4D\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u603B\u8BA1=${updates.length}, \u6210\u529F=${totalSuccess}, \u5931\u8D25=${allErrors.length}, requestIds=${allRequestIds.length}`);
        return { success: allErrors.length === 0, errors: allErrors, requestIds: allRequestIds };
      }
      /**
       * v310: 创建SP商品定向 (Product Targeting)
       * 端点: POST /sp/targets
       * 参照 createSpKeywords 的模式，支持分批处理和限流重试
       */
      async createSpProductTargets(targets) {
        const BATCH_SIZE = 100;
        const BATCH_DELAY_MS = 500;
        const allCreatedTargets = [];
        const allErrors = [];
        const totalBatches = Math.ceil(targets.length / BATCH_SIZE);
        log29.info(`[SP API] v310: createSpProductTargets \u5206\u6279\u5904\u7406: \u603B\u8BA1${targets.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batchTargets = targets.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          log29.info(`[SP API] v310: \u7B2C${batchIdx + 1}/${totalBatches}\u6279: ${batchTargets.length}\u4E2A\u5546\u54C1\u5B9A\u5411\u521B\u5EFA`);
          try {
            const formattedTargets = batchTargets.map((t2) => ({
              adGroupId: String(t2.adGroupId),
              campaignId: String(t2.campaignId),
              expression: t2.expression,
              expressionType: t2.expressionType || "manual",
              bid: Number(t2.bid.toFixed(2)),
              state: (t2.state || "enabled").toUpperCase()
            }));
            const requestBody = { targetingClauses: formattedTargets };
            const response = await this.axiosInstance.post("/sp/targets", requestBody, {
              headers: {
                "Content-Type": "application/vnd.spTargetingClause.v3+json",
                "Accept": "application/vnd.spTargetingClause.v3+json"
              }
            });
            const responseTargets = response.data?.targetingClauses;
            if (responseTargets && typeof responseTargets === "object" && !Array.isArray(responseTargets)) {
              if (responseTargets.success && Array.isArray(responseTargets.success)) {
                for (const item of responseTargets.success) {
                  const idx = item.index || 0;
                  allCreatedTargets.push({
                    targetId: item.targetId || null,
                    expression: batchTargets[idx]?.expression || [],
                    code: "SUCCESS"
                  });
                }
              }
              if (responseTargets.error && Array.isArray(responseTargets.error)) {
                for (const item of responseTargets.error) {
                  allErrors.push(item);
                  allCreatedTargets.push({
                    targetId: null,
                    expression: batchTargets[item.index]?.expression || [],
                    code: item.code || "ERROR"
                  });
                  log29.warn(`[SP API] v310: \u5546\u54C1\u5B9A\u5411\u521B\u5EFA\u5931\u8D25: code=${item.code}, description="${item.description || item.details || ""}"`);
                }
              }
            } else if (Array.isArray(responseTargets)) {
              for (const t2 of responseTargets) {
                allCreatedTargets.push({
                  targetId: t2.targetId || null,
                  expression: t2.expression || [],
                  code: t2.code || "SUCCESS"
                });
                if (t2.code && t2.code !== "SUCCESS") allErrors.push(t2);
              }
            }
          } catch (error48) {
            log29.warn(`[SP API] v310: \u7B2C${batchIdx + 1}\u6279\u5546\u54C1\u5B9A\u5411\u521B\u5EFAAPI\u8C03\u7528\u5931\u8D25: ${error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message}`);
            for (const t2 of batchTargets) {
              allCreatedTargets.push({ targetId: null, expression: t2.expression, code: "BATCH_ERROR" });
              allErrors.push({ expression: t2.expression, code: "BATCH_ERROR", details: error48.message });
            }
            if (error48.response?.status === 429) {
              const throttleWait = BATCH_DELAY_MS * 5;
              log29.debug(`[SP API] v310: \u9650\u6D41\uFF0C\u7B49\u5F85${throttleWait}ms\u540E\u7EE7\u7EED...`);
              await new Promise((resolve) => setTimeout(resolve, throttleWait));
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.warn(`[SP API] v310: \u5546\u54C1\u5B9A\u5411\u521B\u5EFA\u5B8C\u6210: \u603B\u8BA1=${targets.length}, \u6210\u529F=${allCreatedTargets.length - allErrors.length}, \u5931\u8D25=${allErrors.length}`);
        return { success: allErrors.length === 0, createdTargets: allCreatedTargets, errors: allErrors };
      }
      // ==================== 报告 API ====================
      /**
       * 请求SP广告活动绩效报告 (Amazon Ads API v3)
       * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
       * 重要: SP报表可以直接获取campaignBudget和campaignStatus
       * 
       * Report API v3 支持的字段（2026年1月更新）:
       * - campaignBudgetAmount: 预算金额
       * - campaignBudgetType: 预算类型 (DAILY/LIFETIME)
       * - campaignBudgetCurrencyCode: 预算货币代码
       * - unitsSoldClicks14d: 14天点击归因销售单位数
       * - unitsSoldSameSku14d: 14天同SKU销售单位数
       * - dpv14d: 14天详情页浏览量
       * - addToCart14d: 14天加购数
       * 注意: topOfSearchImpressionShare 目前不支持通过 Report API v3 获取
       */
      async requestSpCampaignReport(startDate, endDate, metrics = ["impressions", "clicks", "cost", "attributedSales7d", "attributedConversions7d"]) {
        let requestBody = null;
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SP\u5E7F\u544A\u6D3B\u52A8\u62A5\u544A: ${startDate} - ${endDate}`);
          requestBody = {
            name: `SP Campaign Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_PRODUCTS",
              groupBy: ["campaign"],
              columns: [
                // 基础信息 - 根据Excel文档SP Campaign sheet
                "date",
                "campaignId",
                "campaignName",
                "campaignStatus",
                // Excel: campaignStatus - 状态
                "campaignBudgetAmount",
                // Excel: campaignBudgetAmount - 预算金额
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 货币
                "campaignBudgetType",
                // Excel: campaignBudgetType - 预算类型
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "clicks",
                // Excel: clicks - 点击次数
                "clickThroughRate",
                // Excel: clickThroughRate - 点击率
                // 花费指标 (SP使用cost)
                "cost",
                // Excel: cost - 支出 (注意: Excel显示为cost而非spend)
                "costPerClick",
                // Excel: costPerClick - 每次点击费用
                // 7天归因销售指标 (SP专用)
                "sales7d",
                // Excel: sales7d - 7天总销售额
                "purchases7d",
                // Excel: purchases7d - 7天订单总数
                "unitsSoldClicks7d",
                // Excel: unitsSoldClicks7d - 7天总销量
                // 同SKU指标
                "attributedSalesSameSku7d",
                // Excel: attributedSalesSameSku7d - 7天广告SKU销售额
                "unitsSoldSameSku7d"
                // Excel: unitsSoldSameSku7d - 7天广告SKU数量
                // 'salesOtherSku7d' and 'unitsSoldOtherSku7d' are NOT valid SP Campaign columns (removed in v104)
                // Use attributedSalesSameSku7d and unitsSoldSameSku7d instead
              ],
              // 添加filters配置
              filters: [
                {
                  field: "campaignStatus",
                  values: ["ARCHIVED", "ENABLED", "PAUSED"]
                }
              ],
              reportTypeId: "spCampaigns",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] \u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          const errStatus = error48.response?.status;
          const errData = error48.response?.data;
          const errHeaders = error48.response?.headers;
          {
            const _isExpected = errStatus === 425 || errStatus === 400 && JSON.stringify(errData).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u5E7F\u544A\u6D3B\u52A8\u62A5\u544A\u5931\u8D25 (expected): status=${errStatus}, data=${JSON.stringify(errData)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u5E7F\u544A\u6D3B\u52A8\u62A5\u544A\u5931\u8D25: status=${errStatus}, data=${JSON.stringify(errData)?.slice(0, 500)}, message=${error48.message}`);
            }
          }
          if (errStatus === 400) {
            log29.warn(`[Amazon API] v348: SP\u62A5\u544A400\u8BE6\u60C5: requestBody=${JSON.stringify(requestBody)?.slice(0, 500)}, responseHeaders=${JSON.stringify(errHeaders)?.slice(0, 300)}`);
          }
          throw error48;
        }
      }
      /**
       * 请求SP关键词绩效报告 (Amazon Ads API v3)
       * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
       */
      async requestSpKeywordReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SP\u5173\u952E\u8BCD\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SP Keyword Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_PRODUCTS",
              groupBy: ["targeting"],
              columns: [
                // 基础信息 - v242: 移除不属于keyword报告的字段(advertisedSku/Asin/targetId/targetingExpression/targetingText)
                // v242: 使用startDate/endDate替代date (SUMMARY模式不支持date)
                "startDate",
                "endDate",
                "campaignId",
                "campaignName",
                // 广告系列名称
                "campaignBudgetCurrencyCode",
                // 货币
                "adGroupId",
                "adGroupName",
                // 广告组名称
                "keywordId",
                // 关键词ID
                "keyword",
                // 关键词文本
                "keywordBid",
                // 关键词出价
                "keywordType",
                "matchType",
                "targeting",
                // 定位表达式
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "clicks",
                // Excel: clicks - 点击次数
                "clickThroughRate",
                // Excel: clickThroughRate - 点击率
                // 花费指标
                "cost",
                // Excel: cost - 支出
                "costPerClick",
                // Excel: costPerClick - 每次点击费用
                // 7天归因销售指标
                "sales7d",
                // Excel: sales7d - 7天总销售额
                "acosClicks7d",
                // Excel: acosClicks7d - ACOS
                "roasClicks7d",
                // Excel: roasClicks7d - ROAS
                "purchases7d",
                // Excel: purchases7d - 7天订单总数
                // @ts-ignore
                "unitsSoldClicks7d",
                // Excel: unitsSoldClicks7d - 7天总销量
                // 同SKU/其他SKU指标
                "unitsSoldSameSku7d",
                // Excel: unitsSoldSameSku7d - 7天广告SKU数量
                "unitsSoldOtherSku7d",
                // Excel: unitsSoldOtherSku7d - 7天其他SKU数量
                "attributedSalesSameSku7d",
                // Excel: attributedSalesSameSku7d - 7天广告SKU销售额
                "salesOtherSku7d"
                // Excel: salesOtherSku7d - 7天其他SKU销售额
              ],
              reportTypeId: "spTargeting",
              timeUnit: "SUMMARY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] \u5173\u952E\u8BCD\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u5173\u952E\u8BCD\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u5173\u952E\u8BCD\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SB品牌广告活动报告 (Amazon Ads API v3)
       * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
       * 重要修复: SB报告必须使用 attributedSales14d 和 attributedConversions14d 字段
       * 使用 sales/purchases 会导致数据为空！
       * 
       * Report API v3 支持的SB字段（2026年1月更新）:
       * - attributedSales14d: 14天归因销售额
       * - attributedConversions14d: 14天归因转化数
       * - brandedSearches14d: 14天品牌搜索数
       * - brandedSearchesClicks14d: 14天品牌搜索点击数
       * - dpv14d: 14天详情页浏览量
       */
      async requestSbCampaignReport(startDate, endDate, metrics = ["impressions", "clicks", "cost", "attributedConversions14d", "attributedSales14d"]) {
        let requestBody = null;
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SB\u54C1\u724C\u5E7F\u544A\u6D3B\u52A8\u62A5\u544A: ${startDate} - ${endDate}`);
          requestBody = {
            name: `SB Campaign Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_BRANDS",
              groupBy: ["campaign"],
              columns: [
                // 基础信息 - 根据Excel文档SB Campaign sheet
                "date",
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "campaignStatus",
                "campaignBudgetAmount",
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 货币
                "campaignBudgetType",
                "costType",
                // Excel: costType - 费用类型
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "clicks",
                // Excel: clicks - 点击次数
                "viewableImpressions",
                // Excel: viewableImpressions - 可见展示次数
                "viewabilityRate",
                // Excel: viewabilityRate - 观看率 (VTR)
                "viewClickThroughRate",
                // Excel: viewClickThroughRate - 观看点击率 (vCTR)
                // 花费指标 (SB使用cost)
                "cost",
                // Excel: cost - 支出
                // 14天归因销售指标 (SB使用14天归因)
                "sales",
                // Excel: sales - 14天总销售额
                "purchases",
                // Excel: purchases - 14天总订单量
                "unitsSold",
                // Excel: unitsSold - 14天总单位数
                // 点击归因指标
                "salesClicks",
                // Excel: salesClicks - 14天总销售额(点击)
                "purchasesClicks",
                // Excel: purchasesClicks - 14天订单总数(点击)
                "unitsSoldClicks",
                // Excel: unitsSoldClicks - 14天总数量(点击)
                // 详情页浏览
                "detailPageViews",
                // Excel: detailPageViews - 14天详情页浏览量
                // 视频指标
                "videoFirstQuartileViews",
                // Excel: videoFirstQuartileViews - 视频第一四分位观看次数
                "videoMidpointViews",
                // Excel: videoMidpointViews - 视频中间点观看次数
                "videoThirdQuartileViews",
                // Excel: videoThirdQuartileViews - 视频第三四分位观看次数
                "videoCompleteViews",
                // Excel: videoCompleteViews - 视频完整观看次数
                "videoUnmutes",
                // Excel: videoUnmutes - 视频取消静音次数
                "video5SecondViews",
                // Excel: video5SecondViews - 5秒观看次数
                "video5SecondViewRate",
                // Excel: video5SecondViewRate - 5秒观看率
                // 品牌搜索
                "brandedSearches",
                // Excel: brandedSearches - 14天品牌搜索次数
                "brandedSearchesClicks",
                // Excel: brandedSearchesClicks - 品牌搜索点击转化率
                // 新客指标
                "newToBrandPurchases",
                // Excel: newToBrandPurchases - 14天品牌新客户订单数
                "newToBrandPurchasesPercentage",
                // Excel: newToBrandPurchasesPercentage - 14天订单占比新品牌
                "newToBrandSales",
                // Excel: newToBrandSales - 14天新品牌销售额
                "newToBrandSalesPercentage",
                // Excel: newToBrandSalesPercentage - 14天新品牌销售额占比
                "newToBrandUnitsSold",
                // Excel: newToBrandUnitsSold - 14天新品牌数量
                "newToBrandUnitsSoldPercentage",
                // Excel: newToBrandUnitsSoldPercentage - 14天新品牌数量占比
                "newToBrandPurchasesRate",
                // Excel: newToBrandPurchasesRate - 14天新品牌订单率
                // 新品牌详情页
                "newToBrandDetailPageViews",
                // Excel: newToBrandDetailPageViews - 新品牌详情页浏览量
                "newToBrandDetailPageViewsClicks",
                // Excel: newToBrandDetailPageViewsClicks - 新品牌详情页浏览点击转化率
                "newToBrandDetailPageViewRate",
                // Excel: newToBrandDetailPageViewRate - 新品牌详情页浏览率
                "newToBrandECPDetailPageView",
                // Excel: newToBrandECPDetailPageView - 新品牌详情页每次浏览有效费用
                // 加购指标
                "addToCart",
                // Excel: addToCart - 14天ATC
                "addToCartClicks",
                // Excel: addToCartClicks - 14天ATC点击次数
                "addToCartRate",
                // Excel: addToCartRate - 14天ATCR
                "eCPAddToCart"
                // Excel: eCPAddToCart - 每次加入购物车有效费用
              ],
              // ⚠️ 关键修复: 添加filters配置 - 基于专家Postman配置
              filters: [
                {
                  field: "campaignStatus",
                  values: ["ARCHIVED", "ENABLED", "PAUSED"]
                }
              ],
              reportTypeId: "sbCampaigns",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SB\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          const errStatus = error48.response?.status;
          const errData = error48.response?.data;
          const errHeaders = error48.response?.headers;
          {
            const _isExpected = errStatus === 425 || errStatus === 400 && JSON.stringify(errData).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u5E7F\u544A\u6D3B\u52A8\u62A5\u544A\u5931\u8D25 (expected): status=${errStatus}, data=${JSON.stringify(errData)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u5E7F\u544A\u6D3B\u52A8\u62A5\u544A\u5931\u8D25: status=${errStatus}, data=${JSON.stringify(errData)?.slice(0, 500)}, message=${error48.message}`);
            }
          }
          if (errStatus === 400) {
            log29.warn(`[Amazon API] v348: SB\u62A5\u544A400\u8BE6\u60C5: requestBody=${JSON.stringify(requestBody)?.slice(0, 500)}, responseHeaders=${JSON.stringify(errHeaders)?.slice(0, 300)}`);
          }
          throw error48;
        }
      }
      /**
       * 请求SD展示广告活动报告 (Amazon Ads API v3)
       * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
       * 重要修复: SD报告必须使用 attributedSales14d 和 attributedConversions14d 字段
       * SD还需要 viewAttributedSales14d 来获取浏览归因数据
       * 
       * Report API v3 支持的SD字段（2026年1月更新）:
       * - attributedSales14d: 14天点击归因销售额
       * - attributedConversions14d: 14天点击归因转化数
       * - viewAttributedSales14d: 14天浏览归因销售额 (vCPM核心)
       * - viewAttributedConversions14d: 14天浏览归因转化数
       * - viewableImpressions: 可见曝光数
       * - dpv14d: 14天详情页浏览量
       * - newToBrandPurchases14d: 14天新客购买数
       * - newToBrandSales14d: 14天新客销售额
       */
      async requestSdCampaignReport(startDate, endDate, metrics = ["impressions", "clicks", "cost", "attributedConversions14d", "attributedSales14d", "viewAttributedSales14d"]) {
        let requestBody = null;
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SD\u5C55\u793A\u5E7F\u544A\u6D3B\u52A8\u62A5\u544A: ${startDate} - ${endDate}`);
          requestBody = {
            name: `SD Campaign Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_DISPLAY",
              groupBy: ["campaign"],
              columns: [
                // 基础信息 - 根据Excel文档SD Campaign sheet
                "date",
                "campaignId",
                "campaignName",
                "campaignStatus",
                // Excel: campaignStatus - 状态
                "campaignBudgetAmount",
                // Excel: campaignBudgetAmount - 预算
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 货币
                "costType",
                // Excel: costType - 费用类型
                // 流量指标
                "impressions",
                "impressionsViews",
                "impressionsFrequencyAverage",
                "cumulativeReach",
                "clicks",
                "viewClickThroughRate",
                "viewabilityRate",
                // 花费指标 (SD使用cost)
                "cost",
                // 销售指标 (SD使用Clicks后缀 - 基于专家Postman配置)
                "sales",
                "salesClicks",
                "salesPromotedClicks",
                "purchases",
                "purchasesClicks",
                "purchasesPromotedClicks",
                "unitsSold",
                "unitsSoldClicks",
                // 详情页浏览
                "detailPageViews",
                "detailPageViewsClicks",
                // 加购指标
                "addToCart",
                "addToCartClicks",
                "addToCartViews",
                "addToCartRate",
                "eCPAddToCart",
                // 品牌搜索
                "brandedSearches",
                "brandedSearchesClicks",
                "brandedSearchesViews",
                "brandedSearchRate",
                "eCPBrandSearch",
                // 新客指标
                "newToBrandPurchases",
                "newToBrandPurchasesClicks",
                "newToBrandSales",
                "newToBrandSalesClicks",
                "newToBrandUnitsSold",
                "newToBrandUnitsSoldClicks",
                "newToBrandDetailPageViews",
                "newToBrandDetailPageViewClicks",
                "newToBrandDetailPageViewViews",
                "newToBrandDetailPageViewRate",
                "newToBrandECPDetailPageView",
                // 视频指标
                "videoCompleteViews",
                "videoFirstQuartileViews",
                "videoMidpointViews",
                "videoThirdQuartileViews",
                "videoUnmutes"
              ],
              // SD reports do NOT support filters (removed in v104 - causes 400 error)
              reportTypeId: "sdCampaigns",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SD\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          const errStatus = error48.response?.status;
          const errData = error48.response?.data;
          const errHeaders = error48.response?.headers;
          {
            const _isExpected = errStatus === 425 || errStatus === 400 && JSON.stringify(errData).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5E7F\u544A\u6D3B\u52A8\u62A5\u544A\u5931\u8D25 (expected): status=${errStatus}, data=${JSON.stringify(errData)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5E7F\u544A\u6D3B\u52A8\u62A5\u544A\u5931\u8D25: status=${errStatus}, data=${JSON.stringify(errData)?.slice(0, 500)}, message=${error48.message}`);
            }
          }
          if (errStatus === 400) {
            log29.warn(`[Amazon API] v348: SD\u62A5\u544A400\u8BE6\u60C5: requestBody=${JSON.stringify(requestBody)?.slice(0, 500)}, responseHeaders=${JSON.stringify(errHeaders)?.slice(0, 300)}`);
          }
          throw error48;
        }
      }
      /**
       * 请求SP广告位置报告 (Amazon Ads API v3)
       * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
       * 
       * 广告位置类型:
       * - TOP_OF_SEARCH: 搜索结果顶部
       * - DETAIL_PAGE: 商品详情页
       * - OTHER: 其他位置
       */
      async requestSpPlacementReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SP\u5E7F\u544A\u4F4D\u7F6E\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SP Placement Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_PRODUCTS",
              groupBy: ["campaign", "campaignPlacement"],
              columns: [
                // 基础信息 - 根据Excel文档SP Placement sheet
                "date",
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "campaignBiddingStrategy",
                // Excel: campaignBiddingStrategy - 出价策略
                // 'placementClassification' is NOT a valid column (removed in v104)
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                // @ts-ignore
                "clicks",
                // Excel: clicks - 点击次数
                // 花费指标
                "cost",
                // Excel: cost - 支出
                "costPerClick",
                // Excel: costPerClick - 每次点击费用
                // 7天归因销售指标
                "sales7d",
                // Excel: sales7d - 7天总销售额
                "purchases7d",
                // Excel: purchases7d - 7天总订单量
                "unitsSoldClicks7d"
                // Excel: unitsSoldClicks7d - 7天总单位数
              ],
              reportTypeId: "spCampaigns",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SP\u4F4D\u7F6E\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u4F4D\u7F6E\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u4F4D\u7F6E\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SP搜索词报告 (Amazon Ads API v3)
       * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
       * 
       * 搜索词报告字段:
       * - searchTerm: 客户实际搜索的关键词
       * - keywordId/keyword: 触发广告的投放词
       * - matchType: 匹配类型
       */
      async requestSpSearchTermReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SP\u641C\u7D22\u8BCD\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SP Search Term Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_PRODUCTS",
              groupBy: ["searchTerm"],
              columns: [
                // 基础信息 - 根据Excel文档SP Search term sheet
                "date",
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 货币
                "adGroupId",
                "adGroupName",
                // Excel: adGroupName - 广告组名称
                "targeting",
                // Excel: targeting - 定位
                "keywordType",
                // Excel: keywordType - 匹配类型
                "searchTerm",
                // Excel: searchTerm - 客户搜索词
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "clicks",
                // Excel: clicks - 点击次数
                "clickThroughRate",
                // Excel: clickThroughRate - 点击率
                // 花费指标
                "cost",
                // Excel: cost - 支出
                "costPerClick",
                // Excel: costPerClick - 每次点击费用
                // 7天归因销售指标
                // @ts-ignore
                "sales7d",
                // Excel: sales7d - 7天总销售额
                // @ts-ignore
                "acosClicks7d",
                // Excel: acosClicks7d - ACOS
                "roasClicks7d",
                // Excel: roasClicks7d - ROAS
                "purchases7d",
                // Excel: purchases7d - 7天订单总数
                "unitsSoldClicks7d",
                // Excel: unitsSoldClicks7d - 7天总销量
                // 同SKU/其他SKU指标
                "unitsSoldSameSku7d",
                // Excel: unitsSoldSameSku7d - 7天广告SKU数量
                "unitsSoldOtherSku7d",
                // Excel: unitsSoldOtherSku7d - 7天其他SKU数量
                "attributedSalesSameSku7d",
                // Excel: attributedSalesSameSku7d - 7天广告SKU销售额
                "salesOtherSku7d"
                // Excel: salesOtherSku7d - 7天其他SKU销售额
              ],
              reportTypeId: "spSearchTerm",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SP\u641C\u7D22\u8BCD\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u641C\u7D22\u8BCD\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u641C\u7D22\u8BCD\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SP已推广商品报告 (Amazon Ads API v3)
       * 根据Excel文档: SP Advertised Product sheet
       * 字段: date, campaignName, adGroupName, advertisedSku, advertisedAsin, impressions, clicks,
       *       clickThroughRate, costPerClick, cost, sales7d, acosClicks7d, roasClicks7d, purchases7d,
       *       unitsSoldClicks7d, unitsSoldSameSku7d, unitsSoldOtherSku7d, attributedSalesSameSku7d, salesOtherSku7d
       */
      async requestSpAdvertisedProductReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SP\u5DF2\u63A8\u5E7F\u5546\u54C1\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SP Advertised Product Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_PRODUCTS",
              groupBy: ["advertiser"],
              columns: [
                // 基础信息 - 根据Excel文档SP Advertised Product sheet
                "date",
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 货币
                "adGroupId",
                "adGroupName",
                // Excel: adGroupName - 广告组名称
                "advertisedSku",
                // Excel: advertisedSku - 已投放广告的SKU
                "advertisedAsin",
                // Excel: advertisedAsin - 已投放广告的ASIN
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "clicks",
                // Excel: clicks - 点击次数
                "clickThroughRate",
                // Excel: clickThroughRate - 点击率
                // 花费指标
                "cost",
                // Excel: cost - 支出
                // @ts-ignore
                "costPerClick",
                // Excel: costPerClick - 每次点击费用
                // 7天归因销售指标
                "sales7d",
                // Excel: sales7d - 7天总销售额
                "acosClicks7d",
                // Excel: acosClicks7d - ACOS
                "roasClicks7d",
                // Excel: roasClicks7d - ROAS
                "purchases7d",
                // Excel: purchases7d - 7天订单总数
                "unitsSoldClicks7d",
                // Excel: unitsSoldClicks7d - 7天总销量
                // 同SKU/其他SKU指标
                "unitsSoldSameSku7d",
                // Excel: unitsSoldSameSku7d - 7天广告SKU数量
                "unitsSoldOtherSku7d",
                // Excel: unitsSoldOtherSku7d - 7天其他SKU数量
                "attributedSalesSameSku7d",
                // Excel: attributedSalesSameSku7d - 7天广告SKU销售额
                "salesOtherSku7d"
                // Excel: salesOtherSku7d - 7天其他SKU销售额
              ],
              reportTypeId: "spAdvertisedProduct",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SP\u5DF2\u63A8\u5E7F\u5546\u54C1\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u5DF2\u63A8\u5E7F\u5546\u54C1\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u5DF2\u63A8\u5E7F\u5546\u54C1\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SP已购买商品报告 (Amazon Ads API v3)
       * 根据Excel文档: SP Purchased Product sheet
       * 字段: date, campaignName, adGroupName, advertisedSku, advertisedAsin, keyword, matchType,
       *       purchasedAsin, unitsSoldOtherSku14d, purchasesOtherSku7d, salesOtherSku14d
       */
      async requestSpPurchasedProductReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SP\u5DF2\u8D2D\u4E70\u5546\u54C1\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SP Purchased Product Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_PRODUCTS",
              groupBy: ["asin"],
              columns: [
                // 基础信息 - 根据Excel文档SP Purchased Product sheet
                // v255: 移除'date'列（与timeUnit:SUMMARY冲突）
                // @ts-ignore
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "adGroupId",
                "adGroupName",
                // Excel: adGroupName - 广告组名称
                "advertisedSku",
                // Excel: advertisedSku - 已投放SKU
                "advertisedAsin",
                // Excel: advertisedAsin - 已投放ASIN
                "keyword",
                // Excel: keyword - 定位
                "matchType",
                // Excel: matchType - 匹配类型
                "purchasedAsin",
                // Excel: purchasedAsin - 已购买ASIN
                // 销售指标
                "unitsSoldOtherSku7d",
                // Excel: unitsSoldOtherSku14d - 7天其他SKU数量
                "purchasesOtherSku7d",
                // Excel: purchasesOtherSku7d - 7天其他SKU订单
                "salesOtherSku7d"
                // Excel: salesOtherSku14d - 7天其他SKU销量
              ],
              reportTypeId: "spPurchasedProduct",
              timeUnit: "SUMMARY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SP\u5DF2\u8D2D\u4E70\u5546\u54C1\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u5DF2\u8D2D\u4E70\u5546\u54C1\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u5DF2\u8D2D\u4E70\u5546\u54C1\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SP自动定向报告 (Amazon Ads API v3)
       * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
       * 
       * 自动广告匹配组类型:
       * - CLOSE_MATCH: 紧密匹配
       * - LOOSE_MATCH: 宽泛匹配
       * - SUBSTITUTES: 同类商品
       * - COMPLEMENTS: 关联商品
       */
      async requestSpAutoTargetingReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SP\u81EA\u52A8\u5B9A\u5411\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SP Auto Targeting Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_PRODUCTS",
              groupBy: ["targeting"],
              columns: [
                // v242: 修复无效列名 - 移除targetId/targetingExpression/targetingText/targetingType/date
                "startDate",
                // @ts-ignore
                "endDate",
                // @ts-ignore
                "campaignId",
                "campaignName",
                "adGroupId",
                "adGroupName",
                "keywordId",
                // 替代targetId
                "keyword",
                // 替代targetingText
                "targeting",
                // 替代targetingExpression
                "keywordType",
                // 替代targetingType
                "matchType",
                "impressions",
                "clicks",
                "cost",
                "sales7d",
                "unitsSoldClicks7d",
                "purchases7d"
              ],
              reportTypeId: "spTargeting",
              timeUnit: "SUMMARY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SP\u81EA\u52A8\u5B9A\u5411\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u81EA\u52A8\u5B9A\u5411\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u81EA\u52A8\u5B9A\u5411\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SP广告组绩效报告 (Amazon Ads API v3)
       * 用于同步广告组级别的绩效数据（曝光、点击、花费、销售、订单等）
       */
      async requestSpAdGroupReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SP\u5E7F\u544A\u7EC4\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SP AdGroup Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_PRODUCTS",
              // @ts-ignore
              groupBy: ["adGroup"],
              // @ts-ignore
              columns: [
                // v580: 修复无效列 - 移除campaignId, campaignName, salesOtherSku7d, unitsSoldOtherSku7d
                // Amazon API明确返回这些列不是spCampaigns+groupBy:adGroup的合法列
                "adGroupId",
                "adGroupName",
                "impressions",
                "clicks",
                "cost",
                "sales7d",
                "purchases7d",
                "unitsSoldClicks7d",
                "attributedSalesSameSku7d",
                "unitsSoldSameSku7d"
              ],
              reportTypeId: "spCampaigns",
              timeUnit: "SUMMARY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SP\u5E7F\u544A\u7EC4\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u5E7F\u544A\u7EC4\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u5E7F\u544A\u7EC4\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SB广告组绩效报告 (Amazon Ads API v3)
       * SB使用14天归因窗口
       */
      async requestSbAdGroupReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SB\u5E7F\u544A\u7EC4\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SB AdGroup Report ${startDate} to ${endDate}`,
            // @ts-ignore
            startDate,
            // @ts-ignore
            endDate,
            configuration: {
              adProduct: "SPONSORED_BRANDS",
              groupBy: ["adGroup"],
              columns: [
                // v614: 恢复adGroupId/adGroupName - Amazon API v3 sbAdGroups报告类型支持这些列
                // v580误删了这些列，导致SB广告组绩效数据无法匹配
                "adGroupId",
                "adGroupName",
                "campaignId",
                "campaignName",
                "campaignStatus",
                "impressions",
                "clicks",
                "cost",
                "sales",
                "purchases",
                "detailPageViews",
                "newToBrandPurchases",
                "newToBrandPurchasesPercentage",
                "brandedSearches"
              ],
              reportTypeId: "sbAdGroups",
              timeUnit: "SUMMARY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SB\u5E7F\u544A\u7EC4\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u5E7F\u544A\u7EC4\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u5E7F\u544A\u7EC4\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SD广告组绩效报告 (Amazon Ads API v3)
       * SD使用14天归因窗口 + 浏览归因
       */
      async requestSdAdGroupReport(startDate, endDate) {
        // v620-fix14g-P3: fix24-P3-4b SD AdGroup报告startDate保护(SD保留约65天)
        { const now4b = new Date(); const sdMax4b = 58; const safe4b = new Date(now4b.getTime() - sdMax4b*24*60*60*1000); const safeStr4b = safe4b.toISOString().split('T')[0]; if (startDate < safeStr4b) { log29.info(`[SD API] fix24-P3-4b: SD AdGroup报告startDate ${startDate} 超出保留期，调整为 ${safeStr4b}`); startDate = safeStr4b; } }
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SD\u5E7F\u544A\u7EC4\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SD AdGroup Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_DISPLAY",
              groupBy: ["adGroup"],
              // v614: 修复回["adGroup"] - Amazon API v3 sdAdGroups报告支持adGroup级别
              // v535-fix错误地改为["campaign"]，导致SD广告组绩效数据全部丢失
              columns: [
                // v614: 恢复adGroupId/adGroupName - sdAdGroups报告类型支持这些列
                "adGroupId",
                "adGroupName",
                "campaignId",
                "campaignName",
                "impressions",
                "clicks",
                "cost",
                "sales",
                "purchases",
                "unitsSold",
                "newToBrandPurchases"
              ],
              reportTypeId: "sdAdGroup", // v620-fix14g-P3: fix24-P3-4a 修正sdAdGroups->sdAdGroup(单数)
              timeUnit: "SUMMARY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SD\u5E7F\u544A\u7EC4\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5E7F\u544A\u7EC4\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5E7F\u544A\u7EC4\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SD定向报告 (Amazon Ads API v3)
       * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
       * 
       * SD定向类型:
       * - 受众定向: 浏览再营销、购买再营销等
       * - 商品定向: ASIN/品类定向
       */
      async requestSdTargetingReport(startDate, endDate) {
        // v620-fix14g-P3: fix24-P3-4c SD Targeting报告startDate保护
        { const now4c = new Date(); const sdMax4c = 58; const safe4c = new Date(now4c.getTime() - sdMax4c*24*60*60*1000); const safeStr4c = safe4c.toISOString().split('T')[0]; if (startDate < safeStr4c) { log29.info(`[SD API] fix24-P3-4c: SD Targeting报告startDate ${startDate} 超出保留期，调整为 ${safeStr4c}`); startDate = safeStr4c; } }
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SD\u5B9A\u5411\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SD Targeting Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_DISPLAY",
              groupBy: ["targeting"],
              columns: [
                // 基础信息 - 根据Excel文档SD Targeting sheet
                // v588: 移除date列 - v3 API通过startDate/endDate参数控制日期范围
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 货币
                "adGroupId",
                "adGroupName",
                // Excel: adGroupName - 广告组名称
                "targetingText",
                // Excel: targetingText - 定位
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "impressionsViews",
                // Excel: impressionsViews - 可见展示次数
                "clicks",
                // Excel: clicks - 点击次数
                "detailPageViews",
                // Excel: detailPageViews - 14天详情页浏览量
                // 花费指标
                "cost",
                // Excel: cost - 支出
                // 14天归因销售指标 (SD使用14天归因)
                "sales",
                // Excel: sales - 14天总销售额
                "purchases",
                // Excel: purchases - 14天总订单数
                "unitsSold",
                // Excel: unitsSold - 14天总单位数
                // 新客指标
                "newToBrandPurchases",
                // Excel: newToBrandPurchases - 14天新品牌订单数
                "newToBrandSales",
                // Excel: newToBrandSales - 14天新品牌销售额
                "newToBrandUnitsSold",
                // Excel: newToBrandUnitsSold - 14天新品牌单位数
                // 点击归因指标
                "salesClicks",
                // Excel: salesClicks - 14天总销售额(点击)
                "purchasesClicks",
                // Excel: purchasesClicks - 14天总订单数(点击)
                "unitsSoldClicks",
                // Excel: unitsSoldClicks - 14天总单位数(点击)
                "newToBrandPurchasesClicks",
                // Excel: newToBrandPurchasesClicks - 14天新品牌订单(点击)
                "newToBrandSalesClicks",
                // Excel: newToBrandSalesClicks - 14天新品牌销售额(点击)
                "newToBrandUnitsSoldClicks"
                // Excel: newToBrandUnitsSoldClicks - 14天新品牌单位(点击)
              ],
              // v230: SD报告不支持filters参数（会导致400错误），已移除
              reportTypeId: "sdTargeting",
              timeUnit: "SUMMARY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SD\u5B9A\u5411\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          const sdErrInfo = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
          {
            const _errStr = typeof sdErrInfo === "object" ? JSON.stringify(sdErrInfo).slice(0, 500) : String(sdErrInfo);
            const _isExpected = _errStr.includes("configuration date") || _errStr.includes("425");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5B9A\u5411\u62A5\u544A\u5931\u8D25 (expected): ${_errStr}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5B9A\u5411\u62A5\u544A\u5931\u8D25: ${_errStr}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SD已推广商品报告 (Amazon Ads API v3)
       * 根据Excel文档: SD Advertised product sheet
       * 字段: date, campaignName, adGroupName, bidOptimization, promotedSku, promotedAsin,
       *       impressions, impressionsViews, clicks, detailPageViews, cost, sales, purchases,
       *       unitsSold, newToBrandPurchases, newToBrandSales, newToBrandUnitsSold,
       *       salesClicks, purchasesClicks, unitsSoldClicks, newToBrandPurchasesClicks,
       *       newToBrandSalesClicks, newToBrandUnitsSoldClicks
       */
      async requestSdAdvertisedProductReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SD\u5DF2\u63A8\u5E7F\u5546\u54C1\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SD Advertised Product Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_DISPLAY",
              groupBy: ["advertiser"],
              columns: [
                // 基础信息 - 根据Excel文档SD Advertised product sheet
                "date",
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 货币
                "adGroupId",
                "adGroupName",
                // Excel: adGroupName - 广告组名称
                "bidOptimization",
                // Excel: bidOptimization - 出价优化
                "promotedSku",
                // Excel: promotedSku - 已投放SKU
                // @ts-ignore
                "promotedAsin",
                // Excel: promotedAsin - 已投放ASIN
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "impressionsViews",
                // Excel: impressionsViews - 可见展示次数
                "clicks",
                // Excel: clicks - 点击次数
                "detailPageViews",
                // Excel: detailPageViews - 14天详情页浏览量
                // 花费指标
                "cost",
                // Excel: cost - 支出
                // 14天归因销售指标
                "sales",
                // Excel: sales - 14天总销售额
                "purchases",
                // Excel: purchases - 14天总订单数
                "unitsSold",
                // Excel: unitsSold - 14天总销量
                // 新客指标
                "newToBrandPurchases",
                // Excel: newToBrandPurchases - 14天新品牌订单数
                "newToBrandSales",
                // Excel: newToBrandSales - 14天新品牌销售额
                "newToBrandUnitsSold",
                // Excel: newToBrandUnitsSold - 14天新品牌销量
                // 点击归因指标
                "salesClicks",
                // Excel: salesClicks - 14天总销售额(点击)
                "purchasesClicks",
                // Excel: purchasesClicks - 14天总订单数(点击)
                "unitsSoldClicks",
                // Excel: unitsSoldClicks - 14天总销量(点击)
                "newToBrandPurchasesClicks",
                // Excel: newToBrandPurchasesClicks - 14天新品牌订单数(点击)
                "newToBrandSalesClicks",
                // Excel: newToBrandSalesClicks - 14天新品牌销量(点击)
                "newToBrandUnitsSoldClicks"
                // Excel: newToBrandUnitsSoldClicks - 14天新品牌销量(点击)
              ],
              // v230: SD报告不支持filters参数（会导致400错误），已移除
              reportTypeId: "sdAdvertisedProduct",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SD\u5DF2\u63A8\u5E7F\u5546\u54C1\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5DF2\u63A8\u5E7F\u5546\u54C1\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5DF2\u63A8\u5E7F\u5546\u54C1\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SD匹配目标报告 (Amazon Ads API v3)
       * 根据Excel文档: SD Matchd Target sheet
       * 字段: date, campaignName, targetingText, matchedTargetAsin, impressions, clicks,
       *       cost, sales, purchases, unitsSold
       */
      async requestSdMatchedTargetReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SD\u5339\u914D\u76EE\u6807\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SD Matched Target Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_DISPLAY",
              groupBy: ["matchedTarget"],
              columns: [
                // 基础信息 - 根据Excel文档SD Matchd Target sheet
                // v255: 移除'date'列（与timeUnit:SUMMARY冲突）
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 货币
                "targetingText",
                // Excel: targetingText - 定位
                "matchedTargetAsin",
                // Excel: matchedTargetAsin - 匹配目标
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "clicks",
                // Excel: clicks - 点击次数
                // 花费指标
                "cost",
                // Excel: cost - 支出
                // 14天归因销售指标
                "sales",
                // Excel: sales - 14天销售总额
                "purchases",
                // Excel: purchases - 14天订单总数
                "unitsSold"
                // Excel: unitsSold - 14天单位总数
              ],
              // v230: SD报告不支持filters参数（会导致400错误），已移除
              reportTypeId: "sdTargeting",
              // v400-fix: BUG-A1修复 - Amazon API不支持'sdMatchedTarget'，正确值为'sdTargeting'+groupBy['matchedTarget']
              timeUnit: "SUMMARY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SD\u5339\u914D\u76EE\u6807\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5339\u914D\u76EE\u6807\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5339\u914D\u76EE\u6807\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SB定向报告 (Amazon Ads API v3)
       * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
       */
      async requestSbTargetingReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SB\u5B9A\u5411\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SB Targeting Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_BRANDS",
              groupBy: ["targeting"],
              columns: [
                // 基础信息 - 根据Excel文档SB Keyword sheet
                "date",
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 币种
                "adGroupId",
                "adGroupName",
                // Excel: adGroupName - 广告组名称
                "targetingText",
                // Excel: targetingText - 定位
                "matchType",
                // Excel: matchType - 匹配类型
                "costType",
                // Excel: costType - 费用类型
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "topOfSearchImpressionShare",
                // Excel: topOfSearchImpressionShare - 搜索结果顶部展示次数份额
                "clicks",
                // Excel: clicks - 点击次数
                "viewabilityRate",
                // Excel: viewabilityRate - 观看率 (VTR)
                "viewClickThroughRate",
                // Excel: viewClickThroughRate - 观看点击率 (vCTR)
                // 花费指标
                "cost",
                // Excel: cost - 支出
                // 14天归因销售指标
                "sales",
                // Excel: sales - 14天总销售额
                "purchases",
                // Excel: purchases - 14天总订单量
                "unitsSold",
                // Excel: unitsSold - 14天总单位数
                // 点击归因指标
                "salesClicks",
                // Excel: salesClicks - 14天总销售额(点击)
                "purchasesClicks",
                // Excel: purchasesClicks - 14天总订单数(点击)
                "unitsSoldClicks",
                // Excel: unitsSoldClicks - 14天总单位数(点击)
                // 视频指标
                "videoFirstQuartileViews",
                // Excel: videoFirstQuartileViews
                "videoMidpointViews",
                // Excel: videoMidpointViews
                "videoThirdQuartileViews",
                // Excel: videoThirdQuartileViews
                "videoCompleteViews",
                // Excel: videoCompleteViews
                "videoUnmutes",
                // Excel: videoUnmutes
                "video5SecondViews",
                // Excel: video5SecondViews
                "video5SecondViewRate",
                // Excel: video5SecondViewRate
                // 品牌搜索
                "brandedSearches",
                // Excel: brandedSearches
                // 详情页浏览
                "detailPageViews",
                // Excel: detailPageViews
                // 新客指标
                "newToBrandPurchases",
                // Excel: newToBrandPurchases
                "newToBrandPurchasesPercentage",
                // Excel: newToBrandPurchasesPercentage
                "newToBrandSales",
                // Excel: newToBrandSales
                "newToBrandSalesPercentage",
                // Excel: newToBrandSalesPercentage
                "newToBrandUnitsSold",
                // Excel: newToBrandUnitsSold
                "newToBrandUnitsSoldPercentage",
                // Excel: newToBrandUnitsSoldPercentage
                "newToBrandPurchasesRate"
                // Excel: newToBrandPurchasesRate
              ],
              // v580: 移除filters - sbTargeting报告不支持campaignStatus filter
              // Amazon API返回: "configuration filters includes fields: (campaignStatus) which are invalid for groupBys: targeting"
              reportTypeId: "sbTargeting",
              timeUnit: "SUMMARY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SB\u5B9A\u5411\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          const sbErrInfo = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
          {
            const _errStr = typeof sbErrInfo === "object" ? JSON.stringify(sbErrInfo).slice(0, 500) : String(sbErrInfo);
            const _isExpected = _errStr.includes("configuration date") || _errStr.includes("425");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u5B9A\u5411\u62A5\u544A\u5931\u8D25 (expected): ${_errStr}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u5B9A\u5411\u62A5\u544A\u5931\u8D25: ${_errStr}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SB搜索词报告 (Amazon Ads API v3)
       * 根据Excel文档: SB Search term sheet
       * 字段: date, campaignName, adGroupName, keywordText, matchType, searchTerm, costType,
       *       impressions, viewableImpressions, clicks, cost, sales, purchases, unitsSold,
       *       salesClicks, purchasesClicks
       */
      async requestSbSearchTermReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SB\u641C\u7D22\u8BCD\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SB Search Term Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              // @ts-ignore
              adProduct: "SPONSORED_BRANDS",
              // @ts-ignore
              groupBy: ["searchTerm"],
              columns: [
                // 基础信息 - 根据Excel文档SB Search term sheet
                "date",
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 货币
                "adGroupId",
                "adGroupName",
                // Excel: adGroupName - 广告组名称
                "keywordText",
                // Excel: keywordText - 定位
                "matchType",
                // Excel: matchType - 匹配类型
                "searchTerm",
                // Excel: searchTerm - 客户搜索词
                "costType",
                // Excel: costType - 费用类型
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "viewableImpressions",
                // Excel: viewableImpressions - 可见展示次数
                "clicks",
                // Excel: clicks - 点击次数
                // 花费指标
                "cost",
                // Excel: cost - 支出
                // 14天归因销售指标
                "sales",
                // Excel: sales - 14天总销售额
                "purchases",
                // Excel: purchases - 14天总订单数
                "unitsSold",
                // Excel: unitsSold - 14天总单位数
                // 点击归因指标
                "salesClicks",
                // Excel: salesClicks - 14天总销售额(点击)
                "purchasesClicks"
                // Excel: purchasesClicks - 14天总订单数(点击)
              ],
              // v349: 移除campaignStatus过滤器 — Amazon API不允许在searchTerm groupBy中使用此过滤器(返回400)
              reportTypeId: "sbSearchTerm",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SB\u641C\u7D22\u8BCD\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u641C\u7D22\u8BCD\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u641C\u7D22\u8BCD\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SB广告位置报告 (Amazon Ads API v3)
       * 根据Excel文档: SB Campaign Placement sheet
       * 字段: date, campaignName, costType, placementClassification, impressions, viewableImpressions,
       *       clicks, cost, sales, purchases, unitsSold, viewabilityRate, viewClickThroughRate,
       *       videoFirstQuartileViews, videoMidpointViews, videoThirdQuartileViews, videoCompleteViews,
       *       videoUnmutes, video5SecondViews, video5SecondViewRate, brandedSearches, detailPageViews,
       *       newToBrandPurchases, newToBrandSales, newToBrandUnitsSold, salesClicks, purchasesClicks, unitsSoldClicks
       */
      async requestSbCampaignPlacementReport(startDate, endDate) {
        try {
          log29.debug(`[Amazon API] \u8BF7\u6C42SB\u5E7F\u544A\u4F4D\u7F6E\u62A5\u544A: ${startDate} - ${endDate}`);
          const requestBody = {
            name: `SB Campaign Placement Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_BRANDS",
              groupBy: ["campaignPlacement"],
              // v400-fix: BUG-A2修复 - Amazon标准groupBy是['campaignPlacement']而不是['campaign', 'placement']
              columns: [
                // 基础信息 - 根据Excel文档SB Campaign Placement sheet
                "date",
                "campaignId",
                "campaignName",
                // Excel: campaignName - 广告系列名称
                "campaignBudgetCurrencyCode",
                // Excel: campaignBudgetCurrencyCode - 币种
                "costType",
                // Excel: costType - 费用类型
                "placementClassification",
                // Excel: placementClassification - 展示位置
                // 流量指标
                "impressions",
                // Excel: impressions - 展示次数
                "viewableImpressions",
                // Excel: viewableImpressions - 可见展示次数
                "clicks",
                // Excel: clicks - 点击次数
                "viewabilityRate",
                // Excel: viewabilityRate - 观看率 (VTR)
                "viewClickThroughRate",
                // Excel: viewClickThroughRate - 观看点击率 (vCTR)
                // 花费指标
                "cost",
                // Excel: cost - 支出
                // 14天归因销售指标
                "sales",
                // Excel: sales - 14天总销售额
                "purchases",
                // Excel: purchases - 14天总订单量
                "unitsSold",
                // Excel: unitsSold - 14天总单位数
                // 点击归因指标
                // @ts-ignore
                "salesClicks",
                // Excel: salesClicks - 14天总销售额(点击)
                // @ts-ignore
                "purchasesClicks",
                // Excel: purchasesClicks - 14天总订单数量(点击)
                "unitsSoldClicks",
                // Excel: unitsSoldClicks - 14天总单位数量(点击)
                // 视频指标
                "videoFirstQuartileViews",
                // Excel: videoFirstQuartileViews
                "videoMidpointViews",
                // Excel: videoMidpointViews
                "videoThirdQuartileViews",
                // Excel: videoThirdQuartileViews
                "videoCompleteViews",
                // Excel: videoCompleteViews
                "videoUnmutes",
                // Excel: videoUnmutes
                "video5SecondViews",
                // Excel: video5SecondViews
                "video5SecondViewRate",
                // Excel: video5SecondViewRate
                // 品牌搜索
                "brandedSearches",
                // Excel: brandedSearches
                // 详情页浏览
                "detailPageViews",
                // Excel: detailPageViews
                // 新客指标
                "newToBrandPurchases",
                // Excel: newToBrandPurchases
                "newToBrandPurchasesPercentage",
                // Excel: newToBrandPurchasesPercentage
                "newToBrandSales",
                // Excel: newToBrandSales
                "newToBrandSalesPercentage",
                // Excel: newToBrandSalesPercentage
                "newToBrandUnitsSold",
                // Excel: newToBrandUnitsSold
                "newToBrandUnitsSoldPercentage",
                // Excel: newToBrandUnitsSoldPercentage
                "newToBrandPurchasesRate"
                // Excel: newToBrandPurchasesRate
              ],
              // v578-fix: 移除filters配置 - sbCampaignPlacement报告类型不支持filter参数
              // Amazon API返回: "no filters available for this report type. Please remove filters."
              reportTypeId: "sbCampaignPlacement",
              // v400-fix: BUG-A2修复 - 正确的reportTypeId是'sbCampaignPlacement'而不是'sbCampaigns'
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SB\u5E7F\u544A\u4F4D\u7F6E\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u5E7F\u544A\u4F4D\u7F6E\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u5E7F\u544A\u4F4D\u7F6E\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SB广告报告 (广告素材级别)
       * 基于Postman文档: reportTypeId = sbAds, groupBy = ["ads"]
       */
      async requestSbAdsReport(profileId, startDate, endDate) {
        try {
          this.setProfileId(profileId);
          const requestBody = {
            name: `SB Ads Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_BRANDS",
              groupBy: ["ads"],
              columns: [
                "date",
                "campaignId",
                "campaignName",
                "campaignStatus",
                "campaignBudgetAmount",
                // @ts-ignore
                "adGroupId",
                // @ts-ignore
                "adGroupName",
                "adId",
                "adStatus",
                "impressions",
                "clicks",
                "clickThroughRate",
                "cost",
                "costPerClick",
                "sales",
                "salesClicks",
                "purchases",
                "purchasesClicks",
                "unitsSold",
                "unitsSoldClicks",
                "newToBrandSales",
                "newToBrandPurchases",
                "newToBrandUnitsSold",
                "video5SecondViews",
                "video5SecondViewRate",
                "videoFirstQuartileViews",
                "videoMidpointViews",
                "videoThirdQuartileViews",
                "videoCompleteViews",
                "videoUnmutes",
                "viewClickThroughRate"
              ],
              filters: [
                {
                  field: "campaignStatus",
                  values: ["ARCHIVED", "ENABLED", "PAUSED"]
                }
              ],
              reportTypeId: "sbAds",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SB\u5E7F\u544A\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u5E7F\u544A\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u5E7F\u544A\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SD广告组报告
       * 基于Postman文档: reportTypeId = sdAdGroup, groupBy = ["adGroup"]
       */
      async requestSdAdGroupReportDetailed(profileId, startDate, endDate) {
        try {
          this.setProfileId(profileId);
          const requestBody = {
            name: `SD AdGroup Report Detailed ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_DISPLAY",
              groupBy: ["adGroup"],
              columns: [
                "date",
                "campaignId",
                "campaignName",
                // @ts-ignore
                "campaignStatus",
                // @ts-ignore
                "campaignBudgetAmount",
                "adGroupId",
                "adGroupName",
                "costType",
                "bidOptimization",
                "impressions",
                "impressionsViews",
                "clicks",
                "clickThroughRate",
                "cost",
                "costPerClick",
                "detailPageViews",
                "detailPageViewsClicks",
                "sales",
                "salesClicks",
                "purchases",
                "purchasesClicks",
                "unitsSold",
                "unitsSoldClicks",
                "newToBrandSales",
                "newToBrandSalesClicks",
                "newToBrandPurchases",
                "newToBrandPurchasesClicks",
                "newToBrandUnitsSold",
                "newToBrandUnitsSoldClicks",
                "salesBrandHalo",
                "salesBrandHaloClicks",
                "unitsSoldBrandHalo",
                "unitsSoldBrandHaloClicks",
                "viewabilityRate",
                "viewClickThroughRate"
              ],
              // v230: SD报告不支持filters参数（会导致400错误），已移除
              // v473: 修复 - SD没有独立的adGroup报告类型，使用sdCampaigns + groupBy:['adGroup']
              reportTypeId: "sdCampaigns",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SD\u5E7F\u544A\u7EC4\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5E7F\u544A\u7EC4\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5E7F\u544A\u7EC4\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SD已购买商品报告
       * 基于Postman文档: reportTypeId = sdPurchasedProduct, groupBy = ["asin"]
       */
      async requestSdPurchasedProductReport(profileId, startDate, endDate) {
        try {
          this.setProfileId(profileId);
          const requestBody = {
            name: `SD Purchased Product Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_DISPLAY",
              groupBy: ["asin"],
              columns: [
                "date",
                "campaignId",
                "campaignName",
                "adGroupId",
                "adGroupName",
                "purchasedAsin",
                "impressions",
                "clicks",
                "cost",
                "sales",
                "salesClicks",
                "purchases",
                "purchasesClicks",
                "unitsSold",
                "unitsSoldClicks",
                "newToBrandSales",
                "newToBrandPurchases",
                "newToBrandUnitsSold"
              ],
              // v230: SD报告不支持filters参数（会导致400错误），已移除
              reportTypeId: "sdPurchasedProduct",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SD\u5DF2\u8D2D\u4E70\u5546\u54C1\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5DF2\u8D2D\u4E70\u5546\u54C1\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u5DF2\u8D2D\u4E70\u5546\u54C1\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SP无效流量报告
       * 基于Postman文档: reportTypeId = spGrossAndInvalids, groupBy = ["campaign"]
       * 数据保留天数: 365天
       */
      async requestSpGrossAndInvalidsReport(profileId, startDate, endDate) {
        try {
          this.setProfileId(profileId);
          const requestBody = {
            name: `SP Gross And Invalids Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_PRODUCTS",
              groupBy: ["campaign"],
              columns: [
                "date",
                "campaignId",
                "campaignName",
                "grossImpressions",
                "grossClickThroughs",
                "invalidImpressions",
                "invalidClickThroughs",
                "invalidImpressionRate",
                "invalidClickThroughRate"
              ],
              filters: [
                {
                  field: "campaignStatus",
                  values: ["ARCHIVED", "ENABLED", "PAUSED"]
                }
              ],
              reportTypeId: "spGrossAndInvalids",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SP\u65E0\u6548\u6D41\u91CF\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u65E0\u6548\u6D41\u91CF\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SP\u65E0\u6548\u6D41\u91CF\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SB无效流量报告
       * 基于Postman文档: reportTypeId = sbGrossAndInvalids, groupBy = ["campaign"]
       * 数据保留天数: 365天
       */
      async requestSbGrossAndInvalidsReport(profileId, startDate, endDate) {
        try {
          this.setProfileId(profileId);
          const requestBody = {
            name: `SB Gross And Invalids Report ${startDate} to ${endDate}`,
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_BRANDS",
              groupBy: ["campaign"],
              columns: [
                "date",
                "campaignId",
                "campaignName",
                "grossImpressions",
                "grossClickThroughs",
                "invalidImpressions",
                "invalidClickThroughs",
                "invalidImpressionRate",
                "invalidClickThroughRate"
              ],
              filters: [
                {
                  field: "campaignStatus",
                  values: ["ARCHIVED", "ENABLED", "PAUSED"]
                }
              ],
              reportTypeId: "sbGrossAndInvalids",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SB\u65E0\u6548\u6D41\u91CF\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u65E0\u6548\u6D41\u91CF\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SB\u65E0\u6548\u6D41\u91CF\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 请求SD无效流量报告
       * 基于Postman文档: reportTypeId = sdGrossAndInvalids, groupBy = ["campaign"]
       * 数据保留天数: 365天
       */
      async requestSdGrossAndInvalidsReport(profileId, startDate, endDate) {
        try {
          this.setProfileId(profileId);
          const requestBody = {
            name: `SD Gross And Invalids Report ${startDate} to ${endDate}`,
            // @ts-ignore
            startDate,
            endDate,
            configuration: {
              adProduct: "SPONSORED_DISPLAY",
              groupBy: ["campaign"],
              columns: [
                "date",
                "campaignId",
                "campaignName",
                "grossImpressions",
                "grossClickThroughs",
                "invalidImpressions",
                "invalidClickThroughs",
                "invalidImpressionRate",
                "invalidClickThroughRate"
              ],
              // v230: SD报告不支持filters参数（会导致400错误），已移除
              reportTypeId: "sdGrossAndInvalids",
              timeUnit: "DAILY",
              format: "GZIP_JSON"
            }
          };
          const response = await this.axiosInstance.post("/reporting/reports", requestBody, {
            headers: {
              "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.info(`[Amazon API] SD\u65E0\u6548\u6D41\u91CF\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId: ${response.data.reportId}`);
          return response.data.reportId;
        } catch (error48) {
          {
            const _errStatus = error48.response?.status;
            const _errMsg = error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message;
            const _isExpected = _errStatus === 425 || _errStatus === 400 && JSON.stringify(_errMsg).includes("configuration date");
            if (_isExpected) {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u65E0\u6548\u6D41\u91CF\u62A5\u544A\u5931\u8D25 (expected): status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 200)}`);
            } else {
              log29.warn(`[Amazon API] \u8BF7\u6C42SD\u65E0\u6548\u6D41\u91CF\u62A5\u544A\u5931\u8D25: status=${_errStatus}, ${JSON.stringify(_errMsg)?.slice(0, 500)}`);
            }
          }
          throw error48;
        }
      }
      /**
       * 获取报告状态
       */
      async getReportStatus(reportId) {
        try {
          const response = await this.axiosInstance.get(`/reporting/reports/${reportId}`, {
            headers: {
              "Accept": "application/vnd.createasyncreportrequest.v3+json"
            }
          });
          log29.debug(`[Amazon API] \u62A5\u544A\u72B6\u6001: reportId=${reportId}, status=${response.data.status}`);
          return {
            status: response.data.status,
            url: response.data.url,
            failureReason: response.data.failureReason
          };
        } catch (error48) {
          log29.warn(`[Amazon API] \u83B7\u53D6\u62A5\u544A\u72B6\u6001\u5931\u8D25:`, error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message);
          throw error48;
        }
      }
      /**
       * 下载报告数据
       */
      async downloadReport(url3, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            const response = await axios_default.get(url3, {
              responseType: "stream",
              timeout: 12e4
            });
            const zlib2 = await import("zlib");
            const data = await new Promise((resolve, reject) => {
              const chunks = [];
              let totalSize = 0;
              const MAX_SIZE = 500 * 1024 * 1024;
              let memoryWarningLogged = false;
              const checkMemoryPressure = /* @__PURE__ */ __name(() => {
                const mem = process.memoryUsage();
                const heapUsedRatio = mem.heapUsed / mem.heapTotal;
                if (heapUsedRatio > 0.8 && !memoryWarningLogged) {
                  memoryWarningLogged = true;
                  log29.warn(`[v580] \u62A5\u544A\u4E0B\u8F7D\u5185\u5B58\u538B\u529B: heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB (${(heapUsedRatio * 100).toFixed(1)}%), \u89E6\u53D1GC`);
                  if (global.gc) {
                    try {
                      global.gc();
                    } catch (e) {
                    }
                  }
                }
              }, "checkMemoryPressure");
              let lastDataTime = Date.now();
              const STREAM_IDLE_TIMEOUT = 12e4;
              const idleTimer = setInterval(() => {
                if (Date.now() - lastDataTime > STREAM_IDLE_TIMEOUT) {
                  clearInterval(idleTimer);
                  gunzip.destroy();
                  reject(new Error(`Stream idle timeout: no data received for ${STREAM_IDLE_TIMEOUT / 1e3}s`));
                }
              }, 3e4);
              const gunzip = zlib2.createGunzip();
              response.data.pipe(gunzip).on("data", (chunk2) => {
                lastDataTime = Date.now();
                totalSize += chunk2.length;
                if (totalSize > MAX_SIZE) {
                  clearInterval(idleTimer);
                  gunzip.destroy();
                  reject(new Error(`Report too large: ${totalSize} bytes exceeds ${MAX_SIZE} bytes limit`));
                  return;
                }
                chunks.push(chunk2);
                if (totalSize % (10 * 1024 * 1024) < chunk2.length) {
                  checkMemoryPressure();
                }
              }).on("end", () => {
                clearInterval(idleTimer);
                try {
                  const jsonStr = Buffer.concat(chunks).toString("utf-8");
                  chunks.length = 0;
                  const result = JSON.parse(jsonStr);
                  log29.info(`[v580] \u62A5\u544A\u89E3\u538B\u5B8C\u6210\uFF0C\u539F\u59CB\u5927\u5C0F: ${(totalSize / 1024).toFixed(0)}KB, \u6570\u636E\u6761\u6570: ${result?.length || 0}, \u5C1D\u8BD5: ${attempt}/${retries}`);
                  resolve(result);
                } catch (parseError) {
                  reject(new Error(`Failed to parse report JSON: ${parseError.message}`));
                }
              }).on("error", (err) => {
                clearInterval(idleTimer);
                reject(new Error(`Failed to decompress report: ${err.message}`));
              });
            });
            return data;
          } catch (downloadErr) {
            const errMsg = downloadErr.message || "";
            log29.warn(`[v580] \u62A5\u544A\u4E0B\u8F7D\u5931\u8D25(\u5C1D\u8BD5${attempt}/${retries}): ${errMsg}`);
            if (attempt >= retries) {
              throw new Error(`Report download failed after ${retries} attempts: ${errMsg}`);
            }
            const backoff = Math.min(5e3 * Math.pow(2, attempt - 1), 2e4);
            log29.info(`[v580] ${backoff / 1e3}\u79D2\u540E\u91CD\u8BD5\u4E0B\u8F7D...`);
            await new Promise((resolve) => setTimeout(resolve, backoff));
          }
        }
        throw new Error("Unreachable: download retry loop exited without result");
      }
      /**
       * 等待报告完成并下载
       * v413: 智能退避优化 — 指数退避轮询(5s→10s→20s→30s) + 缩短默认超时(15分钟→5分钟) + 连续PENDING检测
       */
      async waitAndDownloadReport(reportId, maxWaitMs = 6e5) {
        const startTime = Date.now();
        let pollCount = 0;
        const getPollInterval = /* @__PURE__ */ __name((count11) => {
          const intervals = [5e3, 1e4, 2e4, 3e4];
          return intervals[Math.min(count11, intervals.length - 1)];
        }, "getPollInterval");
        log29.info(`[Amazon API] v413: \u5F00\u59CB\u7B49\u5F85\u62A5\u544A\u5B8C\u6210: ${reportId}, \u8D85\u65F6=${Math.round(maxWaitMs / 1e3)}\u79D2`);
        while (Date.now() - startTime < maxWaitMs) {
          try {
            const status = await this.getReportStatus(reportId);
            if (status.status === "COMPLETED" && status.url) {
              const waitSec = Math.round((Date.now() - startTime) / 1e3);
              log29.info(`[Amazon API] v413: \u62A5\u544A\u5DF2\u5B8C\u6210\uFF0C\u7B49\u5F85${waitSec}\u79D2\uFF0C\u8F6E\u8BE2${pollCount}\u6B21\uFF0C\u5F00\u59CB\u4E0B\u8F7D...`);
              const data = await this.downloadReport(status.url);
              log29.info(`[Amazon API] v413: \u62A5\u544A\u4E0B\u8F7D\u5B8C\u6210\uFF0C\u6570\u636E\u6761\u6570: ${data?.length || 0}`);
              return data;
            }
            if (status.status === "FAILED") {
              const failReason = status.failureReason || "unknown";
              log29.warn(`[Amazon API] v413: \u62A5\u544A\u751F\u6210\u5931\u8D25: ${failReason}`);
              throw new Error(`Report generation failed: ${failReason}`);
            }
            const interval = getPollInterval(pollCount);
            pollCount++;
            const elapsedSec = Math.round((Date.now() - startTime) / 1e3);
            if (pollCount <= 3 || pollCount % 5 === 0) {
              log29.info(`[Amazon API] v413: \u62A5\u544A${reportId.slice(-8)} PENDING, \u5DF2\u7B49${elapsedSec}\u79D2, \u8F6E\u8BE2#${pollCount}, \u4E0B\u6B21${interval / 1e3}\u79D2\u540E`);
            }
            await new Promise((resolve) => setTimeout(resolve, interval));
          } catch (pollErr) {
            const errMsg = pollErr.message || "";
            if (errMsg.includes("Report generation failed")) {
              throw pollErr;
            }
            pollCount++;
            const interval = getPollInterval(pollCount);
            log29.warn(`[Amazon API] v413: \u8F6E\u8BE2\u62A5\u544A\u72B6\u6001\u5931\u8D25(#${pollCount}): ${errMsg}\uFF0C${interval / 1e3}\u79D2\u540E\u91CD\u8BD5`);
            await new Promise((resolve) => setTimeout(resolve, interval));
          }
        }
        const totalSec = Math.round((Date.now() - startTime) / 1e3);
        log29.warn(`[Amazon API] v413: \u62A5\u544A\u751F\u6210\u8D85\u65F6 - reportId=${reportId}, \u7B49\u5F85${totalSec}\u79D2, \u8F6E\u8BE2${pollCount}\u6B21`);
        throw new Error(`Report generation timeout after ${totalSec}s (${pollCount} polls)`);
      }

      /**
       * P5: Submit reports to async queue instead of waiting synchronously
       * Reports are submitted to Amazon API, and the reportId is stored in report_jobs table
       * ReportJobScheduler will poll for completion and process data asynchronously
       */
      async submitReportsToAsyncQueue(reportRequests, context = {}) {
        const log = this._log || console;
        const startTime = Date.now();
        const results = new Array(reportRequests.length).fill(null);
        const jobIds = [];
        
        for (let i = 0; i < reportRequests.length; i++) {
          const req = reportRequests[i];
          try {
            // Submit to Amazon API to get reportId
            const reportId = await req.requestFn();
            log.info(`[P5:AsyncQueue] Report submitted [${req.name}]: reportId=${reportId}`);
            
            // Store in report_jobs table for async processing
            try {
              const { getDb: _getDb } = await Promise.resolve().then(() => (init_connection(), connection_exports));
              const _db = await _getDb();
              if (_db) {
                const { reportJobs: _rj } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
                const adType = req.name.includes("SP") ? "SP" : req.name.includes("SB") ? "SB" : "SD";
                const [insertResult] = await _db.insert(_rj).values({
                  accountId: context.accountId || this.accountId || 0,
                  profileId: context.profileId || this.profileId || "",
                  reportType: req.name,
                  adProduct: adType === "SP" ? "SPONSORED_PRODUCTS" : adType === "SB" ? "SPONSORED_BRANDS" : "SPONSORED_DISPLAY",
                  status: "submitted",
                  reportId: reportId,
                  startDate: context.startDate || "",
                  endDate: context.endDate || "",
                  requestPayload: JSON.stringify({
                    source: "P5_async_queue",
                    adType: adType.toLowerCase(),
                    reportName: req.name,
                    startDate: context.startDate || "",
                    endDate: context.endDate || "",
                    syncType: context.syncType || "performance",
                    accountId: context.accountId || this.accountId || 0
                  }),
                  retryCount: 0,
                  maxRetries: 5,
                  submittedAt: new Date().toISOString()
                });
                const jobId = insertResult.insertId;
                jobIds.push(jobId);
                log.info(`[P5:AsyncQueue] Report job created: jobId=${jobId}, reportId=${reportId} [${req.name}]`);
                results[i] = { name: req.name, data: null, jobId, reportId, queued: true };
              }
            } catch (dbErr) {
              log.warn(`[P5:AsyncQueue] Failed to create report job [${req.name}]: ${dbErr.message}`);
              results[i] = { name: req.name, data: null, error: `queue_failed: ${dbErr.message}` };
            }
            
            // Rate limit between submissions
            if (i < reportRequests.length - 1) {
              await new Promise(r => setTimeout(r, 2000));
            }
          } catch (submitErr) {
            const errMsg = submitErr.message || "";
            const errBody = submitErr.response?.data;
            const errDetail = errBody ? ` | response: ${JSON.stringify(errBody).slice(0, 300)}` : "";
            
            // Handle retention errors
            if (errDetail.includes("retention") || errDetail.includes("configuration date")) {
              log.info(`[P5:AsyncQueue] Report exceeds retention period [${req.name}], returning empty`);
              results[i] = { name: req.name, data: [] };
              continue;
            }
            
            // Handle 429 rate limit with retry
            const is429 = submitErr.response?.status === 429 || errMsg.includes("429");
            if (is429 && !req._retried) {
              req._retried = true;
              const retryDelay = 10000 + Math.random() * 5000;
              log.info(`[P5:AsyncQueue] Rate limited (429), retrying in ${Math.round(retryDelay/1000)}s [${req.name}]`);
              await new Promise(r => setTimeout(r, retryDelay));
              try {
                const retryReportId = await req.requestFn();
                results[i] = { name: req.name, data: null, reportId: retryReportId, queued: true };
                log.info(`[P5:AsyncQueue] Retry succeeded [${req.name}]: reportId=${retryReportId}`);
              } catch (retryErr) {
                log.warn(`[P5:AsyncQueue] Retry failed [${req.name}]: ${retryErr.message}`);
                results[i] = { name: req.name, data: null, error: retryErr.message };
              }
              continue;
            }
            
            log.warn(`[P5:AsyncQueue] Report submit failed [${req.name}]: ${errMsg}${errDetail}`);
            results[i] = { name: req.name, data: null, error: errMsg };
          }
        }
        
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const queued = results.filter(r => r?.queued).length;
        const failed = results.filter(r => r?.error).length;
        log.info(`[P5:AsyncQueue] Batch complete: ${queued} queued, ${failed} failed, ${elapsed}s elapsed, jobIds=[${jobIds.join(",")}]`);
        
        // Notify via Redis that new jobs are available
        try {
          const { getRedis: _rds, isRedisAvailable: _rdsOk } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
          if (_rdsOk() && _rds()) {
            await _rds().publish("report:jobs:new", JSON.stringify({ jobIds, source: "P5_async_queue" }));
          }
        } catch (_pubErr) {}
        
        return { results, jobIds, queued, failed };
      }

      // ==================== Sponsored Brands API ====================
      /**
       * 获取SB广告活动列表
       * 注意：SB v4 API需要特定的Content-Type header
       */
      async listSbCampaigns() {
        const allCampaigns = [];
        let nextToken;
        let pageCount = 0;
        do {
          const body = { maxResults: 100 };
          if (nextToken) {
            body.nextToken = nextToken;
          }
          const response = await this.axiosInstance.post(
            "/sb/v4/campaigns/list",
            body,
            {
              headers: {
                "Content-Type": "application/vnd.sbcampaignresource.v4+json",
                "Accept": "application/vnd.sbcampaignresource.v4+json"
              }
              // @ts-ignore
            }
          );
          const campaigns6 = response.data.campaigns || [];
          if (pageCount === 0 && campaigns6.length > 0) {
            log29.debug("[SB API DEBUG] First campaign full structure:");
            log29.debug(JSON.stringify(campaigns6[0], null, 2));
            log29.debug("[SB API DEBUG] First campaign startDate:", campaigns6[0].startDate);
            log29.debug("[SB API DEBUG] First campaign keys:", Object.keys(campaigns6[0]));
            log29.debug("[SB API] \u9884\u7B97\u5B57\u6BB5\u68C0\u67E5:");
            log29.debug("  - budget:", campaigns6[0].budget);
            log29.debug("  - dailyBudget:", campaigns6[0].dailyBudget);
            log29.debug("  - state:", campaigns6[0].state);
            log29.debug("  - status:", campaigns6[0].status);
          }
          allCampaigns.push(...campaigns6);
          nextToken = response.data.nextToken;
          pageCount++;
          log29.debug(`[SB API] \u7B2C${pageCount}\u9875\u83B7\u53D6\u5230 ${campaigns6.length} \u4E2ASB\u5E7F\u544A\u6D3B\u52A8, \u603B\u8BA1: ${allCampaigns.length}`);
        } while (nextToken);
        log29.debug(`[SB API] \u5171\u83B7\u53D6\u5230 ${allCampaigns.length} \u4E2ASB\u5E7F\u544A\u6D3B\u52A8`);
        return allCampaigns;
      }
      /**
       * 获取SB广告组列表
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSbAdGroups(campaignId) {
        const allAdGroups = [];
        let nextToken;
        do {
          const body = { maxResults: 100 };
          if (campaignId) {
            body.campaignIdFilter = { include: [String(campaignId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          const response = await this.axiosInstance.post(
            "/sb/v4/adGroups/list",
            body,
            {
              headers: {
                "Content-Type": "application/vnd.sbadgroupresource.v4+json",
                "Accept": "application/vnd.sbadgroupresource.v4+json"
                // @ts-ignore
              }
            }
          );
          const adGroups6 = response.data.adGroups || [];
          allAdGroups.push(...adGroups6);
          nextToken = response.data.nextToken;
          log29.debug(`[SB API] Fetched ${adGroups6.length} ad groups, total: ${allAdGroups.length}, hasMore: ${!!nextToken}`);
        } while (nextToken);
        log29.debug(`[SB API] Total ad groups fetched: ${allAdGroups.length}`);
        return allAdGroups;
      }
      /**
       * 获取SB关键词列表
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSbKeywords(adGroupId) {
        const allKeywords = [];
        let nextToken;
        do {
          const body = { maxResults: 100 };
          if (adGroupId) {
            body.adGroupIdFilter = { include: [String(adGroupId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          try {
            const response = await this.axiosInstance.post(
              "/sb/v4/keywords/list",
              body,
              {
                headers: {
                  "Content-Type": "application/vnd.sbkeywordresource.v4+json",
                  "Accept": "application/vnd.sbkeywordresource.v4+json"
                }
              }
            );
            const keywords10 = response.data.keywords || [];
            allKeywords.push(...keywords10);
            nextToken = response.data.nextToken;
            log29.debug(`[SB API] Fetched ${keywords10.length} keywords, total: ${allKeywords.length}, hasMore: ${!!nextToken}`);
          } catch (error48) {
            const statusCode = error48.response?.status;
            if (statusCode === 404) {
              log29.warn(`[SB API] v332: SB keywords/list\u8FD4\u56DE404\uFF0C\u8BE5\u8D26\u6237\u53EF\u80FD\u672A\u5F00\u901ASB\u5173\u952E\u8BCD\u5B9A\u5411\u529F\u80FD\uFF0C\u8DF3\u8FC7`);
              return [];
            }
            if (statusCode === 403) {
              log29.warn(`[SB API] v456: SB keywords/list\u8FD4\u56DE403 PERMISSION_DENIED\uFF0CProfile\u7F3A\u5C11SB\u6743\u9650\uFF0C\u8DF3\u8FC7SB\u5173\u952E\u8BCD\u540C\u6B65`);
              return [];
            }
            throw error48;
          }
        } while (nextToken);
        log29.debug(`[SB API] Total keywords fetched: ${allKeywords.length}`);
        return allKeywords;
      }
      /**
       * 获取SB商品定位列表
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSbTargets(adGroupId) {
        const allTargets = [];
        let nextToken;
        do {
          const body = { maxResults: 100 };
          if (adGroupId) {
            body.adGroupIdFilter = { include: [String(adGroupId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          try {
            const response = await this.axiosInstance.post(
              "/sb/v4/targets/list",
              body,
              {
                headers: {
                  "Content-Type": "application/vnd.sbtargetresource.v4+json",
                  "Accept": "application/vnd.sbtargetresource.v4+json"
                }
              }
            );
            const targets = response.data.targets || [];
            allTargets.push(...targets);
            nextToken = response.data.nextToken;
            log29.debug(`[SB API] Fetched ${targets.length} targets, total: ${allTargets.length}, hasMore: ${!!nextToken}`);
          } catch (error48) {
            const statusCode = error48.response?.status || error48.status;
            const errorMsg = error48.message || "";
            if (statusCode === 404 || errorMsg.includes("API\u7AEF\u70B9\u4E0D\u5B58\u5728")) {
              log29.warn(`[SB API] v472: SB targets/list\u8FD4\u56DE404\uFF0C\u8BE5\u8D26\u6237\u53EF\u80FD\u672A\u5F00\u901ASB\u5546\u54C1\u5B9A\u5411\u529F\u80FD\uFF0C\u8DF3\u8FC7`);
              return [];
            }
            if (statusCode === 403 || errorMsg.includes("\u6CA1\u6709\u8BBF\u95EE\u6743\u9650") || errorMsg.includes("PERMISSION_DENIED")) {
              log29.warn(`[SB API] v472: SB targets/list\u8FD4\u56DE403 PERMISSION_DENIED\uFF0CProfile\u7F3A\u5C11SB\u6743\u9650\uFF0C\u8DF3\u8FC7SB\u5546\u54C1\u5B9A\u5411\u540C\u6B65`);
              return [];
            }
            throw error48;
          }
        } while (nextToken);
        log29.debug(`[SB API] Total targets fetched: ${allTargets.length}`);
        return allTargets;
      }
      /**
       * 更新SB广告活动
       */
      async updateSbCampaign(campaignId, updates) {
        await this.axiosInstance.put(
          "/sb/v4/campaigns",
          // @ts-ignore
          { campaigns: [{ campaignId, ...updates }] },
          {
            headers: {
              "Content-Type": "application/vnd.sbcampaignresource.v4+json",
              "Accept": "application/vnd.sbcampaignresource.v4+json"
            }
          }
        );
      }
      /**
       * 更新SB关键词出价
       * 
       * v429: 回退到v3端点 PUT /sb/keywords，补充必填的adGroupId和campaignId字段
       * 
       * 历史问题追踪：
       * - v428: 使用v3端点但缺少adGroupId/campaignId必填字段 → 406 Not Acceptable
       * - v428.2: 切换到v4端点但缺少adGroupId/campaignId → 403 Forbidden
       * - v429: 回退v3端点并补充完整字段 → 仍然406（v3端点可能已弃用）
       * - v429.1: v4优先+v3降级双端点策略，但ID传的是string类型 → v4返回403, v3返回406
       * - v429.2: 根因修复 — v3 API要求keywordId/adGroupId/campaignId为integer<int64>类型
       * - v429.4: 测试多端点组合，发现:
       *   - v3 + vnd Content-Type → 415 (Content-Type错误，应该用application/json)
       *   - v3 + json Content-Type + json Accept → 406 (Accept错误，应该用vnd.sbkeywordresponse.v3+json)
       *   - v4 keywords端点不存在 → 403
       * - v429.5: 最终修复 — 根据Amazon官方OpenAPI文档确认:
       *   - Request Content-Type: application/json
       *   - Accept: application/vnd.sbkeywordresponse.v3+json (response的Content-Type)
       *   - Body: 数组格式 [{keywordId(int), adGroupId(int), campaignId(int), bid}]
       *   - v4没有keywords端点，只能用v3
       * 
       * 策略: 单一v3端点，正确的Content-Type和Accept headers
       */
      async updateSbKeywordBids(updates) {
        // v587: 防御性去重 - 确保同一批次中不包含重复的keywordId
        const _sbDedupMap = new Map();
        for (const u of updates) { _sbDedupMap.set(String(u.keywordId), u); }
        if (_sbDedupMap.size < updates.length) {
          log29.info(`[v587] SB API内部去重: ${updates.length} -> ${_sbDedupMap.size}`);
          updates = Array.from(_sbDedupMap.values());
        }
        const BATCH_SIZE = 100;
        const BATCH_DELAY_MS = 500;
        const totalBatches = Math.ceil(updates.length / BATCH_SIZE);
        log29.info(`[SB API] v429.5: updateSbKeywordBids \u5B98\u65B9\u6587\u6863\u4FEE\u590D: \u603B\u8BA1${updates.length}\u4E2A, \u5206${totalBatches}\u6279`);
        const allSuccesses = [];
        const allErrors = [];
        const toInt = /* @__PURE__ */ __name((v) => typeof v === "number" ? v : Number(v), "toInt");
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = updates.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          log29.info(`[SB API] v429.5: \u7B2C${batchIdx + 1}/${totalBatches}\u6279: ${batch.length}\u4E2ASB\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0`);
          try {
            const body = batch.map((u) => ({
              keywordId: toInt(u.keywordId),
              adGroupId: toInt(u.adGroupId),
              campaignId: toInt(u.campaignId),
              state: (u.state || "enabled").toLowerCase(),
              bid: Number(Number(u.bid).toFixed(2))
            }));
            log29.info(`[SB API] v586: PUT /sb/keywords, body sample: ${JSON.stringify(body[0])}`);
            const response = await this.axiosInstance.put("/sb/keywords", body, {
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/vnd.sbkeywordresponse.v3+json"
              }
            });
            const items = Array.isArray(response.data) ? response.data : [response.data];
            log29.info(`[SB API] v429.5: \u7B2C${batchIdx + 1}\u6279\u54CD\u5E94: HTTP ${response.status}, items: ${items.length}, sample: ${JSON.stringify(items[0]).substring(0, 200)}`);
            for (const item of items) {
              if (item.code === "SUCCESS" || item.code === 200 || !item.code) {
                allSuccesses.push(item);
              } else {
                const fullItemStr = JSON.stringify(item).substring(0, 300);
                const errorDetails = item.description || item.details || item.errorMessage || item.errorDescription || JSON.stringify(item.errors || "") || fullItemStr;
                allErrors.push({
                  keywordId: item.keywordId,
                  code: item.code || item.errorCode || "SB_ERROR",
                  details: errorDetails
                });
                log29.warn(`[SB API] v444: SB\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5931\u8D25: keywordId=${item.keywordId}, code=${item.code}, fullItem=${fullItemStr}`);
              }
            }
          } catch (err) {
            const statusCode = err?.response?.status || 0;
            const responseBody = err?.response?.data;
            const responseHeaders = err?.response?.headers;
            const errMsg = err.message;
            const bodyStr = responseBody ? JSON.stringify(responseBody).substring(0, 500) : "no body";
            const headerStr = responseHeaders ? JSON.stringify(responseHeaders).substring(0, 300) : "no headers";
            log29.warn(`[SB API] v429.5: \u7B2C${batchIdx + 1}\u6279SB\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5931\u8D25: HTTP ${statusCode}, msg: ${errMsg}, body: ${bodyStr}, resp-headers: ${headerStr}`);
            if (statusCode === 429) {
              const retryAfter = err?.response?.headers?.["retry-after"] || 5;
              log29.info(`[SB API] v429.5: \u9650\u6D41\uFF0C\u7B49\u5F85${retryAfter}\u79D2\u540E\u91CD\u8BD5...`);
              await new Promise((resolve) => setTimeout(resolve, Number(retryAfter) * 1e3));
              batchIdx--;
              continue;
            }
            for (const u of batch) {
              allErrors.push({ keywordId: u.keywordId, code: `HTTP_${statusCode}`, details: `${errMsg}: ${bodyStr.substring(0, 100)}` });
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.info(`[SB API] v429.5: SB\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u603B\u8BA1=${updates.length}, \u6210\u529F=${allSuccesses.length}, \u5931\u8D25=${allErrors.length}`);
        return { successes: allSuccesses, errors: allErrors };
      }
      /**
       * v471: 更新SB关键词状态（暂停/启用）
       * 使用与updateSbKeywordBids相同的v3端点: PUT /sb/keywords
       * 之前所有SB关键词状态变更都错误地走了SP端点，导致API调用失败
       */
      async updateSbKeywordStatus(updates) {
        const BATCH_SIZE = 100;
        const BATCH_DELAY_MS = 500;
        const totalBatches = Math.ceil(updates.length / BATCH_SIZE);
        log29.info(`[SB API] v471: updateSbKeywordStatus: \u603B\u8BA1${updates.length}\u4E2A, \u5206${totalBatches}\u6279`);
        const allSuccesses = [];
        const allErrors = [];
        const toInt = /* @__PURE__ */ __name((v) => typeof v === "number" ? v : Number(v), "toInt");
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = updates.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          try {
            const body = batch.map((u) => ({
              keywordId: toInt(u.keywordId),
              adGroupId: toInt(u.adGroupId),
              campaignId: toInt(u.campaignId),
              state: u.state
            }));
            const response = await this.axiosInstance.put("/sb/keywords", body, {
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/vnd.sbkeywordresponse.v3+json"
              }
            });
            const items = Array.isArray(response.data) ? response.data : [response.data];
            for (const item of items) {
              if (item.code === "SUCCESS" || item.code === 200 || !item.code) {
                allSuccesses.push(item);
              } else {
                allErrors.push({ keywordId: item.keywordId, code: item.code || "SB_ERROR", details: item.description || JSON.stringify(item).substring(0, 200) });
              }
            }
          } catch (err) {
            const statusCode = err.response?.status || 0;
            const bodyStr = err.response?.data ? JSON.stringify(err.response.data).substring(0, 300) : err.message;
            log29.warn(`[SB API] v471: SB\u5173\u952E\u8BCD\u72B6\u6001\u66F4\u65B0\u5931\u8D25: HTTP ${statusCode}, body: ${bodyStr}`);
            if (statusCode === 429) {
              const retryAfter = err.response?.headers?.["retry-after"] || 5;
              await new Promise((resolve) => setTimeout(resolve, Number(retryAfter) * 1e3));
              batchIdx--;
              continue;
            }
            for (const u of batch) {
              allErrors.push({ keywordId: u.keywordId, code: `HTTP_${statusCode}`, details: bodyStr });
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.info(`[SB API] v471: SB\u5173\u952E\u8BCD\u72B6\u6001\u66F4\u65B0\u5B8C\u6210: \u603B\u8BA1=${updates.length}, \u6210\u529F=${allSuccesses.length}, \u5931\u8D25=${allErrors.length}`);
        return { successes: allSuccesses, errors: allErrors };
      }
      // ==================== Sponsored Display API ====================
      /**
       * 获取SD广告活动列表
       * 注意：SD API使用GET方法，使用startIndex和count参数进行分页
       * 使用extended端点获取更多字段，包括startDate
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSdCampaigns() {
        const allCampaigns = [];
        let startIndex = 0;
        const count11 = 100;
        while (true) {
          let response;
          try {
            response = await this.axiosInstance.get("/sd/campaigns/extended", {
              params: { startIndex, count: count11 }
            });
            log29.debug("[SD API] Using extended endpoint for more fields");
          } catch (error48) {
            log29.warn("[SD API] Extended endpoint failed, falling back to standard endpoint");
            response = await this.axiosInstance.get("/sd/campaigns", {
              params: { startIndex, count: count11 }
            });
          }
          const campaigns6 = response.data || [];
          allCampaigns.push(...campaigns6);
          log29.debug(`[SD API] Fetched ${campaigns6.length} campaigns, total: ${allCampaigns.length}`);
          if (allCampaigns.length > 0 && startIndex === 0) {
            log29.debug("[SD API DEBUG] First campaign full structure:", JSON.stringify(allCampaigns[0], null, 2));
            log29.debug("[SD API DEBUG] First campaign startDate:", allCampaigns[0].startDate);
            log29.debug("[SD API DEBUG] First campaign keys:", Object.keys(allCampaigns[0]));
          }
          if (campaigns6.length < count11) {
            break;
          }
          startIndex += count11;
        }
        log29.debug(`[SD API] Total campaigns fetched: ${allCampaigns.length}`);
        return allCampaigns;
      }
      /**
       * 获取SD广告组列表
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSdAdGroups(campaignId) {
        const allAdGroups = [];
        let startIndex = 0;
        const count11 = 100;
        while (true) {
          const params = { startIndex, count: count11 };
          if (campaignId) {
            params.campaignIdFilter = campaignId;
          }
          const response = await this.axiosInstance.get("/sd/adGroups", { params });
          const adGroups6 = response.data || [];
          allAdGroups.push(...adGroups6);
          log29.debug(`[SD API] Fetched ${adGroups6.length} ad groups, total: ${allAdGroups.length}`);
          if (adGroups6.length < count11) {
            break;
          }
          startIndex += count11;
        }
        log29.debug(`[SD API] Total ad groups fetched: ${allAdGroups.length}`);
        return allAdGroups;
      }
      /**
       * 获取SD商品定位列表
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSdTargets(adGroupId) {
        const allTargets = [];
        let startIndex = 0;
        const count11 = 100;
        while (true) {
          const params = { startIndex, count: count11 };
          if (adGroupId) {
            params.adGroupIdFilter = adGroupId;
          }
          try {
            const response = await this.axiosInstance.get("/sd/targets", { params });
            const targets = response.data || [];
            allTargets.push(...targets);
            log29.debug(`[SD API] Fetched ${targets.length} targets, total: ${allTargets.length}`);
            if (targets.length < count11) {
              break;
            }
            startIndex += count11;
          } catch (error48) {
            const statusCode = error48.response?.status;
            const errorMsg = error48.message || "";
            if (statusCode === 403 || errorMsg.includes("403") || errorMsg.includes("PERMISSION_DENIED")) {
              log29.warn(`[SD API] v473: SD targets\u8FD4\u56DE403\uFF0CProfile\u7F3A\u5C11SD\u6743\u9650\uFF0C\u8DF3\u8FC7`);
              return [];
            }
            if (statusCode === 404 || errorMsg.includes("API\u7AEF\u70B9\u4E0D\u5B58\u5728")) {
              log29.warn(`[SD API] v473: SD targets\u8FD4\u56DE404\uFF0C\u8BE5\u8D26\u6237\u53EF\u80FD\u672A\u5F00\u901ASD\u5E7F\u544A\uFF0C\u8DF3\u8FC7`);
              return [];
            }
            throw error48;
          }
        }
        log29.debug(`[SD API] Total targets fetched: ${allTargets.length}`);
        return allTargets;
      }
      /**
       * 更新SD广告活动
       */
      async updateSdCampaign(campaignId, updates) {
        await this.axiosInstance.put("/sd/campaigns", [{ campaignId: String(campaignId), ...updates }]);
      }
      /**
       * 更新SD商品定位出价
       */
      async updateSdTargetBids(updates) {
        const BATCH_SIZE = 100;
        const BATCH_DELAY_MS = 300;
        const totalBatches = Math.ceil(updates.length / BATCH_SIZE);
        log29.info(`[SD API] v199: updateSdTargetBids \u5206\u6279\u5904\u7406: \u603B\u8BA1${updates.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = updates.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          log29.info(`[SD API] v199: \u7B2C${batchIdx + 1}/${totalBatches}\u6279: ${batch.length}\u4E2ASD\u5B9A\u4F4D\u51FA\u4EF7\u66F4\u65B0`);
          // v620-fix14g-P3: fix24-P3-2 增加SD出价更新的详细错误日志和try/catch
          log29.info(`[SD API] fix24-P3-2: SD targets PUT请求体样本: ${JSON.stringify(batch.slice(0, 2))}`);
          try {
          const response = await this.axiosInstance.put("/sd/targets", batch);
          // v620-fix14g-P3: 解析SD API响应，检查是否有部分失败
          const respData = response?.data;
          if (respData) {
            if (Array.isArray(respData)) {
              const errors = respData.filter(r => r.code && r.code !== 'SUCCESS');
              if (errors.length > 0) {
                log29.warn(`[SD API] fix24-P3-2: SD targets PUT部分失败: ${errors.length}/${batch.length}, 详情: ${JSON.stringify(errors.slice(0, 3))}`);
              } else {
                log29.info(`[SD API] fix24-P3-2: SD targets PUT全部成功: ${batch.length}个`);
              }
            } else if (typeof respData === 'object') {
              log29.info(`[SD API] fix24-P3-2: SD targets PUT响应: ${JSON.stringify(respData).substring(0, 500)}`);
            }
          }
          } catch (sdPutErr) {
            const errStatus = sdPutErr.response?.status;
            const errBody = sdPutErr.response?.data;
            const errDetail = errBody ? (typeof errBody === 'string' ? errBody : JSON.stringify(errBody)).substring(0, 1000) : sdPutErr.message;
            log29.warn(`[SD API] fix24-P3-2: SD targets PUT失败! status=${errStatus}, 详情: ${errDetail}`);
            log29.warn(`[SD API] fix24-P3-2: 失败的请求体: ${JSON.stringify(batch.slice(0, 3))}`);
            throw new Error(`SD API PUT /sd/targets 失败(${errStatus}): ${errDetail.substring(0, 500)}`);
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.info(`[SD API] v199: SD\u5B9A\u4F4D\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u603B\u8BA1${updates.length}\u4E2A`);
      }
      /**
       * v471: 更新SB商品定向出价
       * SB targets使用v4端点: PUT /sb/v4/targets
       * 与SP targets (PUT /sp/targets) 和 SD targets (PUT /sd/targets) 完全不同的端点
       * 之前所有SB/SD的product target竞价调整都错误地走了SP端点，导致API调用失败
       */
      async updateSbTargetBids(updates) {
        const BATCH_SIZE = 100;
        const BATCH_DELAY_MS = 500;
        const allErrors = [];
        let totalSuccess = 0;
        const totalBatches = Math.ceil(updates.length / BATCH_SIZE);
        log29.info(`[SB API] v471: updateSbTargetBids \u5206\u6279\u5904\u7406: \u603B\u8BA1${updates.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = updates.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          log29.info(`[SB API] v471: \u7B2C${batchIdx + 1}/${totalBatches}\u6279: ${batch.length}\u4E2ASB\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0`);
          try {
            const response = await this.axiosInstance.put(
              "/sb/v4/targets",
              { targets: batch.map((u) => ({ targetId: u.targetId, bid: u.bid, adGroupId: u.adGroupId, campaignId: u.campaignId })) },
              {
                headers: {
                  "Content-Type": "application/vnd.sbtargetresource.v4+json",
                  "Accept": "application/vnd.sbtargetresource.v4+json"
                }
              }
            );
            if (response.data?.targets?.error && Array.isArray(response.data.targets.error)) {
              for (const err of response.data.targets.error) {
                allErrors.push({ targetId: err.targetId || "unknown", code: err.code || "ERROR", details: err.description || err.details || JSON.stringify(err).substring(0, 200) });
              }
            }
            if (response.data?.targets?.success && Array.isArray(response.data.targets.success)) {
              totalSuccess += response.data.targets.success.length;
            } else if (!response.data?.targets?.error) {
              totalSuccess += batch.length;
            }
          } catch (batchErr) {
            const statusCode = batchErr.response?.status;
            const errorDetail = batchErr.response?.data ? JSON.stringify(batchErr.response.data).substring(0, 500) : batchErr.message;
            if (statusCode === 404 || statusCode === 403 || errorDetail && errorDetail.includes("API\u7AEF\u70B9\u4E0D\u5B58\u5728")) {
              log29.warn(`[SB API] v474: SB\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0\u7AEF\u70B9\u4E0D\u53EF\u7528: status=${statusCode}`);
            } else {
              log29.warn(`[SB API] v471: \u7B2C${batchIdx + 1}\u6279SB\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0\u5931\u8D25: status=${statusCode}, detail=${errorDetail}`);
            }
            for (const item of batch) {
              allErrors.push({ targetId: item.targetId, code: `HTTP_${statusCode}`, details: errorDetail });
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.warn(`[SB API] v471: SB\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u603B\u8BA1=${updates.length}, \u6210\u529F=${totalSuccess}, \u5931\u8D25=${allErrors.length}`);
        return { success: allErrors.length === 0, errors: allErrors };
      }
      /**
       * v310-fix: 更新SD广告组状态
       * SD广告组必须使用 /sd/adGroups 端点，不能使用 /sp/adGroups
       */
      async updateSdAdGroupStatus(updates) {
        const BATCH_SIZE = 100;
        const BATCH_DELAY_MS = 300;
        const allErrors = [];
        let totalSuccess = 0;
        const formattedAll = updates.map((u) => ({
          adGroupId: String(u.adGroupId),
          state: u.state.toLowerCase()
        }));
        const totalBatches = Math.ceil(formattedAll.length / BATCH_SIZE);
        log29.info(`[SD API] v328: updateSdAdGroupStatus \u5206\u6279\u5904\u7406: \u603B\u8BA1${formattedAll.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = formattedAll.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          try {
            const response = await this.axiosInstance.put("/sd/adGroups", batch, {
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              }
              // @ts-ignore
            });
            log29.info(`[SD API] v328: \u7B2C${batchIdx + 1}\u6279\u54CD\u5E94: status=${response.status}, data=${JSON.stringify(response.data).substring(0, 500)}`);
            if (Array.isArray(response.data)) {
              const errors = response.data.filter((r) => r.code && r.code !== "SUCCESS");
              const successes = response.data.filter((r) => !r.code || r.code === "SUCCESS");
              totalSuccess += successes.length;
              for (const err of errors) {
                allErrors.push({ adGroupId: err.adGroupId, code: err.code || "ERROR", details: err.details || err.description || JSON.stringify(err) });
              }
            } else if (response.data && typeof response.data === "object") {
              if (response.data.errors) {
                for (const err of Array.isArray(response.data.errors) ? response.data.errors : [response.data.errors]) {
                  allErrors.push({ adGroupId: err.adGroupId, code: err.code || "ERROR", details: err.details || err.description || JSON.stringify(err) });
                }
              } else {
                totalSuccess += batch.length;
              }
            } else {
              totalSuccess += batch.length;
            }
          } catch (batchErr) {
            const errorDetail = batchErr.response?.data ? JSON.stringify(batchErr.response.data).substring(0, 500) : batchErr.message;
            const errorStatus = batchErr.response?.status || "N/A";
            log29.warn(`[SD API] v328: \u7B2C${batchIdx + 1}\u6279SD\u5E7F\u544A\u7EC4\u72B6\u6001\u66F4\u65B0\u5931\u8D25: status=${errorStatus}, detail=${errorDetail}`);
            for (const item of batch) {
              allErrors.push({ adGroupId: item.adGroupId, code: `HTTP_${errorStatus}`, details: errorDetail });
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.warn(`[SD API] v328: SD\u5E7F\u544A\u7EC4\u72B6\u6001\u66F4\u65B0\u5B8C\u6210: \u603B\u8BA1=${updates.length}, \u6210\u529F=${totalSuccess}, \u5931\u8D25=${allErrors.length}`);
        return { success: allErrors.length === 0, successCount: totalSuccess, errors: allErrors };
      }
      // ==================== 否定关键词 API ====================
      /**
       * 获取SP活动级别否定关键词列表
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSpCampaignNegativeKeywords(campaignId) {
        const allNegatives = [];
        let nextToken;
        do {
          const body = { maxResults: 100 };
          if (campaignId) {
            body.campaignIdFilter = { include: [String(campaignId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          const response = await this.axiosInstance.post("/sp/campaignNegativeKeywords/list", body, {
            headers: {
              "Content-Type": "application/vnd.spCampaignNegativeKeyword.v3+json",
              "Accept": "application/vnd.spCampaignNegativeKeyword.v3+json"
            }
          });
          const negatives = response.data.campaignNegativeKeywords || [];
          allNegatives.push(...negatives);
          nextToken = response.data.nextToken;
          log29.debug(`[SP API] Fetched ${negatives.length} campaign negative keywords, total: ${allNegatives.length}, hasMore: ${!!nextToken}`);
        } while (nextToken);
        log29.debug(`[SP API] Total campaign negative keywords fetched: ${allNegatives.length}`);
        return allNegatives;
      }
      /**
       * 创建SP活动级别否定关键词
       */
      async createSpCampaignNegativeKeywords(negatives) {
        const formatMatchType = /* @__PURE__ */ __name((mt) => {
          const upper = mt.toUpperCase();
          if (upper.includes("_")) return upper;
          if (upper === "NEGATIVEPHRASE") return "NEGATIVE_PHRASE";
          if (upper === "NEGATIVEEXACT") return "NEGATIVE_EXACT";
          return upper;
        }, "formatMatchType");
        const formattedNegatives = negatives.map((n) => ({
          campaignId: String(n.campaignId),
          keywordText: n.keywordText,
          matchType: formatMatchType(n.matchType || "NEGATIVE_EXACT"),
          state: "ENABLED"
        }));
        const BATCH_SIZE = 1e3;
        const BATCH_DELAY_MS = 300;
        const allResults = [];
        const totalBatches = Math.ceil(formattedNegatives.length / BATCH_SIZE);
        log29.info(`[SP API] v199: createSpCampaignNegativeKeywords \u5206\u6279\u5904\u7406: \u603B\u8BA1${formattedNegatives.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = formattedNegatives.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          log29.debug(`[SP API] v199: \u7B2C${batchIdx + 1}/${totalBatches}\u6279: ${batch.length}\u4E2Acampaign\u7EA7\u5426\u5B9A\u8BCD`);
          try {
            const response = await this.axiosInstance.post("/sp/campaignNegativeKeywords", {
              campaignNegativeKeywords: batch
            }, {
              headers: {
                "Content-Type": "application/vnd.spCampaignNegativeKeyword.v3+json",
                "Accept": "application/vnd.spCampaignNegativeKeyword.v3+json"
              }
            });
            const responseData = response.data.campaignNegativeKeywords || {};
            const successItems = responseData.success || [];
            const errorItems = responseData.error || [];
            for (const s of successItems) {
              allResults.push({
                keywordId: s.campaignNegativeKeywordId || s.keywordId,
                code: "SUCCESS",
                details: "",
                index: s.index !== void 0 ? s.index + batchIdx * BATCH_SIZE : void 0
              });
            }
            for (const e of errorItems) {
              const errorMsg = e.errors?.map((err) => {
                const val = err.errorValue || {};
                const errorType = err.errorType || "unknownError";
                const typedError = val[errorType] || val.malformedValueError || val.duplicateValueError || val.otherError || val.entityNotFoundError || val;
                const message2 = typedError?.message || typedError?.cause?.message || "";
                const trigger = typedError?.cause?.trigger || "";
                const fullDetail = message2 ? `${errorType}: ${message2}${trigger ? ` (trigger: ${trigger})` : ""}` : `${errorType}: ${JSON.stringify(val).substring(0, 200)}`;
                return fullDetail;
              }).join("; ") || "Unknown error";
              const isDuplicateError = errorMsg.includes("duplicateValueError") || errorMsg.includes("DUPLICATE_VALUE");
              const isParentProgramTypeError = errorMsg.includes("parent program type") || errorMsg.includes("PARENT_PROGRAM_TYPE");
              if (isDuplicateError) {
                log29.info(`[SP API] v449: \u5426\u5B9A\u8BCD\u5DF2\u5B58\u5728(duplicate)\uFF0C\u89C6\u4E3A\u6210\u529F: index=${e.index}`);
                allResults.push({
                  keywordId: e.campaignNegativeKeywordId || 0,
                  code: "SUCCESS_DUPLICATE",
                  details: "Already exists on Amazon (duplicate)",
                  index: e.index !== void 0 ? e.index + batchIdx * BATCH_SIZE : void 0
                });
              } else if (isParentProgramTypeError) {
                log29.warn(`[SP API] v585: \u5426\u5B9A\u8BCD\u8DF3\u8FC7(\u975ESP\u7C7B\u578Bcampaign): index=${e.index}, campaignId=${batch[e.index]?.campaignId || "unknown"}`);
                allResults.push({
                  keywordId: 0,
                  code: "SKIPPED_NON_SP",
                  details: "Campaign is not SP type, skipped",
                  index: e.index !== void 0 ? e.index + batchIdx * BATCH_SIZE : void 0
                });
              } else {
                allResults.push({
                  keywordId: 0,
                  code: "ERROR",
                  details: errorMsg,
                  index: e.index !== void 0 ? e.index + batchIdx * BATCH_SIZE : void 0
                });
              }
            }
            if (errorItems.length > 0) {
              log29.warn(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u5426\u5B9A\u8BCD\u5931\u8D25\u8BE6\u60C5:`);
              for (const e of errorItems) {
                const errDetail = JSON.stringify(e.errors || e).substring(0, 300);
                const kwText = batch[e.index]?.keywordText || "unknown";
                const campId = batch[e.index]?.campaignId || "unknown";
                log29.warn(`  - \u7D22\u5F15${e.index}: campaignId=${campId}, keyword="${kwText}", \u9519\u8BEF: ${errDetail}`);
              }
            }
            log29.warn(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u5B8C\u6210: \u6210\u529F=${successItems.length}, \u5931\u8D25=${errorItems.length}`);
          } catch (err) {
            const errData = err.response?.data;
            log29.warn(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u5931\u8D25: status=${err.response?.status}, data=`, JSON.stringify(errData).substring(0, 500));
            for (let i = 0; i < batch.length; i++) {
              allResults.push({
                keywordId: 0,
                code: "BATCH_ERROR",
                details: err.message,
                index: i + batchIdx * BATCH_SIZE
              });
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        const successCount = allResults.filter((r) => r.code === "SUCCESS").length;
        const failCount = allResults.length - successCount;
        log29.warn(`[SP API] v199: campaign\u5426\u5B9A\u8BCD\u521B\u5EFA\u5B8C\u6210: \u603B\u8BA1=${negatives.length}, \u6210\u529F=${successCount}, \u5931\u8D25=${failCount}`);
        return allResults;
      }
      /**
       * 删除SP活动级别否定关键词
       */
      async deleteSpCampaignNegativeKeywords(keywordIds) {
        const BATCH_SIZE = 1e3;
        const totalBatches = Math.ceil(keywordIds.length / BATCH_SIZE);
        log29.info(`[SP API] v199: deleteSpCampaignNegativeKeywords \u5206\u6279\u5904\u7406: \u603B\u8BA1${keywordIds.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = keywordIds.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          await this.axiosInstance.post("/sp/campaignNegativeKeywords/delete", {
            keywordIdFilter: { include: batch }
          }, {
            headers: { "Content-Type": "application/vnd.spCampaignNegativeKeyword.v3+json" }
          });
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }
      }
      /**
       * 获取SP广告组级别否定关键词列表
       * 已修复：添加分页逻辑，确保获取所有数据
       */
      async listSpNegativeKeywords(adGroupId) {
        const allNegatives = [];
        let nextToken;
        do {
          const body = { maxResults: 100 };
          if (adGroupId) {
            body.adGroupIdFilter = { include: [String(adGroupId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          const response = await this.axiosInstance.post("/sp/negativeKeywords/list", body, {
            headers: {
              // @ts-ignore
              "Content-Type": "application/vnd.spNegativeKeyword.v3+json",
              "Accept": "application/vnd.spNegativeKeyword.v3+json"
            }
          });
          const negatives = response.data.negativeKeywords || [];
          allNegatives.push(...negatives);
          nextToken = response.data.nextToken;
          log29.debug(`[SP API] Fetched ${negatives.length} negative keywords, total: ${allNegatives.length}, hasMore: ${!!nextToken}`);
        } while (nextToken);
        log29.debug(`[SP API] Total negative keywords fetched: ${allNegatives.length}`);
        return allNegatives;
      }
      /**
       * 创建SP广告组级别否定关键词
       */
      async createSpNegativeKeywords(negatives) {
        const formatNegMatchType = /* @__PURE__ */ __name((mt) => {
          const upper = mt.toUpperCase();
          if (upper.includes("_")) return upper;
          if (upper === "NEGATIVEPHRASE") return "NEGATIVE_PHRASE";
          if (upper === "NEGATIVEEXACT") return "NEGATIVE_EXACT";
          return upper;
        }, "formatNegMatchType");
        const formattedNegatives = negatives.map((n) => ({
          adGroupId: String(n.adGroupId),
          campaignId: String(n.campaignId),
          keywordText: n.keywordText,
          matchType: formatNegMatchType(n.matchType || "NEGATIVE_EXACT"),
          state: (n.state || "enabled").toUpperCase()
        }));
        const BATCH_SIZE = 1e3;
        const BATCH_DELAY_MS = 300;
        const allResults = [];
        const totalBatches = Math.ceil(formattedNegatives.length / BATCH_SIZE);
        log29.info(`[SP API] v199: createSpNegativeKeywords \u5206\u6279\u5904\u7406: \u603B\u8BA1${formattedNegatives.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = formattedNegatives.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          log29.debug(`[SP API] v199: \u7B2C${batchIdx + 1}/${totalBatches}\u6279: ${batch.length}\u4E2A\u5E7F\u544A\u7EC4\u7EA7\u5426\u5B9A\u8BCD`);
          try {
            const response = await this.axiosInstance.post("/sp/negativeKeywords", {
              negativeKeywords: batch
              // @ts-ignore
            }, {
              headers: {
                "Content-Type": "application/vnd.spNegativeKeyword.v3+json",
                "Accept": "application/vnd.spNegativeKeyword.v3+json"
              }
            });
            const batchResults = response.data.negativeKeywords || [];
            allResults.push(...batchResults);
            log29.info(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u5B8C\u6210: ${batchResults.length}\u4E2A\u7ED3\u679C`);
          } catch (err) {
            log29.warn(`[SP API] v199: \u7B2C${batchIdx + 1}\u6279\u5931\u8D25: ${err.response?.status} ${err.message}`);
            for (let i = 0; i < batch.length; i++) {
              allResults.push({ keywordId: 0, code: "BATCH_ERROR", details: err.message });
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }
        log29.info(`[SP API] v199: \u5E7F\u544A\u7EC4\u5426\u5B9A\u8BCD\u521B\u5EFA\u5B8C\u6210: \u603B\u8BA1=${negatives.length}, \u7ED3\u679C=${allResults.length}`);
        return allResults;
      }
      /**
       * 删除SP广告组级别否定关键词
       */
      async deleteSpNegativeKeywords(keywordIds) {
        const BATCH_SIZE = 1e3;
        const totalBatches = Math.ceil(keywordIds.length / BATCH_SIZE);
        log29.info(`[SP API] v199: deleteSpNegativeKeywords \u5206\u6279\u5904\u7406: \u603B\u8BA1${keywordIds.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = keywordIds.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          await this.axiosInstance.post("/sp/negativeKeywords/delete", {
            keywordIdFilter: { include: batch }
          }, {
            headers: { "Content-Type": "application/vnd.spNegativeKeyword.v3+json" }
          });
          if (batchIdx < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }
      }
      /**
       * 获取SP否定商品定位列表（活动级别）
       */
      async listSpCampaignNegativeTargets(campaignId) {
        const allTargets = [];
        let nextToken;
        do {
          const body = { maxResults: 100 };
          if (campaignId) {
            body.campaignIdFilter = { include: [String(campaignId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          const response = await this.axiosInstance.post("/sp/campaignNegativeTargets/list", body, {
            headers: {
              "Content-Type": "application/vnd.spCampaignNegativeTargetingClause.v3+json",
              "Accept": "application/vnd.spCampaignNegativeTargetingClause.v3+json"
            }
          });
          const targets = response.data.campaignNegativeTargetingClauses || [];
          allTargets.push(...targets);
          nextToken = response.data.nextToken;
          log29.debug(`[SP API] Fetched ${targets.length} campaign negative targets, total: ${allTargets.length}, hasMore: ${!!nextToken}`);
        } while (nextToken);
        log29.debug(`[SP API] Total campaign negative targets fetched: ${allTargets.length}`);
        return allTargets;
      }
      /**
       * 创建SP否定商品定位（活动级别）
       */
      async createSpCampaignNegativeTargets(negatives) {
        // v581: 修复400错误 - Campaign否定定向API要求大写枚举值(ENABLED, ASIN_SAME_AS)
        const cleanedNegatives = negatives.map((n) => {
          const clause = {
            campaignId: String(n.campaignId),
            expression: (n.expression || []).map(e => ({ ...e, type: e.type === "asinSameAs" ? "ASIN_SAME_AS" : e.type === "asinBrandSameAs" ? "ASIN_BRAND_SAME_AS" : e.type })),
            state: "ENABLED"
          };
          if (n.expressionType) clause.expressionType = n.expressionType;
          return clause;
        });
        log29.info(`[v580] SP否定产品批量创建: ${cleanedNegatives.length}个, 样本: ${JSON.stringify(cleanedNegatives[0] || {}).slice(0, 300)}`);
        const response = await this.axiosInstance.post("/sp/campaignNegativeTargets", {
          campaignNegativeTargetingClauses: cleanedNegatives
        }, {
          headers: {
            "Content-Type": "application/vnd.spCampaignNegativeTargetingClause.v3+json",
            "Accept": "application/vnd.spCampaignNegativeTargetingClause.v3+json"
          }
        });
        const rawResult = response.data.campaignNegativeTargetingClauses;
        // v582: 修复返回值解析 - SP v3 POST API返回 { success: [], error: [] } 而非数组
        if (Array.isArray(rawResult)) return rawResult;
        if (rawResult && typeof rawResult === 'object') {
          const successItems = rawResult.success || [];
          const errorItems = rawResult.error || [];
          log29.info(`[v582] SP Campaign否定产品API返回: success=${successItems.length}, error=${errorItems.length}`);
          return [...successItems.map(s => ({ ...s, code: 'SUCCESS' })), ...errorItems.map(e => ({ ...e, code: 'ERROR', details: JSON.stringify(e.errors || e).slice(0, 200) }))];
        }
        return [];
      }
      /**
       * 获取SP否定商品定位列表（广告组级别）
       */
      async listSpNegativeTargets(adGroupId) {
        const allTargets = [];
        let nextToken;
        do {
          const body = { maxResults: 100 };
          if (adGroupId) {
            body.adGroupIdFilter = { include: [String(adGroupId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          const response = await this.axiosInstance.post("/sp/negativeTargets/list", body, {
            headers: {
              "Content-Type": "application/vnd.spNegativeTargetingClause.v3+json",
              "Accept": "application/vnd.spNegativeTargetingClause.v3+json"
            }
          });
          const targets = response.data.negativeTargetingClauses || [];
          allTargets.push(...targets);
          nextToken = response.data.nextToken;
          log29.debug(`[SP API] Fetched ${targets.length} negative targets, total: ${allTargets.length}, hasMore: ${!!nextToken}`);
        } while (nextToken);
        log29.debug(`[SP API] Total negative targets fetched: ${allTargets.length}`);
        return allTargets;
      }
      /**
       * 创建SP否定商品定位（广告组级别）
       */
      async createSpNegativeTargets(negatives) {
        const response = await this.axiosInstance.post("/sp/negativeTargets", {
          negativeTargetingClauses: negatives.map((n) => ({
            ...n,
            adGroupId: String(n.adGroupId),
            campaignId: String(n.campaignId),
            state: (n.state || "enabled").toUpperCase()
          }))
        }, {
          headers: {
            "Content-Type": "application/vnd.spNegativeTargetingClause.v3+json",
            "Accept": "application/vnd.spNegativeTargetingClause.v3+json"
          }
        });
        return response.data.negativeTargetingClauses || [];
      }
      // ==================== 出价建议 API ====================
      /**
       * v436: 获取SP关键词出价建议 — 升级到Theme-Based Bid Recommendations API
       * 新端点: POST /sp/targets/bid/recommendations
       * 旧端点 /sp/keywords/bidRecommendations 已弃用
       * 
       * 返回格式: { suggestedBid, bidRangeLow, bidRangeHigh } 三个竞价值
       */
      async getKeywordBidRecommendations(adGroupId, keywords10, campaignId) {
        try {
          const results = [];
          const matchTypeMapping = {
            "BROAD": "KEYWORD_BROAD_MATCH",
            "PHRASE": "KEYWORD_PHRASE_MATCH",
            "EXACT": "KEYWORD_EXACT_MATCH"
            // @ts-ignore
          };
          const targetingExpressions = keywords10.map((kw) => ({
            type: matchTypeMapping[kw.matchType.toUpperCase()] || "KEYWORD_BROAD_MATCH",
            value: kw.keyword
          }));
          const requestBody = {
            targetingExpressions,
            recommendationType: "BIDS_FOR_EXISTING_AD_GROUP",
            adGroupId: String(adGroupId)
          };
          if (campaignId) {
            requestBody.campaignId = String(campaignId);
          }
          const response = await this.axiosInstance.post("/sp/targets/bid/recommendations", requestBody, {
            headers: {
              "Content-Type": "application/vnd.spthemebasedbidrecommendation.v4+json",
              "Accept": "application/vnd.spthemebasedbidrecommendation.v4+json"
            }
          });
          const themeRecs = response.data?.bidRecommendations || [];
          if (themeRecs.length === 0) {
            log29.warn(`[SP] Theme-Based API\u8FD4\u56DE\u7A7A\u7ED3\u679C, response.data keys: ${Object.keys(response.data || {}).join(", ")}`);
            log29.debug(`[SP] \u5B8C\u6574\u54CD\u5E94: ${JSON.stringify(response.data).substring(0, 500)}`);
          }
          for (const themeBlock of themeRecs) {
            const targetExprRecs = themeBlock.bidRecommendationsForTargetingExpressions || [];
            for (const exprRec of targetExprRecs) {
              const targetExpr = exprRec.targetingExpression || {};
              const bidValuesArr = exprRec.bidValues || [];
              let rangeLow = 0;
              let suggestedBid = 0;
              let rangeHigh = 0;
              if (bidValuesArr.length >= 3) {
                rangeLow = Number(bidValuesArr[0]?.suggestedBid) || 0;
                suggestedBid = Number(bidValuesArr[1]?.suggestedBid) || 0;
                rangeHigh = Number(bidValuesArr[2]?.suggestedBid) || 0;
              } else if (bidValuesArr.length === 1) {
                suggestedBid = Number(bidValuesArr[0]?.suggestedBid) || 0;
              }
              if (suggestedBid > 0) {
                const typeToMatchType = {
                  "KEYWORD_BROAD_MATCH": "BROAD",
                  "KEYWORD_PHRASE_MATCH": "PHRASE",
                  "KEYWORD_EXACT_MATCH": "EXACT",
                  "CLOSE_MATCH": "CLOSE_MATCH",
                  "LOOSE_MATCH": "LOOSE_MATCH",
                  "SUBSTITUTES": "SUBSTITUTES",
                  "COMPLEMENTS": "COMPLEMENTS"
                };
                results.push({
                  keyword: targetExpr.value || "",
                  matchType: typeToMatchType[targetExpr.type] || targetExpr.type || "",
                  suggestedBid,
                  rangeStart: rangeLow,
                  rangeEnd: rangeHigh
                });
              }
            }
          }
          log29.info(`[SP] Theme-Based API\u6210\u529F\u89E3\u6790 ${results.length} \u4E2A\u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7`);
          return results;
        } catch (error48) {
          const errMsg = error48.message;
          const statusCode = error48?.response?.status;
          if (statusCode === 422) {
            log29.warn(`[SP] v456: Theme-Based bid recommendations API\u8FD4\u56DE422 (adGroupId=${adGroupId})\uFF0C\u53EF\u80FD\u662F\u8BF7\u6C42\u53C2\u6570\u683C\u5F0F\u95EE\u9898\uFF0C\u8DF3\u8FC7\u5EFA\u8BAE\u51FA\u4EF7\u83B7\u53D6`);
          } else if (statusCode === 403) {
            log29.warn(`[SP] v456: Theme-Based bid recommendations API\u8FD4\u56DE403 (adGroupId=${adGroupId})\uFF0CProfile\u53EF\u80FD\u7F3A\u5C11\u6743\u9650`);
          } else {
            log29.warn(`[SP] v456: Theme-Based bid recommendations API\u5931\u8D25: ${errMsg}`);
          }
          return [];
        }
      }
      /**
       * v436: 获取SP商品定位出价建议 — 升级到Theme-Based API
       * 新端点: POST /sp/targets/bid/recommendations
       */
      async getTargetBidRecommendations(adGroupId, expressions, campaignId) {
        try {
          const targetTypeMapping = {
            "asinsameAs": "PAT_ASIN",
            "asinSameAs": "PAT_ASIN",
            "asinCategorySameAs": "PAT_CATEGORY",
            "asincategorysameAs": "PAT_CATEGORY",
            // @ts-ignore
            "ASIN_SAME_AS": "PAT_ASIN",
            // @ts-ignore
            "ASIN_CATEGORY_SAME_AS": "PAT_CATEGORY"
            // @ts-ignore
          };
          const targetingExpressions = expressions.map((expr) => ({
            // @ts-ignore
            type: targetTypeMapping[expr.type] || "PAT_ASIN",
            value: expr.value || ""
          }));
          const requestBody = {
            targetingExpressions,
            recommendationType: "BIDS_FOR_EXISTING_AD_GROUP",
            adGroupId: String(adGroupId)
          };
          if (campaignId) {
            requestBody.campaignId = String(campaignId);
          }
          const response = await this.axiosInstance.post("/sp/targets/bid/recommendations", requestBody, {
            headers: {
              "Content-Type": "application/vnd.spthemebasedbidrecommendation.v4+json",
              "Accept": "application/vnd.spthemebasedbidrecommendation.v4+json"
            }
          });
          const themeRecs = response.data?.bidRecommendations || [];
          const results = [];
          for (const themeBlock of themeRecs) {
            const targetExprRecs = themeBlock.bidRecommendationsForTargetingExpressions || [];
            for (const exprRec of targetExprRecs) {
              const bidValuesArr = exprRec.bidValues || [];
              let rangeLow = 0, suggestedBid = 0, rangeHigh = 0;
              if (bidValuesArr.length >= 3) {
                rangeLow = Number(bidValuesArr[0]?.suggestedBid) || 0;
                suggestedBid = Number(bidValuesArr[1]?.suggestedBid) || 0;
                rangeHigh = Number(bidValuesArr[2]?.suggestedBid) || 0;
              } else if (bidValuesArr.length === 1) {
                suggestedBid = Number(bidValuesArr[0]?.suggestedBid) || 0;
              }
              if (suggestedBid > 0) {
                results.push({
                  expression: exprRec.targetingExpression || {},
                  suggestedBid,
                  rangeLow,
                  rangeHigh
                });
              }
            }
          }
          log29.info(`[SP] Theme-Based target API\u6210\u529F\u89E3\u6790 ${results.length} \u4E2A\u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7`);
          return results;
        } catch (error48) {
          const errMsg = error48.message;
          const statusCode = error48?.response?.status;
          if (statusCode === 422) {
            log29.warn(`[SP] v456: Theme-Based target bid recommendations\u8FD4\u56DE422 (adGroupId=${adGroupId})\uFF0C\u8DF3\u8FC7\u5EFA\u8BAE\u51FA\u4EF7\u83B7\u53D6`);
          } else if (statusCode === 403) {
            log29.warn(`[SP] v456: Theme-Based target bid recommendations\u8FD4\u56DE403 (adGroupId=${adGroupId})\uFF0CProfile\u53EF\u80FD\u7F3A\u5C11\u6743\u9650`);
          } else {
            log29.warn(`[SP] v456: Theme-Based target bid recommendations\u5931\u8D25: ${errMsg}`);
          }
          return [];
        }
      }
      /**
       * v436: 获取SB关键词出价建议
       * 端点: POST /sb/recommendations/bids
       * 支持关键词和商品定位两种类型
       * 返回格式增强: 包含 rangeStart/rangeEnd
       */
      async getSbBidRecommendations(campaignId, keywords10) {
        try {
          const response = await this.axiosInstance.post("/sb/recommendations/bids", {
            campaignId: String(campaignId),
            keywords: keywords10
          });
          const rawRecs = response.data?.recommendations || response.data || [];
          if (rawRecs.length === 0) {
            log29.warn(`[SB] v520: \u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7API\u8FD4\u56DE\u7A7A\u7ED3\u679C (campaignId=${campaignId}, keywords=${keywords10.length}), response.data keys: ${Object.keys(response.data || {}).join(", ")}, status: ${response.status}`);
          } else {
            log29.info(`[SB] \u83B7\u53D6\u5230 ${rawRecs.length} \u4E2A\u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7 (campaignId=${campaignId})`);
          }
          return rawRecs.map((rec) => ({
            // @ts-ignore
            keyword: rec.keyword || "",
            // @ts-ignore
            matchType: rec.matchType || "",
            // @ts-ignore
            suggestedBid: Number(rec.suggestedBid || rec.bid) || 0,
            // @ts-ignore
            rangeStart: Number(rec.rangeStart || rec.bidRangeLow || rec.rangeLow) || 0,
            // @ts-ignore
            rangeEnd: Number(rec.rangeEnd || rec.bidRangeHigh || rec.rangeHigh) || 0
          }));
        } catch (error48) {
          const statusCode = error48?.response?.status;
          const responseData = JSON.stringify(error48?.response?.data || {}).substring(0, 300);
          log29.warn(`[SB] v520: \u83B7\u53D6\u5173\u952E\u8BCD\u5EFA\u8BAE\u7ADE\u4EF7\u5931\u8D25 (campaignId=${campaignId}, status=${statusCode}): ${error48.message}, response: ${responseData}`);
          return [];
        }
      }
      /**
       * v436: 获取SB商品定位出价建议
       * 端点: POST /sb/recommendations/bids (targets模式)
       */
      async getSbTargetBidRecommendations(campaignId, targets) {
        try {
          const response = await this.axiosInstance.post("/sb/recommendations/bids", {
            campaignId: String(campaignId),
            targets
          });
          const rawRecs = response.data?.recommendations || response.data || [];
          if (rawRecs.length === 0) {
            log29.warn(`[SB] v520: \u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7API\u8FD4\u56DE\u7A7A\u7ED3\u679C (campaignId=${campaignId}, targets=${targets.length}), response.data keys: ${Object.keys(response.data || {}).join(", ")}, status: ${response.status}`);
          } else {
            log29.info(`[SB] \u83B7\u53D6\u5230 ${rawRecs.length} \u4E2A\u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7 (campaignId=${campaignId})`);
          }
          return rawRecs.map((rec) => ({
            // @ts-ignore
            suggestedBid: Number(rec.suggestedBid || rec.bid) || 0,
            // @ts-ignore
            rangeStart: Number(rec.rangeStart || rec.bidRangeLow || rec.rangeLow) || 0,
            // @ts-ignore
            rangeEnd: Number(rec.rangeEnd || rec.bidRangeHigh || rec.rangeHigh) || 0
          }));
        } catch (error48) {
          const statusCode = error48?.response?.status;
          log29.warn(`[SB] v520: \u83B7\u53D6\u5546\u54C1\u5B9A\u4F4D\u5EFA\u8BAE\u7ADE\u4EF7\u5931\u8D25 (campaignId=${campaignId}, status=${statusCode}): ${error48.message}`);
          return [];
        }
      }
      /**
       * v436: 获取SD投放对象出价建议
       * 端点: POST /sd/targets/bid/recommendations
       * 支持最多100个targeting clauses
       */
      async getSdTargetBidRecommendations(targetingClauses) {
        try {
          const response = await this.axiosInstance.post("/sd/targets/bid/recommendations", {
            targetingClauses
          });
          const rawRecs = response.data?.recommendations || response.data || [];
          log29.debug(`[SD] \u83B7\u53D6\u5230 ${rawRecs.length} \u4E2A\u6295\u653E\u5BF9\u8C61\u5EFA\u8BAE\u7ADE\u4EF7`);
          return rawRecs.map((rec) => ({
            // @ts-ignore
            targetId: rec.targetId || "",
            // @ts-ignore
            suggestedBid: Number(rec.suggestedBid || rec.bid) || 0,
            // @ts-ignore
            bidRangeLow: Number(rec.bidRangeLow || rec.rangeStart || rec.rangeLow) || 0,
            // @ts-ignore
            bidRangeHigh: Number(rec.bidRangeHigh || rec.rangeEnd || rec.rangeHigh) || 0
          }));
        } catch (error48) {
          log29.warn(`[SD] \u83B7\u53D6\u6295\u653E\u5BF9\u8C61\u5EFA\u8BAE\u7ADE\u4EF7\u5931\u8D25: ${error48.message}`);
          return [];
        }
      }
      // ==================== Amazon Marketing Stream (AMS) Methods ====================
      /**
       * 创建AMS订阅
       * 参考: https://advertising.amazon.com/API/docs/en-us/amazon-marketing-stream/stream-api
       * 
       * 注意: 
       * 1. AMS API端点与普通广告API端点不同
       * 2. 必须使用嵌套结构: destination: { type, arn }, dataSet: { id }
       * 3. clientRequestToken必须是UUID-v4格式，不超过36字符
       */
      async createAmsSubscription(dataSetId, destinationArn, name2) {
        const clientRequestToken = generateUuidV4();
        log29.info(`[AMS] \u521B\u5EFA\u8BA2\u9605: dataSetId=${dataSetId}, destinationArn=${destinationArn}`);
        log29.debug(`[AMS] clientRequestToken: ${clientRequestToken} (\u957F\u5EA6: ${clientRequestToken.length})`);
        const requestBody = {
          clientRequestToken,
          name: name2 || `${dataSetId}-subscription`,
          destination: {
            type: "SQS",
            arn: destinationArn
          },
          dataSet: {
            id: dataSetId
            // 注意: key是 "dataSet" (驼峰), 内部是 "id"
          }
        };
        log29.debug(`[AMS] \u8BF7\u6C42\u4F53:`, JSON.stringify(requestBody, null, 2));
        const response = await this.axiosInstance.post("/streams/subscriptions", requestBody);
        log29.info(`[AMS] \u8BA2\u9605\u521B\u5EFA\u6210\u529F:`, response.data);
        return response.data;
      }
      /**
       * 获取所有AMS订阅列表
       */
      async listAmsSubscriptions() {
        log29.debug("[AMS] \u83B7\u53D6\u8BA2\u9605\u5217\u8868...");
        const response = await this.axiosInstance.get("/streams/subscriptions");
        const subscriptions = response.data.subscriptions || response.data || [];
        log29.debug(`[AMS] \u83B7\u53D6\u5230 ${subscriptions.length} \u4E2A\u8BA2\u9605`);
        return subscriptions;
      }
      /**
       * 获取单个AMS订阅详情
       */
      async getAmsSubscription(subscriptionId) {
        try {
          const response = await this.axiosInstance.get(`/streams/subscriptions/${subscriptionId}`);
          return response.data;
        } catch (error48) {
          if (error48.response?.status === 404) {
            return null;
          }
          throw error48;
        }
      }
      /**
       * 更新AMS订阅状态
       */
      async updateAmsSubscription(subscriptionId, updates) {
        log29.info(`[AMS] \u66F4\u65B0\u8BA2\u9605 ${subscriptionId}:`, updates);
        const response = await this.axiosInstance.put(
          `/streams/subscriptions/${subscriptionId}`,
          updates
        );
        return response.data;
      }
      /**
       * 删除/归档AMS订阅
       */
      async archiveAmsSubscription(subscriptionId) {
        log29.debug(`[AMS] \u5F52\u6863\u8BA2\u9605 ${subscriptionId}`);
        await this.updateAmsSubscription(subscriptionId, { status: "ARCHIVED" });
      }
      /**
       * 批量创建AMS订阅（快车道所需的所有 9 个数据集）
       * 
       * 快车道数据集 (有效的Dataset ID白名单):
       * - sp-traffic: SP实时流量（每小时推送，延迟2-5分钟）
       * - sp-conversion: SP转化数据
       * - sp-budget-usage: SP预算监控（秒级/分钟级推送）
       * - sb-traffic: SB实时流量
       * - sb-conversion: SB转化数据 (beta)
       * - sb-budget-usage: SB预算监控
       * - sd-traffic: SD实时流量
       * - sd-conversion: SD转化数据 (beta)
       * - sd-budget-usage: SD预算监控
       */
      /**
       * 批量创建AMS订阅（快车道所需的所有 9 个数据集）
       * 支持两种调用方式:
       * 1. 传入队列ARN映射对象 - 每个数据集使用对应的队列
       * 2. 传入单一ARN字符串 - 所有数据集使用同一队列（向后兼容）
       */
      async createAllTrafficSubscriptions(queueArnOrMapping) {
        const trafficDatasets = VALID_TRAFFIC_DATASETS;
        const created = [];
        const failed = [];
        const isMapping = typeof queueArnOrMapping === "object";
        for (const dataSetId of trafficDatasets) {
          try {
            let destinationArn;
            if (isMapping) {
              destinationArn = queueArnOrMapping[dataSetId];
              if (!destinationArn) {
                log29.warn(`[AMS] \u6570\u636E\u96C6 ${dataSetId} \u672A\u914D\u7F6E\u961F\u5217ARN\uFF0C\u8DF3\u8FC7`);
                failed.push({ dataSetId, error: `\u672A\u914D\u7F6E\u961F\u5217ARN` });
                continue;
              }
            } else {
              destinationArn = queueArnOrMapping;
            }
            const existing = await this.listAmsSubscriptions();
            const existingSubscription = existing.find(
              (s) => s.dataSetId === dataSetId && s.status === "ACTIVE"
            );
            if (existingSubscription) {
              log29.info(`[AMS] \u8BA2\u9605 ${dataSetId} \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7\u521B\u5EFA`);
              created.push(existingSubscription);
              continue;
            }
            log29.info(`[AMS] \u521B\u5EFA\u8BA2\u9605: ${dataSetId} -> ${destinationArn}`);
            const subscription = await this.createAmsSubscription(
              dataSetId,
              destinationArn,
              `Fast lane subscription for ${dataSetId}`
            );
            created.push(subscription);
            await new Promise((resolve) => setTimeout(resolve, 1e3));
          } catch (error48) {
            log29.warn(`[AMS] \u521B\u5EFA\u8BA2\u9605 ${dataSetId} \u5931\u8D25:`, error48.message);
            failed.push({
              dataSetId,
              // @ts-ignore
              error: error48.response?.data?.message || error48.message
            });
          }
        }
        return { created, failed };
      }
      // ==================== V2 SB报告API（用于获取旧版SB广告数据） ====================
      /**
       * 请求V2 SB广告活动报告
       * V2 API用于获取2023年5月之前创建的旧版SB广告活动数据
       */
      async requestSbCampaignReportV2(reportDate, metrics = [
        "campaignName",
        "campaignId",
        "campaignStatus",
        "campaignBudget",
        "campaignBudgetType",
        "impressions",
        "clicks",
        "cost",
        "attributedSales14d",
        "attributedConversions14d"
      ]) {
        log29.debug("[Amazon API V2] \u8BF7\u6C42SB\u62A5\u544A, \u65E5\u671F:", reportDate);
        const response = await this.axiosInstance.post("/v2/hsa/campaigns/report", {
          reportDate,
          metrics
        }, {
          headers: { "Content-Type": "application/json" }
        });
        log29.info("[Amazon API V2] SB\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId:", response.data.reportId);
        return { reportId: response.data.reportId };
      }
      /**
       * 请求V2 SB视频广告报告
       */
      async requestSbVideoCampaignReportV2(reportDate, metrics = [
        "campaignName",
        "campaignId",
        "campaignStatus",
        "campaignBudget",
        "campaignBudgetType",
        "impressions",
        "clicks",
        "cost",
        "attributedSales14d",
        "attributedConversions14d",
        "videoCompleteViews",
        "videoFirstQuartileViews",
        "videoMidpointViews",
        "videoThirdQuartileViews"
        // @ts-ignore
      ]) {
        log29.debug("[Amazon API V2] \u8BF7\u6C42SB\u89C6\u9891\u62A5\u544A, \u65E5\u671F:", reportDate);
        const response = await this.axiosInstance.post("/v2/hsa/campaigns/report", {
          reportDate,
          metrics,
          creativeType: "video"
        }, {
          headers: { "Content-Type": "application/json" }
        });
        log29.info("[Amazon API V2] SB\u89C6\u9891\u62A5\u544A\u8BF7\u6C42\u6210\u529F, reportId:", response.data.reportId);
        return { reportId: response.data.reportId };
      }
      /**
       * 获取V2报告状态
       */
      async getReportStatusV2(reportId) {
        const response = await this.axiosInstance.get(`/v2/reports/${reportId}`, {
          headers: { "Content-Type": "application/json" }
        });
        log29.info("[Amazon API V2] \u62A5\u544A\u72B6\u6001:", response.data.status);
        return {
          status: response.data.status,
          // @ts-ignore
          location: response.data.location
        };
      }
      /**
       * 等待并下载V2报告
       * v413: 智能退避优化 — 指数退避轮询 + 减少日志刷屏
       */
      async waitAndDownloadReportV2(reportId, maxWaitMs = 6e5) {
        const startTime = Date.now();
        let pollCount = 0;
        const getPollInterval = /* @__PURE__ */ __name((count11) => {
          const intervals = [3e3, 6e3, 15e3, 3e4];
          return intervals[Math.min(count11, intervals.length - 1)];
        }, "getPollInterval");
        while (Date.now() - startTime < maxWaitMs) {
          try {
            const status = await this.getReportStatusV2(reportId);
            if (status.status === "SUCCESS" && status.location) {
              const waitSec = Math.round((Date.now() - startTime) / 1e3);
              log29.info(`[Amazon API V2] v413: \u62A5\u544A\u5DF2\u5B8C\u6210\uFF0C\u7B49\u5F85${waitSec}\u79D2\uFF0C\u5F00\u59CB\u4E0B\u8F7D...`);
              const reportResponse = await this.axiosInstance.get(status.location, {
                responseType: "arraybuffer",
                // @ts-ignore
                headers: { "Accept-Encoding": "gzip" }
              });
              const zlib2 = await import("zlib");
              const decompressed = zlib2.gunzipSync(Buffer.from(reportResponse.data));
              const reportData = JSON.parse(decompressed.toString("utf-8"));
              log29.info(`[Amazon API V2] v413: \u62A5\u544A\u4E0B\u8F7D\u5B8C\u6210\uFF0C\u5171 ${Array.isArray(reportData) ? reportData.length : 0} \u6761\u8BB0\u5F55`);
              return Array.isArray(reportData) ? reportData : [];
            } else if (status.status === "FAILURE") {
              log29.warn("[Amazon API V2] v413: \u62A5\u544A\u751F\u6210\u5931\u8D25");
              return [];
            }
            const interval = getPollInterval(pollCount);
            pollCount++;
            if (pollCount <= 3 || pollCount % 5 === 0) {
              const elapsedSec = Math.round((Date.now() - startTime) / 1e3);
              log29.info(`[Amazon API V2] v413: \u62A5\u544A${reportId.slice(-8)} PENDING, \u5DF2\u7B49${elapsedSec}\u79D2, \u8F6E\u8BE2#${pollCount}`);
            }
            await new Promise((resolve) => setTimeout(resolve, interval));
          } catch (error48) {
            pollCount++;
            const interval = getPollInterval(pollCount);
            log29.warn(`[Amazon API V2] v413: \u8F6E\u8BE2\u5931\u8D25(#${pollCount}): ${error48.message}\uFF0C${interval / 1e3}\u79D2\u540E\u91CD\u8BD5`);
            await new Promise((resolve) => setTimeout(resolve, interval));
          }
        }
        const totalSec = Math.round((Date.now() - startTime) / 1e3);
        log29.warn(`[Amazon API V2] v413: \u62A5\u544A\u7B49\u5F85\u8D85\u65F6 - \u7B49\u5F85${totalSec}\u79D2, \u8F6E\u8BE2${pollCount}\u6B21`);
        return [];
      }
      /**
       * 获取完整的SB广告活动报告（结合V2和V3）
       */
      async getCompleteSbCampaignReport(startDate, endDate) {
        const allData = [];
        const seenCampaignIds = /* @__PURE__ */ new Set();
        try {
          log29.debug("[Amazon API] \u5C1D\u8BD5V3 SB\u62A5\u544A...");
          const v3ReportId = await this.requestSbCampaignReport(startDate, endDate);
          const v3Data = await this.waitAndDownloadReport(v3ReportId);
          for (const row of v3Data) {
            const campaignId = row.campaignId?.toString();
            if (campaignId && !seenCampaignIds.has(campaignId)) {
              seenCampaignIds.add(campaignId);
              allData.push(row);
            }
          }
          log29.debug(`[Amazon API] V3 SB\u62A5\u544A\u83B7\u53D6 ${v3Data.length} \u6761\u8BB0\u5F55`);
        } catch (error48) {
          log29.warn("[Amazon API] V3 SB\u62A5\u544A\u5931\u8D25:", error48.message);
        }
        try {
          log29.debug("[Amazon API] \u5C1D\u8BD5V2 SB\u62A5\u544A...");
          const start = new Date(startDate);
          const end = new Date(endDate);
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split("T")[0].replace(/-/g, "");
            try {
              const v2Report = await this.requestSbCampaignReportV2(dateStr);
              const v2Data = await this.waitAndDownloadReportV2(v2Report.reportId);
              for (const row of v2Data) {
                const campaignId = row.campaignId?.toString();
                if (campaignId && !seenCampaignIds.has(campaignId + "_" + dateStr)) {
                  seenCampaignIds.add(campaignId + "_" + dateStr);
                  allData.push({ ...row, date: d.toISOString().split("T")[0] });
                }
              }
              const v2VideoReport = await this.requestSbVideoCampaignReportV2(dateStr);
              const v2VideoData = await this.waitAndDownloadReportV2(v2VideoReport.reportId);
              for (const row of v2VideoData) {
                const campaignId = row.campaignId?.toString();
                if (campaignId && !seenCampaignIds.has(campaignId + "_video_" + dateStr)) {
                  seenCampaignIds.add(campaignId + "_video_" + dateStr);
                  allData.push({ ...row, date: d.toISOString().split("T")[0], isVideo: true });
                }
              }
            } catch (error48) {
              log29.warn(`[Amazon API V2] \u65E5\u671F ${dateStr} \u62A5\u544A\u5931\u8D25: ${error48.message}`);
            }
          }
        } catch (error48) {
          log29.warn("[Amazon API] V2 SB\u62A5\u544A\u5931\u8D25:", error48.message);
        }
        log29.debug(`[Amazon API] \u5B8C\u6574SB\u62A5\u544A\u5171 ${allData.length} \u6761\u8BB0\u5F55`);
        return allData;
      }
      /**
       * 获取SB广告素材列表（品牌广告的创意素材）
       * 包含headline, brandLogo, customImage, video等素材信息
       */
      async listSbAds(campaignId) {
        const allAds = [];
        let nextToken;
        do {
          const body = { maxResults: 100 };
          if (campaignId) {
            body.campaignIdFilter = { include: [String(campaignId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          try {
            const response = await this.axiosInstance.post(
              "/sb/v4/ads/list",
              body,
              {
                headers: {
                  "Content-Type": "application/vnd.sbadresource.v4+json",
                  "Accept": "application/vnd.sbadresource.v4+json"
                }
              }
            );
            const ads = response.data.ads || [];
            allAds.push(...ads);
            nextToken = response.data.nextToken;
            log29.debug(`[SB API] Fetched ${ads.length} ads, total: ${allAds.length}, hasMore: ${!!nextToken}`);
          } catch (error48) {
            log29.warn("[SB API] Error fetching SB ads:", error48.message);
            break;
          }
        } while (nextToken);
        log29.debug(`[SB API] Total ads fetched: ${allAds.length}`);
        return allAds;
      }
      /**
       * 获取SB否定关键词列表
       */
      async listSbNegativeKeywords(campaignId) {
        const allNegatives = [];
        let nextToken;
        do {
          const body = { maxResults: 100 };
          if (campaignId) {
            body.campaignIdFilter = { include: [String(campaignId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          try {
            const response = await this.axiosInstance.post(
              "/sb/v4/negativeKeywords/list",
              body,
              {
                headers: {
                  "Content-Type": "application/vnd.sbkeywordresource.v4+json",
                  "Accept": "application/vnd.sbkeywordresource.v4+json"
                }
              }
            );
            const negatives = response.data.negativeKeywords || [];
            allNegatives.push(...negatives);
            nextToken = response.data.nextToken;
            log29.debug(`[SB API] v471: Fetched ${negatives.length} negative keywords via v4, total: ${allNegatives.length}`);
          } catch (error48) {
            const statusCode = error48.response?.status;
            if (statusCode === 404 || statusCode === 406) {
              try {
                log29.info(`[SB API] v471: v4\u7AEF\u70B9\u8FD4\u56DE${statusCode}\uFF0C\u56DE\u9000\u5230v3 GET /sb/negativeKeywords`);
                const v3Response = await this.axiosInstance.get("/sb/negativeKeywords", {
                  params: campaignId ? { campaignIdFilter: campaignId } : {}
                });
                const negatives = Array.isArray(v3Response.data) ? v3Response.data : v3Response.data.negativeKeywords || [];
                allNegatives.push(...negatives);
                log29.info(`[SB API] v471: v3\u7AEF\u70B9\u6210\u529F\u83B7\u53D6 ${negatives.length} \u4E2ASB\u5426\u5B9A\u5173\u952E\u8BCD`);
                return allNegatives;
              } catch (v3Error) {
                const v3Status = v3Error.response?.status;
                if (v3Status === 403) {
                  log29.warn("[SB API] v471: SB Negative Keywords API access denied (403)");
                } else {
                  log29.warn(`[SB API] v471: v3\u7AEF\u70B9\u4E5F\u5931\u8D25: ${v3Error.message}`);
                }
                return allNegatives;
              }
            }
            if (statusCode === 403) {
              log29.warn("[SB API] SB Negative Keywords API access denied (403) - account may not have SB permissions");
            } else {
              log29.warn("[SB API] Error fetching SB negative keywords:", error48.message);
            }
            break;
          }
        } while (nextToken);
        log29.debug(`[SB API] Total SB negative keywords fetched: ${allNegatives.length}`);
        return allNegatives;
      }
      /**
       * 获取SB否定商品定向列表
       */
      async listSbNegativeTargets(campaignId) {
        const allNegatives = [];
        let nextToken;
        do {
          const body = { maxResults: 100 };
          if (campaignId) {
            body.campaignIdFilter = { include: [String(campaignId)] };
          }
          if (nextToken) {
            body.nextToken = nextToken;
          }
          try {
            const response = await this.axiosInstance.post(
              "/sb/negativeTargets/list",
              body,
              {
                headers: {
                  "Content-Type": "application/json",
                  "Accept": "application/json"
                }
              }
            );
            const negatives = response.data.negativeTargets || [];
            allNegatives.push(...negatives);
            nextToken = response.data.nextToken;
            log29.debug(`[SB API] Fetched ${negatives.length} negative targets, total: ${allNegatives.length}`);
          } catch (error48) {
            const statusCode = error48.response?.status;
            if (statusCode === 403 || statusCode === 404) {
              log29.warn(`[SB API] v474: SB Negative Targets API \u4E0D\u53EF\u7528 (${statusCode}) - \u8D26\u6237\u53EF\u80FD\u672A\u5F00\u901ASB`);
            } else {
              log29.warn("[SB API] Error fetching SB negative targets:", error48.message);
            }
            break;
          }
        } while (nextToken);
        log29.debug(`[SB API] Total SB negative targets fetched: ${allNegatives.length}`);
        return allNegatives;
      }
      // ==================== v2: SB否定创建 API ====================
      /**
       * v2: 创建SB否定关键词（仅支持Ad Group级）
       * 
       * SB否定关键词使用 POST /sb/negativeKeywords 端点
       * 注意: SB不支持Campaign级否定关键词
       */
      async createSbNegativeKeywords(negatives) {
        const BATCH_SIZE = 100;
        const allResults = [];
        const totalBatches = Math.ceil(negatives.length / BATCH_SIZE);
        log29.info(`[SB API] v2: createSbNegativeKeywords \u5206\u6279\u5904\u7406: \u603B\u8BA1${negatives.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = negatives.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          log29.debug(`[SB API] v2: \u7B2C${batchIdx + 1}/${totalBatches}\u6279: ${batch.length}\u4E2ASB\u5426\u5B9A\u5173\u952E\u8BCD`);
          try {
            const formattedBatch = batch.map((n) => ({
              campaignId: String(n.campaignId),
              adGroupId: String(n.adGroupId),
              keywordText: n.keywordText,
              matchType: n.matchType,
              state: (n.state || "ENABLED").toUpperCase()
            }));
            const response = await this.axiosInstance.post("/sb/negativeKeywords", {
              negativeKeywords: formattedBatch
            }, {
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              }
            });
            const batchResults = response.data.negativeKeywords || response.data || [];
            allResults.push(...Array.isArray(batchResults) ? batchResults : [batchResults]);
            log29.info(`[SB API] v2: \u7B2C${batchIdx + 1}\u6279\u5B8C\u6210`);
          } catch (err) {
            const statusCode = err.response?.status;
            log29.warn(`[SB API] v2: \u7B2C${batchIdx + 1}\u6279\u5931\u8D25: status=${statusCode}, msg=${err.message}`);
            if (statusCode === 403) {
              log29.warn("[SB API] v2: SB Negative Keywords API access denied (403)");
              break;
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        log29.info(`[SB API] v2: SB\u5426\u5B9A\u5173\u952E\u8BCD\u521B\u5EFA\u5B8C\u6210: \u603B\u8BA1=${negatives.length}, \u7ED3\u679C=${allResults.length}`);
        return allResults;
      }
      /**
       * v2: 创建SB否定产品定向（仅支持Ad Group级）
       * 
       * SB否定产品定向使用 POST /sb/negativeTargets 端点
       * 注意: SB不支持Campaign级否定产品定向
       */
      async createSbNegativeTargets(negatives) {
        const BATCH_SIZE = 100;
        const allResults = [];
        const totalBatches = Math.ceil(negatives.length / BATCH_SIZE);
        log29.info(`[SB API] v2: createSbNegativeTargets \u5206\u6279\u5904\u7406: \u603B\u8BA1${negatives.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = negatives.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          try {
            const formattedBatch = batch.map((n) => ({
              campaignId: String(n.campaignId),
              adGroupId: String(n.adGroupId),
              expression: n.expression,
              state: (n.state || "ENABLED").toUpperCase()
            }));
            const response = await this.axiosInstance.post("/sb/negativeTargets", {
              negativeTargets: formattedBatch
            }, {
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              }
            });
            const batchResults = response.data.negativeTargets || response.data || [];
            allResults.push(...Array.isArray(batchResults) ? batchResults : [batchResults]);
            log29.info(`[SB API] v2: \u7B2C${batchIdx + 1}\u6279SB\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u5B8C\u6210`);
          } catch (err) {
            const statusCode = err.response?.status;
            log29.warn(`[SB API] v2: \u7B2C${batchIdx + 1}\u6279\u5931\u8D25: status=${statusCode}, msg=${err.message}`);
            if (statusCode === 403) {
              log29.warn("[SB API] v2: SB Negative Targets API access denied (403)");
              break;
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        log29.info(`[SB API] v2: SB\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u521B\u5EFA\u5B8C\u6210: \u603B\u8BA1=${negatives.length}, \u7ED3\u679C=${allResults.length}`);
        return allResults;
      }
      // ==================== v2: SD否定 API ====================
      /**
       * v2: 获取SD否定产品定向列表（仅Ad Group级，仅限上下文定向）
       * 
       * SD不支持否定关键词，仅支持否定产品定向
       * 使用 POST /sd/negativeTargets/list 端点
       */
      async listSdNegativeTargets(adGroupId) {
        const allTargets = [];
        let startIndex = 0;
        const count11 = 100;
        while (true) {
          try {
            const params = { startIndex, count: count11 };
            if (adGroupId) {
              params.adGroupIdFilter = adGroupId;
            }
            const response = await this.axiosInstance.get("/sd/negativeTargets", {
              params,
              headers: {
                "Accept": "application/json"
              }
            });
            const targets = response.data || [];
            if (!Array.isArray(targets) || targets.length === 0) break;
            allTargets.push(...targets);
            if (targets.length < count11) break;
            startIndex += count11;
          } catch (error48) {
            const statusCode = error48.response?.status;
            if (statusCode === 403) {
              log29.warn("[SD API] v2: SD Negative Targets API access denied (403)");
            } else {
              log29.warn("[SD API] v2: Error fetching SD negative targets:", error48.message);
            }
            break;
          }
        }
        log29.debug(`[SD API] v2: Total SD negative targets fetched: ${allTargets.length}`);
        return allTargets;
      }
      /**
       * v2: 创建SD否定产品定向（仅Ad Group级，仅限上下文定向）
       * 
       * SD否定产品定向使用 POST /sd/negativeTargets 端点
       * 注意: 只有contextual targeting类型的SD广告活动才支持否定产品定向
       */
      async createSdNegativeTargets(negatives) {
        const BATCH_SIZE = 100;
        const allResults = [];
        const totalBatches = Math.ceil(negatives.length / BATCH_SIZE);
        log29.info(`[SD API] v2: createSdNegativeTargets \u5206\u6279\u5904\u7406: \u603B\u8BA1${negatives.length}\u4E2A, \u5206${totalBatches}\u6279`);
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batch = negatives.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
          try {
            const formattedBatch = batch.map((n) => ({
              adGroupId: String(n.adGroupId),
              // v356: 使用String()替代Number()，避免大数字ID精度丢失
              expression: n.expression,
              state: (n.state || "ENABLED").toUpperCase()
            }));
            const response = await this.axiosInstance.post("/sd/negativeTargets", formattedBatch, {
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              }
            });
            const batchResults = response.data || [];
            allResults.push(...Array.isArray(batchResults) ? batchResults : [batchResults]);
            log29.info(`[SD API] v2: \u7B2C${batchIdx + 1}\u6279SD\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u5B8C\u6210`);
          } catch (err) {
            const statusCode = err.response?.status;
            log29.warn(`[SD API] v2: \u7B2C${batchIdx + 1}\u6279\u5931\u8D25: status=${statusCode}, msg=${err.message}`);
            if (statusCode === 403) {
              log29.warn("[SD API] v2: SD Negative Targets API access denied (403)");
              break;
            }
          }
          if (batchIdx < totalBatches - 1) {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        log29.info(`[SD API] v2: SD\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u521B\u5EFA\u5B8C\u6210: \u603B\u8BA1=${negatives.length}, \u7ED3\u679C=${allResults.length}`);
        return allResults;
      }
      /**
       * 获取创意素材详情 - Creative Asset Library API
       * GET /assets?assetId={assetId}
       * 返回素材的完整URL（包括视频URL、缩略图等）
       */
      async getAssetDetails(assetId) {
        try {
          const headers = await this.getHeaders();
          const response = await this.axiosInstance.get("/assets", {
            params: { assetId },
            headers: {
              ...headers,
              "Accept": "application/vnd.creativeassetsgetresponse.v3+json"
            }
          });
          return response.data;
        } catch (error48) {
          const errInfo = error48.response?.data || error48.message;
          log29.warn(`[Assets API] Failed to get asset ${assetId}: ${typeof errInfo === "object" ? JSON.stringify(errInfo).slice(0, 200) : errInfo}`);
          return null;
        }
      }
      /**
       * 批量解析素材ID为实际URL
       * 对每个assetId调用getAssetDetails，提取关键URL
       */
      async resolveAssetUrls(assetIds) {
        const result = /* @__PURE__ */ new Map();
        // v577: Assets API优化 - 增加assetId有效性预检和失败缓存
        if (!this._assetFailCache) this._assetFailCache = new Map();
        const ASSET_FAIL_CACHE_TTL = 30 * 60 * 1000; // 30分钟缓存
        let validAssetIds = assetIds.filter(id => {
          if (!id) return false;
          // 基本格式校验: assetId应该是非空字符串
          if (typeof id !== 'string' || id.trim().length === 0) {
            log29.debug(`[Assets API] v577: 跳过无效assetId: ${id}`);
            return false;
          }
          // 检查失败缓存
          const cached = this._assetFailCache.get(id);
          if (cached && Date.now() - cached < ASSET_FAIL_CACHE_TTL) {
            log29.debug(`[Assets API] v577: 跳过已知失败的assetId: ${id} (缓存中)`);
            return false;
          }
          return true;
        });
        if (validAssetIds.length < assetIds.filter(Boolean).length) {
          log29.info(`[Assets API] v577: 预检过滤 ${assetIds.filter(Boolean).length - validAssetIds.length} 个无效/已知失败的assetId, 剩余 ${validAssetIds.length} 个待查询`);
        }
        // v578: 限制单次最多查询100个asset，避免大量请求导致限流
        const MAX_ASSETS_PER_SYNC = 100;
        if (validAssetIds.length > MAX_ASSETS_PER_SYNC) {
          log29.info(`[Assets API] v578: 待查询assetId(${validAssetIds.length})超过限制(${MAX_ASSETS_PER_SYNC})，仅处理前${MAX_ASSETS_PER_SYNC}个`);
          validAssetIds = validAssetIds.slice(0, MAX_ASSETS_PER_SYNC);
        }
        let _assetConsecutiveFailures = 0;
        const MAX_CONSECUTIVE_FAILURES = 5;
        for (const assetId of validAssetIds) {
          // v578: 连续失败熔断
          if (_assetConsecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            log29.warn(`[Assets API] v578: 连续${MAX_CONSECUTIVE_FAILURES}次失败，熔断剩余asset查询`);
            break;
          }
          try {
            const assetData = await this.getAssetDetails(assetId);
            if (!assetData) continue;
            const version4 = assetData.assetVersionList?.[0];
            const assetType = assetData.assetGlobal?.assetType;
            let url3 = version4?.url || version4?.assetFiles?.defaultUrl || version4?.storageLocationUrls?.defaultUrl || "";
            let thumbnailUrl = "";
            if (version4?.assetFiles?.processedFiles) {
              for (const file2 of version4.assetFiles.processedFiles) {
                if (file2.profile === "VIDEO_DEFAULT_OPTIMIZED" && !url3) {
                  url3 = file2.url;
                }
                if (file2.profile === "IMAGE_THUMBNAIL_500") {
                  thumbnailUrl = file2.url;
                }
              }
            }
            if (version4?.storageLocationUrls?.processedUrls) {
              const processedUrls = version4.storageLocationUrls.processedUrls;
              if (processedUrls["VIDEO_DEFAULT_OPTIMIZED"] && !url3) {
                url3 = processedUrls["VIDEO_DEFAULT_OPTIMIZED"];
              }
              if (processedUrls["IMAGE_THUMBNAIL_500"]) {
                thumbnailUrl = processedUrls["IMAGE_THUMBNAIL_500"];
              }
            }
            if (url3) {
              result.set(assetId, { url: url3, thumbnailUrl, type: assetType });
              _assetConsecutiveFailures = 0; // v578: 成功时重置连续失败计数
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
          } catch (error48) {
            log29.warn(`[Assets API] Error resolving asset ${assetId}:`, error48.message);
            _assetConsecutiveFailures++; // v578: 增加连续失败计数
            // v577: 缓存失败的assetId避免重复请求
            if (this._assetFailCache) {
              this._assetFailCache.set(assetId, Date.now());
            }
          }
        }
        return result;
      }
      /**
       * 获取请求头（内部辅助方法）
       */
      async getHeaders() {
        const token = await this.getAccessToken();
        return {
          "Authorization": `Bearer ${token}`,
          "Amazon-Advertising-API-ClientId": this.credentials.clientId,
          "Amazon-Advertising-API-Scope": this.credentials.profileId,
          "Content-Type": "application/json"
        };
      }
      /**
       * v413: 批量提交报告请求并统一轮询等待
       * 解决串行等待问题：将“提交→等待→下载”的串行模式改为“批量提交→统一轮询→逐个下载”
       * 
       * @param reportRequests 报告请求数组，每个包含 name 和 requestFn
       * @param maxWaitMs 整体最大等待时间（默认5分钟）
       * @param submitDelayMs 提交间隔（默认2秒，避免触发限流）
       * @returns 每个报告的结果数组，顺序与输入一致
       */
      async submitAndWaitMultipleReports(reportRequests, maxWaitMs = 12e5, submitDelayMs = 2e3) {
        const startTime = Date.now();
        const results = [];
        const pendingReports = [];
        log29.info(`[Amazon API] v618: 批量提交${reportRequests.length}个报告请求(指数退避轮询)...`);
        // v618: 报告请求去重 - 跳过5分钟内已提交的相同报告
        if (!this._reportCache) this._reportCache = new Map();
        const now = Date.now();
        // 清理过期缓存(>5分钟)
        for (const [key, ts] of this._reportCache) {
          if (now - ts > 300000) this._reportCache.delete(key);
        }
        for (let i = 0; i < reportRequests.length; i++) {
          const req = reportRequests[i];
          try {
            const reportId = await req.requestFn();
            pendingReports.push({
              name: req.name,
              reportId,
              index: i,
              completed: false,
              data: null
            });
            log29.info(`[Amazon API] v413: \u62A5\u544A\u63D0\u4EA4\u6210\u529F [${i + 1}/${reportRequests.length}]: ${req.name} -> ${reportId}`);
            if (i < reportRequests.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, submitDelayMs));
            }
          } catch (submitErr) {
            const errStatus = submitErr.response?.status;
            const errData = submitErr.response?.data;
            if (errStatus === 425 && errData?.detail) {
              const match = String(errData.detail).match(/duplicate of\s*:\s*([a-f0-9-]+)/i);
              if (match) {
                const existingReportId = match[1];
                log29.info(`[Amazon API] v458: \u62A5\u544A\u91CD\u590D\u63D0\u4EA4(425)\uFF0C\u590D\u7528\u5DF2\u6709reportId [${req.name}]: ${existingReportId}`);
                pendingReports.push({
                  name: req.name,
                  reportId: existingReportId,
                  index: i,
                  completed: false,
                  data: null
                });
                continue;
              }
            }
            const errBody = submitErr.response?.data;
            const errDetail = errBody ? ` | response: ${JSON.stringify(errBody).slice(0, 300)}` : "";
            const isRetentionError = errDetail.includes("retention") || errDetail.includes("configuration date");
            if (isRetentionError) {
              log29.info(`[Amazon API] v614i-P0: \u62A5\u544A\u8D85\u51FA\u6570\u636E\u4FDD\u7559\u671F\uFF0C\u8FD4\u56DE\u7A7A\u6570\u636E [${req.name}]`);
              results[i] = { name: req.name, data: [] };
              continue;
            } else {
              const _is425 = submitErr.message?.includes("425") || errDetail.includes("425");
              if (_is425) {
                log29.warn(`[Amazon API] v474: \u62A5\u544A\u63D0\u4EA4\u91CD\u590D (expected 425) [${req.name}]: ${submitErr.message}`);
              } else {
                log29.warn(`[Amazon API] v474: \u62A5\u544A\u63D0\u4EA4\u5931\u8D25 [${req.name}]: ${submitErr.message}${errDetail}`);
              }
              // v578: 对429限流错误进行延迟重试
              const _is429 = submitErr.response?.status === 429 || submitErr.message?.includes("429");
              if (_is429 && !req._retried) {
                req._retried = true;
                const retryDelay = 10000 + Math.random() * 5000;
                log29.info(`[Amazon API] v578: 报告提交被限流(429), ${Math.round(retryDelay/1000)}秒后重试 [${req.name}]`);
                await new Promise(r => setTimeout(r, retryDelay));
                try {
                  const retryReportId = await req.requestFn();
                  pendingReports.push({
                    name: req.name,
                    reportId: retryReportId,
                    index: i,
                    completed: false,
                    data: null
                  });
                  log29.info(`[Amazon API] v578: 报告重试提交成功 [${req.name}]: reportId=${retryReportId}`);
                  continue;
                } catch (retryErr) {
                  log29.warn(`[Amazon API] v578: 报告重试提交仍失败 [${req.name}]: ${retryErr.message}`);
                }
              }
            }
            results[i] = { name: req.name, data: null, error: submitErr.message };
          }
        }
        if (pendingReports.length === 0) {
          log29.warn(`[Amazon API] v413: \u6240\u6709\u62A5\u544A\u63D0\u4EA4\u5931\u8D25\uFF0C\u8DF3\u8FC7\u8F6E\u8BE2`);
          for (let i = 0; i < reportRequests.length; i++) {
            if (!results[i]) results[i] = { name: reportRequests[i].name, data: null, error: "submit_failed" };
          }
          return results;
        }
        const submitDuration = Math.round((Date.now() - startTime) / 1e3);
        log29.info(`[Amazon API] v413: \u6279\u91CF\u63D0\u4EA4\u5B8C\u6210 - ${pendingReports.length}/${reportRequests.length}\u6210\u529F, \u8017\u65F6${submitDuration}\u79D2, \u5F00\u59CB\u7EDF\u4E00\u8F6E\u8BE2...`);
        let pollRound = 0;
        const getPollInterval = /* @__PURE__ */ __name((round, completionRatio) => {
          // v618: 真正的指数退避 + 智能间隔调整
          // 基础间隔: 20s, 30s, 45s, 60s, 60s (比旧版15s起步更合理)
          const baseIntervals = [20e3, 30e3, 45e3, 60e3, 60e3];
          const base = baseIntervals[Math.min(round, baseIntervals.length - 1)];
          // 如果已完成比例>50%，说明报告生成较快，缩短等待
          const speedFactor = completionRatio > 0.5 ? 0.7 : 1.0;
          // 如果轮询超过8轮，说明报告生成很慢，进一步拉长间隔
          const slowFactor = round > 8 ? 1.5 : (round > 5 ? 1.2 : 1.0);
          const interval = Math.round(base * speedFactor * slowFactor);
          const jitter = Math.floor(Math.random() * 3000);
          return Math.min(interval + jitter, 90e3); // 上限90秒
        }, "getPollInterval");
        log29.info(`[Amazon API] v614i-P0: \u7B49\u5F8515\u79D2\u540E\u5F00\u59CB\u8F6E\u8BE2\uFF08\u62A5\u544A\u751F\u6210\u901A\u5E38\u9700\u898110-30\u79D2\uFF09...`);
        await new Promise((resolve) => setTimeout(resolve, 20e3)); // v618: 增加初始等待到20s，Amazon报告通常需要15-30s生成
        while (Date.now() - startTime < maxWaitMs) {
          const incomplete = pendingReports.filter((r) => !r.completed);
          if (incomplete.length === 0) break;
          for (const report of incomplete) {
            try {
              const status = await this.getReportStatus(report.reportId);
              if (status.status === "COMPLETED" && status.url) {
                const data = await this.downloadReport(status.url);
                report.completed = true;
                report.data = data;
                // v618: 标记空报告，后续分析可用
                if (!data || data.length === 0) report._isEmpty = true;
                const elapsed = Math.round((Date.now() - startTime) / 1e3);
                const emptyTag = !data || data.length === 0 ? " [\u7A7A\u62A5\u544A]" : "";
                log29.info(`[Amazon API] v413: \u62A5\u544A\u5B8C\u6210\u5E76\u4E0B\u8F7D [${report.name}]: ${data?.length || 0}\u6761, \u8017\u65F6${elapsed}\u79D2${emptyTag}`);
              } else if (status.status === "FAILED") {
                report.completed = true;
                report.error = status.failureReason || "Report generation failed";
                log29.warn(`[Amazon API] v413: \u62A5\u544A\u5931\u8D25 [${report.name}]: ${report.error}`);
              }
            } catch (pollErr) {
              log29.warn(`[Amazon API] v413: \u8F6E\u8BE2\u5931\u8D25 [${report.name}]: ${pollErr.message}`);
            }
            if (incomplete.indexOf(report) < incomplete.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 1e3));
            }
          }
          const completedCount2 = pendingReports.filter((r) => r.completed).length;
          const remaining = pendingReports.length - completedCount2;
          if (remaining > 0) {
            pollRound++;
            // v618: 指数退避 + 智能间隔，基于完成比例动态调整
            const completionRatio = completedCount2 / pendingReports.length;
            const interval = getPollInterval(pollRound, completionRatio);
            const elapsed = Math.round((Date.now() - startTime) / 1e3);
            {
              const pendingNames = pendingReports.filter((r) => !r.completed).map((r) => r.name).join(", ");
              log29.info(`[Amazon API] v618: 轮询第${pollRound}轮(指数退避) - ${completedCount2}/${pendingReports.length}完成(${Math.round(completionRatio*100)}%), 剩余${remaining}个[${pendingNames}], 已等${elapsed}秒, 下次${Math.round(interval/1e3)}秒后`);
            }
            await new Promise((resolve) => setTimeout(resolve, interval));
          }
        }
        const totalSec = Math.round((Date.now() - startTime) / 1e3);
        const completedCount = pendingReports.filter((r) => r.completed && r.data).length;
        const failedCount = pendingReports.filter((r) => r.completed && r.error).length;
        const timeoutCount = pendingReports.filter((r) => !r.completed).length;
        const timedOutReports = [];
        for (const report of pendingReports) {
          if (!report.completed) {
            report.completed = true;
            report.error = `Report generation timeout after ${totalSec}s (queued for async retry)`;
            timedOutReports.push({ name: report.name, reportId: report.reportId });
            log29.warn(`[v587] P2报告超时降级到异步队列 [${report.name}]: reportId=${report.reportId}, 将由AsyncReportService在后台继续轮询`);
          }
        }
        if (timedOutReports.length > 0) {
          try {
            const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
            const db = await getDb3();
            if (db) {
              const { reportJobs: reportJobs3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
              for (const tr of timedOutReports) {
                await db.insert(reportJobs3).values({
                  accountId: this.accountId || 0, // v588: 使用实际accountId
                  // 将由AsyncReportService根据reportId补充
                  profileId: this.profileId || "",
                  reportType: tr.name,
                  adProduct: tr.name.includes("SP") ? "SPONSORED_PRODUCTS" : tr.name.includes("SB") ? "SPONSORED_BRANDS" : "SPONSORED_DISPLAY",
                  status: "submitted",
                  reportId: tr.reportId,
                  startDate: "",
                  endDate: "",
                  requestPayload: JSON.stringify({ source: "timeout_fallback", originalName: tr.name, adType: tr.name.includes("SP") ? "sp" : tr.name.includes("SB") ? "sb" : "sd" }),
                  retryCount: 0,
                  maxRetries: 5,
                  submittedAt: (/* @__PURE__ */ new Date()).toISOString()
                }).catch((e) => log29.warn(`[v580] \u8D85\u65F6\u62A5\u544A\u5165\u961F\u5931\u8D25: ${e.message}`));
              }
              log29.info(`[v580] ${timedOutReports.length}\u4E2A\u8D85\u65F6\u62A5\u544A\u5DF2\u5165\u961F\u5230\u5F02\u6B65\u5904\u7406\u7BA1\u9053`);
            }
          } catch (queueErr) {
            log29.warn(`[v580] \u8D85\u65F6\u62A5\u544A\u5165\u961F\u5F02\u5E38: ${queueErr.message}`);
          }
        }
        log29.info(`[Amazon API] v413: \u6279\u91CF\u62A5\u544A\u5B8C\u6210 - \u6210\u529F${completedCount}, \u5931\u8D25${failedCount}, \u8D85\u65F6${timeoutCount}, \u603B\u8017\u65F6${totalSec}\u79D2`);
        for (const report of pendingReports) {
          results[report.index] = {
            name: report.name,
            data: report.data,
            error: report.error
          };
        }
        for (let i = 0; i < reportRequests.length; i++) {
          if (!results[i]) results[i] = { name: reportRequests[i].name, data: null, error: "unknown" };
        }
        return results;
      }
      // ==================== v424: SP Campaign Budget Rules API ====================
      /**
       * v424: 获取SP广告活动的Budget Rules
       * 端点: GET /sp/campaigns/{campaignId}/budgetRules
       * 参考: https://advertising.amazon.com/API/docs/en-us/sponsored-products/3-0/openapi/prod
       */
      async listSpCampaignBudgetRules(campaignId) {
        try {
          const response = await this.axiosInstance.get(
            `/sp/campaigns/${campaignId}/budgetRules`,
            {
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/vnd.spCampaignBudgetRules.v3+json"
              }
            }
          );
          const rules = response.data?.associatedRules || response.data?.budgetRules || response.data || [];
          log29.debug(`[SP API] v424: Campaign ${campaignId} has ${Array.isArray(rules) ? rules.length : 0} budget rules`);
          return Array.isArray(rules) ? rules : [];
        } catch (error48) {
          const statusCode = error48.response?.status;
          if (statusCode === 404 || statusCode === 400) {
            return [];
          }
          if (statusCode === 403) {
            log29.debug(`[SP API] v424: Budget Rules API access denied for campaign ${campaignId} (403)`);
            return [];
          }
          log29.warn(`[SP API] v424: Error fetching budget rules for campaign ${campaignId}: ${error48.message}`);
          return [];
        }
      }
      /**
       * v424: 批量获取多个SP广告活动的Budget Rules
       * 为避免API速率限制，使用串行调用+延迟
       */
      async listSpCampaignsBudgetRules(campaignIds, onProgress) {
        const result = /* @__PURE__ */ new Map();
        const batchSize = 5;
        for (let i = 0; i < campaignIds.length; i += batchSize) {
          const batch = campaignIds.slice(i, i + batchSize);
          const batchResults = await Promise.allSettled(
            batch.map((id) => this.listSpCampaignBudgetRules(id))
          );
          for (let j = 0; j < batch.length; j++) {
            const batchResult = batchResults[j];
            if (batchResult.status === "fulfilled") {
              result.set(batch[j], batchResult.value);
            } else {
              result.set(batch[j], []);
            }
          }
          if (onProgress) {
            onProgress(Math.min(i + batchSize, campaignIds.length), campaignIds.length);
          }
          if (i + batchSize < campaignIds.length) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        return result;
      }
    };
    VALID_TRAFFIC_DATASETS = [
      "sp-traffic",
      "sp-conversion",
      "sp-budget-usage",
      "sb-traffic",
      "sb-conversion",
      "sb-budget-usage",
      "sd-traffic",
      "sd-conversion",
      "sd-budget-usage"
    ];
    __name(generateUuidV4, "generateUuidV4");
    __name(createAmazonAdsClient, "createAmazonAdsClient");
    __name(validateCredentials, "validateCredentials");
  }
});

