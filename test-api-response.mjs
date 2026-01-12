import { AmazonAdsApiClient } from './server/amazonAdsApi.js';
import { getDb } from './server/db.js';
import { amazonApiCredentials, adAccounts } from './drizzle/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.log('数据库连接失败');
    return;
  }

  // 获取US账号的凭据
  const [account] = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.marketplace, 'US'))
    .limit(1);

  if (!account) {
    console.log('未找到US账号');
    return;
  }

  console.log('找到账号:', account.accountId, account.marketplace);

  const [credentials] = await db
    .select()
    .from(amazonApiCredentials)
    .where(eq(amazonApiCredentials.accountId, account.id))
    .limit(1);

  if (!credentials) {
    console.log('未找到凭据');
    return;
  }

  console.log('找到凭据, 创建API客户端...');

  const client = new AmazonAdsApiClient(
    credentials.refreshToken,
    account.profileId,
    account.marketplace
  );

  console.log('调用listSpCampaigns...');
  const campaigns = await client.listSpCampaigns();
  
  console.log(`获取到 ${campaigns.length} 个SP广告活动`);
  
  if (campaigns.length > 0) {
    console.log('\n第一个广告活动的完整结构:');
    console.log(JSON.stringify(campaigns[0], null, 2));
    
    console.log('\n所有广告活动的startDate字段:');
    campaigns.slice(0, 5).forEach((c, i) => {
      console.log(`  ${i+1}. ${c.name}: startDate=${c.startDate}, endDate=${c.endDate}`);
    });
  }

  process.exit(0);
}

main().catch(console.error);
