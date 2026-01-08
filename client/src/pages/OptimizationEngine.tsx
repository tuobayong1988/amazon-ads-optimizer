/**
 * OptimizationEngine - 优化引擎
 * 合并原有的优化中心和自动执行功能
 */

import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { 
  Zap,
  Bot,
  Play,
  Pause,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  BarChart3,
  Settings,
  History,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Loader2
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

export default function OptimizationEngine() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("recommendations");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  // 获取账号列表
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // 获取优化建议 - 使用mutation作为查询
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const runAnalysisMutation = trpc.unifiedOptimization.runAnalysis.useMutation({
    onSuccess: (data) => {
      setRecommendations(data || []);
    }
  });

  // 获取优化摘要
  const summaryQuery = trpc.unifiedOptimization.getSummary.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 获取自动化配置
  const automationConfigQuery = trpc.automation.getConfig.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );

  // 执行优化决策
  const executeMutation = trpc.unifiedOptimization.executeDecision.useMutation({
    onSuccess: () => {
      toast.success("优化执行成功");
      runAnalysisMutation.mutate({ accountId: accountId! });
      summaryQuery.refetch();
    },
    onError: (err: any) => {
      toast.error(`执行失败: ${err.message}`);
    }
  });

  // 批量执行 - 使用单个执行的循环代替
  const batchExecuteAsync = async (ids: number[]) => {
    let successCount = 0;
    let failedCount = 0;
    for (const id of ids) {
      try {
        await executeMutation.mutateAsync({ decisionId: id.toString() });
        successCount++;
      } catch {
        failedCount++;
      }
    }
    return { successCount, failedCount };
  };

  // 刷新所有数据
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        runAnalysisMutation.mutateAsync({ accountId: accountId! }),
        summaryQuery.refetch(),
        automationConfigQuery.refetch(),
      ]);
      toast.success("数据刷新成功");
    } catch (err) {
      toast.error("刷新失败");
    } finally {
      setIsRefreshing(false);
    }
  };

  // 执行单个建议
  const handleExecute = async (recommendationId: number) => {
    setIsExecuting(true);
    try {
      await executeMutation.mutateAsync({ decisionId: recommendationId.toString() });
    } finally {
      setIsExecuting(false);
    }
  };

  // 批量执行高置信度建议
  const handleBatchExecute = async () => {
    const highConfidenceIds = recommendations?.filter((r: any) => r.confidence >= 0.8 && r.status === 'pending')
      .map((r: any) => r.id) || [];
    
    if (highConfidenceIds.length === 0) {
      toast.info("没有可执行的高置信度建议");
      return;
    }

    setIsExecuting(true);
    try {
      const result = await batchExecuteAsync(highConfidenceIds);
      toast.success(`批量执行完成: ${result.successCount}成功, ${result.failedCount}失败`);
      runAnalysisMutation.mutate({ accountId: accountId! });
      summaryQuery.refetch();
    } finally {
      setIsExecuting(false);
    }
  };

  // 计算优化摘要
  const optimizationSummary = useMemo(() => {
    const recs = recommendations || [];
    const pending = recs.filter((r: any) => r.status === 'pending').length;
    const highConfidence = recs.filter((r: any) => r.confidence >= 0.8 && r.status === 'pending').length;
    const executed = (summaryQuery.data as any)?.executedCount || 0;

    return {
      totalRecommendations: recs.length,
      pendingCount: pending,
      highConfidenceCount: highConfidence,
      executedToday: executed,
      automationEnabled: automationConfigQuery.data?.enabled || false
    };
  }, [recommendations, summaryQuery.data, automationConfigQuery.data]);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'bid_increase':
      case 'bid_decrease':
        return <DollarSign className="h-4 w-4" />;
      case 'budget_increase':
      case 'budget_decrease':
        return <BarChart3 className="h-4 w-4" />;
      case 'pause_keyword':
      case 'enable_keyword':
        return <Target className="h-4 w-4" />;
      default:
        return <Zap className="h-4 w-4" />;
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-400 bg-green-500/20';
    if (confidence >= 0.6) return 'text-yellow-400 bg-yellow-500/20';
    return 'text-orange-400 bg-orange-500/20';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="secondary">待执行</Badge>;
      case 'executed': return <Badge variant="default">已执行</Badge>;
      case 'rejected': return <Badge variant="destructive">已拒绝</Badge>;
      case 'success': return <Badge className="bg-green-500">成功</Badge>;
      case 'failed': return <Badge variant="destructive">失败</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="h-7 w-7 text-yellow-400" />
              优化引擎
            </h1>
            <p className="text-muted-foreground mt-1">
              智能优化建议和自动执行的统一入口
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={accountId?.toString() || ""}
              onValueChange={(v) => setSelectedAccountId(parseInt(v))}
            >
              <SelectTrigger className="w-[180px]">
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>

        {/* 优化摘要卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-blue-500/20">
                  <Zap className="h-6 w-6 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">总建议</p>
                  <p className="text-2xl font-bold">{optimizationSummary.totalRecommendations}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-yellow-500/20">
                  <Clock className="h-6 w-6 text-yellow-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">待执行</p>
                  <p className="text-2xl font-bold">{optimizationSummary.pendingCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-green-500/20">
                  <CheckCircle className="h-6 w-6 text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">高置信度</p>
                  <p className="text-2xl font-bold">{optimizationSummary.highConfidenceCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-purple-500/20">
                  <History className="h-6 w-6 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">今日执行</p>
                  <p className="text-2xl font-bold">{optimizationSummary.executedToday}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-full ${optimizationSummary.automationEnabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
                  <Bot className={`h-6 w-6 ${optimizationSummary.automationEnabled ? 'text-green-400' : 'text-gray-400'}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">自动化</p>
                  <p className="text-2xl font-bold">{optimizationSummary.automationEnabled ? '开启' : '关闭'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 快捷操作 */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  onClick={handleBatchExecute}
                  disabled={isExecuting || optimizationSummary.highConfidenceCount === 0}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isExecuting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  一键执行高置信度建议 ({optimizationSummary.highConfidenceCount})
                </Button>
                <Link href="/automation-control">
                  <Button variant="outline">
                    <Settings className="h-4 w-4 mr-2" />
                    自动化设置
                  </Button>
                </Link>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>安全模式: 仅执行置信度≥80%的建议</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 主要标签页 */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="recommendations" className="gap-2">
              <Zap className="h-4 w-4" />
              优化建议
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" />
              执行历史
            </TabsTrigger>
          </TabsList>

          {/* 优化建议Tab */}
          <TabsContent value="recommendations" className="space-y-4">
            {recommendations?.filter((r: any) => r.status === 'pending').map((rec: any) => (
              <Card key={rec.id} className="hover:border-primary/50 transition-colors">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-full ${getConfidenceColor(rec.confidence)}`}>
                        {getTypeIcon(rec.type)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{rec.targetName || rec.keyword || rec.campaignName}</p>
                          <Badge variant="outline">{rec.type}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{rec.reason}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">当前值</p>
                        <p className="font-medium">${rec.currentValue?.toFixed(2)}</p>
                      </div>
                      <ArrowUpRight className={`h-5 w-5 ${rec.suggestedValue > rec.currentValue ? 'text-green-400' : 'text-red-400'}`} />
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">建议值</p>
                        <p className={`font-medium ${rec.suggestedValue > rec.currentValue ? 'text-green-400' : 'text-red-400'}`}>
                          ${rec.suggestedValue?.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">置信度</p>
                        <p className={`font-medium ${getConfidenceColor(rec.confidence).split(' ')[0]}`}>
                          {(rec.confidence * 100).toFixed(0)}%
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleExecute(rec.id)}
                        disabled={isExecuting}
                      >
                        {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : '执行'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )) || (
              <p className="text-center text-muted-foreground py-8">暂无待执行的优化建议</p>
            )}
          </TabsContent>

          {/* 执行历史Tab */}
          <TabsContent value="history" className="space-y-4">
            {((summaryQuery.data as any)?.recentExecutions || []).map((history: any) => (
              <Card key={history.id}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-full ${history.status === 'success' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                        {history.status === 'success' ? (
                          <CheckCircle className="h-4 w-4 text-green-400" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{history.targetName || history.description}</p>
                        <p className="text-sm text-muted-foreground">
                          {history.type} · {new Date(history.executedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">原值</p>
                        <p className="font-medium">${history.previousValue?.toFixed(2)}</p>
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">新值</p>
                        <p className="font-medium">${history.newValue?.toFixed(2)}</p>
                      </div>
                      {getStatusBadge(history.status)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )) || (
              <p className="text-center text-muted-foreground py-8">暂无执行历史</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
