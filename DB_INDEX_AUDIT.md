# Database Index Audit Results

## Summary
- Total tables: 157
- Total existing indexes: 262
- Tables WITHOUT any indexes: 60
- Critical tables needing indexes: 20+

## HIGH-PRIORITY: Tables Without Indexes (High-Traffic)

### Tier 1 - Critical (Queried in every sync/optimization cycle)

| Table | Key Query Columns | Query Frequency |
|-------|-------------------|-----------------|
| data_sync_jobs | accountId(7), status(7), userId(3) | Every sync operation |
| data_sync_logs | jobId(2) | Every sync operation |
| hourly_performance | campaignId(5), accountId(2) | Every optimization cycle |
| placement_performance | accountId(10), campaignId(9), placement(2), date(2) | Every optimization cycle |
| bid_performance_history | accountId(4), bidObjectId(3), bidObjectType(2) | Every bid analysis |
| bidding_logs | accountId(4), campaignId(1) | Every bid adjustment |
| performance_groups | status(4), accountId(3) | Every optimization cycle |
| budget_history | userId(1), accountId(1), campaignId(1) | Budget operations |

### Tier 2 - Important (Queried in API/UI operations)

| Table | Key Query Columns | Query Frequency |
|-------|-------------------|-----------------|
| audit_logs | accountId(5), userId(4), actionType(1) | Every user action |
| api_call_logs | userId, accountId, apiType, createdAt | API monitoring |
| api_operation_logs | userId, accountId, operationType, status | API operations |
| api_request_queue | userId, accountId, status, priority | API queue |
| optimization_recommendations | accountId(1), status(1) | UI dashboard |
| notification_history | userId(1) | User notifications |
| task_execution_log | taskId(1) | Task tracking |
| batch_operations | userId(1) | Batch operations |
| batch_operation_items | batchId(1) | Batch item tracking |
| dayparting_strategies | accountId(1), campaignId(1) | Dayparting |
| auto_pause_records | userId(1), accountId(1) | Auto-pause tracking |

### Tier 3 - Existing Tables Missing Key Indexes

| Table | Missing Index Column | Query Count |
|-------|---------------------|-------------|
| ad_groups | adGroupId | 21 queries |
| keywords | keywordStatus | 11 queries |
| negative_keywords | negativeText, negativeLevel, negativeType, internalAdGroupId | 10+6+9+4 queries |
| product_targets | internalAdGroupId, targetStatus | 17+4 queries |
