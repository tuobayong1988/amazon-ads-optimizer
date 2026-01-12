/**
 * 检查特定SB广告活动的预算数据
 */
import { getDb } from '../server/db';
import { campaigns, adAccounts } from '../drizzle/schema';
import { eq, and, like, sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('无法连接数据库');
    return;
  }

  // 获取US账户
  const [usAccount] = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.marketplace, 'US'))
    .limit(1);

  if (!usAccount) {
    console.error('没有找到US账户');
    return;
  }

  console.log('US账户ID:', usAccount.id);

  // 查询2025.12.26创建的SB广告活动
  console.log('\n========== 2025.12.26创建的SB广告活动 ==========\n');

  const recentSbCampaigns = await db
    .select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      dailyBudget: campaigns.dailyBudget,
      campaignStatus: campaigns.campaignStatus,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb'),
      like(campaigns.campaignName, '2025.12.26%')
    ))
    .limit(20);

  console.log(`找到 ${recentSbCampaigns.length} 个2025.12.26创建的SB广告活动:`);
  for (const c of recentSbCampaigns) {
    console.log(`  ID: ${c.id}, campaignId: ${c.campaignId}, 预算: ${c.dailyBudget}, 状态: ${c.campaignStatus}`);
    console.log(`    名称: ${c.campaignName?.substring(0, 60)}`);
  }

  // 查询预算为0的SB广告活动数量
  console.log('\n========== 预算为0的SB广告活动 ==========\n');

  const zeroBudgetCampaigns = await db
    .select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      dailyBudget: campaigns.dailyBudget,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb'),
      sql`(${campaigns.dailyBudget} IS NULL OR ${campaigns.dailyBudget} = '0' OR ${campaigns.dailyBudget} = '0.00')`
    ))
    .limit(10);

  console.log(`预算为0的SB广告活动示例 (前10个):`);
  for (const c of zeroBudgetCampaigns) {
    console.log(`  ID: ${c.id}, campaignId: ${c.campaignId}, 预算: ${c.dailyBudget}`);
    console.log(`    名称: ${c.campaignName?.substring(0, 60)}`);
  }

  // 统计预算为0的数量
  const [zeroCount] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb'),
      sql`(${campaigns.dailyBudget} IS NULL OR ${campaigns.dailyBudget} = '0' OR ${campaigns.dailyBudget} = '0.00')`
    ));

  console.log(`\n预算为0或NULL的SB广告活动总数: ${zeroCount.count}`);

  process.exit(0);
}

main().catch(console.error);
