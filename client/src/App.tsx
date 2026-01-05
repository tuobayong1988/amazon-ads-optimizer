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
import DataImport from "./pages/DataImport";
import AmazonApiSettings from "./pages/AmazonApiSettings";
import AdAutomation from "./pages/AdAutomation";
import HealthMonitor from "./pages/HealthMonitor";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/performance-groups" component={PerformanceGroups} />
      <Route path="/campaigns" component={Campaigns} />
      <Route path="/bidding-logs" component={BiddingLogs} />
      <Route path="/settings" component={Settings} />
      <Route path="/import" component={DataImport} />
      <Route path="/amazon-api" component={AmazonApiSettings} />
      <Route path="/automation" component={AdAutomation} />
      <Route path="/health" component={HealthMonitor} />
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
