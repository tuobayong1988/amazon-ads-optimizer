# 端到端排查关键发现

## 日期: 2026-03-19

## 1. 数据同步链路 ✅ 正常工作
- sync-health显示：最近同步全部completed，accountId=90023同步了2893条记录
- 24小时内：completed=126次, failed=6次
- 数据新鲜度：campaigns=2026-03-19 06:46:43

## 2. 优化引擎 ⚠️ 部分工作
- bid_adjustment事件存在，api_sync_status=synced
- 但实际API同步失败率极高：
  - 06:46:59: 成功=10, 失败=19, 成功率=34.5%
  - 06:46:10: 成功=14, 失败=19, 成功率=42.4%
  - 05:52:01: 成功=5, 失败=62, 成功率=7.5%

## 3. API同步失败的根本原因 🔴 关键问题
**entityNotFoundError** - Amazon API返回"Could not find keyword with id: xxx"
- 本地数据库中存储的keywordId在Amazon端不存在
- 这意味着本地数据库中的关键词ID与Amazon实际数据不同步
- 可能原因：
  a) 关键词已在Amazon端被删除，但本地数据库未同步删除
  b) 数据同步时ID映射错误
  c) 关键词在Amazon端被归档/合并

## 4. OptSyncEngine同步失败 🔴 关键问题
- keyword_status失败: keywordId=408441954152526 反复失败
- SP关键词出价批量同步: 发送=50, 成功=0, 失败=50
- 重试同步: 总计=100, 成功=0, 失败=100

## 5. 数据库表缺失 🔴 关键问题
- system_alerts表不存在：告警写入失败
- audit_logs表写入失败
- RLS视图创建失败

## 6. product_target缺少Amazon ID 🔴 关键问题
- "product_target 47969: 缺少Amazon ID（可重试）"
- 本地product_target没有对应的Amazon ID

## 7. 绩效报告超时 ⚠️ 
- SP/SB/SD绩效报告全部超时（325秒后超时）

## 8. campaign_action事件为0 ⚠️
- 没有campaign启用/暂停的事件记录
- 用户说启用了广告活动，但没有记录

## 需要修复的问题清单：
1. 清理本地数据库中已在Amazon端不存在的过期关键词ID
2. 创建缺失的数据库表（system_alerts, audit_logs结构修复）
3. 修复RLS视图创建
4. 修复product_target的Amazon ID映射
5. 增加API同步前的实体存在性验证
6. 修复绩效报告超时问题
7. 确保campaign启用/暂停操作记录optimization_events
