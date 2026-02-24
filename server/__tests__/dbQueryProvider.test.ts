import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerDbQueryProviders,
  isDbQueryProviderRegistered,
  queryAdGroupById,
  queryKeywordById,
  queryProductTargetById,
  queryDb,
} from '../utils/dbQueryProvider';

// 在每个测试前重置模块状态
// 由于模块级变量是持久的，需要重新导入或手动重置
// 这里通过重新注册来测试

describe('dbQueryProvider', () => {
  describe('registerDbQueryProviders', () => {
    it('should register providers and mark as registered', () => {
      const mockProviders = {
        getAdGroupById: vi.fn().mockResolvedValue({ id: 1, campaignId: '100' }),
        getKeywordById: vi.fn().mockResolvedValue({ id: 2, adGroupId: 10 }),
        getProductTargetById: vi.fn().mockResolvedValue({ id: 3, adGroupId: 20 }),
        getDb: vi.fn().mockResolvedValue({}),
      };

      registerDbQueryProviders(mockProviders);
      expect(isDbQueryProviderRegistered()).toBe(true);
    });
  });

  describe('query functions', () => {
    const mockAdGroup = { id: 1, campaignId: '100', name: 'Test AdGroup' };
    const mockKeyword = { id: 2, adGroupId: 10, text: 'test keyword' };
    const mockProductTarget = { id: 3, adGroupId: 20, expression: 'asin=B001' };
    const mockDb = { select: vi.fn() };

    beforeEach(() => {
      registerDbQueryProviders({
        getAdGroupById: vi.fn().mockResolvedValue(mockAdGroup),
        getKeywordById: vi.fn().mockResolvedValue(mockKeyword),
        getProductTargetById: vi.fn().mockResolvedValue(mockProductTarget),
        getDb: vi.fn().mockResolvedValue(mockDb),
      });
    });

    it('should query ad group by id', async () => {
      const result = await queryAdGroupById(1);
      expect(result).toEqual(mockAdGroup);
    });

    it('should query keyword by id', async () => {
      const result = await queryKeywordById(2);
      expect(result).toEqual(mockKeyword);
    });

    it('should query product target by id', async () => {
      const result = await queryProductTargetById(3);
      expect(result).toEqual(mockProductTarget);
    });

    it('should query db', async () => {
      const result = await queryDb();
      expect(result).toEqual(mockDb);
    });

    it('should return null when provider returns null', async () => {
      registerDbQueryProviders({
        getAdGroupById: vi.fn().mockResolvedValue(null),
        getKeywordById: vi.fn().mockResolvedValue(null),
        getProductTargetById: vi.fn().mockResolvedValue(null),
        getDb: vi.fn().mockResolvedValue(null),
      });

      expect(await queryAdGroupById(999)).toBeNull();
      expect(await queryKeywordById(999)).toBeNull();
      expect(await queryProductTargetById(999)).toBeNull();
    });
  });
});
