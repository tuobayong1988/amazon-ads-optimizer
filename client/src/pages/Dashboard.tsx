import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import OnboardingWizard, { useOnboarding } from "@/components/OnboardingWizard";
import ApiStatusWidget from "@/components/ApiStatusWidget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
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
  CheckCircle2,
  AlertTriangle,
  Globe,
  MapPin,
  Shield,
  Cpu,
  RotateCcw,
  HeartPulse
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from "react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import toast from "react-hot-toast";
import { getCurrencySymbolByCode } from "@/utils/currency";

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
// v392: 图表组件懒加载 - 减少首屏bundle大小
const DashboardCharts = lazy(() => import("@/components/dashboard/DashboardCharts"));

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

// 绩效组卡片组件
function PerformanceGroupCard({ group }: { group: any }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'paused': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getGoalIcon = (goal: string) => {
    switch (goal) {
      case 'target_acos': return <Percent className="w-4 h-4" />;
      case 'target_roas': return <Target className="w-4 h-4" />;
      case 'maximize_sales': return <TrendingUp className="w-4 h-4" />;
      case 'daily_budget': return <DollarSign className="w-4 h-4" />;
      default: return <Activity className="w-4 h-4" />;
    }
  };

  const goalLabels: Record<string, string> = {
    'target_acos': '目标ACoS',
    'target_roas': '目标ROAS',
    'maximize_sales': '销售最大化',
    'daily_budget': '每日花费上限',
    'maximize_conversions': '转化最大化'
  };

  // v187: 基于真实数据计算目标达成度
  // 如果group包含实际ACoS/ROAS和目标值，计算真实达成度
  const progress = useMemo(() => {
    if (!group.targetValue || group.targetValue <= 0) return 0;
    
    if (group.optimizationGoal === 'target_acos') {
      // ACoS目标：实际ACoS越接近目标越好，低于目标=100%
      const actualAcos = group.actualAcos || group.acos;
      if (!actualAcos || actualAcos <= 0) return 0;
      if (actualAcos <= group.targetValue) return 100;
      // 进度 = 目标值 / 实际值 * 100
      return Math.min(100, Math.round((group.targetValue / actualAcos) * 100));
    } else if (group.optimizationGoal === 'target_roas') {
      // ROAS目标：实际ROAS越接近目标越好
      const actualRoas = group.actualRoas || group.roas;
      if (!actualRoas || actualRoas <= 0) return 0;
      if (actualRoas >= group.targetValue) return 100;
      return Math.min(100, Math.round((actualRoas / group.targetValue) * 100));
    } else if (group.optimizationGoal === 'daily_budget') {
      // 预算目标：实际花费接近目标预算
      const actualSpend = group.actualSpend || group.spend;
      if (!actualSpend) return 0;
      return Math.min(100, Math.round((actualSpend / group.targetValue) * 100));
    }
    return 0;
  }, [group]);

  return (
    <Card className="group hover:border-primary/50 transition-all duration-200 bg-card/50 backdrop-blur">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
              {group.name}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              {getGoalIcon(group.optimizationGoal)}
              <span className="text-sm text-muted-foreground">
                {goalLabels[group.optimizationGoal] || group.optimizationGoal}
              </span>
            </div>
          </div>
          <Badge variant="outline" className={getStatusColor(group.status)}>
            {group.status === 'active' ? '运行中' : '已暂停'}
          </Badge>
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">目标值</span>
            <span className="font-medium">
              {group.targetValue ? 
                (group.optimizationGoal === 'target_acos' ? `${group.targetValue}%` : 
                 group.optimizationGoal === 'daily_budget' ? `$${group.targetValue}` :
                 group.targetValue) 
                : '-'}
            </span>
          </div>
          
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">目标达成</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// 快速操作卡片
function QuickActionCard({ 
  icon, 
  title, 
  description, 
  onClick,
  color = "blue"
}: { 
  icon: React.ReactNode; 
  title: string; 
  description: string; 
  onClick: () => void;
  color?: string;
}) {
  return (
    <Card 
      className="cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-all duration-200 group"
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            {icon}
          </div>
          <div>
            <h3 className="font-semibold group-hover:text-primary transition-colors">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// 时间范围预设选项

// v103: Marketplace timezone utilities for correct date calculation
const MARKETPLACE_TIMEZONES: Record<string, string> = {
  "US": "America/Los_Angeles",
  "CA": "America/Vancouver", 
  "MX": "America/Mexico_City",
  "UK": "Europe/London",
  "DE": "Europe/Berlin",
  "FR": "Europe/Paris",
  "IT": "Europe/Rome",
  "ES": "Europe/Madrid",
  "JP": "Asia/Tokyo",
  "AU": "Australia/Sydney",
  "SG": "Asia/Singapore",
  "IN": "Asia/Kolkata",
  "AE": "Asia/Dubai",
  "BR": "America/Sao_Paulo",
};

function getMarketplaceToday(marketplace: string): Date {
  const tz = MARKETPLACE_TIMEZONES[marketplace] || "America/Los_Angeles";
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = formatter.format(now); // "2026-02-15"
  return new Date(dateStr + "T00:00:00");
}

type DatePreset = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth' | 'custom';

const getDateRange = (preset: DatePreset, marketplace?: string): { start: Date; end: Date } => {
  // v103: Use marketplace timezone for date calculation
  const today = marketplace ? getMarketplaceToday(marketplace) : new Date();
  today.setHours(23, 59, 59, 999);
  
  switch (preset) {
    case 'today':
      const todayStart = marketplace ? getMarketplaceToday(marketplace) : new Date();
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

export default function Dashboard() {
  const { user } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  
  // 区域对比时间范围状态
  const [regionDatePreset, setRegionDatePreset] = useState<DatePreset>('last30days');
  const [regionCustomStartDate, setRegionCustomStartDate] = useState<Date | undefined>(subDays(new Date(), 30));
  const [regionCustomEndDate, setRegionCustomEndDate] = useState<Date | undefined>(new Date());
  
  // v386: 延迟加载状态 - 非关键查询延迟1.5秒后启动，避免阻塞关键路径
  const [deferredQueriesEnabled, setDeferredQueriesEnabled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDeferredQueriesEnabled(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  
  // 监听刷新状态变化来显示toast
  useEffect(() => {
    if (refreshStatus === 'loading') {
      toast("开始刷新数据...", { icon: "🔄" });
    } else if (refreshStatus === 'success') {
      toast.success("数据刷新成功!");
      setRefreshStatus('idle');
    } else if (refreshStatus === 'error') {
      toast.error("刷新失败，请稍后重试");
      setRefreshStatus('idle');
    }
  }, [refreshStatus]);
  
  // 首次登录引导
  const { showOnboarding, completeOnboarding, skipOnboarding, pauseOnboarding, savedProgress } = useOnboarding();

  // Fetch accounts
  const { data: accounts, isLoading: accountsLoading } = trpc.adAccount.list.useQuery() as any;

  // Use first account if none selected
  const accountId = selectedAccountId || accounts?.[0]?.id;
  // v103: Get current account's marketplace for timezone-aware date calculation
  // @ts-ignore
  const currentMarketplace = accounts?.find(a => a.id === accountId)?.marketplace || 'US';

  // ✅ KPI日期范围状态 - 与日期选择器联动 (moved before usage)
  const [kpiDatePreset, setKpiDatePreset] = useState<DatePreset>('last30days');
  const [kpiCustomStartDate, setKpiCustomStartDate] = useState<Date | undefined>(subDays(new Date(), 30));
  const [kpiCustomEndDate, setKpiCustomEndDate] = useState<Date | undefined>(new Date());
  
  // 计算KPI日期范围
  const kpiDateRange = useMemo(() => {
    if (kpiDatePreset === 'custom') {
      return {
        startDate: kpiCustomStartDate ? format(kpiCustomStartDate, 'yyyy-MM-dd') : undefined,
        endDate: kpiCustomEndDate ? format(kpiCustomEndDate, 'yyyy-MM-dd') : undefined,
      };
    }
    const range = getDateRange(kpiDatePreset, currentMarketplace);
    return {
      startDate: format(range.start, 'yyyy-MM-dd'),
      endDate: format(range.end, 'yyyy-MM-dd'),
    };
  }, [kpiDatePreset, kpiCustomStartDate, kpiCustomEndDate, currentMarketplace]);

  // ✅ Fetch KPIs - 与日期选择器联动
  const { data: kpis, isLoading: kpisLoading, refetch: refetchKpis } = trpc.analytics.getKPIs.useQuery(
    { 
      accountId: accountId!,
      startDate: kpiDateRange.startDate,
      endDate: kpiDateRange.endDate,
    },
    { enabled: !!accountId, staleTime: 2 * 60 * 1000 } // v386: 2分钟缓存，与后端API缓存对齐
  );

  // 获取当前账户的货币符号
  const currencySymbol = getCurrencySymbolByCode(kpis?.currency);

  // v386: 归因调整数据延迟加载，不阻塞关键路径
  const { data: attributionData } = trpc.specialScenario.getAttributionAdjustedData.useQuery(
    { accountId: accountId!, days: 7 },
    { enabled: !!accountId && deferredQueriesEnabled, staleTime: 10 * 60 * 1000 }
  );

  // 计算归因调整后的KPI汇总
  const adjustedKpis = useMemo(() => {
    if (!attributionData || attributionData.length === 0) return null;
    
    // 汇总调整后的数据
    const totals = attributionData.reduce((acc: any, day: any) => ({
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
      // 计算平均调整系数和置信度
      avgAdjustmentFactor: attributionData.reduce((sum: any, d: any) => sum + d.adjusted.adjustmentFactor, 0) / days,
      lowConfidenceDays: attributionData.filter(d => d.adjusted.confidence === 'low').length,
    };
  }, [attributionData]);

  // 是否显示归因调整后的数据
  const [showAdjustedData, setShowAdjustedData] = useState(true);

  // v386: 系统健康指标延迟加载，不阻塞关键路径
  const { data: healthMetrics } = trpc.monitoring.getHealthMetrics.useQuery(
    { accountId: accountId!, days: 7 },
    { enabled: !!accountId && deferredQueriesEnabled, staleTime: 10 * 60 * 1000, refetchInterval: 10 * 60 * 1000 }
  );

  // v386: 部署纠错报告延迟加载
  const { data: deployCorrectionReport } = trpc.monitoring.getDeployCorrectionReport.useQuery(
    undefined,
    { enabled: deferredQueriesEnabled, staleTime: 30 * 60 * 1000, refetchInterval: 30 * 60 * 1000 }
  );
  
  // (kpiDateRange 已移动到上方使用前)

  // 刷新数据的回调函数
  const handleRefreshData = useCallback(async () => {
    // 立即显示toast确认函数被调用
    toast("开始刷新数据...", { icon: "🔄" });
    
    if (isRefreshing) {
      toast("已在刷新中，请稍候", { icon: "⚠️" });
      return;
    }
    
    setIsRefreshing(true);
    
    try {
      await refetchKpis();
      toast.success("数据刷新成功!");
    } catch (err) {
      toast.error("刷新失败，请重试");
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, refetchKpis]);

  // 注册全局刷新函数
  useEffect(() => {
    window.refreshDashboardData = handleRefreshData;
    return () => {
      delete window.refreshDashboardData;
    };
  }, [handleRefreshData]);

  // v386: 绩效组延迟加载
  const { data: performanceGroups } = trpc.performanceGroup.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId && deferredQueriesEnabled, staleTime: 5 * 60 * 1000 }
  );

  // 计算区域对比的时间范围
  const regionDateRange = useMemo(() => {
    if (regionDatePreset === 'custom') {
      return {
        startDate: regionCustomStartDate ? format(regionCustomStartDate, 'yyyy-MM-dd') : undefined,
        endDate: regionCustomEndDate ? format(regionCustomEndDate, 'yyyy-MM-dd') : undefined,
      };
    }
    const range = getDateRange(regionDatePreset, currentMarketplace);
    return {
      startDate: format(range.start, 'yyyy-MM-dd'),
      endDate: format(range.end, 'yyyy-MM-dd'),
    };
  }, [regionDatePreset, regionCustomStartDate, regionCustomEndDate, currentMarketplace]);

  // v386: 区域对比数据延迟加载（跨账户查询较重，不阻塞关键路径）
  const { data: regionComparison, isLoading: regionLoading } = trpc.analytics.getRegionComparison.useQuery(
    { 
      userId: user?.id!,
      startDate: regionDateRange.startDate,
      endDate: regionDateRange.endDate,
    },
    { enabled: !!user?.id && deferredQueriesEnabled, staleTime: 10 * 60 * 1000 }
  );

  // ✅ 获取真实趋势数据 - 与日期选择器联动
  const { data: realTrendData } = trpc.analytics.getTrendData.useQuery(
    { 
      accountId: accountId!, 
      startDate: kpiDateRange.startDate,
      endDate: kpiDateRange.endDate,
    },
    { enabled: !!accountId, staleTime: 2 * 60 * 1000 } // v386: 2分钟缓存
  );
  
  // 如果没有真实数据，显示空数据提示
  const trendData = useMemo(() => {
    if (realTrendData && realTrendData.length > 0) {
      return realTrendData;
    }
    // 返回空数组，不再使用模拟数据
    return [];
  }, [realTrendData]);

  // v386: 周对比数据延迟加载
  const { data: realWeeklyComparison } = trpc.analytics.getWeeklyComparison.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId && deferredQueriesEnabled, staleTime: 5 * 60 * 1000 }
  );
  
  // 如果没有真实数据，显示空数据
  const weeklyComparison = useMemo(() => {
    if (realWeeklyComparison && realWeeklyComparison.length > 0) {
      return realWeeklyComparison;
    }
    // 返回空数组，不再使用模拟数据
    return [];
  }, [realWeeklyComparison]);

  if (accountsLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            <p className="text-muted-foreground">加载中...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!accounts || accounts.length === 0) {
    return (
      <DashboardLayout>
        {/* 首次登录引导 */}
        <OnboardingWizard 
          isOpen={showOnboarding} 
          onComplete={completeOnboarding} 
          onSkip={skipOnboarding}
          onPause={pauseOnboarding}
          initialStep={savedProgress || undefined}
        />
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <div className="p-6 rounded-full bg-muted/50 mb-6">
            <BarChart3 className="w-16 h-16 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2">欢迎使用广告优化系统</h2>
          <p className="text-muted-foreground mb-6 max-w-md">
            请先连接Amazon Advertising API同步您的广告数据，系统将自动分析并生成优化建议
          </p>
          <div className="flex gap-3">
            <Button onClick={() => window.location.href = '/amazon-api'}>
              <ArrowUpRight className="w-4 h-4 mr-2" />
              连接Amazon API
            </Button>
            <Button variant="outline" onClick={() => window.location.href = '/data-sync'}>
              同步数据
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">监控仪表盘</h1>
            <p className="text-muted-foreground mt-1">
              账号: {accounts.find((a: any) => a.id === accountId)?.accountName || '未选择'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* API状态小组件 */}
            <ApiStatusWidget compact />
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              <Activity className="w-3 h-3 mr-1" />
              实时同步中
            </Badge>
            <Button 
              variant="outline" 
              size="sm" 
              disabled={isRefreshing}
              onClick={async () => {
                // 通过状态变量触发toast
                setRefreshStatus('loading');
                setIsRefreshing(true);
                
                try {
                  // 执行刷新
                  await refetchKpis();
                  // 刷新成功
                  setRefreshStatus('success');
                } catch (error) {
                  // 刷新失败
                  setRefreshStatus('error');
                } finally {
                  setIsRefreshing(false);
                }
              }}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? '刷新中...' : '刷新数据'}
            </Button>
          </div>
        </div>

        {/* 归因调整开关 */}
        {adjustedKpis && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" />
              <span className="text-sm">
                <span className="font-medium text-blue-500">归因调整模式</span>
                <span className="text-muted-foreground ml-2">
                  近7天数据已根据归因窗口调整，平均调整系数 {adjustedKpis.avgAdjustmentFactor.toFixed(2)}x
                  {adjustedKpis.lowConfidenceDays > 0 && (
                    <span className="text-yellow-500 ml-2">
                      ({adjustedKpis.lowConfidenceDays}天低置信度)
                    </span>
                  )}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">显示调整后数据</span>
              <Switch
                checked={showAdjustedData}
                onCheckedChange={setShowAdjustedData}
              />
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard
            title="转化/天"
            value={(showAdjustedData && adjustedKpis ? adjustedKpis.conversionsPerDay : kpis?.conversionsPerDay)?.toFixed(1) || "0"}
            icon={<ShoppingCart className="w-5 h-5" />}
            trend={12.5}
            trendLabel="vs 上周"
            color="blue"
          />
          <KPICard
            title={showAdjustedData && adjustedKpis ? "ROAS*" : "ROAS"}
            value={(showAdjustedData && adjustedKpis ? adjustedKpis.roas : kpis?.roas)?.toFixed(2) || "0"}
            icon={<Target className="w-5 h-5" />}
            trend={8.3}
            trendLabel="vs 上周"
            color="green"
          />
          <KPICard
            title={showAdjustedData && adjustedKpis ? "销售额*" : "销售额"}
            value={`${currencySymbol}${((showAdjustedData && adjustedKpis ? adjustedKpis.totalSales : kpis?.totalSales) || 0).toLocaleString()}`}
            icon={<DollarSign className="w-5 h-5" />}
            trend={15.2}
            trendLabel="vs 上周"
            color="purple"
          />
          <KPICard
            title={showAdjustedData && adjustedKpis ? "ACoS*" : "ACoS"}
            value={`${((showAdjustedData && adjustedKpis ? adjustedKpis.acos : kpis?.acos) || 0).toFixed(1)}%`}
            icon={<Percent className="w-5 h-5" />}
            trend={-3.2}
            trendLabel="vs 上周"
            inverseTrend
            color="orange"
          />
          <KPICard
            title="收入/天"
            value={`${currencySymbol}${((showAdjustedData && adjustedKpis ? adjustedKpis.revenuePerDay : kpis?.revenuePerDay) || 0).toFixed(0)}`}
            icon={<TrendingUp className="w-5 h-5" />}
            trend={10.8}
            trendLabel="vs 上周"
            color="cyan"
          />
        </div>

        {/* ✅ 归因期数据成熟度提示 */}
        {kpis?.dataMaturity && kpis.dataMaturity.overall === 'pending' && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <div className="text-sm">
              <span className="font-medium text-amber-700 dark:text-amber-300">归因期提示：</span>
              <span className="text-amber-600 dark:text-amber-400">{kpis.dataMaturity.message}</span>
              <span className="text-muted-foreground ml-2">
                (SP: {kpis.dataMaturity.sp === 'finalized' ? '✅已稳定' : '⏳归因中'} | 
                 SB: {kpis.dataMaturity.sb === 'finalized' ? '✅已稳定' : '⏳归因中'} | 
                 SD: {kpis.dataMaturity.sd === 'finalized' ? '✅已稳定' : '⏳归因中'})
              </span>
            </div>
          </div>
        )}

        {/* v260: 系统健康核心指标 */}
        {healthMetrics?.success && healthMetrics.metrics && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <HeartPulse className="w-5 h-5 text-red-500" />
                    系统健康监控
                  </CardTitle>
                  <CardDescription>核心优化指标实时状态 (7天窗口)</CardDescription>
                </div>
                <Badge variant="outline" className="text-xs">
                  v260
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 回滚率 */}
                <div className={`p-4 rounded-lg border ${
                  healthMetrics.metrics.rollbackRate.status === 'healthy' 
                    ? 'bg-gradient-to-br from-green-500/10 to-transparent border-green-500/20' 
                    : healthMetrics.metrics.rollbackRate.status === 'warning'
                    ? 'bg-gradient-to-br from-yellow-500/10 to-transparent border-yellow-500/20'
                    : 'bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${
                      healthMetrics.metrics.rollbackRate.status === 'healthy' ? 'bg-green-500/20' :
                      healthMetrics.metrics.rollbackRate.status === 'warning' ? 'bg-yellow-500/20' : 'bg-red-500/20'
                    }`}>
                      <RotateCcw className={`w-5 h-5 ${
                        healthMetrics.metrics.rollbackRate.status === 'healthy' ? 'text-green-400' :
                        healthMetrics.metrics.rollbackRate.status === 'warning' ? 'text-yellow-400' : 'text-red-400'
                      }`} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold tabular-nums">
                        {healthMetrics.metrics.rollbackRate.rate.toFixed(1)}%
                      </p>
                      <p className="text-sm text-muted-foreground">回滚率</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-dashed flex justify-between text-xs text-muted-foreground">
                    <span>目标: &lt;10%</span>
                    <span className={`flex items-center gap-1 ${
                      healthMetrics.metrics.rollbackRate.trend === 'improving' ? 'text-green-500' :
                      healthMetrics.metrics.rollbackRate.trend === 'worsening' ? 'text-red-500' : ''
                    }`}>
                      {healthMetrics.metrics.rollbackRate.trend === 'improving' ? <TrendingDown className="w-3 h-3" /> :
                       healthMetrics.metrics.rollbackRate.trend === 'worsening' ? <TrendingUp className="w-3 h-3" /> : null}
                      {healthMetrics.metrics.rollbackRate.trend === 'improving' ? '改善中' :
                       healthMetrics.metrics.rollbackRate.trend === 'worsening' ? '恶化中' : '稳定'}
                      (前期: {healthMetrics.metrics.rollbackRate.previousRate.toFixed(1)}%)
                    </span>
                  </div>
                </div>

                {/* 算法激活率 */}
                <div className={`p-4 rounded-lg border ${
                  healthMetrics.metrics.algorithmActivation.status === 'healthy'
                    ? 'bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/20'
                    : healthMetrics.metrics.algorithmActivation.status === 'warning'
                    ? 'bg-gradient-to-br from-yellow-500/10 to-transparent border-yellow-500/20'
                    : 'bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${
                      healthMetrics.metrics.algorithmActivation.status === 'healthy' ? 'bg-blue-500/20' :
                      healthMetrics.metrics.algorithmActivation.status === 'warning' ? 'bg-yellow-500/20' : 'bg-red-500/20'
                    }`}>
                      <Cpu className={`w-5 h-5 ${
                        healthMetrics.metrics.algorithmActivation.status === 'healthy' ? 'text-blue-400' :
                        healthMetrics.metrics.algorithmActivation.status === 'warning' ? 'text-yellow-400' : 'text-red-400'
                      }`} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold tabular-nums">
                        {healthMetrics.metrics.algorithmActivation.advancedRate.toFixed(1)}%
                      </p>
                      <p className="text-sm text-muted-foreground">高级算法激活率</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-dashed text-xs text-muted-foreground">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(healthMetrics.metrics.algorithmActivation.algorithmRates)
                        .sort(([,a], [,b]) => (b as number) - (a as number))
                        .slice(0, 4)
                        .map(([alg, rate]) => (
                          <Badge key={alg} variant="secondary" className="text-[10px] px-1.5 py-0">
                            {alg}: {(rate as number).toFixed(0)}%
                          </Badge>
                        ))}
                    </div>
                  </div>
                </div>

                {/* ACoS趋势 */}
                <div className={`p-4 rounded-lg border ${
                  healthMetrics.metrics.acosTrend.deathSpiralDetected
                    ? 'bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20'
                    : healthMetrics.metrics.acosTrend.direction === 'improving'
                    ? 'bg-gradient-to-br from-green-500/10 to-transparent border-green-500/20'
                    : healthMetrics.metrics.acosTrend.direction === 'worsening'
                    ? 'bg-gradient-to-br from-orange-500/10 to-transparent border-orange-500/20'
                    : 'bg-gradient-to-br from-slate-500/10 to-transparent border-slate-500/20'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${
                      healthMetrics.metrics.acosTrend.deathSpiralDetected ? 'bg-red-500/20' :
                      healthMetrics.metrics.acosTrend.direction === 'improving' ? 'bg-green-500/20' :
                      healthMetrics.metrics.acosTrend.direction === 'worsening' ? 'bg-orange-500/20' : 'bg-slate-500/20'
                    }`}>
                      <Activity className={`w-5 h-5 ${
                        healthMetrics.metrics.acosTrend.deathSpiralDetected ? 'text-red-400' :
                        healthMetrics.metrics.acosTrend.direction === 'improving' ? 'text-green-400' :
                        healthMetrics.metrics.acosTrend.direction === 'worsening' ? 'text-orange-400' : 'text-slate-400'
                      }`} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold tabular-nums">
                        {healthMetrics.metrics.acosTrend.currentAcos.toFixed(1)}%
                      </p>
                      <p className="text-sm text-muted-foreground">ACoS趋势</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-dashed text-xs text-muted-foreground">
                    {healthMetrics.metrics.acosTrend.deathSpiralDetected ? (
                      <span className="text-red-500 font-medium flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        死亡螺旋风险!
                      </span>
                    ) : (
                      <div className="flex justify-between">
                        <span>7天前: {healthMetrics.metrics.acosTrend.acos7dAgo.toFixed(1)}%</span>
                        <span className={`${
                          healthMetrics.metrics.acosTrend.changePoints < 0 ? 'text-green-500' :
                          healthMetrics.metrics.acosTrend.changePoints > 0 ? 'text-red-500' : ''
                        }`}>
                          {healthMetrics.metrics.acosTrend.changePoints > 0 ? '+' : ''}
                          {healthMetrics.metrics.acosTrend.changePoints.toFixed(1)}pp
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 熔断触发率 */}
                <div className={`p-4 rounded-lg border ${
                  healthMetrics.metrics.circuitBreakerRate.rate < 5
                    ? 'bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20'
                    : healthMetrics.metrics.circuitBreakerRate.rate < 15
                    ? 'bg-gradient-to-br from-yellow-500/10 to-transparent border-yellow-500/20'
                    : 'bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${
                      healthMetrics.metrics.circuitBreakerRate.rate < 5 ? 'bg-emerald-500/20' :
                      healthMetrics.metrics.circuitBreakerRate.rate < 15 ? 'bg-yellow-500/20' : 'bg-red-500/20'
                    }`}>
                      <Shield className={`w-5 h-5 ${
                        healthMetrics.metrics.circuitBreakerRate.rate < 5 ? 'text-emerald-400' :
                        healthMetrics.metrics.circuitBreakerRate.rate < 15 ? 'text-yellow-400' : 'text-red-400'
                      }`} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold tabular-nums">
                        {healthMetrics.metrics.circuitBreakerRate.rate.toFixed(1)}%
                      </p>
                      <p className="text-sm text-muted-foreground">熔断触发率</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-dashed text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>触发: {healthMetrics.metrics.circuitBreakerRate.trippedCount}次</span>
                      <span>总决策: {healthMetrics.metrics.circuitBreakerRate.totalDecisions}次</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 提价操作分析摘要 */}
              {healthMetrics.metrics.bidIncreaseAnalysis.totalIncreases > 0 && (
                <div className="mt-4 p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-medium">提价操作分析 (14天)</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">提价次数</p>
                      <p className="font-semibold">{healthMetrics.metrics.bidIncreaseAnalysis.totalIncreases}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">平均幅度</p>
                      <p className="font-semibold">{healthMetrics.metrics.bidIncreaseAnalysis.avgIncreasePercent.toFixed(1)}%</p>
                    </div>
                    {healthMetrics.metrics.bidIncreaseAnalysis.byScenario.slice(0, 2).map((s: any) => (
                      <div key={s.scenario}>
                        <p className="text-muted-foreground text-xs truncate" title={s.scenario}>{s.scenario}</p>
                        <p className="font-semibold">{s.count}次 ({s.avgPercent}%)</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* v261: 部署后纠错报告 */}
        {deployCorrectionReport?.success && deployCorrectionReport.report?.latestDeploy && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <RotateCcw className="w-5 h-5 text-purple-500" />
                  <h3 className="font-semibold">部署后纠错报告</h3>
                </div>
                <Badge variant={deployCorrectionReport.report.latestDeploy.status === 'success' ? 'default' : 'destructive'}>
                  v{deployCorrectionReport.report.latestDeploy.version}
                </Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground">上一版本</p>
                  <p className="text-lg font-bold">v{deployCorrectionReport.report.latestDeploy.previousVersion || '-'}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground">重优化目标</p>
                  <p className="text-lg font-bold">
                    {deployCorrectionReport.report.latestDeploy.targetsSucceeded}/{deployCorrectionReport.report.latestDeploy.targetsProcessed}
                  </p>
                  <p className="text-xs text-green-500">成功/总数</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground">优化动作</p>
                  <p className="text-lg font-bold">{deployCorrectionReport.report.latestDeploy.totalActions}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground">效果验证</p>
                  {deployCorrectionReport.report.latestVerification ? (
                    <>
                      <p className={`text-lg font-bold ${
                        deployCorrectionReport.report.latestVerification.verificationResult?.passed 
                          ? 'text-green-500' : 'text-yellow-500'
                      }`}>
                        {deployCorrectionReport.report.latestVerification.verificationResult?.passed ? '✓ 通过' : '⚠ 待确认'}
                      </p>
                      {deployCorrectionReport.report.latestVerification.verificationResult?.issuesFound > 0 && (
                        <p className="text-xs text-yellow-500">
                          {deployCorrectionReport.report.latestVerification.verificationResult.issuesFound}个不一致已纠正
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-lg font-bold text-muted-foreground">待验证</p>
                  )}
                </div>
              </div>
              {deployCorrectionReport.report.latestDeploy.deployedAt && (
                <p className="text-xs text-muted-foreground mt-3">
                  部署时间: {new Date(deployCorrectionReport.report.latestDeploy.deployedAt).toLocaleString('zh-CN')}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* 区域数据对比 - 移动到头部 */}
        {regionComparison && regionComparison.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Globe className="w-5 h-5" />
                    区域数据对比
                  </CardTitle>
                  <CardDescription>
                    {regionDatePreset === 'custom' && regionCustomStartDate && regionCustomEndDate
                      ? `${format(regionCustomStartDate, 'yyyy/MM/dd')} - ${format(regionCustomEndDate, 'yyyy/MM/dd')}`
                      : regionDatePreset === 'today' ? '今天'
                      : regionDatePreset === 'yesterday' ? '昨天'
                      : regionDatePreset === 'last7days' ? '最近7天'
                      : regionDatePreset === 'last30days' ? '最近30天'
                      : regionDatePreset === 'thisMonth' ? '本月'
                      : regionDatePreset === 'lastMonth' ? '上月'
                      : '各区域广告表现对比'}
                  </CardDescription>
                </div>
                
                {/* 时间范围选择器 */}
                <div className="flex items-center gap-2">
                  <Select value={regionDatePreset} onValueChange={(value: DatePreset) => setRegionDatePreset(value)}>
                    <SelectTrigger className="w-[130px] h-9">
                      <SelectValue placeholder="选择时间" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">今天</SelectItem>
                      <SelectItem value="yesterday">昨天</SelectItem>
                      <SelectItem value="last7days">最近7天</SelectItem>
                      <SelectItem value="last30days">最近30天</SelectItem>
                      <SelectItem value="thisMonth">本月</SelectItem>
                      <SelectItem value="lastMonth">上月</SelectItem>
                      <SelectItem value="custom">自定义</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  {regionDatePreset === 'custom' && (
                    <div className="flex items-center gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-9 px-3">
                            <CalendarIcon className="w-4 h-4 mr-2" />
                            {regionCustomStartDate ? format(regionCustomStartDate, 'MM/dd') : '开始'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={regionCustomStartDate}
                            onSelect={setRegionCustomStartDate}
                            disabled={(date) => date > new Date() || (regionCustomEndDate ? date > regionCustomEndDate : false)}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <span className="text-muted-foreground">-</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-9 px-3">
                            <CalendarIcon className="w-4 h-4 mr-2" />
                            {regionCustomEndDate ? format(regionCustomEndDate, 'MM/dd') : '结束'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={regionCustomEndDate}
                            onSelect={setRegionCustomEndDate}
                            disabled={(date) => date > new Date() || (regionCustomStartDate ? date < regionCustomStartDate : false)}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                {regionComparison.map((region: any) => (
                  <div 
                    key={region.region} 
                    className="p-4 rounded-lg border bg-gradient-to-br from-muted/50 to-transparent hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">{region.flag}</span>
                      <div>
                        <h4 className="font-semibold">{region.regionName}</h4>
                        <p className="text-xs text-muted-foreground">
                          {region.accountCount} 个账号 · {region.marketplaces.join(', ')}
                        </p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">销售额 (USD)</p>
                        <p className="font-semibold text-lg">${region.totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">花费 (USD)</p>
                        <p className="font-semibold text-lg">${region.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">ACoS</p>
                        <p className={`font-semibold ${region.acos > 30 ? 'text-red-500' : region.acos > 20 ? 'text-yellow-500' : 'text-green-500'}`}>
                          {region.acos.toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">ROAS</p>
                        <p className={`font-semibold ${region.roas < 2 ? 'text-red-500' : region.roas < 3 ? 'text-yellow-500' : 'text-green-500'}`}>
                          {region.roas.toFixed(2)}x
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">CTR</p>
                        <p className="font-semibold">{region.ctr.toFixed(2)}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">CVR</p>
                        <p className="font-semibold">{region.cvr.toFixed(2)}%</p>
                      </div>
                    </div>
                    
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>订单: {region.totalOrders.toLocaleString()}</span>
                        <span>点击: {region.totalClicks.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* v392: 图表区域懒加载 */}
              <Suspense fallback={<div className="h-[200px] flex items-center justify-center text-muted-foreground"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <DashboardCharts
                  trendData={trendData}
                  weeklyComparison={weeklyComparison}
                  regionComparison={regionComparison}
                  currencySymbol={currencySymbol}
                />
              </Suspense>
            </CardContent>
          </Card>
        )}

        {/* v392: Quick Actions */}
        <div className="grid lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">快速操作</CardTitle>
              <CardDescription>常用功能入口</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <QuickActionCard
                icon={<Zap className="w-5 h-5" />}
                title="运行自动优化"
                description="执行N-Gram分析和智能竞价"
                onClick={() => window.location.href = '/automation'}
              />
              <QuickActionCard
                icon={<Target className="w-5 h-5" />}
                title="管理绩效组"
                description="设置优化目标和广告分组"
                onClick={() => window.location.href = '/strategy-center'}
              />
              <QuickActionCard
                icon={<Clock className="w-5 h-5" />}
                title="查看竞价日志"
                description="查看所有出价调整记录"
                onClick={() => window.location.href = '/bidding-logs'}
              />
            </CardContent>
          </Card>
        </div>

        {/* Performance Groups Overview */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">绩效组概览</CardTitle>
                <CardDescription>各绩效组的优化状态和目标达成情况</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.location.href = '/strategy-center'}>
                查看全部
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {performanceGroups && performanceGroups.length > 0 ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {performanceGroups.slice(0, 6).map((group: any) => (
                  <PerformanceGroupCard key={group.id} group={group} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto mb-4">
                  <Target className="w-10 h-10 opacity-50" />
                </div>
                <p className="font-medium mb-1">暂无绩效组</p>
                <p className="text-sm mb-4">创建绩效组以开始优化您的广告活动</p>
                <Button variant="outline" onClick={() => window.location.href = '/strategy-center'}>
                  创建绩效组
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Row */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/20">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-blue-500/20">
                  <Eye className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {(kpis?.totalImpressions || 0).toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">总曝光量</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-emerald-500/20">
                  <MousePointer className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {(kpis?.totalClicks || 0).toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">总点击量</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-purple-500/10 to-transparent border-purple-500/20">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-purple-500/20">
                  <DollarSign className="w-6 h-6 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {currencySymbol}{(kpis?.totalSpend || 0).toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">总花费</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-orange-500/10 to-transparent border-orange-500/20">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-orange-500/20">
                  <PieChart className="w-6 h-6 text-orange-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {((kpis?.totalClicks || 0) / Math.max(kpis?.totalImpressions || 1, 1) * 100).toFixed(2)}%
                  </p>
                  <p className="text-sm text-muted-foreground">点击率 (CTR)</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
