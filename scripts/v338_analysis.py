#!/usr/bin/env python3
"""
v338 部署后生产环境数据分析脚本
分析各优化算法的运行状态和数据变化
"""

import pymysql
import json
import os
from datetime import datetime, timedelta

DB_CONFIG = {
    'host': os.environ.get('DATABASE_HOST', 'localhost'),
    'user': os.environ.get('DATABASE_USER', 'admin'),
    'password': os.environ.get('DATABASE_PASSWORD', ''),
    'database': os.environ.get('DATABASE_NAME', 'amazon_ads_optimizer'),
    'charset': 'utf8mb4',
    'connect_timeout': 10,
}

def get_connection():
    return pymysql.connect(**DB_CONFIG, cursorclass=pymysql.cursors.DictCursor)

def run_query(conn, sql, params=None):
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchall()

def main():
    print("=" * 80)
    print("v338 生产环境数据分析")
    print("=" * 80)
    
    try:
        conn = get_connection()
        print("✅ 数据库连接成功\n")
    except Exception as e:
        print(f"❌ 数据库连接失败: {e}")
        return
    
    results = {}
    
    # ============================================================
    # 1. 系统版本和部署信息
    # ============================================================
    print("\n" + "=" * 60)
    print("1. 系统版本和部署信息")
    print("=" * 60)
    
    # 查找v338部署时间
    deploy_events = run_query(conn, """
        SELECT id, algorithm_version, change_reason, action_detail, created_at, status
        FROM optimization_events 
        WHERE algorithm_version LIKE '%%338%%' OR change_reason LIKE '%%338%%' OR action_detail LIKE '%%338%%'
        ORDER BY created_at ASC
        LIMIT 10
    """)
    print(f"\nv338相关事件数: {len(deploy_events)}")
    for e in deploy_events:
        print(f"  [{e['created_at']}] {e['algorithm_version']} | {e['action_type'] if 'action_type' in e else ''} | {str(e['change_reason'])[:100]}")
    results['deploy_events'] = deploy_events
    
    # 查找最新的心跳/版本信息
    heartbeat = run_query(conn, """
        SELECT algorithm_version, change_reason, action_detail, created_at
        FROM optimization_events 
        WHERE event_category = 'settings_change' AND action_type = 'auto_correction'
        ORDER BY created_at DESC
        LIMIT 5
    """)
    print(f"\n最近系统事件:")
    for h in heartbeat:
        detail_str = str(h.get('action_detail', ''))[:200] if h.get('action_detail') else ''
        print(f"  [{h['created_at']}] {h['algorithm_version']} | {str(h['change_reason'])[:100]}")
        if 'systemVersion' in detail_str:
            print(f"    detail: {detail_str}")
    
    # ============================================================
    # 2. 确定分析时间范围
    # ============================================================
    # 查找v338首次出现的时间，如果没有v338，则用最近7天
    v338_start = None
    for e in deploy_events:
        if e.get('created_at'):
            v338_start = e['created_at']
            break
    
    if not v338_start:
        # 查找最新版本号
        latest_ver = run_query(conn, """
            SELECT DISTINCT algorithm_version, MIN(created_at) as first_seen
            FROM optimization_events 
            WHERE algorithm_version IS NOT NULL AND algorithm_version != ''
            GROUP BY algorithm_version
            ORDER BY first_seen DESC
            LIMIT 5
        """)
        print(f"\n最近版本:")
        for v in latest_ver:
            print(f"  {v['algorithm_version']} | 首次出现: {v['first_seen']}")
        
        # 使用最近7天作为分析范围
        v338_start = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')
        print(f"\n⚠ 未找到v338部署事件，使用最近7天作为分析范围: {v338_start}")
    else:
        print(f"\n✅ v338部署时间: {v338_start}")
    
    results['analysis_start'] = str(v338_start)
    
    # ============================================================
    # 3. 优化事件总览
    # ============================================================
    print("\n" + "=" * 60)
    print("3. 优化事件总览（自v338部署以来）")
    print("=" * 60)
    
    event_summary = run_query(conn, """
        SELECT 
            event_category,
            action_type,
            status,
            api_sync_status,
            COUNT(*) as cnt,
            MIN(created_at) as first_at,
            MAX(created_at) as last_at
        FROM optimization_events 
        WHERE created_at >= %s
        GROUP BY event_category, action_type, status, api_sync_status
        ORDER BY event_category, cnt DESC
    """, (v338_start,))
    
    print(f"\n总事件分类统计:")
    current_cat = None
    for e in event_summary:
        if e['event_category'] != current_cat:
            current_cat = e['event_category']
            print(f"\n  📁 {current_cat}:")
        print(f"    {e['action_type']:30s} | status={e['status']:10s} | api_sync={e['api_sync_status']:15s} | count={e['cnt']:6d} | {e['first_at']} ~ {e['last_at']}")
    results['event_summary'] = event_summary
    
    # ============================================================
    # 4. 否词分析（negative_keyword_add）
    # ============================================================
    print("\n" + "=" * 60)
    print("4. 否词（Negative Keyword）分析")
    print("=" * 60)
    
    neg_kw = run_query(conn, """
        SELECT 
            status,
            api_sync_status,
            COUNT(*) as cnt,
            COUNT(DISTINCT campaign_id) as campaigns,
            COUNT(DISTINCT ad_group_id) as adgroups,
            COUNT(DISTINCT account_id) as accounts
        FROM optimization_events 
        WHERE action_type = 'negative_keyword_add' AND created_at >= %s
        GROUP BY status, api_sync_status
    """, (v338_start,))
    
    print(f"\n否词添加统计:")
    for n in neg_kw:
        print(f"  status={n['status']:10s} | api_sync={n['api_sync_status']:15s} | count={n['cnt']:6d} | campaigns={n['campaigns']} | adgroups={n['adgroups']} | accounts={n['accounts']}")
    
    # 否词详情 - 按算法版本
    neg_by_ver = run_query(conn, """
        SELECT 
            algorithm_version,
            COUNT(*) as cnt,
            SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
            SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN api_sync_status = 'pending' THEN 1 ELSE 0 END) as pending
        FROM optimization_events 
        WHERE action_type = 'negative_keyword_add' AND created_at >= %s
        GROUP BY algorithm_version
        ORDER BY cnt DESC
    """, (v338_start,))
    
    print(f"\n否词按算法版本:")
    for n in neg_by_ver:
        ver = str(n['algorithm_version'] or 'N/A')
        total = int(n['cnt'] or 0)
        synced = int(n['synced'] or 0)
        failed = int(n['failed'] or 0)
        pending = int(n['pending'] or 0)
        print(f"  {ver:15s} | total={total:6d} | synced={synced:5d} | failed={failed:5d} | pending={pending:5d}")
    
    # 否词样本
    neg_samples = run_query(conn, """
        SELECT keyword_text, match_type, campaign_name, change_reason, status, api_sync_status, created_at, algorithm_version
        FROM optimization_events 
        WHERE action_type = 'negative_keyword_add' AND created_at >= %s
        ORDER BY created_at DESC
        LIMIT 15
    """, (v338_start,))
    
    print(f"\n最近否词样本:")
    for s in neg_samples:
        print(f"  [{s['created_at']}] '{s['keyword_text']}' ({s['match_type']}) | {s['status']} | api={s['api_sync_status']} | v{s['algorithm_version']}")
        if s.get('change_reason'):
            print(f"    reason: {str(s['change_reason'])[:150]}")
    results['neg_kw'] = neg_kw
    results['neg_samples'] = neg_samples
    
    # ============================================================
    # 5. 否ASIN分析（target_management中的否定ASIN）
    # ============================================================
    print("\n" + "=" * 60)
    print("5. 否ASIN分析")
    print("=" * 60)
    
    neg_asin = run_query(conn, """
        SELECT 
            action_type,
            status,
            api_sync_status,
            COUNT(*) as cnt,
            COUNT(DISTINCT campaign_id) as campaigns,
            COUNT(DISTINCT account_id) as accounts
        FROM optimization_events 
        WHERE (action_type IN ('create_target', 'target_pause') 
               OR (action_type = 'negative_keyword_add' AND (keyword_text LIKE 'asin=%%' OR keyword_text LIKE 'B0%%')))
          AND created_at >= %s
        GROUP BY action_type, status, api_sync_status
    """, (v338_start,))
    
    print(f"\n否ASIN/Target管理统计:")
    for n in neg_asin:
        print(f"  {n['action_type']:25s} | status={n['status']:10s} | api_sync={n['api_sync_status']:15s} | count={n['cnt']:6d}")
    
    # 查看negative_keywords表中的ASIN否定
    neg_asin_table = run_query(conn, """
        SELECT 
            negative_type,
            negative_source,
            negative_status,
            COUNT(*) as cnt,
            COUNT(DISTINCT campaign_id) as campaigns,
            MIN(created_at) as first_at,
            MAX(created_at) as last_at
        FROM negative_keywords
        WHERE (negative_text LIKE 'asin=%%' OR negative_text LIKE 'B0%%' OR negative_type = 'product')
          AND created_at >= %s
        GROUP BY negative_type, negative_source, negative_status
    """, (v338_start,))
    
    print(f"\nnegative_keywords表中的ASIN否定:")
    for n in neg_asin_table:
        print(f"  match_type={n['match_type']:20s} | count={n['cnt']:6d} | campaigns={n['campaigns']} | {n['first_at']} ~ {n['last_at']}")
    results['neg_asin'] = neg_asin
    
    # ============================================================
    # 6. 搜索词收割分析（search_term_harvest）
    # ============================================================
    print("\n" + "=" * 60)
    print("6. 搜索词收割分析")
    print("=" * 60)
    
    harvest = run_query(conn, """
        SELECT 
            action_type,
            status,
            api_sync_status,
            COUNT(*) as cnt,
            COUNT(DISTINCT campaign_id) as campaigns,
            COUNT(DISTINCT account_id) as accounts
        FROM optimization_events 
        WHERE action_type IN ('search_term_harvest', 'keyword_create') AND created_at >= %s
        GROUP BY action_type, status, api_sync_status
    """, (v338_start,))
    
    print(f"\n搜索词收割统计:")
    for h in harvest:
        print(f"  {h['action_type']:25s} | status={h['status']:10s} | api_sync={h['api_sync_status']:15s} | count={h['cnt']:6d}")
    
    # 收割样本
    harvest_samples = run_query(conn, """
        SELECT keyword_text, match_type, campaign_name, change_reason, status, api_sync_status, created_at, algorithm_version
        FROM optimization_events 
        WHERE action_type IN ('search_term_harvest', 'keyword_create') AND created_at >= %s
        ORDER BY created_at DESC
        LIMIT 15
    """, (v338_start,))
    
    print(f"\n最近收割样本:")
    for s in harvest_samples:
        print(f"  [{s['created_at']}] '{s['keyword_text']}' ({s['match_type']}) | {s['status']} | api={s['api_sync_status']} | v{s['algorithm_version']}")
        if s.get('change_reason'):
            print(f"    reason: {str(s['change_reason'])[:150]}")
    results['harvest'] = harvest
    results['harvest_samples'] = harvest_samples
    
    # ============================================================
    # 7. ASIN收割分析
    # ============================================================
    print("\n" + "=" * 60)
    print("7. ASIN收割分析")
    print("=" * 60)
    
    asin_harvest = run_query(conn, """
        SELECT 
            action_type,
            status,
            api_sync_status,
            COUNT(*) as cnt,
            COUNT(DISTINCT campaign_id) as campaigns
        FROM optimization_events 
        WHERE action_type = 'create_target' 
          AND change_reason LIKE '%%收割%%'
          AND created_at >= %s
        GROUP BY action_type, status, api_sync_status
    """, (v338_start,))
    
    print(f"\nASIN收割统计:")
    for a in asin_harvest:
        print(f"  {a['action_type']:25s} | status={a['status']:10s} | api_sync={a['api_sync_status']:15s} | count={a['cnt']:6d}")
    
    # 也查看search_term_analysis表
    st_analysis = run_query(conn, """
        SELECT 
            action_taken,
            COUNT(*) as cnt,
            SUM(clicks) as total_clicks,
            SUM(orders) as total_orders,
            AVG(acos) as avg_acos,
            MIN(analysis_date) as first_date,
            MAX(analysis_date) as last_date
        FROM search_term_analysis
        WHERE analysis_date >= %s
        GROUP BY action_taken
        ORDER BY cnt DESC
    """, (v338_start,))
    
    print(f"\nsearch_term_analysis表统计:")
    for s in st_analysis:
        print(f"  action={s['action_taken']:25s} | count={s['cnt']:6d} | clicks={s['total_clicks'] or 0} | orders={s['total_orders'] or 0} | avg_acos={s['avg_acos'] or 0:.2f}")
    results['asin_harvest'] = asin_harvest
    results['st_analysis'] = st_analysis
    
    # ============================================================
    # 8. 分时竞价分析（dayparting_bid）
    # ============================================================
    print("\n" + "=" * 60)
    print("8. 分时竞价分析")
    print("=" * 60)
    
    daypart_bid = run_query(conn, """
        SELECT 
            status,
            api_sync_status,
            COUNT(*) as cnt,
            AVG(CAST(previous_bid AS DECIMAL(10,4))) as avg_prev_bid,
            AVG(CAST(new_bid AS DECIMAL(10,4))) as avg_new_bid,
            AVG(CAST(bid_change_percent AS DECIMAL(10,2))) as avg_change_pct,
            COUNT(DISTINCT campaign_id) as campaigns,
            COUNT(DISTINCT account_id) as accounts
        FROM optimization_events 
        WHERE action_type = 'dayparting_bid' AND created_at >= %s
        GROUP BY status, api_sync_status
    """, (v338_start,))
    
    print(f"\n分时竞价统计:")
    for d in daypart_bid:
        print(f"  status={d['status']:10s} | api_sync={d['api_sync_status']:15s} | count={d['cnt']:6d} | avg_prev={d['avg_prev_bid'] or 0:.4f} | avg_new={d['avg_new_bid'] or 0:.4f} | avg_chg%={d['avg_change_pct'] or 0:.2f}%")
    
    # 分时竞价按小时分布
    daypart_hourly = run_query(conn, """
        SELECT 
            HOUR(created_at) as hour_of_day,
            COUNT(*) as cnt,
            AVG(CAST(bid_change_percent AS DECIMAL(10,2))) as avg_change_pct,
            SUM(CASE WHEN CAST(bid_change_percent AS DECIMAL(10,2)) > 0 THEN 1 ELSE 0 END) as increases,
            SUM(CASE WHEN CAST(bid_change_percent AS DECIMAL(10,2)) < 0 THEN 1 ELSE 0 END) as decreases
        FROM optimization_events 
        WHERE action_type = 'dayparting_bid' AND created_at >= %s AND status = 'success'
        GROUP BY HOUR(created_at)
        ORDER BY hour_of_day
    """, (v338_start,))
    
    print(f"\n分时竞价按小时分布:")
    for h in daypart_hourly:
        bar = "+" * min(int((h['cnt'] or 0) / max(1, max(x['cnt'] for x in daypart_hourly)) * 30), 30) if daypart_hourly else ""
        print(f"  {h['hour_of_day']:2d}:00 | count={h['cnt']:5d} | avg_chg={h['avg_change_pct'] or 0:+.2f}% | ↑{h['increases'] or 0} ↓{h['decreases'] or 0} | {bar}")
    results['daypart_bid'] = daypart_bid
    results['daypart_hourly'] = daypart_hourly
    
    # ============================================================
    # 9. 分时预算分析（budget_adjustment）
    # ============================================================
    print("\n" + "=" * 60)
    print("9. 分时预算分析")
    print("=" * 60)
    
    daypart_budget = run_query(conn, """
        SELECT 
            action_type,
            status,
            api_sync_status,
            COUNT(*) as cnt,
            COUNT(DISTINCT campaign_id) as campaigns,
            COUNT(DISTINCT account_id) as accounts
        FROM optimization_events 
        WHERE event_category = 'budget_adjustment' AND created_at >= %s
        GROUP BY action_type, status, api_sync_status
    """, (v338_start,))
    
    print(f"\n分时预算统计:")
    for d in daypart_budget:
        print(f"  {d['action_type']:25s} | status={d['status']:10s} | api_sync={d['api_sync_status']:15s} | count={d['cnt']:6d} | campaigns={d['campaigns']}")
    
    # 预算调整幅度
    budget_amounts = run_query(conn, """
        SELECT 
            action_type,
            AVG(CAST(previous_value AS DECIMAL(10,2))) as avg_prev,
            AVG(CAST(new_value AS DECIMAL(10,2))) as avg_new,
            MIN(CAST(new_value AS DECIMAL(10,2))) as min_new,
            MAX(CAST(new_value AS DECIMAL(10,2))) as max_new
        FROM optimization_events 
        WHERE event_category = 'budget_adjustment' AND created_at >= %s
          AND previous_value REGEXP '^[0-9]' AND new_value REGEXP '^[0-9]'
        GROUP BY action_type
    """, (v338_start,))
    
    print(f"\n预算调整幅度:")
    for b in budget_amounts:
        print(f"  {b['action_type']:25s} | avg_prev={b['avg_prev'] or 0:.2f} | avg_new={b['avg_new'] or 0:.2f} | range=[{b['min_new'] or 0:.2f}, {b['max_new'] or 0:.2f}]")
    
    # dayparting_execution_logs表
    daypart_exec = run_query(conn, """
        SELECT 
            rule_type,
            execution_status,
            COUNT(*) as cnt,
            MIN(executed_at) as first_at,
            MAX(executed_at) as last_at
        FROM dayparting_execution_logs
        WHERE executed_at >= %s
        GROUP BY rule_type, execution_status
        ORDER BY rule_type, cnt DESC
    """, (v338_start,))
    
    print(f"\ndayparting_execution_logs统计:")
    for d in daypart_exec:
        print(f"  type={d['rule_type']:15s} | status={d['execution_status']:10s} | count={d['cnt']:6d} | {d['first_at']} ~ {d['last_at']}")
    results['daypart_budget'] = daypart_budget
    results['daypart_exec'] = daypart_exec
    
    # ============================================================
    # 10. 位置倾斜分析（placement_adjustment）
    # ============================================================
    print("\n" + "=" * 60)
    print("10. 位置倾斜分析")
    print("=" * 60)
    
    placement = run_query(conn, """
        SELECT 
            action_type,
            status,
            api_sync_status,
            COUNT(*) as cnt,
            COUNT(DISTINCT campaign_id) as campaigns,
            COUNT(DISTINCT account_id) as accounts
        FROM optimization_events 
        WHERE event_category = 'placement_adjustment' AND created_at >= %s
        GROUP BY action_type, status, api_sync_status
    """, (v338_start,))
    
    print(f"\n位置倾斜统计:")
    for p in placement:
        print(f"  {p['action_type']:25s} | status={p['status']:10s} | api_sync={p['api_sync_status']:15s} | count={p['cnt']:6d}")
    
    # 位置倾斜详情
    placement_detail = run_query(conn, """
        SELECT 
            previous_value,
            new_value,
            change_reason,
            campaign_name,
            created_at,
            algorithm_version,
            status,
            api_sync_status
        FROM optimization_events 
        WHERE event_category = 'placement_adjustment' AND created_at >= %s
        ORDER BY created_at DESC
        LIMIT 15
    """, (v338_start,))
    
    print(f"\n最近位置倾斜样本:")
    for p in placement_detail:
        print(f"  [{p['created_at']}] {p['previous_value']} → {p['new_value']} | {p['status']} | api={p['api_sync_status']} | v{p['algorithm_version']}")
        if p.get('change_reason'):
            print(f"    reason: {str(p['change_reason'])[:150]}")
    results['placement'] = placement
    results['placement_detail'] = placement_detail
    
    # ============================================================
    # 11. 竞价调整分析（bid_adjustment）
    # ============================================================
    print("\n" + "=" * 60)
    print("11. 竞价调整分析（常规竞价）")
    print("=" * 60)
    
    bid_adj = run_query(conn, """
        SELECT 
            action_type,
            status,
            api_sync_status,
            COUNT(*) as cnt,
            AVG(CAST(previous_bid AS DECIMAL(10,4))) as avg_prev_bid,
            AVG(CAST(new_bid AS DECIMAL(10,4))) as avg_new_bid,
            AVG(CAST(bid_change_percent AS DECIMAL(10,2))) as avg_change_pct,
            COUNT(DISTINCT campaign_id) as campaigns
        FROM optimization_events 
        WHERE event_category = 'bid_adjustment' AND action_type != 'dayparting_bid' AND created_at >= %s
        GROUP BY action_type, status, api_sync_status
    """, (v338_start,))
    
    print(f"\n常规竞价调整统计:")
    for b in bid_adj:
        print(f"  {b['action_type']:25s} | status={b['status']:10s} | api_sync={b['api_sync_status']:15s} | count={b['cnt']:6d} | avg_prev={b['avg_prev_bid'] or 0:.4f} | avg_new={b['avg_new_bid'] or 0:.4f}")
    results['bid_adj'] = bid_adj
    
    # ============================================================
    # 12. API同步成功率
    # ============================================================
    print("\n" + "=" * 60)
    print("12. API同步成功率总览")
    print("=" * 60)
    
    sync_rate = run_query(conn, """
        SELECT 
            event_category,
            api_sync_status,
            COUNT(*) as cnt
        FROM optimization_events 
        WHERE created_at >= %s AND api_sync_status != 'not_applicable'
        GROUP BY event_category, api_sync_status
        ORDER BY event_category, cnt DESC
    """, (v338_start,))
    
    print(f"\nAPI同步状态分布:")
    current_cat = None
    for s in sync_rate:
        if s['event_category'] != current_cat:
            current_cat = s['event_category']
            print(f"\n  📁 {current_cat}:")
        print(f"    {s['api_sync_status']:15s} | count={s['cnt']:6d}")
    results['sync_rate'] = sync_rate
    
    # ============================================================
    # 13. 冷启动日志（v338新增）
    # ============================================================
    print("\n" + "=" * 60)
    print("13. 冷启动日志（v338新增）")
    print("=" * 60)
    
    try:
        cold_start = run_query(conn, """
            SELECT * FROM cold_start_logs ORDER BY created_at DESC LIMIT 20
        """)
        print(f"\n冷启动日志记录数: {len(cold_start)}")
        for c in cold_start:
            print(f"  [{c.get('created_at')}] account={c.get('account_id')} | reason={c.get('trigger_reason')} | status={c.get('status')}")
    except Exception as e:
        print(f"\n⚠ cold_start_logs表不存在或查询失败: {e}")
        # 查找冷启动相关的optimization_events
        cold_events = run_query(conn, """
            SELECT id, change_reason, action_detail, created_at, algorithm_version
            FROM optimization_events 
            WHERE change_reason LIKE '%%cold%%start%%' OR change_reason LIKE '%%冷启动%%' OR action_detail LIKE '%%cold_start%%'
            ORDER BY created_at DESC
            LIMIT 10
        """)
        print(f"\n冷启动相关事件: {len(cold_events)}")
        for c in cold_events:
            print(f"  [{c['created_at']}] {c['algorithm_version']} | {str(c['change_reason'])[:100]}")
    
    # ============================================================
    # 14. 数据同步状态
    # ============================================================
    print("\n" + "=" * 60)
    print("14. 数据同步状态")
    print("=" * 60)
    
    sync_jobs = run_query(conn, """
        SELECT 
            status,
            COUNT(*) as cnt,
            MIN(created_at) as first_at,
            MAX(created_at) as last_at,
            AVG(TIMESTAMPDIFF(SECOND, started_at, completed_at)) as avg_duration_sec
        FROM data_sync_jobs
        WHERE created_at >= %s
        GROUP BY status
        ORDER BY cnt DESC
    """, (v338_start,))
    
    print(f"\n数据同步任务统计:")
    for s in sync_jobs:
        print(f"  status={s['status']:15s} | count={s['cnt']:6d} | avg_duration={s['avg_duration_sec'] or 0:.0f}s | {s['first_at']} ~ {s['last_at']}")
    
    # ============================================================
    # 15. 按日期统计优化事件趋势
    # ============================================================
    print("\n" + "=" * 60)
    print("15. 每日优化事件趋势")
    print("=" * 60)
    
    daily_trend = run_query(conn, """
        SELECT 
            DATE(created_at) as date,
            event_category,
            COUNT(*) as cnt,
            SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
            SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM optimization_events 
        WHERE created_at >= %s
        GROUP BY DATE(created_at), event_category
        ORDER BY date DESC, cnt DESC
    """, (v338_start,))
    
    print(f"\n每日事件趋势:")
    current_date = None
    for d in daily_trend:
        if str(d['date']) != str(current_date):
            current_date = d['date']
            print(f"\n  📅 {current_date}:")
        print(f"    {d['event_category']:25s} | total={d['cnt']:6d} | synced={d['synced']:5d} | failed={d['failed']:5d}")
    results['daily_trend'] = daily_trend
    
    # ============================================================
    # 16. 优化目标健康状态
    # ============================================================
    print("\n" + "=" * 60)
    print("16. 优化目标活跃状态")
    print("=" * 60)
    
    try:
        opt_targets = run_query(conn, """
            SELECT 
                pg.id,
                pg.name,
                pg.account_id,
                pg.status,
                pg.auto_optimization_enabled,
                pg.last_optimization_at,
                pg.optimization_count
            FROM performance_groups pg
            WHERE pg.status = 'active' AND pg.auto_optimization_enabled = 1
            ORDER BY pg.last_optimization_at DESC
            LIMIT 20
        """)
        print(f"\n活跃优化目标: {len(opt_targets)}")
        for t in opt_targets:
            print(f"  ID={t['id']:4d} | {t['name'][:40]:40s} | account={t['account_id']} | last_opt={t['last_optimization_at']} | count={t['optimization_count']}")
    except Exception as e:
        print(f"\n⚠ 查询优化目标失败: {e}")
    
    # ============================================================
    # 17. Ngram分析统计
    # ============================================================
    print("\n" + "=" * 60)
    print("17. Ngram分析统计")
    print("=" * 60)
    
    try:
        ngram_events = run_query(conn, """
            SELECT 
                change_reason,
                COUNT(*) as cnt,
                MIN(created_at) as first_at,
                MAX(created_at) as last_at
            FROM optimization_events 
            WHERE (change_reason LIKE '%%ngram%%' OR change_reason LIKE '%%n-gram%%' OR change_reason LIKE '%%Ngram%%' OR action_detail LIKE '%%ngram%%')
              AND created_at >= %s
            GROUP BY change_reason
            ORDER BY cnt DESC
            LIMIT 20
        """, (v338_start,))
        print(f"\nNgram相关事件: {len(ngram_events)}")
        for n in ngram_events:
            print(f"  count={n['cnt']:5d} | {str(n['change_reason'])[:100]} | {n['first_at']} ~ {n['last_at']}")
    except Exception as e:
        print(f"\n⚠ Ngram查询失败: {e}")
    
    # ============================================================
    # 保存结果
    # ============================================================
    output_file = '/home/ubuntu/amazon-ads-optimizer/scripts/v338_analysis_results.json'
    # Convert datetime objects for JSON serialization
    def json_serial(obj):
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        if isinstance(obj, bytes):
            return obj.decode('utf-8')
        from decimal import Decimal
        if isinstance(obj, Decimal):
            return float(obj)
        raise TypeError(f"Type {type(obj)} not serializable")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=json_serial)
    print(f"\n\n✅ 分析结果已保存到: {output_file}")
    
    conn.close()
    print("✅ 数据库连接已关闭")

if __name__ == '__main__':
    main()
