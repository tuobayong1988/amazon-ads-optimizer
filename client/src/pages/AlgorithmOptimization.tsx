import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Settings,
  BarChart3,
  Target,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Loader2,
  Lightbulb,
  Sliders,
  ArrowRight,
  Info,
  Zap
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// 优先级颜色映射
const priorityColors: Record<string, string> = {
  low: 'bg-gray-500/10 text-gray-600 border-gray-200',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-200',
  high: 'bg-orange-500/10 text-orange-600 border-orange-200',
  critical: 'bg-red-500/10 text-red-600 border-red-200',
};

// 类别图标映射
const categoryIcons: Record<string, any> = {
  parameter: Sliders,
  strategy: Target,
  targeting: TrendingUp,
  timing: RefreshCw,
};

export default function AlgorithmOptimization() {
  const [activeTab, setActiveTab] = useState('overview');
  const [days, setDays] = useState(30);
  const [parametersDialogOpen, setParametersDialogOpen] = useState(false);

  // 获取算法参数
  const { data: parameters, refetch: refetchParameters } = trpc.algorithmOptimization.getParameters.useQuery();

  // 获取性能指标
  const { data: performance, isLoading: performanceLoading } = trpc.algorithmOptimization.getPerformance.useQuery({ days });

  // 获取按类型分析
  const { data: byType, isLoading: byTypeLoading } = trpc.algorithmOptimization.analyzeByType.useQuery({ days });

  // 获取按幅度分析
  const { data: byRange, isLoading: byRangeLoading } = trpc.algorithmOptimization.analyzeByRange.useQuery({ days });

  // 获取优化建议
  const { data: suggestions, isLoading: suggestionsLoading } = trpc.algorithmOptimization.getSuggestions.useQuery({ days });

  // 获取参数调优建议
  const { data: parameterTuning } = trpc.algorithmOptimization.getParameterTuning.useQuery({ days });

  // 更新参数
  const updateParametersMutation = trpc.algorithmOptimization.updateParameters.useMutation({
    onSuccess: () => {
      toast.success('参数更新成功');
      refetchParameters();
      setParametersDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  // 重置参数
  const resetParametersMutation = trpc.algorithmOptimization.resetParameters.useMutation({
    onSuccess: () => {
      toast.success('参数已重置为默认值');
      refetchParameters();
    },
    onError: (error) => {
      toast.error(`重置失败: ${error.message}`);
    },
  });

  // 参数表单状态
  const [parameterForm, setParameterForm] = useState<any>(null);

  const openParametersDialog = () => {
    setParameterForm(parameters ? { ...parameters } : null);
    setParametersDialogOpen(true);
  };

  const handleSaveParameters = () => {
    if (!parameterForm) return;
    updateParametersMutation.mutate(parameterForm);
  };

  // 格式化百分比
  const formatPercent = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '-';
    return `${value.toFixed(1)}%`;
  };

  // 格式化金额
  const formatMoney = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '-';
    return `$${value.toFixed(2)}`;
  };

  // 获取准确率颜色
  const getAccuracyColor = (accuracy: number | null | undefined) => {
    if (accuracy === null || accuracy === undefined) return 'text-muted-foreground';
    if (accuracy >= 80) return 'text-green-600';
    if (accuracy >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="w-6 h-6 text-purple-500" />
              算法优化建议
            </h1>
            <p className="text-muted-foreground mt-1">
              根据历史准确率数据，提供出价算法参数调优建议
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">最近7天</SelectItem>
                <SelectItem value="14">最近14天</SelectItem>
                <SelectItem value="30">最近30天</SelectItem>
                <SelectItem value="60">最近60天</SelectItem>
                <SelectItem value="90">最近90天</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={openParametersDialog}>
              <Settings className="w-4 h-4 mr-2" />
              参数配置
            </Button>
          </div>
        </div>

        {/* 性能概览卡片 */}
        {performance && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">总调整数</p>
                    <p className="text-2xl font-bold">{performance.totalAdjustments}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      追踪率: {formatPercent(performance.trackingRate)}
                    </p>
                  </div>
                  <BarChart3 className="w-8 h-8 text-blue-500/20" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">7天准确率</p>
                    <p className={`text-2xl font-bold ${getAccuracyColor(performance.accuracy7d)}`}>
                      {formatPercent(performance.accuracy7d)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      方向准确率: {formatPercent(performance.directionAccuracy7d)}
                    </p>
                  </div>
                  <Target className="w-8 h-8 text-green-500/20" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">预估总利润</p>
                    <p className="text-2xl font-bold">{formatMoney(performance.totalEstimatedProfit)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      实际(7d): {formatMoney(performance.totalActualProfit7d)}
                    </p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-purple-500/20" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">平均误差 (MAE)</p>
                    <p className="text-2xl font-bold">{formatMoney(performance.mae7d)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      RMSE: {formatMoney(performance.rmse7d)}
                    </p>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-orange-500/20" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              优化建议
              {suggestions && suggestions.length > 0 && (
                <Badge variant="secondary" className="ml-1">{suggestions.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="analysis" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              性能分析
            </TabsTrigger>
            <TabsTrigger value="parameters" className="flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              参数调优
            </TabsTrigger>
          </TabsList>

          {/* 优化建议 */}
          <TabsContent value="overview" className="space-y-4">
            {suggestionsLoading ? (
              <Card>
                <CardContent className="py-8">
                  <div className="flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            ) : suggestions?.length === 0 ? (
              <Card>
                <CardContent className="py-8">
                  <div className="text-center text-muted-foreground">
                    <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500/50" />
                    <p>算法表现良好，暂无优化建议</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {suggestions?.map((suggestion: any) => {
                  const CategoryIcon = categoryIcons[suggestion.category] || Lightbulb;
                  return (
                    <Card key={suggestion.id} className={`border-l-4 ${priorityColors[suggestion.priority]}`}>
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-4">
                          <div className={`p-2 rounded-lg ${priorityColors[suggestion.priority]}`}>
                            <CategoryIcon className="w-5 h-5" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-medium">{suggestion.title}</h3>
                              <Badge className={priorityColors[suggestion.priority]}>
                                {suggestion.priority === 'critical' ? '紧急' :
                                 suggestion.priority === 'high' ? '高' :
                                 suggestion.priority === 'medium' ? '中' : '低'}
                              </Badge>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Badge variant="outline" className="text-xs">
                                      置信度 {suggestion.confidence}%
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{suggestion.basedOn}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                            <p className="text-sm text-muted-foreground mb-3">{suggestion.description}</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                              {suggestion.currentValue && (
                                <div className="bg-muted/50 rounded-lg p-2">
                                  <p className="text-xs text-muted-foreground">当前值</p>
                                  <p className="font-medium">{suggestion.currentValue}</p>
                                </div>
                              )}
                              {suggestion.suggestedValue && (
                                <div className="bg-muted/50 rounded-lg p-2">
                                  <p className="text-xs text-muted-foreground">建议值</p>
                                  <p className="font-medium text-green-600">{suggestion.suggestedValue}</p>
                                </div>
                              )}
                              <div className="bg-muted/50 rounded-lg p-2">
                                <p className="text-xs text-muted-foreground">预期改善</p>
                                <p className="font-medium">{suggestion.expectedImprovement}</p>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-3">
                              <Info className="w-3 h-3 inline mr-1" />
                              影响: {suggestion.impact}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* 性能分析 */}
          <TabsContent value="analysis" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 按调整类型分析 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">按调整类型分析</CardTitle>
                  <CardDescription>不同类型调整的效果对比</CardDescription>
                </CardHeader>
                <CardContent>
                  {byTypeLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : byType?.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      暂无数据
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {byType?.map((item: any) => (
                        <div key={item.value} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{item.value}</span>
                            <span className="text-sm text-muted-foreground">{item.count}次</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Progress value={item.accuracy} className="flex-1" />
                            <span className={`text-sm font-medium w-16 text-right ${getAccuracyColor(item.accuracy)}`}>
                              {item.accuracy.toFixed(1)}%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{item.recommendation}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 按出价幅度分析 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">按出价幅度分析</CardTitle>
                  <CardDescription>不同调整幅度的效果对比</CardDescription>
                </CardHeader>
                <CardContent>
                  {byRangeLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : byRange?.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      暂无数据
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {byRange?.map((item: any) => (
                        <div key={item.value} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{item.value}</span>
                            <span className="text-sm text-muted-foreground">{item.count}次</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Progress value={item.accuracy} className="flex-1" />
                            <span className={`text-sm font-medium w-16 text-right ${getAccuracyColor(item.accuracy)}`}>
                              {item.accuracy.toFixed(1)}%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{item.recommendation}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* 准确率趋势 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">准确率对比</CardTitle>
                <CardDescription>不同追踪周期的准确率对比</CardDescription>
              </CardHeader>
              <CardContent>
                {performance ? (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">7天准确率</p>
                      <p className={`text-3xl font-bold ${getAccuracyColor(performance.accuracy7d)}`}>
                        {formatPercent(performance.accuracy7d)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        MAE: {formatMoney(performance.mae7d)}
                      </p>
                    </div>
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">14天准确率</p>
                      <p className={`text-3xl font-bold ${getAccuracyColor(performance.accuracy14d)}`}>
                        {formatPercent(performance.accuracy14d)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        MAE: {formatMoney(performance.mae14d)}
                      </p>
                    </div>
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">30天准确率</p>
                      <p className={`text-3xl font-bold ${getAccuracyColor(performance.accuracy30d)}`}>
                        {formatPercent(performance.accuracy30d)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        MAE: {formatMoney(performance.mae30d)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 参数调优 */}
          <TabsContent value="parameters" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 当前参数 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">当前算法参数</CardTitle>
                  <CardDescription>出价优化算法的核心参数配置</CardDescription>
                </CardHeader>
                <CardContent>
                  {parameters ? (
                    <div className="space-y-3">
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">最大提价幅度</span>
                        <span className="font-medium">{parameters.maxBidIncreasePercent}%</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">最大降价幅度</span>
                        <span className="font-medium">{parameters.maxBidDecreasePercent}%</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">最小调整幅度</span>
                        <span className="font-medium">{parameters.minBidChangePercent}%</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">利润率</span>
                        <span className="font-medium">{parameters.profitMarginPercent}%</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">每日最大调整数</span>
                        <span className="font-medium">{parameters.maxDailyAdjustments}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">冷却期</span>
                        <span className="font-medium">{parameters.cooldownPeriodHours}小时</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">最小置信度</span>
                        <span className="font-medium">{parameters.minConfidenceThreshold}%</span>
                      </div>
                      <div className="flex justify-between py-2">
                        <span className="text-sm text-muted-foreground">最小数据点</span>
                        <span className="font-medium">{parameters.minDataPoints}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 参数调优建议 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">参数调优建议</CardTitle>
                  <CardDescription>基于历史数据的参数优化建议</CardDescription>
                </CardHeader>
                <CardContent>
                  {parameterTuning?.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500/50" />
                      <p>当前参数配置合理，暂无调优建议</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {parameterTuning?.map((item: any, index: number) => (
                        <div key={index} className="bg-muted/30 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Zap className="w-4 h-4 text-yellow-500" />
                            <span className="font-medium">{item.parameter}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm mb-2">
                            <span className="text-muted-foreground">当前: {item.current}</span>
                            <ArrowRight className="w-4 h-4" />
                            <span className="text-green-600 font-medium">建议: {item.suggested}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{item.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* 参数配置对话框 */}
      <Dialog open={parametersDialogOpen} onOpenChange={setParametersDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>算法参数配置</DialogTitle>
            <DialogDescription>
              调整出价优化算法的核心参数
            </DialogDescription>
          </DialogHeader>
          {parameterForm && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>最大提价幅度 (%)</Label>
                  <Input
                    type="number"
                    value={parameterForm.maxBidIncreasePercent}
                    onChange={(e) => setParameterForm({ ...parameterForm, maxBidIncreasePercent: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>最大降价幅度 (%)</Label>
                  <Input
                    type="number"
                    value={parameterForm.maxBidDecreasePercent}
                    onChange={(e) => setParameterForm({ ...parameterForm, maxBidDecreasePercent: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>最小调整幅度 (%)</Label>
                  <Input
                    type="number"
                    value={parameterForm.minBidChangePercent}
                    onChange={(e) => setParameterForm({ ...parameterForm, minBidChangePercent: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>利润率 (%)</Label>
                  <Input
                    type="number"
                    value={parameterForm.profitMarginPercent}
                    onChange={(e) => setParameterForm({ ...parameterForm, profitMarginPercent: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>转化价值乘数</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={parameterForm.conversionValueMultiplier}
                    onChange={(e) => setParameterForm({ ...parameterForm, conversionValueMultiplier: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>每日最大调整数</Label>
                  <Input
                    type="number"
                    value={parameterForm.maxDailyAdjustments}
                    onChange={(e) => setParameterForm({ ...parameterForm, maxDailyAdjustments: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>冷却期 (小时)</Label>
                  <Input
                    type="number"
                    value={parameterForm.cooldownPeriodHours}
                    onChange={(e) => setParameterForm({ ...parameterForm, cooldownPeriodHours: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>最小置信度 (%)</Label>
                  <Input
                    type="number"
                    value={parameterForm.minConfidenceThreshold}
                    onChange={(e) => setParameterForm({ ...parameterForm, minConfidenceThreshold: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>最小数据点</Label>
                <Input
                  type="number"
                  value={parameterForm.minDataPoints}
                  onChange={(e) => setParameterForm({ ...parameterForm, minDataPoints: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => resetParametersMutation.mutate()}
              disabled={resetParametersMutation.isPending}
            >
              重置为默认
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setParametersDialogOpen(false)}>
                取消
              </Button>
              <Button
                onClick={handleSaveParameters}
                disabled={updateParametersMutation.isPending}
              >
                {updateParametersMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                保存
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
