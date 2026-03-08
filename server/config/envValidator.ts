/**
 * v361: 统一环境变量管理与验证
 * 
 * 启动时验证所有必需的环境变量，提供清晰的错误信息。
 * 集中管理所有环境变量的访问，避免散落在代码各处的 process.env 调用。
 */

import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('EnvValidator');

// ==================== 环境变量定义 ====================

interface EnvVarDef {
  /** 环境变量名 */
  name: string;
  /** 是否必需 */
  required: boolean;
  /** 默认值 */
  defaultValue?: string;
  /** 描述 */
  description: string;
  /** 分组 */
  group: 'database' | 'auth' | 'aws' | 'amazon_ads' | 'ai' | 'system' | 'sqs';
  /** 是否敏感（日志中隐藏） */
  sensitive?: boolean;
}

const ENV_DEFINITIONS: EnvVarDef[] = [
  // 数据库
  { name: 'DATABASE_URL', required: true, description: '数据库连接字符串', group: 'database', sensitive: true },
  { name: 'DB_POOL_SIZE', required: false, defaultValue: '20', description: '数据库连接池大小', group: 'database' },
  { name: 'DB_IDLE_TIMEOUT', required: false, defaultValue: '30000', description: '数据库空闲超时(ms)', group: 'database' },
  
  // 认证
  { name: 'JWT_SECRET', required: true, description: 'JWT签名密钥', group: 'auth', sensitive: true },
  { name: 'ENCRYPTION_KEY', required: false, description: '数据加密密钥', group: 'auth', sensitive: true },
  { name: 'OWNER_OPEN_ID', required: false, description: '系统所有者OpenID', group: 'auth' },
  
  // AWS
  { name: 'AWS_ACCESS_KEY_ID', required: false, description: 'AWS访问密钥ID', group: 'aws', sensitive: true },
  { name: 'AWS_SECRET_ACCESS_KEY', required: false, description: 'AWS秘密访问密钥', group: 'aws', sensitive: true },
  { name: 'AWS_REGION', required: false, defaultValue: 'us-east-1', description: 'AWS区域', group: 'aws' },
  
  // Amazon Ads
  { name: 'AMAZON_ADS_CLIENT_ID', required: false, description: 'Amazon Ads客户端ID', group: 'amazon_ads', sensitive: true },
  { name: 'AMAZON_ADS_CLIENT_SECRET', required: false, description: 'Amazon Ads客户端密钥', group: 'amazon_ads', sensitive: true },
  
  // AI
  { name: 'GEMINI_API_KEY', required: false, description: 'Gemini API密钥', group: 'ai', sensitive: true },
  { name: 'BUILT_IN_FORGE_API_KEY', required: false, description: 'Forge API密钥', group: 'ai', sensitive: true },
  { name: 'BUILT_IN_FORGE_API_URL', required: false, description: 'Forge API地址', group: 'ai' },
  
  // 系统
  { name: 'NODE_ENV', required: false, defaultValue: 'development', description: '运行环境', group: 'system' },
  { name: 'PORT', required: false, defaultValue: '5000', description: '服务端口', group: 'system' },
  { name: 'LOG_LEVEL', required: false, defaultValue: 'INFO', description: '日志级别', group: 'system' },
  { name: 'OPS_API_KEY', required: false, description: '运维API密钥', group: 'system', sensitive: true },
  
  // SQS队列
  { name: 'AWS_SQS_QUEUE_URL', required: false, description: 'SQS队列URL', group: 'sqs' },
  { name: 'AWS_SQS_QUEUE_TRAFFIC_URL', required: false, description: 'SQS流量队列URL', group: 'sqs' },
  { name: 'AWS_SQS_QUEUE_CONVERSION_URL', required: false, description: 'SQS转化队列URL', group: 'sqs' },
  { name: 'AWS_SQS_QUEUE_BUDGET_URL', required: false, description: 'SQS预算队列URL', group: 'sqs' },
];

// ==================== 验证函数 ====================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: Record<string, { total: number; set: number; missing: number }>;
}

/**
 * 验证所有环境变量
 */
export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const groupStats: Record<string, { total: number; set: number; missing: number }> = {};
  
  for (const def of ENV_DEFINITIONS) {
    // 初始化分组统计
    if (!groupStats[def.group]) {
      groupStats[def.group] = { total: 0, set: 0, missing: 0 };
    }
    groupStats[def.group].total++;
    
    const value = process.env[def.name];
    
    if (value) {
      groupStats[def.group].set++;
    } else if (def.required) {
      errors.push(`[${def.group}] 缺少必需的环境变量: ${def.name} - ${def.description}`);
      groupStats[def.group].missing++;
    } else if (!def.defaultValue) {
      warnings.push(`[${def.group}] 可选环境变量未设置: ${def.name} - ${def.description}`);
      groupStats[def.group].missing++;
    } else {
      groupStats[def.group].set++;
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: groupStats,
  };
}

/**
 * 启动时验证并输出报告
 */
export function validateAndReport(): boolean {
  const result = validateEnvironment();
  
  log.info('========== 环境变量验证报告 ==========');
  
  // 输出分组统计
  for (const [group, stats] of Object.entries(result.summary)) {
    const status = stats.missing === 0 ? '✓' : '⚠';
    log.info(`  ${status} ${group}: ${stats.set}/${stats.total} 已配置`);
  }
  
  // 输出错误
  if (result.errors.length > 0) {
    log.error(`发现 ${result.errors.length} 个环境变量错误:`);
    for (const err of result.errors) {
      log.error(`  ✗ ${err}`);
    }
  }
  
  // 输出警告（仅在DEBUG级别）
  if (result.warnings.length > 0) {
    log.debug(`${result.warnings.length} 个可选环境变量未设置`);
  }
  
  log.info(`验证结果: ${result.valid ? '通过' : '失败'} (${result.errors.length}错误, ${result.warnings.length}警告)`);
  log.info('=====================================');
  
  return result.valid;
}

// ==================== 类型安全的环境变量访问 ====================

/**
 * 获取环境变量值，支持默认值
 */
export function getEnv(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (value !== undefined) return value;
  if (defaultValue !== undefined) return defaultValue;
  
  // 查找定义中的默认值
  const def = ENV_DEFINITIONS.find(d => d.name === name);
  if (def?.defaultValue) return def.defaultValue;
  
  return '';
}

/**
 * 获取数字类型的环境变量
 */
export function getEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value !== undefined) {
    const num = Number(value);
    if (!isNaN(num)) return num;
  }
  return defaultValue;
}

/**
 * 获取布尔类型的环境变量
 */
export function getEnvBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1' || value === 'yes';
}

/**
 * 检查是否为生产环境
 */
export function isProduction(): boolean {
  return getEnv('NODE_ENV') === 'production';
}

/**
 * 检查是否为开发环境
 */
export function isDevelopment(): boolean {
  return getEnv('NODE_ENV', 'development') === 'development';
}
