import axios from 'axios';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

const OAUTH_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const API_ENDPOINTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

async function testConnection() {
  // 连接数据库获取凭证
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  const [rows] = await connection.execute(
    'SELECT * FROM amazon_api_credentials LIMIT 1'
  );
  
  if (rows.length === 0) {
    console.log('❌ 没有找到API凭证记录');
    await connection.end();
    return;
  }
  
  const creds = rows[0];
  console.log('📋 凭证信息:');
  console.log('  - Account ID:', creds.accountId);
  console.log('  - Client ID:', creds.clientId ? creds.clientId.substring(0, 20) + '...' : 'N/A');
  console.log('  - Has Refresh Token:', creds.refreshToken ? 'Yes' : 'No');
  console.log('  - Profile ID:', creds.profileId);
  console.log('  - Region:', creds.region);
  console.log('  - Last Sync:', creds.lastSyncAt);
  
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    console.log('\n❌ 凭证不完整，缺少必要字段');
    await connection.end();
    return;
  }
  
  console.log('\n🔄 正在测试Token刷新...');
  
  try {
    const tokenResponse = await axios.post(OAUTH_TOKEN_URL, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    
    console.log('✅ Token刷新成功!');
    console.log('  - Access Token:', tokenResponse.data.access_token.substring(0, 30) + '...');
    console.log('  - Expires In:', tokenResponse.data.expires_in, 'seconds');
    
    const accessToken = tokenResponse.data.access_token;
    const region = creds.region || 'NA';
    const apiEndpoint = API_ENDPOINTS[region];
    
    console.log('\n🔄 正在获取广告配置文件...');
    
    const profilesResponse = await axios.get(`${apiEndpoint}/v2/profiles`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Amazon-Advertising-API-ClientId': creds.clientId,
        'Content-Type': 'application/json',
      },
    });
    
    console.log('✅ 获取配置文件成功!');
    console.log('  - 配置文件数量:', profilesResponse.data.length);
    
    if (profilesResponse.data.length > 0) {
      profilesResponse.data.forEach((profile, index) => {
        console.log(`\n  配置文件 ${index + 1}:`);
        console.log('    - Profile ID:', profile.profileId);
        console.log('    - Country:', profile.countryCode);
        console.log('    - Currency:', profile.currencyCode);
        console.log('    - Account Name:', profile.accountInfo?.name);
        console.log('    - Account Type:', profile.accountInfo?.type);
      });
    }
    
    // 尝试获取广告活动
    if (creds.profileId) {
      console.log('\n🔄 正在获取广告活动列表...');
      
      try {
        const campaignsResponse = await axios.post(`${apiEndpoint}/sp/campaigns/list`, {}, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Amazon-Advertising-API-ClientId': creds.clientId,
            'Amazon-Advertising-API-Scope': creds.profileId,
            'Content-Type': 'application/vnd.spCampaign.v3+json',
          },
        });
        
        const campaigns = campaignsResponse.data.campaigns || [];
        console.log('✅ 获取广告活动成功!');
        console.log('  - 广告活动数量:', campaigns.length);
        
        if (campaigns.length > 0) {
          campaigns.slice(0, 5).forEach((campaign, index) => {
            console.log(`\n  广告活动 ${index + 1}:`);
            console.log('    - Campaign ID:', campaign.campaignId);
            console.log('    - Name:', campaign.name);
            console.log('    - State:', campaign.state);
            console.log('    - Daily Budget:', campaign.budget?.budget);
          });
          
          if (campaigns.length > 5) {
            console.log(`\n  ... 还有 ${campaigns.length - 5} 个广告活动`);
          }
        }
      } catch (campaignError) {
        console.log('❌ 获取广告活动失败:', campaignError.response?.data || campaignError.message);
      }
    }
    
    console.log('\n✅ API连接测试完成 - 连接正常!');
    
  } catch (error) {
    console.log('❌ API测试失败:');
    if (error.response) {
      console.log('  - Status:', error.response.status);
      console.log('  - Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('  - Error:', error.message);
    }
  }
  
  await connection.end();
}

testConnection().catch(console.error);
