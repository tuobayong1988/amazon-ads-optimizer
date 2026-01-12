/**
 * 检查数据库中SB广告活动的预算数据
 */
import { getDb } from '../server/db';
import { campaigns, adAccounts } from '../drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

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

  // 查询SB广告活动的预算分布
  console.log('\n========== SB广告活动预算分布 ==========\n');

  // 获取前10个SB广告活动
  const sbCampaigns = await db
    .select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      dailyBudget: campaigns.dailyBudget,
      campaignStatus: campaigns.campaignStatus,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb')
    ))
    .limit(10);

  console.log('前10个SB广告活动:');
  for (const c of sbCampaigns) {
    console.log(`  ID: ${c.id}, 预算: ${c.dailyBudget}, 状态: ${c.campaignStatus}, 名称: ${c.campaignName?.substring(0, 50)}`);
  }

  // 统计预算分布
  const budgetStats = await db
    .select({
      budget: campaigns.dailyBudget,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb')
    ))
    .groupBy(campaigns.dailyBudget)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  console.log('\n预算分布统计 (前10):');
  for (const stat of budgetStats) {
    console.log(`  预算 ${stat.budget}: ${stat.count} 个`);
  }

  // 检查有多少预算为0或null的
  const [zeroCount] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb'),
      sql`(daily_budget IS NULL OR daily_budget = '0' OR daily_budget = '0.00')`
    ));

  console.log(`\n预算为0或NULL的SB广告活动: ${zeroCount.count} 个`);

  // 检查有多少预算大于0的
  const [nonZeroCount] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb'),
      sql`daily_budget IS NOT NULL AND daily_budget != '0' AND daily_budget != '0.00'`
    ));

  console.log(`预算大于0的SB广告活动: ${nonZeroCount.count} 个`);

  process.exit(0);
}

main().catch(console.error);
