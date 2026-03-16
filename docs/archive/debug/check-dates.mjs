import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

// 查询startDate分布
const [rows1] = await connection.execute(`
  SELECT 
    SUM(CASE WHEN startDate IS NOT NULL THEN 1 ELSE 0 END) as with_date,
    SUM(CASE WHEN startDate IS NULL THEN 1 ELSE 0 END) as without_date,
    COUNT(*) as total
  FROM campaigns
`);
console.log('startDate统计:', rows1[0]);

// 查看startDate分布详情
const [rows2] = await connection.execute(`
  SELECT startDate, COUNT(*) as count
  FROM campaigns
  GROUP BY startDate
  ORDER BY count DESC
  LIMIT 10
`);
console.log('startDate分布:', rows2);

// 查看几条有startDate的记录
const [rows3] = await connection.execute(`
  SELECT id, campaignName, campaignType, startDate, createdAt
  FROM campaigns
  WHERE startDate IS NOT NULL
  LIMIT 5
`);
console.log('有startDate的记录样本:', rows3);

await connection.end();
