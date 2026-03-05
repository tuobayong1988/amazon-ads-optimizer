import type { Express, Request, Response } from "express";
import { AmazonAdsApiClient, DEFAULT_REDIRECT_URI } from "../amazonAdsApi";

/**
 * v325: Amazon Ads API OAuth 回调路由
 * 
 * 处理流程：
 * 1. Amazon OAuth授权完成后，重定向到 /api/auth/callback?code=XXX&scope=...
 * 2. 服务端接收code，用code换取refresh_token和access_token
 * 3. 获取该token关联的所有profiles（站点）
 * 4. 重定向用户回系统的API设置页面，通过URL参数传递结果
 */
export function registerAmazonAuthCallbackRoutes(app: Express) {
  app.get("/api/auth/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
    const error = typeof req.query.error === "string" ? req.query.error : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;

    console.log("[AmazonAuthCallback] Received callback:", {
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

      console.log("[AmazonAuthCallback] Exchanging code for tokens...");

      // 步骤1: 用code换取token
      const tokens = await AmazonAdsApiClient.exchangeCodeForToken(
        code,
        clientId,
        clientSecret,
        redirectUri
      );

      console.log("[AmazonAuthCallback] Token exchange successful, fetching profiles...");

      // 步骤2: 获取profiles列表
      let profiles: Array<{ profileId: string; countryCode: string; accountName: string; sellerId: string }> = [];
      try {
        const client = new AmazonAdsApiClient({
          clientId,
          clientSecret,
          refreshToken: tokens.refresh_token,
          profileId: '',
          region: 'NA', // 默认NA，profiles接口会返回所有区域的profiles
        });
        const profileList = await client.getProfiles();
        profiles = profileList.map(p => ({
          profileId: String(p.profileId),
          countryCode: p.countryCode || '',
          accountName: p.accountInfo?.name || `Profile ${p.profileId}`,
          sellerId: p.accountInfo?.id || '',
        }));
        console.log("[AmazonAuthCallback] Fetched profiles:", profiles.length);
      } catch (profileError: any) {
        console.error("[AmazonAuthCallback] Failed to fetch profiles:", profileError.message);
        // 不中断流程，继续返回token
      }

      // 步骤3: 构建重定向URL，传递结果到前端
      // 使用URL参数传递关键信息，前端页面会自动读取并处理
      const params = new URLSearchParams({
        auth_success: 'true',
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token || '',
        expires_in: String(tokens.expires_in || 3600),
        profiles_count: String(profiles.length),
      });

      // 传递profiles信息（JSON编码）
      if (profiles.length > 0) {
        params.set('profiles', JSON.stringify(profiles));
      }

      const redirectUrl = `/amazon-api?${params.toString()}`;
      console.log("[AmazonAuthCallback] Redirecting to settings page with auth result");

      res.redirect(302, redirectUrl);
    } catch (err: any) {
      console.error("[AmazonAuthCallback] Token exchange failed:", err.response?.data || err.message);
      const errorMsg = err.response?.data?.error_description || err.message || "Token换取失败";
      const redirectUrl = `/amazon-api?auth_error=${encodeURIComponent(errorMsg)}`;
      res.redirect(302, redirectUrl);
    }
  });
}
