/**
 * 强制更新所有SB广告活动的预算
 * 使用正确的API凭证创建方式
 */
import { getDb } from '../server/db';
import { campaigns, adAccounts, amazonApiCredentials } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { AmazonAdsApiClient, MARKETPLACE_TO_REGION } from '../server/amazonAdsApi';

async function forceUpdateSbBudgets() {
  const db = await getDb();
  if (!db) {
    console.error('数据库连接失败');
    return;
  }

  // 从环境变量获取clientId和clientSecret
  const clientId = process.env.AMAZON_ADS_CLIENT_ID;
  const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('缺少环境变量: AMAZON_ADS_CLIENT_ID 或 AMAZON_ADS_CLIENT_SECRET');
    return;
  }

  console.log('ClientId:', clientId.substring(0, 10) + '...');

  // 获取所有账户
  const accounts = await db.select().from(adAccounts);
  console.log(`找到 ${accounts.length} 个账户`);

  for (const account of accounts) {
    console.log(`\n处理账户: ${account.accountName} (${account.marketplace})`);

    // 获取API凭证
    const [credentials] = await db
      .select()
      .from(amazonApiCredentials)
      .where(eq(amazonApiCredentials.accountId, account.id))
      .limit(1);

    if (!credentials || !credentials.refreshToken) {
      console.log(`  跳过: 没有有效的API凭证`);
      continue;
    }

    console.log('  RefreshToken:', credentials.refreshToken.substring(0, 20) + '...');

    // 确定区域
    const region = MARKETPLACE_TO_REGION[account.marketplace] || 'NA';
    console.log('  Region:', region);

    try {
      // 创建API客户端（使用正确的凭证结构）
      const client = new AmazonAdsApiClient({
        clientId: clientId,
        clientSecret: clientSecret,
        refreshToken: credentials.refreshToken,
        profileId: account.profileId,
        region: region,
      });

      // 获取SB广告活动
      console.log(`  正在从API获取SB广告活动...`);
      const apiCampaigns = await client.listSbCampaigns();
      console.log(`  API返回 ${apiCampaigns.length} 个SB广告活动`);

      if (apiCampaigns.length === 0) {
        console.log(`  跳过: 没有SB广告活动`);
        continue;
      }

      // 输出第一个广告活动的结构
      console.log(`  API数据结构示例:`, JSON.stringify(apiCampaigns[0], null, 2));

      let updated = 0;
      let notFound = 0;
      let errors = 0;

      for (const apiCampaign of apiCampaigns) {
        try {
          // 解析预算
          let dailyBudget = 0;
          if (typeof apiCampaign.budget === 'number') {
            dailyBudget = apiCampaign.budget;
          } else if (apiCampaign.budget && typeof apiCampaign.budget === 'object') {
            dailyBudget = (apiCampaign.budget as any).budget || (apiCampaign.budget as any).dailyBudget || 0;
          } else if ((apiCampaign as any).dailyBudget) {
            dailyBudget = (apiCampaign as any).dailyBudget;
          }

          const budgetType = ((apiCampaign as any).budgetType || 'DAILY').toLowerCase();
          const campaignState = ((apiCampaign as any).state || (apiCampaign as any).status || 'enabled').toLowerCase();

          // 查找数据库中的记录
          const [existing] = await db
            .select()
            .from(campaigns)
            .where(
              and(
                eq(campaigns.accountId, account.id),
                eq(campaigns.campaignId, String(apiCampaign.campaignId))
              )
            )
            .limit(1);

          if (existing) {
            // 更新记录
            await db
              .update(campaigns)
              .set({
                dailyBudget: String(dailyBudget),
                budgetType: budgetType as 'daily' | 'lifetime',
                campaignStatus: campaignState as 'enabled' | 'paused' | 'archived',
                updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
              })
              .where(eq(campaigns.id, existing.id));
            updated++;
          } else {
            notFound++;
          }
        } catch (err) {
          errors++;
          console.error(`  错误处理广告活动 ${apiCampaign.campaignId}:`, err);
        }
      }

      console.log(`  更新完成: ${updated} 个更新, ${notFound} 个未找到, ${errors} 个错误`);
    } catch (error: any) {
      console.error(`  API调用失败:`, error.message || error);
    }
  }

  console.log('\n全部完成!');
  process.exit(0);
}

forceUpdateSbBudgets().catch(console.error);
