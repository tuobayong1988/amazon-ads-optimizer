import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: false }
});

const db = drizzle(pool);

async function main() {
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
  
  await pool.end();
}

main().catch(console.error);
