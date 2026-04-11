// Extracted from production dist/index.js
// Original module: server/prelaunch/oxylabs.ts
// Lines: 237

function ensureCredentials() {
  if (!OXYLABS_USERNAME || !OXYLABS_PASSWORD) {
    throw new Error(
      "[Oxylabs] API credentials not configured. Please set OXYLABS_USERNAME and OXYLABS_PASSWORD environment variables."
    );
  }
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function oxylabsRequest(payload) {
  ensureCredentials();
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios_default.post(OXYLABS_ENDPOINT, payload, {
        auth: {
          username: OXYLABS_USERNAME,
          password: OXYLABS_PASSWORD
        },
        timeout: REQUEST_TIMEOUT_MS,
        headers: { "Content-Type": "application/json" }
      });
      const result = response.data?.results?.[0];
      if (!result) {
        console.warn(`[Oxylabs] Empty result for payload: ${JSON.stringify(payload).substring(0, 200)}`);
        return null;
      }
      if (result.status_code !== 200) {
        console.warn(`[Oxylabs] Non-200 status_code: ${result.status_code} for ${payload.source}/${payload.query}`);
        if (result.status_code >= 400 && result.status_code < 500) {
          return null;
        }
        throw new Error(`Oxylabs returned status ${result.status_code}`);
      }
      return result.content;
    } catch (error48) {
      const isAxiosError3 = error48 instanceof AxiosError2;
      const statusCode = isAxiosError3 ? error48.response?.status : void 0;
      const isRetryable = !statusCode || statusCode >= 500 || statusCode === 429;
      console.error(
        `[Oxylabs] Request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${error48.message}${statusCode ? ` [HTTP ${statusCode}]` : ""}`
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
function chunk(array2, size) {
  const chunks = [];
  for (let i = 0; i < array2.length; i += size) {
    chunks.push(array2.slice(i, i + size));
  }
  return chunks;
}
async function fetchSearchResults(keyword, options = {}) {
  const payload = {
    source: "amazon_search",
    domain: options.domain || "com",
    query: keyword,
    parse: true,
    pages: options.pages || 1
  };
  if (options.startPage) payload.start_page = options.startPage;
  if (options.geoLocation) payload.geo_location = options.geoLocation;
  const context = [];
  if (options.currency) context.push({ key: "currency", value: options.currency });
  if (options.sortBy) context.push({ key: "sort_by", value: options.sortBy });
  if (context.length > 0) payload.context = context;
  console.log(`[Oxylabs] Fetching search results for keyword: "${keyword}" (domain: ${payload.domain})`);
  const content = await oxylabsRequest(payload);
  if (!content || !content.results) {
    console.warn(`[Oxylabs] No search results for keyword: "${keyword}"`);
    return { organic: [], paid: [], totalResults: 0 };
  }
  return {
    organic: content.results.organic || [],
    paid: content.results.paid || [],
    totalResults: content.total_results_count || 0
  };
}
async function fetchProductDetails(asin, options = {}) {
  const payload = {
    source: "amazon_product",
    domain: options.domain || "com",
    query: asin,
    parse: true
  };
  if (options.geoLocation) payload.geo_location = options.geoLocation;
  const context = [];
  if (options.autoselectVariant !== false) {
    context.push({ key: "autoselect_variant", value: true });
  }
  if (options.currency) context.push({ key: "currency", value: options.currency });
  if (context.length > 0) payload.context = context;
  console.log(`[Oxylabs] Fetching product details for ASIN: ${asin}`);
  return await oxylabsRequest(payload);
}
async function fetchProductDetailsBatch(asins, options = {}) {
  const results = /* @__PURE__ */ new Map();
  const batches = chunk(asins, BATCH_CONCURRENCY);
  console.log(`[Oxylabs] Batch fetching ${asins.length} products in ${batches.length} batches (concurrency: ${BATCH_CONCURRENCY})`);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[Oxylabs] Processing batch ${i + 1}/${batches.length} (${batch.length} ASINs)`);
    const promises = batch.map(
      (asin) => fetchProductDetails(asin, options).then((detail) => {
        if (detail) results.set(asin, detail);
      })
    );
    await Promise.all(promises);
    if (i < batches.length - 1) {
      await delay(1e3);
    }
  }
  console.log(`[Oxylabs] Batch complete: ${results.size}/${asins.length} products fetched successfully`);
  return results;
}
async function discoverCompetitors(keywords10, options = {}) {
  const maxCompetitors = options.maxCompetitors || 25;
  const fetchDetail = options.fetchProductDetail !== false;
  console.log(`[Oxylabs] Starting competitor discovery with ${keywords10.length} keywords (max: ${maxCompetitors})`);
  const asinSearchDataMap = /* @__PURE__ */ new Map();
  for (const keyword of keywords10) {
    const searchResult = await fetchSearchResults(keyword, {
      domain: options.domain,
      geoLocation: options.geoLocation,
      currency: options.currency
    });
    const allItems = [...searchResult.organic, ...searchResult.paid];
    for (const item of allItems) {
      if (item.asin && !asinSearchDataMap.has(item.asin)) {
        asinSearchDataMap.set(item.asin, { item, keyword });
      }
    }
    await delay(500);
  }
  console.log(`[Oxylabs] Found ${asinSearchDataMap.size} unique ASINs from search results`);
  const topAsins = Array.from(asinSearchDataMap.entries()).sort((a, b) => (a[1].item.pos || a[1].item.rel_pos || 999) - (b[1].item.pos || b[1].item.rel_pos || 999)).slice(0, maxCompetitors);
  let productDetailsMap = /* @__PURE__ */ new Map();
  if (fetchDetail && topAsins.length > 0) {
    productDetailsMap = await fetchProductDetailsBatch(
      topAsins.map(([asin]) => asin),
      {
        domain: options.domain,
        geoLocation: options.geoLocation,
        currency: options.currency
      }
    );
  }
  const competitors = topAsins.map(([asin, { item }]) => {
    const productDetail = productDetailsMap.get(asin);
    return {
      asin,
      title: productDetail?.title || item.title || "",
      brand: productDetail?.brand || productDetail?.manufacturer || item.manufacturer || "",
      price: productDetail?.price || item.price || 0,
      rating: productDetail?.rating || item.rating || 0,
      reviewCount: productDetail?.reviews_count || item.reviews_count || 0,
      bsr: productDetail?.sales_rank?.[0]?.rank || 0,
      imageUrl: productDetail?.images?.[0] || item.url_image || "",
      isSponsored: item.is_sponsored || false,
      position: item.pos || item.rel_pos || 0,
      salesVolume: productDetail?.sales_volume || item.sales_volume,
      rawSearchData: item,
      rawProductData: productDetail || void 0
    };
  });
  console.log(`[Oxylabs] Competitor discovery complete: ${competitors.length} competitors with data`);
  return competitors;
}
async function checkServiceHealth() {
  const credentialsConfigured = !!(OXYLABS_USERNAME && OXYLABS_PASSWORD);
  if (!credentialsConfigured) {
    return {
      available: false,
      credentialsConfigured: false,
      message: "Oxylabs credentials not configured. Set OXYLABS_USERNAME and OXYLABS_PASSWORD in environment variables."
    };
  }
  try {
    const response = await axios_default.post(OXYLABS_ENDPOINT, {
      source: "amazon_search",
      domain: "com",
      query: "test",
      parse: true,
      pages: 1
    }, {
      auth: { username: OXYLABS_USERNAME, password: OXYLABS_PASSWORD },
      timeout: 3e4
    });
    return {
      available: true,
      credentialsConfigured: true,
      message: `Oxylabs service is operational. Response status: ${response.status}`
    };
  } catch (error48) {
    const statusCode = error48.response?.status;
    return {
      // @ts-ignore
      available: false,
      credentialsConfigured: true,
      // @ts-ignore
      message: `Oxylabs service check failed: ${error48.message}${statusCode ? ` [HTTP ${statusCode}]` : ""}`
    };
  }
}
var OXYLABS_USERNAME, OXYLABS_PASSWORD, OXYLABS_ENDPOINT, REQUEST_TIMEOUT_MS, MAX_RETRIES, RETRY_DELAY_BASE_MS, BATCH_CONCURRENCY;
var init_oxylabs = __esm({
  "server/prelaunch/oxylabs.ts"() {
    "use strict";
    init_axios2();
    OXYLABS_USERNAME = process.env.OXYLABS_USERNAME || "";
    OXYLABS_PASSWORD = process.env.OXYLABS_PASSWORD || "";
    OXYLABS_ENDPOINT = "https://realtime.oxylabs.io/v1/queries";
    REQUEST_TIMEOUT_MS = 6e4;
    MAX_RETRIES = 3;
    RETRY_DELAY_BASE_MS = 2e3;
    BATCH_CONCURRENCY = 5;
    __name(ensureCredentials, "ensureCredentials");
    __name(delay, "delay");
    __name(oxylabsRequest, "oxylabsRequest");
    __name(chunk, "chunk");
    __name(fetchSearchResults, "fetchSearchResults");
    __name(fetchProductDetails, "fetchProductDetails");
    __name(fetchProductDetailsBatch, "fetchProductDetailsBatch");
    __name(discoverCompetitors, "discoverCompetitors");
    __name(checkServiceHealth, "checkServiceHealth");
  }
});

