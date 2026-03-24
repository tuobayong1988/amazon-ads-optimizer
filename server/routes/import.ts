/**
 * 导入路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";


// ==================== Import Router ====================
export const importRouter = router({
  // @ts-ignore
  list: protectedProcedure.query(async ({ ctx }: unknown) => {
    return db.getImportJobsByUserId(ctx.user.id);
  }),
  
  create: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      fileUrl: z.string().optional(),
      fileType: z.enum(["csv", "excel"]),
      reportType: z.string().optional(),
      accountId: z.number().optional(),
    }))
    // @ts-ignore
    .mutation(async ({ ctx, input }) => {
      // @ts-ignore
      const id = await db.createImportJob({
        userId: ctx.user.id,
        ...input,
      });
      return { id };
    }),
  
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "processing", "completed", "failed"]),
      processedRows: z.number().optional(),
      totalRows: z.number().optional(),
      // @ts-ignore
      errorMessage: z.string().optional(),
    }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      const { id, ...data } = input;
      await db.updateImportJob(id, {
        ...data,
        completedAt: data.status === "completed" || data.status === "failed" ? new Date().toISOString() : undefined,
      });
      return { success: true };
    }),
});
