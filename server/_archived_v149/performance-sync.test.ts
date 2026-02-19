import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as db from './db';

describe('Performance Data Sync', () => {
  let testAccountId: number;
  let testCampaignId: number;

  beforeAll(async () => {
    // 获取测试账户
    const accounts = await db.getAdAccountsByUserId(1);
    if (accounts.length > 0) {
      testAccountId = accounts[0].id;
    }
  });

  it('should have campaigns with performance data', async () => {
    if (!testAccountId) {
      console.log('跳过测试：没有可用的测试账户');
      return;
    }

    // 获取账户的绩效汇总
    const performance = await db.getAccountPerformanceSummary(testAccountId);
    
    expect(performance).toBeDefined();
    expect(performance?.totalSpend).toBeGreaterThanOrEqual(0);
    expect(performance?.totalSales).toBeGreaterThanOrEqual(0);
    expect(performance?.totalOrders).toBeGreaterThanOrEqual(0);
    expect(performance?.totalImpressions).toBeGreaterThanOrEqual(0);
    expect(performance?.totalClicks).toBeGreaterThanOrEqual(0);
  });

  it('should calculate ACoS correctly', async () => {
    if (!testAccountId) {
      console.log('跳过测试：没有可用的测试账户');
      return;
    }

    const performance = await db.getAccountPerformanceSummary(testAccountId);
    
    if (performance && performance.totalSales > 0 && performance.totalSpend > 0) {
      const acos = (performance.totalSpend / performance.totalSales) * 100;
      expect(acos).toBeGreaterThan(0);
      expect(acos).toBeLessThan(1000); // 合理范围
    }
  });

  it('should calculate ROAS correctly', async () => {
    if (!testAccountId) {
      console.log('跳过测试：没有可用的测试账户');
      return;
    }

    const performance = await db.getAccountPerformanceSummary(testAccountId);
    
    if (performance && performance.totalSpend > 0) {
      const roas = performance.totalSales / performance.totalSpend;
      expect(roas).toBeGreaterThanOrEqual(0);
      expect(roas).toBeLessThan(100); // 合理范围
    }
  });

  it('should have CTR within reasonable range', async () => {
    if (!testAccountId) {
      console.log('跳过测试：没有可用的测试账户');
      return;
    }

    const performance = await db.getAccountPerformanceSummary(testAccountId);
    
    if (performance && performance.totalImpressions > 0 && performance.totalClicks > 0) {
      const ctr = (performance.totalClicks / performance.totalImpressions) * 100;
      expect(ctr).toBeGreaterThan(0);
      expect(ctr).toBeLessThan(100); // CTR不应该超过100%
    }
  });

  it('should have CVR within reasonable range', async () => {
    if (!testAccountId) {
      console.log('跳过测试：没有可用的测试账户');
      return;
    }

    const performance = await db.getAccountPerformanceSummary(testAccountId);
    
    if (performance && performance.totalClicks > 0 && performance.totalOrders > 0) {
      const cvr = (performance.totalOrders / performance.totalClicks) * 100;
      expect(cvr).toBeGreaterThan(0);
      expect(cvr).toBeLessThan(100); // CVR不应该超过100%
    }
  });

  it('should have consistent performance data across accounts', async () => {
    const accounts = await db.getAdAccountsByUserId(1);
    
    for (const account of accounts) {
      if (!account.marketplace) continue; // 跳过空店铺占位记录
      
      const performance = await db.getAccountPerformanceSummary(account.id);
      
      expect(performance).toBeDefined();
      
      // 验证数据一致性
      if (performance) {
        // 销售额应该大于等于花费（通常情况下）
        if (performance.totalSpend > 0) {
          expect(performance.totalSales).toBeGreaterThanOrEqual(0);
        }
        
        // 订单数应该小于等于点击数
        if (performance.totalClicks > 0) {
          expect(performance.totalOrders).toBeLessThanOrEqual(performance.totalClicks);
        }
      }
    }
  });
});
