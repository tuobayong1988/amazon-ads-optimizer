import { Toaster } from "@/components/ui/sonner";
import { Toaster as HotToaster } from "react-hot-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
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
const SmartOptimizationCenter = lazy(() => import("./pages/SmartOptimizationCenter"));

// 中频页面
const PerformanceGroups = lazy(() => import("./pages/PerformanceGroups"));
const PerformanceGroupDetail = lazy(() => import("./pages/PerformanceGroupDetail"));
const OptimizationTargets = lazy(() => import("./pages/OptimizationTargets"));
const BiddingLogs = lazy(() => import("./pages/BiddingLogs"));
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
const BidAdjustmentHistory = lazy(() => import("./pages/BidAdjustmentHistory"));
const EffectTrackingReport = lazy(() => import("./pages/EffectTrackingReport"));
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
const MarginalBenefitAnalysis = lazy(() => import("./pages/MarginalBenefitAnalysis"));
const SellerOnboarding = lazy(() => import("./pages/SellerOnboarding"));
const BatchAuthorization = lazy(() => import("./pages/BatchAuthorization"));

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
      <Route path="/dashboard">{() => { window.location.href = '/'; return null; }}</Route>
      <Route path="/monitoring-center">{() => { window.location.href = '/'; return null; }}</Route>
      <Route path="/analytics-insights">{() => <LazyRoute component={AnalyticsInsights} />}</Route>
      <Route path="/strategy-center">{() => <LazyRoute component={StrategyCenter} />}</Route>
      <Route path="/optimization-engine">{() => <LazyRoute component={SmartOptimizationCenter} />}</Route>
      {/* 旧的优化引擎页面重定向到智能优化中心 */}
      <Route path="/smart-optimization">{() => <LazyRoute component={SmartOptimizationCenter} />}</Route>
      <Route path="/optimization-targets">{() => <LazyRoute component={OptimizationTargets} />}</Route>
      <Route path="/optimization-targets/:id">{() => <LazyRoute component={PerformanceGroupDetail} />}</Route>
      <Route path="/performance-groups">{() => <LazyRoute component={PerformanceGroups} />}</Route>
      <Route path="/performance-groups/:id">{() => <LazyRoute component={PerformanceGroupDetail} />}</Route>
      <Route path="/campaigns">{() => <LazyRoute component={Campaigns} />}</Route>
      <Route path="/campaigns/:id">{() => <LazyRoute component={CampaignDetail} />}</Route>
      <Route path="/campaigns/:id/ai-history">{() => <LazyRoute component={AIOptimizationHistory} />}</Route>
      <Route path="/ad-groups/:id">{() => <LazyRoute component={AdGroupDetail} />}</Route>
      <Route path="/bidding-logs">{() => <LazyRoute component={BiddingLogs} />}</Route>
      <Route path="/settings">{() => <LazyRoute component={Settings} />}</Route>
      {/* 功能整合重定向 - 极简化设计 */}
      <Route path="/import">{() => { window.location.href = '/amazon-api'; return null; }}</Route>
      <Route path="/scheduler">{() => { window.location.href = '/dashboard'; return null; }}</Route>
      <Route path="/data-sync">{() => { window.location.href = '/amazon-api'; return null; }}</Route>
      <Route path="/amazon-api">{() => <LazyRoute component={AmazonApiSettings} />}</Route>
      <Route path="/sync-logs">{() => <LazyRoute component={SyncLogs} />}</Route>
      <Route path="/data-validation">{() => <LazyRoute component={DataValidation} />}</Route>
      <Route path="/automation">{() => <LazyRoute component={AdAutomation} />}</Route>
      <Route path="/health">{() => <LazyRoute component={HealthMonitor} />}</Route>
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
      <Route path="/budget-allocation">{() => { window.location.href = '/optimization-center'; return null; }}</Route>
      <Route path="/budget-alerts">{() => <LazyRoute component={BudgetAlerts} />}</Route>
      <Route path="/budget-tracking">{() => <LazyRoute component={BudgetTracking} />}</Route>
      <Route path="/seasonal-budget">{() => <LazyRoute component={SeasonalBudget} />}</Route>
      {/* /data-sync已重定向到/amazon-api */}
      <Route path="/dayparting">{() => <LazyRoute component={DaypartingStrategy} />}</Route>
      <Route path="/placement-optimization">{() => <LazyRoute component={PlacementOptimization} />}</Route>
      <Route path="/advanced-placement">{() => <LazyRoute component={AdvancedPlacementOptimization} />}</Route>
      <Route path="/marginal-benefit-analysis">{() => <LazyRoute component={MarginalBenefitAnalysis} />}</Route>
      <Route path="/optimization-center">{() => <LazyRoute component={OptimizationCenter} />}</Route>
      <Route path="/bid-adjustment-history">{() => <LazyRoute component={BidAdjustmentHistory} />}</Route>
      <Route path="/effect-tracking-report">{() => <LazyRoute component={EffectTrackingReport} />}</Route>
      <Route path="/algorithm-effect-dashboard">{() => <LazyRoute component={AlgorithmEffectDashboard} />}</Route>
      {/* 智能优化功能已整合到优化设置和优化中心 */}
      <Route path="/auto-rollback">{() => { window.location.href = '/settings'; return null; }}</Route>
      <Route path="/algorithm-optimization">{() => { window.location.href = '/settings'; return null; }}</Route>
      <Route path="/intelligent-budget">{() => { window.location.href = '/optimization-center'; return null; }}</Route>
      <Route path="/ab-test">{() => <LazyRoute component={ABTest} />}</Route>
      <Route path="/budget-auto-execution">{() => { window.location.href = '/settings'; return null; }}</Route>
      <Route path="/api-security">{() => <LazyRoute component={ApiSecurityCenter} />}</Route>
      <Route path="/special-scenario">{() => <LazyRoute component={SpecialScenarioAnalysis} />}</Route>
      {/* 自动化控制和自动运营已整合到智能优化中心 */}
      <Route path="/automation-control">{() => { window.location.href = '/optimization-engine'; return null; }}</Route>
      <Route path="/auto-operation">{() => { window.location.href = '/optimization-engine'; return null; }}</Route>
      <Route path="/onboarding">{() => <LazyRoute component={SellerOnboarding} />}</Route>
      <Route path="/seller-onboarding">{() => <LazyRoute component={SellerOnboarding} />}</Route>
      <Route path="/batch-authorization">{() => <LazyRoute component={BatchAuthorization} />}</Route>
      <Route path="/register">{() => <LazyRoute component={InviteRegister} />}</Route>
      <Route path="/local-login">{() => <LazyRoute component={LocalLogin} />}</Route>
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
