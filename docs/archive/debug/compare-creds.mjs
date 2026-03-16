import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

async function compareCredentials() {
  // 从环境变量获取
  const envClientId = process.env.AMAZON_ADS_CLIENT_ID || '';
  const envClientSecret = process.env.AMAZON_ADS_CLIENT_SECRET || '';
  
  console.log('Environment variables:');
  console.log('  AMAZON_ADS_CLIENT_ID:', envClientId ? envClientId.substring(0, 30) + '...' : '(not set)');
  console.log('  AMAZON_ADS_CLIENT_SECRET:', envClientSecret ? envClientSecret.substring(0, 20) + '...' : '(not set)');
  
  // 从数据库获取
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await connection.execute(
    'SELECT clientId, clientSecret FROM amazon_api_credentials ORDER BY id DESC LIMIT 1'
  );
  
  if (rows.length > 0) {
    const dbCreds = rows[0];
    console.log('\nDatabase credentials:');
    console.log('  clientId:', dbCreds.clientId.substring(0, 30) + '...');
    console.log('  clientSecret:', dbCreds.clientSecret.substring(0, 20) + '...');
    
    // 比较
    console.log('\nComparison:');
    console.log('  clientId match:', envClientId === dbCreds.clientId ? 'YES ✓' : 'NO ✗');
    console.log('  clientSecret match:', envClientSecret === dbCreds.clientSecret ? 'YES ✓' : 'NO ✗');
  } else {
    console.log('\nNo credentials in database');
  }
  
  await connection.end();
}

compareCredentials().catch(console.error);
