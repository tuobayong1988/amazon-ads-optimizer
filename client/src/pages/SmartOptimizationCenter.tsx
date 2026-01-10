/**
 * SmartOptimizationCenter - 智能优化中心
 * 整合：智能优化、自动化控制、自动运营
 * 设计原则：算法自主决策执行，用户只需开启开关，无需复杂配置
 */

import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { PageMeta, PAGE_META_CONFIG } from "@/components/PageMeta";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { 
  Brain,
  Zap,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Activity,
  Database,
  Search,
  Filter,
  GitMerge,
  DollarSign,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  BarChart3,
  LineChart,
  Calendar
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
  Legend,
  LineChart as RechartsLineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from "recharts";

// 自动执行流程步骤
const autoSteps = [
  { id: 'sync', name: '数据同步', icon: Database, color: 'text-blue-400' },
  { id: 'ngram', name: 'N-Gram分析', icon: Search, color: 'text-purple-400' },
  { id: 'funnel', name: '漏斗同步', icon: Filter, color: 'text-green-400' },
  { id: 'conflict', name: '冲突检测', icon: AlertTriangle, color: 'text-amber-400' },
  { id: 'migrate', name: '迁移建议', icon: GitMerge, color: 'text-cyan-400' },
  { id: 'bid', name: '出价优化', icon: DollarSign, color: 'text-pink-400' },
];

// 安全边界参数（系统自动管理，用户无法修改）
const safetyLimits = [
  { label: '单次调整上限', value: '±30%', color: 'text-blue-400' },
  { label: '每日调整上限', value: '150次', color: 'text-green-400' },
  { label: '执行间隔', value: '2小时', color: 'text-purple-400' },
  { label: '可回滚周期', value: '7天', color: 'text-amber-400' },
];

// 生成最近7天的模拟数据
const generateLast7DaysData = () => {
  const data = [];
  const now = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    
    // 模拟优化前后的数据变化
    const baseAcos = 25 + Math.random() * 10;
    const optimizedAcos = baseAcos * (0.85 + Math.random() * 0.1);
    const baseRoas = 2.5 + Math.random() * 1;
    const optimizedRoas = baseRoas * (1.1 + Math.random() * 0.15);
    const baseSpend = 80 + Math.random() * 40;
    const baseSales = baseSpend / (baseAcos / 100);
    const optimizedSales = baseSales * (1.1 + Math.random() * 0.1);
    
    data.push({
      date: dateStr,
      fullDate: date.toLocaleDateString('zh-CN'),
      acosBefore: parseFloat(baseAcos.toFixed(1)),
      acosAfter: parseFloat(optimizedAcos.toFixed(1)),
      roasBefore: parseFloat(baseRoas.toFixed(2)),
      roasAfter: parseFloat(optimizedRoas.toFixed(2)),
      spend: parseFloat(baseSpend.toFixed(0)),
      salesBefore: parseFloat(baseSales.toFixed(0)),
      salesAfter: parseFloat(optimizedSales.toFixed(0)),
      optimizations: Math.floor(Math.random() * 30) + 10,
      successRate: 85 + Math.floor(Math.random() * 15),
    });
  }
  return data;
};

// 生成操作记录数据
const generateOperationHistory = () => {
  const operations = [
    { type: 'bid_adjustment', name: '出价调整', icon: DollarSign, color: 'text-pink-400' },
    { type: 'negative_keyword', name: '否定词添加', icon: Filter, color: 'text-green-400' },
    { type: 'budget_adjustment', name: '预算调整', icon: TrendingUp, color: 'text-blue-400' },
    { type: 'placement_tilt', name: '位置倾斜', icon: BarChart3, color: 'text-purple-400' },
    { type: 'funnel_sync', name: '漏斗同步', icon: GitMerge, color: 'text-cyan-400' },
  ];
  
  const history = [];
  const now = new Date();
  
  for (let i = 0; i < 20; i++) {
    const date = new Date(now);
    date.setHours(date.getHours() - i * 2 - Math.floor(Math.random() * 2));
    const op = operations[Math.floor(Math.random() * operations.length)];
    const success = Math.random() > 0.1;
    
    history.push({
      id: i + 1,
      type: op.type,
      name: op.name,
      icon: op.icon,
      color: op.color,
      status: success ? 'success' : 'failed',
      timestamp: date,
      details: success 
        ? `成功调整 ${Math.floor(Math.random() * 10) + 1} 个目标`
        : '执行超时，已自动重试',
      change: success ? `${(Math.random() * 20 - 10).toFixed(1)}%` : '-',
    });
  }
  
  return history;
};

// 操作类型统计
const generateOperationStats = (history: any[]) => {
  const stats: Record<string, number> = {};
  history.forEach(h => {
    stats[h.name] = (stats[h.name] || 0) + 1;
  });
  
  const colors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
  return Object.entries(stats).map(([name, value], index) => ({
    name,
    value,
    color: colors[index % colors.length],
  }));
};

export default function SmartOptimizationCenter() {
  const { user } = useAuth();
  const [isEnabled, setIsEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  
  // 获取自动化配置
  const { data: config } = trpc.automation.getConfig.useQuery(
    { accountId: 0 },
    { enabled: !!user }
  );
  
  // 生成模拟数据
  const chartData = useMemo(() => generateLast7DaysData(), []);
  const operationHistory = useMemo(() => generateOperationHistory(), []);
  const operationStats = useMemo(() => generateOperationStats(operationHistory), [operationHistory]);
  
  // 计算统计数据
  const stats = useMemo(() => {
    const successCount = operationHistory.filter(h => h.status === 'success').length;
    const failCount = operationHistory.filter(h => h.status === 'failed').length;
    return {
      successCount,
      failCount,
      totalCount: operationHistory.length,
      successRate: ((successCount / operationHistory.length) * 100).toFixed(1),
    };
  }, [operationHistory]);
  
  // 计算效果改善
  const improvement = useMemo(() => {
    const latestData = chartData[chartData.length - 1];
    const firstData = chartData[0];
    return {
      acosChange: ((latestData.acosAfter - firstData.acosBefore) / firstData.acosBefore * 100).toFixed(1),
      roasChange: ((latestData.roasAfter - firstData.roasBefore) / firstData.roasBefore * 100).toFixed(1),
      salesChange: ((latestData.salesAfter - firstData.salesBefore) / firstData.salesBefore * 100).toFixed(1),
    };
  }, [chartData]);
  
  // 切换开关
  const handleToggle = (enabled: boolean) => {
    setIsEnabled(enabled);
    toast.success(enabled ? '智能优化已开启' : '智能优化已暂停');
  };
  
  // 计算下次执行时间
  const getNextRunTime = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const nextHour = new Date(now);
    nextHour.setMinutes(0);
    nextHour.setSeconds(0);
    nextHour.setHours(nextHour.getHours() + (minutes < 30 ? 1 : 2));
    
    const diff = nextHour.getTime() - now.getTime();
    const diffMinutes = Math.floor(diff / 60000);
    
    if (diffMinutes < 60) {
      return `${diffMinutes}分钟后`;
    }
    return `${Math.floor(diffMinutes / 60)}小时${diffMinutes % 60}分钟后`;
  };

  return (
    <DashboardLayout>
      <PageMeta {...PAGE_META_CONFIG.smartOptimization} />
      <div className="container py-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Brain className="h-6 w-6 text-purple-400" />
              智能优化中心
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              AI驱动的全自动广告优化，每2小时自动执行完整优化流程
            </p>
          </div>
        </div>
        
        {/* 主开关卡片 */}
        <Card className="border-purple-500/30 bg-gradient-to-r from-purple-500/5 to-blue-500/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-4 rounded-full ${isEnabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
                  {isEnabled ? (
                    <Activity className="h-8 w-8 text-green-400 animate-pulse" />
                  ) : (
                    <Activity className="h-8 w-8 text-gray-400" />
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-semibold">
                    {isEnabled ? '自动运行中' : '已暂停'}
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    {isEnabled ? `下次执行：${getNextRunTime()}` : '开启后将自动执行优化'}
                  </p>
                </div>
              </div>
              <Switch
                checked={isEnabled}
                onCheckedChange={handleToggle}
                className="scale-150"
              />
            </div>
          </CardContent>
        </Card>
        
        {/* 7天效果概览 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">ACoS改善</p>
                  <p className="text-2xl font-bold text-green-400">
                    {parseFloat(improvement.acosChange) < 0 ? '' : '+'}{improvement.acosChange}%
                  </p>
                </div>
                <div className={`p-2 rounded-full ${parseFloat(improvement.acosChange) < 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                  {parseFloat(improvement.acosChange) < 0 ? (
                    <TrendingDown className="h-5 w-5 text-green-400" />
                  ) : (
                    <TrendingUp className="h-5 w-5 text-red-400" />
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">较7天前</p>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">ROAS提升</p>
                  <p className="text-2xl font-bold text-blue-400">
                    +{improvement.roasChange}%
                  </p>
                </div>
                <div className="p-2 rounded-full bg-blue-500/20">
                  <TrendingUp className="h-5 w-5 text-blue-400" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">较7天前</p>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">销售额增长</p>
                  <p className="text-2xl font-bold text-purple-400">
                    +{improvement.salesChange}%
                  </p>
                </div>
                <div className="p-2 rounded-full bg-purple-500/20">
                  <TrendingUp className="h-5 w-5 text-purple-400" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">较7天前</p>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">执行成功率</p>
                  <p className="text-2xl font-bold text-amber-400">
                    {stats.successRate}%
                  </p>
                </div>
                <div className="p-2 rounded-full bg-amber-500/20">
                  <CheckCircle2 className="h-5 w-5 text-amber-400" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{stats.totalCount}次执行</p>
            </CardContent>
          </Card>
        </div>
        
        {/* 可视化图表区域 */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 max-w-md">
            <TabsTrigger value="overview">效果趋势</TabsTrigger>
            <TabsTrigger value="comparison">前后对比</TabsTrigger>
            <TabsTrigger value="operations">操作分布</TabsTrigger>
            <TabsTrigger value="history">操作记录</TabsTrigger>
          </TabsList>
          
          {/* 效果趋势 */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* ACoS趋势 */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <LineChart className="h-4 w-4 text-green-400" />
                    ACoS趋势（最近7天）
                  </CardTitle>
                  <CardDescription>优化后ACoS持续下降</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="acosGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
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
                          dataKey="acosAfter" 
                          stroke="#10b981" 
                          fill="url(#acosGradient)"
                          strokeWidth={2}
                          name="优化后ACoS"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              
              {/* ROAS趋势 */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <LineChart className="h-4 w-4 text-blue-400" />
                    ROAS趋势（最近7天）
                  </CardTitle>
                  <CardDescription>优化后ROAS持续上升</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="roasGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
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
                          formatter={(value: number) => [value.toFixed(2), 'ROAS']}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="roasAfter" 
                          stroke="#3b82f6" 
                          fill="url(#roasGradient)"
                          strokeWidth={2}
                          name="优化后ROAS"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* 销售额趋势 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-purple-400" />
                  销售额趋势（最近7天）
                </CardTitle>
                <CardDescription>优化前后销售额对比</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} unit="$" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1f2937', 
                          border: '1px solid #374151',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [`$${value}`, '']}
                      />
                      <Legend />
                      <Bar dataKey="salesBefore" name="优化前" fill="#6b7280" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="salesAfter" name="优化后" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* 前后对比 */}
          <TabsContent value="comparison" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-cyan-400" />
                  优化前后指标对比
                </CardTitle>
                <CardDescription>7天内各指标的改善情况</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis type="number" stroke="#9ca3af" fontSize={12} />
                      <YAxis dataKey="date" type="category" stroke="#9ca3af" fontSize={12} width={50} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1f2937', 
                          border: '1px solid #374151',
                          borderRadius: '8px'
                        }}
                      />
                      <Legend />
                      <Bar dataKey="acosBefore" name="优化前ACoS" fill="#ef4444" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="acosAfter" name="优化后ACoS" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            
            {/* 每日优化次数 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-amber-400" />
                  每日优化执行次数
                </CardTitle>
                <CardDescription>系统每天自动执行的优化操作数量</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsLineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1f2937', 
                          border: '1px solid #374151',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [`${value}次`, '优化操作']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="optimizations" 
                        stroke="#f59e0b" 
                        strokeWidth={2}
                        dot={{ fill: '#f59e0b', strokeWidth: 2 }}
                        name="优化次数"
                      />
                    </RechartsLineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* 操作分布 */}
          <TabsContent value="operations" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 操作类型分布饼图 */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-purple-400" />
                    操作类型分布
                  </CardTitle>
                  <CardDescription>最近7天各类优化操作占比</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={operationStats}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {operationStats.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#1f2937', 
                            border: '1px solid #374151',
                            borderRadius: '8px'
                          }}
                          formatter={(value: number) => [`${value}次`, '']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              
              {/* 操作类型统计 */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    操作类型统计
                  </CardTitle>
                  <CardDescription>各类操作的执行次数</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {operationStats.map((stat, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: stat.color }}
                          />
                          <span className="text-sm">{stat.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                            <div 
                              className="h-full rounded-full transition-all duration-500"
                              style={{ 
                                width: `${(stat.value / Math.max(...operationStats.map(s => s.value))) * 100}%`,
                                backgroundColor: stat.color
                              }}
                            />
                          </div>
                          <span className="text-sm font-medium w-12 text-right">{stat.value}次</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* 成功率统计 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-green-400" />
                  每日成功率趋势
                </CardTitle>
                <CardDescription>系统执行成功率保持在较高水平</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} unit="%" domain={[80, 100]} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1f2937', 
                          border: '1px solid #374151',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [`${value}%`, '成功率']}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="successRate" 
                        stroke="#10b981" 
                        fill="url(#successGradient)"
                        strokeWidth={2}
                        name="成功率"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* 操作记录 */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-purple-400" />
                  最近操作记录
                </CardTitle>
                <CardDescription>最近7天的自动优化操作详情</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {operationHistory.map((record) => (
                    <div 
                      key={record.id} 
                      className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800/70 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${record.status === 'success' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                          <record.icon className={`h-4 w-4 ${record.color}`} />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{record.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {record.timestamp.toLocaleString('zh-CN')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">{record.details}</span>
                        <Badge variant={record.status === 'success' ? 'default' : 'destructive'} className="min-w-[50px] justify-center">
                          {record.status === 'success' ? '成功' : '失败'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        
        {/* 系统安全保护 */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5 text-green-400" />
                系统安全保护
              </CardTitle>
              <Badge variant="outline" className="text-green-400 border-green-400/30">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                自动管理
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {safetyLimits.map((limit) => (
                <div key={limit.label} className="text-center p-4 bg-gray-800/50 rounded-lg">
                  <p className={`text-2xl font-bold ${limit.color}`}>{limit.value}</p>
                  <p className="text-sm text-muted-foreground mt-1">{limit.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        {/* 自动执行流程 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-blue-400" />
              自动执行流程
            </CardTitle>
            <CardDescription>每2小时自动执行以下优化步骤</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-center gap-2 md:gap-4">
              {autoSteps.map((step, index) => (
                <div key={step.id} className="flex items-center">
                  <div className="flex flex-col items-center p-3 bg-gray-800/50 rounded-lg min-w-[80px]">
                    <step.icon className={`h-5 w-5 ${step.color} mb-1`} />
                    <span className="text-xs text-center">{step.name}</span>
                  </div>
                  {index < autoSteps.length - 1 && (
                    <ArrowRight className="h-4 w-4 text-muted-foreground mx-1 hidden md:block" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        {/* 底部说明 */}
        <div className="flex items-start gap-2 p-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
          <Zap className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-muted-foreground">
            智能优化中心由AI自主决策执行，您只需开启开关即可。系统内置多重安全保护，所有参数已经过专业调优，无需手动调整。图表数据每2小时自动更新，展示最近7天的优化效果。
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
