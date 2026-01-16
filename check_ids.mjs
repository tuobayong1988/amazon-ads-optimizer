import { createPool } from 'mysql2/promise';

const pool = createPool({
  host: 'amazon-ads-optimizer-db-2.cj2k8yq2s1ld.us-east-1.rds.amazonaws.com',
  user: 'admin',
  password: 'Manus2025!',
  database: 'amazon_ads_optimizer',
  port: 3306,
  ssl: { rejectUnauthorized: false }
});

const [accounts] = await pool.execute('SELECT id, storeName, marketplace FROM ad_accounts');
console.log('Ad Accounts:');
console.table(accounts);

const [performance] = await pool.execute('SELECT DISTINCT accountId FROM daily_performance');
console.log('\nDaily Performance accountIds:');
console.table(performance);

await pool.end();
