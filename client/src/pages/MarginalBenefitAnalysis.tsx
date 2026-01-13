import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { 
  TrendingUp, 
  TrendingDown,
  Target, 
  RefreshCw,
  Info,
  CheckCircle2,
  AlertTriangle,
  Zap,
  BarChart3,
  Search,
  Package,
  List,
  ArrowRight,
  Play,
  LineChart,
  PieChart,
  Activity,
  Maximize2
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BudgetSimulator } from "@/components/BudgetSimulator";
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ReferenceLine,
  ComposedChart,
  Bar,
  Scatter
} from "recharts";

// 位置类型映射
const PLACEMENT_LABELS: Record<string, { name: string; icon: React.ReactNode; color: string }> = {
  top_of_search: { 
    name: "搜索顶部", 
    icon: <Search className="h-4 w-4" />,
    color: "#10b981"
  },
  product_page: { 
    name: "商品详情页", 
    icon: <Package className="h-4 w-4" />,
    color: "#3b82f6"
  },
  rest_of_search: { 
    name: "其他搜索位置", 
    icon: <List className="h-4 w-4" />,
    color: "#8b5cf6"
  },
};

// 优化目标映射
const OPTIMIZATION_GOALS: Record<string, { name: string; description: string }> = {
  maximize_roas: { name: "ROAS最大化", description: "优先提升广告投资回报率" },
  minimize_acos: { name: "ACoS最小化", description: "优先降低广告成本销售比" },
  maximize_sales: { name: "销售最大化", description: "优先提升销售额，接受较高ACoS" },
  balanced: { name: "平衡优化", description: "综合考虑ROAS、ACoS和销售额" },
};

// 置信度等级
function getConfidenceLevel(confidence: number): { level: string; color: string; bgColor: string } {
  if (confidence >= 0.8) return { level: "高", color: "text-green-400", bgColor: "bg-green-500/20" };
  if (confidence >= 0.5) return { level: "中", color: "text-yellow-400", bgColor: "bg-yellow-500/20" };
  return { level: "低", color: "text-red-400", bgColor: "bg-red-500/20" };
}

// 格式化百分比
function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

// 格式化货币
function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

// 生成边际效益曲线数据
function generateMarginalCurveData(currentAdjustment: number, diminishingPoint: number, marginalROAS: number) {
  const data = [];
  for (let adj = 0; adj <= 200; adj += 10) {
    // 模拟边际效益递减曲线
    const baseROAS = marginalROAS * 1.5;
    const decay = Math.exp(-adj / (diminishingPoint * 2));
    const roasAtPoint = baseROAS * decay;
    const salesGain = roasAtPoint * adj * 0.01;
    
    data.push({
      adjustment: adj,
      marginalROAS: Math.max(0, roasAtPoint),
      salesGain: Math.max(0, salesGain),
      isCurrent: adj === Math.round(currentAdjustment / 10) * 10,
      isDiminishing: adj >= diminishingPoint,
    });
  }
  return data;
}

export default function MarginalBenefitAnalysis() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [optimizationGoal, setOptimizationGoal] = useState<string>("balanced");
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 获取广告活动列表
  const { data: campaigns } = trpc.campaign.list.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // 获取边际效益分析报告
  const { data: reportData, isLoading: reportLoading, refetch: refetchReport } = 
    trpc.placement.generateMarginalBenefitReport.useQuery(
      { 
        campaignId: selectedCampaignId!, 
        accountId: selectedAccountId!,
        goal: optimizationGoal as any
      },
      { enabled: !!selectedCampaignId && !!selectedAccountId }
    );

  // 优化流量分配mutation
  const optimizeAllocationMutation = trpc.placement.optimizeTrafficAllocation.useMutation({
    onSuccess: (result) => {
      setAnalysisResult(result);
      toast.success("流量分配优化分析完成");
      setIsAnalyzing(false);
    },
    onError: (error) => {
      toast.error(`优化分析失败: ${error.message}`);
      setIsAnalyzing(false);
    },
  });

  // 应用调整mutation
  const applyAdjustmentsMutation = trpc.placement.applyAdjustments.useMutation({
    onSuccess: () => {
      toast.success("位置倾斜设置已更新");
      setApplyDialogOpen(false);
      refetchReport();
    },
    onError: (error) => {
      toast.error(`调整失败: ${error.message}`);
    },
  });

  // 执行优化分析
  const handleOptimize = () => {
    if (!selectedCampaignId || !selectedAccountId) {
      toast.error("请先选择广告活动");
      return;
    }
    
    setIsAnalyzing(true);
    const currentAdjustments = {
      top_of_search: reportData?.marginalBenefits?.top_of_search?.currentAdjustment || 0,
      product_page: reportData?.marginalBenefits?.product_page?.currentAdjustment || 0,
      rest_of_search: reportData?.marginalBenefits?.rest_of_search?.currentAdjustment || 0,
    };
    
    optimizeAllocationMutation.mutate({
      campaignId: selectedCampaignId,
      accountId: selectedAccountId,
      currentAdjustments,
      goal: optimizationGoal as any,
    });
  };

  // 应用优化建议
  const handleApplyOptimization = () => {
    if (!selectedCampaignId || !selectedAccountId || !analysisResult) return;
    
    const validPlacements = ['top_of_search', 'product_page', 'rest_of_search'] as const;
    const adjustments = Object.entries(analysisResult.optimizedAdjustments)
      .filter(([placement]) => validPlacements.includes(placement as any))
      .map(([placement, value]) => ({
        placementType: placement as 'top_of_search' | 'product_page' | 'rest_of_search',
        currentAdjustment: reportData?.marginalBenefits?.[placement]?.currentAdjustment || 0,
        suggestedAdjustment: value as number,
        adjustmentDelta: (value as number) - (reportData?.marginalBenefits?.[placement]?.currentAdjustment || 0),
        efficiencyScore: reportData?.marginalBenefits?.[placement]?.confidence || 0.5,
        confidence: reportData?.marginalBenefits?.[placement]?.confidence || 0.5,
        reason: `边际效益优化 - ${OPTIMIZATION_GOALS[optimizationGoal].name}`,
      }));
    
    applyAdjustmentsMutation.mutate({
      campaignId: selectedCampaignId,
      accountId: selectedAccountId,
      adjustments,
    });
  };

  // 准备雷达图数据
  const radarData = useMemo(() => {
    if (!reportData?.marginalBenefits) return [];
    
    return [
      {
        metric: "边际ROAS",
        top_of_search: reportData.marginalBenefits.top_of_search?.marginalROAS || 0,
        product_page: reportData.marginalBenefits.product_page?.marginalROAS || 0,
        rest_of_search: reportData.marginalBenefits.rest_of_search?.marginalROAS || 0,
      },
      {
        metric: "边际销售",
        top_of_search: (reportData.marginalBenefits.top_of_search?.marginalSales || 0) / 10,
        product_page: (reportData.marginalBenefits.product_page?.marginalSales || 0) / 10,
        rest_of_search: (reportData.marginalBenefits.rest_of_search?.marginalSales || 0) / 10,
      },
      {
        metric: "置信度",
        top_of_search: (reportData.marginalBenefits.top_of_search?.confidence || 0) * 5,
        product_page: (reportData.marginalBenefits.product_page?.confidence || 0) * 5,
        rest_of_search: (reportData.marginalBenefits.rest_of_search?.confidence || 0) * 5,
      },
      {
        metric: "弹性系数",
        top_of_search: reportData.marginalBenefits.top_of_search?.elasticity || 0,
        product_page: reportData.marginalBenefits.product_page?.elasticity || 0,
        rest_of_search: reportData.marginalBenefits.rest_of_search?.elasticity || 0,
      },
    ];
  }, [reportData]);

  // 准备饼图数据
  const pieData = useMemo(() => {
    if (!reportData?.marginalBenefits) return [];
    
    const totalSales = 
      (reportData.marginalBenefits.top_of_search?.marginalSales || 0) +
      (reportData.marginalBenefits.product_page?.marginalSales || 0) +
      (reportData.marginalBenefits.rest_of_search?.marginalSales || 0);
    
    if (totalSales === 0) return [];
    
    return [
      {
        name: "搜索顶部",
        value: reportData.marginalBenefits.top_of_search?.marginalSales || 0,
        color: PLACEMENT_LABELS.top_of_search.color,
      },
      {
        name: "商品详情页",
        value: reportData.marginalBenefits.product_page?.marginalSales || 0,
        color: PLACEMENT_LABELS.product_page.color,
      },
      {
        name: "其他搜索位置",
        value: reportData.marginalBenefits.rest_of_search?.marginalSales || 0,
        color: PLACEMENT_LABELS.rest_of_search.color,
      },
    ];
  }, [reportData]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Activity className="h-6 w-6 text-purple-400" />
              边际效益分析
            </h1>
            <p className="text-gray-400 mt-1">
              分析各位置的边际效益，优化流量分配策略
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchReport()}
              disabled={!selectedCampaignId || reportLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${reportLoading ? 'animate-spin' : ''}`} />
              刷新数据
            </Button>
            <Button
              onClick={handleOptimize}
              disabled={!selectedCampaignId || isAnalyzing}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Zap className={`h-4 w-4 mr-2 ${isAnalyzing ? 'animate-pulse' : ''}`} />
              {isAnalyzing ? "分析中..." : "优化流量分配"}
            </Button>
          </div>
        </div>

        {/* 筛选器 */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm text-gray-400 mb-2 block">选择账号</label>
                <Select
                  value={selectedAccountId?.toString() || ""}
                  onValueChange={(v) => {
                    setSelectedAccountId(parseInt(v));
                    setSelectedCampaignId(null);
                    setAnalysisResult(null);
                  }}
                >
                  <SelectTrigger className="bg-gray-700 border-gray-600">
                    <SelectValue placeholder="选择广告账号" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.map((account) => (
                      <SelectItem key={account.id} value={account.id.toString()}>
                        {account.storeName || account.profileId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-2 block">选择广告活动</label>
                <Select
                  value={selectedCampaignId || ""}
                  onValueChange={(v) => {
                    setSelectedCampaignId(v);
                    setAnalysisResult(null);
                  }}
                  disabled={!selectedAccountId}
                >
                  <SelectTrigger className="bg-gray-700 border-gray-600">
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
              <div>
                <label className="text-sm text-gray-400 mb-2 block">优化目标</label>
                <Select
                  value={optimizationGoal}
                  onValueChange={setOptimizationGoal}
                >
                  <SelectTrigger className="bg-gray-700 border-gray-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(OPTIMIZATION_GOALS).map(([key, { name, description }]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex flex-col">
                          <span>{name}</span>
                          <span className="text-xs text-gray-400">{description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 未选择广告活动时的提示 */}
        {!selectedCampaignId && (
          <Alert className="bg-blue-500/10 border-blue-500/30">
            <Info className="h-4 w-4 text-blue-400" />
            <AlertTitle className="text-blue-400">请选择广告活动</AlertTitle>
            <AlertDescription className="text-gray-400">
              选择一个广告活动后，系统将分析各位置的边际效益并提供优化建议。
            </AlertDescription>
          </Alert>
        )}

        {/* 主要内容区域 */}
        {selectedCampaignId && (
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="bg-gray-800 border-gray-700">
              <TabsTrigger value="overview" className="data-[state=active]:bg-purple-600">
                <BarChart3 className="h-4 w-4 mr-2" />
                概览
              </TabsTrigger>
              <TabsTrigger value="curves" className="data-[state=active]:bg-purple-600">
                <LineChart className="h-4 w-4 mr-2" />
                效益曲线
              </TabsTrigger>
              <TabsTrigger value="comparison" className="data-[state=active]:bg-purple-600">
                <PieChart className="h-4 w-4 mr-2" />
                位置对比
              </TabsTrigger>
              <TabsTrigger value="optimization" className="data-[state=active]:bg-purple-600">
                <Target className="h-4 w-4 mr-2" />
                优化建议
              </TabsTrigger>
              <TabsTrigger value="history" className="data-[state=active]:bg-purple-600">
                <TrendingUp className="h-4 w-4 mr-2" />
                历史趋势
              </TabsTrigger>
              <TabsTrigger value="batch" className="data-[state=active]:bg-purple-600">
                <Maximize2 className="h-4 w-4 mr-2" />
                批量分析
              </TabsTrigger>
            </TabsList>

            {/* 概览Tab */}
            <TabsContent value="overview" className="space-y-4">
              {/* 边际效益指标卡片 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Object.entries(PLACEMENT_LABELS).map(([key, { name, icon, color }]) => {
                  const data = reportData?.marginalBenefits?.[key];
                  const confidence = getConfidenceLevel(data?.confidence || 0);
                  
                  return (
                    <Card key={key} className="bg-gray-800/50 border-gray-700">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base font-medium text-white flex items-center gap-2">
                            <span style={{ color }}>{icon}</span>
                            {name}
                          </CardTitle>
                          <Badge className={`${confidence.bgColor} ${confidence.color}`}>
                            置信度: {confidence.level}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs text-gray-400">边际ROAS</p>
                              <p className="text-lg font-semibold text-white">
                                {(data?.marginalROAS || 0).toFixed(2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400">边际ACoS</p>
                              <p className="text-lg font-semibold text-white">
                                {(data?.marginalACoS || 0).toFixed(1)}%
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs text-gray-400">边际销售额</p>
                              <p className="text-sm font-medium text-green-400">
                                {formatCurrency(data?.marginalSales || 0)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400">边际花费</p>
                              <p className="text-sm font-medium text-red-400">
                                {formatCurrency(data?.marginalSpend || 0)}
                              </p>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-gray-700">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-400">当前倾斜</span>
                              <span className="text-white font-medium">
                                {formatPercent(data?.currentAdjustment || 0)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-sm mt-1">
                              <span className="text-gray-400">递减拐点</span>
                              <span className="text-yellow-400 font-medium">
                                {formatPercent(data?.diminishingPoint || 0)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-sm mt-1">
                              <span className="text-gray-400">建议范围</span>
                              <span className="text-purple-400 font-medium">
                                {data?.optimalRange?.min || 0}% - {data?.optimalRange?.max || 0}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* 分析报告摘要 */}
              {reportData?.report && (
                <Card className="bg-gray-800/50 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Info className="h-5 w-5 text-blue-400" />
                      分析报告摘要
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-gray-700/50 rounded-lg p-3">
                          <p className="text-xs text-gray-400">预计销售增长</p>
                          <p className="text-xl font-bold text-green-400">
                            {formatCurrency((reportData.report as any)?.expectedSalesIncrease || 0)}
                          </p>
                        </div>
                        <div className="bg-gray-700/50 rounded-lg p-3">
                          <p className="text-xs text-gray-400">预计花费变化</p>
                          <p className="text-xl font-bold text-yellow-400">
                            {formatCurrency((reportData.report as any)?.expectedSpendChange || 0)}
                          </p>
                        </div>
                        <div className="bg-gray-700/50 rounded-lg p-3">
                          <p className="text-xs text-gray-400">预计ROAS变化</p>
                          <p className="text-xl font-bold text-purple-400">
                            {formatPercent(((reportData.report as any)?.expectedROASChange || 0) * 100)}
                          </p>
                        </div>
                        <div className="bg-gray-700/50 rounded-lg p-3">
                          <p className="text-xs text-gray-400">整体置信度</p>
                          <p className="text-xl font-bold text-blue-400">
                            {(((reportData.report as any)?.overallConfidence || 0) * 100).toFixed(0)}%
                          </p>
                        </div>
                      </div>
                      
                      {(reportData.report as any)?.recommendations && (reportData.report as any).recommendations.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-300 mb-2">优化建议</h4>
                          <ul className="space-y-2">
                            {(reportData.report as any).recommendations.map((rec: string, idx: number) => (
                              <li key={idx} className="flex items-start gap-2 text-sm text-gray-400">
                                <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* 效益曲线Tab */}
            <TabsContent value="curves" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {Object.entries(PLACEMENT_LABELS).filter(([key]) => key !== 'rest_of_search').map(([key, { name, color }]) => {
                  const data = reportData?.marginalBenefits?.[key];
                  const curveData = generateMarginalCurveData(
                    data?.currentAdjustment || 0,
                    data?.diminishingPoint || 70,
                    data?.marginalROAS || 2
                  );
                  
                  return (
                    <Card key={key} className="bg-gray-800/50 border-gray-700">
                      <CardHeader>
                        <CardTitle className="text-white text-base">{name} - 边际效益曲线</CardTitle>
                        <CardDescription>
                          当前倾斜: {formatPercent(data?.currentAdjustment || 0)} | 
                          递减拐点: {formatPercent(data?.diminishingPoint || 0)}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={curveData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                              <XAxis 
                                dataKey="adjustment" 
                                stroke="#9ca3af"
                                label={{ value: '倾斜百分比 (%)', position: 'insideBottom', offset: -5, fill: '#9ca3af' }}
                              />
                              <YAxis 
                                yAxisId="left"
                                stroke="#9ca3af"
                                label={{ value: '边际ROAS', angle: -90, position: 'insideLeft', fill: '#9ca3af' }}
                              />
                              <YAxis 
                                yAxisId="right"
                                orientation="right"
                                stroke="#9ca3af"
                                label={{ value: '销售增益 ($)', angle: 90, position: 'insideRight', fill: '#9ca3af' }}
                              />
                              <RechartsTooltip 
                                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                                labelStyle={{ color: '#fff' }}
                              />
                              <Legend />
                              <ReferenceLine 
                                x={data?.diminishingPoint || 70} 
                                stroke="#f59e0b" 
                                strokeDasharray="5 5"
                                yAxisId="left"
                                label={{ value: '递减拐点', fill: '#f59e0b', fontSize: 12 }}
                              />
                              <ReferenceLine 
                                x={data?.currentAdjustment || 0} 
                                stroke="#10b981" 
                                strokeDasharray="3 3"
                                yAxisId="left"
                                label={{ value: '当前', fill: '#10b981', fontSize: 12 }}
                              />
                              <Area
                                yAxisId="left"
                                type="monotone"
                                dataKey="marginalROAS"
                                name="边际ROAS"
                                stroke={color}
                                fill={color}
                                fillOpacity={0.2}
                              />
                              <Line
                                yAxisId="right"
                                type="monotone"
                                dataKey="salesGain"
                                name="销售增益"
                                stroke="#f472b6"
                                strokeWidth={2}
                                dot={false}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="mt-4 flex items-center justify-center gap-6 text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                            <span className="text-gray-400">当前位置</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                            <span className="text-gray-400">递减拐点</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                            <span className="text-gray-400">建议范围</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* 弹性系数说明 */}
              <Card className="bg-gray-800/50 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white text-base flex items-center gap-2">
                    <Info className="h-4 w-4 text-blue-400" />
                    边际效益曲线解读
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="bg-gray-700/50 rounded-lg p-4">
                      <h4 className="font-medium text-green-400 mb-2">递减拐点之前</h4>
                      <p className="text-gray-400">
                        在递减拐点之前，每增加1%的倾斜都能带来较高的边际回报。
                        这是投资的"黄金区域"。
                      </p>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-4">
                      <h4 className="font-medium text-yellow-400 mb-2">递减拐点附近</h4>
                      <p className="text-gray-400">
                        在递减拐点附近，边际效益开始显著下降。
                        继续增加倾斜的投入产出比降低。
                      </p>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-4">
                      <h4 className="font-medium text-red-400 mb-2">递减拐点之后</h4>
                      <p className="text-gray-400">
                        超过递减拐点后，边际效益急剧下降。
                        可能需要考虑将预算转移到其他位置。
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 位置对比Tab */}
            <TabsContent value="comparison" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 雷达图 */}
                <Card className="bg-gray-800/50 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-white text-base">位置效益多维对比</CardTitle>
                    <CardDescription>
                      比较各位置在不同维度上的表现
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData}>
                          <PolarGrid stroke="#374151" />
                          <PolarAngleAxis dataKey="metric" stroke="#9ca3af" />
                          <PolarRadiusAxis stroke="#9ca3af" />
                          <Radar
                            name="搜索顶部"
                            dataKey="top_of_search"
                            stroke={PLACEMENT_LABELS.top_of_search.color}
                            fill={PLACEMENT_LABELS.top_of_search.color}
                            fillOpacity={0.3}
                          />
                          <Radar
                            name="商品详情页"
                            dataKey="product_page"
                            stroke={PLACEMENT_LABELS.product_page.color}
                            fill={PLACEMENT_LABELS.product_page.color}
                            fillOpacity={0.3}
                          />
                          <Radar
                            name="其他搜索位置"
                            dataKey="rest_of_search"
                            stroke={PLACEMENT_LABELS.rest_of_search.color}
                            fill={PLACEMENT_LABELS.rest_of_search.color}
                            fillOpacity={0.3}
                          />
                          <Legend />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* 饼图 */}
                <Card className="bg-gray-800/50 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-white text-base">边际销售贡献分布</CardTitle>
                    <CardDescription>
                      各位置对边际销售额的贡献占比
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsPieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {pieData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                            formatter={(value: number) => formatCurrency(value)}
                          />
                          <Legend />
                        </RechartsPieChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* 详细对比表格 */}
              <Card className="bg-gray-800/50 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white text-base">详细指标对比</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-gray-700">
                        <TableHead className="text-gray-400">位置</TableHead>
                        <TableHead className="text-gray-400 text-right">边际ROAS</TableHead>
                        <TableHead className="text-gray-400 text-right">边际ACoS</TableHead>
                        <TableHead className="text-gray-400 text-right">边际销售</TableHead>
                        <TableHead className="text-gray-400 text-right">弹性系数</TableHead>
                        <TableHead className="text-gray-400 text-right">当前倾斜</TableHead>
                        <TableHead className="text-gray-400 text-right">递减拐点</TableHead>
                        <TableHead className="text-gray-400 text-center">建议</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(PLACEMENT_LABELS).map(([key, { name, icon, color }]) => {
                        const data = reportData?.marginalBenefits?.[key];
                        const currentAdj = data?.currentAdjustment || 0;
                        const diminishing = data?.diminishingPoint || 0;
                        const suggestion = currentAdj < diminishing * 0.8 ? "increase" : 
                                          currentAdj > diminishing * 1.2 ? "decrease" : "maintain";
                        
                        return (
                          <TableRow key={key} className="border-gray-700">
                            <TableCell className="font-medium text-white">
                              <div className="flex items-center gap-2">
                                <span style={{ color }}>{icon}</span>
                                {name}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-white">
                              {(data?.marginalROAS || 0).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right text-white">
                              {(data?.marginalACoS || 0).toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-right text-green-400">
                              {formatCurrency(data?.marginalSales || 0)}
                            </TableCell>
                            <TableCell className="text-right text-white">
                              {(data?.elasticity || 0).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right text-white">
                              {formatPercent(currentAdj)}
                            </TableCell>
                            <TableCell className="text-right text-yellow-400">
                              {formatPercent(diminishing)}
                            </TableCell>
                            <TableCell className="text-center">
                              {suggestion === "increase" && (
                                <Badge className="bg-green-500/20 text-green-400">
                                  <TrendingUp className="h-3 w-3 mr-1" />
                                  增加
                                </Badge>
                              )}
                              {suggestion === "decrease" && (
                                <Badge className="bg-red-500/20 text-red-400">
                                  <TrendingDown className="h-3 w-3 mr-1" />
                                  降低
                                </Badge>
                              )}
                              {suggestion === "maintain" && (
                                <Badge className="bg-gray-500/20 text-gray-400">
                                  保持
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
            </TabsContent>

            {/* 优化建议Tab */}
            <TabsContent value="optimization" className="space-y-4">
              {/* 优化结果 */}
              {analysisResult && (
                <Card className="bg-gray-800/50 border-gray-700 border-purple-500/50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-white flex items-center gap-2">
                        <Zap className="h-5 w-5 text-purple-400" />
                        优化分析结果
                      </CardTitle>
                      <Button
                        onClick={() => setApplyDialogOpen(true)}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        应用优化建议
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {/* 预期效果 */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                          <p className="text-xs text-gray-400">预计销售增长</p>
                          <p className="text-2xl font-bold text-green-400">
                            {formatCurrency(analysisResult.expectedSalesIncrease || 0)}
                          </p>
                        </div>
                        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                          <p className="text-xs text-gray-400">预计花费变化</p>
                          <p className="text-2xl font-bold text-yellow-400">
                            {formatCurrency(analysisResult.expectedSpendChange || 0)}
                          </p>
                        </div>
                        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                          <p className="text-xs text-gray-400">预计ROAS变化</p>
                          <p className="text-2xl font-bold text-purple-400">
                            {formatPercent((analysisResult.expectedROASChange || 0) * 100)}
                          </p>
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                          <p className="text-xs text-gray-400">优化置信度</p>
                          <p className="text-2xl font-bold text-blue-400">
                            {((analysisResult.confidence || 0) * 100).toFixed(0)}%
                          </p>
                        </div>
                      </div>

                      {/* 调整详情 */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-300 mb-3">建议调整</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {Object.entries(analysisResult.optimizedAdjustments || {}).map(([key, value]) => {
                            const current = reportData?.marginalBenefits?.[key]?.currentAdjustment || 0;
                            const change = (value as number) - current;
                            const { name, icon, color } = PLACEMENT_LABELS[key];
                            
                            return (
                              <div key={key} className="bg-gray-700/50 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <span style={{ color }}>{icon}</span>
                                  <span className="text-white font-medium">{name}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-xs text-gray-400">当前</p>
                                    <p className="text-lg text-white">{formatPercent(current)}</p>
                                  </div>
                                  <ArrowRight className="h-5 w-5 text-gray-500" />
                                  <div>
                                    <p className="text-xs text-gray-400">建议</p>
                                    <p className="text-lg text-purple-400">{formatPercent(value as number)}</p>
                                  </div>
                                </div>
                                <div className="mt-2 text-center">
                                  <Badge className={change > 0 ? "bg-green-500/20 text-green-400" : change < 0 ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"}>
                                    {change > 0 ? "+" : ""}{change.toFixed(0)}%
                                  </Badge>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 未执行优化时的提示 */}
              {!analysisResult && (
                <Card className="bg-gray-800/50 border-gray-700">
                  <CardContent className="py-12">
                    <div className="text-center">
                      <Target className="h-12 w-12 text-gray-500 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-white mb-2">
                        点击"优化流量分配"开始分析
                      </h3>
                      <p className="text-gray-400 max-w-md mx-auto">
                        系统将根据各位置的边际效益，计算最优的流量分配方案，
                        帮助您在有限预算下获得最大收益。
                      </p>
                      <Button
                        onClick={handleOptimize}
                        disabled={isAnalyzing}
                        className="mt-6 bg-purple-600 hover:bg-purple-700"
                      >
                        <Zap className={`h-4 w-4 mr-2 ${isAnalyzing ? 'animate-pulse' : ''}`} />
                        {isAnalyzing ? "分析中..." : "开始优化分析"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 优化原理说明 */}
              <Card className="bg-gray-800/50 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white text-base flex items-center gap-2">
                    <Info className="h-4 w-4 text-blue-400" />
                    优化原理说明
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4 text-sm text-gray-400">
                    <p>
                      <strong className="text-white">边际效益分析</strong>基于经济学中的边际效益递减原理，
                      分析每增加1%的位置倾斜所带来的额外收益变化。
                    </p>
                    <p>
                      <strong className="text-white">流量分配优化</strong>使用贪心算法，
                      优先将预算分配给边际效益最高的位置，直到达到约束条件或边际效益递减到临界点。
                    </p>
                    <div className="bg-gray-700/50 rounded-lg p-4">
                      <h4 className="font-medium text-white mb-2">优化目标说明</h4>
                      <ul className="space-y-2">
                        <li><strong className="text-green-400">ROAS最大化</strong>：优先提升广告投资回报率，适合追求效率的广告活动</li>
                        <li><strong className="text-yellow-400">ACoS最小化</strong>：优先降低广告成本销售比，适合利润敏感的产品</li>
                        <li><strong className="text-blue-400">销售最大化</strong>：优先提升销售额，接受较高ACoS，适合新品推广</li>
                        <li><strong className="text-purple-400">平衡优化</strong>：综合考虑ROAS、ACoS和销售额，适合大多数场景</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 历史趋势Tab */}
            <TabsContent value="history" className="space-y-4">
              <Card className="bg-gray-800/50 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-purple-400" />
                    边际效益历史趋势
                  </CardTitle>
                  <CardDescription>
                    查看各位置边际效益的历史变化，识别季节性规律
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {/* 时间范围选择 */}
                    <div className="flex items-center gap-4">
                      <Select defaultValue="30">
                        <SelectTrigger className="w-40 bg-gray-700 border-gray-600">
                          <SelectValue placeholder="选择时间范围" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="7">近 7 天</SelectItem>
                          <SelectItem value="14">近 14 天</SelectItem>
                          <SelectItem value="30">近 30 天</SelectItem>
                          <SelectItem value="60">近 60 天</SelectItem>
                          <SelectItem value="90">近 90 天</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="sm">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        刷新数据
                      </Button>
                    </div>

                    {/* 趋势图表 */}
                    <div className="h-80 bg-gray-700/30 rounded-lg flex items-center justify-center">
                      <div className="text-center text-gray-400">
                        <TrendingUp className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>历史趋势数据将在系统积累足够数据后展示</p>
                        <p className="text-sm mt-2">建议运行至少 7 天后查看</p>
                      </div>
                    </div>

                    {/* 季节性模式 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card className="bg-gray-700/50 border-gray-600">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm text-white">周度模式</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">最佳表现日</span>
                              <span className="text-green-400">周四</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">最差表现日</span>
                              <span className="text-red-400">周日</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">建议调整时间</span>
                              <span className="text-purple-400">周一上午</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="bg-gray-700/50 border-gray-600">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm text-white">时段对比</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">本周 vs 上周</span>
                              <Badge className="bg-green-500/20 text-green-400">+5.2%</Badge>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">本月 vs 上月</span>
                              <Badge className="bg-green-500/20 text-green-400">+12.8%</Badge>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-400">整体趋势</span>
                              <span className="text-green-400">上升</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 批量分析Tab */}
            <TabsContent value="batch" className="space-y-4">
              <Card className="bg-gray-800/50 border-gray-700">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-white flex items-center gap-2">
                        <Maximize2 className="h-5 w-5 text-purple-400" />
                        批量边际效益分析
                      </CardTitle>
                      <CardDescription>
                        一次性分析多个广告活动的边际效益，生成汇总报告
                      </CardDescription>
                    </div>
                    <Button className="bg-purple-600 hover:bg-purple-700">
                      <Play className="h-4 w-4 mr-2" />
                      开始批量分析
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {/* 选择广告活动 */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-300 mb-3">选择要分析的广告活动</h4>
                      <div className="bg-gray-700/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-gray-400">已选择 0 个广告活动</span>
                          <Button variant="outline" size="sm">全选</Button>
                        </div>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {campaigns?.map((campaign) => (
                            <div key={campaign.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-600/50">
                              <input type="checkbox" className="rounded border-gray-600" />
                              <span className="text-white">{campaign.campaignName}</span>
                              <Badge className="bg-gray-600 text-gray-300 text-xs">
                                {campaign.campaignType}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 分析结果预览 */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-300 mb-3">分析结果预览</h4>
                      <div className="bg-gray-700/30 rounded-lg p-8 text-center text-gray-400">
                        <Maximize2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>选择广告活动并点击"开始批量分析"查看结果</p>
                      </div>
                    </div>

                    {/* 历史批量分析记录 */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-300 mb-3">历史分析记录</h4>
                      <Table>
                        <TableHeader>
                          <TableRow className="border-gray-700">
                            <TableHead className="text-gray-400">分析时间</TableHead>
                            <TableHead className="text-gray-400">广告活动数</TableHead>
                            <TableHead className="text-gray-400">优化目标</TableHead>
                            <TableHead className="text-gray-400">状态</TableHead>
                            <TableHead className="text-gray-400">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow className="border-gray-700">
                            <TableCell colSpan={5} className="text-center text-gray-400 py-8">
                              暂无历史分析记录
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* 应用优化确认对话框 */}
        <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
          <DialogContent className="bg-gray-800 border-gray-700 max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-white">确认应用优化建议</DialogTitle>
              <DialogDescription className="text-gray-400">
                即将应用以下位置倾斜调整，请确认：
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {analysisResult && Object.entries(analysisResult.optimizedAdjustments || {}).map(([key, value]) => {
                const current = reportData?.marginalBenefits?.[key]?.currentAdjustment || 0;
                const change = (value as number) - current;
                const { name } = PLACEMENT_LABELS[key];
                
                return (
                  <div key={key} className="flex items-center justify-between bg-gray-700/50 rounded-lg p-3">
                    <span className="text-white">{name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">{formatPercent(current)}</span>
                      <ArrowRight className="h-4 w-4 text-gray-500" />
                      <span className="text-purple-400 font-medium">{formatPercent(value as number)}</span>
                      <Badge className={change > 0 ? "bg-green-500/20 text-green-400" : change < 0 ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"}>
                        {change > 0 ? "+" : ""}{change.toFixed(0)}%
                      </Badge>
                    </div>
                  </div>
                );
              })}
              <Alert className="bg-yellow-500/10 border-yellow-500/30">
                <AlertTriangle className="h-4 w-4 text-yellow-400" />
                <AlertDescription className="text-gray-400">
                  位置倾斜调整将影响广告的展示位置和竞价，建议在非高峰时段进行调整。
                </AlertDescription>
              </Alert>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApplyDialogOpen(false)}>
                取消
              </Button>
              <Button 
                onClick={handleApplyOptimization}
                className="bg-purple-600 hover:bg-purple-700"
                disabled={applyAdjustmentsMutation.isPending}
              >
                {applyAdjustmentsMutation.isPending ? "应用中..." : "确认应用"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 预算模拟器 */}
        <BudgetSimulator
          currentBudget={selectedCampaign ? 100 : 0}
          currentAcos={selectedCampaign ? 28.5 : 0}
          currentRoas={selectedCampaign ? 3.5 : 0}
          currentSales={selectedCampaign ? 350 : 0}
          onApply={(newBudget) => {
            toast.success(`预算已调整为 $${newBudget}/天`);
          }}
        />
      </div>
    </DashboardLayout>
  );
}
