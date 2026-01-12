/**
 * 测试脚本：直接调用Amazon SB API查看返回的数据结构
 */
import { AmazonAdsApiClient } from '../server/amazonAdsApi';
import { getDb } from '../server/db';
import { adAccounts, amazonApiCredentials } from '../drizzle/schema';
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
  console.log('账户ID:', account.id);
  console.log('Profile ID:', account.profileId);

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

  console.log('找到API凭证, clientId:', cred.clientId.substring(0, 10) + '...');

  // 创建API客户端 - 使用正确的构造方式
  const client = new AmazonAdsApiClient({
    clientId: cred.clientId,
    clientSecret: cred.clientSecret,
    refreshToken: cred.refreshToken,
    profileId: account.profileId || '',
    region: 'NA' as const,
  });

  console.log('\n========== 测试SB广告活动API ==========\n');

  try {
    const sbCampaigns = await client.listSbCampaigns();
    console.log(`获取到 ${sbCampaigns.length} 个SB广告活动`);
    
    if (sbCampaigns.length > 0) {
      console.log('\n--- 第一个SB广告活动的完整结构 ---');
      console.log(JSON.stringify(sbCampaigns[0], null, 2));
      
      console.log('\n--- 预算字段分析 ---');
      const first = sbCampaigns[0];
      console.log('budget:', first.budget);
      console.log('dailyBudget:', first.dailyBudget);
      console.log('typeof budget:', typeof first.budget);
      
      if (first.budget && typeof first.budget === 'object') {
        console.log('budget.budget:', first.budget.budget);
        console.log('budget.dailyBudget:', first.budget.dailyBudget);
        console.log('budget.budgetType:', first.budget.budgetType);
      }
      
      console.log('\n--- 状态字段分析 ---');
      console.log('state:', first.state);
      console.log('status:', first.status);
      
      // 统计有预算的广告活动数量
      let withBudget = 0;
      let withoutBudget = 0;
      for (const c of sbCampaigns) {
        const budget = c.budget?.budget || c.budget?.dailyBudget || c.dailyBudget || (typeof c.budget === 'number' ? c.budget : 0);
        if (budget > 0) {
          withBudget++;
        } else {
          withoutBudget++;
        }
      }
      console.log(`\n有预算的广告活动: ${withBudget}`);
      console.log(`无预算的广告活动: ${withoutBudget}`);
      
      // 输出几个有预算的示例
      console.log('\n--- 有预算的广告活动示例 ---');
      let count = 0;
      for (const c of sbCampaigns) {
        const budget = c.budget?.budget || c.budget?.dailyBudget || c.dailyBudget || (typeof c.budget === 'number' ? c.budget : 0);
        if (budget > 0 && count < 3) {
          console.log(`\n${c.name}:`);
          console.log('  budget对象:', JSON.stringify(c.budget));
          console.log('  dailyBudget:', c.dailyBudget);
          console.log('  解析后的预算:', budget);
          count++;
        }
      }
    }
  } catch (error) {
    console.error('SB API调用失败:', error);
  }

  process.exit(0);
}

main().catch(console.error);
