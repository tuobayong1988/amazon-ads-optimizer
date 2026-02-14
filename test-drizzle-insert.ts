import { getDb } from './server/db';
import { campaigns } from './drizzle/schema';

async function testInsert() {
  const db = await getDb();
  if (!db) {
    console.error('Failed to get DB');
    return;
  }

  const testData = {
    accountId: 90021,
    campaignId: 'TEST123',
    campaignName: 'Test Campaign',
    campaignType: 'sp_manual' as const,
    targetingType: 'manual' as const,
    dailyBudget: '10.00',
    campaignStatus: 'enabled' as const,
    placementTopSearchBidAdjustment: 0,
    placementProductPageBidAdjustment: 0,
    updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };

  console.log('测试数据:', testData);
  console.log('\\n开始INSERT...');

  try {
    const result = await db.insert(campaigns).values(testData);
    console.log('✅ INSERT成功!');
    console.log('结果:', result);
  } catch (error: any) {
    console.error('❌ INSERT失败!');
    console.error('错误:', error.message);
    if (error.sql) {
      console.error('\\nSQL:', error.sql);
    }
  }

  process.exit(0);
}

testInsert();
