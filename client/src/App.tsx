import { Toaster } from "@/components/ui/sonner";
import { Toaster as HotToaster } from "react-hot-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import PerformanceGroups from "./pages/PerformanceGroups";
import PerformanceGroupDetail from "./pages/PerformanceGroupDetail";
import Campaigns from "./pages/Campaigns";
import BiddingLogs from "./pages/BiddingLogs";
import Settings from "./pages/Settings";
// DataImport已移除，改为使用API自动同步
import AmazonApiSettings from "./pages/AmazonApiSettings";
import AdAutomation from "./pages/AdAutomation";
import HealthMonitor from "./pages/HealthMonitor";
import NotificationSettings from "./pages/NotificationSettings";
import Scheduler from "./pages/Scheduler";
import BatchOperations from "./pages/BatchOperations";
import CorrectionReview from "./pages/CorrectionReview";
import AccountsSummary from "./pages/AccountsSummary";
import TeamManagement from "./pages/TeamManagement";
import EmailReports from "@/pages/EmailReports";
import AuditLogs from "@/pages/AuditLogs";
import CollaborationNotifications from "@/pages/CollaborationNotifications";
// import BudgetAllocation from "@/pages/BudgetAllocation"; // 已整合到智能预算分配
import BudgetAlerts from "@/pages/BudgetAlerts";
import BudgetTracking from "@/pages/BudgetTracking";
import SeasonalBudget from "@/pages/SeasonalBudget";
import DataSync from "@/pages/DataSync";
import CampaignDetail from "@/pages/CampaignDetail";
import AdGroupDetail from "@/pages/AdGroupDetail";
import DaypartingStrategy from "@/pages/DaypartingStrategy";
import AIOptimizationHistory from "@/pages/AIOptimizationHistory";
import PlacementOptimization from "@/pages/PlacementOptimization";
import AdvancedPlacementOptimization from "@/pages/AdvancedPlacementOptimization";
import OptimizationCenter from "@/pages/OptimizationCenter";
import BidAdjustmentHistory from "@/pages/BidAdjustmentHistory";
import EffectTrackingReport from "@/pages/EffectTrackingReport";
import AutoRollbackSettings from "@/pages/AutoRollbackSettings";
import AlgorithmOptimization from "@/pages/AlgorithmOptimization";
import IntelligentBudgetAllocation from "@/pages/IntelligentBudgetAllocation";
import ABTest from "@/pages/ABTest";
import BudgetAutoExecution from "@/pages/BudgetAutoExecution";
import OptimizationTargets from "@/pages/OptimizationTargets";
import ApiSecurityCenter from "@/pages/ApiSecurityCenter";
import SpecialScenarioAnalysis from "@/pages/SpecialScenarioAnalysis";
import AutomationControl from "@/pages/AutomationControl";
import AutoOperation from "@/pages/AutoOperation";
import MonitoringCenter from "@/pages/MonitoringCenter";
import AnalyticsInsights from "@/pages/AnalyticsInsights";
import StrategyCenter from "@/pages/StrategyCenter";
import OptimizationEngine from "@/pages/OptimizationEngine";
import SmartOptimizationCenter from "@/pages/SmartOptimizationCenter";
import SyncLogs from "@/pages/SyncLogs";
import DataValidation from "@/pages/DataValidation";
import InviteRegister from "@/pages/InviteRegister";
import AlgorithmEffectDashboard from "@/pages/AlgorithmEffectDashboard";
import InviteCodeManagement from "@/pages/InviteCodeManagement";
import LocalLogin from "@/pages/LocalLogin";
import Blog from "@/pages/Blog";
import BlogPost from "@/pages/BlogPost";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      {/* 登录后的主界面统一为根路径 */}
      <Route path="/dashboard">{() => { window.location.href = '/'; return null; }}</Route>
      <Route path="/monitoring-center">{() => { window.location.href = '/'; return null; }}</Route>
      <Route path="/analytics-insights" component={AnalyticsInsights} />
      <Route path="/strategy-center" component={StrategyCenter} />
      <Route path="/optimization-engine" component={SmartOptimizationCenter} />
      {/* 旧的优化引擎页面重定向到智能优化中心 */}
      <Route path="/smart-optimization" component={SmartOptimizationCenter} />
      <Route path="/optimization-targets" component={OptimizationTargets} />
      <Route path="/optimization-targets/:id" component={PerformanceGroupDetail} />
      <Route path="/performance-groups" component={PerformanceGroups} />
      <Route path="/performance-groups/:id" component={PerformanceGroupDetail} />
      <Route path="/campaigns" component={Campaigns} />
      <Route path="/campaigns/:id" component={CampaignDetail} />
      <Route path="/campaigns/:id/ai-history" component={AIOptimizationHistory} />
      <Route path="/ad-groups/:id" component={AdGroupDetail} />
      <Route path="/bidding-logs" component={BiddingLogs} />
      <Route path="/settings" component={Settings} />
      {/* 功能整合重定向 - 极简化设计 */}
      <Route path="/import">{() => { window.location.href = '/amazon-api'; return null; }}</Route>
      <Route path="/scheduler">{() => { window.location.href = '/dashboard'; return null; }}</Route>
      <Route path="/data-sync">{() => { window.location.href = '/amazon-api'; return null; }}</Route>
      <Route path="/amazon-api" component={AmazonApiSettings} />
      <Route path="/sync-logs" component={SyncLogs} />
      <Route path="/data-validation" component={DataValidation} />
      <Route path="/automation" component={AdAutomation} />
      <Route path="/health" component={HealthMonitor} />
      <Route path="/notifications" component={NotificationSettings} />
      {/* /scheduler已重定向到/dashboard */}
      <Route path="/batch-operations" component={BatchOperations} />
      <Route path="/correction-review" component={CorrectionReview} />
      <Route path="/accounts-summary" component={AccountsSummary} />
      <Route path="/team" component={TeamManagement} />
      <Route path="/email-reports" component={EmailReports} />
      <Route path="/audit-logs" component={AuditLogs} />
      <Route path="/collaboration" component={CollaborationNotifications} />
      {/* <Route path="/budget-allocation" component={BudgetAllocation} /> */}
      {/* 旧版预算分配已整合到智能预算分配，访问 /budget-allocation 将重定向到 /intelligent-budget */}
      <Route path="/budget-allocation">{() => { window.location.href = '/optimization-center'; return null; }}</Route>
      <Route path="/budget-alerts" component={BudgetAlerts} />
      <Route path="/budget-tracking" component={BudgetTracking} />
      <Route path="/seasonal-budget" component={SeasonalBudget} />
      {/* /data-sync已重定向到/amazon-api */}
      <Route path="/dayparting" component={DaypartingStrategy} />
      <Route path="/placement-optimization" component={PlacementOptimization} />
      <Route path="/advanced-placement" component={AdvancedPlacementOptimization} />
      <Route path="/optimization-center" component={OptimizationCenter} />
      <Route path="/bid-adjustment-history" component={BidAdjustmentHistory} />
      <Route path="/effect-tracking-report" component={EffectTrackingReport} />
      <Route path="/algorithm-effect-dashboard" component={AlgorithmEffectDashboard} />
      {/* 智能优化功能已整合到优化设置和优化中心 */}
      <Route path="/auto-rollback">{() => { window.location.href = '/settings'; return null; }}</Route>
      <Route path="/algorithm-optimization">{() => { window.location.href = '/settings'; return null; }}</Route>
      <Route path="/intelligent-budget">{() => { window.location.href = '/optimization-center'; return null; }}</Route>
      <Route path="/ab-test" component={ABTest} />
      <Route path="/budget-auto-execution">{() => { window.location.href = '/settings'; return null; }}</Route>
      <Route path="/api-security" component={ApiSecurityCenter} />
      <Route path="/special-scenario" component={SpecialScenarioAnalysis} />
      {/* 自动化控制和自动运营已整合到智能优化中心 */}
      <Route path="/automation-control">{() => { window.location.href = '/optimization-engine'; return null; }}</Route>
      <Route path="/auto-operation">{() => { window.location.href = '/optimization-engine'; return null; }}</Route>
      <Route path="/register" component={InviteRegister} />
      <Route path="/local-login" component={LocalLogin} />
      <Route path="/blog" component={Blog} />
      <Route path="/blog/:slug" component={BlogPost} />
      <Route path="/invite-codes" component={InviteCodeManagement} />
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
