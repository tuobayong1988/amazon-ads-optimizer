import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import PerformanceGroups from "./pages/PerformanceGroups";
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/performance-groups" component={PerformanceGroups} />
      <Route path="/campaigns" component={Campaigns} />
      <Route path="/campaigns/:id" component={CampaignDetail} />
      <Route path="/campaigns/:id/ai-history" component={AIOptimizationHistory} />
      <Route path="/bidding-logs" component={BiddingLogs} />
      <Route path="/settings" component={Settings} />
      {/* /import路由已移除，用户应使用/data-sync进行API同步 */}
      <Route path="/import">{() => { window.location.href = '/data-sync'; return null; }}</Route>
      <Route path="/amazon-api" component={AmazonApiSettings} />
      <Route path="/automation" component={AdAutomation} />
      <Route path="/health" component={HealthMonitor} />
      <Route path="/notifications" component={NotificationSettings} />
      <Route path="/scheduler" component={Scheduler} />
      <Route path="/batch-operations" component={BatchOperations} />
      <Route path="/correction-review" component={CorrectionReview} />
      <Route path="/accounts-summary" component={AccountsSummary} />
      <Route path="/team" component={TeamManagement} />
      <Route path="/email-reports" component={EmailReports} />
      <Route path="/audit-logs" component={AuditLogs} />
      <Route path="/collaboration" component={CollaborationNotifications} />
      {/* <Route path="/budget-allocation" component={BudgetAllocation} /> */}
      {/* 旧版预算分配已整合到智能预算分配，访问 /budget-allocation 将重定向到 /intelligent-budget */}
      <Route path="/budget-allocation">{() => { window.location.href = '/intelligent-budget'; return null; }}</Route>
      <Route path="/budget-alerts" component={BudgetAlerts} />
      <Route path="/budget-tracking" component={BudgetTracking} />
      <Route path="/seasonal-budget" component={SeasonalBudget} />
      <Route path="/data-sync" component={DataSync} />
      <Route path="/dayparting" component={DaypartingStrategy} />
      <Route path="/placement-optimization" component={PlacementOptimization} />
      <Route path="/advanced-placement" component={AdvancedPlacementOptimization} />
      <Route path="/optimization-center" component={OptimizationCenter} />
      <Route path="/bid-adjustment-history" component={BidAdjustmentHistory} />
      <Route path="/effect-tracking-report" component={EffectTrackingReport} />
      <Route path="/auto-rollback" component={AutoRollbackSettings} />
      <Route path="/algorithm-optimization" component={AlgorithmOptimization} />
      <Route path="/intelligent-budget" component={IntelligentBudgetAllocation} />
      <Route path="/ab-test" component={ABTest} />
      <Route path="/budget-auto-execution" component={BudgetAutoExecution} />
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
