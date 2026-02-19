import { describe, it, expect } from 'vitest';
import {
  analyzeAutoTargetingPerformance,
  DEFAULT_OPTIMIZATION_PARAMS,
  AutoTargetingPerformance,
  AUTO_TARGETING_TYPE_NAMES
} from './autoTargetingOptimizationService';
import {
  analyzeSBPerformance,
  DEFAULT_SB_OPTIMIZATION_PARAMS,
  SBPerformanceData
} from './sbOptimizationService';
import {
  analyzeSDPerformance,
  DEFAULT_SD_OPTIMIZATION_PARAMS,
  SDPerformanceData
} from './sdOptimizationService';
import {
  categorizeSearchTerm,
  generateSearchTermSuggestions,
  performNGramAnalysis,
  identifyNegativeNGrams,
  DEFAULT_SEARCH_TERM_PARAMS,
  SearchTermPerformance
} from './searchTermAnalysisService';

describe('自动广告匹配类型优化服务', () => {
  describe('analyzeAutoTargetingPerformance', () => {
    it('应该为高ACoS的匹配类型生成降低竞价建议', () => {
      const performance: AutoTargetingPerformance = {
        targetingType: 'close_match',
        impressions: 5000,
        clicks: 50,
        cost: 25,
        sales: 40,
        orders: 2,
        acos: 0.625, // 62.5% ACoS，远高于目标25%
        roas: 1.6,
        ctr: 0.01,
        cvr: 0.04,
        cpc: 0.5
      };

      const suggestion = analyzeAutoTargetingPerformance(performance, 0.5, DEFAULT_OPTIMIZATION_PARAMS);
      
      expect(suggestion).not.toBeNull();
      expect(suggestion?.suggestionType).toBe('decrease_bid');
      expect(suggestion?.suggestedBid).toBeLessThan(0.5);
    });

    it('应该为低ACoS高ROAS的匹配类型生成提高竞价建议', () => {
      const performance: AutoTargetingPerformance = {
        targetingType: 'close_match',
        impressions: 5000,
        clicks: 50,
        cost: 10,
        sales: 100,
        orders: 5,
        acos: 0.10, // 10% ACoS，低于目标25%
        roas: 10,
        ctr: 0.01,
        cvr: 0.10,
        cpc: 0.2
      };

      const suggestion = analyzeAutoTargetingPerformance(performance, 0.2, DEFAULT_OPTIMIZATION_PARAMS);
      
      expect(suggestion).not.toBeNull();
      expect(suggestion?.suggestionType).toBe('increase_bid');
      expect(suggestion?.suggestedBid).toBeGreaterThan(0.2);
    });

    it('应该为无转化的匹配类型生成暂停建议', () => {
      const performance: AutoTargetingPerformance = {
        targetingType: 'complements',
        impressions: 5000,
        clicks: 30, // 超过minClicks * 2
        cost: 15,
        sales: 0,
        orders: 0,
        acos: 0,
        roas: 0,
        ctr: 0.006,
        cvr: 0,
        cpc: 0.5
      };

      const suggestion = analyzeAutoTargetingPerformance(performance, 0.5, DEFAULT_OPTIMIZATION_PARAMS);
      
      expect(suggestion).not.toBeNull();
      expect(suggestion?.suggestionType).toBe('pause');
    });

    it('数据不足时不应生成建议', () => {
      const performance: AutoTargetingPerformance = {
        targetingType: 'loose_match',
        impressions: 500,
        clicks: 5, // 少于minClicks
        cost: 2.5,
        sales: 10,
        orders: 1,
        acos: 0.25,
        roas: 4,
        ctr: 0.01,
        cvr: 0.2,
        cpc: 0.5
      };

      const suggestion = analyzeAutoTargetingPerformance(performance, 0.5, DEFAULT_OPTIMIZATION_PARAMS);
      
      expect(suggestion).toBeNull();
    });
  });

  describe('AUTO_TARGETING_TYPE_NAMES', () => {
    it('应该包含四种匹配类型的中文名称', () => {
      expect(AUTO_TARGETING_TYPE_NAMES.close_match).toBe('紧密匹配');
      expect(AUTO_TARGETING_TYPE_NAMES.loose_match).toBe('宽泛匹配');
      expect(AUTO_TARGETING_TYPE_NAMES.substitutes).toBe('同类商品');
      expect(AUTO_TARGETING_TYPE_NAMES.complements).toBe('关联商品');
    });
  });
});

describe('SB品牌广告优化服务', () => {
  describe('analyzeSBPerformance', () => {
    it('应该为高ACoS的品牌广告生成降低竞价建议', () => {
      const performance: SBPerformanceData = {
        campaignId: 'sb-001',
        campaignType: 'product_collection',
        impressions: 10000,
        clicks: 100,
        cost: 50,
        sales: 80,
        orders: 4,
        acos: 0.625, // 62.5%
        roas: 1.6,
        ctr: 0.01,
        cvr: 0.04,
        cpc: 0.5,
        newToBrandOrders: 2,
        newToBrandSales: 40,
        newToBrandOrdersPercent: 0.5
      };

      const suggestions = analyzeSBPerformance(performance, DEFAULT_SB_OPTIMIZATION_PARAMS);
      
      expect(suggestions.length).toBeGreaterThan(0);
      const bidSuggestion = suggestions.find(s => s.suggestionType === 'bid_adjustment');
      expect(bidSuggestion).toBeDefined();
      expect(bidSuggestion?.priority).toBe('high');
    });

    it('应该为低CTR的品牌广告生成创意优化建议', () => {
      const performance: SBPerformanceData = {
        campaignId: 'sb-002',
        campaignType: 'video',
        impressions: 50000,
        clicks: 50, // CTR = 0.1%
        cost: 25,
        sales: 50,
        orders: 2,
        acos: 0.5,
        roas: 2,
        ctr: 0.001, // 低于0.3%阈值
        cvr: 0.04,
        cpc: 0.5,
        newToBrandOrders: 1,
        newToBrandSales: 25,
        newToBrandOrdersPercent: 0.5
      };

      const suggestions = analyzeSBPerformance(performance, DEFAULT_SB_OPTIMIZATION_PARAMS);
      
      const creativeSuggestion = suggestions.find(s => s.suggestionType === 'creative_optimization');
      expect(creativeSuggestion).toBeDefined();
    });

    it('应该为高绩效品牌广告生成预算重分配建议', () => {
      const performance: SBPerformanceData = {
        campaignId: 'sb-003',
        campaignType: 'store_spotlight',
        impressions: 20000,
        clicks: 200,
        cost: 50,
        sales: 300,
        orders: 15,
        acos: 0.167, // 16.7%，低于目标30%的70%
        roas: 6,
        ctr: 0.01,
        cvr: 0.075,
        cpc: 0.25,
        newToBrandOrders: 8,
        newToBrandSales: 160,
        newToBrandOrdersPercent: 0.53
      };

      const suggestions = analyzeSBPerformance(performance, DEFAULT_SB_OPTIMIZATION_PARAMS);
      
      const budgetSuggestion = suggestions.find(s => s.suggestionType === 'budget_reallocation');
      expect(budgetSuggestion).toBeDefined();
      expect(budgetSuggestion?.priority).toBe('high');
    });

    it('数据不足时应生成扩大定向建议', () => {
      const performance: SBPerformanceData = {
        campaignId: 'sb-004',
        campaignType: 'product_collection',
        impressions: 1000,
        clicks: 5, // 少于minClicks
        cost: 2.5,
        sales: 10,
        orders: 1,
        acos: 0.25,
        roas: 4,
        ctr: 0.005,
        cvr: 0.2,
        cpc: 0.5,
        newToBrandOrders: 0,
        newToBrandSales: 0,
        newToBrandOrdersPercent: 0
      };

      const suggestions = analyzeSBPerformance(performance, DEFAULT_SB_OPTIMIZATION_PARAMS);
      
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].suggestionType).toBe('targeting_expansion');
    });
  });
});

describe('SD展示广告优化服务', () => {
  describe('analyzeSDPerformance', () => {
    it('应该为高ACoS的展示广告生成降低竞价建议', () => {
      const performance: SDPerformanceData = {
        campaignId: 'sd-001',
        audienceType: 'views_remarketing',
        billingType: 'CPC',
        impressions: 50000,
        clicks: 100,
        cost: 80,
        sales: 70,
        orders: 3,
        acos: 0.8, // 80% ACoS，远高于目标35%的1.5倍(52.5%)
        roas: 0.875,
        ctr: 0.002,
        cvr: 0.03,
        cpc: 0.8,
        viewThroughSales: 10,
        viewThroughOrders: 1,
        totalAttributedSales: 80, // 有效ACoS = 80/80 = 100%
        dpvr: 0.6,
        reach: 40000,
        frequency: 1.25
      };

      const suggestions = analyzeSDPerformance(performance, DEFAULT_SD_OPTIMIZATION_PARAMS);
      
      const bidSuggestion = suggestions.find(s => s.suggestionType === 'bid_adjustment');
      expect(bidSuggestion).toBeDefined();
    });

    it('应该为低CTR的展示广告生成创意优化建议', () => {
      const performance: SDPerformanceData = {
        campaignId: 'sd-002',
        audienceType: 'category_targeting',
        billingType: 'CPC',
        impressions: 100000,
        clicks: 50, // CTR = 0.05%
        cost: 25,
        sales: 50,
        orders: 2,
        acos: 0.5,
        roas: 2,
        ctr: 0.0005, // 低于0.1%阈值
        cvr: 0.04,
        cpc: 0.5,
        viewThroughSales: 20,
        viewThroughOrders: 1,
        totalAttributedSales: 70,
        dpvr: 0.5,
        reach: 80000,
        frequency: 1.25
      };

      const suggestions = analyzeSDPerformance(performance, DEFAULT_SD_OPTIMIZATION_PARAMS);
      
      const creativeSuggestion = suggestions.find(s => s.suggestionType === 'creative_optimization');
      expect(creativeSuggestion).toBeDefined();
    });

    it('应该为高频次的展示广告生成受众优化建议', () => {
      const performance: SDPerformanceData = {
        campaignId: 'sd-003',
        audienceType: 'purchases_remarketing',
        billingType: 'CPC',
        impressions: 100000,
        clicks: 200,
        cost: 100,
        sales: 200,
        orders: 10,
        acos: 0.5,
        roas: 2,
        ctr: 0.002,
        cvr: 0.05,
        cpc: 0.5,
        viewThroughSales: 50,
        viewThroughOrders: 3,
        totalAttributedSales: 250,
        dpvr: 0.7,
        reach: 8000,
        frequency: 12.5 // 高于10的阈值
      };

      const suggestions = analyzeSDPerformance(performance, DEFAULT_SD_OPTIMIZATION_PARAMS);
      
      const audienceSuggestion = suggestions.find(s => s.suggestionType === 'audience_optimization');
      expect(audienceSuggestion).toBeDefined();
    });

    it('应该为高绩效展示广告生成扩大定向建议', () => {
      const performance: SDPerformanceData = {
        campaignId: 'sd-004',
        audienceType: 'asin_targeting',
        billingType: 'CPC',
        impressions: 30000,
        clicks: 150,
        cost: 30,
        sales: 150,
        orders: 8,
        acos: 0.2,
        roas: 5,
        ctr: 0.005,
        cvr: 0.053,
        cpc: 0.2,
        viewThroughSales: 50,
        viewThroughOrders: 3,
        totalAttributedSales: 200, // ROAS = 6.67，高于目标2.5的1.5倍
        dpvr: 0.8,
        reach: 25000,
        frequency: 1.2
      };

      const suggestions = analyzeSDPerformance(performance, DEFAULT_SD_OPTIMIZATION_PARAMS);
      
      const expansionSuggestion = suggestions.find(s => s.suggestionType === 'targeting_expansion');
      expect(expansionSuggestion).toBeDefined();
    });
  });
});

describe('搜索词分析服务', () => {
  describe('categorizeSearchTerm', () => {
    it('应该将低ACoS高转化的搜索词分类为高价值词', () => {
      const performance: SearchTermPerformance = {
        searchTerm: 'wireless earbuds',
        campaignId: 'sp-001',
        adGroupId: 'ag-001',
        matchType: 'broad',
        impressions: 5000,
        clicks: 50,
        cost: 15,
        sales: 100,
        orders: 5,
        acos: 0.15, // 15%，低于20%阈值
        roas: 6.67,
        ctr: 0.01,
        cvr: 0.1,
        cpc: 0.3
      };

      const category = categorizeSearchTerm(performance, DEFAULT_SEARCH_TERM_PARAMS);
      expect(category).toBe('high_value');
    });

    it('应该将高ACoS的搜索词分类为低效词', () => {
      const performance: SearchTermPerformance = {
        searchTerm: 'cheap earbuds',
        campaignId: 'sp-001',
        adGroupId: 'ag-001',
        matchType: 'broad',
        impressions: 3000,
        clicks: 30,
        cost: 30,
        sales: 40,
        orders: 2,
        acos: 0.75, // 75%，高于50%阈值
        roas: 1.33,
        ctr: 0.01,
        cvr: 0.067,
        cpc: 1
      };

      const category = categorizeSearchTerm(performance, DEFAULT_SEARCH_TERM_PARAMS);
      expect(category).toBe('low_efficiency');
    });

    it('应该将无转化的搜索词分类为低效词', () => {
      const performance: SearchTermPerformance = {
        searchTerm: 'free earbuds',
        campaignId: 'sp-001',
        adGroupId: 'ag-001',
        matchType: 'broad',
        impressions: 2000,
        clicks: 20,
        cost: 10,
        sales: 0,
        orders: 0,
        acos: 0,
        roas: 0,
        ctr: 0.01,
        cvr: 0,
        cpc: 0.5
      };

      const category = categorizeSearchTerm(performance, DEFAULT_SEARCH_TERM_PARAMS);
      expect(category).toBe('low_efficiency');
    });

    it('应该将数据不足的搜索词分类为数据不足', () => {
      const performance: SearchTermPerformance = {
        searchTerm: 'new earbuds',
        campaignId: 'sp-001',
        adGroupId: 'ag-001',
        matchType: 'broad',
        impressions: 500,
        clicks: 3, // 少于minClicks
        cost: 1.5,
        sales: 10,
        orders: 1,
        acos: 0.15,
        roas: 6.67,
        ctr: 0.006,
        cvr: 0.33,
        cpc: 0.5
      };

      const category = categorizeSearchTerm(performance, DEFAULT_SEARCH_TERM_PARAMS);
      expect(category).toBe('insufficient_data');
    });

    it('应该将包含品牌名的搜索词分类为品牌词', () => {
      const performance: SearchTermPerformance = {
        searchTerm: 'sony wireless earbuds',
        campaignId: 'sp-001',
        adGroupId: 'ag-001',
        matchType: 'broad',
        impressions: 5000,
        clicks: 50,
        cost: 25,
        sales: 100,
        orders: 5,
        acos: 0.25,
        roas: 4,
        ctr: 0.01,
        cvr: 0.1,
        cpc: 0.5
      };

      const category = categorizeSearchTerm(performance, DEFAULT_SEARCH_TERM_PARAMS, ['sony', 'apple']);
      expect(category).toBe('brand_term');
    });
  });

  describe('generateSearchTermSuggestions', () => {
    it('应该为高价值词生成添加为关键词的建议', () => {
      const performance: SearchTermPerformance = {
        searchTerm: 'wireless earbuds',
        campaignId: 'sp-001',
        adGroupId: 'ag-001',
        matchType: 'auto',
        impressions: 5000,
        clicks: 50,
        cost: 15,
        sales: 100,
        orders: 5,
        acos: 0.15,
        roas: 6.67,
        ctr: 0.01,
        cvr: 0.1,
        cpc: 0.3
      };

      const suggestions = generateSearchTermSuggestions(performance, 'high_value', DEFAULT_SEARCH_TERM_PARAMS);
      
      expect(suggestions.length).toBeGreaterThan(0);
      const addKeywordSuggestion = suggestions.find(s => s.type === 'add_as_keyword');
      expect(addKeywordSuggestion).toBeDefined();
      expect(addKeywordSuggestion?.suggestedMatchType).toBe('exact');
    });

    it('应该为低效词生成添加否定词的建议', () => {
      const performance: SearchTermPerformance = {
        searchTerm: 'free earbuds',
        campaignId: 'sp-001',
        adGroupId: 'ag-001',
        matchType: 'broad',
        impressions: 2000,
        clicks: 20,
        cost: 10,
        sales: 0,
        orders: 0,
        acos: 0,
        roas: 0,
        ctr: 0.01,
        cvr: 0,
        cpc: 0.5
      };

      const suggestions = generateSearchTermSuggestions(performance, 'low_efficiency', DEFAULT_SEARCH_TERM_PARAMS);
      
      const negativeSuggestion = suggestions.find(s => s.type === 'add_negative');
      expect(negativeSuggestion).toBeDefined();
      expect(negativeSuggestion?.priority).toBe('high');
    });
  });

  describe('performNGramAnalysis', () => {
    it('应该正确分析搜索词的N-Gram', () => {
      const searchTerms: SearchTermPerformance[] = [
        {
          searchTerm: 'wireless bluetooth earbuds',
          campaignId: 'sp-001',
          adGroupId: 'ag-001',
          matchType: 'broad',
          impressions: 1000,
          clicks: 10,
          cost: 5,
          sales: 20,
          orders: 1,
          acos: 0.25,
          roas: 4,
          ctr: 0.01,
          cvr: 0.1,
          cpc: 0.5
        },
        {
          searchTerm: 'wireless earbuds for running',
          campaignId: 'sp-001',
          adGroupId: 'ag-001',
          matchType: 'broad',
          impressions: 800,
          clicks: 8,
          cost: 4,
          sales: 16,
          orders: 1,
          acos: 0.25,
          roas: 4,
          ctr: 0.01,
          cvr: 0.125,
          cpc: 0.5
        },
        {
          searchTerm: 'bluetooth earbuds cheap',
          campaignId: 'sp-001',
          adGroupId: 'ag-001',
          matchType: 'broad',
          impressions: 500,
          clicks: 5,
          cost: 5,
          sales: 0,
          orders: 0,
          acos: 0,
          roas: 0,
          ctr: 0.01,
          cvr: 0,
          cpc: 1
        }
      ];

      const analysis = performNGramAnalysis(searchTerms);
      
      // 检查unigrams
      const wirelessUnigram = analysis.unigrams.find(u => u.ngram === 'wireless');
      expect(wirelessUnigram).toBeDefined();
      expect(wirelessUnigram?.frequency).toBe(2);

      const earbudsUnigram = analysis.unigrams.find(u => u.ngram === 'earbuds');
      expect(earbudsUnigram).toBeDefined();
      expect(earbudsUnigram?.frequency).toBe(3);

      // 检查bigrams - 注意第一个搜索词是"wireless bluetooth earbuds"，所以bigram是"wireless bluetooth"和"bluetooth earbuds"
      const bluetoothEarbudsBigram = analysis.bigrams.find(b => b.ngram === 'bluetooth earbuds');
      expect(bluetoothEarbudsBigram).toBeDefined();
      expect(bluetoothEarbudsBigram?.frequency).toBe(2);
    });
  });

  describe('identifyNegativeNGrams', () => {
    it('应该识别出需要否定的N-Gram', () => {
      const searchTerms: SearchTermPerformance[] = [
        {
          searchTerm: 'cheap wireless earbuds',
          campaignId: 'sp-001',
          adGroupId: 'ag-001',
          matchType: 'broad',
          impressions: 2000,
          clicks: 20,
          cost: 20,
          sales: 0,
          orders: 0,
          acos: 0,
          roas: 0,
          ctr: 0.01,
          cvr: 0,
          cpc: 1
        },
        {
          searchTerm: 'cheap bluetooth headphones',
          campaignId: 'sp-001',
          adGroupId: 'ag-001',
          matchType: 'broad',
          impressions: 1500,
          clicks: 15,
          cost: 15,
          sales: 0,
          orders: 0,
          acos: 0,
          roas: 0,
          ctr: 0.01,
          cvr: 0,
          cpc: 1
        }
      ];

      const analysis = performNGramAnalysis(searchTerms);
      const negativeNGrams = identifyNegativeNGrams(analysis, DEFAULT_SEARCH_TERM_PARAMS);
      
      // "cheap"应该被识别为需要否定的词
      const cheapNGram = negativeNGrams.find(n => n.ngram === 'cheap');
      expect(cheapNGram).toBeDefined();
    });
  });
});
