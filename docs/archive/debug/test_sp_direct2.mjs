import axios from 'axios';
import mysql from 'mysql2/promise';

async function testSpApiDirect() {
  try {
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET;
    
    console.log('=== Amazon SP API 直接测试 ===\n');
    console.log('Client ID:', clientId ? clientId.substring(0, 20) + '...' : 'NOT SET');
    
    // 连接数据库获取凭证
    console.log('\n连接数据库...');
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });
    
    console.log('数据库连接成功');
    
    const [rows] = await connection.execute('SELECT refreshToken, profileId, region FROM amazon_api_credentials LIMIT 1');
    await connection.end();
    
    console.log('查询结果行数:', rows.length);
    
    if (rows.length === 0) {
      console.log('没有找到API凭证');
      return;
    }
    
    const { refreshToken, profileId, region } = rows[0];
    console.log('Profile ID:', profileId);
    console.log('Region:', region);
    console.log('Refresh Token:', refreshToken ? refreshToken.substring(0, 20) + '...' : 'NOT SET');
    
    if (!refreshToken) {
      console.log('Refresh Token为空，无法继续测试');
      return;
    }
    
    // 获取access token
    console.log('\n1. 获取Access Token...');
    const tokenResponse = await axios.post('https://api.amazon.com/auth/o2/token', 
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    
    const accessToken = tokenResponse.data.access_token;
    console.log('Access Token获取成功:', accessToken.substring(0, 20) + '...');
    
    // 确定API端点
    const endpoints = {
      NA: 'https://advertising-api.amazon.com',
      EU: 'https://advertising-api-eu.amazon.com',
      FE: 'https://advertising-api-fe.amazon.com',
    };
    const baseUrl = endpoints[region] || endpoints.NA;
    console.log('API Endpoint:', baseUrl);
    
    // 测试SP campaigns API
    console.log('\n2. 测试SP Campaigns API...');
    
    // 测试不同的header组合
    const headerCombinations = [
      {
        name: '组合1: vnd.spCampaign.v3+json',
        headers: {
          'Content-Type': 'application/vnd.spCampaign.v3+json',
          'Accept': 'application/vnd.spCampaign.v3+json',
        }
      },
      {
        name: '组合2: application/json',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      },
    ];
    
    for (const combo of headerCombinations) {
      console.log(`\n尝试 ${combo.name}...`);
      try {
        const response = await axios.post(`${baseUrl}/sp/campaigns/list`, {}, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Amazon-Advertising-API-ClientId': clientId,
            'Amazon-Advertising-API-Scope': profileId,
            ...combo.headers,
          },
        });
        console.log('✅ 成功! 返回', response.data.campaigns?.length || 0, '个广告活动');
        console.log('响应数据示例:', JSON.stringify(response.data).substring(0, 200));
        return; // 成功就退出
      } catch (error) {
        console.log('❌ 失败:', error.response?.status, error.response?.statusText);
        if (error.response?.data) {
          console.log('错误详情:', JSON.stringify(error.response.data).substring(0, 300));
        }
      }
    }
  } catch (err) {
    console.error('测试过程中出错:', err.message);
    if (err.response) {
      console.error('响应状态:', err.response.status);
      console.error('响应数据:', JSON.stringify(err.response.data));
    }
  }
}

testSpApiDirect();
