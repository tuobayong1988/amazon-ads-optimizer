#!/usr/bin/env python3
"""
v679.3 Patch Script
Updates 7 sub-functions in optimizationAutoCorrector.ts:
1. Add `guard?: AutoOptimizeGuard | null` parameter to function signatures
2. Replace __v679_disabled_campaign_ids pattern with Guard API calls
"""

import re

filepath = '/tmp/ads-opt/server/optimization/optimizationAutoCorrector.ts'

with open(filepath, 'r') as f:
    content = f.read()

# Track replacements
replacements = 0

# ============================================================
# Pattern for function signature updates (7 functions)
# ============================================================
functions_to_update = [
    'correctBidMismatches',
    'retryFailedBudgetAdjustments',
    'retryFailedSettingsChanges',
    'retryFailedKeywordCreations',
    'retryFailedNegativeKeywordAdds',
    'retryHistoricalFailedKeywordHarvests',
    'retryFailedTargetStatusChanges',
]

for func_name in functions_to_update:
    # Update function signature
    old_sig = f'async function {func_name}(database: unknown, accountId: number): Promise<CorrectionResult[]>'
    new_sig = f'async function {func_name}(database: unknown, accountId: number, guard?: AutoOptimizeGuard | null): Promise<CorrectionResult[]>'
    if old_sig in content:
        content = content.replace(old_sig, new_sig, 1)
        replacements += 1
        print(f'  [OK] Updated signature: {func_name}')
    else:
        print(f'  [SKIP] Signature already updated or not found: {func_name}')

# ============================================================
# Replace v679 filter patterns with Guard API
# ============================================================

# Pattern 1: Standard drizzle query result pattern (6 occurrences)
# These all follow the same structure with minor variable name differences
v679_patterns = [
    # correctBidMismatches (line ~1142) - uses filteredMismatches
    {
        'find': r"""    // v679: 过滤已关闭自动优化的campaigns下的事件
    // @ts-ignore v679: runtime context injection
    const disabledCids = \(database as any\)\.__v679_disabled_campaign_ids as Set<number> \| null;
    const filteredMismatches = disabledCids 
      \? mismatches\.filter\(\(e: any\) => !disabledCids\.has\(Number\(e\.campaign_id\)\)\)
      : mismatches;
    if \(filteredMismatches\.length < mismatches\.length\) \{
      log\.info\(`\[AutoCorrector\] v679: 账户\$\{accountId\} correctBidMismatches 过滤了\$\{mismatches\.length - filteredMismatches\.length\}条已关闭自动优化的事件`\);
    \}
    if \(filteredMismatches\.length === 0\) return results;""",
        'replace': """    // v679.3: 使用AutoOptimizeGuard过滤已关闭自动优化的campaigns下的事件
    const filteredMismatches = guard 
      ? mismatches.filter((e: any) => guard.isCampaignAllowed(Number(e.campaign_id)))
      : mismatches;
    if (filteredMismatches.length < mismatches.length) {
      const blockedCount = mismatches.length - filteredMismatches.length;
      log.info(`[AutoCorrector] v679.3: 账户${accountId} correctBidMismatches 过滤了${blockedCount}条已关闭自动优化的事件`);
      if (guard) {
        guard.recordBlockedOperation({
          operationType: 'correctBidMismatches',
          entityType: 'keyword',
          details: `拦截${blockedCount}条已关闭自动优化的出价纠正事件`,
        });
      }
    }
    if (filteredMismatches.length === 0) return results;""",
        'name': 'correctBidMismatches',
    },
]

# For the remaining 6 functions, use a more generic approach
# They all follow the same pattern with different variable names and function names

generic_replacements = [
    # retryFailedBudgetAdjustments
    {
        'func': 'retryFailedBudgetAdjustments',
        'var': 'filteredBudgetEvents',
        'source': 'failedEvents',
        'campaign_field': 'e.campaignId',
        'entity_type': 'campaign',
        'desc': '预算重试事件',
    },
    # retryFailedSettingsChanges
    {
        'func': 'retryFailedSettingsChanges',
        'var': 'filteredSettingsEvents',
        'source': 'failedEvents',
        'campaign_field': 'e.campaignId',
        'entity_type': 'campaign',
        'desc': '设置变更重试事件',
    },
    # retryFailedKeywordCreations
    {
        'func': 'retryFailedKeywordCreations',
        'var': 'filteredKwEvents',
        'source': 'failedEvents',
        'campaign_field': 'e.campaignId',
        'entity_type': 'keyword',
        'desc': '关键词创建重试事件',
    },
    # retryFailedNegativeKeywordAdds
    {
        'func': 'retryFailedNegativeKeywordAdds',
        'var': 'filteredNegEvents',
        'source': 'failedEvents',
        'campaign_field': 'e.campaignId',
        'entity_type': 'negative_keyword',
        'desc': '否定关键词重试事件',
    },
    # retryFailedTargetStatusChanges
    {
        'func': 'retryFailedTargetStatusChanges',
        'var': 'filteredStatusEvents',
        'source': 'failedEvents',
        'campaign_field': 'e.campaignId',
        'entity_type': 'keyword',
        'desc': '状态变更重试事件',
    },
]

for r in generic_replacements:
    # Build the old pattern (escaped for string matching, not regex)
    old_block = f"""    // v679: 过滤已关闭自动优化的campaigns下的事件
    // @ts-ignore v679: runtime context injection
    const disabledCids = (database as any).__v679_disabled_campaign_ids as Set<number> | null;
    const {r['var']} = disabledCids 
      ? {r['source']}.filter((e: any) => !disabledCids.has(Number({r['campaign_field']})))
      : {r['source']};
    if ({r['var']}.length < {r['source']}.length) {{
      log.info(`[AutoCorrector] v679: 账户${{{r.get('acc_var', 'accountId')}}} {r['func']} 过滤了${{{r['source']}.length - {r['var']}.length}}条已关闭自动优化的事件`);
    }}
    if ({r['var']}.length === 0) return results;"""
    
    new_block = f"""    // v679.3: 使用AutoOptimizeGuard过滤已关闭自动优化的campaigns下的事件
    const {r['var']} = guard 
      ? {r['source']}.filter((e: any) => guard.isCampaignAllowed(Number({r['campaign_field']})))
      : {r['source']};
    if ({r['var']}.length < {r['source']}.length) {{
      const blockedCount = {r['source']}.length - {r['var']}.length;
      log.info(`[AutoCorrector] v679.3: 账户${{accountId}} {r['func']} 过滤了${{blockedCount}}条已关闭自动优化的事件`);
      if (guard) {{
        guard.recordBlockedOperation({{
          operationType: '{r['func']}',
          entityType: '{r['entity_type']}',
          details: `拦截${{blockedCount}}条已关闭自动优化的{r['desc']}`,
        }});
      }}
    }}
    if ({r['var']}.length === 0) return results;"""
    
    if old_block in content:
        content = content.replace(old_block, new_block, 1)
        replacements += 1
        print(f'  [OK] Updated v679 filter: {r["func"]}')
    else:
        print(f'  [WARN] v679 filter pattern not found for: {r["func"]}')

# Handle correctBidMismatches separately (uses campaign_id not campaignId)
old_bid_mismatch = """    // v679: 过滤已关闭自动优化的campaigns下的事件
    // @ts-ignore v679: runtime context injection
    const disabledCids = (database as any).__v679_disabled_campaign_ids as Set<number> | null;
    const filteredMismatches = disabledCids 
      ? mismatches.filter((e: any) => !disabledCids.has(Number(e.campaign_id)))
      : mismatches;
    if (filteredMismatches.length < mismatches.length) {
      log.info(`[AutoCorrector] v679: 账户${accountId} correctBidMismatches 过滤了${mismatches.length - filteredMismatches.length}条已关闭自动优化的事件`);
    }
    if (filteredMismatches.length === 0) return results;"""

new_bid_mismatch = """    // v679.3: 使用AutoOptimizeGuard过滤已关闭自动优化的campaigns下的事件
    const filteredMismatches = guard 
      ? mismatches.filter((e: any) => guard.isCampaignAllowed(Number(e.campaign_id)))
      : mismatches;
    if (filteredMismatches.length < mismatches.length) {
      const blockedCount = mismatches.length - filteredMismatches.length;
      log.info(`[AutoCorrector] v679.3: 账户${accountId} correctBidMismatches 过滤了${blockedCount}条已关闭自动优化的事件`);
      if (guard) {
        guard.recordBlockedOperation({
          operationType: 'correctBidMismatches',
          entityType: 'keyword',
          details: `拦截${blockedCount}条已关闭自动优化的出价纠正事件`,
        });
      }
    }
    if (filteredMismatches.length === 0) return results;"""

if old_bid_mismatch in content:
    content = content.replace(old_bid_mismatch, new_bid_mismatch, 1)
    replacements += 1
    print(f'  [OK] Updated v679 filter: correctBidMismatches')
else:
    print(f'  [WARN] v679 filter pattern not found for: correctBidMismatches')

# Handle retryHistoricalFailedKeywordHarvests separately (uses raw SQL result with campaign_id)
old_harvest = """    // v679: 过滤已关闭自动优化的campaigns下的事件
    // @ts-ignore v679: runtime context injection
    const disabledCids = (database as any).__v679_disabled_campaign_ids as Set<number> | null;
    const filteredHarvestEvents = disabledCids 
      ? (events as any[]).filter((e: any) => !disabledCids.has(Number(e.campaign_id || e.campaignId)))
      : events;
    if ((filteredHarvestEvents as any[]).length < (events as any[]).length) {
      log.info(`[AutoCorrector] v679: 账户${accountId} retryHistoricalFailedKeywordHarvests 过滤了${(events as any[]).length - (filteredHarvestEvents as any[]).length}条已关闭自动优化的事件`);
    }
    if (!filteredHarvestEvents || (filteredHarvestEvents as any[]).length === 0) return results;"""

new_harvest = """    // v679.3: 使用AutoOptimizeGuard过滤已关闭自动优化的campaigns下的事件
    const filteredHarvestEvents = guard 
      ? (events as any[]).filter((e: any) => guard.isCampaignAllowed(Number(e.campaign_id || e.campaignId)))
      : events;
    if ((filteredHarvestEvents as any[]).length < (events as any[]).length) {
      const blockedCount = (events as any[]).length - (filteredHarvestEvents as any[]).length;
      log.info(`[AutoCorrector] v679.3: 账户${accountId} retryHistoricalFailedKeywordHarvests 过滤了${blockedCount}条已关闭自动优化的事件`);
      if (guard) {
        guard.recordBlockedOperation({
          operationType: 'retryHistoricalFailedKeywordHarvests',
          entityType: 'keyword',
          details: `拦截${blockedCount}条已关闭自动优化的搜索词收割重试事件`,
        });
      }
    }
    if (!filteredHarvestEvents || (filteredHarvestEvents as any[]).length === 0) return results;"""

if old_harvest in content:
    content = content.replace(old_harvest, new_harvest, 1)
    replacements += 1
    print(f'  [OK] Updated v679 filter: retryHistoricalFailedKeywordHarvests')
else:
    print(f'  [WARN] v679 filter pattern not found for: retryHistoricalFailedKeywordHarvests')


with open(filepath, 'w') as f:
    f.write(content)

print(f'\nTotal replacements: {replacements}')
print('Done!')
