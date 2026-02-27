import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip as ReTooltip,
  TooltipContent as ReTooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, ComposedChart, Area, PieChart, Pie, Cell } from "recharts";
import {
  TrendingUp, TrendingDown, Target, DollarSign, Percent, Activity,
  ArrowUpRight, ArrowDownRight, Clock, CheckCircle, XCircle, RefreshCw,
  Calendar, Zap, Brain, BrainCircuit, Workflow, ShieldCheck, Cpu, Gauge,
  ShoppingCart, Eye, Lightbulb, Info,
} from "lucide-react";
import { format, subDays } from "date-fns";
import { zhCN } from "date-fns/locale";

// 算法层级颜色配置
const TIER_COLORS = {
  advanced: { fill: '#8B5CF6', label: '高级算法', icon: BrainCircuit, desc: 'UCB/贝叶斯等统计算法' },
  rule_engine: { fill: '#3B82F6', label: '规则引擎', icon: Workflow, desc: '基于真实AOV的智能规则' },
  conservative: { fill: '#F59E0B', label: '保守策略', icon: ShieldCheck, desc: '数据不足时的安全策略' },
  LinUCB: { fill: '#A855F7', label: 'LinUCB', icon: Brain, desc: '线性上置信界算法' },
  CQL: { fill: '#EC4899', label: 'CQL', icon: Cpu, desc: '保守Q学习离线RL' },
  Bayesian: { fill: '#14B8A6', label: '贝叶斯', icon: Gauge, desc: '贝叶斯优化' },
  unknown: { fill: '#6B7280', label: '未知', icon: Info, desc: '' },
};

const PIE_COLORS = ['#8B5CF6', '#3B82F6', '#F59E0B', '#A855F7', '#EC4899', '#14B8A6', '#6B7280', '#EF4444', '#10B981'];

export default function AlgorithmEffectDashboard() {
  const [timeRange, setTimeRange] = useState("30");
  const [selectedAccount, setSelectedAccount] = useState<string>("all");

  // 获取账户列表
  const { data: accounts } = trpc.adAccount.list.useQuery();

  // 获取出价调整历史统计
  const { data: bidStats } = trpc.placement.getBidAdjustmentStats.useQuery(
    {
      accountId: selectedAccount === "all" ? 0 : parseInt(selectedAccount),
      days: parseInt(timeRange)
    },
    { enabled: selectedAccount !== "all" }
  );

  // 获取出价调整历史记录
  const { data: bidHistory } = trpc.placement.getBidAdjustmentHistory.useQuery(
    {
      accountId: selectedAccount === "all" ? 0 : parseInt(selectedAccount),
      page: 1,
      pageSize: 100,
      startDate: format(subDays(new Date(), parseInt(timeRange)), "yyyy-MM-dd"),
      endDate: format(new Date(), "yyyy-MM-dd")
    },
    { enabled: selectedAccount !== "all" }
  );

  // 获取算法性能指标
  const { data: algorithmPerformance } = trpc.algorithmOptimization.getPerformance.useQuery(
    {
      accountId: selectedAccount === "all" ? undefined : parseInt(selectedAccount),
      days: parseInt(timeRange)
    }
  );

  // 获取按调整类型分析
  const { data: byTypeAnalysis } = trpc.algorithmOptimization.analyzeByType.useQuery(
    {
      accountId: selectedAccount === "all" ? undefined : parseInt(selectedAccount),
      days: parseInt(timeRange)
    }
  );

  // 获取按出价变化幅度分析
  const { data: byRangeAnalysis } = trpc.algorithmOptimization.analyzeByRange.useQuery(
    {
      accountId: selectedAccount === "all" ? undefined : parseInt(selectedAccount),
      days: parseInt(timeRange)
    }
  );

  // v135: 获取算法效果统计（按算法分组）
  const { data: algorithmEffectStats } = trpc.algorithmEffect.getStats.useQuery(
    {
      accountId: selectedAccount === "all" ? undefined : parseInt(selectedAccount),
      days: parseInt(timeRange)
    }
  );

  // v135: 获取算法效果趋势
  const { data: algorithmEffectTrend } = trpc.algorithmEffect.getTrend.useQuery(
    {
      accountId: selectedAccount === "all" ? undefined : parseInt(selectedAccount),
      days: parseInt(timeRange)
    }
  );

  // 计算统计数据
  const autoCount = (byTypeAnalysis || []).filter((t: any) => t.adjustmentType?.startsWith('auto')).reduce((sum: number, t: any) => sum + (t.count || 0), 0);
  const manualCount = (byTypeAnalysis || []).filter((t: any) => t.adjustmentType === 'manual').reduce((sum: number, t: any) => sum + (t.count || 0), 0);
  const avgChange = (byTypeAnalysis || []).reduce((sum: number, t: any) => sum + (t.avgBidChange || 0), 0) / Math.max((byTypeAnalysis || []).length, 1);
  
  const stats = {
    totalAdjustments: algorithmPerformance?.totalAdjustments || 0,
    autoAdjustments: autoCount,
    manualAdjustments: manualCount,
    avgBidChangePercent: avgChange,
    successRate: algorithmPerformance?.trackingRate || 95,
    avgProfitIncrease: algorithmPerformance?.totalEstimatedProfit || 0
  };

  // v135: 算法层级分布数据
  const algorithmDistribution = useMemo(() => {
    if (!algorithmEffectStats || algorithmEffectStats.length === 0) return [];
    
    // 按算法层级归类
    const tierMap = new Map<string, { count: number; positiveRate: number; algorithms: string[] }>();
    
    for (const stat of algorithmEffectStats) {
      const algo = stat.algorithm;
      let tier = 'unknown';
      if (algo === 'LinUCB' || algo === 'CQL' || algo === 'Bayesian' || algo === 'advanced') tier = 'advanced';
      else if (algo === 'rule_engine' || algo.includes('RuleEngine')) tier = 'rule_engine';
      else if (algo === 'conservative') tier = 'conservative';
      else tier = algo; // 保留原始名称
      
      if (!tierMap.has(tier)) {
        tierMap.set(tier, { count: 0, positiveRate: 0, algorithms: [] });
      }
      const entry = tierMap.get(tier)!;
      entry.count += stat.count;
      entry.positiveRate = (entry.positiveRate * (entry.algorithms.length) + stat.positiveRate) / (entry.algorithms.length + 1);
      entry.algorithms.push(algo);
    }
    
    return Array.from(tierMap.entries()).map(([tier, data]) => ({
      tier,
      name: (TIER_COLORS as any)[tier]?.label || tier,
      count: data.count,
      positiveRate: Math.round(data.positiveRate),
      algorithms: data.algorithms,
      fill: (TIER_COLORS as any)[tier]?.fill || '#6B7280',
    })).sort((a, b) => b.count - a.count);
  }, [algorithmEffectStats]);

  // 算法详细统计
  const algorithmDetailStats = useMemo(() => {
    if (!algorithmEffectStats || algorithmEffectStats.length === 0) return [];
    return algorithmEffectStats.map((stat: any) => ({
      algorithm: stat.algorithm,
      count: stat.count,
      positiveRate: stat.positiveRate,
      avgEffectScore: stat.avgEffectScore,
      label: (TIER_COLORS as any)[stat.algorithm]?.label || stat.algorithm,
      fill: (TIER_COLORS as any)[stat.algorithm]?.fill || '#6B7280',
    })).sort((a: any, b: any) => b.count - a.count);
  }, [algorithmEffectStats]);

  // v187: 使用真实API数据替代模拟的ACoS趋势数据
  const { data: trendData } = trpc.adAccount.getDailyTrend.useQuery(
    { days: parseInt(timeRange), timeRange: 'custom' },
    { enabled: true }
  );
  const acosTrendData = useMemo(() => {
    if (!trendData || trendData.length === 0) return [];
    return trendData.map((d: any) => ({
      date: d.date,
      actualAcos: d.acos ? d.acos.toFixed(1) : '0',
      targetAcos: 30,
      beforeOptimization: null
    }));
  }, [trendData]);

  // v135: 从真实趋势数据计算统计指标
  const acosTrendStats = useMemo(() => {
    if (!acosTrendData || acosTrendData.length === 0) return { avgChange: 0, daysOnTarget: 0, targetRate: 0 };
    const acosValues = acosTrendData.map((d: any) => parseFloat(d.actualAcos) || 0).filter((v: number) => v > 0);
    if (acosValues.length < 2) return { avgChange: 0, daysOnTarget: 0, targetRate: 0 };
    
    const firstHalf = acosValues.slice(0, Math.floor(acosValues.length / 2));
    const secondHalf = acosValues.slice(Math.floor(acosValues.length / 2));
    const firstAvg = firstHalf.reduce((a: number, b: number) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a: number, b: number) => a + b, 0) / secondHalf.length;
    const avgChange = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg * 100) : 0;
    
    const daysOnTarget = acosValues.filter((v: number) => v <= 30).length;
    const targetRate = acosValues.length > 0 ? (daysOnTarget / acosValues.length * 100) : 0;
    
    return { avgChange: Math.round(avgChange * 10) / 10, daysOnTarget, targetRate: Math.round(targetRate * 10) / 10 };
  }, [acosTrendData]);

  // 使用真实API数据生成调整分布
  const adjustmentDistribution = {
    byType: (byTypeAnalysis || []).map((item: any) => ({
      type: item.adjustmentType === 'auto_optimal' ? '最优出价' :
            item.adjustmentType === 'auto_dayparting' ? '分时调整' :
            item.adjustmentType === 'auto_placement' ? '位置优化' :
            item.adjustmentType === 'manual' ? '手动调整' : item.adjustmentType,
      count: item.count || 0
    })),
    byRange: (byRangeAnalysis || []).map((item: any) => ({
      range: item.range,
      count: item.count || 0
    }))
  };

  // v187: 使用真实算法效果数据替代模拟数据
  const effectComparisonData = useMemo(() => {
    if (!algorithmPerformance) return [];
    return [
      { metric: 'ACoS (%)', before: (algorithmPerformance as any).avgAcosBefore || 0, after: (algorithmPerformance as any).avgAcosAfter || 0 },
      { metric: 'ROAS', before: (algorithmPerformance as any).avgRoasBefore || 0, after: (algorithmPerformance as any).avgRoasAfter || 0 },
      { metric: '每次点击成本 ($)', before: (algorithmPerformance as any).avgCpcBefore || 0, after: (algorithmPerformance as any).avgCpcAfter || 0 },
    ].filter(item => item.before > 0 || item.after > 0);
  }, [algorithmPerformance]);

  // v135: 计算总调整中各层级占比（用于核心指标卡片迷你图）
  const totalAlgoCount = algorithmDistribution.reduce((sum, d) => sum + d.count, 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题和筛选器 */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Activity className="h-6 w-6 text-blue-400" />
              算法效果追踪仪表盘
            </h1>
            <p className="text-gray-400 mt-1">
              追踪优化算法的执行效果，分析ACoS变化趋势和出价调整历史
            </p>
          </div>
          <div className="flex gap-3">
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-[180px] bg-gray-800 border-gray-700">
                <SelectValue placeholder="选择账户" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部账户</SelectItem>
                {accounts?.map((account) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[140px] bg-gray-800 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">近7天</SelectItem>
                <SelectItem value="14">近14天</SelectItem>
                <SelectItem value="30">近30天</SelectItem>
                <SelectItem value="60">近60天</SelectItem>
                <SelectItem value="90">近90天</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 核心指标卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-900/50 to-blue-800/30 border-blue-700/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-300">总出价调整次数</p>
                  <p className="text-3xl font-bold text-white mt-1">{stats.totalAdjustments}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <Badge variant="secondary" className="bg-blue-500/20 text-blue-300">
                      自动: {stats.autoAdjustments}
                    </Badge>
                    <Badge variant="secondary" className="bg-gray-500/20 text-gray-300">
                      手动: {stats.manualAdjustments}
                    </Badge>
                  </div>
                </div>
                <div className="p-3 bg-blue-500/20 rounded-full">
                  <Zap className="h-6 w-6 text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-900/50 to-green-800/30 border-green-700/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-300">平均出价变化</p>
                  <p className="text-3xl font-bold text-white mt-1">
                    {stats.avgBidChangePercent > 0 ? "+" : ""}{stats.avgBidChangePercent.toFixed(1)}%
                  </p>
                  <p className="text-sm text-gray-400 mt-2">
                    {stats.avgBidChangePercent > 0 ? "整体提价趋势" : "整体降价趋势"}
                  </p>
                </div>
                <div className="p-3 bg-green-500/20 rounded-full">
                  {stats.avgBidChangePercent > 0 ? (
                    <TrendingUp className="h-6 w-6 text-green-400" />
                  ) : (
                    <TrendingDown className="h-6 w-6 text-red-400" />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-900/50 to-purple-800/30 border-purple-700/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-purple-300">执行成功率</p>
                  <p className="text-3xl font-bold text-white mt-1">{stats.successRate.toFixed(1)}%</p>
                  <p className="text-sm text-gray-400 mt-2">
                    算法调整执行成功比例
                  </p>
                </div>
                <div className="p-3 bg-purple-500/20 rounded-full">
                  <CheckCircle className="h-6 w-6 text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* v135: 算法层级分布迷你卡片 */}
          <Card className="bg-gradient-to-br from-orange-900/50 to-orange-800/30 border-orange-700/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm text-orange-300">算法层级分布</p>
                  {totalAlgoCount > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      {algorithmDistribution.slice(0, 3).map((d) => {
                        const pct = totalAlgoCount > 0 ? Math.round(d.count / totalAlgoCount * 100) : 0;
                        return (
                          <div key={d.tier} className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                            <span className="text-xs text-gray-300 w-14 shrink-0">{d.name}</span>
                            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: d.fill }} />
                            </div>
                            <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-white mt-1">-</p>
                  )}
                </div>
                <div className="p-3 bg-orange-500/20 rounded-full shrink-0">
                  <Brain className="h-6 w-6 text-orange-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 图表区域 */}
        <Tabs defaultValue="acos-trend" className="space-y-4">
          <TabsList className="bg-gray-800">
            <TabsTrigger value="acos-trend">ACoS变化趋势</TabsTrigger>
            <TabsTrigger value="algorithm-distribution">算法层级分析</TabsTrigger>
            <TabsTrigger value="effect-comparison">优化前后对比</TabsTrigger>
            <TabsTrigger value="adjustment-distribution">调整分布</TabsTrigger>
            <TabsTrigger value="execution-history">执行历史</TabsTrigger>
          </TabsList>

          {/* ACoS变化趋势 */}
          <TabsContent value="acos-trend">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">ACoS变化趋势</CardTitle>
                <CardDescription>
                  展示算法优化后ACoS的变化趋势，包括实际值与目标值对比
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={acosTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9CA3AF" fontSize={12} />
                      <YAxis stroke="#9CA3AF" fontSize={12} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
                        labelStyle={{ color: "#F3F4F6" }}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="targetAcos"
                        name="目标ACoS"
                        fill="#3B82F6"
                        fillOpacity={0.1}
                        stroke="#3B82F6"
                        strokeDasharray="5 5"
                      />
                      <Line
                        type="monotone"
                        dataKey="actualAcos"
                        name="实际ACoS"
                        stroke="#10B981"
                        strokeWidth={2}
                        dot={{ fill: "#10B981", strokeWidth: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="beforeOptimization"
                        name="优化前ACoS"
                        stroke="#EF4444"
                        strokeWidth={2}
                        strokeDasharray="3 3"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {/* v135: 使用真实计算数据替代硬编码 */}
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div className="bg-gray-700/50 rounded-lg p-4">
                    <p className="text-sm text-gray-400">ACoS变化趋势</p>
                    <p className={`text-2xl font-bold ${acosTrendStats.avgChange <= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {acosTrendStats.avgChange > 0 ? '+' : ''}{acosTrendStats.avgChange}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">前半段 vs 后半段均值对比</p>
                  </div>
                  <div className="bg-gray-700/50 rounded-lg p-4">
                    <p className="text-sm text-gray-400">达标天数</p>
                    <p className="text-2xl font-bold text-blue-400">{acosTrendStats.daysOnTarget}天</p>
                    <p className="text-xs text-gray-500 mt-1">ACoS ≤ 30%的天数</p>
                  </div>
                  <div className="bg-gray-700/50 rounded-lg p-4">
                    <p className="text-sm text-gray-400">目标达成率</p>
                    <p className="text-2xl font-bold text-purple-400">{acosTrendStats.targetRate}%</p>
                    <p className="text-xs text-gray-500 mt-1">达标天数占比</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* v135: 算法层级分析 - 新增Tab */}
          <TabsContent value="algorithm-distribution">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 饼图 */}
              <Card className="bg-gray-800/50 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Brain className="h-5 w-5 text-purple-400" />
                    算法层级分布
                  </CardTitle>
                  <CardDescription>
                    各算法层级在出价调整中的使用占比
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {algorithmDistribution.length > 0 ? (
                    <>
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={algorithmDistribution}
                              dataKey="count"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              outerRadius={100}
                              innerRadius={50}
                              label={(props: any) => `${props.name || ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                              labelLine={{ stroke: '#9CA3AF' }}
                            >
                              {algorithmDistribution.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
                              formatter={(value: number | undefined, name: string | undefined) => [`${value ?? 0} 次`, name ?? '']}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-4 space-y-2">
                        {algorithmDistribution.map((d) => {
                          const pct = totalAlgoCount > 0 ? (d.count / totalAlgoCount * 100).toFixed(1) : '0';
                          return (
                            <div key={d.tier} className="flex items-center justify-between p-2 rounded bg-gray-700/30">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.fill }} />
                                <span className="text-sm text-white">{d.name}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm text-gray-400">{d.count} 次</span>
                                <span className="text-sm font-medium text-white">{pct}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-[300px] text-gray-400">
                      <Brain className="h-12 w-12 mb-3 opacity-30" />
                      <p>暂无算法分布数据</p>
                      <p className="text-xs mt-1">请选择具体账户查看</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 算法详细统计表 */}
              <Card className="bg-gray-800/50 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-blue-400" />
                    算法效果详情
                  </CardTitle>
                  <CardDescription>
                    各算法的调整次数和正向调整率
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {algorithmDetailStats.length > 0 ? (
                    <div className="space-y-3">
                      {algorithmDetailStats.map((stat: any) => (
                        <div key={stat.algorithm} className="p-3 rounded-lg bg-gray-700/30 border border-gray-700/50">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stat.fill }} />
                              <span className="text-sm font-medium text-white">{stat.label}</span>
                              <Badge variant="outline" className="text-[10px] border-gray-600 text-gray-400">
                                {stat.algorithm}
                              </Badge>
                            </div>
                            <span className="text-sm text-gray-400">{stat.count} 次调整</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-500 shrink-0">正向率</span>
                            <div className="flex-1">
                              <Progress
                                value={stat.positiveRate}
                                className="h-2 [&>[data-slot=progress-indicator]]:bg-green-400"
                              />
                            </div>
                            <span className={`text-xs font-mono ${stat.positiveRate >= 60 ? 'text-green-400' : stat.positiveRate >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {stat.positiveRate}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-[300px] text-gray-400">
                      <Cpu className="h-12 w-12 mb-3 opacity-30" />
                      <p>暂无算法效果数据</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 优化前后对比 */}
          <TabsContent value="effect-comparison">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">优化前后效果对比</CardTitle>
                <CardDescription>
                  对比算法介入前后的关键指标变化
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={effectComparisonData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis type="number" stroke="#9CA3AF" fontSize={12} />
                      <YAxis dataKey="metric" type="category" stroke="#9CA3AF" fontSize={12} width={100} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
                        labelStyle={{ color: "#F3F4F6" }}
                      />
                      <Legend />
                      <Bar dataKey="before" name="优化前" fill="#EF4444" />
                      <Bar dataKey="after" name="优化后" fill="#10B981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* v135: 使用真实数据计算对比指标 */}
                <div className="mt-4 grid grid-cols-4 gap-4">
                  {effectComparisonData.length > 0 ? (
                    effectComparisonData.map((item) => {
                      const change = item.before > 0 ? ((item.after - item.before) / item.before * 100) : 0;
                      const isPositive = item.metric.includes('ACoS') || item.metric.includes('成本') ? change < 0 : change > 0;
                      return (
                        <div key={item.metric} className="bg-gray-700/50 rounded-lg p-4 text-center">
                          <p className="text-sm text-gray-400">{item.metric}变化</p>
                          <div className="flex items-center justify-center gap-1 mt-1">
                            {isPositive ? (
                              <ArrowDownRight className="h-4 w-4 text-green-400" />
                            ) : (
                              <ArrowUpRight className="h-4 w-4 text-red-400" />
                            )}
                            <span className={`text-xl font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                              {change > 0 ? '+' : ''}{change.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="col-span-4 text-center py-4 text-gray-400">
                      暂无对比数据
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 调整分布 */}
          <TabsContent value="adjustment-distribution">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">出价调整分布</CardTitle>
                <CardDescription>
                  按调整类型和调整幅度统计出价调整分布
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-medium text-gray-300 mb-4">按调整类型</h4>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={adjustmentDistribution.byType}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="type" stroke="#9CA3AF" fontSize={12} />
                          <YAxis stroke="#9CA3AF" fontSize={12} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
                          />
                          <Bar dataKey="count" fill="#8B5CF6" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-300 mb-4">按调整幅度</h4>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={adjustmentDistribution.byRange}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="range" stroke="#9CA3AF" fontSize={12} />
                          <YAxis stroke="#9CA3AF" fontSize={12} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
                          />
                          <Bar dataKey="count" fill="#F59E0B" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 执行历史 */}
          <TabsContent value="execution-history">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">算法执行历史</CardTitle>
                <CardDescription>
                  最近的算法优化执行记录
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {(byTypeAnalysis || []).slice(0, 10).map((item: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-4 bg-gray-700/50 rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-full bg-blue-500/20">
                          <CheckCircle className="h-5 w-5 text-blue-400" />
                        </div>
                        <div>
                          <p className="text-white font-medium">
                            {item.adjustmentType === 'auto_optimal' ? '最优出价调整' :
                             item.adjustmentType === 'auto_dayparting' ? '分时出价调整' :
                             item.adjustmentType === 'auto_placement' ? '广告位优化' :
                             item.adjustmentType === 'manual' ? '手动调整' : item.adjustmentType}
                          </p>
                          <p className="text-sm text-gray-400">
                            平均变化: {item.avgBidChange?.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-white">
                          {item.count} 次调整
                        </p>
                        <p className="text-sm text-gray-400">
                          成功率: {item.successRate?.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  ))}
                  {(!byTypeAnalysis || byTypeAnalysis.length === 0) && (
                    <div className="text-center py-8 text-gray-400">
                      暂无执行记录
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 出价调整历史列表 */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">最近出价调整记录</CardTitle>
            <CardDescription>
              显示最近的出价调整详情
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">时间</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">广告活动</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">关键词</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">调整类型</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium">原出价</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium">新出价</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium">变化</th>
                    <th className="text-center py-3 px-4 text-gray-400 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {(bidHistory?.records || []).slice(0, 20).map((record: any, index: number) => (
                    <tr key={index} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-3 px-4 text-gray-300">
                        {record.appliedAt ? format(new Date(record.appliedAt), "MM/dd HH:mm") : '-'}
                      </td>
                      <td className="py-3 px-4 text-white">{record.campaignName || '-'}</td>
                      <td className="py-3 px-4 text-gray-300">{record.keywordText || '-'}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className={
                          record.adjustmentType === 'auto_optimal' ? 'border-blue-500 text-blue-400' :
                          record.adjustmentType === 'auto_dayparting' ? 'border-purple-500 text-purple-400' :
                          record.adjustmentType === 'auto_placement' ? 'border-orange-500 text-orange-400' :
                          'border-gray-500 text-gray-400'
                        }>
                          {record.adjustmentType === 'auto_optimal' ? '最优出价' :
                           record.adjustmentType === 'auto_dayparting' ? '分时调整' :
                           record.adjustmentType === 'auto_placement' ? '位置优化' :
                           record.adjustmentType === 'manual' ? '手动调整' : record.adjustmentType}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right text-gray-300">${parseFloat(record.previousBid || 0).toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-white">${parseFloat(record.newBid || 0).toFixed(2)}</td>
                      <td className="py-3 px-4 text-right">
                        <span className={parseFloat(record.bidChangePercent || 0) > 0 ? 'text-green-400' : 'text-red-400'}>
                          {parseFloat(record.bidChangePercent || 0) > 0 ? '+' : ''}{parseFloat(record.bidChangePercent || 0).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant={record.status === 'applied' ? 'default' : record.status === 'rolled_back' ? 'destructive' : 'secondary'}>
                          {record.status === 'applied' ? '已应用' :
                           record.status === 'rolled_back' ? '已回滚' :
                           record.status === 'pending' ? '待执行' : record.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!bidHistory?.records || bidHistory.records.length === 0) && (
                <div className="text-center py-8 text-gray-400">
                  暂无出价调整记录
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
