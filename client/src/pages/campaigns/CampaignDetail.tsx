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
import { Filter, Ban, ArrowUpRight, ArrowRight, Clock, Plus } from "lucide-react";
// v381: TargetTrendChart和BidResponseCurve已移至AdGroupDetail页面
import { safeToLocaleString, safeToLocaleDateString } from '../../lib/safeDate';

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

// SP自动广告匹配组类型映射
const autoTargetingTypeLabels: Record<string, string> = {
  "QUERY_HIGH_REL_MATCHES": "紧密匹配",
  "QUERY_BROAD_REL_MATCHES": "宽泛匹配",
  "ASIN_ACCESSORY_RELATED": "关联商品",
  "ASIN_SUBSTITUTE_RELATED": "同类商品",
  "close-match": "紧密匹配",
  "loose-match": "宽泛匹配",
  "complements": "关联商品",
  "substitutes": "同类商品",
};

// 格式化自动定向表达式为用户友好的显示名称
export function formatAutoTargetingExpression(expression: string): string {
  if (!expression) return 'ASIN定向';
  
  // 尝试解析JSON格式
  try {
    const parsed = JSON.parse(expression);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const type = parsed[0]?.type;
      if (type && autoTargetingTypeLabels[type]) {
        return autoTargetingTypeLabels[type];
      }
    }
  } catch (e) {
    // 不是JSON格式，继续处理
  }
  
  // 检查是否是已知的自动定向类型
  if (autoTargetingTypeLabels[expression]) {
    return autoTargetingTypeLabels[expression];
  }
  
  // 检查是否包含自动定向关键词
  for (const [key, label] of Object.entries(autoTargetingTypeLabels)) {
    if (expression.includes(key)) {
      return label;
    }
  }
  
  // 检查是否是ASIN格式 (B0xxxxxxxxx)
  if (/^B0[A-Z0-9]{8,}$/i.test(expression)) {
    return `ASIN: ${expression}`;
  }
  
  // 检查是否是品类定向
  if (expression.toLowerCase().includes('category')) {
    return '品类定向';
  }
  
  return expression;
}

// v361: 子组件已拆分到 campaign-detail/ 目录
// v381: 严格对齐Amazon后台 - TargetsList/SearchTermsList/KeywordsList已移至AdGroupDetail页面
import { NegativeKeywordsList } from '../campaign-detail/NegativeKeywordsList';
import { PlacementPerformanceList } from '../campaign-detail/PlacementPerformanceList';

export default function CampaignDetail() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/campaigns/:id");
  const campaignId = params?.id ? parseInt(params.id) : null;
  
  const [activeTab, setActiveTab] = useState("adgroups");
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
  
  // v381: 获取变更历史（History tab）
  const { data: changeHistory, isLoading: historyLoading } = trpc.campaign.getChangeHistory.useQuery(
    { campaignId: campaignId!, page: 1, pageSize: 50 },
    { enabled: !!campaignId && activeTab === 'history' }
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
                <Badge variant={campaign.campaignStatus === "enabled" ? "default" : "secondary"}>
                  {campaign.campaignStatus === "enabled" ? "启用" : campaign.campaignStatus === "paused" ? "暂停" : "归档"}
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
        
        {/* v381: 严格对齐Amazon后台Campaign层级tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {/* 所有广告类型都有: Ad groups */}
            <TabsTrigger value="adgroups">广告组</TabsTrigger>
            {/* SP广告独有: Placements */}
            {(campaign.campaignType === "sp_auto" || campaign.campaignType === "sp_manual") && (
              <TabsTrigger value="placements">广告位</TabsTrigger>
            )}
            {/* SP广告独有: Negative keywords (Campaign级别) */}
            {(campaign.campaignType === "sp_auto" || campaign.campaignType === "sp_manual") && (
              <TabsTrigger value="negatives">否定关键词</TabsTrigger>
            )}
            {/* SB广告独有: Bid adjustments */}
            {campaign.campaignType === "sb" && (
              <TabsTrigger value="bidadjustments">出价调整</TabsTrigger>
            )}
            {/* 所有广告类型都有: Budget rules */}
            <TabsTrigger value="budgetrules">预算规则</TabsTrigger>
            {/* 所有广告类型都有: Campaign settings */}
            <TabsTrigger value="settings">广告活动设置</TabsTrigger>
            {/* 所有广告类型都有: History */}
            <TabsTrigger value="history">历史记录</TabsTrigger>
          </TabsList>
          
          <TabsContent value="settings" className="mt-4">
            <div className="space-y-4">
              {/* 基本信息卡片 */}
              <Card>
                <CardHeader>
                  <CardTitle>基本信息</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                      <p className="text-sm text-muted-foreground">计费方式</p>
                      <p className="font-medium">{campaign.costType === "vcpm" ? "VCPM (可见千次曝光)" : campaign.costType === "cpm" ? "CPM (千次曝光)" : "CPC (按点击)"}</p>
                    </div>
                    {(campaign as any).campaignGoal && (
                      <div>
                        <p className="text-sm text-muted-foreground">广告目标</p>
                        <p className="font-medium">{
                          (campaign as any).campaignGoal === 'DRIVE_PAGE_VISITS' || (campaign as any).campaignGoal === 'drivePageVisits' ? '驱动页面访问' :
                          (campaign as any).campaignGoal === 'GROW_BRAND_IMPRESSION_SHARE' || (campaign as any).campaignGoal === 'growBrandImpressionShare' ? '增长品牌展示份额' :
                          (campaign as any).campaignGoal === 'PROMOTE_PRODUCTS' || (campaign as any).campaignGoal === 'promoteProducts' ? '推广产品' :
                          (campaign as any).campaignGoal === 'reach' ? '触达用户' :
                          (campaign as any).campaignGoal === 'pageVisits' || (campaign as any).campaignGoal === 'page_visits' ? '驱动页面访问' :
                          (campaign as any).campaignGoal === 'conversions' ? '促进转化' :
                          (campaign as any).campaignGoal
                        }</p>
                      </div>
                    )}
                    {(campaign as any).adFormat && (
                      <div>
                        <p className="text-sm text-muted-foreground">广告格式</p>
                        <p className="font-medium">{
                          (campaign as any).adFormat === 'productCollection' ? '商品集' :
                          (campaign as any).adFormat === 'video' ? '视频广告' :
                          (campaign as any).adFormat === 'storeSpotlight' ? '旗舰店聚焦' :
                          (campaign as any).adFormat === 'brandVideo' ? '品牌视频' :
                          (campaign as any).adFormat
                        }</p>
                      </div>
                    )}
                    <div>
                      <p className="text-sm text-muted-foreground">日预算</p>
                      <p className="font-medium">${campaign.dailyBudget || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">竞价策略</p>
                      <p className="font-medium">{
                        campaign.biddingStrategy === "autoForSales" ? "自动竞价(销售优化)" :
                        campaign.biddingStrategy === "legacyForSales" ? "固定竞价" :
                        campaign.biddingStrategy === "ruleBasedBidding" ? "基于规则" : "手动竞价"
                      }</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">开始日期</p>
                      <p className="font-medium">{campaign.startDate || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">结束日期</p>
                      <p className="font-medium">{campaign.endDate || "无限期"}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* SP自动广告特有信息 */}
              {campaign.campaignType === "sp_auto" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="h-5 w-5" />
                      SP自动广告设置
                    </CardTitle>
                    <CardDescription>自动定向匹配组设置</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">紧密匹配</p>
                        <p className="font-medium text-green-500">启用</p>
                        <p className="text-xs text-muted-foreground mt-1">与商品高度相关的搜索词</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">宽泛匹配</p>
                        <p className="font-medium text-green-500">启用</p>
                        <p className="text-xs text-muted-foreground mt-1">与商品松散相关的搜索词</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">同类商品</p>
                        <p className="font-medium text-green-500">启用</p>
                        <p className="text-xs text-muted-foreground mt-1">与您商品相似的商品页</p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <p className="text-sm text-muted-foreground">关联商品</p>
                        <p className="font-medium text-green-500">启用</p>
                        <p className="text-xs text-muted-foreground mt-1">与您商品互补的商品页</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {/* SP手动广告特有信息 */}
              {campaign.campaignType === "sp_manual" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5" />
                      SP手动广告设置
                    </CardTitle>
                    <CardDescription>关键词/商品定向设置</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">最高出价</p>
                        <p className="font-medium">${campaign.maxBid || "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">搜索顶部出价调整</p>
                        <p className="font-medium">{campaign.placementTopSearchBidAdjustment || 0}%</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">商品页出价调整</p>
                        <p className="font-medium">{campaign.placementProductPageBidAdjustment || 0}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {/* SB品牌广告特有信息 */}
              {campaign.campaignType === "sb" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Megaphone className="h-5 w-5" />
                      SB品牌广告设置
                    </CardTitle>
                    <CardDescription>品牌推广广告配置</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">广告格式</p>
                        <p className="font-medium">{
                          campaign.adFormat === "productCollection" ? "商品集" :
                          campaign.adFormat === "video" ? "品牌视频" :
                          campaign.adFormat === "storeSpotlight" ? "品牌旗舰店焦点" :
                          campaign.adFormat === "brandVideo" ? "品牌视频" : "N/A"
                        }</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">落地页类型</p>
                        <p className="font-medium">{
                          campaign.landingPageType === "store" ? "品牌旗舰店" :
                          campaign.landingPageType === "productList" ? "商品列表" :
                          campaign.landingPageType === "customUrl" ? "自定义URL" : "N/A"
                        }</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">品牌实体ID</p>
                        <p className="font-medium">{campaign.brandEntityId || "N/A"}</p>
                      </div>
                      {campaign.headline && (
                        <div className="col-span-full">
                          <p className="text-sm text-muted-foreground">广告标题</p>
                          <p className="font-medium">{campaign.headline}</p>
                        </div>
                      )}
                    </div>
                    
                    {/* SB新客指标 */}
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="text-sm font-medium mb-3">新客指标 (NTB)</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">新客订单</p>
                          <p className="font-medium">{campaign.ntbOrders || 0}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">新客订单占比</p>
                          <p className="font-medium">{campaign.ntbOrdersPercent || 0}%</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">新客销售额</p>
                          <p className="font-medium">${parseFloat(campaign.ntbSales || "0").toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">新客销售占比</p>
                          <p className="font-medium">{campaign.ntbSalesPercent || 0}%</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* SB视频指标 */}
                    {(campaign.adFormat === "video" || campaign.adFormat === "brandVideo") && (
                      <div className="mt-4 pt-4 border-t">
                        <h4 className="text-sm font-medium mb-3">视频指标</h4>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                          <div>
                            <p className="text-sm text-muted-foreground">25%播放</p>
                            <p className="font-medium">{campaign.videoFirstQuartile || 0}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">50%播放</p>
                            <p className="font-medium">{campaign.videoMidpoint || 0}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">75%播放</p>
                            <p className="font-medium">{campaign.videoThirdQuartile || 0}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">完整播放</p>
                            <p className="font-medium">{campaign.videoComplete || 0}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">VTR</p>
                            <p className="font-medium">{((Number(campaign.vtr) || 0) * 100).toFixed(2)}%</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              
              {/* SD展示广告特有信息 */}
              {campaign.campaignType === "sd" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Monitor className="h-5 w-5" />
                      SD展示广告设置
                    </CardTitle>
                    <CardDescription>展示型推广广告配置</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">计费方式</p>
                        <p className="font-medium">{campaign.costType === "vcpm" ? "VCPM (可见千次曝光)" : "CPC (按点击)"}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">竞价优化目标</p>
                        <p className="font-medium">{
                          campaign.bidOptimization === "reach" ? "触达优化" :
                          campaign.bidOptimization === "pageVisits" ? "页面访问优化" :
                          campaign.bidOptimization === "conversions" ? "转化优化" : "N/A"
                        }</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">定向策略</p>
                        <p className="font-medium">{
                          campaign.tactic === "T00001" ? "商品定向" :
                          campaign.tactic === "T00020" ? "浏览再营销" :
                          campaign.tactic === "T00030" ? "购买再营销" :
                          campaign.tactic === "T00040" ? "亚马逊受众" : "N/A"
                        }</p>
                      </div>
                    </div>
                    
                    {/* SD可见性指标 */}
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="text-sm font-medium mb-3">可见性指标</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">可见曝光</p>
                          <p className="font-medium">{campaign.viewableImpressions || 0}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">VCPM</p>
                          <p className="font-medium">${parseFloat(campaign.vcpm || "0").toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">vCTR</p>
                          <p className="font-medium">{((Number(campaign.vctr) || 0) * 100).toFixed(2)}%</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">详情页浏览</p>
                          <p className="font-medium">{campaign.detailPageViews || 0}</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* SD浏览归因指标 */}
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="text-sm font-medium mb-3">浏览归因指标</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">浏览归因销售额</p>
                          <p className="font-medium">${parseFloat(campaign.viewAttributedSales || "0").toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">浏览归因订单</p>
                          <p className="font-medium">{campaign.viewAttributedOrders || 0}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">浏览归因详情页</p>
                          <p className="font-medium">{campaign.viewAttributedDpv || 0}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">浏览归因新客销售</p>
                          <p className="font-medium">${parseFloat(campaign.viewAttributedNtbSales || "0").toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* SD新客指标 */}
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="text-sm font-medium mb-3">新客指标 (NTB)</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">新客订单</p>
                          <p className="font-medium">{campaign.ntbOrders || 0}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">新客订单占比</p>
                          <p className="font-medium">{campaign.ntbOrdersPercent || 0}%</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">新客销售额</p>
                          <p className="font-medium">${parseFloat(campaign.ntbSales || "0").toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">新客销售占比</p>
                          <p className="font-medium">{campaign.ntbSalesPercent || 0}%</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {/* 位置出价调整卡片 (SP广告) */}
              {(campaign.campaignType === "sp_auto" || campaign.campaignType === "sp_manual") && (
                <Card>
                  <CardHeader>
                    <CardTitle>位置出价调整</CardTitle>
                    <CardDescription>不同广告位置的出价调整百分比</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 border rounded-lg text-center">
                        <p className="text-sm text-muted-foreground">搜索顶部</p>
                        <p className="text-2xl font-bold text-primary">{campaign.placementTopSearchBidAdjustment || 0}%</p>
                      </div>
                      <div className="p-3 border rounded-lg text-center">
                        <p className="text-sm text-muted-foreground">商品详情页</p>
                        <p className="text-2xl font-bold text-primary">{campaign.placementProductPageBidAdjustment || 0}%</p>
                      </div>
                      <div className="p-3 border rounded-lg text-center">
                        <p className="text-sm text-muted-foreground">其他位置</p>
                        <p className="text-2xl font-bold text-primary">{campaign.placementRestBidAdjustment || 0}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="placements" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>广告位置绩效</CardTitle>
                <CardDescription>不同广告展示位置的绩效数据</CardDescription>
              </CardHeader>
              <CardContent>
                <PlacementPerformanceList campaignId={campaignId} campaignType={campaign.campaignType} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* v381: SB广告的出价调整tab */}
          {campaign.campaignType === "sb" && (
            <TabsContent value="bidadjustments" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>出价调整</CardTitle>
                  <CardDescription>品牌广告的出价调整设置（对应Amazon Ads后台的Bid adjustments）</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 border rounded-lg">
                      <p className="text-sm text-muted-foreground mb-1">搜索结果顶部</p>
                      <p className="text-2xl font-bold text-primary">{campaign.placementTopSearchBidAdjustment || 0}%</p>
                      <p className="text-xs text-muted-foreground mt-2">在搜索结果顶部显示时的出价调整百分比</p>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <p className="text-sm text-muted-foreground mb-1">商品详情页</p>
                      <p className="text-2xl font-bold text-primary">{campaign.placementProductPageBidAdjustment || 0}%</p>
                      <p className="text-xs text-muted-foreground mt-2">在商品详情页显示时的出价调整百分比</p>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <p className="text-sm text-muted-foreground mb-1">其他位置</p>
                      <p className="text-2xl font-bold text-primary">{campaign.placementRestBidAdjustment || 0}%</p>
                      <p className="text-xs text-muted-foreground mt-2">在其他广告位置显示时的出价调整百分比</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

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
                  <div className="space-y-6">
                    {/* 广告组数据表格 */}
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>广告组名称</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead className="text-right">默认出价</TableHead>
                            <TableHead className="text-right">曝光</TableHead>
                            <TableHead className="text-right">点击</TableHead>
                            <TableHead className="text-right">CTR</TableHead>
                            <TableHead className="text-right">CPC</TableHead>
                            <TableHead className="text-right">花费</TableHead>
                            <TableHead className="text-right">订单</TableHead>
                            <TableHead className="text-right">销售额</TableHead>
                            <TableHead className="text-right">ACoS</TableHead>
                            <TableHead className="text-right">ROAS</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {adGroups.map((adGroup: any) => {
                            const agSpend = parseFloat(adGroup.spend || "0");
                            const agSales = parseFloat(adGroup.sales || "0");
                            const agImpressions = adGroup.impressions || 0;
                            const agClicks = adGroup.clicks || 0;
                            const agOrders = adGroup.orders || 0;
                            const agAcos = agSales > 0 ? (agSpend / agSales * 100) : 0;
                            const agRoas = agSpend > 0 ? (agSales / agSpend) : 0;
                            const agCtr = agImpressions > 0 ? (agClicks / agImpressions * 100) : 0;
                            const agCpc = agClicks > 0 ? (agSpend / agClicks) : 0;
                            return (
                              <TableRow key={adGroup.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/ad-groups/${adGroup.id}`)}>
                                <TableCell className="font-medium max-w-[200px] truncate" title={adGroup.adGroupName}>{adGroup.adGroupName}</TableCell>
                                <TableCell>
                                  <Badge variant={adGroup.adGroupStatus === "enabled" || adGroup.status === "enabled" ? "default" : "secondary"}>
                                    {adGroup.adGroupStatus === "enabled" || adGroup.status === "enabled" ? "启用" : "暂停"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">${adGroup.defaultBid || "N/A"}</TableCell>
                                <TableCell className="text-right">{agImpressions.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{agClicks.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{agCtr.toFixed(2)}%</TableCell>
                                <TableCell className="text-right">${agCpc.toFixed(2)}</TableCell>
                                <TableCell className="text-right">${agSpend.toFixed(2)}</TableCell>
                                <TableCell className="text-right">{agOrders}</TableCell>
                                <TableCell className="text-right">${agSales.toFixed(2)}</TableCell>
                                <TableCell className="text-right">
                                  <span className={agAcos > 30 ? "text-red-500" : agAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                                    {agSales > 0 ? `${agAcos.toFixed(2)}%` : "N/A"}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <span className={agRoas < 2 ? "text-red-500" : agRoas < 3 ? "text-yellow-500" : "text-green-500"}>
                                    {agSpend > 0 ? agRoas.toFixed(2) : "N/A"}
                                  </span>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    {/* SB品牌广告素材信息 */}
                    {campaign.campaignType === "sb" && adGroups.some((ag: any) => ag.headline || ag.videoAssetId || ag.brandLogoAssetId || ag.customImageAssetId || ag.videoUrl || ag.brandLogoUrl || ag.customImageUrl) && (
                      <Card className="border-blue-200 bg-blue-50/30">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">品牌广告素材信息</CardTitle>
                          <CardDescription>该广告活动下的SB品牌广告创意素材</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {adGroups.filter((ag: any) => ag.headline || ag.videoAssetId || ag.brandLogoAssetId || ag.customImageAssetId || ag.videoUrl || ag.brandLogoUrl || ag.customImageUrl).map((adGroup: any) => (
                              <div key={adGroup.id} className="border rounded-lg p-4 bg-white">
                                <h4 className="font-medium text-sm mb-3">{adGroup.adGroupName}</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                  {/* 标题 */}
                                  {adGroup.headline && (
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-1">广告标题</p>
                                      <p className="text-sm font-medium">{adGroup.headline}</p>
                                    </div>
                                  )}
                                  {/* 创意类型 */}
                                  {adGroup.creativeType && (
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-1">创意类型</p>
                                      <Badge variant="outline">{adGroup.creativeType === 'video' ? '视频广告' : adGroup.creativeType === 'productCollection' ? '商品集' : adGroup.creativeType === 'storeSpotlight' ? '店铺聚焦' : adGroup.creativeType}</Badge>
                                    </div>
                                  )}
                                  {/* 落地页 */}
                                  {adGroup.landingPageUrl && (
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-1">落地页</p>
                                      <a href={adGroup.landingPageUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate block max-w-[250px]" title={adGroup.landingPageUrl}>{adGroup.landingPageUrl}</a>
                                    </div>
                                  )}
                                  {/* 品牌Logo */}
                                  {(adGroup.brandLogoUrl || adGroup.brandLogoAssetId) && (
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-1">品牌Logo</p>
                                      {adGroup.brandLogoUrl ? (
                                        <a href={adGroup.brandLogoUrl} target="_blank" rel="noopener noreferrer" title="点击查看原图">
                                          <img src={adGroup.brandLogoUrl} alt="Brand Logo" className="h-14 w-auto rounded border hover:shadow-md hover:border-blue-300 transition-all cursor-pointer" />
                                        </a>
                                      ) : (
                                        <div className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-dashed">
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                          <p className="text-xs text-muted-foreground">Asset ID: {adGroup.brandLogoAssetId}</p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {/* 自定义图片 */}
                                  {(adGroup.customImageUrl || adGroup.customImageAssetId) && (
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-1">自定义图片</p>
                                      {adGroup.customImageUrl ? (
                                        <a href={adGroup.customImageUrl} target="_blank" rel="noopener noreferrer" title="点击查看原图">
                                          <img src={adGroup.customImageUrl} alt="Custom Image" className="h-24 w-auto rounded border hover:shadow-md hover:border-blue-300 transition-all cursor-pointer" />
                                        </a>
                                      ) : (
                                        <div className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-dashed">
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                          <p className="text-xs text-muted-foreground">Asset ID: {adGroup.customImageAssetId}</p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {/* 视频素材 */}
                                  {(adGroup.videoUrl || adGroup.videoAssetId) && (
                                    <div className="col-span-full">
                                      <p className="text-xs text-muted-foreground mb-1">视频素材</p>
                                      {adGroup.videoUrl ? (
                                        <div className="space-y-2">
                                          <div className="relative max-w-md rounded-lg overflow-hidden border bg-black">
                                            <video 
                                              controls 
                                              preload="metadata"
                                              poster={adGroup.videoThumbnailUrl || undefined}
                                              className="w-full max-h-[280px]"
                                            >
                                              <source src={adGroup.videoUrl} type="video/mp4" />
                                              您的浏览器不支持视频播放
                                            </video>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <a href={adGroup.videoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">在新窗口打开视频</a>
                                            {adGroup.videoAssetId && <span className="text-xs text-muted-foreground">| Asset ID: {adGroup.videoAssetId}</span>}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-dashed">
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                          <div>
                                            <p className="text-xs text-muted-foreground">Video Asset ID: {adGroup.videoAssetId}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">视频URL将在下次同步后自动解析</p>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>暂无广告组数据</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* SP广告 Campaign级别否定关键词 (Negative keywords) */}
          <TabsContent value="negatives" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>否定关键词</CardTitle>
                <CardDescription>该广告活动的Campaign级别否定关键词（对应Amazon后台的Negative keywords）</CardDescription>
              </CardHeader>
              <CardContent>
                <NegativeKeywordsList campaignId={campaignId} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* 预算规则 (Budget rules) */}
          <TabsContent value="budgetrules" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>预算规则</CardTitle>
                <CardDescription>基于规则的预算调整（对应Amazon后台的Budget rules）</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* 当前预算信息 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 border rounded-lg">
                      <p className="text-sm text-muted-foreground mb-1">日预算</p>
                      <p className="text-2xl font-bold text-primary">${campaign.dailyBudget || "N/A"}</p>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <p className="text-sm text-muted-foreground mb-1">广告活动状态</p>
                      <p className="text-lg font-medium">
                        {campaign.campaignStatus === "enabled" ? "投放中" : 
                         campaign.campaignStatus === "paused" ? "已暂停" : 
                         campaign.campaignStatus === "archived" ? "已归档" : campaign.campaignStatus}
                      </p>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <p className="text-sm text-muted-foreground mb-1">开始日期</p>
                      <p className="text-lg font-medium">{campaign.startDate || "N/A"}</p>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <p className="text-sm text-muted-foreground mb-1">结束日期</p>
                      <p className="text-lg font-medium">{campaign.endDate || "无限期"}</p>
                    </div>
                  </div>
                  
                  {/* 预算规则列表 */}
                  <div className="border rounded-lg p-4">
                    <h4 className="font-medium mb-3">预算规则列表</h4>
                    <div className="text-center py-8 text-muted-foreground">
                      <DollarSign className="h-10 w-10 mx-auto mb-3 opacity-50" />
                      <p>暂无预算规则</p>
                      <p className="text-sm mt-2">预算规则可以根据时间段或绩效指标自动调整广告活动的日预算</p>
                      <p className="text-xs mt-1 text-muted-foreground/70">支持基于日期的规则（如Prime Day期间增加预算）和基于绩效的规则（如ACoS低于目标时增加预算）</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 历史记录 (History) */}
          <TabsContent value="history" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>历史记录</CardTitle>
                <CardDescription>该广告活动的变更历史记录，包括出价调整、预算变更、状态修改等（对应Amazon后台的History）</CardDescription>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">加载历史记录...</span>
                  </div>
                ) : changeHistory && changeHistory.records && changeHistory.records.length > 0 ? (
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground">
                      共 {changeHistory.total} 条变更记录
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>时间</TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead>目标</TableHead>
                          <TableHead>原始值</TableHead>
                          <TableHead>新值</TableHead>
                          <TableHead>变化</TableHead>
                          <TableHead>来源</TableHead>
                          <TableHead>状态</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {changeHistory.records.map((record: any) => (
                          <TableRow key={record.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {record.timestamp ? new Date(record.timestamp).toLocaleString('zh-CN') : '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant={record.type === 'bid_adjustment' ? 'default' : 'secondary'}>
                                {record.typeLabel}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate" title={record.target}>
                              {record.target}
                              {record.matchType && (
                                <span className="text-xs text-muted-foreground ml-1">({record.matchType})</span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-sm">{record.previousValue}</TableCell>
                            <TableCell className="font-mono text-sm">{record.newValue}</TableCell>
                            <TableCell className="text-sm">
                              {record.changePercent && (
                                <span className={parseFloat(record.changePercent) > 0 ? 'text-green-500' : 'text-red-500'}>
                                  {parseFloat(record.changePercent) > 0 ? '+' : ''}{record.changePercent}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {record.source === 'auto_optimal' ? '自动优化' :
                                 record.source === 'auto_dayparting' ? '分时优化' :
                                 record.source === 'auto_placement' ? '广告位优化' :
                                 record.source === 'manual' ? '手动' :
                                 record.source === 'batch_campaign' ? '批量操作' :
                                 record.source === 'rule_based' ? '规则触发' :
                                 record.source === 'api_sync' ? 'API同步' :
                                 record.source || '未知'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={record.status === 'applied' ? 'default' : record.status === 'failed' ? 'destructive' : 'secondary'}>
                                {record.status === 'applied' ? '已应用' :
                                 record.status === 'pending' ? '待执行' :
                                 record.status === 'failed' ? '失败' :
                                 record.status === 'rolled_back' ? '已回滚' : record.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>暂无变更历史记录</p>
                    <p className="text-sm mt-2">当系统执行出价调整、预算变更等操作时，变更记录将显示在此处</p>
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

