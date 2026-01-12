import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '3306'),
    ssl: { rejectUnauthorized: false }
  });
  
  const database = drizzle(connection);
  
  // 查询2025.12.26创建的SB广告活动
  const [newSbCampaigns] = await connection.execute(`
    SELECT id, campaign_id, name, daily_budget, campaign_status, campaign_type, created_at, account_id
    FROM campaigns
    WHERE campaign_type = 'sb'
    AND name LIKE '2025.12.26%'
    LIMIT 20
  `);
  
  console.log('\n=== 2025.12.26创建的SB广告活动 ===');
  const campaigns = newSbCampaigns as any[];
  
  if (campaigns && campaigns.length > 0) {
    campaigns.forEach((c: any) => {
      console.log(`ID: ${c.id}, campaignId: ${c.campaign_id}, 预算: $${c.daily_budget}, 状态: ${c.campaign_status}, 账户: ${c.account_id}`);
      console.log(`  名称: ${c.name}`);
    });
    
    // 检查这些campaignId是否在API返回的数据中
    const campaignIds = campaigns.map((c: any) => c.campaign_id);
    console.log('\n这些广告活动的campaignId:', campaignIds.slice(0, 5));
  } else {
    console.log('没有找到2025.12.26创建的SB广告活动');
  }
  
  // 检查US账户中预算大于0的SB广告活动
  const [usWithBudget] = await connection.execute(`
    SELECT id, campaign_id, name, daily_budget, campaign_status
    FROM campaigns
    WHERE campaign_type = 'sb'
    AND account_id = 60019
    AND daily_budget > 0
    LIMIT 10
  `);
  
  console.log('\n=== US账户预算>0的SB广告活动 ===');
  const usResults = usWithBudget as any[];
  if (usResults && usResults.length > 0) {
    usResults.forEach((c: any) => {
      console.log(`ID: ${c.id}, campaignId: ${c.campaign_id}, 预算: $${c.daily_budget}, 状态: ${c.campaign_status}`);
      console.log(`  名称: ${c.name}`);
    });
  } else {
    console.log('没有找到预算>0的SB广告活动');
  }
  
  // 检查前端显示的第一个广告活动
  const [firstDisplayed] = await connection.execute(`
    SELECT id, campaign_id, name, daily_budget, campaign_status, account_id
    FROM campaigns
    WHERE campaign_type = 'sb'
    AND name = '2025.12.26-CPC-SBV-Johanna2-B0F6BJ9YQS-KW-exact-高多转-大词1-w'
    LIMIT 1
  `);
  
  console.log('\n=== 前端显示的第一个广告活动 ===');
  const first = (firstDisplayed as any[])[0];
  if (first) {
    console.log(`ID: ${first.id}, campaignId: ${first.campaign_id}, 预算: $${first.daily_budget}, 状态: ${first.campaign_status}, 账户: ${first.account_id}`);
  }
  
  await connection.end();
  process.exit(0);
}

main().catch(console.error);
