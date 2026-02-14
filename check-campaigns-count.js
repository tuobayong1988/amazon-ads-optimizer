const mysql = require('mysql2/promise');

const DATABASE_URL = process.env.DATABASE_URL || 'mysql://admin:Mucers2025@amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com:3306/amazon_ads_optimizer';

async function checkCampaigns() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  try {
    const [rows] = await connection.execute('SELECT COUNT(*) as count FROM campaigns');
    console.log(`\n✅ campaigns表中的记录数: ${rows[0].count}\n`);
    
    if (rows[0].count > 0) {
      const [samples] = await connection.execute('SELECT * FROM campaigns LIMIT 5');
      console.log('前5条记录:');
      console.log(JSON.stringify(samples, null, 2));
    }
  } finally {
    await connection.end();
  }
}

checkCampaigns().catch(console.error);
