import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  REGION_CONFIG,
  createBatchAuthSession,
  type RegionCode
} from './batchAuthorizationService';

describe('BatchAuthorizationService', () => {
  describe('REGION_CONFIG', () => {
    it('should have three regions defined', () => {
      const regionCodes = Object.keys(REGION_CONFIG);
      expect(regionCodes).toHaveLength(3);
      expect(regionCodes).toContain('NA');
      expect(regionCodes).toContain('EU');
      expect(regionCodes).toContain('FE');
    });

    it('should have NA region with correct marketplaces', () => {
      const naRegion = REGION_CONFIG.NA;
      expect(naRegion).toBeDefined();
      expect(naRegion.name).toBe('北美区域');
      expect(naRegion.code).toBe('NA');
      expect(naRegion.marketplaces).toContainEqual(
        expect.objectContaining({ code: 'US', name: '美国' })
      );
      expect(naRegion.marketplaces).toContainEqual(
        expect.objectContaining({ code: 'CA', name: '加拿大' })
      );
      expect(naRegion.marketplaces).toContainEqual(
        expect.objectContaining({ code: 'MX', name: '墨西哥' })
      );
      expect(naRegion.marketplaces).toContainEqual(
        expect.objectContaining({ code: 'BR', name: '巴西' })
      );
    });

    it('should have EU region with correct marketplaces', () => {
      const euRegion = REGION_CONFIG.EU;
      expect(euRegion).toBeDefined();
      expect(euRegion.name).toBe('欧洲区域');
      expect(euRegion.code).toBe('EU');
      expect(euRegion.marketplaces.length).toBeGreaterThanOrEqual(8);
    });

    it('should have FE region with correct marketplaces', () => {
      const feRegion = REGION_CONFIG.FE;
      expect(feRegion).toBeDefined();
      expect(feRegion.name).toBe('远东区域');
      expect(feRegion.code).toBe('FE');
      expect(feRegion.marketplaces).toContainEqual(
        expect.objectContaining({ code: 'JP', name: '日本' })
      );
      expect(feRegion.marketplaces).toContainEqual(
        expect.objectContaining({ code: 'AU', name: '澳大利亚' })
      );
      expect(feRegion.marketplaces).toContainEqual(
        expect.objectContaining({ code: 'SG', name: '新加坡' })
      );
    });
  });

  describe('Region marketplace IDs', () => {
    it('should have valid marketplace IDs for all NA marketplaces', () => {
      REGION_CONFIG.NA.marketplaces.forEach(mp => {
        expect(mp.marketplaceId).toBeDefined();
        expect(mp.marketplaceId.length).toBeGreaterThan(0);
      });
    });

    it('should have valid marketplace IDs for all EU marketplaces', () => {
      REGION_CONFIG.EU.marketplaces.forEach(mp => {
        expect(mp.marketplaceId).toBeDefined();
        expect(mp.marketplaceId.length).toBeGreaterThan(0);
      });
    });

    it('should have valid marketplace IDs for all FE marketplaces', () => {
      REGION_CONFIG.FE.marketplaces.forEach(mp => {
        expect(mp.marketplaceId).toBeDefined();
        expect(mp.marketplaceId.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Region flags', () => {
    it('should have flag emojis for all marketplaces', () => {
      Object.values(REGION_CONFIG).forEach(region => {
        region.marketplaces.forEach(mp => {
          expect(mp.flag).toBeDefined();
          expect(mp.flag.length).toBeGreaterThan(0);
        });
      });
    });

    it('should have displayFlags for each region', () => {
      expect(REGION_CONFIG.NA.displayFlags).toBeDefined();
      expect(REGION_CONFIG.EU.displayFlags).toBeDefined();
      expect(REGION_CONFIG.FE.displayFlags).toBeDefined();
    });
  });

  describe('Region auth endpoints', () => {
    it('should have authEndpoint for each region', () => {
      expect(REGION_CONFIG.NA.authEndpoint).toBeDefined();
      expect(REGION_CONFIG.EU.authEndpoint).toBeDefined();
      expect(REGION_CONFIG.FE.authEndpoint).toBeDefined();
    });

    it('should have apiEndpoint for each region', () => {
      expect(REGION_CONFIG.NA.apiEndpoint).toBeDefined();
      expect(REGION_CONFIG.EU.apiEndpoint).toBeDefined();
      expect(REGION_CONFIG.FE.apiEndpoint).toBeDefined();
    });
  });

  describe('createBatchAuthSession', () => {
    it('should create a session with correct structure', () => {
      const session = createBatchAuthSession(1, 'TestStore', ['NA', 'EU']);
      
      expect(session).toBeDefined();
      expect(session.sessionId).toMatch(/^batch_\d+_[a-z0-9]+$/);
      expect(session.userId).toBe(1);
      expect(session.storeName).toBe('TestStore');
      expect(session.regions).toHaveLength(2);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
    });

    it('should initialize regions with pending status', () => {
      const session = createBatchAuthSession(1, 'TestStore', ['NA']);
      
      expect(session.regions[0].status).toBe('pending');
      expect(session.regions[0].code).toBe('NA');
    });

    it('should handle multiple regions', () => {
      const session = createBatchAuthSession(1, 'TestStore', ['NA', 'EU', 'FE']);
      
      expect(session.regions).toHaveLength(3);
      expect(session.regions.map(r => r.code)).toEqual(['NA', 'EU', 'FE']);
    });

    it('should generate unique session IDs', () => {
      const session1 = createBatchAuthSession(1, 'Store1', ['NA']);
      const session2 = createBatchAuthSession(1, 'Store2', ['NA']);
      
      expect(session1.sessionId).not.toBe(session2.sessionId);
    });
  });
});
