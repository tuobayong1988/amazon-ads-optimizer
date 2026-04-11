// Extracted from production dist/index.js
// Original module: server/services/exchangeRateService.ts
// Lines: 162

async function fetchRatesFromApi() {
  try {
    log189.info("[ExchangeRateService] \u6B63\u5728\u4ECEAPI\u83B7\u53D6\u6700\u65B0\u6C47\u7387...");
    const response = await axios_default.get(API_URL, { timeout: 1e4 });
    if (response.data?.result !== "success" || !response.data?.rates) {
      log189.warn("[ExchangeRateService] API\u8FD4\u56DE\u5F02\u5E38:", response.data?.result);
      return null;
    }
    const apiRates = response.data.rates;
    const ratesToUsd = {};
    for (const [currency, rateFromUsd] of Object.entries(apiRates)) {
      if (typeof rateFromUsd === "number" && rateFromUsd > 0) {
        ratesToUsd[currency] = 1 / rateFromUsd;
      }
    }
    ratesToUsd["USD"] = 1;
    log189.info(`[ExchangeRateService] API\u83B7\u53D6\u6210\u529F\uFF0C\u5171${Object.keys(ratesToUsd).length}\u79CD\u8D27\u5E01`);
    const requiredCurrencies = ["CAD", "MXN", "GBP", "EUR", "JPY", "AUD"];
    const missing = requiredCurrencies.filter((c) => !ratesToUsd[c]);
    if (missing.length > 0) {
      log189.warn(`[ExchangeRateService] \u7F3A\u5C11\u5173\u952E\u8D27\u5E01: ${missing.join(", ")}\uFF0C\u4F7F\u7528\u515C\u5E95\u503C\u8865\u5145`);
      for (const c of missing) {
        ratesToUsd[c] = FALLBACK_RATES_TO_USD[c] || 1;
      }
    }
    return ratesToUsd;
  } catch (error48) {
    log189.warn(`[ExchangeRateService] API\u8BF7\u6C42\u5931\u8D25: ${error48.message}`);
    return null;
  }
}
function loadRatesFromFile() {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, "utf-8"));
    if (data?.rates && data?.lastUpdated) {
      log189.info(`[ExchangeRateService] \u4ECE\u6587\u4EF6\u7F13\u5B58\u52A0\u8F7D\u6C47\u7387\uFF0C\u66F4\u65B0\u65F6\u95F4: ${new Date(data.lastUpdated).toISOString()}`);
      return { rates: data.rates, lastUpdated: data.lastUpdated, source: "file" };
    }
  } catch (error48) {
    log189.warn(`[ExchangeRateService] \u6587\u4EF6\u7F13\u5B58\u8BFB\u53D6\u5931\u8D25: ${error48.message}`);
  }
  return null;
}
function saveRatesToFile(rates) {
  try {
    const data = { rates, lastUpdated: Date.now() };
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(data, null, 2));
    log189.info("[ExchangeRateService] \u6C47\u7387\u5DF2\u4FDD\u5B58\u5230\u6587\u4EF6\u7F13\u5B58");
  } catch (error48) {
    log189.warn(`[ExchangeRateService] \u6587\u4EF6\u7F13\u5B58\u5199\u5165\u5931\u8D25: ${error48.message}`);
  }
}
async function getExchangeRates() {
  if (rateCache && Date.now() - rateCache.lastUpdated < CACHE_TTL_MS6) {
    return rateCache.rates;
  }
  const apiRates = await fetchRatesFromApi();
  if (apiRates) {
    rateCache = { rates: apiRates, lastUpdated: Date.now(), source: "api" };
    saveRatesToFile(apiRates);
    return apiRates;
  }
  const fileCache = loadRatesFromFile();
  if (fileCache) {
    rateCache = fileCache;
    return fileCache.rates;
  }
  log189.warn("[ExchangeRateService] \u6240\u6709\u6C47\u7387\u6E90\u4E0D\u53EF\u7528\uFF0C\u4F7F\u7528\u9759\u6001\u515C\u5E95\u6C47\u7387");
  rateCache = { rates: FALLBACK_RATES_TO_USD, lastUpdated: Date.now(), source: "fallback" };
  return FALLBACK_RATES_TO_USD;
}
async function getExchangeRate(currency) {
  const rates = await getExchangeRates();
  return rates[currency] || 1;
}
async function getExchangeRateByMarketplace(marketplace) {
  const currency = MARKETPLACE_CURRENCY[marketplace] || "USD";
  const rate = await getExchangeRate(currency);
  return { currency, rate };
}
function getExchangeRateStatus() {
  if (!rateCache) {
    return { source: "not_initialized", lastUpdated: null, ageMinutes: -1, currencyCount: 0 };
  }
  return {
    source: rateCache.source,
    lastUpdated: new Date(rateCache.lastUpdated).toISOString(),
    ageMinutes: Math.round((Date.now() - rateCache.lastUpdated) / 6e4),
    currencyCount: Object.keys(rateCache.rates).length
  };
}
async function refreshExchangeRates() {
  rateCache = null;
  const rates = await getExchangeRates();
  const status = getExchangeRateStatus();
  return {
    success: status.source === "api",
    source: status.source,
    message: status.source === "api" ? `\u6C47\u7387\u5DF2\u4ECEAPI\u5237\u65B0\uFF0C\u5171${status.currencyCount}\u79CD\u8D27\u5E01` : `API\u4E0D\u53EF\u7528\uFF0C\u4F7F\u7528${status.source}\u6570\u636E\u6E90`
  };
}
var fs, log189, FALLBACK_RATES_TO_USD, MARKETPLACE_CURRENCY, rateCache, CACHE_TTL_MS6, CACHE_FILE_PATH, API_URL;
var init_exchangeRateService = __esm({
  "server/services/exchangeRateService.ts"() {
    "use strict";
    init_axios2();
    fs = __toESM(require("fs"));
    init_logger();
    log189 = createModuleLogger("ExchangeRate");
    FALLBACK_RATES_TO_USD = {
      "USD": 1,
      "CAD": 0.7345,
      "MXN": 0.0495,
      "GBP": 1.27,
      "EUR": 1.08,
      "JPY": 67e-4,
      "AUD": 0.65,
      "SGD": 0.74,
      "INR": 0.012,
      "AED": 0.2723,
      "SAR": 0.2667,
      "BRL": 0.17,
      "SEK": 0.096,
      "PLN": 0.25
    };
    MARKETPLACE_CURRENCY = {
      "US": "USD",
      "CA": "CAD",
      "MX": "MXN",
      "BR": "BRL",
      "UK": "GBP",
      "DE": "EUR",
      "FR": "EUR",
      "IT": "EUR",
      "ES": "EUR",
      "NL": "EUR",
      "SE": "SEK",
      "PL": "PLN",
      "BE": "EUR",
      "JP": "JPY",
      "AU": "AUD",
      "SG": "SGD",
      "IN": "INR",
      "AE": "AED",
      "SA": "SAR"
    };
    rateCache = null;
    CACHE_TTL_MS6 = 12 * 60 * 60 * 1e3;
    CACHE_FILE_PATH = "/tmp/exchange_rates_cache.json";
    API_URL = "https://open.er-api.com/v6/latest/USD";
    __name(fetchRatesFromApi, "fetchRatesFromApi");
    __name(loadRatesFromFile, "loadRatesFromFile");
    __name(saveRatesToFile, "saveRatesToFile");
    __name(getExchangeRates, "getExchangeRates");
    __name(getExchangeRate, "getExchangeRate");
    __name(getExchangeRateByMarketplace, "getExchangeRateByMarketplace");
    __name(getExchangeRateStatus, "getExchangeRateStatus");
    __name(refreshExchangeRates, "refreshExchangeRates");
  }
});

