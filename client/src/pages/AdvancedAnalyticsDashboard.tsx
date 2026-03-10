/**
 * AdvancedAnalyticsDashboard - 高级分析仪表盘
 * 基于统一事件模型的下一代分析功能：归因分析、趋势分析、异常检测、策略ROI对比
 */
import { useState, useMemo, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useGlobalAccountId } from "@/hooks/useGlobalAccountId";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, ComposedChart, Area,
  ScatterChart, Scatter, Cell, ReferenceLine,
} from "recharts";
import {
  TrendingUp, TrendingDown, Target, DollarSign, Percent, Activity,
  ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle, XCircle,
  Brain, Zap, BarChart3, Search, RefreshCw, ChevronRight, Minus,
  AlertCircle, Info, Award, ThumbsUp, ThumbsDown,
} from "lucide-react";
import { toast } from "sonner";

export default function AdvancedAnalyticsDashboard() {
  // v399: 默认值跟随全局选择器
  const { accountId: globalAccountId } = useGlobalAccountId();
  const [selectedAccount, setSelectedAccount] = useState<string>(globalAccountId?.toString() || "all");
  useEffect(() => {
    if (globalAccountId) setSelectedAccount(globalAccountId.toString());
  }, [globalAccountId]);
  const [timeRange, setTimeRange] = useState("30");
  const [activeTab, setActiveTab] = useState("overview");
  const [attributionPage, setAttributionPage] = useState(0);
  const [roiGroupBy, setRoiGroupBy] = useState<"strategy" | "actionType" | "eventCategory">("strategy");

  const { data: accounts } = trpc.adAccount.list.useQuery() as any;
  const accountId = selectedAccount === "all" ? undefined : parseInt(selectedAccount);

  // 高级分析汇总
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = trpc.advancedAnalytics.getSummary.useQuery(
    { accountId, days: parseInt(timeRange) },
    { enabled: true }
  );

  // 归因分析
  const { data: attribution, isLoading: attributionLoading } = trpc.advancedAnalytics.getAttribution.useQuery(
    { accountId, days: parseInt(timeRange), limit: 10, offset: attributionPage * 10 },
    { enabled: activeTab === "attribution" || activeTab === "overview" }
  );

  // 趋势分析
  const { data: trends, isLoading: trendsLoading } = trpc.advancedAnalytics.getTrendAnalysis.useQuery(
    { accountId: accountId || (accounts?.[0]?.id ?? 0), days: parseInt(timeRange) },
    { enabled: (activeTab === "trends" || activeTab === "overview") && !!(accountId || accounts?.[0]?.id) }
  );

  // 异常检测
  const { data: anomalies, isLoading: anomaliesLoading } = trpc.advancedAnalytics.getAnomalies.useQuery(
    { accountId: accountId || (accounts?.[0]?.id ?? 0), days: parseInt(timeRange) },
    { enabled: (activeTab === "anomalies" || activeTab === "overview") && !!(accountId || accounts?.[0]?.id) }
  );

  // 策略ROI
  const { data: strategyROI, isLoading: roiLoading } = trpc.advancedAnalytics.getStrategyROI.useQuery(
    { accountId, days: parseInt(timeRange), groupBy: roiGroupBy },
    { enabled: activeTab === "roi" || activeTab === "overview" }
  );

  // 手动触发效果追踪
  const triggerTracking = trpc.advancedAnalytics.triggerEffectTracking.useMutation({
    onSuccess: (data) => {
      toast.success(`效果追踪完成: 7天=${data.results.day7}, 14天=${data.results.day14}, 30天=${data.results.day30}`);
      refetchSummary();
    },
    onError: (err) => toast.error(`追踪失败: ${err.message}`),
  });

  const effectRatingConfig = {
    excellent: { color: "text-emerald-600", bg: "bg-emerald-50", icon: Award, label: "优秀" },
    good: { color: "text-blue-600", bg: "bg-blue-50", icon: ThumbsUp, label: "良好" },
    neutral: { color: "text-gray-600", bg: "bg-gray-50", icon: Minus, label: "中性" },
    poor: { color: "text-orange-600", bg: "bg-orange-50", icon: ThumbsDown, label: "较差" },
    harmful: { color: "text-red-600", bg: "bg-red-50", icon: XCircle, label: "有害" },
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* 页面标题和控制栏 */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">高级分析仪表盘</h1>
            <p className="text-muted-foreground text-sm mt-1">
              基于统一事件模型的深度分析 — 归因分析 · 趋势洞察 · 异常检测 · 策略评估
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="选择账户" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部账户</SelectItem>
                {accounts?.map((acc: any) => (
                  <SelectItem key={acc.id} value={String(acc.id)}>{acc.accountName || `账户 ${acc.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[120px]">
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
            <Button variant="outline" size="sm" onClick={() => triggerTracking.mutate()} disabled={triggerTracking.isPending}>
              <RefreshCw className={`h-4 w-4 mr-1 ${triggerTracking.isPending ? 'animate-spin' : ''}`} />
              追踪效果
            </Button>
          </div>
        </div>

        {/* 概览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">优化事件总数</p>
                  <p className="text-2xl font-bold mt-1">{summary?.totalOptimizationEvents?.toLocaleString() || 0}</p>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg"><Activity className="h-5 w-5 text-blue-600" /></div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                其中出价调整 {summary?.totalBidAdjustments?.toLocaleString() || 0} 次
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">执行成功率</p>
                  <p className="text-2xl font-bold mt-1">{summary?.overallSuccessRate || 0}%</p>
                </div>
                <div className="p-2 bg-emerald-50 rounded-lg"><CheckCircle className="h-5 w-5 text-emerald-600" /></div>
              </div>
              <Progress value={summary?.overallSuccessRate || 0} className="mt-2 h-1.5" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">正面效果占比</p>
                  <p className="text-2xl font-bold mt-1">{summary?.positiveEffectRate || 0}%</p>
                </div>
                <div className="p-2 bg-amber-50 rounded-lg"><TrendingUp className="h-5 w-5 text-amber-600" /></div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                已追踪事件中产生正面效果的占比
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">活跃异常</p>
                  <p className="text-2xl font-bold mt-1">
                    {summary?.activeAnomalies || 0}
                    {(summary?.criticalAnomalies || 0) > 0 && (
                      <span className="text-sm text-red-500 ml-1">({summary?.criticalAnomalies} 严重)</span>
                    )}
                  </p>
                </div>
                <div className={`p-2 rounded-lg ${(summary?.criticalAnomalies || 0) > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                  <AlertTriangle className={`h-5 w-5 ${(summary?.criticalAnomalies || 0) > 0 ? 'text-red-600' : 'text-gray-400'}`} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {summary?.bestStrategyName ? `最佳策略: ${summary.bestStrategyName}` : '暂无策略数据'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 主Tab内容 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="attribution" className="gap-1"><Search className="h-3.5 w-3.5" />归因分析</TabsTrigger>
            <TabsTrigger value="trends" className="gap-1"><TrendingUp className="h-3.5 w-3.5" />趋势洞察</TabsTrigger>
            <TabsTrigger value="anomalies" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" />异常检测</TabsTrigger>
            <TabsTrigger value="roi" className="gap-1"><BarChart3 className="h-3.5 w-3.5" />策略评估</TabsTrigger>
          </TabsList>

          {/* ==================== 归因分析 Tab ==================== */}
          <TabsContent value="attribution" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">优化效果归因分析</CardTitle>
                <CardDescription>
                  将每次优化操作与其前后7天的广告效果进行对比，量化操作的实际影响
                </CardDescription>
              </CardHeader>
              <CardContent>
                {attributionLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mr-2" />加载归因数据...
                  </div>
                ) : attribution?.results && attribution.results.length > 0 ? (
                  <div className="space-y-4">
                    {/* 归因效果分布图 */}
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={attribution.results.map((r: any) => ({
                          name: r.keywordText?.slice(0, 15) || r.campaignName?.slice(0, 15) || `#${r.eventId}`,
                          score: r.effectScore,
                          deltaSales: r.deltaSales,
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                          <YAxis />
                          <Tooltip formatter={((value: number, name: string) => [
                            name === 'score' ? `${value}分` : `$${value.toFixed(2)}`,
                            name === 'score' ? '效果评分' : '销售额变化'
                          ]) as any} />
                          <Bar dataKey="score" name="效果评分">
                            {attribution.results.map((entry: any, index: number) => (
                              <Cell key={index} fill={entry.effectScore >= 10 ? '#10b981' : entry.effectScore >= -10 ? '#6b7280' : '#ef4444'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* 归因详情表格 */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="p-2 text-left font-medium">操作详情</th>
                            <th className="p-2 text-center font-medium">出价变化</th>
                            <th className="p-2 text-center font-medium">基线ACoS</th>
                            <th className="p-2 text-center font-medium">效果ACoS</th>
                            <th className="p-2 text-center font-medium">销售额变化</th>
                            <th className="p-2 text-center font-medium">花费变化</th>
                            <th className="p-2 text-center font-medium">效果评级</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attribution.results.map((r: any) => {
                            const config = effectRatingConfig[r.effectRating as keyof typeof effectRatingConfig];
                            const Icon = config?.icon || Minus;
                            return (
                              <tr key={r.eventId} className="border-b hover:bg-muted/30">
                                <td className="p-2">
                                  <div className="font-medium text-xs">{r.keywordText || r.campaignName || `事件 #${r.eventId}`}</div>
                                  <div className="text-xs text-muted-foreground">{r.changeReason?.slice(0, 50) || r.actionType}</div>
                                  <div className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString('zh-CN')}</div>
                                </td>
                                <td className="p-2 text-center tabular-nums">
                                  {r.previousBid && r.newBid ? (
                                    <span className={parseFloat(r.bidChangePercent || '0') > 0 ? 'text-red-600' : 'text-green-600'}>
                                      ${r.previousBid} → ${r.newBid}
                                    </span>
                                  ) : '-'}
                                </td>
                                <td className="p-2 text-center tabular-nums">{r.baselineAcos.toFixed(1)}%</td>
                                <td className="p-2 text-center tabular-nums">
                                  <span className={r.deltaAcos < 0 ? 'text-green-600' : r.deltaAcos > 0 ? 'text-red-600' : ''}>
                                    {r.postAcos.toFixed(1)}%
                                  </span>
                                </td>
                                <td className="p-2 text-center tabular-nums">
                                  <span className={r.deltaSales > 0 ? 'text-green-600' : r.deltaSales < 0 ? 'text-red-600' : ''}>
                                    {r.deltaSales >= 0 ? '+' : ''}{r.deltaSales.toFixed(2)}
                                  </span>
                                </td>
                                <td className="p-2 text-center tabular-nums">
                                  <span className={r.deltaSpend < 0 ? 'text-green-600' : r.deltaSpend > 0 ? 'text-orange-600' : ''}>
                                    {r.deltaSpend >= 0 ? '+' : ''}{r.deltaSpend.toFixed(2)}
                                  </span>
                                </td>
                                <td className="p-2 text-center">
                                  <Badge variant="outline" className={`${config?.bg} ${config?.color} border-0 text-xs`}>
                                    <Icon className="h-3 w-3 mr-1" />
                                    {config?.label} ({r.effectScore})
                                  </Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    
                    {/* 分页 */}
                    {attribution.total > 10 && (
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                          共 {attribution.total} 条记录，当前第 {attributionPage + 1} 页
                        </p>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" disabled={attributionPage === 0}
                            onClick={() => setAttributionPage(p => p - 1)}>上一页</Button>
                          <Button variant="outline" size="sm" disabled={(attributionPage + 1) * 10 >= attribution.total}
                            onClick={() => setAttributionPage(p => p + 1)}>下一页</Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>暂无归因分析数据</p>
                    <p className="text-xs mt-1">请确保已选择账户并有足够的优化事件和广告效果数据</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ==================== 趋势洞察 Tab ==================== */}
          <TabsContent value="trends" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">关键指标趋势分析</CardTitle>
                <CardDescription>
                  自动识别核心广告指标的趋势方向和变化强度，辅以7日移动平均线消除噪声
                </CardDescription>
              </CardHeader>
              <CardContent>
                {trendsLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mr-2" />分析趋势数据...
                  </div>
                ) : trends && trends.length > 0 ? (
                  <div className="space-y-6">
                    {/* 趋势摘要卡片 */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {trends.map((t: any) => (
                        <div key={t.metric} className="p-3 rounded-lg border">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-muted-foreground">{t.metricLabel}</span>
                            {t.direction === 'up' ? (
                              <ArrowUpRight className={`h-4 w-4 ${t.metric === 'acos' ? 'text-red-500' : 'text-green-500'}`} />
                            ) : t.direction === 'down' ? (
                              <ArrowDownRight className={`h-4 w-4 ${t.metric === 'acos' ? 'text-green-500' : 'text-red-500'}`} />
                            ) : (
                              <Minus className="h-4 w-4 text-gray-400" />
                            )}
                          </div>
                          <p className={`text-lg font-bold ${
                            t.direction === 'stable' ? 'text-gray-600' :
                            (t.metric === 'acos' ? (t.direction === 'down' ? 'text-green-600' : 'text-red-600') :
                            (t.direction === 'up' ? 'text-green-600' : 'text-red-600'))
                          }`}>
                            {t.changePercent >= 0 ? '+' : ''}{t.changePercent.toFixed(1)}%
                          </p>
                          <Badge variant="outline" className="text-[10px] mt-1">
                            {t.trendStrength === 'strong' ? '强趋势' : t.trendStrength === 'moderate' ? '中等趋势' : '弱趋势'}
                          </Badge>
                        </div>
                      ))}
                    </div>

                    {/* 趋势图表 */}
                    {trends.map((t: any) => (
                      <div key={t.metric} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-medium text-sm">{t.metricLabel} 趋势</h4>
                          <Badge variant={t.direction === 'up' ? 'default' : t.direction === 'down' ? 'destructive' : 'secondary'}>
                            {t.direction === 'up' ? '上升' : t.direction === 'down' ? '下降' : '稳定'} {Math.abs(t.changePercent).toFixed(1)}%
                          </Badge>
                        </div>
                        <div className="h-[180px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={t.dataPoints}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 10 }} />
                              <Tooltip />
                              <Area type="monotone" dataKey="value" name={t.metricLabel} fill="#3b82f620" stroke="#3b82f6" strokeWidth={1.5} />
                              {t.movingAverage.length > 0 && (
                                <Line type="monotone" data={t.movingAverage} dataKey="value" name="7日均线" stroke="#f97316" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                              )}
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>暂无趋势数据</p>
                    <p className="text-xs mt-1">请选择一个具体账户以查看趋势分析</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ==================== 异常检测 Tab ==================== */}
          <TabsContent value="anomalies" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">智能异常检测</CardTitle>
                <CardDescription>
                  基于统计学方法自动识别广告指标的异常波动，并追溯可能的优化操作原因
                </CardDescription>
              </CardHeader>
              <CardContent>
                {anomaliesLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mr-2" />检测异常数据...
                  </div>
                ) : anomalies && anomalies.length > 0 ? (
                  <div className="space-y-3">
                    {anomalies.map((a: any) => (
                      <div key={a.id} className={`border rounded-lg p-4 ${
                        a.severity === 'critical' ? 'border-red-200 bg-red-50/50' :
                        a.severity === 'warning' ? 'border-amber-200 bg-amber-50/50' :
                        'border-blue-200 bg-blue-50/50'
                      }`}>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            {a.severity === 'critical' ? (
                              <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                            ) : a.severity === 'warning' ? (
                              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                            ) : (
                              <Info className="h-5 w-5 text-blue-500 shrink-0" />
                            )}
                            <div>
                              <p className="font-medium text-sm">
                                {a.metricLabel} {a.direction === 'spike' ? '异常飙升' : '异常下跌'}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {a.date} · 实际值: {a.actualValue.toFixed(2)} · 预期值: {a.expectedValue.toFixed(2)} · 偏差: {a.deviationPercent >= 0 ? '+' : ''}{a.deviationPercent.toFixed(1)}%
                              </p>
                            </div>
                          </div>
                          <Badge variant={a.severity === 'critical' ? 'destructive' : a.severity === 'warning' ? 'default' : 'secondary'}>
                            {a.severity === 'critical' ? '严重' : a.severity === 'warning' ? '警告' : '提示'}
                          </Badge>
                        </div>
                        
                        {/* 可能原因 */}
                        {a.possibleCauses && a.possibleCauses.length > 0 && (
                          <div className="mt-3 pl-7">
                            <p className="text-xs font-medium text-muted-foreground mb-1.5">可能原因：</p>
                            <div className="space-y-1.5">
                              {a.possibleCauses.slice(0, 3).map((cause: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2 text-xs">
                                  <div className="w-1.5 h-1.5 rounded-full bg-current shrink-0" style={{ opacity: cause.confidence / 100 }} />
                                  <span className="flex-1">{cause.description}</span>
                                  <Badge variant="outline" className="text-[10px]">置信度 {cause.confidence}%</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-400" />
                    <p>未检测到异常</p>
                    <p className="text-xs mt-1">所有指标均在正常范围内波动</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ==================== 策略评估 Tab ==================== */}
          <TabsContent value="roi" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">策略ROI对比评估</CardTitle>
                    <CardDescription>
                      按不同维度对比各优化策略的投资回报率，帮助识别最有效的策略
                    </CardDescription>
                  </div>
                  <Select value={roiGroupBy} onValueChange={(v: any) => setRoiGroupBy(v)}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strategy">按策略模板</SelectItem>
                      <SelectItem value="actionType">按操作类型</SelectItem>
                      <SelectItem value="eventCategory">按事件类别</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {roiLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mr-2" />计算策略ROI...
                  </div>
                ) : strategyROI && strategyROI.length > 0 ? (
                  <div className="space-y-6">
                    {/* ROI排行榜图表 */}
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={strategyROI.slice(0, 10).map((s: any) => ({
                          name: s.strategyName.length > 12 ? s.strategyName.slice(0, 12) + '...' : s.strategyName,
                          events: s.totalEvents,
                          successRate: s.successRate,
                          roi7D: s.roi7D || 0,
                        }))} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" />
                          <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={((value: number, name: string) => [
                            name === 'events' ? value : `${value.toFixed(1)}%`,
                            name === 'events' ? '事件数' : name === 'successRate' ? '成功率' : '7天ROI'
                          ]) as any} />
                          <Legend />
                          <Bar dataKey="events" name="事件数" fill="#3b82f6" />
                          <Bar dataKey="successRate" name="成功率%" fill="#10b981" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* ROI详情表格 */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="p-2 text-left font-medium">策略名称</th>
                            <th className="p-2 text-center font-medium">事件数</th>
                            <th className="p-2 text-center font-medium">成功率</th>
                            <th className="p-2 text-center font-medium">平均出价变化</th>
                            <th className="p-2 text-center font-medium">预估利润</th>
                            <th className="p-2 text-center font-medium">实际利润(7D)</th>
                            <th className="p-2 text-center font-medium">利润准确率</th>
                            <th className="p-2 text-center font-medium">每日频率</th>
                          </tr>
                        </thead>
                        <tbody>
                          {strategyROI.map((s: any, idx: number) => (
                            <tr key={idx} className="border-b hover:bg-muted/30">
                              <td className="p-2">
                                <div className="font-medium text-xs">{s.strategyName}</div>
                                {s.firstEventDate && (
                                  <div className="text-[10px] text-muted-foreground">
                                    {new Date(s.firstEventDate).toLocaleDateString('zh-CN')} ~ {new Date(s.lastEventDate).toLocaleDateString('zh-CN')}
                                  </div>
                                )}
                              </td>
                              <td className="p-2 text-center tabular-nums">{s.totalEvents}</td>
                              <td className="p-2 text-center">
                                <Badge variant={s.successRate >= 80 ? 'default' : s.successRate >= 50 ? 'secondary' : 'destructive'} className="text-xs">
                                  {s.successRate}%
                                </Badge>
                              </td>
                              <td className="p-2 text-center tabular-nums">
                                <span className={s.avgBidChange > 0 ? 'text-red-600' : s.avgBidChange < 0 ? 'text-green-600' : ''}>
                                  {s.avgBidChange >= 0 ? '+' : ''}{s.avgBidChange.toFixed(1)}%
                                </span>
                              </td>
                              <td className="p-2 text-center tabular-nums">${s.totalEstimatedProfit.toFixed(2)}</td>
                              <td className="p-2 text-center tabular-nums">
                                <span className={s.totalActualProfit7D > 0 ? 'text-green-600' : s.totalActualProfit7D < 0 ? 'text-red-600' : ''}>
                                  ${s.totalActualProfit7D.toFixed(2)}
                                </span>
                              </td>
                              <td className="p-2 text-center tabular-nums">
                                {s.profitAccuracy !== null ? `${s.profitAccuracy.toFixed(1)}%` : '-'}
                              </td>
                              <td className="p-2 text-center tabular-nums">{s.avgEventsPerDay.toFixed(1)}/天</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>暂无策略ROI数据</p>
                    <p className="text-xs mt-1">需要有优化事件和效果追踪数据才能计算ROI</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
