/**
 * Oxylabs Amazon Scraper API 客户端
 * 
 * 负责与 Oxylabs Web Scraper API 交互，获取亚马逊搜索结果和产品详情的真实数据。
 * 用于替代 M2 竞品库引擎中基于 Gemini AI 的模拟数据源。
 * 
 * @see https://developers.oxylabs.io/scraping-solutions/web-scraper-api/targets/amazon
 */
import axios, { AxiosError } from 'axios';

// ─── 配置 ────────────────────────────────────────────────────────────────────

const OXYLABS_USERNAME = process.env.OXYLABS_USERNAME || '';
const OXYLABS_PASSWORD = process.env.OXYLABS_PASSWORD || '';
const OXYLABS_ENDPOINT = 'https://realtime.oxylabs.io/v1/queries';

/** 请求超时时间（毫秒）。Oxylabs 实时接口通常在 5-15 秒内返回。 */
const REQUEST_TIMEOUT_MS = 60_000;

/** 最大重试次数 */
const MAX_RETRIES = 3;

/** 重试间隔基数（毫秒），实际间隔 = BASE * 2^retryCount（指数退避） */
const RETRY_DELAY_BASE_MS = 2_000;

/** 每批次并发请求数上限，避免触发 Oxylabs 速率限制 */
const BATCH_CONCURRENCY = 5;

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** Oxylabs Search API 返回的单个搜索结果项 */
export interface OxylabsSearchItem {
  pos?: number;
  rel_pos?: number;
  url: string;
  asin: string;
  price: number;
  title: string;
  rating: number;
  currency: string;
  url_image: string;
  best_seller: boolean;
  is_sponsored: boolean;
  manufacturer: string;
  reviews_count: number;
  is_amazons_choice: boolean;
  sales_volume?: string;
  is_prime: boolean;
  shipping_information?: string;
  price_upper?: number;
  price_strikethrough?: number;
  coupon_discount?: number;
  coupon_discount_type?: string;
}

/** Oxylabs Search API 的解析后响应结构 */
export interface OxylabsSearchResponse {
  url: string;
  page: number;
  pages: number;
  query: string;
  results: {
    paid: OxylabsSearchItem[];
    organic: OxylabsSearchItem[];
    suggested: OxylabsSearchItem[];
    amazons_choices: OxylabsSearchItem[];
  };
  total_results_count: number;
  parse_status_code: number;
}

/** Oxylabs Product API 返回的 sales_rank 项 */
export interface OxylabsSalesRank {
  category: string;
  rank: number;
}

/** Oxylabs Product API 返回的产品详情 */
export interface OxylabsProductDetail {
  asin: string;
  title: string;
  manufacturer?: string;
  brand?: string;
  description?: string;
  bullet_points?: string;
  price: number;
  price_upper?: number;
  price_initial?: number;
  rating: number;
  reviews_count: number;
  sales_rank?: OxylabsSalesRank[];
  sales_volume?: string;
  images?: string[];
  is_prime_eligible?: boolean;
  stock?: string;
  category?: { ladder: { name: string; url: string }[] }[];
  variation?: unknown[];
  product_overview?: { key: string; value: string }[];
  featured_merchant?: { name: string; link: string; id: string };
  buybox?: unknown;
  rating_stars_distribution?: { rating: number; percentage: number }[];
  currency?: string;
  url?: string;
}

/** 从搜索结果中提取的、用于写入数据库的标准化竞品数据 */
export interface DiscoveredCompetitor {
  asin: string;
  title: string;
  brand: string;
  price: number;
  rating: number;
  reviewCount: number;
  bsr: number;
  imageUrl: string;
  isSponsored: boolean;
  position: number;
  salesVolume?: string;
  rawSearchData: OxylabsSearchItem;
  rawProductData?: OxylabsProductDetail;
}

// ─── 内部工具函数 ──────────────────────────────────────────────────────────────

/**
 * 检查 Oxylabs 凭证是否已配置
 */
function ensureCredentials(): void {
  if (!OXYLABS_USERNAME || !OXYLABS_PASSWORD) {
    throw new Error(
      '[Oxylabs] API credentials not configured. ' +
      'Please set OXYLABS_USERNAME and OXYLABS_PASSWORD environment variables.'
    );
  }
}

/**
 * 带指数退避的延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 向 Oxylabs Realtime API 发送请求，内置重试和错误处理。
 * 
 * @param payload - Oxylabs API 请求体
 * @returns 解析后的内容，或在所有重试失败后返回 null
 */
async function oxylabsRequest<T>(payload: Record<string, unknown>): Promise<T | null> {
  ensureCredentials();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(OXYLABS_ENDPOINT, payload, {
        auth: {
          username: OXYLABS_USERNAME,
          password: OXYLABS_PASSWORD,
        },
        timeout: REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      });

      const result = response.data?.results?.[0];

      if (!result) {
        console.warn(`[Oxylabs] Empty result for payload: ${JSON.stringify(payload).substring(0, 200)}`);
        return null;
      }

      // 检查 HTTP 状态码和解析状态码
      if (result.status_code !== 200) {
        console.warn(`[Oxylabs] Non-200 status_code: ${result.status_code} for ${payload.source}/${payload.query}`);
        // 对于 4xx 错误不重试
        if (result.status_code >= 400 && result.status_code < 500) {
          return null;
        }
        throw new Error(`Oxylabs returned status ${result.status_code}`);
      }

      return result.content as T;

    } catch (error: unknown) {
      const isAxiosError = error instanceof AxiosError;
      const statusCode = isAxiosError ? error.response?.status : undefined;
      const isRetryable = !statusCode || statusCode >= 500 || statusCode === 429;

      console.error(
        `[Oxylabs] Request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ` +
        `${error.message}${statusCode ? ` [HTTP ${statusCode}]` : ''}`
      );

      if (attempt < MAX_RETRIES && isRetryable) {
        const delayMs = RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
        console.log(`[Oxylabs] Retrying in ${delayMs}ms...`);
        await delay(delayMs);
      } else {
        console.error(`[Oxylabs] All retries exhausted for ${payload.source}/${payload.query}`);
        return null;
      }
    }
  }

  return null;
}

/**
 * 将数组按指定大小分批
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ─── 公开 API 函数 ─────────────────────────────────────────────────────────────

/**
 * 爬取亚马逊搜索结果页（SERP）
 * 
 * 对应预发布引擎场景 SC-1: 关键词-ASIN映射
 * 
 * @param keyword - 搜索关键词
 * @param options - 可选参数
 * @returns 搜索结果列表（包含 organic + paid），按位置排序
 */
export async function fetchSearchResults(
  keyword: string,
  options: {
    domain?: string;
    pages?: number;
    startPage?: number;
    geoLocation?: string;
    currency?: string;
    sortBy?: 'most_recent' | 'price_low_to_high' | 'price_high_to_low' | 'featured' | 'average_review' | 'bestsellers';
  } = {}
): Promise<{ organic: OxylabsSearchItem[]; paid: OxylabsSearchItem[]; totalResults: number }> {
  const payload: Record<string, unknown> = {
    source: 'amazon_search',
    domain: options.domain || 'com',
    query: keyword,
    parse: true,
    pages: options.pages || 1,
  };

  if (options.startPage) payload.start_page = options.startPage;
  if (options.geoLocation) payload.geo_location = options.geoLocation;

  const context: unknown[] = [];
  if (options.currency) context.push({ key: 'currency', value: options.currency });
  if (options.sortBy) context.push({ key: 'sort_by', value: options.sortBy });
  if (context.length > 0) payload.context = context;

  console.log(`[Oxylabs] Fetching search results for keyword: "${keyword}" (domain: ${payload.domain})`);

  const content = await oxylabsRequest<OxylabsSearchResponse>(payload);

  if (!content || !content.results) {
    console.warn(`[Oxylabs] No search results for keyword: "${keyword}"`);
    return { organic: [], paid: [], totalResults: 0 };
  }

  return {
    organic: content.results.organic || [],
    paid: content.results.paid || [],
    totalResults: content.total_results_count || 0,
  };
}

/**
 * 爬取单个亚马逊产品详情页
 * 
 * 对应预发布引擎场景 SC-2: 竞品7因子数据采集
 * 
 * @param asin - 亚马逊产品 ASIN
 * @param options - 可选参数
 * @returns 产品详情，或在失败时返回 null
 */
export async function fetchProductDetails(
  asin: string,
  options: {
    domain?: string;
    geoLocation?: string;
    currency?: string;
    autoselectVariant?: boolean;
  } = {}
): Promise<OxylabsProductDetail | null> {
  const payload: Record<string, unknown> = {
    source: 'amazon_product',
    domain: options.domain || 'com',
    query: asin,
    parse: true,
  };

  if (options.geoLocation) payload.geo_location = options.geoLocation;

  const context: unknown[] = [];
  if (options.autoselectVariant !== false) {
    context.push({ key: 'autoselect_variant', value: true });
  }
  if (options.currency) context.push({ key: 'currency', value: options.currency });
  if (context.length > 0) payload.context = context;

  console.log(`[Oxylabs] Fetching product details for ASIN: ${asin}`);

  return await oxylabsRequest<OxylabsProductDetail>(payload);
}

/**
 * 批量获取多个产品的详情，自动控制并发。
 * 
 * @param asins - ASIN 列表
 * @param options - 可选参数
 * @returns 产品详情映射表 (ASIN → ProductDetail)
 */
export async function fetchProductDetailsBatch(
  asins: string[],
  options: {
    domain?: string;
    geoLocation?: string;
    currency?: string;
  } = {}
): Promise<Map<string, OxylabsProductDetail>> {
  const results = new Map<string, OxylabsProductDetail>();
  const batches = chunk(asins, BATCH_CONCURRENCY);

  console.log(`[Oxylabs] Batch fetching ${asins.length} products in ${batches.length} batches (concurrency: ${BATCH_CONCURRENCY})`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[Oxylabs] Processing batch ${i + 1}/${batches.length} (${batch.length} ASINs)`);

    const promises = batch.map(asin =>
      fetchProductDetails(asin, options).then(detail => {
        if (detail) results.set(asin, detail);
      })
    );

    await Promise.all(promises);

    // 批次间添加短暂延迟，避免速率限制
    if (i < batches.length - 1) {
      await delay(1000);
    }
  }

  console.log(`[Oxylabs] Batch complete: ${results.size}/${asins.length} products fetched successfully`);
  return results;
}

/**
 * 完整的竞品发现流程：搜索关键词 → 提取ASIN → 获取产品详情 → 返回标准化竞品数据
 * 
 * 这是 M2 竞品库引擎的核心数据获取函数，整合了 Search API 和 Product API。
 * 
 * @param keywords - 核心搜索关键词列表
 * @param options - 可选参数
 * @returns 去重后的竞品数据列表
 */
export async function discoverCompetitors(
  keywords: string[],
  options: {
    domain?: string;
    maxCompetitors?: number;
    fetchProductDetail?: boolean;
    geoLocation?: string;
    currency?: string;
  } = {}
): Promise<DiscoveredCompetitor[]> {
  const maxCompetitors = options.maxCompetitors || 25;
  const fetchDetail = options.fetchProductDetail !== false;

  console.log(`[Oxylabs] Starting competitor discovery with ${keywords.length} keywords (max: ${maxCompetitors})`);

  // Phase 1: 搜索所有关键词，收集搜索结果
  const asinSearchDataMap = new Map<string, { item: OxylabsSearchItem; keyword: string }>();

  for (const keyword of keywords) {
    const searchResult = await fetchSearchResults(keyword, {
      domain: options.domain,
      geoLocation: options.geoLocation,
      currency: options.currency,
    });

    // 合并 organic 和 paid 结果
    const allItems = [...searchResult.organic, ...searchResult.paid];

    for (const item of allItems) {
      if (item.asin && !asinSearchDataMap.has(item.asin)) {
        asinSearchDataMap.set(item.asin, { item, keyword });
      }
    }

    // 关键词间添加延迟
    await delay(500);
  }

  console.log(`[Oxylabs] Found ${asinSearchDataMap.size} unique ASINs from search results`);

  // 取前 N 个 ASIN（按搜索结果中的位置排序）
  const topAsins = Array.from(asinSearchDataMap.entries())
    .sort((a, b) => (a[1].item.pos || a[1].item.rel_pos || 999) - (b[1].item.pos || b[1].item.rel_pos || 999))
    .slice(0, maxCompetitors);

  // Phase 2: 获取产品详情（可选，用于获取 BSR 等搜索结果中没有的数据）
  let productDetailsMap = new Map<string, OxylabsProductDetail>();

  if (fetchDetail && topAsins.length > 0) {
    productDetailsMap = await fetchProductDetailsBatch(
      topAsins.map(([asin]) => asin),
      {
        domain: options.domain,
        geoLocation: options.geoLocation,
        currency: options.currency,
      }
    );
  }

  // Phase 3: 组装标准化竞品数据
  const competitors: DiscoveredCompetitor[] = topAsins.map(([asin, { item }]) => {
    const productDetail = productDetailsMap.get(asin);

    return {
      asin,
      title: productDetail?.title || item.title || '',
      brand: productDetail?.brand || productDetail?.manufacturer || item.manufacturer || '',
      price: productDetail?.price || item.price || 0,
      rating: productDetail?.rating || item.rating || 0,
      reviewCount: productDetail?.reviews_count || item.reviews_count || 0,
      bsr: productDetail?.sales_rank?.[0]?.rank || 0,
      imageUrl: productDetail?.images?.[0] || item.url_image || '',
      isSponsored: item.is_sponsored || false,
      position: item.pos || item.rel_pos || 0,
      salesVolume: productDetail?.sales_volume || item.sales_volume,
      rawSearchData: item,
      rawProductData: productDetail || undefined,
    };
  });

  console.log(`[Oxylabs] Competitor discovery complete: ${competitors.length} competitors with data`);
  return competitors;
}

/**
 * 检查 Oxylabs 服务是否可用（凭证是否有效）
 * 
 * @returns 服务状态信息
 */
export async function checkServiceHealth(): Promise<{
  available: boolean;
  credentialsConfigured: boolean;
  message: string;
}> {
  const credentialsConfigured = !!(OXYLABS_USERNAME && OXYLABS_PASSWORD);

  if (!credentialsConfigured) {
    return {
      available: false,
      credentialsConfigured: false,
      message: 'Oxylabs credentials not configured. Set OXYLABS_USERNAME and OXYLABS_PASSWORD in environment variables.',
    };
  }

  try {
    // 使用一个轻量级请求来验证凭证
    const response = await axios.post(OXYLABS_ENDPOINT, {
      source: 'amazon_search',
      domain: 'com',
      query: 'test',
      parse: true,
      pages: 1,
    }, {
      auth: { username: OXYLABS_USERNAME, password: OXYLABS_PASSWORD },
      timeout: 30_000,
    });

    return {
      available: true,
      credentialsConfigured: true,
      message: `Oxylabs service is operational. Response status: ${response.status}`,
    };
  } catch (error: unknown) {
    const statusCode = error.response?.status;
    return {
      available: false,
      credentialsConfigured: true,
      message: `Oxylabs service check failed: ${error.message}${statusCode ? ` [HTTP ${statusCode}]` : ''}`,
    };
  }
}
