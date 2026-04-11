// Extracted from production dist/index.js
// Original module: server/routes/import.ts
// Lines: 44

var importRouter;
var init_import = __esm({
  "server/routes/import.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_db2();
    importRouter = router({
      // @ts-ignore
      list: protectedProcedure.query(async ({ ctx }) => {
        return getImportJobsByUserId(ctx.user.id);
      }),
      create: protectedProcedure.input(external_exports.object({
        fileName: external_exports.string(),
        fileUrl: external_exports.string().optional(),
        fileType: external_exports.enum(["csv", "excel"]),
        reportType: external_exports.string().optional(),
        accountId: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        const id = await createImportJob({
          userId: ctx.user.id,
          ...input
        });
        return { id };
      }),
      updateStatus: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        status: external_exports.enum(["pending", "processing", "completed", "failed"]),
        processedRows: external_exports.number().optional(),
        totalRows: external_exports.number().optional(),
        // @ts-ignore
        errorMessage: external_exports.string().optional()
      })).mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateImportJob(id, {
          ...data,
          completedAt: data.status === "completed" || data.status === "failed" ? (/* @__PURE__ */ new Date()).toISOString() : void 0
        });
        return { success: true };
      })
    });
  }
});

