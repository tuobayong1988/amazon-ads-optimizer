/**
 * v26.7.6: PPCOPT Bridge 同步路由
 * 
 * 提供手动触发同步、查看同步状态、管理自动同步的 tRPC 端点。
 */
import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import {
  executeBridgeSync,
  pullPerformanceFromBridge,
  startAutoSync,
  stopAutoSync,
  getAutoSyncStatus,
} from '../services/bridgeSyncService';

export const bridgeSyncRouter = router({
  // 手动触发 Bridge 同步
  triggerSync: protectedProcedure
    .input(z.object({
      storeName: z.string(),
      marketplace: z.string(),
      accountId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const dateRange = input.startDate && input.endDate
        ? { startDate: input.startDate, endDate: input.endDate }
        : undefined;

      const result = await executeBridgeSync(
        {
          storeName: input.storeName,
          marketplace: input.marketplace,
          accountId: input.accountId,
        },
        dateRange
      );

      return result;
    }),

  // 仅预览 Bridge 数据（不写入数据库）
  previewData: protectedProcedure
    .input(z.object({
      storeName: z.string(),
      marketplace: z.string(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const dateRange = input.startDate && input.endDate
        ? { startDate: input.startDate, endDate: input.endDate }
        : undefined;

      const data = await pullPerformanceFromBridge(
        {
          storeName: input.storeName,
          marketplace: input.marketplace,
          accountId: 0, // Not needed for preview
        },
        dateRange
      );

      return {
        success: data.success,
        totalCampaigns: data.campaigns?.length || 0,
        campaignsWithData: data.campaigns?.filter(c => c.impressions > 0).length || 0,
        trendPoints: data.dailyTrend?.length || 0,
        summary: data.summary,
        sampleCampaigns: data.campaigns?.slice(0, 5),
        sampleTrend: data.dailyTrend?.slice(0, 5),
      };
    }),

  // 启动自动同步
  startAutoSync: protectedProcedure
    .input(z.object({
      configs: z.array(z.object({
        storeName: z.string(),
        marketplace: z.string(),
        accountId: z.number(),
      })),
      intervalMinutes: z.number().min(30).max(1440).default(60),
    }))
    .mutation(async ({ input }) => {
      startAutoSync(input.configs, input.intervalMinutes * 60 * 1000);
      return {
        success: true,
        message: `Auto-sync started for ${input.configs.length} accounts, interval=${input.intervalMinutes}min`,
      };
    }),

  // 停止自动同步
  stopAutoSync: protectedProcedure
    .mutation(async () => {
      stopAutoSync();
      return { success: true, message: 'Auto-sync stopped' };
    }),

  // 获取自动同步状态
  getAutoSyncStatus: protectedProcedure
    .query(async () => {
      return getAutoSyncStatus();
    }),

  // Bridge API 健康检查
  healthCheck: protectedProcedure
    .query(async () => {
      try {
        const bridgeUrl = process.env.PPCOPT_BRIDGE_URL || 'https://www.ppcopt.com/api/bridge/v1';
        const adminSecret = process.env.PPCOPT_BRIDGE_ADMIN_SECRET || 'ppcopt-bridge-admin-2026';
        
        const resp = await fetch(`${bridgeUrl}/health`, {
          headers: { 'x-admin-secret': adminSecret },
        });

        if (!resp.ok) {
          return { connected: false, error: `HTTP ${resp.status}` };
        }

        const data = await resp.json() as any;
        return {
          connected: true,
          bridgeVersion: data.bridgeVersion,
          systemVersion: data.systemVersion,
          dbAvailable: data.dbAvailable,
          capabilities: data.capabilities,
        };
      } catch (err: any) {
        return { connected: false, error: err.message };
      }
    }),
});
