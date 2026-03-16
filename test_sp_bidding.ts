/**
 * 测试脚本：检查Amazon SP API返回的campaigns数据中是否包含bidding.adjustments
 */
import { AmazonAdsApiClient } from './server/sync/amazonAdsApi';
import * as db from './server/db/credentials';

// 设置环境变量
process.env.ENCRYPTION_KEY = '7363126460d7af8e27df175529b1b0a91b3c2e232df240cc4211c998860791e1';
process.env.DATABASE_URL = 'mysql://admin:Mucers2025@amazon-ads-db-new.cmlwa8ie0y7a.us-east-1.rds.amazonaws.com:3306/amazon_ads_optimizer';

async function testSpBidding() {
  try {
    // 获取账户90021 (ElaraFit CA) 的凭证
    const credentials = await db.getAmazonApiCredentials(90021);
    if (!credentials) {
      console.error('No credentials found for account 90021');
      process.exit(1);
    }
    
    console.log('Got credentials for account 90021, profileId:', credentials.profileId);
    
    const client = new AmazonAdsApiClient({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      profileId: credentials.profileId,
      region: credentials.region as 'NA' | 'EU' | 'FE',
    });
    
    // 调用listSpCampaigns
    console.log('Calling listSpCampaigns...');
    const campaigns = await client.listSpCampaigns();
    console.log(`Got ${campaigns.length} SP campaigns`);
    
    // 检查前5个campaigns的bidding数据
    for (let i = 0; i < Math.min(5, campaigns.length); i++) {
      const c = campaigns[i] as Record<string, any>;
      console.log(`\n=== Campaign ${i + 1}: ${c.name} ===`);
      console.log('campaignId:', c.campaignId);
      console.log('bidding:', JSON.stringify(c.bidding, null, 2));
      console.log('dynamicBidding:', JSON.stringify(c.dynamicBidding, null, 2));
      console.log('All keys:', Object.keys(c));
      
      // 打印完整结构（第一个）
      if (i === 0) {
        console.log('\n=== FULL STRUCTURE ===');
        console.log(JSON.stringify(c, null, 2));
      }
    }
    
    // 统计有bidding.adjustments的campaigns数量
    let withAdjustments = 0;
    let withBidding = 0;
    for (const c of campaigns) {
      const campaign = c as Record<string, any>;
      if (campaign.bidding) {
        withBidding++;
        if (campaign.bidding.adjustments && campaign.bidding.adjustments.length > 0) {
          withAdjustments++;
          console.log(`\nCampaign with adjustments: ${campaign.name}`);
          console.log('  adjustments:', JSON.stringify(campaign.bidding.adjustments));
        }
      }
    }
    
    console.log(`\n=== SUMMARY ===`);
    console.log(`Total campaigns: ${campaigns.length}`);
    console.log(`With bidding: ${withBidding}`);
    console.log(`With adjustments: ${withAdjustments}`);
    
  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
  
  process.exit(0);
}

testSpBidding();
