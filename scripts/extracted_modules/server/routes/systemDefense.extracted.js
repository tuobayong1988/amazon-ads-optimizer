// Extracted from production dist/index.js
// Original module: server/routes/systemDefense.ts
// Lines: 48

var systemDefenseRouter;
var init_systemDefense = __esm({
  "server/routes/systemDefense.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    init_systemDefenseService();
    systemDefenseRouter = router({
      /** 手动触发系统防线全量扫描 */
      triggerFullScan: protectedProcedure.mutation(async () => {
        const result = await runSystemDefenseScan();
        return result;
      }),
      /** 手动触发单个模块扫描 */
      triggerModuleScan: protectedProcedure.input(external_exports.object({
        module: external_exports.enum(["sync_cleanup", "algorithm_circuit_breaker", "death_spiral_intervention", "real_emergency_optimization"])
      })).mutation(async ({ input }) => {
        switch (input.module) {
          case "sync_cleanup":
            return await cleanupSyncFailures();
          case "algorithm_circuit_breaker":
            return await checkAlgorithmHealth();
          case "death_spiral_intervention":
            return await detectAndIntervenDeathSpiral();
          case "real_emergency_optimization":
            return await executeRealEmergencyOptimization();
          default:
            throw new Error(`Unknown module: ${input.module}`);
        }
      }),
      /** 查看算法熔断状态 */
      getAlgorithmStatus: protectedProcedure.input(external_exports.object({
        algorithm: external_exports.string()
      })).query(async ({ input }) => {
        const isBroken = await isAlgorithmCircuitBroken(input.algorithm);
        return { algorithm: input.algorithm, circuitBroken: isBroken };
      }),
      /** 查看账户加价禁止状态 */
      getAccountBidBlockStatus: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number()
      })).query(async ({ input }) => {
        const status = await isAccountBidIncreaseBlocked(input.accountId);
        return { accountId: input.accountId, ...status };
      })
    });
  }
});

