import mysql from 'mysql2/promise';

async function checkData() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log('========== 检查数据库中的广告数据 ==========\n');
  
  // 检查各表的数据量
  const tables = ['campaigns', 'ad_groups', 'keywords', 'product_targets', 'daily_performance', 'amazon_api_credentials', 'amazon_ad_accounts'];
  
  for (const table of tables) {
    try {
      const [rows] = await connection.execute(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`${table}: ${rows[0].count} 条记录`);
    } catch (error) {
      console.log(`${table}: 表不存在或查询失败`);
    }
  }
  
  // 检查API凭证
  console.log('\n========== API凭证状态 ==========\n');
  const [creds] = await connection.execute('SELECT id, accountId, profileId, region, lastSyncAt FROM amazon_api_credentials');
  console.log('API凭证:', creds);
  
  // 检查广告账号
  console.log('\n========== 广告账号 ==========\n');
  const [accounts] = await connection.execute('SELECT id, accountId, accountName, storeName, marketplace FROM amazon_ad_accounts');
  console.log('广告账号:', accounts);
  
  await connection.end();
}

checkData().catch(console.error);
