import axios from 'axios';
import mysql from 'mysql2/promise';

const OAUTH_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const API_ENDPOINTS = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

async function testCampaigns() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await connection.execute('SELECT * FROM amazon_api_credentials LIMIT 1');
  
  if (rows.length === 0) {
    console.log('❌ 没有找到API凭证');
    await connection.end();
    return;
  }
  
  const creds = rows[0];
  
  // 获取Access Token
  const tokenResponse = await axios.post(OAUTH_TOKEN_URL, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  
  const accessToken = tokenResponse.data.access_token;
  const region = creds.region || 'NA';
  const apiEndpoint = API_ENDPOINTS[region];
  
  // 使用US市场的Profile ID
  const usProfileId = '599502392622991';
  
  console.log('🔄 正在获取广告活动列表 (US市场)...');
  console.log('  - Profile ID:', usProfileId);
  console.log('  - API Endpoint:', apiEndpoint);
  
  try {
    const campaignsResponse = await axios.post(`${apiEndpoint}/sp/campaigns/list`, {}, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Amazon-Advertising-API-ClientId': creds.clientId,
        'Amazon-Advertising-API-Scope': usProfileId,
        'Content-Type': 'application/vnd.spCampaign.v3+json',
        'Accept': 'application/vnd.spCampaign.v3+json',
      },
    });
    
    const campaigns = campaignsResponse.data.campaigns || [];
    console.log('\n✅ 获取广告活动成功!');
    console.log('  - 广告活动数量:', campaigns.length);
    
    if (campaigns.length > 0) {
      campaigns.slice(0, 10).forEach((campaign, index) => {
        console.log(`\n  广告活动 ${index + 1}:`);
        console.log('    - Campaign ID:', campaign.campaignId);
        console.log('    - Name:', campaign.name);
        console.log('    - State:', campaign.state);
        console.log('    - Targeting Type:', campaign.targetingType);
        console.log('    - Daily Budget:', campaign.budget?.budget);
        console.log('    - Start Date:', campaign.startDate);
      });
      
      if (campaigns.length > 10) {
        console.log(`\n  ... 还有 ${campaigns.length - 10} 个广告活动`);
      }
    } else {
      console.log('\n  该账号下没有SP广告活动');
    }
    
    // 也尝试获取SB广告活动
    console.log('\n🔄 正在获取SB品牌广告活动...');
    try {
      const sbResponse = await axios.post(`${apiEndpoint}/sb/v4/campaigns/list`, {
        maxResults: 100
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Amazon-Advertising-API-ClientId': creds.clientId,
          'Amazon-Advertising-API-Scope': usProfileId,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      
      const sbCampaigns = sbResponse.data.campaigns || [];
      console.log('✅ SB广告活动数量:', sbCampaigns.length);
    } catch (sbError) {
      console.log('  SB广告:', sbError.response?.data?.message || sbError.message);
    }
    
    // 也尝试获取SD广告活动
    console.log('\n🔄 正在获取SD展示广告活动...');
    try {
      const sdResponse = await axios.post(`${apiEndpoint}/sd/campaigns/list`, {}, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Amazon-Advertising-API-ClientId': creds.clientId,
          'Amazon-Advertising-API-Scope': usProfileId,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      
      const sdCampaigns = sdResponse.data || [];
      console.log('✅ SD广告活动数量:', sdCampaigns.length);
    } catch (sdError) {
      console.log('  SD广告:', sdError.response?.data?.message || sdError.message);
    }
    
  } catch (error) {
    console.log('❌ 获取广告活动失败:');
    if (error.response) {
      console.log('  - Status:', error.response.status);
      console.log('  - Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('  - Error:', error.message);
    }
  }
  
  await connection.end();
}

testCampaigns().catch(console.error);
