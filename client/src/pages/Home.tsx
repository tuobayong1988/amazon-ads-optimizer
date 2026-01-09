import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useEffect, useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { 
  BarChart3, 
  Target, 
  TrendingUp, 
  TrendingDown,
  Zap, 
  ArrowRight, 
  Shield, 
  Brain,
  RefreshCw,
  DollarSign,
  ShoppingCart,
  Percent,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText
} from "lucide-react";
import toast from "react-hot-toast";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";
import { Link } from "wouter";
import { TimeRangeSelector, TimeRangeValue, getDefaultTimeRangeValue, TIME_RANGE_PRESETS, PresetTimeRange } from "@/components/TimeRangeSelector";
import { format } from "date-fns";

// 生成最近7天的模拟数据
const generateLast7DaysData = () => {
  const data = [];
  const now = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    
    const spend = 80 + Math.random() * 60;
    const acos = 18 + Math.random() * 12;
    const sales = spend / (acos / 100);
    
    data.push({
      date: dateStr,
      spend: parseFloat(spend.toFixed(0)),
      sales: parseFloat(sales.toFixed(0)),
      acos: parseFloat(acos.toFixed(1)),
      orders: Math.floor(sales / 35),
    });
  }
  return data;
};

// 生成多账户数据
const generateAccountsData = () => {
  return [
    {
      id: 1,
      name: 'ElaraFit',
      marketplace: 'US',
      spend: 640.13,
      sales: 1920.45,
      acos: 20.2,
      roas: 3.0,
      orders: 55,
      status: 'warning',
      alerts: 1,
      change: { spend: 5.2, sales: 8.3, acos: -2.1 }
    },
    {
      id: 2,
      name: 'ElaraFit EU',
      marketplace: 'DE',
      spend: 320.50,
      sales: 890.20,
      acos: 25.8,
      roas: 2.78,
      orders: 28,
      status: 'healthy',
      alerts: 0,
      change: { spend: -3.1, sales: 2.5, acos: -4.2 }
    },
    {
      id: 3,
      name: 'ElaraFit UK',
      marketplace: 'UK',
      spend: 180.25,
      sales: 520.80,
      acos: 22.5,
      roas: 2.89,
      orders: 18,
      status: 'healthy',
      alerts: 0,
      change: { spend: 1.8, sales: 5.6, acos: -1.5 }
    }
  ];
};

// 营销页面组件（未登录时显示）
function MarketingPage() {
  useEffect(() => {
    document.title = "亚马逊广告智能优化系统 - Amazon Ads Optimizer";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background"></div>
        <nav className="relative container py-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">Amazon Ads Optimizer</span>
          </div>
          <Button asChild>
            <a href={getLoginUrl()}>登录</a>
          </Button>
        </nav>

        <div className="relative container py-24 lg:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Brain className="w-4 h-4" />
              <span>自主研发的智能优化算法</span>
            </div>
            <h1 className="text-4xl lg:text-6xl font-bold tracking-tight mb-6">
              亚马逊广告
              <span className="text-primary">全自动智能优化</span>
              系统
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
              基于<strong>市场曲线建模</strong>、<strong>边际效益分析</strong>和<strong>流量隔离算法</strong>，
              实现广告出价、预算、否定词的全自动优化。每2小时自动运营，让您的广告投放效率持续提升。
            </p>
            <div className="flex flex-wrap gap-4">
              <Button size="lg" asChild>
                <a href={getLoginUrl()}>
                  开始使用
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Features Section */}
      <section className="py-24 bg-card/50">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">核心算法引擎</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              六大核心算法协同工作，实现广告优化的全自动化
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: BarChart3, title: "市场曲线建模", desc: "基于历史数据构建竞价-流量响应曲线" },
              { icon: Target, title: "智能预算分配", desc: "边际效益分析，最优化预算配置" },
              { icon: Brain, title: "N-Gram流量分析", desc: "搜索词词根分析，精准否定无效流量" },
              { icon: Shield, title: "流量冲突检测", desc: "识别广告活动间的流量竞争" },
              { icon: TrendingUp, title: "关键词迁移引擎", desc: "自动将高效关键词升级到精准匹配" },
              { icon: RefreshCw, title: "每2小时自动运营", desc: "全自动执行优化，无需人工干预" },
            ].map((feature, i) => (
              <Card key={i} className="bg-card/50 border-border/50">
                <CardContent className="p-6">
                  <feature.icon className="w-10 h-10 text-primary mb-4" />
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="container text-center">
          <h2 className="text-3xl font-bold mb-4">开始优化您的广告</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            立即登录，体验全自动广告优化
          </p>
          <Button size="lg" asChild>
            <a href={getLoginUrl()}>
              立即开始
              <ArrowRight className="ml-2 h-5 w-5" />
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}

// 仪表盘组件（登录后显示）
function DashboardContent() {
  const { user } = useAuth();
  const [timeRangeValue, setTimeRangeValue] = useState<TimeRangeValue>(getDefaultTimeRangeValue('7days'));
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // 获取数据可用日期范围（用于限制自定义日期选择器）
  const { data: dataDateRange } = trpc.adAccount.getDataDateRange.useQuery(
    undefined,
    { enabled: !!user }
  );
  
  // 计算时间范围的天数和日期
  const days = timeRangeValue.days;
  const startDate = format(timeRangeValue.dateRange.from, 'yyyy-MM-dd');
  const endDate = format(timeRangeValue.dateRange.to, 'yyyy-MM-dd');
  const timeRange = timeRangeValue.preset === 'custom' ? 'custom' : timeRangeValue.preset;
  
  // 获取账户列表及绩效数据（支持时间范围筛选）
  const { data: accountsWithPerformance, refetch: refetchAccounts } = trpc.adAccount.listWithPerformance.useQuery(
    { timeRange: timeRange as any, days, startDate, endDate },
    { enabled: !!user }
  );
  
  // 获取图表数据（真实数据）
  const { data: trendData } = trpc.adAccount.getDailyTrend.useQuery(
    { days, timeRange: timeRange as any, startDate, endDate },
    { enabled: !!user }
  );
  
  // 图表数据：优先使用真实数据，否则使用模拟数据
  const chartData = useMemo(() => {
    if (trendData && trendData.length > 0) {
      return trendData;
    }
    return generateLast7DaysData();
  }, [trendData]);
  
  // 使用真实账户数据，按市场优先级排序
  const accountsData = useMemo(() => {
    if (!accountsWithPerformance || accountsWithPerformance.length === 0) {
      return [];
    }
    // 市场优先级排序：US > CA > MX > 其他
    const marketplacePriority: Record<string, number> = {
      'US': 1,
      'CA': 2,
      'MX': 3,
      'UK': 4,
      'DE': 5,
      'FR': 6,
      'IT': 7,
      'ES': 8,
      'JP': 9,
      'AU': 10,
    };
    return [...accountsWithPerformance].sort((a, b) => {
      const priorityA = marketplacePriority[a.marketplace] || 99;
      const priorityB = marketplacePriority[b.marketplace] || 99;
      return priorityA - priorityB;
    });
  }, [accountsWithPerformance]);
  
  // 计算汇总数据
  const summary = useMemo(() => {
    const totalSpend = accountsData.reduce((sum, a) => sum + a.spend, 0);
    const totalSales = accountsData.reduce((sum, a) => sum + a.sales, 0);
    const totalOrders = accountsData.reduce((sum, a) => sum + a.orders, 0);
    const avgAcos = totalSpend > 0 && totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
    const avgRoas = totalSpend > 0 && totalSales > 0 ? totalSales / totalSpend : 0;
    
    // 计算环比变化
    const spendChange = accountsData.reduce((sum, a) => sum + (a.change?.spend || 0), 0) / Math.max(accountsData.length, 1);
    const salesChange = accountsData.reduce((sum, a) => sum + (a.change?.sales || 0), 0) / Math.max(accountsData.length, 1);
    const acosChange = accountsData.reduce((sum, a) => sum + (a.change?.acos || 0), 0) / Math.max(accountsData.length, 1);
    const roasChange = avgRoas > 0 ? salesChange - spendChange : 0; // 简化计算
    const ordersChange = accountsData.reduce((sum, a) => sum + (a.orders || 0), 0) - accountsData.reduce((sum, a) => sum + (a.orders || 0), 0); // TODO: 需要上期数据
    
    return {
      totalSpend,
      totalSales,
      totalOrders,
      avgAcos,
      avgRoas,
      spendChange,
      salesChange,
      acosChange,
      roasChange,
      ordersChange,
      healthyCount: accountsData.filter(a => a.status === 'healthy').length,
      warningCount: accountsData.filter(a => a.status === 'warning').length,
      criticalCount: accountsData.filter(a => a.status === 'critical').length,
    };
  }, [accountsData]);
  
  // 刷新数据
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchAccounts();
      toast.success('数据已刷新');
    } catch (error) {
      toast.error('刷新失败');
    } finally {
      setIsRefreshing(false);
    }
  };
  
  // 获取状态背景色
  const getStatusBg = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500/20 border-green-500/30';
      case 'warning': return 'bg-amber-500/20 border-amber-500/30';
      case 'critical': return 'bg-red-500/20 border-red-500/30';
      default: return 'bg-gray-500/20 border-gray-500/30';
    }
  };

  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Activity className="h-6 w-6 text-blue-400" />
              数据概览
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              多账户广告数据一览
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* 时间范围选择器 */}
            <TimeRangeSelector
              value={timeRangeValue}
              onChange={setTimeRangeValue}
              minDataDate={dataDateRange?.minDate ? new Date(dataDateRange.minDate) : undefined}
              maxDataDate={dataDateRange?.maxDate ? new Date(dataDateRange.maxDate) : undefined}
              hasData={dataDateRange?.hasData}
            />
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>
        
        {/* 核心指标汇总 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">总花费</p>
                  <p className="text-xl font-bold">${summary.totalSpend.toFixed(0)}</p>
                </div>
                <DollarSign className="h-8 w-8 text-blue-400/50" />
              </div>
              <div className="flex items-center gap-1 mt-2 text-xs">
                {summary.spendChange >= 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-400" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-400" />
                )}
                <span className={summary.spendChange >= 0 ? "text-green-400" : "text-red-400"}>
                  {summary.spendChange >= 0 ? '+' : ''}{summary.spendChange.toFixed(1)}%
                </span>
                <span className="text-muted-foreground">vs上期</span>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">总销售额</p>
                  <p className="text-xl font-bold">${summary.totalSales.toFixed(0)}</p>
                </div>
                <ShoppingCart className="h-8 w-8 text-green-400/50" />
              </div>
              <div className="flex items-center gap-1 mt-2 text-xs">
                {summary.salesChange >= 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-400" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-400" />
                )}
                <span className={summary.salesChange >= 0 ? "text-green-400" : "text-red-400"}>
                  {summary.salesChange >= 0 ? '+' : ''}{summary.salesChange.toFixed(1)}%
                </span>
                <span className="text-muted-foreground">vs上期</span>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">平均ACoS</p>
                  <p className="text-xl font-bold">{summary.avgAcos.toFixed(1)}%</p>
                </div>
                <Percent className="h-8 w-8 text-amber-400/50" />
              </div>
              <div className="flex items-center gap-1 mt-2 text-xs">
                {summary.acosChange <= 0 ? (
                  <TrendingDown className="h-3 w-3 text-green-400" />
                ) : (
                  <TrendingUp className="h-3 w-3 text-red-400" />
                )}
                <span className={summary.acosChange <= 0 ? "text-green-400" : "text-red-400"}>
                  {summary.acosChange >= 0 ? '+' : ''}{summary.acosChange.toFixed(1)}%
                </span>
                <span className="text-muted-foreground">vs上期</span>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">平均ROAS</p>
                  <p className="text-xl font-bold">{summary.avgRoas.toFixed(2)}</p>
                </div>
                <Target className="h-8 w-8 text-purple-400/50" />
              </div>
              <div className="flex items-center gap-1 mt-2 text-xs">
                {summary.roasChange >= 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-400" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-400" />
                )}
                <span className={summary.roasChange >= 0 ? "text-green-400" : "text-red-400"}>
                  {summary.roasChange >= 0 ? '+' : ''}{summary.roasChange.toFixed(2)}
                </span>
                <span className="text-muted-foreground">vs上期</span>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 border-cyan-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">总订单</p>
                  <p className="text-xl font-bold">{summary.totalOrders}</p>
                </div>
                <BarChart3 className="h-8 w-8 text-cyan-400/50" />
              </div>
              <div className="flex items-center gap-1 mt-2 text-xs">
                {summary.ordersChange >= 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-400" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-400" />
                )}
                <span className={summary.ordersChange >= 0 ? "text-green-400" : "text-red-400"}>
                  {summary.ordersChange >= 0 ? '+' : ''}{summary.ordersChange}
                </span>
                <span className="text-muted-foreground">vs上期</span>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* 账户状态概览 */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">账户状态</CardTitle>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                  <span>健康 {summary.healthyCount}</span>
                </div>
                <div className="flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <span>警告 {summary.warningCount}</span>
                </div>
                <div className="flex items-center gap-1">
                  <XCircle className="h-4 w-4 text-red-400" />
                  <span>严重 {summary.criticalCount}</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {accountsData.map((account) => (
                <Card 
                  key={account.id} 
                  className={`${getStatusBg(account.status)} cursor-pointer hover:scale-[1.02] transition-transform`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{account.name}</span>
                        <Badge variant="outline" className="text-xs">{account.marketplace}</Badge>
                      </div>
                      {account.alerts > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {account.alerts} 警告
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">花费</p>
                        <p className="font-medium">${account.spend.toFixed(0)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">销售额</p>
                        <p className="font-medium">${account.sales.toFixed(0)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">ACoS</p>
                        <p className="font-medium">{account.acos.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">ROAS</p>
                        <p className="font-medium">{account.roas.toFixed(2)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
        
        {/* 趋势图表 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 花费与销售趋势 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">花费与销售趋势</CardTitle>
              <CardDescription>{timeRangeValue.preset === 'custom' ? `${format(timeRangeValue.dateRange.from, 'MM/dd')} - ${format(timeRangeValue.dateRange.to, 'MM/dd')}` : TIME_RANGE_PRESETS[timeRangeValue.preset as keyof typeof TIME_RANGE_PRESETS]?.label || '近7天'}数据</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#1f2937', 
                        border: '1px solid #374151',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="spend" 
                      stroke="#3b82f6" 
                      fill="url(#spendGradient)"
                      strokeWidth={2}
                      name="花费"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="sales" 
                      stroke="#10b981" 
                      fill="url(#salesGradient)"
                      strokeWidth={2}
                      name="销售额"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          
          {/* ACoS趋势 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ACoS趋势</CardTitle>
              <CardDescription>{timeRangeValue.preset === 'custom' ? `${format(timeRangeValue.dateRange.from, 'MM/dd')} - ${format(timeRangeValue.dateRange.to, 'MM/dd')}` : TIME_RANGE_PRESETS[timeRangeValue.preset as keyof typeof TIME_RANGE_PRESETS]?.label || '近7天'}数据</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="acosGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} unit="%" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#1f2937', 
                        border: '1px solid #374151',
                        borderRadius: '8px'
                      }}
                      formatter={(value: number) => [`${value}%`, 'ACoS']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="acos" 
                      stroke="#f59e0b" 
                      fill="url(#acosGradient)"
                      strokeWidth={2}
                      name="ACoS"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* 快速操作 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link href="/optimization-engine">
            <Card className="cursor-pointer hover:bg-gray-800/50 transition-colors">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <Brain className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">智能优化中心</p>
                  <p className="text-xs text-muted-foreground">自动优化广告</p>
                </div>
                <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/strategy-center">
            <Card className="cursor-pointer hover:bg-gray-800/50 transition-colors">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <Target className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">策略管理</p>
                  <p className="text-xs text-muted-foreground">配置优化策略</p>
                </div>
                <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/campaigns">
            <Card className="cursor-pointer hover:bg-gray-800/50 transition-colors">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/20">
                  <BarChart3 className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">广告活动</p>
                  <p className="text-xs text-muted-foreground">管理广告活动</p>
                </div>
                <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/analytics-insights">
            <Card className="cursor-pointer hover:bg-gray-800/50 transition-colors">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <FileText className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">数据分析</p>
                  <p className="text-xs text-muted-foreground">查看详细报告</p>
                </div>
                <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}

// 主组件
export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();

  // 加载中显示loading
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  // 已登录显示仪表盘，未登录显示营销页面
  return isAuthenticated ? <DashboardContent /> : <MarketingPage />;
}
