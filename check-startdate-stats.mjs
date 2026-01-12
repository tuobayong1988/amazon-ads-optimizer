import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port: parseInt(process.env.DATABASE_PORT || '3306'),
  ssl: { rejectUnauthorized: false }
});

const [rows] = await connection.execute(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN startDate IS NOT NULL THEN 1 ELSE 0 END) as with_startdate,
    SUM(CASE WHEN startDate IS NULL THEN 1 ELSE 0 END) as without_startdate,
    MIN(startDate) as earliest_startdate,
    MAX(startDate) as latest_startdate
  FROM campaigns
`);

console.log('startDate统计结果:');
console.log(JSON.stringify(rows[0], null, 2));

// 查看一些有startDate的记录
const [samples] = await connection.execute(`
  SELECT campaignId, campaignName, campaignType, startDate, endDate
  FROM campaigns
  WHERE startDate IS NOT NULL
  LIMIT 5
`);

console.log('\n有startDate的记录示例:');
samples.forEach(row => {
  console.log(`  ${row.campaignName}: startDate=${row.startDate}, endDate=${row.endDate}`);
});

await connection.end();
