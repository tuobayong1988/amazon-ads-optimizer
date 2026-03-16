import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

async function checkCredentials() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  const [rows] = await connection.execute(
    'SELECT id, accountName, clientId, LEFT(clientSecret, 30) as clientSecretPrefix, LEFT(refreshToken, 40) as refreshTokenPrefix, status FROM ad_accounts ORDER BY id DESC LIMIT 3'
  );
  
  console.log('Current credentials:');
  console.log(JSON.stringify(rows, null, 2));
  
  // 测试第一个凭证
  if (rows.length > 0) {
    const account = rows[0];
    console.log('\nTesting token refresh for account:', account.accountName);
    
    // 获取完整的凭证
    const [fullRows] = await connection.execute(
      'SELECT clientId, clientSecret, refreshToken FROM ad_accounts WHERE id = ?',
      [account.id]
    );
    
    if (fullRows.length > 0) {
      const creds = fullRows[0];
      
      // 尝试刷新token
      try {
        const response = await fetch('https://api.amazon.com/auth/o2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            refresh_token: creds.refreshToken,
          }),
        });
        
        const data = await response.json();
        console.log('Token refresh response status:', response.status);
        console.log('Token refresh response:', JSON.stringify(data, null, 2));
      } catch (error) {
        console.error('Token refresh error:', error.message);
      }
    }
  }
  
  await connection.end();
}

checkCredentials().catch(console.error);
