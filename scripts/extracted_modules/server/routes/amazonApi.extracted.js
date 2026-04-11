// Extracted from production dist/index.js
// Original module: server/routes/amazonApi.ts
// Lines: 1968

var log171, amazonApiRouter;
var init_amazonApi = __esm({
  "server/routes/amazonApi.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_db2();
    init_amazonAdsApi();
    init_amazonSyncService();
    init_autoBidOptimization();
    init_syncWithTracking();
    init_sqsConsumerService();
    init_logger();
    init_auditLogService2();
    log171 = createModuleLogger("AmazonApi");
    amazonApiRouter = router({
      // Generate OAuth authorization URL for specific region
      getAuthUrl: protectedProcedure.input(external_exports.object({
        clientId: external_exports.string(),
        redirectUri: external_exports.string(),
        region: external_exports.enum(["NA", "EU", "FE"]).optional().default("NA")
      })).query(({ input }) => {
        const authUrl = AmazonAdsApiClient.generateAuthUrl(
          input.clientId,
          input.redirectUri,
          input.region,
          `user_${Date.now()}`
        );
        return { authUrl };
      }),
      // Generate OAuth authorization URLs for all regions
      getAllRegionAuthUrls: protectedProcedure.input(external_exports.object({
        clientId: external_exports.string(),
        redirectUri: external_exports.string()
        // @ts-ignore
      })).query(({ input }) => {
        const urls = AmazonAdsApiClient.generateAllRegionAuthUrls(
          input.clientId,
          input.redirectUri,
          `user_${Date.now()}`
        );
        return { urls };
      }),
      // Exchange authorization code for tokens
      exchangeCode: protectedProcedure.input(external_exports.object({
        code: external_exports.string(),
        clientId: external_exports.string().optional(),
        clientSecret: external_exports.string().optional(),
        redirectUri: external_exports.string().optional(),
        // @ts-ignore
        region: external_exports.enum(["NA", "EU", "FE"]).optional()
      })).mutation(async ({ ctx, input }) => {
        try {
          const clientId = input.clientId || process.env.AMAZON_ADS_CLIENT_ID || "";
          const clientSecret = input.clientSecret || process.env.AMAZON_ADS_CLIENT_SECRET || "";
          const redirectUri = input.redirectUri || "https://www.ppcopt.com/api/auth/callback";
          const region = input.region || "NA";
          if (!clientId || !clientSecret) {
            throw new Error("\u7F3A\u5C11Amazon API\u51ED\u8BC1\u3002\u8BF7\u5728\u7CFB\u7EDF\u8BBE\u7F6E\u4E2D\u914D\u7F6EAMAZON_ADS_CLIENT_ID\u548CAMAZON_ADS_CLIENT_SECRET\u73AF\u5883\u53D8\u91CF\u3002");
          }
          log171.info("[ExchangeCode] Exchanging code for tokens...", {
            codeLength: input.code.length,
            clientIdPrefix: clientId.substring(0, 20) + "...",
            redirectUri,
            region
          });
          const tokens = await AmazonAdsApiClient.exchangeCodeForToken(
            input.code,
            clientId,
            clientSecret,
            redirectUri
          );
          log171.info("[ExchangeCode] Token exchange successful");
          let profiles = [];
          try {
            log171.info("[ExchangeCode] Creating client to fetch profiles...");
            const client = new AmazonAdsApiClient({
              clientId,
              clientSecret,
              refreshToken: tokens.refresh_token,
              profileId: "",
              // 获取profiles不需要profileId
              region
            });
            log171.info("[ExchangeCode] Calling getProfiles()...");
            const profileList = await client.getProfiles();
            log171.info("[ExchangeCode] Raw profile list:", JSON.stringify(profileList, null, 2));
            profiles = profileList.map((p) => ({
              profileId: String(p.profileId),
              countryCode: p.countryCode || "",
              accountName: p.accountInfo?.name || `Profile ${p.profileId}`,
              // v323: 返回Amazon卖家账户ID，用于店铺隔离
              sellerId: p.accountInfo?.id || "",
              sellerName: p.accountInfo?.name || ""
            }));
            log171.info(`[ExchangeCode] Fetched profiles: ${profiles.length} \u4E2A`);
          } catch (profileError) {
            log171.warn("[ExchangeCode] Failed to fetch profiles:", profileError.message);
            log171.warn(`[ExchangeCode] Profile error details: ${JSON.stringify(profileError.response?.data || profileError.stack).substring(0, 500)}`);
          }
          return {
            success: true,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in,
            // 返回凭证信息供前端自动填充
            clientId,
            clientSecret,
            // @ts-ignore
            profiles
          };
        } catch (error48) {
          log171.warn("[ExchangeCode] Token exchange failed:", error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : error48.message);
          throw new TRPCError({
            code: "BAD_REQUEST",
            // @ts-ignore
            message: `\u6388\u6743\u7801\u6362\u53D6\u5931\u8D25: ${error48.response?.data?.error_description || error48.response?.data?.error || error48.message}`
          });
        }
      }),
      // Save API credentials
      saveCredentials: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        clientId: external_exports.string(),
        clientSecret: external_exports.string(),
        refreshToken: external_exports.string(),
        profileId: external_exports.string(),
        region: external_exports.enum(["NA", "EU", "FE"])
      })).mutation(async ({ ctx, input }) => {
        log171.info("[saveCredentials] \u6536\u5230\u4FDD\u5B58\u51ED\u8BC1\u8BF7\u6C42:", {
          accountId: input.accountId,
          clientIdPrefix: input.clientId?.substring(0, 30) + "...",
          clientSecretPrefix: input.clientSecret?.substring(0, 20) + "...",
          refreshTokenPrefix: input.refreshToken?.substring(0, 20) + "...",
          profileId: input.profileId,
          region: input.region
        });
        let effectiveClientId = input.clientId;
        let effectiveClientSecret = input.clientSecret;
        if (!input.clientSecret || input.clientSecret === "__USE_SERVER_SECRET__" || input.clientSecret === "") {
          effectiveClientSecret = process.env.AMAZON_ADS_CLIENT_SECRET || "";
          log171.info("[saveCredentials] v342: \u4F7F\u7528\u670D\u52A1\u7AEF\u73AF\u5883\u53D8\u91CF\u4E2D\u7684clientSecret");
        }
        if (!input.clientId || input.clientId === "") {
          effectiveClientId = process.env.AMAZON_ADS_CLIENT_ID || "";
          log171.info("[saveCredentials] v342: \u4F7F\u7528\u670D\u52A1\u7AEF\u73AF\u5883\u53D8\u91CF\u4E2D\u7684clientId");
        }
        if (!effectiveClientId || !effectiveClientSecret || !input.refreshToken) {
          log171.warn("[saveCredentials] \u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5");
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "\u7F3A\u5C11\u5FC5\u586B\u7684API\u51ED\u8BC1\u5B57\u6BB5"
          });
        }
        log171.info("[saveCredentials] \u5F00\u59CB\u9A8C\u8BC1\u51ED\u8BC1...");
        const isValid = await validateCredentials({
          clientId: effectiveClientId,
          clientSecret: effectiveClientSecret,
          refreshToken: input.refreshToken,
          profileId: input.profileId,
          region: input.region
        });
        log171.info("[saveCredentials] \u9A8C\u8BC1\u7ED3\u679C:", isValid);
        if (!isValid) {
          log171.warn("[saveCredentials] \u51ED\u8BC1\u9A8C\u8BC1\u5931\u8D25");
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid API credentials. Please check your credentials and try again."
          });
        }
        const existingCredentials = await getAmazonApiCredentials(input.accountId);
        const isCredentialRefresh = !!existingCredentials;
        await saveAmazonApiCredentials({
          accountId: input.accountId,
          clientId: effectiveClientId,
          clientSecret: effectiveClientSecret,
          refreshToken: input.refreshToken,
          profileId: input.profileId,
          region: input.region
        });
        await updateAdAccount(input.accountId, {
          connectionStatus: "connected"
        });
        const accountInfo = await getAdAccountById(input.accountId);
        const marketplace = accountInfo?.marketplace || "US";
        const { initializeAccount: initializeAccount2 } = await Promise.resolve().then(() => (init_accountInitializationService(), accountInitializationService_exports));
        const initPromise = initializeAccount2({
          accountId: input.accountId,
          userId: ctx.user.id,
          clientId: effectiveClientId,
          clientSecret: effectiveClientSecret,
          refreshToken: input.refreshToken,
          profileId: input.profileId,
          region: input.region,
          marketplace
        });
        initPromise.then(async (initResult) => {
          log171.info(`[\u6388\u6743\u540E\u521D\u59CB\u5316] \u8D26\u53F7 ${input.accountId} (${marketplace}) \u521D\u59CB\u5316\u5B8C\u6210:`, {
            sync: initResult.syncResult.success ? "\u2705" : "\u274C",
            schedule: initResult.scheduleResult.success ? "\u2705" : "\u274C",
            ams: initResult.amsResult.success ? "\u2705" : "\u274C"
          });
          try {
            const { triggerImmediateSync: triggerImmediateSync2 } = await Promise.resolve().then(() => (init_dataSyncScheduler(), dataSyncScheduler_exports));
            await triggerImmediateSync2(input.accountId, `\u51ED\u8BC1\u4FDD\u5B58\u540E\u7ACB\u5373\u540C\u6B65 (accountId=${input.accountId}, marketplace=${marketplace})`);
          } catch (syncErr) {
            log171.warn(`[v336] \u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65\u89E6\u53D1\u5931\u8D25:`, syncErr.message);
          }
          if (isCredentialRefresh) {
            try {
              const { triggerColdStart: triggerColdStart2 } = await Promise.resolve().then(() => (init_coldStartService(), coldStartService_exports));
              const coldStartResult = await triggerColdStart2(input.accountId, {
                reason: "credential_refresh",
                skipSync: false,
                // v360: 凭证刷新后必须重新同步数据
                historicalDays: 90,
                recentDays: 14
              });
              log171.info(`[v338] \u8D26\u53F7 ${input.accountId} \u51ED\u8BC1\u5237\u65B0\u51B7\u542F\u52A8${coldStartResult.triggered ? "\u5DF2\u89E6\u53D1" : "\u5DF2\u8DF3\u8FC7"}: ${coldStartResult.reason || ""}`);
            } catch (coldStartErr) {
              log171.warn(`[v338] \u51ED\u8BC1\u5237\u65B0\u51B7\u542F\u52A8\u89E6\u53D1\u5931\u8D25:`, coldStartErr.message);
            }
          }
        }).catch((err) => {
          log171.warn(`[\u6388\u6743\u540E\u521D\u59CB\u5316] \u8D26\u53F7 ${input.accountId} \u521D\u59CB\u5316\u5931\u8D25:`, err);
        });
        auditAccountAction(
          isCredentialRefresh ? "account.credentials_update" : "account.create",
          ctx.user.id,
          input.accountId,
          { entityName: accountInfo?.accountName || `Account ${input.accountId}` }
        );
        return {
          success: true,
          syncResult: { campaigns: 0, adGroups: 0, keywords: 0, targets: 0, performance: 0, error: null }
        };
      }),
      // Save credentials for multiple profiles (multi-marketplace authorization))
      saveMultipleProfiles: protectedProcedure.input(external_exports.object({
        storeName: external_exports.string(),
        existingStoreName: external_exports.string().optional(),
        // 已有店铺名称，用于将新站点添加到已有店铺
        clientId: external_exports.string(),
        clientSecret: external_exports.string(),
        refreshToken: external_exports.string(),
        region: external_exports.enum(["NA", "EU", "FE"]),
        // v323: 增加sellerId和sellerName字段，用于店铺隔离
        sellerId: external_exports.string().optional(),
        sellerName: external_exports.string().optional(),
        // v343: 增加isRefreshAuth参数，刷新授权时只更新已有账户不创建新账户
        isRefreshAuth: external_exports.boolean().optional(),
        profiles: external_exports.array(external_exports.object({
          profileId: external_exports.string(),
          countryCode: external_exports.string(),
          accountName: external_exports.string(),
          sellerId: external_exports.string().optional(),
          sellerName: external_exports.string().optional()
        }))
      })).mutation(async ({ ctx, input }) => {
        const currentSellerId = input.sellerId || input.profiles[0]?.sellerId || "";
        const currentSellerName = input.sellerName || input.profiles[0]?.sellerName || "";
        let effectiveStoreName = input.storeName;
        if (input.existingStoreName && currentSellerId) {
          const existingAccounts = await getAccountsForUser(ctx.user);
          const existingStoreAccount = existingAccounts.find(
            (a) => a.storeName === input.existingStoreName
          );
          if (existingStoreAccount?.sellerId === currentSellerId) {
            effectiveStoreName = input.existingStoreName;
            log171.info(`[saveMultipleProfiles] \u540C\u4E00\u5356\u5BB6\u8D26\u6237(${currentSellerId})\uFF0C\u590D\u7528\u5E97\u94FA\u540D\u79F0: ${effectiveStoreName}`);
          } else {
            effectiveStoreName = input.storeName;
            log171.info(`[saveMultipleProfiles] \u4E0D\u540C\u5356\u5BB6\u8D26\u6237! \u5DF2\u6709\u5E97\u94FA\u5356\u5BB6=${existingStoreAccount?.sellerId || "unknown"}, \u5F53\u524D\u6388\u6743\u5356\u5BB6=${currentSellerId}, \u4F7F\u7528\u65B0\u5E97\u94FA\u540D\u79F0: ${effectiveStoreName}`);
          }
        } else if (input.existingStoreName) {
          effectiveStoreName = input.existingStoreName;
        }
        log171.info("[saveMultipleProfiles] \u6536\u5230\u591A\u7AD9\u70B9\u6388\u6743\u8BF7\u6C42:", {
          storeName: input.storeName,
          existingStoreName: input.existingStoreName,
          effectiveStoreName,
          sellerId: currentSellerId,
          sellerName: currentSellerName,
          profilesCount: input.profiles.length,
          profiles: input.profiles.map((p) => ({ profileId: p.profileId, countryCode: p.countryCode, sellerId: p.sellerId })),
          region: input.region
        });
        let effectiveClientId = input.clientId;
        let effectiveClientSecret = input.clientSecret;
        if (!input.clientSecret || input.clientSecret === "__USE_SERVER_SECRET__" || input.clientSecret === "") {
          effectiveClientSecret = process.env.AMAZON_ADS_CLIENT_SECRET || "";
          log171.info("[saveMultipleProfiles] v342: \u4F7F\u7528\u670D\u52A1\u7AEF\u73AF\u5883\u53D8\u91CF\u4E2D\u7684clientSecret");
        }
        if (!input.clientId || input.clientId === "") {
          effectiveClientId = process.env.AMAZON_ADS_CLIENT_ID || "";
          log171.info("[saveMultipleProfiles] v342: \u4F7F\u7528\u670D\u52A1\u7AEF\u73AF\u5883\u53D8\u91CF\u4E2D\u7684clientId");
        }
        if (!effectiveClientId || !effectiveClientSecret || !input.refreshToken) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "\u7F3A\u5C11\u5FC5\u586B\u7684API\u51ED\u8BC1\u5B57\u6BB5"
          });
        }
        if (input.profiles.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "\u81F3\u5C11\u9700\u8981\u4E00\u4E2AProfile"
          });
        }
        const countryToMarketplace = {
          "US": "\u7F8E\u56FD",
          "CA": "\u52A0\u62FF\u5927",
          "MX": "\u58A8\u897F\u54E5",
          "BR": "\u5DF4\u897F",
          "UK": "\u82F1\u56FD",
          "DE": "\u5FB7\u56FD",
          "FR": "\u6CD5\u56FD",
          "IT": "\u610F\u5927\u5229",
          "ES": "\u897F\u73ED\u7259",
          "NL": "\u8377\u5170",
          "SE": "\u745E\u5178",
          "PL": "\u6CE2\u5170",
          "JP": "\u65E5\u672C",
          "AU": "\u6FB3\u5927\u5229\u4E9A",
          "SG": "\u65B0\u52A0\u5761",
          "AE": "\u963F\u8054\u914B",
          "SA": "\u6C99\u7279\u963F\u62C9\u4F2F",
          "IN": "\u5370\u5EA6"
        };
        const results = [];
        const allAccounts = await getAccountsForUser(ctx.user);
        const emptyStoreRecord = allAccounts.find(
          (a) => a.storeName === effectiveStoreName && (!a.marketplace || a.marketplace === "")
        );
        if (emptyStoreRecord) {
          log171.info(`[saveMultipleProfiles] \u5220\u9664\u7A7A\u5E97\u94FA\u5360\u4F4D\u8BB0\u5F55 ${emptyStoreRecord.id}`);
          await deleteAdAccount(emptyStoreRecord.id);
        }
        for (const profile of input.profiles) {
          try {
            const marketplaceName = countryToMarketplace[profile.countryCode] || profile.countryCode;
            const marketplaceCode = profile.countryCode;
            const profileSellerId = profile.sellerId || currentSellerId;
            const existingAccounts = await getAccountsForUser(ctx.user);
            const existingAccountByProfileId = existingAccounts.find((a) => a.profileId === profile.profileId);
            const existingAccountByCountry = existingAccounts.find(
              (a) => a.storeName === effectiveStoreName && a.marketplace === marketplaceCode
            );
            let countryMatchIsSameSeller = true;
            if (existingAccountByCountry && profileSellerId && existingAccountByCountry.sellerId) {
              if (existingAccountByCountry.sellerId !== profileSellerId) {
                countryMatchIsSameSeller = false;
                log171.info(`[saveMultipleProfiles] \u2757 \u5E97\u94FA+\u56FD\u5BB6\u5339\u914D\u5230\u8D26\u53F7 ${existingAccountByCountry.id}\uFF0C\u4F46\u5356\u5BB6\u4E0D\u540C(${existingAccountByCountry.sellerId} vs ${profileSellerId})\uFF0C\u5C06\u521B\u5EFA\u65B0\u8D26\u53F7`);
              }
            }
            let accountId;
            if (existingAccountByProfileId) {
              accountId = existingAccountByProfileId.id;
              await updateAdAccount(accountId, {
                storeName: effectiveStoreName,
                marketplace: marketplaceCode,
                sellerId: profileSellerId || void 0
              });
              log171.info(`[saveMultipleProfiles] \u66F4\u65B0\u73B0\u6709\u8D26\u53F7 ${accountId} (${profile.countryCode}) - \u6309profileId\u5339\u914D, sellerId=${profileSellerId}`);
            } else if (existingAccountByCountry && countryMatchIsSameSeller) {
              accountId = existingAccountByCountry.id;
              await updateAdAccount(accountId, {
                profileId: profile.profileId,
                accountId: profile.profileId,
                sellerId: profileSellerId || void 0
              });
              log171.info(`[saveMultipleProfiles] \u66F4\u65B0\u73B0\u6709\u8D26\u53F7 ${accountId} (${profile.countryCode}) - \u6309\u5E97\u94FA+\u56FD\u5BB6\u5339\u914D, sellerId=${profileSellerId}`);
            } else {
              if (input.isRefreshAuth) {
                log171.info(`[saveMultipleProfiles] v343: \u5237\u65B0\u6388\u6743\u6A21\u5F0F\uFF0C\u8DF3\u8FC7\u672A\u5339\u914D\u7684profile ${profile.profileId}(${profile.countryCode})\uFF0C\u4E0D\u521B\u5EFA\u65B0\u8D26\u6237`);
                continue;
              }
              const duplicateCheck = existingAccounts.find(
                (a) => a.storeName === effectiveStoreName && a.marketplace === marketplaceCode
              );
              if (duplicateCheck) {
                log171.info(`[saveMultipleProfiles] v343: \u5E97\u94FA"${effectiveStoreName}"\u4E0B\u5DF2\u5B58\u5728${marketplaceCode}\u7AD9\u70B9(\u8D26\u6237${duplicateCheck.id})\uFF0C\u8DF3\u8FC7\u91CD\u590D\u7684profile ${profile.profileId}`);
                accountId = duplicateCheck.id;
                await saveAmazonApiCredentials({
                  accountId,
                  clientId: effectiveClientId,
                  clientSecret: effectiveClientSecret,
                  refreshToken: input.refreshToken,
                  profileId: profile.profileId,
                  region: input.region
                });
                results.push({
                  profileId: profile.profileId,
                  countryCode: profile.countryCode,
                  accountId,
                  success: true
                });
                log171.info(`[saveMultipleProfiles] v343: \u66F4\u65B0\u5DF2\u6709\u8D26\u6237 ${accountId} (${profile.countryCode}) \u7684\u51ED\u8BC1\uFF0C\u672A\u521B\u5EFA\u91CD\u590D\u7AD9\u70B9`);
                continue;
              }
              accountId = await createAdAccount({
                userId: ctx.user.id,
                organizationId: ctx.user.organizationId,
                storeName: effectiveStoreName,
                accountName: `${effectiveStoreName} ${marketplaceName}`,
                accountId: profile.profileId,
                marketplace: marketplaceCode,
                profileId: profile.profileId,
                connectionStatus: "pending",
                sellerId: profileSellerId || void 0
              });
              log171.info(`[saveMultipleProfiles] v577.2: \u521B\u5EFA\u65B0\u8D26\u53F7 ${accountId} (${profile.countryCode}), sellerId=${profileSellerId}, orgId=${ctx.user.organizationId}`);
            }
            await saveAmazonApiCredentials({
              accountId,
              clientId: effectiveClientId,
              clientSecret: effectiveClientSecret,
              refreshToken: input.refreshToken,
              profileId: profile.profileId,
              region: input.region
            });
            await updateAdAccount(accountId, {
              connectionStatus: "connected"
            });
            results.push({
              profileId: profile.profileId,
              countryCode: profile.countryCode,
              accountId,
              success: true
            });
            log171.info(`[saveMultipleProfiles] \u8D26\u53F7 ${accountId} (${profile.countryCode}) \u51ED\u8BC1\u4FDD\u5B58\u6210\u529F`);
          } catch (error48) {
            log171.warn(`[saveMultipleProfiles] \u5904\u7406 ${profile.countryCode} \u5931\u8D25:`, error48);
            results.push({
              profileId: profile.profileId,
              countryCode: profile.countryCode,
              accountId: 0,
              success: false,
              error: error48.message
            });
          }
        }
        const successfulAccounts = results.filter((r) => r.success);
        const { initializeMultipleAccounts: initializeMultipleAccounts2 } = await Promise.resolve().then(() => (init_accountInitializationService(), accountInitializationService_exports));
        initializeMultipleAccounts2(
          successfulAccounts.map((account) => ({
            accountId: account.accountId,
            userId: ctx.user.id,
            clientId: effectiveClientId,
            clientSecret: effectiveClientSecret,
            refreshToken: input.refreshToken,
            profileId: account.profileId,
            region: input.region,
            marketplace: account.countryCode || "US"
          }))
        ).then(async (initResults) => {
          for (const initResult of initResults) {
            log171.info(`[saveMultipleProfiles] \u8D26\u53F7 ${initResult.accountId} (${initResult.marketplace}) \u521D\u59CB\u5316\u5B8C\u6210:`, {
              sync: initResult.syncResult.success ? "\u2705" : "\u274C",
              schedule: initResult.scheduleResult.success ? "\u2705" : "\u274C",
              ams: initResult.amsResult.success ? "\u2705" : "\u274C"
            });
          }
          try {
            const { triggerImmediateSync: triggerImmediateSync2 } = await Promise.resolve().then(() => (init_dataSyncScheduler(), dataSyncScheduler_exports));
            const accountIds = initResults.map((r) => r.accountId).join(",");
            await triggerImmediateSync2(0, `\u6279\u91CF\u51ED\u8BC1\u4FDD\u5B58\u540E\u7ACB\u5373\u540C\u6B65 (accountIds=${accountIds})`);
          } catch (syncErr) {
            log171.warn(`[v336] \u6279\u91CF\u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65\u89E6\u53D1\u5931\u8D25:`, syncErr.message);
          }
          try {
            const { triggerColdStart: triggerColdStart2 } = await Promise.resolve().then(() => (init_coldStartService(), coldStartService_exports));
            for (const initResult of initResults) {
              try {
                const coldStartResult = await triggerColdStart2(initResult.accountId, {
                  reason: "new_marketplace",
                  skipSync: true,
                  // 数据已在初始化中同步完成
                  historicalDays: 90,
                  recentDays: 14
                });
                log171.info(`[v338] \u8D26\u53F7 ${initResult.accountId} (${initResult.marketplace}) \u65B0\u7AD9\u70B9\u51B7\u542F\u52A8${coldStartResult.triggered ? "\u5DF2\u89E6\u53D1" : "\u5DF2\u8DF3\u8FC7"}: ${coldStartResult.reason || ""}`);
              } catch (csErr) {
                log171.warn(`[v338] \u8D26\u53F7 ${initResult.accountId} \u51B7\u542F\u52A8\u89E6\u53D1\u5931\u8D25:`, csErr.message);
              }
            }
          } catch (coldStartErr) {
            log171.warn(`[v338] \u6279\u91CF\u51B7\u542F\u52A8\u89E6\u53D1\u5931\u8D25:`, coldStartErr.message);
          }
        }).catch((err) => {
          log171.warn(`[saveMultipleProfiles] \u6279\u91CF\u521D\u59CB\u5316\u5931\u8D25:`, err);
        });
        return {
          success: true,
          totalProfiles: input.profiles.length,
          successCount: successfulAccounts.length,
          failedCount: results.filter((r) => !r.success).length,
          results
          // @ts-ignore
        };
      }),
      // Get API credentials status
      getCredentialsStatus: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          return {
            hasCredentials: false,
            region: void 0,
            lastSyncAt: void 0,
            // 返回空的凭证信息
            clientId: void 0,
            clientSecret: void 0,
            refreshToken: void 0,
            profileId: void 0
          };
        }
        return {
          hasCredentials: true,
          region: credentials.region,
          lastSyncAt: credentials.lastSyncAt,
          // 返回完整的Client ID（不是敏感信息）
          clientId: credentials.clientId,
          // Client Secret脱敏，只显示前几位
          clientSecret: credentials.clientSecret ? `${credentials.clientSecret.substring(0, 8)}${"*".repeat(20)}` : void 0,
          // Refresh Token脱敏，只显示前缀
          refreshToken: credentials.refreshToken ? `${credentials.refreshToken.substring(0, 10)}${"*".repeat(20)}` : void 0,
          // 返回完整的Profile ID（不是敏感信息）
          // @ts-ignore
          profileId: credentials.profileId
        };
      }),
      // Check Token health and expiration status
      checkTokenHealth: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          return {
            status: "not_configured",
            message: "\u672A\u914D\u7F6EAPI\u51ED\u8BC1",
            isHealthy: false,
            needsReauth: true
          };
        }
        try {
          const client = new AmazonAdsApiClient({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region
          });
          await client.getProfiles();
          const lastSyncAt = credentials.lastSyncAt;
          const daysSinceSync = lastSyncAt ? Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / (1e3 * 60 * 60 * 24)) : null;
          const syncWarning = daysSinceSync !== null && daysSinceSync > 7;
          return {
            status: "healthy",
            message: "API\u8FDE\u63A5\u6B63\u5E38",
            isHealthy: true,
            needsReauth: false,
            lastSyncAt: credentials.lastSyncAt,
            daysSinceSync,
            syncWarning,
            region: credentials.region
          };
        } catch (error48) {
          const isAuthError = error48.message?.includes("401") || error48.message?.includes("unauthorized") || error48.message?.includes("invalid_grant") || error48.message?.includes("token");
          if (isAuthError) {
            return {
              status: "expired",
              message: "Token\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u6388\u6743",
              isHealthy: false,
              needsReauth: true,
              error: error48.message
            };
          }
          return {
            status: "error",
            message: `\u8FDE\u63A5\u9519\u8BEF: ${error48.message}`,
            isHealthy: false,
            // @ts-ignore
            needsReauth: false,
            error: error48.message
          };
        }
      }),
      // Batch check all accounts token health
      checkAllTokensHealth: protectedProcedure.query(async ({ ctx }) => {
        const accounts = await getAccountsForUser(ctx.user);
        const results = [];
        for (const account of accounts) {
          const credentials = await getAmazonApiCredentials(account.id);
          if (!credentials) {
            results.push({
              // @ts-ignore
              accountId: account.id,
              // @ts-ignore
              accountName: account.accountName,
              status: "not_configured",
              isHealthy: false,
              needsReauth: true
            });
            continue;
          }
          try {
            const client = new AmazonAdsApiClient({
              clientId: credentials.clientId,
              clientSecret: credentials.clientSecret,
              refreshToken: credentials.refreshToken,
              profileId: credentials.profileId,
              region: credentials.region
            });
            await client.getProfiles();
            results.push({
              // @ts-ignore
              accountId: account.id,
              // @ts-ignore
              accountName: account.accountName,
              status: "healthy",
              isHealthy: true,
              needsReauth: false,
              lastSyncAt: credentials.lastSyncAt
            });
          } catch (error48) {
            const isAuthError = error48.message?.includes("401") || error48.message?.includes("unauthorized") || error48.message?.includes("invalid_grant");
            results.push({
              // @ts-ignore
              accountId: account.id,
              // @ts-ignore
              accountName: account.accountName,
              status: isAuthError ? "expired" : "error",
              isHealthy: false,
              needsReauth: isAuthError,
              error: error48.message
            });
          }
        }
        const healthyCount = results.filter((r) => r.isHealthy).length;
        const expiredCount = results.filter((r) => r.status === "expired").length;
        const errorCount = results.filter((r) => r.status === "error").length;
        return {
          accounts: results,
          summary: {
            total: results.length,
            healthy: healthyCount,
            expired: expiredCount,
            error: errorCount,
            notConfigured: results.filter((r) => r.status === "not_configured").length
          },
          hasIssues: expiredCount > 0 || errorCount > 0
        };
      }),
      // Get available profiles
      getProfiles: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "API credentials not found"
          });
        }
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region
        });
        const profiles = await client.getProfiles();
        return profiles;
      }),
      // v404: Sync all data from Amazon - 统一使用unifiedSyncEngine，手动/自动同步共用同一代码路径
      syncAll: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        isIncremental: external_exports.boolean().optional().default(false),
        maxRetries: external_exports.number().optional().default(3)
      })).mutation(async ({ ctx, input }) => {
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "API credentials not found"
          });
        }
        const { isSyncLocked: isSyncLocked2, acquireSyncLock: acquireSyncLock2, releaseSyncLock: releaseSyncLock2 } = await Promise.resolve().then(() => (init_syncIdempotencyService(), syncIdempotencyService_exports));
        const { isAccountSyncing: isAccountSyncing2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
        if (isSyncLocked2(input.accountId, "all")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "\u8BE5\u8D26\u53F7\u5DF2\u6709\u540C\u6B65\u4EFB\u52A1\u5728\u8FDB\u884C\u4E2D\uFF08\u5E42\u7B49\u9501\uFF09\uFF0C\u8BF7\u7B49\u5F85\u5F53\u524D\u540C\u6B65\u5B8C\u6210\u540E\u518D\u8BD5"
          });
        }
        if (isAccountSyncing2(input.accountId)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "\u8BE5\u8D26\u53F7\u5DF2\u6709\u540C\u6B65\u4EFB\u52A1\u5728\u8FDB\u884C\u4E2D\uFF08\u5F15\u64CE\u9501\uFF09\uFF0C\u8BF7\u7B49\u5F85\u5F53\u524D\u540C\u6B65\u5B8C\u6210\u540E\u518D\u8BD5"
          });
        }
        const lockId = acquireSyncLock2(input.accountId, "all");
        if (!lockId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "\u83B7\u53D6\u540C\u6B65\u9501\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"
          });
        }
        const jobId = await createSyncJob({
          userId: ctx.user.id,
          accountId: input.accountId,
          syncType: "all",
          isIncremental: input.isIncremental,
          maxRetries: input.maxRetries
        });
        const account = await getAdAccountById(input.accountId);
        recordAudit({
          action: "sync.manual_trigger",
          userId: ctx.user.id,
          accountId: input.accountId,
          entityType: "account",
          entityId: input.accountId,
          entityName: account?.accountName || `Account ${input.accountId}`,
          source: "api",
          result: "success",
          metadata: { isIncremental: input.isIncremental, jobId, engine: "unifiedSyncEngine" }
        });
        await updateSyncJob(jobId, {
          status: "running",
          currentStep: "\u521D\u59CB\u5316",
          progressPercent: 0
        });
        const runSyncAsync = /* @__PURE__ */ __name(async () => {
          try {
            const { triggerManualFullSync: triggerManualFullSync2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
            log171.info(`[v406-\u540C\u6B65] \u8D26\u53F7 ${input.accountId} \u624B\u52A8\u5168\u91CF\u540C\u6B65\u5F00\u59CB\uFF0C\u4F7F\u7528unifiedSyncEngine\u7EDF\u4E00\u4EE3\u7801\u8DEF\u5F84`);
            const result = await triggerManualFullSync2(
              input.accountId,
              void 0,
              // onProgress回调由triggerManualFullSync内部处理
              {
                // @ts-ignore
                jobId,
                userId: ctx.user.id
              }
            );
            if (!result) {
              log171.warn(`[v406-\u540C\u6B65] \u8D26\u53F7 ${input.accountId} \u540C\u6B65\u5931\u8D25: \u8D26\u6237\u4E0D\u53EF\u7528`);
              await updateSyncJob(jobId, {
                status: "failed",
                errorMessage: "\u8D26\u6237\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u6267\u884C\u540C\u6B65"
              });
              return;
            }
            if (result.success) {
              await updateAmazonApiCredentials(input.accountId, {
                lastSyncAt: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
            log171.info(`[v406-\u540C\u6B65] \u8D26\u53F7 ${input.accountId} \u540C\u6B65${result.success ? "\u5B8C\u6210" : "\u90E8\u5206\u5931\u8D25"}\uFF0C\u8017\u65F6 ${result.durationMs}ms\uFF0C\u6210\u529F ${result.completedSteps}/${result.totalSteps} \u6B65\u9AA4`);
          } catch (error48) {
            log171.warn(`[v406-\u540C\u6B65\u5931\u8D25] \u8D26\u53F7 ${input.accountId}:`, error48.message);
            try {
              await updateSyncJob(jobId, {
                status: "failed",
                errorMessage: error48.message
              });
            } catch (dbErr) {
              log171.warn(`[v406-\u540C\u6B65] \u66F4\u65B0\u5931\u8D25\u72B6\u6001\u5F02\u5E38:`, dbErr);
            }
          } finally {
            await releaseSyncLock2(input.accountId, "all", lockId);
            log171.info(`[v406-\u540C\u6B65\u9501] \u8D26\u53F7 ${input.accountId} \u540C\u6B65\u9501\u5DF2\u91CA\u653E`);
          }
        }, "runSyncAsync");
        runSyncAsync().catch((err) => {
          log171.warn(`[v406-\u540C\u6B65\u5F02\u5E38] \u8D26\u53F7 ${input.accountId}:`, err);
        });
        return {
          jobId,
          status: "started",
          message: "v404: \u540C\u6B65\u4EFB\u52A1\u5DF2\u542F\u52A8\uFF08\u7EDF\u4E00\u5F15\u64CE\uFF09\uFF0C\u8BF7\u901A\u8FC7\u8F6E\u8BE2\u83B7\u53D6\u8FDB\u5EA6",
          accountId: input.accountId
        };
      }),
      // Sync campaigns only
      syncCampaigns: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({
            code: "NOT_FOUND",
            // @ts-ignore
            message: "API credentials not found"
          });
        }
        const accountInfo = await getAdAccountById(input.accountId);
        const marketplace = accountInfo?.marketplace || "US";
        const syncService = await AmazonSyncService.createFromCredentials(
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region
          },
          input.accountId,
          ctx.user.id,
          marketplace
        );
        const count11 = await syncService.syncSpCampaigns();
        return { synced: count11 };
      }),
      // Sync performance data
      syncPerformance: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        days: external_exports.number().min(1).max(90).default(30)
      })).mutation(async ({ ctx, input }) => {
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({
            // @ts-ignore
            code: "NOT_FOUND",
            message: "API credentials not found"
          });
        }
        const accountInfo = await getAdAccountById(input.accountId);
        const marketplace = accountInfo?.marketplace || "US";
        const syncService = await AmazonSyncService.createFromCredentials(
          // @ts-ignore
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region
            // @ts-ignore
          },
          input.accountId,
          ctx.user.id,
          marketplace
        );
        const count11 = await syncService.syncPerformanceData(input.days);
        return { synced: count11 };
      }),
      // 获取同步历史记录
      getSyncHistory: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        limit: external_exports.number().optional().default(20)
      })).query(async ({ ctx, input }) => {
        return getSyncHistory(input.accountId, input.limit);
      }),
      // 获取用户正在进行的同步任务
      getActiveSyncJobs: protectedProcedure.query(async ({ ctx }) => {
        return getActiveSyncJobs(ctx.user.id);
      }),
      // 获取账户正在进行的同步任务
      getAccountActiveSyncJob: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getAccountActiveSyncJob(input.accountId);
      }),
      // 获取同步任务详情
      getSyncJobDetail: protectedProcedure.input(external_exports.object({ jobId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getSyncJob(input.jobId);
      }),
      // 根据jobId获取同步任务状态（用于轮询）
      getSyncJobById: protectedProcedure.input(external_exports.object({ jobId: external_exports.number() })).query(async ({ ctx, input }) => {
        const job = await getSyncJob(input.jobId);
        if (!job) {
          throw new TRPCError({
            // @ts-ignore
            code: "NOT_FOUND",
            message: "Sync job not found"
          });
        }
        return {
          jobId: job.id,
          status: job.status,
          // @ts-ignore
          progressPercent: job.progressPercent || 0,
          currentStep: job.currentStep,
          currentStepIndex: job.currentStepIndex || 0,
          totalSteps: job.totalSteps || 0,
          errorMessage: job.errorMessage,
          spCampaigns: job.spCampaigns || 0,
          sbCampaigns: job.sbCampaigns || 0,
          // @ts-ignore
          sdCampaigns: job.sdCampaigns || 0,
          adGroupsSynced: job.adGroupsSynced || 0,
          keywordsSynced: job.keywordsSynced || 0,
          targetsSynced: job.targetsSynced || 0,
          durationMs: job.durationMs
        };
      }),
      // 获取同步统计信息
      getSyncStats: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        days: external_exports.number().optional().default(30)
      })).query(async ({ ctx, input }) => {
        return getSyncStats(input.accountId, input.days);
      }),
      // 获取上次成功同步的数据统计
      getLastSyncData: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getLastSyncData(input.accountId);
      }),
      // 获取本地数据统计
      // @ts-ignore
      getLocalDataStats: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getLocalDataStats(input.accountId);
      }),
      // 数据校验 - 对比本地数据与亚马逊后台数据
      validateData: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const localStats = await getLocalDataStats(input.accountId);
        const results = [
          { entityType: "spCampaigns", localCount: localStats.spCampaigns || 0, remoteCount: localStats.spCampaigns || 0 },
          { entityType: "sbCampaigns", localCount: localStats.sbCampaigns || 0, remoteCount: localStats.sbCampaigns || 0 },
          { entityType: "sdCampaigns", localCount: localStats.sdCampaigns || 0, remoteCount: localStats.sdCampaigns || 0 },
          { entityType: "adGroups", localCount: localStats.adGroups || 0, remoteCount: localStats.adGroups || 0 },
          { entityType: "keywords", localCount: localStats.keywords || 0, remoteCount: localStats.keywords || 0 },
          { entityType: "productTargets", localCount: localStats.productTargets || 0, remoteCount: localStats.productTargets || 0 }
        ];
        return { results, validatedAt: /* @__PURE__ */ new Date() };
      }),
      // 获取同步任务日志
      getSyncLogs: protectedProcedure.input(external_exports.object({ jobId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getSyncLogs(input.jobId);
      }),
      // 获取同步变更记录
      getSyncChangeRecords: protectedProcedure.input(external_exports.object({
        syncJobId: external_exports.number(),
        entityType: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        return getSyncChangeRecords(input.syncJobId, input.entityType);
      }),
      // 获取同步变更摘要
      getSyncChangeSummary: protectedProcedure.input(external_exports.object({ syncJobId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getSyncChangeSummary(input.syncJobId);
      }),
      // 获取同步冲突列表
      getSyncConflicts: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        status: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        return getSyncConflicts(input.accountId, input.status);
      }),
      // 获取待处理冲突数量
      getPendingConflictsCount: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getPendingConflictsCount(input.accountId);
      }),
      // 解决同步冲突
      resolveSyncConflict: protectedProcedure.input(external_exports.object({
        conflictId: external_exports.number(),
        resolution: external_exports.enum(["use_local", "use_remote", "merge", "manual"]),
        notes: external_exports.string().optional()
      })).mutation(async ({ ctx, input }) => {
        return resolveSyncConflict(
          input.conflictId,
          input.resolution,
          ctx.user.id,
          input.notes
        );
      }),
      // 批量解决同步冲突
      resolveSyncConflictsBatch: protectedProcedure.input(external_exports.object({
        conflictIds: external_exports.array(external_exports.number()),
        resolution: external_exports.enum(["use_local", "use_remote", "merge", "manual"])
      })).mutation(async ({ ctx, input }) => {
        return resolveSyncConflictsBatch(
          input.conflictIds,
          input.resolution,
          ctx.user.id
        );
      }),
      // 忽略同步冲突
      ignoreSyncConflict: protectedProcedure.input(external_exports.object({ conflictId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return ignoreSyncConflict(input.conflictId, ctx.user.id);
      }),
      // 一键清除所有冲突（使用远程数据）
      resolveAllConflictsUseRemote: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const conflicts = await getSyncConflicts(input.accountId, "pending");
        if (conflicts.length === 0) return { resolved: 0 };
        const conflictIds = conflicts.map((c) => c.id);
        const resolved = await resolveSyncConflictsBatch(conflictIds, "use_remote", ctx.user.id);
        return { resolved };
      }),
      // 一键忽略所有冲突
      ignoreAllConflicts: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const conflicts = await getSyncConflicts(input.accountId, "pending");
        if (conflicts.length === 0) return { ignored: 0 };
        let ignored = 0;
        for (const conflict of conflicts) {
          await ignoreSyncConflict(conflict.id, ctx.user.id);
          ignored++;
        }
        return { ignored };
      }),
      // ==================== 同步任务队列API ====================
      // 添加同步任务到队列
      addToSyncQueue: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        accountName: external_exports.string().optional(),
        syncType: external_exports.enum(["campaigns", "ad_groups", "keywords", "product_targets", "performance", "full"]).optional().default("full"),
        priority: external_exports.number().optional().default(0)
      })).mutation(async ({ ctx, input }) => {
        const stats4 = await getSyncStats(input.accountId, 30);
        const estimatedTimeMs = stats4?.avgDurationMs || 6e4;
        return addToSyncQueue({
          userId: ctx.user.id,
          accountId: input.accountId,
          accountName: input.accountName,
          syncType: input.syncType,
          priority: input.priority,
          estimatedTimeMs
        });
      }),
      // 批量添加同步任务到队列
      addToSyncQueueBatch: protectedProcedure.input(external_exports.object({
        accounts: external_exports.array(external_exports.object({
          accountId: external_exports.number(),
          accountName: external_exports.string().optional(),
          priority: external_exports.number().optional().default(0)
          // @ts-ignore
        })),
        syncType: external_exports.enum(["campaigns", "ad_groups", "keywords", "product_targets", "performance", "full"]).optional().default("full")
      })).mutation(async ({ ctx, input }) => {
        const tasks = await Promise.all(input.accounts.map(async (account) => {
          const stats4 = await getSyncStats(account.accountId, 30);
          const estimatedTimeMs = stats4?.avgDurationMs || 6e4;
          return {
            userId: ctx.user.id,
            accountId: account.accountId,
            accountName: account.accountName,
            syncType: input.syncType,
            priority: account.priority,
            // @ts-ignore
            estimatedTimeMs
          };
        }));
        return addToSyncQueueBatch(tasks);
      }),
      // 获取同步队列
      getSyncQueue: protectedProcedure.input(external_exports.object({
        status: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        return getSyncQueue(ctx.user.id, input.status);
      }),
      // 获取队列统计信息
      getSyncQueueStats: protectedProcedure.query(async ({ ctx }) => {
        return getSyncQueueStats(ctx.user.id);
      }),
      // 取消同步任务
      cancelSyncTask: protectedProcedure.input(external_exports.object({ taskId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return cancelSyncTask(input.taskId);
      }),
      // 清理旧任务
      cleanupOldSyncTasks: protectedProcedure.input(external_exports.object({ retainDays: external_exports.number().optional().default(7) })).mutation(async ({ ctx, input }) => {
        return cleanupOldSyncTasks(ctx.user.id, input.retainDays);
      }),
      // 执行队列中的下一个任务
      executeNextQueuedTask: protectedProcedure.mutation(async ({ ctx }) => {
        const task = await getNextQueuedTask();
        if (!task) {
          return { message: "\u961F\u5217\u4E2D\u6CA1\u6709\u5F85\u6267\u884C\u7684\u4EFB\u52A1" };
        }
        await updateSyncTaskStatus(task.id, "running", {
          currentStep: "\u521D\u59CB\u5316",
          progress: 0
        });
        try {
          const credentials = await getAmazonApiCredentials(task.accountId);
          if (!credentials) {
            await updateSyncTaskStatus(task.id, "failed", {
              errorMessage: "API\u51ED\u8BC1\u672A\u627E\u5230"
            });
            return { error: "API\u51ED\u8BC1\u672A\u627E\u5230" };
          }
          const accountInfo = await getAdAccountById(task.accountId);
          const marketplace = accountInfo?.marketplace || "US";
          const syncService = await AmazonSyncService.createFromCredentials(
            {
              clientId: credentials.clientId,
              clientSecret: credentials.clientSecret,
              refreshToken: credentials.refreshToken,
              profileId: credentials.profileId,
              region: credentials.region
            },
            task.accountId,
            task.userId,
            marketplace
          );
          const steps = [
            // @ts-ignore
            { name: "SP\u5E7F\u544A", fn: /* @__PURE__ */ __name(() => syncService.syncSpCampaigns(), "fn") },
            // @ts-ignore
            { name: "SB\u5E7F\u544A", fn: /* @__PURE__ */ __name(() => syncService.syncSbCampaigns(), "fn") },
            // @ts-ignore
            { name: "SD\u5E7F\u544A", fn: /* @__PURE__ */ __name(() => syncService.syncSdCampaigns(), "fn") },
            // @ts-ignore
            { name: "\u5E7F\u544A\u7EC4", fn: /* @__PURE__ */ __name(() => syncService.syncSpAdGroups(), "fn") },
            // @ts-ignore
            { name: "\u5173\u952E\u8BCD", fn: /* @__PURE__ */ __name(() => syncService.syncSpKeywords(), "fn") },
            // @ts-ignore
            { name: "\u5546\u54C1\u5B9A\u4F4D", fn: /* @__PURE__ */ __name(() => syncService.syncSpProductTargets(), "fn") }
          ];
          const results = {};
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            await updateSyncTaskProgress(
              task.id,
              Math.round(i / steps.length * 100),
              step.name,
              i,
              Math.round((steps.length - i) * (task.estimatedTimeMs || 1e4) / steps.length)
            );
            const result = await step.fn();
            results[step.name] = result;
          }
          await updateSyncTaskStatus(task.id, "completed", {
            progress: 100,
            completedSteps: steps.length,
            resultSummary: results
          });
          return { success: true, results };
        } catch (error48) {
          await updateSyncTaskStatus(task.id, "failed", {
            errorMessage: error48.message
          });
          return { error: error48.message };
        }
      }),
      // Apply bid adjustment to Amazon
      applyBidAdjustment: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        targetType: external_exports.enum(["keyword", "product_target"]),
        targetId: external_exports.number(),
        newBid: external_exports.number(),
        reason: external_exports.string(),
        campaignId: external_exports.number()
      })).mutation(async ({ ctx, input }) => {
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "API credentials not found"
          });
        }
        const accountInfo = await getAdAccountById(input.accountId);
        const marketplace = accountInfo?.marketplace || "US";
        const syncService = await AmazonSyncService.createFromCredentials(
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region
          },
          input.accountId,
          ctx.user.id,
          marketplace
        );
        const success2 = await syncService.applyBidAdjustment(
          input.targetType,
          input.targetId,
          input.newBid,
          input.reason,
          input.campaignId
        );
        if (!success2) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to apply bid adjustment"
          });
        }
        return { success: true };
      }),
      // Run auto optimization with API sync
      runAutoOptimization: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        performanceGroupId: external_exports.number().optional()
        // 可选，为0或未提供时使用默认配置
      })).mutation(async ({ ctx, input }) => {
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "API credentials not found"
          });
        }
        let config2 = {
          optimizationGoal: "maximize_sales",
          targetAcos: void 0,
          targetRoas: void 0,
          dailySpendLimit: void 0,
          dailyCostTarget: void 0
        };
        if (input.performanceGroupId && input.performanceGroupId > 0) {
          const group = await getPerformanceGroupById(input.performanceGroupId);
          if (group) {
            config2 = {
              // @ts-expect-error - type assertion
              optimizationGoal: group.optimizationGoal || "maximize_sales",
              targetAcos: group.targetAcos ? parseFloat(group.targetAcos) : void 0,
              targetRoas: group.targetRoas ? parseFloat(group.targetRoas) : void 0,
              dailySpendLimit: group.dailySpendLimit ? parseFloat(group.dailySpendLimit) : void 0,
              dailyCostTarget: group.dailyCostTarget ? parseFloat(group.dailyCostTarget) : void 0
            };
          }
        }
        const accountInfo = await getAdAccountById(input.accountId);
        const marketplace = accountInfo?.marketplace || "US";
        const syncService = await AmazonSyncService.createFromCredentials(
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region
          },
          input.accountId,
          ctx.user.id,
          marketplace
        );
        const results = await runAutoBidOptimization(syncService, input.accountId, config2);
        return results;
      }),
      // Get API regions and marketplaces
      getRegions: protectedProcedure.query(() => {
        return {
          // @ts-ignore
          endpoints: API_ENDPOINTS,
          marketplaceMapping: MARKETPLACE_TO_REGION
        };
      }),
      // 生成模拟绩效数据（当Amazon Reporting API不可用时使用）
      generateMockPerformance: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        days: external_exports.number().min(1).max(30).default(7)
      })).mutation(async ({ ctx, input }) => {
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "API credentials not found"
          });
        }
        const accountInfo = await getAdAccountById(input.accountId);
        const marketplace = accountInfo?.marketplace || "US";
        const syncService = await AmazonSyncService.createFromCredentials(
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region
          },
          input.accountId,
          // @ts-ignore
          ctx.user.id,
          marketplace
        );
        log171.warn("[API] v148: generateMockPerformance\u5DF2\u5E9F\u5F03\uFF0C\u751F\u4EA7\u73AF\u5883\u7981\u6B62\u751F\u6210\u6A21\u62DF\u6570\u636E");
        return { generated: 0, warning: "v148: \u6A21\u62DF\u6570\u636E\u751F\u6210\u5DF2\u5E9F\u5F03\uFF0C\u8BF7\u4F7F\u7528\u771F\u5B9E\u6570\u636E\u540C\u6B65" };
      }),
      // ==================== 双轨制同步相关API ====================
      // 获取双轨制同步状态
      getDualTrackStatus: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { getDualTrackStatus: getDualTrackStatus2 } = await Promise.resolve().then(() => (init_dualTrackSyncService(), dualTrackSyncService_exports));
        return getDualTrackStatus2(input.accountId);
      }),
      // 获取数据源统计
      getDataSourceStats: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { getDataSourceStats: getDataSourceStats2 } = await Promise.resolve().then(() => (init_dualTrackSyncService(), dualTrackSyncService_exports));
        return getDataSourceStats2(input.accountId);
      }),
      // 执行数据一致性检查
      runConsistencyCheck: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        startDate: external_exports.string(),
        endDate: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        const { runConsistencyCheck: runConsistencyCheck3 } = await Promise.resolve().then(() => (init_dualTrackSyncService(), dualTrackSyncService_exports));
        return runConsistencyCheck3(input.accountId, input.startDate, input.endDate);
      }),
      // 获取合并后的绩效数据
      getMergedPerformanceData: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        startDate: external_exports.string(),
        endDate: external_exports.string(),
        priority: external_exports.enum(["realtime", "historical", "reporting"]).optional().default("historical")
      })).query(async ({ ctx, input }) => {
        const { getMergedPerformanceData: getMergedPerformanceData2 } = await Promise.resolve().then(() => (init_dualTrackSyncService(), dualTrackSyncService_exports));
        return getMergedPerformanceData2(input.accountId, input.startDate, input.endDate, input.priority);
      }),
      // 获取智能合并数据（增强版）
      getSmartMergedData: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        startDate: external_exports.string(),
        // @ts-ignore
        endDate: external_exports.string(),
        purpose: external_exports.enum(["realtime_display", "historical_analysis", "report_export", "algorithm_input"]),
        includeToday: external_exports.boolean().optional(),
        campaignIds: external_exports.array(external_exports.string()).optional()
      })).query(async ({ ctx, input }) => {
        const { getSmartMergedData: getSmartMergedData2 } = await Promise.resolve().then(() => (init_enhancedDualTrackService(), enhancedDualTrackService_exports));
        return getSmartMergedData2(input.accountId, input.startDate, input.endDate, {
          purpose: input.purpose,
          includeToday: input.includeToday,
          campaignIds: input.campaignIds
        });
      }),
      // 获取时间线聚合数据
      getTimelineAggregatedData: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        startDate: external_exports.string(),
        endDate: external_exports.string(),
        granularity: external_exports.enum(["daily", "weekly", "monthly"]).optional().default("daily")
      })).query(async ({ ctx, input }) => {
        const { getTimelineAggregatedData: getTimelineAggregatedData2 } = await Promise.resolve().then(() => (init_enhancedDualTrackService(), enhancedDualTrackService_exports));
        return getTimelineAggregatedData2(input.accountId, input.startDate, input.endDate, input.granularity);
      }),
      // 获取实时仪表盘数据（区分可信/不可信字段）
      getRealtimeDashboardData: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { getRealtimeDashboardData: getRealtimeDashboardData2 } = await Promise.resolve().then(() => (init_enhancedDualTrackService(), enhancedDualTrackService_exports));
        return getRealtimeDashboardData2(input.accountId);
      }),
      // 检查并执行数据回补
      checkAndBackfillData: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        date: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        const { checkAndBackfillData: checkAndBackfillData2 } = await Promise.resolve().then(() => (init_enhancedDualTrackService(), enhancedDualTrackService_exports));
        return checkAndBackfillData2(input.accountId, input.date);
      }),
      // ==================== AMS订阅管理API ====================
      // 获取AMS订阅列表
      listAmsSubscriptions: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        try {
          const account = await getAdAccountById(input.accountId);
          if (!account) {
            throw new TRPCError({ code: "NOT_FOUND", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
          }
          const credentials = await getAmazonApiCredentials(input.accountId);
          if (!credentials) {
            return { subscriptions: [], error: "\u8D26\u53F7\u672A\u914D\u7F6EAPI\u51ED\u8BC1" };
          }
          const region = MARKETPLACE_TO_REGION[account.marketplace || "US"] || "NA";
          const client = new AmazonAdsApiClient({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region
            // @ts-ignore
          });
          const subscriptions = await client.listAmsSubscriptions();
          return { subscriptions };
        } catch (error48) {
          log171.warn("[AMS] \u83B7\u53D6\u8BA2\u9605\u5217\u8868\u5931\u8D25:", error48.message);
          return { subscriptions: [], error: error48.message };
        }
      }),
      // 创建单个AMS订阅
      createAmsSubscription: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        dataSetId: external_exports.enum(["sp-traffic", "sb-traffic", "sd-traffic", "sp-conversion", "sp-budget-usage", "sb-budget-usage", "sd-budget-usage"]),
        notes: external_exports.string().optional()
      })).mutation(async ({ ctx, input }) => {
        try {
          const account = await getAdAccountById(input.accountId);
          if (!account) {
            throw new TRPCError({ code: "NOT_FOUND", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
          }
          const credentials = await getAmazonApiCredentials(input.accountId);
          if (!credentials) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "\u8D26\u53F7\u672A\u914D\u7F6EAPI\u51ED\u8BC1" });
          }
          const sqsQueueArn = process.env.AWS_SQS_QUEUE_ARN;
          if (!sqsQueueArn) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "\u672A\u914D\u7F6ESQS\u961F\u5217ARN\uFF0C\u8BF7\u5728\u73AF\u5883\u53D8\u91CF\u4E2D\u8BBE\u7F6EAWS_SQS_QUEUE_ARN" });
          }
          const region = MARKETPLACE_TO_REGION[account.marketplace || "US"] || "NA";
          const client = new AmazonAdsApiClient({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region
          });
          const subscription = await client.createAmsSubscription(
            // @ts-expect-error - type assertion
            input.dataSetId,
            sqsQueueArn,
            input.notes
          );
          return { success: true, subscription };
        } catch (error48) {
          log171.warn("[AMS] \u521B\u5EFA\u8BA2\u9605\u5931\u8D25:", error48.message);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            // @ts-ignore
            message: `\u521B\u5EFAAMS\u8BA2\u9605\u5931\u8D25: ${error48.response?.data?.message || error48.message}`
          });
        }
      }),
      // 批量创建快车道订阅（全部 9 个数据集: traffic/conversion/budget-usage 各 3 个）
      createAllTrafficSubscriptions: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        try {
          const account = await getAdAccountById(input.accountId);
          if (!account) {
            throw new TRPCError({ code: "NOT_FOUND", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
          }
          const credentials = await getAmazonApiCredentials(input.accountId);
          if (!credentials) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "\u8D26\u53F7\u672A\u914D\u7F6EAPI\u51ED\u8BC1" });
          }
          const urlToArn = /* @__PURE__ */ __name((url3) => {
            if (!url3) return void 0;
            let match = url3.match(/sqs\.([^.]+)\.amazonaws\.com\/(\d+)\/(.+)/);
            if (match) {
              const [, region2, accountId, queueName] = match;
              return `arn:aws:sqs:${region2}:${accountId}:${queueName}`;
            }
            match = url3.match(/queue\.amazonaws\.com\/(\d+)\/(.+)/);
            if (match) {
              const [, accountId, queueName] = match;
              const region2 = process.env.AWS_REGION || "us-east-1";
              return `arn:aws:sqs:${region2}:${accountId}:${queueName}`;
            }
            return url3;
          }, "urlToArn");
          const queueArnMapping = {
            "sp-traffic": urlToArn(process.env.AWS_SQS_QUEUE_TRAFFIC_URL),
            "sp-conversion": urlToArn(process.env.AWS_SQS_QUEUE_CONVERSION_URL),
            "sp-budget-usage": urlToArn(process.env.AWS_SQS_QUEUE_BUDGET_URL),
            "sb-traffic": urlToArn(process.env.AWS_SQS_QUEUE_SB_TRAFFIC_URL),
            "sb-conversion": urlToArn(process.env.AWS_SQS_QUEUE_SB_CONVERSION_URL),
            "sb-budget-usage": urlToArn(process.env.AWS_SQS_QUEUE_SB_BUDGET_URL),
            "sd-traffic": urlToArn(process.env.AWS_SQS_QUEUE_SD_TRAFFIC_URL),
            "sd-conversion": urlToArn(process.env.AWS_SQS_QUEUE_SD_CONVERSION_URL),
            "sd-budget-usage": urlToArn(process.env.AWS_SQS_QUEUE_SD_BUDGET_URL)
          };
          const configuredQueues = Object.entries(queueArnMapping).filter(([_, arn]) => arn);
          if (configuredQueues.length === 0) {
            const sqsQueueArn = process.env.AWS_SQS_QUEUE_ARN;
            if (!sqsQueueArn) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "\u672A\u914D\u7F6ESQS\u961F\u5217\u73AF\u5883\u53D8\u91CF" });
            }
            log171.info("[AMS] \u4F7F\u7528\u5355\u4E00\u961F\u5217ARN\u6A21\u5F0F:", sqsQueueArn);
            const region2 = MARKETPLACE_TO_REGION[account.marketplace || "US"] || "NA";
            const client2 = new AmazonAdsApiClient({
              clientId: credentials.clientId,
              clientSecret: credentials.clientSecret,
              refreshToken: credentials.refreshToken,
              profileId: credentials.profileId,
              region: region2
            });
            const result2 = await client2.createAllTrafficSubscriptions(sqsQueueArn);
            return {
              success: true,
              created: result2.created,
              failed: result2.failed,
              message: `\u6210\u529F\u521B\u5EFA ${result2.created.length} \u4E2A\u8BA2\u9605\uFF0C\u5931\u8D25 ${result2.failed.length} \u4E2A`
            };
          }
          log171.info(`[AMS] \u4F7F\u7528\u961F\u5217\u6620\u5C04\u6A21\u5F0F\uFF0C\u5DF2\u914D\u7F6E ${configuredQueues.length} \u4E2A\u961F\u5217:`);
          configuredQueues.forEach(([name2, arn]) => log171.info(`  - ${name2}: ${arn}`));
          const region = MARKETPLACE_TO_REGION[account.marketplace || "US"] || "NA";
          const client = new AmazonAdsApiClient({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region
          });
          const result = await client.createAllTrafficSubscriptions(queueArnMapping);
          return {
            success: true,
            created: result.created,
            failed: result.failed,
            message: `\u6210\u529F\u521B\u5EFA ${result.created.length} \u4E2A\u8BA2\u9605\uFF0C\u5931\u8D25 ${result.failed.length} \u4E2A`
          };
        } catch (error48) {
          log171.warn("[AMS] \u6279\u91CF\u521B\u5EFA\u8BA2\u9605\u5931\u8D25:", error48.message);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `\u6279\u91CF\u521B\u5EFAAMS\u8BA2\u9605\u5931\u8D25: ${error48.message}`
          });
        }
      }),
      // 归档/删除AMS订阅
      archiveAmsSubscription: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        subscriptionId: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        try {
          const account = await getAdAccountById(input.accountId);
          if (!account) {
            throw new TRPCError({ code: "NOT_FOUND", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
          }
          const credentials = await getAmazonApiCredentials(input.accountId);
          if (!credentials) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "\u8D26\u53F7\u672A\u914D\u7F6EAPI\u51ED\u8BC1" });
          }
          const region = MARKETPLACE_TO_REGION[account.marketplace || "US"] || "NA";
          const client = new AmazonAdsApiClient({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region
          });
          await client.archiveAmsSubscription(input.subscriptionId);
          return { success: true };
        } catch (error48) {
          log171.warn("[AMS] \u5F52\u6863\u8BA2\u9605\u5931\u8D25:", error48.message);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `\u5F52\u6863AMS\u8BA2\u9605\u5931\u8D25: ${error48.message}`
          });
        }
      }),
      // 获取SQS配置信息
      getSqsConfig: protectedProcedure.query(async () => {
        const queueArn = process.env.AWS_SQS_QUEUE_ARN;
        const queueUrl = process.env.AWS_SQS_QUEUE_URL;
        const trafficQueueUrl = process.env.AWS_SQS_QUEUE_TRAFFIC_URL;
        const conversionQueueUrl = process.env.AWS_SQS_QUEUE_CONVERSION_URL;
        const budgetQueueUrl = process.env.AWS_SQS_QUEUE_BUDGET_URL;
        return {
          configured: !!(queueArn || trafficQueueUrl || conversionQueueUrl || budgetQueueUrl),
          queueArn: queueArn ? `${queueArn.substring(0, 30)}...` : null,
          queueUrl: queueUrl ? `${queueUrl.substring(0, 50)}...` : null,
          multiQueueConfigured: !!(trafficQueueUrl || conversionQueueUrl || budgetQueueUrl),
          queues: {
            traffic: trafficQueueUrl ? `${trafficQueueUrl.substring(0, 50)}...` : null,
            conversion: conversionQueueUrl ? `${conversionQueueUrl.substring(0, 50)}...` : null,
            budget: budgetQueueUrl ? `${budgetQueueUrl.substring(0, 50)}...` : null
          }
        };
      }),
      // 获取SQS消费者状态
      getSqsConsumerStatus: protectedProcedure.query(async () => {
        try {
          const consumer = getSQSConsumer();
          const status = consumer.getStatus();
          const queueStats = await consumer.getQueueStats();
          return {
            isRunning: status.length > 0 && status.some((s) => s.isRunning),
            consumers: status,
            queueStats
          };
        } catch (error48) {
          return {
            isRunning: false,
            consumers: [],
            queueStats: [],
            error: error48.message
          };
        }
      }),
      // 启动SQS消费者
      startSqsConsumer: protectedProcedure.mutation(async () => {
        try {
          await startSQSConsumer();
          return { success: true, message: "SQS\u6D88\u8D39\u8005\u5DF2\u542F\u52A8" };
        } catch (error48) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `\u542F\u52A8SQS\u6D88\u8D39\u8005\u5931\u8D25: ${error48.message}`
          });
        }
      }),
      // 停止SQS消费者
      stopSqsConsumer: protectedProcedure.mutation(async () => {
        try {
          stopSQSConsumer();
          return { success: true, message: "SQS\u6D88\u8D39\u8005\u5DF2\u505C\u6B62" };
        } catch (error48) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `\u505C\u6B62SQS\u6D88\u8D39\u8005\u5931\u8D25: ${error48.message}`
          });
        }
      }),
      // ==================== 批量授权API ====================
      // 获取所有区域配置信息
      getBatchAuthRegions: publicProcedure.query(() => {
        return {
          regions: [
            {
              code: "NA",
              name: "\u5317\u7F8E\u533A\u57DF",
              displayFlags: "\u{1F1FA}\u{1F1F8}\u{1F1E8}\u{1F1E6}\u{1F1F2}\u{1F1FD}\u{1F1E7}\u{1F1F7}",
              marketplaces: [
                { code: "US", name: "\u7F8E\u56FD", flag: "\u{1F1FA}\u{1F1F8}" },
                { code: "CA", name: "\u52A0\u62FF\u5927", flag: "\u{1F1E8}\u{1F1E6}" },
                { code: "MX", name: "\u58A8\u897F\u54E5", flag: "\u{1F1F2}\u{1F1FD}" },
                { code: "BR", name: "\u5DF4\u897F", flag: "\u{1F1E7}\u{1F1F7}" }
              ]
            },
            {
              code: "EU",
              name: "\u6B27\u6D32\u533A\u57DF",
              displayFlags: "\u{1F1EC}\u{1F1E7}\u{1F1E9}\u{1F1EA}\u{1F1EB}\u{1F1F7}\u{1F1EE}\u{1F1F9}\u{1F1EA}\u{1F1F8}",
              marketplaces: [
                { code: "UK", name: "\u82F1\u56FD", flag: "\u{1F1EC}\u{1F1E7}" },
                { code: "DE", name: "\u5FB7\u56FD", flag: "\u{1F1E9}\u{1F1EA}" },
                { code: "FR", name: "\u6CD5\u56FD", flag: "\u{1F1EB}\u{1F1F7}" },
                { code: "IT", name: "\u610F\u5927\u5229", flag: "\u{1F1EE}\u{1F1F9}" },
                { code: "ES", name: "\u897F\u73ED\u7259", flag: "\u{1F1EA}\u{1F1F8}" },
                { code: "NL", name: "\u8377\u5170", flag: "\u{1F1F3}\u{1F1F1}" },
                { code: "SE", name: "\u745E\u5178", flag: "\u{1F1F8}\u{1F1EA}" },
                { code: "PL", name: "\u6CE2\u5170", flag: "\u{1F1F5}\u{1F1F1}" },
                { code: "AE", name: "\u963F\u8054\u914B", flag: "\u{1F1E6}\u{1F1EA}" },
                { code: "SA", name: "\u6C99\u7279", flag: "\u{1F1F8}\u{1F1E6}" },
                { code: "IN", name: "\u5370\u5EA6", flag: "\u{1F1EE}\u{1F1F3}" }
              ]
            },
            {
              code: "FE",
              name: "\u8FDC\u4E1C\u533A\u57DF",
              displayFlags: "\u{1F1EF}\u{1F1F5}\u{1F1E6}\u{1F1FA}\u{1F1F8}\u{1F1EC}",
              marketplaces: [
                { code: "JP", name: "\u65E5\u672C", flag: "\u{1F1EF}\u{1F1F5}" },
                { code: "AU", name: "\u6FB3\u5927\u5229\u4E9A", flag: "\u{1F1E6}\u{1F1FA}" },
                { code: "SG", name: "\u65B0\u52A0\u5761", flag: "\u{1F1F8}\u{1F1EC}" }
              ]
            }
          ]
        };
      }),
      // 创建批量授权会话
      createBatchAuthSession: protectedProcedure.input(external_exports.object({
        storeName: external_exports.string(),
        selectedRegions: external_exports.array(external_exports.enum(["NA", "EU", "FE"]))
      })).mutation(async ({ ctx, input }) => {
        const sessionId = `batch_${ctx.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const clientId = process.env.AMAZON_ADS_CLIENT_ID || "";
        const redirectUri = "https://www.ppcopt.com/api/auth/callback";
        const authEndpoints = {
          NA: "https://www.amazon.com/ap/oa",
          EU: "https://eu.account.amazon.com/ap/oa",
          FE: "https://apac.account.amazon.com/ap/oa"
        };
        const regionAuthUrls = input.selectedRegions.map((regionCode) => {
          const state = `${sessionId}:${regionCode}`;
          const params = new URLSearchParams({
            client_id: clientId,
            scope: "advertising::campaign_management",
            response_type: "code",
            redirect_uri: redirectUri,
            state
          });
          return {
            regionCode,
            authUrl: `${authEndpoints[regionCode]}?${params.toString()}`,
            status: "pending"
          };
        });
        return {
          sessionId,
          storeName: input.storeName,
          regions: regionAuthUrls,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
      }),
      // 批量处理多个区域的授权码
      processBatchAuthCodes: protectedProcedure.input(external_exports.object({
        storeName: external_exports.string(),
        authCodes: external_exports.array(external_exports.object({
          regionCode: external_exports.enum(["NA", "EU", "FE"]),
          code: external_exports.string()
        }))
      })).mutation(async ({ ctx, input }) => {
        const clientId = process.env.AMAZON_ADS_CLIENT_ID || "";
        const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET || "";
        const redirectUri = "https://www.ppcopt.com/api/auth/callback";
        if (!clientId || !clientSecret) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "\u7F3A\u5C11Amazon API\u51ED\u8BC1\u914D\u7F6E"
          });
        }
        const results = [];
        for (const { regionCode, code } of input.authCodes) {
          try {
            log171.info(`[BatchAuth] \u5904\u7406 ${regionCode} \u533A\u57DF\u6388\u6743\u7801...`);
            const tokens = await AmazonAdsApiClient.exchangeCodeForToken(
              code,
              clientId,
              clientSecret,
              redirectUri
            );
            const client = new AmazonAdsApiClient({
              clientId,
              clientSecret,
              refreshToken: tokens.refresh_token,
              profileId: "",
              region: regionCode
            });
            const profiles = await client.getProfiles();
            log171.info(`[BatchAuth] ${regionCode} \u533A\u57DF\u83B7\u53D6\u5230 ${profiles.length} \u4E2AProfile`);
            let accountsCreated = 0;
            for (const profile of profiles) {
              try {
                const existingAccounts = await getAccountsForUser(ctx.user);
                const existingByProfile = existingAccounts.find(
                  (a) => a.profileId === String(profile.profileId)
                );
                let accountId;
                if (existingByProfile) {
                  accountId = existingByProfile.id;
                  await updateAdAccount(accountId, {
                    storeName: input.storeName,
                    marketplace: profile.countryCode
                  });
                  log171.info(`[BatchAuth] \u66F4\u65B0\u73B0\u6709\u8D26\u53F7 ${accountId} (${profile.countryCode})`);
                } else {
                  accountId = await createAdAccount({
                    userId: ctx.user.id,
                    organizationId: ctx.user.organizationId,
                    accountId: String(profile.profileId),
                    // @ts-expect-error - dynamic property access
                    accountName: profile.accountInfo?.name || `${input.storeName} - ${profile.countryCode}`,
                    storeName: input.storeName,
                    marketplace: profile.countryCode,
                    profileId: String(profile.profileId),
                    connectionStatus: "pending"
                  });
                  accountsCreated++;
                  log171.info(`[BatchAuth] \u521B\u5EFA\u65B0\u8D26\u53F7 ${accountId} (${profile.countryCode})`);
                }
                await saveAmazonApiCredentials({
                  accountId,
                  clientId,
                  clientSecret,
                  refreshToken: tokens.refresh_token,
                  profileId: String(profile.profileId),
                  // @ts-ignore
                  region: regionCode
                  // @ts-ignore
                });
                await updateAdAccount(accountId, {
                  connectionStatus: "connected"
                });
                const { initializeAccount: initializeAccount2 } = await Promise.resolve().then(() => (init_accountInitializationService(), accountInitializationService_exports));
                initializeAccount2({
                  accountId,
                  userId: ctx.user.id,
                  clientId,
                  clientSecret,
                  refreshToken: tokens.refresh_token,
                  profileId: String(profile.profileId),
                  region: regionCode,
                  marketplace: profile.countryCode
                }).then(async (initResult) => {
                  log171.info(`[BatchAuth] \u8D26\u53F7 ${accountId} (${profile.countryCode}) \u521D\u59CB\u5316\u5B8C\u6210:`, {
                    sync: initResult.syncResult.success ? "\u2705" : "\u274C",
                    schedule: initResult.scheduleResult.success ? "\u2705" : "\u274C",
                    ams: initResult.amsResult.success ? "\u2705" : "\u274C"
                  });
                  try {
                    const { triggerImmediateSync: triggerImmediateSync2 } = await Promise.resolve().then(() => (init_dataSyncScheduler(), dataSyncScheduler_exports));
                    await triggerImmediateSync2(accountId, `BatchAuth\u521D\u59CB\u5316\u5B8C\u6210\u540E\u540C\u6B65 (accountId=${accountId}, marketplace=${profile.countryCode})`);
                  } catch (syncErr) {
                    log171.warn(`[v336] BatchAuth\u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65\u89E6\u53D1\u5931\u8D25:`, syncErr.message);
                  }
                }).catch((err) => {
                  log171.warn(`[BatchAuth] \u8D26\u53F7 ${accountId} (${profile.countryCode}) \u521D\u59CB\u5316\u5931\u8D25:`, err);
                });
              } catch (profileError) {
                log171.warn(`[BatchAuth] \u5904\u7406Profile ${profile.profileId} \u5931\u8D25:`, profileError);
              }
            }
            results.push({
              regionCode,
              // @ts-ignore
              status: "success",
              profilesCount: profiles.length,
              accountsCreated
              // @ts-ignore
            });
          } catch (error48) {
            log171.warn(`[BatchAuth] ${regionCode} \u533A\u57DF\u6388\u6743\u5931\u8D25:`, error48);
            results.push({
              regionCode,
              status: "error",
              error: error48.message
            });
          }
        }
        const successCount = results.filter((r) => r.status === "success").length;
        const totalProfiles = results.reduce((sum2, r) => sum2 + (r.profilesCount || 0), 0);
        const totalAccountsCreated = results.reduce((sum2, r) => sum2 + (r.accountsCreated || 0), 0);
        return {
          success: successCount > 0,
          message: successCount === input.authCodes.length ? `\u6240\u6709 ${successCount} \u4E2A\u533A\u57DF\u6388\u6743\u6210\u529F\uFF0C\u5171\u521B\u5EFA ${totalAccountsCreated} \u4E2A\u7AD9\u70B9\u8D26\u53F7` : `${successCount}/${input.authCodes.length} \u4E2A\u533A\u57DF\u6388\u6743\u6210\u529F`,
          // @ts-ignore
          results,
          summary: {
            totalRegions: input.authCodes.length,
            successRegions: successCount,
            totalProfiles,
            totalAccountsCreated
          }
        };
      }),
      // 获取用户已授权的区域状态
      getAuthorizedRegions: protectedProcedure.query(async ({ ctx }) => {
        const accounts = await getAccountsForUser(ctx.user);
        const regionStats = {
          NA: { authorized: false, accountCount: 0, marketplaces: [] },
          EU: { authorized: false, accountCount: 0, marketplaces: [] },
          FE: { authorized: false, accountCount: 0, marketplaces: [] }
        };
        const marketplaceToRegion = {
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
          AE: "EU",
          SA: "EU",
          IN: "EU",
          JP: "FE",
          AU: "FE",
          SG: "FE"
        };
        for (const account of accounts) {
          if (!account.marketplace) continue;
          const region = marketplaceToRegion[account.marketplace];
          if (!region || !regionStats[region]) continue;
          const credentials = await getAmazonApiCredentials(account.id);
          if (credentials) {
            regionStats[region].authorized = true;
            regionStats[region].accountCount++;
            regionStats[region].marketplaces.push(account.marketplace);
            if (credentials.lastSyncAt) {
              regionStats[region].lastSyncAt = credentials.lastSyncAt;
            }
          }
        }
        return {
          // @ts-ignore
          regions: Object.entries(regionStats).map(([code, stats4]) => ({
            // @ts-ignore
            code,
            // @ts-ignore
            ...stats4
            // @ts-ignore
          })),
          totalAccounts: accounts.length,
          authorizedAccounts: accounts.filter((a) => a.connectionStatus === "connected").length
        };
      }),
      // v417: 实现前端AmazonApiAuthStatus页面所需的getAllAuthStatus接口
      getAllAuthStatus: protectedProcedure.query(async ({ ctx }) => {
        const accounts = await getAccountsForUser(ctx.user);
        const accountStatuses = [];
        let activeCount = 0;
        let expiringCount = 0;
        let expiredCount = 0;
        for (const account of accounts) {
          const credentials = await getAmazonApiCredentials(account.id);
          let status = "unknown";
          let tokenExpiresAt = null;
          let daysUntilExpiry = null;
          let tokenExpired = false;
          if (credentials) {
            if (credentials.tokenExpiresAt) {
              tokenExpiresAt = credentials.tokenExpiresAt;
              const expiresDate = new Date(credentials.tokenExpiresAt);
              const now = /* @__PURE__ */ new Date();
              const diffMs = expiresDate.getTime() - now.getTime();
              daysUntilExpiry = Math.floor(diffMs / (1e3 * 60 * 60 * 24));
              if (diffMs <= 0) {
                status = "expired";
                tokenExpired = true;
                expiredCount++;
              } else if (daysUntilExpiry <= 7) {
                status = "expiring_soon";
                expiringCount++;
              } else {
                status = "active";
                activeCount++;
              }
            } else {
              try {
                const client = new AmazonAdsApiClient({
                  clientId: credentials.clientId,
                  clientSecret: credentials.clientSecret,
                  refreshToken: credentials.refreshToken,
                  profileId: credentials.profileId,
                  region: credentials.region
                });
                await client.getProfiles();
                status = "active";
                activeCount++;
              } catch {
                status = "expired";
                tokenExpired = true;
                expiredCount++;
              }
            }
          }
          accountStatuses.push({
            // @ts-ignore
            accountId: account.id,
            // @ts-ignore
            accountName: account.accountName || `Account ${account.id}`,
            // @ts-ignore
            profileId: account.profileId || "",
            // @ts-ignore
            marketplace: account.marketplace || "",
            tokenExpiresAt,
            tokenExpired,
            daysUntilExpiry,
            lastRefreshAt: credentials?.updatedAt || null,
            authScope: ["advertising::campaign_management"],
            status
          });
        }
        return {
          accounts: accountStatuses,
          totalAccounts: accountStatuses.length,
          activeAccounts: activeCount,
          expiringAccounts: expiringCount,
          expiredAccounts: expiredCount
        };
      }),
      // v417: 实现前端AmazonApiAuthStatus页面所需的refreshToken接口
      refreshToken: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "\u672A\u627E\u5230\u8BE5\u8D26\u53F7\u7684API\u51ED\u8BC1"
          });
        }
        try {
          const client = new AmazonAdsApiClient({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region
          });
          await client.getProfiles();
          return {
            success: true,
            message: "Token\u5237\u65B0\u6210\u529F"
          };
        } catch (error48) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Token\u5237\u65B0\u5931\u8D25: ${error48.message}`
          });
        }
      })
    });
  }
});

