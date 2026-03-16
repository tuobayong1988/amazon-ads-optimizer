import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const db = drizzle(connection);

// 查询各类型广告活动数量
const result = await db.execute(sql`
  SELECT 
    campaignType,
    campaignStatus,
    COUNT(*) as count
  FROM campaigns
  GROUP BY campaignType, campaignStatus
  ORDER BY campaignType, campaignStatus
`);

console.log('广告活动统计:');
console.log(JSON.stringify(result[0], null, 2));

// 查询总数
const total = await db.execute(sql`SELECT COUNT(*) as total FROM campaigns`);
console.log('\n总数:', total[0]);

// 按账号查询
const byAccount = await db.execute(sql`
  SELECT 
    accountId,
    campaignType,
    COUNT(*) as count
  FROM campaigns
  GROUP BY accountId, campaignType
  ORDER BY accountId, campaignType
`);
console.log('\n按账号统计:');
console.log(JSON.stringify(byAccount[0], null, 2));

await connection.end();
