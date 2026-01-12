/**
 * 检查活跃SB广告活动的预算数据
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

  // 检查活跃SB广告活动
  console.log('\n========== 活跃SB广告活动 ==========\n');

  const enabledSbCampaigns = await db
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
      eq(campaigns.campaignStatus, 'enabled')
    ))
    .limit(20);

  console.log(`活跃SB广告活动数量: ${enabledSbCampaigns.length}个 (前20个)`);
  for (const c of enabledSbCampaigns) {
    console.log(`  ID: ${c.id}, campaignId: ${c.campaignId}, 预算: ${c.dailyBudget}, 状态: ${c.campaignStatus}`);
    console.log(`    名称: ${c.campaignName?.substring(0, 60)}`);
    console.log(`    创建时间: ${c.createdAt}`);
  }

  // 统计活跃SB广告活动总数
  const [enabledCount] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb'),
      eq(campaigns.campaignStatus, 'enabled')
    ));

  console.log(`\n活跃SB广告活动总数: ${enabledCount.count}`);

  // 检查活跃SB广告活动的预算分布
  console.log('\n========== 活跃SB广告活动预算分布 ==========\n');

  const enabledBudgetStats = await db
    .select({
      zeroBudget: sql<number>`SUM(CASE WHEN ${campaigns.dailyBudget} IS NULL OR ${campaigns.dailyBudget} = '0' OR ${campaigns.dailyBudget} = '0.00' THEN 1 ELSE 0 END)`,
      nonZeroBudget: sql<number>`SUM(CASE WHEN ${campaigns.dailyBudget} IS NOT NULL AND ${campaigns.dailyBudget} != '0' AND ${campaigns.dailyBudget} != '0.00' THEN 1 ELSE 0 END)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb'),
      eq(campaigns.campaignStatus, 'enabled')
    ));

  console.log(`预算为0的活跃SB广告活动: ${enabledBudgetStats[0].zeroBudget}个`);
  console.log(`预算大于0的活跃SB广告活动: ${enabledBudgetStats[0].nonZeroBudget}个`);

  // 检查是否有"投放中"状态的广告活动（前端可能显示的状态）
  console.log('\n========== 检查其他可能的状态值 ==========\n');

  const allStatuses = await db
    .select({
      status: campaigns.campaignStatus,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb')
    ))
    .groupBy(campaigns.campaignStatus);

  console.log('所有SB广告活动状态分布:');
  for (const s of allStatuses) {
    console.log(`  ${s.status}: ${s.count}个`);
  }

  process.exit(0);
}

main().catch(console.error);
