import type { Express, Request, Response } from "express";
import { AmazonAdsApiClient, DEFAULT_REDIRECT_URI } from "../amazonAdsApi";
import * as db from "../db";

/**
 * v342: Amazon Ads API OAuth 回调路由（重大修复）
 * 
 * v342修复: 后端回调直接保存凭证到数据库，不再依赖前端中转
 * 
 * 之前的问题（v325-v341）:
 * - 后端获取到新refresh_token后，只通过URL参数传给前端
 * - 前端processCallback中clientSecret硬编码为空字符串''
 * - 导致saveMultipleProfiles验证失败："缺少必填的API凭证字段"
 * - 新的refresh_token从未保存到数据库
 * - 这是账户90027持续401的根本原因
 * 
 * v342修复策略:
 * 1. 后端回调直接保存凭证到数据库（使用服务器端clientId/clientSecret）
 * 2. 按profileId精确匹配已有账户，更新其refresh_token
 * 3. 同时更新所有共享旧refresh_token的账户（批量更新）
 * 4. 前端仍然接收回调数据用于UI展示，但凭证保存不再依赖前端
 * 
 * 处理流程：
 * 1. Amazon OAuth授权完成后，重定向到 /api/auth/callback?code=XXX&scope=...
 * 2. 服务端接收code，用code换取refresh_token和access_token
 * 3. 获取该token关联的所有profiles（站点）
 * 4. ★ 直接在后端更新数据库中匹配的账户凭证（新增v342）
 * 5. 重定向用户回系统的API设置页面，通过URL参数传递结果
 */
export function registerAmazonAuthCallbackRoutes(app: Express) {
  app.get("/api/auth/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
    const error = typeof req.query.error === "string" ? req.query.error : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;

    console.log("[AmazonAuthCallback] v342: Received callback:", {
      hasCode: !!code,
      codeLength: code?.length,
      scope,
      error,
      state,
    });

    // 如果Amazon返回了错误（用户拒绝授权等）
    if (error) {
      console.error("[AmazonAuthCallback] Amazon returned error:", error);
      const redirectUrl = `/amazon-api?auth_error=${encodeURIComponent(error)}`;
      res.redirect(302, redirectUrl);
      return;
    }

    // 没有code参数
    if (!code) {
      console.error("[AmazonAuthCallback] No code parameter received");
      const redirectUrl = `/amazon-api?auth_error=${encodeURIComponent("未收到授权码，请重新授权")}`;
      res.redirect(302, redirectUrl);
      return;
    }

    try {
      const clientId = process.env.AMAZON_ADS_CLIENT_ID || '';
      const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET || '';
      const redirectUri = DEFAULT_REDIRECT_URI;

      if (!clientId || !clientSecret) {
        throw new Error("缺少Amazon API凭证配置（AMAZON_ADS_CLIENT_ID/AMAZON_ADS_CLIENT_SECRET）");
      }

      console.log("[AmazonAuthCallback] v342: Exchanging code for tokens...");

      // 步骤1: 用code换取token
      const tokens = await AmazonAdsApiClient.exchangeCodeForToken(
        code,
        clientId,
        clientSecret,
        redirectUri
      );

      const newRefreshToken = tokens.refresh_token;
      console.log("[AmazonAuthCallback] v342: Token exchange successful, newRefreshToken prefix:", newRefreshToken?.substring(0, 20) + '...');

      // 步骤2: 获取profiles列表
      let profiles: Array<{ profileId: string; countryCode: string; accountName: string; sellerId: string }> = [];
      try {
        const client = new AmazonAdsApiClient({
          clientId,
          clientSecret,
          refreshToken: newRefreshToken,
          profileId: '',
          region: 'NA',
        });
        const profileList = await client.getProfiles();
        profiles = profileList.map(p => ({
          profileId: String(p.profileId),
          countryCode: p.countryCode || '',
          accountName: p.accountInfo?.name || `Profile ${p.profileId}`,
          sellerId: p.accountInfo?.id || '',
        }));
        console.log("[AmazonAuthCallback] v342: Fetched profiles:", profiles.length, profiles.map(p => `${p.profileId}(${p.countryCode})`));
      } catch (profileError: any) {
        console.error("[AmazonAuthCallback] v342: Failed to fetch profiles:", profileError.message);
      }

      // ★ 步骤3 (v342新增): 后端直接保存凭证到数据库
      let credentialsSaved = 0;
      let credentialsFailed = 0;
      const updatedAccountIds: number[] = [];

      if (profiles.length > 0) {
        try {
          // 获取所有账户（跨用户查找，因为回调时不知道是哪个用户）
          const allAccounts = await db.getAdAccounts();
          
          for (const profile of profiles) {
            try {
              // 按profileId精确匹配已有账户
              const matchingAccount = allAccounts.find(a => a.profileId === profile.profileId);
              
              if (matchingAccount) {
                // 更新已有账户的凭证
                const existingCreds = await db.getAmazonApiCredentials(matchingAccount.id);
                
                if (existingCreds) {
                  // 更新refresh_token，保留已有的clientId和clientSecret
                  await db.updateAmazonApiCredentials(matchingAccount.id, {
                    refreshToken: newRefreshToken,
                    // 只在已有值为空时才更新clientId/clientSecret
                    ...((!existingCreds.clientId || existingCreds.clientId === '') ? { clientId } : {}),
                    ...((!existingCreds.clientSecret || existingCreds.clientSecret === '') ? { clientSecret } : {}),
                  });
                  console.log(`[AmazonAuthCallback] v342: 更新账户 ${matchingAccount.id} (${profile.countryCode}, profileId=${profile.profileId}) 的refresh_token`);
                } else {
                  // 没有凭证记录，创建新的
                  await db.saveAmazonApiCredentials({
                    accountId: matchingAccount.id,
                    clientId,
                    clientSecret,
                    refreshToken: newRefreshToken,
                    profileId: profile.profileId,
                    region: 'NA', // 默认NA，后续可根据countryCode推断
                  });
                  console.log(`[AmazonAuthCallback] v342: 为账户 ${matchingAccount.id} (${profile.countryCode}) 创建新凭证记录`);
                }
                
                // 更新连接状态
                await db.updateAdAccount(matchingAccount.id, {
                  connectionStatus: 'connected',
                });
                
                updatedAccountIds.push(matchingAccount.id);
                credentialsSaved++;
              } else {
                console.log(`[AmazonAuthCallback] v342: 未找到profileId=${profile.profileId}(${profile.countryCode})对应的账户，跳过（前端将处理新账户创建）`);
              }
            } catch (profileSaveError: any) {
              console.error(`[AmazonAuthCallback] v342: 保存profile ${profile.profileId} 凭证失败:`, profileSaveError.message);
              credentialsFailed++;
            }
          }

          // ★ 步骤3b (v342新增): 批量更新共享旧refresh_token的其他账户
          // 如果有成功更新的账户，查找其他使用旧refresh_token的账户并一起更新
          if (updatedAccountIds.length > 0) {
            try {
              const firstUpdatedCreds = await db.getAmazonApiCredentials(updatedAccountIds[0]);
              if (firstUpdatedCreds) {
                // 查找所有账户的凭证，找到使用不同（旧）refresh_token但属于同一组的账户
                for (const account of allAccounts) {
                  if (updatedAccountIds.includes(account.id)) continue; // 跳过已更新的
                  
                  const creds = await db.getAmazonApiCredentials(account.id);
                  if (!creds) continue;
                  
                  // 如果这个账户的clientId与当前授权的clientId相同，说明属于同一个应用
                  // 且其refreshToken不是新的，则更新为新的refreshToken
                  if (creds.clientId === clientId && creds.refreshToken !== newRefreshToken) {
                    await db.updateAmazonApiCredentials(account.id, {
                      refreshToken: newRefreshToken,
                    });
                    updatedAccountIds.push(account.id);
                    credentialsSaved++;
                    console.log(`[AmazonAuthCallback] v342: 批量更新共享Token账户 ${account.id} (${account.marketplace}) 的refresh_token`);
                  }
                }
              }
            } catch (batchUpdateError: any) {
              console.error(`[AmazonAuthCallback] v342: 批量更新共享Token失败:`, batchUpdateError.message);
            }
          }

          console.log(`[AmazonAuthCallback] v342: 凭证保存完成 - 成功=${credentialsSaved}, 失败=${credentialsFailed}, 更新账户IDs=[${updatedAccountIds.join(',')}]`);
        } catch (dbError: any) {
          console.error("[AmazonAuthCallback] v342: 数据库操作失败:", dbError.message);
        }
      }

      // ★ 步骤3c (v342新增): 触发已更新账户的数据同步
      if (updatedAccountIds.length > 0) {
        // 异步触发，不阻塞重定向
        (async () => {
          try {
            const { triggerImmediateSync } = await import('../dataSyncScheduler');
            for (const accountId of updatedAccountIds) {
              try {
                await triggerImmediateSync(accountId, `v342: OAuth回调后自动同步 (accountId=${accountId})`);
                console.log(`[AmazonAuthCallback] v342: 触发账户 ${accountId} 立即同步`);
              } catch (syncErr: any) {
                console.error(`[AmazonAuthCallback] v342: 触发账户 ${accountId} 同步失败:`, syncErr.message);
              }
            }
          } catch (importErr: any) {
            console.error(`[AmazonAuthCallback] v342: 导入dataSyncScheduler失败:`, importErr.message);
          }
        })();
      }

      // 步骤4: 构建重定向URL，传递结果到前端（保留原有逻辑，前端仍可处理UI更新）
      const params = new URLSearchParams({
        auth_success: 'true',
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token || '',
        expires_in: String(tokens.expires_in || 3600),
        profiles_count: String(profiles.length),
        // v342: 告知前端后端已直接保存凭证
        backend_saved: String(credentialsSaved),
        backend_updated_accounts: updatedAccountIds.join(','),
      });

      if (profiles.length > 0) {
        params.set('profiles', JSON.stringify(profiles));
      }

      const redirectUrl = `/amazon-api?${params.toString()}`;
      console.log(`[AmazonAuthCallback] v342: Redirecting to settings page (backend saved ${credentialsSaved} credentials for accounts [${updatedAccountIds.join(',')}])`);

      res.redirect(302, redirectUrl);
    } catch (err: any) {
      console.error("[AmazonAuthCallback] v342: Token exchange failed:", err.response?.data || err.message);
      const errorMsg = err.response?.data?.error_description || err.message || "Token换取失败";
      const redirectUrl = `/amazon-api?auth_error=${encodeURIComponent(errorMsg)}`;
      res.redirect(302, redirectUrl);
    }
  });
}
