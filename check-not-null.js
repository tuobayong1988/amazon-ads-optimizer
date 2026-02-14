const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection('mysql://admin:Mucers2025@amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com:3306/amazon_ads_optimizer');
  const [fields] = await conn.execute('DESCRIBE campaigns');
  
  console.log('=== NOT NULL fields ===');
  fields.forEach(f => {
    if (f.Null === 'NO') {
      console.log(`${f.Field}: ${f.Type}, Default: ${f.Default}, Extra: ${f.Extra}`);
    }
  });
  
  await conn.end();
})();
