import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

async function testCredentials() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  const [rows] = await connection.execute(
    'SELECT id, accountId, clientId, clientSecret, refreshToken, profileId, region, syncStatus FROM amazon_api_credentials ORDER BY id DESC LIMIT 1'
  );
  
  if (rows.length === 0) {
    console.log('No credentials found in amazon_api_credentials table');
    await connection.end();
    return;
  }
  
  const creds = rows[0];
  console.log('Found credentials:');
  console.log('  accountId:', creds.accountId);
  console.log('  clientId:', creds.clientId.substring(0, 30) + '...');
  console.log('  profileId:', creds.profileId);
  console.log('  region:', creds.region);
  console.log('  syncStatus:', creds.syncStatus);
  
  // 测试token刷新
  console.log('\nTesting token refresh...');
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
    console.log('Response status:', response.status);
    
    if (response.ok) {
      console.log('Token refresh SUCCESS!');
      console.log('Access token (first 50 chars):', data.access_token?.substring(0, 50) + '...');
      console.log('Expires in:', data.expires_in, 'seconds');
    } else {
      console.log('Token refresh FAILED:');
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  await connection.end();
}

testCredentials().catch(console.error);
