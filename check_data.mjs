import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '3306'),
  ssl: { rejectUnauthorized: false }
});

// 检查daily_performance数据分布
const [rows1] = await connection.execute(`
  SELECT dp.accountId, a.storeName, a.marketplace, a.userId,
         COUNT(*) as recordCount, 
         SUM(dp.spend) as totalSpend, 
         SUM(dp.sales) as totalSales,
         MIN(dp.date) as minDate,
         MAX(dp.date) as maxDate
  FROM daily_performance dp
  LEFT JOIN ad_accounts a ON dp.accountId = a.id
  GROUP BY dp.accountId
  ORDER BY dp.accountId
`);
console.log('Daily Performance by Account:');
console.table(rows1);

// 检查ad_accounts表
const [rows2] = await connection.execute(`
  SELECT id, storeName, marketplace, userId
  FROM ad_accounts
  ORDER BY id
`);
console.log('\nAd Accounts:');
console.table(rows2);

await connection.end();
