/**
 * 跨账户汇总路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// ==================== Cross Account Summary Router ====================
export const crossAccountRouter = router({
  // 获取所有账号的汇总数据
  getSummary: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const accounts = await db.getAdAccountsByUserId(ctx.user.id);
      
      if (accounts.length === 0) {
        return {
          totalAccounts: 0,
          connectedAccounts: 0,
          totalSpend: 0,
          totalSales: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalOrders: 0,
          avgAcos: 0,
          avgRoas: 0,
          avgCtr: 0,
          avgCvr: 0,
          accountsData: [],
          marketplaceDistribution: {},
          dailyTrend: [],
        };
      }

      // 获取每个账号的数据
      const accountsData = await Promise.all(
        accounts.map(async (account) => {
          // 获取该账号下的所有绩效组
          const performanceGroups = await db.getPerformanceGroupsByAccountId(account.id);
          
          // 汇总该账号的数据
          let totalSpend = 0;
          let totalSales = 0;
          let totalImpressions = 0;
          let totalClicks = 0;
          let totalOrders = 0;

          for (const pg of performanceGroups) {
            // 获取绩效组下的所有广告活动
            const campaigns = await db.getCampaignsByPerformanceGroupId(pg.id);
            for (const campaign of (campaigns as unknown[])) {
              totalSpend += parseFloat(campaign.spend || '0');
              totalSales += parseFloat(campaign.sales || '0');
              totalImpressions += campaign.impressions || 0;
              totalClicks += campaign.clicks || 0;
              totalOrders += campaign.orders || 0;
            }
          }

          const acos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
          const roas = totalSpend > 0 ? totalSales / totalSpend : 0;
          const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
          const cvr = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;

          return {
            id: account.id,
            accountName: account.accountName,
            storeName: account.storeName,
            storeColor: account.storeColor,
            marketplace: account.marketplace,
            connectionStatus: account.connectionStatus,
            spend: totalSpend,
            sales: totalSales,
            impressions: totalImpressions,
            clicks: totalClicks,
            orders: totalOrders,
            acos,
            roas,
            ctr,
            cvr,
          };
        })
      );

      // 计算汇总
      const totalSpend = accountsData.reduce((sum: number, a: Record<string, unknown>) => sum + a.spend, 0);
      const totalSales = accountsData.reduce((sum: number, a: Record<string, unknown>) => sum + a.sales, 0);
      const totalImpressions = accountsData.reduce((sum: number, a: Record<string, unknown>) => sum + a.impressions, 0);
      const totalClicks = accountsData.reduce((sum: number, a: Record<string, unknown>) => sum + a.clicks, 0);
      const totalOrders = accountsData.reduce((sum: number, a: Record<string, unknown>) => sum + a.orders, 0);

      const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
      const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
      const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      const avgCvr = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;

      // 市场分布
      const marketplaceDistribution: Record<string, { count: number; spend: number; sales: number }> = {};
      for (const account of (accountsData as unknown[])) {
        if (!marketplaceDistribution[account.marketplace]) {
          marketplaceDistribution[account.marketplace] = { count: 0, spend: 0, sales: 0 };
        }
        marketplaceDistribution[account.marketplace].count++;
        marketplaceDistribution[account.marketplace].spend += account.spend;
        marketplaceDistribution[account.marketplace].sales += account.sales;
      }

      return {
        totalAccounts: accounts.length,
        connectedAccounts: accounts.filter(a => a.connectionStatus === 'connected').length,
        totalSpend,
        totalSales,
        totalImpressions,
        totalClicks,
        totalOrders,
        avgAcos,
        avgRoas,
        avgCtr,
        avgCvr,
        accountsData,
        marketplaceDistribution,
        dailyTrend: [], // 可以后续实现每日趋势
      };
    }),

  // 获取账号对比数据
  getComparison: protectedProcedure
    .input(z.object({
      accountIds: z.array(z.number()),
      metric: z.enum(['spend', 'sales', 'acos', 'roas', 'impressions', 'clicks', 'orders', 'ctr', 'cvr']),
    }))
    .query(async ({ ctx, input }) => {
      const accounts = await db.getAdAccountsByUserId(ctx.user.id);
      const selectedAccounts = accounts.filter(a => input.accountIds.includes(a.id));
      
      const comparisonData = await Promise.all(
        selectedAccounts.map(async (account) => {
          const performanceGroups = await db.getPerformanceGroupsByAccountId(account.id);
          
          let totalSpend = 0;
          let totalSales = 0;
          let totalImpressions = 0;
          let totalClicks = 0;
          let totalOrders = 0;

          for (const pg of performanceGroups) {
            const campaigns = await db.getCampaignsByPerformanceGroupId(pg.id);
            for (const campaign of (campaigns as unknown[])) {
              totalSpend += parseFloat(campaign.spend || '0');
              totalSales += parseFloat(campaign.sales || '0');
              totalImpressions += campaign.impressions || 0;
              totalClicks += campaign.clicks || 0;
              totalOrders += campaign.orders || 0;
            }
          }

          const metrics = {
            spend: totalSpend,
            sales: totalSales,
            acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
            roas: totalSpend > 0 ? totalSales / totalSpend : 0,
            impressions: totalImpressions,
            clicks: totalClicks,
            orders: totalOrders,
            ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
            cvr: totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0,
          };

          return {
            id: account.id,
            name: account.storeName || account.accountName,
            color: account.storeColor || '#3B82F6',
            marketplace: account.marketplace,
            value: metrics[input.metric],
          };
        })
      );

      return comparisonData;
    }),

  // 导出账号配置
  exportAccounts: protectedProcedure
    .input(z.object({
      format: z.enum(['json', 'csv']),
      accountIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let accounts = await db.getAdAccountsByUserId(ctx.user.id);
      
      if (input.accountIds && input.accountIds.length > 0) {
        accounts = accounts.filter(a => input.accountIds!.includes(a.id));
      }

      // 移除敏感信息
      const exportData = accounts.map(a => ({
        accountId: a.accountId,
        accountName: a.accountName,
        storeName: a.storeName,
        storeDescription: a.storeDescription,
        storeColor: a.storeColor,
        marketplace: a.marketplace,
        marketplaceId: a.marketplaceId,
        profileId: a.profileId,
        sellerId: a.sellerId,
        isDefault: a.isDefault,
        sortOrder: a.sortOrder,
      }));

      if (input.format === 'json') {
        return {
          format: 'json',
          data: JSON.stringify(exportData, null, 2),
          filename: `amazon-accounts-${new Date().toISOString().split('T')[0]}.json`,
        };
      } else {
        // CSV格式
        const headers = ['accountId', 'accountName', 'storeName', 'storeDescription', 'storeColor', 'marketplace', 'marketplaceId', 'profileId', 'sellerId', 'isDefault', 'sortOrder'];
        const csvRows = [
          headers.join(','),
          ...exportData.map(row => 
            headers.map(h => {
              const value = row[h as keyof typeof row];
              if (value === null || value === undefined) return '';
              if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`;
              }
              return String(value);
            }).join(',')
          ),
        ];
        return {
          format: 'csv',
          data: csvRows.join('\n'),
          filename: `amazon-accounts-${new Date().toISOString().split('T')[0]}.csv`,
        };
      }
    }),

  // 导入账号配置
  importAccounts: protectedProcedure
    .input(z.object({
      data: z.string(),
      format: z.enum(['json', 'csv']),
      overwrite: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let accountsToImport: Array<{
        accountId: string;
        accountName: string;
        storeName?: string;
        storeDescription?: string;
        storeColor?: string;
        marketplace: string;
        marketplaceId?: string;
        profileId?: string;
        sellerId?: string;
        isDefault?: boolean;
      }> = [];

      if (input.format === 'json') {
        try {
          accountsToImport = JSON.parse(input.data);
        } catch (e) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'JSON格式无效' });
        }
      } else {
        // 解析CSV
        const lines = input.data.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'CSV文件为空或格式错误' });
        }
        
        const headers = lines[0].split(',').map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row: Record<string, string> = {};
          headers.forEach((h: unknown, idx: unknown) => {
            row[h] = values[idx] || '';
          });
          
          if (row.accountId && row.accountName && row.marketplace) {
            accountsToImport.push({
              accountId: row.accountId,
              accountName: row.accountName,
              storeName: row.storeName || undefined,
              storeDescription: row.storeDescription || undefined,
              storeColor: row.storeColor || undefined,
              marketplace: row.marketplace,
              marketplaceId: row.marketplaceId || undefined,
              profileId: row.profileId || undefined,
              sellerId: row.sellerId || undefined,
              isDefault: row.isDefault === 'true',
            });
          }
        }
      }

      if (accountsToImport.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '没有找到有效的账号数据' });
      }

      // 获取现有账号
      const existingAccounts = await db.getAdAccountsByUserId(ctx.user.id);
      const existingAccountIds = new Set(existingAccounts.map(a => a.accountId));

      let imported = 0;
      let skipped = 0;
      let updated = 0;

      for (const account of (accountsToImport as unknown[])) {
        if (existingAccountIds.has(account.accountId)) {
          if (input.overwrite) {
            // 更新现有账号
            const existing = existingAccounts.find(a => a.accountId === account.accountId);
            if (existing) {
              await db.updateAdAccount(existing.id, {
                accountName: account.accountName,
                storeName: account.storeName,
                storeDescription: account.storeDescription,
                storeColor: account.storeColor,
                marketplace: account.marketplace,
                marketplaceId: account.marketplaceId,
                profileId: account.profileId,
                sellerId: account.sellerId,
              });
              updated++;
            }
          } else {
            skipped++;
          }
        } else {
          // 创建新账号
          await db.createAdAccount({
            userId: ctx.user.id,
            ...account,
            isDefault: account.isDefault ? 1 : 0,
            connectionStatus: 'pending',
          });
          imported++;
        }
      }

      return {
        total: accountsToImport.length,
        imported,
        updated,
        skipped,
      };
    }),

  // 预览导入数据
  previewImport: protectedProcedure
    .input(z.object({
      data: z.string(),
      format: z.enum(['json', 'csv']),
    }))
    .mutation(async ({ ctx, input }) => {
      let accountsToImport: Array<{
        accountId: string;
        accountName: string;
        storeName?: string;
        marketplace: string;
      }> = [];

      if (input.format === 'json') {
        try {
          accountsToImport = JSON.parse(input.data);
        } catch (e) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'JSON格式无效' });
        }
      } else {
        const lines = input.data.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'CSV文件为空或格式错误' });
        }
        
        const headers = lines[0].split(',').map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row: Record<string, string> = {};
          headers.forEach((h: unknown, idx: unknown) => {
            row[h] = values[idx] || '';
          });
          
          if (row.accountId && row.accountName && row.marketplace) {
            accountsToImport.push({
              accountId: row.accountId,
              accountName: row.accountName,
              storeName: row.storeName || undefined,
              marketplace: row.marketplace,
            });
          }
        }
      }

      // 检查哪些账号已存在
      const existingAccounts = await db.getAdAccountsByUserId(ctx.user.id);
      const existingAccountIds = new Set(existingAccounts.map(a => a.accountId));

      return accountsToImport.map(a => ({
        ...a,
        exists: existingAccountIds.has(a.accountId),
      }));
    }),
});
