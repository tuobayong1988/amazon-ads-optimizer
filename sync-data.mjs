import axios from 'axios';
import mysql from 'mysql2/promise';

const OAUTH_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const API_ENDPOINT = 'https://advertising-api.amazon.com';

async function syncData() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  // 获取API凭证
  const [rows] = await connection.execute('SELECT * FROM amazon_api_credentials LIMIT 1');
  const creds = rows[0];
  
  if (!creds) {
    console.log('❌ 未找到API凭证');
    return;
  }
  
  console.log('========== 开始数据同步 ==========\n');
  console.log(`账号ID: ${creds.accountId}`);
  console.log(`Profile ID: ${creds.profileId}`);
  console.log(`区域: ${creds.region}\n`);
  
  // 获取Access Token
  console.log('🔄 获取Access Token...');
  const tokenResponse = await axios.post(OAUTH_TOKEN_URL, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  
  const accessToken = tokenResponse.data.access_token;
  console.log('✅ Token获取成功\n');
  
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Amazon-Advertising-API-ClientId': creds.clientId,
    'Amazon-Advertising-API-Scope': creds.profileId,
  };
  
  // 同步SP广告活动
  console.log('🔄 同步SP广告活动...');
  let spCampaigns = [];
  try {
    const spResponse = await axios.post(`${API_ENDPOINT}/sp/campaigns/list`, {}, {
      headers: {
        ...headers,
        'Content-Type': 'application/vnd.spCampaign.v3+json',
        'Accept': 'application/vnd.spCampaign.v3+json',
      },
    });
    spCampaigns = spResponse.data.campaigns || [];
    console.log(`✅ 获取到 ${spCampaigns.length} 个SP广告活动`);
  } catch (error) {
    console.log(`❌ SP广告活动获取失败: ${error.message}`);
  }
  
  // 同步SB广告活动（分页）
  console.log('\n🔄 同步SB广告活动...');
  let sbCampaigns = [];
  try {
    let nextToken = undefined;
    let pageCount = 0;
    
    do {
      const body = { maxResults: 100 };
      if (nextToken) body.nextToken = nextToken;
      
      const sbResponse = await axios.post(`${API_ENDPOINT}/sb/v4/campaigns/list`, body, {
        headers: {
          ...headers,
          'Content-Type': 'application/vnd.sbcampaignresource.v4+json',
          'Accept': 'application/vnd.sbcampaignresource.v4+json',
        },
      });
      
      const campaigns = sbResponse.data.campaigns || [];
      sbCampaigns.push(...campaigns);
      nextToken = sbResponse.data.nextToken;
      pageCount++;
      
      if (pageCount % 5 === 0) {
        console.log(`   已获取 ${sbCampaigns.length} 个SB广告活动...`);
      }
    } while (nextToken && pageCount < 50);
    
    console.log(`✅ 获取到 ${sbCampaigns.length} 个SB广告活动`);
  } catch (error) {
    console.log(`❌ SB广告活动获取失败: ${error.message}`);
  }
  
  // 同步SD广告活动
  console.log('\n🔄 同步SD广告活动...');
  let sdCampaigns = [];
  try {
    const sdResponse = await axios.get(`${API_ENDPOINT}/sd/campaigns`, {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    sdCampaigns = sdResponse.data || [];
    console.log(`✅ 获取到 ${sdCampaigns.length} 个SD广告活动`);
  } catch (error) {
    console.log(`❌ SD广告活动获取失败: ${error.message}`);
  }
  
  // 清空旧数据
  console.log('\n🔄 清空旧数据...');
  await connection.execute('DELETE FROM daily_performance');
  await connection.execute('DELETE FROM keywords');
  await connection.execute('DELETE FROM product_targets');
  await connection.execute('DELETE FROM ad_groups');
  await connection.execute('DELETE FROM campaigns');
  console.log('✅ 旧数据已清空');
  
  // 插入SP广告活动
  console.log('\n🔄 插入SP广告活动到数据库...');
  let spInserted = 0;
  for (const campaign of spCampaigns.slice(0, 500)) { // 限制500个以避免超时
    try {
      const campaignType = campaign.targetingType === 'auto' ? 'sp_auto' : 'sp_manual';
      await connection.execute(
        `INSERT INTO campaigns (accountId, campaignId, campaignName, campaignType, targetingType, dailyBudget, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          creds.accountId,
          String(campaign.campaignId),
          campaign.name,
          campaignType,
          campaign.targetingType || 'manual',
          String(campaign.dailyBudget || 0),
          campaign.state?.toLowerCase() || 'enabled'
        ]
      );
      spInserted++;
    } catch (error) {
      // 忽略重复插入错误
    }
  }
  console.log(`✅ 插入了 ${spInserted} 个SP广告活动`);
  
  // 插入SB广告活动
  console.log('\n🔄 插入SB广告活动到数据库...');
  let sbInserted = 0;
  for (const campaign of sbCampaigns.slice(0, 500)) {
    try {
      await connection.execute(
        `INSERT INTO campaigns (accountId, campaignId, campaignName, campaignType, targetingType, dailyBudget, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          creds.accountId,
          String(campaign.campaignId),
          campaign.name,
          'sb',
          'manual',
          String(campaign.budget?.budget || 0),
          campaign.state?.toLowerCase() || 'enabled'
        ]
      );
      sbInserted++;
    } catch (error) {
      // 忽略重复插入错误
    }
  }
  console.log(`✅ 插入了 ${sbInserted} 个SB广告活动`);
  
  // 插入SD广告活动
  console.log('\n🔄 插入SD广告活动到数据库...');
  let sdInserted = 0;
  for (const campaign of sdCampaigns) {
    try {
      await connection.execute(
        `INSERT INTO campaigns (accountId, campaignId, campaignName, campaignType, targetingType, dailyBudget, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          creds.accountId,
          String(campaign.campaignId),
          campaign.name,
          'sd',
          campaign.tactic || 'manual',
          String(campaign.budget || 0),
          campaign.state?.toLowerCase() || 'enabled'
        ]
      );
      sdInserted++;
    } catch (error) {
      // 忽略重复插入错误
    }
  }
  console.log(`✅ 插入了 ${sdInserted} 个SD广告活动`);
  
  // 更新最后同步时间
  await connection.execute(
    'UPDATE amazon_api_credentials SET lastSyncAt = NOW() WHERE id = ?',
    [creds.id]
  );
  
  console.log('\n========== 同步完成 ==========');
  console.log(`总计同步: ${spInserted + sbInserted + sdInserted} 个广告活动`);
  console.log(`- SP广告活动: ${spInserted}`);
  console.log(`- SB广告活动: ${sbInserted}`);
  console.log(`- SD广告活动: ${sdInserted}`);
  
  await connection.end();
}

syncData().catch(console.error);
