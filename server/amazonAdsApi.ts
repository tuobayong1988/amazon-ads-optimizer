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
   * 动态设置Profile ID
   * 用于在同一个API客户端实例中切换不同的广告配置文件
   * @param profileId - 新的Profile ID
   */
  setProfileId(profileId: string): void {
    this.credentials.profileId = profileId;
    // 更新axios实例的默认headers
    this.axiosInstance.defaults.headers['Amazon-Advertising-API-Scope'] = profileId;
  }

  /**
   * 获取当前Profile ID
   */
  getProfileId(): string {
    return this.credentials.profileId;
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
      const body: any = { 
        maxResults: 100,
        // 请求扩展字段，包括startDate和endDate
        includeExtendedDataFields: true
      };
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
    
    // 调试：打印第一个广告活动的完整结构
    if (allCampaigns.length > 0) {
      console.log('[SP API DEBUG] First campaign full structure:', JSON.stringify(allCampaigns[0], null, 2));
      console.log('[SP API DEBUG] First campaign startDate:', allCampaigns[0].startDate);
      console.log('[SP API DEBUG] First campaign keys:', Object.keys(allCampaigns[0]));
    }
    
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
   * 重要: SP报表可以直接获取campaignBudget和campaignStatus
   * 
   * Report API v3 支持的字段（2026年1月更新）:
   * - campaignBudgetAmount: 预算金额
   * - campaignBudgetType: 预算类型 (DAILY/LIFETIME)
   * - campaignBudgetCurrencyCode: 预算货币代码
   * - unitsSoldClicks14d: 14天点击归因销售单位数
   * - unitsSoldSameSku14d: 14天同SKU销售单位数
   * - dpv14d: 14天详情页浏览量
   * - addToCart14d: 14天加购数
   * 注意: topOfSearchImpressionShare 目前不支持通过 Report API v3 获取
   */
  async requestSpCampaignReport(
    startDate: string,
    endDate: string,
    metrics: string[] = ['impressions', 'clicks', 'cost', 'attributedSales7d', 'attributedConversions7d']
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SP广告活动报告: ${startDate} - ${endDate}`);
      
      // Amazon Ads Reporting API v3 正确格式
      // ⚠️ 重要: SP必须使用7天归因窗口 (7d)，不是14天!
      // 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
      const requestBody = {
        name: `SP Campaign Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['campaign'],
          columns: [
            // 基础信息 - 根据Excel文档SP Campaign sheet
            'date',
            'campaignId',
            'campaignName',
            'campaignStatus',                    // Excel: campaignStatus - 状态
            'campaignBudgetAmount',              // Excel: campaignBudgetAmount - 预算金额
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 货币
            'campaignBudgetType',                // Excel: campaignBudgetType - 预算类型
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'clicks',                            // Excel: clicks - 点击次数
            'clickThroughRate',                  // Excel: clickThroughRate - 点击率
            // 花费指标 (SP使用cost)
            'cost',                              // Excel: cost - 支出 (注意: Excel显示为cost而非spend)
            'costPerClick',                      // Excel: costPerClick - 每次点击费用
            // 7天归因销售指标 (SP专用)
            'sales7d',                           // Excel: sales7d - 7天总销售额
            'purchases7d',                       // Excel: purchases7d - 7天订单总数
            'unitsSoldClicks7d',                 // Excel: unitsSoldClicks7d - 7天总销量
            // 同SKU指标
            'attributedSalesSameSku7d',          // Excel: attributedSalesSameSku7d - 7天广告SKU销售额
            'unitsSoldSameSku7d',                // Excel: unitsSoldSameSku7d - 7天广告SKU数量
            'salesOtherSku7d',                   // Excel: salesOtherSku7d - 7天其他SKU销售额
            'unitsSoldOtherSku7d'                // Excel: unitsSoldOtherSku7d - 7天其他SKU数量
          ],
          // 添加filters配置
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
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
            // 基础信息 - 根据Excel文档SP-Targeting sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 货币
            'adGroupId',
            'adGroupName',                       // Excel: adGroupName - 广告组名称
            'advertisedSku',                     // Excel: advertisedSku - 已投放广告的SKU
            'advertisedAsin',                    // Excel: advertisedAsin - 已投放广告的ASIN
            'targetId',
            'targetingExpression',
            'targetingText',
            'keywordType',
            'matchType',
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'clicks',                            // Excel: clicks - 点击次数
            'clickThroughRate',                  // Excel: clickThroughRate - 点击率
            // 花费指标
            'cost',                              // Excel: cost - 支出
            'costPerClick',                      // Excel: costPerClick - 每次点击费用
            // 7天归因销售指标
            'sales7d',                           // Excel: sales7d - 7天总销售额
            'acosClicks7d',                      // Excel: acosClicks7d - ACOS
            'roasClicks7d',                      // Excel: roasClicks7d - ROAS
            'purchases7d',                       // Excel: purchases7d - 7天订单总数
            'unitsSoldClicks7d',                 // Excel: unitsSoldClicks7d - 7天总销量
            // 同SKU/其他SKU指标
            'unitsSoldSameSku7d',                // Excel: unitsSoldSameSku7d - 7天广告SKU数量
            'unitsSoldOtherSku7d',               // Excel: unitsSoldOtherSku7d - 7天其他SKU数量
            'attributedSalesSameSku7d',          // Excel: attributedSalesSameSku7d - 7天广告SKU销售额
            'salesOtherSku7d'                    // Excel: salesOtherSku7d - 7天其他SKU销售额
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
   * 重要修复: SB报告必须使用 attributedSales14d 和 attributedConversions14d 字段
   * 使用 sales/purchases 会导致数据为空！
   * 
   * Report API v3 支持的SB字段（2026年1月更新）:
   * - attributedSales14d: 14天归因销售额
   * - attributedConversions14d: 14天归因转化数
   * - brandedSearches14d: 14天品牌搜索数
   * - brandedSearchesClicks14d: 14天品牌搜索点击数
   * - dpv14d: 14天详情页浏览量
   */
  async requestSbCampaignReport(
    startDate: string,
    endDate: string,
    metrics: string[] = ['impressions', 'clicks', 'cost', 'attributedConversions14d', 'attributedSales14d']
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SB品牌广告活动报告: ${startDate} - ${endDate}`);
      
      // Amazon Ads Reporting API v3 正确格式
      // 重要: 基于专家提供的Postman配置
      // ⚠️ 必须添加filters配置，否则可能返回空数据！
      const requestBody = {
        name: `SB Campaign Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_BRANDS',
          groupBy: ['campaign'],
          columns: [
            // 基础信息 - 根据Excel文档SB Campaign sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignStatus',
            'campaignBudgetAmount',
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 货币
            'campaignBudgetType',
            'costType',                          // Excel: costType - 费用类型
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'clicks',                            // Excel: clicks - 点击次数
            'viewableImpressions',               // Excel: viewableImpressions - 可见展示次数
            'viewabilityRate',                   // Excel: viewabilityRate - 观看率 (VTR)
            'viewClickThroughRate',              // Excel: viewClickThroughRate - 观看点击率 (vCTR)
            // 花费指标 (SB使用cost)
            'cost',                              // Excel: cost - 支出
            // 14天归因销售指标 (SB使用14天归因)
            'sales',                             // Excel: sales - 14天总销售额
            'purchases',                         // Excel: purchases - 14天总订单量
            'unitsSold',                         // Excel: unitsSold - 14天总单位数
            // 点击归因指标
            'salesClicks',                       // Excel: salesClicks - 14天总销售额(点击)
            'purchasesClicks',                   // Excel: purchasesClicks - 14天订单总数(点击)
            'unitsSoldClicks',                   // Excel: unitsSoldClicks - 14天总数量(点击)
            // 详情页浏览
            'detailPageViews',                   // Excel: detailPageViews - 14天详情页浏览量
            // 视频指标
            'videoFirstQuartileViews',           // Excel: videoFirstQuartileViews - 视频第一四分位观看次数
            'videoMidpointViews',                // Excel: videoMidpointViews - 视频中间点观看次数
            'videoThirdQuartileViews',           // Excel: videoThirdQuartileViews - 视频第三四分位观看次数
            'videoCompleteViews',                // Excel: videoCompleteViews - 视频完整观看次数
            'videoUnmutes',                      // Excel: videoUnmutes - 视频取消静音次数
            'video5SecondViews',                 // Excel: video5SecondViews - 5秒观看次数
            'video5SecondViewRate',              // Excel: video5SecondViewRate - 5秒观看率
            // 品牌搜索
            'brandedSearches',                   // Excel: brandedSearches - 14天品牌搜索次数
            'brandedSearchesClicks',             // Excel: brandedSearchesClicks - 品牌搜索点击转化率
            // 新客指标
            'newToBrandPurchases',               // Excel: newToBrandPurchases - 14天品牌新客户订单数
            'newToBrandPurchasesPercentage',     // Excel: newToBrandPurchasesPercentage - 14天订单占比新品牌
            'newToBrandSales',                   // Excel: newToBrandSales - 14天新品牌销售额
            'newToBrandSalesPercentage',         // Excel: newToBrandSalesPercentage - 14天新品牌销售额占比
            'newToBrandUnitsSold',               // Excel: newToBrandUnitsSold - 14天新品牌数量
            'newToBrandUnitsSoldPercentage',     // Excel: newToBrandUnitsSoldPercentage - 14天新品牌数量占比
            'newToBrandPurchasesRate',           // Excel: newToBrandPurchasesRate - 14天新品牌订单率
            // 新品牌详情页
            'newToBrandDetailPageViews',         // Excel: newToBrandDetailPageViews - 新品牌详情页浏览量
            'newToBrandDetailPageViewsClicks',   // Excel: newToBrandDetailPageViewsClicks - 新品牌详情页浏览点击转化率
            'newToBrandDetailPageViewRate',      // Excel: newToBrandDetailPageViewRate - 新品牌详情页浏览率
            'newToBrandECPDetailPageView',       // Excel: newToBrandECPDetailPageView - 新品牌详情页每次浏览有效费用
            // 加购指标
            'addToCart',                         // Excel: addToCart - 14天ATC
            'addToCartClicks',                   // Excel: addToCartClicks - 14天ATC点击次数
            'addToCartRate',                     // Excel: addToCartRate - 14天ATCR
            'eCPAddToCart'                       // Excel: eCPAddToCart - 每次加入购物车有效费用
          ],
          // ⚠️ 关键修复: 添加filters配置 - 基于专家Postman配置
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
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
   * 重要修复: SD报告必须使用 attributedSales14d 和 attributedConversions14d 字段
   * SD还需要 viewAttributedSales14d 来获取浏览归因数据
   * 
   * Report API v3 支持的SD字段（2026年1月更新）:
   * - attributedSales14d: 14天点击归因销售额
   * - attributedConversions14d: 14天点击归因转化数
   * - viewAttributedSales14d: 14天浏览归因销售额 (vCPM核心)
   * - viewAttributedConversions14d: 14天浏览归因转化数
   * - viewableImpressions: 可见曝光数
   * - dpv14d: 14天详情页浏览量
   * - newToBrandPurchases14d: 14天新客购买数
   * - newToBrandSales14d: 14天新客销售额
   */
  async requestSdCampaignReport(
    startDate: string,
    endDate: string,
    metrics: string[] = ['impressions', 'clicks', 'cost', 'attributedConversions14d', 'attributedSales14d', 'viewAttributedSales14d']
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SD展示广告活动报告: ${startDate} - ${endDate}`);
      
      // Amazon Ads Reporting API v3 正确格式
      // 重要: 基于专家提供的Postman配置
      // reportTypeId: sdCampaigns 是正确的（Postman中有954次使用）
      const requestBody = {
        name: `SD Campaign Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_DISPLAY',
          groupBy: ['campaign'],
          columns: [
            // 基础信息 - 根据Excel文档SD Campaign sheet
            'date',
            'campaignId',
            'campaignName',
            'campaignStatus',              // Excel: campaignStatus - 状态
            'campaignBudgetAmount',         // Excel: campaignBudgetAmount - 预算
            'campaignBudgetCurrencyCode',   // Excel: campaignBudgetCurrencyCode - 货币
            'costType',                     // Excel: costType - 费用类型
            // 流量指标
            'impressions',
            'impressionsViews',
            'impressionsFrequencyAverage',
            'cumulativeReach',
            'clicks',
            'viewClickThroughRate',
            'viewabilityRate',
            // 花费指标 (SD使用cost)
            'cost',
            // 销售指标 (SD使用Clicks后缀 - 基于专家Postman配置)
            'sales',
            'salesClicks',
            'salesPromotedClicks',
            'purchases',
            'purchasesClicks',
            'purchasesPromotedClicks',
            'unitsSold',
            'unitsSoldClicks',
            // 详情页浏览
            'detailPageViews',
            'detailPageViewsClicks',
            // 加购指标
            'addToCart',
            'addToCartClicks',
            'addToCartViews',
            'addToCartRate',
            'eCPAddToCart',
            // 品牌搜索
            'brandedSearches',
            'brandedSearchesClicks',
            'brandedSearchesViews',
            'brandedSearchRate',
            'eCPBrandSearch',
            // 新客指标
            'newToBrandPurchases',
            'newToBrandPurchasesClicks',
            'newToBrandSales',
            'newToBrandSalesClicks',
            'newToBrandUnitsSold',
            'newToBrandUnitsSoldClicks',
            'newToBrandDetailPageViews',
            'newToBrandDetailPageViewClicks',
            'newToBrandDetailPageViewViews',
            'newToBrandDetailPageViewRate',
            'newToBrandECPDetailPageView',
            // 视频指标
            'videoCompleteViews',
            'videoFirstQuartileViews',
            'videoMidpointViews',
            'videoThirdQuartileViews',
            'videoUnmutes'
          ],
          // ⚠️ 关键修复: 添加filters配置 - 与SB报告一致
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
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
   * 请求SP广告位置报告 (Amazon Ads API v3)
   * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
   * 
   * 广告位置类型:
   * - TOP_OF_SEARCH: 搜索结果顶部
   * - DETAIL_PAGE: 商品详情页
   * - OTHER: 其他位置
   */
  async requestSpPlacementReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SP广告位置报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SP Placement Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['campaign', 'placement'],
          columns: [
            // 基础信息 - 根据Excel文档SP Placement sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignBiddingStrategy',           // Excel: campaignBiddingStrategy - 出价策略
            'placementClassification',           // Excel: placementClassification - 展示位置 (TOP_OF_SEARCH/DETAIL_PAGE/OTHER)
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'clicks',                            // Excel: clicks - 点击次数
            // 花费指标
            'cost',                              // Excel: cost - 支出
            'costPerClick',                      // Excel: costPerClick - 每次点击费用
            // 7天归因销售指标
            'sales7d',                           // Excel: sales7d - 7天总销售额
            'purchases7d',                       // Excel: purchases7d - 7天总订单量
            'unitsSoldClicks7d'                  // Excel: unitsSoldClicks7d - 7天总单位数
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
      
      console.log(`[Amazon API] SP位置报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SP位置报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SP搜索词报告 (Amazon Ads API v3)
   * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
   * 
   * 搜索词报告字段:
   * - searchTerm: 客户实际搜索的关键词
   * - keywordId/keyword: 触发广告的投放词
   * - matchType: 匹配类型
   */
  async requestSpSearchTermReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SP搜索词报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SP Search Term Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['searchTerm'],
          columns: [
            // 基础信息 - 根据Excel文档SP Search term sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 货币
            'adGroupId',
            'adGroupName',                       // Excel: adGroupName - 广告组名称
            'targeting',                         // Excel: targeting - 定位
            'keywordType',                       // Excel: keywordType - 匹配类型
            'searchTerm',                        // Excel: searchTerm - 客户搜索词
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'clicks',                            // Excel: clicks - 点击次数
            'clickThroughRate',                  // Excel: clickThroughRate - 点击率
            // 花费指标
            'cost',                              // Excel: cost - 支出
            'costPerClick',                      // Excel: costPerClick - 每次点击费用
            // 7天归因销售指标
            'sales7d',                           // Excel: sales7d - 7天总销售额
            'acosClicks7d',                      // Excel: acosClicks7d - ACOS
            'roasClicks7d',                      // Excel: roasClicks7d - ROAS
            'purchases7d',                       // Excel: purchases7d - 7天订单总数
            'unitsSoldClicks7d',                 // Excel: unitsSoldClicks7d - 7天总销量
            // 同SKU/其他SKU指标
            'unitsSoldSameSku7d',                // Excel: unitsSoldSameSku7d - 7天广告SKU数量
            'unitsSoldOtherSku7d',               // Excel: unitsSoldOtherSku7d - 7天其他SKU数量
            'attributedSalesSameSku7d',          // Excel: attributedSalesSameSku7d - 7天广告SKU销售额
            'salesOtherSku7d'                    // Excel: salesOtherSku7d - 7天其他SKU销售额
          ],
          reportTypeId: 'spSearchTerm',
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
      
      console.log(`[Amazon API] SP搜索词报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SP搜索词报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SP已推广商品报告 (Amazon Ads API v3)
   * 根据Excel文档: SP Advertised Product sheet
   * 字段: date, campaignName, adGroupName, advertisedSku, advertisedAsin, impressions, clicks,
   *       clickThroughRate, costPerClick, cost, sales7d, acosClicks7d, roasClicks7d, purchases7d,
   *       unitsSoldClicks7d, unitsSoldSameSku7d, unitsSoldOtherSku7d, attributedSalesSameSku7d, salesOtherSku7d
   */
  async requestSpAdvertisedProductReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SP已推广商品报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SP Advertised Product Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['advertiser'],
          columns: [
            // 基础信息 - 根据Excel文档SP Advertised Product sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 货币
            'adGroupId',
            'adGroupName',                       // Excel: adGroupName - 广告组名称
            'advertisedSku',                     // Excel: advertisedSku - 已投放广告的SKU
            'advertisedAsin',                    // Excel: advertisedAsin - 已投放广告的ASIN
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'clicks',                            // Excel: clicks - 点击次数
            'clickThroughRate',                  // Excel: clickThroughRate - 点击率
            // 花费指标
            'cost',                              // Excel: cost - 支出
            'costPerClick',                      // Excel: costPerClick - 每次点击费用
            // 7天归因销售指标
            'sales7d',                           // Excel: sales7d - 7天总销售额
            'acosClicks7d',                      // Excel: acosClicks7d - ACOS
            'roasClicks7d',                      // Excel: roasClicks7d - ROAS
            'purchases7d',                       // Excel: purchases7d - 7天订单总数
            'unitsSoldClicks7d',                 // Excel: unitsSoldClicks7d - 7天总销量
            // 同SKU/其他SKU指标
            'unitsSoldSameSku7d',                // Excel: unitsSoldSameSku7d - 7天广告SKU数量
            'unitsSoldOtherSku7d',               // Excel: unitsSoldOtherSku7d - 7天其他SKU数量
            'attributedSalesSameSku7d',          // Excel: attributedSalesSameSku7d - 7天广告SKU销售额
            'salesOtherSku7d'                    // Excel: salesOtherSku7d - 7天其他SKU销售额
          ],
          reportTypeId: 'spAdvertisedProduct',
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
      
      console.log(`[Amazon API] SP已推广商品报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SP已推广商品报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SP已购买商品报告 (Amazon Ads API v3)
   * 根据Excel文档: SP Purchased Product sheet
   * 字段: date, campaignName, adGroupName, advertisedSku, advertisedAsin, keyword, matchType,
   *       purchasedAsin, unitsSoldOtherSku14d, purchasesOtherSku7d, salesOtherSku14d
   */
  async requestSpPurchasedProductReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SP已购买商品报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SP Purchased Product Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['asin'],
          columns: [
            // 基础信息 - 根据Excel文档SP Purchased Product sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'adGroupId',
            'adGroupName',                       // Excel: adGroupName - 广告组名称
            'advertisedSku',                     // Excel: advertisedSku - 已投放SKU
            'advertisedAsin',                    // Excel: advertisedAsin - 已投放ASIN
            'keyword',                           // Excel: keyword - 定位
            'matchType',                         // Excel: matchType - 匹配类型
            'purchasedAsin',                     // Excel: purchasedAsin - 已购买ASIN
            // 销售指标
            'unitsSoldOtherSku7d',               // Excel: unitsSoldOtherSku14d - 7天其他SKU数量
            'purchasesOtherSku7d',               // Excel: purchasesOtherSku7d - 7天其他SKU订单
            'salesOtherSku7d'                    // Excel: salesOtherSku14d - 7天其他SKU销量
          ],
          reportTypeId: 'spPurchasedProduct',
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
      
      console.log(`[Amazon API] SP已购买商品报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SP已购买商品报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SP自动定向报告 (Amazon Ads API v3)
   * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
   * 
   * 自动广告匹配组类型:
   * - CLOSE_MATCH: 紧密匹配
   * - LOOSE_MATCH: 宽泛匹配
   * - SUBSTITUTES: 同类商品
   * - COMPLEMENTS: 关联商品
   */
  async requestSpAutoTargetingReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SP自动定向报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SP Auto Targeting Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['targeting'],
          columns: [
            'date',
            'campaignId',
            'campaignName',
            'adGroupId',
            'adGroupName',
            'targetId',
            'targetingExpression',
            'targetingType',              // AUTO / MANUAL
            'targetingText',
            'impressions',
            'clicks',
            'cost',
            'sales7d',                     // ✅ 7天归因销售额 (修正字段名)
            'unitsSoldClicks7d',           // ✅ 7天归因订单单位数 (修正字段名)
            'purchases7d'                  // ✅ 7天归因转化数 (修正字段名)
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
      
      console.log(`[Amazon API] SP自动定向报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SP自动定向报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SD定向报告 (Amazon Ads API v3)
   * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
   * 
   * SD定向类型:
   * - 受众定向: 浏览再营销、购买再营销等
   * - 商品定向: ASIN/品类定向
   */
  async requestSdTargetingReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SD定向报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SD Targeting Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_DISPLAY',
          groupBy: ['targeting'],
          columns: [
            // 基础信息 - 根据Excel文档SD Targeting sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 货币
            'adGroupId',
            'adGroupName',                       // Excel: adGroupName - 广告组名称
            'targetingText',                     // Excel: targetingText - 定位
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'impressionsViews',                  // Excel: impressionsViews - 可见展示次数
            'clicks',                            // Excel: clicks - 点击次数
            'detailPageViews',                   // Excel: detailPageViews - 14天详情页浏览量
            // 花费指标
            'cost',                              // Excel: cost - 支出
            // 14天归因销售指标 (SD使用14天归因)
            'sales',                             // Excel: sales - 14天总销售额
            'purchases',                         // Excel: purchases - 14天总订单数
            'unitsSold',                         // Excel: unitsSold - 14天总单位数
            // 新客指标
            'newToBrandPurchases',               // Excel: newToBrandPurchases - 14天新品牌订单数
            'newToBrandSales',                   // Excel: newToBrandSales - 14天新品牌销售额
            'newToBrandUnitsSold',               // Excel: newToBrandUnitsSold - 14天新品牌单位数
            // 点击归因指标
            'salesClicks',                       // Excel: salesClicks - 14天总销售额(点击)
            'purchasesClicks',                   // Excel: purchasesClicks - 14天总订单数(点击)
            'unitsSoldClicks',                   // Excel: unitsSoldClicks - 14天总单位数(点击)
            'newToBrandPurchasesClicks',         // Excel: newToBrandPurchasesClicks - 14天新品牌订单(点击)
            'newToBrandSalesClicks',             // Excel: newToBrandSalesClicks - 14天新品牌销售额(点击)
            'newToBrandUnitsSoldClicks'          // Excel: newToBrandUnitsSoldClicks - 14天新品牌单位(点击)
          ],
          // 添加filters配置
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'sdTargeting',
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
      
      console.log(`[Amazon API] SD定向报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SD定向报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SD已推广商品报告 (Amazon Ads API v3)
   * 根据Excel文档: SD Advertised product sheet
   * 字段: date, campaignName, adGroupName, bidOptimization, promotedSku, promotedAsin,
   *       impressions, impressionsViews, clicks, detailPageViews, cost, sales, purchases,
   *       unitsSold, newToBrandPurchases, newToBrandSales, newToBrandUnitsSold,
   *       salesClicks, purchasesClicks, unitsSoldClicks, newToBrandPurchasesClicks,
   *       newToBrandSalesClicks, newToBrandUnitsSoldClicks
   */
  async requestSdAdvertisedProductReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SD已推广商品报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SD Advertised Product Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_DISPLAY',
          groupBy: ['advertiser'],
          columns: [
            // 基础信息 - 根据Excel文档SD Advertised product sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 货币
            'adGroupId',
            'adGroupName',                       // Excel: adGroupName - 广告组名称
            'bidOptimization',                   // Excel: bidOptimization - 出价优化
            'promotedSku',                       // Excel: promotedSku - 已投放SKU
            'promotedAsin',                      // Excel: promotedAsin - 已投放ASIN
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'impressionsViews',                  // Excel: impressionsViews - 可见展示次数
            'clicks',                            // Excel: clicks - 点击次数
            'detailPageViews',                   // Excel: detailPageViews - 14天详情页浏览量
            // 花费指标
            'cost',                              // Excel: cost - 支出
            // 14天归因销售指标
            'sales',                             // Excel: sales - 14天总销售额
            'purchases',                         // Excel: purchases - 14天总订单数
            'unitsSold',                         // Excel: unitsSold - 14天总销量
            // 新客指标
            'newToBrandPurchases',               // Excel: newToBrandPurchases - 14天新品牌订单数
            'newToBrandSales',                   // Excel: newToBrandSales - 14天新品牌销售额
            'newToBrandUnitsSold',               // Excel: newToBrandUnitsSold - 14天新品牌销量
            // 点击归因指标
            'salesClicks',                       // Excel: salesClicks - 14天总销售额(点击)
            'purchasesClicks',                   // Excel: purchasesClicks - 14天总订单数(点击)
            'unitsSoldClicks',                   // Excel: unitsSoldClicks - 14天总销量(点击)
            'newToBrandPurchasesClicks',         // Excel: newToBrandPurchasesClicks - 14天新品牌订单数(点击)
            'newToBrandSalesClicks',             // Excel: newToBrandSalesClicks - 14天新品牌销量(点击)
            'newToBrandUnitsSoldClicks'          // Excel: newToBrandUnitsSoldClicks - 14天新品牌销量(点击)
          ],
          // 添加filters配置
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'sdAdvertisedProduct',
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
      
      console.log(`[Amazon API] SD已推广商品报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SD已推广商品报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SD匹配目标报告 (Amazon Ads API v3)
   * 根据Excel文档: SD Matchd Target sheet
   * 字段: date, campaignName, targetingText, matchedTargetAsin, impressions, clicks,
   *       cost, sales, purchases, unitsSold
   */
  async requestSdMatchedTargetReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SD匹配目标报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SD Matched Target Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_DISPLAY',
          groupBy: ['matchedTarget'],
          columns: [
            // 基础信息 - 根据Excel文档SD Matchd Target sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 货币
            'targetingText',                     // Excel: targetingText - 定位
            'matchedTargetAsin',                 // Excel: matchedTargetAsin - 匹配目标
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'clicks',                            // Excel: clicks - 点击次数
            // 花费指标
            'cost',                              // Excel: cost - 支出
            // 14天归因销售指标
            'sales',                             // Excel: sales - 14天销售总额
            'purchases',                         // Excel: purchases - 14天订单总数
            'unitsSold'                          // Excel: unitsSold - 14天单位总数
          ],
          // 添加filters配置
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'sdMatchedTarget',
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
      
      console.log(`[Amazon API] SD匹配目标报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SD匹配目标报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SB定向报告 (Amazon Ads API v3)
   * 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
   */
  async requestSbTargetingReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SB定向报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SB Targeting Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_BRANDS',
          groupBy: ['targeting'],
          columns: [
            // 基础信息 - 根据Excel文档SB Keyword sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 币种
            'adGroupId',
            'adGroupName',                       // Excel: adGroupName - 广告组名称
            'targetingText',                     // Excel: targetingText - 定位
            'matchType',                         // Excel: matchType - 匹配类型
            'costType',                          // Excel: costType - 费用类型
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'topOfSearchImpressionShare',        // Excel: topOfSearchImpressionShare - 搜索结果顶部展示次数份额
            'clicks',                            // Excel: clicks - 点击次数
            'viewabilityRate',                   // Excel: viewabilityRate - 观看率 (VTR)
            'viewClickThroughRate',              // Excel: viewClickThroughRate - 观看点击率 (vCTR)
            // 花费指标
            'cost',                              // Excel: cost - 支出
            // 14天归因销售指标
            'sales',                             // Excel: sales - 14天总销售额
            'purchases',                         // Excel: purchases - 14天总订单量
            'unitsSold',                         // Excel: unitsSold - 14天总单位数
            // 点击归因指标
            'salesClicks',                       // Excel: salesClicks - 14天总销售额(点击)
            'purchasesClicks',                   // Excel: purchasesClicks - 14天总订单数(点击)
            'unitsSoldClicks',                   // Excel: unitsSoldClicks - 14天总单位数(点击)
            // 视频指标
            'videoFirstQuartileViews',           // Excel: videoFirstQuartileViews
            'videoMidpointViews',                // Excel: videoMidpointViews
            'videoThirdQuartileViews',           // Excel: videoThirdQuartileViews
            'videoCompleteViews',                // Excel: videoCompleteViews
            'videoUnmutes',                      // Excel: videoUnmutes
            'video5SecondViews',                 // Excel: video5SecondViews
            'video5SecondViewRate',              // Excel: video5SecondViewRate
            // 品牌搜索
            'brandedSearches',                   // Excel: brandedSearches
            // 详情页浏览
            'detailPageViews',                   // Excel: detailPageViews
            // 新客指标
            'newToBrandPurchases',               // Excel: newToBrandPurchases
            'newToBrandPurchasesPercentage',     // Excel: newToBrandPurchasesPercentage
            'newToBrandSales',                   // Excel: newToBrandSales
            'newToBrandSalesPercentage',         // Excel: newToBrandSalesPercentage
            'newToBrandUnitsSold',               // Excel: newToBrandUnitsSold
            'newToBrandUnitsSoldPercentage',     // Excel: newToBrandUnitsSoldPercentage
            'newToBrandPurchasesRate'            // Excel: newToBrandPurchasesRate
          ],
          // 添加filters配置
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'sbTargeting',
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
      
      console.log(`[Amazon API] SB定向报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SB定向报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SB搜索词报告 (Amazon Ads API v3)
   * 根据Excel文档: SB Search term sheet
   * 字段: date, campaignName, adGroupName, keywordText, matchType, searchTerm, costType,
   *       impressions, viewableImpressions, clicks, cost, sales, purchases, unitsSold,
   *       salesClicks, purchasesClicks
   */
  async requestSbSearchTermReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SB搜索词报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SB Search Term Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_BRANDS',
          groupBy: ['searchTerm'],
          columns: [
            // 基础信息 - 根据Excel文档SB Search term sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 货币
            'adGroupId',
            'adGroupName',                       // Excel: adGroupName - 广告组名称
            'keywordText',                       // Excel: keywordText - 定位
            'matchType',                         // Excel: matchType - 匹配类型
            'searchTerm',                        // Excel: searchTerm - 客户搜索词
            'costType',                          // Excel: costType - 费用类型
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'viewableImpressions',               // Excel: viewableImpressions - 可见展示次数
            'clicks',                            // Excel: clicks - 点击次数
            // 花费指标
            'cost',                              // Excel: cost - 支出
            // 14天归因销售指标
            'sales',                             // Excel: sales - 14天总销售额
            'purchases',                         // Excel: purchases - 14天总订单数
            'unitsSold',                         // Excel: unitsSold - 14天总单位数
            // 点击归因指标
            'salesClicks',                       // Excel: salesClicks - 14天总销售额(点击)
            'purchasesClicks'                    // Excel: purchasesClicks - 14天总订单数(点击)
          ],
          // 添加filters配置
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'sbSearchTerm',
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
      
      console.log(`[Amazon API] SB搜索词报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SB搜索词报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SB广告位置报告 (Amazon Ads API v3)
   * 根据Excel文档: SB Campaign Placement sheet
   * 字段: date, campaignName, costType, placementClassification, impressions, viewableImpressions,
   *       clicks, cost, sales, purchases, unitsSold, viewabilityRate, viewClickThroughRate,
   *       videoFirstQuartileViews, videoMidpointViews, videoThirdQuartileViews, videoCompleteViews,
   *       videoUnmutes, video5SecondViews, video5SecondViewRate, brandedSearches, detailPageViews,
   *       newToBrandPurchases, newToBrandSales, newToBrandUnitsSold, salesClicks, purchasesClicks, unitsSoldClicks
   */
  async requestSbCampaignPlacementReport(
    startDate: string,
    endDate: string
  ): Promise<string> {
    try {
      console.log(`[Amazon API] 请求SB广告位置报告: ${startDate} - ${endDate}`);
      
      const requestBody = {
        name: `SB Campaign Placement Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_BRANDS',
          groupBy: ['campaign', 'placement'],
          columns: [
            // 基础信息 - 根据Excel文档SB Campaign Placement sheet
            'date',
            'campaignId',
            'campaignName',                      // Excel: campaignName - 广告系列名称
            'campaignBudgetCurrencyCode',        // Excel: campaignBudgetCurrencyCode - 币种
            'costType',                          // Excel: costType - 费用类型
            'placementClassification',           // Excel: placementClassification - 展示位置
            // 流量指标
            'impressions',                       // Excel: impressions - 展示次数
            'viewableImpressions',               // Excel: viewableImpressions - 可见展示次数
            'clicks',                            // Excel: clicks - 点击次数
            'viewabilityRate',                   // Excel: viewabilityRate - 观看率 (VTR)
            'viewClickThroughRate',              // Excel: viewClickThroughRate - 观看点击率 (vCTR)
            // 花费指标
            'cost',                              // Excel: cost - 支出
            // 14天归因销售指标
            'sales',                             // Excel: sales - 14天总销售额
            'purchases',                         // Excel: purchases - 14天总订单量
            'unitsSold',                         // Excel: unitsSold - 14天总单位数
            // 点击归因指标
            'salesClicks',                       // Excel: salesClicks - 14天总销售额(点击)
            'purchasesClicks',                   // Excel: purchasesClicks - 14天总订单数量(点击)
            'unitsSoldClicks',                   // Excel: unitsSoldClicks - 14天总单位数量(点击)
            // 视频指标
            'videoFirstQuartileViews',           // Excel: videoFirstQuartileViews
            'videoMidpointViews',                // Excel: videoMidpointViews
            'videoThirdQuartileViews',           // Excel: videoThirdQuartileViews
            'videoCompleteViews',                // Excel: videoCompleteViews
            'videoUnmutes',                      // Excel: videoUnmutes
            'video5SecondViews',                 // Excel: video5SecondViews
            'video5SecondViewRate',              // Excel: video5SecondViewRate
            // 品牌搜索
            'brandedSearches',                   // Excel: brandedSearches
            // 详情页浏览
            'detailPageViews',                   // Excel: detailPageViews
            // 新客指标
            'newToBrandPurchases',               // Excel: newToBrandPurchases
            'newToBrandPurchasesPercentage',     // Excel: newToBrandPurchasesPercentage
            'newToBrandSales',                   // Excel: newToBrandSales
            'newToBrandSalesPercentage',         // Excel: newToBrandSalesPercentage
            'newToBrandUnitsSold',               // Excel: newToBrandUnitsSold
            'newToBrandUnitsSoldPercentage',     // Excel: newToBrandUnitsSoldPercentage
            'newToBrandPurchasesRate'            // Excel: newToBrandPurchasesRate
          ],
          // 添加filters配置
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
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
      
      console.log(`[Amazon API] SB广告位置报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SB广告位置报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SB广告报告 (广告素材级别)
   * 基于Postman文档: reportTypeId = sbAds, groupBy = ["ads"]
   */
  async requestSbAdsReport(profileId: string, startDate: string, endDate: string): Promise<string> {
    try {
      this.setProfileId(profileId);
      
      const requestBody = {
        name: `SB Ads Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_BRANDS',
          groupBy: ['ads'],
          columns: [
            'date',
            'campaignId',
            'campaignName',
            'campaignStatus',
            'campaignBudgetAmount',
            'adGroupId',
            'adGroupName',
            'adId',
            'adStatus',
            'impressions',
            'clicks',
            'clickThroughRate',
            'cost',
            'costPerClick',
            'sales',
            'salesClicks',
            'purchases',
            'purchasesClicks',
            'unitsSold',
            'unitsSoldClicks',
            'newToBrandSales',
            'newToBrandPurchases',
            'newToBrandUnitsSold',
            'video5SecondViews',
            'video5SecondViewRate',
            'videoFirstQuartileViews',
            'videoMidpointViews',
            'videoThirdQuartileViews',
            'videoCompleteViews',
            'videoUnmutes',
            'viewClickThroughRate'
          ],
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'sbAds',
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
      
      console.log(`[Amazon API] SB广告报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SB广告报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SD广告组报告
   * 基于Postman文档: reportTypeId = sdAdGroup, groupBy = ["adGroup"]
   */
  async requestSdAdGroupReport(profileId: string, startDate: string, endDate: string): Promise<string> {
    try {
      this.setProfileId(profileId);
      
      const requestBody = {
        name: `SD AdGroup Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_DISPLAY',
          groupBy: ['adGroup'],
          columns: [
            'date',
            'campaignId',
            'campaignName',
            'campaignStatus',
            'campaignBudgetAmount',
            'adGroupId',
            'adGroupName',
            'costType',
            'bidOptimization',
            'impressions',
            'impressionsViews',
            'clicks',
            'clickThroughRate',
            'cost',
            'costPerClick',
            'detailPageViews',
            'detailPageViewsClicks',
            'sales',
            'salesClicks',
            'purchases',
            'purchasesClicks',
            'unitsSold',
            'unitsSoldClicks',
            'newToBrandSales',
            'newToBrandSalesClicks',
            'newToBrandPurchases',
            'newToBrandPurchasesClicks',
            'newToBrandUnitsSold',
            'newToBrandUnitsSoldClicks',
            'salesBrandHalo',
            'salesBrandHaloClicks',
            'unitsSoldBrandHalo',
            'unitsSoldBrandHaloClicks',
            'viewabilityRate',
            'viewClickThroughRate'
          ],
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'sdAdGroup',
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
      
      console.log(`[Amazon API] SD广告组报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SD广告组报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SD已购买商品报告
   * 基于Postman文档: reportTypeId = sdPurchasedProduct, groupBy = ["asin"]
   */
  async requestSdPurchasedProductReport(profileId: string, startDate: string, endDate: string): Promise<string> {
    try {
      this.setProfileId(profileId);
      
      const requestBody = {
        name: `SD Purchased Product Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_DISPLAY',
          groupBy: ['asin'],
          columns: [
            'date',
            'campaignId',
            'campaignName',
            'adGroupId',
            'adGroupName',
            'purchasedAsin',
            'impressions',
            'clicks',
            'cost',
            'sales',
            'salesClicks',
            'purchases',
            'purchasesClicks',
            'unitsSold',
            'unitsSoldClicks',
            'newToBrandSales',
            'newToBrandPurchases',
            'newToBrandUnitsSold'
          ],
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'sdPurchasedProduct',
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
      
      console.log(`[Amazon API] SD已购买商品报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SD已购买商品报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SP无效流量报告
   * 基于Postman文档: reportTypeId = spGrossAndInvalids, groupBy = ["campaign"]
   * 数据保留天数: 365天
   */
  async requestSpGrossAndInvalidsReport(profileId: string, startDate: string, endDate: string): Promise<string> {
    try {
      this.setProfileId(profileId);
      
      const requestBody = {
        name: `SP Gross And Invalids Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['campaign'],
          columns: [
            'date',
            'campaignId',
            'campaignName',
            'grossImpressions',
            'grossClickThroughs',
            'invalidImpressions',
            'invalidClickThroughs',
            'invalidImpressionRate',
            'invalidClickThroughRate'
          ],
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'spGrossAndInvalids',
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
      
      console.log(`[Amazon API] SP无效流量报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SP无效流量报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SB无效流量报告
   * 基于Postman文档: reportTypeId = sbGrossAndInvalids, groupBy = ["campaign"]
   * 数据保留天数: 365天
   */
  async requestSbGrossAndInvalidsReport(profileId: string, startDate: string, endDate: string): Promise<string> {
    try {
      this.setProfileId(profileId);
      
      const requestBody = {
        name: `SB Gross And Invalids Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_BRANDS',
          groupBy: ['campaign'],
          columns: [
            'date',
            'campaignId',
            'campaignName',
            'grossImpressions',
            'grossClickThroughs',
            'invalidImpressions',
            'invalidClickThroughs',
            'invalidImpressionRate',
            'invalidClickThroughRate'
          ],
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'sbGrossAndInvalids',
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
      
      console.log(`[Amazon API] SB无效流量报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SB无效流量报告失败:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 请求SD无效流量报告
   * 基于Postman文档: reportTypeId = sdGrossAndInvalids, groupBy = ["campaign"]
   * 数据保留天数: 365天
   */
  async requestSdGrossAndInvalidsReport(profileId: string, startDate: string, endDate: string): Promise<string> {
    try {
      this.setProfileId(profileId);
      
      const requestBody = {
        name: `SD Gross And Invalids Report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_DISPLAY',
          groupBy: ['campaign'],
          columns: [
            'date',
            'campaignId',
            'campaignName',
            'grossImpressions',
            'grossClickThroughs',
            'invalidImpressions',
            'invalidClickThroughs',
            'invalidImpressionRate',
            'invalidClickThroughRate'
          ],
          filters: [
            {
              field: 'campaignStatus',
              values: ['ARCHIVED', 'ENABLED', 'PAUSED']
            }
          ],
          reportTypeId: 'sdGrossAndInvalids',
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
      
      console.log(`[Amazon API] SD无效流量报告请求成功, reportId: ${response.data.reportId}`);
      return response.data.reportId;
    } catch (error: any) {
      console.error('[Amazon API] 请求SD无效流量报告失败:', error.response?.data || error.message);
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
    // ✅ 优化: 使用流式处理大文件，避免内存溢出
    // 参考文档: SP报告可能达到500MB+，必须流式处理
    const response = await axios.get(url, {
      responseType: 'stream',
    });
    
    const zlib = await import('zlib');
    const { Readable } = await import('stream');
    
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      const MAX_SIZE = 500 * 1024 * 1024; // 500MB限制
      
      const gunzip = zlib.createGunzip();
      
      response.data
        .pipe(gunzip)
        .on('data', (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize > MAX_SIZE) {
            gunzip.destroy();
            reject(new Error(`Report too large: ${totalSize} bytes exceeds ${MAX_SIZE} bytes limit`));
            return;
          }
          chunks.push(chunk);
        })
        .on('end', () => {
          try {
            const data = Buffer.concat(chunks).toString('utf-8');
            const result = JSON.parse(data);
            console.log(`[Amazon API] 报告解压完成，原始大小: ${totalSize} bytes, 数据条数: ${result?.length || 0}`);
            resolve(result);
          } catch (parseError: any) {
            reject(new Error(`Failed to parse report JSON: ${parseError.message}`));
          }
        })
        .on('error', (err: Error) => {
          reject(new Error(`Failed to decompress report: ${err.message}`));
        });
    });
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
    let pageCount = 0;
    
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
      
      // 调试日志：输出第一页第一个广告活动的完整结构
      if (pageCount === 0 && campaigns.length > 0) {
        console.log('[SB API DEBUG] First campaign full structure:');
        console.log(JSON.stringify(campaigns[0], null, 2));
        console.log('[SB API DEBUG] First campaign startDate:', campaigns[0].startDate);
        console.log('[SB API DEBUG] First campaign keys:', Object.keys(campaigns[0]));
        // 特别输出预算相关字段
        console.log('[SB API] 预算字段检查:');
        console.log('  - budget:', campaigns[0].budget);
        console.log('  - dailyBudget:', campaigns[0].dailyBudget);
        console.log('  - state:', campaigns[0].state);
        console.log('  - status:', campaigns[0].status);
      }
      
      allCampaigns.push(...campaigns);
      nextToken = response.data.nextToken;
      pageCount++;
      console.log(`[SB API] 第${pageCount}页获取到 ${campaigns.length} 个SB广告活动, 总计: ${allCampaigns.length}`);
    } while (nextToken);
    
    console.log(`[SB API] 共获取到 ${allCampaigns.length} 个SB广告活动`);
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
   * 使用extended端点获取更多字段，包括startDate
   * 已修复：添加分页逻辑，确保获取所有数据
   */
  async listSdCampaigns(): Promise<any[]> {
    const allCampaigns: any[] = [];
    let startIndex = 0;
    const count = 100;
    
    while (true) {
      // 优先使用extended端点获取更多字段（包括startDate）
      let response;
      try {
        response = await this.axiosInstance.get('/sd/campaigns/extended', {
          params: { startIndex, count }
        });
        console.log('[SD API] Using extended endpoint for more fields');
      } catch (error: any) {
        // 如果extended端点失败，回退到标准端点
        console.log('[SD API] Extended endpoint failed, falling back to standard endpoint');
        response = await this.axiosInstance.get('/sd/campaigns', {
          params: { startIndex, count }
        });
      }
      
      const campaigns = response.data || [];
      allCampaigns.push(...campaigns);
      console.log(`[SD API] Fetched ${campaigns.length} campaigns, total: ${allCampaigns.length}`);
      
      // 调试：打印第一个广告活动的完整结构
      if (allCampaigns.length > 0 && startIndex === 0) {
        console.log('[SD API DEBUG] First campaign full structure:', JSON.stringify(allCampaigns[0], null, 2));
        console.log('[SD API DEBUG] First campaign startDate:', allCampaigns[0].startDate);
        console.log('[SD API DEBUG] First campaign keys:', Object.keys(allCampaigns[0]));
      }
      
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

  // ==================== Amazon Marketing Stream (AMS) Methods ====================

  /**
   * 创建AMS订阅
   * 参考: https://advertising.amazon.com/API/docs/en-us/amazon-marketing-stream/stream-api
   * 
   * 注意: 
   * 1. AMS API端点与普通广告API端点不同
   * 2. 必须使用嵌套结构: destination: { type, arn }, dataSet: { id }
   * 3. clientRequestToken必须是UUID-v4格式，不超过36字符
   */
  async createAmsSubscription(
    dataSetId: AmsDatasetType,
    destinationArn: string,
    name?: string
  ): Promise<AmsSubscription> {
    // 生成UUID-v4格式的幂等性token（不超过36字符）
    const clientRequestToken = generateUuidV4();
    
    console.log(`[AMS] 创建订阅: dataSetId=${dataSetId}, destinationArn=${destinationArn}`);
    console.log(`[AMS] clientRequestToken: ${clientRequestToken} (长度: ${clientRequestToken.length})`);
    
    // 使用正确的嵌套结构
    const requestBody = {
      clientRequestToken,
      name: name || `${dataSetId}-subscription`,
      destination: {
        type: 'SQS',
        arn: destinationArn,
      },
      dataSet: {
        id: dataSetId,  // 注意: key是 "dataSet" (驼峰), 内部是 "id"
      },
    };
    
    console.log(`[AMS] 请求体:`, JSON.stringify(requestBody, null, 2));
    
    const response = await this.axiosInstance.post('/streams/subscriptions', requestBody);
    
    console.log(`[AMS] 订阅创建成功:`, response.data);
    return response.data;
  }

  /**
   * 获取所有AMS订阅列表
   */
  async listAmsSubscriptions(): Promise<AmsSubscription[]> {
    console.log('[AMS] 获取订阅列表...');
    
    const response = await this.axiosInstance.get('/streams/subscriptions');
    const subscriptions = response.data.subscriptions || response.data || [];
    
    console.log(`[AMS] 获取到 ${subscriptions.length} 个订阅`);
    return subscriptions;
  }

  /**
   * 获取单个AMS订阅详情
   */
  async getAmsSubscription(subscriptionId: string): Promise<AmsSubscription | null> {
    try {
      const response = await this.axiosInstance.get(`/streams/subscriptions/${subscriptionId}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 更新AMS订阅状态
   */
  async updateAmsSubscription(
    subscriptionId: string,
    updates: { status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'; notes?: string }
  ): Promise<AmsSubscription> {
    console.log(`[AMS] 更新订阅 ${subscriptionId}:`, updates);
    
    const response = await this.axiosInstance.put(
      `/streams/subscriptions/${subscriptionId}`,
      updates
    );
    
    return response.data;
  }

  /**
   * 删除/归档AMS订阅
   */
  async archiveAmsSubscription(subscriptionId: string): Promise<void> {
    console.log(`[AMS] 归档订阅 ${subscriptionId}`);
    
    await this.updateAmsSubscription(subscriptionId, { status: 'ARCHIVED' });
  }

  /**
   * 批量创建AMS订阅（快车道所需的所有数据集）
   * 
   * 快车道数据集 (有效的Dataset ID白名单):
   * - sp-traffic: SP实时流量（每小时推送，延迟2-5分钟）
   * - sb-traffic: SB实时流量
   * - sd-traffic: SD实时流量
   * - sp-budget-usage: SP预算监控（秒级/分钟级推送）
   * - sb-budget-usage: SB预算监控
   * - sd-budget-usage: SD预算监控
   * 
   * 注意: 没有sb-conversion和sd-conversion，只有sp-conversion
   */
  async createAllTrafficSubscriptions(destinationArn: string): Promise<{
    created: AmsSubscription[];
    failed: Array<{ dataSetId: string; error: string }>;
  }> {
    // 使用有效的数据集白名单
    const trafficDatasets: AmsDatasetType[] = VALID_TRAFFIC_DATASETS;
    
    const created: AmsSubscription[] = [];
    const failed: Array<{ dataSetId: string; error: string }> = [];
    
    for (const dataSetId of trafficDatasets) {
      try {
        // 检查是否已存在
        const existing = await this.listAmsSubscriptions();
        const existingSubscription = existing.find(
          s => s.dataSetId === dataSetId && s.status === 'ACTIVE'
        );
        
        if (existingSubscription) {
          console.log(`[AMS] 订阅 ${dataSetId} 已存在，跳过创建`);
          created.push(existingSubscription);
          continue;
        }
        
        const subscription = await this.createAmsSubscription(
          dataSetId,
          destinationArn,
          `Fast lane subscription for ${dataSetId}`
        );
        created.push(subscription);
        
        // 避免过快请求导致限流
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        console.error(`[AMS] 创建订阅 ${dataSetId} 失败:`, error.message);
        failed.push({
          dataSetId,
          error: error.response?.data?.message || error.message,
        });
      }
    }
    
    return { created, failed };
  }

  // ==================== V2 SB报告API（用于获取旧版SB广告数据） ====================

  /**
   * 请求V2 SB广告活动报告
   * V2 API用于获取2023年5月之前创建的旧版SB广告活动数据
   */
  async requestSbCampaignReportV2(reportDate: string, metrics: string[] = [
    'campaignName', 'campaignId', 'campaignStatus', 'campaignBudget', 'campaignBudgetType',
    'impressions', 'clicks', 'cost', 'attributedSales14d', 'attributedConversions14d'
  ]): Promise<{ reportId: string }> {
    console.log('[Amazon API V2] 请求SB报告, 日期:', reportDate);
    
    const response = await this.axiosInstance.post('/v2/hsa/campaigns/report', {
      reportDate,
      metrics,
    }, {
      headers: { 'Content-Type': 'application/json' },
    });
    
    console.log('[Amazon API V2] SB报告请求成功, reportId:', response.data.reportId);
    return { reportId: response.data.reportId };
  }

  /**
   * 请求V2 SB视频广告报告
   */
  async requestSbVideoCampaignReportV2(reportDate: string, metrics: string[] = [
    'campaignName', 'campaignId', 'campaignStatus', 'campaignBudget', 'campaignBudgetType',
    'impressions', 'clicks', 'cost', 'attributedSales14d', 'attributedConversions14d', 'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews'
  ]): Promise<{ reportId: string }> {
    console.log('[Amazon API V2] 请求SB视频报告, 日期:', reportDate);
    
    const response = await this.axiosInstance.post('/v2/hsa/campaigns/report', {
      reportDate,
      metrics,
      creativeType: 'video',
    }, {
      headers: { 'Content-Type': 'application/json' },
    });
    
    console.log('[Amazon API V2] SB视频报告请求成功, reportId:', response.data.reportId);
    return { reportId: response.data.reportId };
  }

  /**
   * 获取V2报告状态
   */
  async getReportStatusV2(reportId: string): Promise<{ status: string; location?: string }> {
    const response = await this.axiosInstance.get(`/v2/reports/${reportId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    
    console.log('[Amazon API V2] 报告状态:', response.data.status);
    return {
      status: response.data.status,
      location: response.data.location,
    };
  }

  /**
   * 等待并下载V2报告
   */
  async waitAndDownloadReportV2(reportId: string, maxWaitMs: number = 300000): Promise<any[]> {
    const startTime = Date.now();
    const pollInterval = 3000; // 3秒轮询一次
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const status = await this.getReportStatusV2(reportId);
        
        if (status.status === 'SUCCESS' && status.location) {
          console.log('[Amazon API V2] 报告已完成，开始下载...');
          
          // 下载报告（V2报告是gzip压缩的）
          const reportResponse = await this.axiosInstance.get(status.location, {
            responseType: 'arraybuffer',
            headers: { 'Accept-Encoding': 'gzip' },
          });
          
          // 解压gzip
          const zlib = await import('zlib');
          const decompressed = zlib.gunzipSync(Buffer.from(reportResponse.data));
          const reportData = JSON.parse(decompressed.toString('utf-8'));
          
          console.log('[Amazon API V2] 报告下载完成，共', Array.isArray(reportData) ? reportData.length : 0, '条记录');
          return Array.isArray(reportData) ? reportData : [];
        } else if (status.status === 'FAILURE') {
          console.error('[Amazon API V2] 报告生成失败');
          return [];
        }
        
        // 等待后继续轮询
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error: any) {
        console.error('[Amazon API V2] 轮询报告状态失败:', error.message);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    console.error('[Amazon API V2] 报告等待超时');
    return [];
  }

  /**
   * 获取完整的SB广告活动报告（结合V2和V3）
   */
  async getCompleteSbCampaignReport(startDate: string, endDate: string): Promise<any[]> {
    const allData: any[] = [];
    const seenCampaignIds = new Set<string>();
    
    // 1. 先尝试V3 API
    try {
      console.log('[Amazon API] 尝试V3 SB报告...');
      const v3Report = await this.requestSbCampaignReport(startDate, endDate);
      const v3Data = await this.waitAndDownloadReport(v3Report.reportId);
      
      for (const row of v3Data) {
        const campaignId = row.campaignId?.toString();
        if (campaignId && !seenCampaignIds.has(campaignId)) {
          seenCampaignIds.add(campaignId);
          allData.push(row);
        }
      }
      console.log('[Amazon API] V3 SB报告获取', v3Data.length, '条记录');
    } catch (error: any) {
      console.error('[Amazon API] V3 SB报告失败:', error.message);
    }
    
    // 2. 然后用V2 API补充旧版数据（逐天请求）
    try {
      console.log('[Amazon API] 尝试V2 SB报告...');
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
        
        try {
          // 普通SB报告
          const v2Report = await this.requestSbCampaignReportV2(dateStr);
          const v2Data = await this.waitAndDownloadReportV2(v2Report.reportId);
          
          for (const row of v2Data) {
            const campaignId = row.campaignId?.toString();
            if (campaignId && !seenCampaignIds.has(campaignId + '_' + dateStr)) {
              seenCampaignIds.add(campaignId + '_' + dateStr);
              allData.push({ ...row, date: d.toISOString().split('T')[0] });
            }
          }
          
          // SB视频报告
          const v2VideoReport = await this.requestSbVideoCampaignReportV2(dateStr);
          const v2VideoData = await this.waitAndDownloadReportV2(v2VideoReport.reportId);
          
          for (const row of v2VideoData) {
            const campaignId = row.campaignId?.toString();
            if (campaignId && !seenCampaignIds.has(campaignId + '_video_' + dateStr)) {
              seenCampaignIds.add(campaignId + '_video_' + dateStr);
              allData.push({ ...row, date: d.toISOString().split('T')[0], isVideo: true });
            }
          }
        } catch (error: any) {
          console.error('[Amazon API V2] 日期', dateStr, '报告失败:', error.message);
        }
      }
    } catch (error: any) {
      console.error('[Amazon API] V2 SB报告失败:', error.message);
    }
    
    console.log('[Amazon API] 完整SB报告共', allData.length, '条记录');
    return allData;
  }
}

// ==================== Amazon Marketing Stream (AMS) Types ====================

/**
 * AMS数据集类型
 * 参考: https://advertising.amazon.com/API/docs/en-us/amazon-marketing-stream/overview
 */
/**
 * AMS数据集类型 - 有效的Dataset ID白名单
 * 参考: https://advertising.amazon.com/API/docs/en-us/amazon-marketing-stream/overview
 * 
 * SP: sp-traffic, sp-conversion, sp-budget-usage
 * SB: sb-traffic, sb-budget-usage (注意: 没有sb-conversion)
 * SD: sd-traffic, sd-budget-usage (注意: 没有sd-conversion)
 */
export type AmsDatasetType = 
  | 'sp-traffic'      // SP实时流量数据（曝光、点击、花费）
  | 'sb-traffic'      // SB实时流量数据
  | 'sd-traffic'      // SD实时流量数据
  | 'sp-conversion'   // SP转化数据（订单、销售额）
  | 'sp-budget-usage' // SP预算消耗监控
  | 'sb-budget-usage' // SB预算消耗监控
  | 'sd-budget-usage';// SD预算消耗监控

// 有效的快车道数据集（用于实时数据同步）
export const VALID_TRAFFIC_DATASETS: AmsDatasetType[] = [
  'sp-traffic',
  'sb-traffic',
  'sd-traffic',
  'sp-budget-usage',
  'sb-budget-usage',
  'sd-budget-usage',
];

/**
 * 生成UUID-v4格式的clientRequestToken
 * 长度不超过36字符
 */
function generateUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * AMS订阅请求参数
 */
export interface AmsSubscriptionRequest {
  dataSetId: AmsDatasetType;
  destinationArn: string;  // SQS队列ARN
  clientRequestToken?: string;  // 幂等性token
  notes?: string;
}

/**
 * AMS订阅响应
 */
export interface AmsSubscription {
  subscriptionId: string;
  dataSetId: AmsDatasetType;
  destinationArn: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

/**
 * AMS消息结构（从SQS接收）
 */
export interface AmsMessage {
  messageId: string;
  subscriptionId: string;
  dataSetId: AmsDatasetType;
  timestamp: string;
  data: any;  // 具体数据结构根据dataSetId不同而不同
}

/**
 * SP Traffic数据结构
 */
export interface SpTrafficData {
  campaignId: string;
  adGroupId?: string;
  keywordId?: string;
  targetId?: string;
  date: string;
  hour: number;
  impressions: number;
  clicks: number;
  cost: number;
  currency: string;
}

/**
 * Budget Usage数据结构
 */
export interface BudgetUsageData {
  campaignId: string;
  budgetType: 'DAILY' | 'LIFETIME';
  budget: number;
  usedBudget: number;
  percentUsed: number;
  timestamp: string;
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
