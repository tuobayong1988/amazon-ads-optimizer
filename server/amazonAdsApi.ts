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
import JSONBig from 'json-bigint';

// 配置json-bigint，将所有BigInt转换为字符串
const JSONBigString = JSONBig({ storeAsString: true });

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
      // 设置responseType为text，确保axios返回原始字符串
      // 这样json-bigint才能正确解析BigInt
      responseType: 'text',
      // 使用json-bigint解析响应，防止BigInt精度丢失
      transformResponse: [(data) => {
        if (typeof data === 'string') {
          try {
            return JSONBigString.parse(data);
          } catch (e) {
            // 如果解析失败，返回原始数据
            return data;
          }
        }
        return data;
      }],
    });

    // 添加请求拦截器自动添加认证头
    this.axiosInstance.interceptors.request.use(async (config) => {
      const token = await this.getAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    // 添加响应拦截器处理错误
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        // 检查是否返回HTML而不是JSON
        if (error.response) {
          const contentType = error.response.headers['content-type'] || '';
          const data = error.response.data;
          
          // 如果返回的是HTML，提取有用的错误信息
          if (contentType.includes('text/html') || (typeof data === 'string' && data.startsWith('<'))) {
            console.error('[Amazon API] Received HTML response instead of JSON');
            console.error('[Amazon API] Status:', error.response.status);
            console.error('[Amazon API] URL:', error.config?.url);
            
            // 根据状态码提供更有用的错误信息
            let errorMessage = 'Amazon API returned an error page';
            if (error.response.status === 401) {
              errorMessage = 'Token已过期或无效，请重新授权';
            } else if (error.response.status === 403) {
              errorMessage = '没有访问权限，请检查API凭证和权限设置';
            } else if (error.response.status === 404) {
              errorMessage = 'API端点不存在，请检查请求URL';
            } else if (error.response.status === 429) {
              errorMessage = 'API请求过于频繁，请稍后重试';
            } else if (error.response.status >= 500) {
              errorMessage = 'Amazon API服务器错误，请稍后重试';
            }
            
            const enhancedError = new Error(errorMessage);
            (enhancedError as any).originalError = error;
            (enhancedError as any).status = error.response.status;
            (enhancedError as any).isHtmlResponse = true;
            throw enhancedError;
          }
        }
        throw error;
      }
    );
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

    try {
      console.log('[Amazon API] Refreshing access token...');
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
      console.log('[Amazon API] Access token refreshed successfully');
      return this.accessToken!;
    } catch (error: any) {
      console.error('[Amazon API] Failed to refresh access token:', error.message);
      
      // 检查是否返回HTML响应
      if (error.response) {
        const contentType = error.response.headers?.['content-type'] || '';
        const data = error.response.data;
        
        if (contentType.includes('text/html') || (typeof data === 'string' && data.startsWith('<'))) {
          console.error('[Amazon API] Token refresh returned HTML instead of JSON');
          console.error('[Amazon API] Status:', error.response.status);
          throw new Error('Token刷新失败，请重新授权。可能原因：Refresh Token已过期或无效');
        }
        
        if (error.response.status === 400) {
          const errorData = error.response.data;
          if (errorData?.error === 'invalid_grant') {
            throw new Error('Refresh Token已过期或无效，请重新授权');
          }
        }
      }
      
      throw error;
    }
  }

  /**
   * 获取广告配置文件列表
   * 注意：获取profiles时不需要Amazon-Advertising-API-Scope header
   */
  async getProfiles(): Promise<AmazonProfile[]> {
    // 获取profiles时不需要profileId，所以不设置Amazon-Advertising-API-Scope header
    const token = await this.getAccessToken();
    const response = await axios.get(`${API_ENDPOINTS[this.credentials.region]}/v2/profiles`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Amazon-Advertising-API-ClientId': this.credentials.clientId,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  }

  // ==================== Sponsored Products API ====================

  /**
   * 获取SP广告活动列表
   * 注意：SP API v3需要特定的Content-Type header
   * 如果vendor MIME type失败，回退到application/json
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSpCampaigns(filters?: {
    stateFilter?: string;
    nameFilter?: string;
  }): Promise<SpCampaign[]> {
    const allCampaigns: SpCampaign[] = [];
    let nextToken: string | undefined;
    
    // 尝试不同的Content-Type组合
    const headerVariants = [
      { 'Content-Type': 'application/vnd.spCampaign.v3+json', 'Accept': 'application/vnd.spCampaign.v3+json' },
      { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    ];
    
    let workingHeaders: any = null;
    let lastError: any = null;
    
    do {
      const body: any = { maxResults: 100 };
      if (filters?.stateFilter) {
        body.stateFilter = { include: [filters.stateFilter] };
      }
      if (filters?.nameFilter) {
        body.nameFilter = { queryTermMatchType: 'BROAD_MATCH', include: [filters.nameFilter] };
      }
      if (nextToken) {
        body.nextToken = nextToken;
      }
      
      // 如果已经找到可用的headers，直接使用
      if (workingHeaders) {
        try {
          const response = await this.axiosInstance.post('/sp/campaigns/list', body, { headers: workingHeaders });
          const campaigns = response.data.campaigns || [];
          allCampaigns.push(...campaigns);
          nextToken = response.data.nextToken;
          console.log(`[SP API] Fetched ${campaigns.length} campaigns, total: ${allCampaigns.length}, hasMore: ${!!nextToken}`);
        } catch (error: any) {
          console.error('[SP API] Error fetching campaigns:', error.message);
          throw error;
        }
      } else {
        // 第一次请求，尝试不同的headers
        for (const headers of headerVariants) {
          try {
            const response = await this.axiosInstance.post('/sp/campaigns/list', body, { headers });
            workingHeaders = headers;
            const campaigns = response.data.campaigns || [];
            allCampaigns.push(...campaigns);
            nextToken = response.data.nextToken;
            console.log(`[SP API] Fetched ${campaigns.length} campaigns, total: ${allCampaigns.length}, hasMore: ${!!nextToken}`);
            break;
          } catch (error: any) {
            lastError = error;
            if (error.response?.status === 415) {
              console.log(`SP campaigns list failed with headers ${JSON.stringify(headers)}, trying next variant...`);
              continue;
            }
            throw error;
          }
        }
        
        // 如果所有headers都失败
        if (!workingHeaders) {
          throw lastError;
        }
      }
    } while (nextToken);
    
    console.log(`[SP API] Total campaigns fetched: ${allCampaigns.length}`);
    return allCampaigns;
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
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSpAdGroups(campaignId?: number): Promise<SpAdGroup[]> {
    const allAdGroups: SpAdGroup[] = [];
    let nextToken: string | undefined;
    
    const headerVariants = [
      { 'Content-Type': 'application/vnd.spAdGroup.v3+json', 'Accept': 'application/vnd.spAdGroup.v3+json' },
      { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    ];
    
    let workingHeaders: any = null;
    let lastError: any = null;
    
    do {
      const body: any = { maxResults: 100 };
      if (campaignId) {
        body.campaignIdFilter = { include: [campaignId] };
      }
      if (nextToken) {
        body.nextToken = nextToken;
      }
      
      if (workingHeaders) {
        try {
          const response = await this.axiosInstance.post('/sp/adGroups/list', body, { headers: workingHeaders });
          const adGroups = response.data.adGroups || [];
          allAdGroups.push(...adGroups);
          nextToken = response.data.nextToken;
          console.log(`[SP API] Fetched ${adGroups.length} ad groups, total: ${allAdGroups.length}, hasMore: ${!!nextToken}`);
        } catch (error: any) {
          console.error('[SP API] Error fetching ad groups:', error.message);
          throw error;
        }
      } else {
        for (const headers of headerVariants) {
          try {
            const response = await this.axiosInstance.post('/sp/adGroups/list', body, { headers });
            workingHeaders = headers;
            const adGroups = response.data.adGroups || [];
            allAdGroups.push(...adGroups);
            nextToken = response.data.nextToken;
            console.log(`[SP API] Fetched ${adGroups.length} ad groups, total: ${allAdGroups.length}, hasMore: ${!!nextToken}`);
            break;
          } catch (error: any) {
            lastError = error;
            if (error.response?.status === 415) {
              continue;
            }
            throw error;
          }
        }
        
        if (!workingHeaders) {
          throw lastError;
        }
      }
    } while (nextToken);
    
    console.log(`[SP API] Total ad groups fetched: ${allAdGroups.length}`);
    return allAdGroups;
  }

  /**
   * 获取SP关键词列表
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSpKeywords(adGroupId?: number): Promise<SpKeyword[]> {
    const allKeywords: SpKeyword[] = [];
    let nextToken: string | undefined;
    
    const headerVariants = [
      { 'Content-Type': 'application/vnd.spKeyword.v3+json', 'Accept': 'application/vnd.spKeyword.v3+json' },
      { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    ];
    
    let workingHeaders: any = null;
    let lastError: any = null;
    
    do {
      const body: any = { maxResults: 100 };
      if (adGroupId) {
        body.adGroupIdFilter = { include: [adGroupId] };
      }
      if (nextToken) {
        body.nextToken = nextToken;
      }
      
      if (workingHeaders) {
        try {
          const response = await this.axiosInstance.post('/sp/keywords/list', body, { headers: workingHeaders });
          const keywords = response.data.keywords || [];
          allKeywords.push(...keywords);
          nextToken = response.data.nextToken;
          console.log(`[SP API] Fetched ${keywords.length} keywords, total: ${allKeywords.length}, hasMore: ${!!nextToken}`);
        } catch (error: any) {
          console.error('[SP API] Error fetching keywords:', error.message);
          throw error;
        }
      } else {
        for (const headers of headerVariants) {
          try {
            const response = await this.axiosInstance.post('/sp/keywords/list', body, { headers });
            workingHeaders = headers;
            const keywords = response.data.keywords || [];
            allKeywords.push(...keywords);
            nextToken = response.data.nextToken;
            console.log(`[SP API] Fetched ${keywords.length} keywords, total: ${allKeywords.length}, hasMore: ${!!nextToken}`);
            break;
          } catch (error: any) {
            lastError = error;
            if (error.response?.status === 415) {
              continue;
            }
            throw error;
          }
        }
        
        if (!workingHeaders) {
          throw lastError;
        }
      }
    } while (nextToken);
    
    console.log(`[SP API] Total keywords fetched: ${allKeywords.length}`);
    return allKeywords;
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
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSpProductTargets(adGroupId?: number): Promise<SpProductTarget[]> {
    const allTargets: SpProductTarget[] = [];
    let nextToken: string | undefined;
    
    const headerVariants = [
      { 'Content-Type': 'application/vnd.spTargetingClause.v3+json', 'Accept': 'application/vnd.spTargetingClause.v3+json' },
      { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    ];
    
    let workingHeaders: any = null;
    let lastError: any = null;
    
    do {
      const body: any = { maxResults: 100 };
      if (adGroupId) {
        body.adGroupIdFilter = { include: [adGroupId] };
      }
      if (nextToken) {
        body.nextToken = nextToken;
      }
      
      if (workingHeaders) {
        try {
          const response = await this.axiosInstance.post('/sp/targets/list', body, { headers: workingHeaders });
          const targets = response.data.targetingClauses || [];
          allTargets.push(...targets);
          nextToken = response.data.nextToken;
          console.log(`[SP API] Fetched ${targets.length} targets, total: ${allTargets.length}, hasMore: ${!!nextToken}`);
        } catch (error: any) {
          console.error('[SP API] Error fetching targets:', error.message);
          throw error;
        }
      } else {
        for (const headers of headerVariants) {
          try {
            const response = await this.axiosInstance.post('/sp/targets/list', body, { headers });
            workingHeaders = headers;
            const targets = response.data.targetingClauses || [];
            allTargets.push(...targets);
            nextToken = response.data.nextToken;
            console.log(`[SP API] Fetched ${targets.length} targets, total: ${allTargets.length}, hasMore: ${!!nextToken}`);
            break;
          } catch (error: any) {
            lastError = error;
            if (error.response?.status === 415) {
              continue;
            }
            throw error;
          }
        }
        
        if (!workingHeaders) {
          throw lastError;
        }
      }
    } while (nextToken);
    
    console.log(`[SP API] Total targets fetched: ${allTargets.length}`);
    return allTargets;
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
   * 请求SP广告活动绩效报告 (Amazon Ads API v3)
   * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
   */
  async requestSpCampaignReport(
    startDate: string,
    endDate: string,
    metrics: string[] = ['impressions', 'clicks', 'cost', 'sales14d', 'purchases14d']
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SP广告活动报告: ${startDate} - ${endDate}`);
      
      // Amazon Ads Reporting API v3 正确格式
      const requestBody = {
        name: `SP Campaign Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['campaign'],
          columns: [
            'date',
            'campaignId',
            'campaignName',
            'impressions',
            'clicks',
            'cost',
            'sales14d',
            'purchases14d'
          ],
          reportTypeId: 'spCampaigns',
          timeUnit: 'DAILY',
          format: 'GZIP_JSON',
        },
      };
      
      const response = await this.axiosInstance.post('/reporting/reports', requestBody, {
        headers: { 
          'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
          'Accept': 'application/vnd.createasyncreportrequest.v3+json'
        },
      });
      
      console.log(`[Amazon API] 报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SP广告活动报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SP关键词绩效报告 (Amazon Ads API v3)
   * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
   */
  async requestSpKeywordReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SP关键词报告: ${startDate} - ${endDate}`);
      
      // Amazon Ads Reporting API v3 正确格式
      const requestBody = {
        name: `SP Keyword Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['targeting'],
          columns: [
            'date',
            'campaignId',
            'adGroupId',
            'keywordId',
            'keyword',
            'matchType',
            'impressions',
            'clicks',
            'cost',
            'sales14d',
            'purchases14d'
          ],
          reportTypeId: 'spTargeting',
          timeUnit: 'SUMMARY',
          format: 'GZIP_JSON',
        },
      };
      
      const response = await this.axiosInstance.post('/reporting/reports', requestBody, {
        headers: { 
          'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
          'Accept': 'application/vnd.createasyncreportrequest.v3+json'
        },
      });
      
      console.log(`[Amazon API] 关键词报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SP关键词报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SB品牌广告活动报告 (Amazon Ads API v3)
   * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
   * 注意: SB报告使用 'attributedConversions14d' 和 'attributedSales14d' 字段
   */
  async requestSbCampaignReport(
    startDate: string,
    endDate: string,
    metrics: string[] = ['impressions', 'clicks', 'cost', 'attributedConversions14d', 'attributedSales14d']
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SB品牌广告活动报告: ${startDate} - ${endDate}`);
      
      // Amazon Ads Reporting API v3 正确格式
      // SB报告使用 attributedConversions14d 和 attributedSales14d 字段
      const requestBody = {
        name: `SB Campaign Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_BRANDS',
          groupBy: ['campaign'],
          columns: [
            'date',
            'campaignId',
            'campaignName',
            'impressions',
            'clicks',
            'cost',
            'attributedSales14d',        // SB使用 attributedSales14d
            'attributedConversions14d'   // SB使用 attributedConversions14d
          ],
          reportTypeId: 'sbCampaigns',
          timeUnit: 'DAILY',
          format: 'GZIP_JSON',
        },
      };
      
      const response = await this.axiosInstance.post('/reporting/reports', requestBody, {
        headers: { 
          'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
          'Accept': 'application/vnd.createasyncreportrequest.v3+json'
        },
      });
      
      console.log(`[Amazon API] SB报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SB广告活动报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SD展示广告活动报告 (Amazon Ads API v3)
   * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
   * 注意: SD报告使用 'attributedConversions14d' 和 'attributedSales14d' 字段
   */
  async requestSdCampaignReport(
    startDate: string,
    endDate: string,
    metrics: string[] = ['impressions', 'clicks', 'cost', 'attributedConversions14d', 'attributedSales14d']
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SD展示广告活动报告: ${startDate} - ${endDate}`);
      
      // Amazon Ads Reporting API v3 正确格式
      // SD报告使用 attributedConversions14d 和 attributedSales14d 字段
      const requestBody = {
        name: `SD Campaign Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_DISPLAY',
          groupBy: ['campaign'],
          columns: [
            'date',
            'campaignId',
            'campaignName',
            'impressions',
            'clicks',
            'cost',
            'attributedSales14d',        // SD使用 attributedSales14d
            'attributedConversions14d'   // SD使用 attributedConversions14d
          ],
          reportTypeId: 'sdCampaigns',
          timeUnit: 'DAILY',
          format: 'GZIP_JSON',
        },
      };
      
      const response = await this.axiosInstance.post('/reporting/reports', requestBody, {
        headers: { 
          'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
          'Accept': 'application/vnd.createasyncreportrequest.v3+json'
        },
      });
      
      console.log(`[Amazon API] SD报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SD广告活动报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 获取报告状态
   */
  async getReportStatus(reportId: string): Promise<{ status: string; url?: string; failureReason?: string }> {
    try {
      const response = await this.axiosInstance.get(`/reporting/reports/${reportId}`);
      console.log(`[Amazon API] 报告状态响应:`, JSON.stringify(response.data, null, 2));
      return {
        status: response.data.status,
        url: response.data.url,
        failureReason: response.data.failureReason,
      };
    } catch (error: any) {
      console.error(`[Amazon API] 获取报告状态失败:`, error.response?.data || error.message);
      throw error;
    }
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
  async waitAndDownloadReport(reportId: string, maxWaitMs: number = 900000): Promise<any[]> {
    const startTime = Date.now();
    console.log(`[Amazon API] 开始等待报告完成: ${reportId}`);
    
    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getReportStatus(reportId);
      console.log(`[Amazon API] 报告状态: ${status.status}, url: ${status.url ? '有' : '无'}`);
      
      if (status.status === 'COMPLETED' && status.url) {
        console.log(`[Amazon API] 报告已完成，开始下载...`);
        const data = await this.downloadReport(status.url);
        console.log(`[Amazon API] 报告下载完成，数据条数: ${data?.length || 0}`);
        return data;
      }
      
      if (status.status === 'FAILED') {
        console.error(`[Amazon API] 报告生成失败`);
        throw new Error('Report generation failed');
      }
      
      // 等待5秒后重试
      console.log(`[Amazon API] 报告未完成，等待5秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    console.error(`[Amazon API] 报告生成超时`);
    throw new Error('Report generation timeout');
  }

  // ==================== Sponsored Brands API ====================

  /**
   * 获取SB广告活动列表
   * 注意：SB v4 API需要特定的Content-Type header
   */
  async listSbCampaigns(): Promise<any[]> {
    // SB API maxResults最大为100，需要分页获取
    const allCampaigns: any[] = [];
    let nextToken: string | undefined;
    
    do {
      const body: any = { maxResults: 100 };
      if (nextToken) {
        body.nextToken = nextToken;
      }
      
      const response = await this.axiosInstance.post('/sb/v4/campaigns/list', 
        body,
        {
          headers: {
            'Content-Type': 'application/vnd.sbcampaignresource.v4+json',
            'Accept': 'application/vnd.sbcampaignresource.v4+json',
          },
        }
      );
      
      const campaigns = response.data.campaigns || [];
      allCampaigns.push(...campaigns);
      nextToken = response.data.nextToken;
    } while (nextToken);
    
    return allCampaigns;
  }

  /**
   * 获取SB广告组列表
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSbAdGroups(campaignId?: string): Promise<any[]> {
    const allAdGroups: any[] = [];
    let nextToken: string | undefined;
    
    do {
      const body: any = { maxResults: 100 };
      if (campaignId) {
        body.campaignIdFilter = { include: [campaignId] };
      }
      if (nextToken) {
        body.nextToken = nextToken;
      }
      
      const response = await this.axiosInstance.post('/sb/v4/adGroups/list', 
        body,
        {
          headers: {
            'Content-Type': 'application/vnd.sbadgroupresource.v4+json',
            'Accept': 'application/vnd.sbadgroupresource.v4+json',
          },
        }
      );
      
      const adGroups = response.data.adGroups || [];
      allAdGroups.push(...adGroups);
      nextToken = response.data.nextToken;
      console.log(`[SB API] Fetched ${adGroups.length} ad groups, total: ${allAdGroups.length}, hasMore: ${!!nextToken}`);
    } while (nextToken);
    
    console.log(`[SB API] Total ad groups fetched: ${allAdGroups.length}`);
    return allAdGroups;
  }

  /**
   * 获取SB关键词列表
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSbKeywords(adGroupId?: string): Promise<any[]> {
    const allKeywords: any[] = [];
    let nextToken: string | undefined;
    
    do {
      const body: any = { maxResults: 100 };
      if (adGroupId) {
        body.adGroupIdFilter = { include: [adGroupId] };
      }
      if (nextToken) {
        body.nextToken = nextToken;
      }
      
      const response = await this.axiosInstance.post('/sb/v4/keywords/list', 
        body,
        {
          headers: {
            'Content-Type': 'application/vnd.sbkeywordresource.v4+json',
            'Accept': 'application/vnd.sbkeywordresource.v4+json',
          },
        }
      );
      
      const keywords = response.data.keywords || [];
      allKeywords.push(...keywords);
      nextToken = response.data.nextToken;
      console.log(`[SB API] Fetched ${keywords.length} keywords, total: ${allKeywords.length}, hasMore: ${!!nextToken}`);
    } while (nextToken);
    
    console.log(`[SB API] Total keywords fetched: ${allKeywords.length}`);
    return allKeywords;
  }

  /**
   * 获取SB商品定位列表
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSbTargets(adGroupId?: string): Promise<any[]> {
    const allTargets: any[] = [];
    let nextToken: string | undefined;
    
    do {
      const body: any = { maxResults: 100 };
      if (adGroupId) {
        body.adGroupIdFilter = { include: [adGroupId] };
      }
      if (nextToken) {
        body.nextToken = nextToken;
      }
      
      const response = await this.axiosInstance.post('/sb/v4/targets/list', 
        body,
        {
          headers: {
            'Content-Type': 'application/vnd.sbtargetresource.v4+json',
            'Accept': 'application/vnd.sbtargetresource.v4+json',
          },
        }
      );
      
      const targets = response.data.targets || [];
      allTargets.push(...targets);
      nextToken = response.data.nextToken;
      console.log(`[SB API] Fetched ${targets.length} targets, total: ${allTargets.length}, hasMore: ${!!nextToken}`);
    } while (nextToken);
    
    console.log(`[SB API] Total targets fetched: ${allTargets.length}`);
    return allTargets;
  }

  /**
   * 更新SB广告活动
   */
  async updateSbCampaign(campaignId: string, updates: any): Promise<void> {
    await this.axiosInstance.put('/sb/v4/campaigns', 
      { campaigns: [{ campaignId, ...updates }] },
      {
        headers: {
          'Content-Type': 'application/vnd.sbcampaignresource.v4+json',
          'Accept': 'application/vnd.sbcampaignresource.v4+json',
        },
      }
    );
  }

  /**
   * 更新SB关键词出价
   */
  async updateSbKeywordBids(updates: Array<{ keywordId: string; bid: number }>): Promise<void> {
    await this.axiosInstance.put('/sb/v4/keywords', 
      { keywords: updates },
      {
        headers: {
          'Content-Type': 'application/vnd.sbkeywordresource.v4+json',
          'Accept': 'application/vnd.sbkeywordresource.v4+json',
        },
      }
    );
  }

  // ==================== Sponsored Display API ====================

  /**
   * 获取SD广告活动列表
   * 注意：SD API使用GET方法，使用startIndex和count参数进行分页
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSdCampaigns(): Promise<any[]> {
    const allCampaigns: any[] = [];
    let startIndex = 0;
    const count = 100;
    
    while (true) {
      const response = await this.axiosInstance.get('/sd/campaigns', {
        params: { startIndex, count }
      });
      const campaigns = response.data || [];
      allCampaigns.push(...campaigns);
      console.log(`[SD API] Fetched ${campaigns.length} campaigns, total: ${allCampaigns.length}`);
      
      // 如果返回的数据少于请求的数量，说明没有更多数据
      if (campaigns.length < count) {
        break;
      }
      startIndex += count;
    }
    
    console.log(`[SD API] Total campaigns fetched: ${allCampaigns.length}`);
    return allCampaigns;
  }

  /**
   * 获取SD广告组列表
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSdAdGroups(campaignId?: number): Promise<any[]> {
    const allAdGroups: any[] = [];
    let startIndex = 0;
    const count = 100;
    
    while (true) {
      const params: any = { startIndex, count };
      if (campaignId) {
        params.campaignIdFilter = campaignId;
      }
      
      const response = await this.axiosInstance.get('/sd/adGroups', { params });
      const adGroups = response.data || [];
      allAdGroups.push(...adGroups);
      console.log(`[SD API] Fetched ${adGroups.length} ad groups, total: ${allAdGroups.length}`);
      
      if (adGroups.length < count) {
        break;
      }
      startIndex += count;
    }
    
    console.log(`[SD API] Total ad groups fetched: ${allAdGroups.length}`);
    return allAdGroups;
  }

  /**
   * 获取SD商品定位列表
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSdTargets(adGroupId?: number): Promise<any[]> {
    const allTargets: any[] = [];
    let startIndex = 0;
    const count = 100;
    
    while (true) {
      const params: any = { startIndex, count };
      if (adGroupId) {
        params.adGroupIdFilter = adGroupId;
      }
      
      const response = await this.axiosInstance.get('/sd/targets', { params });
      const targets = response.data || [];
      allTargets.push(...targets);
      console.log(`[SD API] Fetched ${targets.length} targets, total: ${allTargets.length}`);
      
      if (targets.length < count) {
        break;
      }
      startIndex += count;
    }
    
    console.log(`[SD API] Total targets fetched: ${allTargets.length}`);
    return allTargets;
  }

  /**
   * 更新SD广告活动
   */
  async updateSdCampaign(campaignId: number, updates: any): Promise<void> {
    await this.axiosInstance.put('/sd/campaigns', [{ campaignId, ...updates }]);
  }

  /**
   * 更新SD商品定位出价
   */
  async updateSdTargetBids(updates: Array<{ targetId: number; bid: number }>): Promise<void> {
    await this.axiosInstance.put('/sd/targets', updates);
  }

  // ==================== 否定关键词 API ====================

  /**
   * 获取SP活动级别否定关键词列表
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSpCampaignNegativeKeywords(campaignId?: number): Promise<any[]> {
    const allNegatives: any[] = [];
    let nextToken: string | undefined;
    
    do {
      const body: any = { maxResults: 100 };
      if (campaignId) {
        body.campaignIdFilter = { include: [campaignId] };
      }
      if (nextToken) {
        body.nextToken = nextToken;
      }
      
      const response = await this.axiosInstance.post('/sp/campaignNegativeKeywords/list', body, {
        headers: { 'Content-Type': 'application/vnd.spCampaignNegativeKeyword.v3+json' },
      });
      
      const negatives = response.data.campaignNegativeKeywords || [];
      allNegatives.push(...negatives);
      nextToken = response.data.nextToken;
      console.log(`[SP API] Fetched ${negatives.length} campaign negative keywords, total: ${allNegatives.length}, hasMore: ${!!nextToken}`);
    } while (nextToken);
    
    console.log(`[SP API] Total campaign negative keywords fetched: ${allNegatives.length}`);
    return allNegatives;
  }

  /**
   * 创建SP活动级别否定关键词
   */
  async createSpCampaignNegativeKeywords(
    negatives: Array<{
      campaignId: number;
      keywordText: string;
      matchType: 'negativeExact' | 'negativePhrase';
      state?: 'enabled' | 'paused';
    }>
  ): Promise<Array<{ keywordId: number; code: string; details: string }>> {
    const response = await this.axiosInstance.post('/sp/campaignNegativeKeywords', {
      campaignNegativeKeywords: negatives.map(n => ({
        ...n,
        state: n.state || 'enabled',
      })),
    }, {
      headers: { 'Content-Type': 'application/vnd.spCampaignNegativeKeyword.v3+json' },
    });
    return response.data.campaignNegativeKeywords || [];
  }

  /**
   * 删除SP活动级别否定关键词
   */
  async deleteSpCampaignNegativeKeywords(keywordIds: number[]): Promise<void> {
    await this.axiosInstance.post('/sp/campaignNegativeKeywords/delete', {
      keywordIdFilter: { include: keywordIds },
    }, {
      headers: { 'Content-Type': 'application/vnd.spCampaignNegativeKeyword.v3+json' },
    });
  }

  /**
   * 获取SP广告组级别否定关键词列表
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSpNegativeKeywords(adGroupId?: number): Promise<any[]> {
    const allNegatives: any[] = [];
    let nextToken: string | undefined;
    
    do {
      const body: any = { maxResults: 100 };
      if (adGroupId) {
        body.adGroupIdFilter = { include: [adGroupId] };
      }
      if (nextToken) {
        body.nextToken = nextToken;
      }
      
      const response = await this.axiosInstance.post('/sp/negativeKeywords/list', body, {
        headers: { 'Content-Type': 'application/vnd.spNegativeKeyword.v3+json' },
      });
      
      const negatives = response.data.negativeKeywords || [];
      allNegatives.push(...negatives);
      nextToken = response.data.nextToken;
      console.log(`[SP API] Fetched ${negatives.length} negative keywords, total: ${allNegatives.length}, hasMore: ${!!nextToken}`);
    } while (nextToken);
    
    console.log(`[SP API] Total negative keywords fetched: ${allNegatives.length}`);
    return allNegatives;
  }

  /**
   * 创建SP广告组级别否定关键词
   */
  async createSpNegativeKeywords(
    negatives: Array<{
      adGroupId: number;
      campaignId: number;
      keywordText: string;
      matchType: 'negativeExact' | 'negativePhrase';
      state?: 'enabled' | 'paused';
    }>
  ): Promise<Array<{ keywordId: number; code: string; details: string }>> {
    const response = await this.axiosInstance.post('/sp/negativeKeywords', {
      negativeKeywords: negatives.map(n => ({
        ...n,
        state: n.state || 'enabled',
      })),
    }, {
      headers: { 'Content-Type': 'application/vnd.spNegativeKeyword.v3+json' },
    });
    return response.data.negativeKeywords || [];
  }

  /**
   * 删除SP广告组级别否定关键词
   */
  async deleteSpNegativeKeywords(keywordIds: number[]): Promise<void> {
    await this.axiosInstance.post('/sp/negativeKeywords/delete', {
      keywordIdFilter: { include: keywordIds },
    }, {
      headers: { 'Content-Type': 'application/vnd.spNegativeKeyword.v3+json' },
    });
  }

  /**
   * 获取SP否定商品定位列表（活动级别）
   */
  async listSpCampaignNegativeTargets(campaignId?: number): Promise<any[]> {
    const body: any = {};
    if (campaignId) {
      body.campaignIdFilter = { include: [campaignId] };
    }
    const response = await this.axiosInstance.post('/sp/campaignNegativeTargets/list', body, {
      headers: { 'Content-Type': 'application/vnd.spCampaignNegativeTargetingClause.v3+json' },
    });
    return response.data.campaignNegativeTargetingClauses || [];
  }

  /**
   * 创建SP否定商品定位（活动级别）
   */
  async createSpCampaignNegativeTargets(
    negatives: Array<{
      campaignId: number;
      expression: Array<{ type: string; value?: string }>;
      state?: 'enabled' | 'paused';
    }>
  ): Promise<Array<{ targetId: number; code: string; details: string }>> {
    const response = await this.axiosInstance.post('/sp/campaignNegativeTargets', {
      campaignNegativeTargetingClauses: negatives.map(n => ({
        ...n,
        state: n.state || 'enabled',
      })),
    }, {
      headers: { 'Content-Type': 'application/vnd.spCampaignNegativeTargetingClause.v3+json' },
    });
    return response.data.campaignNegativeTargetingClauses || [];
  }

  /**
   * 获取SP否定商品定位列表（广告组级别）
   */
  async listSpNegativeTargets(adGroupId?: number): Promise<any[]> {
    const body: any = {};
    if (adGroupId) {
      body.adGroupIdFilter = { include: [adGroupId] };
    }
    const response = await this.axiosInstance.post('/sp/negativeTargets/list', body, {
      headers: { 'Content-Type': 'application/vnd.spNegativeTargetingClause.v3+json' },
    });
    return response.data.negativeTargetingClauses || [];
  }

  /**
   * 创建SP否定商品定位（广告组级别）
   */
  async createSpNegativeTargets(
    negatives: Array<{
      adGroupId: number;
      campaignId: number;
      expression: Array<{ type: string; value?: string }>;
      state?: 'enabled' | 'paused';
    }>
  ): Promise<Array<{ targetId: number; code: string; details: string }>> {
    const response = await this.axiosInstance.post('/sp/negativeTargets', {
      negativeTargetingClauses: negatives.map(n => ({
        ...n,
        state: n.state || 'enabled',
      })),
    }, {
      headers: { 'Content-Type': 'application/vnd.spNegativeTargetingClause.v3+json' },
    });
    return response.data.negativeTargetingClauses || [];
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
  console.log('[validateCredentials] 开始验证凭证:', {
    clientIdPrefix: credentials.clientId?.substring(0, 30) + '...',
    clientSecretPrefix: credentials.clientSecret?.substring(0, 20) + '...',
    refreshTokenPrefix: credentials.refreshToken?.substring(0, 20) + '...',
    profileId: credentials.profileId,
    region: credentials.region,
  });
  
  try {
    const client = new AmazonAdsApiClient(credentials);
    console.log('[validateCredentials] 客户端创建成功，开始获取profiles...');
    const profiles = await client.getProfiles();
    console.log('[validateCredentials] 获取到', profiles.length, '个profiles');
    return true;
  } catch (error: any) {
    console.error('[validateCredentials] 验证失败:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    return false;
  }
}
