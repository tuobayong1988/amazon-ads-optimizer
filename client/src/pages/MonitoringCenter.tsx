/**
 * MonitoringCenter - 监控仪表盘
 * 简洁设计：多账户核心数据一览，突出关键指标
 */

import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import OnboardingWizard, { useOnboarding } from "@/components/OnboardingWizard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  ShoppingCart, 
  Target,
  Percent,
  RefreshCw,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  BarChart3,
  Brain,
  FileText,
  Settings
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
  BarChart,
  Bar,
  Legend
} from "recharts";
import { Link } from "wouter";

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

export default function MonitoringCenter() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState<'today' | '7days' | '30days'>('7days');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Onboarding
  const { showOnboarding, completeOnboarding, skipOnboarding } = useOnboarding();
  
  // 获取账户列表
  const { data: accounts } = trpc.adAccount.list.useQuery(
    undefined,
    { enabled: !!user }
  );
  
  // 生成数据
  const chartData = useMemo(() => generateLast7DaysData(), []);
  const accountsData = useMemo(() => generateAccountsData(), []);
  
  // 计算汇总数据
  const summary = useMemo(() => {
    const totalSpend = accountsData.reduce((sum, a) => sum + a.spend, 0);
    const totalSales = accountsData.reduce((sum, a) => sum + a.sales, 0);
    const totalOrders = accountsData.reduce((sum, a) => sum + a.orders, 0);
    const avgAcos = totalSpend / totalSales * 100;
    const avgRoas = totalSales / totalSpend;
    
    return {
      totalSpend,
      totalSales,
      totalOrders,
      avgAcos,
      avgRoas,
      healthyCount: accountsData.filter(a => a.status === 'healthy').length,
      warningCount: accountsData.filter(a => a.status === 'warning').length,
      criticalCount: accountsData.filter(a => a.status === 'critical').length,
    };
  }, [accountsData]);
  
  // 刷新数据
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success('数据已刷新');
    }, 1000);
  };
  
  // 获取状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-400';
      case 'warning': return 'text-amber-400';
      case 'critical': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };
  
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
      {showOnboarding && (
        <OnboardingWizard 
          isOpen={showOnboarding}
          onComplete={completeOnboarding}
          onSkip={skipOnboarding}
        />
      )}
      
      <div className="container py-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Activity className="h-6 w-6 text-blue-400" />
              监控仪表盘
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              多账户广告数据概览
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* 时间范围选择 */}
            <div className="flex items-center gap-1 bg-gray-800/50 rounded-lg p-1">
              {(['today', '7days', '30days'] as const).map((range) => (
                <Button
                  key={range}
                  variant={timeRange === range ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setTimeRange(range)}
                  className="text-xs"
                >
                  {range === 'today' ? '今天' : range === '7days' ? '近7天' : '近30天'}
                </Button>
              ))}
            </div>
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
                <TrendingUp className="h-3 w-3 text-green-400" />
                <span className="text-green-400">+5.2%</span>
                <span className="text-muted-foreground">vs上周</span>
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
                <TrendingUp className="h-3 w-3 text-green-400" />
                <span className="text-green-400">+8.3%</span>
                <span className="text-muted-foreground">vs上周</span>
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
                <TrendingDown className="h-3 w-3 text-green-400" />
                <span className="text-green-400">-2.1%</span>
                <span className="text-muted-foreground">vs上周</span>
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
                <TrendingUp className="h-3 w-3 text-green-400" />
                <span className="text-green-400">+0.15</span>
                <span className="text-muted-foreground">vs上周</span>
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
                <TrendingUp className="h-3 w-3 text-green-400" />
                <span className="text-green-400">+12</span>
                <span className="text-muted-foreground">vs上周</span>
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
              <CardDescription>最近7天数据</CardDescription>
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
              <CardDescription>最近7天数据</CardDescription>
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
        
        {/* 账户表现对比 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">账户表现对比</CardTitle>
            <CardDescription>各账户核心指标对比</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">账户</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">花费</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">销售额</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">ACoS</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">ROAS</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">订单</th>
                    <th className="text-center py-3 px-4 font-medium text-muted-foreground">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {accountsData.map((account) => (
                    <tr key={account.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{account.name}</span>
                          <Badge variant="outline" className="text-xs">{account.marketplace}</Badge>
                        </div>
                      </td>
                      <td className="text-right py-3 px-4">
                        <div>
                          <span>${account.spend.toFixed(0)}</span>
                          <span className={`ml-2 text-xs ${account.change.spend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {account.change.spend >= 0 ? '+' : ''}{account.change.spend}%
                          </span>
                        </div>
                      </td>
                      <td className="text-right py-3 px-4">
                        <div>
                          <span>${account.sales.toFixed(0)}</span>
                          <span className={`ml-2 text-xs ${account.change.sales >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {account.change.sales >= 0 ? '+' : ''}{account.change.sales}%
                          </span>
                        </div>
                      </td>
                      <td className="text-right py-3 px-4">
                        <div>
                          <span>{account.acos.toFixed(1)}%</span>
                          <span className={`ml-2 text-xs ${account.change.acos <= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {account.change.acos >= 0 ? '+' : ''}{account.change.acos}%
                          </span>
                        </div>
                      </td>
                      <td className="text-right py-3 px-4">{account.roas.toFixed(2)}</td>
                      <td className="text-right py-3 px-4">{account.orders}</td>
                      <td className="text-center py-3 px-4">
                        <Badge 
                          variant={account.status === 'healthy' ? 'default' : account.status === 'warning' ? 'secondary' : 'destructive'}
                          className={account.status === 'healthy' ? 'bg-green-500/20 text-green-400' : account.status === 'warning' ? 'bg-amber-500/20 text-amber-400' : ''}
                        >
                          {account.status === 'healthy' ? '健康' : account.status === 'warning' ? '警告' : '严重'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        
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
          
          <Link href="/analytics">
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
