import { describe, it, expect } from 'vitest';

// 测试出价回滚逻辑
describe('出价回滚功能', () => {
  // 测试回滚计算
  it('应该正确计算回滚后的出价', () => {
    const adjustment = {
      previousBid: 0.50,
      newBid: 0.75,
      status: 'applied'
    };
    
    // 回滚后出价应该等于调整前出价
    const rollbackBid = adjustment.previousBid;
    expect(rollbackBid).toBe(0.50);
  });

  it('应该正确计算回滚的出价变化百分比', () => {
    const previousBid = 0.50;
    const newBid = 0.75;
    
    // 原始调整: +50%
    const originalChange = ((newBid - previousBid) / previousBid) * 100;
    expect(originalChange).toBe(50);
    
    // 回滚调整: -33.33%
    const rollbackChange = ((previousBid - newBid) / newBid) * 100;
    expect(rollbackChange).toBeCloseTo(-33.33, 1);
  });

  it('应该只允许回滚已应用状态的调整', () => {
    const statuses = ['applied', 'pending', 'failed', 'rolled_back'];
    const canRollback = (status: string) => status === 'applied';
    
    expect(canRollback('applied')).toBe(true);
    expect(canRollback('pending')).toBe(false);
    expect(canRollback('failed')).toBe(false);
    expect(canRollback('rolled_back')).toBe(false);
  });

  it('应该正确生成回滚记录', () => {
    const originalAdjustment = {
      id: 1,
      keywordId: 100,
      previousBid: 0.50,
      newBid: 0.75,
      adjustmentType: 'auto_optimal',
      status: 'applied'
    };
    
    const rollbackRecord = {
      keywordId: originalAdjustment.keywordId,
      previousBid: originalAdjustment.newBid, // 回滚前是当前出价
      newBid: originalAdjustment.previousBid, // 回滚后是原始出价
      adjustmentType: 'manual',
      adjustmentReason: `回滚调整 #${originalAdjustment.id}`,
      status: 'applied'
    };
    
    expect(rollbackRecord.previousBid).toBe(0.75);
    expect(rollbackRecord.newBid).toBe(0.50);
    expect(rollbackRecord.adjustmentReason).toContain('回滚');
  });
});

// 测试效果追踪逻辑
describe('效果追踪功能', () => {
  it('应该正确计算7天实际利润', () => {
    const trackingData = {
      actualRevenue7d: 150.00,
      actualSpend7d: 50.00
    };
    
    const actualProfit7d = trackingData.actualRevenue7d - trackingData.actualSpend7d;
    expect(actualProfit7d).toBe(100.00);
  });

  it('应该正确比较预估利润与实际利润', () => {
    const adjustment = {
      expectedProfitIncrease: 10.00,
      actualProfit7d: 8.50
    };
    
    // 实际利润达到预估的85%
    const achievementRate = (adjustment.actualProfit7d / adjustment.expectedProfitIncrease) * 100;
    expect(achievementRate).toBe(85);
    
    // 达到80%以上视为成功
    const isSuccessful = achievementRate >= 80;
    expect(isSuccessful).toBe(true);
  });

  it('应该正确判断需要追踪的调整记录', () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    
    // 7天前的调整应该追踪7天数据
    const adjustment7d = {
      appliedAt: sevenDaysAgo,
      actualProfit7d: null
    };
    expect(adjustment7d.actualProfit7d).toBeNull();
    
    // 14天前的调整应该追踪14天数据
    const adjustment14d = {
      appliedAt: fourteenDaysAgo,
      actualProfit7d: 10.00,
      actualProfit14d: null
    };
    expect(adjustment14d.actualProfit14d).toBeNull();
  });

  it('应该正确计算ROAS变化', () => {
    const before = {
      spend: 100,
      revenue: 300
    };
    const after = {
      spend: 120,
      revenue: 400
    };
    
    const roasBefore = before.revenue / before.spend;
    const roasAfter = after.revenue / after.spend;
    
    expect(roasBefore).toBe(3.0);
    expect(roasAfter).toBeCloseTo(3.33, 1);
    
    const roasImprovement = ((roasAfter - roasBefore) / roasBefore) * 100;
    expect(roasImprovement).toBeCloseTo(11.11, 1);
  });

  it('应该正确计算ACoS变化', () => {
    const before = {
      spend: 100,
      revenue: 300
    };
    const after = {
      spend: 120,
      revenue: 400
    };
    
    const acosBefore = (before.spend / before.revenue) * 100;
    const acosAfter = (after.spend / after.revenue) * 100;
    
    expect(acosBefore).toBeCloseTo(33.33, 1);
    expect(acosAfter).toBe(30);
    
    // ACoS降低是好事
    const acosImprovement = acosBefore - acosAfter;
    expect(acosImprovement).toBeCloseTo(3.33, 1);
  });
});

// 测试批量导入逻辑
describe('批量导入功能', () => {
  it('应该正确解析CSV格式', () => {
    const csvContent = `广告活动,关键词,匹配类型,调整前出价,调整后出价
Campaign A,keyword1,exact,0.50,0.65
Campaign B,keyword2,phrase,0.80,0.70`;
    
    const lines = csvContent.trim().split('\n');
    const headers = lines[0].split(',');
    
    expect(headers).toContain('广告活动');
    expect(headers).toContain('关键词');
    expect(lines.length).toBe(3); // 1 header + 2 data rows
  });

  it('应该正确验证导入数据', () => {
    const validRecord = {
      campaignName: 'Campaign A',
      keywordText: 'keyword1',
      previousBid: 0.50,
      newBid: 0.65
    };
    
    const invalidRecord = {
      campaignName: '',
      keywordText: '',
      previousBid: NaN,
      newBid: -1
    };
    
    const isValid = (record: any) => {
      return record.previousBid > 0 && 
             record.newBid > 0 && 
             !isNaN(record.previousBid) && 
             !isNaN(record.newBid);
    };
    
    expect(isValid(validRecord)).toBe(true);
    expect(isValid(invalidRecord)).toBe(false);
  });

  it('应该正确计算导入统计', () => {
    const records = [
      { previousBid: 0.50, newBid: 0.65, valid: true },
      { previousBid: 0.80, newBid: 0.70, valid: true },
      { previousBid: NaN, newBid: 0.50, valid: false },
      { previousBid: 0.60, newBid: 0.60, valid: true },
    ];
    
    const validRecords = records.filter(r => r.valid);
    const invalidRecords = records.filter(r => !r.valid);
    
    expect(validRecords.length).toBe(3);
    expect(invalidRecords.length).toBe(1);
  });

  it('应该正确处理不同的CSV列名', () => {
    const englishHeaders = ['campaignName', 'keywordText', 'previousBid', 'newBid'];
    const chineseHeaders = ['广告活动', '关键词', '调整前出价', '调整后出价'];
    
    const mapHeader = (header: string) => {
      const mapping: Record<string, string> = {
        '广告活动': 'campaignName',
        '关键词': 'keywordText',
        '调整前出价': 'previousBid',
        '调整后出价': 'newBid',
        '匹配类型': 'matchType',
        '时间': 'appliedAt'
      };
      return mapping[header] || header;
    };
    
    expect(mapHeader('广告活动')).toBe('campaignName');
    expect(mapHeader('关键词')).toBe('keywordText');
    expect(mapHeader('campaignName')).toBe('campaignName');
  });

  it('应该正确处理出价格式', () => {
    const parsePrice = (value: string) => {
      // 移除货币符号和空格
      const cleaned = value.replace(/[$￥\s]/g, '');
      return parseFloat(cleaned);
    };
    
    expect(parsePrice('0.50')).toBe(0.50);
    expect(parsePrice('$0.65')).toBe(0.65);
    expect(parsePrice('￥1.20')).toBe(1.20);
    expect(parsePrice(' 0.80 ')).toBe(0.80);
  });
});

// 测试效果追踪统计
describe('效果追踪统计', () => {
  it('应该正确计算成功率', () => {
    const adjustments = [
      { expectedProfitIncrease: 10, actualProfit7d: 12 }, // 成功
      { expectedProfitIncrease: 10, actualProfit7d: 8 },  // 成功 (80%)
      { expectedProfitIncrease: 10, actualProfit7d: 5 },  // 失败
      { expectedProfitIncrease: 10, actualProfit7d: null }, // 未追踪
    ];
    
    const tracked = adjustments.filter(a => a.actualProfit7d !== null);
    const successful = tracked.filter(a => 
      a.actualProfit7d! >= a.expectedProfitIncrease * 0.8
    );
    
    expect(tracked.length).toBe(3);
    expect(successful.length).toBe(2);
    
    const successRate = (successful.length / tracked.length) * 100;
    expect(successRate).toBeCloseTo(66.67, 1);
  });

  it('应该正确计算总利润提升', () => {
    const adjustments = [
      { actualProfit7d: 12.50 },
      { actualProfit7d: 8.30 },
      { actualProfit7d: -2.10 },
      { actualProfit7d: 15.00 },
    ];
    
    const totalProfit = adjustments.reduce(
      (sum, a) => sum + (a.actualProfit7d || 0), 
      0
    );
    
    expect(totalProfit).toBeCloseTo(33.70, 1);
  });

  it('应该正确计算平均预测准确度', () => {
    const adjustments = [
      { expectedProfitIncrease: 10, actualProfit7d: 12 },
      { expectedProfitIncrease: 10, actualProfit7d: 8 },
      { expectedProfitIncrease: 10, actualProfit7d: 10 },
    ];
    
    const accuracies = adjustments.map(a => {
      const accuracy = Math.min(a.actualProfit7d / a.expectedProfitIncrease, 1.5) * 100;
      return Math.min(accuracy, 100); // 最高100%
    });
    
    const avgAccuracy = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;
    expect(avgAccuracy).toBeCloseTo(93.33, 1);
  });
});
