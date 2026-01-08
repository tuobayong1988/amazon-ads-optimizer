import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { eq, sql, and } from 'drizzle-orm';
import { mysqlTable, int, varchar, decimal, timestamp, text } from 'drizzle-orm/mysql-core';

// 定义表结构
const campaigns = mysqlTable('campaigns', {
  id: int('id').primaryKey().autoincrement(),
  accountId: int('accountId'),
  campaignName: varchar('campaignName', { length: 255 }),
  campaignType: varchar('campaignType', { length: 50 }),
  impressions: int('impressions'),
  clicks: int('clicks'),
  spend: decimal('spend', { precision: 10, scale: 2 }),
  sales: decimal('sales', { precision: 10, scale: 2 }),
  orders: int('orders'),
});

const dailyPerformance = mysqlTable('daily_performance', {
  id: int('id').primaryKey().autoincrement(),
  accountId: int('accountId'),
  campaignId: int('campaignId'),
  date: varchar('date', { length: 10 }),
  impressions: int('impressions'),
  clicks: int('clicks'),
  spend: decimal('spend', { precision: 10, scale: 2 }),
  sales: decimal('sales', { precision: 10, scale: 2 }),
  orders: int('orders'),
  dailyAcos: decimal('dailyAcos', { precision: 10, scale: 2 }),
  dailyRoas: decimal('dailyRoas', { precision: 10, scale: 2 }),
  createdAt: timestamp('createdAt'),
});

async function main() {
  // 从 DATABASE_URL 解析连接信息
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL 未设置');
    process.exit(1);
  }
  
  const url = new URL(dbUrl);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port || '3306'),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: false }
  });

  const db = drizzle(connection);

  console.log('连接数据库成功');

  // 获取所有campaigns
  const allCampaigns = await db.select().from(campaigns);
  console.log(`找到 ${allCampaigns.length} 个广告活动`);

  let synced = 0;
  const days = 7;

  for (const campaign of allCampaigns) {
    // 为每个广告活动生成最近N天的模拟数据
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      // 检查是否已存在当天数据
      const [existing] = await db
        .select()
        .from(dailyPerformance)
        .where(
          and(
            eq(dailyPerformance.campaignId, campaign.id),
            sql`${dailyPerformance.date} = ${dateStr}`
          )
        )
        .limit(1);

      if (existing) continue;

      // 生成基于广告活动类型的模拟数据
      const baseImpressions = (campaign.campaignType === 'sp_auto' || campaign.campaignType === 'sp_manual') ? 5000 : 
                              campaign.campaignType === 'sb' ? 3000 : 2000;
      const baseCtr = 0.02 + Math.random() * 0.03; // 2-5% CTR
      const baseCvr = 0.05 + Math.random() * 0.1; // 5-15% CVR
      const baseCpc = 0.5 + Math.random() * 1.5; // $0.5-2 CPC
      const baseAov = 20 + Math.random() * 80; // $20-100 AOV

      const impressions = Math.floor(baseImpressions * (0.7 + Math.random() * 0.6));
      const clicks = Math.floor(impressions * baseCtr);
      const orders = Math.floor(clicks * baseCvr);
      const spend = clicks * baseCpc;
      const sales = orders * baseAov;

      const perfData = {
        accountId: campaign.accountId,
        campaignId: campaign.id,
        date: dateStr,
        impressions,
        clicks,
        spend: spend.toFixed(2),
        sales: sales.toFixed(2),
        orders,
        dailyAcos: sales > 0 ? ((spend / sales) * 100).toFixed(2) : '0',
        dailyRoas: spend > 0 ? (sales / spend).toFixed(2) : '0',
      };

      await db.insert(dailyPerformance).values(perfData);
      synced++;
    }

    // 更新campaign的绩效汇总
    const [perfSummary] = await db
      .select({
        totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
        totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
        totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
        totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      })
      .from(dailyPerformance)
      .where(eq(dailyPerformance.campaignId, campaign.id));

    if (perfSummary) {
      await db.update(campaigns)
        .set({
          impressions: Number(perfSummary.totalImpressions),
          clicks: Number(perfSummary.totalClicks),
          spend: String(perfSummary.totalSpend),
          sales: String(perfSummary.totalSales),
          orders: Number(perfSummary.totalOrders),
        })
        .where(eq(campaigns.id, campaign.id));
    }
  }

  console.log(`模拟绩效数据生成完成: ${synced} 条记录`);
  
  // 验证数据
  const [summary] = await db.select({
    totalSpend: sql`COALESCE(SUM(${campaigns.spend}), 0)`,
    totalSales: sql`COALESCE(SUM(${campaigns.sales}), 0)`,
    totalOrders: sql`COALESCE(SUM(${campaigns.orders}), 0)`,
  }).from(campaigns);
  
  console.log('绩效数据汇总:');
  console.log(`  总花费: $${Number(summary.totalSpend).toFixed(2)}`);
  console.log(`  总销售额: $${Number(summary.totalSales).toFixed(2)}`);
  console.log(`  总订单: ${summary.totalOrders}`);

  await connection.end();
}

main().catch(console.error);
