import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';

const connection = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port: parseInt(process.env.DATABASE_PORT || '3306'),
  ssl: { rejectUnauthorized: false }
});

const db = drizzle(connection);

// 查询startDate统计
const [result] = await connection.execute(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN startDate IS NOT NULL THEN 1 ELSE 0 END) as with_startdate,
    SUM(CASE WHEN startDate IS NULL THEN 1 ELSE 0 END) as without_startdate
  FROM campaigns
`);
console.log('startDate统计:', result[0]);

// 查询有startDate的记录分布
const [dates] = await connection.execute(`
  SELECT startDate, COUNT(*) as count
  FROM campaigns
  WHERE startDate IS NOT NULL
  GROUP BY startDate
  ORDER BY startDate DESC
  LIMIT 10
`);
console.log('\nstartDate分布:');
dates.forEach(d => console.log(`  ${d.startDate}: ${d.count}条`));

// 查询几条示例数据
const [samples] = await connection.execute(`
  SELECT campaignId, campaignName, startDate, endDate, createdAt
  FROM campaigns
  WHERE startDate IS NOT NULL
  LIMIT 5
`);
console.log('\n示例数据:');
samples.forEach(s => console.log(`  ${s.campaignName.substring(0, 40)}... | startDate: ${s.startDate} | endDate: ${s.endDate}`));

await connection.end();
