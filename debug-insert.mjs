import axios from 'axios';
import mysql from 'mysql2/promise';

const OAUTH_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const API_ENDPOINT = 'https://advertising-api.amazon.com';

async function debugInsert() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  // 获取表结构
  console.log('========== campaigns表结构 ==========\n');
  const [columns] = await connection.execute('DESCRIBE campaigns');
  console.log(columns.map(c => `${c.Field} (${c.Type}) ${c.Null === 'YES' ? 'NULL' : 'NOT NULL'}`).join('\n'));
  
  // 获取API凭证
  const [rows] = await connection.execute('SELECT * FROM amazon_api_credentials LIMIT 1');
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
  
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Amazon-Advertising-API-ClientId': creds.clientId,
    'Amazon-Advertising-API-Scope': creds.profileId,
  };
  
  // 获取一个SP广告活动样本
  console.log('\n========== SP广告活动样本 ==========\n');
  const spResponse = await axios.post(`${API_ENDPOINT}/sp/campaigns/list`, {}, {
    headers: {
      ...headers,
      'Content-Type': 'application/vnd.spCampaign.v3+json',
      'Accept': 'application/vnd.spCampaign.v3+json',
    },
  });
  
  const spCampaign = spResponse.data.campaigns?.[0];
  console.log('SP广告活动数据:', JSON.stringify(spCampaign, null, 2));
  
  // 尝试插入并捕获错误
  console.log('\n========== 尝试插入 ==========\n');
  try {
    const campaignType = spCampaign.targetingType === 'auto' ? 'sp_auto' : 'sp_manual';
    const result = await connection.execute(
      `INSERT INTO campaigns (accountId, campaignId, campaignName, campaignType, targetingType, dailyBudget, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        creds.accountId,
        String(spCampaign.campaignId),
        spCampaign.name,
        campaignType,
        spCampaign.targetingType || 'manual',
        String(spCampaign.dailyBudget || 0),
        spCampaign.state?.toLowerCase() || 'enabled'
      ]
    );
    console.log('插入成功:', result);
  } catch (error) {
    console.log('插入失败:', error.message);
    console.log('SQL State:', error.sqlState);
    console.log('Error Code:', error.code);
  }
  
  await connection.end();
}

debugInsert().catch(console.error);
