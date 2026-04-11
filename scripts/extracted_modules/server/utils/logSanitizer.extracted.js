// Extracted from production dist/index.js
// Original module: server/utils/logSanitizer.ts
// Lines: 70

var logSanitizer_exports = {};
__export(logSanitizer_exports, {
  sanitizeLogMessage: () => sanitizeLogMessage,
  sanitizeObject: () => sanitizeObject
});
function sanitizeLogMessage(message2) {
  if (!message2 || typeof message2 !== "string") return message2;
  let sanitized = message2;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}
function sanitizeObject(obj, depth = 0) {
  if (depth > 5) return "[DEPTH_LIMIT]";
  if (obj === null || obj === void 0) return obj;
  if (typeof obj === "string") return sanitizeLogMessage(obj);
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }
  const result = {};
  const SENSITIVE_KEYS = /* @__PURE__ */ new Set([
    "refresh_token",
    "refreshToken",
    "access_token",
    "accessToken",
    "client_secret",
    "clientSecret",
    "password",
    "secret",
    "api_key",
    "apiKey",
    "authorization"
  ]);
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "***REDACTED***";
    } else {
      result[key] = sanitizeObject(value, depth + 1);
    }
  }
  return result;
}
var SENSITIVE_PATTERNS;
var init_logSanitizer = __esm({
  "server/utils/logSanitizer.ts"() {
    "use strict";
    SENSITIVE_PATTERNS = [
      // OAuth tokens
      { pattern: /refresh_token['":\s]*['"]?([A-Za-z0-9|._-]{10,})['"]?/gi, replacement: 'refresh_token: "***REDACTED***"' },
      { pattern: /access_token['":\s]*['"]?([A-Za-z0-9|._-]{10,})['"]?/gi, replacement: 'access_token: "***REDACTED***"' },
      { pattern: /Atza\|[A-Za-z0-9._-]+/g, replacement: "***AMAZON_TOKEN_REDACTED***" },
      // API keys and secrets
      { pattern: /client_secret['":\s]*['"]?([A-Za-z0-9]{10,})['"]?/gi, replacement: 'client_secret: "***REDACTED***"' },
      { pattern: /api[_-]?key['":\s]*['"]?([A-Za-z0-9]{10,})['"]?/gi, replacement: 'api_key: "***REDACTED***"' },
      // AWS credentials
      { pattern: /AKIA[A-Z0-9]{16}/g, replacement: "***AWS_KEY_REDACTED***" },
      { pattern: /aws_secret_access_key['":\s]*['"]?([A-Za-z0-9/+=]{20,})['"]?/gi, replacement: 'aws_secret_access_key: "***REDACTED***"' },
      // Database passwords
      { pattern: /password['":\s]*['"]?([^'"{\s,]{6,})['"]?/gi, replacement: 'password: "***REDACTED***"' },
      // Bearer tokens in headers
      { pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/gi, replacement: "Bearer ***REDACTED***" }
    ];
    __name(sanitizeLogMessage, "sanitizeLogMessage");
    __name(sanitizeObject, "sanitizeObject");
  }
});

