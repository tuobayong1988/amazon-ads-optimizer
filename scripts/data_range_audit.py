#!/usr/bin/env python3
"""
v338 数据同步时间范围审计脚本
验证生产数据库中各层级数据的实际时间范围，对照代码配置进行校验
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
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=30,
        read_timeout=60,
    )

def run_query(conn, sql, params=None):
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchall()

def safe_int(v):
    return int(v) if v is not None else 0

def audit_table(conn, label, table, date_col, acct_col, expected_days, extra_group_col=None):
    """通用审计函数"""
    print(f"\n{'=' * 70}")
    print(f"{label}")
    print(f"  代码配置目标: {expected_days}天")
    print(f"{'=' * 70}")
    
    group_cols = f"{acct_col}"
    select_extra = ""
    if extra_group_col:
        group_cols += f", {extra_group_col}"
        select_extra = f", {extra_group_col}"
    
    try:
        rows = run_query(conn, f"""
            SELECT 
                {acct_col}{select_extra},
                MIN({date_col}) as earliest_date,
                MAX({date_col}) as latest_date,
                DATEDIFF(MAX({date_col}), MIN({date_col})) as date_span_days,
                COUNT(DISTINCT DATE({date_col})) as distinct_dates,
                COUNT(*) as total_records
            FROM {table}
            GROUP BY {group_cols}
            ORDER BY {acct_col}
        """)
        
        if not rows:
            print(f"  ⚠️ 表为空，无数据")
            return
        
        for r in rows:
            span = safe_int(r['date_span_days'])
            dates = safe_int(r['distinct_dates'])
            records = safe_int(r['total_records'])
            acct = r[acct_col]
            extra_info = f" [{r[extra_group_col]}]" if extra_group_col and r.get(extra_group_col) else ""
            
            print(f"  账户 {acct}{extra_info}: {r['earliest_date']} ~ {r['latest_date']} | 跨度={span}天 | 有效日期={dates}天 | 记录数={records}")
            
            if span >= expected_days - 5:
                print(f"    ✅ 数据跨度{span}天，已达到{expected_days}天目标")
            elif span >= expected_days * 0.5:
                print(f"    ⚠️ 数据跨度{span}天，部分达到{expected_days}天目标（可能是新账户或数据积累中）")
            else:
                print(f"    ❌ 数据跨度仅{span}天，远未达到{expected_days}天目标")
    except Exception as e:
        print(f"  ❌ 查询失败: {e}")

def main():
    conn = get_conn()
    today = datetime.now().strftime('%Y-%m-%d')
    
    print("=" * 80)
    print(f"广告系统数据同步时间范围 — 全面审计报告")
    print(f"审计时间: {today}")
    print("=" * 80)
    
    # ============================================================
    # 1. daily_performance - 广告活动级绩效
    # ============================================================
    audit_table(conn, 
        "1. daily_performance (广告活动级绩效)\n   syncAll()=14天 | unifiedSyncEngine full=90天",
        "daily_performance", "date", "accountId", 90)
    
    # 按ad_type分组查看
    print("\n  --- 按广告类型分组 ---")
    try:
        rows = run_query(conn, """
            SELECT 
                accountId, ad_type,
                MIN(date) as earliest, MAX(date) as latest,
                DATEDIFF(MAX(date), MIN(date)) as span,
                COUNT(DISTINCT DATE(date)) as dates,
                COUNT(*) as records
            FROM daily_performance
            GROUP BY accountId, ad_type
            ORDER BY accountId, ad_type
        """)
        for r in rows:
            ad_type = r['ad_type'] or 'NULL'
            span = safe_int(r['span'])
            print(f"  账户 {r['accountId']} [{ad_type:5s}]: {r['earliest']} ~ {r['latest']} | 跨度={span}天 | 日期数={safe_int(r['dates'])} | 记录={safe_int(r['records'])}")
    except Exception as e:
        print(f"  查询失败: {e}")
    
    # ============================================================
    # 2. search_terms - 搜索词数据
    # ============================================================
    print(f"\n{'=' * 70}")
    print("2. search_terms (搜索词数据)")
    print("   SP=90天 | SB=60天 | 中频同步=7天")
    print(f"{'=' * 70}")
    
    try:
        rows = run_query(conn, """
            SELECT 
                accountId,
                MIN(reportStartDate) as earliest_start,
                MAX(reportEndDate) as latest_end,
                DATEDIFF(MAX(reportEndDate), MIN(reportStartDate)) as date_span_days,
                COUNT(DISTINCT DATE(reportStartDate)) as distinct_start_dates,
                COUNT(*) as total_records,
                MIN(createdAt) as first_sync,
                MAX(createdAt) as last_sync
            FROM search_terms
            GROUP BY accountId
            ORDER BY accountId
        """)
        for r in rows:
            span = safe_int(r['date_span_days'])
            print(f"  账户 {r['accountId']}: 报告范围 {r['earliest_start']} ~ {r['latest_end']} | 跨度={span}天 | 起始日期数={safe_int(r['distinct_start_dates'])} | 记录={safe_int(r['total_records'])}")
            print(f"    首次同步: {r['first_sync']} | 最近同步: {r['last_sync']}")
            if span >= 85:
                print(f"    ✅ 搜索词数据跨度{span}天，已达到90天目标")
            else:
                print(f"    ⚠️ 搜索词数据跨度{span}天，未达到90天目标")
    except Exception as e:
        print(f"  ❌ 查询失败: {e}")
    
    # ============================================================
    # 3. placement_performance - 广告位绩效
    # ============================================================
    audit_table(conn,
        "3. placement_performance (广告位绩效)\n   SP=90天 | SB=60天",
        "placement_performance", "date", "accountId", 90)
    
    # ============================================================
    # 4. auto_targeting_performance - SP自动定向
    # ============================================================
    audit_table(conn,
        "4. auto_targeting_performance (SP自动定向)\n   代码配置: 90天",
        "auto_targeting_performance", "date", "accountId", 90)
    
    # ============================================================
    # 5. hourly_performance - 小时级绩效
    # ============================================================
    audit_table(conn,
        "5. hourly_performance (小时级绩效)\n   从daily_performance生成",
        "hourly_performance", "date", "accountId", 90)
    
    # ============================================================
    # 6. keywords 表 - 关键词结构数据
    # ============================================================
    print(f"\n{'=' * 70}")
    print("6. keywords (关键词结构+绩效)")
    print("   关键词绩效: syncAll=14天 | unifiedSyncEngine=90天")
    print(f"{'=' * 70}")
    
    try:
        rows = run_query(conn, """
            SELECT 
                accountId,
                COUNT(*) as total,
                SUM(CASE WHEN impressions > 0 THEN 1 ELSE 0 END) as with_imp,
                SUM(CASE WHEN clicks > 0 THEN 1 ELSE 0 END) as with_clicks,
                SUM(CASE WHEN spend > 0 THEN 1 ELSE 0 END) as with_spend,
                SUM(CASE WHEN orders > 0 THEN 1 ELSE 0 END) as with_orders,
                MIN(updatedAt) as earliest_update,
                MAX(updatedAt) as latest_update,
                DATEDIFF(MAX(updatedAt), MIN(updatedAt)) as update_span
            FROM keywords
            GROUP BY accountId
        """)
        for r in rows:
            total = safe_int(r['total'])
            with_imp = safe_int(r['with_imp'])
            pct = (with_imp / total * 100) if total > 0 else 0
            print(f"  账户 {r['accountId']}: 总关键词={total} | 有展示={with_imp}({pct:.1f}%) | 有点击={safe_int(r['with_clicks'])} | 有花费={safe_int(r['with_spend'])} | 有订单={safe_int(r['with_orders'])}")
            print(f"    更新范围: {r['earliest_update']} ~ {r['latest_update']} | 跨度={safe_int(r['update_span'])}天")
    except Exception as e:
        print(f"  ❌ 查询失败: {e}")
    
    # ============================================================
    # 7. product_targets 表 - 商品定位结构数据
    # ============================================================
    print(f"\n{'=' * 70}")
    print("7. product_targets (商品定位结构+绩效)")
    print(f"{'=' * 70}")
    
    try:
        rows = run_query(conn, """
            SELECT 
                accountId,
                COUNT(*) as total,
                SUM(CASE WHEN impressions > 0 THEN 1 ELSE 0 END) as with_imp,
                SUM(CASE WHEN spend > 0 THEN 1 ELSE 0 END) as with_spend,
                MIN(updatedAt) as earliest_update,
                MAX(updatedAt) as latest_update
            FROM product_targets
            GROUP BY accountId
        """)
        for r in rows:
            total = safe_int(r['total'])
            with_imp = safe_int(r['with_imp'])
            print(f"  账户 {r['accountId']}: 总定位={total} | 有展示={with_imp} | 有花费={safe_int(r['with_spend'])}")
            print(f"    更新范围: {r['earliest_update']} ~ {r['latest_update']}")
    except Exception as e:
        print(f"  ❌ 查询失败: {e}")
    
    # ============================================================
    # 8. ad_accounts 表 - 最近同步状态
    # ============================================================
    print(f"\n{'=' * 70}")
    print("8. ad_accounts (账户同步状态)")
    print(f"{'=' * 70}")
    
    try:
        rows = run_query(conn, """
            SELECT 
                id, accountName, marketplace,
                lastSyncedAt, lastFullSyncAt,
                syncStatus
            FROM ad_accounts
            ORDER BY lastSyncedAt DESC
        """)
        for r in rows:
            print(f"  账户 {r['id']} [{r['marketplace']}] {r['accountName']}")
            print(f"    最近同步: {r['lastSyncedAt']} | 最近全量: {r['lastFullSyncAt']} | 状态: {r['syncStatus']}")
    except Exception as e:
        print(f"  ❌ 查询失败: {e}")
    
    # ============================================================
    # 9. 关键矛盾分析
    # ============================================================
    print(f"\n{'=' * 70}")
    print("9. 代码配置矛盾分析")
    print(f"{'=' * 70}")
    
    print("""
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ 数据类型              │ syncAll() │ unifiedSyncEngine │ 实际生效路径    │
  ├─────────────────────────────────────────────────────────────────────────┤
  │ 广告活动级绩效        │   14天    │      90天         │ 取决于调用路径  │
  │ 关键词绩效            │   14天    │      90天         │ 取决于调用路径  │
  │ 定位绩效              │   14天    │      90天         │ 取决于调用路径  │
  │ 广告组绩效            │   14天    │      90天         │ 取决于调用路径  │
  │ SP搜索词              │   90天    │      90天         │ 90天 ✅        │
  │ SB搜索词              │   60天    │      60天         │ 60天 ✅        │
  │ SP广告位绩效          │   90天    │      90天         │ 90天 ✅        │
  │ SB广告位绩效          │   60天    │      60天         │ 60天 ✅        │
  │ SP自动定向            │   90天    │      90天         │ 90天 ✅        │
  │ SD定向                │   90天    │      90天         │ 90天 ✅        │
  │ SB定向                │   60天    │      60天         │ 60天 ✅        │
  └─────────────────────────────────────────────────────────────────────────┘
  
  关键发现:
  1. syncAll()中的绩效数据(performanceDays=14)仅请求14天
     - 被accountInitializationService调用（新账户初始化）
     - 被dataSyncScheduler的full tier调用（但实际full tier走unifiedSyncEngine）
  
  2. unifiedSyncEngine的full tier步骤已全部配置为90天
     - 这是生产环境中每30分钟执行的完整同步路径
     - 绩效数据、关键词绩效、定位绩效、广告组绩效均为90天
  
  3. 实际生效分析:
     - 正常运行时: unifiedSyncEngine的90天配置生效 ✅
     - 新账户初始化时: syncAll()的14天配置生效 ⚠️
       → 新账户的绩效数据初始只有14天，需等待下一次full sync才能扩展到90天
     - 中频同步(30分钟): 搜索词仅7天，绩效仅7天（增量更新，合理）
     - 高频同步(15分钟): 绩效仅1天（当日数据，合理）
""")
    
    # ============================================================
    # 10. 验证实际数据覆盖天数
    # ============================================================
    print(f"\n{'=' * 70}")
    print("10. 实际数据覆盖天数验证")
    print(f"{'=' * 70}")
    
    try:
        # daily_performance
        rows = run_query(conn, """
            SELECT 
                accountId,
                DATEDIFF(CURDATE(), MIN(date)) as days_from_earliest,
                DATEDIFF(MAX(date), MIN(date)) as span,
                COUNT(DISTINCT DATE(date)) as dates_count
            FROM daily_performance
            GROUP BY accountId
        """)
        print("\n  daily_performance:")
        for r in rows:
            days = safe_int(r['days_from_earliest'])
            span = safe_int(r['span'])
            print(f"    账户 {r['accountId']}: 最早数据距今={days}天 | 跨度={span}天 | 有效日期={safe_int(r['dates_count'])}")
            if days >= 85:
                print(f"      ✅ 绩效数据已覆盖{days}天前，90天配置已生效")
            elif days >= 12:
                print(f"      ⚠️ 绩效数据仅覆盖{days}天前")
            else:
                print(f"      ❌ 绩效数据仅覆盖{days}天")
        
        # search_terms
        rows = run_query(conn, """
            SELECT 
                accountId,
                DATEDIFF(CURDATE(), MIN(reportStartDate)) as days_from_earliest,
                DATEDIFF(MAX(reportEndDate), MIN(reportStartDate)) as span
            FROM search_terms
            GROUP BY accountId
        """)
        print("\n  search_terms:")
        for r in rows:
            days = safe_int(r['days_from_earliest'])
            span = safe_int(r['span'])
            print(f"    账户 {r['accountId']}: 最早数据距今={days}天 | 跨度={span}天")
            if days >= 85:
                print(f"      ✅ 搜索词数据已覆盖{days}天前")
            else:
                print(f"      ⚠️ 搜索词数据仅覆盖{days}天前")
        
        # placement_performance
        rows = run_query(conn, """
            SELECT 
                accountId,
                DATEDIFF(CURDATE(), MIN(date)) as days_from_earliest,
                DATEDIFF(MAX(date), MIN(date)) as span
            FROM placement_performance
            GROUP BY accountId
        """)
        print("\n  placement_performance:")
        for r in rows:
            days = safe_int(r['days_from_earliest'])
            span = safe_int(r['span'])
            print(f"    账户 {r['accountId']}: 最早数据距今={days}天 | 跨度={span}天")
            if days >= 85:
                print(f"      ✅ 广告位数据已覆盖{days}天前")
            else:
                print(f"      ⚠️ 广告位数据仅覆盖{days}天前")
        
        # auto_targeting_performance
        rows = run_query(conn, """
            SELECT 
                accountId,
                DATEDIFF(CURDATE(), MIN(date)) as days_from_earliest,
                DATEDIFF(MAX(date), MIN(date)) as span
            FROM auto_targeting_performance
            GROUP BY accountId
        """)
        print("\n  auto_targeting_performance:")
        for r in rows:
            days = safe_int(r['days_from_earliest'])
            span = safe_int(r['span'])
            print(f"    账户 {r['accountId']}: 最早数据距今={days}天 | 跨度={span}天")
            if days >= 85:
                print(f"      ✅ 自动定向数据已覆盖{days}天前")
            else:
                print(f"      ⚠️ 自动定向数据仅覆盖{days}天前")
        
        # hourly_performance
        rows = run_query(conn, """
            SELECT 
                accountId,
                DATEDIFF(CURDATE(), MIN(date)) as days_from_earliest,
                DATEDIFF(MAX(date), MIN(date)) as span
            FROM hourly_performance
            GROUP BY accountId
        """)
        print("\n  hourly_performance:")
        for r in rows:
            days = safe_int(r['days_from_earliest'])
            span = safe_int(r['span'])
            print(f"    账户 {r['accountId']}: 最早数据距今={days}天 | 跨度={span}天")
            
    except Exception as e:
        print(f"  ❌ 查询失败: {e}")
    
    # ============================================================
    # 11. 数据密度分析（检查是否有日期空洞）
    # ============================================================
    print(f"\n{'=' * 70}")
    print("11. 数据密度分析（检查日期空洞）")
    print(f"{'=' * 70}")
    
    try:
        rows = run_query(conn, """
            SELECT 
                accountId,
                DATE(date) as report_date,
                COUNT(*) as records,
                SUM(impressions) as total_imp,
                SUM(clicks) as total_clicks,
                SUM(spend) as total_spend
            FROM daily_performance
            WHERE date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
            GROUP BY accountId, DATE(date)
            ORDER BY accountId, DATE(date)
        """)
        
        # 按账户分组分析
        from collections import defaultdict
        by_account = defaultdict(list)
        for r in rows:
            by_account[r['accountId']].append(r)
        
        for acct, dates in by_account.items():
            if not dates:
                continue
            first = dates[0]['report_date']
            last = dates[-1]['report_date']
            expected_days = (last - first).days + 1 if hasattr(first, 'days') else safe_int((last - first).days) + 1
            actual_days = len(dates)
            missing = expected_days - actual_days
            
            print(f"\n  账户 {acct}: {first} ~ {last}")
            print(f"    预期日期数={expected_days} | 实际日期数={actual_days} | 缺失={missing}天")
            
            if missing > 5:
                print(f"    ⚠️ 有{missing}天数据缺失，可能存在同步中断")
                # 找出缺失的日期段
                date_set = set(r['report_date'] for r in dates)
                gaps = []
                current = first
                while current <= last:
                    if current not in date_set:
                        gaps.append(str(current))
                    current += timedelta(days=1)
                if gaps and len(gaps) <= 20:
                    print(f"    缺失日期: {', '.join(gaps[:10])}{'...' if len(gaps) > 10 else ''}")
            else:
                print(f"    ✅ 数据密度良好，无明显缺失")
    except Exception as e:
        print(f"  ❌ 查询失败: {e}")
    
    conn.close()
    print("\n" + "=" * 80)
    print("审计完成")
    print("=" * 80)

if __name__ == '__main__':
    main()
