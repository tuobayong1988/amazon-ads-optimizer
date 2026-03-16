import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const OAUTH_AUTH_ENDPOINTS = {
  NA: 'https://www.amazon.com/ap/oa',
  EU: 'https://eu.account.amazon.com/ap/oa',
  FE: 'https://apac.account.amazon.com/ap/oa',
};

async function diagnoseAuth() {
  console.log('=== Amazon API 授权流程诊断 ===\n');
  
  // 1. 检查环境变量
  console.log('1. 环境变量检查:');
  const clientId = process.env.AMAZON_ADS_CLIENT_ID || '';
  const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET || '';
  
  console.log(`   AMAZON_ADS_CLIENT_ID: ${clientId ? '✓ 已配置 (' + clientId.substring(0, 35) + '...)' : '✗ 未配置'}`);
  console.log(`   AMAZON_ADS_CLIENT_SECRET: ${clientSecret ? '✓ 已配置 (' + clientSecret.substring(0, 25) + '...)' : '✗ 未配置'}`);
  
  // 验证格式
  const clientIdValid = clientId.match(/^amzn1\.application-oa2-client\.[a-f0-9]+$/);
  const clientSecretValid = clientSecret.match(/^amzn1\.oa2-cs\.v1\.[a-f0-9]+$/);
  
  console.log(`   Client ID 格式: ${clientIdValid ? '✓ 有效' : '✗ 无效 (应为 amzn1.application-oa2-client.xxx)'}`);
  console.log(`   Client Secret 格式: ${clientSecretValid ? '✓ 有效' : '✗ 无效 (应为 amzn1.oa2-cs.v1.xxx)'}`);
  
  // 2. 检查数据库凭证
  console.log('\n2. 数据库凭证检查:');
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  const [creds] = await connection.execute(
    'SELECT id, accountId, clientId, clientSecret, refreshToken, profileId, region, syncStatus, lastSyncAt FROM amazon_api_credentials ORDER BY id DESC LIMIT 1'
  );
  
  if (creds.length === 0) {
    console.log('   ✗ 数据库中没有保存的凭证');
  } else {
    const cred = creds[0];
    console.log(`   ✓ 找到凭证 (ID: ${cred.id}, Account: ${cred.accountId})`);
    console.log(`   Profile ID: ${cred.profileId}`);
    console.log(`   Region: ${cred.region}`);
    console.log(`   Sync Status: ${cred.syncStatus}`);
    console.log(`   Last Sync: ${cred.lastSyncAt || 'Never'}`);
    
    // 比较凭证
    const dbClientIdMatch = cred.clientId === clientId;
    const dbClientSecretMatch = cred.clientSecret === clientSecret;
    console.log(`   与环境变量匹配: Client ID ${dbClientIdMatch ? '✓' : '✗'}, Client Secret ${dbClientSecretMatch ? '✓' : '✗'}`);
  }
  
  // 3. 生成授权URL示例
  console.log('\n3. 授权URL生成:');
  const redirectUri = 'https://sellerps.com';
  for (const [region, endpoint] of Object.entries(OAUTH_AUTH_ENDPOINTS)) {
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'advertising::campaign_management',
      response_type: 'code',
      redirect_uri: redirectUri,
    });
    const authUrl = `${endpoint}?${params.toString()}`;
    console.log(`   ${region}: ${authUrl.substring(0, 80)}...`);
  }
  
  // 4. 测试Token刷新
  console.log('\n4. Token刷新测试:');
  if (creds.length > 0) {
    const cred = creds[0];
    try {
      const response = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: cred.clientId,
          client_secret: cred.clientSecret,
          refresh_token: cred.refreshToken,
        }),
      });
      
      const data = await response.json();
      if (response.ok) {
        console.log(`   ✓ Token刷新成功 (有效期: ${data.expires_in}秒)`);
      } else {
        console.log(`   ✗ Token刷新失败: ${data.error} - ${data.error_description}`);
      }
    } catch (error) {
      console.log(`   ✗ Token刷新异常: ${error.message}`);
    }
  }
  
  // 5. 检查账号关联
  console.log('\n5. 账号关联检查:');
  const [accounts] = await connection.execute(
    'SELECT id, accountName, marketplace, profileId, connectionStatus FROM ad_accounts WHERE profileId IS NOT NULL LIMIT 5'
  );
  
  if (accounts.length === 0) {
    console.log('   ✗ 没有关联的广告账号');
  } else {
    console.log(`   ✓ 找到 ${accounts.length} 个关联账号:`);
    accounts.forEach(acc => {
      console.log(`     - ${acc.accountName} (${acc.marketplace}) - Profile: ${acc.profileId} - Status: ${acc.connectionStatus}`);
    });
  }
  
  await connection.end();
  
  console.log('\n=== 诊断完成 ===');
}

diagnoseAuth().catch(console.error);
