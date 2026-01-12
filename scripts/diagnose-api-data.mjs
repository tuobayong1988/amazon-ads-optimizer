/**
 * API数据结构诊断脚本
 * 用于检查Amazon Ads API返回的实际数据结构
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { eq, and, sql } from 'drizzle-orm';

async function main() {
  console.log('=== Amazon Ads API 数据诊断 ===\n');
  
  // 连接数据库
  const connection = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '3306'),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    // 1. 检查各类型广告活动数量
    console.log('1. 广告活动数量统计:');
    const [campaignCounts] = await connection.execute(`
      SELECT 
        campaign_type,
        COUNT(*) as count,
        SUM(CASE WHEN campaign_status = 'enabled' THEN 1 ELSE 0 END) as enabled_count,
        SUM(CASE WHEN campaign_status = 'paused' THEN 1 ELSE 0 END) as paused_count,
        SUM(CASE WHEN campaign_status = 'archived' THEN 1 ELSE 0 END) as archived_count
      FROM campaigns
      GROUP BY campaign_type
      ORDER BY campaign_type
    `);
    console.table(campaignCounts);
    
    // 2. 检查SB广告活动的预算分布
    console.log('\n2. SB广告活动预算分布:');
    const [sbBudgets] = await connection.execute(`
      SELECT 
        daily_budget,
        COUNT(*) as count
      FROM campaigns
      WHERE campaign_type = 'sb'
      GROUP BY daily_budget
      ORDER BY CAST(daily_budget AS DECIMAL(10,2)) DESC
      LIMIT 20
    `);
    console.table(sbBudgets);
    
    // 3. 检查SP广告活动的预算分布
    console.log('\n3. SP广告活动预算分布:');
    const [spBudgets] = await connection.execute(`
      SELECT 
        daily_budget,
        COUNT(*) as count
      FROM campaigns
      WHERE campaign_type IN ('sp_auto', 'sp_manual')
      GROUP BY daily_budget
      ORDER BY CAST(daily_budget AS DECIMAL(10,2)) DESC
      LIMIT 20
    `);
    console.table(spBudgets);
    
    // 4. 检查SD广告活动的预算分布
    console.log('\n4. SD广告活动预算分布:');
    const [sdBudgets] = await connection.execute(`
      SELECT 
        daily_budget,
        budget_type,
        COUNT(*) as count
      FROM campaigns
      WHERE campaign_type = 'sd'
      GROUP BY daily_budget, budget_type
      ORDER BY CAST(daily_budget AS DECIMAL(10,2)) DESC
    `);
    console.table(sdBudgets);
    
    // 5. 检查是否有重复的广告活动
    console.log('\n5. 检查重复的广告活动:');
    const [duplicates] = await connection.execute(`
      SELECT 
        campaign_id,
        COUNT(*) as count
      FROM campaigns
      GROUP BY campaign_id
      HAVING COUNT(*) > 1
    `);
    if (duplicates.length > 0) {
      console.log('发现重复的广告活动:');
      console.table(duplicates);
    } else {
      console.log('没有发现重复的广告活动');
    }
    
    // 6. 检查SB广告活动状态分布
    console.log('\n6. SB广告活动状态分布:');
    const [sbStatus] = await connection.execute(`
      SELECT 
        campaign_status,
        COUNT(*) as count
      FROM campaigns
      WHERE campaign_type = 'sb'
      GROUP BY campaign_status
    `);
    console.table(sbStatus);
    
    // 7. 检查最近同步的广告活动
    console.log('\n7. 最近同步的10个广告活动:');
    const [recentCampaigns] = await connection.execute(`
      SELECT 
        campaign_id,
        campaign_name,
        campaign_type,
        daily_budget,
        campaign_status,
        updated_at
      FROM campaigns
      ORDER BY updated_at DESC
      LIMIT 10
    `);
    console.table(recentCampaigns);
    
    // 8. 检查1月8日的绩效数据
    console.log('\n8. 1月8日绩效数据统计:');
    const [jan8Performance] = await connection.execute(`
      SELECT 
        campaign_type,
        COUNT(DISTINCT campaign_id) as campaigns_with_data,
        SUM(cost) as total_cost,
        SUM(sales) as total_sales,
        SUM(clicks) as total_clicks,
        SUM(impressions) as total_impressions
      FROM daily_performance dp
      JOIN campaigns c ON dp.campaign_id = c.id
      WHERE dp.date = '2026-01-08'
      GROUP BY campaign_type
    `);
    console.table(jan8Performance);
    
  } catch (error) {
    console.error('诊断过程中出错:', error);
  } finally {
    await connection.end();
  }
}

main().catch(console.error);
