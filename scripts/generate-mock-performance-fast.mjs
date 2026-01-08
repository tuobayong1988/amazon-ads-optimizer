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

  console.log('连接数据库成功');

  const days = 7;
  
  // 生成日期列表
  const dates = [];
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }
  
  // 使用原生SQL批量更新campaigns表的绩效数据
  console.log('开始批量更新campaigns表的绩效数据...');
  
  // 为每个campaign生成随机绩效数据并直接更新
  const [campaignRows] = await connection.execute('SELECT id, accountId, campaignType FROM campaigns');
  console.log(`找到 ${campaignRows.length} 个广告活动`);
  
  // 批量更新campaigns表
  let updated = 0;
  const batchSize = 500;
  
  for (let i = 0; i < campaignRows.length; i += batchSize) {
    const batch = campaignRows.slice(i, i + batchSize);
    
    // 构建批量更新SQL
    const updates = batch.map(campaign => {
      const baseImpressions = (campaign.campaignType === 'sp_auto' || campaign.campaignType === 'sp_manual') ? 5000 : 
                              campaign.campaignType === 'sb' ? 3000 : 2000;
      const baseCtr = 0.02 + Math.random() * 0.03;
      const baseCvr = 0.05 + Math.random() * 0.1;
      const baseCpc = 0.5 + Math.random() * 1.5;
      const baseAov = 20 + Math.random() * 80;

      const impressions = Math.floor(baseImpressions * (0.7 + Math.random() * 0.6) * days);
      const clicks = Math.floor(impressions * baseCtr);
      const orders = Math.floor(clicks * baseCvr);
      const spend = clicks * baseCpc;
      const sales = orders * baseAov;
      
      return {
        id: campaign.id,
        impressions,
        clicks,
        spend: spend.toFixed(2),
        sales: sales.toFixed(2),
        orders
      };
    });
    
    // 使用CASE WHEN批量更新
    const ids = updates.map(u => u.id).join(',');
    const impressionsCases = updates.map(u => `WHEN ${u.id} THEN ${u.impressions}`).join(' ');
    const clicksCases = updates.map(u => `WHEN ${u.id} THEN ${u.clicks}`).join(' ');
    const spendCases = updates.map(u => `WHEN ${u.id} THEN ${u.spend}`).join(' ');
    const salesCases = updates.map(u => `WHEN ${u.id} THEN ${u.sales}`).join(' ');
    const ordersCases = updates.map(u => `WHEN ${u.id} THEN ${u.orders}`).join(' ');
    
    const updateSql = `
      UPDATE campaigns SET
        impressions = CASE id ${impressionsCases} ELSE impressions END,
        clicks = CASE id ${clicksCases} ELSE clicks END,
        spend = CASE id ${spendCases} ELSE spend END,
        sales = CASE id ${salesCases} ELSE sales END,
        \`orders\` = CASE id ${ordersCases} ELSE \`orders\` END
      WHERE id IN (${ids})
    `;
    
    await connection.execute(updateSql);
    updated += batch.length;
    
    if (updated % 1000 === 0) {
      console.log(`已更新 ${updated}/${campaignRows.length} 个广告活动`);
    }
  }
  
  console.log(`campaigns表更新完成: ${updated} 条记录`);
  
  // 验证数据
  const [summary] = await connection.execute(`
    SELECT 
      SUM(CAST(spend AS DECIMAL(10,2))) as totalSpend,
      SUM(CAST(sales AS DECIMAL(10,2))) as totalSales,
      SUM(\`orders\`) as totalOrders
    FROM campaigns
  `);
  
  console.log('绩效数据汇总:');
  console.log(`  总花费: $${Number(summary[0].totalSpend).toFixed(2)}`);
  console.log(`  总销售额: $${Number(summary[0].totalSales).toFixed(2)}`);
  console.log(`  总订单: ${summary[0].totalOrders}`);

  await connection.end();
  console.log('完成！');
}

main().catch(console.error);
