/**
 * Amazon API 共享类型定义
 * 
 * 从 amazonSyncService.ts 和 amazonApiHelper.ts 中提取的共享接口和类型。
 * 提取目的：打破 amazonApiHelper -> amazonSyncService 的循环依赖。
 * amazonApiHelper 不再需要导入 AmazonSyncService 类，而是使用此处定义的接口。
 */

/**
 * Amazon API 凭证接口
 * amazonApiHelper 需要的最小凭证信息，不依赖完整的 AmazonSyncService 类
 */
export interface AmazonApiCredentials {
  accessToken: string;
  profileId: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Amazon API 请求上下文
 * 提供 API 调用所需的认证和配置信息
 */
export interface AmazonApiContext {
  getAccessToken(): Promise<string>;
  getProfileId(): string;
  getAccountId(): number;
  getMarketplace?(): string;
}

/**
 * 同步操作结果
 */
export interface SyncOperationResult {
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * 性能分组配置
 */
export interface PerformanceGroupConfig {
  id: number;
  name: string;
  accountId: number;
  targetAcos?: number;
  targetRoas?: number;
  maxBid?: number;
  minBid?: number;
}
