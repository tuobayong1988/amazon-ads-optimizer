/**
 * 广告账户管理路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { calculateDateRangeByMarketplace, getMarketplaceLocalDate, MARKETPLACE_TIMEZONES } from '../../shared/timezone';
import { apiCache } from '../services/apiCacheService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// v452.8: 系统管理员判断 - 只有内部组织(orgId=1)的admin才是系统管理员
function isSystemAdmin(user: unknown): boolean {
  // @ts-expect-error Dynamic property access
  return user.role === 'admin' && user.organizationId === 1;
}

// v667: 获取用户可见的账户列表（数据隔离修复）
// 系统管理员看同组织内所有账户，普通用户只看自己的账户
async function getUserVisibleAccounts(user: Record<string, unknown>) {
  if (isSystemAdmin(user)) {
    // v667: 系统管理员也只能看到自己组织内的账户，不再返回所有租户数据
    return db.getAdAccountsByOrganizationId(user.organizationId as number);
  }
  return db.getAdAccountsByUserId(user.id as number);
}

// ==================== Ad Account Router ====================
export const adAccountRouter = router({
  // v667: 数据隔离修复 — 所有用户（包括管理员）只能看到自己组织内的账户
  // @ts-expect-error Complex function parameter types
  list: protectedProcedure.query(async ({ ctx }: unknown) => {
    return getUserVisibleAccounts(ctx.user);
  }),
  
  // v359: 安全修复 — 获取单个账号详情（需认证，验证归属）
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const account = await db.getAdAccountById(input.id);
      if (!account) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
      }
      // v667: 数据隔离修复 — 系统管理员检查组织归属，普通用户检查userId归属
      if (isSystemAdmin(ctx.user)) {
        if (account.organizationId !== (ctx.user as Record<string, unknown>).organizationId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '无权访问此账号' });
        }
      } else if (account.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '无权访问此账号' });
      }
      return account;
    }),
  
  // v359: 安全修复 — 获取默认账号（需认证，按用户隔离）
  // @ts-expect-error Legacy code type compatibility
  getDefault: protectedProcedure
    .input(z.object({ userId: z.number().optional() }).optional())
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx }: unknown) => {
      // v667: 数据隔离修复 — 使用组织级隔离
      const accounts = await getUserVisibleAccounts(ctx.user);
      return accounts.find(a => a.isDefault) || accounts[0] || null;
    }),
  
  // 创建新账号
  create: protectedProcedure
    .input(z.object({
      accountId: z.string(),
      accountName: z.string(),
      storeName: z.string().optional(),
      storeDescription: z.string().optional(),
      storeColor: z.string().optional(),
      marketplace: z.string(),
      marketplaceId: z.string().optional(),
      profileId: z.string().optional(),
      sellerId: z.string().optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 如果设置为默认账号，先取消其他默认
      if (input.isDefault) {
        const accounts = await db.getAdAccountsByUserId(ctx.user.id);
        for (const acc of accounts) {
          if (acc.isDefault) {
            await db.updateAdAccount(acc.id, { isDefault: 0 });
          }
        }
      }
      
      const id = await db.createAdAccount({
        userId: ctx.user.id,
        organizationId: (ctx.user as Record<string, unknown>).organizationId as number || 1,
        ...input,
        isDefault: input.isDefault ? 1 : 0,
        connectionStatus: 'pending',
      });
      return { id };
    }),
  
  // 创建空店铺（不包含站点）
  createStore: protectedProcedure
    .input(z.object({
      storeName: z.string(),
      storeDescription: z.string().optional(),
      storeColor: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 检查是否已存在同名店铺
      const existingAccounts = await db.getAdAccountsByUserId(ctx.user.id);
      const existingStore = existingAccounts.find(a => a.storeName === input.storeName);
      if (existingStore) {
        throw new TRPCError({ code: 'CONFLICT', message: '已存在同名店铺' });
      }
      
      // 创建空店铺（使用店铺名称作为accountId和accountName，marketplace为空）
      const id = await db.createAdAccount({
        userId: ctx.user.id,
        organizationId: (ctx.user as Record<string, unknown>).organizationId as number || 1,
        storeName: input.storeName,
        storeDescription: input.storeDescription,
        storeColor: input.storeColor,
        accountId: `store_${Date.now()}`, // 临时ID，授权后会更新
        accountName: input.storeName,
        marketplace: '', // 空店铺没有站点
        connectionStatus: 'pending',
        isDefault: existingAccounts.length === 0 ? 1 : 0, // 第一个店铺设为默认
      });
      return { id, storeName: input.storeName };
    }),
  
  // 更新账号信息
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      accountName: z.string().optional(),
      storeName: z.string().optional(),
      storeDescription: z.string().optional(),
      storeColor: z.string().optional(),
      marketplace: z.string().optional(),
      marketplaceId: z.string().optional(),
      profileId: z.string().optional(),
      sellerId: z.string().optional(),
      conversionValueType: z.enum(["sales", "units", "custom"]).optional(),
      conversionValueSource: z.enum(["platform", "custom"]).optional(),
      intradayBiddingEnabled: z.boolean().optional(),
      // @ts-expect-error Legacy code type compatibility
      defaultMaxBid: z.string().optional(),
      status: z.enum(["active", "paused", "archived"]).optional(),
    }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      const { id, intradayBiddingEnabled, ...rest } = input;
      const data = {
        ...rest,
        ...(intradayBiddingEnabled !== undefined && { intradayBiddingEnabled: intradayBiddingEnabled ? 1 : 0 }),
      };
      await db.updateAdAccount(id, data);
      return { success: true };
    }),
  
  // 删除账号
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // 验证账号属于当前用户
      const account = await db.getAdAccountById(input.id);
      if (!account || account.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
      }
      await db.deleteAdAccount(input.id);
      return { success: true };
    }),
  
  // 设置默认账号
  setDefault: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // 验证账号属于当前用户
      const account = await db.getAdAccountById(input.id);
      if (!account || account.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
      }
      await db.setDefaultAdAccount(ctx.user.id, input.id);
      return { success: true };
    }),
  
  // 调整账号排序
  reorder: protectedProcedure
    .input(z.object({ accountIds: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      await db.reorderAdAccounts(ctx.user.id, input.accountIds);
      return { success: true };
    }),
  
  // 更新账号连接状态
  updateConnectionStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(['connected', 'disconnected', 'error', 'pending']),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 验证账号属于当前用户
      const account = await db.getAdAccountById(input.id);
      if (!account || account.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
      }
      await db.updateAdAccountConnectionStatus(input.id, input.status, input.errorMessage);
      return { success: true };
    }),
  
  // 获取账号列表及绩效汇总（支持时间范围筛选，根据站点时区计算日期）
  listWithPerformance: protectedProcedure
    .input(z.object({
      timeRange: z.enum(['today', 'yesterday', '7days', '14days', '30days', '60days', '90days', 'custom']).optional().default('7days'),
      days: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
    // v268 性能优化: API响应缓存（TTL 2分钟）
    const cacheKey = apiCache.generateKey('listWithPerformance', ctx.user.id, input);
    const cached = apiCache.get<unknown>(cacheKey);
    if (cached) return cached;

    const timeRange = input?.timeRange || '7days';
    // 管理员可以访问所有账户
    // v667: 数据隔离修复 — 使用组织级隔离
    const accounts = await getUserVisibleAccounts(ctx.user as Record<string, unknown>);
    
    // 过滤掉空店铺占位记录（marketplace为空）
    const actualSites = accounts.filter(a => a.marketplace && a.marketplace !== '');
    
    // 辅助函数：根据站点时区计算日期范围
    const calculateDatesForMarketplace = (marketplace: string) => {
      // 获取站点本地日期
      const localDateStr = getMarketplaceLocalDate(marketplace);
      const [year, month, day] = localDateStr.split('-').map(Number);
      const localToday = new Date(year, month - 1, day);
      
      let startDate: Date;
      let endDate: Date;
      let prevStartDate: Date;
      let prevEndDate: Date;
      
      if (timeRange === 'custom' && input?.startDate && input?.endDate) {
        startDate = new Date(input.startDate);
        endDate = new Date(input.endDate);
        const rangeDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        prevEndDate = new Date(startDate);
        prevStartDate = new Date(prevEndDate);
        prevStartDate.setDate(prevStartDate.getDate() - rangeDays);
      } else if (timeRange === 'today') {
        // 使用站点本地的"今天"
        startDate = localToday;
        endDate = localToday;
        prevStartDate = new Date(localToday);
        prevStartDate.setDate(prevStartDate.getDate() - 1);
        prevEndDate = new Date(localToday);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else if (timeRange === 'yesterday') {
        // 使用站点本地的"昨天"
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 1);
        endDate = new Date(startDate);
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 1);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else if (timeRange === '7days') {
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 6);
        endDate = localToday;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 7);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else if (timeRange === '14days') {
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 13);
        endDate = localToday;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 14);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else if (timeRange === '30days') {
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 29);
        endDate = localToday;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 30);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else if (timeRange === '60days') {
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 59);
        endDate = localToday;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 60);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else { // 90days
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 89);
        endDate = localToday;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 90);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      }
      
      return { startDate, endDate, prevStartDate, prevEndDate, localToday };
    };
    
    // v689: 性能优化 — 按站点时区分组，使用批量聚合替代逐账户查询
    // 原来: N个账户 × 2次查询 = 2N次DB往返
    // 现在: 按marketplace分组，每组只需2次查询（当前期+上期），总共约 2×站点数 次DB往返
    
    // 步骤1: 按marketplace分组（同一marketplace的账户共享相同时区和日期范围）
    const marketplaceGroups = new Map<string, typeof actualSites>();
    for (const account of actualSites) {
      const mp = account.marketplace || 'US';
      if (!marketplaceGroups.has(mp)) marketplaceGroups.set(mp, []);
      marketplaceGroups.get(mp)!.push(account);
    }
    
    // 步骤2: 每个marketplace组批量查询
    const perfMap = new Map<number, { current: { spend: number; sales: number; orders: number }; prev: { spend: number; sales: number } }>();
    
    await Promise.all(
      Array.from(marketplaceGroups.entries()).map(async ([mp, accounts]) => {
        const { startDate, endDate, prevStartDate, prevEndDate } = calculateDatesForMarketplace(mp);
        const ids = accounts.map(a => a.id);
        
        // 批量获取当前期间和上一期间的绩效
        const [currentBatch, prevBatch] = await Promise.all([
          db.getBatchAccountPerformanceSummary(ids, startDate, endDate),
          db.getBatchAccountPerformanceSummary(ids, prevStartDate, prevEndDate),
        ]);
        
        for (const id of ids) {
          const current = currentBatch.get(id);
          const prev = prevBatch.get(id);
          perfMap.set(id, {
            current: { spend: current?.totalSpend || 0, sales: current?.totalSales || 0, orders: current?.totalOrders || 0 },
            prev: { spend: prev?.totalSpend || 0, sales: prev?.totalSales || 0 },
          });
        }
      })
    );
    
    // 步骤3: 组装结果
    const accountsWithPerformance = actualSites.map((account) => {
      const perf = perfMap.get(account.id);
      const spend = perf?.current.spend || 0;
      const sales = perf?.current.sales || 0;
      const orders = perf?.current.orders || 0;
      const acos = spend > 0 && sales > 0 ? (spend / sales) * 100 : 0;
      const roas = spend > 0 && sales > 0 ? sales / spend : 0;
      
      // 计算环比变化
      const prevSpend = perf?.prev.spend || 0;
      const prevSales = perf?.prev.sales || 0;
      const prevAcos = prevSpend > 0 && prevSales > 0 ? (prevSpend / prevSales) * 100 : 0;
      
      const spendChange = prevSpend > 0 ? ((spend - prevSpend) / prevSpend) * 100 : 0;
      const salesChange = prevSales > 0 ? ((sales - prevSales) / prevSales) * 100 : 0;
      const acosChange = prevAcos > 0 ? acos - prevAcos : 0;
      
      // 确定账户状态
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      let alerts = 0;
      if (acos > 35) {
        status = 'warning';
        alerts = 1;
      }
      if (acos > 50) {
        status = 'critical';
        alerts = 2;
      }
      
      return {
        id: account.id,
        name: account.storeName || account.accountName,
        marketplace: account.marketplace,
        spend,
        sales,
        orders,
        acos,
        roas,
        status,
        alerts,
        change: { 
          spend: parseFloat(spendChange.toFixed(1)), 
          sales: parseFloat(salesChange.toFixed(1)), 
          acos: parseFloat(acosChange.toFixed(1)) 
        },
      };
    });
    
    // v689: 缓存TTL从2分钟提升到5分钟（数据概览不需要实时性）
    apiCache.set(cacheKey, accountsWithPerformance, 5 * 60 * 1000);
    // @ts-expect-error Return type compatibility
    return accountsWithPerformance;
  }),

  // 获取账号统计信息
  // @ts-expect-error Complex function parameter types
  getStats: protectedProcedure.query(async ({ ctx }: unknown) => {
    // v667: 数据隔离修复 — 使用组织级隔离
    const accounts = await getUserVisibleAccounts(ctx.user as Record<string, unknown>);
    
    // 过滤掉空店铺占位记录（marketplace为空），只统计实际站点
    const actualSites = accounts.filter(a => a.marketplace && a.marketplace !== '');
    
    // 按店铺名称分组，统计店铺数量
    const storeNames = new Set(accounts.map(a => a.storeName || a.accountName));
    
    const stats = {
      // 总店铺数（按storeName去重）
      total: storeNames.size,
      // 已连接的站点数
      connected: actualSites.filter(a => a.connectionStatus === 'connected').length,
      // 待配置的站点数（包括空店铺）
      pending: accounts.filter(a => a.connectionStatus === 'pending' || !a.marketplace || a.marketplace === '').length,
      // 连接错误的站点数
      error: actualSites.filter(a => a.connectionStatus === 'error').length,
      // 市场覆盖（去重后的国家数量）
      marketplaceCount: new Set(actualSites.map(a => a.marketplace)).size,
      // 按市场分组统计
      // @ts-expect-error Generic type constraint
      byMarketplace: {} as Record<string, number>,
    };
    
    for (const account of (actualSites as unknown[])) {
      // @ts-expect-error Conditional type narrowing
      if (account.marketplace) {
        // @ts-expect-error Legacy code type compatibility
        stats.byMarketplace[account.marketplace] = (stats.byMarketplace[account.marketplace] || 0) + 1;
      }
    }
    
    return stats;
  }),
  
  // 获取每日趋势数据
  getDailyTrend: protectedProcedure
    .input(z.object({
      days: z.number().default(7),
      timeRange: z.enum(['today', 'yesterday', '7days', '14days', '30days', '60days', '90days', 'custom']).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // v268 性能优化: API响应缓存（TTL 2分钟）
      const cacheKey = apiCache.generateKey('getDailyTrend', ctx.user.id, input);
      const cached = apiCache.get<unknown>(cacheKey);
      if (cached) return cached;

      // v667: 数据隔离修复 — 使用组织级隔离
      const accounts = await getUserVisibleAccounts(ctx.user as Record<string, unknown>);
      const actualSites = accounts.filter(a => a.marketplace && a.marketplace !== '');
      const accountIds = actualSites.map(a => a.id);
      
      if (accountIds.length === 0) {
        return [];
      }
      
      // v104: 对于预设时间范围，使用站点时区计算日期
      // 数据概览页面汇总所有站点，使用US时区作为基准（因为所有北美站点都用PST）
      let startDate = input.startDate;
      let endDate = input.endDate;
      const timeRange = input.timeRange || '7days';
      
      if (timeRange !== 'custom') {
        // 使用US时区计算日期范围（北美站点统一使用PST）
        const localDateStr = getMarketplaceLocalDate('US');
        const [year, month, day] = localDateStr.split('-').map(Number);
        const localToday = new Date(year, month - 1, day);
        
        if (timeRange === 'today') {
          startDate = localDateStr;
          endDate = localDateStr;
        } else if (timeRange === 'yesterday') {
          const yesterday = new Date(localToday);
          yesterday.setDate(yesterday.getDate() - 1);
          const yd = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
          startDate = yd;
          endDate = yd;
        } else {
          const daysMap: Record<string, number> = { '7days': 6, '14days': 13, '30days': 29, '60days': 59, '90days': 89 };
          const daysBack = daysMap[timeRange] || 6;
          const sd = new Date(localToday);
          sd.setDate(sd.getDate() - daysBack);
          startDate = `${sd.getFullYear()}-${String(sd.getMonth()+1).padStart(2,'0')}-${String(sd.getDate()).padStart(2,'0')}`;
          endDate = localDateStr;
        }
      }
      
      // 获取每日绩效数据
      // @ts-expect-error DB query type inference limitation
      const trendData = await db.getDailyTrendData(accountIds, input.days, 'custom', startDate, endDate);
      // v268: 缓存结果
      // v689: 缓存TTL从2分钟提升到5分钟（趋势图数据不需要实时性）
      apiCache.set(cacheKey, trendData, 5 * 60 * 1000);
      return trendData;
    }),
  
  // 获取数据可用日期范围（用于自定义日期选择器的限制）
  // @ts-expect-error Complex function parameter types
  getDataDateRange: protectedProcedure.query(async ({ ctx }: unknown) => {
    // v667: 数据隔离修复 — 使用组织级隔离
    const accounts = await getUserVisibleAccounts(ctx.user as Record<string, unknown>);
    const actualSites = accounts.filter(a => a.marketplace && a.marketplace !== '');
    const accountIds = actualSites.map(a => a.id);
    
    if (accountIds.length === 0) {
      // 没有账户时，返回默认90天范围
      const now = new Date();
      const minDate = new Date(now);
      minDate.setDate(minDate.getDate() - 90);
      return {
        minDate: minDate.toISOString().split('T')[0],
        maxDate: now.toISOString().split('T')[0],
        hasData: false,
      };
    }
    
    // 获取最早和最晚的数据日期
    const dateRange = await db.getDataDateRange(accountIds);
    return dateRange;
  }),
});
