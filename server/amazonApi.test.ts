import { describe, expect, it, vi } from "vitest";
import { 
  AmazonAdsApiClient, 
  API_ENDPOINTS, 
  MARKETPLACE_TO_REGION,
} from "./amazonAdsApi";

describe("Amazon Ads API Client", () => {
  describe("API_ENDPOINTS", () => {
    it("should have correct endpoint URLs for each region", () => {
      expect(API_ENDPOINTS.NA).toBe("https://advertising-api.amazon.com");
      expect(API_ENDPOINTS.EU).toBe("https://advertising-api-eu.amazon.com");
      expect(API_ENDPOINTS.FE).toBe("https://advertising-api-fe.amazon.com");
    });
  });

  describe("MARKETPLACE_TO_REGION", () => {
    it("should map US marketplace to NA region", () => {
      expect(MARKETPLACE_TO_REGION.US).toBe("NA");
    });

    it("should map UK marketplace to EU region", () => {
      expect(MARKETPLACE_TO_REGION.UK).toBe("EU");
    });

    it("should map JP marketplace to FE region", () => {
      expect(MARKETPLACE_TO_REGION.JP).toBe("FE");
    });

    it("should map DE marketplace to EU region", () => {
      expect(MARKETPLACE_TO_REGION.DE).toBe("EU");
    });

    it("should map CA marketplace to NA region", () => {
      expect(MARKETPLACE_TO_REGION.CA).toBe("NA");
    });
  });

  describe("generateAuthUrl", () => {
    it("should generate a valid OAuth authorization URL", () => {
      const clientId = "test-client-id";
      const redirectUri = "https://example.com/callback";
      const state = "test-state";

      const authUrl = AmazonAdsApiClient.generateAuthUrl(clientId, redirectUri, state);

      expect(authUrl).toContain("https://www.amazon.com/ap/oa");
      expect(authUrl).toContain(`client_id=${clientId}`);
      expect(authUrl).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`);
      expect(authUrl).toContain(`state=${state}`);
      expect(authUrl).toContain("scope=advertising%3A%3Acampaign_management");
      expect(authUrl).toContain("response_type=code");
    });

    it("should generate URL without state when not provided", () => {
      const clientId = "test-client-id";
      const redirectUri = "https://example.com/callback";

      const authUrl = AmazonAdsApiClient.generateAuthUrl(clientId, redirectUri);

      expect(authUrl).toContain("https://www.amazon.com/ap/oa");
      expect(authUrl).toContain(`client_id=${clientId}`);
      expect(authUrl).not.toContain("state=");
    });
  });

  describe("AmazonAdsApiClient constructor", () => {
    it("should create client with correct region endpoint", () => {
      const credentials = {
        clientId: "test-client",
        clientSecret: "test-secret",
        refreshToken: "test-token",
        profileId: "123456",
        region: "NA" as const,
      };

      // Just verify the client can be instantiated without errors
      const client = new AmazonAdsApiClient(credentials);
      expect(client).toBeDefined();
    });

    it("should create client for EU region", () => {
      const credentials = {
        clientId: "test-client",
        clientSecret: "test-secret",
        refreshToken: "test-token",
        profileId: "123456",
        region: "EU" as const,
      };

      const client = new AmazonAdsApiClient(credentials);
      expect(client).toBeDefined();
    });

    it("should create client for FE region", () => {
      const credentials = {
        clientId: "test-client",
        clientSecret: "test-secret",
        refreshToken: "test-token",
        profileId: "123456",
        region: "FE" as const,
      };

      const client = new AmazonAdsApiClient(credentials);
      expect(client).toBeDefined();
    });
  });
});

describe("Marketplace Region Mapping", () => {
  it("should have all North American marketplaces mapped to NA", () => {
    const naMarketplaces = ["US", "CA", "MX", "BR"];
    naMarketplaces.forEach(marketplace => {
      expect(MARKETPLACE_TO_REGION[marketplace]).toBe("NA");
    });
  });

  it("should have all European marketplaces mapped to EU", () => {
    const euMarketplaces = ["UK", "DE", "FR", "IT", "ES", "NL", "SE", "PL", "TR", "AE", "SA", "EG", "IN"];
    euMarketplaces.forEach(marketplace => {
      expect(MARKETPLACE_TO_REGION[marketplace]).toBe("EU");
    });
  });

  it("should have all Far East marketplaces mapped to FE", () => {
    const feMarketplaces = ["JP", "AU", "SG"];
    feMarketplaces.forEach(marketplace => {
      expect(MARKETPLACE_TO_REGION[marketplace]).toBe("FE");
    });
  });
});
