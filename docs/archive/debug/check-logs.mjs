// 模拟saveCredentials的验证过程，看看哪里失败
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const API_ENDPOINTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

async function testValidation() {
  console.log('=== 模拟saveCredentials验证过程 ===\n');
  
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  // 获取最新的凭证
  const [creds] = await connection.execute(
    'SELECT clientId, clientSecret, refreshToken, profileId, region FROM amazon_api_credentials ORDER BY id DESC LIMIT 1'
  );
  
  if (creds.length === 0) {
    console.log('没有找到凭证');
    await connection.end();
    return;
  }
  
  const cred = creds[0];
  console.log('使用凭证:');
  console.log('  clientId:', cred.clientId.substring(0, 30) + '...');
  console.log('  profileId:', cred.profileId);
  console.log('  region:', cred.region);
  
  // 步骤1: 刷新Token
  console.log('\n步骤1: 刷新Token...');
  const tokenResponse = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: cred.refreshToken,
    }),
  });
  
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    console.log('Token刷新失败:', tokenData);
    await connection.end();
    return;
  }
  console.log('Token刷新成功');
  
  // 步骤2: 获取Profiles (这是validateCredentials做的事情)
  console.log('\n步骤2: 获取Profiles (validateCredentials)...');
  const profilesResponse = await fetch(`${API_ENDPOINTS[cred.region]}/v2/profiles`, {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Amazon-Advertising-API-ClientId': cred.clientId,
      'Content-Type': 'application/json',
    },
  });
  
  console.log('Profiles响应状态:', profilesResponse.status);
  
  if (profilesResponse.ok) {
    const profiles = await profilesResponse.json();
    console.log('获取到', profiles.length, '个Profiles');
    console.log('验证结果: 成功 ✓');
  } else {
    const errorText = await profilesResponse.text();
    console.log('Profiles获取失败:', errorText);
    console.log('验证结果: 失败 ✗');
  }
  
  await connection.end();
}

testValidation().catch(console.error);
