/**
 * 汇率路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getExchangeRateStatus, refreshExchangeRates, getExchangeRates } from '../services/exchangeRateService';


// ==================== Exchange Rate Router ====================
export const exchangeRateRouter = router({
  // 获取当前汇率状态
  getStatus: protectedProcedure
    .query(async () => {
      return getExchangeRateStatus();
    }),
  
  // 获取所有汇率
  getRates: protectedProcedure
    .query(async () => {
      const rates = await getExchangeRates();
      const status = getExchangeRateStatus();
      return { rates, ...status };
    }),
  
  // 手动刷新汇率
  refresh: protectedProcedure
    .mutation(async () => {
      return refreshExchangeRates();
    }),
});
