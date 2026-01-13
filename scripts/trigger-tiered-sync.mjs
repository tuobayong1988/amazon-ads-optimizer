/**
 * 触发智能分层全量同步脚本
 * 
 * 使用方法: node scripts/trigger-tiered-sync.mjs
 * 
 * 注意：每个任务为每种广告类型(SP/SB/SD)创建单独的任务
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// 加载环境变量
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../.manus/.env') });

// 数据层级配置
const TIER_CONFIG = {
  realtime: {
    name: '实时层',
    startDay: 0,
    endDay: 7,
    sliceSize: 1,
    reportTypes: ['campaign', 'adGroup', 'keyword', 'target'],
    priority: 'critical',
  },
  hot: {
    name: '热数据层',
    startDay: 8,
    endDay: 30,
    sliceSize: 7,
    reportTypes: ['campaign', 'adGroup', 'keyword', 'target'],
    priority: 'high',
  },
  warm: {
    name: '温数据层',
    startDay: 31,
    endDay: 90,
    sliceSize: 15,
    reportTypes: ['campaign', 'adGroup'],
    priority: 'medium',
  },
  cold: {
    name: '冷数据层',
    startDay: 91,
    endDay: 365,
    sliceSize: 30,
    reportTypes: ['campaign'],
    priority: 'low',
  },
};

// 广告类型
const AD_TYPES = ['SP', 'SB', 'SD'];

// 生成日期切片
function generateDateSlices(startDay, endDay, sliceSize) {
  const slices = [];
  const today = new Date();
  
  let currentDay = startDay;
  while (currentDay < endDay) {
    const sliceEndDay = Math.min(currentDay + sliceSize, endDay);
    
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - sliceEndDay);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - currentDay - 1);
    
    slices.push({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    });
    
    currentDay = sliceEndDay;
  }
  
  return slices;
}

async function main() {
  console.log('🚀 开始触发智能分层全量同步...\n');
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL 环境变量未设置');
    process.exit(1);
  }
  
  console.log('📡 连接数据库...');
  
  // 连接数据库
  const connection = await mysql.createConnection(databaseUrl);
  console.log('✅ 数据库连接成功\n');
  
  try {
    // 获取所有活跃账号
    const [accounts] = await connection.execute(
      'SELECT id, accountName, marketplaceId, profileId FROM ad_accounts WHERE status = "active"'
    );
    
    console.log(`📋 找到 ${accounts.length} 个活跃账号:\n`);
    accounts.forEach((acc, i) => {
      console.log(`   ${i + 1}. ${acc.accountName} (ID: ${acc.id}, Marketplace: ${acc.marketplaceId})`);
    });
    console.log('');
    
    let totalTasksCreated = 0;
    
    for (const account of accounts) {
      console.log(`\n📦 为账号 "${account.accountName}" (ID: ${account.id}) 创建分层任务...\n`);
      
      const tasksByTier = { realtime: 0, hot: 0, warm: 0, cold: 0 };
      
      // 按优先级顺序处理各层
      const tierOrder = ['realtime', 'hot', 'warm', 'cold'];
      
      for (const tier of tierOrder) {
        const config = TIER_CONFIG[tier];
        const slices = generateDateSlices(config.startDay, config.endDay, config.sliceSize);
        
        const tasksPerTier = slices.length * config.reportTypes.length * AD_TYPES.length;
        console.log(`   📊 ${config.name}: ${slices.length} 切片 × ${config.reportTypes.length} 报告类型 × ${AD_TYPES.length} 广告类型 = ${tasksPerTier} 任务`);
        
        for (const slice of slices) {
          for (const reportType of config.reportTypes) {
            // 为每种广告类型创建单独的任务
            for (const adType of AD_TYPES) {
              const metadata = JSON.stringify({
                tier,
                reportType,
                adType,
                tierConfig: config,
                processedRanges: [],
                failedRanges: [],
              });
              
              const requestPayload = JSON.stringify({ adType });
              
              await connection.execute(
                `INSERT INTO report_jobs 
                 (accountId, profileId, reportType, adProduct, startDate, endDate, status, priority, retryCount, requestPayload, metadata, createdAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                  account.id,
                  account.profileId || '',
                  `tiered_${tier}_${reportType}`,
                  adType,
                  slice.startDate,
                  slice.endDate,
                  'pending',
                  config.priority,
                  0,
                  requestPayload,
                  metadata,
                ]
              );
              
              tasksByTier[tier]++;
              totalTasksCreated++;
            }
          }
        }
      }
      
      console.log(`\n   ✅ 账号 "${account.accountName}" 任务创建完成:`);
      console.log(`      - 实时层: ${tasksByTier.realtime} 任务`);
      console.log(`      - 热数据层: ${tasksByTier.hot} 任务`);
      console.log(`      - 温数据层: ${tasksByTier.warm} 任务`);
      console.log(`      - 冷数据层: ${tasksByTier.cold} 任务`);
      console.log(`      - 总计: ${Object.values(tasksByTier).reduce((a, b) => a + b, 0)} 任务`);
    }
    
    console.log(`\n\n🎉 全量同步任务创建完成！`);
    console.log(`   总计创建 ${totalTasksCreated} 个任务`);
    console.log(`   涵盖 ${accounts.length} 个账号`);
    console.log(`\n📝 任务将由后台调度器自动处理`);
    
  } finally {
    await connection.end();
  }
}

main().catch(console.error);
