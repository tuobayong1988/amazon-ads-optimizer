import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
  });
  
  console.log('=== Ad Accounts ===');
  const [accounts] = await connection.execute('SELECT id, storeName, marketplace, profileId FROM ad_accounts LIMIT 10');
  console.table(accounts);
  
  console.log('\n=== Daily Performance by Account ===');
  const [perf] = await connection.execute('SELECT accountId, COUNT(*) as recordCount, dataSource FROM daily_performance GROUP BY accountId, dataSource ORDER BY accountId');
  console.table(perf);
  
  console.log('\n=== Data Sync Jobs ===');
  const [jobs] = await connection.execute('SELECT id, accountId, syncType, status, recordsSynced, completedAt FROM data_sync_jobs ORDER BY createdAt DESC LIMIT 5');
  console.table(jobs);
  
  await connection.end();
}

main().catch(console.error);
