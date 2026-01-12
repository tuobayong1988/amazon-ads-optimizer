# Amazon Ads API 速率限制和最佳实践

## 速率限制概述

Amazon Ads API使用动态速率限制来保护系统免受过载。当请求过于频繁时，API会返回429 (Too Many Requests) 错误。

## 初始限制

新创建的API凭证有以下初始限制：

| 限制类型 | 值 | 说明 |
|---------|---|------|
| TPS | 1 | 每秒最多1个请求 |
| TPD | 8,640 | 每天最多8,640个请求 |
| 适用期 | 30天 | 初始30天内适用 |

## 基于收入的调整限制

初始期后，限制会根据过去30天的发货收入动态调整：

| 收入 | 获得的限制 |
|------|-----------|
| 每5美分 | +1 TPD |
| 每$4,320 | +1 TPS（最高10 TPS） |

## 关键术语

- **TPS (Transactions Per Second)**: 每秒可发送的最大API请求数
- **TPD (Transactions Per Day)**: 每天可发送的最大API请求数
- **429 TooManyRequests**: 超出速率限制时返回的HTTP状态码

## 不同API的速率限制

### Campaign Management API

| 操作类型 | P99保证响应时间 |
|---------|----------------|
| 同步CRUD操作 | 30秒 |

### Report API

报告API是异步的，有以下特点：
- 创建报告请求后需要轮询状态
- 报告生成通常需要几分钟到几小时
- 建议使用指数退避策略轮询状态

### Data Provider API

- 限制: 100 TPS

## 最佳实践

### 1. 实现指数退避

当收到429错误时，使用指数退避策略重试：

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.response?.status === 429 && i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.log(`Rate limited, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

### 2. 批量操作

尽可能使用批量操作减少API调用次数：

```typescript
// 不推荐：逐个更新
for (const keyword of keywords) {
  await updateKeyword(keyword);
}

// 推荐：批量更新
await updateKeywords(keywords);
```

### 3. 缓存策略

- 缓存不常变化的数据（如profiles、campaigns列表）
- 设置合理的缓存过期时间
- 使用增量同步而非全量同步

### 4. 请求队列

实现请求队列控制并发：

```typescript
class RequestQueue {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private minInterval = 1000; // 1秒间隔

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn());
        } catch (error) {
          reject(error);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();
      await new Promise(r => setTimeout(r, this.minInterval));
    }
    
    this.processing = false;
  }
}
```

### 5. 监控和告警

- 记录所有API调用和响应时间
- 监控429错误率
- 设置告警阈值

## 数据同步策略建议

### 实时数据 vs 历史数据

| 数据类型 | 推荐方式 | 频率 |
|---------|---------|------|
| Campaign配置 | Campaign List API | 每小时 |
| 实时性能数据 | Report API (DAILY) | 每天 |
| 历史性能数据 | Report API (SUMMARY) | 按需 |

### 同步优先级

1. **高优先级**: Campaign状态、预算变更
2. **中优先级**: 性能数据、关键词数据
3. **低优先级**: 历史报告、详细分析数据

### 增量同步策略

```typescript
// 使用lastUpdatedTime过滤只获取变更的数据
const campaigns = await api.listCampaigns({
  lastUpdatedTimeFilter: {
    startTime: lastSyncTime
  }
});
```

## 错误处理

### 常见错误码

| 状态码 | 说明 | 处理方式 |
|-------|------|---------|
| 400 | 请求参数错误 | 检查请求格式 |
| 401 | 认证失败 | 刷新Token |
| 403 | 权限不足 | 检查API权限 |
| 404 | 资源不存在 | 检查ID是否正确 |
| 429 | 速率限制 | 指数退避重试 |
| 500 | 服务器错误 | 稍后重试 |

### 错误恢复

```typescript
async function safeApiCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await retryWithBackoff(fn);
  } catch (error: any) {
    if (error.response?.status === 401) {
      // Token过期，刷新后重试
      await refreshToken();
      return await fn();
    }
    console.error('API call failed:', error.message);
    return null;
  }
}
```

## 参考资源

- [Amazon Ads API Rate Limiting](https://advertising.amazon.com/API/docs/en-us/concepts/rate-limiting)
- [Amazon Ads API Limits](https://advertising.amazon.com/API/docs/en-us/reference/concepts/limits)
