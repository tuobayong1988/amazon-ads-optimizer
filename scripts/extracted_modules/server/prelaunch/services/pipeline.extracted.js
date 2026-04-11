// Extracted from production dist/index.js
// Original module: server/prelaunch/services/pipeline.ts
// Lines: 151

var pipeline_exports = {};
__export(pipeline_exports, {
  PrelaunchPipelineOrchestrator: () => PrelaunchPipelineOrchestrator
});
var log202, pipelineStatuses, PrelaunchPipelineOrchestrator;
var init_pipeline = __esm({
  "server/prelaunch/services/pipeline.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_logger();
    log202 = createModuleLogger("Pipeline");
    pipelineStatuses = /* @__PURE__ */ new Map();
    PrelaunchPipelineOrchestrator = class {
      static {
        __name(this, "PrelaunchPipelineOrchestrator");
      }
      async runFullPipeline(input) {
        const { projectId, seedKeywords, marketplace, skipModules = [] } = input;
        const status = {
          projectId,
          currentModule: "M1",
          progress: 0,
          modules: {
            M1: { status: "pending" },
            M2: { status: "pending" },
            M3: { status: "pending" },
            M4X: { status: "pending" },
            M5: { status: "pending" },
            M6: { status: "pending" },
            M7: { status: "pending" }
          }
        };
        pipelineStatuses.set(projectId, status);
        this.executePipeline(input, status).catch((err) => {
          status.currentModule = "ERROR";
          log202.warn("Pipeline execution error:", err);
        });
        return {
          success: true,
          message: "Pipeline started. Use getPipelineStatus to monitor progress.",
          projectId
        };
      }
      async getStatus(projectId) {
        const status = pipelineStatuses.get(projectId);
        if (!status) {
          return { success: false, error: "No pipeline running for this project" };
        }
        return { success: true, data: status };
      }
      async executePipeline(input, status) {
        const { projectId, seedKeywords, marketplace, skipModules = [] } = input;
        const db = await getDb();
        const modules = [
          {
            name: "M1",
            run: /* @__PURE__ */ __name(async () => {
              const { M1KeywordService: M1KeywordService2 } = await Promise.resolve().then(() => (init_m1_keywords(), m1_keywords_exports));
              return new M1KeywordService2().runPipeline(projectId, seedKeywords, marketplace);
            }, "run")
          },
          {
            name: "M2",
            run: /* @__PURE__ */ __name(async () => {
              const { M2CompetitorService: M2CompetitorService2 } = await Promise.resolve().then(() => (init_m2_competitors(), m2_competitors_exports));
              return new M2CompetitorService2().runPipeline(projectId, void 0, true);
            }, "run")
          },
          {
            name: "M3",
            run: /* @__PURE__ */ __name(async () => {
              const { M3PersonaService: M3PersonaService2 } = await Promise.resolve().then(() => (init_m3_persona(), m3_persona_exports));
              return new M3PersonaService2().runPipeline(projectId);
            }, "run")
          },
          {
            name: "M4X",
            run: /* @__PURE__ */ __name(async () => {
              const { M4XCopyService: M4XCopyService2 } = await Promise.resolve().then(() => (init_m4x_copy(), m4x_copy_exports));
              return new M4XCopyService2().generateInitialCopy(projectId);
            }, "run")
          },
          {
            name: "M5",
            run: /* @__PURE__ */ __name(async () => {
              const { M5VisualService: M5VisualService2 } = await Promise.resolve().then(() => (init_m5_visual(), m5_visual_exports));
              return new M5VisualService2().runPipeline(projectId);
            }, "run")
          },
          {
            name: "M6",
            run: /* @__PURE__ */ __name(async () => {
              const { M6VideoService: M6VideoService2 } = await Promise.resolve().then(() => (init_m6_video(), m6_video_exports));
              return new M6VideoService2().runPipeline(projectId);
            }, "run")
          },
          {
            name: "M7",
            run: /* @__PURE__ */ __name(async () => {
              const { M7AdFrameworkService: M7AdFrameworkService2 } = await Promise.resolve().then(() => (init_m7_ad_framework(), m7_ad_framework_exports));
              return new M7AdFrameworkService2().compileFrameworks({
                projectId,
                frameworkTypes: ["SP_KW_MANUAL", "SP_PT_MANUAL", "SP_AUTO", "SBV_KW", "SBV_PT"],
                defaultBid: 0.75,
                dailyBudget: 30
              });
            }, "run")
          }
        ];
        let completedCount = 0;
        for (const mod of modules) {
          if (skipModules.includes(mod.name)) {
            status.modules[mod.name] = { status: "skipped" };
            completedCount++;
            status.progress = Math.round(completedCount / modules.length * 100);
            continue;
          }
          try {
            status.currentModule = mod.name;
            status.modules[mod.name] = { status: "running", startedAt: (/* @__PURE__ */ new Date()).toISOString() };
            const result = await mod.run();
            status.modules[mod.name] = {
              status: result.success ? "completed" : "failed",
              startedAt: status.modules[mod.name].startedAt,
              completedAt: (/* @__PURE__ */ new Date()).toISOString(),
              // @ts-ignore
              error: result.success ? void 0 : result.error
            };
          } catch (error48) {
            status.modules[mod.name] = {
              status: "failed",
              startedAt: status.modules[mod.name].startedAt,
              completedAt: (/* @__PURE__ */ new Date()).toISOString(),
              error: error48.message
            };
          }
          completedCount++;
          status.progress = Math.round(completedCount / modules.length * 100);
        }
        status.currentModule = "COMPLETED";
        status.progress = 100;
        if (db) {
          await db.update(prelaunchProjects).set({ status: "completed" }).where(eq(prelaunchProjects.id, projectId));
        }
      }
    };
  }
});

