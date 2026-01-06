/**
 * Amazon Advertising API Client
 * 
 * 实现Amazon广告API的完整集成，包括：
 * - OAuth 2.0 认证流程
 * - 广告活动管理
 * - 关键词和出价管理
 * - 绩效报告获取
 */

import axios, { AxiosInstance } from 'axios';

// API区域端点
export const API_ENDPOINTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
} as const;

// OAuth端点
const OAUTH_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

// 不同地区的OAuth授权端点
export const OAUTH_AUTH_ENDPOINTS = {
  NA: 'https://www.amazon.com/ap/oa',
  EU: 'https://eu.account.amazon.com/ap/oa',
  FE: 'https://apac.account.amazon.com/ap/oa',
} as const;

// 默认回调地址
export const DEFAULT_REDIRECT_URI = 'https://sellerps.com';

// 市场到区域的映射
export const MARKETPLACE_TO_REGION: Record<string, keyof typeof API_ENDPOINTS> = {
  US: 'NA', CA: 'NA', MX: 'NA', BR: 'NA',
  UK: 'EU', DE: 'EU', FR: 'EU', IT: 'EU', ES: 'EU', NL: 'EU', SE: 'EU', PL: 'EU', TR: 'EU', AE: 'EU', SA: 'EU', EG: 'EU', IN: 'EU',
  JP: 'FE', AU: 'FE', SG: 'FE',
};

// 类型定义
export interface AmazonApiCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: keyof typeof API_ENDPOINTS;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface AmazonProfile {
  profileId: number;
  countryCode: string;
  currencyCode: string;
  dailyBudget: number;
  timezone: string;
  accountInfo: {
    marketplaceStringId: string;
    id: string;
    type: string;
    name: string;
  };
}

export interface SpCampaign {
  campaignId: number;
  name: string;
  state: 'enabled' | 'paused' | 'archived';
  targetingType: 'manual' | 'auto';
  dailyBudget: number;
  startDate: string;
  endDate?: string;
  premiumBidAdjustment: boolean;
  bidding?: {
    strategy: 'legacyForSales' | 'autoForSales' | 'manual';
    adjustments?: Array<{
      predicate: 'placementTop' | 'placementProductPage';
      percentage: number;
    }>;
  };
}

export interface SpAdGroup {
  adGroupId: number;
  campaignId: number;
  name: string;
  state: 'enabled' | 'paused' | 'archived';
  defaultBid: number;
}

export interface SpKeyword {
  keywordId: number;
  adGroupId: number;
  campaignId: number;
  state: 'enabled' | 'paused' | 'archived';
  keywordText: string;
  matchType: 'broad' | 'phrase' | 'exact';
  bid: number;
}

export interface SpProductTarget {
  targetId: number;
  adGroupId: number;
  campaignId: number;
  state: 'enabled' | 'paused' | 'archived';
  expressionType: 'auto' | 'manual';
  expression: Array<{
    type: string;
    value?: string;
  }>;
  bid: number;
}

export interface PerformanceMetrics {
  impressions: number;
  clicks: number;
  cost: number;
  attributedSales14d: number;
  attributedConversions14d: number;
  attributedUnitsOrdered14d: number;
}

export interface CampaignPerformance extends PerformanceMetrics {
  campaignId: number;
  campaignName: string;
}

export interface KeywordPerformance extends PerformanceMetrics {
  keywordId: number;
  keywordText: string;
  matchType: string;
}

/**
 * Amazon Advertising API 客户端类
 */
export class AmazonAdsApiClient {
  private credentials: AmazonApiCredentials;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private axiosInstance: AxiosInstance;

  constructor(credentials: AmazonApiCredentials) {
    this.credentials = credentials;
    this.axiosInstance = axios.create({
      baseURL: API_ENDPOINTS[credentials.region],
      headers: {
        'Amazon-Advertising-API-ClientId': credentials.clientId,
        'Amazon-Advertising-API-Scope': credentials.profileId,
        'Content-Type': 'application/json',
      },
    });

    // 添加请求拦截器自动添加认证头
    this.axiosInstance.interceptors.request.use(async (config) => {
      const token = await this.getAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }

  /**
   * 生成OAuth授权URL
   * @param clientId - 客户端编号
   * @param redirectUri - 回调地址
   * @param region - 地区（NA/EU/FE），默认NA
   * @param state - 状态参数，用于防止CSRF攻击
   */
  static generateAuthUrl(
    clientId: string, 
    redirectUri: string, 
    region: keyof typeof OAUTH_AUTH_ENDPOINTS = 'NA',
    state?: string
  ): string {
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'advertising::campaign_management',
      response_type: 'code',
      redirect_uri: redirectUri,
    });
    if (state) {
      params.append('state', state);
    }
    const authEndpoint = OAUTH_AUTH_ENDPOINTS[region];
    return `${authEndpoint}?${params.toString()}`;
  }

  /**
   * 生成所有地区的OAuth授权URL
   */
  static generateAllRegionAuthUrls(clientId: string, redirectUri: string, state?: string): Record<string, string> {
    return {
      NA: this.generateAuthUrl(clientId, redirectUri, 'NA', state),
      EU: this.generateAuthUrl(clientId, redirectUri, 'EU', state),
      FE: this.generateAuthUrl(clientId, redirectUri, 'FE', state),
    };
  }

  /**
   * 使用授权码获取Token
   */
  static async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): Promise<TokenResponse> {
    const response = await axios.post(OAUTH_TOKEN_URL, new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data;
  }

  /**
   * 获取Access Token（自动刷新）
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await axios.post(OAUTH_TOKEN_URL, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.credentials.refreshToken,
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.accessToken = response.data.access_token;
    this.tokenExpiry = new Date(Date.now() + (response.data.expires_in - 60) * 1000);
    return this.accessToken!;
  }

  /**
   * 获取广告配置文件列表
   */
  async getProfiles(): Promise<AmazonProfile[]> {
    const response = await this.axiosInstance.get('/v2/profiles');
    return response.data;
  }

  // ==================== Sponsored Products API ====================

  /**
   * 获取SP广告活动列表
   */
  async listSpCampaigns(filters?: {
    stateFilter?: string;
    nameFilter?: string;
  }): Promise<SpCampaign[]> {
    const response = await this.axiosInstance.post('/sp/campaigns/list', {
      stateFilter: filters?.stateFilter,
      nameFilter: filters?.nameFilter,
    }, {
      headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json' },
    });
    return response.data.campaigns || [];
  }

  /**
   * 创建SP广告活动
   */
  async createSpCampaign(campaign: Omit<SpCampaign, 'campaignId'>): Promise<SpCampaign> {
    const response = await this.axiosInstance.post('/sp/campaigns', {
      campaigns: [campaign],
    }, {
      headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json' },
    });
    return response.data.campaigns[0];
  }

  /**
   * 更新SP广告活动
   */
  async updateSpCampaign(campaignId: number, updates: Partial<SpCampaign>): Promise<void> {
    await this.axiosInstance.put('/sp/campaigns', {
      campaigns: [{ campaignId, ...updates }],
    }, {
      headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json' },
    });
  }

  /**
   * 获取SP广告组列表
   */
  async listSpAdGroups(campaignId?: number): Promise<SpAdGroup[]> {
    const response = await this.axiosInstance.post('/sp/adGroups/list', {
      campaignIdFilter: campaignId ? { include: [campaignId] } : undefined,
    }, {
      headers: { 'Content-Type': 'application/vnd.spAdGroup.v3+json' },
    });
    return response.data.adGroups || [];
  }

  /**
   * 获取SP关键词列表
   */
  async listSpKeywords(adGroupId?: number): Promise<SpKeyword[]> {
    const response = await this.axiosInstance.post('/sp/keywords/list', {
      adGroupIdFilter: adGroupId ? { include: [adGroupId] } : undefined,
    }, {
      headers: { 'Content-Type': 'application/vnd.spKeyword.v3+json' },
    });
    return response.data.keywords || [];
  }

  /**
   * 更新关键词出价
   */
  async updateKeywordBids(updates: Array<{ keywordId: number; bid: number }>): Promise<void> {
    await this.axiosInstance.put('/sp/keywords', {
      keywords: updates,
    }, {
      headers: { 'Content-Type': 'application/vnd.spKeyword.v3+json' },
    });
  }

  /**
   * 获取SP商品定位列表
   */
  async listSpProductTargets(adGroupId?: number): Promise<SpProductTarget[]> {
    const response = await this.axiosInstance.post('/sp/targets/list', {
      adGroupIdFilter: adGroupId ? { include: [adGroupId] } : undefined,
    }, {
      headers: { 'Content-Type': 'application/vnd.spTargetingClause.v3+json' },
    });
    return response.data.targetingClauses || [];
  }

  /**
   * 更新商品定位出价
   */
  async updateProductTargetBids(updates: Array<{ targetId: number; bid: number }>): Promise<void> {
    await this.axiosInstance.put('/sp/targets', {
      targetingClauses: updates,
    }, {
      headers: { 'Content-Type': 'application/vnd.spTargetingClause.v3+json' },
    });
  }

  // ==================== 报告 API ====================

  /**
   * 请求SP广告活动绩效报告
   */
  async requestSpCampaignReport(
    startDate: string,
    endDate: string,
    metrics: string[] = ['impressions', 'clicks', 'cost', 'attributedSales14d', 'attributedConversions14d']
  ): Promise<string> {
    const response = await this.axiosInstance.post('/sp/campaigns/report', {
      startDate,
      endDate,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['campaign'],
        columns: metrics,
        reportTypeId: 'spCampaigns',
        timeUnit: 'SUMMARY',
        format: 'GZIP_JSON',
      },
    }, {
      headers: { 'Content-Type': 'application/vnd.createasyncreportrequest.v3+json' },
    });
    return response.data.reportId;
  }

  /**
   * 请求SP关键词绩效报告
   */
  async requestSpKeywordReport(
    startDate: string,
    endDate: string,
    metrics: string[] = ['impressions', 'clicks', 'cost', 'attributedSales14d', 'attributedConversions14d']
  ): Promise<string> {
    const response = await this.axiosInstance.post('/sp/keywords/report', {
      startDate,
      endDate,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['keyword'],
        columns: metrics,
        reportTypeId: 'spTargeting',
        timeUnit: 'SUMMARY',
        format: 'GZIP_JSON',
      },
    }, {
      headers: { 'Content-Type': 'application/vnd.createasyncreportrequest.v3+json' },
    });
    return response.data.reportId;
  }

  /**
   * 获取报告状态
   */
  async getReportStatus(reportId: string): Promise<{ status: string; url?: string }> {
    const response = await this.axiosInstance.get(`/reporting/reports/${reportId}`);
    return {
      status: response.data.status,
      url: response.data.url,
    };
  }

  /**
   * 下载报告数据
   */
  async downloadReport(url: string): Promise<any[]> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
    });
    
    // 解压GZIP数据
    const zlib = await import('zlib');
    const decompressed = zlib.gunzipSync(response.data);
    return JSON.parse(decompressed.toString());
  }

  /**
   * 等待报告完成并下载
   */
  async waitAndDownloadReport(reportId: string, maxWaitMs: number = 300000): Promise<any[]> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getReportStatus(reportId);
      
      if (status.status === 'COMPLETED' && status.url) {
        return this.downloadReport(status.url);
      }
      
      if (status.status === 'FAILED') {
        throw new Error('Report generation failed');
      }
      
      // 等待5秒后重试
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    throw new Error('Report generation timeout');
  }

  // ==================== Sponsored Brands API ====================

  /**
   * 获取SB广告活动列表
   */
  async listSbCampaigns(): Promise<any[]> {
    const response = await this.axiosInstance.post('/sb/v4/campaigns/list', {});
    return response.data.campaigns || [];
  }

  /**
   * 更新SB广告活动
   */
  async updateSbCampaign(campaignId: string, updates: any): Promise<void> {
    await this.axiosInstance.put('/sb/v4/campaigns', {
      campaigns: [{ campaignId, ...updates }],
    });
  }

  // ==================== Sponsored Display API ====================

  /**
   * 获取SD广告活动列表
   */
  async listSdCampaigns(): Promise<any[]> {
    const response = await this.axiosInstance.post('/sd/campaigns/list', {});
    return response.data || [];
  }

  /**
   * 更新SD广告活动
   */
  async updateSdCampaign(campaignId: number, updates: any): Promise<void> {
    await this.axiosInstance.put('/sd/campaigns', [{ campaignId, ...updates }]);
  }

  // ==================== 出价建议 API ====================

  /**
   * 获取关键词出价建议
   */
  async getKeywordBidRecommendations(
    adGroupId: number,
    keywords: Array<{ keyword: string; matchType: string }>
  ): Promise<Array<{ keyword: string; suggestedBid: number; rangeStart: number; rangeEnd: number }>> {
    const response = await this.axiosInstance.post('/sp/keywords/bidRecommendations', {
      adGroupId,
      keywords,
    });
    return response.data.recommendations || [];
  }

  /**
   * 获取商品定位出价建议
   */
  async getTargetBidRecommendations(
    adGroupId: number,
    expressions: Array<{ type: string; value?: string }>
  ): Promise<Array<{ expression: any; suggestedBid: number }>> {
    const response = await this.axiosInstance.post('/sp/targets/bidRecommendations', {
      adGroupId,
      expressions,
    });
    return response.data.recommendations || [];
  }
}

/**
 * 创建API客户端实例
 */
export function createAmazonAdsClient(credentials: AmazonApiCredentials): AmazonAdsApiClient {
  return new AmazonAdsApiClient(credentials);
}

/**
 * 验证API凭证是否有效
 */
export async function validateCredentials(credentials: AmazonApiCredentials): Promise<boolean> {
  try {
    const client = new AmazonAdsApiClient(credentials);
    await client.getProfiles();
    return true;
  } catch (error) {
    console.error('API credentials validation failed:', error);
    return false;
  }
}
