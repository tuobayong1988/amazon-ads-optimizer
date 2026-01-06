import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Target,
  Zap,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Save,
  Play,
  History,
  Settings,
  PieChart,
  RefreshCw,
} from "lucide-react";

// 分配原因映射
const REASON_LABELS: Record<string, string> = {
  high_roas: "高ROAS",
  low_acos: "低ACoS",
  high_conversion: "高转化率",
  growth_potential: "增长潜力",
  new_product: "新品推广",
  seasonal_boost: "季节性提升",
  low_roas: "低ROAS",
  high_acos: "高ACoS",
  low_conversion: "低转化率",
  budget_limit: "预算限制",
  maintain: "保持现状",
  rebalance: "重新平衡",
};

// 目标类型映射
const GOAL_TYPE_LABELS: Record<string, string> = {
  sales_target: "销售目标",
  roas_target: "ROAS目标",
  acos_target: "ACoS目标",
  profit_target: "利润目标",
  market_share: "市场份额",
};

// 周期类型映射
const PERIOD_TYPE_LABELS: Record<string, string> = {
  daily: "每日",
  weekly: "每周",
  monthly: "每月",
  quarterly: "每季度",
};

export default function BudgetAllocation() {
  const [activeTab, setActiveTab] = useState("allocate");
  const [totalBudget, setTotalBudget] = useState<number>(1000);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [prioritizeHighRoas, setPrioritizeHighRoas] = useState(true);
  const [prioritizeNewProducts, setPrioritizeNewProducts] = useState(false);
  const [minCampaignBudget, setMinCampaignBudget] = useState<number>(10);
  const [maxCampaignBudget, setMaxCampaignBudget] = useState<number>(300);
  
  const [allocationResult, setAllocationResult] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [allocationName, setAllocationName] = useState("");
  const [allocationDescription, setAllocationDescription] = useState("");
  
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [newGoal, setNewGoal] = useState({
    goalType: "sales_target" as string,
    targetValue: 10000,
    periodType: "monthly" as string,
    totalBudget: 5000,
  });

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 获取分配历史
  const { data: allocationHistory, refetch: refetchHistory } = trpc.budgetAllocation.getAllocationHistory.useQuery({
    accountId: selectedAccountId ?? undefined,
    limit: 20,
  });
  
  // 获取预算目标
  const { data: budgetGoals, refetch: refetchGoals } = trpc.budgetAllocation.getGoals.useQuery({
    accountId: selectedAccountId ?? undefined,
  });
  
  // 获取预算调整历史
  const { data: budgetHistory } = trpc.budgetAllocation.getBudgetHistory.useQuery({
    accountId: selectedAccountId ?? undefined,
    limit: 50,
  });

  // 生成分配建议
  const generateMutation = trpc.budgetAllocation.generateAllocation.useMutation({
    onSuccess: (data) => {
      setAllocationResult(data);
      setIsGenerating(false);
      toast.success("预算分配建议已生成");
    },
    onError: (error) => {
      setIsGenerating(false);
      toast.error(`生成失败: ${error.message}`);
    },
  });

  // 保存分配方案
  const saveMutation = trpc.budgetAllocation.saveAllocation.useMutation({
    onSuccess: () => {
      setIsSaving(false);
      setSaveDialogOpen(false);
      refetchHistory();
      toast.success("分配方案已保存");
    },
    onError: (error) => {
      setIsSaving(false);
      toast.error(`保存失败: ${error.message}`);
    },
  });

  // 应用分配方案
  const applyMutation = trpc.budgetAllocation.applyAllocation.useMutation({
    onSuccess: (data) => {
      setIsApplying(false);
      if (data.success) {
        toast.success(`成功应用 ${data.appliedCount} 个广告活动的预算调整`);
      } else {
        toast.warning(`部分应用成功: ${data.appliedCount} 个成功, ${data.errors.length} 个失败`);
      }
      refetchHistory();
    },
    onError: (error) => {
      setIsApplying(false);
      toast.error(`应用失败: ${error.message}`);
    },
  });

  // 创建预算目标
  const createGoalMutation = trpc.budgetAllocation.createGoal.useMutation({
    onSuccess: () => {
      setGoalDialogOpen(false);
      refetchGoals();
      toast.success("预算目标已创建");
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  // 删除预算目标
  const deleteGoalMutation = trpc.budgetAllocation.deleteGoal.useMutation({
    onSuccess: () => {
      refetchGoals();
      toast.success("预算目标已删除");
    },
  });

  const handleGenerate = () => {
    setIsGenerating(true);
    generateMutation.mutate({
      accountId: selectedAccountId,
      totalBudget,
      prioritizeHighRoas,
      prioritizeNewProducts,
      minCampaignBudget,
      maxCampaignBudget,
    });
  };

  const handleSave = () => {
    if (!allocationResult) return;
    setIsSaving(true);
    saveMutation.mutate({
      accountId: selectedAccountId,
      goalId: null,
      allocationName,
      description: allocationDescription,
      result: allocationResult,
    });
  };

  const handleApply = (allocationId: number) => {
    setIsApplying(true);
    applyMutation.mutate({ allocationId });
  };

  const handleCreateGoal = () => {
    createGoalMutation.mutate({
      accountId: selectedAccountId ?? undefined,
      goalType: newGoal.goalType as any,
      targetValue: newGoal.targetValue,
      periodType: newGoal.periodType as any,
      totalBudget: newGoal.totalBudget,
    });
  };

  // 计算汇总统计
  const summaryStats = useMemo(() => {
    if (!allocationResult) return null;
    return allocationResult.summary;
  }, [allocationResult]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">预算智能分配</h1>
            <p className="text-muted-foreground">
              基于历史表现和销售目标，为广告活动推荐最佳预算分配
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Select
              value={selectedAccountId?.toString() ?? "all"}
              onValueChange={(v) => setSelectedAccountId(v === "all" ? null : Number(v))}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部账号</SelectItem>
                {accounts?.map((account) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {account.storeName || account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="allocate" className="gap-2">
              <Zap className="h-4 w-4" />
              智能分配
            </TabsTrigger>
            <TabsTrigger value="goals" className="gap-2">
              <Target className="h-4 w-4" />
              预算目标
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" />
              分配历史
            </TabsTrigger>
            <TabsTrigger value="changes" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              调整记录
            </TabsTrigger>
          </TabsList>

          {/* 智能分配标签页 */}
          <TabsContent value="allocate" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 配置面板 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    分配配置
                  </CardTitle>
                  <CardDescription>设置预算分配参数</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>总预算 ($)</Label>
                    <Input
                      type="number"
                      value={totalBudget}
                      onChange={(e) => setTotalBudget(Number(e.target.value))}
                      min={0}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>单活动最小预算 ($)</Label>
                    <Input
                      type="number"
                      value={minCampaignBudget}
                      onChange={(e) => setMinCampaignBudget(Number(e.target.value))}
                      min={0}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>单活动最大预算 ($)</Label>
                    <Input
                      type="number"
                      value={maxCampaignBudget}
                      onChange={(e) => setMaxCampaignBudget(Number(e.target.value))}
                      min={0}
                    />
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>优先高ROAS活动</Label>
                      <p className="text-xs text-muted-foreground">
                        为高回报活动分配更多预算
                      </p>
                    </div>
                    <Switch
                      checked={prioritizeHighRoas}
                      onCheckedChange={setPrioritizeHighRoas}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>优先新品推广</Label>
                      <p className="text-xs text-muted-foreground">
                        为新品活动预留更多预算
                      </p>
                    </div>
                    <Switch
                      checked={prioritizeNewProducts}
                      onCheckedChange={setPrioritizeNewProducts}
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        生成中...
                      </>
                    ) : (
                      <>
                        <Zap className="mr-2 h-4 w-4" />
                        生成分配建议
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* 分配结果 */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <PieChart className="h-5 w-5" />
                        分配建议
                      </CardTitle>
                      <CardDescription>
                        {allocationResult
                          ? `共 ${allocationResult.campaignCount} 个广告活动`
                          : "点击生成按钮获取分配建议"}
                      </CardDescription>
                    </div>
                    {allocationResult && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSaveDialogOpen(true)}
                        >
                          <Save className="mr-2 h-4 w-4" />
                          保存方案
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {!allocationResult ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <DollarSign className="h-12 w-12 mb-4 opacity-50" />
                      <p>配置参数后点击生成按钮</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* 汇总统计 */}
                      {summaryStats && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                            <div className="flex items-center gap-2 text-green-500">
                              <TrendingUp className="h-4 w-4" />
                              <span className="text-sm">增加预算</span>
                            </div>
                            <p className="text-2xl font-bold mt-1">
                              {summaryStats.increasedCount}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              +${summaryStats.totalIncrease.toFixed(2)}
                            </p>
                          </div>
                          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                            <div className="flex items-center gap-2 text-red-500">
                              <TrendingDown className="h-4 w-4" />
                              <span className="text-sm">减少预算</span>
                            </div>
                            <p className="text-2xl font-bold mt-1">
                              {summaryStats.decreasedCount}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              -${summaryStats.totalDecrease.toFixed(2)}
                            </p>
                          </div>
                          <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                            <div className="flex items-center gap-2 text-blue-500">
                              <Target className="h-4 w-4" />
                              <span className="text-sm">预测销售</span>
                            </div>
                            <p className="text-2xl font-bold mt-1">
                              ${summaryStats.predictedSales.toFixed(0)}
                            </p>
                          </div>
                          <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
                            <div className="flex items-center gap-2 text-purple-500">
                              <BarChart3 className="h-4 w-4" />
                              <span className="text-sm">预测ROAS</span>
                            </div>
                            <p className="text-2xl font-bold mt-1">
                              {summaryStats.predictedRoas.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* 分配明细列表 */}
                      <ScrollArea className="h-[400px]">
                        <div className="space-y-3">
                          {allocationResult.recommendations.map((rec: any, index: number) => (
                            <div
                              key={index}
                              className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <h4 className="font-medium">{rec.campaignName}</h4>
                                    <Badge variant="outline" className="text-xs">
                                      评分: {rec.priorityScore.toFixed(0)}
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {rec.reasonDetail}
                                  </p>
                                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                    <span>ROAS: {rec.historicalMetrics.roas.toFixed(2)}</span>
                                    <span>ACoS: {rec.historicalMetrics.acos.toFixed(1)}%</span>
                                    <span>CTR: {rec.historicalMetrics.ctr.toFixed(2)}%</span>
                                    <span>CVR: {rec.historicalMetrics.cvr.toFixed(2)}%</span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">
                                      ${rec.currentBudget.toFixed(2)}
                                    </span>
                                    <span>→</span>
                                    <span className="font-bold">
                                      ${rec.recommendedBudget.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className={`flex items-center justify-end gap-1 text-sm ${
                                    rec.budgetChange > 0
                                      ? "text-green-500"
                                      : rec.budgetChange < 0
                                      ? "text-red-500"
                                      : "text-muted-foreground"
                                  }`}>
                                    {rec.budgetChange > 0 ? (
                                      <ArrowUpRight className="h-4 w-4" />
                                    ) : rec.budgetChange < 0 ? (
                                      <ArrowDownRight className="h-4 w-4" />
                                    ) : (
                                      <Minus className="h-4 w-4" />
                                    )}
                                    <span>
                                      {rec.budgetChange > 0 ? "+" : ""}
                                      {rec.changePercent.toFixed(1)}%
                                    </span>
                                  </div>
                                  <Badge
                                    variant="secondary"
                                    className="mt-1 text-xs"
                                  >
                                    {REASON_LABELS[rec.allocationReason] || rec.allocationReason}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 预算目标标签页 */}
          <TabsContent value="goals" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold">预算目标</h2>
                <p className="text-sm text-muted-foreground">
                  设置销售目标和预算约束，指导智能分配
                </p>
              </div>
              <Button onClick={() => setGoalDialogOpen(true)}>
                <Target className="mr-2 h-4 w-4" />
                创建目标
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {budgetGoals?.map((goal: any) => (
                <Card key={goal.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <Badge variant={goal.status === "active" ? "default" : "secondary"}>
                        {goal.status === "active" ? "进行中" : goal.status}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteGoalMutation.mutate({ goalId: goal.id })}
                      >
                        删除
                      </Button>
                    </div>
                    <CardTitle className="text-lg">
                      {GOAL_TYPE_LABELS[goal.goalType] || goal.goalType}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">目标值</span>
                        <span className="font-medium">
                          {goal.goalType.includes("acos") || goal.goalType.includes("roas")
                            ? `${Number(goal.targetValue).toFixed(2)}`
                            : `$${Number(goal.targetValue).toLocaleString()}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">周期</span>
                        <span>{PERIOD_TYPE_LABELS[goal.periodType] || goal.periodType}</span>
                      </div>
                      {goal.totalBudget && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">总预算</span>
                          <span>${Number(goal.totalBudget).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
              
              {(!budgetGoals || budgetGoals.length === 0) && (
                <div className="col-span-full flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Target className="h-12 w-12 mb-4 opacity-50" />
                  <p>暂无预算目标</p>
                  <p className="text-sm">点击创建目标按钮添加</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* 分配历史标签页 */}
          <TabsContent value="history" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold">分配历史</h2>
                <p className="text-sm text-muted-foreground">
                  查看和管理历史分配方案
                </p>
              </div>
              <Button variant="outline" onClick={() => refetchHistory()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                刷新
              </Button>
            </div>

            <div className="space-y-4">
              {allocationHistory?.map((allocation: any) => (
                <Card key={allocation.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{allocation.allocationName}</h3>
                          <Badge
                            variant={
                              allocation.status === "applied"
                                ? "default"
                                : allocation.status === "draft"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {allocation.status === "applied"
                              ? "已应用"
                              : allocation.status === "draft"
                              ? "草稿"
                              : allocation.status}
                          </Badge>
                        </div>
                        {allocation.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {allocation.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <span>总预算: ${Number(allocation.totalBudget).toLocaleString()}</span>
                          <span>预测销售: ${Number(allocation.predictedSales || 0).toLocaleString()}</span>
                          <span>预测ROAS: {Number(allocation.predictedRoas || 0).toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          创建于 {new Date(allocation.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {allocation.status !== "applied" && (
                          <Button
                            size="sm"
                            onClick={() => handleApply(allocation.id)}
                            disabled={isApplying}
                          >
                            {isApplying ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="mr-2 h-4 w-4" />
                            )}
                            应用
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {(!allocationHistory || allocationHistory.length === 0) && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <History className="h-12 w-12 mb-4 opacity-50" />
                  <p>暂无分配历史</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* 调整记录标签页 */}
          <TabsContent value="changes" className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">预算调整记录</h2>
              <p className="text-sm text-muted-foreground">
                查看所有预算调整的详细历史
              </p>
            </div>

            <Card>
              <CardContent className="pt-6">
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {budgetHistory?.map((record: any) => (
                      <div
                        key={record.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <div>
                          <p className="font-medium">广告活动 #{record.campaignId}</p>
                          <p className="text-sm text-muted-foreground">
                            {record.reason || "无备注"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(record.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              ${Number(record.previousBudget).toFixed(2)}
                            </span>
                            <span>→</span>
                            <span className="font-bold">
                              ${Number(record.newBudget).toFixed(2)}
                            </span>
                          </div>
                          <div
                            className={`text-sm ${
                              Number(record.changeAmount) > 0
                                ? "text-green-500"
                                : Number(record.changeAmount) < 0
                                ? "text-red-500"
                                : "text-muted-foreground"
                            }`}
                          >
                            {Number(record.changeAmount) > 0 ? "+" : ""}
                            {Number(record.changePercent).toFixed(1)}%
                          </div>
                          <Badge variant="outline" className="mt-1 text-xs">
                            {record.source === "auto_allocation"
                              ? "自动分配"
                              : record.source === "manual"
                              ? "手动调整"
                              : record.source}
                          </Badge>
                        </div>
                      </div>
                    ))}

                    {(!budgetHistory || budgetHistory.length === 0) && (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <BarChart3 className="h-12 w-12 mb-4 opacity-50" />
                        <p>暂无调整记录</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* 保存方案对话框 */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存分配方案</DialogTitle>
            <DialogDescription>
              为此分配方案命名并添加描述，方便后续查看和应用
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>方案名称</Label>
              <Input
                value={allocationName}
                onChange={(e) => setAllocationName(e.target.value)}
                placeholder="例如：Q1预算优化方案"
              />
            </div>
            <div className="space-y-2">
              <Label>描述（可选）</Label>
              <Input
                value={allocationDescription}
                onChange={(e) => setAllocationDescription(e.target.value)}
                placeholder="添加备注说明..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={!allocationName || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                "保存"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 创建目标对话框 */}
      <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建预算目标</DialogTitle>
            <DialogDescription>
              设置销售目标和预算约束，指导智能分配决策
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>目标类型</Label>
              <Select
                value={newGoal.goalType}
                onValueChange={(v) => setNewGoal({ ...newGoal, goalType: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales_target">销售目标</SelectItem>
                  <SelectItem value="roas_target">ROAS目标</SelectItem>
                  <SelectItem value="acos_target">ACoS目标</SelectItem>
                  <SelectItem value="profit_target">利润目标</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>目标值</Label>
              <Input
                type="number"
                value={newGoal.targetValue}
                onChange={(e) =>
                  setNewGoal({ ...newGoal, targetValue: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>周期</Label>
              <Select
                value={newGoal.periodType}
                onValueChange={(v) => setNewGoal({ ...newGoal, periodType: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">每日</SelectItem>
                  <SelectItem value="weekly">每周</SelectItem>
                  <SelectItem value="monthly">每月</SelectItem>
                  <SelectItem value="quarterly">每季度</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>总预算 ($)</Label>
              <Input
                type="number"
                value={newGoal.totalBudget}
                onChange={(e) =>
                  setNewGoal({ ...newGoal, totalBudget: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateGoal}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
