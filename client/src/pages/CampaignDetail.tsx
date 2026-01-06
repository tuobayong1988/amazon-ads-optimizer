import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Target,
  MousePointerClick,
  Eye,
  ShoppingCart,
  Percent,
  BarChart3,
  Layers,
  Tag,
  Zap,
  Megaphone,
  Monitor,
  Edit2,
  Pause,
  Play,
  MoreHorizontal
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, Ban, ArrowUpRight, ArrowRight, Clock } from "lucide-react";
import { TargetTrendChart } from "@/components/TargetTrendChart";

// 广告活动类型图标映射
const campaignTypeIcons: Record<string, any> = {
  sp_auto: Zap,
  sp_manual: Target,
  sb: Megaphone,
  sd: Monitor,
};

const campaignTypeLabels: Record<string, string> = {
  sp_auto: "SP 自动",
  sp_manual: "SP 手动",
  sb: "SB 品牌",
  sd: "SD 展示",
};

export default function CampaignDetail() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/campaigns/:id");
  const campaignId = params?.id ? parseInt(params.id) : null;
  
  const [activeTab, setActiveTab] = useState("overview");
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summaryMetrics, setSummaryMetrics] = useState<any>(null);
  
  // AI分析结果状态
  const [aiAnalysisResult, setAiAnalysisResult] = useState<any>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [showExecuteDialog, setShowExecuteDialog] = useState(false);
  const [showPredictions, setShowPredictions] = useState(false);
  
  // 获取广告活动详情
  const { data: campaign, isLoading: campaignLoading, refetch: refetchCampaign } = trpc.campaign.get.useQuery(
    { id: campaignId! },
    { enabled: !!campaignId }
  );
  
  // 获取广告组列表
  const { data: adGroups, isLoading: adGroupsLoading } = trpc.campaign.getAdGroups.useQuery(
    { campaignId: campaignId! },
    { enabled: !!campaignId }
  );
  
  // AI摘要生成
  const generateSummaryMutation = trpc.campaign.generateAISummary.useMutation({
    onSuccess: (data) => {
      setAiSummary(data.summary);
      setSummaryMetrics(data.metrics);
      toast.success("AI摘要生成成功");
    },
    onError: (error) => {
      toast.error(`生成失败: ${error.message}`);
    },
  });
  
  // AI智能分析（包含可执行建议）
  const generateAIAnalysisMutation = trpc.campaign.generateAIAnalysis.useMutation({
    onSuccess: (data) => {
      setAiAnalysisResult(data);
      setAiSummary(data.summary);
      setSummaryMetrics(data.metrics);
      setSelectedSuggestions(new Set(data.suggestions.map((_: any, i: number) => i)));
      toast.success(`AI分析完成，识别出${data.suggestions.length}条优化建议`);
    },
    onError: (error) => {
      toast.error(`分析失败: ${error.message}`);
    },
  });
  
  // 执行AI优化建议
  const executeAIOptimizationMutation = trpc.campaign.executeAIOptimization.useMutation({
    onSuccess: (data) => {
      toast.success(`执行完成！成功: ${data.results.success}，失败: ${data.results.failed}`);
      setShowExecuteDialog(false);
      refetchCampaign();
    },
    onError: (error) => {
      toast.error(`执行失败: ${error.message}`);
    },
  });
  
  const handleGenerateSummary = () => {
    if (campaignId) {
      generateSummaryMutation.mutate({ campaignId });
    }
  };
  
  const handleGenerateAIAnalysis = () => {
    if (campaignId) {
      generateAIAnalysisMutation.mutate({ campaignId });
    }
  };
  
  const handleExecuteOptimization = () => {
    if (!aiAnalysisResult || !campaignId) return;
    
    const selectedSuggestionsList = aiAnalysisResult.suggestions.filter((_: any, i: number) => selectedSuggestions.has(i));
    
    executeAIOptimizationMutation.mutate({
      campaignId,
      suggestions: selectedSuggestionsList,
      predictions: aiAnalysisResult.predictions,
      aiSummary: aiAnalysisResult.summary,
    });
  };
  
  const toggleSuggestion = (index: number) => {
    const newSelected = new Set(selectedSuggestions);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedSuggestions(newSelected);
  };
  
  const selectAllSuggestions = () => {
    if (aiAnalysisResult) {
      setSelectedSuggestions(new Set(aiAnalysisResult.suggestions.map((_: any, i: number) => i)));
    }
  };
  
  const deselectAllSuggestions = () => {
    setSelectedSuggestions(new Set());
  };
  
  if (!match || !campaignId) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="text-center py-12">
            <p className="text-muted-foreground">无效的广告活动ID</p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/campaigns")}>
              返回广告活动列表
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }
  
  if (campaignLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }
  
  if (!campaign) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="text-center py-12">
            <p className="text-muted-foreground">广告活动不存在</p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/campaigns")}>
              返回广告活动列表
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }
  
  // 计算指标
  const spend = parseFloat(campaign.spend || "0");
  const sales = parseFloat(campaign.sales || "0");
  const acos = sales > 0 ? (spend / sales * 100) : 0;
  const roas = spend > 0 ? (sales / spend) : 0;
  const clicks = campaign.clicks || 0;
  const impressions = campaign.impressions || 0;
  const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
  const orders = campaign.orders || 0;
  const cvr = clicks > 0 ? (orders / clicks * 100) : 0;
  
  const TypeIcon = campaignTypeIcons[campaign.campaignType] || Target;
  
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* 头部导航 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/campaigns")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回列表
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <TypeIcon className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-2xl font-bold">{campaign.campaignName}</h1>
                <Badge variant={campaign.status === "enabled" ? "default" : "secondary"}>
                  {campaign.status === "enabled" ? "启用" : campaign.status === "paused" ? "暂停" : "归档"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {campaignTypeLabels[campaign.campaignType] || campaign.campaignType} · 
                日预算: ${campaign.dailyBudget || "N/A"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetchCampaign()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              刷新
            </Button>
          </div>
        </div>
        
        {/* AI摘要卡片 */}
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">AI 智能分析</CardTitle>
              </div>
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={handleGenerateSummary}
                  disabled={generateSummaryMutation.isPending}
                >
                  {generateSummaryMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      生成中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      快速摘要
                    </>
                  )}
                </Button>
                <Button 
                  size="sm" 
                  onClick={handleGenerateAIAnalysis}
                  disabled={generateAIAnalysisMutation.isPending}
                >
                  {generateAIAnalysisMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      智能分析与优化
                    </>
                  )}
                </Button>
              </div>
            </div>
            <CardDescription className="flex items-center justify-between">
              <span>基于广告数据的智能分析、优化建议和效果预估</span>
              <Button 
                variant="link" 
                size="sm" 
                className="h-auto p-0 text-xs"
                onClick={() => setLocation(`/campaigns/${campaignId}/ai-history`)}
              >
                <Clock className="h-3 w-3 mr-1" />
                查看执行历史与复盘
              </Button>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {aiSummary ? (
              <div className="space-y-4">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Streamdown>{aiSummary}</Streamdown>
                </div>
                
                {/* AI优化建议列表 */}
                {aiAnalysisResult?.suggestions && aiAnalysisResult.suggestions.length > 0 && (
                  <div className="mt-6 border-t pt-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        优化建议 ({aiAnalysisResult.suggestions.length}条)
                      </h4>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={selectAllSuggestions}>
                          全选
                        </Button>
                        <Button size="sm" variant="ghost" onClick={deselectAllSuggestions}>
                          取消全选
                        </Button>
                        <Button 
                          size="sm" 
                          onClick={() => setShowPredictions(!showPredictions)}
                          variant="outline"
                        >
                          <TrendingUp className="h-4 w-4 mr-1" />
                          效果预估
                        </Button>
                        <Button 
                          size="sm" 
                          onClick={() => setShowExecuteDialog(true)}
                          disabled={selectedSuggestions.size === 0}
                        >
                          <Play className="h-4 w-4 mr-1" />
                          一键执行 ({selectedSuggestions.size})
                        </Button>
                      </div>
                    </div>
                    
                    {/* 效果预估卡片 */}
                    {showPredictions && aiAnalysisResult.predictions && (
                      <div className="mb-4 p-4 bg-muted/50 rounded-lg">
                        <h5 className="font-medium mb-3 flex items-center gap-2">
                          <TrendingUp className="h-4 w-4" />
                          执行后效果预估
                        </h5>
                        <div className="grid grid-cols-3 gap-4">
                          {aiAnalysisResult.predictions.map((pred: any) => (
                            <div key={pred.period} className="p-3 bg-background rounded border">
                              <div className="text-sm font-medium mb-2">
                                {pred.period === "7_days" ? "7天后" : pred.period === "14_days" ? "14天后" : "30天后"}
                              </div>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">预估花费</span>
                                  <span className={pred.spendChangePercent < 0 ? "text-green-500" : "text-red-500"}>
                                    ${pred.predictedSpend.toFixed(2)} ({pred.spendChangePercent > 0 ? "+" : ""}{pred.spendChangePercent.toFixed(1)}%)
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">预估销售</span>
                                  <span className={pred.salesChangePercent > 0 ? "text-green-500" : "text-red-500"}>
                                    ${pred.predictedSales.toFixed(2)} ({pred.salesChangePercent > 0 ? "+" : ""}{pred.salesChangePercent.toFixed(1)}%)
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">预估ACoS</span>
                                  <span className={pred.acosChangePercent < 0 ? "text-green-500" : "text-red-500"}>
                                    {pred.predictedAcos.toFixed(1)}% ({pred.acosChangePercent > 0 ? "+" : ""}{pred.acosChangePercent.toFixed(1)}%)
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">预估ROAS</span>
                                  <span className={pred.roasChangePercent > 0 ? "text-green-500" : "text-red-500"}>
                                    {pred.predictedRoas.toFixed(2)} ({pred.roasChangePercent > 0 ? "+" : ""}{pred.roasChangePercent.toFixed(1)}%)
                                  </span>
                                </div>
                                <div className="flex justify-between mt-2 pt-2 border-t">
                                  <span className="text-muted-foreground">置信度</span>
                                  <span>{(pred.confidence * 100).toFixed(0)}%</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* 建议列表 */}
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {aiAnalysisResult.suggestions.map((suggestion: any, index: number) => (
                        <div 
                          key={index}
                          className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                            selectedSuggestions.has(index) ? "bg-primary/10 border-primary" : "bg-muted/30 hover:bg-muted/50"
                          }`}
                          onClick={() => toggleSuggestion(index)}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox 
                              checked={selectedSuggestions.has(index)}
                              onCheckedChange={() => toggleSuggestion(index)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant={suggestion.priority === "high" ? "destructive" : suggestion.priority === "medium" ? "default" : "secondary"} className="text-xs">
                                  {suggestion.priority === "high" ? "高优先级" : suggestion.priority === "medium" ? "中优先级" : "低优先级"}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {suggestion.type === "bid_adjustment" ? "出价调整" : suggestion.type === "status_change" ? "状态变更" : "否定词"}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {suggestion.targetType === "keyword" ? "关键词" : suggestion.targetType === "product_target" ? "商品定向" : "搜索词"}
                                </span>
                              </div>
                              <p className="text-sm font-medium truncate">{suggestion.targetText}</p>
                              <p className="text-xs text-muted-foreground mt-1">{suggestion.reason}</p>
                              {suggestion.currentValue && suggestion.suggestedValue && (
                                <div className="flex items-center gap-2 mt-2 text-xs">
                                  <span className="text-muted-foreground">{suggestion.currentValue}</span>
                                  <ArrowRight className="h-3 w-3" />
                                  <span className="font-medium text-primary">{suggestion.suggestedValue}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>点击"智能分析与优化"按钮，AI将分析广告表现并生成可执行的优化建议</p>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* 执行确认弹窗 */}
        <Dialog open={showExecuteDialog} onOpenChange={setShowExecuteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认执行AI优化建议</DialogTitle>
              <DialogDescription>
                您即将执行 {selectedSuggestions.size} 条优化建议，这将直接修改广告活动的设置。
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {aiAnalysisResult?.suggestions
                  .filter((_: any, i: number) => selectedSuggestions.has(i))
                  .map((suggestion: any, index: number) => (
                    <div key={index} className="p-2 bg-muted rounded text-sm">
                      <span className="font-medium">{suggestion.targetText}</span>
                      <span className="text-muted-foreground"> - {suggestion.reason}</span>
                    </div>
                  ))
                }
              </div>
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  注意：执行后系统将记录此次操作，并在7天、14天、30天后自动复盘实际效果与预估的差异。
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowExecuteDialog(false)}>
                取消
              </Button>
              <Button 
                onClick={handleExecuteOptimization}
                disabled={executeAIOptimizationMutation.isPending}
              >
                {executeAIOptimizationMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    执行中...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    确认执行
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        
        {/* 核心指标卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <DollarSign className="h-4 w-4" />
                <span className="text-xs">花费</span>
              </div>
              <p className="text-2xl font-bold">${spend.toFixed(2)}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <ShoppingCart className="h-4 w-4" />
                <span className="text-xs">销售额</span>
              </div>
              <p className="text-2xl font-bold">${sales.toFixed(2)}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Percent className="h-4 w-4" />
                <span className="text-xs">ACoS</span>
              </div>
              <p className={`text-2xl font-bold ${acos > 30 ? "text-red-500" : acos > 20 ? "text-yellow-500" : "text-green-500"}`}>
                {acos.toFixed(2)}%
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xs">ROAS</span>
              </div>
              <p className={`text-2xl font-bold ${roas < 2 ? "text-red-500" : roas < 3 ? "text-yellow-500" : "text-green-500"}`}>
                {roas.toFixed(2)}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Eye className="h-4 w-4" />
                <span className="text-xs">展示次数</span>
              </div>
              <p className="text-2xl font-bold">{impressions.toLocaleString()}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <MousePointerClick className="h-4 w-4" />
                <span className="text-xs">点击次数</span>
              </div>
              <p className="text-2xl font-bold">{clicks.toLocaleString()}</p>
            </CardContent>
          </Card>
        </div>
        
        {/* 更多指标 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Target className="h-4 w-4" />
                <span className="text-xs">点击率 (CTR)</span>
              </div>
              <p className="text-xl font-bold">{ctr.toFixed(2)}%</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <BarChart3 className="h-4 w-4" />
                <span className="text-xs">转化率 (CVR)</span>
              </div>
              <p className="text-xl font-bold">{cvr.toFixed(2)}%</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <ShoppingCart className="h-4 w-4" />
                <span className="text-xs">订单数</span>
              </div>
              <p className="text-xl font-bold">{orders}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Layers className="h-4 w-4" />
                <span className="text-xs">广告组数量</span>
              </div>
              <p className="text-xl font-bold">{adGroups?.length || 0}</p>
            </CardContent>
          </Card>
        </div>
        
        {/* 详细数据Tab */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="adgroups">广告组</TabsTrigger>
            <TabsTrigger value="targets">投放词</TabsTrigger>
            <TabsTrigger value="searchterms">搜索词</TabsTrigger>
            <TabsTrigger value="keywords">关键词</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>广告活动信息</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">活动ID</p>
                    <p className="font-medium">{campaign.campaignId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">活动类型</p>
                    <p className="font-medium">{campaignTypeLabels[campaign.campaignType] || campaign.campaignType}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">定向类型</p>
                    <p className="font-medium">{campaign.targetingType === "auto" ? "自动" : "手动"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">日预算</p>
                    <p className="font-medium">${campaign.dailyBudget || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">最高出价</p>
                    <p className="font-medium">${campaign.maxBid || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">创建时间</p>
                    <p className="font-medium">{campaign.createdAt ? new Date(campaign.createdAt).toLocaleDateString() : "N/A"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="adgroups" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>广告组列表</CardTitle>
                <CardDescription>该广告活动下的所有广告组</CardDescription>
              </CardHeader>
              <CardContent>
                {adGroupsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : adGroups && adGroups.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>广告组名称</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="text-right">默认出价</TableHead>
                        <TableHead className="text-right">花费</TableHead>
                        <TableHead className="text-right">销售额</TableHead>
                        <TableHead className="text-right">ACoS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adGroups.map((adGroup: any) => {
                        const agSpend = parseFloat(adGroup.spend || "0");
                        const agSales = parseFloat(adGroup.sales || "0");
                        const agAcos = agSales > 0 ? (agSpend / agSales * 100) : 0;
                        return (
                          <TableRow key={adGroup.id}>
                            <TableCell className="font-medium">{adGroup.adGroupName}</TableCell>
                            <TableCell>
                              <Badge variant={adGroup.status === "enabled" ? "default" : "secondary"}>
                                {adGroup.status === "enabled" ? "启用" : "暂停"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">${adGroup.defaultBid || "N/A"}</TableCell>
                            <TableCell className="text-right">${agSpend.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${agSales.toFixed(2)}</TableCell>
                            <TableCell className="text-right">
                              <span className={agAcos > 30 ? "text-red-500" : agAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                                {agAcos.toFixed(2)}%
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>暂无广告组数据</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="targets" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>投放词列表</CardTitle>
                <CardDescription>该广告活动下的所有投放词（关键词 + 商品定向）</CardDescription>
              </CardHeader>
              <CardContent>
                <TargetsList campaignId={campaignId} />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="searchterms" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>客户搜索词</CardTitle>
                <CardDescription>触发该广告活动的客户实际搜索词</CardDescription>
              </CardHeader>
              <CardContent>
                <SearchTermsList campaignId={campaignId} />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="keywords" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>关键词列表</CardTitle>
                <CardDescription>该广告活动下所有广告组的关键词（按销售额排序，显示前20个）</CardDescription>
              </CardHeader>
              <CardContent>
                <KeywordsList adGroups={adGroups || []} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// 关键词列表子组件
function KeywordsList({ adGroups }: { adGroups: any[] }) {
  const [allKeywords, setAllKeywords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // 为每个广告组获取关键词
  const keywordQueries = adGroups.map(ag => 
    trpc.keyword.list.useQuery({ adGroupId: ag.id }, { enabled: !!ag.id })
  );
  
  // 合并所有关键词
  useEffect(() => {
    const keywords: any[] = [];
    let loading = false;
    
    keywordQueries.forEach((query, index) => {
      if (query.isLoading) {
        loading = true;
      }
      if (query.data) {
        keywords.push(...query.data.map((k: any) => ({
          ...k,
          adGroupName: adGroups[index]?.adGroupName
        })));
      }
    });
    
    setIsLoading(loading);
    setAllKeywords(keywords);
  }, [keywordQueries.map(q => q.data).join(",")]);
  
  // 按销售额排序
  const sortedKeywords = [...allKeywords].sort((a, b) => 
    parseFloat(b.sales || "0") - parseFloat(a.sales || "0")
  );
  
  if (isLoading && allKeywords.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  if (sortedKeywords.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Tag className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无关键词数据</p>
      </div>
    );
  }
  
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>关键词</TableHead>
          <TableHead>匹配类型</TableHead>
          <TableHead>广告组</TableHead>
          <TableHead className="text-right">出价</TableHead>
          <TableHead className="text-right">花费</TableHead>
          <TableHead className="text-right">销售额</TableHead>
          <TableHead className="text-right">ACoS</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedKeywords.slice(0, 20).map((keyword: any) => {
          const kwSpend = parseFloat(keyword.spend || "0");
          const kwSales = parseFloat(keyword.sales || "0");
          const kwAcos = kwSales > 0 ? (kwSpend / kwSales * 100) : 0;
          return (
            <TableRow key={keyword.id}>
              <TableCell className="font-medium">{keyword.keywordText}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {keyword.matchType === "exact" ? "精确" : keyword.matchType === "phrase" ? "词组" : "广泛"}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{keyword.adGroupName}</TableCell>
              <TableCell className="text-right">${keyword.bid || "N/A"}</TableCell>
              <TableCell className="text-right">${kwSpend.toFixed(2)}</TableCell>
              <TableCell className="text-right">${kwSales.toFixed(2)}</TableCell>
              <TableCell className="text-right">
                <span className={kwAcos > 30 ? "text-red-500" : kwAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                  {kwSales > 0 ? `${kwAcos.toFixed(2)}%` : "N/A"}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}


// 投放词列表子组件
function TargetsList({ campaignId }: { campaignId: number }) {
  const utils = trpc.useUtils();
  const { data: targetsData, isLoading, refetch } = trpc.campaign.getTargets.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  
  // 编辑出价状态
  const [editBidOpen, setEditBidOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<any>(null);
  const [newBid, setNewBid] = useState("");
  
  // 确认状态变更弹窗
  const [confirmStatusOpen, setConfirmStatusOpen] = useState(false);
  const [statusChangeTarget, setStatusChangeTarget] = useState<any>(null);
  const [newStatus, setNewStatus] = useState<"enabled" | "paused">("enabled");
  
  // 批量选择状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  
  // 批量操作弹窗
  const [batchBidOpen, setBatchBidOpen] = useState(false);
  const [batchBidType, setBatchBidType] = useState<"fixed" | "increase_percent" | "decrease_percent" | "cpc_multiplier" | "cpc_increase_percent" | "cpc_decrease_percent">("fixed");
  const [batchBidValue, setBatchBidValue] = useState("");
  const [batchStatusOpen, setBatchStatusOpen] = useState(false);
  const [batchStatus, setBatchStatus] = useState<"enabled" | "paused">("enabled");
  
  // 趋势图弹窗状态
  const [trendChartOpen, setTrendChartOpen] = useState(false);
  const [trendTarget, setTrendTarget] = useState<{ id: number; type: "keyword" | "productTarget"; name: string; matchType?: string } | null>(null);
  
  // 筛选状态 - 默认展开筛选面板
  const [showFilters, setShowFilters] = useState(true);
  const [filters, setFilters] = useState({
    matchType: "all" as "all" | "broad" | "phrase" | "exact" | "product",
    status: "all" as "all" | "enabled" | "paused",
    bidMin: "",
    bidMax: "",
    clicksMin: "",
    clicksMax: "",
    spendMin: "",
    spendMax: "",
    salesMin: "",
    salesMax: "",
    acosMin: "",
    acosMax: "",
    roasMin: "",
    roasMax: "",
    ordersMin: "",
    ordersMax: "",
    ctrMin: "",
    ctrMax: "",
    cvrMin: "",
    cvrMax: "",
  });
  
  // 更新关键词出价
  const updateKeywordMutation = trpc.keyword.update.useMutation({
    onSuccess: () => {
      toast.success("出价更新成功");
      refetch();
      setEditBidOpen(false);
      setEditingTarget(null);
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });
  
  // 更新商品定向出价
  const updateProductTargetMutation = trpc.productTarget.update.useMutation({
    onSuccess: () => {
      toast.success("出价更新成功");
      refetch();
      setEditBidOpen(false);
      setEditingTarget(null);
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });
  
  // 批量更新关键词出价
  const batchUpdateKeywordBidMutation = trpc.keyword.batchUpdateBid.useMutation({
    onSuccess: (data) => {
      toast.success(`成功更新 ${data.updated} 个关键词出价`);
      refetch();
      setBatchBidOpen(false);
      setSelectedIds(new Set());
      setSelectAll(false);
    },
    onError: (error) => {
      toast.error(`批量更新失败: ${error.message}`);
    },
  });
  
  // 批量更新商品定向出价
  const batchUpdateProductTargetBidMutation = trpc.productTarget.batchUpdateBid.useMutation({
    onSuccess: (data) => {
      toast.success(`成功更新 ${data.updated} 个商品定向出价`);
      refetch();
      setBatchBidOpen(false);
      setSelectedIds(new Set());
      setSelectAll(false);
    },
    onError: (error) => {
      toast.error(`批量更新失败: ${error.message}`);
    },
  });
  
  // 批量更新关键词状态
  const batchUpdateKeywordStatusMutation = trpc.keyword.batchUpdateStatus.useMutation({
    onSuccess: (data) => {
      toast.success(`成功更新 ${data.updated} 个关键词状态`);
      refetch();
      setBatchStatusOpen(false);
      setSelectedIds(new Set());
      setSelectAll(false);
    },
    onError: (error) => {
      toast.error(`批量更新失败: ${error.message}`);
    },
  });
  
  // 批量更新商品定向状态
  const batchUpdateProductTargetStatusMutation = trpc.productTarget.batchUpdateStatus.useMutation({
    onSuccess: (data) => {
      toast.success(`成功更新 ${data.updated} 个商品定向状态`);
      refetch();
      setBatchStatusOpen(false);
      setSelectedIds(new Set());
      setSelectAll(false);
    },
    onError: (error) => {
      toast.error(`批量更新失败: ${error.message}`);
    },
  });
  
  // 打开编辑出价弹窗
  const handleEditBid = (target: any) => {
    setEditingTarget(target);
    setNewBid(target.bid || "");
    setEditBidOpen(true);
  };
  
  // 保存出价
  const handleSaveBid = () => {
    if (!editingTarget || !newBid) return;
    
    const realId = parseInt(editingTarget.id.split("-")[1]);
    const isKeyword = editingTarget.type === "keyword";
    
    if (isKeyword) {
      updateKeywordMutation.mutate({ id: realId, bid: newBid });
    } else {
      updateProductTargetMutation.mutate({ id: realId, bid: newBid });
    }
  };
  
  // 打开状态变更确认弹窗
  const handleStatusChange = (target: any, status: "enabled" | "paused") => {
    setStatusChangeTarget(target);
    setNewStatus(status);
    setConfirmStatusOpen(true);
  };
  
  // 确认状态变更
  const handleConfirmStatusChange = () => {
    if (!statusChangeTarget) return;
    
    const realId = parseInt(statusChangeTarget.id.split("-")[1]);
    const isKeyword = statusChangeTarget.type === "keyword";
    
    if (isKeyword) {
      updateKeywordMutation.mutate({ id: realId, status: newStatus });
    } else {
      updateProductTargetMutation.mutate({ id: realId, status: newStatus });
    }
    setConfirmStatusOpen(false);
    setStatusChangeTarget(null);
  };
  
  // 切换单个选择
  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
    setSelectAll(false);
  };
  
  // 全选/取消全选
  const toggleSelectAll = (targets: any[]) => {
    if (selectAll) {
      setSelectedIds(new Set());
      setSelectAll(false);
    } else {
      setSelectedIds(new Set(targets.map(t => t.id)));
      setSelectAll(true);
    }
  };
  
  // 批量修改出价
  const handleBatchBid = () => {
    if (!batchBidValue || selectedIds.size === 0) return;
    
    const keywordIds: number[] = [];
    const productTargetIds: number[] = [];
    
    selectedIds.forEach(id => {
      const [type, realId] = id.split("-");
      if (type === "kw") {
        keywordIds.push(parseInt(realId));
      } else {
        productTargetIds.push(parseInt(realId));
      }
    });
    
    if (keywordIds.length > 0) {
      batchUpdateKeywordBidMutation.mutate({
        ids: keywordIds,
        bidType: batchBidType,
        bidValue: parseFloat(batchBidValue),
      });
    }
    
    if (productTargetIds.length > 0) {
      batchUpdateProductTargetBidMutation.mutate({
        ids: productTargetIds,
        bidType: batchBidType,
        bidValue: parseFloat(batchBidValue),
      });
    }
  };
  
  // 批量修改状态
  const handleBatchStatus = () => {
    if (selectedIds.size === 0) return;
    
    const keywordIds: number[] = [];
    const productTargetIds: number[] = [];
    
    selectedIds.forEach(id => {
      const [type, realId] = id.split("-");
      if (type === "kw") {
        keywordIds.push(parseInt(realId));
      } else {
        productTargetIds.push(parseInt(realId));
      }
    });
    
    if (keywordIds.length > 0) {
      batchUpdateKeywordStatusMutation.mutate({
        ids: keywordIds,
        status: batchStatus,
      });
    }
    
    if (productTargetIds.length > 0) {
      batchUpdateProductTargetStatusMutation.mutate({
        ids: productTargetIds,
        status: batchStatus,
      });
    }
  };
  
  // 清除筛选
  const clearFilters = () => {
    setFilters({
      matchType: "all",
      status: "all",
      bidMin: "",
      bidMax: "",
      clicksMin: "",
      clicksMax: "",
      spendMin: "",
      spendMax: "",
      salesMin: "",
      salesMax: "",
      acosMin: "",
      acosMax: "",
      roasMin: "",
      roasMax: "",
      ordersMin: "",
      ordersMax: "",
      ctrMin: "",
      ctrMax: "",
      cvrMin: "",
      cvrMax: "",
    });
  };
  
  // 检查是否有激活的筛选
  const hasActiveFilters = () => {
    return filters.matchType !== "all" ||
      filters.status !== "all" ||
      filters.bidMin !== "" ||
      filters.bidMax !== "" ||
      filters.clicksMin !== "" ||
      filters.clicksMax !== "" ||
      filters.spendMin !== "" ||
      filters.spendMax !== "" ||
      filters.salesMin !== "" ||
      filters.salesMax !== "" ||
      filters.acosMin !== "" ||
      filters.acosMax !== "" ||
      filters.roasMin !== "" ||
      filters.roasMax !== "" ||
      filters.ordersMin !== "" ||
      filters.ordersMax !== "" ||
      filters.ctrMin !== "" ||
      filters.ctrMax !== "" ||
      filters.cvrMin !== "" ||
      filters.cvrMax !== "";
  };
  
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  // 合并关键词和商品定向为统一的投放词列表
  const allTargets: any[] = [];
  
  if (targetsData?.keywords) {
    targetsData.keywords.forEach((k: any) => {
      allTargets.push({
        id: `kw-${k.id}`,
        realId: k.id,
        text: k.keywordText,
        type: 'keyword',
        matchType: k.matchType,
        status: k.status,
        bid: k.bid,
        impressions: k.impressions,
        clicks: k.clicks,
        spend: k.spend,
        sales: k.sales,
        orders: k.orders || 0,
        adGroupName: k.adGroupName
      });
    });
  }
  
  if (targetsData?.productTargets) {
    targetsData.productTargets.forEach((pt: any) => {
      allTargets.push({
        id: `pt-${pt.id}`,
        realId: pt.id,
        text: pt.targetExpression || pt.asin || 'ASIN定向',
        type: 'product',
        matchType: null,
        status: pt.status,
        bid: pt.bid,
        impressions: pt.impressions,
        clicks: pt.clicks,
        spend: pt.spend,
        sales: pt.sales,
        orders: pt.orders || 0,
        adGroupName: pt.adGroupName
      });
    });
  }
  
  // 应用筛选
  const filteredTargets = allTargets.filter(target => {
    const tSpend = parseFloat(target.spend || "0");
    const tSales = parseFloat(target.sales || "0");
    const tAcos = tSales > 0 ? (tSpend / tSales * 100) : 0;
    const tRoas = tSpend > 0 ? (tSales / tSpend) : 0;
    const tBid = parseFloat(target.bid || "0");
    
    // 匹配方式筛选
    if (filters.matchType !== "all") {
      if (filters.matchType === "product" && target.type !== "product") return false;
      if (filters.matchType !== "product" && target.matchType !== filters.matchType) return false;
    }
    
    // 状态筛选
    if (filters.status !== "all" && target.status !== filters.status) return false;
    
    // 出价范围筛选
    if (filters.bidMin && tBid < parseFloat(filters.bidMin)) return false;
    if (filters.bidMax && tBid > parseFloat(filters.bidMax)) return false;
    
    // 点击范围筛选
    if (filters.clicksMin && (target.clicks || 0) < parseInt(filters.clicksMin)) return false;
    if (filters.clicksMax && (target.clicks || 0) > parseInt(filters.clicksMax)) return false;
    
    // 花费范围筛选
    if (filters.spendMin && tSpend < parseFloat(filters.spendMin)) return false;
    if (filters.spendMax && tSpend > parseFloat(filters.spendMax)) return false;
    
    // 销售额范围筛选
    if (filters.salesMin && tSales < parseFloat(filters.salesMin)) return false;
    if (filters.salesMax && tSales > parseFloat(filters.salesMax)) return false;
    
    // ACoS范围筛选
    if (filters.acosMin && tAcos < parseFloat(filters.acosMin)) return false;
    if (filters.acosMax && tAcos > parseFloat(filters.acosMax)) return false;
    
    // ROAS范围筛选
    if (filters.roasMin && tRoas < parseFloat(filters.roasMin)) return false;
    if (filters.roasMax && tRoas > parseFloat(filters.roasMax)) return false;
    
    // 订单数范围筛选
    if (filters.ordersMin && (target.orders || 0) < parseInt(filters.ordersMin)) return false;
    if (filters.ordersMax && (target.orders || 0) > parseInt(filters.ordersMax)) return false;
    
    // 点击率范围筛选
    const tCtr = target.impressions > 0 ? (target.clicks / target.impressions * 100) : 0;
    if (filters.ctrMin && tCtr < parseFloat(filters.ctrMin)) return false;
    if (filters.ctrMax && tCtr > parseFloat(filters.ctrMax)) return false;
    
    // 转化率范围筛选
    const tCvr = target.clicks > 0 ? ((target.orders || 0) / target.clicks * 100) : 0;
    if (filters.cvrMin && tCvr < parseFloat(filters.cvrMin)) return false;
    if (filters.cvrMax && tCvr > parseFloat(filters.cvrMax)) return false;
    
    return true;
  });
  
  if (allTargets.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无投放词数据</p>
      </div>
    );
  }
  
  // 按销售额排序
  const sortedTargets = [...filteredTargets].sort((a: any, b: any) => 
    parseFloat(b.sales || "0") - parseFloat(a.sales || "0")
  );
  
  const isMutating = updateKeywordMutation.isPending || updateProductTargetMutation.isPending ||
    batchUpdateKeywordBidMutation.isPending || batchUpdateProductTargetBidMutation.isPending ||
    batchUpdateKeywordStatusMutation.isPending || batchUpdateProductTargetStatusMutation.isPending;
  
  return (
    <>
      {/* 筛选和批量操作工具栏 */}
      <div className="mb-4 space-y-4">
        {/* 筛选按钮和批量操作 */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              variant={showFilters ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Target className="h-4 w-4 mr-2" />
              筛选
              {hasActiveFilters() && <Badge variant="secondary" className="ml-2">激活</Badge>}
            </Button>
            {hasActiveFilters() && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                清除筛选
              </Button>
            )}
          </div>
          
          {/* 批量操作按钮 */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 rounded-lg">
              <span className="text-sm text-muted-foreground">已选择 {selectedIds.size} 项</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBatchStatus("enabled");
                  setBatchStatusOpen(true);
                }}
              >
                <Play className="h-4 w-4 mr-1" />
                批量启用
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBatchStatus("paused");
                  setBatchStatusOpen(true);
                }}
              >
                <Pause className="h-4 w-4 mr-1" />
                批量暂停
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBatchBidOpen(true)}
              >
                <Edit2 className="h-4 w-4 mr-1" />
                批量修改出价
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedIds(new Set());
                  setSelectAll(false);
                }}
              >
                取消选择
              </Button>
            </div>
          )}
        </div>
        
        {/* 筛选面板 */}
        {showFilters && (
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {/* 匹配方式 */}
                <div>
                  <Label className="text-xs">匹配方式</Label>
                  <select
                    className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={filters.matchType}
                    onChange={(e) => setFilters({...filters, matchType: e.target.value as any})}
                  >
                    <option value="all">全部</option>
                    <option value="broad">广泛</option>
                    <option value="phrase">词组</option>
                    <option value="exact">精确</option>
                    <option value="product">商品定向</option>
                  </select>
                </div>
                
                {/* 状态 */}
                <div>
                  <Label className="text-xs">状态</Label>
                  <select
                    className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={filters.status}
                    onChange={(e) => setFilters({...filters, status: e.target.value as any})}
                  >
                    <option value="all">全部</option>
                    <option value="enabled">启用</option>
                    <option value="paused">暂停</option>
                  </select>
                </div>
                
                {/* 出价范围 */}
                <div>
                  <Label className="text-xs">出价范围 ($)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.bidMin}
                      onChange={(e) => setFilters({...filters, bidMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.bidMax}
                      onChange={(e) => setFilters({...filters, bidMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 点击范围 */}
                <div>
                  <Label className="text-xs">点击范围</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.clicksMin}
                      onChange={(e) => setFilters({...filters, clicksMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.clicksMax}
                      onChange={(e) => setFilters({...filters, clicksMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 花费范围 */}
                <div>
                  <Label className="text-xs">花费范围 ($)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.spendMin}
                      onChange={(e) => setFilters({...filters, spendMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.spendMax}
                      onChange={(e) => setFilters({...filters, spendMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 销售额范围 */}
                <div>
                  <Label className="text-xs">销售额范围 ($)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.salesMin}
                      onChange={(e) => setFilters({...filters, salesMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.salesMax}
                      onChange={(e) => setFilters({...filters, salesMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* ACoS范围 */}
                <div>
                  <Label className="text-xs">ACoS范围 (%)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.acosMin}
                      onChange={(e) => setFilters({...filters, acosMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.acosMax}
                      onChange={(e) => setFilters({...filters, acosMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* ROAS范围 */}
                <div>
                  <Label className="text-xs">ROAS范围</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.roasMin}
                      onChange={(e) => setFilters({...filters, roasMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.roasMax}
                      onChange={(e) => setFilters({...filters, roasMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 订单数范围 */}
                <div>
                  <Label className="text-xs">订单数范围</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.ordersMin}
                      onChange={(e) => setFilters({...filters, ordersMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.ordersMax}
                      onChange={(e) => setFilters({...filters, ordersMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 点击率范围 */}
                <div>
                  <Label className="text-xs">点击率范围 (%)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.ctrMin}
                      onChange={(e) => setFilters({...filters, ctrMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.ctrMax}
                      onChange={(e) => setFilters({...filters, ctrMax: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* 转化率范围 */}
                <div>
                  <Label className="text-xs">转化率范围 (%)</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      placeholder="最小"
                      className="h-9"
                      value={filters.cvrMin}
                      onChange={(e) => setFilters({...filters, cvrMin: e.target.value})}
                    />
                    <Input
                      type="number"
                      placeholder="最大"
                      className="h-9"
                      value={filters.cvrMax}
                      onChange={(e) => setFilters({...filters, cvrMax: e.target.value})}
                    />
                  </div>
                </div>
              </div>
              
              {/* 筛选结果统计 */}
              <div className="mt-4 text-sm text-muted-foreground">
                筛选结果: {filteredTargets.length} / {allTargets.length} 项
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <input
                  type="checkbox"
                  checked={selectAll && sortedTargets.length > 0}
                  onChange={() => toggleSelectAll(sortedTargets)}
                  className="h-4 w-4 rounded border-gray-300"
                />
              </TableHead>
              <TableHead>投放词</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>匹配方式</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">出价</TableHead>
              <TableHead className="text-right">CPC</TableHead>
              <TableHead className="text-right">展示</TableHead>
              <TableHead className="text-right">点击</TableHead>
              <TableHead className="text-right">点击率</TableHead>
              <TableHead className="text-right">花费</TableHead>
              <TableHead className="text-right">订单</TableHead>
              <TableHead className="text-right">销售额</TableHead>
              <TableHead className="text-right">转化率</TableHead>
              <TableHead className="text-right">ACoS</TableHead>
              <TableHead className="text-right">ROAS</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTargets.map((target: any) => {
              const tSpend = parseFloat(target.spend || "0");
              const tSales = parseFloat(target.sales || "0");
              const tAcos = tSales > 0 ? (tSpend / tSales * 100) : 0;
              const tRoas = tSpend > 0 ? (tSales / tSpend) : 0;
              const isKeyword = target.type === 'keyword';
              const isEnabled = target.status === "enabled";
              
              return (
                <TableRow key={target.id} className={selectedIds.has(target.id) ? "bg-muted/50" : ""}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(target.id)}
                      onChange={() => toggleSelect(target.id)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </TableCell>
                  <TableCell className="font-medium max-w-[200px]">
                    <button
                      className="text-left hover:text-primary hover:underline truncate block w-full"
                      title={`点击查看 "${target.text}" 的历史趋势`}
                      onClick={() => {
                        setTrendTarget({
                          id: target.originalId,
                          type: isKeyword ? "keyword" : "productTarget",
                          name: target.text,
                          matchType: isKeyword ? target.matchType : undefined,
                        });
                        setTrendChartOpen(true);
                      }}
                    >
                      {target.text}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant={isKeyword ? "default" : "secondary"}>
                      {isKeyword ? "关键词" : "商品定向"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {isKeyword ? (
                      <Badge variant="outline">
                        {target.matchType === "exact" ? "精确" : target.matchType === "phrase" ? "词组" : "广泛"}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={isEnabled ? "default" : "secondary"}>
                      {isEnabled ? "启用" : "暂停"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">${target.bid || "N/A"}</TableCell>
                  <TableCell className="text-right">
                    {target.clicks > 0 ? `$${(tSpend / target.clicks).toFixed(2)}` : "-"}
                  </TableCell>
                  <TableCell className="text-right">{target.impressions?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right">{target.clicks?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right">
                    <span className={(target.impressions > 0 ? (target.clicks / target.impressions * 100) : 0) >= 0.5 ? "text-green-500" : "text-yellow-500"}>
                      {target.impressions > 0 ? `${(target.clicks / target.impressions * 100).toFixed(2)}%` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">${tSpend.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{target.orders || 0}</TableCell>
                  <TableCell className="text-right">${tSales.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <span className={(target.clicks > 0 ? ((target.orders || 0) / target.clicks * 100) : 0) >= 10 ? "text-green-500" : (target.clicks > 0 ? ((target.orders || 0) / target.clicks * 100) : 0) >= 5 ? "text-yellow-500" : "text-red-500"}>
                      {target.clicks > 0 ? `${((target.orders || 0) / target.clicks * 100).toFixed(2)}%` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={tAcos > 30 ? "text-red-500" : tAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                      {tSales > 0 ? `${tAcos.toFixed(1)}%` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={tRoas >= 3 ? "text-green-500" : tRoas >= 2 ? "text-yellow-500" : "text-red-500"}>
                      {tSpend > 0 ? tRoas.toFixed(2) : "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleEditBid(target)}
                        title="编辑出价"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleStatusChange(target, isEnabled ? "paused" : "enabled")}
                        title={isEnabled ? "暂停" : "启用"}
                      >
                        {isEnabled ? (
                          <Pause className="h-4 w-4 text-yellow-500" />
                        ) : (
                          <Play className="h-4 w-4 text-green-500" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {/* 编辑出价弹窗 */}
      <Dialog open={editBidOpen} onOpenChange={setEditBidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑出价</DialogTitle>
            <DialogDescription>
              修改投放词 "{editingTarget?.text}" 的出价
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="currentBid" className="text-right">当前出价</Label>
              <div className="col-span-3">
                <span className="text-muted-foreground">${editingTarget?.bid || "N/A"}</span>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="newBid" className="text-right">新出价</Label>
              <div className="col-span-3">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    id="newBid"
                    type="number"
                    step="0.01"
                    min="0.02"
                    value={newBid}
                    onChange={(e) => setNewBid(e.target.value)}
                    placeholder="输入新出价"
                    className="w-32"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBidOpen(false)}>取消</Button>
            <Button onClick={handleSaveBid} disabled={isMutating || !newBid}>
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 状态变更确认弹窗 */}
      <Dialog open={confirmStatusOpen} onOpenChange={setConfirmStatusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newStatus === "paused" ? "暂停投放词" : "启用投放词"}</DialogTitle>
            <DialogDescription>
              确定要{newStatus === "paused" ? "暂停" : "启用"}投放词 "{statusChangeTarget?.text}" 吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStatusOpen(false)}>取消</Button>
            <Button 
              onClick={handleConfirmStatusChange} 
              disabled={isMutating}
              variant={newStatus === "paused" ? "destructive" : "default"}
            >
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认{newStatus === "paused" ? "暂停" : "启用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 批量修改出价弹窗 */}
      <Dialog open={batchBidOpen} onOpenChange={setBatchBidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量修改出价</DialogTitle>
            <DialogDescription>
              已选择 {selectedIds.size} 个投放词，请选择调整方式
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">调整方式</Label>
              <div className="col-span-3">
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={batchBidType}
                  onChange={(e) => setBatchBidType(e.target.value as any)}
                >
                  <optgroup label="基于当前出价">
                    <option value="fixed">固定出价</option>
                    <option value="increase_percent">按百分比提高</option>
                    <option value="decrease_percent">按百分比降低</option>
                  </optgroup>
                  <optgroup label="基于CPC">
                    <option value="cpc_multiplier">按CPC倍数设置</option>
                    <option value="cpc_increase_percent">按CPC百分比提高</option>
                    <option value="cpc_decrease_percent">按CPC百分比降低</option>
                  </optgroup>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">
                {batchBidType === "fixed" ? "新出价 ($)" : batchBidType === "cpc_multiplier" ? "CPC倍数" : "调整比例 (%)"}
              </Label>
              <div className="col-span-3">
                <Input
                  type="number"
                  step={batchBidType === "fixed" ? "0.01" : batchBidType === "cpc_multiplier" ? "0.1" : "1"}
                  min="0"
                  value={batchBidValue}
                  onChange={(e) => setBatchBidValue(e.target.value)}
                  placeholder={
                    batchBidType === "fixed" ? "输入新出价" : 
                    batchBidType === "cpc_multiplier" ? "例如: 1.2 表示 CPC×1.2" : 
                    "输入百分比"
                  }
                />
              </div>
            </div>
            {/* CPC调整方式说明 */}
            {(batchBidType === "cpc_multiplier" || batchBidType === "cpc_increase_percent" || batchBidType === "cpc_decrease_percent") && (
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
                <p className="font-medium mb-1">💡 CPC调整说明</p>
                <p>CPC = 花费 ÷ 点击数，代表实际每次点击成本</p>
                {batchBidType === "cpc_multiplier" && (
                  <p>例如：输入 1.2，则新出价 = CPC × 1.2</p>
                )}
                {batchBidType === "cpc_increase_percent" && (
                  <p>例如：输入 20，则新出价 = CPC × 1.2</p>
                )}
                {batchBidType === "cpc_decrease_percent" && (
                  <p>例如：输入 20，则新出价 = CPC × 0.8</p>
                )}
                <p className="mt-1 text-yellow-500">注意：无点击数据的投放词将使用当前出价作为CPC基数</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchBidOpen(false)}>取消</Button>
            <Button onClick={handleBatchBid} disabled={isMutating || !batchBidValue}>
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 批量修改状态弹窗 */}
      <Dialog open={batchStatusOpen} onOpenChange={setBatchStatusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量{batchStatus === "enabled" ? "启用" : "暂停"}投放词</DialogTitle>
            <DialogDescription>
              确定要{batchStatus === "enabled" ? "启用" : "暂停"} {selectedIds.size} 个投放词吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchStatusOpen(false)}>取消</Button>
            <Button 
              onClick={handleBatchStatus} 
              disabled={isMutating}
              variant={batchStatus === "paused" ? "destructive" : "default"}
            >
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认{batchStatus === "enabled" ? "启用" : "暂停"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 趋势图弹窗 */}
      {trendTarget && (
        <TargetTrendChart
          open={trendChartOpen}
          onOpenChange={setTrendChartOpen}
          targetId={trendTarget.id}
          targetType={trendTarget.type}
          targetName={trendTarget.name}
          matchType={trendTarget.matchType}
        />
      )}
    </>
  );
}

// 搜索词列表子组件
function SearchTermsList({ campaignId }: { campaignId: number }) {
  const { data: searchTerms, isLoading, refetch } = trpc.campaign.getSearchTerms.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  
  // 筛选状态
  const [showFilters, setShowFilters] = useState(false);
  const [stFilters, setStFilters] = useState({
    matchType: "all" as "all" | "broad" | "phrase" | "exact",
    spendMin: "",
    spendMax: "",
    salesMin: "",
    salesMax: "",
    ordersMin: "",
    ordersMax: "",
    acosMin: "",
    acosMax: "",
    roasMin: "",
    roasMax: "",
    ctrMin: "",
    ctrMax: "",
    cvrMin: "",
    cvrMax: "",
  });
  
  // 否定词弹窗状态
  const [negateDialogOpen, setNegateDialogOpen] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState<any>(null);
  const [negateMatchType, setNegateMatchType] = useState<"phrase" | "exact">("phrase");
  
  // 添加否定词 mutation
  const addNegativeKeywordMutation = trpc.adAutomation.applyNegativeKeywords.useMutation({
    onSuccess: () => {
      toast.success("已添加为否定关键词");
      setNegateDialogOpen(false);
      setSelectedTerm(null);
    },
    onError: (error: any) => {
      toast.error(`添加失败: ${error.message}`);
    }
  });
  
  // 处理否定词操作
  const handleNegate = (term: any) => {
    setSelectedTerm(term);
    setNegateDialogOpen(true);
  };
  
  // 确认添加否定词
  const confirmNegate = () => {
    if (!selectedTerm) return;
    addNegativeKeywordMutation.mutate({
      accountId: 1,
      campaignId,
      negatives: [{
        keyword: selectedTerm.searchTerm,
        matchType: negateMatchType,
      }]
    });
  };
  
  // 清除筛选
  const clearStFilters = () => {
    setStFilters({
      matchType: "all",
      spendMin: "",
      spendMax: "",
      salesMin: "",
      salesMax: "",
      ordersMin: "",
      ordersMax: "",
      acosMin: "",
      acosMax: "",
      roasMin: "",
      roasMax: "",
      ctrMin: "",
      ctrMax: "",
      cvrMin: "",
      cvrMax: "",
    });
  };
  
  // 检查是否有激活的筛选
  const hasActiveStFilters = () => {
    return stFilters.matchType !== "all" ||
      stFilters.spendMin !== "" ||
      stFilters.spendMax !== "" ||
      stFilters.salesMin !== "" ||
      stFilters.salesMax !== "" ||
      stFilters.ordersMin !== "" ||
      stFilters.ordersMax !== "" ||
      stFilters.acosMin !== "" ||
      stFilters.acosMax !== "" ||
      stFilters.roasMin !== "" ||
      stFilters.roasMax !== "" ||
      stFilters.ctrMin !== "" ||
      stFilters.ctrMax !== "" ||
      stFilters.cvrMin !== "" ||
      stFilters.cvrMax !== "";
  };
  
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  if (!searchTerms || searchTerms.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Tag className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无搜索词数据</p>
      </div>
    );
  }
  
  // 筛选搜索词
  const filteredTerms = searchTerms.filter((term: any) => {
    const stSpend = parseFloat(term.spend || "0");
    const stSales = parseFloat(term.sales || "0");
    const stAcos = stSales > 0 ? (stSpend / stSales * 100) : 0;
    const stRoas = stSpend > 0 ? (stSales / stSpend) : 0;
    const stCtr = term.impressions > 0 ? (term.clicks / term.impressions * 100) : 0;
    const stCvr = term.clicks > 0 ? ((term.orders || 0) / term.clicks * 100) : 0;
    
    // 匹配类型筛选
    if (stFilters.matchType !== "all" && term.matchType !== stFilters.matchType) return false;
    
    // 花费范围筛选
    if (stFilters.spendMin && stSpend < parseFloat(stFilters.spendMin)) return false;
    if (stFilters.spendMax && stSpend > parseFloat(stFilters.spendMax)) return false;
    
    // 销售额范围筛选
    if (stFilters.salesMin && stSales < parseFloat(stFilters.salesMin)) return false;
    if (stFilters.salesMax && stSales > parseFloat(stFilters.salesMax)) return false;
    
    // 订单范围筛选
    if (stFilters.ordersMin && (term.orders || 0) < parseInt(stFilters.ordersMin)) return false;
    if (stFilters.ordersMax && (term.orders || 0) > parseInt(stFilters.ordersMax)) return false;
    
    // ACoS范围筛选
    if (stFilters.acosMin && stAcos < parseFloat(stFilters.acosMin)) return false;
    if (stFilters.acosMax && stAcos > parseFloat(stFilters.acosMax)) return false;
    
    // ROAS范围筛选
    if (stFilters.roasMin && stRoas < parseFloat(stFilters.roasMin)) return false;
    if (stFilters.roasMax && stRoas > parseFloat(stFilters.roasMax)) return false;
    
    // 点击率范围筛选
    if (stFilters.ctrMin && stCtr < parseFloat(stFilters.ctrMin)) return false;
    if (stFilters.ctrMax && stCtr > parseFloat(stFilters.ctrMax)) return false;
    
    // 转化率范围筛选
    if (stFilters.cvrMin && stCvr < parseFloat(stFilters.cvrMin)) return false;
    if (stFilters.cvrMax && stCvr > parseFloat(stFilters.cvrMax)) return false;
    
    return true;
  });
  
  // 按销售额排序
  const sortedTerms = [...filteredTerms].sort((a: any, b: any) => 
    parseFloat(b.sales || "0") - parseFloat(a.sales || "0")
  );
  
  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-1" />
            筛选
            {hasActiveStFilters() && <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full px-1.5">•</span>}
          </Button>
          {hasActiveStFilters() && (
            <Button variant="ghost" size="sm" onClick={clearStFilters}>
              清除筛选
            </Button>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          共 {filteredTerms.length} / {searchTerms.length} 个搜索词
        </div>
      </div>
      
      {/* 筛选面板 */}
      {showFilters && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {/* 匹配类型 */}
              <div>
                <Label className="text-xs">匹配类型</Label>
                <Select value={stFilters.matchType} onValueChange={(v: any) => setStFilters({...stFilters, matchType: v})}>
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="broad">广泛</SelectItem>
                    <SelectItem value="phrase">词组</SelectItem>
                    <SelectItem value="exact">精确</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* 花费范围 */}
              <div>
                <Label className="text-xs">花费范围 ($)</Label>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="number"
                    placeholder="最小"
                    className="h-9"
                    value={stFilters.spendMin}
                    onChange={(e) => setStFilters({...stFilters, spendMin: e.target.value})}
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    className="h-9"
                    value={stFilters.spendMax}
                    onChange={(e) => setStFilters({...stFilters, spendMax: e.target.value})}
                  />
                </div>
              </div>
              
              {/* 订单范围 */}
              <div>
                <Label className="text-xs">订单范围</Label>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="number"
                    placeholder="最小"
                    className="h-9"
                    value={stFilters.ordersMin}
                    onChange={(e) => setStFilters({...stFilters, ordersMin: e.target.value})}
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    className="h-9"
                    value={stFilters.ordersMax}
                    onChange={(e) => setStFilters({...stFilters, ordersMax: e.target.value})}
                  />
                </div>
              </div>
              
              {/* ACoS范围 */}
              <div>
                <Label className="text-xs">ACoS范围 (%)</Label>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="number"
                    placeholder="最小"
                    className="h-9"
                    value={stFilters.acosMin}
                    onChange={(e) => setStFilters({...stFilters, acosMin: e.target.value})}
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    className="h-9"
                    value={stFilters.acosMax}
                    onChange={(e) => setStFilters({...stFilters, acosMax: e.target.value})}
                  />
                </div>
              </div>
              
              {/* ROAS范围 */}
              <div>
                <Label className="text-xs">ROAS范围</Label>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="number"
                    placeholder="最小"
                    className="h-9"
                    value={stFilters.roasMin}
                    onChange={(e) => setStFilters({...stFilters, roasMin: e.target.value})}
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    className="h-9"
                    value={stFilters.roasMax}
                    onChange={(e) => setStFilters({...stFilters, roasMax: e.target.value})}
                  />
                </div>
              </div>
              
              {/* 转化率范围 */}
              <div>
                <Label className="text-xs">转化率范围 (%)</Label>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="number"
                    placeholder="最小"
                    className="h-9"
                    value={stFilters.cvrMin}
                    onChange={(e) => setStFilters({...stFilters, cvrMin: e.target.value})}
                  />
                  <Input
                    type="number"
                    placeholder="最大"
                    className="h-9"
                    value={stFilters.cvrMax}
                    onChange={(e) => setStFilters({...stFilters, cvrMax: e.target.value})}
                  />
                </div>
              </div>
            </div>
            
            {/* 快捷筛选预设 */}
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground mr-2">快捷筛选:</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setStFilters({...stFilters, spendMin: "5", ordersMin: "", ordersMax: "0"})}
              >
                🚨 高花费0转化
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setStFilters({...stFilters, acosMin: "50", ordersMin: ""})}
              >
                ⚠️ ACoS{'>'}50%
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setStFilters({...stFilters, ordersMin: "3", acosMax: "25"})}
              >
                ⭐ 高价值词
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setStFilters({...stFilters, cvrMin: "10"})}
              >
                📈 高转化率
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* 搜索词表格 */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>客户搜索词</TableHead>
              <TableHead>源头投放词</TableHead>
              <TableHead>匹配方式</TableHead>
              <TableHead className="text-right">展示</TableHead>
              <TableHead className="text-right">点击</TableHead>
              <TableHead className="text-right">点击率</TableHead>
              <TableHead className="text-right">花费</TableHead>
              <TableHead className="text-right">订单</TableHead>
              <TableHead className="text-right">销售额</TableHead>
              <TableHead className="text-right">转化率</TableHead>
              <TableHead className="text-right">ACoS</TableHead>
              <TableHead className="text-right">ROAS</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTerms.map((term: any, index: number) => {
              const stSpend = parseFloat(term.spend || "0");
              const stSales = parseFloat(term.sales || "0");
              const stAcos = stSales > 0 ? (stSpend / stSales * 100) : 0;
              const stRoas = stSpend > 0 ? (stSales / stSpend) : 0;
              const stCtr = term.impressions > 0 ? (term.clicks / term.impressions * 100) : 0;
              const stCvr = term.clicks > 0 ? ((term.orders || 0) / term.clicks * 100) : 0;
              
              // 判断是否为低效搜索词（高花费0转化或ACoS过高）
              const isLowPerforming = (stSpend >= 5 && (term.orders || 0) === 0) || stAcos > 50;
              // 判断是否为高价值搜索词
              const isHighValue = (term.orders || 0) >= 3 && stAcos <= 25;
              
              return (
                <TableRow key={term.id || index} className={isLowPerforming ? "bg-red-500/5" : isHighValue ? "bg-green-500/5" : ""}>
                  <TableCell className="font-medium max-w-[180px] truncate" title={term.searchTerm}>
                    <div className="flex items-center gap-1">
                      {isLowPerforming && <span title="低效搜索词">🚨</span>}
                      {isHighValue && <span title="高价值搜索词">⭐</span>}
                      {term.searchTerm}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-muted-foreground" title={term.targetText}>
                    {term.targetText || "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {term.matchType === "exact" ? "精确" : term.matchType === "phrase" ? "词组" : "广泛"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{term.impressions?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right">{term.clicks?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right">{stCtr.toFixed(2)}%</TableCell>
                  <TableCell className="text-right">${stSpend.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{term.orders || 0}</TableCell>
                  <TableCell className="text-right">${stSales.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <span className={stCvr >= 10 ? "text-green-500" : stCvr >= 5 ? "text-yellow-500" : "text-muted-foreground"}>
                      {term.clicks > 0 ? `${stCvr.toFixed(1)}%` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={stAcos > 30 ? "text-red-500" : stAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                      {stSales > 0 ? `${stAcos.toFixed(1)}%` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={stRoas >= 4 ? "text-green-500" : stRoas >= 2 ? "text-yellow-500" : "text-muted-foreground"}>
                      {stSpend > 0 ? stRoas.toFixed(2) : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleNegate(term)}>
                          <Ban className="h-4 w-4 mr-2" />
                          添加为否定词
                        </DropdownMenuItem>
                        {isHighValue && (
                          <DropdownMenuItem onClick={() => toast.info("迁移功能开发中...")}>
                            <ArrowUpRight className="h-4 w-4 mr-2" />
                            迁移到精确匹配
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {/* 否定词弹窗 */}
      <Dialog open={negateDialogOpen} onOpenChange={setNegateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加为否定关键词</DialogTitle>
            <DialogDescription>
              将搜索词 "{selectedTerm?.searchTerm}" 添加为否定关键词，阻止广告在该搜索词上展示
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>否定匹配类型</Label>
              <Select value={negateMatchType} onValueChange={(v: "phrase" | "exact") => setNegateMatchType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phrase">
                    <div className="flex flex-col">
                      <span>词组否定</span>
                      <span className="text-xs text-muted-foreground">包含该词组的搜索词都不会触发广告</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="exact">
                    <div className="flex flex-col">
                      <span>精确否定</span>
                      <span className="text-xs text-muted-foreground">仅完全匹配该搜索词时不触发广告</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {selectedTerm && (
              <div className="bg-muted p-3 rounded-lg text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">花费:</span>
                  <span>${parseFloat(selectedTerm.spend || "0").toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">订单:</span>
                  <span>{selectedTerm.orders || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ACoS:</span>
                  <span>
                    {parseFloat(selectedTerm.sales || "0") > 0 
                      ? `${(parseFloat(selectedTerm.spend || "0") / parseFloat(selectedTerm.sales || "0") * 100).toFixed(1)}%`
                      : "-"}
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNegateDialogOpen(false)}>
              取消
            </Button>
            <Button 
              onClick={confirmNegate}
              disabled={addNegativeKeywordMutation.isPending}
            >
              {addNegativeKeywordMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />添加中...</>
              ) : (
                "确认添加"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
