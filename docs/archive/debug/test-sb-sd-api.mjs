import axios from 'axios';
import mysql from 'mysql2/promise';

const OAUTH_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const API_ENDPOINT = 'https://advertising-api.amazon.com';

async function testSbSdApi() {
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
  const usProfileId = '599502392622991';
  
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Amazon-Advertising-API-ClientId': creds.clientId,
    'Amazon-Advertising-API-Scope': usProfileId,
  };
  
  console.log('========== 测试 Sponsored Brands (SB) API ==========\n');
  
  // 测试不同的SB端点
  const sbEndpoints = [
    { name: 'SB v4 campaigns list (POST)', url: '/sb/v4/campaigns/list', method: 'POST', body: { maxResults: 100 }, contentType: 'application/json' },
    { name: 'SB v3 campaigns (GET)', url: '/sb/campaigns', method: 'GET', contentType: 'application/json' },
    { name: 'SB v3 campaigns list (POST)', url: '/sb/campaigns/list', method: 'POST', body: {}, contentType: 'application/json' },
    { name: 'SB campaigns extended (GET)', url: '/sb/campaigns/extended', method: 'GET', contentType: 'application/json' },
  ];
  
  for (const endpoint of sbEndpoints) {
    console.log(`\n🔄 测试: ${endpoint.name}`);
    console.log(`   URL: ${API_ENDPOINT}${endpoint.url}`);
    
    try {
      let response;
      const reqHeaders = {
        ...headers,
        'Content-Type': endpoint.contentType,
        'Accept': endpoint.contentType,
      };
      
      if (endpoint.method === 'POST') {
        response = await axios.post(`${API_ENDPOINT}${endpoint.url}`, endpoint.body || {}, { headers: reqHeaders });
      } else {
        response = await axios.get(`${API_ENDPOINT}${endpoint.url}`, { headers: reqHeaders });
      }
      
      const data = response.data;
      const campaigns = data.campaigns || data || [];
      console.log(`   ✅ 成功! 状态码: ${response.status}`);
      console.log(`   📊 数据: ${Array.isArray(campaigns) ? campaigns.length + '个广告活动' : JSON.stringify(data).substring(0, 200)}`);
      
      if (Array.isArray(campaigns) && campaigns.length > 0) {
        console.log(`   📋 示例: ${JSON.stringify(campaigns[0]).substring(0, 300)}...`);
      }
    } catch (error) {
      console.log(`   ❌ 失败! 状态码: ${error.response?.status || 'N/A'}`);
      console.log(`   📝 错误: ${JSON.stringify(error.response?.data || error.message).substring(0, 300)}`);
    }
  }
  
  console.log('\n\n========== 测试 Sponsored Display (SD) API ==========\n');
  
  // 测试不同的SD端点
  const sdEndpoints = [
    { name: 'SD campaigns (GET)', url: '/sd/campaigns', method: 'GET', contentType: 'application/json' },
    { name: 'SD campaigns list (POST)', url: '/sd/campaigns/list', method: 'POST', body: {}, contentType: 'application/json' },
    { name: 'SD campaigns extended (GET)', url: '/sd/campaigns/extended', method: 'GET', contentType: 'application/json' },
    { name: 'SD v2 campaigns (GET)', url: '/v2/sd/campaigns', method: 'GET', contentType: 'application/json' },
  ];
  
  for (const endpoint of sdEndpoints) {
    console.log(`\n🔄 测试: ${endpoint.name}`);
    console.log(`   URL: ${API_ENDPOINT}${endpoint.url}`);
    
    try {
      let response;
      const reqHeaders = {
        ...headers,
        'Content-Type': endpoint.contentType,
        'Accept': endpoint.contentType,
      };
      
      if (endpoint.method === 'POST') {
        response = await axios.post(`${API_ENDPOINT}${endpoint.url}`, endpoint.body || {}, { headers: reqHeaders });
      } else {
        response = await axios.get(`${API_ENDPOINT}${endpoint.url}`, { headers: reqHeaders });
      }
      
      const data = response.data;
      const campaigns = data.campaigns || data || [];
      console.log(`   ✅ 成功! 状态码: ${response.status}`);
      console.log(`   📊 数据: ${Array.isArray(campaigns) ? campaigns.length + '个广告活动' : JSON.stringify(data).substring(0, 200)}`);
      
      if (Array.isArray(campaigns) && campaigns.length > 0) {
        console.log(`   📋 示例: ${JSON.stringify(campaigns[0]).substring(0, 300)}...`);
      }
    } catch (error) {
      console.log(`   ❌ 失败! 状态码: ${error.response?.status || 'N/A'}`);
      console.log(`   📝 错误: ${JSON.stringify(error.response?.data || error.message).substring(0, 300)}`);
    }
  }
  
  await connection.end();
}

testSbSdApi().catch(console.error);
