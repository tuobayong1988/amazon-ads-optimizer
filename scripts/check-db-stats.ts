/**
 * 检查数据库中广告活动的统计信息
 */
import { getDb } from '../server/db';
import { campaigns, adAccounts } from '../drizzle/schema';
import { eq, sql, and } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('无法连接数据库');
    return;
  }

  console.log('========== 广告活动统计 ==========\n');

  // 按账户和类型统计
  const stats = await db
    .select({
      accountId: campaigns.accountId,
      campaignType: campaigns.campaignType,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .groupBy(campaigns.accountId, campaigns.campaignType)
    .orderBy(campaigns.accountId, campaigns.campaignType);

  console.log('按账户和类型统计:');
  for (const stat of stats) {
    console.log(`  账户ID ${stat.accountId}, ${stat.campaignType}: ${stat.count}`);
  }

  // 获取账户信息
  console.log('\n账户信息:');
  const accounts = await db.select().from(adAccounts);
  for (const account of accounts) {
    console.log(`  ID ${account.id}: ${account.accountName} (${account.marketplace})`);
  }

  // 按状态统计SB广告活动
  console.log('\n按状态统计SB广告活动:');
  const sbStats = await db
    .select({
      accountId: campaigns.accountId,
      status: campaigns.campaignStatus,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(eq(campaigns.campaignType, 'sb'))
    .groupBy(campaigns.accountId, campaigns.campaignStatus)
    .orderBy(campaigns.accountId, campaigns.campaignStatus);

  for (const stat of sbStats) {
    console.log(`  账户ID ${stat.accountId}, ${stat.status}: ${stat.count}`);
  }

  // 检查重复数据
  console.log('\n检查重复数据:');
  const duplicates = await db
    .select({
      accountId: campaigns.accountId,
      campaignId: campaigns.campaignId,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .groupBy(campaigns.accountId, campaigns.campaignId)
    .having(sql`count(*) > 1`);

  if (duplicates.length > 0) {
    console.log(`  发现 ${duplicates.length} 组重复数据`);
    for (const dup of duplicates.slice(0, 5)) {
      console.log(`    账户ID ${dup.accountId}, 广告活动ID ${dup.campaignId}: ${dup.count}条`);
    }
  } else {
    console.log('  没有发现重复数据');
  }

  // 检查US账户的SB广告活动数量
  console.log('\n检查US账户的SB广告活动:');
  const [usAccount] = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.marketplace, 'US'))
    .limit(1);

  if (usAccount) {
    const [usStats] = await db
      .select({
        total: sql<number>`count(*)`,
        enabled: sql<number>`sum(case when campaign_status = 'enabled' then 1 else 0 end)`,
        paused: sql<number>`sum(case when campaign_status = 'paused' then 1 else 0 end)`,
        archived: sql<number>`sum(case when campaign_status = 'archived' then 1 else 0 end)`,
      })
      .from(campaigns)
      .where(and(
        eq(campaigns.accountId, usAccount.id),
        eq(campaigns.campaignType, 'sb')
      ));

    console.log(`  US账户ID: ${usAccount.id}`);
    console.log(`  SB总数: ${usStats.total}`);
    console.log(`  enabled: ${usStats.enabled}`);
    console.log(`  paused: ${usStats.paused}`);
    console.log(`  archived: ${usStats.archived}`);
  }

  process.exit(0);
}

main().catch(console.error);
