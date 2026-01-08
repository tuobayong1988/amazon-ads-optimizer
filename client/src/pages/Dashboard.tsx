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
  MapPin
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import toast from "react-hot-toast";

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

  // 模拟目标达成进度
  const progress = Math.round(60 + Math.random() * 35);

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

export default function Dashboard() {
  const { user } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  
  // 区域对比时间范围状态
  const [regionDatePreset, setRegionDatePreset] = useState<DatePreset>('last30days');
  const [regionCustomStartDate, setRegionCustomStartDate] = useState<Date | undefined>(subDays(new Date(), 30));
  const [regionCustomEndDate, setRegionCustomEndDate] = useState<Date | undefined>(new Date());
  
  // 测试toast是否工作 - 页面加载时显示
  useEffect(() => {
    // 延迟1秒后显示toast
    const timer = setTimeout(() => {
      toast.success("页面加载完成 - 欢迎使用亚马逊广告优化系统");
    }, 1000);
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

  // 计算归因调整后的KPI汇总
  const adjustedKpis = useMemo(() => {
    if (!attributionData || attributionData.length === 0) return null;
    
    // 汇总调整后的数据
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
      // 计算平均调整系数和置信度
      avgAdjustmentFactor: attributionData.reduce((sum, d) => sum + d.adjusted.adjustmentFactor, 0) / days,
      lowConfidenceDays: attributionData.filter(d => d.adjusted.confidence === 'low').length,
    };
  }, [attributionData]);

  // 是否显示归因调整后的数据
  const [showAdjustedData, setShowAdjustedData] = useState(true);

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

  // Fetch performance groups
  const { data: performanceGroups } = trpc.performanceGroup.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 计算区域对比的时间范围
  const regionDateRange = useMemo(() => {
    if (regionDatePreset === 'custom') {
      return {
        startDate: regionCustomStartDate ? format(regionCustomStartDate, 'yyyy-MM-dd') : undefined,
        endDate: regionCustomEndDate ? format(regionCustomEndDate, 'yyyy-MM-dd') : undefined,
      };
    }
    const range = getDateRange(regionDatePreset);
    return {
      startDate: format(range.start, 'yyyy-MM-dd'),
      endDate: format(range.end, 'yyyy-MM-dd'),
    };
  }, [regionDatePreset, regionCustomStartDate, regionCustomEndDate]);

  // Fetch region comparison data
  const { data: regionComparison, isLoading: regionLoading } = trpc.analytics.getRegionComparison.useQuery(
    { 
      userId: user?.id!,
      startDate: regionDateRange.startDate,
      endDate: regionDateRange.endDate,
    },
    { enabled: !!user?.id }
  );

  // Mock trend data for charts
  const trendData = useMemo(() => {
    const days = 30;
    const data = [];
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - days);

    for (let i = 0; i < days; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      data.push({
        date: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
        sales: Math.round(500 + Math.random() * 500 + i * 10),
        spend: Math.round(100 + Math.random() * 100 + i * 2),
        conversions: Math.round(10 + Math.random() * 20),
        acos: Math.round((15 + Math.random() * 10) * 100) / 100,
      });
    }
    return data;
  }, []);

  // 周数据对比
  const weeklyComparison = useMemo(() => {
    return [
      { name: '周一', thisWeek: 850, lastWeek: 720 },
      { name: '周二', thisWeek: 920, lastWeek: 810 },
      { name: '周三', thisWeek: 780, lastWeek: 850 },
      { name: '周四', thisWeek: 1100, lastWeek: 920 },
      { name: '周五', thisWeek: 1250, lastWeek: 1050 },
      { name: '周六', thisWeek: 680, lastWeek: 620 },
      { name: '周日', thisWeek: 590, lastWeek: 540 },
    ];
  }, []);

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
              账号: {accounts.find(a => a.id === accountId)?.accountName || '未选择'}
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
            value={`$${((showAdjustedData && adjustedKpis ? adjustedKpis.totalSales : kpis?.totalSales) || 0).toLocaleString()}`}
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
            value={`$${((showAdjustedData && adjustedKpis ? adjustedKpis.revenuePerDay : kpis?.revenuePerDay) || 0).toFixed(0)}`}
            icon={<TrendingUp className="w-5 h-5" />}
            trend={10.8}
            trendLabel="vs 上周"
            color="cyan"
          />
        </div>

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
                {regionComparison.map((region) => (
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
                        <p className="text-muted-foreground">销售额</p>
                        <p className="font-semibold text-lg">${region.totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">花费</p>
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
              
              {/* 区域对比图表 */}
              {regionComparison.length > 1 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium mb-3">区域指标对比</h4>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={regionComparison} barGap={8}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis 
                          dataKey="regionName" 
                          stroke="hsl(var(--muted-foreground))" 
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis 
                          stroke="hsl(var(--muted-foreground))" 
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--card))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                          }}
                          formatter={(value: number, name: string) => [
                            `$${value.toLocaleString()}`,
                            name === 'totalSales' ? '销售额' : '花费'
                          ]}
                        />
                        <Legend 
                          formatter={(value) => value === 'totalSales' ? '销售额' : '花费'}
                        />
                        <Bar dataKey="totalSales" name="totalSales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="totalSpend" name="totalSpend" fill="#a855f7" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Charts Row */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Sales & Spend Trend - 占2列 */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">销售额与花费趋势</CardTitle>
                  <CardDescription>过去30天数据</CardDescription>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <span className="text-muted-foreground">销售额</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                    <span className="text-muted-foreground">花费</span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `$${value}`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                      }}
                      formatter={(value: number) => [`$${value}`, '']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="sales" 
                      name="销售额" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      fill="url(#salesGradient)" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="spend" 
                      name="花费" 
                      stroke="#a855f7" 
                      strokeWidth={2}
                      fill="url(#spendGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* ACoS Trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">ACoS趋势</CardTitle>
              <CardDescription>过去30天数据</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={11} 
                      unit="%" 
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                      }}
                      formatter={(value: number) => [`${value}%`, 'ACoS']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="acos" 
                      name="ACoS" 
                      stroke="#f97316" 
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Weekly Comparison & Quick Actions */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Weekly Comparison */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">周销售对比</CardTitle>
                  <CardDescription>本周 vs 上周</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyComparison} barGap={8}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis 
                      dataKey="name" 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `$${value}`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                      }}
                      formatter={(value: number) => [`$${value}`, '']}
                    />
                    <Bar dataKey="thisWeek" name="本周" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="lastWeek" name="上周" fill="#64748b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
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
                onClick={() => window.location.href = '/performance-groups'}
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
              <Button variant="outline" size="sm" onClick={() => window.location.href = '/performance-groups'}>
                查看全部
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {performanceGroups && performanceGroups.length > 0 ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {performanceGroups.slice(0, 6).map((group) => (
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
                <Button variant="outline" onClick={() => window.location.href = '/performance-groups'}>
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
                    ${(kpis?.totalSpend || 0).toLocaleString()}
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
