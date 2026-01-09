import { getDb } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('数据库连接失败');
    return;
  }
  
  // 查询最近的同步日志
  const syncLogs = await db.execute(sql`
    SELECT id, accountId, syncType, status, recordsProcessed, errorMessage, 
           createdAt, completedAt
    FROM sync_logs 
    ORDER BY createdAt DESC 
    LIMIT 20
  `);
  console.log('最近同步日志:');
  console.log(JSON.stringify(syncLogs[0], null, 2));
  
  // 查询SP/SB/SD绩效数据的分布
  const perfDistribution = await db.execute(sql`
    SELECT c.campaignType, 
           COUNT(DISTINCT dp.id) as perf_records,
           COUNT(DISTINCT dp.campaignId) as campaigns_with_data,
           MIN(dp.date) as earliest_date,
           MAX(dp.date) as latest_date
    FROM daily_performance dp
    JOIN campaigns c ON dp.campaignId = c.id
    GROUP BY c.campaignType
  `);
  console.log('\n绩效数据分布(按广告类型):');
  console.log(JSON.stringify(perfDistribution[0], null, 2));
  
  // 查询所有绩效数据的总体情况
  const totalPerf = await db.execute(sql`
    SELECT COUNT(*) as total_records,
           COUNT(DISTINCT campaignId) as total_campaigns,
           MIN(date) as earliest_date,
           MAX(date) as latest_date
    FROM daily_performance
  `);
  console.log('\n绩效数据总体情况:');
  console.log(JSON.stringify(totalPerf[0], null, 2));
  
  process.exit(0);
}

main().catch(console.error);
