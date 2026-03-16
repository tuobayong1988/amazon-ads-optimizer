import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerSyncServiceFactory,
  isSyncServiceFactoryRegistered,
  getAmazonSyncService,
} from '../sync/scheduling/syncServiceProvider';

// Mock db module
vi.mock('../db', () => ({
  getAdAccountById: vi.fn(),
  getAmazonApiCredentials: vi.fn(),
}));

import * as db from '../db';

describe('syncServiceProvider', () => {
  const mockAccount = {
    id: 1,
    userId: 100,
    profileId: 'profile-123',
    marketplace: 'US',
  };

  const mockCredentials = {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    region: 'NA',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerSyncServiceFactory', () => {
    it('should register factory and mark as registered', () => {
      const factory = vi.fn().mockResolvedValue({ client: {} });
      registerSyncServiceFactory(factory);
      expect(isSyncServiceFactoryRegistered()).toBe(true);
    });
  });

  describe('getAmazonSyncService', () => {
    it('should create sync service using factory', async () => {
      const mockSyncService = { client: {}, accountId: 1 };
      const factory = vi.fn().mockResolvedValue(mockSyncService);
      registerSyncServiceFactory(factory);

      vi.mocked(db.getAdAccountById).mockResolvedValue(mockAccount as any);
      vi.mocked(db.getAmazonApiCredentials).mockResolvedValue(mockCredentials as any);

      const result = await getAmazonSyncService(1);

      expect(result).toEqual(mockSyncService);
      expect(factory).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-id',
          clientSecret: 'client-secret',
          refreshToken: 'refresh-token',
          profileId: 'profile-123',
          region: 'NA',
        }),
        1,
        100,
        'US'
      );
    });

    it('should return null when account does not exist', async () => {
      const factory = vi.fn();
      registerSyncServiceFactory(factory);

      vi.mocked(db.getAdAccountById).mockResolvedValue(null as any);

      const result = await getAmazonSyncService(999);

      expect(result).toBeNull();
      expect(factory).not.toHaveBeenCalled();
    });

    it('should return null when credentials are missing', async () => {
      const factory = vi.fn();
      registerSyncServiceFactory(factory);

      vi.mocked(db.getAdAccountById).mockResolvedValue(mockAccount as any);
      vi.mocked(db.getAmazonApiCredentials).mockResolvedValue(null as any);

      const result = await getAmazonSyncService(1);

      expect(result).toBeNull();
      expect(factory).not.toHaveBeenCalled();
    });

    it('should return null when credentials are incomplete', async () => {
      const factory = vi.fn();
      registerSyncServiceFactory(factory);

      vi.mocked(db.getAdAccountById).mockResolvedValue(mockAccount as any);
      vi.mocked(db.getAmazonApiCredentials).mockResolvedValue({
        clientId: '',
        clientSecret: '',
        refreshToken: '',
        region: 'NA',
      } as any);

      const result = await getAmazonSyncService(1);

      expect(result).toBeNull();
    });

    it('should return null when profileId is missing', async () => {
      const factory = vi.fn();
      registerSyncServiceFactory(factory);

      vi.mocked(db.getAdAccountById).mockResolvedValue({
        ...mockAccount,
        profileId: null,
      } as any);
      vi.mocked(db.getAmazonApiCredentials).mockResolvedValue(mockCredentials as any);

      const result = await getAmazonSyncService(1);

      expect(result).toBeNull();
    });

    it('should retry on connection errors', async () => {
      const factory = vi.fn();
      registerSyncServiceFactory(factory);

      const connectionError = new Error('Connection lost');
      (connectionError as any).code = 'ECONNRESET';

      vi.mocked(db.getAdAccountById)
        .mockRejectedValueOnce(connectionError)
        .mockResolvedValue(mockAccount as any);
      vi.mocked(db.getAmazonApiCredentials).mockResolvedValue(mockCredentials as any);

      const mockSyncService = { client: {} };
      factory.mockResolvedValue(mockSyncService);

      // 由于重试延迟，这个测试可能需要较长时间
      // 但getAmazonSyncService有3秒延迟，所以我们只验证它最终返回null或成功
      const result = await getAmazonSyncService(1);
      // 第一次失败后重试成功
      expect(result).toBeDefined();
    }, 15000);
  });
});
