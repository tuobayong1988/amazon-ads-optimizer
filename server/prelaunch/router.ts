/**
 * 预发布引擎 tRPC 路由
 * v328: 亚马逊智能预发布引擎 v4.0
 * 
 * 所有接口使用 adminProcedure 保护，仅系统管理员可访问
 */
import { z } from 'zod';
import { router, adminProcedure } from '../_core/trpc';

export const prelaunchRouter = router({

  // ==================== 项目管理 ====================

  /** 获取所有预发布项目（增强版：支持搜索和模块统计） */
  listProjects: adminProcedure
    .input(z.object({
      status: z.enum(['draft', 'running', 'completed', 'archived']).optional(),
      search: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { PrelaunchProjectService } = await import('./services/project');
      const svc = new PrelaunchProjectService();
      return svc.listProjects(ctx.user.id, input?.status, input?.page ?? 1, input?.pageSize ?? 20, input?.search);
    }),

  /** 获取单个项目详情 */
  getProject: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { PrelaunchProjectService } = await import('./services/project');
      const svc = new PrelaunchProjectService();
      return svc.getProject(input.projectId);
    }),

  /** 创建预发布项目 */
  createProject: adminProcedure
    .input(z.object({
      projectName: z.string().min(1),
      asin: z.string().optional(),
      marketplace: z.string().default('US'),
      category: z.string().optional(),
      seedKeywords: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { PrelaunchProjectService } = await import('./services/project');
      const svc = new PrelaunchProjectService();
      return svc.createProject({
        ...input,
        accountId: ctx.user.id,
        createdBy: ctx.user.id,
      });
    }),

  /** 更新项目 */
  updateProject: adminProcedure
    .input(z.object({
      projectId: z.number(),
      projectName: z.string().optional(),
      asin: z.string().optional(),
      marketplace: z.string().optional(),
      category: z.string().optional(),
      seedKeywords: z.array(z.string()).optional(),
      status: z.enum(['draft', 'running', 'completed', 'archived']).optional(),
    }))
    .mutation(async ({ input }: any) => {
      const { PrelaunchProjectService } = await import('./services/project');
      const svc = new PrelaunchProjectService();
      return svc.updateProject(input.projectId, input);
    }),

  /** 删除项目 */
  deleteProject: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input }: any) => {
      const { PrelaunchProjectService } = await import('./services/project');
      const svc = new PrelaunchProjectService();
      return svc.deleteProject(input.projectId);
    }),

  // ==================== M1: 搜索词库引擎 ====================

  /** 获取项目关键词列表 */
  getKeywords: adminProcedure
    .input(z.object({
      projectId: z.number(),
      relevanceLayer: z.enum(['core', 'extended', 'long_tail', 'irrelevant']).optional(),
      scenarioCode: z.string().optional(),
      clusterId: z.number().optional(),
      sortBy: z.enum(['kviScore', 'searchVolume', 'drAmScore']).default('kviScore'),
      page: z.number().default(1),
      pageSize: z.number().default(50),
    }))
    .query(async ({ input }: any) => {
      const { M1KeywordService } = await import('./services/m1-keywords');
      const svc = new M1KeywordService();
      return svc.getKeywords(input);
    }),

  /** 运行M1词库分析流水线 */
  runM1Pipeline: adminProcedure
    .input(z.object({
      projectId: z.number(),
      seedKeywords: z.array(z.string()).min(1),
      marketplace: z.string().default('US'),
    }))
    .mutation(async ({ input }: any) => {
      const { M1KeywordService } = await import('./services/m1-keywords');
      const svc = new M1KeywordService();
      return svc.runPipeline(input.projectId, input.seedKeywords, input.marketplace);
    }),

  /** 获取关键词聚类 */
  getKeywordClusters: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { M1KeywordService } = await import('./services/m1-keywords');
      const svc = new M1KeywordService();
      return svc.getClusters(input.projectId);
    }),

  /** 获取关键词关系图 */
  getKeywordRelations: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { M1KeywordService } = await import('./services/m1-keywords');
      const svc = new M1KeywordService();
      return svc.getRelations(input.projectId);
    }),

  /** 获取COSMO因果链三元组 */
  getCosmoTriples: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { M1KeywordService } = await import('./services/m1-keywords');
      const svc = new M1KeywordService();
      return svc.getCosmoTriples(input.projectId);
    }),

  // ==================== M2: 竞品库引擎 ====================

  /** 获取项目竞品列表 */
  getCompetitors: adminProcedure
    .input(z.object({
      projectId: z.number(),
      tier: z.enum(['T1_head', 'T2_waist', 'T3_niche']).optional(),
      page: z.number().default(1),
      pageSize: z.number().default(30),
    }))
    .query(async ({ input }: any) => {
      const { M2CompetitorService } = await import('./services/m2-competitors');
      const svc = new M2CompetitorService();
      return svc.getCompetitors(input);
    }),

  /** 运行M2竞品分析流水线 */
  runM2Pipeline: adminProcedure
    .input(z.object({
      projectId: z.number(),
      competitorAsins: z.array(z.string()).optional(),
      autoDiscover: z.boolean().default(true),
    }))
    .mutation(async ({ input }: any) => {
      const { M2CompetitorService } = await import('./services/m2-competitors');
      const svc = new M2CompetitorService();
      return svc.runPipeline(input.projectId, input.competitorAsins, input.autoDiscover);
    }),

  /** 获取竞品TRS详情（白盒化） */
  getCompetitorTrsDetail: adminProcedure
    .input(z.object({ competitorId: z.number() }))
    .query(async ({ input }: any) => {
      const { M2CompetitorService } = await import('./services/m2-competitors');
      const svc = new M2CompetitorService();
      return svc.getTrsDetail(input.competitorId);
    }),

  /** 获取竞品场景矩阵 */
  getCompetitorScenarioMatrix: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { M2CompetitorService } = await import('./services/m2-competitors');
      const svc = new M2CompetitorService();
      return svc.getScenarioMatrix(input.projectId);
    }),

  /** 获取竞品用户语言库 */
  getCompetitorUserLanguage: adminProcedure
    .input(z.object({
      projectId: z.number(),
      competitorId: z.number().optional(),
    }))
    .query(async ({ input }: any) => {
      const { M2CompetitorService } = await import('./services/m2-competitors');
      const svc = new M2CompetitorService();
      return svc.getUserLanguage(input.projectId, input.competitorId);
    }),

  // ==================== M3: 用户画像引擎 ====================

  /** 获取项目用户画像 */
  getPersonas: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { M3PersonaService } = await import('./services/m3-persona');
      const svc = new M3PersonaService();
      return svc.getPersonas(input.projectId);
    }),

  /** 运行M3用户画像生成 */
  runM3Pipeline: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input }: any) => {
      const { M3PersonaService } = await import('./services/m3-persona');
      const svc = new M3PersonaService();
      return svc.runPipeline(input.projectId);
    }),

  // ==================== M4X: 文案动态进化引擎 ====================

  /** 获取文案版本列表 */
  getCopyVersions: adminProcedure
    .input(z.object({
      projectId: z.number(),
      generation: z.number().optional(),
    }))
    .query(async ({ input }: any) => {
      const { M4XCopyService } = await import('./services/m4x-copy');
      const svc = new M4XCopyService();
      return svc.getCopyVersions(input.projectId, input.generation);
    }),

  /** 运行M4X文案生成（第0代） */
  runM4XGenerate: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input }: any) => {
      const { M4XCopyService } = await import('./services/m4x-copy');
      const svc = new M4XCopyService();
      return svc.generateInitialCopy(input.projectId);
    }),

  /** 触发文案进化（下一代） */
  runM4XEvolve: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input }: any) => {
      const { M4XCopyService } = await import('./services/m4x-copy');
      const svc = new M4XCopyService();
      return svc.evolveNextGeneration(input.projectId);
    }),

  /** 获取Rufus Q&A种子 */
  getQnaSeeds: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { M4XCopyService } = await import('./services/m4x-copy');
      const svc = new M4XCopyService();
      return svc.getQnaSeeds(input.projectId);
    }),

  // ==================== M5: 视觉框架引擎 ====================

  /** 获取视觉框架简报 */
  getVisualBriefs: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { M5VisualService } = await import('./services/m5-visual');
      const svc = new M5VisualService();
      return svc.getVisualBriefs(input.projectId);
    }),

  /** 运行M5视觉框架生成 */
  runM5Pipeline: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input }: any) => {
      const { M5VisualService } = await import('./services/m5-visual');
      const svc = new M5VisualService();
      return svc.runPipeline(input.projectId);
    }),

  /** 生成产品图片（AIGC） */
  generateVisualImage: adminProcedure
    .input(z.object({
      projectId: z.number(),
      briefId: z.number(),
    }))
    .mutation(async ({ input }: any) => {
      const { M5VisualService } = await import('./services/m5-visual');
      const svc = new M5VisualService();
      return svc.generateImage(input.projectId, input.briefId);
    }),

  // ==================== M6: 视频素材创意引擎 ====================

  /** 获取视频脚本列表 */
  getVideoScripts: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { M6VideoService } = await import('./services/m6-video');
      const svc = new M6VideoService();
      return svc.getVideoScripts(input.projectId);
    }),

  /** 运行M6视频创意生成 */
  runM6Pipeline: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input }: any) => {
      const { M6VideoService } = await import('./services/m6-video');
      const svc = new M6VideoService();
      return svc.runPipeline(input.projectId);
    }),

  /** 生成视频分镜图（AIGC） */
  generateStoryboardFrames: adminProcedure
    .input(z.object({
      projectId: z.number(),
      scriptId: z.number(),
    }))
    .mutation(async ({ input }: any) => {
      const { M6VideoService } = await import('./services/m6-video');
      const svc = new M6VideoService();
      return svc.generateStoryboardFrames(input.projectId, input.scriptId);
    }),

  /** 获取Banner创意列表 */
  getBannerCreatives: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { M6VideoService } = await import('./services/m6-video');
      const svc = new M6VideoService();
      return svc.getBannerCreatives(input.projectId);
    }),

  /** 生成SB广告Banner图（AIGC） */
  generateBannerImage: adminProcedure
    .input(z.object({
      projectId: z.number(),
      bannerId: z.number(),
    }))
    .mutation(async ({ input }: any) => {
      const { M6VideoService } = await import('./services/m6-video');
      const svc = new M6VideoService();
      return svc.generateBannerImage(input.projectId, input.bannerId);
    }),

  // ==================== M7: 广告框架引擎 ====================

  /** 获取广告框架列表 */
  getAdFrameworks: adminProcedure
    .input(z.object({
      projectId: z.number(),
      frameworkType: z.string().optional(),
    }))
    .query(async ({ input }: any) => {
      const { M7AdFrameworkService } = await import('./services/m7-ad-framework');
      const svc = new M7AdFrameworkService();
      return svc.getAdFrameworks(input.projectId, input.frameworkType);
    }),

  /** 编译广告框架（生成完整的广告活动结构） */
  compileAdFramework: adminProcedure
    .input(z.object({
      projectId: z.number(),
      frameworkTypes: z.array(z.enum([
        'SP_KW_MANUAL',
        'SP_PT_MANUAL',
        'SP_AUTO',
        'SBV_KW',
        'SBV_PT',
      ])).min(1),
      defaultBid: z.number().default(0.75),
      dailyBudget: z.number().default(30),
    }))
    .mutation(async ({ input }: any) => {
      const { M7AdFrameworkService } = await import('./services/m7-ad-framework');
      const svc = new M7AdFrameworkService();
      return svc.compileFrameworks(input);
    }),

  /** 预览广告框架（JSON预览，不部署） */
  previewAdPayload: adminProcedure
    .input(z.object({ frameworkId: z.number() }))
    .query(async ({ input }: any) => {
      const { M7AdFrameworkService } = await import('./services/m7-ad-framework');
      const svc = new M7AdFrameworkService();
      return svc.previewPayload(input.frameworkId);
    }),

  /** 一键部署广告框架到Amazon */
  deployAdFramework: adminProcedure
    .input(z.object({
      frameworkId: z.number(),
      profileId: z.string(),
      dryRun: z.boolean().default(false),
    }))
    .mutation(async ({ input }: any) => {
      const { M7AdFrameworkService } = await import('./services/m7-ad-framework');
      const svc = new M7AdFrameworkService();
      return svc.deployToAmazon(input.frameworkId, input.profileId, input.dryRun);
    }),

  /** 获取部署日志 */
  getDeployLogs: adminProcedure
    .input(z.object({ frameworkId: z.number() }))
    .query(async ({ input }: any) => {
      const { M7AdFrameworkService } = await import('./services/m7-ad-framework');
      const svc = new M7AdFrameworkService();
      return svc.getDeployLogs(input.frameworkId);
    }),

  // ==================== 全流程一键运行 ====================

  /** 运行完整的预发布流水线（M1→M2→M3→M4X→M5→M6→M7） */
  runFullPipeline: adminProcedure
    .input(z.object({
      projectId: z.number(),
      seedKeywords: z.array(z.string()).min(1),
      marketplace: z.string().default('US'),
      skipModules: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }: any) => {
      const { PrelaunchPipelineOrchestrator } = await import('./services/pipeline');
      const orchestrator = new PrelaunchPipelineOrchestrator();
      return orchestrator.runFullPipeline(input);
    }),

  /** 获取流水线运行状态 */
  getPipelineStatus: adminProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }: any) => {
      const { PrelaunchPipelineOrchestrator } = await import('./services/pipeline');
      const orchestrator = new PrelaunchPipelineOrchestrator();
      return orchestrator.getStatus(input.projectId);
    }),

  // ==================== 仪表盘概览 ====================

  /** 获取预发布引擎仪表盘数据 */
  getDashboard: adminProcedure
    .input(z.object({ projectId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const { PrelaunchDashboardService } = await import('./services/dashboard');
      const svc = new PrelaunchDashboardService();
      return svc.getDashboard(ctx.user.id, input?.projectId);
    }),
});
