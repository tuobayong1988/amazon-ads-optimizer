import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  AlertTriangle
} from "lucide-react";
import { useState, useMemo } from "react";
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

export default function Dashboard() {
  const { user } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  // Fetch accounts
  const { data: accounts, isLoading: accountsLoading } = trpc.adAccount.list.useQuery();

  // Use first account if none selected
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // Fetch KPIs
  const { data: kpis, isLoading: kpisLoading, refetch: refetchKpis } = trpc.analytics.getKPIs.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // Fetch performance groups
  const { data: performanceGroups } = trpc.performanceGroup.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
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
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              <Activity className="w-3 h-3 mr-1" />
              实时同步中
            </Badge>
            <Button variant="outline" size="sm" onClick={() => refetchKpis()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新数据
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard
            title="转化/天"
            value={kpis?.conversionsPerDay?.toFixed(1) || "0"}
            icon={<ShoppingCart className="w-5 h-5" />}
            trend={12.5}
            trendLabel="vs 上周"
            color="blue"
          />
          <KPICard
            title="ROAS"
            value={kpis?.roas?.toFixed(2) || "0"}
            icon={<Target className="w-5 h-5" />}
            trend={8.3}
            trendLabel="vs 上周"
            color="green"
          />
          <KPICard
            title="销售额"
            value={`$${(kpis?.totalSales || 0).toLocaleString()}`}
            icon={<DollarSign className="w-5 h-5" />}
            trend={15.2}
            trendLabel="vs 上周"
            color="purple"
          />
          <KPICard
            title="ACoS"
            value={`${kpis?.acos?.toFixed(1) || "0"}%`}
            icon={<Percent className="w-5 h-5" />}
            trend={-3.2}
            trendLabel="vs 上周"
            inverseTrend
            color="orange"
          />
          <KPICard
            title="收入/天"
            value={`$${(kpis?.revenuePerDay || 0).toFixed(0)}`}
            icon={<TrendingUp className="w-5 h-5" />}
            trend={10.8}
            trendLabel="vs 上周"
            color="cyan"
          />
        </div>

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
