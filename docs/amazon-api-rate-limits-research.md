# 亚马逊广告API频率限制研究

## 来源
- Rollout Amazon Ads API Essential Guide: https://rollout.com/integration-guides/amazon-advertising/api-essentials
- Amazon Advertising API官方文档

## Product Advertising API 5.0 频率限制

### 初始限制（前30天）
- **TPS (每秒请求数)**: 最大 1 请求/秒
- **TPD (每日请求数)**: 最大 8,640 请求/天

### 基于收入的调整限制（30天后）
- 每 $0.05 发货收入 = 1 TPD
- 每 $4,320 发货收入 = 1 TPS（最大 10 TPS）
- 基于前30天的收入计算

### 关键术语
- **TPS**: Transactions Per Second - 每秒最大API调用数
- **TPD**: Transactions Per Day - 每日最大API调用数

### 错误处理
- 超出限制返回 **429 TooManyRequests** 错误
- 连续30天无销售可能导致API访问权限丢失

## Amazon Advertising API (Sponsored Products/Brands/Display)

### 已知限制
- Data Provider API: 100 TPS
- 同步CRUD操作: P99保证30秒响应
- 批量操作: 每次最多100个项目

## 对系统设计的影响

### 保守估算（基于初始限制）
- 1 TPS = 每秒1个请求
- 8,640 TPD = 每天8,640个请求
- 平均每小时 = 360 个请求
- 平均每2小时 = 720 个请求

### 建议的系统频率配置
考虑到需要为多个广告活动服务，建议：

1. **位置倾斜调整**: 每2小时最多1次/广告活动
2. **出价调整**: 每24小时最多1次/投放词
3. **预算调整**: 每24小时最多1次/广告活动
4. **数据同步**: 每小时1次（批量获取）

### API调用预算分配（每天8,640次）
- 数据同步（报告获取）: 4,000次/天
- 出价调整: 2,000次/天
- 位置倾斜调整: 1,000次/天
- 预算调整: 500次/天
- 其他操作: 1,140次/天（缓冲）

