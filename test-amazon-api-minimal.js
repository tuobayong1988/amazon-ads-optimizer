const mysql = require('mysql2/promise');
const { AmazonAdsApiClient } = require('./dist/index.js');

(async () => {
  try {
    const conn = await mysql.createConnection('mysql://admin:Mucers2025@amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com:3306/amazon_ads_optimizer');
    
    const [creds] = await conn.execute('SELECT * FROM amazon_api_credentials WHERE accountId = 90021');
    
    if (creds.length === 0) {
      console.error('未找到API凭证');
      await conn.end();
      return;
    }
    
    const credentials = creds[0];
    console.log('[测试] 找到API凭证');
    
    const client = new AmazonAdsApiClient({
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
      refreshToken: credentials.refresh_token,
      profileId: credentials.profile_id,
      region: credentials.region,
    });
    
    console.log('[测试] 开始调用listSpCampaigns...');
    const campaigns = await client.listSpCampaigns();
    
    console.log(`[测试] API返回 ${campaigns.length} 条SP广告活动`);
    console.log('[测试] 第一条数据:', JSON.stringify(campaigns[0], null, 2));
    
    await conn.end();
  } catch (error) {
    console.error('[测试] 错误:', error.message);
    console.error('[测试] 错误堆栈:', error.stack);
  }
})();
