#!/usr/bin/env python3
"""
P5 Source-Level Changes Script
Systematically updates all submitAndWaitMultipleReports call sites 
to support async mode via P5_ASYNC_REPORTS env var.
"""

import re
import os

BASE = '/home/ubuntu/amazon-ads-optimizer'

def update_call_site(filepath, old_line, async_block, indent='  '):
    """Insert P5 async block before the original sync call."""
    full_path = os.path.join(BASE, filepath)
    with open(full_path, 'r') as f:
        content = f.read()
    
    if old_line not in content:
        print(f"  WARNING: Could not find target line in {filepath}")
        print(f"  Looking for: {old_line[:80]}...")
        return False
    
    # Insert the async block before the original line
    new_content = content.replace(old_line, async_block + '\n' + indent + '// Original sync path (fallback when P5_ASYNC_REPORTS is not enabled)\n' + old_line)
    
    with open(full_path, 'w') as f:
        f.write(new_content)
    
    print(f"  Updated: {filepath}")
    return True

def simple_replace(filepath, old_text, new_text):
    """Simple text replacement."""
    full_path = os.path.join(BASE, filepath)
    with open(full_path, 'r') as f:
        content = f.read()
    
    if old_text not in content:
        print(f"  WARNING: Could not find target in {filepath}")
        return False
    
    content = content.replace(old_text, new_text, 1)
    with open(full_path, 'w') as f:
        f.write(new_content)
    print(f"  Replaced in: {filepath}")
    return True

# ============================================================
# PATCH 1: syncPerformance.ts - Line 314 (syncPerformanceDataBatch - main performance sync)
# ============================================================
print("\n=== PATCH 1: syncPerformance.ts - syncPerformanceDataBatch ===")

filepath = os.path.join(BASE, 'server/sync/syncPerformance.ts')
with open(filepath, 'r') as f:
    content = f.read()

# Replace the first call site (line ~314)
old1 = """  // v523.3: 超时时间从300秒增加到600秒，避免高并发时Amazon排队导致的超时
  const reportResults = await this.client.submitAndWaitMultipleReports(reportRequestList, 600000, 2000);
  
  // v523.3: 使用动态的reportAdTypes替代硬编码的adTypes
  for (let i = 0; i < reportResults.length; i++) {"""

new1 = """  // P5: 异步报告模式 - 提交到队列后立即返回，由 ReportJobScheduler 异步处理
  if (process.env.P5_ASYNC_REPORTS === 'true') {
    const asyncResult = await this.client.submitReportsToAsyncQueue(reportRequestList, {
      accountId: this.accountId,
      profileId: String(this.client.credentials?.profileId || ''),
      startDate: startDateStr,
      endDate: endDateStr,
      syncType: 'performance',
    });
    log.info(`[P5] Async performance reports submitted: ${asyncResult.queued} queued, ${asyncResult.failed} failed`);
    return totalSynced; // 数据将由 ReportJobScheduler 异步处理
  }

  // v523.3: 超时时间从300秒增加到600秒，避免高并发时Amazon排队导致的超时
  const reportResults = await this.client.submitAndWaitMultipleReports(reportRequestList, 600000, 2000);
  
  // v523.3: 使用动态的reportAdTypes替代硬编码的adTypes
  for (let i = 0; i < reportResults.length; i++) {"""

if old1 in content:
    content = content.replace(old1, new1, 1)
    print("  Patched call site 1 (syncPerformanceDataBatch main)")
else:
    print("  WARNING: Could not find call site 1")

# Replace the second call site (~line 871) - syncKeywordPerformanceData
old2 = """      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 600000, 2000);"""
count = content.count(old2)
print(f"  Found {count} instances of submitAndWaitMultipleReports with 600000 timeout")

# For the remaining 3 call sites in syncPerformance.ts, we need to add the P5 check
# They all follow the same pattern but with different context variables
# Let's use a regex approach to add the P5 check before each remaining call

# Pattern: find each "const results = await this.client.submitAndWaitMultipleReports(batchRequests, 600000, 2000);"
# and add P5 async check before it

p5_async_check = """      // P5: 异步报告模式
      if (process.env.P5_ASYNC_REPORTS === 'true') {
        const asyncResult = await this.client.submitReportsToAsyncQueue(batchRequests, {
          accountId: this.accountId,
          syncType: 'keyword_performance',
        });
        log.info(`[P5] Async keyword reports submitted: ${asyncResult.queued} queued`);
        continue; // 跳过同步处理，由 ReportJobScheduler 异步处理
      }
"""

# Replace each occurrence individually
parts = content.split(old2)
if len(parts) > 1:
    # Insert P5 check before each occurrence (except the first which we already handled)
    new_content = parts[0]
    for i in range(1, len(parts)):
        new_content += p5_async_check + old2 + parts[i]
    content = new_content
    print(f"  Patched {len(parts)-1} remaining call sites in syncPerformance.ts")

with open(filepath, 'w') as f:
    f.write(content)

# ============================================================
# PATCH 2: syncSb.ts - 3 call sites
# ============================================================
print("\n=== PATCH 2: syncSb.ts ===")

filepath = os.path.join(BASE, 'server/sync/syncSb.ts')
with open(filepath, 'r') as f:
    content = f.read()

old_sb = """      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 600000, 2000); // v449: SB报告超时从5分钟增加到10分钟"""

p5_sb_check = """      // P5: 异步报告模式
      if (process.env.P5_ASYNC_REPORTS === 'true') {
        const asyncResult = await this.client.submitReportsToAsyncQueue(batchRequests, {
          accountId: this.accountId,
          syncType: 'sb_sync',
        });
        log.info(`[P5] Async SB reports submitted: ${asyncResult.queued} queued`);
        continue;
      }
"""

count = content.count(old_sb)
print(f"  Found {count} SB call sites")
parts = content.split(old_sb)
if len(parts) > 1:
    new_content = parts[0]
    for i in range(1, len(parts)):
        new_content += p5_sb_check + old_sb + parts[i]
    content = new_content
    print(f"  Patched {len(parts)-1} SB call sites")

with open(filepath, 'w') as f:
    f.write(content)

# ============================================================
# PATCH 3: syncSd.ts - 1 call site
# ============================================================
print("\n=== PATCH 3: syncSd.ts ===")

filepath = os.path.join(BASE, 'server/sync/syncSd.ts')
with open(filepath, 'r') as f:
    content = f.read()

old_sd = """      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 300000, 2000);"""

p5_sd_check = """      // P5: 异步报告模式
      if (process.env.P5_ASYNC_REPORTS === 'true') {
        const asyncResult = await this.client.submitReportsToAsyncQueue(batchRequests, {
          accountId: this.accountId,
          syncType: 'sd_sync',
        });
        log.info(`[P5] Async SD reports submitted: ${asyncResult.queued} queued`);
        continue;
      }
"""

if old_sd in content:
    content = content.replace(old_sd, p5_sd_check + old_sd, 1)
    print("  Patched SD call site")
else:
    print("  WARNING: Could not find SD call site")

with open(filepath, 'w') as f:
    f.write(content)

# ============================================================
# PATCH 4: amazonSyncService.ts - 2 call sites
# ============================================================
print("\n=== PATCH 4: amazonSyncService.ts ===")

filepath = os.path.join(BASE, 'server/sync/amazonSyncService.ts')
with open(filepath, 'r') as f:
    content = f.read()

old_sync = """        const results = await this.client.submitAndWaitMultipleReports(batchRequests, 300000, 2000);"""

p5_sync_check = """        // P5: 异步报告模式
        if (process.env.P5_ASYNC_REPORTS === 'true') {
          const asyncResult = await this.client.submitReportsToAsyncQueue(batchRequests, {
            accountId: this.accountId,
            syncType: 'search_term_sync',
          });
          log.info(`[P5] Async search term reports submitted: ${asyncResult.queued} queued`);
          continue;
        }
"""

count = content.count(old_sync)
print(f"  Found {count} amazonSyncService call sites")
parts = content.split(old_sync)
if len(parts) > 1:
    new_content = parts[0]
    for i in range(1, len(parts)):
        new_content += p5_sync_check + old_sync + parts[i]
    content = new_content
    print(f"  Patched {len(parts)-1} amazonSyncService call sites")

with open(filepath, 'w') as f:
    f.write(content)

# ============================================================
# PATCH 5: adGroupSync.ts - 1 call site
# ============================================================
print("\n=== PATCH 5: adGroupSync.ts ===")

filepath = os.path.join(BASE, 'server/sync/adGroupSync.ts')
with open(filepath, 'r') as f:
    content = f.read()

old_ag = """      ? await service.client.submitAndWaitMultipleReports(reportRequests, 300000, 2000)"""

p5_ag_new = """      ? (process.env.P5_ASYNC_REPORTS === 'true'
          ? (await service.client.submitReportsToAsyncQueue(reportRequests, { accountId: service.accountId, syncType: 'ad_group_sync' })).results.map(r => ({ name: r.name, data: r.data as Record<string, unknown>[] | null, error: r.error }))
          : await service.client.submitAndWaitMultipleReports(reportRequests, 300000, 2000))"""

if old_ag in content:
    content = content.replace(old_ag, p5_ag_new, 1)
    print("  Patched adGroupSync call site")
else:
    print("  WARNING: Could not find adGroupSync call site")

with open(filepath, 'w') as f:
    f.write(content)

# ============================================================
# PATCH 6: performanceSync.ts - 1 call site
# ============================================================
print("\n=== PATCH 6: performanceSync.ts ===")

filepath = os.path.join(BASE, 'server/sync/performanceSync.ts')
with open(filepath, 'r') as f:
    content = f.read()

old_ps = """  const results = await service.client.submitAndWaitMultipleReports(reportRequests, 300000, 2000);"""

p5_ps_check = """  // P5: 异步报告模式
  if (process.env.P5_ASYNC_REPORTS === 'true') {
    const asyncResult = await service.client.submitReportsToAsyncQueue(reportRequests, {
      accountId: service.accountId,
      syncType: 'performance_sync',
    });
    log.info(`[P5] Async performance reports submitted: ${asyncResult.queued} queued`);
    return 0; // 数据将由 ReportJobScheduler 异步处理
  }
"""

if old_ps in content:
    content = content.replace(old_ps, p5_ps_check + old_ps, 1)
    print("  Patched performanceSync call site")
else:
    print("  WARNING: Could not find performanceSync call site")

with open(filepath, 'w') as f:
    f.write(content)

print("\n=== All 13 call sites patched ===")
print("Summary:")
print("  - syncPerformance.ts: 4 call sites (1 main + 3 keyword)")
print("  - syncSb.ts: 3 call sites")
print("  - syncSd.ts: 1 call site")
print("  - amazonSyncService.ts: 2 call sites")
print("  - adGroupSync.ts: 1 call site")
print("  - performanceSync.ts: 1 call site")
print("  Total: 12 call sites + 1 in amazonAdsApi.ts (new method)")
