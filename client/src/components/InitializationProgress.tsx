/**
 * 账号初始化进度组件
 * 显示新店铺数据初始化的进度和状态
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle, 
  Clock, 
  Loader2, 
  XCircle, 
  RefreshCw, 
  Play,
  Database,
  Zap,
  TrendingDown
} from "lucide-react";
import { toast } from "sonner";

interface InitializationProgressProps {
  accountId: number;
  accountName?: string;
}

export function InitializationProgress({ accountId, accountName }: InitializationProgressProps) {
  // 获取初始化进度
  const { data: progress, isLoading, refetch } = trpc.reportJobs.getInitializationProgress.useQuery(
    { accountId },
    { refetchInterval: 5000 } // 每5秒刷新一次
  );

  // 获取同步统计
  const { data: syncStats } = trpc.reportJobs.getSyncStats.useQuery(
    { accountId },
    { refetchInterval: 10000 }
  );

  // 获取任务数量对比
  const { data: taskComparison } = trpc.reportJobs.getTaskComparison.useQuery();

  // 开始初始化
  const startMutation = trpc.reportJobs.startInitialization.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
        refetch();
      } else {
        toast.error(result.message);
      }
    },
    onError: (error) => {
      toast.error(`初始化失败: ${error.message}`);
    },
  });

  // 重试失败的初始化
  const retryMutation = trpc.reportJobs.retryFailedInitialization.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
        refetch();
      } else {
        toast.error(result.message);
      }
    },
    onError: (error) => {
      toast.error(`重试失败: ${error.message}`);
    },
  });

  // 执行智能同步
  const smartSyncMutation = trpc.reportJobs.executeSmartSync.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      refetch();
    },
    onError: (error) => {
      toast.error(`同步失败: ${error.message}`);
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'in_progress':
      case 'initializing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500">待初始化</Badge>;
      case 'in_progress':
      case 'initializing':
        return <Badge className="bg-blue-500">初始化中</Badge>;
      case 'completed':
        return <Badge className="bg-green-500">已完成</Badge>;
      case 'failed':
        return <Badge variant="destructive">失败</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getPhaseName = (phase: string) => {
    const names: Record<string, string> = {
      hot_data: '热数据（90天）',
      cold_data: '冷数据（91-365天）',
      structure_data: '结构数据',
    };
    return names[phase] || phase;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">加载中...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 初始化状态卡片 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                数据初始化状态
                {accountName && <span className="text-muted-foreground font-normal">- {accountName}</span>}
              </CardTitle>
              <CardDescription>
                新店铺接入后需要6-8小时完成历史数据初始化
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {progress?.status === 'pending' && (
                <Button 
                  onClick={() => startMutation.mutate({ accountId })}
                  disabled={startMutation.isPending}
                >
                  {startMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  开始初始化
                </Button>
              )}
              {progress?.status === 'failed' && (
                <Button 
                  variant="outline"
                  onClick={() => retryMutation.mutate({ accountId })}
                  disabled={retryMutation.isPending}
                >
                  {retryMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  重试
                </Button>
              )}
              {progress?.status === 'completed' && (
                <Button 
                  variant="outline"
                  onClick={() => smartSyncMutation.mutate({ accountId })}
                  disabled={smartSyncMutation.isPending}
                >
                  {smartSyncMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  智能同步
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 总体进度 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getStatusIcon(progress?.status || 'pending')}
                {getStatusBadge(progress?.status || 'pending')}
              </div>
              <span className="text-2xl font-bold">{progress?.progress || 0}%</span>
            </div>
            <Progress value={progress?.progress || 0} className="h-3" />
            {progress?.estimatedTimeRemaining && progress.status === 'initializing' && (
              <p className="text-sm text-muted-foreground">
                预计剩余时间: {progress.estimatedTimeRemaining} 分钟
              </p>
            )}
          </div>

          {/* 各阶段进度 */}
          {progress?.phases && progress.phases.length > 0 && (
            <div className="space-y-4">
              <h4 className="font-medium">初始化阶段</h4>
              <div className="space-y-3">
                {progress.phases.map((phase) => (
                  <div key={phase.phase} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(phase.status)}
                        <span>{getPhaseName(phase.phase)}</span>
                      </div>
                      <span className="text-muted-foreground">
                        {phase.completedTasks}/{phase.totalTasks} 任务
                        {phase.failedTasks > 0 && (
                          <span className="text-red-500 ml-2">({phase.failedTasks} 失败)</span>
                        )}
                      </span>
                    </div>
                    <Progress value={phase.progressPercent} className="h-2" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {progress?.error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400">{progress.error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 同步模式说明 */}
      {syncStats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              当前同步模式
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Badge variant={syncStats.mode === 'incremental' ? 'default' : 'secondary'} className="text-lg py-1 px-3">
                {syncStats.mode === 'incremental' ? '增量同步' : '初始化同步'}
              </Badge>
              {syncStats.mode === 'incremental' && (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <TrendingDown className="h-4 w-4" />
                  <span className="text-sm">
                    每日仅需 {syncStats.estimatedDailyTasks} 个任务
                  </span>
                </div>
              )}
            </div>
            
            <div className="mt-4 grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold">{syncStats.pendingTasks}</p>
                <p className="text-sm text-muted-foreground">待处理</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{syncStats.completedTasks}</p>
                <p className="text-sm text-muted-foreground">已完成</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold text-red-600">{syncStats.failedTasks}</p>
                <p className="text-sm text-muted-foreground">失败</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 任务数量对比 */}
      {taskComparison && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5" />
              初始化窗口期优势
            </CardTitle>
            <CardDescription>
              通过6-8小时的初始化窗口期，后续同步压力大幅降低
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* 任务拆分策略说明 */}
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <h5 className="font-medium text-blue-700 dark:text-blue-400 mb-2">任务拆分策略</h5>
              <div className="text-sm text-blue-600 dark:text-blue-400 space-y-1">
                <p>• 热数据（90天）：3天切片 × SP/SB/SD = 每段9个任务</p>
                <p>• 冷数据（91-365天）：14天切片 × SP/SB/SD = 每段3个任务</p>
                <p>• 单个任务数据量小，处理更稳定，失败重试成本低</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <h4 className="font-medium">初始化阶段（一次性）</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">热数据任务 (30切片×3类型)</span>
                    <span>{taskComparison.initialization.hotData}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">冷数据任务 (20切片×3类型)</span>
                    <span>{taskComparison.initialization.coldData}</span>
                  </div>
                  <div className="flex justify-between font-medium pt-1 border-t">
                    <span>总计</span>
                    <span>{taskComparison.initialization.total}</span>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-medium">增量同步（每周）</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">日常任务 (×7)</span>
                    <span>{taskComparison.incremental.daily * 7}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">归因回溯</span>
                    <span>{taskComparison.incremental.weeklyAttribution}</span>
                  </div>
                  <div className="flex justify-between font-medium pt-1 border-t">
                    <span>总计</span>
                    <span>{taskComparison.incremental.total}</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-green-600" />
                <span className="font-medium text-green-700 dark:text-green-400">
                  年度API调用量减少 {taskComparison.savingsPercent}%
                </span>
              </div>
              <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                初始化完成后，系统只需同步增量数据，大幅降低API配额消耗
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
