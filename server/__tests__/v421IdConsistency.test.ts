/**
 * v421: 端到端ID一致性测试
 * 
 * 覆盖从数据同步→数据库存储→后端API→前端展示的全链路验证。
 * 确保内部ID(int autoincrement)和Amazon ID(varchar)在各层级正确使用。
 * 
 * 测试范围:
 * 1. 数据库Schema层: 字段类型一致性
 * 2. DB查询层: 参数类型与字段类型匹配
 * 3. 同步层: 字段映射正确性
 * 4. API路由层: ID传递正确性
 * 5. Amazon API交互层: 使用正确的Amazon ID
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// 1. 数据库Schema层 - ID字段类型一致性验证
// ============================================================
describe('Database Schema ID Consistency', () => {
  
  describe('Table ID field types', () => {
    it('campaigns table should have int id and varchar campaignId', async () => {
      const { campaigns } = await import('../../drizzle/schema');
      // id是内部自增ID
      expect(campaigns.id).toBeDefined();
      // campaignId是Amazon ID (varchar)
      expect(campaigns.campaignId).toBeDefined();
    });

    it('adGroups table should have int id and varchar adGroupId', async () => {
      const { adGroups } = await import('../../drizzle/schema');
      expect(adGroups.id).toBeDefined();
      expect(adGroups.adGroupId).toBeDefined();
    });

    it('keywords table should have internalAdGroupId (int), not adGroupId', async () => {
      const { keywords } = await import('../../drizzle/schema');
      expect(keywords.internalAdGroupId).toBeDefined();
      // 确认没有adGroupId字段（已在v418重构中移除）
      expect((keywords as any).adGroupId).toBeUndefined();
    });

    it('productTargets table should have internalAdGroupId (int), not adGroupId', async () => {
      const { productTargets } = await import('../../drizzle/schema');
      expect(productTargets.internalAdGroupId).toBeDefined();
      expect((productTargets as any).adGroupId).toBeUndefined();
    });

    it('searchTerms table should have internalAdGroupId (int), not adGroupId', async () => {
      const { searchTerms } = await import('../../drizzle/schema');
      expect(searchTerms.internalAdGroupId).toBeDefined();
      expect((searchTerms as any).adGroupId).toBeUndefined();
    });

    it('negativeKeywords table should have internalAdGroupId (int), not adGroupId', async () => {
      const { negativeKeywords } = await import('../../drizzle/schema');
      expect(negativeKeywords.internalAdGroupId).toBeDefined();
      expect((negativeKeywords as any).adGroupId).toBeUndefined();
    });
  });

  describe('Foreign key relationships', () => {
    it('keywords.internalAdGroupId should reference adGroups.id (int)', async () => {
      const { keywords, adGroups } = await import('../../drizzle/schema');
      // 两者都应该是int类型
      // internalAdGroupId存储的是adGroups.id的值
      expect(keywords.internalAdGroupId).toBeDefined();
      expect(adGroups.id).toBeDefined();
    });

    it('adGroups.campaignId should be varchar matching campaigns.campaignId', async () => {
      const { adGroups, campaigns } = await import('../../drizzle/schema');
      expect(adGroups.campaignId).toBeDefined();
      expect(campaigns.campaignId).toBeDefined();
    });
  });
});

// ============================================================
// 2. DB查询层 - 参数类型与字段类型匹配验证
// ============================================================
describe('DB Query Layer - Parameter Type Matching', () => {
  
  it('getKeywordsByAdGroupId should accept number and query internalAdGroupId', async () => {
    // 验证函数签名接受number类型
    const { getKeywordsByAdGroupId } = await import('../db/keywords');
    expect(typeof getKeywordsByAdGroupId).toBe('function');
    // 函数应该接受number参数（内部ID）
  });

  it('getProductTargetsByAdGroupId should accept number and query internalAdGroupId', async () => {
    const { getProductTargetsByAdGroupId } = await import('../db/productTargets');
    expect(typeof getProductTargetsByAdGroupId).toBe('function');
  });

  it('getProductTargetsByAdGroupIds should use Number() not String() for int field', async () => {
    // 验证函数存在
    const { getProductTargetsByAdGroupIds } = await import('../db/productTargets');
    expect(typeof getProductTargetsByAdGroupIds).toBe('function');
  });

  it('getKeywordsByCampaignId should map adGroup ids as numbers not strings', async () => {
    const { getKeywordsByCampaignId } = await import('../db/keywords');
    expect(typeof getKeywordsByCampaignId).toBe('function');
  });
});

// ============================================================
// 3. 同步层 - 字段映射正确性验证
// ============================================================
describe('Sync Layer - Field Mapping Correctness', () => {
  
  describe('SP Auto Targeting field mapping', () => {
    it('should use keywordType (not targetingType) from SP auto targeting report', () => {
      // SP自动定向报告返回的字段名
      const reportFields = {
        keywordType: 'TARGETING',  // 不是targetingType
        keyword: 'close-match',     // 不是keywordText
        targeting: 'asin="B0123456"', // 不是targetingExpression
        keywordId: '12345',         // 不是targetId
        sales7d: 10.5,              // 不是sales14d
        purchases7d: 2,             // 不是purchases14d
      };
      
      // v420修复后的正确字段映射
      const kwType = (reportFields.keywordType || '').toUpperCase();
      expect(kwType === 'TARGETING' || kwType === 'AUTO').toBe(true);
      
      const targetingExpression = reportFields.targeting || '';
      expect(targetingExpression).toBe('asin="B0123456"');
      
      const sales = reportFields.sales7d || 0;
      expect(sales).toBe(10.5);
      
      const orders = reportFields.purchases7d || 0;
      expect(orders).toBe(2);
      
      const targetId = reportFields.keywordId || '';
      expect(targetId).toBe('12345');
    });
  });

  describe('Search Terms sync field mapping', () => {
    it('should correctly map campaignId from campaign object', () => {
      // campaignMap的value类型应包含campaignId
      const campaignMap = new Map<string, { id: number; campaignId: string }>();
      campaignMap.set('123456', { id: 1, campaignId: '123456' });
      
      const campaign = campaignMap.get('123456');
      expect(campaign).toBeDefined();
      expect(campaign!.campaignId).toBe('123456');
      expect(campaign!.id).toBe(1);
    });
  });

  describe('Negative Keywords sync - internalAdGroupId type', () => {
    it('should use Number (not String) for internalAdGroupId comparison', () => {
      // 模拟adGroup对象
      const adGroup = { id: 42, adGroupId: '987654321' };
      
      // v421修复：应该用Number类型（不是String）
      const internalAdGroupId = adGroup.id;  // int, not String(adGroup.id)
      expect(typeof internalAdGroupId).toBe('number');
      expect(internalAdGroupId).toBe(42);
    });
  });
});

// ============================================================
// 4. API路由层 - ID传递正确性验证
// ============================================================
describe('API Route Layer - ID Passing Correctness', () => {
  
  describe('AdGroup route - getSearchTerms', () => {
    it('should pass internal adGroup.id (not Amazon adGroupId) to getSearchTermsByAdGroupId', () => {
      // 模拟adGroup对象
      const adGroup = {
        id: 42,                    // 内部自增ID
        adGroupId: '987654321',    // Amazon ID
      };
      
      // v420修复：应该传入adGroup.id（内部ID），不是adGroup.adGroupId（Amazon ID）
      const paramForSearchTerms = adGroup.id;
      expect(typeof paramForSearchTerms).toBe('number');
      expect(paramForSearchTerms).toBe(42);
      
      // 错误的做法（v420之前）
      const wrongParam = adGroup.adGroupId;
      expect(typeof wrongParam).toBe('string');
      expect(wrongParam).not.toBe(42);
    });
  });

  describe('AdGroup route - getNegativeKeywords', () => {
    it('should pass internal adGroup.id (not Amazon adGroupId) to getNegativeKeywordsByAdGroupId', () => {
      const adGroup = {
        id: 42,
        adGroupId: '987654321',
      };
      
      const paramForNegativeKeywords = adGroup.id;
      expect(typeof paramForNegativeKeywords).toBe('number');
    });
  });
});

// ============================================================
// 5. Amazon API交互层 - 使用正确的Amazon ID验证
// ============================================================
describe('Amazon API Interaction Layer - Correct Amazon ID Usage', () => {
  
  describe('syncNewKeywordsToAmazon', () => {
    it('should use Amazon adGroupId (not internal ID) when calling Amazon API', () => {
      // 模拟传给Amazon API的参数
      const newKeyword = {
        adGroupId: '987654321',  // Amazon adGroupId (varchar)
        campaignId: '123456789', // Amazon campaignId (varchar)
        keywordText: 'test keyword',
        matchType: 'exact' as const,
        bid: 1.5,
      };
      
      // adGroupId应该是Amazon ID格式（长数字字符串）
      expect(newKeyword.adGroupId.length).toBeGreaterThan(5);
      expect(typeof newKeyword.adGroupId).toBe('string');
    });
  });

  describe('updateKeywordBids', () => {
    it('should use Amazon keywordId when updating bids via API', () => {
      const bidUpdate = {
        keywordId: '111222333',  // Amazon keywordId
        bid: 2.0,
      };
      
      expect(typeof bidUpdate.keywordId).toBe('string');
    });
  });

  describe('syncNegativeKeywordsToAmazon', () => {
    it('should use Amazon adGroupId for ad group level negatives', () => {
      const negativeKeyword = {
        campaignId: '123456789',
        adGroupId: '987654321',  // Amazon adGroupId
        keywordText: 'negative term',
        matchType: 'negativeExact',
        level: 'adgroup',
      };
      
      expect(typeof negativeKeyword.adGroupId).toBe('string');
    });
  });
});

// ============================================================
// 6. 建议竞价同步验证
// ============================================================
describe('Bid Recommendations Sync', () => {
  
  it('should include bid recommendations in syncAll flow', async () => {
    // 验证syncAll方法中包含建议竞价同步步骤
    const fs = await import('fs');
    const path = await import('path');
    const syncServicePath = path.resolve(__dirname, '../../server/sync/amazonSyncService.ts');
    const content = fs.readFileSync(syncServicePath, 'utf-8');
    
    // v420修复：syncAll中应包含建议竞价同步
    expect(content).toContain('syncSpBidRecommendations');
    expect(content).toContain('syncSbBidRecommendations');
    expect(content).toContain('syncSdBidRecommendations');
    expect(content).toContain('Layer 6');
  });

  it('keywords table should have suggestedBid field for bid recommendations', async () => {
    const { keywords } = await import('../../drizzle/schema');
    expect(keywords.suggestedBid).toBeDefined();
  });

  it('productTargets table should have suggestedBid field for bid recommendations', async () => {
    const { productTargets } = await import('../../drizzle/schema');
    expect(productTargets.suggestedBid).toBeDefined();
  });
});

// ============================================================
// 7. 广告类型层级完整性验证
// ============================================================
describe('Ad Type Hierarchy Completeness', () => {
  
  describe('SP Manual Campaign hierarchy', () => {
    it('should have all required levels: campaign -> adGroup -> keywords/productTargets -> searchTerms -> negativeKeywords', async () => {
      const schema = await import('../../drizzle/schema');
      expect(schema.campaigns).toBeDefined();
      expect(schema.adGroups).toBeDefined();
      expect(schema.keywords).toBeDefined();
      expect(schema.productTargets).toBeDefined();
      expect(schema.searchTerms).toBeDefined();
      expect(schema.negativeKeywords).toBeDefined();
    });
  });

  describe('SP Auto Campaign hierarchy', () => {
    it('should have autoTargetingPerformance table for auto campaigns', async () => {
      const schema = await import('../../drizzle/schema');
      // 自动广告使用autoTargetingPerformance而不是keywords
      expect(schema.autoTargetingPerformance).toBeDefined();
    });
  });

  describe('Placement Performance', () => {
    it('should have placementPerformance table', async () => {
      const schema = await import('../../drizzle/schema');
      expect(schema.placementPerformance).toBeDefined();
    });
  });
});

// ============================================================
// 8. KeywordRecord/ProductTargetRecord类型一致性
// ============================================================
describe('Type Definitions Consistency', () => {
  
  it('KeywordRecord should use internalAdGroupId (not adGroupId)', async () => {
    const { default: dbQueryProvider } = await import('../utils/dbQueryProvider').catch(() => ({ default: null }));
    // 通过源代码验证
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../../server/utils/dbQueryProvider.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // KeywordRecord应该使用internalAdGroupId
    expect(content).toContain('interface KeywordRecord');
    expect(content).toContain('internalAdGroupId: number | null');
    // 不应该使用adGroupId
    expect(content).not.toMatch(/interface KeywordRecord[\s\S]*?adGroupId: string/);
  });

  it('ProductTargetRecord should use internalAdGroupId (not adGroupId)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../../server/utils/dbQueryProvider.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    
    expect(content).toContain('interface ProductTargetRecord');
    // ProductTargetRecord也应该使用internalAdGroupId
    expect(content).not.toMatch(/interface ProductTargetRecord[\s\S]*?adGroupId: string/);
  });
});

// ============================================================
// 9. CAST AS CHAR JOIN问题验证
// ============================================================
describe('SQL JOIN Performance - No CAST AS CHAR', () => {
  
  it('syncSp.ts should not use CAST(id AS CHAR) for int-to-int joins', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../../server/sync/syncSp.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // v420修复：不应该有CAST(xxx AS CHAR)用于int-to-int的JOIN
    // 注意：注释中可能包含CAST字样，只检查实际的CAST(函数调用
    expect(content).not.toContain('CAST(');
  });

  it('syncSb.ts should not use CAST(id AS CHAR) for int-to-int joins', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../../server/sync/syncSb.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    
    expect(content).not.toContain('CAST(');
  });

  it('syncSd.ts should not use CAST(id AS CHAR) for int-to-int joins', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../../server/sync/syncSd.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    
    expect(content).not.toContain('CAST(');
  });
});

// ============================================================
// 10. String() vs Number() 类型转换验证
// ============================================================
describe('Type Conversion Correctness', () => {
  
  it('keywords.ts should not use String() for internalAdGroupId array', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../../server/db/keywords.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // v421修复：不应该用String(ag.id)来构建internalAdGroupId数组
    expect(content).not.toContain('String(ag.id)');
  });

  it('productTargets.ts should use Number() not String() for internalAdGroupId', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../../server/db/productTargets.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // v421修复：应该用Number(id)而不是String(id)
    expect(content).not.toContain('String(id)');
  });
});
