/**
 * ML模型训练数据填充脚本
 * 生成模拟的历史广告数据用于训练机器学习模型
 */

import { db } from '../server/db';

interface CampaignPerformance {
  campaignId: number;
  date: string;
  bid: number;
  spend: number;
  impressions: number;
  clicks: number;
  sales: number;
  orders: number;
}

/**
 * 生成模拟的广告活动历史数据
 */
function generateCampaignHistory(
  campaignId: number,
  days: number = 90
): CampaignPerformance[] {
  const data: CampaignPerformance[] = [];
  const today = new Date();

  // 模拟不同的广告活动特征
  const baseBid = 0.5 + Math.random() * 2; // 0.5 - 2.5
  const baseImpressions = 1000 + Math.random() * 5000; // 1000 - 6000
  const baseCTR = 0.01 + Math.random() * 0.05; // 1% - 6%
  const baseCVR = 0.05 + Math.random() * 0.15; // 5% - 20%
  const avgOrderValue = 20 + Math.random() * 80; // $20 - $100

  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // 添加一些随机波动和趋势
    const trendFactor = 1 + (Math.sin(i / 10) * 0.2); // 周期性波动
    const randomFactor = 0.8 + Math.random() * 0.4; // 随机波动 0.8-1.2

    const bid = baseBid * trendFactor * randomFactor;
    const impressions = Math.floor(baseImpressions * trendFactor * randomFactor);
    const clicks = Math.floor(impressions * baseCTR * randomFactor);
    const orders = Math.floor(clicks * baseCVR * randomFactor);
    const sales = orders * avgOrderValue * randomFactor;
    const spend = clicks * bid;

    data.push({
      campaignId,
      date: date.toISOString().split('T')[0],
      bid: Number(bid.toFixed(2)),
      spend: Number(spend.toFixed(2)),
      impressions,
      clicks,
      sales: Number(sales.toFixed(2)),
      orders,
    });
  }

  return data;
}

/**
 * 生成不同类型的广告活动数据
 */
function generateDiverseCampaignData(): Record<string, CampaignPerformance[]> {
  return {
    // 高效活动 - 低ACoS,高ROAS
    highPerformer: generateCampaignHistory(1, 90).map((d) => ({
      ...d,
      sales: d.sales * 1.5, // 提高销售额
      spend: d.spend * 0.8, // 降低花费
    })),

    // 低效活动 - 高ACoS,低ROAS
    lowPerformer: generateCampaignHistory(2, 90).map((d) => ({
      ...d,
      sales: d.sales * 0.6, // 降低销售额
      spend: d.spend * 1.3, // 提高花费
    })),

    // 上升趋势活动
    growingCampaign: generateCampaignHistory(3, 90).map((d, i) => ({
      ...d,
      sales: d.sales * (1 + i / 180), // 逐渐增长
      impressions: Math.floor(d.impressions * (1 + i / 180)),
    })),

    // 下降趋势活动
    decliningCampaign: generateCampaignHistory(4, 90).map((d, i) => ({
      ...d,
      sales: d.sales * (1 - i / 360), // 逐渐下降
      impressions: Math.floor(d.impressions * (1 - i / 360)),
    })),

    // 稳定活动
    stableCampaign: generateCampaignHistory(5, 90).map((d) => ({
      ...d,
      // 保持原样,波动较小
    })),

    // 季节性活动
    seasonalCampaign: generateCampaignHistory(6, 90).map((d, i) => {
      const seasonalFactor = 1 + Math.sin((i / 90) * Math.PI * 2) * 0.5;
      return {
        ...d,
        sales: d.sales * seasonalFactor,
        impressions: Math.floor(d.impressions * seasonalFactor),
      };
    }),
  };
}

/**
 * 将数据插入数据库
 */
async function seedDatabase() {
  console.log('开始填充ML训练数据...');

  const campaignData = generateDiverseCampaignData();
  let totalRecords = 0;

  for (const [type, data] of Object.entries(campaignData)) {
    console.log(`\n填充 ${type} 数据 (${data.length} 条记录)...`);

    for (const record of data) {
      try {
        // 这里需要根据实际的数据库schema调整
        // 假设有一个daily_performance表
        await db.execute(`
          INSERT INTO daily_performance 
          (campaign_id, date, bid, spend, impressions, clicks, sales, orders, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            bid = VALUES(bid),
            spend = VALUES(spend),
            impressions = VALUES(impressions),
            clicks = VALUES(clicks),
            sales = VALUES(sales),
            orders = VALUES(orders)
        `, [
          record.campaignId,
          record.date,
          record.bid,
          record.spend,
          record.impressions,
          record.clicks,
          record.sales,
          record.orders,
        ]);

        totalRecords++;
      } catch (error) {
        console.error(`插入记录失败:`, error);
      }
    }

    console.log(`✓ ${type} 数据填充完成`);
  }

  console.log(`\n总共填充 ${totalRecords} 条记录`);
  console.log('\nML训练数据填充完成!');
}

/**
 * 生成统计报告
 */
function generateReport() {
  const campaignData = generateDiverseCampaignData();

  console.log('\n========== ML训练数据统计报告 ==========\n');

  for (const [type, data] of Object.entries(campaignData)) {
    const totalSpend = data.reduce((sum, d) => sum + d.spend, 0);
    const totalSales = data.reduce((sum, d) => sum + d.sales, 0);
    const totalImpressions = data.reduce((sum, d) => sum + d.impressions, 0);
    const totalClicks = data.reduce((sum, d) => sum + d.clicks, 0);
    const totalOrders = data.reduce((sum, d) => sum + d.orders, 0);

    const avgBid = data.reduce((sum, d) => sum + d.bid, 0) / data.length;
    const acos = (totalSpend / totalSales) * 100;
    const roas = totalSales / totalSpend;
    const ctr = (totalClicks / totalImpressions) * 100;
    const cvr = (totalOrders / totalClicks) * 100;

    console.log(`【${type}】`);
    console.log(`  记录数: ${data.length}`);
    console.log(`  总花费: $${totalSpend.toFixed(2)}`);
    console.log(`  总销售额: $${totalSales.toFixed(2)}`);
    console.log(`  总展示: ${totalImpressions.toLocaleString()}`);
    console.log(`  总点击: ${totalClicks.toLocaleString()}`);
    console.log(`  总订单: ${totalOrders}`);
    console.log(`  平均出价: $${avgBid.toFixed(2)}`);
    console.log(`  ACoS: ${acos.toFixed(2)}%`);
    console.log(`  ROAS: ${roas.toFixed(2)}`);
    console.log(`  CTR: ${ctr.toFixed(2)}%`);
    console.log(`  CVR: ${cvr.toFixed(2)}%`);
    console.log('');
  }

  console.log('==========================================\n');
}

/**
 * 导出数据到CSV文件(用于外部分析)
 */
async function exportToCSV() {
  const fs = require('fs');
  const path = require('path');

  const campaignData = generateDiverseCampaignData();
  const outputDir = path.join(__dirname, '../data/ml-training');

  // 创建输出目录
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const [type, data] of Object.entries(campaignData)) {
    const csvContent = [
      'date,campaign_id,bid,spend,impressions,clicks,sales,orders,acos,roas,ctr,cvr',
      ...data.map((d) => {
        const acos = (d.spend / d.sales) * 100;
        const roas = d.sales / d.spend;
        const ctr = (d.clicks / d.impressions) * 100;
        const cvr = (d.orders / d.clicks) * 100;

        return [
          d.date,
          d.campaignId,
          d.bid,
          d.spend,
          d.impressions,
          d.clicks,
          d.sales,
          d.orders,
          acos.toFixed(2),
          roas.toFixed(2),
          ctr.toFixed(2),
          cvr.toFixed(2),
        ].join(',');
      }),
    ].join('\n');

    const filePath = path.join(outputDir, `${type}.csv`);
    fs.writeFileSync(filePath, csvContent);
    console.log(`✓ 导出 ${type} 到 ${filePath}`);
  }

  console.log('\nCSV文件导出完成!');
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'seed';

  try {
    switch (command) {
      case 'seed':
        await seedDatabase();
        break;
      case 'report':
        generateReport();
        break;
      case 'export':
        await exportToCSV();
        break;
      case 'all':
        generateReport();
        await exportToCSV();
        await seedDatabase();
        break;
      default:
        console.log('用法:');
        console.log('  pnpm tsx scripts/seed-ml-training-data.ts [command]');
        console.log('');
        console.log('命令:');
        console.log('  seed    - 填充数据到数据库 (默认)');
        console.log('  report  - 生成统计报告');
        console.log('  export  - 导出CSV文件');
        console.log('  all     - 执行所有操作');
    }
  } catch (error) {
    console.error('执行失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

export { generateCampaignHistory, generateDiverseCampaignData };
