const mysql = require('mysql2/promise');

const DATABASE_URL = process.env.DATABASE_URL || 'mysql://admin:Mucers2025@amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com:3306/amazon_ads_optimizer';

async function checkSyncLogs() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  try {
    console.log('\n=== 最近10条同步日志 ===\n');
    const [logs] = await connection.execute(`
      SELECT id, account_id, sync_type, status, synced_count, skipped_count, error_message, created_at
      FROM sync_logs
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    logs.forEach(log => {
      console.log(`ID: ${log.id}`);
      console.log(`账号: ${log.account_id}`);
      console.log(`类型: ${log.sync_type}`);
      console.log(`状态: ${log.status}`);
      console.log(`同步: ${log.synced_count} | 跳过: ${log.skipped_count}`);
      console.log(`时间: ${log.created_at}`);
      if (log.error_message) {
        console.log(`错误: ${log.error_message}`);
      }
      console.log('---');
    });
  } finally {
    await connection.end();
  }
}

checkSyncLogs().catch(console.error);
