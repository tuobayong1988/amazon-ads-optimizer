import { getDb } from '../server/db';
import { campaigns } from '../drizzle/schema';
import { sql, isNull, isNotNull } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('Failed to connect to database');
    return;
  }

  // 查询startDate分布
  const withDate = await db.select({ count: sql<number>`count(*)` })
    .from(campaigns)
    .where(isNotNull(campaigns.startDate));
  
  const withoutDate = await db.select({ count: sql<number>`count(*)` })
    .from(campaigns)
    .where(isNull(campaigns.startDate));

  console.log('有startDate的记录:', withDate[0]?.count || 0);
  console.log('无startDate的记录:', withoutDate[0]?.count || 0);

  // 查看几条记录的详情
  const samples = await db.select({
    id: campaigns.id,
    name: campaigns.campaignName,
    startDate: campaigns.startDate,
    createdAt: campaigns.createdAt
  })
  .from(campaigns)
  .limit(5);

  console.log('样本数据:', samples);
}

main().catch(console.error);
