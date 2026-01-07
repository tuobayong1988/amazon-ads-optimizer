import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { 
  Brain, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle2, 
  Settings2, 
  Play, 
  RefreshCw,
  ChevronRight,
  Info,
  Zap,
  Target,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Sparkles,
  Shield,
  LineChart,
  PieChart
} from "lucide-react";

export default function IntelligentBudgetAllocation() {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("suggestions");
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showSimulationDialog, setShowSimulationDialog] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const [simulationBudget, setSimulationBudget] = useState<number>(0);
  const [selectedSuggestions, setSelectedSuggestions] = useState<number[]>([]);
  
  // 获取绩效组列表
  const { user } = useAuth();
  const { data: performanceGroups } = trpc.performanceGroup.list.useQuery(
    { accountId: 0 },
    { enabled: !!user }
  );
  
  // 获取预算分配建议
  const { data: suggestionsData, isLoading: loadingSuggestions, refetch: refetchSuggestions } = 
    trpc.intelligentBudgetAllocation.getSuggestions.useQuery(
      { performanceGroupId: selectedGroupId! },
      { enabled: !!selectedGroupId }
    );
  
  // 获取配置
  const { data: config, refetch: refetchConfig } = trpc.intelligentBudgetAllocation.getConfig.useQuery(
    { performanceGroupId: selectedGroupId! },
    { enabled: !!selectedGroupId }
  );
  
  // 获取广告活动表现数据
  const { data: campaignPerformance } = trpc.intelligentBudgetAllocation.getCampaignPerformance.useQuery(
    { performanceGroupId: selectedGroupId! },
    { enabled: !!selectedGroupId }
  );
  
  // 场景模拟
  const { data: simulationResult } = trpc.intelligentBudgetAllocation.simulateScenario.useQuery(
    { 
      performanceGroupId: selectedGroupId!, 
      campaignId: selectedCampaign?.campaignId || 0,
      newBudget: simulationBudget 
    },
    { enabled: !!selectedGroupId && !!selectedCampaign && simulationBudget > 0 }
  );
  
  // 更新配置
  const updateConfigMutation = trpc.intelligentBudgetAllocation.updateConfig.useMutation({
    onSuccess: () => {
      refetchConfig();
      setShowConfigDialog(false);
    }
  });
  
  // 应用建议
  const applySuggestionsMutation = trpc.intelligentBudgetAllocation.applySuggestions.useMutation({
    onSuccess: () => {
      refetchSuggestions();
      setSelectedSuggestions([]);
    }
  });
  
  const handleApplySuggestions = () => {
    if (selectedSuggestions.length > 0) {
      applySuggestionsMutation.mutate({ suggestionIds: selectedSuggestions });
    }
  };
  
  const getRiskBadge = (riskLevel: string) => {
    switch (riskLevel) {
      case 'low':
        return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">低风险</Badge>;
      case 'medium':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">中风险</Badge>;
      case 'high':
        return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">高风险</Badge>;
      default:
        return null;
    }
  };
  
  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-green-500";
    if (score >= 50) return "text-yellow-500";
    return "text-red-500";
  };
  
  const getAdjustmentIcon = (amount: number) => {
    if (amount > 0.5) return <ArrowUpRight className="h-4 w-4 text-green-500" />;
    if (amount < -0.5) return <ArrowDownRight className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              智能预算分配
            </h1>
            <p className="text-muted-foreground mt-1">
              基于多维度评分和边际效益分析，智能优化绩效组内广告活动的预算分配
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={selectedGroupId?.toString() || ""}
              onValueChange={(v) => setSelectedGroupId(Number(v))}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="选择绩效组" />
              </SelectTrigger>
              <SelectContent>
                {performanceGroups?.map((group) => (
                  <SelectItem key={group.id} value={group.id.toString()}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setShowConfigDialog(true)} disabled={!selectedGroupId}>
              <Settings2 className="h-4 w-4 mr-2" />
              配置
            </Button>
            <Button onClick={() => refetchSuggestions()} disabled={!selectedGroupId}>
              <RefreshCw className="h-4 w-4 mr-2" />
              刷新分析
            </Button>
          </div>
        </div>
        
        {!selectedGroupId ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Brain className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">请选择绩效组</h3>
              <p className="text-muted-foreground text-center max-w-md">
                选择一个绩效组后，系统将分析组内所有广告活动的表现数据，生成智能预算分配建议
              </p>
            </CardContent>
          </Card>
        ) : loadingSuggestions ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <RefreshCw className="h-12 w-12 text-primary animate-spin mb-4" />
              <p className="text-muted-foreground">正在分析广告活动数据...</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* 汇总卡片 */}
            {suggestionsData && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">当前总预算</p>
                        <p className="text-2xl font-bold">
                          ${suggestionsData.groupSummary.totalCurrentBudget.toFixed(2)}
                        </p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Target className="h-6 w-6 text-primary" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">平均综合得分</p>
                        <p className={`text-2xl font-bold ${getScoreColor(suggestionsData.groupSummary.avgScore)}`}>
                          {suggestionsData.groupSummary.avgScore.toFixed(1)}
                        </p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <BarChart3 className="h-6 w-6 text-primary" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">建议增加预算</p>
                        <p className="text-2xl font-bold text-green-500">
                          {suggestionsData.groupSummary.campaignsToIncrease} 个
                        </p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                        <TrendingUp className="h-6 w-6 text-green-500" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">建议减少预算</p>
                        <p className="text-2xl font-bold text-red-500">
                          {suggestionsData.groupSummary.campaignsToDecrease} 个
                        </p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center">
                        <TrendingDown className="h-6 w-6 text-red-500" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
            
            {/* 警告提示 */}
            {suggestionsData?.warnings && suggestionsData.warnings.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>数据异常警告</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc list-inside mt-2">
                    {suggestionsData.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            
            {/* 主要内容区 */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="suggestions">
                  <Sparkles className="h-4 w-4 mr-2" />
                  分配建议
                </TabsTrigger>
                <TabsTrigger value="scenario">
                  <Zap className="h-4 w-4 mr-2" />
                  情景模拟
                </TabsTrigger>
                <TabsTrigger value="analysis">
                  <LineChart className="h-4 w-4 mr-2" />
                  详细分析
                </TabsTrigger>
                <TabsTrigger value="scores">
                  <PieChart className="h-4 w-4 mr-2" />
                  评分明细
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="suggestions" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>预算分配建议</CardTitle>
                      <CardDescription>
                        基于多维度评分和边际效益分析生成的智能预算调整建议
                      </CardDescription>
                    </div>
                    {selectedSuggestions.length > 0 && (
                      <Button onClick={handleApplySuggestions} disabled={applySuggestionsMutation.isPending}>
                        <Play className="h-4 w-4 mr-2" />
                        应用选中的 {selectedSuggestions.length} 条建议
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {suggestionsData?.suggestions.map((suggestion) => (
                        <div
                          key={suggestion.campaignId}
                          className={`p-4 border rounded-lg transition-colors ${
                            selectedSuggestions.includes(suggestion.campaignId)
                              ? 'border-primary bg-primary/5'
                              : 'hover:border-muted-foreground/30'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-4">
                              <input
                                type="checkbox"
                                checked={selectedSuggestions.includes(suggestion.campaignId)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedSuggestions([...selectedSuggestions, suggestion.campaignId]);
                                  } else {
                                    setSelectedSuggestions(selectedSuggestions.filter(id => id !== suggestion.campaignId));
                                  }
                                }}
                                className="mt-1"
                              />
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="font-medium">{suggestion.campaignName}</h4>
                                  {getRiskBadge(suggestion.riskLevel)}
                                  <Badge variant="outline" className="text-xs">
                                    置信度 {suggestion.confidence}%
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-4 mt-2 text-sm">
                                  <span className="text-muted-foreground">
                                    当前预算: <span className="text-foreground font-medium">${suggestion.currentBudget.toFixed(2)}</span>
                                  </span>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-muted-foreground">
                                    建议预算: <span className={`font-medium ${suggestion.adjustmentAmount > 0 ? 'text-green-500' : suggestion.adjustmentAmount < 0 ? 'text-red-500' : 'text-foreground'}`}>
                                      ${suggestion.suggestedBudget.toFixed(2)}
                                    </span>
                                  </span>
                                  <span className="flex items-center gap-1">
                                    {getAdjustmentIcon(suggestion.adjustmentAmount)}
                                    <span className={suggestion.adjustmentAmount > 0 ? 'text-green-500' : suggestion.adjustmentAmount < 0 ? 'text-red-500' : 'text-muted-foreground'}>
                                      {suggestion.adjustmentPercent > 0 ? '+' : ''}{suggestion.adjustmentPercent.toFixed(1)}%
                                    </span>
                                  </span>
                                </div>
                                <div className="mt-2 text-sm text-muted-foreground">
                                  {suggestion.reasons.slice(0, 2).join(' · ')}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={`text-2xl font-bold ${getScoreColor(suggestion.scores.compositeScore)}`}>
                                {suggestion.scores.compositeScore.toFixed(0)}
                              </div>
                              <div className="text-xs text-muted-foreground">综合得分</div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="mt-2"
                                onClick={() => {
                                  setSelectedCampaign(suggestion);
                                  setSimulationBudget(suggestion.suggestedBudget);
                                  setShowSimulationDialog(true);
                                }}
                              >
                                <Zap className="h-3 w-3 mr-1" />
                                模拟效果
                              </Button>
                            </div>
                          </div>
                          
                          {/* 预测效果 */}
                          <div className="mt-4 pt-4 border-t grid grid-cols-4 gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground">预计花费</span>
                              <p className="font-medium">${suggestion.predictedSpend.toFixed(2)}/天</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">预计销售额</span>
                              <p className="font-medium">${suggestion.predictedSales.toFixed(2)}/天</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">预计转化</span>
                              <p className="font-medium">{suggestion.predictedConversions.toFixed(1)}/天</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">预计ROAS</span>
                              <p className="font-medium">{suggestion.predictedROAS.toFixed(2)}</p>
                            </div>
                          </div>
                          
                          {/* 风险因素 */}
                          {suggestion.riskFactors.length > 0 && (
                            <div className="mt-3 flex items-start gap-2 text-sm">
                              <Shield className="h-4 w-4 text-yellow-500 mt-0.5" />
                              <span className="text-yellow-600">{suggestion.riskFactors.join(' · ')}</span>
                            </div>
                          )}
                        </div>
                      ))}
                      
                      {(!suggestionsData?.suggestions || suggestionsData.suggestions.length === 0) && (
                        <div className="text-center py-8 text-muted-foreground">
                          暂无预算分配建议
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              {/* 情景模拟 Tab */}
              <TabsContent value="scenario" className="mt-4">
                <ScenarioSimulation 
                  performanceGroupId={selectedGroupId}
                  suggestionsData={suggestionsData}
                  campaignPerformance={campaignPerformance}
                />
              </TabsContent>
              
              <TabsContent value="analysis" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>广告活动表现分析</CardTitle>
                    <CardDescription>
                      各广告活动的多时间窗口表现数据对比
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-2">广告活动</th>
                            <th className="text-right py-3 px-2">当前预算</th>
                            <th className="text-right py-3 px-2">7天ROAS</th>
                            <th className="text-right py-3 px-2">14天ROAS</th>
                            <th className="text-right py-3 px-2">30天ROAS</th>
                            <th className="text-right py-3 px-2">预算利用率</th>
                            <th className="text-right py-3 px-2">日均转化</th>
                            <th className="text-right py-3 px-2">趋势</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaignPerformance?.map((campaign) => {
                            const trend = campaign.roas7d > campaign.roas30d * 1.05 
                              ? 'up' 
                              : campaign.roas7d < campaign.roas30d * 0.95 
                                ? 'down' 
                                : 'stable';
                            return (
                              <tr key={campaign.campaignId} className="border-b hover:bg-muted/50">
                                <td className="py-3 px-2 font-medium">{campaign.campaignName}</td>
                                <td className="text-right py-3 px-2">${campaign.currentBudget.toFixed(2)}</td>
                                <td className="text-right py-3 px-2">{campaign.roas7d.toFixed(2)}</td>
                                <td className="text-right py-3 px-2">{campaign.roas14d.toFixed(2)}</td>
                                <td className="text-right py-3 px-2">{campaign.roas30d.toFixed(2)}</td>
                                <td className="text-right py-3 px-2">
                                  <div className="flex items-center justify-end gap-2">
                                    <Progress value={campaign.budgetUtilization} className="w-16 h-2" />
                                    <span>{campaign.budgetUtilization.toFixed(0)}%</span>
                                  </div>
                                </td>
                                <td className="text-right py-3 px-2">{campaign.dailyAvgConversions.toFixed(1)}</td>
                                <td className="text-right py-3 px-2">
                                  {trend === 'up' && <TrendingUp className="h-4 w-4 text-green-500 inline" />}
                                  {trend === 'down' && <TrendingDown className="h-4 w-4 text-red-500 inline" />}
                                  {trend === 'stable' && <Minus className="h-4 w-4 text-muted-foreground inline" />}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="scores" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>多维度评分明细</CardTitle>
                    <CardDescription>
                      各广告活动在五个维度的评分详情
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {suggestionsData?.suggestions.map((suggestion) => (
                        <div key={suggestion.campaignId} className="p-4 border rounded-lg">
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="font-medium">{suggestion.campaignName}</h4>
                            <div className={`text-xl font-bold ${getScoreColor(suggestion.scores.compositeScore)}`}>
                              综合: {suggestion.scores.compositeScore.toFixed(0)}
                            </div>
                          </div>
                          <div className="grid grid-cols-5 gap-4">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm text-muted-foreground">转化效率</span>
                                <span className={`text-sm font-medium ${getScoreColor(suggestion.scores.conversionEfficiencyScore)}`}>
                                  {suggestion.scores.conversionEfficiencyScore.toFixed(0)}
                                </span>
                              </div>
                              <Progress value={suggestion.scores.conversionEfficiencyScore} className="h-2" />
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm text-muted-foreground">ROAS</span>
                                <span className={`text-sm font-medium ${getScoreColor(suggestion.scores.roasScore)}`}>
                                  {suggestion.scores.roasScore.toFixed(0)}
                                </span>
                              </div>
                              <Progress value={suggestion.scores.roasScore} className="h-2" />
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm text-muted-foreground">增长潜力</span>
                                <span className={`text-sm font-medium ${getScoreColor(suggestion.scores.growthPotentialScore)}`}>
                                  {suggestion.scores.growthPotentialScore.toFixed(0)}
                                </span>
                              </div>
                              <Progress value={suggestion.scores.growthPotentialScore} className="h-2" />
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm text-muted-foreground">稳定性</span>
                                <span className={`text-sm font-medium ${getScoreColor(suggestion.scores.stabilityScore)}`}>
                                  {suggestion.scores.stabilityScore.toFixed(0)}
                                </span>
                              </div>
                              <Progress value={suggestion.scores.stabilityScore} className="h-2" />
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm text-muted-foreground">趋势</span>
                                <span className={`text-sm font-medium ${getScoreColor(suggestion.scores.trendScore)}`}>
                                  {suggestion.scores.trendScore.toFixed(0)}
                                </span>
                              </div>
                              <Progress value={suggestion.scores.trendScore} className="h-2" />
                            </div>
                          </div>
                          <div className="mt-3 text-sm text-muted-foreground">
                            {suggestion.scores.scoreExplanation.join(' · ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
        
        {/* 配置对话框 */}
        <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>预算分配配置</DialogTitle>
              <DialogDescription>
                调整评分权重和约束参数以优化预算分配策略
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 py-4">
              <div className="space-y-4">
                <h4 className="font-medium">评分权重</h4>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>转化效率权重</Label>
                      <span className="text-sm text-muted-foreground">
                        {((config?.conversionEfficiencyWeight || 0.25) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Slider
                      value={[(config?.conversionEfficiencyWeight || 0.25) * 100]}
                      max={50}
                      step={5}
                      onValueChange={([v]) => {
                        if (selectedGroupId) {
                          updateConfigMutation.mutate({
                            performanceGroupId: selectedGroupId,
                            conversionEfficiencyWeight: v / 100
                          });
                        }
                      }}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>ROAS权重</Label>
                      <span className="text-sm text-muted-foreground">
                        {((config?.roasWeight || 0.25) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Slider
                      value={[(config?.roasWeight || 0.25) * 100]}
                      max={50}
                      step={5}
                      onValueChange={([v]) => {
                        if (selectedGroupId) {
                          updateConfigMutation.mutate({
                            performanceGroupId: selectedGroupId,
                            roasWeight: v / 100
                          });
                        }
                      }}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>增长潜力权重</Label>
                      <span className="text-sm text-muted-foreground">
                        {((config?.growthPotentialWeight || 0.20) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Slider
                      value={[(config?.growthPotentialWeight || 0.20) * 100]}
                      max={50}
                      step={5}
                      onValueChange={([v]) => {
                        if (selectedGroupId) {
                          updateConfigMutation.mutate({
                            performanceGroupId: selectedGroupId,
                            growthPotentialWeight: v / 100
                          });
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h4 className="font-medium">约束参数</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>最大调整幅度 (%)</Label>
                    <Input
                      type="number"
                      value={config?.maxAdjustmentPercent || 15}
                      onChange={(e) => {
                        if (selectedGroupId) {
                          updateConfigMutation.mutate({
                            performanceGroupId: selectedGroupId,
                            maxAdjustmentPercent: Number(e.target.value)
                          });
                        }
                      }}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>最小日预算 ($)</Label>
                    <Input
                      type="number"
                      value={config?.minDailyBudget || 5}
                      onChange={(e) => {
                        if (selectedGroupId) {
                          updateConfigMutation.mutate({
                            performanceGroupId: selectedGroupId,
                            minDailyBudget: Number(e.target.value)
                          });
                        }
                      }}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>冷却期 (天)</Label>
                    <Input
                      type="number"
                      value={config?.cooldownDays || 3}
                      onChange={(e) => {
                        if (selectedGroupId) {
                          updateConfigMutation.mutate({
                            performanceGroupId: selectedGroupId,
                            cooldownDays: Number(e.target.value)
                          });
                        }
                      }}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>新广告保护期 (天)</Label>
                    <Input
                      type="number"
                      value={config?.newCampaignProtectionDays || 7}
                      onChange={(e) => {
                        if (selectedGroupId) {
                          updateConfigMutation.mutate({
                            performanceGroupId: selectedGroupId,
                            newCampaignProtectionDays: Number(e.target.value)
                          });
                        }
                      }}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConfigDialog(false)}>
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        
        {/* 场景模拟对话框 */}
        <Dialog open={showSimulationDialog} onOpenChange={setShowSimulationDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>预算调整效果模拟</DialogTitle>
              <DialogDescription>
                {selectedCampaign?.campaignName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 py-4">
              <div>
                <Label>模拟预算</Label>
                <div className="flex items-center gap-4 mt-2">
                  <Input
                    type="number"
                    value={simulationBudget}
                    onChange={(e) => setSimulationBudget(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-muted-foreground">美元/天</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSimulationBudget(selectedCampaign?.currentBudget * 0.8)}
                  >
                    -20%
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSimulationBudget(selectedCampaign?.currentBudget * 0.9)}
                  >
                    -10%
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSimulationBudget(selectedCampaign?.currentBudget)}
                  >
                    当前
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSimulationBudget(selectedCampaign?.currentBudget * 1.1)}
                  >
                    +10%
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSimulationBudget(selectedCampaign?.currentBudget * 1.2)}
                  >
                    +20%
                  </Button>
                </div>
              </div>
              
              {simulationResult && (
                <div className="space-y-4">
                  <h4 className="font-medium">预测效果</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">预计日花费</p>
                      <p className="text-lg font-bold">${simulationResult.predictedSpend.toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">预计日销售额</p>
                      <p className="text-lg font-bold">${simulationResult.predictedSales.toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">预计ROAS</p>
                      <p className="text-lg font-bold">{simulationResult.predictedROAS.toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">预计ACoS</p>
                      <p className="text-lg font-bold">{simulationResult.predictedACoS.toFixed(1)}%</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">预算利用率</p>
                      <p className="text-lg font-bold">{simulationResult.budgetUtilization.toFixed(0)}%</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">预测置信度</p>
                      <p className="text-lg font-bold">{simulationResult.confidence}%</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSimulationDialog(false)}>
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

// 情景模拟组件
function ScenarioSimulation({ 
  performanceGroupId, 
  suggestionsData, 
  campaignPerformance 
}: { 
  performanceGroupId: number | null;
  suggestionsData: any;
  campaignPerformance: any;
}) {
  const [scenarioType, setScenarioType] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [customBudgetMultiplier, setCustomBudgetMultiplier] = useState(1.0);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  
  // 场景配置
  const scenarios = {
    conservative: { name: '保守策略', multiplier: 0.85, description: '减少预算，优化ACoS' },
    balanced: { name: '平衡策略', multiplier: 1.0, description: '维持当前预算水平' },
    aggressive: { name: '激进策略', multiplier: 1.25, description: '增加预算，扩大规模' },
  };
  
  // 计算情景预测数据
  const calculateScenarioData = (multiplier: number) => {
    if (!suggestionsData?.suggestions) return null;
    
    const campaigns = suggestionsData.suggestions.map((s: any) => {
      const newBudget = s.currentBudget * multiplier;
      // 基于边际效益递减模型计算预测效果
      const efficiencyFactor = multiplier > 1 
        ? 1 - 0.1 * Math.log(multiplier) 
        : 1 + 0.05 * Math.log(1 / multiplier);
      
      const predictedSpend = newBudget * (s.predictedSpend / s.currentBudget) * efficiencyFactor;
      const predictedSales = s.predictedSales * multiplier * efficiencyFactor;
      const predictedROAS = predictedSpend > 0 ? predictedSales / predictedSpend : 0;
      const predictedACoS = predictedSales > 0 ? (predictedSpend / predictedSales) * 100 : 0;
      
      return {
        ...s,
        newBudget,
        predictedSpend,
        predictedSales,
        predictedROAS,
        predictedACoS,
        budgetChange: ((newBudget - s.currentBudget) / s.currentBudget) * 100,
      };
    });
    
    // 汇总数据
    const totalCurrentBudget = campaigns.reduce((sum: number, c: any) => sum + c.currentBudget, 0);
    const totalNewBudget = campaigns.reduce((sum: number, c: any) => sum + c.newBudget, 0);
    const totalPredictedSpend = campaigns.reduce((sum: number, c: any) => sum + c.predictedSpend, 0);
    const totalPredictedSales = campaigns.reduce((sum: number, c: any) => sum + c.predictedSales, 0);
    const avgROAS = totalPredictedSpend > 0 ? totalPredictedSales / totalPredictedSpend : 0;
    const avgACoS = totalPredictedSales > 0 ? (totalPredictedSpend / totalPredictedSales) * 100 : 0;
    
    return {
      campaigns,
      summary: {
        totalCurrentBudget,
        totalNewBudget,
        totalPredictedSpend,
        totalPredictedSales,
        avgROAS,
        avgACoS,
        budgetChange: ((totalNewBudget - totalCurrentBudget) / totalCurrentBudget) * 100,
      }
    };
  };
  
  const currentMultiplier = scenarioType === 'conservative' ? scenarios.conservative.multiplier
    : scenarioType === 'aggressive' ? scenarios.aggressive.multiplier
    : customBudgetMultiplier;
  
  const scenarioData = calculateScenarioData(currentMultiplier);
  
  // 生成预算-效果曲线数据
  const generateCurveData = () => {
    const multipliers = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0];
    return multipliers.map(m => {
      const data = calculateScenarioData(m);
      return {
        multiplier: m,
        budget: data?.summary.totalNewBudget || 0,
        sales: data?.summary.totalPredictedSales || 0,
        roas: data?.summary.avgROAS || 0,
        acos: data?.summary.avgACoS || 0,
      };
    });
  };
  
  const curveData = generateCurveData();
  const maxSales = Math.max(...curveData.map(d => d.sales));
  const maxBudget = Math.max(...curveData.map(d => d.budget));
  
  if (!performanceGroupId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Zap className="h-16 w-16 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">请先选择绩效组</p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* 场景选择卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Object.entries(scenarios).map(([key, scenario]) => (
          <Card 
            key={key}
            className={`cursor-pointer transition-all ${
              scenarioType === key 
                ? 'border-primary ring-2 ring-primary/20' 
                : 'hover:border-muted-foreground/30'
            }`}
            onClick={() => setScenarioType(key as any)}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{scenario.name}</h3>
                <Badge variant={key === 'conservative' ? 'secondary' : key === 'aggressive' ? 'destructive' : 'default'}>
                  {scenario.multiplier > 1 ? '+' : ''}{((scenario.multiplier - 1) * 100).toFixed(0)}%
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{scenario.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      
      {/* 自定义预算滑块 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            自定义预算调整
          </CardTitle>
          <CardDescription>拖动滑块调整预算倍数，实时查看预测效果</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground w-16">50%</span>
              <Slider
                value={[customBudgetMultiplier * 100]}
                onValueChange={(v) => {
                  setCustomBudgetMultiplier(v[0] / 100);
                  setScenarioType('balanced');
                }}
                min={50}
                max={200}
                step={5}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground w-16 text-right">200%</span>
            </div>
            <div className="text-center">
              <span className="text-2xl font-bold">{(customBudgetMultiplier * 100).toFixed(0)}%</span>
              <span className="text-muted-foreground ml-2">预算倍数</span>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* 预算-效果曲线图 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5" />
            预算-效果预测曲线
          </CardTitle>
          <CardDescription>展示不同预算水平下的预测销售额和ROAS</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 relative">
            {/* SVG 曲线图 */}
            <svg className="w-full h-full" viewBox="0 0 800 250">
              {/* 背景网格 */}
              <defs>
                <linearGradient id="salesGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                </linearGradient>
              </defs>
              
              {/* Y轴网格线 */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
                <g key={i}>
                  <line 
                    x1="60" y1={220 - ratio * 200} 
                    x2="780" y2={220 - ratio * 200} 
                    stroke="hsl(var(--border))" 
                    strokeDasharray="4,4" 
                  />
                  <text 
                    x="55" y={225 - ratio * 200} 
                    textAnchor="end" 
                    className="fill-muted-foreground text-xs"
                  >
                    ${(maxSales * ratio / 1000).toFixed(0)}k
                  </text>
                </g>
              ))}
              
              {/* 销售额曲线填充 */}
              <path
                d={`M ${curveData.map((d, i) => {
                  const x = 60 + (i / (curveData.length - 1)) * 720;
                  const y = 220 - (d.sales / maxSales) * 200;
                  return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                }).join(' ')} L 780 220 L 60 220 Z`}
                fill="url(#salesGradient)"
              />
              
              {/* 销售额曲线 */}
              <path
                d={curveData.map((d, i) => {
                  const x = 60 + (i / (curveData.length - 1)) * 720;
                  const y = 220 - (d.sales / maxSales) * 200;
                  return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                }).join(' ')}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="3"
              />
              
              {/* ROAS曲线 */}
              <path
                d={curveData.map((d, i) => {
                  const x = 60 + (i / (curveData.length - 1)) * 720;
                  const maxROAS = Math.max(...curveData.map(c => c.roas));
                  const y = 220 - (d.roas / maxROAS) * 200;
                  return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                }).join(' ')}
                fill="none"
                stroke="hsl(var(--chart-2))"
                strokeWidth="2"
                strokeDasharray="6,3"
              />
              
              {/* 当前选中点 */}
              {(() => {
                const currentIndex = curveData.findIndex(d => Math.abs(d.multiplier - currentMultiplier) < 0.05);
                if (currentIndex >= 0) {
                  const d = curveData[currentIndex] || calculateScenarioData(currentMultiplier)?.summary;
                  const x = 60 + (currentIndex / (curveData.length - 1)) * 720;
                  const y = 220 - ((d?.sales || scenarioData?.summary.totalPredictedSales || 0) / maxSales) * 200;
                  return (
                    <g>
                      <circle cx={x} cy={y} r="8" fill="hsl(var(--primary))" />
                      <circle cx={x} cy={y} r="4" fill="white" />
                      <line x1={x} y1={y} x2={x} y2="220" stroke="hsl(var(--primary))" strokeDasharray="4,4" />
                    </g>
                  );
                }
                return null;
              })()}
              
              {/* X轴标签 */}
              {curveData.filter((_, i) => i % 2 === 0).map((d, i) => {
                const x = 60 + ((i * 2) / (curveData.length - 1)) * 720;
                return (
                  <text 
                    key={i} 
                    x={x} 
                    y="240" 
                    textAnchor="middle" 
                    className="fill-muted-foreground text-xs"
                  >
                    {(d.multiplier * 100).toFixed(0)}%
                  </text>
                );
              })}
              
              {/* 图例 */}
              <g transform="translate(620, 20)">
                <rect x="0" y="0" width="150" height="50" fill="hsl(var(--card))" rx="4" />
                <line x1="10" y1="18" x2="40" y2="18" stroke="hsl(var(--primary))" strokeWidth="3" />
                <text x="50" y="22" className="fill-foreground text-xs">预测销售额</text>
                <line x1="10" y1="38" x2="40" y2="38" stroke="hsl(var(--chart-2))" strokeWidth="2" strokeDasharray="6,3" />
                <text x="50" y="42" className="fill-foreground text-xs">预测ROAS</text>
              </g>
            </svg>
          </div>
        </CardContent>
      </Card>
      
      {/* 预测结果汇总 */}
      {scenarioData && (
        <Card>
          <CardHeader>
            <CardTitle>预测结果汇总</CardTitle>
            <CardDescription>
              基于{scenarios[scenarioType].name}的预测效果
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">新预算总额</p>
                <p className="text-2xl font-bold">${scenarioData.summary.totalNewBudget.toFixed(2)}</p>
                <p className={`text-sm ${
                  scenarioData.summary.budgetChange > 0 ? 'text-green-500' : 
                  scenarioData.summary.budgetChange < 0 ? 'text-red-500' : 'text-muted-foreground'
                }`}>
                  {scenarioData.summary.budgetChange > 0 ? '+' : ''}
                  {scenarioData.summary.budgetChange.toFixed(1)}%
                </p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">预测销售额</p>
                <p className="text-2xl font-bold">${scenarioData.summary.totalPredictedSales.toFixed(2)}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">预测ROAS</p>
                <p className="text-2xl font-bold">{scenarioData.summary.avgROAS.toFixed(2)}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">预测ACoS</p>
                <p className="text-2xl font-bold">{scenarioData.summary.avgACoS.toFixed(1)}%</p>
              </div>
            </div>
            
            {/* 各广告活动预测明细 */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2">广告活动</th>
                    <th className="text-right py-3 px-2">当前预算</th>
                    <th className="text-right py-3 px-2">新预算</th>
                    <th className="text-right py-3 px-2">变化</th>
                    <th className="text-right py-3 px-2">预测销售</th>
                    <th className="text-right py-3 px-2">预测ROAS</th>
                    <th className="text-right py-3 px-2">预测ACoS</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioData.campaigns.map((campaign: any) => (
                    <tr key={campaign.campaignId} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-2 font-medium">{campaign.campaignName}</td>
                      <td className="text-right py-3 px-2">${campaign.currentBudget.toFixed(2)}</td>
                      <td className="text-right py-3 px-2">${campaign.newBudget.toFixed(2)}</td>
                      <td className={`text-right py-3 px-2 ${
                        campaign.budgetChange > 0 ? 'text-green-500' : 
                        campaign.budgetChange < 0 ? 'text-red-500' : ''
                      }`}>
                        {campaign.budgetChange > 0 ? '+' : ''}{campaign.budgetChange.toFixed(1)}%
                      </td>
                      <td className="text-right py-3 px-2">${campaign.predictedSales.toFixed(2)}</td>
                      <td className="text-right py-3 px-2">{campaign.predictedROAS.toFixed(2)}</td>
                      <td className="text-right py-3 px-2">{campaign.predictedACoS.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
