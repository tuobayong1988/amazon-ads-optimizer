#!/usr/bin/env python3
"""
V339部署后数据验证脚本 — 使用正确的列名
V339部署时间: 2026-03-06 08:57 UTC
"""
import pymysql
from datetime import datetime

def get_conn():
    return pymysql.connect(
        host='amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com',
        user='admin', password='Mucers2025', database='amazon_ads_optimizer',
        charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=30, read_timeout=120,
    )

def safe(v, default='N/A'):
    return default if v is None else v

def main():
    conn = get_conn()
    cur = conn.cursor()
    now = datetime.utcnow()
    deploy_time = '2026-03-06 08:57:00'
    hours_since = (now - datetime(2026, 3, 6, 8, 57)).total_seconds() / 3600

    print("=" * 100)
    print(f"V339 部署后数据验证报告")
    print(f"当前UTC时间: {now.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"V339部署时间: {deploy_time} UTC")
    print(f"部署后经过时间: {hours_since:.1f} 小时")
    print("=" * 100)

    # ===== 1. 确认V339正在运行 =====
    print("\n" + "=" * 100)
    print("【1】确认V339正在运行（最近心跳）")
    print("=" * 100)
    cur.execute("""
        SELECT algorithm_version, status, LEFT(change_reason, 150) as reason, created_at 
        FROM optimization_events 
        WHERE change_reason LIKE '%%heartbeat%%'
        ORDER BY created_at DESC LIMIT 5
    """)
    for h in cur.fetchall():
        print(f"  [{h['created_at']}] 版本:{safe(h['algorithm_version'])} | {safe(h['reason'])}")

    # ===== 2. V339部署后的PostDeploy和同步事件 =====
    print("\n" + "=" * 100)
    print("【2】V339部署后的关键事件")
    print("=" * 100)
    cur.execute("""
        SELECT action_type, status, algorithm_version,
               LEFT(change_reason, 200) as reason, created_at 
        FROM optimization_events 
        WHERE created_at >= %s
        AND change_reason NOT LIKE '%%heartbeat%%'
        ORDER BY created_at ASC LIMIT 30
    """, (deploy_time,))
    events = cur.fetchall()
    if events:
        for e in events:
            print(f"  [{e['created_at']}] {safe(e['action_type'])} | v{safe(e['algorithm_version'])} | "
                  f"{safe(e['status'])} | {safe(e['reason'], '')[:150]}")
    else:
        print("  ⚠️ V339部署后暂无非心跳事件")

    # ===== 3. 各层级数据的时间范围（核心验证） =====
    print("\n" + "=" * 100)
    print("【3】各层级数据的实际时间范围（核心验证 — 对比V338基线）")
    print("=" * 100)

    # V338基线（2026-03-06审计时的数据）
    v338_baseline = {
        'daily_performance': {'90021': 62, '90023': 50, '90027': 49},
        'search_terms': {'90021': 33, '90023': 33, '90027': 49},
        'placement_performance': {'90021': 50, '90023': 50, '90027': 49},
    }

    # 表名, 日期列, 账户列, 标签, 目标天数, 时间戳列(用于区分V339前后)
    tables = [
        ('daily_performance', 'date', 'accountId', '广告活动级绩效', 90, 'updatedAt'),
        ('search_terms', 'reportStartDate', 'accountId', '搜索词报告', 90, 'updatedAt'),
        ('placement_performance', 'date', 'accountId', '广告位绩效', 90, 'updatedAt'),
        ('auto_targeting_performance', 'date', 'campaign_id', '自动定向绩效', 90, 'created_at'),
    ]

    for table, date_col, acct_col, label, target_days, ts_col in tables:
        print(f"\n  --- {label} ({table}) [目标: {target_days}天] ---")
        try:
            cur.execute(f"""
                SELECT {acct_col} as acct,
                       MIN({date_col}) as earliest,
                       MAX({date_col}) as latest,
                       COUNT(DISTINCT {date_col}) as date_count,
                       COUNT(*) as total_rows,
                       DATEDIFF(CURDATE(), MIN({date_col})) as days_span
                FROM {table}
                GROUP BY {acct_col}
                ORDER BY {acct_col}
            """)
            rows = cur.fetchall()
            if rows:
                for r in rows:
                    acct = str(safe(r['acct']))
                    days = int(safe(r['days_span'], 0))
                    target_met = '✅ 达标' if days >= target_days - 3 else '⚠️ 未达标'

                    baseline_days = v338_baseline.get(table, {}).get(acct, None)
                    if baseline_days is not None:
                        delta = days - baseline_days
                        if delta > 0:
                            delta_str = f"(V338:{baseline_days}天 → V339:{days}天, 📈 +{delta}天)"
                        elif delta == 0:
                            delta_str = f"(V338:{baseline_days}天 → V339:{days}天, ➡️ 无变化)"
                        else:
                            delta_str = f"(V338:{baseline_days}天 → V339:{days}天, 📉 {delta}天)"
                    else:
                        delta_str = "(无V338基线)"

                    print(f"    账户{acct}: {safe(r['earliest'])} ~ {safe(r['latest'])}, "
                          f"跨度{days}天, {safe(r['date_count'])}个日期, {safe(r['total_rows'])}行 "
                          f"{target_met} {delta_str}")
            else:
                print(f"    ⚠️ 无数据")
        except Exception as e:
            print(f"    ❌ 查询失败: {e}")

    # ===== 4. V339部署后新增/更新的数据 =====
    print("\n" + "=" * 100)
    print("【4】V339部署后新增/更新的数据量")
    print("=" * 100)

    for table, date_col, acct_col, label, target_days, ts_col in tables:
        print(f"\n  --- {label} ({table}) ---")
        try:
            cur.execute(f"""
                SELECT {acct_col} as acct,
                       COUNT(*) as new_rows,
                       MIN({date_col}) as earliest_report,
                       MAX({date_col}) as latest_report,
                       COUNT(DISTINCT {date_col}) as date_count
                FROM {table}
                WHERE {ts_col} >= %s
                GROUP BY {acct_col}
                ORDER BY {acct_col}
            """, (deploy_time,))
            rows = cur.fetchall()
            if rows:
                for r in rows:
                    print(f"    账户{safe(r['acct'])}: V339后新增/更新 {safe(r['new_rows'])} 行, "
                          f"报告日期 {safe(r['earliest_report'])} ~ {safe(r['latest_report'])}, "
                          f"覆盖 {safe(r['date_count'])} 个日期")
            else:
                print(f"    ⚠️ V339部署后无新增数据（full tier同步可能尚未执行）")
        except Exception as e:
            print(f"    ❌ 查询失败: {e}")

    # ===== 5. 搜索词日期分布详情 =====
    print("\n" + "=" * 100)
    print("【5】搜索词数据日期分布详情（V339核心修复目标）")
    print("=" * 100)
    try:
        cur.execute("""
            SELECT accountId as acct, reportStartDate as rd, COUNT(*) as cnt
            FROM search_terms
            GROUP BY accountId, reportStartDate
            ORDER BY accountId, reportStartDate
        """)
        rows = cur.fetchall()
        if rows:
            current_acct = None
            for r in rows:
                if r['acct'] != current_acct:
                    current_acct = r['acct']
                    print(f"\n    账户{current_acct}:")
                print(f"      {r['rd']}: {r['cnt']}行")
    except Exception as e:
        print(f"    ❌ 查询失败: {e}")

    # ===== 6. 总结 =====
    print("\n" + "=" * 100)
    print("【6】验证总结")
    print("=" * 100)
    print(f"  V339部署后已过: {hours_since:.1f} 小时")
    print(f"  V339核心修复: 为9个同步方法增加31天分批处理逻辑")
    if hours_since < 1:
        print(f"\n  ⚠️ 重要: V339刚部署不到1小时")
        print(f"     - 快速同步(fast tier): 每30分钟，仅拉取最近14天")
        print(f"     - 完整同步(full tier): 每6-12小时，拉取90天 ← V339修复的关键")
        print(f"     - 建议: 等待至少6小时后再次验证数据时间范围是否扩展到90天")
    elif hours_since < 6:
        print(f"\n  ⚠️ 部署后不到6小时，full tier同步可能尚未执行")
    else:
        print(f"\n  ✅ 部署已超过6小时，full tier同步应已执行")

    cur.close()
    conn.close()

if __name__ == '__main__':
    main()
