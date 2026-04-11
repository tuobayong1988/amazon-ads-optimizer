// Extracted from production dist/index.js
// Original module: server/utils/timezone.ts
// Lines: 66

function getMarketplaceTimezone(marketplace) {
  const normalizedMarketplace = marketplace?.toUpperCase() || "";
  return MARKETPLACE_TIMEZONES[normalizedMarketplace] || DEFAULT_TIMEZONE;
}
function getMarketplaceCurrentDate(marketplace) {
  const timezone = getMarketplaceTimezone(marketplace);
  const now = /* @__PURE__ */ new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(now);
}
function getMarketplaceDateRange(marketplace, daysBack) {
  const timezone = getMarketplaceTimezone(marketplace);
  const now = /* @__PURE__ */ new Date();
  const endDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const endDate = endDateFormatter.format(now);
  const startDateTime = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1e3);
  const startDate = endDateFormatter.format(startDateTime);
  return { startDate, endDate };
}
var MARKETPLACE_TIMEZONES, DEFAULT_TIMEZONE;
var init_timezone = __esm({
  "server/utils/timezone.ts"() {
    "use strict";
    MARKETPLACE_TIMEZONES = {
      // 北美站点 - 美国太平洋时间
      "US": "America/Los_Angeles",
      "CA": "America/Los_Angeles",
      "MX": "America/Los_Angeles",
      // 欧洲站点
      "UK": "Europe/London",
      "GB": "Europe/London",
      "DE": "Europe/Berlin",
      "FR": "Europe/Paris",
      "IT": "Europe/Rome",
      "ES": "Europe/Madrid",
      "NL": "Europe/Amsterdam",
      "SE": "Europe/Stockholm",
      "PL": "Europe/Warsaw",
      "BE": "Europe/Brussels",
      // 亚太站点
      "JP": "Asia/Tokyo",
      "AU": "Australia/Sydney",
      "SG": "Asia/Singapore",
      "IN": "Asia/Kolkata",
      "AE": "Asia/Dubai",
      "SA": "Asia/Riyadh",
      // 南美站点
      "BR": "America/Sao_Paulo"
    };
    DEFAULT_TIMEZONE = "America/Los_Angeles";
    __name(getMarketplaceTimezone, "getMarketplaceTimezone");
    __name(getMarketplaceCurrentDate, "getMarketplaceCurrentDate");
    __name(getMarketplaceDateRange, "getMarketplaceDateRange");
  }
});

