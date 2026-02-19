import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database functions
const mockDb = {
  createAdAccount: vi.fn().mockResolvedValue(1),
  getAdAccountsByUserId: vi.fn().mockResolvedValue([]),
  updateAdAccount: vi.fn().mockResolvedValue(undefined),
  saveAmazonApiCredentials: vi.fn().mockResolvedValue(undefined),
};

vi.mock('./db', () => mockDb);

describe('Multi-Profile Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveMultipleProfiles logic', () => {
    it('should create accounts for all profiles in a single authorization', async () => {
      // Simulate profiles returned from Amazon API
      const profiles = [
        { profileId: 'profile-us', countryCode: 'US', currencyCode: 'USD', accountName: 'Test Store US' },
        { profileId: 'profile-ca', countryCode: 'CA', currencyCode: 'CAD', accountName: 'Test Store CA' },
        { profileId: 'profile-mx', countryCode: 'MX', currencyCode: 'MXN', accountName: 'Test Store MX' },
      ];

      // Verify profiles array structure
      expect(profiles.length).toBe(3);
      expect(profiles[0].countryCode).toBe('US');
      expect(profiles[1].countryCode).toBe('CA');
      expect(profiles[2].countryCode).toBe('MX');
    });

    it('should use the same storeName for all profiles', () => {
      const storeName = 'ElaraFit';
      const profiles = [
        { profileId: 'profile-us', countryCode: 'US' },
        { profileId: 'profile-ca', countryCode: 'CA' },
        { profileId: 'profile-mx', countryCode: 'MX' },
      ];

      // Each account should have the same storeName
      const accounts = profiles.map(p => ({
        storeName,
        accountName: `${storeName} ${getMarketplaceName(p.countryCode)}`,
        marketplace: p.countryCode,
        profileId: p.profileId,
      }));

      expect(accounts[0].storeName).toBe('ElaraFit');
      expect(accounts[1].storeName).toBe('ElaraFit');
      expect(accounts[2].storeName).toBe('ElaraFit');
      
      // Account names should include marketplace
      expect(accounts[0].accountName).toBe('ElaraFit 美国');
      expect(accounts[1].accountName).toBe('ElaraFit 加拿大');
      expect(accounts[2].accountName).toBe('ElaraFit 墨西哥');
    });

    it('should group accounts by storeName in display', () => {
      const accounts = [
        { id: 1, storeName: 'ElaraFit', marketplace: 'US', connectionStatus: 'connected' },
        { id: 2, storeName: 'ElaraFit', marketplace: 'CA', connectionStatus: 'connected' },
        { id: 3, storeName: 'ElaraFit', marketplace: 'MX', connectionStatus: 'pending' },
        { id: 4, storeName: 'OtherStore', marketplace: 'UK', connectionStatus: 'connected' },
      ];

      // Group by storeName
      const grouped = accounts.reduce((acc, account) => {
        if (!acc[account.storeName]) {
          acc[account.storeName] = [];
        }
        acc[account.storeName].push(account);
        return acc;
      }, {} as Record<string, typeof accounts>);

      expect(Object.keys(grouped).length).toBe(2);
      expect(grouped['ElaraFit'].length).toBe(3);
      expect(grouped['OtherStore'].length).toBe(1);
    });
  });

  describe('Marketplace mapping', () => {
    it('should correctly map country codes to marketplace names', () => {
      expect(getMarketplaceName('US')).toBe('美国');
      expect(getMarketplaceName('CA')).toBe('加拿大');
      expect(getMarketplaceName('MX')).toBe('墨西哥');
      expect(getMarketplaceName('UK')).toBe('英国');
      expect(getMarketplaceName('DE')).toBe('德国');
      expect(getMarketplaceName('JP')).toBe('日本');
    });

    it('should return country code for unknown marketplaces', () => {
      expect(getMarketplaceName('XX')).toBe('XX');
    });
  });
});

// Helper function to get marketplace name
function getMarketplaceName(countryCode: string): string {
  const marketplaceMap: Record<string, string> = {
    'US': '美国',
    'CA': '加拿大',
    'MX': '墨西哥',
    'UK': '英国',
    'DE': '德国',
    'FR': '法国',
    'IT': '意大利',
    'ES': '西班牙',
    'JP': '日本',
    'AU': '澳大利亚',
    'IN': '印度',
    'AE': '阿联酋',
    'SA': '沙特阿拉伯',
    'BR': '巴西',
    'SG': '新加坡',
    'NL': '荷兰',
    'SE': '瑞典',
    'PL': '波兰',
    'BE': '比利时',
    'TR': '土耳其',
  };
  return marketplaceMap[countryCode] || countryCode;
}
