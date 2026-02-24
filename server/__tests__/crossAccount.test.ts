import { describe, it, expect } from 'vitest';

// 测试跨账号汇总功能
describe('Cross Account Summary', () => {
  describe('Summary Calculation', () => {
    it('should calculate total spend correctly', () => {
      const accountsData = [
        { spend: 100, sales: 500 },
        { spend: 200, sales: 800 },
        { spend: 150, sales: 600 },
      ];
      const totalSpend = accountsData.reduce((sum, a) => sum + a.spend, 0);
      expect(totalSpend).toBe(450);
    });

    it('should calculate total sales correctly', () => {
      const accountsData = [
        { spend: 100, sales: 500 },
        { spend: 200, sales: 800 },
        { spend: 150, sales: 600 },
      ];
      const totalSales = accountsData.reduce((sum, a) => sum + a.sales, 0);
      expect(totalSales).toBe(1900);
    });

    it('should calculate average ACoS correctly', () => {
      const totalSpend = 450;
      const totalSales = 1900;
      const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
      expect(avgAcos).toBeCloseTo(23.68, 1);
    });

    it('should calculate average ROAS correctly', () => {
      const totalSpend = 450;
      const totalSales = 1900;
      const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
      expect(avgRoas).toBeCloseTo(4.22, 1);
    });

    it('should handle zero spend correctly', () => {
      const totalSpend = 0;
      const totalSales = 1000;
      const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
      expect(avgRoas).toBe(0);
    });

    it('should handle zero sales correctly', () => {
      const totalSpend = 100;
      const totalSales = 0;
      const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
      expect(avgAcos).toBe(0);
    });
  });

  describe('Marketplace Distribution', () => {
    it('should group accounts by marketplace', () => {
      const accounts = [
        { marketplace: 'US', spend: 100, sales: 500 },
        { marketplace: 'US', spend: 200, sales: 800 },
        { marketplace: 'UK', spend: 150, sales: 600 },
        { marketplace: 'DE', spend: 50, sales: 200 },
      ];

      const distribution: Record<string, { count: number; spend: number; sales: number }> = {};
      for (const account of accounts) {
        if (!distribution[account.marketplace]) {
          distribution[account.marketplace] = { count: 0, spend: 0, sales: 0 };
        }
        distribution[account.marketplace].count++;
        distribution[account.marketplace].spend += account.spend;
        distribution[account.marketplace].sales += account.sales;
      }

      expect(distribution['US'].count).toBe(2);
      expect(distribution['US'].spend).toBe(300);
      expect(distribution['US'].sales).toBe(1300);
      expect(distribution['UK'].count).toBe(1);
      expect(distribution['DE'].count).toBe(1);
    });

    it('should handle empty accounts list', () => {
      const accounts: Array<{ marketplace: string; spend: number; sales: number }> = [];
      const distribution: Record<string, { count: number; spend: number; sales: number }> = {};
      
      for (const account of accounts) {
        if (!distribution[account.marketplace]) {
          distribution[account.marketplace] = { count: 0, spend: 0, sales: 0 };
        }
        distribution[account.marketplace].count++;
      }

      expect(Object.keys(distribution).length).toBe(0);
    });
  });

  describe('Account Comparison', () => {
    it('should compare accounts by spend', () => {
      const accounts = [
        { id: 1, name: 'Store A', spend: 100 },
        { id: 2, name: 'Store B', spend: 200 },
        { id: 3, name: 'Store C', spend: 150 },
      ];

      const sorted = [...accounts].sort((a, b) => b.spend - a.spend);
      expect(sorted[0].name).toBe('Store B');
      expect(sorted[1].name).toBe('Store C');
      expect(sorted[2].name).toBe('Store A');
    });

    it('should compare accounts by ACoS', () => {
      const accounts = [
        { id: 1, name: 'Store A', acos: 25 },
        { id: 2, name: 'Store B', acos: 15 },
        { id: 3, name: 'Store C', acos: 30 },
      ];

      const sorted = [...accounts].sort((a, b) => a.acos - b.acos);
      expect(sorted[0].name).toBe('Store B'); // Lowest ACoS is best
      expect(sorted[2].name).toBe('Store C'); // Highest ACoS is worst
    });
  });
});

// 测试账号导入导出功能
describe('Account Import/Export', () => {
  describe('Export Format', () => {
    it('should generate valid JSON export', () => {
      const accounts = [
        { accountId: 'A1', accountName: 'Store 1', marketplace: 'US' },
        { accountId: 'A2', accountName: 'Store 2', marketplace: 'UK' },
      ];

      const jsonExport = JSON.stringify(accounts, null, 2);
      const parsed = JSON.parse(jsonExport);
      
      expect(parsed.length).toBe(2);
      expect(parsed[0].accountId).toBe('A1');
      expect(parsed[1].marketplace).toBe('UK');
    });

    it('should generate valid CSV export', () => {
      const accounts = [
        { accountId: 'A1', accountName: 'Store 1', marketplace: 'US' },
        { accountId: 'A2', accountName: 'Store 2', marketplace: 'UK' },
      ];

      const headers = ['accountId', 'accountName', 'marketplace'];
      const csvRows = [
        headers.join(','),
        ...accounts.map(row => 
          headers.map(h => row[h as keyof typeof row] || '').join(',')
        ),
      ];
      const csvExport = csvRows.join('\n');

      expect(csvExport).toContain('accountId,accountName,marketplace');
      expect(csvExport).toContain('A1,Store 1,US');
      expect(csvExport).toContain('A2,Store 2,UK');
    });

    it('should handle special characters in CSV', () => {
      const value = 'Store, with "quotes"';
      const escaped = value.includes(',') || value.includes('"') 
        ? `"${value.replace(/"/g, '""')}"` 
        : value;
      
      expect(escaped).toBe('"Store, with ""quotes"""');
    });
  });

  describe('Import Validation', () => {
    it('should parse valid JSON import', () => {
      const jsonData = '[{"accountId": "A1", "accountName": "Store 1", "marketplace": "US"}]';
      const parsed = JSON.parse(jsonData);
      
      expect(parsed.length).toBe(1);
      expect(parsed[0].accountId).toBe('A1');
    });

    it('should reject invalid JSON', () => {
      const invalidJson = '{invalid json}';
      expect(() => JSON.parse(invalidJson)).toThrow();
    });

    it('should parse valid CSV import', () => {
      const csvData = 'accountId,accountName,marketplace\nA1,Store 1,US\nA2,Store 2,UK';
      const lines = csvData.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim());
      
      const accounts = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx] || '';
        });
        accounts.push(row);
      }

      expect(accounts.length).toBe(2);
      expect(accounts[0].accountId).toBe('A1');
      expect(accounts[1].marketplace).toBe('UK');
    });

    it('should validate required fields', () => {
      const account = { accountId: 'A1', accountName: '', marketplace: 'US' };
      const isValid = account.accountId && account.accountName && account.marketplace;
      expect(isValid).toBeFalsy();
    });

    it('should detect existing accounts', () => {
      const existingAccountIds = new Set(['A1', 'A3']);
      const importAccounts = [
        { accountId: 'A1' },
        { accountId: 'A2' },
        { accountId: 'A3' },
      ];

      const results = importAccounts.map(a => ({
        ...a,
        exists: existingAccountIds.has(a.accountId),
      }));

      expect(results[0].exists).toBe(true);
      expect(results[1].exists).toBe(false);
      expect(results[2].exists).toBe(true);
    });
  });

  describe('Import Overwrite Logic', () => {
    it('should skip existing accounts when overwrite is false', () => {
      const existingIds = new Set(['A1']);
      const toImport = [{ accountId: 'A1' }, { accountId: 'A2' }];
      const overwrite = false;

      let imported = 0;
      let skipped = 0;

      for (const account of toImport) {
        if (existingIds.has(account.accountId)) {
          if (overwrite) {
            // Would update
          } else {
            skipped++;
          }
        } else {
          imported++;
        }
      }

      expect(imported).toBe(1);
      expect(skipped).toBe(1);
    });

    it('should update existing accounts when overwrite is true', () => {
      const existingIds = new Set(['A1']);
      const toImport = [{ accountId: 'A1' }, { accountId: 'A2' }];
      const overwrite = true;

      let imported = 0;
      let updated = 0;

      for (const account of toImport) {
        if (existingIds.has(account.accountId)) {
          if (overwrite) {
            updated++;
          }
        } else {
          imported++;
        }
      }

      expect(imported).toBe(1);
      expect(updated).toBe(1);
    });
  });
});

// 测试账号切换器功能
describe('Account Switcher', () => {
  describe('Current Account Selection', () => {
    it('should store account ID in localStorage format', () => {
      const accountId = 123;
      const stored = accountId.toString();
      const retrieved = parseInt(stored, 10);
      expect(retrieved).toBe(123);
    });

    it('should handle null account ID', () => {
      const saved = null;
      const accountId = saved ? parseInt(saved, 10) : null;
      expect(accountId).toBeNull();
    });
  });

  describe('Default Account Selection', () => {
    it('should select default account when available', () => {
      const accounts = [
        { id: 1, isDefault: false },
        { id: 2, isDefault: true },
        { id: 3, isDefault: false },
      ];

      const defaultAccount = accounts.find(a => a.isDefault) || accounts[0];
      expect(defaultAccount.id).toBe(2);
    });

    it('should select first account when no default', () => {
      const accounts = [
        { id: 1, isDefault: false },
        { id: 2, isDefault: false },
      ];

      const defaultAccount = accounts.find(a => a.isDefault) || accounts[0];
      expect(defaultAccount.id).toBe(1);
    });
  });

  describe('Connection Status', () => {
    it('should return correct color for connected status', () => {
      const getColor = (status: string | null) => {
        switch (status) {
          case 'connected': return 'bg-green-500';
          case 'error': return 'bg-red-500';
          case 'disconnected': return 'bg-gray-500';
          default: return 'bg-yellow-500';
        }
      };

      expect(getColor('connected')).toBe('bg-green-500');
      expect(getColor('error')).toBe('bg-red-500');
      expect(getColor('disconnected')).toBe('bg-gray-500');
      expect(getColor(null)).toBe('bg-yellow-500');
      expect(getColor('pending')).toBe('bg-yellow-500');
    });
  });

  describe('Marketplace Flags', () => {
    it('should return correct flag for marketplace', () => {
      const flags: Record<string, string> = {
        US: '🇺🇸',
        UK: '🇬🇧',
        DE: '🇩🇪',
        JP: '🇯🇵',
      };

      expect(flags['US']).toBe('🇺🇸');
      expect(flags['UK']).toBe('🇬🇧');
      expect(flags['DE']).toBe('🇩🇪');
      expect(flags['JP']).toBe('🇯🇵');
    });

    it('should handle unknown marketplace', () => {
      const flags: Record<string, string> = { US: '🇺🇸' };
      const flag = flags['XX'] || '🌐';
      expect(flag).toBe('🌐');
    });
  });
});

// 测试CTR和CVR计算
describe('Metrics Calculation', () => {
  it('should calculate CTR correctly', () => {
    const impressions = 10000;
    const clicks = 250;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    expect(ctr).toBe(2.5);
  });

  it('should calculate CVR correctly', () => {
    const clicks = 250;
    const orders = 25;
    const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
    expect(cvr).toBe(10);
  });

  it('should handle zero impressions', () => {
    const impressions = 0;
    const clicks = 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    expect(ctr).toBe(0);
  });

  it('should handle zero clicks', () => {
    const clicks = 0;
    const orders = 0;
    const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
    expect(cvr).toBe(0);
  });
});
