import axios from 'axios';
import mysql from 'mysql2/promise';

const OAUTH_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const API_ENDPOINT = 'https://advertising-api.amazon.com';

async function testSbHeaders() {
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
  
  console.log('========== 测试 SB API 不同的 Accept Headers ==========\n');
  
  // 测试不同的Accept headers
  const acceptHeaders = [
    'application/vnd.sbcampaignresource.v4+json',
    'application/vnd.sbCampaignResource.v4+json',
    'application/vnd.sbcampaign.v4+json',
    'application/vnd.sbCampaign.v4+json',
    '*/*',
  ];
  
  for (const accept of acceptHeaders) {
    console.log(`\n🔄 测试 Accept: ${accept}`);
    
    try {
      const response = await axios.get(`${API_ENDPOINT}/sb/campaigns`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Amazon-Advertising-API-ClientId': creds.clientId,
          'Amazon-Advertising-API-Scope': usProfileId,
          'Content-Type': 'application/json',
          'Accept': accept,
        },
      });
      
      const campaigns = response.data.campaigns || response.data || [];
      console.log(`   ✅ 成功! 状态码: ${response.status}`);
      console.log(`   📊 数据: ${Array.isArray(campaigns) ? campaigns.length + '个广告活动' : JSON.stringify(campaigns).substring(0, 200)}`);
      
      if (Array.isArray(campaigns) && campaigns.length > 0) {
        console.log(`   📋 示例: ${JSON.stringify(campaigns[0]).substring(0, 300)}...`);
      }
    } catch (error) {
      console.log(`   ❌ 失败! 状态码: ${error.response?.status || 'N/A'}`);
      console.log(`   📝 错误: ${JSON.stringify(error.response?.data || error.message).substring(0, 200)}`);
    }
  }
  
  // 测试v3 endpoint with vnd header
  console.log('\n\n========== 测试 SB v3 API with vnd headers ==========\n');
  
  const v3Headers = [
    'application/vnd.sbcampaignresource.v3+json',
    'application/vnd.sbCampaignResource.v3+json',
  ];
  
  for (const accept of v3Headers) {
    console.log(`\n🔄 测试 Accept: ${accept}`);
    
    try {
      const response = await axios.get(`${API_ENDPOINT}/sb/campaigns`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Amazon-Advertising-API-ClientId': creds.clientId,
          'Amazon-Advertising-API-Scope': usProfileId,
          'Content-Type': 'application/json',
          'Accept': accept,
        },
      });
      
      const campaigns = response.data.campaigns || response.data || [];
      console.log(`   ✅ 成功! 状态码: ${response.status}`);
      console.log(`   📊 数据: ${Array.isArray(campaigns) ? campaigns.length + '个广告活动' : JSON.stringify(campaigns).substring(0, 200)}`);
      
      if (Array.isArray(campaigns) && campaigns.length > 0) {
        console.log(`   📋 示例: ${JSON.stringify(campaigns[0]).substring(0, 300)}...`);
      }
    } catch (error) {
      console.log(`   ❌ 失败! 状态码: ${error.response?.status || 'N/A'}`);
      console.log(`   📝 错误: ${JSON.stringify(error.response?.data || error.message).substring(0, 200)}`);
    }
  }
  
  await connection.end();
}

testSbHeaders().catch(console.error);
