import axios from 'axios';
import mysql from 'mysql2/promise';

const OAUTH_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const API_ENDPOINT = 'https://advertising-api.amazon.com';

async function testSbV4() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await connection.execute('SELECT * FROM amazon_api_credentials LIMIT 1');
  const creds = rows[0];
  
  const tokenResponse = await axios.post(OAUTH_TOKEN_URL, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  
  const accessToken = tokenResponse.data.access_token;
  const usProfileId = '599502392622991';
  
  console.log('========== 测试 SB v4 API 端点 ==========\n');
  
  // 测试不同的v4端点路径
  const endpoints = [
    { url: '/sb/v4/campaigns', method: 'GET' },
    { url: '/sb/v4/campaigns/list', method: 'POST', body: {} },
    { url: '/sb/v4/campaigns/list', method: 'POST', body: { maxResults: 100 } },
    { url: '/v4/sb/campaigns', method: 'GET' },
    { url: '/v4/sb/campaigns/list', method: 'POST', body: {} },
  ];
  
  for (const endpoint of endpoints) {
    console.log(`\n🔄 测试: ${endpoint.method} ${endpoint.url}`);
    
    try {
      let response;
      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Amazon-Advertising-API-ClientId': creds.clientId,
        'Amazon-Advertising-API-Scope': usProfileId,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      
      if (endpoint.method === 'POST') {
        response = await axios.post(`${API_ENDPOINT}${endpoint.url}`, endpoint.body || {}, { headers });
      } else {
        response = await axios.get(`${API_ENDPOINT}${endpoint.url}`, { headers });
      }
      
      const campaigns = response.data.campaigns || response.data || [];
      console.log(`   ✅ 成功! 状态码: ${response.status}`);
      console.log(`   📊 数据: ${Array.isArray(campaigns) ? campaigns.length + '个广告活动' : JSON.stringify(campaigns).substring(0, 200)}`);
      
      if (Array.isArray(campaigns) && campaigns.length > 0) {
        console.log(`   📋 示例: ${JSON.stringify(campaigns[0]).substring(0, 300)}...`);
      }
    } catch (error) {
      console.log(`   ❌ 失败! 状态码: ${error.response?.status || 'N/A'}`);
      console.log(`   📝 错误: ${JSON.stringify(error.response?.data || error.message).substring(0, 300)}`);
    }
  }
  
  // 测试带有特定content-type的v4端点
  console.log('\n\n========== 测试 SB v4 API with vnd content-type ==========\n');
  
  const vndTypes = [
    'application/vnd.sbcampaignresource.v4+json',
    'application/vnd.sbadvertising.v4+json',
  ];
  
  for (const contentType of vndTypes) {
    console.log(`\n🔄 测试 POST /sb/v4/campaigns/list with Content-Type: ${contentType}`);
    
    try {
      const response = await axios.post(`${API_ENDPOINT}/sb/v4/campaigns/list`, 
        { maxResults: 100 },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Amazon-Advertising-API-ClientId': creds.clientId,
            'Amazon-Advertising-API-Scope': usProfileId,
            'Content-Type': contentType,
            'Accept': contentType,
          },
        }
      );
      
      const campaigns = response.data.campaigns || response.data || [];
      console.log(`   ✅ 成功! 状态码: ${response.status}`);
      console.log(`   📊 数据: ${Array.isArray(campaigns) ? campaigns.length + '个广告活动' : JSON.stringify(campaigns).substring(0, 200)}`);
    } catch (error) {
      console.log(`   ❌ 失败! 状态码: ${error.response?.status || 'N/A'}`);
      console.log(`   📝 错误: ${JSON.stringify(error.response?.data || error.message).substring(0, 200)}`);
    }
  }
  
  await connection.end();
}

testSbV4().catch(console.error);
