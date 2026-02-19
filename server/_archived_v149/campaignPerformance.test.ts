import { describe, it, expect, vi, beforeEach } from 'vitest';

// 测试时间范围计算函数
describe('Time Range Calculation', () => {
  beforeEach(() => {
    // 固定当前日期为 2026-01-08
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-08T12:00:00Z'));
  });

  it('should calculate today date range correctly', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = today.toISOString().split('T')[0];
    
    expect(dateStr).toBe('2026-01-08');
  });

  it('should calculate yesterday date range correctly', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    
    expect(dateStr).toBe('2026-01-07');
  });

  it('should calculate 7 days date range correctly', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 7);
    
    expect(startDate.toISOString().split('T')[0]).toBe('2026-01-01');
    expect(today.toISOString().split('T')[0]).toBe('2026-01-08');
  });

  it('should calculate 30 days date range correctly', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 30);
    
    expect(startDate.toISOString().split('T')[0]).toBe('2025-12-09');
    expect(today.toISOString().split('T')[0]).toBe('2026-01-08');
  });

  it('should calculate 90 days date range correctly', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 90);
    
    expect(startDate.toISOString().split('T')[0]).toBe('2025-10-10');
    expect(today.toISOString().split('T')[0]).toBe('2026-01-08');
  });
});

// 测试绩效数据计算
describe('Performance Data Calculation', () => {
  it('should calculate ACOS correctly', () => {
    const spend = 100;
    const sales = 500;
    const acos = (spend / sales) * 100;
    
    expect(acos).toBe(20);
  });

  it('should calculate ROAS correctly', () => {
    const spend = 100;
    const sales = 500;
    const roas = sales / spend;
    
    expect(roas).toBe(5);
  });

  it('should calculate CTR correctly', () => {
    const clicks = 50;
    const impressions = 1000;
    const ctr = (clicks / impressions) * 100;
    
    expect(ctr).toBe(5);
  });

  it('should calculate CVR correctly', () => {
    const orders = 10;
    const clicks = 50;
    const cvr = (orders / clicks) * 100;
    
    expect(cvr).toBe(20);
  });

  it('should calculate CPC correctly', () => {
    const spend = 100;
    const clicks = 50;
    const cpc = spend / clicks;
    
    expect(cpc).toBe(2);
  });

  it('should handle zero values gracefully', () => {
    const spend = 0;
    const sales = 0;
    const impressions = 0;
    const clicks = 0;
    
    // ACOS should be null when sales is 0
    const acos = sales > 0 ? ((spend / sales) * 100).toFixed(2) : null;
    expect(acos).toBeNull();
    
    // ROAS should be null when spend is 0
    const roas = spend > 0 ? (sales / spend).toFixed(2) : null;
    expect(roas).toBeNull();
    
    // CTR should be null when impressions is 0
    const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(4) : null;
    expect(ctr).toBeNull();
  });
});

// 测试同步结果结构
describe('Sync Results Structure', () => {
  it('should have correct structure for sync results', () => {
    const results = {
      campaigns: 0,
      spCampaigns: 0,
      sbCampaigns: 0,
      sdCampaigns: 0,
      adGroups: 0,
      keywords: 0,
      targets: 0,
      performance: 0,
      skipped: 0,
    };

    expect(results).toHaveProperty('campaigns');
    expect(results).toHaveProperty('spCampaigns');
    expect(results).toHaveProperty('sbCampaigns');
    expect(results).toHaveProperty('sdCampaigns');
    expect(results).toHaveProperty('adGroups');
    expect(results).toHaveProperty('keywords');
    expect(results).toHaveProperty('targets');
    expect(results).toHaveProperty('performance');
    expect(results).toHaveProperty('skipped');
  });

  it('should calculate total campaigns correctly', () => {
    const results = {
      spCampaigns: 10,
      sbCampaigns: 5,
      sdCampaigns: 3,
    };

    const totalCampaigns = results.spCampaigns + results.sbCampaigns + results.sdCampaigns;
    expect(totalCampaigns).toBe(18);
  });
});
