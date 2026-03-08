import { Toaster } from "@/components/ui/sonner";
import { Toaster as HotToaster } from "react-hot-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense } from "react";

// 核心页面 - 直接导入（首屏需要）
import Home from "./pages/Home";

// 懒加载页面 - 按使用频率分组
// 高频页面
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const CampaignDetail = lazy(() => import("./pages/CampaignDetail"));
const AnalyticsInsights = lazy(() => import("./pages/AnalyticsInsights"));
const StrategyCenter = lazy(() => import("./pages/StrategyCenter"));

// 中频页面
const PerformanceGroups = lazy(() => import("./pages/PerformanceGroups"));
const PerformanceGroupDetail = lazy(() => import("./pages/PerformanceGroupDetail"));
const OptimizationTargets = lazy(() => import("./pages/OptimizationTargets"));
const Settings = lazy(() => import("./pages/Settings"));
const AmazonApiSettings = lazy(() => import("./pages/AmazonApiSettings"));
const AdAutomation = lazy(() => import("./pages/AdAutomation"));
const HealthMonitor = lazy(() => import("./pages/HealthMonitor"));
const OptimizationCenter = lazy(() => import("./pages/OptimizationCenter"));

// 低频页面
const AdGroupDetail = lazy(() => import("./pages/AdGroupDetail"));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings"));
const Scheduler = lazy(() => import("./pages/Scheduler"));
const BatchOperations = lazy(() => import("./pages/BatchOperations"));
const CorrectionReview = lazy(() => import("./pages/CorrectionReview"));
const AccountsSummary = lazy(() => import("./pages/AccountsSummary"));
const TeamManagement = lazy(() => import("./pages/TeamManagement"));
const EmailReports = lazy(() => import("./pages/EmailReports"));
const AuditLogs = lazy(() => import("./pages/AuditLogs"));
const CollaborationNotifications = lazy(() => import("./pages/CollaborationNotifications"));
const BudgetAlerts = lazy(() => import("./pages/BudgetAlerts"));
const BudgetTracking = lazy(() => import("./pages/BudgetTracking"));
const SeasonalBudget = lazy(() => import("./pages/SeasonalBudget"));
const DataSync = lazy(() => import("./pages/DataSync"));
const DaypartingStrategy = lazy(() => import("./pages/DaypartingStrategy"));
const AIOptimizationHistory = lazy(() => import("./pages/AIOptimizationHistory"));
const PlacementOptimization = lazy(() => import("./pages/PlacementOptimization"));
const AdvancedPlacementOptimization = lazy(() => import("./pages/AdvancedPlacementOptimization"));
const AutoRollbackSettings = lazy(() => import("./pages/AutoRollbackSettings"));
const AlgorithmOptimization = lazy(() => import("./pages/AlgorithmOptimization"));
const IntelligentBudgetAllocation = lazy(() => import("./pages/IntelligentBudgetAllocation"));
const ABTest = lazy(() => import("./pages/ABTest"));
const BudgetAutoExecution = lazy(() => import("./pages/BudgetAutoExecution"));
const ApiSecurityCenter = lazy(() => import("./pages/ApiSecurityCenter"));
const SpecialScenarioAnalysis = lazy(() => import("./pages/SpecialScenarioAnalysis"));
const AutomationControl = lazy(() => import("./pages/AutomationControl"));
const AutoOperation = lazy(() => import("./pages/AutoOperation"));
const MonitoringCenter = lazy(() => import("./pages/MonitoringCenter"));
const OptimizationEngine = lazy(() => import("./pages/OptimizationEngine"));
const SyncLogs = lazy(() => import("./pages/SyncLogs"));
const DataValidation = lazy(() => import("./pages/DataValidation"));
const InviteRegister = lazy(() => import("./pages/InviteRegister"));
const AlgorithmEffectDashboard = lazy(() => import("./pages/AlgorithmEffectDashboard"));
const InviteCodeManagement = lazy(() => import("./pages/InviteCodeManagement"));
const LocalLogin = lazy(() => import("./pages/LocalLogin"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const Contact = lazy(() => import("./pages/Contact"));
const SellerOnboarding = lazy(() => import("./pages/SellerOnboarding"));
const BatchAuthorization = lazy(() => import("./pages/BatchAuthorization"));
const HolidayCalendarManagement = lazy(() => import("./pages/HolidayCalendarManagement"));
const AmazonApiAuthStatus = lazy(() => import("./pages/AmazonApiAuthStatus"));
const AutoOptimizationDashboard = lazy(() => import("./pages/AutoOptimizationDashboard"));
const AdvancedAnalyticsDashboard = lazy(() => import("./pages/AdvancedAnalyticsDashboard"));
const AutoCorrectionDashboard = lazy(() => import("./pages/AutoCorrectionDashboard"));
const DataHealthDashboard = lazy(() => import("./pages/DataHealthDashboard")); // v359

// 预发布引擎页面（仅admin可见）
const PrelaunchDashboard = lazy(() => import("./pages/PrelaunchDashboard"));
const PrelaunchM1Keywords = lazy(() => import("./pages/PrelaunchM1Keywords"));
const PrelaunchM2Competitors = lazy(() => import("./pages/PrelaunchM2Competitors"));
const PrelaunchM3Persona = lazy(() => import("./pages/PrelaunchM3Persona"));
const PrelaunchM4XCopy = lazy(() => import("./pages/PrelaunchM4XCopy"));
const PrelaunchM5Visual = lazy(() => import("./pages/PrelaunchM5Visual"));
const PrelaunchM6Video = lazy(() => import("./pages/PrelaunchM6Video"));
const PrelaunchM7AdFramework = lazy(() => import("./pages/PrelaunchM7AdFramework"));

// 加载中组件
function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-gray-400 text-sm">加载中...</p>
      </div>
    </div>
  );
}

// 懒加载包装组件
function LazyRoute({ component: Component }: { component: React.LazyExoticComponent<React.ComponentType<any>> }) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Component />
    </Suspense>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      {/* 登录后的主界面统一为根路径 */}
      <Route path="/dashboard">{() => <Redirect to="/" />}</Route>
      <Route path="/monitoring-center">{() => <Redirect to="/" />}</Route>
      {/* v151: 数据分析已融合到优化目标详情页的"分析洞察"Tab */}
      <Route path="/analytics-insights">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/strategy-center">{() => <LazyRoute component={StrategyCenter} />}</Route>
      {/* v144: 智能优化中心已合并到策略管理 */}
      <Route path="/optimization-engine">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/smart-optimization">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/strategy-management">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/optimization-targets">{() => <LazyRoute component={OptimizationTargets} />}</Route>
      <Route path="/optimization-targets/:id">{() => <LazyRoute component={PerformanceGroupDetail} />}</Route>
      <Route path="/performance-groups">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/performance-groups/:id">{() => <LazyRoute component={PerformanceGroupDetail} />}</Route>
      <Route path="/campaigns">{() => <LazyRoute component={Campaigns} />}</Route>
      <Route path="/campaigns/:id">{() => <LazyRoute component={CampaignDetail} />}</Route>
      <Route path="/campaigns/:id/ai-history">{() => <LazyRoute component={AIOptimizationHistory} />}</Route>
      <Route path="/ad-groups/:id">{() => <LazyRoute component={AdGroupDetail} />}</Route>
      {/* v144: 竞价日志已合并到优化目标详情页的"历史与追踪"Tab */}
      <Route path="/bidding-logs">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/settings">{() => <LazyRoute component={Settings} />}</Route>
      {/* 功能整合重定向 - 极简化设计 */}
      <Route path="/import">{() => <Redirect to="/amazon-api" />}</Route>
      <Route path="/scheduler">{() => <Redirect to="/" />}</Route>
      <Route path="/data-sync">{() => <Redirect to="/amazon-api" />}</Route>
      <Route path="/amazon-api">{() => <LazyRoute component={AmazonApiSettings} />}</Route>
      <Route path="/sync-logs">{() => <LazyRoute component={SyncLogs} />}</Route>
      <Route path="/data-validation">{() => <LazyRoute component={DataValidation} />}</Route>
      <Route path="/automation">{() => <LazyRoute component={AdAutomation} />}</Route>
      <Route path="/health">{() => <LazyRoute component={HealthMonitor} />}</Route>
      <Route path="/data-health">{() => <LazyRoute component={DataHealthDashboard} />}</Route>
      <Route path="/notifications">{() => <LazyRoute component={NotificationSettings} />}</Route>
      {/* /scheduler已重定向到/dashboard */}
      <Route path="/batch-operations">{() => <LazyRoute component={BatchOperations} />}</Route>
      <Route path="/correction-review">{() => <LazyRoute component={CorrectionReview} />}</Route>
      <Route path="/accounts-summary">{() => <LazyRoute component={AccountsSummary} />}</Route>
      <Route path="/team">{() => <LazyRoute component={TeamManagement} />}</Route>
      <Route path="/email-reports">{() => <LazyRoute component={EmailReports} />}</Route>
      <Route path="/audit-logs">{() => <LazyRoute component={AuditLogs} />}</Route>
      <Route path="/collaboration">{() => <LazyRoute component={CollaborationNotifications} />}</Route>
      {/* 旧版预算分配已整合到智能预算分配，访问 /budget-allocation 将重定向到 /optimization-center */}
      <Route path="/budget-allocation">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/budget-alerts">{() => <LazyRoute component={BudgetAlerts} />}</Route>
      <Route path="/budget-tracking">{() => <LazyRoute component={BudgetTracking} />}</Route>
      <Route path="/seasonal-budget">{() => <LazyRoute component={SeasonalBudget} />}</Route>
      {/* /data-sync已重定向到/amazon-api */}
      <Route path="/dayparting">{() => <LazyRoute component={DaypartingStrategy} />}</Route>
      <Route path="/placement-optimization">{() => <LazyRoute component={PlacementOptimization} />}</Route>
      <Route path="/advanced-placement">{() => <LazyRoute component={AdvancedPlacementOptimization} />}</Route>
      {/* v144: 边际效益分析已合并到策略管理 */}
      <Route path="/marginal-benefit-analysis">{() => <Redirect to="/strategy-center" />}</Route>
      {/* v151: 优化中心已融合到策略管理 */}
      <Route path="/optimization-center">{() => <Redirect to="/strategy-center" />}</Route>
      {/* v144: 出价调整历史已合并到优化目标详情页的"历史与追踪"Tab */}
      <Route path="/bid-adjustment-history">{() => <Redirect to="/strategy-center" />}</Route>
      {/* v144: 效果追踪报告已合并到优化目标详情页的"历史与追踪"Tab */}
      <Route path="/effect-tracking-report">{() => <Redirect to="/strategy-center" />}</Route>
      {/* v151: 算法效果已融合到优化目标详情页的"算法效果"Tab */}
      <Route path="/algorithm-effect-dashboard">{() => <Redirect to="/strategy-center" />}</Route>
      {/* 智能优化功能已整合到优化设置和优化中心 */}
      <Route path="/auto-rollback">{() => <Redirect to="/settings" />}</Route>
      <Route path="/algorithm-optimization">{() => <Redirect to="/settings" />}</Route>
      <Route path="/intelligent-budget">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/ab-test">{() => <LazyRoute component={ABTest} />}</Route>
      <Route path="/budget-auto-execution">{() => <Redirect to="/settings" />}</Route>
      <Route path="/api-security">{() => <LazyRoute component={ApiSecurityCenter} />}</Route>
      <Route path="/special-scenario">{() => <LazyRoute component={SpecialScenarioAnalysis} />}</Route>
      {/* 自动化控制和自动运营已整合到智能优化中心 */}
      <Route path="/automation-control">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/auto-operation">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/onboarding">{() => <LazyRoute component={SellerOnboarding} />}</Route>
      <Route path="/seller-onboarding">{() => <LazyRoute component={SellerOnboarding} />}</Route>
      <Route path="/batch-authorization">{() => <LazyRoute component={BatchAuthorization} />}</Route>
      <Route path="/holiday-calendar">{() => <LazyRoute component={HolidayCalendarManagement} />}</Route>
      <Route path="/amazon-api-auth-status">{() => <LazyRoute component={AmazonApiAuthStatus} />}</Route>
      <Route path="/auto-optimization-dashboard">{() => <LazyRoute component={AutoOptimizationDashboard} />}</Route>
      <Route path="/auto-correction">{() => <LazyRoute component={AutoCorrectionDashboard} />}</Route>
      {/* 预发布引擎（仅admin可见，前端路由可访问，后端由adminProcedure保护） */}
      <Route path="/prelaunch">{() => <LazyRoute component={PrelaunchDashboard} />}</Route>
      <Route path="/prelaunch/m1-keywords">{() => <LazyRoute component={PrelaunchM1Keywords} />}</Route>
      <Route path="/prelaunch/m2-competitors">{() => <LazyRoute component={PrelaunchM2Competitors} />}</Route>
      <Route path="/prelaunch/m3-persona">{() => <LazyRoute component={PrelaunchM3Persona} />}</Route>
      <Route path="/prelaunch/m4x-copy">{() => <LazyRoute component={PrelaunchM4XCopy} />}</Route>
      <Route path="/prelaunch/m5-visual">{() => <LazyRoute component={PrelaunchM5Visual} />}</Route>
      <Route path="/prelaunch/m6-video">{() => <LazyRoute component={PrelaunchM6Video} />}</Route>
      <Route path="/prelaunch/m7-ads">{() => <LazyRoute component={PrelaunchM7AdFramework} />}</Route>
      {/* v151: 高级分析已融合到优化目标详情页的"分析洞察"Tab */}
      <Route path="/advanced-analytics">{() => <Redirect to="/strategy-center" />}</Route>
      <Route path="/register">{() => <LazyRoute component={InviteRegister} />}</Route>
      <Route path="/login">{() => <LazyRoute component={LocalLogin} />}</Route>
      <Route path="/local-login">{() => <LazyRoute component={LocalLogin} />}</Route>
      <Route path="/landing">{() => <LazyRoute component={LandingPage} />}</Route>
      <Route path="/how-it-works">{() => <LazyRoute component={HowItWorks} />}</Route>
      <Route path="/contact">{() => <LazyRoute component={Contact} />}</Route>
      <Route path="/blog">{() => <LazyRoute component={Blog} />}</Route>
      <Route path="/blog/:slug">{() => <LazyRoute component={BlogPost} />}</Route>
      <Route path="/invite-codes">{() => <LazyRoute component={InviteCodeManagement} />}</Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <HotToaster position="top-right" toastOptions={{ duration: 3000, style: { background: '#1f2937', color: '#fff', border: '1px solid #374151' } }} />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
