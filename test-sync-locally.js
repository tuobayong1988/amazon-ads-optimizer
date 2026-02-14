const mysql = require('mysql2/promise');
const { AmazonSyncService } = require('./dist/server/amazonSyncService');

(async () => {
  try {
    // 连接数据库
    const conn = await mysql.createConnection('mysql://admin:Mucers2025@amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com:3306/amazon_ads_optimizer');
    
    // 获取API凭证 (accountId = 90021, 加拿大站点)
    const [creds] = await conn.execute('SELECT * FROM amazon_api_credentials WHERE account_id = 90021');
    
    if (creds.length === 0) {
      console.error('未找到API凭证');
      await conn.end();
      return;
    }
    
    const credentials = creds[0];
    console.log('[测试] 找到API凭证:', {
      accountId: credentials.account_id,
      profileId: credentials.profile_id,
      region: credentials.region
    });
    
    // 创建同步服务
    const syncService = await AmazonSyncService.createFromCredentials(
      {
        clientId: credentials.client_id,
        clientSecret: credentials.client_secret,
        refreshToken: credentials.refresh_token,
        profileId: credentials.profile_id,
        region: credentials.region,
      },
      credentials.account_id,
      390001, // userId
      'CA' // marketplace
    );
    
    console.log('[测试] 开始同步SP广告活动...');
    
    // 调用同步函数
    const result = await syncService.syncSpCampaignsWithTracking(null, null);
    
    console.log('[测试] 同步结果:', result);
    
    await conn.end();
  } catch (error) {
    console.error('[测试] 错误:', error);
    console.error('[测试] 错误堆栈:', error.stack);
  }
})();
