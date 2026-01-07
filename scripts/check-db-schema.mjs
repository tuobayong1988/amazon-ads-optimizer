// 数据库schema检查脚本
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from '../drizzle/schema.ts';

const DATABASE_URL = process.env.DATABASE_URL;

async function checkDatabaseSchema() {
  console.log('=== 数据库Schema检查 ===\n');
  
  const connection = await mysql.createConnection(DATABASE_URL);
  const db = drizzle(connection, { schema, mode: 'default' });
  
  // 获取所有表
  const [tables] = await connection.execute('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);
  console.log(`数据库中共有 ${tableNames.length} 个表\n`);
  
  // 核心表列表
  const coreTables = [
    'users',
    'ad_accounts',
    'amazon_api_credentials',
    'campaigns',
    'ad_groups',
    'keywords',
    'product_targets',
    'data_sync_jobs',
    'data_sync_schedules',
    'sync_conflicts',
    'sync_task_queue',
    'bid_rules',
    'budget_rules',
    'optimization_goals',
    'performance_data'
  ];
  
  console.log('--- 核心表检查 ---');
  const missingTables = [];
  for (const table of coreTables) {
    if (tableNames.includes(table)) {
      console.log(`✓ ${table}`);
    } else {
      console.log(`✗ ${table} (缺失)`);
      missingTables.push(table);
    }
  }
  
  if (missingTables.length > 0) {
    console.log(`\n警告: 缺失 ${missingTables.length} 个核心表`);
  } else {
    console.log('\n所有核心表都存在');
  }
  
  // 检查关键表的字段
  console.log('\n--- 关键表字段检查 ---\n');
  
  const tablesToCheck = [
    'amazon_api_credentials',
    'data_sync_jobs',
    'sync_conflicts',
    'sync_task_queue',
    'data_sync_schedules'
  ];
  
  for (const table of tablesToCheck) {
    if (!tableNames.includes(table)) continue;
    
    console.log(`表: ${table}`);
    const [columns] = await connection.execute(`DESCRIBE ${table}`);
    console.log(`  字段数: ${columns.length}`);
    const columnNames = columns.map(c => c.Field);
    console.log(`  字段: ${columnNames.join(', ')}\n`);
  }
  
  await connection.end();
  console.log('=== 检查完成 ===');
}

checkDatabaseSchema().catch(console.error);
