import { describe, expect, it } from "vitest";
import {
  tokenize,
  generateNgrams,
  analyzeNgrams,
  analyzeFunnelMigration,
  detectTrafficConflicts,
  analyzeBidAdjustments,
  classifySearchTerms,
  decideMatchType,
  generateNegativePresets,
} from "./adAutomation";

describe("N-Gram Analysis", () => {
  describe("tokenize", () => {
    it("should split search term into lowercase words", () => {
      const result = tokenize("Wireless Bluetooth Headphones");
      expect(result).toEqual(["wireless", "bluetooth", "headphones"]);
    });

    it("should remove special characters", () => {
      const result = tokenize("iPhone 15 Pro-Max Case!");
      expect(result).toEqual(["iphone", "15", "promax", "case"]);
    });

    it("should filter out single character words", () => {
      const result = tokenize("a big red ball");
      expect(result).toEqual(["big", "red", "ball"]);
    });
  });

  describe("generateNgrams", () => {
    it("should generate 1-grams and 2-grams", () => {
      const tokens = ["wireless", "bluetooth", "headphones"];
      const result = generateNgrams(tokens, 2);
      expect(result).toContain("wireless");
      expect(result).toContain("bluetooth");
      expect(result).toContain("headphones");
      expect(result).toContain("wireless bluetooth");
      expect(result).toContain("bluetooth headphones");
    });
  });

  describe("analyzeNgrams", () => {
    it("should identify negative candidate ngrams from ineffective search terms", () => {
      const searchTerms = [
        { searchTerm: "cheap wireless headphones", clicks: 5, conversions: 0, spend: 10, sales: 0, impressions: 100 },
        { searchTerm: "cheap bluetooth earbuds", clicks: 3, conversions: 0, spend: 6, sales: 0, impressions: 80 },
        { searchTerm: "cheap audio speakers", clicks: 4, conversions: 0, spend: 8, sales: 0, impressions: 90 },
        { searchTerm: "cheap headset gaming", clicks: 2, conversions: 0, spend: 4, sales: 0, impressions: 60 },
        { searchTerm: "cheap earphones wired", clicks: 3, conversions: 0, spend: 6, sales: 0, impressions: 70 },
        { searchTerm: "wireless headphones premium", clicks: 2, conversions: 1, spend: 4, sales: 50, impressions: 50 },
      ];

      const result = analyzeNgrams(searchTerms);
      
      // "cheap" should be identified as a negative candidate (appears 5 times with 0 conversions)
      const cheapNgram = result.find(r => r.ngram === "cheap");
      expect(cheapNgram).toBeDefined();
      expect(cheapNgram?.isNegativeCandidate).toBe(true);
    });

    it("should return empty array for terms with no ineffective patterns", () => {
      const searchTerms = [
        { searchTerm: "premium headphones", clicks: 10, conversions: 5, spend: 20, sales: 250, impressions: 200 },
      ];

      const result = analyzeNgrams(searchTerms);
      const negativeCandidates = result.filter(r => r.isNegativeCandidate);
      expect(negativeCandidates.length).toBe(0);
    });
  });
});

describe("Funnel Migration Analysis", () => {
  describe("analyzeFunnelMigration", () => {
    it("should suggest broad to phrase migration for terms with 3+ conversions", () => {
      const searchTerms = [
        {
          searchTerm: "wireless headphones",
          campaignId: 1,
          campaignName: "Auto Campaign",
          matchType: "broad" as const,
          clicks: 50,
          conversions: 5,
          spend: 100,
          sales: 250,
          roas: 2.5,
          acos: 40,
          cpc: 2,
        },
      ];

      const result = analyzeFunnelMigration(searchTerms);
      
      expect(result.length).toBe(1);
      expect(result[0].fromMatchType).toBe("broad");
      expect(result[0].toMatchType).toBe("phrase");
      expect(result[0].searchTerm).toBe("wireless headphones");
    });

    it("should suggest phrase to exact migration for terms with 10+ conversions and ROAS > 5", () => {
      const searchTerms = [
        {
          searchTerm: "sony wh-1000xm5",
          campaignId: 2,
          campaignName: "Phrase Campaign",
          matchType: "phrase" as const,
          clicks: 100,
          conversions: 15,
          spend: 200,
          sales: 1500,
          roas: 7.5,
          acos: 13.3,
          cpc: 2,
        },
      ];

      const result = analyzeFunnelMigration(searchTerms);
      
      expect(result.length).toBe(1);
      expect(result[0].fromMatchType).toBe("phrase");
      expect(result[0].toMatchType).toBe("exact");
    });

    it("should not suggest migration for terms not meeting criteria", () => {
      const searchTerms = [
        {
          searchTerm: "headphones",
          campaignId: 1,
          campaignName: "Auto Campaign",
          matchType: "broad" as const,
          clicks: 10,
          conversions: 1,
          spend: 20,
          sales: 50,
          roas: 2.5,
          acos: 40,
          cpc: 2,
        },
      ];

      const result = analyzeFunnelMigration(searchTerms);
      expect(result.length).toBe(0);
    });
  });
});

describe("Traffic Conflict Detection", () => {
  describe("detectTrafficConflicts", () => {
    it("should detect conflicts when same search term appears in multiple campaigns", () => {
      const searchTerms = [
        {
          searchTerm: "wireless headphones",
          campaignId: 1,
          campaignName: "Campaign A",
          matchType: "broad" as const,
          clicks: 50,
          conversions: 2,
          spend: 100,
          sales: 100,
          roas: 1.0,
          acos: 100,
          cpc: 2,
        },
        {
          searchTerm: "wireless headphones",
          campaignId: 2,
          campaignName: "Campaign B",
          matchType: "phrase" as const,
          clicks: 30,
          conversions: 5,
          spend: 60,
          sales: 250,
          roas: 4.17,
          acos: 24,
          cpc: 2,
        },
      ];

      const result = detectTrafficConflicts(searchTerms);
      
      expect(result.length).toBe(1);
      expect(result[0].searchTerm).toBe("wireless headphones");
      expect(result[0].campaigns.length).toBe(2);
      expect(result[0].recommendation.winnerCampaign).toBe("Campaign B");
    });

    it("should not report conflicts for unique search terms", () => {
      const searchTerms = [
        {
          searchTerm: "wireless headphones",
          campaignId: 1,
          campaignName: "Campaign A",
          matchType: "broad" as const,
          clicks: 50,
          conversions: 5,
          spend: 100,
          sales: 250,
          roas: 2.5,
          acos: 40,
          cpc: 2,
        },
        {
          searchTerm: "bluetooth earbuds",
          campaignId: 2,
          campaignName: "Campaign B",
          matchType: "phrase" as const,
          clicks: 30,
          conversions: 3,
          spend: 60,
          sales: 150,
          roas: 2.5,
          acos: 40,
          cpc: 2,
        },
      ];

      const result = detectTrafficConflicts(searchTerms);
      expect(result.length).toBe(0);
    });
  });
});

describe("Smart Bidding Analysis", () => {
  describe("analyzeBidAdjustments", () => {
    it("should suggest bid increase for high-performing targets", () => {
      const targets = [
        {
          id: 1,
          type: "keyword" as const,
          name: "wireless headphones",
          campaignId: 1,
          campaignName: "Test Campaign",
          currentBid: 1.0,
          impressions: 1000,
          clicks: 50,
          conversions: 10,
          spend: 50,
          sales: 500,
        },
      ];

      const result = analyzeBidAdjustments(targets, {
        rampUpPercent: 5,
        maxBidMultiplier: 3,
        minImpressions: 100,
        correctionWindow: 14,
        targetAcos: 30,
        targetRoas: 3.33,
      });

      // High ROAS (10) should trigger increase suggestion
      const suggestion = result.find(s => s.targetName === "wireless headphones");
      expect(suggestion).toBeDefined();
      expect(suggestion?.adjustmentType).toBe("increase");
    });

    it("should suggest bid decrease for underperforming targets", () => {
      const targets = [
        {
          id: 1,
          type: "keyword" as const,
          name: "cheap headphones",
          campaignId: 1,
          campaignName: "Test Campaign",
          currentBid: 2.0,
          impressions: 1000,
          clicks: 100,
          conversions: 1,
          spend: 200,
          sales: 50,
        },
      ];

      const result = analyzeBidAdjustments(targets, {
        rampUpPercent: 5,
        maxBidMultiplier: 3,
        minImpressions: 100,
        correctionWindow: 14,
        targetAcos: 30,
        targetRoas: 3.33,
      });

      // Low ROAS (0.25) should trigger decrease suggestion
      const suggestion = result.find(s => s.targetName === "cheap headphones");
      expect(suggestion).toBeDefined();
      expect(suggestion?.adjustmentType).toBe("decrease");
    });
  });
});

describe("Search Term Classification", () => {
  describe("classifySearchTerms", () => {
    it("should classify high relevance terms correctly", () => {
      const searchTerms = ["wireless bluetooth headphones"];
      const productKeywords = ["wireless", "bluetooth", "headphones"];
      const productAttributes = {
        category: "Electronics",
        brand: "TechBrand",
      };

      const result = classifySearchTerms(searchTerms, productKeywords, productAttributes);
      
      expect(result.length).toBe(1);
      expect(result[0].relevance).toBe("high");
    });

    it("should classify unrelated terms correctly", () => {
      const searchTerms = ["free download music"];
      const productKeywords = ["wireless", "bluetooth", "headphones"];
      const productAttributes = {
        category: "Electronics",
        brand: "TechBrand",
      };

      const result = classifySearchTerms(searchTerms, productKeywords, productAttributes);
      
      expect(result.length).toBe(1);
      expect(result[0].relevance).toBe("unrelated");
    });
  });
});

describe("Match Type Decision", () => {
  describe("decideMatchType", () => {
    it("should recommend exact match for brand keywords", () => {
      const result = decideMatchType("TechBrand headphones", {
        productCategory: "Electronics",
        brandName: "TechBrand",
      });

      expect(result.recommendedMatchType).toBe("exact");
    });

    it("should recommend phrase match for category keywords", () => {
      const result = decideMatchType("wireless headphones for running", {
        productCategory: "Wireless Headphones",
        brandName: "TechBrand",
      });

      expect(result.recommendedMatchType).toBe("phrase");
    });
  });
});

describe("Negative Presets Generation", () => {
  describe("generateNegativePresets", () => {
    it("should generate negative presets based on product attributes", () => {
      const result = generateNegativePresets({
        productCategory: "Wireless Headphones",
        brandName: "TechBrand",
        priceRange: "premium",
        targetAudience: "professional",
      });

      expect(result.length).toBeGreaterThan(0);
      // Should include common negative patterns
      expect(result.some(r => r.keyword.includes("free"))).toBe(true);
      expect(result.some(r => r.keyword.includes("cheap"))).toBe(true);
    });
  });
});
