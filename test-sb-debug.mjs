import axios from 'axios';
import mysql from 'mysql2/promise';

const OAUTH_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const API_ENDPOINT = 'https://advertising-api.amazon.com';

async function testSbDebug() {
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
  
  console.log('========== 调试 SB API ==========\n');
  
  // 测试不同的请求体格式
  const testCases = [
    { body: {}, desc: '空对象' },
    { body: { maxResults: 100 }, desc: 'maxResults: 100' },
    { body: { maxResults: 1000 }, desc: 'maxResults: 1000' },
    { body: { stateFilter: { include: ['ENABLED', 'PAUSED'] } }, desc: 'stateFilter' },
  ];
  
  for (const testCase of testCases) {
    console.log(`\n🔄 测试: ${testCase.desc}`);
    console.log(`   Body: ${JSON.stringify(testCase.body)}`);
    
    try {
      const response = await axios.post(`${API_ENDPOINT}/sb/v4/campaigns/list`, 
        testCase.body,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Amazon-Advertising-API-ClientId': creds.clientId,
            'Amazon-Advertising-API-Scope': usProfileId,
            'Content-Type': 'application/vnd.sbcampaignresource.v4+json',
            'Accept': 'application/vnd.sbcampaignresource.v4+json',
          },
        }
      );
      console.log(`   ✅ 成功! 广告活动数: ${response.data.campaigns?.length || 0}`);
    } catch (error) {
      console.log(`   ❌ 失败! 状态码: ${error.response?.status}`);
      console.log(`   📝 错误详情: ${JSON.stringify(error.response?.data)}`);
    }
  }
  
  await connection.end();
}

testSbDebug().catch(console.error);
