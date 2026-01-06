import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Plus, 
  Target, 
  Settings, 
  Trash2, 
  Play, 
  Pause,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  BarChart3,
  Loader2,
  Bot,
  Activity,
  CheckCircle2,
  Clock,
  Zap,
  CircleDollarSign,
  ArrowUp,
  ArrowDown,
  AlertCircle
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

// 绩效组最优出价点显示组件（带一键采纳按钮）
function GroupOptimalBidCard({ groupId, accountId, onApplySuccess }: { 
  groupId: number; 
  accountId: number;
  onApplySuccess?: () => void;
}) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  
  const { data, isLoading, error, refetch } = trpc.placement.getPerformanceGroupOptimalBids.useQuery(
    { groupId, accountId },
    { 
      enabled: !!groupId && !!accountId,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    }
  );
  
  const applyGroupOptimalBids = trpc.placement.applyGroupOptimalBids.useMutation({
    onSuccess: (result) => {
      toast.success(`已应用${result.summary.totalApplied}个关键词的最优出价，预估利润提升$${result.summary.totalExpectedProfitIncrease}`);
      setShowConfirmDialog(false);
      setIsApplying(false);
      refetch();
      onApplySuccess?.();
    },
    onError: (error) => {
      toast.error(`应用失败: ${error.message}`);
      setIsApplying(false);
    },
  });

  const handleApply = () => {
    setIsApplying(true);
    applyGroupOptimalBids.mutate({
      groupId,
      accountId,
      minBidDifferencePercent: 5,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="text-xs">计算最优出价点中...</span>
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  const { summary, campaigns } = data;
  
  if (summary.totalAnalyzedKeywords === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        暂无市场曲线数据，无法计算最优出价
      </div>
    );
  }
  
  const hasAdjustments = summary.keywordsNeedIncrease > 0 || summary.keywordsNeedDecrease > 0;

  return (
    <>
      <div className="pt-3 border-t border-border/50">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <CircleDollarSign className="w-3 h-3" />
            利润最大化出价点
          </p>
          <div className="flex items-center gap-1">
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              summary.avgOptimizationScore >= 80 
                ? 'bg-green-500/10 text-green-600' 
                : summary.avgOptimizationScore >= 60 
                  ? 'bg-yellow-500/10 text-yellow-600'
                  : 'bg-red-500/10 text-red-600'
            }`}>
              优化度: {summary.avgOptimizationScore}%
            </span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-muted/30 rounded-lg p-2">
            <p className="text-muted-foreground mb-1">预估最大利润</p>
            <p className="font-semibold text-green-600">${summary.totalMaxProfit.toFixed(2)}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <p className="text-muted-foreground mb-1">已分析关键词</p>
            <p className="font-semibold">{summary.totalAnalyzedKeywords}个</p>
          </div>
        </div>
        
        <div className="flex items-center justify-between mt-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-green-600">
              <ArrowUp className="w-3 h-3" />
              {summary.keywordsNeedIncrease}需提高
            </span>
            <span className="flex items-center gap-1 text-red-600">
              <ArrowDown className="w-3 h-3" />
              {summary.keywordsNeedDecrease}需降低
            </span>
          </div>
          <span className="text-muted-foreground">
            {summary.overallRecommendation === 'increase_bids' ? '建议提高出价' :
             summary.overallRecommendation === 'decrease_bids' ? '建议降低出价' : '出价合理'}
          </span>
        </div>
        
        {/* 一键采纳按钮 */}
        {hasAdjustments && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-3 h-8 text-xs text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            onClick={() => setShowConfirmDialog(true)}
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
            一键采纳所有优化建议
          </Button>
        )}
      </div>
      
      {/* 确认对话框 */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleDollarSign className="w-5 h-5 text-blue-500" />
              确认应用绩效组最优出价
            </DialogTitle>
            <DialogDescription>
              将为绩效组“{summary.groupName}”下的所有广告活动应用最优出价
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* 汇总信息 */}
            <div className="grid grid-cols-3 gap-3 p-3 bg-muted/30 rounded-lg">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">涉及广告活动</p>
                <p className="text-lg font-semibold">{summary.analyzedCampaigns}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">待调整关键词</p>
                <p className="text-lg font-semibold">{summary.keywordsNeedIncrease + summary.keywordsNeedDecrease}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">预估利润提升</p>
                <p className="text-lg font-semibold text-green-600">${(summary.totalMaxProfit * 0.1).toFixed(2)}</p>
              </div>
            </div>
            
            {/* 广告活动明细 */}
            <div className="max-h-48 overflow-y-auto space-y-2">
              <p className="text-xs text-muted-foreground font-medium">广告活动明细</p>
              {campaigns.map((campaign) => (
                <div key={campaign.campaignId} className="flex items-center justify-between text-xs p-2 bg-muted/20 rounded">
                  <span className="truncate max-w-[200px]" title={campaign.campaignName}>{campaign.campaignName}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-green-600">↑{campaign.keywordsNeedIncrease}</span>
                    <span className="text-red-600">↓{campaign.keywordsNeedDecrease}</span>
                    <span className="text-muted-foreground">分析{campaign.analyzedKeywords}个</span>
                  </div>
                </div>
              ))}
            </div>
            
            {/* 警告信息 */}
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
              <div className="text-xs text-yellow-700">
                <p className="font-medium">注意事项</p>
                <p>出价调整将立即生效，差距低于5%的关键词将被跳过</p>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)} disabled={isApplying}>
              取消
            </Button>
            <Button onClick={handleApply} disabled={isApplying}>
              {isApplying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  应用中...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  确认应用
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PerformanceGroups() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState<number | null>(null);

  // Fetch accounts
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // Fetch performance groups
  const { data: performanceGroups, isLoading, refetch } = trpc.performanceGroup.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // Mutations
  const createGroup = trpc.performanceGroup.create.useMutation({
    onSuccess: () => {
      toast.success("绩效组创建成功");
      setIsCreateDialogOpen(false);
      refetch();
    },
    onError: (error) => {
      toast.error("创建失败: " + error.message);
    },
  });

  const updateGroup = trpc.performanceGroup.update.useMutation({
    onSuccess: () => {
      toast.success("绩效组更新成功");
      refetch();
    },
  });

  const deleteGroup = trpc.performanceGroup.delete.useMutation({
    onSuccess: () => {
      toast.success("绩效组已删除");
      refetch();
    },
  });

  const runOptimization = trpc.optimization.runOptimization.useMutation({
    onSuccess: (result) => {
      toast.success(`优化完成，共调整 ${result.totalOptimizations} 个出价`);
      setIsOptimizing(null);
    },
    onError: (error) => {
      toast.error("优化失败: " + error.message);
      setIsOptimizing(null);
    },
  });

  const handleRunOptimization = async (groupId: number, dryRun: boolean = true) => {
    setIsOptimizing(groupId);
    runOptimization.mutate({ performanceGroupId: groupId, dryRun });
  };

  const goalLabels: Record<string, string> = {
    maximize_sales: '销售最大化',
    target_acos: '目标ACoS',
    target_roas: '目标ROAS',
    daily_spend_limit: '每日花费上限',
    daily_cost: '天成本',
  };

  const goalIcons: Record<string, React.ReactNode> = {
    maximize_sales: <TrendingUp className="w-5 h-5" />,
    target_acos: <Percent className="w-5 h-5" />,
    target_roas: <Target className="w-5 h-5" />,
    daily_spend_limit: <DollarSign className="w-5 h-5" />,
    daily_cost: <BarChart3 className="w-5 h-5" />,
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">绩效组管理</h1>
            <p className="text-muted-foreground">
              创建和管理广告活动绩效组，设置统一的优化目标
            </p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                创建绩效组
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <CreatePerformanceGroupForm
                accountId={accountId!}
                onSubmit={(data) => createGroup.mutate(data)}
                isLoading={createGroup.isPending}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* Performance Groups Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : performanceGroups && performanceGroups.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {performanceGroups.map((group) => (
              <Card key={group.id} className="relative overflow-hidden">
                <div className={`absolute top-0 left-0 right-0 h-1 ${
                  group.status === 'active' ? 'bg-success' : 
                  group.status === 'paused' ? 'bg-warning' : 'bg-muted'
                }`} />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                        {group.optimizationGoal && goalIcons[group.optimizationGoal] || <Target className="w-5 h-5" />}
                      </div>
                      <div>
                        <CardTitle className="text-lg">{group.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {group.optimizationGoal && goalLabels[group.optimizationGoal] || group.optimizationGoal || '未设置'}
                        </CardDescription>
                      </div>
                    </div>
                    <span className={`status-${group.status}`}>{group.status}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Target Values */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {group.targetAcos && (
                      <div>
                        <p className="text-muted-foreground">目标ACoS</p>
                        <p className="font-semibold">{group.targetAcos}%</p>
                      </div>
                    )}
                    {group.targetRoas && (
                      <div>
                        <p className="text-muted-foreground">目标ROAS</p>
                        <p className="font-semibold">{group.targetRoas}</p>
                      </div>
                    )}
                    {group.dailySpendLimit && (
                      <div>
                        <p className="text-muted-foreground">每日花费上限</p>
                        <p className="font-semibold">${group.dailySpendLimit}</p>
                      </div>
                    )}
                    {group.dailyCostTarget && (
                      <div>
                        <p className="text-muted-foreground">天成本目标</p>
                        <p className="font-semibold">${group.dailyCostTarget}</p>
                      </div>
                    )}
                  </div>

                  {/* 自动优化状态 */}
                  <div className="pt-3 border-t border-border/50">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Bot className="w-3 h-3" />
                        自动优化引擎
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-green-500">已启用</span>
                        <Switch defaultChecked className="scale-75" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Activity className="w-3 h-3" />
                        <span>半自动模式</span>
                      </div>
                      <div className="flex items-center gap-1 text-green-500">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>今日0执行</span>
                      </div>
                      <div className="flex items-center gap-1 text-orange-500">
                        <Clock className="w-3 h-3" />
                        <span>0待审批</span>
                      </div>
                    </div>
                  </div>

                  {/* 利润最大化出价点 */}
                  <GroupOptimalBidCard groupId={group.id} accountId={accountId!} />

                  {/* Current Performance */}
                  {(group.currentAcos || group.currentRoas) && (
                    <div className="pt-3 border-t border-border/50">
                      <p className="text-xs text-muted-foreground mb-2">当前表现</p>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        {group.currentAcos && (
                          <div>
                            <p className="text-muted-foreground">当前ACoS</p>
                            <p className="font-semibold">{group.currentAcos}%</p>
                          </div>
                        )}
                        {group.currentRoas && (
                          <div>
                            <p className="text-muted-foreground">当前ROAS</p>
                            <p className="font-semibold">{group.currentRoas}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleRunOptimization(group.id, true)}
                      disabled={isOptimizing === group.id}
                    >
                      {isOptimizing === group.id ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 mr-1" />
                      )}
                      预览优化
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleRunOptimization(group.id, false)}
                      disabled={isOptimizing === group.id}
                    >
                      执行优化
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm('确定要删除此绩效组吗？')) {
                          deleteGroup.mutate({ id: group.id });
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Target className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">暂无绩效组</h3>
              <p className="text-muted-foreground text-center mb-4">
                创建绩效组来管理和优化您的广告活动
              </p>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                创建第一个绩效组
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function CreatePerformanceGroupForm({
  accountId,
  onSubmit,
  isLoading,
}: {
  accountId: number;
  onSubmit: (data: any) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    optimizationGoal: "maximize_sales",
    targetAcos: "",
    targetRoas: "",
    dailySpendLimit: "",
    dailyCostTarget: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      accountId,
      name: formData.name,
      description: formData.description || undefined,
      optimizationGoal: formData.optimizationGoal as any,
      targetAcos: formData.targetAcos || undefined,
      targetRoas: formData.targetRoas || undefined,
      dailySpendLimit: formData.dailySpendLimit || undefined,
      dailyCostTarget: formData.dailyCostTarget || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>创建绩效组</DialogTitle>
        <DialogDescription>
          设置绩效组的名称和优化目标
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="name">绩效组名称</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="例如：高转化关键词组"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">描述（可选）</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="绩效组的描述..."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal">优化目标</Label>
          <Select
            value={formData.optimizationGoal}
            onValueChange={(value) => setFormData({ ...formData, optimizationGoal: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="maximize_sales">销售最大化</SelectItem>
              <SelectItem value="target_acos">目标ACoS</SelectItem>
              <SelectItem value="target_roas">目标ROAS</SelectItem>
              <SelectItem value="daily_spend_limit">每日花费上限</SelectItem>
              <SelectItem value="daily_cost">天成本</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {formData.optimizationGoal === "target_acos" && (
          <div className="space-y-2">
            <Label htmlFor="targetAcos">目标ACoS (%)</Label>
            <Input
              id="targetAcos"
              type="number"
              step="0.01"
              value={formData.targetAcos}
              onChange={(e) => setFormData({ ...formData, targetAcos: e.target.value })}
              placeholder="例如：25"
            />
          </div>
        )}

        {formData.optimizationGoal === "target_roas" && (
          <div className="space-y-2">
            <Label htmlFor="targetRoas">目标ROAS</Label>
            <Input
              id="targetRoas"
              type="number"
              step="0.01"
              value={formData.targetRoas}
              onChange={(e) => setFormData({ ...formData, targetRoas: e.target.value })}
              placeholder="例如：4.0"
            />
          </div>
        )}

        {formData.optimizationGoal === "daily_spend_limit" && (
          <div className="space-y-2">
            <Label htmlFor="dailySpendLimit">每日花费上限 ($)</Label>
            <Input
              id="dailySpendLimit"
              type="number"
              step="0.01"
              value={formData.dailySpendLimit}
              onChange={(e) => setFormData({ ...formData, dailySpendLimit: e.target.value })}
              placeholder="例如：100"
            />
          </div>
        )}

        {formData.optimizationGoal === "daily_cost" && (
          <div className="space-y-2">
            <Label htmlFor="dailyCostTarget">天成本目标 ($)</Label>
            <Input
              id="dailyCostTarget"
              type="number"
              step="0.01"
              value={formData.dailyCostTarget}
              onChange={(e) => setFormData({ ...formData, dailyCostTarget: e.target.value })}
              placeholder="例如：50"
            />
          </div>
        )}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isLoading || !formData.name}>
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          创建绩效组
        </Button>
      </DialogFooter>
    </form>
  );
}
