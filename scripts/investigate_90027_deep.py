#!/usr/bin/env python3
"""
账户90027深度排查 — 第二轮：同步异常模式分析
"""
import pymysql
import os
from datetime import datetime, timedelta

def get_conn():
    return pymysql.connect(
        host=os.environ.get('DATABASE_HOST', 'localhost'),
        user=os.environ.get('DATABASE_USER', 'admin'),
        password=os.environ.get('DATABASE_PASSWORD', ''),
        database=os.environ.get('DATABASE_NAME', 'amazon_ads_optimizer'),
        charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=30, read_timeout=120,
    )

def safe(v, default='N/A'):
    return default if v is None else v

def main():
    conn = get_conn()
    cur = conn.cursor()
    now = datetime.utcnow()

    print("=" * 100)
    print(f"账户90027 深度排查 — 第二轮：同步异常模式分析")
    print(f"排查时间: {now.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print("=" * 100)

    # ===== 1. 绩效数据的异常模式 =====
    print("\n【1】绩效数据异常模式分析")
    print("-" * 80)
    print("  问题: 绩效数据从2026-01-16开始，但预期应从2025-12-06开始（90天前）")
    print("  2026-01-16 是什么日子？")
    
    # 检查账户90027的绩效数据在2月16-20日的异常（展示=0）
    cur.execute("""
        SELECT date, COUNT(*) as rows_count,
               SUM(impressions) as imp, SUM(clicks) as clk,
               ROUND(SUM(spend), 2) as spend
        FROM daily_performance WHERE accountId = 90027
        AND date BETWEEN '2026-02-14' AND '2026-02-24'
        GROUP BY date ORDER BY date
    """)
    print("\n  2月14-24日数据详情（异常区间）:")
    for r in cur.fetchall():
        flag = '⚠️' if r['imp'] == 0 else ''
        print(f"    {r['date']}: {r['rows_count']}行, 展示={safe(r['imp'])}, "
              f"点击={safe(r['clk'])}, 花费=${safe(r['spend'])} {flag}")

    # ===== 2. 绩效数据最新日期为什么是3月3日而不是3月5日？ =====
    print("\n【2】绩效数据最新日期分析")
    print("-" * 80)
    print("  账户90027最新绩效日期: 2026-03-03")
    print("  账户90021/90023最新绩效日期: 2026-03-06")
    print("  差距: 3天 — 可能是同步被跳过或失败")
    
    # 检查各账户最新绩效日期
    cur.execute("""
        SELECT accountId, MAX(date) as latest, MAX(updatedAt) as last_update
        FROM daily_performance
        GROUP BY accountId
    """)
    for r in cur.fetchall():
        print(f"    账户{r['accountId']}: 最新日期={r['latest']}, 最后更新={r['last_update']}")

    # ===== 3. 搜索词数据的异常 =====
    print("\n【3】搜索词数据异常分析")
    print("-" * 80)
    cur.execute("""
        SELECT accountId, reportStartDate, reportEndDate, 
               COUNT(*) as cnt, MIN(createdAt) as first_created, MAX(updatedAt) as last_updated
        FROM search_terms
        GROUP BY accountId, reportStartDate, reportEndDate
        ORDER BY accountId, reportStartDate
    """)
    print("  所有账户的搜索词报告批次:")
    for r in cur.fetchall():
        print(f"    账户{r['accountId']}: {r['reportStartDate']} ~ {r['reportEndDate']}, "
              f"{r['cnt']}行, 创建={r['first_created']}, 更新={r['last_updated']}")

    # ===== 4. 检查90027的API凭证同步状态历史 =====
    print("\n【4】API凭证同步状态")
    print("-" * 80)
    cur.execute("""
        SELECT id, profileId, syncStatus, syncErrorMessage, lastSyncAt, updatedAt
        FROM amazon_api_credentials WHERE profileId = '137803823816878'
    """)
    cred = cur.fetchone()
    if cred:
        print(f"  凭证ID: {cred['id']}")
        print(f"  同步状态: {safe(cred['syncStatus'])}")
        print(f"  同步错误: {safe(cred['syncErrorMessage'])}")
        print(f"  最后同步: {safe(cred['lastSyncAt'])}")
        print(f"  最后更新: {safe(cred['updatedAt'])}")

    # 对比其他凭证
    print("\n  所有凭证的同步状态对比:")
    cur.execute("""
        SELECT id, profileId, syncStatus, syncErrorMessage, lastSyncAt
        FROM amazon_api_credentials ORDER BY id
    """)
    for c in cur.fetchall():
        print(f"    凭证{c['id']}: profile={safe(c['profileId'])}, "
              f"状态={safe(c['syncStatus'])}, 错误={safe(c['syncErrorMessage'])}, "
              f"最后同步={safe(c['lastSyncAt'])}")

    # ===== 5. bid_decrease持续失败的根因 =====
    print("\n【5】bid_decrease持续失败的详细分析")
    print("-" * 80)
    cur.execute("""
        SELECT campaign_id, campaign_name, previous_bid, new_bid,
               api_sync_status, api_sync_detail,
               LEFT(change_reason, 200) as reason,
               LEFT(error_message, 300) as err,
               created_at
        FROM optimization_events 
        WHERE account_id = 90027 AND action_type = 'bid_decrease' AND status = 'failed'
        ORDER BY created_at DESC LIMIT 5
    """)
    fails = cur.fetchall()
    for f in fails:
        print(f"  [{f['created_at']}]")
        print(f"    广告活动: {safe(f['campaign_name'])} (ID:{safe(f['campaign_id'])})")
        print(f"    竞价: {safe(f['previous_bid'])} → {safe(f['new_bid'])}")
        print(f"    API状态: {safe(f['api_sync_status'])}")
        print(f"    API详情: {safe(f['api_sync_detail'])}")
        print(f"    原因: {safe(f['reason'])}")
        print(f"    错误: {safe(f['err'])}")

    # ===== 6. 检查90027的广告活动状态分布 =====
    print("\n【6】账户90027广告活动状态分布")
    print("-" * 80)
    cur.execute("""
        SELECT campaignStatus, state, campaignType, COUNT(*) as cnt
        FROM campaigns WHERE accountId = 90027
        GROUP BY campaignStatus, state, campaignType
        ORDER BY cnt DESC
    """)
    for r in cur.fetchall():
        print(f"    {safe(r['campaignType'])} | 状态={safe(r['campaignStatus'])}/{safe(r['state'])} | 数量={r['cnt']}")

    # ===== 7. 检查90027是否在unifiedSyncEngine的同步范围内 =====
    print("\n【7】检查90027是否被同步引擎覆盖")
    print("-" * 80)
    # 通过检查各凭证关联的账户来判断
    cur.execute("""
        SELECT a.id as acct_id, a.accountName, a.profileId as acct_profile,
               c.id as cred_id, c.profileId as cred_profile, c.syncStatus
        FROM ad_accounts a
        LEFT JOIN amazon_api_credentials c ON a.profileId = c.profileId
        WHERE a.id IN (90021, 90023, 90027)
    """)
    for r in cur.fetchall():
        matched = '✅' if r['cred_id'] else '❌ 无匹配凭证'
        print(f"    账户{r['acct_id']} ({safe(r['accountName'])}): "
              f"profileId={safe(r['acct_profile'])}, "
              f"凭证ID={safe(r['cred_id'])}, 凭证profile={safe(r['cred_profile'])}, "
              f"同步状态={safe(r['syncStatus'])} {matched}")

    # ===== 8. 检查90027的store关联 =====
    print("\n【8】店铺关联检查")
    print("-" * 80)
    cur.execute("SHOW TABLES LIKE '%%store%%'")
    store_tables = cur.fetchall()
    print(f"  store相关表: {[list(t.values())[0] for t in store_tables]}")
    
    cur.execute("""
        SELECT id, store_id, accountName, marketplace
        FROM ad_accounts WHERE id IN (90021, 90023, 90027)
    """)
    for r in cur.fetchall():
        print(f"    账户{r['id']}: store_id={safe(r['store_id'])}, "
              f"名称={safe(r['accountName'])}, 站点={safe(r['marketplace'])}")

    # ===== 9. 检查90027的绩效数据updatedAt分布 =====
    print("\n【9】绩效数据updatedAt分布（判断同步批次）")
    print("-" * 80)
    cur.execute("""
        SELECT DATE(updatedAt) as update_date, 
               COUNT(*) as rows_updated,
               MIN(date) as earliest_perf_date,
               MAX(date) as latest_perf_date
        FROM daily_performance WHERE accountId = 90027
        GROUP BY DATE(updatedAt)
        ORDER BY update_date
    """)
    for r in cur.fetchall():
        print(f"    更新日期{r['update_date']}: {r['rows_updated']}行, "
              f"绩效日期范围={r['earliest_perf_date']}~{r['latest_perf_date']}")

    # 对比90023
    print("\n  对比账户90023:")
    cur.execute("""
        SELECT DATE(updatedAt) as update_date, 
               COUNT(*) as rows_updated,
               MIN(date) as earliest_perf_date,
               MAX(date) as latest_perf_date
        FROM daily_performance WHERE accountId = 90023
        GROUP BY DATE(updatedAt)
        ORDER BY update_date
    """)
    for r in cur.fetchall():
        print(f"    更新日期{r['update_date']}: {r['rows_updated']}行, "
              f"绩效日期范围={r['earliest_perf_date']}~{r['latest_perf_date']}")

    # ===== 10. 检查90027的冷启动事件 =====
    print("\n【10】V339冷启动事件")
    print("-" * 80)
    cur.execute("""
        SELECT action_type, status, LEFT(change_reason, 300) as reason, created_at
        FROM optimization_events
        WHERE account_id = 90027 AND change_reason LIKE '%%冷启动%%'
        ORDER BY created_at DESC LIMIT 10
    """)
    cold = cur.fetchall()
    if cold:
        for c in cold:
            print(f"  [{c['created_at']}] {safe(c['action_type'])} | {safe(c['status'])} | {safe(c['reason'])}")
    else:
        print("  ⚠️ 无冷启动事件")

    cur.close()
    conn.close()

if __name__ == '__main__':
    main()
