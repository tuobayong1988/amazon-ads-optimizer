// @ts-nocheck
/**
 * server/services/adaptiveRateLimiter.ts
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */



function getAdaptiveRateLimiter() {
  if (!_instance) {
    _instance = new AdaptiveRateLimiter();
  }
  return _instance;
}
function recordApiResponseForAdaptiveLimiting(accountId, endpointType, responseHeaders, latencyMs, statusCode) {
  try {
    const limiter = getAdaptiveRateLimiter();
    const headers = AdaptiveRateLimiter.extractRateLimitHeaders(responseHeaders);
    headers.statusCode = statusCode;
    limiter.recordApiResponse(accountId, endpointType, headers, latencyMs);
  } catch (e) {
    log28.debug(`[v548] \u81EA\u9002\u5E94\u9650\u6D41\u8BB0\u5F55\u5931\u8D25: ${e.message}`);
  }
}
var log28, WINDOW_SIZE_MS, MIN_ADJUSTMENT_INTERVAL_MS, SPEED_UP_FACTOR, SLOW_DOWN_FACTOR, SPEED_UP_THRESHOLD, SAFETY_MARGIN, MIN_TPS, BASELINE_TPS, MAX_TPS, AdaptiveRateLimiter, _instance;
