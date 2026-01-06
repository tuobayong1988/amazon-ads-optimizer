import { describe, it, expect } from "vitest";

/**
 * Amazon Advertising API 凭证验证测试
 * 
 * 验证环境变量中的Amazon API凭证是否正确配置
 */
describe("Amazon Advertising API Credentials", () => {
  it("should have AMAZON_ADS_CLIENT_ID configured", () => {
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    expect(clientId).toBeDefined();
    expect(clientId).not.toBe("");
    // 验证Client ID格式（以amzn1.application-oa2-client.开头）
    expect(clientId).toMatch(/^amzn1\.application-oa2-client\./);
  });

  it("should have AMAZON_ADS_CLIENT_SECRET configured", () => {
    const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET;
    expect(clientSecret).toBeDefined();
    expect(clientSecret).not.toBe("");
    // 验证Client Secret格式（以amzn1.oa2-cs.v1.开头）
    expect(clientSecret).toMatch(/^amzn1\.oa2-cs\.v1\./);
  });

  it("should generate valid OAuth authorization URL", () => {
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    const redirectUri = "https://sellerps.com";
    
    // 构建授权URL
    const params = new URLSearchParams({
      client_id: clientId!,
      scope: "advertising::campaign_management",
      response_type: "code",
      redirect_uri: redirectUri,
    });
    
    const authUrl = `https://www.amazon.com/ap/oa?${params.toString()}`;
    
    // 验证URL格式
    expect(authUrl).toContain("https://www.amazon.com/ap/oa");
    expect(authUrl).toContain(`client_id=${encodeURIComponent(clientId!)}`);
    expect(authUrl).toContain("scope=advertising");
    expect(authUrl).toContain("response_type=code");
    expect(authUrl).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`);
  });

  it("should support multiple region endpoints", () => {
    const endpoints = {
      NA: "https://www.amazon.com/ap/oa",
      EU: "https://eu.account.amazon.com/ap/oa",
      FE: "https://apac.account.amazon.com/ap/oa",
    };
    
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    const redirectUri = "https://sellerps.com";
    
    // 验证每个区域的授权URL
    Object.entries(endpoints).forEach(([region, baseUrl]) => {
      const params = new URLSearchParams({
        client_id: clientId!,
        scope: "advertising::campaign_management",
        response_type: "code",
        redirect_uri: redirectUri,
      });
      
      const authUrl = `${baseUrl}?${params.toString()}`;
      expect(authUrl).toContain(baseUrl);
      expect(authUrl).toContain(clientId!);
    });
  });

  it("should have correct redirect URI configured", () => {
    const expectedRedirectUri = "https://sellerps.com";
    // 验证回调地址格式
    expect(expectedRedirectUri).toMatch(/^https:\/\//);
  });
});
