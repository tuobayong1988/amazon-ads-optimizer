/**
 * MonitoringCenter - 监控中心
 * 合并原有的监控仪表盘、健康度监控、预算预警功能
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import OnboardingWizard, { useOnboarding } from "@/components/OnboardingWizard";
import ApiStatusWidget from "@/components/ApiStatusWidget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  ShoppingCart, 
  MousePointer, 
  Eye,
  Target,
  Percent,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  RefreshCw,
  Zap,
  Activity,
  PieChart,
  Clock,
  CheckCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Globe,
  MapPin,
  Bell,
  Settings,
  Shield,
  Wifi,
  WifiOff,
  Database
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import toast from "react-hot-toast";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend,
  BarChart,
  Bar
} from "recharts";

// 全局变量用于存储刷新函数
declare global {
  interface Window {
    refreshDashboardData?: () => void;
    showToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  }
}

// 将toast函数挂载到window上
if (typeof window !== 'undefined') {
  window.showToast = (type: 'success' | 'error' | 'info', message: string) => {
    if (type === 'success') {
      toast.success(message, { duration: 3000 });
    } else if (type === 'error') {
      toast.error(message, { duration: 3000 });
    } else {
      toast(message, { duration: 2000 });
    }
  };
}

// 优化后的KPI卡片组件
function KPICard({ 
  title, 
  value, 
  icon, 
  trend, 
  trendLabel, 
  inverseTrend = false,
  color = "blue"
}: { 
  title: string; 
  value: string; 
  icon: React.ReactNode; 
  trend?: number; 
  trendLabel?: string;
  inverseTrend?: boolean;
  color?: "blue" | "green" | "purple" | "orange" | "cyan";
}) {
  const isPositive = inverseTrend ? (trend || 0) < 0 : (trend || 0) > 0;
  
  const colorClasses = {
    blue: "from-blue-500/20 to-blue-600/5 border-blue-500/30",
    green: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/30",
    purple: "from-purple-500/20 to-purple-600/5 border-purple-500/30",
    orange: "from-orange-500/20 to-orange-600/5 border-orange-500/30",
    cyan: "from-cyan-500/20 to-cyan-600/5 border-cyan-500/30"
  };

  const iconColorClasses = {
    blue: "text-blue-400 bg-blue-500/20",
    green: "text-emerald-400 bg-emerald-500/20",
    purple: "text-purple-400 bg-purple-500/20",
    orange: "text-orange-400 bg-orange-500/20",
    cyan: "text-cyan-400 bg-cyan-500/20"
  };

  return (
    <Card className={`relative overflow-hidden bg-gradient-to-br ${colorClasses[color]} border`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold tracking-tight">{value}</p>
            {trend !== undefined && (
              <div className="flex items-center gap-1.5">
                <span className={`flex items-center text-sm font-medium ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                  {Math.abs(trend)}%
                </span>
                <span className="text-xs text-muted-foreground">{trendLabel}</span>
              </div>
            )}
          </div>
          <div className={`p-3 rounded-xl ${iconColorClasses[color]}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// 时间范围预设选项
type DatePreset = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth' | 'custom';

const getDateRange = (preset: DatePreset): { start: Date; end: Date } => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  
  switch (preset) {
    case 'today':
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return { start: todayStart, end: today };
    case 'yesterday':
      const yesterdayStart = subDays(today, 1);
      yesterdayStart.setHours(0, 0, 0, 0);
      const yesterdayEnd = subDays(today, 1);
      yesterdayEnd.setHours(23, 59, 59, 999);
      return { start: yesterdayStart, end: yesterdayEnd };
    case 'last7days':
      return { start: subDays(today, 7), end: today };
    case 'last30days':
      return { start: subDays(today, 30), end: today };
    case 'thisMonth':
      return { start: startOfMonth(today), end: today };
    case 'lastMonth':
      const lastMonth = subMonths(today, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    default:
      return { start: subDays(today, 30), end: today };
  }
};

// 预警项组件
function AlertItem({ alert, onAcknowledge }: { alert: any; onAcknowledge: (id: number) => void }) {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'border-l-red-500 bg-red-500/10';
      case 'high': return 'border-l-orange-500 bg-orange-500/10';
      case 'warning': return 'border-l-yellow-500 bg-yellow-500/10';
      default: return 'border-l-blue-500 bg-blue-500/10';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <XCircle className="h-5 w-5 text-red-400" />;
      case 'high': return <AlertTriangle className="h-5 w-5 text-orange-400" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-400" />;
      default: return <Bell className="h-5 w-5 text-blue-400" />;
    }
  };

  return (
    <div className={`border-l-4 p-4 rounded-r-lg ${getSeverityColor(alert.severity)}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          {getSeverityIcon(alert.severity)}
          <div>
            <h4 className="font-medium">{alert.title || alert.alertType}</h4>
            <p className="text-sm text-muted-foreground mt-1">{alert.message || alert.description}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {alert.campaignName && `广告活动: ${alert.campaignName} · `}
              {format(new Date(alert.createdAt), 'yyyy-MM-dd HH:mm')}
            </p>
          </div>
        </div>
        {alert.status === 'active' && (
          <Button size="sm" variant="outline" onClick={() => onAcknowledge(alert.id)}>
            确认
          </Button>
        )}
      </div>
    </div>
  );
}

export default function MonitoringCenter() {
  const { user } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // 区域对比时间范围状态
  const [regionDatePreset, setRegionDatePreset] = useState<DatePreset>('last30days');
  
  // 首次登录引导
  const { showOnboarding, completeOnboarding, skipOnboarding, pauseOnboarding, savedProgress } = useOnboarding();

  // Fetch accounts
  const { data: accounts, isLoading: accountsLoading } = trpc.adAccount.list.useQuery();

  // Use first account if none selected
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // Fetch KPIs
  const { data: kpis, isLoading: kpisLoading, refetch: refetchKpis } = trpc.analytics.getKPIs.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取归因调整后的近期数据
  const { data: attributionData } = trpc.specialScenario.getAttributionAdjustedData.useQuery(
    { accountId: accountId!, days: 7 },
    { enabled: !!accountId }
  );

  // 获取健康度分析
  const healthQuery = trpc.adAutomation.analyzeCampaignHealth.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取健康预警列表
  const healthAlertsQuery = trpc.adAutomation.getHealthAlerts.useQuery(
    { accountId: accountId!, severity: 'all' },
    { enabled: !!accountId }
  );

  // 获取预算预警列表
  const budgetAlertsQuery = trpc.budgetAlert.getAlerts.useQuery(
    { accountId: accountId || undefined, limit: 50, offset: 0 },
    { enabled: !!accountId }
  );

  // API连接状态使用简化的mock数据
  const apiStatusQuery = { data: { isConnected: true, tokenExpiresAt: null, lastRefresh: null }, refetch: () => Promise.resolve() };

  // 同步状态使用简化的mock数据
  const syncStatusQuery = { data: { status: 'success', lastSyncAt: new Date().toISOString(), recordsCount: 0 }, refetch: () => Promise.resolve() };

  // 确认预警
  const acknowledgeMutation = trpc.budgetAlert.acknowledgeAlert.useMutation({
    onSuccess: () => {
      toast.success("预警已确认");
      budgetAlertsQuery.refetch();
      healthAlertsQuery.refetch();
    },
  });

  // 计算归因调整后的KPI汇总
  const adjustedKpis = useMemo(() => {
    if (!attributionData || attributionData.length === 0) return null;
    
    const totals = attributionData.reduce((acc, day) => ({
      sales: acc.sales + day.adjusted.sales,
      spend: acc.spend + day.adjusted.spend,
      orders: acc.orders + day.adjusted.orders,
      clicks: acc.clicks + day.adjusted.clicks,
      impressions: acc.impressions + day.adjusted.impressions,
    }), { sales: 0, spend: 0, orders: 0, clicks: 0, impressions: 0 });

    const days = attributionData.length;
    const acos = totals.sales > 0 ? (totals.spend / totals.sales) * 100 : 0;
    const roas = totals.spend > 0 ? totals.sales / totals.spend : 0;

    return {
      totalSales: totals.sales,
      totalSpend: totals.spend,
      totalOrders: totals.orders,
      acos,
      roas,
      conversionsPerDay: totals.orders / days,
      revenuePerDay: totals.sales / days,
      avgAdjustmentFactor: attributionData.reduce((sum, d) => sum + d.adjusted.adjustmentFactor, 0) / days,
      lowConfidenceDays: attributionData.filter(d => d.adjusted.confidence === 'low').length,
    };
  }, [attributionData]);

  // 是否显示归因调整后的数据
  const [showAdjustedData, setShowAdjustedData] = useState(true);

  // 刷新所有数据
  const handleRefreshAll = useCallback(async () => {
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    toast("开始刷新数据...", { icon: "🔄" });
    
    try {
      await Promise.all([
        refetchKpis(),
        healthQuery.refetch(),
        healthAlertsQuery.refetch(),
        budgetAlertsQuery.refetch(),
        apiStatusQuery.refetch(),
        syncStatusQuery.refetch(),
      ]);
      toast.success("数据刷新成功!");
    } catch (err) {
      toast.error("刷新失败，请重试");
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, refetchKpis, healthQuery, healthAlertsQuery, budgetAlertsQuery, apiStatusQuery, syncStatusQuery]);

  // 注册全局刷新函数
  useEffect(() => {
    window.refreshDashboardData = handleRefreshAll;
    return () => {
      delete window.refreshDashboardData;
    };
  }, [handleRefreshAll]);

  // 合并所有预警
  const allAlerts = useMemo(() => {
    const alerts: any[] = [];
    
    // 添加健康预警
    if (healthAlertsQuery.data) {
      healthAlertsQuery.data.alerts?.forEach((alert: any) => {
        alerts.push({
          ...alert,
          source: 'health',
          title: alert.alertType,
          message: alert.description,
        });
      });
    }
    
    // 添加预算预警
    if (budgetAlertsQuery.data?.alerts) {
      budgetAlertsQuery.data.alerts.forEach((alert: any) => {
        alerts.push({
          ...alert,
          source: 'budget',
          title: getAlertTypeName(alert.alertType),
          message: alert.message,
        });
      });
    }
    
    // 按时间排序
    return alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [healthAlertsQuery.data, budgetAlertsQuery.data]);

  // 统计预警数量
  const alertStats = useMemo(() => {
    const critical = allAlerts.filter(a => a.severity === 'critical' && a.status === 'active').length;
    const warning = allAlerts.filter(a => (a.severity === 'warning' || a.severity === 'high') && a.status === 'active').length;
    const info = allAlerts.filter(a => a.severity === 'info' && a.status === 'active').length;
    return { critical, warning, info, total: critical + warning + info };
  }, [allAlerts]);

  const getAlertTypeName = (type: string) => {
    const names: Record<string, string> = {
      overspending: "消耗过快",
      underspending: "消耗过慢",
      budget_depleted: "预算耗尽",
      near_depletion: "即将耗尽",
      acos_spike: "ACoS异常",
      ctr_drop: "点击率骤降",
      cvr_drop: "转化率下降",
    };
    return names[type] || type;
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    if (score >= 40) return 'text-orange-400';
    return 'text-red-400';
  };

  const getProgressColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <DashboardLayout>
      {/* 首次登录引导 */}
      {showOnboarding && (
        <OnboardingWizard
          isOpen={showOnboarding}
          onComplete={completeOnboarding}
          onSkip={skipOnboarding}
          onPause={pauseOnboarding}
          initialStep={savedProgress || undefined}
        />
      )}

      <div className="space-y-6">
        {/* 页面标题和操作栏 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-7 w-7 text-primary" />
              监控中心
            </h1>
            <p className="text-muted-foreground mt-1">
              实时监控广告表现、健康状态和预警信息
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* API状态指示器 */}
            <ApiStatusWidget />
            
            {/* 账号选择 */}
            <Select
              value={accountId?.toString() || ""}
              onValueChange={(v) => setSelectedAccountId(parseInt(v))}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((account) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshAll}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              刷新数据
            </Button>
          </div>
        </div>

        {/* 主要标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="overview" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              概览
            </TabsTrigger>
            <TabsTrigger value="health" className="gap-2">
              <Activity className="h-4 w-4" />
              健康度
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-2">
              <Bell className="h-4 w-4" />
              预警中心
              {alertStats.total > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5">
                  {alertStats.total}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="status" className="gap-2">
              <Wifi className="h-4 w-4" />
              系统状态
            </TabsTrigger>
          </TabsList>

          {/* 概览Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* 归因调整提示 */}
            {adjustedKpis && adjustedKpis.lowConfidenceDays > 0 && (
              <Card className="border-amber-500/30 bg-amber-500/10">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-400" />
                      <span className="text-sm">
                        <strong>归因调整模式</strong> 近7天数据已根据归因窗口调整，平均调整系数 {adjustedKpis.avgAdjustmentFactor.toFixed(2)}x
                        <span className="text-amber-400 ml-2">({adjustedKpis.lowConfidenceDays}天低置信度)</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">显示调整后数据</span>
                      <Switch
                        checked={showAdjustedData}
                        onCheckedChange={setShowAdjustedData}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* KPI卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <KPICard
                title="转化/天"
                value={(showAdjustedData && adjustedKpis ? adjustedKpis.conversionsPerDay : kpis?.conversionsPerDay || 0).toFixed(1)}
                icon={<ShoppingCart className="h-6 w-6" />}
                trend={undefined}
                trendLabel="vs 上周"
                color="blue"
              />
              <KPICard
                title="ROAS*"
                value={(showAdjustedData && adjustedKpis ? adjustedKpis.roas : kpis?.roas || 0).toFixed(2)}
                icon={<Target className="h-6 w-6" />}
                trend={undefined}
                trendLabel="vs 上周"
                color="green"
              />
              <KPICard
                title="销售额*"
                value={`$${((showAdjustedData && adjustedKpis ? adjustedKpis.totalSales : kpis?.totalSales || 0) / 1).toFixed(0)}`}
                icon={<DollarSign className="h-6 w-6" />}
                trend={undefined}
                trendLabel="vs 上周"
                color="purple"
              />
              <KPICard
                title="ACoS*"
                value={`${(showAdjustedData && adjustedKpis ? adjustedKpis.acos : kpis?.acos || 0).toFixed(1)}%`}
                icon={<Percent className="h-6 w-6" />}
                trend={undefined}
                trendLabel="vs 上周"
                inverseTrend
                color="orange"
              />
              <KPICard
                title="收入/天"
                value={`$${((showAdjustedData && adjustedKpis ? adjustedKpis.revenuePerDay : kpis?.revenuePerDay || 0) / 1).toFixed(0)}`}
                icon={<TrendingUp className="h-6 w-6" />}
                trend={undefined}
                trendLabel="vs 上周"
                color="cyan"
              />
            </div>

            {/* 健康度概览和预警摘要 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 健康度概览 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-green-400" />
                    健康度概览
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 rounded-lg bg-muted/30">
                      <p className={`text-4xl font-bold ${getScoreColor(healthQuery.data?.avgHealthScore || 0)}`}>
                        {healthQuery.data?.avgHealthScore || 0}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">平均健康分数</p>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-400" />
                          健康
                        </span>
                        <span className="font-medium">{healthQuery.data?.healthyCount || 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-400" />
                          警告
                        </span>
                        <span className="font-medium">{healthQuery.data?.warningCount || 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-400" />
                          严重
                        </span>
                        <span className="font-medium">{healthQuery.data?.criticalCount || 0}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 预警摘要 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-amber-400" />
                    预警摘要
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                      <p className="text-2xl font-bold text-red-400">{alertStats.critical}</p>
                      <p className="text-xs text-muted-foreground">严重</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <p className="text-2xl font-bold text-yellow-400">{alertStats.warning}</p>
                      <p className="text-xs text-muted-foreground">警告</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <p className="text-2xl font-bold text-blue-400">{alertStats.info}</p>
                      <p className="text-xs text-muted-foreground">提示</p>
                    </div>
                  </div>
                  {allAlerts.slice(0, 3).map((alert, idx) => (
                    <div key={idx} className="flex items-center gap-2 py-2 border-b last:border-0">
                      {alert.severity === 'critical' ? (
                        <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                      ) : alert.severity === 'warning' || alert.severity === 'high' ? (
                        <AlertTriangle className="h-4 w-4 text-yellow-400 flex-shrink-0" />
                      ) : (
                        <Bell className="h-4 w-4 text-blue-400 flex-shrink-0" />
                      )}
                      <span className="text-sm truncate">{alert.title}</span>
                    </div>
                  ))}
                  {allAlerts.length > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => setActiveTab('alerts')}
                    >
                      查看全部 {allAlerts.length} 条预警
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 健康度Tab */}
          <TabsContent value="health" className="space-y-6">
            {/* 健康度统计卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="bg-gradient-to-br from-green-900/30 to-background border-green-500/20">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">平均健康分数</p>
                      <p className={`text-3xl font-bold ${getScoreColor(healthQuery.data?.avgHealthScore || 0)}`}>
                        {healthQuery.data?.avgHealthScore || 0}
                      </p>
                    </div>
                    <div className="p-3 bg-green-500/20 rounded-full">
                      <Target className="h-6 w-6 text-green-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-red-900/30 to-background border-red-500/20">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">严重问题</p>
                      <p className="text-3xl font-bold text-red-400">
                        {healthQuery.data?.criticalCount || 0}
                      </p>
                    </div>
                    <div className="p-3 bg-red-500/20 rounded-full">
                      <XCircle className="h-6 w-6 text-red-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-yellow-900/30 to-background border-yellow-500/20">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">警告问题</p>
                      <p className="text-3xl font-bold text-yellow-400">
                        {healthQuery.data?.warningCount || 0}
                      </p>
                    </div>
                    <div className="p-3 bg-yellow-500/20 rounded-full">
                      <AlertTriangle className="h-6 w-6 text-yellow-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-emerald-900/30 to-background border-emerald-500/20">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">健康广告活动</p>
                      <p className="text-3xl font-bold text-emerald-400">
                        {healthQuery.data?.healthyCount || 0}
                      </p>
                    </div>
                    <div className="p-3 bg-emerald-500/20 rounded-full">
                      <CheckCircle className="h-6 w-6 text-emerald-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 广告活动健康度列表 */}
            <Card>
              <CardHeader>
                <CardTitle>广告活动健康度详情</CardTitle>
                <CardDescription>各广告活动的健康状态和问题诊断</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {healthQuery.data?.campaigns?.map((campaign: any) => (
                    <div key={campaign.id} className="p-4 rounded-lg border bg-card/50">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="font-medium">{campaign.name}</h4>
                          <p className="text-sm text-muted-foreground">{campaign.type}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-2xl font-bold ${getScoreColor(campaign.healthScore)}`}>
                            {campaign.healthScore}
                          </span>
                          <Badge variant={campaign.status === 'healthy' ? 'default' : campaign.status === 'warning' ? 'secondary' : 'destructive'}>
                            {campaign.status === 'healthy' ? '健康' : campaign.status === 'warning' ? '警告' : '严重'}
                          </Badge>
                        </div>
                      </div>
                      <Progress 
                        value={campaign.healthScore} 
                        className={`h-2 ${getProgressColor(campaign.healthScore)}`}
                      />
                      {campaign.issues && campaign.issues.length > 0 && (
                        <div className="mt-3 space-y-1">
                          {campaign.issues.map((issue: string, idx: number) => (
                            <p key={idx} className="text-sm text-muted-foreground flex items-center gap-2">
                              <AlertTriangle className="h-3 w-3 text-yellow-400" />
                              {issue}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )) || (
                    <p className="text-center text-muted-foreground py-8">暂无健康度数据</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 预警中心Tab */}
          <TabsContent value="alerts" className="space-y-6">
            {/* 预警统计 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="bg-gradient-to-br from-red-900/30 to-background border-red-500/20">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">严重预警</p>
                      <p className="text-3xl font-bold text-red-400">{alertStats.critical}</p>
                    </div>
                    <XCircle className="h-8 w-8 text-red-400" />
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-yellow-900/30 to-background border-yellow-500/20">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">警告预警</p>
                      <p className="text-3xl font-bold text-yellow-400">{alertStats.warning}</p>
                    </div>
                    <AlertTriangle className="h-8 w-8 text-yellow-400" />
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-blue-900/30 to-background border-blue-500/20">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">提示信息</p>
                      <p className="text-3xl font-bold text-blue-400">{alertStats.info}</p>
                    </div>
                    <Bell className="h-8 w-8 text-blue-400" />
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-emerald-900/30 to-background border-emerald-500/20">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">已处理</p>
                      <p className="text-3xl font-bold text-emerald-400">
                        {allAlerts.filter(a => a.status !== 'active').length}
                      </p>
                    </div>
                    <CheckCircle className="h-8 w-8 text-emerald-400" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 预警列表 */}
            <Card>
              <CardHeader>
                <CardTitle>预警列表</CardTitle>
                <CardDescription>所有健康预警和预算预警的汇总</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {allAlerts.length > 0 ? (
                    allAlerts.map((alert, idx) => (
                      <AlertItem
                        key={`${alert.source}-${alert.id}-${idx}`}
                        alert={alert}
                        onAcknowledge={(id) => acknowledgeMutation.mutate({ alertId: id })}
                      />
                    ))
                  ) : (
                    <div className="text-center py-12">
                      <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
                      <p className="text-lg font-medium">一切正常</p>
                      <p className="text-muted-foreground">当前没有活跃的预警</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 系统状态Tab */}
          <TabsContent value="status" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* API连接状态 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wifi className="h-5 w-5" />
                    API连接状态
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-3">
                        {apiStatusQuery.data?.isConnected ? (
                          <div className="p-2 rounded-full bg-green-500/20">
                            <Wifi className="h-5 w-5 text-green-400" />
                          </div>
                        ) : (
                          <div className="p-2 rounded-full bg-red-500/20">
                            <WifiOff className="h-5 w-5 text-red-400" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium">Amazon Advertising API</p>
                          <p className="text-sm text-muted-foreground">
                            {apiStatusQuery.data?.isConnected ? '已连接' : '未连接'}
                          </p>
                        </div>
                      </div>
                      <Badge variant={apiStatusQuery.data?.isConnected ? 'default' : 'destructive'}>
                        {apiStatusQuery.data?.isConnected ? '正常' : '断开'}
                      </Badge>
                    </div>
                    
                    {apiStatusQuery.data?.tokenExpiresAt && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Token过期时间</span>
                        <span>{format(new Date(apiStatusQuery.data.tokenExpiresAt), 'yyyy-MM-dd HH:mm')}</span>
                      </div>
                    )}
                    
                    {apiStatusQuery.data?.lastRefresh && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">上次刷新</span>
                        <span>{format(new Date(apiStatusQuery.data.lastRefresh), 'yyyy-MM-dd HH:mm')}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* 数据同步状态 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    数据同步状态
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${syncStatusQuery.data?.status === 'success' ? 'bg-green-500/20' : syncStatusQuery.data?.status === 'running' ? 'bg-blue-500/20' : 'bg-yellow-500/20'}`}>
                          <RefreshCw className={`h-5 w-5 ${syncStatusQuery.data?.status === 'success' ? 'text-green-400' : syncStatusQuery.data?.status === 'running' ? 'text-blue-400 animate-spin' : 'text-yellow-400'}`} />
                        </div>
                        <div>
                          <p className="font-medium">数据同步</p>
                          <p className="text-sm text-muted-foreground">
                            {syncStatusQuery.data?.status === 'success' ? '同步完成' : 
                             syncStatusQuery.data?.status === 'running' ? '同步中...' : '等待同步'}
                          </p>
                        </div>
                      </div>
                      <Badge variant={syncStatusQuery.data?.status === 'success' ? 'default' : 'secondary'}>
                        {syncStatusQuery.data?.status || '未知'}
                      </Badge>
                    </div>
                    
                    {syncStatusQuery.data?.lastSyncAt && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">上次同步时间</span>
                        <span>{format(new Date(syncStatusQuery.data.lastSyncAt), 'yyyy-MM-dd HH:mm')}</span>
                      </div>
                    )}
                    
                    {syncStatusQuery.data?.recordsCount !== undefined && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">同步记录数</span>
                        <span>{syncStatusQuery.data.recordsCount}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
