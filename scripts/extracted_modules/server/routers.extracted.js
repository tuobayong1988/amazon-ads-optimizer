// Extracted from production dist/index.js
// Original module: server/routers.ts
// Lines: 212

var appRouter;
var init_routers = __esm({
  "server/routers.ts"() {
    "use strict";
    init_const();
    init_cookies();
    init_systemRouter();
    init_trpc();
    init_zod();
    init_adAccount();
    init_performanceGroup();
    init_campaign();
    init_adGroup();
    init_keyword();
    init_bidding();
    init_analytics2();
    init_optimization();
    init_placement();
    init_dayparting();
    init_amazonApi();
    init_dataSync();
    init_dailySync();
    init_adAutomation2();
    init_automation();
    init_budget();
    init_correction();
    init_algorithm();
    init_abTest();
    init_nextGen();
    init_notification2();
    init_team2();
    init_user();
    init_scheduler();
    init_batchOperation();
    init_crossAccount();
    init_audit();
    init_import();
    init_exchangeRate();
    init_apiSecurity();
    init_specialScenario();
    init_systemLog();
    init_reviewRouter();
    init_mlOptimization();
    init_smartCampaign();
    init_multiTenant();
    init_debug_sync();
    init_dev();
    init_monitoring();
    init_intelligentRecommendation();
    init_dashboardRecommendation();
    init_systemConfig();
    init_dataHealth();
    init_guardrailConfig();
    init_stopLoss();
    init_systemDefense();
    init_router();
    appRouter = router({
      // 开发与系统路由
      dev: devRouter,
      system: systemRouter,
      debugSync: debugSyncRouter,
      // 认证路由
      auth: router({
        me: publicProcedure.query((opts) => opts.ctx.user),
        // @ts-ignore
        logout: publicProcedure.mutation(({ ctx }) => {
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
          return { success: true };
        }),
        // 本地用户注册（需要邀请码）
        localRegister: publicProcedure.input(external_exports.object({
          inviteCode: external_exports.string().min(1, "\u9080\u8BF7\u7801\u4E0D\u80FD\u4E3A\u7A7A"),
          username: external_exports.string().min(3, "\u7528\u6237\u540D\u81F3\u5C113\u4E2A\u5B57\u7B26").max(50),
          password: external_exports.string().min(6, "\u5BC6\u7801\u81F3\u5C116\u4E2A\u5B57\u7B26"),
          name: external_exports.string().min(1, "\u59D3\u540D\u4E0D\u80FD\u4E3A\u7A7A"),
          email: external_exports.string().email().optional(),
          organizationName: external_exports.string().optional()
        })).mutation(async ({ ctx, input }) => {
          const { registerWithInviteCode: registerWithInviteCode2 } = await Promise.resolve().then(() => (init_localAuthService(), localAuthService_exports));
          const ipAddress = ctx.req.headers["x-forwarded-for"] || ctx.req.socket.remoteAddress;
          const userAgent = ctx.req.headers["user-agent"];
          return registerWithInviteCode2(input, ipAddress, userAgent);
        }),
        // 本地用户登录
        localLogin: publicProcedure.input(external_exports.object({
          username: external_exports.string().min(1),
          password: external_exports.string().min(1)
        })).mutation(async ({ ctx, input }) => {
          const { loginLocalUser: loginLocalUser2 } = await Promise.resolve().then(() => (init_localAuthService(), localAuthService_exports));
          const ipAddress = ctx.req.headers["x-forwarded-for"] || ctx.req.socket.remoteAddress;
          const userAgent = ctx.req.headers["user-agent"];
          return loginLocalUser2(input, ipAddress, userAgent);
        }),
        // 验证Token
        verifyToken: publicProcedure.input(external_exports.object({ token: external_exports.string() })).query(async ({ input }) => {
          const { verifyToken: verifyToken2 } = await Promise.resolve().then(() => (init_localAuthService(), localAuthService_exports));
          return verifyToken2(input.token);
        }),
        // 修改密码
        changePassword: protectedProcedure.input(external_exports.object({
          oldPassword: external_exports.string().min(1),
          newPassword: external_exports.string().min(6)
        })).mutation(async ({ ctx, input }) => {
          const { changePassword: changePassword2 } = await Promise.resolve().then(() => (init_localAuthService(), localAuthService_exports));
          return changePassword2(ctx.user.id, input.oldPassword, input.newPassword);
        }),
        // v483: 更新个人信息
        updateProfile: protectedProcedure.input(external_exports.object({
          username: external_exports.string().min(3).max(50).optional(),
          name: external_exports.string().min(1).optional(),
          email: external_exports.string().email().optional().or(external_exports.literal(""))
        })).mutation(async ({ ctx, input }) => {
          const { updateProfile: updateProfile2 } = await Promise.resolve().then(() => (init_localAuthService(), localAuthService_exports));
          return updateProfile2(ctx.user.id, input);
        })
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
      // v501: 数据概览智能建议（紧急止血、高ACOS抑制、优化目标调整）
      dashboardRecommendation: dashboardRecommendationRouter,
      // v272 P0-1: 系统配置、算法可观测性、权重自学习
      systemConfig: systemConfigRouter,
      // v359: 数据健康仪表盘
      dataHealth: dataHealthRouter,
      // v359: 安全护栏动态配置
      guardrailConfig: guardrailConfigRouter,
      // v503: 自动止血服务
      stopLoss: stopLossRouter,
      systemDefense: systemDefenseRouter,
      // v504
      // v328: 亚马逊智能预发布引擎 v4.0 (仅admin可访问)
      prelaunch: prelaunchRouter,
      // v620: P1-P4 Upgrade Routes
      reviewGateway: (() => { try { init_reviewGateway(); return reviewGatewayRouter; } catch(e) { return router({}); } })(),
      impactPredictor: (() => { try { init_impactPredictor(); return impactPredictorRouter; } catch(e) { return router({}); } })(),
      coreKeyword: (() => { try { init_coreKeywordManager(); return coreKeywordRouter; } catch(e) { return router({}); } })(),
      healthSignal: (() => { try { init_healthSignalMonitor(); return healthSignalRouter; } catch(e) { return router({}); } })(),
      syncOrchestrator: (() => { try { init_syncOrchestrator(); return syncOrchestratorRouter; } catch(e) { return router({}); } })(),
      discovery: (() => { try { init_discoveryGovernor(); return discoveryRouter; } catch(e) { return router({}); } })(),
      eventCalendar: (() => { try { init_discoveryGovernor(); return eventCalendarRouter; } catch(e) { return router({}); } })(),
    });
  }
});

