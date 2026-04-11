// Extracted from production dist/index.js
// Original module: server/routes/exchangeRate.ts
// Lines: 25

var exchangeRateRouter;
var init_exchangeRate = __esm({
  "server/routes/exchangeRate.ts"() {
    "use strict";
    init_trpc();
    init_exchangeRateService();
    exchangeRateRouter = router({
      // 获取当前汇率状态
      getStatus: protectedProcedure.query(async () => {
        return getExchangeRateStatus();
      }),
      // 获取所有汇率
      getRates: protectedProcedure.query(async () => {
        const rates = await getExchangeRates();
        const status = getExchangeRateStatus();
        return { rates, ...status };
      }),
      // 手动刷新汇率
      refresh: protectedProcedure.mutation(async () => {
        return refreshExchangeRates();
      })
    });
  }
});

