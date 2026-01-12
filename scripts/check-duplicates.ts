/**
 * 检查重复的campaignId
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

  // 检查是否有重复的campaignId
  console.log('\n========== 检查重复的campaignId ==========\n');

  const duplicates = await db
    .select({
      campaignId: campaigns.campaignId,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb')
    ))
    .groupBy(campaigns.campaignId)
    .having(sql`count(*) > 1`)
    .limit(20);

  console.log(`找到 ${duplicates.length} 个重复的campaignId:`);
  for (const d of duplicates) {
    console.log(`  campaignId: ${d.campaignId}, 数量: ${d.count}`);
  }

  // 检查总的SB广告活动数量
  const [totalCount] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb')
    ));

  console.log(`\nSB广告活动总数: ${totalCount.count}`);

  // 检查唯一campaignId数量
  const [uniqueCount] = await db
    .select({
      count: sql<number>`count(distinct ${campaigns.campaignId})`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb')
    ));

  console.log(`唯一campaignId数量: ${uniqueCount.count}`);
  console.log(`重复记录数: ${totalCount.count - uniqueCount.count}`);

  // 检查ID范围分布
  console.log('\n========== ID范围分布 ==========\n');

  const idRanges = await db
    .select({
      minId: sql<number>`min(id)`,
      maxId: sql<number>`max(id)`,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb')
    ));

  for (const r of idRanges) {
    console.log(`  ID范围: ${r.minId} - ${r.maxId}, 数量: ${r.count}`);
  }

  // 按ID范围分组
  const rangeStats = await db
    .select({
      idRange: sql<string>`CASE 
        WHEN id < 130000 THEN '< 130000'
        WHEN id < 140000 THEN '130000-140000'
        WHEN id < 150000 THEN '140000-150000'
        ELSE '>= 150000'
      END`,
      count: sql<number>`count(*)`,
      avgBudget: sql<string>`avg(CAST(daily_budget AS DECIMAL(10,2)))`,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, usAccount.id),
      eq(campaigns.campaignType, 'sb')
    ))
    .groupBy(sql`CASE 
      WHEN id < 130000 THEN '< 130000'
      WHEN id < 140000 THEN '130000-140000'
      WHEN id < 150000 THEN '140000-150000'
      ELSE '>= 150000'
    END`);

  console.log('\n按ID范围统计:');
  for (const s of rangeStats) {
    console.log(`  ${s.idRange}: ${s.count}个, 平均预算: $${parseFloat(s.avgBudget || '0').toFixed(2)}`);
  }

  process.exit(0);
}

main().catch(console.error);
