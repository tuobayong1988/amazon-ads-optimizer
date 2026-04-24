/**
 * v732.4: 资金异常预警管理API
 * 
 * 提供管理员接口：
 * 1. 查看所有当前熔断状态
 * 2. 手动解除熔断
 * 3. 查看历史告警记录
 * 4. 手动触发花费异常巡检
 * 5. 查看/修改预警配置
 */
import { z } from 'zod';
import { router, adminProcedure, protectedProcedure } from '../_core/trpc';
import {
  getAllCircuitBreakerStates,
  resetCircuitBreaker,
  getAccountAlertHistory,
  runSpendAnomalyCheck,
  isAccountCircuitBroken,
  ANOMALY_CONFIG,
} from '../services/spendAnomalyDetector';

export const spendAnomalyRouter = router({
  /**
   * 获取所有当前熔断状态（管理员）
   */
  getCircuitBreakerStates: adminProcedure
    // @ts-expect-error Complex function parameter types
    .query(async () => {
      const states = getAllCircuitBreakerStates();
      return {
        success: true,
        data: states.map(s => ({
          accountId: s.accountId,
          triggeredAt: s.triggeredAt.toISOString(),
          reason: s.reason,
          severity: s.severity,
          details: s.details,
        })),
        totalBroken: states.length,
      };
    }),

  /**
   * 检查单个账户的熔断状态
   */
  checkAccountStatus: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ input }) => {
      const state = isAccountCircuitBroken(input.accountId);
      return {
        success: true,
        accountId: input.accountId,
        circuitBroken: state.broken,
        reason: state.reason || null,
        triggeredAt: state.triggeredAt?.toISOString() || null,
      };
    }),

  /**
   * 手动解除账户熔断（管理员）
   */
  resetCircuitBreaker: adminProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }) => {
      const result = await resetCircuitBreaker(input.accountId, ctx.user.id);
      return {
        success: result,
        message: result
          ? `账户${input.accountId}的熔断已由管理员(${ctx.user.id})手动解除`
          : `账户${input.accountId}当前没有处于熔断状态`,
      };
    }),

  /**
   * 查看账户历史告警记录
   */
  getAlertHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().optional().default(50),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ input }) => {
      const history = await getAccountAlertHistory(input.accountId, input.limit);
      return {
        success: true,
        data: history,
        total: history.length,
      };
    }),

  /**
   * 手动触发花费异常巡检（管理员）
   */
  runManualCheck: adminProcedure
    // @ts-expect-error Complex function parameter types
    .mutation(async () => {
      const result = await runSpendAnomalyCheck();
      return {
        success: true,
        ...result,
      };
    }),

  /**
   * 获取当前预警配置
   */
  getConfig: protectedProcedure
    // @ts-expect-error Complex function parameter types
    .query(async () => {
      return {
        success: true,
        config: ANOMALY_CONFIG,
      };
    }),
});
