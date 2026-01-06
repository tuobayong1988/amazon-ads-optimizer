import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Clock,
  Calendar,
  TrendingUp,
  Target,
  Sparkles,
  Settings,
  Play,
  Pause,
  Plus,
  RefreshCw,
  Loader2,
  BarChart3,
  DollarSign,
  Percent,
  Info,
  ChevronRight,
  Zap,
} from "lucide-react";

// 星期几标签
const DAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 小时标签
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);

// 优化目标选项
const OPTIMIZATION_GOALS = [
  { value: "maximize_sales", label: "最大化销售额", description: "优先提高销售额，适合增长期" },
  { value: "target_acos", label: "目标ACoS", description: "控制广告成本占比在目标范围内" },
  { value: "target_roas", label: "目标ROAS", description: "确保广告投资回报率达到目标" },
  { value: "minimize_acos", label: "最小化ACoS", description: "尽可能降低广告成本占比" },
];

// 热力图颜色映射
function getHeatmapColor(value: number, min: number, max: number): string {
  const normalized = (value - min) / (max - min || 1);
  if (normalized < 0.25) return "bg-red-500/80";
  if (normalized < 0.5) return "bg-yellow-500/80";
  if (normalized < 0.75) return "bg-green-500/80";
  return "bg-emerald-500/80";
}

// 倍数颜色映射
function getMultiplierColor(multiplier: number): string {
  if (multiplier < 0.5) return "bg-red-500/80 text-white";
  if (multiplier < 0.8) return "bg-orange-500/80 text-white";
  if (multiplier < 1.2) return "bg-blue-500/80 text-white";
  if (multiplier < 1.5) return "bg-green-500/80 text-white";
  return "bg-emerald-500/80 text-white";
}

export default function DaypartingStrategy() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  
  // 新策略表单状态
  const [newStrategy, setNewStrategy] = useState<{
    name: string;
    optimizationGoal: "maximize_sales" | "target_acos" | "target_roas" | "minimize_acos";
    targetAcos: number;
    targetRoas: number;
    lookbackDays: number;
  }>({
    name: "",
    optimizationGoal: "maximize_sales",
    targetAcos: 25,
    targetRoas: 4,
    lookbackDays: 30,
  });

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  
  // 获取广告活动列表
  const { data: campaigns } = trpc.campaign.list.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // 获取分时策略列表
  const { data: strategies, refetch: refetchStrategies } = trpc.dayparting.listStrategies.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // 获取每周表现分析
  const { data: weeklyAnalysis, isLoading: weeklyLoading } = trpc.dayparting.analyzeWeeklyPerformance.useQuery(
    { campaignId: selectedCampaignId!, lookbackDays: newStrategy.lookbackDays },
    { enabled: !!selectedCampaignId }
  );

  // 获取每小时表现分析
  const { data: hourlyAnalysis, isLoading: hourlyLoading } = trpc.dayparting.analyzeHourlyPerformance.useQuery(
    { campaignId: selectedCampaignId!, lookbackDays: newStrategy.lookbackDays },
    { enabled: !!selectedCampaignId }
  );

  // 预览预算分配
  const { data: budgetPreview } = trpc.dayparting.previewBudgetAllocation.useQuery(
    {
      campaignId: selectedCampaignId!,
      optimizationGoal: newStrategy.optimizationGoal,
      targetAcos: newStrategy.optimizationGoal === "target_acos" ? newStrategy.targetAcos : undefined,
      targetRoas: newStrategy.optimizationGoal === "target_roas" ? newStrategy.targetRoas : undefined,
      lookbackDays: newStrategy.lookbackDays,
    },
    { enabled: !!selectedCampaignId }
  );

  // 预览竞价调整
  const { data: bidPreview } = trpc.dayparting.previewBidAdjustments.useQuery(
    {
      campaignId: selectedCampaignId!,
      optimizationGoal: newStrategy.optimizationGoal,
      targetAcos: newStrategy.optimizationGoal === "target_acos" ? newStrategy.targetAcos : undefined,
      targetRoas: newStrategy.optimizationGoal === "target_roas" ? newStrategy.targetRoas : undefined,
      lookbackDays: newStrategy.lookbackDays,
    },
    { enabled: !!selectedCampaignId }
  );

  // 生成最优策略
  const generateStrategyMutation = trpc.dayparting.generateOptimalStrategy.useMutation({
    onSuccess: () => {
      toast.success("策略生成成功");
      setShowCreateDialog(false);
      refetchStrategies();
    },
    onError: (error) => {
      toast.error(`生成失败: ${error.message}`);
    },
  });

  // 更新策略状态
  const updateStatusMutation = trpc.dayparting.updateStrategyStatus.useMutation({
    onSuccess: () => {
      toast.success("状态更新成功");
      refetchStrategies();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  // 处理生成策略
  const handleGenerateStrategy = () => {
    if (!selectedAccountId || !selectedCampaignId) {
      toast.error("请先选择账号和广告活动");
      return;
    }
    if (!newStrategy.name) {
      toast.error("请输入策略名称");
      return;
    }

    generateStrategyMutation.mutate({
      accountId: selectedAccountId,
      campaignId: selectedCampaignId,
      name: newStrategy.name,
      optimizationGoal: newStrategy.optimizationGoal,
      targetAcos: newStrategy.optimizationGoal === "target_acos" ? newStrategy.targetAcos : undefined,
      targetRoas: newStrategy.optimizationGoal === "target_roas" ? newStrategy.targetRoas : undefined,
      lookbackDays: newStrategy.lookbackDays,
    });
  };

  // 构建小时热力图数据
  const hourlyHeatmapData = useMemo(() => {
    if (!bidPreview?.adjustments) return [];
    
    // 创建7x24的矩阵
    const matrix: { dayOfWeek: number; hour: number; bidMultiplier: number; reason: string }[][] = Array.from(
      { length: 7 },
      () => []
    );

    bidPreview.adjustments.forEach((adj) => {
      if (!matrix[adj.dayOfWeek]) matrix[adj.dayOfWeek] = [];
      matrix[adj.dayOfWeek][adj.hour] = adj;
    });

    return matrix;
  }, [bidPreview?.adjustments]);

  // 设置默认账号
  if (accounts && accounts.length > 0 && !selectedAccountId) {
    const defaultAccount = accounts.find((a) => a.isDefault) || accounts[0];
    setSelectedAccountId(defaultAccount.id);
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Clock className="h-6 w-6" />
              分时策略管理
            </h1>
            <p className="text-muted-foreground mt-1">
              基于历史数据智能优化预算分配和竞价调整，类似Adspert的分时优化功能
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* 账号选择 */}
            <Select
              value={selectedAccountId?.toString() || ""}
              onValueChange={(v) => {
                setSelectedAccountId(parseInt(v));
                setSelectedCampaignId(null);
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((account) => (
                  <SelectItem key={account.id} value={account.id.toString()}>
                    {account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* 广告活动选择 */}
            <Select
              value={selectedCampaignId?.toString() || ""}
              onValueChange={(v) => setSelectedCampaignId(parseInt(v))}
              disabled={!selectedAccountId}
            >
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="选择广告活动" />
              </SelectTrigger>
              <SelectContent>
                {campaigns?.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id.toString()}>
                    {campaign.campaignName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* 创建策略按钮 */}
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button disabled={!selectedCampaignId}>
                  <Plus className="h-4 w-4 mr-2" />
                  创建分时策略
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5" />
                    创建智能分时策略
                  </DialogTitle>
                  <DialogDescription>
                    系统将分析历史数据，自动生成最优的分时预算和竞价策略
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                  {/* 策略名称 */}
                  <div className="space-y-2">
                    <Label>策略名称</Label>
                    <Input
                      placeholder="例如：周末高峰优化策略"
                      value={newStrategy.name}
                      onChange={(e) => setNewStrategy({ ...newStrategy, name: e.target.value })}
                    />
                  </div>

                  {/* 优化目标 */}
                  <div className="space-y-2">
                    <Label>优化目标</Label>
                    <div className="grid grid-cols-2 gap-3">
                      {OPTIMIZATION_GOALS.map((goal) => (
                        <div
                          key={goal.value}
                          className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                            newStrategy.optimizationGoal === goal.value
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                          onClick={() => setNewStrategy({ ...newStrategy, optimizationGoal: goal.value as any })}
                        >
                          <div className="font-medium">{goal.label}</div>
                          <div className="text-xs text-muted-foreground mt-1">{goal.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 目标值设置 */}
                  {newStrategy.optimizationGoal === "target_acos" && (
                    <div className="space-y-2">
                      <Label>目标ACoS (%)</Label>
                      <div className="flex items-center gap-4">
                        <Slider
                          value={[newStrategy.targetAcos]}
                          onValueChange={([v]) => setNewStrategy({ ...newStrategy, targetAcos: v })}
                          min={5}
                          max={50}
                          step={1}
                          className="flex-1"
                        />
                        <span className="w-16 text-right font-mono">{newStrategy.targetAcos}%</span>
                      </div>
                    </div>
                  )}

                  {newStrategy.optimizationGoal === "target_roas" && (
                    <div className="space-y-2">
                      <Label>目标ROAS</Label>
                      <div className="flex items-center gap-4">
                        <Slider
                          value={[newStrategy.targetRoas]}
                          onValueChange={([v]) => setNewStrategy({ ...newStrategy, targetRoas: v })}
                          min={1}
                          max={10}
                          step={0.1}
                          className="flex-1"
                        />
                        <span className="w-16 text-right font-mono">{newStrategy.targetRoas.toFixed(1)}</span>
                      </div>
                    </div>
                  )}

                  {/* 分析周期 */}
                  <div className="space-y-2">
                    <Label>历史数据分析周期</Label>
                    <Select
                      value={newStrategy.lookbackDays.toString()}
                      onValueChange={(v) => setNewStrategy({ ...newStrategy, lookbackDays: parseInt(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7">过去7天</SelectItem>
                        <SelectItem value="14">过去14天</SelectItem>
                        <SelectItem value="30">过去30天</SelectItem>
                        <SelectItem value="60">过去60天</SelectItem>
                        <SelectItem value="90">过去90天</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    取消
                  </Button>
                  <Button onClick={handleGenerateStrategy} disabled={generateStrategyMutation.isPending}>
                    {generateStrategyMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        生成中...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        生成最优策略
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* 策略列表 */}
        {strategies && strategies.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">已创建的分时策略</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {strategies.map((strategy) => (
                  <div
                    key={strategy.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${strategy.status === "active" ? "bg-green-500/10" : "bg-muted"}`}>
                        {strategy.status === "active" ? (
                          <Play className="h-5 w-5 text-green-500" />
                        ) : (
                          <Pause className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium">{strategy.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {strategy.strategyType === "budget" ? "预算分配" : strategy.strategyType === "bidding" ? "竞价调整" : "预算+竞价"}
                          {" · "}
                          {OPTIMIZATION_GOALS.find((g) => g.value === strategy.optimizationGoal)?.label || strategy.optimizationGoal}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={strategy.status === "active" ? "default" : strategy.status === "paused" ? "secondary" : "outline"}>
                        {strategy.status === "active" ? "运行中" : strategy.status === "paused" ? "已暂停" : "草稿"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          updateStatusMutation.mutate({
                            strategyId: strategy.id,
                            status: strategy.status === "active" ? "paused" : "active",
                          });
                        }}
                      >
                        {strategy.status === "active" ? "暂停" : "启用"}
                      </Button>
                      <Button variant="ghost" size="icon">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 数据分析展示 */}
        {selectedCampaignId && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="overview">数据概览</TabsTrigger>
              <TabsTrigger value="weekly">每周预算分配</TabsTrigger>
              <TabsTrigger value="hourly">每小时竞价调整</TabsTrigger>
            </TabsList>

            {/* 数据概览 */}
            <TabsContent value="overview" className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 每周表现概览 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      每周表现分析
                    </CardTitle>
                    <CardDescription>过去{newStrategy.lookbackDays}天各星期的平均表现</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {weeklyLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : weeklyAnalysis && weeklyAnalysis.length > 0 ? (
                      <div className="space-y-3">
                        {weeklyAnalysis.map((day) => (
                          <div key={day.dayOfWeek} className="flex items-center gap-3">
                            <div className="w-12 text-sm font-medium">{day.dayLabel}</div>
                            <div className="flex-1">
                              <div className="h-6 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${getHeatmapColor(day.performanceScore, 0, 100)} transition-all`}
                                  style={{ width: `${day.performanceScore}%` }}
                                />
                              </div>
                            </div>
                            <div className="w-20 text-right text-sm">
                              <span className="text-muted-foreground">ROAS:</span>{" "}
                              <span className="font-mono">{day.avgRoas.toFixed(2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>暂无历史数据</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* 建议预算分配 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <DollarSign className="h-5 w-5" />
                      建议预算分配
                    </CardTitle>
                    <CardDescription>基于历史表现的最优预算倍数</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {budgetPreview?.allocation ? (
                      <div className="space-y-3">
                        {budgetPreview.allocation.map((rule) => (
                          <div key={rule.dayOfWeek} className="flex items-center gap-3">
                            <div className="w-12 text-sm font-medium">{DAY_LABELS[rule.dayOfWeek]}</div>
                            <div className="flex-1 flex items-center gap-2">
                              <div
                                className={`px-2 py-1 rounded text-xs font-mono ${getMultiplierColor(rule.budgetMultiplier)}`}
                              >
                                {rule.budgetMultiplier.toFixed(2)}x
                              </div>
                              <div className="text-xs text-muted-foreground truncate">{rule.reason}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>选择广告活动后显示建议</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* 每周预算分配 */}
            <TabsContent value="weekly" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    每周预算分配热力图
                  </CardTitle>
                  <CardDescription>
                    颜色越深表示该天的表现越好，建议分配更多预算
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {budgetPreview?.weeklyData ? (
                    <div className="space-y-4">
                      {/* 热力图 */}
                      <div className="grid grid-cols-7 gap-2">
                        {DAY_LABELS.map((label, index) => {
                          const dayData = budgetPreview.weeklyData.find((d) => d.dayOfWeek === index);
                          const allocation = budgetPreview.allocation.find((a) => a.dayOfWeek === index);
                          return (
                            <div key={index} className="text-center">
                              <div className="text-sm font-medium mb-2">{label}</div>
                              <div
                                className={`aspect-square rounded-lg flex flex-col items-center justify-center ${
                                  dayData ? getHeatmapColor(dayData.performanceScore, 0, 100) : "bg-muted"
                                }`}
                              >
                                <div className="text-white font-bold text-lg">
                                  {allocation?.budgetMultiplier.toFixed(1)}x
                                </div>
                                <div className="text-white/80 text-xs">
                                  ROAS: {dayData?.avgRoas.toFixed(1) || "N/A"}
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                ${dayData?.avgSpend.toFixed(0) || 0}/天
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* 图例 */}
                      <div className="flex items-center justify-center gap-4 pt-4 border-t">
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded bg-red-500/80" />
                          <span className="text-xs">低效</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded bg-yellow-500/80" />
                          <span className="text-xs">一般</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded bg-green-500/80" />
                          <span className="text-xs">良好</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded bg-emerald-500/80" />
                          <span className="text-xs">优秀</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>选择广告活动后显示预算分配热力图</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* 每小时竞价调整 */}
            <TabsContent value="hourly" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    每小时竞价调整热力图
                  </CardTitle>
                  <CardDescription>
                    显示每周每小时的建议出价倍数，颜色越深表示建议出价越高
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {bidPreview?.adjustments && bidPreview.adjustments.length > 0 ? (
                    <div className="overflow-x-auto">
                      <div className="min-w-[800px]">
                        {/* 小时标签 */}
                        <div className="flex mb-2">
                          <div className="w-16" />
                          {HOUR_LABELS.map((hour, index) => (
                            <div key={index} className="flex-1 text-center text-xs text-muted-foreground">
                              {index % 3 === 0 ? hour.split(":")[0] : ""}
                            </div>
                          ))}
                        </div>

                        {/* 热力图网格 */}
                        {DAY_LABELS.map((dayLabel, dayIndex) => (
                          <div key={dayIndex} className="flex mb-1">
                            <div className="w-16 text-sm font-medium flex items-center">{dayLabel}</div>
                            <div className="flex-1 flex gap-0.5">
                              {HOUR_LABELS.map((_, hourIndex) => {
                                const adjustment = bidPreview.adjustments.find(
                                  (a) => a.dayOfWeek === dayIndex && a.hour === hourIndex
                                );
                                const multiplier = adjustment?.bidMultiplier || 1;
                                return (
                                  <div
                                    key={hourIndex}
                                    className={`flex-1 h-8 rounded-sm ${getMultiplierColor(multiplier)} flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary transition-all`}
                                    title={`${dayLabel} ${HOUR_LABELS[hourIndex]}: ${multiplier.toFixed(2)}x`}
                                  >
                                    <span className="text-[10px] font-mono opacity-80">
                                      {multiplier.toFixed(1)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}

                        {/* 图例 */}
                        <div className="flex items-center justify-center gap-4 pt-4 mt-4 border-t">
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-red-500/80" />
                            <span className="text-xs">&lt;0.5x 低出价</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-orange-500/80" />
                            <span className="text-xs">0.5-0.8x</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-blue-500/80" />
                            <span className="text-xs">0.8-1.2x 标准</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-green-500/80" />
                            <span className="text-xs">1.2-1.5x</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-emerald-500/80" />
                            <span className="text-xs">&gt;1.5x 高出价</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>选择广告活动后显示竞价调整热力图</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* 空状态 */}
        {!selectedCampaignId && (
          <Card className="border-dashed">
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <Zap className="h-16 w-16 mx-auto mb-4 opacity-30" />
                <h3 className="text-lg font-medium mb-2">开始使用分时策略</h3>
                <p className="max-w-md mx-auto">
                  选择一个广告活动，系统将分析其历史表现数据，
                  自动生成最优的分时预算分配和竞价调整策略，
                  帮助您在正确的时间投放正确的预算。
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
