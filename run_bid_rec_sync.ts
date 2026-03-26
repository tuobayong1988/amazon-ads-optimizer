/**
 * Standalone SB/SD Bid Recommendation Sync Script
 * 
 * This script bypasses the full sync pipeline and directly runs the bid recommendation
 * logic for SB and SD keywords/targets using the local recommendation engine.
 * 
 * Usage: npx tsx run_bid_rec_sync.ts [accountId]
 */

import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL || 'mysql://admin:Mucers2025@amazon-ads-db-new.cmlwa8ie0y7a.us-east-1.rds.amazonaws.com:3306/amazon_ads_optimizer';

interface LocalBidRecommendation {
  suggestedBid: number;
  rangeStart: number;
  rangeEnd: number;
  confidence: number;
  source: string;
  sampleSize: number;
  reasoning: string;
}

async function getLocalKeywordBidRecommendation(
  db: mysql.Connection,
  accountId: number,
  campaignType: string,
  targetAcos: number = 0.30,
): Promise<LocalBidRecommendation> {
  // Account-level strategy: use all keywords of the same campaign type in this account
  try {
    const [rows] = await db.execute(
      `SELECT 
        COALESCE(SUM(k.clicks), 0) as totalClicks,
        COALESCE(SUM(k.spend), 0) as totalSpend,
        COALESCE(SUM(k.sales), 0) as totalSales,
        COALESCE(SUM(k.orders), 0) as totalOrders,
        COALESCE(AVG(k.bid), 0) as avgBid,
        COUNT(*) as sampleCount
      FROM keywords k
      INNER JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
      WHERE k.accountId = ? AND c.campaignType = ? AND k.clicks > 0`,
      [accountId, campaignType]
    );
    
    const perf = (rows as any[])[0];
    if (perf && perf.totalClicks > 0 && perf.totalSpend > 0) {
      const avgCpc = perf.totalSpend / perf.totalClicks;
      const actualAcos = perf.totalSales > 0 ? perf.totalSpend / perf.totalSales : 1.0;
      const acosAdjustment = actualAcos > 0 ? targetAcos / actualAcos : 1.0;
      const confidence = Math.min(perf.sampleCount / 100, 1.0) * Math.min(perf.totalClicks / 500, 1.0);
      let suggestedBid = avgCpc * Math.min(Math.max(acosAdjustment, 0.3), 3.0);
      suggestedBid = Math.max(suggestedBid, 0.10);
      suggestedBid = Math.min(suggestedBid, 50.0);
      
      return {
        suggestedBid: Math.round(suggestedBid * 100) / 100,
        rangeStart: Math.round(suggestedBid * 0.5 * 100) / 100,
        rangeEnd: Math.round(suggestedBid * 1.5 * 100) / 100,
        confidence: Math.round(confidence * 100) / 100,
        source: `account_${campaignType}`,
        sampleSize: perf.sampleCount,
        reasoning: `Account-level ${campaignType}: avgCPC=$${avgCpc.toFixed(2)}, actualACOS=${(actualAcos*100).toFixed(1)}%, targetACOS=${(targetAcos*100).toFixed(1)}%`
      };
    }
  } catch (err) {
    console.log(`  Account-level ${campaignType} strategy failed: ${(err as Error).message}`);
  }

  // Cross-type fallback: use SP data if SB/SD has insufficient data
  if (campaignType !== 'sp_manual') {
    try {
      const [rows] = await db.execute(
        `SELECT 
          COALESCE(SUM(k.clicks), 0) as totalClicks,
          COALESCE(SUM(k.spend), 0) as totalSpend,
          COALESCE(SUM(k.sales), 0) as totalSales,
          COALESCE(AVG(k.bid), 0) as avgBid,
          COUNT(*) as sampleCount
        FROM keywords k
        INNER JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
        WHERE k.accountId = ? AND c.campaignType = 'sp_manual' AND k.clicks > 0`,
        [accountId]
      );
      
      const perf = (rows as any[])[0];
      if (perf && perf.totalClicks > 0 && perf.totalSpend > 0) {
        const avgCpc = perf.totalSpend / perf.totalClicks;
        const actualAcos = perf.totalSales > 0 ? perf.totalSpend / perf.totalSales : 1.0;
        const acosAdjustment = actualAcos > 0 ? targetAcos / actualAcos : 1.0;
        const confidence = Math.min(perf.sampleCount / 100, 1.0) * Math.min(perf.totalClicks / 500, 1.0) * 0.7;
        let suggestedBid = avgCpc * Math.min(Math.max(acosAdjustment, 0.3), 3.0);
        suggestedBid = Math.max(suggestedBid, 0.10);
        suggestedBid = Math.min(suggestedBid, 50.0);
        
        return {
          suggestedBid: Math.round(suggestedBid * 100) / 100,
          rangeStart: Math.round(suggestedBid * 0.5 * 100) / 100,
          rangeEnd: Math.round(suggestedBid * 1.5 * 100) / 100,
          confidence: Math.round(confidence * 100) / 100,
          source: 'cross_type_sp_fallback',
          sampleSize: perf.sampleCount,
          reasoning: `Cross-type SP fallback: avgCPC=$${avgCpc.toFixed(2)}, actualACOS=${(actualAcos*100).toFixed(1)}%`
        };
      }
    } catch (err) {
      console.log(`  Cross-type SP fallback failed: ${(err as Error).message}`);
    }
  }

  return {
    suggestedBid: 0.75,
    rangeStart: 0.30,
    rangeEnd: 1.50,
    confidence: 0.10,
    source: 'minimum_default',
    sampleSize: 0,
    reasoning: 'No sufficient data available'
  };
}

async function syncBidRecommendations(accountId: number) {
  console.log(`\n========================================`);
  console.log(`Starting bid recommendation sync for account ${accountId}`);
  console.log(`========================================\n`);

  const conn = await mysql.createConnection(DB_URL);
  
  try {
    // ========== SB Keywords ==========
    console.log('--- SB Keywords Bid Recommendations ---');
    const [sbKeywords] = await conn.execute(
      `SELECT k.id, k.campaignId, k.keywordText, k.matchType, k.bid, k.suggestedBid
       FROM keywords k
       INNER JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
       WHERE k.accountId = ? AND c.campaignType = 'sb' AND k.keywordStatus = 'enabled'`,
      [accountId]
    );
    
    const sbKwList = sbKeywords as any[];
    console.log(`Found ${sbKwList.length} SB keywords`);
    
    if (sbKwList.length > 0) {
      // Get local recommendation for SB type
      const sbRec = await getLocalKeywordBidRecommendation(conn, accountId, 'sb', 0.30);
      console.log(`SB recommendation: $${sbRec.suggestedBid} (source: ${sbRec.source}, confidence: ${sbRec.confidence})`);
      console.log(`  Reasoning: ${sbRec.reasoning}`);
      
      if (sbRec.source === 'minimum_default') {
        // Try cross-type fallback
        console.log('  SB data insufficient, trying cross-type SP fallback...');
        const spRec = await getLocalKeywordBidRecommendation(conn, accountId, 'sp_manual', 0.30);
        if (spRec.source !== 'minimum_default') {
          console.log(`  SP fallback: $${spRec.suggestedBid} (source: ${spRec.source})`);
          // Apply SP-based recommendation with a 0.7x discount for cross-type
          const adjustedBid = Math.round(spRec.suggestedBid * 100) / 100;
          const [result] = await conn.execute(
            `UPDATE keywords k
             INNER JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
             SET k.suggestedBid = ?, k.suggested_bid_low = ?, k.suggested_bid_high = ?
             WHERE k.accountId = ? AND c.campaignType = 'sb' AND k.keywordStatus = 'enabled'`,
            [adjustedBid, spRec.rangeStart, spRec.rangeEnd, accountId]
          );
          console.log(`  Updated ${(result as any).affectedRows} SB keywords with SP-based recommendation`);
        } else {
          console.log('  SP fallback also returned minimum_default, skipping');
        }
      } else {
        // Apply SB recommendation directly
        const [result] = await conn.execute(
          `UPDATE keywords k
           INNER JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
           SET k.suggestedBid = ?, k.suggested_bid_low = ?, k.suggested_bid_high = ?
           WHERE k.accountId = ? AND c.campaignType = 'sb' AND k.keywordStatus = 'enabled'`,
          [sbRec.suggestedBid, sbRec.rangeStart, sbRec.rangeEnd, accountId]
        );
        console.log(`  Updated ${(result as any).affectedRows} SB keywords`);
      }
    }

    // ========== SD Targets ==========
    console.log('\n--- SD Product Targets Bid Recommendations ---');
    const [sdTargets] = await conn.execute(
      `SELECT pt.id, pt.campaignId, pt.bid, pt.suggestedBid
       FROM product_targets pt
       INNER JOIN campaigns c ON pt.campaignId = c.campaignId AND pt.accountId = c.accountId
       WHERE pt.accountId = ? AND c.campaignType = 'sd' AND pt.targetStatus = 'enabled'`,
      [accountId]
    );
    
    const sdTgtList = sdTargets as any[];
    console.log(`Found ${sdTgtList.length} SD product targets`);
    
    if (sdTgtList.length > 0) {
      const sdRec = await getLocalKeywordBidRecommendation(conn, accountId, 'sd', 0.30);
      console.log(`SD recommendation: $${sdRec.suggestedBid} (source: ${sdRec.source}, confidence: ${sdRec.confidence})`);
      
      if (sdRec.source !== 'minimum_default') {
        const [result] = await conn.execute(
          `UPDATE product_targets pt
           INNER JOIN campaigns c ON pt.campaignId = c.campaignId AND pt.accountId = c.accountId
           SET pt.suggestedBid = ?, pt.suggested_bid_low = ?, pt.suggested_bid_high = ?
           WHERE pt.accountId = ? AND c.campaignType = 'sd' AND pt.targetStatus = 'enabled'`,
          [sdRec.suggestedBid, sdRec.rangeStart, sdRec.rangeEnd, accountId]
        );
        console.log(`  Updated ${(result as any).affectedRows} SD targets`);
      } else {
        // Try cross-type SP fallback for SD
        const spRec = await getLocalKeywordBidRecommendation(conn, accountId, 'sp_manual', 0.30);
        if (spRec.source !== 'minimum_default') {
          const [result] = await conn.execute(
            `UPDATE product_targets pt
             INNER JOIN campaigns c ON pt.campaignId = c.campaignId AND pt.accountId = c.accountId
             SET pt.suggestedBid = ?, pt.suggested_bid_low = ?, pt.suggested_bid_high = ?
             WHERE pt.accountId = ? AND c.campaignType = 'sd' AND pt.targetStatus = 'enabled'`,
            [spRec.suggestedBid, spRec.rangeStart, spRec.rangeEnd, accountId]
          );
          console.log(`  Updated ${(result as any).affectedRows} SD targets with SP fallback`);
        }
      }
    }

    // ========== SB Product Targets ==========
    console.log('\n--- SB Product Targets Bid Recommendations ---');
    const [sbTargets] = await conn.execute(
      `SELECT pt.id, pt.campaignId, pt.bid, pt.suggestedBid
       FROM product_targets pt
       INNER JOIN campaigns c ON pt.campaignId = c.campaignId AND pt.accountId = c.accountId
       WHERE pt.accountId = ? AND c.campaignType = 'sb' AND pt.targetStatus = 'enabled'`,
      [accountId]
    );
    
    const sbTgtList = sbTargets as any[];
    console.log(`Found ${sbTgtList.length} SB product targets`);
    
    if (sbTgtList.length > 0) {
      // Reuse the SB recommendation from above or recalculate
      const sbRec = await getLocalKeywordBidRecommendation(conn, accountId, 'sb', 0.30);
      if (sbRec.source !== 'minimum_default') {
        const [result] = await conn.execute(
          `UPDATE product_targets pt
           INNER JOIN campaigns c ON pt.campaignId = c.campaignId AND pt.accountId = c.accountId
           SET pt.suggestedBid = ?, pt.suggested_bid_low = ?, pt.suggested_bid_high = ?
           WHERE pt.accountId = ? AND c.campaignType = 'sb' AND pt.targetStatus = 'enabled'`,
          [sbRec.suggestedBid, sbRec.rangeStart, sbRec.rangeEnd, accountId]
        );
        console.log(`  Updated ${(result as any).affectedRows} SB targets`);
      } else {
        const spRec = await getLocalKeywordBidRecommendation(conn, accountId, 'sp_manual', 0.30);
        if (spRec.source !== 'minimum_default') {
          const [result] = await conn.execute(
            `UPDATE product_targets pt
             INNER JOIN campaigns c ON pt.campaignId = c.campaignId AND pt.accountId = c.accountId
             SET pt.suggestedBid = ?, pt.suggested_bid_low = ?, pt.suggested_bid_high = ?
             WHERE pt.accountId = ? AND c.campaignType = 'sb' AND pt.targetStatus = 'enabled'`,
            [spRec.suggestedBid, spRec.rangeStart, spRec.rangeEnd, accountId]
          );
          console.log(`  Updated ${(result as any).affectedRows} SB targets with SP fallback`);
        }
      }
    }

    // ========== Verify Fill Rates ==========
    console.log('\n========== Final Fill Rate Verification ==========');
    const [fillRates] = await conn.execute(
      `SELECT 
        c.campaignType,
        'keywords' as entity,
        COUNT(*) as total,
        SUM(k.suggestedBid > 0) as with_bid,
        ROUND(SUM(k.suggestedBid > 0) / COUNT(*) * 100, 1) as fill_rate
      FROM keywords k
      INNER JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
      WHERE k.accountId = ? AND k.keywordStatus = 'enabled'
      GROUP BY c.campaignType
      UNION ALL
      SELECT 
        c.campaignType,
        'targets' as entity,
        COUNT(*) as total,
        SUM(pt.suggestedBid > 0) as with_bid,
        ROUND(SUM(pt.suggestedBid > 0) / COUNT(*) * 100, 1) as fill_rate
      FROM product_targets pt
      INNER JOIN campaigns c ON pt.campaignId = c.campaignId AND pt.accountId = c.accountId
      WHERE pt.accountId = ? AND pt.targetStatus = 'enabled'
      GROUP BY c.campaignType`,
      [accountId, accountId]
    );
    
    console.log('\nFill Rate Results:');
    console.log('Campaign Type | Entity   | Total | With Bid | Fill Rate');
    console.log('------------- | -------- | ----- | -------- | ---------');
    for (const row of fillRates as any[]) {
      console.log(`${row.campaignType.padEnd(13)} | ${row.entity.padEnd(8)} | ${String(row.total).padEnd(5)} | ${String(row.with_bid || 0).padEnd(8)} | ${row.fill_rate || 0}%`);
    }

  } finally {
    await conn.end();
  }
  
  console.log('\n========================================');
  console.log('Bid recommendation sync completed!');
  console.log('========================================\n');
}

// Run for specified accounts
const accountIds = process.argv.slice(2).map(Number).filter(n => n > 0);
const defaultAccounts = [90021, 90023]; // ElaraFit CA and US

const targets = accountIds.length > 0 ? accountIds : defaultAccounts;

(async () => {
  for (const accountId of targets) {
    await syncBidRecommendations(accountId);
  }
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
