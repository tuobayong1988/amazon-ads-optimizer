/**
 * API缓存中间件
 * 功能：
 * 1. 缓存GET请求的响应数据
 * 2. 支持自定义缓存时间
 * 3. 支持缓存失效策略
 * 4. 减少数据库查询压力
 */

class ApiCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.defaultTTL = options.defaultTTL || 5 * 60 * 1000; // 默认5分钟
    this.maxSize = options.maxSize || 1000; // 最大缓存条目数
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
  }
  
  /**
   * 生成缓存键
   */
  generateKey(req) {
    const { method, path, query } = req;
    const queryString = JSON.stringify(query || {});
    return `${method}:${path}:${queryString}`;
  }
  
  /**
   * 获取缓存
   */
  get(key) {
    const cached = this.cache.get(key);
    
    if (!cached) {
      this.stats.misses++;
      return null;
    }
    
    // 检查是否过期
    if (Date.now() > cached.expireAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    this.stats.hits++;
    return cached.data;
  }
  
  /**
   * 设置缓存
   */
  set(key, data, ttl) {
    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.stats.deletes++;
    }
    
    const expireAt = Date.now() + (ttl || this.defaultTTL);
    
    this.cache.set(key, {
      data: data,
      expireAt: expireAt,
      createdAt: Date.now()
    });
    
    this.stats.sets++;
  }
  
  /**
   * 删除缓存
   */
  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
    }
    return deleted;
  }
  
  /**
   * 清空缓存
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.deletes += size;
  }
  
  /**
   * 清空特定前缀的缓存
   */
  clearByPrefix(prefix) {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.deletes += count;
    return count;
  }
  
  /**
   * 获取缓存统计信息
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }
  
  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
  }
  
  /**
   * Express中间件
   */
  middleware(options = {}) {
    const self = this;
    const ttl = options.ttl || this.defaultTTL;
    const enabled = options.enabled !== false;
    
    return function(req, res, next) {
      // 只缓存GET请求
      if (req.method !== 'GET' || !enabled) {
        return next();
      }
      
      const key = self.generateKey(req);
      const cached = self.get(key);
      
      if (cached) {
        console.log('[ApiCache] Cache HIT:', key);
        return res.json(cached);
      }
      
      console.log('[ApiCache] Cache MISS:', key);
      
      // 劫持res.json方法
      const originalJson = res.json.bind(res);
      res.json = function(data) {
        // 缓存响应数据
        self.set(key, data, ttl);
        return originalJson(data);
      };
      
      next();
    };
  }
}

// 创建全局缓存实例
const globalCache = new ApiCache({
  defaultTTL: 5 * 60 * 1000, // 5分钟
  maxSize: 1000
});

// 导出缓存实例和类
module.exports = {
  ApiCache,
  globalCache
};
