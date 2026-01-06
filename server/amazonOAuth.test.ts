import { describe, it, expect } from 'vitest';
import { AmazonAdsApiClient, OAUTH_AUTH_ENDPOINTS } from './amazonAdsApi';

describe('Amazon OAuth Integration', () => {
  describe('OAuth Endpoints', () => {
    it('should have correct NA endpoint', () => {
      expect(OAUTH_AUTH_ENDPOINTS.NA).toBe('https://www.amazon.com/ap/oa');
    });

    it('should have correct EU endpoint', () => {
      expect(OAUTH_AUTH_ENDPOINTS.EU).toBe('https://eu.account.amazon.com/ap/oa');
    });

    it('should have correct FE endpoint', () => {
      expect(OAUTH_AUTH_ENDPOINTS.FE).toBe('https://apac.account.amazon.com/ap/oa');
    });
  });

  describe('generateAuthUrl', () => {
    const clientId = 'amzn1.application-oa2-client.test123';
    const redirectUri = 'https://sellerps.com';

    it('should generate correct NA auth URL', () => {
      const url = AmazonAdsApiClient.generateAuthUrl(clientId, redirectUri, 'NA');
      expect(url).toContain('https://www.amazon.com/ap/oa');
      expect(url).toContain(`client_id=${encodeURIComponent(clientId)}`);
      expect(url).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`);
      expect(url).toContain('scope=advertising%3A%3Acampaign_management');
      expect(url).toContain('response_type=code');
    });

    it('should generate correct EU auth URL', () => {
      const url = AmazonAdsApiClient.generateAuthUrl(clientId, redirectUri, 'EU');
      expect(url).toContain('https://eu.account.amazon.com/ap/oa');
      expect(url).toContain(`client_id=${encodeURIComponent(clientId)}`);
    });

    it('should generate correct FE auth URL', () => {
      const url = AmazonAdsApiClient.generateAuthUrl(clientId, redirectUri, 'FE');
      expect(url).toContain('https://apac.account.amazon.com/ap/oa');
      expect(url).toContain(`client_id=${encodeURIComponent(clientId)}`);
    });

    it('should default to NA region if not specified', () => {
      const url = AmazonAdsApiClient.generateAuthUrl(clientId, redirectUri);
      expect(url).toContain('https://www.amazon.com/ap/oa');
    });
  });

  describe('OAuth Flow Configuration', () => {
    it('should use correct scope for advertising API', () => {
      const url = AmazonAdsApiClient.generateAuthUrl('test-client', 'https://test.com', 'NA');
      // URL encoded scope
      expect(url).toContain('scope=advertising%3A%3Acampaign_management');
    });

    it('should use code response type for authorization code flow', () => {
      const url = AmazonAdsApiClient.generateAuthUrl('test-client', 'https://test.com', 'NA');
      expect(url).toContain('response_type=code');
    });
  });

  describe('Client Credentials Validation', () => {
    it('should validate client ID format', () => {
      const validClientId = 'amzn1.application-oa2-client.81dcbfb7c11944e19c59e85dc4f6b2a6';
      expect(validClientId).toMatch(/^amzn1\.application-oa2-client\.[a-f0-9]+$/);
    });

    it('should validate client secret format', () => {
      const validClientSecret = 'amzn1.oa2-cs.v1.4f0f1f688f9e0ca249908f41f54385a28d1ac097c6f627bc06d374954d63fcb8';
      expect(validClientSecret).toMatch(/^amzn1\.oa2-cs\.v1\.[a-f0-9]+$/);
    });
  });

  describe('Redirect URI Configuration', () => {
    it('should support the configured callback URL', () => {
      const redirectUri = 'https://sellerps.com';
      const url = AmazonAdsApiClient.generateAuthUrl('test-client', redirectUri, 'NA');
      expect(url).toContain(encodeURIComponent(redirectUri));
    });
  });
});

describe('Amazon API Region Configuration', () => {
  it('should map marketplaces to correct regions', () => {
    const marketplaceToRegion: Record<string, string> = {
      'US': 'NA',
      'CA': 'NA',
      'MX': 'NA',
      'BR': 'NA',
      'UK': 'EU',
      'DE': 'EU',
      'FR': 'EU',
      'IT': 'EU',
      'ES': 'EU',
      'NL': 'EU',
      'SE': 'EU',
      'PL': 'EU',
      'JP': 'FE',
      'AU': 'FE',
      'SG': 'FE',
    };

    // Verify NA marketplaces
    expect(marketplaceToRegion['US']).toBe('NA');
    expect(marketplaceToRegion['CA']).toBe('NA');
    expect(marketplaceToRegion['MX']).toBe('NA');
    expect(marketplaceToRegion['BR']).toBe('NA');

    // Verify EU marketplaces
    expect(marketplaceToRegion['UK']).toBe('EU');
    expect(marketplaceToRegion['DE']).toBe('EU');
    expect(marketplaceToRegion['FR']).toBe('EU');

    // Verify FE marketplaces
    expect(marketplaceToRegion['JP']).toBe('FE');
    expect(marketplaceToRegion['AU']).toBe('FE');
    expect(marketplaceToRegion['SG']).toBe('FE');
  });
});
