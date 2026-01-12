/**
 * 强制重新同步SB广告活动数据，修复预算字段
 */
import { AmazonAdsApiClient } from '../server/amazonAdsApi';
import { getDb } from '../server/db';
import { campaigns, adAccounts, amazonApiCredentials } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('无法连接数据库');
    return;
  }

  // 获取US广告账户
  const [account] = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.marketplace, 'US'))
    .limit(1);

  if (!account) {
    console.error('没有找到US广告账户');
    return;
  }

  console.log('使用账户:', account.accountName, account.marketplace);

  // 获取API凭证
  const [cred] = await db
    .select()
    .from(amazonApiCredentials)
    .where(eq(amazonApiCredentials.accountId, account.id))
    .limit(1);

  if (!cred) {
    console.error('没有找到Amazon API凭证');
    return;
  }

  // 创建API客户端
  const client = new AmazonAdsApiClient({
    clientId: cred.clientId,
    clientSecret: cred.clientSecret,
    refreshToken: cred.refreshToken,
    profileId: account.profileId || '',
    region: 'NA' as const,
  });

  console.log('\n========== 重新同步SB广告活动 ==========\n');

  try {
    const sbCampaigns = await client.listSbCampaigns();
    console.log(`获取到 ${sbCampaigns.length} 个SB广告活动`);

    let updated = 0;
    let errors = 0;

    for (const apiCampaign of sbCampaigns) {
      try {
        // 解析预算 - SB API v4 的 budget 直接是数字
        let dailyBudget = 0;
        if (typeof apiCampaign.budget === 'number') {
          dailyBudget = apiCampaign.budget;
        } else if (apiCampaign.budget && typeof apiCampaign.budget === 'object') {
          dailyBudget = apiCampaign.budget.budget || apiCampaign.budget.dailyBudget || 0;
        }

        // budgetType 是独立字段
        const budgetType = (apiCampaign.budgetType || 'DAILY').toLowerCase();

        // 状态字段
        const campaignState = apiCampaign.state || apiCampaign.status || 'enabled';
        const normalizedState = campaignState.toLowerCase();

        // 更新数据库
        const result = await db
          .update(campaigns)
          .set({
            dailyBudget: String(dailyBudget),
            budgetType: budgetType as 'daily' | 'lifetime',
            campaignStatus: normalizedState as 'enabled' | 'paused' | 'archived',
            updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          })
          .where(and(
            eq(campaigns.accountId, account.id),
            eq(campaigns.campaignId, String(apiCampaign.campaignId))
          ));

        updated++;

        if (updated % 100 === 0) {
          console.log(`已更新 ${updated} 个广告活动...`);
        }
      } catch (err) {
        errors++;
        console.error(`更新广告活动 ${apiCampaign.campaignId} 失败:`, err);
      }
    }

    console.log(`\n同步完成: 更新 ${updated} 个, 错误 ${errors} 个`);

    // 验证更新结果
    console.log('\n验证更新结果...');
    const [sample] = await db
      .select()
      .from(campaigns)
      .where(and(
        eq(campaigns.accountId, account.id),
        eq(campaigns.campaignType, 'sb')
      ))
      .limit(1);

    if (sample) {
      console.log('示例广告活动:');
      console.log(`  名称: ${sample.campaignName}`);
      console.log(`  日预算: ${sample.dailyBudget}`);
      console.log(`  预算类型: ${sample.budgetType}`);
      console.log(`  状态: ${sample.campaignStatus}`);
    }

  } catch (error) {
    console.error('同步失败:', error);
  }

  process.exit(0);
}

main().catch(console.error);
