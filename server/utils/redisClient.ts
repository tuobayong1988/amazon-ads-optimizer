/**
 * v427: Redis 连接管理器
 * 
 * 提供统一的 Redis 连接管理，支持：
 * - 自动连接/重连
 * - 连接健康检查
 * - 优雅关闭
 * - 降级到无 Redis 模式
 * 
 * 使用方式：
 * ```
 * import { getRedis, isRedisAvailable } from './redisClient';
 * const redis = getRedis();
 * if (redis) { await redis.set('key', 'value'); }
 * ```
 */
import { createModuleLogger } from './logger';

const log = createModuleLogger('Redis');

let Redis: typeof import('ioredis').default | null = null;
let _client: InstanceType<typeof import('ioredis').default> | null = null;
let _isConnected = false;
let _initAttempted = false;
let _initPromise: Promise<boolean> | null = null;

/**
 * 初始化 Redis 连接
 * 延迟加载 ioredis，如果未安装则降级
 */
async function initRedis(): Promise<boolean> {
  if (_initAttempted) return _isConnected;
  _initAttempted = true;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.info('REDIS_URL 未配置，Redis 功能已禁用');
    return false;
  }

  try {
    // 动态导入 ioredis（如果未安装会抛出错误）
    const ioredis = await import('ioredis');
    Redis = ioredis.default;

    _client = new Redis(redisUrl, {
      // 连接配置
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 10) {
          log.error(`Redis 重连失败 ${times} 次，停止重试`);
          return null; // 停止重试
        }
        const delay = Math.min(times * 500, 5000);
        log.info(`Redis 重连中... (第 ${times} 次，${delay}ms 后重试)`);
        return delay;
      },
      // 超时配置
      connectTimeout: 5000,
      commandTimeout: 3000,
      // 性能配置
      enableReadyCheck: true,
      lazyConnect: false,
      // 断线重连
      reconnectOnError(err: Error) {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
        return targetErrors.some(e => err.message.includes(e));
      },
    });

    // 事件监听
    _client.on('connect', () => {
      log.info('Redis 已连接');
      _isConnected = true;
    });

    _client.on('ready', () => {
      log.info('Redis 就绪');
      _isConnected = true;
    });

    _client.on('error', (err: Error) => {
      log.error(`Redis 错误: ${err.message}`);
      _isConnected = false;
    });

    _client.on('close', () => {
      log.info('Redis 连接已关闭');
      _isConnected = false;
    });

    _client.on('reconnecting', () => {
      log.info('Redis 正在重连...');
    });

    // 等待连接就绪（最多5秒）
    await Promise.race([
      new Promise<void>((resolve) => {
        _client!.once('ready', resolve);
      }),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Redis 连接超时')), 5000);
      }),
    ]);

    log.info(`Redis 连接成功: ${redisUrl.replace(/\/\/.*@/, '//***@')}`);
    return true;
  } catch (e: unknown) {
    const msg = (e as Error).message || String(e);
    if (msg.includes('Cannot find module') || msg.includes('MODULE_NOT_FOUND')) {
      log.info('ioredis 未安装，Redis 功能已禁用（降级到 MySQL 锁）');
    } else {
      log.warn(`Redis 连接失败: ${msg}（降级到 MySQL 锁）`);
    }
    _client = null;
    _isConnected = false;
    return false;
  }
}

/**
 * 获取 Redis 客户端实例
 * 如果 Redis 不可用，返回 null
 */
export function getRedis(): InstanceType<typeof import('ioredis').default> | null {
  if (!_isConnected || !_client) return null;
  return _client;
}

/**
 * 确保 Redis 已初始化（异步）
 * 首次调用时初始化，后续调用返回缓存结果
 */
export async function ensureRedis(): Promise<boolean> {
  if (!_initPromise) {
    _initPromise = initRedis();
  }
  return _initPromise;
}

/**
 * 检查 Redis 是否可用
 */
export function isRedisAvailable(): boolean {
  return _isConnected && _client !== null;
}

/**
 * Redis 健康检查
 */
export async function redisHealthCheck(): Promise<{
  available: boolean;
  latencyMs: number;
  info?: string;
}> {
  if (!_client || !_isConnected) {
    return { available: false, latencyMs: -1 };
  }
  
  try {
    const start = Date.now();
    const pong = await _client.ping();
    const latencyMs = Date.now() - start;
    return {
      available: pong === 'PONG',
      latencyMs,
      info: `Connected, latency: ${latencyMs}ms`,
    };
  } catch (e: unknown) {
    return {
      available: false,
      latencyMs: -1,
      info: `Health check failed: ${(e as Error).message}`,
    };
  }
}

/**
 * 优雅关闭 Redis 连接
 */
export async function closeRedis(): Promise<void> {
  if (_client) {
    try {
      await _client.quit();
      log.info('Redis 连接已优雅关闭');
    } catch (e: unknown) {
      log.warn(`Redis 关闭异常: ${(e as Error).message}`);
      _client.disconnect();
    }
    _client = null;
    _isConnected = false;
    _initAttempted = false;
    _initPromise = null;
  }
}
