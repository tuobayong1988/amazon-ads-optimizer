/**
 * 检查CA账户的SB广告活动
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

  // 获取CA账户
  const [caAccount] = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.marketplace, 'CA'))
    .limit(1);

  if (!caAccount) {
    console.error('没有找到CA账户');
    return;
  }

  console.log('CA账户ID:', caAccount.id);

  // 检查CA账户SB广告活动状态分布
  console.log('\n========== CA账户SB广告活动状态分布 ==========\n');

  const caStatuses = await db
    .select({
      status: campaigns.campaignStatus,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, caAccount.id),
      eq(campaigns.campaignType, 'sb')
    ))
    .groupBy(campaigns.campaignStatus);

  console.log('CA账户SB广告活动状态分布:');
  for (const s of caStatuses) {
    console.log(`  ${s.status}: ${s.count}个`);
  }

  // 检查CA账户活跃SB广告活动的预算
  console.log('\n========== CA账户活跃SB广告活动 ==========\n');

  const caEnabledSb = await db
    .select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      dailyBudget: campaigns.dailyBudget,
      campaignStatus: campaigns.campaignStatus,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, caAccount.id),
      eq(campaigns.campaignType, 'sb'),
      eq(campaigns.campaignStatus, 'enabled')
    ))
    .limit(20);

  console.log(`CA账户活跃SB广告活动数量: ${caEnabledSb.length}个`);
  for (const c of caEnabledSb) {
    console.log(`  ID: ${c.id}, 预算: ${c.dailyBudget}, 状态: ${c.campaignStatus}`);
    console.log(`    名称: ${c.campaignName?.substring(0, 60)}`);
  }

  // 统计CA账户活跃SB广告活动总数
  const [caEnabledCount] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, caAccount.id),
      eq(campaigns.campaignType, 'sb'),
      eq(campaigns.campaignStatus, 'enabled')
    ));

  console.log(`\nCA账户活跃SB广告活动总数: ${caEnabledCount.count}`);

  // 检查所有账户的活跃SB广告活动总数
  console.log('\n========== 所有账户活跃SB广告活动 ==========\n');

  const allEnabledSb = await db
    .select({
      accountId: campaigns.accountId,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.campaignType, 'sb'),
      eq(campaigns.campaignStatus, 'enabled')
    ))
    .groupBy(campaigns.accountId);

  console.log('各账户活跃SB广告活动数量:');
  let total = 0;
  for (const a of allEnabledSb) {
    console.log(`  账户ID ${a.accountId}: ${a.count}个`);
    total += a.count;
  }
  console.log(`  总计: ${total}个`);

  process.exit(0);
}

main().catch(console.error);
