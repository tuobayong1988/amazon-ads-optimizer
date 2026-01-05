import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  RefreshCw
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
  Legend
} from "recharts";

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

  // Mock trend data for charts (in real app, this would come from API)
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

  if (accountsLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  if (!accounts || accounts.length === 0) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <BarChart3 className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">暂无广告账号</h2>
          <p className="text-muted-foreground mb-4">请先导入广告数据或添加广告账号</p>
          <Button onClick={() => window.location.href = '/import'}>
            导入数据
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">监控仪表盘</h1>
            <p className="text-muted-foreground">
              账号: {accounts.find(a => a.id === accountId)?.accountName || '未选择'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchKpis()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新数据
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard
            title="转化/天"
            value={kpis?.conversionsPerDay?.toFixed(1) || "0"}
            icon={<ShoppingCart className="w-5 h-5" />}
            trend={12.5}
            trendLabel="vs 上周"
          />
          <KPICard
            title="ROAS"
            value={kpis?.roas?.toFixed(2) || "0"}
            icon={<Target className="w-5 h-5" />}
            trend={8.3}
            trendLabel="vs 上周"
          />
          <KPICard
            title="销售额"
            value={`$${(kpis?.totalSales || 0).toLocaleString()}`}
            icon={<DollarSign className="w-5 h-5" />}
            trend={15.2}
            trendLabel="vs 上周"
          />
          <KPICard
            title="ACoS"
            value={`${kpis?.acos?.toFixed(1) || "0"}%`}
            icon={<Percent className="w-5 h-5" />}
            trend={-3.2}
            trendLabel="vs 上周"
            inverseTrend
          />
          <KPICard
            title="收入/天"
            value={`$${(kpis?.revenuePerDay || 0).toFixed(0)}`}
            icon={<TrendingUp className="w-5 h-5" />}
            trend={10.8}
            trendLabel="vs 上周"
          />
        </div>

        {/* Charts Row */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Sales & Spend Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">销售额与花费趋势</CardTitle>
              <CardDescription>过去30天数据</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="sales" 
                      name="销售额" 
                      stroke="hsl(var(--chart-1))" 
                      fill="url(#salesGradient)" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="spend" 
                      name="花费" 
                      stroke="hsl(var(--chart-2))" 
                      fill="url(#spendGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* ACoS Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">ACoS趋势</CardTitle>
              <CardDescription>过去30天数据</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} unit="%" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                      formatter={(value: number) => [`${value}%`, 'ACoS']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="acos" 
                      name="ACoS" 
                      stroke="hsl(var(--chart-3))" 
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
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
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {performanceGroups.slice(0, 6).map((group) => (
                  <PerformanceGroupCard key={group.id} group={group} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Target className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>暂无绩效组</p>
                <Button variant="link" onClick={() => window.location.href = '/performance-groups'}>
                  创建绩效组
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <div className="grid md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Eye className="w-6 h-6 text-primary" />
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
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-chart-2/10 flex items-center justify-center">
                  <MousePointer className="w-6 h-6 text-chart-2" />
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
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-chart-3/10 flex items-center justify-center">
                  <ShoppingCart className="w-6 h-6 text-chart-3" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {(kpis?.totalOrders || 0).toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">总订单数</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function KPICard({ 
  title, 
  value, 
  icon, 
  trend, 
  trendLabel,
  inverseTrend = false 
}: { 
  title: string; 
  value: string; 
  icon: React.ReactNode; 
  trend: number;
  trendLabel: string;
  inverseTrend?: boolean;
}) {
  const isPositive = inverseTrend ? trend < 0 : trend > 0;
  
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{title}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        </div>
        <div className={`flex items-center gap-1 mt-2 text-sm ${isPositive ? 'text-success' : 'text-destructive'}`}>
          {isPositive ? (
            <ArrowUpRight className="w-4 h-4" />
          ) : (
            <ArrowDownRight className="w-4 h-4" />
          )}
          <span>{Math.abs(trend)}%</span>
          <span className="text-muted-foreground">{trendLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function PerformanceGroupCard({ group }: { group: any }) {
  const goalLabels: Record<string, string> = {
    maximize_sales: '销售最大化',
    target_acos: '目标ACoS',
    target_roas: '目标ROAS',
    daily_spend_limit: '每日花费上限',
    daily_cost: '天成本',
  };

  const getTargetValue = () => {
    switch (group.optimizationGoal) {
      case 'target_acos':
        return group.targetAcos ? `${group.targetAcos}%` : '-';
      case 'target_roas':
        return group.targetRoas || '-';
      case 'daily_spend_limit':
        return group.dailySpendLimit ? `$${group.dailySpendLimit}` : '-';
      case 'daily_cost':
        return group.dailyCostTarget ? `$${group.dailyCostTarget}` : '-';
      default:
        return '-';
    }
  };

  return (
    <div className="p-4 rounded-lg border border-border/50 bg-card/50 hover:bg-card transition-colors">
      <div className="flex items-start justify-between mb-3">
        <h4 className="font-medium truncate flex-1">{group.name}</h4>
        <span className={`status-${group.status}`}>{group.status}</span>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">优化目标</span>
          <span>{goalLabels[group.optimizationGoal] || group.optimizationGoal}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">目标值</span>
          <span className="font-medium">{getTargetValue()}</span>
        </div>
        {group.currentAcos && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">当前ACoS</span>
            <span className="font-medium">{group.currentAcos}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
