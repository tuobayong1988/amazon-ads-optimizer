/**
 * 主路由入口 - 组合所有子路由模块
 * 
 * 所有路由定义已按功能域拆分到 routes/ 目录下的独立文件中。
 * 本文件仅负责导入和组合这些子路由，以及定义 auth 路由。
 */
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";

// ==================== 子路由导入 ====================

// 核心业务路由
import { adAccountRouter } from './routes/adAccount';
import { performanceGroupRouter } from './routes/performanceGroup';
import { campaignRouter } from './routes/campaign';
import { adGroupRouter } from './routes/adGroup';
import { keywordRouter, productTargetRouter } from './routes/keyword';
import { biddingLogRouter } from './routes/bidding';

// 分析与报表路由
import { analyticsRouter, advancedAnalyticsRouter } from './routes/analytics';

// 优化管理路由
import { optimizationRouter, unifiedOptimizationRouter } from './routes/optimization';
import { placementRouter } from './routes/placement';
import { daypartingRouter } from './routes/dayparting';

// Amazon API与数据同步路由
import { amazonApiRouter } from './routes/amazonApi';
import { dataSyncRouter, reportJobsRouter } from './routes/dataSync';
import { dailySyncRouter } from './routes/dailySync';

// 自动化路由
import { adAutomationRouter } from './routes/adAutomation';
import { automationRouter, autoOperationRouter } from './routes/automation';

// 预算管理路由
import { budgetAllocationRouter, budgetAlertRouter, budgetTrackingRouter, seasonalBudgetRouter, intelligentBudgetAllocationRouter, budgetAutoExecutionRouter } from './routes/budget';

// 纠错与回滚路由
import { correctionRouter, autoCorrectionRouter, autoRollbackRouter, postDeployRouter } from './routes/correction';

// 算法优化路由
import { algorithmOptimizationRouter, algorithmEffectRouter, algorithmEvolutionRouter, holidayConfigRouter } from './routes/algorithm';
import { abTestRouter } from './routes/abTest';
import { nextGenRouter } from './routes/nextGen';

// 通知与协作路由
import { notificationRouter, collaborationRouter } from './routes/notification';

// 团队与权限路由
import { teamRouter, emailReportRouter, inviteCodeRouter } from './routes/team';
import { userRouter } from './routes/user';

// 其他路由
import { schedulerRouter } from './routes/scheduler';
import { batchOperationRouter } from './routes/batchOperation';
import { crossAccountRouter } from './routes/crossAccount';
import { auditRouter } from './routes/audit';
import { importRouter } from './routes/import';
import { exchangeRateRouter } from './routes/exchangeRate';
import { apiSecurityRouter } from './routes/apiSecurity';
import { specialScenarioRouter } from './routes/specialScenario';
import { systemLogRouter } from './routes/systemLog';

// 已独立的子路由
import { reviewRouter } from './reviewRouter';
import { mlOptimizationRouter } from './routes/mlOptimization';
import { smartCampaignRouter } from './routes/smartCampaign';
import { multiTenantRouter } from './routes/multiTenant';
import { debugSyncRouter } from './_debug/debug-sync';
import { devRouter } from './routes/dev';
import { monitoringRouter } from './routes/monitoring';
import { intelligentRecommendationRouter } from './routes/intelligentRecommendation';
import { systemConfigRouter } from './routes/systemConfig'; // v272 P0-1
import { dataHealthRouter } from './routes/dataHealth'; // v359 P3-2
import { guardrailConfigRouter } from './routes/guardrailConfig'; // v359 P3-3

// 预发布引擎路由 v328 (仅admin可见)
import { prelaunchRouter } from './prelaunch/router';

// ==================== 主路由组合 ====================

export const appRouter = router({
  // 开发与系统路由
  dev: devRouter,
  system: systemRouter,
  debugSync: debugSyncRouter,

  // 认证路由
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }: unknown) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    // 本地用户注册（需要邀请码）
    localRegister: publicProcedure
      .input(z.object({
        inviteCode: z.string().min(1, '邀请码不能为空'),
        username: z.string().min(3, '用户名至少3个字符').max(50),
        password: z.string().min(6, '密码至少6个字符'),
        name: z.string().min(1, '姓名不能为空'),
        email: z.string().email().optional(),
        organizationName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { registerWithInviteCode } = await import('./system/localAuthService');
        const ipAddress = ctx.req.headers['x-forwarded-for'] as string || ctx.req.socket.remoteAddress;
        const userAgent = ctx.req.headers['user-agent'];
        return registerWithInviteCode(input, ipAddress, userAgent);
      }),
    // 本地用户登录
    localLogin: publicProcedure
      .input(z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const { loginLocalUser } = await import('./system/localAuthService');
        const ipAddress = ctx.req.headers['x-forwarded-for'] as string || ctx.req.socket.remoteAddress;
        const userAgent = ctx.req.headers['user-agent'];
        return loginLocalUser(input, ipAddress, userAgent);
      }),
    // 验证Token
    verifyToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }: unknown) => {
        const { verifyToken } = await import('./system/localAuthService');
        return verifyToken(input.token);
      }),
    // 修改密码
    changePassword: protectedProcedure
      .input(z.object({
        oldPassword: z.string().min(1),
        newPassword: z.string().min(6),
      }))
      .mutation(async ({ ctx, input }) => {
        const { changePassword } = await import('./system/localAuthService');
        return changePassword(ctx.user.id, input.oldPassword, input.newPassword);
      }),
  }),

  // 核心业务路由
  adAccount: adAccountRouter,
  performanceGroup: performanceGroupRouter,
  campaign: campaignRouter,
  adGroup: adGroupRouter,
  keyword: keywordRouter,
  productTarget: productTargetRouter,
  biddingLog: biddingLogRouter,

  // 分析与报表
  analytics: analyticsRouter,
  advancedAnalytics: advancedAnalyticsRouter,

  // 优化管理
  optimization: optimizationRouter,
  unifiedOptimization: unifiedOptimizationRouter,
  placement: placementRouter,
  dayparting: daypartingRouter,

  // Amazon API与数据同步
  amazonApi: amazonApiRouter,
  dataSync: dataSyncRouter,
  reportJobs: reportJobsRouter,
  dailySync: dailySyncRouter,

  // 自动化
  adAutomation: adAutomationRouter,
  automation: automationRouter,
  autoOperation: autoOperationRouter,

  // 预算管理
  budgetAllocation: budgetAllocationRouter,
  budgetAlert: budgetAlertRouter,
  budgetTracking: budgetTrackingRouter,
  seasonalBudget: seasonalBudgetRouter,
  intelligentBudgetAllocation: intelligentBudgetAllocationRouter,
  budgetAutoExecution: budgetAutoExecutionRouter,

  // 纠错与回滚
  correction: correctionRouter,
  autoCorrection: autoCorrectionRouter,
  autoRollback: autoRollbackRouter,
  postDeploy: postDeployRouter,

  // 算法优化
  algorithmOptimization: algorithmOptimizationRouter,
  algorithmEffect: algorithmEffectRouter,
  algorithmEvolution: algorithmEvolutionRouter,
  holidayConfig: holidayConfigRouter,
  abTest: abTestRouter,
  nextGen: nextGenRouter,

  // 通知与协作
  notification: notificationRouter,
  collaboration: collaborationRouter,

  // 团队与权限
  team: teamRouter,
  emailReport: emailReportRouter,
  inviteCode: inviteCodeRouter,
  user: userRouter,
  review: reviewRouter,

  // 其他
  scheduler: schedulerRouter,
  batchOperation: batchOperationRouter,
  crossAccount: crossAccountRouter,
  audit: auditRouter,
  import: importRouter,
  exchangeRate: exchangeRateRouter,
  apiSecurity: apiSecurityRouter,
  specialScenario: specialScenarioRouter,
  systemLog: systemLogRouter,
  mlOptimization: mlOptimizationRouter,
  smartCampaign: smartCampaignRouter,
  multiTenant: multiTenantRouter,
  monitoring: monitoringRouter,

  // 智能运营推荐 v269.4
  intelligentRecommendation: intelligentRecommendationRouter,
  // v272 P0-1: 系统配置、算法可观测性、权重自学习
  systemConfig: systemConfigRouter,

  // v359: 数据健康仪表盘
  dataHealth: dataHealthRouter,
  // v359: 安全护栏动态配置
  guardrailConfig: guardrailConfigRouter,

  // v328: 亚马逊智能预发布引擎 v4.0 (仅admin可访问)
  prelaunch: prelaunchRouter,
});

export type AppRouter = typeof appRouter;
