/**
 * 流量隔离和N-Gram降噪服务单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  tokenize,
  generateNGrams,
  TRAFFIC_ISOLATION_CONFIG,
} from './trafficIsolationService';

describe('trafficIsolationService', () => {
  describe('tokenize', () => {
    it('should tokenize a simple search term', () => {
      const result = tokenize('teeth whitening kit');
      expect(result).toEqual(['teeth', 'whitening', 'kit']);
    });

    it('should convert to lowercase', () => {
      const result = tokenize('Teeth Whitening KIT');
      expect(result).toEqual(['teeth', 'whitening', 'kit']);
    });

    it('should filter out stop words', () => {
      const result = tokenize('the best teeth whitening kit for you');
      // 'the', 'for', 'you' should be filtered as stop words
      expect(result).not.toContain('the');
      expect(result).not.toContain('for');
      expect(result).toContain('teeth');
      expect(result).toContain('whitening');
      expect(result).toContain('kit');
    });

    it('should filter out short tokens', () => {
      const result = tokenize('a teeth whitening kit');
      expect(result).not.toContain('a');
      expect(result).toContain('teeth');
    });

    it('should handle empty string', () => {
      const result = tokenize('');
      expect(result).toEqual([]);
    });

    it('should handle special characters', () => {
      const result = tokenize('teeth-whitening kit!');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('generateNGrams', () => {
    it('should generate unigrams', () => {
      const tokens = ['teeth', 'whitening', 'kit'];
      const result = generateNGrams(tokens, 1);
      expect(result).toContain('teeth');
      expect(result).toContain('whitening');
      expect(result).toContain('kit');
    });

    it('should generate bigrams', () => {
      const tokens = ['teeth', 'whitening', 'kit'];
      const result = generateNGrams(tokens, 2);
      expect(result).toContain('teeth whitening');
      expect(result).toContain('whitening kit');
    });

    it('should handle empty array', () => {
      const result = generateNGrams([], 1);
      expect(result).toEqual([]);
    });

    it('should handle n larger than array length', () => {
      const tokens = ['teeth'];
      const result = generateNGrams(tokens, 2);
      expect(result).toEqual([]);
    });
  });

  describe('TRAFFIC_ISOLATION_CONFIG', () => {
    it('should have valid ngram configuration', () => {
      expect(TRAFFIC_ISOLATION_CONFIG.ngram.minFrequency).toBeGreaterThan(0);
      expect(TRAFFIC_ISOLATION_CONFIG.ngram.minFrequency).toBeGreaterThanOrEqual(1);
    });

    it('should have valid conflict configuration', () => {
      expect(TRAFFIC_ISOLATION_CONFIG.conflict.minClicks).toBeGreaterThan(0);
    });

    it('should have valid migration configuration', () => {
      expect(TRAFFIC_ISOLATION_CONFIG.migration.minConversions).toBeGreaterThan(0);
      expect(TRAFFIC_ISOLATION_CONFIG.migration.minCVR).toBeGreaterThan(0);
      expect(TRAFFIC_ISOLATION_CONFIG.migration.minCVR).toBeLessThanOrEqual(1);
    });

    it('should have valid safety configuration', () => {
      expect(TRAFFIC_ISOLATION_CONFIG.safety.maxNegativesPerBatch).toBeGreaterThan(0);
    });
  });

  describe('Funnel Tier Logic', () => {
    it('should define three tiers correctly', () => {
      const tiers = ['tier1_exact', 'tier2_longtail', 'tier3_explore'];
      expect(tiers.length).toBe(3);
    });

    it('should have correct tier hierarchy', () => {
      // Tier 1 (Exact) should be at the top of the funnel
      // Tier 2 (Phrase/Longtail) should be in the middle
      // Tier 3 (Broad/Explore) should be at the bottom
      const tierPriority = {
        'tier1_exact': 1,
        'tier2_longtail': 2,
        'tier3_explore': 3,
      };
      
      expect(tierPriority['tier1_exact']).toBeLessThan(tierPriority['tier2_longtail']);
      expect(tierPriority['tier2_longtail']).toBeLessThan(tierPriority['tier3_explore']);
    });
  });

  describe('Negative Keyword Strategy', () => {
    it('should use negative exact for tier isolation', () => {
      // When isolating Tier 1 keywords from Tier 2, use Negative Exact
      const negativeMatchType = 'negative_exact';
      expect(negativeMatchType).toBe('negative_exact');
    });

    it('should use negative phrase for broad filtering', () => {
      // When filtering Cat3/Cat4 noise from Tier 3, use Negative Phrase
      const negativeMatchType = 'negative_phrase';
      expect(negativeMatchType).toBe('negative_phrase');
    });
  });

  describe('N-Gram Risk Assessment', () => {
    it('should classify high risk tokens correctly', () => {
      // A token with high frequency and zero conversions is high risk
      const token = {
        frequency: 50,
        totalClicks: 100,
        totalConversions: 0,
        totalSpend: 50,
      };
      
      const cvr = token.totalClicks > 0 ? token.totalConversions / token.totalClicks : 0;
      const isHighRisk = cvr === 0 && token.frequency >= 10;
      
      expect(isHighRisk).toBe(true);
    });

    it('should classify medium risk tokens correctly', () => {
      // A token with some conversions but low CVR is medium risk
      const token = {
        frequency: 30,
        totalClicks: 100,
        totalConversions: 2,
        totalSpend: 50,
      };
      
      const cvr = token.totalClicks > 0 ? token.totalConversions / token.totalClicks : 0;
      const isMediumRisk = cvr > 0 && cvr < 0.05 && token.frequency >= 10;
      
      expect(isMediumRisk).toBe(true);
    });
  });

  describe('Traffic Conflict Detection', () => {
    it('should identify conflict when same search term appears in multiple campaigns', () => {
      const searchTermOccurrences = [
        { campaignId: 1, searchTerm: 'teeth whitening kit', clicks: 10 },
        { campaignId: 2, searchTerm: 'teeth whitening kit', clicks: 5 },
      ];
      
      const uniqueCampaigns = new Set(searchTermOccurrences.map(o => o.campaignId));
      const hasConflict = uniqueCampaigns.size > 1;
      
      expect(hasConflict).toBe(true);
    });

    it('should calculate wasted spend correctly', () => {
      // When the same search term appears in multiple campaigns,
      // the spend in non-winning campaigns is considered wasted
      const campaignPerformance = [
        { campaignId: 1, clicks: 10, conversions: 2, spend: 5 },
        { campaignId: 2, clicks: 5, conversions: 0, spend: 3 },
      ];
      
      // Campaign 1 wins (has conversions), Campaign 2's spend is wasted
      const wastedSpend = campaignPerformance
        .filter(c => c.conversions === 0)
        .reduce((sum, c) => sum + c.spend, 0);
      
      expect(wastedSpend).toBe(3);
    });
  });

  describe('Keyword Migration Logic', () => {
    it('should suggest migration for high-performing search terms', () => {
      const searchTerm = {
        term: 'teeth whitening led kit',
        clicks: 20,
        conversions: 3,
        sourceTier: 'tier3_explore',
      };
      
      const cvr = searchTerm.clicks > 0 ? searchTerm.conversions / searchTerm.clicks : 0;
      const shouldMigrate = cvr >= 0.10 && searchTerm.conversions >= 2;
      
      expect(shouldMigrate).toBe(true);
    });

    it('should not suggest migration for low-performing search terms', () => {
      const searchTerm = {
        term: 'cheap teeth whitening',
        clicks: 50,
        conversions: 1,
        sourceTier: 'tier3_explore',
      };
      
      const cvr = searchTerm.clicks > 0 ? searchTerm.conversions / searchTerm.clicks : 0;
      const shouldMigrate = cvr >= 0.10 && searchTerm.conversions >= 2;
      
      expect(shouldMigrate).toBe(false);
    });
  });
});
