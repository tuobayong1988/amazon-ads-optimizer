/**
 * v362: 日志脱敏模块
 * 
 * 防止敏感信息（refresh_token, access_token, API密钥等）被写入日志。
 * 在日志输出前自动扫描和替换敏感内容。
 */

/** 敏感字段模式列表 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OAuth tokens
  { pattern: /refresh_token['":\s]*['"]?([A-Za-z0-9|._-]{10,})['"]?/gi, replacement: 'refresh_token: "***REDACTED***"' },
  { pattern: /access_token['":\s]*['"]?([A-Za-z0-9|._-]{10,})['"]?/gi, replacement: 'access_token: "***REDACTED***"' },
  { pattern: /Atza\|[A-Za-z0-9._-]+/g, replacement: '***AMAZON_TOKEN_REDACTED***' },
  
  // API keys and secrets
  { pattern: /client_secret['":\s]*['"]?([A-Za-z0-9]{10,})['"]?/gi, replacement: 'client_secret: "***REDACTED***"' },
  { pattern: /api[_-]?key['":\s]*['"]?([A-Za-z0-9]{10,})['"]?/gi, replacement: 'api_key: "***REDACTED***"' },
  
  // AWS credentials
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: '***AWS_KEY_REDACTED***' },
  { pattern: /aws_secret_access_key['":\s]*['"]?([A-Za-z0-9/+=]{20,})['"]?/gi, replacement: 'aws_secret_access_key: "***REDACTED***"' },
  
  // Database passwords
  { pattern: /password['":\s]*['"]?([^'"{\s,]{6,})['"]?/gi, replacement: 'password: "***REDACTED***"' },
  
  // Bearer tokens in headers
  { pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/gi, replacement: 'Bearer ***REDACTED***' },
];

/**
 * 对日志消息进行脱敏处理
 * @param message 原始日志消息
 * @returns 脱敏后的消息
 */
export function sanitizeLogMessage(message: string): string {
  if (!message || typeof message !== 'string') return message;
  
  let sanitized = message;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    // 重置正则的lastIndex（全局标志的正则需要）
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

/**
 * 对对象进行深度脱敏（用于结构化日志）
 */
export function sanitizeObject(obj: unknown, depth: number = 0): unknown {
  if (depth > 5) return '[DEPTH_LIMIT]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeLogMessage(obj);
  if (typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }
  
  const result: Record<string, unknown> = {};
  const SENSITIVE_KEYS = new Set([
    'refresh_token', 'refreshToken', 'access_token', 'accessToken',
    'client_secret', 'clientSecret', 'password', 'secret',
    'api_key', 'apiKey', 'authorization',
  ]);
  
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '***REDACTED***';
    } else {
      result[key] = sanitizeObject(value, depth + 1);
    }
  }
  return result;
}
