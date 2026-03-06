#!/usr/bin/env python3
"""
账户90027深度排查脚本 v2 — 使用正确的列名
"""
import pymysql
from datetime import datetime, timedelta

def get_conn():
    return pymysql.connect(
        host='amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com',
        user='admin', password='Mucers2025', database='amazon_ads_optimizer',
        charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=30, read_timeout=120,
    )

def safe(v, default='N/A'):
    return default if v is None else v

def trunc(s, n=150):
    s = str(s) if s else ''
    return s[:n] + '...' if len(s) > n else s

def main():
    conn = get_conn()
    cur = conn.cursor()
    now = datetime.utcnow()

    print("=" * 100)
    print(f"账户90027 深度排查报告")
    print(f"排查时间: {now.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print("=" * 100)

    # ===== 1. 账户基础信息 =====
    print("\n【1】账户基础信息")
    print("-" * 80)
    cur.execute("""
        SELECT id, accountId, accountName, marketplace, status, connectionStatus,
               initialization_status, initialization_completed_at, 
               api_authorized_at, createdAt, updatedAt, store_id, sellerId
        FROM ad_accounts WHERE id = 90027
    """)
    a = cur.fetchone()
    if a:
        for k, v in a.items():
            print(f"  {k}: {safe(v)}")

    # ===== 2. API凭证 =====
    print("\n【2】API凭证（与profileId=137803823816878关联）")
    print("-" * 80)
    cur.execute("""
        SELECT id, profileId, region, syncStatus, syncErrorMessage, 
               lastSyncAt, createdAt, updatedAt, timezone, currency_code
        FROM amazon_api_credentials WHERE profileId = '137803823816878'
    """)
    cred = cur.fetchone()
    if cred:
        for k, v in cred.items():
            if k not in ('clientId', 'clientSecret', 'refreshToken', 'accessToken'):
                print(f"  {k}: {safe(v)}")
    else:
        print("  ⚠️ 未找到关联的API凭证！")
        # 列出所有凭证
        cur.execute("SELECT id, profileId, syncStatus, lastSyncAt FROM amazon_api_credentials")
        for c in cur.fetchall():
            print(f"    凭证{c['id']}: profileId={safe(c['profileId'])}, sync={safe(c['syncStatus'])}, lastSync={safe(c['lastSyncAt'])}")

    # ===== 3. 三个账户对比 =====
    print("\n【3】三个账户对比（90021 vs 90023 vs 90027）")
    print("-" * 80)
    for acct_id in [90021, 90023, 90027]:
        print(f"\n  === 账户{acct_id} ===")
        cur.execute("""
            SELECT id, accountName, marketplace, status, connectionStatus,
                   initialization_status, initialization_completed_at,
                   api_authorized_at, createdAt
            FROM ad_accounts WHERE id = %s
        """, (acct_id,))
        acc = cur.fetchone()
        if acc:
            print(f"    名称: {safe(acc['accountName'])}")
            print(f"    站点: {safe(acc['marketplace'])}")
            print(f"    状态: {safe(acc['status'])}, 连接: {safe(acc['connectionStatus'])}")
            print(f"    初始化: {safe(acc['initialization_status'])}, 完成于: {safe(acc['initialization_completed_at'])}")
            print(f"    API授权: {safe(acc['api_authorized_at'])}")
            print(f"    创建时间: {safe(acc['createdAt'])}")

        # 广告活动
        cur.execute("SELECT COUNT(*) as cnt FROM campaigns WHERE accountId = %s", (acct_id,))
        print(f"    广告活动数: {safe(cur.fetchone()['cnt'])}")

        # 绩效数据
        cur.execute("""
            SELECT MIN(date) as earliest, MAX(date) as latest,
                   COUNT(DISTINCT date) as dates, COUNT(*) as rows_count,
                   DATEDIFF(CURDATE(), MIN(date)) as span
            FROM daily_performance WHERE accountId = %s
        """, (acct_id,))
        dp = cur.fetchone()
        print(f"    绩效: {safe(dp['earliest'])} ~ {safe(dp['latest'])}, 跨度{safe(dp['span'])}天, {safe(dp['dates'])}个日期, {safe(dp['rows_count'])}行")

        # 搜索词
        cur.execute("""
            SELECT MIN(reportStartDate) as earliest, MAX(reportEndDate) as latest,
                   COUNT(DISTINCT reportStartDate) as batches, COUNT(*) as rows_count
            FROM search_terms WHERE accountId = %s
        """, (acct_id,))
        st = cur.fetchone()
        print(f"    搜索词: {safe(st['earliest'])} ~ {safe(st['latest'])}, {safe(st['batches'])}批, {safe(st['rows_count'])}行")

        # 广告位
        cur.execute("""
            SELECT MIN(date) as earliest, MAX(date) as latest,
                   COUNT(DISTINCT date) as dates, COUNT(*) as rows_count
            FROM placement_performance WHERE accountId = %s
        """, (acct_id,))
        pp = cur.fetchone()
        print(f"    广告位: {safe(pp['earliest'])} ~ {safe(pp['latest'])}, {safe(pp['dates'])}天, {safe(pp['rows_count'])}行")

    # ===== 4. 账户90027的绩效数据逐日分布 =====
    print("\n【4】账户90027的绩效数据逐日分布")
    print("-" * 80)
    cur.execute("""
        SELECT date, COUNT(*) as rows_count,
               SUM(impressions) as imp, SUM(clicks) as clk,
               ROUND(SUM(spend), 2) as spend, ROUND(SUM(sales), 2) as sales
        FROM daily_performance WHERE accountId = 90027
        GROUP BY date ORDER BY date
    """)
    perf_rows = cur.fetchall()
    print(f"  总日期数: {len(perf_rows)}")
    if perf_rows:
        first_date = perf_rows[0]['date']
        last_date = perf_rows[-1]['date']
        print(f"  范围: {first_date} ~ {last_date}")
        
        # 检查缺失日期
        if hasattr(first_date, 'strftime'):
            all_dates = set()
            d = first_date
            while d <= last_date:
                all_dates.add(d)
                d += timedelta(days=1)
            actual = set(r['date'] for r in perf_rows)
            missing = sorted(all_dates - actual)
            if missing:
                print(f"  ⚠️ 缺失 {len(missing)} 天: {', '.join(str(m) for m in missing[:10])}{'...' if len(missing) > 10 else ''}")
            else:
                print(f"  ✅ 日期连续")
        
        print(f"\n  逐日详情:")
        for r in perf_rows:
            print(f"    {r['date']}: {safe(r['rows_count'])}行, 展示={safe(r['imp'])}, "
                  f"点击={safe(r['clk'])}, 花费=${safe(r['spend'])}, 销售=${safe(r['sales'])}")

    # ===== 5. 账户90027的广告活动详情 =====
    print("\n【5】账户90027的广告活动详情")
    print("-" * 80)
    cur.execute("""
        SELECT id, campaignId, campaignName, campaignType, campaignStatus, state,
               dailyBudget, start_date, amazon_created_date, createdAt
        FROM campaigns WHERE accountId = 90027
        ORDER BY createdAt ASC
    """)
    camps = cur.fetchall()
    print(f"  广告活动总数: {len(camps)}")
    for c in camps:
        print(f"    [{safe(c['campaignType'])}] {trunc(safe(c['campaignName']), 60)} | "
              f"状态={safe(c['campaignStatus'])}/{safe(c['state'])} | "
              f"预算=${safe(c['dailyBudget'])} | "
              f"Amazon创建={safe(c['amazon_created_date'])} | 系统创建={safe(c['createdAt'])}")

    # ===== 6. 账户90027的优化事件 =====
    print("\n【6】账户90027的优化事件（最近20条）")
    print("-" * 80)
    cur.execute("""
        SELECT action_type, status, algorithm_version, api_sync_status,
               LEFT(change_reason, 150) as reason, created_at
        FROM optimization_events WHERE account_id = 90027
        ORDER BY created_at DESC LIMIT 20
    """)
    events = cur.fetchall()
    if events:
        for e in events:
            print(f"  [{e['created_at']}] {safe(e['action_type'])} | {safe(e['status'])} | "
                  f"API:{safe(e['api_sync_status'])} | v{safe(e['algorithm_version'])} | "
                  f"{safe(e['reason'], '')[:100]}")
    else:
        print("  ⚠️ 无优化事件记录")

    # ===== 7. 错误/失败事件 =====
    print("\n【7】账户90027的错误/失败事件")
    print("-" * 80)
    cur.execute("""
        SELECT action_type, status, api_sync_status,
               LEFT(error_message, 200) as err,
               LEFT(change_reason, 100) as reason, created_at
        FROM optimization_events WHERE account_id = 90027
        AND (status = 'failed' OR api_sync_status = 'failed' OR error_message IS NOT NULL)
        ORDER BY created_at DESC LIMIT 20
    """)
    errors = cur.fetchall()
    if errors:
        for e in errors:
            print(f"  [{e['created_at']}] {safe(e['action_type'])} | 状态:{safe(e['status'])} | "
                  f"API:{safe(e['api_sync_status'])} | 错误:{safe(e['err'], '无')}")
    else:
        print("  ✅ 无失败事件")

    # ===== 8. 关键时间线分析 =====
    print("\n【8】账户90027关键时间线")
    print("-" * 80)
    print(f"  API授权时间:       2026-02-03 02:47:13")
    print(f"  初始化完成时间:     2026-02-14 01:10:48")
    print(f"  绩效数据最早日期:   {perf_rows[0]['date'] if perf_rows else 'N/A'}")
    print(f"  绩效数据最新日期:   {perf_rows[-1]['date'] if perf_rows else 'N/A'}")
    
    # 计算预期最早日期（90天前）
    expected_earliest = (now - timedelta(days=90)).date()
    actual_earliest = perf_rows[0]['date'] if perf_rows else None
    if actual_earliest:
        print(f"  预期最早日期(90天): {expected_earliest}")
        if hasattr(actual_earliest, 'strftime'):
            gap = (actual_earliest - expected_earliest).days
            print(f"  实际与预期差距:     {gap}天 {'⚠️ 缺少历史数据' if gap > 3 else '✅'}")

    # ===== 9. 检查90027的最后同步时间 =====
    print("\n【9】各表最后更新时间")
    print("-" * 80)
    for table, ts_col in [('daily_performance', 'updatedAt'), ('search_terms', 'updatedAt'), 
                           ('placement_performance', 'updatedAt'), ('campaigns', 'updatedAt')]:
        try:
            cur.execute(f"SELECT MAX({ts_col}) as last_update FROM {table} WHERE accountId = 90027")
            r = cur.fetchone()
            print(f"  {table}: 最后更新 = {safe(r['last_update'])}")
        except Exception as e:
            print(f"  {table}: 查询失败 - {e}")

    # ===== 10. 检查90027的广告活动在Amazon上的创建时间 =====
    print("\n【10】账户90027广告活动的Amazon创建时间分析")
    print("-" * 80)
    cur.execute("""
        SELECT amazon_created_date, start_date, COUNT(*) as cnt
        FROM campaigns WHERE accountId = 90027
        GROUP BY amazon_created_date, start_date
        ORDER BY amazon_created_date
    """)
    for r in cur.fetchall():
        print(f"  Amazon创建={safe(r['amazon_created_date'])}, 开始={safe(r['start_date'])}, 数量={r['cnt']}")

    # ===== 11. 检查90027的绩效数据最后3天是否有缺失 =====
    print("\n【11】账户90027最近7天绩效数据检查")
    print("-" * 80)
    cur.execute("""
        SELECT date, COUNT(*) as rows_count,
               SUM(impressions) as imp, SUM(clicks) as clk,
               ROUND(SUM(spend), 2) as spend
        FROM daily_performance WHERE accountId = 90027
        AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        GROUP BY date ORDER BY date
    """)
    recent = cur.fetchall()
    if recent:
        for r in recent:
            print(f"  {r['date']}: {r['rows_count']}行, 展示={safe(r['imp'])}, 点击={safe(r['clk'])}, 花费=${safe(r['spend'])}")
    else:
        print("  ⚠️ 最近7天无绩效数据！")

    cur.close()
    conn.close()

if __name__ == '__main__':
    main()
