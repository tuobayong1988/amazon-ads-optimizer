// 测试绩效数据同步的独立脚本
import { AmazonAdsApi } from './server/amazonAdsApi.ts';

async function testPerformanceSync() {
  console.log('=== 测试绩效数据同步 ===\n');
  
  // 从数据库获取凭证
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
  });
  
  // 获取第一个有凭证的账号
  const [rows] = await conn.execute(`
    SELECT * FROM amazon_api_credentials 
    WHERE refresh_token IS NOT NULL 
    LIMIT 1
  `);
  
  if (rows.length === 0) {
    console.log('没有找到有效的API凭证');
    await conn.end();
    return;
  }
  
  const creds = rows[0];
  console.log('使用账号:', creds.account_id);
  console.log('Profile ID:', creds.profile_id);
  console.log('Region:', creds.region);
  
  // 创建API客户端
  const api = new AmazonAdsApi({
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
    refreshToken: creds.refresh_token,
    profileId: creds.profile_id,
    region: creds.region || 'NA'
  });
  
  // 设置日期范围（最近7天）
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  console.log(`\n日期范围: ${startDateStr} - ${endDateStr}\n`);
  
  try {
    // 1. 请求报告
    console.log('1. 请求SP广告活动报告...');
    const reportId = await api.requestSpCampaignReport(startDateStr, endDateStr);
    console.log('报告ID:', reportId);
    
    // 2. 等待并下载报告
    console.log('\n2. 等待报告完成并下载...');
    const reportData = await api.waitAndDownloadReport(reportId);
    
    console.log('\n3. 报告数据:');
    console.log('数据条数:', reportData?.length || 0);
    
    if (reportData && reportData.length > 0) {
      console.log('\n第一条数据示例:');
      console.log(JSON.stringify(reportData[0], null, 2));
      
      // 统计汇总
      let totalImpressions = 0;
      let totalClicks = 0;
      let totalCost = 0;
      let totalSales = 0;
      
      for (const row of reportData) {
        totalImpressions += row.impressions || 0;
        totalClicks += row.clicks || 0;
        totalCost += row.cost || 0;
        totalSales += row.sales14d || 0;
      }
      
      console.log('\n汇总数据:');
      console.log('总曝光:', totalImpressions);
      console.log('总点击:', totalClicks);
      console.log('总花费:', totalCost);
      console.log('总销售:', totalSales);
    }
    
  } catch (error) {
    console.error('错误:', error.message);
    if (error.response) {
      console.error('响应数据:', error.response.data);
    }
  }
  
  await conn.end();
}

testPerformanceSync().catch(console.error);
