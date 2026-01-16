import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.DATABASE_HOST || 'localhost',
  user: process.env.DATABASE_USER || 'root',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'amazon_ads',
  ssl: { rejectUnauthorized: false }
});

const [rows] = await connection.execute('SELECT id, accountId, storeName, marketplace, userId FROM ad_accounts ORDER BY id');
console.log('Accounts in database:');
rows.forEach(row => {
  console.log(`  id=${row.id}, accountId=${row.accountId}, store=${row.storeName}, marketplace=${row.marketplace}, userId=${row.userId}`);
});

await connection.end();
