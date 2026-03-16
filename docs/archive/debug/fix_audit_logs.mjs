import mysql from 'mysql2/promise';

async function fixAuditLogs() {
  const pool = mysql.createPool(process.env.DATABASE_URL);
  
  try {
    // 查看audit_logs表结构
    const [cols] = await pool.query('DESCRIBE audit_logs');
    console.log('Current audit_logs columns:');
    cols.forEach(c => console.log('  -', c.Field));
    
    // 检查是否需要添加user_id列
    const hasUserId = cols.some(c => c.Field === 'user_id');
    if (hasUserId === false) {
      console.log('\nAdding user_id column...');
      await pool.query('ALTER TABLE audit_logs ADD COLUMN user_id INT NULL AFTER organization_id');
      console.log('user_id column added');
    }
    
    // 检查是否需要添加user_name列
    const hasUserName = cols.some(c => c.Field === 'user_name');
    if (hasUserName === false) {
      console.log('Adding user_name column...');
      await pool.query('ALTER TABLE audit_logs ADD COLUMN user_name VARCHAR(255) NULL AFTER user_id');
      console.log('user_name column added');
    }
    
    console.log('\naudit_logs table fixed!');
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

fixAuditLogs();
