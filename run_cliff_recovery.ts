/**
 * 独立数据断崖恢复脚本
 * 
 * 基于 bid_performance_history 中的历史 CPC 数据，
 * 将出价低于历史 CPC 80% 的关键词恢复到历史 CPC 的 85%
 * 
 * 使用阶梯式恢复策略，单次最大提价 30%
 */

import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL || 'mysql://admin:Mucers2025@amazon-ads-db-new.cmlwa8ie0y7a.us-east-1.rds.amazonaws.com/amazon_ads_optimizer';

interface CliffKeyword {
  id: number;
  keywordText: string;
  matchType: string;
  currentBid: number;
  histCPC: number;
  histOrders: number;
  latestOrderDate: string;
  recoveryBid: number;
}

async function main() {
  const accountId = parseInt(process.argv[2] || '90021');
  console.log(`\n========== 数据断崖恢复 (accountId=${accountId}) ==========\n`);

  const connection = await mysql.createConnection(DB_URL);

  try {
    // 1. 识别数据断崖关键词
    const [cliffRows] = await connection.execute(`
      SELECT 
        k.id,
        k.keywordText,
        k.matchType,
        k.bid as currentBid,
        hist.avg_cpc as histCPC,
        hist.total_orders as histOrders,
        hist.latest_order_date as latestOrderDate
      FROM keywords k
      INNER JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
      INNER JOIN (
        SELECT bidObjectId,
          SUM(orders) as total_orders,
          ROUND(SUM(spend)/NULLIF(SUM(clicks),0), 2) as avg_cpc,
          MAX(date) as latest_order_date
        FROM bid_performance_history
        WHERE accountId = ? AND bidObjectType = 'keyword' AND orders > 0
        GROUP BY bidObjectId
      ) hist ON hist.bidObjectId = CAST(k.id AS CHAR)
      WHERE k.accountId = ? AND k.keywordStatus = 'enabled'
        AND k.bid < hist.avg_cpc * 0.8
      ORDER BY hist.total_orders DESC
    `, [accountId, accountId]);

    const cliffs = (cliffRows as any[]).map(row => {
      const currentBid = parseFloat(row.currentBid);
      const histCPC = parseFloat(row.histCPC);
      // 阶梯式恢复：目标 = 历史CPC × 85%
      const targetBid = histCPC * 0.85;
      // 单次最大提价 30%
      const maxBid = currentBid * 1.30;
      const recoveryBid = Math.round(Math.min(targetBid, maxBid) * 100) / 100;

      return {
        id: row.id,
        keywordText: row.keywordText,
        matchType: row.matchType,
        currentBid,
        histCPC,
        histOrders: row.histOrders,
        latestOrderDate: row.latestOrderDate,
        recoveryBid,
      } as CliffKeyword;
    });

    console.log(`检测到 ${cliffs.length} 个数据断崖关键词:\n`);

    if (cliffs.length === 0) {
      console.log('没有检测到需要恢复的关键词');
      return;
    }

    // 2. 显示恢复计划
    console.log('ID      | 关键词                          | 当前出价 | 历史CPC | 恢复出价 | 历史订单 | 最后出单');
    console.log('--------|--------------------------------|---------|---------|---------|---------|----------');
    for (const cliff of cliffs) {
      console.log(
        `${String(cliff.id).padEnd(8)}| ${cliff.keywordText.padEnd(32).slice(0, 32)}| $${cliff.currentBid.toFixed(2).padEnd(6)} | $${cliff.histCPC.toFixed(2).padEnd(6)} | $${cliff.recoveryBid.toFixed(2).padEnd(6)} | ${String(cliff.histOrders).padEnd(8)}| ${cliff.latestOrderDate}`
      );
    }

    // 3. 执行恢复
    console.log(`\n开始执行恢复...\n`);
    let recovered = 0;
    let skipped = 0;

    for (const cliff of cliffs) {
      if (cliff.recoveryBid <= cliff.currentBid) {
        console.log(`  跳过 ${cliff.keywordText} (${cliff.matchType}): 恢复出价 $${cliff.recoveryBid} <= 当前出价 $${cliff.currentBid}`);
        skipped++;
        continue;
      }

      // 更新出价
      await connection.execute(
        `UPDATE keywords SET bid = ? WHERE id = ? AND accountId = ?`,
        [cliff.recoveryBid, cliff.id, accountId]
      );

      // 记录优化事件
      const bidChangePct = ((cliff.recoveryBid / cliff.currentBid - 1) * 100).toFixed(1);
      await connection.execute(
        `INSERT INTO optimization_events (
          account_id, event_category, action_type, status,
          keyword_id, keyword_text, match_type,
          previous_bid, new_bid, bid_change_percent,
          change_reason, action_detail, api_sync_status, created_at
        ) VALUES (?, 'cliff_recovery', 'keyword_bid_restore', 'success',
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, 'pending', NOW())`,
        [
          accountId,
          cliff.id,
          cliff.keywordText,
          cliff.matchType,
          cliff.currentBid,
          cliff.recoveryBid,
          bidChangePct,
          `[v521断崖修复] 订单断崖恢复: $${cliff.currentBid.toFixed(2)}→$${cliff.recoveryBid.toFixed(2)} (历史CPC=$${cliff.histCPC}, 历史订单=${cliff.histOrders})`,
          JSON.stringify({
            severity: cliff.histOrders >= 10 ? 'critical' : cliff.histOrders >= 4 ? 'high' : 'medium',
            histCPC: cliff.histCPC,
            histOrders: cliff.histOrders,
            latestOrderDate: cliff.latestOrderDate,
            bidChangePercent: bidChangePct,
            recoveryStrategy: 'step1_85pct_of_hist_cpc',
          }),
        ]
      );

      console.log(`  ✓ ${cliff.keywordText} (${cliff.matchType}): $${cliff.currentBid.toFixed(2)} → $${cliff.recoveryBid.toFixed(2)} (+${((cliff.recoveryBid / cliff.currentBid - 1) * 100).toFixed(1)}%) [历史CPC=$${cliff.histCPC}, 历史订单=${cliff.histOrders}]`);
      recovered++;
    }

    // 4. Also check keywords with high total orders from the keywords table itself that have very low bids
    const [additionalCliffs] = await connection.execute(`
      SELECT 
        k.id, k.keywordText, k.matchType, k.bid as currentBid,
        k.orders as totalOrders, k.clicks as totalClicks,
        ROUND(k.spend / NULLIF(k.clicks, 0), 2) as avgCPC
      FROM keywords k
      INNER JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
      WHERE k.accountId = ? AND k.keywordStatus = 'enabled'
        AND k.orders >= 4
        AND k.clicks >= 20
        AND k.bid < (k.spend / NULLIF(k.clicks, 0)) * 0.8
        AND k.id NOT IN (${cliffs.map(c => c.id).join(',') || '0'})
      ORDER BY k.orders DESC
    `, [accountId]);

    const additionalRows = additionalCliffs as any[];
    if (additionalRows.length > 0) {
      console.log(`\n检测到 ${additionalRows.length} 个额外断崖关键词 (基于累计数据):\n`);
      
      for (const row of additionalRows) {
        const currentBid = parseFloat(row.currentBid);
        const avgCPC = parseFloat(row.avgCPC);
        const targetBid = avgCPC * 0.85;
        const maxBid = currentBid * 1.30;
        const recoveryBid = Math.round(Math.min(targetBid, maxBid) * 100) / 100;

        if (recoveryBid <= currentBid) continue;

        await connection.execute(
          `UPDATE keywords SET bid = ? WHERE id = ? AND accountId = ?`,
          [recoveryBid, row.id, accountId]
        );

        const addBidChangePct = ((recoveryBid / currentBid - 1) * 100).toFixed(1);
        await connection.execute(
          `INSERT INTO optimization_events (
            account_id, event_category, action_type, status,
            keyword_id, keyword_text, match_type,
            previous_bid, new_bid, bid_change_percent,
            change_reason, action_detail, api_sync_status, created_at
          ) VALUES (?, 'cliff_recovery', 'keyword_bid_restore', 'success',
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, 'pending', NOW())`,
          [
            accountId,
            row.id,
            row.keywordText,
            row.matchType,
            currentBid,
            recoveryBid,
            addBidChangePct,
            `[v521断崖修复] 订单断崖恢复: $${currentBid.toFixed(2)}→$${recoveryBid.toFixed(2)} (avgCPC=$${avgCPC}, 总订单=${row.totalOrders})`,
            JSON.stringify({
              severity: row.totalOrders >= 10 ? 'critical' : 'high',
              avgCPC,
              totalOrders: row.totalOrders,
              totalClicks: row.totalClicks,
              bidChangePercent: addBidChangePct,
              recoveryStrategy: 'step1_85pct_of_avg_cpc',
            }),
          ]
        );

        console.log(`  ✓ ${row.keywordText} (${row.matchType}): $${currentBid.toFixed(2)} → $${recoveryBid.toFixed(2)} (+${((recoveryBid / currentBid - 1) * 100).toFixed(1)}%) [avgCPC=$${avgCPC}, 总订单=${row.totalOrders}]`);
        recovered++;
      }
    }

    console.log(`\n========== 恢复完成 ==========`);
    console.log(`断崖关键词: ${cliffs.length + additionalRows.length}`);
    console.log(`已恢复: ${recovered}`);
    console.log(`已跳过: ${skipped}`);
    console.log(`注意: 恢复的出价已写入数据库，需要等待下一次同步将出价推送到 Amazon API`);

  } finally {
    await connection.end();
  }
}

main().catch(console.error);
