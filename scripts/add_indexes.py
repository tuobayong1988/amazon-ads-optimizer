#!/usr/bin/env python3
"""
Batch add missing indexes to schema.ts for all critical tables.
This script modifies the Drizzle ORM schema to add performance-critical indexes.
"""

import re

SCHEMA_PATH = '/home/ubuntu/amazon-ads-optimizer/drizzle/schema.ts'

# Define indexes for each table that needs them
# Key: table SQL name
# Value: list of index definitions as strings
INDEX_DEFINITIONS = {
    'api_call_logs': [
        "index('idx_acl_accountId').on(table.accountId)",
        "index('idx_acl_userId').on(table.userId)",
        "index('idx_acl_apiType').on(table.apiType)",
        "index('idx_acl_createdAt').on(table.createdAt)",
        "index('idx_acl_statusCode').on(table.statusCode)",
    ],
    'api_operation_logs': [
        "index('idx_aol_accountId').on(table.accountId)",
        "index('idx_aol_userId').on(table.userId)",
        "index('idx_aol_operationType').on(table.operationType)",
        "index('idx_aol_status').on(table.status)",
        "index('idx_aol_createdAt').on(table.createdAt)",
    ],
    'api_request_queue': [
        "index('idx_arq_accountId').on(table.accountId)",
        "index('idx_arq_status').on(table.status)",
        "index('idx_arq_priority_status').on(table.priority, table.status)",
        "index('idx_arq_scheduledAt').on(table.scheduledAt)",
    ],
    'audit_logs': [
        "index('idx_al_accountId').on(table.accountId)",
        "index('idx_al_userId').on(table.userId)",
        "index('idx_al_actionType').on(table.actionType)",
        "index('idx_al_createdAt').on(table.createdAt)",
        "index('idx_al_account_action').on(table.accountId, table.actionType)",
    ],
    'auto_pause_records': [
        "index('idx_apr_accountId').on(table.accountId)",
        "index('idx_apr_userId').on(table.userId)",
        "index('idx_apr_pausedAt').on(table.pausedAt)",
    ],
    'batch_operation_items': [
        "index('idx_boi_batchId').on(table.batchId)",
        "index('idx_boi_itemStatus').on(table.itemStatus)",
    ],
    'batch_operations': [
        "index('idx_bo_userId').on(table.userId)",
        "index('idx_bo_accountId').on(table.accountId)",
        "index('idx_bo_batchStatus').on(table.batchStatus)",
        "index('idx_bo_createdAt').on(table.createdAt)",
    ],
    'bid_performance_history': [
        "index('idx_bph_accountId').on(table.accountId)",
        "index('idx_bph_bidObjectId').on(table.bidObjectId)",
        "index('idx_bph_account_object').on(table.accountId, table.bidObjectType, table.bidObjectId)",
        "index('idx_bph_campaignId').on(table.campaignId)",
        "index('idx_bph_createdAt').on(table.createdAt)",
    ],
    'bidding_logs': [
        "index('idx_bl_accountId').on(table.accountId)",
        "index('idx_bl_campaignId').on(table.campaignId)",
        "index('idx_bl_targetId').on(table.targetId)",
        "index('idx_bl_createdAt').on(table.createdAt)",
        "index('idx_bl_actionType').on(table.actionType)",
    ],
    'budget_history': [
        "index('idx_bh_accountId').on(table.accountId)",
        "index('idx_bh_userId').on(table.userId)",
        "index('idx_bh_campaignId').on(table.campaignId)",
        "index('idx_bh_createdAt').on(table.createdAt)",
    ],
    'dayparting_strategies': [
        "index('idx_ds_accountId').on(table.accountId)",
        "index('idx_ds_campaignId').on(table.campaignId)",
        "index('idx_ds_account_campaign').on(table.accountId, table.campaignId)",
    ],
    'notification_history': [
        "index('idx_nh_userId').on(table.userId)",
        "index('idx_nh_accountId').on(table.accountId)",
        "index('idx_nh_status').on(table.status)",
        "index('idx_nh_createdAt').on(table.createdAt)",
    ],
    'optimization_recommendations': [
        "index('idx_or_accountId').on(table.accountId)",
        "index('idx_or_campaignId').on(table.campaignId)",
        "index('idx_or_status').on(table.status)",
        "index('idx_or_priority').on(table.priority)",
        "index('idx_or_account_status').on(table.accountId, table.status)",
    ],
    'performance_groups': [
        "index('idx_pg_accountId').on(table.accountId)",
        "index('idx_pg_userId').on(table.userId)",
        "index('idx_pg_status').on(table.status)",
        "index('idx_pg_account_status').on(table.accountId, table.status)",
    ],
    'task_execution_log': [
        "index('idx_tel_accountId').on(table.accountId)",
        "index('idx_tel_userId').on(table.userId)",
        "index('idx_tel_taskType').on(table.taskType)",
        "index('idx_tel_status').on(table.status)",
        "index('idx_tel_createdAt').on(table.createdAt)",
    ],
}

# Additional indexes for hourly_performance and placement_performance (they have unique constraints but no regular indexes)
ADDITIONAL_INDEXES = {
    'hourly_performance': [
        "index('idx_hp_accountId').on(table.accountId)",
        "index('idx_hp_campaignId').on(table.campaignId)",
        "index('idx_hp_date').on(table.date)",
        "index('idx_hp_account_campaign').on(table.accountId, table.campaignId)",
    ],
    'placement_performance': [
        "index('idx_pp_accountId').on(table.accountId)",
        "index('idx_pp_campaignId').on(table.campaignId)",
        "index('idx_pp_date').on(table.date)",
        "index('idx_pp_account_campaign').on(table.accountId, table.campaignId)",
    ],
}

# Missing indexes for existing indexed tables
MISSING_INDEXES = {
    'ad_groups': [
        "index('idx_adGroups_adGroupId').on(table.adGroupId)",
    ],
    'keywords': [
        "index('idx_keywords_keywordStatus').on(table.keywordStatus)",
    ],
    'negative_keywords': [
        "index('idx_negKw_internalAdGroupId').on(table.internalAdGroupId)",
        "index('idx_negKw_negativeLevel').on(table.negativeLevel)",
    ],
    'product_targets': [
        "index('idx_prodTargets_internalAdGroupId').on(table.internalAdGroupId)",
        "index('idx_prodTargets_targetStatus').on(table.targetStatus)",
    ],
}


def add_indexes_to_table(content, table_name, indexes):
    """Add indexes to a table that currently has no indexes (ends with });)"""
    # Find the table definition
    marker = f'mysqlTable("{table_name}"'
    start = content.find(marker)
    if start == -1:
        print(f"  WARNING: Table {table_name} not found")
        return content
    
    # Find the closing }); for this table
    # We need to find the correct }); that closes this table
    search_start = start
    end = content.find('});', search_start)
    while end != -1:
        # Check if this }); is inside the table definition
        block = content[start:end+3]
        if '(table) =>' not in block:
            # This table has no indexes, add them
            index_lines = ',\n\t'.join(indexes)
            replacement = f'}},\n(table) => ([\n\t{index_lines},\n]));'
            content = content[:end] + replacement + content[end+3:]
            print(f"  ADDED {len(indexes)} indexes to {table_name}")
            return content
        else:
            print(f"  SKIP {table_name} - already has indexes")
            return content
    
    print(f"  WARNING: Could not find closing for {table_name}")
    return content


def add_indexes_to_existing_table(content, table_name, new_indexes):
    """Add additional indexes to a table that already has indexes"""
    marker = f'mysqlTable("{table_name}"'
    start = content.find(marker)
    if start == -1:
        print(f"  WARNING: Table {table_name} not found")
        return content
    
    # Find the index block - look for ])); or }));
    # Try ]));
    search_from = start
    for closing in [']));', '}));']:
        end = content.find(closing, search_from)
        if end != -1 and end < start + 10000:
            # Verify this closing belongs to our table
            block = content[start:end]
            if '(table) =>' in block:
                index_lines = ',\n\t'.join(new_indexes)
                content = content[:end] + f'\t{index_lines},\n{closing[0]}' + content[end:]
                print(f"  ADDED {len(new_indexes)} indexes to existing {table_name}")
                return content
    
    print(f"  WARNING: Could not find index block for {table_name}")
    return content


def main():
    with open(SCHEMA_PATH, 'r') as f:
        content = f.read()
    
    original_len = len(content)
    
    print("=== Adding indexes to tables without indexes ===")
    for table_name, indexes in INDEX_DEFINITIONS.items():
        content = add_indexes_to_table(content, table_name, indexes)
    
    print("\n=== Adding indexes to tables with unique constraints ===")
    for table_name, indexes in ADDITIONAL_INDEXES.items():
        content = add_indexes_to_existing_table(content, table_name, indexes)
    
    print("\n=== Adding missing indexes to existing indexed tables ===")
    for table_name, indexes in MISSING_INDEXES.items():
        content = add_indexes_to_existing_table(content, table_name, indexes)
    
    with open(SCHEMA_PATH, 'w') as f:
        f.write(content)
    
    print(f"\nDone! Schema size: {original_len} -> {len(content)} bytes")


if __name__ == '__main__':
    main()
