// Extracted from production dist/index.js
// Original module: server/_core/sdk.ts
// Lines: 374

var import_cookie, import_jsonwebtoken, log19, isNonEmptyString, EXCHANGE_TOKEN_PATH, GET_USER_INFO_PATH, GET_USER_INFO_WITH_JWT_PATH, OAuthService, createOAuthHttpClient, SDKServer, sdk;
var init_sdk = __esm({
  "server/_core/sdk.ts"() {
    "use strict";
    init_const();
    init_logger();
    init_opsLogger();
    init_errors2();
    init_axios2();
    import_cookie = __toESM(require_dist());
    init_webapi();
    init_drizzle_orm();
    import_jsonwebtoken = __toESM(require_jsonwebtoken());
    init_db2();
    init_db2();
    init_env();
    log19 = createModuleLogger("SDK");
    isNonEmptyString = /* @__PURE__ */ __name((value) => typeof value === "string" && value.length > 0, "isNonEmptyString");
    EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
    GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
    GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
    OAuthService = class {
      constructor(client) {
        this.client = client;
        log19.info("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
        if (!ENV.oAuthServerUrl) {
          log19.warn(
            "[OAuth] OAUTH_SERVER_URL is not configured. Set OAUTH_SERVER_URL environment variable if OAuth is needed."
          );
        }
      }
      client;
      static {
        __name(this, "OAuthService");
      }
      decodeState(state) {
        const redirectUri = atob(state);
        return redirectUri;
      }
      async getTokenByCode(code, state) {
        const payload = {
          clientId: ENV.appId,
          grantType: "authorization_code",
          code,
          redirectUri: this.decodeState(state)
        };
        const { data } = await this.client.post(
          EXCHANGE_TOKEN_PATH,
          payload
        );
        return data;
      }
      async getUserInfoByToken(token) {
        const { data } = await this.client.post(
          GET_USER_INFO_PATH,
          {
            accessToken: token.accessToken
          }
        );
        return data;
      }
    };
    createOAuthHttpClient = /* @__PURE__ */ __name(() => axios_default.create({
      baseURL: ENV.oAuthServerUrl,
      timeout: AXIOS_TIMEOUT_MS
    }), "createOAuthHttpClient");
    SDKServer = class {
      static {
        __name(this, "SDKServer");
      }
      client;
      oauthService;
      constructor(client = createOAuthHttpClient()) {
        this.client = client;
        this.oauthService = new OAuthService(this.client);
      }
      deriveLoginMethod(platforms, fallback) {
        if (fallback && fallback.length > 0) return fallback;
        if (!Array.isArray(platforms) || platforms.length === 0) return null;
        const set2 = new Set(
          platforms.filter((p) => typeof p === "string")
        );
        if (set2.has("REGISTERED_PLATFORM_EMAIL")) return "email";
        if (set2.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
        if (set2.has("REGISTERED_PLATFORM_APPLE")) return "apple";
        if (set2.has("REGISTERED_PLATFORM_MICROSOFT") || set2.has("REGISTERED_PLATFORM_AZURE"))
          return "microsoft";
        if (set2.has("REGISTERED_PLATFORM_GITHUB")) return "github";
        const first = Array.from(set2)[0];
        return first ? first.toLowerCase() : null;
      }
      /**
       * Exchange OAuth authorization code for access token
       * @example
       * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
       */
      async exchangeCodeForToken(code, state) {
        return this.oauthService.getTokenByCode(code, state);
      }
      /**
       * Get user information using access token
       * @example
       * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
       */
      async getUserInfo(accessToken) {
        const data = await this.oauthService.getUserInfoByToken({
          accessToken
        });
        const loginMethod = this.deriveLoginMethod(
          // @ts-ignore
          data?.platforms,
          // @ts-ignore
          data?.platform ?? data.platform ?? null
          // @ts-ignore
        );
        return {
          // @ts-ignore
          ...data,
          platform: loginMethod,
          loginMethod
        };
      }
      parseCookies(cookieHeader) {
        if (!cookieHeader) {
          return /* @__PURE__ */ new Map();
        }
        const parsed = (0, import_cookie.parse)(cookieHeader);
        return new Map(Object.entries(parsed));
      }
      getSessionSecret() {
        const secret = ENV.cookieSecret;
        return new TextEncoder().encode(secret);
      }
      /**
       * Create a session token for a Manus user openId
       * @example
       * const sessionToken = await sdk.createSessionToken(userInfo.openId);
       */
      async createSessionToken(openId, options = {}) {
        return this.signSession(
          {
            openId,
            appId: ENV.appId,
            name: options.name || ""
          },
          options
        );
      }
      async signSession(payload, options = {}) {
        const issuedAt = Date.now();
        const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
        const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
        const secretKey = this.getSessionSecret();
        return new SignJWT({
          openId: payload.openId,
          appId: payload.appId,
          name: payload.name
        }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
      }
      async verifySession(cookieValue) {
        if (!cookieValue) {
          log19.warn("[Auth] Missing session cookie");
          return null;
        }
        try {
          const secretKey = this.getSessionSecret();
          const { payload } = await jwtVerify(cookieValue, secretKey, {
            algorithms: ["HS256"]
          });
          const { openId, appId, name: name2 } = payload;
          if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name2)) {
            log19.warn("[Auth] Session payload missing required fields");
            return null;
          }
          return {
            openId,
            appId,
            name: name2
          };
        } catch (error48) {
          log19.warn("[Auth] Session verification failed", String(error48));
          return null;
        }
      }
      async getUserInfoWithJwt(jwtToken) {
        const payload = {
          jwtToken,
          projectId: ENV.appId
        };
        const { data } = await this.client.post(
          GET_USER_INFO_WITH_JWT_PATH,
          payload
          // @ts-ignore
        );
        const loginMethod = this.deriveLoginMethod(
          // @ts-ignore
          data?.platforms,
          // @ts-ignore
          data?.platform ?? data.platform ?? null
        );
        return {
          // @ts-ignore
          ...data,
          platform: loginMethod,
          loginMethod
        };
      }
      // v614i-fix8: 3.3.1 认证缓存机制
      // 对已验证的 JWT Token 缓存用户信息，减少数据库查询压力
      authCache = /* @__PURE__ */ new Map();
      AUTH_CACHE_TTL_MS = 5 * 60 * 1e3;
      // 5分钟缓存
      AUTH_CACHE_MAX_SIZE = 200;
      // 最大缓存200个用户
      getFromAuthCache(tokenHash) {
        const entry = this.authCache.get(tokenHash);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
          this.authCache.delete(tokenHash);
          return null;
        }
        return entry.user;
      }
      setAuthCache(tokenHash, user) {
        if (this.authCache.size >= this.AUTH_CACHE_MAX_SIZE) {
          const firstKey = this.authCache.keys().next().value;
          if (firstKey) this.authCache.delete(firstKey);
        }
        this.authCache.set(tokenHash, { user, expiresAt: Date.now() + this.AUTH_CACHE_TTL_MS });
      }
      async authenticateRequest(req) {
        const authHeader = req.headers.authorization;
        logSystem("Auth", `authenticateRequest called, hasAuthHeader=${!!authHeader}, startsWithBearer=${authHeader?.startsWith("Bearer ")}, headerLen=${authHeader?.length}`);
        log19.info(`[Auth] authenticateRequest called, hasAuthHeader=${!!authHeader}`);
        if (authHeader && authHeader.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          const tokenCacheKey = token.substring(token.length - 16);
          const cachedUser = this.getFromAuthCache(tokenCacheKey);
          if (cachedUser) {
            log19.debug(`[Auth] v614i-fix8: \u8BA4\u8BC1\u7F13\u5B58\u547D\u4E2D userId=${cachedUser.id}`);
            return cachedUser;
          }
          try {
            const secret = process.env.JWT_SECRET;
            if (!secret) throw new Error("JWT_SECRET \u73AF\u5883\u53D8\u91CF\u672A\u914D\u7F6E");
            const decoded = import_jsonwebtoken.default.verify(token, secret);
            logSystem("Auth", `JWT decoded: userId=${decoded?.userId}, name=${decoded?.name}`);
            log19.info(`[Auth] JWT decoded: userId=${decoded?.userId}`);
            if (decoded && decoded.userId) {
              const dbQueryWithTimeout = /* @__PURE__ */ __name(async (timeoutMs = 15e3) => {
                const timeoutPromise = new Promise(
                  (_, reject) => setTimeout(() => reject(new Error("Auth DB query timeout")), timeoutMs)
                );
                return Promise.race([
                  (async () => {
                    // v597: Use dedicated auth pool for fast auth queries during heavy sync
                    if (global._authPool) {
                      const [rows] = await global._authPool.execute(
                        'SELECT tm.*, o.name as organization_name FROM team_members tm LEFT JOIN organizations o ON tm.organization_id = o.id WHERE tm.id = ?',
                        [decoded.userId]
                      );
                      return [rows];
                    }
                    const localDb = await getDb();
                    if (!localDb) throw new Error("Database not available");
                    return localDb.execute(sql`
                  SELECT tm.*, o.name as organization_name 
                  FROM team_members tm 
                  LEFT JOIN organizations o ON tm.organization_id = o.id 
                  WHERE tm.id = ${decoded.userId}
                `);
                  })(),
                  // @ts-ignore
                  timeoutPromise
                ]);
              }, "dbQueryWithTimeout");
              try {
                const result = await dbQueryWithTimeout();
                const rows = result[0];
                logSystem("Auth", `DB query result: rowsType=${typeof rows}, isArray=${Array.isArray(rows)}, length=${rows?.length}, keys=${rows && rows[0] ? Object.keys(rows[0]).join(",") : "N/A"}`);
                log19.info(`[Auth] DB query result: length=${rows?.length}`);
                if (rows && rows.length > 0) {
                  const localUser = rows[0];
                  const userResult = {
                    id: localUser.id,
                    openId: `local_${localUser.id}`,
                    name: localUser.name,
                    email: localUser.email,
                    loginMethod: "local",
                    lastSignedIn: localUser.last_login_at,
                    organizationId: localUser.organization_id,
                    role: localUser.role
                  };
                  this.setAuthCache(tokenCacheKey, userResult);
                  return userResult;
                } else {
                  log19.warn(`[Auth] JWT user not found in DB (userId=${decoded.userId}), using JWT fallback`);
                  const fallbackUser = {
                    id: decoded.userId,
                    openId: `local_${decoded.userId}`,
                    name: decoded.name || "User",
                    email: decoded.username || "",
                    loginMethod: "local",
                    lastSignedIn: (/* @__PURE__ */ new Date()).toISOString(),
                    organizationId: decoded.organizationId || null,
                    role: decoded.role || "user"
                  };
                  this.setAuthCache(tokenCacheKey, fallbackUser);
                  return fallbackUser;
                }
              } catch (dbError) {
                log19.warn("[Auth] JWT DB query failed:", dbError.message);
                const degradedUser = {
                  id: decoded.userId,
                  openId: `local_${decoded.userId}`,
                  name: decoded.name || "User",
                  email: decoded.username || "",
                  loginMethod: "local",
                  lastSignedIn: (/* @__PURE__ */ new Date()).toISOString(),
                  // v452.9: 降级时不能默认为内部组织(1)，防止外部租户获得系统管理员权限
                  organizationId: decoded.organizationId || null,
                  role: decoded.role || "user"
                };
                this.setAuthCache(tokenCacheKey, degradedUser);
                return degradedUser;
              }
            }
          } catch (jwtError) {
            const jwtErrMsg = jwtError?.message || String(jwtError);
            const jwtErrName = jwtError?.name || "unknown";
            logSystem("Auth", `JWT verify FAILED: name=${jwtErrName}, message=${jwtErrMsg}`);
            log19.warn(`[Auth] JWT verification failed: name=${jwtErrName}, msg=${jwtErrMsg}`);
            return null;
          }
        }
        const cookies = this.parseCookies(req.headers.cookie);
        const sessionCookie = cookies.get(COOKIE_NAME);
        const session = await this.verifySession(sessionCookie);
        if (!session) {
          throw ForbiddenError("Invalid session cookie");
        }
        const sessionUserId = session.openId;
        const signedInAt = (/* @__PURE__ */ new Date()).toISOString();
        let user = await getUserByOpenId(sessionUserId);
        if (!user) {
          try {
            const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
            await upsertUser({
              openId: userInfo.openId,
              name: userInfo.name || null,
              email: userInfo.email ?? null,
              loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
              lastSignedIn: signedInAt
            });
            user = await getUserByOpenId(userInfo.openId);
          } catch (error48) {
            log19.warn("[Auth] Failed to sync user from OAuth:", error48);
            throw ForbiddenError("Failed to sync user info");
          }
        }
        if (!user) {
          throw ForbiddenError("User not found");
        }
        await upsertUser({
          openId: user.openId,
          lastSignedIn: signedInAt
        });
        return user;
      }
    };
    sdk = new SDKServer();
  }
});

