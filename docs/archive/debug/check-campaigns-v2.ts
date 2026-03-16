import { getDb } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('数据库连接失败');
    return;
  }
  
  // 查询广告活动类型分布
  const result = await db.execute(sql`
    SELECT campaignType, COUNT(*) as count, 
           SUM(CASE WHEN campaignStatus = 'enabled' THEN 1 ELSE 0 END) as enabled_count
    FROM campaigns 
    GROUP BY campaignType
  `);
  console.log('广告活动类型分布:');
  console.log(JSON.stringify(result[0], null, 2));
  
  // 查询SB广告活动详情
  const sbCampaigns = await db.execute(sql`
    SELECT id, campaignId, campaignName, campaignStatus, impressions, clicks, spend, sales
    FROM campaigns 
    WHERE campaignType = 'sb'
    LIMIT 5
  `);
  console.log('\nSB广告活动示例:');
  console.log(JSON.stringify(sbCampaigns[0], null, 2));
  
  // 查询SD广告活动详情
  const sdCampaigns = await db.execute(sql`
    SELECT id, campaignId, campaignName, campaignStatus, impressions, clicks, spend, sales
    FROM campaigns 
    WHERE campaignType = 'sd'
    LIMIT 5
  `);
  console.log('\nSD广告活动示例:');
  console.log(JSON.stringify(sdCampaigns[0], null, 2));
  
  // 查询SB/SD的绩效数据
  const sbSdPerformance = await db.execute(sql`
    SELECT c.campaignType, COUNT(DISTINCT dp.campaignId) as campaigns_with_data,
           SUM(dp.impressions) as total_impressions,
           SUM(dp.clicks) as total_clicks,
           SUM(CAST(dp.spend AS DECIMAL(10,2))) as total_spend,
           SUM(CAST(dp.sales AS DECIMAL(10,2))) as total_sales
    FROM daily_performance dp
    JOIN campaigns c ON dp.campaignId = c.id
    WHERE c.campaignType IN ('sb', 'sd')
    GROUP BY c.campaignType
  `);
  console.log('\nSB/SD绩效数据汇总:');
  console.log(JSON.stringify(sbSdPerformance[0], null, 2));
  
  process.exit(0);
}

main().catch(console.error);
