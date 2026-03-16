import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  // 检查并添加列
  const [cols] = await conn.execute(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'team_members'
  `);
  const colNames = cols.map(c => c.COLUMN_NAME);
  
  if (colNames.indexOf('username') === -1) {
    await conn.execute('ALTER TABLE team_members ADD COLUMN username VARCHAR(100) AFTER organization_id');
    try {
      await conn.execute('ALTER TABLE team_members ADD UNIQUE INDEX idx_username (username)');
    } catch (e) {
      console.log('索引已存在或不支持');
    }
    console.log('添加 username 列');
  } else {
    console.log('username 列已存在');
  }
  
  if (colNames.indexOf('password_hash') === -1) {
    await conn.execute('ALTER TABLE team_members ADD COLUMN password_hash VARCHAR(255) AFTER username');
    console.log('添加 password_hash 列');
  } else {
    console.log('password_hash 列已存在');
  }
  
  if (colNames.indexOf('last_login_at') === -1) {
    await conn.execute('ALTER TABLE team_members ADD COLUMN last_login_at TIMESTAMP NULL');
    console.log('添加 last_login_at 列');
  } else {
    console.log('last_login_at 列已存在');
  }
  
  await conn.end();
  console.log('team_members表更新完成');
}

main().catch(console.error);
