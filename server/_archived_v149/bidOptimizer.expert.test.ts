/**
 * 专家建议优化算法测试
 * 测试贝叶斯平滑、库存保护、自然排名策略等新功能
 */

import { describe, it, expect } from 'vitest';
import {
  isDataSufficient,
  calculateBidAdjustment,
  calculateInventoryProtection,
  calculateOrganicRankStrategy,
  applyBusinessAwareAdjustments,
  INVENTORY_PROTECTION_CONFIG,
  type OptimizationTarget,
  type PerformanceGroupConfig,
} from './bidOptimizer';

describe('数据稀疏场景贝叶斯平滑策略', () => {
  it('数据充足时返回true（clicks>=15, orders>=3）', () => {
    const target: OptimizationTarget = {
      id: 1,
      type: 'keyword',
      currentBid: 1.0,
      impressions: 1000,
      clicks: 20,
      spend: 20,
      sales: 100,
      orders: 5,
    };
    expect(isDataSufficient(target)).toBe(true);
  });

  it('数据稀疏时返回false（clicks<15）', () => {
    const target: OptimizationTarget = {
      id: 1,
      type: 'keyword',
      currentBid: 1.0,
      impressions: 500,
      clicks: 10,
      spend: 10,
      sales: 50,
      orders: 2,
    };
    expect(isDataSufficient(target)).toBe(false);
  });

  it('数据稀疏时使用保守策略，调整幅度不超过±20%', () => {
    const target: OptimizationTarget = {
      id: 1,
      type: 'keyword',
      currentBid: 1.0,
      impressions: 500,
      clicks: 10,
      spend: 10,
      sales: 50,
      orders: 2,
    };
    const config: PerformanceGroupConfig = {
      optimizationGoal: 'maximize_roas',
      targetRoas: 5,
      groupAvgCvr: 0.1,
      groupAvgCpc: 1.0,
    };
    
    // 使用calculateBidAdjustment，它会内部检测数据稀疏并使用保守策略
    const result = calculateBidAdjustment(target, config);
    
    // 数据稀疏时调整幅度应该在±20%以内
    const changePercent = Math.abs(result.bidChangePercent);
    expect(changePercent).toBeLessThanOrEqual(20);
  });
});

describe('库存保护策略', () => {
  it('缺货时应暂停广告（出价设为0）', () => {
    const result = calculateInventoryProtection(1.0, 'out_of_stock');
    
    expect(result.action).toBe('pause');
    expect(result.adjustedBid).toBe(0);
    expect(result.bidMultiplier).toBe(0);
  });

  it('危急库存（<=3天）时强制降价50%', () => {
    const result = calculateInventoryProtection(1.0, 'critical', 2);
    
    expect(result.action).toBe('reduce');
    expect(result.bidMultiplier).toBe(INVENTORY_PROTECTION_CONFIG.criticalInventoryBidMultiplier);
    expect(result.adjustedBid).toBe(0.5);
  });

  it('低库存（<=7天）时降价30%', () => {
    const result = calculateInventoryProtection(1.0, 'low', 5);
    
    expect(result.action).toBe('reduce');
    expect(result.bidMultiplier).toBe(INVENTORY_PROTECTION_CONFIG.lowInventoryBidMultiplier);
    expect(result.adjustedBid).toBe(0.7);
  });

  it('库存正常时不调整', () => {
    const result = calculateInventoryProtection(1.0, 'normal', 30);
    
    expect(result.action).toBe('normal');
    expect(result.adjustedBid).toBe(1.0);
    expect(result.bidMultiplier).toBe(1);
  });
});

describe('自然排名策略', () => {
  it('自然排名前10名时降低出价30%', () => {
    const result = calculateOrganicRankStrategy(1.0, 5);
    
    expect(result.shouldReduceBid).toBe(true);
    expect(result.bidReduction).toBe(INVENTORY_PROTECTION_CONFIG.organicRankBidReduction);
    expect(result.adjustedBid).toBe(0.7);
  });

  it('自然排名超过10名时不调整', () => {
    const result = calculateOrganicRankStrategy(1.0, 15);
    
    expect(result.shouldReduceBid).toBe(false);
    expect(result.adjustedBid).toBe(1.0);
  });

  it('无自然排名数据时不调整', () => {
    const result = calculateOrganicRankStrategy(1.0, undefined);
    
    expect(result.shouldReduceBid).toBe(false);
    expect(result.adjustedBid).toBe(1.0);
  });
});

describe('综合业务感知调整', () => {
  it('库存保护优先级高于自然排名策略', () => {
    const target: OptimizationTarget = {
      id: 1,
      type: 'keyword',
      currentBid: 1.0,
      impressions: 1000,
      clicks: 20,
      spend: 20,
      sales: 100,
      orders: 5,
      inventoryLevel: 'critical',
      inventoryDays: 2,
      organicRank: 5, // 自然排名好，但库存危急
    };
    
    const result = applyBusinessAwareAdjustments(target, 1.0);
    
    // 应该优先应用库存保护（降价50%），而不是自然排名策略（降价30%）
    expect(result.finalBid).toBe(0.5);
    expect(result.inventoryProtection?.action).toBe('reduce');
  });

  it('库存正常时应用自然排名策略', () => {
    const target: OptimizationTarget = {
      id: 1,
      type: 'keyword',
      currentBid: 1.0,
      impressions: 1000,
      clicks: 20,
      spend: 20,
      sales: 100,
      orders: 5,
      inventoryLevel: 'normal',
      inventoryDays: 30,
      organicRank: 5,
    };
    
    const result = applyBusinessAwareAdjustments(target, 1.0);
    
    // 库存正常，应用自然排名策略降价30%
    expect(result.finalBid).toBe(0.7);
    expect(result.organicRankStrategy?.shouldReduceBid).toBe(true);
  });

  it('无业务感知数据时不调整', () => {
    const target: OptimizationTarget = {
      id: 1,
      type: 'keyword',
      currentBid: 1.0,
      impressions: 1000,
      clicks: 20,
      spend: 20,
      sales: 100,
      orders: 5,
    };
    
    const result = applyBusinessAwareAdjustments(target, 1.0);
    
    expect(result.finalBid).toBe(1.0);
    expect(result.totalAdjustmentReason).toBe('无业务感知调整');
  });
});
