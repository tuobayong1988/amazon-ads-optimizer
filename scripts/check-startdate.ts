import { db } from '../server/db';
import { campaigns } from '../drizzle/schema';
import { isNotNull, sql } from 'drizzle-orm';

async function checkStartDate() {
  // 查询有startDate的广告活动
  const result = await db.select({
    id: campaigns.id,
    campaignName: campaigns.campaignName,
    campaignType: campaigns.campaignType,
    startDate: campaigns.startDate,
    endDate: campaigns.endDate,
    campaignStatus: campaigns.campaignStatus,
    dailyBudget: campaigns.dailyBudget
  })
  .from(campaigns)
  .where(isNotNull(campaigns.startDate))
  .limit(20);
  
  console.log('=== Campaigns with startDate ===');
  console.log(JSON.stringify(result, null, 2));
  
  // 统计有startDate的广告活动数量
  const countResult = await db.select({
    total: sql<number>`COUNT(*)`,
    withStartDate: sql<number>`SUM(CASE WHEN start_date IS NOT NULL THEN 1 ELSE 0 END)`,
    withoutStartDate: sql<number>`SUM(CASE WHEN start_date IS NULL THEN 1 ELSE 0 END)`
  })
  .from(campaigns);
  
  console.log('\n=== Statistics ===');
  console.log(JSON.stringify(countResult, null, 2));
  
  process.exit(0);
}

checkStartDate().catch(console.error);
