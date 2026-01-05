/**
 * Seed script to generate demo data for Amazon Ads Optimizer
 * Run with: node scripts/seed-demo-data.mjs
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL not found in environment');
  process.exit(1);
}

async function main() {
  const connection = await mysql.createConnection(DATABASE_URL);
  const db = drizzle(connection);

  console.log('Seeding demo data...');

  // Get the first user (owner)
  const [users] = await connection.execute('SELECT id, openId FROM users LIMIT 1');
  
  if (!users || users.length === 0) {
    console.log('No users found. Please log in first to create a user.');
    await connection.end();
    return;
  }

  const userId = users[0].id;
  console.log(`Using user ID: ${userId}`);

  // Check if demo account already exists
  const [existingAccounts] = await connection.execute(
    'SELECT id FROM ad_accounts WHERE accountId = ?',
    ['DEMO-123456']
  );

  if (existingAccounts && existingAccounts.length > 0) {
    console.log('Demo data already exists. Skipping seed.');
    await connection.end();
    return;
  }

  // Create demo ad account
  console.log('Creating demo ad account...');
  const [accountResult] = await connection.execute(
    `INSERT INTO ad_accounts (userId, accountId, accountName, marketplace, profileId, conversionValueType, conversionValueSource, intradayBiddingEnabled, defaultMaxBid, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [userId, 'DEMO-123456', '示例广告账号', 'US', 'PROFILE-123', 'sales', 'platform', true, '5.00', 'active']
  );
  const accountId = accountResult.insertId;
  console.log(`Created ad account with ID: ${accountId}`);

  // Create performance groups
  console.log('Creating performance groups...');
  const performanceGroups = [
    { name: '高转化关键词组', goal: 'target_acos', targetAcos: '25.00', description: '针对高转化率关键词的优化组' },
    { name: '品牌词保护组', goal: 'maximize_sales', description: '品牌相关关键词，最大化销售' },
    { name: '新品推广组', goal: 'daily_spend_limit', dailySpendLimit: '100.00', description: '新品推广，控制每日花费' },
  ];

  const groupIds = [];
  for (const group of performanceGroups) {
    const [result] = await connection.execute(
      `INSERT INTO performance_groups (userId, accountId, name, description, optimizationGoal, targetAcos, targetRoas, dailySpendLimit, dailyCostTarget, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`,
      [userId, accountId, group.name, group.description, group.goal, group.targetAcos || null, group.targetRoas || null, group.dailySpendLimit || null, group.dailyCostTarget || null]
    );
    groupIds.push(result.insertId);
  }
  console.log(`Created ${groupIds.length} performance groups`);

  // Create campaigns
  console.log('Creating campaigns...');
  const campaigns = [
    { id: 'SP-AUTO-001', name: 'SP自动广告-主推产品', type: 'sp_auto', targeting: 'auto', groupIdx: 0 },
    { id: 'SP-MANUAL-001', name: 'SP手动广告-品牌词', type: 'sp_manual', targeting: 'manual', groupIdx: 1 },
    { id: 'SP-MANUAL-002', name: 'SP手动广告-竞品词', type: 'sp_manual', targeting: 'manual', groupIdx: 0 },
    { id: 'SP-MANUAL-003', name: 'SP手动广告-长尾词', type: 'sp_manual', targeting: 'manual', groupIdx: 2 },
    { id: 'SB-001', name: 'SB品牌推广-品牌旗舰店', type: 'sb', targeting: 'manual', groupIdx: 1 },
    { id: 'SD-001', name: 'SD展示广告-再营销', type: 'sd', targeting: 'auto', groupIdx: 0 },
  ];

  const campaignIds = [];
  for (const campaign of campaigns) {
    const impressions = Math.floor(5000 + Math.random() * 50000);
    const clicks = Math.floor(impressions * (0.02 + Math.random() * 0.03));
    const orders = Math.floor(clicks * (0.05 + Math.random() * 0.1));
    const spend = (clicks * (0.3 + Math.random() * 0.7)).toFixed(2);
    const sales = (orders * (15 + Math.random() * 35)).toFixed(2);
    const acos = sales > 0 ? ((spend / sales) * 100).toFixed(2) : '0';
    const roas = spend > 0 ? (sales / spend).toFixed(2) : '0';

    const [result] = await connection.execute(
      `INSERT INTO campaigns (accountId, campaignId, campaignName, campaignType, targetingType, performanceGroupId, maxBid, intradayBiddingEnabled, 
       placementTopSearchBidAdjustment, placementProductPageBidAdjustment, placementRestBidAdjustment,
       impressions, clicks, spend, sales, orders, acos, roas, campaignStatus, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enabled', NOW(), NOW())`,
      [accountId, campaign.id, campaign.name, campaign.type, campaign.targeting, groupIds[campaign.groupIdx], '3.00', true,
       Math.floor(Math.random() * 30), Math.floor(Math.random() * 20), 0,
       impressions, clicks, spend, sales, orders, acos, roas]
    );
    campaignIds.push(result.insertId);
  }
  console.log(`Created ${campaignIds.length} campaigns`);

  // Create ad groups
  console.log('Creating ad groups...');
  const adGroupIds = [];
  for (let i = 0; i < campaignIds.length; i++) {
    const numGroups = 1 + Math.floor(Math.random() * 2);
    for (let j = 0; j < numGroups; j++) {
      const [result] = await connection.execute(
        `INSERT INTO ad_groups (campaignId, adGroupId, adGroupName, defaultBid, adGroupStatus, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'enabled', NOW(), NOW())`,
        [campaignIds[i], `AG-${i}-${j}`, `广告组 ${j + 1}`, '1.00']
      );
      adGroupIds.push({ id: result.insertId, campaignId: campaignIds[i] });
    }
  }
  console.log(`Created ${adGroupIds.length} ad groups`);

  // Create keywords
  console.log('Creating keywords...');
  const keywordTexts = [
    'wireless earbuds', 'bluetooth headphones', 'noise cancelling earphones',
    'sports earbuds', 'waterproof headphones', 'gaming headset',
    'earbuds with microphone', 'true wireless earbuds', 'in ear headphones',
    'bass headphones', 'running earbuds', 'workout earphones'
  ];
  const matchTypes = ['broad', 'phrase', 'exact'];

  let keywordCount = 0;
  for (const adGroup of adGroupIds) {
    const numKeywords = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < numKeywords; i++) {
      const keywordText = keywordTexts[Math.floor(Math.random() * keywordTexts.length)];
      const matchType = matchTypes[Math.floor(Math.random() * matchTypes.length)];
      const bid = (0.5 + Math.random() * 2).toFixed(2);
      const impressions = Math.floor(500 + Math.random() * 5000);
      const clicks = Math.floor(impressions * (0.01 + Math.random() * 0.04));
      const orders = Math.floor(clicks * (0.03 + Math.random() * 0.12));
      const spend = (clicks * parseFloat(bid) * 0.7).toFixed(2);
      const sales = (orders * (15 + Math.random() * 35)).toFixed(2);

      await connection.execute(
        `INSERT INTO keywords (adGroupId, keywordId, keywordText, matchType, bid, impressions, clicks, spend, sales, orders, keywordStatus, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enabled', NOW(), NOW())`,
        [adGroup.id, `KW-${keywordCount}`, keywordText, matchType, bid, impressions, clicks, spend, sales, orders]
      );
      keywordCount++;
    }
  }
  console.log(`Created ${keywordCount} keywords`);

  // Create product targets
  console.log('Creating product targets...');
  const asins = ['B09ABCDEF1', 'B09ABCDEF2', 'B09ABCDEF3', 'B09ABCDEF4', 'B09ABCDEF5'];
  
  let targetCount = 0;
  for (const adGroup of adGroupIds) {
    const numTargets = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numTargets; i++) {
      const asin = asins[Math.floor(Math.random() * asins.length)];
      const bid = (0.5 + Math.random() * 2).toFixed(2);
      const impressions = Math.floor(300 + Math.random() * 3000);
      const clicks = Math.floor(impressions * (0.01 + Math.random() * 0.03));
      const orders = Math.floor(clicks * (0.02 + Math.random() * 0.08));
      const spend = (clicks * parseFloat(bid) * 0.7).toFixed(2);
      const sales = (orders * (15 + Math.random() * 35)).toFixed(2);

      await connection.execute(
        `INSERT INTO product_targets (adGroupId, targetId, targetType, targetValue, bid, impressions, clicks, spend, sales, orders, targetStatus, createdAt, updatedAt)
         VALUES (?, ?, 'asin', ?, ?, ?, ?, ?, ?, ?, 'enabled', NOW(), NOW())`,
        [adGroup.id, `PT-${targetCount}`, asin, bid, impressions, clicks, spend, sales, orders]
      );
      targetCount++;
    }
  }
  console.log(`Created ${targetCount} product targets`);

  // Create bidding logs
  console.log('Creating bidding logs...');
  const reasons = [
    '当前ACoS (28.5%) 高于目标 (25%)，降低出价',
    '高转化率 (12.3%) 支持提高出价',
    '曝光量较低，提高出价以获取更多流量',
    '基于市场曲线分析，提高出价可增加边际收益',
    '基于市场曲线分析，降低出价可优化投入产出比',
    '当前ROAS (3.8) 达到目标，优化出价以最大化效益',
  ];

  const actionTypes = ['increase', 'decrease', 'set'];
  
  for (let i = 0; i < 100; i++) {
    const actionType = actionTypes[Math.floor(Math.random() * actionTypes.length)];
    const previousBid = (0.5 + Math.random() * 2).toFixed(2);
    const changePercent = actionType === 'increase' 
      ? (5 + Math.random() * 20).toFixed(2)
      : actionType === 'decrease' 
        ? (-5 - Math.random() * 20).toFixed(2)
        : '0';
    const newBid = (parseFloat(previousBid) * (1 + parseFloat(changePercent) / 100)).toFixed(2);
    const reason = reasons[Math.floor(Math.random() * reasons.length)];
    const targetType = Math.random() > 0.3 ? 'keyword' : 'product_target';
    const matchType = targetType === 'keyword' ? matchTypes[Math.floor(Math.random() * matchTypes.length)] : null;
    const targetName = targetType === 'keyword' 
      ? keywordTexts[Math.floor(Math.random() * keywordTexts.length)]
      : `ASIN: ${asins[Math.floor(Math.random() * asins.length)]}`;

    // Random date in the last 30 days
    const daysAgo = Math.floor(Math.random() * 30);
    const hoursAgo = Math.floor(Math.random() * 24);

    await connection.execute(
      `INSERT INTO bidding_logs (accountId, campaignId, adGroupId, logTargetType, targetId, targetName, logMatchType, actionType, previousBid, newBid, bidChangePercent, reason, algorithmVersion, isIntradayAdjustment, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '1.0.0', ?, DATE_SUB(NOW(), INTERVAL ? DAY) - INTERVAL ? HOUR)`,
      [accountId, campaignIds[Math.floor(Math.random() * campaignIds.length)], adGroupIds[Math.floor(Math.random() * adGroupIds.length)].id, 
       targetType, i, targetName, matchType, actionType, previousBid, newBid, changePercent, reason, Math.random() > 0.8, daysAgo, hoursAgo]
    );
  }
  console.log('Created 100 bidding logs');

  // Create daily performance data
  console.log('Creating daily performance data...');
  for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
    const baseImpressions = 10000 + Math.random() * 5000;
    const baseClicks = baseImpressions * (0.02 + Math.random() * 0.01);
    const baseOrders = baseClicks * (0.05 + Math.random() * 0.05);
    const baseSpend = baseClicks * 0.5;
    const baseSales = baseOrders * 25;

    await connection.execute(
      `INSERT INTO daily_performance (accountId, campaignId, date, impressions, clicks, spend, sales, orders, dailyAcos, dailyRoas, createdAt)
       VALUES (?, NULL, DATE_SUB(CURDATE(), INTERVAL ? DAY), ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [accountId, daysAgo, 
       Math.floor(baseImpressions), Math.floor(baseClicks), 
       baseSpend.toFixed(2), baseSales.toFixed(2), Math.floor(baseOrders),
       ((baseSpend / baseSales) * 100).toFixed(2), (baseSales / baseSpend).toFixed(2)]
    );
  }
  console.log('Created 31 days of performance data');

  console.log('\n✅ Demo data seeded successfully!');
  console.log(`
Summary:
- 1 Ad Account
- ${performanceGroups.length} Performance Groups
- ${campaigns.length} Campaigns
- ${adGroupIds.length} Ad Groups
- ${keywordCount} Keywords
- ${targetCount} Product Targets
- 100 Bidding Logs
- 31 Days of Performance Data
`);

  await connection.end();
}

main().catch(console.error);
