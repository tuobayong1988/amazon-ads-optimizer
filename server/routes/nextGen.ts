/**
 * 下一代算法路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as causalInferenceEngine from '../causalInferenceEngine';
import * as keywordGraphService from '../keywordGraphService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { ensureNextGenTables } from '../nextGenMigration';


export const nextGenRouter = router({
  // 初始化NextGen数据库表（仅在首次部署时使用一次，后续部署自动执行）
  ensureTables: protectedProcedure
    .mutation(async () => {
      return ensureNextGenTables();
    }),

  // 获取NextGen算法系统状态
  getStatus: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return {
        version: 'v198',
        engineMode: 'unified',
        description: 'NextGen统一出价引擎，100%覆盖所有关键词和商品定向',
        algorithmTiers: {
          advanced: ['sigmoid_curve', 'linucb', 'cql', 'ensemble'],
          ruleEngine: ['acos_based', 'exploration', 'protection'],
          conservative: ['hold_current_bid'],
        },
        automatedTasks: {
          maintenance: '每4小时自动执行（特征缓存/Sigmoid拟合/Reward回填/因果分析）',
          modelTraining: '每6小时自动执行（CQL离线强化学习）',
          budgetOptimization: '每日凌晨2:00自动执行（预算组合优化+关键词图谱）',
        },
        status: 'active',
      };
    }),
  
  // 查询因果推断分析结果（只读查询，分析由定时任务自动执行）
  getCausalAnalysis: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return causalInferenceEngine.batchCausalAnalysis(input.accountId);
    }),
  
  // 查询关键词图谱机会（只读查询，图谱由定时任务自动构建）
  getKeywordOpportunities: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const opportunities = await keywordGraphService.discoverOpportunities(input.accountId);
      const negatives = await keywordGraphService.discoverNegativeCandidates(input.accountId);
      return { opportunities, negatives };
    }),
});
