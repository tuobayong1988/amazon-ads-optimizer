/**
 * 检查预算为0的广告活动状态分布
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

  // 检查预算为0的SB广告活动的状态分布
  console.log('\n========== 预算为0的SB广告活动状态分布 ==========\n');

  const zeroBudgetByStatus = await db
    .select({
      status: campaigns.campaignStatus,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb'),
      sql`(${campaigns.dailyBudget} IS NULL OR ${campaigns.dailyBudget} = '0' OR ${campaigns.dailyBudget} = '0.00')`
    ))
    .groupBy(campaigns.campaignStatus);

  console.log('预算为0的SB广告活动状态分布:');
  let totalZero = 0;
  for (const s of zeroBudgetByStatus) {
    console.log(`  ${s.status}: ${s.count}个`);
    totalZero += s.count;
  }
  console.log(`  总计: ${totalZero}个`);

  // 检查所有SB广告活动的状态分布
  console.log('\n========== 所有SB广告活动状态分布 ==========\n');

  const allByStatus = await db
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
  let totalAll = 0;
  for (const s of allByStatus) {
    console.log(`  ${s.status}: ${s.count}个`);
    totalAll += s.count;
  }
  console.log(`  总计: ${totalAll}个`);

  // 检查预算大于0的SB广告活动的状态分布
  console.log('\n========== 预算大于0的SB广告活动状态分布 ==========\n');

  const nonZeroBudgetByStatus = await db
    .select({
      status: campaigns.campaignStatus,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb'),
      sql`${campaigns.dailyBudget} IS NOT NULL AND ${campaigns.dailyBudget} != '0' AND ${campaigns.dailyBudget} != '0.00'`
    ))
    .groupBy(campaigns.campaignStatus);

  console.log('预算大于0的SB广告活动状态分布:');
  let totalNonZero = 0;
  for (const s of nonZeroBudgetByStatus) {
    console.log(`  ${s.status}: ${s.count}个`);
    totalNonZero += s.count;
  }
  console.log(`  总计: ${totalNonZero}个`);

  process.exit(0);
}

main().catch(console.error);
