const axios = require('axios');

async function testSpApi() {
  // 从环境变量获取凭证
  const clientId = process.env.AMAZON_ADS_CLIENT_ID;
  const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET;
  
  console.log('Client ID:', clientId ? clientId.substring(0, 10) + '...' : 'NOT SET');
  console.log('Client Secret:', clientSecret ? 'SET' : 'NOT SET');
  
  // 先获取refresh token
  // 这里需要从数据库获取
  console.log('\n需要从数据库获取refresh token和profile id来测试API');
}

testSpApi().catch(console.error);
