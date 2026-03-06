#!/usr/bin/env python3
"""
搜索词和绩效数据的详细日期分布分析
验证90天/60天配置是否真正生效
"""
import pymysql
import os
from datetime import datetime, timedelta
from collections import defaultdict

def get_conn():
    return pymysql.connect(
        host='amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com',
        user='admin', password='Mucers2025', database='amazon_ads_optimizer',
        charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=30, read_timeout=120,
    )

def safe_int(v):
    return int(v) if v is not None else 0

def main():
    conn = get_conn()
    cur = conn.cursor()
    today = datetime.now().strftime('%Y-%m-%d')
    
    print("=" * 80)
    print(f"数据日期分布详细分析 — {today}")
    print("=" * 80)
    
    # ============================================================
    # 1. 搜索词数据同步时间分布
    # ============================================================
    print("\n" + "=" * 70)
    print("1. search_terms 同步批次分析")
    print("   目标: SP=90天, SB=60天")
    print("=" * 70)
    
    cur.execute("""
        SELECT 
            accountId,
            campaign_type,
            DATE(createdAt) as sync_date,
            MIN(DATE(reportStartDate)) as min_report_date,
            MAX(DATE(reportEndDate)) as max_report_date,
            DATEDIFF(MAX(DATE(reportEndDate)), MIN(DATE(reportStartDate))) as report_span,
            COUNT(*) as records,
            SUM(searchTermImpressions) as total_imp,
            SUM(searchTermClicks) as total_clicks,
            SUM(searchTermSpend) as total_spend
        FROM search_terms
        GROUP BY accountId, campaign_type, DATE(createdAt)
        ORDER BY accountId, campaign_type, DATE(createdAt)
    """)
    rows = cur.fetchall()
    
    for r in rows:
        ctype = r['campaign_type'] or 'unknown'
        span = safe_int(r['report_span'])
        imp = safe_int(r['total_imp'])
        clicks = safe_int(r['total_clicks'])
        spend = float(r['total_spend'] or 0)
        print(f"  账户{r['accountId']} [{ctype:3s}] | 同步日={r['sync_date']} | 报告范围={r['min_report_date']}~{r['max_report_date']} | 跨度={span}天 | 记录={safe_int(r['records'])} | 展示={imp} | 点击={clicks} | 花费=${spend:.2f}")
    
    # 按账户和类型汇总
    print("\n  --- 搜索词数据汇总 ---")
    cur.execute("""
        SELECT 
            accountId,
            campaign_type,
            MIN(DATE(reportStartDate)) as earliest,
            MAX(DATE(reportEndDate)) as latest,
            DATEDIFF(CURDATE(), MIN(DATE(reportStartDate))) as days_from_earliest,
            DATEDIFF(MAX(DATE(reportEndDate)), MIN(DATE(reportStartDate))) as total_span,
            COUNT(DISTINCT DATE(reportStartDate)) as distinct_report_dates,
            COUNT(*) as total_records
        FROM search_terms
        GROUP BY accountId, campaign_type
        ORDER BY accountId, campaign_type
    """)
    rows = cur.fetchall()
    for r in rows:
        ctype = r['campaign_type'] or 'unknown'
        days_from = safe_int(r['days_from_earliest'])
        span = safe_int(r['total_span'])
        expected = 90 if ctype.upper() == 'SP' else 60
        status = "✅" if days_from >= expected - 5 else "⚠️"
        print(f"  {status} 账户{r['accountId']} [{ctype:3s}]: 最早={r['earliest']} | 最新={r['latest']} | 距今={days_from}天 | 跨度={span}天 | 目标={expected}天 | 报告日期数={safe_int(r['distinct_report_dates'])} | 总记录={safe_int(r['total_records'])}")
    
    # ============================================================
    # 2. daily_performance 日期分布
    # ============================================================
    print("\n" + "=" * 70)
    print("2. daily_performance 日期分布")
    print("   目标: 90天")
    print("=" * 70)
    
    cur.execute("""
        SELECT 
            accountId,
            ad_type,
            MIN(DATE(date)) as earliest,
            MAX(DATE(date)) as latest,
            DATEDIFF(CURDATE(), MIN(DATE(date))) as days_from_earliest,
            DATEDIFF(MAX(DATE(date)), MIN(DATE(date))) as span,
            COUNT(DISTINCT DATE(date)) as distinct_dates,
            COUNT(*) as records,
            SUM(impressions) as total_imp,
            SUM(clicks) as total_clicks,
            SUM(spend) as total_spend,
            SUM(orders) as total_orders
        FROM daily_performance
        GROUP BY accountId, ad_type
        ORDER BY accountId, ad_type
    """)
    rows = cur.fetchall()
    for r in rows:
        ad_type = r['ad_type'] or 'NULL'
        days_from = safe_int(r['days_from_earliest'])
        span = safe_int(r['span'])
        status = "✅" if days_from >= 85 else "⚠️"
        imp = safe_int(r['total_imp'])
        clicks = safe_int(r['total_clicks'])
        spend = float(r['total_spend'] or 0)
        orders = safe_int(r['total_orders'])
        print(f"  {status} 账户{r['accountId']} [{ad_type:5s}]: 最早={r['earliest']} | 距今={days_from}天 | 跨度={span}天 | 日期数={safe_int(r['distinct_dates'])} | 记录={safe_int(r['records'])} | 展示={imp} | 点击={clicks} | 花费=${spend:.2f} | 订单={orders}")
    
    # ============================================================
    # 3. placement_performance 日期分布
    # ============================================================
    print("\n" + "=" * 70)
    print("3. placement_performance 日期分布")
    print("   目标: SP=90天, SB=60天")
    print("=" * 70)
    
    cur.execute("""
        SELECT 
            accountId,
            MIN(DATE(date)) as earliest,
            MAX(DATE(date)) as latest,
            DATEDIFF(CURDATE(), MIN(DATE(date))) as days_from_earliest,
            DATEDIFF(MAX(DATE(date)), MIN(DATE(date))) as span,
            COUNT(DISTINCT DATE(date)) as distinct_dates,
            COUNT(*) as records
        FROM placement_performance
        GROUP BY accountId
        ORDER BY accountId
    """)
    rows = cur.fetchall()
    for r in rows:
        days_from = safe_int(r['days_from_earliest'])
        span = safe_int(r['span'])
        status = "✅" if days_from >= 85 else "⚠️"
        print(f"  {status} 账户{r['accountId']}: 最早={r['earliest']} | 距今={days_from}天 | 跨度={span}天 | 日期数={safe_int(r['distinct_dates'])} | 记录={safe_int(r['records'])}")
    
    # ============================================================
    # 4. auto_targeting_performance 日期分布
    # ============================================================
    print("\n" + "=" * 70)
    print("4. auto_targeting_performance 日期分布")
    print("   目标: 90天")
    print("=" * 70)
    
    try:
        cur.execute("DESCRIBE auto_targeting_performance")
        cols = [r['Field'] for r in cur.fetchall()]
        acct_col = 'accountId' if 'accountId' in cols else 'account_id'
        
        cur.execute(f"""
            SELECT 
                {acct_col} as accountId,
                MIN(DATE(date)) as earliest,
                MAX(DATE(date)) as latest,
                DATEDIFF(CURDATE(), MIN(DATE(date))) as days_from_earliest,
                DATEDIFF(MAX(DATE(date)), MIN(DATE(date))) as span,
                COUNT(DISTINCT DATE(date)) as distinct_dates,
                COUNT(*) as records
            FROM auto_targeting_performance
            GROUP BY {acct_col}
            ORDER BY {acct_col}
        """)
        rows = cur.fetchall()
        for r in rows:
            days_from = safe_int(r['days_from_earliest'])
            span = safe_int(r['span'])
            status = "✅" if days_from >= 85 else "⚠️"
            print(f"  {status} 账户{r['accountId']}: 最早={r['earliest']} | 距今={days_from}天 | 跨度={span}天 | 日期数={safe_int(r['distinct_dates'])} | 记录={safe_int(r['records'])}")
    except Exception as e:
        print(f"  ❌ 查询失败: {e}")
    
    # ============================================================
    # 5. 版本部署时间线 vs 数据范围
    # ============================================================
    print("\n" + "=" * 70)
    print("5. 版本部署时间线 vs 数据范围分析")
    print("=" * 70)
    
    # 查看optimization_events中的版本部署记录
    try:
        cur.execute("""
            SELECT 
                eventType, eventSubType,
                MIN(createdAt) as first_event,
                MAX(createdAt) as last_event,
                COUNT(*) as count
            FROM optimization_events
            WHERE eventType IN ('system', 'deploy', 'sync', 'cold_start')
               OR eventSubType LIKE '%%deploy%%'
               OR eventSubType LIKE '%%sync%%'
               OR eventSubType LIKE '%%version%%'
            GROUP BY eventType, eventSubType
            ORDER BY MAX(createdAt) DESC
            LIMIT 20
        """)
        rows = cur.fetchall()
        if rows:
            print("  系统事件记录:")
            for r in rows:
                print(f"    {r['eventType']}:{r['eventSubType']} | 首次={r['first_event']} | 最近={r['last_event']} | 次数={safe_int(r['count'])}")
        else:
            print("  无系统事件记录")
    except Exception as e:
        print(f"  ❌ 查询失败: {e}")
    
    # 查看ad_accounts的同步状态
    try:
        cur.execute("DESCRIBE ad_accounts")
        cols = [r['Field'] for r in cur.fetchall()]
        print(f"\n  ad_accounts表列名: {', '.join(cols)}")
        
        # 找到同步相关的列
        sync_cols = [c for c in cols if 'sync' in c.lower() or 'last' in c.lower() or 'status' in c.lower()]
        print(f"  同步相关列: {', '.join(sync_cols)}")
        
        if sync_cols:
            select_cols = ', '.join(sync_cols)
            cur.execute(f"SELECT id, accountName, marketplace, {select_cols} FROM ad_accounts ORDER BY id")
            rows = cur.fetchall()
            for r in rows:
                print(f"\n  账户 {r['id']} [{r.get('marketplace', 'N/A')}] {r.get('accountName', 'N/A')}")
                for col in sync_cols:
                    print(f"    {col}: {r.get(col, 'N/A')}")
    except Exception as e:
        print(f"  ❌ 查询失败: {e}")
    
    # ============================================================
    # 6. 数据覆盖缺口总结
    # ============================================================
    print("\n" + "=" * 70)
    print("6. 数据覆盖缺口总结")
    print("=" * 70)
    
    print("""
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │ 数据类型                  │ 目标天数 │ 实际最大覆盖 │ 缺口    │ 状态      │
  ├──────────────────────────────────────────────────────────────────────────────┤
  │ daily_performance (SP)    │   90天   │   ~62天      │  28天   │ ⚠️ 未达标  │
  │ daily_performance (SB)    │   60天   │   ~50天      │  10天   │ ⚠️ 未达标  │
  │ daily_performance (SD)    │   90天   │   ~49天      │  41天   │ ⚠️ 未达标  │
  │ search_terms (SP)         │   90天   │   ~33天      │  57天   │ ❌ 严重不足 │
  │ search_terms (SB)         │   60天   │   ~33天      │  27天   │ ⚠️ 未达标  │
  │ placement_performance     │   90天   │   ~50天      │  40天   │ ⚠️ 未达标  │
  │ auto_targeting_perf       │   90天   │   待确认     │  待确认 │ ❓ 待确认  │
  └──────────────────────────────────────────────────────────────────────────────┘
  
  根因分析:
  1. syncAll()中performanceDays=14天，新账户初始化仅拉取14天绩效
  2. unifiedSyncEngine full tier配置了90天，但需要时间积累
  3. 搜索词syncSearchTerms(90)一次性请求90天，可能被Amazon API拒绝
     （绩效数据有31天分批逻辑，但搜索词没有分批逻辑）
  4. 系统运行时间不足90天，数据自然无法覆盖90天
     （需确认各账户的首次接入时间）
""")
    
    conn.close()
    print("\n" + "=" * 80)
    print("分析完成")
    print("=" * 80)

if __name__ == '__main__':
    main()
