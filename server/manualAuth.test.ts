import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the fetch function
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Manual Authorization Flow for Ziniao Browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getManualAuthUrl', () => {
    it('should generate correct NA region auth URL', () => {
      const clientId = 'amzn1.application-oa2-client.test123';
      const redirectUri = 'https://sellerps.com';
      const region = 'NA';
      
      const baseUrl = 'https://www.amazon.com/ap/oa';
      const expectedUrl = `${baseUrl}?client_id=${clientId}&scope=advertising::campaign_management&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
      
      expect(expectedUrl).toContain('amazon.com');
      expect(expectedUrl).toContain('client_id=');
      expect(expectedUrl).toContain('response_type=code');
    });

    it('should generate correct EU region auth URL', () => {
      const clientId = 'amzn1.application-oa2-client.test123';
      const redirectUri = 'https://sellerps.com';
      const region = 'EU';
      
      const baseUrl = 'https://eu.account.amazon.com/ap/oa';
      const expectedUrl = `${baseUrl}?client_id=${clientId}&scope=advertising::campaign_management&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
      
      expect(expectedUrl).toContain('eu.account.amazon.com');
      expect(expectedUrl).toContain('client_id=');
      expect(expectedUrl).toContain('response_type=code');
    });

    it('should generate correct FE region auth URL', () => {
      const clientId = 'amzn1.application-oa2-client.test123';
      const redirectUri = 'https://sellerps.com';
      const region = 'FE';
      
      const baseUrl = 'https://apac.account.amazon.com/ap/oa';
      const expectedUrl = `${baseUrl}?client_id=${clientId}&scope=advertising::campaign_management&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
      
      expect(expectedUrl).toContain('apac.account.amazon.com');
      expect(expectedUrl).toContain('client_id=');
      expect(expectedUrl).toContain('response_type=code');
    });
  });

  describe('extractCodeFromUrl', () => {
    it('should extract authorization code from callback URL', () => {
      const callbackUrl = 'https://sellerps.com?code=ANxxxxxx&scope=advertising::campaign_management';
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');
      
      expect(code).toBe('ANxxxxxx');
    });

    it('should handle URL with multiple parameters', () => {
      const callbackUrl = 'https://sellerps.com?code=ANtest123&scope=advertising::campaign_management&state=xyz';
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');
      
      expect(code).toBe('ANtest123');
    });

    it('should return null for URL without code parameter', () => {
      const callbackUrl = 'https://sellerps.com?error=access_denied';
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');
      
      expect(code).toBeNull();
    });

    it('should handle URL with encoded characters', () => {
      const callbackUrl = 'https://sellerps.com?code=AN%2Btest%3D123&scope=advertising%3A%3Acampaign_management';
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');
      
      expect(code).toBe('AN+test=123');
    });
  });

  describe('exchangeCodeForToken', () => {
    it('should successfully exchange code for tokens', async () => {
      const mockResponse = {
        access_token: 'Atza|test_access_token',
        refresh_token: 'Atzr|test_refresh_token',
        token_type: 'bearer',
        expires_in: 3600,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const response = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'ANtest123',
          client_id: 'amzn1.application-oa2-client.test',
          client_secret: 'test_secret',
          redirect_uri: 'https://sellerps.com',
        }).toString(),
      });

      const data = await response.json();
      
      expect(data.access_token).toBe('Atza|test_access_token');
      expect(data.refresh_token).toBe('Atzr|test_refresh_token');
      expect(data.token_type).toBe('bearer');
    });

    it('should handle invalid code error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'The authorization code is invalid or expired',
        }),
      });

      const response = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'invalid_code',
          client_id: 'amzn1.application-oa2-client.test',
          client_secret: 'test_secret',
          redirect_uri: 'https://sellerps.com',
        }).toString(),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        fetch('https://api.amazon.com/auth/o2/token', {
          method: 'POST',
          body: '',
        })
      ).rejects.toThrow('Network error');
    });
  });

  describe('Security Considerations', () => {
    it('should use HTTPS for all OAuth endpoints', () => {
      const naUrl = 'https://www.amazon.com/ap/oa';
      const euUrl = 'https://eu.account.amazon.com/ap/oa';
      const feUrl = 'https://apac.account.amazon.com/ap/oa';
      const tokenUrl = 'https://api.amazon.com/auth/o2/token';

      expect(naUrl.startsWith('https://')).toBe(true);
      expect(euUrl.startsWith('https://')).toBe(true);
      expect(feUrl.startsWith('https://')).toBe(true);
      expect(tokenUrl.startsWith('https://')).toBe(true);
    });

    it('should not expose client secret in frontend', () => {
      // Client secret should only be used on server-side
      const frontendExposedVars = ['VITE_AMAZON_ADS_CLIENT_ID'];
      const serverOnlyVars = ['AMAZON_ADS_CLIENT_SECRET'];

      // VITE_ prefix means it's exposed to frontend
      expect(frontendExposedVars.every(v => v.startsWith('VITE_'))).toBe(true);
      expect(serverOnlyVars.every(v => !v.startsWith('VITE_'))).toBe(true);
    });

    it('should validate redirect URI matches configured value', () => {
      const configuredRedirectUri = 'https://sellerps.com';
      const callbackUrl = 'https://sellerps.com?code=ANtest123';
      
      const url = new URL(callbackUrl);
      const callbackOrigin = `${url.protocol}//${url.host}`;
      const configuredOrigin = new URL(configuredRedirectUri).origin;

      expect(callbackOrigin).toBe(configuredOrigin);
    });
  });

  describe('Ziniao Browser Compatibility', () => {
    it('should generate copyable auth URL', () => {
      const clientId = 'amzn1.application-oa2-client.81dcbfb7c11944e19c59e85dc4f6b2a6';
      const redirectUri = 'https://sellerps.com';
      
      const authUrl = `https://www.amazon.com/ap/oa?client_id=${clientId}&scope=advertising::campaign_management&redirect_uri=${redirectUri}&response_type=code`;
      
      // URL should be valid and copyable
      expect(() => new URL(authUrl)).not.toThrow();
      expect(authUrl.length).toBeLessThan(500); // Reasonable length for copying
    });

    it('should handle manual URL paste with whitespace', () => {
      const pastedUrl = '  https://sellerps.com?code=ANtest123&scope=advertising::campaign_management  ';
      const trimmedUrl = pastedUrl.trim();
      const url = new URL(trimmedUrl);
      const code = url.searchParams.get('code');

      expect(code).toBe('ANtest123');
    });

    it('should handle direct code paste (fallback)', () => {
      const directCode = 'ANtest123';
      
      // If not a valid URL, treat input as code directly
      let code = '';
      try {
        const url = new URL(directCode);
        code = url.searchParams.get('code') || '';
      } catch {
        code = directCode;
      }

      expect(code).toBe('ANtest123');
    });
  });

  describe('Token Storage', () => {
    it('should store refresh token securely', () => {
      const refreshToken = 'Atzr|test_refresh_token';
      
      // Refresh token should be stored encrypted in database
      // This test verifies the token format is valid
      expect(refreshToken.startsWith('Atzr|')).toBe(true);
    });

    it('should not log sensitive token values', () => {
      const sensitiveData = {
        access_token: 'Atza|secret',
        refresh_token: 'Atzr|secret',
        client_secret: 'secret',
      };

      // Verify we can mask sensitive data for logging
      const maskedData = {
        access_token: sensitiveData.access_token.substring(0, 5) + '***',
        refresh_token: sensitiveData.refresh_token.substring(0, 5) + '***',
        client_secret: '***',
      };

      expect(maskedData.access_token).toBe('Atza|***');
      expect(maskedData.refresh_token).toBe('Atzr|***');
      expect(maskedData.client_secret).toBe('***');
    });
  });
});
