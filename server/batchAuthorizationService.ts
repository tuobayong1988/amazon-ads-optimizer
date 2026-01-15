/**
 * 批量授权服务
 * 
 * 支持用户一次性授权多个Amazon广告区域（NA/EU/FE）
 * 每个区域包含多个站点，授权后自动创建所有站点账号
 */

import { AmazonAdsApiClient, OAUTH_AUTH_ENDPOINTS, API_ENDPOINTS } from './amazonAdsApi';

// 区域配置
export const REGION_CONFIG = {
  NA: {
    name: '北美区域',
    code: 'NA',
    authEndpoint: OAUTH_AUTH_ENDPOINTS.NA,
    apiEndpoint: API_ENDPOINTS.NA,
    marketplaces: [
      { code: 'US', name: '美国', flag: '🇺🇸', marketplaceId: 'ATVPDKIKX0DER' },
      { code: 'CA', name: '加拿大', flag: '🇨🇦', marketplaceId: 'A2EUQ1WTGCTBG2' },
      { code: 'MX', name: '墨西哥', flag: '🇲🇽', marketplaceId: 'A1AM78C64UM0Y8' },
      { code: 'BR', name: '巴西', flag: '🇧🇷', marketplaceId: 'A2Q3Y263D00KWC' },
    ],
    displayFlags: '🇺🇸🇨🇦🇲🇽🇧🇷',
  },
  EU: {
    name: '欧洲区域',
    code: 'EU',
    authEndpoint: OAUTH_AUTH_ENDPOINTS.EU,
    apiEndpoint: API_ENDPOINTS.EU,
    marketplaces: [
      { code: 'UK', name: '英国', flag: '🇬🇧', marketplaceId: 'A1F83G8C2ARO7P' },
      { code: 'DE', name: '德国', flag: '🇩🇪', marketplaceId: 'A1PA6795UKMFR9' },
      { code: 'FR', name: '法国', flag: '🇫🇷', marketplaceId: 'A13V1IB3VIYBER' },
      { code: 'IT', name: '意大利', flag: '🇮🇹', marketplaceId: 'APJ6JRA9NG5V4' },
      { code: 'ES', name: '西班牙', flag: '🇪🇸', marketplaceId: 'A1RKKUPIHCS9HS' },
      { code: 'NL', name: '荷兰', flag: '🇳🇱', marketplaceId: 'A1805IZSGTT6HS' },
      { code: 'SE', name: '瑞典', flag: '🇸🇪', marketplaceId: 'A2NODRKZP88ZB9' },
      { code: 'PL', name: '波兰', flag: '🇵🇱', marketplaceId: 'A1C3SOZRARQ6R3' },
      { code: 'TR', name: '土耳其', flag: '🇹🇷', marketplaceId: 'A33AVAJ2PDY3EV' },
      { code: 'AE', name: '阿联酋', flag: '🇦🇪', marketplaceId: 'A2VIGQ35RCS4UG' },
      { code: 'SA', name: '沙特', flag: '🇸🇦', marketplaceId: 'A17E79C6D8DWNP' },
      { code: 'EG', name: '埃及', flag: '🇪🇬', marketplaceId: 'ARBP9OOSHTCHU' },
      { code: 'IN', name: '印度', flag: '🇮🇳', marketplaceId: 'A21TJRUUN4KGV' },
    ],
    displayFlags: '🇬🇧🇩🇪🇫🇷🇮🇹🇪🇸',
  },
  FE: {
    name: '远东区域',
    code: 'FE',
    authEndpoint: OAUTH_AUTH_ENDPOINTS.FE,
    apiEndpoint: API_ENDPOINTS.FE,
    marketplaces: [
      { code: 'JP', name: '日本', flag: '🇯🇵', marketplaceId: 'A1VC38T7YXB528' },
      { code: 'AU', name: '澳大利亚', flag: '🇦🇺', marketplaceId: 'A39IBJ37TRP1C6' },
      { code: 'SG', name: '新加坡', flag: '🇸🇬', marketplaceId: 'A19VAU5U5O7RUS' },
    ],
    displayFlags: '🇯🇵🇦🇺🇸🇬',
  },
} as const;

export type RegionCode = keyof typeof REGION_CONFIG;

// 批量授权会话状态
export interface BatchAuthSession {
  sessionId: string;
  userId: number;
  storeName: string;
  regions: {
    code: RegionCode;
    status: 'pending' | 'waiting_code' | 'exchanging' | 'saving' | 'syncing' | 'complete' | 'error';
    authUrl?: string;
    authCode?: string;
    refreshToken?: string;
    profiles?: Array<{
      profileId: string;
      countryCode: string;
      currencyCode: string;
      accountName: string;
    }>;
    error?: string;
    createdAccounts?: number[];
  }[];
  createdAt: Date;
  updatedAt: Date;
}

// 内存存储批量授权会话（生产环境应使用Redis）
const batchAuthSessions = new Map<string, BatchAuthSession>();

/**
 * 生成批量授权会话
 */
export function createBatchAuthSession(
  userId: number,
  storeName: string,
  selectedRegions: RegionCode[]
): BatchAuthSession {
  const sessionId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const session: BatchAuthSession = {
    sessionId,
    userId,
    storeName,
    regions: selectedRegions.map(code => ({
      code,
      status: 'pending',
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  batchAuthSessions.set(sessionId, session);
  return session;
}

/**
 * 获取批量授权会话
 */
export function getBatchAuthSession(sessionId: string): BatchAuthSession | undefined {
  return batchAuthSessions.get(sessionId);
}

/**
 * 更新批量授权会话
 */
export function updateBatchAuthSession(
  sessionId: string,
  updates: Partial<BatchAuthSession>
): BatchAuthSession | undefined {
  const session = batchAuthSessions.get(sessionId);
  if (!session) return undefined;
  
  const updatedSession = {
    ...session,
    ...updates,
    updatedAt: new Date(),
  };
  batchAuthSessions.set(sessionId, updatedSession);
  return updatedSession;
}

/**
 * 更新区域状态
 */
export function updateRegionStatus(
  sessionId: string,
  regionCode: RegionCode,
  updates: Partial<BatchAuthSession['regions'][0]>
): BatchAuthSession | undefined {
  const session = batchAuthSessions.get(sessionId);
  if (!session) return undefined;
  
  const regionIndex = session.regions.findIndex(r => r.code === regionCode);
  if (regionIndex === -1) return undefined;
  
  session.regions[regionIndex] = {
    ...session.regions[regionIndex],
    ...updates,
  };
  session.updatedAt = new Date();
  
  batchAuthSessions.set(sessionId, session);
  return session;
}

/**
 * 生成区域授权URL
 */
export function generateRegionAuthUrl(
  regionCode: RegionCode,
  clientId: string,
  redirectUri: string,
  state?: string
): string {
  const config = REGION_CONFIG[regionCode];
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'advertising::campaign_management',
    response_type: 'code',
    redirect_uri: redirectUri,
  });
  
  if (state) {
    params.append('state', state);
  }
  
  return `${config.authEndpoint}?${params.toString()}`;
}

/**
 * 生成所有选中区域的授权URL
 */
export function generateBatchAuthUrls(
  sessionId: string,
  clientId: string,
  redirectUri: string
): Record<RegionCode, string> {
  const session = batchAuthSessions.get(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  
  const urls: Partial<Record<RegionCode, string>> = {};
  
  for (const region of session.regions) {
    // 在state中包含sessionId和regionCode，用于回调时识别
    const state = `${sessionId}:${region.code}`;
    urls[region.code] = generateRegionAuthUrl(region.code, clientId, redirectUri, state);
    
    // 更新区域状态
    updateRegionStatus(sessionId, region.code, {
      status: 'waiting_code',
      authUrl: urls[region.code],
    });
  }
  
  return urls as Record<RegionCode, string>;
}

/**
 * 清理过期会话（超过1小时）
 */
export function cleanupExpiredSessions(): void {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  for (const [sessionId, session] of batchAuthSessions.entries()) {
    if (session.createdAt < oneHourAgo) {
      batchAuthSessions.delete(sessionId);
    }
  }
}

/**
 * 获取用户的活跃会话
 */
export function getUserActiveSessions(userId: number): BatchAuthSession[] {
  const sessions: BatchAuthSession[] = [];
  
  for (const session of batchAuthSessions.values()) {
    if (session.userId === userId) {
      sessions.push(session);
    }
  }
  
  return sessions;
}

/**
 * 删除会话
 */
export function deleteBatchAuthSession(sessionId: string): boolean {
  return batchAuthSessions.delete(sessionId);
}

/**
 * 获取区域配置信息
 */
export function getRegionInfo(regionCode: RegionCode) {
  return REGION_CONFIG[regionCode];
}

/**
 * 获取所有区域配置
 */
export function getAllRegions() {
  return Object.entries(REGION_CONFIG).map(([regionCode, config]) => ({
    regionCode: regionCode as RegionCode,
    name: config.name,
    authEndpoint: config.authEndpoint,
    apiEndpoint: config.apiEndpoint,
    marketplaces: config.marketplaces,
    displayFlags: config.displayFlags,
  }));
}
