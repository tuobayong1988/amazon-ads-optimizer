import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Bot,
  Power,
  PowerOff,
  Shield,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Settings,
  Play,
  Pause,
  RefreshCw,
  Loader2,
  TrendingUp,
  Zap,
  Target,
  DollarSign,
  BarChart3,
  History,
  AlertOctagon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// 执行类型配置
const executionTypes = [
  { key: 'bid_adjustment', label: '竞价调整', icon: DollarSign, color: 'text-blue-500' },
  { key: 'budget_adjustment', label: '预算调整', icon: Target, color: 'text-green-500' },
  { key: 'placement_tilt', label: '位置倾斜', icon: BarChart3, color: 'text-purple-500' },
  { key: 'negative_keyword', label: '否定词', icon: XCircle, color: 'text-red-500' },
  { key: 'dayparting', label: '分时策略', icon: Clock, color: 'text-orange-500' },
  { key: 'auto_rollback', label: '自动回滚', icon: RefreshCw, color: 'text-cyan-500' },
];

// 执行模式配置
const automationModes = [
  { value: 'full_auto', label: '全自动', description: '满足条件自动执行，无需人工干预' },
  { value: 'supervised', label: '监督模式', description: '自动执行并事后通知' },
  { value: 'approval', label: '审批模式', description: '需人工确认后执行' },
  { value: 'disabled', label: '禁用', description: '暂停所有自动化' },
];

export default function AutomationControl() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [showEmergencyDialog, setShowEmergencyDialog] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [isRunningCycle, setIsRunningCycle] = useState(false);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // 获取自动化配置
  const { data: config, refetch: refetchConfig } = trpc.automation.getConfig.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取每日执行统计
  const { data: dailyStats } = trpc.automation.getDailyStats.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取执行历史
  const { data: executionHistory } = trpc.automation.getExecutionHistory.useQuery(
    { accountId: accountId!, limit: 10 },
    { enabled: !!accountId }
  );

  // 更新配置
  const updateConfig = trpc.automation.updateConfig.useMutation({
    onSuccess: () => {
      toast.success("配置已更新");
      refetchConfig();
    },
    onError: (error) => {
      toast.error("更新失败: " + error.message);
    },
  });

  // 运行完整周期
  const runFullCycle = trpc.automation.runFullCycle.useMutation({
    onSuccess: (result) => {
      toast.success(`自动化周期完成：分析 ${result.summary.totalAnalyzed} 项，执行 ${result.summary.totalExecuted} 项`);
      setIsRunningCycle(false);
      refetchConfig();
    },
    onError: (error) => {
      toast.error("执行失败: " + error.message);
      setIsRunningCycle(false);
    },
  });

  // 紧急停止
  const emergencyStop = trpc.automation.emergencyStop.useMutation({
    onSuccess: () => {
      toast.success("自动化已紧急停止");
      setShowEmergencyDialog(false);
      setEmergencyReason("");
      refetchConfig();
    },
    onError: (error) => {
      toast.error("停止失败: " + error.message);
    },
  });

  // 恢复自动化
  const resume = trpc.automation.resume.useMutation({
    onSuccess: () => {
      toast.success("自动化已恢复");
      refetchConfig();
    },
    onError: (error) => {
      toast.error("恢复失败: " + error.message);
    },
  });

  const handleToggleEnabled = () => {
    if (!accountId) return;
    if (config?.enabled) {
      setShowEmergencyDialog(true);
    } else {
      resume.mutate({ accountId });
    }
  };

  const handleEmergencyStop = () => {
    if (!accountId || !emergencyReason) return;
    emergencyStop.mutate({ accountId, reason: emergencyReason });
  };

  const handleModeChange = (mode: string) => {
    if (!accountId) return;
    updateConfig.mutate({ accountId, mode: mode as any });
  };

  const handleToggleType = (type: string, enabled: boolean) => {
    if (!accountId || !config) return;
    const newTypes = enabled
      ? [...config.enabledTypes, type]
      : config.enabledTypes.filter(t => t !== type);
    updateConfig.mutate({ accountId, enabledTypes: newTypes as any });
  };

  const handleRunCycle = () => {
    if (!accountId) return;
    setIsRunningCycle(true);
    runFullCycle.mutate({ accountId });
  };

  // 计算执行进度
  const executionProgress = useMemo(() => {
    if (!dailyStats) return { bid: 0, budget: 0, total: 0 };
    const boundary = config?.safetyBoundary || { maxDailyBidAdjustments: 100, maxDailyBudgetAdjustments: 10, maxDailyTotalAdjustments: 150 };
    return {
      bid: (dailyStats.bidAdjustments / boundary.maxDailyBidAdjustments) * 100,
      budget: (dailyStats.budgetAdjustments / boundary.maxDailyBudgetAdjustments) * 100,
      total: (dailyStats.totalAdjustments / boundary.maxDailyTotalAdjustments) * 100,
    };
  }, [dailyStats, config]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="w-6 h-6 text-blue-500" />
              自动化控制中心
            </h1>
            <p className="text-muted-foreground">
              系统自动完成优化工作，人只做监督
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={selectedAccountId?.toString() || ""}
              onValueChange={(v) => setSelectedAccountId(parseInt(v))}
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
          </div>
        </div>

        {/* 主控开关和状态 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className={config?.enabled ? "border-green-500/50" : "border-red-500/50"}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {config?.enabled ? (
                    <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                      <Power className="w-6 h-6 text-green-500" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                      <PowerOff className="w-6 h-6 text-red-500" />
                    </div>
                  )}
                  <div>
                    <p className="font-medium">自动化状态</p>
                    <p className={`text-2xl font-bold ${config?.enabled ? 'text-green-500' : 'text-red-500'}`}>
                      {config?.enabled ? '运行中' : '已停止'}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config?.enabled || false}
                  onCheckedChange={handleToggleEnabled}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Activity className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">今日执行</p>
                  <p className="text-2xl font-bold">{dailyStats?.totalAdjustments || 0}</p>
                  <p className="text-xs text-muted-foreground">
                    剩余 {dailyStats?.remaining.totalAdjustments || 0} 次
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-purple-500" />
                  </div>
                  <div>
                    <p className="font-medium">执行模式</p>
                    <p className="text-lg font-bold">
                      {automationModes.find(m => m.value === config?.mode)?.label || '全自动'}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleRunCycle}
                  disabled={isRunningCycle || !config?.enabled}
                  size="sm"
                >
                  {isRunningCycle ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="settings">安全设置</TabsTrigger>
            <TabsTrigger value="history">执行历史</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {/* 执行类型开关 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  自动化执行类型
                </CardTitle>
                <CardDescription>
                  选择允许系统自动执行的优化类型
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {executionTypes.map((type) => {
                    const Icon = type.icon;
                    const isEnabled = config?.enabledTypes?.includes(type.key as any) || false;
                    return (
                      <div
                        key={type.key}
                        className={`p-4 rounded-lg border transition-colors ${
                          isEnabled ? 'border-primary bg-primary/5' : 'border-border'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Icon className={`w-5 h-5 ${type.color}`} />
                            <span className="font-medium">{type.label}</span>
                          </div>
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={(checked) => handleToggleType(type.key, checked)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* 执行模式选择 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  执行模式
                </CardTitle>
                <CardDescription>
                  选择自动化执行的控制级别
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {automationModes.map((mode) => (
                    <div
                      key={mode.value}
                      onClick={() => handleModeChange(mode.value)}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        config?.mode === mode.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <p className="font-medium">{mode.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">{mode.description}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 每日执行进度 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  今日执行进度
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>竞价调整</span>
                    <span>{dailyStats?.bidAdjustments || 0} / {config?.safetyBoundary?.maxDailyBidAdjustments || 100}</span>
                  </div>
                  <Progress value={executionProgress.bid} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>预算调整</span>
                    <span>{dailyStats?.budgetAdjustments || 0} / {config?.safetyBoundary?.maxDailyBudgetAdjustments || 10}</span>
                  </div>
                  <Progress value={executionProgress.budget} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>总调整数</span>
                    <span>{dailyStats?.totalAdjustments || 0} / {config?.safetyBoundary?.maxDailyTotalAdjustments || 150}</span>
                  </div>
                  <Progress value={executionProgress.total} className="h-2" />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            {/* 安全边界设置 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  安全边界配置
                </CardTitle>
                <CardDescription>
                  设置自动执行的安全限制，防止异常操作
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-medium">单次调整限制</h4>
                    <div>
                      <Label>竞价调整幅度上限 ({config?.safetyBoundary?.maxBidChangePercent || 30}%)</Label>
                      <Slider
                        value={[config?.safetyBoundary?.maxBidChangePercent || 30]}
                        onValueChange={([v]) => updateConfig.mutate({
                          accountId: accountId!,
                          safetyBoundary: { maxBidChangePercent: v }
                        })}
                        max={100}
                        step={5}
                        className="mt-2"
                      />
                    </div>
                    <div>
                      <Label>预算调整幅度上限 ({config?.safetyBoundary?.maxBudgetChangePercent || 50}%)</Label>
                      <Slider
                        value={[config?.safetyBoundary?.maxBudgetChangePercent || 50]}
                        onValueChange={([v]) => updateConfig.mutate({
                          accountId: accountId!,
                          safetyBoundary: { maxBudgetChangePercent: v }
                        })}
                        max={100}
                        step={5}
                        className="mt-2"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h4 className="font-medium">置信度阈值</h4>
                    <div>
                      <Label>全自动执行阈值 ({config?.safetyBoundary?.autoExecuteConfidence || 80}%)</Label>
                      <Slider
                        value={[config?.safetyBoundary?.autoExecuteConfidence || 80]}
                        onValueChange={([v]) => updateConfig.mutate({
                          accountId: accountId!,
                          safetyBoundary: { autoExecuteConfidence: v }
                        })}
                        max={100}
                        step={5}
                        className="mt-2"
                      />
                    </div>
                    <div>
                      <Label>监督执行阈值 ({config?.safetyBoundary?.supervisedConfidence || 60}%)</Label>
                      <Slider
                        value={[config?.safetyBoundary?.supervisedConfidence || 60]}
                        onValueChange={([v]) => updateConfig.mutate({
                          accountId: accountId!,
                          safetyBoundary: { supervisedConfidence: v }
                        })}
                        max={100}
                        step={5}
                        className="mt-2"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 每日限制设置 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">每日执行限制</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>每日竞价调整上限</Label>
                    <Input
                      type="number"
                      value={config?.safetyBoundary?.maxDailyBidAdjustments || 100}
                      onChange={(e) => updateConfig.mutate({
                        accountId: accountId!,
                        safetyBoundary: { maxDailyBidAdjustments: parseInt(e.target.value) }
                      })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>每日预算调整上限</Label>
                    <Input
                      type="number"
                      value={config?.safetyBoundary?.maxDailyBudgetAdjustments || 10}
                      onChange={(e) => updateConfig.mutate({
                        accountId: accountId!,
                        safetyBoundary: { maxDailyBudgetAdjustments: parseInt(e.target.value) }
                      })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>每日总调整上限</Label>
                    <Input
                      type="number"
                      value={config?.safetyBoundary?.maxDailyTotalAdjustments || 150}
                      onChange={(e) => updateConfig.mutate({
                        accountId: accountId!,
                        safetyBoundary: { maxDailyTotalAdjustments: parseInt(e.target.value) }
                      })}
                      className="mt-1"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <History className="w-5 h-5" />
                  执行历史
                </CardTitle>
              </CardHeader>
              <CardContent>
                {executionHistory && executionHistory.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>批次ID</TableHead>
                        <TableHead>执行时间</TableHead>
                        <TableHead>总数</TableHead>
                        <TableHead>成功</TableHead>
                        <TableHead>失败</TableHead>
                        <TableHead>跳过</TableHead>
                        <TableHead>阻止</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {executionHistory.map((batch) => (
                        <TableRow key={batch.id}>
                          <TableCell className="font-mono text-xs">{batch.id.slice(0, 12)}...</TableCell>
                          <TableCell>{new Date(batch.startedAt).toLocaleString()}</TableCell>
                          <TableCell>{batch.totalItems}</TableCell>
                          <TableCell className="text-green-500">{batch.successItems}</TableCell>
                          <TableCell className="text-red-500">{batch.failedItems}</TableCell>
                          <TableCell className="text-yellow-500">{batch.skippedItems}</TableCell>
                          <TableCell className="text-orange-500">{batch.blockedItems}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无执行历史
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 紧急停止对话框 */}
        <Dialog open={showEmergencyDialog} onOpenChange={setShowEmergencyDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-500">
                <AlertOctagon className="w-5 h-5" />
                紧急停止自动化
              </DialogTitle>
              <DialogDescription>
                停止后所有自动化执行将暂停，需要手动恢复。请输入停止原因：
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input
                placeholder="请输入停止原因..."
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEmergencyDialog(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={handleEmergencyStop}
                disabled={!emergencyReason}
              >
                确认停止
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
