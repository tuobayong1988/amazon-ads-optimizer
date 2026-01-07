import axios from 'axios';
import mysql from 'mysql2/promise';

const OAUTH_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const API_ENDPOINT = 'https://advertising-api.amazon.com';

async function testFixedApi() {
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
  
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Amazon-Advertising-API-ClientId': creds.clientId,
    'Amazon-Advertising-API-Scope': usProfileId,
  };
  
  console.log('========== 测试修复后的 API 调用 ==========\n');
  
  // 测试 SP 广告活动
  console.log('🔄 测试 SP 广告活动...');
  try {
    const spResponse = await axios.post(`${API_ENDPOINT}/sp/campaigns/list`, {}, {
      headers: {
        ...headers,
        'Content-Type': 'application/vnd.spCampaign.v3+json',
        'Accept': 'application/vnd.spCampaign.v3+json',
      },
    });
    console.log(`   ✅ SP广告活动: ${spResponse.data.campaigns?.length || 0}个`);
  } catch (error) {
    console.log(`   ❌ SP广告活动失败: ${error.response?.data?.message || error.message}`);
  }
  
  // 测试 SB 广告活动 (使用正确的maxResults: 100)
  console.log('\n🔄 测试 SB 品牌广告活动 (分页获取)...');
  try {
    let allSbCampaigns = [];
    let nextToken = undefined;
    let pageCount = 0;
    
    do {
      const body = { maxResults: 100 };
      if (nextToken) body.nextToken = nextToken;
      
      const sbResponse = await axios.post(`${API_ENDPOINT}/sb/v4/campaigns/list`, 
        body,
        {
          headers: {
            ...headers,
            'Content-Type': 'application/vnd.sbcampaignresource.v4+json',
            'Accept': 'application/vnd.sbcampaignresource.v4+json',
          },
        }
      );
      
      const campaigns = sbResponse.data.campaigns || [];
      allSbCampaigns.push(...campaigns);
      nextToken = sbResponse.data.nextToken;
      pageCount++;
      console.log(`   📄 第${pageCount}页: ${campaigns.length}个广告活动`);
    } while (nextToken && pageCount < 20); // 最多获取20页
    
    console.log(`   ✅ SB品牌广告活动总计: ${allSbCampaigns.length}个`);
    if (allSbCampaigns.length > 0) {
      console.log(`   📋 示例: ${allSbCampaigns[0].name} (${allSbCampaigns[0].state})`);
    }
  } catch (error) {
    console.log(`   ❌ SB广告活动失败: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
  }
  
  // 测试 SD 广告活动 (使用GET方法)
  console.log('\n🔄 测试 SD 展示广告活动...');
  try {
    const sdResponse = await axios.get(`${API_ENDPOINT}/sd/campaigns`, {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    const sdCampaigns = sdResponse.data || [];
    console.log(`   ✅ SD展示广告活动: ${sdCampaigns.length}个`);
    if (sdCampaigns.length > 0) {
      console.log(`   📋 示例: ${sdCampaigns[0].name} (${sdCampaigns[0].state})`);
    }
  } catch (error) {
    console.log(`   ❌ SD广告活动失败: ${error.response?.data?.message || error.message}`);
  }
  
  console.log('\n========== 测试完成 ==========');
  
  await connection.end();
}

testFixedApi().catch(console.error);
