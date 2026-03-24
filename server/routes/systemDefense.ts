/**
 * v504: 系统防线服务 tRPC 路由
 * 
 * 提供前端可调用的系统防线API：
 * - 手动触发全量防线扫描
 * - 手动触发单个模块扫描
 * - 查看算法熔断状态
 * - 查看账户加价禁止状态
 * - 手动解除/设置防线状态
 */
import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import {
  runSystemDefenseScan,
  cleanupSyncFailures,
  checkAlgorithmHealth,
  detectAndIntervenDeathSpiral,
  executeRealEmergencyOptimization,
  isAlgorithmCircuitBroken,
  isAccountBidIncreaseBlocked,
} from '../system/systemDefenseService';

export const systemDefenseRouter = router({
  /** 手动触发系统防线全量扫描 */
  triggerFullScan: protectedProcedure
    .mutation(async () => {
      const result = await runSystemDefenseScan();
      return result;
    }),

  /** 手动触发单个模块扫描 */
  triggerModuleScan: protectedProcedure
    .input(z.object({
      module: z.enum(['sync_cleanup', 'algorithm_circuit_breaker', 'death_spiral_intervention', 'real_emergency_optimization']),
    }))
    .mutation(async ({ input }) => {
      switch (input.module) {
        case 'sync_cleanup':
          return await cleanupSyncFailures();
        case 'algorithm_circuit_breaker':
          return await checkAlgorithmHealth();
        case 'death_spiral_intervention':
          return await detectAndIntervenDeathSpiral();
        case 'real_emergency_optimization':
          return await executeRealEmergencyOptimization();
        default:
          throw new Error(`Unknown module: ${input.module}`);
      }
    }),

  /** 查看算法熔断状态 */
  getAlgorithmStatus: protectedProcedure
    .input(z.object({
      algorithm: z.string(),
    }))
    .query(async ({ input }) => {
      const isBroken = await isAlgorithmCircuitBroken(input.algorithm);
      return { algorithm: input.algorithm, circuitBroken: isBroken };
    }),

  /** 查看账户加价禁止状态 */
  getAccountBidBlockStatus: protectedProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .query(async ({ input }) => {
      const status = await isAccountBidIncreaseBlocked(input.accountId);
      return { accountId: input.accountId, ...status };
    }),
});
