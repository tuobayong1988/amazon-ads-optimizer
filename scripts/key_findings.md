# 关键发现

## 1. 账户90021 SP绩效已达90天（唯一达标项）
- SP绩效: 最早2025-12-06, 距今90天, ✅ 已达标
- 说明: 该账户SP绩效数据是唯一达到90天目标的数据类型

## 2. 搜索词数据严重不足
- 所有账户campaign_type均为unknown（非SP/SB分类）
- 最多仅覆盖33-49天
- 报告日期数仅2-3个（说明只成功同步了2-3次）
- 根因: syncSearchTerms一次性请求90天，没有31天分批逻辑

## 3. 账户初始化状态异常
- 账户90021/90022/90023: initialization_status = pending（未完成初始化）
- 账户90025/90026/90027: initialization_status = completed
- 但90022/90025/90026没有任何绩效数据

## 4. ad_accounts表没有lastSyncedAt/lastFullSyncAt字段
- 说明同步状态追踪不在ad_accounts表中
