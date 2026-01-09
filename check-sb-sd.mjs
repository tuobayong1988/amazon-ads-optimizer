import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function checkSBSD() {
  try {
    // 检查campaigns表中的广告类型分布
    const campaignTypes = await db.execute(sql`
      SELECT campaignType, COUNT(*) as count 
      FROM campaigns 
      GROUP BY campaignType
    `);
    console.log('广告活动类型分布:');
    console.log(campaignTypes.rows);
    
    // 检查SB和SD广告活动
    const sbCampaigns = await db.execute(sql`
      SELECT id, name, campaignType, state 
      FROM campaigns 
      WHERE campaignType LIKE '%SB%' OR campaignType LIKE '%sponsoredBrands%' OR campaignType LIKE '%sb%'
      LIMIT 10
    `);
    console.log('\nSB品牌广告活动:');
    console.log(sbCampaigns.rows);
    
    const sdCampaigns = await db.execute(sql`
      SELECT id, name, campaignType, state 
      FROM campaigns 
      WHERE campaignType LIKE '%SD%' OR campaignType LIKE '%sponsoredDisplay%' OR campaignType LIKE '%sd%'
      LIMIT 10
    `);
    console.log('\nSD展示广告活动:');
    console.log(sdCampaigns.rows);
    
    // 检查绩效数据
    const perfData = await db.execute(sql`
      SELECT c.campaignType, COUNT(cp.id) as perfCount, SUM(cp.impressions) as totalImpressions, SUM(cp.clicks) as totalClicks
      FROM campaigns c
      LEFT JOIN campaign_performance cp ON c.id = cp.campaignId
      GROUP BY c.campaignType
    `);
    console.log('\n按广告类型的绩效数据统计:');
    console.log(perfData.rows);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSBSD();
