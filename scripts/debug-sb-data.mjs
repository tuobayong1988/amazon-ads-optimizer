import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '3306'),
    ssl: { rejectUnauthorized: false }
  });
  
  console.log('=== 2025.12.26创建的SB广告活动账户分布 ===');
  const [accountDist] = await connection.execute(`
    SELECT c.accountId, a.marketplace, COUNT(*) as count
    FROM campaigns c
    JOIN ad_accounts a ON c.accountId = a.id
    WHERE c.campaignType = 'sb'
    AND c.campaignName LIKE '2025.12.26%'
    GROUP BY c.accountId, a.marketplace
  `);
  console.log(accountDist);
  
  console.log('\n=== 2025.12.26创建的SB广告活动详情 ===');
  const [newCampaigns] = await connection.execute(`
    SELECT c.campaignId, c.campaignName, c.dailyBudget, c.campaignStatus, c.accountId, a.marketplace
    FROM campaigns c
    JOIN ad_accounts a ON c.accountId = a.id
    WHERE c.campaignType = 'sb'
    AND c.campaignName LIKE '2025.12.26%'
    ORDER BY c.id DESC
    LIMIT 5
  `);
  newCampaigns.forEach(c => {
    console.log(`campaignId: ${c.campaignId}, 预算: $${c.dailyBudget}, 状态: ${c.campaignStatus}, 站点: ${c.marketplace}`);
    console.log(`  名称: ${c.campaignName}`);
  });
  
  console.log('\n=== US账户预算>0的SB广告活动 ===');
  const [usWithBudget] = await connection.execute(`
    SELECT c.campaignId, c.campaignName, c.dailyBudget, c.campaignStatus
    FROM campaigns c
    WHERE c.campaignType = 'sb'
    AND c.accountId = 60019
    AND c.dailyBudget > 0
    ORDER BY c.dailyBudget DESC
    LIMIT 5
  `);
  usWithBudget.forEach(c => {
    console.log(`campaignId: ${c.campaignId}, 预算: $${c.dailyBudget}, 状态: ${c.campaignStatus}`);
    console.log(`  名称: ${c.campaignName}`);
  });
  
  console.log('\n=== US账户预算=0的SB广告活动数量 ===');
  const [usZeroBudget] = await connection.execute(`
    SELECT COUNT(*) as count
    FROM campaigns
    WHERE campaignType = 'sb'
    AND accountId = 60019
    AND dailyBudget = 0
  `);
  console.log('预算为0的SB广告活动数量:', usZeroBudget[0].count);
  
  await connection.end();
}

main().catch(console.error);
