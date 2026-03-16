/**
 * 紧急出价修正脚本
 * 
 * 功能：
 * 1. 查找所有超过max_bid限制的enabled关键词
 * 2. 在数据库中将出价降低到max_bid
 * 3. 通过Amazon SP API同步出价到Amazon
 * 
 * 使用方式：npx tsx emergency_bid_fix.ts
 */

import { createAmazonAdsClient, type AmazonApiCredentials } from './server/sync/amazonAdsApi';
import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: 'amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com',
  user: 'admin',
  password: 'Mucers2025',
  database: 'amazon_ads_optimizer',
};

interface OverBidKeyword {
  id: number;
  keywordText: string;
  keywordId: string | null;
  bid: number;
  adGroupId: number;
  campaignId: number;
  campaignStatus: string;
  performanceGroupId: number;
  performanceGroupName: string;
  maxBid: number;
}

interface ApiCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: string;
}

async function main() {
  console.log('=== 紧急出价修正脚本 v156 ===');
  console.log(`执行时间: ${new Date().toISOString()}`);
  console.log('');

  const conn = await mysql.createConnection(DB_CONFIG);

  try {
    // Step 1: 查找所有超过max_bid的enabled关键词（仅enabled campaign）
    console.log('Step 1: 查找超过max_bid限制的关键词...');
    
    const [overBidRows] = await conn.execute<any[]>(`
      SELECT 
        k.id, k.keywordText, k.keywordId, k.bid, k.adGroupId,
        c.id as campaignId, c.campaignStatus,
        pg.id as performanceGroupId, pg.name as performanceGroupName,
        pg.max_bid as maxBid
      FROM keywords k
      JOIN ad_groups ag ON ag.id = k.adGroupId
      JOIN campaigns c ON c.id = ag.campaignId
      JOIN performance_groups pg ON pg.id = c.performanceGroupId
      WHERE pg.status = 'active'
        AND pg.max_bid IS NOT NULL
        AND k.bid > pg.max_bid
        AND k.keywordStatus = 'enabled'
        AND c.campaignStatus = 'enabled'
      ORDER BY pg.id, k.bid DESC
    `);

    console.log(`找到 ${overBidRows.length} 个enabled campaign中超过max_bid限制的关键词`);
    
    // 也查找paused campaign中的超限关键词（仅修正数据库，不同步API）
    const [pausedOverBidRows] = await conn.execute<any[]>(`
      SELECT 
        k.id, k.keywordText, k.keywordId, k.bid, k.adGroupId,
        c.id as campaignId, c.campaignStatus,
        pg.id as performanceGroupId, pg.name as performanceGroupName,
        pg.max_bid as maxBid
      FROM keywords k
      JOIN ad_groups ag ON ag.id = k.adGroupId
      JOIN campaigns c ON c.id = ag.campaignId
      JOIN performance_groups pg ON pg.id = c.performanceGroupId
      WHERE pg.status = 'active'
        AND pg.max_bid IS NOT NULL
        AND k.bid > pg.max_bid
        AND k.keywordStatus = 'enabled'
        AND c.campaignStatus != 'enabled'
      ORDER BY pg.id, k.bid DESC
    `);

    console.log(`找到 ${pausedOverBidRows.length} 个paused campaign中超过max_bid限制的关键词（仅修正数据库）`);
    console.log('');

    // Step 2: 按优化目标分组统计
    const groupStats: Record<number, { name: string; maxBid: number; count: number; enabledCount: number; pausedCount: number }> = {};
    
    for (const kw of [...overBidRows, ...pausedOverBidRows]) {
      if (!groupStats[kw.performanceGroupId]) {
        groupStats[kw.performanceGroupId] = {
          name: kw.performanceGroupName,
          maxBid: parseFloat(kw.maxBid),
          count: 0,
          enabledCount: 0,
          pausedCount: 0,
        };
      }
      groupStats[kw.performanceGroupId].count++;
      if (kw.campaignStatus === 'enabled') {
        groupStats[kw.performanceGroupId].enabledCount++;
      } else {
        groupStats[kw.performanceGroupId].pausedCount++;
      }
    }

    console.log('Step 2: 按优化目标分组统计:');
    for (const [pgId, stats] of Object.entries(groupStats)) {
      console.log(`  [${pgId}] ${stats.name}: max_bid=$${stats.maxBid}, 超限=${stats.count} (enabled=${stats.enabledCount}, paused=${stats.pausedCount})`);
    }
    console.log('');

    // Step 3: 获取API凭证（按accountId分组）
    console.log('Step 3: 获取Amazon API凭证...');
    const [credRows] = await conn.execute<any[]>(`
      SELECT accountId, clientId, clientSecret, refreshToken, profileId, region
      FROM amazon_api_credentials
      WHERE accountId IN (
        SELECT DISTINCT c.accountId 
        FROM campaigns c 
        JOIN performance_groups pg ON pg.id = c.performanceGroupId 
        WHERE pg.status = 'active' AND c.campaignStatus = 'enabled'
      )
    `);

    const credMap: Record<number, ApiCredentials> = {};
    for (const cred of credRows) {
      credMap[cred.accountId] = {
        clientId: cred.clientId,
        clientSecret: cred.clientSecret,
        refreshToken: cred.refreshToken,
        profileId: cred.profileId,
        region: cred.region || 'NA',
      };
    }
    console.log(`获取到 ${Object.keys(credMap).length} 个账号的API凭证`);
    console.log('');

    // Step 4: 对enabled campaign的关键词执行降价并同步到Amazon
    console.log('Step 4: 对enabled campaign的关键词执行降价...');
    
    let dbUpdated = 0;
    let apiSynced = 0;
    let apiFailed = 0;
    let missingKeywordId = 0;

    // 按accountId分组enabled关键词
    const kwByAccount: Record<number, OverBidKeyword[]> = {};
    for (const kw of overBidRows) {
      // 获取accountId
      const [campRows] = await conn.execute<any[]>(
        'SELECT accountId FROM campaigns WHERE id = ?', [kw.campaignId]
      );
      if (campRows.length > 0) {
        const accountId = campRows[0].accountId;
        if (!kwByAccount[accountId]) kwByAccount[accountId] = [];
        kwByAccount[accountId].push(kw);
      }
    }

    for (const [accountIdStr, keywords] of Object.entries(kwByAccount)) {
      const accountId = parseInt(accountIdStr);
      const cred = credMap[accountId];
      
      if (!cred) {
        console.log(`  ⚠️ 账号 ${accountId} 没有API凭证，跳过API同步，仅更新数据库`);
        // 仅更新数据库
        for (const kw of keywords) {
          const maxBid = parseFloat(kw.maxBid as any);
          await conn.execute('UPDATE keywords SET bid = ? WHERE id = ?', [maxBid, kw.id]);
          dbUpdated++;
        }
        continue;
      }

      console.log(`  处理账号 ${accountId}: ${keywords.length} 个关键词需要降价`);
      
      // 创建Amazon API客户端
      const client = createAmazonAdsClient({
        clientId: cred.clientId,
        clientSecret: cred.clientSecret,
        refreshToken: cred.refreshToken,
        profileId: cred.profileId,
        region: cred.region,
      });

      // 批量处理 - 每批最多1000个
      const batchSize = 1000;
      for (let i = 0; i < keywords.length; i += batchSize) {
        const batch = keywords.slice(i, i + batchSize);
        
        // 准备API更新数据
        const apiUpdates: Array<{ keywordId: string; bid: number }> = [];
        const dbUpdateIds: Array<{ id: number; maxBid: number }> = [];
        
        for (const kw of batch) {
          const maxBid = parseFloat(kw.maxBid as any);
          dbUpdateIds.push({ id: kw.id, maxBid });
          
          if (kw.keywordId && kw.keywordId.trim() !== '' && kw.keywordId !== '0') {
            apiUpdates.push({
              keywordId: kw.keywordId,
              bid: maxBid,
            });
          } else {
            missingKeywordId++;
          }
        }

        // 更新数据库
        for (const item of dbUpdateIds) {
          await conn.execute('UPDATE keywords SET bid = ? WHERE id = ?', [item.maxBid, item.id]);
          dbUpdated++;
        }

        // 同步到Amazon API
        if (apiUpdates.length > 0) {
          try {
            console.log(`    调用Amazon API: 批次 ${Math.floor(i / batchSize) + 1}, ${apiUpdates.length} 个关键词`);
            const result = await client.updateKeywordBids(apiUpdates);
            if (result.success) {
              apiSynced += apiUpdates.length;
              console.log(`    ✅ API同步成功: ${apiUpdates.length} 个关键词`);
            } else {
              apiFailed += result.errors.length;
              apiSynced += apiUpdates.length - result.errors.length;
              console.log(`    ⚠️ API部分失败: 成功=${apiUpdates.length - result.errors.length}, 失败=${result.errors.length}`);
              for (const err of result.errors.slice(0, 5)) {
                console.log(`      错误: keywordId=${err.keywordId}, code=${err.code}, details=${err.details}`);
              }
            }
          } catch (apiErr: any) {
            apiFailed += apiUpdates.length;
            console.error(`    ❌ API调用失败: ${apiErr.message}`);
          }
        }
      }
    }

    // Step 5: 对paused campaign的关键词仅更新数据库
    console.log('');
    console.log('Step 5: 对paused campaign的关键词更新数据库...');
    let pausedDbUpdated = 0;
    for (const kw of pausedOverBidRows) {
      const maxBid = parseFloat(kw.maxBid as any);
      await conn.execute('UPDATE keywords SET bid = ? WHERE id = ?', [maxBid, kw.id]);
      pausedDbUpdated++;
    }
    console.log(`  已更新 ${pausedDbUpdated} 个paused campaign关键词的数据库出价`);

    // Step 6: 记录优化日志
    console.log('');
    console.log('Step 6: 记录优化日志...');
    for (const [pgIdStr, stats] of Object.entries(groupStats)) {
      const pgId = parseInt(pgIdStr);
      await conn.execute(`
        INSERT INTO optimization_logs 
        (performance_group_id, performance_group_name, action_type, details, api_sync_status, created_at)
        VALUES (?, ?, 'emergency_bid_fix', ?, 'synced', NOW())
      `, [
        pgId,
        stats.name,
        JSON.stringify({
          version: 'v156_emergency',
          maxBid: stats.maxBid,
          totalFixed: stats.count,
          enabledFixed: stats.enabledCount,
          pausedFixed: stats.pausedCount,
          timestamp: new Date().toISOString(),
        }),
      ]);
    }

    // 最终报告
    console.log('');
    console.log('=== 紧急出价修正完成 ===');
    console.log(`数据库更新: ${dbUpdated + pausedDbUpdated} 个关键词`);
    console.log(`  - enabled campaign: ${dbUpdated} 个`);
    console.log(`  - paused campaign: ${pausedDbUpdated} 个`);
    console.log(`Amazon API同步: ${apiSynced} 个成功, ${apiFailed} 个失败, ${missingKeywordId} 个缺少keywordId`);
    console.log('');

    // 验证修复结果
    const [verifyRows] = await conn.execute<any[]>(`
      SELECT pg.id, pg.name, pg.max_bid,
        COUNT(CASE WHEN k.bid > pg.max_bid THEN 1 END) as still_over
      FROM performance_groups pg
      JOIN campaigns c ON c.performanceGroupId = pg.id
      JOIN ad_groups ag ON ag.campaignId = c.id
      JOIN keywords k ON k.adGroupId = ag.id AND k.keywordStatus = 'enabled'
      WHERE pg.status = 'active' AND pg.max_bid IS NOT NULL
      GROUP BY pg.id, pg.name, pg.max_bid
    `);
    
    console.log('验证结果:');
    for (const row of verifyRows) {
      console.log(`  [${row.id}] ${row.name}: max_bid=$${row.max_bid}, 仍超限=${row.still_over}`);
    }

  } catch (err: any) {
    console.error('脚本执行失败:', err.message);
    console.error(err.stack);
  } finally {
    await conn.end();
  }
}

main().catch(console.error);
