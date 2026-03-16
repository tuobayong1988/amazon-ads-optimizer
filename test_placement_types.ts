/**
 * 测试脚本：检查Amazon SP API返回的所有placement类型
 */
import { AmazonAdsApiClient } from './server/sync/amazonAdsApi';
import * as db from './server/db/credentials';

process.env.ENCRYPTION_KEY = '7363126460d7af8e27df175529b1b0a91b3c2e232df240cc4211c998860791e1';
process.env.DATABASE_URL = 'mysql://admin:Mucers2025@amazon-ads-db-new.cmlwa8ie0y7a.us-east-1.rds.amazonaws.com:3306/amazon_ads_optimizer';

async function test() {
  const accountIds = [90021, 90022, 90023];
  
  for (const accountId of accountIds) {
    const creds = await db.getAmazonApiCredentials(accountId);
    if (!creds) {
      console.log(`No credentials for account ${accountId}`);
      continue;
    }
    
    const client = new AmazonAdsApiClient({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      profileId: creds.profileId,
      region: creds.region as 'NA' | 'EU' | 'FE',
    });
    
    try {
      const campaigns = await client.listSpCampaigns();
      const placementTypes = new Set<string>();
      const strategyTypes = new Set<string>();
      let withPlacements = 0;
      
      for (const c of campaigns) {
        const camp = c as any;
        if (camp.dynamicBidding) {
          strategyTypes.add(camp.dynamicBidding.strategy);
          if (camp.dynamicBidding.placementBidding && camp.dynamicBidding.placementBidding.length > 0) {
            withPlacements++;
            for (const p of camp.dynamicBidding.placementBidding) {
              placementTypes.add(p.placement);
            }
          }
        }
      }
      
      console.log(`\n=== Account ${accountId} ===`);
      console.log(`Total SP campaigns: ${campaigns.length}`);
      console.log(`With placement adjustments: ${withPlacements}`);
      console.log(`Placement types found: ${[...placementTypes].join(', ')}`);
      console.log(`Strategy types found: ${[...strategyTypes].join(', ')}`);
    } catch (err: any) {
      console.log(`Account ${accountId} error: ${err.message}`);
    }
  }
  
  process.exit(0);
}

test();
