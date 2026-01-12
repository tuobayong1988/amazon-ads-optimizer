import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  // 查询ad_accounts
  const [accounts] = await connection.execute('SELECT id, userId, accountName, marketplace, storeName FROM ad_accounts');
  console.log('Ad Accounts:');
  console.log(JSON.stringify(accounts, null, 2));
  
  // 查询campaigns的accountId分布
  const [campaignStats] = await connection.execute('SELECT accountId, COUNT(*) as count FROM campaigns GROUP BY accountId');
  console.log('\nCampaigns by accountId:');
  console.log(JSON.stringify(campaignStats, null, 2));
  
  // 查询campaigns和ad_accounts的关联
  const [joined] = await connection.execute(`
    SELECT c.accountId, a.id as adAccountId, a.accountName, a.marketplace, COUNT(*) as campaignCount 
    FROM campaigns c 
    LEFT JOIN ad_accounts a ON c.accountId = a.id 
    GROUP BY c.accountId, a.id, a.accountName, a.marketplace
  `);
  console.log('\nCampaigns joined with ad_accounts:');
  console.log(JSON.stringify(joined, null, 2));
  
  await connection.end();
}

main().catch(console.error);
