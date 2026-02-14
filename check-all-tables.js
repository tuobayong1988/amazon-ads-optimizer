const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  const tables = ['campaigns', 'ad_groups', 'keywords', 'product_targets'];
  
  console.log('\n数据库表记录统计:');
  console.log('='.repeat(50));
  
  for (const table of tables) {
    const [rows] = await conn.execute(`SELECT COUNT(*) as count FROM ${table}`);
    console.log(`${table.padEnd(20)}: ${rows[0].count} 条记录`);
  }
  
  console.log('='.repeat(50));
  
  await conn.end();
})();
