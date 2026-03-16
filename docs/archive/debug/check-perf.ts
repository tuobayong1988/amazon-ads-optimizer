import { getDb } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('数据库连接失败');
    return;
  }
  
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
  console.log('绩效数据分布(按广告类型):');
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
  
  // 查询SB广告活动是否有绩效数据
  const sbPerf = await db.execute(sql`
    SELECT c.id, c.campaignId, c.campaignName, 
           dp.date, dp.impressions, dp.clicks, dp.spend, dp.sales
    FROM campaigns c
    LEFT JOIN daily_performance dp ON c.id = dp.campaignId
    WHERE c.campaignType = 'sb'
    LIMIT 10
  `);
  console.log('\nSB广告活动绩效数据示例:');
  console.log(JSON.stringify(sbPerf[0], null, 2));
  
  process.exit(0);
}

main().catch(console.error);
