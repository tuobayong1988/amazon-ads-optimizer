import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  Minus, 
  TrendingUp, 
  Target, 
  Settings, 
  Play, 
  History,
  RefreshCw,
  Info,
  CheckCircle2,
  AlertTriangle,
  Zap,
  BarChart3,
  Layers,
  Search,
  Package,
  List,
  Activity,
  ExternalLink
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// 位置类型映射
const PLACEMENT_LABELS: Record<string, { name: string; icon: React.ReactNode; description: string }> = {
  top_of_search: { 
    name: "搜索顶部", 
    icon: <Search className="h-4 w-4" />,
    description: "搜索结果页面顶部位置，通常转化率最高"
  },
  product_page: { 
    name: "商品详情页", 
    icon: <Package className="h-4 w-4" />,
    description: "商品详情页面的广告位置"
  },
  rest_of_search: { 
    name: "其他搜索位置", 
    icon: <List className="h-4 w-4" />,
    description: "搜索结果页面的其他位置（基准位置，无法调整）"
  },
};

// 置信度等级
function getConfidenceLevel(confidence: number): { level: string; color: string } {
  if (confidence >= 0.8) return { level: "高", color: "text-green-600" };
  if (confidence >= 0.5) return { level: "中", color: "text-yellow-600" };
  return { level: "低", color: "text-red-600" };
}

// 格式化百分比
function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}%`;
}

// 格式化货币
function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export default function PlacementOptimization() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState<any[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  
  // 设置状态
  const [autoOptimize, setAutoOptimize] = useState(true);
  const [optimizationGoal, setOptimizationGoal] = useState<string>("roas");
  const [targetAcos, setTargetAcos] = useState(30);
  const [targetRoas, setTargetRoas] = useState(3.5);
  const [adjustmentFrequency, setAdjustmentFrequency] = useState("every_2_hours");
  const [maxAdjustment, setMaxAdjustment] = useState(200);
  const [adjustmentStep, setAdjustmentStep] = useState(10);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 获取广告活动列表
  const { data: campaigns } = trpc.campaign.list.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // 获取位置表现数据
  const { data: performanceData, refetch: refetchPerformance } = trpc.placement.getPerformance.useQuery(
    { campaignId: selectedCampaignId!, accountId: selectedAccountId!, days: 7 },
    { enabled: !!selectedCampaignId && !!selectedAccountId }
  );

  // 获取当前设置
  const { data: currentSettings, refetch: refetchSettings } = trpc.placement.getSettings.useQuery(
    { campaignId: selectedCampaignId!, accountId: selectedAccountId! },
    { enabled: !!selectedCampaignId && !!selectedAccountId }
  );

  // 生成建议mutat ion
  const generateSuggestionsMutation = trpc.placement.generateSuggestions.useMutation({
    onSuccess: (data) => {
      setPendingSuggestions(data.suggestions);
      setAnalysisDialogOpen(true);
      setAnalysisLoading(false);
    },
    onError: (error) => {
      toast.error(`分析失败: ${error.message}`);
      setAnalysisLoading(false);
    },
  });
  // 应用调整mutation
  const applyAdjustmentsMutation = trpc.placement.applyAdjustments.useMutation({
    onSuccess: () => {
      toast.success("位置倾斜设置已更新");
      setConfirmDialogOpen(false);
      setAnalysisDialogOpen(false);
      setApplyLoading(false);
      refetchPerformance();
      refetchSettings();
    },
    onError: (error) => {
      toast.error(`调整失败: ${error.message}`);
      setApplyLoading(false);
    },
  });

  // 执行优化mutation
  const optimizeCampaignMutation = trpc.placement.optimizeCampaign.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
        refetchPerformance();
        refetchSettings();
      } else {
        toast.info(result.message);
      }
    },
    onError: (error) => {
      toast.error(`优化失败: ${error.message}`);
    },
  });

  // 批量优化mutation
  const batchOptimizeMutation = trpc.placement.batchOptimize.useMutation({
    onSuccess: (result) => {
      toast.success(`批量优化完成: 成功 ${result.success}个, 失败 ${result.failed}个`);
      refetchPerformance();
    },
    onError: (error) => {
      toast.error(`批量优化失败: ${error.message}`);
    },
  });

  // 处理分析按钮点击
  const handleAnalyze = () => {
    if (!selectedCampaignId || !selectedAccountId) {
      toast.error("请先选择广告活动");
      return;
    }
    setAnalysisLoading(true);
    generateSuggestionsMutation.mutate({
      campaignId: selectedCampaignId,
      accountId: selectedAccountId,
      days: 7,
    });
  };

  // 处理应用建议
  const handleApplySuggestions = () => {
    if (!selectedCampaignId || !selectedAccountId || pendingSuggestions.length === 0) return;
    setApplyLoading(true);
    applyAdjustmentsMutation.mutate({
      campaignId: selectedCampaignId,
      accountId: selectedAccountId,
      adjustments: pendingSuggestions,
    });
  };

  // 处理一键优化
  const handleOneClickOptimize = () => {
    if (!selectedCampaignId || !selectedAccountId) {
      toast.error("请先选择广告活动");
      return;
    }
    optimizeCampaignMutation.mutate({
      campaignId: selectedCampaignId,
      accountId: selectedAccountId,
    });
  };

  // 处理批量优化
  const handleBatchOptimize = () => {
    if (!selectedAccountId) {
      toast.error("请先选择账号");
      return;
    }
    batchOptimizeMutation.mutate({
      accountId: selectedAccountId,
    });
  };

  // 计算汇总数据
  const summaryData = useMemo(() => {
    if (!performanceData || performanceData.length === 0) {
      return {
        totalSpend: 0,
        totalSales: 0,
        avgRoas: 0,
        avgAcos: 0,
        bestPlacement: null,
      };
    }

    const totalSpend = performanceData.reduce((sum, p) => sum + (p.metrics?.spend || 0), 0);
    const totalSales = performanceData.reduce((sum, p) => sum + (p.metrics?.sales || 0), 0);
    const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
    
    const bestPlacement = performanceData.reduce((best, current) => {
      if (!best || (current.metrics?.roas || 0) > (best.metrics?.roas || 0)) {
        return current;
      }
      return best;
    }, null as any);

    return { totalSpend, totalSales, avgRoas, avgAcos, bestPlacement };
  }, [performanceData]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">广告位置智能倾斜</h1>
            <p className="text-muted-foreground">
              自动分析各广告位置的表现，智能调整出价倾斜比例以优化广告效果
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => window.location.href = '/marginal-benefit-analysis'}>
              <Activity className="h-4 w-4 mr-2" />
              边际效益分析
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
            <Button variant="outline" onClick={() => setSettingsDialogOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              优化设置
            </Button>
            <Button onClick={handleBatchOptimize} disabled={!selectedAccountId || batchOptimizeMutation.isPending}>
              <Zap className="h-4 w-4 mr-2" />
              批量优化
            </Button>
          </div>
        </div>

        {/* 选择器 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <div className="flex-1">
                <Label>选择账号</Label>
                <Select
                  value={selectedAccountId?.toString() || ""}
                  onValueChange={(value) => {
                    setSelectedAccountId(Number(value));
                    setSelectedCampaignId(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择账号" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.map((account) => (
                      <SelectItem key={account.id} value={account.id.toString()}>
                        {account.storeName || account.accountName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label>选择广告活动</Label>
                <Select
                  value={selectedCampaignId || ""}
                  onValueChange={(value) => setSelectedCampaignId(value)}
                  disabled={!selectedAccountId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择广告活动" />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns?.map((campaign) => (
                      <SelectItem key={campaign.campaignId} value={campaign.campaignId}>
                        {campaign.campaignName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button 
                  onClick={handleAnalyze} 
                  disabled={!selectedCampaignId || analysisLoading}
                >
                  {analysisLoading ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4 mr-2" />
                  )}
                  分析位置表现
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 位置表现概览 */}
        {selectedCampaignId && performanceData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 汇总卡片 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">总体表现</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">总花费</span>
                    <span className="font-medium">{formatCurrency(summaryData.totalSpend)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">总销售额</span>
                    <span className="font-medium">{formatCurrency(summaryData.totalSales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">平均ROAS</span>
                    <span className="font-medium">{summaryData.avgRoas.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">平均ACoS</span>
                    <span className="font-medium">{summaryData.avgAcos.toFixed(1)}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 最佳位置卡片 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">最佳表现位置</CardTitle>
              </CardHeader>
              <CardContent>
                {summaryData.bestPlacement ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      {PLACEMENT_LABELS[summaryData.bestPlacement.placementType]?.icon}
                      <span className="font-medium">
                        {PLACEMENT_LABELS[summaryData.bestPlacement.placementType]?.name}
                      </span>
                      <Badge variant="secondary">ROAS最高</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">ROAS: </span>
                        <span className="font-medium text-green-600">
                          {summaryData.bestPlacement.metrics?.roas?.toFixed(2) || "N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">ACoS: </span>
                        <span className="font-medium">
                          {summaryData.bestPlacement.metrics?.acos?.toFixed(1) || "N/A"}%
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {PLACEMENT_LABELS[summaryData.bestPlacement.placementType]?.description}
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">暂无数据</p>
                )}
              </CardContent>
            </Card>

            {/* 当前设置卡片 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">当前倾斜设置</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Search className="h-3 w-3" /> 搜索顶部
                    </span>
                    <Badge variant="outline">
                      {formatPercent(currentSettings?.top_of_search || 0)}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Package className="h-3 w-3" /> 商品详情页
                    </span>
                    <Badge variant="outline">
                      {formatPercent(currentSettings?.product_page || 0)}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <List className="h-3 w-3" /> 其他搜索位置
                    </span>
                    <Badge variant="secondary">基准</Badge>
                  </div>
                  <Button 
                    size="sm" 
                    className="w-full mt-2"
                    onClick={handleOneClickOptimize}
                    disabled={optimizeCampaignMutation.isPending}
                  >
                    {optimizeCampaignMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    一键优化
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 位置表现详情表格 */}
        {selectedCampaignId && performanceData && performanceData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                位置表现详情
              </CardTitle>
              <CardDescription>
                过去7天各广告位置的详细表现数据
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>位置</TableHead>
                    <TableHead className="text-right">展示</TableHead>
                    <TableHead className="text-right">点击</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">花费</TableHead>
                    <TableHead className="text-right">销售额</TableHead>
                    <TableHead className="text-right">订单</TableHead>
                    <TableHead className="text-right">CVR</TableHead>
                    <TableHead className="text-right">ACoS</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                    <TableHead className="text-right">效率评分</TableHead>
                    <TableHead className="text-right">当前倾斜</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performanceData.map((placement) => {
                    const metrics = placement.metrics;
                    const placementInfo = PLACEMENT_LABELS[placement.placementType];
                    const currentAdjustment = currentSettings?.[placement.placementType as keyof typeof currentSettings] || 0;
                    
                    return (
                      <TableRow key={placement.placementType}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {placementInfo?.icon}
                            <span className="font-medium">{placementInfo?.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {metrics?.impressions?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell className="text-right">
                          {metrics?.clicks?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell className="text-right">
                          {metrics?.ctr?.toFixed(2) || 0}%
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(metrics?.spend || 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(metrics?.sales || 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {metrics?.orders || 0}
                        </TableCell>
                        <TableCell className="text-right">
                          {metrics?.cvr?.toFixed(2) || 0}%
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={metrics?.acos > 30 ? "text-red-600" : "text-green-600"}>
                            {metrics?.acos?.toFixed(1) || 0}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={metrics?.roas >= 3 ? "text-green-600" : "text-yellow-600"}>
                            {metrics?.roas?.toFixed(2) || 0}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <div className="flex items-center justify-end gap-1">
                                  <Progress 
                                    value={placement.rawScore || 0} 
                                    className="w-16 h-2"
                                  />
                                  <span className="text-xs w-8">
                                    {(placement.rawScore || 0).toFixed(0)}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>效率评分: {(placement.rawScore || 0).toFixed(1)}/100</p>
                                <p className="text-xs text-muted-foreground">
                                  置信度: {((placement.confidence || 0) * 100).toFixed(0)}%
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell className="text-right">
                          {placement.placementType === 'rest_of_search' ? (
                            <Badge variant="secondary">基准</Badge>
                          ) : (
                            <Badge variant={currentAdjustment > 0 ? "default" : "outline"}>
                              {formatPercent(currentAdjustment)}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* 无数据提示 */}
        {selectedCampaignId && (!performanceData || performanceData.length === 0) && (
          <Card>
            <CardContent className="py-12 text-center">
              <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">暂无位置表现数据</h3>
              <p className="text-muted-foreground mb-4">
                该广告活动还没有足够的位置表现数据，请确保广告活动已运行一段时间
              </p>
              <Button variant="outline" onClick={() => refetchPerformance()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                刷新数据
              </Button>
            </CardContent>
          </Card>
        )}

        {/* 未选择广告活动提示 */}
        {!selectedCampaignId && (
          <Card>
            <CardContent className="py-12 text-center">
              <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">请选择广告活动</h3>
              <p className="text-muted-foreground">
                选择一个广告活动以查看和优化其位置倾斜设置
              </p>
            </CardContent>
          </Card>
        )}

        {/* 分析结果弹窗 */}
        <Dialog open={analysisDialogOpen} onOpenChange={setAnalysisDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                位置倾斜优化建议
              </DialogTitle>
              <DialogDescription>
                基于过去7天的表现数据，系统生成了以下优化建议
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              {pendingSuggestions.map((suggestion, index) => {
                const placementInfo = PLACEMENT_LABELS[suggestion.placementType];
                const confidenceInfo = getConfidenceLevel(suggestion.confidence);
                const isIncrease = suggestion.adjustmentDelta > 0;
                const isDecrease = suggestion.adjustmentDelta < 0;
                
                return (
                  <Card key={index}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          {placementInfo?.icon}
                          <span className="font-medium">{placementInfo?.name}</span>
                          <Badge 
                            variant={isIncrease ? "default" : isDecrease ? "destructive" : "secondary"}
                          >
                            {isIncrease && <ArrowUpRight className="h-3 w-3 mr-1" />}
                            {isDecrease && <ArrowDownRight className="h-3 w-3 mr-1" />}
                            {!isIncrease && !isDecrease && <Minus className="h-3 w-3 mr-1" />}
                            {formatPercent(suggestion.adjustmentDelta)}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <div className="text-sm">
                            <span className="text-muted-foreground">当前: </span>
                            <span>{formatPercent(suggestion.currentAdjustment)}</span>
                            <span className="mx-2">→</span>
                            <span className="font-medium">{formatPercent(suggestion.suggestedAdjustment)}</span>
                          </div>
                          <div className={`text-xs ${confidenceInfo.color}`}>
                            置信度: {confidenceInfo.level} ({(suggestion.confidence * 100).toFixed(0)}%)
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mt-2">
                        {suggestion.reason}
                      </p>
                      <div className="mt-2">
                        <div className="text-xs text-muted-foreground mb-1">效率评分</div>
                        <Progress value={suggestion.efficiencyScore} className="h-2" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setAnalysisDialogOpen(false)}>
                取消
              </Button>
              <Button 
                onClick={() => setConfirmDialogOpen(true)}
                disabled={pendingSuggestions.length === 0}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                应用建议
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 确认弹窗 */}
        <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                确认应用调整
              </DialogTitle>
              <DialogDescription>
                您即将应用以下位置倾斜调整，此操作将影响广告出价策略
              </DialogDescription>
            </DialogHeader>
            
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>调整说明</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside text-sm mt-2 space-y-1">
                  {pendingSuggestions.map((s, i) => (
                    <li key={i}>
                      {PLACEMENT_LABELS[s.placementType]?.name}: {formatPercent(s.currentAdjustment)} → {formatPercent(s.suggestedAdjustment)}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>

            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
                取消
              </Button>
              <Button 
                onClick={handleApplySuggestions}
                disabled={applyLoading}
              >
                {applyLoading ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                确认应用
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 设置弹窗 */}
        <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                位置倾斜优化设置
              </DialogTitle>
              <DialogDescription>
                配置自动优化的参数和限制
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-6">
              {/* 自动优化开关 */}
              <div className="flex items-center justify-between">
                <div>
                  <Label>自动优化</Label>
                  <p className="text-sm text-muted-foreground">
                    启用后系统将按设定频率自动调整位置倾斜
                  </p>
                </div>
                <Switch
                  checked={autoOptimize}
                  onCheckedChange={setAutoOptimize}
                />
              </div>

              {/* 优化目标 */}
              <div className="space-y-2">
                <Label>优化目标</Label>
                <Select value={optimizationGoal} onValueChange={setOptimizationGoal}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="roas">ROAS优先</SelectItem>
                    <SelectItem value="acos">ACoS优先</SelectItem>
                    <SelectItem value="sales">销售额优先</SelectItem>
                    <SelectItem value="profit">利润优先</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 目标值 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>目标ROAS</Label>
                  <Input
                    type="number"
                    value={targetRoas}
                    onChange={(e) => setTargetRoas(Number(e.target.value))}
                    step="0.1"
                  />
                </div>
                <div className="space-y-2">
                  <Label>目标ACoS (%)</Label>
                  <Input
                    type="number"
                    value={targetAcos}
                    onChange={(e) => setTargetAcos(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* 调整频率 */}
              <div className="space-y-2">
                <Label>调整频率</Label>
                <Select value={adjustmentFrequency} onValueChange={setAdjustmentFrequency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="every_2_hours">每2小时</SelectItem>
                    <SelectItem value="every_4_hours">每4小时</SelectItem>
                    <SelectItem value="every_6_hours">每6小时</SelectItem>
                    <SelectItem value="daily">每天</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  建议使用"每2小时"以获得最佳优化效果（与最佳实践一致）
                </p>
              </div>

              {/* 调整限制 */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>最大倾斜比例</Label>
                    <span className="text-sm text-muted-foreground">{maxAdjustment}%</span>
                  </div>
                  <Slider
                    value={[maxAdjustment]}
                    onValueChange={([value]) => setMaxAdjustment(value)}
                    min={50}
                    max={900}
                    step={10}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>单次调整步长</Label>
                    <span className="text-sm text-muted-foreground">{adjustmentStep}%</span>
                  </div>
                  <Slider
                    value={[adjustmentStep]}
                    onValueChange={([value]) => setAdjustmentStep(value)}
                    min={5}
                    max={50}
                    step={5}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSettingsDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={() => {
                toast.success("位置倾斜优化设置已保存");
                setSettingsDialogOpen(false);
              }}>
                保存设置
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
