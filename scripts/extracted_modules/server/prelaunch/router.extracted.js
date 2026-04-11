// Extracted from production dist/index.js
// Original module: server/prelaunch/router.ts
// Lines: 334

var prelaunchRouter;
var init_router = __esm({
  "server/prelaunch/router.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    prelaunchRouter = router({
      // ==================== 项目管理 ====================
      /** 获取所有预发布项目（增强版：支持搜索和模块统计） */
      listProjects: adminProcedure.input(external_exports.object({
        status: external_exports.enum(["draft", "running", "completed", "archived"]).optional(),
        search: external_exports.string().optional(),
        page: external_exports.number().default(1),
        pageSize: external_exports.number().default(20)
      }).optional()).query(async ({ ctx, input }) => {
        const { PrelaunchProjectService: PrelaunchProjectService2 } = await Promise.resolve().then(() => (init_project(), project_exports));
        const svc = new PrelaunchProjectService2();
        return svc.listProjects(ctx.user.id, input?.status, input?.page ?? 1, input?.pageSize ?? 20, input?.search);
      }),
      /** 获取单个项目详情 */
      getProject: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { PrelaunchProjectService: PrelaunchProjectService2 } = await Promise.resolve().then(() => (init_project(), project_exports));
        const svc = new PrelaunchProjectService2();
        return svc.getProject(input.projectId);
      }),
      /** 创建预发布项目 */
      createProject: adminProcedure.input(external_exports.object({
        projectName: external_exports.string().min(1),
        asin: external_exports.string().optional(),
        marketplace: external_exports.string().default("US"),
        category: external_exports.string().optional(),
        seedKeywords: external_exports.array(external_exports.string()).optional()
      })).mutation(async ({ ctx, input }) => {
        const { PrelaunchProjectService: PrelaunchProjectService2 } = await Promise.resolve().then(() => (init_project(), project_exports));
        const svc = new PrelaunchProjectService2();
        return svc.createProject({
          ...input,
          accountId: ctx.user.id,
          createdBy: ctx.user.id
        });
      }),
      /** 更新项目 */
      updateProject: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        projectName: external_exports.string().optional(),
        asin: external_exports.string().optional(),
        marketplace: external_exports.string().optional(),
        category: external_exports.string().optional(),
        seedKeywords: external_exports.array(external_exports.string()).optional(),
        status: external_exports.enum(["draft", "running", "completed", "archived"]).optional()
        // @ts-ignore
      })).mutation(async ({ input }) => {
        const { PrelaunchProjectService: PrelaunchProjectService2 } = await Promise.resolve().then(() => (init_project(), project_exports));
        const svc = new PrelaunchProjectService2();
        return svc.updateProject(input.projectId, input);
      }),
      /** 删除项目 */
      // @ts-ignore
      deleteProject: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).mutation(async ({ input }) => {
        const { PrelaunchProjectService: PrelaunchProjectService2 } = await Promise.resolve().then(() => (init_project(), project_exports));
        const svc = new PrelaunchProjectService2();
        return svc.deleteProject(input.projectId);
      }),
      // ==================== M1: 搜索词库引擎 ====================
      /** 获取项目关键词列表 */
      getKeywords: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        relevanceLayer: external_exports.enum(["core", "extended", "long_tail", "irrelevant"]).optional(),
        scenarioCode: external_exports.string().optional(),
        clusterId: external_exports.number().optional(),
        sortBy: external_exports.enum(["kviScore", "searchVolume", "drAmScore"]).default("kviScore"),
        // @ts-ignore
        page: external_exports.number().default(1),
        pageSize: external_exports.number().default(50)
      })).query(async ({ input }) => {
        const { M1KeywordService: M1KeywordService2 } = await Promise.resolve().then(() => (init_m1_keywords(), m1_keywords_exports));
        const svc = new M1KeywordService2();
        return svc.getKeywords(input);
      }),
      /** 运行M1词库分析流水线 */
      runM1Pipeline: adminProcedure.input(external_exports.object({
        // @ts-ignore
        projectId: external_exports.number(),
        seedKeywords: external_exports.array(external_exports.string()).min(1),
        marketplace: external_exports.string().default("US")
      })).mutation(async ({ input }) => {
        const { M1KeywordService: M1KeywordService2 } = await Promise.resolve().then(() => (init_m1_keywords(), m1_keywords_exports));
        const svc = new M1KeywordService2();
        return svc.runPipeline(input.projectId, input.seedKeywords, input.marketplace);
      }),
      /** 获取关键词聚类 */
      getKeywordClusters: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { M1KeywordService: M1KeywordService2 } = await Promise.resolve().then(() => (init_m1_keywords(), m1_keywords_exports));
        const svc = new M1KeywordService2();
        return svc.getClusters(input.projectId);
      }),
      /** 获取关键词关系图 */
      getKeywordRelations: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { M1KeywordService: M1KeywordService2 } = await Promise.resolve().then(() => (init_m1_keywords(), m1_keywords_exports));
        const svc = new M1KeywordService2();
        return svc.getRelations(input.projectId);
      }),
      /** 获取COSMO因果链三元组 */
      getCosmoTriples: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { M1KeywordService: M1KeywordService2 } = await Promise.resolve().then(() => (init_m1_keywords(), m1_keywords_exports));
        const svc = new M1KeywordService2();
        return svc.getCosmoTriples(input.projectId);
      }),
      // ==================== M2: 竞品库引擎 ====================
      /** 获取项目竞品列表 */
      getCompetitors: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        tier: external_exports.enum(["T1_head", "T2_waist", "T3_niche"]).optional(),
        page: external_exports.number().default(1),
        pageSize: external_exports.number().default(30)
      })).query(async ({ input }) => {
        const { M2CompetitorService: M2CompetitorService2 } = await Promise.resolve().then(() => (init_m2_competitors(), m2_competitors_exports));
        const svc = new M2CompetitorService2();
        return svc.getCompetitors(input);
      }),
      /** 运行M2竞品分析流水线 */
      runM2Pipeline: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        competitorAsins: external_exports.array(external_exports.string()).optional(),
        autoDiscover: external_exports.boolean().default(true)
      })).mutation(async ({ input }) => {
        const { M2CompetitorService: M2CompetitorService2 } = await Promise.resolve().then(() => (init_m2_competitors(), m2_competitors_exports));
        const svc = new M2CompetitorService2();
        return svc.runPipeline(input.projectId, input.competitorAsins, input.autoDiscover);
      }),
      /** 获取竞品TRS详情（白盒化） */
      getCompetitorTrsDetail: adminProcedure.input(external_exports.object({ competitorId: external_exports.number() })).query(async ({ input }) => {
        const { M2CompetitorService: M2CompetitorService2 } = await Promise.resolve().then(() => (init_m2_competitors(), m2_competitors_exports));
        const svc = new M2CompetitorService2();
        return svc.getTrsDetail(input.competitorId);
      }),
      /** 获取竞品场景矩阵 */
      getCompetitorScenarioMatrix: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { M2CompetitorService: M2CompetitorService2 } = await Promise.resolve().then(() => (init_m2_competitors(), m2_competitors_exports));
        const svc = new M2CompetitorService2();
        return svc.getScenarioMatrix(input.projectId);
      }),
      /** 获取竞品用户语言库 */
      getCompetitorUserLanguage: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        competitorId: external_exports.number().optional()
        // @ts-ignore
      })).query(async ({ input }) => {
        const { M2CompetitorService: M2CompetitorService2 } = await Promise.resolve().then(() => (init_m2_competitors(), m2_competitors_exports));
        const svc = new M2CompetitorService2();
        return svc.getUserLanguage(input.projectId, input.competitorId);
      }),
      // ==================== M3: 用户画像引擎 ====================
      /** 获取项目用户画像 */
      getPersonas: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { M3PersonaService: M3PersonaService2 } = await Promise.resolve().then(() => (init_m3_persona(), m3_persona_exports));
        const svc = new M3PersonaService2();
        return svc.getPersonas(input.projectId);
      }),
      /** 运行M3用户画像生成 */
      runM3Pipeline: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).mutation(async ({ input }) => {
        const { M3PersonaService: M3PersonaService2 } = await Promise.resolve().then(() => (init_m3_persona(), m3_persona_exports));
        const svc = new M3PersonaService2();
        return svc.runPipeline(input.projectId);
      }),
      // ==================== M4X: 文案动态进化引擎 ====================
      /** 获取文案版本列表 */
      getCopyVersions: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        generation: external_exports.number().optional()
      })).query(async ({ input }) => {
        const { M4XCopyService: M4XCopyService2 } = await Promise.resolve().then(() => (init_m4x_copy(), m4x_copy_exports));
        const svc = new M4XCopyService2();
        return svc.getCopyVersions(input.projectId, input.generation);
      }),
      /** 运行M4X文案生成（第0代） */
      runM4XGenerate: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).mutation(async ({ input }) => {
        const { M4XCopyService: M4XCopyService2 } = await Promise.resolve().then(() => (init_m4x_copy(), m4x_copy_exports));
        const svc = new M4XCopyService2();
        return svc.generateInitialCopy(input.projectId);
      }),
      /** 触发文案进化（下一代） */
      runM4XEvolve: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).mutation(async ({ input }) => {
        const { M4XCopyService: M4XCopyService2 } = await Promise.resolve().then(() => (init_m4x_copy(), m4x_copy_exports));
        const svc = new M4XCopyService2();
        return svc.evolveNextGeneration(input.projectId);
      }),
      /** 获取Rufus Q&A种子 */
      getQnaSeeds: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { M4XCopyService: M4XCopyService2 } = await Promise.resolve().then(() => (init_m4x_copy(), m4x_copy_exports));
        const svc = new M4XCopyService2();
        return svc.getQnaSeeds(input.projectId);
      }),
      // ==================== M5: 视觉框架引擎 ====================
      /** 获取视觉框架简报 */
      getVisualBriefs: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { M5VisualService: M5VisualService2 } = await Promise.resolve().then(() => (init_m5_visual(), m5_visual_exports));
        const svc = new M5VisualService2();
        return svc.getVisualBriefs(input.projectId);
      }),
      /** 运行M5视觉框架生成 */
      runM5Pipeline: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).mutation(async ({ input }) => {
        const { M5VisualService: M5VisualService2 } = await Promise.resolve().then(() => (init_m5_visual(), m5_visual_exports));
        const svc = new M5VisualService2();
        return svc.runPipeline(input.projectId);
      }),
      /** 生成产品图片（AIGC） */
      generateVisualImage: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        briefId: external_exports.number()
        // @ts-ignore
      })).mutation(async ({ input }) => {
        const { M5VisualService: M5VisualService2 } = await Promise.resolve().then(() => (init_m5_visual(), m5_visual_exports));
        const svc = new M5VisualService2();
        return svc.generateImage(input.projectId, input.briefId);
      }),
      // ==================== M6: 视频素材创意引擎 ====================
      /** 获取视频脚本列表 */
      getVideoScripts: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { M6VideoService: M6VideoService2 } = await Promise.resolve().then(() => (init_m6_video(), m6_video_exports));
        const svc = new M6VideoService2();
        return svc.getVideoScripts(input.projectId);
      }),
      /** 运行M6视频创意生成 */
      // @ts-ignore
      runM6Pipeline: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).mutation(async ({ input }) => {
        const { M6VideoService: M6VideoService2 } = await Promise.resolve().then(() => (init_m6_video(), m6_video_exports));
        const svc = new M6VideoService2();
        return svc.runPipeline(input.projectId);
      }),
      /** 生成视频分镜图（AIGC） */
      generateStoryboardFrames: adminProcedure.input(external_exports.object({
        // @ts-ignore
        projectId: external_exports.number(),
        scriptId: external_exports.number()
      })).mutation(async ({ input }) => {
        const { M6VideoService: M6VideoService2 } = await Promise.resolve().then(() => (init_m6_video(), m6_video_exports));
        const svc = new M6VideoService2();
        return svc.generateStoryboardFrames(input.projectId, input.scriptId);
      }),
      /** 获取Banner创意列表 */
      getBannerCreatives: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { M6VideoService: M6VideoService2 } = await Promise.resolve().then(() => (init_m6_video(), m6_video_exports));
        const svc = new M6VideoService2();
        return svc.getBannerCreatives(input.projectId);
      }),
      /** 生成SB广告Banner图（AIGC） */
      generateBannerImage: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        bannerId: external_exports.number()
      })).mutation(async ({ input }) => {
        const { M6VideoService: M6VideoService2 } = await Promise.resolve().then(() => (init_m6_video(), m6_video_exports));
        const svc = new M6VideoService2();
        return svc.generateBannerImage(input.projectId, input.bannerId);
      }),
      // ==================== M7: 广告框架引擎 ====================
      /** 获取广告框架列表 */
      getAdFrameworks: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        frameworkType: external_exports.string().optional()
      })).query(async ({ input }) => {
        const { M7AdFrameworkService: M7AdFrameworkService2 } = await Promise.resolve().then(() => (init_m7_ad_framework(), m7_ad_framework_exports));
        const svc = new M7AdFrameworkService2();
        return svc.getAdFrameworks(input.projectId, input.frameworkType);
      }),
      /** 编译广告框架（生成完整的广告活动结构） */
      compileAdFramework: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        frameworkTypes: external_exports.array(external_exports.enum([
          "SP_KW_MANUAL",
          "SP_PT_MANUAL",
          "SP_AUTO",
          // @ts-ignore
          "SBV_KW",
          "SBV_PT"
        ])).min(1),
        defaultBid: external_exports.number().default(0.75),
        dailyBudget: external_exports.number().default(30)
      })).mutation(async ({ input }) => {
        const { M7AdFrameworkService: M7AdFrameworkService2 } = await Promise.resolve().then(() => (init_m7_ad_framework(), m7_ad_framework_exports));
        const svc = new M7AdFrameworkService2();
        return svc.compileFrameworks(input);
      }),
      /** 预览广告框架（JSON预览，不部署） */
      previewAdPayload: adminProcedure.input(external_exports.object({ frameworkId: external_exports.number() })).query(async ({ input }) => {
        const { M7AdFrameworkService: M7AdFrameworkService2 } = await Promise.resolve().then(() => (init_m7_ad_framework(), m7_ad_framework_exports));
        const svc = new M7AdFrameworkService2();
        return svc.previewPayload(input.frameworkId);
      }),
      /** 一键部署广告框架到Amazon */
      deployAdFramework: adminProcedure.input(external_exports.object({
        frameworkId: external_exports.number(),
        profileId: external_exports.string(),
        dryRun: external_exports.boolean().default(false)
      })).mutation(async ({ input }) => {
        const { M7AdFrameworkService: M7AdFrameworkService2 } = await Promise.resolve().then(() => (init_m7_ad_framework(), m7_ad_framework_exports));
        const svc = new M7AdFrameworkService2();
        return svc.deployToAmazon(input.frameworkId, input.profileId, input.dryRun);
      }),
      /** 获取部署日志 */
      getDeployLogs: adminProcedure.input(external_exports.object({ frameworkId: external_exports.number() })).query(async ({ input }) => {
        const { M7AdFrameworkService: M7AdFrameworkService2 } = await Promise.resolve().then(() => (init_m7_ad_framework(), m7_ad_framework_exports));
        const svc = new M7AdFrameworkService2();
        return svc.getDeployLogs(input.frameworkId);
      }),
      // ==================== 全流程一键运行 ====================
      /** 运行完整的预发布流水线（M1→M2→M3→M4X→M5→M6→M7） */
      runFullPipeline: adminProcedure.input(external_exports.object({
        projectId: external_exports.number(),
        seedKeywords: external_exports.array(external_exports.string()).min(1),
        marketplace: external_exports.string().default("US"),
        skipModules: external_exports.array(external_exports.string()).optional()
      })).mutation(async ({ input }) => {
        const { PrelaunchPipelineOrchestrator: PrelaunchPipelineOrchestrator2 } = await Promise.resolve().then(() => (init_pipeline(), pipeline_exports));
        const orchestrator = new PrelaunchPipelineOrchestrator2();
        return orchestrator.runFullPipeline(input);
      }),
      /** 获取流水线运行状态 */
      getPipelineStatus: adminProcedure.input(external_exports.object({ projectId: external_exports.number() })).query(async ({ input }) => {
        const { PrelaunchPipelineOrchestrator: PrelaunchPipelineOrchestrator2 } = await Promise.resolve().then(() => (init_pipeline(), pipeline_exports));
        const orchestrator = new PrelaunchPipelineOrchestrator2();
        return orchestrator.getStatus(input.projectId);
      }),
      // ==================== 仪表盘概览 ====================
      /** 获取预发布引擎仪表盘数据 */
      getDashboard: adminProcedure.input(external_exports.object({ projectId: external_exports.number().optional() })).query(async ({ ctx, input }) => {
        const { PrelaunchDashboardService: PrelaunchDashboardService2 } = await Promise.resolve().then(() => (init_dashboard(), dashboard_exports));
        const svc = new PrelaunchDashboardService2();
        return svc.getDashboard(ctx.user.id, input?.projectId);
      })
    });
  }
});

