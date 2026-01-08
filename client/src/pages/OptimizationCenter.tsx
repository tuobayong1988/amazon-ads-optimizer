import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Zap, 
  Bot, 
  Activity, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Play,
  Pause,
  RefreshCw,
  Settings,
  Target,
  DollarSign,
  MapPin,
  BarChart3,
  Loader2,
  ChevronRight,
  Eye,
  Check,
  X
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// 优化类型配置
const optimizationTypes = [
  { 
    key: 'bid_adjustment', 
    label: '竞价调整', 
    icon: DollarSign, 
    color: 'text-blue-500',
    description: '基于利润最大化公式自动调整关键词出价'
  },
  { 
    key: 'placement_tilt', 
    label: '位置倾斜', 
    icon: MapPin, 
    color: 'text-purple-500',
    description: '优化展示位置竞价调整，采用智能优化策略'
  },
  { 
    key: 'dayparting', 
    label: '分时策略', 
    icon: Clock, 
    color: 'text-orange-500',
    description: '根据时段表现自动调整出价'
  },
  { 
    key: 'negative_keyword', 
    label: '否定词', 
    icon: X, 
    color: 'text-red-500',
    description: '自动识别并添加高花费低转化的否定词'
  },
];

// 执行模式配置
const executionModes = [
  { value: 'full_auto', label: '全自动', description: '算法决策并自动执行' },
  { value: 'semi_auto', label: '半自动', description: '算法决策，人工确认后执行' },
  { value: 'manual', label: '手动', description: '仅生成建议，不自动执行' },
  { value: 'disabled', label: '禁用', description: '暂停所有自动优化' },
];

export default function OptimizationCenter() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false);
  const [selectedDecisions, setSelectedDecisions] = useState<string[]>([]);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // 获取优化摘要
  const { data: summary, refetch: refetchSummary } = trpc.unifiedOptimization.getSummary.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 运行分析
  const runAnalysis = trpc.unifiedOptimization.runAnalysis.useMutation({
    onSuccess: (decisions) => {
      toast.success(`分析完成，生成 ${decisions.length} 条优化建议`);
      setIsRunningAnalysis(false);
      refetchSummary();
    },
    onError: (error) => {
      toast.error("分析失败: " + error.message);
      setIsRunningAnalysis(false);
    },
  });

  // 执行决策
  const executeDecision = trpc.unifiedOptimization.executeDecision.useMutation({
    onSuccess: () => {
      toast.success("决策已执行");
      refetchSummary();
    },
    onError: (error) => {
      toast.error("执行失败: " + error.message);
    },
  });

  // 批量执行决策
  const batchExecute = trpc.unifiedOptimization.batchExecuteDecisions.useMutation({
    onSuccess: (result) => {
      toast.success(`批量执行完成：成功 ${result.success} 个，失败 ${result.failed} 个`);
      setSelectedDecisions([]);
      refetchSummary();
    },
    onError: (error) => {
      toast.error("批量执行失败: " + error.message);
    },
  });

  const handleRunAnalysis = () => {
    if (!accountId) return;
    setIsRunningAnalysis(true);
    runAnalysis.mutate({ accountId });
  };

  const handleExecuteSelected = () => {
    if (selectedDecisions.length === 0) return;
    batchExecute.mutate({ decisionIds: selectedDecisions });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="w-6 h-6 text-yellow-500" />
              优化中心
            </h1>
            <p className="text-muted-foreground">
              统一的自动优化引擎 · 算法决策执行，人只做监督
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
            <Button onClick={handleRunAnalysis} disabled={isRunningAnalysis || !accountId}>
              {isRunningAnalysis ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              运行分析
            </Button>
          </div>
        </div>

        {/* 状态概览卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">优化引擎状态</p>
                  <p className="text-2xl font-bold text-green-500">运行中</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Bot className="w-6 h-6 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">待审批决策</p>
                  <p className="text-2xl font-bold">{summary?.pendingDecisions || 0}</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-orange-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">今日已执行</p>
                  <p className="text-2xl font-bold">{summary?.executedToday || 0}</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">成功率</p>
                  <p className="text-2xl font-bold">{((summary?.successRate || 0) * 100).toFixed(1)}%</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-purple-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 主要内容区 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="decisions">优化决策</TabsTrigger>
            <TabsTrigger value="settings">引擎设置</TabsTrigger>
            <TabsTrigger value="history">执行历史</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {/* 优化类型统计 */}
            <Card>
              <CardHeader>
                <CardTitle>优化类型统计</CardTitle>
                <CardDescription>各类型优化的执行情况</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {optimizationTypes.map((type) => {
                    const stats = summary?.byType?.[type.key as keyof typeof summary.byType];
                    const Icon = type.icon;
                    return (
                      <div key={type.key} className="p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className={`w-4 h-4 ${type.color}`} />
                          <span className="font-medium">{type.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">{type.description}</p>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <p className="text-muted-foreground text-xs">总计</p>
                            <p className="font-semibold">{stats?.total || 0}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">待执行</p>
                            <p className="font-semibold text-orange-500">{stats?.pending || 0}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">已执行</p>
                            <p className="font-semibold text-green-500">{stats?.executed || 0}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* 最近决策 */}
            <Card>
              <CardHeader>
                <CardTitle>最近优化决策</CardTitle>
                <CardDescription>最新生成的优化建议</CardDescription>
              </CardHeader>
              <CardContent>
                {summary?.recentDecisions && summary.recentDecisions.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>类型</TableHead>
                        <TableHead>目标</TableHead>
                        <TableHead>当前值</TableHead>
                        <TableHead>建议值</TableHead>
                        <TableHead>预期影响</TableHead>
                        <TableHead>置信度</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.recentDecisions.map((decision) => (
                        <TableRow key={decision.id}>
                          <TableCell>
                            <Badge variant="outline">{decision.type}</Badge>
                          </TableCell>
                          <TableCell className="font-medium">{decision.targetName}</TableCell>
                          <TableCell>{String(decision.currentValue)}</TableCell>
                          <TableCell className="text-blue-500">{String(decision.suggestedValue)}</TableCell>
                          <TableCell>
                            <span className={decision.expectedImpact.changePercent < 0 ? 'text-green-500' : 'text-red-500'}>
                              {decision.expectedImpact.changePercent > 0 ? '+' : ''}{decision.expectedImpact.changePercent.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell>
                            <Progress value={decision.confidence * 100} className="w-16 h-2" />
                          </TableCell>
                          <TableCell>
                            <Badge variant={decision.status === 'pending' ? 'secondary' : 'default'}>
                              {decision.status === 'pending' ? '待执行' : decision.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {decision.status === 'pending' && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => executeDecision.mutate({ decisionId: decision.id })}
                                >
                                  <Check className="w-4 h-4 text-green-500" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                >
                                  <X className="w-4 h-4 text-red-500" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>暂无优化决策</p>
                    <p className="text-sm">点击"运行分析"生成优化建议</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="decisions" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>待审批决策</CardTitle>
                    <CardDescription>需要人工确认的优化建议</CardDescription>
                  </div>
                  {selectedDecisions.length > 0 && (
                    <Button onClick={handleExecuteSelected}>
                      批量执行 ({selectedDecisions.length})
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>暂无待审批的决策</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>优化引擎设置</CardTitle>
                <CardDescription>配置自动优化的执行模式和参数</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 全局执行模式 */}
                <div>
                  <h4 className="font-medium mb-3">全局执行模式</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {executionModes.map((mode) => (
                      <div
                        key={mode.value}
                        className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                          mode.value === 'semi_auto' 
                            ? 'border-primary bg-primary/5' 
                            : 'hover:border-primary/50'
                        }`}
                      >
                        <p className="font-medium">{mode.label}</p>
                        <p className="text-xs text-muted-foreground">{mode.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 优化类型开关 */}
                <div>
                  <h4 className="font-medium mb-3">优化类型开关</h4>
                  <div className="space-y-3">
                    {optimizationTypes.map((type) => {
                      const Icon = type.icon;
                      return (
                        <div key={type.key} className="flex items-center justify-between p-3 rounded-lg border">
                          <div className="flex items-center gap-3">
                            <Icon className={`w-5 h-5 ${type.color}`} />
                            <div>
                              <p className="font-medium">{type.label}</p>
                              <p className="text-xs text-muted-foreground">{type.description}</p>
                            </div>
                          </div>
                          <Switch defaultChecked />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>执行历史</CardTitle>
                <CardDescription>已执行的优化决策记录</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>暂无执行历史</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
